import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { prisma } from '../src/db.js';
import { config } from '../src/config.js';

const execFileP = promisify(execFile);

const TABLES = [
  'counter',
  'setting',
  'user',
  'doctorSchedule',
  'patient',
  'appointment',
  'visit',
  'vitals',
  'consultation',
  'prescription',
  'prescriptionItem',
  'supplier',
  'medicine',
  'medicineBatch',
  'stockMovement',
  'dispensation',
  'dispensationItem',
  'labTest',
  'labRequest',
  'service',
  'invoice',
  'invoiceItem',
  'discount',
  'payment',
  'auditLog',
  'notification',
];

export async function runBackup() {
  fs.mkdirSync(config.backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  // 1) Try native pg_dump first if installed on host
  if (process.env.DATABASE_URL) {
    try {
      const sqlFile = path.join(config.backupDir, `mediflow-${stamp}.sql`);
      await execFileP('pg_dump', ['--no-owner', '--no-acl', '-f', sqlFile, process.env.DATABASE_URL]);
      const gzFile = `${sqlFile}.gz`;
      const gz = zlib.gzipSync(fs.readFileSync(sqlFile));
      fs.writeFileSync(gzFile, gz);
      fs.unlinkSync(sqlFile);
      pruneOldBackups();
      return { name: path.basename(gzFile), size: gz.length, createdAt: new Date().toISOString(), format: 'pg_dump' };
    } catch {
      // Fallback to logical JSON snapshot below if pg_dump is not on PATH
    }
  }

  // 2) Portable logical snapshot of all relational tables
  const snapshot = {
    meta: {
      system: 'MediFlow',
      version: '1.0.0',
      createdAt: new Date().toISOString(),
    },
    tables: {},
  };
  for (const t of TABLES) {
    snapshot.tables[t] = await prisma[t].findMany();
  }
  const gzName = `mediflow-${stamp}.json.gz`;
  const gzPath = path.join(config.backupDir, gzName);
  const buf = zlib.gzipSync(Buffer.from(JSON.stringify(snapshot, null, 2), 'utf8'));
  fs.writeFileSync(gzPath, buf);
  pruneOldBackups();
  return { name: gzName, size: buf.length, createdAt: snapshot.meta.createdAt, format: 'json.gz' };
}

export async function listBackups() {
  fs.mkdirSync(config.backupDir, { recursive: true });
  const files = fs
    .readdirSync(config.backupDir)
    .filter((f) => f.startsWith('mediflow-') && (f.endsWith('.gz') || f.endsWith('.sql')))
    .map((name) => {
      const st = fs.statSync(path.join(config.backupDir, name));
      return { name, size: st.size, createdAt: st.mtime.toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return files;
}

function pruneOldBackups() {
  const cutoff = Date.now() - config.backupRetentionDays * 86400000;
  for (const f of fs.readdirSync(config.backupDir)) {
    if (!f.startsWith('mediflow-')) continue;
    const full = path.join(config.backupDir, f);
    const st = fs.statSync(full);
    if (st.mtimeMs < cutoff) {
      try {
        fs.unlinkSync(full);
      } catch {}
    }
  }
}

// Allow running directly via `npm run backup`
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runBackup()
    .then((b) => {
      console.log(`Backup created: ${b.name} (${b.size} bytes)`);
      return prisma.$disconnect();
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}

