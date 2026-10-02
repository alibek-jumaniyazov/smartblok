import assert from 'node:assert/strict';
import { dualDebt, effectivePalletPrice, summarizeDualDebts } from '../src/common/pallet-debt';

let checks = 0;
function eq(actual: unknown, expected: unknown, note: string) { assert.equal(String(actual), String(expected), note); checks++; }
for (const value of [null, undefined, 0, '0', '', 'garbage', Infinity, '-10', { amount: null }]) {
  eq(effectivePalletPrice(value), '130000', 'invalid/legacy price falls back');
}
eq(effectivePalletPrice({ amount: '155000.25', _importBatchId: 'import' }), '155000.25', 'import provenance does not leak into price');
eq(effectivePalletPrice('0.50'), '0.5', 'fractional positive price supported');
const client = dualDebt('760000', 5, '130000');
eq(client.debtWithPallets, '1410000', 'paid pallets already in base are not charged a second time');
eq(dualDebt('760000', 5, '150000').debtWithPallets, '1510000', 'price changes only outstanding five pallets');
eq(dualDebt('-2000000', 5, '130000').debtWithPallets, '-1350000', 'advance survives pallet valuation');
eq(dualDebt('100000', -2, '130000').debtWithPallets, '-160000', 'signed over-return is not clamped');
eq(dualDebt('100.01', 3, '130000.25').debtWithPallets, '390100.76', 'tiyin precision preserved');
const factory = dualDebt('170000', 7, '130000');
eq(factory.debtWithPallets, '1080000', 'factory base after expensecredit plus outstanding pallets');
const summary = summarizeDualDebts([client, dualDebt('-2000000', 5, '130000'), dualDebt('100000', -2, '130000')]);
eq(summary.netWithoutPallets, '-1140000', 'summary nets advances against base');
eq(summary.netWithPallets, '-100000', 'summary combined signed net');
eq(summary.palletDebtQuantity, '8', 'summary retains signed quantities');
eq(summary.debtWithPalletsTotal, '1410000', 'debtors separated from advances');
eq(summary.advanceWithPalletsTotal, '1510000', 'combined advances sum independently');
eq(summarizeDualDebts([]).netWithPallets, '0', 'empty summary stable');
console.log(`Dual debt regression: ${checks} assertions passed`);
