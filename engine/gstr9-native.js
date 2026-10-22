// ═══════════════════════════════════════════════════════════════
//  ReturnPilot — GSTR-9 NATIVE ENGINE
//  © 2026 KasyHQ. All Rights Reserved.
// ═══════════════════════════════════════════════════════════════

import { buildFolderDownloadPath } from './engine.js';

// Global queue per tab to ensure strictly sequential downloads without iframe contention
const gstr9TabQueues = new Map();

function enqueueGstr9Tab(tabId, fn) {
    const prev = gstr9TabQueues.get(tabId) || Promise.resolve();
    const next = prev.then(fn, fn);
    gstr9TabQueues.set(tabId, next);
    next.finally(() => {
        if (gstr9TabQueues.get(tabId) === next) {
            gstr9TabQueues.delete(tabId);
        }
    });
    return next;
}

export function handleGstr9NativePdf(msg, sender, sendResponse, deps) {
    let targetTabId = msg.tabId || (sender && sender.tab && sender.tab.id) || null;
    const period = msg.period || msg.rtnprd || msg.finYr || '';
    const gstin = msg.gstin || '';
    const finYr = msg.finYr || '';
    const docType = msg.docType || 'GSTR9';

    (async () => {
        try {
            if (!targetTabId) {
                const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
                if (tabs && tabs[0]) targetTabId = tabs[0].id;
            }
            if (!targetTabId || !period) {
                return sendResponse({ success: false, error: 'Missing active tab or return period' });
            }

            const executePdfCapture = async () => {
                // Ensure gstr9-inject.js is mounted on top tab
                await chrome.scripting.executeScript({
                    target: { tabId: targetTabId },
                    world: 'MAIN',
                    files: ['content/gstr9-inject.js']
                }).catch((err) => {
                    console.warn('[ReturnPilot GSTR-9] Script inject warning:', err.message);
                });

                const requestId = `g9_${period}_${Date.now()}`;

                // Dispatch capture inside page context
                const results = await chrome.scripting.executeScript({
                    target: { tabId: targetTabId },
                    world: 'MAIN',
                    args: [period, gstin, requestId, finYr, docType],
                    func: (period, gstin, requestId, finYr, docType) => {
                        return new Promise((resolve) => {
                            let settled = false;
                            const timeout = setTimeout(() => {
                                if (!settled) {
                                    settled = true;
                                    window.removeEventListener('message', handler);
                                    resolve({ success: false, error: 'GSTR-9 PDF generation timed out after 45s', period });
                                }
                            }, 45000);

                            const handler = (e) => {
                                if (!e.data || e.data.__gstr9 !== 'INJECT_RESULT' || e.data.requestId !== requestId) return;
                                if (!settled) {
                                    settled = true;
                                    clearTimeout(timeout);
                                    window.removeEventListener('message', handler);
                                    resolve(e.data);
                                }
                            };

                            window.addEventListener('message', handler);
                            window.postMessage({
                                __gstr9: 'INJECT_START',
                                requestId,
                                period,
                                meta: { period, gstin, finYr, docType }
                            }, '*');
                        });
                    }
                });

                const r = results && results[0] && results[0].result;
                if (!r) throw new Error('No response from GSTR-9 inject script');
                return r;
            };

            const result = await enqueueGstr9Tab(targetTabId, executePdfCapture);

            if (result && result.skipped) {
                return sendResponse({
                    success: false,
                    skipped: true,
                    period: result.period || period,
                    error: result.error || 'Not filed'
                });
            }

            if (result && result.success) {
                const effectiveGstin = gstin || (result.filename ? result.filename.match(/([0-9A-Z]{15})/)?.[1] : 'GSTIN') || 'GSTIN';
                let fy = finYr;
                if (!fy && /^\d{6}$/.test(period)) {
                    const endYr = parseInt(period.substring(2, 6), 10);
                    fy = `${endYr - 1}-${String(endYr % 100).padStart(2, '0')}`;
                }
                const filename = buildFolderDownloadPath(effectiveGstin, 'GSTR9', period, result.filename, fy);

                if (deps && deps.DownloadRegistry) {
                    const finalObj = {
                        gstin: effectiveGstin,
                        returnType: 'GSTR9',
                        period: result.period || period,
                        filename: filename,
                        timestamp: Date.now()
                    };
                    deps.DownloadRegistry.set('ACTIVE_GSTR9', finalObj);
                    if (result.filename) deps.DownloadRegistry.set(result.filename, finalObj);
                }

                console.log(`[ReturnPilot GSTR-9] Official portal download initiated for period ${result.period || period} (GSTIN: ${effectiveGstin}) -> ${filename}`);

                return sendResponse({
                    success: true,
                    filename,
                    period: result.period || period,
                    timeMs: result.timeMs,
                    officialDownload: true
                });
            }

            return sendResponse({ success: false, error: result?.error || 'GSTR-9 PDF download failed' });
        } catch (err) {
            console.error('[ReturnPilot GSTR-9] Error:', err.message);
            return sendResponse({ success: false, error: err.message });
        }
    })();

    return true; // async
}
