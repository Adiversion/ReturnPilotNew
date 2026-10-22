// ReturnPilot GSTR-1 Recorder — content script (isolated world, all frames)
//
//  • Injects content/recorder-inject.js (MAIN world) which hooks fetch/XHR/console.
//  • TOP frame owns the log (chrome.storage.local) and answers popup messages.
//  • CHILD frames forward captured events to the top frame, which stores them,
//    so API calls made inside the portal's hidden iframes are recorded too.
(() => {
  'use strict';
  if (window.__rpGstr1RecorderLoaded) return;
  window.__rpGstr1RecorderLoaded = true;

  const LOG_KEY = 'rp_gstr1_recorder_log';
  const isTop = window === window.top;

  // Inject the MAIN-world observer.
  try {
    const s = document.createElement('script');
    s.src = chrome.runtime.getURL('content/recorder-inject.js');
    s.onload = () => s.remove();
    (document.head || document.documentElement).appendChild(s);
  } catch (_) {}

  // ── Log (owned by the top frame) ──
  let log = { startedAt: Date.now(), meta: { scenario: 'other' }, snapshots: [], events: [] };
  let scenario = 'other';
  let hydrated = false;
  function hydrate() {
    if (hydrated) return;
    hydrated = true;
    try {
      chrome.storage.local.get(LOG_KEY, (d) => {
        if (d && d[LOG_KEY] && d[LOG_KEY].snapshots) {
          log = d[LOG_KEY];
          scenario = log.meta.scenario || 'other';
        }
      });
    } catch (_) {}
  }
  hydrate();

  function save() {
    try { chrome.storage.local.set({ [LOG_KEY]: log }); } catch (_) {}
  }

  // ── Event bridge: every frame's inject posts 'RP_RECORDER_EVENT' to its own
  //    window. Top frame stores; child frames forward to the top frame. ──
  // Auto-snapshot triggers: URL change (SPA navigation) and download-related
  // API calls — so the user never has to time the 📸 click.
  let lastUrl = location.href;
  let lastAutoSnapAt = 0;
  let lastAutoSnapUrl = '';
  const snapTriggeredFor = new Set(); // dedupe: one auto-snap per (kind,url)

  async function autoSnapshot(reason, dedupeKey) {
    if (dedupeKey && snapTriggeredFor.has(dedupeKey)) return;
    if (dedupeKey) snapTriggeredFor.add(dedupeKey);
    if (Date.now() - lastAutoSnapAt < 1500) return; // debounce burst
    lastAutoSnapAt = Date.now();
    try {
      const info = await requestMain('snapshot');
      const snap = {
        at: Date.now(),
        scenario,
        note: 'AUTO: ' + reason,
        frameUrl: location.href.slice(0, 300),
        data: info
      };
      log.snapshots.push(snap);
      if (log.snapshots.length > 80) log.snapshots = log.snapshots.slice(-80);
      save();
    } catch (_) {}
  }

  window.addEventListener('message', (ev) => {
    const data = ev.data;
    if (!data || data.source !== 'RP_RECORDER_EVENT') return;
    if (!isTop) {
      try { window.top.postMessage({ source: 'RP_RECORDER_EVENT', payload: data.payload }, '*'); } catch (_) {}
      return;
    }
    log.events.push(data.payload);
    if (log.events.length > 600) log.events = log.events.slice(-600);
    save();

    // Auto-snapshot on download-ish activity (URL or payload kind).
    const payload = data.payload || {};
    const u = String(payload.url || '');
    if (payload.kind === 'form-submit' || payload.kind === 'window.open' ||
        payload.kind === 'anchor-click' ||
        /(genratepdf|getSummary|generateNIL|download|summarypdf|gstr1pdf|pdf)/i.test(u) ||
        /(formdetails|totalsummarycount|\/summary\?|rolestatus)/i.test(u)) {
      autoSnapshot((payload.kind || 'api') + ' ' + u.slice(0, 120), (payload.kind || 'api') + '|' + u);
    }
  });

  // Auto-snapshot when the SPA navigates to a new URL (landing → summary → …).
  // Snapshot ~2.5s AFTER the change so Angular has re-rendered the new view
  // (an instant capture would freeze the mid-transition DOM).
  setInterval(() => {
    if (!isTop) return;
    if (location.href !== lastUrl) {
      const prev = lastUrl;
      lastUrl = location.href;
      setTimeout(() => {
        autoSnapshot('URL change → ' + location.href.slice(0, 140), 'url|' + location.href);
      }, 2500);
      lastAutoSnapUrl = prev;
    }
  }, 1000);

  // ── MAIN-world request/response bridge (snapshot) ──
  const pending = new Map();
  window.addEventListener('message', (ev) => {
    const data = ev.data;
    if (!data || data.source !== 'RP_RECORDER_RESP') return;
    if (pending.has(data.requestId)) {
      pending.get(data.requestId)(data.result || {});
      pending.delete(data.requestId);
    }
  });

  function requestMain(action) {
    return new Promise((resolve) => {
      const id = 'req_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      pending.set(id, resolve);
      try {
        window.postMessage({ source: 'RP_RECORDER_REQ', requestId: id, action, payload: {} }, '*');
      } catch (_) {
        pending.delete(id);
        resolve({ error: 'post failed' });
        return;
      }
      setTimeout(() => {
        if (pending.has(id)) { pending.delete(id); resolve({ error: 'main-world timeout' }); }
      }, 5000);
    });
  }

  // ── Popup messages (top frame only) ──
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.source !== 'RP_RECORDER_POPUP') return false;
    if (!isTop) return false;

    if (msg.action === 'set-scenario') {
      scenario = msg.scenario || 'other';
      log.meta.scenario = scenario;
      save();
      sendResponse({ ok: true, count: log.snapshots.length });
      return false;
    }
    if (msg.action === 'snapshot') {
      (async () => {
        const info = await requestMain('snapshot');
        log.snapshots.push({
          at: Date.now(),
          scenario,
          note: msg.note || '',
          frameUrl: location.href.slice(0, 300),
          data: info
        });
        save();
        sendResponse({ ok: true, count: log.snapshots.length, at: log.snapshots[log.snapshots.length - 1].at });
      })();
      return true;
    }
    if (msg.action === 'export') {
      const full = JSON.parse(JSON.stringify(log));
      full.meta = Object.assign({}, full.meta, {
        scenario,
        exportedAt: Date.now(),
        ua: (navigator.userAgent || '').slice(0, 120),
        tabUrl: location.href.slice(0, 300)
      });
      sendResponse({ ok: true, log: full });
      return false;
    }
    if (msg.action === 'clear') {
      log = { startedAt: Date.now(), meta: { scenario }, snapshots: [], events: [] };
      save();
      sendResponse({ ok: true });
      return false;
    }
    if (msg.action === 'status') {
      sendResponse({
        ok: true,
        count: log.snapshots.length,
        eventCount: log.events.length,
        scenario,
        tabUrl: location.href.slice(0, 300)
      });
      return false;
    }
    return false;
  });
})();
