import crypto from 'node:crypto';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { can, permissionsFor } from '../lib/permissions.js';
import { unauthorized, forbidden } from '../lib/errors.js';

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const randomToken = () => crypto.randomBytes(32).toString('base64url');

/**
 * Sessions are opaque random tokens. Only the SHA-256 hash is stored, so a DB
 * leak does not expose usable tokens. Sent as an httpOnly SameSite=Strict cookie
 * (browser) or as "Authorization: Bearer <token>" (API clients).
 */
export async function createSession(user, req) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + config.session.absoluteHours * 3600 * 1000);
  await prisma.session.create({
    data: {
      id: sha256(token),
      userId: user.id,
      ip: req.ip,
      userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
      expiresAt,
    },
  });
  return { token, expiresAt };
}

export function setSessionCookie(res, token, expiresAt) {
  res.cookie(config.session.cookieName, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.session.secureCookie,
    expires: expiresAt,
    path: '/',
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(config.session.cookieName, { path: '/' });
}

function readToken(req) {
  const h = req.headers.authorization;
  if (h && h.startsWith('Bearer ')) return h.slice(7).trim();
  return req.cookies?.[config.session.cookieName] || null;
}

/** Populates req.user / req.session when a valid session exists. */
export async function loadSession(req, _res, next) {
  try {
    const token = readToken(req);
    if (!token) return next();
    const id = sha256(token);
    const session = await prisma.session.findUnique({ where: { id }, include: { user: true } });
    if (!session || session.revokedAt) return next();
    const now = Date.now();
    const idleLimit = session.lastSeenAt.getTime() + config.session.idleMinutes * 60 * 1000;
    if (session.expiresAt.getTime() < now || idleLimit < now || !session.user.isActive) {
      if (!session.revokedAt) {
        await prisma.session.update({ where: { id }, data: { revokedAt: new Date() } });
      }
      return next();
    }
    // Throttle "last seen" writes to once a minute.
    if (now - session.lastSeenAt.getTime() > 60 * 1000) {
      await prisma.session.update({ where: { id }, data: { lastSeenAt: new Date() } });
    }
    const { passwordHash, ...user } = session.user;
    req.user = user;
    req.session = { id: session.id };
    return next();
  } catch (e) {
    return next(e);
  }
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(unauthorized('Your session has expired. Please log in again.'));
  // Users with a temporary password may only change their password.
  if (req.user.mustChangePassword && !req.path.startsWith('/auth')) {
    return next(forbidden('You must change your temporary password before continuing.'));
  }
  return next();
}

/** Route guard: user must hold at least one of the given permissions. */
export const requirePerm =
  (...perms) =>
    (req, _res, next) => {
      if (!req.user) return next(unauthorized());
      if (perms.some((p) => can(req.user.role, p))) return next();
      // Log denied attempts – useful for security review.
      prisma.auditLog
        .create({
          data: {
            userId: req.user.id,
            action: 'ACCESS_DENIED',
            entity: 'Route',
            entityId: `${req.method} ${req.originalUrl}`.slice(0, 190),
            details: { required: perms, role: req.user.role },
            ip: req.ip,
          },
        })
        .catch(() => { });
      return next(forbidden());
    };

export const hasPerm = (req, perm) => can(req.user?.role, perm);

export const publicUser = (u) => ({
  id: u.id,
  fullName: u.fullName,
  email: u.email,
  phone: u.phone,
  role: u.role,
  isActive: u.isActive,
  mustChangePassword: u.mustChangePassword,
  lastLoginAt: u.lastLoginAt,
  createdAt: u.createdAt,
  permissions: permissionsFor(u.role),
});

