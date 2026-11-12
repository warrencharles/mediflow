import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { ah, unauthorized, badRequest } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { audit } from '../lib/audit.js';
import { sendMail } from '../lib/mailer.js';
import {
  createSession,
  setSessionCookie,
  clearSessionCookie,
  publicUser,
  sha256,
  randomToken,
} from '../middleware/auth.js';

const r = Router();

export const passwordSchema = z
  .string()
  .min(8, 'At least 8 characters')
  .max(100)
  .regex(/[A-Za-z]/, 'Must contain a letter')
  .regex(/[0-9]/, 'Must contain a number');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.isTest ? 10000 : 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait a few minutes and try again.' },
});

r.post(
  '/login',
  limiter,
  ah(async (req, res) => {
    const { email, password } = parse(
      z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1) }),
      req.body,
    );
    const user = await prisma.user.findUnique({ where: { email } });
    const fail = async (reason) => {
      await audit(req, 'LOGIN_FAILED', 'User', user?.id, { email, reason });
      throw unauthorized('Invalid email or password');
    };
    if (!user) return fail('unknown email');
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await audit(req, 'LOGIN_FAILED', 'User', user.id, { email, reason: 'locked' });
      throw unauthorized(`Account temporarily locked after repeated failed logins. Try again after ${user.lockedUntil.toISOString()}.`);
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      const failed = user.failedLogins + 1;
      const lock = failed >= config.security.maxFailedLogins;
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLogins: lock ? 0 : failed,
          lockedUntil: lock ? new Date(Date.now() + config.security.lockMinutes * 60000) : null,
        },
      });
      return fail('wrong password');
    }
    if (!user.isActive) {
      await audit(req, 'LOGIN_FAILED', 'User', user.id, { email, reason: 'inactive' });
      throw unauthorized('This account has been deactivated. Contact the administrator.');
    }
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    const { token, expiresAt } = await createSession(user, req);
    setSessionCookie(res, token, expiresAt);
    req.user = updated;
    await audit(req, 'LOGIN', 'User', user.id);
    res.json({ user: publicUser(updated), token, expiresAt });
  }),
);

r.post(
  '/logout',
  ah(async (req, res) => {
    if (req.session) {
      await prisma.session.update({ where: { id: req.session.id }, data: { revokedAt: new Date() } });
      await audit(req, 'LOGOUT', 'User', req.user.id);
    }
    clearSessionCookie(res);
    res.json({ ok: true });
  }),
);

r.get(
  '/me',
  ah(async (req, res) => {
    if (!req.user) throw unauthorized();
    res.json({ user: publicUser(req.user) });
  }),
);

r.post(
  '/forgot-password',
  limiter,
  ah(async (req, res) => {
    const { email } = parse(z.object({ email: z.string().trim().toLowerCase().email() }), req.body);
    const user = await prisma.user.findUnique({ where: { email } });
    if (user && user.isActive) {
      const token = randomToken();
      await prisma.passwordReset.create({
        data: {
          userId: user.id,
          tokenHash: sha256(token),
          expiresAt: new Date(Date.now() + config.security.resetTokenMinutes * 60000),
        },
      });
      const link = `${config.appUrl}/reset-password?token=${token}`;
      await sendMail({
        to: user.email,
        subject: 'MediFlow password reset',
        text: `Hello ${user.fullName},\n\nA password reset was requested for your MediFlow account.\nOpen this link within ${config.security.resetTokenMinutes} minutes to choose a new password:\n\n${link}\n\nIf you did not request this, ignore this email.`,
      });
      await audit(req, 'PASSWORD_RESET_REQUESTED', 'User', user.id);
    }
    // Same response whether or not the account exists (prevents user enumeration).
    res.json({ ok: true, message: 'If that email is registered, a reset link has been sent.' });
  }),
);

r.post(
  '/reset-password',
  limiter,
  ah(async (req, res) => {
    const { token, password } = parse(z.object({ token: z.string().min(10), password: passwordSchema }), req.body);
    const pr = await prisma.passwordReset.findUnique({ where: { tokenHash: sha256(token) } });
    if (!pr || pr.usedAt || pr.expiresAt < new Date()) throw badRequest('This reset link is invalid or has expired.');
    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.$transaction([
      prisma.user.update({
        where: { id: pr.userId },
        data: { passwordHash, mustChangePassword: false, failedLogins: 0, lockedUntil: null },
      }),
      prisma.passwordReset.update({ where: { id: pr.id }, data: { usedAt: new Date() } }),
      prisma.session.updateMany({ where: { userId: pr.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await audit({ ip: req.ip, user: { id: pr.userId } }, 'PASSWORD_RESET', 'User', pr.userId);
    res.json({ ok: true });
  }),
);

r.post(
  '/change-password',
  ah(async (req, res) => {
    if (!req.user) throw unauthorized();
    const { currentPassword, newPassword } = parse(
      z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema }),
      req.body,
    );
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
      throw badRequest('Validation failed', { currentPassword: 'Current password is incorrect' });
    }
    if (currentPassword === newPassword) {
      throw badRequest('Validation failed', { newPassword: 'New password must be different' });
    }
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(newPassword, 10), mustChangePassword: false },
    });
    // Sign out every other session.
    await prisma.session.updateMany({
      where: { userId: user.id, revokedAt: null, id: { not: req.session.id } },
      data: { revokedAt: new Date() },
    });
    await audit(req, 'PASSWORD_CHANGED', 'User', user.id);
    res.json({ user: publicUser(updated) });
  }),
);

r.get(
  '/sessions',
  ah(async (req, res) => {
    if (!req.user) throw unauthorized();
    const sessions = await prisma.session.findMany({
      where: { userId: req.user.id, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: 'desc' },
      select: { id: true, ip: true, userAgent: true, createdAt: true, lastSeenAt: true, expiresAt: true },
    });
    res.json(sessions.map((s) => ({ ...s, id: s.id.slice(0, 12), current: s.id === req.session.id })));
  }),
);

export default r;

