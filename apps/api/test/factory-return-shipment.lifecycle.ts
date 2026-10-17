/** Real production services, exclusively in a unique disposable LOCAL PostgreSQL schema. */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ValidationPipe } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { FactoryPalletShipmentService } from '../src/pallets/factory-pallet-shipment.service';
import { DispatchFactoryPalletDto, InspectFactoryPalletDto, ReturnRejectedPalletDto } from '../src/pallets/factory-pallet-shipment.dto';
import { PalletService } from '../src/pallets/pallets.service';
import { LedgerService } from '../src/common/ledger.service';
import { AuditService } from '../src/common/audit.service';
import { SettingsService } from '../src/common/settings.service';
import { PricingService } from '../src/common/pricing.service';
import { RequestUser } from '../src/common/scoping';
import { ClientsService } from '../src/clients/clients.service';
import { FactoriesService } from '../src/factories/factories.service';
import { DebtsService } from '../src/debts/debts.service';
import { BonusService } from '../src/bonus/bonus.service';
import { PaymentsService } from '../src/payments/payments.service';
import { OrdersService } from '../src/orders/orders.service';
import { DailyReportService } from '../src/dashboard/daily-report.service';
import { runRollback } from '../src/import/commit/import-rollback.service';

const API = resolve(__dirname, '..');
let checks = 0;
function eq(actual: unknown, expected: unknown, note: string) {
  assert.equal(String(actual), String(expected), note); checks++;
}
function ok(actual: unknown, note: string) { assert.ok(actual, note); checks++; }
function money(actual: Prisma.Decimal.Value, expected: Prisma.Decimal.Value, note: string) {
  assert.equal(new Prisma.Decimal(actual).toFixed(2), new Prisma.Decimal(expected).toFixed(2), note); checks++;
}
async function rejects(action: () => Promise<unknown>, note: string, pattern?: RegExp) {
  if (pattern) await assert.rejects(action, pattern, note);
  else await assert.rejects(action, note);
  checks++;
}
async function forbidden(action: () => Promise<unknown>, note: string) {
  await assert.rejects(action, (e: any) => e?.status === 403 || e?.getStatus?.() === 403, note); checks++;
}
const day = '2026-10-02';
const arrivalDay = '2026-10-03';
const inspectionDay = '2026-10-04';
const receiptDay = '2026-10-05';
const at = new Date('2026-10-01T07:00:00Z');

async function run(db: PrismaClient, schema: string) {
  const prisma = db as never;
  const ledger = new LedgerService(prisma), audit = new AuditService(prisma), settings = new SettingsService(prisma);
  const pallets = new PalletService(prisma, ledger, audit, settings);
  const trips = new FactoryPalletShipmentService(prisma, pallets, audit);
  const debts = new DebtsService(prisma, ledger, pallets);
  const clients = new ClientsService(prisma, ledger, audit);
  const factories = new FactoriesService(prisma, ledger, audit, pallets, debts);
  const pricing = new PricingService(), bonus = new BonusService(prisma, ledger, audit);
  const orders = new OrdersService(prisma, ledger, audit, settings, pricing, pallets, bonus,
    new PaymentsService(prisma, ledger, audit, pricing), debts);
  const daily = new DailyReportService(prisma);
  const user = await db.user.create({ data: { username: 'shipment-admin', name: 'Shipment test admin', password: 'not-a-login', role: 'ADMIN' } });
  const actor: RequestUser = { userId: user.id, username: user.username, name: user.name, role: 'ADMIN', agentId: null };
  const accountant: RequestUser = { ...actor, role: 'ACCOUNTANT' };
  const factory = await db.factory.create({ data: { name: 'Shipment factory' } });
  const other = await db.factory.create({ data: { name: 'Shipment other factory' } });
  const client = await db.client.create({ data: { name: 'Shipment client' } });
  const donor = await db.client.create({ data: { name: 'Shipment other client' } });
  await db.appSetting.create({ data: { key: 'palletPriceDefault', value: 130000.25 } });
  const dispatch = (qty: number, factoryId = factory.id, date = day) => ({
    factoryId, qty, date, vehiclePlate: '01 A 123 AA', driverName: 'Test haydovchi', note: 'Zavodga qaytarish reysi', requestKey: randomUUID(),
  });
  const inspection = (accepted: number, rejectedQty = 0, date = inspectionDay, unitPrice = '130000.25') => ({
    date, receiverName: 'Zavod qabulchisi', documentRef: 'DAL-001', requestKey: randomUUID(),
    lines: accepted ? [{ condition: 'Yaroqli, mixlari joyida', qty: accepted, unitPrice }] : [],
    rejectedQty, rejectionReason: rejectedQty ? 'Taxtasi singan' : undefined, note: 'Qabul dalolatnomasi',
  });
  const returnDto = (qty: number, date = receiptDay) => ({ qty, date, note: 'Rad etilgan poddon omborga haqiqatan yetib keldi', requestKey: randomUUID() });
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
  const validate = (metatype: any, value: unknown) => pipe.transform(value, { type: 'body', metatype });
  eq((await validate(DispatchFactoryPalletDto, { ...dispatch(1), qty: '1' })).qty, 1, 'HTTP dispatch normalizes a numeric quantity');
  for (const patch of [{ requestKey: undefined }, { unitPrice: '1' }, { vehiclePlate: undefined }, { driverName: undefined }, { factoryId: 'not-a-uuid' }]) {
    await rejects(() => validate(DispatchFactoryPalletDto, { ...dispatch(1), ...patch }), 'HTTP dispatch rejects malformed or unsupported input');
  }
  for (const unitPrice of ['1.001', '-1', 'NaN', '1e4']) {
    await rejects(() => validate(InspectFactoryPalletDto, inspection(1, 0, inspectionDay, unitPrice)), 'HTTP lot price must use explicit nonnegative cents');
  }
  await rejects(() => validate(InspectFactoryPalletDto, { ...inspection(1), unexpectedMoneyCredit: true }), 'HTTP inspection cannot request a hidden money credit');
  await rejects(() => validate(ReturnRejectedPalletDto, { ...returnDto(1), requestKey: undefined }), 'HTTP rejected return requires a retry key');
  const seed = async (qty: number, returned = qty, factoryId = factory.id, clientId = client.id, importBatchId?: string) => {
    await db.palletTransaction.createMany({ data: [
      { type: 'RECEIVED_FROM_FACTORY', factoryId, qty, date: at, importBatchId },
      { type: 'DELIVERED_TO_CLIENT', clientId, qty, date: at, importBatchId },
      ...(returned ? [{ type: 'RETURNED_BY_CLIENT' as const, clientId, qty: returned, date: at, importBatchId }] : []),
    ] });
  };
  // All resets are inside the verified random test schema. CASCADE only clears this
  // suite's synthetic dependent rows, never the normal local database's records.
  const reset = async () => {
    eq((await db.$queryRaw<{ schema: string }[]>`SELECT current_schema() AS schema`)[0].schema, schema, 'reset stays in exact disposable schema');
    await db.$executeRawUnsafe('TRUNCATE TABLE "FactoryPalletAcceptanceLine", "FactoryPalletWarehouseReturn", "FactoryPalletInspection", "FactoryPalletShipment", "PalletTransaction" CASCADE');
  };
  const state = async (id: string, expected: Record<string, unknown>, note: string) => {
    const row = await trips.detail(id);
    for (const [key, value] of Object.entries(expected)) eq((row as any)[key], value, `${note}: ${key}`);
    return row;
  };
  const balances = async (stock: number, owed: number, note: string, factoryId = factory.id) => {
    eq(await pallets.dealerInHand(), stock, `${note}: usable warehouse stock`);
    eq(await pallets.factoryPalletBalance(factoryId), owed, `${note}: factory obligation`);
    eq((await pallets.overview()).drift, 0, `${note}: physical conservation`);
  };

  // One load, partial inspections, two different accepted prices, two physical returns.
  await seed(100);
  await db.ledgerEntry.createMany({ data: [
    { account: 'FACTORY', source: 'ADJUSTMENT', factoryId: factory.id, factoryBucket: 'PAYABLE', amount: -100000.01, date: at },
    { account: 'CLIENT', source: 'ADJUSTMENT', clientId: client.id, amount: 123.45, date: at },
  ] });
  const beforeLedger = await db.ledgerEntry.count(), beforeCash = await db.cashTransaction.count();
  const first = await trips.dispatch(dispatch(40), actor);
  ok(first.returnNo, 'dispatch has a human-readable reference');
  await state(first.id, { status: 'IN_TRANSIT', qty: 40, acceptedQty: 0, rejectedQty: 0, returnedQty: 0,
    uninspectedQty: 40, outstandingQty: 40 }, 'dispatch');
  await balances(60, 100, 'dispatch does not settle factory debt');
  eq(await db.palletTransaction.count({ where: { type: 'RETURNED_TO_FACTORY' } }), 0, 'dispatch does not impersonate acceptance');
  await rejects(() => trips.inspect(first.id, inspection(1), actor), 'cannot inspect a shipment before arrival');
  await rejects(() => trips.returnRejected(first.id, returnDto(1), actor), 'cannot return pallets never rejected');
  await trips.arrive(first.id, { date: arrivalDay, note: 'Zavod darvozasiga keldi' }, accountant);
  await state(first.id, { status: 'INSPECTING', outstandingQty: 40 }, 'arrival');
  await balances(60, 100, 'arrival does not settle debt');
  await rejects(() => trips.cancel(first.id, { reason: 'Yetib kelgach oddiy bekor qilish mumkin emas' }, actor), 'arrival disables erroneous-dispatch cancellation');
  await trips.inspect(first.id, inspection(20, 5), accountant);
  await rejects(() => trips.reverseArrival(first.id, { reason: 'Kelish xato' }, actor), 'arrival cannot be undone while a live inspection depends on it');
  await state(first.id, { status: 'INSPECTING', acceptedQty: 20, rejectedQty: 5, uninspectedQty: 15,
    rejectedOutstandingQty: 5, outstandingQty: 20 }, 'first partial inspection');
  await balances(60, 80, 'accepted portion only settles count');
  await trips.inspect(first.id, inspection(10, 5, inspectionDay, '90000.10'), actor);
  const fullyInspected = await state(first.id, { status: 'AWAITING_RETURN', acceptedQty: 30, rejectedQty: 10,
    uninspectedQty: 0, rejectedOutstandingQty: 10, outstandingQty: 10 }, 'all inspected, rejected pallets away');
  money(fullyInspected.acceptanceTotal, '3500006', 'accepted lot prices are summed exactly without floating point');
  await balances(60, 70, 'rejected pallets do not restore stock');
  const acceptedRows = await db.palletTransaction.findMany({ where: { type: 'RETURNED_TO_FACTORY' } });
  eq(acceptedRows.length, 2, 'each accepted lot has one canonical count movement');
  ok(acceptedRows.every((r) => r.unitPrice === null), 'legacy factory movements retain their moneyless contract');
  ok(acceptedRows.every((r) => r.date.toISOString() === '2026-10-03T19:00:00.000Z'), 'factory debt settles on Tashkent inspection date');
  await rejects(() => trips.inspect(first.id, inspection(1), actor), 'cannot inspect more than the original load');
  await rejects(() => trips.returnRejected(first.id, returnDto(11), actor), 'cannot restock more than rejected-away pallets');
  await trips.returnRejected(first.id, returnDto(4), accountant);
  await state(first.id, { status: 'AWAITING_RETURN', returnedQty: 4, rejectedOutstandingQty: 6, outstandingQty: 6 }, 'partial physical return');
  await balances(64, 70, 'partial physical return');
  await trips.returnRejected(first.id, returnDto(6), actor);
  await state(first.id, { status: 'COMPLETED', returnedQty: 10, rejectedOutstandingQty: 0, outstandingQty: 0 }, 'completed shipment');
  await balances(70, 70, 'complete lifecycle');
  eq(await pallets.clientPalletBalance(client.id), 0, 'factory workflow leaves client custody unchanged');
  money((await clients.detail(client.id, actor)).debtWithoutPallets, '123.45', 'factory workflow leaves client money unchanged');
  const card = await factories.findOne(factory.id);
  money(card.debtWithoutPallets, '100000.01', 'acceptance value does not silently post a base-money credit');
  money(card.debtWithPallets, '9200017.51', 'combined debt values only 70 still-outstanding pallets');
  eq(await db.ledgerEntry.count(), beforeLedger, 'workflow posts no unsolicited ledger money');
  eq(await db.cashTransaction.count(), beforeCash, 'workflow posts no cash');
  // SQL checks protect essential shapes even if a future writer bypasses the service.
  for (const patch of [{ qty: 0 }, { driverName: ' ' }, { vehiclePlate: ' ' },
    { arrivedAt: new Date('2026-09-30T07:00:00Z') },
    { status: 'CANCELLED' as const, cancelledAt: new Date(), cancelReason: null }]) {
    await rejects(() => db.factoryPalletShipment.update({ where: { id: first.id }, data: patch }), 'database rejects malformed shipment shape');
  }
  const dbInspection = await db.factoryPalletInspection.findFirstOrThrow({ where: { shipmentId: first.id, voidedAt: null } });
  await rejects(() => db.factoryPalletInspection.update({ where: { id: dbInspection.id }, data: { rejectedQty: 1, rejectionReason: ' ' } }), 'database requires a rejection reason');
  await rejects(() => db.factoryPalletInspection.update({ where: { id: dbInspection.id }, data: { voidedAt: new Date(), voidReason: null } }), 'database requires an inspection correction reason');
  const dbLine = await db.factoryPalletAcceptanceLine.findFirstOrThrow({ where: { inspectionId: dbInspection.id } });
  for (const patch of [{ qty: 0 }, { unitPrice: -1 }, { amount: dbLine.amount.plus(1) }, { condition: ' ' }]) {
    await rejects(() => db.factoryPalletAcceptanceLine.update({ where: { id: dbLine.id }, data: patch }), 'database rejects invalid accepted quantity/price/amount/condition');
  }
  const dbRestock = await db.factoryPalletWarehouseReturn.findFirstOrThrow({ where: { shipmentId: first.id } });
  for (const patch of [{ qty: 0 }, { note: ' ' }]) {
    await rejects(() => db.factoryPalletWarehouseReturn.update({ where: { id: dbRestock.id }, data: patch }), 'database rejects invalid physical-return shape');
  }
  await rejects(() => db.factoryPalletWarehouseReturn.update({ where: { id: dbRestock.id }, data: { voidedAt: new Date(), voidReason: null } }), 'database requires a physical-return correction reason');
  await balances(70, 70, 'failed direct database writes preserve lifecycle counts');
  const beforeAcceptReport = await daily.report({ from: day, to: arrivalDay });
  eq(beforeAcceptReport.rows.find((r) => r.key === 'palletReturned')?.total, '0', 'dispatch and arrival are not historical accepted returns');
  const acceptReport = await daily.report({ from: inspectionDay, to: inspectionDay });
  eq(acceptReport.rows.find((r) => r.key === 'palletReturned')?.total, '30', 'daily factory report recognizes accepted count on inspection date');
  const journeyReport = await daily.report({ from: day, to: receiptDay });
  const reportValues = (key: string) => journeyReport.rows.find((r) => r.key === key)?.values.join(',');
  eq(reportValues('shipment_inTransit'), '40,0,0,0', 'historical dispatch remains visible after current shipment completion');
  eq(reportValues('shipment_awaitingInspection'), '0,40,0,0', 'arrival moves custody into inspection on its own day');
  eq(reportValues('shipment_rejectedAtFactory'), '0,0,10,0', 'rejected pallets remain away until physical return date');
  eq(reportValues('shipment_outsideWarehouse'), '40,40,10,0', 'daily away count follows all lifecycle events');
  eq(reportValues('palletClosing'), '-100,-100,-70,-70', 'factory liability changes only on acceptance day');
  money(journeyReport.rows.find((r) => r.key === 'shipmentAcceptedValue')!.total, '3500006', 'daily accepted value uses exact lot prices');

  // Cancellation corrects a mistaken dispatch at its original date, with history.
  await reset(); await seed(20);
  const cancelled = await trips.dispatch(dispatch(8), accountant);
  await balances(12, 20, 'pending cancellation');
  for (const reason of ['', ' ', 'x'.repeat(1001)]) {
    await rejects(() => trips.cancel(cancelled.id, { reason }, actor), 'cancellation requires a bounded nonblank reason');
  }
  await trips.cancel(cancelled.id, { reason: '  Moshinaga yuklanmagan, xato yozuv  ' }, accountant);
  await state(cancelled.id, { status: 'CANCELLED', outstandingQty: 0 }, 'cancelled dispatch retained');
  await balances(20, 20, 'cancellation restores stock, not additional factory credit');
  const cancelledReport = await daily.report({ from: day, to: day });
  eq(cancelledReport.rows.find((r) => r.key === 'shipment_outsideWarehouse')?.total ?? '0', '0', 'mistaken dispatch correction also removes its historical reservation');
  await rejects(() => trips.cancel(cancelled.id, { reason: 'Yana' }, actor), 'cancel cannot run twice');
  await rejects(() => trips.arrive(cancelled.id, { date: arrivalDay }, actor), 'cancelled dispatch cannot arrive');
  await rejects(() => trips.inspect(cancelled.id, inspection(1), actor), 'cancelled dispatch cannot be accepted');

  // Full inspection correction restores count; already-restocked rejected goods block it.
  const corrected = await trips.dispatch(dispatch(20), actor);
  await trips.arrive(corrected.id, { date: arrivalDay }, actor);
  await trips.inspect(corrected.id, inspection(10, 5), actor);
  const beforeCorrection = await trips.detail(corrected.id);
  const oldInspection = beforeCorrection.inspections.find((i: any) => !i.voidedAt)!;
  ok(oldInspection?.id, 'inspection has a separately addressable audit identity');
  await trips.reverseInspection(oldInspection.id, { reason: 'Dalolatnoma xato kiritilgan' }, accountant);
  await state(corrected.id, { status: 'INSPECTING', acceptedQty: 0, rejectedQty: 0, uninspectedQty: 20, outstandingQty: 20 }, 'inspection correction');
  await balances(0, 20, 'inspection correction keeps pallets physically away');
  money((await trips.detail(corrected.id)).acceptanceTotal, '0', 'voided inspection value is excluded');
  const correctedReport = await daily.report({ from: inspectionDay, to: inspectionDay });
  eq(correctedReport.rows.find((r) => r.key === 'palletReturned')?.total, '0', 'inspection correction restores factory count on original business day');
  eq(correctedReport.rows.find((r) => r.key === 'shipment_awaitingInspection')?.total, '20', 'voided inspection restores historical pending inspection count');
  money(correctedReport.rows.find((r) => r.key === 'shipmentAcceptedValue')?.total ?? '0', '0', 'voided inspection removes historical accepted valuation');
  await rejects(() => trips.reverseInspection(oldInspection.id, { reason: 'Yana' }, actor), 'inspection cannot be reversed twice');
  await trips.inspect(corrected.id, inspection(7, 13), actor);
  const correctedInspection = (await trips.detail(corrected.id)).inspections.find((i: any) => !i.voidedAt)!;
  await trips.returnRejected(corrected.id, returnDto(2), actor);
  await rejects(() => trips.reverseInspection(correctedInspection.id, { reason: 'Qayta tekshiruv' }, actor), 'cannot erase rejection that supported physical restocking');
  await state(corrected.id, { acceptedQty: 7, rejectedQty: 13, returnedQty: 2, outstandingQty: 11 }, 'failed correction is atomic');
  await balances(2, 13, 'blocked correction leaves all balances intact');

  // Server validation, including calls that bypass Nest's DTO validation.
  await reset(); await seed(12);
  for (const qty of [0, -1, 1.5, NaN, Infinity, 2147483648]) {
    await rejects(() => trips.dispatch(dispatch(qty), actor), 'invalid dispatch quantity rejected');
  }
  for (const date of ['', 'bad-date', '2026-02-31', '2099-01-01', '2026-10-02T10:00:00']) {
    await rejects(() => trips.dispatch(dispatch(1, factory.id, date), actor), 'invalid or future dispatch date rejected');
  }
  const offsetTrip = await trips.dispatch(dispatch(1, factory.id, '2026-10-02T10:30:00+05:00'), actor);
  eq(offsetTrip.dispatchedAt.toISOString(), '2026-10-02T05:30:00.000Z', 'explicit time-zone offset preserves the exact instant');
  await trips.cancel(offsetTrip.id, { reason: 'Vaqt formati sinovi tugadi' }, actor);
  for (const patch of [{ vehiclePlate: ' ' }, { driverName: ' ' }, { requestKey: 'invalid-key' }]) {
    await rejects(() => trips.dispatch({ ...dispatch(1), ...patch }, actor), 'dispatch requires truck, driver and a valid request key');
  }
  await rejects(() => trips.dispatch(dispatch(1, randomUUID()), actor), 'unknown factory rejected');
  await rejects(() => trips.dispatch(dispatch(13), actor), 'usable stock and factory debt cap enforced');
  await rejects(() => trips.dispatch(dispatch(1, factory.id, '2026-09-30'), actor), 'dispatch cannot precede the stock that supports it');
  const validated = await trips.dispatch(dispatch(10), actor);
  await rejects(() => trips.arrive(validated.id, { date: '2026-10-01' }, actor), 'arrival cannot precede dispatch');
  await rejects(() => trips.arrive(validated.id, { date: '2099-01-01' }, actor), 'arrival cannot be future dated');
  await trips.arrive(validated.id, { date: arrivalDay }, actor);
  await rejects(() => trips.inspect(validated.id, inspection(1, 0, day), actor), 'inspection cannot precede arrival');
  await rejects(() => trips.inspect(validated.id, inspection(0), actor), 'empty inspection rejected');
  await rejects(() => trips.inspect(validated.id, inspection(7, 4), actor), 'accepted plus rejected cannot exceed pending quantity');
  await rejects(() => trips.inspect(validated.id, { ...inspection(2), receiverName: ' ' }, actor), 'receiver is required');
  await rejects(() => trips.inspect(validated.id, { ...inspection(1, 2), rejectionReason: ' ' }, actor), 'rejection requires a reason');
  for (const price of ['-1', 'NaN', 'Infinity', '', 'abc', '999999999999999999999']) {
    await rejects(() => trips.inspect(validated.id, inspection(1, 0, inspectionDay, price), actor), 'invalid acceptance price rejected');
  }
  for (const qty of [0, -1, 0.5, NaN, 2147483648]) {
    await rejects(() => trips.inspect(validated.id, { ...inspection(1), lines: [{ condition: 'Yaroqli', qty, unitPrice: '1' }] }, actor), 'invalid accepted lot quantity rejected');
  }
  await trips.inspect(validated.id, inspection(0, 10), actor);
  await rejects(() => trips.returnRejected(validated.id, returnDto(1, arrivalDay), actor), 'physical return cannot precede rejection');
  for (const qty of [0, -1, 0.5, NaN, 2147483648]) {
    await rejects(() => trips.returnRejected(validated.id, returnDto(qty), actor), 'invalid returned quantity rejected');
  }
  await rejects(() => trips.returnRejected(validated.id, { ...returnDto(1), note: ' ' }, actor), 'physical return requires an explanatory note');
  await balances(2, 12, 'all validation failures are atomic');

  // Every mutation independently enforces factory-level write permissions.
  const permissionsInspection = (await trips.detail(validated.id)).inspections.find((i: any) => !i.voidedAt)!;
  for (const role of ['AGENT', 'CASHIER'] as const) {
    const denied = { ...actor, role };
    await forbidden(() => trips.dispatch(dispatch(1), denied), `${role} cannot dispatch`);
    await forbidden(() => trips.arrive(validated.id, { date: arrivalDay }, denied), `${role} cannot mark arrival`);
    await forbidden(() => trips.reverseArrival(validated.id, { reason: 'Ruxsatsiz' }, denied), `${role} cannot correct arrival`);
    await forbidden(() => trips.inspect(validated.id, inspection(1), denied), `${role} cannot inspect`);
    await forbidden(() => trips.returnRejected(validated.id, returnDto(1), denied), `${role} cannot restock`);
    await forbidden(() => trips.cancel(validated.id, { reason: 'Ruxsatsiz' }, denied), `${role} cannot cancel`);
    await forbidden(() => trips.reverseInspection(permissionsInspection.id, { reason: 'Ruxsatsiz' }, denied), `${role} cannot correct inspection`);
  }

  // Transport retries and double-clicks must not create a second partial operation.
  await reset(); await seed(20);
  const retriedDispatch = dispatch(10);
  const retryResults = await Promise.all([trips.dispatch(retriedDispatch, actor), trips.dispatch(retriedDispatch, actor)]);
  eq(retryResults[0].id, retryResults[1].id, 'same dispatch key resolves to one shipment under concurrency');
  await balances(10, 20, 'dispatch retry consumes stock once');
  await rejects(() => trips.dispatch({ ...retriedDispatch, qty: 11 }, actor), 'conflicting dispatch payload cannot reuse a key');
  await trips.arrive(retryResults[0].id, { date: arrivalDay }, actor);
  const retriedInspection = { ...inspection(3, 3), lines: [
    { condition: 'Qisman shikastlangan, kelishilgan narxda', qty: 2, unitPrice: '90000.10' },
    { condition: 'Zavod tekin qabul qilishga rozi', qty: 1, unitPrice: '0' },
  ] };
  await Promise.all([trips.inspect(retryResults[0].id, retriedInspection, actor), trips.inspect(retryResults[0].id, retriedInspection, actor)]);
  const retried = await state(retryResults[0].id, { acceptedQty: 3, rejectedQty: 3, uninspectedQty: 4, outstandingQty: 7 }, 'partial inspection retry');
  money(retried.acceptanceTotal, '180000.20', 'zero-price and priced lots coexist without losing price precision');
  eq(retried.inspections.filter((i: any) => !i.voidedAt).length, 1, 'one inspection exists for retried request');
  await rejects(() => trips.inspect(retryResults[0].id, { ...retriedInspection, rejectedQty: 2 }, actor), 'conflicting inspection payload cannot reuse a key');
  const retriedReturn = returnDto(2);
  await Promise.all([trips.returnRejected(retryResults[0].id, retriedReturn, actor), trips.returnRejected(retryResults[0].id, retriedReturn, actor)]);
  await state(retryResults[0].id, { returnedQty: 2, rejectedOutstandingQty: 1, outstandingQty: 5 }, 'partial rejected return retry');
  await rejects(() => trips.returnRejected(retryResults[0].id, { ...retriedReturn, qty: 1 }, actor), 'conflicting restock payload cannot reuse a key');
  await balances(12, 17, 'idempotency leaves physical and factory counts exact');
  await rejects(() => trips.inspect(retryResults[0].id, { ...inspection(2, 0, receiptDay), lines: [
    { condition: 'Yaroqli', qty: 1, unitPrice: '1' },
    { condition: 'Noto‘g‘ri son', qty: -1, unitPrice: '1' },
  ] }, actor), 'one invalid lot atomically rejects the entire multi-lot inspection');
  await state(retryResults[0].id, { acceptedQty: 3, uninspectedQty: 4 }, 'failed multi-lot operation leaves no partial acceptance');

  // A mistaken physical receipt can be corrected, but only before its stock is spent.
  await reset(); await seed(10);
  const receiptCorrectionTrip = await trips.dispatch(dispatch(10), actor);
  await trips.arrive(receiptCorrectionTrip.id, { date: arrivalDay }, actor);
  await trips.inspect(receiptCorrectionTrip.id, inspection(4, 6), actor);
  await trips.returnRejected(receiptCorrectionTrip.id, returnDto(6), actor);
  const receiptCorrection = await trips.detail(receiptCorrectionTrip.id);
  const receiptId = receiptCorrection.warehouseReturns[0].id;
  for (const role of ['AGENT', 'CASHIER'] as const) {
    await forbidden(() => trips.reverseWarehouseReturn(receiptId, { reason: 'Ruxsatsiz' }, { ...actor, role }), `${role} cannot correct a physical receipt`);
  }
  for (const reason of ['', ' ', 'x'.repeat(1001)]) {
    await rejects(() => trips.reverseWarehouseReturn(receiptId, { reason }, actor), 'physical receipt correction requires a bounded nonblank reason');
  }
  await trips.reverseWarehouseReturn(receiptId, { reason: 'Omborga hali yetib kelmagan' }, accountant);
  await state(receiptCorrectionTrip.id, { status: 'AWAITING_RETURN', acceptedQty: 4, rejectedQty: 6, returnedQty: 0,
    rejectedOutstandingQty: 6, outstandingQty: 6 }, 'physical receipt correction reopens rejected custody');
  await balances(0, 6, 'physical receipt correction changes stock only');
  eq(await pallets.clientPalletBalance(client.id), 0, 'physical receipt correction does not affect client custody');
  eq(await db.cashTransaction.count(), 0, 'physical receipt correction posts no cash');
  eq(await db.ledgerEntry.count(), 0, 'physical receipt correction posts no money ledger');
  const voidReceiptReport = await daily.report({ from: receiptDay, to: receiptDay });
  eq(voidReceiptReport.rows.find((r) => r.key === 'shipment_outsideWarehouse')?.total, '6', 'physical receipt correction restores original-day outside count');
  eq(voidReceiptReport.rows.find((r) => r.key === 'shipment_rejectedAtFactory')?.total, '6', 'corrected restock remains rejected and away in report');
  await rejects(() => trips.reverseWarehouseReturn(receiptId, { reason: 'Yana' }, actor), 'physical receipt cannot be corrected twice');
  await trips.returnRejected(receiptCorrectionTrip.id, returnDto(3), actor);
  await trips.returnRejected(receiptCorrectionTrip.id, returnDto(3), actor);
  const liveReceipts = (await trips.detail(receiptCorrectionTrip.id)).warehouseReturns.filter((r: any) => !r.voidedAt);
  const receiptReverseRace = await Promise.allSettled([1, 2].map(() => trips.reverseWarehouseReturn(liveReceipts[0].id, { reason: 'Bitta tuzatish' }, actor)));
  eq(receiptReverseRace.filter((r) => r.status === 'fulfilled').length, 1, 'only one simultaneous receipt correction commits');
  await balances(3, 6, 'duplicate physical receipt correction does not remove stock twice');
  const reused = await trips.dispatch(dispatch(3, factory.id, receiptDay), actor);
  await rejects(() => trips.reverseWarehouseReturn(liveReceipts[1].id, { reason: 'Ombor qaydi xato' }, actor), 'cannot correct a receipt already used by a later dispatch');
  await balances(0, 6, 'blocked receipt correction leaves later dispatch supported');
  await trips.cancel(reused.id, { reason: 'Bog‘liq jo‘natma tuzatildi' }, actor);
  await trips.reverseWarehouseReturn(liveReceipts[1].id, { reason: 'Endi ombor qaydini tuzatish mumkin' }, actor);
  const rejectedInspection = (await trips.detail(receiptCorrectionTrip.id)).inspections.find((i: any) => !i.voidedAt)!;
  await trips.reverseInspection(rejectedInspection.id, { reason: 'Ombor qaydlari tuzatilgach qabulni qayta ko‘rish' }, actor);
  await state(receiptCorrectionTrip.id, { status: 'INSPECTING', acceptedQty: 0, rejectedQty: 0, returnedQty: 0,
    uninspectedQty: 10, outstandingQty: 10 }, 'correction chain restores original uninspected custody');
  await balances(0, 10, 'receipt then inspection correction preserves conservation');
  for (const reason of ['', ' ', 'x'.repeat(1001)]) {
    await rejects(() => trips.reverseArrival(receiptCorrectionTrip.id, { reason }, actor), 'arrival correction requires a bounded nonblank reason');
  }
  await trips.reverseArrival(receiptCorrectionTrip.id, { reason: 'Kelish ham xato qayd qilingan' }, accountant);
  await state(receiptCorrectionTrip.id, { status: 'IN_TRANSIT', arrivedAt: null, outstandingQty: 10 }, 'arrival correction after dependent records are void');
  await balances(0, 10, 'arrival correction does not invent warehouse stock');
  await rejects(() => trips.reverseArrival(receiptCorrectionTrip.id, { reason: 'Yana' }, actor), 'arrival cannot be corrected twice');
  await trips.cancel(receiptCorrectionTrip.id, { reason: 'Barcha bog‘liq xatolar tuzatilgach reys bekor' }, actor);
  await state(receiptCorrectionTrip.id, { status: 'CANCELLED', outstandingQty: 0 }, 'full correction chain permits dispatch cancellation');
  await balances(10, 10, 'full correction chain restores original warehouse stock and obligation');
  const fullyVoidedReport = await daily.report({ from: day, to: receiptDay });
  eq(fullyVoidedReport.rows.find((r) => r.key === 'shipment_outsideWarehouse')?.total ?? '0', '0', 'fully corrected shipment leaves no historical away balance');

  // Current stock is insufficient as a proof: later receipts cannot support earlier redispatches.
  await reset(); await seed(5);
  const historicalReceiptTrip = await trips.dispatch(dispatch(5), actor);
  await trips.arrive(historicalReceiptTrip.id, { date: arrivalDay }, actor);
  await trips.inspect(historicalReceiptTrip.id, inspection(0, 5), actor);
  await trips.returnRejected(historicalReceiptTrip.id, returnDto(5), actor);
  const historicalReceipt = (await trips.detail(historicalReceiptTrip.id)).warehouseReturns[0];
  await trips.dispatch(dispatch(5, factory.id, receiptDay), actor);
  await db.palletTransaction.createMany({ data: [
    { type: 'RECEIVED_FROM_FACTORY', factoryId: other.id, qty: 5, date: new Date('2026-10-06T07:00:00Z') },
    { type: 'DELIVERED_TO_CLIENT', clientId: donor.id, qty: 5, date: new Date('2026-10-06T07:00:00Z') },
    { type: 'RETURNED_BY_CLIENT', clientId: donor.id, qty: 5, date: new Date('2026-10-06T07:00:00Z') },
  ] });
  eq(await pallets.dealerInHand(), 5, 'later stock makes current-only check appear sufficient');
  await rejects(() => trips.reverseWarehouseReturn(historicalReceipt.id, { reason: 'Tarixiy qaydni tuzatish' }, actor), 'historical stock guard rejects receipt removal despite sufficient current stock');
  eq((await db.factoryPalletWarehouseReturn.findUniqueOrThrow({ where: { id: historicalReceipt.id } })).voidedAt, null, 'historical rejection rolls back void metadata atomically');
  eq(await pallets.dealerInHand(), 5, 'failed historical receipt correction leaves all stock untouched');

  // Shared global warehouse capacity, not one independently spendable pool per factory.
  await reset(); await seed(5, 0); await seed(5, 5, other.id, donor.id);
  const race = await Promise.allSettled([trips.dispatch(dispatch(4), actor), trips.dispatch(dispatch(4, other.id), actor)]);
  eq(race.filter((r) => r.status === 'fulfilled').length, 1, 'only one cross-factory dispatch wins limited global stock');
  eq(race.filter((r) => r.status === 'rejected').length, 1, 'second dispatch rechecks stock after lock');
  eq(await pallets.dealerInHand(), 1, 'dispatch race cannot overspend warehouse stock');
  eq((await pallets.overview()).drift, 0, 'dispatch race reconciles');
  const winner = (race.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<any>).value;
  const cancelRace = await Promise.allSettled([1, 2].map(() => trips.cancel(winner.id, { reason: 'Bitta xatoni tuzatish' }, actor)));
  eq(cancelRace.filter((r) => r.status === 'fulfilled').length, 1, 'one cancellation wins');
  eq(await pallets.dealerInHand(), 5, 'duplicate cancellation cannot mint usable stock');

  await reset(); await seed(5, 0); await seed(5, 5, other.id, donor.id);
  const competingWriteOff = await Promise.allSettled([
    trips.dispatch(dispatch(4), actor),
    pallets.recordFactoryDefect({ factoryId: other.id, qty: 4, date: day, note: 'Zavoddan yaroqsiz kelgan' }, actor),
  ]);
  eq(competingWriteOff.filter((r) => r.status === 'fulfilled').length, 1, 'dispatch and factory defect share the same warehouse lock');
  eq(await pallets.dealerInHand(), 1, 'concurrent defect and dispatch cannot spend the same pallets');
  eq((await pallets.overview()).drift, 0, 'dispatch/defect concurrency preserves physical conservation');

  await reset(); await seed(4);
  const arrivalRaceTrip = await trips.dispatch(dispatch(4), actor);
  const arrivalRace = await Promise.allSettled([
    trips.arrive(arrivalRaceTrip.id, { date: arrivalDay }, actor),
    trips.cancel(arrivalRaceTrip.id, { reason: 'Jo‘natish xato' }, actor),
  ]);
  eq(arrivalRace.filter((r) => r.status === 'fulfilled').length, 1, 'arrival and dispatch cancellation cannot both win');
  const arrivalWinner = await trips.detail(arrivalRaceTrip.id);
  ok(['INSPECTING', 'CANCELLED'].includes(arrivalWinner.status), 'arrival/cancellation race has one coherent terminal outcome');
  await balances(arrivalWinner.status === 'CANCELLED' ? 4 : 0, 4, 'arrival/cancellation race');

  // A shipment reserves its factory's count even when more warehouse stock exists.
  await reset(); await seed(10); await seed(10, 10, other.id, donor.id);
  const reserved = await trips.dispatch(dispatch(8), actor);
  await rejects(() => trips.dispatch(dispatch(3), actor), 'pending shipment prevents reserving the same factory liability twice');
  await rejects(() => pallets.recordFactoryDefect({ factoryId: factory.id, qty: 3, date: day, note: 'Singan poddon' }, actor), 'defect cannot waive liability already backing an active shipment');
  eq(await pallets.dealerInHand(), 12, 'failed conflicting defect leaves shared stock intact');
  eq(await pallets.factoryPalletBalance(factory.id), 10, 'failed conflicting defect leaves factory debt intact');
  await trips.arrive(reserved.id, { date: arrivalDay }, actor);
  const inspectRace = await Promise.allSettled([1, 2].map(() => trips.inspect(reserved.id, inspection(8), actor)));
  eq(inspectRace.filter((r) => r.status === 'fulfilled').length, 1, 'only one full inspection commits');
  await state(reserved.id, { acceptedQty: 8, outstandingQty: 0, status: 'COMPLETED' }, 'concurrent acceptance');
  eq(await pallets.factoryPalletBalance(factory.id), 2, 'concurrent acceptance settles count exactly once');
  const singleInspection = (await trips.detail(reserved.id)).inspections.find((i: any) => !i.voidedAt)!;
  const reverseRace = await Promise.allSettled([1, 2].map(() => trips.reverseInspection(singleInspection.id, { reason: 'Bitta tuzatish' }, actor)));
  eq(reverseRace.filter((r) => r.status === 'fulfilled').length, 1, 'only one simultaneous inspection correction commits');
  eq(await pallets.factoryPalletBalance(factory.id), 10, 'duplicate correction cannot inflate factory obligation');
  await trips.inspect(reserved.id, inspection(0, 8), actor);
  const restockRace = await Promise.allSettled([1, 2].map(() => trips.returnRejected(reserved.id, returnDto(8), actor)));
  eq(restockRace.filter((r) => r.status === 'fulfilled').length, 1, 'only one full physical restock commits');
  eq(await pallets.dealerInHand(), 20, 'duplicate restock cannot mint stock');
  eq((await pallets.overview()).drift, 0, 'concurrent inspection/correction/restock reconciles');

  // Supporting client returns and source orders cannot be rewritten under a live trip.
  await reset(); await seed(5);
  const supported = await trips.dispatch(dispatch(5), actor);
  const sourceReturn = await db.palletTransaction.findFirstOrThrow({ where: { type: 'RETURNED_BY_CLIENT', clientId: client.id } });
  await rejects(() => pallets.reverseClientMovement(sourceReturn.id, { reason: 'Mijoz noto‘g‘ri' }, actor), 'supporting return cannot be undone while pallets are away');
  await balances(0, 5, 'blocked supporting-return reversal is atomic');
  await trips.cancel(supported.id, { reason: 'Avval jo‘natish xatosi tuzatildi' }, actor);
  await pallets.reverseClientMovement(sourceReturn.id, { reason: 'Mijoz noto‘g‘ri' }, actor);
  await balances(0, 5, 'return correction works after dispatch correction');

  await reset();
  const order = await db.order.create({ data: { orderNo: 'SHIPMENT-SUPPORT', date: at, status: 'COMPLETED',
    clientId: client.id, factoryId: factory.id, transportMode: 'CLIENT_OWN' } });
  await db.$transaction((tx) => pallets.recordOrderPallets(tx, { orderId: order.id, factoryId: factory.id,
    clientId: client.id, date: at, items: [{ palletCount: 5 }] }));
  await seed(5, 5, other.id, donor.id);
  const orderTrip = await trips.dispatch(dispatch(5), actor);
  const product = await db.product.create({ data: { name: 'Shipment source edit product', factoryId: other.id } });
  await db.productPrice.create({ data: { productId: product.id, kind: 'FACTORY_BANK', pricePerM3: 100, effectiveFrom: at } });
  await rejects(() => orders.update(order.id, { items: [{ productId: product.id, palletCount: 5, quantityM3: 5, salePricePerM3: 200 }] }, actor), 'order factory edit cannot erase reserved factory debt');
  eq((await db.order.findUniqueOrThrow({ where: { id: order.id } })).factoryId, factory.id, 'blocked order edit preserves source factory');
  await rejects(() => orders.adminPatch(order.id, { date: '2026-10-03T07:00:00Z' }, actor), 'source receipt cannot move after dispatch date');
  eq((await db.order.findUniqueOrThrow({ where: { id: order.id } })).date.toISOString(), at.toISOString(), 'blocked date edit is atomic');
  await rejects(() => orders.cancel(order.id, { reason: 'Manba buyurtma xato' }, actor), 'order cancel cannot strand a dispatch reservation');
  eq((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status, 'COMPLETED', 'blocked cancellation leaves order alive');
  eq(await db.palletTransaction.count({ where: { orderId: order.id, type: 'REVERSAL' } }), 0, 'blocked cancellation creates no partial reversal rows');
  await trips.cancel(orderTrip.id, { reason: 'Manba buyurtmani tuzatishdan oldin' }, actor);
  await orders.cancel(order.id, { reason: 'Endi bekor qilish mumkin' }, actor);
  eq((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status, 'CANCELLED', 'order cancel succeeds once trip is corrected');

  // Import rollback must detect externally created dispatches even if batch sums net to zero.
  await reset();
  const batch = await db.importBatch.create({ data: { filename: 'shipment-support-synthetic.xlsx', status: 'COMMITTED' } });
  await seed(5, 5, factory.id, client.id, batch.id);
  const importTrip = await trips.dispatch(dispatch(5), actor);
  await rejects(() => runRollback(db, batch.id, actor.userId), 'import rollback cannot erase stock supporting an external dispatch');
  eq((await db.importBatch.findUniqueOrThrow({ where: { id: batch.id } })).status, 'COMMITTED', 'blocked rollback keeps committed batch');
  eq(await db.palletTransaction.count({ where: { importBatchId: batch.id, type: 'REVERSAL' } }), 0, 'blocked rollback leaves no partial compensation');
  await trips.cancel(importTrip.id, { reason: 'Importni tuzatish' }, actor);
  const rolled = await runRollback(db, batch.id, actor.userId);
  eq(rolled.palletSum, 0, 'rollback succeeds after correcting the dependent dispatch');
  await balances(0, 0, 'rollback completes cleanly');

  await reset();
  const completedBatch = await db.importBatch.create({ data: { filename: 'shipment-completed-support.xlsx', status: 'COMMITTED' } });
  await seed(5, 5, factory.id, client.id, completedBatch.id);
  const completedImportTrip = await trips.dispatch(dispatch(5), actor);
  await trips.arrive(completedImportTrip.id, { date: arrivalDay }, actor);
  await trips.inspect(completedImportTrip.id, inspection(5), actor);
  await state(completedImportTrip.id, { status: 'COMPLETED', acceptedQty: 5, outstandingQty: 0 }, 'accepted imported stock');
  await rejects(() => runRollback(db, completedBatch.id, actor.userId), 'completed trip still protects its supporting historical import');
  eq((await db.importBatch.findUniqueOrThrow({ where: { id: completedBatch.id } })).status, 'COMMITTED', 'blocked completed-trip rollback stays atomic');
  await balances(0, 0, 'failed rollback cannot erase completed physical history');
}

async function main() {
  const url = new URL(process.env.FACTORY_RETURN_TEST_DATABASE_URL ?? 'postgresql://postgres@localhost:5433/smartblok');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Only local PostgreSQL is allowed');
  const schema = `factory_shipment_test_${Date.now()}_${randomBytes(6).toString('hex')}`;
  assert.match(schema, /^factory_shipment_test_\d+_[a-f0-9]{12}$/);
  const isolated = new URL(url); isolated.searchParams.set('schema', schema); isolated.searchParams.set('connection_limit', '5');
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
    if (migration.status !== 0) throw new Error(`Disposable schema migration failed: ${migration.stderr || migration.stdout}`);
    eq((await db.$queryRaw<{ schema: string }[]>`SELECT current_schema() AS schema`)[0].schema, schema, 'exact disposable schema');
    await run(db, schema);
    console.log(`Factory return shipment lifecycle: ${checks} assertions passed`);
  } finally {
    await db.$disconnect();
    if (created) await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.$disconnect();
  }
}
main().catch((e) => {
  console.error(String(e.stack ?? e.message ?? e).replace(/postgres(?:ql)?:\/\/[^\s'"`]+/gi, '[redacted PostgreSQL URL]'));
  process.exitCode = 1;
});
