// ═══════════════════════════════════════════════════════════════════════════════
//  ReturnPilot Premium v4.2.5 — Statutory Purchase & ITC Audit Workbook
//  Official GSTN Standard: ITC Executive Summary, B2B Inward Supplies, ISD & Imports
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

  function buildPurchaseWorkbook(periodsData, metadata = {}) {
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

    const companyGstin = metadata.gstin || '';
    const tradeName = (!isBadName(metadata.tradeName) ? metadata.tradeName : (!isBadName(metadata.businessName) ? metadata.businessName : (!isBadName(metadata.legalName) ? metadata.legalName : 'Taxpayer')));

    const overviewRows = [];
    const purchaseRows = [];
    const isdRows = [];

    let grandTaxable = 0;
    let grandEligibleIgst = 0;
    let grandEligibleCgst = 0;
    let grandEligibleSgst = 0;
    let grandEligibleCess = 0;
    let grandIneligibleItc = 0;
    let grandDocValue = 0;
    let grandInvCount = 0;

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
    overviewRows.push(['Audit Verification', 'Form GSTR-2B Auto-Drafted Statement (Section 16(2)(aa))']);
    overviewRows.push(['Software Platform', 'ReturnPilot - GST Return Downloader (https://kasyhq.com)']);
    overviewRows.push(['', '']);

    // Process each GSTR-2B period JSON
    periodsData.forEach(pItem => {
      const period = pItem.period || '';
      const periodLabel = formatPeriodMonth(period);
      const raw = pItem.data || {};
      const data = raw.data || raw;
      const docdata = data.docdata || data;

      // 1. Process B2B Invoices -> Purchase Sheet
      const b2bList = docdata.b2b || [];
      if (Array.isArray(b2bList)) {
        b2bList.forEach(ctinItem => {
          const ctin = ctinItem.ctin || '';
          const cname = resolvePartyName(ctinItem, metadata.partyMap, '');
          const invList = ctinItem.inv || [];

          invList.forEach(inv => {
            const inum = inv.inum || '';
            const dt = formatDate(inv.dt || '');
            const val = parseNumber(inv.val);
            const pos = inv.pos || ctin.substring(0, 2);
            const rev = (inv.rev === 'Y' || inv.rev === true || inv.rev === 'YES') ? 'Yes' : 'No';
            const itcavl = (inv.itcavl === 'Y' || inv.itcavl === true || inv.itcavl === 'YES' || inv.itcavl === 'Yes') ? 'Yes' : 'No';
            const rsn = inv.rsn || '';
            const irn = inv.irn || '';
            const irnDt = formatDate(inv.irngendate || inv.irndt || '');
            const srctyp = inv.srctyp || (irn ? 'E-Invoice' : 'GSTR1');
            const fldt = formatDate(inv.fldt || ctinItem.supfildt || '');
            const flpr = formatPeriodMonth(inv.flpr || ctinItem.supprd || period);
            const itms = (inv.items && inv.items.length > 0) ? inv.items : ((inv.itms && inv.itms.length > 0) ? inv.itms : [inv]);

            grandInvCount++;
            grandDocValue += val;

            itms.forEach(itm => {
              const itmDet = itm.itm_det || itm;
              const txval = parseNumber(itmDet.txval !== undefined ? itmDet.txval : itm.txval);
              const igst = parseNumber(itmDet.iamt !== undefined ? itmDet.iamt : (itm.iamt !== undefined ? itm.iamt : itm.igst));
              const cgst = parseNumber(itmDet.camt !== undefined ? itmDet.camt : (itm.camt !== undefined ? itm.camt : itm.cgst));
              const samt = parseNumber(itmDet.samt !== undefined ? itmDet.samt : (itm.samt !== undefined ? itm.samt : itm.sgst));
              const cess = parseNumber(itmDet.csamt !== undefined ? itmDet.csamt : (itm.csamt !== undefined ? itm.csamt : itm.cess));
              const totalItc = igst + cgst + samt + cess;
              const rt = parseNumber(itmDet.rt || itm.rt || (txval > 0 ? Math.round(((igst + cgst + samt) / txval) * 100) : 0));

              grandTaxable += txval;
              if (itcavl === 'Yes') {
                grandEligibleIgst += igst;
                grandEligibleCgst += cgst;
                grandEligibleSgst += samt;
                grandEligibleCess += cess;
              } else {
                grandIneligibleItc += totalItc;
              }

              purchaseRows.push([
                companyGstin,
                periodLabel,
                'Invoice',
                'Standard',
                inum,
                dt,
                ctin,
                cname,
                formatState(ctin.substring(0, 2)),
                formatState(pos),
                '', // Port Code
                rev,
                val,
                txval,
                rt || '',
                igst || '',
                cgst || '',
                samt || '',
                cess || '',
                'No', // Is Amendment
                '', // Original Doc No
                '', // Original Doc Date
                'No Action', // IMS Action
                flpr,
                fldt,
                itcavl,
                rsn,
                itcavl === 'Yes' ? 'Yes' : 'No', // 8A Available
                '', // ICEGATE Ref Date
                '', // ICEGATE Rec Date
                inv.updby === 'O' ? 'Other' : 'Supplier',
                srctyp,
                irnDt,
                irn,
                igst || '',
                cgst || '',
                samt || '',
                cess || '',
                '' // IMS Remarks
              ]);
            });
          });
        });
      }

      // 2. Process B2BA (Amendments) -> Purchase Sheet
      const b2baList = docdata.b2ba || [];
      if (Array.isArray(b2baList)) {
        b2baList.forEach(ctinItem => {
          const ctin = ctinItem.ctin || '';
          const cname = resolvePartyName(ctinItem, metadata.partyMap, '');
          const invList = ctinItem.inv || [];

          invList.forEach(inv => {
            const inum = inv.inum || '';
            const dt = formatDate(inv.dt || '');
            const oinum = inv.oinum || '';
            const oidt = formatDate(inv.oidt || '');
            const val = parseNumber(inv.val);
            const pos = inv.pos || ctin.substring(0, 2);
            const rev = (inv.rev === 'Y' || inv.rev === true) ? 'Yes' : 'No';
            const itcavl = (inv.itcavl === 'Y' || inv.itcavl === true || inv.itcavl === 'YES' || inv.itcavl === 'Yes') ? 'Yes' : 'No';
            const rsn = inv.rsn || '';
            const irn = inv.irn || '';
            const irnDt = formatDate(inv.irngendate || inv.irndt || '');
            const srctyp = inv.srctyp || (irn ? 'E-Invoice' : 'GSTR1');
            const fldt = formatDate(inv.fldt || ctinItem.supfildt || '');
            const flpr = formatPeriodMonth(inv.flpr || ctinItem.supprd || period);
            const itms = (inv.items && inv.items.length > 0) ? inv.items : ((inv.itms && inv.itms.length > 0) ? inv.itms : [inv]);

            itms.forEach(itm => {
              const itmDet = itm.itm_det || itm;
              const txval = parseNumber(itmDet.txval !== undefined ? itmDet.txval : itm.txval);
              const igst = parseNumber(itmDet.iamt !== undefined ? itmDet.iamt : (itm.iamt !== undefined ? itm.iamt : itm.igst));
              const cgst = parseNumber(itmDet.camt !== undefined ? itmDet.camt : (itm.camt !== undefined ? itm.camt : itm.cgst));
              const samt = parseNumber(itmDet.samt !== undefined ? itmDet.samt : (itm.samt !== undefined ? itm.samt : itm.sgst));
              const cess = parseNumber(itmDet.csamt !== undefined ? itmDet.csamt : (itm.csamt !== undefined ? itm.csamt : itm.cess));
              const rt = parseNumber(itmDet.rt || itm.rt || (txval > 0 ? Math.round(((igst + cgst + samt) / txval) * 100) : 0));

              purchaseRows.push([
                companyGstin,
                periodLabel,
                'Invoice',
                'Standard',
                inum,
                dt,
                ctin,
                cname,
                formatState(ctin.substring(0, 2)),
                formatState(pos),
                '',
                rev,
                val,
                txval,
                rt || '',
                igst || '',
                cgst || '',
                samt || '',
                cess || '',
                'Yes',
                oinum,
                oidt,
                'No Action',
                flpr,
                fldt,
                itcavl,
                rsn,
                itcavl === 'Yes' ? 'Yes' : 'No',
                '', '',
                inv.updby === 'O' ? 'Other' : 'Supplier',
                srctyp,
                irnDt,
                irn,
                igst || '',
                cgst || '',
                samt || '',
                cess || '',
                ''
              ]);
            });
          });
        });
      }

      // 3. Process CDNR (Credit/Debit Notes) -> Purchase Sheet
      const cdnrList = docdata.cdnr || [];
      if (Array.isArray(cdnrList)) {
        cdnrList.forEach(ctinItem => {
          const ctin = ctinItem.ctin || '';
          const cname = resolvePartyName(ctinItem, metadata.partyMap, '');
          const ntList = ctinItem.nt || [];

          ntList.forEach(nt => {
            const nt_num = nt.ntnum || nt.nt_num || nt.inum || nt.num || '';
            const nt_dt = formatDate(nt.dt || nt.nt_dt || nt.idt || '');
            const isCreditNote = (nt.typ === 'C' || nt.ntty === 'C' || nt.nt_typ === 'C' || nt.ntty === 'Credit Note');
            const ntty = isCreditNote ? 'Credit Note' : 'Debit Note';
            const multiplier = isCreditNote ? -1 : 1;
            const inum = nt.inum || nt.p_inum || nt.oinum || '';
            const idt = formatDate(nt.idt || nt.p_idt || nt.oidt || '');
            const rawVal = parseNumber(nt.val);
            const val = rawVal * multiplier;
            const pos = nt.pos || ctin.substring(0, 2);
            const rev = (nt.rev === 'Y' || nt.rev === true) ? 'Yes' : 'No';
            const itcavl = (nt.itcavl === 'Y' || nt.itcavl === true || nt.itcavl === 'YES' || nt.itcavl === 'Yes') ? 'Yes' : 'No';
            const rsn = nt.rsn || '';
            const irn = nt.irn || '';
            const irnDt = formatDate(nt.irngendate || nt.irndt || '');
            const srctyp = nt.srctyp || (irn ? 'E-Invoice' : 'GSTR1');
            const fldt = formatDate(nt.fldt || ctinItem.supfildt || '');
            const flpr = formatPeriodMonth(nt.flpr || ctinItem.supprd || period);
            const itms = (nt.items && nt.items.length > 0) ? nt.items : ((nt.itms && nt.itms.length > 0) ? nt.itms : [nt]);

            grandInvCount++;
            grandDocValue += val;

            itms.forEach(itm => {
              const itmDet = itm.itm_det || itm;
              const rawTxval = parseNumber(itmDet.txval !== undefined ? itmDet.txval : (itm.txval !== undefined ? itm.txval : nt.txval));
              const txval = rawTxval * multiplier;
              const igst = parseNumber(itmDet.iamt !== undefined ? itmDet.iamt : (itm.iamt !== undefined ? itm.iamt : (itm.igst !== undefined ? itm.igst : (nt.igst !== undefined ? nt.igst : 0)))) * multiplier;
              const cgst = parseNumber(itmDet.camt !== undefined ? itmDet.camt : (itm.camt !== undefined ? itm.camt : (itm.cgst !== undefined ? itm.cgst : (nt.cgst !== undefined ? nt.cgst : 0)))) * multiplier;
              const samt = parseNumber(itmDet.samt !== undefined ? itmDet.samt : (itm.samt !== undefined ? itm.samt : (itm.sgst !== undefined ? itm.sgst : (nt.sgst !== undefined ? nt.sgst : 0)))) * multiplier;
              const cess = parseNumber(itmDet.csamt !== undefined ? itmDet.csamt : (itm.csamt !== undefined ? itm.csamt : (itm.cess !== undefined ? itm.cess : (nt.cess !== undefined ? nt.cess : 0)))) * multiplier;
              const totalItc = igst + cgst + samt + cess;
              const rt = parseNumber(itmDet.rt || itm.rt || (rawTxval > 0 ? Math.round(((Math.abs(igst) + Math.abs(cgst) + Math.abs(samt)) / rawTxval) * 100) : 0));

              grandTaxable += txval;
              if (itcavl === 'Yes') {
                grandEligibleIgst += igst;
                grandEligibleCgst += cgst;
                grandEligibleSgst += samt;
                grandEligibleCess += cess;
              } else {
                grandIneligibleItc += totalItc;
              }

              purchaseRows.push([
                companyGstin,
                periodLabel,
                ntty,
                'Standard',
                nt_num,
                nt_dt,
                ctin,
                cname,
                formatState(ctin.substring(0, 2)),
                formatState(pos),
                '',
                rev,
                val,
                txval,
                rt || '',
                igst || '',
                cgst || '',
                samt || '',
                cess || '',
                'No',
                inum,
                idt,
                'No Action',
                flpr,
                fldt,
                itcavl,
                rsn,
                itcavl === 'Yes' ? 'Yes' : 'No',
                '', '',
                nt.updby === 'O' ? 'Other' : 'Supplier',
                srctyp,
                irnDt,
                irn,
                igst || '',
                cgst || '',
                samt || '',
                cess || '',
                ''
              ]);
            });
          });
        });
      }

      // 4. Process CDNRA (Credit/Debit Note Amendments) -> Purchase Sheet
      const cdnraList = docdata.cdnra || [];
      if (Array.isArray(cdnraList)) {
        cdnraList.forEach(ctinItem => {
          const ctin = ctinItem.ctin || '';
          const cname = resolvePartyName(ctinItem, metadata.partyMap, '');
          const ntList = ctinItem.nt || [];

          ntList.forEach(nt => {
            const nt_num = nt.ntnum || nt.nt_num || nt.inum || nt.num || '';
            const nt_dt = formatDate(nt.dt || nt.nt_dt || nt.idt || '');
            const ont_num = nt.ontnum || nt.ont_num || nt.oinum || nt.p_ntnum || '';
            const ont_dt = formatDate(nt.ontdt || nt.ont_dt || nt.oidt || nt.p_ntdt || '');
            const isCreditNote = (nt.typ === 'C' || nt.ntty === 'C' || nt.nt_typ === 'C' || nt.ntty === 'Credit Note');
            const ntty = isCreditNote ? 'Credit Note' : 'Debit Note';
            const multiplier = isCreditNote ? -1 : 1;
            const inum = nt.inum || nt.p_inum || nt.oinum || '';
            const idt = formatDate(nt.idt || nt.p_idt || nt.oidt || '');
            const rawVal = parseNumber(nt.val);
            const val = rawVal * multiplier;
            const pos = nt.pos || ctin.substring(0, 2);
            const rev = (nt.rev === 'Y' || nt.rev === true) ? 'Yes' : 'No';
            const itcavl = (nt.itcavl === 'Y' || nt.itcavl === true || nt.itcavl === 'YES' || nt.itcavl === 'Yes') ? 'Yes' : 'No';
            const rsn = nt.rsn || '';
            const irn = nt.irn || '';
            const irnDt = formatDate(nt.irngendate || nt.irndt || '');
            const srctyp = nt.srctyp || (irn ? 'E-Invoice' : 'GSTR1');
            const fldt = formatDate(nt.fldt || ctinItem.supfildt || '');
            const flpr = formatPeriodMonth(nt.flpr || ctinItem.supprd || period);
            const itms = (nt.items && nt.items.length > 0) ? nt.items : ((nt.itms && nt.itms.length > 0) ? nt.itms : [nt]);

            grandInvCount++;
            grandDocValue += val;

            itms.forEach(itm => {
              const itmDet = itm.itm_det || itm;
              const rawTxval = parseNumber(itmDet.txval !== undefined ? itmDet.txval : (itm.txval !== undefined ? itm.txval : nt.txval));
              const txval = rawTxval * multiplier;
              const igst = parseNumber(itmDet.iamt !== undefined ? itmDet.iamt : (itm.iamt !== undefined ? itm.iamt : (itm.igst !== undefined ? itm.igst : (nt.igst !== undefined ? nt.igst : 0)))) * multiplier;
              const cgst = parseNumber(itmDet.camt !== undefined ? itmDet.camt : (itm.camt !== undefined ? itm.camt : (itm.cgst !== undefined ? itm.cgst : (nt.cgst !== undefined ? nt.cgst : 0)))) * multiplier;
              const samt = parseNumber(itmDet.samt !== undefined ? itmDet.samt : (itm.samt !== undefined ? itm.samt : (itm.sgst !== undefined ? itm.sgst : (nt.sgst !== undefined ? nt.sgst : 0)))) * multiplier;
              const cess = parseNumber(itmDet.csamt !== undefined ? itmDet.csamt : (itm.csamt !== undefined ? itm.csamt : (itm.cess !== undefined ? itm.cess : (nt.cess !== undefined ? nt.cess : 0)))) * multiplier;
              const totalItc = igst + cgst + samt + cess;
              const rt = parseNumber(itmDet.rt || itm.rt || (rawTxval > 0 ? Math.round(((Math.abs(igst) + Math.abs(cgst) + Math.abs(samt)) / rawTxval) * 100) : 0));

              grandTaxable += txval;
              if (itcavl === 'Yes') {
                grandEligibleIgst += igst;
                grandEligibleCgst += cgst;
                grandEligibleSgst += samt;
                grandEligibleCess += cess;
              } else {
                grandIneligibleItc += totalItc;
              }

              purchaseRows.push([
                companyGstin,
                periodLabel,
                ntty,
                'Standard',
                nt_num,
                nt_dt,
                ctin,
                cname,
                formatState(ctin.substring(0, 2)),
                formatState(pos),
                '',
                rev,
                val,
                txval,
                rt || '',
                igst || '',
                cgst || '',
                samt || '',
                cess || '',
                'Yes',
                ont_num || inum,
                ont_dt || idt,
                'No Action',
                flpr,
                fldt,
                itcavl,
                rsn,
                itcavl === 'Yes' ? 'Yes' : 'No',
                '', '',
                nt.updby === 'O' ? 'Other' : 'Supplier',
                srctyp,
                irnDt,
                irn,
                igst || '',
                cgst || '',
                samt || '',
                cess || '',
                ''
              ]);
            });
          });
        });
      }

      // 5. Process ISD (Input Service Distributor) -> ISD Sheet
      const isdList = docdata.isd || [];
      if (Array.isArray(isdList)) {
        isdList.forEach(ctinItem => {
          const ctin = ctinItem.ctin || '';
          const cname = resolvePartyName(ctinItem, metadata.partyMap, '');
          const docList = ctinItem.doclist || ctinItem.doc || ctinItem.inv || [];

          docList.forEach(doc => {
            const doc_num = doc.doc_num || doc.docnum || doc.inum || '';
            const doc_dt = formatDate(doc.doc_dt || doc.docdt || doc.idt || doc.dt || '');
            const igst = parseNumber(doc.iamt !== undefined ? doc.iamt : doc.igst);
            const cgst = parseNumber(doc.camt !== undefined ? doc.camt : doc.cgst);
            const samt = parseNumber(doc.samt !== undefined ? doc.samt : doc.sgst);
            const cess = parseNumber(doc.csamt !== undefined ? doc.csamt : doc.cess);
            const txval = parseNumber(doc.txval !== undefined ? doc.txval : (doc.val || 0));
            const itcavl = (doc.itcavl === 'Y' || doc.itcavl === true || doc.itcavl === 'YES' || doc.itcavl === 'Yes') ? 'Yes' : 'No';
            const fldt = formatDate(doc.fldt || ctinItem.supfildt || '');
            const flpr = formatPeriodMonth(doc.flpr || ctinItem.supprd || period);

            grandInvCount++;
            grandTaxable += txval;
            if (itcavl === 'Yes') {
              grandEligibleIgst += igst;
              grandEligibleCgst += cgst;
              grandEligibleSgst += samt;
              grandEligibleCess += cess;
            } else {
              grandIneligibleItc += (igst + cgst + samt + cess);
            }

            isdRows.push([
              companyGstin,
              periodLabel,
              'ISD Invoice',
              doc_num,
              doc_dt,
              ctin,
              cname,
              '',
              txval || '',
              doc.ref_doc_num || doc.ref_inum || '',
              formatDate(doc.ref_doc_dt || doc.ref_idt || ''),
              igst || '',
              cgst || '',
              samt || '',
              cess || '',
              itcavl,
              'No',
              '',
              '',
              flpr,
              fldt
            ]);
          });
        });
      }

      // 6. Process ISDA (ISD Amendments) -> ISD Sheet
      const isdaList = docdata.isda || [];
      if (Array.isArray(isdaList)) {
        isdaList.forEach(ctinItem => {
          const ctin = ctinItem.ctin || '';
          const cname = resolvePartyName(ctinItem, metadata.partyMap, '');
          const docList = ctinItem.doclist || ctinItem.doc || ctinItem.inv || [];

          docList.forEach(doc => {
            const doc_num = doc.doc_num || doc.docnum || doc.inum || '';
            const doc_dt = formatDate(doc.doc_dt || doc.docdt || doc.idt || doc.dt || '');
            const odoc_num = doc.odoc_num || doc.odocnum || doc.oinum || '';
            const odoc_dt = formatDate(doc.odoc_dt || doc.odocdt || doc.oidt || '');
            const igst = parseNumber(doc.iamt !== undefined ? doc.iamt : doc.igst);
            const cgst = parseNumber(doc.camt !== undefined ? doc.camt : doc.cgst);
            const samt = parseNumber(doc.samt !== undefined ? doc.samt : doc.sgst);
            const cess = parseNumber(doc.csamt !== undefined ? doc.csamt : doc.cess);
            const txval = parseNumber(doc.txval !== undefined ? doc.txval : (doc.val || 0));
            const itcavl = (doc.itcavl === 'Y' || doc.itcavl === true || doc.itcavl === 'YES' || doc.itcavl === 'Yes') ? 'Yes' : 'No';
            const fldt = formatDate(doc.fldt || ctinItem.supfildt || '');
            const flpr = formatPeriodMonth(doc.flpr || ctinItem.supprd || period);

            grandInvCount++;
            grandTaxable += txval;
            if (itcavl === 'Yes') {
              grandEligibleIgst += igst;
              grandEligibleCgst += cgst;
              grandEligibleSgst += samt;
              grandEligibleCess += cess;
            } else {
              grandIneligibleItc += (igst + cgst + samt + cess);
            }

            isdRows.push([
              companyGstin,
              periodLabel,
              'ISD Amendment',
              doc_num,
              doc_dt,
              ctin,
              cname,
              '',
              txval || '',
              doc.ref_doc_num || doc.ref_inum || '',
              formatDate(doc.ref_doc_dt || doc.ref_idt || ''),
              igst || '',
              cgst || '',
              samt || '',
              cess || '',
              itcavl,
              'Yes',
              odoc_num,
              odoc_dt,
              flpr,
              fldt
            ]);
          });
        });
      }

      // 7. Process IMPG (Import of Goods from Overseas via ICEGATE) -> ISD Sheet
      const impgList = docdata.impg || [];
      if (Array.isArray(impgList)) {
        impgList.forEach(boe => {
          const boe_num = boe.boenum || boe.boe_num || boe.inum || '';
          const boe_dt = formatDate(boe.boedt || boe.boe_dt || boe.dt || boe.idt || '');
          const port_cd = boe.port_cd || boe.port || boe.portcd || '';
          const txval = parseNumber(boe.txval !== undefined ? boe.txval : (boe.tx_val || boe.val || 0));
          const igst = parseNumber(boe.iamt !== undefined ? boe.iamt : boe.igst);
          const cess = parseNumber(boe.csamt !== undefined ? boe.csamt : boe.cess);
          const itcavl = (boe.itcavl === 'Y' || boe.itcavl === true || boe.itcavl === 'YES' || boe.itcavl === 'Yes') ? 'Yes' : 'No';
          const ref_dt = formatDate(boe.ref_dt || boe.refdt || boe.icegate_dt || '');
          const is_amd = (boe.is_amd === 'Y' || boe.is_amd === true) ? 'Yes' : 'No';

          grandInvCount++;
          grandTaxable += txval;
          if (itcavl === 'Yes') {
            grandEligibleIgst += igst;
            grandEligibleCess += cess;
          } else {
            grandIneligibleItc += (igst + cess);
          }

          isdRows.push([
            companyGstin,
            periodLabel,
            'Import of Goods (Overseas)',
            boe_num,
            boe_dt,
            'OVERSEAS',
            'Overseas Customs Import via ICEGATE',
            port_cd,
            txval || '',
            '',
            '',
            igst || '',
            '',
            '',
            cess || '',
            itcavl,
            is_amd,
            '',
            '',
            periodLabel,
            ref_dt
          ]);
        });
      }

      // 8. Process IMPGSEZ (Import of Goods from SEZ Units) -> ISD Sheet
      const impgSezList = docdata.impgsez || [];
      if (Array.isArray(impgSezList)) {
        impgSezList.forEach(ctinItem => {
          const ctin = ctinItem.ctin || '';
          const cname = resolvePartyName(ctinItem, metadata.partyMap, 'SEZ Supplier');
          const boeList = ctinItem.boe || ctinItem.inv || ctinItem.doclist || [ctinItem];

          boeList.forEach(boe => {
            const boe_num = boe.boenum || boe.boe_num || boe.inum || '';
            const boe_dt = formatDate(boe.boedt || boe.boe_dt || boe.dt || boe.idt || '');
            const port_cd = boe.port_cd || boe.port || boe.portcd || '';
            const txval = parseNumber(boe.txval !== undefined ? boe.txval : (boe.tx_val || boe.val || 0));
            const igst = parseNumber(boe.iamt !== undefined ? boe.iamt : boe.igst);
            const cess = parseNumber(boe.csamt !== undefined ? boe.csamt : boe.cess);
            const itcavl = (boe.itcavl === 'Y' || boe.itcavl === true || boe.itcavl === 'YES' || boe.itcavl === 'Yes') ? 'Yes' : 'No';
            const ref_dt = formatDate(boe.ref_dt || boe.refdt || boe.icegate_dt || '');
            const is_amd = (boe.is_amd === 'Y' || boe.is_amd === true) ? 'Yes' : 'No';

            grandInvCount++;
            grandTaxable += txval;
            if (itcavl === 'Yes') {
              grandEligibleIgst += igst;
              grandEligibleCess += cess;
            } else {
              grandIneligibleItc += (igst + cess);
            }

            isdRows.push([
              companyGstin,
              periodLabel,
              'Import from SEZ Unit',
              boe_num,
              boe_dt,
              ctin,
              cname,
              port_cd,
              txval || '',
              '',
              '',
              igst || '',
              '',
              '',
              cess || '',
              itcavl,
              is_amd,
              '',
              '',
              periodLabel,
              ref_dt
            ]);
          });
        });
      }
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

    purchaseRows.sort((a, b) => {
      const dtA = parseDateToTimestamp(a[5]);
      const dtB = parseDateToTimestamp(b[5]);
      if (dtA !== dtB) return dtA - dtB;
      const numA = String(a[4] || '');
      const numB = String(b[4] || '');
      return numA.localeCompare(numB, undefined, { numeric: true, sensitivity: 'base' });
    });

    // Append dynamic Excel formula Total rows to data sheets (at the very bottom)
    if (purchaseRows.length > 0) {
      const N = purchaseRows.length + 1;
      const totalRow = [
        'Total', '', '', '', '', '', '', '', '', '', '', '',
        `=SUM(M2:M${N})`,
        `=SUM(N2:N${N})`,
        '',
        `=SUM(P2:P${N})`,
        `=SUM(Q2:Q${N})`,
        `=SUM(R2:R${N})`,
        `=SUM(S2:S${N})`,
        '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
        `=SUM(AI2:AI${N})`,
        `=SUM(AJ2:AJ${N})`,
        `=SUM(AK2:AK${N})`,
        `=SUM(AL2:AL${N})`,
        ''
      ];
      totalRow.__isSummary = true;
      purchaseRows.push(totalRow);
    }

    if (isdRows.length > 0) {
      const N = isdRows.length + 1;
      const totalRow = [
        'Total', '', '', '', '', '', '', '',
        `=SUM(I2:I${N})`,
        '', '',
        `=SUM(L2:L${N})`,
        `=SUM(M2:M${N})`,
        `=SUM(N2:N${N})`,
        `=SUM(O2:O${N})`,
        '', '', '', '', '', ''
      ];
      totalRow.__isSummary = true;
      isdRows.push(totalRow);
    }

    // ── 1. Sheet: ITC Executive Summary ──
    const matrixHeader = ['--- STATUTORY ITC RECONCILIATION MATRIX ---', ''];
    matrixHeader.__isSummary = true;
    overviewRows.push(matrixHeader);

    overviewRows.push(['Total Inward Invoices & Notes', grandInvCount]);
    overviewRows.push(['Total Inward Taxable Value (₹)', grandTaxable]);
    overviewRows.push(['Total Available Eligible IGST (₹)', grandEligibleIgst]);
    overviewRows.push(['Total Available Eligible CGST (₹)', grandEligibleCgst]);
    overviewRows.push(['Total Available Eligible SGST (₹)', grandEligibleSgst]);
    overviewRows.push(['Total Available Eligible Cess (₹)', grandEligibleCess]);

    const netItcRow = ['Net Available ITC for GSTR-3B Claim (₹)', grandEligibleIgst + grandEligibleCgst + grandEligibleSgst + grandEligibleCess];
    netItcRow.__isSummary = true;
    overviewRows.push(netItcRow);

    overviewRows.push(['Ineligible ITC under Section 17(5) (₹)', grandIneligibleItc]);
    overviewRows.push(['Total Gross Inward Invoiced Value (₹)', grandDocValue]);

    wb.addSheet(
      'ITC Executive Summary',
      ['Audit Parameter / Statutory Metric', 'Value / Details'],
      overviewRows,
      { 
        autoFilter: false,
        freezeHeader: false,
        tabColor: '1E3A8A',
        columnWidths: [44, 0] 
      }
    );

    // ── 2. Sheet: B2B Inward Supplies (Document Standard) ──
    wb.addSheet(
      'B2B Inward Supplies',
      [
        'Company GSTIN', 'Tax Period', 'Doc Type', 'Purchase Type', 'Doc No', 'Doc Date',
        'Supplier GSTIN', 'Supplier Name', 'Supplier State', 'Place of Supply', 'Port Code',
        'Reverse Charge', 'Doc Value', 'Item Taxable Value', 'GST Rate', 'IGST', 'CGST', 'SGST', 'Cess',
        'Is Amendment', 'Original Doc No', 'Original Doc Date', 'IMS Action',
        'GSTR-1 Filing Period', 'GSTR-1 Filing Date', 'ITC Eligible', 'ITC Ineligible Reason Type',
        'GSTR-9 (8A) ITC Available', 'ICEGATE Reference Date', 'ICEGATE Received Date',
        'Uploaded By', 'Source', 'IRN Date', 'IRN',
        'IMS ITC-IGST', 'IMS ITC-CGST', 'IMS ITC-SGST', 'IMS ITC-Cess', 'IMS Remarks'
      ],
      purchaseRows,
      { 
        tabColor: '059669',
        freezeColumns: 6,
        columnWidths: [18, 14, 14, 14, 16, 12, 18, 32, 14, 18, 12, 14, 16, 18, 10, 14, 14, 14, 12, 14, 18, 16, 14, 18, 16, 14, 24, 22, 20, 20, 12, 10, 14, 20, 14, 14, 14, 14, 16] 
      }
    );

    // ── 3. Sheet: ISD & Import Credits ──
    wb.addSheet(
      'ISD & Import Credits',
      [
        'Company GSTIN', 'Tax Period', 'Doc Type', 'Doc / BOE No', 'Doc / BOE Date', 'Supplier / SEZ GSTIN', 'Supplier / Port Name', 'Port Code',
        'Taxable Value', 'Reference Doc No', 'Reference Doc Date', 'IGST', 'CGST', 'SGST', 'Cess',
        'ITC Eligible', 'Is Amendment', 'Original Doc No', 'Original Doc Date',
        'GSTR-6 / ICEGATE Period', 'Filing Date'
      ],
      isdRows,
      { 
        tabColor: '7C3AED',
        freezeColumns: 5,
        columnWidths: [18, 14, 26, 18, 14, 20, 34, 14, 16, 18, 16, 14, 14, 14, 12, 14, 14, 18, 16, 20, 16] 
      }
    );

    return wb;
  }

  const ConsolidatedPurchaseBuilder = {
    buildPurchaseWorkbook
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ConsolidatedPurchaseBuilder;
  } else {
    root.ConsolidatedPurchaseBuilder = ConsolidatedPurchaseBuilder;
  }
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this)));
