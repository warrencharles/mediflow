import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const env = process.env;
const isProd = env.NODE_ENV === 'production';

if (isProd && !env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set in production');
}

export const config = {
  env: env.NODE_ENV || 'development',
  isProd,
  isTest: env.NODE_ENV === 'test',
  port: Number(env.PORT || 4000),
  clinicName: env.CLINIC_NAME || 'MediFlow Clinic',
  // Africa/Dar_es_Salaam is UTC+3 with no daylight saving.
  tzOffsetMinutes: Number(env.TZ_OFFSET_MINUTES || 180),
  corsOrigin: env.CORS_ORIGIN ? env.CORS_ORIGIN.split(',') : ['http://localhost:5173'],
  appUrl: env.APP_URL || 'http://localhost:5173',
  session: {
    cookieName: 'mf_session',
    idleMinutes: Number(env.SESSION_IDLE_MINUTES || 60),
    absoluteHours: Number(env.SESSION_ABSOLUTE_HOURS || 12),
    secureCookie: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : isProd,
  },
  security: {
    maxFailedLogins: 5,
    lockMinutes: 15,
    resetTokenMinutes: 30,
  },
  uploadDir: path.resolve(env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads')),
  backupDir: path.resolve(env.BACKUP_DIR || path.join(__dirname, '..', 'backups')),
  backupCron: env.BACKUP_CRON || '',
  backupRetentionDays: Number(env.BACKUP_RETENTION_DAYS || 14),
  smtp: {
    host: env.SMTP_HOST || '',
    port: Number(env.SMTP_PORT || 587),
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    from: env.SMTP_FROM || 'MediFlow <no-reply@mediflow.local>',
  },
  staticDir: env.STATIC_DIR ? path.resolve(env.STATIC_DIR) : '',
};

