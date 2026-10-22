// ═══════════════════════════════════════════════════════════════════════════════
//  ReturnPilot v4.2.5 — Lightweight Native OpenXML (.xlsx) Builder
//  Zero-Dependency Spreadsheet Generator using bundled fflate
//  © 2026 KasyHQ Technologies. All Rights Reserved.
// ═══════════════════════════════════════════════════════════════════════════════

(function(root) {
  'use strict';

  function escapeXml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function colIndexToName(colIdx) {
    let temp = colIdx + 1;
    let letter = '';
    while (temp > 0) {
      let mod = (temp - 1) % 26;
      letter = String.fromCharCode(65 + mod) + letter;
      temp = Math.floor((temp - mod) / 26);
    }
    return letter;
  }

  function parseToExcelDateSerial(val) {
    if (val instanceof Date) {
      const utc = Date.UTC(val.getFullYear(), val.getMonth(), val.getDate());
      const epoch = Date.UTC(1899, 11, 30);
      return Math.round((utc - epoch) / 86400000);
    }
    if (typeof val === 'string') {
      const clean = val.trim();
      // Match DD-MM-YYYY or DD/MM/YYYY
      const m1 = clean.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
      if (m1) {
        const d = parseInt(m1[1], 10);
        const mo = parseInt(m1[2], 10);
        const y = parseInt(m1[3], 10);
        if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12 && y >= 1900 && y <= 2100) {
          const utc = Date.UTC(y, mo - 1, d);
          const epoch = Date.UTC(1899, 11, 30);
          return Math.round((utc - epoch) / 86400000);
        }
      }
      // Match YYYY-MM-DD or YYYY/MM/DD
      const m2 = clean.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
      if (m2) {
        const y = parseInt(m2[1], 10);
        const mo = parseInt(m2[2], 10);
        const d = parseInt(m2[3], 10);
        if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12 && y >= 1900 && y <= 2100) {
          const utc = Date.UTC(y, mo - 1, d);
          const epoch = Date.UTC(1899, 11, 30);
          return Math.round((utc - epoch) / 86400000);
        }
      }
    }
    return null;
  }

  function parseMonthPeriodToExcelSerial(periodStr) {
    if (!periodStr || typeof periodStr !== 'string') return null;
    const clean = periodStr.trim();
    const m1 = clean.match(/^(\d{2})[\/\-]?(\d{4})$/);
    if (m1) {
      const mo = parseInt(m1[1], 10);
      const y = parseInt(m1[2], 10);
      if (mo >= 1 && mo <= 12 && y >= 1900 && y <= 2100) {
        const utc = Date.UTC(y, mo - 1, 1);
        const epoch = Date.UTC(1899, 11, 30);
        return Math.round((utc - epoch) / 86400000);
      }
    }
    const months = {
      january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3,
      april: 4, apr: 4, may: 5, june: 6, jun: 6, july: 7, jul: 7,
      august: 8, aug: 8, september: 9, sep: 9, sept: 9, october: 10, oct: 10,
      november: 11, nov: 11, december: 12, dec: 12
    };
    const m2 = clean.match(/^([a-zA-Z]+)[\s\-]+(\d{4})$/);
    if (m2) {
      const mo = months[m2[1].toLowerCase()];
      const y = parseInt(m2[2], 10);
      if (mo && y >= 1900 && y <= 2100) {
        const utc = Date.UTC(y, mo - 1, 1);
        const epoch = Date.UTC(1899, 11, 30);
        return Math.round((utc - epoch) / 86400000);
      }
    }
    return null;
  }

  class XlsxWorkbook {
    constructor() {
      this.sheets = [];
      this.company = "KasyHQ Technologies";
      this.author = "ReturnPilot GST Return Downloader (kasyhq.com)";
    }

    addSheet(name, headers, rows, options = {}) {
      const cleanName = String(name || 'Sheet')
        .replace(/[:\\/?*\[\]]/g, '_')
        .slice(0, 31);

      this.sheets.push({
        name: cleanName,
        headers: headers || [],
        rows: rows || [],
        options: {
          freezeHeader: options.freezeHeader !== false,
          autoFilter: options.autoFilter !== false,
          columnWidths: options.columnWidths || null,
          ...options
        }
      });
      return this;
    }

    _buildContentTypesXml() {
      let xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
      xml += '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n';
      xml += '  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n';
      xml += '  <Default Extension="xml" ContentType="application/xml"/>\n';
      xml += '  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>\n';
      xml += '  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>\n';
      xml += '  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>\n';
      xml += '  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>\n';

      this.sheets.forEach((_, idx) => {
        xml += `  <Override PartName="/xl/worksheets/sheet${idx + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>\n`;
      });
      xml += '</Types>';
      return xml;
    }

    _buildRootRelsXml() {
      return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n' +
        '  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>\n' +
        '  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>\n' +
        '  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>\n' +
        '</Relationships>';
    }

    _buildWorkbookXml() {
      let xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
      xml += '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">\n';
      xml += '  <bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="12000"/></bookViews>\n';
      xml += '  <sheets>\n';
      this.sheets.forEach((sheet, idx) => {
        xml += `    <sheet name="${escapeXml(sheet.name)}" sheetId="${idx + 1}" r:id="rId${idx + 1}"/>\n`;
      });
      xml += '  </sheets>\n';
      xml += '  <calcPr calcId="191029" fullCalcOnLoad="1"/>\n';
      xml += '</workbook>';
      return xml;
    }

    _buildWorkbookRelsXml() {
      let xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
      xml += '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n';
      this.sheets.forEach((_, idx) => {
        xml += `  <Relationship Id="rId${idx + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${idx + 1}.xml"/>\n`;
      });
      xml += `  <Relationship Id="rId${this.sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>\n`;
      xml += '</Relationships>';
      return xml;
    }

    _buildStylesXml() {
      return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">\n' +
        '  <numFmts count="3">\n' +
        '    <numFmt numFmtId="164" formatCode="#,##0.00"/>\n' +
        '    <numFmt numFmtId="165" formatCode="DD-MM-YYYY"/>\n' +
        '    <numFmt numFmtId="166" formatCode="mmmm-yyyy"/>\n' +
        '  </numFmts>\n' +
        '  <fonts count="3">\n' +
        '    <font><sz val="11"/><color rgb="FF1F2937"/><name val="Calibri"/></font>\n' + // 0: Normal 11pt
        '    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>\n' + // 1: Header bold white 11pt
        '    <font><b/><sz val="11"/><color rgb="FF111827"/><name val="Calibri"/></font>\n' + // 2: Total bold 11pt
        '  </fonts>\n' +
        '  <fills count="5">\n' +
        '    <fill><patternFill patternType="none"/></fill>\n' +
        '    <fill><patternFill patternType="gray125"/></fill>\n' +
        '    <fill><patternFill patternType="solid"><fgColor rgb="FF1E3A8A"/></patternFill></fill>\n' + // 2: Executive Navy header
        '    <fill><patternFill patternType="solid"><fgColor rgb="FFF3F4F6"/></patternFill></fill>\n' + // 3: Light gray summary
        '    <fill><patternFill patternType="solid"><fgColor rgb="FFE0E7FF"/></patternFill></fill>\n' + // 4: Soft Indigo section header
        '  </fills>\n' +
        '  <borders count="2">\n' +
        '    <border><left/><right/><top/><bottom/></border>\n' +
        '    <border>\n' +
        '      <left style="thin"><color rgb="FFE5E7EB"/></left>\n' +
        '      <right style="thin"><color rgb="FFE5E7EB"/></right>\n' +
        '      <top style="thin"><color rgb="FFE5E7EB"/></top>\n' +
        '      <bottom style="thin"><color rgb="FFE5E7EB"/></bottom>\n' +
        '    </border>\n' +
        '  </borders>\n' +
        '  <cellStyleXfs count="1">\n' +
        '    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" applyAlignment="1"><alignment vertical="center"/></xf>\n' +
        '  </cellStyleXfs>\n' +
        '  <cellXfs count="11">\n' +
        '    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf>\n' + // 0: Normal text
        '    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>\n' + // 1: Header
        '    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>\n' + // 2: Currency/Number
        '    <xf numFmtId="164" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>\n' + // 3: Summary Number
        '    <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>\n' + // 4: Summary Text
        '    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>\n' + // 5: Center text (Dates, codes)
        '    <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>\n' + // 6: Center summary text
        '    <xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>\n' + // 7: Date format (right aligned)
        '    <xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>\n' + // 8: Month-Year / Tax Period format (right aligned)
        '    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf>\n' + // 9: Spacer cell (no border)
        '    <xf numFmtId="0" fontId="2" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>\n' + // 10: Section header banner
        '  </cellXfs>\n' +
        '</styleSheet>';
    }

    _buildCorePropsXml() {
      const nowIso = new Date().toISOString();
      return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n' +
        `  <dc:creator>${escapeXml(this.author)}</dc:creator>\n` +
        `  <cp:lastModifiedBy>${escapeXml(this.author)}</cp:lastModifiedBy>\n` +
        `  <dcterms:created xsi:type="dcterms:W3CDTF">${nowIso}</dcterms:created>\n` +
        `  <dcterms:modified xsi:type="dcterms:W3CDTF">${nowIso}</dcterms:modified>\n` +
        `  <dc:title>ReturnPilot Consolidated GST Statement</dc:title>\n` +
        '</cp:coreProperties>';
    }

    _buildAppPropsXml() {
      return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">\n' +
        `  <Company>${escapeXml(this.company)}</Company>\n` +
        '  <Application>ReturnPilot GST Return Downloader</Application>\n' +
        '  <AppVersion>4.2.5</AppVersion>\n' +
        '</Properties>';
    }

    _buildWorksheetXml(sheet) {
      const numCols = Math.max(
        sheet.headers.length,
        ...sheet.rows.map(r => Array.isArray(r) ? r.length : Object.keys(r).length)
      ) || 1;
      const numRows = sheet.rows.length + 1;
      const lastColName = colIndexToName(numCols - 1);
      const dimensionRef = `A1:${lastColName}${Math.max(1, numRows)}`;

      let xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
      xml += '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">\n';

      // Sheet properties & Tab color
      if (sheet.options.tabColor) {
        const hex = String(sheet.options.tabColor).replace(/#/g, '').toUpperCase();
        xml += `  <sheetPr>\n    <tabColor rgb="FF${hex}"/>\n  </sheetPr>\n`;
      }

      xml += `  <dimension ref="${dimensionRef}"/>\n`;

      // Multi-Axis Freeze Panes & Explicit Gridlines
      const freezeHeader = sheet.options.freezeHeader !== false;
      const freezeCols = Number(sheet.options.freezeColumns) || 0;

      if (freezeHeader || freezeCols > 0) {
        const ySplit = freezeHeader ? 1 : 0;
        const xSplit = freezeCols;
        const colLetter = colIndexToName(xSplit);
        const rowNum = ySplit + 1;
        const topLeftCell = `${colLetter}${rowNum}`;
        let activePane = "bottomLeft";
        if (xSplit > 0 && ySplit > 0) activePane = "bottomRight";
        else if (xSplit > 0) activePane = "topRight";

        xml += '  <sheetViews>\n';
        xml += '    <sheetView showGridLines="1" tabSelected="1" workbookViewId="0">\n';
        xml += `      <pane xSplit="${xSplit}" ySplit="${ySplit}" topLeftCell="${topLeftCell}" activePane="${activePane}" state="frozen"/>\n`;
        xml += '    </sheetView>\n';
        xml += '  </sheetViews>\n';
      } else {
        xml += '  <sheetViews>\n';
        xml += '    <sheetView showGridLines="1" tabSelected="1" workbookViewId="0"/>\n';
        xml += '  </sheetViews>\n';
      }

      // Column widths: dynamically calculated from headers AND all cell contents (auto-fit)
      xml += '  <cols>\n';
      for (let c = 0; c < numCols; c++) {
        let maxLen = sheet.headers[c] ? String(sheet.headers[c]).length : 0;
        
        // Scan all data rows for column c
        for (let r = 0; r < sheet.rows.length; r++) {
          const row = sheet.rows[r];
          const val = Array.isArray(row) ? row[c] : (sheet.headers[c] ? row[sheet.headers[c]] : '');
          if (val !== null && val !== undefined && val !== '') {
            let strVal = String(val);
            if (strVal.startsWith('=')) {
              strVal = '123,456,789.00';
            } else if (typeof val === 'number') {
              strVal = val.toFixed(2);
            } else if (strVal.includes('\n')) {
              const lines = strVal.split('\n');
              for (let li = 0; li < lines.length; li++) {
                if (lines[li].length > maxLen) maxLen = lines[li].length;
              }
              continue;
            }
            if (strVal.length > maxLen) {
              maxLen = strVal.length;
            }
          }
        }

        // Full auto-width with generous headroom (up to 180 characters)
        let width = Math.max(14, Math.min(180, Math.ceil(maxLen * 1.12) + 4));
        if (sheet.options.columnWidths && sheet.options.columnWidths[c]) {
          width = Math.max(width, sheet.options.columnWidths[c]);
        }
        xml += `    <col min="${c + 1}" max="${c + 1}" width="${width}" customWidth="1"/>\n`;
      }
      xml += '  </cols>\n';

      xml += '  <sheetData>\n';

      // Row 1: Headers
      xml += '    <row r="1" ht="28" customHeight="1">\n';
      sheet.headers.forEach((h, cIdx) => {
        const cellRef = `${colIndexToName(cIdx)}1`;
        xml += `      <c r="${cellRef}" t="inlineStr" s="1"><is><t>${escapeXml(h)}</t></is></c>\n`;
      });
      xml += '    </row>\n';

      // Data Rows
      sheet.rows.forEach((row, rIdx) => {
        const rowNum = rIdx + 2;
        const isSummaryRow = row.__isSummary || false;
        const isSectionHeader = row.__isSectionHeader || false;
        const isSpacerRow = row.__isSpacer || (!isSectionHeader && !isSummaryRow && Array.isArray(row) && row.every(v => v === '' || v === null || v === undefined));

        let rowHt = 22;
        if (isSpacerRow) rowHt = 12;
        else if (isSectionHeader) rowHt = 25;
        else if (isSummaryRow) rowHt = 24;

        xml += `    <row r="${rowNum}" ht="${rowHt}" customHeight="1">\n`;

        const rowValues = Array.isArray(row) ? row : sheet.headers.map(h => row[h]);
        rowValues.forEach((val, cIdx) => {
          const cellRef = `${colIndexToName(cIdx)}${rowNum}`;

          if (isSpacerRow) {
            xml += `      <c r="${cellRef}" s="9"/>\n`;
          } else if (isSectionHeader) {
            xml += `      <c r="${cellRef}" t="inlineStr" s="10"><is><t>${escapeXml(val)}</t></is></c>\n`;
          } else if (val === null || val === undefined || val === '') {
            xml += `      <c r="${cellRef}" s="${isSummaryRow ? 4 : 0}"/>\n`;
          } else if (typeof val === 'number') {
            const styleId = isSummaryRow ? 3 : 2;
            xml += `      <c r="${cellRef}" s="${styleId}"><v>${val}</v></c>\n`;
          } else if ((typeof val === 'string' && val.startsWith('=')) || (val && typeof val === 'object' && !(val instanceof Date) && (val.f || val.formula))) {
            // Formula support: string starting with '=' or formula object { f: '...', v: ... } / { formula: '...', value: ... }
            let formula = '';
            let precalcVal = undefined;
            let isTextFormula = false;

            if (typeof val === 'string') {
              formula = val.substring(1);
            } else {
              formula = String(val.f || val.formula || '');
              if (formula.startsWith('=')) formula = formula.substring(1);
              precalcVal = val.v !== undefined ? val.v : val.value;
              if (val.t === 'str' || val.t === 's' || val.isText) isTextFormula = true;
            }

            if (!isTextFormula && typeof precalcVal === 'string') {
              isTextFormula = true;
            } else if (!isTextFormula && /^(IF|CONCAT|TEXT|MID|LEFT|RIGHT|UPPER|LOWER)\b/i.test(formula.trim()) && formula.includes('"')) {
              isTextFormula = true;
            }

            if (isTextFormula) {
              const styleId = isSummaryRow ? 4 : 0;
              const vNode = precalcVal !== undefined ? `<v>${escapeXml(precalcVal)}</v>` : '';
              xml += `      <c r="${cellRef}" t="str" s="${styleId}"><f>${escapeXml(formula)}</f>${vNode}</c>\n`;
            } else {
              const styleId = isSummaryRow ? 3 : 2;
              const vNode = (precalcVal !== undefined && precalcVal !== null && !isNaN(Number(precalcVal))) ? `<v>${precalcVal}</v>` : '';
              xml += `      <c r="${cellRef}" s="${styleId}"><f>${escapeXml(formula)}</f>${vNode}</c>\n`;
            }
          } else if (val && typeof val === 'object' && !(val instanceof Date)) {
            // Safe fallback for non-formula objects to prevent [object Object]
            const innerVal = val.v !== undefined ? val.v : (val.value !== undefined ? val.value : '');
            xml += `      <c r="${cellRef}" t="inlineStr" s="${isSummaryRow ? 4 : 0}"><is><t>${escapeXml(innerVal)}</t></is></c>\n`;
          } else if (!isSummaryRow) {
            const dateSerial = parseToExcelDateSerial(val);
            if (dateSerial !== null) {
              xml += `      <c r="${cellRef}" s="7"><v>${dateSerial}</v></c>\n`;
            } else {
              const monthSerial = parseMonthPeriodToExcelSerial(val);
              if (monthSerial !== null) {
                xml += `      <c r="${cellRef}" s="8"><v>${monthSerial}</v></c>\n`;
              } else {
                xml += `      <c r="${cellRef}" t="inlineStr" s="0"><is><t>${escapeXml(val)}</t></is></c>\n`;
              }
            }
          } else {
            xml += `      <c r="${cellRef}" t="inlineStr" s="4"><is><t>${escapeXml(val)}</t></is></c>\n`;
          }
        });

        xml += '    </row>\n';
      });

      xml += '  </sheetData>\n';

      if (sheet.options.autoFilter && numRows > 1) {
        xml += `  <autoFilter ref="A1:${lastColName}${numRows}"/>\n`;
      }

      xml += '</worksheet>';
      return xml;
    }

    async generateBase64() {
      const fflateLib = (typeof fflate !== 'undefined') ? fflate : (typeof window !== 'undefined' ? window.fflate : (typeof self !== 'undefined' ? self.fflate : (typeof globalThis !== 'undefined' ? globalThis.fflate : null)));

      if (!fflateLib || typeof fflateLib.zipSync !== 'function') {
        throw new Error('fflate library is required to compile .xlsx files');
      }

      const zipData = {
        '[Content_Types].xml': fflateLib.strToU8(this._buildContentTypesXml()),
        '_rels/.rels': fflateLib.strToU8(this._buildRootRelsXml()),
        'xl/workbook.xml': fflateLib.strToU8(this._buildWorkbookXml()),
        'xl/_rels/workbook.xml.rels': fflateLib.strToU8(this._buildWorkbookRelsXml()),
        'xl/styles.xml': fflateLib.strToU8(this._buildStylesXml()),
        'docProps/core.xml': fflateLib.strToU8(this._buildCorePropsXml()),
        'docProps/app.xml': fflateLib.strToU8(this._buildAppPropsXml())
      };

      this.sheets.forEach((sheet, idx) => {
        zipData[`xl/worksheets/sheet${idx + 1}.xml`] = fflateLib.strToU8(this._buildWorksheetXml(sheet));
      });

      const zipped = fflateLib.zipSync(zipData, { level: 6 });
      return uint8ToBase64(zipped);
    }
  }

  function uint8ToBase64(bytes) {
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
    }
    let binary = '';
    const CHUNK = 4096;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)));
    }
    return btoa(binary);
  }

  const ReturnPilotXlsx = {
    createWorkbook() {
      return new XlsxWorkbook();
    }
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ReturnPilotXlsx;
  } else {
    root.ReturnPilotXlsx = ReturnPilotXlsx;
  }
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this)));
