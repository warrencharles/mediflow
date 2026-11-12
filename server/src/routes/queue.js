import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { ah, badRequest, conflict, notFound } from '../lib/errors.js';
import { parse, optStr, posInt, idParam } from '../lib/validate.js';
import { audit } from '../lib/audit.js';
import { nextValue, nextNumber } from '../lib/counters.js';
import { localDateStr, isDateStr } from '../lib/time.js';
import { notify } from '../lib/notify.js';
import { getOrCreateVisitInvoice, addInvoiceItem, recalcInvoice } from '../lib/billing.js';
import { requirePerm } from '../middleware/auth.js';

const r = Router();

export const visitInclude = {
  patient: {
    select: { id: true, patientNumber: true, firstName: true, lastName: true, gender: true, dateOfBirth: true, phone: true, allergies: true },
  },
  assignedDoctor: { select: { id: true, fullName: true } },
  vitals: { orderBy: { createdAt: 'desc' }, take: 1 },
  consultation: { select: { id: true, status: true, doctorId: true } },
};

/** Allowed queue moves: Waiting → Vitals → Awaiting Doctor → In Consultation → Completed */
const NEXT = {
  WAITING: ['VITALS', 'CANCELLED'],
  VITALS: ['AWAITING_DOCTOR', 'WAITING', 'CANCELLED'],
  AWAITING_DOCTOR: ['IN_CONSULTATION', 'CANCELLED'],
  IN_CONSULTATION: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
};
export function assertTransition(from, to) {
  if (!NEXT[from]?.includes(to)) throw badRequest(`Queue status cannot move from ${from} to ${to}`);
}

r.get(
  '/',
  requirePerm('queue.view'),
  ah(async (req, res) => {
    const date = isDateStr(req.query.date) ? req.query.date : localDateStr();
    const where = { queueDate: date };
    if (req.query.status) where.status = { in: String(req.query.status).split(',') };
    if (req.user.role === 'DOCTOR' && req.query.all !== 'true') {
      where.OR = [{ assignedDoctorId: req.user.id }, { assignedDoctorId: null }];
    }
    const visits = await prisma.visit.findMany({
      where,
      include: visitInclude,
      orderBy: [{ queueNumber: 'asc' }],
    });
    // Urgent patients first inside each status, then by queue number.
    visits.sort((a, b) => (a.priority === b.priority ? a.queueNumber - b.queueNumber : a.priority === 'URGENT' ? -1 : 1));
    res.json({ date, items: visits });
  }),
);

r.post(
  '/check-in',
  requirePerm('queue.checkin'),
  ah(async (req, res) => {
    const d = parse(
      z.object({
        patientId: posInt,
        appointmentId: posInt.optional().nullable(),
        doctorId: posInt.optional().nullable(),
        serviceId: posInt.optional().nullable(),
        reason: optStr(300),
        priority: z.enum(['NORMAL', 'URGENT']).default('NORMAL'),
      }),
      req.body,
    );
    const visit = await prisma.$transaction(async (tx) => {
      const patient = await tx.patient.findUnique({ where: { id: d.patientId } });
      if (!patient) throw notFound('Patient not found');
      if (patient.status !== 'ACTIVE') throw badRequest('This patient is marked inactive. Reactivate the patient first.');
      const queueDate = localDateStr();
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(2001, ${d.patientId}::int)`;
      const open = await tx.visit.findFirst({
        where: { patientId: d.patientId, queueDate, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
      });
      if (open) throw conflict(`Patient is already in today's queue (No. ${open.queueNumber}).`);

      let doctorId = d.doctorId ?? null;
      let reason = d.reason ?? null;
      if (d.appointmentId) {
        const appt = await tx.appointment.findUnique({ where: { id: d.appointmentId } });
        if (!appt || appt.patientId !== d.patientId) throw badRequest('Appointment does not belong to this patient');
        if (!['SCHEDULED', 'CONFIRMED'].includes(appt.status)) throw badRequest(`Appointment is ${appt.status.toLowerCase()}`);
        await tx.appointment.update({ where: { id: appt.id }, data: { status: 'CHECKED_IN' } });
        doctorId = doctorId ?? appt.doctorId;
        reason = reason ?? appt.reason;
      }
      const queueNumber = await nextValue(`queue:${queueDate}`, tx);
      const visitNumber = await nextNumber('V', tx);
      const v = await tx.visit.create({
        data: {
          visitNumber,
          patientId: d.patientId,
          appointmentId: d.appointmentId ?? null,
          queueDate,
          queueNumber,
          priority: d.priority,
          reason,
          assignedDoctorId: doctorId,
          checkedInById: req.user.id,
        },
        include: visitInclude,
      });

      // Consultation / registration fee goes on the visit invoice at check-in.
      const service = d.serviceId
        ? await tx.service.findUnique({ where: { id: d.serviceId } })
        : await tx.service.findFirst({ where: { category: 'CONSULTATION', isActive: true }, orderBy: { id: 'asc' } });
      if (service) {
        const inv = await getOrCreateVisitInvoice({ patientId: d.patientId, visitId: v.id, userId: req.user.id }, tx);
        await addInvoiceItem(
          inv.id,
          { type: service.category === 'CONSULTATION' ? 'CONSULTATION' : 'SERVICE', description: service.name, unitPrice: service.price, sourceType: 'Visit', sourceId: v.id },
          req.user.id,
          tx,
        );
      }
      await notify({ role: 'NURSE', title: 'New patient in queue', message: `No. ${queueNumber} – ${patient.firstName} ${patient.lastName} is waiting for vitals.`, link: '/queue' }, tx);
      await audit(req, 'PATIENT_CHECKED_IN', 'Visit', v.id, { visitNumber, queueNumber, patientId: d.patientId }, tx);
      return v;
    });
    res.status(201).json(visit);
  }),
);

r.get(
  '/:id',
  requirePerm('queue.view'),
  ah(async (req, res) => {
    const v = await prisma.visit.findUnique({
      where: { id: idParam(req.params.id) },
      include: { ...visitInclude, vitals: { orderBy: { createdAt: 'desc' }, include: { recordedBy: { select: { fullName: true } } } } },
    });
    if (!v) throw notFound('Visit not found');
    res.json(v);
  }),
);

/** Nurse calls patient for vitals. */
r.post(
  '/:id/start-vitals',
  requirePerm('vitals.write'),
  ah(async (req, res) => {
    const id = idParam(req.params.id);
    const v = await prisma.visit.findUnique({ where: { id } });
    if (!v) throw notFound('Visit not found');
    assertTransition(v.status, 'VITALS');
    const out = await prisma.visit.update({ where: { id }, data: { status: 'VITALS' }, include: visitInclude });
    await audit(req, 'QUEUE_STATUS', 'Visit', id, { from: v.status, to: 'VITALS' });
    res.json(out);
  }),
);

const vitalsBody = z
  .object({
    temperature: z.coerce.number().min(30).max(45).optional().nullable(),
    systolic: z.coerce.number().int().min(50).max(260).optional().nullable(),
    diastolic: z.coerce.number().int().min(30).max(160).optional().nullable(),
    pulse: z.coerce.number().int().min(20).max(250).optional().nullable(),
    respRate: z.coerce.number().int().min(5).max(80).optional().nullable(),
    spo2: z.coerce.number().int().min(50).max(100).optional().nullable(),
    weightKg: z.coerce.number().min(0.5).max(350).optional().nullable(),
    heightCm: z.coerce.number().min(30).max(250).optional().nullable(),
    notes: optStr(1000),
    doctorId: posInt.optional().nullable(),
  })
  .refine((v) => ['temperature', 'systolic', 'pulse', 'respRate', 'spo2', 'weightKg'].some((k) => v[k] != null), {
    message: 'Record at least one vital sign',
    path: ['temperature'],
  })
  .refine((v) => (v.systolic == null) === (v.diastolic == null), { message: 'Enter both systolic and diastolic', path: ['diastolic'] });

const blank = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === '' ? null : v]));

/** Nurse records vitals → patient moves to Awaiting Doctor and doctor is notified. */
r.post(
  '/:id/vitals',
  requirePerm('vitals.write'),
  ah(async (req, res) => {
    const id = idParam(req.params.id);
    const d = parse(vitalsBody, blank(req.body || {}));
    const out = await prisma.$transaction(async (tx) => {
      const v = await tx.visit.findUnique({ where: { id }, include: { patient: true } });
      if (!v) throw notFound('Visit not found');
      if (!['WAITING', 'VITALS', 'AWAITING_DOCTOR'].includes(v.status)) throw badRequest(`Cannot record vitals for a visit that is ${v.status}`);
      const { doctorId, ...vit } = d;
      const bmi = vit.weightKg && vit.heightCm ? Math.round((vit.weightKg / (vit.heightCm / 100) ** 2) * 10) / 10 : null;
      const vitals = await tx.vitals.create({ data: { ...vit, bmi, notes: vit.notes ?? null, visitId: id, patientId: v.patientId, recordedById: req.user.id } });
      const assignedDoctorId = doctorId ?? v.assignedDoctorId;
      await tx.visit.update({ where: { id }, data: { status: 'AWAITING_DOCTOR', vitalsAt: new Date(), assignedDoctorId } });
      const msg = `No. ${v.queueNumber} – ${v.patient.firstName} ${v.patient.lastName} is ready for consultation.`;
      if (assignedDoctorId) await notify({ userId: assignedDoctorId, title: 'Patient ready', message: msg, link: '/queue' }, tx);
      else await notify({ role: 'DOCTOR', title: 'Patient ready', message: msg, link: '/queue' }, tx);
      await audit(req, 'VITALS_RECORDED', 'Visit', id, { vitalsId: vitals.id }, tx);
      return tx.visit.findUnique({ where: { id }, include: visitInclude });
    });
    res.json(out);
  }),
);

/**
 * Doctor calls the next patient: oldest AWAITING_DOCTOR visit assigned to this
 * doctor or unassigned (urgent first). Opens a consultation atomically.
 */
r.post(
  '/call-next',
  requirePerm('queue.call'),
  ah(async (req, res) => {
    const visitId = req.body?.visitId ? posInt.parse(req.body.visitId) : null;
    const out = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(3001, 0)`;
      const ongoing = await tx.visit.findFirst({
        where: { status: 'IN_CONSULTATION', consultation: { doctorId: req.user.id } },
        include: { consultation: true },
      });
      if (ongoing) throw conflict(`Finish your current consultation (queue No. ${ongoing.queueNumber}) before calling the next patient.`, { visitId: ongoing.id, consultationId: ongoing.consultation.id });
      const where = visitId
        ? { id: visitId, status: 'AWAITING_DOCTOR' }
        : { status: 'AWAITING_DOCTOR', queueDate: localDateStr(), OR: [{ assignedDoctorId: req.user.id }, { assignedDoctorId: null }] };
      const candidates = await tx.visit.findMany({ where, orderBy: { queueNumber: 'asc' } });
      candidates.sort((a, b) => (a.priority === b.priority ? a.queueNumber - b.queueNumber : a.priority === 'URGENT' ? -1 : 1));
      const v = candidates[0];
      if (!v) throw notFound(visitId ? 'That patient is not awaiting a doctor' : 'No patients are waiting for you right now');
      if (v.assignedDoctorId && v.assignedDoctorId !== req.user.id && req.user.role !== 'SUPER_ADMIN') {
        throw conflict('This patient is assigned to another doctor');
      }
      await tx.visit.update({
        where: { id: v.id },
        data: { status: 'IN_CONSULTATION', consultationStartedAt: new Date(), assignedDoctorId: req.user.id },
      });
      const consultation = await tx.consultation.create({ data: { visitId: v.id, patientId: v.patientId, doctorId: req.user.id } });
      await audit(req, 'PATIENT_CALLED', 'Visit', v.id, { consultationId: consultation.id }, tx);
      return { visit: await tx.visit.findUnique({ where: { id: v.id }, include: visitInclude }), consultation };
    });
    res.json(out);
  }),
);

r.post(
  '/:id/cancel',
  requirePerm('queue.checkin', 'vitals.write'),
  ah(async (req, res) => {
    const id = idParam(req.params.id);
    const { reason } = parse(z.object({ reason: z.string().trim().min(3, 'Give a reason') }), req.body);
    const out = await prisma.$transaction(async (tx) => {
      const v = await tx.visit.findUnique({ where: { id } });
      if (!v) throw notFound('Visit not found');
      assertTransition(v.status, 'CANCELLED');
      await tx.visit.update({ where: { id }, data: { status: 'CANCELLED', cancelReason: reason } });
      if (v.appointmentId) await tx.appointment.update({ where: { id: v.appointmentId }, data: { status: 'CONFIRMED' } });
      // Void the unpaid check-in charge so the patient is not billed for a consultation that never happened.
      const items = await tx.invoiceItem.findMany({ where: { sourceType: 'Visit', sourceId: id, voided: false }, include: { invoice: true } });
      for (const it of items) {
        if (it.invoice.amountPaid === 0 && it.invoice.status !== 'CANCELLED') {
          await tx.invoiceItem.update({ where: { id: it.id }, data: { voided: true, voidReason: `Visit cancelled: ${reason}` } });
          await recalcInvoice(it.invoiceId, tx);
        }
      }
      await audit(req, 'VISIT_CANCELLED', 'Visit', id, { reason, from: v.status }, tx);
      return tx.visit.findUnique({ where: { id }, include: visitInclude });
    });
    res.json(out);
  }),
);

r.post(
  '/:id/assign',
  requirePerm('queue.checkin', 'vitals.write'),
  ah(async (req, res) => {
    const id = idParam(req.params.id);
    const { doctorId } = parse(z.object({ doctorId: posInt.nullable() }), req.body);
    const v = await prisma.visit.findUnique({ where: { id } });
    if (!v) throw notFound('Visit not found');
    if (['IN_CONSULTATION', 'COMPLETED', 'CANCELLED'].includes(v.status)) throw badRequest('Cannot reassign at this stage');
    const out = await prisma.visit.update({ where: { id }, data: { assignedDoctorId: doctorId }, include: visitInclude });
    await audit(req, 'VISIT_REASSIGNED', 'Visit', id, { from: v.assignedDoctorId, to: doctorId });
    res.json(out);
  }),
);

r.post(
  '/:id/reopen',
  requirePerm('queue.checkin', 'vitals.write', 'consultations.write'),
  ah(async (req, res) => {
    const id = idParam(req.params.id);
    const { targetStatus, reason } = parse(
      z.object({
        targetStatus: z.enum(['WAITING', 'VITALS', 'AWAITING_DOCTOR', 'IN_CONSULTATION']).default('WAITING'),
        reason: optStr(300),
      }),
      req.body || {},
    );
    const out = await prisma.$transaction(async (tx) => {
      const v = await tx.visit.findUnique({ where: { id }, include: { consultation: true } });
      if (!v) throw notFound('Visit not found');
      if (v.status === targetStatus) return tx.visit.findUnique({ where: { id }, include: visitInclude });
      await tx.visit.update({
        where: { id },
        data: { status: targetStatus, cancelReason: null, ...(targetStatus !== 'COMPLETED' ? { completedAt: null } : {}) },
      });
      if (v.consultation && v.consultation.status === 'COMPLETED' && targetStatus === 'IN_CONSULTATION') {
        await tx.consultation.update({ where: { id: v.consultation.id }, data: { status: 'IN_PROGRESS', completedAt: null } });
      }
      if (v.status === 'CANCELLED') {
        if (v.appointmentId) await tx.appointment.update({ where: { id: v.appointmentId }, data: { status: 'CHECKED_IN' } });
        const voidedItems = await tx.invoiceItem.findMany({
          where: { sourceType: 'Visit', sourceId: id, voided: true },
          include: { invoice: true },
        });
        for (const it of voidedItems) {
          if (it.invoice.status !== 'CANCELLED') {
            await tx.invoiceItem.update({ where: { id: it.id }, data: { voided: false, voidReason: null } });
            await recalcInvoice(it.invoiceId, tx);
          }
        }
      }
      await audit(req, 'VISIT_REOPENED', 'Visit', id, { from: v.status, to: targetStatus, reason }, tx);
      return tx.visit.findUnique({ where: { id }, include: visitInclude });
    });
    res.json(out);
  }),
);

r.delete(
  '/:id',
  requirePerm('queue.checkin', 'users.manage', 'schedules.manage'),
  ah(async (req, res) => {
    const id = idParam(req.params.id);
    await prisma.$transaction(async (tx) => {
      const v = await tx.visit.findUnique({
        where: { id },
        include: { consultation: true, vitals: true, labRequests: true, invoices: { include: { payments: true, items: true } }, patient: true },
      });
      if (!v) throw notFound('Visit not found');
      if (v.consultation || v.labRequests.length > 0) {
        throw conflict('This visit already has clinical consultation or lab records and cannot be deleted. Cancel the visit instead.');
      }
      const hasPaidOrCustomItems = v.invoices.some(
        (inv) => inv.amountPaid > 0 || inv.payments.some((p) => p.status === 'VALID') || inv.items.some((it) => !it.voided && it.sourceType !== 'Visit'),
      );
      if (hasPaidOrCustomItems) {
        throw conflict('This visit has payments or additional billed items and cannot be deleted. Cancel the visit instead.');
      }
      for (const inv of v.invoices) {
        await tx.discount.deleteMany({ where: { invoiceId: inv.id } });
        await tx.invoiceItem.deleteMany({ where: { invoiceId: inv.id } });
        await tx.payment.deleteMany({ where: { invoiceId: inv.id } });
        await tx.invoice.delete({ where: { id: inv.id } });
      }
      await tx.vitals.deleteMany({ where: { visitId: id } });
      if (v.appointmentId) {
        await tx.appointment.update({ where: { id: v.appointmentId }, data: { status: 'CONFIRMED' } }).catch(() => {});
      }
      await tx.visit.delete({ where: { id } });
      await audit(
        req,
        'VISIT_DELETED',
        'Visit',
        id,
        { visitNumber: v.visitNumber, queueNumber: v.queueNumber, patientNumber: v.patient?.patientNumber },
        tx,
      );
    });
    res.json({ deleted: id });
  }),
);

export default r;

