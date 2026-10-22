// ═══════════════════════════════════════════════════════════════════════════════
//  ReturnPilot — Master Systems, Security & Compliance Audit Pipeline
// ═══════════════════════════════════════════════════════════════════════════════
//  Orchestrates and executes all audit test suites:
//   1. Declarative Net Request (DNR) & CORS Safety Audit
//   2. Consolidated Sheets Party Name Resolution Audit
//   3. Architecture Standards & Cryptographic E2E Audit
//   4. Client vs Server License Gating & Feature Access Audit
//   5. Authorization & Server Seal Security Audit
// ═══════════════════════════════════════════════════════════════════════════════

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
  magenta: '\x1b[35m',
  dim: '\x1b[2m'
};

const rootDir = path.resolve(__dirname, '..');

const AUDIT_SUITES = [
  {
    name: '1. Declarative Net Request (DNR) & CORS Safety Audit',
    file: 'tests/dnr-rules-audit.js',
    description: 'Verifies domain anchoring, CORS spec compliance, and cross-subdomain initiator isolation.'
  },
  {
    name: '2. Consolidated Sheets Party Name Resolution Audit',
    file: 'tests/party-resolution-audit.js',
    description: 'Verifies tradeNam="NA" fallback to lgnm across Sales, Purchase, and Taxpayer APIs.'
  },
  {
    name: '3. Architecture Standards & Cryptographic E2E Audit',
    file: 'tests/run-e2e.js',
    description: 'Verifies Manifest V3, CSP, host permissions, folder routing, and CWS asset dimensions.'
  },
  {
    name: '4. Client vs Server Feature License Audit',
    file: 'tests/client-license-audit.js',
    description: 'Verifies local license tampering resistance and server-side CAPTCHA solver protection.'
  },
  {
    name: '5. Authorization & Server Seal Security Audit',
    file: 'tests/auth-audit.js',
    description: 'Verifies authoritative server-side license verification against unauthenticated requests.'
  },
  {
    name: '6. CWS Review Process & DNR Safe Rules Audit',
    file: 'tests/cws-fast-approval-dnr-audit.js',
    description: 'Verifies CWS Review Guidelines, DNR safe rules, quotas, header validation, and fast approval readiness.'
  }
];

async function runMasterAuditPipeline() {
  console.log(`\n${ANSI.bold}${ANSI.cyan}╔════════════════════════════════════════════════════════════════════════════╗${ANSI.reset}`);
  console.log(`${ANSI.bold}${ANSI.cyan}║ RETURNPILOT — UNIFIED MASTER SECURITY & INTEGRITY AUDIT SUITE              ║${ANSI.reset}`);
  console.log(`${ANSI.bold}${ANSI.cyan}╚════════════════════════════════════════════════════════════════════════════╝${ANSI.reset}\n`);

  const startTime = Date.now();
  const results = [];

  for (const suite of AUDIT_SUITES) {
    console.log(`\n${ANSI.bold}▶ Executing Audit: ${suite.name}${ANSI.reset}`);
    console.log(`  ${ANSI.dim}${suite.description}${ANSI.reset}`);
    console.log(`${ANSI.dim}─────────────────────────────────────────────────────────────────────────────${ANSI.reset}`);

    const suiteStart = Date.now();
    try {
      child_process.execSync(`node "${path.join(rootDir, suite.file)}"`, {
        cwd: rootDir,
        stdio: 'inherit',
        timeout: 30000
      });
      const duration = ((Date.now() - suiteStart) / 1000).toFixed(2);
      results.push({ name: suite.name, status: 'PASSED', duration });
    } catch (err) {
      const duration = ((Date.now() - suiteStart) / 1000).toFixed(2);
      results.push({ name: suite.name, status: 'FAILED', duration, error: err.message });
    }
  }

  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log(`\n${ANSI.bold}${ANSI.cyan}╔═══════════════════════════════════════════════════════════════════════════════════════════════════╗${ANSI.reset}`);
  console.log(`${ANSI.bold}${ANSI.cyan}║ MASTER AUDIT SUMMARY REPORT                                                                       ║${ANSI.reset}`);
  console.log(`${ANSI.bold}${ANSI.cyan}╠═══════════════════════════════════════════════════════════════════════════════════════════════════╣${ANSI.reset}`);

  let allPassed = true;
  results.forEach(r => {
    const isPass = r.status === 'PASSED';
    if (!isPass) allPassed = false;
    const statusFormatted = isPass ? `${ANSI.green}✔ PASS${ANSI.reset}` : `${ANSI.red}✖ FAIL${ANSI.reset}`;
    const padding = ' '.repeat(Math.max(2, 65 - r.name.length));
    console.log(`║ ${r.name}${padding}${statusFormatted} (${r.duration}s) ║`);
  });

  console.log(`${ANSI.bold}${ANSI.cyan}╠═══════════════════════════════════════════════════════════════════════════════════════════════════╣${ANSI.reset}`);
  const overall = allPassed
    ? `${ANSI.green}ALL AUDITS PASSED CLEANLY (${totalDuration}s)${ANSI.reset}`
    : `${ANSI.red}ONE OR MORE AUDITS FAILED (${totalDuration}s)${ANSI.reset}`;
  console.log(`║ Overall Verdict: ${overall}`);
  console.log(`${ANSI.bold}${ANSI.cyan}╚═══════════════════════════════════════════════════════════════════════════════════════════════════╝${ANSI.reset}\n`);

  return allPassed;
}

if (require.main === module) {
  runMasterAuditPipeline().then(success => {
    process.exit(success ? 0 : 1);
  });
}

module.exports = { runMasterAuditPipeline };
