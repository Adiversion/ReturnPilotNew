/* ReturnPilot focused diagnostic v2. Paste into an authorized GST page console.
 * Observes existing activity only. No network requests, storage/cookie/header reads,
 * financial mutations, button automation, remote code or raw payload exports.
 * Stop restores our wrappers when still owned by this recorder. Reload also resets.
 */
(() => {
  'use strict';
  if (globalThis.RP_SAFE_TRACE?.stop) globalThis.RP_SAFE_TRACE.stop();
  if (!/(^|\.)gst\.gov\.in$/i.test(location.hostname)) {
    console.warn('Run this only on your authorized GST portal page.'); return;
  }
  const expectedGstin = (prompt('GSTIN for this diagnostic (kept only in page memory; NOT exported):') || '').trim().toUpperCase();
  const expectedPeriod = (prompt('Selected return period, MMYYYY (example 042026):') || '').trim();
  if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/.test(expectedGstin) ||
      !/^(0[1-9]|1[0-2])20\d{2}$/.test(expectedPeriod)) {
    console.warn('Cancelled: a valid GSTIN and MMYYYY are required. Nothing installed.'); return;
  }

  const events = [], cleanup = [], workbooks = [], hookChecks = [];
  const observedBlobs = new Map();
  const started = performance.now();
  let stopped = false, dropped = 0, pending = 0;
  const MAX_EVENTS = 150;
  const jsonKeys = new Set(('data r3b gstin rtnprd rtn_prd ret_period fp fy finyr fin_year status status_cd error message gendt fc fcRej itcsumm itcavl itcunavl itcRev itcRejected docdata b2b b2ba cdnr cdnra isd isda impg impgsez ecom ecoma sup_details inter_sup itc_elg intr_ltfee tt_val qn bal returnsDbCdredList').split(' '));
  const endpoints = new Set([
    '/gstr2b/auth/api/gstr2b/getuserdtls', '/gstr2b/auth/api/gstr2b/getdata',
    '/gstr2b/auth/api/gstr2b/getjson', '/gstr2b/auth/api/gstr2bq/getdata',
    '/returns/auth/api/formdetails', '/returns/auth/api/gstr3b/getgenpdf',
    '/returns/auth/api/gstr3b/summary', '/returns/auth/api/gstr3b/taxpayble',
    '/returns/auth/api/gstr3b/sysint'
  ]);
  function record(kind, detail = {}) {
    if (stopped) return;
    if (events.length >= MAX_EVENTS) { dropped++; return; }
    events.push({ ms: Math.round(performance.now() - started), kind, ...detail });
  }
  function patch(object, key, make) {
    if (!object || typeof object[key] !== 'function') return;
    const original = object[key];
    const wrapped = make(original);
    try {
      object[key] = wrapped;
      if (object[key] === wrapped) {
        hookChecks.push({ key, active: () => object[key] === wrapped });
        cleanup.push(() => { if (object[key] === wrapped) object[key] = original; });
      } else record('hook-unavailable');
    } catch (_) { record('hook-unavailable'); }
  }
  function endpoint(raw) {
    try {
      const url = new URL(raw, location.href);
      if (!/(^|\.)gst\.gov\.in$/i.test(url.hostname) || !endpoints.has(url.pathname)) return null;
      const period = url.searchParams.get('rtnprd') || url.searchParams.get('rtn_prd') || url.searchParams.get('itcprd');
      return { path: url.pathname, requestPeriodMatches: period ? period === expectedPeriod : null };
    } catch (_) { return null; }
  }
  function schema(value, depth = 0) {
    if (value === null) return 'null';
    if (Array.isArray(value)) return { type: 'array', count: value.length, item: value.length && depth < 3 ? schema(value[0], depth + 1) : null };
    if (typeof value !== 'object') return typeof value;
    if (depth >= 4) return 'object';
    const result = {};
    // Only predefined field NAMES and types: never arbitrary keys or values.
    for (const key of Object.keys(value)) if (jsonKeys.has(key)) result[key] = schema(value[key], depth + 1);
    return result;
  }
  function identity(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const periodKey = ['rtnprd', 'rtn_prd', 'ret_period', 'fp'].find(k => typeof value[k] === 'string');
    return {
      taxpayerPresent: typeof value.gstin === 'string',
      taxpayerMatches: typeof value.gstin === 'string' ? value.gstin.toUpperCase() === expectedGstin : null,
      periodField: periodKey || null,
      periodMatches: periodKey ? value[periodKey] === expectedPeriod : null
    };
  }
  function observeJson(info, status, body) {
    try {
      const value = typeof body === 'string' ? JSON.parse(body) : body;
      if (!value || typeof value !== 'object') { record('api-unparsed', info); return; }
      const identities = {};
      for (const [key, item] of [['root', value], ['data', value.data], ['r3b', value.data?.r3b], ['bal', value.data?.bal]]) identities[key] = identity(item);
      record('api-response', { ...info, httpStatus: status, schema: schema(value), identities,
        businessSuccess: value.status === 1 || value.status === '1',
        errorPresent: !!(value.error || value.status_cd === '0'),
        multipart: { fcPresent: value.data?.fc != null, fcRejPresent: value.data?.fcRej != null } });
    } catch (_) { record('api-unparsed', { ...info, httpStatus: status }); }
  }

  const xhrListeners = new WeakMap();
  patch(XMLHttpRequest.prototype, 'open', original => function (method, url, ...rest) {
    const previous = xhrListeners.get(this);
    if (previous) this.removeEventListener('loadend', previous);
    xhrListeners.delete(this);
    const info = endpoint(url);
    if (info) {
      const listener = () => {
        this.removeEventListener('loadend', listener);
        if (stopped) return;
        try {
          if (this.responseType === 'json') observeJson(info, this.status, this.response);
          else if (!this.responseType || this.responseType === 'text') observeJson(info, this.status, this.responseText);
          else record('api-unparsed', { ...info, httpStatus: this.status });
        } catch (_) { record('api-unparsed', info); }
      };
      xhrListeners.set(this, listener);
      this.addEventListener('loadend', listener);
      cleanup.push(() => this.removeEventListener('loadend', listener));
    }
    return original.call(this, method, url, ...rest);
  });
  patch(globalThis, 'fetch', original => function (input, ...rest) {
    const info = endpoint(typeof input === 'string' || input instanceof URL ? String(input) : input?.url);
    const result = original.call(this, input, ...rest);
    if (info) result.then(response => {
      if (stopped) return;
      pending++;
      try {
        response.clone().text().then(body => { if (!stopped) observeJson(info, response.status, body); }, () => {
          record('api-unparsed', info);
        }).finally(() => { pending--; });
      } catch (_) { pending--; record('api-unparsed', info); }
    }, () => record('api-network-error', info));
    return result; // Preserve the native response/promise and request arguments.
  });

  function matchesFilename(filename) {
    const name = typeof filename === 'string' ? filename : '';
    const gstin = name.match(/\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]/i)?.[0];
    const period = name.match(/(?:^|_)((?:0[1-9]|1[0-2])20\d{2})(?:_|\.|$)/)?.[1];
    return { taxpayerMatches: gstin ? gstin.toUpperCase() === expectedGstin : null,
      periodMatches: period ? period === expectedPeriod : null,
      format: /\.xlsx?$/i.test(name) ? 'EXCEL' : /\.pdf$/i.test(name) ? 'PDF' : 'UNKNOWN' };
  }
  function mime(blob) {
    return /pdf/i.test(blob?.type || '') ? 'PDF' : /spreadsheet|excel/i.test(blob?.type || '') ? 'EXCEL' : 'OTHER';
  }
  patch(URL, 'createObjectURL', original => function (blob) {
    const result = original.apply(this, arguments);
    if (!stopped && blob instanceof Blob) {
      const detail = { bytes: blob.size, format: mime(blob) };
      // Retain metadata only, never blob bytes. Bound memory even if events overflow.
      if (observedBlobs.size >= MAX_EVENTS) observedBlobs.delete(observedBlobs.keys().next().value);
      observedBlobs.set(result, detail);
      record('blob-url-created', detail);
    }
    return result; // Never record blob URLs themselves.
  });
  patch(URL, 'revokeObjectURL', original => function (url) {
    observedBlobs.delete(url);
    return original.apply(this, arguments);
  });
  function anchorDetail(anchor) {
    const blob = observedBlobs.get(anchor.href);
    return { ...matchesFilename(anchor.download),
      observedBlob: !!blob, blobFormat: blob?.format || null, blobBytes: blob?.bytes ?? null };
  }
  patch(HTMLAnchorElement.prototype, 'click', original => function () {
    if (this.download || String(this.href).startsWith('blob:')) record('anchor-click-called', anchorDetail(this));
    return original.apply(this, arguments);
  });
  patch(HTMLAnchorElement.prototype, 'dispatchEvent', original => function (event) {
    const result = original.apply(this, arguments);
    if (event?.type === 'click' && (this.download || String(this.href).startsWith('blob:'))) {
      record('anchor-click-dispatched', { ...anchorDetail(this), cancelled: result === false || event.defaultPrevented });
    }
    return result;
  });

  // A connected anchor can use a previously captured native click/dispatch method.
  // Capture observes that route without replacing handlers or preventing default.
  // This is an observation at capture time, NOT a final cancellation/save verdict.
  let domClickObserverInstalled = false;
  if (typeof document.addEventListener === 'function') {
    const onClick = event => {
      try {
        const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
        const anchor = path.find(node => node instanceof HTMLAnchorElement);
        if (!anchor || !(anchor.download || String(anchor.href).startsWith('blob:'))) return;
        record('anchor-dom-click-observed', { ...anchorDetail(anchor),
          defaultPreventedAtCapture: !!event.defaultPrevented });
      } catch (_) { /* Never interfere with portal events. */ }
    };
    document.addEventListener('click', onClick, true);
    domClickObserverInstalled = true;
    cleanup.push(() => { document.removeEventListener('click', onClick, true); domClickObserverInstalled = false; });
  }

  function cellText(value) {
    if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
    if (Array.isArray(value)) return value.map(cellText).join('');
    return value && typeof value === 'object' ? cellText(value.text) : '';
  }
  function periodMetadata(fyValue, monthValue, gstinValue) {
    const fy = String(fyValue || '').trim();
    const month = String(monthValue || '').trim().toLowerCase();
    const months = ['january','february','march','april','may','june','july','august','september','october','november','december'];
    const expectedMonth = Number(expectedPeriod.slice(0, 2));
    const year = Number(expectedPeriod.slice(2));
    const startYear = expectedMonth >= 4 ? year : year - 1;
    return { taxpayerMatches: gstinValue ? String(gstinValue).trim().toUpperCase() === expectedGstin : null,
      financialYearMatches: fy ? [String(startYear) + '-' + String(startYear + 1).slice(2), String(startYear) + '-' + String(startYear + 1)].includes(fy) : null,
      periodValueShape: months.includes(month) ? 'MONTH_NAME' : /^\d{6}$/.test(month) ? 'SIX_DIGITS' : month ? 'OTHER' : 'EMPTY',
      monthMatches: months.includes(month) ? months.indexOf(month) + 1 === expectedMonth : /^\d{6}$/.test(month) ? month === expectedPeriod : null };
  }
  const patchedPdf = new WeakSet(), patchedExcel = new WeakSet(), patchedSaveAs = new WeakSet();
  function inspectLibraries() {
    const pm = globalThis.pdfMake;
    if (pm && !patchedPdf.has(pm) && typeof pm.createPdf === 'function') {
      patchedPdf.add(pm);
      patch(pm, 'createPdf', original => function (doc) {
        try {
          const headers = {};
          for (const block of (doc?.content || []).slice(0, 6)) for (const row of block?.table?.body || []) {
            if (!Array.isArray(row) || row.length !== 2) continue;
            const label = cellText(row[0]).toLowerCase().replace(/^[\d.\s]+/, '').replace(/[:\s]+/g, ' ').trim();
            if (['year','financial year'].includes(label)) headers.fy = cellText(row[1]);
            if (['month','period'].includes(label)) headers.month = cellText(row[1]);
            if (['gstin','gstin of the supplier'].includes(label)) headers.gstin = cellText(row[1]);
          }
          record('pdf-definition', { contentBlocks: Array.isArray(doc?.content) ? doc.content.length : null,
            identity: periodMetadata(headers.fy, headers.month, headers.gstin) });
        } catch (_) { record('pdf-definition-unparsed'); }
        return original.apply(this, arguments);
      });
    }
    const proto = globalThis.ExcelJS?.Workbook?.prototype;
    if (proto && !patchedExcel.has(proto) && typeof proto.addWorksheet === 'function') {
      patchedExcel.add(proto);
      patch(proto, 'addWorksheet', original => function (name) {
        const result = original.apply(this, arguments);
        if (!workbooks.includes(this) && workbooks.length < 4) workbooks.push(this);
        record('worksheet-created', { role: name === 'Read me' ? 'IDENTITY' : 'OTHER' });
        return result;
      });
    }
    if (typeof globalThis.saveAs === 'function' && !patchedSaveAs.has(globalThis.saveAs)) {
      patch(globalThis, 'saveAs', original => function (blob, filename) {
        record('saveAs-called', { ...matchesFilename(filename), bytes: blob instanceof Blob ? blob.size : null, blobFormat: mime(blob) });
        return original.apply(this, arguments);
      });
      patchedSaveAs.add(globalThis.saveAs);
    }
  }
  inspectLibraries();
  const poll = setInterval(inspectLibraries, 500);
  cleanup.push(() => clearInterval(poll));

  function stop() {
    if (stopped) return;
    stopped = true;
    cleanup.reverse().forEach(fn => { try { fn(); } catch (_) {} });
    workbooks.length = 0;
    observedBlobs.clear();
    console.info('ReturnPilot diagnostic stopped. Reload the page before another clean recording.');
  }
  function exportReport() {
    const workbookChecks = workbooks.map(book => {
      try {
        const sheet = book.getWorksheet('Read me');
        return { readMePresent: !!sheet, identity: sheet ? periodMetadata(sheet.getCell('C4').value, sheet.getCell('C5').value, sheet.getCell('C6').value) : null };
      } catch (_) { return { readMePresent: false, inspectionFailed: true }; }
    });
    const report = {
      recorder: 'ReturnPilot safe download diagnostic v2',
      portal: location.hostname === 'gstr2b.gst.gov.in' ? 'GSTR2B' : 'GST_OTHER',
      userReportsFileSaved: confirm('Did the expected PDF/Excel finish saving in the browser? Cancel means no/not sure.'),
      browserCompletionObserved: false,
      pendingFetchResponseReads: pending, droppedEvents: dropped,
      coverage: {
        frameContext: globalThis.top === globalThis ? 'TOP' : 'CHILD_OR_UNKNOWN',
        domClickObserverInstalled,
        hooks: hookChecks.map(hook => ({ method: hook.key, active: hook.active() })),
        pdfLibraryObserved: !!globalThis.pdfMake, globalExcelLibraryAvailable: !!globalThis.ExcelJS,
        note: 'Webpack-private services/workbooks, requests before installation, iframe activity and browser DownloadItem states may not be visible.' },
      workbookChecks, events: events.slice()
    };
    stop(); // Do not record our own report download.
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = 'returnpilot-safe-trace.json';
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return 'Report exported. Review it before sharing. No raw response values, identifiers or headers are included.';
  }
  globalThis.RP_SAFE_TRACE = Object.freeze({ export: exportReport, stop });
  console.info('Recorder ready. Perform ONE normal PDF or Excel download, then run RP_SAFE_TRACE.export(). To stop without export: RP_SAFE_TRACE.stop(). Reload before the next recording.');
})();
