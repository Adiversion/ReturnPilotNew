/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * ReturnPilot — Master Automated Verification & Multi-Tier Test Pipeline
 * ═══════════════════════════════════════════════════════════════════════════════
 * Executes all test tiers in sequence with 0 skips:
 *  Tier 1: Pre-Build Chrome Web Store Compliance Quality Gate (12 checks)
 *  Tier 2: Architecture Standards & Cryptographic E2E Suite (16 checks)
 *  Tier 3: Multi-Browser Production Build (Chrome, Edge, Firefox)
 *  Tier 4: Deep V8 AST, Runtime Simulation & Asset Verification (26 checks)
 *  Tier 5: Real Chromium Playwright Browser Smoke Test (17 checks)
 * ═══════════════════════════════════════════════════════════════════════════════
 */

'use strict';

const path = require('path');
const child_process = require('child_process');

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m'
};

const rootDir = path.resolve(__dirname, '..');

async function runMasterTestPipeline() {
  console.log(`\n${ANSI.bold}${ANSI.cyan}🚀 STARTING RETURNPILOT UNIFIED MASTER TEST PIPELINE...${ANSI.reset}`);
  console.log(`${ANSI.dim}=============================================================================${ANSI.reset}`);

  const startTime = Date.now();

  try {
    // Safety foundation tests exercise the production coordinator, without GST access.
    child_process.execFileSync(process.execPath, ['--test', 'tests/download-coordinator.test.cjs', 'tests/gstr2b-frame.test.cjs', 'tests/gstr2b-output.test.cjs', 'tests/pdf-identity.test.cjs', 'tests/gstr3b-identity.test.cjs'], {
      cwd: rootDir,
      stdio: 'inherit'
    });

    // ── TIER 1: Pre-Build Chrome Web Store Compliance Quality Gate ──
    console.log(`\n${ANSI.bold}📌 [TIER 1/5] Running CWS Policy & Compliance Quality Gate...${ANSI.reset}`);
    const { runComplianceChecks } = require('./verify-webstore-compliance.js');
    const compliancePassed = runComplianceChecks();
    if (!compliancePassed) {
      throw new Error('Tier 1 Failed: Chrome Web Store compliance gate failed.');
    }

    // ── TIER 2: Architecture Standards & Cryptographic E2E Suite ──
    console.log(`\n${ANSI.bold}📌 [TIER 2/5] Running Architecture & Cryptographic E2E Suite...${ANSI.reset}`);
    const { runE2ETests } = require('../tests/run-e2e.js');
    const e2ePassed = runE2ETests();
    if (!e2ePassed) {
      throw new Error('Tier 2 Failed: Architecture E2E test suite failed.');
    }

    // ── TIER 3 & 4: Production Build & Post-Build AST Verification ──
    console.log(`\n${ANSI.bold}📌 [TIER 3/5 & 4/5] Running Multi-Browser Production Build & Deep AST Gate...${ANSI.reset}`);
    child_process.execSync(`node "${path.join(__dirname, 'build-production.js')}"`, {
      cwd: rootDir,
      stdio: 'inherit'
    });

    // ── TIER 5: Real Chromium Playwright Browser Smoke Test ──
    console.log(`\n${ANSI.bold}📌 [TIER 5/5] Running Playwright Real Browser Smoke Test Suite...${ANSI.reset}`);
    const { runSmokeTest } = require('../tests/smoke-test.js');
    await runSmokeTest();

    const totalSeconds = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`${ANSI.dim}=============================================================================${ANSI.reset}`);
    console.log(`${ANSI.bold}${ANSI.green}🎉 ALL 5 TEST TIERS PASSED WITH ZERO ERRORS & ZERO SKIPS (${totalSeconds}s)!${ANSI.reset}\n`);
    process.exit(0);

  } catch (err) {
    console.error(`\n${ANSI.bold}${ANSI.red}❌ MASTER TEST PIPELINE FAILED: ${err.message}${ANSI.reset}\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  runMasterTestPipeline();
}

module.exports = { runMasterTestPipeline };
