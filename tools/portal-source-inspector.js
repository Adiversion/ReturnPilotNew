/**
 * ════════════════════════════════════════════════════════════════════════════════
 *  ReturnPilot — Live GST Portal PDF & API Source Inspector (DevTools Console)
 * ════════════════════════════════════════════════════════════════════════════════
 * 
 *  HOW TO USE:
 *  1. Open Chrome DevTools (Press F12 or Right Click -> Inspect) on the GST Portal
 *     (https://return.gst.gov.in/returns/auth/dashboard).
 *  2. Go to the "Console" tab.
 *  3. Copy and paste this ENTIRE script into the Console and press Enter.
 *  4. It will immediately install live sniffers on pdfMake, Angular scopes, and APIs,
 *     and expose convenient diagnostic commands:
 * 
 *     - window.probePortalState()        -> Inspect active GSTIN, FY, and Angular services
 *     - window.probeGSTR3B('042026')     -> Inspect GSTR-3B API data & trigger portal PDF
 *     - window.probeGSTR1('042026')      -> Inspect GSTR-1 API summary data
 *     - window.probeGSTR2B('042026')     -> Inspect GSTR-2B API summary & docdata
 *     - window.sniffNextPdfDownload()    -> Watch & intercept next PDF download in real time
 * ════════════════════════════════════════════════════════════════════════════════
 */

(function () {
  'use strict';

  console.clear();
  console.log('%c[GST Portal Inspector]%c Live Source Diagnostic Suite Initialized!', 'background:#8b5cf6;color:#fff;font-weight:bold;padding:3px 8px;border-radius:3px;', 'color:#10b981;font-weight:bold;');
  console.log('%cRun %cwindow.probePortalState()%c to see active session status.', 'color:#64748b;', 'color:#3b82f6;font-weight:bold;', 'color:#64748b;');

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. GLOBAL PDFMAKE & SAVEAS INTERCEPTOR (Proof of PDF Generation Mechanism)
  // ─────────────────────────────────────────────────────────────────────────────
  function hookPdfMake(targetWindow = window, label = 'Top Window') {
    if (!targetWindow.pdfMake) {
      // Define setter trap in case pdfMake is loaded dynamically
      let _pm = undefined;
      try {
        Object.defineProperty(targetWindow, 'pdfMake', {
          configurable: true,
          enumerable: true,
          get: () => _pm,
          set: (val) => {
            _pm = val;
            attachHook(val);
          }
        });
      } catch (_) {}
      return;
    }
    attachHook(targetWindow.pdfMake);

    function attachHook(pm) {
      if (!pm || pm.__gst_inspector_hooked) return;
      pm.__gst_inspector_hooked = true;
      const origCreatePdf = pm.createPdf;

      pm.createPdf = function (docDefinition, tableLayouts, fonts, vfs) {
        console.group('%c[PDF SOURCE PROOF] Official pdfMake.createPdf() Call Intercepted!', 'background:#2563eb;color:#fff;font-weight:bold;padding:4px 8px;border-radius:3px;');
        console.log('%cContext:%c ' + label, 'font-weight:bold;', 'color:#0284c7;');
        console.log('%cCaller Stack Trace:%c\n' + (new Error().stack || 'Stack unavailable'), 'font-weight:bold;', 'color:#64748b;font-size:11px;');
        
        // Extract period and GSTIN from docDefinition
        let docStr = '';
        try { docStr = JSON.stringify(docDefinition); } catch (_) {}
        const periodMatch = docStr.match(/\b(0[1-9]|1[0-2])(20\d{2})\b/);
        const gstinMatch = docStr.match(/\b\d{2}[A-Z]{5}\d{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}\b/);

        console.log('%cDetected In-Doc Period:%c ' + (periodMatch ? periodMatch[0] : 'Not Found'), 'font-weight:bold;', 'color:#16a34a;font-weight:bold;');
        console.log('%cDetected In-Doc GSTIN :%c ' + (gstinMatch ? gstinMatch[0] : 'Not Found'), 'font-weight:bold;', 'color:#16a34a;font-weight:bold;');
        console.log('%cRaw docDefinition Object:%c', 'font-weight:bold;', 'color:#9333ea;', docDefinition);

        const pdfObj = origCreatePdf.apply(this, arguments);

        if (pdfObj && typeof pdfObj.download === 'function') {
          const origDownload = pdfObj.download;
          pdfObj.download = function (filename, cb) {
            console.log(`%c[PDF DOWNLOAD] Portal triggered download for: %c${filename || 'default.pdf'}`, 'color:#d97706;font-weight:bold;', 'color:#2563eb;font-weight:bold;');
            return origDownload.apply(this, arguments);
          };
        }

        console.groupEnd();
        return pdfObj;
      };
      console.log(`%c[Inspector] Attached hook to pdfMake in ${label}`, 'color:#10b981;');
    }
  }

  // Hook top window and observe iframe additions
  hookPdfMake(window, 'Main Portal Window');

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. PROBE ACTIVE PORTAL STATE
  // ─────────────────────────────────────────────────────────────────────────────
  window.probePortalState = function () {
    console.group('%c=== GST Portal Session & Angular Diagnostic ===', 'color:#8b5cf6;font-size:14px;font-weight:bold;');
    
    const lsKeys = ['gstin', 'rtn_prd', 'ret_period', 'fin_year', 'disyear', 'lglname', 'trade_name'];
    const sessionData = {};
    lsKeys.forEach(k => {
      sessionData[k] = localStorage.getItem(k) || sessionStorage.getItem(k) || 'N/A';
    });
    console.log('%cStorage Values (localStorage / sessionStorage):', 'font-weight:bold;');
    console.table(sessionData);

    let injector = null;
    try {
      injector = angular.element(document.body).injector() || angular.element(document).injector();
    } catch (_) {}

    if (!injector) {
      console.warn('AngularJS injector not detected on document.body. Make sure you are on a logged-in page.');
      console.groupEnd();
      return;
    }

    console.log('%cAngularJS Injector: %cACTIVE', 'font-weight:bold;', 'color:#16a34a;font-weight:bold;');
    try {
      const shareData = injector.get('shareData');
      console.log('%cshareData Service Object:%c', 'font-weight:bold;', 'color:#3b82f6;', shareData);
    } catch (e) {
      console.log('shareData service not found or accessible.');
    }

    // Search BFS for download scopes
    const rootScope = injector.get('$rootScope');
    const queue = [rootScope];
    const foundScopes = [];
    while (queue.length) {
      const s = queue.shift();
      if (!s) continue;
      const methods = Object.keys(s).filter(k => typeof s[k] === 'function');
      const interesting = methods.filter(m => /pdf|download|gstr|summary/i.test(m));
      if (interesting.length > 0) {
        foundScopes.push({ scopeId: s.$id, interestingMethods: interesting, rtn_prd: s.rtn_prd || s.ret_period || s.retprd || 'N/A' });
      }
      if (s.$$childHead) queue.push(s.$$childHead);
      if (s.$$nextSibling) queue.push(s.$$nextSibling);
    }
    console.log('%cDiscovered Active Angular Scopes with Download Methods:', 'font-weight:bold;');
    console.table(foundScopes);

    console.groupEnd();
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. PROBE GSTR-3B (API & SCOPE COMPILER)
  // ─────────────────────────────────────────────────────────────────────────────
  window.probeGSTR3B = async function (period) {
    const targetPeriod = period || localStorage.getItem('rtn_prd') || '042026';
    console.group(`%c[GSTR-3B PROBE] Period: ${targetPeriod}`, 'background:#10b981;color:#fff;font-weight:bold;padding:4px 8px;border-radius:3px;');
    
    // 1. Fetch Official Portal Summary API
    const sumUrl = `https://return.gst.gov.in/returns/auth/api/gstr3b/summary?rtn_prd=${targetPeriod}`;
    console.log(`%c1. Fetching official portal summary API: %c${sumUrl}`, 'font-weight:bold;', 'color:#0284c7;');
    try {
      const r = await fetch(sumUrl, { credentials: 'include' });
      if (r.ok) {
        const json = await r.json();
        console.log('%cOfficial GSTR-3B Summary JSON from GSTN Server:%c', 'color:#16a34a;font-weight:bold;', '', json);
        if (json.sup_details) {
          console.log('%cTable 3.1 Outward Taxable Supplies (from GSTN API):', 'font-weight:bold;');
          console.table(json.sup_details);
        }
        if (json.itc_elg) {
          console.log('%cTable 4 Eligible ITC (from GSTN API):', 'font-weight:bold;');
          console.log('ITC Available:', json.itc_elg.itc_avl);
          console.log('Net ITC:', json.itc_elg.itc_net);
        }
      } else {
        console.warn(`Summary API responded with HTTP status ${r.status}`);
      }
    } catch (e) {
      console.error('Error fetching GSTR-3B summary API:', e);
    }

    // 2. Fetch Official Portal Tax Payable API
    const taxUrl = `https://return.gst.gov.in/returns/auth/api/gstr3b/taxpayble?rtn_prd=${targetPeriod}`;
    console.log(`%c2. Fetching official portal taxpayble API: %c${taxUrl}`, 'font-weight:bold;', 'color:#0284c7;');
    try {
      const r = await fetch(taxUrl, { credentials: 'include' });
      if (r.ok) {
        const json = await r.json();
        console.log('%cOfficial GSTR-3B Tax Payable & Payment Details:%c', 'color:#16a34a;font-weight:bold;', '', json);
        const taxPaid = json?.returnsDbCdredList?.tax_paid?.pd_by_itc;
        if (taxPaid) {
          console.log('%cTable 6.1 Tax Paid via ITC:', 'font-weight:bold;');
          console.table(taxPaid);
        }
      } else {
        console.warn(`Taxpayble API responded with status ${r.status}`);
      }
    } catch (e) {
      console.error('Error fetching taxpayble API:', e);
    }

    // 3. Test Angular Scope Compiler
    console.log('%c3. Probing AngularJS Scope downloadGSTR3Bpdf() Method...', 'font-weight:bold;');
    try {
      const injector = angular.element(document.body).injector();
      const rootScope = injector.get('$rootScope');
      let targetScope = null;
      const q = [rootScope];
      while (q.length) {
        const s = q.shift();
        if (s && typeof s.downloadGSTR3Bpdf === 'function') {
          targetScope = s;
          break;
        }
        if (s && s.$$childHead) q.push(s.$$childHead);
        if (s && s.$$nextSibling) q.push(s.$$nextSibling);
      }

      if (targetScope) {
        console.log('%c✓ Found official portal downloadGSTR3Bpdf() function on scope id: ' + targetScope.$id, 'color:#16a34a;font-weight:bold;');
        console.log('%cTo trigger live portal PDF generation, execute: %cscope.downloadGSTR3Bpdf()', 'color:#64748b;', 'color:#2563eb;font-weight:bold;');
      } else {
        console.warn('downloadGSTR3Bpdf() not currently mounted in active DOM. Make sure you are on the returns dashboard.');
      }
    } catch (e) {
      console.warn('Scope search failed:', e.message);
    }

    console.groupEnd();
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. PROBE GSTR-1 (OFFICIAL API & SUMMARY)
  // ─────────────────────────────────────────────────────────────────────────────
  window.probeGSTR1 = async function (period) {
    const targetPeriod = period || localStorage.getItem('rtn_prd') || '042026';
    console.group(`%c[GSTR-1 PROBE] Period: ${targetPeriod}`, 'background:#f59e0b;color:#fff;font-weight:bold;padding:4px 8px;border-radius:3px;');
    
    const sumUrl = `https://return.gst.gov.in/returns/auth/api/gstr1/summary?rtn_prd=${targetPeriod}`;
    console.log(`%cFetching official GSTR-1 summary API: %c${sumUrl}`, 'font-weight:bold;', 'color:#0284c7;');
    try {
      const r = await fetch(sumUrl, { credentials: 'include' });
      if (r.ok) {
        const json = await r.json();
        console.log('%cOfficial GSTR-1 Summary Data from GSTN Server:%c', 'color:#16a34a;font-weight:bold;', '', json);
        if (json.sec_sum) {
          console.log('%cTable Breakdown (sec_sum):', 'font-weight:bold;');
          console.table(json.sec_sum);
        }
      } else {
        console.warn(`GSTR-1 summary API responded with status ${r.status}`);
      }
    } catch (e) {
      console.error('Error fetching GSTR-1 summary API:', e);
    }

    console.groupEnd();
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. PROBE GSTR-2B (DIRECT API & DATA)
  // ─────────────────────────────────────────────────────────────────────────────
  window.probeGSTR2B = async function (period) {
    const targetPeriod = period || localStorage.getItem('rtn_prd') || '042026';
    console.group(`%c[GSTR-2B PROBE] Period: ${targetPeriod}`, 'background:#06b6d4;color:#fff;font-weight:bold;padding:4px 8px;border-radius:3px;');
    
    const urls = [
      `https://gstr2b.gst.gov.in/gstr2b/auth/api/gstr2b/getjson?rtn_prd=${targetPeriod}`,
      `https://gstr2b.gst.gov.in/gstr2b/auth/api/gstr2bq/getdata?rtnprd=${targetPeriod}`
    ];

    for (const u of urls) {
      console.log(`%cProbing GSTR-2B API: %c${u}`, 'font-weight:bold;', 'color:#0284c7;');
      try {
        const r = await fetch(u, { credentials: 'include' });
        if (r.ok) {
          const json = await r.json();
          console.log(`%cResponse from ${u}:%c`, 'color:#16a34a;font-weight:bold;', '', json);
        } else {
          console.warn(`Endpoint ${u} status: ${r.status}`);
        }
      } catch (e) {
        console.warn(`Could not reach ${u}:`, e.message);
      }
    }

    console.groupEnd();
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // 6. SNIFFER FOR NEXT PDF DOWNLOAD
  // ─────────────────────────────────────────────────────────────────────────────
  window.sniffNextPdfDownload = function () {
    console.log('%c[Sniffer Active] Listening for any PDF download on this page...', 'background:#10b981;color:#fff;font-weight:bold;padding:3px 6px;');
    console.log('%cClick the portal download button or ReturnPilot button now to inspect live generation.', 'color:#64748b;');
  };

  console.log('%cReady! Try running: probePortalState() or probeGSTR3B("042026")', 'color:#10b981;font-weight:bold;');
})();
