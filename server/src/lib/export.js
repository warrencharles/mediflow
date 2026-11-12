import { config } from '../config.js';
import { prisma } from '../db.js';
import { localDateStr } from './time.js';
import { buildMeta } from './reporting/common.js';
import { renderPdf } from './reporting/pdf.js';
import { renderXlsx } from './reporting/xlsx.js';

/**
 * Executive-grade PDF & Excel export used by every MediFlow report.
 *
 * report = {
 *   title,
 *   subtitle?,
 *   columns: [{ key, label, type?: 'money'|'number', sum?: boolean, width? }],
 *     - `type` right-aligns and formats the column; no type = text.
 *     - `sum: true` adds the column to the TOTAL row (live SUBTOTAL formula in Excel).
 *       Only set it where adding the rows together is meaningful.
 *   rows: [...],
 *   summary?: [{ label, value, money?: boolean }]   // first item is highlighted as the headline figure
 * }
 *
 * Files are fully built in memory before anything is sent, so a failure while
 * rendering returns a normal API error instead of a corrupt, half-written download.
 */
export async function sendReport(res, format, report) {
  if (format !== 'xlsx' && format !== 'pdf') return res.json(report);

  const clinicSetting = await prisma.setting.findUnique({ where: { key: 'clinic' } }).catch(() => null);
  const clinic = {
    name: clinicSetting?.value?.name || config.clinicName || 'MediFlow Healthcare Group',
    address: clinicSetting?.value?.address || 'Plot 42, Ali Hassan Mwinyi Road, Dar es Salaam, Tanzania',
    phone: clinicSetting?.value?.phone || '+255 22 266 4800',
    tin: clinicSetting?.value?.tin || '132-894-210',
  };

  const meta = buildMeta({ report, user: res.req?.user, tzOffsetMinutes: config.tzOffsetMinutes });
  const safe = report.title.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '').toLowerCase();
  const filename = `${safe}_${localDateStr()}.${format}`;

  const body = format === 'pdf' ? await renderPdf(report, meta, clinic) : await renderXlsx(report, meta, clinic);

  res.setHeader(
    'Content-Type',
    format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store'); // reports contain confidential patient/financial data
  res.setHeader('Content-Length', body.length);
  res.end(body);
}
