import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { ah, badRequest, conflict, notFound, forbidden } from '../lib/errors.js';
import { parse, reqStr, optStr, dateStr, idParam, pagination, posInt } from '../lib/validate.js';
import { audit } from '../lib/audit.js';
import { localRange, localParts, localDateTime, isDateStr } from '../lib/time.js';
import { requirePerm } from '../middleware/auth.js';
import { sendAppointmentReminder } from '../lib/sms.js';

const r = Router();

const ACTIVE = ['SCHEDULED', 'CONFIRMED', 'CHECKED_IN'];

const include = {
  patient: { select: { id: true, patientNumber: true, firstName: true, lastName: true, phone: true } },
  doctor: { select: { id: true, fullName: true } },
};

/** Throws if the slot is outside the doctor's working hours or overlaps another booking. */
async function assertSlotAvailable(tx, { doctorId, patientId, startAt, endAt, excludeId }) {
  if (endAt <= startAt) throw badRequest('Validation failed', { time: 'End time must be after start time' });
  const doctor = await tx.user.findUnique({ where: { id: doctorId } });
  if (!doctor || doctor.role !== 'DOCTOR' || !doctor.isActive) throw badRequest('Validation failed', { doctorId: 'Select an active doctor' });

  const s = localParts(startAt);
  const e = localParts(endAt);
  const schedules = await tx.doctorSchedule.findMany({ where: { doctorId } });
  if (schedules.length) {
    const fits = schedules.some((sc) => sc.weekday === s.weekday && s.date === e.date && sc.startTime <= s.hhmm && e.hhmm <= sc.endTime);
    if (!fits) {
      throw conflict(`Dr. ${doctor.fullName} is not available at that time. Check the doctor's working hours.`);
    }
  }

  const overlap = { startAt: { lt: endAt }, endAt: { gt: startAt }, status: { in: ACTIVE }, ...(excludeId ? { id: { not: excludeId } } : {}) };
  const clash = await tx.appointment.findFirst({ where: { ...overlap, doctorId }, include });
  if (clash) {
    throw conflict(
      `Dr. ${doctor.fullName} already has an appointment with ${clash.patient.firstName} ${clash.patient.lastName} that overlaps this time.`,
      { conflictWith: clash.id },
    );
  }
  const patientClash = await tx.appointment.findFirst({ where: { ...overlap, patientId }, include });
  if (patientClash) {
    throw conflict(`This patient already has an overlapping appointment with Dr. ${patientClash.doctor.fullName}.`, {
      conflictWith: patientClash.id,
    });
  }
}

r.get(
  '/',
  requirePerm('appointments.view'),
  ah(async (req, res) => {
    const where = {};
    const { from, to, date } = req.query;
    if (isDateStr(date)) {
      const { start, end } = localRange(date);
      where.startAt = { gte: start, lt: end };
    } else if (isDateStr(from)) {
      const { start, end } = localRange(from, isDateStr(to) ? to : from);
      where.startAt = { gte: start, lt: end };
    }
    if (req.query.doctorId) where.doctorId = Number(req.query.doctorId);
    if (req.query.patientId) where.patientId = Number(req.query.patientId);
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.q) {
      const q = String(req.query.q);
      where.patient = {
        OR: [
          { firstName: { contains: q, mode: 'insensitive' } },
          { lastName: { contains: q, mode: 'insensitive' } },
          { patientNumber: { contains: q, mode: 'insensitive' } },
        ],
      };
    }
    // Doctors see only their own schedule unless they explicitly filter.
    if (req.user.role === 'DOCTOR' && !req.query.doctorId && req.query.mine !== 'false') where.doctorId = req.user.id;
    const { skip, take, page, pageSize } = pagination({ ...req.query, pageSize: req.query.pageSize || 200 });
    const [items, total] = await Promise.all([
      prisma.appointment.findMany({ where, include, orderBy: { startAt: 'asc' }, skip, take }),
      prisma.appointment.count({ where }),
    ]);
    res.json({ items, total, page, pageSize });
  }),
);

/** Free slots for a doctor on a date based on working hours and existing bookings. */
r.get(
  '/availability',
  requirePerm('appointments.view'),
  ah(async (req, res) => {
    const doctorId = posInt.parse(req.query.doctorId);
    const date = dateStr.parse(req.query.date);
    const slotMinutes = Math.min(120, Math.max(10, Number(req.query.slotMinutes) || 30));
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    const schedules = await prisma.doctorSchedule.findMany({ where: { doctorId, weekday }, orderBy: { startTime: 'asc' } });
    const { start, end } = localRange(date);
    const booked = await prisma.appointment.findMany({
      where: { doctorId, status: { in: ACTIVE }, startAt: { gte: start, lt: end } },
      select: { startAt: true, endAt: true },
    });
    const now = new Date();
    const slots = [];
    for (const sc of schedules) {
      let t = localDateTime(date, sc.startTime);
      const stop = localDateTime(date, sc.endTime);
      while (t.getTime() + slotMinutes * 60000 <= stop.getTime()) {
        const tEnd = new Date(t.getTime() + slotMinutes * 60000);
        const taken = booked.some((b) => b.startAt < tEnd && b.endAt > t);
        slots.push({ start: t, end: tEnd, time: localParts(t).hhmm, available: !taken && t > now });
        t = tEnd;
      }
    }
    res.json({ date, doctorId, worksToday: schedules.length > 0, schedules, slots });
  }),
);

const body = z.object({
  patientId: posInt,
  doctorId: posInt,
  date: dateStr,
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:MM'),
  durationMinutes: z.coerce.number().int().min(5).max(240).default(30),
  reason: reqStr(500),
  notes: optStr(1000),
});

r.post(
  '/',
  requirePerm('appointments.write'),
  ah(async (req, res) => {
    const d = parse(body, req.body);
    const startAt = localDateTime(d.date, d.startTime);
    const endAt = new Date(startAt.getTime() + d.durationMinutes * 60000);
    if (startAt < new Date(Date.now() - 5 * 60000)) throw badRequest('Validation failed', { startTime: 'Cannot book an appointment in the past' });
    const patient = await prisma.patient.findUnique({ where: { id: d.patientId } });
    if (!patient) throw badRequest('Validation failed', { patientId: 'Patient not found' });
    if (patient.status !== 'ACTIVE') throw badRequest('This patient is marked inactive. Reactivate the patient first.');
    const appt = await prisma.$transaction(async (tx) => {
      // Serialise bookings per doctor so two receptionists cannot double-book.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(1001, ${d.doctorId}::int)`;
      await assertSlotAvailable(tx, { doctorId: d.doctorId, patientId: d.patientId, startAt, endAt });
      const a = await tx.appointment.create({
        data: { patientId: d.patientId, doctorId: d.doctorId, startAt, endAt, reason: d.reason, notes: d.notes ?? null, createdById: req.user.id },
        include,
      });
      await audit(req, 'APPOINTMENT_CREATED', 'Appointment', a.id, { patientId: d.patientId, doctorId: d.doctorId, startAt }, tx);
      return a;
    });
    sendAppointmentReminder(appt).catch((err) => console.error('[SMS appointment reminder failed]', err));
    res.status(201).json(appt);
  }),
);

r.post(
  '/:id/send-sms',
  requirePerm('appointments.write'),
  ah(async (req, res) => {
    const id = idParam(req.params.id);
    const a = await prisma.appointment.findUnique({ where: { id }, include });
    if (!a) throw notFound('Appointment not found');
    const sms = await sendAppointmentReminder(a);
    await audit(req, 'APPOINTMENT_REMINDER_SMS_SENT', 'Appointment', id, { phone: a.patient.phone, to: `${a.patient.firstName} ${a.patient.lastName}` });
    res.json({ success: true, sms });
  }),
);

r.get(
  '/:id',
  requirePerm('appointments.view'),
  ah(async (req, res) => {
    const a = await prisma.appointment.findUnique({ where: { id: idParam(req.params.id) }, include: { ...include, visit: true } });
    if (!a) throw notFound('Appointment not found');
    res.json(a);
  }),
);

r.post(
  '/:id/reschedule',
  requirePerm('appointments.write'),
  ah(async (req, res) => {
    const id = idParam(req.params.id);
    const d = parse(body.pick({ date: true, startTime: true, durationMinutes: true }).extend({ doctorId: posInt.optional(), reason: optStr(300) }), req.body);
    const appt = await prisma.$transaction(async (tx) => {
      const before = await tx.appointment.findUnique({ where: { id } });
      if (!before) throw notFound('Appointment not found');
      if (!['SCHEDULED', 'CONFIRMED'].includes(before.status)) throw badRequest(`A ${before.status.toLowerCase()} appointment cannot be rescheduled`);
      const doctorId = d.doctorId ?? before.doctorId;
      const startAt = localDateTime(d.date, d.startTime);
      const endAt = new Date(startAt.getTime() + d.durationMinutes * 60000);
      if (startAt < new Date()) throw badRequest('Validation failed', { startTime: 'Cannot reschedule into the past' });
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(1001, ${doctorId}::int)`;
      await assertSlotAvailable(tx, { doctorId, patientId: before.patientId, startAt, endAt, excludeId: id });
      const a = await tx.appointment.update({
        where: { id },
        data: { doctorId, startAt, endAt, status: 'SCHEDULED', rescheduleCount: { increment: 1 } },
        include,
      });
      await audit(req, 'APPOINTMENT_RESCHEDULED', 'Appointment', id, {
        from: { startAt: before.startAt, doctorId: before.doctorId },
        to: { startAt, doctorId },
        reason: d.reason,
      }, tx);
      return a;
    });
    res.json(appt);
  }),
);

const TRANSITIONS = {
  SCHEDULED: ['CONFIRMED', 'CANCELLED', 'NO_SHOW'],
  CONFIRMED: ['CANCELLED', 'NO_SHOW', 'SCHEDULED'],
  CHECKED_IN: ['COMPLETED'],
  COMPLETED: ['CHECKED_IN'],
  CANCELLED: ['SCHEDULED'],
  NO_SHOW: ['SCHEDULED'],
};

r.post(
  '/:id/status',
  requirePerm('appointments.write'),
  ah(async (req, res) => {
    const id = idParam(req.params.id);
    const { status, reason } = parse(
      z.object({ status: z.enum(['SCHEDULED', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'NO_SHOW']), reason: optStr(300) }),
      req.body,
    );
    const before = await prisma.appointment.findUnique({ where: { id } });
    if (!before) throw notFound('Appointment not found');
    if (req.user.role === 'DOCTOR' && before.doctorId !== req.user.id) throw forbidden('You can only update your own appointments');
    if (!TRANSITIONS[before.status].includes(status)) {
      throw badRequest(`Cannot change an appointment from ${before.status} to ${status}. Use queue check-in to mark arrival.`);
    }
    if (status === 'CANCELLED' && !reason) throw badRequest('Validation failed', { reason: 'Give a cancellation reason' });
    const a = await prisma.$transaction(async (tx) => {
      if (['CANCELLED', 'NO_SHOW'].includes(before.status) && status === 'SCHEDULED') {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(1001, ${before.doctorId}::int)`;
        await assertSlotAvailable(tx, {
          doctorId: before.doctorId,
          patientId: before.patientId,
          startAt: before.startAt,
          endAt: before.endAt,
          excludeId: id,
        });
      }
      const updated = await tx.appointment.update({
        where: { id },
        data: { status, cancelReason: status === 'CANCELLED' ? reason : status === 'SCHEDULED' ? null : before.cancelReason },
        include,
      });
      await audit(req, 'APPOINTMENT_STATUS', 'Appointment', id, { from: before.status, to: status, reason }, tx);
      return updated;
    });
    res.json(a);
  }),
);

r.delete(
  '/:id',
  requirePerm('appointments.write'),
  ah(async (req, res) => {
    const id = idParam(req.params.id);
    const appt = await prisma.appointment.findUnique({ where: { id }, include: { visit: true, patient: true } });
    if (!appt) throw notFound('Appointment not found');
    if (req.user.role === 'DOCTOR' && appt.doctorId !== req.user.id) throw forbidden('You can only delete your own appointments');
    if (appt.visit) {
      throw conflict('This appointment already has a linked clinic visit and cannot be deleted. Cancel the appointment or visit instead.');
    }
    await prisma.appointment.delete({ where: { id } });
    await audit(req, 'APPOINTMENT_DELETED', 'Appointment', id, {
      patientId: appt.patientId,
      patientNumber: appt.patient?.patientNumber,
      doctorId: appt.doctorId,
      startAt: appt.startAt,
      status: appt.status,
    });
    res.json({ deleted: id });
  }),
);

// ── Doctor working hours ──

r.get(
  '/schedules/all',
  requirePerm('appointments.view'),
  ah(async (_req, res) => {
    const doctors = await prisma.user.findMany({
      where: { role: 'DOCTOR', isActive: true },
      orderBy: { fullName: 'asc' },
      select: { id: true, fullName: true, schedules: { orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }] } },
    });
    res.json(doctors);
  }),
);

r.put(
  '/schedules/:doctorId',
  requirePerm('schedules.manage'),
  ah(async (req, res) => {
    const doctorId = idParam(req.params.doctorId);
    const { schedules } = parse(
      z.object({
        schedules: z
          .array(
            z
              .object({
                weekday: z.coerce.number().int().min(0).max(6),
                startTime: z.string().regex(/^\d{2}:\d{2}$/),
                endTime: z.string().regex(/^\d{2}:\d{2}$/),
              })
              .refine((s) => s.startTime < s.endTime, 'End must be after start'),
          )
          .max(50),
      }),
      req.body,
    );
    const doctor = await prisma.user.findUnique({ where: { id: doctorId } });
    if (!doctor || doctor.role !== 'DOCTOR') throw notFound('Doctor not found');
    await prisma.$transaction([
      prisma.doctorSchedule.deleteMany({ where: { doctorId } }),
      prisma.doctorSchedule.createMany({ data: schedules.map((s) => ({ ...s, doctorId })) }),
    ]);
    await audit(req, 'DOCTOR_SCHEDULE_UPDATED', 'User', doctorId, { schedules });
    res.json(await prisma.doctorSchedule.findMany({ where: { doctorId }, orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }] }));
  }),
);

export default r;

