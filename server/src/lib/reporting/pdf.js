import PDFDocument from 'pdfkit';
import {
  C,
  fmtCell,
  fmtMoney,
  fmtNumber,
  fmtSummaryValue,
  badgeFor,
  computeTotals,
  DOT,
} from './common.js';

const MARGIN = 36;
const CELL_PAD = 6;
const BASE_SIZE = 8.5;
const HEADER_H = 24;
const FOOTER_H = 50; // reserved at the bottom of every page for the footer
const A4 = { w: 595.28, h: 841.89 };

/** Renders the report to a PDF and resolves with a Buffer. */
export function renderPdf(report, meta, clinic) {
  const columns = report.columns;
  const rows = report.rows || [];
  const totals = computeTotals(report);
  const textOf = (c, r) => fmtCell(c, r[c.key]);
  const isBadge = (c, r) => !!badgeFor(c, r[c.key]);

  // ── 1. Measure content so every column gets the width it needs ────────────
  const meas = new PDFDocument({ size: 'A4' });
  const desired = columns.map((c) => {
    meas.font('Helvetica-Bold').fontSize(7.5);
    let w = meas.widthOfString(c.label.toUpperCase()) + 2;
    meas.font('Helvetica').fontSize(BASE_SIZE);
    for (const r of rows.slice(0, 300)) {
      const s = textOf(c, r);
      let sw = meas.widthOfString(s) + (isBadge(c, r) ? 14 : 0);
      if (!c.type) sw = Math.min(sw, 230);
      if (sw > w) w = sw;
    }
    if (totals && totals[c.key] != null) {
      meas.font('Helvetica-Bold').fontSize(BASE_SIZE + 0.5);
      w = Math.max(w, meas.widthOfString(c.type === 'money' ? fmtMoney(totals[c.key]) : fmtNumber(totals[c.key])));
    }
    return Math.ceil(w) + CELL_PAD * 2 + 4;
  });
  meas.end();

  const landscape = desired.reduce((a, b) => a + b, 0) > A4.w - MARGIN * 2;

  const doc = new PDFDocument({
    size: 'A4',
    layout: landscape ? 'landscape' : 'portrait',
    // Bottom margin 0: drawing the footer near the page edge can never trigger
    // PDFKit's automatic page break (the cause of blank pages). Pagination is manual.
    margins: { top: MARGIN, left: MARGIN, right: MARGIN, bottom: 0 },
    bufferPages: true,
    info: {
      Title: report.title,
      Author: clinic.name,
      Subject: report.subtitle || report.title,
      Keywords: `MediFlow, ${meta.ref}`,
      Creator: 'MediFlow Reporting',
      Producer: 'MediFlow Reporting',
    },
  });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const pageW = doc.page.width - MARGIN * 2;
  const pageH = doc.page.height;
  const bottomLimit = pageH - FOOTER_H - 6;

  // ── 2. Column widths ──────────────────────────────────────────────────────
  const widths = allocateWidths(desired, columns, pageW);

  // ── helpers ───────────────────────────────────────────────────────────────
  /** Truncates text with "..." so it fits one line of the given width. */
  const fit = (text, width, fontName, size) => {
    doc.font(fontName).fontSize(size);
    if (doc.widthOfString(text) <= width) return text;
    let t = text;
    while (t.length > 1 && doc.widthOfString(`${t}...`) > width) t = t.slice(0, -1);
    return `${t}...`;
  };
  const line1 = (text, x, y, width, { fontName = 'Helvetica', size = 8, color = C.text, align = 'left', spacing } = {}) => {
    const s = fit(String(text), width, fontName, size);
    doc.fillColor(color).font(fontName).fontSize(size).text(s, x, y, { width, align, lineBreak: false, characterSpacing: spacing });
  };

  const topBar = () => doc.rect(0, 0, doc.page.width, 6).fill(C.teal);

  /** Slim running header used on every page after the first. Returns the next y. */
  const runningHeader = () => {
    topBar();
    line1(clinic.name, MARGIN, 20, pageW * 0.55, { fontName: 'Helvetica-Bold', size: 8, color: C.ink });
    line1(`${report.title}  ${DOT}  ${meta.ref}`, MARGIN + pageW * 0.5, 20, pageW * 0.5, { size: 8, color: C.muted, align: 'right' });
    doc.moveTo(MARGIN, 34).lineTo(MARGIN + pageW, 34).lineWidth(0.5).strokeColor(C.line).stroke();
    return 46;
  };
  const newPage = () => {
    doc.addPage();
    return runningHeader();
  };

  // ── 3. First-page masthead ────────────────────────────────────────────────
  topBar();
  let y = 28;

  // Logo mark: rounded square with a medical cross
  doc.roundedRect(MARGIN, y, 42, 42, 9).fill(C.teal);
  doc.roundedRect(MARGIN + 17.5, y + 8, 7, 26, 1.5).fill('#ffffff');
  doc.roundedRect(MARGIN + 8, y + 17.5, 26, 7, 1.5).fill('#ffffff');

  const textX = MARGIN + 54;
  const rightW = 175;
  const leftW = pageW - 54 - rightW - 12;
  line1(clinic.name, textX, y + 1, leftW, { fontName: 'Helvetica-Bold', size: 16, color: C.ink });
  line1(clinic.address, textX, y + 22, leftW, { size: 8, color: C.muted });
  line1(`Tel: ${clinic.phone}   ${DOT}   TIN: ${clinic.tin}`, textX, y + 33, leftW, { size: 8, color: C.muted });

  const rx = MARGIN + pageW - rightW;
  line1('OFFICIAL REPORT', rx, y + 1, rightW, { fontName: 'Helvetica-Bold', size: 7, color: C.teal, align: 'right', spacing: 1.2 });
  line1(meta.ref, rx, y + 13, rightW, { fontName: 'Helvetica-Bold', size: 9, color: C.ink, align: 'right' });
  line1('GENERATED', rx, y + 28, rightW, { size: 6.5, color: C.faint, align: 'right', spacing: 0.8 });
  line1(meta.generated, rx, y + 37, rightW, { fontName: 'Helvetica-Bold', size: 8, color: C.text, align: 'right' });

  y += 54;
  doc.moveTo(MARGIN, y).lineTo(MARGIN + pageW, y).lineWidth(1.5).strokeColor(C.teal).stroke();
  y += 16;

  // Title + subtitle
  doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(19).text(report.title, MARGIN, y, { width: pageW });
  y = doc.y + 3;
  if (report.subtitle) {
    doc.fillColor(C.muted).font('Helvetica').fontSize(9).text(report.subtitle, MARGIN, y, { width: pageW });
    y = doc.y + 2;
  }
  y += 10;

  // Metadata strip
  {
    const cells = [
      ['PREPARED BY', meta.preparedBy],
      ['ROLE', meta.role],
      ['RECORDS', String(meta.records)],
      ['CURRENCY', 'TSh'],
    ];
    const h = 32;
    doc.roundedRect(MARGIN, y, pageW, h, 5).fillAndStroke(C.zebra, C.line);
    const cw = pageW / cells.length;
    cells.forEach(([label, value], i) => {
      const cx = MARGIN + i * cw;
      if (i) doc.moveTo(cx, y + 7).lineTo(cx, y + h - 7).lineWidth(0.5).strokeColor(C.line).stroke();
      line1(label, cx + 12, y + 7, cw - 20, { size: 6.2, color: C.faint, fontName: 'Helvetica-Bold', spacing: 0.8 });
      line1(value, cx + 12, y + 17, cw - 20, { size: 9, color: C.ink, fontName: 'Helvetica-Bold' });
    });
    y += h + 14;
  }

  // KPI cards
  if (report.summary?.length) {
    const items = report.summary;
    const maxPer = landscape ? 6 : 4;
    const rowsNeeded = Math.ceil(items.length / maxPer);
    const perRow = Math.ceil(items.length / rowsNeeded); // balanced rows (8 -> 4+4, not 6+2)
    const gap = 8;
    const cardW = (pageW - gap * (perRow - 1)) / perRow;
    const cardH = 54;
    items.forEach((s, idx) => {
      const cx = MARGIN + (idx % perRow) * (cardW + gap);
      const cy = y + Math.floor(idx / perRow) * (cardH + gap);
      const primary = idx === 0;
      doc.roundedRect(cx, cy, cardW, cardH, 5).fillAndStroke(primary ? C.tealPale : '#ffffff', primary ? '#99f6e4' : C.line);
      doc.rect(cx, cy + 7, 3, cardH - 14).fill(C.teal);
      doc
        .fillColor(C.muted)
        .font('Helvetica-Bold')
        .fontSize(6.6)
        .text(String(s.label).toUpperCase(), cx + 13, cy + 9, { width: cardW - 22, height: 17, ellipsis: true, characterSpacing: 0.3 });
      const val = fmtSummaryValue(s);
      let size = 13.5;
      doc.font('Helvetica-Bold');
      while (size > 8 && doc.fontSize(size).widthOfString(val) > cardW - 22) size -= 0.5;
      doc.fillColor(primary ? C.teal : C.ink).fontSize(size).text(val, cx + 13, cy + 31, { width: cardW - 22, lineBreak: false });
    });
    y += Math.ceil(items.length / perRow) * (cardH + gap) + 6;
  }

  // ── 4. Table ──────────────────────────────────────────────────────────────
  const drawHeader = (yy) => {
    doc.rect(MARGIN, yy, pageW, HEADER_H).fill(C.teal);
    let x = MARGIN;
    columns.forEach((c, i) => {
      line1(c.label.toUpperCase(), x + CELL_PAD, yy + 8.5, widths[i] - CELL_PAD * 2, {
        fontName: 'Helvetica-Bold',
        size: 7.2,
        color: '#ffffff',
        align: c.type ? 'right' : 'left',
        spacing: 0.4,
      });
      x += widths[i];
    });
    return yy + HEADER_H;
  };

  // Keep the header together with at least two rows: never strand a header at the page bottom.
  if (y + HEADER_H + 2 * 22 > bottomLimit) y = newPage();
  y = drawHeader(y);

  if (!rows.length) {
    doc.rect(MARGIN, y, pageW, 40).fill(C.zebra);
    line1('No records found for the selected period.', MARGIN, y + 15, pageW, {
      fontName: 'Helvetica-Oblique',
      size: 9.5,
      color: C.muted,
      align: 'center',
    });
    y += 40;
  } else {
    rows.forEach((r, rowIdx) => {
      // Row height from the tallest wrapped text cell (max 3 lines).
      doc.font('Helvetica').fontSize(BASE_SIZE);
      const lineH = doc.currentLineHeight(true);
      let lines = 1;
      columns.forEach((c, i) => {
        if (c.type || isBadge(c, r)) return;
        const h = doc.heightOfString(textOf(c, r), { width: widths[i] - CELL_PAD * 2 });
        lines = Math.max(lines, Math.min(3, Math.round(h / lineH)));
      });
      const rowH = lines * lineH + 10;

      // Reserve room for the totals row on the last data row so it never sits alone.
      const need = rowH + (totals && rowIdx === rows.length - 1 ? 26 : 0);
      if (y + need > bottomLimit) {
        y = newPage();
        y = drawHeader(y);
      }
      doc.rect(MARGIN, y, pageW, rowH).fill(rowIdx % 2 === 0 ? '#ffffff' : C.zebra);
      doc.moveTo(MARGIN, y + rowH).lineTo(MARGIN + pageW, y + rowH).lineWidth(0.4).strokeColor(C.line).stroke();

      let x = MARGIN;
      columns.forEach((c, i) => {
        const cw = widths[i] - CELL_PAD * 2;
        const raw = r[c.key];
        const str = textOf(c, r);
        const badge = badgeFor(c, raw);
        const bold = ['total', 'balance', 'invoiceNumber', 'receiptNumber'].includes(c.key);

        if (badge) {
          const label = fit(str, cw - 12, 'Helvetica-Bold', 7);
          doc.font('Helvetica-Bold').fontSize(7);
          const pw = doc.widthOfString(label) + 12;
          const py = y + (rowH - 13) / 2;
          doc.roundedRect(x + CELL_PAD, py, pw, 13, 6.5).fill(badge.bg);
          doc.fillColor(badge.fg).text(label, x + CELL_PAD + 6, py + 3.2, { width: pw, lineBreak: false });
        } else if (c.type) {
          const v = Number(raw);
          const color = raw == null || raw === '' ? C.faint : v < 0 ? C.red : v === 0 ? C.faint : C.text;
          line1(str, x + CELL_PAD, y + (rowH - lineH) / 2, cw, {
            fontName: bold ? 'Helvetica-Bold' : 'Helvetica',
            size: BASE_SIZE,
            color,
            align: 'right',
          });
        } else {
          doc
            .fillColor(raw == null || raw === '' ? C.faint : C.text)
            .font(bold ? 'Helvetica-Bold' : 'Helvetica')
            .fontSize(BASE_SIZE)
            .text(str, x + CELL_PAD, y + 5, { width: cw, height: lines * lineH, ellipsis: true });
        }
        x += widths[i];
      });
      y += rowH;
    });

    // Totals row
    if (totals) {
      const h = 26;
      doc.rect(MARGIN, y, pageW, h).fill(C.tealSoft);
      doc.moveTo(MARGIN, y).lineTo(MARGIN + pageW, y).lineWidth(1.2).strokeColor(C.teal).stroke();
      doc.moveTo(MARGIN, y + h).lineTo(MARGIN + pageW, y + h).lineWidth(1.2).strokeColor(C.teal).stroke();
      let x = MARGIN;
      columns.forEach((c, i) => {
        const cw = widths[i] - CELL_PAD * 2;
        if (i === 0) {
          line1('TOTAL', x + CELL_PAD, y + 8.5, cw, { fontName: 'Helvetica-Bold', size: 8, color: C.teal, spacing: 0.6 });
        } else if (totals[c.key] != null) {
          const v = totals[c.key];
          line1(c.type === 'money' ? fmtMoney(v) : fmtNumber(v), x + CELL_PAD, y + 8, cw, {
            fontName: 'Helvetica-Bold',
            size: BASE_SIZE + 0.5,
            color: v < 0 ? C.red : C.ink,
            align: 'right',
          });
        }
        x += widths[i];
      });
      y += h;
    }
  }

  // ── 5. End of report + sign-off ───────────────────────────────────────────
  y += 8;
  line1(`End of report  ${DOT}  ${rows.length} record${rows.length === 1 ? '' : 's'}`, MARGIN, y, pageW, {
    fontName: 'Helvetica-Oblique',
    size: 8,
    color: C.muted,
    align: 'right',
  });
  y += 26;

  const signH = 62;
  if (y + signH > bottomLimit) y = newPage() + 6;
  const boxes = ['Prepared by', 'Reviewed by', 'Approved by'];
  const gap = 22;
  const bw = (pageW - gap * (boxes.length - 1)) / boxes.length;
  boxes.forEach((label, i) => {
    const bx = MARGIN + i * (bw + gap);
    line1(label.toUpperCase(), bx, y, bw, { fontName: 'Helvetica-Bold', size: 6.8, color: C.teal, spacing: 0.8 });
    doc.moveTo(bx, y + 34).lineTo(bx + bw, y + 34).lineWidth(0.7).strokeColor(C.muted).stroke();
    line1('Name, signature & date', bx, y + 38, bw, { size: 7, color: C.faint });
  });

  // ── 6. Footer + page numbers on every page ────────────────────────────────
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const fy = pageH - 38;
    doc.moveTo(MARGIN, fy - 7).lineTo(MARGIN + pageW, fy - 7).lineWidth(0.5).strokeColor(C.line).stroke();
    line1(`${clinic.name}  ${DOT}  Official verified report`, MARGIN, fy, pageW * 0.4, { size: 7.5, color: C.muted });
    line1(meta.ref, MARGIN + pageW * 0.3, fy, pageW * 0.4, { size: 7.5, color: C.muted, align: 'center' });
    line1(`Page ${i + 1} of ${range.count}`, MARGIN + pageW - 120, fy, 120, {
      fontName: 'Helvetica-Bold',
      size: 7.5,
      color: C.text,
      align: 'right',
    });
    line1(meta.confidentiality, MARGIN, fy + 12, pageW, { fontName: 'Helvetica-Oblique', size: 6.5, color: C.faint });
  }

  doc.end();
  return done;
}

/**
 * Chooses column widths: content width where it fits, spare room spread evenly;
 * when too wide, flexible text columns shrink first so numbers are never cut.
 */
function allocateWidths(desired, columns, pageW) {
  let widths = desired.slice();
  const sum = () => widths.reduce((a, b) => a + b, 0);
  if (sum() <= pageW) {
    const extra = (pageW - sum()) / widths.length;
    return widths.map((w) => w + extra);
  }
  const flexIdx = columns.map((_, i) => i).filter((i) => !columns[i].type);
  const flexSum = flexIdx.reduce((a, i) => a + widths[i], 0);
  const room = pageW - (sum() - flexSum);
  if (flexIdx.length && room > flexIdx.length * 50) {
    flexIdx.forEach((i) => (widths[i] = (widths[i] / flexSum) * room));
  } else {
    const k = pageW / sum();
    widths = widths.map((w) => w * k);
  }
  return widths;
}
