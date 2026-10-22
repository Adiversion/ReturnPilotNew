// ═══════════════════════════════════════════════════════════════
//  ReturnPilot v4.2 — GSTR-2B NATIVE PORTAL ENGINE (DIRECT & ROBUST)
//  © 2026 KasyHQ. All Rights Reserved.
// ═══════════════════════════════════════════════════════════════

function disyearOf(p) {
    const m = parseInt(p.slice(0, 2), 10);
    const y = parseInt(p.slice(2), 10);
    return m >= 4 ? `${y}-${String(y + 1).slice(2)}` : `${y - 1}-${String(y).slice(2)}`;
}

import { buildFolderDownloadPath } from './engine.js';
import { runGstr2bFrame } from './gstr2b-frame-runner.js';

function buildExcelFilename(period, gstin) {
    const d = new Date();
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${period}_${gstin || 'GSTIN'}_GSTR2B_${dd}${mm}${yyyy}.xlsx`;
}

function buildPdfFilename(period, gstin) {
    const d = new Date();
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `GSTR2B_${gstin || 'GSTIN'}_${period}_${dd}${mm}${yyyy}.pdf`;
}

async function propagateGstr2bCookies() {
    try {
        if (!chrome.cookies) return false;
        const allCookies = await chrome.cookies.getAll({ domain: 'gst.gov.in' });
        const targetUrl = 'https://gstr2b.gst.gov.in';
        for (const c of allCookies) {
            if (c.name.startsWith('TS')) continue;
            await chrome.cookies.set({
                url: targetUrl,
                name: c.name,
                value: c.value,
                path: c.path || '/',
                secure: c.secure,
                httpOnly: c.httpOnly,
                sameSite: c.sameSite,
                expirationDate: c.expirationDate
            }).catch(() => {});
        }
        return true;
    } catch (_) {
        return false;
    }
}

async function executeGstr2bCapture(tabId, period, gstin, captureType, timeoutMs = 45000) {
    await propagateGstr2bCookies();
    const finyr = disyearOf(period);

    const execResults = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        args: [period, gstin, finyr, captureType, timeoutMs],
        func: runGstr2bFrame
    });

    return (execResults && execResults[0] && execResults[0].result) || { success: false, error: 'Execution failed' };
}

// ── Handle GSTR-2B Excel (Strictly Excel Only) ─────────────────────
export function handleGstr2BExcel(msg, sender, sendResponse, deps) {
    let targetTabId = sender.tab ? sender.tab.id : msg.tabId;
    const period = msg.period || (msg.data && msg.data.period);
    const gstin = msg.gstin || (msg.data && msg.data.gstin) || '';

    (async () => {
        try {
            if (!targetTabId) {
                const tabs = await new Promise(r => chrome.tabs.query({ active: true, currentWindow: true }, r));
                if (tabs && tabs[0]) targetTabId = tabs[0].id;
            }
            if (!targetTabId || !period) {
                return sendResponse({ success: false, error: 'Missing tab or period' });
            }

            const r = await executeGstr2bCapture(targetTabId, period, gstin, 'EXCEL', 45000);
            if (r && r.success) {
                const effectiveGstin = gstin || r.gstin || (r.filename && r.filename.match(/([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1})/i)?.[1]) || 'GSTIN';
                const captured = (r.filename || '').trim();
                const isFullOfficialName = /^\d{6}_[0-9A-Z]{15}_GSTR2B_\d{8}\.(xlsx|xls|pdf)$/i.test(captured);
                const baseFilename = isFullOfficialName ? captured : buildExcelFilename(period, effectiveGstin);
                const filename = buildFolderDownloadPath(effectiveGstin, 'GSTR2B', period, baseFilename, disyearOf(period));

                console.log(`[ReturnPilot GSTR-2B] Official portal Excel download initiated for period ${period} (GSTIN: ${effectiveGstin}) -> ${filename}`);

                return sendResponse({ success: true, filename, period, captureType: 'EXCEL', officialDownload: true, downloadStage: r.downloadStage });
            }
            return sendResponse({ success: false, error: r?.error || 'GSTR-2B Excel capture failed' });
        } catch (e) {
            return sendResponse({ success: false, error: e.message });
        }
    })();
    return true;
}

// ── Handle GSTR-2B Portal Summary PDF (Strictly PDF Only) ──────────
export function handleGstr2BPortalPdf(msg, sender, sendResponse, deps) {
    let targetTabId = sender.tab ? sender.tab.id : msg.tabId;
    const period = msg.period || (msg.data && msg.data.period);
    const gstin = msg.gstin || (msg.data && msg.data.gstin) || '';

    (async () => {
        try {
            if (!targetTabId) {
                const tabs = await new Promise(r => chrome.tabs.query({ active: true, currentWindow: true }, r));
                if (tabs && tabs[0]) targetTabId = tabs[0].id;
            }
            if (!targetTabId || !period) {
                return sendResponse({ success: false, error: 'Missing tab or period' });
            }

            const r = await executeGstr2bCapture(targetTabId, period, gstin, 'PDF', 45000);
            if (r && r.success) {
                const effectiveGstin = gstin || r.gstin || (r.filename && r.filename.match(/([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1})/i)?.[1]) || 'GSTIN';
                const captured = (r.filename || '').trim();
                const isFullOfficialName = /^\d{6}_[0-9A-Z]{15}_GSTR2B_\d{8}\.(xlsx|xls|pdf)$/i.test(captured);
                const baseFilename = isFullOfficialName ? captured : buildPdfFilename(period, effectiveGstin);
                const filename = buildFolderDownloadPath(effectiveGstin, 'GSTR2B', period, baseFilename, disyearOf(period));

                console.log(`[ReturnPilot GSTR-2B] Official portal PDF download initiated for period ${period} (GSTIN: ${effectiveGstin}) -> ${filename}`);

                return sendResponse({ success: true, filename, period, captureType: 'PDF', officialDownload: true, downloadStage: r.downloadStage });
            }
            return sendResponse({ success: false, error: r?.error || 'GSTR-2B PDF capture failed' });
        } catch (e) {
            return sendResponse({ success: false, error: e.message });
        }
    })();
    return true;
}

export const handleGstr2B = handleGstr2BPortalPdf;
