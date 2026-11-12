import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { loadSession, requireAuth } from './middleware/auth.js';
import { HttpError } from './lib/errors.js';

import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import patientRoutes from './routes/patients.js';
import appointmentRoutes from './routes/appointments.js';
import queueRoutes from './routes/queue.js';
import consultationRoutes from './routes/consultations.js';
import pharmacyRoutes from './routes/pharmacy.js';
import labRoutes from './routes/lab.js';
import billingRoutes from './routes/billing.js';
import reportRoutes from './routes/reports.js';
import dashboardRoutes from './routes/dashboard.js';
import adminRoutes from './routes/admin.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-origin' },
    }),
  );
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (
          config.corsOrigin.includes(origin) ||
          origin.includes('localhost') ||
          origin.endsWith('.vercel.app') ||
          !config.isProd
        ) {
          return callback(null, true);
        }
        return callback(null, true);
      },
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());
  app.use(loadSession);

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'mediflow-api', time: new Date().toISOString() });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/users', requireAuth, userRoutes);
  app.use('/api/patients', requireAuth, patientRoutes);
  app.use('/api/appointments', requireAuth, appointmentRoutes);
  app.use('/api/queue', requireAuth, queueRoutes);
  app.use('/api/consultations', requireAuth, consultationRoutes);
  app.use('/api/pharmacy', requireAuth, pharmacyRoutes);
  app.use('/api/lab', requireAuth, labRoutes);
  app.use('/api/billing', requireAuth, billingRoutes);
  app.use('/api/reports', requireAuth, reportRoutes);
  app.use('/api/dashboard', requireAuth, dashboardRoutes);
  app.use('/api/admin', requireAuth, adminRoutes);

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
  });

  // Serve built React SPA when STATIC_DIR or ../client/dist exists
  const clientDist = config.staticDir || path.resolve(process.cwd(), '..', 'client', 'dist');
  if (fs.existsSync(path.join(clientDist, 'index.html'))) {
    app.use(express.static(clientDist));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  // Central error handler
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({
        error: err.message,
        ...(err.details ? { details: err.details } : {}),
      });
    }
    if (err?.name === 'ZodError') {
      return res.status(400).json({ error: err.issues?.[0]?.message || 'Validation failed' });
    }
    if (!config.isTest) console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

export const app = createApp();

