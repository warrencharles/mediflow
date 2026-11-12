import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { ah, badRequest, forbidden, notFound } from '../lib/errors.js';
import { parse, optStr, optDateStr, posInt, idParam, pagination, reqStr } from '../lib/validate.js';
import { audit, diff } from '../lib/audit.js';
import { nextNumber } from '../lib/counters.js';
import { localRange, isDateStr } from '../lib/time.js';
import { notify } from '../lib/notify.js';
import { getOrCreateVisitInvoice, addInvoiceItem } from '../lib/billing.js';
import { requirePerm } from '../middleware/auth.js';

const r = Router();

const fullInclude = {
  patient: true,
  doctor: { select: { id: true, fullName: true } },
  visit: {
    include: { vitals: { orderBy: { createdAt: 'desc' }, include: { recordedBy: { select: { fullName: true } } } } },
  },
  prescriptions: {
    orderBy: { createdAt: 'asc' },
    include: { items: { include: { medicine: { select: { id: true, name: true, unit: true, form: true } } } } },
  },
  labRequests: { orderBy: { createdAt: 'asc' }, include: { labTest: true, resultEnteredBy: { select: { fullName: true } } } },
};

async function loadOwn(req, id, { mustBeOpen = false } = {}) {
  const c = await prisma.consultation.findUnique({ where: { id } });
  if (!c) throw notFound('Consultation not found');
  if (c.doctorId !== req.user.id && req.user.role !== 'SUPER_ADMIN') {
    throw forbidden('Only the consulting doctor can change this consultation');
  }
  if (mustBeOpen && c.status !== 'IN_PROGRESS') throw badRequest('This consultation is already completed');
  return c;
}

r.get(
  '/',
  requirePerm('consultations.view'),
  ah(async (req, res) => {
    const { skip, take, page, pageSize } = pagination(req.query);
    const where = {};
    if (req.query.doctorId) where.doctorId = Number(req.query.doctorId);
    if (req.query.mine === 'true') where.doctorId = req.user.id;
    if (req.query.patientId) where.patientId = Number(req.query.patientId);
    if (req.query.status) where.status = String(req.query.status);
    if (isDateStr(req.query.from)) {
      const { start, end } = localRange(req.query.from, isDateStr(req.query.to) ? req.query.to : req.query.from);
      where.startedAt = { gte: start, lt: end };
    }
    if (req.query.q) {
      const q = String(req.query.q);
      where.OR = [
        { diagnosis: { contains: q, mode: 'insensitive' } },
        { patient: { OR: [{ firstName: { contains: q, mode: 'insensitive' } }, { lastName: { contains: q, mode: 'insensitive' } }, { patientNumber: { contains: q, mode: 'insensitive' } }] } },
      ];
    }
    const [items, total] = await Promise.all([
      prisma.consultation.findMany({
        where,
        skip,
        take,
        orderBy: { startedAt: 'desc' },
        include: {
          patient: { select: { id: true, patientNumber: true, firstName: true, lastName: true } },
          doctor: { select: { id: true, fullName: true } },
        },
      }),
      prisma.consultation.count({ where }),
    ]);
    res.json({ items, total, page, pageSize });
  }),
);

/** Start a consultation without the queue (e.g. follow-up review). */
r.post(
  '/',
  requirePerm('consultations.write'),
  ah(async (req, res) => {
    const { patientId } = parse(z.object({ patientId: posInt }), req.body);
    const p = await prisma.patient.findUnique({ where: { id: patientId } });
    if (!p) throw notFound('Patient not found');
    const c = await prisma.consultation.create({ data: { patientId, doctorId: req.user.id } });
    await audit(req, 'CONSULTATION_STARTED', 'Consultation', c.id, { patientId });
    res.status(201).json(c);
  }),
);

r.get(
  '/:id',
  requirePerm('consultations.view'),
  ah(async (req, res) => {
    const id = idParam(req.params.id);
    const c = await prisma.consultation.findUnique({ where: { id }, include: fullInclude });
    if (!c) throw notFound('Consultation not found');
    await audit(req, 'CONSULTATION_VIEWED', 'Consultation', id);
    res.json(c);
  }),
);

const notesBody = z.object({
  symptoms: optStr(5000),
  examination: optStr(5000),
  diagnosis: optStr(2000),
  treatmentPlan: optStr(5000),
  notes: optStr(5000),
  followUpDate: optDateStr,
  amendmentReason: optStr(500),
});

r.put(
  '/:id',
  requirePerm('consultations.write'),
  ah(async (req, res) => {
    const id = idParam(req.params.id);
    const before = await loadOwn(req, id);
    const { amendmentReason, ...d } = parse(notesBody, req.body);
    if (before.status === 'COMPLETED' && !amendmentReason) {
      throw badRequest('Validation failed', { amendmentReason: 'A reason is required to amend a completed consultation' });
    }
    const data = {
      symptoms: d.symptoms ?? null,
      examination: d.examination ?? null,
      diagnosis: d.diagnosis ?? null,
      treatmentPlan: d.treatmentPlan ?? null,
      notes: d.notes ?? null,
      followUpDate: d.followUpDate ? new Date(d.followUpDate) : null,
    };
    const c = await prisma.consultation.update({ where: { id }, data, include: fullInclude });
    const changes = diff(before, data);
    if (Object.keys(changes).length) {
      await audit(req, before.status === 'COMPLETED' ? 'CONSULTATION_AMENDED' : 'CONSULTATION_UPDATED', 'Consultation', id, {
        changes,
        amendmentReason,
      });
    }
    res.json(c);
  }),
);

r.post(
  '/:id/complete',
  requirePerm('consultations.write'),
  ah(async (req, res) => {
    const id = idParam(req.params.id);
    const c0 = await loadOwn(req, id, { mustBeOpen: true });
    if (!c0.diagnosis) throw badRequest('Validation failed', { diagnosis: 'Enter a diagnosis before completing the consultation' });
    const out = await prisma.$transaction(async (tx) => {
      const c = await tx.consultation.update({ where: { id }, data: { status: 'COMPLETED', completedAt: new Date() } });
      if (c.visitId) {
        const v = await tx.visit.update({ where: { id: c.visitId }, data: { status: 'COMPLETED', completedAt: new Date() } });
        if (v.appointmentId) await tx.appointment.update({ where: { id: v.appointmentId }, data: { status: 'COMPLETED' } });
      }
      await audit(req, 'CONSULTATION_COMPLETED', 'Consultation', id, { diagnosis: c.diagnosis }, tx);
      return tx.consultation.findUnique({ where: { id }, include: fullInclude });
    });
    res.json(out);
  }),
);

r.post(
  '/:id/reopen',
  requirePerm('consultations.write'),
  ah(async (req, res) => {
    const id = idParam(req.params.id);
    const c0 = await loadOwn(req, id);
    if (c0.status !== 'COMPLETED') throw badRequest('Consultation is already open');
    const { reason } = parse(z.object({ reason: optStr(300) }), req.body || {});
    const out = await prisma.$transaction(async (tx) => {
      const c = await tx.consultation.update({ where: { id }, data: { status: 'IN_PROGRESS', completedAt: null } });
      if (c.visitId) {
        const v = await tx.visit.update({ where: { id: c.visitId }, data: { status: 'IN_CONSULTATION', completedAt: null } });
        if (v.appointmentId) await tx.appointment.update({ where: { id: v.appointmentId }, data: { status: 'CHECKED_IN' } });
      }
      await audit(req, 'CONSULTATION_REOPENED', 'Consultation', id, { reason }, tx);
      return tx.consultation.findUnique({ where: { id }, include: fullInclude });
    });
    res.json(out);
  }),
);

// ── Prescriptions ──

const rxBody = z.object({
  notes: optStr(1000),
  items: z
    .array(
      z.object({
        medicineId: posInt,
        dosage: reqStr(100),
        frequency: reqStr(100),
        durationDays: z.coerce.number().int().min(1).max(365).optional().nullable(),
        quantity: z.coerce.number().int().min(1, 'Quantity must be at least 1').max(10000),
        instructions: optStr(500),
      }),
    )
    .min(1, 'Add at least one medicine'),
});

r.post(
  '/:id/prescriptions',
  requirePerm('consultations.write'),
  ah(async (req, res) => {
    const id = idParam(req.params.id);
    const c = await loadOwn(req, id);
    const d = parse(rxBody, req.body);
    const ids = [...new Set(d.items.map((i) => i.medicineId))];
    if (ids.length !== d.items.length) throw badRequest('Each medicine may appear only once per prescription');
    const meds = await prisma.medicine.findMany({ where: { id: { in: ids }, isActive: true } });
    if (meds.length !== ids.length) throw badRequest('One or more medicines are not available in the formulary');
    const rx = await prisma.$transaction(async (tx) => {
      const prescriptionNumber = await nextNumber('RX', tx);
      const p = await tx.prescription.create({
        data: {
          prescriptionNumber,
          consultationId: id,
          patientId: c.patientId,
          doctorId: c.doctorId,
          notes: d.notes ?? null,
          items: {
            create: d.items.map((i) => ({
              medicineId: i.medicineId,
              dosage: i.dosage,
              frequency: i.frequency,
              durationDays: i.durationDays ?? null,
              quantity: i.quantity,
              instructions: i.instructions ?? null,
            })),
          },
        },
        include: { items: { include: { medicine: true } } },
      });
      await notify({ role: 'PHARMACIST', title: 'New prescription', message: `${prescriptionNumber} is waiting to be dispensed.`, link: `/pharmacy/prescriptions/${p.id}` }, tx);
      await audit(req, 'PRESCRIPTION_CREATED', 'Prescription', p.id, { consultationId: id, items: d.items }, tx);
      return p;
    });
    res.status(201).json(rx);
  }),
);

r.post(
  '/prescriptions/:rxId/cancel',
  requirePerm('consultations.write'),
  ah(async (req, res) => {
    const rxId = idParam(req.params.rxId);
    const { reason } = parse(z.object({ reason: z.string().trim().min(3, 'Give a reason') }), req.body);
    const rx = await prisma.prescription.findUnique({ where: { id: rxId } });
    if (!rx) throw notFound('Prescription not found');
    if (rx.doctorId !== req.user.id && req.user.role !== 'SUPER_ADMIN') throw forbidden('Only the prescribing doctor can cancel');
    if (rx.status !== 'PENDING') throw badRequest('Only prescriptions that have not been dispensed can be cancelled');
    const out = await prisma.prescription.update({ where: { id: rxId }, data: { status: 'CANCELLED', cancelReason: reason } });
    await audit(req, 'PRESCRIPTION_CANCELLED', 'Prescription', rxId, { reason });
    res.json(out);
  }),
);

r.post(
  '/prescriptions/:rxId/reopen',
  requirePerm('consultations.write'),
  ah(async (req, res) => {
    const rxId = idParam(req.params.rxId);
    const rx = await prisma.prescription.findUnique({ where: { id: rxId } });
    if (!rx) throw notFound('Prescription not found');
    if (rx.doctorId !== req.user.id && req.user.role !== 'SUPER_ADMIN') throw forbidden('Only the prescribing doctor can reopen');
    if (rx.status !== 'CANCELLED') throw badRequest('Only cancelled prescriptions can be reopened');
    const out = await prisma.prescription.update({ where: { id: rxId }, data: { status: 'PENDING', cancelReason: null } });
    await audit(req, 'PRESCRIPTION_REOPENED', 'Prescription', rxId, { prescriptionNumber: rx.prescriptionNumber });
    res.json(out);
  }),
);

// ── Laboratory requests ──

r.post(
  '/:id/lab-requests',
  requirePerm('lab.request'),
  ah(async (req, res) => {
    const id = idParam(req.params.id);
    const c = await loadOwn(req, id);
    const d = parse(
      z.object({
        labTestIds: z.array(posInt).min(1, 'Select at least one test'),
        clinicalNotes: optStr(1000),
        priority: z.enum(['ROUTINE', 'URGENT']).default('ROUTINE'),
      }),
      req.body,
    );
    const tests = await prisma.labTest.findMany({ where: { id: { in: d.labTestIds }, isActive: true } });
    if (tests.length !== new Set(d.labTestIds).size) throw badRequest('One or more tests are not available');
    const created = await prisma.$transaction(async (tx) => {
      const inv = await getOrCreateVisitInvoice({ patientId: c.patientId, visitId: c.visitId, userId: req.user.id }, tx);
      const out = [];
      for (const t of tests) {
        const requestNumber = await nextNumber('LAB', tx);
        const lr = await tx.labRequest.create({
          data: {
            requestNumber,
            patientId: c.patientId,
            visitId: c.visitId,
            consultationId: id,
            doctorId: c.doctorId,
            labTestId: t.id,
            price: t.price,
            clinicalNotes: d.clinicalNotes ?? null,
            priority: d.priority,
          },
          include: { labTest: true },
        });
        await addInvoiceItem(inv.id, { type: 'LAB', description: `Lab: ${t.name}`, unitPrice: t.price, sourceType: 'LabRequest', sourceId: lr.id }, req.user.id, tx);
        out.push(lr);
      }
      for (const role of ['LAB_TECHNICIAN', 'NURSE']) {
        await notify({ role, title: d.priority === 'URGENT' ? 'URGENT lab request' : 'New lab request', message: `${tests.map((t) => t.name).join(', ')}`, link: '/lab' }, tx);
      }
      await audit(req, 'LAB_REQUESTED', 'Consultation', id, { tests: tests.map((t) => t.code) }, tx);
      return out;
    });
    res.status(201).json(created);
  }),
);

export default r;

