// ═══════════════════════════════════════════════════════════════
//  ReturnPilot v4.3 — GSTR-3B Active-Tab Angular Scope PDF Engine
//  Sequential Tab Queue, Direct In-Memory Stream Capture,
//  Strict Period Verification & Complete Conflict Elimination
//  © 2026 KasyHQ. All Rights Reserved.
// ═══════════════════════════════════════════════════════════════

import { buildFolderDownloadPath } from './engine.js';

function disyearOf(p) {
  if (!p || p.length < 6) return '';
  const m = parseInt(p.slice(0, 2), 10);
  const y = parseInt(p.slice(2), 10);
  return m >= 4 ? `${y}-${String(y + 1).slice(2)}` : `${y - 1}-${String(y).slice(2)}`;
}

// Global queue per tab to ensure strictly sequential downloads without period collision
const gstr3bTabQueues = new Map();

function enqueueGstr3bTab(tabId, fn) {
  const prev = gstr3bTabQueues.get(tabId) || Promise.resolve();
  const next = prev.then(fn, fn);
  gstr3bTabQueues.set(tabId, next);
  next.finally(() => {
    if (gstr3bTabQueues.get(tabId) === next) {
      gstr3bTabQueues.delete(tabId);
    }
  });
  return next;
}

export function handleGstr3bScopePdf(msg, sender, sendResponse, deps) {
  const period = msg.period || msg.rtnprd;
  if (!period) {
    sendResponse({ success: false, error: 'GSTR-3B PDF: missing period. Please select a filing period first.' });
    return true;
  }
  let targetTabId = (sender && sender.tab && sender.tab.id) || msg.tabId || null;

  (async () => {
    try {
      if (!targetTabId) {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs && tabs[0]) targetTabId = tabs[0].id;
      }
      if (!targetTabId) {
        return sendResponse({ success: false, error: 'No active GST portal tab found. Please open the portal (dashboard) first.' });
      }

      const effectiveGstinPre = (msg.gstin || '').toUpperCase();
      const fyPre = disyearOf(period);
      const canonicalBase = `GSTR3B_${effectiveGstinPre || 'GSTIN'}_${period}.pdf`;
      const expectedPath = buildFolderDownloadPath(effectiveGstinPre, 'GSTR3B', period, canonicalBase, fyPre);

      const executePdfCapture = async () => {
        const results = await chrome.scripting.executeScript({
          target: { tabId: targetTabId },
          world: 'MAIN',
          args: [period, msg.gstin || '', fyPre],
          func: (periodArg, gstinArg, fyArg) => {
            return new Promise((resolve) => {
              let settled = false;
              const cleanupFns = [];

              // Storage snapshot & restore to prevent stale state pollution
              const STORAGE_KEYS = [
                'rtn_prd', 'ret_period', 'retprd', 'returnPeriod', 'return_period',
                'tax_period', 'taxperiod', 'fp', 'fin_year', 'disyear', 'fy', 'gstin'
              ];
              const snap = {};
              STORAGE_KEYS.forEach((k) => {
                try { snap['ls_' + k] = localStorage.getItem(k); } catch (_) {}
                try { snap['ss_' + k] = sessionStorage.getItem(k); } catch (_) {}
              });

              const restoreSnapshot = () => {
                STORAGE_KEYS.forEach((k) => {
                  try {
                    const lsv = snap['ls_' + k];
                    if (lsv === undefined || lsv === null) localStorage.removeItem(k);
                    else localStorage.setItem(k, lsv);
                  } catch (_) {}
                  try {
                    const ssv = snap['ss_' + k];
                    if (ssv === undefined || ssv === null) sessionStorage.removeItem(k);
                    else sessionStorage.setItem(k, ssv);
                  } catch (_) {}
                });
              };

              const finish = (isSuccess, errMsg = null, base64Data = null, dispatchedFilename = null, detectedPeriod = null) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeoutId);
                cleanupFns.forEach((fn) => {
                  try { fn(); } catch (_) {}
                });

                // ONLY restore storage snapshot after the PDF byte stream is safely in memory
                restoreSnapshot();

                if (!isSuccess || !base64Data) {
                  return resolve({
                    ok: false,
                    error: errMsg || 'GSTR-3B PDF capture failed (no data returned from portal compiler)',
                    period: periodArg
                  });
                }

                // Strict Period Verification
                let periodMatch = true;
                if (detectedPeriod && detectedPeriod !== periodArg) {
                  periodMatch = false;
                  console.warn(`[ReturnPilot GSTR3B] ⚠ Strict Period Mismatch: Requested ${periodArg} but portal generated ${detectedPeriod}`);
                  return resolve({
                    ok: false,
                    error: `Period mismatch: GST portal generated GSTR-3B for period ${detectedPeriod} instead of requested period ${periodArg}. Please ensure the dashboard return status is updated.`,
                    period: periodArg,
                    dispatchedPeriod: detectedPeriod
                  });
                }

                if (dispatchedFilename) {
                  const m = dispatchedFilename.match(/(0[1-9]|1[0-2])(20\d{2})/);
                  if (m && m[0] !== periodArg) {
                    periodMatch = false;
                    console.warn(`[ReturnPilot GSTR3B] ⚠ Filename period mismatch: Target is ${periodArg} but portal dispatched ${m[0]} (${dispatchedFilename})`);
                    return resolve({
                      ok: false,
                      error: `Period mismatch: Portal dispatched filename (${dispatchedFilename}) for period ${m[0]} instead of requested period ${periodArg}`,
                      period: periodArg,
                      dispatchedPeriod: m[0]
                    });
                  }
                }

                console.log(`[ReturnPilot GSTR3B] ✓ Official GSTR-3B PDF stream captured in memory for period ${periodArg} (size: ${Math.round(base64Data.length * 0.75)} bytes)`);
                resolve({
                  ok: true,
                  base64: base64Data,
                  period: periodArg,
                  gstin: resolvedGstin,
                  filename: dispatchedFilename,
                  periodMatch: true
                });
              };

              // ── Non-Intrusive Direct In-Memory Stream Capture Hooks ──
              // 1. Observe pdfMake
              const observePdfMake = (pm) => {
                if (!pm || pm.__rp_observed_3b) return;
                pm.__rp_observed_3b = true;
                const origCreate = pm.createPdf;
                if (typeof origCreate === 'function') {
                  pm.createPdf = function (...args) {
                    const docDef = args[0] || {};
                    let detectedPeriod = null;
                    try {
                      const ddStr = JSON.stringify(docDef);
                      const m = ddStr.match(/\b(0[1-9]|1[0-2])(20\d{2})\b/);
                      if (m) detectedPeriod = m[0];
                    } catch (_) {}

                    const pdfObj = origCreate.apply(this, args);
                    if (pdfObj) {
                      // Intercept download method to capture base64 directly
                      // DO NOT call origDl(fn) to completely PREVENT duplicate DOM anchor clicks and dual file downloads
                      if (typeof pdfObj.download === 'function') {
                        pdfObj.download = function (fn) {
                          console.log(`[ReturnPilot GSTR3B] Official portal pdfMake.download() intercepted for in-memory stream: ${fn || 'GSTR3B.pdf'}`);
                          if (typeof pdfObj.getBase64 === 'function') {
                            pdfObj.getBase64((b64) => {
                              if (!b64 || b64.length < 500) {
                                finish(false, 'pdfMake returned empty or truncated PDF stream');
                              } else {
                                finish(true, null, b64, fn || 'GSTR3B.pdf', detectedPeriod);
                              }
                            });
                          } else if (typeof pdfObj.getBuffer === 'function') {
                            pdfObj.getBuffer((buf) => {
                              let b64 = '';
                              try {
                                const bytes = new Uint8Array(buf);
                                let binary = '';
                                for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
                                b64 = btoa(binary);
                              } catch (_) {}
                              if (!b64 || b64.length < 500) {
                                finish(false, 'pdfMake buffer conversion failed');
                              } else {
                                finish(true, null, b64, fn || 'GSTR3B.pdf', detectedPeriod);
                              }
                            });
                          }
                          return pdfObj;
                        };
                      }
                    }
                    return pdfObj;
                  };
                  cleanupFns.push(() => {
                    pm.createPdf = origCreate;
                    pm.__rp_observed_3b = false;
                  });
                }
              };

              if (window.pdfMake) observePdfMake(window.pdfMake);
              try {
                let _pm = window.pdfMake;
                Object.defineProperty(window, 'pdfMake', {
                  configurable: true,
                  enumerable: true,
                  get: () => _pm,
                  set: (v) => { _pm = v; observePdfMake(v); }
                });
              } catch (_) {}

              // 2. Observe window.saveAs (fallback interceptor)
              if (typeof window.saveAs === 'function' && !window.saveAs.__rp_observed_3b) {
                const origSaveAs = window.saveAs;
                window.saveAs = function (blob, fn) {
                  console.log(`[ReturnPilot GSTR3B] Official portal saveAs() intercepted for in-memory stream: ${fn || 'GSTR3B.pdf'}`);
                  if (blob instanceof (window.Blob || Blob)) {
                    const reader = new FileReader();
                    reader.onloadend = () => {
                      const b64 = (reader.result || '').split(',')[1];
                      finish(true, null, b64, fn || 'GSTR3B.pdf', null);
                    };
                    reader.readAsDataURL(blob);
                    return; // Prevent native browser file dialog/conflict
                  }
                  return origSaveAs.apply(this, arguments);
                };
                window.saveAs.__rp_observed_3b = true;
                cleanupFns.push(() => {
                  window.saveAs = origSaveAs;
                  window.saveAs.__rp_observed_3b = false;
                });
              }

              // 3. Observe Anchor clicks (fallback interceptor)
              if (window.HTMLAnchorElement && !window.HTMLAnchorElement.prototype.__rp_observed_3b) {
                const origAnchorClick = window.HTMLAnchorElement.prototype.click;
                window.HTMLAnchorElement.prototype.click = function () {
                  const fn = this.download || this.getAttribute('download') || 'GSTR3B.pdf';
                  if (this.href && this.href.startsWith('blob:')) {
                    console.log(`[ReturnPilot GSTR3B] Official portal anchor blob click intercepted: ${fn}`);
                    fetch(this.href)
                      .then((r) => r.blob())
                      .then((blob) => {
                        const reader = new FileReader();
                        reader.onloadend = () => {
                          const b64 = (reader.result || '').split(',')[1];
                          finish(true, null, b64, fn, null);
                        };
                        reader.readAsDataURL(blob);
                      })
                      .catch(() => {
                        origAnchorClick.apply(this);
                      });
                    return; // Suppress duplicate DOM click to avoid dual downloads
                  }
                  return origAnchorClick.apply(this, arguments);
                };
                window.HTMLAnchorElement.prototype.__rp_observed_3b = true;
                cleanupFns.push(() => {
                  window.HTMLAnchorElement.prototype.click = origAnchorClick;
                  window.HTMLAnchorElement.prototype.__rp_observed_3b = false;
                });
              }

              // ── Angular Scope Resolution (BFS) ──
              let injector = null;
              try {
                injector = angular.element(document.body).injector() || angular.element(document).injector();
              } catch (err) {
                console.debug('[ReturnPilot GSTR3B] Injector probe failed:', err.message);
              }
              if (!injector) {
                return finish(false, 'AngularJS injector not found — please ensure you are on the returns dashboard.');
              }

              const rootScope = injector.get('$rootScope');

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

              const scope = findScopeBFS(rootScope);
              if (!scope) {
                return finish(false, 'downloadGSTR3Bpdf() not found in any AngularJS scope. Please open the returns dashboard.');
              }

              const resolvedGstin = gstinArg || window._rpGstr3bGstin || localStorage.getItem('gstin') || '';
              window._rpGstr3bGstin = resolvedGstin;

              // Write target period and FY to dual storage
              STORAGE_KEYS.forEach((k) => {
                if (k === 'gstin' && resolvedGstin) {
                  try { localStorage.setItem(k, resolvedGstin); sessionStorage.setItem(k, resolvedGstin); } catch (_) {}
                } else if (k === 'fin_year' || k === 'disyear' || k === 'fy') {
                  try { localStorage.setItem(k, fyArg); sessionStorage.setItem(k, fyArg); } catch (_) {}
                } else if (k !== 'gstin') {
                  try { localStorage.setItem(k, periodArg); sessionStorage.setItem(k, periodArg); } catch (_) {}
                }
              });

              // Hydrate shareData and clear stale caches from previous periods
              try {
                const shareData = injector.get('shareData');
                if (shareData) {
                  shareData.rtn_prd = periodArg;
                  shareData.retprd = periodArg;
                  shareData.fp = periodArg;
                  shareData.tax_period = periodArg;
                  shareData.fin_year = fyArg;
                  shareData.disyear = fyArg;
                  if (resolvedGstin) shareData.gstin = resolvedGstin;

                  // Portal safety attribute required by scope.downloadGSTR3Bpdf()
                  if (!shareData.gstr3bSummary || typeof shareData.gstr3bSummary !== 'object') {
                    shareData.gstr3bSummary = {};
                  }
                  shareData.gstr3bSummary.gstin = resolvedGstin;
                  shareData.gstr3bSummary.rtn_prd = periodArg;

                  delete shareData.gstr3bData;
                  delete shareData.r3bData;
                  delete shareData.gstr3b;
                  delete shareData.taxpayble;
                }
              } catch (_) {
                if (scope.shareData) {
                  scope.shareData.rtn_prd = periodArg;
                  scope.shareData.retprd = periodArg;
                  scope.shareData.fp = periodArg;
                  scope.shareData.tax_period = periodArg;
                  scope.shareData.fin_year = fyArg;
                  scope.shareData.disyear = fyArg;
                  if (resolvedGstin) scope.shareData.gstin = resolvedGstin;
                  if (!scope.shareData.gstr3bSummary || typeof scope.shareData.gstr3bSummary !== 'object') {
                    scope.shareData.gstr3bSummary = {};
                  }
                  scope.shareData.gstr3bSummary.gstin = resolvedGstin;
                  scope.shareData.gstr3bSummary.rtn_prd = periodArg;
                  delete scope.shareData.gstr3bData;
                  delete scope.shareData.r3bData;
                }
              }

              // Hydrate target scope and clear stale return tables
              if ('rtn_prd' in scope) scope.rtn_prd = periodArg;
              if ('ret_prd' in scope) scope.ret_prd = periodArg;
              if ('ret_period' in scope) scope.ret_period = periodArg;
              if ('retprd' in scope) scope.retprd = periodArg;
              if ('tax_period' in scope) scope.tax_period = periodArg;
              if ('fp' in scope) scope.fp = periodArg;
              if ('period' in scope) scope.period = periodArg;
              if ('fin_year' in scope) scope.fin_year = fyArg;
              if ('disyear' in scope) scope.disyear = fyArg;
              scope.fy = fyArg;
              if (resolvedGstin && 'gstin' in scope) scope.gstin = resolvedGstin;

              delete scope.gstr3bData;
              delete scope.r3bData;
              delete scope.gstr3b;
              delete scope.taxpayble;

              try { scope.$evalAsync(); } catch (_) {}

              // Propagate to parent scopes
              let cur = scope.$parent;
              while (cur) {
                if ('rtn_prd' in cur) cur.rtn_prd = periodArg;
                if ('ret_period' in cur) cur.ret_period = periodArg;
                if ('fin_year' in cur) cur.fin_year = fyArg;
                delete cur.gstr3bData;
                delete cur.r3bData;
                cur = cur.$parent;
              }

              console.log(`[ReturnPilot GSTR3B] Invoking official portal scope.downloadGSTR3Bpdf() for period: ${periodArg} (GSTIN: ${resolvedGstin}, FY: ${fyArg})`);

              // Safety timeout: 35 seconds to await official portal generation and API resolution
              const timeoutId = setTimeout(() => {
                console.warn(`[ReturnPilot GSTR3B] Generation wait reached 35s timeout for period ${periodArg}`);
                finish(false, `GSTR-3B PDF generation timed out after 35s on GST portal for period ${periodArg}`);
              }, 35000);

              const trigger = () => {
                try {
                  scope.downloadGSTR3Bpdf(periodArg);
                } catch (e) {
                  try {
                    scope.downloadGSTR3Bpdf();
                  } catch (e2) {
                    console.error('[ReturnPilot GSTR3B] Error calling downloadGSTR3Bpdf():', e2);
                    finish(false, e2.message);
                  }
                }
              };

              if (!scope.$$phase && !scope.$root.$$phase) {
                scope.$apply(trigger);
              } else {
                trigger();
              }
            });
          }
        });

        const r = results && results[0] && results[0].result;
        if (!r) throw new Error('Portal script returned no result');
        return r;
      };

      // Wrap whole capture and disk write inside the sequential tab queue
      const result = await enqueueGstr3bTab(targetTabId, async () => {
        const captureResult = await executePdfCapture();
        if (!captureResult || !captureResult.ok) {
          return captureResult;
        }

        const effectiveGstin = captureResult.gstin || msg.gstin || 'GSTIN';
        const fy = disyearOf(captureResult.period || period);
        // Prioritize official native portal filename directly from portal compiler (e.g. GSTR3B_27ABTPM1945L2ZY_042026.pdf)
        const baseFilename = (captureResult.filename && captureResult.filename !== 'GSTR3B.pdf')
          ? captureResult.filename
          : `GSTR3B_${effectiveGstin}_${captureResult.period || period}.pdf`;
        const filename = buildFolderDownloadPath(effectiveGstin, 'GSTR3B', captureResult.period || period, baseFilename, fy);

        // Dispatch official download via chrome.downloads.download using the clean in-memory base64 stream
        const isFirefoxEnv = (typeof navigator !== 'undefined' && /firefox/i.test(navigator.userAgent)) ||
                             (typeof browser !== 'undefined' && typeof browser.runtime?.getBrowserInfo === 'function');

        let downloadUrl = `data:application/pdf;base64,${captureResult.base64}`;
        let cleanupBlobUrl = null;

        if (isFirefoxEnv && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
          try {
            const pureB64 = (captureResult.base64 || '').includes(',') ? captureResult.base64.split(',')[1] : captureResult.base64;
            const binStr = atob(pureB64.replace(/\s/g, ''));
            const bytes = new Uint8Array(binStr.length);
            for (let i = 0; i < binStr.length; i++) {
              bytes[i] = binStr.charCodeAt(i);
            }
            const blob = new Blob([bytes], { type: 'application/pdf' });
            downloadUrl = URL.createObjectURL(blob);
            cleanupBlobUrl = downloadUrl;
          } catch (blobErr) {
            console.warn('[ReturnPilot GSTR3B] Blob URL creation fallback:', blobErr);
          }
        }

        const dlPromise = new Promise((resolveDl, rejectDl) => {
          chrome.downloads.download({
            url: downloadUrl,
            filename: filename,
            saveAs: false
          }, (downloadId) => {
            if (cleanupBlobUrl) {
              setTimeout(() => {
                try { URL.revokeObjectURL(cleanupBlobUrl); } catch (_) {}
              }, 60000);
            }
            if (chrome.runtime.lastError || !downloadId) {
              const err = chrome.runtime.lastError?.message || 'Download dispatch failed';
              console.error(`[ReturnPilot GSTR3B] chrome.downloads.download failed:`, err);
              return rejectDl(new Error(err));
            }

            console.log(`[ReturnPilot GSTR3B] Single official PDF download dispatched (#ID: ${downloadId}) -> ${filename}`);
            if (typeof rpLog !== 'undefined' && rpLog) {
              rpLog.info('GSTR3B_ENGINE', `Single official PDF download dispatched (#ID: ${downloadId}) -> ${filename}`);
            }

            if (deps && deps.DownloadRegistry) {
              const regObj = {
                filename: filename,
                period: captureResult.period || period,
                gstin: effectiveGstin,
                timestamp: Date.now()
              };
              deps.DownloadRegistry.set(downloadId, regObj);
              deps.DownloadRegistry.set('ACTIVE_GSTR3B', regObj);
              deps.DownloadRegistry.set('GSTR_3B.pdf', regObj);
              deps.DownloadRegistry.set('GSTR3B.pdf', regObj);
            }

            // Strictly await download completion on disk before releasing sequential tab queue
            let resolved = false;
            const completionTimer = setTimeout(() => {
              if (!resolved) {
                resolved = true;
                chrome.downloads.onChanged.removeListener(onChangedHandler);
                console.log(`[ReturnPilot GSTR3B] Download completion wait reached 20s safety threshold (#ID: ${downloadId})`);
                resolveDl({ downloadId, filename });
              }
            }, 20000);

            const onChangedHandler = (delta) => {
              if (delta.id === downloadId) {
                if (delta.state && delta.state.current === 'complete') {
                  if (!resolved) {
                    resolved = true;
                    clearTimeout(completionTimer);
                    chrome.downloads.onChanged.removeListener(onChangedHandler);
                    console.log(`[ReturnPilot GSTR3B] ✓ File successfully written to disk (#ID: ${downloadId}) -> ${filename}`);
                    if (typeof rpLog !== 'undefined' && rpLog) {
                      rpLog.info('GSTR3B_ENGINE', `✓ File successfully written to disk (#ID: ${downloadId}) -> ${filename}`);
                    }
                    resolveDl({ downloadId, filename });
                  }
                } else if (delta.error) {
                  if (!resolved) {
                    resolved = true;
                    clearTimeout(completionTimer);
                    chrome.downloads.onChanged.removeListener(onChangedHandler);
                    console.warn(`[ReturnPilot GSTR3B] Download reported delta error: ${delta.error.current}`);
                    if (typeof rpLog !== 'undefined' && rpLog) {
                      rpLog.error('GSTR3B_ENGINE', `Download reported error (#ID: ${downloadId}): ${delta.error.current}`);
                    }
                    resolveDl({ downloadId, filename });
                  }
                }
              }
            };

            chrome.downloads.onChanged.addListener(onChangedHandler);
          });
        });

        const dlResult = await dlPromise;

        return {
          ok: true,
          period: captureResult.period || period,
          gstin: effectiveGstin,
          filename: dlResult.filename || filename,
          downloadId: dlResult.downloadId,
          officialDownload: true,
          periodMatch: true
        };
      });

      if (!result || !result.ok) {
        console.error('[ReturnPilot GSTR3B] PDF Capture Failed:', result?.error);
        if (typeof rpLog !== 'undefined' && rpLog) {
          rpLog.error('GSTR3B_ENGINE', `❌ GSTR-3B PDF Capture Failed: ${result?.error}`);
        }
        return sendResponse({ success: false, error: result?.error || 'GSTR-3B PDF capture failed' });
      }

      console.log(`[ReturnPilot GSTR3B] Official GSTR-3B download finalized for period ${result.period} (GSTIN: ${result.gstin}) -> ${result.filename}`);

      sendResponse({
        success: true,
        period: result.period,
        gstin: result.gstin,
        filename: result.filename,
        downloadId: result.downloadId,
        periodMatch: true,
        officialDownload: true
      });
    } catch (err) {
      console.error('[ReturnPilot GSTR3B] Execution Error:', err.message);
      sendResponse({ success: false, error: err.message });
    }
  })();

  return true;
}
