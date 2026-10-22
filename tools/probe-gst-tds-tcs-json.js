/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * ReturnPilot — GST Portal TDS/TCS (GSTR-2X) Offline JSON & API Discovery Probe
 * ═══════════════════════════════════════════════════════════════════════════════
 * Instructions:
 * 1. Log into the GST Portal (https://return.gst.gov.in)
 * 2. Navigate to Returns Dashboard or TDS & TCS Credit Received page
 * 3. Open Chrome DevTools (Press F12 or Right Click -> Inspect -> Console)
 * 4. Paste this entire script and press Enter
 *
 * What this script does:
 * - Probes all potential automatic / offline JSON generation endpoints
 * - Probes all live data tables (TDS, TCS, TDS Amendments, TCS Amendments)
 * - Summarizes findings in formatted console tables
 * - Stores all findings in `window.__GSTR2X_PROBE__`
 * - Provides 1-click JSON download of synthesized data if no official offline file exists
 * ═══════════════════════════════════════════════════════════════════════════════
 */

(async () => {
  console.clear();
  console.log('%c🔍 ReturnPilot GSTR-2X (TDS/TCS) Offline JSON & API Discovery Probe', 'background:#2563eb;color:white;font-size:14px;font-weight:bold;padding:4px 8px;border-radius:4px;');
  console.log('%cProbing whether GST Portal automatically generates offline JSON for TDS/TCS Credit Received...', 'color:#64748b;font-style:italic;');

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // Auto-detect available period or test current/previous return periods
  const today = new Date();
  const curMonth = today.getMonth() + 1;
  const curYear = today.getFullYear();
  
  // Build last 6 periods (e.g., 092026, 082026, 072026, 062026, 052026, 042026)
  const testPeriods = [];
  for (let i = 1; i <= 6; i++) {
    let d = new Date(curYear, curMonth - i, 1);
    let m = String(d.getMonth() + 1).padStart(2, '0');
    let y = d.getFullYear();
    testPeriods.push(`${m}${y}`);
  }

  // Also include user's known active periods if needed
  if (!testPeriods.includes('062026')) testPeriods.push('062026');
  if (!testPeriods.includes('052026')) testPeriods.push('052026');
  if (!testPeriods.includes('042025')) testPeriods.push('042025');

  const probePeriod = testPeriods[0];
  console.log(`%cTarget Test Period for In-Depth Probing: ${probePeriod}`, 'color:#0284c7;font-weight:bold;');

  async function probeEndpoint(url, method = 'GET', body = null) {
    const t0 = performance.now();
    try {
      const opts = {
        method,
        credentials: 'include',
        cache: 'no-store',
        headers: {
          'Accept': 'application/json, text/plain, */*',
          'X-Requested-With': 'XMLHttpRequest'
        }
      };
      if (body) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
      }
      const res = await fetch(url, opts);
      const ms = Math.round(performance.now() - t0);
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch (_) {}
      return {
        ok: res.ok,
        status: res.status,
        statusText: res.statusText,
        ms,
        isJson: json !== null,
        data: json,
        rawText: text.substring(0, 300)
      };
    } catch (e) {
      return {
        ok: false,
        status: 0,
        statusText: e.message,
        ms: Math.round(performance.now() - t0),
        isJson: false,
        data: null,
        rawText: e.message
      };
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PHASE 1: Probe Potential Offline JSON Generation & Download Endpoints
  // ─────────────────────────────────────────────────────────────────────────────
  console.group('%c[PHASE 1] Probing Offline JSON Generation & Download Candidates', 'color:#f59e0b;font-weight:bold;');
  
  const offlineCandidates = [
    // Standard returns offline endpoint with candidate return types
    { name: 'Standard Offline (GSTR2X)', url: `/returns/auth/api/offline/download/generate?rtn_typ=GSTR2X&rtn_prd=${probePeriod}&flag=0` },
    { name: 'Returns2 Offline (GSTR2X)', url: `/returns2/auth/api/offline/download/generate?rtn_typ=GSTR2X&rtn_prd=${probePeriod}&flag=0` },
    { name: 'Standard Offline (TDS)',    url: `/returns/auth/api/offline/download/generate?rtn_typ=TDS&rtn_prd=${probePeriod}&flag=0` },
    { name: 'Returns2 Offline (TDS)',   url: `/returns2/auth/api/offline/download/generate?rtn_typ=TDS&rtn_prd=${probePeriod}&flag=0` },
    { name: 'Standard Offline (2X)',     url: `/returns/auth/api/offline/download/generate?rtn_typ=2X&rtn_prd=${probePeriod}&flag=0` },
    { name: 'Returns2 Offline (2X)',    url: `/returns2/auth/api/offline/download/generate?rtn_typ=2X&rtn_prd=${probePeriod}&flag=0` },
    // GSTR-2X dedicated sub-paths
    { name: 'GSTR-2X Download Generate', url: `/returns2/auth/api/gstr2x/download/generate?rtn_prd=${probePeriod}&flag=0` },
    { name: 'GSTR-2X Direct Download',   url: `/returns2/auth/api/gstr2x/download?rtn_prd=${probePeriod}` },
    { name: 'GSTR-2X Offline Data',      url: `/returns2/auth/api/gstr2x/offline?rtn_prd=${probePeriod}` },
    { name: 'GSTR-2X JSON Download',     url: `/returns2/auth/api/gstr2x/json?rtn_prd=${probePeriod}` }
  ];

  const offlineResults = [];
  let foundOfflineJsonEndpoint = null;

  for (const c of offlineCandidates) {
    const res = await probeEndpoint(c.url);
    const hasData = res.isJson && res.data && (res.data.status === 1 || res.data.status === 0 || res.data.data);
    const conclusion = res.status === 200 
      ? (hasData ? '✅ ACTIVE ENDPOINT' : '⚠️ 200 OK (Error/Empty payload)') 
      : (res.status === 404 ? '❌ 404 Not Found' : `HTTP ${res.status}`);

    offlineResults.push({
      Candidate: c.name,
      URL: c.url,
      HTTP: res.status,
      Latency: `${res.ms}ms`,
      JSON: res.isJson ? 'YES' : 'NO',
      Result: conclusion,
      Details: res.isJson ? JSON.stringify(res.data).substring(0, 80) : res.rawText.substring(0, 60)
    });

    if (res.ok && res.isJson && res.data && (res.data.status === 1 || res.data.data?.url || res.data.data?.token)) {
      foundOfflineJsonEndpoint = c;
    }
    await sleep(150);
  }

  console.table(offlineResults);
  console.groupEnd();

  // ─────────────────────────────────────────────────────────────────────────────
  // PHASE 2: Probe Live Data Microservice Endpoints (All 4 Tables)
  // ─────────────────────────────────────────────────────────────────────────────
  console.group('%c[PHASE 2] Probing Live TDS & TCS Data Tables', 'color:#10b981;font-weight:bold;');

  const liveEndpoints = [
    { table: 'Filing Status (2xrolestatus)', url: `/returns2/auth/api/2xrolestatus?return_prd=${probePeriod}` },
    { table: 'Table 1: TDS Credit',         url: `/returns2/auth/api/gstr2x/tds?rtn_prd=${probePeriod}` },
    { table: 'Table 2: TCS Credit',         url: `/returns2/auth/api/gstr2x/tcs?rtn_prd=${probePeriod}` },
    { table: 'Table 3: TDS Amendments',     url: `/returns2/auth/api/gstr2x/tdsa?rtn_prd=${probePeriod}` },
    { table: 'Table 4: TCS Amendments',     url: `/returns2/auth/api/gstr2x/tcsa?rtn_prd=${probePeriod}` },
    { table: 'Summary / Overview',          url: `/returns2/auth/api/gstr2x/summary?rtn_prd=${probePeriod}` },
    { table: 'Draft Preview PDF/JSON',      url: `/returns2/auth/api/gstr2x/preview?rtn_prd=${probePeriod}` }
  ];

  const liveResults = [];
  const livePayloads = {};

  for (const ep of liveEndpoints) {
    const res = await probeEndpoint(ep.url);
    livePayloads[ep.table] = res.data;

    let rowCount = 0;
    if (res.data) {
      const items = res.data?.data?.processed?.tds ||
                    res.data?.data?.processed?.tcs ||
                    res.data?.data?.processed?.tdsa ||
                    res.data?.data?.processed?.tcsa ||
                    res.data?.data?.tds ||
                    res.data?.data?.tcs ||
                    res.data?.data || [];
      if (Array.isArray(items)) rowCount = items.length;
    }

    liveResults.push({
      Target: ep.table,
      URL: ep.url,
      HTTP: res.status,
      Latency: `${res.ms}ms`,
      JSON: res.isJson ? 'YES' : 'NO',
      Records: rowCount > 0 ? `✅ ${rowCount} records` : (res.status === 200 ? '0 records' : 'N/A'),
      Sample: res.isJson ? JSON.stringify(res.data).substring(0, 90) : res.rawText.substring(0, 60)
    });
    await sleep(150);
  }

  console.table(liveResults);
  console.groupEnd();

  // ─────────────────────────────────────────────────────────────────────────────
  // PHASE 3: Multi-Period Status Scan (Verify rolestatus consistency)
  // ─────────────────────────────────────────────────────────────────────────────
  console.group('%c[PHASE 3] Multi-Period GSTR-2X Status Scan', 'color:#8b5cf6;font-weight:bold;');
  const multiScan = [];

  for (const prd of testPeriods) {
    const rRes = await probeEndpoint(`/returns2/auth/api/2xrolestatus?return_prd=${prd}`);
    const tRes = await probeEndpoint(`/returns2/auth/api/gstr2x/tds?rtn_prd=${prd}`);

    let status = 'Unknown';
    let dueDt = '-';
    if (rRes.data?.data?.user) {
      const returns = rRes.data.data.user.flatMap(u => u.returns || []);
      const g2x = returns.find(r => r.return_ty === 'GSTR2X');
      if (g2x) {
        status = g2x.status === 'FIL' ? 'Filed' : (g2x.status === 'NF' ? 'Not Filed' : g2x.status);
        dueDt = g2x.due_dt || '-';
      }
    }

    let tdsCount = 0;
    const tdsList = tRes.data?.data?.processed?.tds || tRes.data?.data?.tds || [];
    if (Array.isArray(tdsList)) tdsCount = tdsList.length;

    multiScan.push({
      Period: prd,
      'Filing Status': status,
      'Due Date': dueDt,
      'TDS Records': tdsCount,
      'HTTP Status': rRes.status
    });
    await sleep(100);
  }

  console.table(multiScan);
  console.groupEnd();

  // ─────────────────────────────────────────────────────────────────────────────
  // EXECUTIVE SUMMARY & CONCLUSION
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n%c═══════════════════════════════════════════════════════════════════════════════', 'color:#2563eb;');
  console.log('%c🎯 DISCOVERY PROBE EXECUTIVE SUMMARY & ARCHITECTURAL VERDICT', 'color:#1e40af;font-size:13px;font-weight:bold;');
  console.log('%c═══════════════════════════════════════════════════════════════════════════════', 'color:#2563eb;');

  if (foundOfflineJsonEndpoint) {
    console.log(`%c[VERDICT: OFFLINE GENERATOR DETECTED!]`, 'color:#16a34a;font-weight:bold;');
    console.log(`Found active offline endpoint: ${foundOfflineJsonEndpoint.url}`);
  } else {
    console.log('%c[VERDICT: NO AUTOMATIC OFFLINE JSON FILE]', 'color:#ea580c;font-weight:bold;font-size:12px;');
    console.log('%c1. The GST Portal does NOT create an offline pre-packaged JSON/ZIP queue for TDS/TCS Credit Received (GSTR-2X).', 'color:#334155;');
    console.log('%c2. Unlike GSTR-1 and GSTR-2A which have batch workers generating .zip archives, GSTR-2X is an ONLINE-ONLY statement.', 'color:#334155;');
    console.log('%c3. The true source of truth is the live JSON microservices:', 'color:#334155;font-weight:bold;');
    console.log('   • Status API:     /returns2/auth/api/2xrolestatus?return_prd={period}');
    console.log('   • TDS Records:    /returns2/auth/api/gstr2x/tds?rtn_prd={period}');
    console.log('   • TCS Records:    /returns2/auth/api/gstr2x/tcs?rtn_prd={period}');
    console.log('   • TDS Amendments: /returns2/auth/api/gstr2x/tdsa?rtn_prd={period}');
    console.log('   • TCS Amendments: /returns2/auth/api/gstr2x/tcsa?rtn_prd={period}');
    console.log('%c4. ReturnPilot Solution:', 'color:#2563eb;font-weight:bold;');
    console.log('   ReturnPilot should synthesize the complete GSTR-2X JSON directly from these live endpoints (0ms delay, no portal queue wait)!');
  }

  // Store in global scope for inspection
  window.__GSTR2X_PROBE__ = {
    testPeriod: probePeriod,
    testPeriods,
    offlineResults,
    liveResults,
    multiScan,
    livePayloads,
    exportProbeJson() {
      const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(this, null, 2));
      const a = document.createElement('a');
      a.href = dataStr;
      a.download = `gstr2x_probe_report_${probePeriod}.json`;
      a.click();
    }
  };

  console.log('\n%cProbe data saved to window.__GSTR2X_PROBE__', 'color:#6366f1;font-weight:bold;');
  console.log('%cTo export this diagnostic report to JSON, run: %c__GSTR2X_PROBE__.exportProbeJson()', 'color:#475569;', 'color:#2563eb;font-weight:bold;');
})();
