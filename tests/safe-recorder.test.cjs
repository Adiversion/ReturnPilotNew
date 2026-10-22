'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../tools/gst-safe-download-recorder.js'), 'utf8');
const GSTIN = '22AAAAA0000A1Z5';
const drain = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

function harness(hostname = 'gstr2b.gst.gov.in') {
  const blobs = [], timers = new Set();
  let requests = 0, fileClicks = 0;
  const secret = 'SECRET_AUTH_TOKEN_DO_NOT_EXPORT';
  class XHR {
    constructor() { this.listeners = new Map(); this.status = 200; this.responseType = 'json'; }
    open() {}
    addEventListener(k, v) { this.listeners.set(k, v); }
    removeEventListener(k, v) { if (this.listeners.get(k) === v) this.listeners.delete(k); }
    finish(response) { this.response = response; this.listeners.get('loadend')?.(); }
  }
  class Anchor { click() { fileClicks++; } dispatchEvent() { return true; } remove() {} }
  class LocalURL extends URL {}
  LocalURL.createObjectURL = blob => { blobs.push(blob); return 'blob:never-export-this'; };
  LocalURL.revokeObjectURL = () => {};
  class Workbook {
    constructor() { this.sheets = new Map(); }
    addWorksheet(name) { const sheet = { getCell: key => ({ value: { C4: '2026-27', C5: 'April', C6: GSTIN }[key] }) }; this.sheets.set(name, sheet); return sheet; }
    getWorksheet(name) { return this.sheets.get(name); }
  }
  const body = { status: 1, data: { r3b: { gstin: GSTIN, ret_period: '042026', sup_details: { secret, amount: 987654321 } }, token: secret, name: 'PRIVATE_TAXPAYER_NAME' } };
  const promise = Promise.resolve({ status: 200, clone: () => ({ text: async () => JSON.stringify(body) }) });
  const nativeFetch = () => { requests++; return promise; };
  const nativeOpen = XHR.prototype.open;
  const ctx = vm.createContext({
    location: { hostname, href: `https://${hostname}/gstr2b/auth/gstr2b/summary` },
    prompt: question => question.startsWith('GSTIN') ? GSTIN : '042026', confirm: () => true,
    performance: { now: () => 10 }, console: { info() {}, warn() {} },
    fetch: nativeFetch, XMLHttpRequest: XHR, URL: LocalURL, HTMLAnchorElement: Anchor, Blob,
    pdfMake: { createPdf: () => ({ download() {} }) }, ExcelJS: { Workbook },
    document: { createElement: () => new Anchor(), body: { appendChild() {} } },
    setInterval: fn => { timers.add(fn); return fn; }, clearInterval: fn => timers.delete(fn),
    setTimeout: () => 1
  });
  vm.runInContext(source, ctx);
  return { ctx, nativeFetch, nativeOpen, XHR, Workbook, promise, secret, requests: () => requests, fileClicks: () => fileClicks,
    async exportReport() { ctx.RP_SAFE_TRACE.export(); return JSON.parse(await blobs.at(-1).text()); }, timers };
}

test('installation sends no requests and stop restores wrappers', () => {
  const h = harness(); assert.equal(h.requests(), 0);
  h.ctx.RP_SAFE_TRACE.stop();
  assert.equal(h.ctx.fetch, h.nativeFetch);
  assert.equal(h.XHR.prototype.open, h.nativeOpen);
  assert.equal(h.timers.size, 0);
});

test('preserves fetch promise and exports matches/schema without raw personal or credential values', async () => {
  const h = harness();
  const result = h.ctx.fetch('https://return.gst.gov.in/returns/auth/api/gstr3b/getgenpdf?rtn_prd=042026');
  assert.equal(result, h.promise);
  await drain();
  const report = await h.exportReport();
  const output = JSON.stringify(report);
  for (const forbidden of [GSTIN, '042026', h.secret, 'PRIVATE_TAXPAYER_NAME', '987654321', 'blob:never-export-this']) assert.ok(!output.includes(forbidden));
  assert.equal(report.events[0].identities.r3b.taxpayerMatches, true);
  assert.equal(report.events[0].identities.r3b.periodMatches, true);
  assert.equal(report.browserCompletionObserved, false);
  assert.equal(report.userReportsFileSaved, true);
  assert.equal(h.requests(), 1);
});

test('wrong period and taxpayer produce booleans, not leaked values', async () => {
  const h = harness(); const xhr = new h.XHR();
  xhr.open('GET', '/gstr2b/auth/api/gstr2b/getdata?rtnprd=052026');
  xhr.finish({ status: 1, data: { gstin: '27BBBBB0000B1Z5', rtnprd: '052026', fc: 2 } });
  const report = await h.exportReport(); const event = report.events[0];
  assert.equal(event.requestPeriodMatches, false);
  assert.equal(event.identities.data.taxpayerMatches, false);
  assert.equal(event.identities.data.periodMatches, false);
  assert.equal(event.multipart.fcPresent, true);
  assert.ok(!JSON.stringify(report).includes('27BBBBB0000B1Z5'));
});

test('workbook identity is inspected without exporting cells or sheet names', async () => {
  const h = harness(); const book = new h.Workbook(); book.addWorksheet('Read me'); book.addWorksheet('PRIVATE_CUSTOM_SHEET');
  const report = await h.exportReport();
  assert.equal(report.workbookChecks[0].identity.taxpayerMatches, true);
  assert.equal(report.workbookChecks[0].identity.monthMatches, true);
  assert.ok(!JSON.stringify(report).includes('PRIVATE_CUSTOM_SHEET'));
});

test('unrelated endpoints and non-GST hosts are not inspected', async () => {
  const h = harness();
  h.ctx.fetch('https://other.example/returns/auth/api/gstr3b/getgenpdf?rtn_prd=042026');
  await drain();
  assert.equal((await h.exportReport()).events.length, 0);
  const outside = harness('other.example');
  assert.equal(outside.ctx.RP_SAFE_TRACE, undefined);
  assert.equal(outside.requests(), 0);
});

test('PDF observation leaves the document unchanged and exports only identity comparisons', async () => {
  const h = harness();
  const doc = { content: [
    { table: { body: [['Financial Year', '2026-27'], ['Month', 'April']] } },
    { table: { body: [[{ text: '1.GSTIN' }, GSTIN], ['Legal name', 'PRIVATE_PERSON']] } },
    { text: 'PRIVATE_INVOICE' }
  ] };
  const before = JSON.stringify(doc);
  h.ctx.pdfMake.createPdf(doc);
  assert.equal(JSON.stringify(doc), before);
  const report = await h.exportReport();
  const event = report.events.find(e => e.kind === 'pdf-definition');
  assert.equal(event.identity.taxpayerMatches, true);
  assert.equal(event.identity.monthMatches, true);
  assert.ok(!JSON.stringify(report).includes('PRIVATE_'));
});
