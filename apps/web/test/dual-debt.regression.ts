import assert from 'node:assert/strict';
import { sumMoney } from '../src/lib/sum-money';
import { debtTagBalance } from '../src/components/DualDebt';

// Fully loaded factory lists must aggregate their filtered money columns without float residue.
assert.equal(sumMoney(['0.1', '0.2']), '0.3');
assert.equal(sumMoney(['10000000000000000.01', '-10000000000000000', '0.09']), '0.10');
assert.equal(sumMoney(['539015479.94', '45500000.00']), '584515479.94');
assert.equal(sumMoney(['10.123456', '-11.12', '0.000004']), '-0.996540');
assert.equal(sumMoney([undefined, null]), '0');
assert.equal(sumMoney([]), '0');
assert.equal(sumMoney(['-0.00', '0']), '0.00');
assert.throws(() => sumMoney(['not-money']), /Invalid money/);

// Positive debt has the same API meaning on both sides, but the established factory chip has the opposite sign.
assert.equal(debtTagBalance('123456789012345678.99', 'factory'), '-123456789012345678.99');
assert.equal(debtTagBalance('-120000.25', 'factory'), '120000.25');
assert.equal(debtTagBalance('-120000.25', 'client'), '-120000.25');
assert.equal(debtTagBalance('250000', 'client'), '250000');
console.log('Dual debt presentation: 12 checks passed');
