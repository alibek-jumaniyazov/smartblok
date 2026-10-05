/** Daily financial report integration checks, exclusively in a disposable local schema. */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PrismaClient, Prisma } from '@prisma/client';
import { Workbook } from 'exceljs';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { sign } from 'jsonwebtoken';
import { hashSync } from 'bcryptjs';
import type { DailyReport } from '../src/dashboard/daily-report.types';

const API = resolve(__dirname, '..');
const D = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
let checks = 0;
function eq(actual: unknown, expected: unknown, message: string) {
  assert.equal(String(actual), String(expected), message); checks++;
}
function ok(value: unknown, message: string) { assert.ok(value, message); checks++; }
function cell(report: DailyReport, key: string, day = 0) {
  const row = report.rows.find((r) => r.key === key);
  assert.ok(row, `report row ${key}`);
  return D(row.values[day]);
}
function total(report: DailyReport, key: string) {
  const row = report.rows.find((r) => r.key === key);
  assert.ok(row, `report row ${key}`);
  return D(row.total);
}
function invariantChecks(report: DailyReport) {
  const amount = (key: string, day: number) => {
    const row = report.rows.find((r) => r.key === key);
    return D(row?.values[day] ?? 0);
  };
  for (let day = 0; day < report.days.length; day++) {
    const n = (key: string) => amount(key, day);
    eq(n('moneyClosing'), n('moneyOpening').minus(n('goodsReceived')).plus(n('factoryPayments'))
      .plus(n('returnExpenseCredit')).plus(n('moneyAdjustments')), `money equation ${report.days[day]}`);
    eq(n('palletClosing'), n('palletOpening').minus(n('palletReceived')).plus(n('palletReturned'))
      .plus(n('palletDefective')).plus(n('palletAdjustments')), `pallet equation ${report.days[day]}`);
    eq(n('palletValue'), n('palletClosing').mul(report.palletUnitPrice), `pallet valuation ${report.days[day]}`);
    eq(n('totalDebt'), n('moneyClosing').plus(n('palletValue')), `combined debt ${report.days[day]}`);
    eq(n('factoryMargin'), n('factoryList').minus(n('factoryCost')), `factory spread ${report.days[day]}`);
    eq(n('salesMargin'), n('saleAmount').minus(n('salesList')), `sales spread ${report.days[day]}`);
    eq(n('totalMargin'), n('factoryMargin').plus(n('salesMargin')), `combined spread ${report.days[day]}`);
    if (day > 0) {
      eq(n('moneyOpening'), amount('moneyClosing', day - 1), 'money carries forward');
      eq(n('palletOpening'), amount('palletClosing', day - 1), 'pallets carry forward');
    }
  }
  for (const row of report.rows) {
    eq(row.values.length, report.days.length, `${row.key} rectangular matrix`);
    const expected = row.totalMode === 'sum' ? row.values.reduce((sum, value) => sum.plus(value), D(0))
      : D(row.values[row.totalMode === 'opening' ? 0 : report.days.length - 1]);
    eq(D(row.total), expected, `${row.key} period total respects flow/opening/closing semantics`);
  }
}

async function workbookChecks(buffer: Buffer, report: DailyReport) {
  const book = new Workbook(); await book.xlsx.load(buffer as never);
  eq(book.worksheets.length, 2, 'focused report and explanation worksheets');
  const sheet = book.getWorksheet('Kunlik hisobot')!;
  ok(sheet, 'financial matrix exists');
  eq(sheet.views[0].state, 'frozen', 'heading and labels frozen');
  eq(sheet.getCell('B3').value, Number(report.palletUnitPrice), 'configured pallet valuation exported');
  report.days.forEach((day, i) => eq((sheet.getRow(6).getCell(i + 2).value as Date).toISOString().slice(0, 10), day, 'Excel business date'));
  let position = 7, previous: string | undefined;
  for (const row of report.rows) {
    if (previous && previous !== row.section) position++;
    previous = row.section;
    eq(sheet.getCell(position, 1).value, row.label, `Excel label ${row.key}`);
    row.values.forEach((value, i) => eq(D(String(sheet.getCell(position, i + 2).value)), D(value), `Excel/API parity ${row.key} day ${i}`));
    const aggregate = sheet.getCell(position, report.days.length + 2);
    eq(D(String(aggregate.result ?? aggregate.value)), D(row.total), `Excel/API total parity ${row.key}`);
    ok(aggregate.formula, `${row.key} total has formula`);
    if (row.totalMode !== 'sum') ok(!aggregate.formula!.includes('SUM'), `${row.key} balance is not summed`);
    else ok(aggregate.formula!.includes('ROUND(SUM('), `${row.key} flow total rounds to money precision`);
    position++;
  }
  let errors = 0, uncached = 0;
  book.eachSheet((ws) => ws.eachRow((row) => row.eachCell((entry) => {
    if (entry.type === 10) errors++;
    if (entry.type === 6 && entry.result === undefined) uncached++;
  })));
  eq(errors, 0, 'no Excel error values'); eq(uncached, 0, 'all formulas have cached results');
  const explanation: string[] = [];
  book.getWorksheet('Izohlar')!.eachRow((row) => row.eachCell((entry) => explanation.push(entry.text)));
  for (const warning of report.warnings) ok(explanation.includes(warning), 'data warning also exported');
}

async function seedScreenshot(db: PrismaClient) {
  const users = {} as Record<'ADMIN' | 'ACCOUNTANT' | 'AGENT' | 'CASHIER', { id: string }>;
  const agent = await db.agent.create({ data: { name: 'Daily report test agent' } });
  for (const role of ['ADMIN', 'ACCOUNTANT', 'AGENT', 'CASHIER'] as const) {
    users[role] = await db.user.create({ data: { username: `daily-test-${role}`, name: role, password: hashSync('DailyReportTest123!', 4), role,
      ...(role === 'AGENT' ? { agentId: agent.id } : {}) } });
  }
  const factory = await db.factory.create({ data: { name: 'Screenshot factory' } });
  const client = await db.client.create({ data: { name: 'Screenshot client', agentId: agent.id } });
  const product = await db.product.create({ data: { name: 'Gazoblok', size: 'test', factoryId: factory.id } });
  await db.appSetting.create({ data: { key: 'palletPriceDefault', value: 130000 } });
  const before = new Date('2026-09-25T18:59:59.999Z');
  const date = new Date('2026-09-25T19:00:00Z'); // 26 September, exactly midnight in Tashkent.
  const future = new Date('2026-10-05T10:00:00Z');
  await db.ledgerEntry.create({ data: { account: 'FACTORY', factoryId: factory.id, factoryBucket: 'PAYABLE',
    source: 'IMPORT', amount: -628795054, date: before } });
  await db.palletTransaction.create({ data: { factoryId: factory.id, type: 'ADJUSTMENT', qty: 3818, date: before } });
  const order = await db.order.create({ data: { orderNo: 'SCREENSHOT', date, factoryId: factory.id, clientId: client.id,
    status: 'COMPLETED', costStatus: 'FINAL', costTotal: 113221152, saleTotal: 141834240,
    transportMode: 'CLIENT_PAYS_DRIVER', transportCost: 16800000, transportPaidStatus: 'PAID_BY_CLIENT',
    items: { create: { productId: product.id, quantityM3: '196.992', costPricePerM3: 605000,
      finalCostPricePerM3: 574750, costTotal: 113221152, salePricePerM3: 720000, saleTotal: 141834240 } } } });
  await db.ledgerEntry.create({ data: { account: 'FACTORY', factoryId: factory.id, factoryBucket: 'PAYABLE',
    source: 'ORDER_COST', orderId: order.id, date, amount: -113221152 } });
  await db.palletTransaction.create({ data: { factoryId: factory.id, orderId: order.id, type: 'RECEIVED_FROM_FACTORY', qty: 114, date } });
  // Owner off-book corrections, client balances and warehouse movements do not affect this company report.
  const offbook = await db.ledgerEntry.create({ data: { account: 'FACTORY', factoryId: factory.id, factoryBucket: 'PAYABLE',
    source: 'OFFBOOK_ADJUSTMENT', date, amount: 456789 } });
  await db.ledgerEntry.createMany({ data: [
    { account: 'FACTORY', factoryId: factory.id, factoryBucket: 'PAYABLE', source: 'ADJUSTMENT', date: future,
      amount: -456789, reversalOfId: offbook.id },
    { account: 'FACTORY', factoryId: factory.id, factoryBucket: 'PAYABLE', source: 'OFFBOOK_ADJUSTMENT', date: before, amount: 123456 },
    { account: 'CLIENT', clientId: client.id, source: 'ADJUSTMENT', date, amount: 999999 },
  ] });
  await db.palletTransaction.createMany({ data: [
    { type: 'ADJUSTMENT', qty: -52, date },
    { clientId: client.id, type: 'DELIVERED_TO_CLIENT', qty: 100, date },
  ] });
  const cancelled = await db.order.create({ data: { orderNo: 'CANCELLED', date, factoryId: factory.id, clientId: client.id,
    status: 'CANCELLED', cancelledAt: future, costTotal: 999, saleTotal: 9999,
    items: { create: { productId: product.id, quantityM3: 1, costPricePerM3: 999, costTotal: 999, saleTotal: 9999 } } } });
  const cancelledCost = await db.ledgerEntry.create({ data: { account: 'FACTORY', factoryId: factory.id, factoryBucket: 'PAYABLE',
    source: 'ORDER_COST', orderId: cancelled.id, date, amount: -999 } });
  await db.ledgerEntry.create({ data: { account: 'FACTORY', factoryId: factory.id, factoryBucket: 'PAYABLE',
    source: 'ORDER_CANCEL', orderId: cancelled.id, date: future, amount: 999, reversalOfId: cancelledCost.id } });
  const cancelledPallet = await db.palletTransaction.create({ data: { factoryId: factory.id, orderId: cancelled.id,
    type: 'RECEIVED_FROM_FACTORY', date, qty: 6 } });
  await db.palletTransaction.create({ data: { factoryId: factory.id, orderId: cancelled.id,
    type: 'REVERSAL', date: future, qty: -6, reversalOfId: cancelledPallet.id, reversalOfType: 'RECEIVED_FROM_FACTORY' } });
  return { users, factory, client, product };
}

async function seedEdgeCases(db: PrismaClient, seeded: Awaited<ReturnType<typeof seedScreenshot>>) {
  const factory = await db.factory.create({ data: { name: 'Second factory' } });
  const product = await db.product.create({ data: { factoryId: factory.id, name: 'Second product', size: 'test' } });
  const before = new Date('2026-09-25T18:59:59.999Z');
  const date = new Date('2026-09-26T19:00:00Z'); // September 27, not UTC September 26.
  const next = new Date('2026-09-27T19:00:00Z');
  const future = new Date('2026-10-05T10:00:00Z');
  const ledger = (data: Omit<Prisma.LedgerEntryUncheckedCreateInput, 'account' | 'factoryId' | 'factoryBucket'>) =>
    db.ledgerEntry.create({ data: { ...data, account: 'FACTORY', factoryId: factory.id, factoryBucket: 'PAYABLE' } });
  await ledger({ source: 'IMPORT', amount: '-100.25', date: before });
  await db.palletTransaction.create({ data: { factoryId: factory.id, type: 'ADJUSTMENT', qty: 2, date: before } });
  const order = await db.order.create({ data: { orderNo: 'FINAL-COST', clientId: seeded.client.id, factoryId: factory.id, date,
    status: 'COMPLETED', costStatus: 'FINAL', costTotal: 80, saleTotal: 120, transportMode: 'CLIENT_OWN',
    items: { create: { productId: product.id, quantityM3: 1, costPricePerM3: 100, finalCostPricePerM3: 80, costTotal: 80,
      saleTotal: 120, salePricePerM3: 120, listPricePerM3: 987654 } } } });
  await ledger({ source: 'ORDER_COST', orderId: order.id, amount: -100, date });
  await ledger({ source: 'COST_ADJUSTMENT', orderId: order.id, amount: 20, date });
  for (const [kind, amount, voided] of [['FACTORY_OUT', 30, false], ['FACTORY_REFUND', 5, false], ['FACTORY_OUT', 7, true]] as const) {
    const payment = await db.payment.create({ data: { factoryId: factory.id, kind, amount, date, ...(voided ? { voidedAt: future } : {}) } });
    const entry = await ledger({ source: 'PAYMENT', paymentId: payment.id, amount: kind === 'FACTORY_REFUND' ? -amount : amount, date });
    if (voided) await ledger({ source: 'PAYMENT_VOID', paymentId: payment.id, amount: -amount, date: future, reversalOfId: entry.id });
  }
  await ledger({ source: 'ADJUSTMENT', amount: '2.50', date });
  await db.palletTransaction.create({ data: { factoryId: factory.id, type: 'RECEIVED_FROM_FACTORY', qty: 10, date } });
  const batch = await db.importBatch.create({ data: { filename: 'daily-report-fixture.xlsx' } });
  const returned = await db.palletTransaction.create({ data: { factoryId: factory.id, type: 'RETURNED_TO_FACTORY', qty: 4, date,
    importBatchId: batch.id, note: 'Excel «Pallets» r27' } });
  await db.palletTransaction.create({ data: { factoryId: factory.id, type: 'REVERSAL', qty: 1, date: future,
    reversalOfId: returned.id, reversalOfType: 'RETURNED_TO_FACTORY' } });
  await db.palletTransaction.create({ data: { factoryId: factory.id, type: 'ADJUSTMENT', qty: -2, date } });
  const cashbox = await db.cashbox.create({ data: { name: 'Daily test cashbox', type: 'CASH' } });
  const expense = await db.expense.create({ data: { date, amount: '5.25', importBatchId: batch.id, note: 'Excel «Pallets» r27: return delivery' } });
  await db.cashTransaction.createMany({ data: [
    { cashboxId: cashbox.id, expenseId: expense.id, source: 'EXPENSE', direction: 'OUT', amount: '5.25', date },
    { cashboxId: cashbox.id, expenseId: expense.id, source: 'MANUAL', direction: 'IN', amount: 2, date },
  ] });
  const voidExpense = await db.expense.create({ data: { date, amount: 1000, importBatchId: batch.id, note: 'Excel «Pallets» r27', voidedAt: future } });
  const ordinaryExpense = await db.expense.create({ data: { date, amount: 2000, note: 'Excel «Pallets» r27' } });
  await db.cashTransaction.createMany({ data: [voidExpense, ordinaryExpense].map((e) => ({ cashboxId: cashbox.id, expenseId: e.id,
    source: 'EXPENSE', direction: 'OUT', amount: e.amount, date })) });
  const split = await db.order.create({ data: { orderNo: 'DECIMAL-SPLIT', date: next, clientId: seeded.client.id, factoryId: factory.id,
    costStatus: 'FINAL', costTotal: '.02', saleTotal: '.06', transportMode: 'CLIENT_OWN',
    items: { create: [
      { productId: product.id, quantityM3: '.001', costPricePerM3: '5.000001', costTotal: '.01', salePricePerM3: 30, saleTotal: '.03' },
      { productId: product.id, quantityM3: '.001', costPricePerM3: '5.000001', costTotal: '.01', salePricePerM3: 30, saleTotal: '.03' },
      { productId: product.id, quantityM3: 99, actualQuantityM3: 0, costPricePerM3: 999, costTotal: 0, saleTotal: 0 },
    ] } } });
  await ledger({ source: 'ORDER_COST', orderId: split.id, amount: '-.02', date: next });
  const pending = await db.order.create({ data: { orderNo: 'PENDING-PRICE', date: next, clientId: seeded.client.id, factoryId: factory.id,
    costStatus: 'PROVISIONAL', costTotal: 10, saleTotal: 0,
    items: { create: { productId: product.id, quantityM3: 1, costPricePerM3: 10, costTotal: 10, pricePending: true } } } });
  await ledger({ source: 'ORDER_COST', orderId: pending.id, amount: -10, date: next });
  await ledger({ source: 'ADJUSTMENT', date: new Date('2026-09-28T18:59:59.999Z'), amount: '.01' });
  await ledger({ source: 'ADJUSTMENT', date: new Date('2026-09-28T19:00:00Z'), amount: 1000 });
}

async function run(db: PrismaClient) {
  const seeded = await seedScreenshot(db);
  // Compiled modules retain Nest's constructor metadata, so these exercise actual auth guards and DI.
  const { AppModule } = require('../dist/app.module');
  const { DailyReportService, dailyReportWindow } = require('../dist/dashboard/daily-report.service');
  const { dailyReportWorkbook } = require('../dist/dashboard/daily-report.xlsx');
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(Number(process.env.DAILY_REPORT_REVIEW_PORT) || 0, '127.0.0.1');
  try {
    const service = app.get(DailyReportService) as { report(q: { from: string; to: string }): Promise<DailyReport> };
    const screenshot = await service.report({ from: '2026-09-26', to: '2026-09-30' });
    eq(screenshot.days.join(','), '2026-09-26,2026-09-27,2026-09-28,2026-09-29,2026-09-30', 'inclusive ordered date columns');
    for (const [key, expected] of Object.entries({ moneyOpening: -628795054, goodsReceived: 113221152, factoryPayments: 0,
      moneyClosing: -742016206, palletOpening: -3818, palletReceived: 114, palletReturned: 0, palletClosing: -3932,
      palletValue: -511160000, totalDebt: -1253176206, factoryCost: 113221152, factoryList: 119180160,
      factoryMargin: 5959008, saleAmount: 125034240, salesMargin: 5854080, totalMargin: 11813088 })) {
      eq(cell(screenshot, key), expected, `screenshot financial fixture ${key}`);
    }
    eq(total(screenshot, 'moneyOpening'), -628795054, 'total opening is first opening, not five-day sum');
    eq(total(screenshot, 'moneyClosing'), -742016206, 'total closing is last closing');
    eq(total(screenshot, 'goodsReceived'), 113221152, 'flow totals exclude prior-history opening');
    eq(screenshot.warnings.length, 0, 'finalized screenshot fixture has no pending warnings');
    for (let day = 1; day < 5; day++) {
      eq(cell(screenshot, 'moneyClosing', day), -742016206, 'empty day money carry');
      eq(cell(screenshot, 'palletClosing', day), -3932, 'empty day pallet carry');
      eq(cell(screenshot, 'goodsReceived', day), 0, 'empty day no goods');
    }
    invariantChecks(screenshot);
    // Regression for Prisma's timestamptz parameters compared to UTC timestamp columns.
    // Pin each session locally so the boundary test cannot pass merely because a developer's DB uses UTC.
    for (const timezone of ['UTC', 'Asia/Tashkent', 'America/New_York']) {
      const zonedService = new DailyReportService({
        $transaction: (read: (tx: Prisma.TransactionClient) => Promise<DailyReport>, options: any) => db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT set_config('TimeZone', ${timezone}, true)`;
          return read(tx);
        }, options),
      });
      const zoned = await zonedService.report({ from: screenshot.from, to: screenshot.to });
      eq(JSON.stringify(zoned.rows), JSON.stringify(screenshot.rows), `UTC business bounds independent of session timezone ${timezone}`);
    }
    await workbookChecks(await dailyReportWorkbook(screenshot), screenshot);
    const oneDay = await service.report({ from: '2026-09-26', to: '2026-09-26' });
    eq(oneDay.days.length, 1, 'single-day request');
    await workbookChecks(await dailyReportWorkbook(oneDay), oneDay);

    await seedEdgeCases(db, seeded);
    const report = await service.report({ from: '2026-09-26', to: '2026-09-28' });
    eq(cell(report, 'moneyOpening'), '-628795154.25', 'opening sums both factories before exact Tashkent midnight');
    eq(cell(report, 'palletOpening'), -3820, 'opening includes second factory in-kind balance');
    eq(cell(report, 'goodsReceived', 1), 80, 'cost adjustment reduces same-day received cost');
    eq(cell(report, 'factoryPayments', 1), 25, 'payout minus refund and voided payment nets once');
    eq(cell(report, 'moneyAdjustments', 1), '2.5', 'explicit signed adjustment');
    eq(cell(report, 'returnExpenseCredit', 1), '3.25', 'linked active return expense credited with signed cash net');
    eq(cell(report, 'moneyClosing', 1), '-742016355.5', 'all second-day settlement components reconcile');
    eq(cell(report, 'palletReturned', 1), 3, 'future reversal corrects original return day');
    eq(cell(report, 'palletAdjustments', 1), 2, 'negative raw factory correction reduces our pallet debt');
    eq(cell(report, 'palletClosing', 1), -3939, 'all factory pallet movements reconcile');
    eq(cell(report, 'factoryList', 1), 100, 'factory book snapshot, not unrelated dealer list price');
    eq(cell(report, 'factoryMargin', 1), 20, 'actual factory cost uses finalized stored total');
    eq(cell(report, 'factoryList', 2), '10.02', 'round individual six-decimal split items; explicit actual zero retained');
    eq(cell(report, 'goodsReceived', 2), '10.02', 'pending order cost still belongs to payable balance');
    eq(cell(report, 'saleAmount', 2), '0.06', 'unpriced sale does not fabricate revenue');
    eq(cell(report, 'moneyClosing', 2), '-742016365.51', 'upper bound includes final millisecond and excludes next midnight');
    eq(report.provisionalOrderCount, 1, 'nonfinal cost counted');
    eq(report.warnings.length, 2, 'unsettled cost and missing sale price disclosed separately');
    invariantChecks(report);
    await workbookChecks(await dailyReportWorkbook(report), report);
    const carry = await service.report({ from: '2026-09-28', to: '2026-09-28' });
    eq(cell(carry, 'moneyOpening'), cell(report, 'moneyClosing', 1), 'historical payments and expense credits enter next opening');
    eq(cell(carry, 'palletOpening'), cell(report, 'palletClosing', 1), 'historical pallet reversal reflected in next opening');
    const old = await service.report({ from: '2020-01-01', to: '2020-01-02' });
    ok(old.rows.every((r) => r.values.every((v) => D(v).isZero()) && D(r.total).isZero()), 'empty prehistory produces zeros');
    await db.appSetting.update({ where: { key: 'palletPriceDefault' }, data: { value: '150000.25' } });
    const repriced = await service.report({ from: report.from, to: report.to });
    eq(repriced.palletUnitPrice, '150000.25', 'current configured pallet price with cents');
    for (const row of report.rows.filter((r) => !['palletValue', 'totalDebt'].includes(r.key))) {
      eq(JSON.stringify(repriced.rows.find((r) => r.key === row.key)), JSON.stringify(row), `${row.key} unchanged by pallet revaluation`);
    }
    eq(cell(repriced, 'palletValue', 2), D(-3939).mul('150000.25'), 'only in-kind valuation is repriced');
    invariantChecks(repriced);

    for (const q of [{ from: '2026-02-31', to: '2026-03-01' }, { from: '2026-09-27', to: '2026-09-26' },
      { from: '2026-13-01', to: '2026-13-02' }, { from: '2026-9-26', to: '2026-09-26' }, { from: '2000-01-01', to: '2026-01-01' }]) {
      await assert.rejects(() => service.report(q), (error: any) => error.getStatus() === 400); checks++;
    }
    eq(dailyReportWindow({ from: '2024-02-29', to: '2024-02-29' }).days.length, 1, 'valid leap day accepted');
    const maxEnd = new Date(Date.UTC(2000, 0, 1) + 3659 * 86400000).toISOString().slice(0, 10);
    eq(dailyReportWindow({ from: '2000-01-01', to: maxEnd }).days.length, 3660, 'documented maximum inclusive period accepted');
    const beyond = new Date(Date.UTC(2000, 0, 1) + 3660 * 86400000).toISOString().slice(0, 10);
    assert.throws(() => dailyReportWindow({ from: '2000-01-01', to: beyond }), (e: any) => e.getStatus() === 400); checks++;

    const base = await app.getUrl();
    const http = (path: string, user?: { id: string }) => fetch(`${base}/api/dashboard/${path}`, {
      headers: user ? { Authorization: `Bearer ${sign({ sub: user.id, tv: 0 }, process.env.JWT_SECRET!, { expiresIn: '5m' })}` } : {},
    });
    const range = `from=${report.from}&to=${report.to}`;
    for (const endpoint of ['daily-report', 'daily-report/xlsx']) {
      eq((await http(`${endpoint}?${range}`)).status, 401, `${endpoint} authentication required`);
      for (const role of ['AGENT', 'CASHIER'] as const) eq((await http(`${endpoint}?${range}`, seeded.users[role])).status, 403, `${endpoint} ${role} cannot see company liabilities`);
      for (const role of ['ADMIN', 'ACCOUNTANT'] as const) {
        const response = await http(`${endpoint}?${range}`, seeded.users[role]);
        eq(response.status, 200, `${endpoint} ${role} allowed`);
        eq(response.headers.get('cache-control'), 'no-store', 'financial response is not cached');
        if (endpoint.endsWith('xlsx')) {
          ok(response.headers.get('content-type')?.includes('spreadsheetml.sheet'), 'Excel MIME');
          ok(response.headers.get('content-disposition')?.includes(`${report.from}-${report.to}.xlsx`), 'download has precise selected range');
          await workbookChecks(Buffer.from(await response.arrayBuffer()), repriced);
        } else {
          const payload = await response.json() as DailyReport;
          eq(JSON.stringify(payload.rows), JSON.stringify(repriced.rows), 'HTTP result matches financial service snapshot');
        }
      }
      eq((await http(`${endpoint}?from=2026-02-31&to=2026-03-01`, seeded.users.ADMIN)).status, 400, 'impossible calendar date rejected through HTTP');
      eq((await http(`${endpoint}?from=2026-09-28&to=2026-09-26`, seeded.users.ADMIN)).status, 400, 'reversed HTTP period rejected');
    }
    eq(await db.auditLog.count({ where: { action: 'EXPORT', entity: 'DashboardDailyReport' } }), 2, 'authorized successful exports audited');
    const defective = await db.palletTransaction.create({ data: {
      type: 'DEFECTIVE_FROM_FACTORY', factoryId: seeded.factory.id, qty: 3,
      date: new Date('2026-09-26T19:00:00Z'), note: 'Factory accepted unusable pallets release',
    } });
    await db.palletTransaction.create({ data: { type: 'REVERSAL', factoryId: seeded.factory.id, qty: 1,
      date: new Date('2026-10-04T00:00:00Z'), reversalOfId: defective.id, reversalOfType: 'DEFECTIVE_FROM_FACTORY' } });
    const afterDefect = await service.report({ from: report.from, to: report.to });
    invariantChecks(afterDefect);
    eq(cell(afterDefect, 'palletDefective', 0), 0, 'defect absent before its business day');
    eq(cell(afterDefect, 'palletDefective', 1), 2, 'defect net of later reversal belongs to original day');
    eq(total(afterDefect, 'palletDefective'), 2, 'period defect total excludes reversed quantity');
    eq(total(afterDefect, 'palletReturned'), total(repriced, 'palletReturned'), 'defect never counted as a physical return');
    eq(total(afterDefect, 'palletClosing'), total(repriced, 'palletClosing').plus(2), 'factory liability drops by two');
    eq(total(afterDefect, 'moneyClosing'), total(repriced, 'moneyClosing'), 'defect leaves base money unchanged');
    eq(total(afterDefect, 'totalDebt'), total(repriced, 'totalDebt').plus(D(afterDefect.palletUnitPrice).mul(2)), 'combined debt drops by current valuation');
    await workbookChecks(await dailyReportWorkbook(afterDefect), afterDefect);
    const nextDay = await service.report({ from: '2026-09-28', to: '2026-09-28' });
    eq(cell(nextDay, 'palletOpening'), cell(afterDefect, 'palletClosing', 1), 'defect carries to later opening balance');
    // Explicit new import marker, whole-row correction/rebook, and rollback all
    // use the same minus-side semantics as live operations. Historical warehouse
    // damage in the fixture remains independent from the new factory release.
    await db.palletTransaction.create({ data: { type: 'RETURNED_BY_CLIENT', clientId: seeded.client.id,
      qty: 100, date: new Date('2026-09-25T18:00:00Z'), note: 'Isolated import scenario usable stock' } });
    const { runCommit } = await import('../src/import/commit/import-commit.service');
    const { runRollback } = await import('../src/import/commit/import-rollback.service');
    const importDate = new Date('2026-10-02T00:00:00Z');
    const importedDefect = { origin: { sheetName: 'Поддон қайтариш заводга', excelRow: 4 },
      date: importDate, qty: 3, movementType: 'DEFECTIVE_FROM_FACTORY', senderRaw: '', factoryRaw: seeded.factory.name,
      unitCost: D(0), totalCostDeclared: D(0), note: 'R'.repeat(1000), channel: '' };
    const importInput = { batchId: 'daily-defect-import', shipments: [], clientPayments: [], factoryPayments: [], palletReturns: [],
      factoryPalletReturns: [importedDefect, { ...importedDefect, origin: { ...importedDefect.origin, excelRow: 5 }, qty: -1 }],
      resolveClient: (s: string) => s, resolveFactory: (s: string) => s, resolveAgent: () => null, agentForClient: () => null,
      palletBasePrice: D(afterDefect.palletUnitPrice), createdById: seeded.users.ADMIN.id };
    const cashBefore = await db.cashTransaction.count(), ledgerBefore = await db.ledgerEntry.count();
    for (const patch of [{ note: 'R'.repeat(1001) }, { date: new Date(Date.now() + 2 * 86400000) }]) {
      await assert.rejects(() => runCommit(db, { ...importInput, factoryPalletReturns: [{ ...importedDefect, ...patch }] }, { dryRun: false }), /1–1000|Kelajak/); checks++;
      eq(await db.importBatch.count({ where: { id: importInput.batchId } }), 0, 'commit cannot bypass defect date/reason rules or leave partial data');
    }
    const preview = await runCommit(db, importInput, { dryRun: true });
    eq(preview.pallets.defectiveFromFactory, 2, 'preview discloses net factory defects');
    eq(preview.pallets.returnedToFactory, 0, 'preview separates defects from physical returns');
    eq(preview.pallets.dealerInHand, -2, 'preview stock delta consumes exactly the net defect quantity');
    eq(await db.importBatch.count({ where: { id: importInput.batchId } }), 0, 'defect preview rolls back all rows');
    const committed = await runCommit(db, importInput, { dryRun: false });
    eq(JSON.stringify(committed), JSON.stringify(preview), 'newtype import preview and commit agree');
    eq(committed.factories[0].palletsDefective, 2, 'factory import preview retains net defects');
    eq(committed.factories[0].palletsReturned, 0, 'defect storno does not subtract from real returns');
    eq(await db.cashTransaction.count(), cashBefore, 'defect import creates no cash');
    eq(await db.ledgerEntry.count(), ledgerBefore, 'defect import creates no financial ledger');
    const originals = await db.palletTransaction.findMany({ where: { importBatchId: importInput.batchId, type: 'DEFECTIVE_FROM_FACTORY' }, orderBy: { qty: 'desc' } });
    eq(originals.map((row) => row.qty).join(','), '3,2', 'partial import correction safely rebooks remainder');
    ok(originals.every((row) => row.note === importedDefect.note), '1000-character reason survives create and rebook without accumulating provenance suffixes');
    eq(await db.palletTransaction.count({ where: { importBatchId: importInput.batchId, type: 'REVERSAL', qty: 3, reversalOfType: 'DEFECTIVE_FROM_FACTORY' } }), 1, 'import reversal links original defect type');
    await db.importBatch.update({ where: { id: importInput.batchId }, data: { status: 'COMMITTED' } });
    const rolled = await runRollback(db, importInput.batchId, seeded.users.ADMIN.id);
    eq(rolled.palletSum, 0, 'newtype import rollback has zero pallet effect');
    eq(rolled.ledgerSum, '0.00', 'newtype import rollback has zero financial effect');
    eq(await db.palletTransaction.count({ where: { importBatchId: importInput.batchId, type: 'REVERSAL', qty: 2, reversalOfType: 'DEFECTIVE_FROM_FACTORY' } }), 1, 'rollback reverses only live rebooked defect remainder');
    eq(await db.cashTransaction.count(), cashBefore, 'rollback creates no cash movement');
    console.log(`Dashboard daily report lifecycle: ${checks} assertions passed`);
    if (process.env.DAILY_REPORT_REVIEW_PORT) {
      const infoPath = process.env.DAILY_REPORT_REVIEW_INFO;
      if (infoPath) writeFileSync(infoPath, JSON.stringify({ base, schema: new URL(process.env.DATABASE_URL!).searchParams.get('schema'),
        username: 'daily-test-ADMIN', password: 'DailyReportTest123!', from: report.from, to: report.to }));
      console.log(`Disposable daily-report browser review ready at ${base}`);
      await new Promise<void>((done) => {
        const stopFile = process.env.DAILY_REPORT_REVIEW_STOP;
        const finish = () => { clearInterval(poll); clearTimeout(timeout); done(); };
        const poll = setInterval(() => { if (stopFile && existsSync(stopFile)) finish(); }, 250);
        const timeout = setTimeout(finish, 10 * 60_000);
        process.once('SIGINT', finish); process.once('SIGTERM', finish);
      });
    }
  } finally { await app.close(); }
}

async function main() {
  const url = new URL(process.env.DAILY_REPORT_TEST_DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:55433/postgres');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Only local PostgreSQL allowed');
  const schema = `daily_report_test_${Date.now()}_${randomBytes(6).toString('hex')}`;
  assert.match(schema, /^daily_report_test_\d+_[a-f0-9]{12}$/);
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
    process.env.DATABASE_URL = isolated.toString();
    process.env.JWT_SECRET = randomBytes(32).toString('hex');
    await run(db);
  } finally {
    await db.$disconnect();
    if (created) await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.$disconnect();
  }
}
main().catch((e) => {
  console.error(String(e.message ?? e).replace(/postgres(?:ql)?:\/\/[^\s'"`]+/gi, '[redacted PostgreSQL URL]'));
  process.exitCode = 1;
});
