// ═══════════════════════════════════════════════════════════════
//  ReturnPilot v4.0 — GST Login Authenticate Response Interceptor
//  © 2026 KasyHQ. All Rights Reserved.
// ═══════════════════════════════════════════════════════════════
//  Runs in PAGE context (injected by login-contentscript.js).
//  Watches the portal's own XHR/fetch call to
//  https://services.gst.gov.in/services/authenticate and, when the
//  response carries errorCode "SWEB_9000" (Invalid CAPTCHA), posts a
//  message so the content script can retry the auto-login exactly once.

'use strict';

(function () {
  if (window.__rpLoginInjectLoaded) return;
  window.__rpLoginInjectLoaded = true;

  const AUTH_MARKER = '/services/authenticate';

  function notifySweb9000() {
    window.postMessage({
      source: 'RETURNPILOT_LOGIN_INJECT',
      type: 'AUTH_SWEB_9000',
      timestamp: Date.now()
    }, window.location.origin || '*');
  }

  // ── Bad-credentials notifier (wrong password / account locked) ─────────────
  function notifyBadCredentials(errorCode, errorMessage) {
    window.postMessage({
      source: 'RETURNPILOT_LOGIN_INJECT',
      type: 'AUTH_BAD_CREDENTIALS',
      errorCode: errorCode || '',
      errorMessage: errorMessage || '',
      timestamp: Date.now()
    }, window.location.origin || '*');
  }

  function checkResponseText(text) {
    try {
      const data = JSON.parse(text);

      // Wrong CAPTCHA — handled separately (auto-retry once)
      if (data && data.errorCode === 'SWEB_9000') {
        notifySweb9000();
        return;
      }

      // Wrong password / invalid credentials / account locked
      // SWEB_9009 = "Invalid username or password"
      // SWEB_9001, SWEB_9003 = account locked / suspended variants seen in the wild
      const BAD_CRED_CODES = ['SWEB_9009', 'SWEB_9001', 'SWEB_9003'];
      const isBadCredCode = data && data.errorCode && BAD_CRED_CODES.includes(data.errorCode);
      const isBadCredMsg  = data && data.message &&
        /invalid (username|password|credentials)|account (lock|block|suspend|disabled)/i.test(data.message);

      if (isBadCredCode || isBadCredMsg) {
        notifyBadCredentials(data.errorCode, data.message);
      }
    } catch (_) {}
  }

  // ── AngularJS Captcha Model Sync ──────────────────────────────
  window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== 'RETURNPILOT_LOGIN_CONTENT') return;

    if (data.type === 'TRIGGER_USERNAME_INIT' || data.type === 'SET_CREDENTIALS_ANGULAR') {
      const uInput = document.getElementById('username') || document.querySelector('input[name="user_name"]') || document.querySelector('input[name="username"]');
      const pInput = document.getElementById('user_pass') || document.querySelector('input[name="user_pass"]') || document.querySelector('input[type="password"]');
      
      const existingUsername = uInput ? uInput.value : '';
      const existingPassword = pInput ? pInput.value : '';
      
      const username = data.username ? String(data.username).trim() : (existingUsername ? String(existingUsername).trim() : '');
      const password = data.password ? String(data.password) : (existingPassword ? String(existingPassword) : '');

      if (uInput) {
        if (data.username) uInput.value = data.username;
        if (window.angular && window.angular.element) {
          try {
            const $uEl = window.angular.element(uInput);
            const scope = $uEl.scope();
            if (scope) {
              if (scope.lform) {
                if (username) scope.lform.username = username;
                if (password && scope.lform.password !== undefined) scope.lform.password = password;
              }
              if (typeof scope.validName === 'function') {
                try { scope.validName(); } catch (_) {}
              }
              const uModel = $uEl.controller('ngModel');
              if (uModel) {
                if (username) uModel.$setViewValue(username);
                uModel.$render();
                uModel.$setPristine();
                uModel.$setValidity('required', true);
                uModel.$setValidity('pattern', true);
              }
              if (pInput && password) {
                pInput.value = password;
                const $pEl = window.angular.element(pInput);
                const pModel = $pEl.controller('ngModel');
                if (pModel) {
                  pModel.$setViewValue(password);
                  pModel.$render();
                  pModel.$setPristine();
                }
              }
              if (!scope.$$phase && !scope.$root.$$phase) {
                scope.$apply();
              }
            }
          } catch (e) {
            console.warn('[ReturnPilot Inject] Angular username sync notice:', e.message);
          }
        }
        uInput.dispatchEvent(new Event('focus', { bubbles: true }));
        uInput.dispatchEvent(new Event('input', { bubbles: true }));
        uInput.dispatchEvent(new Event('change', { bubbles: true }));
        uInput.dispatchEvent(new Event('blur', { bubbles: true }));
      }
    }

    if (data.type === 'SET_CAPTCHA_ANGULAR') {
      const code = String(data.captchaCode || '').trim();
      const input = document.getElementById('captcha') || document.querySelector('input[name="captcha"]');
      if (input) {
        input.value = code;
        if (window.angular && window.angular.element) {
          try {
            const $el = window.angular.element(input);
            const scope = $el.scope();
            if (scope) {
              if (scope.lform) {
                scope.lform.captcha = code;
                scope.lform.user_captcha = code;
              }
              scope.captcha = code;
              scope.user_captcha = code;
              if (typeof scope.setPristine === 'function') {
                scope.setPristine('loginform', 'captcha', 'invalid_captcha');
              }
              const ngModel = $el.controller('ngModel');
              if (ngModel) {
                ngModel.$setViewValue(code);
                ngModel.$render();
                ngModel.$setPristine();
                ngModel.$setValidity('required', true);
                ngModel.$setValidity('pattern', true);
                if (typeof ngModel.$commitViewValue === 'function') {
                  ngModel.$commitViewValue();
                }
              }
              if (!scope.$$phase && !scope.$root.$$phase) {
                scope.$apply();
              }
            }
          } catch (e) {
            console.warn('[ReturnPilot Inject] Angular captcha sync notice:', e.message);
          }
        }
        input.dispatchEvent(new Event('focus', { bubbles: true }));
        input.dispatchEvent(new Event('keydown',  { bubbles: true, key: code.slice(-1) }));
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new Event('keyup', { bubbles: true, key: code.slice(-1) }));
        input.dispatchEvent(new Event('blur', { bubbles: true }));
      }
    }
  });

  function extractAndPostCredentials(body) {
    if (!body) return;
    try {
      let u = '', p = '';
      if (typeof body === 'string') {
        try {
          const parsed = JSON.parse(body);
          u = parsed.username || parsed.user_name || parsed.user || (parsed.lform && (parsed.lform.username || parsed.lform.user_name)) || '';
          p = parsed.password || parsed.user_pass || parsed.pass || (parsed.lform && (parsed.lform.password || parsed.lform.user_pass)) || '';
        } catch (_) {
          const params = new URLSearchParams(body);
          u = params.get('username') || params.get('user_name') || params.get('user') || '';
          p = params.get('password') || params.get('user_pass') || params.get('pass') || '';
        }
      } else if (body instanceof FormData) {
        u = body.get('username') || body.get('user_name') || body.get('user') || '';
        p = body.get('password') || body.get('user_pass') || body.get('pass') || '';
      }
      if (u && p) {
        window.postMessage({
          source: 'RETURNPILOT_LOGIN_INJECT',
          type: 'LOGIN_SUBMITTED_CREDENTIALS',
          username: String(u).trim(),
          password: String(p)
        }, window.location.origin || '*');
      }
    } catch (_) {}
  }

  // ── Hook XMLHttpRequest (AngularJS $http) ─────────────────────
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this.__rpAuthUrl = url;
    return origOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function (body) {
    const xhr = this;
    const url = xhr.__rpAuthUrl;
    if (typeof url === 'string' && url.indexOf(AUTH_MARKER) !== -1) {
      console.group('%c[ReturnPilot Auth Debug] POST /services/authenticate Initiated', 'background: #0284c7; color: white; font-weight: bold; padding: 2px 6px;');
      console.log('Request URL:', url);
      console.log('Document Cookies at Send Time:', document.cookie);
      console.groupEnd();

      extractAndPostCredentials(body);
      if (!xhr.__rpHooked) {
        xhr.__rpHooked = true;

        // Intercept ready state to patch responseText for AngularJS before $http resolves
        xhr.addEventListener('readystatechange', function () {
          if (xhr.readyState === 4 && xhr.status === 200) {
            try {
              const origText = xhr.responseText;
              if (origText && origText.includes('"url":null') && origText.includes('"message":"auth"')) {
                const patchedText = origText.replace('"url":null', '"url":"fowelcome"');
                Object.defineProperty(xhr, 'responseText', {
                  get: () => patchedText,
                  configurable: true
                });
                Object.defineProperty(xhr, 'response', {
                  get: () => patchedText,
                  configurable: true
                });
                console.log('%c[ReturnPilot Auth Fix] Patched responseText: "url":null ➔ "url":"fowelcome"', 'background: #10b981; color: #fff; font-weight: bold; padding: 2px 6px;');
              }
            } catch (_) {}
          }
        });

        xhr.addEventListener('load', function () {
          console.group('%c[ReturnPilot Auth Debug] /services/authenticate Response Arrived', 'background: #1e293b; color: #38bdf8; font-weight: bold; padding: 2px 6px;');
          console.log('HTTP Status:', xhr.status, xhr.statusText);
          console.log('Final Response URL:', xhr.responseURL);
          console.log('Response Headers:', xhr.getAllResponseHeaders());
          console.log('Raw Response Text:', xhr.responseText);
          let parsed = null;
          try {
            parsed = JSON.parse(xhr.responseText);
            console.log('Parsed JSON Response Body:', parsed);
          } catch (_) {}
          console.groupEnd();

          // ── Fix: Prevent Bare /services/auth/ Redirect ────────────────────
          if (parsed && !parsed.errorCode && parsed.message === 'auth') {
            const targetRoute = (parsed.url && parsed.url !== 'null') ? parsed.url : 'fowelcome';
            const fullTarget = targetRoute.startsWith('http') ? targetRoute : 
                              (targetRoute.startsWith('/') ? 'https://services.gst.gov.in' + targetRoute : 'https://services.gst.gov.in/services/auth/' + targetRoute);
            console.log('%c[ReturnPilot Auth Success] Directing to authenticated landing page:', 'color: #10b981; font-weight: bold;', fullTarget);
            setTimeout(() => {
              if (window.location.href.includes('/services/login')) {
                window.location.replace(fullTarget);
              }
            }, 60);
          }

          try {
            checkResponseText(xhr.responseText);
          } catch (_) {}
        });

        xhr.addEventListener('error', function (err) {
          console.error('%c[ReturnPilot Auth Debug] /services/authenticate Network Error:', 'background: #dc2626; color: white;', err);
        });
      }
    }
    return origSend.apply(this, arguments);
  };

  // ── Hook fetch (future-proofing) ──────────────────────────────
  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (url.indexOf(AUTH_MARKER) !== -1) {
        const body = init?.body || (input && input.body);
        extractAndPostCredentials(body);
      }
      return origFetch.apply(this, arguments).then(function (resp) {
        if (url.indexOf(AUTH_MARKER) !== -1) {
          resp.clone().text().then(checkResponseText).catch(function () {});
        }
        return resp;
      });
    };
  }
})();
