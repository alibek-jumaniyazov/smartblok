/**
 * Data-only reset for the e2e test database: TRUNCATE every table, then re-seed.
 *
 * Deliberately NOT `prisma migrate reset` — that DROPS and recreates the schema, which
 * gives every enum a fresh type OID while a running API's Prisma pool still caches the old
 * ones. The next query then fails with `XX000 cache lookup failed for type NNNNN` (or, if
 * the reset is still mid-flight, `The table public.User does not exist`) — errors that read
 * exactly like product bugs and are not. TRUNCATE leaves the types alone, so the API can
 * stay up across suites.
 *
 *   DATABASE_URL=… node test/_reset-data.mjs
 */
import { PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const prisma = new PrismaClient();

const tables = await prisma.$queryRaw`
  SELECT tablename FROM pg_tables
  WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
if (tables.length) {
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}
// order_no_seq is a standalone SEQUENCE (not an identity column), so RESTART IDENTITY does
// not touch it. Reset it too so orderNo starts from ORD-000001 on every suite.
await prisma.$executeRawUnsafe(`ALTER SEQUENCE IF EXISTS order_no_seq RESTART WITH 1`);
await prisma.$disconnect();

execFileSync('npx', ['tsx', join(HERE, '../prisma/seed.ts')], { stdio: 'ignore', shell: process.platform === 'win32' });
console.log('data reset + seeded');
