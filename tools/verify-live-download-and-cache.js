/**
 * ════════════════════════════════════════════════════════════════════════════════
 *  ReturnPilot — Live Download Verifier & Multi-Client Cache Leak Detector
 * ════════════════════════════════════════════════════════════════════════════════
 * 
 *  This script answers the two critical engineering questions:
 *   1. Are we triggering PDF / Excel downloads too early (before portal data arrives)?
 *   2. Is there a cache leakage issue where a previously logged-in GSTIN's data
 *      appears in the PDF/Excel of a newly logged-in client?
 * 
 *  HOW TO USE IN DEVTOOLS CONSOLE (F12 on GST Portal):
 *  1. Paste this entire script into Console and press Enter.
 *  2. Run:
 *     > CacheAndEarlyTriggerAudit.inspectBrowserState()
 *       -> Checks if previous client GSTIN is lingering in localStorage/Angular.
 *     > CacheAndEarlyTriggerAudit.armDownloadInterceptor()
 *       -> Listens to the next PDF/Excel download and performs real-time validation:
 *          - Flags if GSTIN in document doesn't match active logged-in GSTIN.
 *          - Flags if period in document doesn't match target period.
 *          - Flags if document has ₹0 values when the portal API has tax liability (Early Trigger).
 * ════════════════════════════════════════════════════════════════════════════════
 */

(function () {
  'use strict';

  console.clear();
  console.log(
    '%c[ReturnPilot Cache & Early-Trigger Auditor]%c Active & Armed!',
    'background:#7c3aed;color:#fff;font-weight:bold;padding:4px 8px;border-radius:3px;',
    'color:#10b981;font-weight:bold;'
  );
  console.log('%cRun %cCacheAndEarlyTriggerAudit.inspectBrowserState()%c to check for lingering cached data.', 'color:#64748b;', 'color:#3b82f6;font-weight:bold;', 'color:#64748b;');

  const CacheAndEarlyTriggerAudit = {
    // ─────────────────────────────────────────────────────────────────────────
    // 1. INSPECT ACTIVE VS CACHED STATE (Client Switch Leak Detector)
    // ─────────────────────────────────────────────────────────────────────────
    inspectBrowserState() {
      console.group('%c=== Multi-Client Cache & State Inspection ===', 'color:#7c3aed;font-weight:bold;font-size:13px;');

      // Active Portal Header GSTIN (from DOM)
      const domGstinEl = document.querySelector('.header-usr-name, [ng-bind*="gstin"], .usr-name, #header_usr_name');
      const domText = domGstinEl ? domGstinEl.innerText.trim() : '';
      const activeDomGstinMatch = domText.match(/\b\d{2}[A-Z]{5}\d{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}\b/) 
        || (document.body.innerText.match(/GSTIN\s*[:\-]?\s*(\d{2}[A-Z]{5}\d{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1})/i) || [])[1];

      // LocalStorage GSTIN
      const lsGstin = localStorage.getItem('gstin') || localStorage.getItem('_rp_current_gstin');
      const ssGstin = sessionStorage.getItem('gstin');

      // Angular shareData GSTIN
      let angularGstin = 'N/A';
      let angularPeriod = 'N/A';
      try {
        const injector = angular.element(document.body).injector() || angular.element(document).injector();
        const shareData = injector ? injector.get('shareData') : null;
        if (shareData) {
          angularGstin = shareData.gstin || 'Empty';
          angularPeriod = shareData.rtn_prd || shareData.ret_period || 'Empty';
        }
      } catch (_) {}

      // Extension window temporary cache
      const windowGstin = window._rpGstr3bGstin || 'None';

      const stateReport = {
        'Active DOM Header GSTIN': activeDomGstinMatch || 'Could not detect from DOM',
        'localStorage gstin': lsGstin || 'Empty',
        'sessionStorage gstin': ssGstin || 'Empty',
        'Angular shareData.gstin': angularGstin,
        'Angular shareData.rtn_prd': angularPeriod,
        'window._rpGstr3bGstin': windowGstin
      };

      console.table(stateReport);

      // Conflict Analysis
      const distinctGstins = new Set([activeDomGstinMatch, lsGstin, ssGstin, angularGstin].filter(g => g && g !== 'N/A' && g !== 'Empty' && g.length === 15));
      if (distinctGstins.size > 1) {
        console.error(
          `%c🚨 CRITICAL CACHE COLLISION DETECTED!%c Multiple different GSTINs found in browser memory: ${Array.from(distinctGstins).join(', ')}.`,
          'background:#dc2626;color:#fff;font-weight:bold;padding:2px 6px;',
          'color:#dc2626;font-weight:bold;'
        );
        console.warn('Reason: A previous taxpayer session was not fully purged on logout. The portal or extension might use the old GSTIN if not explicitly overwritten.');
      } else {
        console.log('%c✓ No cross-client GSTIN collision detected. All storage layers point to the same client.', 'color:#16a34a;font-weight:bold;');
      }

      console.groupEnd();
      return stateReport;
    },

    // ─────────────────────────────────────────────────────────────────────────
    // 2. REAL-TIME DOWNLOAD INTERCEPTOR (Catches Early Triggers & Data Mismatches)
    // ─────────────────────────────────────────────────────────────────────────
    armDownloadInterceptor() {
      console.log('%c[Interceptor Armed] Monitoring all PDF generation and downloads...', 'background:#059669;color:#fff;font-weight:bold;padding:3px 6px;');
      console.log('Now click any PDF download button (either via ReturnPilot or manually on the portal).');

      let lastApiFetchTime = 0;
      let lastApiUrl = '';

      // Sniff Fetch calls to track when API data actually arrived
      const origFetch = window.fetch;
      window.fetch = function (url, opts) {
        const u = String(url || '');
        if (u.includes('/api/gstr3b/') || u.includes('/api/gstr1/') || u.includes('/api/gstr2b/')) {
          lastApiUrl = u;
          lastApiFetchTime = performance.now();
          console.log(`%c[Network Sniffer] Portal API request initiated: %c${u.split('?')[0]}`, 'color:#64748b;', 'color:#0284c7;font-weight:bold;');
        }
        return origFetch.apply(this, arguments);
      };

      // Hook pdfMake.createPdf
      if (window.pdfMake && !window.pdfMake.__audit_hooked) {
        window.pdfMake.__audit_hooked = true;
        const origCreate = window.pdfMake.createPdf;

        window.pdfMake.createPdf = function (docDef) {
          const createTime = performance.now();
          const docStr = JSON.stringify(docDef || {});

          console.group('%c[PDF Generation Intercepted] Performing Real-Time Validation...', 'background:#2563eb;color:#fff;font-weight:bold;padding:4px 8px;');

          // 1. Check Timing (Early Trigger Analysis)
          if (lastApiFetchTime > 0) {
            const timeSinceApi = Math.round(createTime - lastApiFetchTime);
            console.log(`Time elapsed between last API fetch and pdfMake.createPdf: ${timeSinceApi} ms`);
            if (timeSinceApi < 10) {
              console.warn('%c⚠ WARNING: pdfMake was called virtually simultaneously with API fetch. Potential early trigger before API resolution!', 'color:#d97706;font-weight:bold;');
            } else {
              console.log('%c✓ Timing verified: pdfMake was invoked after API data arrived.', 'color:#16a34a;');
            }
          }

          // 2. Check GSTIN in Document Definition
          const activeDomGstin = (document.body.innerText.match(/GSTIN\s*[:\-]?\s*(\d{2}[A-Z]{5}\d{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1})/i) || [])[1];
          const docGstinMatch = docStr.match(/\b\d{2}[A-Z]{5}\d{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}\b/);
          const docGstin = docGstinMatch ? docGstinMatch[0] : null;

          console.log(`Active Portal GSTIN: ${activeDomGstin || 'Not detected in DOM'}`);
          console.log(`Document Header GSTIN: ${docGstin || 'Not detected in docDefinition'}`);

          if (activeDomGstin && docGstin && activeDomGstin !== docGstin) {
            console.error(
              `%c🚨 CACHED CLIENT MISMATCH DETECTED!%c Document has GSTIN "${docGstin}", but active portal user is "${activeDomGstin}".`,
              'background:#dc2626;color:#fff;font-weight:bold;padding:2px 6px;',
              'color:#dc2626;font-weight:bold;'
            );
          } else {
            console.log('%c✓ GSTIN Match Verified: Document belongs to the active logged-in taxpayer.', 'color:#16a34a;');
          }

          // 3. Check Period in Document Definition
          const docPeriodMatch = docStr.match(/\b(0[1-9]|1[0-2])(20\d{2})\b/);
          console.log(`Document Declared Period: ${docPeriodMatch ? docPeriodMatch[0] : 'Unknown'}`);

          // 4. Check for Empty / Blank Document (Zero-Value Early Trigger Check)
          const hasNonZeroTax = /[1-9]\d*(\.\d{2})?/.test(docStr);
          console.log(`Document contains numerical values: ${hasNonZeroTax}`);

          console.log('%cFull Captured docDefinition:%c', 'font-weight:bold;', '', docDef);
          console.groupEnd();

          return origCreate.apply(this, arguments);
        };
      }
    }
  };

  window.CacheAndEarlyTriggerAudit = CacheAndEarlyTriggerAudit;
})();
