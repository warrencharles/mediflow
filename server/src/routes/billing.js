import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { ah, badRequest, conflict, notFound } from '../lib/errors.js';
import { parse, reqStr, optStr, money, posInt, idParam, pagination } from '../lib/validate.js';
import { audit } from '../lib/audit.js';
import { nextNumber } from '../lib/counters.js';
import { localRange, isDateStr } from '../lib/time.js';
import { notify } from '../lib/notify.js';
import { recalcInvoice, addInvoiceItem } from '../lib/billing.js';
import { requirePerm } from '../middleware/auth.js';
import { sendPaymentConfirmation } from '../lib/sms.js';

const r = Router();

export const PAYMENT_METHODS = ['CASH', 'MPESA', 'TIGO_PESA', 'AIRTEL_MONEY', 'BANK_TRANSFER'];

const patientSel = { select: { id: true, patientNumber: true, firstName: true, lastName: true, phone: true } };
const invoiceInclude = {
  patient: patientSel,
  visit: { select: { id: true, visitNumber: true, queueDate: true } },
  items: { orderBy: { id: 'asc' }, include: { createdBy: { select: { fullName: true } } } },
  payments: { orderBy: { paidAt: 'asc' }, include: { receivedBy: { select: { fullName: true } }, voidedBy: { select: { fullName: true } } } },
  discounts: { orderBy: { createdAt: 'asc' }, include: { requestedBy: { select: { fullName: true } }, decidedBy: { select: { fullName: true } } } },
  createdBy: { select: { fullName: true } },
  cancelledBy: { select: { fullName: true } },
};

// ── Services price list ──

r.get('/services', requirePerm('billing.view', 'queue.checkin', 'services.manage'), ah(async (req, res) => {
  const where = req.query.active === 'all' ? {} : { isActive: true };
  res.json(await prisma.service.findMany({ where, orderBy: [{ category: 'asc' }, { name: 'asc' }] }));
}));

const serviceBody = z.object({
  code: reqStr(20).transform((s) => s.toUpperCase()),
  name: reqStr(120),
  category: z.enum(['CONSULTATION', 'PROCEDURE', 'OTHER']),
  price: money,
  isActive: z.boolean().optional(),
});
r.post('/services', requirePerm('services.manage'), ah(async (req, res) => {
  const d = parse(serviceBody, req.body);
  if (await prisma.service.findUnique({ where: { code: d.code } })) throw conflict('Service code already exists');
  const s = await prisma.service.create({ data: d });
  await audit(req, 'SERVICE_CREATED', 'Service', s.id, d);
  res.status(201).json(s);
}));
r.put('/services/:id', requirePerm('services.manage'), ah(async (req, res) => {
  const id = idParam(req.params.id);
  const d = parse(serviceBody, req.body);
  const before = await prisma.service.findUnique({ where: { id } });
  if (!before) throw notFound('Service not found');
  const s = await prisma.service.update({ where: { id }, data: d });
  await audit(req, 'SERVICE_UPDATED', 'Service', id, { before: { price: before.price, name: before.name, isActive: before.isActive }, after: d });
  res.json(s);
}));
r.delete('/services/:id', requirePerm('services.manage'), ah(async (req, res) => {
  const id = idParam(req.params.id);
  const s = await prisma.service.findUnique({ where: { id } });
  if (!s) throw notFound('Service not found');
  const used = await prisma.invoiceItem.count({ where: { sourceType: 'Service', sourceId: id } });
  if (used > 0) {
    throw conflict(`Service "${s.name}" (${s.code}) has been billed on ${used} invoice line(s) and cannot be deleted. Edit the service and uncheck Active instead.`);
  }
  await prisma.service.delete({ where: { id } });
  await audit(req, 'SERVICE_DELETED', 'Service', id, { code: s.code, name: s.name });
  res.json({ deleted: id });
}));

// ── Invoices ──

r.get(
  '/invoices',
  requirePerm('billing.view'),
  ah(async (req, res) => {
    const { skip, take, page, pageSize } = pagination(req.query);
    const where = {};
    const status = String(req.query.status || '');
    if (status === 'OUTSTANDING') where.status = { in: ['UNPAID', 'PARTIALLY_PAID'] };
    else if (status) where.status = status;
    if (req.query.patientId) where.patientId = Number(req.query.patientId);
    if (isDateStr(req.query.from)) {
      const { start, end } = localRange(req.query.from, isDateStr(req.query.to) ? req.query.to : req.query.from);
      where.createdAt = { gte: start, lt: end };
    }
    if (req.query.q) {
      const q = String(req.query.q);
      where.OR = [
        { invoiceNumber: { contains: q, mode: 'insensitive' } },
        { patient: { OR: [{ firstName: { contains: q, mode: 'insensitive' } }, { lastName: { contains: q, mode: 'insensitive' } }, { patientNumber: { contains: q, mode: 'insensitive' } }, { phone: { contains: q } }] } },
      ];
    }
    const [items, total, sums] = await Promise.all([
      prisma.invoice.findMany({ where, skip, take, orderBy: { createdAt: 'desc' }, include: { patient: patientSel } }),
      prisma.invoice.count({ where }),
      prisma.invoice.aggregate({ where: { ...where, status: where.status ?? { not: 'CANCELLED' } }, _sum: { total: true, amountPaid: true, balance: true } }),
    ]);
    res.json({ items, total, page, pageSize, totals: { total: sums._sum.total || 0, paid: sums._sum.amountPaid || 0, balance: sums._sum.balance || 0 } });
  }),
);

r.post(
  '/invoices',
  requirePerm('billing.write'),
  ah(async (req, res) => {
    const d = parse(
      z.object({
        patientId: posInt,
        visitId: posInt.optional().nullable(),
        notes: optStr(500),
        items: z
          .array(
            z.object({
              type: z.enum(['CONSULTATION', 'LAB', 'MEDICINE', 'SERVICE', 'OTHER']),
              serviceId: posInt.optional().nullable(),
              description: optStr(200),
              quantity: z.coerce.number().int().min(1).default(1),
              unitPrice: money.optional(),
            }),
          )
          .default([]),
      }),
      req.body,
    );
    const patient = await prisma.patient.findUnique({ where: { id: d.patientId } });
    if (!patient) throw notFound('Patient not found');
    const inv = await prisma.$transaction(async (tx) => {
      const invoiceNumber = await nextNumber('INV', tx);
      const i = await tx.invoice.create({ data: { invoiceNumber, patientId: d.patientId, visitId: d.visitId ?? null, notes: d.notes ?? null, createdById: req.user.id } });
      for (const it of d.items) await addInvoiceItem(i.id, await resolveItem(tx, it), req.user.id, tx);
      await audit(req, 'INVOICE_CREATED', 'Invoice', i.id, { invoiceNumber, items: d.items }, tx);
      return i;
    });
    res.status(201).json(await prisma.invoice.findUnique({ where: { id: inv.id }, include: invoiceInclude }));
  }),
);

async function resolveItem(tx, it) {
  if (it.serviceId) {
    const s = await tx.service.findUnique({ where: { id: it.serviceId } });
    if (!s || !s.isActive) throw badRequest('Service not found');
    return { type: s.category === 'CONSULTATION' ? 'CONSULTATION' : 'SERVICE', description: s.name, quantity: it.quantity, unitPrice: s.price, sourceType: 'Service', sourceId: s.id };
  }
  if (!it.description || it.unitPrice == null) throw badRequest('Validation failed', { description: 'Description and price are required for custom charges' });
  return { type: it.type, description: it.description, quantity: it.quantity, unitPrice: it.unitPrice, sourceType: 'Manual' };
}

r.get(
  '/invoices/:id',
  requirePerm('billing.view'),
  ah(async (req, res) => {
    const inv = await prisma.invoice.findUnique({ where: { id: idParam(req.params.id) }, include: invoiceInclude });
    if (!inv) throw notFound('Invoice not found');
    res.json(inv);
  }),
);

const assertOpen = (inv) => {
  if (!inv) throw notFound('Invoice not found');
  if (inv.status === 'CANCELLED') throw badRequest('This invoice has been cancelled');
};

r.post(
  '/invoices/:id/items',
  requirePerm('billing.write'),
  ah(async (req, res) => {
    const id = idParam(req.params.id);
    const it = parse(
      z.object({
        type: z.enum(['CONSULTATION', 'LAB', 'MEDICINE', 'SERVICE', 'OTHER']).default('SERVICE'),
        serviceId: posInt.optional().nullable(),
        description: optStr(200),
        quantity: z.coerce.number().int().min(1).default(1),
        unitPrice: money.optional(),
      }),
      req.body,
    );
    await prisma.$transaction(async (tx) => {
      assertOpen(await tx.invoice.findUnique({ where: { id } }));
      const item = await resolveItem(tx, it);
      await addInvoiceItem(id, item, req.user.id, tx);
      await audit(req, 'INVOICE_ITEM_ADDED', 'Invoice', id, item, tx);
    });
    res.status(201).json(await prisma.invoice.findUnique({ where: { id }, include: invoiceInclude }));
  }),
);

/** Remove a charge – it is voided (kept for audit), never deleted. Requires cancel authority. */
r.post(
  '/invoices/:id/items/:itemId/void',
  requirePerm('billing.cancel'),
  ah(async (req, res) => {
    const id = idParam(req.params.id);
    const itemId = idParam(req.params.itemId);
    const { reason } = parse(z.object({ reason: z.string().trim().min(3, 'Give a reason') }), req.body);
    await prisma.$transaction(async (tx) => {
      const inv = await tx.invoice.findUnique({ where: { id } });
      assertOpen(inv);
      const item = await tx.invoiceItem.findFirst({ where: { id: itemId, invoiceId: id } });
      if (!item || item.voided) throw notFound('Item not found');
      if (item.sourceType === 'Dispensation') throw badRequest('Dispensed medicine cannot be removed from the bill – the stock has already left the pharmacy');
      const remaining = inv.subtotal - item.lineTotal - inv.discountAmount;
      if (remaining < inv.amountPaid) throw badRequest('Removing this item would make payments exceed the invoice total. Void a payment first.');
      await tx.invoiceItem.update({ where: { id: itemId }, data: { voided: true, voidReason: reason } });
      await recalcInvoice(id, tx);
      await audit(req, 'INVOICE_ITEM_VOIDED', 'Invoice', id, { itemId, description: item.description, amount: item.lineTotal, reason }, tx);
    });
    res.json(await prisma.invoice.findUnique({ where: { id }, include: invoiceInclude }));
  }),
);

r.post(
  '/invoices/:id/items/:itemId/restore',
  requirePerm('billing.cancel'),
  ah(async (req, res) => {
    const id = idParam(req.params.id);
    const itemId = idParam(req.params.itemId);
    await prisma.$transaction(async (tx) => {
      const inv = await tx.invoice.findUnique({ where: { id } });
      assertOpen(inv);
      const item = await tx.invoiceItem.findFirst({ where: { id: itemId, invoiceId: id } });
      if (!item || !item.voided) throw notFound('Voided item not found');
      if (item.sourceType === 'Dispensation') {
        throw badRequest('Reversed medicine dispensations cannot be restored from the invoice – dispense the prescription again in Pharmacy.');
      }
      await tx.invoiceItem.update({ where: { id: itemId }, data: { voided: false, voidReason: null } });
      await recalcInvoice(id, tx);
      await audit(req, 'INVOICE_ITEM_RESTORED', 'Invoice', id, { itemId, description: item.description, amount: item.lineTotal }, tx);
    });
    res.json(await prisma.invoice.findUnique({ where: { id }, include: invoiceInclude }));
  }),
);

// ── Discounts: requested by accountant, authorised by manager ──

r.post(
  '/invoices/:id/discounts',
  requirePerm('billing.discount.request', 'billing.discount.approve'),
  ah(async (req, res) => {
    const id = idParam(req.params.id);
    const d = parse(z.object({ amount: money.refine((n) => n > 0, 'Must be greater than zero'), reason: z.string().trim().min(3, 'Give a reason').max(300) }), req.body);
    const inv = await prisma.invoice.findUnique({ where: { id } });
    assertOpen(inv);
    if (d.amount > inv.balance) throw badRequest('Validation failed', { amount: `Discount cannot exceed the outstanding balance (TSh ${inv.balance.toLocaleString()})` });
    const disc = await prisma.discount.create({ data: { invoiceId: id, amount: d.amount, reason: d.reason, requestedById: req.user.id } });
    await audit(req, 'DISCOUNT_REQUESTED', 'Invoice', id, { discountId: disc.id, ...d });
    await notify({ role: 'MANAGER', title: 'Discount approval needed', message: `TSh ${d.amount.toLocaleString()} on ${inv.invoiceNumber}: ${d.reason}`, link: `/billing/invoices/${id}` });
    res.status(201).json(await prisma.invoice.findUnique({ where: { id }, include: invoiceInclude }));
  }),
);

r.get(
  '/discounts',
  requirePerm('billing.view'),
  ah(async (req, res) => {
    const where = req.query.status ? { status: String(req.query.status) } : { status: 'PENDING' };
    res.json(
      await prisma.discount.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: { invoice: { include: { patient: patientSel } }, requestedBy: { select: { fullName: true } }, decidedBy: { select: { fullName: true } } },
      }),
    );
  }),
);

r.post(
  '/discounts/:id/decide',
  requirePerm('billing.discount.approve'),
  ah(async (req, res) => {
    const id = idParam(req.params.id);
    const d = parse(z.object({ approve: z.boolean(), note: optStr(300) }), req.body);
    const out = await prisma.$transaction(async (tx) => {
      const disc = await tx.discount.findUnique({ where: { id }, include: { invoice: true } });
      if (!disc) throw notFound('Discount not found');
      if (disc.status !== 'PENDING') throw badRequest('This discount has already been decided');
      if (disc.requestedById === req.user.id && req.user.role !== 'SUPER_ADMIN') throw badRequest('You cannot authorise a discount you requested');
      assertOpen(disc.invoice);
      if (d.approve && disc.amount > disc.invoice.balance) throw badRequest('Discount now exceeds the outstanding balance');
      await tx.discount.update({ where: { id }, data: { status: d.approve ? 'APPROVED' : 'REJECTED', decidedById: req.user.id, decidedAt: new Date(), decisionNote: d.note ?? null } });
      await recalcInvoice(disc.invoiceId, tx);
      await audit(req, d.approve ? 'DISCOUNT_APPROVED' : 'DISCOUNT_REJECTED', 'Invoice', disc.invoiceId, { discountId: id, amount: disc.amount, note: d.note }, tx);
      await notify({ userId: disc.requestedById, title: `Discount ${d.approve ? 'approved' : 'rejected'}`, message: `${disc.invoice.invoiceNumber}: TSh ${disc.amount.toLocaleString()}`, link: `/billing/invoices/${disc.invoiceId}` }, tx);
      return tx.invoice.findUnique({ where: { id: disc.invoiceId }, include: invoiceInclude });
    });
    res.json(out);
  }),
);

r.post(
  '/discounts/:id/revoke',
  requirePerm('billing.discount.approve'),
  ah(async (req, res) => {
    const id = idParam(req.params.id);
    const { reason } = parse(z.object({ reason: optStr(300) }), req.body || {});
    const out = await prisma.$transaction(async (tx) => {
      const disc = await tx.discount.findUnique({ where: { id }, include: { invoice: true } });
      if (!disc) throw notFound('Discount not found');
      assertOpen(disc.invoice);
      await tx.discount.update({
        where: { id },
        data: { status: 'REJECTED', decidedById: req.user.id, decidedAt: new Date(), decisionNote: reason || 'Discount revoked' },
      });
      await recalcInvoice(disc.invoiceId, tx);
      await audit(req, 'DISCOUNT_REVOKED', 'Invoice', disc.invoiceId, { discountId: id, amount: disc.amount, reason }, tx);
      return tx.invoice.findUnique({ where: { id: disc.invoiceId }, include: invoiceInclude });
    });
    res.json(out);
  }),
);

// ── Payments (money actually received – separate from the invoice) ──

r.post(
  '/invoices/:id/payments',
  requirePerm('billing.write'),
  ah(async (req, res) => {
    const id = idParam(req.params.id);
    const d = parse(
      z
        .object({
          amount: money.refine((n) => n > 0, 'Amount must be greater than zero'),
          method: z.enum(PAYMENT_METHODS),
          reference: optStr(100),
          notes: optStr(300),
        })
        .refine((p) => p.method === 'CASH' || !!p.reference, { message: 'Transaction reference is required for mobile money and bank payments', path: ['reference'] }),
      req.body,
    );
    const payment = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM "Invoice" WHERE id = ${id} FOR UPDATE`;
      const inv = await tx.invoice.findUnique({ where: { id } });
      assertOpen(inv);
      if (inv.balance <= 0) throw badRequest('This invoice is already fully paid');
      if (d.amount > inv.balance) throw badRequest('Validation failed', { amount: `Amount exceeds the outstanding balance of TSh ${inv.balance.toLocaleString()}` });
      if (d.reference) {
        const dup = await tx.payment.findFirst({ where: { method: d.method, reference: d.reference, status: 'VALID' } });
        if (dup) throw conflict(`Reference ${d.reference} has already been used for receipt ${dup.receiptNumber}`);
      }
      const receiptNumber = await nextNumber('RCT', tx);
      const p = await tx.payment.create({
        data: { receiptNumber, invoiceId: id, patientId: inv.patientId, amount: d.amount, method: d.method, reference: d.reference ?? null, notes: d.notes ?? null, receivedById: req.user.id },
      });
      const after = await recalcInvoice(id, tx);
      await audit(req, 'PAYMENT_RECEIVED', 'Invoice', id, { receiptNumber, amount: d.amount, method: d.method, reference: d.reference, balanceAfter: after.balance }, tx);
      return { p, after, inv };
    });
    const invWithPatient = await prisma.invoice.findUnique({ where: { id }, include: invoiceInclude });
    sendPaymentConfirmation({ payment: payment.p, invoice: payment.after, patient: invWithPatient.patient }).catch((err) => console.error('[SMS payment confirmation failed]', err));
    res.status(201).json({ payment: payment.p, invoice: invWithPatient });
  }),
);

r.post(
  '/payments/:id/send-sms',
  requirePerm('billing.write'),
  ah(async (req, res) => {
    const id = idParam(req.params.id);
    const p = await prisma.payment.findUnique({ where: { id }, include: { invoice: true, patient: true } });
    if (!p) throw notFound('Payment not found');
    const sms = await sendPaymentConfirmation({ payment: p, invoice: p.invoice, patient: p.patient });
    await audit(req, 'PAYMENT_CONFIRMATION_SMS_SENT', 'Payment', id, { receiptNumber: p.receiptNumber, phone: p.patient?.phone });
    res.json({ success: true, sms });
  }),
);

r.post(
  '/payments/:id/void',
  requirePerm('billing.cancel'),
  ah(async (req, res) => {
    const id = idParam(req.params.id);
    const { reason } = parse(z.object({ reason: z.string().trim().min(5, 'Give a clear reason (min 5 characters)') }), req.body);
    const inv = await prisma.$transaction(async (tx) => {
      const p = await tx.payment.findUnique({ where: { id } });
      if (!p) throw notFound('Payment not found');
      if (p.status === 'VOIDED') throw badRequest('Payment already voided');
      await tx.payment.update({ where: { id }, data: { status: 'VOIDED', voidedById: req.user.id, voidedAt: new Date(), voidReason: reason } });
      await recalcInvoice(p.invoiceId, tx);
      await audit(req, 'PAYMENT_VOIDED', 'Invoice', p.invoiceId, { paymentId: id, receiptNumber: p.receiptNumber, amount: p.amount, reason }, tx);
      return tx.invoice.findUnique({ where: { id: p.invoiceId }, include: invoiceInclude });
    });
    res.json(inv);
  }),
);

r.post(
  '/invoices/:id/cancel',
  requirePerm('billing.cancel'),
  ah(async (req, res) => {
    const id = idParam(req.params.id);
    const { reason } = parse(z.object({ reason: z.string().trim().min(5, 'Give a clear reason (min 5 characters)') }), req.body);
    const out = await prisma.$transaction(async (tx) => {
      const inv = await tx.invoice.findUnique({ where: { id }, include: { payments: true, items: true } });
      assertOpen(inv);
      if (inv.payments.some((p) => p.status === 'VALID')) throw badRequest('This invoice has payments. Void the payments first, then cancel the invoice.');
      if (inv.items.some((i) => !i.voided && i.sourceType === 'Dispensation')) throw badRequest('This invoice contains dispensed medicine and cannot be cancelled');
      await tx.invoice.update({ where: { id }, data: { status: 'CANCELLED', cancelledById: req.user.id, cancelledAt: new Date(), cancelReason: reason } });
      await audit(req, 'INVOICE_CANCELLED', 'Invoice', id, { invoiceNumber: inv.invoiceNumber, total: inv.total, reason }, tx);
      return tx.invoice.findUnique({ where: { id }, include: invoiceInclude });
    });
    res.json(out);
  }),
);

r.post(
  '/invoices/:id/reopen',
  requirePerm('billing.cancel'),
  ah(async (req, res) => {
    const id = idParam(req.params.id);
    const { reason } = parse(z.object({ reason: optStr(300) }), req.body || {});
    const out = await prisma.$transaction(async (tx) => {
      const inv = await tx.invoice.findUnique({ where: { id } });
      if (!inv) throw notFound('Invoice not found');
      if (inv.status !== 'CANCELLED') throw badRequest('Invoice is not cancelled');
      await tx.invoice.update({
        where: { id },
        data: { status: 'UNPAID', cancelledById: null, cancelledAt: null, cancelReason: null },
      });
      await recalcInvoice(id, tx);
      await audit(req, 'INVOICE_REOPENED', 'Invoice', id, { invoiceNumber: inv.invoiceNumber, reason }, tx);
      return tx.invoice.findUnique({ where: { id }, include: invoiceInclude });
    });
    res.json(out);
  }),
);

r.get(
  '/payments',
  requirePerm('billing.view'),
  ah(async (req, res) => {
    const { skip, take, page, pageSize } = pagination(req.query);
    const where = {};
    if (isDateStr(req.query.from)) {
      const { start, end } = localRange(req.query.from, isDateStr(req.query.to) ? req.query.to : req.query.from);
      where.paidAt = { gte: start, lt: end };
    }
    if (req.query.method) where.method = String(req.query.method);
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.patientId) where.patientId = Number(req.query.patientId);
    const [items, total, sum] = await Promise.all([
      prisma.payment.findMany({
        where,
        skip,
        take,
        orderBy: { paidAt: 'desc' },
        include: { patient: patientSel, invoice: { select: { id: true, invoiceNumber: true } }, receivedBy: { select: { fullName: true } } },
      }),
      prisma.payment.count({ where }),
      prisma.payment.aggregate({ where: { ...where, status: 'VALID' }, _sum: { amount: true } }),
    ]);
    res.json({ items, total, page, pageSize, totalReceived: sum._sum.amount || 0 });
  }),
);

r.get(
  '/payments/:id/receipt',
  requirePerm('billing.view'),
  ah(async (req, res) => {
    const p = await prisma.payment.findUnique({
      where: { id: idParam(req.params.id) },
      include: { patient: patientSel, receivedBy: { select: { fullName: true } }, invoice: { include: { items: { where: { voided: false } } } } },
    });
    if (!p) throw notFound('Payment not found');
    res.json(p);
  }),
);

export default r;

