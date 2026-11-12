import { z } from 'zod';
import { badRequest } from './errors.js';

/** Parse with a zod schema; throw 400 with field errors on failure. */
export function parse(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) {
    const fields = {};
    for (const issue of r.error.issues) {
      const key = issue.path.join('.') || '_';
      if (!fields[key]) fields[key] = issue.message;
    }
    throw badRequest('Validation failed', fields);
  }
  return r.data;
}

const emptyToUndef = (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

export const optStr = (max = 2000) =>
  z.preprocess(emptyToUndef, z.string().trim().max(max).optional().nullable());
export const reqStr = (max = 200) => z.string({ required_error: 'Required' }).trim().min(1, 'Required').max(max);
export const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
export const optDateStr = z.preprocess(emptyToUndef, dateStr.optional().nullable());
export const money = z.coerce.number().int('Whole shillings only').min(0);
export const posInt = z.coerce.number().int().positive();
export const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ]{9,15}$/, 'Invalid phone number')
  .transform(normalizePhone);
export const optPhone = z.preprocess(emptyToUndef, phone.optional().nullable());

/** Normalise Tanzanian numbers to +255XXXXXXXXX so duplicates can be detected. */
export function normalizePhone(p) {
  let s = String(p).replace(/[^0-9+]/g, '');
  if (s.startsWith('+')) return s;
  if (s.startsWith('255')) return `+${s}`;
  if (s.startsWith('0') && s.length === 10) return `+255${s.slice(1)}`;
  if (s.length === 9) return `+255${s}`;
  return s;
}

export const pagination = (q) => {
  const page = Math.max(1, Number(q.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 25));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
};

export const idParam = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw badRequest('Invalid id');
  return n;
};

