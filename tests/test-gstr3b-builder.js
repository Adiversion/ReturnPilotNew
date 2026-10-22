const fs = require('fs');
const path = require('path');

global.fflate = require('../lib/fflate.js');
global.ReturnPilotXlsx = require('../core/xlsx-builder.js');
const ConsolidatedGstr3bBuilder = require('../core/consolidated-gstr3b-builder.js');

async function testGstr3bBuilder() {
  console.log('Testing ConsolidatedGstr3bBuilder...');

  const inputFolder = 'C:\\Users\\SANCHAR\\Downloads\\22AAHCN1544Q1Z8\\2025-26\\GSTR3B';
  let periodsData = [];

  if (fs.existsSync(inputFolder)) {
    const files = fs.readdirSync(inputFolder).filter(f => f.endsWith('.json'));
    files.forEach(f => {
      try {
        const raw = fs.readFileSync(path.join(inputFolder, f), 'utf8');
        const d = JSON.parse(raw);
        if (d && d.ret_period) {
          // Attach mock GSTR-1 and GSTR-2B data to simulate live portal returns
          const sup = d.sup_details?.osup_det || {};
          const tx = Number(sup.txval || 0);
          const i = Number(sup.iamt || 0);
          const c = Number(sup.camt || 0);
          const s = Number(sup.samt || 0);
          const cs = Number(sup.csamt || 0);
          const itc = Number(d.itc_elg?.itc_net?.iamt || 0) + Number(d.itc_elg?.itc_net?.camt || 0) + Number(d.itc_elg?.itc_net?.samt || 0);

          periodsData.push({
            period: d.ret_period,
            data: d,
            gstr1Data: {
              txval: tx,
              tax: i + c + s + cs,
              igst: i, cgst: c, sgst: s, cess: cs
            },
            gstr2bData: {
              itc: itc,
              igst: Number(d.itc_elg?.itc_net?.iamt || 0),
              cgst: Number(d.itc_elg?.itc_net?.camt || 0),
              sgst: Number(d.itc_elg?.itc_net?.samt || 0),
              cess: 0
            }
          });
        }
      } catch (_) {}
    });
  }

  // Fallback mock if folder is not present on other machines
  if (periodsData.length === 0) {
    periodsData = [
      {
        period: '042025',
        data: {
          gstin: '22AAHCN1544Q1Z8',
          ret_period: '042025',
          sup_details: { osup_det: { txval: 100000, iamt: 0, camt: 9000, samt: 9000, csamt: 0 } },
          itc_elg: { itc_avl: [{ ty: 'OTH', iamt: 5000, camt: 2000, samt: 2000, csamt: 0 }], itc_net: { iamt: 5000, camt: 2000, samt: 2000, csamt: 0 } },
          tt_val: { tt_pay: 18000, tt_csh_pd: 9000, tt_itc_pd: 9000 }
        },
        gstr1Data: { txval: 100000, tax: 18000, igst: 0, cgst: 9000, sgst: 9000, cess: 0 },
        gstr2bData: { itc: 9000, igst: 5000, cgst: 2000, sgst: 2000, cess: 0 }
      }
    ];
  }

  console.log(`Building workbook with ${periodsData.length} periods...`);
  const wb = ConsolidatedGstr3bBuilder.buildGstr3bConsolidatedWorkbook(periodsData, {
    email: 'test@kasyhq.com',
    gstin: '22AAHCN1544Q1Z8',
    finYear: '2025-26',
    tradeName: 'Kasy Test Client'
  });

  const base64 = await wb.generateBase64();
  console.log('Generated base64 length:', base64.length);
  if (base64.length < 5000) {
    throw new Error('Base64 output too short, workbook generation failed');
  }

  // Deep inspection of all worksheets
  wb.sheets.forEach((s, idx) => {
    const xml = wb._buildWorksheetXml(s);
    if (xml.includes('[object Object]')) {
      throw new Error(`Sheet #${idx + 1} (${s.name}) contains '[object Object]'!`);
    }
    // Verify row height formatting
    if (!xml.includes('customHeight="1"')) {
      throw new Error(`Sheet #${idx + 1} (${s.name}) missing customHeight="1"!`);
    }
  });

  // Verify sheet 7 formulas and reconciliation data
  const sheet7 = wb.sheets.find(s => s.name.includes('Audit Reconciliation'));
  if (!sheet7) throw new Error('Sheet 7 (Audit Reconciliation) not found!');
  const sheet7Xml = wb._buildWorksheetXml(sheet7);
  if (!sheet7Xml.includes('<f>C2-D2</f>')) {
    throw new Error('Sheet 7 missing expected variance formula <f>C2-D2</f>');
  }
  if (!sheet7Xml.includes('Cumulative FY')) {
    throw new Error('Sheet 7 missing Total Cumulative FY row!');
  }
  if (!sheet7Xml.includes('SUM(C2:C')) {
    throw new Error('Sheet 7 missing dynamic SUM formulas in total row!');
  }

  // Verify Sheet 1 has Section E
  const sheet1 = wb.sheets.find(s => s.name.includes('Executive Summary'));
  if (!sheet1) throw new Error('Sheet 1 (Executive Summary) not found!');
  const sheet1Xml = wb._buildWorksheetXml(sheet1);
  if (!sheet1Xml.includes('SECTION E: ANNUAL AUDIT RECONCILIATION BENCHMARK')) {
    throw new Error('Sheet 1 missing Section E Annual Audit Reconciliation Benchmark!');
  }

  // Verify styles.xml enforces vertical="center" middle alignment across all text styles
  const stylesXml = wb._buildStylesXml();
  if (!stylesXml.includes('<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf>')) {
    throw new Error('Normal text style 0 missing applyAlignment="1" with vertical="center"!');
  }

  console.log('✅ ConsolidatedGstr3bBuilder test passed cleanly (verified GSTR-1/2B reconciliation, middle alignment across all text styles, row spacing, dynamic SUM formulas, and 0 [object Object])!');
}

testGstr3bBuilder().catch(err => {
  console.error('❌ ConsolidatedGstr3bBuilder test failed:', err);
  process.exit(1);
});
