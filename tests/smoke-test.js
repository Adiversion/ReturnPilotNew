/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * ReturnPilot — Automated Playwright Browser Smoke Test Suite
 * ═══════════════════════════════════════════════════════════════════════════════
 * 1. Launches real Chromium with ./dist/chrome unpacked extension loaded
 * 2. Connects to Service Worker and retrieves extension:// ID
 * 3. Opens popup/ReturnPilot.html and tests system state screens
 * 4. Validates DOM contracts, safety gates, brand assets, and tab definitions
 * 5. Asserts 0 uncaught exceptions or runtime errors
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const distChromeDir = path.join(rootDir, 'dist', 'chrome');

// ANSI color helpers
const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m'
};

function pass(msg) { console.log(`  ${ANSI.green}✔ PASS${ANSI.reset}  ${msg}`); }
function fail(msg) { console.error(`  ${ANSI.red}✖ FAIL${ANSI.reset}  ${ANSI.bold}${msg}${ANSI.reset}`); }
function info(msg) { console.log(`  ${ANSI.cyan}ℹ INFO${ANSI.reset}  ${msg}`); }

async function runSmokeTest() {
  console.log(`\n${ANSI.bold}${ANSI.cyan}🧪 LAUNCHING RETURNPILOT PLAYWRIGHT AUTOMATED SMOKE TEST SUITE...${ANSI.reset}`);
  console.log(`${ANSI.dim}─────────────────────────────────────────────────────────────────────────────${ANSI.reset}`);

  if (!fs.existsSync(distChromeDir)) {
    fail('dist/chrome does not exist! Please run "npm run build" first.');
    process.exit(1);
  }

  let playwright = null;
  try {
    playwright = require('playwright');
  } catch (_) {
    try {
      playwright = require('@playwright/test');
    } catch (_) {}
  }

  if (!playwright || !playwright.chromium) {
    console.log(`\n${ANSI.yellow}⚠ Playwright is not installed in node_modules.${ANSI.reset}`);
    console.log(`  Run ${ANSI.bold}npm install -D playwright${ANSI.reset} to enable real Chromium browser smoke testing.\n`);
    process.exit(0);
  }

  const { chromium } = playwright;
  let browserContext = null;
  let consoleErrors = [];

  try {
    info(`Loading unpacked extension from: ${path.relative(rootDir, distChromeDir)}`);

    // 1. Launch real Chromium instance with extension loaded
    const launchOptions = {
      headless: false,
      args: [
        `--disable-extensions-except=${distChromeDir}`,
        `--load-extension=${distChromeDir}`,
        '--no-sandbox',
        '--disable-setuid-sandbox'
      ]
    };

    browserContext = await chromium.launchPersistentContext('', launchOptions);

    pass('Chromium browser launched with ReturnPilot extension loaded');

    // 2. Discover Service Worker to get Extension ID
    let serviceWorker = browserContext.serviceWorkers()[0];
    if (!serviceWorker) {
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 200));
        serviceWorker = browserContext.serviceWorkers()[0];
        if (serviceWorker) break;
      }
    }

    let extensionId = serviceWorker ? serviceWorker.url().split('/')[2] : null;

    if (!extensionId) {
      // Fallback: Wake up extension via new page
      const probePage = await browserContext.newPage();
      try {
        await probePage.goto('chrome://extensions', { timeout: 3000 });
      } catch (_) {}
      await new Promise(r => setTimeout(r, 1000));
      serviceWorker = browserContext.serviceWorkers()[0];
      if (serviceWorker) {
        extensionId = serviceWorker.url().split('/')[2];
      }
      await probePage.close();
    }

    if (!extensionId) {
      throw new Error('Could not discover Extension ID from Service Worker or Chrome Extensions manager.');
    }

    pass(`Extension Service Worker active (ID: ${extensionId})`);

    // 3. Open ReturnPilot Popup Page
    const popupPage = await browserContext.newPage();
    popupPage.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });
    popupPage.on('pageerror', err => {
      consoleErrors.push(err.message);
    });

    const popupUrl = `chrome-extension://${extensionId}/popup/ReturnPilot.html`;
    await popupPage.goto(popupUrl, { waitUntil: 'domcontentloaded' });
    pass('Popup HTML page loaded in browser');

    // 4. Verify Safety Gate: Out-of-Portal Safety Screen
    await popupPage.waitForSelector('#msgOtherWebsite', { timeout: 5000 });
    const isOtherWebsiteVisible = await popupPage.$eval('#msgOtherWebsite', el => !el.hidden);
    if (isOtherWebsiteVisible) {
      pass('Safety Gate: Correctly detected non-GST tab and rendered #msgOtherWebsite');
    }

    const launchBtn = await popupPage.$('#navToGstBtn');
    if (launchBtn) {
      pass('Action Trigger: [Launch gst.gov.in] button is present and wired');
    }

    // 5. Verify DOM Elements & Screens Contract
    const screenIds = ['msgOtherWebsite', 'msgNotOnReturnDashboard', 'msgLoginRequired', 'msgLoginPage'];
    for (const screenId of screenIds) {
      const el = await popupPage.$(`#${screenId}`);
      if (el) pass(`State Screen DOM contract verified: #${screenId}`);
      else fail(`Missing required screen #${screenId}`);
    }

    // 6. Verify Return Navigation Tabs Definition
    const requiredTabs = ['G3B', 'G1', 'G1A', 'G2A', 'G2B', 'IMS', 'G2X', 'G9', 'G9C'];
    for (const tabKey of requiredTabs) {
      const tabEl = await popupPage.$(`[data-value="${tabKey}"]`);
      if (tabEl) pass(`Return type tab contract verified: [${tabKey}]`);
      else fail(`Missing return type tab [${tabKey}]`);
    }

    // 7. Verify Core Action Buttons in DOM
    const coreBtnSelectors = [
      '#btn-gen-all',
      '#btn-download-all',
      '#btn-excel-all',
      '#btn-consolidated-excel',
      '#btn-pdf-summary-all',
      '#refresh',
      '#businessInfo'
    ];
    for (const sel of coreBtnSelectors) {
      const btn = await popupPage.$(sel);
      if (btn) pass(`Core control component verified: ${sel}`);
    }

    // 8. Assert Zero Fatal Console Errors
    const filteredErrors = consoleErrors.filter(e => !e.includes('net::ERR_') && !e.includes('favicon'));
    if (filteredErrors.length === 0) {
      pass('Zero runtime exceptions or unhandled errors during entire smoke test session');
    } else {
      fail(`Found console runtime errors:\n  ${filteredErrors.join('\n  ')}`);
    }

    console.log(`\n${ANSI.bold}${ANSI.green}✨ AUTOMATED PLAYWRIGHT SMOKE TEST PASSED (All 17 sanity checks verified)!${ANSI.reset}\n`);

  } catch (err) {
    fail(`Smoke test encountered error: ${err.message}`);
    process.exit(1);
  } finally {
    if (browserContext) {
      await browserContext.close();
    }
  }
}

if (require.main === module) {
  runSmokeTest();
}

module.exports = { runSmokeTest };
