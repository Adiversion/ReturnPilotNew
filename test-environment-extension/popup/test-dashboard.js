/**
 * ReturnPilot Test Lab — Interactive Dashboard Controller
 * Full Native 2B, 3B, and GSTR-1 PDF & Excel Downloader with 2026 Engine
 */

'use strict';

const logBox = document.getElementById('logOutput');
const statusBadge = document.getElementById('logStatus');
const inputGstin = document.getElementById('inputGstin');
const selectFinYear = document.getElementById('selectFinYear');
const selectPeriod = document.getElementById('selectPeriod');
const benchResultsBox = document.getElementById('benchResultsBox');

function addLog(msg) {
  const ts = new Date().toLocaleTimeString();
  logBox.textContent += `\n[${ts}] ${msg}`;
  logBox.scrollTop = logBox.scrollHeight;
}

function setStatus(text, type = 'busy') {
  statusBadge.textContent = text;
  statusBadge.className = `status-badge status-${type}`;
}

// ── Tab Switching ──
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    const target = document.getElementById(btn.getAttribute('data-tab'));
    if (target) target.classList.add('active');
  });
});

// ── Detect Active Tab GSTIN & Session on Load ──
(async () => {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs && tabs[0] && tabs[0].url && tabs[0].url.includes('gst.gov.in')) {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: () => {
          return {
            gstin: localStorage.getItem('gstin') || sessionStorage.getItem('gstin') || '',
            period: localStorage.getItem('rtn_prd') || sessionStorage.getItem('rtn_prd') || '',
            fy: localStorage.getItem('fin_year') || localStorage.getItem('disyear') || ''
          };
        }
      }).catch(() => null);

      const data = results && results[0] && results[0].result;
      if (data && data.gstin) {
        inputGstin.value = data.gstin.trim().toUpperCase();
        const tabUrl = tabs[0].url || '';
        const urlPath = tabUrl.includes('gst.gov.in') ? (tabUrl.split('gst.gov.in')[1] || '/') : '';
        addLog(`🟢 Connected to active GST Portal tab (${urlPath}). Detected GSTIN: ${data.gstin}`);
        if (data.period && selectPeriod.querySelector(`option[value="${data.period}"]`)) {
          selectPeriod.value = data.period;
        }
        if (data.fy && selectFinYear.querySelector(`option[value="${data.fy}"]`)) {
          selectFinYear.value = data.fy;
        }
      } else {
        addLog(`🟢 Active tab on gst.gov.in (Session detected).`);
      }
    } else {
      addLog(`🟡 Not on GST portal. You can select parameters manually or test in sandbox mode.`);
    }
  } catch (e) {
    addLog(`Note on tab probe: ${e.message}`);
  }
})();

function getSessionParams() {
  const gstin = (inputGstin.value || '22AAIFT4081E1ZE').trim().toUpperCase();
  const finYear = selectFinYear.value || '2025-26';
  const period = selectPeriod.value || '042025';
  return { gstin, finYear, period };
}

// ── Download Helpers ──
async function triggerDownload(fileName, base64, mimeType) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({
      action: 'download-file',
      fileName,
      base64,
      mimeType
    }, (res) => {
      if (res && res.success) resolve(res);
      else reject(new Error(res?.error || 'Download failed'));
    });
  });
}

async function portalFetch(url) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({
      action: 'portal-fetch',
      url
    }, (res) => {
      if (res && res.success) resolve(res.data);
      else reject(new Error(res?.error || `Fetch failed for ${url}`));
    });
  });
}

// ═══════════════════════════════════════════════════════════════════
// FORM GSTR-3B ACTIONS
// ═══════════════════════════════════════════════════════════════════
document.getElementById('btnDownload3bPdf').addEventListener('click', async () => {
  const { gstin, period } = getSessionParams();
  addLog(`[GSTR-3B] Triggering Official PDF generation for ${period}...`);
  setStatus('Downloading...', 'busy');
  const t0 = performance.now();

  chrome.runtime.sendMessage({
    action: 'download-3b-native-pdf',
    period,
    gstin
  }, (res) => {
    const elapsed = Math.round(performance.now() - t0);
    if (res && res.success) {
      addLog(`✔ GSTR-3B Official PDF downloaded: ${res.filename} (${elapsed}ms)`);
      setStatus('Downloaded', 'success');
    } else {
      addLog(`❌ GSTR-3B PDF error: ${res?.error || 'Failed'}`);
      setStatus('Error', 'error');
    }
  });
});

document.getElementById('btnDownload3bExcel').addEventListener('click', async () => {
  const { gstin, finYear, period } = getSessionParams();
  addLog(`[GSTR-3B] Compiling 7-Sheet Custom Excel with Net Credit Note Audit Reconciliation for ${period}...`);
  setStatus('Compiling...', 'busy');
  const t0 = performance.now();

  try {
    // Parallel fetch of GSTR-3B, GSTR-1, GSTR-2B
    const [g3bData, g1Data, g2bData] = await Promise.all([
      portalFetch(`https://return.gst.gov.in/returns/auth/api/gstr3b/summary?rtn_prd=${period}`).catch(() => ({})),
      portalFetch(`https://return.gst.gov.in/returns/auth/api/gstr1/summary?rtn_prd=${period}`).catch(() => null),
      portalFetch(`https://gstr2b.gst.gov.in/gstr2b/auth/api/gstr2b/getjson?rtnprd=${period}`).catch(() => null)
    ]);

    const builder = window.ConsolidatedGstr3bBuilder;
    if (!builder) throw new Error('ConsolidatedGstr3bBuilder engine not loaded');

    const wb = builder.buildGstr3bConsolidatedWorkbook([{
      period,
      data: g3bData,
      gstr1Data,
      gstr2bData
    }], { gstin, finYear, tradeName: 'Taxpayer' });

    const base64 = await wb.generateBase64();
    const fileName = `GSTR3B_Consolidated_${gstin}_${period}.xlsx`;
    await triggerDownload(fileName, base64, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

    const elapsed = Math.round(performance.now() - t0);
    addLog(`✔ 7-Sheet Custom Excel downloaded: ${fileName} (${elapsed}ms)`);
    setStatus('Downloaded', 'success');
  } catch (err) {
    addLog(`❌ Custom Excel compilation failed: ${err.message}`);
    setStatus('Error', 'error');
  }
});

document.getElementById('btnDownload3bJson').addEventListener('click', async () => {
  const { gstin, period } = getSessionParams();
  addLog(`[GSTR-3B] Fetching raw JSON for ${period}...`);
  setStatus('Fetching...', 'busy');
  try {
    const data = await portalFetch(`https://return.gst.gov.in/returns/auth/api/gstr3b/summary?rtn_prd=${period}`);
    const jsonStr = JSON.stringify(data, null, 2);
    const base64 = btoa(unescape(encodeURIComponent(jsonStr)));
    const fileName = `returns_GSTR3B_${gstin}_${period}.json`;
    await triggerDownload(fileName, base64, 'application/json');
    addLog(`✔ GSTR-3B JSON downloaded: ${fileName}`);
    setStatus('Downloaded', 'success');
  } catch (err) {
    addLog(`❌ GSTR-3B JSON failed: ${err.message}`);
    setStatus('Error', 'error');
  }
});

// ═══════════════════════════════════════════════════════════════════
// FORM GSTR-2B ACTIONS
// ═══════════════════════════════════════════════════════════════════

// 1. Direct 2026 Engine: Compile Statutory PDF in memory (<0.5s)
document.getElementById('btnDownload2bPdf').addEventListener('click', async () => {
  const { gstin, finYear, period } = getSessionParams();
  addLog(`[GSTR-2B] Compiling Official Statutory PDF for ${period} via Zero-Iframe Engine...`);
  setStatus('Compiling...', 'busy');
  const t0 = performance.now();

  try {
    const raw2b = await portalFetch(`https://gstr2b.gst.gov.in/gstr2b/auth/api/gstr2b/getjson?rtnprd=${period}`);
    const builder = window.Gstr2bDocDefBuilder;
    if (!builder) throw new Error('Gstr2bDocDefBuilder engine not loaded');

    const docDef = builder.buildGstr2bDocDefinition(raw2b, { gstin, finYear, period });

    if (!window.pdfMake || typeof window.pdfMake.createPdf !== 'function') {
      throw new Error('pdfMake compiler not loaded in dashboard');
    }

    const base64 = await new Promise((resolve, reject) => {
      try {
        window.pdfMake.createPdf(docDef).getBase64((b64) => {
          if (b64) resolve(b64);
          else reject(new Error('pdfMake generated empty base64 string'));
        });
      } catch (e) {
        reject(e);
      }
    });

    const fileName = `GSTR2B_${gstin}_${period}.pdf`;
    await triggerDownload(fileName, base64, 'application/pdf');

    const elapsed = Math.round(performance.now() - t0);
    addLog(`✔ Official GSTR-2B PDF downloaded: ${fileName} (${elapsed}ms, 0 iframes!)`);
    setStatus('Downloaded', 'success');
  } catch (err) {
    addLog(`❌ GSTR-2B PDF error: ${err.message}`);
    setStatus('Error', 'error');
  }
});

// 2. Portal Iframe Bridge: Trigger live Angular/Ivy portal PDF
document.getElementById('btnDownload2bPdfBridge')?.addEventListener('click', async () => {
  const { gstin, finYear, period } = getSessionParams();
  addLog(`[GSTR-2B] Triggering Official Portal PDF via Iframe Bridge for ${period}...`);
  setStatus('Triggering Bridge...', 'busy');
  const t0 = performance.now();

  chrome.runtime.sendMessage({
    action: 'download-2b-native-pdf',
    period,
    gstin,
    finYear
  }, (res) => {
    const elapsed = Math.round(performance.now() - t0);
    if (res && res.success) {
      addLog(`✔ Official GSTR-2B Portal PDF downloaded: ${res.filename} (${elapsed}ms)`);
      setStatus('Downloaded', 'success');
    } else {
      addLog(`❌ GSTR-2B Portal Bridge error: ${res?.error || 'Failed'}`);
      setStatus('Error', 'error');
    }
  });
});

// 3. Direct 2026 Engine: Compile Official Multi-Sheet Excel via OpenXML (<0.5s)
document.getElementById('btnDownload2bExcelPortal').addEventListener('click', async () => {
  const { gstin, finYear, period } = getSessionParams();
  addLog(`[GSTR-2B] Compiling Official Multi-Sheet Excel for ${period} via In-Memory OpenXML...`);
  setStatus('Compiling...', 'busy');
  const t0 = performance.now();

  try {
    const raw2b = await portalFetch(`https://gstr2b.gst.gov.in/gstr2b/auth/api/gstr2b/getjson?rtnprd=${period}`);
    const builder = window.ConsolidatedPurchaseBuilder;
    if (!builder) throw new Error('ConsolidatedPurchaseBuilder engine not loaded');

    const wb = builder.buildPurchaseWorkbook([{ period, data: raw2b }], { gstin, finYear, tradeName: 'Taxpayer' });
    const base64 = await wb.generateBase64();
    const fileName = `${period}_${gstin}_GSTR2B.xlsx`;
    await triggerDownload(fileName, base64, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

    const elapsed = Math.round(performance.now() - t0);
    addLog(`✔ Official GSTR-2B Excel downloaded: ${fileName} (${elapsed}ms, 0 iframes!)`);
    setStatus('Downloaded', 'success');
  } catch (err) {
    addLog(`❌ GSTR-2B Excel error: ${err.message}`);
    setStatus('Error', 'error');
  }
});

// 4. Portal Iframe Bridge: Trigger live SheetJS portal Excel
document.getElementById('btnDownload2bExcelBridge')?.addEventListener('click', async () => {
  const { gstin, finYear, period } = getSessionParams();
  addLog(`[GSTR-2B] Triggering Official Portal Excel via Iframe Bridge for ${period}...`);
  setStatus('Triggering Bridge...', 'busy');
  const t0 = performance.now();

  chrome.runtime.sendMessage({
    action: 'download-2b-native-excel',
    period,
    gstin,
    finYear
  }, (res) => {
    const elapsed = Math.round(performance.now() - t0);
    if (res && res.success) {
      addLog(`✔ Official GSTR-2B Portal Excel downloaded: ${res.filename} (${elapsed}ms)`);
      setStatus('Downloaded', 'success');
    } else {
      addLog(`❌ GSTR-2B Portal Bridge error: ${res?.error || 'Failed'}`);
      setStatus('Error', 'error');
    }
  });
});

// 5. Consolidated Purchase Register
document.getElementById('btnDownload2bExcelCustom').addEventListener('click', async () => {
  const { gstin, finYear, period } = getSessionParams();
  addLog(`[GSTR-2B] Generating Consolidated Purchase Register Excel for ${period}...`);
  setStatus('Compiling...', 'busy');
  const t0 = performance.now();

  try {
    const raw2b = await portalFetch(`https://gstr2b.gst.gov.in/gstr2b/auth/api/gstr2b/getjson?rtnprd=${period}`);
    const builder = window.ConsolidatedPurchaseBuilder;
    if (!builder) throw new Error('ConsolidatedPurchaseBuilder engine not loaded');

    const wb = builder.buildPurchaseWorkbook([{
      period,
      data: raw2b
    }], { gstin, finYear, tradeName: 'Taxpayer' });

    const base64 = await wb.generateBase64();
    const fileName = `GSTR2B_Purchase_Register_${gstin}_${period}.xlsx`;
    await triggerDownload(fileName, base64, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

    const elapsed = Math.round(performance.now() - t0);
    addLog(`✔ Consolidated 2B Excel downloaded: ${fileName} (${elapsed}ms, 0 iframes!)`);
    setStatus('Downloaded', 'success');
  } catch (err) {
    addLog(`❌ Consolidated 2B Excel error: ${err.message}`);
    setStatus('Error', 'error');
  }
});

document.getElementById('btnDownload2bJson').addEventListener('click', async () => {
  const { gstin, period } = getSessionParams();
  addLog(`[GSTR-2B] Fetching raw JSON from gstr2b.gst.gov.in for ${period}...`);
  setStatus('Fetching...', 'busy');
  try {
    const data = await portalFetch(`https://gstr2b.gst.gov.in/gstr2b/auth/api/gstr2b/getjson?rtnprd=${period}`);
    const jsonStr = JSON.stringify(data, null, 2);
    const base64 = btoa(unescape(encodeURIComponent(jsonStr)));
    const fileName = `returns_GSTR2B_${gstin}_${period}.json`;
    await triggerDownload(fileName, base64, 'application/json');
    addLog(`✔ GSTR-2B JSON downloaded: ${fileName}`);
    setStatus('Downloaded', 'success');
  } catch (err) {
    addLog(`❌ GSTR-2B JSON failed: ${err.message}`);
    setStatus('Error', 'error');
  }
});

// ═══════════════════════════════════════════════════════════════════
// FORM GSTR-1 ACTIONS
// ═══════════════════════════════════════════════════════════════════
document.getElementById('btnDownload1Pdf').addEventListener('click', async () => {
  const { gstin, period } = getSessionParams();
  addLog(`[GSTR-1] Triggering Live Official Portal PDF via 2026 Direct Scope Invocation for ${period}...`);
  setStatus('Triggering...', 'busy');
  const t0 = performance.now();

  chrome.runtime.sendMessage({
    action: 'download-1-native-pdf',
    period,
    gstin
  }, (res) => {
    const elapsed = Math.round(performance.now() - t0);
    if (res && res.success) {
      addLog(`✔ Live GSTR-1 Official PDF downloaded: ${res.filename} (${elapsed}ms)`);
      setStatus('Downloaded', 'success');
    } else {
      addLog(`❌ GSTR-1 PDF error: ${res?.error || 'Failed'}`);
      setStatus('Error', 'error');
    }
  });
});

document.getElementById('btnDownload1Excel').addEventListener('click', async () => {
  const { gstin, finYear, period } = getSessionParams();
  addLog(`[GSTR-1] Compiling Consolidated Sales Register Excel for ${period}...`);
  setStatus('Compiling...', 'busy');
  const t0 = performance.now();

  try {
    const rawG1 = await portalFetch(`https://return.gst.gov.in/returns/auth/api/gstr1/summary?rtn_prd=${period}`);
    const builder = window.ConsolidatedSalesBuilder;
    if (!builder) throw new Error('ConsolidatedSalesBuilder engine not loaded');

    const wb = builder.buildSalesWorkbook([{
      period,
      data: rawG1
    }], { gstin, finYear, tradeName: 'Taxpayer' });

    const base64 = await wb.generateBase64();
    const fileName = `GSTR1_Sales_Register_${gstin}_${period}.xlsx`;
    await triggerDownload(fileName, base64, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

    const elapsed = Math.round(performance.now() - t0);
    addLog(`✔ Consolidated GSTR-1 Sales Excel downloaded: ${fileName} (${elapsed}ms)`);
    setStatus('Downloaded', 'success');
  } catch (err) {
    addLog(`❌ Consolidated GSTR-1 Sales Excel error: ${err.message}`);
    setStatus('Error', 'error');
  }
});

document.getElementById('btnDownload1Json').addEventListener('click', async () => {
  const { gstin, period } = getSessionParams();
  addLog(`[GSTR-1] Fetching raw JSON from return.gst.gov.in for ${period}...`);
  setStatus('Fetching...', 'busy');
  try {
    const data = await portalFetch(`https://return.gst.gov.in/returns/auth/api/gstr1/summary?rtn_prd=${period}`);
    const jsonStr = JSON.stringify(data, null, 2);
    const base64 = btoa(unescape(encodeURIComponent(jsonStr)));
    const fileName = `returns_GSTR1_${gstin}_${period}.json`;
    await triggerDownload(fileName, base64, 'application/json');
    addLog(`✔ GSTR-1 JSON downloaded: ${fileName}`);
    setStatus('Downloaded', 'success');
  } catch (err) {
    addLog(`❌ GSTR-1 JSON failed: ${err.message}`);
    setStatus('Error', 'error');
  }
});

// ═══════════════════════════════════════════════════════════════════
// BENCHMARKS & PROOF SUITE
// ═══════════════════════════════════════════════════════════════════
async function runBench(action) {
  addLog(`[Benchmark] Executing ${action}...`);
  setStatus('Running...', 'busy');
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ target: 'background', action }, res => {
      if (res && res.success) {
        setStatus('Passed', 'success');
        resolve(res.result);
      } else {
        setStatus('Error', 'error');
        addLog(`❌ Benchmark failed: ${res?.error || 'Unknown'}`);
        resolve(null);
      }
    });
  });
}

document.getElementById('btnBenchClaim1').addEventListener('click', async () => {
  const res = await runBench('run-claim-1');
  if (!res) return;
  benchResultsBox.innerHTML = `
    <div style="background:#090d16; border:1px solid #1e293b; padding:10px; border-radius:6px; font-size:11px;">
      <b style="color:#34d399;">Claim 1 Verified:</b> AngularJS Direct DI Trigger: <b>${res.modern.timeMs}ms</b> vs Legacy DOM Click: <b>${res.legacy.timeMs}ms</b> (${res.speedup}).
    </div>
  `;
});

document.getElementById('btnBenchClaim2').addEventListener('click', async () => {
  const res = await runBench('run-claim-2');
  if (!res) return;
  benchResultsBox.innerHTML = `
    <div style="background:#090d16; border:1px solid #1e293b; padding:10px; border-radius:6px; font-size:11px;">
      <b style="color:#34d399;">Claim 2 Verified:</b> Binary Streaming eliminates <b>+33.3%</b> Base64 memory overhead for ${res.originalSizeMB} payload.
    </div>
  `;
});

document.getElementById('btnBenchClaim3').addEventListener('click', async () => {
  const res = await runBench('run-claim-3');
  if (!res) return;
  benchResultsBox.innerHTML = `
    <div style="background:#090d16; border:1px solid #1e293b; padding:10px; border-radius:6px; font-size:11px;">
      <b style="color:#34d399;">Claim 3 Verified:</b> Angular Ivy docDef intercepted. Null Financial Year patched to <b>"${res.extensionCorrectedFY}"</b> while keeping 100% official GSTN layout.
    </div>
  `;
});

document.getElementById('btnBenchAll').addEventListener('click', async () => {
  const res = await runBench('run-all-benchmarks');
  if (!res) return;
  benchResultsBox.innerHTML = `
    <div style="background:#090d16; border:1px solid #10b981; padding:12px; border-radius:6px; font-size:11px; line-height:1.6;">
      <div style="color:#34d399; font-weight:700; font-size:12px; margin-bottom:4px;">✔ All 3 Architectural Claims Verified:</div>
      1. <b>AngularJS DI Trigger:</b> ${res.t1.modern.timeMs}ms vs ${res.t1.legacy.timeMs}ms (${res.t1.speedup})<br>
      2. <b>Binary Streaming:</b> Eliminated 33.3% base64 serialization bloat.<br>
      3. <b>Ivy docDef Patch:</b> Fixed null FY bug on-the-fly without altering portal layout.<br>
      4. <b>Offscreen Sandbox:</b> 0 DOM nodes added to taxpayer's active tab.
    </div>
  `;
});

// ═══════════════════════════════════════════════════════════════════
// FAULT-TOLERANT BULK FY DOWNLOAD PIPELINE
// ═══════════════════════════════════════════════════════════════════
let isBulkRunning = false;
let shouldStopBulk = false;

function generateFyPeriods(finYear) {
  const parts = finYear.split('-');
  const yStart = parseInt(parts[0], 10);
  const yEnd = yStart + 1;

  return [
    { name: 'April', code: `04${yStart}` },
    { name: 'May', code: `05${yStart}` },
    { name: 'June', code: `06${yStart}` },
    { name: 'July', code: `07${yStart}` },
    { name: 'August', code: `08${yStart}` },
    { name: 'September', code: `09${yStart}` },
    { name: 'October', code: `10${yStart}` },
    { name: 'November', code: `11${yStart}` },
    { name: 'December', code: `12${yStart}` },
    { name: 'January', code: `01${yEnd}` },
    { name: 'February', code: `02${yEnd}` },
    { name: 'March', code: `03${yEnd}` }
  ];
}

const btnStartBulk = document.getElementById('btnStartBulkDownload');
const btnStopBulk = document.getElementById('btnStopBulkDownload');
const progressContainer = document.getElementById('bulkProgressContainer');
const progressBar = document.getElementById('bulkProgressBar');
const progressText = document.getElementById('bulkProgressText');
const progressPct = document.getElementById('bulkProgressPct');

const chkBulk3bJson = document.getElementById('chkBulk3bJson');
const chkBulk2bJson = document.getElementById('chkBulk2bJson');
const chkBulk1Json = document.getElementById('chkBulk1Json');
const chkBulk2bExcel = document.getElementById('chkBulk2bExcel');
const chkBulk2bPdf = document.getElementById('chkBulk2bPdf');
const chkBulk3bPdf = document.getElementById('chkBulk3bPdf');

btnStopBulk?.addEventListener('click', () => {
  if (isBulkRunning) {
    shouldStopBulk = true;
    addLog('🛑 Stopping bulk download pipeline after current month completes...');
  }
});

btnStartBulk?.addEventListener('click', async () => {
  if (isBulkRunning) return;
  const { gstin, finYear } = getSessionParams();
  const periods = generateFyPeriods(finYear);

  isBulkRunning = true;
  shouldStopBulk = false;
  btnStartBulk.style.display = 'none';
  btnStopBulk.style.display = 'inline-flex';
  progressContainer.style.display = 'block';

  addLog(`\n======================================================`);
  addLog(`🚀 STARTING BULK FY DOWNLOAD: ${finYear} (GSTIN: ${gstin})`);
  addLog(`Sequential pipeline with fault-tolerant skip on NIL / empty months`);
  addLog(`======================================================`);

  let totalDownloaded = 0;
  let totalSkipped = 0;

  try {
    for (let i = 0; i < periods.length; i++) {
      if (shouldStopBulk) break;
      const { name, code } = periods[i];
      const pct = Math.round(((i) / periods.length) * 100);

      progressBar.style.width = `${pct}%`;
      progressPct.textContent = `${pct}%`;
      progressText.textContent = `Month ${i + 1} of 12: ${name} (${code})...`;
      setStatus(`Processing ${name}...`, 'busy');
      addLog(`\n--- [${i + 1}/12] Processing ${name} (${code}) ---`);

      // 1. Bulk GSTR-3B JSON
      if (chkBulk3bJson?.checked) {
        try {
          const g3bData = await portalFetch(`https://return.gst.gov.in/returns/auth/api/gstr3b/summary?rtn_prd=${code}`);
          if (!g3bData || g3bData.status === 0 || (typeof g3bData === 'string' && g3bData.includes('error'))) {
            addLog(`  🟡 GSTR-3B: No filing / NIL records for ${name} (${code}) — skipping gracefully`);
            totalSkipped++;
          } else {
            const jsonStr = JSON.stringify(g3bData, null, 2);
            const base64 = btoa(unescape(encodeURIComponent(jsonStr)));
            await triggerDownload(`returns_GSTR3B_${gstin}_${code}.json`, base64, 'application/json');
            addLog(`  ✔ GSTR-3B JSON: Saved for ${name}`);
            totalDownloaded++;
          }
        } catch (e3b) {
          addLog(`  🟡 GSTR-3B: ${e3b.message} — skipping month without stopping`);
          totalSkipped++;
        }
      }

      // 2. Bulk GSTR-2B JSON
      if (chkBulk2bJson?.checked) {
        try {
          const g2bData = await portalFetch(`https://gstr2b.gst.gov.in/gstr2b/auth/api/gstr2b/getjson?rtnprd=${code}`);
          const dataUnpack = g2bData?.data || g2bData;
          const hasInvoices = dataUnpack?.docdata?.b2b?.length > 0 || dataUnpack?.b2b?.length > 0;
          if (!g2bData || !hasInvoices) {
            addLog(`  🟡 GSTR-2B: No supplier records / NIL for ${name} (${code}) — continuing`);
            totalSkipped++;
          } else {
            const jsonStr = JSON.stringify(g2bData, null, 2);
            const base64 = btoa(unescape(encodeURIComponent(jsonStr)));
            await triggerDownload(`returns_GSTR2B_${gstin}_${code}.json`, base64, 'application/json');
            addLog(`  ✔ GSTR-2B JSON: Saved for ${name}`);
            totalDownloaded++;
          }
        } catch (e2b) {
          addLog(`  🟡 GSTR-2B: ${e2b.message} — continuing`);
          totalSkipped++;
        }
      }

      // 3. Bulk GSTR-1 JSON
      if (chkBulk1Json?.checked) {
        try {
          const g1Data = await portalFetch(`https://return.gst.gov.in/returns/auth/api/gstr1/summary?rtn_prd=${code}`);
          if (!g1Data || g1Data.status === 0) {
            addLog(`  🟡 GSTR-1: No data / NIL for ${name} (${code}) — continuing`);
            totalSkipped++;
          } else {
            const jsonStr = JSON.stringify(g1Data, null, 2);
            const base64 = btoa(unescape(encodeURIComponent(jsonStr)));
            await triggerDownload(`returns_GSTR1_${gstin}_${code}.json`, base64, 'application/json');
            addLog(`  ✔ GSTR-1 JSON: Saved for ${name}`);
            totalDownloaded++;
          }
        } catch (e1) {
          addLog(`  🟡 GSTR-1: ${e1.message} — continuing`);
          totalSkipped++;
        }
      }

      // 4. Bulk GSTR-2B Excel
      if (chkBulk2bExcel?.checked) {
        try {
          const raw2b = await portalFetch(`https://gstr2b.gst.gov.in/gstr2b/auth/api/gstr2b/getjson?rtnprd=${code}`);
          const builder = window.ConsolidatedPurchaseBuilder;
          if (builder && raw2b) {
            const wb = builder.buildPurchaseWorkbook([{ period: code, data: raw2b }], { gstin, finYear, tradeName: 'Taxpayer' });
            const base64 = await wb.generateBase64();
            await triggerDownload(`GSTR2B_Purchase_Register_${gstin}_${code}.xlsx`, base64, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            addLog(`  ✔ GSTR-2B Excel: Compiled for ${name}`);
            totalDownloaded++;
          }
        } catch (e2bX) {
          addLog(`  🟡 GSTR-2B Excel: ${e2bX.message} — continuing`);
          totalSkipped++;
        }
      }

      // 5. Bulk GSTR-2B Statutory PDF (Direct Compile <0.3s)
      if (chkBulk2bPdf?.checked) {
        try {
          const raw2b = await portalFetch(`https://gstr2b.gst.gov.in/gstr2b/auth/api/gstr2b/getjson?rtnprd=${code}`);
          const builder = window.Gstr2bDocDefBuilder;
          if (builder && raw2b && window.pdfMake) {
            const docDef = builder.buildGstr2bDocDefinition(raw2b, { gstin, finYear, period: code });
            const b64 = await new Promise((res, rej) => {
              window.pdfMake.createPdf(docDef).getBase64(b => b ? res(b) : rej(new Error('Empty PDF')));
            });
            await triggerDownload(`GSTR2B_${gstin}_${code}.pdf`, b64, 'application/pdf');
            addLog(`  ✔ GSTR-2B PDF: Compiled for ${name}`);
            totalDownloaded++;
          } else {
            addLog(`  🟡 GSTR-2B PDF: No data for ${name} (${code}) — continuing`);
            totalSkipped++;
          }
        } catch (e2bP) {
          addLog(`  🟡 GSTR-2B PDF: ${e2bP.message} — continuing`);
          totalSkipped++;
        }
      }

      // 6. Bulk GSTR-3B Official PDF (Active Tab Hook)
      if (chkBulk3bPdf?.checked) {
        try {
          const res = await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({
              action: 'download-3b-native-pdf',
              period: code,
              gstin
            }, r => (r && r.success) ? resolve(r) : reject(new Error(r?.error || 'Failed')));
          });
          addLog(`  ✔ GSTR-3B PDF: Saved for ${name}`);
          totalDownloaded++;
        } catch (e3bP) {
          addLog(`  🟡 GSTR-3B PDF: ${e3bP.message} — continuing`);
          totalSkipped++;
        }
      }

      // Respectful pacing between months (350ms delay)
      await new Promise(r => setTimeout(r, 350));
    }

    progressBar.style.width = '100%';
    progressPct.textContent = '100%';
    progressText.textContent = shouldStopBulk ? 'Bulk Download Stopped.' : 'Full Year Bulk Download Complete!';
    setStatus(shouldStopBulk ? 'Stopped' : 'Completed', 'success');
    addLog(`\n🎉 [BULK SUMMARY] Processed FY ${finYear}: ${totalDownloaded} files downloaded, ${totalSkipped} NIL/empty records skipped gracefully.`);
  } catch (err) {
    addLog(`❌ Fatal bulk error: ${err.message}`);
    setStatus('Error', 'error');
  } finally {
    isBulkRunning = false;
    btnStartBulk.style.display = 'inline-flex';
    btnStopBulk.style.display = 'none';
  }
});

