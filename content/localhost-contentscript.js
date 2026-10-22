// ═══════════════════════════════════════════════════════════════
//  ReturnPilot v3.2 — Localhost Bridge Content Script
//  © 2026 KasyHQ. All Rights Reserved.
// ═══════════════════════════════════════════════════════════════

(function () {
  'use strict';

  if (window.__returnPilotBridgeLoaded) {
    console.log('[ReturnPilot Bridge] Already loaded on localhost');
    return;
  }
  window.__returnPilotBridgeLoaded = true;

  console.log('[ReturnPilot Bridge] Localhost bridge content script loaded on', location.origin);

  let keepAlivePort = null;
  let keepAliveInterval = null;

  function startKeepAlive() {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.connect) {
      try {
        if (!keepAlivePort) {
          keepAlivePort = chrome.runtime.connect({ name: 'ReturnPilotKeepAlive' });
          keepAlivePort.onDisconnect.addListener(() => {
            keepAlivePort = null;
            if (keepAliveInterval) {
              clearInterval(keepAliveInterval);
              keepAliveInterval = null;
            }
            window.__returnPilotBridgeLoaded = false;
            window.postMessage({
              source: 'returnpilot-extension',
              type: 'EXTENSION_DISCONNECTED'
            }, location.origin);
          });

          // Periodically send a ping message to keep the service worker active
          keepAliveInterval = setInterval(() => {
            if (keepAlivePort) {
              try {
                keepAlivePort.postMessage({ type: 'ping' });
              } catch (e) {
                stopKeepAlive();
              }
            }
          }, 10000);
        }
      } catch (e) {
        console.warn('[ReturnPilot Bridge] Failed to connect keepalive port:', e.message);
      }
    }
  }

  function stopKeepAlive() {
    if (keepAlivePort) {
      try {
        keepAlivePort.disconnect();
      } catch (e) {}
      keepAlivePort = null;
    }
    if (keepAliveInterval) {
      clearInterval(keepAliveInterval);
      keepAliveInterval = null;
    }
  }

  // Restrict allowed bridge requests to non-sensitive operations only.
  // Sensitive credential operations (get/save credentials, get-auth-token, submit-login)
  // are strictly isolated to the extension popup context to prevent web-origin exfiltration.
  const ALLOWED_REQUESTS = new Set([
    'ping',
    'sync-user-email',
    'get-extension-info',
    'bg-fetch',
    'bg-fetch-binary',
    'download-file',
    'download-url',
    'fetch-gst-captcha',
    'solve-captcha',
    'prefetch-captcha',
    'PREFETCH_CAPTCHA',
    'submit-gst-login',
    'save-credentials',
    'get-credentials',
    'get-auth-token',
    'clear-gst-cookies',
    'user-switch-flush',
    'propagate-session-silently',
    'report-login-page-state',
    'report-login-success',
    'report-welcome-page-reached',
    'fetch-return-json',
    'fetch-gstr2b-json',
    'fetch-gstr3b-json',
    'fetch-gstr1-json',
    'sync-subscription',
    'activate-subscription',
    'oauth-token-captured'
  ]);

  // ── GOOGLE OAUTH INTERCEPTION BRIDGE FOR RETURNPILOT (CHROME & FIREFOX) ──
  let oauthProcessed = false;

  function tryExtractAndForwardOAuthToken() {
    if (oauthProcessed) return;

    let accessToken = null;
    let authError = null;

    // 1. Check URL fragment / search parameters
    try {
      if (window.location.hash) {
        const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, '?'));
        accessToken = hashParams.get('access_token');
        authError = hashParams.get('error');
      }
      if (!accessToken && window.location.search) {
        const searchParams = new URLSearchParams(window.location.search);
        accessToken = searchParams.get('access_token');
        authError = authError || searchParams.get('error');
      }
    } catch (_) {}

    // 2. Check window.localStorage (stashed by kasyhq.com oauth-popup.ts)
    if (!accessToken && !authError) {
      try {
        if (typeof window.localStorage !== 'undefined') {
          const raw = window.localStorage.getItem('kasyhq_oauth_pending');
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && (parsed.accessToken || parsed.error)) {
              if (!parsed.ts || (Date.now() - parsed.ts < 300000)) {
                accessToken = parsed.accessToken;
                authError = parsed.error;
              }
            }
          }
        }
      } catch (_) {}
    }

    // 3. Firefox wrappedJSObject fallback for isolated localStorage contexts
    if (!accessToken && !authError && typeof window.wrappedJSObject !== 'undefined') {
      try {
        const wLocalStorage = window.wrappedJSObject.localStorage;
        if (wLocalStorage) {
          const raw = wLocalStorage.getItem('kasyhq_oauth_pending');
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && (parsed.accessToken || parsed.error)) {
              if (!parsed.ts || (Date.now() - parsed.ts < 300000)) {
                accessToken = parsed.accessToken;
                authError = parsed.error;
              }
            }
          }
        }
      } catch (_) {}
    }

    if (accessToken || authError) {
      oauthProcessed = true;
      console.log('[ReturnPilot Bridge] Captured OAuth result from page context. Forwarding to extension background...');

      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({
          request: 'oauth-token-captured',
          token: accessToken || null,
          error: authError || null,
          rawUrl: window.location.href
        }).catch((err) => {
          console.warn('[ReturnPilot Bridge] Failed to send oauth-token-captured to background:', err.message);
        });
      }

      // If this is the OAuth completion screen, update UI and attempt clean window close
      const updateUiAndClose = () => {
        try {
          const heading = document.querySelector('h2');
          if (heading && heading.textContent.includes('Sign-in Complete')) {
            const p = heading.nextElementSibling;
            if (p) p.textContent = 'ReturnPilot connected successfully! Closing window...';
          }
          setTimeout(() => {
            try { window.close(); } catch (_) {}
          }, 400);
        } catch (_) {}
      };

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', updateUiAndClose, { once: true });
      } else {
        updateUiAndClose();
      }
    }
  }

  // Probe immediately at script load
  tryExtractAndForwardOAuthToken();

  // Listen for direct postMessage from kasyhq.com SPA
  window.addEventListener('message', (event) => {
    if (event.origin !== location.origin) return;
    const msg = event.data;
    if (msg && (msg.source === 'kasyhq-oauth' || msg.type === 'kasyhq-oauth')) {
      if (msg.accessToken || msg.error) {
        oauthProcessed = true;
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({
            request: 'oauth-token-captured',
            token: msg.accessToken || null,
            error: msg.error || null,
            rawUrl: window.location.href
          }).catch(() => {});
        }
        try {
          setTimeout(() => { try { window.close(); } catch (_) {} }, 400);
        } catch (_) {}
      }
    }
  });

  // Re-check across DOM lifecycle and short intervals
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryExtractAndForwardOAuthToken);
  }
  setTimeout(tryExtractAndForwardOAuthToken, 100);
  setTimeout(tryExtractAndForwardOAuthToken, 300);
  setTimeout(tryExtractAndForwardOAuthToken, 800);
  setTimeout(tryExtractAndForwardOAuthToken, 1500);

  // Main message event handler
  function handleWindowMessage(event) {
    // Require the event origin to match the current localhost origin
    if (event.origin !== location.origin) return;
    if (event.source !== window) return;

    const msg = event.data;
    if (msg && msg.source === 'audit-tool-web') {
      // msg.Id may arrive with varying case
      const requestId = msg.id ?? msg.Id ?? msg.requestId ?? null;

      // Validate the incoming message shape
      if (!msg.request || !ALLOWED_REQUESTS.has(msg.request)) {
        console.warn('[ReturnPilot Bridge] Unknown or unauthorized request:', msg.request);
        return;
      }

      // Ping response echoes requestId and validates the origin
      if (msg.request === 'ping') {
        window.postMessage({
          source: 'returnpilot-extension',
          type: 'EXTENSION_READY',
          requestId: requestId
        }, location.origin);
        return;
      }

      console.log('[ReturnPilot Bridge] Forwarding request to extension background:', msg.request);

      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
        console.warn('[ReturnPilot Bridge] Extension runtime unavailable. Page reload required.');
        window.postMessage({
          source: 'returnpilot-extension',
          requestId: requestId,
          success: false,
          error: 'Extension runtime unavailable. Please refresh the page.'
        }, location.origin);
        return;
      }

      // Sanitize payload to forward
      const sanitizedMsg = {
        request: msg.request,
        Id: requestId,
        id: requestId
      };

      if (msg.url) sanitizedMsg.url = msg.url;
      if (msg.method) sanitizedMsg.method = msg.method;
      if (msg.headers) sanitizedMsg.headers = msg.headers;
      if (msg.body) sanitizedMsg.body = msg.body;
      if (msg.username) sanitizedMsg.username = msg.username;
      if (msg.password) sanitizedMsg.password = msg.password;
      if (msg.fileName) sanitizedMsg.fileName = msg.fileName;
      if (msg.mimeType) sanitizedMsg.mimeType = msg.mimeType;
      if (msg.base64) sanitizedMsg.base64 = msg.base64;
      if (msg.captcha) sanitizedMsg.captcha = msg.captcha;
      if (msg.companyId) sanitizedMsg.companyId = msg.companyId;
      if (msg.captchaBase64) sanitizedMsg.captchaBase64 = msg.captchaBase64;
      if (msg.at) sanitizedMsg.at = msg.at;
      if (msg.email) sanitizedMsg.email = msg.email;
      if (msg.responseType) sanitizedMsg.responseType = msg.responseType;

      // Use the modern MV3 Promise API
      (async () => {
        try {
          console.log(`[ReturnPilot Bridge → Background] Forwarding request #${requestId} (${msg.request}):`, sanitizedMsg);
          // Keep-alive is started on boot and runs continuously. No need to start/stop here.
          const response = await chrome.runtime.sendMessage(sanitizedMsg);
          console.log(`[ReturnPilot Bridge ← Background] Received response for request #${requestId} (${msg.request}):`, response);
          // Handle an undefined response
          window.postMessage({
            source: 'returnpilot-extension',
            requestId: requestId,
            success: true,
            response: response ?? null
          }, location.origin);
        } catch (err) {
          console.error(`[ReturnPilot Bridge ✖] Request #${requestId} (${msg.request}) failed:`, err.message);
          
          // Check if context is invalidated
          const isInvalidated = err.message && (
            err.message.includes('context invalidated') ||
            err.message.includes('Extension context invalidated') ||
            err.message.includes('invoked member')
          );

          if (isInvalidated) {
            window.__returnPilotBridgeLoaded = false;
            stopKeepAlive();
            window.postMessage({
              source: 'returnpilot-extension',
              type: 'EXTENSION_DISCONNECTED'
            }, location.origin);
          }

          window.postMessage({
            source: 'returnpilot-extension',
            requestId: requestId,
            success: false,
            error: err.message
          }, location.origin);
        }
      })();
    }
  }

  // Register listener
  window.addEventListener('message', handleWindowMessage);

  // Expose a cleanup/destroy mechanism
  window.__returnPilotBridgeDestroy = function () {
    window.removeEventListener('message', handleWindowMessage);
    window.__returnPilotBridgeLoaded = false;
    stopKeepAlive();
    delete window.__returnPilotBridgeDestroy;
    console.log('[ReturnPilot Bridge] Destroyed and unregistered.');
  };

  // Notify the page immediately via the target origin (no arbitrary timeout)
  window.postMessage({
    source: 'returnpilot-extension',
    type: 'EXTENSION_READY'
  }, location.origin);

  // Establish persistent keep-alive connection to keep SW active and detect reload
  startKeepAlive();
})();
