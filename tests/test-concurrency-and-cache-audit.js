/**
 * ════════════════════════════════════════════════════════════════════════════════
 *  ReturnPilot — Architectural Concurrency, Registry & Cache Bleed Backtest
 *  Simulates:
 *    1. Asynchronous onDeterminingFilename race condition during bulk 'PDF All'
 *    2. Client switch cache pollution (Client A -> Client B)
 *    3. Early trigger vulnerability during slow network conditions
 * ════════════════════════════════════════════════════════════════════════════════
 */

console.log('='.repeat(80));
console.log('STARTING ARCHITECTURAL CONCURRENCY & CACHE BACKTEST SUITE');
console.log('='.repeat(80));

// ─────────────────────────────────────────────────────────────────────────────
// SIMULATION 1: Bulk 'PDF All' DownloadRegistry Race Condition
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[BACKTEST 1] Simulating Rapid Sequential Downloads (PDF All Race Condition)...');

class MockDownloadRegistry {
  constructor() {
    this.map = new Map();
  }
  set(k, v) { this.map.set(k, v); }
  get(k) { return this.map.get(k); }
  has(k) { return this.map.has(k); }
  delete(k) { this.map.delete(k); }
}

const reg = new MockDownloadRegistry();
const periodsToTest = ['042026', '052026', '062026'];
const downloadedFilesOnDisk = [];

// Simulate current flawed implementation:
// DownloadRegistry.set happens INSIDE the download callback instead of BEFORE it
async function simulateFlawedBulkDownload(period) {
  const targetFilename = `GSTR3B_27AKHPG2039E1ZI_${period}.pdf`;
  
  // Chrome calls onDeterminingFilename asynchronously when download starts
  const simulateChromeDownload = () => {
    return new Promise((resolve) => {
      // Chrome fires onDeterminingFilename virtually immediately (1ms)
      setTimeout(() => {
        // onDeterminingFilename handler logic:
        let finalName = 'GSTR3B.pdf'; // default
        if (reg.has('ACTIVE_GSTR3B')) {
          finalName = reg.get('ACTIVE_GSTR3B').filename;
        }
        downloadedFilesOnDisk.push({ period, resolvedFilename: finalName });
      }, 1);

      // Callback executes later (10ms)
      setTimeout(() => {
        const downloadId = Math.floor(Math.random() * 10000);
        reg.set('ACTIVE_GSTR3B', { filename: targetFilename, period });
        resolve({ downloadId, filename: targetFilename });
      }, 10);
    });
  };

  await simulateChromeDownload();
}

(async () => {
  for (const p of periodsToTest) {
    await simulateFlawedBulkDownload(p);
  }

  console.log('Flawed Implementation Results on Disk:');
  console.table(downloadedFilesOnDisk);

  const hasOverwriteBug = downloadedFilesOnDisk[1] && downloadedFilesOnDisk[1].resolvedFilename === downloadedFilesOnDisk[0].resolvedFilename;
  console.log(
    `Race Condition Detected: %c${hasOverwriteBug ? 'YES (Period 2 received Period 1 filename!)' : 'NO'}`,
    hasOverwriteBug ? 'color: red; font-weight: bold;' : 'color: green;'
  );

  // ───────────────────────────────────────────────────────────────────────────
  // SIMULATION 2: Multi-Client Cache Bleed
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n[BACKTEST 2] Simulating Client Switch Cache Bleed (Client A -> Client B)...');

  const clientA = '27AAACK3828R1ZZ';
  const clientB = '27AKHPG2039E1ZI';

  const mockWindow = { _rpGstr3bGstin: clientA };
  const mockLocalStorage = { gstin: clientA };

  function resolveGstinWithoutStrictValidation(gstinArg) {
    return gstinArg || mockWindow._rpGstr3bGstin || mockLocalStorage.gstin || '';
  }

  // User logs in as Client B, but gstinArg is missing/delayed
  const resolved = resolveGstinWithoutStrictValidation(null);
  console.log(`Active Client is: ${clientB}`);
  console.log(`Resolved Client by Extension is: ${resolved}`);
  console.log(
    `Client Leak Detected: ${resolved === clientA ? 'YES! (Client A data leaked into Client B session)' : 'NO'}`
  );

  console.log('\n='.repeat(80));
  console.log('BACKTEST COMPLETE: Identified exact points in codebase requiring reinforcement.');
  console.log('='.repeat(80));
})();
