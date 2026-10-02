/** Client export uses a disposable local schema, never the user's working data. */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PrismaClient, Prisma } from '@prisma/client';
import { Workbook, Worksheet } from 'exceljs';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { sign } from 'jsonwebtoken';
import { hashSync } from 'bcryptjs';
import { ClientsService } from '../src/clients/clients.service';
import { LedgerService } from '../src/common/ledger.service';
import { AuditService } from '../src/common/audit.service';
import { cyr } from '../src/common/translit';
import type { RequestUser } from '../src/common/scoping';

const API = resolve(__dirname, '..');
let checks = 0;
function eq(a: unknown, b: unknown, message: string) { assert.equal(String(a), String(b), message); checks++; }
function ok(value: unknown, message: string) { assert.ok(value, message); checks++; }
function value(ws: Worksheet, address: string): unknown {
  const cell = ws.getCell(address);
  return cell.type === 6 ? cell.result : cell.value;
}
function text(book: Workbook): string {
  const content: unknown[] = [];
  book.eachSheet((ws) => ws.eachRow((row) => row.eachCell((cell) => content.push(cell.value))));
  return JSON.stringify(content);
}
function rowsWith(ws: Worksheet, marker: string) {
  const rows: number[] = [];
  ws.eachRow((row) => { if (row.values && JSON.stringify(row.values).includes(marker)) rows.push(row.number); });
  return rows;
}
function column(ws: Worksheet, label: string): number {
  let found = 0;
  ws.getRow(4).eachCell((cell, index) => { if (cell.text === cyr(label)) found = index; });
  assert.ok(found, `column ${ws.name}: ${label}`);
  return found;
}
function tableTotal(ws: Worksheet, label: string): unknown {
  const index = column(ws, label);
  let result: unknown;
  ws.eachRow((row) => { const cell = row.getCell(index); if (cell.type === 6) result = cell.result; });
  return result;
}

async function seed(db: PrismaClient) {
  const user = await db.user.create({ data: { username: 'client-export-test', name: 'Export test admin', password: hashSync('ExportTest123!', 4), role: 'ADMIN' } });
  const agent = await db.agent.create({ data: { name: 'Selected agent' } });
  const agentUser = await db.user.create({ data: { username: 'client-export-agent', name: 'Export test agent', password: 'unused', role: 'AGENT', agentId: agent.id } });
  const cashier = await db.user.create({ data: { username: 'client-export-cashier', name: 'Export test cashier', password: 'unused', role: 'CASHIER' } });
  const client = await db.client.create({ data: { name: 'Синов мижоз / ҳисобот', phone: '900000001', agentId: agent.id, legalEntity: 'CLIENT_LEGAL', paymentTermDays: 14, creditLimit: 2000000,
    aliases: { create: [{ name: '=CLIENT_ALIAS_LITERAL' }, { name: 'CLIENT_OLD_NAME' }] } } });
  const other = await db.client.create({ data: { name: 'FOREIGN_CLIENT_SENTINEL', aliases: { create: { name: 'FOREIGN_ALIAS_SENTINEL' } } } });
  const empty = await db.client.create({ data: { name: 'Empty client' } });
  const factory = await db.factory.create({ data: { name: 'Shared factory', note: 'PRIVATE_FACTORY_SENTINEL' } });
  const product = await db.product.create({ data: { factoryId: factory.id, name: 'Gazoblok', size: '600x200x300' } });
  const vehicle = await db.vehicle.create({ data: { name: 'Client export truck', plate: '01TEST001', driver: 'Driver' } });
  await db.clientPrice.create({ data: { clientId: client.id, productId: product.id, pricePerM3: '100.123456', effectiveFrom: new Date('2024-01-01Z') } });
  await db.clientPrice.create({ data: { clientId: other.id, productId: product.id, pricePerM3: '999999.123456', effectiveFrom: new Date('2024-01-01Z') } });
  await db.appSetting.create({ data: { key: 'palletPriceDefault', value: '150000.25' } });
  const orderIds = Array.from({ length: 205 }, () => randomUUID());
  await db.order.createMany({ data: orderIds.map((id, i) => ({ id, orderNo: `CLIENT-ORDER-${String(i).padStart(3, '0')}`, clientId: client.id, factoryId: factory.id, agentId: agent.id,
    date: new Date(i === 0 ? '2024-01-01Z' : '2026-10-02Z'), status: 'COMPLETED', saleTotal: '100.25', costTotal: '43.21', transportMode: 'CLIENT_OWN' })) });
  await db.orderItem.createMany({ data: orderIds.map((orderId) => ({ orderId, productId: product.id, quantityM3: '1.123', actualQuantityM3: '1.001', salePricePerM3: '100.149850', saleTotal: '100.25', costPricePerM3: '43.166833', costTotal: '43.21' })) });
  // A split load with an explicit zero actual quantity and fixed negotiated price.
  await db.orderItem.updateMany({ where: { orderId: orderIds[0] }, data: { actualQuantityM3: 0, saleTotal: 100, saleLumpSum: 100 } });
  await db.orderItem.create({ data: { orderId: orderIds[0], productId: product.id, quantityM3: '0.001', actualQuantityM3: null, salePricePerM3: 250, saleTotal: '0.25' } });
  await db.ledgerEntry.createMany({ data: orderIds.map((orderId, i) => ({ account: 'CLIENT', source: 'ORDER_SALE', clientId: client.id, orderId, amount: '100.25', date: new Date(i === 0 ? '2024-01-01Z' : '2026-10-02Z') })) });
  const date = new Date('2026-10-02T05:00:00Z');
  await db.order.update({ where: { id: orderIds[1] }, data: { transportMode: 'CLIENT_PAYS_DRIVER', transportCost: 20, transportPaidStatus: 'PAID_BY_CLIENT', vehicleId: vehicle.id } });
  await db.ledgerEntry.create({ data: { account: 'CLIENT', source: 'TRANSPORT_CLIENT_DIRECT', clientId: client.id, orderId: orderIds[1], date, amount: -20 } });
  const cancelled = await db.order.create({ data: { orderNo: 'CLIENT-CANCELLED', clientId: client.id, factoryId: factory.id, date, status: 'CANCELLED', cancelledAt: date, cancelReason: 'CLIENT_CANCEL_REASON', saleTotal: 100,
    items: { create: { productId: product.id, quantityM3: 1, salePricePerM3: 100, saleTotal: 100 } } } });
  const original = await db.ledgerEntry.create({ data: { account: 'CLIENT', source: 'ORDER_SALE', clientId: client.id, orderId: cancelled.id, date, amount: 100 } });
  await db.ledgerEntry.create({ data: { account: 'CLIENT', source: 'ORDER_CANCEL', clientId: client.id, orderId: cancelled.id, date, amount: -100, reversalOfId: original.id } });
  await db.orderStatusHistory.create({ data: { orderId: cancelled.id, from: 'NEW', to: 'CANCELLED', note: 'CLIENT_STATUS_NOTE' } });
  await db.orderComment.create({ data: { orderId: orderIds[0], text: '=CLIENT_COMMENT_LITERAL' } });
  await db.document.create({ data: { clientId: client.id, filename: 'CLIENT_DOCUMENT.pdf', storedPath: 'PRIVATE_STORAGE_SENTINEL', size: 123 } });
  await db.document.create({ data: { orderId: orderIds[0], filename: 'CLIENT_ORDER_DOCUMENT.pdf', storedPath: 'PRIVATE_STORAGE_SENTINEL', size: 456 } });
  const foreign = await db.order.create({ data: { orderNo: 'FOREIGN_ORDER_SENTINEL', clientId: other.id, factoryId: factory.id, date, saleTotal: 1234567,
    items: { create: { productId: product.id, quantityM3: 1, salePricePerM3: 1234567, saleTotal: 1234567 } } } });
  await db.orderComment.create({ data: { orderId: foreign.id, text: 'FOREIGN_COMMENT_SENTINEL' } });
  await db.ledgerEntry.createMany({ data: [
    { clientId: client.id, account: 'CLIENT', source: 'OFFBOOK_ADJUSTMENT', amount: '123.45', date, note: 'CLIENT_OFFBOOK_NOTE' },
    { clientId: other.id, account: 'CLIENT', source: 'ADJUSTMENT', amount: 999999, date, note: 'FOREIGN_LEDGER_SENTINEL' },
    { factoryId: factory.id, account: 'FACTORY', factoryBucket: 'PAYABLE', source: 'ADJUSTMENT', amount: -9876543, date, note: 'PRIVATE_FACTORY_LEDGER_SENTINEL' },
  ] });
  const paymentIds: string[] = [];
  for (const p of [
    { kind: 'CLIENT_IN', amount: '1000.25', method: 'CASH', note: 'CLIENT_PAYMENT_CASH' },
    { kind: 'CLIENT_IN', amount: '26000', method: 'USD', usdAmount: 2, rate: 13000, note: 'CLIENT_PAYMENT_USD' },
    { kind: 'CLIENT_REFUND', amount: '25.50', method: 'BANK', note: 'CLIENT_PAYMENT_REFUND' },
    { kind: 'CLIENT_IN', amount: '500', method: 'CASH', voidedAt: date, voidReason: 'CLIENT_VOID_REASON', note: 'CLIENT_PAYMENT_VOID' },
    { kind: 'TRANSPORT_DIRECT', amount: '20', method: 'CASH', vehicleId: vehicle.id, note: 'CLIENT_PAYMENT_DIRECT' },
    { kind: 'CLIENT_IN', amount: '50', method: 'BANK', note: 'CLIENT_PAYMENT_BANK' },
  ] as const) {
    const payment = await db.payment.create({ data: { ...p, clientId: client.id, date } }); paymentIds.push(payment.id);
    if (payment.kind === 'TRANSPORT_DIRECT') continue; // Already carved out on the order; documentary payment only.
    const entry = await db.ledgerEntry.create({ data: { account: 'CLIENT', source: 'PAYMENT', clientId: client.id, paymentId: payment.id, date,
      amount: new Prisma.Decimal(payment.amount).times(payment.kind === 'CLIENT_REFUND' ? 1 : -1) } });
    if (payment.voidedAt) await db.ledgerEntry.create({ data: { account: 'CLIENT', source: 'PAYMENT_VOID', clientId: client.id, paymentId: payment.id, date, amount: payment.amount, reversalOfId: entry.id } });
  }
  const fp = await db.payment.create({ data: { clientId: other.id, kind: 'CLIENT_IN', date, amount: 999, note: 'FOREIGN_PAYMENT_SENTINEL' } });
  await db.paymentAllocation.createMany({ data: [
    { paymentId: paymentIds[0], orderId: orderIds[0], amount: 100 },
    { paymentId: paymentIds[3], orderId: orderIds[1], amount: 100, voidedAt: date, voidReason: 'CLIENT_ALLOCATION_VOID' },
    { paymentId: paymentIds[4], orderId: orderIds[1], amount: 20 },
    // Invalid historical cross-client linkage must never leak either party's record.
    { paymentId: fp.id, orderId: orderIds[2], amount: 1 },
    { paymentId: paymentIds[5], orderId: foreign.id, amount: 1 },
  ] });
  const delivery = await db.palletTransaction.create({ data: { clientId: client.id, type: 'DELIVERED_TO_CLIENT', qty: 10, date, orderId: orderIds[0] } });
  const returned = await db.palletTransaction.create({ data: { clientId: client.id, type: 'RETURNED_BY_CLIENT', qty: 3, date, note: 'CLIENT_RETURN_NOTE' } });
  await db.palletTransaction.create({ data: { clientId: client.id, type: 'REVERSAL', qty: 1, date, reversalOfId: returned.id, reversalOfType: 'RETURNED_BY_CLIENT' } });
  const charged = await db.palletTransaction.create({ data: { clientId: client.id, type: 'CHARGED_LOST', qty: 2, unitPrice: 125000, date } });
  await db.ledgerEntry.create({ data: { clientId: client.id, account: 'CLIENT', source: 'PALLET_CHARGE', palletTransactionId: charged.id, amount: 250000, date } });
  const cancelledCharge = await db.palletTransaction.create({ data: { clientId: client.id, type: 'CHARGED_LOST', qty: 1, unitPrice: 130000, date } });
  const chargeLedger = await db.ledgerEntry.create({ data: { clientId: client.id, account: 'CLIENT', source: 'PALLET_CHARGE', palletTransactionId: cancelledCharge.id, amount: 130000, date } });
  const chargeReversal = await db.palletTransaction.create({ data: { clientId: client.id, type: 'REVERSAL', qty: 1, date, unitPrice: 130000, reversalOfId: cancelledCharge.id, reversalOfType: 'CHARGED_LOST' } });
  await db.ledgerEntry.create({ data: { clientId: client.id, account: 'CLIENT', source: 'PALLET_CHARGE', palletTransactionId: chargeReversal.id, amount: -130000, date, reversalOfId: chargeLedger.id } });
  await db.palletTransaction.createMany({ data: [
    { clientId: client.id, type: 'ADJUSTMENT', qty: -1, date, note: 'CLIENT_PALLET_ADJUST' },
    { clientId: other.id, type: 'DELIVERED_TO_CLIENT', qty: 99, date, note: 'FOREIGN_PALLET_SENTINEL' },
    { type: 'ADJUSTMENT', qty: -52, date, note: 'WAREHOUSE_SENTINEL' },
  ] });
  void delivery;
  return { user, agentUser, cashier, client, other, empty, orderIds, paymentIds };
}

async function run(db: PrismaClient) {
  const seeded = await seed(db);
  const { user, agentUser, cashier, client, other, empty } = seeded;
  const actor: RequestUser = { userId: user.id, username: user.username, name: user.name, role: 'ADMIN', agentId: null };
  // Use compiled modules to preserve Nest constructor metadata and test the real route/guards.
  const { AppModule } = require('../dist/app.module');
  const { ClientExportService } = require('../dist/export/client-export.service');
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(Number(process.env.CLIENT_EXPORT_REVIEW_PORT) || 0, '127.0.0.1');
  try {
    const service = app.get(ClientExportService);
    const file = await service.buildWorkbook(client.id, actor);
    ok(file.buffer.length > 1000, 'real nonempty XLSX');
    ok(!/[\\/:*?"<>|\r\n]/.test(file.filename), 'safe client filename');
    const book = new Workbook(); await book.xlsx.load(file.buffer as never);
    const card = book.getWorksheet('Мижоз картаси')!;
    eq(value(card, 'B5'), client.name, 'selected client identity');
    const clients = new ClientsService(db as never, new LedgerService(db as never), new AuditService(db as never));
    const detail = await clients.detail(client.id, actor);
    const expectedBase = new Prisma.Decimal('100.25').times(205).minus('1000.25').minus(26000).plus('25.50').minus(20).minus(50).plus(250000).plus('123.45');
    eq(value(card, 'B12'), expectedBase, 'all-time ledger total with cancellations, voids, refunds, corrections and charges');
    eq(value(card, 'B12'), detail.debtWithoutPallets, 'base exactly matches client card API');
    eq(value(card, 'B13'), 5, 'signed pallet reversal and adjustment maths');
    eq(value(card, 'B14'), '150000.25', 'current configured price');
    eq(value(card, 'B15'), '750001.25', 'pallet value rounded correctly');
    eq(value(card, 'B16'), expectedBase.plus('750001.25'), 'dual debt');
    eq(value(card, 'B16'), detail.debtWithPallets, 'combined exactly matches client card API');
    eq(value(card, 'B24'), '27024.75', 'net receipt excludes void, subtracts refund and does not add direct transport');
    eq(value(card, 'B25'), 20, 'direct-to-driver payment shown separately');
    const goods = book.getWorksheet('Товар')!;
    eq(rowsWith(goods, 'CLIENT-ORDER-').length, 206, 'all 205 orders and split items exported beyond API pagination cap');
    eq(rowsWith(goods, 'CLIENT-CANCELLED').length, 1, 'cancelled order history retained');
    eq(tableTotal(goods, 'Sotuv summasi (faol)'), '20551.25', 'split and lump-sum active sales sum stored totals once');
    const cancelledRow = rowsWith(goods, 'CLIENT-CANCELLED')[0];
    eq(goods.getRow(cancelledRow).getCell(column(goods, 'Sotuv summasi (faol)')).value, 0, 'cancelled item adds no active sales');
    eq(goods.getRow(cancelledRow).getCell(column(goods, 'Sotuv summasi (hujjat)')).value, 100, 'cancelled original sales retained');
    const splitRows = rowsWith(goods, 'CLIENT-ORDER-000');
    ok(splitRows.some((row) => goods.getRow(row).getCell(column(goods, 'Haqiqiy m³ (hujjat)')).value === 0), 'explicit zero actual volume preserved');
    eq(tableTotal(book.getWorksheet('Буюртмалар')!, 'Mijozdan olinadigan (faol)'), '20531.25', 'driver carveout deducted once at order level');
    eq(tableTotal(book.getWorksheet('Оплата')!, 'Sof kirim (faol)'), '27024.75', 'payment total excludes cancelled and direct rows, refunds signed');
    eq(tableTotal(book.getWorksheet('Поддон ҳаракати')!, 'Qoldiq taʼsiri (dona)'), 5, 'raw pallet table sums to canonical card');
    eq(tableTotal(book.getWorksheet('Акт сверка')!, 'Imzoli summa'), expectedBase, 'statement table sums to canonical card');
    const statement = book.getWorksheet('Акт сверка')!;
    eq(statement.getRow(statement.rowCount - 1).getCell(7).value, expectedBase.toNumber(), 'last running balance equals client debt');
    eq(book.getWorksheet('Махсус нархлар')!.getCell('D5').value, '100.123456', 'six-decimal individual unit price retained');
    const content = text(book);
    for (const marker of ['CLIENT_PAYMENT_CASH', 'CLIENT_PAYMENT_USD', 'CLIENT_PAYMENT_REFUND', 'CLIENT_PAYMENT_VOID', 'CLIENT_PAYMENT_DIRECT', 'CLIENT_PAYMENT_BANK', 'CLIENT_OFFBOOK_NOTE', 'CLIENT_RETURN_NOTE', 'CLIENT_PALLET_ADJUST', 'CLIENT_STATUS_NOTE', 'CLIENT_DOCUMENT.pdf', 'CLIENT_ORDER_DOCUMENT.pdf']) {
      ok(content.includes(marker), `complete history includes ${marker}`);
    }
    for (const marker of ['FOREIGN_', 'PRIVATE_FACTORY_', 'PRIVATE_STORAGE_', 'WAREHOUSE_SENTINEL', '999999.123456']) ok(!content.includes(marker), `no leakage: ${marker}`);
    let literalCount = 0;
    book.eachSheet((ws) => ws.eachRow((row) => row.eachCell((cell) => {
      if (typeof cell.value === 'string' && cell.value.includes('_LITERAL')) { eq(cell.type, 3, 'user text cannot become an Excel formula'); literalCount++; }
      if (cell.type === 6) ok(cell.result !== undefined && cell.result !== null, 'formulas have saved numeric results');
      ok(cell.type !== 10, `no Excel error cell ${ws.name}!${cell.address}`);
    })));
    eq(literalCount, 2, 'alias and comment formula-like text retained');
    const ownAgent = { ...actor, userId: agentUser.id, username: agentUser.username, role: 'AGENT', agentId: agentUser.agentId };
    const agentFile = await service.buildWorkbook(client.id, ownAgent);
    const agentBook = new Workbook(); await agentBook.xlsx.load(agentFile.buffer as never);
    eq(value(agentBook.getWorksheet('Мижоз картаси')!, 'B16'), detail.debtWithPallets, 'own agent same balances');
    const agentContent = text(agentBook);
    for (const label of ['Tannarx', 'Foyda', 'Zavod narxi']) ok(!agentContent.includes(cyr(label)), `agent export hides ${label}`);
    ok(!agentContent.includes('43.21'), 'agent export hides private cost amount');
    await assert.rejects(() => service.buildWorkbook(other.id, ownAgent), (e: any) => e.getStatus() === 403); checks++;
    await assert.rejects(() => service.buildWorkbook(client.id, { ...ownAgent, agentId: null }), (e: any) => e.getStatus() === 403); checks++;
    await assert.rejects(() => service.buildWorkbook(randomUUID(), actor), (e: any) => e.getStatus() === 404); checks++;
    const emptyFile = await service.buildWorkbook(empty.id, actor);
    const emptyBook = new Workbook(); await emptyBook.xlsx.load(emptyFile.buffer as never);
    eq(value(emptyBook.getWorksheet('Мижоз картаси')!, 'B16'), 0, 'empty client export valid zero');
    await db.ledgerEntry.create({ data: { account: 'CLIENT', source: 'ADJUSTMENT', clientId: empty.id, date: new Date('2026-10-01T19:00:00Z'), amount: '-10.25' } });
    const advanceBook = new Workbook(); await advanceBook.xlsx.load((await service.buildWorkbook(empty.id, actor)).buffer as never);
    eq(value(advanceBook.getWorksheet('Мижоз картаси')!, 'B12'), '-10.25', 'client advance remains a signed balance');
    eq(value(advanceBook.getWorksheet('Мижоз картаси')!, 'B16'), '-10.25', 'combined advance is not clamped to zero');
    eq((value(advanceBook.getWorksheet('Акт сверка')!, 'A5') as Date).toISOString(), '2026-10-02T00:00:00.000Z', 'Excel business day follows Tashkent midnight');
    await db.appSetting.update({ where: { key: 'palletPriceDefault' }, data: { value: 160000 } });
    const repriced = new Workbook(); await repriced.xlsx.load((await service.buildWorkbook(client.id, actor)).buffer as never);
    eq(value(repriced.getWorksheet('Мижоз картаси')!, 'B12'), expectedBase, 'repricing preserves booked debt');
    eq(value(repriced.getWorksheet('Мижоз картаси')!, 'B16'), expectedBase.plus(800000), 'repricing updates only remaining pallets');
    ok(text(repriced).includes('125000'), 'historical paid pallet price preserved');
    const base = await app.getUrl();
    const token = (u: { id: string }) => sign({ sub: u.id, tv: 0 }, process.env.JWT_SECRET!, { expiresIn: '5m' });
    const http = (path: string, u?: { id: string }) => fetch(`${base}/api${path}`, { headers: u ? { Authorization: `Bearer ${token(u)}` } : {} });
    const response = await http(`/export/clients/${client.id}/xlsx?from=2026-10-02&to=2026-10-02`, user);
    eq(response.status, 200, 'HTTP export succeeds');
    ok(response.headers.get('content-type')?.includes('spreadsheetml.sheet'), 'download MIME');
    ok(response.headers.get('content-disposition')?.includes("filename*=UTF-8''"), 'UTF8 download filename');
    eq(response.headers.get('cache-control'), 'no-store', 'financial download not cached');
    const fromHttp = new Workbook(); await fromHttp.xlsx.load(Buffer.from(await response.arrayBuffer()) as never);
    eq(rowsWith(fromHttp.getWorksheet('Товар')!, 'CLIENT-ORDER-').length, 206, 'URL date filters cannot truncate all-history export');
    eq((await http(`/export/clients/${client.id}/xlsx`)).status, 401, 'authentication required');
    eq((await http(`/export/clients/${client.id}/xlsx`, cashier)).status, 403, 'cashier denied by role guard');
    eq((await http(`/export/clients/${other.id}/xlsx`, agentUser)).status, 403, 'HTTP foreign agent denied');
    eq((await http('/export/clients/not-a-uuid/xlsx', user)).status, 400, 'malformed ID rejected');
    eq((await http(`/export/clients/${randomUUID()}/xlsx`, user)).status, 404, 'missing client rejected');
    eq((await http(`/export/clients/${client.id}/xlsx`, agentUser)).status, 200, 'HTTP own agent allowed');
    ok(await db.auditLog.count({ where: { action: 'EXPORT', entityId: client.id } }), 'client export audit recorded');
    console.log(`Client export lifecycle: ${checks} assertions passed`);
    if (process.env.CLIENT_EXPORT_REVIEW_PORT) {
      const path = process.env.CLIENT_EXPORT_REVIEW_INFO;
      if (path) writeFileSync(path, JSON.stringify({ base, clientId: client.id, schema: new URL(process.env.DATABASE_URL!).searchParams.get('schema') }));
      console.log(`Disposable browser review server ready: ${base}; client ${client.id}`);
      await new Promise<void>((resolve) => {
        const stopFile = process.env.CLIENT_EXPORT_REVIEW_STOP;
        const finish = () => { clearInterval(poll); clearTimeout(timeout); resolve(); };
        const poll = setInterval(() => { if (stopFile && existsSync(stopFile)) finish(); }, 250);
        const timeout = setTimeout(finish, 10 * 60_000);
        process.once('SIGINT', finish); process.once('SIGTERM', finish);
      });
    }
  } finally { await app.close(); }
}

async function main() {
  const url = new URL(process.env.CLIENT_EXPORT_TEST_DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:55433/postgres');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Only local PostgreSQL allowed');
  const schema = `client_export_test_${Date.now()}_${randomBytes(6).toString('hex')}`;
  assert.match(schema, /^client_export_test_\d+_[a-f0-9]{12}$/);
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
main().catch((e) => { console.error(String(e.message ?? e).replace(/postgres(?:ql)?:\/\/[^\s'"`]+/gi, '[redacted PostgreSQL URL]')); process.exitCode = 1; });
