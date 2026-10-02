/** Import settings provenance and rollback, against an isolated LOCAL PostgreSQL schema. */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Prisma, PrismaClient } from '@prisma/client';
import { AgentKpiService } from '../../src/agents/agent-kpi.service';
import { AGENT_KPI_SETTING_KEY, parseAgentKpiSettings } from '../../src/agents/agent-kpi.calculator';
import { AuditService } from '../../src/common/audit.service';
import type { RequestUser } from '../../src/common/scoping';
import { applyImportedKpiSettings, applyImportedPalletPrice } from '../../src/import/commit/import-settings';
import { currentPalletPrice } from '../../src/common/pallet-debt';
import { SettingsService } from '../../src/common/settings.service';
import { SettingsAdminService } from '../../src/settings/settings-admin.service';
import { runRollback } from '../../src/import/commit/import-rollback.service';

const API = resolve(__dirname, '../..');
const KEY = AGENT_KPI_SETTING_KEY;
const baseline = { taxPerM3: '9000', agentShare: '0.25' };
const imported = [
  { taxPerM3: '10000', agentShare: '0.3333333333333333' },
  { taxPerM3: '11000', agentShare: '0.4' },
  { taxPerM3: '12000', agentShare: '0.5' },
];
let checks = 0;
function eq(actual: unknown, expected: unknown, note: string) { assert.deepEqual(actual, expected, note); checks++; }

async function run(prisma: PrismaClient) {
  const adminRow = await prisma.user.create({ data: {
    username: 'import-kpi-admin', name: 'Isolated import test', password: 'unusable-test-hash', role: 'ADMIN',
  } });
  const admin: RequestUser = { userId: adminRow.id, username: adminRow.username, name: adminRow.name, role: 'ADMIN', agentId: null };
  const service = new AgentKpiService(prisma as never, new AuditService(prisma as never));
  const setting = () => prisma.appSetting.findUnique({ where: { key: KEY } });
  const batch = () => prisma.importBatch.create({ data: { filename: 'settings-only-test.xlsb', status: 'COMMITTED', stats: { unrelated: 'preserved' } } });
  const apply = async (value: typeof baseline) => {
    const row = await batch();
    const result = await prisma.$transaction((tx) => applyImportedKpiSettings(tx, row.id, value, admin.userId));
    eq(result, parseAgentKpiSettings(value), 'public import result has only normalized business settings');
    return prisma.importBatch.findUniqueOrThrow({ where: { id: row.id } });
  };
  const reset = async (hasBaseline: boolean) => {
    await prisma.appSetting.deleteMany({ where: { key: KEY } });
    if (hasBaseline) await service.updateSettings(baseline, admin);
    return setting();
  };
  const assertRestored = async (before: Awaited<ReturnType<typeof setting>>, note: string) => {
    eq(await setting(), before, note); // includes exact timestamp, creator and private ownership marker
  };

  // Dry runs use the real write path in a transaction, then force that transaction to roll back.
  for (const exists of [false, true]) {
    const before = await reset(exists);
    const draft = await batch();
    const sentinel = new Error('test preview rollback');
    await assert.rejects(() => prisma.$transaction(async (tx) => {
      await applyImportedKpiSettings(tx, draft.id, imported[0], admin.userId);
      eq(parseAgentKpiSettings((await tx.appSetting.findUniqueOrThrow({ where: { key: KEY } })).value),
        parseAgentKpiSettings(imported[0]), 'preview sees its own tentative settings');
      throw sentinel;
    }), (error) => error === sentinel); checks++;
    await assertRestored(before, 'preview never persists settings');
    eq((await prisma.importBatch.findUniqueOrThrow({ where: { id: draft.id } })).stats,
      { unrelated: 'preserved' }, 'preview does not persist rollback snapshots');
  }

  // All six permutations cover reverse, out-of-order and three-deep restoration chains.
  const permutations = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  for (const exists of [false, true]) for (const order of permutations) {
    const before = await reset(exists);
    const batches = [];
    for (const value of imported) batches.push(await apply(value));
    const active = new Set([0, 1, 2]);
    for (const index of order) {
      await runRollback(prisma, batches[index].id, admin.userId);
      active.delete(index);
      eq((await prisma.importBatch.findUniqueOrThrow({ where: { id: batches[index].id } })).status,
        'ROLLED_BACK', 'actual rollback marks the import as rolled back');
      const latest = Math.max(...active);
      if (active.size) {
        const actual = await setting();
        eq(parseAgentKpiSettings(actual!.value), parseAgentKpiSettings(imported[latest]),
          'rollback keeps the newest active import settings');
        eq((actual!.value as Record<string, unknown>)._importBatchId, batches[latest].id,
          'restoration preserves the previous live owner');
      } else await assertRestored(before, 'complete rollback restores exact baseline or deletes a formerly absent setting');
    }
  }

  // A later manual save owns the setting even if both its values and timestamp collide.
  for (const sameValue of [false, true]) {
    await reset(true);
    const a = await apply(imported[0]);
    const saved = await setting();
    const manual = sameValue ? imported[0] : { taxPerM3: '7777', agentShare: '0.125' };
    await service.updateSettings(manual, admin);
    await prisma.appSetting.update({ where: { key: KEY }, data: { updatedAt: saved!.updatedAt } });
    const beforeRollback = await setting();
    eq((beforeRollback!.value as Record<string, unknown>)._importBatchId, undefined, 'manual writes clear import provenance');
    await runRollback(prisma, a.id, admin.userId);
    await assertRestored(beforeRollback, 'later manual setting survives same-timestamp rollback');
  }

  // A manual save between imports is a restoration boundary, even if the older import is undone.
  await reset(false);
  const older = await apply(imported[0]);
  await service.updateSettings({ taxPerM3: '8000', agentShare: '0.2' }, admin);
  const manualBoundary = await setting();
  const newer = await apply(imported[1]);
  await runRollback(prisma, older.id, admin.userId);
  eq((await setting())!.value, { ...parseAgentKpiSettings(imported[1]), _importBatchId: newer.id }, 'older rollback leaves newer active import');
  await runRollback(prisma, newer.id, admin.userId);
  await assertRestored(manualBoundary, 'later rollback stops at the intervening manual save');

  // Ownership, not only timestamp/value, distinguishes two imports made in the same millisecond.
  const base = await reset(true);
  const a = await apply(imported[0]);
  const stateA = await setting();
  const b = await apply(imported[0]);
  await prisma.appSetting.update({ where: { key: KEY }, data: { updatedAt: stateA!.updatedAt } });
  const statsB = b.stats as Prisma.JsonObject;
  await prisma.importBatch.update({ where: { id: b.id }, data: { stats: {
    ...statsB, kpiSettingsImport: { ...(statsB.kpiSettingsImport as Prisma.JsonObject), appliedAt: stateA!.updatedAt.toISOString() },
  } as Prisma.InputJsonObject } });
  const stateB = await setting();
  await runRollback(prisma, a.id, admin.userId);
  await assertRestored(stateB, 'same-millisecond older import cannot overwrite newer owner');
  await runRollback(prisma, b.id, admin.userId);
  await assertRestored(base, 'same-millisecond chained rollback still restores the baseline');

  // Concurrent requests serialize through the shared advisory lock and converge to the baseline.
  const concurrencyBase = await reset(true);
  const concurrentA = await apply(imported[0]);
  const concurrentB = await apply(imported[1]);
  await Promise.all([runRollback(prisma, concurrentA.id, admin.userId), runRollback(prisma, concurrentB.id, admin.userId)]);
  await assertRestored(concurrencyBase, 'concurrent batch rollbacks cannot resurrect obsolete settings');

  const untouched = await reset(true);
  const noSettings = await batch();
  eq(await prisma.$transaction((tx) => applyImportedKpiSettings(tx, noSettings.id, undefined, admin.userId)), undefined,
    'legacy import without settings returns no settings change');
  await runRollback(prisma, noSettings.id, admin.userId);
  await assertRestored(untouched, 'legacy import rollback preserves manual settings');

  const tinyShare = { taxPerM3: '0.000001', agentShare: '0.00000000000000000001' };
  await service.updateSettings(tinyShare, admin);
  eq(await service.getSettings(), tinyShare, 'admin can save and read back boundary precision without scientific notation');
  const tinyBaseline = await setting();
  const tinyImport = await apply(tinyShare);
  eq(await service.getSettings(), tinyShare, 'imported boundary precision is readable');
  await runRollback(prisma, tinyImport.id, admin.userId);
  await assertRestored(tinyBaseline, 'high-precision imported settings restore correctly');
  eq(await prisma.order.count(), 0, 'settings lifecycle creates no orders');
  eq(await prisma.ledgerEntry.count(), 0, 'settings lifecycle creates no ledger entries');
  eq(await prisma.cashTransaction.count(), 0, 'settings lifecycle creates no cash entries');
  eq(await prisma.bonusTransaction.count(), 0, 'settings lifecycle creates no bonus entries');

  const palletKey = 'palletPriceDefault';
  const palletAdmin = new SettingsAdminService(new SettingsService(prisma as never), new AuditService(prisma as never), prisma as never);
  const palletState = () => prisma.appSetting.findUnique({ where: { key: palletKey } });
  const applyPallet = async (price: string) => {
    const row = await batch();
    eq(await prisma.$transaction((tx) => applyImportedPalletPrice(tx, row.id, price, admin.userId)), price, 'import returns exact decimal price');
    return row;
  };
  for (const exists of [false, true]) for (const order of [[0, 1], [1, 0]]) {
    await prisma.appSetting.deleteMany({ where: { key: palletKey } });
    if (exists) await palletAdmin.update(palletKey, '120000.25', admin);
    const before = await palletState();
    const batches = [await applyPallet('130000'), await applyPallet('150000.5')];
    eq((await currentPalletPrice(prisma)).toFixed(), '150000.5', 'import metadata is hidden from public numeric settings');
    for (const index of order) await runRollback(prisma, batches[index].id, admin.userId);
    eq(await palletState(), before, 'pallet setting restores absent or exact baseline in either rollback order');
  }
  await palletAdmin.update(palletKey, '125000.5', admin);
  const beforePreview = await palletState(), draft = await batch(), sentinel = new Error('pallet preview');
  await assert.rejects(() => prisma.$transaction(async (tx) => {
    await applyImportedPalletPrice(tx, draft.id, '130000', admin.userId);
    eq((await currentPalletPrice(tx)).toFixed(), '130000', 'preview sees tentative pallet price');
    throw sentinel;
  }), (error) => error === sentinel); checks++;
  eq(await palletState(), beforePreview, 'preview does not change pallet setting');
  const importedPallet = await applyPallet('130000');
  const importedAt = (await palletState())!.updatedAt;
  await palletAdmin.update(palletKey, '130000', admin);
  await prisma.appSetting.update({ where: { key: palletKey }, data: { updatedAt: importedAt } });
  const manualPrice = await palletState();
  await runRollback(prisma, importedPallet.id, admin.userId);
  eq(await palletState(), manualPrice, 'manual price save survives rollback even with equal value and timestamp');
  for (const invalid of ['0', '-1', '1.001', '1000000000000', 'NaN', 'Infinity']) {
    await assert.rejects(() => prisma.$transaction((tx) => applyImportedPalletPrice(tx, draft.id, invalid, admin.userId))); checks++;
  }
  eq(await palletState(), manualPrice, 'rejected pallet settings have no effects');
}

async function main() {
  const url = new URL(process.env.KPI_TEST_DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:55433/postgres');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Only local PostgreSQL is allowed');
  const schema = `import_kpi_test_${Date.now()}_${randomBytes(6).toString('hex')}`;
  assert.match(schema, /^import_kpi_test_\d+_[a-f0-9]{12}$/);
  const isolated = new URL(url); isolated.searchParams.set('schema', schema); isolated.searchParams.set('connection_limit', '3');
  const migrations = resolve(API, 'prisma/migrations');
  for (const entry of readdirSync(migrations, { withFileTypes: true }).filter((e) => e.isDirectory())) {
    const sql = readFileSync(resolve(migrations, entry.name, 'migration.sql'), 'utf8');
    assert.ok(!/(?:\bpublic|"public")\s*\./i.test(sql), 'Public-targeted migrations forbidden in test harness');
  }
  const admin = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const prisma = new PrismaClient({
    datasources: { db: { url: isolated.toString() } },
    // Advisory locks span schemas: another local integration suite may be doing
    // a full workbook import while this isolated suite waits for the same key.
    transactionOptions: { maxWait: 30_000, timeout: 120_000 },
  });
  let created = false;
  try {
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`); created = true;
    const result = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
      cwd: API, env: { ...process.env, DATABASE_URL: isolated.toString() }, encoding: 'utf8', timeout: 120000, windowsHide: true,
    });
    if (result.status !== 0) throw new Error('Disposable schema migration failed');
    eq((await prisma.$queryRaw<{ schema: string }[]>`SELECT current_schema() AS schema`)[0].schema, schema, 'Exact disposable schema in use');
    await run(prisma);
    console.log(`Import KPI settings lifecycle: ${checks} assertions passed`);
  } finally {
    await prisma.$disconnect();
    if (created) await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.$disconnect();
  }
}
main().catch((error) => { console.error(String(error.message ?? error).replace(/postgres(?:ql)?:\/\/[^\s'"`]+/gi, '[redacted PostgreSQL URL]')); process.exitCode = 1; });
