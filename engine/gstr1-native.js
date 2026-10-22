// ═══════════════════════════════════════════════════════════════
//  ReturnPilot v4.2 — GSTR-1 NATIVE ENGINE
//  © 2026 KasyHQ. All Rights Reserved.
// ═══════════════════════════════════════════════════════════════

function disyearOf(p) {
    const m = parseInt(p.slice(0, 2), 10);
    const y = parseInt(p.slice(2), 10);
    return m >= 4 ? `${y}-${String(y + 1).slice(2)}` : `${y - 1}-${String(y).slice(2)}`;
}

import { formatFinancialYear, buildFolderDownloadPath } from './engine.js';


// Global queue per tab to ensure strictly sequential downloads without iframe contention
const gstr1TabQueues = new Map();

function enqueueGstr1Tab(tabId, fn) {
    const prev = gstr1TabQueues.get(tabId) || Promise.resolve();
    const next = prev.then(fn, fn);
    gstr1TabQueues.set(tabId, next);
    next.finally(() => {
        if (gstr1TabQueues.get(tabId) === next) {
            gstr1TabQueues.delete(tabId);
        }
    });
    return next;
}

export function handleGstr1NativePdf(msg, sender, sendResponse, deps) {
    let targetTabId = msg.tabId || (sender && sender.tab && sender.tab.id) || null;
    const period = msg.period || msg.rtnprd || '';
    const gstin = msg.gstin || '';

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
                // Ensure gstr1-inject.js is mounted on top tab
                await chrome.scripting.executeScript({
                    target: { tabId: targetTabId },
                    world: 'MAIN',
                    files: ['content/gstr1-inject.js']
                }).catch((err) => {
                    console.warn('[ReturnPilot GSTR-1] Script inject warning:', err.message);
                });

                const requestId = `g1_${period}_${Date.now()}`;

                // Dispatch capture inside page context
                const results = await chrome.scripting.executeScript({
                    target: { tabId: targetTabId },
                    world: 'MAIN',
                    args: [period, gstin, requestId],
                    func: (period, gstin, requestId) => {
                        return new Promise((resolve) => {
                            let settled = false;
                            const timeout = setTimeout(() => {
                                if (!settled) {
                                    settled = true;
                                    window.removeEventListener('message', handler);
                                    resolve({ success: false, error: 'GSTR-1 PDF generation timed out after 45s', period });
                                }
                            }, 45000);

                            const handler = (e) => {
                                if (!e.data || e.data.__gstr1 !== 'INJECT_RESULT' || e.data.requestId !== requestId) return;
                                if (!settled) {
                                    settled = true;
                                    clearTimeout(timeout);
                                    window.removeEventListener('message', handler);
                                    resolve(e.data);
                                }
                            };

                            window.addEventListener('message', handler);
                            window.postMessage({
                                __gstr1: 'INJECT_START',
                                requestId,
                                period,
                                meta: { period, gstin }
                            }, '*');
                        });
                    }
                });

                const r = results && results[0] && results[0].result;
                if (!r) throw new Error('No response from GSTR-1 inject script');
                return r;
            };

            const result = await enqueueGstr1Tab(targetTabId, executePdfCapture);

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
                const fy = disyearOf(period);
                const filename = buildFolderDownloadPath(effectiveGstin, 'GSTR1', period, result.filename, fy);

                if (deps && deps.DownloadRegistry) {
                    const finalObj = {
                        gstin: effectiveGstin,
                        returnType: 'GSTR1',
                        period: result.period || period,
                        filename: filename,
                        timestamp: Date.now()
                    };
                    deps.DownloadRegistry.set('ACTIVE_GSTR1', finalObj);
                    if (result.filename) deps.DownloadRegistry.set(result.filename, finalObj);
                }

                console.log(`[ReturnPilot GSTR-1] Official portal download initiated for period ${result.period || period} (GSTIN: ${effectiveGstin}) -> ${filename}`);

                return sendResponse({
                    success: true,
                    filename,
                    size: result.size,
                    period: result.period || period,
                    timeMs: result.timeMs,
                    officialDownload: true
                });
            }

            return sendResponse({ success: false, error: result?.error || 'GSTR-1 PDF download failed' });
        } catch (err) {
            console.error('[ReturnPilot GSTR-1] Error:', err.message);
            return sendResponse({ success: false, error: err.message });
        }
    })();

    return true; // async
}
