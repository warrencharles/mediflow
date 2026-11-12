import cron from 'node-cron';
import { app } from './app.js';
import { config } from './config.js';
import { prisma } from './db.js';
import { runBackup } from '../scripts/backup.js';

const server = app.listen(config.port, () => {
  console.log(`MediFlow API listening on http://localhost:${config.port} (${config.env})`);
});

if (config.backupCron && cron.validate(config.backupCron)) {
  cron.schedule(config.backupCron, async () => {
    try {
      const b = await runBackup();
      console.log(`[backup] Automated backup saved: ${b.name}`);
    } catch (e) {
      console.error('[backup] Automated backup failed:', e);
    }
  });
}

const shutdown = async () => {
  server.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

