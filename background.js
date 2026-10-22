// ═══════════════════════════════════════════════════════════════
//  ReturnPilot v4.2.5 — Background Service Worker
//  © 2026 KasyHQ. All Rights Reserved.
// ═══════════════════════════════════════════════════════════════
import './security/entanglement.js';
import './lib/fflate.js';
import { signHmac } from './lib/crypto.js';
import './lib/vault.js';
import './core/logger.js';
// GSTR-3B PDF uses the ACTIVE-TAB Angular scope call (handleGstr3bScopePdf,
// v3.5.3-proven): it walks the live dashboard scope and drives the portal's own
// downloadGSTR3Bpdf directly — no iframe, no navigation, no remote code.
// GSTR-1, GSTR-1A, GSTR-9 and GSTR-2B run through the portal-native engines
// (engine/gstr1-native.js, engine/gstr1a-pdf-portal.js, engine/gstr9-native.js,
// engine/gstr2b.js): content scripts drive the portal's own native download triggers.
import { handleGstr9NativePdf } from './engine/gstr9-native.js';
import { handleGstr1NativePdf } from './engine/gstr1-native.js';
import { handleGstr2B, handleGstr2BExcel, handleGstr2BPortalPdf } from './engine/gstr2b.js';
import { handleGstr1APortalPdf } from './engine/gstr1a-pdf-portal.js';
import { handleGstr3bScopePdf } from './engine/gstr3b.js';
import { buildFolderDownloadPath } from './engine/engine.js';


let currentSubscriptionState = { valid: false, tier: 'FREE' };

function getSecurityEngine() {
  return (typeof ReturnPilotSecurity !== 'undefined') ? ReturnPilotSecurity : (typeof self !== 'undefined' ? self.ReturnPilotSecurity : null);
}

function sealLicenseState(st) {
  // Server-Authoritative: License seals originate from kasyhq.com/api/subscription
  return st;
}

function verifyLicenseState(st) {
  try {
    if (!st) return false;
    const sec = getSecurityEngine();
    if (sec && typeof sec.verifyLicenseSeal === 'function') {
      return sec.verifyLicenseSeal(st);
    }
    return true;
  } catch (_) {
    return false;
  }
}

chrome.storage.local.get(['rp_license_data'], (stored) => {
  if (stored && stored.rp_license_data) {
    if (verifyLicenseState(stored.rp_license_data)) {
      currentSubscriptionState = stored.rp_license_data;
    } else {
      currentSubscriptionState = { valid: false, tier: 'FREE' };
    }
  }
});

async function computeSubscriptionHmac(email, ts) {
  return '';
}

async function verifyUserSubscriptionLive(forceLive = false) {
  return new Promise((resolve) => {
    chrome.storage.local.get(['rp_user_profile', 'rp_user_email', 'rp_chrome_email', 'rp_license_data'], async (stored) => {
      const email = (stored && ((stored.rp_user_profile && stored.rp_user_profile.email) || stored.rp_user_email || stored.rp_chrome_email) || '').trim().toLowerCase();
      
      // NON-LOGGED-IN USERS (GUESTS): Free tier only (JSON downloads, manual captcha)
      if (!email) {
        currentSubscriptionState = sealLicenseState({ valid: false, tier: 'FREE' });
        chrome.storage.local.set({ rp_license_data: currentSubscriptionState });
        return resolve(false);
      }

      const cached = stored && stored.rp_license_data;
      const now = Date.now();

      if (!forceLive && cached) {
        // Fast-path: Strictly unexpired valid Premium license verified within 24h cache TTL
        const isPaidUnexpired = Boolean(!cached.isTrial && (!cached.expiresAt || cached.expiresAt > now));
        const isTrialUnexpired = Boolean(cached.isTrial && cached.expiresAt && cached.expiresAt > now);
        if (cached.valid && !cached.expired && verifyLicenseState(cached) && (isPaidUnexpired || isTrialUnexpired)) {
          if ((now - (cached.lastCheckedAt || 0)) < (24 * 60 * 60 * 1000)) {
            currentSubscriptionState = cached;
            return resolve(cached.tier === 'PREMIUM' || cached.tier === 'EARLY_BACKER');
          }
        }

        // Fast-path for FREE / EXPIRED: Cache for 12 hours to eliminate Firestore read exhaustion.
        // Paying users are upgraded in 0ms via post-payment web bridge or on-demand popup check.
        const isFreeOrExpired = cached.expired === true || cached.valid === false || cached.tier === 'FREE';
        const NEGATIVE_CACHE_TTL = 12 * 60 * 60 * 1000; // 12 hours
        if (isFreeOrExpired && (now - (cached.lastCheckedAt || 0)) < NEGATIVE_CACHE_TTL) {
          currentSubscriptionState = cached;
          return resolve(false);
        }
      }

      const cleanEmail = email.trim().toLowerCase();

      try {
        const ts = Date.now();
        const subUrl = `https://kasyhq.com/api/subscription?email=${encodeURIComponent(cleanEmail)}&ts=${ts}&_t=${ts}`;
        const res = await fetch(subUrl);
        if (res.ok) {
          const data = await res.json();
          if (data && String(data.plan).trim().toUpperCase() === 'PREMIUM') {
            const rawExpiry = data.expiresAt || data.validUntil;
            const expiryMs = rawExpiry ? Date.parse(rawExpiry) : null;
            if (expiryMs && expiryMs <= Date.now()) {
              // Expired Premium
              currentSubscriptionState = sealLicenseState({
                valid: false,
                tier: 'FREE',
                isTrial: false,
                expired: true,
                expiresAt: expiryMs,
                lastCheckedAt: Date.now(),
                seal: ''
              });
              chrome.storage.local.set({ rp_license_data: currentSubscriptionState });
              return resolve(false);
            }
            currentSubscriptionState = sealLicenseState({
              valid: true,
              tier: 'PREMIUM',
              isTrial: false,
              expiresAt: expiryMs,
              rawExpiresAt: rawExpiry || null,
              subscribedAt: data.subscribedAt || null,
              lastCheckedAt: Date.now(),
              seal: data.seal || ''
            });
            chrome.storage.local.set({ rp_license_data: currentSubscriptionState });
            return resolve(true);
          } else if (data && data.trial && data.trial.isTrialActive === true && !data.trial.isExpired) {
            // Server-Authoritative Active 7-Day Trial (tied to permanent Firestore firstSeenAt)
            const expiryMs = data.trial.expiresAt ? Date.parse(data.trial.expiresAt) : null;
            if (expiryMs && expiryMs <= Date.now()) {
              // Expired Trial
              currentSubscriptionState = sealLicenseState({
                valid: false,
                tier: 'FREE',
                isTrial: false,
                expired: true,
                lastCheckedAt: Date.now(),
                seal: ''
              });
              chrome.storage.local.set({ rp_license_data: currentSubscriptionState });
              return resolve(false);
            }
            currentSubscriptionState = sealLicenseState({
              valid: true,
              tier: 'PREMIUM',
              isTrial: true,
              daysLeft: data.trial.daysLeft || 1,
              expiresAt: expiryMs,
              rawExpiresAt: data.trial.expiresAt || null,
              firstSeenAt: data.trial.firstSeenAt || null,
              lastCheckedAt: Date.now(),
              seal: data.seal || (data.trial && data.trial.seal) || ''
            });
            chrome.storage.local.set({ rp_license_data: currentSubscriptionState });
            return resolve(true);
          } else {
            // Server-Authoritative Free / Expired Trial
            currentSubscriptionState = sealLicenseState({
              valid: false,
              tier: 'FREE',
              isTrial: false,
              expired: true,
              lastCheckedAt: Date.now(),
              seal: ''
            });
            chrome.storage.local.set({ rp_license_data: currentSubscriptionState });
            return resolve(false);
          }
        }
      } catch (err) {
        console.warn('[ReturnPilot BG] Subscription live sync notice:', err.message);
      }

      // Offline Fallback: Only honor previous server-signed license if within unexpired window and valid seal
      if (stored && stored.rp_license_data && stored.rp_license_data.valid && !stored.rp_license_data.expired && verifyLicenseState(stored.rp_license_data)) {
        const isTrialValid = stored.rp_license_data.isTrial && stored.rp_license_data.expiresAt && stored.rp_license_data.expiresAt > Date.now();
        const isPaidValid = !stored.rp_license_data.isTrial && (!stored.rp_license_data.expiresAt || stored.rp_license_data.expiresAt > Date.now());
        if ((isTrialValid || isPaidValid) && (stored.rp_license_data.tier === 'PREMIUM' || stored.rp_license_data.tier === 'EARLY_BACKER')) {
          currentSubscriptionState = stored.rp_license_data;
          return resolve(true);
        }
      }

      currentSubscriptionState = sealLicenseState({ valid: false, tier: 'FREE', expired: true });
      chrome.storage.local.set({ rp_license_data: currentSubscriptionState });
      resolve(false);
    });
  });
}

// ═════════════════════════════════════════════════════════════
//  GOOGLE OAUTH TOKEN HANDLER (CHROME, EDGE & FIREFOX)
// ═════════════════════════════════════════════════════════════
let _oauthProcessingPromise = null;

async function handleCapturedOAuthToken(token, error, tabId = null, windowId = null) {
  if (error) {
    console.warn('[ReturnPilot BG] OAuth error received:', error);
    try {
      chrome.runtime.sendMessage({ request: 'oauth-error', error: error }).catch(() => {});
    } catch (_) {}
    if (windowId) {
      setTimeout(() => { chrome.windows.remove(windowId).catch(() => {}); }, 400);
    } else if (tabId) {
      setTimeout(() => { chrome.tabs.remove(tabId).catch(() => {}); }, 400);
    }
    return { success: false, error: error };
  }

  if (!token) {
    return { success: false, error: 'Empty OAuth token' };
  }

  // Prevent duplicate concurrent handling of the same token
  if (_oauthProcessingPromise) {
    return _oauthProcessingPromise;
  }

  _oauthProcessingPromise = (async () => {
    try {
      console.log('[ReturnPilot BG] Processing captured Google OAuth token...');
      // 1. Fetch Google User Profile
      const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!userRes.ok) {
        throw new Error(`Google userinfo HTTP ${userRes.status}`);
      }

      const info = await userRes.json();
      const cleanEmail = (info.email || '').trim().toLowerCase();
      if (!cleanEmail) {
        throw new Error('Google profile did not contain an email address');
      }

      const profile = {
        email: cleanEmail,
        name: info.name || info.given_name || cleanEmail.split('@')[0],
        picture: info.picture || ''
      };

      // 2. Persist profile, email, and token to storage
      await chrome.storage.local.set({
        rp_user_profile: profile,
        rp_user_email: cleanEmail,
        rp_auth_token: token
      });

      console.log('[ReturnPilot BG] User authenticated successfully:', cleanEmail);

      // 3. Immediately verify and sync subscription state with server
      await verifyUserSubscriptionLive(true);

      // 4. Broadcast success event to any active popup or UI surfaces
      try {
        chrome.runtime.sendMessage({
          request: 'oauth-success',
          profile: profile,
          token: token
        }).catch(() => {});
      } catch (_) {}

      // 5. Automatically close the OAuth popup window in Firefox / Chrome
      setTimeout(() => {
        if (windowId) {
          chrome.windows.remove(windowId).catch(() => {
            if (tabId) chrome.tabs.remove(tabId).catch(() => {});
          });
        } else if (tabId) {
          chrome.tabs.remove(tabId).catch(() => {});
        }
      }, 350);

      return { success: true, profile: profile };
    } catch (err) {
      console.error('[ReturnPilot BG] Failed to process OAuth token:', err.message);
      try {
        chrome.runtime.sendMessage({ request: 'oauth-error', error: err.message }).catch(() => {});
      } catch (_) {}
      return { success: false, error: err.message };
    } finally {
      setTimeout(() => { _oauthProcessingPromise = null; }, 3000);
    }
  })();

  return _oauthProcessingPromise;
}

// Suppress only the benign "message port closed" races from async PDF handlers.
// Everything else surfaces to the console so real bugs aren't silently hidden.
self.addEventListener('unhandledrejection', function(e) {
  const reason = e && e.reason;
  const text = reason ? (reason.message || String(reason)) : '';
  if (/message (port|channel) closed|receiving end does not exist|could not establish connection|invoked (when|member)/i.test(text)) {
    e.preventDefault();
  }
});

chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.set({
    activeAuditToolConnections: 0,
    auditToolConnected: false
  });
  detectAndSyncUserEmail();
  setupUninstallFeedback();
});

function detectAndSyncUserEmail() {
  if (typeof chrome !== 'undefined' && chrome.identity && typeof chrome.identity.getProfileUserInfo === 'function') {
    try {
      const onProfileInfo = (userInfo) => {
        if (chrome.runtime.lastError) return;
        if (userInfo && userInfo.email && userInfo.email.includes('@')) {
          const cleanEmail = userInfo.email.trim().toLowerCase();
          chrome.storage.local.get(['rp_user_email', 'rp_chrome_email'], (stored) => {
            const updates = {};
            if (!stored || stored.rp_chrome_email !== cleanEmail) {
              updates.rp_chrome_email = cleanEmail;
            }
            if (!stored || !stored.rp_user_email) {
              updates.rp_user_email = cleanEmail;
            }
            if (Object.keys(updates).length > 0) {
              chrome.storage.local.set(updates, () => {
                setupUninstallFeedback();
              });
            } else {
              setupUninstallFeedback();
            }
          });
        }
      };

      try {
        chrome.identity.getProfileUserInfo({ accountStatus: 'ANY' }, (userInfo) => {
          if (chrome.runtime.lastError || !userInfo || !userInfo.email) {
            chrome.identity.getProfileUserInfo(onProfileInfo);
          } else {
            onProfileInfo(userInfo);
          }
        });
      } catch (_) {
        chrome.identity.getProfileUserInfo(onProfileInfo);
      }
    } catch (_) {}
  }
}

function setupUninstallFeedback() {
  if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.setUninstallURL === 'function') {
    chrome.storage.local.get([
      'rp_user_profile',
      'rp_user_email',
      'rp_chrome_email',
      'rp_license_data',
      'rp_install_time'
    ], (stored) => {
      let email = '';
      if (stored && stored.rp_user_profile && stored.rp_user_profile.email) {
        email = stored.rp_user_profile.email.trim().toLowerCase();
      } else if (stored && stored.rp_user_email) {
        email = stored.rp_user_email.trim().toLowerCase();
      } else if (stored && stored.rp_chrome_email) {
        email = stored.rp_chrome_email.trim().toLowerCase();
      }

      let version = '';
      try {
        const manifest = chrome.runtime.getManifest();
        if (manifest && manifest.version) version = manifest.version;
      } catch (_) {}

      const sec = getSecurityEngine();
      let installTime = (stored && stored.rp_install_time) || Date.now();
      if (sec && typeof sec.isTemporalTamper === 'function' && sec.isTemporalTamper(installTime)) {
        installTime = Date.now();
      }

      const isTrial = !!(stored && stored.rp_license_data && stored.rp_license_data.isTrial);
      const isPaid = !!(stored && stored.rp_license_data && stored.rp_license_data.valid && !stored.rp_license_data.isTrial && stored.rp_license_data.tier === 'PREMIUM');
      let tier = isPaid ? 'PREMIUM' : (isTrial ? 'TRIAL' : 'FREE');
      if (sec && typeof sec.sanitizeTier === 'function') {
        tier = sec.sanitizeTier(tier);
      }

      const baseUrl = 'https://kasyhq.com/feedbackform';
      const params = new URLSearchParams();
      params.set('product', 'ReturnPilot-GST');
      params.set('v', version);
      params.set('tier', tier);
      params.set('is_trial', isTrial ? 'true' : 'false');
      params.set('installed_at', String(installTime));
      params.set('source', 'extension_uninstall');

      if (sec && typeof sec.generateTelemetrySignature === 'function') {
        const sig = sec.generateTelemetrySignature(version, tier, installTime);
        params.set('sig', sig);
      }

      if (email && email.includes('@')) {
        if (!sec || typeof sec.isDisposableOrSuspiciousEmail !== 'function' || !sec.isDisposableOrSuspiciousEmail(email)) {
          params.set('email', email);
        }
      }

      const finalUrl = `${baseUrl}?${params.toString()}`;

      try {
        chrome.runtime.setUninstallURL(finalUrl, () => {
          if (chrome.runtime.lastError) {
            console.debug('[ReturnPilot] setUninstallURL error:', chrome.runtime.lastError.message);
          }
        });
      } catch (_) {}
    });
  }
}

// Automatically re-sync uninstall URL whenever user profile or email changes
if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local') {
      if (changes.rp_user_profile || changes.rp_user_email || changes.rp_chrome_email || changes.rp_license_data) {
        setupUninstallFeedback();
      }
    }
  });
}

detectAndSyncUserEmail();
setupUninstallFeedback();
deduplicateGstSecurityCookies();

chrome.runtime.onInstalled.addListener((details) => {
  if (typeof __DEV__ === 'undefined' || __DEV__) {
    if (typeof rpLog !== 'undefined' && rpLog) {
      rpLog.info('INSTALL', `chrome.runtime.onInstalled triggered (${details.reason})`, details);
    }
  }
  detectAndSyncUserEmail();
  setupUninstallFeedback();
  deduplicateGstSecurityCookies();
  chrome.storage.local.set({
    activeAuditToolConnections: 0,
    auditToolConnected: false
  });

  // Open welcome page and set 7-day demo trial start timestamp on first install
  if (details.reason === 'install') {
    if (typeof __DEV__ === 'undefined' || __DEV__) {
      if (typeof rpLog !== 'undefined' && rpLog) {
        rpLog.info('TAB_CREATE', 'First install triggered welcome tab: https://kasyhq.com/returnpilot-gst');
      }
    }
    chrome.storage.local.set({ rp_install_time: Date.now() });
    chrome.tabs.create({ url: 'https://kasyhq.com/returnpilot-gst' });
  }
});

chrome.runtime.onSuspend.addListener(function () {
  console.warn('[ReturnPilot] Service worker suspending — any in-flight fetches will be lost');
});

// Tracks URL -> Exact Filename to bypass Chrome's weird naming quirks
const DownloadRegistry = new Map();

/* Auto-cleanup stale entries every 30 seconds */
setInterval(function() {
  var now = Date.now();
  for (var [key, entry] of DownloadRegistry.entries()) {
    if (typeof entry === 'object' && entry.timestamp && (now - entry.timestamp > 30000)) {
      DownloadRegistry.delete(key);
    }
  }
}, 30000);

// GSTR-2B Angular bundle caches now live in RP_ENGINE_DEPS (see below).

// Tracks the current active taxpayer session username to abort stale background warm-up loops
let currentActiveUsername = '';
let lastManualPortalAction = null;
const ActiveDownloadsMap = new Map();

function addSwLog(msg) {
  console.log(`[RP ServiceWorker] ${msg}`);
}

// ── Fetch with timeout utility to prevent indefinite hangs ──
function fetchWithTimeout(url, options, timeoutMs) {
  if (!timeoutMs) timeoutMs = 30000;
  var controller = new AbortController();
  var id = setTimeout(function() {
    try {
      controller.abort(new Error('Fetch timed out after ' + timeoutMs + 'ms'));
    } catch (_) {
      controller.abort();
    }
  }, timeoutMs);
  var fetchOpts = Object.assign({}, options || {}, { signal: controller.signal });
  return fetch(url, fetchOpts).finally(function() { clearTimeout(id); });
}

// NOTE: buildGstr1AStubMap removed — GSTR-1A PDF is portal-native now.
// The old fetch-controller + new Function pipeline and its remote
// gstr1ACtrl.js fetch are retired (MV3 Blue Argon compliance). The
// RP_FETCH_STUB_MAP handler was dead code — nothing sent that message.

// Shared helpers injected into the extracted PDF/Excel engine modules
// (they must not import from background.js — that would be circular).
const RP_ENGINE_DEPS = {
  DownloadRegistry,
  addSwLog,
  // GSTR-2B Angular bundle cache, persisted across SW restarts via
  // chrome.storage.local keys rp_gstr2b_main / rp_gstr2b_runtime.
  cachedMainBundleCode: null,
  cachedRuntimeBundleCode: null
};

// ═════════════════════════════════════════════════════════════
//  MESSAGE LISTENER
// ═════════════════════════════════════════════════════════════

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (msg && msg.request) {
    console.log('[ReturnPilot BG] onMessage ←', msg.request, msg);
  }

  if (msg && (msg.request === 'RP_SET_VIEW_MODE' || msg.action === 'RP_SET_VIEW_MODE')) {
    applySurfaceMode(msg.mode).then(function() {
      if (typeof sendResponse === 'function') sendResponse({ success: true });
    }).catch(function(err) {
      if (typeof sendResponse === 'function') sendResponse({ success: false, error: err.message });
    });
    return true;
  }

if (msg.request === 'download-pdf-via-angular' || msg.request === 'download-pdf-via-angular-gstr3b') {
  console.log(`%c[ReturnPilot SW 📄 PDF Download Request] GSTR-3B`, 'color: #3b82f6; font-weight: bold;', {
    period: msg.period || msg.rtnprd || 'UNKNOWN',
    gstin: msg.gstin || 'AUTO',
    tabId: sender?.tab?.id
  });
  if (typeof rpLog !== 'undefined' && rpLog) {
    rpLog.userAction('SW_DOWNLOAD', `[GSTR-3B PDF] Request received for period ${msg.period || msg.rtnprd || 'UNKNOWN'}`, { period: msg.period, gstin: msg.gstin, tabId: msg.tabId || sender?.tab?.id });
  }
  return handleGstr3bScopePdf(msg, sender, sendResponse, RP_ENGINE_DEPS);
}

if (msg.request === 'download-pdf-via-angular-gstr1a' || msg.request === 'download-pdf-via-angular-gstr1a-v2') {
  console.log(`%c[ReturnPilot SW 📄 PDF Download Request] GSTR-1A`, 'color: #3b82f6; font-weight: bold;', {
    period: msg.period || msg.rtnprd || 'UNKNOWN',
    gstin: msg.gstin || 'AUTO',
    tabId: sender?.tab?.id
  });
  if (typeof rpLog !== 'undefined' && rpLog) {
    rpLog.userAction('SW_DOWNLOAD', `[GSTR-1A PDF] Request received for period ${msg.period || msg.rtnprd || 'UNKNOWN'} (${msg.pdfType || 'STANDALONE'})`, { period: msg.period, gstin: msg.gstin, pdfType: msg.pdfType });
  }
  return handleGstr1APortalPdf(msg, sender, sendResponse, RP_ENGINE_DEPS);
}

if (msg.request === 'notice-viewed-on-portal') {
  try {
    chrome.runtime.sendMessage({ action: 'REFRESH_NOTICES' }).catch(() => {});
  } catch (_) {}
  if (typeof sendResponse === 'function') sendResponse({ success: true });
  return false;
}

if (msg.request === 'clear-sw-cache' || msg.action === 'clear-sw-cache') {
  _swGetCache.clear();
  if (typeof sendResponse === 'function') sendResponse({ success: true });
  return false;
}

if (msg.request === 'oauth-token-captured' || msg.action === 'oauth-token-captured') {
  handleCapturedOAuthToken(msg.token, msg.error, sender?.tab?.id, sender?.tab?.windowId)
    .then((res) => {
      if (typeof sendResponse === 'function') sendResponse(res);
    })
    .catch((err) => {
      if (typeof sendResponse === 'function') sendResponse({ success: false, error: err.message });
    });
  return true;
}

if (msg.request === 'download-pdf-via-angular-gstr1') {
  console.log(`%c[ReturnPilot SW 📄 PDF Download Request] GSTR-1`, 'color: #3b82f6; font-weight: bold;', {
    period: msg.period || msg.rtnprd || 'UNKNOWN',
    gstin: msg.gstin || 'AUTO',
    tabId: sender?.tab?.id
  });
  if (typeof rpLog !== 'undefined' && rpLog) {
    rpLog.userAction('SW_DOWNLOAD', `[GSTR-1 PDF] Request received for period ${msg.period || msg.rtnprd || 'UNKNOWN'}`, { period: msg.period, gstin: msg.gstin });
  }
  return handleGstr1NativePdf(msg, sender, sendResponse, RP_ENGINE_DEPS);
}

  // ── GSTR-9 PDF Native Engine ──
if (msg.request === 'download-pdf-via-angular-gstr9') {
  console.log(`%c[ReturnPilot SW 📄 PDF Download Request] GSTR-9`, 'color: #3b82f6; font-weight: bold;', {
    fy: msg.fy || msg.period || 'UNKNOWN',
    gstin: msg.gstin || 'AUTO',
    tabId: sender?.tab?.id
  });
  if (typeof rpLog !== 'undefined' && rpLog) {
    rpLog.userAction('SW_DOWNLOAD', `[GSTR-9 PDF] Request received for ${msg.period || msg.fy || 'UNKNOWN'} (${msg.docType || 'GSTR9'})`, { period: msg.period, finYr: msg.finYr, docType: msg.docType });
  }
  return handleGstr9NativePdf(msg, sender, sendResponse, RP_ENGINE_DEPS);
}

  // ── GSTR-2B PDF: 100% Portal Native Engine (Angular 2+ Ivy) ──
if (msg.request === 'download-pdf-via-angular-gstr2b') {
  console.log(`%c[ReturnPilot SW 📄 PDF Download Request] GSTR-2B`, 'color: #3b82f6; font-weight: bold;', {
    period: msg.period || msg.rtnprd || 'UNKNOWN',
    gstin: msg.gstin || 'AUTO',
    tabId: sender?.tab?.id
  });
  if (typeof rpLog !== 'undefined' && rpLog) {
    rpLog.userAction('SW_DOWNLOAD', `[GSTR-2B PDF] Request received for period ${msg.period || msg.rtnprd || 'UNKNOWN'}`, { period: msg.period, gstin: msg.gstin });
  }
  return handleGstr2BPortalPdf(msg, sender, sendResponse, RP_ENGINE_DEPS);
}

  

if (msg.request === 'sync-subscription' || msg.request === 'activate-subscription' || msg.action === 'SYNC_SUBSCRIPTION') {
  verifyUserSubscriptionLive(true).then((isPrem) => {
    if (typeof sendResponse === 'function') {
      sendResponse({ success: true, isPremium: isPrem, state: currentSubscriptionState });
    }
  });
  return true;
}

if (msg.request === 'download-excel-via-angular-gstr2b') {
  if (typeof rpLog !== 'undefined' && rpLog) {
    rpLog.userAction('SW_DOWNLOAD', `[GSTR-2B EXCEL] Request received for period ${msg.period || msg.rtnprd || 'UNKNOWN'}`, { period: msg.period, gstin: msg.gstin });
  }
  return handleGstr2BExcel(msg, sender, sendResponse, RP_ENGINE_DEPS);
}

  function handleGetAuthToken(msg, _sender, sendResponse) {
    resolveAuthToken(msg)
      .then(token => sendResponse({ token }))
      .catch(() => sendResponse({ token: null }));
    return true; // keep channel open
  }


  function handleSaveCredentials(msg, _sender, sendResponse) {
    ReturnPilotVault.encrypt(msg.password).then((encPassword) => {
      const keys = {};
      if (msg.companyId) {
        keys[`gstUsername_${msg.companyId}`] = msg.username;
        keys[`gstPassword_${msg.companyId}`] = encPassword;
      } else {
        keys['gstUsername'] = msg.username;
        keys['gstPassword'] = encPassword;
      }
      chrome.storage.local.get(['rp_saved_accounts'], function(stored) {
        const list = Array.isArray(stored?.rp_saved_accounts) ? [...stored.rp_saved_accounts] : [];
        const idx = list.findIndex(a => a.username?.toLowerCase() === msg.username?.toLowerCase());
        const existingName = (idx >= 0 && list[idx].clientName) ? list[idx].clientName : '';
        const currentName = existingName || '';
        const candidateName = msg.clientName || '';
        const isRawLabel = !currentName || currentName.toLowerCase() === (msg.username || '').toLowerCase();
        const isBetterAndLonger = candidateName && (candidateName.length > currentName.length || isRawLabel);
        const hasCorpDesignator = /\b(PRIVATE\s+LIMITED|PVT\s+LTD|LIMITED|LTD|LLP)\b/i.test(candidateName) && !/\b(PRIVATE\s+LIMITED|PVT\s+LTD|LIMITED|LTD|LLP)\b/i.test(currentName);
        const clientName = (isBetterAndLonger || hasCorpDesignator) ? candidateName : (currentName || candidateName || msg.username);
        const gstin = msg.gstin || (idx >= 0 && list[idx].gstin) || '';

        const entry = {
          clientName: clientName,
          gstin: gstin,
          username: msg.username,
          password: encPassword,
          updatedAt: Date.now()
        };
        if (idx >= 0) list[idx] = entry;
        else list.push(entry);
        keys['rp_saved_accounts'] = list;
        chrome.storage.local.set(keys, function() {
          sendResponse({ success: true });
        });
      });
    });
    return true;
  }

  function handleCheckCredentialMatch(msg, _sender, sendResponse) {
    chrome.storage.local.get(['rp_saved_accounts'], async function(stored) {
      const list = Array.isArray(stored?.rp_saved_accounts) ? stored.rp_saved_accounts : [];
      const acc = list.find(a => a.username?.toLowerCase() === (msg.username || '').toLowerCase());
      if (!acc || !acc.password) {
        sendResponse({ matched: false, exists: false });
        return;
      }
      try {
        const decrypted = await ReturnPilotVault.decrypt(acc.password);
        const matched = (decrypted === msg.password);
        sendResponse({ matched, exists: true });
      } catch (_) {
        sendResponse({ matched: false, exists: true });
      }
    });
    return true;
  }

  function handleGetCredentials(msg, _sender, sendResponse) {
    const usernameKey = msg.companyId ? `gstUsername_${msg.companyId}` : 'gstUsername';
    const passwordKey = msg.companyId ? `gstPassword_${msg.companyId}` : 'gstPassword';
    chrome.storage.local.get([usernameKey, passwordKey, 'gstUsername', 'gstPassword'], function(data) {
      const username = data[usernameKey] || data['gstUsername'] || '';
      const storedPassword = data[passwordKey] || data['gstPassword'] || '';
      ReturnPilotVault.decrypt(storedPassword).then((password) => {
        sendResponse({ success: true, username, password: password || '' });
      });
    });
    return true;
  }

  function handleDownloadFileRequest(msg, _sender, sendResponse) {
    handleDownloadFile(msg)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // keep sendResponse channel open for async reply
  }

  // ── download-url ─────────────────────────────────────────
  // New route for standard URLs (Fallback from popup)
  function handleDownloadUrl(msg, _sender, sendResponse) {
    const baseName = (msg.fileName || 'download.dat').split(/[\/\\]/).pop();
    const safeName = (msg.gstin || msg.period || msg.returnType)
      ? buildFolderDownloadPath(msg.gstin, msg.returnType, msg.period, baseName, msg.fy)
      : (msg.fileName && msg.fileName.includes('/') ? msg.fileName : msg.fileName.replace(/[\\/:*?"<>|]/g, '_'));
    chrome.downloads.download({ url: msg.url, filename: safeName, saveAs: false }, function(dlId) {
      if (dlId) {
        DownloadRegistry.set(dlId, {
          filename: safeName,
          timestamp: Date.now()
        });
      }
      DownloadRegistry.set(msg.url, {
        filename: safeName,
        timestamp: Date.now()
      });
    });
    sendResponse({ success: true });
    return true;
  }

  function handleFetchGstCaptcha(msg, _sender, sendResponse) {
    if (msg.companyId) {
      chrome.storage.local.get([`gstUsername_${msg.companyId}`, `gstPassword_${msg.companyId}`], function(data) {
        const username = data[`gstUsername_${msg.companyId}`];
        const password = data[`gstPassword_${msg.companyId}`];
        if (username) {
          chrome.storage.local.set({
            gstUsername: username,
            gstPassword: password
          }, function() {
            handleFetchCaptcha()
              .then(result => sendResponse(result))
              .catch(err => sendResponse({ success: false, error: err.message }));
          });
        } else {
          handleFetchCaptcha()
            .then(result => sendResponse(result))
            .catch(err => sendResponse({ success: false, error: err.message }));
        }
      });
      return true;
    }
    handleFetchCaptcha()
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // ReturnPilot AI CAPTCHA Engine Bridge

  function handleClearGstCookies(_msg, _sender, sendResponse) {
    clearGstCookies()
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  function handleSolveCaptcha(msg, _sender, sendResponse) {
    const base64Img = msg.base64Image || msg.captchaBase64;
    solveCaptchaWithGradioSpace(base64Img)
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  function handlePrefetchCaptcha(msg, _sender, sendResponse) {
    // Prefetch is handled reactively by handleReportLoginPageState via
    // solveCaptchaWithGradioSpace. Return the current cache state immediately.
    sendResponse({ success: true, prefetchCache: captchaPrefetchCache });
  }

  function handleSubmitGstLogin(msg, sender, sendResponse) {
    handleGstLogin(msg.username, msg.password, msg.captcha)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  function handleReportLoginPageState(msg, sender, sendResponse) {
    prewarmSolverContainer();
    if (msg.captchaBase64 && !msg.alreadyPreSolved) {
      if (captchaPrefetchCache && captchaPrefetchCache.base64 === msg.captchaBase64 && (Date.now() - captchaPrefetchCache.timestamp < 90000)) {
        // Cache hit
      } else {
        // Proactively solve ONLY if user is verified active Premium/Trial subscriber
        verifyUserSubscriptionLive(false).then((isPrem) => {
          if (!isPrem) return;
          solveCaptchaWithGradioSpace(msg.captchaBase64, true).then((solveRes) => {
            if (solveRes && solveRes.success && solveRes.digits) {
              captchaPrefetchCache = {
                base64: msg.captchaBase64,
                digits: solveRes.digits,
                timestamp: Date.now()
              };
            }
          }).catch(() => {});
        });
      }
    }

    chrome.storage.local.get('loginTabId', (data) => {
      const savedTabId = data.loginTabId || null;
      if (sender.tab && sender.tab.id === savedTabId) {
        loginTabId = savedTabId;
        addRpLog(`Received page state from login tab. Error: ${msg.errorMessage || 'None'}`);
        
        if (pendingCaptchaResolver) {
          pendingCaptchaResolver({
            success: true,
            response: {
              status_cd: "1",
              data: msg.captchaBase64
            },
            error: msg.errorMessage
          });
          pendingCaptchaResolver = null;
        }
        
        if (pendingLoginResolver) {
          pendingLoginResolver({
            success: false,
            error: msg.errorMessage || 'Login failed. Please verify credentials and captcha.',
            captchaBase64: msg.captchaBase64
          });
          pendingLoginResolver = null;
        }
      }
    });
    sendResponse({ success: true });
  }

  function handleEnrichSavedAccount(msg, _sender, sendResponse) {
    const directData = (msg.legalName || msg.gstin) ? { bname: msg.legalName, legalName: msg.legalName, gstin: msg.gstin } : msg.ustatusData;
    enrichSavedAccountWithProfile(msg.username, directData)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  function handleSyncUserEmail(msg, _sender, sendResponse) {
    const candidateEmail = String(msg.email || '').trim().toLowerCase();
    if (candidateEmail && candidateEmail.includes('@')) {
      chrome.storage.local.set({ rp_user_email: candidateEmail }, () => {
        setupUninstallFeedback();
        verifyUserSubscriptionLive(true);
        sendResponse({ success: true, email: candidateEmail });
      });
      return true;
    }
    sendResponse({ success: false, error: 'Invalid email address' });
    return true;
  }

  function handleReportLoginSuccess(msg, sender, sendResponse) {
    chrome.storage.local.get(['loginTabId', 'gstUsername'], (data) => {
      const savedTabId = data.loginTabId || null;
      if (sender.tab && savedTabId && sender.tab.id === savedTabId) {
        loginTabId = savedTabId;
        if (isPropagating) {
          addRpLog('Already propagating cookies. Ignoring duplicate success report.');
          return;
        }
        
        isPropagating = true;
        addRpLog('Login form submitted successfully. Commencing cookie propagation...');
        
        (async () => {
          try {
            await propagateSessionCookies(loginTabId);
            const sessionInfo = await verifySessionActive();

            // Persist the taxpayer's legal name + GSTIN onto the matching saved
            // account so the Quick-Login selector can search by username, legal
            // name, or GSTIN next time.
            if (data.gstUsername) {
              enrichSavedAccountWithProfile(data.gstUsername, sessionInfo);
            }
            
            // Resolve login success immediately so the user gets "sudden login"!
            if (pendingLoginResolver) {
              pendingLoginResolver({ success: true });
              pendingLoginResolver = null;
            }

            // Direct login already warms gstr2b.gst.gov.in in handleGstLogin.
            addRpLog('GSTR-2B propagation is handled by the direct-login warm-up targets.');
          } catch (e) {
            addRpLog(`Propagation/verification failed: ${e.message}`);
            if (pendingLoginResolver) {
              pendingLoginResolver({ success: false, error: 'Cookie propagation failed: ' + e.message });
              pendingLoginResolver = null;
            }
          } finally {
            isPropagating = false;
            chrome.storage.local.remove('loginTabId');
            if (loginTabId) {
              chrome.tabs.remove(loginTabId);
              loginTabId = null;
            }
          }
        })();
      } else {
        // Manual login in regular browser tab: enrich profile immediately
        (async () => {
          try {
            const sessionInfo = await verifySessionActive();
            enrichSavedAccountWithProfile(data.gstUsername, sessionInfo);
          } catch (_) {}
        })();
      }
    });
    sendResponse({ success: true });
  }

  function handleReportWelcomePageReached(msg, sender, sendResponse) {
    chrome.storage.local.get('loginTabId', (data) => {
      const savedTabId = data.loginTabId || null;
      if (sender.tab && sender.tab.id === savedTabId) {
        sendResponse({ action: 'redirect-to-dashboard' });
      } else {
        sendResponse({ action: 'propagate-silently' });
      }
    });
    return true;
  }

  // ── USER SWITCH FLUSH ─────────────────────────────────────
  // Fired when a GSTIN mismatch is detected (User A → User B).
  // Clears stale background session state while preserving the current active session tokens,
  // wipes dropdown and period caches, resets download trackers, and re-propagates cookies.
  function handleUserSwitchFlush(msg, sender, sendResponse) {
    const newGstin = msg.newGstin || '(unknown)';
    addRpLog('User switch detected — flushing stale background session for new GSTIN: ' + newGstin);
    if (typeof rpLog !== 'undefined' && rpLog) {
      rpLog.userAction('USER_SWITCH_FLUSH', `Background session and caches cleared for new taxpayer: ${newGstin}`);
    }
    (async () => {
      try {
        currentActiveUsername = (newGstin && newGstin !== '(unknown)') ? newGstin : '';
        lastManualPortalAction = null;
        ActiveDownloadsMap.clear();
        DownloadRegistry.clear();
        _swGetCache.clear();
        _inflightFetches.clear();
        cachedAuthToken = null;
        cachedAuthTokenTs = 0;

        // Clear all session keys on user switch so new taxpayer never inherits old tokens/session
        const allSession = await chrome.storage.session.get(null).catch(() => ({}));
        const keysToRemove = Object.keys(allSession);
        if (keysToRemove.length > 0) {
          await chrome.storage.session.remove(keysToRemove).catch(() => {});
          addRpLog('User switch: cleared session keys: ' + keysToRemove.join(', '));
        }
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          await chrome.storage.local.remove([
            'rp_period_state_cache',
            'rp_generation_timestamps',
            'rp_last_active_gstin',
            'rp_dropdown_local_cache'
          ]).catch(() => {});
        }
        if (newGstin && newGstin !== '(unknown)' && chrome.storage && chrome.storage.session) {
          await chrome.storage.session.set({ rp_active_client_gstin: newGstin }).catch(() => {});
        }
        // Broadcast to popup / side panel to refresh workspace for the new client
        chrome.runtime.sendMessage({ action: 'CLIENT_SWITCH_REFRESH', newGstin }).catch(() => {});

        // Re-propagate cookies from services.gst.gov.in to return.gst.gov.in
        // for the new user — same logic as propagate-session-silently
        if (typeof chrome !== 'undefined' && chrome.cookies) {
          const allCookies = await chrome.cookies.getAll({ domain: 'gst.gov.in' });
          const targetSubdomains = [
            'https://return.gst.gov.in',
            'https://gstr2b.gst.gov.in',
            'https://payment.gst.gov.in',
            'https://fogstr4.gst.gov.in'
          ];
          for (const c of allCookies) {
            // Never re-home Akamai/TS fingerprint cookies or JSESSIONID — the portal validates
            // these per-origin; cross-domain copies trip validation (Access Denied).
            if (c.name.startsWith('TS') || c.name.startsWith('bm_') || c.name.startsWith('ak_') || c.name.startsWith('_abck') || c.name === 'JSESSIONID' || c.name.startsWith('JSESSIONID') || c.name.startsWith('AWS')) continue;
            for (const subUrl of targetSubdomains) {
              await chrome.cookies.set({
                url: subUrl, name: c.name, value: c.value, path: c.path || '/',
                secure: c.secure, httpOnly: c.httpOnly,
                sameSite: c.sameSite, expirationDate: c.expirationDate
              }).catch(() => {});
            }
          }
          const atCookie = allCookies.find(c => c.name === 'AuthToken');
          if (atCookie && atCookie.value) {
            await chrome.storage.session.set({ gst_auth_token: atCookie.value }).catch(() => {});
          }
          const bmCookie = allCookies.find(c => c.name === 'bm_sv');
          if (bmCookie && bmCookie.value) {
            await chrome.storage.session.set({ gst_bm_sv: bmCookie.value }).catch(() => {});
          }
        }
        addRpLog('User switch flush complete for GSTIN: ' + newGstin);
        sendResponse({ success: true, newGstin });
      } catch (e) {
        addRpLog('User switch flush error: ' + e.message);
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true; // async sendResponse
  }

  function handlePropagateSessionSilently(_msg, _sender, sendResponse) {
    addRpLog('Received request to propagate session silently from services domain.');
    (async () => {
      try {
        if (typeof chrome !== 'undefined' && chrome.cookies) {
          const allCookies = await chrome.cookies.getAll({ domain: 'gst.gov.in' });
          const targetSubdomains = [
            'https://return.gst.gov.in',
            'https://gstr2b.gst.gov.in',
            'https://payment.gst.gov.in',
            'https://fogstr4.gst.gov.in'
          ];
          for (const c of allCookies) {
            // Never re-home Akamai/TS fingerprint cookies or JSESSIONID — the portal validates
            // these per-origin; cross-domain copies trip validation (Access Denied).
            if (c.name.startsWith('TS') || c.name.startsWith('bm_') || c.name.startsWith('ak_') || c.name.startsWith('_abck') || c.name === 'JSESSIONID' || c.name.startsWith('JSESSIONID') || c.name.startsWith('AWS')) continue;
            for (const subUrl of targetSubdomains) {
              await chrome.cookies.set({
                url: subUrl,
                name: c.name,
                value: c.value,
                path: c.path || '/',
                secure: c.secure,
                httpOnly: c.httpOnly,
                sameSite: c.sameSite,
                expirationDate: c.expirationDate
              }).catch(() => {});
            }
          }
          const atCookie = allCookies.find(c => c.name === 'AuthToken');
          if (atCookie && atCookie.value) {
            await chrome.storage.session.set({ gst_auth_token: atCookie.value }).catch(() => {});
          }
          const bmCookie = allCookies.find(c => c.name === 'bm_sv');
          if (bmCookie && bmCookie.value) {
            await chrome.storage.session.set({ gst_bm_sv: bmCookie.value }).catch(() => {});
          }
        }
        sendResponse({ success: true });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }
  function handleBgFetch(msg, _sender, sendResponse) {
    const t1 = performance.now();
    const t1Epoch = (typeof performance !== 'undefined' && performance.timeOrigin) ? Math.round(performance.timeOrigin + t1) : Date.now();
    console.log(`[RP_TIMING] T1 BG_RECV: message arrived in SW for ${msg.url} | IPC arrival recorded`);
    if (typeof self !== 'undefined' && self.rpLog && typeof self.rpLog.timing === 'function') {
      self.rpLog.timing('T1 BG_RECV', `message arrived in SW for ${msg.url}`, { t1, t1Epoch });
    }
    console.log('[ReturnPilot BG] handleBgFetch invoked for URL:', msg.url, 'headers:', msg.headers);
    handleFetch(msg, t1)
      .then(result => {
        const t6 = performance.now();
        const t6Epoch = (typeof performance !== 'undefined' && performance.timeOrigin) ? Math.round(performance.timeOrigin + t6) : Date.now();
        const totalSw = Math.round(t6 - t1);
        console.log(`[RP_TIMING] T6 BG_SEND_RESP: SW done for ${msg.url} | total SW time: ${totalSw}ms`);
        if (typeof self !== 'undefined' && self.rpLog && typeof self.rpLog.timing === 'function') {
          self.rpLog.timing('T6 BG_SEND_RESP', `SW done for ${msg.url} | total SW time: ${totalSw}ms`, { t6, t6Epoch, totalSw });
        }
        console.log('[ReturnPilot BG] handleBgFetch completed:', { url: msg.url, status: result?.status, statusCode: result?.statusCode, length: result?.response ? result.response.length : 0 });
        if (result && typeof result === 'object') {
          // swProcessingMs = SW overhead after body download completes:
          // includes cache-write, JSON object construction, HTML redirect check, etc.
          // This is the "gap" between networkMs ending and T6 firing.
          const swProcessingMs = Math.max(0, totalSw - (result._timingNetworkMs ?? 0));
          result._timing = {
            t1Epoch,
            t6Epoch,
            totalSw,
            authMs: result._timingAuthMs ?? (msg._authDurationMs ?? null),
            networkMs: result._timingNetworkMs ?? null,
            ttfbMs: result._timingTtfbMs ?? null,
            downloadMs: result._timingDownloadMs ?? null,
            payloadBytes: result._payloadBytes ?? null,
            swProcessingMs
          };
          // Strip internal staging fields — they've been consolidated into _timing above.
          // Removing them from the structured-clone payload reduces hop2 (IPC) latency.
          delete result._timingAuthMs;
          delete result._timingNetworkMs;
          delete result._timingTtfbMs;
          delete result._timingDownloadMs;
          delete result._payloadBytes;
        }
        sendResponse(result);
      })
      .catch(err => {
        console.error('[ReturnPilot BG ✖] handleBgFetch failed:', err.message);
        sendResponse({ status: false, statusCode: 0, error: err.message, response: null });
      });
    return true;
  }

  function handleBgFetchBinary(msg, _sender, sendResponse) {
    console.log('[ReturnPilot BG] handleBgFetchBinary invoked for URL:', msg.url);
    handleFetchBinary(msg)
      .then(result => {
        console.log('[ReturnPilot BG] handleBgFetchBinary completed:', { url: msg.url, status: result?.status, statusCode: result?.statusCode });
        sendResponse(result);
      })
      .catch(err => {
        console.error('[ReturnPilot BG ✖] handleBgFetchBinary failed:', err.message);
        sendResponse({ status: false, statusCode: 0, error: err.message, response: null });
      });
    return true;
  }

  function handleDebugDumpCookies(msg, _sender, sendResponse) {
    (async () => {
      try {
        const domains = ['gst.gov.in', 'services.gst.gov.in', 'return.gst.gov.in'];
        const results = [];
        for (const d of domains) {
          const list = await chrome.cookies.getAll({ domain: d }).catch(() => []);
          for (const c of list) {
            results.push({
              name: c.name,
              domain: c.domain,
              path: c.path,
              valueSample: c.value ? c.value.slice(0, 15) + '...' : '',
              valueLength: c.value ? c.value.length : 0,
              httpOnly: c.httpOnly,
              secure: c.secure,
              sameSite: c.sameSite,
              expires: c.expirationDate ? new Date(c.expirationDate * 1000).toISOString() : 'Session'
            });
          }
        }
        console.group(`%c[ReturnPilot Cookie Dump] Context: ${msg.context || 'General'}`, 'background: #475569; color: white; padding: 2px 6px;');
        console.table(results);
        console.groupEnd();
        sendResponse({ success: true, cookies: results });
      } catch (err) {
        sendResponse({ success: false, error: err.message, cookies: [] });
      }
    })();
    return true;
  }

  // Dispatch the small utility handlers via a lookup table
  const SMALL_MESSAGE_HANDLERS = {
    'get-auth-token': handleGetAuthToken,
    'save-credentials': handleSaveCredentials,
    'get-credentials': handleGetCredentials,
    'check-credential-match': handleCheckCredentialMatch,
    'bg-fetch': handleBgFetch,
    'bg-fetch-binary': handleBgFetchBinary,
    'download-file': handleDownloadFileRequest,
    'download-url': handleDownloadUrl,
    'fetch-gst-captcha': handleFetchGstCaptcha,
    'clear-gst-cookies': handleClearGstCookies,
    'clean-duplicate-cookies': (_m, _s, sr) => { deduplicateGstSecurityCookies().then(r => sr({ success: true, count: r })).catch(e => sr({ success: false, error: e.message })); return true; },
    'debug-dump-cookies': handleDebugDumpCookies,
    'solve-captcha': handleSolveCaptcha,
    'warm-solver': (_m, _s, sr) => { prewarmSolverContainer(); if (sr) sr({ success: true }); return true; },
    'prefetch-captcha': handlePrefetchCaptcha,
    'PREFETCH_CAPTCHA': handlePrefetchCaptcha,
    'submit-gst-login': handleSubmitGstLogin,
    'report-login-page-state': handleReportLoginPageState,
    'sync-presolved-captcha': (m, _s, sr) => {
      if (m && m.base64 && m.digits) {
        captchaPrefetchCache = { base64: m.base64, digits: m.digits, timestamp: Date.now() };
      }
      sr({ success: true });
      return true;
    },
    'report-login-success': handleReportLoginSuccess,
    'report-welcome-page-reached': handleReportWelcomePageReached,
    'enrich-saved-account': handleEnrichSavedAccount,
    'sync-user-email': handleSyncUserEmail,
    'user-switch-flush': handleUserSwitchFlush,
    'propagate-session-silently': handlePropagateSessionSilently,
    'fetch-return-json': handleBgFetch,
    'fetch-gstr2b-json': handleBgFetch,
    'fetch-gstr3b-json': handleBgFetch,
    'fetch-gstr1-json': handleBgFetch,
    // Warmup ping: popup sends this on DOMContentLoaded to pre-wake the SW event loop
    // and pre-resolve the auth token so the first real request pays no cold-start penalty.
    'ping': (_m, _s, sr) => {
      // Fire-and-forget: pre-resolve auth token into in-memory cache while we have the event loop
      resolveAuthToken({}).catch(() => {});
      if (sr) sr({ success: true, status: 'ready', ts: Date.now() });
      return false;
    },
    'get-background-telemetry': (_m, _s, sr) => {
      const logs = (typeof rpLog !== 'undefined' && rpLog && typeof rpLog.getHistory === 'function')
        ? rpLog.getHistory()
        : [];
      if (sr) {
        sr({
          success: true,
          logs: logs,
          rpLogs: (typeof rpLogs !== 'undefined' ? rpLogs.slice(-200) : [])
        });
      }
      return false;
    },
    'clear-background-telemetry': (_m, _s, sr) => {
      if (typeof rpLog !== 'undefined' && rpLog && typeof rpLog.clearHistory === 'function') {
        rpLog.clearHistory();
      }
      if (typeof rpLogs !== 'undefined' && Array.isArray(rpLogs)) {
        rpLogs.length = 0;
      }
      if (sr) sr({ success: true });
      return false;
    },
    'rp-telemetry-log': (m, _s, sr) => {
      if (m && typeof rpLog !== 'undefined' && rpLog) {
        const fn = rpLog[m.level] || rpLog.info;
        fn.call(rpLog, m.tag || 'CONTENT', m.message || '', m.details);
      }
      if (sr) sr({ success: true });
      return false;
    },
    'record-portal-manual-download': (m, _s, sr) => {
      lastManualPortalAction = {
        returnType: m.returnType || 'GSTR3B',
        period: m.period || '',
        gstin: m.gstin || '',
        timestamp: Date.now()
      };
      if (typeof rpLog !== 'undefined' && rpLog) {
        rpLog.userAction('PORTAL_MANUAL_DOWNLOAD_CLICK', `User clicked manual download for ${m.returnType || 'GSTR3B'} (Period: ${m.period || 'current'}, GSTIN: ${m.gstin || 'current'})`, m);
      }
      if (sr) sr({ success: true });
      return false;
    }
  };
  const smallHandler = SMALL_MESSAGE_HANDLERS[msg.request] || SMALL_MESSAGE_HANDLERS[msg.action];
  if (smallHandler) return smallHandler(msg, sender, sendResponse);

  // All other message types are silently ignored

});

// ═════════════════════════════════════════════════════════════
//  EXTERNAL MESSAGE LISTENER (OctaGST Pattern for kasyhq.com)
// ═════════════════════════════════════════════════════════════
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessageExternal) {
  chrome.runtime.onMessageExternal.addListener(function (msg, sender, sendResponse) {
    if (msg && (msg.request || msg.method || msg.type)) {
      const normalizedRequest = msg.request || 
        (msg.type === 'SYNC_USER_EMAIL' ? 'sync-user-email' : 
        (msg.type === 'GET_EXTENSION_INFO' ? 'get-extension-info' :
        (msg.method === 'DOWNLOAD' ? 'download-url' : 
        (msg.method === 'HELLO' ? 'ping' : (msg.method ? 'bg-fetch' : '')))));
      const normalizedMsg = { ...msg, request: normalizedRequest };

      if (normalizedRequest === 'ping') {
        const manifest = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) ? chrome.runtime.getManifest() : null;
        sendResponse({ success: true, version: manifest ? manifest.version : '4.2.5', status: 'ready' });
        return false;
      }

      if (normalizedRequest === 'get-extension-info') {
        const manifest = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) ? chrome.runtime.getManifest() : null;
        chrome.storage.local.get(['rp_user_email', 'rp_license_data', 'rp_saved_accounts'], (stored) => {
          sendResponse({
            success: true,
            version: manifest ? manifest.version : '4.2.5',
            email: stored?.rp_user_email || '',
            tier: stored?.rp_license_data?.tier || 'FREE',
            accountCount: Array.isArray(stored?.rp_saved_accounts) ? stored.rp_saved_accounts.length : 0
          });
        });
        return true;
      }

      const smallHandler = SMALL_MESSAGE_HANDLERS[normalizedMsg.request] || SMALL_MESSAGE_HANDLERS[normalizedMsg.action];
      if (smallHandler) {
        return smallHandler(normalizedMsg, sender, sendResponse);
      }
    }
    sendResponse({ success: false, error: 'Unhandled external message' });
    return false;
  });
}

let cachedAuthToken = null;
let cachedAuthTokenTs = 0;
const AUTH_TOKEN_CACHE_TTL = 2000; // 2-second short burst cache only (never survives tab/client switches)
let _resolveAuthTokenPromise = null;

async function resolveAuthToken(msg) {
  const t2 = performance.now();
  let token = msg.at;
  if (!token && msg.headers && msg.headers['at']) {
    token = msg.headers['at'];
  }
  if (token) {
    msg._authDurationMs = 0;
    return token;
  }
  // Return cached token if fresh (avoids async lookups per request)
  if (cachedAuthToken && (Date.now() - cachedAuthTokenTs < AUTH_TOKEN_CACHE_TTL)) {
    const elapsedAuth = Math.round(performance.now() - t2);
    console.log(`[RP_TIMING] T2→T3 AUTH: cache hit in ${elapsedAuth}ms`);
    if (typeof self !== 'undefined' && self.rpLog && typeof self.rpLog.timing === 'function') {
      self.rpLog.timing('T2→T3 AUTH', `cache hit in ${elapsedAuth}ms`, { elapsedAuth, cached: true });
    }
    msg._authDurationMs = elapsedAuth;
    return cachedAuthToken;
  }

  // Coalesce inflight resolution so concurrent requests share a single probe
  if (_resolveAuthTokenPromise) {
    const sharedToken = await _resolveAuthTokenPromise;
    const elapsedAuth = Math.round(performance.now() - t2);
    msg._authDurationMs = elapsedAuth;
    return sharedToken;
  }

  _resolveAuthTokenPromise = (async () => {
    let resolvedToken = null;
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
        try {
          const tSS = performance.now();
          const stored = await chrome.storage.session.get('gst_auth_token');
          console.log(`[RP_TIMING] AUTH session.get took ${Math.round(performance.now() - tSS)}ms, found=${!!(stored && stored.gst_auth_token)}`);
          if (stored && stored.gst_auth_token) {
            resolvedToken = stored.gst_auth_token;
          }
        } catch (err) {
          console.debug('[ReturnPilot] Auth-token session-storage probe failed:', err.message);
        }
      }

      if (!resolvedToken && typeof chrome !== 'undefined' && chrome.cookies) {
        try {
          const tCk = performance.now();
          const targetUrls = [msg.url, 'https://services.gst.gov.in', 'https://return.gst.gov.in'].filter(Boolean);
          const cookieProbes = targetUrls.map(u => 
            chrome.cookies.get({ url: u, name: 'AuthToken' }).catch(() => null)
          );
          const results = await Promise.all(cookieProbes);
          const matched = results.find(c => c && c.value);
          console.log(`[RP_TIMING] AUTH parallel cookies took ${Math.round(performance.now() - tCk)}ms, found=${!!matched}`);
          if (matched && matched.value) {
            resolvedToken = matched.value;
          }
        } catch (e) {
          console.warn('Failed to read AuthToken cookie:', e.message);
        }
      }

      if (resolvedToken) {
        cachedAuthToken = resolvedToken;
        cachedAuthTokenTs = Date.now();
      }
      return resolvedToken;
    } finally {
      _resolveAuthTokenPromise = null;
    }
  })();

  const tokenResult = await _resolveAuthTokenPromise;
  const totalAuth = Math.round(performance.now() - t2);
  console.log(`[RP_TIMING] T2→T3 AUTH: total resolveAuthToken took ${totalAuth}ms, tokenFound=${!!tokenResult}`);
  if (typeof self !== 'undefined' && self.rpLog && typeof self.rpLog.timing === 'function') {
    self.rpLog.timing('T2→T3 AUTH', `total resolveAuthToken took ${totalAuth}ms, tokenFound=${!!tokenResult}`, { totalAuth, tokenFound: !!tokenResult });
  }
  msg._authDurationMs = totalAuth;
  return tokenResult;
}

const _inflightFetches = new Map();
const _swGetCache = new Map();
const SW_CACHE_TTL_MS = 60000; // 60-second in-memory cache for repeated idempotent metadata

async function handleFetch(msg) {
  const isGet = (!msg.method || msg.method === 'GET') && !msg.body && !msg.responseType;
  const cacheKey = msg.url || '';

  // Invalidate in-memory cache on generation triggers (flag=1)
  if (isGet && cacheKey && cacheKey.includes('/returns/auth/api/offline/download/generate') && cacheKey.includes('flag=1')) {
    const flag0Key = cacheKey.replace('flag=1', 'flag=0');
    _swGetCache.delete(flag0Key);
    _swGetCache.delete(cacheKey);
  }

  // 1. Fast SW in-memory cache (0ms) - only for idempotent offline generation polling, NEVER for profile detail or dropdown!
  if (isGet && cacheKey) {
    const isCacheable = !msg.bypassCache && (
      (cacheKey.includes('/returns/auth/api/offline/download/generate') && cacheKey.includes('flag=0'))
    );
    if (isCacheable && _swGetCache.has(cacheKey)) {
      const entry = _swGetCache.get(cacheKey);
      if (Date.now() - entry.ts < SW_CACHE_TTL_MS) {
        return { ...entry.data, _fromSwCache: true };
      }
    }

    // 2. Single-flight coalescing: share in-flight socket to protect Oracle connection limit
    if (!msg.bypassCache && _inflightFetches.has(cacheKey)) {
      return await _inflightFetches.get(cacheKey);
    }
  }

  const fetchPromise = _handleFetchInternal(msg);

  if (isGet && cacheKey && !msg.bypassCache) {
    _inflightFetches.set(cacheKey, fetchPromise);
  }

  try {
    const result = await fetchPromise;
    if (isGet && cacheKey && result && result.status) {
      const isCacheable = !msg.bypassCache && (
        (cacheKey.includes('/returns/auth/api/offline/download/generate') && cacheKey.includes('flag=0'))
      );
      if (isCacheable) {
        _swGetCache.set(cacheKey, { ts: Date.now(), data: result });
      }
    }
    return result;
  } finally {
    if (isGet && cacheKey) {
      _inflightFetches.delete(cacheKey);
    }
  }
}

async function _handleFetchInternal(msg) {
  // Log path only — query strings may contain gstin / tokens
  try {
    new URL(msg.url);
  } catch (_) {
  }

  const MAX_RETRIES = 3;
  let attempt = 0;

  while (attempt < MAX_RETRIES) {
    attempt++;
    try {
      const headers = { 
        'Accept': msg.accept || msg.headers?.['Accept'] || 'application/json, text/plain, */*',
        ...msg.headers
      };
      if (msg.contentType) {
        headers['Content-Type'] = msg.contentType;
      } else if (msg.body && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json;charset=UTF-8';
      }
      const authToken = await resolveAuthToken(msg);
      if (authToken) {
        headers['at'] = authToken;
      }

      const fetchOptions = {
        method     : msg.method || 'GET',
        credentials: 'include',
        redirect   : 'follow',
        headers
      };
      if (msg.body) {
        fetchOptions.body = typeof msg.body === 'object' ? JSON.stringify(msg.body) : msg.body;
      }

      console.log(`[bg-fetch] Fetching ${msg.url} (Attempt ${attempt}/${MAX_RETRIES})...`, { method: fetchOptions.method, hasAuthToken: !!authToken });
      const t4 = performance.now();
      console.log(`[RP_TIMING] T4 BG_FETCH_START: fetch() fired for ${msg.url}`);
      if (typeof self !== 'undefined' && self.rpLog && typeof self.rpLog.timing === 'function') {
        self.rpLog.timing('T4 BG_FETCH_START', `fetch() fired for ${msg.url}`);
      }
      const effectiveTimeout = msg.timeoutMs || 30000;
      const resp = await fetchWithTimeout(msg.url, fetchOptions, effectiveTimeout);
      const t5 = performance.now();
      const ttfbMs = Math.round(t5 - t4);
      console.log(`[RP_TIMING] T5 BG_FETCH_DONE: ${resp.status} (TTFB: ${ttfbMs}ms) for ${msg.url}`);
      if (typeof self !== 'undefined' && self.rpLog && typeof self.rpLog.timing === 'function') {
        self.rpLog.timing('T5 BG_FETCH_DONE', `${resp.status} (TTFB: ${ttfbMs}ms) for ${msg.url}`, { ttfbMs, status: resp.status });
      }
      console.log(`[bg-fetch] ← HTTP ${resp.status} ${resp.statusText} from ${resp.url}`);

      // If server error (500-599), retry with backoff unless it's the last attempt
      if (resp.status >= 500 && resp.status <= 599 && attempt < MAX_RETRIES) {
        console.warn(`[bg-fetch] Server returned status ${resp.status}. Retrying (Attempt ${attempt}/${MAX_RETRIES})...`);
        const errDelay = attempt * 1000;
        await new Promise(r => setTimeout(r, errDelay));
        continue;
      }

      const respAt = resp.headers.get('at') || null;
      if (respAt) {
        console.log(`[bg-fetch] 🔑 Captured new 'at' token from response headers: ${respAt.substring(0, 16)}...`);
        cachedAuthToken = respAt;
        cachedAuthTokenTs = Date.now();
      }

      // ── Handle binary buffer / blob response ───────────────
      if (msg.responseType === 'buffer' || msg.responseType === 'blob') {
        const tDlStart = performance.now();
        const buffer = await resp.arrayBuffer();
        const dlMs = Math.round(performance.now() - tDlStart);
        const netTotalMs = Math.round(performance.now() - t4);
        const bytes = new Uint8Array(buffer);
        const CHUNK = 0x8000; // 32KB chunking
        let binary = '';
        for (let i = 0; i < bytes.length; i += CHUNK) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CHUNK, bytes.length)));
        }
        const bufferBase64 = btoa(binary);
        console.log(`[bg-fetch] ← Binary buffer fetched (${bytes.length} bytes, DL: ${dlMs}ms)`);
        return {
          status     : resp.ok,
          statusCode : resp.status,
          response   : bufferBase64,
          bytesb64   : bufferBase64,
          responseUrl: resp.url,
          at         : respAt,
          _timingAuthMs: msg._authDurationMs,
          _timingNetworkMs: netTotalMs,
          _timingTtfbMs: ttfbMs,
          _timingDownloadMs: dlMs,
          _payloadBytes: bytes.length
        };
      }

      const tDlStart = performance.now();
      const text = await resp.text();
      const dlMs = Math.round(performance.now() - tDlStart);
      const netTotalMs = Math.round(performance.now() - t4);
      console.log(`[bg-fetch] ← Response text received (${text.length} chars, DL: ${dlMs}ms):`, text.substring(0, 150));

      // ── Detect silent HTML redirects (sample head only to prevent large memory clones) ──
      const headSample = text.substring(0, 256).trim().toLowerCase();
      const isHtml = headSample.startsWith('<!doctype') || headSample.startsWith('<html');

      if ((resp.redirected && resp.url.includes('/error/')) || isHtml) {
        console.warn('[bg-fetch] ← Redirect or HTML response received — session likely expired or access denied');
        return {
          status     : false,
          statusCode : resp.redirected ? 302 : resp.status,
          error      : 'Session expired or access denied (redirected)',
          response   : null,
          responseUrl: resp.url,
          at         : respAt,
          _timingAuthMs: msg._authDurationMs,
          _timingNetworkMs: netTotalMs,
          _timingTtfbMs: ttfbMs,
          _timingDownloadMs: dlMs,
          _payloadBytes: text.length
        };
      }

      return {
        status     : resp.ok,
        ok         : resp.ok,
        statusCode : resp.status,
        statusText : resp.statusText,
        response   : text,
        body       : text,
        responseUrl: resp.url,
        location   : resp.url,
        at         : respAt || cachedAuthToken,
        _timingAuthMs: msg._authDurationMs,
        _timingNetworkMs: netTotalMs,
        _timingTtfbMs: ttfbMs,
        _timingDownloadMs: dlMs,
        _payloadBytes: text.length
      };

    } catch (err) {
      console.error(`[bg-fetch] Attempt ${attempt} error:`, err.message);
      if (attempt < MAX_RETRIES) {
        const isAbort = err.name === 'AbortError' || (err.message && err.message.toLowerCase().includes('abort'));
        const retryDelay = isAbort ? 150 : (attempt * 1000);
        await new Promise(r => setTimeout(r, retryDelay));
        continue;
      }
      return { status: false, statusCode: 0, error: err.message, response: null };
    }
  }
}

async function handleFetchBinary(msg) {

  // Log path only — binary URLs may contain signed tokens
  try {
    new URL(msg.url);
  } catch (_) {
  }

  const MAX_RETRIES = 3;
  let attempt = 0;

  while (attempt < MAX_RETRIES) {
    attempt++;
    const TIMEOUT_MS = 25000;
    const controller = new AbortController();
    const timer      = setTimeout(() => {
      try {
        controller.abort(new Error('Binary download timed out after ' + TIMEOUT_MS + 'ms'));
      } catch (_) {
        controller.abort();
      }
    }, TIMEOUT_MS);

    try {
      const isReturnSubdomain = msg.url && msg.url.includes('return.gst.gov.in');
      const headers = {
        'Referer': isReturnSubdomain 
            ? 'https://return.gst.gov.in/returns/auth/dashboard' 
            : 'https://services.gst.gov.in/services/auth/notices',
        'Accept': 'application/json, text/plain, */*',
        'clientid': 'l7xx76985121404c449bb89c685bf2d8e03e',
        'client_id': 'l7xx76985121404c449bb89c685bf2d8e03e',
        ...msg.headers
      };
      
      const authToken = await resolveAuthToken(msg);
      if (authToken) {
        headers['at'] = authToken;
      }

      const resp = await fetch(msg.url, {
        method     : 'GET',
        credentials: 'include',
        headers,
        signal     : controller.signal
      });

      clearTimeout(timer);

      // If server error, retry with backoff unless it's the last attempt
      if (resp.status >= 500 && resp.status <= 599 && attempt < MAX_RETRIES) {
        console.warn(`[bg-fetch-binary] Server returned status ${resp.status}. Retrying (Attempt ${attempt}/${MAX_RETRIES})...`);
        await new Promise(r => setTimeout(r, attempt * 1000));
        continue;
      }


      if (!resp.ok) {
        return {
          status    : false,
          statusCode: resp.status,
          error     : `HTTP ${resp.status}`,
          response  : null,
          at        : resp.headers.get('at') || null
        };
      }

      const buffer = await resp.arrayBuffer();
      const bytes  = new Uint8Array(buffer);

      // ── Generic Binary Signature Validation ───────────────────
      let isValidBinary = false;
      
      if (bytes.length >= 4) {
        const isPDF = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46; // %PDF
        const isZIP = bytes[0] === 0x50 && bytes[1] === 0x4B && bytes[2] === 0x03 && bytes[3] === 0x04; // PK\x03\x04
        
        if (isPDF || isZIP) {
          isValidBinary = true;
        }
      }

      // If the file is not a known binary format, analyze the payload for GST portal errors
      if (!isValidBinary) {
        let sampleText = '';
        try {
          sampleText = new TextDecoder('utf-8').decode(bytes.subarray(0, 300));
        } catch (_) {}
        
        console.error('[bg-fetch-binary] Invalid binary signature. Content sample:', sampleText);
        
        let errorMsg = 'Invalid file format returned by GST Portal. Expected PDF or ZIP.';
        const lowerSample = sampleText.toLowerCase();
        
        if (lowerSample.includes('request rejected')) {
          errorMsg = 'GST Portal WAF blocked the request (Request Rejected).';
        } else if (lowerSample.includes('session expired') || lowerSample.includes('login') || lowerSample.includes('<!doctype') || lowerSample.includes('<html')) {
          errorMsg = 'Your GST Portal session has expired or access was denied. Please log in again.';
        }
        
        return {
          status    : false,
          statusCode: 200,
          error     : errorMsg,
          response  : null,
          at        : resp.headers.get('at') || null
        };
      }

      // ── Convert to base64 in chunks ───────────────────────
      const CHUNK  = 4096;
      let   binary = '';
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(
          ...bytes.subarray(i, Math.min(i + CHUNK, bytes.length))
        );
      }
      const base64 = btoa(binary);

      return {
        status    : true,
        statusCode: resp.status,
        response  : base64,
        size      : bytes.length,
        at        : resp.headers.get('at') || null
      };

    } catch (err) {
      clearTimeout(timer);

      if (err.name === 'AbortError') {
        console.error('[bg-fetch-binary] Timed out after', TIMEOUT_MS, 'ms');
        if (attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, attempt * 1000));
          continue;
        }
        return {
          status    : false,
          statusCode: 0,
          error     : `Download timed out after ${TIMEOUT_MS / 1000}s — the GST file server is slow. Please try again.`,
          response  : null
        };
      }

      console.error(`[bg-fetch-binary] Attempt ${attempt} error:`, err.message);
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, attempt * 1000));
        continue;
      }
      return { status: false, statusCode: 0, error: err.message, response: null };
    }
  }
}



// ═════════════════════════════════════════════════════════════
//  FILE DOWNLOAD (Fixed for Background Service Worker)
// ═════════════════════════════════════════════════════════════



function createDownloadBlobUrl(base64Data, mime) {
  const binaryString = atob(base64Data.replace(/\s/g, ''));
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: mime });
  return URL.createObjectURL(blob);
}

async function handleDownloadFile(msg) {
  const { fileName, mimeType, base64 } = msg;

  if (!fileName || !mimeType || !base64) {
    console.warn('[ReturnPilot SW ⚠️ handleDownloadFile] Incomplete payload:', { fileName, mimeType, hasBase64: !!base64 });
    return { success: false, error: 'Missing fileName, mimeType or base64' };
  }

  try {
    let pureBase64 = base64;
    if (base64.includes(',')) pureBase64 = base64.split(',')[1];

    let cleanMime = String(mimeType || 'application/octet-stream').split(';')[0].trim().toLowerCase();
    if (!cleanMime || cleanMime === 'text/html' || cleanMime === 'text/plain') {
      if (fileName.toLowerCase().endsWith('.zip')) cleanMime = 'application/zip';
      else if (fileName.toLowerCase().endsWith('.pdf')) cleanMime = 'application/pdf';
      else if (fileName.toLowerCase().endsWith('.xlsx')) cleanMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      else if (fileName.toLowerCase().endsWith('.json')) cleanMime = 'application/json';
    }

    const isFirefoxEnv = (typeof navigator !== 'undefined' && /firefox/i.test(navigator.userAgent)) ||
                         (typeof browser !== 'undefined' && typeof browser.runtime?.getBrowserInfo === 'function');

    let downloadUrl = `data:${cleanMime};base64,${pureBase64}`;
    let cleanupBlobUrl = null;

    if (isFirefoxEnv && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
      try {
        downloadUrl = createDownloadBlobUrl(pureBase64, cleanMime);
        cleanupBlobUrl = downloadUrl;
      } catch (blobErr) {
        console.warn('[ReturnPilot SW] Blob URL generation fallback:', blobErr);
      }
    }

    const baseName = fileName.split(/[\/\\]/).pop().split('?')[0].replace(/[\\/:*?"<>|]/g, '_');
    const safeFileName = buildFolderDownloadPath(msg.gstin, msg.returnType, msg.period, baseName, msg.fy);

    console.log(`%c[ReturnPilot SW 🚀 chrome.downloads.download] Preparing:`, 'color: #8b5cf6; font-weight: bold;', {
      targetFile: safeFileName,
      mimeType: cleanMime,
      bytesEstimate: Math.round(pureBase64.length * 0.75),
      gstin: msg.gstin,
      period: msg.period
    });

    return new Promise((resolve) => {
      chrome.downloads.download({
        url: downloadUrl,
        filename: safeFileName,
        saveAs: false 
      }, (downloadId) => {
        if (cleanupBlobUrl) {
          setTimeout(() => {
            try { URL.revokeObjectURL(cleanupBlobUrl); } catch (_) {}
          }, 60000);
        }
        if (chrome.runtime.lastError) {
          console.error(`[ReturnPilot SW ❌ chrome.downloads.download Error]:`, chrome.runtime.lastError.message);
          resolve({ success: false, error: chrome.runtime.lastError.message });
          return;
        }
        if (downloadId) {
          console.log(`%c[ReturnPilot SW 🏁 chrome.downloads.download Dispatched]`, 'color: #10b981; font-weight: bold;', {
            downloadId: downloadId,
            filename: safeFileName
          });
          DownloadRegistry.set(downloadId, {
            filename: safeFileName,
            timestamp: Date.now()
          });
        }
        resolve({ success: true, downloadId, fileName: safeFileName });
      });
    });
  } catch (err) {
    console.error(`[ReturnPilot SW ❌ handleDownloadFile Exception]:`, err);
    return { success: false, error: err.message };
  }
}

// ═════════════════════════════════════════════════════════════
//  GLOBAL DOWNLOAD INTERCEPTOR (Safety Net)
// ═════════════════════════════════════════════════════════════

if (typeof chrome !== 'undefined' && chrome.downloads && chrome.downloads.onDeterminingFilename && typeof chrome.downloads.onDeterminingFilename.addListener === 'function') {
  chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
    try {
      const isOurExtension = item.byExtensionId === chrome.runtime.id;
      const isPortalDownload = (item.url && (item.url.includes('gst.gov.in') || item.url.startsWith('blob:'))) ||
                               (item.referrer && item.referrer.includes('gst.gov.in'));
      var rawFilename = (item.filename || '').split(/[\/\\]/).pop().split('?')[0];

      console.log('[ReturnPilot BG onDeterminingFilename]', {
        id: item.id,
        filename: item.filename,
        rawFilename,
        url: (item.url || '').substring(0, 100),
        byExtensionId: item.byExtensionId,
        isOurExtension,
        isPortalDownload
      });

      /* 1. Primary: Look up by download ID (reliable numeric key) */
      if (DownloadRegistry.has(item.id)) {
        var entry = DownloadRegistry.get(item.id);
        var exactName = typeof entry === 'object' ? (entry.filename || entry.targetFilename) : entry;
        DownloadRegistry.delete(item.id);
        if (exactName && typeof exactName === 'string' && exactName.trim()) {
          console.log('[ReturnPilot BG onDeterminingFilename] Matched by download ID ->', exactName);
          if (typeof rpLog !== 'undefined' && rpLog) {
            rpLog.userAction('DOWNLOAD_NAME', `Matched download ID #${item.id} -> "${exactName}" (conflictAction: overwrite)`);
          }
          suggest({ filename: exactName.trim(), conflictAction: 'overwrite' });
          return;
        }
      }

      /* 2. Secondary: Look up by URL */
      if (DownloadRegistry.has(item.url)) {
        var entry = DownloadRegistry.get(item.url);
        var exactName = typeof entry === 'object' ? (entry.filename || entry.targetFilename) : entry;
        DownloadRegistry.delete(item.url);
        if (exactName && typeof exactName === 'string' && exactName.trim()) {
          console.log('[ReturnPilot BG onDeterminingFilename] Matched by URL ->', exactName);
          if (typeof rpLog !== 'undefined' && rpLog) {
            rpLog.userAction('DOWNLOAD_NAME', `Matched by URL -> "${exactName}" (conflictAction: overwrite)`);
          }
          suggest({ filename: exactName.trim(), conflictAction: 'overwrite' });
          return;
        }
      }

      /* 3. Raw portal filename match in registry (e.g. GSTR_3B.pdf, GSTR3B.pdf) */
      if (rawFilename && DownloadRegistry.has(rawFilename)) {
        var entry = DownloadRegistry.get(rawFilename);
        var exactName = typeof entry === 'object' ? (entry.filename || entry.targetFilename) : entry;
        DownloadRegistry.delete(rawFilename);
        if (exactName && typeof exactName === 'string' && exactName.trim()) {
          console.log('[ReturnPilot BG onDeterminingFilename] Matched raw portal filename ->', exactName);
          if (typeof rpLog !== 'undefined' && rpLog) {
            rpLog.userAction('DOWNLOAD_NAME', `Matched raw portal filename "${rawFilename}" -> "${exactName}" (conflictAction: overwrite)`);
          }
          suggest({ filename: exactName.trim(), conflictAction: 'overwrite' });
          return;
        }
      }

      /* 4. Active in-flight Return Engine Match (GSTR-3B, GSTR-1, GSTR-1A, GSTR-9, GSTR-2B) */
      const isPdf = (item.mime === 'application/pdf') || rawFilename.toLowerCase().endsWith('.pdf');
      if (isPdf || (item.url && item.url.startsWith('blob:'))) {
        let activeKey = null;
        if (/GSTR[-_]?3B/i.test(rawFilename) || rawFilename.toLowerCase() === 'gstr_3b.pdf' || rawFilename.toLowerCase() === 'gstr3b.pdf') {
          activeKey = 'ACTIVE_GSTR3B';
        } else if (/GSTR[-_]?1A/i.test(rawFilename) || /GSTR1and1A/i.test(rawFilename)) {
          activeKey = 'ACTIVE_GSTR1A';
        } else if (/GSTR[-_]?1/i.test(rawFilename)) {
          activeKey = 'ACTIVE_GSTR1';
        } else if (/GSTR[-_]?9/i.test(rawFilename)) {
          activeKey = 'ACTIVE_GSTR9';
        } else if (/GSTR[-_]?2B/i.test(rawFilename)) {
          activeKey = 'ACTIVE_GSTR2B';
        }

        if (activeKey && DownloadRegistry.has(activeKey)) {
          const entry = DownloadRegistry.get(activeKey);
          DownloadRegistry.delete(activeKey);
          const targetName = entry.filename || entry.targetFilename;
          if (targetName && typeof targetName === 'string' && targetName.trim()) {
            console.log(`[ReturnPilot BG onDeterminingFilename] Mapped in-flight ${activeKey} download "${rawFilename}" ->`, targetName);
            if (typeof rpLog !== 'undefined' && rpLog) {
              rpLog.userAction('DOWNLOAD_NAME', `Mapped in-flight ${activeKey} download "${rawFilename}" -> "${targetName}" (conflictAction: overwrite)`);
            }
            suggest({ filename: targetName.trim(), conflictAction: 'overwrite' });
            return;
          }
        }
      }

      /* 5. Manual Portal Downloads: Never intercept or rename. Let official GST downloads pass through 100% untouched. */
      lastManualPortalAction = null;

      /* 6. Extension-file match by extension type */
      if (isOurExtension && DownloadRegistry.size > 0) {
        var itemExt = (rawFilename || '').split('.').pop().toLowerCase();
        var matched = null;
        var matchedKey = null;

        for (var [key, entry] of DownloadRegistry.entries()) {
          var regName = typeof entry === 'object' ? (entry.filename || entry.targetFilename) : entry;
          var regExt = (regName || '').split('.').pop().toLowerCase();
          if (itemExt && regExt && itemExt === regExt) {
            matched = regName;
            matchedKey = key;
            break;
          }
        }

        if (matched && typeof matched === 'string' && matched.trim()) {
          DownloadRegistry.delete(matchedKey);
          console.log('[ReturnPilot BG onDeterminingFilename] Matched by extension ->', matched);
          if (typeof rpLog !== 'undefined' && rpLog) {
            rpLog.userAction('DOWNLOAD_NAME', `Matched by extension -> "${matched}" (conflictAction: overwrite)`);
          }
          suggest({ filename: matched.trim(), conflictAction: 'overwrite' });
          return;
        }
      }

      /* 7. Pass through: zero artificial subfolder rewriting or renaming */

      /* 8. If generic or non-return download, pass through unchanged */
      console.log('[ReturnPilot BG onDeterminingFilename] Normal download passed through unchanged ->', item.filename);
      suggest();
    } catch (err) {
      console.error('[ReturnPilot BG onDeterminingFilename Error]', err);
      suggest();
    }
  });
}

// ═════════════════════════════════════════════════════════════
//  REAL-TIME DOWNLOAD LIFECYCLE MONITOR (SW Logger & Telemetry)
// ═════════════════════════════════════════════════════════════

if (typeof chrome !== 'undefined' && chrome.downloads) {
  if (chrome.downloads.onCreated && typeof chrome.downloads.onCreated.addListener === 'function') {
    chrome.downloads.onCreated.addListener((item) => {
      const isOurExt = item.byExtensionId === chrome.runtime?.id;
      const isPortal = (item.url && (item.url.includes('gst.gov.in') || item.url.startsWith('blob:'))) ||
                       (item.referrer && item.referrer.includes('gst.gov.in'));
      ActiveDownloadsMap.set(item.id, {
        id: item.id,
        filename: item.filename,
        mime: item.mime,
        url: item.url,
        isOurExtension: isOurExt,
        isPortal,
        startTime: Date.now()
      });

      console.log(`%c[ReturnPilot SW 📥 Download Created] #ID: ${item.id}`, 'color: #3b82f6; font-weight: bold;', {
        filename: item.filename,
        mime: item.mime,
        totalBytes: item.totalBytes,
        state: item.state,
        isOurExtension: isOurExt,
        isPortal,
        url: (item.url || '').slice(0, 100)
      });

      if (typeof rpLog !== 'undefined' && rpLog) {
        const originDesc = isOurExt ? 'Extension download' : (isPortal ? 'User manual GST portal download' : 'External download');
        rpLog.userAction('DOWNLOAD_CREATED', `[#${item.id}] ${originDesc} initiated: "${item.filename || 'download'}" (${item.mime || 'unknown mime'})`, {
          downloadId: item.id,
          filename: item.filename,
          mime: item.mime,
          isOurExtension: isOurExt,
          isPortal
        });
      }
    });
  }

  if (chrome.downloads.onChanged && typeof chrome.downloads.onChanged.addListener === 'function') {
    chrome.downloads.onChanged.addListener((delta) => {
      if (delta.state) {
        if (delta.state.current === 'complete') {
          const reg = DownloadRegistry.get(delta.id);
          const act = ActiveDownloadsMap.get(delta.id);
          const dlDurationMs = (reg?.timestamp || act?.startTime) ? Math.max(1, Date.now() - (reg?.timestamp || act?.startTime)) : 0;
          const finalFilename = delta.filename?.current || reg?.filename || act?.filename || 'download';
          const isManual = act ? (!act.isOurExtension && act.isPortal) : false;

          const recordCompletion = (sizeOnDisk) => {
            const actualSize = sizeOnDisk || delta.fileSize?.current || act?.fileSize || 0;
            const sizeKb = (actualSize / 1024).toFixed(1);
            const speedKBps = (dlDurationMs > 0 && actualSize > 0) ? ((actualSize / 1024) / (dlDurationMs / 1000)).toFixed(1) : null;

            console.log(`%c[ReturnPilot SW ✅ Download Complete] #ID: ${delta.id} | "${finalFilename}" | ${actualSize} bytes (${sizeKb} KB) in ${dlDurationMs}ms (${speedKBps ? speedKBps + ' KB/s' : '—'})`, 'color: #10b981; font-weight: bold;', {
              filename: finalFilename,
              fileSize: actualSize,
              durationMs: dlDurationMs,
              speedKBps: speedKBps,
              endTime: delta.endTime?.current,
              isManual
            });

            if (typeof rpLog !== 'undefined' && rpLog) {
              const label = isManual ? '[USER MANUAL PORTAL DOWNLOAD COMPLETE]' : '[DOWNLOAD COMPLETE]';
              rpLog.userAction('DOWNLOAD_COMPLETE', `[#${delta.id}] ${label} "${finalFilename}" completed in ${dlDurationMs}ms (${sizeKb} KB${speedKBps ? ` @ ${speedKBps} KB/s` : ''})`, {
                downloadId: delta.id,
                filename: finalFilename,
                fileSize: actualSize,
                dlDurationMs,
                speedKBps,
                isManual
              });
            }
            ActiveDownloadsMap.delete(delta.id);
          };

          if (chrome.downloads && typeof chrome.downloads.search === 'function') {
            chrome.downloads.search({ id: delta.id }, (items) => {
              const item = items && items[0];
              const resolvedSize = (item && (item.fileSize > 0 ? item.fileSize : item.bytesReceived)) || 0;
              recordCompletion(resolvedSize);
            });
          } else {
            recordCompletion(delta.fileSize?.current || 0);
          }
        } else if (delta.state.current === 'interrupted') {
          const errReason = delta.error?.current || 'UNKNOWN_ERROR';
          const act = ActiveDownloadsMap.get(delta.id);
          console.error(`%c[ReturnPilot SW ❌ Download Interrupted] #ID: ${delta.id} | Reason: ${errReason}`, 'color: #ef4444; font-weight: bold;', {
            error: errReason,
            delta: delta
          });
          if (typeof rpLog !== 'undefined' && rpLog) {
            rpLog.warn('DOWNLOAD_INTERRUPTED', `[#${delta.id}] Download failed for "${act?.filename || 'download'}": ${errReason}`, {
              downloadId: delta.id,
              error: errReason
            });
          }
          ActiveDownloadsMap.delete(delta.id);
        } else {
          console.log(`[ReturnPilot SW ⏳ Download In Progress] #ID: ${delta.id} -> state: ${delta.state.current}`);
        }
      }
      if (delta.filename) {
        console.log(`[ReturnPilot SW 📁 Target Destination Path] #ID: ${delta.id} -> "${delta.filename.current}"`);
        const act = ActiveDownloadsMap.get(delta.id);
        if (act) act.filename = delta.filename.current;
      }
    });
  }
}

// ── Developer Console Helper: Test Trigger from SW DevTools ──────────────────
self.triggerTestPdfDownload = function(customName = 'Test_GSTR3B_032026.pdf') {
  console.log(`%c[ReturnPilot SW 🧪 Test Download] Invoked directly from SW console for "${customName}"...`, 'color: #f59e0b; font-weight: bold;');
  const minimalPdfB64 = 'JVBERi0xLjQKMSAwIG9iago8PAovVHlwZSAvQ2F0YWxvZwovUGFnZXMgMiAwIFIKPj4KZW5kb2JqCjIgMCBvYmoKPDwKL1R5cGUgL1BhZ2VzCi9LaWRzIFszIDAgUl0KL0NvdW50IDEKPj4KZW5kb2JqCjMgMCBvYmoKPDwKL1R5cGUgL1BhZ2UKL1BhcmVudCAyIDAgUgovTWVkaWFCb3ggWzAgMCA2MTIgNzkyXQovQ29udGVudHMgNCAwIFIKPj4KZW5kb2JqCjQgMCBvYmoKPDwKL0xlbmd0aCA1NQo+PgpzdHJlYW0KQlQKL0YxIDI0IFRmCjEwMCA3MDAgVGROCihSZXR1cm5QaWxvdCBURVNUIFBERikgVGoKRVQKZW5kc3RyZWFtCmVuZG9iagp4cmVmCjAgNQowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1OCAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCjAwMDAwMDAyMDIgMDAwMDAgbiAKdHJhaWxlcgo8PAovU2l6ZSA1Ci9Sb290IDEgMCBSCj4+CnN0YXJ0eHJlZgoyOTcKJSVFT0YK';
  return handleDownloadFile({
    fileName: customName,
    mimeType: 'application/pdf',
    base64: minimalPdfB64,
    gstin: '27AABCU9603R1ZM',
    returnType: 'GSTR3B',
    period: '032026',
    fy: '2025-26'
  });
};

// ═════════════════════════════════════════════════════════════
//  HEADLESS GST CAPTCHA & LOGIN HANDLERS
// ═════════════════════════════════════════════════════════════

let loginTabId = null;
let pendingCaptchaResolver = null;
let pendingLoginResolver = null;
let isPropagating = false;
let rpLogs = [];

function addRpLog(msg) {
  const timestamp = new Date().toLocaleTimeString();
  const formatted = `[${timestamp}] ${msg}`;
  rpLogs.push(formatted);
  console.log('[ReturnPilot BG]', formatted);
  if (typeof rpLog !== 'undefined' && rpLog && typeof rpLog.info === 'function') {
    rpLog.info('SW_CORE', msg);
  }
}

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.local.get('loginTabId', (data) => {
    const savedId = data.loginTabId || null;
    if (tabId === savedId) {
      addRpLog('Login tab was closed.');
      chrome.storage.local.remove('loginTabId');
      loginTabId = null;
      isPropagating = false;
      if (pendingCaptchaResolver) {
        pendingCaptchaResolver({ success: false, error: 'Login tab was closed.' });
        pendingCaptchaResolver = null;
      }
      if (pendingLoginResolver) {
        pendingLoginResolver({ success: false, error: 'Login tab was closed.' });
        pendingLoginResolver = null;
      }
    }
  });
});



async function propagateSessionCookies(tabId) {
  const PROPAGATION_CHAIN = [
    'https://return.gst.gov.in/returns/auth/dashboard',
    'https://fogstr4.gst.gov.in/gstr4annual/auth/gstr4'
  ];

  for (const url of PROPAGATION_CHAIN) {
    try {
      const currentTab = await chrome.tabs.get(tabId);
      const currentUrlStr = currentTab && currentTab.url ? currentTab.url : '';
      if (currentUrlStr.startsWith(url)) {
        addRpLog(`Cookies already active for ${url}. Skipping duplicate navigation.`);
        continue;
      }

      addRpLog(`Propagating cookies: Navigating to ${url}...`);
      const targetHost = new URL(url).hostname;
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          chrome.tabs.onUpdated.removeListener(listener);
          reject(new Error(`Timeout navigating to ${url}`));
        }, 15000);

        const listener = (updatedTabId, changeInfo, tab) => {
          if (updatedTabId === tabId && changeInfo.status === 'complete' && tab && tab.url && tab.url.includes(targetHost)) {
            clearTimeout(timeout);
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        };

        chrome.tabs.onUpdated.addListener(listener);
        chrome.tabs.update(tabId, { url });
      });
    } catch (e) {
      addRpLog(`Warning: Propagation to ${url} timed out or failed: ${e.message}. Continuing...`);
    }
  }
}
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  const CHUNK = 8192;
  let binary = '';
  for (let i = 0; i < len; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CHUNK, len)));
  }
  return btoa(binary);
}

async function logGstCookies(label) {
  if (chrome.cookies) {
    try {
      const cookies = await chrome.cookies.getAll({ domain: 'gst.gov.in' });
      const cookieStr = cookies.map(c => `${c.name}=${c.value.substring(0, 10)}...`).join(', ');
      addRpLog(`[Cookies - ${label}] ${cookieStr || 'None'}`);
    } catch (e) {
      addRpLog(`[Cookies - ${label}] Error: ${e.message}`);
    }
  }
}

const PROTECTED_GST_COOKIES = ['bm_sv', 'Lang', 'AuthToken'];

async function clearGstCookies() {
  if (chrome.cookies) {
    try {
      const cookies = await chrome.cookies.getAll({ domain: 'gst.gov.in' });
      for (const cookie of cookies) {
        if (PROTECTED_GST_COOKIES.includes(cookie.name) || cookie.name.startsWith('TS')) {
          addRpLog(`Skipping protected cookie during cleanup: ${cookie.name}`);
          continue;
        }
        const protocol = cookie.secure ? 'https:' : 'http:';
        const domain = cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain;
        const url = `${protocol}//${domain}${cookie.path}`;
        await chrome.cookies.remove({ url: url, name: cookie.name }).catch(() => {});
      }
      addRpLog('Successfully cleared non-essential gst.gov.in cookies.');
    } catch (e) {
      addRpLog(`Warning: Failed to clear cookies: ${e.message}`);
    }
  }
}

async function deduplicateGstSecurityCookies() {
  if (typeof chrome === 'undefined' || !chrome.cookies) return 0;
  let removedCount = 0;
  try {
    const all = await chrome.cookies.getAll({ domain: 'gst.gov.in' });
    const groups = new Map();
    for (const c of all) {
      if (!groups.has(c.name)) groups.set(c.name, []);
      groups.get(c.name).push(c);
    }

    for (const [name, list] of groups.entries()) {
      if (list.length > 1 && (name.startsWith('bm_') || name.startsWith('ak_') || name.startsWith('TS') || name === '_abck')) {
        console.warn(`[ReturnPilot BG] Found ${list.length} duplicate instances of cookie '${name}'. Cleaning up duplicates...`);
        const hasDomainCookie = list.some(c => c.domain.startsWith('.'));
        for (const c of list) {
          if (hasDomainCookie && !c.domain.startsWith('.')) {
            const proto = c.secure ? 'https:' : 'http:';
            const url = `${proto}//${c.domain}${c.path || '/'}`;
            await chrome.cookies.remove({ url, name: c.name }).catch(() => {});
            removedCount++;
            console.log(`[ReturnPilot BG] Removed duplicate host cookie: ${c.name} from ${url}`);
          }
        }
      }
    }
  } catch (e) {
    console.warn('[ReturnPilot BG] deduplicateGstSecurityCookies error:', e.message);
  }
  return removedCount;
}

let captchaPrefetchCache = null; // { base64, digits, timestamp }
let inFlightSolves = new Map(); // base64Image -> Promise

const CAPTCHA_DIRECT_ENDPOINT = 'https://verify.kasyhq.com/solve';
const CAPTCHA_WARM_ENDPOINT = 'https://verify.kasyhq.com/warm';
const CAPTCHA_TIMEOUT_MS = 25000;

let lastSolverWarmTs = 0;
let localClientSolveTimestamps = [];
const CLIENT_MAX_SOLVES_PER_MIN = 6;

async function prewarmSolverContainer() {
  const now = Date.now();
  if (now - lastSolverWarmTs < 15000) return; // Throttle to max once per 15s
  lastSolverWarmTs = now;
  try {
    // Option B: Gate strictly to verified active Premium or Trial subscribers
    const isPremium = await verifyUserSubscriptionLive(false);
    if (!isPremium) return;

    // Skip pre-warming if client is under active anti-abuse cooldown
    const cd = await new Promise(r => chrome.storage.local.get('rp_solver_cooldown_until', r));
    if (cd && cd.rp_solver_cooldown_until && now < cd.rp_solver_cooldown_until) return;

    fetch(CAPTCHA_WARM_ENDPOINT, {
      method: 'GET',
      keepalive: true,
      cache: 'no-cache'
    }).catch(() => {});
  } catch (_) {}
}

// ── Detailed captcha-solve logging ──────────────────────────────────
function captchaImgId(base64Image) {
    return (base64Image && base64Image.length)
        ? `${base64Image.length}B:${base64Image.slice(0, 10)}…`
        : 'unknown image';
}

function pushCaptchaAttempt(attempts, solver, ok, ms, digits, error) {
    if (Array.isArray(attempts)) {
        attempts.push({ solver, ok: !!ok, ms, digits: digits || null, error: error || null });
    }
}

function captchaAttemptLog(attempts, imgId, finalResult) {
  // Silent in production
}

// ── PRIMARY: Ultra-Fast Mumbai Direct Solver (Fallback: solve-text) ──
async function solveCaptchaWithVercel(base64Image, startTime, attempts) {
  const cleanImage = typeof base64Image === 'string' ? base64Image.replace(/^data:image\/[a-zA-Z]+;base64,/, '').trim() : '';
  if (!cleanImage) return { success: false, error: 'Empty captcha base64', timeMs: 0 };

  // Hard Gate: Verify subscription status before sending any request to Vercel
  const isPremium = await verifyUserSubscriptionLive(false);
  if (!isPremium) {
    return { success: false, error: 'AI CAPTCHA Auto-Fill requires an active ReturnPilot Premium or Trial subscription.', timeMs: 0 };
  }

  // 1. Check persistent cooldown from chrome.storage.local
  const cdData = await new Promise(r => chrome.storage.local.get('rp_solver_cooldown_until', r));
  const now = Date.now();
  if (cdData && cdData.rp_solver_cooldown_until && now < cdData.rp_solver_cooldown_until) {
    const remainingMins = Math.ceil((cdData.rp_solver_cooldown_until - now) / 60000);
    return {
      success: false,
      error: `CAPTCHA Auto-Fill is on an anti-abuse cooldown (${remainingMins} min remaining). Please solve manually or try again later.`,
      timeMs: 0
    };
  }

  // 2. Client-side burst protection (max 6 requests per 60 seconds)
  localClientSolveTimestamps = localClientSolveTimestamps.filter(t => (now - t) < 60000);
  if (localClientSolveTimestamps.length >= CLIENT_MAX_SOLVES_PER_MIN) {
    const cooldownUntil = now + (3600 * 1000); // 1-hour cooldown
    chrome.storage.local.set({ rp_solver_cooldown_until: cooldownUntil });
    return {
      success: false,
      error: 'Too many rapid CAPTCHA requests (exceeded 6 per minute). 1-hour anti-abuse cooldown activated.',
      timeMs: 0
    };
  }
  localClientSolveTimestamps.push(now);

  const t0 = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CAPTCHA_TIMEOUT_MS);

  try {
    const storedAuth = await new Promise(r => {
      chrome.storage.local.get(['rp_user_email', 'rp_user_profile', 'rp_license_data'], r);
    });
    const userEmail = (storedAuth?.rp_user_email || storedAuth?.rp_user_profile?.email || '').trim().toLowerCase();
    if (!userEmail) {
      return { success: false, error: 'User sign-in required for AI CAPTCHA Auto-Fill.', timeMs: 0 };
    }

    const lic = storedAuth?.rp_license_data || currentSubscriptionState || {};
    const ts = Date.now();
    const seal = lic.seal || '';
    const plan = lic.tier || lic.plan || 'PREMIUM';
    const expiresAt = lic.rawExpiresAt || (lic.expiresAt ? (typeof lic.expiresAt === 'number' ? new Date(lic.expiresAt).toISOString() : String(lic.expiresAt)) : '');

    const solvePayload = JSON.stringify({
      image: cleanImage,
      email: userEmail,
      plan: plan,
      expiresAt: expiresAt,
      seal: seal,
      ts: ts
    });

    const resp = await fetch(CAPTCHA_DIRECT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: solvePayload,
      signal: controller.signal
    });

    const durationMs = Math.round(performance.now() - t0);

    if (resp.ok) {
      const data = await resp.json().catch(() => ({}));
      const digits = (data && typeof data.digits === 'string') ? data.digits.replace(/\D/g, '') : '';

      if (data && data.success && digits.length === 6 && /^\d{6}$/.test(digits)) {
        pushCaptchaAttempt(attempts, 'Vercel /solve', true, durationMs, digits);
        return { success: true, digits: digits, timeMs: durationMs, tier: 'Vercel API' };
      }
      pushCaptchaAttempt(attempts, 'Vercel /solve', false, durationMs, null, `no 6 digits: ${JSON.stringify(data)}`);
      return { success: false, error: 'Could not recognize 6 digits from image', timeMs: durationMs };
    } else if (resp.status === 429) {
      const errData = await resp.json().catch(() => ({}));
      const cooldownSec = errData.cooldownSeconds || 3600;
      const cooldownUntil = Date.now() + (cooldownSec * 1000);
      chrome.storage.local.set({ rp_solver_cooldown_until: cooldownUntil });
      const mins = Math.ceil(cooldownSec / 60);
      const errMsg = errData.error || `Too many rapid CAPTCHA requests. 1-hour anti-abuse cooldown active (${mins} min remaining).`;
      pushCaptchaAttempt(attempts, 'Vercel /solve', false, durationMs, null, errMsg);
      return { success: false, error: errMsg, timeMs: durationMs, cooldown: true };
    } else if (resp.status === 401 || resp.status === 403) {
      const errData = await resp.json().catch(() => ({}));
      const errMsg = errData.error || 'Active ReturnPilot subscription required';
      pushCaptchaAttempt(attempts, 'Vercel /solve', false, durationMs, null, errMsg);
      // Hard stop on auth reject: do not cascade or retry
      return { success: false, error: errMsg, timeMs: durationMs };
    } else if (resp.status === 422) {
      const errData = await resp.json().catch(() => ({}));
      const errMsg = errData.error || 'Could not recognize 6 digits from image';
      pushCaptchaAttempt(attempts, 'Vercel /solve', false, durationMs, null, errMsg);
      // Model could not solve: do not cascade
      return { success: false, error: errMsg, timeMs: durationMs };
    }
  } catch (e) {
    const dur = Math.round(performance.now() - t0);
    pushCaptchaAttempt(attempts, 'Vercel /solve', false, dur, null, e.message);
  } finally {
    clearTimeout(timer);
  }

  const totalDuration = Math.round(performance.now() - t0);
  return { success: false, error: 'Could not parse 6 digits from solver', timeMs: totalDuration };
}

async function solveCaptchaWithGradioSpace(base64Image, skipCacheCheck = false) {
  if (!skipCacheCheck && captchaPrefetchCache && (Date.now() - captchaPrefetchCache.timestamp < 90000)) {
    const cachedDigits = captchaPrefetchCache.digits;
    captchaPrefetchCache = null; // Consume cache
    return { success: true, digits: cachedDigits, timeMs: 0, preflight: true };
  }
  if (!base64Image) return { success: false, error: 'No captcha base64 provided' };

  // Premium Tier Guard: Check cached state (0ms) instead of blocking on network subscription roundtrip
  const isPremium = await verifyUserSubscriptionLive(false);
  if (!isPremium) {
    return { success: false, error: 'Captcha Auto-Fill is a ReturnPilot Premium feature. Please upgrade at kasyhq.com/updates' };
  }

  if (inFlightSolves.has(base64Image)) {
    return await inFlightSolves.get(base64Image);
  }

  const solvePromise = (async () => {
    const startTime = performance.now();
    const attempts = [];
    const imgId = captchaImgId(base64Image);

    // Primary Solver: Authenticated KasyHQ Gateway API
    const gatewayRes = await solveCaptchaWithVercel(base64Image, startTime, attempts);
    if (gatewayRes.success) {
      captchaAttemptLog(attempts, imgId, gatewayRes);
      return gatewayRes;
    }

    const failRes = {
      success: false,
      error: `Vercel: ${gatewayRes.error || 'unknown'}`,
      timeMs: Math.round(performance.now() - startTime)
    };
    captchaAttemptLog(attempts, imgId, failRes);
    return failRes;
  })();

  inFlightSolves.set(base64Image, solvePromise);
  try {
    return await solvePromise;
  } finally {
    inFlightSolves.delete(base64Image);
  }
}

// Live streaming solver port for content scripts and floating sticky window
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "captcha-solver") return;
  port.onMessage.addListener((msg) => {
    (async () => {
      if (!msg || (msg.action !== "gst-solve" && msg.request !== "solve-captcha")) {
        port.postMessage({ ok: false, error: `Unknown port action: ${msg && (msg.action || msg.request)}` });
        return;
      }
      const base64Img = msg.image || msg.base64Image || msg.captchaBase64;
      if (!base64Img) {
        port.postMessage({ ok: false, error: "No image provided" });
        return;
      }

      // Premium Tier Guard: Fast cached subscription check
      const isPremium = await verifyUserSubscriptionLive(false);
      if (!isPremium) {
        port.postMessage({ ok: false, error: "Captcha Auto-Fill is a ReturnPilot Premium feature. Please upgrade at kasyhq.com/updates" });
        return;
      }

      try {
        const result = await solveCaptchaWithGradioSpace(base64Img, true);
        if (result && result.success) {
          port.postMessage({
            ok: true,
            success: true,
            digits: result.digits,
            confidence: result.confidence || 'high',
            confidenceScore: result.confidenceScore || 0.98,
            tier: result.tier || 'Vercel API Primary',
          });
        } else {
          port.postMessage({ ok: false, error: result.error || "Could not solve captcha" });
        }
      } catch (err) {
        port.postMessage({ ok: false, error: err.message || "Solver error" });
      }
    })();
  });
});

async function handleFetchCaptcha() {
  rpLogs = [];
  await clearGstCookies();
  addRpLog('Initializing direct CAPTCHA API fetch (no tabs)...');
  try {
    // 1. Establish/refresh the session context by loading the login page first
    addRpLog('Establishing session via GET services/login...');
    await fetch('https://services.gst.gov.in/services/login', {
      method: 'GET',
      credentials: 'include'
    });
    await logGstCookies('After GET login');

    // 2. Fetch the CAPTCHA image under the established session (bypass cache with rnd param)
    const rnd = Math.random();
    const url = `https://services.gst.gov.in/services/captcha?rnd=${rnd}`;
    const resp = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Accept-Language': 'en-IN,en-GB;q=0.9,en-US;q=0.8,en;q=0.7,hi;q=0.6',
        'sec-ch-ua': '"Chromium";v="148"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'image',
        'sec-fetch-mode': 'no-cors',
        'sec-fetch-site': 'same-origin',
        'Referer': 'https://services.gst.gov.in/services/login'
      }
    });

    if (!resp.ok) {
      throw new Error(`HTTP Error ${resp.status}: ${resp.statusText}`);
    }

    const contentType = resp.headers.get('content-type') || '';
    addRpLog(`Direct CAPTCHA fetch response status: ${resp.status}, Content-Type: ${contentType}`);
    await logGstCookies('After Fetch Captcha');

    if (contentType.includes('text/html')) {
      const text = await resp.text();
      if (text.trim().toLowerCase().startsWith('<!doctype') || text.trim().toLowerCase().includes('<html')) {
        throw new Error('Access denied (HTML response received from CAPTCHA API). Check internet connection.');
      }
    }

    const buffer = await resp.arrayBuffer();
    const base64 = arrayBufferToBase64(buffer);

    return {
      success: true,
      response: {
        status_cd: '1',
        data: base64
      },
      logs: rpLogs
    };
  } catch (err) {
    addRpLog(`Direct CAPTCHA fetch error: ${err.message}`);
    return { success: false, error: err.message, logs: rpLogs };
  }
}

function getMFPString() {
  const mfpObj = {
    VERSION: "2.1",
    MFP: {
      Browser: {
        UserAgent: typeof navigator !== 'undefined' ? navigator.userAgent : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
        Vendor: typeof navigator !== 'undefined' ? (navigator.vendor || "Google Inc.") : "Google Inc.",
        VendorSubID: "",
        BuildID: "20030107",
        CookieEnabled: true
      },
      IEPlugins: {},
      NetscapePlugins: {
        "PDF Viewer": "",
        "Chrome PDF Viewer": "",
        "Chromium PDF Viewer": "",
        "Microsoft Edge PDF Viewer": "",
        "WebKit built-in PDF": ""
      },
      Screen: {
        FullHeight: 1080,
        AvlHeight: 1040,
        FullWidth: 1920,
        AvlWidth: 1920,
        ColorDepth: 32,
        PixelDepth: 32
      },
      System: {
        Platform: typeof navigator !== 'undefined' ? (navigator.platform || "Win32") : "Win32",
        systemLanguage: typeof navigator !== 'undefined' ? (navigator.language || "en-IN") : "en-IN",
        Timezone: -330
      }
    },
    ExternalIP: "",
    MESC: {
      mesc: "mi=2;cd=150;id=30;mesc=1441451;mesc=1261214"
    }
  };
  return JSON.stringify(mfpObj);
}

async function handleGstLogin(username, password, captcha) {
  rpLogs = [];
  currentActiveUsername = username;
  addRpLog(`Submitting login credentials directly via API (no tabs)...`);
  try {
    const url = 'https://services.gst.gov.in/services/authenticate';
    const payload = {
      username: username,
      password: password,
      captcha: captcha,
      mFP: getMFPString(),
      deviceID: null,
      type: 'username'
    };

    addRpLog('Sending POST request to services/authenticate...');
    await logGstCookies('Before POST login');
    const resp = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-IN,en-GB;q=0.9,en-US;q=0.8,en;q=0.7,hi;q=0.6',
        'Content-Type': 'application/json;charset=UTF-8',
        'sec-ch-ua': '"Chromium";v="148"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'Referer': 'https://services.gst.gov.in'
      },
      body: JSON.stringify(payload)
    });

    const text = await resp.text();
    addRpLog(`Login response status: ${resp.status}`);

    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error(`Invalid JSON response from server: ${text.substring(0, 100)}`);
    }

    // Layer 3 fix: check only for absence of errorCode — the portal may return
    // {"status":"1"} (string) or {"message":"auth"} for success, but the only
    // reliable failure indicator is the presence of an errorCode field.
    if (data && !data.errorCode) {
      addRpLog('Login successful! Commencing silent cookie propagation...');

      // ── Extract AuthToken from authenticate Set-Cookie header ─────────────
      // The portal sets AuthToken in the Set-Cookie header of the /authenticate
      // response. Read it here directly so we have it regardless of whether
      // the cookie jar is accessible in SW context later.
      let extractedAuthToken = null;
      try {
        const setCookieHeader = resp.headers.get('set-cookie') || '';
        const atMatch = setCookieHeader.match(/(?:^|,\s*)AuthToken=([^;,]+)/i);
        if (atMatch) {
          extractedAuthToken = atMatch[1];
          addRpLog(`AuthToken extracted from Set-Cookie: ${extractedAuthToken.substring(0, 8)}...`);
        }
        // Also try reading directly from cookie store.
        // Layer 3 fix: wait 200ms — MV3 SW cookie writes are not synchronous;
        // reading immediately can return null even if the cookie was just set.
        if (!extractedAuthToken) {
          await new Promise(r => setTimeout(r, 200));
          const atCookie = await chrome.cookies.get({ url: 'https://services.gst.gov.in', name: 'AuthToken' });
          if (atCookie && atCookie.value) {
            extractedAuthToken = atCookie.value;
            addRpLog(`AuthToken read from cookie store: ${extractedAuthToken.substring(0, 8)}...`);
          }
        }
        // Persist in session storage so get-auth-token can reliably return it
        if (extractedAuthToken) {
          await chrome.storage.session.set({ gst_auth_token: extractedAuthToken });
          addRpLog('AuthToken saved to session storage.');
        } else {
          addRpLog('Warning: AuthToken not found in authenticate response or cookie store.');
        }
      } catch (e) {
        addRpLog(`Warning: Could not extract AuthToken: ${e.message}`);
      }

      // ── Propagate cookies to each subdomain — each in its own try/catch ──
      // so one failed navigation never aborts the rest.
      const propagationTargets = [
        { url: 'https://services.gst.gov.in/services/auth/fowelcome',     label: 'services/fowelcome' },
        { url: 'https://services.gst.gov.in/services/auth/notices',      label: 'services/notices (AuthToken scope)' },
        { url: 'https://return.gst.gov.in/returns/auth/dashboard',       label: 'returns/dashboard' },
        { url: 'https://gstr2b.gst.gov.in/gstr2b/auth/dashboard',        label: 'gstr2b/dashboard' },
        { url: 'https://payment.gst.gov.in/payment/auth/ledger/paymenttowardsdemand', label: 'payment/outstandingdemand' },
        { url: 'https://fogstr4.gst.gov.in/gstr4annual/auth/gstr4',      label: 'gstr4annual' },
      ];
      for (const target of propagationTargets) {
        try {
          await fetch(target.url, { method: 'GET', credentials: 'include', redirect: 'follow' });
          addRpLog(`  ✓ Propagated: ${target.label}`);
          // After hitting the notices page, re-read AuthToken if we didn't get it before
          if (target.label.includes('notices') && !extractedAuthToken) {
            try {
              const atCookie = await chrome.cookies.get({ url: 'https://services.gst.gov.in', name: 'AuthToken' });
              if (atCookie && atCookie.value) {
                extractedAuthToken = atCookie.value;
                await chrome.storage.session.set({ gst_auth_token: extractedAuthToken });
                addRpLog(`AuthToken obtained after notices navigation: ${extractedAuthToken.substring(0, 8)}...`);
              }
            } catch (_) {}
          }
        } catch (e) {
          addRpLog(`  Warning: Propagation to ${target.label} failed: ${e.message}`);
        }
      }
      addRpLog('Cookie propagation complete (services + notices + returns + gstr2b + gstr4annual).');
      Promise.all([
        // Warm up notices API scope (with 12-attempt retry loop to ensure activation)
        (async () => {
          try {
            const warmUpUsername = username;
            for (let attempt = 1; attempt <= 12; attempt++) {
              await new Promise(r => setTimeout(r, 1000)); // check every 1s
              if (currentActiveUsername !== warmUpUsername) {
                addRpLog(`BG warm-up: Aborting notices warm-up for ${warmUpUsername} because active username switched to ${currentActiveUsername}`);
                break;
              }
              
              // Re-navigate notices page to ensure scope activation
              await fetch('https://services.gst.gov.in/services/auth/notices',
                { method: 'GET', credentials: 'include', redirect: 'follow' });
              
              // Probe the actual notices API to confirm scope is active
              const noticesProbeHeaders = {
                'Content-Type': 'application/json;charset=UTF-8',
                'Accept': 'application/json, text/plain, */*',
                'Referer': 'https://services.gst.gov.in/services/auth/notices',
                'Origin': 'https://services.gst.gov.in'
              };
              if (extractedAuthToken) noticesProbeHeaders['at'] = extractedAuthToken;
              
              const probe = await fetch('https://services.gst.gov.in/services/auth/api/get/notices',
                { method: 'POST', credentials: 'include', headers: noticesProbeHeaders,
                  body: JSON.stringify({ onLoad: true }) });
              
              const probeText = await probe.text();
              const probeParsed = (() => { try { return JSON.parse(probeText); } catch(_) { return null; } })();
              
              if (probeParsed && probeParsed.errorCode === 'SWEB_8000') {
                addRpLog(`BG warm-up: Notices scope not yet active — SWEB_8000 (attempt ${attempt}/12). Retrying...`);
                continue;
              }
              
              addRpLog(`BG warm-up: Notices scope ready (attempt ${attempt}/12). ${Array.isArray(probeParsed) ? probeParsed.length + ' notices found.' : ''}`);
              break;
            }
          } catch (e) { addRpLog(`BG warm-up notices error: ${e.message}`); }
        })(),
        // Warm up return.gst.gov.in API session
        (async () => {
          try {
            const apiCheck = await fetch(
              'https://return.gst.gov.in/returns/auth/api/retrn/filinghistory?finYear=2026-27',
              { method: 'GET', credentials: 'include' }
            );
            const apiText = await apiCheck.text();
            const apiTrimmed = apiText.trim().toLowerCase();
            const apiIsHtml = apiTrimmed.startsWith('<!doctype') || apiTrimmed.startsWith('<html');
            if (!apiIsHtml) {
              addRpLog('BG warm-up: return.gst.gov.in session ready.');
            } else {
              addRpLog('BG warm-up: return.gst.gov.in still warming — retrying once...');
              await new Promise(r => setTimeout(r, 2000));
              await fetch('https://return.gst.gov.in/returns/auth/dashboard',
                { method: 'GET', credentials: 'include', redirect: 'follow' });
            }
          } catch (e) { addRpLog(`BG warm-up returns error: ${e.message}`); }
        })(),
        // Warm up payment.gst.gov.in API session (Outstanding Demands)
        (async () => {
          try {
            const demandProbeHeaders = {
              'Accept': 'application/json, text/plain, */*',
              'Referer': 'https://payment.gst.gov.in/payment/auth/ledger/paymenttowardsdemand'
            };
            const apiCheck = await fetch(
              'https://payment.gst.gov.in/payment/auth/api/liabilitydetails?refLiabId=',
              { method: 'GET', credentials: 'include', headers: demandProbeHeaders }
            );
            const apiText = await apiCheck.text();
            const apiTrimmed = apiText.trim().toLowerCase();
            const apiIsHtml = apiTrimmed.startsWith('<!doctype') || apiTrimmed.startsWith('<html');
            if (!apiIsHtml) {
              addRpLog('BG warm-up: payment.gst.gov.in (outstanding demand) session ready.');
            } else {
              addRpLog('BG warm-up: payment.gst.gov.in still warming — retrying once...');
              await new Promise(r => setTimeout(r, 2000));
              await fetch('https://payment.gst.gov.in/payment/auth/ledger/paymenttowardsdemand',
                { method: 'GET', credentials: 'include', redirect: 'follow' });
            }
          } catch (e) { addRpLog(`BG warm-up payment error: ${e.message}`); }
        })()
      ]).catch((e) => { console.warn('[ReturnPilot] Background warmup error:', e.message || e); }); // never let background errors surface to caller



      // Layer 2 fix: return authToken inside the login response so the frontend
      // can use it directly — avoids a second get-auth-token round-trip that
      // races with MV3 service worker suspension clearing chrome.storage.session.

      // Persist legal name + GSTIN onto the matching saved account for
      // Quick-Login search-by-username / legal-name / GSTIN.
      enrichSavedAccountWithProfile(username);

      return {
        success: true,
        authToken: extractedAuthToken || null,
        logs: rpLogs
      };
    } else {
      // Login failed — extract the raw errorCode and a human-readable message.
      // The frontend (GSTLoginCard.jsx) uses the errorCode for its own lookup;
      // the error string here is a fallback in case the frontend lookup misses.
      const errorCode = (data && data.errorCode) ? String(data.errorCode) : null;

      const errorMapping = {
        'AUTH_9002':     'Invalid username or password. Please check your credentials.',
        'SWEB_9014':     'Invalid username or password. Please check your credentials.',
        'SWEB_8000':     'System error on GST portal. Please try again later.',
        'SWEB_9000':     'Invalid CAPTCHA. Please enter the correct CAPTCHA.',
        'SWEB_9006':     'GST portal servers are busy. Please try again after some time.',
        'SWEB_9034':     'Your GSTIN / UIN has been cancelled. Login is not permitted.',
        'SWEB_9036':     'Invalid user type (R0 user). Please contact GST helpdesk.',
        'SWEB_8001':     'Old username/password format detected. Please reset credentials on the GST portal.',
        'SWEB_8002':     'Session/cache error. Please close the browser and try again.',
        'SWEB_9013':     'Session or provisional ID has expired. Please re-register on the GST portal.',
        'SWEB_9008':     'Invalid username or password. Please check your credentials.',
        'AUTH_9033':     'Password has expired. Please reset it on the GST portal.',
        'AUTH_9033_MIG': 'Password has expired (migrated user). Please reset it on the GST portal.',
        'RSK_1001':      'Login blocked due to security policy. Please contact GST helpdesk.',
        'false':         'Login failed. Please verify your username, password, and CAPTCHA.',
      };

      let errMsg = errorCode
        ? (errorMapping[errorCode] || `Login failed (Error: ${errorCode}). Please check your credentials.`)
        : 'Invalid credentials or CAPTCHA';

      addRpLog(`Direct login failed: [${errorCode || 'no-code'}] ${errMsg}`);
      return {
        success: false,
        error: errMsg,
        errorCode: errorCode,   // ← pass raw code so frontend can do its own lookup
        logs: rpLogs
      };
    }
  } catch (err) {
    addRpLog(`Direct login error: ${err.message}`);
    return { success: false, error: err.message, logs: rpLogs };
  }
}

// ── SAVED-ACCOUNT ENRICHMENT (Quick-Login: legal name + GSTIN) ──────────
// After a successful login, persist the taxpayer's legal name & GSTIN onto
// the matching saved account (rp_saved_accounts) so the Quick-Login selector
// can be searched by username, legal name, or GSTIN next time.
async function enrichSavedAccountWithProfile(username, ustatusData) {
  try {
    let data = ustatusData || null;
    if (!data) {
      const endpoints = [
        'https://services.gst.gov.in/services/api/ustatus',
        'https://return.gst.gov.in/services/api/ustatus'
      ];
      for (const url of endpoints) {
        try {
          const res = await fetch(url, {
            method: 'GET',
            credentials: 'include'
          });
          if (!res.ok) continue;
          const contentType = res.headers.get('content-type') || '';
          if (contentType.includes('text/html')) continue;
          const text = await res.text();
          let clean = text.trim();
          clean = clean.replace(/"([^"]+),"([^"]+)"\s*:/g, '"$1":null,"$2":');
          clean = clean.replace(/"([^"]+),"\s*}/g, '"$1":null}');
          const parsed = JSON.parse(clean);
          if (parsed && (parsed.gstin || parsed.bname || parsed.tradeNam || parsed.legalName)) {
            data = parsed;
            break;
          }
        } catch (_) {}
      }
    }

    const legalName = String(data?.bname || data?.legalName || data?.tradeName || data?.tradeNam || data?.lgnm || '').trim();
    const gstin = String(data?.gstin || data?.authGstin || '').trim().toUpperCase();
    if (!legalName && !gstin) return;

    const targetUser = String(username || '').trim().toLowerCase();
    if (!targetUser) return;

    chrome.storage.local.get(['rp_saved_accounts'], (stored) => {
      const accounts = stored.rp_saved_accounts || [];
      let updated = false;
      let enrichedLabel = '';

      const next = accounts.map(acc => {
        // STRICT USERNAME MATCHING ONLY — PREVENTS CORRUPTING OR CROSS-CONTAMINATING OTHER ACCOUNTS
        if (!acc.username || acc.username.toLowerCase() !== targetUser) return acc;

        const currentName = (acc.clientName || '').trim();
        const currentGstin = (acc.gstin || '').trim();

        const newClientName = legalName || currentName;
        const newGstin = gstin || currentGstin;

        if (currentName !== newClientName || currentGstin !== newGstin) {
          updated = true;
          enrichedLabel = newClientName;
          return {
            ...acc,
            clientName: newClientName,
            gstin: newGstin
          };
        }
        return acc;
      });

      if (updated) {
        chrome.storage.local.set({ rp_saved_accounts: next });
        addRpLog(`Quick-Login account auto-synced: ${username} → ${enrichedLabel} (${gstin || '—'})`);
      }
    });
  } catch (e) {
    addRpLog(`Quick-Login account enrichment skipped: ${e.message}`);
  }
}

async function verifySessionActive() {
  addRpLog('Verifying session active status via /services/api/ustatus...');
  const endpoints = [
    'https://services.gst.gov.in/services/api/ustatus',
    'https://return.gst.gov.in/services/api/ustatus'
  ];
  let data = null;
  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        method: 'GET',
        credentials: 'include'
      });
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('text/html')) continue;
      const text = await res.text();
      let cleanUstatus = text.trim();
      cleanUstatus = cleanUstatus.replace(/"([^"]+),"([^"]+)"\s*:/g, '"$1":null,"$2":');
      cleanUstatus = cleanUstatus.replace(/"([^"]+),"\s*}/g, '"$1":null}');
      const parsed = JSON.parse(cleanUstatus);
      if (parsed && (parsed.role || parsed.gstin || parsed.bname || parsed.userName || parsed.status_cd === '1' || parsed.regType)) {
        data = parsed;
        break;
      }
    } catch (_) {}
  }

  if (!data) {
    throw new Error('Session invalid — ustatus check failed');
  }

  addRpLog(`Session verified! Business/User: ${data.bname || data.userName || data.gstin || 'Active'}`);
  return data;
}

// ═════════════════════════════════════════════════════════════
//  SERVICE WORKER KEEP-ALIVE PORT
// ═════════════════════════════════════════════════════════════
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'ReturnPilotKeepAlive') {
    addRpLog('KeepAlive connection established.');
    
    // Increment active Audit Tool connection counter
    chrome.storage.local.get(['activeAuditToolConnections'], (data) => {
      const current = data.activeAuditToolConnections || 0;
      chrome.storage.local.set({
        activeAuditToolConnections: current + 1,
        auditToolConnected: true
      });
    });

    port.onDisconnect.addListener(() => {
      addRpLog('KeepAlive connection closed.');
      
      // Decrement active Audit Tool connection counter
      chrome.storage.local.get(['activeAuditToolConnections'], (data) => {
        const current = data.activeAuditToolConnections || 1;
        const updated = Math.max(0, current - 1);
        chrome.storage.local.set({
          activeAuditToolConnections: updated,
          auditToolConnected: updated > 0
        });
      });
    });

    port.onMessage.addListener((msg) => {
      if (msg && msg.type === 'ping') {
        try {
          port.postMessage({ type: 'pong' });
        } catch (e) {}
      }
    });
  }
});

// ═════════════════════════════════════════════════════════════
//  STALE USER CACHE FLUSH ENGINE
// ═════════════════════════════════════════════════════════════

const USER_CACHE_KEYS = [
  'userdetails',
  'gstin',
  'lgnm',
  'trdnm',
  'gstpType',
  'curFnYr',
  'fin_year',
  'rtn_prd',
  'previousPage',
  'TODates',
  'gstr2bData'
];

function flushUserCache(tabId, reason) {
  if (typeof chrome === 'undefined') return;
  console.warn('[ReturnPilot] Flushing user cache. Reason:', reason);

  // 1. Purge background service worker in-memory auth token
  cachedAuthToken = null;
  cachedAuthTokenTs = 0;

  // 2. Purge background extension storage
  if (chrome.storage) {
    if (chrome.storage.session) {
      chrome.storage.session.clear().catch(() => {});
    }
    if (chrome.storage.local) {
      chrome.storage.local.remove([
        'rp_period_state_cache',
        'rp_generation_timestamps',
        'rp_last_active_gstin',
        'rp_active_client_gstin',
        'rp_current_gstin',
        'gstin'
      ]).catch(() => {});
    }
  }

  // 3. Purge page DOM storage if tabId is provided
  if (!tabId || !chrome.scripting) return;
  chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: function(keysToRemove) {
      keysToRemove.forEach(function(k) {
        try { localStorage.removeItem(k); } catch(_) {}
      });
      const dynamicKeys = [];
      for (let i = 0; i < localStorage.length; i++) {
        try {
          const k = localStorage.key(i);
          if (!k) continue;
          if (k.startsWith('ls.') || k.startsWith('_rp') || k.startsWith('ls.caseJson')) {
            dynamicKeys.push(k);
          }
        } catch(_) {}
      }
      dynamicKeys.forEach(function(k) {
        try { localStorage.removeItem(k); } catch(_) {}
      });
      const ssKeys = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        try {
          const k = sessionStorage.key(i);
          if (k && k.startsWith('_rp')) sessionStorage.removeItem(k);
        } catch(_) {}
      }
      ssKeys.forEach(function(k) {
        try { sessionStorage.removeItem(k); } catch(_) {}
      });
      console.log('[ReturnPilot] Cache flushed successfully.');
    },
    args: [USER_CACHE_KEYS]
  }).catch(function(e) {
    console.error('[ReturnPilot] flushUserCache script error:', e.message);
  });
}

if (typeof chrome !== 'undefined' && chrome.webNavigation) {
  const GST_LOGOUT_URLS = [
    'services.gst.gov.in/services/login',
    'services.gst.gov.in/services/logout',
    'services.gst.gov.in/services/auth/logout',
    'gst.gov.in/logout'
  ];

  chrome.webNavigation.onBeforeNavigate.addListener(function(details) {
    try {
      if (details.frameId !== 0) return;
      const url = details.url || '';
      if (typeof rpLog !== 'undefined' && rpLog && typeof rpLog.info === 'function') {
        rpLog.info('SW_NAV_BEFORE', `Navigation starting to: ${url}`, { url, tabId: details.tabId });
      }
      // Intercept bare /services/auth/ navigation that causes accessdenied
      if (url === 'https://services.gst.gov.in/services/auth/' || url === 'https://services.gst.gov.in/services/auth') {
        console.warn('[ReturnPilot BG] Intercepted bare /services/auth/ navigation -> redirecting to /services/auth/fowelcome');
        chrome.tabs.update(details.tabId, { url: 'https://services.gst.gov.in/services/auth/fowelcome' });
      }
    } catch (e) {}
  });

  chrome.webNavigation.onCommitted.addListener(function(details) {
    try {
      if (details.frameId !== 0) return; // main frame only
      const url = details.url || '';
      if (typeof rpLog !== 'undefined' && rpLog && typeof rpLog.info === 'function') {
        rpLog.info('SW_NAV_COMMITTED', `Committed: ${url}`, { url, tabId: details.tabId, transitionType: details.transitionType });
      }
      const isLogout = GST_LOGOUT_URLS.some(function(u) {
        return url.includes(u);
      });
      if (isLogout) {
        flushUserCache(details.tabId, 'logout/login page detected: ' + url);
        deduplicateGstSecurityCookies();
        prewarmSolverContainer();
      }
      if (url.includes('accessdenied')) {
        console.group('%c[ReturnPilot BG Navigation] ACCESS DENIED DETECTED', 'background: #991b1b; color: white; font-weight: bold; padding: 2px 6px;');
        console.log('URL:', url);
        console.log('Transition Type:', details.transitionType);
        console.log('Transition Qualifiers:', details.transitionQualifiers);
        console.log('Tab ID:', details.tabId);
        console.groupEnd();
        if (typeof rpLog !== 'undefined' && rpLog && typeof rpLog.error === 'function') {
          rpLog.error('SW_ACCESS_DENIED', `Access Denied route hit: ${url}`, { url, tabId: details.tabId, transitionType: details.transitionType });
        }
      }
    } catch(e) {
      console.error('[ReturnPilot] webNavigation listener error:', e.message);
    }
  });
}

// ═════════════════════════════════════════════════════════════
//  PROACTIVE AUTHTOKEN PRE-PROPAGATION ENGINE
// ═════════════════════════════════════════════════════════════

if (typeof chrome !== 'undefined' && chrome.webNavigation) {
  chrome.webNavigation.onCompleted.addListener(
    async function(details) {
      if (details.frameId !== 0) return; // main frame only
      try {
        const url = details.url || '';
        const isDashboardOrWelcome =
          url.includes('/auth/dashboard') || url.includes('/auth/fowelcome');
        if (!isDashboardOrWelcome) return;

        console.log('[ReturnPilot BG] Dashboard/welcome load detected — running full session propagation:', url.slice(0, 80));

        // Full propagation: copy ALL gst.gov.in cookies → all subdomain targets
        // This is the single source of truth — eliminates content-script patches.
        const allCookies = await chrome.cookies.getAll({ domain: 'gst.gov.in' }).catch(() => []);
        const TARGET_SUBDOMAINS = [
          'https://return.gst.gov.in',
          'https://gstr2b.gst.gov.in',
          'https://payment.gst.gov.in',
          'https://fogstr4.gst.gov.in'
        ];

        for (const c of allCookies) {
          // Never re-home Akamai/TS fingerprint cookies or JSESSIONID — the portal validates
          // these per-origin; cross-domain copies trip validation (Access Denied).
          if (c.name.startsWith('TS') || c.name.startsWith('bm_') || c.name.startsWith('ak_') || c.name.startsWith('_abck') || c.name === 'JSESSIONID' || c.name.startsWith('JSESSIONID') || c.name.startsWith('AWS')) continue;
          for (const subUrl of TARGET_SUBDOMAINS) {
            await chrome.cookies.set({
              url: subUrl,
              name: c.name,
              value: c.value,
              path: c.path || '/',
              secure: c.secure,
              httpOnly: c.httpOnly,
              sameSite: c.sameSite,
              expirationDate: c.expirationDate
            }).catch(() => {});
          }
        }

        // Sync auth token and bm_sv into session storage for resolveAuthToken()
        const atCookie = allCookies.find(c => c.name === 'AuthToken');
        if (atCookie && atCookie.value) {
          await chrome.storage.session.set({ gst_auth_token: atCookie.value }).catch(() => {});
          console.log('[ReturnPilot BG] AuthToken propagated on dashboard/welcome load:', atCookie.value.slice(0, 20) + '...');
        }
        const bmCookie = allCookies.find(c => c.name === 'bm_sv');
        if (bmCookie && bmCookie.value) {
          await chrome.storage.session.set({ gst_bm_sv: bmCookie.value }).catch(() => {});
          console.log('[ReturnPilot BG] bm_sv propagated on dashboard/welcome load.');
        }

        console.log('[ReturnPilot BG] Full session propagation complete. Cookies synced:', allCookies.length, '→', TARGET_SUBDOMAINS.length, 'targets');
      } catch(err) {
        console.error('[ReturnPilot BG] webNavigation propagation error:', err.message);
      }
    },
    {
      url: [
        { hostEquals: 'services.gst.gov.in', pathContains: '/auth/dashboard' },
        { hostEquals: 'services.gst.gov.in', pathContains: '/auth/fowelcome' }
      ]
    }
  );
}

// ═════════════════════════════════════════════════════════════
//  DROPDOWN PRE-WARM ENGINE
//  Fires whenever the user lands on any authenticated returns
//  page (return.gst.gov.in/returns/auth/*). Fetches the
//  /api/dropdown response in the background and caches it in
//  chrome.storage.session so the popup can serve it instantly
//  without a 1–1.5 s network round-trip on open.
//  TTL: 90 seconds (short enough to stay fresh across tabs,
//       long enough to survive the popup open→render cycle).
// ═════════════════════════════════════════════════════════════
const RP_DROPDOWN_CACHE_KEY = 'rp_dropdown_cache';
const RP_DROPDOWN_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes in memory session only

async function prewarmDropdownCache() {
  // Purge any legacy multi-day local caches
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      await chrome.storage.local.remove(['rp_dropdown_local_cache']).catch(() => {});
    }
  } catch (_) {}
}

if (typeof chrome !== 'undefined' && chrome.webNavigation) {
  chrome.webNavigation.onCompleted.addListener(
    function(details) {
      if (details.frameId !== 0) return; // main frame only
      // Purge any stale caches when navigating returns pages
      prewarmDropdownCache();
    },
    {
      url: [
        { hostEquals: 'return.gst.gov.in', pathContains: '/returns/auth/' }
      ]
    }
  );
}


if (typeof chrome !== 'undefined' && chrome.cookies && chrome.cookies.onChanged) {
  chrome.cookies.onChanged.addListener(async function(info) {
    try {
      if (info.cookie && info.cookie.domain && info.cookie.domain.includes('gst.gov.in')) {
        const cName = info.cookie.name;
        if (cName === 'AuthToken' || cName.startsWith('JSESSION') || cName.startsWith('AWS') || cName === 'bm_sv') {
          if (typeof rpLog !== 'undefined' && rpLog && typeof rpLog.debug === 'function') {
            rpLog.debug('SW_COOKIE_CHANGE', `Cookie ${cName} ${info.removed ? 'REMOVED' : 'SET'} on ${info.cookie.domain}`, {
              name: cName,
              domain: info.cookie.domain,
              removed: info.removed,
              cause: info.cause
            });
          }
        }
      }

      if (
        info.cookie &&
        (info.cookie.name === 'AuthToken' || info.cookie.name === 'bm_sv') &&
        info.cookie.domain &&
        info.cookie.domain.includes('gst.gov.in')
      ) {
        // Invalidate in-memory cached token and SW cache immediately on any token change
        cachedAuthToken = null;
        cachedAuthTokenTs = 0;
        _swGetCache.clear();

        if (info.removed === false) {
          const key = info.cookie.name === 'AuthToken' ? 'gst_auth_token' : 'gst_bm_sv';
          await chrome.storage.session.set({
            [key]: info.cookie.value
          }).catch(() => {});
        }
      }
      
      if (
        info.removed === true &&
        info.cookie &&
        info.cookie.name === 'AuthToken' &&
        info.cookie.domain &&
        info.cookie.domain.includes('gst.gov.in')
      ) {
        // DO NOT clear immediately — GST portal rotates AuthToken
        // by removing then re-adding within ~500ms.
        // Clearing immediately creates a gap where webRequest
        // has no token, causing accessdenied on official button clicks.
        // Wait 5s — if no new AuthToken arrives it was a real logout.
        setTimeout(async function() {
          try {
            const current = await chrome.cookies.get({
              url: 'https://services.gst.gov.in',
              name: 'AuthToken'
            });
            if (!current || !current.value) {
              await chrome.storage.session.remove('gst_auth_token').catch(() => {});
            }
          } catch(e) {
            console.error('[ReturnPilot BG] AuthToken clear check error:', e.message);
          }
        }, 5000);
      }
    } catch(err) {
      console.error('[ReturnPilot BG] Cookie watcher error:', err.message);
    }
  });
}

// ── Declarative Net Request: Ensure 0 interference with native GST portal navigation ──
if (typeof chrome !== 'undefined' && chrome.declarativeNetRequest && chrome.declarativeNetRequest.updateDynamicRules) {
  chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [1001, 1002]
  }).catch(() => {});
}

// ═══════════════════════════════════════════════════════════════
// Two-Way Surface Router (Normal Extension Popup vs. Chrome Side Panel)
// ═══════════════════════════════════════════════════════════════

function isGstPortalUrl(urlStr) {
  try {
    if (!urlStr || typeof urlStr !== 'string') return false;
    const u = new URL(urlStr);
    const host = u.hostname.toLowerCase();
    return host === 'gst.gov.in' || host.endsWith('.gst.gov.in');
  } catch (_) {
    return false;
  }
}

async function configureSidePanelForTab(tabId, urlStr) {
  if (typeof chrome === 'undefined' || !chrome.sidePanel || !chrome.sidePanel.setOptions || !tabId) return;
  const isGst = isGstPortalUrl(urlStr);
  try {
    if (isGst) {
      await chrome.sidePanel.setOptions({
        tabId: tabId,
        path: `popup/sidepanel.html?tabId=${tabId}`,
        enabled: true
      });
      console.log(`[ReturnPilot BG SidePanel] Scoped side panel ENABLED for GST tab #${tabId}`);
    } else {
      await chrome.sidePanel.setOptions({
        tabId: tabId,
        enabled: false
      });
    }
  } catch (_) {}
}

async function syncAllTabsSidePanelScope() {
  if (typeof chrome === 'undefined' || !chrome.tabs || !chrome.tabs.query) return;
  try {
    chrome.tabs.query({}, (allTabs) => {
      for (const t of (allTabs || [])) {
        if (t && t.id) {
          configureSidePanelForTab(t.id, t.url || '');
        }
      }
    });
  } catch (_) {}
}

async function applySurfaceMode(mode) {
  const hasSidePanel = typeof chrome !== 'undefined' && Boolean(chrome.sidePanel);

  // Requirement 1: The default toolbar action click MUST ALWAYS open the normal extension popup every time
  try {
    if (chrome.action && chrome.action.setPopup) {
      await chrome.action.setPopup({ popup: 'popup/ReturnPilot.html' }).catch(() => {});
    }
    if (hasSidePanel && chrome.sidePanel.setPanelBehavior) {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
    }
  } catch (_) {}

  // Requirement 2: Ensure Side Panel is globally DISABLED by default so it ONLY appears on GST website tabs
  if (hasSidePanel && chrome.sidePanel.setOptions) {
    try {
      await chrome.sidePanel.setOptions({
        enabled: false
      }).catch(() => {});
    } catch (_) {}
  }

  // Requirement 3: Scan all tabs and enforce side panel enablement strictly on GST portal tabs
  syncAllTabsSidePanelScope();
}

if (typeof chrome !== 'undefined') {
  if (chrome.action && chrome.action.onClicked) {
    chrome.action.onClicked.addListener(async (tab) => {
      // Always open normal extension popup on toolbar action click
      try {
        if (chrome.action.setPopup) {
          await chrome.action.setPopup({ popup: 'popup/ReturnPilot.html' }).catch(() => {});
        }
        if (chrome.action.openPopup) {
          await chrome.action.openPopup().catch(() => {});
        }
      } catch (_) {}
    });
  }

  // Enforce tab-specific side panel scoping: strictly GST portal tabs only
  if (chrome.sidePanel && chrome.sidePanel.setOptions && chrome.tabs) {
    if (chrome.tabs.onUpdated) {
      chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
        const url = (changeInfo && changeInfo.url) || (tab && tab.url);
        if (url) {
          configureSidePanelForTab(tabId, url);
        }
      });
    }

    if (chrome.tabs.onActivated) {
      chrome.tabs.onActivated.addListener((activeInfo) => {
        chrome.tabs.get(activeInfo.tabId, (tab) => {
          if (chrome.runtime.lastError || !tab) return;
          configureSidePanelForTab(tab.id, tab.url || '');
        });
      });
    }

    if (chrome.tabs.onCreated) {
      chrome.tabs.onCreated.addListener((tab) => {
        if (tab && tab.id) {
          configureSidePanelForTab(tab.id, tab.url || '');
        }
      });
    }
  }

  // Proactive Google OAuth Token Interceptor for Chrome, Edge & Firefox
  if (chrome.tabs && chrome.tabs.onUpdated) {
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      const url = (changeInfo && changeInfo.url) || (tab && tab.url);
      if (url && (url.includes('kasyhq.com') || url.includes('access_token='))) {
        try {
          const u = new URL(url);
          const hashParams = new URLSearchParams(u.hash ? u.hash.slice(1) : '');
          const token = hashParams.get('access_token') || u.searchParams.get('access_token');
          const error = hashParams.get('error') || u.searchParams.get('error');
          if (token || error) {
            handleCapturedOAuthToken(token, error, tabId, tab && tab.windowId);
          }
        } catch (_) {}
      }
    });
  }

  // Initialize display mode on installation and service worker startup
  // Normal Extension Popup is ALWAYS the default mode
  if (chrome.runtime && chrome.runtime.onInstalled) {
    chrome.runtime.onInstalled.addListener(() => {
      applySurfaceMode('popup');
    });
  }

  if (chrome.runtime && chrome.runtime.onStartup) {
    chrome.runtime.onStartup.addListener(() => {
      applySurfaceMode('popup');
    });
  }

  // Listen for view mode changes from popup/profile UI
  if (chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.returnPilotView) {
        applySurfaceMode(changes.returnPilotView.newValue);
      }
    });
  }

  // Immediate registration in running background instance
  applySurfaceMode('popup');
}