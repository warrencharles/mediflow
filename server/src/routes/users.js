import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../db.js';
import { ah, badRequest, conflict, notFound } from '../lib/errors.js';
import { parse, reqStr, optPhone, idParam, pagination } from '../lib/validate.js';
import { audit, diff } from '../lib/audit.js';
import { ROLES } from '../lib/permissions.js';
import { requirePerm, publicUser } from '../middleware/auth.js';
import { passwordSchema } from './auth.js';

const r = Router();

const tempPassword = () => `Mf${crypto.randomBytes(4).toString('hex')}9`;

// Lightweight staff directory (e.g. doctor pickers) – any signed-in user.
r.get(
  '/directory',
  ah(async (req, res) => {
    const where = { isActive: true };
    if (req.query.role) where.role = String(req.query.role);
    const users = await prisma.user.findMany({
      where,
      orderBy: { fullName: 'asc' },
      select: { id: true, fullName: true, role: true },
    });
    res.json(users);
  }),
);

r.use(requirePerm('users.manage'));

r.get(
  '/',
  ah(async (req, res) => {
    const { skip, take, page, pageSize } = pagination(req.query);
    const where = {};
    if (req.query.role) where.role = String(req.query.role);
    if (req.query.status === 'active') where.isActive = true;
    if (req.query.status === 'inactive') where.isActive = false;
    if (req.query.q) {
      const q = String(req.query.q);
      where.OR = [
        { fullName: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
      ];
    }
    const [items, total] = await Promise.all([
      prisma.user.findMany({ where, skip, take, orderBy: { fullName: 'asc' } }),
      prisma.user.count({ where }),
    ]);
    res.json({ items: items.map(publicUser), total, page, pageSize });
  }),
);

const userBody = z.object({
  fullName: reqStr(120),
  email: z.string().trim().toLowerCase().email(),
  phone: optPhone,
  role: z.enum(ROLES),
  password: passwordSchema.optional(),
});

r.post(
  '/',
  ah(async (req, res) => {
    const data = parse(userBody, req.body);
    if (await prisma.user.findUnique({ where: { email: data.email } })) {
      throw conflict('A user with this email already exists');
    }
    const password = data.password || tempPassword();
    const user = await prisma.user.create({
      data: {
        fullName: data.fullName,
        email: data.email,
        phone: data.phone ?? null,
        role: data.role,
        passwordHash: await bcrypt.hash(password, 10),
        mustChangePassword: true,
      },
    });
    await audit(req, 'USER_CREATED', 'User', user.id, { email: user.email, role: user.role });
    // The temporary password is returned once so the admin can hand it over.
    res.status(201).json({ user: publicUser(user), temporaryPassword: password });
  }),
);

r.get(
  '/:id',
  ah(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: idParam(req.params.id) } });
    if (!user) throw notFound('User not found');
    res.json(publicUser(user));
  }),
);

r.put(
  '/:id',
  ah(async (req, res) => {
    const id = idParam(req.params.id);
    const data = parse(userBody.omit({ password: true }), req.body);
    const before = await prisma.user.findUnique({ where: { id } });
    if (!before) throw notFound('User not found');
    const dupe = await prisma.user.findFirst({ where: { email: data.email, id: { not: id } } });
    if (dupe) throw conflict('A user with this email already exists');
    if (id === req.user.id && data.role !== before.role) throw badRequest('You cannot change your own role');
    const user = await prisma.user.update({
      where: { id },
      data: { fullName: data.fullName, email: data.email, phone: data.phone ?? null, role: data.role },
    });
    await audit(req, 'USER_UPDATED', 'User', id, diff(before, data));
    if (before.role !== user.role) {
      await prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    res.json(publicUser(user));
  }),
);

r.post(
  '/:id/status',
  ah(async (req, res) => {
    const id = idParam(req.params.id);
    const { isActive } = parse(z.object({ isActive: z.boolean() }), req.body);
    if (id === req.user.id && !isActive) throw badRequest('You cannot deactivate your own account');
    const user = await prisma.user.update({ where: { id }, data: { isActive } }).catch(() => null);
    if (!user) throw notFound('User not found');
    if (!isActive) {
      await prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    await audit(req, isActive ? 'USER_ACTIVATED' : 'USER_DEACTIVATED', 'User', id);
    res.json(publicUser(user));
  }),
);

r.post(
  '/:id/reset-password',
  ah(async (req, res) => {
    const id = idParam(req.params.id);
    const password = tempPassword();
    const user = await prisma.user
      .update({
        where: { id },
        data: { passwordHash: await bcrypt.hash(password, 10), mustChangePassword: true, failedLogins: 0, lockedUntil: null },
      })
      .catch(() => null);
    if (!user) throw notFound('User not found');
    await prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    await audit(req, 'USER_PASSWORD_RESET_BY_ADMIN', 'User', id);
    res.json({ temporaryPassword: password });
  }),
);

r.get(
  '/:id/sessions',
  ah(async (req, res) => {
    const sessions = await prisma.session.findMany({
      where: { userId: idParam(req.params.id) },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json(
      sessions.map((s) => ({
        id: s.id,
        ip: s.ip,
        userAgent: s.userAgent,
        createdAt: s.createdAt,
        lastSeenAt: s.lastSeenAt,
        expiresAt: s.expiresAt,
        revokedAt: s.revokedAt,
        active: !s.revokedAt && s.expiresAt > new Date(),
      })),
    );
  }),
);

r.post(
  '/:id/sessions/revoke',
  ah(async (req, res) => {
    const id = idParam(req.params.id);
    const { count } = await prisma.session.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await audit(req, 'USER_SESSIONS_REVOKED', 'User', id, { count });
    res.json({ revoked: count });
  }),
);

r.delete(
  '/:id',
  ah(async (req, res) => {
    const id = idParam(req.params.id);
    if (id === req.user.id) throw badRequest('You cannot delete your own account');
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw notFound('User not found');
    const [consultations, appointments, visits, dispensations, payments, labResults] = await Promise.all([
      prisma.consultation.count({ where: { doctorId: id } }),
      prisma.appointment.count({ where: { OR: [{ doctorId: id }, { createdById: id }] } }),
      prisma.visit.count({ where: { OR: [{ assignedDoctorId: id }, { checkedInById: id }] } }),
      prisma.dispensation.count({ where: { pharmacistId: id } }),
      prisma.payment.count({ where: { receivedById: id } }),
      prisma.labRequest.count({ where: { OR: [{ doctorId: id }, { resultEnteredById: id }] } }),
    ]);
    const totalLinked = consultations + appointments + visits + dispensations + payments + labResults;
    if (totalLinked > 0) {
      throw conflict(
        `${user.fullName} has ${totalLinked} historical medical/financial record(s) and cannot be permanently deleted. Deactivate their account instead to preserve the clinic audit trail.`,
      );
    }
    await prisma.$transaction([
      prisma.session.deleteMany({ where: { userId: id } }),
      prisma.passwordReset.deleteMany({ where: { userId: id } }),
      prisma.doctorSchedule.deleteMany({ where: { doctorId: id } }),
      prisma.notification.deleteMany({ where: { userId: id } }),
      prisma.auditLog.updateMany({ where: { userId: id }, data: { userId: null } }),
      prisma.user.delete({ where: { id } }),
    ]);
    await audit(req, 'USER_DELETED', 'User', id, { fullName: user.fullName, email: user.email, role: user.role });
    res.json({ deleted: id });
  }),
);

export default r;

