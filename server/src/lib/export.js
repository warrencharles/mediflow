import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import { config } from '../config.js';
import { prisma } from '../db.js';

/**
 * Executive-grade tabular PDF & Excel export used by every MediFlow report.
 * report = {
 *   title,
 *   subtitle,
 *   columns: [{ key, label, type?: 'money'|'number'|'text', width? }],
 *   rows: [...],
 *   summary?: [{ label, value, money?: boolean }]
 * }
 */
export async function sendReport(res, format, report) {
  const safe = report.title.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
  const dateTag = new Date().toISOString().slice(0, 10);
  const clinicSetting = await prisma.setting.findUnique({ where: { key: 'clinic' } }).catch(() => null);
  const clinic = {
    name: clinicSetting?.value?.name || config.clinicName || 'MediFlow Healthcare Group',
    address: clinicSetting?.value?.address || 'Plot 42, Ali Hassan Mwinyi Road, Dar es Salaam, Tanzania',
    phone: clinicSetting?.value?.phone || '+255 22 266 4800',
    tin: clinicSetting?.value?.tin || '132-894-210',
  };

  if (format === 'xlsx') return sendXlsx(res, report, `${safe}_${dateTag}.xlsx`, clinic);
  if (format === 'pdf') return sendPdf(res, report, `${safe}_${dateTag}.pdf`, clinic);
  return res.json(report);
}

const fmtMoney = (n) => `TSh ${Number(n || 0).toLocaleString('en-US')}`;
const fmtCell = (col, v) => {
  if (v == null || v === '') return 'â€”';
  if (col.type === 'money') return fmtMoney(v);
  if (col.type === 'number') return Number(v).toLocaleString('en-US');
  if (v instanceof Date) return v.toISOString().replace('T', ' ').slice(0, 16);
  return String(v);
};

async function sendXlsx(res, report, filename, clinic) {
  const wb = new ExcelJS.Workbook();
  wb.creator = clinic.name;
  wb.created = new Date();

  const ws = wb.addWorksheet('Official Report', {
    views: [{ state: 'frozen', ySplit: report.summary?.length ? 9 : 5 }],
    pageSetup: {
      paperSize: 9,
      orientation: report.columns.length > 6 ? 'landscape' : 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    },
  });

  const colCount = Math.max(report.columns.length, 4);
  const lastColLetter = ws.getColumn(colCount).letter;

  // Row 1: Clinic Brand Banner
  const r1 = ws.addRow([clinic.name.toUpperCase()]);
  ws.mergeCells(`A1:${lastColLetter}1`);
  r1.height = 28;
  r1.getCell(1).font = { name: 'Calibri', bold: true, size: 15, color: { argb: 'FFFFFFFF' } };
  r1.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
  r1.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

  // Row 2: Clinic Contact & TIN Metadata
  const r2 = ws.addRow([`${clinic.address}  |  Tel: ${clinic.phone}  |  TIN: ${clinic.tin}`]);
  ws.mergeCells(`A2:${lastColLetter}2`);
  r2.height = 19;
  r2.getCell(1).font = { name: 'Calibri', size: 10, color: { argb: 'FFCCFBF1' } };
  r2.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
  r2.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

  // Row 3: Report Title & Period Banner
  const generatedStr = new Date(Date.now() + 3 * 3600000).toISOString().replace('T', ' ').slice(0, 16) + ' EAT';
  const r3 = ws.addRow([
    `${report.title}${report.subtitle ? ` â€” ${report.subtitle}` : ''}   (Generated: ${generatedStr})`,
  ]);
  ws.mergeCells(`A3:${lastColLetter}3`);
  r3.height = 24;
  r3.getCell(1).font = { name: 'Calibri', bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
  r3.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D9488' } };
  r3.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

  ws.addRow([]);

  // Optional Executive Summary Block
  if (report.summary?.length) {
    const sumTitle = ws.addRow(['EXECUTIVE SUMMARY']);
    sumTitle.getCell(1).font = { name: 'Calibri', bold: true, size: 10, color: { argb: 'FF0F766E' } };

    const labelsRow = ws.addRow(report.summary.map((s) => s.label));
    const valsRow = ws.addRow(
      report.summary.map((s) => (typeof s.value === 'number' ? s.value : String(s.value ?? ''))),
    );
    labelsRow.height = 18;
    valsRow.height = 22;

    report.summary.forEach((s, idx) => {
      const lc = labelsRow.getCell(idx + 1);
      const vc = valsRow.getCell(idx + 1);
      lc.font = { name: 'Calibri', bold: true, size: 9, color: { argb: 'FF475569' } };
      lc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0FDFA' } };
      lc.border = {
        top: { style: 'thin', color: { argb: 'FF99F6E4' } },
        left: { style: 'thin', color: { argb: 'FF99F6E4' } },
        right: { style: 'thin', color: { argb: 'FF99F6E4' } },
      };

      vc.font = { name: 'Calibri', bold: true, size: 11, color: { argb: 'FF0F172A' } };
      vc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0FDFA' } };
      vc.border = {
        bottom: { style: 'medium', color: { argb: 'FF0D9488' } },
        left: { style: 'thin', color: { argb: 'FF99F6E4' } },
        right: { style: 'thin', color: { argb: 'FF99F6E4' } },
      };
      if (s.money) {
        vc.numFmt = '"TSh "#,##0';
        vc.alignment = { horizontal: 'left', vertical: 'middle' };
      } else if (typeof s.value === 'number') {
        vc.numFmt = '#,##0';
        vc.alignment = { horizontal: 'left', vertical: 'middle' };
      }
    });

    ws.addRow([]);
  }

  // Table Header Row
  const header = ws.addRow(report.columns.map((c) => c.label.toUpperCase()));
  header.height = 24;
  header.eachCell((cell, colNumber) => {
    const colDef = report.columns[colNumber - 1];
    cell.font = { name: 'Calibri', bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
    cell.alignment = {
      vertical: 'middle',
      horizontal: colDef?.type ? 'right' : 'left',
      indent: colDef?.type ? 0 : 1,
    };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF0F766E' } },
      bottom: { style: 'medium', color: { argb: 'FF0F172A' } },
      left: { style: 'thin', color: { argb: 'FF115E59' } },
      right: { style: 'thin', color: { argb: 'FF115E59' } },
    };
  });

  // Data Rows with Zebra Striping
  report.rows.forEach((r, rowIdx) => {
    const row = ws.addRow(
      report.columns.map((c) => {
        const v = r[c.key];
        if (c.type === 'money' || c.type === 'number') return Number(v || 0);
        if (v instanceof Date) return v;
        return v ?? 'â€”';
      }),
    );
    row.height = 20;
    const bg = rowIdx % 2 === 0 ? 'FFFFFFFF' : 'FFF8FAFC';

    report.columns.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      cell.font = {
        name: 'Calibri',
        size: 10,
        bold: c.key === 'total' || c.key === 'balance',
        color: { argb: 'FF1E293B' },
      };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      };
      if (c.type === 'money') {
        cell.numFmt = '"TSh "#,##0';
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
      } else if (c.type === 'number') {
        cell.numFmt = '#,##0';
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
      } else {
        cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      }
    });
  });

  // Filter dropdowns on the header row + repeat header when printing
  if (report.rows.length) {
    ws.autoFilter = {
      from: { row: header.number, column: 1 },
      to: { row: header.number, column: report.columns.length },
    };
  }
  ws.pageSetup.printTitlesRow = `${header.number}:${header.number}`;
  ws.headerFooter = {
    oddFooter: `&L&8${clinic.name} Â· Official Verified Report&R&8Page &P of &N`,
  };

  // Smart Auto-Fit Column Widths
  report.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    let maxLen = c.label.length + 4;
    for (const r of report.rows.slice(0, 200)) {
      const str = fmtCell(c, r[c.key]);
      if (str.length > maxLen) maxLen = str.length;
    }
    col.width = Math.min(44, Math.max(14, maxLen + 4));
  });

  // Footer note
  ws.addRow([]);
  const footerRow = ws.addRow([
    `Official MediFlow System Export Â· Verified Transaction Ledger Â· ${clinic.name}`,
  ]);
  footerRow.getCell(1).font = { name: 'Calibri', italic: true, size: 9, color: { argb: 'FF64748B' } };

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await wb.xlsx.write(res);
  res.end();
}


// ── PDF (light, print-friendly design) ──
const C = {
  ink: '#0f172a',
  text: '#1e293b',
  muted: '#64748b',
  line: '#e2e8f0',
  teal: '#0f766e',
  tealSoft: '#ccfbf1',
  tealPale: '#f0fdfa',
  zebra: '#f8fafc',
};

function sendPdf(res, report, filename, clinic) {
  const margin = 36;
  const cellPad = 6;
  const baseSize = 8.5;

  // 1. Measure content so columns get the width they need (no cut text).
  const meas = new PDFDocument({ size: 'A4' });
  const textOf = (c, r) => fmtCell(c, r[c.key]);
  const desired = report.columns.map((c) => {
    meas.font('Helvetica-Bold').fontSize(8);
    let w = meas.widthOfString(c.label.toUpperCase());
    meas.font('Helvetica').fontSize(baseSize);
    for (const r of report.rows.slice(0, 300)) {
      const s = textOf(c, r);
      const single = c.type ? meas.widthOfString(s) : Math.min(meas.widthOfString(s), 230);
      if (single > w) w = single;
    }
    return Math.ceil(w) + cellPad * 2 + 4;
  });
  meas.end();
  const totalDesired = desired.reduce((a, b) => a + b, 0);
  const portraitW = 595.28 - margin * 2;
  const landscape = totalDesired > portraitW;

  const doc = new PDFDocument({
    size: 'A4',
    layout: landscape ? 'landscape' : 'portrait',
    // Bottom margin 0: drawing the footer near the page edge can never trigger
    // PDFKit's auto page-break (cause of blank pages). Pagination is manual.
    margins: { top: margin, left: margin, right: margin, bottom: 0 },
    bufferPages: true,
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  doc.pipe(res);

  const pageW = doc.page.width - margin * 2;
  const pageH = doc.page.height;
  const footerH = 46;
  const bottomLimit = pageH - footerH - 8;
  const generatedStr = new Date(Date.now() + 3 * 3600000).toISOString().replace('T', ' ').slice(0, 16) + ' EAT';

  // Column widths: use desired widths; if too wide, shrink flexible text columns first.
  let widths = desired.slice();
  const sum = () => widths.reduce((a, b) => a + b, 0);
  if (sum() > pageW) {
    const fixed = widths.map((w, i) => (report.columns[i].type ? w : 0));
    const fixedSum = fixed.reduce((a, b) => a + b, 0);
    const flexIdx = report.columns.map((c, i) => i).filter((i) => !report.columns[i].type);
    const flexSum = flexIdx.reduce((a, i) => a + widths[i], 0);
    if (flexIdx.length && pageW - (sum() - flexSum) > flexIdx.length * 50) {
      const room = pageW - (sum() - flexSum);
      flexIdx.forEach((i) => (widths[i] = (widths[i] / flexSum) * room));
    } else {
      const k = pageW / sum();
      widths = widths.map((w) => w * k);
    }
  } else {
    const extra = (pageW - sum()) / widths.length; // spread spare room evenly
    widths = widths.map((w) => w + extra);
  }

  // ── Header (white, teal accent) ──
  let y = margin;
  doc.roundedRect(margin, y, 38, 38, 8).fill(C.teal);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(20).text('M', margin, y + 9, {
    width: 38,
    align: 'center',
    lineBreak: false,
  });
  const textX = margin + 50;
  const rightW = 170;
  doc
    .fillColor(C.ink)
    .font('Helvetica-Bold')
    .fontSize(15)
    .text(clinic.name, textX, y + 1, { width: pageW - 50 - rightW - 10, lineBreak: false, ellipsis: true });
  doc
    .fillColor(C.muted)
    .font('Helvetica')
    .fontSize(8)
    .text(`${clinic.address}`, textX, y + 20, { width: pageW - 50 - rightW - 10, lineBreak: false, ellipsis: true });
  doc
    .fillColor(C.muted)
    .fontSize(8)
    .text(`Tel: ${clinic.phone}   ·   TIN: ${clinic.tin}`, textX, y + 31, {
      width: pageW - 50 - rightW - 10,
      lineBreak: false,
      ellipsis: true,
    });
  doc
    .fillColor(C.muted)
    .font('Helvetica')
    .fontSize(7.5)
    .text('GENERATED', margin + pageW - rightW, y + 4, { width: rightW, align: 'right', lineBreak: false });
  doc
    .fillColor(C.text)
    .font('Helvetica-Bold')
    .fontSize(9)
    .text(generatedStr, margin + pageW - rightW, y + 15, { width: rightW, align: 'right', lineBreak: false });

  y += 48;
  doc.moveTo(margin, y).lineTo(margin + pageW, y).lineWidth(2).strokeColor(C.teal).stroke();
  y += 14;

  // Title + subtitle (wrapped, never cut)
  doc.fillColor(C.teal).font('Helvetica-Bold').fontSize(16).text(report.title, margin, y, { width: pageW });
  y = doc.y + 2;
  if (report.subtitle) {
    doc.fillColor(C.muted).font('Helvetica').fontSize(9).text(report.subtitle, margin, y, { width: pageW });
    y = doc.y + 2;
  }
  y += 10;

  // ── KPI cards ──
  if (report.summary?.length) {
    const items = report.summary;
    const perRow = Math.min(items.length, landscape ? 6 : 4);
    const gap = 8;
    const cardW = (pageW - gap * (perRow - 1)) / perRow;
    const cardH = 42;
    items.forEach((s, idx) => {
      const col = idx % perRow;
      const rowN = Math.floor(idx / perRow);
      const cx = margin + col * (cardW + gap);
      const cy = y + rowN * (cardH + gap);
      doc.roundedRect(cx, cy, cardW, cardH, 5).fillAndStroke('#ffffff', C.line);
      doc.rect(cx, cy + 6, 3, cardH - 12).fill(C.teal);
      doc
        .fillColor(C.muted)
        .font('Helvetica-Bold')
        .fontSize(6.8)
        .text(String(s.label).toUpperCase(), cx + 12, cy + 8, { width: cardW - 20, lineBreak: false, ellipsis: true });
      const valText = s.money
        ? fmtMoney(s.value)
        : Number.isFinite(Number(s.value)) && s.value !== '' && typeof s.value !== 'string'
          ? Number(s.value).toLocaleString('en-US')
          : String(s.value ?? '—');
      doc
        .fillColor(C.ink)
        .font('Helvetica-Bold')
        .fontSize(12)
        .text(valText, cx + 12, cy + 22, { width: cardW - 20, lineBreak: false, ellipsis: true });
    });
    const rowsUsed = Math.ceil(items.length / perRow);
    y += rowsUsed * (cardH + gap) + 6;
  }

  // ── Table ──
  const headerH = 24;
  const drawHeader = (yy) => {
    doc.rect(margin, yy, pageW, headerH).fill(C.tealSoft);
    doc.moveTo(margin, yy + headerH).lineTo(margin + pageW, yy + headerH).lineWidth(1.2).strokeColor(C.teal).stroke();
    let x = margin;
    report.columns.forEach((c, i) => {
      doc
        .fillColor(C.teal)
        .font('Helvetica-Bold')
        .fontSize(8)
        .text(c.label.toUpperCase(), x + cellPad, yy + 8, {
          width: widths[i] - cellPad * 2,
          align: c.type ? 'right' : 'left',
          lineBreak: false,
          ellipsis: true,
        });
      x += widths[i];
    });
    return yy + headerH;
  };

  y = drawHeader(y);

  if (!report.rows.length) {
    doc.rect(margin, y, pageW, 34).fill(C.zebra);
    doc
      .fillColor(C.muted)
      .font('Helvetica-Oblique')
      .fontSize(9)
      .text('No records found for the selected period.', margin, y + 12, { width: pageW, align: 'center', lineBreak: false });
    y += 34;
  } else {
    report.rows.forEach((r, rowIdx) => {
      // Row height from the tallest wrapped cell (max 3 lines).
      doc.font('Helvetica').fontSize(baseSize);
      const lineH = doc.currentLineHeight(true);
      let lines = 1;
      report.columns.forEach((c, i) => {
        if (c.type) return;
        const h = doc.heightOfString(textOf(c, r), { width: widths[i] - cellPad * 2 });
        lines = Math.max(lines, Math.min(3, Math.round(h / lineH)));
      });
      const rowH = lines * lineH + 10;

      if (y + rowH > bottomLimit) {
        doc.addPage();
        y = drawHeader(margin);
      }
      doc.rect(margin, y, pageW, rowH).fill(rowIdx % 2 === 0 ? '#ffffff' : C.zebra);
      doc.moveTo(margin, y + rowH).lineTo(margin + pageW, y + rowH).lineWidth(0.5).strokeColor(C.line).stroke();

      let x = margin;
      report.columns.forEach((c, i) => {
        const bold = ['total', 'balance', 'invoiceNumber', 'receiptNumber'].includes(c.key);
        doc
          .fillColor(C.text)
          .font(bold ? 'Helvetica-Bold' : 'Helvetica')
          .fontSize(baseSize)
          .text(textOf(c, r), x + cellPad, y + 5, {
            width: widths[i] - cellPad * 2,
            height: lines * lineH,
            align: c.type ? 'right' : 'left',
            ellipsis: true,
            lineBreak: !c.type,
          });
        x += widths[i];
      });
      y += rowH;
    });
  }

  doc.moveTo(margin, y).lineTo(margin + pageW, y).lineWidth(1).strokeColor(C.teal).stroke();
  doc
    .fillColor(C.muted)
    .font('Helvetica')
    .fontSize(8)
    .text(`${report.rows.length} record${report.rows.length === 1 ? '' : 's'}`, margin, y + 6, {
      width: pageW,
      align: 'right',
      lineBreak: false,
    });

  // ── Footer on every page ──
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const fy = pageH - 34;
    doc.moveTo(margin, fy - 6).lineTo(margin + pageW, fy - 6).lineWidth(0.5).strokeColor(C.line).stroke();
    doc
      .fillColor(C.muted)
      .font('Helvetica')
      .fontSize(7.5)
      .text(`${clinic.name}  ·  Official verified report`, margin, fy, { width: pageW * 0.36, lineBreak: false, ellipsis: true });
    doc
      .fillColor(C.muted)
      .text('Authorised signature: ______________________', margin + pageW * 0.38, fy, {
        width: pageW * 0.42,
        align: 'center',
        lineBreak: false,
      });
    doc
      .fillColor(C.text)
      .font('Helvetica-Bold')
      .text(`Page ${i + 1} of ${range.count}`, margin + pageW - 90, fy, { width: 90, align: 'right', lineBreak: false });
  }

  doc.end();
}
