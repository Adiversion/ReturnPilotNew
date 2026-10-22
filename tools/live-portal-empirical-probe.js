/**
 * ════════════════════════════════════════════════════════════════════════════════
 *  ReturnPilot — Universal Multi-Return Empirical Portal Inspector
 *  Supports ALL Returns: GSTR-3B, GSTR-1, GSTR-2B, GSTR-9, GSTR-1A, IMS
 *  100% Evidence-Driven Console Script for Google Chrome DevTools (F12)
 * ════════════════════════════════════════════════════════════════════════════════
 * 
 *  HOW TO RUN:
 *  1. Open Chrome DevTools (F12 -> Console tab) on ANY GST Portal page:
 *     - Returns Dashboard: https://return.gst.gov.in/returns/auth/dashboard
 *     - GSTR-1 Page      : https://return.gst.gov.in/returns/auth/gstr1
 *     - GSTR-2B Portal    : https://gstr2b.gst.gov.in/gstr2b/auth/view2b
 *     - GSTR-9 Page      : https://return.gst.gov.in/returns/auth/gstr9
 *  2. Paste this ENTIRE script and press Enter.
 *  3. Run the diagnostic commands for the return you want to test:
 * 
 *     • GSTProbe.decompileAllReturnMethods()
 *       -> Scans and prints decompiled source code for ALL returns (G1, G2B, G3B, G9)
 * 
 *     • GSTProbe.testGstr3bPdf('042024')
 *       -> Directly triggers official GSTR-3B PDF in memory & dumps docDefinition
 * 
 *     • GSTProbe.testGstr1Pdf('042024')
 *       -> Directly triggers official GSTR-1 Summary PDF & dumps docDefinition
 * 
 *     • GSTProbe.testGstr2bPdf('042024')
 *       -> Directly triggers official GSTR-2B PDF & dumps docDefinition
 * 
 *     • GSTProbe.testGstr2bExcel('042024')
 *       -> Directly triggers official GSTR-2B Excel & intercepts workbook sheets
 * 
 *     • GSTProbe.testGstr9Pdf('2023-24')
 *       -> Directly triggers official GSTR-9 Annual Return PDF & dumps docDefinition
 * 
 *     • GSTProbe.exportLogs()
 *       -> Copies all captured telemetry, docDefinitions & sources to clipboard!
 * ════════════════════════════════════════════════════════════════════════════════
 */

(function () {
  'use strict';

  console.clear();
  console.log(
    '%c[Universal GSTProbe]%c Multi-Return Empirical Decompiler & Sniffer Active!',
    'background:#7c3aed;color:#fff;font-weight:bold;padding:4px 8px;border-radius:3px;',
    'color:#10b981;font-weight:bold;'
  );
  console.log(
    '%cReady for: GSTR-3B | GSTR-1 | GSTR-2B | GSTR-9 | GSTR-1A | IMS\n' +
    'Type %cGSTProbe.help()%c to view all available commands.',
    'color:#64748b;', 'color:#3b82f6;font-weight:bold;', 'color:#64748b;'
  );

  const logs = [];
  function record(type, title, data) {
    const entry = { ts: new Date().toISOString(), type, title, data };
    logs.push(entry);
    return entry;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. UNIVERSAL PDFMAKE & XLSX SNIFFERS (Intercepts both PDF & Excel live)
  // ─────────────────────────────────────────────────────────────────────────────
  window.__gstprobe_captured_docdefs = [];
  window.__gstprobe_captured_workbooks = [];

  // A. Hook pdfMake
  function hookPdfMake(pm) {
    if (!pm || pm.__gstprobe_hooked) return;
    pm.__gstprobe_hooked = true;
    const origCreatePdf = pm.createPdf;

    pm.createPdf = function (docDefinition) {
      console.group('%c[PDF CAPTURED] Official portal pdfMake.createPdf() Call Intercepted!', 'background:#059669;color:#fff;font-weight:bold;padding:4px 8px;border-radius:3px;');
      console.log('%cStack Trace of Caller:%c\n' + (new Error().stack || 'N/A'), 'font-weight:bold;', 'color:#64748b;font-size:11px;');
      console.log('%cLive docDefinition Object (Official Government Template):%c', 'color:#3b82f6;font-weight:bold;', '', docDefinition);
      
      let str = '';
      try { str = JSON.stringify(docDefinition); } catch (_) {}
      const prdMatch = str.match(/\b(0[1-9]|1[0-2])(20\d{2})\b/);
      const gstinMatch = str.match(/\b\d{2}[A-Z]{5}\d{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}\b/);

      console.log(`%cDetected Document Period: %c${prdMatch ? prdMatch[0] : 'Unknown'}`, 'font-weight:bold;', 'color:#16a34a;font-weight:bold;');
      console.log(`%cDetected Document GSTIN : %c${gstinMatch ? gstinMatch[0] : 'Unknown'}`, 'font-weight:bold;', 'color:#16a34a;font-weight:bold;');
      console.log(`%cDocDefinition Payload Size: %c${str.length} characters`, 'font-weight:bold;', 'color:#0284c7;');

      window.__gstprobe_captured_docdefs.push({
        ts: new Date().toISOString(),
        period: prdMatch ? prdMatch[0] : null,
        gstin: gstinMatch ? gstinMatch[0] : null,
        docDefinition: docDefinition
      });
      record('PDFMAKE_CAPTURE', 'Captured docDefinition', { period: prdMatch ? prdMatch[0] : null, length: str.length });

      console.groupEnd();
      return origCreatePdf.apply(this, arguments);
    };
  }

  if (window.pdfMake) hookPdfMake(window.pdfMake);
  try {
    let _pm = window.pdfMake;
    Object.defineProperty(window, 'pdfMake', {
      configurable: true, enumerable: true,
      get: () => _pm,
      set: (val) => { _pm = val; hookPdfMake(val); }
    });
  } catch (_) {}

  // B. Hook XLSX & saveAs (for Excel downloads in GSTR-2B, GSTR-1, GSTR-9)
  function hookXlsx(x) {
    if (!x || x.__gstprobe_hooked) return;
    x.__gstprobe_hooked = true;
    if (x.writeFile) {
      const origWriteFile = x.writeFile;
      x.writeFile = function (wb, fn) {
        console.group('%c[EXCEL CAPTURED] Official portal XLSX.writeFile() Intercepted!', 'background:#0284c7;color:#fff;font-weight:bold;padding:4px 8px;border-radius:3px;');
        console.log(`%cFile Name:%c ${fn}`, 'font-weight:bold;', 'color:#10b981;');
        console.log('%cWorkbook Sheets:%c', 'font-weight:bold;', '', wb ? Object.keys(wb.Sheets || {}) : []);
        window.__gstprobe_captured_workbooks.push({ filename: fn, sheets: wb ? Object.keys(wb.Sheets || {}) : [] });
        console.groupEnd();
        return origWriteFile.apply(this, arguments);
      };
    }
  }
  if (window.XLSX) hookXlsx(window.XLSX);
  try {
    let _x = window.XLSX;
    Object.defineProperty(window, 'XLSX', {
      configurable: true, enumerable: true,
      get: () => _x,
      set: (val) => { _x = val; hookXlsx(val); }
    });
  } catch (_) {}

  if (window.saveAs && !window.saveAs.__gstprobe_hooked) {
    const origSaveAs = window.saveAs;
    window.saveAs = function (blob, fn) {
      console.log(`%c[SAVEAS CAPTURED] Portal triggered saveAs download: %c${fn || 'download'}`, 'background:#f59e0b;color:#fff;font-weight:bold;padding:2px 6px;', 'color:#2563eb;font-weight:bold;');
      return origSaveAs.apply(this, arguments);
    };
    window.saveAs.__gstprobe_hooked = true;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. HELPER FUNCTIONS
  // ─────────────────────────────────────────────────────────────────────────────
  function getInjector() {
    try {
      return angular.element(document.body).injector() || angular.element(document).injector();
    } catch (_) {
      return null;
    }
  }

  function findScopeWithMethod(predicate) {
    const inj = getInjector();
    if (!inj) return null;
    const root = inj.get('$rootScope');
    const q = [root];
    while (q.length) {
      const s = q.shift();
      if (!s) continue;
      if (predicate(s)) return s;
      if (s.$$childHead) q.push(s.$$childHead);
      if (s.$$nextSibling) q.push(s.$$nextSibling);
    }
    return null;
  }

  function setPortalPeriod(period, fy) {
    const inj = getInjector();
    const shareData = inj ? inj.get('shareData') : null;
    if (shareData) {
      shareData.rtn_prd = period;
      shareData.retprd = period;
      shareData.fp = period;
      shareData.tax_period = period;
      if (fy) { shareData.fin_year = fy; shareData.disyear = fy; }
    }
    localStorage.setItem('rtn_prd', period);
    sessionStorage.setItem('rtn_prd', period);
    if (fy) {
      localStorage.setItem('fin_year', fy);
      localStorage.setItem('disyear', fy);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. MAIN DIAGNOSTIC OBJECT (GSTProbe)
  // ─────────────────────────────────────────────────────────────────────────────
  const GSTProbe = {
    help() {
      console.log(
        '%c=== GSTProbe Multi-Return Commands ===\n' +
        '1. %cGSTProbe.decompileAllReturnMethods()%c  -> Decompile download methods across ALL return scopes\n' +
        '2. %cGSTProbe.testGstr3bPdf(period)%c        -> Direct GSTR-3B PDF (e.g. "042024")\n' +
        '3. %cGSTProbe.testGstr1Pdf(period)%c         -> Direct GSTR-1 PDF (e.g. "042024")\n' +
        '4. %cGSTProbe.testGstr2bPdf(period)%c        -> Direct GSTR-2B PDF (e.g. "042024")\n' +
        '5. %cGSTProbe.testGstr2bExcel(period)%c      -> Direct GSTR-2B Excel (e.g. "042024")\n' +
        '6. %cGSTProbe.testGstr9Pdf(fy)%c             -> Direct GSTR-9 PDF (e.g. "2023-24")\n' +
        '7. %cGSTProbe.inspectActiveState()%c          -> View current storage & Angular singletons\n' +
        '8. %cGSTProbe.exportLogs()%c                  -> Copy all captured evidence to clipboard',
        'font-weight:bold;',
        'color:#3b82f6;font-weight:bold;', '',
        'color:#3b82f6;font-weight:bold;', '',
        'color:#3b82f6;font-weight:bold;', '',
        'color:#3b82f6;font-weight:bold;', '',
        'color:#3b82f6;font-weight:bold;', '',
        'color:#3b82f6;font-weight:bold;', '',
        'color:#3b82f6;font-weight:bold;', '',
        'color:#3b82f6;font-weight:bold;', ''
      );
    },

    /**
     * Decompiles ALL download & PDF functions across GSTR-1, GSTR-2B, GSTR-3B, GSTR-9
     */
    decompileAllReturnMethods() {
      console.group('%c=== Decompiling ALL Return Download Functions from Angular Memory ===', 'background:#7c3aed;color:#fff;font-weight:bold;padding:4px 8px;');
      const inj = getInjector();
      if (!inj) {
        console.error('Angular injector not found. Run this from any logged-in portal page.');
        console.groupEnd();
        return;
      }

      const root = inj.get('$rootScope');
      const q = [root];
      const results = [];

      while (q.length) {
        const s = q.shift();
        if (!s) continue;
        for (const k of Object.keys(s)) {
          if (typeof s[k] === 'function' && /download|pdf|excel|export|gstr|summary|genrate/i.test(k)) {
            const code = s[k].toString();
            results.push({ scopeId: s.$id, methodName: k, fullCode: code });
            console.groupCollapsed(`%cscope.${k}() [Scope ID: ${s.$id}]`, 'color:#2563eb;font-weight:bold;');
            console.log(code);
            console.groupEnd();
          }
        }
        if (s.$$childHead) q.push(s.$$childHead);
        if (s.$$nextSibling) q.push(s.$$nextSibling);
      }

      console.log(`%c✓ Discovered ${results.length} total download/export methods in memory. Expand any method above to see its exact code.`, 'color:#10b981;font-weight:bold;');
      console.groupEnd();
      return results;
    },

    /**
     * 1. GSTR-3B Direct PDF Execution
     */
    testGstr3bPdf(period = '042024', fy = '2024-25') {
      console.group(`%c[TEST GSTR-3B] Triggering Official Portal GSTR-3B PDF (${period})`, 'background:#2563eb;color:#fff;font-weight:bold;padding:3px 6px;');
      setPortalPeriod(period, fy);

      const targetScope = findScopeWithMethod(s => typeof s.downloadGSTR3Bpdf === 'function');
      if (!targetScope) {
        console.warn('downloadGSTR3Bpdf() not found on active page. Make sure you are on: https://return.gst.gov.in/returns/auth/dashboard');
        console.groupEnd();
        return;
      }

      console.log(`%cFound downloadGSTR3Bpdf on Scope ID: ${targetScope.$id}. Invoking...`, 'color:#10b981;');
      try {
        if (!targetScope.$$phase) {
          targetScope.$apply(() => targetScope.downloadGSTR3Bpdf(period));
        } else {
          targetScope.downloadGSTR3Bpdf(period);
        }
        console.log('%c✓ GSTR-3B generation call dispatched! Check the intercepted docDefinition above.', 'color:#16a34a;font-weight:bold;');
      } catch (e) {
        console.error('GSTR-3B trigger error:', e);
      }
      console.groupEnd();
    },

    /**
     * 2. GSTR-1 Direct PDF Execution
     */
    testGstr1Pdf(period = '042024', fy = '2024-25') {
      console.group(`%c[TEST GSTR-1] Triggering Official Portal GSTR-1 PDF (${period})`, 'background:#d97706;color:#fff;font-weight:bold;padding:3px 6px;');
      setPortalPeriod(period, fy);

      // Search for GSTR-1 generator methods: genratepdfNew, getSummary, generateNILGstr1Pdf
      const targetScope = findScopeWithMethod(s => 
        typeof s.genratepdfNew === 'function' || 
        typeof s.getSummary === 'function' || 
        typeof s.generateNILGstr1Pdf === 'function' ||
        typeof s.downloadGSTR1pdf === 'function'
      );

      if (!targetScope) {
        console.warn('GSTR-1 generation methods not found in active DOM. If you are on the dashboard, navigate to: https://return.gst.gov.in/returns/auth/gstr1 or open GSTR-1 online.');
        console.groupEnd();
        return;
      }

      const method = typeof targetScope.genratepdfNew === 'function' ? 'genratepdfNew' :
                     (typeof targetScope.getSummary === 'function' ? 'getSummary' : 'downloadGSTR1pdf');

      console.log(`%cFound GSTR-1 generator method: scope.${method}() on Scope ID: ${targetScope.$id}. Invoking...`, 'color:#10b981;');
      try {
        if (!targetScope.$$phase) {
          targetScope.$apply(() => targetScope[method]());
        } else {
          targetScope[method]();
        }
        console.log('%c✓ GSTR-1 generation call dispatched! Check the intercepted docDefinition above.', 'color:#16a34a;font-weight:bold;');
      } catch (e) {
        console.error('GSTR-1 trigger error:', e);
      }
      console.groupEnd();
    },

    /**
     * 3. GSTR-2B Direct PDF Execution
     */
    testGstr2bPdf(period = '042024', fy = '2024-25') {
      console.group(`%c[TEST GSTR-2B PDF] Triggering Official Portal GSTR-2B PDF (${period})`, 'background:#0891b2;color:#fff;font-weight:bold;padding:3px 6px;');
      setPortalPeriod(period, fy);

      const targetScope = findScopeWithMethod(s => 
        typeof s.download2BPdf === 'function' || 
        typeof s.downloadPdf === 'function' || 
        typeof s.downloadPDF === 'function'
      );

      if (!targetScope) {
        console.warn('GSTR-2B PDF method not found on this tab. GSTR-2B is hosted on: https://gstr2b.gst.gov.in/gstr2b/auth/view2b');
        console.groupEnd();
        return;
      }

      const method = typeof targetScope.download2BPdf === 'function' ? 'download2BPdf' : 'downloadPdf';
      console.log(`%cFound GSTR-2B method: scope.${method}() on Scope ID: ${targetScope.$id}. Invoking...`, 'color:#10b981;');
      try {
        if (!targetScope.$$phase) {
          targetScope.$apply(() => targetScope[method]());
        } else {
          targetScope[method]();
        }
        console.log('%c✓ GSTR-2B PDF generation call dispatched! Check the intercepted docDefinition above.', 'color:#16a34a;font-weight:bold;');
      } catch (e) {
        console.error('GSTR-2B PDF trigger error:', e);
      }
      console.groupEnd();
    },

    /**
     * 4. GSTR-2B Direct Excel Execution
     */
    testGstr2bExcel(period = '042024', fy = '2024-25') {
      console.group(`%c[TEST GSTR-2B EXCEL] Triggering Official Portal GSTR-2B Excel (${period})`, 'background:#059669;color:#fff;font-weight:bold;padding:3px 6px;');
      setPortalPeriod(period, fy);

      const targetScope = findScopeWithMethod(s => 
        typeof s.downloadExcel === 'function' || 
        typeof s.download2BExcel === 'function' || 
        typeof s.downloadexcel === 'function'
      );

      if (!targetScope) {
        console.warn('GSTR-2B Excel method not found. GSTR-2B is hosted on: https://gstr2b.gst.gov.in/gstr2b/auth/view2b');
        console.groupEnd();
        return;
      }

      const method = typeof targetScope.download2BExcel === 'function' ? 'download2BExcel' :
                     (typeof targetScope.downloadExcel === 'function' ? 'downloadExcel' : 'downloadexcel');

      console.log(`%cFound GSTR-2B Excel method: scope.${method}() on Scope ID: ${targetScope.$id}. Invoking...`, 'color:#10b981;');
      try {
        if (!targetScope.$$phase) {
          targetScope.$apply(() => targetScope[method]());
        } else {
          targetScope[method]();
        }
        console.log('%c✓ GSTR-2B Excel call dispatched! Check the intercepted XLSX workbook above.', 'color:#16a34a;font-weight:bold;');
      } catch (e) {
        console.error('GSTR-2B Excel trigger error:', e);
      }
      console.groupEnd();
    },

    /**
     * 5. GSTR-9 Direct PDF Execution
     */
    testGstr9Pdf(fy = '2023-24') {
      console.group(`%c[TEST GSTR-9] Triggering Official Portal GSTR-9 Annual Return PDF (FY ${fy})`, 'background:#e11d48;color:#fff;font-weight:bold;padding:3px 6px;');
      setPortalPeriod(null, fy);

      const targetScope = findScopeWithMethod(s => 
        typeof s.downloadGSTR9pdf === 'function' || 
        typeof s.downloadG9Pdf === 'function' ||
        typeof s.downloadPdf === 'function'
      );

      if (!targetScope) {
        console.warn('GSTR-9 PDF method not found on active page. Navigate to: https://return.gst.gov.in/returns/auth/gstr9');
        console.groupEnd();
        return;
      }

      const method = typeof targetScope.downloadGSTR9pdf === 'function' ? 'downloadGSTR9pdf' : 'downloadPdf';
      console.log(`%cFound GSTR-9 method: scope.${method}() on Scope ID: ${targetScope.$id}. Invoking...`, 'color:#10b981;');
      try {
        if (!targetScope.$$phase) {
          targetScope.$apply(() => targetScope[method]());
        } else {
          targetScope[method]();
        }
        console.log('%c✓ GSTR-9 generation call dispatched! Check the intercepted docDefinition above.', 'color:#16a34a;font-weight:bold;');
      } catch (e) {
        console.error('GSTR-9 trigger error:', e);
      }
      console.groupEnd();
    },

    /**
     * Inspect active storage and Angular singletons
     */
    inspectActiveState() {
      console.group('%c=== Active Storage & Angular State ===', 'background:#0891b2;color:#fff;font-weight:bold;padding:4px 8px;');
      const inj = getInjector();
      const shareData = inj ? inj.get('shareData') : null;
      console.table({
        'localStorage.gstin': localStorage.getItem('gstin') || 'Not Set',
        'localStorage.rtn_prd': localStorage.getItem('rtn_prd') || 'Not Set',
        'localStorage.fin_year': localStorage.getItem('fin_year') || 'Not Set',
        'shareData.rtn_prd': shareData ? shareData.rtn_prd : 'No shareData',
        'shareData.fy': shareData ? shareData.fy : 'No shareData',
        'window.pdfMake available': !!window.pdfMake,
        'window.XLSX available': !!window.XLSX,
        'Current Route': location.href
      });
      console.groupEnd();
    },

    /**
     * Exports all captured telemetry to clipboard
     */
    exportLogs() {
      const dump = {
        exportedAt: new Date().toISOString(),
        url: location.href,
        logs: logs,
        capturedDocDefs: window.__gstprobe_captured_docdefs,
        capturedWorkbooks: window.__gstprobe_captured_workbooks
      };
      const str = JSON.stringify(dump, null, 2);
      try {
        navigator.clipboard.writeText(str);
        console.log('%c✓ All diagnostic logs & docDefinitions copied to clipboard! Paste into your editor or reply here.', 'color:#16a34a;font-weight:bold;font-size:13px;');
      } catch (_) {
        console.log('JSON dump:', str);
      }
      return dump;
    }
  };

  window.GSTProbe = GSTProbe;
})();
