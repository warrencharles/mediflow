import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startLocalPostgres } from '../server/scripts/local-db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(__dirname, '..', 'server');
const clientDist = path.resolve(__dirname, '..', 'client', 'dist');
process.env.STATIC_DIR = process.env.STATIC_DIR || clientDist;

(async () => {
  let pg = null;
  if (!process.env.DATABASE_URL) {
    console.log('[mediflow] Starting embedded PostgreSQL 15 instance...');
    const res = await startLocalPostgres();
    pg = res.pg;
    process.env.DATABASE_URL = res.url;
    execSync('npx prisma db push --skip-generate', {
      cwd: serverDir,
      stdio: 'inherit',
      env: process.env,
    });
    execSync('node prisma/seed.js', {
      cwd: serverDir,
      stdio: 'inherit',
      env: process.env,
    });
  }

  await import('../server/src/index.js');

  const shutdown = async () => {
    if (pg) await pg.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
})();

