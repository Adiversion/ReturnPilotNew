'use strict';

(function () {
  if (window.__gstInjectReady) return;
  window.__gstInjectReady = true;

  console.log('[Inject] Loaded on:', location.href);

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // ── Communication ──
  const sendResult = (payload) => {
    window.postMessage({ __gst: 'INJECT_RESULT', ...payload }, '*');
  };

  // Signal ready IMMEDIATELY — don't wait for Angular
  window.postMessage({ __gst: 'INJECT_READY' }, '*');

  // ── PDF Capture (per-request isolation) ──
  let dispatched = false;
  let dispatchedFilename = null;
  const dispatchResolvers = [];

  function resetDispatch() {
    dispatched = false;
    dispatchedFilename = null;
    dispatchResolvers.length = 0;
  }

  function notifyDispatched(fn) {
    if (!dispatched) {
      dispatched = true;
      dispatchedFilename = fn || null;
      dispatchResolvers.splice(0).forEach(r => r(fn));
    }
  }

  function waitDispatched(ms = 25000) {
    return new Promise((resolve) => {
      if (dispatched) return resolve(dispatchedFilename);
      const timer = setTimeout(() => resolve(dispatchedFilename), ms);
      dispatchResolvers.push((fn) => {
        clearTimeout(timer);
        resolve(fn);
      });
    });
  }

  function installPdfHook() {
    if (!window.pdfMake || window.pdfMake.__hooked) return false;
    const orig = window.pdfMake.createPdf;
    window.pdfMake.createPdf = function (dd) {
      const pdfObj = orig.apply(this, arguments);
      const origDl = pdfObj.download ? pdfObj.download.bind(pdfObj) : null;
      pdfObj.download = function (fn) {
        console.log('[ReturnPilot GSTR1A] Official portal pdfMake download triggered:', fn);
        notifyDispatched(fn);
        if (origDl) return origDl(fn); // Entity 1: Never suppress!
      };
      return pdfObj;
    };
    window.pdfMake.__hooked = true;
    console.log('[Inject] pdfMake hooked');
    return true;
  }

  // Start polling for pdfMake immediately
  if (!installPdfHook()) {
    let n = 0;
    const poll = setInterval(() => {
      if (installPdfHook() || ++n > 300) clearInterval(poll);
    }, 20);
  }

  // ── Angular helpers ──
  function getInjector() {
    if (!window.angular) return null;
    try { return window.angular.element(document.body).injector(); } catch (_) { return null; }
  }

  async function waitAngular(maxMs = 15000) {
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
      const inj = getInjector();
      if (inj) {
        try { inj.get('$rootScope'); return inj; } catch (_) {}
      }
      await sleep(20);
    }
    throw new Error('Angular not ready');
  }

  async function waitController(name, maxMs = 20000) {
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
      try {
        const inj = getInjector();
        if (inj?.get('$route')?.current?.controller === name) return inj;
      } catch (_) {}
      await sleep(20);
    }
    throw new Error(`Controller ${name} timeout`);
  }

  async function waitButton(ngClicks, textLabels = [], maxMs = 15000) {
    const clicks = Array.isArray(ngClicks) ? ngClicks : [ngClicks];
    const labels = Array.isArray(textLabels) ? textLabels.map(l => l.toUpperCase()) : [];

    const findMatch = () => {
      const buttons = document.querySelectorAll('button, a, [role="button"], input[type="button"]');
      for (const b of buttons) {
        const nc = (b.getAttribute('data-ng-click') || b.getAttribute('ng-click') || '').trim();
        for (const click of clicks) {
          if (nc && (nc === click || nc.includes(click) || click.includes(nc))) {
            const s = window.getComputedStyle(b);
            if (s.display !== 'none' && s.visibility !== 'hidden' && !b.disabled) return b;
          }
        }
      }
      for (const b of buttons) {
        const text = (b.innerText || b.textContent || b.value || '').trim().toUpperCase().replace(/\s+/g, ' ');
        for (const lbl of labels) {
          if (text.includes(lbl)) {
            const s = window.getComputedStyle(b);
            if (s.display !== 'none' && s.visibility !== 'hidden' && !b.disabled) return b;
          }
        }
      }
      return null;
    };

    const immediate = findMatch();
    if (immediate) return immediate;

    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
      const match = findMatch();
      if (match) return match;
      await sleep(30);
    }
    throw new Error(`Button matching [${clicks.concat(labels).join(', ')}] not found`);
  }

  async function waitSumryData(maxMs = 12000) {
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
      try {
        const $rs = getInjector()?.get('$rootScope');
        const seen = new WeakSet();
        let found = false;
        (function walk(s, d) {
          if (!s || d > 20 || found || seen.has(s)) return;
          seen.add(s);
          if (s.sumryData && Object.keys(s.sumryData).length > 0) { found = true; return; }
          walk(s.$$childHead, d + 1);
          walk(s.$$nextSibling, d + 1);
        })($rs, 0);
        if (found) return 'ready';
      } catch (_) {}
      await sleep(20);
    }
    return 'timeout';
  }

  // ── Hydration ──
  function hydrate(meta) {
    const updates = {
      gstin: meta.gstin, main_page_gstin: meta.gstin,
      rtn_prd: meta.period, retprd: meta.period, fp: meta.period,
      fy: meta.fy, disyear: meta.fy, fin_year: meta.fy, financial_year: meta.fy,
      business_name: meta.lgnm, legal_name: meta.lgnm, lgnm: meta.lgnm, bname: meta.lgnm,
      trade_name: meta.trdnm, trdnm: meta.trdnm,
      approval_dt: meta.fil_dt, apprv_dt: meta.fil_dt,
      arn: meta.arn, arnnum: meta.arn, arndt: meta.fil_dt,
      arn_date: meta.fil_dt, arndate: meta.fil_dt, fil_dt: meta.fil_dt,
      fil_stat: meta.status, status: meta.status,
      isSubmitted: meta.status === 'FIL' ? 'Y' : 'N',
      isnil: meta.isnil || 'N',
      IFF: false, IFFsub: true, IFFfile: true,
      gstinsezTyp: '', regEndDate: '',
      uPref: meta.uPref || 'M', utype: 'NT', userType: 'NT',
      gstrtyp: 'GSTR1A', form_type: 'GSTR1A', formname: 'GSTR1A', rtn_typ: 'GSTR1A',
      cnf_status: meta.cnf_status || ''
    };
    const inj = getInjector();
    if (!inj) return;
    try { const sd = inj.get('shareData'); if (sd) Object.assign(sd, updates); } catch (_) {}
    try {
      const $rs = inj.get('$rootScope');
      const seen = new WeakSet();
      (function walk(s, d) {
        if (!s || d > 25 || seen.has(s)) return;
        seen.add(s);
        Object.assign(s, updates);
        walk(s.$$childHead, d + 1);
        walk(s.$$nextSibling, d + 1);
      })($rs, 0);
      $rs.$evalAsync();
    } catch (_) {}
  }

  function hydrateButtonScope(btn, meta) {
    try {
      const bs = window.angular.element(btn).scope();
      if (bs) {
        Object.assign(bs, {
          main_page_gstin: meta.gstin, gstin: meta.gstin,
          legal_name: meta.lgnm, business_name: meta.lgnm,
          lgnm: meta.lgnm, bname: meta.lgnm,
          trade_name: meta.trdnm, trdnm: meta.trdnm,
          arn: meta.arn, arnnum: meta.arn,
          arndt: meta.fil_dt, fil_dt: meta.fil_dt,
          fin_year: meta.fy, disyear: meta.fy, fy: meta.fy,
          fil_stat: meta.status, status: meta.status,
          retprd: meta.period, rtn_prd: meta.period, fp: meta.period,
          uPref: meta.uPref || 'M', cnf_status: meta.cnf_status || ''
        });
        bs.$evalAsync();
      }
    } catch (_) {}
  }

  function setLS(meta) {
    ['rtn_prd', 'ret_period', 'retPeriod', 'returnPeriod', 'tax_period', 'taxperiod', 'rtn_prd_r7']
      .forEach(k => localStorage.setItem(k, meta.period));
    if (meta.fy) {
      localStorage.setItem('fin_year', meta.fy);
      localStorage.setItem('disyear', meta.fy);
    }
    if (meta.gstin) localStorage.setItem('gstin', meta.gstin);
    localStorage.setItem('formname', 'GSTR1A');
    localStorage.setItem('rtn_typ', 'GSTR1A');
    localStorage.setItem('stat', meta.status === 'FIL' ? 'RTF' : 'RTS');
    if (meta.lgnm) localStorage.setItem('lglname', meta.lgnm);
    if (meta.trdnm) localStorage.setItem('trdnm', meta.trdnm);
    if (meta.uPref) localStorage.setItem('uPref', meta.uPref);
    if (meta.cnf_status) localStorage.setItem('cnf_status', meta.cnf_status);
  }

  // ── Track if we already routed + loaded summary ──
  // ── Track if we already routed + loaded summary ──
  let currentPeriod = null;
  let sumReady = false;

  // ── Main capture ──
  async function runCapture(requestId, period, pdfType, meta) {
    console.log(`[Inject] Capture: ${period} ${pdfType}`);
    resetDispatch();

    try {
      const isQ = meta?.uPref === 'Q';
      const isCon = pdfType === 'CONSOLIDATED';
      const ngClicks = isCon
        ? [isQ ? 'genrateQtrPdfNew()' : 'genratepdfNew()', 'genrateQtrPdfNew()', 'generatepdfNew()', 'genratepdf()']
        : ['generateGSTR1APdf()', 'generateGSTR1APdf', 'generateGstr1aPdf()', 'downloadGSTR1APdf()'];
      const textLabels = isCon
        ? ['DOWNLOAD CONSOLIDATED SUMMARY (PDF)', 'DOWNLOAD CONSOLIDATED (PDF)', 'CONSOLIDATED SUMMARY', 'CONSOLIDATED']
        : ['DOWNLOAD GSTR-1A SUMMARY (PDF)', 'DOWNLOAD GSTR-1A (PDF)', 'DOWNLOAD GSTR1A (PDF)', 'GSTR-1A SUMMARY', 'GSTR-1A'];

      // Wait for Angular (may already be ready)
      await waitAngular();

      // Ensure pdfMake is hooked
      installPdfHook();

      // Set localStorage + hydrate (always — meta may differ between requests)
      setLS(meta);
      hydrate(meta);

      const inj = getInjector();
      const loc = inj?.get('$location');
      const currentPath = loc?.path() || '';

      // Route to gstr1sum only if not already on that path or if period changed
      if (currentPeriod !== period || !currentPath.includes('gstr1sum')) {
        currentPeriod = period;
        sumReady = false;

        if (!currentPath.includes('gstr1sum')) {
          console.log('[Inject] Routing to /auth/gstr1a/gstr1sum');
          try {
            inj.get('$rootScope').$apply(() => {
              loc.path('/auth/gstr1a/gstr1sum');
            });
          } catch (_) {}
          await waitController('gstr1Ptfctrl', 15000).catch(() => {});
        } else {
          console.log('[Inject] Already on gstr1sum');
        }

        // Re-hydrate after route change
        hydrate(meta);
      }

      // Fast check for sumryData (stays ready on warm page)
      if (!sumReady) {
        const sumStatus = await waitSumryData(8000);
        console.log(`[Inject] sumryData: ${sumStatus}`);
        if (sumStatus === 'ready') sumReady = true;
      }

      // Find button + hydrate its scope + click
      const btn = await waitButton(ngClicks, textLabels, 10000);
      hydrateButtonScope(btn, meta);
      resetDispatch();
      btn.click();

      // Wait for official download dispatch
      const capturedFn = await waitDispatched(25000);
      await sleep(50);

      let outFilename = capturedFn || (isCon ? `GSTR1and1A_${meta.gstin}_${period}.pdf` : `GSTR1A_${meta.gstin}_${period}.pdf`);
      if (!outFilename.toLowerCase().endsWith('.pdf')) {
        outFilename += '.pdf';
      }

      sendResult({
        requestId,
        success: true,
        filename: outFilename,
        pdfType,
        officialDownload: true
      });
    } catch (err) {
      console.error('[Inject] Error:', err.message);
      sendResult({ requestId, success: false, error: err.message, pdfType });
    }
  }

  // ── Listen for jobs ──
  window.addEventListener('message', (event) => {
    const d = event.data;
    if (!d || typeof d !== 'object') return;
    if (d.__gst === 'INJECT_PING') {
      window.postMessage({ __gst: 'INJECT_PONG' }, '*');
      return;
    }
    if (d.__gst === 'INJECT_START') {
      runCapture(d.requestId, d.period, d.pdfType, d.meta || {});
    }
  });

  console.log('[Inject] Ready');
})();