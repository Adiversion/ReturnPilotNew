// ═══════════════════════════════════════════════════════════════════════════════
//  ReturnPilot Premium v4.2.5 — Statutory GSTR-3B Consolidated Master Workbook
//  Official GSTN Standard: Executive Summary, GSTR-9 Matrix, Outward 3.1, ITC 4,
//  Table 6.1 Payment & Ledgers, Interest/Late Fees, and Audit Reconciliation
//  © 2026 KasyHQ Technologies. All Rights Reserved.
// ═══════════════════════════════════════════════════════════════════════════════

(function(root) {
  'use strict';

  function parseNumber(val) {
    if (val === null || val === undefined || val === '' || val === '-') return 0;
    if (typeof val === 'number') return isNaN(val) ? 0 : val;
    const clean = String(val).replace(/,/g, '').trim();
    const num = Number(clean);
    return isNaN(num) ? 0 : Math.round(num * 100) / 100;
  }

  function formatPeriodMonth(periodVal) {
    if (!periodVal || periodVal.length < 6) return String(periodVal || '');
    const mm = parseInt(periodVal.substring(0, 2), 10);
    const yyyy = periodVal.substring(2, 6);
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return `${months[mm - 1] || mm}-${yyyy}`;
  }

  function formatShortMonth(periodVal) {
    if (!periodVal || periodVal.length < 6) return String(periodVal || '');
    const mm = parseInt(periodVal.substring(0, 2), 10);
    const yyyy = periodVal.substring(2, 6);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[mm - 1] || mm} ${yyyy}`;
  }

  const TYPE_NAMES = {
    'IMPG': 'Import of Goods',
    'IMPS': 'Import of Services',
    'ISRC': 'Inward supplies liable to reverse charge (RCM)',
    'ISD': 'Inward supplies from ISD',
    'OTH': 'All other ITC',
    'RUL': 'Reversal as per Rules 38, 42, 43 and Section 17(5)'
  };

  /**
   * Sort periods in statutory Indian Financial Year order (April to March)
   */
  function sortPeriodsByFY(periodList) {
    return periodList.slice().sort((a, b) => {
      const vA = String(a.period || a.value || a || '');
      const vB = String(b.period || b.value || b || '');
      if (vA.length < 6 || vB.length < 6) return vA.localeCompare(vB);
      const mA = parseInt(vA.substring(0, 2), 10);
      const yA = parseInt(vA.substring(2, 6), 10);
      const mB = parseInt(vB.substring(0, 2), 10);
      const yB = parseInt(vB.substring(2, 6), 10);

      // Convert month to FY offset (April = 0, March = 11)
      const offA = mA >= 4 ? mA - 4 : mA + 8;
      const offB = mB >= 4 ? mB - 4 : mB + 8;
      const fyStartA = mA >= 4 ? yA : yA - 1;
      const fyStartB = mB >= 4 ? yB : yB - 1;

      if (fyStartA !== fyStartB) return fyStartA - fyStartB;
      return offA - offB;
    });
  }

  function parseGstr1SummaryTotals(g1Data) {
    if (!g1Data || typeof g1Data !== 'object') {
      return { txval: 0, tax: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };
    }

    const d = g1Data.data || g1Data;

    // Direct totals already provided
    if (typeof d.txval === 'number' && typeof d.tax === 'number') {
      return {
        txval: d.txval,
        tax: d.tax,
        igst: d.igst || 0,
        cgst: d.cgst || 0,
        sgst: d.sgst || 0,
        cess: d.cess || 0
      };
    }

    let txval = 0, igst = 0, cgst = 0, sgst = 0, cess = 0;

    // 1. Check sec_sum (from live portal summary API)
    const secSum = Array.isArray(d.sec_sum) ? d.sec_sum : (Array.isArray(d) ? d : null);
    if (secSum && secSum.length > 0) {
      const ttlLiab = secSum.find(s => (s.sec_nm || '').toUpperCase() === 'TTL_LIAB');
      if (ttlLiab) {
        txval = parseNumber(ttlLiab.ttl_tax ?? ttlLiab.txval);
        igst  = parseNumber(ttlLiab.ttl_igst ?? ttlLiab.iamt);
        cgst  = parseNumber(ttlLiab.ttl_cgst ?? ttlLiab.camt);
        sgst  = parseNumber(ttlLiab.ttl_sgst ?? ttlLiab.samt);
        cess  = parseNumber(ttlLiab.ttl_cess ?? ttlLiab.csamt);
      } else {
        secSum.forEach(sec => {
          const secNm = (sec.sec_nm || '').toUpperCase();
          if (secNm === 'NIL' || secNm === 'DOC_ISSUE' || secNm === 'DOC' || secNm.startsWith('HSN')) return;

          const isCreditNote = (secNm === 'CDNR' || secNm === 'CDNUR' || secNm === 'CDNRA' || secNm === 'CDNURA');
          const sign = isCreditNote ? -1 : 1;

          const stx = parseNumber(sec.txval ?? sec.tax_val ?? sec.taxable_value ?? sec.act_tax ?? sec.ttl_tax);
          const si  = parseNumber(sec.iamt ?? sec.igst ?? sec.act_igst ?? sec.ttl_igst);
          const sc  = parseNumber(sec.camt ?? sec.cgst ?? sec.act_cgst ?? sec.ttl_cgst);
          const ss  = parseNumber(sec.samt ?? sec.sgst ?? sec.act_sgst ?? sec.ttl_sgst);
          const scs = parseNumber(sec.csamt ?? sec.cess ?? sec.act_cess ?? sec.ttl_cess);

          txval += sign * stx;
          igst  += sign * si;
          cgst  += sign * sc;
          sgst  += sign * ss;
          cess  += sign * scs;
        });
      }
      const tax = igst + cgst + sgst + cess;
      return {
        txval: Math.round(txval * 100) / 100,
        tax: Math.round(tax * 100) / 100,
        igst: Math.round(igst * 100) / 100,
        cgst: Math.round(cgst * 100) / 100,
        sgst: Math.round(sgst * 100) / 100,
        cess: Math.round(cess * 100) / 100
      };
    }

    // 2. Offline document format (b2b, b2cl, b2cs, cdnr, exp, etc.)
    const processItems = (items, sign = 1) => {
      (items || []).forEach(inv => {
        const itms = inv.items || inv.itms || [inv];
        itms.forEach(itm => {
          const det = itm.itm_det || itm;
          const stx = parseNumber(det.txval);
          const si = parseNumber(det.iamt);
          const sc = parseNumber(det.camt);
          const ss = parseNumber(det.samt);
          const scs = parseNumber(det.csamt);
          txval += sign * stx;
          igst += sign * si;
          cgst += sign * sc;
          sgst += sign * ss;
          cess += sign * scs;
        });
      });
    };

    (d.b2b || []).forEach(c => processItems(c.inv, 1));
    (d.b2ba || []).forEach(c => processItems(c.inv, 1));
    (d.b2cl || []).forEach(c => processItems(c.inv, 1));
    (d.b2cla || []).forEach(c => processItems(c.inv, 1));
    (d.b2cs || []).forEach(itm => {
      const stx = parseNumber(itm.txval);
      const si = parseNumber(itm.iamt);
      const sc = parseNumber(itm.camt);
      const ss = parseNumber(itm.samt);
      const scs = parseNumber(itm.csamt);
      txval += stx; igst += si; cgst += sc; sgst += ss; cess += scs;
    });
    (d.b2csa || []).forEach(itm => {
      const stx = parseNumber(itm.txval);
      const si = parseNumber(itm.iamt);
      const sc = parseNumber(itm.camt);
      const ss = parseNumber(itm.samt);
      const scs = parseNumber(itm.csamt);
      txval += stx; igst += si; cgst += sc; sgst += ss; cess += scs;
    });
    (d.cdnr || []).forEach(c => {
      (c.nt || c.inv || []).forEach(nt => {
        const sign = (String(nt.ntty || nt.typ || '').toUpperCase() === 'D') ? 1 : -1;
        processItems([nt], sign);
      });
    });
    (d.cdnra || []).forEach(c => {
      (c.nt || c.inv || []).forEach(nt => {
        const sign = (String(nt.ntty || nt.typ || '').toUpperCase() === 'D') ? 1 : -1;
        processItems([nt], sign);
      });
    });
    (d.cdnur || []).forEach(c => {
      (c.nt || c.inv || []).forEach(nt => {
        const sign = (String(nt.ntty || nt.typ || '').toUpperCase() === 'D') ? 1 : -1;
        processItems([nt], sign);
      });
    });
    (d.cdnura || []).forEach(c => {
      (c.nt || c.inv || []).forEach(nt => {
        const sign = (String(nt.ntty || nt.typ || '').toUpperCase() === 'D') ? 1 : -1;
        processItems([nt], sign);
      });
    });
    (d.exp || []).forEach(c => processItems(c.inv, 1));
    (d.expa || []).forEach(c => processItems(c.inv, 1));

    const tax = igst + cgst + sgst + cess;
    return {
      txval: Math.round(txval * 100) / 100,
      tax: Math.round(tax * 100) / 100,
      igst: Math.round(igst * 100) / 100,
      cgst: Math.round(cgst * 100) / 100,
      sgst: Math.round(sgst * 100) / 100,
      cess: Math.round(cess * 100) / 100
    };
  }

  function parseGstr2bItcTotals(g2bData) {
    if (!g2bData || typeof g2bData !== 'object') {
      return { itc: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };
    }

    const raw = g2bData.data || g2bData;
    const itcsumm = raw.itcsumm || raw.data?.itcsumm;
    const docdata = (raw.data && raw.data.docdata) ? raw.data.docdata : (raw.docdata || raw);

    if (typeof raw.itc === 'number') {
      return { itc: raw.itc, igst: raw.igst || 0, cgst: raw.cgst || 0, sgst: raw.sgst || 0, cess: raw.cess || 0 };
    }

    let igst = 0, cgst = 0, sgst = 0, cess = 0;

    // 1. itcsumm (official ITC summary)
    if (itcsumm && itcsumm.itcavl && typeof itcsumm.itcavl === 'object') {
      Object.entries(itcsumm.itcavl).forEach(([secKey, head]) => {
        if (!head || typeof head !== 'object') return;
        const lk = String(secKey || '').toLowerCase();
        // Part B in GSTR-2B is "othersup" / "others" / "cdnr" / "cdnra" / "crnote" (Credit notes to net off against ITC)
        const isCreditNote = (lk === 'othersup' || lk === 'others' || lk === 'cdnr' || lk === 'cdnra' || lk === 'crnote');
        const sign = isCreditNote ? -1 : 1;

        const hasTopLevel = (head.iamt !== undefined || head.igst !== undefined ||
                             head.camt !== undefined || head.cgst !== undefined ||
                             head.samt !== undefined || head.sgst !== undefined ||
                             head.csamt !== undefined || head.cess !== undefined);

        if (hasTopLevel) {
          igst += sign * parseNumber(head.iamt ?? head.igst);
          cgst += sign * parseNumber(head.camt ?? head.cgst);
          sgst += sign * parseNumber(head.samt ?? head.sgst);
          cess += sign * parseNumber(head.csamt ?? head.cess);
        } else {
          Object.values(head).forEach(sub => {
            if (sub && typeof sub === 'object') {
              igst += sign * parseNumber(sub.iamt ?? sub.igst);
              cgst += sign * parseNumber(sub.camt ?? sub.cgst);
              sgst += sign * parseNumber(sub.samt ?? sub.sgst);
              cess += sign * parseNumber(sub.csamt ?? sub.cess);
            }
          });
        }
      });
    } else if (docdata && typeof docdata === 'object') {
      // 2. Fallback to docdata line items
      ['b2b', 'b2ba', 'isd', 'isda', 'impg', 'impgsez'].forEach(sec => {
        const list = docdata[sec];
        if (Array.isArray(list)) {
          list.forEach(ctinItem => {
            const invs = ctinItem.inv || ctinItem.doclist || [ctinItem];
            invs.forEach(inv => {
              const itcavl = (inv.itcavl === 'Y' || inv.itcavl === true || inv.itcavl === 'YES' || inv.itcavl === 'Yes');
              if (itcavl) {
                const itms = inv.items || inv.itms || [inv];
                itms.forEach(itm => {
                  const det = itm.itm_det || itm;
                  igst += parseNumber(det.iamt ?? det.igst);
                  cgst += parseNumber(det.camt ?? det.cgst);
                  sgst += parseNumber(det.samt ?? det.sgst);
                  cess += parseNumber(det.csamt ?? det.cess);
                });
              }
            });
          });
        }
      });

      ['cdnr', 'cdnra'].forEach(sec => {
        const list = docdata[sec];
        if (Array.isArray(list)) {
          list.forEach(ctinItem => {
            const ntList = ctinItem.nt || ctinItem.inv || [ctinItem];
            ntList.forEach(nt => {
              const itcavl = (nt.itcavl === 'Y' || nt.itcavl === true || nt.itcavl === 'YES' || nt.itcavl === 'Yes');
              if (itcavl) {
                const ntty = String(nt.ntty || nt.typ || '').toUpperCase();
                const sign = (ntty === 'D' || ntty === 'DEBIT') ? 1 : -1;
                const itms = nt.items || nt.itms || [nt];
                itms.forEach(itm => {
                  const det = itm.itm_det || itm;
                  igst += sign * parseNumber(det.iamt ?? det.igst);
                  cgst += sign * parseNumber(det.camt ?? det.cgst);
                  sgst += sign * parseNumber(det.samt ?? det.sgst);
                  cess += sign * parseNumber(det.csamt ?? det.cess);
                });
              }
            });
          });
        }
      });
    }

    const itc = igst + cgst + sgst + cess;
    return {
      itc: Math.round(itc * 100) / 100,
      igst: Math.round(igst * 100) / 100,
      cgst: Math.round(cgst * 100) / 100,
      sgst: Math.round(sgst * 100) / 100,
      cess: Math.round(cess * 100) / 100
    };
  }

  function buildGstr3bConsolidatedWorkbook(periodsData, metadata = {}) {
    const Xlsx = (typeof ReturnPilotXlsx !== 'undefined') ? ReturnPilotXlsx : (typeof require !== 'undefined' ? require('./xlsx-builder.js') : null);
    if (!Xlsx) throw new Error('ReturnPilotXlsx engine is required');

    const wb = Xlsx.createWorkbook();
    if (metadata.email) {
      wb.author = `ReturnPilot Premium (Licensed to ${metadata.email})`;
    }

    const gstin = metadata.gstin || 'GSTIN';
    const finYear = metadata.finYear || 'FY';
    const tradeName = metadata.tradeName || 'Taxpayer';

    // Normalize and sort periods in FY sequence (April to March)
    const sortedPeriodItems = sortPeriodsByFY(periodsData || []);
    const periodDataMap = {};
    const gstr1DataMap = {};
    const gstr2bDataMap = {};
    const periodList = [];

    sortedPeriodItems.forEach(item => {
      const prd = String(item.period || item.ret_period || item.value || '');
      if (!prd) return;
      const d = item.data || item;
      periodDataMap[prd] = d;
      if (item.gstr1Data) {
        gstr1DataMap[prd] = parseGstr1SummaryTotals(item.gstr1Data);
      }
      if (item.gstr2bData) {
        gstr2bDataMap[prd] = parseGstr2bItcTotals(item.gstr2bData);
      }
      periodList.push({
        prd,
        name: formatShortMonth(prd),
        fullName: formatPeriodMonth(prd)
      });
    });

    // ═══════════════════════════════════════════════════════════════════════════════
    // SHEET 1: EXECUTIVE SUMMARY
    // ═══════════════════════════════════════════════════════════════════════════════
    const execHeaders = ['Audit Parameter / Statutory Metric', 'Consolidated FY Value', 'Notes / Statutory Reference'];
    const execRows = [];

    let totOutTaxable = 0;
    let totIgst = 0;
    let totCgst = 0;
    let totSgst = 0;
    let totCess = 0;
    let totRcmTaxable = 0;
    let totRcmTax = 0;
    let totItcNet = 0;
    let totCashPaid = 0;
    let totItcPaid = 0;
    let totLateFee = 0;
    let totInterest = 0;

    periodList.forEach(p => {
      const d = periodDataMap[p.prd] || {};
      const sup = d.sup_details?.osup_det || {};
      totOutTaxable += parseNumber(sup.txval);
      totIgst += parseNumber(sup.iamt);
      totCgst += parseNumber(sup.camt);
      totSgst += parseNumber(sup.samt);
      totCess += parseNumber(sup.csamt);

      const rcm = d.sup_details?.isup_rev || {};
      totRcmTaxable += parseNumber(rcm.txval);
      totRcmTax += (parseNumber(rcm.iamt) + parseNumber(rcm.camt) + parseNumber(rcm.samt) + parseNumber(rcm.csamt));

      const itcNet = d.itc_elg?.itc_net || {};
      totItcNet += (parseNumber(itcNet.iamt) + parseNumber(itcNet.camt) + parseNumber(itcNet.samt) + parseNumber(itcNet.csamt));

      const tt = d.tt_val || {};
      totCashPaid += parseNumber(tt.tt_csh_pd);
      totItcPaid += parseNumber(tt.tt_itc_pd);

      const lt = d.intr_ltfee?.ltfee_details || {};
      totLateFee += (parseNumber(lt.camt) + parseNumber(lt.samt));

      const intr = d.intr_ltfee?.intr_details || {};
      totInterest += (parseNumber(intr.iamt) + parseNumber(intr.camt) + parseNumber(intr.samt) + parseNumber(intr.csamt));
    });

    const totOutputTax = totIgst + totCgst + totSgst + totCess;

    let totG1Sales = 0;
    let totG1Tax = 0;
    let totG2bItc = 0;

    periodList.forEach(p => {
      const g1 = gstr1DataMap[p.prd];
      if (g1) {
        totG1Sales += parseNumber(g1.txval);
        totG1Tax += parseNumber(g1.tax);
      }
      const g2b = gstr2bDataMap[p.prd];
      if (g2b) {
        totG2bItc += parseNumber(g2b.itc);
      }
    });

    const makeSpacer = () => {
      const sp = ['', '', ''];
      sp.__isSpacer = true;
      return sp;
    };

    const makeHeader = (title) => {
      const hd = [title, '', ''];
      hd.__isSectionHeader = true;
      return hd;
    };

    execRows.push(['Company GSTIN', gstin, 'Official GST Portal Context']);
    execRows.push(['Taxpayer Trade Name', tradeName, 'Registered Business Name']);
    execRows.push(['Financial Year', finYear, 'Consolidated Multi-Period Scope']);
    execRows.push(['Return Type', 'Form GSTR-3B Consolidated Master', 'Self-Assessed Summary Return (CGST Sec 39)']);
    execRows.push(['Total Periods Processed', `${periodList.length} Return Periods`, 'Auto-compiled by ReturnPilot Premium']);
    
    execRows.push(makeSpacer());
    execRows.push(makeHeader('SECTION A: ANNUAL TURNOVER & TAX LIABILITY (GSTR-3B)'));

    execRows.push(['Total Outward Taxable Turnover (₹)', totOutTaxable, 'Table 3.1(a) Outward Taxable Supplies']);
    execRows.push(['Total Integrated Tax (IGST) Liability (₹)', totIgst, 'Table 3.1(a) IGST']);
    execRows.push(['Total Central Tax (CGST) Liability (₹)', totCgst, 'Table 3.1(a) CGST']);
    execRows.push(['Total State/UT Tax (SGST) Liability (₹)', totSgst, 'Table 3.1(a) SGST']);
    execRows.push(['Total Cess Liability (₹)', totCess, 'Table 3.1(a) Cess']);
    
    const sumOutTax = ['Total Output Tax Liability (₹)', totOutputTax, 'Sum of Outward IGST + CGST + SGST + Cess'];
    sumOutTax.__isSummary = true;
    execRows.push(sumOutTax);

    if (totRcmTaxable !== 0 || totRcmTax !== 0) {
      execRows.push(['Total Inward RCM Taxable Value (₹)', totRcmTaxable, 'Table 3.1(d) Inward supplies liable to RCM']);
      execRows.push(['Total Inward RCM Tax Liability (₹)', totRcmTax, 'Must be discharged in cash']);
    }

    execRows.push(makeSpacer());
    execRows.push(makeHeader('SECTION B: ANNUAL INPUT TAX CREDIT (ITC) (GSTR-3B)'));

    const sumItc = ['Total Net ITC Claimed (₹)', totItcNet, 'Table 4(C) Net ITC Available (4A - 4B)'];
    sumItc.__isSummary = true;
    execRows.push(sumItc);

    execRows.push(makeSpacer());
    execRows.push(makeHeader('SECTION C: TAX PAYMENT & DISCHARGE BREAKDOWN'));

    execRows.push(['Total Tax Discharged via Credit Ledger (ITC) (₹)', totItcPaid, 'Table 6.1 Paid through ITC']);
    execRows.push(['Total Tax Discharged via Cash Ledger (₹)', totCashPaid, 'Table 6.1 Paid in Cash']);
    execRows.push(['Total Late Fees Paid (₹)', totLateFee, 'Table 5.1 Late Fees (CGST + SGST)']);
    execRows.push(['Total Interest Paid (₹)', totInterest, 'Table 5.1 Interest']);

    // Closing balances from latest period
    if (periodList.length > 0) {
      const lastPrdObj = periodList[periodList.length - 1];
      const lastData = periodDataMap[lastPrdObj.prd] || {};
      const itcBal = lastData.taxpayble?.bal?.itc_bal || {};

      execRows.push(makeSpacer());
      execRows.push(makeHeader(`SECTION D: CLOSING ELECTRONIC LEDGER BALANCES (As of ${lastPrdObj.name})`));

      execRows.push(['Electronic Credit Ledger - IGST Balance (₹)', parseNumber(itcBal.igst_bal), 'Portal Credit Ledger']);
      execRows.push(['Electronic Credit Ledger - CGST Balance (₹)', parseNumber(itcBal.cgst_bal), 'Portal Credit Ledger']);
      execRows.push(['Electronic Credit Ledger - SGST Balance (₹)', parseNumber(itcBal.sgst_bal), 'Portal Credit Ledger']);
      const totLedgerBal = parseNumber(itcBal.igst_bal) + parseNumber(itcBal.cgst_bal) + parseNumber(itcBal.sgst_bal);
      const sumLedger = ['Total Electronic Credit Ledger Balance (₹)', totLedgerBal, 'Available balance in Credit Ledger'];
      sumLedger.__isSummary = true;
      execRows.push(sumLedger);
    }

    // SECTION E: CROSS-RETURN AUDIT RECONCILIATION SUMMARY
    execRows.push(makeSpacer());
    execRows.push(makeHeader('SECTION E: ANNUAL AUDIT RECONCILIATION BENCHMARK (3B vs 1 vs 2B)'));
    execRows.push(['Consolidated GSTR-3B Outward Taxable Turnover (₹)', totOutTaxable, 'Self-Assessed Outward Sales declared in 3B']);
    execRows.push(['Consolidated GSTR-1 Outward Taxable Turnover (₹)', totG1Sales, 'Statement of Outward Supplies filed in GSTR-1']);
    const turnoverVar = Math.round((totOutTaxable - totG1Sales) * 100) / 100;
    const toVarRow = ['Annual Turnover Variance (3B - 1) (₹)', turnoverVar, Math.abs(turnoverVar) > 1 ? '⚠️ Outward Turnover Variance detected' : '✓ 100% Turnover Match'];
    toVarRow.__isSummary = true;
    execRows.push(toVarRow);

    execRows.push(['Consolidated GSTR-3B Output Tax Liability (₹)', totOutputTax, 'Self-Assessed Output Tax declared in 3B']);
    execRows.push(['Consolidated GSTR-1 Output Tax Liability (₹)', totG1Tax, 'Output Tax Liability declared in GSTR-1']);
    const taxVar = Math.round((totOutputTax - totG1Tax) * 100) / 100;
    const taxVarRow = ['Annual Output Tax Variance (3B - 1) (₹)', taxVar, Math.abs(taxVar) > 1 ? '⚠️ Output Tax Variance detected' : '✓ 100% Tax Match'];
    taxVarRow.__isSummary = true;
    execRows.push(taxVarRow);

    execRows.push(['Consolidated GSTR-3B Net ITC Claimed (₹)', totItcNet, 'Table 4(C) Net ITC claimed in 3B']);
    execRows.push(['Consolidated GSTR-2B Net ITC Available (₹)', totG2bItc, 'Net Eligible ITC auto-drafted in Form GSTR-2B']);
    const itcVar = Math.round((totItcNet - totG2bItc) * 100) / 100;
    const itcVarRow = ['Annual ITC Variance (3B - 2B) (₹)', itcVar, Math.abs(itcVar) > 1 ? '⚠️ ITC Variance detected (Rule 88D compliance risk)' : '✓ 100% ITC Match'];
    itcVarRow.__isSummary = true;
    execRows.push(itcVarRow);

    wb.addSheet('Executive Summary', execHeaders, execRows, {
      tabColor: '1E3A8A',
      columnWidths: [52, 30, 50]
    });

    // ═══════════════════════════════════════════════════════════════════════════════
    // SHEET 2: MONTHLY COMPARATIVE MATRIX (GSTR-9 PREPARATION STANDARD)
    // ═══════════════════════════════════════════════════════════════════════════════
    const matrixHeaders = ['GSTR-3B Statutory Head', 'Table Ref', ...periodList.map(p => p.name), 'Consolidated FY Total'];
    const matrixRows = [];

    function makeMatrixRow(title, tableCode, extractorFn) {
      let sum = 0;
      const vals = periodList.map(p => {
        const d = periodDataMap[p.prd];
        const val = d ? parseNumber(extractorFn(d)) : 0;
        sum += val;
        return val;
      });
      return [title, tableCode, ...vals, Math.round(sum * 100) / 100];
    }

    const makeMatrixSpacer = () => {
      const sp = ['', '', ...periodList.map(() => ''), ''];
      sp.__isSpacer = true;
      return sp;
    };

    const makeMatrixSectionHeader = (title) => {
      const hd = [title, '', ...periodList.map(() => ''), ''];
      hd.__isSectionHeader = true;
      return hd;
    };

    // 1. Table 3.1 Outward Turnover
    matrixRows.push(makeMatrixSectionHeader('TABLE 3.1: DETAILS OF OUTWARD SUPPLIES & INWARD RCM'));
    matrixRows.push(makeMatrixRow('Outward Taxable Supplies (Taxable Value)', '3.1(a)', d => d.sup_details?.osup_det?.txval));
    matrixRows.push(makeMatrixRow('Outward Taxable Supplies - Integrated Tax (IGST)', '3.1(a)', d => d.sup_details?.osup_det?.iamt));
    matrixRows.push(makeMatrixRow('Outward Taxable Supplies - Central Tax (CGST)', '3.1(a)', d => d.sup_details?.osup_det?.camt));
    matrixRows.push(makeMatrixRow('Outward Taxable Supplies - State/UT Tax (SGST)', '3.1(a)', d => d.sup_details?.osup_det?.samt));
    matrixRows.push(makeMatrixRow('Outward Taxable Supplies - Cess', '3.1(a)', d => d.sup_details?.osup_det?.csamt));
    matrixRows.push(makeMatrixRow('Zero Rated Supplies (Exports/SEZ) - Taxable Value', '3.1(b)', d => d.sup_details?.osup_zero?.txval));
    matrixRows.push(makeMatrixRow('Zero Rated Supplies - Integrated Tax (IGST)', '3.1(b)', d => d.sup_details?.osup_zero?.iamt));
    matrixRows.push(makeMatrixRow('Nil Rated & Exempted Supplies - Taxable Value', '3.1(c)', d => d.sup_details?.osup_nil_exmp?.txval));
    matrixRows.push(makeMatrixRow('Inward Supplies Liable to Reverse Charge (RCM) - Taxable Value', '3.1(d)', d => d.sup_details?.isup_rev?.txval));
    matrixRows.push(makeMatrixRow('Inward RCM - Integrated Tax (IGST)', '3.1(d)', d => d.sup_details?.isup_rev?.iamt));
    matrixRows.push(makeMatrixRow('Inward RCM - Central Tax (CGST)', '3.1(d)', d => d.sup_details?.isup_rev?.camt));
    matrixRows.push(makeMatrixRow('Inward RCM - State/UT Tax (SGST)', '3.1(d)', d => d.sup_details?.isup_rev?.samt));
    matrixRows.push(makeMatrixRow('Non-GST Outward Supplies - Taxable Value', '3.1(e)', d => d.sup_details?.osup_nongst?.txval));

    // Subtotal Output Tax
    const subTotTaxRow = makeMatrixRow('Total Outward Tax Liability (IGST+CGST+SGST+Cess)', '3.1 Total', d => {
      const s = d.sup_details?.osup_det || {};
      return parseNumber(s.iamt) + parseNumber(s.camt) + parseNumber(s.samt) + parseNumber(s.csamt);
    });
    subTotTaxRow.__isSummary = true;
    matrixRows.push(subTotTaxRow);

    // 2. Table 3.1.1 ECO
    matrixRows.push(makeMatrixSpacer());
    matrixRows.push(makeMatrixSectionHeader('TABLE 3.1.1: SUPPLIES UNDER SEC 9(5) (ECO)'));
    matrixRows.push(makeMatrixRow('Taxable supplies on which ECO pays tax (Sec 9(5))', '3.1.1(i)', d => d.eco_dtls?.eco_sup?.txval));
    matrixRows.push(makeMatrixRow('Supplies made through ECO by taxpayer', '3.1.1(ii)', d => d.eco_dtls?.eco_reg_sup?.txval));

    // 3. Table 4 Eligible ITC
    matrixRows.push(makeMatrixSpacer());
    matrixRows.push(makeMatrixSectionHeader('TABLE 4: ELIGIBLE INPUT TAX CREDIT (ITC) & REVERSALS'));
    function getItcVal(d, head, code, field) {
      const arr = d.itc_elg?.[head] || [];
      const item = arr.find(x => x.ty === code);
      return item ? parseNumber(item[field]) : 0;
    }
    matrixRows.push(makeMatrixRow('4(A)(1) Import of Goods - IGST', '4(A)(1)', d => getItcVal(d, 'itc_avl', 'IMPG', 'iamt')));
    matrixRows.push(makeMatrixRow('4(A)(2) Import of Services - IGST', '4(A)(2)', d => getItcVal(d, 'itc_avl', 'IMPS', 'iamt')));
    matrixRows.push(makeMatrixRow('4(A)(3) Inward RCM - IGST', '4(A)(3)', d => getItcVal(d, 'itc_avl', 'ISRC', 'iamt')));
    matrixRows.push(makeMatrixRow('4(A)(3) Inward RCM - CGST', '4(A)(3)', d => getItcVal(d, 'itc_avl', 'ISRC', 'camt')));
    matrixRows.push(makeMatrixRow('4(A)(3) Inward RCM - SGST', '4(A)(3)', d => getItcVal(d, 'itc_avl', 'ISRC', 'samt')));
    matrixRows.push(makeMatrixRow('4(A)(4) Inward ISD - IGST', '4(A)(4)', d => getItcVal(d, 'itc_avl', 'ISD', 'iamt')));
    matrixRows.push(makeMatrixRow('4(A)(5) All Other ITC - IGST', '4(A)(5)', d => getItcVal(d, 'itc_avl', 'OTH', 'iamt')));
    matrixRows.push(makeMatrixRow('4(A)(5) All Other ITC - CGST', '4(A)(5)', d => getItcVal(d, 'itc_avl', 'OTH', 'camt')));
    matrixRows.push(makeMatrixRow('4(A)(5) All Other ITC - SGST', '4(A)(5)', d => getItcVal(d, 'itc_avl', 'OTH', 'samt')));

    // Reversals
    matrixRows.push(makeMatrixRow('4(B)(1) ITC Reversal (Rules 38,42,43 & Sec 17(5)) - IGST', '4(B)(1)', d => getItcVal(d, 'itc_rev', 'RUL', 'iamt')));
    matrixRows.push(makeMatrixRow('4(B)(1) ITC Reversal (Rules 38,42,43 & Sec 17(5)) - CGST', '4(B)(1)', d => getItcVal(d, 'itc_rev', 'RUL', 'camt')));
    matrixRows.push(makeMatrixRow('4(B)(1) ITC Reversal (Rules 38,42,43 & Sec 17(5)) - SGST', '4(B)(1)', d => getItcVal(d, 'itc_rev', 'RUL', 'samt')));
    matrixRows.push(makeMatrixRow('4(B)(2) Others ITC Reversal - IGST', '4(B)(2)', d => getItcVal(d, 'itc_rev', 'OTH', 'iamt')));
    matrixRows.push(makeMatrixRow('4(B)(2) Others ITC Reversal - CGST', '4(B)(2)', d => getItcVal(d, 'itc_rev', 'OTH', 'camt')));
    matrixRows.push(makeMatrixRow('4(B)(2) Others ITC Reversal - SGST', '4(B)(2)', d => getItcVal(d, 'itc_rev', 'OTH', 'samt')));

    // Net ITC 4(C)
    const netItcRow = makeMatrixRow('4(C) Net ITC Available (IGST+CGST+SGST+Cess)', '4(C)', d => {
      const n = d.itc_elg?.itc_net || {};
      return parseNumber(n.iamt) + parseNumber(n.camt) + parseNumber(n.samt) + parseNumber(n.csamt);
    });
    netItcRow.__isSummary = true;
    matrixRows.push(netItcRow);

    // Ineligible 4(D)
    matrixRows.push(makeMatrixRow('4(D)(1) Ineligible ITC (Sec 17(5)) - IGST', '4(D)(1)', d => getItcVal(d, 'itc_inelg', 'RUL', 'iamt')));
    matrixRows.push(makeMatrixRow('4(D)(2) Others Ineligible - IGST', '4(D)(2)', d => getItcVal(d, 'itc_inelg', 'OTH', 'iamt')));

    // 4. Table 5.1 Interest & Late Fee
    matrixRows.push(makeMatrixSpacer());
    matrixRows.push(makeMatrixSectionHeader('TABLE 5.1: INTEREST & LATE FEES'));
    matrixRows.push(makeMatrixRow('Interest Payable / Paid (Total)', '5.1', d => {
      const in_ = d.intr_ltfee?.intr_details || {};
      return parseNumber(in_.iamt) + parseNumber(in_.camt) + parseNumber(in_.samt) + parseNumber(in_.csamt);
    }));
    matrixRows.push(makeMatrixRow('Late Fee (CGST + SGST)', '5.1', d => {
      const lt = d.intr_ltfee?.ltfee_details || {};
      return parseNumber(lt.camt) + parseNumber(lt.samt);
    }));

    // 5. Table 6.1 Payment
    matrixRows.push(makeMatrixSpacer());
    matrixRows.push(makeMatrixSectionHeader('TABLE 6.1: PAYMENT OF TAX & LEDGER UTILIZATION'));
    matrixRows.push(makeMatrixRow('Tax Paid through ITC (Credit Ledger)', '6.1', d => d.tt_val?.tt_itc_pd));
    matrixRows.push(makeMatrixRow('Tax Paid through Cash (Cash Ledger)', '6.1', d => d.tt_val?.tt_csh_pd));
    const totalDischargedRow = makeMatrixRow('Total Tax Discharged (Cash + ITC)', '6.1 Total', d => {
      return parseNumber(d.tt_val?.tt_itc_pd) + parseNumber(d.tt_val?.tt_csh_pd);
    });
    totalDischargedRow.__isSummary = true;
    matrixRows.push(totalDischargedRow);

    wb.addSheet('Comparative Matrix (GSTR-9)', matrixHeaders, matrixRows, {
      tabColor: '059669',
      freezeColumns: 2,
      columnWidths: [52, 12, ...periodList.map(() => 18), 22]
    });

    // ═══════════════════════════════════════════════════════════════════════════════
    // SHEET 3: TABLE 3.1 & 3.1.1 OUTWARD SUPPLIES
    // ═══════════════════════════════════════════════════════════════════════════════
    const t31Headers = [
      'Tax Period', 'Month', 'Section', 'Description', 
      'Taxable Value (₹)', 'IGST (₹)', 'CGST (₹)', 'SGST (₹)', 'Cess (₹)', 'Total Tax (₹)'
    ];
    const t31Rows = [];

    periodList.forEach(p => {
      const d = periodDataMap[p.prd];
      if (!d) return;

      const sections = [
        { code: '3.1(a)', name: 'Outward Taxable Supplies', key: 'osup_det' },
        { code: '3.1(b)', name: 'Zero Rated Supplies (Exports/SEZ)', key: 'osup_zero' },
        { code: '3.1(c)', name: 'Other Outward Supplies (Nil/Exempt)', key: 'osup_nil_exmp' },
        { code: '3.1(d)', name: 'Inward Supplies (Reverse Charge - RCM)', key: 'isup_rev' },
        { code: '3.1(e)', name: 'Non-GST Outward Supplies', key: 'osup_nongst' }
      ];

      sections.forEach(s => {
        const item = d.sup_details?.[s.key];
        if (item) {
          const tx = parseNumber(item.txval);
          const i = parseNumber(item.iamt);
          const c = parseNumber(item.camt);
          const sg = parseNumber(item.samt);
          const cs = parseNumber(item.csamt);
          const tot = i + c + sg + cs;
          if (tx !== 0 || tot !== 0) {
            t31Rows.push([p.prd, p.name, s.code, s.name, tx, i, c, sg, cs, tot]);
          }
        }
      });

      // ECO
      const ecoSup = d.eco_dtls?.eco_sup;
      if (ecoSup && (parseNumber(ecoSup.txval) !== 0 || parseNumber(ecoSup.iamt) !== 0)) {
        const tx = parseNumber(ecoSup.txval);
        const i = parseNumber(ecoSup.iamt);
        const c = parseNumber(ecoSup.camt);
        const sg = parseNumber(ecoSup.samt);
        const cs = parseNumber(ecoSup.csamt);
        t31Rows.push([p.prd, p.name, '3.1.1(i)', 'Supplies on which ECO pays tax', tx, i, c, sg, cs, i + c + sg + cs]);
      }
      const ecoReg = d.eco_dtls?.eco_reg_sup;
      if (ecoReg && parseNumber(ecoReg.txval) !== 0) {
        t31Rows.push([p.prd, p.name, '3.1.1(ii)', 'Supplies made through ECO by taxpayer', parseNumber(ecoReg.txval), 0, 0, 0, 0, 0]);
      }
    });

    if (t31Rows.length > 0) {
      const lastRow = t31Rows.length + 1; // row 1 header
      const sp = ['', '', '', '', '', '', '', '', '', ''];
      sp.__isSpacer = true;
      t31Rows.push(sp);

      let sumTx = 0, sumI = 0, sumC = 0, sumS = 0, sumCs = 0, sumTot = 0;
      t31Rows.slice(0, -1).forEach(r => {
        sumTx += parseNumber(r[4]);
        sumI += parseNumber(r[5]);
        sumC += parseNumber(r[6]);
        sumS += parseNumber(r[7]);
        sumCs += parseNumber(r[8]);
        sumTot += parseNumber(r[9]);
      });

      const grandTotRow = [
        'TOTAL', 'Consolidated FY', '3.1 Total', 'Total Outward Supplies & Liabilities',
        { f: `SUM(E2:E${lastRow})`, v: Math.round(sumTx * 100) / 100 },
        { f: `SUM(F2:F${lastRow})`, v: Math.round(sumI * 100) / 100 },
        { f: `SUM(G2:G${lastRow})`, v: Math.round(sumC * 100) / 100 },
        { f: `SUM(H2:H${lastRow})`, v: Math.round(sumS * 100) / 100 },
        { f: `SUM(I2:I${lastRow})`, v: Math.round(sumCs * 100) / 100 },
        { f: `SUM(J2:J${lastRow})`, v: Math.round(sumTot * 100) / 100 }
      ];
      grandTotRow.__isSummary = true;
      t31Rows.push(grandTotRow);
    }

    wb.addSheet('Table 3.1 & 3.1.1 Outward', t31Headers, t31Rows, {
      tabColor: '2563EB',
      freezeColumns: 2,
      columnWidths: [16, 16, 14, 45, 22, 18, 18, 18, 16, 22]
    });

    // ═══════════════════════════════════════════════════════════════════════════════
    // SHEET 4: TABLE 4 ELIGIBLE ITC & REVERSALS
    // ═══════════════════════════════════════════════════════════════════════════════
    const t4Headers = [
      'Tax Period', 'Month', 'ITC Head', 'Type Code', 'Description', 
      'IGST (₹)', 'CGST (₹)', 'SGST (₹)', 'Cess (₹)', 'Total ITC (₹)'
    ];
    const t4Rows = [];

    periodList.forEach((p, pIdx) => {
      const d = periodDataMap[p.prd];
      if (!d || !d.itc_elg) return;

      const avl = d.itc_elg.itc_avl || [];
      avl.forEach(item => {
        const i = parseNumber(item.iamt);
        const c = parseNumber(item.camt);
        const s = parseNumber(item.samt);
        const cs = parseNumber(item.csamt);
        const tot = i + c + s + cs;
        if (tot !== 0) {
          t4Rows.push([p.prd, p.name, '4(A) ITC Available', item.ty, TYPE_NAMES[item.ty] || item.ty, i, c, s, cs, tot]);
        }
      });

      const rev = d.itc_elg.itc_rev || [];
      rev.forEach(item => {
        const i = parseNumber(item.iamt);
        const c = parseNumber(item.camt);
        const s = parseNumber(item.samt);
        const cs = parseNumber(item.csamt);
        const tot = i + c + s + cs;
        if (tot !== 0) {
          t4Rows.push([p.prd, p.name, '4(B) ITC Reversed', item.ty, TYPE_NAMES[item.ty] || item.ty, i, c, s, cs, tot]);
        }
      });

      const inelg = d.itc_elg.itc_inelg || [];
      inelg.forEach(item => {
        const i = parseNumber(item.iamt);
        const c = parseNumber(item.camt);
        const s = parseNumber(item.samt);
        const cs = parseNumber(item.csamt);
        const tot = i + c + s + cs;
        if (tot !== 0) {
          t4Rows.push([p.prd, p.name, '4(D) Ineligible ITC', item.ty, TYPE_NAMES[item.ty] || item.ty, i, c, s, cs, tot]);
        }
      });

      // Net Row
      const net = d.itc_elg.itc_net || {};
      const ni = parseNumber(net.iamt);
      const nc = parseNumber(net.camt);
      const ns = parseNumber(net.samt);
      const ncs = parseNumber(net.csamt);
      const ntot = ni + nc + ns + ncs;
      if (ntot !== 0) {
        const netRow = [p.prd, p.name, '4(C) NET ITC', 'NET', 'Net ITC Available (4A - 4B)', ni, nc, ns, ncs, ntot];
        netRow.__isSummary = true;
        t4Rows.push(netRow);
      }

      if (pIdx < periodList.length - 1) {
        const sp = ['', '', '', '', '', '', '', '', '', ''];
        sp.__isSpacer = true;
        t4Rows.push(sp);
      }
    });

    if (t4Rows.length > 0) {
      const sp = ['', '', '', '', '', '', '', '', '', ''];
      sp.__isSpacer = true;
      t4Rows.push(sp);

      let totNetI = 0, totNetC = 0, totNetS = 0, totNetCs = 0;
      periodList.forEach(p => {
        const net = periodDataMap[p.prd]?.itc_elg?.itc_net || {};
        totNetI += parseNumber(net.iamt);
        totNetC += parseNumber(net.camt);
        totNetS += parseNumber(net.samt);
        totNetCs += parseNumber(net.csamt);
      });
      const totNetTot = totNetI + totNetC + totNetS + totNetCs;

      const grandTotRow = [
        'TOTAL', 'Consolidated FY', '4(C) NET ITC', 'NET', 'Total Cumulative Net ITC Available (FY)',
        Math.round(totNetI * 100) / 100,
        Math.round(totNetC * 100) / 100,
        Math.round(totNetS * 100) / 100,
        Math.round(totNetCs * 100) / 100,
        Math.round(totNetTot * 100) / 100
      ];
      grandTotRow.__isSummary = true;
      t4Rows.push(grandTotRow);
    }

    wb.addSheet('Table 4 Eligible ITC', t4Headers, t4Rows, {
      tabColor: '10B981',
      freezeColumns: 2,
      columnWidths: [16, 16, 24, 14, 42, 18, 18, 18, 16, 22]
    });

    // ═══════════════════════════════════════════════════════════════════════════════
    // SHEET 5: TABLE 6.1 PAYMENT & CROSS-UTILIZATION LEDGER
    // ═══════════════════════════════════════════════════════════════════════════════
    const t61Headers = [
      'Tax Period', 'Month', 'Debit Entry ID', 'Transaction Date', 'Liability ID',
      'IGST Paid via IGST Credit', 'IGST Paid via CGST Credit', 'IGST Paid via SGST Credit',
      'CGST Paid via CGST Credit', 'CGST Paid via IGST Credit',
      'SGST Paid via SGST Credit', 'SGST Paid via IGST Credit',
      'Cess Paid via Cess Credit', 'Paid via Cash (Tax)', 'Total Tax Discharged (₹)'
    ];
    const t61Rows = [];

    periodList.forEach(p => {
      const d = periodDataMap[p.prd];
      if (!d) return;

      const rcl = d.taxpayble?.returnsDbCdredList;
      const tpd = (rcl && typeof rcl === 'object') ? rcl.tax_paid : null;
      const itcEntries = (tpd && Array.isArray(tpd.pd_by_itc)) ? tpd.pd_by_itc : [];
      const cashEntries = (tpd && Array.isArray(tpd.pd_by_cash)) ? tpd.pd_by_cash : [];

      itcEntries.forEach(item => {
        const ii = parseNumber(item.igst_igst_amt);
        const ic = parseNumber(item.igst_cgst_amt);
        const is = parseNumber(item.igst_sgst_amt);
        const cc = parseNumber(item.cgst_cgst_amt);
        const ci = parseNumber(item.cgst_igst_amt);
        const ss = parseNumber(item.sgst_sgst_amt);
        const si = parseNumber(item.sgst_igst_amt);
        const cess = parseNumber(item.cess_cess_amt);
        const tot = ii + ic + is + cc + ci + ss + si + cess;

        t61Rows.push([
          p.prd, p.name, item.debit_id || '-', item.trandate || '-', item.liab_id || '-',
          ii, ic, is, cc, ci, ss, si, cess, 0, tot
        ]);
      });

      cashEntries.forEach(item => {
        const tot = parseNumber(item.tx_pd) || (parseNumber(item.iamt) + parseNumber(item.camt) + parseNumber(item.samt) + parseNumber(item.csamt));
        t61Rows.push([
          p.prd, p.name, item.debit_id || 'CASH-CHALLAN', item.trandate || '-', item.liab_id || '-',
          0, 0, 0, 0, 0, 0, 0, 0, tot, tot
        ]);
      });
    });

    if (t61Rows.length > 0) {
      const lastRow = t61Rows.length + 1;
      const sp = ['', '', '', '', '', '', '', '', '', '', '', '', '', '', ''];
      sp.__isSpacer = true;
      t61Rows.push(sp);

      const grandTotRow = [
        'TOTAL', 'Consolidated FY', '-', '-', 'Total Discharged',
        { f: `SUM(F2:F${lastRow})`, v: 0 },
        { f: `SUM(G2:G${lastRow})`, v: 0 },
        { f: `SUM(H2:H${lastRow})`, v: 0 },
        { f: `SUM(I2:I${lastRow})`, v: 0 },
        { f: `SUM(J2:J${lastRow})`, v: 0 },
        { f: `SUM(K2:K${lastRow})`, v: 0 },
        { f: `SUM(L2:L${lastRow})`, v: 0 },
        { f: `SUM(M2:M${lastRow})`, v: 0 },
        { f: `SUM(N2:N${lastRow})`, v: 0 },
        { f: `SUM(O2:O${lastRow})`, v: 0 }
      ];

      for (let c = 5; c <= 14; c++) {
        let colSum = 0;
        t61Rows.slice(0, -1).forEach(r => {
          colSum += parseNumber(r[c]);
        });
        grandTotRow[c].v = Math.round(colSum * 100) / 100;
      }
      grandTotRow.__isSummary = true;
      t61Rows.push(grandTotRow);
    }

    wb.addSheet('Table 6.1 Payment & Ledgers', t61Headers, t61Rows, {
      tabColor: '7C3AED',
      freezeColumns: 2,
      columnWidths: [16, 16, 20, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 22]
    });

    // ═══════════════════════════════════════════════════════════════════════════════
    // SHEET 6: TABLE 5.1 INTEREST & LATE FEES
    // ═══════════════════════════════════════════════════════════════════════════════
    const t51Headers = [
      'Tax Period', 'Month', 
      'Late Fee CGST (₹)', 'Late Fee SGST (₹)', 'Total Late Fee (₹)',
      'Interest IGST (₹)', 'Interest CGST (₹)', 'Interest SGST (₹)', 'Interest Cess (₹)', 'Total Interest (₹)',
      'Total Charges (₹)'
    ];
    const t51Rows = [];

    periodList.forEach(p => {
      const d = periodDataMap[p.prd];
      if (!d) return;

      const lt = d.intr_ltfee?.ltfee_details || {};
      const in_ = d.intr_ltfee?.intr_details || {};

      const lfc = parseNumber(lt.camt);
      const lfs = parseNumber(lt.samt);
      const ltot = lfc + lfs;

      const ii = parseNumber(in_.iamt);
      const ic = parseNumber(in_.camt);
      const is = parseNumber(in_.samt);
      const ics = parseNumber(in_.csamt);
      const itot = ii + ic + is + ics;

      t51Rows.push([
        p.prd, p.name, lfc, lfs, ltot, ii, ic, is, ics, itot, ltot + itot
      ]);
    });

    if (t51Rows.length > 0) {
      const lastRow = t51Rows.length + 1;
      const sp = ['', '', '', '', '', '', '', '', '', '', ''];
      sp.__isSpacer = true;
      t51Rows.push(sp);

      const grandTotRow = [
        'TOTAL', 'Consolidated FY',
        { f: `SUM(C2:C${lastRow})`, v: 0 },
        { f: `SUM(D2:D${lastRow})`, v: 0 },
        { f: `SUM(E2:E${lastRow})`, v: 0 },
        { f: `SUM(F2:F${lastRow})`, v: 0 },
        { f: `SUM(G2:G${lastRow})`, v: 0 },
        { f: `SUM(H2:H${lastRow})`, v: 0 },
        { f: `SUM(I2:I${lastRow})`, v: 0 },
        { f: `SUM(J2:J${lastRow})`, v: 0 },
        { f: `SUM(K2:K${lastRow})`, v: 0 }
      ];

      for (let c = 2; c <= 10; c++) {
        let colSum = 0;
        t51Rows.slice(0, -1).forEach(r => {
          colSum += parseNumber(r[c]);
        });
        grandTotRow[c].v = Math.round(colSum * 100) / 100;
      }
      grandTotRow.__isSummary = true;
      t51Rows.push(grandTotRow);
    }

    wb.addSheet('Table 5.1 Interest & Late Fees', t51Headers, t51Rows, {
      tabColor: 'D97706',
      freezeColumns: 2,
      columnWidths: [16, 16, 18, 18, 20, 18, 18, 18, 18, 20, 22]
    });

    // ═══════════════════════════════════════════════════════════════════════════════
    // SHEET 7: AUDIT RECONCILIATION ANCHOR (3B vs 1 vs 2B)
    // ═══════════════════════════════════════════════════════════════════════════════
    const reconHeaders = [
      'Tax Period', 'Month', 
      'GSTR-3B Taxable Sales (₹)', 'GSTR-1 Taxable Sales (₹)', 'Sales Variance (3B - 1) (₹)',
      'GSTR-3B Output Tax (₹)', 'GSTR-1 Output Tax (₹)', 'Tax Variance (3B - 1) (₹)',
      'GSTR-3B Net ITC Claimed (₹)', 'GSTR-2B Net ITC Available (₹)', 'ITC Variance (3B - 2B) (₹)',
      'Audit Risk Flag'
    ];
    const reconRows = [];

    periodList.forEach((p, idx) => {
      const d = periodDataMap[p.prd];
      const sup = d?.sup_details?.osup_det || {};
      const tx = parseNumber(sup.txval);
      const tax = parseNumber(sup.iamt) + parseNumber(sup.camt) + parseNumber(sup.samt) + parseNumber(sup.csamt);

      const net = d?.itc_elg?.itc_net || {};
      const itc = parseNumber(net.iamt) + parseNumber(net.camt) + parseNumber(net.samt) + parseNumber(net.csamt);

      const g1 = gstr1DataMap[p.prd];
      const g1Sales = g1 ? parseNumber(g1.txval) : 0;
      const g1Tax = g1 ? parseNumber(g1.tax) : 0;

      const g2b = gstr2bDataMap[p.prd];
      const g2bItc = g2b ? parseNumber(g2b.itc) : 0;

      // Formulas for variances
      const rIdx = idx + 2;
      const salesVarVal = Math.round((tx - g1Sales) * 100) / 100;
      const taxVarVal = Math.round((tax - g1Tax) * 100) / 100;
      const itcVarVal = Math.round((itc - g2bItc) * 100) / 100;
      const mismatch = (Math.abs(salesVarVal) > 1 || Math.abs(taxVarVal) > 1 || Math.abs(itcVarVal) > 1);
      const flagVal = mismatch ? '⚠️ Mismatch' : '✓ Matched';

      const salesVarFormula = { f: `C${rIdx}-D${rIdx}`, v: salesVarVal };
      const taxVarFormula = { f: `F${rIdx}-G${rIdx}`, v: taxVarVal };
      const itcVarFormula = { f: `I${rIdx}-J${rIdx}`, v: itcVarVal };
      const flagFormula = {
        f: `IF(OR(ABS(E${rIdx})>1, ABS(H${rIdx})>1, ABS(K${rIdx})>1), "⚠️ Mismatch", "✓ Matched")`,
        v: flagVal,
        t: 'str'
      };

      reconRows.push([
        p.prd, p.name,
        tx, g1Sales, salesVarFormula,
        tax, g1Tax, taxVarFormula,
        itc, g2bItc, itcVarFormula,
        flagFormula
      ]);
    });

    if (reconRows.length > 0) {
      const lastRow = reconRows.length + 1; // row 1 is header, data 2..lastRow
      const sp = ['', '', '', '', '', '', '', '', '', '', '', ''];
      sp.__isSpacer = true;
      reconRows.push(sp);

      const totRowIdx = lastRow + 2;
      const totSalesVar = Math.round((totOutTaxable - totG1Sales) * 100) / 100;
      const totTaxVar = Math.round((totOutputTax - totG1Tax) * 100) / 100;
      const totItcVar = Math.round((totItcNet - totG2bItc) * 100) / 100;
      const totMismatch = (Math.abs(totSalesVar) > 1 || Math.abs(totTaxVar) > 1 || Math.abs(totItcVar) > 1);
      const totFlagVal = totMismatch ? '⚠️ Mismatch' : '✓ Matched';

      const reconTotRow = [
        'TOTAL',
        'Cumulative FY',
        { f: `SUM(C2:C${lastRow})`, v: Math.round(totOutTaxable * 100) / 100 },
        { f: `SUM(D2:D${lastRow})`, v: Math.round(totG1Sales * 100) / 100 },
        { f: `C${totRowIdx}-D${totRowIdx}`, v: totSalesVar },
        { f: `SUM(F2:F${lastRow})`, v: Math.round(totOutputTax * 100) / 100 },
        { f: `SUM(G2:G${lastRow})`, v: Math.round(totG1Tax * 100) / 100 },
        { f: `F${totRowIdx}-G${totRowIdx}`, v: totTaxVar },
        { f: `SUM(I2:I${lastRow})`, v: Math.round(totItcNet * 100) / 100 },
        { f: `SUM(J2:J${lastRow})`, v: Math.round(totG2bItc * 100) / 100 },
        { f: `I${totRowIdx}-J${totRowIdx}`, v: totItcVar },
        {
          f: `IF(OR(ABS(E${totRowIdx})>1, ABS(H${totRowIdx})>1, ABS(K${totRowIdx})>1), "⚠️ Mismatch", "✓ Matched")`,
          v: totFlagVal,
          t: 'str'
        }
      ];
      reconTotRow.__isSummary = true;
      reconRows.push(reconTotRow);
    }

    wb.addSheet('Audit Reconciliation (3B-1-2B)', reconHeaders, reconRows, {
      tabColor: 'E11D48',
      freezeColumns: 2,
      columnWidths: [16, 16, 28, 28, 28, 24, 24, 24, 28, 28, 28, 20]
    });

    return wb;
  }

  const ConsolidatedGstr3bBuilder = {
    buildGstr3bConsolidatedWorkbook
  };

  root.ConsolidatedGstr3bBuilder = ConsolidatedGstr3bBuilder;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ConsolidatedGstr3bBuilder;
  }
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis));
