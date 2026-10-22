'use strict';

console.log('[2B Bridge] Loaded on:', location.href, 'isTop:', window === window.top);

// Helper function from warmer.js / background.js
function disyearOf(p) {
  const m = parseInt(p.slice(0, 2), 10);
  const y = parseInt(p.slice(2), 10);
  return m >= 4 ? `${y}-${String(y + 1).slice(2)}` : `${y - 1}-${String(y).slice(2)}`;
}

try {
  const nameMatch = (window.name || '').match(/__gst2b_(\d+)__meta=(.+)$/);
  if (nameMatch) {
    const meta = JSON.parse(decodeURIComponent(nameMatch[2]));
    const period = meta.rtn_prd || '';
    const gstin = meta.gstin || '';
    const lgnm = meta.lgnm || meta.tradeName || '';
    const uPref = meta.uPref || 'M';
    const finyr = period && period.length === 6 ? disyearOf(period) : '';

    const stateMap = {
      // Return Period Keys
      rtn_prd: period,
      ret_period: period,
      rtnprd: period,
      returnPeriod: period,
      selectedPeriod: period,
      period: period,

      // Financial Year Keys
      finyr: finyr,
      finYear: finyr,
      fy: finyr,
      FY: finyr,
      fyear: finyr,
      financial_year: finyr,
      financialYear: finyr,
      selectedFy: finyr,
      selectedYear: finyr,

      // Form & GSTIN Keys
      form: 'GSTR2B',
      gstin: gstin,
      GSTIN: gstin,
      lglname: lgnm,
      tradeName: lgnm,
      legal_name: lgnm,
      lgnm: lgnm,
      uPref: uPref,
      appStatus: 'Active',
      status: 'Active'
    };

    Object.entries(stateMap).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') {
        try {
          localStorage.setItem(k, v);
          sessionStorage.setItem(k, v);
        } catch (_) {}
      }
    });

    console.log(`[2B Bridge] Seeded state -> Period: ${period} | FY: ${finyr} | GSTIN: ${gstin}`);
  }
} catch (e) {
  console.warn('[2B Bridge] Pre-population failed:', e.message);
}

// Load the packaged identity guard before the portal integration script.
function injectPackagedScript(path, onLoad) {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL(path);
  script.onload = () => { script.remove(); if (onLoad) onLoad(); };
  script.onerror = () => { script.remove(); console.error('[2B Bridge] Packaged script failed to load:', path); };
  (document.head || document.documentElement).appendChild(script);
}
injectPackagedScript('content/return-identity.js', () => injectPackagedScript('content/2b-inject.js'));

// Relay messages to parent window
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const d = event.data;
  if (!d || !d.__gst2b) return;

  if (d.__gst2b === 'INJECT_READY' || d.__gst2b === 'INJECT_RESULT') {
    try {
      if (window !== window.top && window.parent) {
        window.parent.postMessage(d, '*');
      }
    } catch (_) {}
  }
});