/**
 * ReturnPilot Test Lab — Background Service Worker
 * Orchestrates Manifest V3 Offscreen Documents & Native Portal Downloads
 */

'use strict';

console.log('[Test Lab SW] Service Worker initialized (v1.0.0).');

async function ensureOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT']
  });

  if (existingContexts.length === 0) {
    console.log('[Test Lab SW] Creating isolated offscreen sandbox document...');
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['BLOBS', 'IFRAME_SCRIPTING'],
      justification: 'Run isolated native portal triggering benchmarks without active-tab DOM interference'
    });
  }
}

// Ensure cookies sync to gstr2b.gst.gov.in
async function propagateGstr2bCookies() {
  try {
    if (!chrome.cookies) return false;
    const targetUrl = 'https://gstr2b.gst.gov.in';
    const sources = [
      'https://services.gst.gov.in',
      'https://return.gst.gov.in',
      'https://gst.gov.in'
    ];
    for (const src of sources) {
      const cookies = await chrome.cookies.getAll({ url: src }).catch(() => []);
      for (const c of cookies) {
        if (c.name.startsWith('TS')) continue;
        await chrome.cookies.set({
          url: targetUrl,
          name: c.name,
          value: c.value,
          path: '/',
          secure: true,
          sameSite: 'no_restriction'
        }).catch(() => {});
      }
    }
    const domainCookies = await chrome.cookies.getAll({ domain: 'gst.gov.in' }).catch(() => []);
    for (const c of domainCookies) {
      if (c.name.startsWith('TS')) continue;
      await chrome.cookies.set({
        url: targetUrl,
        name: c.name,
        value: c.value,
        path: '/',
        secure: true,
        sameSite: 'no_restriction'
      }).catch(() => {});
    }
    return true;
  } catch (_) {
    return false;
  }
}

// Download file handler (supports base64, data URI, or blob URL)
function handleDownload(msg) {
  return new Promise((resolve, reject) => {
    let url = msg.url;
    if (!url && msg.base64) {
      const mime = msg.mimeType || 'application/octet-stream';
      url = `data:${mime};base64,${msg.base64}`;
    }
    if (!url) return reject(new Error('Missing download URL or base64 data'));

    const filename = msg.fileName || msg.filename || 'download.dat';
    chrome.downloads.download({
      url,
      filename,
      saveAs: false
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve({ success: true, downloadId });
      }
    });
  });
}

// Authenticated fetch with timeout utility
async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // 1. Offscreen benchmark relay
  if (msg.target === 'background') {
    (async () => {
      try {
        await ensureOffscreenDocument();
        const response = await chrome.runtime.sendMessage({
          ...msg,
          target: 'offscreen'
        });
        sendResponse(response);
      } catch (err) {
        console.error('[Test Lab SW] Benchmark error:', err);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  // 2. Direct download file
  if (msg.action === 'download-file') {
    handleDownload(msg)
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // 3. Authenticated portal fetch
  if (msg.action === 'portal-fetch') {
    (async () => {
      try {
        if (msg.url && msg.url.includes('gstr2b.gst.gov.in')) {
          await propagateGstr2bCookies();
        }
        const fetchOpts = {
          method: msg.method || 'GET',
          credentials: 'include',
          headers: {
            'Accept': 'application/json, text/plain, */*',
            ...(msg.headers || {})
          },
          ...(msg.options || {})
        };
        const res = await fetchWithTimeout(msg.url, fetchOpts);
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        const contentType = res.headers.get('content-type') || '';
        let data;
        if (contentType.includes('application/json')) {
          data = await res.json();
        } else {
          data = await res.text();
        }
        sendResponse({ success: true, data, status: res.status });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  // 4. Download GSTR-3B Official PDF via Active-Tab Angular Scope
  if (msg.action === 'download-3b-native-pdf') {
    (async () => {
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const targetTab = tabs.find(t => t.url && t.url.includes('gst.gov.in'));
        if (!targetTab) throw new Error('No active GST Portal tab found. Please open your GST Returns dashboard.');

        const results = await chrome.scripting.executeScript({
          target: { tabId: targetTab.id },
          world: 'MAIN',
          args: [msg.period, msg.gstin],
          func: (period, gstin) => {
            return new Promise((resolve) => {
              let isFinished = false;
              function finish(success, error, b64, filename) {
                if (isFinished) return;
                isFinished = true;
                resolve({ success, error, base64: b64, filename: filename || `GSTR3B_${gstin}_${period}.pdf` });
              }

              // 1. Observe pdfMake
              function observePdfMake(pm) {
                if (!pm || pm.__rpIntercepted) return;
                pm.__rpIntercepted = true;
                const origCreate = pm.createPdf;
                pm.createPdf = function(...args) {
                  const pdfObj = origCreate.apply(this, args);
                  if (pdfObj) {
                    if (typeof pdfObj.download === 'function') {
                      pdfObj.download = function(fn) {
                        if (typeof pdfObj.getBase64 === 'function') {
                          pdfObj.getBase64((b64) => finish(true, null, b64, fn || `GSTR3B_${gstin}_${period}.pdf`));
                        }
                        return pdfObj;
                      };
                    }
                    if (typeof pdfObj.getBase64 === 'function') {
                      pdfObj.getBase64((b64) => finish(true, null, b64, `GSTR3B_${gstin}_${period}.pdf`));
                    }
                  }
                  return pdfObj;
                };
              }

              if (window.pdfMake) observePdfMake(window.pdfMake);
              else {
                let _pm = window.pdfMake;
                Object.defineProperty(window, 'pdfMake', {
                  configurable: true,
                  enumerable: true,
                  get: () => _pm,
                  set: (v) => { _pm = v; observePdfMake(v); }
                });
              }

              // Intercept URL.createObjectURL as fallback
              const origCreateObjectURL = window.URL.createObjectURL;
              window.URL.createObjectURL = function(blob) {
                const url = origCreateObjectURL.apply(this, arguments);
                if (blob instanceof Blob && blob.type.includes('pdf')) {
                  const reader = new FileReader();
                  reader.onloadend = () => {
                    const b64 = reader.result.split(',')[1];
                    finish(true, null, b64, `GSTR3B_${gstin}_${period}.pdf`);
                  };
                  reader.readAsDataURL(blob);
                }
                return url;
              };

              // 2. BFS Scope Traversal
              let injector = null;
              try {
                injector = window.angular && (window.angular.element(document.body).injector() || window.angular.element(document).injector());
              } catch (_) {}

              function findScopeBFS(root) {
                const queue = [root];
                while (queue.length) {
                  const s = queue.shift();
                  if (!s) continue;
                  if (typeof s.downloadGSTR3Bpdf === 'function') return s;
                  if (s.$$childHead) queue.push(s.$$childHead);
                  if (s.$$nextSibling) queue.push(s.$$nextSibling);
                }
                return null;
              }

              let scope = null;
              if (injector) {
                try {
                  const rootScope = injector.get('$rootScope');
                  scope = findScopeBFS(rootScope);
                } catch (_) {}
              }

              if (!scope && window.angular) {
                const els = document.querySelectorAll('.ng-scope, [ng-app], [ng-controller]');
                for (const el of els) {
                  try {
                    const s = window.angular.element(el).scope();
                    if (s) {
                      const found = findScopeBFS(s);
                      if (found) { scope = found; break; }
                    }
                  } catch (_) {}
                }
              }

              if (!scope) {
                return finish(false, 'downloadGSTR3Bpdf() not found in active tab. Note: GSTR-3B PDF requires having the Returns Dashboard open (return.gst.gov.in/returns/auth/dashboard).');
              }

              // 3. Hydrate shareData
              try {
                const shareData = injector ? injector.get('shareData') : (scope.shareData || {});
                if (shareData) {
                  shareData.rtn_prd = period;
                  shareData.gstin = gstin;
                  if (!shareData.gstr3bSummary) shareData.gstr3bSummary = {};
                  shareData.gstr3bSummary.gstin = gstin;
                  shareData.gstr3bSummary.rtn_prd = period;
                }
              } catch (_) {}

              // 4. Trigger Official Method
              try {
                if (!scope.$$phase && !scope.$root.$$phase) {
                  scope.$apply(() => scope.downloadGSTR3Bpdf(period));
                } else {
                  scope.downloadGSTR3Bpdf(period);
                }
              } catch (e1) {
                try {
                  scope.downloadGSTR3Bpdf();
                } catch (e2) {
                  finish(false, 'Failed invoking downloadGSTR3Bpdf(): ' + e2.message);
                }
              }

              // Timeout failsafe (25s)
              setTimeout(() => {
                finish(false, 'GSTR-3B PDF compilation timed out after 25s.');
              }, 25000);
            });
          }
        });

        const r = results && results[0] && results[0].result;
        if (!r || !r.success) throw new Error(r?.error || 'Failed to capture GSTR-3B PDF');

        await handleDownload({
          fileName: r.filename,
          base64: r.base64,
          mimeType: 'application/pdf'
        });

        sendResponse({ success: true, filename: r.filename });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  // Compile docDef into PDF via active tab's window.pdfMake
  if (msg.action === 'compile-pdf-in-tab') {
    (async () => {
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const targetTab = tabs.find(t => t.url && t.url.includes('gst.gov.in'));
        if (!targetTab) throw new Error('No active GST Portal tab found.');

        const results = await chrome.scripting.executeScript({
          target: { tabId: targetTab.id },
          world: 'MAIN',
          args: [msg.docDef],
          func: (docDef) => {
            return new Promise((resolve) => {
              if (!window.pdfMake || typeof window.pdfMake.createPdf !== 'function') {
                return resolve({ success: false, error: 'pdfMake not initialized on active tab.' });
              }
              try {
                window.pdfMake.createPdf(docDef).getBase64((b64) => {
                  resolve({ success: true, base64: b64 });
                });
              } catch (e) {
                resolve({ success: false, error: e.message });
              }
            });
          }
        });

        const r = results && results[0] && results[0].result;
        if (!r || !r.success) throw new Error(r?.error || 'PDF compilation failed');
        sendResponse({ success: true, base64: r.base64 });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  // 5. Download GSTR-1 Official PDF via 2026 Direct Injection & Scope Hook
  if (msg.action === 'download-1-native-pdf') {
    (async () => {
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const targetTab = tabs.find(t => t.url && t.url.includes('gst.gov.in'));
        if (!targetTab) throw new Error('No active GST Portal tab found. Please open your GST Returns dashboard.');

        // Inject content/gstr1-inject.js if needed
        await chrome.scripting.executeScript({
          target: { tabId: targetTab.id },
          world: 'MAIN',
          files: ['content/gstr1-inject.js']
        }).catch(() => {});

        const requestId = `g1_${msg.period}_${Date.now()}`;
        const results = await chrome.scripting.executeScript({
          target: { tabId: targetTab.id },
          world: 'MAIN',
          args: [msg.period, msg.gstin, requestId],
          func: (period, gstin, requestId) => {
            return new Promise((resolve) => {
              let settled = false;
              const timeout = setTimeout(() => {
                if (!settled) {
                  settled = true;
                  window.removeEventListener('message', handler);
                  resolve({ success: false, error: 'GSTR-1 PDF generation timed out after 45s', period });
                }
              }, 45000);

              const handler = (e) => {
                if (!e.data || e.data.__gstr1 !== 'INJECT_RESULT' || e.data.requestId !== requestId) return;
                if (!settled) {
                  settled = true;
                  clearTimeout(timeout);
                  window.removeEventListener('message', handler);
                  resolve(e.data);
                }
              };

              window.addEventListener('message', handler);
              window.postMessage({
                __gstr1: 'INJECT_START',
                requestId,
                period,
                meta: { period, gstin }
              }, '*');
            });
          }
        });

        const r = results && results[0] && results[0].result;
        if (!r || !r.success) throw new Error(r?.error || 'GSTR-1 PDF generation failed');

        sendResponse({ success: true, filename: r.filename || `GSTR1_${msg.gstin}_${msg.period}.pdf` });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  // 6. Download GSTR-2B Official PDF / Excel via 2026 Ivy Component & DocDef Interception
  if (msg.action === 'download-2b-native-pdf' || msg.action === 'download-2b-native-excel') {
    (async () => {
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const targetTab = tabs.find(t => t.url && t.url.includes('gst.gov.in'));
        if (!targetTab) throw new Error('No active GST Portal tab found. Please open your GST Returns dashboard.');

        await propagateGstr2bCookies();
        await fetchWithTimeout('https://gstr2b.gst.gov.in/gstr2b/auth/dashboard', { credentials: 'include' }).catch(() => {});
        const captureType = msg.action.includes('excel') ? 'EXCEL' : 'PDF';
        const finyr = msg.finYear || '2025-26';

        const execResults = await chrome.scripting.executeScript({
          target: { tabId: targetTab.id },
          world: 'MAIN',
          args: [msg.period, msg.gstin, finyr, captureType, 45000],
          func: async (period, gstin, finyr, captureType, timeoutMs) => {
            return new Promise((resolve) => {
              let isResolved = false;
              let hasSentStart = false;

              let lgnm = '';
              let tradeName = '';
              let uPref = 'M';
              let effectiveGstin = gstin;
              try {
                lgnm = localStorage.getItem('lglname') || localStorage.getItem('lgnm') || '';
                tradeName = localStorage.getItem('trdnm') || localStorage.getItem('tradeName') || '';
                uPref = localStorage.getItem('uPref') || 'M';
                const udStr = localStorage.getItem('userdetails');
                if (udStr) {
                  const ud = JSON.parse(udStr);
                  lgnm = lgnm || ud.lgnm || ud.bname || ud.tradeName || '';
                  tradeName = tradeName || ud.trdnm || ud.tradeName || '';
                  if (!effectiveGstin) effectiveGstin = ud.gstin || '';
                }
              } catch (_) {}

              const meta = {
                rtn_prd: period,
                period,
                gstin: effectiveGstin || gstin,
                finyr,
                lgnm,
                tradeName,
                uPref
              };

              const metaPayload = encodeURIComponent(JSON.stringify(meta));
              const iframeName = `__gst2b_${period}__meta=${metaPayload}`;
              const requestId = `req_${Date.now()}_${captureType}`;

              const iframe = document.createElement('iframe');
              iframe.name = iframeName;
              iframe.src = 'https://gstr2b.gst.gov.in/gstr2b/auth/gstr2b/summary';
              iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1280px;height:900px;opacity:0;border:0;pointer-events:none;z-index:-1;visibility:hidden;';

              const onMsg = (event) => {
                const d = event.data;
                if (!d || typeof d !== 'object' || isResolved) return;

                if (d.__gst2b === 'INJECT_READY') {
                  if (hasSentStart) return;
                  hasSentStart = true;
                  try {
                    iframe.contentWindow.postMessage({
                      __gst2b: 'INJECT_START',
                      requestId,
                      period,
                      captureType,
                      meta
                    }, '*');
                  } catch (_) {}
                }

                if (d.__gst2b === 'INJECT_RESULT' && (d.requestId === requestId || !d.requestId)) {
                  isResolved = true;
                  window.removeEventListener('message', onMsg);
                  try { iframe.remove(); } catch (_) {}
                  resolve(d);
                }
              };

              window.addEventListener('message', onMsg);
              document.body.appendChild(iframe);

              setTimeout(() => {
                if (!isResolved) {
                  isResolved = true;
                  window.removeEventListener('message', onMsg);
                  try { iframe.remove(); } catch (_) {}
                  resolve({ success: false, error: `${captureType} capture timeout (${timeoutMs / 1000}s)` });
                }
              }, timeoutMs);
            });
          }
        });

        const r = execResults && execResults[0] && execResults[0].result;
        if (!r || !r.success) throw new Error(r?.error || `GSTR-2B ${captureType} generation failed`);

        if (r.base64) {
          await handleDownload({
            fileName: r.filename,
            base64: r.base64,
            mimeType: r.mimeType || (captureType === 'EXCEL' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf')
          });
        }

        sendResponse({ success: true, filename: r.filename, captureType });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }
});
