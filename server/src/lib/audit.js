import { prisma } from '../db.js';

/**
 * Writes an immutable audit entry. Accepts a transaction client so the audit
 * entry is committed atomically with the change it describes.
 */
export async function audit(req, action, entity, entityId, details, tx = prisma) {
  await tx.auditLog.create({
    data: {
      userId: req?.user?.id ?? null,
      action,
      entity,
      entityId: entityId != null ? String(entityId) : null,
      details: details ?? undefined,
      ip: req?.ip ?? null,
    },
  });
}

/** Return only changed fields between two objects (for audit "before/after"). */
export function diff(before, after) {
  const changes = {};
  for (const k of Object.keys(after)) {
    const a = before?.[k];
    const b = after[k];
    const norm = (v) => (v instanceof Date ? v.toISOString() : v ?? null);
    if (JSON.stringify(norm(a)) !== JSON.stringify(norm(b))) changes[k] = { from: norm(a), to: norm(b) };
  }
  return changes;
}

