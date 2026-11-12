import { prisma } from '../db.js';

/**
 * Atomically increments a named counter and returns the new value.
 * Safe under concurrency (single UPSERT statement). Accepts a transaction client.
 */
export async function nextValue(key, tx = prisma) {
  const rows = await tx.$queryRaw`
    INSERT INTO "Counter" ("key", "value") VALUES (${key}, 1)
    ON CONFLICT ("key") DO UPDATE SET "value" = "Counter"."value" + 1
    RETURNING "value"`;
  return Number(rows[0].value);
}

const pad = (n, w) => String(n).padStart(w, '0');

export async function nextNumber(prefix, tx = prisma, { yearly = true, width = 6 } = {}) {
  const year = new Date().getFullYear();
  const key = yearly ? `${prefix}-${year}` : prefix;
  const v = await nextValue(key, tx);
  return yearly ? `${prefix}-${year}-${pad(v, width)}` : `${prefix}-${pad(v, width)}`;
}

/** Patient numbers are permanent and never reused: MF-000001 */
export const nextPatientNumber = (tx) => nextNumber('MF', tx, { yearly: false, width: 6 });

