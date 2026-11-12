import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { ah, badRequest, notFound } from '../lib/errors.js';
import { parse, pagination, idParam } from '../lib/validate.js';
import { localRange, isDateStr } from '../lib/time.js';
import { audit } from '../lib/audit.js';
import { sendReport } from '../lib/export.js';
import { requirePerm } from '../middleware/auth.js';
import { runBackup, listBackups } from '../../scripts/backup.js';
import { sendSms } from '../lib/sms.js';
import { phone, reqStr } from '../lib/validate.js';

const r = Router();

// ── Immutable Audit Log Guard ──
r.all('/audit/:id', (req, res) => {
  res.status(403).json({ error: 'Audit logs are immutable legal records and cannot be modified or deleted by any user or administrator.' });
});

// ── Audit / activity log ──
r.get(
  '/audit',
  requirePerm('audit.view'),
  ah(async (req, res) => {
    const { skip, take, page, pageSize } = pagination(req.query);
    const where = {};
    if (req.query.userId) where.userId = Number(req.query.userId);
    if (req.query.entity) where.entity = String(req.query.entity);
    if (req.query.entityId) where.entityId = String(req.query.entityId);
    if (req.query.action) where.action = { contains: String(req.query.action), mode: 'insensitive' };
    if (isDateStr(req.query.from)) {
      const { start, end } = localRange(req.query.from, isDateStr(req.query.to) ? req.query.to : req.query.from);
      where.createdAt = { gte: start, lt: end };
    }
    if (req.query.format) {
      const rows = await prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: 5000, include: { user: { select: { fullName: true, role: true } } } });
      return sendReport(res, req.query.format, {
        title: 'Activity Log',
        columns: [
          { key: 'createdAt', label: 'Time (UTC)', width: 90 },
          { key: 'user', label: 'User', width: 100 },
          { key: 'action', label: 'Action', width: 120 },
          { key: 'entity', label: 'Record', width: 90 },
          { key: 'ip', label: 'IP', width: 70 },
          { key: 'details', label: 'Details', width: 200 },
        ],
        rows: rows.map((x) => ({
          createdAt: x.createdAt.toISOString().replace('T', ' ').slice(0, 19),
          user: x.user ? `${x.user.fullName} (${x.user.role})` : 'system',
          action: x.action,
          entity: `${x.entity} ${x.entityId || ''}`,
          ip: x.ip || '',
          details: x.details ? JSON.stringify(x.details).slice(0, 300) : '',
        })),
      });
    }
    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({ where, skip, take, orderBy: { createdAt: 'desc' }, include: { user: { select: { fullName: true, role: true } } } }),
      prisma.auditLog.count({ where }),
    ]);
    res.json({ items, total, page, pageSize });
  }),
);

// ── Notifications (any signed-in user) ──
r.get(
  '/notifications',
  ah(async (req, res) => {
    const where = { OR: [{ userId: req.user.id }, { role: req.user.role, createdAt: { gte: req.user.createdAt } }] };
    const items = await prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, take: 30 });
    // Role-broadcast notifications track read state per user via a "seen" setting.
    const seen = await prisma.setting.findUnique({ where: { key: `notif-seen:${req.user.id}` } });
    const seenAt = seen ? new Date(seen.value) : new Date(0);
    const mapped = items.map((n) => ({ ...n, unread: n.userId ? !n.readAt : n.createdAt > seenAt }));
    res.json({ items: mapped, unread: mapped.filter((n) => n.unread).length });
  }),
);

r.post(
  '/notifications/read-all',
  ah(async (req, res) => {
    const now = new Date();
    await prisma.$transaction([
      prisma.notification.updateMany({ where: { userId: req.user.id, readAt: null }, data: { readAt: now } }),
      prisma.setting.upsert({
        where: { key: `notif-seen:${req.user.id}` },
        create: { key: `notif-seen:${req.user.id}`, value: now.toISOString() },
        update: { value: now.toISOString() },
      }),
    ]);
    res.json({ ok: true });
  }),
);

// ── SMS Logs & Gateway Controls ──
r.get(
  '/sms-logs',
  requirePerm('audit.view'),
  ah(async (req, res) => {
    const { skip, take, page, pageSize } = pagination(req.query);
    const where = {};
    if (req.query.type) where.type = String(req.query.type);
    if (req.query.to) where.to = { contains: String(req.query.to) };
    const [items, total] = await Promise.all([
      prisma.smsLog.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
      prisma.smsLog.count({ where }),
    ]);
    res.json({ items, total, page, pageSize });
  }),
);

r.post(
  '/sms-test',
  requirePerm('settings.manage'),
  ah(async (req, res) => {
    const d = parse(z.object({ to: phone, message: reqStr(300) }), req.body);
    const sms = await sendSms({ to: d.to, message: d.message, type: 'TEST_MESSAGE', patientName: 'Test Recipient', reference: 'TEST-SMS' });
    await audit(req, 'SMS_TEST_SENT', 'SmsLog', sms.id, { to: d.to });
    res.json({ success: true, sms });
  }),
);

// ── Clinic settings ──
r.get(
  '/settings',
  ah(async (_req, res) => {
    const s = await prisma.setting.findUnique({ where: { key: 'clinic' } });
    res.json(s?.value || {});
  }),
);

r.put(
  '/settings',
  requirePerm('settings.manage'),
  ah(async (req, res) => {
    const d = parse(
      z.object({
        name: z.string().trim().min(2).max(120),
        address: z.string().trim().max(300).optional(),
        phone: z.string().trim().max(60).optional(),
        email: z.string().trim().max(120).optional(),
        tin: z.string().trim().max(40).optional(),
        receiptFooter: z.string().trim().max(300).optional(),
      }),
      req.body,
    );
    await prisma.setting.upsert({ where: { key: 'clinic' }, create: { key: 'clinic', value: d }, update: { value: d } });
    await audit(req, 'SETTINGS_UPDATED', 'Setting', 'clinic', d);
    res.json(d);
  }),
);

// ── Backups ──
r.get('/backups', requirePerm('settings.manage'), ah(async (_req, res) => res.json(await listBackups())));
r.post(
  '/backups',
  requirePerm('settings.manage'),
  ah(async (req, res) => {
    const file = await runBackup();
    await audit(req, 'BACKUP_CREATED', 'Backup', file.name);
    res.status(201).json(file);
  }),
);
r.get(
  '/backups/:name/download',
  requirePerm('settings.manage'),
  ah(async (req, res) => {
    const safeName = path.basename(String(req.params.name || ''));
    if (!safeName.startsWith('mediflow-') || (!safeName.endsWith('.gz') && !safeName.endsWith('.sql'))) {
      throw badRequest('Invalid backup filename');
    }
    const full = path.join(config.backupDir, safeName);
    if (!fs.existsSync(full)) throw notFound('Backup file not found');
    await audit(req, 'BACKUP_DOWNLOADED', 'Backup', safeName);
    res.download(full, safeName);
  }),
);
r.delete(
  '/backups/:name',
  requirePerm('settings.manage'),
  ah(async (req, res) => {
    const safeName = path.basename(String(req.params.name || ''));
    if (!safeName.startsWith('mediflow-') || (!safeName.endsWith('.gz') && !safeName.endsWith('.sql'))) {
      throw badRequest('Invalid backup filename');
    }
    const full = path.join(config.backupDir, safeName);
    if (!fs.existsSync(full)) throw notFound('Backup file not found');
    fs.unlinkSync(full);
    await audit(req, 'BACKUP_DELETED', 'Backup', safeName);
    res.json({ deleted: safeName });
  }),
);

export default r;
export { notFound, idParam };

