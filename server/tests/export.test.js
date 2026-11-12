import { describe, it, expect, vi } from 'vitest';
import ExcelJS from 'exceljs';

// The renderers are pure; only sendReport touches the DB/config, so mock those two.
vi.mock('../src/db.js', () => ({ prisma: { setting: { findUnique: async () => null } } }));
vi.mock('../src/config.js', () => ({ config: { clinicName: 'Test Clinic', tzOffsetMinutes: 180 } }));

const { sendReport } = await import('../src/lib/export.js');
const { renderPdf } = await import('../src/lib/reporting/pdf.js');
const { renderXlsx } = await import('../src/lib/reporting/xlsx.js');
const { buildMeta, computeTotals, fmtCell, badgeFor } = await import('../src/lib/reporting/common.js');

const clinic = { name: 'Test Clinic', address: '1 Test Rd, Dar es Salaam', phone: '+255 000', tin: '000-000-000' };
const user = { fullName: 'Neema Mushi', role: 'MANAGER' };

const makeReport = (n = 10) => ({
  title: 'Outstanding Payments Report',
  subtitle: 'As at 2026-11-12',
  columns: [
    { key: 'invoiceNumber', label: 'Invoice' },
    { key: 'date', label: 'Date' },
    { key: 'status', label: 'Status' },
    { key: 'qty', label: 'Qty', type: 'number' }, // not summable -> no `sum`
    { key: 'total', label: 'Total', type: 'money', sum: true },
  ],
  rows: Array.from({ length: n }, (_, i) => ({
    invoiceNumber: `INV-${i}`,
    date: '2026-11-01',
    status: i % 2 ? 'PARTIALLY_PAID' : 'UNPAID',
    qty: 3,
    total: 1000 * (i + 1),
  })),
  summary: [
    { label: 'Invoices with balance', value: n },
    { label: 'Total outstanding', value: 1000 * ((n * (n + 1)) / 2), money: true },
  ],
});

const fakeRes = () => {
  const res = { headers: {}, req: { user }, body: null, jsonBody: null };
  res.setHeader = (k, v) => (res.headers[k] = v);
  res.end = (b) => (res.body = b);
  res.json = (b) => (res.jsonBody = b);
  return res;
};

describe('reporting/common', () => {
  it('totals only columns flagged sum:true', () => {
    expect(computeTotals(makeReport(4))).toEqual({ total: 10000 });
    expect(computeTotals({ ...makeReport(4), rows: [] })).toBeNull();
  });

  it('formats values without mojibake', () => {
    const col = { key: 'x', label: 'X' };
    expect(fmtCell(col, '')).toBe('\u2014');
    expect(fmtCell({ key: 'm', type: 'money' }, -5000)).toBe('-TSh 5,000');
    expect(fmtCell({ key: 'status' }, 'PARTIALLY_PAID')).toBe('Partially paid');
  });

  it('colours statuses, flags and aging buckets', () => {
    expect(badgeFor({ key: 'status' }, 'VOIDED')?.fg).toBeTruthy();
    expect(badgeFor({ key: 'age' }, '90+ days')).toBeTruthy();
    expect(badgeFor({ key: 'age' }, '0-7 days')).toBeNull();
    expect(badgeFor({ key: 'age', type: 'number' }, 40)).toBeNull();
  });

  it('builds a reference in clinic-local time', () => {
    const m = buildMeta({ report: makeReport(2), user, tzOffsetMinutes: 180, now: new Date('2026-11-12T22:30:05Z') });
    expect(m.ref).toBe('MF-RPT-20261113-013005'); // 22:30Z is already 13 Nov in EAT
    expect(m.generated).toBe('13 Nov 2026, 01:30 EAT');
    expect(m.role).toBe('Manager');
  });
});

describe('PDF renderer', () => {
  const meta = buildMeta({ report: makeReport(), user });

  it('produces a valid single-page PDF', async () => {
    const buf = await renderPdf(makeReport(5), meta, clinic);
    expect(buf.slice(0, 5).toString()).toBe('%PDF-');
    expect(buf.slice(-8).toString()).toContain('%%EOF');
  });

  it('paginates long reports without blank pages', async () => {
    const buf = await renderPdf(makeReport(250), meta, clinic);
    const pages = (buf.toString('latin1').match(/\/Type \/Page(?!s)/g) || []).length;
    expect(pages).toBeGreaterThan(3);
    expect(pages).toBeLessThan(15); // ~25 rows/page; blank-page bugs would inflate this
  });

  it('handles an empty report', async () => {
    const buf = await renderPdf({ ...makeReport(), rows: [], summary: undefined }, meta, clinic);
    expect(buf.slice(0, 5).toString()).toBe('%PDF-');
  });
});

describe('Excel renderer', () => {
  const report = makeReport(12);
  const meta = buildMeta({ report, user });

  it('builds Summary + Data sheets with frozen header, filter and live totals', async () => {
    const buf = await renderXlsx(report, meta, clinic);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);

    expect(wb.worksheets.map((w) => w.name)).toEqual(['Summary', 'Data']);
    const ws = wb.getWorksheet('Data');
    expect(ws.views[0].state).toBe('frozen');
    expect(ws.views[0].ySplit).toBe(4);
    expect(ws.autoFilter).toBeTruthy();

    // dates are real dates, money is numeric, enums are humanised
    expect(ws.getCell('B5').value).toBeInstanceOf(Date);
    expect(ws.getCell('E5').value).toBe(1000);
    expect(ws.getCell('C5').value).toBe('Unpaid');

    // totals row: SUBTOTAL formula (respects filters) with a cached result; non-sum columns stay empty
    const totalRow = ws.getRow(5 + report.rows.length);
    expect(totalRow.getCell(1).value).toBe('TOTAL');
    expect(totalRow.getCell(5).value.formula).toBe(`SUBTOTAL(109,E5:E${4 + report.rows.length})`);
    expect(totalRow.getCell(5).value.result).toBe(78000);
    expect(totalRow.getCell(4).value).toBeNull();
  });

  it('never contains double-encoded characters', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await renderXlsx(report, meta, clinic));
    wb.eachSheet((sheet) => {
      sheet.eachRow((row) =>
        row.eachCell((cell) => {
          const v = typeof cell.value === 'string' ? cell.value : '';
          expect(v).not.toMatch(/\u00e2\u20ac|\u00c2/);
        }),
      );
      expect(JSON.stringify(sheet.headerFooter)).not.toMatch(/\u00c2/);
    });
  });
});

describe('sendReport', () => {
  it('sends a complete PDF with download headers', async () => {
    const res = fakeRes();
    await sendReport(res, 'pdf', makeReport(8));
    expect(res.headers['Content-Type']).toBe('application/pdf');
    expect(res.headers['Content-Disposition']).toMatch(/^attachment; filename="outstanding_payments_report_\d{4}-\d{2}-\d{2}\.pdf"$/);
    expect(res.headers['Cache-Control']).toBe('no-store');
    expect(res.headers['Content-Length']).toBe(res.body.length);
    expect(res.body.slice(0, 5).toString()).toBe('%PDF-');
  });

  it('sends a complete XLSX', async () => {
    const res = fakeRes();
    await sendReport(res, 'xlsx', makeReport(8));
    expect(res.headers['Content-Type']).toContain('spreadsheetml.sheet');
    expect(res.body.slice(0, 2).toString()).toBe('PK');
  });

  it('falls back to JSON for other formats', async () => {
    const res = fakeRes();
    const report = makeReport(2);
    await sendReport(res, 'json', report);
    expect(res.jsonBody).toBe(report);
    expect(res.body).toBeNull();
  });
});
