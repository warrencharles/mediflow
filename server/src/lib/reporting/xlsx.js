import ExcelJS from 'exceljs';
import {
  C,
  argb,
  fmtCell,
  fmtMoney,
  fmtNumber,
  fmtSummaryValue,
  badgeFor,
  humanize,
  computeTotals,
  DOT,
} from './common.js';

const FONT = 'Calibri';
const MONEY_FMT = '"TSh "#,##0;[Red]-"TSh "#,##0';
const MONEY_FMT_ROW = '"TSh "#,##0;[Red]-"TSh "#,##0;"TSh "0';
const NUM_FMT = '#,##0;[Red]-#,##0';
const DATE_FMT = 'yyyy-mm-dd';
const DATETIME_FMT = 'yyyy-mm-dd hh:mm';

const solid = (hex) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: argb(hex) } });
const edge = (hex, style = 'thin') => ({ style, color: { argb: argb(hex) } });
const font = (o = {}) => ({ name: FONT, size: 10, color: { argb: argb(C.text) }, ...o, ...(o.color ? { color: { argb: argb(o.color) } } : {}) });
const hf = (s) => String(s).replace(/&/g, '&&'); // escape for Excel header/footer codes

// ── Column type detection ───────────────────────────────────────────────────
const RE_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const RE_DT = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/;

/** 'money' | 'number' | 'date' | 'datetime' | 'text' — dates become real Excel dates so they sort/filter. */
function columnKind(col, rows) {
  if (col.type === 'money' || col.type === 'number') return col.type;
  let kind = null;
  for (const r of rows) {
    const v = r[col.key];
    if (v == null || v === '') continue;
    let k;
    if (v instanceof Date) k = 'datetime';
    else if (typeof v === 'string' && RE_DATE.test(v)) k = 'date';
    else if (typeof v === 'string' && RE_DT.test(v)) k = 'datetime';
    else return 'text';
    kind = kind && kind !== k ? 'datetime' : k;
  }
  return kind || 'text';
}

function toExcelDate(v) {
  if (v instanceof Date) return v;
  let m = RE_DT.exec(v);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)));
  m = RE_DATE.exec(v);
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}

// ── Main entry ──────────────────────────────────────────────────────────────

/** Builds the workbook and returns it as a Buffer. */
export async function renderXlsx(report, meta, clinic) {
  const wb = new ExcelJS.Workbook();
  wb.creator = clinic.name;
  wb.lastModifiedBy = 'MediFlow';
  wb.company = clinic.name;
  wb.title = report.title;
  wb.subject = report.subtitle || report.title;
  wb.keywords = `MediFlow, ${meta.ref}`;
  wb.description = `${report.title} \u2014 ${meta.ref}`;
  wb.created = meta.generatedAt;
  wb.modified = meta.generatedAt;
  wb.calcProperties = { fullCalcOnLoad: true };

  const rows = report.rows || [];
  const totals = computeTotals(report);

  buildSummarySheet(wb, report, meta, clinic);
  buildDataSheet(wb, report, meta, clinic, rows, totals);

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ── Sheet 1: Summary (cover) ────────────────────────────────────────────────

function buildSummarySheet(wb, report, meta, clinic) {
  const ws = wb.addWorksheet('Summary', {
    properties: { tabColor: { argb: argb(C.teal) } },
    views: [{ showGridLines: false }],
    pageSetup: {
      paperSize: 9,
      orientation: 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 1,
      horizontalCentered: true,
      margins: { left: 0.6, right: 0.6, top: 0.7, bottom: 0.7, header: 0.3, footer: 0.3 },
    },
  });
  ws.columns = [{ width: 46 }, { width: 30 }, { width: 3 }, { width: 24 }]; // C is a narrow spacer
  const LAST = 'D';
  const span = (r) => ws.mergeCells(`A${r}:${LAST}${r}`);

  // Brand banner
  let r = 1;
  ws.getRow(r).height = 36;
  ws.getCell(`A${r}`).value = clinic.name.toUpperCase();
  span(r);
  Object.assign(ws.getCell(`A${r}`), {
    font: font({ bold: true, size: 17, color: '#ffffff' }),
    fill: solid(C.ink),
    alignment: { vertical: 'middle', horizontal: 'left', indent: 1 },
  });
  r = 2;
  ws.getRow(r).height = 20;
  ws.getCell(`A${r}`).value = `${clinic.address}  ${DOT}  Tel: ${clinic.phone}  ${DOT}  TIN: ${clinic.tin}`;
  span(r);
  Object.assign(ws.getCell(`A${r}`), {
    font: font({ size: 9, color: '#99f6e4' }),
    fill: solid('#1e293b'),
    alignment: { vertical: 'middle', horizontal: 'left', indent: 1 },
  });
  r = 3;
  ws.getRow(r).height = 5;
  ws.getCell(`A${r}`).value = '';
  span(r);
  ws.getCell(`A${r}`).fill = solid(C.tealMid);

  // Title + subtitle
  r = 5;
  ws.getRow(r).height = 34;
  ws.getCell(`A${r}`).value = report.title;
  span(r);
  Object.assign(ws.getCell(`A${r}`), {
    font: font({ bold: true, size: 20, color: C.ink }),
    alignment: { vertical: 'middle', horizontal: 'left' },
  });
  if (report.subtitle) {
    r = 6;
    ws.getRow(r).height = 16 * Math.max(1, Math.ceil(report.subtitle.length / 100)) + 2;
    ws.getCell(`A${r}`).value = report.subtitle;
    span(r);
    Object.assign(ws.getCell(`A${r}`), {
      font: font({ size: 10.5, color: C.muted }),
      alignment: { vertical: 'top', horizontal: 'left', wrapText: true },
    });
  }

  const section = (row, label) => {
    ws.getRow(row).height = 22;
    ws.getCell(`A${row}`).value = label;
    for (const col of ['A', 'B', 'C', 'D']) {
      ws.getCell(`${col}${row}`).border = { bottom: edge(C.teal, 'medium') };
    }
    Object.assign(ws.getCell(`A${row}`), {
      font: font({ bold: true, size: 9.5, color: C.teal }),
      alignment: { vertical: 'bottom', horizontal: 'left' },
    });
  };

  // Report details
  r = 8;
  section(r, 'REPORT DETAILS');
  const details = [
    ['Reference no.', meta.ref],
    ['Generated', meta.generated],
    ['Prepared by', `${meta.preparedBy} (${meta.role})`],
    ['Records listed', meta.records],
    ['Currency', meta.currency],
  ];
  for (const [label, value] of details) {
    r += 1;
    ws.getRow(r).height = 21;
    ws.getCell(`A${r}`).value = label;
    ws.getCell(`B${r}`).value = value;
    ws.mergeCells(`B${r}:D${r}`);
    Object.assign(ws.getCell(`A${r}`), {
      font: font({ color: C.muted }),
      alignment: { vertical: 'middle', horizontal: 'left', indent: 1 },
    });
    Object.assign(ws.getCell(`B${r}`), {
      font: font({ bold: true, size: 10.5, color: C.ink }),
      alignment: { vertical: 'middle', horizontal: 'left' },
      ...(typeof value === 'number' ? { numFmt: '#,##0' } : {}),
    });
    for (const col of ['A', 'B', 'C', 'D']) ws.getCell(`${col}${r}`).border = { bottom: edge(C.line) };
  }

  // Key figures
  if (report.summary?.length) {
    r += 2;
    section(r, 'KEY FIGURES');
    report.summary.forEach((s, i) => {
      r += 1;
      const first = i === 0;
      const tooLong = String(s.label).length > 44;
      ws.getRow(r).height = first ? 28 : tooLong ? 32 : 24;
      const lc = ws.getCell(`A${r}`);
      const vc = ws.getCell(`B${r}`);
      lc.value = s.label;
      ws.mergeCells(`B${r}:D${r}`);
      const isNum = typeof s.value === 'number' && Number.isFinite(s.value);
      vc.value = isNum ? s.value : fmtSummaryValue(s);
      const bg = first ? C.tealPale : i % 2 ? C.zebra : C.white;
      Object.assign(lc, {
        font: font({ bold: first, size: first ? 11 : 10 }),
        fill: solid(bg),
        alignment: { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true },
        border: first ? { bottom: edge(C.line), left: edge(C.teal, 'thick') } : { bottom: edge(C.line) },
      });
      Object.assign(vc, {
        font: font({ bold: true, size: first ? 14 : 11.5, color: first ? C.teal : C.ink }),
        fill: solid(bg),
        alignment: { vertical: 'middle', horizontal: 'right', indent: 1 },
        border: { bottom: edge(C.line) },
        ...(isNum ? { numFmt: s.money ? MONEY_FMT : '#,##0' } : {}),
      });
    });
  }

  // Authorisation block
  r += 2;
  section(r, 'AUTHORISATION');
  r += 1;
  ws.getRow(r).height = 16;
  [['A', 'Role'], ['B', 'Name & signature'], ['D', 'Date']].forEach(([col, text]) => {
    const cell = ws.getCell(`${col}${r}`);
    cell.value = text;
    cell.font = font({ size: 8.5, color: C.faint, bold: true });
    cell.alignment = { vertical: 'bottom', horizontal: 'left', indent: col === 'A' ? 1 : 0 };
  });
  for (const role of ['Prepared by', 'Reviewed by', 'Approved by']) {
    r += 1;
    ws.getRow(r).height = 36;
    const lc = ws.getCell(`A${r}`);
    lc.value = role;
    lc.font = font({ bold: true, color: C.ink });
    lc.alignment = { vertical: 'bottom', horizontal: 'left', indent: 1 };
    lc.border = { bottom: edge(C.line) };
    ws.getCell(`B${r}`).border = { bottom: edge(C.muted) };
    ws.getCell(`D${r}`).border = { bottom: edge(C.muted) };
  }

  // Confidentiality note
  r += 2;
  ws.getRow(r).height = 28;
  ws.getCell(`A${r}`).value = meta.confidentiality;
  span(r);
  Object.assign(ws.getCell(`A${r}`), {
    font: font({ italic: true, size: 8.5, color: C.muted }),
    alignment: { vertical: 'top', horizontal: 'left', wrapText: true },
  });

  ws.headerFooter = {
    oddFooter: `&L&8${hf(clinic.name)}  ${DOT}  Confidential&C&8${hf(meta.ref)}&R&8Generated ${hf(meta.generated)}`,
  };
}

// ── Sheet 2: Data table ─────────────────────────────────────────────────────

function buildDataSheet(wb, report, meta, clinic, rows, totals) {
  const columns = report.columns;
  const HEADER_ROW = 4;
  const kinds = columns.map((c) => columnKind(c, rows));

  const ws = wb.addWorksheet('Data', {
    properties: { tabColor: { argb: argb(C.ink) } },
    views: [{ state: 'frozen', ySplit: HEADER_ROW, showGridLines: false }],
    pageSetup: {
      paperSize: 9,
      orientation: columns.length > 6 ? 'landscape' : 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: true,
      margins: { left: 0.4, right: 0.4, top: 0.7, bottom: 0.7, header: 0.3, footer: 0.3 },
      printTitlesRow: `${HEADER_ROW}:${HEADER_ROW}`,
    },
  });

  // Column widths sized from content (header, data and totals), wrapping very long text.
  const widths = [];
  const wrap = [];
  columns.forEach((c, i) => {
    const kind = kinds[i];
    let max = c.label.length * 1.1 + 4;
    for (const r of rows.slice(0, 300)) {
      const len = kind === 'date' ? 10 : kind === 'datetime' ? 16 : fmtCell(c, r[c.key]).length;
      if (len > max) max = len;
    }
    if (totals && totals[c.key] != null) {
      max = Math.max(max, (c.type === 'money' ? fmtMoney(totals[c.key]) : fmtNumber(totals[c.key])).length);
    }
    const minW = kind === 'datetime' ? 18 : kind === 'date' ? 13 : 11;
    const w = Math.min(46, Math.max(minW, Math.ceil(max + 3)));
    widths.push(w);
    wrap.push(kind === 'text' && max + 3 > 46);
    ws.getColumn(i + 1).width = w;
  });

  const bannerCols = Math.max(columns.length, 4);
  const last = ws.getColumn(bannerCols).letter;
  const totalChars = ws.columns.slice(0, bannerCols).reduce((a, c) => a + (c.width || 10), 0);

  // Row 1: clinic banner
  ws.getRow(1).height = 28;
  ws.getCell('A1').value = clinic.name.toUpperCase();
  ws.mergeCells(`A1:${last}1`);
  Object.assign(ws.getCell('A1'), {
    font: font({ bold: true, size: 15, color: '#ffffff' }),
    fill: solid(C.ink),
    alignment: { vertical: 'middle', horizontal: 'left', indent: 1 },
  });

  // Row 2: report title + subtitle
  const titleText = `${report.title}${report.subtitle ? `  \u2014  ${report.subtitle}` : ''}`;
  ws.getRow(2).height = 22 * Math.max(1, Math.ceil((titleText.length * 1.15) / totalChars));
  ws.getCell('A2').value = titleText;
  ws.mergeCells(`A2:${last}2`);
  Object.assign(ws.getCell('A2'), {
    font: font({ bold: true, size: 11.5, color: '#ffffff' }),
    fill: solid(C.tealMid),
    alignment: { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true },
  });

  // Row 3: reference line
  ws.getRow(3).height = 18;
  ws.getCell('A3').value = `Ref ${meta.ref}  ${DOT}  Generated ${meta.generated}  ${DOT}  Prepared by ${meta.preparedBy}  ${DOT}  ${meta.records} record${meta.records === 1 ? '' : 's'}`;
  ws.mergeCells(`A3:${last}3`);
  Object.assign(ws.getCell('A3'), {
    font: font({ size: 9, color: C.muted }),
    fill: solid(C.tealPale),
    alignment: { vertical: 'middle', horizontal: 'left', indent: 1 },
  });

  // Row 4: table header
  const header = ws.getRow(HEADER_ROW);
  header.height = 26;
  columns.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.label.toUpperCase();
    cell.font = font({ bold: true, size: 9.5, color: '#ffffff' });
    cell.fill = solid(C.teal);
    cell.alignment = {
      vertical: 'middle',
      horizontal: c.type ? 'right' : 'left',
      indent: 1,
      wrapText: true,
    };
    cell.border = { bottom: edge(C.ink, 'medium') };
  });

  // Data rows
  const first = HEADER_ROW + 1;
  if (!rows.length) {
    const r = first;
    ws.getRow(r).height = 34;
    ws.getCell(`A${r}`).value = 'No records found for the selected period.';
    ws.mergeCells(`A${r}:${last}${r}`);
    Object.assign(ws.getCell(`A${r}`), {
      font: font({ italic: true, color: C.muted }),
      fill: solid(C.zebra),
      alignment: { vertical: 'middle', horizontal: 'center' },
    });
  }

  rows.forEach((rec, idx) => {
    const row = ws.getRow(first + idx);
    const bg = idx % 2 === 0 ? C.white : C.zebra;
    let lines = 1;

    columns.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      const kind = kinds[i];
      const raw = rec[c.key];
      const empty = raw == null || raw === '';

      if (kind === 'money' || kind === 'number') {
        cell.value = Number(raw || 0);
        cell.numFmt = kind === 'money' ? MONEY_FMT_ROW : NUM_FMT;
        cell.alignment = { vertical: 'middle', horizontal: 'right', indent: 1 };
      } else if (kind === 'date' || kind === 'datetime') {
        if (!empty) cell.value = toExcelDate(raw);
        cell.numFmt = kind === 'date' ? DATE_FMT : DATETIME_FMT;
        cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      } else {
        const text = empty ? '' : humanize(c, raw);
        cell.value = text;
        cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: wrap[i] };
        if (wrap[i]) lines = Math.max(lines, Math.ceil(text.length / Math.max(8, widths[i] - 3)));
      }

      const bold = ['total', 'balance', 'invoiceNumber', 'receiptNumber'].includes(c.key);
      cell.font = font({ bold, size: 10 });
      cell.fill = solid(bg);
      cell.border = { bottom: edge(C.line) };

      const badge = badgeFor(c, raw);
      if (badge) {
        cell.font = font({ bold: true, size: 9.5, color: badge.fg });
        cell.fill = solid(badge.bg);
        cell.alignment = { ...cell.alignment, horizontal: 'center', indent: 0 };
      }
    });
    row.height = lines > 1 ? Math.min(6, lines) * 13.5 + 7 : 21;
  });

  // Totals row (live formulas: respond to the filter dropdowns)
  let lastRow = first + Math.max(rows.length, 1) - 1;
  if (totals) {
    const r = lastRow + 1;
    const row = ws.getRow(r);
    row.height = 25;
    columns.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      cell.fill = solid(C.tealSoft);
      cell.font = font({ bold: true, size: 10.5, color: C.ink });
      cell.border = { top: edge(C.teal, 'medium'), bottom: edge(C.teal, 'medium') };
      if (i === 0) {
        cell.value = 'TOTAL';
        cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      } else if (totals[c.key] != null) {
        const L = ws.getColumn(i + 1).letter;
        cell.value = { formula: `SUBTOTAL(109,${L}${first}:${L}${lastRow})`, result: totals[c.key] };
        cell.numFmt = c.type === 'money' ? MONEY_FMT : NUM_FMT;
        cell.alignment = { vertical: 'middle', horizontal: 'right', indent: 1 };
      }
    });
    lastRow = r;
  }

  // Filters, footer note, print header/footer
  if (rows.length) {
    ws.autoFilter = {
      from: { row: HEADER_ROW, column: 1 },
      to: { row: HEADER_ROW, column: columns.length },
    };
  }
  const noteRow = lastRow + 2;
  ws.getCell(`A${noteRow}`).value = `End of report  ${DOT}  ${meta.records} record${meta.records === 1 ? '' : 's'}  ${DOT}  ${meta.confidentiality}`;
  ws.getCell(`A${noteRow}`).font = font({ italic: true, size: 8.5, color: C.muted });

  ws.headerFooter = {
    oddHeader: `&L&"Calibri,Bold"&9${hf(clinic.name)}&R&9${hf(report.title)}`,
    oddFooter: `&L&8${hf(meta.ref)}  ${DOT}  Confidential&C&8Generated ${hf(meta.generated)}&R&8Page &P of &N`,
  };
}
