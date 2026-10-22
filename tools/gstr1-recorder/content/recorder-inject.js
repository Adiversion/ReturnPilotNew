// ReturnPilot GSTR-1 Recorder — MAIN-WORLD hook (runs inside gst.gov.in pages)
//
// This script runs in the PAGE context (injected by content/recorder.js), so it
// can see the portal's AngularJS scope, DOM, localStorage and network calls.
// It never modifies the page — it only observes and posts plain data back to
// the isolated-world content script via window.postMessage.
//
// What it captures:
//   • fetch() and XMLHttpRequest calls (URL, method, status, timing, body —
//     API JSON bodies kept FULL, HTML templates truncated)
//   • form submits, window.open calls and anchor clicks with download/href
//     (the portal's PDF download often uses one of these instead of XHR)
//   • console.warn/error lines
//   • On request: a full SNAPSHOT — page URL/title, every button/link/input with
//     its ng-click / ng-if / ng-show attributes + visibility, Angular scope
//     flags (rtn_prd, isnil, status, sumryData, genratepdfNew, getSummary, …)
//     from EVERY controller (not just the first one in DOM order), and
//     localStorage/sessionStorage keys + same-origin iframes' structure.
(() => {
  'use strict';
  if (window.__rpGstr1RecorderActive) return;
  window.__rpGstr1RecorderActive = true;

  const MAX_EVENTS = 500;
  const events = [];

  function push(payload) {
    events.push(Object.assign({ t: Date.now() }, payload));
    if (events.length > MAX_EVENTS) events.shift();
    try { window.postMessage({ source: 'RP_RECORDER_EVENT', payload }, '*'); } catch (_) {}
  }

  // Full body for portal API JSON (the interesting part), short for HTML chunks.
  function clipBody(body, url) {
    if (!body) return '';
    const s = String(body);
    const isApi = /\/api\/|auth\/api|api\//.test(url || '') || s.trim().startsWith('{') || s.trim().startsWith('[');
    return isApi ? s.slice(0, 20000) : s.slice(0, 1500);
  }

  // ── Hook 1: fetch() ─────────────────────────────────────────────
  const origFetch = window.fetch;
  if (origFetch && !origFetch.__rpG1Rec) {
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      const start = Date.now();
      return origFetch.apply(this, arguments).then((resp) => {
        try {
          const clone = resp.clone();
          clone.text().then((body) => {
            push({
              kind: 'fetch',
              url: String(url).slice(0, 300),
              method,
              status: resp.status,
              ms: Date.now() - start,
              body: clipBody(body, url)
            });
          }).catch(() => {});
        } catch (_) {}
        return resp;
      }).catch((err) => {
        push({ kind: 'fetch', url: String(url).slice(0, 300), method, error: String(err).slice(0, 200) });
        throw err;
      });
    };
    window.fetch.__rpG1Rec = true;
  }

  // ── Hook 2: XMLHttpRequest ──────────────────────────────────────
  const origOpen = XMLHttpRequest.prototype.open;
  if (origOpen && !origOpen.__rpG1Rec) {
    XMLHttpRequest.prototype.open = function (method, url) {
      this.__rpG1Url = String(url);
      this.__rpG1Method = String(method || 'GET').toUpperCase();
      return origOpen.apply(this, arguments);
    };
    origOpen.__rpG1Rec = true;
  }
  const origSend = XMLHttpRequest.prototype.send;
  if (origSend && !origSend.__rpG1Rec) {
    XMLHttpRequest.prototype.send = function () {
      const xhr = this;
      const start = Date.now();
      this.addEventListener('loadend', function () {
        try {
          let body = '';
          try { body = xhr.responseText || ''; } catch (_) {}
          push({
            kind: 'xhr',
            url: String(xhr.__rpG1Url || '').slice(0, 300),
            method: xhr.__rpG1Method || 'GET',
            status: xhr.status,
            ms: Date.now() - start,
            body: clipBody(body, xhr.__rpG1Url || '')
          });
        } catch (_) {}
      });
      return origSend.apply(this, arguments);
    };
    origSend.__rpG1Rec = true;
  }

  // ── Hook 3: form submits (the PDF download may be a hidden form POST) ──
  document.addEventListener('submit', (e) => {
    try {
      const f = e.target;
      if (!f || !f.action) return;
      const data = {};
      (f.elements || []).forEach((el) => {
        if (el && el.name) data[el.name] = String(el.value).slice(0, 80);
      });
      push({
        kind: 'form-submit',
        url: String(f.action).slice(0, 300),
        method: String((f.method || 'GET').toUpperCase()),
        target: String(f.target || '').slice(0, 80),
        fields: data
      });
    } catch (_) {}
  }, true);

  // ── Hook 4: window.open (portal may open the PDF in a new window) ──
  const origOpen2 = window.open;
  if (origOpen2 && !origOpen2.__rpG1Rec) {
    window.open = function (url, ...args) {
      try {
        push({ kind: 'window.open', url: String(url || '').slice(0, 300), target: String(args[0] || '').slice(0, 80) });
      } catch (_) {}
      return origOpen2.apply(this, [url, ...args]);
    };
    window.open.__rpG1Rec = true;
  }

  // ── Hook 5: anchor clicks with download / blob: / pdf href ──
  document.addEventListener('click', (e) => {
    try {
      const a = e.target && e.target.closest ? e.target.closest('a[href], a[download]') : null;
      if (!a) return;
      const href = a.href || '';
      const dl = a.getAttribute('download') || '';
      if (href.startsWith('blob:') || dl.toLowerCase().endsWith('.pdf') || /\.pdf/i.test(href)) {
        push({
          kind: 'anchor-click',
          href: href.slice(0, 300),
          download: dl.slice(0, 150),
          text: (a.innerText || a.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60)
        });
      }
    } catch (_) {}
  }, true);

  // ── Hook 6: console lines (portal warnings/errors are often the signal) ──
  ['warn', 'error'].forEach((lvl) => {
    const orig = console[lvl];
    if (orig && !orig.__rpG1Rec) {
      console[lvl] = function () {
        try {
          const line = Array.from(arguments).map((a) => {
            try { return typeof a === 'string' ? a : JSON.stringify(a); } catch (_) { return String(a); }
          }).join(' ').slice(0, 500);
          push({ kind: 'console', level: lvl, line });
        } catch (_) {}
        return orig.apply(this, arguments);
      };
      console[lvl].__rpG1Rec = true;
    }
  });

  // ── Snapshot builder ────────────────────────────────────────────
  const ATTRS = ['ng-click', 'data-ng-click', 'ng-if', 'data-ng-if', 'ng-show', 'data-ng-show',
                 'ng-model', 'data-ng-model', 'ng-href', 'data-ng-href', 'role', 'aria-label',
                 'data-ng-options', 'ng-options'];

  function elemInfo(el) {
    const r = { tag: el.tagName.toLowerCase() };
    if (el.id) r.id = el.id;
    if (el.className && typeof el.className === 'string' && el.className.trim()) r.cls = String(el.className).trim().replace(/\s+/g, ' ').slice(0, 90);
    const txt = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    if (txt) r.txt = txt;
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (v) r[a] = v.slice(0, 120);
    }
    if (el.disabled) r.disabled = true;
    r.vis = el.offsetParent !== null;
    return r;
  }

  function collectDoc(doc) {
    const out = {
      url: (doc.location ? doc.location.href : '').slice(0, 300),
      title: (doc.title || '').slice(0, 150),
      readyState: doc.readyState || ''
    };
    const els = doc.querySelectorAll('button, a, input, select, textarea, [role="button"], [ng-click], [data-ng-click]');
    out.elements = [];
    for (let i = 0; i < els.length && i < 500; i++) out.elements.push(elemInfo(els[i]));
    // Body text sample — helps identify error/rejected pages.
    try {
      const txt = (doc.body && doc.body.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 1200);
      if (txt) out.bodyText = txt;
    } catch (_) {}
    return out;
  }

  const SCOPE_KEYS = ['rtn_prd', 'gstin', 'rtn_typ', 'isnil', 'status', 'filing', 'filing_status',
    'sumryData', 'showStatusTable', 'showPostPP', 'postPP', 'genratepdfNew', 'getSummary',
    'generateNILGstr1Pdf', 'downloadPrePdf', 'downloadGSTR3Bpdf', 'genrateQtrPdfNew', 'url', 'urn', 'arn',
    'fil_dt', 'filDt', 'total', 'fileStatus', 'period', 'finYear', 'fy', 'sumGenStatus', 'isSubmitted'];

  // Capture scope flags from EVERY [ng-controller]/[ng-app] root and walk each
  // scope's $parents — the GSTR-1 controller is a SIBLING of the header
  // controller, so grabbing only the first match in DOM order misses it.
  function scopeFlags() {
    const flags = {};
    try {
      if (!window.angular) return flags;
      const roots = document.querySelectorAll('[ng-app], [data-ng-app], [ng-controller], [data-ng-controller], body');
      const seenScopes = new Set();
      for (const root of roots) {
        let scope = null;
        try { scope = window.angular.element(root).scope(); } catch (_) {}
        for (let h = 0; scope && h < 12; h++) {
          if (seenScopes.has(scope)) break;
          seenScopes.add(scope);
          for (const k of SCOPE_KEYS) {
            if (!(k in scope) || flags[k] !== undefined) continue;
            let v = scope[k];
            if (typeof v === 'function') v = '[fn]';
            else if (typeof v === 'object') { try { v = JSON.stringify(v).slice(0, 300); } catch (_) { v = '[object]'; } }
            flags[k] = String(v).slice(0, 300);
          }
          try { scope = scope.$parent; } catch (_) { break; }
        }
      }
    } catch (_) {}
    return flags;
  }

  function storageDump() {
    const dump = { localStorage: {}, sessionStorage: {} };
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i) || '';
        if (/rtn_prd|gstin|rtn_typ|period|summary|ls\.|_rp|caseJson/i.test(k)) {
          dump.localStorage[k] = (localStorage.getItem(k) || '').slice(0, 250);
        }
      }
    } catch (_) {}
    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i) || '';
        if (/rtn_prd|gstin|rtn_typ|period|summary|_rp/i.test(k)) {
          dump.sessionStorage[k] = (sessionStorage.getItem(k) || '').slice(0, 250);
        }
      }
    } catch (_) {}
    return dump;
  }

  function buildSnapshot() {
    const snap = {
      page: collectDoc(document),
      scope: scopeFlags(),
      storage: storageDump(),
      frames: []
    };
    try {
      document.querySelectorAll('iframe').forEach((f) => {
        try {
          const cd = f.contentDocument;
          if (cd && cd.location) {
            snap.frames.push({ src: (f.src || '').slice(0, 200), page: collectDoc(cd) });
          } else {
            snap.frames.push({ src: (f.src || '').slice(0, 200), error: 'no-content-document' });
          }
        } catch (_) {
          snap.frames.push({ src: (f.src || '').slice(0, 200), error: 'cross-origin' });
        }
      });
    } catch (_) {}
    return snap;
  }

  // ── Request bridge (isolated world asks, we answer) ─────────────
  window.addEventListener('message', (ev) => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || d.source !== 'RP_RECORDER_REQ') return;
    const respond = (result) => {
      try { window.postMessage({ source: 'RP_RECORDER_RESP', requestId: d.requestId, result }, '*'); } catch (_) {}
    };
    if (d.action === 'snapshot') respond(buildSnapshot());
    else if (d.action === 'get-events') respond({ events });
  });
})();
