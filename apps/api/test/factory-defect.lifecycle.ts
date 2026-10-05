/** Production services against a uniquely named disposable LOCAL PostgreSQL schema. */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ValidationPipe } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PalletService } from '../src/pallets/pallets.service';
import { FactoryDefectDto } from '../src/pallets/dto';
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
function eq(actual: unknown, expected: unknown, note: string) { assert.equal(String(actual), String(expected), note); checks++; }
async function rejects(action: () => Promise<unknown>, pattern: RegExp, note: string) {
  await assert.rejects(action, pattern, note); checks++;
}

async function run(db: PrismaClient) {
  const prisma = db as never;
  const ledger = new LedgerService(prisma), audit = new AuditService(prisma), settings = new SettingsService(prisma);
  const pallets = new PalletService(prisma, ledger, audit, settings);
  const debts = new DebtsService(prisma, ledger, pallets);
  const clients = new ClientsService(prisma, ledger, audit);
  const factories = new FactoriesService(prisma, ledger, audit, pallets, debts);
  const pricing = new PricingService(), bonus = new BonusService(prisma, ledger, audit);
  const orders = new OrdersService(prisma, ledger, audit, settings, pricing, pallets, bonus,
    new PaymentsService(prisma, ledger, audit, pricing), debts);
  const daily = new DailyReportService(prisma);
  const user = await db.user.create({ data: { username: 'defect-admin', name: 'Test admin', password: 'unusable', role: 'ADMIN' } });
  const actor: RequestUser = { userId: user.id, username: user.username, name: user.name, role: 'ADMIN', agentId: null };
  const accountant: RequestUser = { ...actor, role: 'ACCOUNTANT' };
  const factory = await db.factory.create({ data: { name: 'Defect factory' } });
  const other = await db.factory.create({ data: { name: 'Other factory' } });
  const client = await db.client.create({ data: { name: 'Defect client' } });
  const donor = await db.client.create({ data: { name: 'Other client' } });
  const at = new Date('2026-10-01T07:00:00Z');
  const day = '2026-10-02';
  const dto = (qty: number, factoryId = factory.id, date = day) => ({ factoryId, qty, date, note: 'Zavoddan yaroqsiz kelgan; qaytarish majburiyati yo‘q' });
  const seed = async (qty: number, returned: number, factoryId = factory.id, clientId = client.id, importBatchId?: string) => {
    await db.palletTransaction.createMany({ data: [
      { type: 'RECEIVED_FROM_FACTORY', factoryId, qty, date: at, importBatchId },
      { type: 'DELIVERED_TO_CLIENT', clientId, qty, date: at, importBatchId },
      ...(returned ? [{ type: 'RETURNED_BY_CLIENT' as const, clientId, qty: returned, date: at, importBatchId }] : []),
    ] });
  };
  // Only this random, verified schema is touched; base-money fixture stays constant.
  const resetPallets = async () => {
    await db.palletTransaction.deleteMany({ where: { type: 'REVERSAL' } });
    await db.palletTransaction.deleteMany();
  };
  await db.appSetting.create({ data: { key: 'palletPriceDefault', value: 130000.25 } });
  await db.ledgerEntry.createMany({ data: [
    { account: 'FACTORY', source: 'ADJUSTMENT', factoryId: factory.id, factoryBucket: 'PAYABLE', amount: -100000.01, date: at },
    { account: 'CLIENT', source: 'ADJUSTMENT', clientId: client.id, amount: 123.45, date: at },
  ] });
  await seed(10, 8);
  const beforeLedger = await db.ledgerEntry.count(), beforeCash = await db.cashTransaction.count();
  const first = await pallets.recordFactoryDefect({ ...dto(3), note: '  Singan poddon  ' }, actor);
  eq(first.type, 'DEFECTIVE_FROM_FACTORY', 'dedicated defect movement');
  eq(first.note, 'Singan poddon', 'reason trimmed');
  eq(first.clientId, null, 'factory defect has no client');
  eq(first.unitPrice, null, 'factory defect has no money price');
  eq(first.date.toISOString(), '2026-10-01T19:00:00.000Z', 'bare date uses Tashkent midnight');
  eq(await pallets.factoryPalletBalance(factory.id), 7, 'waiver decreases factory obligation');
  eq(await pallets.dealerInHand(), 5, 'defect cannot be returned from usable stock');
  eq(await pallets.clientPalletBalance(client.id), 2, 'client custody unchanged');
  const stats = await pallets.factoryPalletStatsOne(factory.id);
  eq(stats.received, 10, 'original receipt retained'); eq(stats.returned, 0, 'defect is not a factory return');
  eq(stats.defective, 3, 'explicit defective subtotal'); eq(stats.adjustment, 0, 'no hidden correction');
  const overview = await pallets.overview();
  eq(overview.factory.defective, 3, 'overview defect subtotal'); eq(overview.drift, 0, 'physical/obligation reconciliation');
  const card = await factories.findOne(factory.id);
  eq(card.debtWithoutPallets, '100000.01', 'goods debt unchanged');
  eq(card.debtWithPallets, '1010001.76', 'remaining seven pallets valued at setting price');
  eq((await clients.detail(client.id, actor)).debtWithoutPallets, '123.45', 'client money unchanged');
  eq((await clients.detail(client.id, actor)).palletDebtQuantity, 2, 'client card pallet balance unchanged');
  eq((await debts.summary()).factoriesDualDebt.palletDebtQuantity, 7, 'debt board uses adjusted obligation');
  eq(await db.ledgerEntry.count(), beforeLedger, 'waiver posts no money ledger');
  eq(await db.cashTransaction.count(), beforeCash, 'waiver posts no cash');
  eq(await db.auditLog.count({ where: { entity: 'PalletTransaction', entityId: first.id, action: 'CREATE' } }), 1, 'creation audited once');
  const period = await pallets.factoryPalletStatsPeriod(factory.id, { gte: new Date('2026-10-01T19:00:00Z'), lt: new Date('2026-10-02T19:00:00Z') });
  eq(period.defective, 3, 'defects appear on their business day'); eq(period.balance, -3, 'period delta reflects waiver');
  const dailyReport = await daily.report({ from: day, to: day });
  eq(dailyReport.rows.find((r) => r.key === 'palletDefective')?.total, '3', 'daily report explains defect separately');
  eq(dailyReport.rows.find((r) => r.key === 'palletClosing')?.total, '-7', 'daily factory closing debt agrees');

  for (const role of ['AGENT', 'CASHIER'] as const) {
    await rejects(() => pallets.recordFactoryDefect(dto(1), { ...actor, role }), /faqat admin yoki buxgalter/, `${role} cannot write factory defect`);
    await rejects(() => pallets.reverseClientMovement(first.id, { reason: 'Xato' }, { ...actor, role }), /faqat admin yoki buxgalter/, `${role} cannot reverse factory defect`);
  }
  for (const qty of [0, -1, 1.5, NaN, Infinity, 2147483648]) {
    await rejects(() => pallets.recordFactoryDefect(dto(qty), actor), /musbat butun/, 'invalid quantity rejected');
  }
  for (const note of ['', '  ', 'x'.repeat(1001)]) {
    await rejects(() => pallets.recordFactoryDefect({ ...dto(1), note }, actor), /sababi/, 'reason required and bounded');
  }
  for (const date of ['', 'bad-date', '2026-02-31', '2099-01-01']) {
    await rejects(() => pallets.recordFactoryDefect(dto(1, factory.id, date), actor), /sana|sanasi/, 'invalid or future date rejected');
  }
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
  const validate = (input: unknown) => pipe.transform(input, { type: 'body', metatype: FactoryDefectDto });
  eq((await validate({ ...dto(1), qty: '1' })).qty, 1, 'HTTP numeric quantity normalization');
  for (const patch of [{ unitPrice: 130000 }, { clientId: client.id }, { factoryId: 'invalid' }, { date: '10/01/2026' }]) {
    await rejects(() => validate({ ...dto(1), ...patch }), /Bad Request/, 'HTTP shape rejects unsupported fields or malformed input');
  }
  await rejects(() => pallets.recordFactoryDefect(dto(6), actor), /maksimum 5/, 'usable stock cap enforced');
  await rejects(() => pallets.recordFactoryDefect(dto(1, other.id), actor), /maksimum 0/, 'other factory debt is not borrowed');
  await rejects(() => pallets.recordFactoryDefect(dto(1, randomUUID()), actor), /Zavod topilmadi/, 'unknown factory rejected');
  await rejects(() => pallets.recordFactoryDefect(dto(1, factory.id, '2026-09-30'), actor), /2026-09-30.*zaxirasi/, 'backdate before physical stock rejected');
  eq(await pallets.factoryPalletBalance(factory.id), 7, 'failed commands preserve factory balance');
  const second = await pallets.recordFactoryDefect(dto(5), accountant);
  eq(await pallets.dealerInHand(), 0, 'accountant can mark remaining usable stock defective');
  await rejects(() => pallets.returnToFactory({ factoryId: factory.id, qty: 1, date: day }, actor.userId), /maksimum 0/, 'defective stock cannot be physically returned');
  const returned = await db.palletTransaction.findFirstOrThrow({ where: { type: 'RETURNED_BY_CLIENT', clientId: client.id } });
  await rejects(() => pallets.reverseClientMovement(returned.id, { reason: 'Qaytarish xato' }, actor), /bekor qilib bo.lmaydi|qaytar|zaxira/i, 'supporting client return cannot be undone after defect');
  for (const reason of ['', ' ', 'x'.repeat(1001)]) {
    await rejects(() => pallets.reverseClientMovement(second.id, { reason }, actor), /sababi/, 'defect reversal requires reason');
  }
  const reversed = await pallets.reverseClientMovement(second.id, { reason: 'Tekshiruvda yaroqli chiqdi' }, accountant);
  eq(reversed.reversedKind, 'FACTORY_DEFECT', 'reversal identifies defect flow');
  eq(reversed.factoryPalletBalance, 7, 'reversal restores only its factory obligation');
  eq(reversed.dealerInHand, 5, 'reversal restores usable stock');
  eq((await pallets.factoryPalletStatsOne(factory.id)).defective, 3, 'whole reversal removes only its own subtotal');
  eq((await pallets.factoryPalletStatsPeriod(factory.id, { gte: new Date('2026-10-01T19:00:00Z'), lt: new Date('2026-10-02T19:00:00Z') })).defective, 3, 'reversal belongs to original business day');
  await rejects(() => pallets.reverseClientMovement(second.id, { reason: 'Yana' }, actor), /allaqachon bekor/, 'same defect cannot be reversed twice');
  await rejects(() => db.palletTransaction.create({ data: { type: 'DEFECTIVE_FROM_FACTORY', factoryId: factory.id, qty: 1, date: at, unitPrice: 1 } }), /constraint|check|Invalid/i, 'database disallows defect money');
  await rejects(() => db.palletTransaction.create({ data: { type: 'DEFECTIVE_FROM_FACTORY', factoryId: factory.id, clientId: client.id, qty: 1, date: at } }), /constraint|check|Invalid/i, 'database disallows client-linked defect');
  eq(await db.ledgerEntry.count(), beforeLedger, 'registration and reversal leave money ledger untouched');
  eq(await db.cashTransaction.count(), beforeCash, 'registration and reversal leave cash untouched');

  // Global stock and factory caps must survive concurrent transactions.
  await resetPallets(); await seed(5, 0); await seed(5, 5, other.id, donor.id);
  const race = await Promise.allSettled([pallets.recordFactoryDefect(dto(4), actor), pallets.recordFactoryDefect(dto(4, other.id), actor)]);
  eq(race.filter((r) => r.status === 'fulfilled').length, 1, 'only one competing over-cap request commits');
  eq(race.filter((r) => r.status === 'rejected').length, 1, 'other competing request rechecks after lock');
  eq(await pallets.dealerInHand(), 1, 'race never overspends usable stock');
  eq((await pallets.factoryPalletBalance(factory.id)) + (await pallets.factoryPalletBalance(other.id)), 6,
    'different factories share one stock pool and waive quantity exactly once');
  const winner = (race.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof pallets.recordFactoryDefect>>>).value;
  const reverseRace = await Promise.allSettled([1, 2].map(() => pallets.reverseClientMovement(winner.id, { reason: 'Bitta tuzatish' }, actor)));
  eq(reverseRace.filter((r) => r.status === 'fulfilled').length, 1, 'only one simultaneous reversal commits');
  eq(await db.palletTransaction.count({ where: { reversalOfId: winner.id } }), 1, 'exactly one compensating row');
  eq(await pallets.dealerInHand(), 5, 'double reversal cannot mint stock');
  eq((await pallets.overview()).drift, 0, 'concurrent lifecycle reconciles');

  // Factory provenance cap even when plenty of global stock is available.
  await resetPallets(); await seed(2, 2); await seed(10, 10, other.id, donor.id);
  await rejects(() => pallets.recordFactoryDefect(dto(3), actor), /maksimum 2/, 'factory-specific cap with ample global stock');

  // Receipt/date edits must not strand a factory waiver; cancellation rolls back atomically.
  await resetPallets();
  const order = await db.order.create({ data: { orderNo: 'DEFECT-ORDER', date: at, status: 'COMPLETED', clientId: client.id, factoryId: factory.id, transportMode: 'CLIENT_OWN' } });
  await db.$transaction((tx) => pallets.recordOrderPallets(tx, { orderId: order.id, factoryId: factory.id, clientId: client.id, date: at, items: [{ palletCount: 5 }] }));
  await seed(5, 5, other.id, donor.id);
  const orderDefect = await pallets.recordFactoryDefect(dto(5), actor);
  const product = await db.product.create({ data: { name: 'Defect test product', factoryId: other.id } });
  await db.productPrice.create({ data: { productId: product.id, kind: 'FACTORY_BANK', pricePerM3: 100, effectiveFrom: at } });
  await rejects(() => orders.update(order.id, { items: [{ productId: product.id, palletCount: 5, quantityM3: 5, salePricePerM3: 200 }] }, actor), /poddon qarzi/, 'factory change cannot leave old waiver unsupported');
  eq((await db.order.findUniqueOrThrow({ where: { id: order.id } })).factoryId, factory.id, 'rejected factory edit is atomic');
  await rejects(() => orders.adminPatch(order.id, { date: '2026-10-03T07:00:00Z' }, actor), /poddon qarzi/, 'receipt cannot move after active waiver');
  eq((await db.order.findUniqueOrThrow({ where: { id: order.id } })).date.toISOString(), at.toISOString(), 'rejected date edit leaves source date');
  await rejects(() => orders.cancel(order.id, { reason: 'Xato buyurtma' }, actor), /poddon qarzi/, 'cancellation cannot erase receipt supporting waiver');
  eq((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status, 'COMPLETED', 'rejected cancellation preserves order status');
  eq(await db.palletTransaction.count({ where: { orderId: order.id, type: 'REVERSAL' } }), 0, 'rejected cancellation leaves no partial pallet reversal');
  await pallets.reverseClientMovement(orderDefect.id, { reason: 'Buyurtmani tuzatish uchun' }, actor);
  await orders.cancel(order.id, { reason: 'Endi bekor qilish mumkin' }, actor);
  eq((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status, 'CANCELLED', 'normal cancellation works after waiver correction');
  eq(await pallets.factoryPalletBalance(factory.id), 0, 'corrected cancellation leaves no factory obligation');

  // Import compensation proves its own batch is zero; external manual waivers need a separate guard.
  await resetPallets();
  const batch = await db.importBatch.create({ data: { filename: 'defect-support-synthetic.xlsx', status: 'COMMITTED' } });
  await seed(5, 5, factory.id, client.id, batch.id);
  const importDefect = await pallets.recordFactoryDefect(dto(5), actor);
  await rejects(() => runRollback(db, batch.id, actor.userId), /yaroqli poddon zaxirasi|poddon qarzi/, 'import rollback cannot erase supporting stock');
  eq((await db.importBatch.findUniqueOrThrow({ where: { id: batch.id } })).status, 'COMMITTED', 'blocked rollback keeps batch committed');
  eq(await db.palletTransaction.count({ where: { importBatchId: batch.id, type: 'REVERSAL' } }), 0, 'blocked rollback creates no partial compensation');
  await pallets.reverseClientMovement(importDefect.id, { reason: 'Importni tuzatish' }, actor);
  const rolled = await runRollback(db, batch.id, actor.userId);
  eq(rolled.palletSum, 0, 'rollback succeeds after manual waiver correction');
  eq(await pallets.factoryPalletBalance(factory.id), 0, 'rollback factory zero');
  eq(await pallets.dealerInHand(), 0, 'rollback usable stock zero');
  eq((await pallets.overview()).drift, 0, 'rollback reconciles all counts');
}

async function main() {
  const url = new URL(process.env.FACTORY_DEFECT_TEST_DATABASE_URL ?? 'postgresql://postgres@localhost:5433/smartblok');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Only local PostgreSQL allowed');
  const schema = `factory_defect_test_${Date.now()}_${randomBytes(6).toString('hex')}`;
  assert.match(schema, /^factory_defect_test_\d+_[a-f0-9]{12}$/);
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
    await run(db);
    console.log(`Factory defect lifecycle: ${checks} assertions passed`);
  } finally {
    await db.$disconnect();
    if (created) await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.$disconnect();
  }
}
main().catch((e) => { console.error(String(e.message ?? e).replace(/postgres(?:ql)?:\/\/[^\s'"`]+/gi, '[redacted PostgreSQL URL]')); process.exitCode = 1; });
