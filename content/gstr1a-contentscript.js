'use strict';

console.log('[Bridge] Loaded on:', location.href, 'isTop:', window === window.top);

// Inject MAIN-world script
const script = document.createElement('script');
script.src = chrome.runtime.getURL('content/gstr1a-inject.js');
script.onload = () => script.remove();
(document.head || document.documentElement).appendChild(script);

// Relay inject messages to parent window (cross-origin postMessage)
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const d = event.data;
  if (!d || !d.__gst) return;

  if (d.__gst === 'INJECT_READY' || d.__gst === 'INJECT_RESULT' || d.__gst === 'INJECT_PONG') {
    try {
      if (window !== window.top && window.parent) {
        window.parent.postMessage(d, '*');
      }
    } catch (_) {}
  }
});