// Synthetic minimal header layouts; no raw taxpayer records or financial data.
const GSTIN = '22AAAAA0000A1Z5';
function pdfHeader({ type = '2B', month = 'April', fy = '2026-27', gstin = GSTIN } = {}) {
  const cell = value => type === '3B' ? { text: value } : value;
  return { content: [
    { text: `FORM GSTR-${type}` },
    { table: { body: [
      [cell(type === '3B' ? 'Year' : 'Financial Year'), cell(fy)],
      [cell(type === '3B' ? 'Period' : 'Month'), cell(month)]
    ] } },
    { table: { body: [[cell(type === '3B' ? 'GSTIN of the supplier' : '1.GSTIN'), cell(gstin)]] } }
  ] };
}
module.exports = { GSTIN, pdfHeader };
