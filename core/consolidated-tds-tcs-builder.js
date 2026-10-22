// ═══════════════════════════════════════════════════════════════════════════════
//  ReturnPilot Premium v4.2.1 — Consolidated TDS & TCS Credit Received Workbook
//  Official GSTN Standard: 4 Sheets (tds, tcs, tdsa, tcsa) Multi-Month Consolidation
//  © 2026 KasyHQ Technologies. All Rights Reserved.
// ═══════════════════════════════════════════════════════════════════════════════

(function(root) {
  'use strict';

  function formatPeriodMonth(periodVal) {
    if (!periodVal || String(periodVal).length < 6) return String(periodVal || '');
    const s = String(periodVal).trim();
    const mm = parseInt(s.substring(0, 2), 10);
    const yyyy = s.substring(2, 6);
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return (mm >= 1 && mm <= 12) ? `${months[mm - 1]}-${yyyy}` : s;
  }

  function parseNumber(val) {
    if (val === null || val === undefined || val === '') return 0;
    const num = Number(val);
    return isNaN(num) ? 0 : num;
  }

  function formatDate(dateStr) {
    if (!dateStr) return '';
    const clean = String(dateStr).trim();
    if (/^\d{2}-\d{2}-\d{4}$/.test(clean)) return clean;
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(clean)) return clean.replace(/\//g, '-');
    if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
      const p = clean.split('-');
      return `${p[2]}-${p[1]}-${p[0]}`;
    }
    if (/^\d{4}\/\d{2}\/\d{2}$/.test(clean)) {
      const p = clean.split('/');
      return `${p[2]}-${p[1]}-${p[0]}`;
    }
    return clean;
  }

  function formatActionFlag(flag) {
    if (!flag) return '—';
    const f = String(flag).trim().toUpperCase();
    if (f === 'A') return 'Accepted';
    if (f === 'R') return 'Rejected';
    if (f === 'N' || f === 'P') return 'Pending';
    if (f === 'M') return 'Modified';
    return flag;
  }

  function isBadName(val) {
    if (!val || typeof val !== 'string') return true;
    const clean = val.trim().toLowerCase();
    return clean === '' || clean === 'na' || clean === 'n/a' || clean === 'null' || clean === 'undefined' || clean === '-' || clean === '.';
  }

  function resolvePartyName(ctin, rawName, partyMap) {
    if (rawName && !isBadName(rawName)) return String(rawName).trim();
    if (partyMap && ctin && partyMap[ctin] && !isBadName(partyMap[ctin])) {
      return String(partyMap[ctin]).trim();
    }
    return '';
  }

  function buildTdsTcsWorkbook(periodsData, metadata = {}) {
    const Xlsx = (typeof ReturnPilotXlsx !== 'undefined') ? ReturnPilotXlsx : (typeof require !== 'undefined' ? require('./xlsx-builder.js') : null);
    if (!Xlsx) throw new Error('ReturnPilotXlsx engine is required');

    const wb = Xlsx.createWorkbook();
    if (metadata.email) {
      wb.author = `ReturnPilot Premium (Licensed to ${metadata.email})`;
    }

    const partyMap = metadata.partyMap || {};

    const tdsRows = [];
    const tcsRows = [];
    const tdsaRows = [];
    const tcsaRows = [];

    // Process each period's payload
    (periodsData || []).forEach(pItem => {
      const period = pItem.period || '';
      const periodLabel = formatPeriodMonth(period);
      const raw = pItem.data || {};
      const payload = raw.data || raw;

      // ── 1. Sheet: tds (TDS Credit Received) ──────────────────────────────
      const tdsList = payload.tds || [];
      if (Array.isArray(tdsList)) {
        tdsList.forEach(item => {
          const ctin = item.ctin || '';
          const name = resolvePartyName(ctin, item.ctin_name, partyMap);
          const inum = item.inum || '—';
          const idt = formatDate(item.idt || '');
          const ival = parseNumber(item.ival);
          const amt_ded = parseNumber(item.amt_ded);
          const iamt = parseNumber(item.iamt);
          const camt = parseNumber(item.camt);
          const samt = parseNumber(item.samt);
          const totalTax = iamt + camt + samt;
          const flag = formatActionFlag(item.flag);
          const month = item.month ? formatPeriodMonth(item.month) : periodLabel;
          const editable = item.editable || 'Y';
          const chksum = item.chksum || '';

          tdsRows.push([
            periodLabel,
            ctin,
            name,
            inum,
            idt,
            ival || amt_ded,
            amt_ded,
            iamt || '',
            camt || '',
            samt || '',
            totalTax || '',
            flag,
            month,
            editable,
            chksum
          ]);
        });
      }

      // ── 2. Sheet: tcs (TCS Credit Received) ──────────────────────────────
      const tcsList = payload.tcs || [];
      if (Array.isArray(tcsList)) {
        tcsList.forEach(item => {
          const ctin = item.ctin || item.ecom_gstin || '';
          const name = resolvePartyName(ctin, item.ctin_name || item.trade_name, partyMap);
          const supp_val = parseNumber(item.supp_val !== undefined ? item.supp_val : item.gross_val);
          const ret_val = parseNumber(item.ret_val);
          const net_val = parseNumber(item.amt_col !== undefined ? item.amt_col : (item.net_val !== undefined ? item.net_val : item.amt_ded));
          const iamt = parseNumber(item.iamt);
          const camt = parseNumber(item.camt);
          const samt = parseNumber(item.samt);
          const totalTax = iamt + camt + samt;
          const flag = formatActionFlag(item.flag);
          const month = item.month ? formatPeriodMonth(item.month) : periodLabel;
          const editable = item.editable || 'Y';
          const chksum = item.chksum || '';

          tcsRows.push([
            periodLabel,
            ctin,
            name,
            supp_val,
            ret_val,
            net_val,
            iamt || '',
            camt || '',
            samt || '',
            totalTax || '',
            flag,
            month,
            editable,
            chksum
          ]);
        });
      }

      // ── 3. Sheet: tdsa (TDS Amendments) ───────────────────────────────────
      const tdsaList = payload.tdsa || [];
      if (Array.isArray(tdsaList)) {
        tdsaList.forEach(item => {
          const octin = item.octin || item.ctin || '';
          const oinum = item.oinum || item.inum || '—';
          const oidt = formatDate(item.oidt || item.idt || '');
          const ctin = item.ctin || '';
          const name = resolvePartyName(ctin, item.ctin_name, partyMap);
          const inum = item.inum || '—';
          const idt = formatDate(item.idt || '');
          const ival = parseNumber(item.ival);
          const amt_ded = parseNumber(item.amt_ded);
          const iamt = parseNumber(item.iamt);
          const camt = parseNumber(item.camt);
          const samt = parseNumber(item.samt);
          const totalTax = iamt + camt + samt;
          const flag = formatActionFlag(item.flag);
          const month = item.month ? formatPeriodMonth(item.month) : periodLabel;
          const editable = item.editable || 'Y';
          const chksum = item.chksum || '';

          tdsaRows.push([
            periodLabel,
            octin,
            oinum,
            oidt,
            ctin,
            name,
            inum,
            idt,
            ival || amt_ded,
            amt_ded,
            iamt || '',
            camt || '',
            samt || '',
            totalTax || '',
            flag,
            month,
            editable,
            chksum
          ]);
        });
      }

      // ── 4. Sheet: tcsa (TCS Amendments) ───────────────────────────────────
      const tcsaList = payload.tcsa || [];
      if (Array.isArray(tcsaList)) {
        tcsaList.forEach(item => {
          const omonth = item.omonth ? formatPeriodMonth(item.omonth) : (item.omth ? formatPeriodMonth(item.omth) : '—');
          const ctin = item.ctin || item.ecom_gstin || '';
          const name = resolvePartyName(ctin, item.ctin_name || item.trade_name, partyMap);
          const supp_val = parseNumber(item.supp_val !== undefined ? item.supp_val : item.gross_val);
          const ret_val = parseNumber(item.ret_val);
          const net_val = parseNumber(item.amt_col !== undefined ? item.amt_col : (item.net_val !== undefined ? item.net_val : item.amt_ded));
          const iamt = parseNumber(item.iamt);
          const camt = parseNumber(item.camt);
          const samt = parseNumber(item.samt);
          const totalTax = iamt + camt + samt;
          const flag = formatActionFlag(item.flag);
          const month = item.month ? formatPeriodMonth(item.month) : periodLabel;
          const editable = item.editable || 'Y';
          const chksum = item.chksum || '';

          tcsaRows.push([
            periodLabel,
            omonth,
            ctin,
            name,
            supp_val,
            ret_val,
            net_val,
            iamt || '',
            camt || '',
            samt || '',
            totalTax || '',
            flag,
            month,
            editable,
            chksum
          ]);
        });
      }
    });

    // ── Summary Totals Row for Sheet: tds ──
    if (tdsRows.length > 0) {
      const N = tdsRows.length + 1;
      const totalRow = [
        'Total', '', '', '', '',
        `=SUM(F2:F${N})`,
        `=SUM(G2:G${N})`,
        `=SUM(H2:H${N})`,
        `=SUM(I2:I${N})`,
        `=SUM(J2:J${N})`,
        `=SUM(K2:K${N})`,
        '', '', '', ''
      ];
      totalRow.__isSummary = true;
      tdsRows.push(totalRow);
    }

    // ── Summary Totals Row for Sheet: tcs ──
    if (tcsRows.length > 0) {
      const N = tcsRows.length + 1;
      const totalRow = [
        'Total', '', '',
        `=SUM(D2:D${N})`,
        `=SUM(E2:E${N})`,
        `=SUM(F2:F${N})`,
        `=SUM(G2:G${N})`,
        `=SUM(H2:H${N})`,
        `=SUM(I2:I${N})`,
        `=SUM(J2:J${N})`,
        '', '', '', ''
      ];
      totalRow.__isSummary = true;
      tcsRows.push(totalRow);
    }

    // ── Summary Totals Row for Sheet: tdsa ──
    if (tdsaRows.length > 0) {
      const N = tdsaRows.length + 1;
      const totalRow = [
        'Total', '', '', '', '', '', '', '',
        `=SUM(I2:I${N})`,
        `=SUM(J2:J${N})`,
        `=SUM(K2:K${N})`,
        `=SUM(L2:L${N})`,
        `=SUM(M2:M${N})`,
        `=SUM(N2:N${N})`,
        '', '', '', ''
      ];
      totalRow.__isSummary = true;
      tdsaRows.push(totalRow);
    }

    // ── Summary Totals Row for Sheet: tcsa ──
    if (tcsaRows.length > 0) {
      const N = tcsaRows.length + 1;
      const totalRow = [
        'Total', '', '', '',
        `=SUM(E2:E${N})`,
        `=SUM(F2:F${N})`,
        `=SUM(G2:G${N})`,
        `=SUM(H2:H${N})`,
        `=SUM(I2:I${N})`,
        `=SUM(J2:J${N})`,
        `=SUM(K2:K${N})`,
        '', '', '', ''
      ];
      totalRow.__isSummary = true;
      tcsaRows.push(totalRow);
    }

    // ── 1. Sheet: tds ──
    wb.addSheet(
      'tds',
      [
        'Return Period',
        'Deductor GSTIN',
        'Deductor Name',
        'Invoice/Doc No',
        'Invoice/Doc Date',
        'Invoice/Doc Value (₹)',
        'Total Amount Deducted (₹)',
        'Integrated Tax (₹)',
        'Central Tax (₹)',
        'State/UT Tax (₹)',
        'Total Tax Deducted (₹)',
        'Action Status',
        'Tax Period / Month',
        'Editable',
        'Checksum'
      ],
      tdsRows,
      {
        tabColor: '059669',
        freezeColumns: 3,
        columnWidths: [16, 18, 36, 16, 14, 18, 20, 16, 16, 16, 18, 14, 16, 10, 24]
      }
    );

    // ── 2. Sheet: tcs ──
    wb.addSheet(
      'tcs',
      [
        'Return Period',
        'Collector GSTIN',
        'Collector Name',
        'Gross Value of Supplies (₹)',
        'Value of Supplies Returned (₹)',
        'Net Amount Liable for TCS (₹)',
        'Integrated Tax (₹)',
        'Central Tax (₹)',
        'State/UT Tax (₹)',
        'Total Tax Collected (₹)',
        'Action Status',
        'Tax Period / Month',
        'Editable',
        'Checksum'
      ],
      tcsRows,
      {
        tabColor: '2563EB',
        freezeColumns: 3,
        columnWidths: [16, 18, 36, 22, 22, 22, 16, 16, 16, 18, 14, 16, 10, 24]
      }
    );

    // ── 3. Sheet: tdsa ──
    wb.addSheet(
      'tdsa',
      [
        'Return Period',
        'Original Deductor GSTIN',
        'Original Invoice/Doc No',
        'Original Invoice/Doc Date',
        'Revised Deductor GSTIN',
        'Deductor Name',
        'Revised Invoice/Doc No',
        'Revised Invoice/Doc Date',
        'Invoice/Doc Value (₹)',
        'Total Amount Deducted (₹)',
        'Integrated Tax (₹)',
        'Central Tax (₹)',
        'State/UT Tax (₹)',
        'Total Tax Deducted (₹)',
        'Action Status',
        'Tax Period / Month',
        'Editable',
        'Checksum'
      ],
      tdsaRows,
      {
        tabColor: 'D97706',
        freezeColumns: 5,
        columnWidths: [16, 20, 18, 16, 20, 36, 18, 16, 18, 20, 16, 16, 16, 18, 14, 16, 10, 24]
      }
    );

    // ── 4. Sheet: tcsa ──
    wb.addSheet(
      'tcsa',
      [
        'Return Period',
        'Original Month / Period',
        'Collector GSTIN',
        'Collector Name',
        'Gross Value of Supplies (₹)',
        'Value of Supplies Returned (₹)',
        'Net Amount Liable for TCS (₹)',
        'Integrated Tax (₹)',
        'Central Tax (₹)',
        'State/UT Tax (₹)',
        'Total Tax Collected (₹)',
        'Action Status',
        'Tax Period / Month',
        'Editable',
        'Checksum'
      ],
      tcsaRows,
      {
        tabColor: '7C3AED',
        freezeColumns: 4,
        columnWidths: [16, 18, 18, 36, 22, 22, 22, 16, 16, 16, 18, 14, 16, 10, 24]
      }
    );

    return wb;
  }

  const ConsolidatedTdsTcsBuilder = {
    buildTdsTcsWorkbook
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ConsolidatedTdsTcsBuilder;
  } else {
    root.ConsolidatedTdsTcsBuilder = ConsolidatedTdsTcsBuilder;
  }
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this)));
