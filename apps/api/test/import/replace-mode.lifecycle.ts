/**
 * «To'liq almashtirish» (REPLACE) mavjud ma'lumot USTIGA: avvalgi import + saytda yozilgan zavod
 * poddon reysi (jo'natish, tekshiruv, rad etilganni omborga qaytarish). 2026-10-29 da aynan shu
 * holatda preview HTTP 500 bergan (P2003). Ajratilgan sxemada; public/prod ga yozilmaydi.
 */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Prisma, PrismaClient } from '@prisma/client';
import { ImportService } from '../../src/import/import.service';
import { DebtsService } from '../../src/debts/debts.service';
import { PalletService } from '../../src/pallets/pallets.service';
import { FactoryPalletShipmentService } from '../../src/pallets/factory-pallet-shipment.service';
import { LedgerService } from '../../src/common/ledger.service';
import { AuditService } from '../../src/common/audit.service';
import { SettingsService } from '../../src/common/settings.service';
import { currentPalletPrice } from '../../src/common/pallet-debt';
import { tashkentDateStr } from '../../src/common/tashkent-time';
import type { RequestUser } from '../../src/common/scoping';

const API = resolve(__dirname, '../..');
const D = Prisma.Decimal;
let checks = 0;
function eq(actual: unknown, expected: unknown, label: string) { assert.deepEqual(actual, expected, label); checks++; }
function near(actual: unknown, expected: unknown, label: string, tolerance = '0.15') {
  assert.ok(new D(String(actual)).minus(String(expected)).abs().lte(tolerance), `${label}: ${actual} != ${expected}`); checks++;
}

async function scenario(db: PrismaClient) {
  const source = readFileSync(resolve(API, '../../docs/Система газаблок.xlsb'));
  const prisma = db as never;
  const audit = new AuditService(prisma), ledger = new LedgerService(prisma), settings = new SettingsService(prisma);
  const pallets = new PalletService(prisma, ledger, audit, settings);
  const debts = new DebtsService(prisma, ledger, pallets);
  const shipments = new FactoryPalletShipmentService(prisma, pallets, audit);
  const service = new ImportService(prisma, { review: async () => [] } as never);
  const actor = await db.user.create({ data: { username: 'replace-contract', name: 'Contract test', password: 'unusable-test-hash', role: 'ADMIN' } });
  const user: RequestUser = { userId: actor.id, username: actor.username, name: actor.name, role: actor.role, agentId: null };
  // AGENT login o'z agentiga bog'langan: REPLACE agentni o'chirib qayta yaratadi, login esa nom bo'yicha qayta ulanadi.
  const agent = await db.agent.create({ data: { name: 'Зафар ога' } });
  const agentUser = await db.user.create({ data: { username: 'zafar-test', name: 'Zafar', password: 'unusable-test-hash', role: 'AGENT', agentId: agent.id } });

  // ── 1) birinchi import (ustiga qo'shish) ──
  const first = await service.uploadAndStage(source, 'Система газаблок (1).xlsb', user);
  eq(first.openBlockers, 0, 'first import has no blockers');
  const firstPreview = await service.preview(first.batch.id, 'APPEND');
  const firstResult = await service.commit(first.batch.id, firstPreview.previewHash, user, 'APPEND');
  eq(firstResult.orders, 680, 'first import committed');

  // ── 2) saytda zavod poddon reysi: jo'natish → yetib kelish → tekshiruv → rad etilgani omborga ──
  const today = tashkentDateStr(new Date());
  const factory = await db.factory.findFirstOrThrow({ where: { name: 'Ментора' } });
  const trip = await shipments.dispatch({ factoryId: factory.id, qty: 100, date: today, vehiclePlate: '01 A 001 AA', driverName: 'Test', requestKey: randomUUID() } as never, user) as { id: string };
  await shipments.arrive(trip.id, { date: today } as never, user);
  await shipments.inspect(trip.id, { date: today, receiverName: 'Test', lines: [{ condition: 'yaroqli', qty: 90, unitPrice: '1000' }], rejectedQty: 10, rejectionReason: 'sinov', requestKey: randomUUID() } as never, user);
  await shipments.returnRejected(trip.id, { date: today, qty: 10, note: 'sinov', requestKey: randomUUID() } as never, user);
  eq([await db.factoryPalletShipment.count(), await db.factoryPalletInspection.count(), await db.factoryPalletAcceptanceLine.count(), await db.factoryPalletWarehouseReturn.count()],
    [1, 1, 1, 1], 'site has a full factory pallet trip');
  eq((await pallets.overview()).dealerInHand, 292 - 90, 'trip consumed warehouse stock');

  // ── 3) o'sha fayl qayta: to'liq almashtirish ──
  const second = await service.uploadAndStage(source, 'Система газаблок (1).xlsb', user);
  eq(second.priorCommittedImports, 1, 'prior import disclosed');
  eq(second.identicalCommittedImports, 1, 'identical source disclosed');
  const preview = await service.preview(second.batch.id, 'REPLACE');
  eq(await db.factoryPalletShipment.count(), 1, 'preview is a dry run — trip still there');
  eq(await db.order.count(), 680, 'preview is a dry run — first import still there');
  const committed = await service.commit(second.batch.id, preview.previewHash, user, 'REPLACE');
  const { previewHash: _ignored, ...expectedPreview } = preview;
  eq(committed, expectedPreview, 'REPLACE preview and commit agree');

  // ── 4) natija: faqat fayldan qurilgan baza ──
  eq(committed.orders, 680, 'all shipments rebuilt');
  eq(committed.skipped, [], 'no row silently dropped');
  eq(await db.order.count(), 680, 'old orders wiped, not duplicated');
  eq(await db.importBatch.count(), 1, 'only the replacing batch remains');
  eq([await db.factoryPalletShipment.count(), await db.factoryPalletInspection.count(), await db.factoryPalletAcceptanceLine.count(), await db.factoryPalletWarehouseReturn.count()],
    [0, 0, 0, 0], 'trip history wiped — the workbook is the only source');
  eq(committed.pallets, firstResult.pallets, 'pallet totals equal a clean import');
  for (const key of ['costTotal', 'saleTotal', 'clientDebtTotal', 'clientDebtWithPallets', 'clientPaidTotal', 'clientPaidGoods', 'clientPaidPallets'] as const) {
    eq(committed[key], firstResult[key], `REPLACE ${key} equals a clean import`);
  }
  const overview = await pallets.overview();
  eq([overview.client.balance, overview.factory.balance, overview.dealerInHand, overview.warehouseAdjustment, overview.drift], [504, 2796, 292, 56, 0], 'pallet ledger after REPLACE');
  const summary = await debts.summary();
  near(summary.clientsDualDebt.netWithoutPallets, '954746679.94', 'clients without pallets');
  near(summary.clientsDualDebt.netWithPallets, '1020266679.94', 'clients with pallets');
  near(summary.factoriesDualDebt.netWithPallets, 1448058454, 'factories with pallets = «Акт (умумий)»!R16', '0');
  eq(await db.client.count(), 61, 'every dictionary client');
  eq(await db.agent.count(), 8, 'every dictionary agent, no leftovers');
  const relinked = await db.user.findUniqueOrThrow({ where: { id: agentUser.id }, include: { agent: true } });
  eq(relinked.agent?.name, 'Зафар ога', 'AGENT login relinked to the rebuilt agent');
  near(await currentPalletPrice(db), 130000, 'pallet price from «Кўрсаткичлар»', '0');

  const rollback = await service.rollback(second.batch.id, user);
  eq([rollback.ledgerSum, rollback.cashSum, rollback.palletSum], ['0.00', '0.00', 0], 'REPLACE batch rolls back to zero');
  console.log(`REPLACE over existing data and factory trips: ${checks} checks passed.`);
}

async function main() {
  assert.ok(process.env.DATABASE_URL, 'Provide a local PostgreSQL DATABASE_URL; a separate schema is created');
  const base = new URL(process.env.DATABASE_URL!);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname), 'Only local PostgreSQL allowed');
  const schema = `smartblok_replace_${Date.now()}_${randomBytes(6).toString('hex')}`;
  assert.match(schema, /^smartblok_replace_\d+_[a-f0-9]{12}$/);
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
    await scenario(db);
  } finally {
    await db.$disconnect();
    if (created) await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.$disconnect();
  }
}
main().catch((error: unknown) => {
  console.error((error instanceof Error ? error.stack ?? error.message : String(error)).replace(/postgres(?:ql)?:\/\/[^\s'"`]+/gi, '[redacted PostgreSQL URL]'));
  process.exitCode = 1;
});
