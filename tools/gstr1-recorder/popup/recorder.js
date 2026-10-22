'use strict';
// ReturnPilot GSTR-1 Recorder — popup logic.
// Messages the TOP frame's content script on the active gst.gov.in tab and
// downloads the exported recording as a .json file via chrome.downloads.

function activeGstTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const t = tabs && tabs[0];
      if (!t || !t.url || !/^https:\/\/[\w.-]*gst\.gov\.in/.test(t.url)) return resolve(null);
      resolve(t);
    });
  });
}

function sendToTab(action, extra) {
  return activeGstTab().then((tab) => {
    if (!tab) {
      throw new Error('Open a gst.gov.in page first (reload it if it was open before installing).');
    }
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tab.id, Object.assign({ source: 'RP_RECORDER_POPUP', action }, extra || {}), { frameId: 0 }, (resp) => {
        const err = chrome.runtime.lastError;
        if (err || !resp) {
          return reject(new Error(err ? err.message : 'No response — reload the GST portal tab.'));
        }
        resolve(resp);
      });
    });
  });
}

function setStatus(msg, isErr) {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className = 'status ' + (isErr ? 'err' : 'ok');
}

function getScenario() {
  const sel = document.querySelector('input[name="scenario"]:checked');
  return sel ? sel.value : 'other';
}

function refreshStatus() {
  sendToTab('status').then((r) => {
    document.getElementById('count').textContent =
      'Snapshots: ' + r.count + ' · Events: ' + r.eventCount + ' · Scenario: ' + (r.scenario || 'other');
  }).catch(() => {
    document.getElementById('count').textContent = 'Recorder not connected — open & reload a gst.gov.in tab.';
  });
}

// Highlight the selected scenario chip.
document.querySelectorAll('input[name="scenario"]').forEach((inp) => {
  inp.addEventListener('change', () => {
    document.querySelectorAll('.radio-row label.opt').forEach((l) => l.classList.remove('checked'));
    inp.closest('label.opt').classList.add('checked');
  });
});

document.getElementById('btnSnapshot').addEventListener('click', async () => {
  try {
    const note = document.getElementById('note').value.trim();
    await sendToTab('set-scenario', { scenario: getScenario() });
    const r = await sendToTab('snapshot', { note: note });
    document.getElementById('note').value = '';
    await setStatus('✓ Captured #' + r.count + ' · ' + new Date(r.at).toLocaleTimeString());
  } catch (e) {
    await setStatus('✗ ' + e.message, true);
  }
  refreshStatus();
});

document.getElementById('btnExport').addEventListener('click', async () => {
  try {
    await sendToTab('set-scenario', { scenario: getScenario() });
    const r = await sendToTab('export');
    const log = r.log;
    const blob = new Blob([JSON.stringify(log, null, 2)], { type: 'application/json' });
    const fr = new FileReader();
    fr.onload = () => {
      const d = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const stamp = d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
      chrome.downloads.download({
        url: fr.result,
        filename: 'gstr1-recorder-' + (log.meta.scenario || 'other') + '-' + stamp + '.json',
        saveAs: false
      });
    };
    fr.readAsDataURL(blob);
    await setStatus('⬇ Downloaded — send the .json file back to implement the flow.');
  } catch (e) {
    await setStatus('✗ ' + e.message, true);
  }
});

document.getElementById('btnClear').addEventListener('click', async () => {
  try {
    await sendToTab('clear');
    await setStatus('Cleared');
  } catch (e) {
    await setStatus('✗ ' + e.message, true);
  }
  refreshStatus();
});

refreshStatus();
