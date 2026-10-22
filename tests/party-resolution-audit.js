// ═══════════════════════════════════════════════════════════════════════════════
//  ReturnPilot v4.1 — Consolidated Sheets Party Name Resolution Audit
//  Validates that if tradeNam is "NA" / invalid, legalName (lgnm) is used
//  across GSTR-1 (Sales), GSTR-2B (Purchase), API parser, and local cache.
// ═══════════════════════════════════════════════════════════════════════════════

'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const rootDir = path.resolve(__dirname, '..');

// Mock Excel generator environment so builders can run in Node CLI
global.ReturnPilotXlsx = {
  createWorkbook: function() {
    const sheets = [];
    return {
      author: '',
      addSheet: function(title, headers, rows, opts) {
        sheets.push({ title, headers, rows, opts });
      },
      getSheets: function() {
        return sheets;
      }
    };
  }
};

const ConsolidatedSalesBuilder = require('../core/consolidated-sales-builder.js');
const ConsolidatedPurchaseBuilder = require('../core/consolidated-purchase-builder.js');

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m'
};

let passed = 0;
let failed = 0;

function it(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ' + ANSI.green + '✔ PASS' + ANSI.reset + '  ' + name);
  } catch (err) {
    failed++;
    console.log('  ' + ANSI.red + '✖ FAIL' + ANSI.reset + '  ' + name + '\n        ' + ANSI.dim + (err.stack || err.message) + ANSI.reset);
  }
}

function runPartyResolutionAudit() {
  console.log('\n' + ANSI.bold + ANSI.cyan + '📑 RUNNING CONSOLIDATED SHEETS PARTY NAME RESOLUTION AUDIT...' + ANSI.reset);
  console.log(ANSI.dim + '─────────────────────────────────────────────────────────────────────────────' + ANSI.reset);

  // Helper from popup/popup.js
  const isBadPartyName = (val) => {
    if (!val || typeof val !== 'string') return true;
    const clean = val.trim().toLowerCase();
    return clean === '' || clean === 'na' || clean === 'n/a' || clean === 'null' || clean === 'undefined' || clean === '-' || clean === '.';
  };

  const extractPartyName = (data) => {
    if (!data) return '';
    const trade = data.tradeNam || data.trade_name || data.trdnm || '';
    const legal = data.lgnm || data.legal_name || data.legalName || data.cname || data.bname || '';
    if (!isBadPartyName(trade)) return trade.trim();
    if (!isBadPartyName(legal)) return legal.trim();
    return '';
  };

  // 1. Official GSTN API Taxpayer Detail Extraction
  it('Official GSTN endpoint returns tradeNam="NA" -> extracts lgnm (BALAJI ASSOCIATES)', () => {
    const apiPayload = {
      ntcrbs: 'TRD:TWD',
      lgnm: 'BALAJI ASSOCIATES',
      gstin: '22ABDFB5178Q1Z2',
      ctb: 'Partnership',
      tradeNam: 'NA',
      sts: 'Active'
    };
    const result = extractPartyName(apiPayload);
    assert.strictEqual(result, 'BALAJI ASSOCIATES', `Expected "BALAJI ASSOCIATES", got "${result}"`);
  });

  it('Rejects all permutations of invalid trade names ("N/A", "-", "null", empty) in favor of legal name', () => {
    const variations = ['NA', 'na', 'Na', 'N/A', 'n/a', '-', '.', 'null', 'undefined', '   '];
    variations.forEach(badVal => {
      const payload = { tradeNam: badVal, lgnm: 'PRECISION AUTO COMPONENTS PVT LTD' };
      const resolved = extractPartyName(payload);
      assert.strictEqual(resolved, 'PRECISION AUTO COMPONENTS PVT LTD', `Failed for bad value "${badVal}"`);
    });
  });

  it('Preserves genuine trade names when valid and non-NA', () => {
    const payload = {
      tradeNam: 'BALAJI TRADING CO',
      lgnm: 'BALAJI ASSOCIATES'
    };
    const resolved = extractPartyName(payload);
    assert.strictEqual(resolved, 'BALAJI TRADING CO', `Expected trade name when valid, got "${resolved}"`);
  });

  // 2. Storage Cache Cleanup
  it('Purges stale "NA" entries from local party cache without blocking valid entries', () => {
    const cache = {
      '22ABDFB5178Q1Z2': 'NA',
      '27AABCU9603R1ZM': 'RELIABLE TEXTILES',
      '07AAAAA0000A1Z5': 'N/A'
    };

    const toFetch = [];
    const partyMap = {};

    Object.keys(cache).forEach(ctin => {
      if (cache[ctin] && !isBadPartyName(cache[ctin])) {
        partyMap[ctin] = cache[ctin].trim();
      } else {
        delete cache[ctin];
        toFetch.push(ctin);
      }
    });

    assert.strictEqual(cache['22ABDFB5178Q1Z2'], undefined, 'Stale "NA" entry was not deleted');
    assert.strictEqual(cache['07AAAAA0000A1Z5'], undefined, 'Stale "N/A" entry was not deleted');
    assert.strictEqual(cache['27AABCU9603R1ZM'], 'RELIABLE TEXTILES', 'Valid entry was wrongfully deleted');
    assert.deepStrictEqual(toFetch.sort(), ['07AAAAA0000A1Z5', '22ABDFB5178Q1Z2'].sort());
  });

  // 3. Consolidated Sales Workbook Generation
  it('ConsolidatedSalesBuilder resolves lgnm and partyMap when GSTR-1 trdnm is "NA"', () => {
    const mockPeriodsData = [
      {
        period: '042024',
        data: {
          b2b: [
            {
              ctin: '22ABDFB5178Q1Z2',
              trdnm: 'NA',
              lgnm: 'BALAJI ASSOCIATES',
              inv: [
                { inum: 'INV-101', idt: '15-04-2024', val: 11800, pos: '22', rchrg: 'N', itms: [{ itm_det: { txval: 10000, rt: 18, iamt: 1800 } }] }
              ]
            }
          ],
          cdnr: [
            {
              ctin: '27AABCU9603R1ZM',
              trdnm: 'NA',
              inv: [],
              nt: [
                { ntnum: 'CN-01', dt: '20-04-2024', typ: 'C', inum: 'INV-09', idt: '10-04-2024', val: 1180, itms: [{ itm_det: { txval: 1000, rt: 18, camt: 90, samt: 90 } }] }
              ]
            }
          ]
        }
      }
    ];

    const metadata = {
      gstin: '27TEST9999X1Z1',
      tradeName: 'NA',
      legalName: 'TEST ENTERPRISES',
      email: 'test@example.com',
      partyMap: {
        '27AABCU9603R1ZM': 'RESOLVED VIA PARTYMAP'
      }
    };

    const wb = ConsolidatedSalesBuilder.buildSalesWorkbook(mockPeriodsData, metadata);
    const sheets = wb.getSheets();

    // Check Executive Summary sheet
    const overview = sheets.find(s => s.title === 'Executive Summary');
    assert.ok(overview, 'Executive Summary sheet exists');
    const tradeRow = overview.rows.find(r => r[0] === 'Taxpayer Legal/Trade Name');
    assert.strictEqual(tradeRow[1], 'TEST ENTERPRISES', 'Overview trade name should fallback to legalName when "NA"');

    // Check B2B & Outward Supplies sheet
    const salesSheet = sheets.find(s => s.title === 'B2B & Outward Supplies');
    assert.ok(salesSheet, 'B2B & Outward Supplies sheet exists');
    const b2bRow = salesSheet.rows.find(r => r[6] === '22ABDFB5178Q1Z2');
    assert.ok(b2bRow, 'B2B row found');
    assert.strictEqual(b2bRow[7], 'BALAJI ASSOCIATES', `Expected party name "BALAJI ASSOCIATES", got "${b2bRow[7]}"`);
    assert.strictEqual(b2bRow[3], 'Regular B2B', `Expected statutory invoice type "Regular B2B", got "${b2bRow[3]}"`);

    // Check Credit/Debit Notes row in salesSheet
    const cdnRow = salesSheet.rows.find(r => r[6] === '27AABCU9603R1ZM');
    assert.ok(cdnRow, 'CDNR row found');
    assert.strictEqual(cdnRow[7], 'RESOLVED VIA PARTYMAP', `Expected party name from partyMap, got "${cdnRow[7]}"`);
    assert.strictEqual(cdnRow[3], 'Regular B2B', `Expected statutory note supply type "Regular B2B", got "${cdnRow[3]}"`);
  });

  it('ConsolidatedSalesBuilder maps inv_typ codes to statutory GSTR-1 dropdown labels', () => {
    const mockData = [
      {
        period: '052024',
        data: {
          b2b: [
            {
              ctin: '24AAACC1234F1Z0',
              trdnm: 'SEZ UNIT CORP',
              inv: [
                { inum: 'SEZ-1', idt: '01-05-2024', val: 50000, inv_typ: 'SEZWP', itms: [{ itm_det: { txval: 50000, rt: 18, iamt: 9000 } }] },
                { inum: 'SEZ-2', idt: '02-05-2024', val: 30000, inv_typ: 'SEZWOP', itms: [{ itm_det: { txval: 30000, rt: 0 } }] },
                { inum: 'DE-1', idt: '03-05-2024', val: 20000, inv_typ: 'DE', itms: [{ itm_det: { txval: 20000, rt: 18, iamt: 3600 } }] },
                { inum: 'INTRA-1', idt: '04-05-2024', val: 10000, inv_typ: 'INTRAIGST', itms: [{ itm_det: { txval: 10000, rt: 18, iamt: 1800 } }] }
              ]
            }
          ],
          cdnr: [
            {
              ctin: '24AAACC1234F1Z0',
              trdnm: 'SEZ UNIT CORP',
              nt: [
                { ntnum: 'CN-SEZ', dt: '05-05-2024', typ: 'C', sply_ty: 'SEZWP', val: 5000, itms: [{ itm_det: { txval: 5000, rt: 18, iamt: 900 } }] }
              ]
            }
          ]
        }
      }
    ];

    const wb = ConsolidatedSalesBuilder.buildSalesWorkbook(mockData, { gstin: '24COMPANY1234F1' });
    const sheet = wb.getSheets().find(s => s.title === 'B2B & Outward Supplies');
    assert.ok(sheet, 'B2B & Outward Supplies sheet exists');

    const sezwpRow = sheet.rows.find(r => r[4] === 'SEZ-1');
    assert.strictEqual(sezwpRow[3], 'SEZ supplies with payment', `Expected "SEZ supplies with payment", got "${sezwpRow[3]}"`);

    const sezwopRow = sheet.rows.find(r => r[4] === 'SEZ-2');
    assert.strictEqual(sezwopRow[3], 'SEZ supplies without payment', `Expected "SEZ supplies without payment", got "${sezwopRow[3]}"`);

    const deRow = sheet.rows.find(r => r[4] === 'DE-1');
    assert.strictEqual(deRow[3], 'Deemed Exp', `Expected "Deemed Exp", got "${deRow[3]}"`);

    const intraRow = sheet.rows.find(r => r[4] === 'INTRA-1');
    assert.strictEqual(intraRow[3], 'Intra-State supplies attracting IGST', `Expected "Intra-State supplies attracting IGST", got "${intraRow[3]}"`);

    const cnSezRow = sheet.rows.find(r => r[4] === 'CN-SEZ');
    assert.strictEqual(cnSezRow[3], 'SEZ supplies with payment', `Expected CDNR note supply type "SEZ supplies with payment", got "${cnSezRow[3]}"`);
  });

  // 4. Consolidated Purchase Workbook Generation
  it('ConsolidatedPurchaseBuilder resolves lgnm and partyMap across all purchase tables when trdnm is "NA"', () => {
    const mockPeriodsData = [
      {
        period: '042024',
        data: {
          docdata: {
            b2b: [
              {
                ctin: '22ABDFB5178Q1Z2',
                trdnm: 'NA',
                lgnm: 'BALAJI ASSOCIATES',
                inv: [
                  { inum: 'PINV-001', dt: '10-04-2024', val: 5900, pos: '22', items: [{ itm_det: { txval: 5000, rt: 18, igst: 900 } }] }
                ]
              }
            ],
            b2ba: [
              {
                ctin: '33AABCT1234F1Z9',
                trdnm: 'NA',
                inv: [
                  { inum: 'PINV-AMD-1', dt: '12-04-2024', oinum: 'PINV-OLD', oidt: '01-04-2024', val: 2360, items: [{ itm_det: { txval: 2000, rt: 18, igst: 360 } }] }
                ]
              }
            ],
            cdnr: [
              {
                ctin: '22ABDFB5178Q1Z2',
                trdnm: 'NA',
                lgnm: 'BALAJI ASSOCIATES',
                nt: [
                  { ntnum: 'PCN-01', dt: '18-04-2024', typ: 'C', inum: 'PINV-001', idt: '10-04-2024', val: 590, items: [{ itm_det: { txval: 500, rt: 18, igst: 90 } }] }
                ]
              }
            ],
            isd: [
              {
                ctin: '29ISD00000A1Z2',
                trdnm: 'NA',
                doclist: [
                  { doc_num: 'ISD-01', doc_dt: '25-04-2024', txval: 1000, iamt: 180, itcavl: 'Y' }
                ]
              }
            ]
          }
        }
      }
    ];

    const metadata = {
      gstin: '27MYGSTIN1234Z5',
      tradeName: 'NA',
      legalName: 'MY ENTERPRISES',
      email: 'user@example.com',
      partyMap: {
        '33AABCT1234F1Z9': 'SOUTHERN DISTRIBUTORS',
        '29ISD00000A1Z2': 'HEAD OFFICE ISD DIVISION'
      }
    };

    const wb = ConsolidatedPurchaseBuilder.buildPurchaseWorkbook(mockPeriodsData, metadata);
    const sheets = wb.getSheets();

    const purchaseSheet = sheets.find(s => s.title === 'B2B Inward Supplies');
    assert.ok(purchaseSheet, 'B2B Inward Supplies sheet exists');

    // Verify B2B party name resolved via lgnm
    const b2bRow = purchaseSheet.rows.find(r => r[6] === '22ABDFB5178Q1Z2' && r[4] === 'PINV-001');
    assert.ok(b2bRow, 'Purchase B2B row found');
    assert.strictEqual(b2bRow[7], 'BALAJI ASSOCIATES', `Expected "BALAJI ASSOCIATES", got "${b2bRow[7]}"`);

    // Verify B2BA party name resolved via partyMap
    const b2baRow = purchaseSheet.rows.find(r => r[6] === '33AABCT1234F1Z9');
    assert.ok(b2baRow, 'Purchase B2BA row found');
    assert.strictEqual(b2baRow[7], 'SOUTHERN DISTRIBUTORS', `Expected "SOUTHERN DISTRIBUTORS", got "${b2baRow[7]}"`);

    // Verify CDNR party name resolved via lgnm
    const cdnRow = purchaseSheet.rows.find(r => r[6] === '22ABDFB5178Q1Z2' && r[4] === 'PCN-01');
    assert.ok(cdnRow, 'Purchase CDNR row found');
    assert.strictEqual(cdnRow[7], 'BALAJI ASSOCIATES', `Expected "BALAJI ASSOCIATES" in CDNR, got "${cdnRow[7]}"`);

    // Verify ISD sheet party name
    const isdSheet = sheets.find(s => s.title === 'ISD & Import Credits');
    assert.ok(isdSheet, 'ISD & Import Credits sheet exists');
    const isdRow = isdSheet.rows.find(r => r[5] === '29ISD00000A1Z2');
    assert.ok(isdRow, 'ISD row found');
    assert.strictEqual(isdRow[6], 'HEAD OFFICE ISD DIVISION', `Expected ISD name, got "${isdRow[6]}"`);
  });

  console.log(ANSI.dim + '─────────────────────────────────────────────────────────────────────────────' + ANSI.reset);
  console.log(`${ANSI.bold}${passed > 0 && failed === 0 ? ANSI.green : ANSI.red}PARTY RESOLUTION AUDIT RESULT: ${passed} passed, ${failed} failed.${ANSI.reset}\n`);
  return failed === 0;
}

if (require.main === module) {
  const ok = runPartyResolutionAudit();
  process.exit(ok ? 0 : 1);
}

module.exports = { runPartyResolutionAudit };
