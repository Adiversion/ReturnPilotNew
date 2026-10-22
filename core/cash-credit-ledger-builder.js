// ═══════════════════════════════════════════════════════════════════════════════
//  ReturnPilot v4.2 — Statutory Cash & Credit Ledger (.xlsx) Workbook Builder
//  Exact Government PMT-02 (Credit Ledger) and PMT-05 (Cash Ledger) Specifications
//  © 2026 KasyHQ Technologies. All Rights Reserved.
// ═══════════════════════════════════════════════════════════════════════════════

(function(root) {
  'use strict';

  function parseNumber(val) {
    if (val === null || val === undefined || val === '' || val === '-') return 0;
    if (typeof val === 'number') return isNaN(val) ? 0 : val;
    const clean = String(val).replace(/,/g, '').trim();
    const num = Number(clean);
    return isNaN(num) ? 0 : num;
  }

  function formatDate(dateStr) {
    if (!dateStr || dateStr === '-') return '-';
    const clean = String(dateStr).trim();
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(clean)) return clean;
    if (/^\d{2}-\d{2}-\d{4}$/.test(clean)) return clean.replace(/-/g, '/');
    if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
      const p = clean.split('-');
      return `${p[2]}/${p[1]}/${p[0]}`;
    }
    return clean;
  }

  function formatTaxPeriod(prdStr) {
    if (!prdStr || prdStr === '-' || prdStr === 'null') return '-';
    const clean = String(prdStr).trim();
    if (clean.length === 6 && /^\d{6}$/.test(clean)) {
      const mm = parseInt(clean.substring(0, 2), 10);
      const yyyy = clean.substring(2, 6);
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const mName = months[mm - 1] || mm;
      const shortYear = yyyy.substring(2);
      return `${mName}-${shortYear}`;
    }
    return clean;
  }

  function formatTimestamp(d = new Date()) {
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    let hours = d.getHours();
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    const strHours = String(hours).padStart(2, '0');
    return `${day}/${month}/${year} ${strHours}:${minutes}:${seconds} ${ampm}`;
  }

  function buildLedgerWorkbook({ creditData = {}, cashData = {}, metadata = {} }) {
    const Xlsx = (typeof ReturnPilotXlsx !== 'undefined') ? ReturnPilotXlsx : (typeof require !== 'undefined' ? require('./xlsx-builder.js') : null);
    if (!Xlsx) throw new Error('ReturnPilotXlsx engine is required to generate ledger spreadsheets');

    const wb = Xlsx.createWorkbook();
    if (metadata.email) {
      wb.author = `ReturnPilot Premium (Licensed to ${metadata.email})`;
    }

    const gstin = metadata.gstin || creditData.gstin || cashData.gstin || '';
    const isBadName = (v) => !v || typeof v !== 'string' || ['na', 'n/a', 'null', 'undefined', '-', '.'].includes(v.trim().toLowerCase());
    const legalName = (!isBadName(metadata.tradeName) ? metadata.tradeName : (!isBadName(metadata.legalName) ? metadata.legalName : (!isBadName(metadata.businessName) ? metadata.businessName : 'Taxpayer')));
    const finYear = metadata.finYear || '2024-25';
    const fromDate = metadata.fromDate || creditData.fr_dt || cashData.fr_dt || '';
    const toDate = metadata.toDate || creditData.to_dt || cashData.to_dt || '';

    // ─────────────────────────────────────────────────────────────────────────
    //  TAB 1: EXECUTIVE AUDIT SUMMARY
    // ─────────────────────────────────────────────────────────────────────────
    const summaryRows = [];
    summaryRows.push(['Taxpayer Legal/Trade Name', legalName]);
    summaryRows.push(['Company GSTIN', gstin]);
    summaryRows.push(['Financial Year', finYear]);
    summaryRows.push(['Period Date Range', `${fromDate || '-'} to ${toDate || '-'}`]);
    summaryRows.push(['Generated On', formatTimestamp()]);
    summaryRows.push(['Statutory Basis', 'Form GST PMT-02 (Electronic Credit Ledger) & Form GST PMT-05 (Electronic Cash Ledger)']);
    summaryRows.push(['Software Platform', 'ReturnPilot - GST Return Downloader (https://kasyhq.com)']);
    summaryRows.push(['', '']);

    // Calculate Credit Ledger aggregates
    const creditTr = Array.isArray(creditData.tr) ? creditData.tr : [];
    let openingItcTotal = 0;
    let closingItcTotal = 0;
    let totalItcAccrued = 0;
    let totalItcUtilized = 0;

    creditTr.forEach(item => {
      const desc = String(item.desc || '').toLowerCase();
      const trTyp = String(item.tr_typ || '').toLowerCase();
      const trAmt = parseNumber(item.tot_tr_amt);

      if (desc.includes('opening')) {
        openingItcTotal = parseNumber(item.tot_rng_bal);
      } else if (desc.includes('closing')) {
        closingItcTotal = parseNumber(item.tot_rng_bal);
      } else if (trTyp === 'cr' || trTyp === 'credit') {
        totalItcAccrued += trAmt;
      } else if (trTyp === 'dr' || trTyp === 'debit') {
        totalItcUtilized += trAmt;
      }
    });

    // Calculate Cash Ledger aggregates
    const cashTr = Array.isArray(cashData.tr) ? cashData.tr : [];
    let openingCashTotal = 0;
    let closingCashTotal = 0;
    let totalCashDeposited = 0;
    let totalCashUtilized = 0;

    cashTr.forEach(item => {
      const desc = String(item.desc || '').toLowerCase();
      const trTyp = String(item.tr_typ || '').toLowerCase();
      const trAmt = parseNumber(item.tot_tr_amt);

      if (desc.includes('opening')) {
        openingCashTotal = parseNumber(item.tot_rng_bal);
      } else if (desc.includes('closing')) {
        closingCashTotal = parseNumber(item.tot_rng_bal);
      } else if (trTyp === 'cr' || trTyp === 'credit') {
        totalCashDeposited += trAmt;
      } else if (trTyp === 'dr' || trTyp === 'debit') {
        totalCashUtilized += trAmt;
      }
    });

    summaryRows.push(['SECTION 1: ELECTRONIC CREDIT LEDGER (ITC) SUMMARY', '']);
    summaryRows.push(['Opening ITC Balance (as of ' + (fromDate || 'start') + ')', openingItcTotal]);
    summaryRows.push(['Total ITC Accrued / Availed (Additions)', totalItcAccrued]);
    summaryRows.push(['Total ITC Utilized / Debited (Tax Paid / Demands)', totalItcUtilized]);
    summaryRows.push(['Closing ITC Balance (as of ' + (toDate || 'end') + ')', closingItcTotal]);
    summaryRows.push(['', '']);

    summaryRows.push(['SECTION 2: ELECTRONIC CASH LEDGER SUMMARY', '']);
    summaryRows.push(['Opening Cash Balance (as of ' + (fromDate || 'start') + ')', openingCashTotal]);
    summaryRows.push(['Total Cash Deposited (Challan Payments)', totalCashDeposited]);
    summaryRows.push(['Total Cash Utilized (Tax / Interest / Late Fees Paid)', totalCashUtilized]);
    summaryRows.push(['Closing Cash Balance (as of ' + (toDate || 'end') + ')', closingCashTotal]);

    wb.addSheet(
      'Ledger Summary',
      ['Audit Parameter', 'Amount (₹)'],
      summaryRows,
      {
        tabColor: '2563EB',
        freezeColumns: 1,
        columnWidths: [48, 28]
      }
    );

    // ─────────────────────────────────────────────────────────────────────────
    //  TAB 2: ELECTRONIC CREDIT LEDGER (Form GST PMT-02)
    // ─────────────────────────────────────────────────────────────────────────
    const creditHeaders = [
      'Sr.No',
      'Date',
      'Reference No.',
      'Tax Period if any',
      'Description',
      'Transaction Type[Debit (DR) / Credit (CR)]',
      'Integrated Tax Debited / Credited',
      'Central Tax Debited / Credited',
      'State Tax Debited / Credited',
      'CESS Debited / Credited',
      'Total Debited / Credited',
      'Integrated Tax Balance Available',
      'Central Tax Balance Available',
      'State Tax Balance Available',
      'CESS Balance Available',
      'Total Balance Available'
    ];

    const creditRows = [];
    let creditSr = 1;

    creditTr.forEach(item => {
      const isOpening = String(item.desc || '').toLowerCase().includes('opening');
      const isClosing = String(item.desc || '').toLowerCase().includes('closing');
      const isSummary = isOpening || isClosing;

      const srNo = isSummary ? '-' : String(creditSr++);
      const dateVal = isSummary ? '-' : formatDate(item.dt);
      const refNo = isSummary ? '-' : (item.ref_no || '-');
      const periodVal = isSummary ? '-' : formatTaxPeriod(item.ret_period);
      const descVal = item.desc || '-';
      
      let trTypeVal = '-';
      if (!isSummary) {
        trTypeVal = (item.tr_typ === 'Cr' || item.tr_typ === 'Credit') ? 'Credit' : ((item.tr_typ === 'Dr' || item.tr_typ === 'Debit') ? 'Debit' : item.tr_typ || '-');
      }

      const row = [
        srNo,
        dateVal,
        refNo,
        periodVal,
        descVal,
        trTypeVal,
        parseNumber(item.igstTaxAmt),
        parseNumber(item.cgstTaxAmt),
        parseNumber(item.sgstTaxAmt),
        parseNumber(item.cessTaxAmt),
        parseNumber(item.tot_tr_amt),
        parseNumber(item.igstTaxBal),
        parseNumber(item.cgstTaxBal),
        parseNumber(item.sgstTaxBal),
        parseNumber(item.cessTaxBal),
        parseNumber(item.tot_rng_bal)
      ];

      if (isSummary) {
        row.__isSummary = true;
      }
      creditRows.push(row);
    });

    wb.addSheet(
      'Credit Ledger',
      creditHeaders,
      creditRows,
      {
        tabColor: '059669',
        freezeColumns: 5,
        columnWidths: [8, 12, 22, 14, 30, 16, 18, 18, 18, 16, 20, 18, 18, 18, 16, 22]
      }
    );

    // ─────────────────────────────────────────────────────────────────────────
    //  TAB 3: ELECTRONIC CASH LEDGER (Form GST PMT-05)
    // ─────────────────────────────────────────────────────────────────────────
    const cashHeaders = [
      'Sr.No',
      'Date of deposit/Debit',
      'Time of deposit',
      'Reporting date (by bank)',
      'Reference No.',
      'Tax Period if applicable',
      'Description',
      'Transaction Type (Debit/Credit)',
      // Integrated Tax Debited / Credited
      'IGST Tax (DR/CR)',
      'IGST Interest (DR/CR)',
      'IGST Penalty (DR/CR)',
      'IGST Fee (DR/CR)',
      'IGST Others (DR/CR)',
      'IGST Total (DR/CR)',
      // Central Tax Debited / Credited
      'CGST Tax (DR/CR)',
      'CGST Interest (DR/CR)',
      'CGST Penalty (DR/CR)',
      'CGST Fee (DR/CR)',
      'CGST Others (DR/CR)',
      'CGST Total (DR/CR)',
      // State Tax Debited / Credited
      'SGST Tax (DR/CR)',
      'SGST Interest (DR/CR)',
      'SGST Penalty (DR/CR)',
      'SGST Fee (DR/CR)',
      'SGST Others (DR/CR)',
      'SGST Total (DR/CR)',
      // CESS Debited / Credited
      'CESS Tax (DR/CR)',
      'CESS Interest (DR/CR)',
      'CESS Penalty (DR/CR)',
      'CESS Fee (DR/CR)',
      'CESS Others (DR/CR)',
      'CESS Total (DR/CR)',
      // Total Debited / Credited
      'Total Transaction Amount',
      // Integrated Tax Balance
      'IGST Balance - Tax',
      'IGST Balance - Interest',
      'IGST Balance - Penalty',
      'IGST Balance - Fee',
      'IGST Balance - Others',
      'IGST Balance - Total',
      // Central Tax Balance
      'CGST Balance - Tax',
      'CGST Balance - Interest',
      'CGST Balance - Penalty',
      'CGST Balance - Fee',
      'CGST Balance - Others',
      'CGST Balance - Total',
      // State Tax Balance
      'SGST Balance - Tax',
      'SGST Balance - Interest',
      'SGST Balance - Penalty',
      'SGST Balance - Fee',
      'SGST Balance - Others',
      'SGST Balance - Total',
      // CESS Balance
      'CESS Balance - Tax',
      'CESS Balance - Interest',
      'CESS Balance - Penalty',
      'CESS Balance - Fee',
      'CESS Balance - Others',
      'CESS Balance - Total',
      // Total Running Balance
      'Total Running Balance'
    ];

    const cashRows = [];
    let cashSr = 1;

    cashTr.forEach(item => {
      const isOpening = String(item.desc || '').toLowerCase().includes('opening');
      const isClosing = String(item.desc || '').toLowerCase().includes('closing');
      const isSummary = isOpening || isClosing;

      const srNo = isSummary ? '-' : String(cashSr++);
      const dptDt = isSummary ? '-' : formatDate(item.dpt_dt);
      const dptTime = isSummary ? '-' : (item.dpt_time || '-');
      const rptDt = isSummary ? '-' : formatDate(item.rpt_dt);
      const refNo = isSummary ? '-' : (item.ref_no || item.refNo || '-');
      const periodVal = isSummary ? '-' : formatTaxPeriod(item.ret_period);
      const descVal = item.desc || '-';

      let trTypeVal = '-';
      if (!isSummary) {
        trTypeVal = (item.tr_typ === 'Cr' || item.tr_typ === 'Credit') ? 'Credit' : ((item.tr_typ === 'Dr' || item.tr_typ === 'Debit') ? 'Debit' : item.tr_typ || '-');
      }

      const igst = item.igst || {};
      const cgst = item.cgst || {};
      const sgst = item.sgst || {};
      const cess = item.cess || {};

      const igstbal = item.igstbal || {};
      const cgstbal = item.cgstbal || {};
      const sgstbal = item.sgstbal || {};
      const cessbal = item.cessbal || {};

      const row = [
        srNo,
        dptDt,
        dptTime,
        rptDt,
        refNo,
        periodVal,
        descVal,
        trTypeVal,
        // IGST DR/CR
        parseNumber(igst.tx),
        parseNumber(igst.intr),
        parseNumber(igst.pen),
        parseNumber(igst.fee),
        parseNumber(igst.oth),
        parseNumber(igst.tot),
        // CGST DR/CR
        parseNumber(cgst.tx),
        parseNumber(cgst.intr),
        parseNumber(cgst.pen),
        parseNumber(cgst.fee),
        parseNumber(cgst.oth),
        parseNumber(cgst.tot),
        // SGST DR/CR
        parseNumber(sgst.tx),
        parseNumber(sgst.intr),
        parseNumber(sgst.pen),
        parseNumber(sgst.fee),
        parseNumber(sgst.oth),
        parseNumber(sgst.tot),
        // CESS DR/CR
        parseNumber(cess.tx),
        parseNumber(cess.intr),
        parseNumber(cess.pen),
        parseNumber(cess.fee),
        parseNumber(cess.oth),
        parseNumber(cess.tot),
        // Total Transaction
        parseNumber(item.tot_tr_amt),
        // IGST Balance
        parseNumber(igstbal.tx),
        parseNumber(igstbal.intr),
        parseNumber(igstbal.pen),
        parseNumber(igstbal.fee),
        parseNumber(igstbal.oth),
        parseNumber(igstbal.tot),
        // CGST Balance
        parseNumber(cgstbal.tx),
        parseNumber(cgstbal.intr),
        parseNumber(cgstbal.pen),
        parseNumber(cgstbal.fee),
        parseNumber(cgstbal.oth),
        parseNumber(cgstbal.tot),
        // SGST Balance
        parseNumber(sgstbal.tx),
        parseNumber(sgstbal.intr),
        parseNumber(sgstbal.pen),
        parseNumber(sgstbal.fee),
        parseNumber(sgstbal.oth),
        parseNumber(sgstbal.tot),
        // CESS Balance
        parseNumber(cessbal.tx),
        parseNumber(cessbal.intr),
        parseNumber(cessbal.pen),
        parseNumber(cessbal.fee),
        parseNumber(cessbal.oth),
        parseNumber(cessbal.tot),
        // Total Running Balance
        parseNumber(item.tot_rng_bal)
      ];

      if (isSummary) {
        row.__isSummary = true;
      }
      cashRows.push(row);
    });

    wb.addSheet(
      'Cash Ledger',
      cashHeaders,
      cashRows,
      {
        tabColor: 'D97706',
        freezeColumns: 5,
        columnWidths: [8, 14, 12, 14, 22, 14, 28, 16, 12, 12, 12, 12, 12, 14, 12, 12, 12, 12, 12, 14, 12, 12, 12, 12, 12, 14, 12, 12, 12, 12, 12, 14, 18, 12, 12, 12, 12, 12, 14, 12, 12, 12, 12, 12, 14, 12, 12, 12, 12, 12, 14, 12, 12, 12, 12, 12, 14, 18]
      }
    );

    return wb;
  }

  const CashCreditLedgerBuilder = {
    buildLedgerWorkbook
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CashCreditLedgerBuilder;
  } else {
    root.CashCreditLedgerBuilder = CashCreditLedgerBuilder;
  }
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this)));
