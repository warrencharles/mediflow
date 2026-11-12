/**
 * Shared building blocks for the PDF and Excel report renderers:
 * brand palette, value formatting, report reference/metadata, status colours
 * and column totals. Pure functions only (no DB, no I/O) so they are easy to test.
 */

export const C = {
  ink: '#0f172a',
  text: '#1e293b',
  muted: '#64748b',
  faint: '#94a3b8',
  line: '#e2e8f0',
  teal: '#0f766e',
  tealMid: '#0d9488',
  tealSoft: '#ccfbf1',
  tealPale: '#f0fdfa',
  zebra: '#f8fafc',
  white: '#ffffff',
  red: '#b91c1c',
};

/** '#0f766e' -> 'FF0F766E' (ExcelJS ARGB). */
export const argb = (hex) => `FF${hex.slice(1).toUpperCase()}`;

// ── Value formatting ────────────────────────────────────────────────────────

export const DASH = '\u2014'; // em dash for empty cells
export const DOT = '\u00b7'; // middle dot separator

export const fmtMoney = (n) => {
  const v = Number(n || 0);
  return `${v < 0 ? '-' : ''}TSh ${Math.abs(v).toLocaleString('en-US')}`;
};
export const fmtNumber = (n) => Number(n || 0).toLocaleString('en-US');

/** Columns whose values are database enums (PARTIALLY_PAID -> "Partially paid"). */
const ENUM_KEYS = new Set(['status', 'type', 'gender']);

export function humanize(col, v) {
  const s = String(v);
  if (!ENUM_KEYS.has(col.key) || !/^[A-Z][A-Z_ ]*$/.test(s)) return s;
  const t = s.replace(/[_ ]+/g, ' ').toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function fmtCell(col, v) {
  if (v == null || v === '') return DASH;
  if (col.type === 'money') return fmtMoney(v);
  if (col.type === 'number') return Number.isFinite(Number(v)) ? fmtNumber(v) : String(v);
  if (v instanceof Date) return v.toISOString().replace('T', ' ').slice(0, 16);
  return humanize(col, v);
}

export function fmtSummaryValue(s) {
  if (s.money) return fmtMoney(s.value);
  if (typeof s.value === 'number' && Number.isFinite(s.value)) return fmtNumber(s.value);
  return s.value == null || s.value === '' ? DASH : String(s.value);
}

// ── Status colouring ────────────────────────────────────────────────────────

export const TONE = {
  good: { fg: '#047857', bg: '#d1fae5' },
  warn: { fg: '#b45309', bg: '#fef3c7' },
  bad: { fg: '#b91c1c', bg: '#fee2e2' },
  info: { fg: '#1d4ed8', bg: '#dbeafe' },
};

const STATUS_TONE = {
  VALID: 'good',
  PAID: 'good',
  COMPLETED: 'good',
  DISPENSED: 'good',
  ACTIVE: 'good',
  VOIDED: 'bad',
  CANCELLED: 'bad',
  REJECTED: 'bad',
  NO_SHOW: 'bad',
  UNPAID: 'warn',
  PENDING: 'warn',
  PARTIALLY_PAID: 'info',
  PARTIALLY_DISPENSED: 'info',
  IN_PROGRESS: 'info',
};

const BADGE_KEYS = new Set(['status', 'flags', 'age']);

/** Returns { fg, bg } for cells that should render as a coloured status pill, else null. */
export function badgeFor(col, raw) {
  if (col.type || !BADGE_KEYS.has(col.key) || raw == null || raw === '') return null;
  const s = String(raw).toUpperCase();
  if (col.key === 'age') {
    if (s.startsWith('90+')) return TONE.bad;
    if (s.startsWith('31-90')) return TONE.warn;
    return null;
  }
  if (col.key === 'flags') {
    if (s.includes('EXPIRED')) return TONE.bad;
    if (s.includes('LOW') || s.includes('EXPIRING')) return TONE.warn;
    return null;
  }
  const tone = STATUS_TONE[s.replace(/ /g, '_')];
  return tone ? TONE[tone] : null;
}

// ── Totals ──────────────────────────────────────────────────────────────────

/** Column totals for columns flagged `sum: true`; null when there is nothing to total. */
export function computeTotals(report) {
  const rows = report.rows || [];
  if (!rows.length) return null;
  const totals = {};
  for (const c of report.columns) {
    if (c.sum && (c.type === 'money' || c.type === 'number')) {
      totals[c.key] = rows.reduce((a, r) => a + (Number(r[c.key]) || 0), 0);
    }
  }
  return Object.keys(totals).length ? totals : null;
}

// ── Report metadata ─────────────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ROLE_LABEL = {
  SUPER_ADMIN: 'Super Admin',
  MANAGER: 'Manager',
  RECEPTIONIST: 'Receptionist',
  DOCTOR: 'Doctor',
  NURSE: 'Nurse',
  PHARMACIST: 'Pharmacist',
  ACCOUNTANT: 'Accountant',
  LAB_TECHNICIAN: 'Lab Technician',
};

/**
 * Document-level metadata shared by both formats so the PDF and the Excel file of
 * the same export carry an identical reference number, timestamp and author.
 */
export function buildMeta({ report, user, tzOffsetMinutes = 180, now = new Date() }) {
  const local = new Date(now.getTime() + tzOffsetMinutes * 60000);
  const iso = local.toISOString(); // shifted so the UTC fields read as local time
  const sign = tzOffsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(tzOffsetMinutes);
  const tz =
    tzOffsetMinutes === 180
      ? 'EAT'
      : `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
  const day = iso.slice(0, 10);
  const time = iso.slice(11, 16);
  return {
    ref: `MF-RPT-${day.replace(/-/g, '')}-${iso.slice(11, 19).replace(/:/g, '')}`,
    generatedAt: now,
    generated: `${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}, ${time} ${tz}`,
    dateTag: day,
    preparedBy: user?.fullName || 'System',
    role: ROLE_LABEL[user?.role] || (user?.role ? String(user.role) : 'Automated export'),
    records: (report.rows || []).length,
    currency: 'Tanzanian Shilling (TSh)',
    confidentiality:
      'Confidential \u2014 contains protected patient and financial information. For authorised use only.',
  };
}
