// Packaged MAIN-world helper shared by portal PDF adapters. No portal code is fetched.
(function (root) {
  'use strict';
  const months = ['january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december'];
  const gstinPattern = /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/;

  function text(cell) {
    if (typeof cell === 'string' || typeof cell === 'number') return String(cell).trim();
    if (Array.isArray(cell)) return cell.map(text).join('').trim();
    return cell && typeof cell === 'object' ? text(cell.text) : '';
  }

  function validatePdf(doc, expected) {
    const gstin = String(expected?.gstin || '').trim().toUpperCase();
    const period = String(expected?.period || '');
    if (!gstinPattern.test(gstin) || !/^(0[1-9]|1[0-2])20\d{2}$/.test(period)) {
      throw new Error('PDF identity check requires a valid requested taxpayer and period');
    }
    if (!Array.isArray(doc?.content)) throw new Error('PDF identity headers are unavailable');
    const returnType = String(expected?.returnType || '');
    if (!['GSTR2B', 'GSTR3B'].includes(returnType)) throw new Error('PDF identity check requires the requested return type');
    const title = text(doc.content[0]).toUpperCase().replace(/[\s-]/g, '');
    if (title !== 'FORM' + returnType) throw new Error('PDF return type does not match the requested job');
    const found = { gstin: new Set(), month: new Set(), fy: new Set() };
    // Recorded 2B and 3B forms place labelled identity tables in the first six
    // top-level blocks. Never search invoice tables, arbitrary dates or filenames.
    for (const block of doc.content.slice(0, 6)) {
      const rows = block?.table?.body;
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        if (!Array.isArray(row) || row.length !== 2) continue;
        const label = text(row[0]).toLowerCase().replace(/^[\d.\s]+/, '').replace(/[:\s]+/g, ' ').trim();
        const value = text(row[1]);
        if (label === 'gstin' || label === 'gstin of the supplier') found.gstin.add(value.toUpperCase());
        if (label === 'month' || label === 'period') found.month.add(value.toLowerCase());
        if (label === 'financial year' || label === 'year') found.fy.add(value);
      }
    }
    for (const field of Object.keys(found)) {
      if (found[field].size !== 1) throw new Error(`PDF identity header missing or ambiguous: ${field}`);
    }
    const actualGstin = [...found.gstin][0];
    const month = months.indexOf([...found.month][0]) + 1;
    const fy = [...found.fy][0].match(/^(20\d{2})\s*-\s*(\d{2}|20\d{2})$/);
    if (!month || !fy) throw new Error('PDF period headers have an unsupported format');
    const start = Number(fy[1]);
    const end = fy[2].length === 2 ? 2000 + Number(fy[2]) : Number(fy[2]);
    if (end !== start + 1) throw new Error('PDF financial year headers are inconsistent');
    const actualPeriod = String(month).padStart(2, '0') + String(month >= 4 ? start : end);
    if (actualGstin !== gstin || actualPeriod !== period) {
      // Do not put another taxpayer's identity in an error shown/exported to users.
      throw new Error('PDF taxpayer or return period does not match the requested job');
    }
    return Object.freeze({ gstin: actualGstin, period: actualPeriod, source: 'PDF_LABELLED_HEADERS' });
  }

  root.ReturnPilotIdentity = Object.freeze({ validatePdf });
})(globalThis);
