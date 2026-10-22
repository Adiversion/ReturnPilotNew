// ── Popup adaptive sizing ────────────────────────────────────────
// CSS device-height media queries are unreliable in Chrome extension popup
// context. This runs immediately (defer, after HTML parse) and sets the
// html dimensions + body zoom precisely from screen.availHeight so the
// zoomed body fills the popup window edge-to-edge with zero gap.
(function rpAdaptiveSize() {
  try {
    if (typeof document === 'undefined' || !document.documentElement) return;
    var html = document.documentElement;
    // Skip side panel — it manages its own sizing via rp-view-sidepanel class
    if (html.classList.contains('rp-view-sidepanel')) return;
    if (window.location && window.location.pathname.indexOf('sidepanel.html') !== -1) return;

    var sh = (window.screen && (window.screen.availHeight || window.screen.height)) || 1080;
    // Base body size is 760×600. Target popup widths per screen height tier:
    //   ≤768px  → 700×553  (zoom = 700/760 ≈ 0.921)
    //   ≤900px  → 726×573  (zoom = 726/760 ≈ 0.955)
    //   ≤1079px → 746×589  (zoom = 746/760 ≈ 0.982)
    //   1080p+  → 760×600  (zoom = 1, no scaling)
    // height = Math.round(600 * zoom) so body fills html exactly.
    var tw, z;
    if      (sh <= 768)  { tw = 700; z = 700 / 760; }
    else if (sh <= 900)  { tw = 726; z = 726 / 760; }
    else if (sh <= 1079) { tw = 746; z = 746 / 760; }
    else                 { tw = 760; z = 1; }

    var th = Math.round(600 * z);

    html.style.width    = tw + 'px';
    html.style.height   = th + 'px';
    html.style.overflow = 'hidden';

    var body = document.body;
    if (body && z !== 1) {
      body.style.zoom = String(z);
    }
  } catch (_) {}
}());

"use strict";
/* exported download1PdfViaAngular, download1aPdfViaAngular, download3BPdf, download9Pdf, download9cPdf, download9Table8aExcel, download9Gstr1SummaryPdf, download9Gstr3bSummaryPdf */

// ── Popup logger ────────────────────────────────────────────────
// addRpLog is defined in the BACKGROUND (service worker) but scripts.js runs in
// the POPUP context, where it does not exist — so every
// `typeof addRpLog === 'function'` guard below used to silently no-op and the
// user saw "no console log, nothing happening". Define it here so GSTR-1/1A
// progress + error lines actually reach the popup DevTools console.
function addRpLog(msg, details) {
  console.log('[ReturnPilot] ' + msg);
  if (typeof rpLog !== 'undefined' && rpLog && typeof rpLog.info === 'function') {
    const isWarn = typeof msg === 'string' && (msg.includes('⚠') || msg.includes('Warning') || msg.includes('note:'));
    const isError = typeof msg === 'string' && (msg.includes('❌') || msg.includes('error') || msg.includes('failed'));
    if (isError) rpLog.error('PDF_ENGINE', msg, details);
    else if (isWarn) rpLog.warn('PDF_ENGINE', msg, details);
    else rpLog.info('PDF_ENGINE', msg, details);
  }
}

function bytesToBase64(bytes) {
  if (typeof window !== 'undefined' && typeof window.bytesToBase64 === 'function' && window.bytesToBase64 !== bytesToBase64) {
    return window.bytesToBase64(bytes);
  }
  let binary = '';
  const len = bytes.byteLength || bytes.length;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// ── Embedded GSTR-1 Excel Template Schema ──────────────────────

// ── 1. GSTR-1 PDF Engine ──────────────────────────────────────

/**
 * Triggers the GST Portal's native client-side AngularJS compiler (genratepdfNew)
 * to compile and download GSTR-1 PDF directly from portal memory.
 */
async function download1PdfViaAngular(period) {
  try {
    if (typeof ReturnPilotSecurity !== 'undefined') {
      const subState = (typeof currentSubscriptionState !== 'undefined') ? currentSubscriptionState : null;
      const perm = ReturnPilotSecurity.checkFeatureAccess('PDF', subState);
      if (!perm.allowed) {
        if (typeof window.showPremiumUpgradeModal === 'function') {
          window.showPremiumUpgradeModal(perm.reason);
        } else {
          const m = document.getElementById('premiumUpgradeModal') || document.getElementById('donationModal');
          if (m) m.hidden = false;
        }
        return;
      }
    }

    if (typeof addRpLog === 'function') {
      addRpLog(`[1/6] Routing GSTR-1 PDF request for period ${period.value}...`);
    }
    const currentGstin = (typeof session !== 'undefined' && session.gstin) ? session.gstin : '';
    const res = await processAsync({
      request: 'download-pdf-via-angular-gstr1',
      returnType: 'GSTR-1',
      gstin: currentGstin,
      period: period.value
      // Portal-native flow runs inside a hidden iframe; the engine allows up to
      // 90s, so the popup must not give up earlier than that.
    }, 95000).catch(() => null);

    if (res && Array.isArray(res.logs)) {
      res.logs.forEach(logLine => {
        if (typeof addRpLog === 'function') addRpLog(logLine);
      });
    }

    if (res && res.error) {
      if (typeof addRpLog === 'function') addRpLog(`⚠ GSTR-1 PDF note: ${res.error}`);
    } else {
      if (res && res.filename) {
        const filePeriodMatch = res.filename.match(/(0[1-9]|1[0-2])(20\d{2})/);
        if (filePeriodMatch && filePeriodMatch[0] !== period.value) {
          if (typeof addRpLog === 'function') {
            addRpLog(`⚠ [GSTR-1 PDF] Period mismatch warning: Target=${period.value}, Dispatched=${filePeriodMatch[0]}`);
          }
        } else {
          if (typeof addRpLog === 'function') {
            addRpLog(`✓ [GSTR-1 PDF] Period verified: ${period.value} matches dispatched file`);
          }
        }
      }
      if (typeof addRpLog === 'function') {
        addRpLog(`✓ GSTR-1 PDF compilation completed for period ${period.value}`);
      }
    }
  } catch (err) {
    console.warn('[ReturnPilot] GSTR-1 PDF trigger note:', err.message);
  }
}

/**
 * Triggers the GST Portal's native client-side AngularJS compiler for GSTR-1A
 * to compile and download GSTR-1A PDF (Standalone or Consolidated).
 */
async function download1aPdfViaAngular(period, pdfType) {
  try {
    if (typeof ReturnPilotSecurity !== 'undefined') {
      const subState = (typeof currentSubscriptionState !== 'undefined') ? currentSubscriptionState : null;
      const perm = ReturnPilotSecurity.checkFeatureAccess('PDF', subState);
      if (!perm.allowed) {
        if (typeof window.showPremiumUpgradeModal === 'function') {
          window.showPremiumUpgradeModal(perm.reason);
        } else {
          const m = document.getElementById('premiumUpgradeModal') || document.getElementById('donationModal');
          if (m) m.hidden = false;
        }
        return;
      }
    }

    if (typeof addRpLog === 'function') {
      addRpLog(`[1/6] Routing GSTR-1A PDF request (${pdfType || 'STANDALONE'}) for period ${period.value}...`);
    }
    const currentGstin = (typeof session !== 'undefined' && session.gstin) ? session.gstin : '';
    const res = await processAsync({
      request: 'download-pdf-via-angular-gstr1a',
      returnType: 'GSTR-1A',
      gstin: currentGstin,
      pdfType: pdfType || 'STANDALONE',
      period: period.value
      // Portal-native flow is two-stage (VIEW SUMMARY → PDF button); the engine
      // allows up to 90s, so the popup must not give up earlier than that.
    }, 95000).catch(() => null);

    if (res && Array.isArray(res.logs)) {
      res.logs.forEach(logLine => {
        if (typeof addRpLog === 'function') addRpLog(logLine);
      });
    }

    if (res && res.skipped) {
      if (typeof addRpLog === 'function') addRpLog(`ℹ GSTR-1A (${pdfType || 'STANDALONE'}) skipped: ${res.error || 'Not filed'}`);
    } else if (res && res.error) {
      if (typeof addRpLog === 'function') addRpLog(`⚠ GSTR-1A PDF note: ${res.error}`);
    } else {
      if (typeof addRpLog === 'function') {
        addRpLog(`✓ GSTR-1A PDF compilation completed for period ${period.value}`);
      }
    }
  } catch (err) {
    console.warn('[ReturnPilot] GSTR-1A PDF trigger note:', err.message);
  }
}

// ── 2. GSTR-3B PDF Engine ─────────────────────────────────────

async function download3BPdf(period) {
  try {
    if (typeof ReturnPilotSecurity !== 'undefined') {
      const subState = (typeof currentSubscriptionState !== 'undefined') ? currentSubscriptionState : null;
      const perm = ReturnPilotSecurity.checkFeatureAccess('PDF', subState);
      if (!perm.allowed) {
        if (typeof window.showPremiumUpgradeModal === 'function') {
          window.showPremiumUpgradeModal(perm.reason);
        } else {
          const m = document.getElementById('premiumUpgradeModal') || document.getElementById('donationModal');
          if (m) m.hidden = false;
        }
        return;
      }
    }

    if (typeof addRpLog === 'function') {
      addRpLog(`[GSTR-3B PDF] Initiating official portal download for period ${period.value}...`);
    }

    const currentGstin = (typeof session !== 'undefined' && session.gstin) ? session.gstin : '';
    const res = await processAsync({
      request: 'download-pdf-via-angular',
      returnType: 'GSTR-3B',
      gstin: currentGstin,
      period: period.value
      // GSTR-3B uses the ACTIVE-TAB Angular scope call (v3.5.3-proven): it walks
      // the live dashboard scope for downloadGSTR3Bpdf() and captures the PDF
      // via pdfMake patch — no iframe, no navigation. The portal renders
      // client-side and can take a few seconds; keep a generous timeout.
    }, 95000).catch(() => null);

    if (res && res.error) {
      if (res.error.includes('back/forward cache') || res.error.includes('message port closed')) {
        console.log('[ReturnPilot] GSTR-3B PDF note: Tab entered bfcache or navigated during PDF generation.');
        throw new Error('Tab entered bfcache or navigated during PDF generation');
      } else {
        console.warn('[ReturnPilot] GSTR-3B PDF error:', res.error);
        if (typeof addRpLog === 'function') addRpLog(`❌ GSTR-3B PDF error: ${res.error}`);
        throw new Error(res.error);
      }
    } else if (res && res.success) {
      if (res.periodMatch === false) {
        const mismatchErr = `Period mismatch: Target was ${period.value}, file reported ${res.filename || 'unknown'}`;
        if (typeof addRpLog === 'function') addRpLog(`❌ [GSTR-3B PDF] ${mismatchErr}`);
        throw new Error(mismatchErr);
      } else {
        if (typeof addRpLog === 'function') {
          addRpLog(`✓ [GSTR-3B PDF] Period verified: ${period.value} official download completed`);
        }
        return res;
      }
    } else {
      throw new Error('GSTR-3B PDF download failed: No response received');
    }
  } catch (err) {
    if (err.message && (err.message.includes('back/forward cache') || err.message.includes('message port closed'))) {
      console.log('[ReturnPilot] GSTR-3B PDF trigger note: Tab navigated during PDF generation.');
    } else {
      console.warn('[ReturnPilot] GSTR-3B PDF trigger note:', err.message);
    }
    throw err;
  }
}

// ── 3. GSTR-9 PDF Engine ──────────────────────────────────────

async function download9Pdf(period) {
  try {
    if (typeof ReturnPilotSecurity !== 'undefined') {
      const subState = (typeof currentSubscriptionState !== 'undefined') ? currentSubscriptionState : null;
      const perm = ReturnPilotSecurity.checkFeatureAccess('PDF', subState);
      if (!perm.allowed) {
        if (typeof window.showPremiumUpgradeModal === 'function') {
          window.showPremiumUpgradeModal(perm.reason);
        } else {
          const m = document.getElementById('premiumUpgradeModal') || document.getElementById('donationModal');
          if (m) m.hidden = false;
        }
        return;
      }
    }

    const gstin = (typeof session !== 'undefined' && session.gstin) ? session.gstin : '';
    const fp = (period && period.value) ? period.value : (typeof period === 'string' ? period : '032025');
    let fy = (typeof session !== 'undefined' && session.finYear) ? session.finYear : '';
    if (!fy && period && period.month) {
      fy = period.month.replace(/^FY\s*/i, '').trim();
    }
    if (!fy || !fy.includes('-')) {
      const endYr = parseInt(fp.substring(2, 6), 10);
      if (!isNaN(endYr)) {
        fy = `${endYr - 1}-${String(endYr % 100).padStart(2, '0')}`;
      }
    }

    const res = await processAsync({
      request: 'download-pdf-via-angular-gstr9',
      returnType: 'GSTR-9',
      finYr: fy,
      period: fp,
      gstin: gstin
    }, 95000).catch(() => null);

    if (res && res.error) {
      console.warn('[ReturnPilot] GSTR-9 PDF note:', res.error);
      throw new Error(res.error);
    }
    return true;
  } catch (err) {
    console.error('[ReturnPilot] GSTR-9 PDF Error:', err);
    throw err;
  }
}

// ── 3a. GSTR-9 Table 8A Excel Engine ──────────────────────────

async function download9Table8aExcel(period) {
  try {
    if (typeof ReturnPilotSecurity !== 'undefined') {
      const subState = (typeof currentSubscriptionState !== 'undefined') ? currentSubscriptionState : null;
      const perm = ReturnPilotSecurity.checkFeatureAccess('EXCEL', subState);
      if (!perm.allowed) {
        if (typeof window.showPremiumUpgradeModal === 'function') {
          window.showPremiumUpgradeModal(perm.reason);
        } else {
          const m = document.getElementById('premiumUpgradeModal') || document.getElementById('donationModal');
          if (m) m.hidden = false;
        }
        return;
      }
    }

    const gstin = (typeof session !== 'undefined' && session.gstin) ? session.gstin : '';
    const fp = (period && period.value) ? period.value : (typeof period === 'string' ? period : '032025');
    let fy = (typeof session !== 'undefined' && session.finYear) ? session.finYear : '';
    if (!fy && period && period.month) {
      fy = period.month.replace(/^FY\s*/i, '').trim();
    }
    if (!fy || !fy.includes('-')) {
      const endYr = parseInt(fp.substring(2, 6), 10);
      if (!isNaN(endYr)) {
        fy = `${endYr - 1}-${String(endYr % 100).padStart(2, '0')}`;
      }
    }

    // 1. Query / trigger Table 8A Excel file generation on GST portal
    const statusUrl = `https://return.gst.gov.in/returns2/auth/api/gstr9/8a/excel?fp=${fp}&gstin=${gstin}`;
    const statusRes = await processAsync({ request: 'get', url: statusUrl }).catch(() => null);

    let statusData = null;
    try {
      if (statusRes && statusRes.status) {
        statusData = JSON.parse(statusRes.response);
      }
    } catch (_) {}

    const dataObj = statusData?.data || {};
    const rawStatus = (dataObj.status || '').toLowerCase();
    const docCount = typeof dataObj.docCount === 'number' ? dataObj.docCount : (dataObj.doc_count || 0);

    // If file generation has just been triggered or is in progress
    const isGenerating = rawStatus.includes('generat') && !rawStatus.includes('generated') || rawStatus === 'in progress' || (statusData && statusData.status === 1 && docCount === 0);

    if (isGenerating) {
      if (typeof showGeneratingBanner === 'function') showGeneratingBanner();
      if (period) {
        period.currentState = (typeof RETURN_STATES !== 'undefined' && RETURN_STATES.GENERATING) ? RETURN_STATES.GENERATING : 'GENERATING';
        period.currentMessage = 'Generating…';
        if (typeof getElement === 'function' && typeof setStatusPill === 'function') {
          const d = getElement(`json-status-${period.value}`);
          if (d) setStatusPill(d, 'Generating…', 'rt-status-warn');
        }
        if (typeof syncRowActions === 'function') syncRowActions(period);
        if (typeof periodCacheKey === 'function' && typeof saveGenerationTimestamp === 'function' && typeof session !== 'undefined') {
          const key = periodCacheKey(session.return ? session.return.key : 'G9', session.finYear, period.value);
          saveGenerationTimestamp(key, Date.now());
        }
      }
      throw new Error('Generating…');
    }

    if (statusData && statusData.status === 0) {
      throw new Error(statusData.error?.message || dataObj.msg || 'Table 8A request was rejected by GST portal.');
    }

    // 2. Fetch and download generated annual document
    const docUrl = `https://return.gst.gov.in/downloadhb/downloadAnnualDoc?gstin=${gstin}&fy=${fy}&form=R9&sec=8A&docId=1`;
    const cleanFy = (fy || 'FY').replace(/[^0-9-]/g, '');

    const response = await fetch(docUrl, { credentials: 'include' });
    if (!response.ok) throw new Error('HTTP ' + response.status + ' - File unavailable on portal');

    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('text/html') || contentType.includes('text/plain')) {
      const sampleText = await response.text();
      if (sampleText.toLowerCase().includes('not available') || sampleText.toLowerCase().includes('in progress') || sampleText.toLowerCase().includes('generating')) {
        if (typeof showGeneratingBanner === 'function') showGeneratingBanner();
        if (period) {
          period.currentState = (typeof RETURN_STATES !== 'undefined' && RETURN_STATES.GENERATING) ? RETURN_STATES.GENERATING : 'GENERATING';
          period.currentMessage = 'Generating…';
          if (typeof getElement === 'function' && typeof setStatusPill === 'function') {
            const d = getElement(`json-status-${period.value}`);
            if (d) setStatusPill(d, 'Generating…', 'rt-status-warn');
          }
          if (typeof syncRowActions === 'function') syncRowActions(period);
        }
        throw new Error('Generating…');
      }
      throw new Error('Table 8A document is not ready on portal');
    }

    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const fileName = `${cleanFy}_${gstin}_GSTR9_Table8A.zip`;

    chrome.runtime.sendMessage({
      request: 'download-file',
      fileName,
      mimeType: 'application/zip',
      base64: bytesToBase64(bytes),
      gstin: gstin || (typeof session !== 'undefined' && session && session.gstin) || '',
      returnType: 'GSTR9',
      period: fp,
      fy: fy
    });
    return true;
  } catch (err) {
    console.error('[ReturnPilot] Table 8A Excel download note:', err.message);
    throw err;
  }
}

// ── 3b. Portal Tab PDF Compiler Helper ────────────────────────

async function compileAndDownloadPdfViaPortal(docDefinition, pdfName, period, returnType = 'GSTR9') {
  const gstin = (typeof session !== 'undefined' && session.gstin) ? session.gstin : '';
  let fy = (typeof session !== 'undefined' && session.finYear) ? session.finYear : '';
  const fp = (period && period.value) ? period.value : (typeof period === 'string' ? period : '');

  return new Promise((resolve, reject) => {
    if (typeof chrome === 'undefined' || !chrome.tabs || !chrome.tabs.query) {
      return reject(new Error('Browser extension tabs API unavailable'));
    }

    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab || !tab.id) {
        return reject(new Error('No active GST Portal tab found. Please keep the GST portal tab open.'));
      }

      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: 'MAIN',
          args: [docDefinition],
          func: (docDef) => {
            return new Promise((res) => {
              try {
                if (window.pdfMake && typeof window.pdfMake.createPdf === 'function') {
                  window.pdfMake.createPdf(docDef).getBase64((base64Data) => {
                    if (!base64Data) return res({ success: false, error: 'Empty PDF returned by compiler' });
                    res({ success: true, base64: base64Data });
                  });
                  return;
                }
                res({ success: false, error: 'pdfMake is not initialized in the active GST tab. Please ensure you are logged in to the GST dashboard.' });
              } catch (err) {
                res({ success: false, error: err.message });
              }
            });
          }
        });

        const outcome = results && results[0] && results[0].result;
        if (outcome && outcome.success && outcome.base64) {
          chrome.runtime.sendMessage({
            request: 'download-file',
            fileName: pdfName,
            mimeType: 'application/pdf',
            base64: outcome.base64,
            gstin: gstin,
            returnType: returnType,
            period: fp,
            fy: fy
          }, (dlRes) => {
            if (dlRes && dlRes.error) {
              reject(new Error(dlRes.error));
            } else {
              resolve(true);
            }
          });
        } else {
          reject(new Error(outcome?.error || 'PDF compilation failed on portal tab'));
        }
      } catch (err) {
        reject(err);
      }
    });
  });
}

if (typeof window !== 'undefined') {
  window.compileAndDownloadPdfViaPortal = compileAndDownloadPdfViaPortal;
}

// ── 3b1. GSTR-2B Invoice-Wise Detailed PDF Engine ─────────────

async function download2bDetailedPdf(period) {
  try {
    if (typeof ReturnPilotSecurity !== 'undefined') {
      const subState = (typeof currentSubscriptionState !== 'undefined') ? currentSubscriptionState : null;
      const perm = ReturnPilotSecurity.checkFeatureAccess('PDF', subState);
      if (!perm.allowed) {
        if (typeof window.showPremiumUpgradeModal === 'function') {
          window.showPremiumUpgradeModal(perm.reason);
        } else {
          const m = document.getElementById('premiumUpgradeModal') || document.getElementById('donationModal');
          if (m) m.hidden = false;
        }
        return;
      }
    }

    let r2bData = period.r2bCachedData || null;
    let rawData = period.r2bRawData || null;
    if (!r2bData || !r2bData.docdata) {
      if (typeof fetch2bData === 'function') {
        const result = await fetch2bData(period);
        if (!result.ok) throw new Error(result.error === 'No Data' ? 'No Supplier Records' : (result.error || 'Failed to fetch GSTR-2B data'));
        r2bData = result.data;
        rawData = result.raw;
        period.r2bCachedData = r2bData;
        period.r2bRawData = rawData;
      }
    }

    if (!r2bData || !r2bData.gstin) throw new Error('No Supplier Records for GSTR-2B Detailed Report');

    const docdata = r2bData.docdata || (rawData && (rawData.docdata || rawData.data?.docdata || rawData.data)) || {};
    const gstin = r2bData.gstin || (typeof session !== 'undefined' && session.gstin) || '';
    const rtnprd = r2bData.rtnprd || period.value;
    const gendt = r2bData.gendt || '-';
    const legalName = r2bData.lgnm || (typeof session !== 'undefined' && (session.businessName || session.legalName)) || '';
    const tradeName = r2bData.trdnm || (typeof session !== 'undefined' && session.tradeName) || legalName;

    const fmtAmt = (val) => {
      if (val == null || val === '') return '0.00';
      const num = Number(val);
      return isNaN(num) ? '0.00' : num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };
    const AC = (val) => ({ text: fmtAmt(val), alignment: 'right', fontSize: 7.5 });
    const TH = (t) => ({ text: t, style: 'tableHeading' });
    const safe = (v) => (v == null ? '-' : String(v));
    const lay = {
      hLineWidth: (i, node) => (i === 0 || i === node.table.body.length || i === 1) ? 0.7 : 0.4,
      vLineWidth: () => 0.4,
      hLineColor: () => '#cbd5e1',
      vLineColor: () => '#cbd5e1',
      paddingLeft: () => 3,
      paddingRight: () => 3,
      paddingTop: () => 2.5,
      paddingBottom: () => 2.5
    };

    const content = [
      { text: 'Form GSTR-2B', style: 'header' },
      { text: 'Auto-drafted Inward Supplies Statement — Invoice-wise Detail', style: ['italicText', 'centerAlign'], margin: [0, 0, 0, 6] },
      {
        margin: [0, 0, 0, 14], layout: lay,
        table: {
          widths: [80, 275, 80, 275],
          body: [
            [
              { text: 'GSTIN', bold: true, fontSize: 8.5, fillColor: '#FAD2B1' }, { text: safe(gstin), fontSize: 8.5 },
              { text: 'Return Period', bold: true, fontSize: 8.5, fillColor: '#FAD2B1' }, { text: safe(rtnprd), fontSize: 8.5 }
            ],
            [
              { text: 'Generated On', bold: true, fontSize: 8.5, fillColor: '#FAD2B1' }, { text: safe(gendt), fontSize: 8.5 },
              { text: 'Legal / Trade Name', bold: true, fontSize: 8.5, fillColor: '#FAD2B1' }, { text: safe(tradeName || legalName), fontSize: 8.5 }
            ]
          ]
        }
      }
    ];

    // ── Part A — B2B Invoices (14 Columns: Sum = 687pt + 84pt pad = 771pt) ─────────
    const b2bSuppliers = docdata.b2b || [];
    if (b2bSuppliers.length > 0) {
      const b2bBody = [[
        TH('Supplier GSTIN'), TH('Supplier Name'), TH('Invoice No'), TH('Invoice Date'),
        TH('Type'), TH('POS'), TH('Rev Charge'), TH('Taxable (₹)'),
        TH('IGST (₹)'), TH('CGST (₹)'), TH('SGST (₹)'), TH('Cess (₹)'),
        TH('ITC Avail'), TH('Period')
      ]];
      let totTx = 0, totIgst = 0, totCgst = 0, totSgst = 0, totCess = 0;
      b2bSuppliers.forEach(sup => {
        const ctin = sup.ctin || '';
        const trdnm = sup.trdnm || sup.cname || '';
        (sup.inv || []).forEach(inv => {
          const tx = Number(inv.txval) || 0;
          const ig = Number(inv.igst) || 0;
          const cg = Number(inv.cgst) || 0;
          const sg = Number(inv.sgst) || 0;
          const cs = Number(inv.cess) || 0;
          totTx += tx; totIgst += ig; totCgst += cg; totSgst += sg; totCess += cs;
          b2bBody.push([
            { text: ctin, fontSize: 7.5 },
            { text: trdnm, fontSize: 7.5 },
            { text: inv.inum || '', fontSize: 7.5 },
            { text: inv.dt || '', fontSize: 7.5, alignment: 'center' },
            { text: inv.typ || '', fontSize: 7.5, alignment: 'center' },
            { text: String(inv.pos || ''), fontSize: 7.5, alignment: 'center' },
            { text: (inv.rev === 'Y' || inv.rev === true) ? 'Y' : 'N', fontSize: 7.5, alignment: 'center' },
            AC(tx), AC(ig), AC(cg), AC(sg), AC(cs),
            { text: (inv.itcavl === 'Y' || inv.itcavl === 'YES' || inv.itcavl === true) ? 'Y' : 'N', fontSize: 7.5, alignment: 'center' },
            { text: sup.supprdinprd || sup.supprd || '', fontSize: 7.5, alignment: 'center' }
          ]);
        });
      });
      b2bBody.push([
        { text: 'Total B2B Invoices', colSpan: 7, bold: true, fontSize: 7.5, alignment: 'left' },
        {}, {}, {}, {}, {}, {},
        AC(totTx), AC(totIgst), AC(totCgst), AC(totSgst), AC(totCess),
        {}, {}
      ]);
      content.push({ text: 'Part A — B2B Inward Supplies (Invoices)', style: 'subheader' });
      content.push({
        layout: lay,
        margin: [0, 0, 0, 14],
        table: {
          headerRows: 1,
          widths: [74, 105, 68, 46, 18, 18, 24, 65, 54, 54, 54, 42, 25, 40],
          body: b2bBody
        }
      });
    }

    // ── Part B — CDNR Credit / Debit Notes (13 Columns: Sum = 681pt + 78pt pad = 759pt) ───
    const cdnrSuppliers = docdata.cdnr || [];
    if (cdnrSuppliers.length > 0) {
      const cdnrBody = [[
        TH('Supplier GSTIN'), TH('Supplier Name'), TH('Note No'), TH('Note Date'),
        TH('Note Type'), TH('POS'), TH('Taxable (₹)'),
        TH('IGST (₹)'), TH('CGST (₹)'), TH('SGST (₹)'), TH('Cess (₹)'),
        TH('ITC Avail'), TH('Period')
      ]];
      let totTx = 0, totIgst = 0, totCgst = 0, totSgst = 0, totCess = 0;
      cdnrSuppliers.forEach(sup => {
        const ctin = sup.ctin || '';
        const trdnm = sup.trdnm || sup.cname || '';
        (sup.nt || []).forEach(nt => {
          const tx = Number(nt.txval) || 0;
          const ig = Number(nt.igst) || 0;
          const cg = Number(nt.cgst) || 0;
          const sg = Number(nt.sgst) || 0;
          const cs = Number(nt.cess) || 0;
          totTx += tx; totIgst += ig; totCgst += cg; totSgst += sg; totCess += cs;
          cdnrBody.push([
            { text: ctin, fontSize: 7.5 },
            { text: trdnm, fontSize: 7.5 },
            { text: nt.ntnum || '', fontSize: 7.5 },
            { text: nt.dt || '', fontSize: 7.5, alignment: 'center' },
            { text: nt.ntty || nt.typ || '', fontSize: 7.5, alignment: 'center' },
            { text: String(nt.pos || ''), fontSize: 7.5, alignment: 'center' },
            AC(tx), AC(ig), AC(cg), AC(sg), AC(cs),
            { text: (nt.itcavl === 'Y' || nt.itcavl === 'YES' || nt.itcavl === true) ? 'Y' : 'N', fontSize: 7.5, alignment: 'center' },
            { text: sup.supprdinprd || sup.supprd || '', fontSize: 7.5, alignment: 'center' }
          ]);
        });
      });
      cdnrBody.push([
        { text: 'Total Credit / Debit Notes', colSpan: 6, bold: true, fontSize: 7.5, alignment: 'left' },
        {}, {}, {}, {}, {},
        AC(totTx), AC(totIgst), AC(totCgst), AC(totSgst), AC(totCess),
        {}, {}
      ]);
      content.push({ text: 'Part B — Credit / Debit Notes (CDNR)', style: 'subheader' });
      content.push({
        layout: lay,
        margin: [0, 0, 0, 14],
        table: {
          headerRows: 1,
          widths: [74, 115, 68, 46, 26, 18, 65, 54, 54, 54, 42, 25, 40],
          body: cdnrBody
        }
      });
    }

    // ── Part C — ISD Documents (10 Columns: Sum = 670pt + 60pt pad = 730pt) ─────────────
    const isdSuppliers = docdata.isd || [];
    if (isdSuppliers.length > 0) {
      const isdBody = [[
        TH('ISD GSTIN'), TH('ISD Name'), TH('Doc No'), TH('Doc Date'),
        TH('IGST (₹)'), TH('CGST (₹)'), TH('SGST (₹)'), TH('Cess (₹)'),
        TH('ITC Avail'), TH('Period')
      ]];
      let totIgst = 0, totCgst = 0, totSgst = 0, totCess = 0;
      isdSuppliers.forEach(sup => {
        const ctin = sup.ctin || '';
        const trdnm = sup.trdnm || sup.cname || '';
        (sup.doclist || []).forEach(doc => {
          const ig = Number(doc.igst) || 0;
          const cg = Number(doc.cgst) || 0;
          const sg = Number(doc.sgst) || 0;
          const cs = Number(doc.cess) || 0;
          totIgst += ig; totCgst += cg; totSgst += sg; totCess += cs;
          isdBody.push([
            { text: ctin, fontSize: 7.5 },
            { text: trdnm, fontSize: 7.5 },
            { text: doc.docnum || '', fontSize: 7.5 },
            { text: doc.dt || '', fontSize: 7.5, alignment: 'center' },
            AC(ig), AC(cg), AC(sg), AC(cs),
            { text: (doc.itcavl === 'Y' || doc.itcavl === 'YES' || doc.itcavl === true) ? 'Y' : 'N', fontSize: 7.5, alignment: 'center' },
            { text: sup.supprdinprd || sup.supprd || '', fontSize: 7.5, alignment: 'center' }
          ]);
        });
      });
      isdBody.push([
        { text: 'Total ISD Documents', colSpan: 4, bold: true, fontSize: 7.5, alignment: 'left' },
        {}, {}, {},
        AC(totIgst), AC(totCgst), AC(totSgst), AC(totCess),
        {}, {}
      ]);
      content.push({ text: 'Part C — ISD Documents', style: 'subheader' });
      content.push({
        layout: lay,
        margin: [0, 0, 0, 14],
        table: {
          headerRows: 1,
          widths: [80, 145, 75, 50, 65, 65, 65, 50, 30, 45],
          body: isdBody
        }
      });
    }

    // ── Part D — Import of Goods (IMPG) (7 Columns: Sum = 580pt + 42pt pad = 622pt) ────
    const impgDocs = docdata.impg || [];
    if (impgDocs.length > 0) {
      const impgBody = [[
        TH('Port Code'), TH('Bill of Entry No'), TH('BE Date'),
        TH('Taxable (₹)'), TH('IGST (₹)'), TH('Cess (₹)'), TH('Amended')
      ]];
      let totTx = 0, totIgst = 0, totCess = 0;
      impgDocs.forEach(doc => {
        const tx = Number(doc.txval) || 0;
        const ig = Number(doc.igst) || 0;
        const cs = Number(doc.cess) || 0;
        totTx += tx; totIgst += ig; totCess += cs;
        impgBody.push([
          { text: doc.portcd || '', fontSize: 7.5, alignment: 'center' },
          { text: doc.benum || '', fontSize: 7.5 },
          { text: doc.bedt || '', fontSize: 7.5, alignment: 'center' },
          AC(tx), AC(ig), AC(cs),
          { text: doc.isamd || 'N', fontSize: 7.5, alignment: 'center' }
        ]);
      });
      impgBody.push([
        { text: 'Total Imports', colSpan: 3, bold: true, fontSize: 7.5, alignment: 'left' },
        {}, {},
        AC(totTx), AC(totIgst), AC(totCess),
        {}
      ]);
      content.push({ text: 'Part D — Import of Goods (IMPG)', style: 'subheader' });
      content.push({
        layout: lay,
        margin: [0, 0, 0, 14],
        table: {
          headerRows: 1,
          widths: [80, 110, 65, 100, 95, 75, 55],
          body: impgBody
        }
      });
    }

    if (b2bSuppliers.length === 0 && cdnrSuppliers.length === 0 && isdSuppliers.length === 0 && impgDocs.length === 0) {
      content.push({ text: 'No inward supplier records reported in Form GSTR-2B for this tax period.', italics: true, fontSize: 10, alignment: 'center', margin: [0, 20, 0, 20] });
    }

    const d = new Date();
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    const fileName = `GSTR2B_${gstin}_${rtnprd}_${dd}${mm}${yyyy}_Detailed.pdf`;

    const docDefinition = {
      pageSize: 'A4',
      pageOrientation: 'landscape',
      pageMargins: [20, 25, 20, 25],
      watermark: { text: 'System Generated', color: '#94a3b8', opacity: 0.10, bold: true, fontSize: 80 },
      styles: {
        header: { fontSize: 15, bold: true, alignment: 'center', margin: [0, 0, 0, 4] },
        subheader: { fontSize: 9.5, bold: true, color: '#1e40af', fillColor: '#eff6ff', margin: [0, 8, 0, 4] },
        italicText: { italics: true, fontSize: 8.5 },
        centerAlign: { alignment: 'center' },
        tableHeading: { fillColor: '#1e3a5f', color: 'white', bold: true, alignment: 'center', fontSize: 7.5 }
      },
      content
    };

    await compileAndDownloadPdfViaPortal(docDefinition, fileName, period, 'GSTR2B');
    return true;
  } catch (err) {
    console.error('[ReturnPilot] GSTR-2B Detailed PDF Error:', err);
    throw err;
  }
}

if (typeof window !== 'undefined') {
  window.download2bDetailedPdf = download2bDetailedPdf;
}

// ── 3c. GSTR-9 Auto-Drafted GSTR-1 Summary PDF Engine ────────

async function download9Gstr1SummaryPdf(period) {
  try {
    if (typeof ReturnPilotSecurity !== 'undefined') {
      const subState = (typeof currentSubscriptionState !== 'undefined') ? currentSubscriptionState : null;
      const perm = ReturnPilotSecurity.checkFeatureAccess('PDF', subState);
      if (!perm.allowed) {
        if (typeof window.showPremiumUpgradeModal === 'function') {
          window.showPremiumUpgradeModal(perm.reason);
        } else {
          const m = document.getElementById('premiumUpgradeModal') || document.getElementById('donationModal');
          if (m) m.hidden = false;
        }
        return;
      }
    }

    const gstin = (typeof session !== 'undefined' && session.gstin) ? session.gstin : '';
    const fp = (period && period.value) ? period.value : (typeof period === 'string' ? period : '032025');
    let fy = (typeof session !== 'undefined' && session.finYear) ? session.finYear : '';
    if (!fy && period && period.month) {
      fy = period.month.replace(/^FY\s*/i, '').trim();
    }
    if (!fy || !fy.includes('-')) {
      const endYr = parseInt(fp.substring(2, 6), 10);
      if (!isNaN(endYr)) {
        fy = `${endYr - 1}-${String(endYr % 100).padStart(2, '0')}`;
      }
    }

    const url = `https://return.gst.gov.in/returns2/auth/api/gstr9/gstr1summ?gstin=${gstin}&ret_period=${fp}`;
    const res = await processAsync({ request: 'get', url });
    if (!res || !res.status) {
      throw new Error('Failed to fetch GSTR-1 summary from GST portal');
    }

    let parsed = null;
    try {
      parsed = JSON.parse(res.response);
    } catch (_) {}

    if (!parsed || (parsed.status !== 1 && !parsed.data)) {
      throw new Error(parsed?.error?.message || 'GSTR-1 summary rejected by GST portal');
    }

    const data = parsed.data || parsed;
    const legalName = (typeof session !== 'undefined' && session.businessName) ? session.businessName : (data.lgl_name || data.legal_name || '');
    const tradeName = data.trd_name || data.trade_name || '';

    const content = [
      { text: 'Auto-Drafted GSTR-1 Summary for GSTR-9', style: 'header' },
      { text: 'Summary of Outward Supplies declared in Form GSTR-1 during the Financial Year', style: 'subhead', alignment: 'center' },
      {
        style: 'tableDetails',
        table: {
          widths: ['20%', '30%', '20%', '30%'],
          body: [
            [{ text: 'GSTIN', bold: true }, g9cText(gstin), { text: 'Financial Year', bold: true }, g9cText(fy)],
            [{ text: 'Legal Name', bold: true }, g9cText(legalName), { text: 'Trade Name', bold: true }, g9cText(tradeName || '-')]
          ]
        }
      },
      { text: '(Amount in ₹ in all tables)\n', alignment: 'right', fontSize: 9 }
    ];

    const SECTION_LABELS = {
      'b2b': '4A, 4B, 4C, 6B, 6C - B2B Invoices',
      'b2ba': '4A, 4B, 4C, 6B, 6C - B2B Invoices (Amended)',
      'b2cl': '5A, 5B - B2C (Large) Invoices',
      'b2cla': '5A, 5B - B2C (Large) Invoices (Amended)',
      'b2cs': '7 - B2C (Small) Details',
      'b2csa': '7 - B2C (Small) Details (Amended)',
      'exp': '6A - Exports Invoices',
      'expa': '6A - Exports Invoices (Amended)',
      'cdnr': '9B - Credit / Debit Notes (Registered)',
      'cdnra': '9B - Credit / Debit Notes (Registered) (Amended)',
      'cdnur': '9B - Credit / Debit Notes (Unregistered)',
      'cdnura': '9B - Credit / Debit Notes (Unregistered) (Amended)',
      'at': '11A(1), 11A(2) - Tax Liability (Advance Received)',
      'ata': '11A - Tax Liability (Advance Received) (Amended)',
      'atadj': '11B(1), 11B(2) - Adjustment of Advances',
      'atadja': '11B - Adjustment of Advances (Amended)',
      'nil': '8A, 8B, 8C, 8D - Nil / Exempted / Non-GST Outward Supplies',
      'hsn': '12 - HSN-wise summary of outward supplies',
      'doc_issue': '13 - Documents issued during the tax period'
    };

    const tableRows = [
      [
        { text: 'Table / Section', bold: true, alignment: 'center', style: 'tableHeader' },
        { text: 'Taxable Value', bold: true, alignment: 'center', style: 'tableHeader' },
        { text: 'Integrated Tax', bold: true, alignment: 'center', style: 'tableHeader' },
        { text: 'Central Tax', bold: true, alignment: 'center', style: 'tableHeader' },
        { text: 'State/UT Tax', bold: true, alignment: 'center', style: 'tableHeader' },
        { text: 'Cess', bold: true, alignment: 'center', style: 'tableHeader' },
        { text: 'Total Tax', bold: true, alignment: 'center', style: 'tableHeader' }
      ]
    ];

    let grandTx = 0, grandIgst = 0, grandCgst = 0, grandSgst = 0, grandCess = 0, grandTot = 0;

    if (Array.isArray(data.sec_sum) && data.sec_sum.length > 0) {
      data.sec_sum.forEach(row => {
        const desc = SECTION_LABELS[row.sec_nm?.toLowerCase()] || row.sec_name || row.sec_desc || row.sec_nm || 'Other Outward Supplies';
        const tx = g9cNum(row.txval ?? row.tax_val ?? row.taxable_value ?? row.val ?? 0);
        const igst = g9cNum(row.iamt ?? row.igst ?? 0);
        const cgst = g9cNum(row.camt ?? row.cgst ?? 0);
        const sgst = g9cNum(row.samt ?? row.sgst ?? 0);
        const cess = g9cNum(row.csamt ?? row.cess ?? 0);
        const tot = igst + cgst + sgst + cess;

        grandTx += tx; grandIgst += igst; grandCgst += cgst; grandSgst += sgst; grandCess += cess; grandTot += tot;

        tableRows.push([
          g9cText(desc),
          g9cCell(tx),
          g9cCell(igst),
          g9cCell(cgst),
          g9cCell(sgst),
          g9cCell(cess),
          g9cCell(tot)
        ]);
      });
    } else {
      Object.keys(SECTION_LABELS).forEach(secKey => {
        const row = data[secKey] || data[secKey.toUpperCase()];
        if (row && typeof row === 'object') {
          const tx = g9cNum(row.txval ?? row.tax_val ?? row.taxable_value ?? row.val ?? 0);
          const igst = g9cNum(row.iamt ?? row.igst ?? 0);
          const cgst = g9cNum(row.camt ?? row.cgst ?? 0);
          const sgst = g9cNum(row.samt ?? row.sgst ?? 0);
          const cess = g9cNum(row.csamt ?? row.cess ?? 0);
          const tot = igst + cgst + sgst + cess;

          if (tx !== 0 || tot !== 0 || row.present) {
            grandTx += tx; grandIgst += igst; grandCgst += cgst; grandSgst += sgst; grandCess += cess; grandTot += tot;
            tableRows.push([
              g9cText(SECTION_LABELS[secKey]),
              g9cCell(tx),
              g9cCell(igst),
              g9cCell(cgst),
              g9cCell(sgst),
              g9cCell(cess),
              g9cCell(tot)
            ]);
          }
        }
      });
    }

    if (tableRows.length === 1) {
      tableRows.push([
        { text: 'No outward supply records reported in Form GSTR-1', colSpan: 7, alignment: 'center', italics: true },
        {}, {}, {}, {}, {}, {}
      ]);
    } else {
      tableRows.push([
        { text: 'Total', bold: true, alignment: 'left' },
        g9cCell(grandTx, { bold: true }),
        g9cCell(grandIgst, { bold: true }),
        g9cCell(grandCgst, { bold: true }),
        g9cCell(grandSgst, { bold: true }),
        g9cCell(grandCess, { bold: true }),
        g9cCell(grandTot, { bold: true })
      ]);
    }

    content.push({
      style: 'tableExample',
      table: {
        widths: ['34%', '11%', '11%', '11%', '11%', '11%', '11%'],
        body: tableRows
      }
    });

    const cleanFy = (fy || 'FY').replace(/[^0-9-]/g, '');
    const pdfName = `${cleanFy}_${gstin}_GSTR9_GSTR1_Summary.pdf`;

    const docDefinition = {
      pageSize: 'A4',
      pageOrientation: 'landscape',
      pageMargins: [30, 40, 30, 40],
      watermark: {
        text: '  AUTO-DRAFTED  ',
        color: '#94a3b8',
        opacity: 0.15,
        bold: true,
        fontSize: 100
      },
      content,
      styles: {
        header: { fontSize: 16, bold: true, alignment: 'center', margin: [0, 0, 0, 4] },
        subhead: { fontSize: 11, color: '#475569', margin: [0, 0, 0, 10] },
        tableDetails: { margin: [0, 5, 0, 10], fontSize: 10 },
        tableExample: { margin: [0, 5, 0, 15] },
        tableHeader: { fillColor: '#f1f5f9', bold: true, fontSize: 10 }
      }
    };

    await compileAndDownloadPdfViaPortal(docDefinition, pdfName, period);
  } catch (err) {
    console.error('[ReturnPilot] GSTR-1 Summary PDF Error:', err);
    throw err;
  }
}

// ── 3d. GSTR-9 Auto-Drafted GSTR-3B Summary PDF Engine ───────

async function download9Gstr3bSummaryPdf(period) {
  try {
    if (typeof ReturnPilotSecurity !== 'undefined') {
      const subState = (typeof currentSubscriptionState !== 'undefined') ? currentSubscriptionState : null;
      const perm = ReturnPilotSecurity.checkFeatureAccess('PDF', subState);
      if (!perm.allowed) {
        if (typeof window.showPremiumUpgradeModal === 'function') {
          window.showPremiumUpgradeModal(perm.reason);
        } else {
          const m = document.getElementById('premiumUpgradeModal') || document.getElementById('donationModal');
          if (m) m.hidden = false;
        }
        return;
      }
    }

    const gstin = (typeof session !== 'undefined' && session.gstin) ? session.gstin : '';
    const fp = (period && period.value) ? period.value : (typeof period === 'string' ? period : '032025');
    let fy = (typeof session !== 'undefined' && session.finYear) ? session.finYear : '';
    if (!fy && period && period.month) {
      fy = period.month.replace(/^FY\s*/i, '').trim();
    }
    if (!fy || !fy.includes('-')) {
      const endYr = parseInt(fp.substring(2, 6), 10);
      if (!isNaN(endYr)) {
        fy = `${endYr - 1}-${String(endYr % 100).padStart(2, '0')}`;
      }
    }

    const url = `https://return.gst.gov.in/returns2/auth/api/gstr9/gstr3bsumm?gstin=${gstin}&ret_period=${fp}`;
    const res = await processAsync({ request: 'get', url });
    if (!res || !res.status) {
      throw new Error('Failed to fetch GSTR-3B summary from GST portal');
    }

    let parsed = null;
    try {
      parsed = JSON.parse(res.response);
    } catch (_) {}

    if (!parsed || (parsed.status !== 1 && !parsed.data)) {
      throw new Error(parsed?.error?.message || 'GSTR-3B summary rejected by GST portal');
    }

    const data = parsed.data || parsed;
    const legalName = (typeof session !== 'undefined' && session.businessName) ? session.businessName : (data.lgl_name || data.legal_name || '');
    const tradeName = data.trd_name || data.trade_name || '';

    const content = [
      { text: 'Auto-Drafted GSTR-3B Summary for GSTR-9', style: 'header' },
      { text: 'Summary of Supplies & ITC declared in Form GSTR-3B during the Financial Year', style: 'subhead', alignment: 'center' },
      {
        style: 'tableDetails',
        table: {
          widths: ['20%', '30%', '20%', '30%'],
          body: [
            [{ text: 'GSTIN', bold: true }, g9cText(gstin), { text: 'Financial Year', bold: true }, g9cText(fy)],
            [{ text: 'Legal Name', bold: true }, g9cText(legalName), { text: 'Trade Name', bold: true }, g9cText(tradeName || '-')]
          ]
        }
      },
      { text: '(Amount in ₹ in all tables)\n', alignment: 'right', fontSize: 9 }
    ];

    const sup31 = data.sup_details || data.osup_det || data.table3_1 || {};
    const row31 = (lbl, obj) => ([
      g9cText(lbl),
      g9cCell(obj?.txval ?? obj?.tax_val ?? obj?.val ?? 0),
      g9cCell(obj?.iamt ?? obj?.igst ?? 0),
      g9cCell(obj?.camt ?? obj?.cgst ?? 0),
      g9cCell(obj?.samt ?? obj?.sgst ?? 0),
      g9cCell(obj?.csamt ?? obj?.cess ?? 0)
    ]);

    content.push(
      { text: '3.1 Details of Outward Supplies and inward supplies liable to reverse charge', bold: true, fontSize: 11, margin: [0, 10, 0, 4] },
      {
        style: 'tableExample',
        table: {
          widths: ['40%', '12%', '12%', '12%', '12%', '12%'],
          body: [
            [
              { text: 'Nature of Supplies', bold: true, alignment: 'center', style: 'tableHeader' },
              { text: 'Total Taxable Value', bold: true, alignment: 'center', style: 'tableHeader' },
              { text: 'Integrated Tax', bold: true, alignment: 'center', style: 'tableHeader' },
              { text: 'Central Tax', bold: true, alignment: 'center', style: 'tableHeader' },
              { text: 'State/UT Tax', bold: true, alignment: 'center', style: 'tableHeader' },
              { text: 'Cess', bold: true, alignment: 'center', style: 'tableHeader' }
            ],
            row31('(a) Outward taxable supplies (other than zero rated, nil rated and exempted)', sup31.osup_det || sup31.osup_tax || sup31.taxable),
            row31('(b) Outward taxable supplies (zero rated)', sup31.osup_zero || sup31.zero_rated),
            row31('(c) Other outward supplies (Nil rated, exempted)', sup31.osup_nil_exmp || sup31.nil_exempt),
            row31('(d) Inward supplies (liable to reverse charge)', sup31.isup_rev || sup31.reverse_charge),
            row31('(e) Non-GST outward supplies', sup31.osup_nongst || sup31.non_gst)
          ]
        }
      },
      { text: '\n' }
    );

    const itc4 = data.itc_elg || data.table4 || {};
    const itcAvl = itc4.itc_avl || itc4.available || {};
    const itcRev = itc4.itc_rev || itc4.reversed || {};
    const itcNet = itc4.itc_net || itc4.net || {};
    const itcInelg = itc4.itc_inelg || itc4.ineligible || {};

    const rowItc = (lbl, obj, isHeader) => ([
      isHeader ? { text: lbl, bold: true, colSpan: 5 } : g9cText(lbl),
      isHeader ? {} : g9cCell(obj?.iamt ?? obj?.igst ?? 0),
      isHeader ? {} : g9cCell(obj?.camt ?? obj?.cgst ?? 0),
      isHeader ? {} : g9cCell(obj?.samt ?? obj?.sgst ?? 0),
      isHeader ? {} : g9cCell(obj?.csamt ?? obj?.cess ?? 0)
    ]);

    content.push(
      { text: '4. Eligible ITC', bold: true, fontSize: 11, margin: [0, 5, 0, 4] },
      {
        style: 'tableExample',
        table: {
          widths: ['40%', '15%', '15%', '15%', '15%'],
          body: [
            [
              { text: 'Details', bold: true, alignment: 'center', style: 'tableHeader' },
              { text: 'Integrated Tax', bold: true, alignment: 'center', style: 'tableHeader' },
              { text: 'Central Tax', bold: true, alignment: 'center', style: 'tableHeader' },
              { text: 'State/UT Tax', bold: true, alignment: 'center', style: 'tableHeader' },
              { text: 'Cess', bold: true, alignment: 'center', style: 'tableHeader' }
            ],
            rowItc('(A) ITC Available (whether in full or in part)', null, true),
            rowItc('(1) Import of goods', itcAvl.itc_goods || itcAvl.import_goods || itcAvl.ty_goods),
            rowItc('(2) Import of services', itcAvl.itc_services || itcAvl.import_services || itcAvl.ty_services),
            rowItc('(3) Inward supplies received from ISD', itcAvl.itc_isd || itcAvl.isd),
            rowItc('(4) Inward supplies liable to reverse charge', itcAvl.itc_rev || itcAvl.reverse_charge),
            rowItc('(5) All other ITC', itcAvl.itc_other || itcAvl.other),
            rowItc('(B) ITC Reversed', null, true),
            rowItc('(1) As per rules 42 & 43 of CGST Rules and section 17(5)', itcRev.itc_rule || itcRev.rule),
            rowItc('(2) Others', itcRev.itc_other || itcRev.other),
            rowItc('(C) Net ITC Available (A) - (B)', itcNet),
            rowItc('(D) Ineligible ITC', null, true),
            rowItc('(1) As per section 17(5)', itcInelg.itc_blocked || itcInelg.blocked),
            rowItc('(2) Others', itcInelg.itc_other || itcInelg.other)
          ]
        }
      }
    );

    const cleanFy = (fy || 'FY').replace(/[^0-9-]/g, '');
    const pdfName = `${cleanFy}_${gstin}_GSTR9_GSTR3B_Summary.pdf`;

    const docDefinition = {
      pageSize: 'A4',
      pageOrientation: 'landscape',
      pageMargins: [30, 40, 30, 40],
      watermark: {
        text: '  AUTO-DRAFTED  ',
        color: '#94a3b8',
        opacity: 0.15,
        bold: true,
        fontSize: 100
      },
      content,
      styles: {
        header: { fontSize: 16, bold: true, alignment: 'center', margin: [0, 0, 0, 4] },
        subhead: { fontSize: 11, color: '#475569', margin: [0, 0, 0, 10] },
        tableDetails: { margin: [0, 5, 0, 10], fontSize: 10 },
        tableExample: { margin: [0, 5, 0, 15] },
        tableHeader: { fillColor: '#f1f5f9', bold: true, fontSize: 10 }
      }
    };

    await compileAndDownloadPdfViaPortal(docDefinition, pdfName, period);
  } catch (err) {
    console.error('[ReturnPilot] GSTR-3B Summary PDF Error:', err);
    throw err;
  }
}


// ── 4. GSTR-9C PDF Engine ─────────────────────────────────────

//  ReturnPilot v3.0
//  © 2026 KasyHQ. All Rights Reserved.






//  GSTR-9C PDF GENERATION (DATA-DRIVEN + PROVISIONED TABLES)
//  - Builds portal-like PDF using pdfMake (no resp.data.url flow)
//  - Renders available tables and gracefully skips missing ones
//  - Includes "provision" builders for Table 6/8/13/15 (reasons) and Table 17


// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function g9cNum(v) {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

function g9cFmt(v) {
  const n = g9cNum(v);
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function g9cCell(v, extra) {
  return Object.assign({ text: g9cFmt(v), alignment: 'right', fontSize: 10 }, extra || {});
}

function g9cText(v, extra) {
  return Object.assign({ text: (v === null || v === undefined) ? '' : String(v), fontSize: 10 }, extra || {});
}



function g9cSum4(o) {
  return g9cNum(o?.cgst) + g9cNum(o?.sgst) + g9cNum(o?.igst) + g9cNum(o?.cess);
}

// ─────────────────────────────────────────────────────────────
// Provision builders (safe if data missing / shape changes)
// ─────────────────────────────────────────────────────────────

/**
 * Reason tables used by Angular reason1() for:
 * Table 6, 8, 10 (already present), 13, 15 etc.
 *
 * Supports rsn[] or reason[] or reasons[] arrays.
 * Each item can have:
 * - number (RSN1...)
 * - desc (string)
 * - val / amt / amount / value (number) [optional]
 *
 * If numeric is absent, it prints 0.00.
 */
function pushReasonTable(content, tableNo, title, tableObj, opts) {
  const options = opts || {};
  const rsn = tableObj?.rsn || tableObj?.reason || tableObj?.reasons;

  if (!Array.isArray(rsn) || rsn.length === 0) return;

  content.push({
    style: 'tableExample',
    pageBreak: options.pageBreakBefore ? 'before' : undefined,
    table: {
      widths: ['12%', '70%', '18%'],
      body: [
        [
          { text: String(tableNo), alignment: 'center', bold: true },
          { text: title, alignment: 'center', bold: true },
          { text: 'Amount (₹)', alignment: 'center', bold: true }
        ],
        ...rsn.map((r, i) => ([
          { text: r?.number || `RSN${i + 1}`, alignment: 'center' },
          { text: r?.desc || '' },
          g9cCell(r?.val ?? r?.amt ?? r?.amount ?? r?.value ?? 0)
        ]))
      ]
    }
  }, { text: '\n\n' });
}

/**
 * Rate-wise tax table (used by 9, 11 and provision for 17).
 * Accepts:
 * - rate: [{desc, tax_val, cgst, sgst, igst, cess}]
 * - tot_amt_payable / tot_amt_paid / unrec_amt (optional)
 */
function pushRateWiseTaxTable(content, tableNo, title, tableObj, opts) {
  const options = opts || {};
  const rate = tableObj?.rate;
  if (!Array.isArray(rate) || rate.length === 0) return;

  content.push({
    style: 'tableExample',
    pageBreak: options.pageBreakBefore ? 'before' : undefined,
    table: {
      widths: ['10%', '15%', '15%', '15%', '15%', '15%', '15%'],
      body: [
        [{ text: String(tableNo), alignment: 'center', bold: true }, { text: title, colSpan: 6, alignment: 'center', bold: true }, {}, {}, {}, {}, {}],
        [
          { text: 'Rate', bold: true, alignment: 'center' },
          { text: 'Taxable Value', bold: true, alignment: 'center' },
          { text: 'CGST', bold: true, alignment: 'center' },
          { text: 'SGST', bold: true, alignment: 'center' },
          { text: 'IGST', bold: true, alignment: 'center' },
          { text: 'Cess', bold: true, alignment: 'center' },
          { text: 'Total', bold: true, alignment: 'center' }
        ],
        ...rate.map(r => {
          const total = g9cNum(r?.cgst) + g9cNum(r?.sgst) + g9cNum(r?.igst) + g9cNum(r?.cess);
          return [
            g9cText(r?.desc, { alignment: 'center' }),
            g9cCell(r?.tax_val),
            g9cCell(r?.cgst),
            g9cCell(r?.sgst),
            g9cCell(r?.igst),
            g9cCell(r?.cess),
            g9cCell(total)
          ];
        })
      ]
    }
  });

  // Optional totals blocks (if present)
  const totals = [];
  if (tableObj?.tot_amt_payable) totals.push(['Total payable', tableObj.tot_amt_payable]);
  if (tableObj?.tot_amt_paid)    totals.push(['Total paid', tableObj.tot_amt_paid]);
  if (tableObj?.unrec_amt)       totals.push(['Un-reconciled amount', tableObj.unrec_amt]);

  if (totals.length) {
    content.push({
      style: 'tableExample',
      table: {
        widths: ['25%', '15%', '15%', '15%', '15%', '15%'],
        body: [
          [
            { text: 'Summary', colSpan: 6, alignment: 'center', bold: true },
            {}, {}, {}, {}, {}
          ],
          [
            { text: 'Description', bold: true, alignment: 'center' },
            { text: 'CGST', bold: true, alignment: 'center' },
            { text: 'SGST', bold: true, alignment: 'center' },
            { text: 'IGST', bold: true, alignment: 'center' },
            { text: 'Cess', bold: true, alignment: 'center' },
            { text: 'Total', bold: true, alignment: 'center' }
          ],
          ...totals.map(([lbl, obj]) => ([
            { text: lbl },
            g9cCell(obj?.cgst),
            g9cCell(obj?.sgst),
            g9cCell(obj?.igst),
            g9cCell(obj?.cess),
            g9cCell(g9cSum4(obj))
          ]))
        ]
      }
    }, { text: '\n\n' });
  } else {
    content.push({ text: '\n\n' });
  }
}

/**
 * Provision: Table 17 (Additional liability due to non-reconciliation)
 * Usually looks like Table 11 (rate-wise) + totals like inter/late_fee/pen/oth.
 */
function pushTable17(content, table17, opts) {
  if (!table17) return;

  pushRateWiseTaxTable(
    content,
    17,
    'Additional liability due to non-reconciliation',
    table17,
    opts
  );

  // Optional "other heads" summary (if present)
  const heads = [
    ['Interest', table17.inter],
    ['Late fee', table17.late_fee],
    ['Penalty',  table17.pen],
    ['Other',    table17.oth]
  ].filter(([, o]) => o && (g9cSum4(o) !== 0));

  if (!heads.length) return;

  content.push({
    style: 'tableExample',
    table: {
      widths: ['25%', '15%', '15%', '15%', '15%', '15%'],
      body: [
        [{ text: 'Other heads', colSpan: 6, alignment: 'center', bold: true }, {}, {}, {}, {}, {}],
        [
          { text: 'Description', bold: true, alignment: 'center' },
          { text: 'CGST', bold: true, alignment: 'center' },
          { text: 'SGST', bold: true, alignment: 'center' },
          { text: 'IGST', bold: true, alignment: 'center' },
          { text: 'Cess', bold: true, alignment: 'center' },
          { text: 'Total', bold: true, alignment: 'center' }
        ],
        ...heads.map(([lbl, obj]) => ([
          { text: lbl },
          g9cCell(obj?.cgst),
          g9cCell(obj?.sgst),
          g9cCell(obj?.igst),
          g9cCell(obj?.cess),
          g9cCell(g9cSum4(obj))
        ]))
      ]
    }
  }, { text: '\n\n' });
}

// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────

async function download9cPdf(period) {
  try {
    const gstin = session.gstin;

    const [formMsg, recdsMsg, retsumMsg] = await Promise.all([
      processAsync({ request: 'get', url: `https://return.gst.gov.in/returns/auth/api/formdetails?rtn_prd=${period.value}&rtn_typ=GSTR9C` }),
      processAsync({ request: 'get', url: `https://return.gst.gov.in/returns2/auth/api/gstr9c/recds?gstin=${gstin}&ret_period=${period.value}` }),
      processAsync({ request: 'get', url: `https://return.gst.gov.in/returns2/auth/api/gstr9c/retsum?gstin=${gstin}&retperiod=${period.value}` })
    ]);

    if (!formMsg.status || !retsumMsg.status) {
      alert('Failed fetching GSTR-9C data. Please check your connection to the GST portal.');
      return;
    }

    const formResp = JSON.parse(formMsg.response);
    const retsum   = JSON.parse(retsumMsg.response);

    let recds = null;
    try { recds = recdsMsg.status ? JSON.parse(recdsMsg.response) : null; } catch (e) {}

    if (formResp.status !== 1) throw new Error(formResp.error?.message || 'GSTR-9C formdetails rejected');
    if (retsum.status !== 1)   throw new Error(retsum.error?.message   || 'GSTR-9C retsum rejected');

    const formDetails = formResp.data || {};
    const audited     = retsum?.data?.gstr9cdata?.audited_data || {};
    const dcupdtls    = retsum?.data?.dcupdtls || {};

    // Tables (prefer audited_data; fallback to recds if GSTN supplies there)
    const t5  = audited.table5  || recds?.data?.table5  || {};
    const t6  = audited.table6  || recds?.data?.table6  || null;  // provision
    const t7  = audited.table7  || recds?.data?.table7  || {};
    const t8  = audited.table8  || recds?.data?.table8  || null;  // provision
    const t9  = audited.table9  || recds?.data?.table9  || {};
    const t10 = audited.table10 || recds?.data?.table10 || null;  // present in your payload
    const t11 = audited.table11 || recds?.data?.table11 || {};
    const t12 = audited.table12 || recds?.data?.table12 || {};
    const t13 = audited.table13 || recds?.data?.table13 || null;  // provision
    const t14 = audited.table14 || recds?.data?.table14 || {};
    const t15 = audited.table15 || recds?.data?.table15 || null;  // provision
    const t16 = audited.table16 || recds?.data?.table16 || {};
    const t17 = audited.table17 || recds?.data?.table17 || null;  // provision

    // Watermark + filename
    const filingStatus = formDetails.status; // "FIL" etc.
    const watermark = (filingStatus === 'FIL' || filingStatus === 'FRZ') ? '  FINAL  ' : '  DRAFT  ';

    const stampNow = new Date();
    const todayStamp = `${String(stampNow.getDate()).padStart(2, '0')}${String(stampNow.getMonth() + 1).padStart(2, '0')}${stampNow.getFullYear()}`;
    const pdfname = (watermark.includes('FINAL'))
      ? `GSTR-9C_${audited.gstin || session.gstin}_${period.value}.pdf`
      : `GSTR-9C_${audited.gstin || session.gstin}_${todayStamp}.pdf`;

    const fy = formDetails.fy || audited.fy || session.finYear;

    // ─────────────────────────────────────────────────────
    // Content start (matches Angular header structure)
    // ─────────────────────────────────────────────────────

    const content = [
      { text: 'Form GSTR-9C', style: 'header' },
      { text: 'See rule 80(3)', style: 'rule' },
      { text: 'Reconciliation Statement\nPART – A', style: 'header1' },

      {
        style: 'tableDetails',
        table: {
          widths: ['5%', '40%', '55%'],
          body: [
            [{ text: 'Pt.I', bold: true }, { text: 'Basic Details', alignment: 'center', bold: true, colSpan: 2 }, {}],
            [{ text: '1', alignment: 'center' }, { text: 'Financial Year', alignment: 'left' }, g9cText(fy) ],
            [{ text: '2', alignment: 'center' }, { text: 'GSTIN', alignment: 'left' }, g9cText(audited.gstin || formDetails.gstin || session.gstin) ],
            [{ text: '3(a)', alignment: 'center' }, { text: 'Legal Name', alignment: 'left' }, g9cText(audited.lgl_name || formDetails.ln || session.businessName) ],
            [{ text: '3(b)', alignment: 'center' }, { text: 'Trade Name (if any)', alignment: 'left' }, g9cText(audited.trd_name || formDetails.tn) ],
            [{ text: '3(c)', alignment: 'center' }, { text: 'ARN', alignment: 'left' }, g9cText(audited.arn || formDetails.arn) ],
            [{ text: '3(d)', alignment: 'center' }, { text: 'ARN Date', alignment: 'left' }, g9cText(audited.arn_date || formDetails.fil_dt) ],
            [{ text: '4', alignment: 'center' }, { text: 'Name of Act. If you are liable to audit under any Act', alignment: 'left' }, g9cText(audited.act_name || '') ]
          ]
        }
      },

      { text: '(Amount in ₹ in all tables) ', alignment: 'right', fontSize: 10 },
      { text: 'Reconciliation of turnover declared in audited Annual Financial Statement with turnover declared in Annual Return (GSTR-9)\n\n', style: 'subhead' }
    ];

    // ─────────────────────────────────────────────────────
    // Table 5
    // ─────────────────────────────────────────────────────
    if (t5 && (t5.turnovr !== undefined || t5.annul_turn_decl !== undefined)) {
      content.push({
        style: 'tableExample',
        table: {
          widths: ['10%', '55%', '35%'],
          body: [
            [{ text: '5', alignment: 'center', bold: true }, { text: 'Reconciliation of Gross Turnover', colSpan: 2, alignment: 'center', bold: true }, {}],
            [{ text: 'A', alignment: 'center' }, { text: 'Turnover (including exports) as per audited financial statements' }, g9cCell(t5.turnovr) ],
            [{ text: 'B', alignment: 'center' }, { text: 'Unbilled revenue at the beginning of the Financial Year' },          g9cCell(t5.turnovr_apr_jun) ],
            [{ text: 'C', alignment: 'center' }, { text: 'Unbilled revenue at the end of the Financial Year' },                g9cCell(t5.annul_turn_adj) ],
            [{ text: 'D', alignment: 'center' }, { text: 'Deemed supply under Schedule I' },                                   g9cCell(0) ],
            [{ text: 'E', alignment: 'center' }, { text: 'Credit notes issued after the end of the financial year but reflected in the annual return' }, g9cCell(0) ],
            [{ text: 'F', alignment: 'center' }, { text: 'Trade discounts accounted for in the audited Annual Financial Statement but not permissible under GST' }, g9cCell(0) ],
            [{ text: 'G', alignment: 'center' }, { text: 'Turnover from April 2017 to June 2017 (for FY 2017-18 only)' },      g9cCell(0) ],
            [{ text: 'H', alignment: 'center' }, { text: 'Un-reconciled turnover (A ± B ± C ± D ± E ± F ± G)' },              g9cCell(t5.unrec_turnovr) ],
            [{ text: 'I', alignment: 'center' }, { text: 'Turnover as per Annual Return (GSTR-9)' },                           g9cCell(t5.annul_turn_decl) ]
          ]
        }
      }, { text: '\n\n' });
    }

    // ─────────────────────────────────────────────────────
    // Provision: Table 6 (Reasons for turnover difference)
    // ─────────────────────────────────────────────────────
    pushReasonTable(content, 6, 'Reasons for turnover difference', t6, { pageBreakBefore: false });

    // ─────────────────────────────────────────────────────
    // Table 7
    // ─────────────────────────────────────────────────────
    if (t7 && t7.tax_turn_annul !== undefined) {
      content.push({
        style: 'tableExample',
        table: {
          widths: ['10%', '55%', '35%'],
          body: [
            [{ text: '7', alignment: 'center', bold: true }, { text: 'Reconciliation of Taxable Turnover', colSpan: 2, alignment: 'center', bold: true }, {}],
            [{ text: 'A', alignment: 'center' }, { text: 'Annual turnover after adjustments (from Table 5)' }, g9cCell(t7.annul_turn_adj) ],
            [{ text: 'B', alignment: 'center' }, { text: 'Turnover declared in Annual Return (GSTR-9)' },      g9cCell(t7.tax_turn_annul) ],
            [{ text: 'C', alignment: 'center' }, { text: 'Un-reconciled taxable turnover (A - B)' },           g9cCell(t7.unrec_tax_turn) ]
          ]
        }
      }, { text: '\n\n' });
    }

    // ─────────────────────────────────────────────────────
    // Provision: Table 8 (Reasons for taxable turnover difference)
    // ─────────────────────────────────────────────────────
    pushReasonTable(content, 8, 'Reasons for taxable turnover difference', t8, { pageBreakBefore: false });

    // ─────────────────────────────────────────────────────
    // Table 9 (rate-wise)
    // ─────────────────────────────────────────────────────
    pushRateWiseTaxTable(content, 9, 'Reconciliation of Tax Paid', t9, { pageBreakBefore: false });

    // ─────────────────────────────────────────────────────
    // Table 10 (Reasons for payment difference) – present in your payload
    // ─────────────────────────────────────────────────────
    // Uses reason-style rendering (table10.rsn[])
    pushReasonTable(content, 10, 'Reasons for difference in amount payable and amount paid', t10, { pageBreakBefore: false });

    // ─────────────────────────────────────────────────────
    // Table 11 – Additional amount payable (rate-wise)
    // ─────────────────────────────────────────────────────
    pushRateWiseTaxTable(content, 11, 'Additional amount payable (rate-wise)', t11, { pageBreakBefore: false });

    // ─────────────────────────────────────────────────────
    // Table 12 – Net ITC reconciliation
    // ─────────────────────────────────────────────────────
    if (t12 && t12.itc_avail !== undefined) {
      content.push({
        style: 'tableExample',
        table: {
          widths: ['10%','55%','35%'],
          body: [
            [{ text: '12', alignment: 'center', bold: true }, { text: 'Reconciliation of Net ITC', colSpan: 2, alignment: 'center', bold: true }, {}],
            [{ text: 'A', alignment: 'center' }, { text: 'ITC availed as per audited Annual Financial Statement' }, g9cCell(t12.itc_avail_audited) ],
            [{ text: 'B', alignment: 'center' }, { text: 'ITC booked in earlier Financial Year claimed in current Financial Year' }, g9cCell(t12.itc_book_earl) ],
            [{ text: 'C', alignment: 'center' }, { text: 'ITC booked in current Financial Year to be claimed in next Financial Year' }, g9cCell(t12.itc_book_curr) ],
            [{ text: 'D', alignment: 'center' }, { text: 'ITC claimed as per Annual Return (GSTR-9)' }, g9cCell(t12.itc_claim) ],
            [{ text: 'E', alignment: 'center' }, { text: 'ITC claimed as per GSTR-9C' }, g9cCell(t12.itc_claim) ],
            [{ text: 'F', alignment: 'center' }, { text: 'Un-reconciled ITC (D - E)' }, g9cCell(t12.unrec_itc) ]
          ]
        }
      }, { text: '\n\n' });
    }

    // ─────────────────────────────────────────────────────
    // Provision: Table 13 (Reasons for ITC difference)
    // ─────────────────────────────────────────────────────
    pushReasonTable(content, 13, 'Reasons for ITC difference', t13, { pageBreakBefore: false });

    // ─────────────────────────────────────────────────────
    // Table 14 – ITC on expenses
    // ─────────────────────────────────────────────────────
    if (t14 && Array.isArray(t14.items)) {
      content.push({
        style: 'tableExample',
        table: {
          widths: ['10%','45%','15%','15%','15%'],
          body: [
            [{ text: '14', alignment: 'center', bold: true }, { text: 'Reconciliation of ITC on expenses', colSpan: 4, alignment: 'center', bold: true }, {}, {}, {}],
            [
              { text: 'Sl', bold: true, alignment: 'center' },
              { text: 'Particulars', bold: true, alignment: 'center' },
              { text: 'Value', bold: true, alignment: 'center' },
              { text: 'ITC Amount', bold: true, alignment: 'center' },
              { text: 'ITC Availed', bold: true, alignment: 'center' }
            ],
            ...t14.items.map((it, idx) => [
              g9cText(idx + 1, { alignment: 'center' }),
              g9cText(it?.desc || ''),
              g9cCell(it?.val),
              g9cCell(it?.itc_amt),
              g9cCell(it?.itc_avail)
            ]),
            [
              { text: 'Total eligible ITC', colSpan: 4, bold: true }, {}, {}, {},
              g9cCell(t14.tot_elig_itc?.itc_avail)
            ],
            [
              { text: 'ITC claimed', colSpan: 4, bold: true }, {}, {}, {},
              g9cCell(t14.itc_claim?.itc_avail)
            ],
            [
              { text: 'Un-reconciled ITC', colSpan: 4, bold: true }, {}, {}, {},
              g9cCell(t14.unrec_itc?.itc_avail)
            ]
          ]
        }
      }, { text: '\n\n' });
    }

    // ─────────────────────────────────────────────────────
    // Provision: Table 15 (Reasons for ITC reconciliation difference)
    // ─────────────────────────────────────────────────────
    pushReasonTable(content, 15, 'Reasons for ITC reconciliation difference', t15, { pageBreakBefore: false });

    // ─────────────────────────────────────────────────────
    // Table 16 – Tax payable on unreconciled ITC
    // ─────────────────────────────────────────────────────
    if (t16 && (t16.cgst !== undefined || t16.sgst !== undefined || t16.igst !== undefined)) {
      content.push({
        style: 'tableExample',
        table: {
          widths: ['10%','55%','35%'],
          body: [
            [{ text: '16', alignment: 'center', bold: true }, { text: 'Tax payable on unreconciled ITC', colSpan: 2, alignment: 'center', bold: true }, {}],
            [{ text: 'CGST',     alignment: 'center' }, { text: 'Central Tax' },      g9cCell(t16.cgst) ],
            [{ text: 'SGST',     alignment: 'center' }, { text: 'State / UT Tax' },   g9cCell(t16.sgst) ],
            [{ text: 'IGST',     alignment: 'center' }, { text: 'Integrated Tax' },   g9cCell(t16.igst) ],
            [{ text: 'Cess',     alignment: 'center' }, { text: 'Cess' },             g9cCell(t16.cess) ],
            [{ text: 'Interest', alignment: 'center' }, { text: 'Interest' },         g9cCell(t16.inter) ],
            [{ text: 'Penalty',  alignment: 'center' }, { text: 'Penalty' },          g9cCell(t16.pen) ]
          ]
        }
      }, { text: '\n\n' });
    }

    // ─────────────────────────────────────────────────────
    // Provision: Table 17 – Additional liability due to non-reconciliation
    // ─────────────────────────────────────────────────────
    pushTable17(content, t17, { pageBreakBefore: false });

    // Optional: show uploaded doc info if present (dcupdtls)
    const bsDocs = dcupdtls?.balance_sheet || [];
    const plDocs = dcupdtls?.profitloss || [];
    if (bsDocs.length || plDocs.length) {
      content.push({
        style: 'tableExample',
        table: {
          widths: ['30%', '70%'],
          body: [
            [{ text: 'Uploaded documents', colSpan: 2, alignment: 'center', bold: true }, {}],
            [{ text: 'Balance Sheet', bold: true }, { text: bsDocs.map(d => d.doc_nam).join(', ') || '-' }],
            [{ text: 'Profit & Loss', bold: true }, { text: plDocs.map(d => d.doc_nam).join(', ') || '-' }]
          ]
        }
      }, { text: '\n\n' });
    }

    // ─────────────────────────────────────────────────────
    // Create PDF
    // ─────────────────────────────────────────────────────

    const dd = {
      pageSize: 'A4',
      pageOrientation: 'landscape',
      pageMargins: [40, 60, 40, 60],
      watermark: {
        text: watermark,
        color: 'black',
        opacity: 0.3,
        bold: true,
        italics: false,
        fontSize: 221
      },
      content,
      styles: {
        header:  { fontSize: 18, bold: true, alignment: 'center' },
        header1: { fontSize: 15, bold: true, alignment: 'center' },
        subheader: { fontSize: 13, bold: true, margin: [15, 10, 60, 5] },
        subhead: { margin: [15, 15, 15, 15], bold: true },
        tableExample: { alignment: 'center' },
        tableDetails: { margin: [15, 5, 15, 15] },
        rule: { alignment: 'center' }
      }
    };

    await compileAndDownloadPdfViaPortal(dd, pdfname);

  } catch (err) {
    console.error('GSTR-9C PDF Generation Error:', err);
    alert('Error generating GSTR-9C PDF. Check console for details.');
    throw err;
  }
}

// ── 7. GSTR-9 Excel Download Engine ──────────────────────────

//  ReturnPilot v3.0
//  © 2026 KasyHQ. All Rights Reserved.







