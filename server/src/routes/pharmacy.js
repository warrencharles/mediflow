import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { ah, badRequest, conflict, notFound } from '../lib/errors.js';
import { parse, reqStr, optStr, dateStr, money, posInt, idParam, pagination, optPhone } from '../lib/validate.js';
import { audit, diff } from '../lib/audit.js';
import { nextNumber } from '../lib/counters.js';
import { localDateStr, localDayStart, addDays, localRange, isDateStr } from '../lib/time.js';
import { getOrCreateVisitInvoice, addInvoiceItem, recalcInvoice } from '../lib/billing.js';
import { requirePerm } from '../middleware/auth.js';

const r = Router();

const EXPIRY_WARNING_DAYS = 90;
const todayStart = () => localDayStart(localDateStr());

/** Stock on hand = sum of remaining quantity in non-expired batches. */
async function stockMap(medicineIds) {
  const today = todayStart();
  const rows = await prisma.medicineBatch.groupBy({
    by: ['medicineId'],
    where: { ...(medicineIds ? { medicineId: { in: medicineIds } } : {}), quantityRemaining: { gt: 0 }, expiryDate: { gte: today } },
    _sum: { quantityRemaining: true },
    _min: { expiryDate: true },
  });
  const expired = await prisma.medicineBatch.groupBy({
    by: ['medicineId'],
    where: { ...(medicineIds ? { medicineId: { in: medicineIds } } : {}), quantityRemaining: { gt: 0 }, expiryDate: { lt: today } },
    _sum: { quantityRemaining: true },
  });
  const m = new Map();
  for (const x of rows) m.set(x.medicineId, { available: x._sum.quantityRemaining || 0, nextExpiry: x._min.expiryDate, expiredQty: 0 });
  for (const x of expired) {
    const cur = m.get(x.medicineId) || { available: 0, nextExpiry: null, expiredQty: 0 };
    cur.expiredQty = x._sum.quantityRemaining || 0;
    m.set(x.medicineId, cur);
  }
  return m;
}

const withStock = (meds, sm) =>
  meds.map((m) => {
    const s = sm.get(m.id) || { available: 0, nextExpiry: null, expiredQty: 0 };
    return { ...m, stock: s.available, nextExpiry: s.nextExpiry, expiredQty: s.expiredQty, lowStock: s.available <= m.reorderLevel };
  });

// ── Medicines ──

r.get(
  '/medicines',
  requirePerm('medicines.view'),
  ah(async (req, res) => {
    const where = {};
    if (req.query.active !== 'all') where.isActive = true;
    if (req.query.category) where.category = String(req.query.category);
    if (req.query.q) {
      const q = String(req.query.q);
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { genericName: { contains: q, mode: 'insensitive' } },
        { brandName: { contains: q, mode: 'insensitive' } },
      ];
    }
    const meds = await prisma.medicine.findMany({ where, orderBy: { name: 'asc' }, take: 500 });
    let out = withStock(meds, await stockMap(meds.map((m) => m.id)));
    if (req.query.filter === 'low') out = out.filter((m) => m.lowStock);
    res.json(out);
  }),
);

r.get(
  '/medicines/categories',
  requirePerm('medicines.view'),
  ah(async (_req, res) => {
    const rows = await prisma.medicine.findMany({ distinct: ['category'], select: { category: true }, orderBy: { category: 'asc' } });
    res.json(rows.map((r) => r.category));
  }),
);

const medBody = z.object({
  name: reqStr(120),
  genericName: optStr(120),
  brandName: optStr(120),
  category: reqStr(60),
  form: optStr(40),
  unit: reqStr(30),
  sellingPrice: money,
  reorderLevel: z.coerce.number().int().min(0).max(100000),
  isActive: z.boolean().optional(),
});

r.post(
  '/medicines',
  requirePerm('pharmacy.manage'),
  ah(async (req, res) => {
    const d = parse(medBody, req.body);
    const exists = await prisma.medicine.findFirst({ where: { name: { equals: d.name, mode: 'insensitive' }, brandName: d.brandName ?? null } });
    if (exists) throw conflict('This medicine is already registered');
    const m = await prisma.medicine.create({ data: { ...d, genericName: d.genericName ?? null, brandName: d.brandName ?? null, form: d.form ?? null } });
    await audit(req, 'MEDICINE_CREATED', 'Medicine', m.id, d);
    res.status(201).json(m);
  }),
);

r.get(
  '/medicines/:id',
  requirePerm('medicines.view'),
  ah(async (req, res) => {
    const id = idParam(req.params.id);
    const m = await prisma.medicine.findUnique({
      where: { id },
      include: { batches: { orderBy: { expiryDate: 'asc' }, include: { supplier: true } } },
    });
    if (!m) throw notFound('Medicine not found');
    const [withS] = withStock([m], await stockMap([id]));
    const movements = await prisma.stockMovement.findMany({
      where: { medicineId: id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { user: { select: { fullName: true } }, batch: { select: { batchNumber: true } } },
    });
    res.json({ ...withS, movements });
  }),
);

r.put(
  '/medicines/:id',
  requirePerm('pharmacy.manage'),
  ah(async (req, res) => {
    const id = idParam(req.params.id);
    const d = parse(medBody, req.body);
    const before = await prisma.medicine.findUnique({ where: { id } });
    if (!before) throw notFound('Medicine not found');
    const data = { ...d, genericName: d.genericName ?? null, brandName: d.brandName ?? null, form: d.form ?? null };
    const m = await prisma.medicine.update({ where: { id }, data });
    await audit(req, 'MEDICINE_UPDATED', 'Medicine', id, diff(before, data));
    res.json(m);
  }),
);

// ── Suppliers ──

r.get('/suppliers', requirePerm('pharmacy.manage'), ah(async (_req, res) => res.json(await prisma.supplier.findMany({ orderBy: { name: 'asc' } }))));

const supplierBody = z.object({ name: reqStr(120), phone: optPhone, email: optStr(120), address: optStr(300) });
r.post(
  '/suppliers',
  requirePerm('pharmacy.manage'),
  ah(async (req, res) => {
    const d = parse(supplierBody, req.body);
    if (await prisma.supplier.findUnique({ where: { name: d.name } })) throw conflict('Supplier already exists');
    const s = await prisma.supplier.create({ data: { name: d.name, phone: d.phone ?? null, email: d.email ?? null, address: d.address ?? null } });
    await audit(req, 'SUPPLIER_CREATED', 'Supplier', s.id, d);
    res.status(201).json(s);
  }),
);
r.put(
  '/suppliers/:id',
  requirePerm('pharmacy.manage'),
  ah(async (req, res) => {
    const id = idParam(req.params.id);
    const d = parse(supplierBody, req.body);
    const s = await prisma.supplier.update({ where: { id }, data: { name: d.name, phone: d.phone ?? null, email: d.email ?? null, address: d.address ?? null } });
    await audit(req, 'SUPPLIER_UPDATED', 'Supplier', id, d);
    res.json(s);
  }),
);

r.delete(
  '/suppliers/:id',
  requirePerm('pharmacy.manage'),
  ah(async (req, res) => {
    const id = idParam(req.params.id);
    const s = await prisma.supplier.findUnique({ where: { id } });
    if (!s) throw notFound('Supplier not found');
    const batchCount = await prisma.medicineBatch.count({ where: { supplierId: id } });
    if (batchCount > 0) {
      throw conflict(`Supplier "${s.name}" is linked to ${batchCount} medicine batch(es) and cannot be deleted.`);
    }
    await prisma.supplier.delete({ where: { id } });
    await audit(req, 'SUPPLIER_DELETED', 'Supplier', id, { name: s.name });
    res.json({ deleted: id });
  }),
);

r.delete(
  '/medicines/:id',
  requirePerm('pharmacy.manage'),
  ah(async (req, res) => {
    const id = idParam(req.params.id);
    const m = await prisma.medicine.findUnique({ where: { id } });
    if (!m) throw notFound('Medicine not found');
    const [batches, rxItems, dispItems] = await Promise.all([
      prisma.medicineBatch.count({ where: { medicineId: id } }),
      prisma.prescriptionItem.count({ where: { medicineId: id } }),
      prisma.dispensationItem.count({ where: { medicineId: id } }),
    ]);
    if (batches + rxItems + dispItems > 0) {
      throw conflict(`"${m.name}" has historical stock batches or prescriptions and cannot be deleted. Edit the medicine and uncheck Active instead.`);
    }
    await prisma.stockMovement.deleteMany({ where: { medicineId: id } });
    await prisma.medicine.delete({ where: { id } });
    await audit(req, 'MEDICINE_DELETED', 'Medicine', id, { name: m.name });
    res.json({ deleted: id });
  }),
);

// ── Stock in / adjustments ──

r.post(
  '/stock-in',
  requirePerm('pharmacy.manage'),
  ah(async (req, res) => {
    const d = parse(
      z.object({
        medicineId: posInt,
        batchNumber: reqStr(60),
        expiryDate: dateStr,
        quantity: z.coerce.number().int().min(1).max(1000000),
        purchasePrice: money,
        supplierId: posInt.optional().nullable(),
        reference: optStr(100),
      }),
      req.body,
    );
    if (d.expiryDate <= localDateStr()) throw badRequest('Validation failed', { expiryDate: 'Cannot receive stock that is already expired' });
    const med = await prisma.medicine.findUnique({ where: { id: d.medicineId } });
    if (!med) throw notFound('Medicine not found');
    const batch = await prisma.$transaction(async (tx) => {
      const existing = await tx.medicineBatch.findUnique({ where: { medicineId_batchNumber: { medicineId: d.medicineId, batchNumber: d.batchNumber } } });
      let b;
      if (existing) {
        if (existing.expiryDate.toISOString().slice(0, 10) !== d.expiryDate) {
          throw conflict('This batch number already exists with a different expiry date');
        }
        b = await tx.medicineBatch.update({
          where: { id: existing.id },
          data: { quantityReceived: { increment: d.quantity }, quantityRemaining: { increment: d.quantity }, purchasePrice: d.purchasePrice },
        });
      } else {
        b = await tx.medicineBatch.create({
          data: {
            medicineId: d.medicineId,
            batchNumber: d.batchNumber,
            expiryDate: new Date(d.expiryDate),
            purchasePrice: d.purchasePrice,
            quantityReceived: d.quantity,
            quantityRemaining: d.quantity,
            supplierId: d.supplierId ?? null,
            receivedById: req.user.id,
          },
        });
      }
      await tx.stockMovement.create({
        data: { medicineId: d.medicineId, batchId: b.id, type: 'STOCK_IN', quantity: d.quantity, reference: d.reference ?? null, reason: 'Stock received', userId: req.user.id },
      });
      await audit(req, 'STOCK_IN', 'Medicine', d.medicineId, d, tx);
      return b;
    });
    res.status(201).json(batch);
  }),
);

r.post(
  '/adjustments',
  requirePerm('pharmacy.manage'),
  ah(async (req, res) => {
    const d = parse(
      z.object({
        batchId: posInt,
        type: z.enum(['ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'EXPIRED_WRITE_OFF']),
        quantity: z.coerce.number().int().min(1),
        reason: z.string().trim().min(3, 'A reason is required for stock adjustments').max(300),
      }),
      req.body,
    );
    const out = await prisma.$transaction(async (tx) => {
      const b = await tx.medicineBatch.findUnique({ where: { id: d.batchId } });
      if (!b) throw notFound('Batch not found');
      if (d.type === 'ADJUSTMENT_IN') {
        await tx.medicineBatch.update({ where: { id: b.id }, data: { quantityRemaining: { increment: d.quantity } } });
      } else {
        const { count } = await tx.medicineBatch.updateMany({
          where: { id: b.id, quantityRemaining: { gte: d.quantity } },
          data: { quantityRemaining: { decrement: d.quantity } },
        });
        if (!count) throw badRequest(`Batch ${b.batchNumber} only has ${b.quantityRemaining} units remaining`);
      }
      const mv = await tx.stockMovement.create({
        data: {
          medicineId: b.medicineId,
          batchId: b.id,
          type: d.type,
          quantity: d.type === 'ADJUSTMENT_IN' ? d.quantity : -d.quantity,
          reason: d.reason,
          userId: req.user.id,
        },
      });
      await audit(req, 'STOCK_ADJUSTED', 'MedicineBatch', b.id, d, tx);
      return mv;
    });
    res.status(201).json(out);
  }),
);

r.put(
  '/batches/:id',
  requirePerm('pharmacy.manage'),
  ah(async (req, res) => {
    const id = idParam(req.params.id);
    const d = parse(
      z.object({
        batchNumber: reqStr(60),
        expiryDate: dateStr,
        purchasePrice: money,
        supplierId: posInt.optional().nullable(),
      }),
      req.body,
    );
    const before = await prisma.medicineBatch.findUnique({ where: { id } });
    if (!before) throw notFound('Batch not found');
    const updated = await prisma.medicineBatch.update({
      where: { id },
      data: {
        batchNumber: d.batchNumber,
        expiryDate: new Date(d.expiryDate),
        purchasePrice: d.purchasePrice,
        supplierId: d.supplierId ?? null,
      },
      include: { medicine: { select: { id: true, name: true, unit: true } }, supplier: true },
    });
    await audit(req, 'BATCH_UPDATED', 'MedicineBatch', id, {
      before: {
        batchNumber: before.batchNumber,
        expiryDate: before.expiryDate,
        purchasePrice: before.purchasePrice,
        supplierId: before.supplierId,
      },
      after: d,
    });
    res.json(updated);
  }),
);

r.delete(
  '/batches/:id',
  requirePerm('pharmacy.manage'),
  ah(async (req, res) => {
    const id = idParam(req.params.id);
    const b = await prisma.medicineBatch.findUnique({ where: { id }, include: { medicine: true } });
    if (!b) throw notFound('Batch not found');
    const dispCount = await prisma.dispensationItem.count({ where: { batchId: id } });
    if (dispCount > 0 || b.quantityRemaining !== b.quantityReceived) {
      throw conflict(
        `Batch ${b.batchNumber} has already been partially dispensed or adjusted (${b.quantityRemaining}/${b.quantityReceived} remaining). Use a Stock Adjustment or Write-off instead to preserve inventory audit history.`,
      );
    }
    await prisma.$transaction([
      prisma.stockMovement.deleteMany({ where: { batchId: id } }),
      prisma.medicineBatch.delete({ where: { id } }),
    ]);
    await audit(req, 'BATCH_DELETED', 'MedicineBatch', id, {
      medicineId: b.medicineId,
      medicineName: b.medicine?.name,
      batchNumber: b.batchNumber,
      quantity: b.quantityReceived,
    });
    res.json({ deleted: id });
  }),
);

r.get(
  '/movements',
  requirePerm('pharmacy.manage', 'reports.inventory'),
  ah(async (req, res) => {
    const { skip, take, page, pageSize } = pagination(req.query);
    const where = {};
    if (req.query.medicineId) where.medicineId = Number(req.query.medicineId);
    if (req.query.type) where.type = String(req.query.type);
    if (isDateStr(req.query.from)) {
      const { start, end } = localRange(req.query.from, isDateStr(req.query.to) ? req.query.to : req.query.from);
      where.createdAt = { gte: start, lt: end };
    }
    const [items, total] = await Promise.all([
      prisma.stockMovement.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: { medicine: { select: { name: true, unit: true } }, batch: { select: { batchNumber: true } }, user: { select: { fullName: true } } },
      }),
      prisma.stockMovement.count({ where }),
    ]);
    res.json({ items, total, page, pageSize });
  }),
);

r.get(
  '/alerts',
  requirePerm('medicines.view', 'reports.inventory', 'dashboard.view'),
  ah(async (_req, res) => {
    const meds = await prisma.medicine.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
    const list = withStock(meds, await stockMap());
    const today = localDateStr();
    const soon = localDayStart(addDays(today, EXPIRY_WARNING_DAYS));
    const batches = await prisma.medicineBatch.findMany({
      where: { quantityRemaining: { gt: 0 }, expiryDate: { lt: soon } },
      orderBy: { expiryDate: 'asc' },
      include: { medicine: { select: { id: true, name: true, unit: true } }, supplier: { select: { id: true, name: true } } },
    });
    const t0 = todayStart();
    res.json({
      lowStock: list
        .filter((m) => m.lowStock)
        .map((m) => ({
          id: m.id,
          name: m.name,
          genericName: m.genericName,
          brandName: m.brandName,
          category: m.category,
          form: m.form,
          unit: m.unit,
          sellingPrice: m.sellingPrice,
          stock: m.stock,
          reorderLevel: m.reorderLevel,
        })),
      expired: batches.filter((b) => b.expiryDate < t0),
      expiringSoon: batches.filter((b) => b.expiryDate >= t0),
      expiryWarningDays: EXPIRY_WARNING_DAYS,
    });
  }),
);

// ── Prescriptions & dispensing ──

r.get(
  '/prescriptions',
  requirePerm('prescriptions.view'),
  ah(async (req, res) => {
    const { skip, take, page, pageSize } = pagination(req.query);
    const where = {};
    const status = String(req.query.status || 'OPEN');
    if (status === 'OPEN') where.status = { in: ['PENDING', 'PARTIALLY_DISPENSED'] };
    else if (status !== 'ALL') where.status = status;
    if (req.query.q) {
      const q = String(req.query.q);
      where.OR = [
        { prescriptionNumber: { contains: q, mode: 'insensitive' } },
        { patient: { OR: [{ firstName: { contains: q, mode: 'insensitive' } }, { lastName: { contains: q, mode: 'insensitive' } }, { patientNumber: { contains: q, mode: 'insensitive' } }] } },
      ];
    }
    const [items, total] = await Promise.all([
      prisma.prescription.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: status === 'OPEN' ? 'asc' : 'desc' },
        include: {
          patient: { select: { id: true, patientNumber: true, firstName: true, lastName: true } },
          doctor: { select: { fullName: true } },
          items: { include: { medicine: { select: { name: true, unit: true } } } },
        },
      }),
      prisma.prescription.count({ where }),
    ]);
    res.json({ items, total, page, pageSize });
  }),
);

r.get(
  '/prescriptions/:id',
  requirePerm('prescriptions.view'),
  ah(async (req, res) => {
    const id = idParam(req.params.id);
    const rx = await prisma.prescription.findUnique({
      where: { id },
      include: {
        patient: { select: { id: true, patientNumber: true, firstName: true, lastName: true, gender: true, dateOfBirth: true, allergies: true, phone: true } },
        doctor: { select: { fullName: true } },
        consultation: { select: { id: true, diagnosis: true, visitId: true } },
        items: { include: { medicine: true } },
        dispensations: {
          orderBy: { createdAt: 'desc' },
          include: { pharmacist: { select: { fullName: true } }, items: { include: { medicine: { select: { name: true } }, batch: { select: { batchNumber: true, expiryDate: true } } } } },
        },
      },
    });
    if (!rx) throw notFound('Prescription not found');
    const sm = await stockMap(rx.items.map((i) => i.medicineId));
    res.json({
      ...rx,
      items: rx.items.map((i) => ({ ...i, stockAvailable: sm.get(i.medicineId)?.available || 0, remaining: i.quantity - i.quantityDispensed })),
    });
  }),
);

/**
 * Dispense medicine. In one transaction:
 *  - validate requested quantities against prescription remainder and live stock
 *  - deduct stock from non-expired batches, earliest expiry first (FEFO)
 *  - record stock movements + dispensation + medicine charges on the visit invoice
 * Conditional decrements make it impossible to dispense more than is in stock,
 * even when two pharmacists dispense at the same time.
 */
r.post(
  '/prescriptions/:id/dispense',
  requirePerm('pharmacy.dispense'),
  ah(async (req, res) => {
    const id = idParam(req.params.id);
    const d = parse(
      z.object({
        items: z.array(z.object({ prescriptionItemId: posInt, quantity: z.coerce.number().int().min(0) })).min(1),
      }),
      req.body,
    );
    const lines = d.items.filter((i) => i.quantity > 0);
    if (!lines.length) throw badRequest('Enter a quantity to dispense for at least one medicine');
    const today = todayStart();

    const result = await prisma.$transaction(async (tx) => {
      // Lock the prescription row to serialise dispensing of the same prescription.
      await tx.$executeRaw`SELECT 1 FROM "Prescription" WHERE id = ${id} FOR UPDATE`;
      const rx = await tx.prescription.findUnique({
        where: { id },
        include: { items: { include: { medicine: true } }, consultation: true },
      });
      if (!rx) throw notFound('Prescription not found');
      if (!['PENDING', 'PARTIALLY_DISPENSED'].includes(rx.status)) throw badRequest(`Prescription is ${rx.status.toLowerCase().replace('_', ' ')}`);

      const dispenseNumber = await nextNumber('DSP', tx);
      const dispItems = [];
      for (const line of lines) {
        const item = rx.items.find((i) => i.id === line.prescriptionItemId);
        if (!item) throw badRequest('Item does not belong to this prescription');
        const remaining = item.quantity - item.quantityDispensed;
        if (line.quantity > remaining) {
          throw badRequest(`${item.medicine.name}: only ${remaining} ${item.medicine.unit}(s) remain on this prescription`);
        }
        const batches = await tx.medicineBatch.findMany({
          where: { medicineId: item.medicineId, quantityRemaining: { gt: 0 }, expiryDate: { gte: today } },
          orderBy: [{ expiryDate: 'asc' }, { id: 'asc' }],
        });
        const available = batches.reduce((s, b) => s + b.quantityRemaining, 0);
        if (line.quantity > available) {
          throw badRequest(`Insufficient stock for ${item.medicine.name}: requested ${line.quantity}, available ${available}`, {
            prescriptionItemId: item.id,
            available,
          });
        }
        let need = line.quantity;
        for (const b of batches) {
          if (need === 0) break;
          const take = Math.min(need, b.quantityRemaining);
          const { count } = await tx.medicineBatch.updateMany({
            where: { id: b.id, quantityRemaining: { gte: take } },
            data: { quantityRemaining: { decrement: take } },
          });
          if (!count) throw conflict(`Stock for ${item.medicine.name} changed while dispensing. Please retry.`);
          await tx.stockMovement.create({
            data: { medicineId: item.medicineId, batchId: b.id, type: 'DISPENSE', quantity: -take, reference: dispenseNumber, reason: rx.prescriptionNumber, userId: req.user.id },
          });
          dispItems.push({
            prescriptionItemId: item.id,
            medicineId: item.medicineId,
            batchId: b.id,
            quantity: take,
            unitPrice: item.medicine.sellingPrice,
            lineTotal: take * item.medicine.sellingPrice,
          });
          need -= take;
        }
        await tx.prescriptionItem.update({ where: { id: item.id }, data: { quantityDispensed: { increment: line.quantity } } });
      }

      const totalAmount = dispItems.reduce((s, i) => s + i.lineTotal, 0);
      const inv = await getOrCreateVisitInvoice({ patientId: rx.patientId, visitId: rx.consultation.visitId, userId: req.user.id }, tx);
      const disp = await tx.dispensation.create({
        data: { dispenseNumber, prescriptionId: id, patientId: rx.patientId, pharmacistId: req.user.id, totalAmount, invoiceId: inv.id, items: { create: dispItems } },
      });
      // One invoice line per medicine.
      const byItem = new Map();
      for (const di of dispItems) {
        const cur = byItem.get(di.prescriptionItemId) || { qty: 0, unitPrice: di.unitPrice };
        cur.qty += di.quantity;
        byItem.set(di.prescriptionItemId, cur);
      }
      for (const [piId, v] of byItem) {
        const it = rx.items.find((i) => i.id === piId);
        await addInvoiceItem(
          inv.id,
          { type: 'MEDICINE', description: `${it.medicine.name} (${dispenseNumber})`, quantity: v.qty, unitPrice: v.unitPrice, sourceType: 'Dispensation', sourceId: disp.id },
          req.user.id,
          tx,
        );
      }

      const after = await tx.prescriptionItem.findMany({ where: { prescriptionId: id } });
      const status = after.every((i) => i.quantityDispensed >= i.quantity) ? 'DISPENSED' : 'PARTIALLY_DISPENSED';
      await tx.prescription.update({ where: { id }, data: { status } });
      await audit(req, 'MEDICINE_DISPENSED', 'Prescription', id, { dispenseNumber, totalAmount, items: lines }, tx);
      return { dispensation: disp, status, invoiceId: inv.id };
    });
    res.status(201).json(result);
  }),
);

r.get(
  '/dispensations',
  requirePerm('pharmacy.dispense', 'reports.inventory'),
  ah(async (req, res) => {
    const { skip, take, page, pageSize } = pagination(req.query);
    const where = {};
    if (isDateStr(req.query.from)) {
      const { start, end } = localRange(req.query.from, isDateStr(req.query.to) ? req.query.to : req.query.from);
      where.createdAt = { gte: start, lt: end };
    }
    if (req.query.patientId) where.patientId = Number(req.query.patientId);
    const [items, total] = await Promise.all([
      prisma.dispensation.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          patient: { select: { id: true, patientNumber: true, firstName: true, lastName: true } },
          pharmacist: { select: { fullName: true } },
          prescription: { select: { id: true, prescriptionNumber: true } },
          items: { include: { medicine: { select: { name: true, unit: true } }, batch: { select: { batchNumber: true } } } },
        },
      }),
      prisma.dispensation.count({ where }),
    ]);
    res.json({ items, total, page, pageSize });
  }),
);

r.post(
  '/dispensations/:id/reverse',
  requirePerm('pharmacy.dispense', 'pharmacy.manage'),
  ah(async (req, res) => {
    const id = idParam(req.params.id);
    const { reason } = parse(z.object({ reason: z.string().trim().min(3, 'Enter a reason for reversing this dispensation').max(300) }), req.body || {});
    const out = await prisma.$transaction(async (tx) => {
      const disp = await tx.dispensation.findUnique({
        where: { id },
        include: { items: { include: { medicine: true } }, prescription: true },
      });
      if (!disp) throw notFound('Dispensation record not found');
      if (disp.invoiceId) {
        const inv = await tx.invoice.findUnique({ where: { id: disp.invoiceId } });
        const dispTotal = disp.items.reduce((s, i) => s + i.lineTotal, 0);
        if (inv && inv.status !== 'CANCELLED' && inv.subtotal - dispTotal - inv.discountAmount < inv.amountPaid) {
          throw conflict(
            `This dispensation's invoice (${inv.invoiceNumber}) has already been paid. Ask an Accountant or Manager to void the payment before reversing the dispensed stock.`,
          );
        }
      }
      for (const item of disp.items) {
        await tx.medicineBatch.update({
          where: { id: item.batchId },
          data: { quantityRemaining: { increment: item.quantity } },
        });
        await tx.stockMovement.create({
          data: {
            medicineId: item.medicineId,
            batchId: item.batchId,
            type: 'ADJUSTMENT_IN',
            quantity: item.quantity,
            reference: disp.dispenseNumber,
            reason: `Dispensation reversed: ${reason}`,
            userId: req.user.id,
          },
        });
        await tx.prescriptionItem.update({
          where: { id: item.prescriptionItemId },
          data: { quantityDispensed: { decrement: item.quantity } },
        });
      }
      if (disp.invoiceId) {
        await tx.invoiceItem.updateMany({
          where: { invoiceId: disp.invoiceId, sourceType: 'Dispensation', sourceId: disp.id, voided: false },
          data: { voided: true, voidReason: `Dispensation ${disp.dispenseNumber} reversed: ${reason}` },
        });
        await recalcInvoice(disp.invoiceId, tx);
      }
      await tx.dispensationItem.deleteMany({ where: { dispensationId: disp.id } });
      await tx.dispensation.delete({ where: { id: disp.id } });
      const rxItems = await tx.prescriptionItem.findMany({ where: { prescriptionId: disp.prescriptionId } });
      const totalDispensed = rxItems.reduce((s, i) => s + i.quantityDispensed, 0);
      const rxStatus = totalDispensed <= 0 ? 'PENDING' : rxItems.every((i) => i.quantityDispensed >= i.quantity) ? 'DISPENSED' : 'PARTIALLY_DISPENSED';
      await tx.prescription.update({ where: { id: disp.prescriptionId }, data: { status: rxStatus } });
      await audit(
        req,
        'DISPENSATION_REVERSED',
        'Prescription',
        disp.prescriptionId,
        { dispenseNumber: disp.dispenseNumber, totalAmount: disp.totalAmount, reason },
        tx,
      );
      return { reversed: disp.dispenseNumber, prescriptionId: disp.prescriptionId, status: rxStatus };
    });
    res.json(out);
  }),
);

export { stockMap, withStock };
export default r;

