import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const dataDir = path.join(rootDir, '.pgdata');
const envPath = path.join(rootDir, '.env');

const PORT = Number(process.env.PG_PORT || 5433);
const USER = 'postgres';
const PASSWORD = 'postgres';
const DB_NAME = 'mediflow';
const DB_URL = `postgresql://${USER}:${PASSWORD}@localhost:${PORT}/${DB_NAME}?schema=public`;

export async function startLocalPostgres({ dbName = DB_NAME, port = PORT, persistent = true } = {}) {
  const dir = persistent ? dataDir : path.join(rootDir, `.pgdata-test-${port}`);
  if (!persistent && fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    user: USER,
    password: PASSWORD,
    port,
    persistent,
  });

  if (!fs.existsSync(path.join(dir, 'PG_VERSION'))) {
    await pg.initialise();
  }
  await pg.start();
  try {
    await pg.createDatabase(dbName);
  } catch {
    // Database already exists
  }
  const url = `postgresql://${USER}:${PASSWORD}@localhost:${port}/${dbName}?schema=public`;
  return { pg, url };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  (async () => {
    console.log('Starting embedded PostgreSQL on port', PORT, '...');
    const { pg, url } = await startLocalPostgres();
    if (!fs.existsSync(envPath)) {
      fs.writeFileSync(
        envPath,
        [
          `DATABASE_URL="${url}"`,
          'PORT=4000',
          'NODE_ENV=development',
          'CLINIC_NAME="MediFlow Healthcare Group"',
          'CORS_ORIGIN="http://localhost:5173,http://localhost:4000"',
          'APP_URL="http://localhost:5173"',
          'BACKUP_CRON="0 2 * * *"',
          '',
        ].join('\n'),
      );
      console.log('Wrote server/.env');
    }
    execSync('npx prisma db push --skip-generate', {
      cwd: rootDir,
      stdio: 'inherit',
      env: { ...process.env, DATABASE_URL: url },
    });
    execSync('node prisma/seed.js', {
      cwd: rootDir,
      stdio: 'inherit',
      env: { ...process.env, DATABASE_URL: url },
    });
    if (process.argv.includes('--once')) {
      await pg.stop();
      process.exit(0);
    }
    console.log(`PostgreSQL ready at ${url} (press Ctrl+C to stop)`);
    const stop = async () => {
      await pg.stop();
      process.exit(0);
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  })();
}

