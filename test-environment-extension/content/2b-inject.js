'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// GSTR2B-INJECT.JS — MAIN World Execution & Universal Blob Interceptor
// High-Precision PDF & Excel Engine with PDF DocDef Correction
// ═══════════════════════════════════════════════════════════════════════════

(function () {
  if (window.__gst2bInjectReady) return;
  window.__gst2bInjectReady = true;

  console.log('[2B Inject] Loaded on:', location.href);

  let activePeriod = '';
  let activeGstin = '';
  let activeFinYear = '';
  let activeCaptureType = null;

  // Initialize immediately from window.name metadata payload if present
  try {
    const nameMatch = (window.name || '').match(/__gst2b_(\d+)__meta=(.+)$/);
    if (nameMatch) {
      const meta = JSON.parse(decodeURIComponent(nameMatch[2]));
      activePeriod = meta.rtn_prd || meta.period || '';
      activeGstin = meta.gstin || '';
      activeFinYear = meta.finyr || (activePeriod ? disyearOf(activePeriod) : '');
    }
  } catch (_) {}

  function buildOfficial2bFilename(period, gstin, ext) {
    const p = period || activePeriod || '';
    const g = gstin || activeGstin || localStorage.getItem('gstin') || 'GSTIN';
    const d = new Date();
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${p}_${g}_GSTR2B_${dd}${mm}${yyyy}.${ext}`;
  }

  function disyearOf(p) {
    const prd = p || activePeriod || localStorage.getItem('rtn_prd') || localStorage.getItem('ret_period') || localStorage.getItem('period') || sessionStorage.getItem('rtn_prd') || '';
    if (prd && prd.length === 6) {
      const m = parseInt(prd.slice(0, 2), 10);
      const y = parseInt(prd.slice(2), 10);
      if (!isNaN(m) && !isNaN(y) && y >= 1900 && y <= 2100) {
        return m >= 4 ? `${y}-${String(y + 1).slice(2)}` : `${y - 1}-${String(y).slice(2)}`;
      }
    }
    const fyStored = activeFinYear || localStorage.getItem('finyr') || localStorage.getItem('fy') || sessionStorage.getItem('finyr') || sessionStorage.getItem('fy');
    if (fyStored && typeof fyStored === 'string' && fyStored.includes('-') && fyStored !== 'null') {
      return fyStored;
    }
    return '2026-27';
  }

  function isFyKey(str) {
    if (!str) return false;
    const clean = String(str).replace(/[:\s]/g, '').toLowerCase();
    return clean === 'financialyear' || clean === 'finyear' || clean === 'fy' || clean.includes('financialyear');
  }

  function isNullOrEmptyVal(val) {
    if (val === null || val === undefined) return true;
    if (typeof val === 'string') {
      const clean = val.trim().toLowerCase();
      return clean === 'null' || clean === 'undefined' || clean === '' || clean === '-';
    }
    if (typeof val === 'object') {
      if (val.text === null || val.text === undefined) return true;
      if (typeof val.text === 'string') {
        const clean = val.text.trim().toLowerCase();
        return clean === 'null' || clean === 'undefined' || clean === '' || clean === '-';
      }
    }
    return false;
  }

  // Deep recursive traversal to fix null/empty Financial Year in pdfMake docDefinition
  function fixPdfDocDefinition(node, targetFY) {
    if (!node || typeof node !== 'object') return;

    // 1. Array of elements (e.g. columns, inlines, or table body rows)
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        const curr = node[i];
        const next = node[i + 1];

        const currText = (curr?.text || curr || '').toString();
        if (isFyKey(currText) && next !== undefined) {
          if (isNullOrEmptyVal(next)) {
            if (typeof next === 'object' && next !== null) {
              next.text = targetFY;
            } else {
              node[i + 1] = targetFY;
            }
          }
        }
        fixPdfDocDefinition(node[i], targetFY);
      }
      return;
    }

    // 2. Table structures
    if (node.table && Array.isArray(node.table.body)) {
      node.table.body.forEach(row => {
        if (Array.isArray(row)) {
          for (let i = 0; i < row.length; i++) {
            const cell = row[i];
            const cellText = (cell?.text || cell || '').toString();
            if (isFyKey(cellText) && row[i + 1] !== undefined) {
              const valCell = row[i + 1];
              if (isNullOrEmptyVal(valCell)) {
                if (typeof valCell === 'object' && valCell !== null) {
                  valCell.text = targetFY;
                } else {
                  row[i + 1] = targetFY;
                }
              }
            }
          }
        }
      });
    }

    // 3. Object properties traversal (columns, stack, text, etc.)
    for (const key of Object.keys(node)) {
      if (typeof node[key] === 'object' && node[key] !== null) {
        fixPdfDocDefinition(node[key], targetFY);
      }
    }
  }

  // Patch AngularJS scopes on the portal page
  function patchAngularScope(targetFY) {
    try {
      const els = document.querySelectorAll('.ng-scope, [ng-controller], body, #main, .container');
      for (const el of els) {
        const scope = (window.angular && typeof window.angular.element === 'function') ? window.angular.element(el).scope() : null;
        if (scope) {
          ['finYear', 'fy', 'financialYear', 'fyear', 'selectedFy', 'selectedYear'].forEach(k => {
            if (scope[k] === null || scope[k] === undefined || scope[k] === 'null' || scope[k] === '') {
              scope[k] = targetFY;
            }
          });
          if (scope.r2bSummary) {
            ['finYear', 'fy', 'financialYear'].forEach(k => {
              if (scope.r2bSummary[k] === null || scope.r2bSummary[k] === undefined || scope.r2bSummary[k] === 'null' || scope.r2bSummary[k] === '') {
                scope.r2bSummary[k] = targetFY;
              }
            });
          }
          if (scope.summaryData) {
            ['finYear', 'fy', 'financialYear'].forEach(k => {
              if (scope.summaryData[k] === null || scope.summaryData[k] === undefined || scope.summaryData[k] === 'null' || scope.summaryData[k] === '') {
                scope.summaryData[k] = targetFY;
              }
            });
          }
          if (scope.gstr2bData) {
            ['finYear', 'fy', 'financialYear'].forEach(k => {
              if (scope.gstr2bData[k] === null || scope.gstr2bData[k] === undefined || scope.gstr2bData[k] === 'null' || scope.gstr2bData[k] === '') {
                scope.gstr2bData[k] = targetFY;
              }
            });
          }
          try { scope.$evalAsync(); } catch (_) {}
        }
      }
    } catch (_) {}
  }

  // ── Communication ──
  const sendResult = (payload) => {
    window.postMessage({ __gst2b: 'INJECT_RESULT', ...payload }, '*');
  };

  // ── Capture State ──
  const capture = { blob: null, filename: null, type: null, resolvers: [] };

  function resetCapture() {
    capture.blob = null;
    capture.filename = null;
    capture.type = null;
    capture.resolvers = [];
  }

  function resolveCapture(blob, filename, type) {
    if (!capture.blob && blob) {
      capture.blob = blob;
      if (filename) capture.filename = filename;
      if (type) capture.type = type;
      capture.resolvers.splice(0).forEach(r => r({ blob: capture.blob, filename: capture.filename, type: capture.type }));
    } else if (filename && !capture.filename) {
      capture.filename = filename;
    }
  }

  // ── Instant Dispatch Notification (Zero UI lag) ──
  let isDispatched = false;
  let dispatchedPayload = null;
  const dispatchResolvers = [];

  function resetDispatch() {
    isDispatched = false;
    dispatchedPayload = null;
    dispatchResolvers.length = 0;
  }

  function notifyDispatched(filename, type) {
    if (!isDispatched) {
      isDispatched = true;
      dispatchedPayload = { filename, type };
      dispatchResolvers.splice(0).forEach(r => r(dispatchedPayload));
    }
  }

  function waitDispatched(ms = 15000) {
    return new Promise((resolve) => {
      if (isDispatched) return resolve(dispatchedPayload);
      const timer = setTimeout(() => {
        resolve(dispatchedPayload || { timedOut: true });
      }, ms);
      dispatchResolvers.push((val) => {
        clearTimeout(timer);
        resolve(val);
      });
    });
  }

  // ── Universal Interceptors ──
  function hookPdfMake() {
    if (!window.pdfMake || window.pdfMake.__hooked2b) return false;
    const orig = window.pdfMake.createPdf;

    window.pdfMake.createPdf = function (docDefinition) {
      const targetFY = disyearOf(activePeriod);
      if (docDefinition) {
        fixPdfDocDefinition(docDefinition, targetFY);
      }

      const pdfObj = orig.call(this, docDefinition);

      // Capture binary base64 directly from portal pdfMake instance
      try {
        pdfObj.getBase64((b64) => {
          if (b64) {
            console.log('[2B Inject] 🎯 Captured Official Portal PDF Base64 Stream (len: ' + b64.length + ')');
            capture.base64 = b64;
            notifyDispatched(buildOfficial2bFilename(activePeriod, activeGstin, 'pdf'), 'PDF');
          }
        });
      } catch (_) {}

      const origDl = pdfObj.download ? pdfObj.download.bind(pdfObj) : null;
      pdfObj.download = function (fn) {
        console.log('[ReturnPilot 2B] Official portal pdfMake download triggered:', fn);
        notifyDispatched(fn, 'PDF');
        if (origDl) return origDl(fn);
      };
      return pdfObj;
    };

    window.pdfMake.__hooked2b = true;
    return true;
  }

  function hookXlsx() {
    if (!window.XLSX || window.XLSX.__hooked2b) return false;

    function fixWorkbook(wb, targetFY) {
      if (!wb || !wb.Sheets) return;
      Object.keys(wb.Sheets).forEach(sName => {
        const ws = wb.Sheets[sName];
        if (!ws || typeof ws !== 'object') return;
        
        Object.keys(ws).forEach(cellRef => {
          if (cellRef.startsWith('!')) return;
          const cell = ws[cellRef];
          if (cell && typeof cell.v === 'string' && isFyKey(cell.v)) {
            const m = cellRef.match(/^([A-Z]+)(\d+)$/);
            if (m) {
              const col = m[1];
              const row = m[2];
              const nextCol = String.fromCharCode(col.charCodeAt(col.length - 1) + 1);
              const nextCellRef = (col.length > 1 ? col.slice(0, -1) : '') + nextCol + row;
              const nextCell = ws[nextCellRef];
              if (!nextCell || isNullOrEmptyVal(nextCell.v)) {
                ws[nextCellRef] = { t: 's', v: targetFY, w: targetFY };
              }
            }
          }
        });
      });
    }

    if (window.XLSX.write) {
      const origWrite = window.XLSX.write;
      window.XLSX.write = function (wb, opts) {
        const targetFY = disyearOf(activePeriod);
        fixWorkbook(wb, targetFY);
        return origWrite.apply(this, arguments);
      };
    }

    if (window.XLSX.writeFile) {
      const origWriteFile = window.XLSX.writeFile;
      window.XLSX.writeFile = function (wb, fn, opts) {
        const targetFY = disyearOf(activePeriod);
        fixWorkbook(wb, targetFY);
        return origWriteFile.apply(this, arguments);
      };
    }

    if (window.XLSX.utils && window.XLSX.utils.aoa_to_sheet) {
      const origAoa = window.XLSX.utils.aoa_to_sheet;
      window.XLSX.utils.aoa_to_sheet = function (data, opts) {
        const targetFY = disyearOf(activePeriod);
        if (Array.isArray(data)) {
          data.forEach(row => {
            if (Array.isArray(row)) {
              for (let i = 0; i < row.length; i++) {
                if (isFyKey(String(row[i] || '')) && row[i + 1] !== undefined) {
                  if (isNullOrEmptyVal(row[i + 1])) {
                    row[i + 1] = targetFY;
                  }
                }
              }
            }
          });
        }
        return origAoa.apply(this, arguments);
      };
    }

    window.XLSX.__hooked2b = true;
    return true;
  }

  function hookSaveAs() {
    if (!window.saveAs || window.saveAs.__hooked2b) return false;
    const origSaveAs = window.saveAs;
    window.saveAs = function (blob, filename) {
      console.log('[ReturnPilot 2B] Official portal saveAs download triggered:', filename);
      notifyDispatched(filename, 'EXCEL');
      return origSaveAs.apply(this, arguments);
    };
    window.saveAs.__hooked2b = true;
    return true;
  }

  function hookUrlAndAnchor() {
    if (window.URL.__hooked2b) return;

    const origCreateObjectURL = window.URL.createObjectURL;
    const blobUrlMap = new Map();

    window.URL.createObjectURL = function (obj) {
      const url = origCreateObjectURL.apply(this, arguments);
      if (obj instanceof Blob) {
        blobUrlMap.set(url, obj);
        const isPdf = obj?.type?.includes('pdf');
        const isExcel = obj?.type?.includes('spreadsheet') || obj?.type?.includes('excel') || obj?.type?.includes('officedocument') || (activeCaptureType === 'EXCEL' && obj.size > 500);

        if (isExcel || (activeCaptureType === 'EXCEL' && !isPdf)) {
          console.log('[2B Inject] 🎯 Intercepted Excel Blob (size:', obj.size, ')');
          queueMicrotask(async () => {
            const fn = buildOfficial2bFilename(activePeriod, activeGstin, 'xlsx');
            notifyDispatched(fn, 'EXCEL');
            try {
              const dataUrl = await blobToDataUrl(obj);
              capture.base64 = (dataUrl || '').split(',')[1];
            } catch (_) {}
            if (!capture.blob) {
              resolveCapture(obj, fn, 'EXCEL');
            }
          });
        } else if (isPdf && activeCaptureType === 'PDF') {
          queueMicrotask(async () => {
            const fn = buildOfficial2bFilename(activePeriod, activeGstin, 'pdf');
            notifyDispatched(fn, 'PDF');
            if (!capture.base64) {
              try {
                const dataUrl = await blobToDataUrl(obj);
                capture.base64 = (dataUrl || '').split(',')[1];
              } catch (_) {}
            }
            if (!capture.blob) {
              resolveCapture(obj, fn, 'PDF');
            }
          });
        }
      }
      return url;
    };

    // ── Anchor Property & Attribute traps (Captures official filenames) ──
    if (!HTMLAnchorElement.prototype.__gst2bAttrHooked) {
      const origSetAttribute = HTMLAnchorElement.prototype.setAttribute;
      HTMLAnchorElement.prototype.setAttribute = function (name, val) {
        if (name && name.toLowerCase() === 'download' && val) {
          capture.filename = val;
        }
        return origSetAttribute.apply(this, arguments);
      };

      const origDlDesc = Object.getOwnPropertyDescriptor(HTMLAnchorElement.prototype, 'download');
      if (origDlDesc && origDlDesc.set) {
        Object.defineProperty(HTMLAnchorElement.prototype, 'download', {
          configurable: true,
          enumerable: true,
          get() { return origDlDesc.get.call(this); },
          set(val) {
            if (val) capture.filename = val;
            return origDlDesc.set.call(this, val);
          }
        });
      }
      HTMLAnchorElement.prototype.__gst2bAttrHooked = true;
    }

    const origAnchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      const downloadName = this.download || this.getAttribute('download') || '';
      const href = this.href || '';
      if (downloadName || href.startsWith('blob:')) {
        notifyDispatched(downloadName, activeCaptureType);
      }
      return origAnchorClick.apply(this, arguments);
    };

    window.URL.__hooked2b = true;
  }

  function installHooks() {
    hookPdfMake();
    hookXlsx();
    hookSaveAs();
    hookUrlAndAnchor();
    patchAngularScope(disyearOf(activePeriod));
  }

  installHooks();
  let hookAttempts = 0;
  const hookPoll = setInterval(() => {
    installHooks();
    if (++hookAttempts > 150) {
      clearInterval(hookPoll);
    }
  }, 50);

  function waitBlob(ms = 60000) {
    return new Promise((resolve, reject) => {
      if (capture.blob) return resolve({ blob: capture.blob, filename: capture.filename, type: capture.type });
      const timer = setTimeout(() => reject(new Error('Blob timeout')), ms);
      capture.resolvers.push((snap) => {
        clearTimeout(timer);
        resolve(snap);
      });
    });
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  // ── Dynamic Button Finder with Instant DOM Search & Mutation Trigger ──
  async function waitButton(textPatterns, maxMs = 20000) {
    const patterns = textPatterns.map(p => p.toUpperCase());

    const findMatch = () => {
      const elements = document.querySelectorAll('button, a, input[type="button"], [role="button"], .btn');
      for (const el of elements) {
        const text = (el.textContent || el.innerText || el.value || '').trim().toUpperCase().replace(/\s+/g, ' ');
        for (const pat of patterns) {
          if (text.includes(pat)) {
            const style = window.getComputedStyle(el);
            if (style.display !== 'none' && style.visibility !== 'hidden' && !el.disabled) {
              return el;
            }
          }
        }
      }
      return null;
    };

    const immediate = findMatch();
    if (immediate) return immediate;

    return new Promise((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          observer.disconnect();
          reject(new Error(`Button matching [${textPatterns.join(', ')}] not found`));
        }
      }, maxMs);

      const check = () => {
        const match = findMatch();
        if (match && !settled) {
          settled = true;
          clearTimeout(timeout);
          observer.disconnect();
          resolve(match);
        }
      };

      const observer = new MutationObserver(check);
      observer.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['disabled', 'style', 'class']
      });

      const interval = setInterval(() => {
        if (settled) clearInterval(interval);
        else check();
      }, 50);
    });
  }

  // ── Main Capture Flow ──
  async function runCapture(requestId, period, captureType, meta) {
    activePeriod = period;
    activeGstin = meta?.effectiveGstin || meta?.gstin || localStorage.getItem('gstin') || '';
    activeFinYear = meta?.finyr || disyearOf(period);
    activeCaptureType = captureType;
    console.log(`[2B Inject] Capture: ${period} ${captureType} (gstin: ${activeGstin || 'UNKNOWN'}, FY: ${activeFinYear})`);
    resetCapture();

    const tStart = performance.now();
    try {
      installHooks();
      patchAngularScope(activeFinYear);

      let btn;
      if (captureType === 'PDF') {
        btn = await waitButton([
          'DOWNLOAD GSTR-2B',
          'DOWNLOAD GSTR2B',
          'GSTR-2B SUMMARY (PDF)',
          'DOWNLOAD (PDF)',
          'DOWNLOAD PDF',
          'GSTR-2B DETAILS (PDF)',
          'SUMMARY (PDF)'
        ], 45000);
      } else if (captureType === 'EXCEL') {
        btn = await waitButton([
          'DOWNLOAD GSTR-2B DETAILS (EXCEL)',
          'DOWNLOAD GSTR2B DETAILS (EXCEL)',
          'GSTR-2B DETAILS (EXCEL)',
          'DOWNLOAD (EXCEL)',
          'DOWNLOAD EXCEL',
          'DETAILS (EXCEL)'
        ], 45000);
      } else {
        throw new Error(`Unknown captureType: ${captureType}`);
      }

      const tFound = performance.now();

      // Reset dispatch state before click
      resetDispatch();
      resetCapture();

      // Patch scopes again right before click
      patchAngularScope(activeFinYear);

      // 2026 Ivy Component Direct Trigger Hook
      let ivyTriggered = false;
      try {
        const compEl = btn?.closest('app-gstr2b-summary') || document.querySelector('app-gstr2b-summary') || document.getElementById('compSummary');
        const comp = window.ng ? window.ng.getComponent(compEl) : compEl?.__componentInstance;
        if (comp && typeof comp.downloadPdf === 'function' && captureType === 'PDF') {
          console.log('[2B Inject 2026] Directly triggering Ivy comp.downloadPdf() with DocDef FY patch!');
          comp.downloadPdf();
          ivyTriggered = true;
        } else if (comp && typeof comp.downloadExcel === 'function' && captureType === 'EXCEL') {
          console.log('[2B Inject 2026] Directly triggering Ivy comp.downloadExcel()!');
          comp.downloadExcel();
          ivyTriggered = true;
        }
      } catch (eIvy) {
        console.warn('[2B Inject 2026] Ivy direct trigger notice, using DOM click fallback:', eIvy.message);
      }

      if (!ivyTriggered) {
        try { btn.focus(); } catch (_) {}
        btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
        btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
        btn.click();
      }

      // Instantly await portal dispatch notification with 45s safety ceiling for slow connections
      const dispatched = await waitDispatched(45000);
      const tEnd = performance.now();

      const outFilename = (dispatched && dispatched.filename)
        ? dispatched.filename
        : buildOfficial2bFilename(period, activeGstin, captureType === 'PDF' ? 'pdf' : 'xlsx');
      console.log(`[2B Inject] ✓ Official GSTR-2B ${captureType} download dispatched for ${period}: ${outFilename}`);

      let b64 = capture.base64;
      if (!b64 && capture.blob) {
        try {
          const dataUrl = await blobToDataUrl(capture.blob);
          b64 = (dataUrl || '').split(',')[1];
        } catch (_) {}
      }

      sendResult({
        requestId,
        success: true,
        filename: outFilename,
        base64: b64 || null,
        mimeType: captureType === 'PDF' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        gstin: activeGstin,
        period,
        captureType,
        officialDownload: true,
        metrics: {
          findButtonMs: Math.round(tFound - tStart),
          renderMs: Math.round(tEnd - tFound),
          totalMs: Math.round(tEnd - tStart)
        }
      });
    } catch (err) {
      console.error('[2B Inject] Error:', err.message);
      sendResult({ requestId, success: false, error: err.message, captureType });
    }
  }

  window.addEventListener('message', (event) => {
    const d = event.data;
    if (!d || d.__gst2b !== 'INJECT_START') return;
    runCapture(d.requestId, d.period, (d.captureType || 'PDF').toUpperCase(), d.meta || { gstin: d.gstin });
  });

  // Signal ready to bridge / parent
  window.postMessage({ __gst2b: 'INJECT_READY' }, '*');
  console.log('[2B Inject] Ready');
})();