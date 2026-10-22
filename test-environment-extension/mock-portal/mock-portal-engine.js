/**
 * ReturnPilot Test Lab — Mock Portal Engine
 * Accurately simulates GST Portal client-side libraries:
 * 1. pdfMake (used by both GSTR-1 and GSTR-2B for PDF generation)
 * 2. AngularJS 1.8.x dependency injection, scopes, and controllers (GSTR-1)
 * 3. Angular 8+ Ivy component tree (GSTR-2B)
 */

(function(window) {
  'use strict';

  // 1. Mock pdfMake (exact portal interface)
  window.pdfMake = {
    vfs: {},
    fonts: {},
    createPdf: function(docDefinition) {
      return {
        docDefinition: docDefinition,
        download: function(defaultFileName) {
          const fn = defaultFileName || 'document.pdf';
          const fakeBinary = `%PDF-1.4\n%Official GSTN Mock Output for ${fn}\n${JSON.stringify(docDefinition)}`;
          const blob = new Blob([fakeBinary], { type: 'application/pdf' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = fn;
          document.body.appendChild(a);
          a.click();
          setTimeout(() => {
            a.remove();
            URL.revokeObjectURL(url);
          }, 1000);
          return blob;
        },
        getBlob: function(cb) {
          const fakeBinary = `%PDF-1.4\n%Official GSTN Mock Output\n${JSON.stringify(docDefinition)}`;
          const blob = new Blob([fakeBinary], { type: 'application/pdf' });
          if (cb) cb(blob);
          return blob;
        }
      };
    }
  };

  // 2. Mock AngularJS 1.8.x Runtime (used by GST Portal GSTR-1)
  const registry = new Map();
  const services = {
    $rootScope: {
      $apply: function(fn) { if (fn) fn(); }
    },
    $location: {
      path: function() { return '/gstr1'; }
    },
    shareData: {
      rtn_prd: '042025',
      formname: 'GSTR1',
      gstin: '22AAIFT4081E1ZE'
    }
  };

  const mockInjector = {
    get: function(name) {
      if (services[name]) return services[name];
      throw new Error(`Service ${name} not found`);
    },
    has: function(name) {
      return Boolean(services[name]);
    }
  };

  const mockScope = {
    $apply: function(fn) { if (fn) fn(); },
    genratepdfNew: function() {
      // Official GSTR-1 docDefinition structure as produced by portal controllers
      const docDef = {
        info: { title: 'FORM GSTR-1 STATUTORY SUMMARY RETURN' },
        content: [
          { text: 'GOVERNMENT OF INDIA', style: 'header', alignment: 'center' },
          { text: 'FORM GSTR-1: DETAILS OF OUTWARD SUPPLIES', style: 'subheader', alignment: 'center' },
          {
            table: {
              headerRows: 1,
              widths: ['30%', '70%'],
              body: [
                ['GSTIN', services.shareData.gstin],
                ['Tax Period', services.shareData.rtn_prd],
                ['Filing Status', 'Filed - Official Port Entry']
              ]
            }
          }
        ]
      };
      return window.pdfMake.createPdf(docDef).download(`GSTR1_${services.shareData.gstin}_${services.shareData.rtn_prd}.pdf`);
    }
  };

  window.angular = {
    version: { full: '1.8.2' },
    element: function(domEl) {
      return {
        injector: function() { return mockInjector; },
        scope: function() { return mockScope; }
      };
    }
  };

})(typeof window !== 'undefined' ? window : globalThis);
