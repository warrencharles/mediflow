import { config } from '../config.js';

const OFFSET_MS = () => config.tzOffsetMinutes * 60 * 1000;

/** YYYY-MM-DD of the given instant in clinic local time. */
export function localDateStr(d = new Date()) {
  return new Date(d.getTime() + OFFSET_MS()).toISOString().slice(0, 10);
}

/** UTC instant of local midnight at the start of the given YYYY-MM-DD. */
export function localDayStart(dateStr) {
  return new Date(new Date(`${dateStr}T00:00:00.000Z`).getTime() - OFFSET_MS());
}

/** [start, end) UTC instants covering local days from..to (inclusive). */
export function localRange(from, to) {
  const start = localDayStart(from);
  const end = new Date(localDayStart(to || from).getTime() + 24 * 3600 * 1000);
  return { start, end };
}

/** Local weekday (0 = Sunday) and HH:MM for an instant. */
export function localParts(d) {
  const shifted = new Date(d.getTime() + OFFSET_MS());
  return {
    weekday: shifted.getUTCDay(),
    hhmm: shifted.toISOString().slice(11, 16),
    date: shifted.toISOString().slice(0, 10),
  };
}

/** Build an instant from local date + HH:MM. */
export function localDateTime(dateStr, hhmm) {
  return new Date(new Date(`${dateStr}T${hhmm}:00.000Z`).getTime() - OFFSET_MS());
}

export function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const isDateStr = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

