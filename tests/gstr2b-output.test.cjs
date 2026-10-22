'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { pdfHeader } = require('./fixtures/pdf-identity.cjs');
const source = fs.readFileSync(path.join(__dirname, '../content/2b-inject.js'), 'utf8');
const drain = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

function harness({ format = 'PDF', click = () => {}, disabled = false, empty = false, doc = pdfHeader() } = {}) {
  let id = 0;
  let nativeClicks = 0;
  let compiled = 0;
  const timers = new Map();
  const intervals = new Map();
  const listeners = [];
  const observers = new Set();
  const messages = [];
  const parent = {};
  const meta = { period: '042026', rtn_prd: '042026', gstin: '22AAAAA0000A1Z5', finyr: '2026-27', captureType: format, requestId: 'job', parentOrigin: 'https://return.gst.gov.in' };
  function Anchor() { this.download = ''; this.href = ''; }
  Anchor.prototype.getAttribute = function (key) { return this[key]; };
  Anchor.prototype.setAttribute = function (key, value) { this[key] = value; };
  Anchor.prototype.click = function () { nativeClicks++; };
  Anchor.prototype.dispatchEvent = function (event) { nativeClicks++; return !event.defaultPrevented; };
  const button = {
    textContent: format === 'PDF' ? 'DOWNLOAD GSTR-2B SUMMARY (PDF)' : 'DOWNLOAD GSTR-2B DETAILS (EXCEL)',
    ariaDisabled: disabled,
    getAttribute: key => key === 'aria-disabled' ? String(button.ariaDisabled) : null,
    focus() {}, dispatchEvent() {}, click: () => {
      if (format === 'PDF' && doc !== false) window.pdfMake.createPdf(doc);
      click(api);
    }
  };
  const elements = empty ? [] : [button];
  const window = {
    parent, name: `__gst2b_042026__meta=${encodeURIComponent(JSON.stringify(meta))}`,
    URL: { createObjectURL: () => `blob:${++id}` },
    pdfMake: { createPdf: () => { compiled++; return { download() {} }; } },
    saveAs() {},
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    addEventListener: (_type, handler) => listeners.push(handler),
    postMessage: message => messages.push(message)
  };
  const context = vm.createContext({
    window, Blob, HTMLAnchorElement: Anchor,
    location: { href: 'https://gstr2b.gst.gov.in/gstr2b/auth/gstr2b/summary' },
    document: { querySelectorAll: () => elements, body: {} },
    localStorage: { getItem: () => null }, sessionStorage: { getItem: () => null },
    performance: { now: () => 0 },
    console: { log() {}, error() {}, warn() {} },
    MouseEvent: class { constructor(type) { this.type = type; } },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; }
      observe() { observers.add(this.callback); }
      disconnect() { observers.delete(this.callback); }
    },
    setTimeout: callback => { const key = ++id; timers.set(key, callback); return key; },
    clearTimeout: key => timers.delete(key),
    setInterval: callback => { const key = ++id; intervals.set(key, callback); return key; },
    clearInterval: key => intervals.delete(key)
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../content/return-identity.js'), 'utf8'), context);
  vm.runInContext(source, context);
  const api = {
    window, button, elements, timers, intervals, observers,
    results: () => messages.filter(message => message.__gst2b === 'INJECT_RESULT'),
    nativeClicks: () => nativeClicks,
    compiled: () => compiled,
    start: () => listeners.forEach(handler => handler({ source: parent, origin: meta.parentOrigin, data: {
      __gst2b: 'INJECT_START', requestId: 'job', period: meta.period, captureType: format, meta
    } })),
    anchor: (mime = 'application/pdf', filename = 'return.pdf', bytes = '%PDF-test') => {
      const a = new Anchor();
      a.href = window.URL.createObjectURL(new Blob([bytes], { type: mime }));
      a.download = filename;
      return a;
    },
    expire: () => {
      for (const [key, callback] of [...timers]) { timers.delete(key); callback(); }
    },
    mutate: () => [...observers].forEach(callback => callback())
  };
  return api;
}

async function expectFailure(h, pattern = /not observed/) {
  h.expire(); await drain();
  assert.equal(h.results().length, 1);
  assert.equal(h.results()[0].success, false);
  assert.match(h.results()[0].error, pattern);
  assert.equal(h.timers.size, 0);
  assert.equal(h.intervals.size, 0);
}

test('pdfMake.download invocation alone never reports success', async () => {
  const h = harness({ click: h => h.window.pdfMake.createPdf(pdfHeader()).download('return.pdf') });
  h.start(); await drain();
  assert.equal(h.results().length, 0);
  await expectFailure(h);
});

test('saveAs invocation alone never reports success', async () => {
  const h = harness({ format: 'EXCEL', click: h => h.window.saveAs(new Blob(['xlsx']), 'return.xlsx') });
  h.start(); await drain();
  assert.equal(h.results().length, 0);
  await expectFailure(h);
});

test('object URL creation alone never reports success', async () => {
  const h = harness({ click: h => h.anchor() });
  h.start(); await drain();
  assert.equal(h.results().length, 0);
  await expectFailure(h);
});

test('waits for delayed matching PDF anchor activation and preserves native click', async () => {
  const h = harness(); h.start(); await drain();
  assert.equal(h.results().length, 0);
  h.anchor().click(); await drain();
  assert.equal(h.nativeClicks(), 1);
  assert.equal(h.results().length, 1);
  assert.equal(h.results()[0].success, true);
  assert.equal(h.results()[0].downloadStage, 'NATIVE_ANCHOR_DISPATCHED');
  assert.equal(h.timers.size, 0);
  assert.equal(h.intervals.size, 0);
  h.anchor().click(); await drain();
  assert.equal(h.results().length, 1);
});

test('observes FileSaver-style synthetic Excel click, but not canceled events', async () => {
  const h = harness({ format: 'EXCEL' }); h.start(); await drain();
  const a = h.anchor('application/octet-stream', 'return.xlsx', 'xlsx');
  a.dispatchEvent({ type: 'click', defaultPrevented: true }); await drain();
  assert.equal(h.results().length, 0);
  a.dispatchEvent({ type: 'click' }); await drain();
  assert.equal(h.results()[0].success, true);
  assert.equal(h.results()[0].captureType, 'EXCEL');
});

for (const [label, mime, filename, bytes] of [
  ['wrong format', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'return.xlsx', 'xlsx'],
  ['HTML error page', 'text/html', 'return.pdf', '<html>Error</html>'],
  ['conflicting MIME/extension', 'application/pdf', 'return.xlsx', '%PDF-test'],
  ['empty blob', 'application/pdf', 'return.pdf', '']
]) {
  test(`rejects ${label} as PDF output`, async () => {
    const h = harness({ click: h => h.anchor(mime, filename, bytes).click() });
    h.start(); await drain();
    assert.equal(h.results().length, 0);
    await expectFailure(h);
  });
}

test('ignores blob URLs created before this operation was armed', async () => {
  const h = harness(); const old = h.anchor();
  h.start(); await drain(); old.click(); await drain();
  assert.equal(h.results().length, 0);
  await expectFailure(h);
});

test('aria-disabled button waits until enabled; PDF search skips Excel buttons', async () => {
  let clicked = 0;
  const h = harness({ disabled: true, click: h => { clicked++; h.anchor().click(); } });
  h.elements.unshift({ ...h.button, textContent: 'DOWNLOAD GSTR-2B DETAILS (EXCEL)', getAttribute: () => null, click: () => assert.fail('wrong format button') });
  h.start(); await drain();
  assert.equal(clicked, 0);
  h.button.ariaDisabled = false; h.mutate(); await drain();
  assert.equal(clicked, 1);
  assert.equal(h.results()[0].success, true);
  assert.equal(h.observers.size, 0);
  assert.equal(h.intervals.size, 0);
});

test('button timeout cleans observers and polling immediately', async () => {
  const h = harness({ empty: true }); h.start(); await drain();
  await expectFailure(h, /not found/);
  assert.equal(h.observers.size, 0);
});


for (const [label, doc] of [
  ['stale July data', pdfHeader({ month: 'July' })],
  ['another taxpayer', pdfHeader({ gstin: '27BBBBB0000B1Z5' })],
  ['missing financial year', pdfHeader({ fy: null })]
]) {
  test(`blocks ${label} before PDF compilation or native download`, async () => {
    const h = harness({ doc, click: h => h.anchor().click() });
    h.start(); await drain();
    assert.equal(h.compiled(), 0);
    assert.equal(h.nativeClicks(), 0);
    assert.equal(h.results().length, 1);
    assert.equal(h.results()[0].success, false);
    assert.equal(h.timers.size, 0);
  });
}

test('PDF fallback without any verified docDefinition cannot bypass the guard', async () => {
  const h = harness({ doc: false, click: h => h.anchor().click() });
  h.start(); await drain();
  assert.equal(h.nativeClicks(), 0);
  assert.equal(h.results()[0].success, false);
});

for (const format of ['PDF', 'EXCEL']) {
  for (const [reason, name] of [
    ['another taxpayer', 'GSTR2B_27BBBBB0000B1Z5_042026'],
    ['another month', 'GSTR2B_22AAAAA0000A1Z5_062026'],
    ['conflicting duplicate months', 'GSTR2B_22AAAAA0000A1Z5_042026_062026'],
    ['conflicting duplicate taxpayers', 'GSTR2B_22AAAAA0000A1Z5_27BBBBB0000B1Z5_042026']
  ]) {
    test(`blocks ${format} filename naming ${reason} before native dispatch`, async () => {
      const mime = format === 'PDF' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      const extension = format === 'PDF' ? '.pdf' : '.xlsx';
      const h = harness({ format, click: h => {
        const anchor = h.anchor(mime, name + extension);
        if (format === 'PDF') anchor.click();
        else assert.equal(anchor.dispatchEvent({ type: 'click' }), false);
      } });
      h.start(); await drain();
      assert.equal(h.nativeClicks(), 0);
      assert.equal(h.results().length, 1);
      assert.equal(h.results()[0].success, false);
      assert.match(h.results()[0].error, /filename identity conflicts/);
      assert.ok(!h.results()[0].error.includes('27BBBBB0000B1Z5'));
      assert.equal(h.timers.size, 0);
      assert.equal(h.intervals.size, 0);
    });
  }
  test(`accepts matching ${format} filename identity without requiring an extension`, async () => {
    const mime = format === 'PDF' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    const h = harness({ format, click: h => h.anchor(mime, 'GSTR2B_22aaaaa0000a1z5_042026').click() });
    h.start(); await drain();
    assert.equal(h.nativeClicks(), 1);
    assert.equal(h.results()[0].success, true);
  });
}

test('filename contradiction guard leaves pre-job object URLs alone', async () => {
  const h = harness({ format: 'EXCEL' });
  const old = h.anchor('application/vnd.ms-excel', 'GSTR2B_27BBBBB0000B1Z5_062026.xlsx');
  h.start(); await drain(); old.click(); await drain();
  assert.equal(h.nativeClicks(), 1);
  assert.equal(h.results().length, 0);
  await expectFailure(h);
});
