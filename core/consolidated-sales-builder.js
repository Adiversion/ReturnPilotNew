// ═══════════════════════════════════════════════════════════════════════════════
//  ReturnPilot Premium v4.2.5 — Statutory Sales Audit & Reconciliation Workbook
//  Official GSTN Standard: Executive Summary, B2B Supplies, B2C Summary, HSN, Docs
//  © 2026 KasyHQ Technologies. All Rights Reserved.
// ═══════════════════════════════════════════════════════════════════════════════

(function(root) {
  'use strict';

  function formatPeriodMonth(periodVal) {
    if (!periodVal || periodVal.length < 6) return String(periodVal || '');
    const mm = parseInt(periodVal.substring(0, 2), 10);
    const yyyy = periodVal.substring(2, 6);
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return `${months[mm - 1] || mm}-${yyyy}`;
  }

  function parseNumber(val) {
    if (val === null || val === undefined || val === '') return 0;
    const num = Number(val);
    return isNaN(num) ? 0 : num;
  }

  const STATE_NAMES = {
    '01': '01-Jammu and Kashmir',
    '02': '02-Himachal Pradesh',
    '03': '03-Punjab',
    '04': '04-Chandigarh',
    '05': '05-Uttarakhand',
    '06': '06-Haryana',
    '07': '07-Delhi',
    '08': '08-Rajasthan',
    '09': '09-Uttar Pradesh',
    '10': '10-Bihar',
    '11': '11-Sikkim',
    '12': '12-Arunachal Pradesh',
    '13': '13-Nagaland',
    '14': '14-Manipur',
    '15': '15-Mizoram',
    '16': '16-Tripura',
    '17': '17-Meghalaya',
    '18': '18-Assam',
    '19': '19-West Bengal',
    '20': '20-Jharkhand',
    '21': '21-Odisha',
    '22': '22-Chhattisgarh',
    '23': '23-Madhya Pradesh',
    '24': '24-Gujarat',
    '26': '26-Dadra and Nagar Haveli and Daman and Diu',
    '27': '27-Maharashtra',
    '29': '29-Karnataka',
    '30': '30-Goa',
    '31': '31-Lakshadweep',
    '32': '32-Kerala',
    '33': '33-Tamil Nadu',
    '34': '34-Puducherry',
    '35': '35-Andaman and Nicobar Islands',
    '36': '36-Telangana',
    '37': '37-Andhra Pradesh',
    '38': '38-Ladakh',
    '97': '97-Other Territory',
    '99': '99-Center Jurisdiction'
  };

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
    return `${day}-${month}-${year} ${strHours}:${minutes}:${seconds} ${ampm}`;
  }

  function formatState(code) {
    if (!code) return '';
    const clean = String(code).trim();
    if (clean.includes('-')) return clean;
    const padded = clean.padStart(2, '0');
    return STATE_NAMES[padded] || clean;
  }

  const NIL_SUPPLY_TYPES = {
    'INTRAB2B': 'Intra-State supplies to registered persons',
    'INTRAB2C': 'Intra-State supplies to unregistered persons',
    'INTRB2B': 'Inter-State supplies to registered persons',
    'INTERB2B': 'Inter-State supplies to registered persons',
    'INTRB2C': 'Inter-State supplies to unregistered persons',
    'INTERB2C': 'Inter-State supplies to unregistered persons'
  };

  function buildSalesWorkbook(periodsData, metadata = {}) {
    const Xlsx = (typeof ReturnPilotXlsx !== 'undefined') ? ReturnPilotXlsx : (typeof require !== 'undefined' ? require('./xlsx-builder.js') : null);
    if (!Xlsx) throw new Error('ReturnPilotXlsx engine is required');

    const wb = Xlsx.createWorkbook();
    if (metadata.email) {
      wb.author = `ReturnPilot Premium (Licensed to ${metadata.email})`;
    }

    function isBadName(val) {
      if (!val || typeof val !== 'string') return true;
      const clean = val.trim().toLowerCase();
      return clean === '' || clean === 'na' || clean === 'n/a' || clean === 'null' || clean === 'undefined' || clean === '-' || clean === '.';
    }

    function resolvePartyName(ctinItem, partyMap, fallback = '') {
      const ctin = (ctinItem && ctinItem.ctin) || '';
      const trade = [ctinItem?.cname, ctinItem?.trade_name, ctinItem?.trdnm].find(v => !isBadName(v));
      const legal = [ctinItem?.lgnm, ctinItem?.legal_name, ctinItem?.legalName].find(v => !isBadName(v));
      const mapped = partyMap && ctin && partyMap[ctin];

      // If tradeNam is NA, use lgnm
      if (trade && !isBadName(trade)) return trade.trim();
      if (legal && !isBadName(legal)) return legal.trim();
      if (mapped && !isBadName(mapped)) return mapped.trim();
      return fallback;
    }

    function formatInvoiceType(val, fallback = 'Regular B2B') {
      if (!val || typeof val !== 'string') return fallback;
      const clean = val.trim().toUpperCase();
      if (clean === 'R' || clean === 'REG' || clean === 'REGULAR' || clean === 'REGULAR B2B' || clean === 'STANDARD') {
        return 'Regular B2B';
      }
      if (clean === 'DE' || clean === 'DEEMED' || clean === 'DEEMED EXP' || clean === 'DEEMED EXPORT' || clean === 'DEEMED EXPORTS') {
        return 'Deemed Exp';
      }
      if (clean === 'SEZWP' || clean === 'SEZ WITH PAYMENT' || clean === 'SEZ SUPPLIES WITH PAYMENT') {
        return 'SEZ supplies with payment';
      }
      if (clean === 'SEZWOP' || clean === 'SEZ WITHOUT PAYMENT' || clean === 'SEZ SUPPLIES WITHOUT PAYMENT') {
        return 'SEZ supplies without payment';
      }
      if (clean === 'INTRAIGST' || clean === 'INTRA-STATE SUPPLIES ATTRACTING IGST') {
        return 'Intra-State supplies attracting IGST';
      }
      if (clean === 'CBW') {
        return 'Custom Bonded Warehouse';
      }
      return val.trim();
    }

    const companyGstin = metadata.gstin || '';
    const tradeName = (!isBadName(metadata.tradeName) ? metadata.tradeName : (!isBadName(metadata.legalName) ? metadata.legalName : (!isBadName(metadata.businessName) ? metadata.businessName : 'Taxpayer')));

    const overviewRows = [];
    const salesRows = [];
    const salesSummaryRows = [];
    const nilRatedRows = [];
    const salesHsnRows = [];
    const docIssuedRows = [];

    let grandTaxable = 0;
    let grandNil = 0;
    let grandExempt = 0;
    let grandNonGst = 0;
    let grandIgst = 0;
    let grandCgst = 0;
    let grandSgst = 0;
    let grandCess = 0;
    let grandDocValue = 0;
    let grandInvCount = 0;

    let isAnyPeriodGstr1a = Boolean(metadata.isGstr1a || (metadata.returnType && metadata.returnType.includes('1A')));
    let grandDiffTaxable = 0;
    let grandDiffIgst = 0;
    let grandDiffCgst = 0;
    let grandDiffSgst = 0;
    let grandDiffCess = 0;
    let hasGstr1aDelta = false;

    let grandG1Taxable = 0;
    let grandG1Tax = 0;
    let hasG1Summary = false;

    // Executive Summary Header Information (Clean 2-Column Key/Value Layout)
    const taxpayerState = formatState(companyGstin.substring(0, 2));
    let displayFinYear = metadata.finYear;
    if (!displayFinYear || displayFinYear === 'FY' || displayFinYear === 'null') {
      const firstPrd = periodsData[0]?.period || '';
      if (firstPrd && firstPrd.length === 6) {
        const m = parseInt(firstPrd.slice(0, 2), 10);
        const y = parseInt(firstPrd.slice(2), 10);
        displayFinYear = (!isNaN(m) && !isNaN(y)) ? (m >= 4 ? `${y}-${String(y + 1).slice(2)}` : `${y - 1}-${String(y).slice(2)}`) : '2026-27';
      } else {
        displayFinYear = '2026-27';
      }
    }
    overviewRows.push(['Taxpayer Legal/Trade Name', tradeName]);
    overviewRows.push(['Company GSTIN', `${companyGstin}${taxpayerState ? ` (${taxpayerState})` : ''}`]);
    overviewRows.push(['Financial Year', displayFinYear]);
    overviewRows.push(['Report Period(s)', periodsData.map(p => formatPeriodMonth(p.period)).join(', ')]);
    overviewRows.push(['Generated On', formatTimestamp()]);
    overviewRows.push(['Audit Verification', isAnyPeriodGstr1a ? 'Form GSTR-1A Amendment & Statutory Differential Reconciliation' : 'Form GSTR-1 / GSTR-1A Document Level Extraction']);
    overviewRows.push(['Software Platform', 'ReturnPilot - GST Return Downloader (https://kasyhq.com)']);
    overviewRows.push(['', '']);

    // Process each period (Apr 2025 ... Mar 2026)
    periodsData.forEach(pItem => {
      const period = pItem.period || '';
      const periodLabel = formatPeriodMonth(period);
      const data = pItem.data || {};
      const isGstr1a = Boolean(pItem.isGstr1a || metadata.isGstr1a || pItem.data?.isGstr1a || (metadata.returnType && metadata.returnType.includes('1A')));
      if (isGstr1a) isAnyPeriodGstr1a = true;

      let periodTaxable = 0;
      let periodNil = 0;
      let periodExempt = 0;
      let periodNonGst = 0;
      let periodIgst = 0;
      let periodCgst = 0;
      let periodSgst = 0;
      let periodCess = 0;
      let periodDocVal = 0;
      let periodCount = 0;

      // 1. Process B2B & B2BA Invoices -> Sales Sheet
      const rawB2b = data.b2b || (data.sec_sum && !Array.isArray(data.sec_sum) && data.sec_sum.b2b) || [];
      const rawB2ba = data.b2ba || (data.sec_sum && !Array.isArray(data.sec_sum) && data.sec_sum.b2ba) || [];
      const b2bList = [
        ...(Array.isArray(rawB2b) ? rawB2b.map(x => ({ ...x, isAmendment: false })) : []),
        ...(Array.isArray(rawB2ba) ? rawB2ba.map(x => ({ ...x, isAmendment: true })) : [])
      ];

      if (b2bList.length > 0) {
        b2bList.forEach(ctinItem => {
          const ctin = ctinItem.ctin || '';
          const cname = resolvePartyName(ctinItem, metadata.partyMap, '');
          const isAmended = Boolean(ctinItem.isAmendment);
          const invList = ctinItem.inv || [];

          invList.forEach(inv => {
            const inum = inv.inum || '';
            const idt = formatDate(inv.idt || '');
            const val = parseNumber(inv.val);
            const pos = inv.pos || ctin.substring(0, 2);
            const rchrg = (inv.rchrg === 'Y' || inv.rchrg === true) ? 'Yes' : 'No';
            const oinum = inv.oinum || '';
            const oidt = formatDate(inv.oidt || '');
            const itms = (inv.itms && inv.itms.length > 0) ? inv.itms : ((inv.items && inv.items.length > 0) ? inv.items : [inv]);
            const invTyp = inv.inv_typ || inv.invtyp || inv.inv_type || ctinItem.inv_typ || '';
            const saleType = formatInvoiceType(invTyp, 'Regular B2B');

            periodCount++;
            periodDocVal += val;

            itms.forEach(itm => {
              const itmDet = itm.itm_det || itm;
              const txval = parseNumber(itmDet.txval !== undefined ? itmDet.txval : itmDet.invtxval);
              const iamt = parseNumber(itmDet.iamt !== undefined ? itmDet.iamt : itmDet.inviamt);
              const camt = parseNumber(itmDet.camt !== undefined ? itmDet.camt : itmDet.invcamt);
              const samt = parseNumber(itmDet.samt !== undefined ? itmDet.samt : itmDet.invsamt);
              const csamt = parseNumber(itmDet.csamt !== undefined ? itmDet.csamt : itmDet.invcsamt);
              const rt = parseNumber(itmDet.rt || (txval > 0 ? Math.round(((iamt + camt + samt) / txval) * 100) : 18));

              periodTaxable += txval;
              periodIgst += iamt;
              periodCgst += camt;
              periodSgst += samt;
              periodCess += csamt;

              salesRows.push([
                companyGstin,
                periodLabel,
                'Invoice',
                saleType,
                inum,
                idt,
                ctin,
                cname,
                formatState(pos),
                '', // Shipping Bill Date
                '', // Shipping Bill No
                '', // Port Code
                '', // Reference Doc No
                '', // Reference Doc Date
                rchrg,
                val,
                txval,
                rt,
                iamt || '',
                camt || '',
                samt || '',
                csamt || '',
                isAmended ? 'Yes' : 'No',
                oinum,
                oidt,
                'Supplier',
                'GSTR1',
                inv.irngendate || '',
                inv.irn || '',
                isGstr1a ? 'Yes' : 'No'
              ]);
            });
          });
        });
      }

      // 2. Process B2CL & B2CLA Invoices -> Sales Sheet
      const rawB2cl = data.b2cl || [];
      const rawB2cla = data.b2cla || [];
      const b2clList = [
        ...(Array.isArray(rawB2cl) ? rawB2cl.map(x => ({ ...x, isAmendment: false })) : []),
        ...(Array.isArray(rawB2cla) ? rawB2cla.map(x => ({ ...x, isAmendment: true })) : [])
      ];

      if (b2clList.length > 0) {
        b2clList.forEach(item => {
          const pos = item.pos || '';
          const isAmended = Boolean(item.isAmendment);
          const invList = item.inv || [];
          invList.forEach(inv => {
            const inum = inv.inum || '';
            const idt = formatDate(inv.idt || '');
            const val = parseNumber(inv.val);
            const oinum = inv.oinum || '';
            const oidt = formatDate(inv.oidt || '');
            const itms = (inv.itms && inv.itms.length > 0) ? inv.itms : ((inv.items && inv.items.length > 0) ? inv.items : [inv]);

            periodCount++;
            periodDocVal += val;

            itms.forEach(itm => {
              const itmDet = itm.itm_det || itm;
              const txval = parseNumber(itmDet.txval !== undefined ? itmDet.txval : itmDet.invtxval);
              const iamt = parseNumber(itmDet.iamt !== undefined ? itmDet.iamt : itmDet.inviamt);
              const csamt = parseNumber(itmDet.csamt !== undefined ? itmDet.csamt : itmDet.invcsamt);
              const rt = parseNumber(itmDet.rt || (txval > 0 ? Math.round((iamt / txval) * 100) : 18));

              periodTaxable += txval;
              periodIgst += iamt;
              periodCess += csamt;

              salesRows.push([
                companyGstin,
                periodLabel,
                'Invoice',
                'B2CL',
                inum,
                idt,
                'URP',
                'Unregistered Person',
                formatState(pos),
                '', '', '', '', '',
                'No',
                val,
                txval,
                rt,
                iamt || '',
                '',
                '',
                csamt || '',
                isAmended ? 'Yes' : 'No',
                oinum,
                oidt,
                'Supplier',
                'GSTR1',
                '', '',
                isGstr1a ? 'Yes' : 'No'
              ]);
            });
          });
        });
      }

      // 3. Process EXP & EXPA (Exports) -> Sales Sheet
      const rawExp = data.exp || [];
      const rawExpa = data.expa || [];
      const expList = [
        ...(Array.isArray(rawExp) ? rawExp.map(x => ({ ...x, isAmendment: false })) : []),
        ...(Array.isArray(rawExpa) ? rawExpa.map(x => ({ ...x, isAmendment: true })) : [])
      ];

      if (expList.length > 0) {
        expList.forEach(expItem => {
          const expTyp = expItem.exp_typ || expItem.ex_tp || 'WPAY';
          const saleType = (expTyp === 'WPAY' || expTyp === 'EXPWP') ? 'Export with Pay' : 'Export without Pay';
          const isAmended = Boolean(expItem.isAmendment);
          const invList = expItem.inv || [];

          invList.forEach(inv => {
            const inum = inv.inum || '';
            const idt = formatDate(inv.idt || '');
            const val = parseNumber(inv.val);
            const pos = inv.pos || '97';
            const sbnum = inv.sbnum || inv.sb_num || '';
            const sbdt = formatDate(inv.sbdt || inv.sb_dt || '');
            const port_code = inv.port_code || inv.pcode || '';
            const oinum = inv.oinum || '';
            const oidt = formatDate(inv.oidt || '');
            const itms = (inv.itms && inv.itms.length > 0) ? inv.itms : ((inv.items && inv.items.length > 0) ? inv.items : [inv]);

            periodCount++;
            periodDocVal += val;

            itms.forEach(itm => {
              const itmDet = itm.itm_det || itm;
              const txval = parseNumber(itmDet.txval !== undefined ? itmDet.txval : itmDet.invtxval);
              const iamt = parseNumber(itmDet.iamt !== undefined ? itmDet.iamt : itmDet.inviamt);
              const csamt = parseNumber(itmDet.csamt !== undefined ? itmDet.csamt : itmDet.invcsamt);
              const rt = parseNumber(itmDet.rt || (txval > 0 && iamt > 0 ? Math.round((iamt / txval) * 100) : 0));

              periodTaxable += txval;
              periodIgst += iamt;
              periodCess += csamt;

              salesRows.push([
                companyGstin,
                periodLabel,
                'Export',
                saleType,
                inum,
                idt,
                'URP',
                'Overseas Buyer / Export',
                formatState(pos),
                sbdt,
                sbnum,
                port_code,
                '', '',
                'No',
                val,
                txval,
                rt,
                iamt || '',
                '',
                '',
                csamt || '',
                isAmended ? 'Yes' : 'No',
                oinum,
                oidt,
                'Supplier',
                'GSTR1',
                '', '',
                isGstr1a ? 'Yes' : 'No'
              ]);
            });
          });
        });
      }

      // 4. Process CDNR & CDNRA (Credit/Debit Notes Registered) -> Sales Sheet
      const rawCdnr = data.cdnr || [];
      const rawCdnra = data.cdnra || [];
      const cdnrList = [
        ...(Array.isArray(rawCdnr) ? rawCdnr.map(x => ({ ...x, isAmendment: false })) : []),
        ...(Array.isArray(rawCdnra) ? rawCdnra.map(x => ({ ...x, isAmendment: true })) : [])
      ];

      if (cdnrList.length > 0) {
        cdnrList.forEach(ctinItem => {
          const ctin = ctinItem.ctin || '';
          const cname = resolvePartyName(ctinItem, metadata.partyMap, '');
          const isAmended = Boolean(ctinItem.isAmendment);
          const ntList = ctinItem.nt || [];

          ntList.forEach(nt => {
            const nt_num = nt.ntnum || nt.nt_num || nt.inum || nt.num || '';
            const nt_dt = formatDate(nt.dt || nt.nt_dt || nt.idt || '');
            const isCreditNote = (nt.typ === 'C' || nt.ntty === 'C' || nt.nt_typ === 'C' || nt.ntty === 'Credit Note');
            const ntty = isCreditNote ? 'Credit Note' : 'Debit Note';
            const multiplier = isCreditNote ? -1 : 1;
            const inum = nt.inum || nt.p_inum || nt.oinum || '';
            const idt = formatDate(nt.idt || nt.p_idt || nt.oidt || '');
            const oinum = nt.ont_num || nt.oinum || '';
            const oidt = formatDate(nt.ont_dt || nt.oidt || '');
            const rawVal = parseNumber(nt.val);
            const val = rawVal * multiplier;
            const pos = nt.pos || ctin.substring(0, 2);
            const rchrg = (nt.rchrg === 'Y') ? 'Yes' : 'No';
            const splyTyp = nt.sply_ty || nt.nt_sply_ty || nt.supply_type || nt.inv_typ || nt.invtyp || ctinItem.inv_typ || '';
            const saleType = formatInvoiceType(splyTyp, 'Regular B2B');
            const itms = (nt.itms && nt.itms.length > 0) ? nt.itms : ((nt.items && nt.items.length > 0) ? nt.items : [nt]);

            periodCount++;
            periodDocVal += val;

            itms.forEach(itm => {
              const itmDet = itm.itm_det || itm;
              const rawTxval = parseNumber(itmDet.txval !== undefined ? itmDet.txval : (itm.txval !== undefined ? itm.txval : itmDet.invtxval));
              const txval = rawTxval * multiplier;
              const iamt = parseNumber(itmDet.iamt !== undefined ? itmDet.iamt : (itm.iamt !== undefined ? itm.iamt : (itmDet.inviamt !== undefined ? itmDet.inviamt : (itm.igst !== undefined ? itm.igst : 0)))) * multiplier;
              const camt = parseNumber(itmDet.camt !== undefined ? itmDet.camt : (itm.camt !== undefined ? itm.camt : (itmDet.invcamt !== undefined ? itmDet.invcamt : (itm.cgst !== undefined ? itm.cgst : 0)))) * multiplier;
              const samt = parseNumber(itmDet.samt !== undefined ? itmDet.samt : (itm.samt !== undefined ? itm.samt : (itmDet.invsamt !== undefined ? itmDet.invsamt : (itm.sgst !== undefined ? itm.sgst : 0)))) * multiplier;
              const csamt = parseNumber(itmDet.csamt !== undefined ? itmDet.csamt : (itm.csamt !== undefined ? itm.csamt : (itmDet.invcsamt !== undefined ? itmDet.invcsamt : (itm.cess !== undefined ? itm.cess : 0)))) * multiplier;
              const rt = parseNumber(itmDet.rt || (rawTxval > 0 ? Math.round(((Math.abs(iamt) + Math.abs(camt) + Math.abs(samt)) / rawTxval) * 100) : 18));

              periodTaxable += txval;
              periodIgst += iamt;
              periodCgst += camt;
              periodSgst += samt;
              periodCess += csamt;

              salesRows.push([
                companyGstin,
                periodLabel,
                ntty,
                saleType,
                nt_num,
                nt_dt,
                ctin,
                cname,
                formatState(pos),
                '', '', '',
                inum,
                idt,
                rchrg,
                val,
                txval,
                rt,
                iamt || '',
                camt || '',
                samt || '',
                csamt || '',
                isAmended ? 'Yes' : 'No',
                oinum,
                oidt,
                'Supplier',
                'GSTR1',
                '', '',
                isGstr1a ? 'Yes' : 'No'
              ]);
            });
          });
        });
      }

      // 5. Process CDNUR & CDNURA (Credit/Debit Notes to Unregistered) -> Sales Sheet
      const rawCdnur = data.cdnur || [];
      const rawCdnura = data.cdnura || [];
      const cdnurList = [
        ...(Array.isArray(rawCdnur) ? rawCdnur.map(x => ({ ...x, isAmendment: false })) : []),
        ...(Array.isArray(rawCdnura) ? rawCdnura.map(x => ({ ...x, isAmendment: true })) : [])
      ];

      if (cdnurList.length > 0) {
        cdnurList.forEach(nt => {
          const isAmended = Boolean(nt.isAmendment);
          const nt_num = nt.ntnum || nt.nt_num || nt.inum || nt.num || '';
          const nt_dt = formatDate(nt.dt || nt.nt_dt || nt.idt || '');
          const isCreditNote = (nt.typ === 'C' || nt.ntty === 'C' || nt.nt_typ === 'C' || nt.ntty === 'Credit Note');
          const ntty = isCreditNote ? 'Credit Note' : 'Debit Note';
          const multiplier = isCreditNote ? -1 : 1;
          const inum = nt.inum || nt.p_inum || nt.oinum || '';
          const idt = formatDate(nt.idt || nt.p_idt || nt.oidt || '');
          const oinum = nt.ont_num || nt.oinum || '';
          const oidt = formatDate(nt.ont_dt || nt.oidt || '');
          const rawVal = parseNumber(nt.val);
          const val = rawVal * multiplier;
          const pos = nt.pos || '97';
          const itms = (nt.itms && nt.itms.length > 0) ? nt.itms : ((nt.items && nt.items.length > 0) ? nt.items : [nt]);

          periodCount++;
          periodDocVal += val;

          itms.forEach(itm => {
            const itmDet = itm.itm_det || itm;
            const rawTxval = parseNumber(itmDet.txval !== undefined ? itmDet.txval : (itm.txval !== undefined ? itm.txval : itmDet.invtxval));
            const txval = rawTxval * multiplier;
            const iamt = parseNumber(itmDet.iamt !== undefined ? itmDet.iamt : (itm.iamt !== undefined ? itm.iamt : (itmDet.inviamt !== undefined ? itmDet.inviamt : (itm.igst !== undefined ? itm.igst : 0)))) * multiplier;
            const camt = parseNumber(itmDet.camt !== undefined ? itmDet.camt : (itm.camt !== undefined ? itm.camt : (itmDet.invcamt !== undefined ? itmDet.invcamt : (itm.cgst !== undefined ? itm.cgst : 0)))) * multiplier;
            const samt = parseNumber(itmDet.samt !== undefined ? itmDet.samt : (itm.samt !== undefined ? itm.samt : (itmDet.invsamt !== undefined ? itmDet.invsamt : (itm.sgst !== undefined ? itm.sgst : 0)))) * multiplier;
            const csamt = parseNumber(itmDet.csamt !== undefined ? itmDet.csamt : (itm.csamt !== undefined ? itm.csamt : (itmDet.invcsamt !== undefined ? itmDet.invcsamt : (itm.cess !== undefined ? itm.cess : 0)))) * multiplier;
            const rt = parseNumber(itmDet.rt || (rawTxval > 0 ? Math.round(((Math.abs(iamt) + Math.abs(camt) + Math.abs(samt)) / rawTxval) * 100) : 18));

            periodTaxable += txval;
            periodIgst += iamt;
            periodCgst += camt;
            periodSgst += samt;
            periodCess += csamt;

            salesRows.push([
              companyGstin,
              periodLabel,
              ntty,
              'CDNUR',
              nt_num,
              nt_dt,
              'URP',
              'Unregistered Person / Export',
              formatState(pos),
              '', '', '',
              inum,
              idt,
              'No',
              val,
              txval,
              rt,
              iamt || '',
              camt || '',
              samt || '',
              csamt || '',
              isAmended ? 'Yes' : 'No',
              oinum,
              oidt,
              'Supplier',
              'GSTR1',
              '', '',
              isGstr1a ? 'Yes' : 'No'
            ]);
          });
        });
      }

      // 6. Process B2CS & B2CSA Summary Records -> SalesSummary Sheet
      const rawB2cs = Array.isArray(data.b2cs) ? [...data.b2cs] : [];
      let rawB2csa = Array.isArray(data.b2csa) ? [...data.b2csa] : [];

      // If B2CSA item list wasn't returned by invoice API, synthesize from sec_sum if available
      if (rawB2csa.length === 0 && Array.isArray(data.sec_sum)) {
        const b2csaSec = data.sec_sum.find(s => (s.sec_nm || '').toUpperCase() === 'B2CSA');
        if (b2csaSec && (b2csaSec.ttl_rec > 0 || b2csaSec.act_tax !== undefined || b2csaSec.ttl_tax !== undefined)) {
          const actTax = parseNumber(b2csaSec.act_tax);
          const actI = parseNumber(b2csaSec.act_igst);
          const actC = parseNumber(b2csaSec.act_cgst);
          const actS = parseNumber(b2csaSec.act_sgst);
          const actCs = parseNumber(b2csaSec.act_cess);
          const diffTax = parseNumber(b2csaSec.ttl_tax);
          const diffI = parseNumber(b2csaSec.ttl_igst);
          const diffC = parseNumber(b2csaSec.ttl_cgst);
          const diffS = parseNumber(b2csaSec.ttl_sgst);
          const diffCs = parseNumber(b2csaSec.ttl_cess);

          // Rate calculation
          const totTax = actI + actC + actS;
          const rt = (actTax > 0 && totTax > 0) ? Math.round((totTax / actTax) * 100) : (diffTax !== 0 && (diffI + diffC + diffS) !== 0 ? Math.round((Math.abs(diffI + diffC + diffS) / Math.abs(diffTax)) * 100) : 5);
          const pos = companyGstin ? companyGstin.substring(0, 2) : '';

          rawB2csa = [{
            isAmendment: true,
            sply_ty: 'OE',
            pos: pos,
            rt: rt,
            txval: (actTax !== 0 || diffTax === 0) ? actTax : diffTax,
            iamt: (actTax !== 0 || diffTax === 0) ? actI : diffI,
            camt: (actTax !== 0 || diffTax === 0) ? actC : diffC,
            samt: (actTax !== 0 || diffTax === 0) ? actS : diffS,
            csamt: (actTax !== 0 || diffTax === 0) ? actCs : diffCs,
            omon: b2csaSec.omon || period
          }];
        }
      }

      // If B2CS is empty but sec_sum has B2CS figures
      if (rawB2cs.length === 0 && Array.isArray(data.sec_sum)) {
        const b2csSec = data.sec_sum.find(s => (s.sec_nm || '').toUpperCase() === 'B2CS');
        if (b2csSec && (b2csSec.ttl_rec > 0 || b2csSec.ttl_tax > 0)) {
          const tx = parseNumber(b2csSec.ttl_tax ?? b2csSec.txval);
          const i = parseNumber(b2csSec.ttl_igst ?? b2csSec.iamt);
          const c = parseNumber(b2csSec.ttl_cgst ?? b2csSec.camt);
          const s = parseNumber(b2csSec.ttl_sgst ?? b2csSec.samt);
          const cs = parseNumber(b2csSec.ttl_cess ?? b2csSec.csamt);
          const totTax = i + c + s;
          const rt = (tx > 0 && totTax > 0) ? Math.round((totTax / tx) * 100) : 5;
          const pos = companyGstin ? companyGstin.substring(0, 2) : '';
          rawB2cs.push({
            isAmendment: false,
            sply_ty: 'OE',
            pos: pos,
            rt: rt,
            txval: tx,
            iamt: i,
            camt: c,
            samt: s,
            csamt: cs
          });
        }
      }

      // Track GSTR-1A differential data if available
      if (Array.isArray(data.sec_sum)) {
        const ttlLiabSec = data.sec_sum.find(s => (s.sec_nm || '').toUpperCase() === 'TTL_LIAB');
        const b2csaSec = data.sec_sum.find(s => (s.sec_nm || '').toUpperCase() === 'B2CSA');
        const diffSec = ttlLiabSec || b2csaSec;
        if (diffSec && (diffSec.act_tax !== undefined || diffSec.ttl_tax !== undefined)) {
          hasGstr1aDelta = true;
          grandDiffTaxable += parseNumber(diffSec.ttl_tax);
          grandDiffIgst += parseNumber(diffSec.ttl_igst);
          grandDiffCgst += parseNumber(diffSec.ttl_cgst);
          grandDiffSgst += parseNumber(diffSec.ttl_sgst);
          grandDiffCess += parseNumber(diffSec.ttl_cess);
        }
      }

      // Track original GSTR-1 summary if attached
      if (Array.isArray(data.gstr1_summary)) {
        const g1TtlLiab = data.gstr1_summary.find(s => (s.sec_nm || '').toUpperCase() === 'TTL_LIAB' || (s.sec_nm || '').toUpperCase() === 'B2CS');
        if (g1TtlLiab) {
          hasG1Summary = true;
          grandG1Taxable += parseNumber(g1TtlLiab.ttl_tax ?? g1TtlLiab.taxable_value);
          const g1I = parseNumber(g1TtlLiab.ttl_igst ?? g1TtlLiab.igst);
          const g1C = parseNumber(g1TtlLiab.ttl_cgst ?? g1TtlLiab.cgst);
          const g1S = parseNumber(g1TtlLiab.ttl_sgst ?? g1TtlLiab.sgst);
          const g1Cs = parseNumber(g1TtlLiab.ttl_cess ?? g1TtlLiab.cess);
          grandG1Tax += (g1I + g1C + g1S + g1Cs);
        }
      }

      const b2csList = [
        ...(Array.isArray(rawB2cs) ? rawB2cs.map(x => ({ ...x, isAmendment: false })) : []),
        ...(Array.isArray(rawB2csa) ? rawB2csa.map(x => ({ ...x, isAmendment: true })) : [])
      ];

      if (b2csList.length > 0) {
        b2csList.forEach(item => {
          const isAmended = Boolean(item.isAmendment);
          const sply_ty = item.sply_ty || 'OE';
          const pos = item.pos || '';
          const rt = parseNumber(item.rt);
          const txval = parseNumber(item.txval);
          const iamt = parseNumber(item.iamt);
          const camt = parseNumber(item.camt);
          const samt = parseNumber(item.samt);
          const csamt = parseNumber(item.csamt);
          const etin = item.etin || '';
          const omon = item.omon ? formatPeriodMonth(item.omon) : '';

          const grossB2csVal = txval + iamt + camt + samt + csamt;
          periodDocVal += grossB2csVal;

          periodTaxable += txval;
          periodIgst += iamt;
          periodCgst += camt;
          periodSgst += samt;
          periodCess += csamt;

          salesSummaryRows.push([
            companyGstin,
            periodLabel,
            isAmended ? 'B2CSA' : 'B2CS',
            isAmended ? 'Amended B2CS Supplies' : 'B2CS Supplies',
            formatState(pos),
            txval,
            rt,
            iamt || '',
            camt || '',
            samt || '',
            csamt || '',
            etin,
            omon,
            '',
            isGstr1a ? 'Yes' : 'No'
          ]);
        });
      }

      // 7. Process Table 11A Advances Received (AT & ATA) -> SalesSummary Sheet
      const rawAt = data.at || [];
      const rawAta = data.ata || [];
      const atList = [
        ...(Array.isArray(rawAt) ? rawAt.map(x => ({ ...x, isAmendment: false })) : []),
        ...(Array.isArray(rawAta) ? rawAta.map(x => ({ ...x, isAmendment: true })) : [])
      ];

      if (atList.length > 0) {
        atList.forEach(item => {
          const isAmended = Boolean(item.isAmendment);
          const pos = item.pos || '';
          const omon = item.omon ? formatPeriodMonth(item.omon) : '';
          const itms = item.itms || [item];
          itms.forEach(itm => {
            const itmDet = itm.itm_det || itm;
            const txval = parseNumber(itmDet.ad_amt !== undefined ? itmDet.ad_amt : (itmDet.txval !== undefined ? itmDet.txval : itm.ad_amt));
            const iamt = parseNumber(itmDet.iamt);
            const camt = parseNumber(itmDet.camt);
            const samt = parseNumber(itmDet.samt);
            const csamt = parseNumber(itmDet.csamt);
            const rt = parseNumber(itmDet.rt || (txval > 0 && (iamt + camt + samt) > 0 ? Math.round(((iamt + camt + samt) / txval) * 100) : 18));

            periodIgst += iamt;
            periodCgst += camt;
            periodSgst += samt;
            periodCess += csamt;

            salesSummaryRows.push([
              companyGstin,
              periodLabel,
              isAmended ? 'ATA' : 'AT',
              isAmended ? 'Amended Advance Received (Table 11A)' : 'Tax on Advance Received (Table 11A)',
              formatState(pos),
              txval,
              rt,
              iamt || '',
              camt || '',
              samt || '',
              csamt || '',
              '',
              omon,
              '',
              isGstr1a ? 'Yes' : 'No'
            ]);
          });
        });
      }

      // 8. Process Table 11B Advances Adjusted (TXPD & TXPDA) -> SalesSummary Sheet
      const rawTxpd = data.txpd || [];
      const rawTxpda = data.txpda || [];
      const txpdList = [
        ...(Array.isArray(rawTxpd) ? rawTxpd.map(x => ({ ...x, isAmendment: false })) : []),
        ...(Array.isArray(rawTxpda) ? rawTxpda.map(x => ({ ...x, isAmendment: true })) : [])
      ];

      if (txpdList.length > 0) {
        txpdList.forEach(item => {
          const isAmended = Boolean(item.isAmendment);
          const pos = item.pos || '';
          const omon = item.omon ? formatPeriodMonth(item.omon) : '';
          const itms = item.itms || [item];
          itms.forEach(itm => {
            const itmDet = itm.itm_det || itm;
            const txval = parseNumber(itmDet.ad_amt !== undefined ? itmDet.ad_amt : (itmDet.txval !== undefined ? itmDet.txval : itm.ad_amt));
            const iamt = parseNumber(itmDet.iamt);
            const camt = parseNumber(itmDet.camt);
            const samt = parseNumber(itmDet.samt);
            const csamt = parseNumber(itmDet.csamt);
            const rt = parseNumber(itmDet.rt || (txval > 0 && (iamt + camt + samt) > 0 ? Math.round(((iamt + camt + samt) / txval) * 100) : 18));

            periodIgst -= iamt;
            periodCgst -= camt;
            periodSgst -= samt;
            periodCess -= csamt;

            salesSummaryRows.push([
              companyGstin,
              periodLabel,
              isAmended ? 'TXPDA' : 'TXPD',
              isAmended ? 'Amended Advance Adjusted (Table 11B)' : 'Advance Tax Adjusted (Table 11B)',
              formatState(pos),
              -txval,
              rt,
              iamt ? -iamt : '',
              camt ? -camt : '',
              samt ? -samt : '',
              csamt ? -csamt : '',
              '',
              omon,
              '',
              isGstr1a ? 'Yes' : 'No'
            ]);
          });
        });
      }

      // 9. Process Table 14 & 15 E-Commerce Supplies (ECOM, ECOMA, SUPECOM, SUPECOMA) -> SalesSummary Sheet
      const rawEcom = [
        ...(Array.isArray(data.ecom) ? data.ecom.map(x => ({ ...x, type: 'ECOM', desc: 'E-Commerce Supplies (Table 14(a))' })) : []),
        ...(Array.isArray(data.ecoma) ? data.ecoma.map(x => ({ ...x, type: 'ECOMA', desc: 'Amended E-Commerce Supplies (Table 14(a))' })) : []),
        ...(Array.isArray(data.supecom) ? data.supecom.map(x => ({ ...x, type: 'SUPECOM', desc: 'Section 9(5) Supplies (Table 14(b))' })) : []),
        ...(Array.isArray(data.supecoma) ? data.supecoma.map(x => ({ ...x, type: 'SUPECOMA', desc: 'Amended Section 9(5) Supplies (Table 14(b))' })) : [])
      ];

      if (rawEcom.length > 0) {
        rawEcom.forEach(item => {
          const etin = item.etin || item.ecom_gstin || '';
          const pos = item.pos || '';
          const txval = parseNumber(item.txval || item.supp_val);
          const iamt = parseNumber(item.iamt || item.igst);
          const camt = parseNumber(item.camt || item.cgst);
          const samt = parseNumber(item.samt || item.sgst);
          const csamt = parseNumber(item.csamt || item.cess);
          const rt = parseNumber(item.rt || (txval > 0 && (iamt + camt + samt) > 0 ? Math.round(((iamt + camt + samt) / txval) * 100) : 0));

          salesSummaryRows.push([
            companyGstin,
            periodLabel,
            item.type,
            item.desc,
            formatState(pos),
            txval,
            rt,
            iamt || '',
            camt || '',
            samt || '',
            csamt || '',
            etin,
            '',
            '',
            isGstr1a ? 'Yes' : 'No'
          ]);
        });
      }

      // 10. Process Table 8 Nil Rated, Exempted & Non-GST Supplies -> Nil & Exempted Supplies Sheet
      let nilList = [];
      if (data.nil) {
        if (Array.isArray(data.nil.inv)) nilList.push(...data.nil.inv);
        else if (Array.isArray(data.nil.data)) nilList.push(...data.nil.data);
        else if (Array.isArray(data.nil)) nilList.push(...data.nil);
      }
      if (Array.isArray(data.nil_supplies)) {
        nilList.push(...data.nil_supplies);
      }

      if (nilList.length > 0) {
        nilList.forEach(item => {
          const sply_ty = String(item.sply_ty || item.supply_type || '').toUpperCase();
          const desc = NIL_SUPPLY_TYPES[sply_ty] || item.desc || sply_ty || 'Nil/Exempt Outward Supply';
          const nil_amt = parseNumber(item.nil_amt ?? item.nil_supplies ?? item.nil ?? item.ttl_nilsup_amt);
          const expt_amt = parseNumber(item.expt_amt ?? item.expt ?? item.ttl_expt_amt);
          const ngsup_amt = parseNumber(item.ngsup_amt ?? item.ngsup ?? item.ttl_ngsup_amt);
          const tot_nil = nil_amt + expt_amt + ngsup_amt;

          periodNil += nil_amt;
          periodExempt += expt_amt;
          periodNonGst += ngsup_amt;
          periodDocVal += tot_nil;

          nilRatedRows.push([
            companyGstin,
            periodLabel,
            desc,
            sply_ty,
            nil_amt,
            expt_amt,
            ngsup_amt,
            tot_nil,
            isGstr1a ? 'Yes' : 'No'
          ]);
        });
      } else if (Array.isArray(data.sec_sum)) {
        const nilSec = data.sec_sum.find(s => (s.sec_nm || '').toUpperCase() === 'NIL');
        if (nilSec) {
          const nil_amt = parseNumber(nilSec.ttl_nilsup_amt);
          const expt_amt = parseNumber(nilSec.ttl_expt_amt);
          const ngsup_amt = parseNumber(nilSec.ttl_ngsup_amt);
          const tot_nil = nil_amt + expt_amt + ngsup_amt;
          if (tot_nil > 0) {
            periodNil += nil_amt;
            periodExempt += expt_amt;
            periodNonGst += ngsup_amt;
            periodDocVal += tot_nil;

            nilRatedRows.push([
              companyGstin,
              periodLabel,
              'Nil Rated, Exempted and Non-GST Supplies (Summary)',
              'TABLE-8',
              nil_amt,
              expt_amt,
              ngsup_amt,
              tot_nil,
              isGstr1a ? 'Yes' : 'No'
            ]);
          }
        }
      }

      // If sec_sum is present and document arrays were empty, extract summary figures for Overview
      if (periodTaxable === 0 && Array.isArray(data.sec_sum) && data.sec_sum.length > 0) {
        data.sec_sum.forEach(sec => {
          const secName = (sec.sec_nm || '').toUpperCase();
          if (secName === 'NIL' || secName === 'DOC_ISSUE' || secName === 'TTL_LIAB' || secName.startsWith('HSN')) return;
          const txval = parseNumber(sec.txval ?? sec.tax_val ?? sec.taxable_value ?? sec.act_tax ?? sec.ttl_tax);
          const iamt  = parseNumber(sec.iamt ?? sec.igst ?? sec.act_igst ?? sec.ttl_igst);
          const camt  = parseNumber(sec.camt ?? sec.cgst ?? sec.act_cgst ?? sec.ttl_cgst);
          const samt  = parseNumber(sec.samt ?? sec.sgst ?? sec.act_sgst ?? sec.ttl_sgst);
          const csamt = parseNumber(sec.csamt ?? sec.cess ?? sec.act_cess ?? sec.ttl_cess);
          const val   = parseNumber(sec.val ?? sec.act_val ?? sec.ttl_val ?? (txval + iamt + camt + samt + csamt));
          const recs  = parseNumber(sec.ttl_rec ?? sec.count ?? sec.total_records ?? sec.rec_count);

          periodTaxable += txval;
          periodIgst += iamt;
          periodCgst += camt;
          periodSgst += samt;
          periodCess += csamt;
          periodDocVal += val;
          periodCount += recs;
        });
      }

      // 8. Process Table 12 HSN Summary -> SalesHSN Sheet
      let hsnData = [];
      if (data.hsn) {
        if (Array.isArray(data.hsn.hsn_b2b)) {
          hsnData.push(...data.hsn.hsn_b2b.map(h => ({ ...h, summary_type: 'B2B' })));
        }
        if (Array.isArray(data.hsn.hsn_b2c)) {
          hsnData.push(...data.hsn.hsn_b2c.map(h => ({ ...h, summary_type: 'B2C' })));
        }
        if (Array.isArray(data.hsn.data)) {
          hsnData.push(...data.hsn.data.map(h => ({ ...h, summary_type: h.summary_type || 'B2B' })));
        }
        if (Array.isArray(data.hsn)) {
          hsnData.push(...data.hsn.map(h => ({ ...h, summary_type: h.summary_type || 'B2B' })));
        }
      }
      if (Array.isArray(data.hsn_b2b)) {
        hsnData.push(...data.hsn_b2b.map(h => ({ ...h, summary_type: 'B2B' })));
      }
      if (Array.isArray(data.hsn_b2c)) {
        hsnData.push(...data.hsn_b2c.map(h => ({ ...h, summary_type: 'B2C' })));
      }

      if (Array.isArray(hsnData) && hsnData.length > 0) {
        hsnData.forEach(hItem => {
          const summaryType = hItem.summary_type || 'B2B';
          const hsn_sc = hItem.hsn_sc || hItem.hsn || '';
          const desc = hItem.desc || '';
          const uqc = hItem.uqc || '';
          const qty = parseNumber(hItem.qty);
          const txval = parseNumber(hItem.txval);
          const rt = parseNumber(hItem.rt);
          const iamt = parseNumber(hItem.iamt);
          const camt = parseNumber(hItem.camt);
          const samt = parseNumber(hItem.samt);
          const csamt = parseNumber(hItem.csamt);
          const val = parseNumber(hItem.val || (txval + iamt + camt + samt + csamt));

          salesHsnRows.push([
            companyGstin,
            periodLabel,
            summaryType,
            hsn_sc,
            desc,
            uqc || '',
            qty || '',
            val,
            txval,
            rt,
            iamt || 0,
            camt || 0,
            samt || 0,
            csamt || 0,
            isGstr1a ? 'Yes' : 'No'
          ]);
        });
      }

      // If HSN records are empty (e.g. unamended in GSTR-1A) but original GSTR-1 summary has HSN figures
      if (salesHsnRows.length === 0 && Array.isArray(data.gstr1_summary)) {
        const g1HsnSec = data.gstr1_summary.find(s => (s.sec_nm || '').toUpperCase() === 'HSN' || (s.sec_nm || '').toUpperCase() === 'HSN_B2C');
        if (g1HsnSec && (g1HsnSec.ttl_rec > 0 || g1HsnSec.ttl_tax > 0)) {
          const hsnTxval = parseNumber(g1HsnSec.ttl_tax);
          const hsnI = parseNumber(g1HsnSec.ttl_igst);
          const hsnC = parseNumber(g1HsnSec.ttl_cgst);
          const hsnS = parseNumber(g1HsnSec.ttl_sgst);
          const hsnCs = parseNumber(g1HsnSec.ttl_cess);
          const totTax = hsnI + hsnC + hsnS;
          const rt = (hsnTxval > 0 && totTax > 0) ? Math.round((totTax / hsnTxval) * 100) : 5;
          salesHsnRows.push([
            companyGstin,
            periodLabel,
            'Original GSTR-1',
            'HSN-SUMMARY',
            'Filed GSTR-1 HSN Supplies (Unamended in GSTR-1A)',
            'OTH',
            g1HsnSec.ttl_rec || '',
            hsnTxval + totTax + hsnCs,
            hsnTxval,
            rt,
            hsnI,
            hsnC,
            hsnS,
            hsnCs,
            'No'
          ]);
        }
      }

      // 9. Process Table 13 Document Series -> DocIssued Sheet
      const rawDocData = data.doc_issue || data.doc_issued || (data.sec_sum && !Array.isArray(data.sec_sum) && (data.sec_sum.doc_issue || data.sec_sum.doc_issued)) || {};
      const docData = rawDocData.doc_det ? rawDocData.doc_det : (Array.isArray(rawDocData) ? rawDocData : (Array.isArray(rawDocData.docs) ? [rawDocData] : []));
      
      const docNumMap = {
        1: "Invoice for outward supply",
        2: "Invoice for inward supply from unregistered person",
        3: "Revised Invoice",
        4: "Debit Note",
        5: "Credit Note",
        6: "Receipt voucher",
        7: "Payment Voucher",
        8: "Refund voucher",
        9: "Delivery Challan for job work",
        10: "Delivery Challan for supply on approval",
        11: "Delivery Challan in case of liquid gas",
        12: "Delivery Challan in cases other than by way of supply"
      };

      let docRowsAdded = false;
      if (Array.isArray(docData) && docData.length > 0) {
        docData.forEach(dItem => {
          const docDesc = dItem.doc_desc || docNumMap[dItem.doc_num] || 'Invoice for outward supply';
          const docs = dItem.docs || (dItem.from ? [dItem] : []);
          docs.forEach(doc => {
            let totalCount = parseNumber(doc.tot_rec || doc.totrec || doc.tot_doc || doc.totdoc || doc.total || doc.tot || doc.net_issue);
            if (totalCount === 0 && doc.from && doc.to) {
              const fromN = parseInt(String(doc.from).replace(/\D/g, ''), 10);
              const toN = parseInt(String(doc.to).replace(/\D/g, ''), 10);
              if (!isNaN(fromN) && !isNaN(toN) && toN >= fromN) {
                totalCount = (toN - fromN) + 1;
              }
            }

            const cancelledCount = parseNumber(doc.canc || doc.cancelled || doc.canc_doc || doc.canc_rec);

            docIssuedRows.push([
              companyGstin,
              periodLabel,
              docDesc,
              doc.from || '',
              doc.to || '',
              totalCount,
              cancelledCount,
              isGstr1a ? 'Yes' : 'No'
            ]);
            docRowsAdded = true;
          });
        });
      }

      // Fallback: If doc rows were empty, check if doc_issue exists in data.sec_sum array
      if (!docRowsAdded && Array.isArray(data.sec_sum)) {
        const docSec = data.sec_sum.find(s => (s.sec_nm || '').toUpperCase() === 'DOC_ISSUE' || (s.sec_nm || '').toUpperCase() === 'DOC');
        if (docSec && (docSec.ttl_doc_issued || docSec.net_doc_issued || docSec.ttl_rec)) {
          const totalIssued = parseNumber(docSec.ttl_doc_issued || docSec.net_doc_issued || docSec.ttl_rec);
          const totalCancelled = parseNumber(docSec.ttl_doc_cancelled);
          docIssuedRows.push([
            companyGstin,
            periodLabel,
            'Total Documents Issued (Table 13 Summary)',
            '',
            '',
            totalIssued,
            totalCancelled,
            isGstr1a ? 'Yes' : 'No'
          ]);
        }
      }

      grandTaxable += periodTaxable;
      grandNil += periodNil;
      grandExempt += periodExempt;
      grandNonGst += periodNonGst;
      grandIgst += periodIgst;
      grandCgst += periodCgst;
      grandSgst += periodSgst;
      grandCess += periodCess;
      grandDocValue += periodDocVal;
      grandInvCount += periodCount;
    });

    // Sort B2B supplies chronologically from Oldest to Newest, and invoice-wise BEFORE appending Total row
    function parseDateToTimestamp(dateStr) {
      if (!dateStr || typeof dateStr !== 'string') return 0;
      const m = dateStr.trim().match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
      if (m) {
        return new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10)).getTime();
      }
      return 0;
    }

    salesRows.sort((a, b) => {
      const dtA = parseDateToTimestamp(a[5]);
      const dtB = parseDateToTimestamp(b[5]);
      if (dtA !== dtB) return dtA - dtB;
      const numA = String(a[4] || '');
      const numB = String(b[4] || '');
      return numA.localeCompare(numB, undefined, { numeric: true, sensitivity: 'base' });
    });

    // Append dynamic Excel formula Total rows to data sheets (at the very bottom)
    if (salesRows.length > 0) {
      const N = salesRows.length + 1;
      const totalRow = [
        'Total', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
        `=SUM(P2:P${N})`,
        `=SUM(Q2:Q${N})`,
        '',
        `=SUM(S2:S${N})`,
        `=SUM(T2:T${N})`,
        `=SUM(U2:U${N})`,
        `=SUM(V2:V${N})`,
        '', '', '', '', '', '', '', ''
      ];
      totalRow.__isSummary = true;
      salesRows.push(totalRow);
    }

    if (salesSummaryRows.length > 0) {
      const N = salesSummaryRows.length + 1;
      const totalRow = [
        'Total', '', '', '', '',
        `=SUM(F2:F${N})`,
        '',
        `=SUM(H2:H${N})`,
        `=SUM(I2:I${N})`,
        `=SUM(J2:J${N})`,
        `=SUM(K2:K${N})`,
        '', '', '', ''
      ];
      totalRow.__isSummary = true;
      salesSummaryRows.push(totalRow);
    }

    if (nilRatedRows.length > 0) {
      const N = nilRatedRows.length + 1;
      const totalRow = [
        'Total', '', '', '',
        `=SUM(E2:E${N})`,
        `=SUM(F2:F${N})`,
        `=SUM(G2:G${N})`,
        `=SUM(H2:H${N})`,
        ''
      ];
      totalRow.__isSummary = true;
      nilRatedRows.push(totalRow);
    }

    if (salesHsnRows.length > 0) {
      const N = salesHsnRows.length + 1;
      const totalRow = [
        'Total', '', '', '', '', '',
        `=SUM(G2:G${N})`,
        `=SUM(H2:H${N})`,
        `=SUM(I2:I${N})`,
        '',
        `=SUM(K2:K${N})`,
        `=SUM(L2:L${N})`,
        `=SUM(M2:M${N})`,
        `=SUM(N2:N${N})`,
        ''
      ];
      totalRow.__isSummary = true;
      salesHsnRows.push(totalRow);
    }

    if (docIssuedRows.length > 0) {
      const N = docIssuedRows.length + 1;
      const totalRow = [
        'Total', '', '', '', '',
        `=SUM(F2:F${N})`,
        `=SUM(G2:G${N})`,
        ''
      ];
      totalRow.__isSummary = true;
      docIssuedRows.push(totalRow);
    }

    // ── 1. Sheet: Executive Summary ──
    const matrixHeader = ['--- STATUTORY SALES & TAX RECONCILIATION MATRIX ---', ''];
    matrixHeader.__isSummary = true;
    overviewRows.push(matrixHeader);

    overviewRows.push(['Total Invoices & Notes', grandInvCount]);
    overviewRows.push(['Total Taxable Turnover (₹)', grandTaxable]);
    overviewRows.push(['Total Nil Rated Supplies (₹)', grandNil]);
    overviewRows.push(['Total Exempted Supplies (₹)', grandExempt]);
    overviewRows.push(['Total Non-GST Outward Supplies (₹)', grandNonGst]);

    const aggTurnover = grandTaxable + grandNil + grandExempt + grandNonGst;
    const aggTurnoverRow = ['Total Aggregate Turnover (₹)', aggTurnover];
    aggTurnoverRow.__isSummary = true;
    overviewRows.push(aggTurnoverRow);

    overviewRows.push(['Total Integrated Tax - IGST (₹)', grandIgst]);
    overviewRows.push(['Total Central Tax - CGST (₹)', grandCgst]);
    overviewRows.push(['Total State/UT Tax - SGST (₹)', grandSgst]);
    overviewRows.push(['Total Cess (₹)', grandCess]);

    const netTaxRow = ['Total Output Tax Liability (₹)', grandIgst + grandCgst + grandSgst + grandCess];
    netTaxRow.__isSummary = true;
    overviewRows.push(netTaxRow);

    overviewRows.push(['Total Gross Invoiced Value (₹)', aggTurnover + grandIgst + grandCgst + grandSgst + grandCess]);

    if (isAnyPeriodGstr1a || hasGstr1aDelta) {
      overviewRows.push(['', '']);
      const g1aHeader = ['--- GSTR-1A STATUTORY AMENDMENT & DIFFERENTIAL IMPACT ---', ''];
      g1aHeader.__isSummary = true;
      overviewRows.push(g1aHeader);

      if (hasG1Summary) {
        overviewRows.push(['Original GSTR-1 Taxable Turnover (₹)', grandG1Taxable]);
        overviewRows.push(['Original GSTR-1 Total Tax Liability (₹)', grandG1Tax]);
      }
      overviewRows.push(['Amended GSTR-1A Taxable Turnover (₹)', grandTaxable]);
      overviewRows.push(['Amended GSTR-1A Total Tax Liability (₹)', grandIgst + grandCgst + grandSgst + grandCess]);

      if (hasGstr1aDelta) {
        overviewRows.push(['Differential Taxable Turnover Impact (₹)', grandDiffTaxable]);
        overviewRows.push(['Differential IGST Impact (₹)', grandDiffIgst]);
        overviewRows.push(['Differential CGST Impact (₹)', grandDiffCgst]);
        overviewRows.push(['Differential SGST Impact (₹)', grandDiffSgst]);
        overviewRows.push(['Differential Cess Impact (₹)', grandDiffCess]);
        const grandDiffTotalTax = grandDiffIgst + grandDiffCgst + grandDiffSgst + grandDiffCess;
        const diffTotalRow = ['Net Differential Tax Impact for GSTR-3B (₹)', grandDiffTotalTax];
        diffTotalRow.__isSummary = true;
        overviewRows.push(diffTotalRow);
      }
    }

    wb.addSheet(
      'Executive Summary',
      ['Audit Parameter / Statutory Metric', 'Value / Details'],
      overviewRows,
      { 
        autoFilter: false,
        freezeHeader: false,
        tabColor: '1E3A8A',
        columnWidths: [44, 0] 
      }
    );

    // ── 2. Sheet: B2B & Outward Supplies (Document Standard) ──
    wb.addSheet(
      'B2B & Outward Supplies',
      ['Company GSTIN', 'Tax Period', 'Doc Type', 'Sale Type', 'Doc No', 'Doc Date', 'Customer GSTIN', 'Customer Name', 'Place of Supply', 'Shipping Bill Date', 'Shipping Bill No', 'Port Code', 'Reference Doc No', 'Reference Doc Date', 'Reverse Charge', 'Doc Value', 'Item Taxable Value', 'GST Rate', 'IGST', 'CGST', 'SGST', 'Cess', 'Is Amendment', 'Original Doc No', 'Original Doc Date', 'Uploaded By', 'Source', 'IRN Date', 'IRN', 'GSTR-1A'],
      salesRows,
      { 
        tabColor: '059669',
        freezeColumns: 6,
        columnWidths: [18, 14, 14, 26, 16, 12, 18, 32, 18, 16, 16, 12, 18, 16, 14, 16, 18, 10, 14, 14, 14, 12, 14, 18, 16, 12, 10, 14, 20, 10] 
      }
    );

    // ── 3. Sheet: B2C Sales Summary ──
    wb.addSheet(
      'B2C Sales Summary',
      ['Company GSTIN', 'Tax Period', 'Summary Type', 'Description', 'Place of Supply', 'Taxable Value', 'GST Rate', 'IGST', 'CGST', 'SGST', 'Cess', 'Ecommerce GSTIN', 'Original Period', 'Original Ecommerce GSTIN', 'GSTR-1A'],
      salesSummaryRows,
      { 
        tabColor: '2563EB',
        freezeColumns: 2,
        columnWidths: [18, 14, 14, 22, 18, 18, 10, 14, 14, 14, 12, 18, 16, 22, 10] 
      }
    );

    // ── 4. Sheet: Nil & Exempted Supplies (Table 8) ──
    wb.addSheet(
      'Nil & Exempted Supplies',
      ['Company GSTIN', 'Tax Period', 'Supply Description', 'Supply Type Code', 'Nil Rated Supplies (₹)', 'Exempted Supplies (₹)', 'Non-GST Supplies (₹)', 'Total Nil/Exempted Value (₹)', 'GSTR-1A'],
      nilRatedRows,
      {
        tabColor: '0D9488',
        freezeColumns: 2,
        columnWidths: [18, 14, 44, 18, 20, 20, 20, 24, 10]
      }
    );

    // ── 5. Sheet: HSN Summary ──
    wb.addSheet(
      'HSN Summary',
      ['Company GSTIN', 'Tax Period', 'Summary Type', 'HSN Code', 'HSN Description', 'UQC', 'Qty', 'Total Value', 'Taxable Value', 'GST Rate', 'IGST', 'CGST', 'SGST', 'Cess', 'GSTR-1A'],
      salesHsnRows,
      { 
        tabColor: '7C3AED',
        freezeColumns: 4,
        columnWidths: [18, 14, 14, 14, 34, 10, 12, 18, 18, 10, 14, 14, 14, 12, 10] 
      }
    );

    // ── 6. Sheet: Document Series ──
    wb.addSheet(
      'Document Series',
      ['Company GSTIN', 'Tax Period', 'Doc Type', 'From', 'To', 'Total', 'Cancelled', 'GSTR-1A'],
      docIssuedRows,
      { 
        tabColor: '4B5563',
        freezeColumns: 3,
        columnWidths: [18, 14, 26, 18, 18, 12, 12, 10] 
      }
    );

    return wb;
  }

  const ConsolidatedSalesBuilder = {
    buildSalesWorkbook
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ConsolidatedSalesBuilder;
  } else {
    root.ConsolidatedSalesBuilder = ConsolidatedSalesBuilder;
  }
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this)));
