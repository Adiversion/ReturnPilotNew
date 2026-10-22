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
  let frameJob = null;
  let captureStarted = false;
  let captureArmed = false;
  let clearOutputReferences = () => {};

  // Initialize immediately from window.name metadata payload if present
  try {
    const nameMatch = (window.name || '').match(/__gst2b_(\d+)__meta=(.+)$/);
    if (nameMatch) {
      const meta = JSON.parse(decodeURIComponent(nameMatch[2]));
      frameJob = meta;
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

  // ── Observed native anchor dispatch (not browser download completion) ──
  let isDispatched = false;
  let dispatchedPayload = null;
  const dispatchResolvers = [];

  function resetDispatch() {
    isDispatched = false;
    dispatchedPayload = null;
    dispatchResolvers.length = 0;
  }

  function notifyDispatched(filename, type) {
    if (!captureArmed || type !== activeCaptureType) return;
    if (!isDispatched) {
      isDispatched = true;
      dispatchedPayload = { filename, type };
      dispatchResolvers.splice(0).forEach(r => r(dispatchedPayload));
    }
  }

  function waitDispatched(ms = 15000) {
    return new Promise((resolve, reject) => {
      if (isDispatched) return resolve(dispatchedPayload);
      const onDispatch = (val) => {
        clearTimeout(timer);
        resolve(val);
      };
      const timer = setTimeout(() => {
        const index = dispatchResolvers.indexOf(onDispatch);
        if (index !== -1) dispatchResolvers.splice(index, 1);
        reject(new Error('GSTR-2B native download was not observed before timeout'));
      }, ms);
      dispatchResolvers.push(onDispatch);
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

      return orig.call(this, docDefinition);
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

  function hookUrlAndAnchor() {
    if (window.URL.__hooked2b) return;

    const origCreateObjectURL = window.URL.createObjectURL;
    const blobUrlMap = new Map();
    clearOutputReferences = () => blobUrlMap.clear();

    window.URL.createObjectURL = function (obj) {
      const url = origCreateObjectURL.apply(this, arguments);
      if (captureArmed && obj instanceof Blob && obj.size > 0) {
        // Retain bytes only until settlement. Object URL creation alone is not
        // evidence that a download was dispatched.
        blobUrlMap.set(url, obj);
      }
      return url;
    };

    function observeAnchor(anchor) {
      if (!captureArmed) return;
      const blob = blobUrlMap.get(anchor.href || '');
      if (!blob || !blob.size) return;
      const filename = anchor.download || anchor.getAttribute('download') || '';
      const mime = (blob.type || '').toLowerCase();
      const namedType = /\.pdf$/i.test(filename) ? 'PDF' : /\.xlsx?$/i.test(filename) ? 'EXCEL' : null;
      const mimeType = mime.includes('pdf') ? 'PDF'
        : /spreadsheet|excel|officedocument/.test(mime) ? 'EXCEL' : null;
      // Do not reinterpret HTML/error payloads or mismatched formats as a file.
      if (mime && !mimeType && !['application/octet-stream', 'application/zip'].includes(mime)) return;
      if (mimeType && namedType && mimeType !== namedType) return;
      const type = mimeType || namedType;
      if (type !== activeCaptureType) return;
      notifyDispatched(filename || buildOfficial2bFilename(activePeriod, activeGstin, type === 'PDF' ? 'pdf' : 'xlsx'), type);
      blobUrlMap.clear();
    }

    const origAnchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      const result = origAnchorClick.apply(this, arguments);
      observeAnchor(this);
      return result;
    };
    // FileSaver commonly dispatches a synthetic MouseEvent rather than .click().
    const origDispatchEvent = HTMLAnchorElement.prototype.dispatchEvent;
    HTMLAnchorElement.prototype.dispatchEvent = function (event) {
      const result = origDispatchEvent.apply(this, arguments);
      if (event?.type === 'click' && result !== false && !event.defaultPrevented) observeAnchor(this);
      return result;
    };

    window.URL.__hooked2b = true;
  }

  function installHooks() {
    hookPdfMake();
    hookXlsx();
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
            const blocked = el.disabled || el.getAttribute?.('aria-disabled') === 'true' || el.getAttribute?.('aria-busy') === 'true';
            const wrongFormat = activeCaptureType === 'PDF' && text.includes('EXCEL');
            if (style.display !== 'none' && style.visibility !== 'hidden' && !blocked && !wrongFormat) {
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
          clearInterval(interval);
          reject(new Error(`Button matching [${textPatterns.join(', ')}] not found`));
        }
      }, maxMs);

      const check = () => {
        const match = findMatch();
        if (match && !settled) {
          settled = true;
          clearTimeout(timeout);
          observer.disconnect();
          clearInterval(interval);
          resolve(match);
        }
      };

      const observer = new MutationObserver(check);
      observer.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['disabled', 'style', 'class', 'aria-disabled', 'aria-busy']
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

      // Patch scopes again right before click
      patchAngularScope(activeFinYear);

      captureArmed = true;

      // Robust Angular & DOM event dispatching
      try { btn.focus(); } catch (_) {}
      btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
      btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
      btn.click();

      // Require a matching blob anchor activation, not a generation-function call.
      const dispatched = await waitDispatched(45000);
      const tEnd = performance.now();

      const outFilename = (dispatched && dispatched.filename)
        ? dispatched.filename
        : buildOfficial2bFilename(period, activeGstin, captureType === 'PDF' ? 'pdf' : 'xlsx');
      console.log(`[2B Inject] ✓ Official GSTR-2B ${captureType} download dispatched for ${period}: ${outFilename}`);

      sendResult({
        requestId,
        success: true,
        filename: outFilename,
        gstin: activeGstin,
        period,
        captureType,
        officialDownload: true,
        downloadStage: 'NATIVE_ANCHOR_DISPATCHED',
        metrics: {
          findButtonMs: Math.round(tFound - tStart),
          renderMs: Math.round(tEnd - tFound),
          totalMs: Math.round(tEnd - tStart)
        }
      });
    } catch (err) {
      console.error('[2B Inject] Error:', err.message);
      sendResult({ requestId, success: false, error: err.message, captureType });
    } finally {
      captureArmed = false;
      clearOutputReferences();
      clearInterval(hookPoll);
      resetDispatch();
    }
  }

  window.addEventListener('message', (event) => {
    const d = event.data;
    if (!d || d.__gst2b !== 'INJECT_START') return;
    // Fresh operation-owned frame: only its creating parent may start it, once.
    if (!frameJob || window === window.parent || event.source !== window.parent ||
        event.origin !== frameJob.parentOrigin || !frameJob.requestId ||
        d.requestId !== frameJob.requestId || d.period !== frameJob.period ||
        d.captureType !== frameJob.captureType || d.meta?.gstin !== frameJob.gstin ||
        captureStarted) return;
    captureStarted = true;
    runCapture(d.requestId, d.period, (d.captureType || 'PDF').toUpperCase(), d.meta || { gstin: d.gstin });
  });

  // Signal ready to bridge / parent
  window.postMessage({ __gst2b: 'INJECT_READY' }, '*');
  console.log('[2B Inject] Ready');
})();