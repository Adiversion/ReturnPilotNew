// ═══════════════════════════════════════════════════════════════════════════════
//  ReturnPilot v4.1 — Declarative Net Request (DNR) & CORS Safety Audit
//  Validates rules.json for domain anchoring, CORS spec compliance,
//  and cross-subdomain initiator isolation.
// ═══════════════════════════════════════════════════════════════════════════════

'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const rootDir = path.resolve(__dirname, '..');
const rulesPath = path.join(rootDir, 'rules.json');

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m'
};

let passed = 0;
let failed = 0;

function it(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ' + ANSI.green + '✔ PASS' + ANSI.reset + '  ' + name);
  } catch (err) {
    failed++;
    console.log('  ' + ANSI.red + '✖ FAIL' + ANSI.reset + '  ' + name + '\n        ' + ANSI.dim + (err.stack || err.message) + ANSI.reset);
  }
}

function runDnrAudit() {
  console.log('\n' + ANSI.bold + ANSI.cyan + '🌐 RUNNING DECLARATIVE NET REQUEST & CORS AUDIT...' + ANSI.reset);
  console.log(ANSI.dim + '─────────────────────────────────────────────────────────────────────────────' + ANSI.reset);

  assert.ok(fs.existsSync(rulesPath), 'rules.json exists on disk');
  const rules = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));

  // 1. Rule IDs and Structure
  it('All rule IDs are positive, unique integers', () => {
    assert.ok(Array.isArray(rules) && rules.length > 0, 'rules.json is non-empty');
    const ids = rules.map(r => r.id);
    const idSet = new Set(ids);
    assert.strictEqual(ids.length, idSet.size, 'Duplicate rule IDs found!');
    ids.forEach(id => {
      assert.ok(Number.isInteger(id) && id > 0, `Invalid ID: ${id}`);
    });
  });

  // 2. Strict URL Filter Anchoring
  it('Domain-based urlFilter conditions are properly anchored with || and ^', () => {
    const domainRules = rules.filter(r => r.condition && r.condition.urlFilter && r.condition.urlFilter.includes('gst.gov.in'));
    domainRules.forEach(r => {
      const uf = r.condition.urlFilter;
      assert.ok(uf.startsWith('||'), `Rule ${r.id} urlFilter "${uf}" is unanchored (missing leading ||)`);
      assert.ok(uf.endsWith('^') || uf.includes('/'), `Rule ${r.id} urlFilter "${uf}" lacks domain boundary anchor (missing trailing ^ or /)`);
    });
  });

  // 3. Subdomain Isolation: services vs publicservices
  it('services.gst.gov.in rules never match publicservices.gst.gov.in', () => {
    const servicesRules = rules.filter(r => r.condition && r.condition.urlFilter && r.condition.urlFilter.includes('services.gst.gov.in') && !r.condition.urlFilter.includes('publicservices'));
    servicesRules.forEach(r => {
      const uf = r.condition.urlFilter;
      assert.ok(uf.startsWith('||services.gst.gov.in'), `Rule ${r.id} urlFilter "${uf}" will bleed into publicservices.gst.gov.in`);
    });
  });

  // 4. CORS Specification Compliance: No wildcard origin with credentials
  it('CORS rules never combine wildcard (*) origin with access-control-allow-credentials: true', () => {
    rules.forEach(r => {
      if (r.action && r.action.responseHeaders) {
        const originHeader = r.action.responseHeaders.find(h => h.header.toLowerCase() === 'access-control-allow-origin');
        const credHeader = r.action.responseHeaders.find(h => h.header.toLowerCase() === 'access-control-allow-credentials');
        if (originHeader && originHeader.value === '*') {
          assert.ok(!credHeader || credHeader.value !== 'true', `FATAL CORS VIOLATION in Rule ${r.id}: Cannot have origin "*" with credentials "true"`);
        }
      }
    });
  });

  // 5. Official GST Portal Search Taxpayer Preflight Safety
  it('Rule 115 grants access-control-allow-origin to services.gst.gov.in for publicservices', () => {
    const r115 = rules.find(r => r.id === 115);
    assert.ok(r115, 'Rule 115 exists');
    assert.strictEqual(r115.condition.urlFilter, '||publicservices.gst.gov.in^');
    assert.deepStrictEqual(r115.condition.initiatorDomains, ['services.gst.gov.in']);
    const originH = r115.action.responseHeaders.find(h => h.header.toLowerCase() === 'access-control-allow-origin');
    assert.ok(originH && originH.value === 'https://services.gst.gov.in', 'Rule 115 sets origin to services.gst.gov.in');
  });

  // 6. ReturnPilot Dashboard Preflight Safety
  it('Rule 116 grants access-control-allow-origin to return.gst.gov.in for publicservices', () => {
    const r116 = rules.find(r => r.id === 116);
    assert.ok(r116, 'Rule 116 exists');
    assert.strictEqual(r116.condition.urlFilter, '||publicservices.gst.gov.in^');
    assert.deepStrictEqual(r116.condition.initiatorDomains, ['return.gst.gov.in']);
    const originH = r116.action.responseHeaders.find(h => h.header.toLowerCase() === 'access-control-allow-origin');
    assert.ok(originH && originH.value === 'https://return.gst.gov.in', 'Rule 116 sets origin to return.gst.gov.in');
  });

  // 7. Hidden Iframe Embedding Support
  it('Iframe framing headers (X-Frame-Options & CSP) are stripped for all major GST subdomains', () => {
    const requiredDomains = [
      '||gstr2b.gst.gov.in^',
      '||gstr1a.gst.gov.in^',
      '||return.gst.gov.in^',
      '||returns2.gst.gov.in^',
      '||services.gst.gov.in^'
    ];
    requiredDomains.forEach(domain => {
      const match = rules.find(r => r.condition && r.condition.urlFilter === domain && r.condition.resourceTypes && r.condition.resourceTypes.includes('sub_frame'));
      assert.ok(match, `Missing frame header removal rule for ${domain}`);
    });
  });

  console.log(ANSI.dim + '─────────────────────────────────────────────────────────────────────────────' + ANSI.reset);
  console.log(`${ANSI.bold}${passed > 0 && failed === 0 ? ANSI.green : ANSI.red}DNR AUDIT RESULT: ${passed} passed, ${failed} failed.${ANSI.reset}\n`);
  return failed === 0;
}

if (require.main === module) {
  const ok = runDnrAudit();
  process.exit(ok ? 0 : 1);
}

module.exports = { runDnrAudit };
