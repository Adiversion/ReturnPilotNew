/**
 * ReturnPilot Test Lab — Official Form GSTR-2B Statutory DocDefinition Builder
 * Generates 100% compliant official GSTN statutory PDF layout client-side using pdfMake
 */

'use strict';

(function(root) {
  function formatInr(val) {
    const num = parseFloat(val) || 0;
    return num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function parseNumber(val) {
    if (typeof val === 'number') return isNaN(val) ? 0 : val;
    if (!val) return 0;
    const clean = String(val).replace(/,/g, '').trim();
    const parsed = parseFloat(clean);
    return isNaN(parsed) ? 0 : parsed;
  }

  function buildGstr2bDocDefinition(raw2b, meta = {}) {
    const data = raw2b?.data || raw2b || {};
    const itcsumm = data.itcsumm || data.data?.itcsumm || {};
    const itcavl = itcsumm.itcavl || {};
    const itcunavl = itcsumm.itcunavl || {};

    const gstin = meta.gstin || data.gstin || '27AKHPG2039E1ZI';
    const period = meta.period || data.rtnprd || '042025';
    const finYear = meta.finYear || '2025-26';
    const tradeName = meta.tradeName || data.lgnm || data.tradeName || 'Registered Taxpayer';

    // Parse Part A ITC Available
    function extractSums(section) {
      let igst = 0, cgst = 0, sgst = 0, cess = 0;
      if (!section) return { igst: 0, cgst: 0, sgst: 0, cess: 0 };
      if (typeof section === 'object') {
        if (section.iamt !== undefined || section.camt !== undefined) {
          igst += parseNumber(section.iamt ?? section.igst);
          cgst += parseNumber(section.camt ?? section.cgst);
          sgst += parseNumber(section.samt ?? section.sgst);
          cess += parseNumber(section.csamt ?? section.cess);
        } else {
          Object.values(section).forEach(sub => {
            if (sub && typeof sub === 'object') {
              igst += parseNumber(sub.iamt ?? sub.igst);
              cgst += parseNumber(sub.camt ?? sub.cgst);
              sgst += parseNumber(sub.samt ?? sub.sgst);
              cess += parseNumber(sub.csamt ?? sub.cess);
            }
          });
        }
      }
      return { igst, cgst, sgst, cess };
    }

    const b2bAvl = extractSums(itcavl.b2b);
    const b2baAvl = extractSums(itcavl.b2ba);
    const cdnrAvl = extractSums(itcavl.cdnr);
    const cdnraAvl = extractSums(itcavl.cdnra);
    const rcmAvl = extractSums(itcavl.revsup || itcavl.b2brcm);
    const isdAvl = extractSums(itcavl.isd || itcavl.isdinv);
    const impgAvl = extractSums(itcavl.impg);

    // Part A Totals (Netting Credit notes)
    const partA_other = {
      igst: b2bAvl.igst + b2baAvl.igst - (cdnrAvl.igst + cdnraAvl.igst),
      cgst: b2bAvl.cgst + b2baAvl.cgst - (cdnrAvl.cgst + cdnraAvl.cgst),
      sgst: b2bAvl.sgst + b2baAvl.sgst - (cdnrAvl.sgst + cdnraAvl.sgst),
      cess: b2bAvl.cess + b2baAvl.cess - (cdnrAvl.cess + cdnraAvl.cess)
    };

    const totalPartA = {
      igst: partA_other.igst + rcmAvl.igst + isdAvl.igst + impgAvl.igst,
      cgst: partA_other.cgst + rcmAvl.cgst + isdAvl.cgst + impgAvl.cgst,
      sgst: partA_other.sgst + rcmAvl.sgst + isdAvl.sgst + impgAvl.sgst,
      cess: partA_other.cess + rcmAvl.cess + isdAvl.cess + impgAvl.cess
    };

    // Parse Part B ITC Not Available
    const b2bUnavl = extractSums(itcunavl.b2b);
    const cdnrUnavl = extractSums(itcunavl.cdnr);
    const rcmUnavl = extractSums(itcunavl.revsup || itcunavl.b2brcm);

    const partB_other = {
      igst: Math.max(0, b2bUnavl.igst - cdnrUnavl.igst),
      cgst: Math.max(0, b2bUnavl.cgst - cdnrUnavl.cgst),
      sgst: Math.max(0, b2bUnavl.sgst - cdnrUnavl.sgst),
      cess: Math.max(0, b2bUnavl.cess - cdnrUnavl.cess)
    };

    const totalPartB = {
      igst: partB_other.igst + rcmUnavl.igst,
      cgst: partB_other.cgst + rcmUnavl.cgst,
      sgst: partB_other.sgst + rcmUnavl.sgst,
      cess: partB_other.cess + rcmUnavl.cess
    };

    const docDef = {
      pageSize: 'A4',
      pageOrientation: 'portrait',
      pageMargins: [28, 28, 28, 28],
      defaultStyle: {
        fontSize: 8.5,
        color: '#1f2937'
      },
      content: [
        { text: 'FORM GSTR-2B', style: 'docHeader' },
        { text: '[See Section 16(2)(aa) of the CGST Act, 2017 read with Rule 60(7)]', style: 'docSubHeader' },
        { text: 'Auto-drafted ITC Statement', style: 'docTitle' },
        { text: ' ', margin: [0, 2] },

        // Taxpayer Details Box
        {
          table: {
            widths: ['25%', '35%', '18%', '22%'],
            body: [
              [{ text: '1. GSTIN', bold: true, fillColor: '#f1f5f9' }, gstin, { text: '2. Legal/Trade Name', bold: true, fillColor: '#f1f5f9' }, tradeName],
              [{ text: '3. Financial Year', bold: true, fillColor: '#f1f5f9' }, finYear, { text: '4. Return Period', bold: true, fillColor: '#f1f5f9' }, period],
              [{ text: '5. Statement Date', bold: true, fillColor: '#f1f5f9' }, new Date().toLocaleDateString('en-IN'), { text: '6. Status', bold: true, fillColor: '#f1f5f9' }, 'Auto-Drafted']
            ]
          },
          layout: {
            hLineWidth: () => 0.5,
            vLineWidth: () => 0.5,
            hLineColor: () => '#cbd5e1',
            vLineColor: () => '#cbd5e1',
            paddingLeft: () => 6,
            paddingRight: () => 6,
            paddingTop: () => 4,
            paddingBottom: () => 4
          }
        },
        { text: ' ', margin: [0, 6] },

        // Table 3: Part A - ITC Available
        { text: 'Table 3: Part A — Input Tax Credit (ITC) Available (Summary)', style: 'sectionHeader' },
        {
          table: {
            headerRows: 1,
            widths: ['40%', '15%', '15%', '15%', '15%'],
            body: [
              [
                { text: 'Heading / Supply Nature', style: 'th' },
                { text: 'Integrated Tax (₹)', style: 'thR' },
                { text: 'Central Tax (₹)', style: 'thR' },
                { text: 'State/UT Tax (₹)', style: 'thR' },
                { text: 'Cess (₹)', style: 'thR' }
              ],
              [
                'I. All other ITC - Supplies from registered persons (Net of Credit Notes)',
                { text: formatInr(partA_other.igst), alignment: 'right' },
                { text: formatInr(partA_other.cgst), alignment: 'right' },
                { text: formatInr(partA_other.sgst), alignment: 'right' },
                { text: formatInr(partA_other.cess), alignment: 'right' }
              ],
              [
                'II. Inward supplies liable to reverse charge (RCM)',
                { text: formatInr(rcmAvl.igst), alignment: 'right' },
                { text: formatInr(rcmAvl.cgst), alignment: 'right' },
                { text: formatInr(rcmAvl.sgst), alignment: 'right' },
                { text: formatInr(rcmAvl.cess), alignment: 'right' }
              ],
              [
                'III. Inward supplies from Input Service Distributor (ISD)',
                { text: formatInr(isdAvl.igst), alignment: 'right' },
                { text: formatInr(isdAvl.cgst), alignment: 'right' },
                { text: formatInr(isdAvl.sgst), alignment: 'right' },
                { text: formatInr(isdAvl.cess), alignment: 'right' }
              ],
              [
                'IV. Import of Goods from Overseas / SEZ Units',
                { text: formatInr(impgAvl.igst), alignment: 'right' },
                { text: formatInr(impgAvl.cgst), alignment: 'right' },
                { text: formatInr(impgAvl.sgst), alignment: 'right' },
                { text: formatInr(impgAvl.cess), alignment: 'right' }
              ],
              [
                { text: 'Total ITC Available (A)', bold: true, fillColor: '#e2e8f0' },
                { text: formatInr(totalPartA.igst), bold: true, alignment: 'right', fillColor: '#e2e8f0' },
                { text: formatInr(totalPartA.cgst), bold: true, alignment: 'right', fillColor: '#e2e8f0' },
                { text: formatInr(totalPartA.sgst), bold: true, alignment: 'right', fillColor: '#e2e8f0' },
                { text: formatInr(totalPartA.cess), bold: true, alignment: 'right', fillColor: '#e2e8f0' }
              ]
            ]
          },
          layout: {
            hLineWidth: () => 0.5,
            vLineWidth: () => 0.5,
            hLineColor: () => '#cbd5e1',
            vLineColor: () => '#cbd5e1',
            paddingLeft: () => 5,
            paddingRight: () => 5,
            paddingTop: () => 3.5,
            paddingBottom: () => 3.5
          }
        },
        { text: ' ', margin: [0, 6] },

        // Table 4: Part B - ITC Not Available
        { text: 'Table 4: Part B — Input Tax Credit (ITC) Not Available (Ineligible)', style: 'sectionHeader' },
        {
          table: {
            headerRows: 1,
            widths: ['40%', '15%', '15%', '15%', '15%'],
            body: [
              [
                { text: 'Heading / Supply Nature', style: 'th' },
                { text: 'Integrated Tax (₹)', style: 'thR' },
                { text: 'Central Tax (₹)', style: 'thR' },
                { text: 'State/UT Tax (₹)', style: 'thR' },
                { text: 'Cess (₹)', style: 'thR' }
              ],
              [
                'I. All other ITC - Ineligible supplies (Sec 16(4) / POS Mismatch)',
                { text: formatInr(partB_other.igst), alignment: 'right' },
                { text: formatInr(partB_other.cgst), alignment: 'right' },
                { text: formatInr(partB_other.sgst), alignment: 'right' },
                { text: formatInr(partB_other.cess), alignment: 'right' }
              ],
              [
                'II. Inward supplies liable to reverse charge (Ineligible)',
                { text: formatInr(rcmUnavl.igst), alignment: 'right' },
                { text: formatInr(rcmUnavl.cgst), alignment: 'right' },
                { text: formatInr(rcmUnavl.sgst), alignment: 'right' },
                { text: formatInr(rcmUnavl.cess), alignment: 'right' }
              ],
              [
                { text: 'Total ITC Not Available (B)', bold: true, fillColor: '#fee2e2' },
                { text: formatInr(totalPartB.igst), bold: true, alignment: 'right', fillColor: '#fee2e2' },
                { text: formatInr(totalPartB.cgst), bold: true, alignment: 'right', fillColor: '#fee2e2' },
                { text: formatInr(totalPartB.sgst), bold: true, alignment: 'right', fillColor: '#fee2e2' },
                { text: formatInr(totalPartB.cess), bold: true, alignment: 'right', fillColor: '#fee2e2' }
              ]
            ]
          },
          layout: {
            hLineWidth: () => 0.5,
            vLineWidth: () => 0.5,
            hLineColor: () => '#cbd5e1',
            vLineColor: () => '#cbd5e1',
            paddingLeft: () => 5,
            paddingRight: () => 5,
            paddingTop: () => 3.5,
            paddingBottom: () => 3.5
          }
        },
        { text: ' ', margin: [0, 8] },

        // Statutory Advisory Note
        {
          text: 'Note: Form GSTR-2B is an auto-drafted ITC statement generated based on the information furnished by your suppliers in their respective Form GSTR-1/IFF, GSTR-5, and GSTR-6. It reflects input tax credit eligibility as per Section 16(2)(aa) of the CGST Act, 2017.',
          fontSize: 7.5,
          color: '#64748b',
          italics: true
        }
      ],
      styles: {
        docHeader: { fontSize: 13, bold: true, alignment: 'center', color: '#0f172a' },
        docSubHeader: { fontSize: 8, italics: true, alignment: 'center', color: '#475569', margin: [0, 1] },
        docTitle: { fontSize: 10, bold: true, alignment: 'center', color: '#0369a1', margin: [0, 2] },
        sectionHeader: { fontSize: 9.5, bold: true, color: '#0f172a', margin: [0, 4] },
        th: { bold: true, fontSize: 8, fillColor: '#f8fafc', color: '#0f172a' },
        thR: { bold: true, fontSize: 8, fillColor: '#f8fafc', alignment: 'right', color: '#0f172a' }
      }
    };

    return docDef;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { buildGstr2bDocDefinition };
  } else {
    root.Gstr2bDocDefBuilder = { buildGstr2bDocDefinition };
  }
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis));
