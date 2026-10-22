/* ═══════════════════════════════════════════════════════════════
   ReturnPilot v3.1 — popup.js
   © 2026 KasyHQ. All Rights Reserved.
   ═══════════════════════════════════════════════════════════════ */

// Debug log panel removed — addCopilotLog is a no-op stub (logs to DevTools console only)
function addCopilotLog(message, type) {
  if (type === 'error') {
    console.error('[ReturnPilot Copilot] [' + type + '] ' + message);
    if (typeof rpLog !== 'undefined' && rpLog && typeof rpLog.error === 'function') {
      rpLog.error('COPILOT', message);
    }
  } else {
    if (typeof rpLog !== 'undefined' && rpLog && typeof rpLog.info === 'function') {
      rpLog.info('COPILOT', message);
    }
  }
}
let savedAccounts = [];
function isGstPortalUrlSync(urlStr) {
  try {
    if (!urlStr || typeof urlStr !== 'string') return false;
    const u = new URL(urlStr);
    const host = u.hostname.toLowerCase();
    return host === 'gst.gov.in' || host.endsWith('.gst.gov.in');
  } catch (_) {
    return false;
  }
}

// Synchronous early detection of surface viewport (Side Panel vs. Normal Extension Popup)
var isSidePanelSurface = false;
var currentActiveTabId = null;
var currentActiveWindowId = null;
try {
  if (typeof window !== 'undefined' && typeof document !== 'undefined' && document.documentElement) {
    var _pathname = (window.location && window.location.pathname) || '';
    var _search = (window.location && window.location.search) || '';
    isSidePanelSurface = _pathname.indexOf('sidepanel.html') !== -1 ||
                         _search.indexOf('view=sidepanel') !== -1 ||
                         document.documentElement.classList.contains('rp-view-sidepanel');
    if (isSidePanelSurface) {
      document.documentElement.classList.add('rp-view-sidepanel');
    }
  }

  // Eagerly resolve active tab & window IDs so sidePanel.open() has target ready synchronously on click
  try {
    const spTabParam = new URLSearchParams(window.location.search).get('tabId');
    const parsedSpTab = parseInt(spTabParam, 10);
    if (!isNaN(parsedSpTab) && parsedSpTab > 0) {
      currentActiveTabId = parsedSpTab;
    }
  } catch (_) {}

  if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs[0]) {
        if (!tabs[0].url || !tabs[0].url.startsWith('chrome-extension://')) {
          currentActiveTabId = tabs[0].id;
          currentActiveWindowId = tabs[0].windowId;
        } else if (!currentActiveWindowId) {
          currentActiveWindowId = tabs[0].windowId;
        }
        const isGst = tabs[0].url && isGstPortalUrlSync(tabs[0].url);
        if (!isSidePanelSurface && chrome.sidePanel && chrome.sidePanel.setOptions && tabs[0].id) {
          if (isGst) {
            chrome.sidePanel.setOptions({
              tabId: tabs[0].id,
              path: `popup/sidepanel.html?tabId=${tabs[0].id}`,
              enabled: true
            }).catch(() => {});
          } else {
            chrome.sidePanel.setOptions({
              tabId: tabs[0].id,
              enabled: false
            }).catch(() => {});
          }
        }
      }
    });
  }
} catch (_) {}



if (typeof ReturnPilotSecurity !== 'undefined') {
  const popupSig = ReturnPilotSecurity.verifyEntanglement('popup');
  if (!popupSig) {
    console.error('[ReturnPilot Security] Unauthorized extension build detected. Features disabled.');
  }
}

const CONFIG = {
  CONNECTION_RETRIES: 3,
  CONNECTION_RETRY_DELAY: 200,
  CONNECTION_PING_TIMEOUT: 1200,
  CONNECTION_REUSE_TIMEOUT: 60000,
  REQUEST_TIMEOUT: 25000,
  RATE_LIMIT_DELAY: 200,
  // chrome.runtime messaging is capped near ~64 MB per message (JSON base64 inflates 1.33×),
  // so anything above ~50 MB cannot round-trip through the service worker reliably.
  // Prefer chrome.downloads.download({ url }) for large files (see background handleDownloadFile).
  MAX_FILE_SIZE_MB: 50,
  MAX_ZIP_SIZE_MB: 64,
  MAX_BASE64_SIZE_MB: 50,
  ALLOWED_HOSTS: [
    'return.gst.gov.in',
    'gstr2b.gst.gov.in',
    'gstr9.gst.gov.in',
    'services.gst.gov.in'
  ]
};

const _loadedScripts = new Map();
function loadScriptAsync(src) {
  if (_loadedScripts.has(src)) return _loadedScripts.get(src);
  const p = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      resolve();
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = (err) => {
      _loadedScripts.delete(src);
      reject(new Error(`Failed to load script: ${src}`));
    };
    document.head.appendChild(s);
  });
  _loadedScripts.set(src, p);
  return p;
}

let port = null;
let currentUrl = null;
let rpLastNavKey = '';
let currentUserProfile = null;
let currentSubscriptionState = { valid: false, tier: 'FREE' };

function isCurrentUserPremium() {
  const isLoggedIn = Boolean(currentUserProfile && currentUserProfile.email);
  if (!isLoggedIn) return false;
  if (!currentSubscriptionState) return false;
  if (currentSubscriptionState.expired === true) return false;
  if (!currentSubscriptionState.valid) return false;
  const tier = String(currentSubscriptionState.tier || '').toUpperCase();
  if (tier !== 'PREMIUM' && tier !== 'EARLY_BACKER') return false;
  const now = Date.now();
  if (currentSubscriptionState.expiresAt && Number(currentSubscriptionState.expiresAt) <= now) return false;
  if (currentSubscriptionState.isTrial && (!currentSubscriptionState.expiresAt || Number(currentSubscriptionState.expiresAt) <= now)) return false;

  // Cryptographic Seal Verification: Reject tampered or unsealed local states
  if (typeof ReturnPilotSecurity !== 'undefined' && typeof ReturnPilotSecurity.verifyLicenseSeal === 'function') {
    if (!ReturnPilotSecurity.verifyLicenseSeal(currentSubscriptionState, currentUserProfile.email)) {
      return false;
    }
  }

  return true;
}
const RP_OAUTH_CLIENT_ID = '952360719209-f5b4439hpqhiacc2nla3vfa7pcog3pk9.apps.googleusercontent.com';
const RP_REDIRECT_URI = 'https://kasyhq.com';
const responseHandlers = {};
let msgId = 1;
let connectionPromise = null;
let isConnecting = false;
let activeBatchCollector = null;

const session = {
  gstRegType: '?',
  businessName: '',
  gstin: '',
  dropdown: null,
  periods: [],
  return: null,
  finYear: '',
  pendingFileName: null,
  filingFrequency: 'Monthly',
  taxpayerStatus: ''
};

const RETURN_STATES = Object.freeze({
  CHECKING:        'CHECKING',
  GENERATING:      'GENERATING',
  DOWNLOADING:     'DOWNLOADING',
  DOWNLOADED:      'DOWNLOADED',
  NOT_GENERATED:   'NOT_GENERATED',
  NO_DATA:         'NO_DATA',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  FAILED:          'FAILED',
  AVAILABLE:       'AVAILABLE'
});

const WORKFLOW_TYPES = Object.freeze({
  ASYNC_GENERATED: 'ASYNC_GENERATED',
  LIVE_DYNAMIC:    'LIVE_DYNAMIC',
  GSTN_PUBLISHED:  'GSTN_PUBLISHED',
  IMS_PORTAL:      'IMS_PORTAL'     // IMS uses its own /imsweb/auth/api/ims/generateDoc endpoint
});

const STABLE_STATES = Object.freeze([
  RETURN_STATES.AVAILABLE,
  RETURN_STATES.NOT_GENERATED,
  RETURN_STATES.NO_DATA,
  RETURN_STATES.FAILED,
  RETURN_STATES.SESSION_EXPIRED
]);

const periodStateCache = {};

// Counts in-flight row actions (generate / JSON / Excel / PDF download). The
// tab-URL listener checks this so a portal navigation can't re-render the popup
// and yank the user's return-type selection mid-download.
let rpRowActionsActive = 0;

// Unique incremental token for the currently mounted workspace render.
// Used to cleanly discard responses from stale async probes when switching tabs.
let currentWorkspaceRenderId = 0;
let isBatchSweepRunning = false;
let isBulkOperationRunning = false;
let enrichmentGeneration = 0;

// ── Phase J: Cross-View Asynchronous Response Isolation & Correlation Tokens ──
function createRequestContext(periodOrOpId, requestClass = 'STATUS', renderId = currentWorkspaceRenderId) {
  const expectedReturnKey = session.return?.key || '';
  const expectedFinYear = session.finYear || '';
  const opId = typeof periodOrOpId === 'object' ? (periodOrOpId.value || periodOrOpId.month || '') : String(periodOrOpId || '');
  return {
    viewInstanceId: typeof renderId === 'number' ? renderId : currentWorkspaceRenderId,
    batchId: `${expectedReturnKey}_${expectedFinYear}_${renderId}`,
    operationId: opId,
    requestClass,
    expectedReturnKey,
    expectedFinYear
  };
}

function isRequestStale(renderIdOrContext) {
  if (!renderIdOrContext) return false;
  if (typeof renderIdOrContext === 'number') {
    return renderIdOrContext !== currentWorkspaceRenderId;
  }
  if (typeof renderIdOrContext === 'object') {
    if (renderIdOrContext.generation !== undefined && renderIdOrContext.generation !== enrichmentGeneration) return true;
    if (renderIdOrContext.viewInstanceId && renderIdOrContext.viewInstanceId !== currentWorkspaceRenderId) return true;
    if (renderIdOrContext.expectedReturnKey && session.return?.key && renderIdOrContext.expectedReturnKey !== session.return.key) return true;
    if (renderIdOrContext.expectedFinYear && session.finYear && renderIdOrContext.expectedFinYear !== session.finYear) return true;
  }
  return false;
}

let activeNetworkRequests = 0;
function _onNetworkRequestSettled() {
  activeNetworkRequests = Math.max(0, activeNetworkRequests - 1);
}

const FILED_STATUSES = new Set(['FIL', 'FILED', 'NIL_FILED']);
const FILED_LABELS   = new Set(['FILED', 'NIL FILED']);

/**
 * Returns true if a period is already filed on GSTN (status FIL, FILED, NIL_FILED, or has ARN).
 * Accepts optional cached state from periodStateCache.
 */
function isReturnFiled(period, cached) {
  if (!period) return false;
  const s = (period.filingStatus || period.status || '').toUpperCase();
  const l = (period.filingLabel || '').toUpperCase();
  if (FILED_STATUSES.has(s) || FILED_LABELS.has(l) || Boolean(period.arn)) return true;
  if (cached) {
    const cs = (cached.filingStatus || '').toUpperCase();
    const cl = (cached.filingLabel || '').toUpperCase();
    return FILED_STATUSES.has(cs) || FILED_LABELS.has(cl) || Boolean(cached.arn);
  }
  return false;
}

function isLatestFiledPeriod(periodValue) {
  const periods = session.periods;
  if (!periods || periods.length === 0) return true;
  const idx = periods.findIndex(p => p.value === periodValue);
  if (idx === -1) return false;
  if (idx === periods.length - 1) return true;

  const now = new Date();
  const curYm = now.getFullYear() * 100 + (now.getMonth() + 1);
  let allAfterAreFuture = true;

  for (let i = idx + 1; i < periods.length; i++) {
    const p = periods[i];
    const cached = periodStateCache[periodCacheKey(session.return?.key, session.finYear, p.value)];
    if (isReturnFiled(p, cached)) return false;

    const mm = parseInt(p.value.substring(0, 2), 10);
    const yyyy = parseInt(p.value.substring(2, 6), 10);
    if ((yyyy * 100 + mm) < curYm) allAfterAreFuture = false;
  }
  if (allAfterAreFuture) return true;

  const cached = periodStateCache[periodCacheKey(session.return?.key, session.finYear, periodValue)];
  return isReturnFiled(periods[idx], cached);
}

function periodCacheKey(returnKey, finYear, periodValue) {
  const g = (typeof session !== 'undefined' && session && session.gstin) ? session.gstin : '';
  return `${g}|${returnKey}|${finYear}|${periodValue}`;
}

// ── Real-Time Frontend Performance & Status Telemetry ──────────────
function logTelemetry(tag, message, extra) {
  if (typeof rpLog !== 'undefined' && rpLog) {
    rpLog.info(tag, message, extra);
  }
}




// ── Safety timeout: auto-reset GENERATING/DOWNLOADING states after 90s ──
// ── Safety timeout: auto-reset GENERATING/DOWNLOADING states after 90s ──
const _rpSafetyTimeouts = {};
function setGeneratingSafetyTimeout(period) {
  if (!period || !period.value) return;
  const key = periodCacheKey(session.return?.key, session.finYear, period.value);
  clearGeneratingSafetyTimeout(period);
  _rpSafetyTimeouts[key] = setTimeout(function() {
    if (period.currentState === RETURN_STATES.GENERATING || period.currentState === RETURN_STATES.DOWNLOADING) {
      period.currentState = RETURN_STATES.FAILED;
      period.currentMessage = 'Timed out — please retry';
      if (typeof syncRowActions === 'function') syncRowActions(period);
      var pill = getElement('json-status-' + period.value);
      if (pill) setStatusPill(pill, period.currentMessage, 'rt-status-error');
    }
  }, 90000);
}
function clearGeneratingSafetyTimeout(period) {
  if (!period || !period.value) return;
  const key = periodCacheKey(session.return?.key, session.finYear, period.value);
  if (_rpSafetyTimeouts[key]) {
    clearTimeout(_rpSafetyTimeouts[key]);
    delete _rpSafetyTimeouts[key];
  }
}

// ── Persist generation timestamps to chrome.storage.session / local ──
// This survives popup close/reopen but clears on browser restart.
const GEN_STORAGE_KEY = 'rp_generation_timestamps';
const GEN_TTL = 1200000; // 20 minutes — max GSTN generation time
const GSTN_FILE_EXPIRY_DAYS = 7;
const GSTN_FILE_EXPIRY_MS = GSTN_FILE_EXPIRY_DAYS * 24 * 60 * 60 * 1000; // 7 days (604,800,000 ms)

let _genStorePromise = Promise.resolve();
function mutateGenStore(mutateFn) {
  const storage = (typeof chrome !== 'undefined' && chrome.storage && (chrome.storage.session || chrome.storage.local)) || null;
  if (!storage) return;
  _genStorePromise = _genStorePromise.then(() => new Promise(resolve => {
    storage.get(GEN_STORAGE_KEY, data => {
      const store = (data && data[GEN_STORAGE_KEY]) || {};
      if (mutateFn(store) !== false) {
        storage.set({ [GEN_STORAGE_KEY]: store }, resolve);
      } else {
        resolve();
      }
    });
  })).catch(() => {});
}

function saveGenerationTimestamp(key, timestamp) {
  mutateGenStore(store => {
    store[key] = timestamp;
  });
}

function clearGenerationTimestamp(key) {
  mutateGenStore(store => {
    if (key in store) {
      delete store[key];
      return true;
    }
    return false;
  });
}

function getSavedGenerationTimestamp(key) {
  if (periodStateCache[key] && periodStateCache[key].generationTriggeredAt) {
    return periodStateCache[key].generationTriggeredAt;
  }
  return null;
}

const PORTAL_DATE_RE = /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:[ \t]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/;

/**
 * Authoritative GSTN portal date parser.
 * Handles DD/MM/YYYY[ HH:mm[:ss]] or DD-MM-YYYY.
 * Regex runs first: V8 Date.parse reads '05/08/2026' as MM/DD whenever first number <= 12.
 */
function parsePortalDate(str) {
  if (str == null || str === '') return NaN;
  const s = String(str).trim();
  const m = s.match(PORTAL_DATE_RE);
  if (m && +m[1] >= 1 && +m[1] <= 31 && +m[2] >= 1 && +m[2] <= 12) {
    return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)).getTime();
  }
  return Date.parse(s);
}

function parseGstnDateTime(dateStr, timeStr, timeStampStr) {
  if (timeStampStr) {
    const iso = String(timeStampStr).trim().replace(' ', 'T');
    const t = Date.parse(iso);
    if (!isNaN(t)) return t;
  }
  if (!dateStr) return 0;
  return parsePortalDate(timeStr ? `${dateStr} ${timeStr}` : dateStr) || 0;
}

let _persistCacheTimer = null;
function persistPeriodStateCache() {
  const storage = (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) ? chrome.storage.local : null;
  if (!storage) return;
  if (_persistCacheTimer) clearTimeout(_persistCacheTimer);
  _persistCacheTimer = setTimeout(() => {
    try {
      const keys = Object.keys(periodStateCache);
      if (keys.length > 500) {
        keys.slice(0, keys.length - 500).forEach(k => delete periodStateCache[k]);
      }
      // Persist lightweight metadata only — omit large raw response bodies to protect quota
      const slim = {};
      for (const k of Object.keys(periodStateCache)) {
        const s = periodStateCache[k];
        if (s && (s.r2bRawData || s.r2bCachedData)) {
          slim[k] = { ...s, r2bRawData: null, r2bCachedData: null };
        } else {
          slim[k] = s;
        }
      }
      storage.set({ rp_period_state_cache: slim }, () => {
        if (chrome.runtime && chrome.runtime.lastError) {
          console.warn('[ReturnPilot Cache] Persistent cache notice:', chrome.runtime.lastError.message);
        }
      });
    } catch (_) {}
  }, 250);
}

async function restoreAllGenerationTimestamps() {
  const storage = (typeof chrome !== 'undefined' && chrome.storage && (chrome.storage.session || chrome.storage.local)) || null;
  if (!storage) return;
  try {
    const data = await new Promise(r => storage.get([GEN_STORAGE_KEY, 'rp_period_state_cache'], r));
    if (!data) return;
    const store = data[GEN_STORAGE_KEY] || {};
    const now = Date.now();
    let storeChanged = false;
    for (const [key, ts] of Object.entries(store)) {
      if (now - ts < GEN_TTL) {
        if (!periodStateCache[key]) periodStateCache[key] = {};
        periodStateCache[key].generationTriggeredAt = ts;
        periodStateCache[key].currentState = RETURN_STATES.GENERATING;
        periodStateCache[key].currentMessage = 'Generating…';
      } else {
        delete store[key]; // expired, clean up
        storeChanged = true;
      }
    }
    if (storeChanged) {
      storage.set({ [GEN_STORAGE_KEY]: store });
    }

    const savedStates = data.rp_period_state_cache;
    if (savedStates && typeof savedStates === 'object') {
      Object.assign(periodStateCache, savedStates);
      if (typeof rpLog !== 'undefined' && rpLog) {
        rpLog.info('CACHE_RESTORE', `Restored ${Object.keys(savedStates).length} period states from persistent storage`);
      }
    }
  } catch (_) {}
}

window.rpClearCache = async function() {
  const storage = (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) ? chrome.storage.local : null;
  if (storage) {
    await new Promise(r => storage.remove(['rp_period_state_cache', 'rp_generation_timestamps'], r));
  }
  for (const k of Object.keys(periodStateCache)) delete periodStateCache[k];
  console.log('%c[ReturnPilot] 🧹 Period state cache wiped! Reloading fresh for raw network speed test...', 'color:#38bdf8;font-weight:bold;');
  location.reload();
};

function saveStableState(period) {
  if (!session.return || !session.gstin) return;
  if (!STABLE_STATES.includes(period.currentState)) return;
  const key = periodCacheKey(session.return.key, session.finYear, period.value);

  const fStatus = (period.filingStatus || '').toUpperCase();
  const fLabel  = (period.filingLabel || '').toUpperCase();
  const existing = periodStateCache[key] || {};
  const isNil = Boolean(period.isNil || existing.isNil || fStatus === 'NIL' || fStatus === 'NIL_FILED' || fLabel === 'NIL FILED');
  const isFilingReturn = session.return.expFilingStatus === 'FIL';
  const isUnfiled = isFilingReturn && (fStatus === 'NOT_FILED' || fStatus === 'NF' || fStatus === 'RTF' || fStatus === 'NCNF' || fLabel === 'NOT FILED' || fLabel === 'NOT APPLICABLE' || fLabel === 'QUARTERLY' || fLabel === 'OPTIONAL (IFF)' || fLabel === 'NO DATA');

  periodStateCache[key] = {
    ...existing,
    currentState:   isNil ? RETURN_STATES.NO_DATA : period.currentState,
    currentMessage: (isUnfiled || isNil) ? '—' : period.currentMessage,
    fileCount:      period.fileCount      || existing.fileCount || 0,
    filingStatus:   period.filingStatus   || existing.filingStatus || null,
    filingLabel:    period.filingLabel    || existing.filingLabel || null,
    isNil,
    isValid:        isUnfiled ? (session.return.key === configR9.key && fLabel !== 'NOT APPLICABLE') : (period.isValid || false),
    r2bCachedData:  isUnfiled ? null : (period.r2bCachedData  || existing.r2bCachedData  || null),
    r2bRawData:     isUnfiled ? null : (period.r2bRawData     || existing.r2bRawData     || null),
    r2bSource:      isUnfiled ? null : (period.r2bSource      || existing.r2bSource      || null),
    genDate:        isUnfiled ? null : (period.genDate        || existing.genDate        || null),
    genTime:        isUnfiled ? null : (period.genTime        || existing.genTime        || null),
    hasExcel:       Boolean(period.hasExcel ?? existing.hasExcel ?? false),
    hasJson:        Boolean(period.hasJson ?? existing.hasJson ?? false),
    arn:            period.arn            || existing.arn            || null,
    fil_dt:         period.fil_dt         || existing.fil_dt         || null,
    gstr2xRecordCount: (typeof period.gstr2xRecordCount === 'number') ? period.gstr2xRecordCount : existing.gstr2xRecordCount
  };
  // If file is now available, clear any generation timestamp
  if (period.currentState === RETURN_STATES.AVAILABLE || period.currentState === RETURN_STATES.DOWNLOADED) {
    clearGenerationTimestamp(key);
  }
  persistPeriodStateCache();
}


/**
 * Dynamic situation-based JSON staleness evaluation:
 * - For FILED returns:
 *   If the JSON was generated BEFORE the filing date (fileDay < filingDay),
 *   it is an outdated pre-filing draft (e.g. generated on 7th, filed on 11th).
 *   It MUST be auto-regenerated so the user downloads final filed data instead of partial drafts.
 *   If generated ON or AFTER the filing date (fileDay >= filingDay), it contains the final
 *   filed data, is 100% immutable, and NEVER expires.
 * - For UNFILED returns:
 *   Expired if file is >= 7 days old (GSTN_FILE_EXPIRY_MS), as new draft invoices may have been saved.
 */
function isGstnFileStale(period, fileTs) {
  if (!fileTs || fileTs <= 0) return false;
  const isFiled = isReturnFiled(period);

  if (isFiled) {
    if (period && period.fil_dt) {
      const filingTs = parseGstnDateTime(period.fil_dt);
      if (filingTs > 0) {
        const fileDay = new Date(fileTs).setHours(0, 0, 0, 0);
        const filingDay = new Date(filingTs).setHours(0, 0, 0, 0);
        if (fileDay < filingDay) {
          return true; // Pre-filing draft — outdated! Needs fresh generation of filed return
        }
        return false; // Generated on or after filing date — permanent and immutable!
      }
    }
    // Return is filed, but filing date string not yet resolved — treat as valid until formdetails confirms
    return false;
  }

  // Unfiled / pending return: stale if older than 7 days
  return (Date.now() - fileTs >= GSTN_FILE_EXPIRY_MS);
}



const configR3B      = { key: 'G3B',    display: 'GSTR-3B',         apiCode: 'GSTR3B',  fileNameCode: 'R3B',  fileType: '',   fileTypeCode: '',    expFilingStatus: 'FIL', isQuarterly: false, isAnnual: false, needsFileGeneration: false, workflowType: WORKFLOW_TYPES.LIVE_DYNAMIC,    showGenerate: false };
const configR1       = { key: 'G1',     display: 'GSTR-1',          apiCode: 'GSTR1',   fileNameCode: 'R1',   fileType: '',   fileTypeCode: '',    expFilingStatus: 'FIL', isQuarterly: false, isAnnual: false, needsFileGeneration: false, workflowType: WORKFLOW_TYPES.LIVE_DYNAMIC,    showGenerate: true  };
const configR1Excel  = { key: 'G1EXL',  display: 'GSTR-1 (Excel)',  apiCode: 'GSTR1',   fileNameCode: 'R1',   fileType: 'EX', fileTypeCode: 'EXL', expFilingStatus: 'FIL', isQuarterly: false, isAnnual: false, needsFileGeneration: true,  workflowType: WORKFLOW_TYPES.ASYNC_GENERATED, showGenerate: false };
const configR2B      = { key: 'G2B',    display: 'GSTR-2B',         apiCode: 'GSTR2B',  fileNameCode: 'R2B',  fileType: '',   fileTypeCode: '',    expFilingStatus: 'NF',  isQuarterly: false, isAnnual: false, needsFileGeneration: false, workflowType: WORKFLOW_TYPES.GSTN_PUBLISHED,  showGenerate: false };
const configR2BExcel = { key: 'G2BEXL', display: 'GSTR-2B (Excel)', apiCode: 'GSTR2B',  fileNameCode: 'R2B',  fileType: 'EX', fileTypeCode: 'EXL', expFilingStatus: 'NF',  isQuarterly: false, isAnnual: false, needsFileGeneration: false, workflowType: WORKFLOW_TYPES.GSTN_PUBLISHED,  showGenerate: false };
const configR2A      = { key: 'G2A',    display: 'GSTR-2A',         apiCode: 'GSTR2A',  fileNameCode: 'R2A',  fileType: '',   fileTypeCode: '',    expFilingStatus: 'NF',  isQuarterly: false, isAnnual: false, needsFileGeneration: true,  workflowType: WORKFLOW_TYPES.ASYNC_GENERATED, showGenerate: true  };
const configR2AExcel = { key: 'G2AEXL', display: 'GSTR-2A (Excel)', apiCode: 'GSTR2A',  fileNameCode: 'R2A',  fileType: 'EX', fileTypeCode: 'EXL', expFilingStatus: 'NF',  isQuarterly: false, isAnnual: false, needsFileGeneration: true,  workflowType: WORKFLOW_TYPES.ASYNC_GENERATED, showGenerate: false };
const configR4       = { key: 'G4',     display: 'GSTR-4',          apiCode: 'GSTR4',   fileNameCode: 'R4',   fileType: '',   fileTypeCode: '',    expFilingStatus: 'FIL', isQuarterly: true,  isAnnual: false, needsFileGeneration: true,  workflowType: WORKFLOW_TYPES.ASYNC_GENERATED, showGenerate: true  };
const configR4A      = { key: 'G4A',    display: 'GSTR-4A',         apiCode: 'GSTR4A',  fileNameCode: 'R4A',  fileType: '',   fileTypeCode: '',    expFilingStatus: 'NF',  isQuarterly: true,  isAnnual: false, needsFileGeneration: true,  workflowType: WORKFLOW_TYPES.ASYNC_GENERATED, showGenerate: true  };
const configR9       = { key: 'G9',     display: 'GSTR-9',          apiCode: 'GSTR9',   fileNameCode: 'R9',   fileType: '',   fileTypeCode: '',    expFilingStatus: 'FIL', isQuarterly: false, isAnnual: true,  needsFileGeneration: true,  workflowType: WORKFLOW_TYPES.ASYNC_GENERATED, showGenerate: true  };
const configR9C      = { key: 'G9C',    display: 'GSTR-9C',         apiCode: 'GSTR9C',  fileNameCode: 'R9C',  fileType: '',   fileTypeCode: '',    expFilingStatus: 'FIL', isQuarterly: false, isAnnual: true,  needsFileGeneration: true,  workflowType: WORKFLOW_TYPES.ASYNC_GENERATED, showGenerate: true  };
const configR9Excel  = { key: 'G9EXL',  display: 'GSTR-9 (Excel)',  apiCode: 'GSTR9',   fileNameCode: 'R9',   fileType: 'EX', fileTypeCode: 'EXL', expFilingStatus: 'FIL', isQuarterly: false, isAnnual: true,  needsFileGeneration: true,  workflowType: WORKFLOW_TYPES.ASYNC_GENERATED, showGenerate: false };
const configR9CExcel = { key: 'G9CEXL', display: 'GSTR-9C (Excel)', apiCode: 'GSTR9C', fileNameCode: 'R9C',  fileType: 'EX', fileTypeCode: 'EXL', expFilingStatus: 'FIL', isQuarterly: false, isAnnual: true,  needsFileGeneration: true,  workflowType: WORKFLOW_TYPES.ASYNC_GENERATED, showGenerate: false };

// ── IMS Configs ───────────────────────────────────────────────────────────────
// IMS uses a unique 2-step workflow: call /imsweb/auth/api/ims/generateDoc to
// get a signed S3 URL, then download the ZIP from files.gst.gov.in via bgFetch.
// IMS does NOT use the standard /returns/auth/api/offline/download/generate URL.
// Both IMS_IN (inward) and IMS_OUT (outward) use the same endpoint; the portal
// differentiates internally based on the current filing cycle.
const configIms = { key: 'IMS', display: 'IMS', workflowType: WORKFLOW_TYPES.IMS_PORTAL, isQuarterly: false, isAnnual: false, needsFileGeneration: false, showGenerate: true,  apiCode: 'IMS', fileNameCode: 'IMS', fileType: '', fileTypeCode: '', expFilingStatus: '' };

const configR1A      = { key: 'G1A',    display: 'GSTR-1A',         apiCode: 'GSTR1A',  fileNameCode: 'R1A',  fileType: '',   fileTypeCode: '',    expFilingStatus: 'FIL', isQuarterly: false, isAnnual: false, needsFileGeneration: false, workflowType: WORKFLOW_TYPES.LIVE_DYNAMIC,    showGenerate: false };

const configR2X      = { key: 'G2X',    display: 'TDS/TCS',         apiCode: 'GSTR2X',  fileNameCode: 'R2X',  fileType: '',   fileTypeCode: '',    expFilingStatus: '',    isQuarterly: false, isAnnual: false, needsFileGeneration: true,  workflowType: WORKFLOW_TYPES.LIVE_DYNAMIC,    showGenerate: true  };
const configR2XExcel = { key: 'G2XEXL', display: 'TDS/TCS (Excel)', apiCode: 'GSTR2X',  fileNameCode: 'R2X',  fileType: 'EX', fileTypeCode: 'EXL', expFilingStatus: '',    isQuarterly: false, isAnnual: false, needsFileGeneration: true,  workflowType: WORKFLOW_TYPES.ASYNC_GENERATED, showGenerate: false };

const returnConfig = {
  [configR3B.key]:      configR3B,
  [configR1.key]:       configR1,
  [configR1A.key]:      configR1A,
  [configR1Excel.key]:  configR1Excel,
  [configR2A.key]:      configR2A,
  [configR2AExcel.key]: configR2AExcel,
  [configR2B.key]:      configR2B,
  [configR2BExcel.key]: configR2BExcel,
  [configR4.key]:       configR4,
  [configR4A.key]:      configR4A,
  [configR9.key]:       configR9,
  [configR9C.key]:      configR9C,
  [configR9Excel.key]:  configR9Excel,
  [configR9CExcel.key]: configR9CExcel,
  [configIms.key]:      configIms,
  [configR2X.key]:      configR2X,
  [configR2XExcel.key]: configR2XExcel
};

function isPreselectedReturn(key) {
  return key === configR1.key || key === configR1Excel.key || key === configR2B.key || key === configR2BExcel.key;
}

const ACTION_MAP = Object.freeze({
  'G3B':     { pdf: true,  json: true,  excel: true  },
  'G1':      { pdf: true,  json: true,  excel: true  },
  'G1A':     { pdf: true,  json: true,  excel: true  },
  'G1EXL':   { pdf: false, json: false, excel: true  },
  'G2A':     { pdf: false, json: true,  excel: true  },
  'G2AEXL':  { pdf: false, json: false, excel: true  },
  'G2B':     { pdf: true,  json: true,  excel: true  },
  'G2BEXL':  { pdf: false, json: false, excel: true  },
  'G4':      { pdf: false, json: true,  excel: false },
  'G4A':     { pdf: false, json: true,  excel: false },
  'G9':      { pdf: true,  json: true,  excel: true  },
  'G9EXL':   { pdf: false, json: false, excel: true  },
  'G9C':     { pdf: true,  json: true,  excel: true  },
  'G9CEXL':  { pdf: false, json: false, excel: true  },
  'IMS':     { pdf: false, json: true,  excel: true  },
  'G2X':     { pdf: false, json: true,  excel: true  },
  'G2XEXL':  { pdf: false, json: false, excel: true  }
});

function getActionsFor(key) { return ACTION_MAP[key] || { pdf: false, json: true, excel: false }; }
const DOM_CACHE = new Map();
function getElement(id) {
  if (!id) return null;
  const cached = DOM_CACHE.get(id);
  if (cached && cached.isConnected) return cached;
  const el = document.getElementById(id);
  if (el) DOM_CACHE.set(id, el);
  return el;
}
function formatNumber(n, l)  { let r = '' + n; while (r.length < l) r = '0' + r; return r; }

function get2bPublishInfo(period) {
  const { mm, yyyy } = parseReturnPeriod(period.value);
  const publishMm   = mm === 12 ? 1 : mm + 1;
  const publishYyyy = mm === 12 ? yyyy + 1 : yyyy;
  const publishDate = new Date(publishYyyy, publishMm - 1, 14, 0, 0, 0, 0);
  const monthName   = getMonthName(publishMm);
  return { mm, yyyy, publishMm, publishYyyy, monthName, publishDate, isQuarterEnd: mm % 3 === 0, isBeforePublishDate: new Date() < publishDate };
}

function getFilingFrequency(apiResponse) {
  if (!apiResponse || !apiResponse.data || !apiResponse.data.quarters || !Array.isArray(apiResponse.data.quarters) || apiResponse.data.quarters.length === 0) return 'Monthly';
  const quarters      = apiResponse.data.quarters;
  const activeQuarter = quarters.find(q => q.is_active === 'Y' || q.isActive === 'Y' || q.active === true) || quarters[quarters.length - 1];
  return activeQuarter && (activeQuarter.profile === 'Q' || activeQuarter.userPref === 'Q') ? 'Quarterly' : 'Monthly';
}

const _escDiv = (typeof document !== 'undefined') ? document.createElement('div') : null;
function escapeHtml(str) {
  if (str == null) return '';
  if (!_escDiv) return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  _escDiv.textContent = str;
  return _escDiv.innerHTML;
}

function makeJsonFileName(gstReturnType, gstin, period) {
  const d         = new Date();
  const dateStamp = formatNumber(d.getDate(), 2) + formatNumber(d.getMonth() + 1, 2) + d.getFullYear();
  return `returns_${dateStamp}_${gstReturnType}_${gstin}_${period}`;
}

function makeZipFileName(gstReturnType, gstin, period, tag) {
  const d         = new Date();
  const dateStamp = d.getFullYear() + formatNumber(d.getMonth() + 1, 2) + formatNumber(d.getDate(), 2);
  return `${gstin}_${gstReturnType}${tag ? `_${tag}` : ''}_${period}_${dateStamp}`;
}

function parseReturnPeriod(periodValue) {
  if (!periodValue || typeof periodValue !== 'string' || periodValue.length !== 6 || !/^\d{6}$/.test(periodValue))
    throw new Error(`Invalid period format: "${periodValue}". Expected MMYYYY`);
  const mm   = parseInt(periodValue.substring(0, 2), 10);
  const yyyy = parseInt(periodValue.substring(2, 6), 10);
  if (mm < 1 || mm > 12 || yyyy < 2017 || yyyy > 2099) throw new Error('Out of bounds parameters');
  return { mm, yyyy, original: periodValue };
}

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function getMonthName(monthNum) {
  return MONTHS_SHORT[(monthNum - 1 + 12) % 12] || '';
}

const MONTH_NAMES_FULL = ['january','february','march','april','may','june','july','august','september','october','november','december'];
const MONTH_NAMES_SHORT_LOWER = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];

function parseDropdownMonthNum(m) {
  if (typeof m === 'number') return m;
  if (!m) return null;
  if (typeof m === 'object') {
    return parseDropdownMonthNum(m.month || m.name || m.val || m.value || m.monthNumber);
  }
  const str = String(m).trim().toLowerCase();
  if (/^\d{6}$/.test(str)) {
    return parseInt(str.substring(0, 2), 10);
  }
  if (/^\d{1,2}$/.test(str)) {
    return parseInt(str, 10);
  }
  const fullIdx = MONTH_NAMES_FULL.indexOf(str);
  if (fullIdx !== -1) return fullIdx + 1;
  const shortIdx = MONTH_NAMES_SHORT_LOWER.indexOf(str.substring(0, 3));
  if (shortIdx !== -1) return shortIdx + 1;
  return null;
}

// ── Relative-time helper — drop-in replacement for moment().fromNow() (no lib required) ──
const _rpRelTime = new Intl.RelativeTimeFormat('en', { numeric: 'always' });
const _rpRelUnits = [
  { ms: 31536000000, unit: 'year' },
  { ms: 2592000000,  unit: 'month' },
  { ms: 86400000,    unit: 'day' },
  { ms: 3600000,     unit: 'hour' },
  { ms: 60000,       unit: 'minute' }
];

function formatRelativeTime(dateStr) {
  if (!dateStr) return '';
  const ts = parsePortalDate(dateStr);
  if (isNaN(ts)) return dateStr;
  const diff = ts - Date.now();
  const abs = Math.abs(diff);
  if (abs < 60000) return diff >= 0 ? 'in a few seconds' : 'a few seconds ago';
  for (const { ms, unit } of _rpRelUnits) {
    if (abs >= ms) return _rpRelTime.format(Math.round(diff / ms), unit);
  }
}

function getFileGenStatus(resp) {
  if (resp.status === undefined) return 'Invalid response received';
  if (resp.status !== 1) {
    if (resp.error === undefined) return 'Unknown error occurred';
    if (resp.error.errorCode && resp.error.errorCode.startsWith('RTN_24')) return 'Generating file...';
    // Raw portal error messages (e.g. "System Failure", "No Record Found") are transient
    // server-side errors — return null so callers treat the period as Available rather
    // than surfacing an alarming error string in the Portal Status column.
    const rawMsg = resp.error.message || '';
    const isTransient = rawMsg.toLowerCase().includes('system failure') ||
                        rawMsg.toLowerCase().includes('no record found') ||
                        rawMsg.toLowerCase().includes('service unavailable') ||
                        rawMsg.toLowerCase().includes('internal error') ||
                        rawMsg.toLowerCase().includes('server error') ||
                        rawMsg.toLowerCase().includes('try after sometime');
    if (isTransient) return null;
    return rawMsg || 'Unknown error occurred';
  }
  if (resp.data === undefined) return 'No response received';
  if (resp.data.status === 0)   return null;
  return resp.data.status === 1 ? 'Generating file...' : resp.data.msg;
}

function inspectOfflineFileGenResponse(res) {
  if (!res || !res.status) return { state: 'UNKNOWN' };
  let resp = null;
  try {
    resp = (typeof res.response === 'string') ? JSON.parse(res.response) : res.response;
  } catch (_) {
    return { state: 'UNKNOWN' };
  }
  if (!resp || typeof resp !== 'object') return { state: 'UNKNOWN' };

  const data = resp.data;
  const error = resp.error;
  const dataStatus = (data && typeof data.status !== 'undefined') ? Number(data.status) : -1;
  const urls = (data && Array.isArray(data.url)) ? data.url : (data && data.url ? [data.url] : []);
  const msg = String(data?.msg || error?.message || '').toLowerCase();
  const errCode = String(error?.errorCode || '');
  const isDownloadNotice = msg.includes('you have downloaded') || msg.includes('click on the link');
  const dateStr = data?.date || data?.gendt || data?.gen_dt || '';
  const timeStr = data?.time || '';
  const timeStampStr = data?.timeStamp || '';

  // 1. Ready / Generated: status 0 with download URL, notice, date, or timestamp
  if (dataStatus === 0 && (urls.length || isDownloadNotice || dateStr || timeStampStr)) {
    return {
      state: 'AVAILABLE',
      date: dateStr,
      time: timeStr,
      timeStamp: timeStampStr,
      urls: urls
    };
  }

  // 2. Actively Generating: status 1, RTN_24 error, or in-progress message
  if (
    dataStatus === 1 ||
    errCode.startsWith('RTN_24') ||
    msg.includes('in progress') ||
    msg.includes('generating') ||
    msg.includes('take upto 20 minutes') ||
    msg.includes('take up to 20 minutes')
  ) {
    return { state: 'GENERATING' };
  }

  // 3. Transient / rate limit errors
  const isTransient = msg.includes('system failure') ||
                      msg.includes('service unavailable') ||
                      msg.includes('internal error') ||
                      msg.includes('server error') ||
                      msg.includes('try after sometime');
  if (isTransient) {
    return { state: 'TRANSIENT_ERROR' };
  }

  // 4. File Not Yet Generated on GST Portal
  return { state: 'NOT_GENERATED' };
}

function getReturnInfo(info, gstReturnType) {
  if (!info || !info.data || !info.data.user || !Array.isArray(info.data.user)) return { status: 'NOT_APPLICABLE' };
  const altType = gstReturnType.startsWith('GSTR') ? gstReturnType.replace('GSTR', 'R') : (gstReturnType.startsWith('R') ? 'GSTR' + gstReturnType.slice(1) : gstReturnType);
  for (const u of info.data.user) {
    if (!u.returns || !Array.isArray(u.returns)) continue;
    for (const r of u.returns) {
      if (r.return_ty === gstReturnType || r.return_ty === altType || (r.rtn_typ && (r.rtn_typ === gstReturnType || r.rtn_typ === altType))) {
        return r;
      }
    }
  }
  return { status: 'NOT_APPLICABLE' };
}

function displayRegType(regType) {
  return (regType === 'NT' || regType === 'TP') ? 'Regular' : (regType === 'CA' ? 'Casual' : (regType === 'CO' ? 'Composition' : (regType === 'SD' ? 'SEZ Developer' : (regType === 'SU' ? 'SEZ Unit' : regType || '—'))));
}

function extractStatusFromData(data) {
  if (!data) return '';
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch (_) {}
  }
  const obj = (data && data.data) ? data.data : data;
  if (!obj || typeof obj !== 'object') return '';

  // Authoritative fields in GST Portal Profile: statusDesc, stsDesc, taxpayerStatus, sts
  const rawDesc = obj.statusDesc || obj.stsDesc || obj.taxpayerStatus || obj.sts;
  if (rawDesc && typeof rawDesc === 'string') {
    const s = rawDesc.trim();
    const upper = s.toUpperCase();
    if (upper === 'ACT' || upper.includes('ACTIVE')) return 'Active';
    if (upper === 'SUS' || upper.includes('SUSPEND')) return 'Suspended';
    if (upper === 'CNL' || upper.includes('CANCEL')) return 'Cancelled';
    return s;
  }

  // Check explicit status string
  if (obj.status && typeof obj.status === 'string' && !obj.status.match(/^\d+$/)) {
    const upper = obj.status.trim().toUpperCase();
    if (upper === 'ACTIVE' || upper === 'ACT' || upper.includes('ACTIVE')) return 'Active';
    if (upper === 'SUSPENDED' || upper === 'SUS' || upper.includes('SUSPEND')) return 'Suspended';
    if (upper === 'CANCELLED' || upper === 'CNL' || upper.includes('CANCEL')) return 'Cancelled';
  }

  // Application status (appStatus) — in GSTN, 'C' is Completed/Closed/Central, NOT Cancelled!
  if (obj.appStatus) {
    const a = String(obj.appStatus).trim().toUpperCase();
    if (a === 'A' || a === 'ACT' || a.includes('ACTIVE')) return 'Active';
    if (a === 'S' || a === 'SUS' || a.includes('SUSPEND')) return 'Suspended';
    if (a === 'CNL' || a.includes('CANCEL')) return 'Cancelled';
  }
  return '';
}

function getCachedTaxpayerStatus(gstin) {
  if (!gstin) return '';
  try {
    const s = localStorage.getItem(`_rp_status_${gstin.trim().toUpperCase()}`) || '';
    return (s && s !== '—') ? s : '';
  } catch (_) {
    return '';
  }
}

function setCachedTaxpayerStatus(gstin, status) {
  if (!gstin || !status || status === '—') return;
  try {
    localStorage.setItem(`_rp_status_${gstin.trim().toUpperCase()}`, status);
  } catch (_) {}
}

let _inFlightTaxpayerStatusPromise = null;

async function fetchTaxpayerStatusFromPortal(bypassCache = false) {
  if (!bypassCache && _inFlightTaxpayerStatusPromise) {
    return _inFlightTaxpayerStatusPromise;
  }

  const p = (async () => {
    try {
      let raw = null;
      let status = '';
      let targetGstin = session.gstin || '';
      let profileDetail = null;

      // 1. Authoritative profile detail API fetch via background SW (DEFAULT PRIMARY CHECK)
      // /services/auth/profile/detail on services.gst.gov.in is the definitive source of truth for taxpayer status:
      // sts: "Suspended" | "Active" | "Cancelled suo-moto"
      // NOTE: This endpoint strictly requires HTTP method POST with body: '{}'
      const primaryProfileUrl = 'https://services.gst.gov.in/services/auth/profile/detail';
      try {
        const res = await bgFetch({
          url: primaryProfileUrl,
          method: 'POST',
          body: '{}',
          bypassCache: Boolean(bypassCache),
          headers: {
            'Accept': 'application/json, text/plain, */*',
            'Content-Type': 'application/json;charset=UTF-8'
          }
        }).catch(() => null);

        const resData = res?.response || res?.body;
        if (resData && typeof resData === 'string' && !resData.trim().startsWith('<')) {
          const st = extractStatusFromData(resData);
          if (st) {
            raw = resData;
            status = st;
          }
        } else if (resData && typeof resData === 'object' && resData.status !== false) {
          const st = extractStatusFromData(resData);
          if (st) {
            raw = resData;
            status = st;
          }
        }
      } catch (err) {
        console.debug('[ReturnPilot] Primary profile/detail fetch note:', err);
      }

      // If primary domain profile was unavailable, probe alternate return domain
      if (!status) {
        try {
          const altProfileUrl = 'https://return.gst.gov.in/services/auth/profile/detail';
          const altRes = await bgFetch({
            url: altProfileUrl,
            method: 'POST',
            body: '{}',
            bypassCache: Boolean(bypassCache),
            headers: {
              'Accept': 'application/json, text/plain, */*',
              'Content-Type': 'application/json;charset=UTF-8'
            }
          }).catch(() => null);
          const altData = altRes?.response || altRes?.body;
          if (altData && typeof altData === 'string' && !altData.trim().startsWith('<')) {
            const st = extractStatusFromData(altData);
            if (st) { raw = altData; status = st; }
          } else if (altData && typeof altData === 'object' && altData.status !== false) {
            const st = extractStatusFromData(altData);
            if (st) { raw = altData; status = st; }
          }
        } catch (_) {}
      }

      // Parse profile detail payload
      if (raw) {
        let parsed = null;
        if (typeof raw === 'string') {
          try { parsed = JSON.parse(raw); } catch (_) {}
        } else if (typeof raw === 'object') {
          parsed = raw;
        }
        profileDetail = (parsed && parsed.data) ? parsed.data : parsed;
        if (profileDetail?.gstin) {
          targetGstin = profileDetail.gstin.trim().toUpperCase();
          if (!session.gstin) session.gstin = targetGstin;
        }
      }

      // 2. Active Tab DOM / Storage fallback (only if profile API could not be reached)
      if (!status && currentActiveTabId) {
        try {
          const pageInfo = await getPageTaxpayerInfoAsync(currentActiveTabId);
          if (pageInfo) {
            if (pageInfo.gstin && !targetGstin) targetGstin = pageInfo.gstin.trim().toUpperCase();
            if (pageInfo.taxpayerStatus) {
              status = extractStatusFromData(pageInfo.taxpayerStatus) || pageInfo.taxpayerStatus;
            }
          }
        } catch (_) {}
      }

      if (targetGstin && status && status !== '—') {
        setCachedTaxpayerStatus(targetGstin, status);
      }

      if (status) {
        session.taxpayerStatus = status;
        renderTaxpayerStatus(session.taxpayerStatus);
      }

      return {
        status: status || '',
        gstin: targetGstin || '',
        raw: raw,
        data: profileDetail,
        bname: profileDetail?.tradeNam || profileDetail?.lgnm || '',
        regType: profileDetail?.dty || ''
      };
    } catch (err) {
      console.debug('[ReturnPilot] Taxpayer status fetch note:', err);
    } finally {
      _inFlightTaxpayerStatusPromise = null;
    }
    return { status: '', gstin: '', data: null, bname: '', regType: '' };
  })();

  _inFlightTaxpayerStatusPromise = p;
  return p;
}

function renderTaxpayerStatus(status) {
  const el = getElement('taxpayerStatus');
  if (!el) return;
  const s = (status || '').trim();
  if (!s || s === '—') {
    el.textContent = '—';
    el.className = 'meta-value rt-status-type';
    el.title = 'Taxpayer Registration Status: Unknown';
    return;
  }
  const lower = s.toLowerCase();
  el.textContent = s.length > 15 && lower.includes('cancel') ? 'Cancelled' : s;
  el.title = `Taxpayer Registration Status: ${s}`;
  if (lower.includes('active')) {
    el.className = 'meta-value rt-status-type rt-status-active';
  } else if (lower.includes('suspend')) {
    el.className = 'meta-value rt-status-type rt-status-suspended';
  } else if (lower.includes('cancel')) {
    el.className = 'meta-value rt-status-type rt-status-cancelled';
  } else {
    el.className = 'meta-value rt-status-type';
  }
}

function formatDdMmYyyy(dateInput) {
  if (!dateInput) return '—';
  const d = (dateInput instanceof Date) ? dateInput : new Date(dateInput);
  if (isNaN(d.getTime())) return String(dateInput);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

function displayFilingStatus(filingStatus) {
  if (!filingStatus || filingStatus === 'NOT_APPLICABLE' || filingStatus === 'NOT_AVAIL' || filingStatus === 'NO_DATA') return 'Not Applicable';
  if (filingStatus === 'NIL_FILED' || filingStatus === 'NIL') return 'Nil Filed';
  return filingStatus === 'FIL' ? 'Filed' : (filingStatus === 'NF' || filingStatus === 'NOT_FILED' || filingStatus === 'RTF' || filingStatus === 'NCNF' ? 'Not Filed' : (filingStatus === 'FRZ' ? 'Submitted' : filingStatus));
}

function showStatus(msg) {
  const divStatus     = getElement('status');
  const divStatusText = getElement('statusText');

  if (typeof rpLog !== 'undefined' && rpLog) {
    if (msg) rpLog.debug('STATUS_OVERLAY_SHOW', `showStatus: ${msg}`);
    else rpLog.debug('STATUS_OVERLAY_HIDE', 'showStatus dismissed');
  }

  if (!msg) {
    if (divStatus) divStatus.hidden = true;
    if (divStatusText) divStatusText.textContent = '';
  } else {
    if (divStatus) divStatus.hidden = false;
    if (divStatusText) divStatusText.textContent = msg;
  }
}

// ── Two-Tier DOM Scheduler: microtask flush + RAF batching ──
// Tier 1: queueMicrotask fires synchronously after the current promise chain
//         resolves — this eliminates the ~16ms "wait for next paint frame"
//         delay that was adding latency between API_RESP and visible PILL_UPDATE.
// Tier 2: All writes queued in the same microtask tick are then flushed
//         together in a single RAF to avoid layout thrashing on parallel bursts.
let _pendingDomWrites = [];
let _rafScheduled = false;
let _microtaskScheduled = false;

function scheduleDOMUpdate(fn) {
  if (typeof requestAnimationFrame === 'undefined') {
    fn();
    return;
  }
  _pendingDomWrites.push(fn);
  // Schedule a microtask flush — fires after current .then() chain completes,
  // before any paint, collecting all writes queued in this tick.
  if (!_microtaskScheduled) {
    _microtaskScheduled = true;
    queueMicrotask(() => {
      _microtaskScheduled = false;
      if (_pendingDomWrites.length === 0) return;
      // If we have multiple pending writes, batch them in a RAF to avoid
      // repeated style recalculation. Single write goes direct (no RAF penalty).
      if (_pendingDomWrites.length === 1) {
        const task = _pendingDomWrites[0];
        _pendingDomWrites = [];
        try { task(); } catch (_) {}
      } else if (!_rafScheduled) {
        _rafScheduled = true;
        requestAnimationFrame(() => {
          _rafScheduled = false;
          const tasks = _pendingDomWrites.slice();
          _pendingDomWrites = [];
          for (let i = 0; i < tasks.length; i++) {
            try { tasks[i](); } catch (_) {}
          }
        });
      }
    });
  }
}

// Swap an SVG element's attributes and children without removing/reinserting
// the node. Using outerHTML to replace an SVG causes a DOM removal + insertion
// which produces a visible flicker on every state update cycle.
function replaceSvgContent(existingSvg, newSvgHtml) {
  if (!existingSvg) return;
  // Parse new SVG via a temporary div so we can read its attributes cleanly
  const wrapper = document.createElement('div');
  wrapper.innerHTML = newSvgHtml;
  const parsed = wrapper.querySelector('svg');
  if (!parsed) return;
  // Sync attributes
  const keep = new Set(Array.from(parsed.attributes).map(a => a.name));
  Array.from(existingSvg.attributes).forEach(a => { if (!keep.has(a.name)) existingSvg.removeAttribute(a.name); });
  Array.from(parsed.attributes).forEach(a => { existingSvg.setAttribute(a.name, a.value); });
  // Sync inner content
  existingSvg.innerHTML = parsed.innerHTML;
}

function setStatusPill(el, text, kind) {
  if (!el) return;
  const targetClass = 'rt-status-pill ' + (kind || 'rt-status-loading');

  // If there is an in-flight pending DOM write scheduled for this element:
  if (el._pendingText !== undefined && el._pendingText !== null) {
    // If the in-flight write is ALREADY going to write this exact text and kind, nothing to do
    if (el._pendingText === text && el._pendingKind === kind) return;
  } else {
    // No in-flight write queued: check if the DOM already reflects this exact text and class
    if (el.textContent === text && el.className === targetClass) return;
  }

  el._pendingText = text;
  el._pendingKind = kind;
  if (typeof rpLog !== 'undefined' && rpLog) {
    const elId = el.id || el.getAttribute('id') || 'pill';
    rpLog.debug('PILL_UPDATE', `${elId} -> "${text}" (${kind || 'loading'})`);
  }
  scheduleDOMUpdate(() => {
    // If a subsequent update superseded this one before RAF fired, discard stale task
    if (el._pendingText !== null && el._pendingText !== undefined && el._pendingText !== text) return;
    el.textContent = text;
    el.className   = targetClass;
    el.setAttribute('aria-live', kind === 'rt-status-loading' ? 'polite' : 'off');
    el.setAttribute('aria-busy', kind === 'rt-status-loading' ? 'true' : 'false');
    el._pendingText = null;
    el._pendingKind = null;

    // Contextual tooltips for professional status clarity
    if (text === 'Live Dynamic' || kind === 'rt-status-dynamic' || text === 'Auto-Generated') {
      el.title = 'GSTR-2A auto-drafted statement: compiles continuously from supplier filings and e-invoices.';
    } else if (text === 'Checking…' || kind === 'rt-status-loading') {
      el.title = 'Verifying live status with GST Portal…';
    } else if (text === 'Generating…') {
      el.title = 'GST Portal is compiling return files for this period…';
    } else if (text === 'Available') {
      el.title = 'Return files are available for download';
    } else if (text === '—' && !el.title) {
      el.title = 'Not applicable or unfiled for this period';
    }

    // Synchronize parent table row status border accent
    const tr = el.closest('tr');
    if (tr) {
      const isFilingCell = Boolean(el.closest('td.rt-status-filing') || (el.id && el.id.startsWith('filing-status-')));
      const hasExistingFilingAccent = tr.classList.contains('row-status-filed') || tr.classList.contains('row-status-unfiled');
      const l = (text || '').toLowerCase();
      if (l === 'filed' || l === 'nil filed' || l === 'auto-generated' || l === 'live dynamic' || kind === 'rt-status-filed' || kind === 'rt-status-dynamic') {
        tr.classList.remove('row-status-unfiled', 'row-status-na');
        tr.classList.add('row-status-filed');
      } else if (l === 'not filed' || l === 'pending' || kind === 'rt-status-notfiled' || kind === 'rt-status-unfiled') {
        tr.classList.remove('row-status-filed', 'row-status-na');
        tr.classList.add('row-status-unfiled');
      } else if ((kind === 'rt-status-na' || l === 'not applicable' || l === 'quarterly' || l === 'optional (iff)' || l === 'no data' || l === 'no itc') && (!hasExistingFilingAccent || isFilingCell)) {
        tr.classList.remove('row-status-filed', 'row-status-unfiled');
        tr.classList.add('row-status-na');
      }
    }
  });
}

function formatGenStatusText(d, t) {
  if (!d && !t) return 'Generated';
  const cleanTime = (t || '').trim().slice(0, 5); // e.g. "15:45"
  const cleanDate = (d || '').trim();
  const dParts = cleanDate.split('/');
  const now = new Date();
  const isToday = dParts.length === 3 && 
    parseInt(dParts[0], 10) === now.getDate() && 
    parseInt(dParts[1], 10) === (now.getMonth() + 1) && 
    parseInt(dParts[2], 10) === now.getFullYear();

  if (isToday && cleanTime) {
    return `Generated ${cleanTime}`;
  }
  if (cleanDate.length >= 5) {
    return `Generated ${cleanDate.slice(0, 5)}`;
  }
  if (cleanTime) {
    return `Generated ${cleanTime}`;
  }
  return 'Generated';
}

function showGenTime(el, d, t) {
  if (!el) return;
  const relText = formatRelativeTime(`${d} ${t}`);
  const displayText = formatGenStatusText(d, t);
  if (el.textContent === displayText && el.className.includes('rt-status-filed')) return;
  if (el._pendingText === displayText && el._pendingKind === 'rt-status-filed') return;
  el._pendingText = displayText;
  el._pendingKind = 'rt-status-filed';
  scheduleDOMUpdate(() => {
    if (el._pendingText !== null && el._pendingText !== displayText) return;
    el.className   = 'rt-status-pill rt-status-filed';
    el.textContent = '';
    const a = document.createElement('a');
    a.setAttribute('data-toggle', 'tooltip');
    a.setAttribute('title', `Generated on ${d} ${t}${relText ? ' (' + relText + ')' : ''}`);
    a.textContent = displayText;
    el.appendChild(a);
    el._pendingText = null;
    el._pendingKind = null;
    if (typeof rpLog !== 'undefined' && rpLog) {
      rpLog.debug('PILL_UPDATE', `${el.id || 'pill'} -> "${displayText}" (rt-status-filed)`);
    }
  });
}

function showGenDate(el, dateStr) {
  if (!el || !dateStr) return;
  const relText = formatRelativeTime(dateStr);
  const displayText = formatGenStatusText(dateStr, '');
  if (el.textContent === displayText && el.className.includes('rt-status-filed')) return;
  if (el._pendingText === displayText && el._pendingKind === 'rt-status-filed') return;
  el._pendingText = displayText;
  el._pendingKind = 'rt-status-filed';
  scheduleDOMUpdate(() => {
    if (el._pendingText !== null && el._pendingText !== displayText) return;
    el.className   = 'rt-status-pill rt-status-filed';
    el.textContent = '';
    const a = document.createElement('a');
    a.setAttribute('data-toggle', 'tooltip');
    a.setAttribute('title', `Generated on ${dateStr}${relText ? ' (' + relText + ')' : ''}`);
    a.textContent = displayText;
    el.appendChild(a);
    el._pendingText = null;
    el._pendingKind = null;
    if (typeof rpLog !== 'undefined' && rpLog) {
      rpLog.debug('PILL_UPDATE', `${el.id || 'pill'} -> "${displayText}" (rt-status-filed)`);
    }
  });
}

function syncSidebarToValue(value) {
  if (!value) return;
  scheduleDOMUpdate(() => {
    document.querySelectorAll('.sidebar-item').forEach(el => { el.classList.toggle('active', el.dataset.value === value); });
  });
}

function showBannerNotice(msg, autoHideMs = 6000) {
  const bannerWrap = getElement('banner-generating');
  if (!bannerWrap) return;
  const innerBanner = bannerWrap.querySelector('.generate-banner') || bannerWrap;
  innerBanner.innerHTML = msg;
  bannerWrap.hidden = false;
  
  if (window._rpBannerTimeout) clearTimeout(window._rpBannerTimeout);
  if (autoHideMs > 0) {
    window._rpBannerTimeout = setTimeout(() => {
      bannerWrap.hidden = true;
    }, autoHideMs);
  }
}

function showGeneratingBanner() {
  showBannerNotice('GST portal is generating your return files. Please refresh in a few minutes.', 0);
}

function getAvailableActions(period, cfg) {
  if (!cfg || !period) return [];

  const fStatus = (period.filingStatus || '').toUpperCase();
  const fLabel  = (period.filingLabel || '').toUpperCase();
  const state   = period.currentState;

  // 1. TDS and TCS Credit Received (GSTR-2X) - Download actions ONLY shown when data is available
  if (cfg && (cfg.key === configR2X.key || cfg.key === 'G2X' || cfg.key === configR2XExcel.key)) {
    if (state === RETURN_STATES.GENERATING) {
      return ['generate-loading', 'json', 'excel'];
    }
    const isFiled = (fStatus === 'FIL' || fStatus === 'FILED' || fLabel === 'FILED');
    const count = period.gstr2xRecordCount;
    const hasRecords = (typeof count === 'number' && count > 0);
    const hasData = hasRecords || isFiled || (period.currentMessage === 'Available');
    if (!hasData) {
      return [];
    }
    return ['generate', 'json', 'excel'];
  }

  // 2. Invoice Management System (IMS) - Generate, JSON, and Excel always available
  if (cfg && (cfg.workflowType === WORKFLOW_TYPES.IMS_PORTAL || cfg.key === configIms.key || cfg.key === 'IMS')) {
    if (state === RETURN_STATES.GENERATING) {
      return ['generate-loading', 'json', 'excel'];
    }
    return ['generate', 'json', 'excel'];
  }

  // 3. Universal gate: Any period that is Not Applicable, No Data, Blocked, Quarterly M1/M2, or Error has NO actions
  if (
    state === RETURN_STATES.NO_DATA ||
    fStatus === 'NOT_APPLICABLE' ||
    fStatus === 'NOT_AVAIL' ||
    fStatus === 'NO_DATA' ||
    fStatus === 'N' ||
    fLabel === 'NOT APPLICABLE' ||
    fLabel === 'NOT AVAILABLE' ||
    fLabel === 'NO DATA' ||
    fLabel === 'NO ITC' ||
    fLabel === 'QUARTER-END GENERATION' ||
    fLabel === 'QUARTERLY' ||
    fLabel === 'QUARTER END' ||
    fLabel === 'BLOCKED' ||
    fLabel === 'ERROR' ||
    fLabel === 'INVALID PERIOD' ||
    fLabel === 'ACCESS DENIED'
  ) {
    return [];
  }

  // 3. Statutory Filing Returns Gate (GSTR-1, GSTR-1A, GSTR-3B, GSTR-4, GSTR-9, GSTR-9C)
  const isFilingReturn = cfg.expFilingStatus === 'FIL';

  if (isFilingReturn) {
    const isFiled     = fStatus === 'FIL' || fStatus === 'FILED' || fLabel === 'FILED';
    const isSubmitted = fStatus === 'FRZ' || fStatus === 'SUBMITTED' || fLabel === 'SUBMITTED';
    const isNilFiled  = period.isNil || fStatus === 'NIL' || fStatus === 'NIL_FILED' || fLabel === 'NIL FILED';
    const isUnfiled   = fStatus === 'NF' || fStatus === 'NOT_FILED' || fStatus === 'RTF' || fStatus === 'NCNF' || fLabel === 'NOT FILED' || fLabel === 'PENDING';

    // ── Dedicated GSTR-9 Handler ──
    if (cfg.key === configR9.key) {
      const available = ['g9-8a-excel']; // Table 8A Excel is always available for GSTR-9 (portal comparison tool)
      if (isFiled) {
        available.push('summary-pdf', 'json', 'excel');
      } else {
        available.push('g9-g1-pdf', 'g9-g3b-pdf');
      }
      return available;
    }

    // If explicitly unfiled, or if status has not been confirmed as Filed / Submitted / Nil Filed:
    // NO download or generate actions permitted
    if (isUnfiled || (!isFiled && !isSubmitted && !isNilFiled)) {
      return [];
    }

    // If Nil Filed: Only allow summary PDF report (Nil returns contain no transactional JSON/Excel data)
    if (isNilFiled) {
      return ['summary-pdf'];
    }

    // Return confirmed FILED or SUBMITTED
    const available = [];
    if (cfg.key === configR3B.key) {
      available.push('json', 'summary-pdf');
    } else if (cfg.key === configR1A.key || cfg.key === 'G1A') {
      available.push('json', 'excel', 'summary-pdf', 'detail-pdf');
    } else if (cfg.key === configR1.key || cfg.key === configR1Excel.key) {
      if (state === RETURN_STATES.GENERATING) {
        available.push('generate-loading', 'json', 'excel', 'summary-pdf');
      } else {
        if (cfg.showGenerate) available.push('generate');
        available.push('json', 'excel', 'summary-pdf');
      }
    } else if (cfg.key === configR9C.key || cfg.key === configR9CExcel.key) {
      available.push('json', 'excel', 'summary-pdf');
    } else if (cfg.key === configR4.key) {
      available.push('json');
    } else {
      const baseActions = getActionsFor(cfg.key);
      if (cfg.showGenerate) available.push('generate');
      if (baseActions.json) available.push('json');
      if (baseActions.excel) available.push('excel');
      if (baseActions.pdf) available.push('summary-pdf');
    }
    return available;
  }

  // 3. Auto-Drafted Statements (GSTR-2A, GSTR-2B, IMS)
  if (cfg.key === configR2B.key || cfg.key === configR2BExcel.key) {
    if (fLabel === 'PENDING' || fLabel === 'ACTION NEEDED' || fLabel === 'DELAYED') {
      return [];
    }
    if (state === RETURN_STATES.AVAILABLE || state === RETURN_STATES.DOWNLOADED || fLabel === 'AUTO-GENERATED') {
      return ['json', 'excel', 'summary-pdf', 'detail-pdf'];
    }
    if (state === RETURN_STATES.CHECKING || state === RETURN_STATES.DOWNLOADING) {
      return ['json', 'excel', 'summary-pdf', 'detail-pdf'];
    }
    return [];
  }

  if (cfg.workflowType === WORKFLOW_TYPES.IMS_PORTAL || cfg.key === configIms.key) {
    if (state === RETURN_STATES.GENERATING) {
      return ['generate-loading', 'json', 'excel'];
    }
    return ['generate', 'json', 'excel'];
  }

  if (cfg.key === configR2A.key || cfg.key === configR2AExcel.key) {
    if (state === RETURN_STATES.GENERATING) {
      return ['generate-loading', 'json', 'excel'];
    }
    return ['generate', 'json', 'excel'];
  }

  // Fallback for any other return
  const available = [];
  const baseActions = getActionsFor(cfg.key);
  if (cfg.showGenerate) available.push('generate');
  if (baseActions.json) available.push('json');
  if (baseActions.excel) available.push('excel');
  if (baseActions.pdf) available.push('summary-pdf');
  return available;
}

function renderRowActionsHtml(period, cfg) {
  // If period is not settled yet (actively checking / preloading live status without known filing status),
  // render calm, cohesive ghost action capsules instead of premature colored buttons.
  // If the filing status is already known (e.g. from cache: Filed, Not Filed, etc.), render actual buttons immediately.
  const isStatusKnown = Boolean(period && period.filingLabel && period.filingLabel !== 'Checking…');
  if (period && period._settled === false && !isStatusKnown) {
    const key = cfg ? cfg.key : '';
    let ghostPills = [];
    if (key === 'G3B') {
      ghostPills = ['rt-skeleton-btn-json', 'rt-skeleton-btn-pdf'];
    } else if (key === 'R4' || (typeof configR4 !== 'undefined' && key === configR4?.key)) {
      ghostPills = ['rt-skeleton-btn-json'];
    } else if (key === 'IMS' || (typeof WORKFLOW_TYPES !== 'undefined' && cfg?.workflowType === WORKFLOW_TYPES?.IMS_PORTAL)) {
      ghostPills = ['rt-skeleton-btn-gen', 'rt-skeleton-btn-json', 'rt-skeleton-btn-excel'];
    } else if (key === 'G2X' || key === 'G2XEXL') {
      ghostPills = ['rt-skeleton-btn-json', 'rt-skeleton-btn-excel'];
    } else {
      ghostPills = ['rt-skeleton-btn-gen', 'rt-skeleton-btn-json', 'rt-skeleton-btn-excel', 'rt-skeleton-btn-pdf'];
    }
    const pillsHtml = ghostPills.map(cls => `<span class="rt-skeleton-btn-ghost ${cls}"></span>`).join('');
    return `<div class="rt-actions" id="actions-${period.value}"><div class="rt-actions-skeleton">${pillsHtml}</div></div>`;
  }

  const availableActions = getAvailableActions(period, cfg);
  const actions          = getActionsFor(cfg.key);
  const isGenerating     = availableActions.includes('generate-loading');
  const showGenerate     = cfg.showGenerate && (availableActions.includes('generate') || isGenerating);
  
  let primaryBtn = showGenerate ? `<div class="rt-step-generate"><button class="rt-btn rt-btn-generate" id="btn-gen-${period.value}" title="${isGenerating ? 'GST Portal is compiling your return files' : 'Generate return file on GST Portal'}" ${isGenerating ? 'disabled' : ''}>${isGenerating ? 'Generating…' : 'Generate'}</button></div>` : '';
  const exportBtns = [];

  if (cfg.key === configR9.key) {
    if (availableActions.includes('g9-8a-excel')) exportBtns.push(`<button class="rt-btn rt-btn-excel" id="btn-8a-${period.value}" title="Download GSTR-9 Table 8A Excel spreadsheet">8A Excel</button>`);
    if (availableActions.includes('g9-g1-pdf'))   exportBtns.push(`<button class="rt-btn rt-btn-pdf" id="btn-g1-pdf-${period.value}" title="Download Auto-Drafted GSTR-1 Summary (PDF)">GSTR-1 PDF</button>`);
    if (availableActions.includes('g9-g3b-pdf'))  exportBtns.push(`<button class="rt-btn rt-btn-detail" id="btn-g3b-pdf-${period.value}" title="Download Auto-Drafted GSTR-3B Summary (PDF)">GSTR-3B PDF</button>`);
    if (availableActions.includes('summary-pdf')) exportBtns.push(`<button class="rt-btn rt-btn-pdf" id="btn-pdf-summary-${period.value}" title="Download Filed GSTR-9 PDF report">GSTR-9 PDF</button>`);
    if (availableActions.includes('json'))        exportBtns.push(`<button class="rt-btn rt-btn-json" id="btn-download-${period.value}" title="Download JSON return file">JSON</button>`);
    if (availableActions.includes('excel'))       exportBtns.push(`<button class="rt-btn rt-btn-excel" id="btn-excel-${period.value}" title="Download GSTR-9 Excel spreadsheet">Excel</button>`);
  } else {
    if (actions.json  && availableActions.includes('json'))        exportBtns.push(`<button class="rt-btn rt-btn-json" id="btn-download-${period.value}" title="Download JSON return file">JSON</button>`);
    if (actions.excel && availableActions.includes('excel'))        exportBtns.push(`<button class="rt-btn rt-btn-excel" id="btn-excel-${period.value}" title="Download Excel spreadsheet">Excel</button>`);
    
    // Uniform clean PDF standard across all return types
    let pdfLabel = (cfg.key === configR1A.key) ? 'Standalone PDF' : 'PDF';

    if (actions.pdf   && availableActions.includes('summary-pdf')) exportBtns.push(`<button class="rt-btn rt-btn-pdf" id="btn-pdf-summary-${period.value}" title="Download Summary PDF report">${pdfLabel}</button>`);
    if (actions.pdf   && availableActions.includes('detail-pdf')) {
      const detLabel = (cfg.key === configR1A.key) ? 'Consolidated PDF' : 'Detailed PDF';
      exportBtns.push(`<button class="rt-btn rt-btn-detail" id="btn-pdf-detail-${period.value}" title="Download Detailed PDF report">${detLabel}</button>`);
    }
  }

  if (!primaryBtn && exportBtns.length === 0) {
    return `<div class="rt-actions" id="actions-${period.value}"><span class="rt-no-actions" style="color:#94a3b8; font-size:11px; padding-left:4px;">—</span></div>`;
  }

  const exportsHtml = exportBtns.length > 0 ? `<div class="rt-step-export">${exportBtns.join('')}</div>` : '';
  const innerHtml = primaryBtn ? `<div class="rt-actions-workflow">${primaryBtn}<div class="rt-actions-divider" aria-hidden="true"></div>${exportsHtml}</div>` : `<div class="rt-actions-workflow">${exportsHtml}</div>`;
  return `<div class="rt-actions" id="actions-${period.value}">${innerHtml}</div>`;
}

function rerenderRowActions(period) {
  if (period) period._settled = true;
  scheduleDOMUpdate(() => {
    const container = getElement(`actions-${period.value}`);
    if (!container) return;
    const cfg = session.return;
    if (!cfg) return;

    // Build the new HTML and extract only the inner content so we can
    // update container.innerHTML instead of container.outerHTML.
    // Using outerHTML nukes the element from the DOM and re-inserts it,
    // causing a visible flash on every polling cycle. Keeping the same
    // container node alive eliminates the flicker entirely.
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = renderRowActionsHtml(period, cfg);
    const newContainer = tempDiv.firstElementChild;
    if (newContainer && container.innerHTML !== newContainer.innerHTML) {
      container.innerHTML = newContainer.innerHTML;
      // Invalidate cached button references so getElement() re-queries them
      DOM_CACHE.delete(`btn-gen-${period.value}`);
      DOM_CACHE.delete(`btn-download-${period.value}`);
      DOM_CACHE.delete(`btn-excel-${period.value}`);
      DOM_CACHE.delete(`btn-pdf-summary-${period.value}`);
      DOM_CACHE.delete(`btn-pdf-detail-${period.value}`);
      DOM_CACHE.delete(`btn-8a-${period.value}`);
      DOM_CACHE.delete(`btn-g1-pdf-${period.value}`);
      DOM_CACHE.delete(`btn-g3b-pdf-${period.value}`);
      wireRowButtons(period, cfg, getActionsFor(cfg.key));
    }
    syncRowActions(period);
  });
}

function setReturnState(period, state, message) {
  if (state === RETURN_STATES.CHECKING && (period.currentState === RETURN_STATES.AVAILABLE || period.currentState === RETURN_STATES.DOWNLOADED)) return;
  if ((state === RETURN_STATES.CHECKING || state === RETURN_STATES.DOWNLOADING) && STABLE_STATES.includes(period.currentState)) return;

  period.currentState   = state;
  period.currentMessage = message;
  const divJsonStatus = getElement(`json-status-${period.value}`);
  if (!divJsonStatus) return;

  let cssClass = 'rt-status-loading';
  if (state === RETURN_STATES.AVAILABLE) cssClass = 'rt-status-filed';
  else if (state === RETURN_STATES.FAILED || state === RETURN_STATES.SESSION_EXPIRED || state === RETURN_STATES.NO_DATA) cssClass = 'rt-status-error';
  else if (state === RETURN_STATES.NOT_GENERATED || state === RETURN_STATES.GENERATING) cssClass = 'rt-status-warn';
  else if (message === '—') cssClass = 'rt-status-na';

  setStatusPill(divJsonStatus, message, cssClass);
  syncRowActions(period);

  if (state === RETURN_STATES.AVAILABLE || state === RETURN_STATES.DOWNLOADED || state === RETURN_STATES.NOT_GENERATED || state === RETURN_STATES.FAILED) {
    Promise.resolve().then(() => rerenderRowActions(period));
  }
}

function hydrateJsonStatus(period) {
  const divJsonStatus = getElement(`json-status-${period.value}`);
  if (!divJsonStatus) return;
  const state = period.currentState;
  const cfg   = session.return;

  const fStatus = (period.filingStatus || '').toUpperCase();
  const fLabel  = (period.filingLabel || '').toUpperCase();

  // 1. TDS/TCS Credit Received (GSTR-2X) portal status display (Available / Not Available based on invoices)
  if (cfg && (cfg.key === configR2X.key || cfg.key === 'G2X' || cfg.key === configR2XExcel.key)) {
    if (state === RETURN_STATES.GENERATING) {
      setStatusPill(divJsonStatus, 'Generating…', 'rt-status-warn');
      divJsonStatus.title = 'GST Portal is generating the native Excel file…';
      return;
    }
    const count = period.gstr2xRecordCount ?? (period.filingStatus === 'FIL' ? 1 : 0);
    if (count > 0) {
      setStatusPill(divJsonStatus, 'Available', 'rt-status-filed');
      divJsonStatus.title = `${count} TDS/TCS credit record${count > 1 ? 's' : ''} available${period.genDate ? ' (Native Excel generated: ' + period.genDate + ')' : ''}`;
    } else {
      setStatusPill(divJsonStatus, 'Not Available', 'rt-status-na');
      divJsonStatus.title = 'No TDS/TCS credit records found for this period';
    }
    return;
  }

  // 2. Invoice Management System (IMS) portal status display
  if (cfg && (cfg.workflowType === WORKFLOW_TYPES.IMS_PORTAL || cfg.key === 'IMS' || cfg.key === configIms.key)) {
    if (state === RETURN_STATES.GENERATING) {
      setStatusPill(divJsonStatus, 'Generating…', 'rt-status-warn');
      return;
    }
    if (state === RETURN_STATES.NOT_GENERATED) {
      setStatusPill(divJsonStatus, 'Not Generated', 'rt-status-warn');
      return;
    }
    if (period.genDate && period.genTime) {
      showGenTime(divJsonStatus, period.genDate, period.genTime);
      return;
    }
    if (period.genDate) {
      showGenDate(divJsonStatus, period.genDate);
      return;
    }
    if (period.currentMessage && period.currentMessage !== 'Available' && period.currentMessage !== '—') {
      showGenDate(divJsonStatus, period.currentMessage);
      return;
    }
    setStatusPill(divJsonStatus, 'Available', 'rt-status-filed');
    return;
  }

  // 3. Not Applicable / Quarterly / No Data / No ITC / Blocked / Error periods ALWAYS show "—"
  if (
    state === RETURN_STATES.NO_DATA ||
    fStatus === 'NOT_APPLICABLE' ||
    fStatus === 'NOT_AVAIL' ||
    fStatus === 'NO_DATA' ||
    fStatus === 'N' ||
    fLabel === 'NOT APPLICABLE' ||
    fLabel === 'NOT AVAILABLE' ||
    fLabel === 'NO DATA' ||
    fLabel === 'NO ITC' ||
    fLabel === 'QUARTERLY' ||
    fLabel === 'OPTIONAL (IFF)' ||
    fLabel === 'QUARTER-END GENERATION' ||
    fLabel === 'QUARTER END' ||
    fLabel === 'BLOCKED' ||
    fLabel === 'ERROR' ||
    fLabel === 'INVALID PERIOD' ||
    fLabel === 'ACCESS DENIED'
  ) {
    setStatusPill(divJsonStatus, '—', 'rt-status-na');
    divJsonStatus.title = 'Not applicable for this return period';
    return;
  }

  // 3. Statutory Filing Returns (GSTR-1, GSTR-1A, GSTR-3B, GSTR-4, GSTR-9, GSTR-9C):
  const isFilingReturn = cfg && cfg.expFilingStatus === 'FIL';
  if (isFilingReturn) {
    const isFiled     = fStatus === 'FIL' || fStatus === 'FILED' || fLabel === 'FILED';
    const isSubmitted = fStatus === 'FRZ' || fStatus === 'SUBMITTED' || fLabel === 'SUBMITTED';
    const isNilFiled  = period.isNil || fStatus === 'NIL' || fStatus === 'NIL_FILED' || fLabel === 'NIL FILED';
    const isUnfiled   = fStatus === 'NOT_FILED' || fStatus === 'NF' || fStatus === 'RTF' || fStatus === 'NCNF' || fLabel === 'NOT FILED' || fLabel === 'PENDING';

    if (isUnfiled || (!isFiled && !isSubmitted && !isNilFiled)) {
      setStatusPill(divJsonStatus, '—', 'rt-status-na');
      divJsonStatus.title = 'Return not yet filed for this period';
      return;
    }

    if (isNilFiled) {
      setStatusPill(divJsonStatus, '—', 'rt-status-na');
      divJsonStatus.title = period.arn ? `Nil Return Filed (ARN: ${period.arn}) — No transaction files` : 'Nil Return Filed — No transaction files';
      return;
    }
  }

  // 3. Available state for actually filed returns or auto-drafted statements
  if (state === RETURN_STATES.AVAILABLE) {
    // GSTR-3B and GSTR-1A are always-live returns with no file generation step —
    // they show "Available" unconditionally. GSTR-1 is also LIVE_DYNAMIC but it
    // DOES have a genDate from the /generate API, so we must NOT short-circuit it
    // here — let it fall through to the date-display logic below.
    const isAlwaysLive = cfg?.key === configR3B.key || cfg?.key === configR1A.key;
    if (isAlwaysLive) {
      setStatusPill(divJsonStatus, 'Available', 'rt-status-filed');
      return;
    }
    if (period.genDate && period.genTime) { showGenTime(divJsonStatus, period.genDate, period.genTime); return; }
    if (period.genDate) { showGenDate(divJsonStatus, period.genDate); return; }
    if (period.r2bCachedData && period.r2bCachedData.gendt) { showGenDate(divJsonStatus, period.r2bCachedData.gendt); return; }
    if (period.arn && (cfg?.isAnnual || cfg?.key === 'G9' || cfg?.key === 'G9C')) {
      setStatusPill(divJsonStatus, period.arn, 'rt-status-filed');
      divJsonStatus.title = `ARN: ${period.arn}${period.fil_dt ? ' (Filed: ' + period.fil_dt + ')' : ''}`;
      return;
    }
    if (period.currentMessage && period.currentMessage !== 'Available' && period.currentMessage !== '—') {
      showGenDate(divJsonStatus, period.currentMessage);
      return;
    }
    setStatusPill(divJsonStatus, 'Available', 'rt-status-filed');
    return;
  }

  // 4. Other states (Generating, Checking, Failed, etc.)
  const message = period.currentMessage || '—';
  let cssClass  = 'rt-status-loading';
  if (message === '—') {
    cssClass = 'rt-status-na';
  } else if (state === RETURN_STATES.FAILED || state === RETURN_STATES.SESSION_EXPIRED) {
    cssClass = 'rt-status-error';
  } else if (state === RETURN_STATES.NOT_GENERATED || state === RETURN_STATES.GENERATING) {
    cssClass = 'rt-status-warn';
  }
  setStatusPill(divJsonStatus, message, cssClass);
}

// ── REPLACE your entire syncRowActions function with this clean split logic ──
function syncRowActions(period) {
  const cfg = session.return;
  
  // Split checking/downloading from background offline file generation
  const isWorking = [RETURN_STATES.CHECKING, RETURN_STATES.DOWNLOADING].includes(period.currentState);
  const isGenerating = period.currentState === RETURN_STATES.GENERATING;
  
  const availableActions = getAvailableActions(period, cfg);

  const btnGen    = getElement(`btn-gen-${period.value}`);
  const btnJson   = getElement(`btn-download-${period.value}`);
  const btnExcel  = getElement(`btn-excel-${period.value}`);
  const btnSumPdf = getElement(`btn-pdf-summary-${period.value}`);
  const btnDetPdf = getElement(`btn-pdf-detail-${period.value}`);
  const btn8a     = getElement(`btn-8a-${period.value}`);
  const btnG1Pdf  = getElement(`btn-g1-pdf-${period.value}`);
  const btnG3bPdf = getElement(`btn-g3b-pdf-${period.value}`);

  if (cfg && (cfg.workflowType === WORKFLOW_TYPES.IMS_PORTAL || cfg.key === 'IMS')) {
    if (btnGen)   { btnGen.hidden = !availableActions.includes('generate') && !availableActions.includes('generate-loading'); btnGen.disabled = isWorking || isGenerating; }
    if (btnJson)  { btnJson.hidden = !availableActions.includes('json'); btnJson.disabled = isWorking || Boolean(period.jsonGenerating); }
    if (btnExcel) { btnExcel.hidden = !availableActions.includes('excel'); btnExcel.disabled = isWorking || Boolean(period.excelGenerating); }
  } else {
    if (btnGen)    { btnGen.hidden = !availableActions.includes('generate') && !availableActions.includes('generate-loading'); btnGen.disabled = isWorking || isGenerating; }
    if (btnJson)   { btnJson.hidden = !availableActions.includes('json'); btnJson.disabled = isWorking || isGenerating; }
    if (btnExcel)  { btnExcel.hidden = !availableActions.includes('excel'); btnExcel.disabled = isWorking || isGenerating; }
  }
  
  // The PDF button remains active during generation!
  if (btnSumPdf) { btnSumPdf.hidden = !availableActions.includes('summary-pdf'); btnSumPdf.disabled = isWorking; }
  
  if (btnDetPdf) { btnDetPdf.hidden = !availableActions.includes('detail-pdf'); btnDetPdf.disabled = isWorking || isGenerating; }

  if (btn8a)     { btn8a.hidden = !availableActions.includes('g9-8a-excel'); btn8a.disabled = isWorking; }
  if (btnG1Pdf)  { btnG1Pdf.hidden = !availableActions.includes('g9-g1-pdf'); btnG1Pdf.disabled = isWorking; }
  if (btnG3bPdf) { btnG3bPdf.hidden = !availableActions.includes('g9-g3b-pdf'); btnG3bPdf.disabled = isWorking; }

  const rowEl = getElement(`row-${period.value}`);
  if (rowEl) {
    const divider = rowEl.querySelector('.rt-actions-divider');
    if (divider) divider.hidden = availableActions.length === 0;
  }
}

function getSelectedStartYear(period) {
  if (period && period.fyStart && typeof period.fyStart === 'number') {
    return period.fyStart;
  }
  let fyStr = '';
  if (typeof session !== 'undefined') {
    if (typeof session.finYear === 'string') fyStr = session.finYear;
    else if (session.finYear && session.finYear.value) fyStr = session.finYear.value;
    else if (typeof session.finYr === 'string') fyStr = session.finYr;
    else if (session.finYr && session.finYr.value) fyStr = session.finYr.value;
  }

  if (fyStr && typeof fyStr === 'string' && fyStr.includes('-')) {
    let startYr = parseInt(fyStr.split('-')[0]);
    if (!isNaN(startYr)) {
      if (startYr < 100) startYr += 2000;
      return startYr;
    }
  }

  const pVal = (typeof period === 'string') ? period : (period ? period.value : '');
  if (pVal && typeof pVal === 'string' && pVal.length === 6) {
    const mm = parseInt(pVal.substring(0, 2));
    const yyyy = parseInt(pVal.substring(2, 6));
    if (!isNaN(mm) && !isNaN(yyyy)) {
      return mm >= 4 ? yyyy : yyyy - 1;
    }
  } else if (pVal && typeof pVal === 'string' && pVal.includes('-')) {
    let startYr = parseInt(pVal.split('-')[0]);
    if (!isNaN(startYr)) {
      if (startYr < 100) startYr += 2000;
      return startYr;
    }
  }

  const finYrSelect = document.getElementById('finYear') || document.querySelector('select[name*="fin"]');
  if (finYrSelect && finYrSelect.value && finYrSelect.value.includes('-')) {
    let startYr = parseInt(finYrSelect.value.split('-')[0]);
    if (!isNaN(startYr)) {
      if (startYr < 100) startYr += 2000;
      return startYr;
    }
  }

  const now = new Date();
  return now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
}

async function runRowAction(period, actionType, actionFn, loadingState = RETURN_STATES.DOWNLOADING, loadingText = 'Downloading…') {
  if (typeof rpLog !== 'undefined' && rpLog) {
    rpLog.userAction('POPUP_ROW_ACTION', `User clicked ${actionType.toUpperCase()} for ${period.month || period.value} (${session.return?.key || 'Return'})`, {
      returnKey: session.return?.key,
      period: period.value,
      month: period.month,
      action: actionType,
      finYear: session.finYear,
      gstin: session.gstin
    });
  }
  if (typeof ReturnPilotSecurity !== 'undefined') {
    const subState = (typeof currentSubscriptionState !== 'undefined') ? currentSubscriptionState : null;
    const startYear = getSelectedStartYear(period);

    let featureKey = 'JSON';
    if (actionType === 'excel') featureKey = 'EXCEL';
    else if (actionType.includes('pdf')) featureKey = 'PDF';

    const perm = ReturnPilotSecurity.checkFeatureAccess(featureKey, subState, startYear);
    if (!perm.allowed) {
      if (typeof window.showPremiumUpgradeModal === 'function') {
        window.showPremiumUpgradeModal(perm.reason);
      } else {
        showBannerNotice(`⚠️ ${perm.reason}`, 6000);
      }
      return;
    }
  }

  const cfg = session.return;
  const isFilingReturn = cfg && cfg.expFilingStatus === 'FIL';
  if (isFilingReturn && actionType !== '8a-excel' && actionType !== 'g1-summary-pdf' && actionType !== 'g3b-summary-pdf') {
    const fStatus = (period.filingStatus || '').toUpperCase();
    const fLabel  = (period.filingLabel || '').toUpperCase();
    const isFiled = fStatus === 'FIL' || fStatus === 'FILED' || fStatus === 'FRZ' || fStatus === 'SUBMITTED' || fLabel === 'FILED' || fLabel === 'SUBMITTED' || period.isNil || fLabel === 'NIL FILED';
    if (!isFiled) {
      showBannerNotice(`⚠️ Period ${period.month || period.value} is not filed yet.`, 4000);
      return;
    }
  }

  let btnId = '';
  if (actionType === 'json') btnId = `btn-download-${period.value}`;
  else if (actionType === 'excel') btnId = `btn-excel-${period.value}`;
  else if (actionType === '8a-excel') btnId = `btn-8a-${period.value}`;
  else if (actionType === 'g1-summary-pdf') btnId = `btn-g1-pdf-${period.value}`;
  else if (actionType === 'g3b-summary-pdf') btnId = `btn-g3b-pdf-${period.value}`;
  else if (actionType === 'summary-pdf') btnId = `btn-pdf-summary-${period.value}`;
  else if (actionType === 'detail-pdf') btnId = `btn-pdf-detail-${period.value}`;
  
  const btn = getElement(btnId);
  const originalText = btn ? btn.innerHTML : '';

  if (btn) btn.innerHTML = actionType.includes('pdf') ? 'Building…' : 'Saving…';
  rpRowActionsActive++;

  const previousState = period.currentState;
  const previousMessage = period.currentMessage;
  period.currentState   = loadingState;
  period.currentMessage = loadingText;
  setGeneratingSafetyTimeout(period);
  
  syncRowActions(period);

  try {
    await actionFn();
    
    period.currentState   = RETURN_STATES.DOWNLOADED;
    period.currentMessage = 'Downloaded ✓';
    clearGeneratingSafetyTimeout(period);
    syncRowActions(period);

    triggerDownloadReviewPrompt();

    if (btn) {
      if (actionType === 'summary-pdf') {
        btn.innerHTML = 'PDF ✓';
      } else if (actionType === 'detail-pdf') {
        btn.innerHTML = 'Detailed PDF ✓';
      } else if (actionType === '8a-excel') {
        btn.innerHTML = '8A Excel ✓';
      } else if (actionType === 'g1-summary-pdf') {
        btn.innerHTML = 'GSTR-1 ✓';
      } else if (actionType === 'g3b-summary-pdf') {
        btn.innerHTML = 'GSTR-3B ✓';
      } else {
        const labelMap = { 'json': 'JSON ✓', 'excel': 'Excel ✓' };
        btn.innerHTML = labelMap[actionType] || 'Saved ✓';
      }
	}

    setTimeout(() => {
      if (rpRowActionsActive > 0) rpRowActionsActive--;
      period.currentState = previousState;
      period.currentMessage = previousMessage;
      if (btn) btn.innerHTML = originalText;
      syncRowActions(period);
    }, 2000);

  } catch (err) {
    if (rpRowActionsActive > 0) rpRowActionsActive--;
    if (btn) btn.innerHTML = originalText;
    clearGeneratingSafetyTimeout(period);
    
    // Intercepts the generation signal to transition the UI cleanly
    if (err.message === 'Generating…' || err.message === 'Generating...') {
      period.currentState = RETURN_STATES.GENERATING;
      period.currentMessage = 'Generating…';
      const divJsonStatus = getElement(`json-status-${period.value}`);
      if (divJsonStatus) setStatusPill(divJsonStatus, 'Generating…', 'rt-status-warn');
      syncRowActions(period);
      saveStableState(period);
    } else {
      period.currentState   = RETURN_STATES.FAILED;
      period.currentMessage = err.message || 'GSTN Processing Error';
      const divJsonStatus = getElement(`json-status-${period.value}`);
      if (divJsonStatus) setStatusPill(divJsonStatus, period.currentMessage, 'rt-status-error');
      syncRowActions(period);
      saveStableState(period);

      if (typeof rpLog !== 'undefined' && rpLog && typeof rpLog.error === 'function') {
        rpLog.error('ROW_ACTION_FAIL', `Action ${actionType.toUpperCase()} failed for ${period.month || period.value}: ${err.message}`, {
          action: actionType,
          period: period.value,
          month: period.month,
          returnKey: session.return?.key,
          error: err.message,
          stack: err.stack
        });
      }
    }
  }
}

const gstn = {
  getFilingDetails(fy, gstin) {
    if (!fy || !gstin) return null;
    const parts = String(fy).split('-');
    const endYear = parts.length === 2 ? parts[0].substring(0, 2) + parts[1] : String(fy);
    if (!endYear || !gstin) return null;
    const url = new URL('https://return.gst.gov.in/returns/auth/api/getfydtls');
    url.searchParams.set('fy', endYear);
    url.searchParams.set('gstin', gstin);
    return url.toString();
  },
  ustatus:  'https://services.gst.gov.in/services/api/ustatus',
  returnUstatus: 'https://return.gst.gov.in/services/api/ustatus',
  dropdown: 'https://return.gst.gov.in/returns/auth/api/dropdown',
  rolestatus(period) {
    const url = new URL('https://return.gst.gov.in/returns/auth/api/rolestatus');
    url.searchParams.set('rtn_prd', period.value);
    if (period.rt) url.searchParams.set('userType', period.rt);
    return url.toString();
  },
  generateFile(cfg, period, forceGenerate) {
    if (cfg && (cfg.key === 'IMS' || cfg.workflowType === WORKFLOW_TYPES.IMS_PORTAL || cfg.apiCode === 'IMS')) {
      return gstn.imsGenerateJson(forceGenerate);
    }
    const url = new URL('https://return.gst.gov.in/returns/auth/api/offline/download/generate');
    url.searchParams.set('rtn_typ', cfg.apiCode);
    url.searchParams.set('rtn_prd', period.value);
    url.searchParams.set('flag', forceGenerate ? '1' : '0');
    const fType = cfg.fileType || ((cfg.key === 'G2X' || cfg.apiCode === 'GSTR2X') ? 'EX' : '');
    if (fType) url.searchParams.set('file_type', fType);
    return url.toString();
  },
  gstr3bSummary(period)     { const u = new URL('https://return.gst.gov.in/returns/auth/api/gstr3b/summary'); u.searchParams.set('rtn_prd', period.value); return u.toString(); },
  gstr3bGetGenPdf(period)   { const u = new URL('https://return.gst.gov.in/returns/auth/api/gstr3b/getgenpdf'); u.searchParams.set('rtn_prd', period.value); return u.toString(); },
  gstr3bPayable(period)     { const u = new URL('https://return.gst.gov.in/returns/auth/api/gstr3b/taxpayble'); u.searchParams.set('rtn_prd', period.value); return u.toString(); },
  gstr3bFormDetails(period) { const u = new URL('https://return.gst.gov.in/returns/auth/api/formdetails'); u.searchParams.set('rtn_prd', period.value); u.searchParams.set('rtn_typ', 'GSTR3B'); return u.toString(); },
  gstr1FormDetails(period)  { const u = new URL('https://return.gst.gov.in/returns/auth/api/formdetails'); u.searchParams.set('rtn_prd', period.value); u.searchParams.set('rtn_typ', 'GSTR1'); return u.toString(); },
  gstr1Summary(period)      { const val = typeof period === 'object' ? period.value : period; const u = new URL('https://return.gst.gov.in/returns/auth/api/gstr1/summary'); u.searchParams.set('rtn_prd', val); return u.toString(); },
  gstr1aFormDetails(period) { const u = new URL('https://return.gst.gov.in/returns/auth/api/formdetails'); u.searchParams.set('rtn_prd', period.value); u.searchParams.set('rtn_typ', 'GSTR1A'); return u.toString(); },
  gstr1aSummary(period)     { const u = new URL('https://gstr1a.gst.gov.in/r1Aweb/auth/api/gstr1a/summary'); u.searchParams.set('rtn_prd', period.value); return u.toString(); },
  gstr2bJson(period)        { const u = new URL('https://gstr2b.gst.gov.in/gstr2b/auth/api/gstr2b/getjson'); u.searchParams.set('rtnprd', period.value); return u.toString(); },
  gstr2bqData(period)       { const u = new URL('https://gstr2b.gst.gov.in/gstr2b/auth/api/gstr2bq/getdata'); u.searchParams.set('itcprd', period.value); return u.toString(); },
  annualRoleStatus(prd)     { const u = new URL('https://return.gst.gov.in/returns2/auth/api/annualrolestatus'); u.searchParams.set('return_prd', prd); return u.toString(); },
  // ── GSTR-2X (TDS/TCS Credit Received) Endpoints ───────────────────────────
  gstr2xRoleStatus(prd)     { const u = new URL('https://return.gst.gov.in/returns2/auth/api/2xrolestatus'); u.searchParams.set('return_prd', prd); return u.toString(); },
  gstr2xTds(prd)            { const u = new URL('https://return.gst.gov.in/returns2/auth/api/gstr2x/tds'); u.searchParams.set('rtn_prd', prd); return u.toString(); },
  gstr2xTcs(prd)            { const u = new URL('https://return.gst.gov.in/returns2/auth/api/gstr2x/tcs'); u.searchParams.set('rtn_prd', prd); return u.toString(); },
  gstr2xTdsa(prd)           { const u = new URL('https://return.gst.gov.in/returns2/auth/api/gstr2x/tdsa'); u.searchParams.set('rtn_prd', prd); return u.toString(); },
  gstr2xTcsa(prd)           { const u = new URL('https://return.gst.gov.in/returns2/auth/api/gstr2x/tcsa'); u.searchParams.set('rtn_prd', prd); return u.toString(); },
  // ── IMS Download Endpoints ─────────────────────────────────────────────────
  // All on return.gst.gov.in — uses the existing processAsync/bgFetch path.
  // No additional permissions needed (same origin as the portal tab).
  imsGenStatus(gstin)  { return `https://return.gst.gov.in/imsweb/auth/api/ims/get2BGenStatus?gstin=${gstin}&_=${Date.now()}`; },
  imsGenerateExcel(forceGenerate) {
    const u = new URL('https://return.gst.gov.in/imsweb/auth/api/ims/generateDoc');
    u.searchParams.set('flag', forceGenerate ? '1' : '0');
    u.searchParams.set('_', Date.now());
    return u.toString();
  },
  imsGenerateOutwardExcel(period, forceGenerate) {
    const u = new URL("https://return.gst.gov.in/imsweb/auth/api/ims/generateOutwardsDoc");
    u.searchParams.set("flag", forceGenerate ? "1" : "0");
    u.searchParams.set("rtnPrd", period.value);
    u.searchParams.set("rtnTyp", "R1");
    u.searchParams.set("section", "ALLOSP");
    u.searchParams.set("viewTyp", "UNI");
    u.searchParams.set("_", Date.now());
    return u.toString();
  },
  imsGenerateOutward1AExcel(period, forceGenerate) {
    const u = new URL("https://return.gst.gov.in/imsweb/auth/api/ims/generateOutwardsDoc");
    u.searchParams.set("flag", forceGenerate ? "1" : "0");
    u.searchParams.set("rtnPrd", period.value);
    u.searchParams.set("rtnTyp", "R1A");
    u.searchParams.set("section", "ALLOSP");
    u.searchParams.set("viewTyp", "UNI");
    u.searchParams.set("_", Date.now());
    return u.toString();
  },
  imsGenerateJson(forceGenerate) {
    const u = new URL('https://return.gst.gov.in/imsweb/auth/api/ims/generateDoc');
    u.searchParams.set('flag', forceGenerate ? '1' : '0');
    u.searchParams.set('section', 'OFFLINE');
    u.searchParams.set('_', Date.now());
    return u.toString();
  }
};

/**
 * StatusBroker: Centralized Cross-Return Status Broker & Single-Flight Deduplicator (v4.2.1)
 * Eliminates redundant /rolestatus API calls by sharing the multi-return payload across
 * GSTR-1, GSTR-3B, GSTR-2A, and GSTR-1A. Coalesces concurrent in-flight requests and
 * serves repeat/secondary tab views in 0ms directly from in-memory cache.
 */
const StatusBroker = {
  cache: new Map(),
  inFlight: new Map(),
  TTL_MS: 120000, // 2-minute memory cache

  getKey(period, isAnnual = false) {
    const val = typeof period === 'object' ? (period.value || period.period) : period;
    const rt = (typeof period === 'object' && period.rt) ? `_${period.rt}` : '';
    const g = (typeof session !== 'undefined' && session && session.gstin) ? session.gstin.trim().toUpperCase() : 'SHARED';
    return isAnnual ? `${g}_annual_${val}` : `${g}_role_${val}${rt}`;
  },

  has(period, isAnnual = false) {
    const key = this.getKey(period, isAnnual);
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() - entry.timestamp > this.TTL_MS) {
      this.cache.delete(key);
      return false;
    }
    return true;
  },

  peek(period, isAnnual = false) {
    const key = this.getKey(period, isAnnual);
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > this.TTL_MS) {
      this.cache.delete(key);
      return null;
    }
    return entry;
  },

  async fetchRoleStatus(period, isAnnual = false) {
    const key = this.getKey(period, isAnnual);

    // 1. In-memory cache hit (Instant 0ms resolution)
    const cached = this.peek(period, isAnnual);
    if (cached) {
      if (typeof rpLog !== 'undefined' && rpLog) {
        rpLog.info('BROKER_HIT', `[${period.month || period.value}] Served from StatusBroker cache (0ms)`);
      }
      return { role: cached.role, info: cached.info, fromCache: true };
    }

    // 2. Single-flight coalesce: await identical request already in-flight
    if (this.inFlight.has(key)) {
      if (typeof rpLog !== 'undefined' && rpLog) {
        rpLog.info('BROKER_COALESCE', `[${period.month || period.value}] Coalesced into active in-flight request`);
      }
      const shared = await this.inFlight.get(key);
      return { role: shared.role, info: shared.info, fromCache: false, coalesced: true };
    }

    // 3. Single-flight dispatch
    const p = (async () => {
      try {
        const url = isAnnual ? gstn.annualRoleStatus(period.value || period) : gstn.rolestatus(period);
        const role = await processAsync({ request: 'get', url });
        let info = null;
        if (role && role.status) {
          try {
            info = JSON.parse(role.response);
          } catch (err) {
            console.warn(`[StatusBroker] [${period.month || period.value}] JSON parse warning:`, err);
          }
        }
        const entry = { role, info, timestamp: Date.now() };
        if (role && role.status && info && info.status === 1) {
          this.cache.set(key, entry);
        }
        return entry;
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, p);
    const res = await p;
    return { role: res.role, info: res.info, fromCache: false };
  },

  invalidate(period, isAnnual = false) {
    const key = this.getKey(period, isAnnual);
    this.cache.delete(key);
    if (this.get2xKey) {
      this.cache.delete(this.get2xKey(period));
    }
  },

  get2xKey(period) {
    const val = typeof period === 'object' ? (period.value || period.period) : period;
    const g = (typeof session !== 'undefined' && session && session.gstin) ? session.gstin.trim().toUpperCase() : 'SHARED';
    return `${g}_2x_${val}`;
  },

  has2x(period) {
    const key = this.get2xKey(period);
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() - entry.timestamp > this.TTL_MS) {
      this.cache.delete(key);
      return false;
    }
    return true;
  },

  peek2x(period) {
    const key = this.get2xKey(period);
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > this.TTL_MS) {
      this.cache.delete(key);
      return null;
    }
    return entry;
  },

  async fetch2xStatus(period) {
    const key = this.get2xKey(period);

    // 1. In-memory cache hit (Instant 0ms resolution)
    const cached = this.peek2x(period);
    if (cached) {
      if (typeof rpLog !== 'undefined' && rpLog) {
        rpLog.info('BROKER_2X_HIT', `[${period.month || period.value}] Served TDS/TCS from StatusBroker cache (0ms)`);
      }
      return { ...cached, fromCache: true };
    }

    // 2. Single-flight coalesce: await identical request already in-flight
    if (this.inFlight.has(key)) {
      if (typeof rpLog !== 'undefined' && rpLog) {
        rpLog.info('BROKER_2X_COALESCE', `[${period.month || period.value}] Coalesced into active TDS/TCS in-flight request`);
      }
      const shared = await this.inFlight.get(key);
      return { ...shared, fromCache: false, coalesced: true };
    }

    // 3. Single-flight dispatch: Parallel multi-flight fetch of 2xrolestatus + tds + tcs
    const p = (async () => {
      try {
        const val = typeof period === 'object' ? period.value : period;
        const [roleRes, tdsRes, tcsRes] = await Promise.all([
          processAsync({ request: 'get', url: gstn.gstr2xRoleStatus(val) }).catch(() => null),
          processAsync({ request: 'get', url: gstn.gstr2xTds(val) }).catch(() => null),
          processAsync({ request: 'get', url: gstn.gstr2xTcs(val) }).catch(() => null)
        ]);

        let gstr2xStatus = null;
        let isFiled = false;
        let due_dt = '';
        if (roleRes && roleRes.status && roleRes.response) {
          try {
            const info = JSON.parse(roleRes.response);
            const users = info?.data?.user || [];
            const returns = users.flatMap(u => u.returns || []);
            gstr2xStatus = returns.find(r => r.return_ty === 'GSTR2X') || null;
            if (gstr2xStatus) {
              due_dt = gstr2xStatus.due_dt || '';
              const s = String(gstr2xStatus.status || '').trim().toUpperCase();
              isFiled = (s === 'FIL' || s === 'F' || s === 'FD' || s.includes('FILED'));
            }
          } catch (_) {}
        }

        let tdsCount = 0;
        let tcsCount = 0;
        if (tdsRes && tdsRes.status && tdsRes.response) {
          try {
            const tdsObj = JSON.parse(tdsRes.response);
            const tdsList = tdsObj?.data?.processed?.tds || tdsObj?.data?.tds || [];
            if (Array.isArray(tdsList)) tdsCount = tdsList.length;
          } catch (_) {}
        }
        if (tcsRes && tcsRes.status && tcsRes.response) {
          try {
            const tcsObj = JSON.parse(tcsRes.response);
            const tcsList = tcsObj?.data?.processed?.tcs || tcsObj?.data?.tcs || [];
            if (Array.isArray(tcsList)) tcsCount = tcsList.length;
          } catch (_) {}
        }

        const totalRecords = tdsCount + tcsCount;
        const entry = {
          gstr2xStatus,
          isFiled,
          due_dt,
          totalRecords,
          tdsCount,
          tcsCount,
          timestamp: Date.now()
        };

        this.cache.set(key, entry);
        return entry;
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, p);
    const res = await p;
    return { ...res, fromCache: false };
  },

  clear() {
    this.cache.clear();
    this.inFlight.clear();
    if (typeof rpLog !== 'undefined' && rpLog) {
      rpLog.info('BROKER_CLEAR', 'StatusBroker memory cache & in-flight map cleared');
    }
  }
};

function connect() {
  if (connectionPromise) return connectionPromise;
  if (isConnecting) return new Promise((res, rej) => { setTimeout(() => connect().then(res).catch(rej), 100); });
  isConnecting = true;

  connectionPromise = new Promise(function (resolve, reject) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs || tabs.length === 0) { reject(new Error('No active tab found')); return; }
      const activeTab = tabs[0];
      if (!activeTab.url || activeTab.url.startsWith('chrome://') || activeTab.url.startsWith('chrome-extension://') || activeTab.url.startsWith('about:')) {
        reject(new Error('Active tab does not support extension content script'));
        return;
      }
      const tabId = activeTab.id;
      function attemptConnect(retries) {
        if (port && port.name === 'ReturnPilot') { try { port.postMessage({ Id: -1, request: 'ping' }); resolve(); return; } catch (e) { port = null; } }
        let p; try { p = chrome.tabs.connect(tabId, { name: 'ReturnPilot' }); } catch (e) { if (retries > 0) setTimeout(() => attemptConnect(retries - 1), CONFIG.CONNECTION_RETRY_DELAY); else reject(e); return; }
        let connected = false, pingReceived = false;
        p.onDisconnect.addListener(() => {
          void chrome.runtime.lastError; // must be read — suppresses the "Unchecked runtime.lastError" warning when the tab has no content script yet (mid-navigation / error page)
          if (!connected && retries > 0) setTimeout(() => attemptConnect(retries - 1), CONFIG.CONNECTION_RETRY_DELAY); else { port = null; connectionPromise = null; }
        });
        p.onMessage.addListener(msg => {
          connected = true;
          if (msg.request === 'log') {
            addCopilotLog(msg.message, msg.type);
            return;
          }
          const h = responseHandlers[msg.Id];
          if (h) {
            delete responseHandlers[msg.Id];
            h(msg);
          }
        });
        const pId = msgId++; let tHandle;
        responseHandlers[pId] = () => { pingReceived = true; connected = true; port = p; clearTimeout(tHandle); resolve(); };
        tHandle = setTimeout(() => {
          if (!pingReceived) {
            delete responseHandlers[pId];
            try { p.disconnect(); } catch (_) {}
            if (retries > 0) setTimeout(() => attemptConnect(retries - 1), CONFIG.CONNECTION_RETRY_DELAY);
            else reject(new Error('Ping timeout'));
          }
        }, CONFIG.CONNECTION_PING_TIMEOUT);
        try { p.postMessage({ Id: pId, request: 'ping' }); } catch (e) {
          delete responseHandlers[pId];
          clearTimeout(tHandle);
          try { p.disconnect(); } catch (_) {}
          if (retries > 0) setTimeout(() => attemptConnect(retries - 1), CONFIG.CONNECTION_RETRY_DELAY);
          else reject(e);
        }
      }
      attemptConnect(CONFIG.CONNECTION_RETRIES);
    });
  }).finally(() => { isConnecting = false; setTimeout(() => { connectionPromise = null; }, CONFIG.CONNECTION_REUSE_TIMEOUT); });
  return connectionPromise;
}

function formatResponseForLog(rawResp) {
  if (!rawResp) return null;
  if (typeof rawResp === 'object') return rawResp;
  if (typeof rawResp !== 'string') return String(rawResp);
  const trimmed = rawResp.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch (_) {}
  }
  return trimmed.length > 500 ? trimmed.substring(0, 500) + '… (truncated)' : trimmed;
}

async function processAsync(msg, timeoutMs = CONFIG.REQUEST_TIMEOUT) {
  activeNetworkRequests++;
  try {
    return await _processAsyncInternal(msg, timeoutMs);
  } finally {
    _onNetworkRequestSettled();
  }
}

async function _processAsyncInternal(msg, timeoutMs = CONFIG.REQUEST_TIMEOUT) {
  const tSend = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  const tSendEpoch = (typeof performance !== 'undefined' && performance.timeOrigin) ? Math.round(performance.timeOrigin + tSend) : Date.now();
  if (msg.request === 'get' || msg.request === 'getBinaryData') {
    if (typeof rpLog !== 'undefined' && rpLog) {
      rpLog.debug('API_REQ', `[${msg.request}] ${msg.url || ''}`);
    }
    console.log('[ReturnPilot Popup] processAsync send:', msg.request, msg.url || '');
    // ── Background SW fast path ───────────────────────────────────────────
    // GET requests (status checks, formdetails, rolestatus, etc.) don't need
    // page context — only session cookies + auth token, which the background
    // service worker already holds. The content script port runs on the GST
    // portal's AngularJS main thread: Angular $digest cycles can block it for
    // 1-1.5s AFTER the network already responded, causing the observed delay.
    // The background SW runs in its own isolated thread — no contention.
    if (msg.request === 'get') {
      return new Promise(resolve => {
        const tHandle = setTimeout(() => {
          if (typeof rpLog !== 'undefined' && rpLog) {
            rpLog.warn('API_TIMEOUT', `Timeout after ${timeoutMs}ms: ${msg.url || ''}`);
          }
          resolve({ status: false, statusCode: 0, error: `Timeout ${timeoutMs}ms` });
        }, timeoutMs);
        bgFetch({
          url: msg.url,
          bypassCache: Boolean(msg.bypassCache),
          timeoutMs: msg.timeoutMs || (timeoutMs !== CONFIG.REQUEST_TIMEOUT ? timeoutMs : undefined)
        }).then(res => {
          clearTimeout(tHandle);
          const t7 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
          const t7Epoch = (typeof performance !== 'undefined' && performance.timeOrigin) ? Math.round(performance.timeOrigin + t7) : Date.now();
          const tElapsed = Math.round(t7 - tSend);
          if (typeof rpLog !== 'undefined' && rpLog) {
            const code = res?.statusCode || (res?.status ? 200 : 0);
            const respPayload = formatResponseForLog(res?.response);
            const apiDetails = {
              url: msg.url || '',
              statusCode: code,
              elapsedMs: tElapsed,
              netMs: res?._timing?.networkMs ?? null,
              ttfbMs: res?._timing?.ttfbMs ?? null,
              downloadMs: res?._timing?.downloadMs ?? null,
              payloadBytes: res?._timing?.payloadBytes ?? null,
              response: respPayload,
              error: res?.error || null
            };
            rpLog.debug('API_RESP', `[${code}] in ${tElapsed}ms: ${msg.url || ''}`, apiDetails);
            if (res?._timing && typeof rpLog.timingChain === 'function') {
              const hop1Ms = (res._timing.t1Epoch && tSendEpoch) ? Math.max(0, Math.round(res._timing.t1Epoch - tSendEpoch)) : null;
              const hop2Ms = (res._timing.t6Epoch && t7Epoch) ? Math.max(0, Math.round(t7Epoch - res._timing.t6Epoch)) : null;
              const breakdown = {
                totalMs: tElapsed,
                hop1Ms,
                authMs: res._timing.authMs,
                networkMs: res._timing.networkMs,
                ttfbMs: res._timing.ttfbMs,
                downloadMs: res._timing.downloadMs,
                payloadBytes: res._timing.payloadBytes,
                swProcessingMs: res._timing.swProcessingMs ?? null,
                hop2Ms,
                swTotalMs: res._timing.totalSw
              };
              rpLog.timingChain(msg.url || '', breakdown);
              const urlStr = msg.url || '';
              const reqClass = msg.requestClass || (
                (urlStr.includes('/ustatus') || urlStr.includes('/dropdown') || urlStr.includes('/profile/') || urlStr.includes('/getfydtls')) ? 'FY_METADATA' :
                (urlStr.includes('/offline/download/generate') && urlStr.includes('flag=0')) ? 'ENRICHMENT' :
                (urlStr.includes('/offline/download/generate') && urlStr.includes('flag=1')) ? 'DOWNLOAD_GENERATION' :
                (urlStr.includes('/formdetails')) ? 'ENRICHMENT' : 'STATUS'
              );
              if (activeBatchCollector && typeof activeBatchCollector.recordApiCall === 'function') {
                activeBatchCollector.recordApiCall(urlStr, breakdown, reqClass);
              }
            }

            const netMs = (res?._timing?.networkMs !== undefined && res?._timing?.networkMs !== null)
              ? res._timing.networkMs
              : tElapsed;


            // Automatically attribute network latency to the matching period across all return endpoints
            const prdMatch = (msg.url || '').match(/(?:rtn_prd|return_prd|rtnprd|itcprd|rtnPrd)=(\d{6})/i);
            if (prdMatch && session?.periods) {
              const matchedPeriod = session.periods.find(p => p.value === prdMatch[1]);
              if (matchedPeriod) {
                matchedPeriod._netMs = (matchedPeriod._netMs || 0) + netMs;
              }
            }
          }
          resolve(res);
        });
      });
    }
    // ─────────────────────────────────────────────────────────────────────
    if (port) {
      return new Promise(resolve => {
        const i = msgId++;
        const pMsg = Object.assign({}, msg, { Id: i });
        let resolved = false;
        const tHandle = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            delete responseHandlers[i];
            const tElapsed = Math.round(performance.now() - tSend);
            if (typeof rpLog !== 'undefined' && rpLog) {
              rpLog.warn('API_TIMEOUT', `Timeout after ${timeoutMs}ms: ${msg.url || msg.request}`);
            }
            console.warn('[ReturnPilot Popup] processAsync timeout:', msg.url || msg.request);
            resolve({ status: false, statusCode: 0, error: `Timeout ${timeoutMs}ms` });
          }
        }, timeoutMs);
        responseHandlers[i] = res => {
          if (!resolved) {
            resolved = true;
            clearTimeout(tHandle);
            const tElapsed = Math.round(performance.now() - tSend);
            if (typeof rpLog !== 'undefined' && rpLog) {
              const code = res?.statusCode || (res?.status ? 200 : 0);
              const respPayload = formatResponseForLog(res?.response);
              const apiDetails = {
                url: msg.url || msg.request || '',
                statusCode: code,
                elapsedMs: tElapsed,
                response: respPayload,
                error: res?.error || null
              };
              rpLog.debug('API_RESP', `[${code}] in ${tElapsed}ms: ${msg.url || msg.request}`, apiDetails);
            }
            console.log('[ReturnPilot Popup] processAsync receive:', res?.status, res?.statusCode, msg.url || '');
            resolve(res);
          }
        };
        try {
          port.postMessage(pMsg);
        } catch (e) {
          if (!resolved) {
            resolved = true;
            delete responseHandlers[i];
            clearTimeout(tHandle);
            chrome.runtime.sendMessage({ request: 'bg-fetch-binary', url: msg.url }, res => {
              if (chrome.runtime.lastError) resolve({ status: false, error: chrome.runtime.lastError.message });
              else resolve(res);
            });
          }
        }
      });
    } else {
      return new Promise(resolve => {
        chrome.runtime.sendMessage({ request: 'bg-fetch-binary', url: msg.url }, res => {
          if (chrome.runtime.lastError) resolve({ status: false, error: chrome.runtime.lastError.message });
          else resolve(res);
        });
      });
    }
  } else {
    return new Promise(resolve => {
      let resolved = false;
      const tHandle = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve({ success: false, status: false, error: "Timeout " + timeoutMs + "ms" });
        }
      }, timeoutMs);
      chrome.runtime.sendMessage(msg, (res) => {
        const lastErr = chrome.runtime.lastError; // Unconditionally read to mark as checked in Chrome
        if (!resolved) {
          resolved = true;
          clearTimeout(tHandle);
          if (lastErr) {
            const errMsg = lastErr.message || 'Message port closed';
            resolve({ success: false, status: false, error: errMsg });
          } else {
            resolve(res || { success: false, error: "No response from background service worker" });
          }
        }
      });
    });
  }
}

function bgFetch(opts) {
  const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  const t0Epoch = (typeof performance !== 'undefined' && performance.timeOrigin) ? Math.round(performance.timeOrigin + t0) : Date.now();
  const payload = (typeof opts === 'string')
    ? { request: 'bg-fetch', url: opts, _t0: t0, _t0Epoch: t0Epoch }
    : { request: 'bg-fetch', _t0: t0, _t0Epoch: t0Epoch, ...opts };
  return new Promise(res => {
    chrome.runtime.sendMessage(payload, r => {
      if (chrome.runtime.lastError) res({ status: false, error: chrome.runtime.lastError.message });
      else res(r);
    });
  });
}

function injectContentScript(tabId) {
  return new Promise((res, rej) => {
    chrome.scripting.executeScript({ target: { tabId }, files: ['lib/fflate.js', 'content/contentscript.js'] }, () => {
      if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message));
      else res();
    });
  });
}

async function saveBlobUrl(fileName, url, periodVal) {
  const cleanPeriod = periodVal || (fileName && fileName.match(/(\b|_)(0[1-9]|1[0-2])(20\d{2})(\b|_|\.)/)?.[0]?.replace(/\D/g, '')) || '';
  try {
    const response = await fetch(url, { credentials: 'include' });
    if (!response.ok) throw new Error('HTTP ' + response.status + ' - File unavailable');
    
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('text/html') || contentType.includes('text/plain')) {
      const sampleText = await response.text();
      if (sampleText.toLowerCase().includes('not available') || sampleText.toLowerCase().includes('in progress') || sampleText.toLowerCase().includes('generating')) {
        throw new Error('File is currently generating on the GST portal. Please try again in 1-2 minutes.');
      }
      throw new Error('File not ready or rejected by portal');
    }

    const buffer = await response.arrayBuffer(), bytes = new Uint8Array(buffer);
    chrome.runtime.sendMessage({
      request: 'download-file',
      fileName,
      mimeType: contentType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      base64: bytesToBase64(bytes),
      gstin: (typeof session !== 'undefined' && session && session.gstin) || '',
      returnType: (typeof session !== 'undefined' && session && session.return && session.return.apiCode) || 'GSTR9',
      period: cleanPeriod,
      fy: (typeof session !== 'undefined' && session && session.finYear) || ''
    }, () => { if (chrome.runtime.lastError) {} });
    return true;
  } catch (err) {
    console.warn('[ReturnPilot] saveBlobUrl note:', err.message);
    throw err;
  }
}

// Chunked Uint8Array → base64 (avoids call-stack limits & deprecated unescape())
function bytesToBase64(bytes) {
  let binary = '';
  const CHUNK = 4096;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)));
  }
  return btoa(binary);
}

// UTF-8 string → base64 — safe for large strings & non-ASCII data
function utf8ToBase64(str) {
  return bytesToBase64(new TextEncoder().encode(str));
}

function saveJsonFile(fileName, jsonData, periodVal) {
  const cleanPeriod = periodVal || (fileName && fileName.match(/(\b|_)(0[1-9]|1[0-2])(20\d{2})(\b|_|\.)/)?.[0]?.replace(/\D/g, '')) || '';
  try {
    chrome.runtime.sendMessage({
      request: 'download-file',
      fileName,
      mimeType: 'application/json',
      base64: utf8ToBase64(jsonData),
      gstin: (typeof session !== 'undefined' && session && session.gstin) || '',
      returnType: (typeof session !== 'undefined' && session && session.return && session.return.apiCode) || '',
      period: cleanPeriod,
      fy: (typeof session !== 'undefined' && session && session.finYear) || ''
    }, () => { if (chrome.runtime.lastError) {} });
    return true;
  } catch (e) {
    console.error('saveJsonFile failed', e);
    return false;
  }
}

async function saveJsonAsZipAsync(jsonfilename, zipfilename, jsonData, periodVal) {
  const cleanPeriod = periodVal || (zipfilename && zipfilename.match(/(\b|_)(0[1-9]|1[0-2])(20\d{2})(\b|_|\.)/)?.[0]?.replace(/\D/g, '')) || '';
  if (!port) {
    try { await connect(); } catch (_) {}
  }
  const msg = await processAsync({ request: 'save-json-as-zip', jsonfilename, zipfilename, jsonData });
  if (!msg || !msg.status || !msg.response) return saveJsonFile(jsonfilename + '.json', jsonData, cleanPeriod);
  try {
    chrome.runtime.sendMessage({
      request: 'download-file',
      fileName: zipfilename + '.zip',
      mimeType: 'application/zip',
      base64: msg.response,
      gstin: (typeof session !== 'undefined' && session && session.gstin) || '',
      returnType: (typeof session !== 'undefined' && session && session.return && session.return.apiCode) || '',
      period: cleanPeriod,
      fy: (typeof session !== 'undefined' && session && session.finYear) || ''
    }, () => { if (chrome.runtime.lastError) {} });
    return true;
  } catch (e) {
    return saveJsonFile(jsonfilename + '.json', jsonData, cleanPeriod);
  }
}

async function fetch2bData(period) {
  const isQuarterly = session.filingFrequency === 'Quarterly' || session.isQuarterly;
  const mNum = parseInt(period.value.substring(0, 2), 10);
  const isQuarterEnd = (mNum % 3 === 0);

  // In QRMP rules:
  // - Quarter-end months (Jun, Sep, Dec, Mar) use gstr2bqData (Quarterly 2B).
  // - Non-quarter-end months (Apr, May, Jul, Aug, Oct, Nov, Jan, Feb) use gstr2bJson (Monthly 2B) directly.
  // GSTR-2BQ DOES NOT EXIST for non-quarter months; querying it guarantees an error.
  const primaryUrl = (isQuarterly && isQuarterEnd) ? gstn.gstr2bqData(period) : gstn.gstr2bJson(period);
  const primarySource = (isQuarterly && isQuarterEnd) ? 'qrmp' : 'monthly';

  let primResp = null;
  try {
    const r = await processAsync({ request: 'get', url: primaryUrl });
    primResp = parse2bResponse(r);
    if (primResp.ok) return { ok: true, source: primarySource, raw: primResp.raw, data: primResp.data };
  } catch (e) { primResp = { ok: false, error: e.message }; }

  // Check if primary returned definitive "No record found" or "Not generated"
  // e.g. GTR2B-002 or explicit "no record" message. If so, secondary endpoint is guaranteed
  // to return the exact same error; skip fallback to eliminate 50% duplicate network traffic.
  const isDefinitiveNotFound = primResp?.code === 'GTR2B-002' ||
    primResp?.code === 'RET2B1006' ||
    (primResp?.error && (primResp.error.toLowerCase().includes('no record') || primResp.error.toLowerCase().includes('not generated')));

  if (isDefinitiveNotFound) {
    return { ok: false, error: primResp.error, code: primResp.code };
  }

  // Fallback to secondary endpoint only if there is a genuine profile ambiguity
  // (e.g. taxpayer switched between Monthly and Quarterly mid-year)
  const fallbackUrl = (isQuarterly && isQuarterEnd) ? gstn.gstr2bJson(period) : gstn.gstr2bqData(period);
  const fallbackSource = (isQuarterly && isQuarterEnd) ? 'monthly' : 'qrmp';

  // Only query fallback if it makes sense (e.g. never query gstr2bq for non-quarter-end months)
  if (!isQuarterEnd && fallbackUrl.includes('gstr2bq')) {
    return { ok: false, error: primResp?.error || 'No Data', code: primResp?.code };
  }

  let fallResp = null;
  try {
    const r = await processAsync({ request: 'get', url: fallbackUrl });
    fallResp = parse2bResponse(r);
    if (fallResp.ok) return { ok: true, source: fallbackSource, raw: fallResp.raw, data: fallResp.data };
  } catch (e) { fallResp = { ok: false, error: e.message }; }

  return { ok: false, error: fallResp?.error || primResp?.error || 'Endpoints network failure', code: fallResp?.code || primResp?.code };
}

function parse2bResponse(msg) {
  if (!msg || !msg.status) return { ok: false, error: `HTTP ${msg?.statusCode || 'err'}` };
  const txt = (msg.response || '').trim();
  if (!txt) return { ok: false, error: 'Empty network package' };
  if (txt.toLowerCase().startsWith('<!doctype') || txt.toLowerCase().startsWith('<html')) return { ok: false, error: 'Access Denied' };
  let p;
  try { p = JSON.parse(txt); } catch (e) { return { ok: false, error: 'Parse corruption err' }; }
  if (p && p.error && p.error.message) return { ok: false, error: p.error.message, code: p.error.error_cd };
  if (p && p.data && typeof p.data === 'object') {
    if (p.data.error_msg) return { ok: false, error: p.data.error_msg };
    if (p.data.gstin || p.data.docdata) return { ok: true, raw: p, data: p.data };
    return { ok: false, error: 'No Data' };
  }
  if (p && (p.gstin || p.docdata)) return { ok: true, raw: { data: p }, data: p };
  return { ok: false, error: 'No valid GST record matching parameters' };
}

document.addEventListener('DOMContentLoaded', () => {
  // Fast Service Worker warm-up ping to ensure background event loop is awake immediately
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ request: 'ping' }, () => {
        if (chrome.runtime && chrome.runtime.lastError) { /* ignore warm-up ack */ }
      });
    }
  } catch (_) {}

  if (typeof __DEV__ === 'undefined' || __DEV__) {
    if (typeof rpLog !== 'undefined' && rpLog) {
      const initM = window.__rpPopupMetrics;
      if (initM) {
        rpLog.info('POPUP_FRAME0', `Frame 0 startup: init=${initM.beforeScale?.innerWidth}x${initM.beforeScale?.innerHeight}, target=${initM.targetWidth}x${initM.targetHeight}, screen=${initM.screen?.availWidth}x${initM.screen?.availHeight}, scale=${initM.appliedScale}`, initM);
      }
      rpLog.info('POPUP_DOM_READY', `DOMContentLoaded viewport: ${window.innerWidth}x${window.innerHeight} (html: ${document.documentElement?.clientWidth}x${document.documentElement?.clientHeight}, body: ${document.body?.offsetWidth}x${document.body?.offsetHeight})`, {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        outerWidth: window.outerWidth,
        outerHeight: window.outerHeight,
        bodyOffsetWidth: document.body?.offsetWidth,
        bodyOffsetHeight: document.body?.offsetHeight,
        htmlClientWidth: document.documentElement?.clientWidth,
        htmlClientHeight: document.documentElement?.clientHeight,
        resizesCount: initM?.resizeEvents?.length || 0
      });
    }
  }

  if (typeof rpLog !== 'undefined' && rpLog) {
    rpLog.info('BOOT', 'DOMContentLoaded fired. Resolving active tab...');
  }

  function resolveTargetTab(cb) {
    // 1. Explicit query param ?tabId=... (passed when opened tab-scoped in side panel)
    try {
      const spTabId = new URLSearchParams(window.location.search).get('tabId');
      const parsedId = parseInt(spTabId, 10);
      if (!isNaN(parsedId) && parsedId > 0 && typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.get) {
        chrome.tabs.get(parsedId, (tab) => {
          if (!chrome.runtime.lastError && tab && tab.url) {
            return cb(tab);
          }
          queryWindowActiveTab();
        });
        return;
      }
    } catch (_) {}

    queryWindowActiveTab();

    function queryWindowActiveTab() {
      if (typeof chrome === 'undefined' || !chrome.tabs || !chrome.tabs.query) {
        return cb(null);
      }
      // 2. Active tab in current window (ignoring self extension tabs)
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs[0] && tabs[0].url && !tabs[0].url.startsWith('chrome-extension://')) {
          return cb(tabs[0]);
        }
        // 3. Active tab in last focused window (handles sidepanel & DevTools focus)
        chrome.tabs.query({ active: true, lastFocusedWindow: true }, (fTabs) => {
          if (fTabs && fTabs[0] && fTabs[0].url && !fTabs[0].url.startsWith('chrome-extension://')) {
            return cb(fTabs[0]);
          }
          // 4. Query GST portal tabs across the browser
          chrome.tabs.query({ url: ['*://*.gst.gov.in/*'] }, (gstTabs) => {
            const gstTab = (gstTabs && (gstTabs.find(t => t.active) || gstTabs[0])) || null;
            if (gstTab && gstTab.url) {
              return cb(gstTab);
            }
            cb((tabs && tabs[0]) || (fTabs && fTabs[0]) || null);
          });
        });
      });
    }
  }

  resolveTargetTab(activeTab => {
    if (activeTab && activeTab.url) {
      try {
        currentUrl = new URL(activeTab.url);
        currentActiveTabId = activeTab.id;
        currentActiveWindowId = activeTab.windowId;
        rpLastNavKey = `${activeTab.id}:${currentUrl.hostname}${currentUrl.pathname}${currentUrl.search}`;
        if (typeof rpLog !== 'undefined' && rpLog) {
          rpLog.info('ACTIVE_TAB', `Active tab resolved: ${currentUrl.href}`, { host: currentUrl.hostname, path: currentUrl.pathname });
        }
        console.log('[ReturnPilot Boot] Active tab URL:', currentUrl.href);
      } catch (e) {
        if (typeof rpLog !== 'undefined' && rpLog) rpLog.warn('TAB_URL_ERROR', 'Could not parse tab URL', e);
        console.warn('[ReturnPilot Boot] Could not parse tab URL:', activeTab.url, e);
      }
    } else {
      if (typeof rpLog !== 'undefined' && rpLog) {
        rpLog.info('ACTIVE_TAB_INFO', 'No active GST portal tab detected or URL restricted.');
      }
      console.log('[ReturnPilot Boot] No active GST portal tab detected or URL restricted.');
    }

    if (currentUrl && currentUrl.hostname.toLowerCase().endsWith('gst.gov.in') && activeTab && activeTab.id) {
      injectContentScript(activeTab.id).then(() => startupAsync()).catch(err => {
        console.warn('[ReturnPilot Boot] Content script injection notice:', err);
        startupAsync();
      });
    } else {
      startupAsync();
    }
  });
});

function hideAllStateScreens() {
  ['msgOtherWebsite', 'msgNotOnReturnDashboard', 'msgLoginRequired', 'msgLoginPage'].forEach(id => {
    const el = getElement(id);
    if (el) el.hidden = true;
  });
}

function persistPopupLifecycle(activeScreen, extra = {}) {
  if (typeof __DEV__ === 'undefined' || __DEV__) {
    try {
      if (typeof rpLog !== 'undefined' && rpLog) {
        rpLog.info('POPUP_SCREEN', `Activated screen: ${activeScreen}`, {
          activeScreen,
          host: (currentUrl && currentUrl.hostname) || '',
          path: (currentUrl && currentUrl.pathname) || '',
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          ...extra
        });
      }
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        const payload = {
          timestamp: new Date().toISOString(),
          activeScreen: activeScreen,
          host: (currentUrl && currentUrl.hostname) || '',
          path: (currentUrl && currentUrl.pathname) || '',
          href: (currentUrl && currentUrl.href) || '',
          viewport: {
            innerWidth: window.innerWidth,
            innerHeight: window.innerHeight,
            outerWidth: window.outerWidth,
            outerHeight: window.outerHeight,
            screenWidth: window.screen ? window.screen.width : 0,
            screenHeight: window.screen ? window.screen.height : 0,
            availWidth: window.screen ? window.screen.availWidth : 0,
            availHeight: window.screen ? window.screen.availHeight : 0,
            devicePixelRatio: window.devicePixelRatio || 1
          },
          frame0: window.__rpPopupMetrics || null,
          resizes: (window.__rpPopupMetrics && window.__rpPopupMetrics.resizeEvents) || []
        };
        chrome.storage.local.set({ rp_last_popup_lifecycle: payload });
      }
    } catch (_) {}
  }
}

/**
 * Fast, non-blocking extraction of active taxpayer details (GSTIN, legal/trade name, regType)
 * directly from the portal DOM & storage without relying on slow network API round-trips.
 */
async function getPageTaxpayerInfoAsync(tabId) {
  // 1. Direct message to content script via chrome.tabs.sendMessage (super-fast, < 5ms)
  if (tabId) {
    try {
      const resp = await new Promise(resolve => {
        const timer = setTimeout(() => resolve(null), 300);
        chrome.tabs.sendMessage(tabId, { request: 'get-page-taxpayer-info' }, res => {
          clearTimeout(timer);
          if (chrome.runtime.lastError) resolve(null);
          else resolve(res);
        });
      });
      if (resp && (resp.gstin || resp.tradeName || resp.legalName || resp.taxpayerStatus)) {
        return resp;
      }
    } catch (_) {}
  }

  // 2. Direct DOM execution via chrome.scripting.executeScript (instant, runs directly in page context)
  if (tabId && typeof chrome !== 'undefined' && chrome.scripting && chrome.scripting.executeScript) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: async () => {
          let liveGstin = '', liveName = '', regType = '', liveStatus = '';

          function extractCleanName(node) {
            if (!node) return '';
            const titleAttr = (
              node.getAttribute('data-original-title') ||
              node.getAttribute('title') ||
              node.title ||
              node.getAttribute('data-tooltip-title') ||
              ''
            ).trim();
            if (
              titleAttr &&
              titleAttr.length > 2 &&
              !titleAttr.includes('{{') &&
              !/^(my profile|logout|login|change password|select|english|hindi|goods and services tax|register|dashboard)$/i.test(titleAttr)
            ) {
              return titleAttr;
            }
            try {
              const clone = node.cloneNode(true);
              const junk = clone.querySelectorAll('i, svg, .caret, .dropdown-menu, .fa, .lst-log, .lst-log-dt, script, style');
              junk.forEach(el => el.remove());
              const txt = (clone.textContent || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
              if (
                txt &&
                txt.length > 2 &&
                !txt.includes('{{') &&
                !/^(my profile|logout|login|change password|select|english|hindi|goods and services tax|register|dashboard)$/i.test(txt)
              ) {
                return txt;
              }
            } catch (_) {}
            return '';
          }

          try {
            // 1. Direct navbar user dropdown extraction (sibling of udata.gstin)
            const gstinNode = document.querySelector('[data-ng-bind*="udata.gstin"], [ng-bind*="udata.gstin"]');
            if (gstinNode) {
              const siblingAnchor = gstinNode.closest('.dropdown')?.querySelector('a.dropdown-toggle, a.lang-dpwn, [data-toggle="dropdown"]');
              if (siblingAnchor) {
                const extracted = extractCleanName(siblingAnchor);
                if (extracted) {
                  liveName = extracted;
                }
              }
            }

            // 2. User profile dropdown / navbar anchors
            if (!liveName) {
              const userSelectors = [
                'li[ng-if*="udata"] a.dropdown-toggle',
                'li[ng-if*="udata"] a.lang-dpwn',
                'li[ng-if*="udata"] a[data-toggle="dropdown"]',
                'li[ng-if*="udata"] a',
                '.dropdown a.dropdown-toggle',
                'a.dropdown-toggle.lang-dpwn',
                'a[data-toggle="dropdown"][data-original-title]',
                'a[data-original-title]',
                'a[data-tooltip="true"]',
                '#myPrflDis',
                '.profile-dpdwn'
              ];
              for (const sel of userSelectors) {
                const target = document.querySelector(sel);
                if (!target) continue;
                const anchor = (target.matches && target.matches('a'))
                  ? target
                  : (target.closest('.dropdown')?.querySelector('a.dropdown-toggle, a.lang-dpwn, [data-toggle="dropdown"]') || target.previousElementSibling);
                if (anchor) {
                  const extracted = extractCleanName(anchor);
                  if (extracted) {
                    liveName = extracted;
                    break;
                  }
                }
              }
            }

            // 3. Probe Angular 1.x Scope for direct udata model (instant & 100% authoritative)
            if (!liveName || !liveGstin || !liveStatus) {
              try {
                if (window.angular) {
                  const el = document.querySelector('[ng-controller], [data-ng-controller], [ng-app], [data-ng-app], header, #navbar');
                  if (el) {
                    const scope = window.angular.element(el).scope();
                    const u = scope?.udata || scope?.user || scope?.$root?.udata;
                    if (u && typeof u === 'object') {
                      if (!liveGstin && u.gstin) liveGstin = u.gstin.trim().toUpperCase();
                      if (!liveName && u.bname) liveName = u.bname;
                      else if (!liveName && (u.tradeNam || u.legalName)) liveName = u.tradeNam || u.legalName;
                      if (!regType && (u.regType || u.utype)) regType = u.regType || u.utype || '';
                      if (!liveStatus) {
                        const s = u.sts || u.statusDesc || u.taxpayerStatus || u.status || u.stsDesc;
                        if (s && typeof s === 'string') liveStatus = s;
                      }
                    }
                  }
                }
              } catch (_) {}
            }

            // 4. Extract GSTIN directly from DOM (e.g. <div data-ng-bind="udata.gstin">22AAKCR2040N1ZE</div>)
            const gSelectors = [
              '[data-ng-bind*="udata.gstin"]',
              '[ng-bind*="udata.gstin"]',
              'li[ng-if*="udata"] [data-ng-bind]',
              'li[ng-if*="udata"] [ng-bind]',
              'li[ng-if*="udata"] div',
              '[data-ng-bind*="gstin"]',
              '[ng-bind*="gstin"]',
              '.gstin-display',
              '#gstin',
              '[class*="gstin"]'
            ];
            for (const sel of gSelectors) {
              const el = document.querySelector(sel);
              if (el && el.textContent) {
                const m = el.textContent.trim().toUpperCase().match(/\b\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}\b/);
                if (m) { liveGstin = m[0]; break; }
              }
            }
            // Do NOT fall back to persistent localStorage keys (_rp_current_gstin) here,
            // as they poison detection when switching accounts!

            // 5. Storage Lookup (bname checked FIRST)
            ['udata', 'userdetails', 'user_data', 'profile'].forEach(k => {
              try {
                const raw = localStorage.getItem(k) || sessionStorage.getItem(k);
                if (raw) {
                  const u = JSON.parse(raw);
                  if (u && typeof u === 'object') {
                    if (!liveGstin) liveGstin = (u.gstin || u.authGstin || '').trim().toUpperCase();
                    if (!liveName) liveName = u.bname || u.tradeNam || u.tradeName || u.legalName || u.lgnm || '';
                    if (!regType) regType = u.regType || u.userType || '';
                    if (!liveStatus) {
                      const s = u.sts || u.statusDesc || u.taxpayerStatus || u.status || u.stsDesc;
                      if (s && typeof s === 'string') liveStatus = s;
                    }
                  }
                }
              } catch (_) {}
            });

            // 6. Direct /services/api/ustatus fetch fallback from active page session
            if (!liveName || !liveGstin) {
              try {
                const uRes = await fetch('/services/api/ustatus', { credentials: 'include' });
                if (uRes.ok) {
                  const uData = await uRes.json();
                  if (uData && typeof uData === 'object') {
                    if (!liveGstin && uData.gstin) liveGstin = uData.gstin.trim().toUpperCase();
                    if (!liveName && uData.bname) liveName = uData.bname;
                    if (!regType && (uData.regType || uData.utype)) regType = uData.regType || uData.utype;
                    if (!liveStatus && uData.sts) liveStatus = uData.sts;
                  }
                }
              } catch (_) {}
            }

            // 6b. Direct /services/auth/profile/detail fetch from active page session (same-origin on services.gst.gov.in)
            if (!liveStatus && window.location.hostname === 'services.gst.gov.in') {
              try {
                const pRes = await fetch('/services/auth/profile/detail', {
                  method: 'POST',
                  headers: {
                    'Accept': 'application/json, text/plain, */*',
                    'Content-Type': 'application/json;charset=UTF-8'
                  },
                  body: '{}',
                  credentials: 'include'
                });
                if (pRes.ok) {
                  const pData = await pRes.json();
                  if (pData && typeof pData === 'object') {
                    const s = pData.sts || pData.statusDesc || pData.taxpayerStatus || pData.status;
                    if (s && typeof s === 'string') liveStatus = s;
                    if (!liveGstin && pData.gstin) liveGstin = pData.gstin.trim().toUpperCase();
                    if (!liveName && (pData.tradeNam || pData.lgnm)) liveName = pData.tradeNam || pData.lgnm;
                  }
                }
              } catch (_) {}
            }

            // 7. Fallback: check other name selectors
            if (!liveName) {
              const nameSelectors = [
                '[data-ng-bind*="tradeNam"]',
                '[ng-bind*="tradeNam"]',
                '[data-ng-bind*="tradeName"]',
                '[ng-bind*="tradeName"]',
                '[data-ng-bind*="userName"]',
                '[ng-bind*="userName"]',
                '.trade-name',
                '.taxpayer-name',
                '.header-user-name'
              ];
              for (const sel of nameSelectors) {
                const el = document.querySelector(sel);
                if (el) {
                  const extracted = extractCleanName(el);
                  if (extracted) {
                    liveName = extracted;
                    break;
                  }
                }
              }
            }
          } catch (_) {}
          return {
            status: true,
            gstin: liveGstin,
            tradeName: liveName,
            legalName: liveName,
            regType: regType,
            taxpayerStatus: liveStatus
          };
        }
      });
      if (results && results[0] && results[0].result) {
        return results[0].result;
      }
    } catch (_) {}
  }

  // 3. Last fallback: try processAsync if port is open
  if (port) {
    try {
      const pInfo = await processAsync({ request: 'get-page-taxpayer-info' }, 500).catch(() => null);
      if (pInfo && (pInfo.gstin || pInfo.tradeName)) return pInfo;
    } catch (_) {}
  }

  return null;
}

function handleClientSwitch(oldGstin, newGstin) {
  const oldG = (oldGstin || '').trim().toUpperCase();
  const newG = (newGstin || '').trim().toUpperCase();
  if (oldG && oldG === newG) return;
  console.log(`[ReturnPilot] Client switch detected in popup: "${oldG}" → "${newG}". Flushing all client state.`);
  if (typeof rpLog !== 'undefined' && rpLog) {
    rpLog.userAction('CLIENT_SWITCH', `Switched active taxpayer from ${oldG || 'None'} to ${newG}`);
  }
  session.dropdown = null;
  session.periods = [];
  session.finYear = '';
  session.businessName = '';
  session.taxpayerStatus = '';
  delete session._freqCache;
  if (typeof StatusBroker !== 'undefined' && StatusBroker && typeof StatusBroker.clear === 'function') {
    StatusBroker.clear();
  }
  if (typeof periodStateCache !== 'undefined') {
    for (const k of Object.keys(periodStateCache)) delete periodStateCache[k];
  }
  if (typeof _stableStateCache !== 'undefined') {
    for (const k of Object.keys(_stableStateCache)) delete _stableStateCache[k];
  }
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('_rp_current_gstin', newG);
    }
  } catch (_) {}
  if (typeof chrome !== 'undefined' && chrome.storage) {
    if (chrome.storage.session) {
      const sRemoves = ['rp_dropdown_cache', 'rp_active_client_gstin'];
      if (oldG) sRemoves.push(`rp_dropdown_cache_${oldG}`);
      chrome.storage.session.remove(sRemoves).catch(() => {});
      if (newG) chrome.storage.session.set({ rp_active_client_gstin: newG }).catch(() => {});
    }
    if (chrome.storage.local) {
      const lRemoves = ['rp_period_state_cache', 'rp_generation_timestamps', 'rp_dropdown_local_cache', 'rp_last_active_gstin'];
      if (oldG) lRemoves.push(`rp_dropdown_local_cache_${oldG}`);
      chrome.storage.local.remove(lRemoves).catch(() => {});
    }
  }
  try {
    chrome.runtime.sendMessage({ request: 'user-switch-flush', newGstin: newG }).catch(() => {});
  } catch (_) {}
}

let _isStartingUp = false;
let _lastStartupTs = 0;
async function startupAsync(trigger = 'Initial Boot') {
  if (_isStartingUp) {
    if (typeof rpLog !== 'undefined' && rpLog) {
      rpLog.warn('FLICKER_TRIGGER', `Prevented duplicate startupAsync() call! (Trigger: '${trigger}' blocked while already in progress)`);
    }
    return;
  }
  _isStartingUp = true;
  _lastStartupTs = Date.now();
  if (typeof rpLog !== 'undefined' && rpLog) {
    rpLog.info('STARTUP_ASYNC', `startupAsync() invoked (Trigger: '${trigger}')`);
  }
  try {
    await restoreAllGenerationTimestamps();
    const bizInfo = getElement('businessInfo');

    // ── 0ms Instant Status Paint from cache (Stale-While-Revalidate) ──
    const candidateGstin = (session.gstin || ((typeof localStorage !== 'undefined' && localStorage.getItem('_rp_current_gstin')) || '')).trim().toUpperCase();
    if (candidateGstin) {
      const cachedStatus = getCachedTaxpayerStatus(candidateGstin);
      if (cachedStatus && cachedStatus !== 'Active') {
        session.taxpayerStatus = cachedStatus;
        renderTaxpayerStatus(cachedStatus);
      }
    }
    
    const currentHost = (currentUrl && currentUrl.hostname) ? currentUrl.hostname.toLowerCase() : '';
    const currentPath = (currentUrl && currentUrl.pathname) ? currentUrl.pathname.toLowerCase() : '';

    console.log('[ReturnPilot Boot] Evaluating host route:', { currentHost, currentPath });

    // 1. NOT ON OFFICIAL GST PORTAL
    if (!currentHost.endsWith('gst.gov.in')) {
      console.log('[ReturnPilot Boot] Route matched: NOT ON OFFICIAL GST PORTAL -> Displaying msgOtherWebsite');
      hideAllStateScreens();
      const m = getElement('msgOtherWebsite');
      if (m) m.hidden = false;
      if (bizInfo) bizInfo.hidden = true;
      persistPopupLifecycle('msgOtherWebsite');
      return;
    }

    // 2. EXPLICIT LOGOUT ROUTE OR PUBLIC GST PORTAL (www.gst.gov.in / gst.gov.in)
    // These domains are always the public-facing portal — user is never logged in here.
    // Cover ALL paths on those domains, not just root /
    const isLogoutRoute = currentPath.includes('/services/logout') || currentPath.includes('/logout');
    const isPublicPortal = (currentHost === 'www.gst.gov.in' || currentHost === 'gst.gov.in');

    if (isLogoutRoute || isPublicPortal) {
      console.log('[ReturnPilot Boot] Route matched: PUBLIC PORTAL / LOGOUT -> Displaying msgLoginRequired');
      hideAllStateScreens();
      const loginReq = getElement('msgLoginRequired');
      if (loginReq) loginReq.hidden = false;
      if (bizInfo) bizInfo.hidden = true;
      persistPopupLifecycle('msgLoginRequired', { isPublicPortal, isLogoutRoute });
      return;
    }


    // 3. EXPLICIT LOGIN PAGE ROUTE (services.gst.gov.in/services/login)
    if (currentHost === 'services.gst.gov.in' && currentPath.includes('/services/login')) {
      showStatus(null);
      hideAllStateScreens();
      const loginScreen = getElement('msgLoginPage');
      if (loginScreen) loginScreen.hidden = false;
      if (bizInfo) bizInfo.hidden = true;
      initializeLoginManager();
      persistPopupLifecycle('msgLoginPage');
      return;
    }

    // 4. ON SERVICES PORTAL OR OTHER HOST (NOT return.gst.gov.in)
    if (currentHost !== 'return.gst.gov.in') {
      showStatus(null);
      hideAllStateScreens();
      const m = getElement('msgNotOnReturnDashboard');
      if (m) m.hidden = false;
      if (bizInfo) bizInfo.hidden = true;
      persistPopupLifecycle('msgNotOnReturnDashboard');
      return;
    }

    showStatus('Getting information...');

    // Non-blocking background port connection:
    // Establish port connection asynchronously in the background so it never blocks
    // UI startup, returns rendering, or initial boot (~1.2s saved).
    connect().catch(errConnect => {
      if (typeof rpLog !== 'undefined' && rpLog) {
        rpLog.debug('PORT_NOTICE', 'Background content-script port connection notice (non-fatal)', {
          error: errConnect ? (errConnect.message || String(errConnect)) : 'Unknown'
        });
      }
      console.debug('[ReturnPilot Boot] Background port connection notice (non-fatal):', errConnect);
    });

    // Resolve active tab ID for direct page taxpayer info extraction
    let activeTabId = (currentActiveTabId && currentActiveTabId > 0) ? currentActiveTabId : null;
    if (!activeTabId) {
      try {
        const tabs = await new Promise(r => chrome.tabs.query({ active: true, currentWindow: true }, r));
        if (tabs && tabs[0]) {
          if (!tabs[0].url || !tabs[0].url.startsWith('chrome-extension://')) {
            if (tabs[0].id) {
              activeTabId = tabs[0].id;
              currentActiveTabId = tabs[0].id;
            }
          }
          if (tabs[0].windowId) {
            currentActiveWindowId = tabs[0].windowId;
          }
        }
      } catch (_) {}
    }

    // Eagerly probe page context in parallel with ustatus (< 5ms)
    const earlyPagePromise = activeTabId ? getPageTaxpayerInfoAsync(activeTabId).catch(() => null) : Promise.resolve(null);

    // ── Helper functions for ustatus response parsing ──────────────────────────
    function parseUstatusResponse(rawMsg) {
      if (!rawMsg) return null;
      let clean = rawMsg.response || rawMsg;
      if (!clean) return null;
      if (typeof clean === 'object' && !Array.isArray(clean)) return clean;
      if (typeof clean === 'string') {
        clean = clean.trim();
        try {
          return JSON.parse(clean);
        } catch (initialErr) {
          try {
            let sanitized = clean.replace(/"([^"]+),"([^"]+)"\s*:/g, '"$1":null,"$2":');
            sanitized = sanitized.replace(/"([^"]+),"\s*}/g, '"$1":null}');
            return JSON.parse(sanitized);
          } catch (e) {
            console.warn('[ReturnPilot Boot] JSON parse note for ustatus:', initialErr, clean.substring(0, 150));
          }
        }
      }
      return null;
    }

    function hasEssentialProfile(obj) {
      if (!obj) return false;
      const gstin = obj.gstin || obj.authGstin || (obj.data && (obj.data.gstin || obj.data.authGstin));
      const bname = obj.bname || obj.tradeNam || obj.legalName || obj.lgnm || (obj.data && (obj.data.bname || obj.data.tradeNam || obj.data.legalName));
      return !!(gstin || bname);
    }

    const isOnAuthenticatedReturnsDomain =
      currentHost === 'return.gst.gov.in' &&
      currentPath.startsWith('/returns/auth/');

    let info = null;
    let dropdownVerified = false;

    // ── Eager Concurrent Startup: Authoritative Profile Detail + ustatus + DOM Context ──
    // The official GST portal /services/auth/profile/detail endpoint is the DEFAULT PRIMARY SOURCE
    // for live taxpayer lifecycle registration status (sts: Active, Suspended, Cancelled suo-moto).
    // Concurrently, /services/api/ustatus provides session identity (gstin, bname, regType).
    // Both run in parallel at T=0 via Promise.all, ensuring authoritative status is resolved BEFORE first paint!
    const ustatusUrl = (currentHost === 'return.gst.gov.in')
      ? 'https://return.gst.gov.in/services/api/ustatus'
      : 'https://services.gst.gov.in/services/api/ustatus';

    console.log('[ReturnPilot Boot] Launching parallel profile detail & ustatus probes at T=0:', { ustatusUrl });
    const profilePromise = fetchTaxpayerStatusFromPortal(true).catch(() => null);
    const ustatusPromise = processAsync({ request: 'get', url: ustatusUrl, bypassCache: true }).catch(() => null);

    const [profileRes, uMsg, earlyPageInfo] = await Promise.all([
      profilePromise,
      ustatusPromise,
      earlyPagePromise
    ]);

    info = parseUstatusResponse(uMsg);

    // Fallback: If primary domain's ustatus lacked essential profile, query alternate domain
    if (!hasEssentialProfile(info)) {
      const altUrl = (currentHost === 'return.gst.gov.in')
        ? 'https://services.gst.gov.in/services/api/ustatus'
        : 'https://return.gst.gov.in/services/api/ustatus';
      console.log('[ReturnPilot Boot] Querying alternate domain ustatus:', altUrl);
      const altMsg = await bgFetch({ url: altUrl, bypassCache: true }).catch(() => null);
      const altInfo = parseUstatusResponse(altMsg);
      if (altInfo) info = Object.assign({}, altInfo, info || {});
    }

    // Complement info from profileRes or earlyPageInfo if ustatus was incomplete
    if (!hasEssentialProfile(info)) {
      if (profileRes && (profileRes.gstin || profileRes.bname)) {
        info = {
          gstin: profileRes.gstin,
          bname: profileRes.bname || '',
          regType: profileRes.regType || 'Regular',
          sts: profileRes.status || ''
        };
      } else if (earlyPageInfo && earlyPageInfo.gstin) {
        info = {
          gstin: earlyPageInfo.gstin,
          bname: earlyPageInfo.tradeName || earlyPageInfo.legalName || '',
          regType: earlyPageInfo.regType || 'Regular',
          sts: earlyPageInfo.taxpayerStatus || ''
        };
      }
    }

    // Extract authoritative taxpayer registration details
    if (info && (info.gstin || info.authGstin || (info.data && (info.data.gstin || info.data.authGstin)) || profileRes?.gstin)) {
      const authoritativeGstin = (info.gstin || info.authGstin || (info.data && (info.data.gstin || info.data.authGstin)) || profileRes?.gstin || '').trim().toUpperCase();
      const authoritativeName = info.bname || info.tradeNam || info.legalName || info.lgnm ||
        info.userName || (info.data && (info.data.bname || info.data.tradeNam || info.data.legalName)) ||
        profileRes?.bname || earlyPageInfo?.tradeName || earlyPageInfo?.legalName || 'Taxpayer';
      const authoritativeRegType = info.regType || info.userType || (info.data && (info.data.regType || info.data.userType)) || profileRes?.regType || earlyPageInfo?.regType || 'Regular';

      // ── Taxpayer Status: DEFAULT PRIMARY CHECK from /services/auth/profile/detail (sts field) ──
      // The profileRes.status is the ground truth from the GST portal ("Suspended", "Active", "Cancelled suo-moto").
      const primaryProfileStatus = (profileRes && profileRes.status) ? profileRes.status.trim() : '';
      const rawAppStatus = String(info.appStatus || (info.data && info.data.appStatus) || '').trim().toUpperCase();
      const statusFromInfo = extractStatusFromData(info) || (earlyPageInfo?.taxpayerStatus ? extractStatusFromData(earlyPageInfo.taxpayerStatus) : '');
      const cachedForGstin = getCachedTaxpayerStatus(authoritativeGstin);
      let authoritativeStatus = '';

      if (primaryProfileStatus) {
        authoritativeStatus = primaryProfileStatus;
      } else if (statusFromInfo) {
        authoritativeStatus = statusFromInfo;
      } else if (rawAppStatus === 'CNL' || rawAppStatus.includes('CANCEL')) {
        authoritativeStatus = 'Cancelled';
      } else if (rawAppStatus === 'S' || rawAppStatus === 'SUS' || rawAppStatus.includes('SUSPEND')) {
        authoritativeStatus = 'Suspended';
      } else if (cachedForGstin && cachedForGstin !== 'Active') {
        authoritativeStatus = cachedForGstin;
      } else if (cachedForGstin === 'Active' && rawAppStatus !== 'C') {
        authoritativeStatus = 'Active';
      } else if (rawAppStatus === 'A' || rawAppStatus === 'ACT') {
        authoritativeStatus = 'Active';
      } else {
        // When appStatus is 'C' (Application Completed) and profile details could not be reached, show '—'
        authoritativeStatus = '—';
      }

      // Detect client switch: if the live GSTIN differs from the previous active client,
      // flush all in-memory and local client caches so the new client starts completely clean!
      const prevActiveGstin = (session.gstin || '').trim().toUpperCase() ||
        ((typeof localStorage !== 'undefined' && localStorage.getItem('_rp_current_gstin')) || '').trim().toUpperCase();
      if (prevActiveGstin && prevActiveGstin !== authoritativeGstin) {
        handleClientSwitch(prevActiveGstin, authoritativeGstin);
      }

      session.gstin = authoritativeGstin;
      session.businessName = authoritativeName;
      session.gstRegType = authoritativeRegType;
      session.taxpayerStatus = authoritativeStatus;

      try { localStorage.setItem('_rp_current_gstin', session.gstin); } catch (_) {}
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
        chrome.storage.session.set({ rp_active_client_gstin: session.gstin }).catch(() => {});
      }

      const elN = getElement('businessName'), elG = getElement('businessGstin'), elR = getElement('regType');
      if (elN) elN.textContent = session.businessName;
      if (elG) elG.textContent = session.gstin;
      if (elR) elR.textContent = displayRegType(session.gstRegType);
      renderTaxpayerStatus(session.taxpayerStatus);

      if (typeof rpLog !== 'undefined' && rpLog) {
        rpLog.info('STARTUP_ASYNC', `Authoritative profile/status resolved: gstin=${session.gstin}, name=${session.businessName}, status=${session.taxpayerStatus}`);
      }
    }

    if (currentHost === 'services.gst.gov.in') {
      showStatus('Activating returns session...');
      await new Promise(r => chrome.runtime.sendMessage({ request: 'propagate-session-silently' }, res => { if (chrome.runtime.lastError) {} r(res); }));
    }

    const isSessionActive = isOnAuthenticatedReturnsDomain ||
      hasEssentialProfile(info) ||
      dropdownVerified ||
      !!session.gstin ||
      (info && (info.status_cd === '1' || info.authStatus === 'true' || info.userName || info.role || info.regType || (info.data && (info.data.regType || info.data.userType))));

    console.log('[ReturnPilot Boot] Session evaluation result:', {
      isSessionActive,
      hasEssentialProfile: hasEssentialProfile(info),
      dropdownVerified,
      gstin: session.gstin,
      businessName: session.businessName,
      rawInfo: info
    });

    if (!isSessionActive) {
      console.warn('[ReturnPilot Boot] Active session context not verified. Displaying session requirement prompt.');
      showStatus('Active secure session context required. Please refresh portal or login.');
      hideAllStateScreens();
      if (bizInfo) bizInfo.hidden = false;
      return;
    }


    // Auto-enhance matching saved account in storage with portal's fetched name & GSTIN
    if (session.gstin && (session.businessName || session.gstin)) {
      chrome.storage.local.get(['rp_saved_accounts'], (data) => {
        let accounts = data.rp_saved_accounts || [];
        let updated = false;
        const currentSessionGstin = session.gstin.trim().toUpperCase();
        const panFromGstin = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]/.test(currentSessionGstin)
          ? currentSessionGstin.slice(2, 12).toLowerCase()
          : '';
        accounts = accounts.map(acc => {
          const accGstin = (acc.gstin || '').trim().toUpperCase();
          const accUser = (acc.username || '').trim().toLowerCase();

          // Strict Rule 1: If account already has a GSTIN, it MUST strictly match session GSTIN!
          // NEVER match or touch an account that belongs to a different GSTIN.
          if (accGstin) {
            if (accGstin === currentSessionGstin) {
              updated = true;
              return {
                ...acc,
                clientName: session.businessName || acc.clientName || session.businessName,
                gstin: currentSessionGstin
              };
            }
            return acc;
          }

          // Strict Rule 2: If account has NO GSTIN, only match if username matches the GSTIN or PAN!
          const matchesByUsername = accUser && (accUser === currentSessionGstin.toLowerCase() || (panFromGstin && accUser === panFromGstin));
          if (matchesByUsername) {
            updated = true;
            return {
              ...acc,
              clientName: session.businessName || acc.clientName || session.businessName,
              gstin: currentSessionGstin
            };
          }
          return acc;
        });
        if (updated) {
          chrome.storage.local.set({ rp_saved_accounts: accounts });
        }
      });
    }

    updateReturns();
    const sel = getElement('gstReturnType');
    // Preserve the user's current return-type selection when startupAsync re-runs
    // (the tab-URL listener re-evaluates on every portal navigation — this used
    // to reset the popup to the default GSTR-3B section mid-download). Only
    // default to GSTR-3B on the very first boot.
    const currentKey = session.return && session.return.key;
    const preservedKey = (currentKey && returnConfig[currentKey]) ? currentKey : configR3B.key;
    if (sel) {
      // The dropdown only lists a subset of returns (G3B/G1/G2A/G2B/G9/G9C);
      // the sidebar additionally allows G1A/G4/G4A/IMS. Only sync the dropdown
      // when the preserved selection has an option — session.return drives the
      // workspace regardless.
      const hasOption = [...sel.options].some(o => o.value === preservedKey);
      if (hasOption) sel.value = preservedKey;
      session.return = returnConfig[preservedKey];
      syncSidebarToValue(preservedKey);
    }
    await updatePeriods();
  } catch (err) {
    console.error('startupAsync failed:', err);
    const b = getElement('businessInfo');
    if (b) b.hidden = false;
    showStatus('Application terminal boot timeout. Error: ' + err.message);
  } finally {
    _isStartingUp = false;
  }
}

function addOption(sel, txt, val) { const o = document.createElement('option'); o.value = val; o.textContent = txt; sel.appendChild(o); }
function updateReturns() {
  const s = getElement('gstReturnType');
  if (!s) return;
  while (s.options.length > 0) s.remove(0);
  addOption(s, configR3B.display, configR3B.key);
  addOption(s, configR1.display, configR1.key);
  addOption(s, configR1A.display, configR1A.key);
  addOption(s, configR2A.display, configR2A.key);
  addOption(s, configR2B.display, configR2B.key);
  addOption(s, configIms.display, configIms.key);
  addOption(s, configR2X.display, configR2X.key);
  addOption(s, configR9.display, configR9.key);
  addOption(s, configR9C.display, configR9C.key);
}

async function updatePeriods() {
  showStatus('Getting periods...');

  const clientGstin = (session.gstin || '').trim().toUpperCase();
  const dropdownUrl = 'https://return.gst.gov.in/returns/auth/api/dropdown';
  let msg = null;

  // 1. Live authoritative fetch from GST portal dropdown endpoint (Source of Truth)
  msg = await processAsync({ request: 'get', url: dropdownUrl, bypassCache: true }).catch(() => null);

  if ((!msg || !msg.status) && typeof currentUrl !== 'undefined' && currentUrl && currentUrl.hostname.toLowerCase() === 'services.gst.gov.in') {
    showStatus('Activating returns session...');
    await new Promise(r => chrome.runtime.sendMessage({ request: 'propagate-session-silently' }, res => { if (chrome.runtime.lastError) {} r(res); }));
    msg = await processAsync({ request: 'get', url: dropdownUrl, bypassCache: true }).catch(() => null);
  }

  // 2. Clear any stale multi-day local storage dropdown caches
  try {
    chrome.storage.local.remove(['rp_dropdown_local_cache', `rp_dropdown_local_cache_${clientGstin}`]).catch(() => {});
    chrome.storage.session.remove(['rp_dropdown_cache', `rp_dropdown_cache_${clientGstin}`]).catch(() => {});
  } catch (_) {}

  if (!msg || !msg.status || !msg.response || msg.response.trimStart().startsWith('<')) {
    showStatus('Filing structure lookup failed.');
    return;
  }

  let resp = null;
  try {
    resp = JSON.parse(msg.response);
  } catch (e) {
    showStatus('Invalid filing structure response.');
    return;
  }

  if (resp.status !== 1 || !resp.data || !Array.isArray(resp.data.Years)) {
    showStatus('GSTN drop query rejected');
    return;
  }

  // 3. The GST Portal dropdown API is the sole, authoritative source of truth
  session.dropdown = resp.data;
  session.dropdown.Years.sort((a, b) => parseInt(b.year) - parseInt(a.year));

  if (typeof rpLog !== 'undefined' && rpLog) {
    const yrList = session.dropdown.Years.map(y => y.year).join(', ');
    rpLog.info('DROPDOWN_LOADED', `Loaded ${session.dropdown.Years.length} financial years for ${clientGstin || 'active client'}: [${yrList}]`);
  }

  const sFy = getElement('finYear');
  if (sFy) {
    const prevVal = session.finYear || '';
    while (sFy.options.length > 0) sFy.remove(0);
    session.dropdown.Years.forEach(y => {
      const o = document.createElement('option');
      o.value = y.year;
      o.textContent = y.year;
      sFy.appendChild(o);
    });
    const exists = prevVal && session.dropdown.Years.some(y => y.year === prevVal);
    sFy.value = exists ? prevVal : (sFy.options[0] ? sFy.options[0].value : '');
    session.finYear = sFy.value;
  }

  // Fire filing frequency fetch in background — don't block workspace rendering
  syncFilingFrequency(session.finYear, session.gstin);

  // Wire all global buttons, modals, and navigation listeners exactly once
  wireGlobalUIOnce();
  
  // Background trigger of Notice Radar scan
  scanNoticesAndOrders().catch(() => {});

  const bizInfo = getElement('businessInfo');
  if (bizInfo) bizInfo.hidden = false;
  showStatus(null);
  const w = getElement('workspace');
  if (w) w.hidden = false;
  if (session.return) updateWorkspace();
  persistPopupLifecycle('dashboard');
}

const _freqInFlight = {};
function syncFilingFrequency(finYear, gstin, options = {}) {
  const elF = getElement('filingFreq');
  if (!finYear || !gstin) {
    session.filingFrequency = 'Monthly';
    if (elF) elF.textContent = session.filingFrequency;
    return Promise.resolve('Monthly');
  }

  session._freqCache = session._freqCache || {};
  const fCacheKey = `${gstin}|${finYear}`;

  // 1. Session Cache Hit (0ms)
  if (session._freqCache[fCacheKey]) {
    session.filingFrequency = session._freqCache[fCacheKey];
    if (elF) elF.textContent = session.filingFrequency;
    return Promise.resolve(session.filingFrequency);
  }

  // 2. Single-Flight Coalescing: Join in-flight promise if already pending
  if (_freqInFlight[fCacheKey]) {
    return _freqInFlight[fCacheKey];
  }

  // 3. Fast-path derivation from StatusBroker peek if rolestatus already resolved userPref (0ms)
  if (StatusBroker && typeof StatusBroker.peek === 'function') {
    const testPeriods = ['04' + finYear.substring(0, 4), '05' + finYear.substring(0, 4), '06' + finYear.substring(0, 4)];
    for (const tp of testPeriods) {
      if (StatusBroker.has(tp, false)) {
        const bEntry = StatusBroker.peek(tp, false);
        if (bEntry?.info?.data?.userPref) {
          const derived = bEntry.info.data.userPref === 'Q' ? 'Quarterly' : 'Monthly';
          session.filingFrequency = derived;
          session._freqCache[fCacheKey] = derived;
          if (elF) elF.textContent = derived;
          return Promise.resolve(derived);
        }
      }
    }
  }

  // 4. If live probe is not explicitly requested (e.g. during normal boot or FY switch),
  // default to 'Monthly' (or current session frequency) and let rolestatus derive it in 0ms when row 1 returns!
  if (!options.liveProbe) {
    session.filingFrequency = session.filingFrequency || 'Monthly';
    if (elF) elF.textContent = session.filingFrequency;
    return Promise.resolve(session.filingFrequency);
  }

  const fUrl = gstn.getFilingDetails(finYear, gstin);
  if (!fUrl) {
    session.filingFrequency = 'Monthly';
    if (elF) elF.textContent = 'Monthly';
    return Promise.resolve('Monthly');
  }

  const p = processAsync({ request: 'get', url: fUrl, requestClass: 'FY_METADATA' })
    .then(r => {
      let parsed = null;
      try { parsed = JSON.parse(r?.response); } catch (_) {}
      if (r && r.status && parsed && parsed.status === 1) {
        session.filingFrequency = getFilingFrequency(parsed);
        session._freqCache[fCacheKey] = session.filingFrequency;
      } else if (parsed && parsed.error && parsed.error.errorCode === 'GSTN-EXEC2003') {
        if (typeof rpLog !== 'undefined' && rpLog) {
          rpLog.warn('QRMP_INTERCEPT', 'getfydtls returned GSTN-EXEC2003; preserving/deriving frequency from rolestatus userPref');
        }
        // Negative cache: remember unavailable for this session to stop refiring failing calls
        session.filingFrequency = session.filingFrequency || 'Monthly';
        session._freqCache[fCacheKey] = session.filingFrequency;
      } else if (!session._freqCache[fCacheKey]) {
        session.filingFrequency = 'Monthly';
        session._freqCache[fCacheKey] = 'Monthly';
      }
      return session.filingFrequency;
    })
    .catch(() => {
      if (!session._freqCache[fCacheKey]) {
        session.filingFrequency = 'Monthly';
        session._freqCache[fCacheKey] = 'Monthly';
      }
      return session.filingFrequency;
    })
    .finally(() => {
      delete _freqInFlight[fCacheKey];
      if (elF) elF.textContent = session.filingFrequency;
    });

  _freqInFlight[fCacheKey] = p;
  return p;
}

let _globalUiWired = false;
function wireGlobalUIOnce() {
  if (_globalUiWired) return;
  _globalUiWired = true;

  const sFy = getElement('finYear');
  if (sFy) {
    sFy.onchange = () => {
      session.finYear = sFy.value;
      session.filingFrequency = null; // Reset filing frequency so new FY derives cleanly!
      flashFySelect();
      if (typeof rpLog !== 'undefined' && rpLog) {
        rpLog.info('FY_CHANGE', `Financial year changed to ${session.finYear}`);
        rpLog.userAction('POPUP_FY_CHANGE', `User changed Financial Year to ${session.finYear}`, { finYear: session.finYear, gstin: session.gstin });
      }
      // Immediately render workspace for new FY — non-blocking, zero skeleton flicker!
      if (session.return) updateWorkspace(false);

      syncFilingFrequency(session.finYear, session.gstin);
    };
  }

  const btnR = getElement('refresh');
  if (btnR) {
    btnR.onclick = async () => {
      btnR.classList.add('refreshing');
      window._rpIsRefreshing = true;
      try {
        // Clear background SW cache so refresh gets live un-cached responses from GST portal
        try {
          await new Promise(r => chrome.runtime.sendMessage({ request: 'clear-sw-cache' }, r));
        } catch (_) {}

        StatusBroker.clear();
        if (typeof rpLog !== 'undefined' && rpLog) {
          rpLog.userAction('POPUP_REFRESH_CLICK', `User clicked Refresh button in ReturnPilot`, { gstin: session.gstin, finYear: session.finYear });
        }
        const gstin = session.gstin || '';
        // Invalidate dropdown caches only — PRESERVE active generation timestamps!
        // Ongoing portal generation jobs take 2-20 minutes; wiping them causes false flips to Available/Not Generated.
        chrome.storage.session.remove(['rp_dropdown_cache', `rp_dropdown_cache_${gstin}`]).catch(() => {});
        chrome.storage.local.remove(['rp_dropdown_local_cache', `rp_dropdown_local_cache_${gstin}`]).catch(() => {});
        session.dropdown = null;
        await updatePeriods();
        await updateWorkspace();
        await scanNoticesAndOrders(true).catch(() => {});
        await fetchTaxpayerStatusFromPortal(true).catch(() => {});
      } finally {
        window._rpIsRefreshing = false;
        btnR.classList.remove('refreshing');
      }
    };
  }

  document.querySelectorAll('.sidebar-item').forEach(item => {
    item.onclick = (e) => {
      if (e) e.preventDefault();
      const v = item.dataset.value;
      if (!v || !returnConfig[v]) return;
      if (session.return && session.return.key === v) return; // Already on this tab — ignore duplicate click
      stopAllFileGenBackgroundPollers();
      const s = getElement('gstReturnType');
      if (s) s.value = v;
      session.return = returnConfig[v];
      syncSidebarToValue(v);
      const b = getElement('banner-generating');
      if (b) b.hidden = true;
      if (typeof rpLog !== 'undefined' && rpLog) {
        rpLog.userAction('POPUP_TAB_SWITCH', `User switched return tab to ${returnConfig[v]?.display || v} (${v})`, { returnKey: v, finYear: session.finYear });
      }
      updateWorkspace(false); // Tab switch is instant and clean — no skeleton stutter
    };
  });

  const selR = getElement('gstReturnType');
  if (selR) {
    selR.onchange = function() { syncSidebarToValue(this.value); };
  }

  const bGen = getElement('btn-gen-all'), bDl = getElement('btn-download-all'), bSum = getElement('btn-pdf-summary-all'), bDet = getElement('btn-pdf-detail-all'), bEx = getElement('btn-excel-all'), bConsolidated = getElement('btn-consolidated-excel'), bLedger = getElement('btn-cash-credit-ledger');
  if (bGen) bGen.onclick = async () => { await generateAll(); }; 
  if (bDl) bDl.onclick = async () => { await downloadAll(); }; 
  if (bSum) bSum.onclick = async () => { await downloadAllPdfs('summary'); }; 
  if (bDet) bDet.onclick = async () => { await downloadAllPdfs('detail'); }; 
  if (bEx) bEx.onclick = async () => { await downloadAllExcels(); };
  if (bConsolidated) bConsolidated.onclick = async () => { await downloadConsolidatedExcel(); };
  if (bLedger) bLedger.onclick = async () => { await downloadCashCreditLedger(); };

  // Notice & Demand Radar Modal Controller
  const btnNotice = getElement('noticeRadarBtn');
  const modalNotice = getElement('noticeRadarModal');
  const btnCloseNotice = getElement('closeNoticeRadarModalBtn');
  if (btnNotice && modalNotice) {
    btnNotice.onclick = () => {
      modalNotice.hidden = false;
      modalNotice.style.display = 'flex';
      if (!_cachedNoticeData) {
        scanNoticesAndOrders(true).catch(() => {});
      } else {
        renderNoticeRadarList();
      }
    };
  }
  if (btnCloseNotice && modalNotice) {
    btnCloseNotice.onclick = () => {
      modalNotice.hidden = true;
      modalNotice.style.display = 'none';
    };
  }
  if (modalNotice) {
    modalNotice.onclick = (e) => {
      if (e.target === modalNotice) {
        modalNotice.hidden = true;
        modalNotice.style.display = 'none';
      }
    };
  }

  const btnOpenPortalNotices = getElement('btnOpenPortalNotices');
  if (btnOpenPortalNotices) {
    btnOpenPortalNotices.onclick = async () => {
      try {
        const tabs = await new Promise(r => chrome.tabs.query({ active: true, currentWindow: true }, r));
        if (tabs && tabs[0] && tabs[0].id) {
          await chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            func: () => {
              const officialNav = document.querySelector('a[href*="/services/auth/notices"], a[href*="viewnotices"], a[data-ng-click*="notices"]');
              if (officialNav) {
                officialNav.click();
              } else {
                window.location.href = 'https://services.gst.gov.in/services/auth/notices';
              }
            }
          });
          window.close();
        } else {
          chrome.tabs.create({ url: 'https://services.gst.gov.in/services/auth/notices' });
        }
      } catch (errNav) {
        console.warn('[Notice Navigation] Navigation error:', errNav);
        chrome.tabs.create({ url: 'https://services.gst.gov.in/services/auth/notices' });
      }
    };
  }

  // Live auto-refresh: Automatically checks portal notices every 15s while popup is open
  if (!window._rpNoticeRefreshTimer) {
    window._rpNoticeRefreshTimer = setInterval(() => {
      if (!document.hidden) scanNoticesAndOrders(false).catch(() => {});
    }, 15000);
  }

  window.addEventListener('focus', () => scanNoticesAndOrders(false).catch(() => {}));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) scanNoticesAndOrders(false).catch(() => {});
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && (msg.action === 'REFRESH_NOTICES' || msg.request === 'notice-viewed-on-portal')) {
      scanNoticesAndOrders(true).catch(() => {});
    }
    if (msg && (msg.action === 'CLIENT_SWITCH_REFRESH' || msg.request === 'CLIENT_SWITCH_REFRESH')) {
      const newG = (msg.newGstin || '').trim().toUpperCase();
      if (newG && newG !== (session.gstin || '').trim().toUpperCase()) {
        handleClientSwitch(session.gstin, newG);
        session.gstin = newG;
        const elG = getElement('businessGstin');
        if (elG) elG.textContent = newG;
        updatePeriods().then(() => updateWorkspace()).catch(() => {});
      }
    }
  });
}


function flashFySelect() {
  const sel = document.getElementById('finYear');
  if (!sel) return;
  sel.classList.remove('fy-changed');
  void sel.offsetWidth; // force reflow to restart animation
  sel.classList.add('fy-changed');
  setTimeout(() => sel.classList.remove('fy-changed'), 750);
}

// Renders n skeleton rows as a placeholder table while real data loads
function renderSkeletonTable(divStatus, cfg, rowCount) {
  if (!divStatus) return;

  // Dynamically calculate appropriate skeleton rows based on return schema
  if (rowCount === undefined || rowCount === null) {
    if (!cfg || cfg.isAnnual) {
      rowCount = 1;
    } else if (cfg.isQuarterly) {
      rowCount = 4;
    } else if (cfg.workflowType === WORKFLOW_TYPES.IMS_PORTAL || cfg.key === 'IMS') {
      rowCount = 1;
    } else {
      const yearData = (typeof session !== 'undefined' && session.dropdown && session.finYear)
        ? (session.dropdown.Years || []).find(y => y.year === session.finYear)
        : null;
      if (yearData && yearData.months) {
        rowCount = yearData.months.length;
      } else {
        const fyParts = (session.finYear || '').split('-');
        const sYr = parseInt(fyParts[0], 10);
        const now = new Date();
        const curM = now.getMonth() + 1;
        const curY = now.getFullYear();
        const isCurrentFy = (curM >= 4 && sYr === curY) || (curM < 4 && sYr === curY - 1);
        rowCount = isCurrentFy ? (curM >= 4 ? curM - 3 : curM + 9) : 12;
      }
    }
  }

  const isWithCb = cfg && (cfg.key === 'G1' || cfg.key === 'G1A' || cfg.key === 'G2B');
  const tableClass = isWithCb ? 'rt-table rt-table-with-cb' : 'rt-table rt-table-standard';
  const headerCb = isWithCb
    ? `<th class="rt-cb-th"><input type="checkbox" disabled style="cursor:not-allowed;" /></th>`
    : '';

  const key = cfg ? cfg.key : '';
  let ghostPills = [];
  if (key === 'G3B') {
    ghostPills = ['rt-skeleton-btn-json', 'rt-skeleton-btn-pdf'];
  } else if (key === 'R4' || (typeof configR4 !== 'undefined' && key === configR4?.key)) {
    ghostPills = ['rt-skeleton-btn-json'];
  } else if (key === 'IMS' || (typeof WORKFLOW_TYPES !== 'undefined' && cfg?.workflowType === WORKFLOW_TYPES?.IMS_PORTAL)) {
    ghostPills = ['rt-skeleton-btn-gen', 'rt-skeleton-btn-json', 'rt-skeleton-btn-excel'];
  } else if (key === 'G2X' || key === 'G2XEXL') {
    ghostPills = ['rt-skeleton-btn-json', 'rt-skeleton-btn-excel'];
  } else {
    ghostPills = ['rt-skeleton-btn-gen', 'rt-skeleton-btn-json', 'rt-skeleton-btn-excel', 'rt-skeleton-btn-pdf'];
  }
  const skeletonActionPills = ghostPills.map(cls => `<span class="rt-skeleton-btn-ghost ${cls}"></span>`).join('');

  const skeletonRows = Array.from({ length: rowCount }, () => {
    const cbCell = isWithCb
      ? `<td class="rt-cb-td"><input type="checkbox" disabled /></td>`
      : '';
    return `<tr class="rt-skeleton-row">
      ${cbCell}
      <td class="rt-month"><span class="rt-skeleton-cell rt-skeleton-month"></span></td>
      <td class="rt-status rt-status-filing"><span class="rt-skeleton-cell rt-skeleton-pill"></span></td>
      <td class="rt-status rt-status-ledger"><span class="rt-skeleton-cell rt-skeleton-pill"></span></td>
      <td class="rt-actions-cell"><div class="rt-actions-skeleton">${skeletonActionPills}</div></td>
    </tr>`;
  }).join('');

  divStatus.innerHTML = `<table class="${tableClass}">
    <thead><tr>${headerCb}<th class="rt-col-month">Period</th><th class="rt-col-filing">Filing Status</th><th class="rt-col-ledger">Portal Status</th><th class="rt-col-actions">Actions</th></tr></thead>
    <tbody>${skeletonRows}</tbody>
  </table>`;
}

async function updateWorkspace(showSkeleton = false) {
  if (!session.return) return; 
  const divStatus = getElement('returnStatus'); 
  if (!divStatus) return;

  const now = Date.now();
  const cfg = session.return;
  const isDuplicate = !window._rpIsBenchmarking && (_lastRenderKey === cfg?.key && _lastRenderFy === session.finYear && (now - _lastRenderTs < 400));
  if (isDuplicate) {
    if (typeof rpLog !== 'undefined' && rpLog) {
      rpLog.warn('FLICKER_TRIGGER', `Blocked duplicate updateWorkspace within ${now - _lastRenderTs}ms for ${cfg?.key} (${session.finYear})`);
    }
    return;
  }

  const bGenBanner = getElement('banner-generating');
  if (bGenBanner) bGenBanner.hidden = true;

  if (showSkeleton) {
    // Only show skeleton if no table exists yet and we have no cached periods
    const existingTable = divStatus.querySelector('table');
    const hasCachedPeriods = session.periods && session.periods.some(p => p._settled || p.filingLabel);
    if (!existingTable && !hasCachedPeriods) {
      renderSkeletonTable(divStatus, session.return);
      const skTable = divStatus.querySelector('table');
      if (skTable) skTable.classList.add('rt-table-loading');
    }
  }

  updateBulkPdfButtonState();
  updateBulkGenerateButtonState();
  await updateWorkspaceInnerData();

  if (showSkeleton) {
    // Fade in the real table
    const realTable = divStatus.querySelector('table');
    if (realTable) {
      realTable.classList.add('rt-table-loading');
      setTimeout(() => realTable.classList.remove('rt-table-loading'), 250);
    }
  }

  updateBulkPdfButtonState();
  updateBulkGenerateButtonState();
}

function updateBulkPdfButtonState() {
  const bDl = getElement('btn-download-all'), bSum = getElement('btn-pdf-summary-all'), bDet = getElement('btn-pdf-detail-all'), bEx = getElement('btn-excel-all'), bConsolidated = getElement('btn-consolidated-excel'), bLedger = getElement('btn-cash-credit-ledger');
  const cfg = session.return;
  const acts = cfg ? getActionsFor(cfg.key) : { pdf: false, excel: false, json: true };

  // Base format map layout
  if (bDl)  bDl.hidden  = !acts.json;
  if (bSum) bSum.hidden = !acts.pdf;
  if (bDet) bDet.hidden = !(acts.pdf && cfg && (cfg.key === configR1A.key || cfg.key === configR2B.key));
  if (bEx)  bEx.hidden  = !acts.excel;

  // Cash & Credit Ledger Button (Exclusive to GSTR-3B section)
  if (bLedger) {
    bLedger.hidden = !(cfg && cfg.key === configR3B.key);
  }

  // Consolidated Master Excel Button (GSTR-1, GSTR-1A, GSTR-2B)
  if (bConsolidated) {
    if (cfg && (cfg.key === 'G1' || cfg.key === 'G1A')) {
      bConsolidated.hidden = false;
      const isAnyGenerating = session.periods && session.periods.some(p => (p.filingStatus === 'FIL' || p.filingLabel === 'Filed') && !p.isNil && p.filingLabel !== 'Nil Filed' && p.filingStatus !== 'NIL_FILED' && (p.currentState === RETURN_STATES.GENERATING || p.currentState === RETURN_STATES.NOT_GENERATED));
      bConsolidated.disabled = isAnyGenerating;
      const combinedExcelLabel = (isSidePanelSurface || (typeof window !== 'undefined' && window.innerWidth <= 650)) ? 'Excel (Combined)' : 'Excel (All Months Combined)';
      bConsolidated.innerHTML = combinedExcelLabel;
      if (isAnyGenerating) {
        bConsolidated.title = 'GSTR-1 JSON files are generating on the GST Portal. Please wait until generation completes.';
      } else {
        bConsolidated.title = 'Export multi-period consolidated sales workbook with B2B, B2C, and HSN breakdowns';
      }
    } else if (cfg && cfg.key === 'G2B') {
      bConsolidated.hidden = false;
      bConsolidated.disabled = false;
      const combinedExcelLabel = (isSidePanelSurface || (typeof window !== 'undefined' && window.innerWidth <= 650)) ? 'Excel (Combined)' : 'Excel (All Months Combined)';
      bConsolidated.innerHTML = combinedExcelLabel;
      bConsolidated.title = 'Export multi-period consolidated purchase workbook with Supplier rollup & ITC breakdown';
    } else if (cfg && (cfg.key === 'G2X' || cfg.key === configR2X.key || cfg.key === configR2XExcel.key)) {
      bConsolidated.hidden = false;
      bConsolidated.disabled = false;
      const combinedExcelLabel = (isSidePanelSurface || (typeof window !== 'undefined' && window.innerWidth <= 650)) ? 'Excel (Combined)' : 'Excel (All Months Combined)';
      bConsolidated.innerHTML = combinedExcelLabel;
      bConsolidated.title = 'Export multi-period consolidated TDS & TCS credit received workbook with 4 sheets (tds, tcs, tdsa, tcsa)';
    } else if (cfg && (cfg.key === 'G3B' || cfg.key === configR3B.key)) {
      bConsolidated.hidden = false;
      bConsolidated.disabled = false;
      const combinedExcelLabel = (isSidePanelSurface || (typeof window !== 'undefined' && window.innerWidth <= 650)) ? 'Excel (Combined)' : 'Excel (All Months Combined)';
      bConsolidated.innerHTML = combinedExcelLabel;
      bConsolidated.title = 'Export multi-period consolidated GSTR-3B workbook with GSTR-9 matrix, Outward, ITC, & Payment ledgers';
    } else {
      bConsolidated.hidden = true;
    }
  }

  // Clean uniform bulk descriptors
  if (bSum) {
    bSum.innerHTML = (cfg && cfg.key === configR1A.key) ? 'Standalone PDF' : 'PDF All';
  }
  if (bDet) {
    bDet.innerHTML = (cfg && cfg.key === configR1A.key) ? 'Consolidated PDF' : 'Detailed PDF';
  }

  // Annual schema gate: if form is completely unavailable/pending, conceal download controls
  if (cfg && cfg.key === 'G9C') {
    const isFormAvailable = session.periods.some(p => p.currentState === RETURN_STATES.AVAILABLE || p.currentState === RETURN_STATES.DOWNLOADED);
    if (!isFormAvailable && session.periods.length > 0) {
      if (bDl)  bDl.hidden  = true;
      if (bSum) bSum.hidden = true;
      if (bEx)  bEx.hidden  = true;
      if (bDet) bDet.hidden = true;
      if (bConsolidated) bConsolidated.hidden = true;
    }
  } else if (cfg && cfg.key === 'G9') {
    const isNA = session.periods.every(p => p.filingLabel === 'Not Applicable' || p.currentState === RETURN_STATES.NO_DATA);
    if (isNA && session.periods.length > 0) {
      if (bDl)  bDl.hidden  = true;
      if (bSum) bSum.hidden = true;
      if (bEx)  bEx.hidden  = true;
      if (bDet) bDet.hidden = true;
      if (bConsolidated) bConsolidated.hidden = true;
    }
  }
}

// Append the new function right here:
function updateBulkGenerateButtonState() {
  const genGroup = getElement('toolbar-generate-group');
  if (!genGroup) return;

  const cfg = session.return;
  if (!cfg || !cfg.showGenerate) {
    genGroup.hidden = true;
    return;
  }

  if (cfg.key === 'G9') {
    const isNA = session.periods.every(p => p.filingLabel === 'Not Applicable' || p.currentState === RETURN_STATES.NO_DATA);
    genGroup.hidden = isNA && session.periods.length > 0;
    return;
  }

  if (cfg.key === 'G9C') {
    const isFormAvailable = session.periods.some(p => {
      const actions = getAvailableActions(p, cfg);
      return actions.includes('generate');
    });
    
    genGroup.hidden = !isFormAvailable;
    return;
  }

  genGroup.hidden = false;
}

function resolveFilingPillClass(label) {
  if (!label || label.toLowerCase().startsWith('checking')) return 'rt-status-loading';
  const l = label.toLowerCase();
  if (l === 'live dynamic' || l === 'dynamic') return 'rt-status-dynamic';
  if (l === 'filed' || l === 'nil filed' || l === 'auto-generated') return 'rt-status-filed';
  if (l === 'not filed' || l === 'pending') return 'rt-status-notfiled';
  if (l === 'error' || l === 'access denied' || l === 'invalid period') return 'rt-status-error';
  if (l === 'not applicable' || l === 'quarter-end generation' || l === 'quarterly' || l === 'optional (iff)' || l === 'quarter end' || l === 'no itc' || l === 'no data' || l === 'no records') return 'rt-status-na';
  return 'rt-status-warn';
}

function isDynamicG2aPeriod(period, finYear) {
  if (!period || !period.value || period.value.length < 6) return false;
  const mm = parseInt(period.value.substring(0, 2), 10);
  const yyyy = parseInt(period.value.substring(2, 6), 10);
  if (isNaN(mm) || isNaN(yyyy)) return false;

  const now = new Date();
  const curMonth = now.getMonth() + 1; // 1-12
  const curYear = now.getFullYear();

  // 1. Current calendar month is dynamically receiving real-time supplier uploads
  if (mm === curMonth && yyyy === curYear) return true;

  // 2. Previous calendar month prior to GSTR-2B static snapshot on the 14th
  let prevMonth = curMonth - 1;
  let prevYear = curYear;
  if (prevMonth === 0) {
    prevMonth = 12;
    prevYear = curYear - 1;
  }
  if (mm === prevMonth && yyyy === prevYear && now.getDate() <= 14) {
    return true;
  }

  return false;
}

function syncMasterCheckbox() {
  const masterCb = getElement('master-period-cb') || getElement('cb-master-period');
  if (!masterCb) return;
  const enabledCbs = Array.from(document.querySelectorAll('.period-cb:not(:disabled)'));
  if (enabledCbs.length === 0) {
    masterCb.checked = false;
    masterCb.disabled = true;
    masterCb.title = 'No filed periods available to select';
  } else {
    masterCb.disabled = false;
    masterCb.removeAttribute('title');
    const checkedCount = enabledCbs.filter(cb => cb.checked).length;
    masterCb.checked = checkedCount > 0 && checkedCount === enabledCbs.length;
  }
}


/* ══════════════════════════════════════════════════════════════════════════
 * 🏛️ GST PORTAL — PRODUCTION ELASTIC HARVESTER WITH SPECULATIVE HEDGE (v11.0)
 * FY Audit & Speed Engine (rolestatus + formdetails)
 *
 * Architecture:
 *   - Base Allocation : 3 Role + 2 Form (5 active in-flight)
 *   - Elastic Burst   : Up to 4 Role + 3 Form (7 active) when RTT < 650ms/1200ms
 *   - Congestion Fuse : Instant clamp to 2R + 1F if any call > 1,800ms
 *   - Speculative Hedge: Hard abort at 5,000ms & re-queue to tail (max 1 retry)
 * ══════════════════════════════════════════════════════════════════════════ */
const HARVEST_CONFIG = {
  HARD_TIMEOUT_MS       : 15000,
  HEDGE_TIMEOUT_MS      : 5000,  // Speculative tail-hedge abort trigger
  MAX_HEDGES            : 1,     // Limit retries to 1 per period to avoid thrashing
  BASE_ROLE_CONCURRENCY : 3,
  BASE_FORM_CONCURRENCY : 2,
  MAX_ROLE_CONCURRENCY  : 4,
  MAX_FORM_CONCURRENCY  : 3,
  HEALTHY_ROLE_RTT      : 650,   // ms
  HEALTHY_FORM_RTT      : 1200,  // ms
  CONGESTION_RTT        : 1800   // ms (Clamps concurrency before queue explodes)
};

/* ── Dynamic State Engine ── */
const Engine = {
  inFlightRole: 0,
  inFlightForm: 0,
  activeRequests: new Map(), // id -> startTime
  lastRoleRtt: 500,
  lastFormRtt: 1000,
  burstEvents: 0,
  brakeEvents: 0,
  hedgeEvents: 0,

  reset() {
    this.inFlightRole = 0;
    this.inFlightForm = 0;
    this.activeRequests.clear();
    this.lastRoleRtt = 500;
    this.lastFormRtt = 1000;
    this.burstEvents = 0;
    this.brakeEvents = 0;
    this.hedgeEvents = 0;
  },

  isCongested() {
    const now = performance.now();
    for (const start of this.activeRequests.values()) {
      if (now - start > HARVEST_CONFIG.CONGESTION_RTT) return true;
    }
    return false;
  },

  canDispatch(api) {
    if (this.isCongested()) {
      this.brakeEvents++;
      return api === 'role' ? this.inFlightRole < 2 : this.inFlightForm < 1;
    }

    const roleHealthy = this.lastRoleRtt < HARVEST_CONFIG.HEALTHY_ROLE_RTT;
    const formHealthy = this.lastFormRtt < HARVEST_CONFIG.HEALTHY_FORM_RTT;

    if (api === 'role') {
      const limit = roleHealthy ? HARVEST_CONFIG.MAX_ROLE_CONCURRENCY : HARVEST_CONFIG.BASE_ROLE_CONCURRENCY;
      if (this.inFlightRole >= HARVEST_CONFIG.BASE_ROLE_CONCURRENCY && roleHealthy) this.burstEvents++;
      return this.inFlightRole < limit;
    } else {
      const limit = formHealthy ? HARVEST_CONFIG.MAX_FORM_CONCURRENCY : HARVEST_CONFIG.BASE_FORM_CONCURRENCY;
      if (this.inFlightForm >= HARVEST_CONFIG.BASE_FORM_CONCURRENCY && formHealthy) this.burstEvents++;
      return this.inFlightForm < limit;
    }
  }
};

async function timedFetch(url, api, id, timeoutMs) {
  const start = performance.now();
  if (api === 'role') Engine.inFlightRole++;
  else Engine.inFlightForm++;
  Engine.activeRequests.set(id, start);

  try {
    const res = await processAsync({ request: 'get', url, timeoutMs }, timeoutMs);
    const ms = +(performance.now() - start).toFixed(1);

    if (api === 'role') Engine.lastRoleRtt = ms;
    else Engine.lastFormRtt = ms;

    const isTimedOut = Boolean(
      (res && (res.error?.includes('Timeout') || res.status === 'TIMEOUT' || res.statusCode === 'TIMEOUT')) ||
      (!res?.status && ms >= (timeoutMs - 150))
    );

    let parsedData = null;
    if (res && res.response) {
      if (typeof res.response === 'object') parsedData = res.response;
      else {
        try { parsedData = JSON.parse(res.response); } catch (_) {}
      }
    }

    return {
      ok: Boolean(res && res.status && !isTimedOut && parsedData),
      status: isTimedOut ? 'TIMEOUT' : (res?.statusCode || (res?.status ? 200 : 'ERR')),
      ms,
      data: parsedData,
      timedOut: isTimedOut
    };
  } catch (err) {
    const ms = +(performance.now() - start).toFixed(1);
    const isTimedOut = ms >= (timeoutMs - 150);
    return {
      ok: false,
      status: isTimedOut ? 'TIMEOUT' : 'ERR',
      ms,
      data: null,
      timedOut: isTimedOut
    };
  } finally {
    Engine.activeRequests.delete(id);
    if (api === 'role') Engine.inFlightRole--;
    else Engine.inFlightForm--;
  }
}

/**
 * Synchronously pre-populates a period object from periodStateCache or StatusBroker peek (0ms).
 * Allows initial table HTML to render already settled in green ("Filed" / "Available") or grey ("Not Applicable"),
 * completely eliminating visual pill flickering and skeleton jumping on initial render or tab switches.
 */
function prepopulatePeriodFromCache(p, cfg) {
  if (!p || !p.value || !cfg) return false;
  const returnKey = cfg.key;
  const finYear = (typeof session !== 'undefined' && session && session.finYear) ? session.finYear : '';
  const cacheKey = periodCacheKey(returnKey, finYear, p.value);
  const cached = periodStateCache[cacheKey];

  if (cached && (cached.filingLabel || cached.currentState)) {
    p.currentState   = cached.currentState || RETURN_STATES.AVAILABLE;
    p.currentMessage = cached.currentMessage || '—';
    p.filingStatus   = cached.filingStatus || '';
    p.filingLabel    = cached.filingLabel || '';
    p.isValid        = Boolean(cached.isValid);
    p.isNil          = Boolean(cached.isNil);
    p.arn            = cached.arn || null;
    p.fil_dt         = cached.fil_dt || null;
    p.genDate        = cached.genDate || null;
    p.genTime        = cached.genTime || null;
    p.hasExcel       = Boolean(cached.hasExcel);
    p.hasJson        = Boolean(cached.hasJson);
    p.fileCount      = cached.fileCount || 0;
    p.gstr2xRecordCount = (typeof cached.gstr2xRecordCount === 'number') ? cached.gstr2xRecordCount : undefined;
    const isG1Family = (returnKey === 'G1' || returnKey === 'G1EXL');
    const is2AFamily = (returnKey === 'G2A' || returnKey === 'G2AEXL');
    const needsG1Probe = isG1Family && !cached.isNil && (cached.filingStatus === 'FIL' || cached.filingLabel === 'Filed') && !cached.genDate;
    const needs2AProbe = is2AFamily && !cached.genDate && cached.currentState !== RETURN_STATES.NOT_GENERATED;
    p._settled       = (cached.currentState !== RETURN_STATES.GENERATING && cached.currentState !== RETURN_STATES.CHECKING && !needsG1Probe && !needs2AProbe);
    return true;
  }

  // Next: check StatusBroker peek (0ms in-memory cache from multi-return rolestatus or TDS/TCS broker)
  if (typeof StatusBroker !== 'undefined' && StatusBroker) {
    if (cfg.key === configR2X.key || cfg.key === 'G2X' || cfg.key === configR2XExcel.key) {
      if (typeof StatusBroker.peek2x === 'function') {
        const broker2x = StatusBroker.peek2x(p);
        if (broker2x) {
          p.filingStatus = broker2x.isFiled ? 'FIL' : 'NF';
          p.filingLabel  = broker2x.isFiled ? 'Filed' : 'Not Filed';
          p.due_dt       = broker2x.due_dt || '';
          p.gstr2xRecordCount = broker2x.totalRecords || 0;
          p.currentState = RETURN_STATES.AVAILABLE;
          p.currentMessage = (broker2x.totalRecords > 0 || broker2x.isFiled) ? 'Available' : 'Not Available';
          p.isValid      = (broker2x.totalRecords > 0 || broker2x.isFiled);
          p._settled     = true;
          return true;
        }
      }
      return false;
    }

    // GSTR-2B and IMS are NOT part of GST Portal's rolestatus API payload
    if (
      cfg.key === configR2B.key ||
      cfg.key === configR2BExcel.key ||
      cfg.key === configIms.key ||
      cfg.key === 'IMS' ||
      cfg.workflowType === WORKFLOW_TYPES.IMS_PORTAL
    ) {
      return false;
    }

    const brokerEntry = StatusBroker.peek(p.value, cfg.isAnnual);
    const info = brokerEntry?.info;
    if (info && info.data) {
      if (cfg.isAnnual) {
        return false;
      }

      // Check M1/M2 quarterly returns
      const mNum = parseInt(p.value.substring(0, 2), 10);
      const isM1orM2 = (mNum % 3 !== 0);
      if (isM1orM2 && cfg.isQuarterly) {
        p.currentState   = RETURN_STATES.NO_DATA;
        p.currentMessage = '—';
        p.filingLabel    = 'Quarterly';
        p.filingStatus   = 'NOT_APPLICABLE';
        p.isValid        = false;
        p._settled       = true;
        return true;
      }

      const returnInfo = getReturnInfo(info, cfg.apiCode);
      const fStatus = (returnInfo ? returnInfo.status : '').toUpperCase();
      if (fStatus) {
        p.filingStatus = fStatus;
        if (fStatus === cfg.expFilingStatus) {
          const is2A = (cfg.key === configR2A.key);
          const fLabel = is2A ? 'Auto-Generated' : 'Filed';
          p.filingLabel = fLabel;
          p.isValid = true;
          p._settled = is2A ? Boolean(p.genDate) : true;
          p.currentState = p.genDate ? RETURN_STATES.AVAILABLE : (is2A ? RETURN_STATES.CHECKING : RETURN_STATES.AVAILABLE);
          p.currentMessage = p.genDate ? (p.genTime ? formatRelativeTime(`${p.genDate} ${p.genTime}`) : formatRelativeTime(p.genDate)) : (is2A ? 'Checking…' : 'Available');
          return true;
        } else {
          let l = displayFilingStatus(fStatus);
          const isQuarterlyPeriod = (info?.data?.userPref === 'Q');
          if (isQuarterlyPeriod && isM1orM2 && (returnInfo?.tileDisable || fStatus === 'NF' || fStatus === 'NOT_APPLICABLE' || fStatus === 'NOT_AVAIL' || fStatus === '' || !returnInfo || returnInfo.status === 'NOT_APPLICABLE')) {
            l = 'Quarterly';
          }
          const isNA = (l === 'Quarterly' || l === 'Not Applicable' || l === 'Not available' || fStatus === 'NOT_APPLICABLE' || fStatus === 'NOT_AVAIL' || fStatus === 'NO_DATA' || fStatus === 'N');
          p.filingLabel = l;
          p.currentState = isNA ? RETURN_STATES.NO_DATA : RETURN_STATES.NOT_GENERATED;
          p.currentMessage = '—';
          p.isValid = (l === 'Filed' || (cfg.key === configR9.key && !isNA));
          p._settled = true;
          return true;
        }
      }
    }
  }

  if (cfg.key === configIms.key || cfg.key === 'IMS' || cfg.workflowType === WORKFLOW_TYPES.IMS_PORTAL) {
    p.isValid        = true;
    p.filingStatus   = 'AUTOGN';
    p.filingLabel    = 'Available';
    p.currentState   = p.genDate ? RETURN_STATES.AVAILABLE : RETURN_STATES.AVAILABLE;
    p.currentMessage = p.genDate ? (p.genTime ? formatRelativeTime(`${p.genDate} ${p.genTime}`) : formatRelativeTime(p.genDate)) : 'Available';
    p._settled       = false;
    return true;
  }

  p.isValid        = false;
  p.filingStatus   = '';
  p.filingLabel    = 'Checking…';
  p.currentState   = RETURN_STATES.CHECKING;
  p.currentMessage = 'Checking…';
  p._settled       = false;
  return false;
}

let _lastRenderKey = '';
let _lastRenderFy = '';
let _lastRenderTs = 0;
let activeWorkspaceAbortController = null;

async function updateWorkspaceInnerData() {
  const divStatus = getElement('returnStatus'); 
  if (!divStatus) return;

  const cfg = session.return;
  const now = Date.now();
  const isDuplicateRender = (_lastRenderKey === cfg?.key && _lastRenderFy === session.finYear && (now - _lastRenderTs < 400));

  if (isDuplicateRender) {
    if (typeof rpLog !== 'undefined' && rpLog) {
      rpLog.warn('FLICKER_TRIGGER', `Blocked duplicate table render within ${now - _lastRenderTs}ms for ${cfg?.key} (${session.finYear})`);
    }
    return;
  }

  _lastRenderKey = cfg?.key || '';
  _lastRenderFy = session.finYear || '';
  _lastRenderTs = now;

  if (activeWorkspaceAbortController) {
    try { activeWorkspaceAbortController.abort(); } catch (_) {}
  }
  activeWorkspaceAbortController = new AbortController();
  const renderSignal = activeWorkspaceAbortController.signal;
  
  const thisRenderId = ++currentWorkspaceRenderId;
  const rows = [];

  if (typeof rpLog !== 'undefined' && rpLog) {
    rpLog.info('WORKSPACE_RENDER', `Workspace rendered for ${cfg?.key} (${session.finYear}) [Render #${thisRenderId}]`);
  }

  session.periods.length = 0;

  // -- IMS: Instant 0ms table render (no ghosting) followed by async check --
  if (cfg.workflowType === WORKFLOW_TYPES.IMS_PORTAL) {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    const mm = d.getMonth() + 1;
    const yyyy = d.getFullYear();
    const imsPeriodValue = formatNumber(mm, 2) + formatNumber(yyyy, 4);
    const imsMonthLabel = getMonthName(mm) + ' ' + yyyy;

    const p = { value: imsPeriodValue, month: imsMonthLabel, isValid: true, filingStatus: 'AUTOGN', filingLabel: 'Available', _settled: false };
    prepopulatePeriodFromCache(p, cfg);
    session.periods.push(p);

    const actHtml = renderRowActionsHtml(p, cfg);
    const filClass = resolveFilingPillClass(p.filingLabel || 'Available');
    const portalStatusMsg = (p.currentMessage && p.currentMessage !== 'Available' && p.currentMessage !== '—')
      ? p.currentMessage
      : (p.genDate ? (p.genTime ? formatRelativeTime(`${p.genDate} ${p.genTime}`) : formatRelativeTime(p.genDate)) : '—');
    const portalStatusClass = (p.currentState === RETURN_STATES.AVAILABLE && p.genDate)
      ? 'rt-status-filed'
      : (p.currentState === RETURN_STATES.GENERATING ? 'rt-status-warn' : 'rt-status-loading');
    const rowHtml =
      `<tr id="row-${p.value}"><td class="rt-month">${escapeHtml(p.month)}</td><td class="rt-status rt-status-filing"><div id="filing-status-${p.value}" class="rt-status-pill ${filClass}">${escapeHtml(p.filingLabel || 'Available')}</div></td><td class="rt-status rt-status-ledger"><div id="json-status-${p.value}" class="rt-status-pill ${portalStatusClass}">${escapeHtml(portalStatusMsg)}</div></td><td class="rt-actions-cell">${actHtml}</td></tr>`;

    divStatus.innerHTML =
      `<table class="rt-table rt-table-standard"><thead><tr><th class="rt-col-month">Period</th><th class="rt-col-filing">Filing Status</th><th class="rt-col-ledger">Portal Status</th><th class="rt-col-actions">Actions</th></tr></thead><tbody>${rowHtml}</tbody></table>`;

    DOM_CACHE.clear();
    wireRowButtons(p, cfg, getActionsFor(cfg.key));
    updateRow(p, thisRenderId).catch(err => console.error('[ReturnPilot IMS updateRow Error]', err));
    return;
  }

  // Annual Returns: Single Row Table (e.g. GSTR-9, GSTR-9C)
  if (cfg.isAnnual) {
    const fyLabel = session.finYear || '2023-24';
    const p = { value: fyLabel, month: `FY ${fyLabel}` };
    const isCached = prepopulatePeriodFromCache(p, cfg);
    if (!isCached) {
      p.isValid = true;
      p.filingStatus = 'AUTOGN';
      p.filingLabel = 'Checking…';
      p._settled = false;
    }
    session.periods.push(p);

    const actHtml = renderRowActionsHtml(p, cfg);
    const filClass = resolveFilingPillClass(p.filingLabel);
    const rowHtml =
      `<tr id="row-${p.value}"><td class="rt-month">${escapeHtml(p.month)}</td><td class="rt-status rt-status-filing"><div id="filing-status-${p.value}" class="rt-status-pill ${filClass}">${escapeHtml(p.filingLabel)}</div></td><td class="rt-status rt-status-ledger"><div id="json-status-${p.value}" class="rt-status-pill rt-status-loading">—</div></td><td class="rt-actions-cell">${actHtml}</td></tr>`;

    divStatus.innerHTML =
      `<table class="rt-table rt-table-standard"><thead><tr><th class="rt-col-month">Financial Year</th><th class="rt-col-filing">Filing Status</th><th class="rt-col-ledger">Portal Status</th><th class="rt-col-actions">Actions</th></tr></thead><tbody>${rowHtml}</tbody></table>`;

    DOM_CACHE.clear();
    wireRowButtons(p, cfg, getActionsFor(cfg.key));
    updateRow(p, thisRenderId).catch(err => console.error('[ReturnPilot Annual updateRow Error]', err));
    return;
  }

  // Monthly / Quarterly returns (derived strictly from session.dropdown portal source of truth)
  let yearData = (typeof session !== 'undefined' && session.dropdown && session.finYear)
    ? (session.dropdown.Years || []).find(y => y.year === session.finYear)
    : null;

  if (!yearData && session.dropdown && Array.isArray(session.dropdown.Years) && session.dropdown.Years.length > 0) {
    yearData = session.dropdown.Years[0];
    session.finYear = yearData.year;
    const sFy = getElement('finYear');
    if (sFy) sFy.value = session.finYear;
  }

  const fyParts = (session.finYear || '2026-27').split('-');
  const startYr = parseInt(fyParts[0], 10) || 2026;
  const endYr = startYr + 1;

  let monthDefs = [];
  if (yearData && Array.isArray(yearData.months) && yearData.months.length > 0) {
    monthDefs = yearData.months.map(mItem => {
      const v = typeof mItem === 'string' ? mItem : (mItem.value || '');
      if (v && v.length === 6) {
        const m = parseInt(v.substring(0, 2), 10);
        const yr = parseInt(v.substring(2, 6), 10);
        return { m, yr };
      }
      const mName = typeof mItem === 'string' ? mItem : (mItem.month || '');
      const mNum = parseDropdownMonthNum(mName);
      const yr = (mNum >= 4) ? startYr : endYr;
      return { m: mNum, yr };
    }).filter(md => md.m >= 1 && md.m <= 12 && !isNaN(md.yr));
  } else if (session.dropdown && Array.isArray(session.dropdown.Years)) {
    // Dropdown is loaded and authoritative from portal, but this taxpayer has no return periods for this FY
    monthDefs = [];
  } else {
    // Dropdown still loading: render skeleton placeholder and await authoritative dropdown from updatePeriods
    renderSkeletonTable(divStatus, cfg);
    return;
  }

  for (const md of monthDefs) {
    const val = formatNumber(md.m, 2) + String(md.yr);
    const monthName = getMonthName(md.m) + ' ' + md.yr;
    const p = { value: val, month: monthName };
    const isPrePopulated = prepopulatePeriodFromCache(p, cfg);
    session.periods.push(p);

    const actHtml = renderRowActionsHtml(p, cfg);

    let filingPillHtml = '';
    let jsonPillHtml = '';
    let cbHtml = '';

    if (isPrePopulated && p.filingLabel && !p.filingLabel.startsWith('Checking')) {
      const filClass = resolveFilingPillClass(p.filingLabel);
      filingPillHtml = `<div id="filing-status-${p.value}" class="rt-status-pill ${filClass}">${escapeHtml(p.filingLabel)}</div>`;

      if (p.currentState === RETURN_STATES.AVAILABLE) {
        if (cfg.key === configR2X.key || cfg.key === 'G2X' || cfg.key === configR2XExcel.key) {
          const isAvail = (typeof p.gstr2xRecordCount === 'number' ? p.gstr2xRecordCount > 0 : p.currentMessage === 'Available');
          const pillText = isAvail ? 'Available' : 'Not Available';
          const pillClass = isAvail ? 'rt-status-filed' : 'rt-status-na';
          jsonPillHtml = `<div id="json-status-${p.value}" class="rt-status-pill ${pillClass}">${pillText}</div>`;
        } else if (p.genDate && p.genTime) {
          const genText = formatGenStatusText(p.genDate, p.genTime);
          const rel = formatRelativeTime(`${p.genDate} ${p.genTime}`);
          jsonPillHtml = `<div id="json-status-${p.value}" class="rt-status-pill rt-status-filed" title="Generated on ${escapeHtml(p.genDate)} ${escapeHtml(p.genTime)}${rel ? ' (' + escapeHtml(rel) + ')' : ''}">${escapeHtml(genText)}</div>`;
        } else if (p.genDate) {
          const genText = formatGenStatusText(p.genDate, '');
          const rel = formatRelativeTime(p.genDate);
          jsonPillHtml = `<div id="json-status-${p.value}" class="rt-status-pill rt-status-filed" title="Generated on ${escapeHtml(p.genDate)}${rel ? ' (' + escapeHtml(rel) + ')' : ''}">${escapeHtml(genText)}</div>`;
        } else if (cfg.key === configR3B.key || cfg.key === configR1A.key) {
          jsonPillHtml = `<div id="json-status-${p.value}" class="rt-status-pill rt-status-filed">${escapeHtml(p.currentMessage || 'Available')}</div>`;
        } else if (cfg.key === configR2A.key || cfg.key === configR2AExcel.key) {
          jsonPillHtml = `<div id="json-status-${p.value}" class="rt-status-pill rt-status-loading">Checking…</div>`;
        } else {
          jsonPillHtml = `<div id="json-status-${p.value}" class="rt-status-pill rt-status-filed">Generated</div>`;
        }
      } else if (p.currentState === RETURN_STATES.NOT_GENERATED) {
        jsonPillHtml = `<div id="json-status-${p.value}" class="rt-status-pill rt-status-warn" title="File not yet generated on GST Portal. Click Generate to create it.">Not Generated</div>`;
      } else if (p.currentState === RETURN_STATES.GENERATING) {
        jsonPillHtml = `<div id="json-status-${p.value}" class="rt-status-pill rt-status-warn" title="GST portal is generating this file.">Generating…</div>`;
      } else if (p.currentState === RETURN_STATES.CHECKING) {
        jsonPillHtml = `<div id="json-status-${p.value}" class="rt-status-pill rt-status-loading">Checking…</div>`;
      } else {
        jsonPillHtml = `<div id="json-status-${p.value}" class="rt-status-pill rt-status-na">—</div>`;
      }

      if (p.isValid) {
        const isChecked = isPreselectedReturn(cfg.key);
        cbHtml = `<input type="checkbox" class="period-cb" data-period="${p.value}" style="cursor:pointer;"${isChecked ? ' checked' : ''}>`;
      } else {
        cbHtml = `<input type="checkbox" class="period-cb" data-period="${p.value}" disabled style="cursor:not-allowed;" title="Return not filed yet">`;
      }
    } else {
      filingPillHtml = `<div id="filing-status-${p.value}" class="rt-status-pill rt-status-loading">Checking…</div>`;
      jsonPillHtml = `<div id="json-status-${p.value}" class="rt-status-pill rt-status-loading">—</div>`;
      cbHtml = `<input type="checkbox" class="period-cb" data-period="${p.value}" disabled>`;
    }

    rows.push(
      `<tr id="row-${p.value}">` +
      `<td class="rt-month"><label class="rt-cb-wrap">${cbHtml}<span class="rt-month-name">${escapeHtml(p.month)}</span></label></td>` +
      `<td class="rt-status rt-status-filing">${filingPillHtml}</td>` +
      `<td class="rt-status rt-status-ledger">${jsonPillHtml}</td>` +
      `<td class="rt-actions-cell">${actHtml}</td>` +
      `</tr>`
    );
  }

  const tableRowsHtml = rows.length > 0
    ? rows.join('')
    : `<tr><td colspan="4" style="text-align:center;padding:28px 16px;color:#64748b;font-size:12px;">No return periods registered on the GST portal for Financial Year ${escapeHtml(session.finYear || '')}.</td></tr>`;

  divStatus.innerHTML =
    `<table class="rt-table rt-table-standard"><thead><tr>` +
    `<th class="rt-col-month"><label class="rt-cb-wrap"><input type="checkbox" id="master-period-cb" title="Select / Deselect all periods"${rows.length === 0 ? ' disabled' : ''}> Period</label></th>` +
    `<th class="rt-col-filing">Filing Status</th><th class="rt-col-ledger">Portal Status</th><th class="rt-col-actions">Actions</th>` +
    `</tr></thead><tbody>${tableRowsHtml}</tbody></table>`;

  DOM_CACHE.clear();

  if (rows.length === 0) {
    return;
  }

  const masterCb = getElement('master-period-cb');
  if (masterCb) {
    masterCb.onchange = () => {
      const isChecked = masterCb.checked;
      document.querySelectorAll('.period-cb:not(:disabled)').forEach(cb => { cb.checked = isChecked; });
    };
    document.querySelectorAll('.period-cb').forEach(cb => {
      cb.onchange = () => syncMasterCheckbox();
    });
    syncMasterCheckbox();
  }

  session.periods.forEach(p => { 
    if (p._settled) {
      hydrateJsonStatus(p); 
      if (p.filingLabel && !p.filingLabel.startsWith('Checking')) { 
        const d = getElement(`filing-status-${p.value}`); 
        if (d) setStatusPill(d, p.filingLabel, resolveFilingPillClass(p.filingLabel)); 
      }
    }
    wireRowButtons(p, cfg, getActionsFor(cfg.key));
  });

  // ── PASS 3: Production Elastic Harvester with Speculative Hedge (v11.0) ──
  const tDispatchStart = performance.now();
  Engine.reset();
  isBatchSweepRunning = true;

  const immediatePeriods = [];
  const networkQueue = [];

  const is2B = (cfg.key === configR2B.key || cfg.key === configR2BExcel.key);
  const is2X = (cfg.key === configR2X.key || cfg.key === 'G2X' || cfg.key === configR2XExcel.key);
  for (const p of session.periods) {
    const hasCache = is2X
      ? (typeof StatusBroker !== 'undefined' && typeof StatusBroker.has2x === 'function' && StatusBroker.has2x(p))
      : (!is2B && StatusBroker.has(p, cfg.isAnnual));
    const isSettledCached = Boolean(p._settled || (p.filingLabel && p.filingLabel !== 'Checking…'));

    if (hasCache || isSettledCached) {
      immediatePeriods.push(p);
    } else {
      networkQueue.push(p);
    }
  }

  // 1. Instant Cache-Before-Queue Resolution (0ms)
  immediatePeriods.forEach(p => {
    updateRow(p, thisRenderId).finally(() => {
      p._settled = true;
      rerenderRowActions(p);
    });
  });

  // 2. Elastic Harvester Network Pipeline with Speculative Hedge
  let harvestPromise = Promise.resolve();

  if (networkQueue.length > 0) {
    const isG1 = (cfg.key === 'G1' || cfg.key === 'G1EXL');
    const isG3b = (cfg.key === 'G3B');

    if (isG1) {
      // 🏛️ Dual Coordinator: rolestatus (Fast Pool) + formdetails (Heavy Pool)
      const roleResults = new Array(networkQueue.length);
      const formResults = new Array(networkQueue.length);

      const roleQueue = networkQueue.map((p, idx) => ({ ...p, period: p, idx, hedges: 0, accumulatedMs: 0 }));
      const formQueue = networkQueue.map((p, idx) => ({ ...p, period: p, idx, hedges: 0, accumulatedMs: 0 }));

      function applyG1Settlement(p, rRes, fRes) {
        if (thisRenderId !== currentWorkspaceRenderId || renderSignal.aborted) return;
        const dFil = getElement(`filing-status-${p.value}`);
        const dJs  = getElement(`json-status-${p.value}`);
        const cb   = document.querySelector(`.period-cb[data-period="${p.value}"]`);

        if (fRes) {
          if (fRes.isFiled) {
            p.isValid = true;
            p.currentState = RETURN_STATES.AVAILABLE;
            p.arn = fRes.arn !== '—' ? fRes.arn : (p.arn || '');
            p.fil_dt = fRes.filDt !== '—' ? fRes.filDt : (p.fil_dt || '');

            if (fRes.isNil) {
              p.isNil = true;
              p.filingStatus = 'NIL_FILED';
              p.filingLabel = 'Nil Filed';
              p.currentMessage = '—';
              if (dFil) {
                setStatusPill(dFil, 'Nil Filed', 'rt-status-filed');
                dFil.title = `ARN: ${p.arn || 'N/A'}\nFiling Date: ${p.fil_dt || 'N/A'}`;
              }
              if (dJs) {
                setStatusPill(dJs, '—', 'rt-status-na');
                dJs.title = p.arn ? `Nil Return Filed (ARN: ${p.arn}) — No transaction files` : 'Nil Return Filed';
              }
            } else {
              p.isNil = false;
              p.filingStatus = 'FIL';
              p.filingLabel = 'Filed';
              if (dFil) {
                setStatusPill(dFil, 'Filed', 'rt-status-filed');
                dFil.title = `ARN: ${p.arn || 'N/A'}\nFiling Date: ${p.fil_dt || 'N/A'}`;
              }

              const g1Key = periodCacheKey(session.return?.key, session.finYear, p.value);
              const triggeredAt = getSavedGenerationTimestamp(g1Key);
              const isActivelyGenerating = triggeredAt && (Date.now() - triggeredAt < GEN_TTL);

              if (isActivelyGenerating) {
                showGeneratingBanner();
                p.currentState = RETURN_STATES.GENERATING;
                p.currentMessage = 'Generating…';
                if (dJs) setStatusPill(dJs, 'Generating…', 'rt-status-warn');
                startFileGenBackgroundPoller(p, session.return);
              } else if (p.genDate || periodStateCache[g1Key]?.genDate) {
                const pDate = p.genDate || periodStateCache[g1Key].genDate;
                const pTime = p.genTime || periodStateCache[g1Key]?.genTime || '';
                p.genDate = pDate;
                p.genTime = pTime;
                p.currentState = RETURN_STATES.AVAILABLE;
                p.currentMessage = (pDate && pTime) ? formatRelativeTime(`${pDate} ${pTime}`) : formatRelativeTime(pDate);
                if (dJs) showGenTime(dJs, pDate, pTime);
              } else {
                p.currentState = RETURN_STATES.CHECKING;
                p.currentMessage = 'Checking…';
                if (dJs) setStatusPill(dJs, 'Checking…', 'rt-status-loading');
              }

              // Proactive background JSON status/timestamp validation via /offline/download/generate?flag=0
              processAsync({ request: 'get', url: gstn.generateFile(session.return, p, false) })
                .then(pRes => {
                  if (!pRes || !pRes.status) return;
                  try {
                    const pData = JSON.parse(pRes.response);
                    const pUrls = (pData && pData.data && Array.isArray(pData.data.url)) ? pData.data.url : (pData && pData.data && pData.data.url ? [pData.data.url] : []);
                    const pMsg = (pData?.data?.msg || '').toLowerCase();
                    const isDownloadMsg = pMsg.includes('you have downloaded') || pMsg.includes('click on the link');

                    if (pData?.data?.status === 0 && (pUrls.length || isDownloadMsg || pData?.data?.date || pData?.data?.gendt || pData?.data?.gen_dt)) {
                      const pDate = pData.data.date || pData.data.gendt || pData.data.gen_dt || '';
                      const pTime = pData.data.time || '';
                      p.genDate = pDate;
                      p.genTime = pTime;
                      p.currentState = RETURN_STATES.AVAILABLE;
                      p.currentMessage = (pDate && pTime) ? formatRelativeTime(`${pDate} ${pTime}`) : (pDate ? formatRelativeTime(pDate) : 'Available');
                      stopFileGenBackgroundPoller(p);
                      clearGenerationTimestamp(g1Key);
                      if (!periodStateCache[g1Key]) periodStateCache[g1Key] = {};
                      periodStateCache[g1Key].genDate = pDate;
                      periodStateCache[g1Key].genTime = pTime;
                      periodStateCache[g1Key].currentState = RETURN_STATES.AVAILABLE;
                      periodStateCache[g1Key].currentMessage = p.currentMessage;
                      saveStableState(p);
                      const curDjs = getElement(`json-status-${p.value}`);
                      if (curDjs) {
                        if (pDate) showGenTime(curDjs, pDate, pTime);
                        else setStatusPill(curDjs, 'Available', 'rt-status-filed');
                      }
                      rerenderRowActions(p);
                      hydrateJsonStatus(p);
                      updateBulkPdfButtonState();
                      updateBulkGenerateButtonState();
                      const hasOtherGen = session.periods && session.periods.some(per => per.currentState === RETURN_STATES.GENERATING);
                      if (!hasOtherGen) {
                        const banner = getElement('banner-generating');
                        if (banner) banner.hidden = true;
                      }
                    } else if (pData?.data?.status === 1 || (pData?.error?.errorCode && pData?.error?.errorCode.startsWith('RTN_24')) || pMsg.includes('in progress') || pMsg.includes('generating')) {
                      p.currentState = RETURN_STATES.GENERATING;
                      p.currentMessage = 'Generating…';
                      showGeneratingBanner();
                      const curDjs = getElement(`json-status-${p.value}`);
                      if (curDjs) setStatusPill(curDjs, 'Generating…', 'rt-status-warn');
                      startFileGenBackgroundPoller(p, session.return);
                      rerenderRowActions(p);
                      hydrateJsonStatus(p);
                      updateBulkPdfButtonState();
                      updateBulkGenerateButtonState();
                    } else {
                      // File is NOT generated on GST Portal
                      p.currentState = RETURN_STATES.NOT_GENERATED;
                      p.currentMessage = 'Not Generated';
                      p.genDate = null;
                      p.genTime = null;
                      stopFileGenBackgroundPoller(p);
                      clearGenerationTimestamp(g1Key);
                      if (!periodStateCache[g1Key]) periodStateCache[g1Key] = {};
                      periodStateCache[g1Key].genDate = null;
                      periodStateCache[g1Key].genTime = null;
                      periodStateCache[g1Key].currentState = RETURN_STATES.NOT_GENERATED;
                      periodStateCache[g1Key].currentMessage = 'Not Generated';
                      saveStableState(p);
                      const curDjs = getElement(`json-status-${p.value}`);
                      if (curDjs) {
                        setStatusPill(curDjs, 'Not Generated', 'rt-status-warn');
                        curDjs.title = 'File not yet generated on GST Portal. Click Generate to create it.';
                      }
                      rerenderRowActions(p);
                      hydrateJsonStatus(p);
                      updateBulkPdfButtonState();
                      updateBulkGenerateButtonState();
                      const hasOtherGen = session.periods && session.periods.some(per => per.currentState === RETURN_STATES.GENERATING);
                      if (!hasOtherGen) {
                        const banner = getElement('banner-generating');
                        if (banner) banner.hidden = true;
                      }
                    }
                  } catch (_) {}
                })
                .catch(() => {
                  if (p.currentState === RETURN_STATES.CHECKING) {
                    p.currentState = RETURN_STATES.AVAILABLE;
                    p.currentMessage = 'Available';
                    const curDjs = getElement(`json-status-${p.value}`);
                    if (curDjs) setStatusPill(curDjs, 'Available', 'rt-status-filed');
                  }
                });
            }

            if (cb) {
              cb.checked = isPreselectedReturn(session.return?.key);
              cb.disabled = false;
              cb.removeAttribute('title');
              cb.style.cursor = 'pointer';
            }
            syncMasterCheckbox();
            saveStableState(p);
            rerenderRowActions(p);
            updateBulkPdfButtonState();
            updateBulkGenerateButtonState();
            return;
          }
        }

        if (rRes) {
          const fStatus = (rRes.g1 || '').toUpperCase();
          if (fStatus && fStatus !== 'FIL' && fStatus !== 'FILED' && (!fRes || !fRes.isFiled)) {
            let l = displayFilingStatus(fStatus);
            const mNum = parseInt(p.value.substring(0, 2), 10);
            const isM1orM2 = (mNum % 3 !== 0);
            const isQuarterlyUser = (session.filingFrequency === 'Quarterly');
            if (isQuarterlyUser && isM1orM2) {
              l = 'Optional (IFF)';
            }
            const isNA = (l === 'Optional (IFF)' || l === 'Quarterly' || l === 'Not Applicable' || l === 'Not available' || fStatus === 'NOT_APPLICABLE' || fStatus === 'NOT_AVAIL');
            const pillClass = isNA ? 'rt-status-na' : 'rt-status-notfiled';

            if (dFil) setStatusPill(dFil, l, pillClass);
            if (dJs) setStatusPill(dJs, '—', 'rt-status-na');
            p.filingLabel = l;
            p.filingStatus = fStatus;
            p.currentState = isNA ? RETURN_STATES.NO_DATA : RETURN_STATES.NOT_GENERATED;
            p.currentMessage = '—';
            p.isValid = false;

            if (cb) { cb.checked = false; cb.disabled = true; cb.style.cursor = 'not-allowed'; }
            syncMasterCheckbox();
            saveStableState(p);
            rerenderRowActions(p);
          } else if (fStatus === 'FIL' && !fRes) {
            if (dFil) setStatusPill(dFil, 'Filed', 'rt-status-filed');
            p.filingStatus = 'FIL';
            p.filingLabel = 'Filed';
          }
        }
      }

      async function runRoleCoordinator() {
        const activePromises = [];
        while (roleQueue.length > 0 || activePromises.length > 0) {
          if (renderSignal.aborted || thisRenderId !== currentWorkspaceRenderId) break;
          while (roleQueue.length > 0 && Engine.canDispatch('role')) {
            const task = roleQueue.shift();
            const pUrl = gstn.rolestatus(task.period);
            const useHedge = task.hedges < HARVEST_CONFIG.MAX_HEDGES;
            const currentTimeout = useHedge ? HARVEST_CONFIG.HEDGE_TIMEOUT_MS : HARVEST_CONFIG.HARD_TIMEOUT_MS;

            const promise = timedFetch(pUrl, 'role', `R_${task.idx}`, currentTimeout).then(res => {
              if (res.timedOut && useHedge) {
                Engine.hedgeEvents++;
                task.hedges++;
                task.accumulatedMs += res.ms;
                roleQueue.push(task); // Re-queue deadlocked socket to tail
              } else {
                const u = res.data?.data?.user || res.data?.user || [];
                const allReturns = u.flatMap(x => x?.returns || []);
                const g1Status = allReturns.find(r => r?.return_ty === 'GSTR1')?.status || (res.ok ? 'NF' : '—');
                const g3bStatus = allReturns.find(r => r?.return_ty === 'GSTR3B')?.status || '—';

                if (res.data && res.ok) {
                  StatusBroker.cache.set(StatusBroker.getKey(task.period, false), {
                    role: { status: true, response: JSON.stringify(res.data) },
                    info: res.data,
                    timestamp: Date.now()
                  });
                }

                roleResults[task.idx] = {
                  period: task.period.value,
                  label: task.period.month,
                  g1: g1Status,
                  g3b: g3bStatus,
                  ms: res.ms + task.accumulatedMs,
                  rawRtt: res.ms,
                  hedged: task.hedges > 0,
                  ok: res.ok
                };

                applyG1Settlement(task.period, roleResults[task.idx], formResults[task.idx]);
              }
              activePromises.splice(activePromises.indexOf(promise), 1);
            });
            activePromises.push(promise);
          }
          if (activePromises.length > 0) await Promise.race(activePromises);
        }
      }

      async function runFormCoordinator() {
        const activePromises = [];
        while (formQueue.length > 0 || activePromises.length > 0) {
          if (renderSignal.aborted || thisRenderId !== currentWorkspaceRenderId) break;
          while (formQueue.length > 0 && Engine.canDispatch('form')) {
            const task = formQueue.shift();
            const pUrl = gstn.gstr1FormDetails(task.period);
            const useHedge = task.hedges < HARVEST_CONFIG.MAX_HEDGES;
            const currentTimeout = useHedge ? HARVEST_CONFIG.HEDGE_TIMEOUT_MS : HARVEST_CONFIG.HARD_TIMEOUT_MS;

            const promise = timedFetch(pUrl, 'form', `F_${task.idx}`, currentTimeout).then(res => {
              if (res.timedOut && useHedge) {
                Engine.hedgeEvents++;
                task.hedges++;
                task.accumulatedMs += res.ms;
                formQueue.push(task); // Re-queue deadlocked socket to tail
              } else {
                const d = res.data?.data || res.data || {};
                const isFiled = d.status === 'FIL' || d.isSubmitted === 'Y';
                const isNil = isFiled && (d.isnil === 'Y' || String(d.isnil).toUpperCase() === 'Y');

                formResults[task.idx] = {
                  period: task.period.value,
                  label: task.period.month,
                  isFiled,
                  filingType: !isFiled ? 'NOT FILED' : (isNil ? 'NIL' : 'NORMAL'),
                  arn: d.arn || '—',
                  filDt: d.fil_dt || '—',
                  isNil,
                  ms: res.ms + task.accumulatedMs,
                  rawRtt: res.ms,
                  hedged: task.hedges > 0,
                  ok: res.ok
                };

                if (d.arn) task.period.arn = d.arn;
                if (d.fil_dt) task.period.fil_dt = d.fil_dt;
                task.period.isNil = isNil;

                applyG1Settlement(task.period, roleResults[task.idx], formResults[task.idx]);
              }
              activePromises.splice(activePromises.indexOf(promise), 1);
            });
            activePromises.push(promise);
          }
          if (activePromises.length > 0) await Promise.race(activePromises);
        }
      }

      harvestPromise = Promise.all([runRoleCoordinator(), runFormCoordinator()]).then(() => {
        const totalWallMs = performance.now() - tDispatchStart;
        const auditLedger = networkQueue.map((p, i) => ({
          Period         : p.month || p.value,
          'GSTR-1 Role'  : roleResults[i]?.g1 || '—',
          'GSTR-3B Role' : roleResults[i]?.g3b || '—',
          'Form Status'  : formResults[i]?.isFiled ? '✅ FILED' : '❌ PENDING',
          'Filing Type'  : formResults[i]?.filingType || '—',
          ARN            : formResults[i]?.arn || '—',
          'Filed Date'   : formResults[i]?.filDt || '—',
          'Role RTT'     : `${Math.round(roleResults[i]?.ms || 0)} ms${roleResults[i]?.hedged ? ' ⚡[Hedged]' : ''}`,
          'Form RTT'     : `${Math.round(formResults[i]?.ms || 0)} ms${formResults[i]?.hedged ? ' ⚡[Hedged]' : ''}`
        }));

        console.log(`%c⚡ GST HARVESTER v11 (ELASTIC + 5s SPECULATIVE HEDGE)`, 'background:linear-gradient(90deg,#059669,#2563eb);color:#fff;font-size:13px;font-weight:800;padding:6px 14px;border-radius:4px;');
        console.log(`%c🏁 TOTAL WALL TIME: ${(totalWallMs / 1000).toFixed(2)}s (${Math.round(totalWallMs)} ms)`, 'color:#22c55e;font-size:14px;font-weight:bold;');
        console.log(`%c⚡ EFFECTIVE SPEED : ${((networkQueue.length * 2) / (totalWallMs / 1000)).toFixed(2)} req/sec`, 'color:#38bdf8;font-weight:bold;');
        console.log(`  • Opportunistic Bursts Fired : ${Engine.burstEvents}`);
        console.log(`  • Congestion Brakes Applied  : ${Engine.brakeEvents}`);
        console.log(`  • Speculative Hedges (5s)    : ${Engine.hedgeEvents}`);
        console.table(auditLedger);

        window.__GST_HARVEST_DATA__ = {
          gstin: session.gstin,
          legalName: session.businessName,
          harvestedAt: new Date().toISOString(),
          wallMs: Math.round(totalWallMs),
          records: auditLedger
        };
      });
    } else if (isG3b) {
      // 🏛️ Coordinator for GSTR-3B via Elastic rolestatus
      const roleQueue = networkQueue.map((p, idx) => ({ ...p, period: p, idx, hedges: 0, accumulatedMs: 0 }));

      async function runRoleOnlyCoordinator() {
        const activePromises = [];
        while (roleQueue.length > 0 || activePromises.length > 0) {
          if (renderSignal.aborted || thisRenderId !== currentWorkspaceRenderId) break;
          while (roleQueue.length > 0 && Engine.canDispatch('role')) {
            const task = roleQueue.shift();
            const pUrl = gstn.rolestatus(task.period);
            const useHedge = task.hedges < HARVEST_CONFIG.MAX_HEDGES;
            const currentTimeout = useHedge ? HARVEST_CONFIG.HEDGE_TIMEOUT_MS : HARVEST_CONFIG.HARD_TIMEOUT_MS;

            const promise = timedFetch(pUrl, 'role', `R3B_${task.idx}`, currentTimeout).then(async res => {
              if (res.timedOut && useHedge) {
                Engine.hedgeEvents++;
                task.hedges++;
                task.accumulatedMs += res.ms;
                roleQueue.push(task); // Re-queue deadlocked task to tail
              } else {
                if (res.data && res.ok) {
                  try {
                    const brokerKey = StatusBroker.getKey(task.period, cfg.isAnnual);
                    StatusBroker.cache.set(brokerKey, {
                      role: { status: true, response: JSON.stringify(res.data) },
                      info: res.data,
                      timestamp: Date.now()
                    });
                  } catch (_) {}
                }
                await updateRow(task.period, thisRenderId);
                task.period._settled = true;
                rerenderRowActions(task.period);
              }
              activePromises.splice(activePromises.indexOf(promise), 1);
            });
            activePromises.push(promise);
          }
          if (activePromises.length > 0) await Promise.race(activePromises);
        }
      }

      harvestPromise = runRoleOnlyCoordinator().then(() => {
        const totalWallMs = performance.now() - tDispatchStart;
        console.log(`%c⚡ GSTR-3B HARVEST SETTLED: ${(totalWallMs / 1000).toFixed(2)}s | Hedges: ${Engine.hedgeEvents}`, 'color:#22c55e;font-weight:bold;');
      });
    } else {
      // 🏛️ Generic Elastic coordinator with 5s hedge abort for all other returns
      const genQueue = networkQueue.map((p, idx) => ({ ...p, period: p, idx, hedges: 0, accumulatedMs: 0 }));

      async function runGenericElasticCoordinator() {
        const activePromises = [];
        while (genQueue.length > 0 || activePromises.length > 0) {
          if (renderSignal.aborted || thisRenderId !== currentWorkspaceRenderId) break;
          while (genQueue.length > 0 && Engine.canDispatch('role')) {
            const task = genQueue.shift();
            const useHedge = task.hedges < HARVEST_CONFIG.MAX_HEDGES;
            const currentTimeout = useHedge ? HARVEST_CONFIG.HEDGE_TIMEOUT_MS : HARVEST_CONFIG.HARD_TIMEOUT_MS;

            const start = performance.now();
            Engine.inFlightRole++;
            Engine.activeRequests.set(`G_${task.idx}`, start);

            let isTimedOut = false;
            const timer = setTimeout(() => { isTimedOut = true; }, currentTimeout);

            const promise = updateRow(task.period, thisRenderId)
              .catch(err => console.warn(`[ReturnPilot] Row error ${task.period.month}:`, err))
              .finally(() => {
                clearTimeout(timer);
                const ms = Math.round(performance.now() - start);
                Engine.lastRoleRtt = ms;
                Engine.activeRequests.delete(`G_${task.idx}`);
                Engine.inFlightRole--;

                if (isTimedOut && useHedge) {
                  Engine.hedgeEvents++;
                  task.hedges++;
                  task.accumulatedMs += ms;
                  genQueue.push(task); // Re-queue deadlocked task to tail
                } else {
                  task.period._settled = true;
                  rerenderRowActions(task.period);
                }
                activePromises.splice(activePromises.indexOf(promise), 1);
              });
            activePromises.push(promise);
          }
          if (activePromises.length > 0) await Promise.race(activePromises);
        }
      }

      harvestPromise = runGenericElasticCoordinator();
    }
  }

  return harvestPromise.finally(async () => {
    isBatchSweepRunning = false;
    if (thisRenderId !== currentWorkspaceRenderId || renderSignal.aborted) return;
    applyNotApplicableLogic();
    updateBulkPdfButtonState(); 
    updateBulkGenerateButtonState();
    const tEnd = performance.now();
    const tElapsed = Math.round(tEnd - tDispatchStart);
    console.log(`%c✨ Table settled cleanly in ${tElapsed}ms`, 'color:#38bdf8;font-weight:bold;');
  });
}

window.runGstHarvest = async function() {
  console.log(`%c⚡ Executing Production Elastic Harvester (v11.0)...`, 'color:#38bdf8;font-weight:bold;');
  return updateWorkspaceInnerData();
};

function wireRowButtons(p, cfg, actions) {
  const bSum = getElement("btn-pdf-summary-" + p.value), bDet = getElement("btn-pdf-detail-" + p.value), bJs = getElement("btn-download-" + p.value), bEx = getElement("btn-excel-" + p.value), bGen = getElement("btn-gen-" + p.value);
  const b8a = getElement("btn-8a-" + p.value), bG1 = getElement("btn-g1-pdf-" + p.value), bG3b = getElement("btn-g3b-pdf-" + p.value);
  
  if (b8a) b8a.onclick = (event) => {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    return runRowAction(p, "8a-excel", async () => {
      await download9Table8aExcel(p);
    }, RETURN_STATES.DOWNLOADING, "Downloading…");
  };

  if (bG1) bG1.onclick = (event) => {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    return runRowAction(p, "g1-summary-pdf", async () => {
      await download9Gstr1SummaryPdf(p);
    }, RETURN_STATES.DOWNLOADING, "Building…");
  };

  if (bG3b) bG3b.onclick = (event) => {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    return runRowAction(p, "g3b-summary-pdf", async () => {
      await download9Gstr3bSummaryPdf(p);
    }, RETURN_STATES.DOWNLOADING, "Building…");
  };

  if (bSum) bSum.onclick = (event) => {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    return runRowAction(p, "summary-pdf", async () => {
      if (cfg.key === configR3B.key) {
        await download3BPdf(p);
      } else if (cfg.key === configR1.key) {
        await download1PdfViaAngular(p);
      } else if (cfg.key === configR1A.key) {
        await download1aPdfViaAngular(p, 'STANDALONE');
      } else if (cfg.key === configR2B.key) {
        await download2bPdf(p);
      } else if (cfg.key === configR9.key) {
        await download9Pdf(p);
      } else if (cfg.key === configR9C.key) {
        await download9cPdf(p);
      }
    }, RETURN_STATES.DOWNLOADING, "Building…");
  };

  if (bDet && cfg && (cfg.key === configR1A.key || cfg.key === configR2B.key)) bDet.onclick = (event) => {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    return runRowAction(p, "detail-pdf", async () => {
      if (cfg.key === configR1A.key) {
        await download1aPdfViaAngular(p, 'CONSOLIDATED');
      } else {
        await download2bDetailedPdf(p);
      }
    }, RETURN_STATES.DOWNLOADING, "Building…");
  };
  
  if (bJs)  bJs.onclick  = () => runRowAction(p, "json", () => {
    if (cfg.workflowType === WORKFLOW_TYPES.IMS_PORTAL) return downloadImsJson(p);
    if (cfg.key === configR1A.key) return download1aJson(p);
    if (cfg.key === configR2X.key) return download2xJson(p);
    return cfg.key === configR3B.key ? download3bJson(p) : (cfg.key === configR2B.key ? download2bJson(p) : download(p));
  }, RETURN_STATES.DOWNLOADING, (cfg.workflowType === WORKFLOW_TYPES.IMS_PORTAL || cfg.key === configR2B.key || cfg.key === configR2X.key) ? "Downloading…" : "Requesting…");
  
  if (bEx)  bEx.onclick  = () => runRowAction(p, "excel", async () => {
    if (cfg.workflowType === WORKFLOW_TYPES.IMS_PORTAL) {
      await downloadImsExcel(p);
      return;
    }
    if (cfg.key === configR1.key) {
      await download1ImsExcel(p);
      return;
    } else if (cfg.key === configR1A.key) {
      await download1aExcel(p);
      return;
    } else if (cfg.key === configR2B.key) { 
      session.pendingFileName = makeZipFileName(configR2BExcel.fileNameCode, session.gstin, p.value, configR2BExcel.fileTypeCode) + ".xlsx"; 
      try { await download2bExcel(p); } finally { session.pendingFileName = null; } 
    } else if (cfg.key === configR2X.key) {
      await download2xExcel(p);
      return;
    } else if (cfg.key === configR3B.key) {
      await download3bExcel(p);
      return;
    } else { 
      let c = cfg.key === configR9.key ? configR9Excel : (cfg.key === configR9C.key ? configR9CExcel : (cfg.key === configR2A.key ? configR2AExcel : configR2BExcel)); 
      await downloadStandardExcel(p, c); 
    }
  }, RETURN_STATES.DOWNLOADING, "Building…");
  
  if (bGen) bGen.onclick = () => cfg.workflowType === WORKFLOW_TYPES.IMS_PORTAL ? generateIms(p) : generate(p);
}

// -- IMS Download & Auto-Polling Workflow ------------------------------------
let _imsPollTimer = null;
let _imsPollCount = 0;

function stopImsBackgroundPoller() {
  if (_imsPollTimer) {
    clearInterval(_imsPollTimer);
    _imsPollTimer = null;
    _imsPollCount = 0;
  }
}

function startImsBackgroundPoller(period) {
  stopImsBackgroundPoller();
  _imsPollCount = 0;

  // Poll gently every 20 seconds, max 3 times (1 minute total), to prevent network spam
  _imsPollTimer = setInterval(async () => {
    _imsPollCount++;
    if (!session.return || session.return.workflowType !== WORKFLOW_TYPES.IMS_PORTAL || period.currentState !== RETURN_STATES.GENERATING || _imsPollCount > 3) {
      stopImsBackgroundPoller();
      if (_imsPollCount > 3) {
        const imsKey = periodCacheKey(session.return?.key || 'IMS', session.finYear, period.value);
        clearGenerationTimestamp(imsKey);
        const banner = getElement('banner-generating');
        if (banner) banner.hidden = true;
      }
      return;
    }
    try {
      const m = await processAsync({ request: 'get', url: gstn.imsGenerateJson(false), bypassCache: true });
      if (!m || !m.status) return;

      let resp = null;
      try { resp = JSON.parse(m.response); } catch (_) {}
      const dataStatus = (resp && resp.data && typeof resp.data.status !== 'undefined') ? Number(resp.data.status) : -1;
      const urls = (resp && resp.data && Array.isArray(resp.data.url)) ? resp.data.url : (resp && resp.data && resp.data.url ? [resp.data.url] : []);
      
      const imsKey = periodCacheKey(session.return.key, session.finYear, period.value);
      const triggeredAt = getSavedGenerationTimestamp(imsKey);

      if (dataStatus === 0 && urls.length && urls[0]) {
        const fileDateStr = resp?.data?.date || resp?.data?.gendt || resp?.data?.gen_dt || '';
        const fileTimeStr = resp?.data?.time || '';
        const fileTimeStampStr = resp?.data?.timeStamp || '';
        const fileTs = parseGstnDateTime(fileDateStr, fileTimeStr, fileTimeStampStr);
        const pMsg = (resp?.data?.msg || '').toLowerCase();

        const isDownloadLinkMsg = pMsg.includes('you have downloaded') || pMsg.includes('click on the link');
        const isClockSkewOrRecent = !triggeredAt || !fileTs || (fileTs >= triggeredAt - (5 * 60 * 1000));
        const hasSettledWithoutNewJob = (_imsPollCount >= 3);

        if (!isDownloadLinkMsg && !isClockSkewOrRecent && !hasSettledWithoutNewJob && (Date.now() - triggeredAt < GEN_TTL)) {
          return;
        }

        // New generation is ready!
        stopImsBackgroundPoller();
        if (triggeredAt) clearGenerationTimestamp(imsKey);

        period.genDate = fileDateStr;
        period.genTime = fileTimeStr;
        period.currentState = RETURN_STATES.AVAILABLE;
        period.currentMessage = (period.genDate && period.genTime)
          ? formatRelativeTime(`${period.genDate} ${period.genTime}`)
          : (period.genDate ? formatRelativeTime(period.genDate) : 'Available');
        period.isValid = true;
        period.filingStatus = 'AUTOGN';
        period.filingLabel = 'Available';
        period.hasJson = true;
        period.hasExcel = true;
        period.excelGenerating = false;
        period.jsonGenerating = false;

        const banner = getElement('banner-generating');
        if (banner) banner.hidden = true;

        saveStableState(period);
        rerenderRowActions(period);
        syncRowActions(period);
        hydrateJsonStatus(period);
        addCopilotLog(`IMS [${period.value}]: Generation complete! File is ready for download.`, 'success');
      }
    } catch (_) {}
  }, 20000);
}

// -- Standard Return (GSTR-1, GSTR-2A, etc.) Offline File Auto-Polling Workflow --
const _genPollers = new Map();

function stopFileGenBackgroundPoller(period) {
  if (!period || !period.value) return;
  const timer = _genPollers.get(period.value);
  if (timer) {
    clearInterval(timer);
    _genPollers.delete(period.value);
  }
}

function stopAllFileGenBackgroundPollers() {
  for (const timer of _genPollers.values()) {
    clearInterval(timer);
  }
  _genPollers.clear();
}

function startFileGenBackgroundPoller(period, cfg) {
  if (!period || !period.value || !cfg) return;
  stopFileGenBackgroundPoller(period);

  let pollCount = 0;
  const periodVal = period.value;
  const targetKey = cfg.key;
  const is2A = (targetKey === configR2A.key || targetKey === configR2AExcel.key);

  const timer = setInterval(async () => {
    pollCount++;
    const isTargetTab = session.return && (
      session.return.key === targetKey ||
      (is2A && (session.return.key === configR2A.key || session.return.key === configR2AExcel.key))
    );
    if (!isTargetTab || period.currentState !== RETURN_STATES.GENERATING || pollCount > 16) {
      stopFileGenBackgroundPoller(period);
      if (pollCount > 16) {
        const key = periodCacheKey(targetKey, session.finYear, periodVal);
        clearGenerationTimestamp(key);
        if (is2A) {
          clearGenerationTimestamp(periodCacheKey(configR2AExcel.key, session.finYear, periodVal));
        }
        const hasOtherGen = session.periods && session.periods.some(p => p.currentState === RETURN_STATES.GENERATING && p.value !== periodVal);
        if (!hasOtherGen) {
          const banner = getElement('banner-generating');
          if (banner) banner.hidden = true;
        }
      }
      return;
    }
    try {
      if (is2A) {
        const [mJ, mEx] = await Promise.allSettled([
          processAsync({ request: 'get', url: gstn.generateFile(configR2A, period, false), bypassCache: true }),
          processAsync({ request: 'get', url: gstn.generateFile(configR2AExcel, period, false), bypassCache: true })
        ]);
        const jSt = inspectOfflineFileGenResponse(mJ.status === 'fulfilled' ? mJ.value : null);
        const exSt = inspectOfflineFileGenResponse(mEx.status === 'fulfilled' ? mEx.value : null);

        const isStillGenerating = (jSt.state === 'GENERATING' || exSt.state === 'GENERATING');
        if (jSt.state === 'AVAILABLE' || exSt.state === 'AVAILABLE') {
          const jKey = periodCacheKey(configR2A.key, session.finYear, periodVal);
          const exKey = periodCacheKey(configR2AExcel.key, session.finYear, periodVal);
          if (jSt.state === 'AVAILABLE') {
            clearGenerationTimestamp(jKey);
            if (!periodStateCache[jKey]) periodStateCache[jKey] = {};
            periodStateCache[jKey].genDate = jSt.date || '';
            periodStateCache[jKey].genTime = jSt.time || '';
            periodStateCache[jKey].currentState = RETURN_STATES.AVAILABLE;
          }
          if (exSt.state === 'AVAILABLE') {
            clearGenerationTimestamp(exKey);
            if (!periodStateCache[exKey]) periodStateCache[exKey] = {};
            periodStateCache[exKey].genDate = exSt.date || '';
            periodStateCache[exKey].genTime = exSt.time || '';
            periodStateCache[exKey].currentState = RETURN_STATES.AVAILABLE;
          }

          if (!isStillGenerating) {
            stopFileGenBackgroundPoller(period);
            const fDate = jSt.date || exSt.date || '';
            const fTime = jSt.time || exSt.time || '';
            period.genDate = fDate;
            period.genTime = fTime;
            period.currentState = RETURN_STATES.AVAILABLE;
            period.currentMessage = (fDate && fTime)
              ? formatRelativeTime(`${fDate} ${fTime}`)
              : (fDate ? formatRelativeTime(fDate) : 'Available');
            period.isValid = true;

            const hasOtherGenerating = session.periods && session.periods.some(p => p.currentState === RETURN_STATES.GENERATING && p.value !== periodVal);
            if (!hasOtherGenerating) {
              const banner = getElement('banner-generating');
              if (banner) banner.hidden = true;
            }

            saveStableState(period);
            rerenderRowActions(period);
            hydrateJsonStatus(period);
            updateBulkPdfButtonState();
            updateBulkGenerateButtonState();
            const dJs = getElement(`json-status-${periodVal}`);
            if (dJs) {
              if (fDate) showGenTime(dJs, fDate, fTime || '');
              else setStatusPill(dJs, 'Available', 'rt-status-filed');
            }
            addCopilotLog(`[GSTR-2A ${periodVal}]: File generation complete! Ready for download.`, 'success');
            return;
          }
          return;
        }
        return;
      }

      const m = await processAsync({ request: 'get', url: gstn.generateFile(cfg, period, false), bypassCache: true });
      if (!m || !m.status) return;

      let resp = null;
      try { resp = JSON.parse(m.response); } catch (_) {}
      const dataStatus = (resp && resp.data && typeof resp.data.status !== 'undefined') ? Number(resp.data.status) : -1;
      const urls = (resp && resp.data && Array.isArray(resp.data.url)) ? resp.data.url : (resp && resp.data && resp.data.url ? [resp.data.url] : []);

      const key = periodCacheKey(targetKey, session.finYear, periodVal);
      const triggeredAt = getSavedGenerationTimestamp(key);

      if (dataStatus === 0 && urls.length && urls[0]) {
        const fileDateStr = resp?.data?.date || resp?.data?.gendt || resp?.data?.gen_dt || '';
        const fileTimeStr = resp?.data?.time || '';
        const fileTimeStampStr = resp?.data?.timeStamp || '';
        const fileTs = parseGstnDateTime(fileDateStr, fileTimeStr, fileTimeStampStr);
        const pMsg = (resp?.data?.msg || '').toLowerCase();

        const isDownloadLinkMsg = pMsg.includes('you have downloaded') || pMsg.includes('click on the link');
        const isClockSkewOrRecent = !triggeredAt || !fileTs || (fileTs >= triggeredAt - (5 * 60 * 1000));
        const hasSettledWithoutNewJob = (pollCount >= 3);

        if (!isDownloadLinkMsg && !isClockSkewOrRecent && !hasSettledWithoutNewJob && (Date.now() - triggeredAt < GEN_TTL)) {
          return; // Portal temporarily returning previous URL while initiating generation
        }

        // New generation is complete / file is ready!
        stopFileGenBackgroundPoller(period);
        if (triggeredAt) clearGenerationTimestamp(key);

        period.genDate = fileDateStr;
        period.genTime = fileTimeStr;
        period.currentState = RETURN_STATES.AVAILABLE;
        period.currentMessage = (fileDateStr && fileTimeStr)
          ? formatRelativeTime(`${fileDateStr} ${fileTimeStr}`)
          : (fileDateStr ? formatRelativeTime(fileDateStr) : 'Available');
        period.isValid = true;

        if (!periodStateCache[key]) periodStateCache[key] = {};
        periodStateCache[key].genDate = fileDateStr;
        periodStateCache[key].genTime = fileTimeStr;
        periodStateCache[key].currentState = RETURN_STATES.AVAILABLE;
        periodStateCache[key].currentMessage = period.currentMessage;

        const hasOtherGenerating = session.periods && session.periods.some(p => p.currentState === RETURN_STATES.GENERATING);
        if (!hasOtherGenerating) {
          const banner = getElement('banner-generating');
          if (banner) banner.hidden = true;
        }

        saveStableState(period);
        rerenderRowActions(period);
        hydrateJsonStatus(period);
        updateBulkPdfButtonState();
        updateBulkGenerateButtonState();
        const dJs = getElement(`json-status-${periodVal}`);
        if (dJs) {
          if (fileDateStr) showGenTime(dJs, fileDateStr, fileTimeStr || '');
          else setStatusPill(dJs, 'Available', 'rt-status-filed');
        }
        addCopilotLog(`[${targetKey} ${periodVal}]: File generation complete! File is ready for download.`, 'success');
      }
    } catch (_) {}
  }, 15000);

  _genPollers.set(periodVal, timer);
}

async function downloadImsFile(period, endpointFn, fileTag) {
  const isExcel = fileTag === 'Inward';
  const m = await processAsync({ request: 'get', url: endpointFn(false) });
  if (!m.status) throw new Error('Handshake fail');

  let resp;
  try { resp = JSON.parse(m.response); } catch (e) { throw new Error('Parse fail'); }

  const dataStatus = (resp && resp.data && typeof resp.data.status !== 'undefined')
    ? Number(resp.data.status)
    : -1;

  const urls = (resp && resp.data && Array.isArray(resp.data.url))
    ? resp.data.url
    : (resp && resp.data && resp.data.url ? [resp.data.url] : []);

  if (dataStatus === 0 && urls.length && urls[0]) {
    if (isExcel) period.hasExcel = true;
    else period.hasJson = true;
    const date = (resp.data.date || new Date().toISOString().slice(0,10)).replace(/\//g, '');
    const fileName = `IMS_${fileTag}_${session.gstin}_${period.value}_${date}.zip`;
    if (!await saveBlobUrl(fileName, urls[0], period.value)) throw new Error('Pipeline write block encountered');
    return;
  }

  // Specific file is not ready or not generated yet; trigger generation with flag=1
  const mG = await processAsync({ request: 'get', url: endpointFn(true) });
  if (!mG.status) throw new Error('Re-generation forced tracking dropped');

  let gResp;
  try { gResp = JSON.parse(mG.response); } catch (_) {}
  if (gResp && gResp.data && gResp.data.msg) {
    addCopilotLog(`IMS [${period.value}]: ${gResp.data.msg} (Token: ${gResp.data.token || 'active'})`, 'info');
  }

  const imsKey = periodCacheKey(session.return ? session.return.key : 'IMS', session.finYear, period.value);
  if (!periodStateCache[imsKey]) periodStateCache[imsKey] = {};
  const now = Date.now();
  periodStateCache[imsKey].generationTriggeredAt = now;
  if (isExcel) period.excelGenerating = true;
  else period.jsonGenerating = true;

  saveGenerationTimestamp(imsKey, now);
  showGeneratingBanner();
  syncRowActions(period);
  startImsBackgroundPoller(period);
  throw new Error('Generating…');
}

async function downloadImsExcel(period) {
  return downloadImsFile(period, gstn.imsGenerateExcel, 'Inward');
}

async function downloadImsJson(period) {
  return downloadImsFile(period, gstn.imsGenerateJson, 'Inward_Offline');
}async function fetchFullGstr1aData(period) {
  let gstin = session.gstin || '';
  let full1a = {
    gstin: gstin,
    fp: period.value,
    sec_sum: [],
    b2b: [],
    b2ba: [],
    cdnr: [],
    cdnra: [],
    b2cl: [],
    b2cla: [],
    cdnur: [],
    cdnura: [],
    b2cs: [],
    b2csa: [],
    exp: [],
    expa: [],
    hsn: { data: [] },
    doc_issue: { doc_det: [] },
    isGstr1a: true,
    gstr1_summary: null
  };

  // 1. Fetch overall GSTR-1A summary
  try {
    const mSum = await bgFetch(gstn.gstr1aSummary(period));
    if (mSum && mSum.status && mSum.response) {
      const rSum = JSON.parse(mSum.response);
      if (rSum && rSum.data) {
        if (rSum.data.gstin) full1a.gstin = rSum.data.gstin;
        if (rSum.data.sec_sum) full1a.sec_sum = rSum.data.sec_sum;
      }
    }
  } catch (e) {
    console.warn('[GSTR1A] Summary fetch notice:', e.message);
  }

  // 1b. Fetch original GSTR-1 summary for statutory comparison
  try {
    const mG1Sum = await bgFetch(`https://gstr1a.gst.gov.in/returns/auth/api/gstr1/summary?rtn_prd=${encodeURIComponent(period.value)}`);
    if (mG1Sum && mG1Sum.status && mG1Sum.response) {
      const rG1Sum = JSON.parse(mG1Sum.response);
      if (rG1Sum && rG1Sum.data) {
        full1a.gstr1_summary = rG1Sum.data.sec_sum || rG1Sum.data;
      }
    }
  } catch (e) {
    console.warn('[GSTR1A] Original GSTR-1 summary fetch notice:', e.message);
  }

  // 2. Fetch section count list
  let secCounts = [];
  try {
    const mCounts = await bgFetch(`https://gstr1a.gst.gov.in/r1Aweb/auth/api/gstr1a/totalsummarycount?rtn_prd=${encodeURIComponent(period.value)}`);
    if (mCounts && mCounts.status && mCounts.response) {
      const rCounts = JSON.parse(mCounts.response);
      if (rCounts && rCounts.data && Array.isArray(rCounts.data.sec_count)) {
        secCounts = rCounts.data.sec_count;
        if (rCounts.data.gstin) full1a.gstin = rCounts.data.gstin;
      }
    }
  } catch (e) {
    console.warn('[GSTR1A] totalsummarycount fetch notice:', e.message);
  }

  // 3. For each active section with proc_cnt > 0, fetch invoice-wise / note-wise details
  for (const sec of secCounts) {
    const secName = (sec.sec_name || '').toUpperCase();
    const procCnt = Number(sec.proc_cnt || 0);
    if (procCnt <= 0) continue;

    const cptySections = ['B2B', 'B2BA', 'CDNR', 'CDNRA', 'ECOM_B2B'];
    if (cptySections.includes(secName)) {
      try {
        const mCpty = await bgFetch(`https://gstr1a.gst.gov.in/r1Aweb/auth/api/gstr1a/totalsummarycount?rtn_prd=${encodeURIComponent(period.value)}&sec_name=${encodeURIComponent(secName)}`);
        if (mCpty && mCpty.status && mCpty.response) {
          const rCpty = JSON.parse(mCpty.response);
          const cptyList = rCpty.data?.sec_count?.[0]?.cpty_cnts || [];
          
          for (const cpty of cptyList) {
            const ctin = cpty.ctin;
            const tradeName = cpty.trade_name || '';
            const mInv = await bgFetch(`https://gstr1a.gst.gov.in/r1Aweb/auth/api/gstr1a/invoice?ctin=${encodeURIComponent(ctin)}&rtn_prd=${encodeURIComponent(period.value)}&sec_name=${encodeURIComponent(secName)}&uploaded_by=SU`);
            if (mInv && mInv.status && mInv.response) {
              const rInv = JSON.parse(mInv.response);
              const processedList = rInv.data?.processedInvoice || rInv.data?.invoices || [];

              if (secName.startsWith('CDN')) {
                const targetKey = secName.toLowerCase();
                const ntItems = processedList.map(p => {
                  const txval = Number(p.invtxval !== undefined ? p.invtxval : (p.txval || 0));
                  const iamt  = Number(p.inviamt !== undefined ? p.inviamt : (p.iamt || 0));
                  const camt  = Number(p.invcamt !== undefined ? p.invcamt : (p.camt || 0));
                  const samt  = Number(p.invsamt !== undefined ? p.invsamt : (p.samt || 0));
                  const csamt = Number(p.invcsamt !== undefined ? p.invcsamt : (p.csamt || 0));
                  const rt    = Number(p.rt !== undefined ? p.rt : (txval > 0 ? Math.round(((iamt + camt + samt) / txval) * 100) : 18));
                  return {
                    nt_num: p.nt_num || p.inum || '',
                    nt_dt: p.nt_dt || p.idt || '',
                    ntty: p.ntty || 'C',
                    val: Number(p.val || 0),
                    pos: p.pos || ctin.substring(0, 2),
                    rchrg: p.rchrg || 'N',
                    itms: [{
                      num: 1,
                      itm_det: { txval, rt, iamt, camt, samt, csamt }
                    }]
                  };
                });
                if (!full1a[targetKey]) full1a[targetKey] = [];
                full1a[targetKey].push({
                  ctin: ctin,
                  cname: tradeName,
                  trade_name: tradeName,
                  nt: ntItems
                });
              } else {
                // B2B / B2BA
                const targetKey = secName.toLowerCase();
                const invItems = processedList.map(p => {
                  const txval = Number(p.invtxval !== undefined ? p.invtxval : (p.txval || 0));
                  const iamt  = Number(p.inviamt !== undefined ? p.inviamt : (p.iamt || 0));
                  const camt  = Number(p.invcamt !== undefined ? p.invcamt : (p.camt || 0));
                  const samt  = Number(p.invsamt !== undefined ? p.invsamt : (p.samt || 0));
                  const csamt = Number(p.invcsamt !== undefined ? p.invcsamt : (p.csamt || 0));
                  const rt    = Number(p.rt !== undefined ? p.rt : (txval > 0 ? Math.round(((iamt + camt + samt) / txval) * 100) : 18));
                  return {
                    inum: p.inum || p.nt_num || '',
                    idt: p.idt || p.nt_dt || '',
                    val: Number(p.val || 0),
                    pos: p.pos || ctin.substring(0, 2),
                    rchrg: p.rchrg || 'N',
                    itms: [{
                      num: 1,
                      itm_det: { txval, rt, iamt, camt, samt, csamt }
                    }]
                  };
                });
                if (!full1a[targetKey]) full1a[targetKey] = [];
                full1a[targetKey].push({
                  ctin: ctin,
                  cname: tradeName,
                  trade_name: tradeName,
                  inv: invItems
                });
              }
            }
          }
        }
      } catch (cptyErr) {
        console.warn(`[GSTR1A] Error fetching ${secName} details:`, cptyErr.message);
      }
    } else if (secName === 'HSN') {
      try {
        const mHsn = await bgFetch(`https://gstr1a.gst.gov.in/r1Aweb/auth/api/gstr1a/invoice?rtn_prd=${encodeURIComponent(period.value)}&sec_name=HSN`);
        if (mHsn && mHsn.status && mHsn.response) {
          const rHsn = JSON.parse(mHsn.response);
          if (rHsn.data) {
            full1a.hsn = rHsn.data.hsn || rHsn.data;
          }
        }
      } catch (hsnErr) {
        console.warn('[GSTR1A] Error fetching HSN details:', hsnErr.message);
      }
    } else if (secName === 'DOC') {
      try {
        const mDoc = await bgFetch(`https://gstr1a.gst.gov.in/r1Aweb/auth/api/gstr1a/invoice?rtn_prd=${encodeURIComponent(period.value)}&sec_name=DOC`);
        if (mDoc && mDoc.status && mDoc.response) {
          const rDoc = JSON.parse(mDoc.response);
          if (rDoc.data) {
            full1a.doc_issue = rDoc.data.doc_issue || rDoc.data;
          }
        }
      } catch (docErr) {
        console.warn('[GSTR1A] Error fetching DOC details:', docErr.message);
      }
    } else {
      // Other non-cpty sections (B2CL, B2CS, B2CSA, EXP, CDNUR)
      try {
        const mOther = await bgFetch(`https://gstr1a.gst.gov.in/r1Aweb/auth/api/gstr1a/invoice?rtn_prd=${encodeURIComponent(period.value)}&sec_name=${encodeURIComponent(secName)}`);
        if (mOther && mOther.status && mOther.response) {
          const rOther = JSON.parse(mOther.response);
          const targetKey = secName.toLowerCase();
          if (rOther.data && Array.isArray(rOther.data[targetKey])) {
            full1a[targetKey] = rOther.data[targetKey];
          } else if (rOther.data && Array.isArray(rOther.data.processedInvoice)) {
            full1a[targetKey] = rOther.data.processedInvoice;
          } else if (rOther.data && Array.isArray(rOther.data.invoices)) {
            full1a[targetKey] = rOther.data.invoices;
          } else if (rOther.data && Array.isArray(rOther.data)) {
            full1a[targetKey] = rOther.data;
          } else if (rOther.data && rOther.data[targetKey]) {
            full1a[targetKey] = Array.isArray(rOther.data[targetKey]) ? rOther.data[targetKey] : [rOther.data[targetKey]];
          }
        }
      } catch (otherErr) {
        console.warn(`[GSTR1A] Error fetching ${secName}:`, otherErr.message);
      }
    }
  }

  return full1a;
}

async function download1aJson(period) {
  if (period.filingStatus === 'NOT_FILED' || period.filingStatus === 'NF' || period.filingLabel === 'Not Filed') {
    throw new Error(`Period ${period.value} is not filed`);
  }
  const fullData = await fetchFullGstr1aData(period);
  if (!fullData) throw new Error('GSTR-1A fetch failed');
  const gstin = fullData.gstin || session.gstin;
  const jsonStr = JSON.stringify(fullData, null, 2);
  const ok = await saveJsonAsZipAsync(makeJsonFileName('R1A', gstin, period.value), makeZipFileName('R1A', gstin, period.value), jsonStr);
  if (!ok) {
    saveJsonFile(`returns_R1A_${gstin}_${period.value}.json`, jsonStr);
  }
}

async function download1aExcel(period) {
  if (period.filingStatus === 'NOT_FILED' || period.filingStatus === 'NF' || period.filingLabel === 'Not Filed') {
    throw new Error(`Period ${period.value} is not filed`);
  }
  try {
    await processAsync({ request: "get", url: "https://return.gst.gov.in/imsweb/auth/api/ims/getOutwardCount?rtnType=R1A&rtnprd=" + period.value });
  } catch (_) {}

  return downloadImsFile(period, (forceGen) => gstn.imsGenerateOutward1AExcel(period, forceGen), "Outward_R1A");
}

// ── Full-Year Consolidated Cash & Credit Ledger (.xlsx) Exporter ──
async function downloadCashCreditLedger() {
  if (typeof rpLog !== 'undefined' && rpLog) {
    rpLog.userAction('CASH_CREDIT_LEDGER_START', `User started Cash & Credit Ledger export for FY ${session.finYear || 'selected'}`, {
      finYear: session.finYear,
      gstin: session.gstin
    });
  }
  const bLedger = getElement('btn-cash-credit-ledger');
  const originalText = bLedger ? bLedger.innerHTML : 'Cash & Credit Ledger';

  // Ensure full-screen connecting screen is NEVER triggered
  const s = getElement('status');
  if (s) s.hidden = true;

  const fy = session.finYear || '2023-24';
  const gstin = session.gstin || '';
  const legalName = session.businessName || 'Taxpayer';

  // Compute fdate and tdate from finYear (e.g. "2026-27" -> "01/04/2026" to today's date if current FY)
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const todayStr = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;

  let fdate = '01/04/2023';
  let tdate = '31/03/2024';
  const fyMatch = String(fy).match(/^(\d{4})-(\d{2,4})$/);
  if (fyMatch) {
    const startYear = parseInt(fyMatch[1], 10);
    const endYear = startYear + 1;
    fdate = `01/04/${startYear}`;

    // 31st March of endYear
    const fyEndDate = new Date(endYear, 2, 31, 23, 59, 59);
    if (now < fyEndDate) {
      // Current running FY: GST Portal API rejects future dates, so clamp tdate to today's date!
      tdate = todayStr;
    } else {
      // Past closed FY: full FY till 31/03/endYear
      tdate = `31/03/${endYear}`;
    }
  }

  if (bLedger) {
    bLedger.disabled = true;
    bLedger.innerHTML = '⏳ Fetching...';
  }

  try {
    const cashUrl = `https://payment.gst.gov.in/payment/auth/api/cashdetls?fdate=${fdate}&tdate=${tdate}`;
    const creditUrl = `https://return.gst.gov.in/returns/auth/api/itcdtls?fdate=${fdate}&tdate=${tdate}`;

    console.log('[ReturnPilot Ledger] Fetching statutory ledgers for FY:', fy, { cashUrl, creditUrl });

    // Fetch via bgFetch first (background service worker with host_permissions)
    // with processAsync fallback (active tab content script)
    async function fetchLedger(url) {
      let r = await bgFetch({ url }).catch(() => null);
      if (r && r.status && r.response) return r;
      return await processAsync({ request: 'get', url }).catch(e => ({ status: false, error: e.message }));
    }

    const [respCash, respCredit] = await Promise.all([
      fetchLedger(cashUrl),
      fetchLedger(creditUrl)
    ]);

    let cashData = {};
    if (respCash && respCash.status) {
      try {
        cashData = (typeof respCash.response === 'string') ? JSON.parse(respCash.response) : (respCash.response || {});
      } catch (err) {
        console.warn('[ReturnPilot Ledger] Could not parse cash ledger JSON:', err.message);
      }
    } else {
      console.warn('[ReturnPilot Ledger] Cash ledger query response not ok:', respCash);
    }

    let creditData = {};
    if (respCredit && respCredit.status) {
      try {
        creditData = (typeof respCredit.response === 'string') ? JSON.parse(respCredit.response) : (respCredit.response || {});
      } catch (err) {
        console.warn('[ReturnPilot Ledger] Could not parse credit ledger JSON:', err.message);
      }
    } else {
      console.warn('[ReturnPilot Ledger] Credit ledger query response not ok:', respCredit);
    }

    const hasCashRecords = Array.isArray(cashData.tr) && cashData.tr.length > 0;
    const hasCreditRecords = Array.isArray(creditData.tr) && creditData.tr.length > 0;

    if (!hasCashRecords && !hasCreditRecords) {
      const msg = `⚠️ No ledger records returned for FY ${fy}. Please ensure you are logged in to the GST Portal.`;
      showBannerNotice(msg, 6000);
      if (bLedger) {
        bLedger.disabled = false;
        bLedger.innerHTML = originalText;
      }
      return;
    }

    if (bLedger) {
      bLedger.innerHTML = '⏳ Compiling (.xlsx)...';
    }

    const userProfile = await new Promise(r => chrome.storage.local.get(['rp_user_profile'], res => r(res?.rp_user_profile || {})));

    await loadScriptAsync('../lib/fflate.js');
    await loadScriptAsync('../core/xlsx-builder.js');
    await loadScriptAsync('../core/cash-credit-ledger-builder.js');

    const Builder = (typeof CashCreditLedgerBuilder !== 'undefined') ? CashCreditLedgerBuilder : null;
    if (!Builder || typeof Builder.buildLedgerWorkbook !== 'function') {
      throw new Error('CashCreditLedgerBuilder engine not initialized');
    }

    const wb = Builder.buildLedgerWorkbook({
      creditData,
      cashData,
      metadata: {
        email: userProfile.email || '',
        gstin,
        legalName,
        tradeName: legalName,
        finYear: fy,
        fromDate: fdate,
        toDate: tdate
      }
    });

    const base64 = await wb.generateBase64();
    const fileName = `${gstin || 'GST'}_Cash_and_Credit_Ledger_${fy}.xlsx`;

    chrome.runtime.sendMessage({
      request: 'download-file',
      fileName,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      base64,
      gstin: gstin || 'GST',
      returnType: 'LEDGER',
      period: 'ALL',
      fy: fy
    });

    if (bLedger) {
      bLedger.innerHTML = '✅ Downloaded';
      setTimeout(() => {
        if (bLedger) {
          bLedger.disabled = false;
          bLedger.innerHTML = originalText;
        }
      }, 2500);
    }

    showBannerNotice(`✅ Generated and downloaded ${fileName}`, 4000);

  } catch (err) {
    console.error('[ReturnPilot Ledger] Export failed:', err);
    showBannerNotice(`⚠️ Ledger export error: ${err.message}`, 6000);
    if (bLedger) {
      bLedger.disabled = false;
      bLedger.innerHTML = originalText;
    }
  }
}

// ── Notice & Demand Radar Engine ──
let _cachedNoticeData = null;


function parseNoticeDateTs(d) {
  if (!d || d === '-' || d === 'NA') return 0;
  if (typeof d === 'number') return d;
  const m = String(d).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    return new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10)).getTime();
  }
  const t = Date.parse(d);
  return isNaN(t) ? 0 : t;
}

function parseDueDateTs(d) {
  if (!d || d === '-' || d === 'NA' || d === 'Check Portal') return 0;
  if (typeof d === 'number') return d;
  const m = String(d).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    return new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10), 23, 59, 59).getTime();
  }
  const t = Date.parse(d);
  return isNaN(t) ? 0 : t;
}

async function scanNoticesAndOrders(force = false) {
  const gstin = session.gstin || '';
  if (!gstin) return;

  const btnNotice = getElement('noticeRadarBtn');
  const txtNotice = getElement('noticeRadarText');
  const dotNotice = btnNotice ? btnNotice.querySelector('.radar-pulse-dot') : null;
  const statusEl = getElement('noticeScanStatusText');

  if (statusEl) statusEl.textContent = 'Status: Scanning portal notices...';

  try {
    const noticesUrl = 'https://services.gst.gov.in/services/auth/api/get/notices';
    const casesUrl = 'https://services.gst.gov.in/litserv/auth/api/case/task/get';

    console.log('[Notice Radar] Scanning notices for GSTIN:', gstin);

    const [respNotices, respCases] = await Promise.all([
      bgFetch({
        method: 'POST',
        url: noticesUrl,
        contentType: 'application/json;charset=UTF-8',
        body: { onLoad: true }
      }).catch(e => ({ status: false, error: e.message })),
      bgFetch({
        method: 'POST',
        url: casesUrl,
        contentType: 'application/json;charset=UTF-8',
        body: { gstIn: gstin }
      }).catch(e => ({ status: false, error: e.message }))
    ]);

    let generalNotices = [];
    if (respNotices && respNotices.status && respNotices.response) {
      try {
        const raw = (typeof respNotices.response === 'string') ? JSON.parse(respNotices.response) : respNotices.response;
        if (Array.isArray(raw)) generalNotices = raw;
      } catch (_) {}
    }

    let litigationCases = [];
    if (respCases && respCases.status && respCases.response) {
      try {
        const raw = (typeof respCases.response === 'string') ? JSON.parse(respCases.response) : respCases.response;
        if (Array.isArray(raw)) litigationCases = raw;
      } catch (_) {}
    }

    const normalizedItems = [];
    const now = Date.now();
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

    // 1. Process Litigation & Scrutiny Cases (View Additional Notices and Orders)
    litigationCases.forEach(c => {
      const desc = String(c.taskDesc || c.caseTypeName || 'Litigation Notice');
      const isSCN = desc.toLowerCase().includes('show cause') || desc.toLowerCase().includes('drc-01');
      const isASMT10 = desc.toLowerCase().includes('asmt-10');
      const isASMT13 = desc.toLowerCase().includes('asmt-13');
      const isOrder = desc.toLowerCase().includes('order');
      const refId = c.refId || c.arn || String(c.caseTaskId || '-');
      const dateStr = c.assignmentDt ? formatDdMmYyyy(c.assignmentDt) : '-';
      const ts = c.assignmentDt || 0;

      // Only real adverse demands/notices from authorities (exclude taxpayer voluntary payments and order rectifications)
      const isVoluntaryOrClosed = c.caseTypeName === 'VOLUNTARY PAYMENT' || c.caseTypeName === 'RECTIFICATION OF ORDERS';
      const isActionableNotice = !isVoluntaryOrClosed && (isSCN || isASMT10 || isASMT13 || (c.status === 'OPEN' && isOrder));

      // Highlight Rule 1: Genuine adverse notice issued strictly in the last 7 days AND unread on portal
      const isNewUnread = isActionableNotice && (c.isRead === 'N') && (ts > 0) && (now >= ts) && ((now - ts) <= SEVEN_DAYS_MS);

      // Highlight Rule 2: Due date is coming strictly within the next 7 days (0 <= diffDays <= 7)
      // "after 7 days dont show overdue or any other alert"
      const dueTs = parseDueDateTs(c.dueDate);
      let isDueSoon = false;
      let dueLabel = '';
      if (dueTs > 0) {
        const diffDays = Math.ceil((dueTs - now) / (24 * 60 * 60 * 1000));
        if (diffDays >= 0 && diffDays <= 7) {
          isDueSoon = true;
          dueLabel = diffDays === 0 ? 'DUE TODAY' : `DUE IN ${diffDays}D`;
        }
      }

      const isHighlighted = isNewUnread || isDueSoon;

      // Exact portal match: Litigation cases show "As Applicable*" if not specified
      const dueDisplay = (c.dueDate && c.dueDate !== 'NA' && c.dueDate !== 'Check Portal') ? c.dueDate : 'As Applicable*';

      normalizedItems.push({
        source: 'case',
        refId: refId,
        title: desc,
        category: c.caseTypeName || 'LITIGATION',
        type: isSCN ? 'SCN' : (isASMT10 ? 'ASMT-10' : (isASMT13 ? 'ASMT-13' : (isOrder ? 'ORDER' : 'CASE'))),
        date: dateStr,
        timestamp: ts,
        dueDate: dueDisplay,
        dueLabel: dueLabel,
        amount: null,
        status: c.status || 'OPEN',
        isNewUnread,
        isDueSoon,
        isHighlighted,
        isRead: c.isRead === 'Y',
        portalUrl: 'https://services.gst.gov.in/services/auth/notices'
      });
    });

    // 2. Process General Notices & Orders (View Notices and Orders)
    generalNotices.forEach(n => {
      const desc = String(n.descr || (n.type === 'Order' ? 'Official Order' : 'Official Notice'));
      const refId = n.noticeOrderId || '-';
      const isOrder = (n.type === 'Order') || desc.toLowerCase().includes('order');
      const isDefaulter = desc.toLowerCase().includes('defaulter') || desc.toLowerCase().includes('u/s 46');
      const hasDemand = n.amount && n.amount !== 'NA' && Number(n.amount) > 0;
      const ts = parseNoticeDateTs(n.dtOfIssue);

      // Highlight Rule 1: Notice issued in the last 7 days AND unread on portal server
      const isNewUnread = (n.isRead === 'N') && (ts > 0) && (now >= ts) && ((now - ts) <= SEVEN_DAYS_MS);

      // Highlight Rule 2: Due date is coming strictly within the next 7 days (0 <= diffDays <= 7)
      // "after 7 days dont show overdue or any other alert"
      const dueTs = parseDueDateTs(n.dueDate);
      let isDueSoon = false;
      let dueLabel = '';
      if (dueTs > 0) {
        const diffDays = Math.ceil((dueTs - now) / (24 * 60 * 60 * 1000));
        if (diffDays >= 0 && diffDays <= 7) {
          isDueSoon = true;
          dueLabel = diffDays === 0 ? 'DUE TODAY' : `DUE IN ${diffDays}D`;
        }
      }

      const isHighlighted = isNewUnread || isDueSoon;

      // Exact portal match: General notices show exact date, "NA", or "As Applicable*"
      const dueDisplay = (n.dueDate && n.dueDate !== 'NA') ? n.dueDate : (n.dueDate === 'NA' ? 'NA' : 'As Applicable*');

      normalizedItems.push({
        source: 'notice',
        refId: refId,
        title: desc,
        category: n.issuedBy || 'General / System',
        type: hasDemand ? 'DEMAND' : (isOrder ? 'ORDER' : (isDefaulter ? 'GSTR-3A' : 'NOTICE')),
        date: n.dtOfIssue || '-',
        timestamp: ts,
        dueDate: dueDisplay,
        dueLabel: dueLabel,
        amount: hasDemand ? Number(n.amount) : null,
        status: n.isRead === 'N' ? 'UNREAD' : (n.status || 'ISSUED'),
        isNewUnread,
        isDueSoon,
        isHighlighted,
        isRead: n.isRead === 'Y',
        portalUrl: n.pdfDownloadURL ? `https://return.gst.gov.in${n.pdfDownloadURL}` : 'https://services.gst.gov.in/services/auth/notices'
      });
    });

    // Sort newest to oldest
    normalizedItems.sort((a, b) => b.timestamp - a.timestamp);

    _cachedNoticeData = normalizedItems;

    // Count truly urgent/highlighted items (new unread notice in last 7 days OR due in next 7 days)
    const urgentCount = normalizedItems.filter(x => x.isHighlighted).length;

    // Update Topbar Badge — Clean state shows just "Notice Radar" without scary historical counts (prevents user panic)
    if (btnNotice && txtNotice) {
      const iconEl = btnNotice.querySelector('.notice-radar-icon');
      if (urgentCount > 0) {
        btnNotice.className = 'btn-notice-radar has-notices';
        if (dotNotice) dotNotice.style.display = 'inline-block';
        if (iconEl) iconEl.style.display = 'none';
        txtNotice.textContent = `New Notice Alert (${urgentCount})`;
        btnNotice.title = `${urgentCount} new notices issued in last 7 days or due within 7 days! Click to review.`;
      } else {
        btnNotice.className = 'btn-notice-radar clean';
        if (dotNotice) dotNotice.style.display = 'none';
        if (iconEl) iconEl.style.display = 'inline-block';
        txtNotice.textContent = 'Notice Radar';
        btnNotice.title = 'Notice Radar — All clear';
      }
    }

    renderNoticeRadarList();
    if (statusEl) statusEl.textContent = `Status: Scanned ${normalizedItems.length} notices on portal (${urgentCount} urgent)`;

  } catch (err) {
    console.warn('[Notice Radar] Scan error:', err);
    if (statusEl) statusEl.textContent = 'Status: Scan failed (' + err.message + ')';
  }
}

function renderNoticeRadarList() {
  const container = getElement('noticeRadarContent');
  if (!container) return;

  const items = _cachedNoticeData || [];

  if (items.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:30px 15px; color:#64748b;">
        <div style="font-size:28px; margin-bottom:6px;">🎉</div>
        <div style="font-weight:700; color:#0f172a; font-size:13px; margin-bottom:4px;">No Notices or Orders Found</div>
        <div style="font-size:11px;">No active Show Cause Notices or Demands detected on the GST Portal.</div>
      </div>
    `;
    return;
  }

  let html = '<div class="notice-radar-list">';
  items.forEach(item => {
    const isHighlighted = item.isHighlighted;
    const typeClass = item.type === 'SCN' ? 'scn' : ((item.type === 'ORDER' || item.type === 'ASMT-13') ? 'order' : (item.type === 'DEMAND' ? 'demand' : 'open'));
    
    html += `
      <div class="notice-item-card ${isHighlighted ? 'is-urgent' : ''}">
        <div class="notice-item-header">
          <div class="notice-title">${escapeHtml(item.title)}</div>
          <div class="notice-badges">
            ${item.isNewUnread ? '<span class="badge-tag new">⚡ NEW</span>' : ''}
            ${item.isDueSoon ? `<span class="badge-tag urgent">⚠️ ${escapeHtml(item.dueLabel)}</span>` : ''}
            <span class="badge-tag ${typeClass}">${escapeHtml(item.type)}</span>
            <span class="badge-tag category">${escapeHtml(item.category)}</span>
            ${item.status && item.status !== 'NA' ? `<span class="badge-tag ${item.status === 'OPEN' || item.status === 'UNREAD' ? 'open' : 'category'}">${escapeHtml(item.status)}</span>` : ''}
          </div>
        </div>
        <div class="notice-meta-row">
          <div>Ref No: <span class="notice-ref">${escapeHtml(item.refId)}</span> &nbsp;•&nbsp; Date: <strong>${escapeHtml(item.date)}</strong></div>
          <div style="display:flex; align-items:center; gap:8px;">
            ${item.amount ? `<span style="font-weight:700; color:#b91c1c;">Demand: ₹${item.amount.toLocaleString('en-IN')}</span>` : ''}
            <span style="color: ${item.isDueSoon ? '#b91c1c; font-weight:700;' : '#64748b;'}">Due Date: ${escapeHtml(item.dueDate)}</span>
          </div>
        </div>
      </div>
    `;
  });
  html += '</div>';

  container.innerHTML = html;
}

async function fetchFullGstr3bData(period) {
  if (period.filingStatus === 'NOT_FILED' || period.filingStatus === 'NF' || period.filingLabel === 'Not Filed' || !period.isValid) {
    throw new Error(`Period ${period.month || period.value} is not filed`);
  }

  let summaryData = null;
  let portalErrorMsg = '';

  // 1. Primary probe: Query standard GSTR-3B summary endpoint
  try {
    const mSum = await processAsync({ request: 'get', url: gstn.gstr3bSummary(period) });
    if (mSum && mSum.status && mSum.response) {
      const rSum = typeof mSum.response === 'string' ? JSON.parse(mSum.response) : mSum.response;
      if (rSum && typeof rSum === 'object') {
        if (rSum.data && typeof rSum.data === 'object' && rSum.data !== null) {
          summaryData = rSum.data;
        } else if (rSum.gstin || rSum.ret_period || rSum.sup_details || rSum.sec_sum) {
          summaryData = rSum;
        } else if (rSum.error || rSum.error_msg || rSum.message || rSum.status === 0 || rSum.status_cd === '0') {
          portalErrorMsg = rSum.error?.message || rSum.error_msg || rSum.message || (rSum.error && rSum.error.error_cd) || '';
        }
      }
    }
  } catch (e1) {
    console.warn(`[ReturnPilot GSTR-3B] Primary summary API probe encountered error for ${period.value}:`, e1);
  }

  // 2. Secondary fallback: Query official portal getgenpdf endpoint (used by GSTN gstr3bCtrl when summary endpoint is unpopulated)
  if (!summaryData) {
    try {
      const mGenPdf = await processAsync({ request: 'get', url: gstn.gstr3bGetGenPdf(period) });
      if (mGenPdf && mGenPdf.status && mGenPdf.response) {
        const rGen = typeof mGenPdf.response === 'string' ? JSON.parse(mGenPdf.response) : mGenPdf.response;
        if (rGen && typeof rGen === 'object') {
          if (rGen.data?.r3b && typeof rGen.data.r3b === 'object' && rGen.data.r3b !== null) {
            summaryData = rGen.data.r3b;
          } else if (rGen.data && typeof rGen.data === 'object' && rGen.data !== null && (rGen.data.gstin || rGen.data.sup_details)) {
            summaryData = rGen.data;
          } else if (rGen.gstin || rGen.sup_details) {
            summaryData = rGen;
          } else if (!portalErrorMsg && (rGen.error || rGen.error_msg || rGen.message || rGen.status === 0 || rGen.status_cd === '0')) {
            portalErrorMsg = rGen.error?.message || rGen.error_msg || rGen.message || '';
          }
        }
      }
    } catch (e2) {
      console.warn(`[ReturnPilot GSTR-3B] getgenpdf fallback probe encountered error for ${period.value}:`, e2);
    }
  }

  // 3. Tertiary fallback: Check formdetails for Nil return status or metadata
  if (!summaryData) {
    try {
      const mFd = await processAsync({ request: 'get', url: gstn.gstr3bFormDetails(period) });
      if (mFd && mFd.status && mFd.response) {
        const rFd = typeof mFd.response === 'string' ? JSON.parse(mFd.response) : mFd.response;
        const fdData = (rFd && typeof rFd === 'object') ? (rFd.data || rFd) : {};
        const isNil = (fdData.isnil === 'Y' || String(fdData.isnil).toUpperCase() === 'Y');
        if (isNil) {
          period.isNil = true;
          period.filingStatus = 'NIL_FILED';
          period.filingLabel = 'Nil Filed';
          if (fdData.arn) period.arn = fdData.arn;
          if (fdData.fil_dt) period.fil_dt = fdData.fil_dt;

          const curFil = getElement(`filing-status-${period.value}`);
          if (curFil) setStatusPill(curFil, 'Nil Filed', 'rt-status-filed');

          const effectiveGstin = fdData.gstin || (session && session.gstin) || '';
          summaryData = {
            gstin: effectiveGstin,
            ret_period: period.value,
            isnil: 'Y',
            nil: true,
            arn: fdData.arn || '',
            fil_dt: fdData.fil_dt || '',
            sup_details: { osup_det: { txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 }, osup_zero: { txval: 0, iamt: 0, csamt: 0 }, osup_nil_exmt: { txval: 0 }, isup_rev: { txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 }, osup_nongst: { txval: 0 } },
            inter_sup: { unreg_details: [], comp_details: [], uin_details: [] },
            itc_elg: { itc_avl: [], itc_rev: [], itc_net: { iamt: 0, camt: 0, samt: 0, csamt: 0 }, itc_inelg: [] },
            intr_ltfee: { intr_details: { iamt: 0, camt: 0, samt: 0, csamt: 0 }, ltfee_details: { iamt: 0, camt: 0, samt: 0, csamt: 0 } },
            taxpayble: {}
          };
        }
      }
    } catch (e3) {
      console.warn(`[ReturnPilot GSTR-3B] formdetails Nil probe encountered error for ${period.value}:`, e3);
    }
  }

  if (!summaryData || typeof summaryData !== 'object') {
    throw new Error(portalErrorMsg || `GSTR-3B summary not available for ${period.month || period.value}`);
  }

  // 4. Safely enrich ledger breakdown / taxpayble (non-fatal if absent or zero-liability)
  let payableData = {};
  try {
    const mPay = await processAsync({ request: 'get', url: gstn.gstr3bPayable(period) });
    if (mPay && mPay.status && mPay.response) {
      const rPay = typeof mPay.response === 'string' ? JSON.parse(mPay.response) : mPay.response;
      if (rPay && typeof rPay === 'object') {
        payableData = (rPay.data && typeof rPay.data === 'object' && rPay.data !== null) ? rPay.data : ((rPay.bal && typeof rPay.bal === 'object') ? rPay : {});
      }
    }
  } catch (payErr) {
    console.warn(`[ReturnPilot GSTR-3B] Non-fatal notice: taxpayble fetch omitted for ${period.value}:`, payErr);
  }
  summaryData.taxpayble = payableData;

  // 5. Ensure authoritative GSTIN and period attributes
  const effectiveGstin = summaryData.gstin || (session && session.gstin) || (period && period.gstin) || '';
  summaryData.gstin = effectiveGstin;
  summaryData.ret_period = summaryData.ret_period || period.value;

  return summaryData;
}

async function download3bJson(period) {
  const summaryData = await fetchFullGstr3bData(period);
  const effectiveGstin = summaryData.gstin || (session && session.gstin) || (period && period.gstin) || '';

  // Serialize and save file
  const ok = await saveJsonAsZipAsync(
    makeJsonFileName('R3B', effectiveGstin, period.value),
    makeZipFileName('R3B', effectiveGstin, period.value),
    JSON.stringify(summaryData),
    period.value
  );
  if (!ok) throw new Error('Save verification loop rejected structural link');
}

async function fetchGstr1Summary(period) {
  try {
    const val = typeof period === 'object' ? period.value : period;
    const url = `https://return.gst.gov.in/returns/auth/api/gstr1/summary?rtn_prd=${encodeURIComponent(val)}`;
    const mSum = await processAsync({ request: 'get', url });
    if (mSum && mSum.status && mSum.response) {
      const r = typeof mSum.response === 'string' ? JSON.parse(mSum.response) : mSum.response;
      if (r && (r.data || r.sec_sum)) return r.data || r;
    }
  } catch (e) {
    console.warn(`[ReturnPilot GSTR-1] Summary probe notice for ${period?.value || period}:`, e.message);
  }
  return null;
}

async function download3bExcel(period) {
  if (period.filingStatus === 'NOT_FILED' || period.filingStatus === 'NF' || period.filingLabel === 'Not Filed' || !period.isValid) {
    throw new Error(`Period ${period.month || period.value} is not filed`);
  }

  // Fetch GSTR-3B, GSTR-1 summary, and GSTR-2B in parallel
  const [g3bRes, g1Res, g2bRes] = await Promise.allSettled([
    fetchFullGstr3bData(period),
    fetchGstr1Summary(period),
    fetch2bData(period)
  ]);

  const summaryData = (g3bRes.status === 'fulfilled') ? g3bRes.value : null;
  if (!summaryData) throw new Error(`Could not fetch GSTR-3B data for ${period.month || period.value}`);

  const gstr1Data = (g1Res.status === 'fulfilled') ? g1Res.value : null;
  const g2bResVal = (g2bRes.status === 'fulfilled') ? g2bRes.value : null;
  const gstr2bData = (g2bResVal && g2bResVal.ok) ? (g2bResVal.data || g2bResVal.raw) : null;

  await loadScriptAsync('../lib/fflate.js');
  await loadScriptAsync('../core/xlsx-builder.js');
  await loadScriptAsync('../core/consolidated-gstr3b-builder.js');

  const gstin = summaryData.gstin || (session && session.gstin) || '';
  const finYear = (session && session.finYear) || getElement('finYear')?.value || '';
  const isBadTaxpayerName = (v) => !v || typeof v !== 'string' || ['na', 'n/a', 'null', 'undefined', '-', '.'].includes(v.trim().toLowerCase());
  const tradeName = [session?.tradeName, session?.legalName, session?.businessName, getElement('businessName')?.textContent?.trim()].find(v => !isBadTaxpayerName(v)) || 'Taxpayer';

  const builder = (typeof ConsolidatedGstr3bBuilder !== 'undefined') ? ConsolidatedGstr3bBuilder : window.ConsolidatedGstr3bBuilder;
  if (!builder) throw new Error('ConsolidatedGstr3bBuilder engine failed to load');

  const wb = builder.buildGstr3bConsolidatedWorkbook([{
    period: period.value,
    data: summaryData,
    gstr1Data,
    gstr2bData
  }], {
    gstin,
    finYear,
    tradeName,
    email: (typeof currentUserProfile !== 'undefined' && currentUserProfile?.email) || ''
  });

  const base64 = await wb.generateBase64();
  const fileName = `GSTR3B_${gstin}_${period.value}.xlsx`;
  chrome.runtime.sendMessage({
    request: 'download-file',
    fileName,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    base64,
    gstin,
    returnType: 'R3B',
    period: period.value,
    fy: finYear
  });
  addCopilotLog(`✅ GSTR-3B Excel generated: ${fileName}`, 'success');
}

async function download2bJson(period) {
  let r2b = period.r2bCachedData, raw = period.r2bRawData; if (!r2b || !raw) { const res = await fetch2bData(period); if (!res.ok) throw new Error(res.error === 'No Data' ? 'No Supplier Records' : res.error); r2b = res.data; raw = res.raw; }
  if (!r2b || !r2b.gstin) throw new Error('No Supplier Records');
  if (!saveJsonFile(`returns_R2B_${r2b.gstin}_${r2b.rtnprd || period.value}.json`, JSON.stringify(raw, null, 2))) throw new Error('Local file serialization blocked');
}

async function download2bPdf(period) {
  let tabId = (currentActiveTabId && currentActiveTabId > 0) ? currentActiveTabId : null;
  if (!tabId) {
    const tabs = await new Promise(resolve => chrome.tabs.query({ active: true, currentWindow: true }, resolve));
    tabId = tabs && tabs[0] ? tabs[0].id : null;
  }
  console.log(`[ReturnPilot GSTR-2B] Initiating native GSTR-2B Summary PDF for period: ${period.value}...`);
  addCopilotLog(`Initiating native GSTR-2B Summary PDF for period: ${period.value}...`, 'info');
  const res = await processAsync({
    request: 'download-pdf-via-angular-gstr2b',
    period: period.value,
    gstin: (typeof session !== 'undefined' && session && session.gstin) || '',
    tabId: tabId
  }, 45000);
  if (!res || !res.success) {
    throw new Error(res ? (res.error || 'GSTR-2B PDF compilation failed') : 'GSTR-2B PDF compilation failed');
  }
  if (res.filename) {
    const filePeriodMatch = res.filename.match(/(0[1-9]|1[0-2])(20\d{2})/);
    if (filePeriodMatch && filePeriodMatch[0] !== period.value) {
      console.warn(`[ReturnPilot GSTR-2B] ⚠ Period mismatch warning: Target=${period.value}, Dispatched=${filePeriodMatch[0]}`);
    } else {
      console.log(`[ReturnPilot GSTR-2B] ✓ Period verified: ${period.value} matches dispatched file`);
    }
  }
  console.log(`[ReturnPilot GSTR-2B] ✓ Native GSTR-2B Summary PDF downloaded for ${period.value}!`);
  addCopilotLog(`Native GSTR-2B Summary PDF downloaded for ${period.value}!`, 'success');
}

async function download2bExcel(period) {
  let tabId = (currentActiveTabId && currentActiveTabId > 0) ? currentActiveTabId : null;
  if (!tabId) {
    const tabs = await new Promise(resolve => chrome.tabs.query({ active: true, currentWindow: true }, resolve));
    tabId = tabs && tabs[0] ? tabs[0].id : null;
  }
  addCopilotLog(`Initiating native GSTR-2B Details Excel for period: ${period.value}...`, 'info');
  const res = await processAsync({
    request: 'download-excel-via-angular-gstr2b',
    period: period.value,
    gstin: (typeof session !== 'undefined' && session && session.gstin) || '',
    tabId: tabId
  }, 70000);
  if (!res || !res.success) {
    throw new Error(res ? (res.error || 'GSTR-2B Excel compilation failed') : 'GSTR-2B Excel compilation failed');
  }
  addCopilotLog(`Native GSTR-2B Details Excel downloaded for ${period.value}!`, 'success');
}

async function download2bDetailedPdf(period) {
  return download2bPdf(period);
}

async function download3BPdf(period) {
  let tabId = (currentActiveTabId && currentActiveTabId > 0) ? currentActiveTabId : null;
  if (!tabId) {
    const tabs = await new Promise(resolve => chrome.tabs.query({ active: true, currentWindow: true }, resolve));
    tabId = tabs && tabs[0] ? tabs[0].id : null;
  }
  const periodVal = (typeof period === 'object' && period) ? (period.value || period.rtnprd) : period;
  console.log(`[ReturnPilot GSTR-3B] Initiating native GSTR-3B Summary PDF for period: ${periodVal}...`);
  addCopilotLog(`Initiating native GSTR-3B Summary PDF for period: ${periodVal}...`, 'info');
  if (typeof rpLog !== 'undefined' && rpLog) {
    rpLog.info('GSTR3B_PDF', `Initiating native GSTR-3B Summary PDF for period: ${periodVal}`, { period: periodVal, gstin: (typeof session !== 'undefined' && session && session.gstin) || '' });
  }
  const res = await processAsync({
    request: 'download-pdf-via-angular-gstr3b',
    period: periodVal,
    gstin: (typeof session !== 'undefined' && session && session.gstin) || '',
    tabId: tabId
  }, 45000);
  if (!res || !res.success) {
    const err = res ? (res.error || 'GSTR-3B PDF compilation failed') : 'GSTR-3B PDF compilation failed';
    if (typeof rpLog !== 'undefined' && rpLog) {
      rpLog.error('GSTR3B_PDF', `❌ GSTR-3B PDF failed for ${periodVal}: ${err}`);
    }
    throw new Error(err);
  }
  if (res.filename) {
    const filePeriodMatch = res.filename.match(/(0[1-9]|1[0-2])(20\d{2})/);
    if (filePeriodMatch && filePeriodMatch[0] !== periodVal) {
      console.warn(`[ReturnPilot GSTR-3B] ⚠ Period mismatch warning: Target=${periodVal}, Dispatched=${filePeriodMatch[0]}`);
    } else {
      console.log(`[ReturnPilot GSTR-3B] ✓ Period verified: ${periodVal} matches dispatched file`);
    }
  }
  console.log(`[ReturnPilot GSTR-3B] ✓ Native GSTR-3B Summary PDF downloaded for ${periodVal}!`);
  addCopilotLog(`Native GSTR-3B Summary PDF downloaded for ${periodVal}!`, 'success');
  if (typeof rpLog !== 'undefined' && rpLog) {
    rpLog.info('GSTR3B_PDF', `✓ Native GSTR-3B Summary PDF downloaded for ${periodVal}!`, { filename: res.filename });
  }
}

async function download1PdfViaAngular(period) {
  let tabId = (currentActiveTabId && currentActiveTabId > 0) ? currentActiveTabId : null;
  if (!tabId) {
    const tabs = await new Promise(resolve => chrome.tabs.query({ active: true, currentWindow: true }, resolve));
    tabId = tabs && tabs[0] ? tabs[0].id : null;
  }
  const periodVal = (typeof period === 'object' && period) ? (period.value || period.rtnprd) : period;
  console.log(`[ReturnPilot GSTR-1] Initiating native GSTR-1 PDF for period: ${periodVal}...`);
  addCopilotLog(`Initiating native GSTR-1 PDF for period: ${periodVal}...`, 'info');
  if (typeof rpLog !== 'undefined' && rpLog) {
    rpLog.info('GSTR1_PDF', `Initiating native GSTR-1 PDF for period: ${periodVal}`, { period: periodVal, gstin: (typeof session !== 'undefined' && session && session.gstin) || '' });
  }
  const res = await processAsync({
    request: 'download-pdf-via-angular-gstr1',
    period: periodVal,
    gstin: (typeof session !== 'undefined' && session && session.gstin) || '',
    tabId: tabId
  }, 60000);
  if (!res || !res.success) {
    const err = res ? (res.error || 'GSTR-1 PDF download failed') : 'GSTR-1 PDF download failed';
    if (typeof rpLog !== 'undefined' && rpLog) {
      rpLog.error('GSTR1_PDF', `❌ GSTR-1 PDF failed for ${periodVal}: ${err}`);
    }
    throw new Error(err);
  }
  console.log(`[ReturnPilot GSTR-1] ✓ Native GSTR-1 PDF downloaded for ${periodVal}!`);
  addCopilotLog(`Native GSTR-1 PDF downloaded for ${periodVal}!`, 'success');
  if (typeof rpLog !== 'undefined' && rpLog) {
    rpLog.info('GSTR1_PDF', `✓ Native GSTR-1 PDF downloaded for ${periodVal}!`, { filename: res.filename });
  }
}

async function download1aPdfViaAngular(period, mode = 'STANDALONE') {
  let tabId = (currentActiveTabId && currentActiveTabId > 0) ? currentActiveTabId : null;
  if (!tabId) {
    const tabs = await new Promise(resolve => chrome.tabs.query({ active: true, currentWindow: true }, resolve));
    tabId = tabs && tabs[0] ? tabs[0].id : null;
  }
  const periodVal = (typeof period === 'object' && period) ? (period.value || period.rtnprd) : period;
  const typeLabel = mode === 'CONSOLIDATED' ? 'Consolidated' : 'Standalone';
  console.log(`[ReturnPilot GSTR-1A] Initiating native GSTR-1A ${typeLabel} PDF for period: ${periodVal}...`);
  addCopilotLog(`Initiating native GSTR-1A ${typeLabel} PDF for period: ${periodVal}...`, 'info');
  if (typeof rpLog !== 'undefined' && rpLog) {
    rpLog.info('GSTR1A_PDF', `Initiating native GSTR-1A ${typeLabel} PDF for period: ${periodVal}`, { period: periodVal, mode });
  }
  const res = await processAsync({
    request: 'download-pdf-via-angular-gstr1a',
    period: periodVal,
    gstin: (typeof session !== 'undefined' && session && session.gstin) || '',
    pdfType: mode,
    tabId: tabId
  }, 60000);
  if (!res || !res.success) {
    const err = res ? (res.error || 'GSTR-1A PDF download failed') : 'GSTR-1A PDF download failed';
    if (typeof rpLog !== 'undefined' && rpLog) {
      rpLog.error('GSTR1A_PDF', `❌ GSTR-1A PDF failed for ${periodVal}: ${err}`);
    }
    throw new Error(err);
  }
  console.log(`[ReturnPilot GSTR-1A] ✓ Native GSTR-1A ${typeLabel} PDF downloaded for ${periodVal}!`);
  addCopilotLog(`Native GSTR-1A ${typeLabel} PDF downloaded for ${periodVal}!`, 'success');
  if (typeof rpLog !== 'undefined' && rpLog) {
    rpLog.info('GSTR1A_PDF', `✓ Native GSTR-1A ${typeLabel} PDF downloaded for ${periodVal}!`, { filename: res.filename });
  }
}

async function download9Pdf(period) {
  let tabId = (currentActiveTabId && currentActiveTabId > 0) ? currentActiveTabId : null;
  if (!tabId) {
    const tabs = await new Promise(resolve => chrome.tabs.query({ active: true, currentWindow: true }, resolve));
    tabId = tabs && tabs[0] ? tabs[0].id : null;
  }
  const periodVal = (typeof period === 'object' && period) ? (period.value || period.rtnprd) : period;
  const finYr = (typeof session !== 'undefined' && session?.finYear) || (typeof period === 'object' ? period.finYr : '') || '';
  console.log(`[ReturnPilot GSTR-9] Initiating native GSTR-9 PDF for period: ${periodVal} (FY: ${finYr})...`);
  addCopilotLog(`Initiating native GSTR-9 PDF for period: ${periodVal}...`, 'info');
  if (typeof rpLog !== 'undefined' && rpLog) {
    rpLog.info('GSTR9_PDF', `Initiating native GSTR-9 PDF for period: ${periodVal}`, { period: periodVal, finYr });
  }
  const res = await processAsync({
    request: 'download-pdf-via-angular-gstr9',
    period: periodVal,
    finYr: finYr,
    gstin: (typeof session !== 'undefined' && session && session.gstin) || '',
    tabId: tabId
  }, 60000);
  if (!res || !res.success) {
    const err = res ? (res.error || 'GSTR-9 PDF download failed') : 'GSTR-9 PDF download failed';
    if (typeof rpLog !== 'undefined' && rpLog) {
      rpLog.error('GSTR9_PDF', `❌ GSTR-9 PDF failed for ${periodVal}: ${err}`);
    }
    throw new Error(err);
  }
  console.log(`[ReturnPilot GSTR-9] ✓ Native GSTR-9 PDF downloaded for ${periodVal}!`);
  addCopilotLog(`Native GSTR-9 PDF downloaded for ${periodVal}!`, 'success');
  if (typeof rpLog !== 'undefined' && rpLog) {
    rpLog.info('GSTR9_PDF', `✓ Native GSTR-9 PDF downloaded for ${periodVal}!`, { filename: res.filename });
  }
}

async function download9cPdf(period) {
  return download(period);
}

async function download9Gstr1SummaryPdf(period) {
  let tabId = (currentActiveTabId && currentActiveTabId > 0) ? currentActiveTabId : null;
  if (!tabId) {
    const tabs = await new Promise(resolve => chrome.tabs.query({ active: true, currentWindow: true }, resolve));
    tabId = tabs && tabs[0] ? tabs[0].id : null;
  }
  const periodVal = (typeof period === 'object' && period) ? (period.value || period.rtnprd) : period;
  console.log(`[ReturnPilot GSTR-9] Initiating GSTR-1 Summary PDF for period: ${periodVal}...`);
  addCopilotLog(`Initiating GSTR-1 Summary PDF for period: ${periodVal}...`, 'info');
  const res = await processAsync({
    request: 'download-pdf-via-angular-gstr9',
    period: periodVal,
    finYr: (typeof session !== 'undefined' && session?.finYear) || '',
    gstin: (typeof session !== 'undefined' && session && session.gstin) || '',
    docType: 'GSTR1_SUMMARY',
    tabId: tabId
  }, 60000);
  if (!res || !res.success) {
    throw new Error(res ? (res.error || 'GSTR-1 Summary PDF download failed') : 'GSTR-1 Summary PDF download failed');
  }
  addCopilotLog(`GSTR-1 Summary PDF downloaded for ${periodVal}!`, 'success');
}

async function download9Gstr3bSummaryPdf(period) {
  let tabId = (currentActiveTabId && currentActiveTabId > 0) ? currentActiveTabId : null;
  if (!tabId) {
    const tabs = await new Promise(resolve => chrome.tabs.query({ active: true, currentWindow: true }, resolve));
    tabId = tabs && tabs[0] ? tabs[0].id : null;
  }
  const periodVal = (typeof period === 'object' && period) ? (period.value || period.rtnprd) : period;
  console.log(`[ReturnPilot GSTR-9] Initiating GSTR-3B Summary PDF for period: ${periodVal}...`);
  addCopilotLog(`Initiating GSTR-3B Summary PDF for period: ${periodVal}...`, 'info');
  const res = await processAsync({
    request: 'download-pdf-via-angular-gstr9',
    period: periodVal,
    finYr: (typeof session !== 'undefined' && session?.finYear) || '',
    gstin: (typeof session !== 'undefined' && session && session.gstin) || '',
    docType: 'GSTR3B_SUMMARY',
    tabId: tabId
  }, 60000);
  if (!res || !res.success) {
    throw new Error(res ? (res.error || 'GSTR-3B Summary PDF download failed') : 'GSTR-3B Summary PDF download failed');
  }
  addCopilotLog(`GSTR-3B Summary PDF downloaded for ${periodVal}!`, 'success');
}

async function downloadStandardExcel(period, excelCfg) {
  if (excelCfg && excelCfg.expFilingStatus === 'FIL' && (period.filingStatus === 'NOT_FILED' || period.filingStatus === 'NF' || period.filingLabel === 'Not Filed' || !period.isValid)) {
    throw new Error(`Period ${period.value} is not filed`);
  }
  const m = await processAsync({ request: 'get', url: gstn.generateFile(excelCfg, period, false) }); if (!m.status) throw new Error('API server handshake dropped');
  const resp = JSON.parse(m.response), status = getFileGenStatus(resp);
  const urls = (resp && resp.data && Array.isArray(resp.data.url)) ? resp.data.url : (resp && resp.data && resp.data.url ? [resp.data.url] : []);
  if (!status && urls.length && urls[0]) { 
    // Strict 7-day expiry enforcement: Auto-trigger generation if file is >= 7 days old
    const fileDateStr = resp?.data?.date || resp?.data?.gendt || resp?.data?.gen_dt || '';
    const fileTimeStr = resp?.data?.time || '';
    const fileTimeStampStr = resp?.data?.timeStamp || '';
    const fileTs = parseGstnDateTime(fileDateStr, fileTimeStr, fileTimeStampStr);
    const isExpired = isGstnFileStale(period, fileTs);
    if (isExpired) {
      const is2X = (excelCfg?.key === 'G2X' || excelCfg?.key === 'G2XEXL' || excelCfg?.apiCode === 'GSTR2X');
      if (is2X) {
        console.warn(`[ReturnPilot] TDS/TCS Excel file is >= 7 days old.`);
      } else {
        const daysOld = Math.round((Date.now() - fileTs) / 86400000);
        console.warn(`[ReturnPilot] ⚠️ [${period.month}] Excel file is ${daysOld} days old (>= 7 days). Auto-triggering fresh generation...`);
        logTelemetry(period.month, `[${period.value}] ⏳ Excel file expired (${daysOld} days old >= 7 days) on download click. Auto-triggering fresh generation...`);
        await generate(period, 'Auto-Generating…');
        throw new Error('Generating…');
      }
    }

    // On-demand live verification
    const isLive = await checkLiveFileValidity(urls[0]);
    if (!isLive) {
      const is2X = (excelCfg?.key === 'G2X' || excelCfg?.key === 'G2XEXL' || excelCfg?.apiCode === 'GSTR2X');
      if (is2X) {
        throw new Error("Excel file link expired on portal. Click 'Generate' to request a new file.");
      }
      console.warn(`[ReturnPilot] Excel file URL expired (404). Auto-triggering fresh generation...`);
      await generate(period, 'Auto-Generating…');
      throw new Error('Generating…');
    }

    for (let i = 0; i < urls.length; i++) { 
      await saveBlobUrl(makeZipFileName(excelCfg.fileNameCode, session.gstin, period.value, excelCfg.fileTypeCode) + '.zip', urls[i]); 
    } 

    if (fileDateStr) {
      period.genDate = fileDateStr;
      period.genTime = fileTimeStr;
      period.currentState = RETURN_STATES.AVAILABLE;
      const key = periodCacheKey(excelCfg.key, session.finYear, period.value);
      if (!periodStateCache[key]) periodStateCache[key] = {};
      periodStateCache[key].genDate = fileDateStr;
      periodStateCache[key].genTime = fileTimeStr;
      clearGenerationTimestamp(key);
      saveStableState(period);
      const dJs = getElement(`json-status-${period.value}`);
      if (dJs) showGenTime(dJs, fileDateStr, fileTimeStr || '');
    }
  }
  else { 
    if (status === 'Generating file...' || (status && (status.toLowerCase().includes('progress') || status.toLowerCase().includes('generating')))) { 
      const key = periodCacheKey(excelCfg.key, session.finYear, period.value); 
      if (!periodStateCache[key]) periodStateCache[key] = {}; 
      periodStateCache[key].generationTriggeredAt = Date.now(); 
      saveGenerationTimestamp(key, Date.now()); 
      if (excelCfg.key === configR2AExcel.key) {
        const jsonKey = periodCacheKey(configR2A.key, session.finYear, period.value);
        if (!periodStateCache[jsonKey]) periodStateCache[jsonKey] = {};
        periodStateCache[jsonKey].generationTriggeredAt = Date.now();
        saveGenerationTimestamp(jsonKey, Date.now());
      }
      showGeneratingBanner(); 
      period.currentState = RETURN_STATES.GENERATING; 
      period.currentMessage = 'Generating…'; 
      const d = getElement(`json-status-${period.value}`); 
      if (d) setStatusPill(d, 'Generating…', 'rt-status-warn'); 
      syncRowActions(period); 
      rerenderRowActions(period);
      startFileGenBackgroundPoller(period, excelCfg);
      throw new Error('Generating…'); 
    } 

    const is2X = (excelCfg?.key === 'G2X' || excelCfg?.key === 'G2XEXL' || excelCfg?.apiCode === 'GSTR2X');
    if (is2X) {
      throw new Error("Excel file not generated on GST Portal. Click 'Generate' first.");
    }

    // Auto-trigger generation on GST portal if not yet initiated (for standard returns only)
    const key = periodCacheKey(excelCfg.key, session.finYear, period.value); 
    if (!periodStateCache[key]) periodStateCache[key] = {}; 
    periodStateCache[key].generationTriggeredAt = Date.now(); 
    saveGenerationTimestamp(key, Date.now()); 
    if (excelCfg.key === configR2AExcel.key) {
      const jsonKey = periodCacheKey(configR2A.key, session.finYear, period.value);
      if (!periodStateCache[jsonKey]) periodStateCache[jsonKey] = {};
      periodStateCache[jsonKey].generationTriggeredAt = Date.now();
      saveGenerationTimestamp(jsonKey, Date.now());
    }
    showGeneratingBanner(); 
    period.currentState = RETURN_STATES.GENERATING; 
    period.currentMessage = 'Generating…'; 
    const d = getElement(`json-status-${period.value}`); 
    if (d) setStatusPill(d, 'Generating…', 'rt-status-warn'); 
    syncRowActions(period); 
    rerenderRowActions(period);
    try {
      await processAsync({ request: 'get', url: gstn.generateFile(excelCfg, period, true), bypassCache: true });
    } catch (_) {}
    startFileGenBackgroundPoller(period, excelCfg);
    throw new Error('Generating…'); 
  }
}

async function download(period) {
  if (session.return && (session.return.workflowType === WORKFLOW_TYPES.IMS_PORTAL || session.return.key === 'IMS')) {
    return downloadImsJson(period);
  }
  if (session.return && session.return.expFilingStatus === 'FIL' && (period.filingStatus === 'NOT_FILED' || period.filingStatus === 'NF' || period.filingLabel === 'Not Filed' || !period.isValid)) {
    throw new Error(`Period ${period.month || period.value} is not filed`);
  }

  // 1. Nil Return Guard: If already confirmed as Nil Filed, don't query /generate
  if (period.isNil || period.filingLabel === 'Nil Filed' || period.filingStatus === 'NIL_FILED') {
    throw new Error('Nil Return Filed — No transaction files available');
  }

  // 2. Pre-probe GSTR-1 formdetails to catch unflagged Nil returns before attempting generateFile
  if (session.return && session.return.key === configR1.key && !period.isNil) {
    try {
      const mDetails = await processAsync({ request: 'get', url: gstn.gstr1FormDetails(period) });
      if (mDetails && mDetails.status && mDetails.response) {
        const fdData = JSON.parse(mDetails.response)?.data || {};
        if (fdData.isnil === 'Y' || String(fdData.isnil).toUpperCase() === 'Y') {
          period.isNil = true;
          period.filingLabel = 'Nil Filed';
          period.filingStatus = 'NIL_FILED';
          period.currentState = RETURN_STATES.AVAILABLE;
          period.currentMessage = '—';
          if (fdData.arn) period.arn = fdData.arn;
          if (fdData.fil_dt) period.fil_dt = fdData.fil_dt;

          const dFil = getElement(`filing-status-${period.value}`);
          const dJs = getElement(`json-status-${period.value}`);
          if (dFil) setStatusPill(dFil, 'Nil Filed', 'rt-status-filed');
          if (dJs) {
            setStatusPill(dJs, '—', 'rt-status-na');
            dJs.title = fdData.arn ? `Nil Return Filed (ARN: ${fdData.arn}) — No transaction files` : 'Nil Return Filed — No transaction files';
          }
          const key = periodCacheKey(session.return.key, session.finYear, period.value);
          clearGenerationTimestamp(key);
          saveStableState(period);
          rerenderRowActions(period);
          throw new Error('Nil Return Filed — No transaction files available');
        }
      }
    } catch (eNil) {
      if (eNil.message.includes('Nil Return Filed')) throw eNil;
    }
  }

  const m = await processAsync({ request: 'get', url: gstn.generateFile(session.return, period, false) }); 
  if (!m.status) throw new Error('API server handshake dropped');
  
  let resp = {};
  try {
    resp = typeof m.response === 'string' ? JSON.parse(m.response) : (m.response || {});
  } catch (_) {
    resp = {};
  }

  const fStatus = getFileGenStatus(resp);
  const dataStatus = (resp && resp.data && typeof resp.data.status !== 'undefined') ? Number(resp.data.status) : -1;
  const urls = (resp && resp.data && Array.isArray(resp.data.url)) 
    ? resp.data.url 
    : (resp && resp.data && resp.data.url ? [resp.data.url] : []);

  // 3. If file is in progress, generating, or not ready yet:
  const isGeneratingStatus = (fStatus && (fStatus.toLowerCase().includes('progress') || fStatus.toLowerCase().includes('generating') || fStatus.toLowerCase().includes('take'))) || dataStatus === 1;

  if (isGeneratingStatus) {
    const key = periodCacheKey(session.return.key, session.finYear, period.value);
    if (!periodStateCache[key]) periodStateCache[key] = {};
    periodStateCache[key].generationTriggeredAt = Date.now();
    saveGenerationTimestamp(key, Date.now());
    if (session.return.key === configR2A.key) {
      const excelKey = periodCacheKey(configR2AExcel.key, session.finYear, period.value);
      if (!periodStateCache[excelKey]) periodStateCache[excelKey] = {};
      periodStateCache[excelKey].generationTriggeredAt = Date.now();
      saveGenerationTimestamp(excelKey, Date.now());
    }
    showGeneratingBanner(); 
    period.currentState = RETURN_STATES.GENERATING; 
    period.currentMessage = 'Generating…'; 
    const d = getElement(`json-status-${period.value}`); 
    if (d) setStatusPill(d, 'Generating…', 'rt-status-warn'); 
    syncRowActions(period); 
    startFileGenBackgroundPoller(period, session.return);
    throw new Error('Generating…');
  }

  // 4. If urls not available (e.g. file never generated on portal, expired, or resp.data undefined):
  if (!urls.length || !urls[0]) {
    // Auto-trigger fresh generation with flag=1
    await generate(period, 'Auto-Generating…');
    throw new Error('Generating…');
  }

  // 5. Strict 7-day expiry enforcement: Auto-trigger generation if file is >= 7 days old
  const fileDateStr = resp?.data?.date || resp?.data?.gendt || resp?.data?.gen_dt || '';
  const fileTimeStr = resp?.data?.time || '';
  const fileTimeStampStr = resp?.data?.timeStamp || '';
  const fileTs = parseGstnDateTime(fileDateStr, fileTimeStr, fileTimeStampStr);
  const isExpired = isGstnFileStale(period, fileTs);
  if (isExpired) {
    const daysOld = Math.round((Date.now() - fileTs) / 86400000);
    console.warn(`[ReturnPilot] ⚠️ [${period.month}] JSON file is ${daysOld} days old (>= 7 days). Auto-triggering fresh generation...`);
    logTelemetry(period.month, `[${period.value}] ⏳ File expired (${daysOld} days old >= 7 days) on download click. Auto-triggering fresh generation...`);
    await generate(period, 'Auto-Generating…');
    throw new Error('Generating…');
  }

  // 6. On-demand live verification (Taxtribute on-click pattern)
  // Auto-regenerates fresh file from GST portal if server URL returns 404 / non-200
  const isLive = await checkLiveFileValidity(urls[0]);
  if (!isLive) {
    console.warn(`[ReturnPilot] Portal file URL returned HTTP 404 (Expired). Auto-triggering fresh generation...`);
    await generate(period, 'Auto-Generating…');
    throw new Error('Generating…');
  }

  for (let i = 0; i < urls.length; i++) {
    const fn = makeZipFileName(session.return.fileNameCode, session.gstin, period.value, session.return.fileTypeCode) + '.zip';
    if (!await saveBlobUrl(fn, urls[i])) throw new Error('Pipeline write block encountered');
  }

  if (fileDateStr) {
    period.genDate = fileDateStr;
    period.genTime = fileTimeStr;
    period.currentState = RETURN_STATES.AVAILABLE;
    period.currentMessage = (fileDateStr && fileTimeStr)
      ? formatRelativeTime(`${fileDateStr} ${fileTimeStr}`)
      : formatRelativeTime(fileDateStr);
    const key = periodCacheKey(session.return.key, session.finYear, period.value);
    if (!periodStateCache[key]) periodStateCache[key] = {};
    periodStateCache[key].genDate = fileDateStr;
    periodStateCache[key].genTime = fileTimeStr;
    clearGenerationTimestamp(key);
    saveStableState(period);
    const dJs = getElement(`json-status-${period.value}`);
    if (dJs) showGenTime(dJs, fileDateStr, fileTimeStr || '');
  }
}

async function generate(period, userMessage) {
  if (session.return && (session.return.workflowType === WORKFLOW_TYPES.IMS_PORTAL || session.return.key === 'IMS')) {
    return generateIms(period);
  }
  if (period.isNil || period.filingLabel === 'Nil Filed' || period.filingStatus === 'NIL_FILED') {
    console.debug(`[ReturnPilot] Bypassing JSON generation for Nil Filed period: ${period.month}`);
    return;
  }
  if (session.return && session.return.key === configR1.key) {
    try {
      const mDetails = await processAsync({ request: 'get', url: gstn.gstr1FormDetails(period) });
      if (mDetails.status) {
        const fdData = JSON.parse(mDetails.response)?.data || {};
        if (fdData.isnil === 'Y' || String(fdData.isnil).toUpperCase() === 'Y') {
          period.isNil = true;
          period.filingLabel = 'Nil Filed';
          period.filingStatus = 'NIL_FILED';
          period.currentState = RETURN_STATES.AVAILABLE;
          period.currentMessage = '—';
          const dFil = getElement(`filing-status-${period.value}`);
          const dJs = getElement(`json-status-${period.value}`);
          if (dFil) setStatusPill(dFil, 'Nil Filed', 'rt-status-filed');
          if (dJs) setStatusPill(dJs, '—', 'rt-status-na');
          const key = periodCacheKey(session.return.key, session.finYear, period.value);
          clearGenerationTimestamp(key);
          saveStableState(period);
          rerenderRowActions(period);
          return;
        }
      }
    } catch (_) {}
  }
  if (typeof ReturnPilotSecurity !== 'undefined') {
    const subState = (typeof currentSubscriptionState !== 'undefined') ? currentSubscriptionState : null;
    const startYear = getSelectedStartYear(period);

    const perm = ReturnPilotSecurity.checkFeatureAccess('JSON', subState, startYear);
    if (!perm.allowed) {
      if (typeof window.showPremiumUpgradeModal === 'function') {
        window.showPremiumUpgradeModal(perm.reason);
      }
      return;
    }
  }
  const d = getElement(`json-status-${period.value}`);
  const is2A = session.return && (session.return.key === configR2A.key || session.return.key === configR2AExcel.key);
  if (is2A) {
    showGeneratingBanner();
    period.currentState = RETURN_STATES.GENERATING;
    period.currentMessage = userMessage || 'Generating…';
    period.genDate = null;
    period.genTime = null;
    const btnGen = getElement(`btn-gen-${period.value}`);
    if (btnGen) {
      btnGen.disabled = true;
      btnGen.textContent = 'Generating…';
    }
    if (d) {
      setStatusPill(d, period.currentMessage, 'rt-status-warn');
      d.title = 'GST Portal is compiling return files…';
    }
    syncRowActions(period);
    rerenderRowActions(period);

    const jsonKey = periodCacheKey(configR2A.key, session.finYear, period.value);
    const excelKey = periodCacheKey(configR2AExcel.key, session.finYear, period.value);
    const genNow = Date.now();
    saveGenerationTimestamp(jsonKey, genNow);
    saveGenerationTimestamp(excelKey, genNow);
    if (!periodStateCache[jsonKey]) periodStateCache[jsonKey] = {};
    periodStateCache[jsonKey].generationTriggeredAt = genNow;
    periodStateCache[jsonKey].currentState = RETURN_STATES.GENERATING;
    periodStateCache[jsonKey].genDate = null;
    periodStateCache[jsonKey].genTime = null;
    if (!periodStateCache[excelKey]) periodStateCache[excelKey] = {};
    periodStateCache[excelKey].generationTriggeredAt = genNow;
    periodStateCache[excelKey].currentState = RETURN_STATES.GENERATING;
    periodStateCache[excelKey].genDate = null;
    periodStateCache[excelKey].genTime = null;

    // Trigger BOTH JSON and Excel generation concurrently on GST Portal
    const [mJson, mExcel] = await Promise.allSettled([
      processAsync({ request: 'get', url: gstn.generateFile(configR2A, period, true), bypassCache: true }),
      processAsync({ request: 'get', url: gstn.generateFile(configR2AExcel, period, true), bypassCache: true })
    ]);

    const jsonState = inspectOfflineFileGenResponse(mJson.status === 'fulfilled' ? mJson.value : null);
    const excelState = inspectOfflineFileGenResponse(mExcel.status === 'fulfilled' ? mExcel.value : null);

    if (jsonState.state === 'AVAILABLE' && excelState.state === 'AVAILABLE') {
      const bestDate = jsonState.date || excelState.date || '';
      const bestTime = jsonState.time || excelState.time || '';
      period.genDate = bestDate;
      period.genTime = bestTime;
      period.currentState = RETURN_STATES.AVAILABLE;
      period.currentMessage = (bestDate && bestTime) ? formatRelativeTime(`${bestDate} ${bestTime}`) : (bestDate ? formatRelativeTime(bestDate) : 'Available');
      clearGenerationTimestamp(jsonKey);
      clearGenerationTimestamp(excelKey);
      stopFileGenBackgroundPoller(period);
      saveStableState(period);
      syncRowActions(period);
      rerenderRowActions(period);
      hydrateJsonStatus(period);
      updateBulkPdfButtonState();
      updateBulkGenerateButtonState();
      if (d) showGenTime(d, bestDate, bestTime || '');
      const hasOtherGen = session.periods && session.periods.some(per => per.currentState === RETURN_STATES.GENERATING);
      if (!hasOtherGen) {
        const banner = getElement('banner-generating');
        if (banner) banner.hidden = true;
      }
      return;
    }

    startFileGenBackgroundPoller(period, configR2A);
    return;
  }

  period.currentState = RETURN_STATES.GENERATING;
  period.currentMessage = 'Requesting…';
  period.genDate = null;
  period.genTime = null;
  if (d) setStatusPill(d, 'Requesting…', 'rt-status-warn');
  syncRowActions(period);
  rerenderRowActions(period);

  const m = await processAsync({ request: 'get', url: gstn.generateFile(session.return, period, true) });
  if (!m.status) {
    period.currentState = RETURN_STATES.FAILED;
    period.currentMessage = 'GSTN Processing Error';
    if (d) setStatusPill(d, 'GSTN Processing Error', 'rt-status-error');
    syncRowActions(period);
    rerenderRowActions(period);
    saveStableState(period);
    return;
  }

  let genResp = null;
  try { genResp = JSON.parse(m.response); } catch (_) {}
  const gDataStatus = (genResp && genResp.data && typeof genResp.data.status !== 'undefined') ? Number(genResp.data.status) : -1;
  const gUrls = (genResp && genResp.data && Array.isArray(genResp.data.url)) ? genResp.data.url : (genResp && genResp.data && genResp.data.url ? [genResp.data.url] : []);
  const gMsg = (genResp && genResp.data && genResp.data.msg) ? String(genResp.data.msg).toLowerCase() : '';
  const isAvailableNotice = gMsg.includes('you have downloaded') || gMsg.includes('click on the link');

  // If the portal returns status 0 with download URL or notice that file is available to download
  if ((gDataStatus === 0 && gUrls.length && gUrls[0]) || isAvailableNotice) {
    const fDate = genResp?.data?.date || genResp?.data?.gendt || genResp?.data?.gen_dt || '';
    const fTime = genResp?.data?.time || '';
    period.genDate = fDate;
    period.genTime = fTime;
    period.currentState = RETURN_STATES.AVAILABLE;
    period.currentMessage = (fDate && fTime) ? formatRelativeTime(`${fDate} ${fTime}`) : (fDate ? formatRelativeTime(fDate) : 'Available');
    period.isValid = true;

    const key = periodCacheKey(session.return.key, session.finYear, period.value);
    if (!periodStateCache[key]) periodStateCache[key] = {};
    periodStateCache[key].genDate = fDate;
    periodStateCache[key].genTime = fTime;
    periodStateCache[key].currentState = RETURN_STATES.AVAILABLE;
    periodStateCache[key].currentMessage = period.currentMessage;
    clearGenerationTimestamp(key);
    stopFileGenBackgroundPoller(period);

    saveStableState(period);
    syncRowActions(period);
    rerenderRowActions(period);
    hydrateJsonStatus(period);
    updateBulkPdfButtonState();
    updateBulkGenerateButtonState();
    if (d) {
      if (fDate) showGenTime(d, fDate, fTime || '');
      else setStatusPill(d, 'Available', 'rt-status-filed');
    }
    const hasOtherGen = session.periods && session.periods.some(per => per.currentState === RETURN_STATES.GENERATING);
    if (!hasOtherGen) {
      const banner = getElement('banner-generating');
      if (banner) banner.hidden = true;
    }
    return;
  }
  
  showGeneratingBanner();
  period.currentState = RETURN_STATES.GENERATING;
  period.currentMessage = userMessage || 'Generating…';
  period.genDate = null;
  period.genTime = null;
  if (d) setStatusPill(d, period.currentMessage, 'rt-status-warn');
  syncRowActions(period);
  rerenderRowActions(period);

  // Cache the forced generation request timestamp to prevent stale portal cache overwrites
  const key = periodCacheKey(session.return.key, session.finYear, period.value);
  if (!periodStateCache[key]) periodStateCache[key] = {};
  const genNow = Date.now();
  periodStateCache[key].generationTriggeredAt = genNow;
  periodStateCache[key].currentState = RETURN_STATES.GENERATING;
  periodStateCache[key].currentMessage = userMessage || 'Generating…';
  periodStateCache[key].genDate = null;
  periodStateCache[key].genTime = null;
  saveGenerationTimestamp(key, genNow);
  startFileGenBackgroundPoller(period, session.return);
}

async function generateIms(period) {
  if (typeof ReturnPilotSecurity !== 'undefined') {
    const subState = (typeof currentSubscriptionState !== 'undefined') ? currentSubscriptionState : null;
    const startYear = getSelectedStartYear(period);

    const perm = ReturnPilotSecurity.checkFeatureAccess('JSON', subState, startYear);
    if (!perm.allowed) {
      if (typeof window.showPremiumUpgradeModal === 'function') {
        window.showPremiumUpgradeModal(perm.reason);
      }
      return;
    }
  }

  // Prevent rapid multi-clicks on Generate
  const key = periodCacheKey(session.return ? session.return.key : 'IMS', session.finYear, period.value);
  const now = Date.now();
  const cachedTs = getSavedGenerationTimestamp(key);
  if (cachedTs && (now - cachedTs < 4000) && period.currentState === RETURN_STATES.GENERATING) {
    addCopilotLog(`IMS [${period.value}]: Generation already queued on GST portal.`, 'info');
    showGeneratingBanner();
    return;
  }

  period.currentState = RETURN_STATES.GENERATING;
  period.currentMessage = 'Requesting…';
  const d = getElement(`json-status-${period.value}`);
  if (d) setStatusPill(d, 'Requesting…', 'rt-status-warn');
  syncRowActions(period);

  // Trigger IMS Doc Generation on GST Portal (flag=1) for both Excel and JSON offline
  const [mExcel, mJson] = await Promise.allSettled([
    processAsync({ request: 'get', url: gstn.imsGenerateExcel(true) }),
    processAsync({ request: 'get', url: gstn.imsGenerateJson(true) })
  ]);

  const m = (mExcel.status === 'fulfilled' && mExcel.value?.status) ? mExcel.value : ((mJson.status === 'fulfilled' && mJson.value?.status) ? mJson.value : null);

  if (!m || !m.status) {
    period.currentState = RETURN_STATES.FAILED;
    period.currentMessage = 'GSTN Processing Error';
    if (d) setStatusPill(d, 'GSTN Processing Error', 'rt-status-error');
    syncRowActions(period);
    rerenderRowActions(period);
    saveStableState(period);
    return;
  }

  let resp;
  try { resp = JSON.parse(m.response); } catch (_) {}
  const msg = resp?.data?.msg || 'Request accepted for generation';
  const token = resp?.data?.token || '';
  addCopilotLog(`IMS [${period.value}]: ${msg}${token ? ` (Token: ${token})` : ''}`, 'success');

  showGeneratingBanner();
  period.currentState = RETURN_STATES.GENERATING;
  period.currentMessage = 'Generating…';
  if (d) setStatusPill(d, 'Generating…', 'rt-status-warn');

  if (!periodStateCache[key]) periodStateCache[key] = {};
  periodStateCache[key].generationTriggeredAt = now;
  periodStateCache[key].currentState = RETURN_STATES.GENERATING;
  periodStateCache[key].currentMessage = 'Generating…';
  saveGenerationTimestamp(key, now);
  saveStableState(period);

  syncRowActions(period);
  rerenderRowActions(period);
  startImsBackgroundPoller(period);
}

async function updateRow(period, renderId) {
  if (isRequestStale(renderId)) return;
  const reqCtx = (renderId && typeof renderId === 'object') ? renderId : createRequestContext(period, 'STATUS', renderId);
  const expectedReturnKey = reqCtx.expectedReturnKey;
  const expectedFinYear = reqCtx.expectedFinYear;
  const tStart = performance.now();
  const dFil = getElement(`filing-status-${period.value}`), dJs = getElement(`json-status-${period.value}`); if (!dFil) return;
  logTelemetry(period.month, `[${period.value}] 🚀 Starting live status checks`);

  // -- IMS: portal is source of truth (same principle as GSTR-1) --
  if (session.return && (session.return.workflowType === WORKFLOW_TYPES.IMS_PORTAL || session.return.key === 'IMS')) {
    setReturnState(period, RETURN_STATES.CHECKING, 'Checking...');

    const [mExcel, mJson] = await Promise.allSettled([
      processAsync({ request: 'get', url: gstn.imsGenerateExcel(false), bypassCache: true }),
      processAsync({ request: 'get', url: gstn.imsGenerateJson(false), bypassCache: true })
    ]);

    if (isRequestStale(reqCtx)) return;

    const tIms = Math.round(performance.now() - tStart);

    let respExcel = null, respJson = null;
    if (mExcel.status === 'fulfilled' && mExcel.value?.status) {
      try { respExcel = JSON.parse(mExcel.value.response); } catch (_) {}
    }
    if (mJson.status === 'fulfilled' && mJson.value?.status) {
      try { respJson = JSON.parse(mJson.value.response); } catch (_) {}
    }

    if (!respExcel && !respJson) {
      setStatusPill(dFil, 'Error', 'rt-status-error');
      period.filingLabel = 'Error';
      period.currentState = RETURN_STATES.FAILED;
      period.currentMessage = 'GSTN Processing Error';
      saveStableState(period);
      rerenderRowActions(period);
      logTelemetry(period.month, `[${period.value}] ✖ IMS check failed in ${tIms}ms`);
      return;
    }

    function extractImsUrl(data) {
      if (!data) return null;
      if (Array.isArray(data.url) && data.url.length > 0 && data.url[0]) return data.url[0];
      if (typeof data.url === 'string' && data.url.trim().length > 0) return data.url.trim();
      return null;
    }

    const hasExcel = Boolean(Number(respExcel?.data?.status) === 0 && extractImsUrl(respExcel?.data));
    const hasJson  = Boolean(Number(respJson?.data?.status) === 0 && extractImsUrl(respJson?.data));

    period.hasExcel = hasExcel;
    period.hasJson = hasJson;
    period.excelGenerating = !hasExcel && (Number(respExcel?.data?.status) === 1 || Boolean(period.excelGenerating));
    period.jsonGenerating  = !hasJson  && (Number(respJson?.data?.status) === 1 || Boolean(period.jsonGenerating));

    setStatusPill(dFil, 'Available', 'rt-status-filed');
    period.filingLabel = 'Available';
    period.filingStatus = 'AUTOGN';
    period.isValid = true;

    const activeResp = (hasJson && respJson) ? respJson : ((hasExcel && respExcel) ? respExcel : (respJson || respExcel));
    const fileDateStr = activeResp?.data?.date || activeResp?.data?.gendt || activeResp?.data?.gen_dt || '';
    const fileTimeStr = activeResp?.data?.time || '';

    if (hasJson || hasExcel) {
      const fileTs = parseGstnDateTime(fileDateStr, fileTimeStr);
      const isExpired = isGstnFileStale(period, fileTs);

      if (isExpired) {
        const daysOld = Math.round((Date.now() - fileTs) / 86400000);
        console.warn(`[ReturnPilot Row] ⚠️ [${period.month}] IMS file is ${daysOld} days old (>= 7 days). Auto-triggering fresh generation...`);
        logTelemetry(period.month, `[${period.value}] ⏳ IMS file expired (${daysOld} days old >= 7 days). Auto-triggering fresh generation...`);
        await generateIms(period);
        return;
      }

      period.genDate = fileDateStr;
      period.genTime = fileTimeStr;
      period.currentState = RETURN_STATES.AVAILABLE;
      period.currentMessage = (period.genDate && period.genTime)
        ? formatRelativeTime(`${period.genDate} ${period.genTime}`)
        : (period.genDate ? formatRelativeTime(period.genDate) : 'Available');
      saveStableState(period);
      rerenderRowActions(period);
      syncRowActions(period);
      hydrateJsonStatus(period);
      logTelemetry(period.month, `[${period.value}] ✔ IMS available (JSON: ${hasJson ? 'Yes' : 'No'}, Excel: ${hasExcel ? 'Yes' : 'No'}) in ${tIms}ms`);
    } else {
      const isActivelyGenerating = Boolean(period.excelGenerating || period.jsonGenerating);
      if (isActivelyGenerating) {
        showGeneratingBanner();
        period.currentState = RETURN_STATES.GENERATING;
        period.currentMessage = 'Generating…';
        if (dJs) setStatusPill(dJs, 'Generating…', 'rt-status-warn');
        rerenderRowActions(period);
        syncRowActions(period);
        startImsBackgroundPoller(period);
        logTelemetry(period.month, `[${period.value}] ⏳ IMS generating in ${tIms}ms`);
      } else {
        period.currentState = RETURN_STATES.NOT_GENERATED;
        period.currentMessage = 'Not Generated';
        period.genDate = null;
        period.genTime = null;
        if (dJs) setStatusPill(dJs, 'Not Generated', 'rt-status-warn');
        saveStableState(period);
        rerenderRowActions(period);
        syncRowActions(period);
        logTelemetry(period.month, `[${period.value}] ℹ IMS not generated yet in ${tIms}ms`);
      }
    }
    return;
  }
  
  console.log(`%c[ReturnPilot Row] 🔍 [${period.month} (${period.value})] Check started: returnKey='${session.return?.key}', apiCode='${session.return?.apiCode}'`, 'color:#0284c7;font-weight:bold;');
  
  const mNum = parseInt(period.value.substring(0, 2)), isM1orM2 = mNum % 3 !== 0;

  // Bypass returns that are strictly quarterly forms by definition (e.g. GSTR-4 / GSTR-4A)
  if (isM1orM2 && session.return.isQuarterly) {
    period.currentState = RETURN_STATES.NO_DATA;
    period.currentMessage = '—';
    period.filingLabel = 'Quarterly';
    period.filingStatus = 'NOT_APPLICABLE';
    period.isValid = false;
    period.genDate = null;
    period.genTime = null;
    setStatusPill(dFil, 'Quarterly', 'rt-status-na');
    if (dJs) setStatusPill(dJs, '—', 'rt-status-na');
    const cb = document.querySelector(`.period-cb[data-period="${period.value}"]`);
    if (cb) {
      cb.checked = false;
      cb.disabled = true;
      cb.title = "Quarterly return — not applicable for M1/M2";
      cb.style.cursor = "not-allowed";
    }
    syncMasterCheckbox();
    saveStableState(period);
    rerenderRowActions(period);
    hydrateJsonStatus(period);
    logTelemetry(period.month, `[${period.value}] M1/M2 Quarterly bypass applied in ${Math.round(performance.now() - tStart)}ms`);
    return;
  }
  if (session.return.key === configR2B.key || session.return.key === configR2BExcel.key) { 
    await updateRowFor2B(period, dFil, dJs, reqCtx); 
    logTelemetry(period.month, `[${period.value}] GSTR-2B row finished in ${Math.round(performance.now() - tStart)}ms`);
    return; 
  }
  if (session.return.key === configR1.key || session.return.key === configR1Excel.key) { 
    await updateRowForGSTR1(period, dFil, dJs, reqCtx); 
    logTelemetry(period.month, `[${period.value}] GSTR-1 row finished in ${Math.round(performance.now() - tStart)}ms`);
    return; 
  }
  if (session.return.key === configR2A.key || session.return.key === configR2AExcel.key) {
    await updateRowFor2A(period, dFil, dJs, reqCtx);
    logTelemetry(period.month, `[${period.value}] GSTR-2A row finished in ${Math.round(performance.now() - tStart)}ms`);
    return;
  }
  if (session.return.key === configR2X.key || session.return.key === configR2XExcel.key) {
    await updateRowFor2X(period, dFil, dJs, reqCtx);
    logTelemetry(period.month, `[${period.value}] TDS/TCS row finished in ${Math.round(performance.now() - tStart)}ms`);
    return;
  }

  const hasBrokerCache = StatusBroker.has(period, session.return.isAnnual);
  if (!hasBrokerCache) {
    if (!period.filingLabel || period.filingLabel === 'Checking…') {
      setStatusPill(dFil, 'Checking…', 'rt-status-loading');
    }
    if (period.currentState !== RETURN_STATES.AVAILABLE && period.currentState !== RETURN_STATES.DOWNLOADED) {
      setReturnState(period, RETURN_STATES.CHECKING, 'Checking…');
    }
  }
  const tRoleStart = performance.now();
  const brokerRes = await StatusBroker.fetchRoleStatus(period, session.return.isAnnual);
  let role = brokerRes.role;
  let info = brokerRes.info;
  const tRole = brokerRes.fromCache ? 0 : Math.round(performance.now() - tRoleStart);
  if (brokerRes.fromCache) {
    period._netMs = 0;
  }

  if (isRequestStale(reqCtx)) return;

  if (!role || !role.status) { 
    console.error(`[ReturnPilot Row] ❌ [${period.month}] rolestatus network error:`, role?.error);
    setStatusPill(dFil, 'Error', 'rt-status-error'); period.filingLabel = 'Error'; period.currentState = RETURN_STATES.FAILED; period.currentMessage = 'GSTN Processing Error'; saveStableState(period); rerenderRowActions(period); 
    logTelemetry(period.month, `[${period.value}] ✖ Step 1 /rolestatus network error (${tRole}ms)`);
    return; 
  }
  
  if (!info && role.response) {
    try {
      info = JSON.parse(role.response);
    } catch (err) {
      console.error(`[ReturnPilot Row] ❌ [${period.month}] rolestatus JSON parse error:`, err);
    }
  }

  // Authoritative dynamic frequency preference sync from portal source of truth
  if (info?.data?.userPref) {
    const prefLabel = info.data.userPref === 'Q' ? 'Quarterly' : 'Monthly';
    if (session.filingFrequency !== prefLabel) {
      session.filingFrequency = prefLabel;
    }
    const elF = getElement('filingFreq') || getElement('filingFrequency');
    if (elF && elF.textContent !== prefLabel) {
      elF.textContent = prefLabel;
    }
  }

  const rawMsg = (info?.error?.message || '').toLowerCase();
  const isNoForms = !info || !info.data || rawMsg.includes('no forms') || rawMsg.includes('provided parameters') || rawMsg.includes('not eligible') || rawMsg.includes('not applicable') || rawMsg.includes('not available');

  if (isNoForms) {
    const cleanLabel = session.return.isAnnual ? 'Not Applicable' : 'Not Available';
    console.debug(`[ReturnPilot Row] ℹ️ [${period.month}] No forms/not applicable from portal: ${rawMsg || 'empty data'}`);
    setStatusPill(dFil, cleanLabel, 'rt-status-na');
    if (dJs) setStatusPill(dJs, '—', 'rt-status-na');
    period.filingLabel = cleanLabel;
    period.currentState = RETURN_STATES.NO_DATA;
    period.currentMessage = '—';
    period.filingStatus = 'NOT_AVAIL';
    period.genDate = null;
    period.genTime = null;
    period.isValid = false;
    const cb = document.querySelector(`.period-cb[data-period="${period.value}"]`);
    if (cb) {
      cb.checked = false;
      cb.disabled = true;
      cb.title = "Return not available";
      cb.style.cursor = "not-allowed";
    }
    syncMasterCheckbox();
    saveStableState(period);
    rerenderRowActions(period);
    hydrateJsonStatus(period);
    updateBulkPdfButtonState();
    updateBulkGenerateButtonState();
    logTelemetry(period.month, `[${period.value}] ✔ Step 1: ${cleanLabel} (${tRole}ms) — Complete`);
    return;
  }
  
  const returnInfo = getReturnInfo(info, session.return.apiCode);
  const fStatus = (returnInfo ? returnInfo.status : '').toUpperCase();
  period.filingStatus = fStatus;

  if (typeof rpLog !== 'undefined' && rpLog) {
    rpLog.debug('GSTR3B_API', `[${period.month}] rolestatus: fStatus='${fStatus}', expected='${session.return.expFilingStatus}' (${tRole}ms)`);
  }
  console.log(`%c[ReturnPilot Row] 📊 [${period.month}] rolestatus: fStatus='${fStatus}', expected='${session.return.expFilingStatus}'`, 'color:#6366f1;', { returnInfo });

  if (fStatus !== session.return.expFilingStatus) {
    let l = displayFilingStatus(fStatus);
    // If portal rolestatus for this period confirms userPref is Quarterly and it's a non-quarter-end month (M1/M2), label as Quarterly
    const isQuarterlyPeriod = (info?.data?.userPref === 'Q');
    if (isQuarterlyPeriod && isM1orM2 && (returnInfo?.tileDisable || fStatus === 'NF' || fStatus === 'NOT_APPLICABLE' || fStatus === 'NOT_AVAIL' || fStatus === '' || !returnInfo || returnInfo.status === 'NOT_APPLICABLE')) {
      l = 'Quarterly';
    }
    const isNA = (l === 'Quarterly' || l === 'Not Applicable' || l === 'Not available' || fStatus === 'NOT_APPLICABLE' || fStatus === 'NOT_AVAIL' || fStatus === 'NO_DATA' || fStatus === 'N');
    const pillClass = isNA ? 'rt-status-na' : (l === 'Filed' ? 'rt-status-filed' : 'rt-status-notfiled');
    console.debug(`[ReturnPilot Row] ℹ️ [${period.month}] Filing status '${fStatus}' did not match expected '${session.return.expFilingStatus}'. Status pill set to '${l}'`);
    setStatusPill(dFil, l, pillClass);
    if (dJs) setStatusPill(dJs, '—', 'rt-status-na');
    period.filingLabel = l;
    period.currentState = isNA ? RETURN_STATES.NO_DATA : RETURN_STATES.NOT_GENERATED;
    period.currentMessage = '—';
    period.genDate = null;
    period.genTime = null;
    period.isValid = (l === 'Filed' || (session.return.key === configR9.key && !isNA));

    const cb = document.querySelector(`.period-cb[data-period="${period.value}"]`);
    if (cb) {
      cb.checked = false;
      cb.disabled = true;
      cb.title = "Return not filed yet";
      cb.style.cursor = "not-allowed";
    }
    syncMasterCheckbox();
    saveStableState(period);
    rerenderRowActions(period);
    hydrateJsonStatus(period);
    updateBulkPdfButtonState();
    updateBulkGenerateButtonState();
    logTelemetry(period.month, `[${period.value}] ✔ Step 1: ${l} (${tRole}ms) — Complete`);
    return;
  }

  const fLabel = session.return.key === configR2A.key ? 'Auto-Generated' : 'Filed'; 
  setStatusPill(dFil, fLabel, 'rt-status-filed'); 
  period.filingLabel = fLabel;
  period.isValid = true;
  const cb = document.querySelector(`.period-cb[data-period="${period.value}"]`);
  if (cb) {
    cb.checked = isPreselectedReturn(session.return?.key);
    cb.disabled = false;
    cb.removeAttribute('title');
    cb.style.cursor = "pointer";
  }
  syncMasterCheckbox();
  logTelemetry(period.month, `[${period.value}] ⚡ Step 1: ${fLabel} confirmed (${tRole}ms)`);

  // ── GSTR-3B & GSTR-1A INSTANT RESOLUTION (Direct Live API Fast Path) ──
  if (session.return.key === configR3B.key || session.return.key === configR1A.key) {
    period.currentState = RETURN_STATES.AVAILABLE;
    period.currentMessage = 'Available';
    saveStableState(period);
    rerenderRowActions(period);
    hydrateJsonStatus(period);
    const tTotal = Math.round(performance.now() - tStart);
    console.log(`%c[ReturnPilot Row] ✨ [${period.month}] Resolved ${session.return.key} to AVAILABLE in ${tTotal}ms`, 'color:#16a34a;font-weight:bold;');
    logTelemetry(period.month, `[${period.value}] ✔ ${session.return.key} Filed resolved in ${tTotal}ms — Complete`);
    return;
  }

  // ── GSTR-9 & GSTR-9C LIVE FORM DETAILS & ARN RESOLUTION ──
  if (session.return.isAnnual || session.return.key === configR9.key || session.return.key === configR9C.key) {
    try {
      const mDetails = await processAsync({ request: 'get', url: `https://return.gst.gov.in/returns/auth/api/formdetails?rtn_prd=${encodeURIComponent(period.value)}&rtn_typ=${session.return.apiCode}` });
      if (mDetails.status) {
        const detailsData = JSON.parse(mDetails.response)?.data || {};
        const statusVal = (detailsData.status || fStatus || '').toUpperCase();
        if (statusVal === 'FIL' || statusVal === 'FILED') {
          period.arn = detailsData.arn || '';
          period.fil_dt = detailsData.fil_dt || '';
          period.filingLabel = 'Filed';
          period.filingStatus = 'FIL';
          period.currentState = RETURN_STATES.AVAILABLE;
          period.currentMessage = detailsData.fil_dt ? `Filed ${detailsData.fil_dt}` : 'Filed';
          period.isValid = true;

          const filingText = detailsData.fil_dt ? `Filed (${detailsData.fil_dt})` : 'Filed';
          setStatusPill(dFil, filingText, 'rt-status-filed');
          if (dFil) {
            dFil.title = `ARN: ${detailsData.arn || 'N/A'}\nFiling Date: ${detailsData.fil_dt || 'N/A'}`;
          }
          if (dJs) {
            if (detailsData.arn) {
              setStatusPill(dJs, detailsData.arn, 'rt-status-filed');
              dJs.title = `ARN: ${detailsData.arn}`;
            } else {
              setStatusPill(dJs, 'Available', 'rt-status-filed');
            }
          }

          saveStableState(period);
          rerenderRowActions(period);
          hydrateJsonStatus(period);
          logTelemetry(period.month, `[${period.value}] ✔ ${session.return.display} Filed confirmed with ARN: ${detailsData.arn || 'N/A'}`);
          return;
        } else if (statusVal === 'FRZ' || statusVal === 'SUBMITTED') {
          setStatusPill(dFil, 'Submitted', 'rt-status-warn');
          period.filingLabel = 'Submitted';
          period.filingStatus = 'FRZ';
          period.currentState = RETURN_STATES.AVAILABLE;
          period.currentMessage = 'Submitted';
          period.isValid = true;
          saveStableState(period);
          rerenderRowActions(period);
          hydrateJsonStatus(period);
          return;
        } else {
          setStatusPill(dFil, 'Not Filed', 'rt-status-notfiled');
          if (dJs) setStatusPill(dJs, '—', 'rt-status-na');
          period.filingLabel = 'Not Filed';
          period.filingStatus = 'NOT_FILED';
          period.currentState = RETURN_STATES.NOT_GENERATED;
          period.currentMessage = '—';
          period.genDate = null;
          period.genTime = null;
          period.isValid = (session.return.key === configR9.key);
          saveStableState(period);
          rerenderRowActions(period);
          hydrateJsonStatus(period);
          return;
        }
      } else {
        setStatusPill(dFil, 'Not Filed', 'rt-status-notfiled');
        if (dJs) setStatusPill(dJs, '—', 'rt-status-na');
        period.filingLabel = 'Not Filed';
        period.filingStatus = 'NOT_FILED';
        period.currentState = RETURN_STATES.NOT_GENERATED;
        period.currentMessage = '—';
        period.genDate = null;
        period.genTime = null;
        period.isValid = (session.return.key === configR9.key);
        saveStableState(period);
        rerenderRowActions(period);
        hydrateJsonStatus(period);
        return;
      }
    } catch (e) {
      console.warn('GSTR-9/9C FormDetails check skipped:', e.message);
      setStatusPill(dFil, 'Not Filed', 'rt-status-notfiled');
      if (dJs) setStatusPill(dJs, '—', 'rt-status-na');
      period.filingLabel = 'Not Filed';
      period.filingStatus = 'NOT_FILED';
      period.currentState = RETURN_STATES.NOT_GENERATED;
      period.currentMessage = '—';
      period.genDate = null;
      period.genTime = null;
      period.isValid = (session.return.key === configR9.key);
      saveStableState(period);
      rerenderRowActions(period);
      hydrateJsonStatus(period);
      return;
    }
  }

  period.currentState = RETURN_STATES.AVAILABLE;
  period.currentMessage = 'Available';
  period.isValid = true;
  saveStableState(period);
  rerenderRowActions(period);
  hydrateJsonStatus(period);
  const tTotal = Math.round(performance.now() - tStart);
  logTelemetry(period.month, `[${period.value}] ✨ Row complete in ${tTotal}ms | Ledger: 'Available'`);
}

async function checkLiveFileValidity(url) {
  if (!url) return true;
  const safeUrl = encodeURI(url);
  try {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 1200) : null;
    const headRes = await fetch(safeUrl, { method: 'HEAD', signal: controller ? controller.signal : undefined }).catch(() => null);
    if (timer) clearTimeout(timer);
    if (headRes) {
      if (headRes.status === 404) return false;
      if (headRes.ok || headRes.status === 200 || headRes.status === 304) return true;
    }
    const rangeController = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const rangeTimer = rangeController ? setTimeout(() => rangeController.abort(), 1200) : null;
    const rangeRes = await fetch(safeUrl, { method: 'GET', headers: { 'Range': 'bytes=0-0' }, signal: rangeController ? rangeController.signal : undefined }).catch(() => null);
    if (rangeTimer) clearTimeout(rangeTimer);
    if (rangeRes) {
      if (rangeRes.status === 404) return false;
      if (rangeRes.ok || rangeRes.status === 206 || rangeRes.status === 200) return true;
    }
    return true;
  } catch (_) {
    return true;
  }
}


/**
 * Fetches GSTR-1 /formdetails on demand (ARN, filing date tooltip, and Nil verification).
 */
async function fetchGstr1FormDetails(period, curFil, curJs, renderId, expectedReturnKey, expectedFinYear) {
  if (isRequestStale(renderId)) return;
  if (session.return?.key !== expectedReturnKey || session.finYear !== expectedFinYear) return;
  if (period.arn && period.fil_dt && period.isNil !== undefined) return;

  try {
    const mDetails = await processAsync({ request: 'get', url: gstn.gstr1FormDetails(period) });
    if (isRequestStale(renderId)) return;
    if (session.return?.key !== expectedReturnKey || session.finYear !== expectedFinYear) return;

    let fdResp = null;
    if (mDetails && mDetails.status) {
      try {
        fdResp = JSON.parse(mDetails.response);
      } catch (err) {
        console.warn(`[ReturnPilot GSTR-1] [${period.month}] Formdetails JSON parse warning:`, err);
      }
    }

    const d = fdResp?.data;
    if (d) {
      if (d.gstin && session.gstin !== d.gstin) {
        session.gstin = d.gstin;
        const elG = getElement('businessGstin');
        if (elG && elG.textContent !== d.gstin) elG.textContent = d.gstin;
        try { localStorage.setItem('_rp_current_gstin', d.gstin); } catch (_) {}
      }
      if ((d.bn || d.tradeNam || d.legalName) && (!session.businessName || session.businessName === 'Taxpayer' || session.businessName === 'Active Taxpayer')) {
        session.businessName = d.bn || d.tradeNam || d.legalName;
        const elN = getElement('businessName');
        if (elN) elN.textContent = session.businessName;
      }
      if (d.gstr1IFF?.form === 'IFF' && session.filingFrequency !== 'Quarterly') {
        session.filingFrequency = 'Quarterly';
        const elF = getElement('filingFreq') || getElement('filingFrequency');
        if (elF) elF.textContent = 'Quarterly';
      }

      const isNil = d.isnil === 'Y' || String(d.isnil).toUpperCase() === 'Y';
      const arn = d.arn || '';
      const filDt = d.fil_dt || '';
      period.arn = arn;
      period.fil_dt = filDt;
      period.isNil = isNil;

      if (curFil && (arn || filDt)) {
        curFil.title = `ARN: ${arn || 'N/A'}\nFiling Date: ${filDt || 'N/A'}`;
      }

      const cKey = periodCacheKey(expectedReturnKey, expectedFinYear, period.value);

      if (isNil) {
        period.filingStatus = 'NIL_FILED';
        period.filingLabel = 'Nil Filed';
        setStatusPill(curFil, 'Nil Filed', 'rt-status-filed');
        if (curJs) {
          setStatusPill(curJs, '—', 'rt-status-na');
          curJs.title = arn ? `Nil Return Filed (ARN: ${arn}) — No transaction files` : 'Nil Return Filed — No transaction files';
        }
        period.currentState = RETURN_STATES.AVAILABLE;
        period.currentMessage = '—';
        period.genDate = null;
        period.genTime = null;
        periodStateCache[cKey] = {
          ...periodStateCache[cKey],
          arn,
          fil_dt: filDt,
          isNil: true,
          filingStatus: 'NIL_FILED',
          filingLabel: 'Nil Filed',
          currentState: RETURN_STATES.AVAILABLE,
          currentMessage: '—'
        };
        persistPeriodStateCache();
        saveStableState(period);
        rerenderRowActions(period);
        hydrateJsonStatus(period);
        updateBulkPdfButtonState();
        updateBulkGenerateButtonState();
        if (typeof rpLog !== 'undefined' && rpLog) {
          rpLog.info('GSTR1_BACKGROUND', `[${period.month}] Formdetails enriched: Nil Filed (ARN: ${arn})`);
        }
        return;
      }

      periodStateCache[cKey] = {
        ...periodStateCache[cKey],
        arn,
        fil_dt: filDt,
        isNil: false,
        filingStatus: period.filingStatus || 'FIL',
        filingLabel: period.filingLabel || 'Filed',
        currentState: period.currentState || RETURN_STATES.AVAILABLE,
        currentMessage: period.currentMessage || 'Available'
      };
      persistPeriodStateCache();
      saveStableState(period);
    }
  } catch (err) {
    console.debug(`[ReturnPilot GSTR-1] [${period.month}] Formdetails fetch warning:`, err);
  }
}




async function updateRowForGSTR1(period, dFil, dJs, renderId) {
  if (isRequestStale(renderId)) return;
  const reqCtx = (renderId && typeof renderId === 'object') ? renderId : createRequestContext(period, 'STATUS', renderId);
  const viewInstanceId = reqCtx.viewInstanceId;
  const expectedReturnKey = reqCtx.expectedReturnKey;
  const expectedFinYear = reqCtx.expectedFinYear;
  const tStart = performance.now();

  // ── Nil Filed short-circuit ──────────────────────────────────────────────
  // Nil Filed is immutable — once filed as NIL, the status can never change.
  // If the cache already confirms isNil=true with a valid ARN, skip the live
  // formdetails API call entirely and resolve instantly from cache.
  if (period.isNil && period.arn && (period.filingLabel === 'Nil Filed' || period.filingStatus === 'NIL_FILED' || period.filingStatus === 'FIL')) {
    period.filingStatus = 'NIL_FILED';
    period.isValid = true;
    period.currentState = RETURN_STATES.AVAILABLE;
    period.currentMessage = '—';
    setStatusPill(dFil, 'Nil Filed', 'rt-status-filed');
    if (dFil && (period.arn || period.fil_dt)) {
      dFil.title = `ARN: ${period.arn || 'N/A'}\nFiling Date: ${period.fil_dt || 'N/A'}`;
    }
    if (dJs) setStatusPill(dJs, '—', 'rt-status-na');
    const cb = document.querySelector(`.period-cb[data-period="${period.value}"]`);
    if (cb) { cb.checked = true; cb.disabled = false; cb.removeAttribute('title'); cb.style.cursor = 'pointer'; }
    syncMasterCheckbox();
    rerenderRowActions(period);
    updateBulkPdfButtonState();
    updateBulkGenerateButtonState();
    const tCached = Math.round(performance.now() - tStart);
    console.log(`%c[ReturnPilot GSTR-1] ⚡ [${period.month}] Nil Filed resolved instantly from cache in ${tCached}ms`, 'color:#16a34a;font-weight:bold;');
    logTelemetry(period.month, `[${period.value}] ✔ GSTR-1 Nil Filed (cache hit) resolved in ${tCached}ms — Complete`);
    return;
  }
  // ────────────────────────────────────────────────────────────────────────

  const hasBrokerCache = StatusBroker.has(period, false);
  if (!hasBrokerCache) {
    if (!period.filingLabel || period.filingLabel === 'Checking…') {
      setStatusPill(dFil, 'Checking…', 'rt-status-loading');
    }
    if (period.currentState !== RETURN_STATES.AVAILABLE && period.currentState !== RETURN_STATES.DOWNLOADED) {
      setReturnState(period, RETURN_STATES.CHECKING, 'Checking…');
    }
  }

  const key = periodCacheKey(session.return.key, session.finYear, period.value);
  let isNilKnown = Boolean(period.isNil || period.filingLabel === 'Nil Filed' || period.filingStatus === 'NIL_FILED' || periodStateCache[key]?.isNil);
  const isCandidateLatest = (!isNilKnown && !period.arn && isLatestFiledPeriod(period.value));

  // 🚀 SIMULTANEOUS DUAL-FLIGHT: Fire /formdetails concurrently with /rolestatus for latest period!
  // Both requests fly over the wire simultaneously. Nil Filed status, ARN, and filing date resolve
  // in parallel without waiting sequentially for rolestatus to complete.
  const formDetailsPromise = isCandidateLatest
    ? fetchGstr1FormDetails(period, dFil, dJs, reqCtx, expectedReturnKey, expectedFinYear)
    : null;

  // ── Step 1: Fast Filing Status Check via rolestatus (~85ms) ────────────────
  const tRoleStart = performance.now();
  const brokerRes = await StatusBroker.fetchRoleStatus(period, false);
  let role = brokerRes.role;
  let info = brokerRes.info;
  const tRole = brokerRes.fromCache ? 0 : Math.round(performance.now() - tRoleStart);
  if (brokerRes.fromCache) {
    period._netMs = 0;
  }

  if (isRequestStale(reqCtx)) return;

  if (!info && role && role.status && role.response) {
    try {
      info = JSON.parse(role.response);
    } catch (err) {
      console.error(`[ReturnPilot GSTR-1] ❌ [${period.month}] rolestatus JSON parse error:`, err);
    }
  }

  // Authoritative dynamic frequency preference sync from portal source of truth
  if (info?.data?.userPref) {
    const prefLabel = info.data.userPref === 'Q' ? 'Quarterly' : 'Monthly';
    if (session.filingFrequency !== prefLabel) {
      session.filingFrequency = prefLabel;
      const elF = getElement('filingFreq') || getElement('filingFrequency');
      if (elF) elF.textContent = prefLabel;
    }
  }

  const rawMsg = (info?.error?.message || '').toLowerCase();
  const isNoForms = info && (!info.data || rawMsg.includes('no forms') || rawMsg.includes('provided parameters') || rawMsg.includes('not eligible') || rawMsg.includes('not applicable') || rawMsg.includes('not available'));

  if (isNoForms) {
    const cleanLabel = 'Not Available';
    setStatusPill(dFil, cleanLabel, 'rt-status-na');
    if (dJs) setStatusPill(dJs, '—', 'rt-status-na');
    period.filingLabel = cleanLabel;
    period.currentState = RETURN_STATES.NO_DATA;
    period.currentMessage = '—';
    period.filingStatus = 'NOT_AVAIL';
    period.genDate = null;
    period.genTime = null;
    period.isValid = false;
    const cb = document.querySelector(`.period-cb[data-period="${period.value}"]`);
    if (cb) { cb.checked = false; cb.disabled = true; cb.title = "Return not available"; cb.style.cursor = "not-allowed"; }
    syncMasterCheckbox();
    saveStableState(period);
    rerenderRowActions(period);
    hydrateJsonStatus(period);
    updateBulkPdfButtonState();
    updateBulkGenerateButtonState();
    logTelemetry(period.month, `[${period.value}] ✔ Step 1: ${cleanLabel} (${tRole}ms) — Complete`);
    return;
  }

  const returnInfo = info ? getReturnInfo(info, 'GSTR1') : null;
  const fStatus = (returnInfo ? returnInfo.status : '').toUpperCase();
  if (fStatus) period.filingStatus = fStatus;

  // ── Step 1A: Non-Filed Status Short-Circuit (Instant ~85ms settlement) ───────
  if (info && fStatus && fStatus !== 'FIL' && fStatus !== 'FILED') {
    let l = displayFilingStatus(fStatus);
    const mNum = parseInt(period.value.substring(0, 2), 10);
    const isM1orM2 = (mNum % 3 !== 0);
    const isQuarterlyUser = (info?.data?.userPref === 'Q' || session.filingFrequency === 'Quarterly');

    // QRMP Semantics: For quarterly filers, M1 and M2 filing is strictly optional IFF
    if (isQuarterlyUser && isM1orM2) {
      const rtnSub = (returnInfo?.rtn_subtype || '').toUpperCase();
      if (rtnSub === 'IFF' || fStatus === 'NF' || fStatus === 'NOT_APPLICABLE' || fStatus === 'NOT_AVAIL' || fStatus === '' || !returnInfo || returnInfo.status === 'NOT_APPLICABLE') {
        l = 'Optional (IFF)';
      }
    }
    const isNA = (l === 'Optional (IFF)' || l === 'Quarterly' || l === 'Not Applicable' || l === 'Not available' || fStatus === 'NOT_APPLICABLE' || fStatus === 'NOT_AVAIL' || fStatus === 'NO_DATA' || fStatus === 'N');
    const isSub = (fStatus === 'FRZ' || fStatus === 'SUB' || fStatus === 'SUBMITTED' || l === 'Submitted');
    const pillClass = isNA ? 'rt-status-na' : (isSub ? 'rt-status-warn' : 'rt-status-notfiled');

    setStatusPill(dFil, l, pillClass);
    if (dJs) setStatusPill(dJs, '—', 'rt-status-na');
    period.filingLabel = l;
    period.currentState = isNA ? RETURN_STATES.NO_DATA : (isSub ? RETURN_STATES.AVAILABLE : RETURN_STATES.NOT_GENERATED);
    period.currentMessage = '—';
    period.genDate = null;
    period.genTime = null;
    period.isValid = isSub;

    const cb = document.querySelector(`.period-cb[data-period="${period.value}"]`);
    if (cb) {
      cb.checked = false;
      cb.disabled = true;
      cb.title = isSub ? "Return submitted but not filed" : (isNA ? (l === 'Optional (IFF)' ? "Optional IFF return — not filed" : "Return not available") : "Return not filed yet");
      cb.style.cursor = "not-allowed";
    }
    syncMasterCheckbox();
    saveStableState(period);
    rerenderRowActions(period);
    hydrateJsonStatus(period);
    updateBulkPdfButtonState();
    updateBulkGenerateButtonState();
    logTelemetry(period.month, `[${period.value}] ✔ Step 1: GSTR-1 ${l} confirmed via rolestatus (${tRole}ms) — Complete`);
    return;
  }

  // ── Step 1B: Filed Confirmed Fast-Path (~85ms UI Response) ──────────────────
  // If rolestatus confirmed FIL, immediately promote pill to "Filed" and enable buttons!
  const isRoleFiled = (fStatus === 'FIL' || fStatus === 'FILED');
  if (isRoleFiled) {
    const triggeredAt = getSavedGenerationTimestamp(key);
    const isActivelyGenerating = triggeredAt && (Date.now() - triggeredAt < GEN_TTL);

    period.isValid = true;

    // ── SIMULTANEOUS RESOLUTION: Settle pre-fired /formdetails ───────────────
    // Await the simultaneously running formdetails promise. Because it was fired
    // concurrently at T=0 with rolestatus, it settles here in 0-35ms instead of
    // incurring an extra 150-250ms sequential network roundtrip.
    if (formDetailsPromise) {
      await formDetailsPromise;
      if (isRequestStale(renderId)) return;
      isNilKnown = Boolean(period.isNil || period.filingLabel === 'Nil Filed' || period.filingStatus === 'NIL_FILED' || periodStateCache[key]?.isNil);
    } else if (!isNilKnown && !period.arn && isLatestFiledPeriod(period.value)) {
      await fetchGstr1FormDetails(period, dFil, dJs, reqCtx, expectedReturnKey, expectedFinYear);
      if (isRequestStale(renderId)) return;
      isNilKnown = Boolean(period.isNil || period.filingLabel === 'Nil Filed' || period.filingStatus === 'NIL_FILED' || periodStateCache[key]?.isNil);
    }

    if (isNilKnown) {
      period.isNil = true;
      period.filingStatus = 'NIL_FILED';
      period.filingLabel = 'Nil Filed';
      period.currentState = RETURN_STATES.AVAILABLE;
      period.currentMessage = '—';
      setStatusPill(dFil, 'Nil Filed', 'rt-status-filed');
      if (dJs) setStatusPill(dJs, '—', 'rt-status-na');
    } else {
      period.filingStatus = 'FIL';
      period.filingLabel = 'Filed';
      setStatusPill(dFil, 'Filed', 'rt-status-filed');

      if (isActivelyGenerating) {
        showGeneratingBanner();
        period.currentState = RETURN_STATES.GENERATING;
        period.currentMessage = 'Generating…';
        period.genDate = null;
        period.genTime = null;
        if (dJs) setStatusPill(dJs, 'Generating…', 'rt-status-warn');
        startFileGenBackgroundPoller(period, session.return);
      } else if (period.genDate) {
        period.currentState = RETURN_STATES.AVAILABLE;
        period.currentMessage = (period.genDate && period.genTime)
          ? formatRelativeTime(`${period.genDate} ${period.genTime}`)
          : formatRelativeTime(period.genDate);
        if (dJs) showGenTime(dJs, period.genDate, period.genTime || '');
      } else if (periodStateCache[key]?.genDate) {
        period.genDate = periodStateCache[key].genDate;
        period.genTime = periodStateCache[key].genTime || '';
        period.currentState = RETURN_STATES.AVAILABLE;
        period.currentMessage = (period.genDate && period.genTime)
          ? formatRelativeTime(`${period.genDate} ${period.genTime}`)
          : formatRelativeTime(period.genDate);
        if (dJs) showGenTime(dJs, period.genDate, period.genTime || '');
      } else {
        period.currentState = RETURN_STATES.CHECKING;
        period.currentMessage = 'Checking…';
        if (dJs) setStatusPill(dJs, 'Checking…', 'rt-status-loading');
      }
    }

    if (dFil && (period.arn || period.fil_dt)) {
      dFil.title = `ARN: ${period.arn || 'N/A'}\nFiling Date: ${period.fil_dt || 'N/A'}`;
    }

    const cb = document.querySelector(`.period-cb[data-period="${period.value}"]`);
    if (cb) {
      cb.checked = true;
      cb.disabled = false;
      cb.removeAttribute('title');
      cb.style.cursor = 'pointer';
    }
    syncMasterCheckbox();
    saveStableState(period);
    rerenderRowActions(period);
    hydrateJsonStatus(period);
    updateBulkPdfButtonState();
    updateBulkGenerateButtonState();

    // Background JSON generation status/timestamp validation via /offline/download/generate?flag=0
    if (!period.isNil) {
      processAsync({ request: 'get', url: gstn.generateFile(session.return, period, false) })
        .then(pRes => {
          if (!pRes || !pRes.status) return;
          try {
            const pData = JSON.parse(pRes.response);
            const pUrls = (pData && pData.data && Array.isArray(pData.data.url)) ? pData.data.url : (pData && pData.data && pData.data.url ? [pData.data.url] : []);
            const pMsg = (pData?.data?.msg || '').toLowerCase();
            const isDownloadNotice = pMsg.includes('you have downloaded') || pMsg.includes('click on the link');

            if (pData?.data?.status === 0 && (pUrls.length || isDownloadNotice || pData?.data?.date || pData?.data?.gendt || pData?.data?.gen_dt)) {
              const pDate = pData.data.date || pData.data.gendt || pData.data.gen_dt || '';
              const pTime = pData.data.time || '';
              period.genDate = pDate;
              period.genTime = pTime;
              period.currentState = RETURN_STATES.AVAILABLE;
              period.currentMessage = (pDate && pTime) ? formatRelativeTime(`${pDate} ${pTime}`) : (pDate ? formatRelativeTime(pDate) : 'Available');
              period.isValid = true;
              stopFileGenBackgroundPoller(period);
              clearGenerationTimestamp(key);
              if (!periodStateCache[key]) periodStateCache[key] = {};
              periodStateCache[key].genDate = pDate;
              periodStateCache[key].genTime = pTime;
              periodStateCache[key].currentState = RETURN_STATES.AVAILABLE;
              periodStateCache[key].currentMessage = period.currentMessage;
              saveStableState(period);
              rerenderRowActions(period);
              hydrateJsonStatus(period);
              updateBulkPdfButtonState();
              updateBulkGenerateButtonState();
              const curDjs = getElement(`json-status-${period.value}`);
              if (curDjs) {
                if (pDate) showGenTime(curDjs, pDate, pTime);
                else setStatusPill(curDjs, 'Available', 'rt-status-filed');
              }
              const hasOtherGen = session.periods && session.periods.some(per => per.currentState === RETURN_STATES.GENERATING);
              if (!hasOtherGen) {
                const banner = getElement('banner-generating');
                if (banner) banner.hidden = true;
              }
            } else if (pData?.data?.status === 1 || (pData?.error?.errorCode && pData?.error?.errorCode.startsWith('RTN_24')) || pMsg.includes('in progress') || pMsg.includes('generating')) {
              period.currentState = RETURN_STATES.GENERATING;
              period.currentMessage = 'Generating…';
              showGeneratingBanner();
              const curDjs = getElement(`json-status-${period.value}`);
              if (curDjs) setStatusPill(curDjs, 'Generating…', 'rt-status-warn');
              startFileGenBackgroundPoller(period, session.return);
              rerenderRowActions(period);
              hydrateJsonStatus(period);
              updateBulkPdfButtonState();
              updateBulkGenerateButtonState();
            } else {
              // File is NOT generated on GST Portal
              period.currentState = RETURN_STATES.NOT_GENERATED;
              period.currentMessage = 'Not Generated';
              period.genDate = null;
              period.genTime = null;
              stopFileGenBackgroundPoller(period);
              clearGenerationTimestamp(key);
              if (!periodStateCache[key]) periodStateCache[key] = {};
              periodStateCache[key].genDate = null;
              periodStateCache[key].genTime = null;
              periodStateCache[key].currentState = RETURN_STATES.NOT_GENERATED;
              periodStateCache[key].currentMessage = 'Not Generated';
              saveStableState(period);
              rerenderRowActions(period);
              hydrateJsonStatus(period);
              updateBulkPdfButtonState();
              updateBulkGenerateButtonState();
              const curDjs = getElement(`json-status-${period.value}`);
              if (curDjs) {
                setStatusPill(curDjs, 'Not Generated', 'rt-status-warn');
                curDjs.title = 'File not yet generated on GST Portal. Click Generate to create it.';
              }
              const hasOtherGen = session.periods && session.periods.some(per => per.currentState === RETURN_STATES.GENERATING);
              if (!hasOtherGen) {
                const banner = getElement('banner-generating');
                if (banner) banner.hidden = true;
              }
            }
          } catch (_) {}
        })
        .catch(() => {
          if (period.currentState === RETURN_STATES.CHECKING) {
            period.currentState = RETURN_STATES.AVAILABLE;
            period.currentMessage = 'Available';
            const curDjs = getElement(`json-status-${period.value}`);
            if (curDjs) setStatusPill(curDjs, 'Available', 'rt-status-filed');
          }
        });
    }

    const tForeground = Math.round(performance.now() - tStart);
    console.log(`%c[ReturnPilot GSTR-1] ⚡ [${period.month}] Fast-path settled in foreground in ${tForeground}ms (JSON: '${period.currentMessage}')`, 'color:#16a34a;font-weight:bold;');
    const isPriorityEnriched = Boolean(period.arn || period.isNil);
    logTelemetry(period.month, `[${period.value}] ⚡ GSTR-1 Filed confirmed via rolestatus${isPriorityEnriched ? ' + priority formdetails' : ''} (${tRole}ms) — Settled in ${tForeground}ms`);
    if (typeof rpLog !== 'undefined' && rpLog) {
      rpLog.info('GSTR1_FAST_PATH', `[${period.month}] Settled in ${tForeground}ms (JSON: '${period.currentMessage}')`);
    }

    return;
  }

  // ── Inconclusive / Not Available / Error Fallback ───────────────────────────
  if (info && (!returnInfo || !fStatus)) {
    const cleanLabel = 'Not Available';
    setStatusPill(dFil, cleanLabel, 'rt-status-na');
    if (dJs) setStatusPill(dJs, '—', 'rt-status-na');
    period.filingLabel = cleanLabel;
    period.currentState = RETURN_STATES.NO_DATA;
    period.currentMessage = '—';
    period.filingStatus = 'NOT_AVAIL';
    period.genDate = null;
    period.genTime = null;
    period.isValid = false;
    const cb = document.querySelector(`.period-cb[data-period="${period.value}"]`);
    if (cb) { cb.checked = false; cb.disabled = true; cb.title = "Return not available"; cb.style.cursor = "not-allowed"; }
    syncMasterCheckbox();
    saveStableState(period);
    rerenderRowActions(period);
    hydrateJsonStatus(period);
    updateBulkPdfButtonState();
    updateBulkGenerateButtonState();
    logTelemetry(period.month, `[${period.value}] ✔ Step 1: GSTR-1 not available in rolestatus (${tRole}ms) — Complete`);
    return;
  }

  // Network Error / Unreachable
  setStatusPill(dFil, 'Error', 'rt-status-error');
  period.filingLabel = 'Error';
  period.currentState = RETURN_STATES.FAILED;
  period.currentMessage = 'GSTN Processing Error';
  saveStableState(period);
  rerenderRowActions(period);
  hydrateJsonStatus(period);
  logTelemetry(period.month, `[${period.value}] ✖ GSTR-1 rolestatus query failed (${tRole}ms)`);
}

async function updateRowFor2A(period, dFil, dJs, renderId) {
  if (isRequestStale(renderId)) return;
  const reqCtx = (renderId && typeof renderId === 'object') ? renderId : createRequestContext(period, 'STATUS', renderId);
  const viewInstanceId = reqCtx.viewInstanceId;
  const expectedReturnKey = reqCtx.expectedReturnKey;
  const expectedFinYear = reqCtx.expectedFinYear;
  const tStart = performance.now();

  const hasBrokerCache = StatusBroker.has(period, false);
  if (!hasBrokerCache) {
    if (!period.filingLabel || period.filingLabel === 'Checking…') {
      setStatusPill(dFil, 'Checking…', 'rt-status-loading');
    }
    if (period.currentState !== RETURN_STATES.AVAILABLE && period.currentState !== RETURN_STATES.DOWNLOADED) {
      setReturnState(period, RETURN_STATES.CHECKING, 'Checking…');
    }
  }

  // Fast Filing Status Check via rolestatus from StatusBroker (0ms on cache hit)
  const tRoleStart = performance.now();
  const brokerRes = await StatusBroker.fetchRoleStatus(period, false);
  let role = brokerRes.role;
  let info = brokerRes.info;
  const tRole = brokerRes.fromCache ? 0 : Math.round(performance.now() - tRoleStart);
  if (brokerRes.fromCache) {
    period._netMs = 0;
  }

  if (isRequestStale(reqCtx)) return;

  if (!info && role && role.status && role.response) {
    try {
      info = JSON.parse(role.response);
    } catch (err) {
      console.error(`[ReturnPilot GSTR-2A] ❌ [${period.month}] rolestatus JSON parse error:`, err);
    }
  }

  // Authoritative dynamic frequency preference sync from portal source of truth
  if (info?.data?.userPref) {
    const prefLabel = info.data.userPref === 'Q' ? 'Quarterly' : 'Monthly';
    if (session.filingFrequency !== prefLabel) {
      session.filingFrequency = prefLabel;
      const elF = getElement('filingFreq') || getElement('filingFrequency');
      if (elF) elF.textContent = prefLabel;
    }
  }

  const rawMsg = (info?.error?.message || '').toLowerCase();
  const isNoForms = info && (!info.data || rawMsg.includes('no forms') || rawMsg.includes('provided parameters') || rawMsg.includes('not eligible') || rawMsg.includes('not applicable') || rawMsg.includes('not available'));

  if (isNoForms) {
    const cleanLabel = 'Not Available';
    setStatusPill(dFil, cleanLabel, 'rt-status-na');
    if (dJs) setStatusPill(dJs, '—', 'rt-status-na');
    period.filingLabel = cleanLabel;
    period.currentState = RETURN_STATES.NO_DATA;
    period.currentMessage = '—';
    period.filingStatus = 'NOT_AVAIL';
    period.genDate = null;
    period.genTime = null;
    period.isValid = false;
    const cb = document.querySelector(`.period-cb[data-period="${period.value}"]`);
    if (cb) { cb.checked = false; cb.disabled = true; cb.title = "Return not available"; cb.style.cursor = "not-allowed"; }
    syncMasterCheckbox();
    saveStableState(period);
    rerenderRowActions(period);
    hydrateJsonStatus(period);
    updateBulkGenerateButtonState();
    logTelemetry(period.month, `[${period.value}] ✔ Step 1: GSTR-2A ${cleanLabel} (${tRole}ms) — Complete`);
    return;
  }

  const returnInfo = info ? getReturnInfo(info, 'GSTR2A') : null;
  if (returnInfo?.tileDisable) {
    const cleanLabel = 'Not Available';
    setStatusPill(dFil, cleanLabel, 'rt-status-na');
    if (dJs) setStatusPill(dJs, '—', 'rt-status-na');
    period.filingLabel = cleanLabel;
    period.currentState = RETURN_STATES.NO_DATA;
    period.currentMessage = '—';
    period.filingStatus = 'NOT_AVAIL';
    period.isValid = false;
    const cb = document.querySelector(`.period-cb[data-period="${period.value}"]`);
    if (cb) { cb.checked = false; cb.disabled = true; cb.title = "Return not available"; cb.style.cursor = "not-allowed"; }
    syncMasterCheckbox();
    saveStableState(period);
    rerenderRowActions(period);
    hydrateJsonStatus(period);
    updateBulkGenerateButtonState();
    logTelemetry(period.month, `[${period.value}] ✔ Step 1: GSTR-2A tile disabled (${tRole}ms) — Complete`);
    return;
  }

  // GSTR-2A Authoritative Status: Auto-Generated
  const statusLabel = 'Auto-Generated';
  const statusClass = 'rt-status-filed';
  setStatusPill(dFil, statusLabel, statusClass);
  period.filingLabel = statusLabel;
  period.filingStatus = statusLabel;
  period.isValid = true;

  const cb = document.querySelector(`.period-cb[data-period="${period.value}"]`);
  if (cb) {
    cb.checked = isPreselectedReturn(session.return?.key);
    cb.disabled = false;
    cb.removeAttribute('title');
    cb.style.cursor = 'pointer';
  }
  syncMasterCheckbox();

  // JSON & Excel Status Pill resolution (instant UI display with proactive query)
  const jsonKey = periodCacheKey(configR2A.key, session.finYear, period.value);
  const excelKey = periodCacheKey(configR2AExcel.key, session.finYear, period.value);
  const jsonTriggeredAt = getSavedGenerationTimestamp(jsonKey);
  const excelTriggeredAt = getSavedGenerationTimestamp(excelKey);
  const isActivelyGenerating = Boolean(
    (jsonTriggeredAt && (Date.now() - jsonTriggeredAt < GEN_TTL)) ||
    (excelTriggeredAt && (Date.now() - excelTriggeredAt < GEN_TTL))
  );

  let pDate = period.genDate || periodStateCache[jsonKey]?.genDate || periodStateCache[excelKey]?.genDate;
  let pTime = period.genTime || periodStateCache[jsonKey]?.genTime || periodStateCache[excelKey]?.genTime || '';

  // 1. Instant optimistic UI presentation (0ms — zero skeleton flicker)
  if (isActivelyGenerating) {
    showGeneratingBanner();
    period.currentState = RETURN_STATES.GENERATING;
    period.currentMessage = 'Generating…';
    if (dJs) {
      setStatusPill(dJs, 'Generating…', 'rt-status-warn');
      dJs.title = 'GST Portal is compiling return files…';
    }
    startFileGenBackgroundPoller(period, session.return);
  } else if (pDate) {
    period.genDate = pDate;
    period.genTime = pTime;
    period.currentState = RETURN_STATES.AVAILABLE;
    period.currentMessage = (pDate && pTime)
      ? formatRelativeTime(`${pDate} ${pTime}`)
      : formatRelativeTime(pDate);
    if (dJs) showGenTime(dJs, pDate, pTime || '');
  } else {
    period.currentState = RETURN_STATES.CHECKING;
    period.currentMessage = 'Checking…';
    if (dJs) setStatusPill(dJs, 'Checking…', 'rt-status-loading');
  }

  // 2. Authoritative portal generation status check
  // On Refresh, cold uncached load, or active generation, query GST Portal live
  const isRefreshing = Boolean(window._rpIsRefreshing);
  const shouldQueryPortal = Boolean(isRefreshing || !pDate || isActivelyGenerating);

  async function check2aPortalStatus() {
    try {
      const bypass = Boolean(isRefreshing || isActivelyGenerating);
      const [jsonRes, excelRes] = await Promise.allSettled([
        processAsync({ request: 'get', url: gstn.generateFile(configR2A, period, false), bypassCache: bypass }),
        processAsync({ request: 'get', url: gstn.generateFile(configR2AExcel, period, false), bypassCache: bypass })
      ]);

      if (isRequestStale(reqCtx)) return;

      const jsonState = inspectOfflineFileGenResponse(jsonRes.status === 'fulfilled' ? jsonRes.value : null);
      const excelState = inspectOfflineFileGenResponse(excelRes.status === 'fulfilled' ? excelRes.value : null);

      if (jsonState.state === 'GENERATING' || excelState.state === 'GENERATING') {
        period.currentState = RETURN_STATES.GENERATING;
        period.currentMessage = 'Generating…';
        period.genDate = null;
        period.genTime = null;
        showGeneratingBanner();
        if (dJs) {
          setStatusPill(dJs, 'Generating…', 'rt-status-warn');
          dJs.title = 'GST Portal is compiling return files…';
        }
        const genNow = Date.now();
        if (!jsonTriggeredAt) saveGenerationTimestamp(jsonKey, genNow);
        if (!excelTriggeredAt) saveGenerationTimestamp(excelKey, genNow);
        if (!periodStateCache[jsonKey]) periodStateCache[jsonKey] = {};
        periodStateCache[jsonKey].currentState = RETURN_STATES.GENERATING;
        if (!periodStateCache[excelKey]) periodStateCache[excelKey] = {};
        periodStateCache[excelKey].currentState = RETURN_STATES.GENERATING;

        startFileGenBackgroundPoller(period, session.return);
        syncRowActions(period);
        rerenderRowActions(period);
      } else if (jsonState.state === 'AVAILABLE' || excelState.state === 'AVAILABLE') {
        const activeDate = jsonState.date || excelState.date || '';
        const activeTime = jsonState.time || excelState.time || '';
        period.genDate = activeDate;
        period.genTime = activeTime;
        period.currentState = RETURN_STATES.AVAILABLE;
        period.currentMessage = (activeDate && activeTime)
          ? formatRelativeTime(`${activeDate} ${activeTime}`)
          : (activeDate ? formatRelativeTime(activeDate) : 'Generated');

        if (jsonState.state === 'AVAILABLE') clearGenerationTimestamp(jsonKey);
        if (excelState.state === 'AVAILABLE') clearGenerationTimestamp(excelKey);
        stopFileGenBackgroundPoller(period);

        if (!periodStateCache[jsonKey]) periodStateCache[jsonKey] = {};
        periodStateCache[jsonKey].genDate = jsonState.date || activeDate;
        periodStateCache[jsonKey].genTime = jsonState.time || activeTime;
        periodStateCache[jsonKey].currentState = RETURN_STATES.AVAILABLE;
        periodStateCache[jsonKey].currentMessage = period.currentMessage;
        if (!periodStateCache[excelKey]) periodStateCache[excelKey] = {};
        periodStateCache[excelKey].genDate = excelState.date || activeDate;
        periodStateCache[excelKey].genTime = excelState.time || activeTime;
        periodStateCache[excelKey].currentState = RETURN_STATES.AVAILABLE;

        if (dJs) {
          if (activeDate) {
            showGenTime(dJs, activeDate, activeTime);
            dJs.title = `JSON: ${jsonState.state === 'AVAILABLE' ? (jsonState.date + (jsonState.time ? ' ' + jsonState.time : '')) : (jsonState.state === 'GENERATING' ? 'Generating…' : 'Not Generated')}\nExcel: ${excelState.state === 'AVAILABLE' ? (excelState.date + (excelState.time ? ' ' + excelState.time : '')) : (excelState.state === 'GENERATING' ? 'Generating…' : 'Not Generated')}`;
          } else {
            setStatusPill(dJs, 'Generated', 'rt-status-filed');
          }
        }

        const hasOtherGen = session.periods && session.periods.some(p => p.currentState === RETURN_STATES.GENERATING && p.value !== period.value);
        if (!hasOtherGen) {
          const banner = getElement('banner-generating');
          if (banner) banner.hidden = true;
        }

        syncRowActions(period);
        rerenderRowActions(period);
      } else if (jsonState.state === 'TRANSIENT_ERROR' && excelState.state === 'TRANSIENT_ERROR') {
        // Transient server error — keep current optimistic state
      } else {
        // Neither file has been generated on the GST Portal yet!
        period.currentState = RETURN_STATES.NOT_GENERATED;
        period.currentMessage = 'Not Generated';
        period.genDate = null;
        period.genTime = null;
        clearGenerationTimestamp(jsonKey);
        clearGenerationTimestamp(excelKey);
        stopFileGenBackgroundPoller(period);

        if (!periodStateCache[jsonKey]) periodStateCache[jsonKey] = {};
        periodStateCache[jsonKey].genDate = null;
        periodStateCache[jsonKey].genTime = null;
        periodStateCache[jsonKey].currentState = RETURN_STATES.NOT_GENERATED;
        periodStateCache[jsonKey].currentMessage = 'Not Generated';
        if (!periodStateCache[excelKey]) periodStateCache[excelKey] = {};
        periodStateCache[excelKey].genDate = null;
        periodStateCache[excelKey].genTime = null;
        periodStateCache[excelKey].currentState = RETURN_STATES.NOT_GENERATED;

        if (dJs) {
          setStatusPill(dJs, 'Not Generated', 'rt-status-warn');
          dJs.title = 'File not yet generated on GST Portal. Click Generate to create it.';
        }

        const hasOtherGen = session.periods && session.periods.some(p => p.currentState === RETURN_STATES.GENERATING && p.value !== period.value);
        if (!hasOtherGen) {
          const banner = getElement('banner-generating');
          if (banner) banner.hidden = true;
        }

        syncRowActions(period);
        rerenderRowActions(period);
      }

      saveStableState(period);
      hydrateJsonStatus(period);
      updateBulkPdfButtonState();
      updateBulkGenerateButtonState();
    } catch (_) {}
  }

  if (shouldQueryPortal) {
    await check2aPortalStatus();
  } else {
    // Non-blocking background verification to discover any external portal generations
    check2aPortalStatus();
  }

  saveStableState(period);
  rerenderRowActions(period);
  hydrateJsonStatus(period);
  updateBulkGenerateButtonState();

  const tForeground = Math.round(performance.now() - tStart);
  logTelemetry(period.month, `[${period.value}] ⚡ GSTR-2A Auto-Generated settled in foreground in ${tForeground}ms`);
  if (typeof rpLog !== 'undefined' && rpLog) {
    rpLog.info('GSTR2A_FAST_PATH', `[${period.month}] Settled in ${tForeground}ms`);
  }
}



async function updateRowFor2B(period, dFil, dJs, renderId) {
  if (isRequestStale(renderId)) return;
  const reqCtx = (renderId && typeof renderId === 'object') ? renderId : createRequestContext(period, 'STATUS', renderId);
  const expectedReturnKey = reqCtx.expectedReturnKey;
  const expectedFinYear = reqCtx.expectedFinYear;

  setStatusPill(dFil, 'Checking…', 'rt-status-loading'); period.currentState = RETURN_STATES.CHECKING; period.currentMessage = 'Checking…'; syncRowActions(period); if (!period.filingStatus) period.filingStatus = 'NF';

  const res = await fetch2bData(period);
  if (isRequestStale(reqCtx)) return;
  if (!res.ok) {
    try {
      const pInfo = get2bPublishInfo(period), err = (res.error || '').toLowerCase();
      
      // 1. QRMP Non-Quarter-Ending Month (M1/M2) -> Marked as Quarterly
      if (!pInfo.isQuarterEnd && (session.filingFrequency === 'Quarterly' || session.isQuarterly || res.error === 'Access Denied')) {
        setStatusPill(dFil, 'Quarterly', 'rt-status-na');
        period.filingLabel = 'Quarterly';
        period.currentState = RETURN_STATES.NO_DATA;
        period.currentMessage = '—';
        if (dJs) setStatusPill(dJs, '—', 'rt-status-na');
        saveStableState(period);
        rerenderRowActions(period);
        hydrateJsonStatus(period);
        return;
      }
      
      /* Fixed string resolution ensures text fits inside container rules without trimming */
      if (pInfo.isBeforePublishDate) {
        setStatusPill(dFil, 'Pending', 'rt-status-warn');
        period.filingLabel = 'Pending';
        period.currentState = RETURN_STATES.NOT_GENERATED;
        period.currentMessage = `Releases 14 ${pInfo.monthName}`;
        saveStableState(period);
        rerenderRowActions(period);
        hydrateJsonStatus(period);
        return;
      }

      // 3. Zero Inward ITC / No Supplier Records (GSTN GTR2B-002)
      if (res.code === 'GTR2B-002' || err.includes('gtr2b-002') || res.error === 'No Data' || err.includes('no record for gstr 2b') || err.includes('no record')) {
        setStatusPill(dFil, 'No ITC', 'rt-status-na');
        period.filingLabel = 'No ITC';
        period.currentState = RETURN_STATES.NO_DATA;
        period.currentMessage = '—';
        period.isValid = false;
        period.r2bCachedData = null;
        if (dJs) setStatusPill(dJs, '—', 'rt-status-na');
        saveStableState(period);
        rerenderRowActions(period);
        hydrateJsonStatus(period);
        return;
      }

      // 4. Portal Auth Required
      if (res.error === 'Access Denied') {
        setStatusPill(dFil, 'Access Denied', 'rt-status-error');
        period.filingLabel = 'Access Denied';
        period.currentState = RETURN_STATES.FAILED;
        period.currentMessage = 'Portal Auth Required';
        if (dJs) setStatusPill(dJs, '—', 'rt-status-na');
        saveStableState(period);
        rerenderRowActions(period);
        hydrateJsonStatus(period);
        return;
      }

      // 5. Explicit Previous GSTR-3B Not Filed Blocking (outside generic GTR2B-002)
      if ((err.includes('non-filing') || err.includes('not filed') || err.includes('previous') || err.includes('last return period')) && err.includes('3b')) {
        setStatusPill(dFil, 'Blocked', 'rt-status-error');
        period.filingLabel = 'Blocked';
        period.currentState = RETURN_STATES.NOT_GENERATED;
        period.currentMessage = 'Prev GSTR-3B Owed';
        saveStableState(period);
        rerenderRowActions(period);
        hydrateJsonStatus(period);
        return;
      }

      // 6. Genuine IMS Pending Action / Recompute
      if (err.includes('recompute') || err.includes('re-compute') || (err.includes('ims') && !err.includes('gtr2b-002'))) {
        setStatusPill(dFil, 'Action Needed', 'rt-status-warn');
        period.filingLabel = 'Action Needed';
        period.currentState = RETURN_STATES.NOT_GENERATED;
        period.currentMessage = 'IMS Pending Action';
        saveStableState(period);
        rerenderRowActions(period);
        hydrateJsonStatus(period);
        return;
      }

      if (err.includes('no data') || !res.data || err.includes('valid gst data')) {
        setStatusPill(dFil, 'Delayed', 'rt-status-warn');
        period.filingLabel = 'Delayed';
        period.currentState = RETURN_STATES.NOT_GENERATED;
        period.currentMessage = 'Awaiting GSTN Post';
        saveStableState(period);
        rerenderRowActions(period);
        hydrateJsonStatus(period);
        return;
      }

      setStatusPill(dFil, 'Error', 'rt-status-error');
      period.filingLabel = 'Error';
      period.currentState = RETURN_STATES.FAILED;
      period.currentMessage = 'GSTN Pipeline Error';
      saveStableState(period);
      rerenderRowActions(period);
      hydrateJsonStatus(period);
      return;
    } catch (e) {
      setStatusPill(dFil, 'Invalid Period', 'rt-status-error');
      period.filingLabel = 'Invalid Period';
      period.currentState = RETURN_STATES.FAILED;
      period.currentMessage = e.message;
      saveStableState(period);
      rerenderRowActions(period);
      hydrateJsonStatus(period);
      return;
    }
  }

  setStatusPill(dFil, 'Auto-Generated', 'rt-status-filed'); period.filingLabel = 'Auto-Generated'; period.r2bCachedData = res.data; period.r2bRawData = res.raw; period.r2bSource = res.source; period.currentState = RETURN_STATES.AVAILABLE; period.currentMessage = res.data.gendt || 'Available'; period.isValid = true;
  const cb = document.querySelector(`.period-cb[data-period="${period.value}"]`);
  if (cb) {
    cb.checked = isPreselectedReturn(session.return?.key);
    cb.disabled = false;
    cb.removeAttribute('title');
    cb.style.cursor = 'pointer';
  }
  syncMasterCheckbox();
  saveStableState(period); rerenderRowActions(period); hydrateJsonStatus(period);
}

// ── GSTR-2X (TDS/TCS Credit Received) Row Update & Download Handlers ─────────
async function updateRowFor2X(period, dFil, dJs, renderId) {
  if (isRequestStale(renderId)) return;
  const reqCtx = (renderId && typeof renderId === 'object') ? renderId : createRequestContext(period, 'STATUS', renderId);
  const tStart = performance.now();

  const key = periodCacheKey(session.return.key, session.finYear, period.value);
  const cached = periodStateCache[key];
  const hasKnownStatus = (period.filingLabel && period.filingLabel !== 'Checking…') || (period.currentState === RETURN_STATES.AVAILABLE) || (cached && cached.filingLabel);

  // 1. Optimistic UI: If status is already known from cache, DO NOT wipe to "Checking…" or disable buttons!
  if (!hasKnownStatus) {
    setStatusPill(dFil, 'Checking…', 'rt-status-loading');
    period.currentState = RETURN_STATES.CHECKING;
    period.currentMessage = 'Checking…';
    syncRowActions(period);
  }

  try {
    // 2. Fetch live TDS & TCS record count & role status concurrently via StatusBroker (0ms on cache hit)
    const brokerRes = await StatusBroker.fetch2xStatus(period);
    if (isRequestStale(reqCtx)) return;

    if (brokerRes.fromCache) {
      period._netMs = 0;
    }

    const isFiled = brokerRes.isFiled;
    const filedStatus = isFiled ? 'Filed' : 'Not Filed';
    const due_dt = brokerRes.due_dt || '';
    const totalRecords = brokerRes.totalRecords || 0;

    period.due_dt = due_dt;
    period.filingStatus = isFiled ? 'FIL' : 'NF';
    period.filingLabel = filedStatus;
    period.gstr2xRecordCount = totalRecords;

    if (isFiled) {
      setStatusPill(dFil, 'Filed', 'rt-status-filed');
      if (due_dt) dFil.title = `Due Date: ${due_dt}`;
    } else {
      setStatusPill(dFil, 'Not Filed', 'rt-status-notfiled');
      if (due_dt) dFil.title = `Due Date: ${due_dt}`;
    }

    // Check if user previously triggered generation and it is still within TTL
    const triggeredAt = getSavedGenerationTimestamp(key);
    const isActivelyGenerating = triggeredAt && (Date.now() - triggeredAt < GEN_TTL);

    let pDate = period.genDate || periodStateCache[key]?.genDate;
    const hasData = (totalRecords > 0) || isFiled;

    if (isActivelyGenerating) {
      showGeneratingBanner();
      period.currentState = RETURN_STATES.GENERATING;
      period.currentMessage = 'Generating…';
      if (dJs) {
        setStatusPill(dJs, 'Generating…', 'rt-status-warn');
        dJs.title = 'GST Portal is generating the native Excel file…';
      }
      startFileGenBackgroundPoller(period, session.return);
    } else {
      // Portal Status shows Available or Not Available strictly based on whether we have invoices/records
      period.currentState = RETURN_STATES.AVAILABLE;
      if (hasData) {
        period.currentMessage = 'Available';
        if (dJs) {
          setStatusPill(dJs, 'Available', 'rt-status-filed');
          dJs.title = `${totalRecords} TDS/TCS record${totalRecords > 1 ? 's' : ''} available${pDate ? ' (Native Excel generated: ' + pDate + ')' : ''}`;
        }
      } else {
        period.currentMessage = 'Not Available';
        if (dJs) {
          setStatusPill(dJs, 'Not Available', 'rt-status-na');
          dJs.title = 'No TDS/TCS credit records found for this period';
        }
      }
    }

    period.isValid = hasData;
    const cb = document.querySelector(`.period-cb[data-period="${period.value}"]`);
    if (cb) {
      if (hasData) {
        cb.disabled = false;
        cb.removeAttribute('title');
        cb.style.cursor = 'pointer';
      } else {
        cb.checked = false;
        cb.disabled = true;
        cb.title = 'No TDS/TCS records available for this period';
        cb.style.cursor = 'not-allowed';
      }
    }
    syncMasterCheckbox();
    saveStableState(period);
    rerenderRowActions(period);
    hydrateJsonStatus(period);

    const tTotal = Math.round(performance.now() - tStart);
    logTelemetry(period.month, `[${period.value}] ✔ TDS/TCS row complete in ${tTotal}ms (Cache: ${brokerRes.fromCache ? 'Yes' : 'No'}, Recs: ${totalRecords})`);
  } catch (err) {
    if (isRequestStale(reqCtx)) return;
    console.error(`[ReturnPilot Row] ❌ [${period.month}] updateRowFor2X error:`, err);
    setStatusPill(dFil, 'Error', 'rt-status-error');
    period.filingLabel = 'Error';
    period.currentState = RETURN_STATES.FAILED;
    period.currentMessage = 'GSTN Processing Error';
    saveStableState(period);
    rerenderRowActions(period);
  }
}

async function download2xJson(period) {
  const gstin = (typeof session !== 'undefined' && session && session.gstin) || '';
  const prd = period.value;

  const [tdsRes, tcsRes, tdsaRes, tcsaRes] = await Promise.all([
    processAsync({ request: 'get', url: gstn.gstr2xTds(prd) }).catch(() => null),
    processAsync({ request: 'get', url: gstn.gstr2xTcs(prd) }).catch(() => null),
    processAsync({ request: 'get', url: gstn.gstr2xTdsa(prd) }).catch(() => null),
    processAsync({ request: 'get', url: gstn.gstr2xTcsa(prd) }).catch(() => null)
  ]);

  const parseResp = (m) => {
    if (!m || !m.status || !m.response) return null;
    try {
      const j = JSON.parse(m.response);
      return j.data || null;
    } catch (_) { return null; }
  };

  const tdsData = parseResp(tdsRes);
  const tcsData = parseResp(tcsRes);
  const tdsaData = parseResp(tdsaRes);
  const tcsaData = parseResp(tcsaRes);

  const payload = {
    gstin: gstin,
    fp: prd,
    tds: tdsData?.processed?.tds || tdsData?.tds || [],
    tcs: tcsData?.processed?.tcs || tcsData?.tcs || [],
    tdsa: tdsaData?.processed?.tdsa || tdsaData?.tdsa || [],
    tcsa: tcsaData?.processed?.tcsa || tcsaData?.tcsa || []
  };

  const totalRecs = payload.tds.length + payload.tcs.length + payload.tdsa.length + payload.tcsa.length;
  if (totalRecs === 0 && (!period.filingStatus || period.filingStatus === 'NF')) {
    throw new Error('No TDS/TCS Credit records found for this period');
  }

  const jsonStr = JSON.stringify(payload, null, 2);
  const fileName = `returns_R2X_${gstin}_${prd}.json`;
  if (!saveJsonFile(fileName, jsonStr)) {
    throw new Error('Local file serialization blocked');
  }
}

async function download2xExcel(period) {
  return downloadStandardExcel(period, configR2XExcel);
}

function applyNotApplicableLogic() {
  if (!session.periods || session.periods.length === 0 || session.return.isAnnual) return;
  if (session.return && (session.return.key === 'G2X' || session.return.key === 'G2XEXL' || session.return.key === 'IMS')) return;
  let lastIndex = -1; for (let i = session.periods.length - 1; i >= 0; i--) { if (session.periods[i].filingStatus === session.return.expFilingStatus) { lastIndex = i; break; } }
  if (lastIndex === -1) return;

  for (let i = 0; i < lastIndex; i++) {
    const p = session.periods[i], mNum = parseInt(p.value.substring(0, 2)), isM1orM2 = mNum % 3 !== 0;
    if (session.filingFrequency === 'Quarterly' && session.return.key === configR1.key && isM1orM2) continue;
    if (p.filingStatus === session.return.expFilingStatus || [RETURN_STATES.AVAILABLE, RETURN_STATES.NOT_GENERATED, RETURN_STATES.GENERATING, RETURN_STATES.FAILED].includes(p.currentState) || ['Not Applicable', 'Quarter-End Generation', 'Quarterly', 'Quarter End', 'No ITC', 'No Data'].includes(p.filingLabel)) continue;

    p.filingLabel = 'Not Applicable'; p.currentState = RETURN_STATES.NO_DATA; p.currentMessage = '—'; p.isValid = false; saveStableState(p);
    const d = getElement(`filing-status-${p.value}`); if (d) setStatusPill(d, 'Not Applicable', 'rt-status-na');
    const pCb = document.querySelector(`.period-cb[data-period="${p.value}"]`);
    if (pCb) {
      pCb.checked = false;
      pCb.disabled = true;
      pCb.title = 'Not applicable';
      pCb.style.cursor = 'not-allowed';
    }
    syncMasterCheckbox();
    rerenderRowActions(p); hydrateJsonStatus(p);
  }
}

async function downloadAll() {
  if (typeof rpLog !== 'undefined' && rpLog) {
    rpLog.userAction('BULK_JSON_START', `User started Bulk JSON download for ${session.return?.key || ''} (FY ${session.finYear})`, {
      returnKey: session.return?.key,
      finYear: session.finYear,
      gstin: session.gstin
    });
  }
  if (typeof ReturnPilotSecurity !== 'undefined') {
    const subState = (typeof currentSubscriptionState !== 'undefined') ? currentSubscriptionState : null;
    const startYear = getSelectedStartYear();

    const perm = ReturnPilotSecurity.checkFeatureAccess('JSON', subState, startYear);
    if (!perm.allowed) {
      window.showPremiumUpgradeModal(perm.reason);
      return;
    }
  }

  const b = getElement('btn-download-all');
  const origText = b ? b.textContent.trim() : 'JSON All';
  const targets = (session.periods || []).filter(p => 
    p.isValid && p.currentState !== RETURN_STATES.GENERATING && !p.isNil && p.filingLabel !== 'Nil Filed' && p.filingStatus !== 'NIL_FILED'
  );
  let doneCount = 0;
  const totalCount = targets.length;
  if (b) {
    b.disabled = true;
    b.textContent = totalCount > 0 ? `JSON (0/${totalCount})…` : 'JSON All';
  }

  isBulkOperationRunning = true;
  try {
    for (const p of targets) { 
      const btn = getElement(`btn-download-${p.value}`); 
      if (btn && !btn.hidden && !btn.disabled) { 
        try { 
          await btn.onclick(); 
        } catch (e) {
          if (typeof rpLog !== 'undefined' && rpLog && typeof rpLog.error === 'function') {
            rpLog.error('BULK_ROW_ERROR', `Bulk JSON row failed for ${p.month || p.value}: ${e.message}`, {
              period: p.value,
              month: p.month,
              error: e.message,
              stack: e.stack
            });
          }
        } 
      } 
      doneCount++;
      if (b && totalCount > 0) b.textContent = `JSON (${doneCount}/${totalCount})…`;
    }
  } finally {
    isBulkOperationRunning = false;
    if (b) {
      b.textContent = origText;
      b.disabled = false;
    }
  }
}

async function downloadAllPdfs(mode) {
  if (typeof rpLog !== 'undefined' && rpLog) {
    rpLog.userAction('BULK_PDF_START', `User started Bulk PDF (${mode || 'summary'}) download for ${session.return?.key || ''} (FY ${session.finYear})`, {
      returnKey: session.return?.key,
      finYear: session.finYear,
      gstin: session.gstin,
      mode: mode || 'summary'
    });
  }
  if (typeof ReturnPilotSecurity !== 'undefined') {
    const subState = (typeof currentSubscriptionState !== 'undefined') ? currentSubscriptionState : null;
    const perm = ReturnPilotSecurity.checkFeatureAccess('PDF', subState);
    if (!perm.allowed) {
      window.showPremiumUpgradeModal(perm.reason);
      return;
    }
  }

  const b = getElement(mode === 'detail' ? 'btn-pdf-detail-all' : 'btn-pdf-summary-all'); 
  const origText = b ? b.textContent.trim() : (mode === 'detail' ? 'Detail PDF All' : 'PDF All');
  const targets = (session.periods || []).filter(p => p.isValid);
  let doneCount = 0;
  const totalCount = targets.length;
  const returnName = (session.return && session.return.display) ? session.return.display : 'PDF';
  console.log(`%c[ReturnPilot Bulk PDF] Starting ${returnName} (${mode}) batch download for ${totalCount} valid periods`, 'color: #3b82f6; font-weight: bold;');
  if (typeof rpLog !== 'undefined' && rpLog && typeof rpLog.info === 'function') {
    rpLog.info('BULK_PDF', `Starting ${returnName} (${mode}) batch download for ${totalCount} valid periods`);
  }

  if (b) {
    b.disabled = true;
    b.textContent = totalCount > 0 ? `PDF (0/${totalCount})…` : origText;
  }
  isBulkOperationRunning = true;
  try {
    for (const p of targets) { 
      if (!p.isValid) continue; 
      const btn = getElement(`btn-pdf-${mode}-${p.value}`); 
      const periodLabel = p.month || p.value;
      if (btn && !btn.hidden && !btn.disabled) { 
        if (b && totalCount > 0) b.textContent = `PDF (${periodLabel} - ${doneCount + 1}/${totalCount})…`;
        console.log(`%c[ReturnPilot Bulk PDF] [${doneCount + 1}/${totalCount}] Starting download for period: ${periodLabel} (${p.value})...`, 'color: #3b82f6;');
        if (typeof rpLog !== 'undefined' && rpLog && typeof rpLog.info === 'function') {
          rpLog.info('BULK_PDF', `[${doneCount + 1}/${totalCount}] Starting download for period: ${periodLabel} (${p.value})`);
        }
        try { 
          // Strictly wait for the current month's PDF download to finish before advancing
          await btn.onclick(); 
          console.log(`%c[ReturnPilot Bulk PDF] [${doneCount + 1}/${totalCount}] ✓ Completed period: ${periodLabel} (${p.value})`, 'color: #10b981;');
          if (typeof rpLog !== 'undefined' && rpLog && typeof rpLog.info === 'function') {
            rpLog.info('BULK_PDF', `[${doneCount + 1}/${totalCount}] ✓ Completed period: ${periodLabel} (${p.value})`);
          }
          // Yield to event loop without artificial delay - let GST server response speed govern throughput
          await new Promise(r => setTimeout(r, 0));
        } catch (e) {
          console.error(`[ReturnPilot Bulk PDF] ❌ Batch download failed for period: ${periodLabel} (${p.value})`, e);
          if (typeof rpLog !== 'undefined' && rpLog && typeof rpLog.error === 'function') {
            rpLog.error('BULK_PDF', `❌ Batch download failed for period: ${periodLabel} (${p.value})`, { error: e.message });
          }
        } 
      } 
      doneCount++;
      if (b && totalCount > 0) b.textContent = `PDF (${doneCount}/${totalCount})…`;
    }
    console.log(`%c[ReturnPilot Bulk PDF] ✓ Batch download finished (${doneCount}/${totalCount} processed)`, 'color: #10b981; font-weight: bold;');
    if (typeof rpLog !== 'undefined' && rpLog && typeof rpLog.info === 'function') {
      rpLog.info('BULK_PDF', `✓ Batch download finished (${doneCount}/${totalCount} processed)`);
    }
  } finally {
    isBulkOperationRunning = false;
    if (b) {
      b.textContent = origText;
      b.disabled = false;
    }
  }
}

async function downloadAllExcels() {
  if (session.return && (session.return.key === 'G2X' || session.return.key === configR2X.key || session.return.key === configR2XExcel.key || session.return.key === 'G3B' || session.return.key === configR3B.key)) {
    return downloadConsolidatedExcel();
  }
  if (typeof rpLog !== 'undefined' && rpLog) {
    rpLog.userAction('BULK_EXCEL_START', `User started Bulk Excel download for ${session.return?.key || ''} (FY ${session.finYear})`, {
      returnKey: session.return?.key,
      finYear: session.finYear,
      gstin: session.gstin
    });
  }
  if (typeof ReturnPilotSecurity !== 'undefined') {
    const subState = (typeof currentSubscriptionState !== 'undefined') ? currentSubscriptionState : null;
    const perm = ReturnPilotSecurity.checkFeatureAccess('EXCEL', subState);
    if (!perm.allowed) {
      window.showPremiumUpgradeModal(perm.reason);
      return;
    }
  }

  const b = getElement('btn-excel-all');
  const origText = b ? b.textContent.trim() : 'Excel All';
  const targets = (session.periods || []).filter(p => p.isValid && !p.isNil && p.filingLabel !== 'Nil Filed' && p.filingStatus !== 'NIL_FILED');
  let doneCount = 0;
  const totalCount = targets.length;
  if (b) {
    b.disabled = true;
    b.textContent = totalCount > 0 ? `Excel (0/${totalCount})…` : 'Excel All';
  }
  isBulkOperationRunning = true;
  try {
    for (const p of targets) {
      const btn = getElement(`btn-excel-${p.value}`);
      if (btn && !btn.hidden && !btn.disabled) {
        try {
          await btn.onclick();
          // Yield to event loop without artificial delay - let GST server response speed govern throughput
          await new Promise(r => setTimeout(r, 0));
        } catch (e) {
          console.error('Batch Excel download failed for period:', p.value, e);
          if (typeof rpLog !== 'undefined' && rpLog && typeof rpLog.error === 'function') {
            rpLog.error('BULK_ROW_ERROR', `Bulk Excel row failed for ${p.month || p.value}: ${e.message}`, {
              period: p.value,
              month: p.month,
              error: e.message,
              stack: e.stack
            });
          }
        }
      }
      doneCount++;
      if (b && totalCount > 0) b.textContent = `Excel (${doneCount}/${totalCount})…`;
    }
  } finally {
    isBulkOperationRunning = false;
    if (b) {
      b.textContent = origText;
      b.disabled = false;
    }
  }
}

async function resolvePartyNames(uniqueCtins) {
  const partyMap = {};
  if (!uniqueCtins || uniqueCtins.length === 0) return partyMap;

  const isBadPartyName = (val) => {
    if (!val || typeof val !== 'string') return true;
    const clean = val.trim().toLowerCase();
    return clean === '' || clean === 'na' || clean === 'n/a' || clean === 'null' || clean === 'undefined' || clean === '-' || clean === '.';
  };

  const extractPartyName = (data) => {
    if (!data) return '';
    const trade = data.tradeNam || data.trade_name || data.trdnm || '';
    const legal = data.lgnm || data.legal_name || data.legalName || data.cname || data.bname || '';
    // If tradeNam is NA, use lgnm
    if (!isBadPartyName(trade)) return trade.trim();
    if (!isBadPartyName(legal)) return legal.trim();
    return '';
  };

  const cached = await new Promise(r => chrome.storage.local.get(['rp_gstin_party_cache'], res => r(res?.rp_gstin_party_cache || {})));
  const toFetch = [];

  for (const ctin of uniqueCtins) {
    if (!ctin || ctin === 'URP') continue;
    if (cached[ctin] && !isBadPartyName(cached[ctin])) {
      partyMap[ctin] = cached[ctin].trim();
    } else {
      delete cached[ctin];
      toFetch.push(ctin);
    }
  }

  if (toFetch.length === 0) return partyMap;

  // Concurrent batch resolution (up to 8 in parallel)
  const BATCH_SIZE = 8;
  for (let i = 0; i < toFetch.length; i += BATCH_SIZE) {
    const batch = toFetch.slice(i, i + BATCH_SIZE);
    await Promise.allSettled(batch.map(async (ctin) => {
      try {
        let name = '';
        // 1. Primary: Official GSTN Portal Taxpayer Search (POST publicservices)
        const res1 = await bgFetch({
          url: 'https://publicservices.gst.gov.in/publicservices/auth/api/search/tp',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json;charset=UTF-8',
            'Accept': 'application/json, text/plain'
          },
          body: JSON.stringify({ gstin: ctin })
        });
        if (res1 && res1.status && res1.response) {
          try {
            const parsed = JSON.parse(res1.response);
            name = extractPartyName(parsed.data || parsed);
          } catch (_) {}
        }
        // 2. Fallback: services.gst.gov.in search API
        if (!name) {
          const res2 = await bgFetch(`https://services.gst.gov.in/services/api/search/taxpayerDetails?gstin=${encodeURIComponent(ctin)}`);
          if (res2 && res2.status && res2.response) {
            try {
              const parsed = JSON.parse(res2.response);
              name = extractPartyName(parsed.data || parsed);
            } catch (_) {}
          }
        }
        if (name) {
          partyMap[ctin] = name;
          cached[ctin] = name;
        }
      } catch (_) {}
    }));
  }

  try {
    chrome.storage.local.set({ rp_gstin_party_cache: cached });
  } catch (_) {}

  return partyMap;
}

function formatConsolidatedPeriodRange(targetPeriods) {
  if (!targetPeriods || targetPeriods.length === 0) return 'All';
  if (targetPeriods.length === 12) return 'FullYear';

  const SHORT_MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const startVal = targetPeriods[0].value;
  const endVal = targetPeriods[targetPeriods.length - 1].value;
  const startM = parseInt(startVal.slice(0, 2), 10);
  const endM = parseInt(endVal.slice(0, 2), 10);

  // Detect standard quarters (Q1: Apr-Jun, Q2: Jul-Sep, Q3: Oct-Dec, Q4: Jan-Mar)
  if (targetPeriods.length === 3) {
    if (startM === 4 && endM === 6) return 'Q1';
    if (startM === 7 && endM === 9) return 'Q2';
    if (startM === 10 && endM === 12) return 'Q3';
    if (startM === 1 && endM === 3) return 'Q4';
  }

  if (targetPeriods.length === 1) {
    return SHORT_MONTHS[startM] || startVal.slice(0, 2);
  }

  const startName = SHORT_MONTHS[startM] || startVal.slice(0, 2);
  const endName = SHORT_MONTHS[endM] || endVal.slice(0, 2);
  return `${startName}-${endName}`;
}

async function downloadConsolidatedExcel() {
  const cfg = session.return;
  if (!cfg) return;

  const isSales = (cfg.key === 'G1' || cfg.key === 'G1A');
  const isPurchase = (cfg.key === 'G2B');
  const isTdsTcs = (cfg.key === 'G2X' || cfg.key === configR2X.key || cfg.key === configR2XExcel.key);
  const isG3b = (cfg.key === 'G3B' || cfg.key === configR3B.key);
  if (!isSales && !isPurchase && !isTdsTcs && !isG3b) return;

  const finYear = (typeof session !== 'undefined' && session && session.finYear) ? session.finYear : (getElement('finYear')?.value || '2026-27');
  const returnName = (cfg && (cfg.name || cfg.label || cfg.key)) || 'this return';

  if (typeof rpLog !== 'undefined' && rpLog) {
    rpLog.userAction('CONSOLIDATED_EXCEL_START', `User started Consolidated Excel export for ${session.return?.key || ''} (FY ${finYear})`, {
      returnKey: session.return?.key,
      finYear: finYear,
      gstin: session.gstin
    });
  }

  // 1. License & Feature Gate
  if (typeof ReturnPilotSecurity !== 'undefined') {
    const subState = (typeof currentSubscriptionState !== 'undefined') ? currentSubscriptionState : null;
    const perm = ReturnPilotSecurity.checkFeatureAccess('CONSOLIDATED_EXCEL', subState);
    if (!perm.allowed) {
      if (typeof window.showPremiumUpgradeModal === 'function') {
        window.showPremiumUpgradeModal(perm.reason || 'Consolidated Annual Reports require an active ReturnPilot Premium License.');
      } else {
        showBannerNotice(`⚠️ ${perm.reason || 'Consolidated Annual Reports require Premium License.'}`, 6000);
      }
      return;
    }
  }

  // Lazy-load heavy OpenXML workbook builders & fflate on demand
  await loadScriptAsync('../lib/fflate.js');
  await loadScriptAsync('../core/xlsx-builder.js');
  await Promise.all([
    loadScriptAsync('../core/consolidated-sales-builder.js'),
    loadScriptAsync('../core/consolidated-purchase-builder.js'),
    loadScriptAsync('../core/consolidated-tds-tcs-builder.js'),
    loadScriptAsync('../core/consolidated-gstr3b-builder.js')
  ]);

  // 2. Identify Selected Months
  const checkedBoxes = Array.from(document.querySelectorAll('.period-cb:checked'));
  let targetPeriods = [];
  if (checkedBoxes.length > 0) {
    const selectedVals = new Set(checkedBoxes.map(cb => cb.dataset.period));
    targetPeriods = session.periods.filter(p => selectedVals.has(p.value));
  } else {
    targetPeriods = session.periods.slice();
  }

  // Strictly filter target periods to only filed / valid periods
  if (isSales) {
    targetPeriods = targetPeriods.filter(p => {
      const fStatus = (p.filingStatus || '').toUpperCase();
      const fLabel = (p.filingLabel || '').toUpperCase();
      return fStatus === 'FIL' || fStatus === 'FILED' || fStatus === 'NIL_FILED' || fLabel === 'FILED' || fLabel === 'NIL FILED' || p.isNil;
    });
  } else if (isPurchase) {
    targetPeriods = targetPeriods.filter(p => {
      const fStatus = (p.filingStatus || '').toUpperCase();
      const fLabel = (p.filingLabel || '').toUpperCase();
      return (fStatus === 'ACT' || fLabel === 'PUBLISHED' || p.currentState === RETURN_STATES.AVAILABLE) && fStatus !== 'NOT_APPLICABLE' && fLabel !== 'NOT APPLICABLE';
    });
  } else if (isTdsTcs) {
    targetPeriods = targetPeriods.filter(p => {
      const count = p.gstr2xRecordCount ?? (p.filingStatus === 'FIL' ? 1 : 0);
      return count > 0 || p.isValid || p.currentState === RETURN_STATES.AVAILABLE || p.filingStatus === 'FIL' || p.filingLabel === 'Filed';
    });
    if (targetPeriods.length === 0 && checkedBoxes.length > 0) {
      const selectedVals = new Set(checkedBoxes.map(cb => cb.dataset.period));
      targetPeriods = session.periods.filter(p => selectedVals.has(p.value));
    }
  } else if (isG3b) {
    targetPeriods = targetPeriods.filter(p => {
      const fStatus = (p.filingStatus || '').toUpperCase();
      const fLabel = (p.filingLabel || '').toUpperCase();
      return fStatus === 'FIL' || fStatus === 'FILED' || fStatus === 'NIL_FILED' || fLabel === 'FILED' || fLabel === 'NIL FILED' || p.isNil || p.isValid;
    });
  }

  if (targetPeriods.length === 0) {
    const msg = isTdsTcs
      ? `⚠️ No available TDS/TCS return periods found for FY ${finYear}. Consolidated Excel requires at least one period with credit records.`
      : `⚠️ No filed return periods found for ${returnName} in FY ${finYear}. Consolidated Excel requires at least one filed return.`;
    addCopilotLog(msg, 'warn');
    showBannerNotice(msg, 6000);
    return;
  }

  const bBtn = getElement('btn-consolidated-excel');
  const originalText = bBtn ? bBtn.innerHTML : '';
  if (bBtn) {
    bBtn.disabled = true;
    bBtn.innerHTML = '⏳ Compiling...';
  }

  try {
    isBulkOperationRunning = true;
    const gstin = (typeof session !== 'undefined' && session && session.gstin) || 'GSTIN';
    const finYear = (typeof session !== 'undefined' && session && session.finYear) || 'FY';
    const isBadTaxpayerName = (v) => !v || typeof v !== 'string' || ['na', 'n/a', 'null', 'undefined', '-', '.'].includes(v.trim().toLowerCase());
    const tradeName = [session?.tradeName, session?.legalName, session?.businessName, getElement('businessName')?.textContent?.trim()].find(v => !isBadTaxpayerName(v)) || 'Taxpayer';
    const periodRange = formatConsolidatedPeriodRange(targetPeriods);

    if (isSales) {
      const periodsData = [];
      const pendingPeriods = [];

      for (let i = 0; i < targetPeriods.length; i++) {
        const p = targetPeriods[i];
        if (bBtn) bBtn.innerHTML = `⏳ Loading JSON ${i + 1}/${targetPeriods.length}...`;

        // 1. Fast Path: Skip JSON file requirement for Nil Filed periods
        if (p.isNil || p.filingLabel === 'Nil Filed' || p.filingStatus === 'NIL_FILED') {
          const nilData = { b2b: [], b2cl: [], b2cs: [], cdnr: [], hsn: { data: [] }, doc_issue: { doc_det: [] }, nil: true };
          periodsData.push({ period: p.value, data: nilData });
          continue;
        }

        // 2. Pre-probe formdetails if GSTR-1 to catch any unflagged Nil returns before attempting generateFile
        if (cfg.key === 'G1' && !p.isNil) {
          try {
            const mDetails = await processAsync({ request: 'get', url: gstn.gstr1FormDetails(p) });
            if (mDetails.status) {
              const fdData = JSON.parse(mDetails.response)?.data || {};
              if (fdData.isnil === 'Y' || String(fdData.isnil).toUpperCase() === 'Y') {
                p.isNil = true;
                p.filingLabel = 'Nil Filed';
                p.filingStatus = 'NIL_FILED';
                const nilData = { b2b: [], b2cl: [], b2cs: [], cdnr: [], hsn: { data: [] }, doc_issue: { doc_det: [] }, nil: true };
                periodsData.push({ period: p.value, data: nilData });
                continue;
              }
            }
          } catch (_) {}
        }

        let jsonData = null;
        try {
          if (cfg.key === 'G1A') {
            jsonData = await fetchFullGstr1aData(p);
          } else {
            // Pure Offline JSON Engine
            const mGen = await processAsync({ request: 'get', url: gstn.generateFile(configR1, p, false) });
            if (mGen && mGen.status && mGen.response) {
              const resp = JSON.parse(mGen.response);
              const urls = Array.isArray(resp.data?.url) ? resp.data.url : (resp.data?.url ? [resp.data.url] : []);
              
              const fileTs = (resp.data?.date && resp.data?.time) ? parseGstnDateTime(resp.data.date, resp.data.time) : 0;
              const isExpired = isGstnFileStale(p, fileTs);

              if (resp.data?.status === 1 || urls.length === 0 || !urls[0] || isExpired) {
                if (p.currentState !== RETURN_STATES.GENERATING) {
                  await generate(p, 'Auto-Generating…');
                }
                pendingPeriods.push(p.label || p.value);
                continue;
              }

              const zipRes = await fetch(urls[0], { credentials: 'include' });
              if (zipRes.ok) {
                const buf = await zipRes.arrayBuffer();
                if (typeof fflate === 'undefined' && (typeof window === 'undefined' || !window.fflate)) {
                  await loadScriptAsync('../lib/fflate.js');
                }
                const fflateLib = (typeof fflate !== 'undefined') ? fflate : (typeof window !== 'undefined' ? window.fflate : null);
                let jsonEntries = [];
                if (fflateLib && typeof fflateLib.unzipSync === 'function') {
                  const unzipped = fflateLib.unzipSync(new Uint8Array(buf));
                  const jsonFiles = Object.keys(unzipped).filter(fn => fn.toLowerCase().endsWith('.json'));
                  for (const jf of jsonFiles) {
                    try {
                      const text = fflateLib.strFromU8(unzipped[jf]);
                      jsonEntries.push({ name: jf, text });
                    } catch (_) {}
                  }
                }

                if (jsonEntries.length > 0) {
                  let merged = {};
                  for (const entry of jsonEntries) {
                    try {
                      const parsed = JSON.parse(entry.text);
                      if (parsed && typeof parsed === 'object') {
                        merged = { ...merged, ...parsed };
                        if (Array.isArray(parsed.b2b)) merged.b2b = (merged.b2b && merged.b2b !== parsed.b2b) ? merged.b2b.concat(parsed.b2b) : parsed.b2b;
                        if (Array.isArray(parsed.b2ba)) merged.b2ba = (merged.b2ba && merged.b2ba !== parsed.b2ba) ? merged.b2ba.concat(parsed.b2ba) : parsed.b2ba;
                        if (Array.isArray(parsed.b2cl)) merged.b2cl = (merged.b2cl && merged.b2cl !== parsed.b2cl) ? merged.b2cl.concat(parsed.b2cl) : parsed.b2cl;
                        if (Array.isArray(parsed.b2cla)) merged.b2cla = (merged.b2cla && merged.b2cla !== parsed.b2cla) ? merged.b2cla.concat(parsed.b2cla) : parsed.b2cla;
                        if (Array.isArray(parsed.b2cs)) merged.b2cs = (merged.b2cs && merged.b2cs !== parsed.b2cs) ? merged.b2cs.concat(parsed.b2cs) : parsed.b2cs;
                        if (Array.isArray(parsed.b2csa)) merged.b2csa = (merged.b2csa && merged.b2csa !== parsed.b2csa) ? merged.b2csa.concat(parsed.b2csa) : parsed.b2csa;
                        if (Array.isArray(parsed.cdnr)) merged.cdnr = (merged.cdnr && merged.cdnr !== parsed.cdnr) ? merged.cdnr.concat(parsed.cdnr) : parsed.cdnr;
                        if (Array.isArray(parsed.cdnra)) merged.cdnra = (merged.cdnra && merged.cdnra !== parsed.cdnra) ? merged.cdnra.concat(parsed.cdnra) : parsed.cdnra;
                        if (Array.isArray(parsed.cdnur)) merged.cdnur = (merged.cdnur && merged.cdnur !== parsed.cdnur) ? merged.cdnur.concat(parsed.cdnur) : parsed.cdnur;
                        if (Array.isArray(parsed.cdnura)) merged.cdnura = (merged.cdnura && merged.cdnura !== parsed.cdnura) ? merged.cdnura.concat(parsed.cdnura) : parsed.cdnura;
                        if (Array.isArray(parsed.exp)) merged.exp = (merged.exp && merged.exp !== parsed.exp) ? merged.exp.concat(parsed.exp) : parsed.exp;
                        if (Array.isArray(parsed.expa)) merged.expa = (merged.expa && merged.expa !== parsed.expa) ? merged.expa.concat(parsed.expa) : parsed.expa;
                        if (Array.isArray(parsed.at)) merged.at = (merged.at && merged.at !== parsed.at) ? merged.at.concat(parsed.at) : parsed.at;
                        if (Array.isArray(parsed.ata)) merged.ata = (merged.ata && merged.ata !== parsed.ata) ? merged.ata.concat(parsed.ata) : parsed.ata;
                        if (Array.isArray(parsed.txpd)) merged.txpd = (merged.txpd && merged.txpd !== parsed.txpd) ? merged.txpd.concat(parsed.txpd) : parsed.txpd;
                        if (Array.isArray(parsed.txpda)) merged.txpda = (merged.txpda && merged.txpda !== parsed.txpda) ? merged.txpda.concat(parsed.txpda) : parsed.txpda;
                        if (Array.isArray(parsed.ecom)) merged.ecom = (merged.ecom && merged.ecom !== parsed.ecom) ? merged.ecom.concat(parsed.ecom) : parsed.ecom;
                        if (Array.isArray(parsed.ecoma)) merged.ecoma = (merged.ecoma && merged.ecoma !== parsed.ecoma) ? merged.ecoma.concat(parsed.ecoma) : parsed.ecoma;
                        if (Array.isArray(parsed.supecom)) merged.supecom = (merged.supecom && merged.supecom !== parsed.supecom) ? merged.supecom.concat(parsed.supecom) : parsed.supecom;
                        if (Array.isArray(parsed.supecoma)) merged.supecoma = (merged.supecoma && merged.supecoma !== parsed.supecoma) ? merged.supecoma.concat(parsed.supecoma) : parsed.supecoma;
                        if (parsed.nil && !merged.nil) merged.nil = parsed.nil;
                        if (parsed.nil_supplies && !merged.nil) merged.nil = parsed.nil_supplies;
                        if (parsed.hsn && !merged.hsn) merged.hsn = parsed.hsn;
                        if (parsed.doc_issue && !merged.doc_issue) merged.doc_issue = parsed.doc_issue;
                        if (parsed.doc_issued && !merged.doc_issue) merged.doc_issue = parsed.doc_issued;
                      }
                    } catch (_) {}
                  }
                  if (merged.b2b || merged.sec_sum || merged.hsn || merged.doc_issue || merged.gstin || merged.b2cs || merged.nil || merged.exp || merged.cdnr || merged.b2cl || merged.at || merged.txpd || merged.ecom || merged.supecom) {
                    jsonData = merged;
                    console.log(`[Consolidated] Extracted ${jsonEntries.length} JSON files for ${p.value}`);
                  }
                }
              } else {
                if (p.currentState !== RETURN_STATES.GENERATING) {
                  await generate(p, 'Auto-Generating…');
                }
                pendingPeriods.push(p.label || p.value);
              }
            } else {
              if (p.currentState !== RETURN_STATES.GENERATING) {
                await generate(p, 'Auto-Generating…');
              }
              pendingPeriods.push(p.label || p.value);
            }
          }
        } catch (err) {
          console.warn(`[Consolidated Sales] Error on period ${p.value}:`, err.message);
          if (p.currentState !== RETURN_STATES.GENERATING) {
            await generate(p, 'Auto-Generating…');
          }
          pendingPeriods.push(p.label || p.value);
        }

        if (jsonData) {
          periodsData.push({ period: p.value, data: jsonData, isGstr1a: (cfg.key === 'G1A') });
        }
      }

      if (pendingPeriods.length > 0) {
        const msg = `⏳ GST Portal is generating GSTR-1 JSON for: ${pendingPeriods.join(', ')}. Please wait a few minutes for GST portal compilation.`;
        addCopilotLog(msg, 'warn');
        showBannerNotice(msg, 10000);
        showGeneratingBanner();
        updateBulkPdfButtonState();
        if (bBtn) {
          bBtn.disabled = true;
          bBtn.innerHTML = (isSidePanelSurface || (typeof window !== 'undefined' && window.innerWidth <= 650)) ? 'Excel (Combined)' : 'Excel (All Months Combined)';
        }
        return;
      }

      if (periodsData.length === 0) {
        throw new Error('No filed sales data could be retrieved for the selected periods.');
      }

      // 3. Resolve customer/buyer GSTIN trade names via Portal Taxpayer Search
      const allCtins = new Set();
      periodsData.forEach(pItem => {
        const d = pItem.data || {};
        const b2b = [...(d.b2b || []), ...(d.b2ba || []), ...(d.sec_sum && !Array.isArray(d.sec_sum) && d.sec_sum.b2b ? d.sec_sum.b2b : [])];
        if (Array.isArray(b2b)) {
          b2b.forEach(item => { if (item.ctin) allCtins.add(item.ctin); });
        }
        const cdnr = [...(d.cdnr || []), ...(d.cdnra || [])];
        if (Array.isArray(cdnr)) {
          cdnr.forEach(item => { if (item.ctin) allCtins.add(item.ctin); });
        }
      });

      let partyMap = {};
      if (allCtins.size > 0) {
        if (bBtn) bBtn.innerHTML = `⏳ Resolving party names (${allCtins.size})...`;
        partyMap = await resolvePartyNames(Array.from(allCtins));
      }

      addCopilotLog(`Compiling Consolidated Sales Excel for ${periodsData.length} periods...`, 'info');
      const userProfile = await new Promise(r => chrome.storage.local.get(['rp_user_profile'], res => r(res?.rp_user_profile || {})));
      const isGstr1a = (cfg.key === 'G1A');
      const returnTypeCode = isGstr1a ? 'GSTR1A' : 'GSTR1';
      const wb = ConsolidatedSalesBuilder.buildSalesWorkbook(periodsData, {
        email: userProfile.email || '',
        gstin,
        finYear,
        tradeName,
        partyMap,
        isGstr1a,
        returnType: returnTypeCode
      });
      const base64 = await wb.generateBase64();
      const fileName = `${returnTypeCode}_Consolidated_${gstin}_${periodRange}_${finYear}.xlsx`;
      chrome.runtime.sendMessage({
        request: 'download-file',
        fileName,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        base64,
        gstin,
        returnType: returnTypeCode,
        period: targetPeriods[0].value,
        fy: finYear
      });
      addCopilotLog(`✅ Consolidated Sales Excel generated: ${fileName}`, 'success');
    } else if (isPurchase) {
      addCopilotLog(`Fetching GSTR-2B purchase data for ${targetPeriods.length} periods...`, 'info');
      const periodsData = [];

      for (let i = 0; i < targetPeriods.length; i++) {
        const p = targetPeriods[i];
        if (bBtn) bBtn.innerHTML = `⏳ Fetching ${i + 1}/${targetPeriods.length}...`;

        if (p.filingLabel === 'No ITC') {
          const empty2b = { docdata: { b2b: [], b2ba: [], cdnr: [], cdnra: [], isd: [], isda: [] }, itcsumm: {} };
          periodsData.push({ period: p.value, data: { data: empty2b } });
          continue;
        }

        let r2b = p.r2bCachedData, raw = p.r2bRawData;
        if (!r2b || !raw) {
          const res = await fetch2bData(p);
          if (res.ok) {
            r2b = res.data;
            raw = res.raw;
            p.r2bCachedData = r2b;
            p.r2bRawData = raw;
          }
        }

        if (r2b || raw) {
          periodsData.push({ period: p.value, data: raw || { data: r2b } });
        }
      }

      if (periodsData.length === 0) {
        throw new Error('No GSTR-2B purchase records found for the selected periods.');
      }

      // Resolve any missing supplier trade names via Portal Taxpayer Search
      const allSupplierCtins = new Set();
      periodsData.forEach(pItem => {
        const raw = pItem.data || {};
        const d = (raw.data && raw.data.docdata) ? raw.data.docdata : (raw.docdata || raw.data || raw);
        ['b2b', 'b2ba', 'cdnr', 'cdnra', 'isd', 'isda'].forEach(sec => {
          const list = d[sec];
          if (Array.isArray(list)) {
            list.forEach(item => {
              if (item.ctin && !item.cname && !item.trdnm && !item.trade_name) {
                allSupplierCtins.add(item.ctin);
              }
            });
          }
        });
      });

      let partyMap = {};
      if (allSupplierCtins.size > 0) {
        if (bBtn) bBtn.innerHTML = `⏳ Resolving supplier names (${allSupplierCtins.size})...`;
        partyMap = await resolvePartyNames(Array.from(allSupplierCtins));
      }

      addCopilotLog(`Compiling Consolidated Purchase Excel for ${periodsData.length} periods...`, 'info');
      const userProfile = await new Promise(r => chrome.storage.local.get(['rp_user_profile'], res => r(res?.rp_user_profile || {})));
      const wb = ConsolidatedPurchaseBuilder.buildPurchaseWorkbook(periodsData, { email: userProfile.email || '', gstin, finYear, tradeName, partyMap });
      const base64 = await wb.generateBase64();

      const fileName = `GSTR2B_Consolidated_${gstin}_${periodRange}_${finYear}.xlsx`;
      chrome.runtime.sendMessage({
        request: 'download-file',
        fileName,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        base64,
        gstin,
        returnType: 'GSTR2B',
        period: targetPeriods[0].value,
        fy: finYear
      });
      addCopilotLog(`✅ Consolidated Purchase Excel generated: ${fileName}`, 'success');
    }

    if (isTdsTcs) {
      const periodsData = [];
      const allCtins = new Set();

      for (let i = 0; i < targetPeriods.length; i++) {
        const p = targetPeriods[i];
        if (bBtn) bBtn.innerHTML = `⏳ Loading TDS/TCS ${i + 1}/${targetPeriods.length}...`;

        const prd = p.value;
        const [tdsRes, tcsRes, tdsaRes, tcsaRes] = await Promise.all([
          processAsync({ request: 'get', url: gstn.gstr2xTds(prd) }).catch(() => null),
          processAsync({ request: 'get', url: gstn.gstr2xTcs(prd) }).catch(() => null),
          processAsync({ request: 'get', url: gstn.gstr2xTdsa(prd) }).catch(() => null),
          processAsync({ request: 'get', url: gstn.gstr2xTcsa(prd) }).catch(() => null)
        ]);

        const parseResp = (m) => {
          if (!m || !m.status || !m.response) return null;
          try {
            const j = JSON.parse(m.response);
            return j.data || null;
          } catch (_) { return null; }
        };

        const tdsData = parseResp(tdsRes);
        const tcsData = parseResp(tcsRes);
        const tdsaData = parseResp(tdsaRes);
        const tcsaData = parseResp(tcsaRes);

        const tdsList = tdsData?.processed?.tds || tdsData?.tds || [];
        const tcsList = tcsData?.processed?.tcs || tcsData?.tcs || [];
        const tdsaList = tdsaData?.processed?.tdsa || tdsaData?.tdsa || [];
        const tcsaList = tcsaData?.processed?.tcsa || tcsaData?.tcsa || [];

        [...tdsList, ...tdsaList].forEach(item => {
          if (item.ctin && (!item.ctin_name || isBadTaxpayerName(item.ctin_name))) {
            allCtins.add(item.ctin);
          }
        });
        [...tcsList, ...tcsaList].forEach(item => {
          const c = item.ctin || item.ecom_gstin;
          const n = item.ctin_name || item.trade_name;
          if (c && (!n || isBadTaxpayerName(n))) {
            allCtins.add(c);
          }
        });

        periodsData.push({
          period: prd,
          monthName: p.month,
          data: {
            gstin,
            fp: prd,
            tds: tdsList,
            tcs: tcsList,
            tdsa: tdsaList,
            tcsa: tcsaList
          }
        });
      }

      let partyMap = {};
      if (allCtins.size > 0) {
        if (bBtn) bBtn.innerHTML = `⏳ Resolving names (${allCtins.size})...`;
        partyMap = await resolvePartyNames(Array.from(allCtins));
      }

      addCopilotLog(`Compiling Consolidated TDS/TCS Excel for ${periodsData.length} periods...`, 'info');
      const userProfile = await new Promise(r => chrome.storage.local.get(['rp_user_profile'], res => r(res?.rp_user_profile || {})));
      const wb = ConsolidatedTdsTcsBuilder.buildTdsTcsWorkbook(periodsData, {
        email: userProfile.email || '',
        gstin,
        finYear,
        tradeName,
        partyMap
      });
      const base64 = await wb.generateBase64();

      const fileName = `GSTR2X_TDS_TCS_Consolidated_${gstin}_${periodRange}_${finYear}.xlsx`;
      chrome.runtime.sendMessage({
        request: 'download-file',
        fileName,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        base64,
        gstin,
        returnType: 'GSTR2X',
        period: targetPeriods[0].value,
        fy: finYear
      });
      addCopilotLog(`✅ Consolidated TDS/TCS Excel generated: ${fileName}`, 'success');
    } else if (isG3b) {
      addCopilotLog(`Fetching GSTR-3B, GSTR-1, and GSTR-2B data for ${targetPeriods.length} periods...`, 'info');
      const periodsData = [];

      for (let i = 0; i < targetPeriods.length; i++) {
        const p = targetPeriods[i];
        if (bBtn) bBtn.innerHTML = `⏳ Loading 3B & Audit Reconciliations ${i + 1}/${targetPeriods.length}...`;
        try {
          const [g3bRes, g1Res, g2bRes] = await Promise.allSettled([
            fetchFullGstr3bData(p),
            fetchGstr1Summary(p),
            fetch2bData(p)
          ]);

          const data = (g3bRes.status === 'fulfilled') ? g3bRes.value : null;
          const gstr1Data = (g1Res.status === 'fulfilled') ? g1Res.value : null;
          const g2bResVal = (g2bRes.status === 'fulfilled') ? g2bRes.value : null;
          const gstr2bData = (g2bResVal && g2bResVal.ok) ? (g2bResVal.data || g2bResVal.raw) : null;

          if (data) {
            periodsData.push({
              period: p.value,
              data,
              gstr1Data,
              gstr2bData
            });
          }
        } catch (err) {
          console.warn(`[Consolidated GSTR-3B] Could not fetch ${p.value}:`, err.message);
        }
      }

      if (periodsData.length === 0) {
        throw new Error('No filed GSTR-3B return records found for the selected periods.');
      }

      addCopilotLog(`Compiling Consolidated GSTR-3B Master Excel for ${periodsData.length} periods...`, 'info');
      const userProfile = await new Promise(r => chrome.storage.local.get(['rp_user_profile'], res => r(res?.rp_user_profile || {})));
      const builder = (typeof ConsolidatedGstr3bBuilder !== 'undefined') ? ConsolidatedGstr3bBuilder : window.ConsolidatedGstr3bBuilder;
      if (!builder) throw new Error('ConsolidatedGstr3bBuilder engine failed to load');

      const wb = builder.buildGstr3bConsolidatedWorkbook(periodsData, {
        email: userProfile.email || '',
        gstin,
        finYear,
        tradeName
      });
      const base64 = await wb.generateBase64();

      const fileName = `GSTR3B_Consolidated_${gstin}_${periodRange}_${finYear}.xlsx`;
      chrome.runtime.sendMessage({
        request: 'download-file',
        fileName,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        base64,
        gstin,
        returnType: 'R3B',
        period: targetPeriods[0].value,
        fy: finYear
      });
      addCopilotLog(`✅ Consolidated GSTR-3B Excel generated: ${fileName}`, 'success');
    }
  } catch (err) {
    console.error('[Consolidated Excel Error]', err);
    addCopilotLog(`❌ Consolidated Excel notice: ${err.message}`, 'error');
    showBannerNotice(`⚠️ Consolidated Report Notice: ${err.message}`, 6000);
  } finally {
    isBulkOperationRunning = false;
    if (bBtn) {
      bBtn.disabled = false;
      bBtn.innerHTML = originalText;
    }
  }
}

async function generateAll() {
  if (typeof ReturnPilotSecurity !== 'undefined') {
    const subState = (typeof currentSubscriptionState !== 'undefined') ? currentSubscriptionState : null;
    const startYear = getSelectedStartYear();

    const perm = ReturnPilotSecurity.checkFeatureAccess('JSON', subState, startYear);
    if (!perm.allowed) {
      window.showPremiumUpgradeModal(perm.reason);
      return;
    }
  }

  const b = getElement('btn-gen-all');
  const origText = b ? b.textContent.trim() : 'Generate All';
  const targets = (session.periods || []).filter(p => 
    p.isValid && p.currentState !== RETURN_STATES.GENERATING && !p.isNil && p.filingLabel !== 'Nil Filed' && p.filingStatus !== 'NIL_FILED'
  );
  let doneCount = 0;
  const totalCount = targets.length;
  if (b) {
    b.disabled = true;
    b.textContent = totalCount > 0 ? `Generating (0/${totalCount})…` : 'Generate All';
  }

  // Provide immediate visual row queue feedback
  for (const p of targets) {
    const btnGen = getElement(`btn-gen-${p.value}`);
    if (btnGen) {
      btnGen.disabled = true;
      btnGen.textContent = 'Queued…';
    }
  }

  try {
    for (const p of targets) {
      const btnGen = getElement(`btn-gen-${p.value}`);
      if (btnGen) {
        btnGen.disabled = true;
        btnGen.textContent = 'Generating…';
      }
      if (session.return && (session.return.workflowType === WORKFLOW_TYPES.IMS_PORTAL || session.return.key === 'IMS')) {
        await generateIms(p);
      } else {
        await generate(p);
      }
      doneCount++;
      if (b && totalCount > 0) b.textContent = `Generating (${doneCount}/${totalCount})…`;
      await new Promise(r => setTimeout(r, CONFIG.RATE_LIMIT_DELAY));
    }
  } finally {
    if (b) {
      b.textContent = origText;
      b.disabled = false;
    }
    for (const p of targets) {
      syncRowActions(p);
    }
  }
}

// ── CHROME WEB STORE REVIEW, FEEDBACK & REFERRAL MODAL (MOMENT OF DELIGHT) ──
const CWS_REVIEWS_URL = 'https://chromewebstore.google.com/detail/returnpilot-%E2%80%94-gst-return/aonckbcabfdbpamocmihkfcjnpoacbbe/reviews';

function triggerDownloadReviewPrompt() {
  if (isBulkOperationRunning) return;
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;

  chrome.storage.local.get(['rp_review_reviewed', 'rp_review_dismissed_date'], (data) => {
    if (data && data.rp_review_reviewed) return; // User already engaged with review
    const today = new Date().toDateString();
    if (data && data.rp_review_dismissed_date === today) return; // Suppressed for the rest of today

    const modal = document.getElementById('reviewPromptModal');
    if (modal && modal.hidden) {
      modal.hidden = false;
      const toast = document.getElementById('referSuccessToast');
      if (toast) toast.hidden = true;
    }
  });
}

function dismissReviewModalForToday() {
  const modal = document.getElementById('reviewPromptModal');
  if (modal) modal.hidden = true;
  const today = new Date().toDateString();
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.set({ rp_review_dismissed_date: today });
  }
}

function handleReviewStoreClick() {
  const modal = document.getElementById('reviewPromptModal');
  if (modal) modal.hidden = true;
  const today = new Date().toDateString();
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.set({
      rp_review_reviewed: true,
      rp_review_dismissed_date: today
    });
  }
  if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
    chrome.tabs.create({ url: CWS_REVIEWS_URL });
  } else {
    window.open(CWS_REVIEWS_URL, '_blank');
  }
}

function handleReviewFeedbackClick() {
  const modal = document.getElementById('reviewPromptModal');
  if (modal) modal.hidden = true;
  const today = new Date().toDateString();
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.set({ rp_review_dismissed_date: today });
  }
  if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
    chrome.tabs.create({ url: CWS_REVIEWS_URL });
  } else {
    window.open(CWS_REVIEWS_URL, '_blank');
  }
}

function handleReferColleagueClick() {
  const referralText = "Hey! I've been using ReturnPilot for GST Portal tasks — it automates bulk return downloads (GSTR-1, 2B, 3B), consolidated Excel reports, and 1-click CAPTCHA login. Highly recommend checking it out:\nhttps://chromewebstore.google.com/detail/returnpilot-%E2%80%94-gst-return/aonckbcabfdbpamocmihkfcjnpoacbbe";

  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(referralText);
    } else {
      const tempArea = document.createElement('textarea');
      tempArea.value = referralText;
      document.body.appendChild(tempArea);
      tempArea.select();
      document.execCommand('copy');
      document.body.removeChild(tempArea);
    }
  } catch (_) {}

  const toast = document.getElementById('referSuccessToast');
  if (toast) {
    toast.hidden = false;
    toast.textContent = '✓ Link copied! Opening WhatsApp…';
  }

  const today = new Date().toDateString();
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.set({ rp_review_dismissed_date: today });
  }

  const waUrl = 'https://api.whatsapp.com/send?text=' + encodeURIComponent(referralText);
  setTimeout(() => {
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
      chrome.tabs.create({ url: waUrl });
    } else {
      window.open(waUrl, '_blank');
    }
    const modal = document.getElementById('reviewPromptModal');
    if (modal) modal.hidden = true;
  }, 700);
}

function initializeReviewPrompt() {
  const modal = document.getElementById('reviewPromptModal');
  const btnClose = document.getElementById('closeReviewModalBtn');
  const btnStore = document.getElementById('btnReviewModalStore');
  const btnFeedback = document.getElementById('btnReviewModalFeedback');
  const btnRefer = document.getElementById('btnReviewModalRefer');

  if (btnClose) {
    btnClose.onclick = (e) => {
      e.stopPropagation();
      dismissReviewModalForToday();
    };
  }

  if (btnStore) {
    btnStore.onclick = (e) => {
      e.stopPropagation();
      handleReviewStoreClick();
    };
  }

  if (btnFeedback) {
    btnFeedback.onclick = (e) => {
      e.stopPropagation();
      handleReviewFeedbackClick();
    };
  }

  if (btnRefer) {
    btnRefer.onclick = (e) => {
      e.stopPropagation();
      handleReferColleagueClick();
    };
  }

  if (modal) {
    modal.onclick = (e) => {
      if (e.target === modal) {
        dismissReviewModalForToday();
      }
    };
    const card = modal.querySelector('.review-prompt-modal');
    if (card) {
      card.onclick = (e) => e.stopPropagation();
    }
  }
}

window.triggerSmartDonation = function () {
  triggerDownloadReviewPrompt();
};

document.addEventListener('DOMContentLoaded', () => {
  initializeFreemiumManager();
  initializeReviewPrompt();
  try {
    const cYear = new Date().getFullYear();
    const cY = document.getElementById('copyright-year');
    if (cY) cY.textContent = cYear;
  } catch (e) {}

  // Developer Hotkey: Ctrl+Shift+L toggles Live Diagnostics & Flight Recorder without cluttering end-user UI
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'L' || e.key === 'l')) {
      e.preventDefault();
      if (typeof window.toggleFlightRecorder === 'function') {
        window.toggleFlightRecorder();
      } else {
        const launcher = document.getElementById('rp-dev-launcher');
        if (launcher) launcher.click();
      }
    }
  });

  // ── 1-Click Copy GSTIN Micro-Interaction ──
  const copyBtn = document.getElementById('copyGstinBtn');
  const gstinEl = document.getElementById('businessGstin');
  const handleCopyGstin = async () => {
    const textToCopy = (session.gstin || (gstinEl ? gstinEl.textContent : '')).trim();
    if (!textToCopy || textToCopy === '—') return;
    try {
      await navigator.clipboard.writeText(textToCopy);
      if (copyBtn) {
        copyBtn.classList.add('copied');
        copyBtn.title = 'Copied! ✓';
        setTimeout(() => {
          copyBtn.classList.remove('copied');
          copyBtn.title = 'Copy GSTIN';
        }, 1500);
      }
    } catch (_) {}
  };
  if (copyBtn) copyBtn.addEventListener('click', handleCopyGstin);
  if (gstinEl) gstinEl.addEventListener('click', handleCopyGstin);

  const nB = document.getElementById('navToGstBtn'); if (nB) nB.addEventListener('click', () => { if (typeof chrome !== 'undefined' && chrome.tabs) chrome.tabs.create({ url: 'https://gst.gov.in' }); else window.open('https://gst.gov.in', '_blank'); });
  const lB = document.getElementById('navToLoginBtn');
  if (lB) {
    lB.addEventListener('click', (e) => {
      e.preventDefault();
      const loginUrl = 'https://services.gst.gov.in/services/login';
      const origHtml = lB.innerHTML;

      lB.disabled = true;
      lB.innerHTML = `
        <svg class="login-spin-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="animation: refreshSpin 0.7s linear infinite;">
          <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
        </svg>
        Opening Login…
      `;

      showStatus('Opening GST Portal Login...');

      if (typeof chrome !== 'undefined' && chrome.tabs) {
        let pollInterval = null;
        let cleanedUp = false;

        const cleanup = () => {
          if (cleanedUp) return;
          cleanedUp = true;
          if (pollInterval) clearInterval(pollInterval);
          try { chrome.tabs.onUpdated.removeListener(loginTabListener); } catch (_) {}
          lB.disabled = false;
          lB.innerHTML = origHtml;
        };

        const checkAndTransition = (tab) => {
          if (cleanedUp) return false;
          if (tab && tab.url && tab.url.includes('services.gst.gov.in/services/login')) {
            cleanup();
            showStatus(null);
            try { currentUrl = new URL(tab.url); } catch (_) {}
            startupAsync('GST Login Navigation');
            return true;
          }
          return false;
        };

        const loginTabListener = (tabId, changeInfo, tab) => {
          if ((changeInfo.url || changeInfo.status === 'complete') && checkAndTransition(tab)) {
            cleanup();
          }
        };
        chrome.tabs.onUpdated.addListener(loginTabListener);

        let pollCount = 0;
        pollInterval = setInterval(() => {
          pollCount++;
          chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
            if (tabs && tabs[0] && checkAndTransition(tabs[0])) {
              cleanup();
            }
          });
          if (pollCount > 30) {
            cleanup();
            showStatus(null);
          }
        }, 500);

        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs && tabs[0] && tabs[0].id) {
            chrome.tabs.update(tabs[0].id, { url: loginUrl });
          } else {
            chrome.tabs.create({ url: loginUrl });
          }
        });
      } else {
        window.location.href = loginUrl;
      }
    });
  }
  const rB = document.getElementById('navToReturnDashboardBtn');
  if (rB) rB.addEventListener('click', async () => {
    rB.disabled = true;
    rB.textContent = '⏳ Navigating to Return Dashboard...';
    showStatus('Navigating to Return Dashboard...');
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      await new Promise(r => chrome.runtime.sendMessage({ request: 'propagate-session-silently' }, res => { if (chrome.runtime.lastError) {} r(res); }));
      
      let pollInterval = null;
      let cleanedUp = false;
      const cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        if (pollInterval) clearInterval(pollInterval);
        try { chrome.tabs.onUpdated.removeListener(tabListener); } catch (_) {}
        showStatus(null);
      };

      const checkAndBoot = (tab) => {
        if (cleanedUp) return false;
        if (tab && tab.url && tab.url.includes('return.gst.gov.in/returns/auth/dashboard')) {
          cleanup();
          showStatus(null);
          try { currentUrl = new URL(tab.url); } catch (_) {}
          const m = getElement('msgNotOnReturnDashboard');
          if (m) m.hidden = true;
          rB.disabled = false;
          rB.textContent = 'Go to Return Dashboard';
          startupAsync('Return Dashboard Navigation');
          return true;
        }
        return false;
      };

      const tabListener = (tabId, changeInfo, tab) => {
        if (changeInfo.status === 'complete' && checkAndBoot(tab)) {
          cleanup();
        }
      };
      chrome.tabs.onUpdated.addListener(tabListener);

      let pollCount = 0;
      pollInterval = setInterval(() => {
        pollCount++;
        chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
          if (tabs && tabs[0] && checkAndBoot(tabs[0])) {
            cleanup();
          }
        });
        if (pollCount > 20) {
          cleanup();
          rB.disabled = false;
          rB.textContent = 'Go to Return Dashboard';
        }
      }, 500);

      chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        if (tabs && tabs[0] && tabs[0].id) {
          const tabId = tabs[0].id;
          chrome.tabs.sendMessage(tabId, { action: 'navigate-to-return-dashboard' }, resp => {
            if (chrome.runtime.lastError || !resp || !(resp.success || resp.status)) {
              if (chrome.scripting && chrome.scripting.executeScript) {
                chrome.scripting.executeScript({
                  target: { tabId },
                  func: () => {
                    const directLink = document.querySelector('a[href*="returns/auth/dashboard"], a[href*="/returns/auth/dashboard"]');
                    if (directLink) {
                      try { directLink.click(); } catch (_) { directLink.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); }
                      return 'direct-link-click';
                    }
                    const interactiveCandidates = Array.from(document.querySelectorAll('a, button, input[type="button"], [role="button"]'));
                    const nativeBtn = interactiveCandidates.find(el => {
                      const txt = (el.textContent || '').trim().toLowerCase();
                      const title = (el.getAttribute && el.getAttribute('title') || '').toLowerCase();
                      const ariaLabel = (el.getAttribute && el.getAttribute('aria-label') || '').toLowerCase();
                      return txt === 'return dashboard' || 
                             txt === 'returns dashboard' || 
                             ((txt.includes('return dashboard') || txt.includes('returns dashboard')) && txt.length < 50) || 
                             title.includes('return dashboard') || 
                             ariaLabel.includes('return dashboard');
                    });
                    if (nativeBtn) {
                      try { nativeBtn.click(); } catch (_) { nativeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); }
                      return 'native-btn-click';
                    }
                    window.location.assign('https://return.gst.gov.in/returns/auth/dashboard');
                    return 'location-assign';
                  }
                }).catch(() => {
                  chrome.tabs.update(tabId, { url: 'https://return.gst.gov.in/returns/auth/dashboard' });
                });
              } else {
                chrome.tabs.update(tabId, { url: 'https://return.gst.gov.in/returns/auth/dashboard' });
              }
            }
          });
        } else {
          chrome.tabs.create({ url: 'https://return.gst.gov.in/returns/auth/dashboard' });
        }
      });
    } else {
      window.open('https://return.gst.gov.in/returns/auth/dashboard', '_blank');
    }
  });

  // Real-time tab URL and tab switch listener for Side Panel & Extension Window.
  // Keeps the interface live and continuously updated on every page navigation and tab switch.
  if (typeof chrome !== 'undefined' && chrome.tabs) {
    let rpNavTimer = null;
    let rpLastUrlChangeNavKey = '';
    let rpLastUrlChangeTs = 0;

    const handleTabContextChange = (tabId, reason, isReload = false) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (activeTabs) => {
        if (!activeTabs || !activeTabs[0] || !activeTabs[0].url) {
          if (isSidePanelSurface && !window._rpIsBenchmarking) {
            console.log('[ReturnPilot SidePanel] Non-portal/restricted tab context. Closing side panel.');
            const browserSidebar = (typeof browser !== 'undefined' && browser.sidebarAction)
              ? browser.sidebarAction
              : ((typeof chrome !== 'undefined' && chrome.sidebarAction) ? chrome.sidebarAction : null);
            if (browserSidebar && typeof browserSidebar.close === 'function') {
              try { browserSidebar.close(); } catch (_) {}
            }
            try { window.close(); } catch (_) {}
          }
          return;
        }
        const activeTab = activeTabs[0];
        if (activeTab.url && activeTab.url.startsWith('chrome-extension://')) {
          return;
        }
        if (tabId && activeTab.id !== tabId) return;

        const newUrl = activeTab.url;

        // Tab-specific Side Panel close requirement:
        // When shifted to a non-GST tab or navigated away from GST portal, close the side panel instance immediately.
        if (isSidePanelSurface && !window._rpIsBenchmarking) {
          const isGst = isGstPortalUrlSync(newUrl);
          if (!isGst && !newUrl.startsWith('chrome-extension://')) {
            console.log('[ReturnPilot SidePanel] Non-GST context (' + newUrl + '). Closing side panel.');
            const browserSidebar = (typeof browser !== 'undefined' && browser.sidebarAction)
              ? browser.sidebarAction
              : ((typeof chrome !== 'undefined' && chrome.sidebarAction) ? chrome.sidebarAction : null);
            if (browserSidebar && typeof browserSidebar.close === 'function') {
              try { browserSidebar.close(); } catch (_) {}
            }
            try { window.close(); } catch (_) {}
            return;
          }
        }

        let pathKey = newUrl;
        try {
          const u = new URL(newUrl);
          pathKey = u.hostname + u.pathname + u.search;
        } catch (_) {}

        const navKey = `${activeTab.id}:${pathKey}`;

        // If this is status: 'complete' on a navigation that already triggered within the last 3.5s, skip
        if (isReload && navKey === rpLastUrlChangeNavKey && (Date.now() - rpLastUrlChangeTs < 3500)) {
          return;
        }

        // If this is status: 'complete' on the exact same route that was just booted within 3.5s, skip
        if (isReload && navKey === rpLastNavKey && (Date.now() - _lastStartupTs < 3500)) {
          return;
        }

        if (!isReload && navKey === rpLastNavKey) return; // same tab & route — skip (no re-render)
        rpLastNavKey = navKey;
        if (reason === 'Page Navigation') {
          rpLastUrlChangeNavKey = navKey;
          rpLastUrlChangeTs = Date.now();
        }

        clearTimeout(rpNavTimer);
        rpNavTimer = setTimeout(() => {
          if (rpRowActionsActive > 0) return; // Never wipe table mid-download
          try { currentUrl = new URL(newUrl); } catch (_) {}
          startupAsync(reason || 'Tab Navigation');
        }, 200);
      });
    };

    if (chrome.tabs.onUpdated) {
      chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
        if (changeInfo.url) {
          handleTabContextChange(tabId, 'Page Navigation', false);
        } else if (changeInfo.status === 'complete') {
          handleTabContextChange(tabId, 'Page Reloaded', true);
        }
      });
    }

    if (chrome.tabs.onActivated) {
      chrome.tabs.onActivated.addListener((activeInfo) => {
        handleTabContextChange(activeInfo.tabId, 'Tab Switched', false);
      });
    }
  }
});

async function download1ImsExcel(period) {
  if (period.filingStatus === 'NOT_FILED' || period.filingStatus === 'NF' || period.filingLabel === 'Not Filed' || !period.isValid) {
    throw new Error(`Period ${period.value} is not filed`);
  }
  try {
    await processAsync({ request: "get", url: "https://return.gst.gov.in/imsweb/auth/api/ims/getOutwardCount?rtnType=R1&rtnprd=" + period.value });
  } catch (_) {}

  return downloadImsFile(period, (forceGen) => gstn.imsGenerateOutwardExcel(period, forceGen), "Outward_R1");
}



// ── FREEMIUM & GOOGLE OAUTH USER ACCOUNT MANAGER ──

function getGoogleAccessToken(interactive = true) {
  // Use single, reliable window popup auth with prompt=select_account across all browsers
  return launchWebAuthFlowFallback(interactive);
}

function launchWebAuthFlowFallback(interactive = true) {
  return new Promise((resolve, reject) => {
    const prompt = interactive ? 'select_account' : 'none';
    const authUrl =
      `https://accounts.google.com/o/oauth2/v2/auth` +
      `?client_id=${encodeURIComponent(RP_OAUTH_CLIENT_ID)}` +
      `&response_type=token` +
      `&redirect_uri=${encodeURIComponent(RP_REDIRECT_URI)}` +
      `&scope=${encodeURIComponent('openid email profile')}` +
      `&prompt=${prompt}` +
      `&include_granted_scopes=true`;

    const width = 520;
    const height = 630;
    const left = (typeof screen !== 'undefined' && screen.width) ? Math.max(0, Math.round((screen.width - width) / 2)) : 100;
    const top = (typeof screen !== 'undefined' && screen.height) ? Math.max(0, Math.round((screen.height - height) / 2)) : 100;

    let popupWinId = null;
    let isResolved = false;

    function cleanup() {
      if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.onUpdated) {
        chrome.tabs.onUpdated.removeListener(onTabUpdateListener);
      }
      if (typeof chrome !== 'undefined' && chrome.windows && chrome.windows.onRemoved) {
        chrome.windows.onRemoved.removeListener(onWinRemoveListener);
      }
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
        chrome.runtime.onMessage.removeListener(onRuntimeMessageListener);
      }
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
        chrome.storage.onChanged.removeListener(onStorageChangeListener);
      }
    }

    function checkUrlAndResolve(checkUrl) {
      if (!checkUrl) return false;
      try {
        const rawUrl = new URL(checkUrl);
        const hashParams = new URLSearchParams(rawUrl.hash ? rawUrl.hash.slice(1) : '');
        const searchParams = rawUrl.searchParams;
        const token = hashParams.get('access_token') || searchParams.get('access_token');
        const errStr = hashParams.get('error') || searchParams.get('error');

        if (token) {
          isResolved = true;
          cleanup();
          if (popupWinId) {
            chrome.windows.remove(popupWinId, () => {});
          }
          resolve(token);
          return true;
        } else if (errStr) {
          isResolved = true;
          cleanup();
          if (popupWinId) {
            chrome.windows.remove(popupWinId, () => {});
          }
          reject(new Error(`OAuth notice: ${errStr}`));
          return true;
        }
      } catch (e) {
        // Non-fatal URL parse failure
      }
      return false;
    }

    function onTabUpdateListener(tabId, changeInfo, tab) {
      const checkUrl = changeInfo.url || (tab && tab.url);
      if (checkUrl) {
        checkUrlAndResolve(checkUrl);
      } else if (changeInfo.status === 'complete' || changeInfo.status === 'loading') {
        if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.get) {
          chrome.tabs.get(tabId, (t) => {
            if (t && t.url) checkUrlAndResolve(t.url);
          });
        }
      }
    }

    function onRuntimeMessageListener(msg) {
      if (msg && (msg.request === 'oauth-token-captured' || msg.request === 'oauth-success')) {
        const token = msg.token || (msg.profile && msg.profile.token);
        if (token) {
          isResolved = true;
          cleanup();
          if (popupWinId) chrome.windows.remove(popupWinId, () => {});
          resolve(token);
        }
      } else if (msg && (msg.request === 'oauth-error' || msg.error)) {
        isResolved = true;
        cleanup();
        if (popupWinId) chrome.windows.remove(popupWinId, () => {});
        reject(new Error(msg.error || 'Authentication failed'));
      }
    }

    function onStorageChangeListener(changes, area) {
      if (area === 'local' && (changes.rp_auth_token || changes.rp_user_profile)) {
        const token = changes.rp_auth_token?.newValue;
        if (token) {
          isResolved = true;
          cleanup();
          if (popupWinId) chrome.windows.remove(popupWinId, () => {});
          resolve(token);
        } else if (changes.rp_user_profile?.newValue?.email) {
          isResolved = true;
          cleanup();
          if (popupWinId) chrome.windows.remove(popupWinId, () => {});
          chrome.storage.local.get(['rp_auth_token'], (res) => {
            resolve(res?.rp_auth_token || 'authenticated');
          });
        }
      }
    }

    function onWinRemoveListener(winId) {
      if (winId === popupWinId) {
        setTimeout(() => {
          if (!isResolved) {
            chrome.storage.local.get(['rp_user_profile', 'rp_auth_token'], (stored) => {
              if (stored && stored.rp_user_profile && stored.rp_user_profile.email) {
                isResolved = true;
                cleanup();
                resolve(stored.rp_auth_token || 'authenticated');
              } else {
                cleanup();
                if (!isResolved) {
                  reject(new Error('Sign-in window closed'));
                }
              }
            });
          }
        }, 1200);
      }
    }

    if (typeof chrome !== 'undefined' && chrome.windows && typeof chrome.windows.create === 'function') {
      chrome.windows.create({
        url: authUrl,
        type: 'popup',
        width: width,
        height: height,
        left: left,
        top: top,
        focused: true
      }, (win) => {
        if (chrome.runtime.lastError || !win) {
          reject(chrome.runtime.lastError || new Error('Failed to open authentication window'));
          return;
        }
        popupWinId = win.id;
        chrome.tabs.onUpdated.addListener(onTabUpdateListener);
        chrome.windows.onRemoved.addListener(onWinRemoveListener);
        if (chrome.runtime && chrome.runtime.onMessage) {
          chrome.runtime.onMessage.addListener(onRuntimeMessageListener);
        }
        if (chrome.storage && chrome.storage.onChanged) {
          chrome.storage.onChanged.addListener(onStorageChangeListener);
        }
      });
    } else {
      reject(new Error('Browser window API unavailable'));
    }
  });
}

async function fetchGoogleUserProfile(accessToken) {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (res.ok) {
      const info = await res.json();
      return {
        email: (info.email || '').trim().toLowerCase(),
        name: info.name || info.given_name || '',
        picture: info.picture || ''
      };
    }
  } catch (e) {
    console.warn('[ReturnPilot Auth] Google userinfo fetch notice:', e.message);
  }
  return null;
}

function updateUserAuthButtonUI() {
  const btnAuthText = document.getElementById('btnGoogleAuthText');
  const btnAuth = document.getElementById('btnGoogleAuth');

  if (currentUserProfile && currentUserProfile.email) {
    const displayName = currentUserProfile.name || currentUserProfile.email.split('@')[0];
    if (btnAuthText) {
      btnAuthText.textContent = displayName;
    }
    if (btnAuth) {
      btnAuth.title = `Signed in as ${currentUserProfile.email}`;
      if (currentUserProfile.picture) {
        let img = btnAuth.querySelector('img.user-avatar');
        if (!img) {
          img = document.createElement('img');
          img.className = 'user-avatar';
          img.style.cssText = 'width: 16px; height: 16px; border-radius: 50%; object-fit: cover; vertical-align: middle; margin-right: 4px;';
          btnAuth.insertBefore(img, btnAuthText);
          const svg = btnAuth.querySelector('svg');
          if (svg) svg.style.display = 'none';
        }
        img.src = currentUserProfile.picture;
      }
    }
  } else {
    if (btnAuthText) btnAuthText.textContent = 'Sign in with Google';
    if (btnAuth) {
      btnAuth.title = 'Sign in with Google Account';
      const img = btnAuth.querySelector('img.user-avatar');
      if (img) img.remove();
      const svg = btnAuth.querySelector('svg');
      if (svg) svg.style.display = 'inline-block';
    }
  }
}

async function triggerGoogleSignIn(interactive = true) {
  const btnAuth = document.getElementById('btnGoogleAuth');
  const btnAuthText = document.getElementById('btnGoogleAuthText');
  if (interactive) {
    if (btnAuthText) btnAuthText.textContent = 'Connecting…';
    if (btnAuth) btnAuth.style.opacity = '0.7';
  }

  try {
    const accessToken = await getGoogleAccessToken(interactive);
    let profile = await fetchGoogleUserProfile(accessToken);

    if (!profile || !profile.email) {
      throw new Error('Could not retrieve user email');
    }

    currentUserProfile = profile;
    
    // Retrieve existing verified license from local storage
    const stored = await new Promise(r => chrome.storage.local.get(['rp_license_data'], r));
    if (stored && stored.rp_license_data && (stored.rp_license_data.valid || stored.rp_license_data.expired)) {
      currentSubscriptionState = stored.rp_license_data;
      currentSubscriptionState.verifying = true;
    } else {
      // Immediate optimistic 7-Day Trial for new sign-in (instant 0ms response)
      currentSubscriptionState = {
        valid: true,
        tier: 'PREMIUM',
        isTrial: true,
        daysLeft: 7,
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
        lastCheckedAt: Date.now(),
        seal: '',
        verifying: true
      };
      saveSubscriptionState(currentSubscriptionState);
    }

    await new Promise(r => chrome.storage.local.set({ 
      rp_user_profile: currentUserProfile, 
      rp_user_email: profile.email,
      rp_auth_token: accessToken 
    }, r));
    
    updateUserAuthButtonUI();
    updateFreemiumUI();
    checkSubscriptionServerStatus(profile.email, true);
  } catch (err) {
    if (interactive) {
      console.warn('[ReturnPilot Auth Notice]:', err.message);
      if (btnAuthText) btnAuthText.textContent = 'Sign in with Google';
    } else {
      updateUserAuthButtonUI();
    }
  } finally {
    if (btnAuth) btnAuth.style.opacity = '1';
  }
}

const SUBSCRIPTION_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 Hours Cache to protect Firebase quota

function saveSubscriptionState(state) {
  if (!state) return;
  // Preserve authoritative server-signed seal from kasyhq.com/api/subscription
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local && typeof chrome.storage.local.set === 'function') {
    chrome.storage.local.set({ rp_license_data: state });
  }
}

let isFreemiumManagerInitialized = false;

function initializeFreemiumManager() {
  if (isFreemiumManagerInitialized) return;
  isFreemiumManagerInitialized = true;

  const btnAuth = document.getElementById('btnGoogleAuth');
  const btnSignOut = document.getElementById('btnSignOut');
  const btnUpgrade = document.getElementById('btnUpgradePremium');

  chrome.storage.local.get(['rp_user_profile', 'rp_license_data', 'rp_user_email', 'rp_chrome_email'], (data) => {
    if (data.rp_user_profile && data.rp_user_profile.email) {
      const sec = (typeof ReturnPilotSecurity !== 'undefined') ? ReturnPilotSecurity : null;
      if (sec && typeof sec.isDisposableOrSuspiciousEmail === 'function' && sec.isDisposableOrSuspiciousEmail(data.rp_user_profile.email)) {
        console.warn('[ReturnPilot Security] Disposable / suspicious temp-email rejected:', data.rp_user_profile.email);
        currentUserProfile = null;
        currentSubscriptionState = { valid: false, tier: 'FREE' };
        chrome.storage.local.remove(['rp_user_profile', 'rp_license_data', 'rp_auth_token']);
        updateUserAuthButtonUI();
        updateFreemiumUI();
        return;
      }

      currentUserProfile = data.rp_user_profile;
      
      const cached = data.rp_license_data;
      const isUnexpired = cached && (!cached.expiresAt || cached.expiresAt > Date.now());
      const isAuthenticPremium = cached && cached.valid && (cached.tier === 'PREMIUM') && isUnexpired && (!sec || sec.verifyLicenseSeal(cached));

      if (isAuthenticPremium) {
        currentSubscriptionState = cached;
        updateUserAuthButtonUI();
        updateFreemiumUI();

        // 24-Hour Silent Refresh in Background (never downgrades during active use)
        const lastChecked = cached.lastCheckedAt || 0;
        if ((Date.now() - lastChecked) > SUBSCRIPTION_CACHE_TTL_MS) {
          checkSubscriptionServerStatus(currentUserProfile.email, false);
        }
      } else if (cached && cached.expired) {
        currentSubscriptionState = cached;
        updateUserAuthButtonUI();
        updateFreemiumUI();
      } else {
        // Missing or fresh sign-in: show initial trial and verify in background
        currentSubscriptionState = cached || {
          valid: true,
          tier: 'PREMIUM',
          isTrial: true,
          daysLeft: 7,
          expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
          lastCheckedAt: Date.now(),
          seal: ''
        };
        updateUserAuthButtonUI();
        updateFreemiumUI();
        checkSubscriptionServerStatus(currentUserProfile.email, true);
      }
    } else {
      currentUserProfile = null;
      currentSubscriptionState = { valid: false, tier: 'FREE' };
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local && typeof chrome.storage.local.remove === 'function') {
        chrome.storage.local.remove(['rp_user_profile', 'rp_license_data']);
      }
      updateUserAuthButtonUI();
      updateFreemiumUI();
    }
  });

  // Live synchronization of authentication and subscription state across popup lifecycles
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local') {
        if (changes.rp_user_profile) {
          currentUserProfile = changes.rp_user_profile.newValue || null;
          updateUserAuthButtonUI();
        }
        if (changes.rp_license_data) {
          currentSubscriptionState = changes.rp_license_data.newValue || { valid: false, tier: 'FREE' };
          updateFreemiumUI();
        }
      }
    });
  }

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.request === 'oauth-success' && msg.profile) {
        currentUserProfile = msg.profile;
        updateUserAuthButtonUI();
        updateFreemiumUI();
      }
    });
  }

  if (btnAuth) {
    btnAuth.onclick = () => {
      if (currentUserProfile && currentUserProfile.email) {
        return; // Already signed in
      }
      triggerGoogleSignIn(true);
    };
  }

  if (btnSignOut) {
    btnSignOut.onclick = () => performSignOut();
  }

  const btnProfileTrigger = document.getElementById('btnProfileTrigger');
  const profileDropdown   = document.getElementById('profileDropdown');
  const pdBtnLogout       = document.getElementById('pdBtnLogout');

  if (btnProfileTrigger && profileDropdown) {
    btnProfileTrigger.onclick = (e) => {
      e.stopPropagation();
      const willShow = profileDropdown.hidden;
      profileDropdown.hidden = !willShow;
      btnProfileTrigger.classList.toggle('active', willShow);
      btnProfileTrigger.setAttribute('aria-expanded', String(willShow));
    };

    document.addEventListener('click', (e) => {
      if (!profileDropdown.hidden && !profileDropdown.contains(e.target) && !btnProfileTrigger.contains(e.target)) {
        profileDropdown.hidden = true;
        btnProfileTrigger.classList.remove('active');
        btnProfileTrigger.setAttribute('aria-expanded', 'false');
      }
    });
  }

  if (pdBtnLogout) {
    pdBtnLogout.onclick = () => {
      if (profileDropdown) profileDropdown.hidden = true;
      if (btnProfileTrigger) {
        btnProfileTrigger.classList.remove('active');
        btnProfileTrigger.setAttribute('aria-expanded', 'false');
      }
      performSignOut();
    };
  }

  const pdBtnShareWhatsApp = document.getElementById('pdBtnShareWhatsApp');
  if (pdBtnShareWhatsApp) {
    pdBtnShareWhatsApp.onclick = (e) => {
      e.preventDefault();
      if (profileDropdown) profileDropdown.hidden = true;
      if (btnProfileTrigger) {
        btnProfileTrigger.classList.remove('active');
        btnProfileTrigger.setAttribute('aria-expanded', 'false');
      }
      handleReferColleagueClick();
    };
  }

  // ── Two-Way Display Mode Controls (Normal Extension Popup <-> Side Panel) ──
  const currentPath = (typeof window !== 'undefined' && window.location && window.location.pathname) || '';
  const currentSearch = (typeof window !== 'undefined' && window.location && window.location.search) || '';
  isSidePanelSurface = isSidePanelSurface || (typeof document !== 'undefined' && document.documentElement && document.documentElement.classList.contains('rp-view-sidepanel')) ||
    currentPath.indexOf('sidepanel.html') !== -1 ||
    currentSearch.indexOf('view=sidepanel') !== -1;

  const btnSurfaceToggle = document.getElementById('btnSurfaceToggle');
  const surfaceToggleText = document.getElementById('surfaceToggleText');
  const iconSide = document.getElementById('surfaceToggleIconSide');
  const iconWindow = document.getElementById('surfaceToggleIconWindow');

  if (isSidePanelSurface) {
    if (surfaceToggleText) surfaceToggleText.textContent = 'Normal Extension';
    if (btnSurfaceToggle) btnSurfaceToggle.title = 'Switch to standard Chrome Extension popup';
    if (iconSide) iconSide.style.display = 'none';
    if (iconWindow) iconWindow.style.display = 'inline-block';
  } else {
    if (surfaceToggleText) surfaceToggleText.textContent = 'Side Panel';
    if (btnSurfaceToggle) btnSurfaceToggle.title = 'Dock into Chrome Side Panel alongside portal';
    if (iconSide) iconSide.style.display = 'inline-block';
    if (iconWindow) iconWindow.style.display = 'none';
  }

  function triggerOpenSidePanel() {
    const browserSidebar = (typeof browser !== 'undefined' && browser.sidebarAction)
      ? browser.sidebarAction
      : ((typeof chrome !== 'undefined' && chrome.sidebarAction) ? chrome.sidebarAction : null);

    // 1. Firefox support via sidebarAction
    if (browserSidebar && typeof browserSidebar.open === 'function') {
      try {
        const sidepanelUrl = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL)
          ? chrome.runtime.getURL('popup/sidepanel.html')
          : ((typeof browser !== 'undefined' && browser.runtime && browser.runtime.getURL) ? browser.runtime.getURL('popup/sidepanel.html') : '/popup/sidepanel.html');
        if (typeof browserSidebar.setPanel === 'function') {
          browserSidebar.setPanel({ panel: sidepanelUrl });
        }
        browserSidebar.open();
        setTimeout(() => { try { window.close(); } catch (_) {} }, 100);
        return true;
      } catch (err) {
        console.warn('[ReturnPilot] Failed sidebarAction.open:', err);
      }
    }

    // 2. Chromium / Edge support via chrome.sidePanel
    if (typeof chrome !== 'undefined' && chrome.sidePanel && typeof chrome.sidePanel.open === 'function') {
      const isTargetGst = currentUrl && currentUrl.hostname && currentUrl.hostname.toLowerCase().endsWith('gst.gov.in');

      if (isTargetGst && currentActiveTabId && currentActiveTabId > 0) {
        // Active tab is GST: ensure side panel is enabled for this tab and open directly
        if (chrome.sidePanel.setOptions) {
          chrome.sidePanel.setOptions({
            tabId: currentActiveTabId,
            path: `popup/sidepanel.html?tabId=${currentActiveTabId}`,
            enabled: true
          }).catch(() => {});
        }
        chrome.sidePanel.open({ tabId: currentActiveTabId }).then(() => {
          setTimeout(() => { try { window.close(); } catch (_) {} }, 100);
        }).catch((err) => {
          console.warn('[ReturnPilot] Failed sidePanel.open with tabId:', currentActiveTabId, err);
          window.close();
        });
        return true;
      }

      // If user clicked side panel from a non-GST tab: side panel can ONLY be shown on GST tabs!
      // Look for an existing GST tab to open the side panel alongside
      chrome.tabs.query({ url: ['*://*.gst.gov.in/*'] }, (gstTabs) => {
        const existingGstTab = (gstTabs && (gstTabs.find(t => t.active) || gstTabs[0])) || null;
        if (existingGstTab && existingGstTab.id) {
          chrome.tabs.update(existingGstTab.id, { active: true }, (switchedTab) => {
            if (switchedTab && switchedTab.windowId && chrome.windows) {
              chrome.windows.update(switchedTab.windowId, { focused: true }).catch(() => {});
            }
            if (chrome.sidePanel.setOptions) {
              chrome.sidePanel.setOptions({
                tabId: existingGstTab.id,
                path: `popup/sidepanel.html?tabId=${existingGstTab.id}`,
                enabled: true
              }).catch(() => {});
            }
            chrome.sidePanel.open({ tabId: existingGstTab.id }).then(() => {
              setTimeout(() => { try { window.close(); } catch (_) {} }, 100);
            }).catch(() => { window.close(); });
          });
        } else {
          // No GST tab open: create GST dashboard tab and enable side panel on it
          chrome.tabs.create({ url: 'https://return.gst.gov.in/returns/auth/dashboard', active: true }, (newTab) => {
            if (newTab && newTab.id && chrome.sidePanel.setOptions) {
              chrome.sidePanel.setOptions({
                tabId: newTab.id,
                path: `popup/sidepanel.html?tabId=${newTab.id}`,
                enabled: true
              }).catch(() => {});
            }
            setTimeout(() => { try { window.close(); } catch (_) {} }, 150);
          });
        }
      });
      return true;
    }
    window.close();
    return false;
  }

  const btnLiveLogs = document.getElementById('btnLiveLogs');
  if (btnLiveLogs) {
    btnLiveLogs.onclick = (e) => {
      e.preventDefault();
      if (typeof window.toggleFlightRecorder === 'function') {
        window.toggleFlightRecorder();
      } else {
        const launcher = document.getElementById('rp-dev-launcher');
        if (launcher) launcher.click();
      }
    };
  }

  if (btnSurfaceToggle) {
    btnSurfaceToggle.onclick = (e) => {
      e.preventDefault();
      if (isSidePanelSurface) {
        // Switch from Side Panel to Normal Extension Popup
        const browserSidebar = (typeof browser !== 'undefined' && browser.sidebarAction)
          ? browser.sidebarAction
          : ((typeof chrome !== 'undefined' && chrome.sidebarAction) ? chrome.sidebarAction : null);
        if (browserSidebar && typeof browserSidebar.close === 'function') {
          try { browserSidebar.close(); } catch (_) {}
        }
        if (typeof chrome !== 'undefined' && chrome.action && chrome.action.openPopup) {
          try { chrome.action.openPopup(); } catch (_) {}
        }
        window.close();
      } else {
        // Switch from Normal Extension Popup to Side Panel (opens immediately!)
        triggerOpenSidePanel();
      }
    };
  }

  // Profile Dropdown Surface Mode Buttons (Two-Way)
  const pdSurfaceBtns = [
    { el: document.getElementById('pdViewBtnSidepanel'), mode: 'sidepanel' },
    { el: document.getElementById('pdViewBtnPopup') || document.getElementById('pdViewBtnWindow'), mode: 'popup' }
  ];

  function updateSurfaceButtons(activeMode) {
    const normalizedMode = (activeMode === 'sidepanel') ? 'sidepanel' : 'popup';
    pdSurfaceBtns.forEach(({ el, mode }) => {
      if (el) el.classList.toggle('active', mode === normalizedMode);
    });
  }

  // Active button reflects current surface
  updateSurfaceButtons(isSidePanelSurface ? 'sidepanel' : 'popup');

  pdSurfaceBtns.forEach(({ el, mode }) => {
    if (el) {
      el.onclick = (e) => {
        e.preventDefault();
        updateSurfaceButtons(mode);
        if (mode === 'sidepanel') {
          if (!isSidePanelSurface) {
            triggerOpenSidePanel();
          }
        } else if (mode === 'popup') {
          if (isSidePanelSurface) {
            const browserSidebar = (typeof browser !== 'undefined' && browser.sidebarAction)
              ? browser.sidebarAction
              : ((typeof chrome !== 'undefined' && chrome.sidebarAction) ? chrome.sidebarAction : null);
            if (browserSidebar && typeof browserSidebar.close === 'function') {
              try { browserSidebar.close(); } catch (_) {}
            }
            if (typeof chrome !== 'undefined' && chrome.action && chrome.action.openPopup) {
              try { chrome.action.openPopup(); } catch (_) {}
            }
            window.close();
          }
        }
      };
    }
  });

  if (btnUpgrade) {
    btnUpgrade.onclick = () => {
      if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
        chrome.tabs.create({ url: 'https://kasyhq.com/pricing' });
      } else {
        window.open('https://kasyhq.com/pricing', '_blank');
      }
    };
  }

  const btnManageSub = document.getElementById('btnManageSub');
  if (btnManageSub) {
    btnManageSub.onclick = () => {
      if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
        chrome.tabs.create({ url: 'https://kasyhq.com/account' });
      } else {
        window.open('https://kasyhq.com/account', '_blank');
      }
    };
  }

  const premModal = document.getElementById('premiumUpgradeModal');
  const closePremBtn = document.getElementById('closePremiumModalBtn');
  if (closePremBtn && premModal) {
    closePremBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      premModal.hidden = true;
    });
  }
  if (premModal) {
    premModal.addEventListener('click', (e) => {
      if (e.target === premModal) premModal.hidden = true;
    });
  }

  const btnModalPay = document.getElementById('btnModalRazorpay');
  if (btnModalPay) {
    btnModalPay.onclick = () => {
      if (premModal) premModal.hidden = true;
      window.open('https://kasyhq.com/returnpilot-gst', '_blank');
    };
  }

  const btnModalSignIn = document.getElementById('btnModalSignIn');
  if (btnModalSignIn) {
    btnModalSignIn.onclick = () => {
      if (premModal) premModal.hidden = true;
      triggerGoogleSignIn(true);
    };
  }
}

function performSignOut() {
  currentUserProfile = null;
  currentSubscriptionState = { valid: false, tier: 'FREE' };
  
  if (typeof chrome !== 'undefined' && chrome.identity && chrome.identity.clearAllCachedAuthTokens) {
    try {
      chrome.identity.clearAllCachedAuthTokens(() => {});
    } catch (_) {}
  }

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.remove(['rp_user_profile', 'rp_license_data', 'rp_auth_token'], () => {
      updateUserAuthButtonUI();
      updateFreemiumUI();
    });
  } else {
    updateUserAuthButtonUI();
    updateFreemiumUI();
  }
}

function parseExpiryTimestamp(val) {
  if (!val) return null;
  if (typeof val === 'number') {
    return val < 10000000000 ? val * 1000 : val;
  }
  if (typeof val === 'string') {
    if (/^\d+$/.test(val)) {
      const num = parseInt(val, 10);
      return num < 10000000000 ? num * 1000 : num;
    }
    const parsed = Date.parse(val);
    return isNaN(parsed) ? null : parsed;
  }
  return null;
}



window.showPremiumUpgradeModal = function(reason) {
  const modal = document.getElementById('premiumUpgradeModal');
  const catEl = document.querySelector('#premiumUpgradeModal .technical-category');
  const titleEl = document.querySelector('#premiumUpgradeModal h2');
  const reasonText = document.getElementById('premiumModalReasonText');
  const btnPrimary = document.getElementById('btnModalPayRazorpay');
  const btnSecondary = document.getElementById('btnModalSignIn');

  const isTampered = typeof reason === 'string' && (
    reason.includes('Security Verification Notice') || 
    reason.includes('unauthorized') || 
    reason.includes('tamper') || 
    reason.includes('runtime environment')
  );

  if (isTampered) {
    if (catEl) catEl.textContent = 'OFFICIAL INTEGRITY NOTICE';
    if (titleEl) titleEl.textContent = 'Official Version Required';
    if (reasonText) reasonText.textContent = reason;
    if (btnPrimary) {
      btnPrimary.innerHTML = 'Download Official Release from Web Store ↗';
      btnPrimary.onclick = () => {
        window.open('https://kasyhq.com/returnpilot-gst', '_blank');
      };
    }
    if (btnSecondary) {
      btnSecondary.textContent = 'Dismiss';
      btnSecondary.onclick = () => {
        if (modal) modal.hidden = true;
      };
    }
    if (modal) modal.hidden = false;
    return;
  }

  const isGuest = !currentUserProfile || !currentUserProfile.email;

  if (isGuest) {
    if (catEl) catEl.textContent = '🎁 7-DAY FREE TRIAL';
    if (titleEl) titleEl.textContent = 'Unlock All Features Free for 7 Days';
    if (reasonText) reasonText.textContent = 'Sign in with your Google account to instantly start your 7-day trial. No credit card required.';
    if (btnPrimary) {
      btnPrimary.innerHTML = 'Sign In with Google — Start Trial';
      btnPrimary.onclick = () => {
        if (modal) modal.hidden = true;
        if (typeof triggerGoogleSignIn === 'function') {
          triggerGoogleSignIn(true);
        } else {
          const btnAuth = document.getElementById('btnGoogleAuth');
          if (btnAuth) btnAuth.click();
        }
      };
    }
    if (btnSecondary) {
      btnSecondary.textContent = 'Maybe Later';
      btnSecondary.onclick = () => {
        if (modal) modal.hidden = true;
      };
    }
  } else {
    if (catEl) catEl.textContent = '⚡ PREMIUM LICENSE EXPIRED';
    if (titleEl) titleEl.textContent = 'Upgrade to ReturnPilot Premium';
    if (reasonText) reasonText.textContent = (typeof reason === 'string' && reason) 
      ? reason 
      : 'Your 7-day free trial has ended. Upgrade to Premium for ₹199/month (or ₹1,999/year) to continue downloading Excel and PDF reports.';
    if (btnPrimary) {
      btnPrimary.innerHTML = 'Upgrade to Premium — ₹199/mo';
      btnPrimary.onclick = () => {
        window.open('https://kasyhq.com/checkout?product=GST', '_blank');
      };
    }
    if (btnSecondary) {
      btnSecondary.textContent = 'Close';
      btnSecondary.onclick = () => {
        if (modal) modal.hidden = true;
      };
    }
  }

  if (modal) modal.hidden = false;
};

async function checkSubscriptionServerStatus(email, force = false) {
  if (!email) return;
  const cleanEmail = email.trim().toLowerCase();
  
  if (!force) {
    const stored = await new Promise(r => chrome.storage.local.get(['rp_license_data'], r));
    const lastChecked = stored?.rp_license_data?.lastCheckedAt || 0;
    if (stored?.rp_license_data?.valid && (Date.now() - lastChecked) < SUBSCRIPTION_CACHE_TTL_MS) {
      return; // Skip remote query completely to protect Firebase quota
    }
  }

  // Visual feedback: Show "Verifying Plan…" with spinner animation while query is in-flight
  if (currentSubscriptionState) {
    currentSubscriptionState.verifying = true;
  } else {
    currentSubscriptionState = { valid: false, tier: 'FREE', verifying: true };
  }
  updateFreemiumUI();

  const ts = Date.now();
  const subUrl = `https://kasyhq.com/api/subscription?email=${encodeURIComponent(cleanEmail)}&ts=${ts}&_t=${ts}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3500);

  try {
    const response = await fetch(subUrl, { signal: controller.signal });
    if (response.ok) {
      const data = await response.json();
      const userPlan = data?.plan ? String(data.plan).trim().toUpperCase() : 'FREE';

      if (userPlan === 'PREMIUM') {
        const rawExpiry = data.expiresAt || data.validUntil;
        const expiryMs = parseExpiryTimestamp(rawExpiry);
        const now = Date.now();

        if (expiryMs && now > expiryMs) {
          currentSubscriptionState = { 
            valid: false, 
            tier: 'FREE', 
            expired: true, 
            expiresAt: expiryMs,
            subscribedAt: parseExpiryTimestamp(data.subscribedAt),
            subscriptionCount: data.subscriptionCount || 1,
            lastPaymentDate: data.lastPaymentDate || data.subscribedAt || null,
            paymentId: data.paymentId || data.razorpayPaymentId || null,
            lastCheckedAt: now,
            seal: data.seal || ''
          };
        } else {
          let daysLeft = null;
          if (expiryMs) {
            daysLeft = Math.max(0, Math.ceil((expiryMs - now) / (1000 * 60 * 60 * 24)));
          }
          currentSubscriptionState = { 
            valid: true, 
            tier: 'PREMIUM', 
            expiresAt: expiryMs,
            daysLeft: daysLeft,
            subscribedAt: parseExpiryTimestamp(data.subscribedAt),
            subscriptionCount: data.subscriptionCount || 1,
            lastPaymentDate: data.lastPaymentDate || data.subscribedAt || null,
            paymentId: data.paymentId || data.razorpayPaymentId || null,
            lastCheckedAt: now,
            seal: data.seal || ''
          };
        }
      } else if (data && data.trial && data.trial.isTrialActive) {
        // Server-Side 7-Day Trial Verified in Cloudflare & Firestore
        const trialExpiryMs = parseExpiryTimestamp(data.trial.expiresAt);
        currentSubscriptionState = {
          valid: true,
          tier: 'PREMIUM',
          isTrial: true,
          daysLeft: data.trial.daysLeft || 1,
          expiresAt: trialExpiryMs,
          lastCheckedAt: Date.now(),
          seal: data.seal || (data.trial && data.trial.seal) || ''
        };
      } else {
        // Server-Authoritative Free / Expired Trial
        currentSubscriptionState = {
          valid: false,
          tier: 'FREE',
          isTrial: false,
          expired: true,
          lastCheckedAt: Date.now(),
          seal: ''
        };
      }
    }
  } catch (err) {
    // Network or rate-limit notice: Preserve existing authentic license state without downgrade
    console.debug('[ReturnPilot Sync]: Background license sync deferred:', err.message);
  } finally {
    clearTimeout(timeoutId);
    if (currentSubscriptionState && currentSubscriptionState.verifying) {
      currentSubscriptionState.verifying = false;
    }
    saveSubscriptionState(currentSubscriptionState);
    updateFreemiumUI();
  }
}

function updateFreemiumUI() {
  const badge      = document.getElementById('userPlanBadge');
  const badgeText  = document.getElementById('userPlanText');
  const btnSignOut = document.getElementById('btnSignOut');
  const btnUpgrade = document.getElementById('btnUpgradePremium');
  const btnGoogleAuth = document.getElementById('btnGoogleAuth');

  const isLoggedIn  = Boolean(currentUserProfile && currentUserProfile.email);
  const isPremium   = isCurrentUserPremium();

  if (badge && badgeText) {
    badge.style.visibility = 'visible';
    const badgeSvg = badge.querySelector('svg');
    if (currentSubscriptionState && currentSubscriptionState.verifying) {
      badge.className = 'plan-badge verifying-badge';
      if (badgeSvg) {
        replaceSvgContent(badgeSvg, `<svg class="badge-spin" width="12" height="12" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="#93c5fd" stroke-width="2.5" opacity="0.4"></circle><path d="M12 3a9 9 0 0 1 9 9" stroke="#2563eb" stroke-width="2.5" stroke-linecap="round"></path></svg>`);
      }
      badgeText.textContent = 'Verifying Plan…';
      badge.title = 'Verifying account subscription status...';
    } else if (isPremium) {
      badge.className = 'plan-badge premium-badge';
      if (badgeSvg) {
        replaceSvgContent(badgeSvg, `<svg width="11" height="11" viewBox="0 0 24 24" fill="#f59e0b" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`);
      }
      if (currentSubscriptionState.isTrial) {
        badgeText.textContent = `7-Day Free Trial (${currentSubscriptionState.daysLeft}d left)`;
      } else if (currentSubscriptionState.daysLeft !== null && currentSubscriptionState.daysLeft !== undefined && currentSubscriptionState.daysLeft <= 10) {
        badgeText.textContent = `Premium Member (${currentSubscriptionState.daysLeft}d left)`;
      } else {
        badgeText.textContent = 'Premium Member';
      }
      badge.title = currentSubscriptionState.expiresAt 
        ? `Premium subscription active until ${formatDdMmYyyy(currentSubscriptionState.expiresAt)}`
        : 'Premium subscription active';
    } else if (isLoggedIn && currentSubscriptionState && currentSubscriptionState.expired) {
      badge.className = 'plan-badge free-badge';
      if (badgeSvg) {
        replaceSvgContent(badgeSvg, `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"></path></svg>`);
      }
      badgeText.textContent = 'Free Plan (Expired)';
      badge.title = 'Your Premium subscription has expired. Upgrade to renew access.';
    } else {
      badge.className = 'plan-badge free-badge';
      if (badgeSvg) {
        replaceSvgContent(badgeSvg, `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"></path></svg>`);
      }
      badgeText.textContent = 'Free Plan';
      badge.title = 'Free Plan active';
    }
  }

  if (badge) {
    if (isLoggedIn && !currentSubscriptionState?.verifying) {
      badge.style.cursor = 'pointer';
      if (!badge.getAttribute('data-bound-verify')) {
        badge.setAttribute('data-bound-verify', 'true');
        badge.addEventListener('click', () => {
          if (currentUserProfile && currentUserProfile.email && (!currentSubscriptionState || !currentSubscriptionState.verifying)) {
            checkSubscriptionServerStatus(currentUserProfile.email, true);
          }
        });
      }
    } else {
      badge.style.cursor = 'default';
    }
  }

  const btnProfileTrigger = document.getElementById('btnProfileTrigger');
  const profileDropdown   = document.getElementById('profileDropdown');

  if (isLoggedIn) {
    if (btnGoogleAuth) btnGoogleAuth.hidden = true;
    if (btnSignOut) btnSignOut.hidden = true;
    if (btnProfileTrigger) btnProfileTrigger.hidden = false;

    const displayName = currentUserProfile.name || (currentUserProfile.email ? currentUserProfile.email.split('@')[0] : 'Account');
    const initial = (displayName[0] || 'A').toUpperCase();

    const pAvatar = document.getElementById('profileTriggerAvatar');
    const pName = document.getElementById('profileTriggerName');
    if (pName) pName.textContent = displayName;

    const pdAvatar = document.getElementById('pdAvatar');
    const pdName = document.getElementById('pdName');
    const pdEmail = document.getElementById('pdEmail');
    const pdPlanCard = document.getElementById('pdPlanCard');
    const pdPlanLabel = document.getElementById('pdPlanLabel');
    const pdPlanStatus = document.getElementById('pdPlanStatus');
    const pdExpiryRow = document.getElementById('pdExpiryRow');
    const pdExpiry = document.getElementById('pdExpiry');

    if (pdName) pdName.textContent = currentUserProfile.name || displayName;
    if (pdEmail) pdEmail.textContent = currentUserProfile.email || '—';

    // Google Profile Photo (directly from Google user profile)
    const picUrl = currentUserProfile && currentUserProfile.picture ? currentUserProfile.picture : null;
    if (picUrl) {
      if (pAvatar) {
        pAvatar.innerHTML = `<img src="${escapeHtml(picUrl)}" alt="" class="profile-avatar-img" referrerpolicy="no-referrer" />`;
        pAvatar.style.background = 'transparent';
      }
      if (pdAvatar) {
        pdAvatar.innerHTML = `<img src="${escapeHtml(picUrl)}" alt="" class="profile-avatar-img" referrerpolicy="no-referrer" />`;
        pdAvatar.style.background = 'transparent';
      }
    } else {
      if (pAvatar) {
        pAvatar.textContent = initial;
        pAvatar.style.background = '';
      }
      if (pdAvatar) {
        pdAvatar.textContent = initial;
        pdAvatar.style.background = '';
      }
    }

    if (isPremium) {
      if (pdPlanCard) {
        pdPlanCard.classList.remove('pd-plan-card-free');
        pdPlanCard.classList.add('pd-plan-card-premium');
      }
      if (pdPlanLabel) pdPlanLabel.textContent = 'Premium Member';
      if (pdPlanStatus) {
        pdPlanStatus.innerHTML = '<span class="pd-active-dot"></span>ACTIVE';
        pdPlanStatus.className = 'pd-plan-status-pill pd-status-premium';
      }
      if (pdExpiryRow && pdExpiry) {
        if (currentSubscriptionState?.expiresAt) {
          pdExpiryRow.hidden = false;
          pdExpiry.textContent = `Expires: ${formatDdMmYyyy(currentSubscriptionState.expiresAt)}`;
        } else {
          pdExpiryRow.hidden = true;
        }
      }
    } else {
      if (pdPlanCard) {
        pdPlanCard.classList.remove('pd-plan-card-premium');
        pdPlanCard.classList.add('pd-plan-card-free');
      }
      if (pdPlanLabel) pdPlanLabel.textContent = 'Free Plan';
      if (pdPlanStatus) {
        pdPlanStatus.textContent = currentSubscriptionState?.expired ? 'Expired' : 'Free';
        pdPlanStatus.className = 'pd-plan-status-pill pd-status-free';
      }
      if (pdExpiryRow) pdExpiryRow.hidden = true;
    }
  } else {
    if (btnProfileTrigger) btnProfileTrigger.hidden = true;
    if (profileDropdown) profileDropdown.hidden = true;
    if (btnGoogleAuth) btnGoogleAuth.hidden = false;
    if (btnSignOut) btnSignOut.hidden = true;
  }

  if (btnUpgrade) {
    btnUpgrade.hidden = isPremium || Boolean(currentSubscriptionState?.verifying);
  }

  // Update Auto-Fill Login Button Text based on Plan
  const btnAutoFill = document.getElementById('btnAutoFillLogin');
  if (btnAutoFill) {
    if (isPremium) {
      btnAutoFill.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
        </svg>
        1-Click Auto-Fill & Login
      `;
      btnAutoFill.title = "⚡ ReturnPilot Premium: 1-Click AI CAPTCHA Auto-Fill & Automatic Login";
    } else {
      btnAutoFill.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
        </svg>
        Auto-Fill Login
      `;
      btnAutoFill.title = "Auto-fill credentials (Manual CAPTCHA fill required for Free Plan)";
    }
  }
}

// ── LOGIN ACCOUNT MANAGER ───────────────────────────────────────────────────

function initializeLoginManager() {
  const elSearch = getElement('loginSearchAccount');
  const elSelect = getElement('loginSavedAccount');
  const elUser = getElement('loginUsername');
  const elPass = getElement('loginPassword');
  const btnSave = getElement('btnSaveAccount');
  const btnImport = getElement('btnImportAccounts');
  const fileInput = getElement('csvFileInput');
  const btnDelete = getElement('btnDeleteAccount');
  const btnAutoFill = getElement('btnAutoFillLogin');
  const btnTogglePw = getElement('loginTogglePassword');

  // Load from Storage
  chrome.storage.local.get(['rp_saved_accounts'], (data) => {
    savedAccounts = data.rp_saved_accounts || [];
    refreshAccountDropdown(elSelect);
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.rp_saved_accounts) {
      savedAccounts = changes.rp_saved_accounts.newValue || [];
      refreshAccountDropdown(elSelect);
    }
  });

  // Auto-sync active GST account's Legal Name and GSTIN from current live portal tab
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeTab = tabs && tabs[0];
    if (activeTab && activeTab.url && activeTab.url.includes('gst.gov.in') && !activeTab.url.includes('/services/login')) {
      chrome.tabs.sendMessage(activeTab.id, { request: 'get-page-taxpayer-info' }, (res) => {
        if (chrome.runtime.lastError || !res) return;
        const liveGstin = (res.gstin || '').trim().toUpperCase();
        const liveName = (res.tradeName || res.legalName || '').trim();
        if (liveGstin) {
          const panFromLive = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]/.test(liveGstin)
            ? liveGstin.slice(2, 12).toLowerCase()
            : '';
          chrome.storage.local.get(['rp_saved_accounts'], (sData) => {
            const accs = Array.isArray(sData.rp_saved_accounts) ? sData.rp_saved_accounts : [];
            let modified = false;
            const updatedAccs = accs.map(a => {
              const aGstin = (a.gstin || '').trim().toUpperCase();
              const aUser = (a.username || '').trim().toLowerCase();

              // If account already has a different GSTIN, NEVER cross-contaminate it!
              if (aGstin && aGstin !== liveGstin) return a;

              // Only match if GSTIN already matches, or username matches GSTIN or PAN
              const isMatch = (aGstin === liveGstin) ||
                              (!aGstin && aUser && (aUser === liveGstin.toLowerCase() || (panFromLive && aUser === panFromLive)));
              if (isMatch) {
                const newN = liveName || a.clientName;
                if (a.clientName !== newN || a.gstin !== liveGstin) {
                  modified = true;
                  return { ...a, clientName: newN, gstin: liveGstin };
                }
              }
              return a;
            });
            if (modified) {
              chrome.storage.local.set({ rp_saved_accounts: updatedAccs });
            }
          });
        }
      });
    }
  });

  // Unified Real-time Search & Select Account Handler
  if (elSearch) {
    const showAccountMenu = (searchQuery = '') => {
      const menu = getElement('searchResultsDropdown');
      if (!menu) return;

      const queryLower = searchQuery.toLowerCase().trim();
      const matchingAccounts = savedAccounts.filter(acc => {
        if (!queryLower) return true;
        return (acc.clientName || '').toLowerCase().includes(queryLower) ||
               (acc.gstin || '').toLowerCase().includes(queryLower) ||
               (acc.username || '').toLowerCase().includes(queryLower);
      });

      if (matchingAccounts.length === 0) {
        menu.hidden = true;
        menu.innerHTML = '';
        return;
      }

      menu.hidden = false;
      menu.innerHTML = '';

      matchingAccounts.forEach(acc => {
        const item = document.createElement('div');
        item.className = 'search-dropdown-item';
        
        const title = document.createElement('div');
        title.className = 'item-title';
        title.textContent = acc.clientName || acc.username;
        item.appendChild(title);

        let subParts = [];
        if (acc.gstin) subParts.push(acc.gstin);
        if (acc.username && acc.username !== acc.clientName) subParts.push(acc.username);
        if (subParts.length > 0) {
          const sub = document.createElement('div');
          sub.className = 'item-sub';
          sub.textContent = subParts.join(' | ');
          item.appendChild(sub);
        }

        const selectAcc = async (e) => {
          if (e) { e.preventDefault(); e.stopPropagation(); }
          if (elSelect) elSelect.value = acc.username;
          if (elUser) elUser.value = acc.username || '';
          if (elPass) {
          elPass.value = '';
          const _plain = await ReturnPilotVault.decrypt(acc.password || '');
          if (_plain) elPass.value = _plain;
        }
          if (elSearch) elSearch.value = acc.clientName || acc.gstin || acc.username;
          menu.hidden = true;
          menu.innerHTML = '';
        };

        item.onmousedown = selectAcc;
        item.onclick = selectAcc;

        menu.appendChild(item);
      });
    };

    elSearch.oninput = () => showAccountMenu(elSearch.value);
    elSearch.onfocus = () => { try { elSearch.select(); } catch (_) {} showAccountMenu(''); };
    elSearch.onclick = () => showAccountMenu('');

    document.addEventListener('click', (e) => {
      const menu = getElement('searchResultsDropdown');
      if (menu && !e.target.closest('.search-row-container')) {
        menu.hidden = true;
      }
    });
  }

  // Bulk Accounts CSV Import
  if (btnImport && fileInput) {
    btnImport.onclick = () => { fileInput.click(); };
    fileInput.onchange = (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      
      const reader = new FileReader();
      reader.onload = async (event) => {
        const text = event.target.result;
        const lines = text.split(/\r?\n/);
        let importedCount = 0;

        for (const line of lines) {
          const parts = line.split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
          if (parts.length < 2) return;

          const p0 = parts[0].toLowerCase(), p1 = parts[1].toLowerCase();
          if (p0.includes('user') || p0.includes('name') || p0.includes('gstin') || p1.includes('pass')) return;

          let clientName = '', gstin = '', username = '', password = '';
          if (parts.length >= 4) {
            clientName = parts[0];
            gstin = parts[1];
            username = parts[2];
            password = parts[3];
          } else if (parts.length === 3) {
            clientName = parts[0];
            username = parts[1];
            password = parts[2];
          } else {
            username = parts[0];
            password = parts[1];
          }

          if (username && password) {
            const existingIdx = savedAccounts.findIndex(a => a.username?.toLowerCase() === username.toLowerCase());
            const newEntry = {
              clientName: clientName || (existingIdx >= 0 ? savedAccounts[existingIdx].clientName : username),
              gstin: gstin || (existingIdx >= 0 ? savedAccounts[existingIdx].gstin : ''),
              username,
              password: await ReturnPilotVault.encrypt(password)
            };
            if (existingIdx >= 0) savedAccounts[existingIdx] = newEntry;
            else savedAccounts.push(newEntry);
            importedCount++;
          }
        }

        if (importedCount > 0) {
          chrome.storage.local.set({ rp_saved_accounts: savedAccounts }, () => {
            const searchQuery = elSearch ? elSearch.value.trim() : '';
            refreshAccountDropdown(elSelect, null, searchQuery);
            const orig = btnImport.innerHTML;
            btnImport.innerHTML = `Imported ${importedCount} ✓`;
            setTimeout(() => { btnImport.innerHTML = orig; }, 2000);
          });
        } else {
          showBannerNotice('⚠️ No valid Username & Password rows found in CSV file.', 5000);
        }
        fileInput.value = '';
      };
      reader.readAsText(file);
    };
  }

  // Toggle Password Visibility
  if (btnTogglePw) {
    btnTogglePw.onclick = () => {
      const type = elPass.type === 'password' ? 'text' : 'password';
      elPass.type = type;
    };
  }

  // Handle Dropdown Selection
  if (elSelect) {
    elSelect.onchange = async () => {
      const selectedId = elSelect.value;
      if (!selectedId) {
        if (elUser) elUser.value = '';
        if (elPass) elPass.value = '';
        return;
      }
      const acc = savedAccounts.find(a => a.username?.toLowerCase() === selectedId.toLowerCase());
      if (acc) {
        if (elUser) elUser.value = acc.username || '';
        if (elPass) {
          elPass.value = '';
          const _plain = await ReturnPilotVault.decrypt(acc.password || '');
          if (_plain) elPass.value = _plain;
        }
        if (elSearch) elSearch.value = acc.clientName || acc.gstin || acc.username;
        chrome.runtime.sendMessage({ action: 'PREFETCH_CAPTCHA' }).catch(() => {});
      }
    };
  }

  // Save Account (username & password required, clientName & gstin auto-enriched on login)
  if (btnSave) {
    btnSave.onclick = async () => {
      const username = elUser ? elUser.value.trim() : '';
      const password = elPass ? elPass.value.trim() : '';

      if (!username || !password) {
        showBannerNotice('⚠️ User / PAN and Password are required to save an account.', 5000);
        return;
      }

      const existingIndex = savedAccounts.findIndex(a => a.username?.toLowerCase() === username.toLowerCase());
      const existingAcc = existingIndex >= 0 ? savedAccounts[existingIndex] : null;
      const isPremium = isCurrentUserPremium();

      if (!isPremium && existingIndex < 0 && savedAccounts.length >= 3) {
        if (typeof window.showPremiumUpgradeModal === 'function') {
          window.showPremiumUpgradeModal('Free plan includes saving up to 3 GST login accounts. Upgrade to Premium (₹199/mo or ₹1,999/yr) for unlimited account storage & 1-Click AI Captcha Auto-Fill.');
        } else {
          showBannerNotice('⚠️ Free plan includes saving up to 3 accounts. Upgrade to Premium for unlimited storage.', 6000);
        }
        return;
      }

      const newAcc = {
        clientName: (existingAcc && existingAcc.clientName) ? existingAcc.clientName : username,
        gstin: (existingAcc && existingAcc.gstin) ? existingAcc.gstin : '',
        username,
        password: await ReturnPilotVault.encrypt(password)
      };
      
      if (existingIndex >= 0) savedAccounts[existingIndex] = newAcc;
      else savedAccounts.push(newAcc);

      chrome.storage.local.set({ rp_saved_accounts: savedAccounts }, () => {
        const searchQuery = elSearch ? elSearch.value.trim() : '';
        refreshAccountDropdown(elSelect, username, searchQuery);
        const originalText = btnSave.innerHTML;
        btnSave.innerHTML = 'Saved ✓';
        setTimeout(() => { btnSave.innerHTML = originalText; }, 1500);
      });
    };
  }

  // Delete Account
  if (btnDelete) {
    btnDelete.onclick = () => {
      const username = elUser ? elUser.value.trim() : '';
      if (!username) return;
      
      savedAccounts = savedAccounts.filter(a => a.username?.toLowerCase() !== username.toLowerCase());
      chrome.storage.local.set({ rp_saved_accounts: savedAccounts }, () => {
        if (elUser) elUser.value = '';
        if (elPass) elPass.value = '';
        if (elSearch) elSearch.value = '';
        refreshAccountDropdown(elSelect, null, '');
        const menu = getElement('searchResultsDropdown');
        if (menu) { menu.hidden = true; menu.innerHTML = ''; }
      });
    };
  }

  // Auto-Fill Login with AI Captcha Solver
  if (btnAutoFill) {
    btnAutoFill.onclick = async () => {
      const username = elUser ? elUser.value.trim() : '';
      const password = elPass ? elPass.value.trim() : '';
      
      if (!username || !password) {
        const banner = document.getElementById('login5sBanner');
        if (banner) {
          banner.className = 'login-5s-banner free-5s-banner';
          banner.innerHTML = `
            <div class="banner-top">
              <span class="banner-badge free-badge" style="background:#fee2e2; color:#dc2626; border-color:#fca5a5;">⚠️ ACCOUNT REQUIRED</span>
            </div>
            <div class="banner-title" style="color:#dc2626;">Select an Account First</div>
            <div class="banner-desc">Please select a saved account from the dropdown or enter credentials above.</div>
          `;
          banner.hidden = false;
          if (window._rp5sBannerTimeout) clearTimeout(window._rp5sBannerTimeout);
          window._rp5sBannerTimeout = setTimeout(() => { banner.hidden = true; }, 3000);
        }
        return;
      }

      chrome.storage.local.set({ gstUsername: username });

      const isPremium = isCurrentUserPremium();

      btnAutoFill.disabled = true;
      const originalText = btnAutoFill.innerHTML;
      btnAutoFill.innerHTML = isPremium ? '⚡ Auto-Logging In...' : '⚡ Credentials Auto-Filling...';

      showPopup5SecondNotice(isPremium);

      const encPassword = await ReturnPilotVault.encrypt(password);
      const accIdx = savedAccounts.findIndex(a => a.username?.toLowerCase() === username.toLowerCase());
      if (accIdx >= 0) {
        savedAccounts[accIdx].lastUsedAt = Date.now();
      }
      chrome.storage.local.set({ 
        gstUsername: username, 
        gstPassword: encPassword,
        rp_saved_accounts: savedAccounts,
        rp_last_autologin_ts: Date.now()
      }, () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (!tabs || !tabs[0]) {
            console.warn('[ReturnPilot Popup] No active tab found');
            btnAutoFill.disabled = false;
            btnAutoFill.innerHTML = originalText;
            return;
          }

          const activeTabId = tabs[0].id;

          chrome.tabs.sendMessage(activeTabId, {
            request: 'fill-and-submit-login',
            username: username,
            password: password,
            captcha: '',
            isPremium: isPremium,
            isAutoLogin: true
          }, (response) => {
            if (chrome.runtime.lastError || !response) {
              chrome.scripting.executeScript({
                target: { tabId: activeTabId },
                files: ['security/entanglement.js', 'content/login-contentscript.js']
              }, () => {
                setTimeout(() => {
                  chrome.tabs.sendMessage(activeTabId, {
                    request: 'fill-and-submit-login',
                    username: username,
                    password: password,
                    captcha: '',
                    isPremium: isPremium,
                    isAutoLogin: true
                  }, () => { if (chrome.runtime.lastError) {} });
                }, 200);
              });
            }

            btnAutoFill.innerHTML = isPremium ? 'Auto-Logging In... ⚡' : 'Auto-Filled (Fill CAPTCHA) ✓';
            if (isPremium) {
              showStatus('Logging in to GST Portal...');
            }

            // Poll active tab URL to transition from Quick Login screen to Return Dashboard on login success without closing side panel
            let checkCount = 0;
            const navCheckTimer = setInterval(() => {
              checkCount++;
              chrome.tabs.query({ active: true, currentWindow: true }, async (tList) => {
                if (tList && tList[0] && tList[0].url) {
                  const uLower = tList[0].url.toLowerCase();
                  if (!uLower.includes('/services/login')) {
                    clearInterval(navCheckTimer);
                    showStatus(null);
                    try { currentUrl = new URL(tList[0].url); } catch (_) {}
                    startupAsync('Login Success Navigation');
                  }
                }
              });
              if (checkCount >= 60) {
                clearInterval(navCheckTimer);
                showStatus(null);
              }
            }, 300);

            setTimeout(() => {
              btnAutoFill.innerHTML = originalText;
              btnAutoFill.disabled = false;
            }, 3000);
          });
        });
      });
    };
  }
}

function refreshAccountDropdown(selectElement, selectedUsername = null, searchQuery = '') {
  if (!selectElement) return;
  selectElement.innerHTML = '<option value="">-- Select an Account --</option>';
  
  const query = (searchQuery || '').toLowerCase();

  const filtered = savedAccounts.filter(acc => {
    if (!query) return true;
    const nameMatch = (acc.clientName || '').toLowerCase().includes(query);
    const gstinMatch = (acc.gstin || '').toLowerCase().includes(query);
    const userMatch = (acc.username || '').toLowerCase().includes(query);
    return nameMatch || gstinMatch || userMatch;
  });

  // Databind saved accounts to select dropdown

  filtered.forEach(acc => {
    const opt = document.createElement('option');
    opt.value = acc.username;
    // Display clean Client Name (or Username if Client Name is not set)
    opt.textContent = acc.clientName || acc.username;
    
    // Detailed tooltip on hover
    let titleText = acc.clientName || acc.username;
    if (acc.gstin) titleText += ` | ${acc.gstin}`;
    if (acc.username && acc.username !== acc.clientName) titleText += ` (${acc.username})`;
    opt.title = titleText;

    selectElement.appendChild(opt);
  });

  if (selectedUsername) {
    selectElement.value = selectedUsername;
  }
}

function showPopup5SecondNotice(isPremium) {
  const banner = document.getElementById('login5sBanner');
  if (!banner) return;

  if (window._rp5sBannerTimeout) clearTimeout(window._rp5sBannerTimeout);

  if (isPremium) {
    banner.className = 'login-5s-banner premium-5s-banner';
    banner.innerHTML = `
      <div class="banner-top">
        <span class="banner-badge premium-badge">⚡ PREMIUM AUTO-LOGIN</span>
      </div>
      <div class="banner-title">🚀 Auto-Logging In...</div>
      <div class="banner-desc">ReturnPilot is auto-solving CAPTCHA and submitting login automatically.</div>
    `;
  } else {
    banner.className = 'login-5s-banner free-5s-banner';
    banner.innerHTML = `
      <div class="banner-top">
        <span class="banner-badge free-badge">ℹ️ FREE PLAN</span>
      </div>
      <div class="banner-title">📝 Credentials Auto-Filled!</div>
      <div class="banner-desc">Please manually enter the CAPTCHA characters on the GST portal and click Login.</div>
    `;
  }

  banner.hidden = false;

  window._rp5sBannerTimeout = setTimeout(() => {
    if (banner) banner.hidden = true;
  }, 3000);
}