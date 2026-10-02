import assert from 'node:assert/strict';
import { kpiPercentToShare, kpiShareToPercent } from '../src/lib/agent-kpi';

const cases = [
  ['0', '0'], ['1', '100'], ['0.333', '33.3'],
  ['0.33333333333333333333', '33.333333333333333333'],
  ['0.00000000000000000001', '0.000000000000000001'],
  ['0.29', '29'], ['0.07', '7'], ['0.99999999999999999999', '99.999999999999999999'],
] as const;
for (const [share, percent] of cases) {
  assert.equal(kpiShareToPercent(share), percent);
  assert.equal(kpiPercentToShare(percent), share);
  assert.equal(kpiPercentToShare(kpiShareToPercent(share)), share);
}
assert.equal(kpiPercentToShare('0033.3000'), '0.333');
assert.equal(kpiPercentToShare('100.00'), '1');
for (const invalid of ['', '-1', 'NaN', 'Infinity', '1e2', '1,5']) {
  assert.throws(() => kpiPercentToShare(invalid));
}
console.log('Agent KPI percentage: 32 exact-decimal checks passed');
