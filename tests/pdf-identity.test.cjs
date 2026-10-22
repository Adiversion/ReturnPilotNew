'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { GSTIN, pdfHeader } = require('./fixtures/pdf-identity.cjs');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../content/return-identity.js'), 'utf8'), context);
const validate = (doc, expected) => context.ReturnPilotIdentity.validatePdf(doc, {
  returnType: doc?.content?.[0]?.text?.includes('3B') ? 'GSTR3B' : 'GSTR2B', ...expected
});

for (const type of ['2B', '3B']) {
  test(`${type}: accepts matching April and rejects it for another month`, () => {
    const doc = pdfHeader({ type });
    assert.equal(validate(doc, { gstin: GSTIN, period: '042026' }).period, '042026');
    for (const period of ['052026', '072026', '042025']) {
      assert.throws(() => validate(doc, { gstin: GSTIN, period }), /does not match/);
    }
  });
  test(`${type}: distinguishes May/July from April and rejects another taxpayer`, () => {
    for (const [month, period] of [['May', '052026'], ['July', '072026']]) {
      const doc = pdfHeader({ type, month });
      assert.equal(validate(doc, { gstin: GSTIN, period }).period, period);
      assert.throws(() => validate(doc, { gstin: GSTIN, period: '042026' }), /does not match/);
      assert.throws(() => validate(doc, { gstin: '27BBBBB0000B1Z5', period }), /does not match/);
    }
  });
}

test('January/March use the financial year end, not start', () => {
  for (const [month, period] of [['January', '012027'], ['March', '032027']]) {
    assert.equal(validate(pdfHeader({ month }), { gstin: GSTIN, period }).period, period);
  }
});

test('missing or inconsistent FY fails rather than borrowing the requested year', () => {
  for (const fy of ['', null, '2025-27', 'unknown']) {
    assert.throws(() => validate(pdfHeader({ fy }), { gstin: GSTIN, period: '042026' }));
  }
});

test('conflicting headers fail; unrelated text and amounts are not identity evidence', () => {
  const doc = pdfHeader();
  doc.content.push({ table: { body: [['Month', 'July']] } });
  assert.throws(() => validate(doc, { gstin: GSTIN, period: '042026' }), /ambiguous/);
  assert.throws(() => validate({ content: [{ text: `${GSTIN} 042026` }] }, { gstin: GSTIN, period: '042026' }), /missing|return type/);
});

test('validation does not mutate the source, and nil totals are irrelevant', () => {
  const doc = pdfHeader(); doc.content.push({ table: { body: [['Total', 0]] } });
  const before = JSON.stringify(doc);
  assert.ok(Object.isFrozen(validate(doc, { gstin: GSTIN, period: '042026' })));
  assert.equal(JSON.stringify(doc), before);
});

test('missing request identity fails closed', () => {
  assert.throws(() => validate(pdfHeader(), { period: '042026' }), /requires/);
  assert.throws(() => validate(pdfHeader(), { gstin: GSTIN, period: '132026' }), /requires/);
});

test('2B bridge loads guard before inject script and never starts it after a load error', () => {
  function bridge() {
    const scripts = [];
    const ctx = vm.createContext({
      window: { name: '', addEventListener() {} }, location: { href: 'https://gstr2b.gst.gov.in/' },
      console: { log() {}, error() {}, warn() {} },
      chrome: { runtime: { getURL: p => `chrome-extension://test/${p}` } },
      document: { createElement: () => ({ remove() {} }), head: { appendChild: s => scripts.push(s) } }
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../content/2b-contentscript.js'), 'utf8'), ctx);
    return scripts;
  }
  const scripts = bridge();
  assert.equal(scripts.length, 1);
  assert.ok(scripts[0].src.endsWith('content/return-identity.js'));
  scripts[0].onload();
  assert.equal(scripts.length, 2);
  assert.ok(scripts[1].src.endsWith('content/2b-inject.js'));
  const failed = bridge(); failed[0].onerror();
  assert.equal(failed.length, 1);
});

test('identity helper is packaged as an accessible local resource', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../manifest.json'), 'utf8'));
  assert.ok(manifest.web_accessible_resources.some(group =>
    group.resources.includes('content/return-identity.js') && group.matches.includes('https://gstr2b.gst.gov.in/*')));
});


test('same taxpayer/month from a different return cannot pass', () => {
  assert.throws(() => validate(pdfHeader({ type: '3B' }), {
    gstin: GSTIN, period: '042026', returnType: 'GSTR2B'
  }), /return type/);
});
