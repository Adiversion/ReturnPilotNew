'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { GSTIN, pdfHeader } = require('./fixtures/pdf-identity.cjs');
const identitySource = fs.readFileSync(path.join(__dirname, '../content/return-identity.js'), 'utf8');
const engineSource = fs.readFileSync(path.join(__dirname, '../engine/gstr3b.js'), 'utf8')
  .replace(/^import .*;\r?$/gm, '').replace('export function handleGstr3bScopePdf', 'function handleGstr3bScopePdf');

function harness(doc, { noScope = false, fallbackOnly = false } = {}) {
  let compiles = 0;
  const downloads = [];
  const storage = () => {
    const data = new Map([['gstin', GSTIN], ['rtn_prd', '042026']]);
    return { getItem: key => data.get(key) ?? null, setItem: (k, v) => data.set(k, v), removeItem: key => data.delete(key) };
  };
  const timers = new Map(); let timerId = 0;
  const setTimer = fn => { const id = ++timerId; timers.set(id, fn); return id; };
  const clearTimer = id => timers.delete(id);
  const silent = { log() {}, warn() {}, error() {}, debug() {} };
  const window = { pdfMake: { createPdf() {
    compiles++;
    return { download() {}, getBase64: callback => callback('A'.repeat(800)) };
  } } };
  if (fallbackOnly) window.saveAs = () => {};
  const shareData = {};
  const scope = { $root: { $$phase: false }, $evalAsync() {}, $apply: fn => fn() };
  if (!noScope) scope.downloadGSTR3Bpdf = () => {
    if (fallbackOnly) window.saveAs(new Blob(['synthetic']), `GSTR3B_${GSTIN}_042026.pdf`);
    else window.pdfMake.createPdf(doc).download(`GSTR3B_${GSTIN}_${shareData.rtn_prd}.pdf`);
  };
  const injector = { get: key => key === '$rootScope' ? scope : shareData };
  const portal = vm.createContext({
    window, angular: { element: () => ({ injector: () => injector }) }, document: { body: {} },
    localStorage: storage(), sessionStorage: storage(), console: silent, Blob,
    FileReader: class {
      readAsDataURL() { this.result = 'data:application/pdf;base64,' + 'A'.repeat(800); this.onloadend(); }
    },
    setTimeout: setTimer, clearTimeout: clearTimer
  });
  const chrome = {
    runtime: {},
    scripting: { executeScript: async options => {
      if (options.files) {
        assert.deepEqual(Array.from(options.files), ['content/return-identity.js']);
        vm.runInContext(identitySource, portal);
        return [];
      }
      // Chrome serializes the function; do not let worker closure variables leak in.
      const run = vm.runInContext(`(${options.func.toString()})`, portal);
      return [{ result: await run(...options.args) }];
    } },
    downloads: {
      download: (options, callback) => { downloads.push(options); callback(downloads.length); },
      onChanged: {
        addListener: listener => queueMicrotask(() => listener({ id: downloads.length, state: { current: 'complete' } })),
        removeListener() {}
      }
    }
  };
  const worker = vm.createContext({ chrome, console: silent, setTimeout: setTimer, clearTimeout: clearTimer,
    buildFolderDownloadPath: (_g, _r, _p, filename) => filename });
  vm.runInContext(engineSource, worker);
  return {
    downloads, compiles: () => compiles, timers,
    run: (period = '042026') => new Promise(resolve => worker.handleGstr3bScopePdf({ period, gstin: GSTIN, tabId: 1 }, {}, resolve, {}))
  };
}

test('3B production engine captures matching PDF and downloads it', async () => {
  const h = harness(pdfHeader({ type: '3B' }));
  const result = await h.run();
  assert.equal(result.success, true);
  assert.equal(h.compiles(), 1);
  assert.equal(h.downloads.length, 1);
  assert.equal(h.timers.size, 0);
});

test('second-month request cannot reuse the previous month document even with a new filename', async () => {
  const h = harness(pdfHeader({ type: '3B' }));
  assert.equal((await h.run()).success, true);
  const second = await h.run('052026');
  assert.equal(second.success, false);
  assert.match(second.error, /does not match/);
  assert.equal(h.compiles(), 1);
  assert.equal(h.downloads.length, 1);
  assert.equal(h.timers.size, 0);
});

for (const [label, doc] of [
  ['another taxpayer', pdfHeader({ type: '3B', gstin: '27BBBBB0000B1Z5' })],
  ['unknown headers', { content: [] }],
  ['missing FY', pdfHeader({ type: '3B', fy: null })]
]) {
  test(`3B production engine blocks ${label} before compilation`, async () => {
    const h = harness(doc);
    const result = await h.run();
    assert.equal(result.success, false);
    assert.equal(h.compiles(), 0);
    assert.equal(h.downloads.length, 0);
  });
}

test('3B saveAs fallback cannot bypass docDefinition identity validation', async () => {
  const h = harness(pdfHeader({ type: '3B' }), { fallbackOnly: true });
  const result = await h.run();
  assert.equal(result.success, false);
  assert.match(result.error, /identity was not verified/);
  assert.equal(h.downloads.length, 0);
});

test('missing scope settles before timeout initialization instead of throwing a TDZ error', async () => {
  const h = harness(pdfHeader({ type: '3B' }), { noScope: true });
  const result = await h.run();
  assert.equal(result.success, false);
  assert.match(result.error, /not found/);
  assert.equal(h.downloads.length, 0);
});
