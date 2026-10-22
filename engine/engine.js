/**
 * ReturnPilot Engine Core Utilities
 * Centralized formatting and download path routing for all returns
 */

export function formatFinancialYear(period, fy) {
    // 1. If period is a valid 6-digit MMYYYY string, ALWAYS calculate FY strictly from period (month-dependent)
    const pStr = String(period || '').replace(/\D/g, '');
    if (pStr.length === 6) {
        const mm = parseInt(pStr.substring(0, 2), 10);
        const yyyy = parseInt(pStr.substring(2, 6), 10);
        if (mm >= 1 && mm <= 12 && yyyy > 2000) {
            if (mm >= 4) {
                const nextY = (yyyy + 1) % 100;
                return `${yyyy}-${String(nextY).padStart(2, '0')}`;
            } else {
                const prevY = yyyy - 1;
                const currY = yyyy % 100;
                return `${prevY}-${String(currY).padStart(2, '0')}`;
            }
        }
    }

    // 2. Fallback to provided fy string if period is unavailable or non-6-digit
    if (typeof fy === 'string' && fy.trim()) {
        const f = fy.trim();
        if (/^\d{4}-\d{2,4}$/.test(f)) {
            const [y1, y2] = f.split('-');
            const shortY2 = y2.length === 4 ? y2.slice(-2) : y2;
            return `${y1}-${shortY2}`;
        }
        if (/^\d{4}$/.test(f)) {
            const yr = parseInt(f, 10);
            return `${yr - 1}-${String(yr % 100).padStart(2, '0')}`;
        }
    }

    return 'UNKNOWN_FY';
}

export function buildFolderDownloadPath(gstin, returnType, period, baseFilename, fy) {
    let cleanGstin = String(gstin || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    let cleanType = String(returnType || '').replace(/[^a-zA-Z0-9_-]/g, '').toUpperCase();
    let cleanPeriod = String(period || '').replace(/[^a-zA-Z0-9_-]/g, '');
    const cleanFile = String(baseFilename || 'download.dat').split(/[\/\\]/).pop().split('?')[0].split('#')[0].replace(/[\\/:*?"<>|]/g, '_');

    if (!cleanGstin || cleanGstin === 'UNKNOWN_GSTIN' || cleanGstin === 'GSTIN') {
        const gMatch = cleanFile.match(/([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1})/i);
        if (gMatch) cleanGstin = gMatch[1].toUpperCase();
    }

    if (!cleanPeriod || cleanPeriod === 'UNKNOWN_PERIOD') {
        const pMatch = cleanFile.match(/(\b|_)(0[1-9]|1[0-2])(20\d{2})(\b|_|\.)/);
        if (pMatch) cleanPeriod = `${pMatch[2]}${pMatch[3]}`;
    }

    // Normalize return type:
    // ALL GSTR-1A returns (standalone or consolidated) MUST go into 'GSTR1A' folder!
    if (cleanType.includes('1A') || cleanType === 'R1A' || /GSTR1A|GSTR-1A|R1A|GSTR1and1A/i.test(cleanFile)) {
        cleanType = 'GSTR1A';
    } else if (cleanType.includes('IMS') || /IMS/i.test(cleanFile)) {
        cleanType = 'IMS';
    } else if (!cleanType || cleanType === 'RETURNS') {
        if (/R2A|GSTR2A|GSTR-2A/i.test(cleanFile)) cleanType = 'GSTR2A';
        else if (/R2B|GSTR2B|GSTR-2B/i.test(cleanFile)) cleanType = 'GSTR2B';
        else if (/R3B|GSTR3B|GSTR-3B/i.test(cleanFile)) cleanType = 'GSTR3B';
        else if (/R1|GSTR1|GSTR-1/i.test(cleanFile)) cleanType = 'GSTR1';
        else if (/R4A|GSTR4A|GSTR-4A/i.test(cleanFile)) cleanType = 'GSTR4A';
        else if (/R4|GSTR4|GSTR-4/i.test(cleanFile)) cleanType = 'GSTR4';
        else if (/R9C|GSTR9C|GSTR-9C/i.test(cleanFile)) cleanType = 'GSTR9C';
        else if (/R9|GSTR9|GSTR-9/i.test(cleanFile)) cleanType = 'GSTR9';
        else cleanType = 'RETURNS';
    } else {
        if (cleanType === 'R2A') cleanType = 'GSTR2A';
        if (cleanType === 'R2B') cleanType = 'GSTR2B';
        if (cleanType === 'R3B') cleanType = 'GSTR3B';
        if (cleanType === 'R1') cleanType = 'GSTR1';
        if (cleanType === 'R4A') cleanType = 'GSTR4A';
        if (cleanType === 'R4') cleanType = 'GSTR4';
        if (cleanType === 'R9') cleanType = 'GSTR9';
        if (cleanType === 'R9C' || cleanType === 'G9C9C') cleanType = 'GSTR9C';
    }

    if (!cleanGstin || cleanGstin === 'GSTIN') cleanGstin = 'UNKNOWN_GSTIN';
    const cleanFy = formatFinancialYear(cleanPeriod, fy);

    let finalFile = cleanFile;
    if (cleanType.includes('PDF') || finalFile.toLowerCase().includes('pdf') || (baseFilename && baseFilename.toLowerCase().endsWith('.pdf'))) {
        if (!finalFile.toLowerCase().endsWith('.pdf')) finalFile += '.pdf';
    }

    // Organized subfolder path per client (<GSTIN>/<FY>/<ReturnType>/<Native_Filename>)
    // Helps CAs and accounting firms separate each client's returns, while keeping the native file name 100% untouched.
    if (!cleanGstin || cleanGstin === 'UNKNOWN_GSTIN') {
        return finalFile;
    }
    return `${cleanGstin}/${cleanFy}/${cleanType}/${finalFile}`;
}



