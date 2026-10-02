/** October 2 workbook in a disposable local schema; never writes to public/prod. */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Prisma, PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';
import { ImportService, parseWorkbook } from '../../src/import/import.service';
import { ClientsService } from '../../src/clients/clients.service';
import { FactoriesService } from '../../src/factories/factories.service';
import { DebtsService } from '../../src/debts/debts.service';
import { PalletService } from '../../src/pallets/pallets.service';
import { LedgerService } from '../../src/common/ledger.service';
import { AuditService } from '../../src/common/audit.service';
import { SettingsService } from '../../src/common/settings.service';
import { SettingsAdminService } from '../../src/settings/settings-admin.service';
import { currentPalletPrice } from '../../src/common/pallet-debt';
import type { RequestUser } from '../../src/common/scoping';
import { Dictionary } from '../../src/import/resolve/dictionary';
import { runRules } from '../../src/import/rules/validate.service';
import { resolveRulesConfig } from '../../src/import/rules/config';

const API = resolve(__dirname, '../..');
const D = Prisma.Decimal;
let checks = 0;
function eq(actual: unknown, expected: unknown, label: string) { assert.deepEqual(actual, expected, label); checks++; }
function near(actual: unknown, expected: unknown, label: string, tolerance = '0.15') {
  assert.ok(new D(String(actual)).minus(String(expected)).abs().lte(tolerance), `${label}: ${actual} != ${expected}`); checks++;
}

async function scenario(db: PrismaClient, databaseUrl: string) {
  const source = readFileSync(resolve(API, '../../docs/Smart blok.xlsx'));
  const original = XLSX.read(source, { type: 'buffer', cellFormula: true });
  const service = new ImportService(db as never, { review: async () => [] } as never);
  const prisma = db as never;
  const ledger = new LedgerService(prisma), audit = new AuditService(prisma), settings = new SettingsService(prisma);
  const pallets = new PalletService(prisma, ledger, audit, settings);
  const debts = new DebtsService(prisma, ledger, pallets);
  const clients = new ClientsService(prisma, ledger, audit);
  const factories = new FactoriesService(prisma, ledger, audit, pallets, debts);
  const settingsAdmin = new SettingsAdminService(settings, audit, prisma);
  const actor = await db.user.create({ data: { username: 'october-contract', name: 'Contract test', password: 'unusable-test-hash', role: 'ADMIN' } });
  const user: RequestUser = { userId: actor.id, username: actor.username, name: actor.name, role: actor.role, agentId: null };
  await db.appSetting.create({ data: { key: 'palletPriceDefault', value: 125000, updatedBy: actor.id } });

  const unresolved = await service.uploadAndStage(source, 'Smart blok.xlsx', user);
  eq(unresolved.rowsByKind, { SHIPMENT: 584, CLIENT_PAYMENT: 256, FACTORY_PAYMENT: 77, PALLET_RETURN: 144, FACTORY_PALLET_RETURN: 19 }, 'all source records staged including damage');
  eq(unresolved.openBlockers, 5, 'three missing prices and two missing transport payers remain blocked');
  await assert.rejects(() => service.preview(unresolved.batch.id, 'APPEND')); checks++;
  eq(await db.order.count(), 0, 'unresolved source does not create orders');
  eq(await db.ledgerEntry.count(), 0, 'unresolved source does not create ledger entries');
  near(await currentPalletPrice(db), 125000, 'staging leaves price unchanged', '0');

  // TEST ONLY: use a positive 1 UZS/m3 price for the three unavailable source prices.
  // These deliberately artificial resolutions are not a recommendation or a source
  // repair. Production validation stays strict and the owner's file stays unchanged.
  const synthetic = XLSX.read(source, { type: 'buffer', cellFormula: true });
  const fixtureOffsets = new Map<string, Prisma.Decimal>();
  for (const row of [543, 544, 563]) {
    const sheet = synthetic.Sheets['Товар'];
    const qty = new D(String(sheet[`H${row}`].v));
    const name = String(sheet[`D${row}`].v);
    sheet[`O${row}`] = { t: 'n', v: 1 };
    if (row !== 563) sheet[`Q${row}`] = { t: 's', v: 'Сотувчи' };
    sheet[`P${row}`] = { t: 'n', v: qty.toNumber() };
    sheet[`T${row}`] = { t: 'n', v: qty.toNumber() };
    sheet[`R${row}`] = { t: 'n', v: qty.minus(String(sheet[`J${row}`].v)).minus(String(sheet[`S${row}`]?.v ?? 0)).toNumber() };
    fixtureOffsets.set(name, (fixtureOffsets.get(name) ?? new D(0)).plus(qty.toDP(2)));
  }
  const fixture = Buffer.from(XLSX.write(synthetic, { type: 'buffer', bookType: 'xlsx' }));
  const totalFixtureOffset = [...fixtureOffsets.values()].reduce((sum, n) => sum.plus(n), new D(0));
  near(totalFixtureOffset, '65.66', 'explicit synthetic change accounted for', '0');
  const staged = await service.uploadAndStage(fixture, 'TEST-ONLY-explicit-price-resolutions.xlsx', user);
  eq(staged.openBlockers, 0, 'only explicit test resolutions allow import');
  const preview = await service.preview(staged.batch.id, 'APPEND');
  near(await currentPalletPrice(db), 125000, 'preview rolls price back', '0');
  eq(await db.order.count(), 0, 'preview rolls orders back');
  eq(preview.palletPriceDefault, '130000', 'preview discloses imported setting');
  const committed = await service.commit(staged.batch.id, preview.previewHash, user, 'APPEND');
  const { previewHash: _ignored, ...expectedPreview } = preview;
  eq(committed, expectedPreview, 'preview and commit agree');
  eq(committed.orders, 584, 'all source shipments committed in test fixture');
  eq(committed.skipped, [], 'no financial row silently dropped');
  near(await currentPalletPrice(db), 130000, 'commit applies source price', '0');
  near(committed.clientDebtTotal, new D('868252919.942259').plus(totalFixtureOffset), 'client goods debt with explicit fixture offset');
  near(committed.clientDebtWithPallets, new D('893342919.942259').plus(totalFixtureOffset), 'combined client debt with fixture offset');
  near(committed.clientPaidTotal, '11414736660', 'cash unchanged');
  near(committed.clientPaidPallets, '423020000', 'historical pallet allocations unchanged');
  near(committed.costTotal, '10657185354', 'factory cost unchanged');
  eq(committed.pallets.clientDebt, 193, 'customer quantity excludes warehouse damage');
  eq(committed.pallets.returnedByClients, 7061, 'customer returns exclude damage');
  eq(committed.pallets.warehouseAdjustment, -52, 'damage retained as stock correction');
  eq(committed.pallets.dealerInHand, 117, 'physical stock correct');
  const overview = await pallets.overview();
  eq(overview.client.balance, 193, 'pallet API agrees on client balance');
  eq(overview.factory.balance, 3616, 'pallet API agrees on factory balance');
  eq(overview.dealerInHand, 117, 'pallet API stock correct');
  eq(overview.warehouseAdjustment, -52, 'pallet API discloses damage');
  eq(overview.drift, 0, 'pallet conservation includes damage');
  eq(await db.client.count({ where: { name: 'БРАК' } }), 0, 'damage does not invent a customer');
  const damaged = await db.palletTransaction.findMany({ where: { importBatchId: staged.batch.id, type: 'ADJUSTMENT', clientId: null, factoryId: null } });
  eq(damaged.map((r) => r.qty), [-52], 'one ownerless warehouse adjustment');

  const sourceBalances = original.Sheets['Мижозлар қолдиғи'];
  const allClients = await db.client.findMany();
  eq(allClients.length, 58, 'all exact source clients');
  for (let row = 5; row <= 62; row++) {
    const name = String(sourceBalances[`B${row}`].v);
    const client = allClients.find((c) => c.name.replace(/\s+/g, ' ') === name.replace(/\s+/g, ' '));
    assert.ok(client, `source client exists: ${name}`); checks++;
    const actual = await clients.detail(client.id, user);
    const offset = fixtureOffsets.get(name) ?? new D(0);
    near(actual.debtWithoutPallets, new D(String(sourceBalances[`E${row}`].v)).neg().plus(offset), `${name} debt without pallets`);
    near(actual.debtWithPallets, new D(String(sourceBalances[`M${row}`].v)).neg().plus(offset), `${name} debt including pallets`);
    near(actual.palletDebtQuantity, -Number(sourceBalances[`J${row}`].v), `${name} signed pallet balance`, '0');
  }
  for (const [name, goods, combined, qty] of [['Коалс', 858888426, 972508426, 874], ['Ментора', 49689508, 406149508, 2742]] as const) {
    const factory = await db.factory.findFirstOrThrow({ where: { name } });
    const actual = await factories.findOne(factory.id);
    near(actual.debtWithoutPallets, goods, `${name} includes return expense credit`, '0');
    near(actual.debtWithPallets, combined, `${name} combined debt`, '0');
    eq(actual.palletDebtQuantity, qty, `${name} remaining pallets`);
  }
  const summary = await debts.summary();
  near(summary.clientsDualDebt.netWithoutPallets, new D('868252919.942259').plus(totalFixtureOffset), 'board client base');
  near(summary.clientsDualDebt.netWithPallets, new D('893342919.942259').plus(totalFixtureOffset), 'board client combined');
  near(summary.factoriesDualDebt.netWithoutPallets, 908577934, 'board factory base', '0');
  near(summary.factoriesDualDebt.netWithPallets, 1378657934, 'board factory combined', '0');

  // Exercise the actual export dependency graph and the new ownerless-stock path.
  // tsx cannot supply Nest constructor metadata, so use the freshly compiled API.
  process.env.DATABASE_URL = databaseUrl;
  process.env.JWT_SECRET = 'local-october-contract-test-not-a-production-secret';
  process.env.CORS_ORIGIN = 'http://localhost:4173';
  process.env.NODE_ENV = 'test';
  const { NestFactory } = require('@nestjs/core');
  const { AppModule } = require(resolve(API, 'dist/app.module.js'));
  const { ExportService } = require(resolve(API, 'dist/export/export.service.js'));
  const context = await NestFactory.createApplicationContext(AppModule, { logger: false });
  let output: Buffer;
  try { output = (await context.get(ExportService).buildWorkbook({ from: '2026-09-01', to: '2026-09-30' }, user)).buffer; }
  finally { await context.close(); }
  if (process.env.SMARTBLOK_EXPORT_OUTPUT) writeFileSync(process.env.SMARTBLOK_EXPORT_OUTPUT, output!);
  const exported = await parseWorkbook(output!);
  const exportFindings = runRules({ ...exported, dict: Dictionary.from(exported.master), cfg: resolveRulesConfig(null) });
  eq(exportFindings.filter((f) => f.severity === 'BLOCK').map((f) => f.message), [], 'generated source tabs have no blocking import findings');
  eq(exported.shipments.length, 584, 'export preserves all584 shipments including October despite selected report month');
  near(exported.master.settings.palletBasePrice, 130000, 'export carries current global price', '0');
  const exportBook = XLSX.read(output!, { type: 'buffer' });
  for (const [name, cells] of Object.entries(exportBook.Sheets)) {
    eq(Object.entries(cells).filter(([address, cell]) => !address.startsWith('!') && cell.t === 'e').map(([address]) => address), [], `no cached errors in exported ${name}`);
  }

  const firstRollback = await service.rollback(staged.batch.id, user);
  eq(firstRollback.ledgerSum, '0.00', 'first rollback ledger conservation');
  eq(firstRollback.cashSum, '0.00', 'first rollback cash conservation');
  eq(firstRollback.palletSum, 0, 'first rollback pallet conservation');
  near(await currentPalletPrice(db), 125000, 'rollback restores earlier price', '0');
  eq(await pallets.dealerInHand(), 0, 'rollback removes damage and returns from loose stock');
  eq((await pallets.overview()).drift, 0, 'rollback preserves stock conservation');

  const roundtrip = await service.uploadAndStage(output!, 'TEST-ONLY-October-export-roundtrip.xlsx', user);
  eq(roundtrip.openBlockers, 0, 'actual generated file stages without blockers');
  const roundPreview = await service.preview(roundtrip.batch.id, 'APPEND');
  const roundResult = await service.commit(roundtrip.batch.id, roundPreview.previewHash, user, 'APPEND');
  for (const key of ['orders', 'costTotal', 'saleTotal', 'clientDebtTotal', 'clientDebtWithPallets', 'clientPaidTotal', 'clientPaidGoods', 'clientPaidPallets'] as const) {
    eq(roundResult[key], committed[key], `actual export/reimport ${key}`);
  }
  eq(roundResult.pallets, committed.pallets, 'export/reimport retains separate customer returns and warehouse damage');
  eq(await db.client.count({ where: { name: { in: ['БРАК', 'ОМБОР ТУЗАТИШИ'] } } }), 0, 'export/reimport creates no fake warehouse customer');
  eq((await pallets.overview()).drift, 0, 'roundtrip pallet conservation');
  const roundSummary = await debts.summary();
  near(roundSummary.factoriesDualDebt.netWithoutPallets, 908577934, 'roundtrip preserves factory expense credit', '0');
  near(roundSummary.factoriesDualDebt.netWithPallets, 1378657934, 'roundtrip preserves combined factory debt', '0');
  const roundRollback = await service.rollback(roundtrip.batch.id, user);
  eq(roundRollback.ledgerSum, '0.00', 'roundtrip rollback ledger conservation');
  eq(roundRollback.cashSum, '0.00', 'roundtrip rollback cash conservation');
  eq(roundRollback.palletSum, 0, 'roundtrip rollback pallet conservation');
  near(await currentPalletPrice(db), 125000, 'roundtrip rollback restores baseline setting', '0');

  // A separate import verifies a later manual settings edit is never overwritten.
  const again = await service.uploadAndStage(fixture, 'TEST-ONLY-price-change.xlsx', user);
  const againPreview = await service.preview(again.batch.id, 'APPEND');
  await service.commit(again.batch.id, againPreview.previewHash, user, 'APPEND');
  const before = await debts.summary();
  const cashSnapshot = await db.cashTransaction.findMany({ select: { id: true, amount: true }, orderBy: { id: 'asc' } });
  const ledgerSnapshot = await db.ledgerEntry.findMany({ select: { id: true, amount: true }, orderBy: { id: 'asc' } });
  const paymentSnapshot = await db.payment.findMany({ select: { id: true, amount: true }, orderBy: { id: 'asc' } });
  const palletSnapshot = await db.palletTransaction.findMany({ where: { type: 'CHARGED_LOST' }, select: { id: true, qty: true, unitPrice: true }, orderBy: { id: 'asc' } });
  await settingsAdmin.update('palletPriceDefault', 150000, user);
  const after = await debts.summary();
  near(after.clientsDualDebt.netWithoutPallets, before.clientsDualDebt.netWithoutPallets, 'price update leaves goods debt intact', '0');
  near(after.clientsDualDebt.netWithPallets, new D(before.clientsDualDebt.netWithPallets).plus(193 * 20000), 'only193 client pallets revalued', '0');
  near(after.factoriesDualDebt.netWithoutPallets, 908577934, 'factory base remains unchanged', '0');
  near(after.factoriesDualDebt.netWithPallets, 1450977934, 'only3616 factory pallets revalued', '0');
  eq(await db.cashTransaction.findMany({ select: { id: true, amount: true }, orderBy: { id: 'asc' } }), cashSnapshot, 'no cash mutation when price changes');
  eq(await db.ledgerEntry.findMany({ select: { id: true, amount: true }, orderBy: { id: 'asc' } }), ledgerSnapshot, 'no ledger mutation when price changes');
  eq(await db.payment.findMany({ select: { id: true, amount: true }, orderBy: { id: 'asc' } }), paymentSnapshot, 'no payment mutation when price changes');
  eq(await db.palletTransaction.findMany({ where: { type: 'CHARGED_LOST' }, select: { id: true, qty: true, unitPrice: true }, orderBy: { id: 'asc' } }), palletSnapshot, 'historical paid pallet unit prices unchanged');
  const rollback = await service.rollback(again.batch.id, user);
  eq(rollback.ledgerSum, '0.00', 'second rollback ledger conservation');
  eq(rollback.cashSum, '0.00', 'second rollback cash conservation');
  eq(rollback.palletSum, 0, 'second rollback pallet conservation');
  near(await currentPalletPrice(db), 150000, 'rollback preserves subsequent manual price', '0');
  const empty = await debts.summary();
  near(empty.clientsDualDebt.netWithPallets, 0, 'client combined balances clear after rollback', '0');
  near(empty.factoriesDualDebt.netWithPallets, 0, 'factory combined balances clear after rollback', '0');
  console.log(`Smart blok October 2 lifecycle: ${checks} checks passed (explicit synthetic price resolutions).`);
}

async function main() {
  assert.ok(process.env.DATABASE_URL, 'Provide a local PostgreSQL DATABASE_URL; a separate schema is created');
  const base = new URL(process.env.DATABASE_URL!);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname), 'Only local PostgreSQL allowed');
  const schema = `smartblok_oct2_${Date.now()}_${randomBytes(6).toString('hex')}`;
  assert.match(schema, /^smartblok_oct2_\d+_[a-f0-9]{12}$/);
  const isolated = new URL(base); isolated.searchParams.set('schema', schema); isolated.searchParams.set('connection_limit', '5');
  for (const migration of readdirSync(resolve(API, 'prisma/migrations'), { withFileTypes: true }).filter((e) => e.isDirectory())) {
    assert.ok(!/(?:\bpublic|"public")\s*\./i.test(readFileSync(resolve(API, 'prisma/migrations', migration.name, 'migration.sql'), 'utf8')), 'Migration must not target public schema');
  }
  const admin = new PrismaClient({ datasources: { db: { url: base.toString() } } });
  const db = new PrismaClient({ datasources: { db: { url: isolated.toString() } } });
  let created = false;
  try {
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`); created = true;
    const migration = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], { cwd: API, env: { ...process.env, DATABASE_URL: isolated.toString() }, encoding: 'utf8', timeout: 120000, windowsHide: true });
    assert.equal(migration.status, 0, 'Disposable schema migration succeeded');
    eq((await db.$queryRaw<Array<{ schema: string }>>`SELECT current_schema() AS schema`)[0].schema, schema, 'verified exact isolated schema');
    await scenario(db, isolated.toString());
  } finally {
    await db.$disconnect();
    if (created) await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.$disconnect();
  }
}
main().catch((error: unknown) => {
  console.error((error instanceof Error ? error.message : String(error)).replace(/postgres(?:ql)?:\/\/[^\s'"`]+/gi, '[redacted PostgreSQL URL]'));
  process.exitCode = 1;
});
