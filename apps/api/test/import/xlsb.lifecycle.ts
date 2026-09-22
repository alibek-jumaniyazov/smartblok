/**
 * Real XLSB upload → resolution → preview → commit → rollback, in a disposable
 * PostgreSQL schema. Run: npx tsx apps/api/test/import/xlsb.lifecycle.ts
 *
 * Reads DATABASE_URL from the environment or apps/api/.env, accepts localhost
 * (optional XLSB_TEST_DB_PORT selects a different local server),
 * only, migrates a newly generated import_xlsb_test_* schema, and drops precisely
 * that schema in finally. It never resets or imports into an existing schema.
 *
 * Оплата r226 has no client in the actual source. Assigning it to Гранд below is
 * ONLY a synthetic test decision; this test makes no claim about its real owner.
 */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Prisma, PrismaClient } from '@prisma/client';
import { ImportService } from '../../src/import/import.service';
import type { AiReviewService } from '../../src/import/rules/ai-review.service';
import type { RequestUser } from '../../src/common/scoping';
import { clientUnallocatedPayments } from '../../src/common/auto-allocate';

const API = resolve(__dirname, '../..');
const WORKBOOK = resolve(API, '../../docs/Smart blok.xlsb');
const D = Prisma.Decimal;
const fixtureClient = 'Гранд'; // Hypothetical test-only resolution of the unnamed r226.
const G = {
  orders: 478,
  sale: '10541629899.91', cost: '8602320762.00', transport: '1116796105.22',
  charge: '9677805899.93', paid: '9433700900.00', goodsPaid: '9052150900.00',
  palletMoney: '381550000.00', factoryPaid: '8255239420.00', factoryBalance: '-347081342.00',
  delivered: 8551, returned: 5511, palletsPaid: 2935, palletDebt: 105,
  factoryReturned: 4392, dealerInHand: 1119, factoryPalletDebt: 4159,
};
let checks = 0;
function eq(actual: unknown, expected: unknown, label: string) {
  assert.deepEqual(actual, expected, label);
  checks++;
}
function money(actual: unknown, expected: string, label: string, tolerance = '0.10') {
  const value = new D(String(actual));
  assert.ok(value.minus(expected).abs().lte(tolerance), `${label}: expected ${expected}, got ${value}`);
  checks++;
}
async function rejects(action: () => Promise<unknown>, label: string) {
  await assert.rejects(action, (error: any) => {
    assert.ok([400, 409].includes(error?.getStatus?.()), `${label}: expected validation/conflict error`);
    return true;
  }, label);
  checks++;
}
function databaseUrl() {
  const fromEnvironment = process.env.DATABASE_URL;
  const configured = fromEnvironment ?? readFileSync(resolve(API, '.env'), 'utf8')
    .match(/^\s*(?:export\s+)?DATABASE_URL\s*=\s*(.+)\s*$/m)?.[1]?.trim().replace(/^(['"])(.*)\1$/, '$2');
  assert.ok(configured, 'DATABASE_URL is required');
  const url = new URL(configured);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol), 'PostgreSQL URL required');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Only localhost PostgreSQL is allowed');
  if (process.env.XLSB_TEST_DB_PORT) {
    assert.match(process.env.XLSB_TEST_DB_PORT, /^\d{1,5}$/);
    url.port = process.env.XLSB_TEST_DB_PORT;
  }
  return url;
}

async function run(prisma: PrismaClient) {
  const user = { userId: null, username: 'xlsb-fixture', role: 'ADMIN', name: 'XLSB fixture', agentId: null } as unknown as RequestUser;
  // A deterministic local test must never send source data to an AI provider.
  const ai = { review: async () => [] } as unknown as AiReviewService;
  const service = new ImportService(prisma as never, ai);
  const buffer = readFileSync(WORKBOOK);
  console.log('XLSB lifecycle: upload and unresolved-source gates');
  eq(await prisma.order.count(), 0, 'disposable schema starts empty');
  const staged = await service.uploadAndStage(buffer, 'Smart blok.xlsb', user);
  const id = staged.batch.id;
  eq(staged.rowsByKind, {
    SHIPMENT: 478, CLIENT_PAYMENT: 224, FACTORY_PAYMENT: 66,
    PALLET_RETURN: 118, FACTORY_PALLET_RETURN: 14,
  }, 'every populated source transaction is staged');
  eq(staged.incompleteRows.length, 1, 'one unfinished factory-pallet row is disclosed');
  eq(staged.incompleteRows[0].origin.excelRow, 18, 'unfinished source coordinate retained');
  eq(staged.pendingEntities, 0, 'source dictionary resolves named clients');
  eq(staged.openBlockers, 1, 'only the actual unnamed payment blocks import');
  eq(staged.commitReady, false, 'unresolved source cannot be committed');

  const rows = await service.listRows(id);
  const unnamed = rows.find((r) => r.kind === 'CLIENT_PAYMENT' && r.excelRow === 226);
  assert.ok(unnamed, 'unnamed payment r226 is retained'); checks++;
  const original = unnamed.parsedJson as Record<string, unknown>;
  eq(original.clientRaw, '', 'source has no client; no inferred assignment');
  money(original.bank, '163350000.00', 'unnamed payment amount preserved', '0');
  const issue = (await service.listIssues(id)).find((i) => i.rowId === unnamed.id && i.ruleId === 'MIJOZ_YOQ');
  assert.ok(issue, 'r226 has an actionable missing-client issue'); checks++;
  eq(issue.field, 'clientRaw', 'review UI can edit this blocker');
  await rejects(() => service.preview(id, 'APPEND'), 'preview refuses unresolved source');
  await rejects(() => service.commit(id, 'no-valid-preview', user, 'APPEND'), 'commit refuses unresolved source');
  await rejects(() => service.resolveIssue(id, issue.id, { status: 'ACCEPTED', value: ' ' }, user), 'empty resolution refused');
  // Closing the warning without fixing its data must not bypass revalidation.
  try { await service.resolveIssue(id, issue.id, { status: 'IGNORED' }, user); } catch (error: any) {
    assert.ok([400, 409].includes(error?.getStatus?.()), 'ignore failed for a domain validation reason');
  }
  await rejects(() => service.preview(id, 'APPEND'), 'ignored flag cannot bypass the missing-client data');
  eq(await prisma.order.count(), 0, 'validation attempts create no orders');
  await service.resolveIssue(id, issue.id, { status: 'ACCEPTED', value: fixtureClient }, user);
  const resolved = await prisma.importRow.findUniqueOrThrow({ where: { id: unnamed.id } });
  eq((resolved.resolvedJson as any).clientRaw, fixtureClient, 'test decision saves editable name');
  eq((resolved.resolvedJson as any).resolvedClientName, fixtureClient, 'test decision reaches commit routing');
  eq((resolved.parsedJson as any).clientRaw, '', 'original source remains unchanged');
  eq((await service.getBatch(id)).commitReady, true, 'explicit test decision unblocks commit');

  console.log('XLSB lifecycle: financial preview and mode binding');
  const preview = await service.preview(id, 'APPEND');
  eq(await prisma.order.count(), 0, 'dry run leaves no orders');
  eq(await prisma.payment.count(), 0, 'dry run leaves no payments');
  eq(await prisma.ledgerEntry.count(), 0, 'dry run leaves no ledger entries');
  eq(preview.orders, G.orders, 'preview shipment count');
  money(preview.saleTotal, G.sale, 'audited sale total');
  money(preview.costTotal, G.cost, 'audited block cost');
  money(preview.transportSettled, G.transport, 'audited transport total');
  money(preview.clientChargeable, G.charge, 'audited client charge');
  money(preview.clientPaidTotal, G.paid, 'all 224 payments including the explicit fixture decision');
  money(preview.clientPaidGoods, G.goodsPaid, 'net goods payments including refund and correction');
  money(preview.clientPaidPallets, G.palletMoney, 'net pallet money');
  money(preview.factoryTransferred, G.factoryPaid, 'factory transfers');
  money(preview.factoryBalance, G.factoryBalance, 'factory balance excludes pallet money');
  money(preview.clientDebtTotal, new D(G.charge).minus(G.goodsPaid).toFixed(2), 'client ledger identity');
  money(preview.vehicleBalance, '0.00', 'drivers fully settled', '0');
  eq(preview.pallets, {
    delivered: G.delivered, returnedByClients: G.returned, paidByClients: G.palletsPaid,
    clientDebt: G.palletDebt, returnedToFactory: G.factoryReturned, dealerInHand: G.dealerInHand,
  }, 'audited signed pallet totals');
  eq(preview.factories.reduce((sum, f) => sum + f.palletsOwed, 0), G.factoryPalletDebt, 'factory pallets owed');
  eq(preview.skipped.length, 0, 'no staged financial row silently skipped');
  await rejects(() => service.commit(id, preview.previewHash, user, 'REPLACE'), 'APPEND preview cannot authorize REPLACE');
  eq(await prisma.order.count(), 0, 'mode mismatch creates no orders');

  console.log('XLSB lifecycle: commit, refund and negative corrections');
  const committed = await service.commit(id, preview.previewHash, user, 'APPEND');
  const { previewHash: _hash, ...expectedPreview } = preview;
  eq(committed, expectedPreview, 'commit and preview results agree exactly');
  eq((await service.getBatch(id)).batch.status, 'COMMITTED', 'batch committed');
  eq(await prisma.order.count({ where: { importBatchId: id } }), G.orders, '478 persisted orders');
  await rejects(() => service.commit(id, preview.previewHash, user, 'APPEND'), 'duplicate commit refused');
  await rejects(() => service.patchRow(id, unnamed.id, { clientRaw: 'Other client' }), 'committed source cannot be edited');
  await rejects(() => service.preview(id, 'APPEND'), 'committed batch cannot be previewed again');
  const orderTotals = await prisma.order.aggregate({ where: { importBatchId: id }, _sum: { saleTotal: true, costTotal: true } });
  money(orderTotals._sum.saleTotal, G.sale, 'persisted order sale cents');
  money(orderTotals._sum.costTotal, G.cost, 'persisted order cost cents');
  for (const [account, total] of [
    ['CLIENT', preview.clientDebtTotal], ['FACTORY', preview.factoryBalance], ['VEHICLE', '0.00'],
  ] as const) {
    const ledger = await prisma.ledgerEntry.aggregate({ where: { importBatchId: id, account }, _sum: { amount: true } });
    money(ledger._sum.amount ?? 0, total, `persisted ${account} ledger equals preview`, '0');
  }
  const refunds = await prisma.payment.findMany({
    where: { importBatchId: id, kind: 'CLIENT_REFUND', method: 'CLICK', amount: new D(5_000_000) },
  });
  eq(refunds.length, 1, 'the source −5M Click refund is retained');
  eq(refunds[0].method, 'CLICK', 'refund remains in its source Click channel');
  money(refunds[0].amount, '5000000.00', 'signed −5M becomes positive refund payment', '0');
  const refundCash = await prisma.cashTransaction.findMany({ where: { paymentId: refunds[0].id } });
  eq(refundCash.length, 1, 'refund has one cash movement');
  eq(refundCash[0].direction, 'OUT', 'refund debits the cashbox');
  money(refundCash[0].amount, '5000000.00', 'refund cash value', '0');
  const refundLedger = await prisma.ledgerEntry.aggregate({ where: { paymentId: refunds[0].id, account: 'CLIENT' }, _sum: { amount: true } });
  money(refundLedger._sum.amount, '5000000.00', 'refund increases client debt', '0');
  const correctionTypes = ['RETURNED_BY_CLIENT', 'RETURNED_TO_FACTORY', 'CHARGED_LOST'] as const;
  for (const type of correctionTypes) {
    const count = await prisma.palletTransaction.count({ where: { importBatchId: id, type: 'REVERSAL', reversalOfType: type } });
    assert.ok(count > 0, `${type} negative correction is linked to its original`); checks++;
  }
  eq(await prisma.palletTransaction.count({ where: { importBatchId: id, type: 'ADJUSTMENT' } }), 0, 'negative corrections retain their financial meaning');
  const allocations = await prisma.paymentAllocation.findMany({ where: { payment: { importBatchId: id, kind: 'CLIENT_IN' }, voidedAt: null }, select: { amount: true } });
  const allocated = allocations.reduce((sum, row) => sum.plus(row.amount), new D(0));
  money(allocated, preview.allocatedToOrders, 'persisted FIFO allocations match preview', '0');
  // This is the same eligibility query used when a later live order consumes an
  // advance. Pallet money/refunds must not reappear as available goods money.
  const futureOrderFunds = await prisma.$transaction(async (tx) => {
    let total = new D(0);
    for (const client of await tx.client.findMany({ select: { id: true } })) {
      const funds = await clientUnallocatedPayments(tx, client.id);
      for (const payment of funds) total = total.plus(payment.free);
    }
    return total;
  }, { timeout: 30_000 });
  money(futureOrderFunds, preview.clientAdvanceLeft, 'future-order eligibility excludes paid pallets and refunds', '0');

  console.log('XLSB lifecycle: rollback invariants');
  const rollback = await service.rollback(id, user);
  eq(rollback.ledgerSum, '0.00', 'rollback ledger zero');
  eq(rollback.palletSum, 0, 'rollback pallet zero');
  eq(rollback.cashSum, '0.00', 'rollback cash zero');
  eq(rollback.bonusSum, '0.00', 'rollback bonus zero');
  eq(rollback.cancelledOrders, G.orders, 'all imported orders cancelled');
  eq((await service.getBatch(id)).batch.status, 'ROLLED_BACK', 'batch rolled back');
  eq(await prisma.order.count({ where: { importBatchId: id, status: { not: 'CANCELLED' } } }), 0, 'no active imported order');
  eq(await prisma.payment.count({ where: { importBatchId: id, voidedAt: null } }), 0, 'all payments voided');
  eq(await prisma.paymentAllocation.count({ where: { payment: { importBatchId: id }, voidedAt: null } }), 0, 'all allocations voided');
  eq(await prisma.expense.count({ where: { importBatchId: id, voidedAt: null } }), 0, 'all expenses voided');
  eq(await prisma.importFingerprint.count({ where: { batchId: id } }), 0, 'rollback releases fingerprints');
  // Check each party and factory bucket separately, not only an aggregate which
  // could hide opposite nonzero balances cancelling each other.
  const ledgerGroups = await prisma.ledgerEntry.groupBy({
    by: ['account', 'clientId', 'factoryId', 'vehicleId', 'factoryBucket'],
    where: { importBatchId: id }, _sum: { amount: true },
  });
  for (const row of ledgerGroups) money(row._sum.amount ?? 0, '0.00', 'each ledger party/bucket nets to zero', '0');
  const cash = await prisma.cashTransaction.findMany({ where: { importBatchId: id } });
  const cashByBox = new Map<string, Prisma.Decimal>();
  for (const row of cash) cashByBox.set(row.cashboxId, (cashByBox.get(row.cashboxId) ?? new D(0)).plus(row.direction === 'IN' ? row.amount : row.amount.negated()));
  for (const total of cashByBox.values()) money(total, '0.00', 'each cashbox nets to zero', '0');
  const pallets = await prisma.palletTransaction.findMany({ where: { importBatchId: id } });
  const palletsByParty = new Map<string, number>();
  for (const row of pallets) {
    const outgoing = ['RETURNED_BY_CLIENT', 'RETURNED_TO_FACTORY', 'CHARGED_LOST'].includes(row.type);
    const delta = outgoing ? -row.qty : row.qty;
    const key = row.clientId ? `client:${row.clientId}` : `factory:${row.factoryId}`;
    palletsByParty.set(key, (palletsByParty.get(key) ?? 0) + delta);
  }
  for (const total of palletsByParty.values()) eq(total, 0, 'each pallet party nets to zero');
  await rejects(() => service.rollback(id, user), 'second rollback refused');
  await rejects(() => service.patchRow(id, unnamed.id, { clientRaw: fixtureClient }), 'rolled-back source cannot be edited');
}

async function main() {
  const base = databaseUrl();
  const schema = `import_xlsb_test_${Date.now()}_${randomBytes(6).toString('hex')}`;
  assert.match(schema, /^import_xlsb_test_\d+_[a-f0-9]{12}$/);
  const isolated = new URL(base);
  isolated.searchParams.set('schema', schema);
  isolated.searchParams.set('connection_limit', '5');
  // Prevent future migrations with hard-coded public targets from touching an
  // existing schema even if someone later adds one to the migration directory.
  const migrations = resolve(API, 'prisma/migrations');
  for (const entry of readdirSync(migrations, { withFileTypes: true }).filter((e) => e.isDirectory())) {
    const sql = readFileSync(resolve(migrations, entry.name, 'migration.sql'), 'utf8');
    assert.ok(!/(?:\bpublic|"public")\s*\./i.test(sql), 'schema-qualified public migration is unsafe for this harness');
  }
  const admin = new PrismaClient({ datasources: { db: { url: base.toString() } } });
  const prisma = new PrismaClient({ datasources: { db: { url: isolated.toString() } } });
  let created = false;
  try {
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    created = true;
    console.log('XLSB lifecycle: disposable localhost schema created');
    const migration = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
      cwd: API, env: { ...process.env, DATABASE_URL: isolated.toString() }, encoding: 'utf8', timeout: 120_000,
      windowsHide: true,
    });
    if (migration.status !== 0) throw new Error('Disposable-schema migration failed; credentials/output intentionally omitted.');
    eq((await prisma.$queryRaw<Array<{ schema: string }>>`SELECT current_schema() AS schema`)[0].schema, schema, 'all Prisma models use the exact disposable schema');
    await run(prisma);
    console.log(`XLSB LIFECYCLE PASSED: ${checks} assertions`);
  } finally {
    await prisma.$disconnect();
    if (created) {
      // schema is generated locally and strictly validated above, never user input.
      await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
      const remains = await admin.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM pg_namespace WHERE nspname = ${schema}`;
      assert.equal(Number(remains[0].n), 0, 'disposable schema fully removed');
      console.log('XLSB lifecycle: disposable schema removed');
    }
    await admin.$disconnect();
  }
}

main().catch((error: unknown) => {
  // Database libraries can include a connection string in diagnostics. Never
  // print it; all useful assertion labels and business values remain readable.
  const text = error instanceof Error ? error.message : String(error);
  console.error(text.replace(/postgres(?:ql)?:\/\/[^\s'"`]+/gi, '[redacted PostgreSQL URL]'));
  process.exitCode = 1;
});
