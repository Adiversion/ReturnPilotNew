// ═══════════════════════════════════════════════════════════════════
//  ReturnPilot — GSTR-1 MAIN WORLD NATIVE ENGINE (v7.5)
//  Fresh-Per-Period Isolation with Dual Storage & Instant Blob Capture
// ═══════════════════════════════════════════════════════════════════

'use strict';

(function () {
  if (window.__gstr1_inject_initialized) return;
  window.__gstr1_inject_initialized = true;

  const DLog = (m, ...args) => {
    console.log(`%c[GSTR1-Inject @ ${new Date().toLocaleTimeString()}] ${m}`, 'color:#8b5cf6;font-weight:bold;', ...args);
  };
  DLog('Loaded on URL:', location.href);

  const CFG = Object.freeze({
    IFRAME_LOAD_MS:     30000,
    ANGULAR_READY_MS:   15000,
    ANGULAR_POLL_MS:       15,
    SHAREDATA_MS:       12000,
    BUTTON_MS:          35000,
    CAPTURE_MS:         45000,
    ROUTE_SETTLE_MS:        0,
    MIN_PDF_BYTES:      10000,
  });

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  let currentIframe = null;

  // ── Dual Storage (localStorage & sessionStorage) Snapshot & Restore ──
  const STORAGE_KEYS = [
    'rtn_prd','ret_period','retPeriod','returnPeriod','return_period',
    'tax_period','taxperiod','rtn_prd_r7',
    'fin_year','disyear','gstin','formname','rtn_typ',
    'stat','lglname','uPref','IFF','IFFoffline','utype','fp','arn'
  ];

  const takeSnapshot = () => {
    const ls = {};
    const ss = {};
    STORAGE_KEYS.forEach(k => {
      try { ls[k] = localStorage.getItem(k); } catch (_) {}
      try { ss[k] = sessionStorage.getItem(k); } catch (_) {}
    });
    return { ls, ss };
  };

  const restoreSnapshot = (snap) => {
    if (!snap) return;
    if (snap.ls) {
      Object.entries(snap.ls).forEach(([k, v]) => {
        try {
          if (v === null) localStorage.removeItem(k);
          else localStorage.setItem(k, v);
        } catch (_) {}
      });
    }
    if (snap.ss) {
      Object.entries(snap.ss).forEach(([k, v]) => {
        try {
          if (v === null) sessionStorage.removeItem(k);
          else sessionStorage.setItem(k, v);
        } catch (_) {}
      });
    }
  };

  const isMonth3 = fp => (parseInt(fp.slice(0, 2), 10) % 3 === 0);

  const writeDualStorage = (period, d, userPref) => {
    const isIFF = (userPref === 'Q') && !isMonth3(period);
    const storages = [localStorage, sessionStorage];

    storages.forEach(store => {
      if (!store) return;
      ['rtn_prd','ret_period','retPeriod','returnPeriod',
       'return_period','tax_period','taxperiod','rtn_prd_r7','fp']
        .forEach(k => {
          try { store.setItem(k, period); } catch (_) {}
        });
      try {
        if (d.fy) {
          store.setItem('fin_year', d.fy);
          store.setItem('disyear', d.fy);
        }
        if (d.gstin) store.setItem('gstin', d.gstin);
        store.setItem('formname',   'GSTR1');
        store.setItem('rtn_typ',    'GSTR1');
        store.setItem('utype',      'TP');
        store.setItem('stat',       d.status === 'FIL' ? 'RTF' : 'RTS');
        store.setItem('lglname',    d.ln || d.bn || '');
        store.setItem('IFF',        String(isIFF));
        store.setItem('IFFoffline', 'false');
        if (userPref) store.setItem('uPref', userPref);
        if (d.arn) store.setItem('arn', d.arn);
      } catch (_) {}
    });
  };

  // ── Variant Detection ──
  const detectVariant = (d, userPref) => {
    const isIFF = (userPref === 'Q') && !isMonth3(d.fp);
    if (d.isSubmitted === 'Y') return {
      strategy: 'V3_OLD', targetPath: '/auth/gstr1',
      ngClick: 'getSummary()', btnExact: true, isIFF: false,
    };
    if (d.isnil === 'Y') return {
      strategy: isIFF ? 'V2_NIL_IFF' : 'V2_NIL',
      targetPath: '/auth/gstr1',
      ngClick: 'generateNILGstr1Pdf()', btnExact: false, isIFF,
    };
    return {
      strategy: isIFF ? 'V1_IFF' : 'V1_NEW',
      targetPath: '/auth/gstr1/gstr1sum',
      ngClick: 'genratepdfNew()', btnExact: false, isIFF,
    };
  };

  // ── Direct ShareData Hydration ──
  const hydrateShareData = (sd, d, userPref, variant) => {
    if (!sd) return;
    Object.assign(sd, {
      gstin: d.gstin,
      main_page_gstin: d.gstin,
      rtn_prd: d.fp,
      retprd: d.fp,
      fp: d.fp,
      fy: d.fy,
      fm: d.fm,
      disyear: d.fy,
      business_name: d.bn || d.ln,
      trade_name: d.tn,
      lgnm: d.ln || d.bn,
      approval_dt: d.apprv_dt || d.fil_dt || '',
      apprv_dt: d.apprv_dt || d.fil_dt || '',
      fil_stat: d.status,
      status: d.status,
      isSubmitted: d.isSubmitted || (d.status === 'FIL' ? 'Y' : 'N'),
      isnil: d.isnil || 'N',
      isNilFilAllowed: d.isNilFilAllowed || [],
      due_date: d.due_dt,
      due_dt: d.due_dt,
      evc_chk: d.evc_chk,
      authname: d.auth_name,
      auth_name: d.auth_name,
      authdg: d.auth_dg,
      auth_dg: d.auth_dg,
      arnnum: d.arn,
      arn: d.arn,
      arndt: d.fil_dt,
      fil_dt: d.fil_dt,
      isGstpUser: d.isGstp,
      isGstp: d.isGstp,
      sumGenStatus: d.sumGenStatus,
      IFF: !!variant.isIFF,
      IFFsub: !variant.isIFF,
      IFFfile: !variant.isIFF,
      gstr1IFF: d.gstr1IFF,
      gstinsezTyp: '',
      regEndDate: '',
      uPref: userPref || 'M',
      utype: 'TP',
      userType: 'TP',
      gstrtyp: 'GSTR1',
      form_type: 'GSTR1',
      formname: 'GSTR1'
    });
  };



  const createCleanIframe = async () => {
    cleanupIframe();
    const existing = document.getElementById('rp_gstr1_clean_iframe');
    if (existing) {
      try { existing.remove(); } catch (_) {}
    }

    const f = document.createElement('iframe');
    f.id = 'rp_gstr1_clean_iframe';
    f.src = 'https://return.gst.gov.in/returns/auth/gstr1';
    f.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1024px;height:768px;border:0;visibility:hidden;opacity:0;pointer-events:none;z-index:-1;';
    f.setAttribute('aria-hidden', 'true');
    document.body.appendChild(f);
    currentIframe = f;

    await new Promise((res, rej) => {
      f.onload = res;
      f.onerror = rej;
      setTimeout(() => rej(new Error('iframe timeout')), CFG.IFRAME_LOAD_MS);
    });

    const t = Date.now();
    while (Date.now() - t < CFG.ANGULAR_READY_MS) {
      try {
        const iw = f.contentWindow;
        if (iw?.angular) {
          const rootEl = f.contentDocument?.querySelector('[ng-app]') || f.contentDocument?.querySelector('.ng-scope') || f.contentDocument?.body;
          if (rootEl && iw.angular.element(rootEl).injector()) {
            break;
          }
        }
      } catch (_) {}
      await sleep(CFG.ANGULAR_POLL_MS);
    }

    return f;
  };

  const cleanupIframe = () => {
    if (currentIframe) {
      try { currentIframe.remove(); } catch (_) {}
      currentIframe = null;
    }
  };

  const scheduleCleanupIframe = () => {
    const toRemove = currentIframe;
    currentIframe = null;
    if (toRemove) {
      setTimeout(() => {
        try { toRemove.remove(); } catch (_) {}
      }, 6000);
    }
  };

  // ── Button Finder ──
  const waitForButton = (idoc, iw, variant) =>
    new Promise(resolve => {
      const { ngClick, btnExact } = variant;
      const bare = ngClick.replace('()', '');

      const isMatch = b => {
        const attr = b.getAttribute('ng-click') ||
                     b.getAttribute('data-ng-click') || '';
        const hit = btnExact
          ? (attr === ngClick || attr === bare)
          : (attr === ngClick || attr === bare || attr.startsWith(bare + '('));
        if (!hit) return false;
        const s = iw.getComputedStyle(b);
        return s.display !== 'none' && s.visibility !== 'hidden';
      };

      for (const b of idoc.querySelectorAll('[ng-click],[data-ng-click]'))
        if (isMatch(b)) return resolve(b);

      const ob = new iw.MutationObserver(mutations => {
        for (const m of mutations) {
          if (m.type === 'attributes') {
            if (m.target.getAttribute?.('ng-click') ||
                m.target.getAttribute?.('data-ng-click')) {
              if (isMatch(m.target)) {
                ob.disconnect(); clearTimeout(tid); resolve(m.target);
              }
            }
            continue;
          }
          for (const n of m.addedNodes) {
            if (n.nodeType !== 1) continue;
            const candidates = [];
            if (n.matches?.('[ng-click],[data-ng-click]')) candidates.push(n);
            n.querySelectorAll?.('[ng-click],[data-ng-click]')
              .forEach(b => candidates.push(b));
            for (const b of candidates)
              if (isMatch(b)) {
                ob.disconnect(); clearTimeout(tid); resolve(b);
              }
          }
        }
      });

      ob.observe(idoc.body, {
        childList:       true,
        subtree:         true,
        attributes:      true,
        attributeFilter: ['style', 'class', 'ng-click', 'data-ng-click'],
      });

      const tid = setTimeout(() => {
        ob.disconnect();
        // Fallback scan
        const KEYWORDS = ['genrate','generate','pdf','Pdf','PDF','download','summary','Summary'];
        for (const b of idoc.querySelectorAll('[ng-click],[data-ng-click]')) {
          const attr = b.getAttribute('ng-click') || b.getAttribute('data-ng-click') || '';
          if (KEYWORDS.some(kw => attr.includes(kw))) {
            const s = iw.getComputedStyle(b);
            if (s.display !== 'none' && s.visibility !== 'hidden') {
              return resolve(b);
            }
          }
        }
        resolve(null);
      }, CFG.BUTTON_MS);
    });

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  // ── Core GSTR-1 Runner ──
  async function downloadOne(period, targetMeta = {}) {
    const t0   = Date.now();
    const snap = takeSnapshot();
    DLog(`Starting clean isolated GSTR-1 PDF generation for period: ${period}`);

    let d, roleData;
    try {
      const [fdRes, roleRes] = await Promise.all([
        fetch(`/returns/auth/api/formdetails?rtn_prd=${encodeURIComponent(period)}&rtn_typ=GSTR1`, { credentials: 'same-origin' }).then(r => r.json()),
        fetch(`/returns/auth/api/rolestatus?rtn_prd=${encodeURIComponent(period)}`, { credentials: 'same-origin' }).then(r => r.json()).catch(() => ({}))
      ]);
      if (fdRes.status !== 1) throw new Error('formdetails API status != 1');
      d = fdRes.data;
      roleData = roleRes.data || {};
    } catch(e) {
      DLog(`API failed for ${period}:`, e.message);
      return { success: false, error: e.message };
    }

    if (d.status !== 'FIL') {
      DLog(`Period ${period} is not filed (${d.status}) — skipping.`);
      return { success: false, skipped: true, error: `Not filed (${d.status})`, period };
    }

    const userPref = roleData?.userPref || localStorage.getItem('uPref') || 'M';
    const variant  = detectVariant(d, userPref);
    DLog(`Detected variant for ${period}: ${variant.strategy} (target: ${variant.targetPath})`);

    // 1. Write dual storage before creating iframe
    writeDualStorage(period, d, userPref);

    let f;
    try {
      // 2. Create fresh isolated iframe for this specific period
      f = await createCleanIframe();
    } catch(e) {
      restoreSnapshot(snap);
      DLog('iframe creation error:', e.message);
      return { success: false, error: e.message };
    }

    try {
      const iw   = f.contentWindow;
      const idoc = f.contentDocument;

      const rootEl = idoc.querySelector('[ng-app]') || idoc.querySelector('.ng-scope') || idoc.body;
      const inj = iw.angular.element(rootEl).injector();
      const $rootScope = inj.get('$rootScope');
      const $location = inj.get('$location');
      const shareData = inj.has('shareData') ? inj.get('shareData') : null;

      // 3. Hydrate shareData directly
      hydrateShareData(shareData, d, userPref, variant);

      // 4. Navigate directly to target route
      if (variant.targetPath && $location.path() !== variant.targetPath) {
        $rootScope.$apply(() => {
          $location.path(variant.targetPath);
        });
      }

      // 5. Wait for pending HTTP requests (summary API for the month)
      if (inj.has('$http')) {
        const $http = inj.get('$http');
        const netStart = Date.now();
        while (Date.now() - netStart < 45000) {
          if (!$http.pendingRequests || $http.pendingRequests.length === 0) break;
          await sleep(15);
        }
      }

      // 6. Find button via MutationObserver
      const btn = await waitForButton(idoc, iw, variant);
      if (!btn) {
        throw new Error(`Download button ${variant.ngClick} not found`);
      }

      // ── Non-intrusive Dispatch Observer (Zero UI lag, instant resolution) ──
      let dispatched = false;
      let dispatchedFilename = null;
      let dispatchResolver = null;
      const dispatchPromise = new Promise(res => { dispatchResolver = res; });

      const onDispatched = (fn) => {
        if (!dispatched) {
          dispatched = true;
          dispatchedFilename = fn || null;
          if (dispatchResolver) dispatchResolver(fn);
        }
      };

      // 1. Observe iw.pdfMake if present or when assigned
      const observePdfMake = (pm) => {
        if (!pm || pm.__rp_observed) return;
        pm.__rp_observed = true;
        const origCreate = pm.createPdf;
        if (typeof origCreate === 'function') {
          pm.createPdf = function (...args) {
            const pdfObj = origCreate.apply(this, args);
            if (pdfObj && typeof pdfObj.download === 'function') {
              const origDl = pdfObj.download.bind(pdfObj);
              pdfObj.download = function (fn) {
                DLog(`Official portal pdfMake.download() initiated: ${fn}`);
                onDispatched(fn);
                return origDl(fn); // Native official download proceeds untouched!
              };
            }
            return pdfObj;
          };
        }
      };

      if (iw.pdfMake) observePdfMake(iw.pdfMake);
      try {
        let _pm = iw.pdfMake;
        Object.defineProperty(iw, 'pdfMake', {
          configurable: true,
          enumerable: true,
          get: () => _pm,
          set: (v) => { _pm = v; observePdfMake(v); }
        });
      } catch (_) {}

      // 2. Observe iw.saveAs if present or when assigned
      if (typeof iw.saveAs === 'function' && !iw.saveAs.__rp_observed) {
        const origSaveAs = iw.saveAs;
        iw.saveAs = function (blob, fn) {
          DLog(`Official portal saveAs() initiated: ${fn}`);
          onDispatched(fn);
          return origSaveAs.apply(this, arguments);
        };
        iw.saveAs.__rp_observed = true;
      }

      // 3. Observe anchor clicks in iframe
      if (iw.HTMLAnchorElement && !iw.HTMLAnchorElement.prototype.__rp_observed) {
        const origAnchorClick = iw.HTMLAnchorElement.prototype.click;
        iw.HTMLAnchorElement.prototype.click = function () {
          const fn = this.download || this.getAttribute('download');
          if (fn || (this.href && this.href.startsWith('blob:'))) {
            DLog(`Official portal anchor click initiated: ${fn || this.href}`);
            onDispatched(fn);
          }
          return origAnchorClick.apply(this, arguments);
        };
        iw.HTMLAnchorElement.prototype.__rp_observed = true;
      }

      // 4. Observe iw.URL.createObjectURL in iframe
      if (iw.URL && !iw.URL.__rp_observed) {
        const origCreateUrl = iw.URL.createObjectURL;
        iw.URL.createObjectURL = function (obj) {
          const url = origCreateUrl.apply(this, arguments);
          if (obj instanceof (iw.Blob || Blob) && (obj.type?.includes('pdf') || obj.size > 1000)) {
            DLog(`Official portal Blob URL created in iframe (size: ${obj.size})`);
            queueMicrotask(() => onDispatched(null));
          }
          return url;
        };
        iw.URL.__rp_observed = true;
      }

      // 7. Trigger official portal download button
      DLog(`Invoking official portal download for ${period}: ${variant.ngClick}`);
      try { btn.focus(); } catch (_) {}
      btn.dispatchEvent(new iw.MouseEvent('mousedown', { bubbles: true, cancelable: true, view: iw }));
      btn.dispatchEvent(new iw.MouseEvent('mouseup', { bubbles: true, cancelable: true, view: iw }));
      btn.click();

      // Wait for official dispatch event with a 45s safety fallback for slow connections
      const capturedFn = await Promise.race([
        dispatchPromise,
        sleep(45000).then(() => null)
      ]);

      const filename = capturedFn || `GSTR1_${d.gstin}_${period}.pdf`;
      const ms = Date.now() - t0;
      DLog(`✓ Official GSTR-1 PDF download dispatched for ${period}: ${filename} in ${ms}ms`);

      return {
        success: true,
        filename,
        period,
        timeMs: ms,
        officialDownload: true
      };

    } catch(e) {
      DLog(`Execution error for ${period}:`, e.message);
      cleanupIframe();
      return { success: false, error: e.message, period };
    } finally {
      scheduleCleanupIframe();
      restoreSnapshot(snap);
    }
  }

  // ── Communication Bridge ──
  window.addEventListener('message', async (event) => {
    if (event.source !== window || !event.data) return;
    const d = event.data;

    if (d.__gstr1 === 'INJECT_START' || d.action === 'CAPTURE_GSTR1_PDF') {
      const reqId = d.requestId || `g1_${Date.now()}`;
      const period = d.period;
      const res = await downloadOne(period, d.meta || {});

      window.postMessage({
        __gstr1: 'INJECT_RESULT',
        requestId: reqId,
        source: 'RP_GSTR1_RESPONSE',
        ...res
      }, '*');
    }
  });

  window.postMessage({ __gstr1: 'INJECT_READY' }, '*');
  DLog('GSTR-1 Inject engine ready');
})();
