/** Real party APIs against a uniquely named disposable local PostgreSQL schema. */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { ClientsService } from '../src/clients/clients.service';
import { FactoriesService } from '../src/factories/factories.service';
import { DebtsService } from '../src/debts/debts.service';
import { PalletService } from '../src/pallets/pallets.service';
import { LedgerService } from '../src/common/ledger.service';
import { AuditService } from '../src/common/audit.service';
import { SettingsService } from '../src/common/settings.service';
import { SettingsAdminService } from '../src/settings/settings-admin.service';
import { currentPalletPrice, factoryReturnExpenseCredits } from '../src/common/pallet-debt';
import { RequestUser } from '../src/common/scoping';
import { BonusService } from '../src/bonus/bonus.service';
import { FactoryReportService } from '../src/reports/factory-report.service';
import { buildFactoryReportWorkbook } from '../src/reports/factory-report.xlsx';
import { cyr } from '../src/common/translit';
import { Workbook } from 'exceljs';

const API = resolve(__dirname, '..');
let checks = 0;
function eq(actual: unknown, expected: unknown, note: string) { assert.equal(String(actual), String(expected), note); checks++; }
async function run(db: PrismaClient) {
  const prisma = db as never;
  const ledger = new LedgerService(prisma), audit = new AuditService(prisma), settings = new SettingsService(prisma);
  const pallets = new PalletService(prisma, ledger, audit, settings);
  const debts = new DebtsService(prisma, ledger, pallets);
  const clients = new ClientsService(prisma, ledger, audit);
  const factories = new FactoriesService(prisma, ledger, audit, pallets, debts);
  const settingsAdmin = new SettingsAdminService(settings, audit, prisma);
  const reports = new FactoryReportService(prisma, ledger, factories, debts, pallets, new BonusService(prisma, ledger, audit));
  const user = await db.user.create({ data: { username: 'dual-debt-admin', name: 'Test', password: 'unusable', role: 'ADMIN' } });
  const actor: RequestUser = { userId: user.id, username: user.username, name: user.name, role: 'ADMIN', agentId: null };
  const warehouseClient = await db.client.create({ data: { name: 'Warehouse test client' } });
  const warehouseFactory = await db.factory.create({ data: { name: 'Warehouse test factory' } });
  const warehouseDate = new Date('2026-09-30T00:00:00Z');
  await db.palletTransaction.createMany({ data: [
    { type: 'RECEIVED_FROM_FACTORY', factoryId: warehouseFactory.id, qty: 200, date: warehouseDate },
    { type: 'DELIVERED_TO_CLIENT', clientId: warehouseClient.id, qty: 200, date: warehouseDate },
    { type: 'RETURNED_BY_CLIENT', clientId: warehouseClient.id, qty: 169, date: warehouseDate },
  ] });
  eq(await pallets.dealerInHand(), 169, 'warehouse initial loose stock');
  eq((await pallets.overview()).drift, 0, 'initial stock reconciles');
  const damage = await db.palletTransaction.create({ data: { type: 'ADJUSTMENT', qty: -52,
    date: warehouseDate, note: 'БРАК · Excel «Поддон қайтариш» r144' } });
  eq(await pallets.dealerInHand(), 117, 'warehouse damage removes 52 physical pallets');
  eq(await pallets.clientPalletBalance(warehouseClient.id), 31, 'warehouse damage does not charge a client');
  eq(await pallets.factoryPalletBalance(warehouseFactory.id), 200, 'warehouse damage retains factory obligation');
  eq((await pallets.overview()).warehouseAdjustment, -52, 'warehouse write-off exposed separately');
  eq((await pallets.overview()).drift, 0, 'documented warehouse damage is not false drift');
  const damageReversal = await db.palletTransaction.create({ data: { type: 'REVERSAL', qty: 52,
    date: warehouseDate, reversalOfId: damage.id, reversalOfType: 'ADJUSTMENT', note: 'import rollback' } });
  eq(await pallets.dealerInHand(), 169, 'warehouse adjustment rollback restores stock');
  eq((await pallets.overview()).warehouseAdjustment, 0, 'warehouse rollback clears adjustment total');
  eq((await pallets.overview()).drift, 0, 'rollback conservation still reconciles');
  await db.palletTransaction.delete({ where: { id: damageReversal.id } });
  await db.palletTransaction.deleteMany({ where: { OR: [
    { id: damage.id }, { clientId: warehouseClient.id }, { factoryId: warehouseFactory.id },
  ] } });
  await db.client.delete({ where: { id: warehouseClient.id } });
  await db.factory.delete({ where: { id: warehouseFactory.id } });
  const agent = await db.agent.create({ data: { name: 'Own agent' } });
  const client = await db.client.create({ data: { name: 'Debt client', agentId: agent.id } });
  const advance = await db.client.create({ data: { name: 'Advance client' } });
  const factory = await db.factory.create({ data: { name: 'Debt factory' } });
  const otherFactory = await db.factory.create({ data: { name: 'Other factory' } });
  const batch = await db.importBatch.create({ data: { filename: 'synthetic.xlsx', status: 'COMMITTED' } });
  const cashbox = await db.cashbox.create({ data: { name: 'Cash', type: 'CASH' } });
  const category = await db.expenseCategory.create({ data: { name: 'Paddon qaytarish harajati' } });
  const date = new Date('2026-10-01T00:00:00Z');
  await db.ledgerEntry.createMany({ data: [
    { account: 'CLIENT', source: 'ADJUSTMENT', clientId: client.id, amount: 760000, date },
    { account: 'CLIENT', source: 'ADJUSTMENT', clientId: advance.id, amount: -2000000, date },
    { account: 'FACTORY', source: 'ADJUSTMENT', factoryId: factory.id, factoryBucket: 'PAYABLE', amount: -800000, date },
    { account: 'FACTORY', source: 'ADJUSTMENT', factoryId: factory.id, factoryBucket: 'ADVANCE_CASH', amount: 600000, date },
  ] });
  await db.palletTransaction.createMany({ data: [
    { type: 'DELIVERED_TO_CLIENT', clientId: client.id, qty: 10, date },
    { type: 'RETURNED_BY_CLIENT', clientId: client.id, qty: 3, date },
    { type: 'CHARGED_LOST', clientId: client.id, qty: 2, unitPrice: 130000, date },
    { type: 'DELIVERED_TO_CLIENT', clientId: advance.id, qty: 5, date },
    { type: 'RECEIVED_FROM_FACTORY', factoryId: factory.id, qty: 10, date },
    { type: 'RETURNED_TO_FACTORY', factoryId: factory.id, qty: 3, date, note: 'Excel «Поддон қайтариш заводга» r3', importBatchId: batch.id },
  ] });
  const expense = await db.expense.create({ data: { amount: 30000, date, categoryId: category.id, cashboxId: cashbox.id,
    importBatchId: batch.id, note: 'Excel «Поддон қайтариш заводга» r3 · expense annotation' } });
  await db.cashTransaction.create({ data: { cashboxId: cashbox.id, amount: 30000, date, direction: 'OUT', source: 'EXPENSE', expenseId: expense.id } });
  eq((await factoryReturnExpenseCredits(prisma)).get(factory.id), 30000, 'provenance matches despite additional note');
  eq((await factoryReturnExpenseCredits(prisma, batch.id)).get(factory.id), 30000, 'batch scoped expense credit');
  eq((await factoryReturnExpenseCredits(prisma, 'other-batch')).size, 0, 'batch scope excludes other imports');
  await db.expenseCategory.update({ where: { id: category.id }, data: { name: 'Renamed return expense category' } });
  eq((await factoryReturnExpenseCredits(prisma)).get(factory.id), 30000, 'renaming an expense category cannot change financial debt');
  const cd = await clients.detail(client.id, actor);
  eq(cd.debtWithoutPallets, 760000, 'client base is existing ledger, not sale recomputation');
  eq(cd.palletDebtQuantity, 5, 'paid and returned pallets both deducted');
  eq(cd.debtWithPallets, 1410000, 'client combined balance');
  const fd = await factories.findOne(factory.id);
  eq(fd.debtWithoutPallets, 170000, 'factory advances and return expense both deducted once');
  eq(fd.debtWithPallets, 1080000, 'factory combined balance');
  eq(fd.payable, -800000, 'gross payable is preserved, not automatically consumed');
  eq(fd.advanceCash, 600000, 'gross advance preserved');
  const reportQuery = { factoryId: factory.id, from: '2025-01-01', to: '2025-01-31' };
  const report = await reports.factoryReport(reportQuery);
  eq(report.balances.currentDualDebt.debtWithoutPallets, '170000.00', 'factory report current base matches factory card');
  eq(report.balances.currentDualDebt.debtWithPallets, '1080000.00', 'factory report current combined debt matches card');
  eq(report.balances.currentDualDebt.factoryReturnExpenseCredit, '30000.00', 'report applies current return expense credit');
  eq(report.balances.asOfPeriodEnd.net, '0.00', 'historical period is not populated with current debt');
  eq('debtWithPallets' in report.balances.asOfPeriodEnd, false, 'historical balance never pretends to use current pallet count');
  eq(report.purchase.palletsReceived, 0, 'period pallet movements stay period-scoped');
  eq(report.balances.currentDualDebt.palletDebtQuantity, 7, 'current outstanding count stays all-time');
  const file = await buildFactoryReportWorkbook({ report, orders: await reports.factoryReportOrders(reportQuery) }, { name: 'Test', role: 'ADMIN' });
  const book = new Workbook(); await book.xlsx.load(file.buffer as never);
  const sheet = book.getWorksheet(cyr('Xulosa'))!;
  const summaryValue = (label: string) => {
    let value: unknown;
    sheet.eachRow((row) => { if (row.getCell(1).text === cyr(label)) value = row.getCell(2).value; });
    return value;
  };
  eq(summaryValue('Poddonsiz sof balans'), 170000, 'factory XLSX contains current base debt');
  eq(summaryValue('Poddon bilan sof balans'), 1080000, 'factory XLSX contains current combined debt');
  eq(summaryValue('Qaytarish xarajati chegirmasi'), 30000, 'factory XLSX explains expense credit');
  const cl = await clients.list(actor, { page: 1, pageSize: 1 });
  eq(cl.summary.netWithPallets, 60000, 'client full-filter summary includes unlisted page');
  const fl = await factories.findAll(actor, { page: 1, pageSize: 1 });
  assert.ok('debtSummary' in fl); checks++;
  eq(fl.debtSummary.netWithPallets, 1080000, 'factory full-filter summary');
  const summary = await debts.summary();
  eq(summary.clientsDualDebt.netWithPallets, 60000, 'debt board client summary agrees');
  eq(summary.factoriesDualDebt.netWithPallets, 1080000, 'debt board factory summary agrees');
  eq((await debts.clients(actor, {})).items.length, 2, 'advance client with remaining pallets remains on board');
  const own = await clients.list({ ...actor, role: 'AGENT', agentId: agent.id }, {});
  eq(own.items.length, 1, 'dual debt maintains agent scope');
  const agentFactory = await factories.findAll({ ...actor, role: 'AGENT', agentId: agent.id }, {});
  eq('debtWithPallets' in agentFactory.items[0], false, 'no factory financial leak to agents');
  await db.appSetting.create({ data: { key: 'palletPriceDefault', value: { amount: '145000', _importBatchId: batch.id } } });
  eq(await currentPalletPrice(prisma), 145000, 'import price object normalized for calculations');
  eq(await settings.get('palletPriceDefault'), 145000, 'settings API get hides provenance');
  eq((await settings.all()).palletPriceDefault, 145000, 'settings all hides provenance');
  const beforeCash = await db.cashTransaction.count(), beforeLedger = await db.ledgerEntry.count();
  await settingsAdmin.update('palletPriceDefault', '150000.25', actor);
  eq((await clients.detail(client.id, actor)).debtWithPallets, '1510001.25', 'new price revalues only remaining quantity');
  eq((await factories.findOne(factory.id)).debtWithPallets, '1220001.75', 'same setting revalues factory side');
  const repricedReport = await reports.factoryReport(reportQuery);
  eq(repricedReport.balances.currentDualDebt.debtWithPallets, '1220001.75', 'factory report follows changed global price');
  eq(repricedReport.balances.asOfPeriodEnd.net, '0.00', 'current price change does not alter historical ledger');
  eq((await db.palletTransaction.findFirstOrThrow({ where: { type: 'CHARGED_LOST' } })).unitPrice, 130000, 'historical paid pallet price unchanged');
  eq(await db.cashTransaction.count(), beforeCash, 'price update posts no cash');
  eq(await db.ledgerEntry.count(), beforeLedger, 'price update posts no ledger');
  eq(typeof (await db.appSetting.findUniqueOrThrow({ where: { key: 'palletPriceDefault' } })).value, 'number', 'manual write clears import provenance');
  eq(await db.auditLog.count({ where: { entity: 'AppSetting' } }), 1, 'price update audit transaction');
  for (const invalid of [0, -1, '0.001', '1000000000000', 'Infinity', null]) {
    await assert.rejects(() => settingsAdmin.update('palletPriceDefault', invalid, actor)); checks++;
  }
  await db.palletTransaction.create({ data: { type: 'RETURNED_TO_FACTORY', factoryId: factory.id, qty: 1, date,
    note: 'Excel «Поддон қайтариш заводга» r3 duplicate', importBatchId: batch.id } });
  eq((await factoryReturnExpenseCredits(prisma)).get(factory.id), 30000, 'same-factory duplicate provenance does not double expense');
  await db.cashTransaction.create({ data: { cashboxId: cashbox.id, amount: 5000, date, direction: 'IN', source: 'EXPENSE', expenseId: expense.id } });
  eq((await factoryReturnExpenseCredits(prisma)).get(factory.id), 25000, 'signed expense reversal offsets credit');
  await db.palletTransaction.create({ data: { type: 'RETURNED_TO_FACTORY', factoryId: otherFactory.id, qty: 1, date,
    note: 'Excel «Поддон қайтариш заводга» r3 ambiguous', importBatchId: batch.id } });
  eq((await factoryReturnExpenseCredits(prisma)).size, 0, 'ambiguous factory provenance is not guessed');
  await db.palletTransaction.deleteMany({ where: { factoryId: otherFactory.id } });
  await db.expense.update({ where: { id: expense.id }, data: { voidedAt: new Date() } });
  eq((await factoryReturnExpenseCredits(prisma)).size, 0, 'voided expense excluded');
  const original = await db.palletTransaction.create({ data: { type: 'DELIVERED_TO_CLIENT', clientId: client.id, qty: 4, date } });
  await db.palletTransaction.create({ data: { type: 'REVERSAL', clientId: client.id, qty: -4, date, reversalOfId: original.id, reversalOfType: original.type } });
  eq((await clients.detail(client.id, actor)).palletDebtQuantity, 5, 'cancelled delivery nets to zero');
  const returned = await db.palletTransaction.findFirstOrThrow({ where: { type: 'RETURNED_BY_CLIENT', clientId: client.id } });
  await db.palletTransaction.create({ data: { type: 'REVERSAL', clientId: client.id, qty: 1, date,
    reversalOfId: returned.id, reversalOfType: 'RETURNED_BY_CLIENT', importBatchId: batch.id } });
  eq((await clients.detail(client.id, actor)).palletDebtQuantity, 6, 'signed imported return reverses one returned pallet');
}

async function main() {
  const url = new URL(process.env.DUAL_DEBT_TEST_DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:55433/postgres');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Only local PostgreSQL allowed');
  const schema = `dual_debt_test_${Date.now()}_${randomBytes(6).toString('hex')}`;
  assert.match(schema, /^dual_debt_test_\d+_[a-f0-9]{12}$/);
  const isolated = new URL(url); isolated.searchParams.set('schema', schema); isolated.searchParams.set('connection_limit', '3');
  for (const entry of readdirSync(resolve(API, 'prisma/migrations'), { withFileTypes: true }).filter((e) => e.isDirectory())) {
    const sql = readFileSync(resolve(API, 'prisma/migrations', entry.name, 'migration.sql'), 'utf8');
    assert.ok(!/(?:\bpublic|"public")\s*\./i.test(sql), 'public-targeted migrations forbidden');
  }
  const admin = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const db = new PrismaClient({ datasources: { db: { url: isolated.toString() } } });
  let created = false;
  try {
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`); created = true;
    const migration = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
      cwd: API, env: { ...process.env, DATABASE_URL: isolated.toString() }, encoding: 'utf8', timeout: 120000, windowsHide: true,
    });
    if (migration.status !== 0) throw new Error('Disposable schema migration failed');
    eq((await db.$queryRaw<{ schema: string }[]>`SELECT current_schema() AS schema`)[0].schema, schema, 'exact disposable schema');
    await run(db);
    console.log(`Dual debt lifecycle: ${checks} assertions passed`);
  } finally {
    await db.$disconnect();
    if (created) await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.$disconnect();
  }
}
main().catch((e) => { console.error(String(e.message ?? e).replace(/postgres(?:ql)?:\/\/[^\s'"`]+/gi, '[redacted PostgreSQL URL]')); process.exitCode = 1; });
