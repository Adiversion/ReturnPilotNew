// ═══════════════════════════════════════════════════════════════
//  ReturnPilot — GSTR-9 MAIN WORLD NATIVE ENGINE
//  Hidden-Iframe Native PDF & Excel Generation for Form GSTR-9
// ═══════════════════════════════════════════════════════════════

'use strict';

(function () {
  if (window.__gstr9_inject_initialized) return;
  window.__gstr9_inject_initialized = true;

  const DLog = (m, ...args) => {
    console.log(`%c[GSTR9-Inject @ ${new Date().toLocaleTimeString()}] ${m}`, 'color:#0ea5e9;font-weight:bold;', ...args);
  };
  DLog('Loaded on URL:', location.href);

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  let sessionIframe = null;
  let dispatched = false;
  let dispatchedFilename = null;
  const dispatchResolvers = [];

  const resetDispatch = () => {
    dispatched = false;
    dispatchedFilename = null;
    dispatchResolvers.length = 0;
  };

  const notifyDispatched = (fn) => {
    if (!dispatched) {
      dispatched = true;
      dispatchedFilename = fn || null;
      dispatchResolvers.splice(0).forEach(r => r(fn));
    }
  };

  const waitDispatched = (ms = 30000) => {
    return new Promise((resolve) => {
      if (dispatched) return resolve(dispatchedFilename);
      const timer = setTimeout(() => resolve(dispatchedFilename), ms);
      dispatchResolvers.push((fn) => {
        clearTimeout(timer);
        resolve(fn);
      });
    });
  };

  // ── LocalStorage Backup & Restore ──
  const BACKUP_KEYS = [
    'rtn_prd', 'ret_period', 'retPeriod', 'returnPeriod', 'tax_period',
    'taxperiod', 'fin_year', 'disyear', 'gstin', 'formname', 'rtn_typ',
    'stat', 'lglname', 'fp', 'annual_rtn', 'gstrtyp', 'fil_status'
  ];
  const lsBackup = {};

  const backupLS = () => {
    BACKUP_KEYS.forEach(k => {
      if (!(k in lsBackup)) lsBackup[k] = localStorage.getItem(k);
    });
  };

  const restoreLS = () => {
    Object.entries(lsBackup).forEach(([k, v]) => {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    });
    Object.keys(lsBackup).forEach(k => delete lsBackup[k]);
  };

  const setLS = (fp, fy, gstin) => {
    ['rtn_prd', 'ret_period', 'retPeriod', 'returnPeriod', 'tax_period', 'taxperiod', 'fp']
      .forEach(k => localStorage.setItem(k, fp));
    if (fy) {
      localStorage.setItem('fin_year', fy);
      localStorage.setItem('disyear', fy);
      localStorage.setItem('annual_rtn', fy);
    }
    if (gstin) localStorage.setItem('gstin', gstin);
    localStorage.setItem('formname', 'GSTR9');
    localStorage.setItem('gstrtyp', 'GSTR9');
    localStorage.setItem('rtn_typ', 'GSTR9');
    localStorage.setItem('fil_status', 'FIL');
    localStorage.setItem('stat', 'RTF');
  };

  // ── Iframe Management & Reuse ──
  const isIframeHealthy = (f) => {
    try {
      if (!f || !f.contentWindow || !f.parentNode) return false;
      const href = f.contentWindow.location.href;
      return href.startsWith('https://return.gst.gov.in/');
    } catch (_) { return false; }
  };

  const createIframe = async () => {
    const f = document.createElement('iframe');
    f.id = 'rp_gstr9_warm_iframe';
    // Exact SPA Hash Route proven on GST Portal
    f.src = 'https://return.gst.gov.in/returns2/auth/annualreturn#/auth/gstr9/offlinedownload';
    f.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1280px;height:900px;border:0;visibility:hidden;opacity:0;pointer-events:none;z-index:-1;';
    f.setAttribute('aria-hidden', 'true');
    document.body.appendChild(f);

    await new Promise((resolve, reject) => {
      f.onload = resolve;
      f.onerror = reject;
      setTimeout(() => reject(new Error('GSTR-9 iframe load timeout')), 35000);
    });

    if (!isIframeHealthy(f)) {
      f.remove();
      throw new Error('GSTR-9 iframe crashed on load');
    }

    const start = Date.now();
    while (Date.now() - start < 30000) {
      try {
        if (f.contentWindow?.angular) {
          const rootElem = f.contentDocument?.querySelector('[ng-app]') || f.contentDocument?.querySelector('.ng-scope') || f.contentDocument?.body;
          if (rootElem && f.contentWindow.angular.element(rootElem).injector()) {
            break;
          }
        }
      } catch (_) {}
      await sleep(20);
    }

    hookPdfMake(f);
    return f;
  };

  const getOrCreateIframe = async () => {
    if (sessionIframe && isIframeHealthy(sessionIframe)) {
      return sessionIframe;
    }
    if (sessionIframe) {
      try { sessionIframe.remove(); } catch (_) {}
    }
    sessionIframe = await createIframe();
    return sessionIframe;
  };

  // ── Hook pdfMake inside Iframe ──
  const hookPdfMake = (f) => {
    const iw = f.contentWindow;
    if (!iw) return;

    function applyHook(targetPdfMake) {
      if (!targetPdfMake || targetPdfMake.__rp_hooked) return;
      targetPdfMake.__rp_hooked = true;

      const origCreate = targetPdfMake.createPdf;
      targetPdfMake.createPdf = function (dd) {
        DLog('🎯 pdfMake.createPdf() intercepted in iframe');
        const pdfObj = origCreate.apply(this, [dd]);
        const origDl = pdfObj.download ? pdfObj.download.bind(pdfObj) : null;
        pdfObj.download = function (fn) {
          DLog('Official portal pdfMake.download() initiated in GSTR-9:', fn);
          notifyDispatched(fn);
          if (origDl) return origDl(fn); // Entity 1: Official portal download!
        };
        return pdfObj;
      };
    }

    if (iw.pdfMake) {
      applyHook(iw.pdfMake);
    }

    try {
      let _pm = iw.pdfMake;
      Object.defineProperty(iw, 'pdfMake', {
        configurable: true,
        enumerable: true,
        get: () => _pm,
        set: (val) => {
          _pm = val;
          applyHook(val);
        }
      });
    } catch (_) {}

    if (typeof iw.saveAs === 'function' && !iw.saveAs.__rp_observed) {
      const origSaveAs = iw.saveAs;
      iw.saveAs = function (blob, fn) {
        DLog('Official portal saveAs() initiated in GSTR-9:', fn);
        notifyDispatched(fn);
        return origSaveAs.apply(this, arguments);
      };
      iw.saveAs.__rp_observed = true;
    }

    if (iw.HTMLAnchorElement && !iw.HTMLAnchorElement.prototype.__rp_observed) {
      const origAnchorClick = iw.HTMLAnchorElement.prototype.click;
      iw.HTMLAnchorElement.prototype.click = function () {
        const fn = this.download || this.getAttribute('download');
        if (fn || (this.href && this.href.startsWith('blob:'))) {
          DLog('Official portal anchor click in GSTR-9:', fn || this.href);
          notifyDispatched(fn);
        }
        return origAnchorClick.apply(this, arguments);
      };
      iw.HTMLAnchorElement.prototype.__rp_observed = true;
    }
  };

  function deepSeedScope(sc, fy, fp, gstin) {
    if (!sc) return;
    sc.fy = fy;
    sc.fp = fp;
    sc.rtn_prd = fp;
    sc.gstin = gstin;
    sc.gstrtyp = 'GSTR9';
    sc.fil_status = 'FIL';
    sc.status = 'FIL';
    sc.userSelected = { fy: fy, fp: fp, rtn_prd: fp, gstin: gstin };
    sc.gstr9Data = { fy: fy, fp: fp, rtn_prd: fp, gstin: gstin, status: 'FIL' };
    sc.mainData = { fy: fy, fp: fp, rtn_prd: fp, gstin: gstin };
  }

  // ── Core GSTR-9 PDF Download Runner ──
  async function downloadOne(period, targetMeta = {}) {
    const t0 = Date.now();
    DLog(`Starting GSTR-9 PDF generation for period: ${period}`);

    let fp = period;
    let fy = targetMeta.finYr || '';
    if (/^\d{6}$/.test(period)) {
      fp = period;
      const endYr = parseInt(period.substring(2, 6), 10);
      if (!fy) fy = `${endYr - 1}-${String(endYr % 100).padStart(2, '0')}`;
    } else if (/^\d{4}-\d{2,4}$/.test(period)) {
      fy = period;
      const endYr = parseInt(period.substring(0, 4), 10) + 1;
      fp = `03${endYr}`;
    } else {
      fp = '032018';
      if (!fy) fy = '2017-18';
    }

    const gstin = targetMeta.gstin || localStorage.getItem('gstin') || '';

    // 1. Pre-seed APIs in Parallel
    const primePromise = Promise.allSettled([
      fetch(`/returns2/auth/api/annualrolestatus?return_prd=${encodeURIComponent(fp)}`, { credentials: 'same-origin' }),
      fetch(`/returns/auth/api/offline/upload/summary?rtn_prd=${encodeURIComponent(fp)}&rtn_typ=GSTR9`, { credentials: 'same-origin' }),
      fetch(`/returns2/auth/api/offline/upload/summary?rtn_prd=${encodeURIComponent(fp)}&rtn_typ=GSTR9`, { credentials: 'same-origin' })
    ]);

    backupLS();
    setLS(fp, fy, gstin);

    pdfCaptured = false;
    capturedBlob = null;
    capturedFilename = null;

    let f;
    try {
      f = await getOrCreateIframe();
    } catch (e) {
      restoreLS();
      return { success: false, error: 'Iframe creation failed: ' + e.message };
    }

    try {
      const iw = f.contentWindow;
      const idoc = f.contentDocument;

      hookPdfMake(f);
      await primePromise;

      // Connect to Angular injector & seed state
      let injector = null;
      const startWait = Date.now();
      while (Date.now() - startWait < 15000) {
        try {
          if (iw.angular) {
            const rootElem = idoc.querySelector('[ng-app]') || idoc.querySelector('.ng-scope') || idoc.body;
            if (rootElem && iw.angular.element(rootElem).injector()) {
              injector = iw.angular.element(rootElem).injector();
              break;
            }
          }
        } catch (_) {}
        await sleep(100);
      }

      if (injector) {
        try {
          const $rootScope = injector.get('$rootScope');
          const $location = injector.get('$location');
          const shareData = injector.has('shareData') ? injector.get('shareData') : null;

          if (shareData) {
            Object.assign(shareData, {
              fp: fp,
              rtn_prd: fp,
              retprd: fp,
              fy: fy,
              disyear: fy,
              fin_year: fy,
              annual_rtn: fy,
              gstin: gstin,
              formname: 'GSTR9',
              gstrtyp: 'GSTR9',
              rtn_typ: 'GSTR9',
              fil_status: 'FIL',
              status: 'FIL'
            });
          }

          if ($location && $location.path() !== '/auth/gstr9/offlinedownload') {
            $rootScope.$apply(() => {
              $location.path('/auth/gstr9/offlinedownload');
            });
          }
        } catch (seedErr) {
          DLog('State seeding note:', seedErr.message);
        }
      }

      // Wait for pending HTTP requests to resolve
      if (injector && injector.has('$http')) {
        try {
          const $http = injector.get('$http');
          const netStart = Date.now();
          while (Date.now() - netStart < 8000) {
            if (!$http.pendingRequests || $http.pendingRequests.length === 0) break;
            await sleep(150);
          }
        } catch (_) {}
      }
      await sleep(1000);

      const docType = (targetMeta && targetMeta.docType) || 'GSTR9';
      // Locate PDF Button and trigger
      const pdfBtn = [...idoc.querySelectorAll('button, a, [role="button"]')].find((b) => {
        const txt = (b.innerText || b.textContent || '').trim().toUpperCase();
        if (docType === 'GSTR1_SUMMARY') {
          return txt.includes('GSTR-1 SUMMARY') || txt.includes('GSTR1 SUMMARY') || b.getAttribute('data-ng-click')?.includes('downloadGSTR1') || b.getAttribute('ng-click')?.includes('downloadGSTR1');
        }
        if (docType === 'GSTR3B_SUMMARY') {
          return txt.includes('GSTR-3B SUMMARY') || txt.includes('GSTR3B SUMMARY') || b.getAttribute('data-ng-click')?.includes('downloadGSTR3B') || b.getAttribute('ng-click')?.includes('downloadGSTR3B');
        }
        return txt.includes('DOWNLOAD GSTR-9 DETAILS (PDF)') || 
               b.getAttribute('data-ng-click')?.includes('getPdfData_gstr9') || 
               b.getAttribute('ng-click')?.includes('getPdfData_gstr9');
      });

      resetDispatch();

      if (pdfBtn && iw.angular) {
        const sc = iw.angular.element(pdfBtn).scope();
        deepSeedScope(sc, fy, fp, gstin);
        try {
          if (docType === 'GSTR9' && sc && typeof sc.getPdfData_gstr9 === 'function') {
            sc.$apply(() => {
              sc.getPdfData_gstr9('offline');
            });
            DLog('✓ Fired via sc.getPdfData_gstr9("offline")');
          } else {
            pdfBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: iw }));
          }
        } catch (_) {
          pdfBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: iw }));
        }
      } else {
        // Fallback: direct scope scan
        let fired = false;
        if (iw.angular) {
          const scopes = [...idoc.querySelectorAll('.ng-scope')].map(el => iw.angular.element(el).scope()).filter(Boolean);
          for (const sc of scopes) {
            if (docType === 'GSTR9' && typeof sc.getPdfData_gstr9 === 'function') {
              deepSeedScope(sc, fy, fp, gstin);
              sc.$apply(() => sc.getPdfData_gstr9('offline'));
              DLog('✓ Fired directly on controller scope getPdfData_gstr9');
              fired = true;
              break;
            }
          }
        }
        if (!fired && pdfBtn) {
          pdfBtn.click();
        }
      }

      const capturedFn = await waitDispatched(30000);
      await sleep(50);

      const cleanFy = (fy || 'FY').replace(/[^0-9-]/g, '');
      const prefix = docType === 'GSTR1_SUMMARY' ? 'GSTR1_SUMMARY' : (docType === 'GSTR3B_SUMMARY' ? 'GSTR3B_SUMMARY' : 'GSTR9');
      let finalFilename = capturedFn || `${cleanFy}_${gstin}_${prefix}.pdf`;
      if (!finalFilename.toLowerCase().endsWith('.pdf')) {
        finalFilename += '.pdf';
      }

      DLog(`✓ Official GSTR-9 PDF download dispatched for ${period}: ${finalFilename} in ${Date.now() - t0}ms`);

      return {
        success: true,
        filename: finalFilename,
        period,
        timeMs: Date.now() - t0,
        officialDownload: true
      };
    } catch (e) {
      DLog(`Execution error for ${period}:`, e.message);
      return { success: false, error: e.message, period };
    } finally {
      restoreLS();
    }
  }

  // ── Communication Bridge ──
  window.addEventListener('message', async (event) => {
    if (event.source !== window || !event.data) return;
    const d = event.data;

    if (d.__gstr9 === 'INJECT_START' || d.action === 'CAPTURE_GSTR9_PDF') {
      const reqId = d.requestId || `g9_${Date.now()}`;
      const period = d.period;
      const res = await downloadOne(period, d.meta || {});

      window.postMessage({
        __gstr9: 'INJECT_RESULT',
        requestId: reqId,
        source: 'RP_GSTR9_RESPONSE',
        ...res
      }, '*');
    }
  });

  window.postMessage({ __gstr9: 'INJECT_READY' }, '*');
  DLog('GSTR-9 Inject engine ready');
})();
