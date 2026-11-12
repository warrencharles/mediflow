import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { z } from 'zod';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { ah, badRequest, conflict, notFound, forbidden } from '../lib/errors.js';
import { parse, reqStr, optStr, money, idParam, pagination } from '../lib/validate.js';
import { audit, diff } from '../lib/audit.js';
import { localRange, isDateStr } from '../lib/time.js';
import { notify } from '../lib/notify.js';
import { recalcInvoice } from '../lib/billing.js';
import { requirePerm } from '../middleware/auth.js';

const r = Router();

const labDir = path.join(config.uploadDir, 'lab');
fs.mkdirSync(labDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: labDir,
    filename: (_req, file, cb) =>
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) =>
    /^(application\/pdf|image\/(jpeg|png|webp))$/.test(file.mimetype)
      ? cb(null, true)
      : cb(badRequest('Result document must be a PDF or image')),
});

const include = {
  patient: { select: { id: true, patientNumber: true, firstName: true, lastName: true, gender: true, dateOfBirth: true } },
  doctor: { select: { id: true, fullName: true } },
  labTest: true,
  resultEnteredBy: { select: { fullName: true } },
};

// ── Test catalogue ──

r.get(
  '/tests',
  requirePerm('lab.view', 'lab.request', 'lab.catalog'),
  ah(async (req, res) => {
    const where = req.query.active === 'all' ? {} : { isActive: true };
    res.json(await prisma.labTest.findMany({ where, orderBy: [{ category: 'asc' }, { name: 'asc' }] }));
  }),
);

const testBody = z.object({
  code: reqStr(20).transform((s) => s.toUpperCase()),
  name: reqStr(120),
  category: optStr(60),
  price: money,
  normalRange: optStr(200),
  unit: optStr(30),
  isActive: z.boolean().optional(),
});

r.post(
  '/tests',
  requirePerm('lab.catalog'),
  ah(async (req, res) => {
    const d = parse(testBody, req.body);
    if (await prisma.labTest.findUnique({ where: { code: d.code } })) throw conflict('A test with this code already exists');
    const t = await prisma.labTest.create({ data: { ...d, category: d.category ?? null, normalRange: d.normalRange ?? null, unit: d.unit ?? null } });
    await audit(req, 'LAB_TEST_CREATED', 'LabTest', t.id, d);
    res.status(201).json(t);
  }),
);

r.put(
  '/tests/:id',
  requirePerm('lab.catalog'),
  ah(async (req, res) => {
    const id = idParam(req.params.id);
    const d = parse(testBody, req.body);
    const before = await prisma.labTest.findUnique({ where: { id } });
    if (!before) throw notFound('Test not found');
    const data = { ...d, category: d.category ?? null, normalRange: d.normalRange ?? null, unit: d.unit ?? null };
    const t = await prisma.labTest.update({ where: { id }, data });
    await audit(req, 'LAB_TEST_UPDATED', 'LabTest', id, diff(before, data));
    res.json(t);
  }),
);

r.delete(
  '/tests/:id',
  requirePerm('lab.catalog'),
  ah(async (req, res) => {
    const id = idParam(req.params.id);
    const t = await prisma.labTest.findUnique({ where: { id } });
    if (!t) throw notFound('Test not found');
    const used = await prisma.labRequest.count({ where: { labTestId: id } });
    if (used > 0) {
      throw conflict(`Test "${t.name}" (${t.code}) has ${used} historical lab request(s) and cannot be deleted. Edit the test and uncheck Active instead.`);
    }
    await prisma.labTest.delete({ where: { id } });
    await audit(req, 'LAB_TEST_DELETED', 'LabTest', id, { code: t.code, name: t.name });
    res.json({ deleted: id });
  }),
);

// ── Requests ──

r.get(
  '/requests',
  requirePerm('lab.view'),
  ah(async (req, res) => {
    const { skip, take, page, pageSize } = pagination(req.query);
    const where = {};
    const status = String(req.query.status || 'OPEN');
    if (status === 'OPEN') where.status = { in: ['PENDING', 'IN_PROGRESS'] };
    else if (status !== 'ALL') where.status = status;
    if (req.query.mine === 'true') where.doctorId = req.user.id;
    if (req.query.patientId) where.patientId = Number(req.query.patientId);
    if (isDateStr(req.query.from)) {
      const { start, end } = localRange(req.query.from, isDateStr(req.query.to) ? req.query.to : req.query.from);
      where.createdAt = { gte: start, lt: end };
    }
    if (req.query.q) {
      const q = String(req.query.q);
      where.OR = [
        { requestNumber: { contains: q, mode: 'insensitive' } },
        { patient: { OR: [{ firstName: { contains: q, mode: 'insensitive' } }, { lastName: { contains: q, mode: 'insensitive' } }, { patientNumber: { contains: q, mode: 'insensitive' } }] } },
      ];
    }
    const [items, total] = await Promise.all([
      prisma.labRequest.findMany({ where, skip, take, include, orderBy: status === 'OPEN' ? [{ priority: 'desc' }, { createdAt: 'asc' }] : { createdAt: 'desc' } }),
      prisma.labRequest.count({ where }),
    ]);
    res.json({ items, total, page, pageSize });
  }),
);

r.get(
  '/requests/:id',
  requirePerm('lab.view'),
  ah(async (req, res) => {
    const lr = await prisma.labRequest.findUnique({ where: { id: idParam(req.params.id) }, include: { ...include, consultation: { select: { id: true, diagnosis: true } } } });
    if (!lr) throw notFound('Lab request not found');
    res.json(lr);
  }),
);

r.post(
  '/requests/:id/start',
  requirePerm('lab.results'),
  ah(async (req, res) => {
    const id = idParam(req.params.id);
    const lr = await prisma.labRequest.findUnique({ where: { id } });
    if (!lr) throw notFound('Lab request not found');
    if (lr.status !== 'PENDING') throw badRequest(`Request is already ${lr.status.toLowerCase()}`);
    const out = await prisma.labRequest.update({ where: { id }, data: { status: 'IN_PROGRESS' }, include });
    await audit(req, 'LAB_STARTED', 'LabRequest', id);
    res.json(out);
  }),
);

/** Enter results (optionally with a document) and mark the test completed. */
r.post(
  '/requests/:id/result',
  requirePerm('lab.results'),
  upload.single('file'),
  ah(async (req, res) => {
    const id = idParam(req.params.id);
    const body = { ...req.body, isAbnormal: req.body.isAbnormal === true || req.body.isAbnormal === 'true' };
    const d = parse(
      z.object({ result: reqStr(5000), resultValue: optStr(200), isAbnormal: z.boolean(), complete: z.any().optional() }),
      body,
    );
    const lr = await prisma.labRequest.findUnique({ where: { id }, include: { labTest: true, patient: true } });
    if (!lr) throw notFound('Lab request not found');
    if (lr.status === 'CANCELLED') throw badRequest('This request was cancelled');
    const amending = lr.status === 'COMPLETED';
    if (amending && !req.body.amendmentReason) throw badRequest('Validation failed', { amendmentReason: 'A reason is required to amend a completed result' });
    const data = {
      result: d.result,
      resultValue: d.resultValue ?? null,
      isAbnormal: d.isAbnormal,
      status: 'COMPLETED',
      resultEnteredById: req.user.id,
      resultEnteredAt: new Date(),
      ...(req.file ? { resultFilePath: req.file.filename, resultFileName: req.file.originalname.slice(0, 200) } : {}),
    };
    const out = await prisma.labRequest.update({ where: { id }, data, include });
    await audit(req, amending ? 'LAB_RESULT_AMENDED' : 'LAB_RESULT_ENTERED', 'LabRequest', id, {
      changes: diff(lr, { result: data.result, resultValue: data.resultValue, isAbnormal: data.isAbnormal }),
      file: req.file?.originalname,
      amendmentReason: req.body.amendmentReason,
    });
    await notify({
      userId: lr.doctorId,
      title: d.isAbnormal ? 'ABNORMAL lab result' : 'Lab result ready',
      message: `${lr.labTest.name} for ${lr.patient.firstName} ${lr.patient.lastName} (${lr.requestNumber})`,
      link: lr.consultationId ? `/consultations/${lr.consultationId}` : `/lab/${id}`,
    });
    res.json(out);
  }),
);

r.get(
  '/requests/:id/file',
  requirePerm('lab.view'),
  ah(async (req, res) => {
    const lr = await prisma.labRequest.findUnique({ where: { id: idParam(req.params.id) } });
    if (!lr?.resultFilePath) throw notFound('No document attached');
    res.setHeader('Content-Disposition', `inline; filename="${(lr.resultFileName || 'result').replace(/"/g, '')}"`);
    res.sendFile(path.join(labDir, path.basename(lr.resultFilePath)));
  }),
);

r.post(
  '/requests/:id/cancel',
  requirePerm('lab.request', 'lab.results'),
  ah(async (req, res) => {
    const id = idParam(req.params.id);
    const { reason } = parse(z.object({ reason: z.string().trim().min(3, 'Give a reason') }), req.body);
    const out = await prisma.$transaction(async (tx) => {
      const lr = await tx.labRequest.findUnique({ where: { id } });
      if (!lr) throw notFound('Lab request not found');
      if (lr.status === 'COMPLETED' || lr.status === 'CANCELLED') throw badRequest(`Request is already ${lr.status.toLowerCase()}`);
      if (req.user.role === 'DOCTOR' && lr.doctorId !== req.user.id) throw forbidden('Only the requesting doctor can cancel');
      const u = await tx.labRequest.update({ where: { id }, data: { status: 'CANCELLED', cancelReason: reason }, include });
      // Remove the unperformed test from the bill (voided, not deleted).
      const items = await tx.invoiceItem.findMany({ where: { sourceType: 'LabRequest', sourceId: id, voided: false } });
      for (const it of items) {
        await tx.invoiceItem.update({ where: { id: it.id }, data: { voided: true, voidReason: `Lab request cancelled: ${reason}` } });
        await recalcInvoice(it.invoiceId, tx);
      }
      await audit(req, 'LAB_CANCELLED', 'LabRequest', id, { reason }, tx);
      return u;
    });
    res.json(out);
  }),
);

r.post(
  '/requests/:id/reopen',
  requirePerm('lab.request', 'lab.results'),
  ah(async (req, res) => {
    const id = idParam(req.params.id);
    const { reason } = parse(z.object({ reason: optStr(300) }), req.body || {});
    const out = await prisma.$transaction(async (tx) => {
      const lr = await tx.labRequest.findUnique({ where: { id } });
      if (!lr) throw notFound('Lab request not found');
      if (lr.status === 'PENDING') return tx.labRequest.findUnique({ where: { id }, include });
      if (req.user.role === 'DOCTOR' && lr.doctorId !== req.user.id) throw forbidden('Only the requesting doctor or lab staff can reopen');
      const u = await tx.labRequest.update({
        where: { id },
        data: { status: 'PENDING', cancelReason: null },
        include,
      });
      if (lr.status === 'CANCELLED') {
        const items = await tx.invoiceItem.findMany({ where: { sourceType: 'LabRequest', sourceId: id, voided: true }, include: { invoice: true } });
        for (const it of items) {
          if (it.invoice.status !== 'CANCELLED') {
            await tx.invoiceItem.update({ where: { id: it.id }, data: { voided: false, voidReason: null } });
            await recalcInvoice(it.invoiceId, tx);
          }
        }
      }
      await audit(req, 'LAB_REOPENED', 'LabRequest', id, { from: lr.status, to: 'PENDING', reason }, tx);
      return u;
    });
    res.json(out);
  }),
);

export default r;

