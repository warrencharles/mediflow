import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { z } from 'zod';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { ah, badRequest, conflict, notFound } from '../lib/errors.js';
import { parse, reqStr, optStr, dateStr, phone, optPhone, idParam, pagination, normalizePhone } from '../lib/validate.js';
import { audit, diff } from '../lib/audit.js';
import { nextPatientNumber } from '../lib/counters.js';
import { requirePerm, hasPerm } from '../middleware/auth.js';

const r = Router();

const photoDir = path.join(config.uploadDir, 'photos');
fs.mkdirSync(photoDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: photoDir,
    filename: (_req, file, cb) =>
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) =>
    /^image\/(jpeg|png|webp)$/.test(file.mimetype) ? cb(null, true) : cb(badRequest('Photo must be JPG, PNG or WEBP')),
});

const patientBody = z.object({
  firstName: reqStr(60),
  middleName: optStr(60),
  lastName: reqStr(60),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']),
  dateOfBirth: dateStr.refine((d) => new Date(d) <= new Date() && new Date(d) > new Date('1900-01-01'), 'Invalid date of birth'),
  phone,
  altPhone: optPhone,
  email: z.preprocess((v) => (v === '' ? undefined : v), z.string().trim().email().optional().nullable()),
  address: reqStr(300),
  region: optStr(60),
  nationalId: optStr(40),
  occupation: optStr(80),
  bloodGroup: z.preprocess((v) => (v === '' ? undefined : v), z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']).optional().nullable()),
  emergencyName: reqStr(120),
  emergencyPhone: phone,
  emergencyRelation: optStr(60),
  medicalHistory: optStr(5000),
  allergies: optStr(2000),
  chronicConditions: optStr(2000),
});

const toData = (d) => ({
  ...d,
  dateOfBirth: new Date(d.dateOfBirth),
  middleName: d.middleName ?? null,
  altPhone: d.altPhone ?? null,
  email: d.email ?? null,
  region: d.region ?? null,
  nationalId: d.nationalId ?? null,
  occupation: d.occupation ?? null,
  bloodGroup: d.bloodGroup ?? null,
  emergencyRelation: d.emergencyRelation ?? null,
  medicalHistory: d.medicalHistory ?? null,
  allergies: d.allergies ?? null,
  chronicConditions: d.chronicConditions ?? null,
});

/** Same national ID, same name + DOB, or same phone + same first/last name. */
async function findDuplicates(d, excludeId) {
  const or = [
    {
      firstName: { equals: d.firstName, mode: 'insensitive' },
      lastName: { equals: d.lastName, mode: 'insensitive' },
      dateOfBirth: new Date(d.dateOfBirth),
    },
    { phone: d.phone, firstName: { equals: d.firstName, mode: 'insensitive' } },
    { phone: d.phone, lastName: { equals: d.lastName, mode: 'insensitive' } },
  ];
  if (d.nationalId) or.push({ nationalId: d.nationalId });
  return prisma.patient.findMany({
    where: { OR: or, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true, patientNumber: true, firstName: true, lastName: true, phone: true, dateOfBirth: true, status: true },
    take: 10,
  });
}

const listSelect = {
  id: true,
  patientNumber: true,
  firstName: true,
  middleName: true,
  lastName: true,
  gender: true,
  dateOfBirth: true,
  phone: true,
  address: true,
  status: true,
  photoPath: true,
  possibleDuplicateOf: true,
  createdAt: true,
};

r.get(
  '/',
  requirePerm('patients.view'),
  ah(async (req, res) => {
    const { skip, take, page, pageSize } = pagination(req.query);
    const where = {};
    const q = String(req.query.q || '').trim();
    if (q) {
      const terms = q.split(/\s+/).filter(Boolean);
      const digits = q.replace(/[^0-9]/g, '');
      const or = [
        { patientNumber: { contains: q, mode: 'insensitive' } },
        // every word must match some part of the name
        {
          AND: terms.map((t) => ({
            OR: [
              { firstName: { contains: t, mode: 'insensitive' } },
              { middleName: { contains: t, mode: 'insensitive' } },
              { lastName: { contains: t, mode: 'insensitive' } },
            ],
          })),
        },
      ];
      if (digits.length >= 4) {
        const tail = digits.startsWith('0') ? digits.slice(1) : digits.startsWith('255') ? digits.slice(3) : digits;
        or.push({ phone: { contains: tail } }, { altPhone: { contains: tail } });
      }
      where.OR = or;
    }
    if (req.query.status) where.status = String(req.query.status);
    const [items, total] = await Promise.all([
      prisma.patient.findMany({ where, skip, take, orderBy: { createdAt: 'desc' }, select: listSelect }),
      prisma.patient.count({ where }),
    ]);
    res.json({ items, total, page, pageSize });
  }),
);

r.post(
  '/check-duplicates',
  requirePerm('patients.write'),
  ah(async (req, res) => {
    const d = parse(
      z.object({ firstName: reqStr(), lastName: reqStr(), dateOfBirth: dateStr, phone, nationalId: optStr(40) }),
      req.body,
    );
    res.json(await findDuplicates(d));
  }),
);

r.post(
  '/',
  requirePerm('patients.write'),
  ah(async (req, res) => {
    const d = parse(patientBody, req.body);
    const { confirmDuplicate, duplicateReason } = req.body || {};
    const dupes = await findDuplicates(d);
    if (dupes.length && !confirmDuplicate) {
      throw conflict('A patient with matching details already exists. Review the matches before registering.', {
        duplicates: dupes,
      });
    }
    if (dupes.length && (!duplicateReason || String(duplicateReason).trim().length < 5)) {
      throw badRequest('Validation failed', { duplicateReason: 'Explain why this is not the same patient' });
    }
    const patient = await prisma.$transaction(async (tx) => {
      const patientNumber = await nextPatientNumber(tx);
      const p = await tx.patient.create({
        data: { ...toData(d), patientNumber, createdById: req.user.id, possibleDuplicateOf: dupes[0]?.id ?? null },
      });
      await audit(
        req,
        'PATIENT_REGISTERED',
        'Patient',
        p.id,
        { patientNumber, ...(dupes.length ? { flaggedDuplicateOf: dupes.map((x) => x.patientNumber), duplicateReason } : {}) },
        tx,
      );
      return p;
    });
    res.status(201).json(patient);
  }),
);

r.get(
  '/:id',
  requirePerm('patients.view'),
  ah(async (req, res) => {
    const id = idParam(req.params.id);
    const p = await prisma.patient.findUnique({
      where: { id },
      include: { createdBy: { select: { fullName: true } } },
    });
    if (!p) throw notFound('Patient not found');
    let duplicateOf = null;
    if (p.possibleDuplicateOf) {
      duplicateOf = await prisma.patient.findUnique({
        where: { id: p.possibleDuplicateOf },
        select: { id: true, patientNumber: true, firstName: true, lastName: true },
      });
    }
    // Summary counts that every patient-viewer may see
    const [visits, appointments, lastVisit] = await Promise.all([
      prisma.visit.count({ where: { patientId: id } }),
      prisma.appointment.count({ where: { patientId: id } }),
      prisma.visit.findFirst({ where: { patientId: id }, orderBy: { checkedInAt: 'desc' }, select: { checkedInAt: true } }),
    ]);
    let balance = null;
    if (hasPerm(req, 'billing.view')) {
      const agg = await prisma.invoice.aggregate({
        where: { patientId: id, status: { in: ['UNPAID', 'PARTIALLY_PAID'] } },
        _sum: { balance: true },
      });
      balance = agg._sum.balance || 0;
    }
    res.json({ ...p, duplicateOf, stats: { visits, appointments, lastVisitAt: lastVisit?.checkedInAt ?? null, outstandingBalance: balance } });
  }),
);

r.put(
  '/:id',
  requirePerm('patients.write'),
  ah(async (req, res) => {
    const id = idParam(req.params.id);
    const d = parse(patientBody, req.body);
    const before = await prisma.patient.findUnique({ where: { id } });
    if (!before) throw notFound('Patient not found');
    const data = toData(d);
    const p = await prisma.patient.update({ where: { id }, data });
    await audit(req, 'PATIENT_UPDATED', 'Patient', id, diff(before, data));
    res.json(p);
  }),
);

r.post(
  '/:id/status',
  requirePerm('patients.write'),
  ah(async (req, res) => {
    const id = idParam(req.params.id);
    const { status, reason } = parse(z.object({ status: z.enum(['ACTIVE', 'INACTIVE']), reason: optStr(300) }), req.body);
    const p = await prisma.patient.update({ where: { id }, data: { status } }).catch(() => null);
    if (!p) throw notFound('Patient not found');
    await audit(req, 'PATIENT_STATUS_CHANGED', 'Patient', id, { status, reason });
    res.json(p);
  }),
);

r.post(
  '/:id/clear-duplicate-flag',
  requirePerm('patients.write'),
  ah(async (req, res) => {
    const id = idParam(req.params.id);
    const p = await prisma.patient.update({ where: { id }, data: { possibleDuplicateOf: null } });
    await audit(req, 'PATIENT_DUPLICATE_FLAG_CLEARED', 'Patient', id);
    res.json(p);
  }),
);

r.delete(
  '/:id',
  requirePerm('patients.write'),
  ah(async (req, res) => {
    const id = idParam(req.params.id);
    const p = await prisma.patient.findUnique({ where: { id } });
    if (!p) throw notFound('Patient not found');
    const [visits, appointments, consultations, prescriptions, labs, invoices] = await Promise.all([
      prisma.visit.count({ where: { patientId: id } }),
      prisma.appointment.count({ where: { patientId: id } }),
      prisma.consultation.count({ where: { patientId: id } }),
      prisma.prescription.count({ where: { patientId: id } }),
      prisma.labRequest.count({ where: { patientId: id } }),
      prisma.invoice.count({ where: { patientId: id } }),
    ]);
    const totalHistory = visits + appointments + consultations + prescriptions + labs + invoices;
    if (totalHistory > 0) {
      throw conflict(
        `Patient ${p.patientNumber} has ${totalHistory} clinical/financial record(s) and cannot be permanently deleted. Mark the patient Inactive instead so medical and billing history is preserved.`,
      );
    }
    await prisma.patient.delete({ where: { id } });
    await audit(req, 'PATIENT_DELETED', 'Patient', id, { patientNumber: p.patientNumber, name: `${p.firstName} ${p.lastName}` });
    res.json({ deleted: id });
  }),
);

r.post(
  '/:id/photo',
  requirePerm('patients.write'),
  upload.single('photo'),
  ah(async (req, res) => {
    const id = idParam(req.params.id);
    if (!req.file) throw badRequest('No photo uploaded');
    const before = await prisma.patient.findUnique({ where: { id } });
    if (!before) {
      fs.unlink(req.file.path, () => {});
      throw notFound('Patient not found');
    }
    const p = await prisma.patient.update({ where: { id }, data: { photoPath: req.file.filename } });
    await audit(req, 'PATIENT_PHOTO_UPDATED', 'Patient', id);
    res.json(p);
  }),
);

r.get(
  '/:id/photo',
  requirePerm('patients.view'),
  ah(async (req, res) => {
    const p = await prisma.patient.findUnique({ where: { id: idParam(req.params.id) }, select: { photoPath: true } });
    if (!p?.photoPath) throw notFound('No photo');
    res.sendFile(path.join(photoDir, path.basename(p.photoPath)));
  }),
);

// ── Patient history sections (each guarded by its own permission) ──

r.get(
  '/:id/visits',
  requirePerm('patients.view'),
  ah(async (req, res) => {
    const visits = await prisma.visit.findMany({
      where: { patientId: idParam(req.params.id) },
      orderBy: { checkedInAt: 'desc' },
      take: 100,
      include: { assignedDoctor: { select: { fullName: true } } },
    });
    res.json(visits);
  }),
);

r.get(
  '/:id/appointments',
  requirePerm('appointments.view'),
  ah(async (req, res) => {
    res.json(
      await prisma.appointment.findMany({
        where: { patientId: idParam(req.params.id) },
        orderBy: { startAt: 'desc' },
        take: 100,
        include: { doctor: { select: { id: true, fullName: true } } },
      }),
    );
  }),
);

r.get(
  '/:id/vitals',
  requirePerm('vitals.write', 'consultations.view'),
  ah(async (req, res) => {
    res.json(
      await prisma.vitals.findMany({
        where: { patientId: idParam(req.params.id) },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: { recordedBy: { select: { fullName: true } } },
      }),
    );
  }),
);

r.get(
  '/:id/consultations',
  requirePerm('consultations.view'),
  ah(async (req, res) => {
    const id = idParam(req.params.id);
    const items = await prisma.consultation.findMany({
      where: { patientId: id },
      orderBy: { startedAt: 'desc' },
      include: {
        doctor: { select: { id: true, fullName: true } },
        prescriptions: { include: { items: { include: { medicine: { select: { name: true } } } } } },
        labRequests: { include: { labTest: { select: { name: true } } } },
        visit: { include: { vitals: { orderBy: { createdAt: 'desc' }, take: 1 } } },
      },
    });
    await audit(req, 'MEDICAL_HISTORY_VIEWED', 'Patient', id);
    res.json(items);
  }),
);

r.get(
  '/:id/prescriptions',
  requirePerm('prescriptions.view'),
  ah(async (req, res) => {
    res.json(
      await prisma.prescription.findMany({
        where: { patientId: idParam(req.params.id) },
        orderBy: { createdAt: 'desc' },
        include: {
          doctor: { select: { fullName: true } },
          items: { include: { medicine: { select: { name: true, unit: true } } } },
        },
      }),
    );
  }),
);

r.get(
  '/:id/lab-requests',
  requirePerm('lab.view'),
  ah(async (req, res) => {
    res.json(
      await prisma.labRequest.findMany({
        where: { patientId: idParam(req.params.id) },
        orderBy: { createdAt: 'desc' },
        include: { labTest: true, doctor: { select: { fullName: true } } },
      }),
    );
  }),
);

r.get(
  '/:id/invoices',
  requirePerm('billing.view'),
  ah(async (req, res) => {
    res.json(
      await prisma.invoice.findMany({
        where: { patientId: idParam(req.params.id) },
        orderBy: { createdAt: 'desc' },
        include: { payments: { orderBy: { paidAt: 'desc' } } },
      }),
    );
  }),
);

export { normalizePhone };
export default r;

