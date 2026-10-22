// ═══════════════════════════════════════════════════════════════════════════════
//  Test script: Cash & Credit Ledger Builder Verification
// ═══════════════════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');

// Mock browser globals for Node test environment
global.fflate = require('../lib/fflate.js');
global.ReturnPilotXlsx = require('../core/xlsx-builder.js');
const CashCreditLedgerBuilder = require('../core/cash-credit-ledger-builder.js');

async function testLedgerBuilder() {
  console.log('Testing CashCreditLedgerBuilder...');

  // Read actual sample data from "cash and credit ledger api.txt" if present
  const apiFilePath = path.join(__dirname, '../cash and credit ledger api.txt');
  const rawApiText = fs.existsSync(apiFilePath) ? fs.readFileSync(apiFilePath, 'utf8') : '';
  
  // Extract cash JSON (line 19)
  const lines = rawApiText.split('\n');
  let cashJson = null;
  let creditJson = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('{"fr_dt"') && trimmed.includes('"ret_period":"-"')) {
      if (!cashJson && trimmed.includes('"sgstbal"')) {
        cashJson = JSON.parse(trimmed);
      } else if (!creditJson && trimmed.includes('"cessTaxAmt"')) {
        creditJson = JSON.parse(trimmed);
      }
    }
  }

  if (!cashJson) {
    console.warn('Could not extract cashJson from api text, using mock');
    cashJson = { gstin: '22AACCN0357J1ZQ', fr_dt: '01/04/2023', to_dt: '31/03/2024', tr: [] };
  }
  if (!creditJson) {
    console.warn('Could not extract creditJson from api text, using mock');
    creditJson = { gstin: '22AACCN0357J1ZQ', fr_dt: '01/04/2023', to_dt: '31/03/2024', tr: [] };
  }

  console.log(`Found ${cashJson.tr.length} cash transactions and ${creditJson.tr.length} credit transactions.`);

  const wb = CashCreditLedgerBuilder.buildLedgerWorkbook({
    creditData: creditJson,
    cashData: cashJson,
    metadata: {
      gstin: '22AACCN0357J1ZQ',
      legalName: 'NAVBHARAT DWELLINGS PRIVATE LIMITED',
      finYear: '2023-24',
      fromDate: '01/04/2023',
      toDate: '31/03/2024'
    }
  });

  const base64 = await wb.generateBase64();
  console.log('Generated base64 length:', base64.length);
  if (base64.length < 1000) {
    throw new Error('Base64 output too short, workbook generation failed');
  }

  const outPath = path.join(__dirname, '../22AACCN0357J1ZQ_Cash_and_Credit_Ledger_2023-24_TEST.xlsx');
  fs.writeFileSync(outPath, Buffer.from(base64, 'base64'));
  console.log('Successfully written test workbook to:', outPath);
  console.log('File size:', fs.statSync(outPath).size, 'bytes');
  console.log('✅ TEST PASSED!');
}

testLedgerBuilder().catch(err => {
  console.error('❌ TEST FAILED:', err);
  process.exit(1);
});
