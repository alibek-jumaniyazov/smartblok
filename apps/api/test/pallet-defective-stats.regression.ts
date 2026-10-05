import 'reflect-metadata';
import assert from 'node:assert/strict';
import { PalletTransactionType as T, Prisma } from '@prisma/client';
import { dualDebt } from '../src/common/pallet-debt';
import { PalletService } from '../src/pallets/pallets.service';
import { EMPTY_PALLET_STATS, foldPalletStats, hasPalletHistory, PALLET_MINUS_SIDE_TYPES,
  palletStatsSql, sumPalletStats, type PalletStatsRow } from '../src/pallets/pallet-stats';

// No database writes: exercise the production balance combiner and the breakdown
// together. SQL aggregation/reversal dates and mutation caps are lifecycle-tested.
const service = new PalletService(null!, null!, null!, null!);
const combineFactory = (s: Partial<Record<T, number>>) => (service as any).combineFactorySums(s) as number;
const combineClient = (s: Partial<Record<T, number>>) => (service as any).combineClientSums(s) as number;
let checks = 0;
function eq(actual: unknown, expected: unknown, note: string) {
  assert.equal(String(actual), String(expected), note); checks++;
}
function row(party: string, type: T, qty: number, bucket: T = type, bucketQty = qty): PalletStatsRow {
  return { party, rawType: type, rawQty: qty, bucket, bucketQty, money: new Prisma.Decimal(0),
    rowCount: 1, firstAt: new Date('2026-10-01T07:00:00Z'), lastAt: new Date('2026-10-01T07:00:00Z') };
}

const factory = foldPalletStats([
  row('factory', T.RECEIVED_FROM_FACTORY, 20),
  row('factory', T.RETURNED_TO_FACTORY, 3),
  row('factory', T.DEFECTIVE_FROM_FACTORY, 5),
  row('factory', T.REVERSAL, 2, T.DEFECTIVE_FROM_FACTORY, -2),
], 'factory', combineFactory).get('factory')!;
eq(factory.received, 20, 'defects preserve the original factory receipt quantity');
eq(factory.returned, 3, 'defects are not physical returns to the factory');
eq(factory.defective, 3, 'defect reversal restores two pallets to the obligation');
eq(factory.adjustment, 0, 'defects must not be hidden as an unexplained correction');
eq(factory.balance, 14, 'owed = received minus returned minus net defects');
eq(factory.chargedLost, 0, 'factory defect cannot become a client lost-pallet charge');
eq(factory.chargedLostAmount, '0.00', 'factory waiver does not bill money');
const debt = dualDebt('100000.01', factory.balance, '130000.25');
eq(debt.debtWithoutPallets, '100000.01', 'cash/goods debt remains unchanged');
eq(debt.debtWithPallets, '1920003.51', 'only still-owed pallets are valued, including tiyin precision');

const undone = foldPalletStats([
  row('factory', T.RECEIVED_FROM_FACTORY, 20),
  row('factory', T.DEFECTIVE_FROM_FACTORY, 5),
  row('factory', T.REVERSAL, 5, T.DEFECTIVE_FROM_FACTORY, -5),
], 'factory', combineFactory).get('factory')!;
eq(undone.defective, 0, 'whole reversal removes the defect subtotal');
eq(undone.balance, 20, 'whole reversal restores the factory obligation');
eq(undone.adjustment, 0, 'reversed defect leaves no correction residue');
eq(PALLET_MINUS_SIDE_TYPES.has(T.DEFECTIVE_FROM_FACTORY), true, 'defect is a minus-side movement');
eq(palletStatsSql('factoryId').sql.includes("'DEFECTIVE_FROM_FACTORY'"), true,
  'SQL routes reversals of defects back to a net negative defect bucket');

const client = foldPalletStats([
  row('client', T.DELIVERED_TO_CLIENT, 20), row('client', T.RETURNED_BY_CLIENT, 8),
], 'client', combineClient).get('client')!;
eq(client.balance, 12, 'factory defect registration does not erase a client obligation');
eq(client.defective, 0, 'client breakdown keeps factory-only defects out');
eq(client.adjustment, 0, 'existing client subtraction remains exact');
const total = sumPalletStats([factory, undone]);
eq(total.defective, 3, 'overview adds net defects once');
eq(total.balance, 34, 'overview and party balance remain equal');
eq(hasPalletHistory({ ...EMPTY_PALLET_STATS, defective: 5 }), true,
  'a party with a defect history remains visible even if its present obligation is zero');
eq(EMPTY_PALLET_STATS.defective, 0, 'never-used counterparties start with zero defects');
console.log(`Defective pallet stats regression: ${checks} assertions passed`);
