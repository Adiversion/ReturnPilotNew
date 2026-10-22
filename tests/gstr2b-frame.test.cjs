'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../engine/gstr2b-frame-runner.js'), 'utf8');
const portalOrigin = 'https://gstr2b.gst.gov.in';
const gstin = '22AAAAA0000A1Z5';

function harness({ appendFails = false } = {}) {
  const listeners = new Set();
  const timers = new Map();
  const sent = [];
  let removed = 0;
  const child = { postMessage: (data, origin) => sent.push({ data, origin }) };
  const frame = { contentWindow: child, style: {}, remove: () => { removed++; } };
  const window = {
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener)
  };
  const context = vm.createContext({
    window, crypto: { randomUUID: () => 'test-id' },
    location: { origin: 'https://return.gst.gov.in' },
    localStorage: { getItem: () => null },
    document: { createElement: () => frame, body: { appendChild: () => { if (appendFails) throw new Error('append failed'); } } },
    setTimeout: fn => { timers.set(1, fn); return 1; },
    clearTimeout: id => timers.delete(id)
  });
  // Execute the actual serialized production function without extension-only globals.
  vm.runInContext(source.replace('export function', 'function'), context);
  const completion = context.runGstr2bFrame('042026', gstin, '2026-27', 'PDF', 45000);
  const emit = (data, overrides = {}) => {
    for (const listener of [...listeners]) listener({ data, source: child, origin: portalOrigin, ...overrides });
  };
  const ready = () => emit({ __gst2b: 'INJECT_READY' });
  const result = (overrides = {}) => emit({
    __gst2b: 'INJECT_RESULT', requestId: sent[0]?.data.requestId,
    success: true, period: '042026', gstin, captureType: 'PDF', ...overrides
  });
  return { completion, emit, ready, result, sent, timers, listeners, frame, removed: () => removed };
}

test('ignores sibling frames and wrong origins; sends START once to exact portal origin', async () => {
  const h = harness();
  h.emit({ __gst2b: 'INJECT_READY' }, { source: {} });
  h.emit({ __gst2b: 'INJECT_READY' }, { origin: 'https://other.example' });
  assert.equal(h.sent.length, 0);
  h.ready(); h.ready();
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].origin, portalOrigin);
  const meta = JSON.parse(decodeURIComponent(h.frame.name.split('__meta=')[1]));
  assert.equal(meta.requestId, h.sent[0].data.requestId);
  assert.equal(meta.parentOrigin, 'https://return.gst.gov.in');
  h.result();
  assert.equal((await h.completion).success, true);
});

test('ignores missing/wrong operation IDs and foreign-window results', async () => {
  const h = harness(); h.ready();
  h.result({ requestId: undefined });
  h.result({ requestId: 'another-job' });
  h.emit({ __gst2b: 'INJECT_RESULT', requestId: h.sent[0].data.requestId, success: true }, { source: {} });
  assert.equal(h.removed(), 0);
  h.result();
  await h.completion;
  assert.equal(h.removed(), 1);
  assert.equal(h.listeners.size, 0);
  assert.equal(h.timers.size, 0);
});

for (const [field, wrong] of [['period', '052026'], ['gstin', '27BBBBB0000B1Z5'], ['captureType', 'EXCEL']]) {
  test(`rejects successful output with mismatched ${field}`, async () => {
    const h = harness(); h.ready(); h.result({ [field]: wrong });
    const result = await h.completion;
    assert.equal(result.success, false);
    assert.match(result.error, /identity mismatch/);
    assert.equal(h.removed(), 1);
    assert.equal(h.timers.size, 0);
  });
}

test('timeout removes the owned frame/listener and ignores late results', async () => {
  const h = harness(); h.ready();
  h.timers.get(1)();
  assert.match((await h.completion).error, /timeout/);
  h.result();
  assert.equal(h.removed(), 1);
  assert.equal(h.listeners.size, 0);
  assert.equal(h.timers.size, 0);
});

test('append failure settles and cleans up instead of leaving an orphan timer', async () => {
  const h = harness({ appendFails: true });
  assert.match((await h.completion).error, /append failed/);
  assert.equal(h.listeners.size, 0);
  assert.equal(h.timers.size, 0);
});

test('correlated portal failure is preserved and cleaned up', async () => {
  const h = harness(); h.ready();
  h.result({ success: false, error: 'GST unavailable', period: undefined });
  assert.equal((await h.completion).error, 'GST unavailable');
  assert.equal(h.removed(), 1);
});

test('production inject script only starts once for its owning parent and job', () => {
  const listeners = [];
  let captures = 0;
  const parent = {};
  const meta = { period: '042026', rtn_prd: '042026', gstin, finyr: '2026-27', captureType: 'PDF', requestId: 'owned-job', parentOrigin: 'https://return.gst.gov.in' };
  const window = {
    parent, name: `__gst2b_042026__meta=${encodeURIComponent(JSON.stringify(meta))}`,
    URL: { createObjectURL: () => '' }, postMessage: () => {},
    addEventListener: (_type, listener) => listeners.push(listener)
  };
  function Anchor() {}
  Anchor.prototype.click = () => {};
  const context = vm.createContext({
    window, location: { href: portalOrigin }, HTMLAnchorElement: Anchor,
    console: { log: text => { if (String(text).startsWith('[2B Inject] Capture:')) captures++; }, error() {}, warn() {} },
    localStorage: { getItem: () => null }, sessionStorage: { getItem: () => null },
    document: { querySelectorAll: () => [], body: {} },
    performance: { now: () => 0 },
    MutationObserver: class { observe() {} disconnect() {} },
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {}
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../content/2b-inject.js'), 'utf8'), context);
  const data = { __gst2b: 'INJECT_START', requestId: 'owned-job', period: '042026', captureType: 'PDF', meta };
  const emit = (changes = {}) => listeners.forEach(fn => fn({ source: parent, origin: meta.parentOrigin, data, ...changes }));
  emit({ source: {} });
  emit({ origin: 'https://other.example' });
  emit({ data: { ...data, requestId: 'other-job' } });
  emit({ data: { ...data, period: '052026' } });
  assert.equal(captures, 0);
  emit(); emit();
  assert.equal(captures, 1);
});
