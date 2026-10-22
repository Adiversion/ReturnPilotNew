// ═══════════════════════════════════════════════════════════════
//  ReturnPilot v4.2 — GSTR-1A PORTAL PDF ENGINE (DIRECT & ROBUST)
//  © 2026 KasyHQ. All Rights Reserved.
// ═══════════════════════════════════════════════════════════════

import { buildFolderDownloadPath } from './engine.js';

async function propagateGstr1aCookies() {
    try {
        if (!chrome.cookies) return false;
        const allCookies = await chrome.cookies.getAll({ domain: 'gst.gov.in' });
        const targetUrl = 'https://gstr1a.gst.gov.in';
        for (const c of allCookies) {
            if (c.name.startsWith('TS')) continue;
            const cookieDetails = {
                url: targetUrl,
                name: c.name,
                value: c.value,
                path: c.path || '/',
                secure: c.secure,
                httpOnly: c.httpOnly,
                expirationDate: c.expirationDate
            };
            if (c.sameSite === 'no_restriction' || c.sameSite === 'lax' || c.sameSite === 'strict') {
                cookieDetails.sameSite = c.sameSite;
            }
            await chrome.cookies.set(cookieDetails).catch(() => {});
        }
        return true;
    } catch (_) {
        return false;
    }
}

async function executeGstr1aCapture(tabId, period, gstin, pdfType, timeoutMs = 45000) {
    await propagateGstr1aCookies();

    const execResults = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        args: [period, gstin, pdfType, timeoutMs],
        func: async (period, gstin, pdfType, timeoutMs) => {
            return new Promise(async (resolve) => {
                let injectReady = false;
                let captureResolve = null;

                const onMsg = (event) => {
                    const d = event.data;
                    if (!d || typeof d !== 'object') return;
                    if (d.__gst === 'INJECT_READY') {
                        injectReady = true;
                    }
                    if (d.__gst === 'INJECT_RESULT') {
                        if (captureResolve) {
                            captureResolve(d);
                            captureResolve = null;
                        }
                    }
                };
                window.addEventListener('message', onMsg);

                // Safe fallback for live GSTIN from tab state
                const liveGstin = gstin || sessionStorage.getItem('gstin') || localStorage.getItem('gstin') || (window.angular && window.angular.element(document.body).scope()?.main_page_gstin) || '';

                let isWarm = false;
                let iframe = document.getElementById('rp1a_warm_iframe');

                if (iframe && iframe.contentWindow) {
                    const pingPromise = new Promise((res) => {
                        const pingTimer = setTimeout(() => res(false), 200);
                        const pingHandler = (ev) => {
                            if (ev.data?.__gst === 'INJECT_PONG') {
                                clearTimeout(pingTimer);
                                window.removeEventListener('message', pingHandler);
                                res(true);
                            }
                        };
                        window.addEventListener('message', pingHandler);
                        try {
                            iframe.contentWindow.postMessage({ __gst: 'INJECT_PING' }, '*');
                        } catch (_) {
                            res(false);
                        }
                    });
                    isWarm = await pingPromise;
                    if (isWarm) injectReady = true;
                }

                if (!isWarm) {
                    if (iframe) {
                        try { iframe.remove(); } catch (_) {}
                    }
                    iframe = document.createElement('iframe');
                    iframe.id = 'rp1a_warm_iframe';
                    iframe.src = 'https://gstr1a.gst.gov.in/r1Aweb/auth/gstr1a#/auth/gstr1a/gstr1sum';
                    iframe.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:800px;height:600px;border:0;visibility:hidden;';
                    document.body.appendChild(iframe);
                }

                const metaPromise = (async () => {
                    const [fdRes, roleRes] = await Promise.all([
                        fetch(`https://return.gst.gov.in/returns/auth/api/formdetails?rtn_prd=${encodeURIComponent(period)}&rtn_typ=GSTR1A`, { credentials: 'include' }).then(r => r.json()).catch(() => null),
                        fetch(`https://return.gst.gov.in/returns/auth/api/rolestatus?rtn_prd=${encodeURIComponent(period)}`, { credentials: 'include' }).then(r => r.json()).catch(() => null)
                    ]);

                    const d = fdRes && fdRes.data;
                    const rd = roleRes && roleRes.data;

                    if (d && d.status && d.status !== 'FIL') {
                        return { skipped: true, error: `Period ${period} is not filed (${d.status})` };
                    }

                    const m = parseInt(period.substring(0, 2), 10);
                    const y = parseInt(period.substring(2), 10);
                    const startYr = m >= 4 ? y : y - 1;
                    const finyr = d?.fy || (startYr + '-' + String(startYr + 1).slice(2));

                    return {
                        gstin: d?.gstin || liveGstin,
                        fy: finyr,
                        period: d?.fp || period,
                        lgnm: d?.ln || d?.bn || '',
                        trdnm: d?.tn || '',
                        arn: d?.arn || '',
                        fil_dt: d?.fil_dt || '',
                        status: d?.status || 'FIL',
                        uPref: rd?.userPref || rd?.data?.userPref || 'M',
                        cnf_status: d?.cnfStatus || '',
                        isnil: 'N'
                    };
                })();

                const meta = await metaPromise;

                if (meta && meta.skipped) {
                    window.removeEventListener('message', onMsg);
                    return resolve({ success: false, skipped: true, error: meta.error });
                }

                // Wait for INJECT_READY if newly created
                if (!isWarm && !injectReady) {
                    const waitReadyStart = Date.now();
                    while (!injectReady && (Date.now() - waitReadyStart < 15000)) {
                        await new Promise(r => setTimeout(r, 15));
                    }
                }

                const requestId = `req_${Date.now()}_${pdfType}`;
                const resultPromise = new Promise((res) => {
                    captureResolve = res;
                    setTimeout(() => {
                        if (captureResolve) {
                            captureResolve = null;
                            try {
                                const fr = document.getElementById('rp1a_warm_iframe');
                                if (fr) fr.remove();
                            } catch (_) {}
                            res({ success: false, error: `GSTR-1A ${pdfType} capture timeout (${timeoutMs / 1000}s)` });
                        }
                    }, timeoutMs);
                });

                iframe.contentWindow.postMessage({
                    __gst: 'INJECT_START',
                    requestId,
                    period,
                    pdfType: pdfType || 'STANDALONE',
                    meta
                }, '*');

                const r = await resultPromise;
                window.removeEventListener('message', onMsg);
                if (!r || !r.success) {
                    try {
                        const fr = document.getElementById('rp1a_warm_iframe');
                        if (fr) fr.remove();
                    } catch (_) {}
                }
                resolve(r);
            });
        }
    });

    return (execResults && execResults[0] && execResults[0].result) || { success: false, error: 'Execution failed' };
}

export function handleGstr1APortalPdf(msg, sender, sendResponse, deps) {
    const period  = msg.period || msg.rtnprd || '062026';
    const gstin   = msg.gstin  || '';
    const pdfType = msg.pdfType || 'STANDALONE';
    let targetTabId = msg.tabId || (sender && sender.tab && sender.tab.id) || null;

    (async () => {
        try {
            if (!targetTabId) {
                const tabs = await new Promise(r => chrome.tabs.query({ active: true, currentWindow: true }, r));
                if (tabs && tabs[0]) targetTabId = tabs[0].id;
            }

            if (!targetTabId) {
                return sendResponse({
                    success: false,
                    error: 'No active tab found. Please open the GST portal (gst.gov.in) first.'
                });
            }

            const r = await executeGstr1aCapture(targetTabId, period, gstin, pdfType, 45000);
            if (r && r.skipped) {
                return sendResponse({
                    success: false,
                    skipped: true,
                    period,
                    error: r.error || 'Not filed'
                });
            }

            if (r && r.success) {
                const effectiveGstin = (gstin || (r.filename && r.filename.match(/([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1})/i)?.[1]) || 'GSTIN').toUpperCase();
                const fallbackFn = pdfType === 'CONSOLIDATED' ? `GSTR1and1A_${effectiveGstin}_${period}.pdf` : `GSTR1A_${effectiveGstin}_${period}.pdf`;
                const filename = buildFolderDownloadPath(effectiveGstin, 'GSTR1A', period, r.filename || fallbackFn);

                if (deps && deps.DownloadRegistry) {
                    const finalObj = {
                        gstin: effectiveGstin,
                        returnType: 'GSTR1A',
                        period: period,
                        filename: filename,
                        timestamp: Date.now()
                    };
                    deps.DownloadRegistry.set('ACTIVE_GSTR1A', finalObj);
                    if (r.filename) deps.DownloadRegistry.set(r.filename, finalObj);
                }

                console.log(`[ReturnPilot GSTR-1A] Official portal download initiated for period ${period} (GSTIN: ${effectiveGstin}) -> ${filename}`);

                return sendResponse({
                    success: true,
                    period,
                    filename,
                    pdfType,
                    officialDownload: true
                });
            }

            return sendResponse({
                success: false,
                error: r?.error || 'GSTR-1A PDF capture failed'
            });
        } catch (err) {
            console.error('[ReturnPilot GSTR1A-PDF] Failed:', err.message);
            return sendResponse({ success: false, error: err.message });
        }
    })();

    return true;
}

