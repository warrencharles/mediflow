import { prisma } from '../db.js';
import { nextNumber } from './counters.js';

/**
 * Recalculates an invoice from its source records. Totals are never typed in
 * by hand – they are always derived from non-voided items, approved discounts
 * and valid payments, so balances stay correct.
 */
export async function recalcInvoice(invoiceId, tx = prisma) {
  const inv = await tx.invoice.findUnique({
    where: { id: invoiceId },
    include: { items: true, discounts: true, payments: true },
  });
  if (!inv) return null;
  const subtotal = inv.items.filter((i) => !i.voided).reduce((s, i) => s + i.lineTotal, 0);
  const discountAmount = Math.min(
    subtotal,
    inv.discounts.filter((d) => d.status === 'APPROVED').reduce((s, d) => s + d.amount, 0),
  );
  const total = subtotal - discountAmount;
  const amountPaid = inv.payments.filter((p) => p.status === 'VALID').reduce((s, p) => s + p.amount, 0);
  const balance = total - amountPaid;
  let status = inv.status;
  if (status !== 'CANCELLED') {
    if (subtotal === 0 && amountPaid === 0) status = 'UNPAID';
    else if (balance <= 0) status = 'PAID';
    else if (amountPaid > 0) status = 'PARTIALLY_PAID';
    else status = 'UNPAID';
  }
  return tx.invoice.update({
    where: { id: invoiceId },
    data: { subtotal, discountAmount, total, amountPaid, balance, status },
  });
}

/**
 * Returns the open invoice for a visit (creating it if needed). If there is no
 * visit (e.g. walk-in pharmacy), a new invoice is created for the patient.
 * A fully PAID visit invoice is reused – adding items simply re-opens a balance.
 */
export async function getOrCreateVisitInvoice({ patientId, visitId, userId }, tx = prisma) {
  if (visitId) {
    const existing = await tx.invoice.findFirst({
      where: { visitId, status: { not: 'CANCELLED' } },
      orderBy: { id: 'asc' },
    });
    if (existing) return existing;
  }
  const invoiceNumber = await nextNumber('INV', tx);
  return tx.invoice.create({
    data: { invoiceNumber, patientId, visitId: visitId ?? null, createdById: userId ?? null },
  });
}

export async function addInvoiceItem(invoiceId, item, userId, tx = prisma) {
  const quantity = item.quantity ?? 1;
  await tx.invoiceItem.create({
    data: {
      invoiceId,
      type: item.type,
      description: item.description,
      quantity,
      unitPrice: item.unitPrice,
      lineTotal: quantity * item.unitPrice,
      sourceType: item.sourceType ?? null,
      sourceId: item.sourceId ?? null,
      createdById: userId ?? null,
    },
  });
  return recalcInvoice(invoiceId, tx);
}

