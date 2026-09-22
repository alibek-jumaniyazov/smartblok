/** Imported pallet/refund cash must remain unavailable when a later order is created. */
import assert from 'node:assert/strict';
import { LedgerAccount, LedgerSource, PaymentKind, Prisma, TransportMode } from '@prisma/client';
import { clientUnallocatedPayments } from '../../src/common/auto-allocate';
import { OrdersService } from '../../src/orders/orders.service';

const D = Prisma.Decimal;
const clientId = 'client';
const pay = (id: string, amount: number, batch: string | null, day: number, extra = {}) => ({
  id, amount: new D(amount), importBatchId: batch, date: new Date(Date.UTC(2026, 8, day)),
  kind: PaymentKind.CLIENT_IN, clientId, voidedAt: null, ...extra,
});
const payments = [
  pay('manual', 100, null, 1),
  pay('a-old', 1000, 'a', 2),
  pay('a-new', 1000, 'a', 3),
  pay('b', 300, 'b', 4),
  pay('c', 100, 'c', 5),
  pay('voided-incoming', 10000, 'a', 6, { voidedAt: new Date() }),
  pay('a-refund', 100, 'a', 7, { kind: PaymentKind.CLIENT_REFUND }),
  pay('a-voided-refund', 250, 'a', 8, { kind: PaymentKind.CLIENT_REFUND, voidedAt: new Date() }),
  pay('c-voided-refund', 100, 'c', 9, { kind: PaymentKind.CLIENT_REFUND, voidedAt: new Date() }),
  pay('other-client', 5000, 'a', 10, { clientId: 'other', kind: PaymentKind.CLIENT_REFUND }),
];
const ledger = [
  { importBatchId: 'a', clientId, amount: new D(1000) },
  { importBatchId: 'a', clientId, amount: new D(-1000) }, // original charge reversed
  { importBatchId: 'a', clientId, amount: new D(700) }, // corrected remainder
  { importBatchId: 'b', clientId, amount: new D(1000) }, // cannot consume another batch
  { importBatchId: null, clientId, amount: new D(10000) }, // manual behavior unchanged
  { importBatchId: 'a', clientId: 'other', amount: new D(5000) },
].map((r) => ({ ...r, account: LedgerAccount.CLIENT, source: LedgerSource.PALLET_CHARGE }));
const allocations = [
  { id: 'm-initial', paymentId: 'manual', orderId: 'prior', amount: new D(10), voidedAt: null },
  { id: 'a1-initial', paymentId: 'a-old', orderId: 'prior', amount: new D(400), voidedAt: null },
  { id: 'a2-initial', paymentId: 'a-new', orderId: 'prior', amount: new D(500), voidedAt: null },
  { id: 'a-voided', paymentId: 'a-old', orderId: 'prior', amount: new D(100), voidedAt: new Date() },
];
const matches = (row: any, where: any = {}) => Object.entries(where).every(([key, value]: [string, any]) => {
  if (key === 'payment') return matches(payments.find((p) => p.id === row.paymentId), value);
  if (value && typeof value === 'object' && 'in' in value) return value.in.includes(row[key]);
  return row[key] === value;
});
const group = (rows: any[], query: any) => {
  const sums = new Map<string, Prisma.Decimal>();
  for (const row of rows.filter((r) => matches(r, query.where))) {
    sums.set(row.importBatchId, (sums.get(row.importBatchId) ?? new D(0)).plus(row.amount));
  }
  return [...sums].map(([importBatchId, amount]) => ({ importBatchId, _sum: { amount } }));
};
let reservationQueries = 0;
const tx: any = {
  $executeRaw: async () => 1,
  payment: {
    findMany: async (query: any) => payments.filter((p) => matches(p, query.where))
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .map((p) => ({ ...p, allocations: allocations.filter((a) => a.paymentId === p.id && a.voidedAt === null) })),
    groupBy: async (query: any) => { reservationQueries++; return group(payments, query); },
  },
  ledgerEntry: { groupBy: async (query: any) => { reservationQueries++; return group(ledger, query); } },
  order: { findMany: async () => [{
    id: 'new-order', orderNo: 'ORD-NEW', saleTotal: new D(10000), transportMode: TransportMode.DEALER_ABSORBED, transportCost: new D(0),
  }] },
  paymentAllocation: {
    aggregate: async (query: any) => ({ _sum: { amount: allocations.filter((a) => matches(a, query.where))
      .reduce((sum, a) => sum.plus(a.amount), new D(0)) } }),
    findFirst: async (query: any) => allocations.find((a) => matches(a, query.where)) ?? null,
    create: async ({ data }: any) => { const row = { id: `new-${allocations.length}`, voidedAt: null, ...data }; allocations.push(row); return row; },
  },
};

async function main() {
  const free = await clientUnallocatedPayments(tx, clientId);
  assert.deepEqual(free.map((p) => [p.id, p.free.toFixed(2)]), [
    ['manual', '90.00'], ['a-old', '300.00'], ['c', '100.00'],
  ], 'pallet charges/refunds are reserved within their batch, newest receipts first');
  assert.equal(free.find((p) => p.id === 'a-old')?.amount.toFixed(2), '1000.00', 'gross receipt remains unchanged');

  // Exercise the actual order-creation caller, not just the reservation query.
  // It must forward p.free, otherwise the allocator would recompute gross−allocated
  // and incorrectly spend 600 from a-old despite the 300 goods-money limit.
  await (OrdersService.prototype as any).applyClientAdvance.call({}, tx, clientId, 'test-user');
  const written = allocations.filter((a) => a.orderId === 'new-order');
  assert.deepEqual(written.map((a) => [a.paymentId, a.amount.toFixed(2)]), [
    ['manual', '90.00'], ['a-old', '300.00'], ['c', '100.00'],
  ]);
  assert.equal((await clientUnallocatedPayments(tx, clientId)).length, 0, 'reserved cash does not reappear on a subsequent order');
  await (OrdersService.prototype as any).applyClientAdvance.call({}, tx, clientId, 'test-user');
  assert.equal(allocations.filter((a) => a.orderId === 'new-order').length, 3, 'repeat settlement creates no extra allocations');

  // Cancelling the remaining imported charge releases only its own payment pool.
  ledger.push({ importBatchId: 'a', clientId, amount: new D(-700), account: LedgerAccount.CLIENT, source: LedgerSource.PALLET_CHARGE });
  const released = await clientUnallocatedPayments(tx, clientId);
  assert.equal(released.reduce((sum, p) => sum.plus(p.free), new D(0)).toFixed(2), '700.00');
  assert.ok(released.every((p) => p.id === 'a-old' || p.id === 'a-new'));

  // A manual-only book needs no import reservation queries and keeps its old result.
  const before = reservationQueries;
  const manualTx = { ...tx, payment: { ...tx.payment, findMany: async () => [{
    ...payments[0], allocations: [{ amount: new D(10) }],
  }] } };
  const manual = await clientUnallocatedPayments(manualTx as any, clientId);
  assert.equal(manual[0].free.toFixed(2), '90.00');
  assert.equal(reservationQueries, before);
  console.log('Imported advance reservation regressions passed');
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
