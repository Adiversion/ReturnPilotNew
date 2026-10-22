// ═══════════════════════════════════════════════════════════════
//  ReturnPilot v3.1 — Integrated Content Script
//  © 2026 KasyHQ. All Rights Reserved.
// ═══════════════════════════════════════════════════════════════

(function () {
'use strict';

// ═════════════════════════════════════════════════════════════
//  DOUBLE-INJECTION GUARD
// ═════════════════════════════════════════════════════════════

var _rpIntervals = [];
window.addEventListener('pagehide', function() {
  _rpIntervals.forEach(function(id) { clearInterval(id); });
  _rpIntervals = [];
});

if (window.__returnPilotLoaded) {
  console.log('[ReturnPilot CS] Already loaded — skipping re-init');
  return;
}
window.__returnPilotLoaded = true;

console.log('[ReturnPilot CS] Content script loaded —', location.href);

// ═════════════════════════════════════════════════════════════
//  STALE USER CACHE & USER SWITCH DETECTOR
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

function detectAndHandleUserSwitch() {
  try {
    const GSTIN_SELECTORS = [
      '[data-ng-bind*="udata.gstin"]',
      '[ng-bind*="udata.gstin"]',
      'li[ng-if*="udata"] [data-ng-bind]',
      'li[ng-if*="udata"] [ng-bind]',
      '[data-ng-bind*="gstin"]',
      '[ng-bind*="gstin"]',
      '.gstin-display',
      '#gstin',
      '[class*="gstin"]'
    ];

    let liveGstin = null;
    for (const sel of GSTIN_SELECTORS) {
      try {
        const el = document.querySelector(sel);
        if (el && el.textContent) {
          const m = el.textContent.trim().toUpperCase().match(/\b\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}\b/);
          if (m) {
            liveGstin = m[0];
            break;
          }
        }
      } catch(_) {}
    }

    if (!liveGstin) {
      const authKeys = ['udata', 'userdetails', 'user_data', 'profile'];
      for (const k of authKeys) {
        try {
          const raw = localStorage.getItem(k) || sessionStorage.getItem(k);
          if (raw) {
            const ud = JSON.parse(raw);
            const g = (ud.gstin || ud.authGstin || '').trim().toUpperCase();
            if (g && /\b\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}\b/.test(g)) {
              liveGstin = g;
              break;
            }
          }
        } catch(_) {}
      }
    }

    if (!liveGstin) return false;

    var cachedGstin = (localStorage.getItem('_rp_current_gstin') || '').trim().toUpperCase();

    if (cachedGstin && cachedGstin !== liveGstin) {
      // User switch detected — this is a normal handled event, NOT an error.
      // Use console.info so it does NOT surface in the extension Errors panel.
      console.info('[ReturnPilot] User switch detected. Flushing stale cache.',
        'Previous GSTIN:', cachedGstin, '→ New GSTIN:', liveGstin);

      // 1. Flush known user-specific localStorage keys
      USER_CACHE_KEYS.forEach(function(k) {
        try { localStorage.removeItem(k); } catch(_) {}
      });

      // 2. Flush all dynamic portal keys: ls.*, _rp*, gstr*, case*, caseJson*
      var toFlush = [];
      for (var i = 0; i < localStorage.length; i++) {
        try {
          var k = localStorage.key(i);
          if (!k) continue;
          if (
            k.startsWith('ls.') ||
            k.startsWith('_rp') ||
            k.startsWith('gstr') ||
            k.startsWith('case') ||
            k.startsWith('ls.caseJson') ||
            k.startsWith('caseJson')
          ) {
            toFlush.push(k);
          }
        } catch(_) {}
      }
      toFlush.forEach(function(k) {
        try { localStorage.removeItem(k); } catch(_) {}
      });

      // 3. Flush _rp* keys from sessionStorage (keep nothing user-specific)
      var ssToFlush = [];
      for (var j = 0; j < sessionStorage.length; j++) {
        try {
          var sk = sessionStorage.key(j);
          if (sk && sk.startsWith('_rp')) ssToFlush.push(sk);
        } catch(_) {}
      }
      ssToFlush.forEach(function(sk) {
        try { sessionStorage.removeItem(sk); } catch(_) {}
      });

      // 4. Update _rp_current_gstin to the new user
      localStorage.setItem('_rp_current_gstin', liveGstin);

      // 5. Notify background to flush its session data (except auth tokens)
      //    and re-propagate cookies for the new user session.
      try {
        chrome.runtime.sendMessage({ request: 'user-switch-flush', newGstin: liveGstin }, function(resp) {
          if (chrome.runtime.lastError) {
            // Non-critical — background may not be active yet
            console.info('[ReturnPilot] Background user-switch flush skipped:', chrome.runtime.lastError.message);
          } else {
            console.info('[ReturnPilot] Background user-switch flush OK:', resp);
          }
        });
      } catch(msgErr) {
        console.info('[ReturnPilot] Could not reach background for user-switch flush:', msgErr.message);
      }

      return true;
    }

    if (!cachedGstin) {
      localStorage.setItem('_rp_current_gstin', liveGstin);
    }
    return false;
  } catch(e) {
    // Genuine unexpected error — still surface this one
    console.error('[ReturnPilot] detectAndHandleUserSwitch unexpected error:', e.message);
    return false;
  }
}



// Run user-switch check early on script injection
detectAndHandleUserSwitch();


// ═════════════════════════════════════════════════════════════
//  PORTAL IP CAPTURE ENGINE (Polled Timing Optimization)
// ═════════════════════════════════════════════════════════════
//  Polled execution loop to completely eliminate network-latency
//  and caching race conditions across variable network environments.

function scrapePortalIP() {
  try {
    let ipAddress = null;

    // 1. Scan DOM innerText for logged in IP pattern (e.g. "Currently logged in from IP: 223.181.86.116")
    // textContent avoids the forced layout/reflow that innerText triggers on every poll tick
    const bodyText = document.body ? (document.body.textContent || '') : '';
    const domMatch = bodyText.match(/Currently logged in from IP:\s*([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})/i)
                  || bodyText.match(/logged in from IP:\s*([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})/i);
    if (domMatch && domMatch[1]) {
      ipAddress = domMatch[1].trim();
    }

    // 2. Fall back to scanning script tags for USER_IP constant
    if (!ipAddress) {
      const scripts = document.getElementsByTagName('script');
      for (let script of scripts) {
        const text = script.textContent || script.innerText;
        if (!text) continue;
        const match = text.match(/USER_IP['"]\s*,\s*['"]([^'"]+)/) || text.match(/['"]USER_IP['"]\s*,\s*['"]([^'"]+)['"]/);
        if (match && match[1]) {
          ipAddress = match[1].replace(/['"\s;)]/g, '').trim();
          break;
        }
      }
    }

    if (ipAddress && !ipAddress.includes('gst.gov.in')) {
      // Sync to localStorage and sessionStorage for page-context jQuery $.fn.getConstant
      try {
        localStorage.setItem('user_ip', ipAddress);
        localStorage.setItem('ip_address', ipAddress);
        localStorage.setItem('userIp', ipAddress);
        sessionStorage.setItem('user_ip', ipAddress);
      } catch (_) {}

      // Persist securely to extension storage context
      try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set({ loggedInUserIP: ipAddress }, function () {
            console.log('[ReturnPilot CS] Successfully captured network session IP:', ipAddress);
          });
        }
      } catch (_) {}
      return true; // Flag success to kill polling loop
    }
  } catch (err) {
    console.warn('[ReturnPilot CS] Portal IP capture loop execution skipped:', err.message);
  }
  return false; // Not found yet on this loop tick
}

// Polling Initialization: Checks every 400ms for up to 6 seconds (15 ticks max)
let ipCaptureTicks = 0;
const ipCaptureInterval = setInterval(function () {
  _rpIntervals.push(ipCaptureInterval);
  ipCaptureTicks++;
  const isCaptured = scrapePortalIP();
  
  if (isCaptured || ipCaptureTicks > 15) {
    clearInterval(ipCaptureInterval); // Cleanly kill loop once found or timed out
  }
}, 400);

// ═════════════════════════════════════════════════════════════
//  API LOGGER INTERCEPTOR LISTENER (api-logger-inject.js)
// ═════════════════════════════════════════════════════════════
window.addEventListener('message', function (event) {
  if (!event || !event.data || event.data.type !== 'API_LOGGER_REQUEST') return;
  const reqData = event.data.data;
  if (!reqData || !reqData.url) return;

  // Intercept GSTR-1 Summary API Completion
  if (reqData.url.includes('/returns/auth/api/gstr1/summary')) {
    console.log('[ReturnPilot CS] Intercepted /gstr1/summary response via api-logger-inject:', reqData.responseStatus);
    if (reqData.headers && reqData.headers.at) {
      try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set({ activeAuthToken: reqData.headers.at });
        }
      } catch (_) {}
    }
  }
});

// Automatic capture trigger block matching DOM loading states
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', scrapePortalIP);
} else {
  scrapePortalIP();
}

// ═════════════════════════════════════════════════════════════
//  DISCONNECTION TRACKER
// ═════════════════════════════════════════════════════════════
//  Tracks which ports have been closed. Used by safePostMessage
//  to avoid "Attempting to use a disconnected port object" errors
//  when async operations complete after the popup has closed.

const disconnectedPorts = new WeakSet();

// ═════════════════════════════════════════════════════════════
//  SAFE POST MESSAGE
// ═════════════════════════════════════════════════════════════
//  Every port.postMessage that happens after an async gap
//  (fetch, FileReader, fflate) must go through this helper.
//  The popup can close at any point during those operations.

function safePostMessage(port, message) {
  if (!port || typeof port.postMessage !== 'function' || disconnectedPorts.has(port)) {
    console.log('[ReturnPilot CS] Port closed or invalid — dropping reply id:', message ? message.Id : '');
    return;
  }
  try {
    port.postMessage(message);
  } catch (err) {
    console.log('[ReturnPilot CS] Port closed during postMessage:', err.message);
  }
}

// ═════════════════════════════════════════════════════════════
//  REPLY HELPER
// ═════════════════════════════════════════════════════════════

function reply(port, msg, success, data, extras) {
  const response = { Id: msg.Id, success: success, status: success };
  if (data !== null && data !== undefined) response.response = data;
  if (extras) Object.assign(response, extras);
  safePostMessage(port, response);
}

// ═════════════════════════════════════════════════════════════
//  PORT REQUEST DISPATCH TABLE
// ═════════════════════════════════════════════════════════════
//  All handlers share the (msg, port) signature. Handlers are hoisted
//  function declarations in this IIFE, so the table can live here even
//  though they are defined further down the file.

const PORT_HANDLERS = {
  ping(msg, port) {
    // ping is synchronous — no async gap, safe to postMessage directly
    safePostMessage(port, { Id: msg.Id, success: true, data: 'pong' });
  },
  'fetch-portal-ip': handleFetchPortalIP,
  'download-pdf-via-angular': handleDownloadPdfViaAngular,
  'download-pdf-via-angular-gstr1': handleDownloadPdfViaAngularGstr1,
  'download-pdf-via-angular-gstr1a': handleDownloadPdfViaAngularGstr1a,
  'download-pdf-via-angular-gstr2b': handleDownloadPdfViaAngularGstr2b,
  'download-pdf-via-angular-gstr9': handleDownloadPdfViaAngularGstr9,
  'download-excel-via-angular-gstr2b': handleDownloadExcelViaAngularGstr2b,
  get: handleGet,
  getBinaryData: handleBinaryData,
  'save-json-as-zip': handleSaveJsonAsZip,
  async 'get-page-taxpayer-info'(msg, port) {
    let liveGstin = '';
    let liveTradeName = '';
    let liveLegalName = '';
    let regType = '';
    let liveStatus = '';

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
            liveTradeName = extracted;
            liveLegalName = extracted;
          }
        }
      }

      // 2. User profile dropdown / navbar anchors
      if (!liveTradeName) {
        const USER_PROFILE_SELECTORS = [
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
        for (const sel of USER_PROFILE_SELECTORS) {
          const target = document.querySelector(sel);
          if (!target) continue;
          const anchor = (target.matches && target.matches('a'))
            ? target
            : (target.closest('.dropdown')?.querySelector('a.dropdown-toggle, a.lang-dpwn, [data-toggle="dropdown"]') || target.previousElementSibling);
          if (anchor) {
            const extracted = extractCleanName(anchor);
            if (extracted) {
              liveTradeName = extracted;
              liveLegalName = extracted;
              break;
            }
          }
        }
      }

      // 2. Extract GSTIN directly from DOM (e.g. <div data-ng-bind="udata.gstin">22AAKCR2040N1ZE</div>)
      const GSTIN_SELECTORS = [
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
      for (const sel of GSTIN_SELECTORS) {
        const el = document.querySelector(sel);
        if (el && el.textContent) {
          const m = el.textContent.trim().toUpperCase().match(/\b\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}\b/);
          if (m) { liveGstin = m[0]; break; }
        }
      }
      if (!liveGstin) {
        liveGstin = (localStorage.getItem('_rp_current_gstin') || localStorage.getItem('gstin') || '').trim().toUpperCase();
      }

      // 4. Storage Lookup (bname checked FIRST)
      const authKeys = ['udata', 'userdetails', 'user_data', 'profile'];
      for (const key of authKeys) {
        try {
          const raw = localStorage.getItem(key) || sessionStorage.getItem(key);
          if (raw) {
            const ud = JSON.parse(raw);
            if (ud && typeof ud === 'object') {
              if (!liveGstin) liveGstin = (ud.gstin || ud.authGstin || '').trim().toUpperCase();
              if (!liveTradeName) {
                liveTradeName = ud.bname || ud.tradeNam || ud.tradeName || ud.legalName || ud.lgnm || ud.userName || '';
              }
              if (!liveLegalName) {
                liveLegalName = ud.bname || ud.legalName || ud.lgnm || '';
              }
              if (!regType) regType = ud.regType || ud.userType || ud.rt || '';
              if (!liveStatus) {
                const s = ud.sts || ud.statusDesc || ud.taxpayerStatus || ud.status || ud.stsDesc;
                if (s && typeof s === 'string') liveStatus = s;
              }
            }
          }
        } catch (_) {}
      }

      // 4b. Probe Angular 1.x Scope for direct udata model (instant & authoritative)
      if (!liveStatus || !liveTradeName || !liveGstin) {
        try {
          if (window.angular) {
            const el = document.querySelector('[ng-controller], [data-ng-controller], [ng-app], [data-ng-app], header, #navbar');
            if (el) {
              const scope = window.angular.element(el).scope();
              const u = scope?.udata || scope?.user || scope?.$root?.udata;
              if (u && typeof u === 'object') {
                if (!liveGstin && u.gstin) liveGstin = u.gstin.trim().toUpperCase();
                if (!liveTradeName && u.bname) liveTradeName = u.bname;
                else if (!liveTradeName && (u.tradeNam || u.legalName)) liveTradeName = u.tradeNam || u.legalName;
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

      // 5. Authoritative /services/api/ustatus fallback from live page session (bname is always present here!)
      if (!liveTradeName || !liveGstin) {
        try {
          const uRes = await fetch('/services/api/ustatus', { credentials: 'include' });
          if (uRes.ok) {
            const uData = await uRes.json();
            if (uData && typeof uData === 'object') {
              if (!liveGstin && uData.gstin) liveGstin = uData.gstin.trim().toUpperCase();
              if (!liveTradeName && uData.bname) {
                liveTradeName = uData.bname;
                liveLegalName = uData.bname;
              }
              if (!regType && (uData.regType || uData.utype)) regType = uData.regType || uData.utype;
              if (!liveStatus && uData.sts) liveStatus = uData.sts;
            }
          }
        } catch (_) {}
      }

      // 5b. Direct /services/auth/profile/detail fetch from live page session (same-origin on services.gst.gov.in)
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
              if (!liveTradeName && (pData.tradeNam || pData.lgnm)) {
                liveTradeName = pData.tradeNam || pData.lgnm;
                liveLegalName = pData.lgnm || pData.tradeNam;
              }
            }
          }
        } catch (_) {}
      }

      // 6. Name selectors fallback
      if (!liveTradeName) {
        const NAME_SELECTORS = [
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
        for (const sel of NAME_SELECTORS) {
          const el = document.querySelector(sel);
          if (el) {
            const extracted = extractCleanName(el);
            if (extracted) {
              liveTradeName = extracted;
              break;
            }
          }
        }
      }
    } catch (_) {}
    safePostMessage(port, {
      Id: msg.Id,
      status: true,
      statusCode: 200,
      gstin: liveGstin,
      tradeName: liveTradeName,
      legalName: liveLegalName,
      regType: regType,
      taxpayerStatus: liveStatus
    });
  },
  log(msg, port) {
    console.log('[ReturnPilot CS] log:', msg.text, msg.obj || '');
    safePostMessage(port, { Id: msg.Id, success: true });
  }
};

// ═════════════════════════════════════════════════════════════
//  PORT CONNECTION LISTENER
// ═════════════════════════════════════════════════════════════

chrome.runtime.onConnect.addListener(function (port) {

  if (port.name !== 'ReturnPilot') return;

  console.log('[ReturnPilot CS] Port connected');

  port.onDisconnect.addListener(function () {
    const err = chrome.runtime.lastError; // must be read — suppresses Chrome warning
    disconnectedPorts.add(port);
    console.log(
      '[ReturnPilot CS] Port disconnected',
      err ? '(error: ' + err.message + ')' : '(clean)'
    );
  });

  port.onMessage.addListener(function (msg) {
    console.log('[ReturnPilot CS] ←', msg.request, '| id:', msg.Id);

    // Requests are dispatched through PORT_HANDLERS (defined above the listener).
    const handler = PORT_HANDLERS[msg.request];
    if (handler) { handler(msg, port); return; }

    console.warn('[ReturnPilot CS] Unknown request type:', msg.request);
    safePostMessage(port, {
      Id     : msg.Id,
      success: false,
      error  : `Unknown request type: ${msg.request}`
    });
  });

});

// ═════════════════════════════════════════════════════════════
//  GET — authenticated JSON / text fetch with token memory cache
// ═════════════════════════════════════════════════════════════
//  fetch() is async — popup may close before it completes.
//  All postMessage calls go through safePostMessage.

let _cachedAuthToken = null;
let _cachedTokenTime = 0;
const TOKEN_CACHE_TTL_MS = 60000; // 60s in-memory token cache

function getAuthTokenFast(url) {
  const now = Date.now();
  if (_cachedAuthToken && (now - _cachedTokenTime < TOKEN_CACHE_TTL_MS)) {
    return Promise.resolve(_cachedAuthToken);
  }
  return new Promise(function (resolve) {
    chrome.runtime.sendMessage({ request: 'get-auth-token', url: url }, function (response) {
      if (chrome.runtime.lastError || !response || !response.token) {
        resolve(null);
        return;
      }
      _cachedAuthToken = response.token;
      _cachedTokenTime = Date.now();
      resolve(_cachedAuthToken);
    });
  });
}

function invalidateCachedToken() {
  _cachedAuthToken = null;
  _cachedTokenTime = 0;
}

function handleGet(msg, port) {
  try {
    const u = new URL(msg.url);
    console.log('[ReturnPilot CS] get →', u.origin + u.pathname);
  } catch (_) {
    console.log('[ReturnPilot CS] get → (unparseable url)');
  }

  getAuthTokenFast(msg.url).then(function (token) {
    const headers = { 
      'Accept': 'application/json, text/plain, */*',
      'X-Requested-With': 'XMLHttpRequest'
    };
    if (token) {
      headers['at'] = token;
    }

    fetch(msg.url, {
      method     : 'GET',
      credentials: 'include',
      headers    : headers
    })
    .then(function (resp) {
      if (resp.status === 401 || resp.status === 403) {
        invalidateCachedToken();
      }
      return resp.text().then(function (text) {
        console.log('[ReturnPilot CS] get ← status:', resp.status, '| url:', resp.url);
        try {
          console.log('[ReturnPilot CS] get ← body:', JSON.parse(text));
        } catch (_) {
          console.log('[ReturnPilot CS] get ← raw text:', text.length > 300 ? text.substring(0, 300) + '...' : text);
        }

        const trimmed = text.trim().toLowerCase();
        const isHtml  = trimmed.startsWith('<!doctype') ||
                        trimmed.startsWith('<html');

        if (isHtml) {
          invalidateCachedToken();
          console.warn('[ReturnPilot CS] get ← HTML response — session likely expired');
          safePostMessage(port, {
            Id         : msg.Id,
            status     : false,
            statusCode : resp.status,
            error      : 'Session expired or access denied (HTML response)',
            response   : null,
            responseUrl: resp.url
          });
          return;
        }

        safePostMessage(port, {
          Id         : msg.Id,
          status     : resp.ok,
          statusCode : resp.status,
          response   : text,
          responseUrl: resp.url
        });
      });
    })
    .catch(function (err) {
      // If fetch fails (e.g. CORS preflight restriction across GST subdomains), fallback to extension SW bg-fetch
      console.log('[ReturnPilot CS] get error:', err.message, '— attempting extension bg-fetch fallback');
      chrome.runtime.sendMessage({ request: 'bg-fetch', url: msg.url }, function (bgRes) {
        if (chrome.runtime.lastError || !bgRes) {
          safePostMessage(port, {
            Id        : msg.Id,
            status    : false,
            statusCode: 0,
            error     : err.message,
            response  : null
          });
        } else {
          let respText = typeof bgRes.response === 'string' ? bgRes.response : JSON.stringify(bgRes.response || {});
          safePostMessage(port, {
            Id        : msg.Id,
            status    : bgRes.status !== false && bgRes.statusCode === 200,
            statusCode: bgRes.statusCode || 200,
            response  : respText,
            responseUrl: msg.url
          });
        }
      });
    });
  });
}

// ═════════════════════════════════════════════════════════════
//  SAVE JSON AS ZIP
// ═════════════════════════════════════════════════════════════
//  Compress JSON return into ZIP via fflate.
//  All postMessage calls go through safePostMessage.

function uint8ToBase64(bytes) {
  let binary = '';
  const CHUNK = 4096;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)));
  }
  return btoa(binary);
}

function handleSaveJsonAsZip(msg, port) {
  console.log('[ReturnPilot CS] save-json-as-zip:', msg.zipfilename);

  try {
    const fflateLib = (typeof fflate !== 'undefined') ? fflate : (typeof window !== 'undefined' ? window.fflate : (typeof self !== 'undefined' ? self.fflate : null));
    if (!fflateLib || typeof fflateLib.zipSync !== 'function') {
      throw new Error('fflate library not found for ZIP generation');
    }

    const zipData = {};
    const rawStr = (typeof msg.jsonData === 'string') ? msg.jsonData : JSON.stringify(msg.jsonData);
    zipData[msg.jsonfilename + '.json'] = fflateLib.strToU8(rawStr);
    const zipped = fflateLib.zipSync(zipData, { level: 6 });
    const base64 = uint8ToBase64(zipped);
    safePostMessage(port, { Id: msg.Id, status: true, response: base64 });
  } catch (err) {
    console.error('[ReturnPilot CS] save-json-as-zip setup error:', err);
    safePostMessage(port, { Id: msg.Id, status: false, error: err.message });
  }
}

// ═════════════════════════════════════════════════════════════
//  GET BINARY DATA — XHR with FileReader encoding
// ═══════════════════════════════════════════════════════════
//  XHR and FileReader are both async. reply() calls
//  safePostMessage internally so disconnection is handled.

function handleBinaryData(msg, port) {
  console.log('[ReturnPilot CS] getBinaryData →', msg.url);

  getAuthTokenFast(msg.url).then(function (token) {
    const xhr           = new XMLHttpRequest();
    xhr.open('GET', msg.url, true);
    xhr.responseType    = 'blob';
    xhr.withCredentials = true;
    xhr.timeout         = 25000;

    xhr.setRequestHeader('Accept', 'application/json, text/plain, */*');
    xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
    if (token) {
      xhr.setRequestHeader('at', token);
    }

    xhr.onprogress = function (event) {
      if (disconnectedPorts.has(port)) {
        xhr.abort();
        return;
      }
      safePostMessage(port, {
        Id     : msg.Id,
        request: 'progress',
        loaded : event.loaded,
        total  : event.lengthComputable ? event.total : 0
      });
    };

    xhr.onload = function () {
      if (xhr.status < 200 || xhr.status >= 300) {
        reply(port, msg, false, null, { error: `HTTP ${xhr.status}` });
        return;
      }

      const blob   = xhr.response;
      const reader = new FileReader();

      reader.onloadend = function () {
        if (disconnectedPorts.has(port)) return;
        const comma  = reader.result.indexOf(',');
        const base64 = reader.result.substring(comma + 1);
        console.log('[ReturnPilot CS] getBinaryData ← base64 length:', base64.length);
        reply(port, msg, true, base64, { size: blob.size });
      };

      reader.onerror = function () {
        console.error('[ReturnPilot CS] FileReader error');
        reply(port, msg, false, null, { error: 'FileReader failed' });
      };

      reader.readAsDataURL(blob);
    };

    xhr.onerror = function () {
      console.error('[ReturnPilot CS] getBinaryData: network error — likely CORS block');
      reply(port, msg, false, null, {
        error: 'Network error — cross-origin URLs must use bg-fetch-binary'
      });
    };

    xhr.ontimeout = function () {
      reply(port, msg, false, null, {
        error: `XHR timed out after ${xhr.timeout / 1000}s`
      });
    };

    xhr.send();
  });
}

// ═════════════════════════════════════════════════════════════
//  FETCH PORTAL IP DIRECTLY FROM SOURCE URL
// ═════════════════════════════════════════════════════════════
function handleFetchPortalIP(msg, port) {
  fetch('https://return.gst.gov.in/returns/auth/gstr1', {
    method: 'GET',
    credentials: 'include',
    headers: { 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' }
  })
  .then(function (resp) {
    return resp.text();
  })
  .then(function (htmlText) {
    // Exact pattern matching: $().setConstant('USER_IP',"45.124.146.34");
    const match = htmlText.match(/['"]USER_IP['"]\s*,\s*['"]([^'"]+)['"]/);
    if (match && match[1]) {
      const extractedIP = match[1].trim();
      try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set({ loggedInUserIP: extractedIP });
        }
      } catch (_) {}
      safePostMessage(port, { Id: msg.Id, status: true, ip: extractedIP });
    } else {
      console.warn('[ReturnPilot CS] IP pattern context missing in server HTML payload');
      safePostMessage(port, { Id: msg.Id, status: false, error: 'Pattern mismatch' });
    }
  })
  .catch(function (err) {
    console.error('[ReturnPilot CS] Live portal IP background check failed:', err.message);
    safePostMessage(port, { Id: msg.Id, status: false, error: err.message });
  });
}

// ═════════════════════════════════════════════════════════════
//  HELPER: Send Real-Time Logs back to Popup UI
// ═════════════════════════════════════════════════════════════
function logToPopup(port, message, type = 'info') {
  console.log(`[ReturnPilot CS Log] ${message}`);
  try {
    if (port && typeof port.postMessage === 'function') {
      port.postMessage({ request: 'log', message, type });
    }
  } catch (e) {
    console.warn('[ReturnPilot CS] Failed to send log to popup:', e.message);
  }
}

// ═════════════════════════════════════════════════════════════
//  GENERIC PORTAL DOWNLOAD ROUTER — one code path for the per-return
//  PDF/Excel handlers below. The popup may close mid-flight, so every
//  log/reply call is guarded (disconnected-port errors are swallowed).
// ═════════════════════════════════════════════════════════════
function routePortalDownloadToBackground(msg, port, requestPayload, opts) {
  const o = opts || {};
  function safeLog(message, type) { try { logToPopup(port, message, type); } catch (_) {} }
  function safeReply(ok, text, extra) { try { reply(port, msg, ok, text, extra); } catch (_) {} }

  const label  = o.label || requestPayload.returnType || requestPayload.request;
  const target = requestPayload.period || requestPayload.finYr || '';
  safeLog(`Routing ${label} request for ${target}...`, 'info');

  try {
    chrome.runtime.sendMessage(requestPayload, function (res) {
      if (chrome.runtime.lastError) {
        safeLog(`${label} background trigger failed: ${chrome.runtime.lastError.message}`, 'error');
        safeReply(false, null, { error: chrome.runtime.lastError.message });
      } else if (res && !res.success) {
        safeLog(`${label} execution failed: ${res.error}`, 'error');
        safeReply(false, null, { error: res.error });
      } else {
        safeLog(`${label} portal download triggered for ${target}!`, 'success');
        if (o.replyOnSuccess !== false) safeReply(true, o.successText);
      }
    });
  } catch (err) {
    try {
      logToPopup(port, `${label} trigger failed: ${err.message}`, 'error');
      reply(port, msg, false, null, { error: err.message });
    } catch (_) {}
  }
}

async function handleDownloadPdfViaAngular(msg, port) {
  try {
    const returnType = msg.returnType;
    const periodValue = msg.period;

    logToPopup(port, `Routing AngularJS download request to background service worker for ${returnType}...`, 'info');

    chrome.runtime.sendMessage({
      request: 'download-pdf-via-angular',
      returnType: returnType,
      period: periodValue
    }, function(res) {
      if (chrome.runtime.lastError) {
        logToPopup(port, `Background trigger failed: ${chrome.runtime.lastError.message}`, 'error');
        reply(port, msg, false, null, { error: chrome.runtime.lastError.message });
      } else if (res && !res.success) {
        logToPopup(port, `AngularJS execution failed: ${res.error}`, 'error');
        reply(port, msg, false, null, { error: res.error });
      } else {
        logToPopup(port, `AngularJS download triggered successfully for ${periodValue}!`, 'success');
        reply(port, msg, true, 'Triggered AngularJS PDF download.');
      }
    });

  } catch (err) {
    logToPopup(port, `AngularJS trigger failed to route: ${err.message}`, 'error');
    reply(port, msg, false, null, { error: err.message });
  }
}

// ═════════════════════════════════════════════════════════════
//  GSTR-1 ANGULAR PDF TRIGGER — routes to background.js
//  which uses world: 'MAIN' to drive $location to gstr1sum
//  and clicks the DOWNLOAD (PDF) button. No tab navigation.
// ═════════════════════════════════════════════════════════════
function handleDownloadPdfViaAngularGstr1(msg, port) {
  routePortalDownloadToBackground(msg, port, {
    request: 'download-pdf-via-angular-gstr1',
    returnType: 'GSTR-1',
    period: msg.period
  }, { replyOnSuccess: false, label: 'GSTR-1 PDF' });
}

function handleDownloadPdfViaAngularGstr1a(msg, port) {
  const pdfType = msg.pdfType || 'STANDALONE';
  routePortalDownloadToBackground(msg, port, {
    request: 'download-pdf-via-angular-gstr1a',
    returnType: 'GSTR-1A',
    pdfType: pdfType,
    period: msg.period
  }, { label: 'GSTR-1A PDF (' + pdfType + ')', successText: 'Triggered GSTR-1A portal PDF download.' });
}

function handleDownloadPdfViaAngularGstr2b(msg, port) {
  routePortalDownloadToBackground(msg, port, {
    request: 'download-pdf-via-angular-gstr2b',
    returnType: 'GSTR-2B',
    period: msg.period
  }, { label: 'GSTR-2B PDF', successText: 'Triggered GSTR-2B portal PDF download.' });
}

function handleDownloadPdfViaAngularGstr9(msg, port) {
  routePortalDownloadToBackground(msg, port, {
    request: 'download-pdf-via-angular-gstr9',
    returnType: 'GSTR-9',
    finYr: msg.finYr || msg.period
  }, { label: 'GSTR-9 PDF', successText: 'Triggered GSTR-9 portal PDF download.' });
}

function handleDownloadExcelViaAngularGstr2b(msg, port) {
  routePortalDownloadToBackground(msg, port, {
    request: 'download-excel-via-angular-gstr2b',
    returnType: 'GSTR-2B',
    period: msg.period
  }, { label: 'GSTR-2B Excel', successText: 'Triggered GSTR-2B portal Excel download.' });
}

if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener(function(msg, _sender, sendResponse) {
    if (msg && (msg.action === 'navigate-to-return-dashboard' || msg.request === 'navigate-to-return-dashboard')) {
      var nativeBtn = Array.from(document.querySelectorAll('a, button, li')).find(function(el) {
        var txt = (el.textContent || '').toLowerCase();
        var href = (el.getAttribute('href') || '').toLowerCase();
        return href.includes('returns/auth/dashboard') || txt.includes('return dashboard') || txt.includes('returns dashboard');
      });

      if (nativeBtn) {
        nativeBtn.click();
        sendResponse({ status: true, mode: 'native-click' });
      } else {
        window.location.href = 'https://return.gst.gov.in/returns/auth/dashboard';
        sendResponse({ status: true, mode: 'location-href' });
      }
      return true;
    }
    if (msg && (msg.action === 'get-page-taxpayer-info' || msg.request === 'get-page-taxpayer-info')) {
      if (typeof PORT_HANDLERS !== 'undefined' && PORT_HANDLERS['get-page-taxpayer-info']) {
        PORT_HANDLERS['get-page-taxpayer-info'](msg, {
          postMessage: function(payload) {
            sendResponse(payload);
          }
        });
        return true;
      }
    }
  });
}

})();


