// Serialized by chrome.scripting.executeScript into the portal MAIN world.
// Keep this function self-contained: imported helpers are not available there.
export function runGstr2bFrame(period, gstin, finyr, captureType, timeoutMs) {
  return new Promise((resolve) => {
    const portalOrigin = 'https://gstr2b.gst.gov.in';
    const requestId = `gstr2b_${crypto.randomUUID()}`;
    let settled = false;
    let started = false;
    let timer;
    let iframe;
    let effectiveGstin = gstin;

    function finish(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      try { if (iframe) iframe.remove(); } catch (error) {
        result = { success: false, requestId, error: `GSTR-2B frame cleanup failed: ${error.message}` };
      }
      resolve(result);
    }

    function onMessage(event) {
      // Origin alone is insufficient: another GSTR-2B frame has the same origin.
      if (settled || !iframe || event.source !== iframe.contentWindow || event.origin !== portalOrigin) return;
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      if (data.__gst2b === 'INJECT_READY') {
        if (started) return;
        started = true;
        iframe.contentWindow.postMessage({
          __gst2b: 'INJECT_START', requestId, period, captureType, meta
        }, portalOrigin);
      } else if (started && data.__gst2b === 'INJECT_RESULT' && data.requestId === requestId) {
        // Never accept missing correlation IDs or silently relabel mismatched output.
        if (data.success && (data.period !== period || data.gstin !== effectiveGstin || data.captureType !== captureType)) {
          finish({ success: false, requestId, error: 'GSTR-2B result identity mismatch' });
          return;
        }
        finish(data);
      }
    }

    let meta;
    try {
      let lgnm = localStorage.getItem('lglname') || localStorage.getItem('lgnm') || '';
      let tradeName = localStorage.getItem('trdnm') || localStorage.getItem('tradeName') || '';
      const uPref = localStorage.getItem('uPref') || 'M';
      const stored = localStorage.getItem('userdetails');
      if (stored) {
        try {
          const user = JSON.parse(stored);
          lgnm = lgnm || user.lgnm || user.bname || user.tradeName || '';
          tradeName = tradeName || user.trdnm || user.tradeName || '';
          if (!effectiveGstin) effectiveGstin = user.gstin || '';
        } catch (_) {}
      }
      meta = {
        rtn_prd: period, period, gstin: effectiveGstin, finyr, lgnm, tradeName, uPref,
        requestId, captureType, parentOrigin: location.origin
      };
      iframe = document.createElement('iframe');
      iframe.name = `__gst2b_${period}__meta=${encodeURIComponent(JSON.stringify(meta))}`;
      iframe.src = `${portalOrigin}/gstr2b/auth/gstr2b/summary`;
      iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1280px;height:900px;opacity:0;border:0;pointer-events:none;z-index:-1;visibility:hidden;';
      window.addEventListener('message', onMessage);
      timer = setTimeout(() => finish({ success: false, requestId, error: `${captureType} capture timeout (${timeoutMs / 1000}s)` }), timeoutMs);
      document.body.appendChild(iframe);
    } catch (error) {
      finish({ success: false, requestId, error: error.message });
    }
  });
}
