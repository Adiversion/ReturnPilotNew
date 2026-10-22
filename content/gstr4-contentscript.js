// ═══════════════════════════════════════════════════════════════
//  ReturnPilot — GSTR-4 Annual Content Script
//  Runs on: https://fogstr4.gst.gov.in/*
//  © 2026 KasyHQ. All Rights Reserved.
// ═══════════════════════════════════════════════════════════════

'use strict';

console.log('[ReturnPilot GSTR-4] Content script loaded on', window.location.href);

// ── Session seeding ──────────────────────────────────────────────
// When the background service worker navigates to this page as part
// of cookie propagation after login, reaching document_idle means
// the session cookie has been set on fogstr4.gst.gov.in.
// Notify the background so it can track propagation completion.
chrome.runtime.sendMessage({
    request: 'gstr4-session-seeded',
    url: window.location.href
}, () => {
    if (chrome.runtime.lastError) {
        // Background may not be listening for this yet — safe to ignore.
    }
});

// ── Extension ↔ Page message bridge ─────────────────────────────
// Forwards messages from the extension (popup / background) into
// the GSTR-4 page context and relays responses back.
// Mirrors the pattern used in 2b-contentscript.js.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.source !== 'RETURNPILOT_GSTR4_REQUEST') return;

    const requestId = `gstr4_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const responseHandler = (event) => {
        if (event.source !== window) return;
        if (!event.data || event.data.source !== 'RETURNPILOT_GSTR4_RESPONSE') return;
        if (event.data.requestId !== requestId) return;

        clearTimeout(responseTimeout);
        window.removeEventListener('message', responseHandler);
        sendResponse(event.data.result);
    };

    var responseTimeout = setTimeout(function() {
        window.removeEventListener('message', responseHandler);
    }, 30000);

    window.addEventListener('message', responseHandler);

    window.postMessage({
        source: 'RETURNPILOT_GSTR4',
        action: msg.action,
        payload: msg.payload,
        requestId
    }, '*');

    return true; // keep sendResponse channel open
});
