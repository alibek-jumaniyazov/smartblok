/** «Система газаблок.xlsb» (2026-10-28) in a disposable local schema; never writes to public/prod. */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
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
import { AgentKpiService } from '../../src/agents/agent-kpi.service';
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
  const source = readFileSync(resolve(API, '../../docs/Система газаблок.xlsb'));
  const book = XLSX.read(source, { type: 'buffer' });
  const sheetValue = (sheet: string, address: string) => book.Sheets[sheet][address]?.v;
  const service = new ImportService(db as never, { review: async () => [] } as never);
  const prisma = db as never;
  const ledger = new LedgerService(prisma), audit = new AuditService(prisma), settings = new SettingsService(prisma);
  const pallets = new PalletService(prisma, ledger, audit, settings);
  const debts = new DebtsService(prisma, ledger, pallets);
  const clients = new ClientsService(prisma, ledger, audit);
  const factories = new FactoriesService(prisma, ledger, audit, pallets, debts);
  const kpi = new AgentKpiService(prisma, audit);
  const actor = await db.user.create({ data: { username: 'sistema-contract', name: 'Contract test', password: 'unusable-test-hash', role: 'ADMIN' } });
  const user: RequestUser = { userId: actor.id, username: actor.username, name: actor.name, role: actor.role, agentId: null };
  await db.appSetting.create({ data: { key: 'palletPriceDefault', value: 125000, updatedBy: actor.id } });

  // ── yuklash → staging: to'siqsiz, hech narsa jim tashlanmaydi ──
  const staged = await service.uploadAndStage(source, 'Система газаблок (1).xlsb', user);
  eq(staged.rowsByKind, { SHIPMENT: 680, CLIENT_PAYMENT: 287, FACTORY_PAYMENT: 101, PALLET_RETURN: 191, FACTORY_PALLET_RETURN: 24 }, 'every source record staged, warehouse rows included');
  eq(staged.openBlockers, 0, 'the owner file has no blocking issue');
  eq(staged.pendingEntities, 0, 'every client name resolves through the dictionary');
  eq(staged.commitReady, true, 'ready to commit');
  eq(staged.incompleteRows.map((r: { origin: { excelRow: number } }) => r.origin.excelRow), [160], 'misplaced quantity row disclosed');
  const entities = await db.importEntityMap.findMany({ where: { batchId: staged.batch.id, kind: 'CLIENT' } });
  eq(entities.some((e) => ['БРАК', 'РАЗНИЦА'].includes(e.sourceName)), false, 'warehouse labels never become client decisions');
  eq(await db.order.count(), 0, 'staging does not create orders');

  const preview = await service.preview(staged.batch.id, 'APPEND');
  eq(await db.order.count(), 0, 'preview rolls orders back');
  near(await currentPalletPrice(db), 125000, 'preview rolls price back', '0');
  const committed = await service.commit(staged.batch.id, preview.previewHash, user, 'APPEND');
  const { previewHash: _ignored, ...expectedPreview } = preview;
  eq(committed, expectedPreview, 'preview and commit agree');

  // ── butun daftar ──
  eq(committed.orders, 680, 'all shipments committed');
  eq(committed.skipped, [], 'no financial row silently dropped');
  near(await currentPalletPrice(db), 130000, 'commit applies «Кўрсаткичлар»!B4', '0');
  // B6 = 1/3 (Excel double) — sozlama 20 xonali to'liq 1/3 bo'lib saqlanadi, 0.333 ga qisqartirilmaydi.
  eq(committed.kpiSettings, { taxPerM3: '10000', agentShare: '0.33333333333333333333' }, 'KPI settings from «Кўрсаткичлар»');
  near(committed.costTotal, '12478733874', 'factory goods cost');
  near(committed.saleTotal, '15109008619.91', 'sales');
  near(committed.clientChargeable, '13900584619.94', 'charge = «Мижозга»');
  near(committed.clientPaidTotal, '13213117940', 'customer cash');
  near(committed.clientPaidPallets, '267280000', 'pallet money');
  near(committed.clientPaidGoods, '12945837940', 'goods money');
  near(committed.clientDebtTotal, '954746679.94', 'client debt without pallets = −«Мижозлар қолдиғи»!E76');
  near(committed.clientDebtWithPallets, '1020266679.94', 'client debt with pallets = −«Мижозлар қолдиғи»!M76');
  eq(committed.pallets, {
    delivered: 12248, returnedByClients: 9688, paidByClients: 2056, clientDebt: 504,
    returnedToFactory: 9452, defectiveFromFactory: 0, dealerInHand: 292, warehouseAdjustment: 56,
  }, 'pallet totals equal the workbook');
  eq(committed.cashboxes.map((b: { type: string; balance: string; capital: string }) => [b.type, b.balance, b.capital]).sort(), [
    ['BANK', '1364572560.00', '0.00'], ['CASH', '428824960.00', '0.00'], ['CLICK', '25565000.00', '0.00'],
  ], 'cashboxes follow the source money columns, none needs capital');

  // ── poddon ombori va «Поддон қайтариш заводга» paneli ──
  const overview = await pallets.overview();
  eq(overview.client.balance, 504, 'customers hold 504');
  eq(overview.factory.balance, 2796, 'factories are owed 2796 = «Акт (умумий)»!T15');
  eq(overview.dealerInHand, sheetValue('Поддон қайтариш заводга', 'K6'), 'warehouse stock = panel K6 (292)');
  eq(overview.warehouseAdjustment, 56, 'БРАК −35, РАЗНИЦА +52, БРАК +39');
  eq(overview.drift, 0, 'pallet conservation');
  eq(await db.client.count({ where: { name: { in: ['БРАК', 'РАЗНИЦА', 'ОМБОР ТУЗАТИШИ'] } } }), 0, 'no fake warehouse customer');
  const adjustments = await db.palletTransaction.findMany({
    where: { importBatchId: staged.batch.id, type: 'ADJUSTMENT', clientId: null, factoryId: null }, orderBy: { date: 'asc' },
  });
  eq(adjustments.map((r) => [r.qty, r.note]), [
    [-35, 'БРАК · Excel «Поддон қайтариш» r144'],
    [52, 'РАЗНИЦА · Excel «Поддон қайтариш» r155'],
    [39, 'БРАК · Excel «Поддон қайтариш» r189'],
  ], 'three ownerless warehouse adjustments');

  // ── «Мижозлар қолдиғи»: 61 mijozning hammasi saytda o'sha qarz bilan ──
  const allClients = await db.client.findMany({ include: { agent: true } });
  eq(allClients.length, 61, 'every dictionary client exists');
  const balances = book.Sheets['Мижозлар қолдиғи'];
  for (let row = 5; row <= 65; row++) {
    const name = String(balances[`B${row}`].v);
    const client = allClients.find((c) => c.name === name);
    assert.ok(client, `source client exists: ${name}`); checks++;
    eq(client.agent?.name, String(balances[`A${row}`].v), `${name} agent`);
    const actual = await clients.detail(client.id, user);
    near(actual.debtWithoutPallets, new D(String(balances[`E${row}`].v)).neg(), `${name} debt without pallets`);
    near(actual.debtWithPallets, new D(String(balances[`M${row}`].v)).neg(), `${name} debt including pallets`);
    near(actual.palletDebtQuantity, -Number(balances[`J${row}`].v), `${name} signed pallet balance`, '0');
  }

  // ── zavodlar: «Акт (умумий)» to'liq davr (R+S) va qaytariladigan poddon (T) ──
  for (const [name, goods, combined, qty, actRow] of [['Коалс', 810640426, 924260426, 874, 13], ['Ментора', 273938028, 523798028, 1922, 14]] as const) {
    const factory = await db.factory.findFirstOrThrow({ where: { name } });
    const actual = await factories.findOne(factory.id);
    near(actual.debtWithoutPallets, goods, `${name} debt without pallets credits return expense`, '0');
    near(actual.debtWithPallets, combined, `${name} combined debt`, '0');
    near(new D(String(sheetValue('Акт (умумий)', `R${actRow}`))).plus(String(sheetValue('Акт (умумий)', `S${actRow}`))).neg(), combined, `${name} = «Акт (умумий)»`, '0');
    eq(actual.palletDebtQuantity, qty, `${name} remaining pallets`);
    eq(sheetValue('Акт (умумий)', `T${actRow}`), qty, `${name} = «Акт (умумий)»!T${actRow}`);
  }
  const summary = await debts.summary();
  near(summary.clientsDualDebt.netWithoutPallets, '954746679.94', 'debt board: clients without pallets');
  near(summary.clientsDualDebt.netWithPallets, '1020266679.94', 'debt board: clients with pallets');
  near(summary.factoriesDualDebt.netWithoutPallets, 1084578454, 'debt board: factories without pallets', '0');
  near(summary.factoriesDualDebt.netWithPallets, new D(String(sheetValue('Акт (умумий)', 'R16'))).neg(), 'debt board: factories with pallets = «Акт (умумий)»!R16', '0');

  // ── KPI: saytda 8 agent; varaqdagi 6 tasi katakma-katak, yangi 2 tasi qolgan hajm ──
  const agents = await db.agent.findMany({ orderBy: { name: 'asc' } });
  eq(agents.map((a) => a.name).sort(), ['Арслон ога', 'Жамол 22-22', 'Зафар ога', 'ДИЛЬМУРАД', 'Сардор ога', 'Темур', 'УТКИР', 'Шохрух ога'].sort(), 'all eight agents');
  const report = await kpi.report({ month: '2026-09' }, user);
  eq(report.settings.taxPerM3, '10000', 'KPI tax applied');
  const kpiSheet = book.Sheets.KPI;
  for (const [table, firstRow] of [[report.monthly, 10], [report.lifetime, 20]] as const) {
    for (let row = firstRow; row < firstRow + 6; row++) {
      const name = String(kpiSheet[`B${row}`].v);
      const r = table.rows.find((x) => x.agentName === name);
      assert.ok(r, `KPI row for ${name}`); checks++;
      // Hajm aniq. Pul ustunlari: baza buyurtma summasini tiyingacha saqlaydi (31.104 × 732 542.438 =
      // 22 784 999.99), Excel esa 22 784 999.991552 ni — 49 ta yukda bu 0.013 so'mgacha yig'iladi.
      near(r.quantityM3, String(kpiSheet[`C${row}`].v), `${name} KPI C${row}`, '0.000001');
      for (const [col, value] of [['D', r.profit], ['F', r.taxAmount], ['G', r.netProfit], ['H', r.agentKpi], ['I', r.companyProfit]] as const) {
        near(value, String(kpiSheet[`${col}${row}`].v), `${name} KPI ${col}${row}`, '0.5');
      }
    }
    eq(table.rows.some((r) => r.agentId === null), false, 'every order has an agent');
  }
  const lifetimeNew = report.lifetime.rows.filter((r) => ['УТКИР', 'ДИЛЬМУРАД'].includes(r.agentName))
    .reduce((s, r) => s.plus(r.quantityM3), new D(0));
  near(new D(String(kpiSheet.C26.v)).plus(lifetimeNew), '21175.776', 'KPI sheet total + new agents = all volume', '0.000001');

  // ── haqiqiy eksport (kompilyatsiya qilingan API) → qayta import ──
  process.env.DATABASE_URL = databaseUrl;
  process.env.JWT_SECRET = 'local-sistema-contract-test-not-a-production-secret';
  process.env.CORS_ORIGIN = 'http://localhost:4173';
  process.env.NODE_ENV = 'test';
  const { NestFactory } = require('@nestjs/core');
  const { AppModule } = require(resolve(API, 'dist/app.module.js'));
  const { ExportService } = require(resolve(API, 'dist/export/export.service.js'));
  const context = await NestFactory.createApplicationContext(AppModule, { logger: false });
  let output: Buffer;
  try { output = (await context.get(ExportService).buildWorkbook({ from: '2026-10-01', to: '2026-10-31' }, user)).buffer; }
  finally { await context.close(); }
  const exported = await parseWorkbook(output!);
  const exportFindings = runRules({ ...exported, dict: Dictionary.from(exported.master), cfg: resolveRulesConfig(null) });
  eq(exportFindings.filter((f) => f.severity === 'BLOCK').map((f) => f.message), [], 'exported workbook has no blocking import findings');
  eq(exported.shipments.length, 680, 'export keeps every shipment');

  const firstRollback = await service.rollback(staged.batch.id, user);
  eq(firstRollback.ledgerSum, '0.00', 'rollback ledger conservation');
  eq(firstRollback.cashSum, '0.00', 'rollback cash conservation');
  eq(firstRollback.palletSum, 0, 'rollback pallet conservation');
  near(await currentPalletPrice(db), 125000, 'rollback restores earlier price', '0');
  eq((await pallets.overview()).drift, 0, 'rollback keeps stock conservation');

  const roundtrip = await service.uploadAndStage(output!, 'TEST-ONLY-sistema-export-roundtrip.xlsx', user);
  eq(roundtrip.openBlockers, 0, 'generated file stages without blockers');
  const roundPreview = await service.preview(roundtrip.batch.id, 'APPEND');
  const roundResult = await service.commit(roundtrip.batch.id, roundPreview.previewHash, user, 'APPEND');
  for (const key of ['orders', 'costTotal', 'saleTotal', 'clientDebtTotal', 'clientDebtWithPallets', 'clientPaidTotal', 'clientPaidGoods', 'clientPaidPallets'] as const) {
    eq(roundResult[key], committed[key], `export/reimport ${key}`);
  }
  eq(roundResult.pallets, committed.pallets, 'export/reimport keeps customer returns and warehouse adjustments apart');
  eq(await db.client.count({ where: { name: { in: ['БРАК', 'РАЗНИЦА', 'ОМБОР ТУЗАТИШИ'] } } }), 0, 'reimport creates no fake warehouse customer');
  const roundSummary = await debts.summary();
  near(roundSummary.factoriesDualDebt.netWithPallets, 1448058454, 'roundtrip keeps combined factory debt', '0');
  const roundRollback = await service.rollback(roundtrip.batch.id, user);
  eq(roundRollback.ledgerSum, '0.00', 'roundtrip rollback ledger conservation');
  eq(roundRollback.palletSum, 0, 'roundtrip rollback pallet conservation');
  const empty = await debts.summary();
  near(empty.clientsDualDebt.netWithPallets, 0, 'client balances clear after rollback', '0');
  near(empty.factoriesDualDebt.netWithPallets, 0, 'factory balances clear after rollback', '0');
  console.log(`Система газаблок 2026-10-28 lifecycle: ${checks} checks passed.`);
}

async function main() {
  assert.ok(process.env.DATABASE_URL, 'Provide a local PostgreSQL DATABASE_URL; a separate schema is created');
  const base = new URL(process.env.DATABASE_URL!);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname), 'Only local PostgreSQL allowed');
  const schema = `smartblok_sistema_${Date.now()}_${randomBytes(6).toString('hex')}`;
  assert.match(schema, /^smartblok_sistema_\d+_[a-f0-9]{12}$/);
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
  console.error((error instanceof Error ? error.stack ?? error.message : String(error)).replace(/postgres(?:ql)?:\/\/[^\s'"`]+/gi, '[redacted PostgreSQL URL]'));
  process.exitCode = 1;
});
