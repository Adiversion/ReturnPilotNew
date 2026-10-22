// ═══════════════════════════════════════════════════════════════
//  ReturnPilot v3.3.0 — GST Portal Login Autofill Content Script
//  © 2026 KasyHQ. All Rights Reserved.
// ═══════════════════════════════════════════════════════════════

(function () {
  'use strict';

  if (window.__rpLoginContentScriptLoaded) return;
  window.__rpLoginContentScriptLoaded = true;

  if (typeof ReturnPilotSecurity !== 'undefined') {
    const handshake = ReturnPilotSecurity.verifyEntanglement('login-contentscript');
    if (!handshake) {
      console.error('[ReturnPilot Security] Unauthorized signature/build detected. In-page bridge locked.');
      return;
    }
  }

  var _rpIntervals = [];
  window.addEventListener('pagehide', function() {
    _rpIntervals.forEach(function(id) { clearInterval(id); });
    _rpIntervals = [];
  });



  // ── SAFE CHROME BRIDGE (Extension context invalidated guard) ────────────────
  // After the extension is reloaded/updated, the old content script's
  // chrome.runtime bridge is destroyed. Calling chrome.runtime.sendMessage (or
  // chrome.storage...) then throws synchronously — the lastError callback does
  // NOT catch that. These wrappers detect the dead bridge and no-op instead.
  function isChromeContextAlive() {
    try {
      return typeof chrome !== 'undefined' &&
             !!chrome.runtime &&
             !!chrome.runtime.id &&
             !!chrome.storage &&
             !!chrome.storage.local;
    } catch (_) {
      return false;
    }
  }

  function rpSafeSendMessage(msg, cb) {
    try {
      if (!isChromeContextAlive()) {
        if (cb) cb(null);
        return;
      }
      if (cb) {
        chrome.runtime.sendMessage(msg, function (response) {
          // Callback runs later on the event loop — outside the try above, so
          // guard it too in case the bridge dies between the call and response.
          try {
            if (chrome.runtime.lastError) {
              cb(null);
              return;
            }
            cb(response);
          } catch (_) {
            cb(null);
          }
        });
      } else {
        chrome.runtime.sendMessage(msg).catch(() => {});
      }
    } catch (_) {
      if (cb) cb(null);
    }
  }

  function rpSafeStorageGet(keys, cb) {
    try {
      if (!isChromeContextAlive()) {
        if (cb) cb({});
        return;
      }
      chrome.storage.local.get(keys, function (data) {
        try {
          if (chrome.runtime.lastError) {
            cb({});
            return;
          }
          cb(data || {});
        } catch (_) {
          cb({});
        }
      });
    } catch (_) {
      if (cb) cb({});
    }
  }

  function rpSafeStorageSet(items, cb) {
    try {
      if (!isChromeContextAlive()) {
        if (cb) cb();
        return;
      }
      chrome.storage.local.set(items, function () {
        try {
          if (cb) cb();
        } catch (_) {}
      });
    } catch (_) {
      if (cb) cb();
    }
  }

  function rpSafeStorageRemove(keys, cb) {
    try {
      if (!isChromeContextAlive()) {
        if (cb) cb();
        return;
      }
      chrome.storage.local.remove(keys, function () {
        try {
          if (cb) cb();
        } catch (_) {}
      });
    } catch (_) {
      if (cb) cb();
    }
  }

  // ── UNIVERSAL TAB MESSAGE LISTENER (Active on all matching pages including fowelcome) ──
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
        if (!msg) return;

        if (msg.action === 'navigate-to-return-dashboard' || msg.request === 'navigate-to-return-dashboard') {
          console.log('[ReturnPilot Login Bridge] Received navigate-to-return-dashboard request');
          
          // 1. First priority: Direct link with return dashboard href
          const directLink = document.querySelector('a[href*="returns/auth/dashboard"], a[href*="/returns/auth/dashboard"]');
          if (directLink) {
            console.log('[ReturnPilot Login Bridge] Found direct Return Dashboard link. Clicking.');
            try {
              directLink.click();
            } catch (_) {
              directLink.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            }
            sendResponse({ success: true, mode: 'direct-link-click' });
            return true;
          }

          // 2. Second priority: Interactive button or link by label text
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
            console.log('[ReturnPilot Login Bridge] Found native Return Dashboard button. Clicking.');
            try {
              nativeBtn.click();
            } catch (_) {
              nativeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            }
            sendResponse({ success: true, mode: 'native-btn-click' });
            return true;
          }

          // 3. Fallback: In-page navigation preserving page context and Referer
          console.log('[ReturnPilot Login Bridge] Native button not found in DOM, assigning window.location from page context.');
          window.location.assign('https://return.gst.gov.in/returns/auth/dashboard');
          sendResponse({ success: true, mode: 'location-assign' });
          return true;
        }
      });
    }
  } catch (_) {}

  const href = window.location.href;

  // 0. ROUTE: ACCESS DENIED PAGE INVESTIGATOR
  if (href.includes('accessdenied')) {
    console.group('%c[ReturnPilot Investigator] ACCESS DENIED DETECTED ON PORTAL', 'background: #b91c1c; color: white; font-size: 13px; font-weight: bold; padding: 4px 8px;');
    console.log('Current URL:', window.location.href);
    console.log('Referrer:', document.referrer || '(Empty)');
    console.log('Document Cookies in Page Context:', document.cookie || '(None)');
    console.log('SessionStorage Keys:', Object.keys(sessionStorage));
    console.log('LocalStorage Keys:', Object.keys(localStorage));
    rpSafeSendMessage({ request: 'debug-dump-cookies', context: 'access-denied-page' }, (res) => {
      console.log('%c[ReturnPilot Investigator] Full Cookie Store (including HttpOnly):', 'color: #f43f5e; font-weight: bold;', res?.cookies);
      console.groupEnd();
    });
    return;
  }

  // 1. ROUTE: DASHBOARD → report success & check pending save
  if (href.includes('return.gst.gov.in') && href.includes('dashboard')) {
    rpSafeSendMessage({ request: 'report-login-success' });
    setTimeout(autoEnrichSavedAccountsFromSession, 400);
    setTimeout(checkPendingSaveCredentials, 1200);
    
    // If it's a popup window, close it after a short delay
    if (window.innerWidth <= 500) {
      setTimeout(() => {
        window.close();
      }, 1200);
    }
    return;
  }

  // 2. ROUTE: WELCOME PAGE -> Always propagate the session FIRST and check pending save prompt
  if (href.includes('/services/auth/fowelcome') || href.includes('/services/auth/taxpayerdashboard') || href.includes('/services/auth/dashboard') || href.includes('/services/auth/welcome')) {
    rpSafeSendMessage({ request: 'propagate-session-silently' });
    setTimeout(autoEnrichSavedAccountsFromSession, 400);
    
    setTimeout(checkPendingSaveCredentials, 1000);
    
    rpSafeStorageGet(['auditToolConnected'], (data) => {
      if (data && data.auditToolConnected) {
        rpSafeSendMessage({ request: 'report-welcome-page-reached' }, (response) => {
          if (response && response.action === 'redirect-to-dashboard') {
            window.location.href = 'https://return.gst.gov.in/returns/auth/dashboard';
          }
        });
      }
    });
    return;
  }

  // 3. ROUTE: LOGIN PAGE ONLY (Strict URL Guard — Fix 1)
  const LOGIN_URLS = [
    'services.gst.gov.in/services/login',
    'services.gst.gov.in/services/auth/login',
    '/services/login',
    '/services/auth/login',
    'gst.gov.in/login'
  ];

  const DASHBOARD_URLS = [
    '/services/auth/dashboard',
    '/services/auth/taxpayerdashboard',
    '/services/auth/fowelcome',
    '/returns/auth/',
    '/reg/auth/'
  ];

  const isLoginPage = (
    LOGIN_URLS.some(u => href.includes(u)) &&
    !DASHBOARD_URLS.some(u => href.includes(u))
  ) || document.querySelector('#username') !== null || document.querySelector('#user_pass') !== null;

  if (!isLoginPage) {
    return;
  }

  rpSafeSendMessage({ request: 'clean-duplicate-cookies' });

  rpSafeSendMessage({ request: 'debug-dump-cookies', context: 'Login Page Init' }, (res) => {
    console.group('%c[ReturnPilot Investigator] Cookies Present at Login Page', 'color: #3b82f6; font-weight: bold;');
    console.log('Document Cookies in Page Context:', document.cookie || '(None)');
    console.log('All Browser Cookies (including HttpOnly):', res?.cookies);
    console.groupEnd();
  });

  // Clear any previous tab session flags so manual logins are never suppressed
  try {
    sessionStorage.removeItem('rp_is_autologin');
    sessionStorage.removeItem('rp_save_prompt_shown');
  } catch (_) {}
  window.__rpIsAutoLogin = false;

  // ── SWEB_9000 ONE-TIME AUTO-RETRY ─────────────────────────────────────────
  // The portal answers /services/authenticate with
  // { url: "/", message: null, errorCode: "SWEB_9000" } when the CAPTCHA was
  // wrong. For the AUTO-LOGIN flow only, retry exactly once: re-push the
  // credentials, solve a fresh CAPTCHA and click Login again. If the same
  // error recurs, stay hands-off so the user can complete the login manually.
  let rpAutoLoginCreds = null;    // { username, password, isPremium }
  let rpAutoLoginAt = 0;          // timestamp of last auto-login submission
  let rpSweb9000Retried = false;  // one-time retry budget per auto-login run

  // Inject the page-context interceptor that watches the raw authenticate
  // response (content/login-inject.js) — same pattern as the GSTR-2B inject.
  try {
    const injectScript = document.createElement('script');
    injectScript.src = chrome.runtime.getURL('content/login-inject.js');
    injectScript.onload = () => injectScript.remove();
    (document.head || document.documentElement).appendChild(injectScript);
  } catch (e) {
    console.warn('[ReturnPilot Login Bridge] Interceptor injection failed:', e.message);
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== 'RETURNPILOT_LOGIN_INJECT') return;

    if (data.type === 'AUTH_SWEB_9000') {
      handleSweb9000Retry();
    } else if (data.type === 'AUTH_BAD_CREDENTIALS') {
      handleBadCredentials(data.errorCode, data.errorMessage);
    } else if (data.type === 'LOGIN_SUBMITTED_CREDENTIALS') {
      // Do not capture credentials during an active Auto-Login run
      if (window.__rpIsAutoLogin || (rpAutoLoginAt && (Date.now() - rpAutoLoginAt) < 90000)) return;
      try {
        if (sessionStorage.getItem('rp_is_autologin') === 'true') return;
      } catch (_) {}

      if (data.username && data.password && data.username.length >= 3 && data.password.length >= 3) {
        console.log('%c[ReturnPilot] 🔐 Captured login credentials for ReturnPilot Vault buffer', 'color: #10b981; font-weight: bold;');
        rpSafeStorageSet({
          rp_pending_save_credentials: {
            username: data.username,
            password: data.password,
            timestamp: Date.now()
          },
          gstUsername: data.username
        });
      }
    }
  });

  function handleSweb9000Retry() {
    // Only react to a recent auto-login run — never to manual logins.
    if (!rpAutoLoginCreds || (Date.now() - rpAutoLoginAt) > 60000) return;

    if (rpSweb9000Retried) {
      console.log('%c[ReturnPilot] ⛔ SWEB_9000 again after retry — leaving login to the user.', 'color:#f59e0b; font-weight: bold;');
      // Budget spent — drop stored creds so a manual login within the 60s
      // window can never be overwritten by a stale auto-retry.
      rpAutoLoginCreds = null;
      rpAutoLoginAt = 0;
      return;
    }

    rpSweb9000Retried = true;
    console.log('%c[ReturnPilot] 🔄 Invalid CAPTCHA (SWEB_9000) — retrying auto-login once with a fresh CAPTCHA...', 'color:#f59e0b; font-weight: bold;');

    // Re-push credentials, fetch & solve a brand-new CAPTCHA, click Login again.
    setTimeout(() => {
      fillAndSubmit(rpAutoLoginCreds.username, rpAutoLoginCreds.password, '', rpAutoLoginCreds.isPremium);
    }, 800);
  }

  // ── BAD CREDENTIALS HANDLER (wrong password / account locked) ──────────────
  // Triggered by AUTH_BAD_CREDENTIALS from login-inject.js when the portal
  // returns SWEB_9009 / SWEB_9001 / SWEB_9003 or an "invalid credentials"
  // message text. Only activates during an active auto-login window to avoid
  // false positives when the user simply mistyped a password manually.
  function handleBadCredentials(errorCode, errorMessage) {
    // Guard: only fire during a recent auto-login attempt (within 90s)
    const isAutoLoginWindow = rpAutoLoginCreds && (Date.now() - rpAutoLoginAt) < 90000;
    const isAutoLoginFlag = window.__rpIsAutoLogin;
    let isAutoLoginSession = false;
    try { isAutoLoginSession = sessionStorage.getItem('rp_is_autologin') === 'true'; } catch (_) {}

    if (!isAutoLoginWindow && !isAutoLoginFlag && !isAutoLoginSession) return;

    // Invalidate the in-memory auto-login state so stale creds don't retry
    rpAutoLoginCreds = null;
    rpAutoLoginAt = 0;
    window.__rpIsAutoLogin = false;
    try { sessionStorage.removeItem('rp_is_autologin'); } catch (_) {}

    // Clear pending save buffer — old password is no longer valid
    rpSafeStorageRemove(['rp_pending_save_credentials']);

    console.warn(`%c[ReturnPilot] ⚠️ Auto-login rejected by GST Portal (${errorCode || 'bad credentials'}). Password may have changed.`, 'color:#f59e0b; font-weight: bold;');

    // Remove any existing notice
    const old = document.getElementById('rp-bad-cred-notice');
    if (old) old.remove();

    const logoSrc = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL)
      ? chrome.runtime.getURL('assets/icons/icon-32.png')
      : '';

    const notice = document.createElement('div');
    notice.id = 'rp-bad-cred-notice';
    notice.style.cssText = `
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 2147483647;
      background: #ffffff;
      color: #0f172a;
      border: 1px solid #fecaca;
      border-left: 4px solid #ef4444;
      border-radius: 8px;
      box-shadow: 0 10px 28px rgba(15,23,42,0.12), 0 2px 6px rgba(15,23,42,0.05);
      padding: 14px 16px 16px 16px;
      min-width: 310px;
      max-width: 370px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif !important;
      -webkit-font-smoothing: antialiased;
      box-sizing: border-box;
      animation: rpToastSlideIn 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    `;

    notice.innerHTML = `
      <style>
        @keyframes rpBadCredSlideIn {
          from { opacity: 0; transform: translateY(-10px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0)    scale(1); }
        }
        #rp-bad-cred-notice, #rp-bad-cred-notice * {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif !important;
          box-sizing: border-box;
          -webkit-font-smoothing: antialiased;
        }
        #rp-bad-cred-notice { animation: rpBadCredSlideIn 0.25s cubic-bezier(0.16, 1, 0.3, 1); }
        #rpBadCredClose:hover  { background: #fef2f2 !important; color: #991b1b !important; }
        #rpBadCredUpdate:hover { background: #b91c1c !important; }
        #rpBadCredDismiss:hover { color: #64748b !important; text-decoration: underline !important; }
      </style>
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;">
        <div style="display:flex; align-items:center; gap:7px;">
          ${logoSrc ? `<img src="${logoSrc}" style="width:18px;height:18px;object-fit:contain;border-radius:3px;flex-shrink:0;" alt="">` : ''}
          <span style="font-size:13px;font-weight:700;color:#0f172a;letter-spacing:-0.3px;white-space:nowrap;">ReturnPilot</span>
          <div style="display:inline-flex;align-items:center;gap:4px;padding:2px 7px;border-radius:4px;font-weight:600;font-size:9.5px;line-height:1.3;background:#fef2f2;color:#991b1b;border:1px solid #fecaca;white-space:nowrap;">
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <span>Password Changed?</span>
          </div>
        </div>
        <button id="rpBadCredClose" style="background:transparent;border:none;border-radius:4px;width:20px;height:20px;display:flex;align-items:center;justify-content:center;color:#94a3b8;cursor:pointer;transition:all 0.15s;padding:0;flex-shrink:0;" title="Dismiss">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div style="font-size:12.5px;font-weight:600;color:#0f172a;margin-top:2px;letter-spacing:-0.1px;line-height:1.4;">
        Auto-login failed — GST Portal rejected saved password
      </div>
      <div style="margin:9px 0 12px 0;padding:8px 10px;background:#fef2f2;border:1px solid #fecaca;border-radius:4px;font-size:11px;color:#7f1d1d;line-height:1.5;">
        Your password on the GST Portal may have changed.<br>
        Please log in manually, then ReturnPilot will automatically<br>
        ask you to update your saved credentials.
      </div>
      <div style="display:flex;align-items:center;gap:6px;">
        <button id="rpBadCredUpdate" style="flex:1;height:28px;padding:0 12px;background:#ef4444;color:#fff;border:none;border-radius:4px;font-weight:600;font-size:11px;cursor:pointer;transition:background 0.15s;display:inline-flex;align-items:center;justify-content:center;gap:4px;">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          <span>Log in to Update Password</span>
        </button>
        <button id="rpBadCredDismiss" style="height:28px;padding:0 10px;background:#fff;color:#64748b;border:1px solid #cbd5e1;border-radius:4px;font-weight:500;font-size:11px;cursor:pointer;transition:all 0.15s;white-space:nowrap;">
          Dismiss
        </button>
      </div>
    `;

    document.body.appendChild(notice);

    // "Log in to Update Password" — just dismiss the toast; user fills in manually
    // which will naturally trigger the vault-comparison flow on next dashboard load
    const dismiss = () => {
      notice.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
      notice.style.opacity = '0';
      notice.style.transform = 'translateY(-10px) scale(0.97)';
      setTimeout(() => notice.remove(), 200);
    };

    notice.querySelector('#rpBadCredClose').onclick   = dismiss;
    notice.querySelector('#rpBadCredDismiss').onclick  = dismiss;
    notice.querySelector('#rpBadCredUpdate').onclick   = dismiss;

    // Auto-dismiss after 18s if user doesn't interact
    setTimeout(dismiss, 18000);
  }

  // ── DOM SELECTORS ──────────────────────────────────────────────────────
  function findCaptchaImage() {
    return (
      document.getElementById('imgCaptcha') ||
      document.querySelector('img[id*="captcha" i]') ||
      document.querySelector('img[name*="captcha" i]') ||
      document.querySelector('img[src*="captcha" i]') ||
      document.querySelector('img[alt*="captcha" i]')
    );
  }

  function findRefreshCaptchaButton() {
    return (
      document.querySelector('[ng-click*="refreshCaptcha" i]') ||
      document.querySelector('[ng-click*="captcha" i]') ||
      document.querySelector('.glyphicon-refresh')?.closest('a') ||
      document.querySelector('.fa-refresh')?.closest('a') ||
      document.querySelector('a[class*="refresh" i]') ||
      document.querySelector('button[class*="refresh" i]') ||
      document.querySelector('a[id*="refresh" i]') ||
      document.querySelector('button[id*="refresh" i]')
    );
  }

  function findCaptchaInput() {
    return (
      document.getElementById('captcha') ||
      document.querySelector('input[name="captcha"]') ||
      document.querySelector('input[id*="captcha" i]')
    );
  }

  function findUsernameField() {
    const byId = document.getElementById('username');
    if (byId) return byId;

    const byName = document.querySelector('input[name="user_name"]') || document.querySelector('input[name="username"]');
    if (byName) return byName;

    return (
      document.querySelector('input[autocomplete="username"]') ||
      document.querySelector('input[id*="user" i][type="text"]') ||
      document.querySelector('input[name*="user" i]')
    );
  }

  function findPasswordField() {
    const byId = document.getElementById('user_pass');
    if (byId) return byId;

    const byName = document.querySelector('input[name="user_pass"]') || document.querySelector('input[name="password"]');
    if (byName) return byName;

    const allPass = Array.from(document.querySelectorAll('input[type="password"], input[id*="pass" i], input[name*="pass" i]'));
    for (const p of allPass) {
      if (p.value) return p;
      if (p.offsetWidth > 0 || p.offsetParent !== null) return p;
    }
    return allPass[0] || null;
  }

  function findSubmitButton() {
    let btn = document.querySelector('button[type="submit"]');
    if (!btn) btn = document.querySelector('.btn-primary');
    if (!btn) {
      const buttons = document.querySelectorAll('button, input[type="button"], input[type="submit"]');
      for (const b of buttons) {
        const txt = b.textContent || b.value || '';
        if (txt.toLowerCase().includes('login') || txt.toLowerCase().includes('submit')) {
          btn = b;
          break;
        }
      }
    }
    return btn;
  }

  // ── ERROR MESSAGE SELECTOR ──────────────────────────────────────────────────
  function getErrorMessage() {
    // Check for Access Denied / WAF block pages
    const pageText = document.body ? document.body.textContent : '';
    if (document.title.includes('Access Denied') || pageText.includes('Access Denied') || pageText.includes('You don\'t have permission to access')) {
      return 'Access Denied — GST Portal block page loaded. Please check your network or try manual login.';
    }

    const selectors = [
      '.alert-danger',
      '.text-danger',
      '#serverMsg',
      '#errorMessage',
      '.error-msg',
      '.error-message',
      '.err-msg',
      '[id*="error"]',
      '[class*="errorMsg"]'
    ];
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el && el.offsetWidth > 0 && el.offsetHeight > 0) {
        const text = el.textContent.trim();
        if (text) return text;
      }
    }
    return null;
  }

  // ── CAPTCHA EXTRACTION ──────────────────────────────────────────────────────
  function extractCaptchaBase64() {
    const img = findCaptchaImage();
    if (!img || !img.complete || img.naturalWidth === 0) return null;

    try {
      const canvas = document.createElement('canvas');
      canvas.width  = img.naturalWidth  || img.width  || 200;
      canvas.height = img.naturalHeight || img.height || 60;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/png').replace(/^data:image\/(png|jpg);base64,/, "");
    } catch (e) {
      console.warn('[ReturnPilot Login Bridge] Canvas extraction notice:', e.message);
      return null;
    }
  }

  function bytesToBase64(u8) {
    let bin = "";
    for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
    return btoa(bin);
  }

  async function fetchDirectCaptchaBase64() {
    try {
      const res = await fetch(`https://services.gst.gov.in/services/captcha?rnd=${Math.random()}`, {
        method: "GET",
        credentials: "include",
        headers: {
          accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
        }
      });
      if (!res.ok) return null;
      const buf = new Uint8Array(await res.arrayBuffer());
      const base64 = bytesToBase64(buf);

      // Swap DOM img src so user sees the exact solved captcha on screen
      const img = findCaptchaImage();
      if (img) {
        img.src = `data:image/png;base64,${base64}`;
      }
      return base64;
    } catch (e) {
      console.warn('[ReturnPilot] Direct captcha fetch notice:', e.message);
      return extractCaptchaBase64();
    }
  }



  let localPreSolvedCache = null;

  function prewarmSolverSocket() {
    rpSafeStorageGet(['rp_user_profile', 'rp_user_email', 'rp_chrome_email', 'rp_license_data'], (stored) => {
      if (!checkIsPremium(stored)) return;
      try {
        fetch('https://verify.kasyhq.com/warm', {
          method: 'GET',
          keepalive: true,
          cache: 'no-cache'
        }).catch(() => {});
      } catch (_) {}
      rpSafeSendMessage({ request: 'warm-solver' });
    });
  }

  // ── REPORT STATE & PROACTIVE PRE-SOLVE ───────────────────────────────────────
  function sendPageStateToBackground() {
    if (window.__rpCaptchaReported) {
      return;
    }
    const captchaBase64 = extractCaptchaBase64();
    const errorMsg = getErrorMessage();
    
    rpSafeStorageGet(['rp_user_profile', 'rp_user_email', 'rp_chrome_email', 'rp_license_data'], async (stored) => {
      const isPrem = checkIsPremium(stored);
      const email = (stored && ((stored.rp_user_profile && stored.rp_user_profile.email) || stored.rp_user_email || stored.rp_chrome_email) || '').trim().toLowerCase();
      const shouldPreSolve = !!(isPrem && captchaBase64 && email && (!localPreSolvedCache || localPreSolvedCache.base64 !== captchaBase64));

      if (shouldPreSolve) {
        // Dispatch pre-solve to background worker (central single-flight deduplication)
        rpSafeSendMessage({
          request: 'solve-captcha',
          base64Image: captchaBase64
        }, (data) => {
          if (data && data.success && data.digits && data.digits.length === 6) {
            localPreSolvedCache = { base64: captchaBase64, digits: data.digits, timestamp: Date.now() };
            console.log(`%c[ReturnPilot] ⚡ Proactively Pre-Solved CAPTCHA: "${data.digits}" (Ready for 0ms Instant Login)`, 'color: #10b981; font-weight: bold;');
          }
        });
      }

      // Forward state to background solver, marking alreadyPreSolved so background doesn't fire a duplicate request
      rpSafeSendMessage({
        request: 'report-login-page-state',
        captchaBase64: isPrem ? captchaBase64 : null,
        alreadyPreSolved: shouldPreSolve,
        errorMessage: errorMsg
      });
    });
  }

  // ── NATIVE INPUT SET (AngularJS model compatibility) ────────────────────────
  function nativeSet(element, value) {
    const proto = Object.getPrototypeOf(element);
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set ||
                   Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;

    setter.call(element, value);
    element.dispatchEvent(new Event('keydown',  { bubbles: true, key: value.slice(-1) }));
    element.dispatchEvent(new Event('keypress', { bubbles: true, key: value.slice(-1) }));
    element.dispatchEvent(new Event('input',     { bubbles: true }));
    element.dispatchEvent(new Event('keyup',    { bubbles: true, key: value.slice(-1) }));
    element.dispatchEvent(new Event('change',   { bubbles: true }));
    element.dispatchEvent(new Event('blur',     { bubbles: true }));

    // Sync with AngularJS ngModel controller via page context bridge
    try {
      if (element.id === 'captcha' || element.name === 'captcha') {
        window.postMessage({
          source: 'RETURNPILOT_LOGIN_CONTENT',
          type: 'SET_CAPTCHA_ANGULAR',
          captchaCode: value
        }, '*');
      }
      if (window.angular && window.angular.element) {
        const ngEl = window.angular.element(element);
        const ngModel = ngEl.controller('ngModel');
        if (ngModel) {
          ngModel.$setViewValue(value);
          ngModel.$render();
        }
      }
    } catch (_) {}
  }



  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ── 5-SECOND FLOATING LOGIN NOTICE WITH LIVE TIMELINE ──
  // ── 4-SECOND SLEEK PRODUCTION LOGIN NOTIFICATION ────────────────────────────
  function show5SecondLoginNotice({ isPremium, username }) {
    const oldNotice = document.getElementById('rp-login-5s-notice');
    if (oldNotice) oldNotice.remove();

    const logoSrc = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) 
      ? chrome.runtime.getURL('assets/icons/icon-32.png') 
      : '';

    const notice = document.createElement('div');
    notice.id = 'rp-login-5s-notice';
    notice.style.cssText = `
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 2147483647;
      background: #ffffff;
      color: #0f172a;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      box-shadow: 0 10px 25px -5px rgba(15, 23, 42, 0.1), 0 4px 10px -2px rgba(15, 23, 42, 0.05);
      padding: 12px 14px 14px 14px;
      min-width: 280px;
      max-width: 330px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif !important;
      -webkit-font-smoothing: antialiased;
      box-sizing: border-box;
      contain: layout style;
      animation: rpToastSlideIn 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      overflow: hidden;
    `;

    const badgeIcon = isPremium
      ? `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`
      : `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"></path></svg>`;

    const badgeStyle = isPremium
      ? `background: #0f172a; color: #f8fafc; border: 1px solid #334155;`
      : `background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1;`;

    const badgeText = isPremium ? 'Premium' : 'Free';
    const mainTitle = isPremium ? 'Logging in to GST Portal...' : 'Credentials Auto-Filled';
    const dotColor  = isPremium ? '#16a34a' : '#2563eb';
    const barColor  = isPremium ? 'linear-gradient(90deg, #3b82f6, #2563eb, #1d4ed8)' : 'linear-gradient(90deg, #3b82f6, #2563eb)';

    notice.innerHTML = `
      <style>
        #rp-login-5s-notice, #rp-login-5s-notice * {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif !important;
          box-sizing: border-box;
          -webkit-font-smoothing: antialiased;
        }
        @keyframes rpToastSlideIn {
          from { transform: translateY(-10px) scale(0.97); opacity: 0; }
          to { transform: translateY(0) scale(1); opacity: 1; }
        }
        @keyframes rpToastPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(1.15); }
        }
        @keyframes rpToastProgress {
          from { width: 100%; }
          to { width: 0%; }
        }
        #rpNoticeCloseBtn:hover {
          background: #f1f5f9 !important;
          color: #0f172a !important;
        }
      </style>
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
        <div style="display: flex; align-items: center; gap: 6px;">
          ${logoSrc ? `<img src="${logoSrc}" style="width: 16px; height: 16px; object-fit: contain; border-radius: 3px; flex-shrink: 0;" alt="">` : ''}
          <span style="font-size: 12.5px; font-weight: 700; color: #0f172a; letter-spacing: -0.3px; white-space: nowrap;">ReturnPilot</span>
          <div style="display: inline-flex; align-items: center; gap: 4px; padding: 2px 7px; border-radius: 4px; font-weight: 600; font-size: 9.5px; line-height: 1.3; ${badgeStyle} white-space: nowrap;">
            ${badgeIcon}
            <span>${badgeText}</span>
          </div>
        </div>
        <button id="rpNoticeCloseBtn" style="background: transparent; border: none; border-radius: 4px; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; color: #94a3b8; cursor: pointer; transition: all 0.15s ease; padding: 0; flex-shrink: 0;" title="Dismiss">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>
      <div style="display: flex; align-items: center; gap: 7px; margin-top: 5px;">
        <div style="width: 6px; height: 6px; border-radius: 50%; background: ${dotColor}; box-shadow: 0 0 6px ${dotColor}; animation: rpToastPulse 1.8s infinite ease-in-out; flex-shrink: 0; will-change: transform, opacity;"></div>
        <div style="font-size: 12.5px; font-weight: 600; color: #0f172a; letter-spacing: -0.1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
          ${mainTitle}
        </div>
      </div>
      <div style="display: flex; align-items: center; gap: 6px; font-size: 11px; color: #64748b; margin-top: 6px; padding-left: 13px;">
        <span>Account:</span>
        <span style="display: inline-block; padding: 1px 6px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 3px; color: #0f172a; font-weight: 600; font-family: 'Consolas', 'Monaco', monospace; font-size: 10.5px; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          ${escapeHtml(username || 'Saved Taxpayer')}
        </span>
      </div>
      <div style="position: absolute; bottom: 0; left: 0; right: 0; height: 2.5px; background: #f1f5f9; overflow: hidden;">
        <div style="width: 100%; height: 100%; background: ${barColor}; animation: rpToastProgress 3.8s linear forwards;"></div>
      </div>
    `;

    document.body.appendChild(notice);

    const closeBtn = notice.querySelector('#rpNoticeCloseBtn');
    if (closeBtn) closeBtn.onclick = () => notice.remove();

    setTimeout(() => {
      if (notice && notice.parentNode) {
        notice.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
        notice.style.opacity = '0';
        notice.style.transform = 'translateY(-10px) scale(0.97)';
        setTimeout(() => notice.remove(), 200);
      }
    }, 3800);

    return notice;
  }

  function addTimelineStep(label, timeMs, icon = '✓') {
    // Production timeline helper
  }

  function finalizeLoginTimeline(totalMs, isSuccess = true) {
    // Production timeline helper
  }

  // ── PURE DIRECT PROFILE EXTRACTION FROM /services/api/ustatus ───────────────
  async function fetchProfileFromUstatus() {
    // 1. Direct fetch to /services/api/ustatus (active session on services.gst.gov.in)
    try {
      if (window.location.host === 'services.gst.gov.in') {
        const res = await fetch('https://services.gst.gov.in/services/api/ustatus', { method: 'GET', credentials: 'include' });
        if (res.ok) {
          const contentType = res.headers.get('content-type') || '';
          if (!contentType.includes('text/html')) {
            const data = await res.json();
            const bname = String(data?.bname || data?.legalName || data?.tradeName || '').trim();
            const gstin = String(data?.gstin || data?.authGstin || '').trim().toUpperCase();
            if (bname && gstin) {
              return { tradeName: bname, gstin, raw: data };
            }
          }
        }
      }
    } catch (_) {}

    // 2. Read direct from localStorage('userdetails')
    try {
      const rawUd = localStorage.getItem('userdetails') || sessionStorage.getItem('userdetails');
      if (rawUd) {
        const ud = JSON.parse(rawUd);
        const bname = String(ud?.bname || ud?.legalName || ud?.tradeName || ud?.tradeNam || '').trim();
        const gstin = String(ud?.gstin || ud?.authGstin || '').trim().toUpperCase();
        if (bname && gstin) {
          return { tradeName: bname, gstin, raw: ud };
        }
      }
    } catch (_) {}

    // 3. Fallback: background fetch /services/api/ustatus
    try {
      const bgRes = await new Promise((resolve) => {
        rpSafeSendMessage({ request: 'bg-fetch', url: 'https://services.gst.gov.in/services/api/ustatus' }, resolve);
      });
      if (bgRes && bgRes.status && bgRes.response) {
        const data = typeof bgRes.response === 'string' ? JSON.parse(bgRes.response) : bgRes.response;
        const bname = String(data?.bname || data?.legalName || data?.tradeName || '').trim();
        const gstin = String(data?.gstin || data?.authGstin || '').trim().toUpperCase();
        if (bname && gstin) {
          return { tradeName: bname, gstin, raw: data };
        }
      }
    } catch (_) {}

    // 4. Fallback: extract full title from portal navbar profile dropdown
    try {
      let domGstin = '';
      const gstinNode = document.querySelector('[data-ng-bind*="udata.gstin"], [ng-bind*="udata.gstin"]');
      if (gstinNode && gstinNode.textContent) {
        const m = gstinNode.textContent.trim().toUpperCase().match(/\b\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}\b/);
        if (m) domGstin = m[0];
      }
      const anchor = document.querySelector('a.dropdown-toggle.lang-dpwn, a.lang-dpwn, li[ng-if*="udata"] a.dropdown-toggle, a[data-original-title]');
      if (anchor) {
        const titleAttr = (anchor.getAttribute('data-original-title') || anchor.getAttribute('title') || anchor.title || '').trim();
        if (titleAttr && titleAttr.length > 2 && !/^(my profile|logout|login|change password|select|english|hindi)$/i.test(titleAttr)) {
          return { tradeName: titleAttr, gstin: domGstin, raw: { bname: titleAttr, gstin: domGstin } };
        }
      }
    } catch (_) {}

    return null;
  }

  async function autoEnrichSavedAccountsFromSession() {
    try {
      const profile = await fetchProfileFromUstatus();
      if (!profile) return;
      const tradeName = profile.tradeName || '';
      const gstin = profile.gstin || '';
      if (!tradeName && !gstin) return;

      rpSafeStorageGet(['rp_saved_accounts', 'rp_pending_save_credentials', 'gstUsername'], (data) => {
        const list = Array.isArray(data?.rp_saved_accounts) ? [...data.rp_saved_accounts] : [];
        const pending = data?.rp_pending_save_credentials;

        let rawUdUsername = '';
        try {
          const rawUd = localStorage.getItem('userdetails') || sessionStorage.getItem('userdetails');
          if (rawUd) {
            const ud = JSON.parse(rawUd);
            rawUdUsername = (ud && (ud.username || ud.userName || ud.authUsername || ud.usrName || ud.userId)) || '';
          }
        } catch (_) {}

        const currentGstUsername = (
          sessionStorage.getItem('rp_active_login_user') || 
          localStorage.getItem('rp_active_login_user') || 
          pending?.username || 
          data?.gstUsername || 
          rawUdUsername || 
          ''
        ).trim();

        if (!currentGstUsername) return;

        let updated = false;
        const targetUserLower = currentGstUsername.toLowerCase();

        for (let i = 0; i < list.length; i++) {
          const acc = list[i];
          // STRICT USERNAME MATCHING ONLY — PREVENTS CROSS-ACCOUNT DATA CORRUPTION OR SWAPPING
          if (acc.username && acc.username.toLowerCase() === targetUserLower) {
            const currentName = (acc.clientName || '').trim();
            const currentGstin = (acc.gstin || '').trim();

            const newName = tradeName || currentName;
            const newGstin = gstin || currentGstin;

            if (currentName !== newName || currentGstin !== newGstin) {
              list[i] = {
                ...acc,
                clientName: newName,
                gstin: newGstin
              };
              updated = true;
            }
          }
        }

        if (updated) {
          rpSafeStorageSet({ rp_saved_accounts: list });
          console.log(`%c[ReturnPilot] ✓ Auto-Synced Legal Name: "${tradeName}" & GSTIN: "${gstin}" for user: "${currentGstUsername}"`, 'color:#10b981; font-weight:bold;');
        }

        rpSafeSendMessage({
          request: 'enrich-saved-account',
          username: currentGstUsername,
          legalName: tradeName,
          gstin: gstin,
          ustatusData: profile.raw
        });
      });
    } catch (_) {}
  }

  function checkIsPremium(data) {
    const license = data?.rp_license_data;
    if (!license) return false;
    if (license.expired === true) return false;
    if (!license.valid) return false;
    const tier = String(license.tier || '').toUpperCase();
    if (tier !== 'PREMIUM' && tier !== 'EARLY_BACKER') return false;
    const now = Date.now();
    if (license.expiresAt && Number(license.expiresAt) <= now) return false;
    if (license.isTrial && (!license.expiresAt || Number(license.expiresAt) <= now)) return false;
    return true;
  }

  async function showSaveAccountPrompt(username, password, isUpdate = false) {
    if (!username || !password || username.length < 3 || password.length < 3) return;
    if (document.getElementById('rp-save-account-prompt')) return;

    const profile = await fetchProfileFromUstatus();
    const tradeName = profile?.tradeName || '';
    const gstin = profile?.gstin || '';
    const displayName = tradeName || username;

    const logoSrc = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) 
      ? chrome.runtime.getURL('assets/icons/icon-32.png') 
      : '';

    rpSafeStorageGet(['rp_saved_accounts', 'rp_disable_save_prompt', 'rp_license_data', 'rp_user_profile'], (data) => {
      if (data && data.rp_disable_save_prompt) return;
      const list = Array.isArray(data?.rp_saved_accounts) ? data.rp_saved_accounts : [];
      const existingAcc = list.find(a => 
        a.username?.toLowerCase() === username.toLowerCase() || 
        (gstin && a.gstin && a.gstin.toLowerCase() === gstin.toLowerCase())
      );

      const isPremium = checkIsPremium(data);
      
      // Free tier ceiling: maximum 3 accounts
      if (!isPremium && list.length >= 3 && !existingAcc && !isUpdate) {
        rpSafeStorageRemove(['rp_pending_save_credentials']);
        return;
      }

      const oldPrompt = document.getElementById('rp-save-account-prompt');
      if (oldPrompt) oldPrompt.remove();

      const prompt = document.createElement('div');
      prompt.id = 'rp-save-account-prompt';
      prompt.style.cssText = `
        position: fixed;
        top: 16px;
        right: 16px;
        z-index: 2147483647;
        background: #ffffff;
        color: #0f172a;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        box-shadow: 0 10px 28px rgba(15, 23, 42, 0.12), 0 2px 6px rgba(15, 23, 42, 0.05);
        padding: 14px 16px 16px 16px;
        min-width: 310px;
        max-width: 360px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif !important;
        -webkit-font-smoothing: antialiased;
        box-sizing: border-box;
        contain: layout style;
        animation: rpToastSlideIn 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      `;

      const badgeIcon = isPremium
        ? `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`
        : `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"></path></svg>`;

      const badgeStyle = isPremium 
        ? `background: #0f172a; color: #f8fafc; border: 1px solid #334155;` 
        : `background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1;`;

      const vaultBadge = isPremium 
        ? 'Premium Vault' 
        : `Vault (${list.length + (existingAcc ? 0 : 1)}/3)`;

      prompt.innerHTML = `
        <style>
          @keyframes rpToastSlideIn {
            from { opacity: 0; transform: translateY(-10px) scale(0.97); }
            to { opacity: 1; transform: translateY(0) scale(1); }
          }
          #rp-save-account-prompt, #rp-save-account-prompt * {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif !important;
            box-sizing: border-box;
            -webkit-font-smoothing: antialiased;
          }
          #rpPromptCloseBtn:hover { background: #f1f5f9 !important; color: #0f172a !important; }
          #rpSaveAccountBtn:hover { background: #15803d !important; }
          #rpNotNowBtn:hover { background: #f1f5f9 !important; border-color: #94a3b8 !important; color: #1e293b !important; }
          #rpNeverAskBtn:hover { color: #64748b !important; text-decoration: underline !important; }
        </style>
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;">
          <div style="display: flex; align-items: center; gap: 6px;">
            ${logoSrc ? `<img src="${logoSrc}" style="width: 18px; height: 18px; object-fit: contain; border-radius: 3px; flex-shrink: 0;" alt="">` : ''}
            <span style="font-size: 13px; font-weight: 700; color: #0f172a; letter-spacing: -0.3px; white-space: nowrap;">ReturnPilot</span>
            <div style="display: inline-flex; align-items: center; gap: 4px; padding: 2px 7px; border-radius: 4px; font-weight: 600; font-size: 9.5px; line-height: 1.3; ${badgeStyle} white-space: nowrap;">
              ${badgeIcon}
              <span>${vaultBadge}</span>
            </div>
          </div>
          <button id="rpPromptCloseBtn" style="background: transparent; border: none; border-radius: 4px; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; color: #94a3b8; cursor: pointer; transition: all 0.15s ease; padding: 0; flex-shrink: 0;" title="Dismiss">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
        <div style="font-size: 12.5px; font-weight: 600; color: #0f172a; margin-top: 4px; letter-spacing: -0.1px;">
          ${isUpdate || existingAcc ? 'Update saved 1-Click login credentials?' : 'Save account for 1-Click Auto-Login?'}
        </div>
        <div style="margin: 9px 0 12px 0; padding: 8px 10px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; font-size: 11px; line-height: 1.5;">
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px;">
            <span style="color: #64748b; font-size: 10.5px; white-space: nowrap;">Client:</span>
            <span style="font-weight: 600; color: #0f172a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 210px;">
              ${escapeHtml(displayName)}
            </span>
          </div>
          ${gstin ? `
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-top: 3px;">
            <span style="color: #64748b; font-size: 10.5px; white-space: nowrap;">GSTIN:</span>
            <span style="display: inline-block; padding: 1px 5px; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 3px; color: #1d4ed8; font-weight: 600; font-family: 'Consolas', 'Monaco', monospace; font-size: 10px;">
              ${escapeHtml(gstin)}
            </span>
          </div>` : ''}
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-top: 3px;">
            <span style="color: #64748b; font-size: 10.5px; white-space: nowrap;">Username:</span>
            <span style="font-family: 'Consolas', 'Monaco', monospace; font-size: 10.5px; font-weight: 500; color: #475569;">
              ${escapeHtml(username)}
            </span>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 6px;">
          <button id="rpSaveAccountBtn" style="flex: 1; height: 28px; padding: 0 12px; background: #16a34a; color: #ffffff; border: none; border-radius: 4px; font-weight: 600; font-size: 11px; box-shadow: 0 1px 2px rgba(0,0,0,0.06); cursor: pointer; transition: background 0.15s ease; display: inline-flex; align-items: center; justify-content: center; gap: 4px;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
            <span>${isUpdate || existingAcc ? 'Update Password' : 'Save Account'}</span>
          </button>
          <button id="rpNotNowBtn" style="height: 28px; padding: 0 12px; background: #ffffff; color: #475569; border: 1px solid #cbd5e1; border-radius: 4px; font-weight: 500; font-size: 11px; cursor: pointer; transition: all 0.15s ease; display: inline-flex; align-items: center; justify-content: center;">
            Not Now
          </button>
        </div>
        <div style="text-align: center; margin-top: 8px;">
          <button id="rpNeverAskBtn" style="background: none; border: none; color: #94a3b8; font-size: 10px; cursor: pointer; text-decoration: none; transition: color 0.15s;">
            Don't ask again
          </button>
        </div>
      `;

      document.body.appendChild(prompt);

      const cleanupPrompt = () => {
        rpSafeStorageRemove(['rp_pending_save_credentials']);
        prompt.remove();
      };

      prompt.querySelector('#rpPromptCloseBtn').onclick = cleanupPrompt;
      prompt.querySelector('#rpNotNowBtn').onclick = cleanupPrompt;

      prompt.querySelector('#rpNeverAskBtn').onclick = () => {
        rpSafeStorageSet({ rp_disable_save_prompt: true });
        cleanupPrompt();
      };

      prompt.querySelector('#rpSaveAccountBtn').onclick = () => {
        rpSafeSendMessage({
          request: 'save-credentials',
          username: username,
          password: password,
          clientName: displayName,
          gstin: gstin
        }, (res) => {
          rpSafeStorageRemove(['rp_pending_save_credentials']);
          if (res && res.success) {
            prompt.innerHTML = `
              <div style="display: flex; align-items: center; gap: 8px; color: #16a34a; font-size: 12px; font-weight: 600; padding: 4px 0;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
                <span>${isUpdate || existingAcc ? 'Updated! Ready for 1-Click login.' : 'Saved! Ready for 1-Click login.'}</span>
              </div>
            `;
            setTimeout(() => {
              prompt.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
              prompt.style.opacity = '0';
              prompt.style.transform = 'translateY(-10px) scale(0.97)';
              setTimeout(() => prompt.remove(), 200);
            }, 2000);
          }
        });
      };
    });
  }

  function setupManualLoginListener() {
    const recordPendingCreds = () => {
      // Do not capture credentials during an active Auto-Login run
      if (window.__rpIsAutoLogin || (rpAutoLoginAt && (Date.now() - rpAutoLoginAt) < 90000)) return;
      try {
        if (sessionStorage.getItem('rp_is_autologin') === 'true') return;
      } catch (_) {}

      let u = findUsernameField()?.value?.trim();
      let p = findPasswordField()?.value;

      if (!u || !p) {
        const allInputs = Array.from(document.querySelectorAll('input'));
        for (const inp of allInputs) {
          if (!u && (inp.id === 'username' || inp.name === 'user_name' || inp.name === 'username' || inp.id.includes('user')) && inp.value) {
            u = inp.value.trim();
          }
          if (!p && (inp.type === 'password' || inp.id === 'user_pass' || inp.name === 'user_pass' || inp.id.includes('pass')) && inp.value) {
            p = inp.value;
          }
        }
      }

      if (u && p && u.length >= 3 && p.length >= 3) {
        try {
          sessionStorage.setItem('rp_active_login_user', u);
        } catch (_) {}
        rpSafeStorageSet({
          rp_pending_save_credentials: {
            username: u,
            password: p,
            timestamp: Date.now()
          },
          gstUsername: u
        });
      }
    };

    const attachToForm = () => {
      const uField = findUsernameField();
      const pField = findPasswordField();
      const sBtn = findSubmitButton();

      if (uField && !uField.__rpListenerAttached) {
        uField.__rpListenerAttached = true;
        uField.addEventListener('input', recordPendingCreds);
        uField.addEventListener('change', recordPendingCreds);
        uField.addEventListener('blur', recordPendingCreds);
      }

      if (pField && !pField.__rpListenerAttached) {
        pField.__rpListenerAttached = true;
        pField.addEventListener('input', recordPendingCreds);
        pField.addEventListener('change', recordPendingCreds);
        pField.addEventListener('blur', recordPendingCreds);
        pField.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') recordPendingCreds();
        });
      }

      const cField = findCaptchaInput();
      if (cField && !cField.__rpListenerAttached) {
        cField.__rpListenerAttached = true;
        cField.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') recordPendingCreds();
        });
      }

      if (sBtn && !sBtn.__rpListenerAttached) {
        sBtn.__rpListenerAttached = true;
        sBtn.addEventListener('click', recordPendingCreds);
      }

      const form = uField?.closest('form') || pField?.closest('form') || document.querySelector('form');
      if (form && !form.__rpListenerAttached) {
        form.__rpListenerAttached = true;
        form.addEventListener('submit', recordPendingCreds);
      }
    };

    attachToForm();
    setTimeout(attachToForm, 500);
    setTimeout(attachToForm, 1200);
    setTimeout(attachToForm, 2500);
  }

  async function checkPendingSaveCredentials() {
    await autoEnrichSavedAccountsFromSession();

    rpSafeStorageGet(['rp_pending_save_credentials', 'rp_saved_accounts', 'rp_disable_save_prompt', 'rp_license_data', 'rp_user_profile', 'rp_last_autologin_ts'], (data) => {
      const pending = data?.rp_pending_save_credentials;
      if (!pending || !pending.username || !pending.password) return;
      
      // Expire after 3 minutes
      if (Date.now() - (pending.timestamp || 0) > 180000) {
        rpSafeStorageRemove(['rp_pending_save_credentials']);
        return;
      }

      if (data?.rp_disable_save_prompt) {
        rpSafeStorageRemove(['rp_pending_save_credentials']);
        return;
      }

      // Consume auto-login flag if active for this tab
      try {
        if (sessionStorage.getItem('rp_is_autologin') === 'true') {
          sessionStorage.removeItem('rp_is_autologin');
          rpSafeStorageRemove(['rp_pending_save_credentials']);
          return;
        }
      } catch (_) {}

      if (window.__rpIsAutoLogin) {
        window.__rpIsAutoLogin = false;
        rpSafeStorageRemove(['rp_pending_save_credentials']);
        return;
      }

      // Prevent duplicate / overlapping prompt on the same session
      try {
        if (sessionStorage.getItem('rp_save_prompt_shown') === 'true' || document.getElementById('rp-save-account-prompt')) {
          return;
        }
      } catch (_) {}

      const list = Array.isArray(data?.rp_saved_accounts) ? data.rp_saved_accounts : [];
      const existingAcc = list.find(a => a.username?.toLowerCase() === pending.username?.toLowerCase());
      const isAlreadyFullySaved = existingAcc && existingAcc.clientName && existingAcc.clientName.toLowerCase() !== existingAcc.username.toLowerCase() && existingAcc.gstin;

      if (existingAcc) {
        // Account exists in vault! Check if password matches stored vault password
        rpSafeSendMessage({
          request: 'check-credential-match',
          username: pending.username,
          password: pending.password
        }, (res) => {
          if (res && res.matched) {
            // Password matches stored vault password
            if (isAlreadyFullySaved) {
              // Both password and profile (Trade Name + GSTIN) are completely saved -> clean up pending buffer
              rpSafeStorageRemove(['rp_pending_save_credentials']);
            } else {
              // Account has the password, but is missing real Trade Name or GSTIN!
              // Prompt user with real Trade Name & GSTIN so they can see and confirm the enriched details!
              try { sessionStorage.setItem('rp_save_prompt_shown', 'true'); } catch (_) {}
              showSaveAccountPrompt(pending.username, pending.password, false);
            }
          } else {
            // Password changed! User entered a new password -> prompt to update!
            try { sessionStorage.setItem('rp_save_prompt_shown', 'true'); } catch (_) {}
            showSaveAccountPrompt(pending.username, pending.password, true);
          }
        });
        return;
      }

      const isPremium = checkIsPremium(data);
      if (!isPremium && list.length >= 3 && !existingAcc) {
        rpSafeStorageRemove(['rp_pending_save_credentials']);
        return;
      }

      // New account -> prompt to save
      try { sessionStorage.setItem('rp_save_prompt_shown', 'true'); } catch (_) {}
      showSaveAccountPrompt(pending.username, pending.password, false);
    });
  }

  // ── ANONYMOUS ERROR TELEMETRY (Operational Reliability) ────────────────────
  function reportDiagnosticError(err, context) {
    try {
      if (!err || typeof fetch === 'undefined') return;
      const errMsg = (err.message || String(err)).slice(0, 200);
      const manifest = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) ? chrome.runtime.getManifest() : { version: '4.0.0' };
      const cacheKey = `__rp_err_${errMsg}_${context || ''}`;
      if (window[cacheKey] && Date.now() - window[cacheKey] < 60000) return;
      window[cacheKey] = Date.now();

      rpSafeStorageGet(['rp_user_profile', 'rp_user_email', 'rp_chrome_email'], (stored) => {
        const userEmail = (stored && stored.rp_user_profile && stored.rp_user_profile.email) || 
                          (stored && stored.rp_user_email) || 
                          (stored && stored.rp_chrome_email) || '';

        fetch('https://kasyhq.com/api/feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: 'ERROR_LOG',
            email: userEmail,
            error: errMsg,
            returnType: context || 'LoginBridge',
            version: manifest.version || '4.0.0',
            details: `Stack: ${(err.stack || '').replace(/[\r\n]+/g, ' | ').slice(0, 250)}`
          }),
          keepalive: true
        }).catch(() => {});
      });
    } catch (_) {}
  }

  // ── ENSURE CAPTCHA SECTION IS RENDERED ─────────────────────────────────────
  // The GST portal does NOT render the CAPTCHA on initial page load. It only
  // renders #captcha / #imgCaptcha AFTER the first LOGIN click (a two-phase
  // anti-bot flow). So before solving/filling the CAPTCHA, we must trigger that
  function ensureCaptchaRendered(timeoutMs = 6000) {
    return new Promise((resolve) => {
      if (findCaptchaInput()) {
        resolve(true);
        return;
      }

      // Proactively trigger AngularJS validName() on username field to render captcha without error
      try {
        window.postMessage({
          source: 'RETURNPILOT_LOGIN_CONTENT',
          type: 'TRIGGER_USERNAME_INIT'
        }, '*');
      } catch (_) {}

      const started = Date.now();
      let clickAttempted = false;
      const poll = setInterval(() => {
        _rpIntervals.push(poll);
        if (findCaptchaInput() || Date.now() - started > timeoutMs) {
          clearInterval(poll);
          resolve(!!findCaptchaInput());
          return;
        }

        // Fallback: if captcha still not rendered after 300ms, trigger submit click
        if (!clickAttempted && Date.now() - started > 300 && !findCaptchaInput()) {
          clickAttempted = true;
          const submitBtn = findSubmitButton();
          if (submitBtn) {
            try { submitBtn.click(); } catch (_) {}
          }
        }
      }, 100);
    });
  }

  // ── FILL AND SUBMIT (Hyper-Speed Instant Auto-Fill & Login) ──
  function fillAndSubmit(username, password, captcha, isPremium = false) {
    const totalBenchmarkStart = performance.now();
    console.log(`%c[ReturnPilot Auto-Login] 🚀 Saved Account Login Initiated for: ${username || 'Saved User'}`, 'color: #3b82f6; font-weight: bold; font-size: 13px;');

    show5SecondLoginNotice({ isPremium, username });

    const doFillAndSubmit = () => {
      const fieldStart = performance.now();
      const usernameField = findUsernameField();
      const passwordField = findPasswordField();
      if (!usernameField || !passwordField) return false;

      if (username) {
        usernameField.focus();
        nativeSet(usernameField, username);
      }

      if (password) {
        passwordField.focus();
        nativeSet(passwordField, password);
      }

      // Sync with AngularJS scope via page context bridge
      try {
        window.postMessage({
          source: 'RETURNPILOT_LOGIN_CONTENT',
          type: 'SET_CREDENTIALS_ANGULAR',
          username: username || (usernameField ? usernameField.value : ''),
          password: password || (passwordField ? passwordField.value : '')
        }, '*');
      } catch (_) {}

      const fieldTime = Math.round(performance.now() - fieldStart);
      addTimelineStep('🔐 Credentials Injected', fieldTime);
      console.log(`%c[ReturnPilot Auto-Login] 🔐 Step 1: Credentials Auto-Filled in ${fieldTime} ms`, 'color: #00e5ff; font-weight: bold;');

      // Premium Tier Lock Enforcement
      if (!isPremium) {
        // Free plan: reveal the CAPTCHA section (first LOGIN click) so the
        // user can type the characters, then hand over.
        ensureCaptchaRendered().then(() => {
          const captchaField = findCaptchaInput();
          if (captchaField) captchaField.focus();
        });
        
        const totalTime = Math.round(performance.now() - totalBenchmarkStart);
        finalizeLoginTimeline(totalTime, true);
        return true;
      }

      if (captcha) {
        // Pre-solved CAPTCHA (instant cache path)
        ensureCaptchaRendered().then((rendered) => {
          const captchaField = findCaptchaInput();
          const submitBtn = findSubmitButton();
          addTimelineStep(`⚡ Pre-Solved CAPTCHA "${captcha}"`, 0);
          console.log(`%c[ReturnPilot Auto-Login] ⚡ Pre-Solved CAPTCHA Provided: "${captcha}" (Instant Cache Hit in 0 ms)`, 'color: #22c55e; font-weight: bold;');
          
          if (captchaField) {
            const fillStart = performance.now();
            captchaField.focus();
            nativeSet(captchaField, captcha);
            const fillTime = Math.round(performance.now() - fillStart);
            addTimelineStep('⌨️ Form Input Populated', fillTime);
            console.log(`%c[ReturnPilot Auto-Login] ⌨️ CAPTCHA Filled into input in ${fillTime} ms`, 'color: #00e5ff;');
          }
          
          if (submitBtn && captchaField && rendered) {
            const clickStart = performance.now();
            submitBtn.click();
            const clickTime = Math.round(performance.now() - clickStart);
            const totalTime = Math.round(performance.now() - totalBenchmarkStart);
            addTimelineStep('🖱️ Form Submitted to GST Portal', clickTime);
            finalizeLoginTimeline(totalTime, true);
            console.log(`%c[ReturnPilot Auto-Login] 🖱️ Clicked Login Button in ${clickTime} ms`, 'color: #a855f7; font-weight: bold;');
            console.log(`%c[ReturnPilot Auto-Login] ⏱️ Total Auto-Login Process Duration: ${(totalTime / 1000).toFixed(2)}s (${totalTime} ms)`, 'color: #10b981; font-weight: bold; font-size: 14px;');
          }
        });
        return true;
      }

      // Direct session base64 extraction & AI CAPTCHA solving
      ensureCaptchaRendered().then(async () => {
        const extractStart = performance.now();
        let targetB64 = extractCaptchaBase64();
        if (!targetB64 || targetB64.length < 100) {
          targetB64 = await fetchDirectCaptchaBase64();
        }
        const extractTime = Math.round(performance.now() - extractStart);

        if (targetB64) {
          addTimelineStep('📸 CAPTCHA Image Loaded', extractTime);
          console.log(`%c[ReturnPilot Auto-Login] 📸 Step 2: CAPTCHA Image Extracted in ${extractTime} ms`, 'color: #3b82f6;');
          console.log('%c[ReturnPilot Auto-Login] 🧠 Step 3: Solving CAPTCHA with AI Engine...', 'color: #eab308;');
          const solveStartTime = performance.now();

          const executeSolve = async () => {
            // 0-MS INSTANT CACHE HIT: If already pre-solved in background while user selected account
            if (localPreSolvedCache && localPreSolvedCache.base64 === targetB64 && (Date.now() - localPreSolvedCache.timestamp < 120000)) {
              return { success: true, digits: localPreSolvedCache.digits, confidence: 'high', cached: true };
            }

            // Client-Side License Gate: Strict verification before dispatching any solve request
            const stored = await new Promise(r => rpSafeStorageGet(['rp_user_profile', 'rp_user_email', 'rp_chrome_email', 'rp_license_data'], r));
            if (!checkIsPremium(stored)) {
              return { success: false, error: 'AI CAPTCHA Auto-Fill requires an active ReturnPilot Premium or Trial subscription.' };
            }

            const email = (stored && ((stored.rp_user_profile && stored.rp_user_profile.email) || stored.rp_user_email || stored.rp_chrome_email) || '').trim().toLowerCase();
            if (!email) {
              return { success: false, error: 'User sign-in required for AI CAPTCHA Auto-Fill.' };
            }

            // Centralized Background Worker: Single-flight deduplication, HMAC tokens, and serverless isolation
            return new Promise((resolve) => {
              rpSafeSendMessage({
                request: 'solve-captcha',
                base64Image: targetB64
              }, (res) => {
                if (res && res.success && res.digits) {
                  localPreSolvedCache = { base64: targetB64, digits: res.digits, timestamp: Date.now() };
                }
                resolve(res || { success: false, error: 'No response from background solver' });
              });
            });
          };

          executeSolve().then((solveRes) => {
            const solveDuration = Math.round(performance.now() - solveStartTime);
            const solvedDigits = (solveRes && solveRes.success && solveRes.digits) ? solveRes.digits : '';
            const captchaField = findCaptchaInput();
            const submitBtn = findSubmitButton();

            if (solvedDigits) {
              const label = solveRes.cached 
                ? `⚡ AI Pre-Solved (Memory Cache)` 
                : `🚀 Sent to AI ➔ Solved ➔ Received ("${solvedDigits}")`;
              addTimelineStep(label, solveRes.cached ? 0 : solveDuration);
              console.log(`%c[ReturnPilot Auto-Login] 🚀 Step 3: Sent ➔ Solved ➔ Received "${solvedDigits}" in ${solveRes.cached ? 0 : solveDuration} ms (${solveRes.cached ? 'Memory Cache Hit' : 'HTTP/2 Fast-Path'})`, 'color: #22c55e; font-weight: bold;');
            } else {
              addTimelineStep('⚠️ AI Solve Timeout/Notice', solveDuration, '⚠️');
              console.warn(`[ReturnPilot Auto-Login] ⚠️ CAPTCHA solve notice after ${solveDuration} ms:`, solveRes ? solveRes.error : '');
            }

            if (solvedDigits && captchaField) {
              const fillStart = performance.now();
              captchaField.focus();
              nativeSet(captchaField, solvedDigits);
              captchaField.value = solvedDigits;
              const fillTime = Math.round(performance.now() - fillStart);
              addTimelineStep('⌨️ CAPTCHA Injected to Input', fillTime);
              console.log(`%c[ReturnPilot Auto-Login] ⌨️ Step 4: CAPTCHA Injected to #captcha Input in ${fillTime} ms`, 'color: #00e5ff;');

              // Deterministic 40ms dispatch ensuring AngularJS ngModel has digested
              setTimeout(() => {
                const btn = findSubmitButton();
                if (btn) {
                  const clickStart = performance.now();
                  btn.click();
                  const clickTime = Math.round(performance.now() - clickStart);
                  const totalTime = Math.round(performance.now() - totalBenchmarkStart);
                  addTimelineStep('🖱️ Form Submitted to GST Portal', clickTime);
                  finalizeLoginTimeline(totalTime, true);
                  
                  console.group('%c[ReturnPilot Auto-Login Complete Breakdown]', 'color: #10b981; font-weight: bold; font-size: 13px;');
                  console.log(`🔐 1. Credentials Decrypted & Injected : ${fieldTime} ms`);
                  console.log(`📸 2. CAPTCHA Image Loaded & Extracted : ${extractTime} ms`);
                  console.log(`🚀 3. AI Solved (Sent ➔ Solved ➔ Recv) : ${solveRes.cached ? 0 : solveDuration} ms (${solveRes.cached ? 'Memory Cache Hit' : 'HTTP/2 Direct'})`);
                  console.log(`⌨️ 4. Digits Injected into #captcha    : ${fillTime} ms`);
                  console.log(`🖱️ 5. Form Submitted to GST Portal     : ${clickTime} ms (AngularJS Digest)`);
                  console.log(`⏱️ ⚡ Total Auto-Login Process Duration : ${(totalTime / 1000).toFixed(2)}s (${totalTime} ms)`);
                  console.groupEnd();
                }
              }, 40);
            } else if (captchaField) {
              captchaField.focus();
              const totalTime = Math.round(performance.now() - totalBenchmarkStart);
              finalizeLoginTimeline(totalTime, false);
            }
          });
        }
      }).catch(() => {});
      return true;
    };

    if (!doFillAndSubmit()) {
      let attempts = 0;
      const pollInterval = setInterval(() => {
        _rpIntervals.push(pollInterval);
        attempts++;
        if (doFillAndSubmit() || attempts >= 10) {
          clearInterval(pollInterval);
        }
      }, 50);
    }
  }

  // ── WAIT FOR CAPTCHA TO LOAD ──────────────────────────────────────────────
  // The portal only renders the CAPTCHA after the first LOGIN click, so a
  // long blind poll is wasted work on a fresh page. Poll briefly; if the
  // section never appears, report immediately instead of waiting maxWaitMs.
  function waitForCaptchaAndReport(maxWaitMs = 6000) {
    const started = Date.now();
    const poll = setInterval(() => {
      _rpIntervals.push(poll);
      const img = findCaptchaImage();
      const hasCaptchaSection = !!(findCaptchaInput() || img);
      if (img && img.complete && img.naturalWidth > 0) {
        clearInterval(poll);
        sendPageStateToBackground();
        return;
      }
      // No captcha section at all after 1.2s → report (null captcha) now.
      if (!hasCaptchaSection && Date.now() - started > 1200) {
        clearInterval(poll);
        sendPageStateToBackground();
        return;
      }
      if (Date.now() - started > maxWaitMs) {
        clearInterval(poll);
        sendPageStateToBackground();
      }
    }, 300);
  }

  // ── START CAPTCHA DETECTION AND REPORTING ────────────────────────────────
  function prefillUsernameAndStart() {
    prewarmSolverSocket();
    setupManualLoginListener();
    waitForCaptchaAndReport();
  }

  // ── MUTATION OBSERVER (captures CAPTCHA reloads without page refreshes) ─────
  let lastCaptchaSrc = null;
  const captchaObserver = new MutationObserver(() => {
    const img = findCaptchaImage();
    if (!img) return;

    if (img.src !== lastCaptchaSrc) {
      lastCaptchaSrc = img.src;
      
      const checkAndReport = () => {
        if (img.complete && img.naturalWidth > 0) {
          sendPageStateToBackground();
          return true;
        }
        return false;
      };

      if (!checkAndReport()) {
        const poll = setInterval(() => {
          _rpIntervals.push(poll);
          if (img.src !== lastCaptchaSrc) {
            clearInterval(poll); // src changed again, abort
          } else if (checkAndReport()) {
            clearInterval(poll);
          }
        }, 100);
        setTimeout(() => clearInterval(poll), 5000); // 5s safety timeout
      }
    }
  });

  function startCaptchaObserver() {
    const targetNode = document.body || document.documentElement;
    if (targetNode) {
      captchaObserver.observe(targetNode, {
        subtree:   true,
        childList: true,
        attributes: true,
        attributeFilter: ['src']
      });
    }
  }

  if (document.body || document.documentElement) {
    startCaptchaObserver();
  } else {
    document.addEventListener('DOMContentLoaded', startCaptchaObserver);
  }

  window.addEventListener('pagehide', function() { captchaObserver.disconnect(); });

  // ── MESSAGE LISTENER ────────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.request === 'fill-and-submit-login') {
      window.__rpCaptchaReported = true; // flag submission
      window.__rpIsAutoLogin = true;
      try { 
        sessionStorage.setItem('rp_is_autologin', 'true');
        if (msg.username) {
          sessionStorage.setItem('rp_active_login_user', msg.username);
        }
      } catch (_) {}
      rpSafeStorageSet({ 
        rp_last_autologin_ts: Date.now(),
        ...(msg.username ? { gstUsername: msg.username } : {})
      });
      rpSafeStorageRemove(['rp_pending_save_credentials']); // prevent save prompt
      // Remember credentials so a SWEB_9000 (Invalid CAPTCHA) response can
      // trigger a single automatic retry.
      rpAutoLoginCreds = { username: msg.username, password: msg.password, isPremium: !!msg.isPremium };
      rpAutoLoginAt = Date.now();
      rpSweb9000Retried = false; // fresh retry budget per auto-login run
      fillAndSubmit(msg.username, msg.password, msg.captcha, msg.isPremium);
      sendResponse({ success: true });
      return;
    }

    if (msg.request === 'get-new-captcha') {
      prewarmSolverSocket();
      // Ensure username is prefilled
      rpSafeStorageGet(['gstUsername'], (data) => {
        const savedUsername = data.gstUsername || '';
        const usernameField = findUsernameField();
        if (savedUsername && usernameField && usernameField.value !== savedUsername) {
          usernameField.focus();
          nativeSet(usernameField, savedUsername);
        }
        
        const img = findCaptchaImage();
        const oldSrc = img ? img.src : '';
        const refreshBtn = findRefreshCaptchaButton();
        
        if (refreshBtn) {
          refreshBtn.click();
          
          // Wait for src to change and image to load
          let attempts = 0;
          const poll = setInterval(() => {
            _rpIntervals.push(poll);
            attempts++;
            const currentImg = findCaptchaImage();
            if (currentImg && currentImg.src !== oldSrc && currentImg.complete && currentImg.naturalWidth > 0) {
              clearInterval(poll);
              sendPageStateToBackground();
            } else if (attempts >= 20) { // 6 seconds timeout
              clearInterval(poll);
              console.warn('[ReturnPilot Login Bridge] Failed to load new captcha via refresh click, reloading page...');
              window.location.reload();
            }
          }, 300);
        } else {
          window.location.reload();
        }
      });
      sendResponse({ success: true });
      return;
    }
  });

  // ── BOOT ────────────────────────────────────────────────────────────────────
  if (href.includes('/services/login')) {
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      prefillUsernameAndStart();
    } else {
      window.addEventListener('DOMContentLoaded', prefillUsernameAndStart);
    }
  } else if (href.includes('gst.gov.in') && !href.includes('/services/login')) {
    // Authenticated portal pages (fowelcome, dashboard, returns, etc.)
    const PORTAL_USER_CACHE_KEYS = [
      'userdetails', 'gstin', 'lgnm', 'trdnm', 'gstpType',
      'curFnYr', 'fin_year', 'rtn_prd', 'previousPage', 'TODates', 'gstr2bData'
    ];

    function detectAndHandlePortalUserSwitch() {
      try {
        let liveGstin = '';
        const gstinNode = document.querySelector('[data-ng-bind*="udata.gstin"], [ng-bind*="udata.gstin"]');
        if (gstinNode && gstinNode.textContent) {
          const m = gstinNode.textContent.trim().toUpperCase().match(/\b\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}\b/);
          if (m) liveGstin = m[0];
        }
        if (!liveGstin) {
          try {
            const rawUd = localStorage.getItem('userdetails') || sessionStorage.getItem('userdetails');
            if (rawUd) {
              const ud = JSON.parse(rawUd);
              const g = (ud.gstin || ud.authGstin || '').trim().toUpperCase();
              if (/\b\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}\b/.test(g)) {
                liveGstin = g;
              }
            }
          } catch (_) {}
        }
        if (!liveGstin) return;

        const cachedGstin = (localStorage.getItem('_rp_current_gstin') || '').trim().toUpperCase();
        if (cachedGstin && cachedGstin !== liveGstin) {
          console.info('[ReturnPilot] Portal user switch detected:', cachedGstin, '→', liveGstin, '. Purging stale portal cache.');
          PORTAL_USER_CACHE_KEYS.forEach(function(k) {
            try { localStorage.removeItem(k); } catch (_) {}
          });
          localStorage.setItem('_rp_current_gstin', liveGstin);
          rpSafeSendMessage({ request: 'user-switch-flush', newGstin: liveGstin });
          rpSafeSendMessage({
            request: 'rp-telemetry-log',
            level: 'userAction',
            tag: 'PORTAL_USER_SWITCH',
            message: `Portal taxpayer switch detected: ${cachedGstin} → ${liveGstin}`,
            details: { oldGstin: cachedGstin, newGstin: liveGstin }
          });
        } else if (!cachedGstin && liveGstin) {
          localStorage.setItem('_rp_current_gstin', liveGstin);
        }
      } catch (_) {}
    }

    function installPortalUserActionObserver() {
      function extractCurrentPortalPeriodAndGstin() {
        let gstin = (localStorage.getItem('_rp_current_gstin') || localStorage.getItem('gstin') || '').trim().toUpperCase();
        if (!gstin) {
          const gNode = document.querySelector('[data-ng-bind*="udata.gstin"], [ng-bind*="udata.gstin"]');
          if (gNode && gNode.textContent) {
            const m = gNode.textContent.trim().toUpperCase().match(/\b\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}\b/);
            if (m) gstin = m[0];
          }
        }
        let period = '';
        const monSelect = document.querySelector('#mon, select[name="mon"], select[name="period"], select[name="quarter"]');
        if (monSelect && monSelect.value) {
          period = monSelect.value;
        }
        if (!period) {
          const storageKeys = ['rtn_prd', 'ret_period', 'returnPeriod', 'tax_period', 'taxperiod', 'fp'];
          for (const k of storageKeys) {
            try {
              const v = sessionStorage.getItem(k) || localStorage.getItem(k);
              if (v && /^\d{6}$/.test(v)) { period = v; break; }
            } catch (_) {}
          }
        }
        let fy = '';
        const fySelect = document.querySelector('#finYear, select[name="finYear"], select[name="fy"]');
        if (fySelect && fySelect.value) {
          fy = fySelect.value;
        }
        if (!fy) {
          try { fy = sessionStorage.getItem('fin_year') || localStorage.getItem('fin_year') || ''; } catch (_) {}
        }
        return { gstin, period, fy };
      }

      // 1. Click Listener (detects downloads, search clicks, and filing buttons)
      document.addEventListener('click', function(e) {
        const el = e.target && e.target.closest && e.target.closest('a, button, input[type="button"], input[type="submit"], [role="button"], .btn');
        if (!el) return;

        const text = (el.innerText || el.textContent || el.value || el.title || el.getAttribute('aria-label') || '').trim();
        const lowerText = text.toLowerCase();
        const lowerHref = (el.getAttribute('href') || '').toLowerCase();
        const lowerOnclick = (el.getAttribute('onclick') || el.getAttribute('ng-click') || '').toLowerCase();
        const currentHash = (window.location.hash || '').toLowerCase();
        const currentPath = window.location.pathname;

        // A. Return Download Actions (PDF / Excel / JSON / Offline)
        const isDownloadBtn = lowerText.includes('download') || 
                              lowerOnclick.includes('download') || 
                              lowerHref.includes('download') ||
                              el.classList.contains('fa-download') ||
                              el.querySelector('.fa-download') !== null;

        if (isDownloadBtn) {
          let returnType = 'GSTR3B';
          const cardHeading = el.closest('.card, .tile, .dashboard-card, .box, [class*="card"], [class*="tile"]')?.textContent?.toLowerCase() || '';
          if (lowerText.includes('gstr-3b') || lowerText.includes('gstr3b') || lowerText.includes('3b') || currentHash.includes('3b') || cardHeading.includes('3b')) {
            returnType = 'GSTR3B';
          } else if (lowerText.includes('gstr-1a') || lowerText.includes('gstr1a') || lowerText.includes('1a') || currentHash.includes('1a') || cardHeading.includes('1a')) {
            returnType = 'GSTR1A';
          } else if (lowerText.includes('gstr-1') || lowerText.includes('gstr1') || currentHash.includes('gstr1') || cardHeading.includes('gstr-1')) {
            returnType = 'GSTR1';
          } else if (lowerText.includes('gstr-2b') || lowerText.includes('gstr2b') || lowerText.includes('2b') || currentHash.includes('2b') || cardHeading.includes('2b')) {
            returnType = 'GSTR2B';
          } else if (lowerText.includes('gstr-9') || lowerText.includes('gstr9') || currentHash.includes('gstr9') || cardHeading.includes('gstr-9')) {
            returnType = 'GSTR9';
          } else if (lowerText.includes('gstr-4') || lowerText.includes('gstr4') || currentHash.includes('gstr4') || cardHeading.includes('gstr-4')) {
            returnType = 'GSTR4';
          }

          const ctx = extractCurrentPortalPeriodAndGstin();

          // Pre-register manual download context in background service worker
          rpSafeSendMessage({
            request: 'record-portal-manual-download',
            returnType: returnType,
            period: ctx.period,
            gstin: ctx.gstin,
            fy: ctx.fy,
            source: 'portal-dom-click',
            buttonText: text,
            route: currentHash || currentPath
          });

          // Telemetry audit log
          rpSafeSendMessage({
            request: 'rp-telemetry-log',
            level: 'userAction',
            tag: 'PORTAL_MANUAL_DOWNLOAD',
            message: `User clicked manual download on portal for ${returnType} (Period: ${ctx.period || 'current'}, GSTIN: ${ctx.gstin || 'current'})`,
            details: {
              returnType,
              period: ctx.period,
              fy: ctx.fy,
              gstin: ctx.gstin,
              buttonText: text,
              url: window.location.href,
              tagName: el.tagName
            }
          });
          return;
        }

        // B. Search Button Click
        const isSearchBtn = lowerText === 'search' || el.id === 'search' || el.id === 'btnSearch' || lowerOnclick.includes('search');
        if (isSearchBtn) {
          const ctx = extractCurrentPortalPeriodAndGstin();
          rpSafeSendMessage({
            request: 'rp-telemetry-log',
            level: 'userAction',
            tag: 'PORTAL_SEARCH_CLICK',
            message: `User clicked Search on Returns Dashboard (FY: ${ctx.fy || 'default'}, Period: ${ctx.period || 'default'})`,
            details: { fy: ctx.fy, period: ctx.period, gstin: ctx.gstin }
          });
          return;
        }

        // C. Notices / Orders
        if (lowerText === 'view' || lowerText.includes('view') || lowerHref.includes('notices') || lowerHref.includes('viewnotices')) {
          setTimeout(() => {
            try {
              if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
                chrome.runtime.sendMessage({ request: 'notice-viewed-on-portal' }).catch(() => {});
              }
            } catch (_) {}
          }, 1200);
        }

        // D. Filing and Navigation Action
        const isNavAction = lowerText.includes('file return') ||
                            lowerText.includes('prepare online') ||
                            lowerText.includes('prepare offline') ||
                            lowerText.includes('view summary') ||
                            lowerText.includes('proceed to file') ||
                            lowerText.includes('proceed to pay') ||
                            lowerText.includes('returns dashboard');
        if (isNavAction) {
          const ctx = extractCurrentPortalPeriodAndGstin();
          rpSafeSendMessage({
            request: 'rp-telemetry-log',
            level: 'userAction',
            tag: 'PORTAL_ACTION_CLICK',
            message: `User clicked "${text}" on GST Portal`,
            details: { buttonText: text, fy: ctx.fy, period: ctx.period, gstin: ctx.gstin, hash: currentHash }
          });
          return;
        }
      }, true);

      // 2. Select Filter Changes (FY & Period)
      document.addEventListener('change', function(e) {
        const select = e.target && e.target.closest && e.target.closest('select');
        if (!select) return;
        const selectId = select.id || select.name || '';
        const selectedVal = select.value || '';
        const selectedTxt = (select.options && select.selectedIndex >= 0 && select.options[select.selectedIndex]?.text) || selectedVal;

        if (selectId.toLowerCase().includes('year') || selectId.toLowerCase().includes('fy') || selectId.toLowerCase().includes('mon') || selectId.toLowerCase().includes('quarter') || selectId.toLowerCase().includes('period')) {
          rpSafeSendMessage({
            request: 'rp-telemetry-log',
            level: 'userAction',
            tag: 'PORTAL_DROPDOWN_CHANGE',
            message: `User changed portal filter ${selectId}: "${selectedTxt}" (${selectedVal})`,
            details: { filter: selectId, value: selectedVal, text: selectedTxt }
          });
        }
      }, true);

      // 3. Hash & Popstate Transitions
      window.addEventListener('hashchange', function() {
        rpSafeSendMessage({
          request: 'rp-telemetry-log',
          level: 'userAction',
          tag: 'PORTAL_ROUTE_CHANGE',
          message: `Portal route changed to ${window.location.hash || 'root'}`,
          details: { hash: window.location.hash, pathname: window.location.pathname }
        });
        detectAndHandlePortalUserSwitch();
      });
      window.addEventListener('popstate', function() {
        detectAndHandlePortalUserSwitch();
      });
    }

    const runEnrichmentSequence = () => {
      detectAndHandlePortalUserSwitch();
      autoEnrichSavedAccountsFromSession();
      setTimeout(autoEnrichSavedAccountsFromSession, 1200);
      setTimeout(autoEnrichSavedAccountsFromSession, 3000);
      setTimeout(checkPendingSaveCredentials, 800);
    };

    installPortalUserActionObserver();

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      runEnrichmentSequence();
    } else {
      window.addEventListener('DOMContentLoaded', runEnrichmentSequence);
    }

    // Re-check on AngularJS client-side route transitions
    window.addEventListener('hashchange', () => setTimeout(autoEnrichSavedAccountsFromSession, 800));
    window.addEventListener('popstate', () => setTimeout(autoEnrichSavedAccountsFromSession, 800));
  }

})();
