// Self-healing bootstrap: runs before `npm run dev` so a fresh clone (or a lost
// .env / stopped Postgres) never produces a 500 wall. Idempotent and fast when
// everything is already healthy.
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_PATH = path.join(ROOT, 'apps/api/.env');
const PGDATA = path.join(ROOT, '.pgdata');
const PG_PORT = 5433;
const PG_BIN_CANDIDATES = [
  'C:/Program Files/PostgreSQL/18/bin',
  'C:/Program Files/PostgreSQL/17/bin',
  'C:/Program Files/PostgreSQL/16/bin',
];

const log = (m) => console.log(`[bootstrap] ${m}`);

function pgBin(tool) {
  for (const dir of PG_BIN_CANDIDATES) {
    const p = path.join(dir, `${tool}.exe`);
    if (existsSync(p)) return p;
  }
  return tool; // hope it's on PATH (linux/mac dev)
}

// ── 1. apps/api/.env ──
if (!existsSync(ENV_PATH)) {
  const secret = randomBytes(48).toString('base64url');
  writeFileSync(
    ENV_PATH,
    `DATABASE_URL="postgresql://postgres@localhost:${PG_PORT}/smartblok"\n` +
      `JWT_SECRET="${secret}"\n` +
      `JWT_EXPIRES="12h"\nAPI_PORT=4000\nCORS_ORIGIN="http://localhost:5173"\n`,
  );
  log('apps/api/.env yaratildi (yangi tasodifiy JWT_SECRET bilan)');
}
const env = readFileSync(ENV_PATH, 'utf8');
const dbUrl = /DATABASE_URL="?([^"\n]+)"?/.exec(env)?.[1] ?? `postgresql://postgres@localhost:${PG_PORT}/smartblok`;
if (!dbUrl.includes(`localhost:${PG_PORT}`)) {
  log(`DATABASE_URL lokal klasterga emas (${dbUrl.split('@')[1] ?? '…'}) — DB bosqichlari o'tkazib yuborildi`);
  process.exit(0);
}

// ── 2. local Postgres cluster ──
const portOpen = await new Promise((resolve) => {
  const s = net.connect({ host: '127.0.0.1', port: PG_PORT, timeout: 1500 });
  s.on('connect', () => (s.destroy(), resolve(true)));
  s.on('error', () => resolve(false));
  s.on('timeout', () => (s.destroy(), resolve(false)));
});
if (!portOpen) {
  if (!existsSync(PGDATA)) {
    log(".pgdata topilmadi — yangi lokal PostgreSQL klasteri yaratilmoqda…");
    execFileSync(pgBin('initdb'), ['-D', PGDATA, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--locale=C'], {
      stdio: 'ignore',
    });
  }
  log(`PostgreSQL :${PG_PORT} da ishga tushirilmoqda…`);
  mkdirSync(PGDATA, { recursive: true });
  execFileSync(pgBin('pg_ctl'), ['-D', PGDATA, '-o', `-p ${PG_PORT}`, '-l', path.join(PGDATA, 'pg.log'), '-w', 'start'], {
    stdio: 'ignore',
  });
} else {
  log(`PostgreSQL :${PG_PORT} ishlayapti`);
}

// ── 3. database + migrations + seed ──
const psql = pgBin('psql');
const dbName = dbUrl.split('/').pop().split('?')[0];
const exists = spawnSync(psql, ['-p', String(PG_PORT), '-U', 'postgres', '-h', 'localhost', '-d', dbName, '-c', 'SELECT 1'], {
  stdio: 'ignore',
});
if (exists.status !== 0) {
  log(`"${dbName}" bazasi yaratilmoqda…`);
  execFileSync(pgBin('createdb'), ['-p', String(PG_PORT), '-U', 'postgres', '-h', 'localhost', dbName], { stdio: 'ignore' });
}
const npx = (args, opts = {}) => {
  // Windows: .cmd shims need a shell (Node hardening rejects bare .cmd spawns).
  // Single-string form; args are static literals, nothing user-supplied.
  const r = spawnSync(['npx', ...args].join(' '), {
    cwd: path.join(ROOT, 'apps/api'),
    stdio: opts.stdio ?? 'ignore',
    env: { ...process.env, DATABASE_URL: dbUrl },
    shell: true,
  });
  if (r.status !== 0) throw new Error(`npx ${args.join(' ')} failed (exit ${r.status})`);
};

log('prisma migrate deploy…');
npx(['prisma', 'migrate', 'deploy']);
// seed only when the DB is empty (seed is idempotent, but skip the cost when possible)
const userCount = spawnSync(
  psql,
  ['-p', String(PG_PORT), '-U', 'postgres', '-h', 'localhost', '-d', dbName, '-t', '-A', '-c', 'SELECT count(*) FROM "User"'],
  { encoding: 'utf8' },
);
if ((userCount.stdout ?? '').trim() === '0') {
  log('seed…');
  npx(['tsx', 'prisma/seed.ts'], { stdio: 'inherit' });
}
log('tayyor — API va web ishga tushmoqda');
