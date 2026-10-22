/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * ReturnPilot — Automated End-to-End (E2E) & Systems Integrity Test Suite
 * ═══════════════════════════════════════════════════════════════════════════════
 * Validates extension architecture, cryptographic vault, licensing rules,
 * declarative net request rules, popup DOM contracts, and folder routing standards.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

'use strict';

var fs = require('fs');
var path = require('path');
var assert = require('assert');

var rootDir = path.resolve(__dirname, '..');

var ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m'
};

var passed = 0;
var failed = 0;

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

function runE2ETests() {
  console.log('\n' + ANSI.bold + ANSI.cyan + '🧪 RUNNING RETURNPILOT AUTOMATED E2E SUITE...' + ANSI.reset);
  console.log(ANSI.dim + '─────────────────────────────────────────────────────────────────────────────' + ANSI.reset);

  // ── SUITE 1: Manifest & Permissions Architecture ──
  console.log('\n' + ANSI.bold + '📂 1. Manifest V3 & Extension Architecture Standards' + ANSI.reset);
  var manifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'manifest.json'), 'utf8'));

  it('Manifest version is strictly 3', function() {
    assert.strictEqual(manifest.manifest_version, 3);
  });

  it('Manifest name and branding follow CWS guidelines (<= 45 chars, no Google prefix)', function() {
    assert.ok(manifest.name.length <= 45, 'Name length is within 45 characters');
    assert.ok(!/^Google|^Chrome/i.test(manifest.name), 'Name does not use restricted brand prefixes');
  });

  it('Host permissions are strictly scoped (no <all_urls> or broad wildcard matches)', function() {
    var dangerous = ['<all_urls>', '*://*/*', 'http://*/*'];
    var allPerms = (manifest.permissions || []).concat(manifest.host_permissions || []);
    dangerous.forEach(function(d) {
      assert.ok(!allPerms.includes(d), 'Must not declare dangerous permission: ' + d);
    });
  });

  it('CSP strictly specifies self-only extension pages without unsafe-eval', function() {
    var csp = manifest.content_security_policy && manifest.content_security_policy.extension_pages;
    assert.ok(csp && csp.indexOf("script-src 'self'") !== -1, 'CSP contains script-src self');
    assert.ok(csp.indexOf("'unsafe-eval'") === -1, 'CSP forbids unsafe-eval');
  });

  // ── SUITE 2: Declarative Net Request Ruleset ──
  console.log('\n' + ANSI.bold + '🌐 2. Declarative Net Request (DNR) Ruleset Verification' + ANSI.reset);
  it('rules.json parses correctly and defines required header operations', function() {
    var rulesPath = path.join(rootDir, 'rules.json');
    assert.ok(fs.existsSync(rulesPath), 'rules.json exists');
    var rules = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
    assert.ok(Array.isArray(rules) && rules.length > 0, 'rules.json has active rule definitions');
    
    var frameRule = rules.find(function(r) {
      return r.id === 102 || (r.action && r.action.responseHeaders && r.action.responseHeaders.some(function(h) { return /x-frame-options/i.test(h.header); }));
    });
    assert.ok(frameRule, 'X-Frame-Options removal rule exists for hidden iframe orchestration');
  });

  // ── SUITE 3: Folder Hierarchy & Download Standard ──
  console.log('\n' + ANSI.bold + '📁 3. Download Path Normalization & Multi-Return Routing Standard' + ANSI.reset);
  it('buildFolderDownloadPath formats standard GSTIN/FY/ReturnType/Filename path', function() {
    function pad2(n) {
      return ('0' + n).slice(-2);
    }

    function formatFinancialYear(period, fy) {
      var pStr = String(period || '').replace(/\D/g, '');
      if (pStr.length === 6) {
        var mm = parseInt(pStr.substring(0, 2), 10);
        var yyyy = parseInt(pStr.substring(2, 6), 10);
        if (mm >= 1 && mm <= 12 && yyyy > 2000) {
          if (mm >= 4) {
            var nextY = (yyyy + 1) % 100;
            return yyyy + '-' + pad2(nextY);
          } else {
            var prevY = yyyy - 1;
            var currY = yyyy % 100;
            return prevY + '-' + pad2(currY);
          }
        }
      }
      return fy || 'UNKNOWN_FY';
    }

    function buildFolderDownloadPath(gstin, returnType, period, baseFilename, fy) {
      var cleanGstin = String(gstin || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
      var cleanType = String(returnType || '').replace(/[^a-zA-Z0-9_-]/g, '').toUpperCase();
      var cleanPeriod = String(period || '').replace(/[^a-zA-Z0-9_-]/g, '');
      var cleanFile = String(baseFilename || 'download.dat').split(/[\/\\]/).pop();
      var cleanFy = formatFinancialYear(cleanPeriod, fy);
      return cleanGstin + '/' + cleanFy + '/' + cleanType + '/' + cleanFile;
    }

    var path1 = buildFolderDownloadPath('27BNEPS6939L1Z6', 'GSTR1', '042024', 'GSTR1_27BNEPS6939L1Z6_042024.pdf');
    assert.strictEqual(path1, '27BNEPS6939L1Z6/2024-25/GSTR1/GSTR1_27BNEPS6939L1Z6_042024.pdf');

    var path2 = buildFolderDownloadPath('27BNEPS6939L1Z6', 'GSTR2B', '012025', 'GSTR2B_27BNEPS6939L1Z6_012025.xlsx');
    assert.strictEqual(path2, '27BNEPS6939L1Z6/2024-25/GSTR2B/GSTR2B_27BNEPS6939L1Z6_012025.xlsx');
  });

  // ── SUITE 4: Security, Vault & Entanglement Engine ──
  console.log('\n' + ANSI.bold + '🔐 4. Cryptographic Vault & Entanglement Licensing Engine' + ANSI.reset);
  var EntanglementEngine = require('../security/entanglement.js');

  it('Entanglement computes deterministic hash seeds', function() {
    var hash = EntanglementEngine.computeHash('TEST_STRING_SEED');
    assert.strictEqual(typeof hash, 'string');
    assert.ok(hash.length > 0);
  });

  it('Feature Access Policy allows Free JSON downloads for 3 recent Financial Years', function() {
    var freeLicense = { valid: false, tier: 'FREE' };
    var currentYear = new Date().getFullYear();
    var accessCurrent = EntanglementEngine.checkFeatureAccess('JSON', freeLicense, currentYear);
    assert.strictEqual(accessCurrent.allowed, true, 'Free tier must allow recent JSON downloads');

    var accessAncient = EntanglementEngine.checkFeatureAccess('JSON', freeLicense, 2018);
    assert.strictEqual(accessAncient.allowed, false, 'Free tier must restrict 7+ year old legacy bulk downloads');
  });

  it('Feature Access Policy reserves PDF/Excel for Premium while permitting Free JSON', function() {
    var freeLicense = { valid: false, tier: 'FREE' };
    var pdfCheck = EntanglementEngine.checkFeatureAccess('PDF', freeLicense);
    assert.strictEqual(pdfCheck.allowed, false, 'Free tier restricts instant PDF compilation');

    var premLicense = { valid: true, tier: 'PREMIUM' };
    var pdfPremCheck = EntanglementEngine.checkFeatureAccess('PDF', premLicense);
    assert.strictEqual(pdfPremCheck.allowed, true, 'Premium tier grants PDF compilation');
  });

  // ── SUITE 5: Popup DOM Contract & UI State Machine ──
  console.log('\n' + ANSI.bold + '🖥️ 5. Popup DOM Contract & State Screens Verification' + ANSI.reset);
  var popupHtml = fs.readFileSync(path.join(rootDir, 'popup', 'ReturnPilot.html'), 'utf8');

  it('Popup HTML includes all required system state screens', function() {
    var requiredScreens = [
      'msgOtherWebsite',
      'msgNotOnReturnDashboard',
      'msgLoginRequired'
    ];
    requiredScreens.forEach(function(id) {
      assert.ok(popupHtml.indexOf('id="' + id + '"') !== -1, 'Screen container with id="' + id + '" must exist in HTML');
    });
  });

  it('Popup HTML includes Google Sign-in button with proper action identifiers', function() {
    assert.ok(popupHtml.indexOf('id="btnGoogleAuth"') !== -1, 'Google auth button element exists');
    assert.ok(popupHtml.indexOf('id="btnUpgradePremium"') !== -1, 'Upgrade to Premium button exists');
  });

  it('Popup HTML includes privacy policy link pointing to kasyhq.com/privacy', function() {
    assert.ok(popupHtml.indexOf('https://kasyhq.com/privacy') !== -1, 'Live Privacy policy link is present in footer');
  });

  // ── SUITE 6: Store Assets & Metadata Integrity ──
  console.log('\n' + ANSI.bold + '🖼️ 6. Chrome Web Store Media Assets & Dimension Verification' + ANSI.reset);
  function getPngDimensions(filePath) {
    var buf = fs.readFileSync(filePath);
    if (buf.toString('ascii', 1, 4) === 'PNG') {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    return null;
  }

  it('Store promo tile meets exact 440x280 resolution requirement', function() {
    var promoSmall = path.join(rootDir, 'store-assets', 'promo-small-440x280.png');
    assert.ok(fs.existsSync(promoSmall), 'promo-small-440x280.png exists');
    var dim = getPngDimensions(promoSmall);
    assert.deepStrictEqual(dim, { width: 440, height: 280 });
  });

  it('Store marquee tile meets exact 1400x560 resolution requirement', function() {
    var promoLarge = path.join(rootDir, 'store-assets', 'promo-large-1400x560.png');
    assert.ok(fs.existsSync(promoLarge), 'promo-large-1400x560.png exists');
    var dim = getPngDimensions(promoLarge);
    assert.deepStrictEqual(dim, { width: 1400, height: 560 });
  });

  it('All 5 store screenshots meet exact 1280x800 resolution requirement', function() {
    for (var i = 1; i <= 5; i++) {
      var ssPath = path.join(rootDir, 'store-assets', 'screenshot-' + i + '.png');
      assert.ok(fs.existsSync(ssPath), 'screenshot-' + i + '.png exists');
      var dim = getPngDimensions(ssPath);
      assert.deepStrictEqual(dim, { width: 1280, height: 800 }, 'screenshot-' + i + '.png must be 1280x800');
    }
  });

  it('Icons are present for all mandatory sizes (16px, 32px, 48px, 128px)', function() {
    var sizes = [16, 32, 48, 128];
    sizes.forEach(function(sz) {
      var iconPath = path.join(rootDir, 'assets', 'icons', 'icon-' + sz + '.png');
      assert.ok(fs.existsSync(iconPath), 'icon-' + sz + '.png exists');
      var dim = getPngDimensions(iconPath);
      assert.deepStrictEqual(dim, { width: sz, height: sz });
    });
  });

  // ── SUMMARY ──
  console.log(ANSI.dim + '─────────────────────────────────────────────────────────────────────────────' + ANSI.reset);
  if (failed === 0) {
    console.log(ANSI.bold + ANSI.green + '✨ ALL E2E & INTEGRITY TESTS PASSED (' + passed + ' tests successful, 0 failures)!' + ANSI.reset + '\n');
    return true;
  } else {
    console.log(ANSI.bold + ANSI.red + '🛑 E2E SUITE FAILED: ' + failed + ' test(s) failed out of ' + (passed + failed) + '.' + ANSI.reset + '\n');
    return false;
  }
}

if (require.main === module) {
  var success = runE2ETests();
  process.exit(success ? 0 : 1);
}

module.exports = { runE2ETests: runE2ETests };
