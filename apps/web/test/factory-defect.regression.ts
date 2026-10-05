import assert from 'node:assert/strict';
import {
  palletCancelAllowed, palletCancelFacts, palletCancelKind, palletCancelSuccess,
} from '../src/components/PalletCancel';
import { can } from '../src/lib/permissions';
import type { TFn } from '../src/lib/i18n';

const t: TFn = (key, values) => key.replace(/\{(\w+)\}/g, (_, name: string) => String(values?.[name] ?? `{${name}}`));
const kind = palletCancelKind('DEFECTIVE_FROM_FACTORY');
assert.equal(kind, 'FACTORY_DEFECT');
assert.equal(palletCancelKind('RETURNED_TO_FACTORY'), null);
assert.equal(palletCancelAllowed(kind!, { canReverseReturn: true, canReverseCharge: true }), false);
assert.equal(palletCancelAllowed(kind!, { canReverseReturn: false, canReverseCharge: false, canReverseFactoryDefect: true }), true);
for (const role of ['ADMIN', 'ACCOUNTANT', 'AGENT', 'CASHIER'] as const) {
  assert.equal(can(role, 'pallets.factoryDefect'), role === 'ADMIN' || role === 'ACCOUNTANT');
}
const facts = palletCancelFacts({ kind: kind!, t, factoryName: 'Test zavod', clientName: 'Mijoz emas', qty: 3 });
assert.match(facts[0].text, /Test zavod.*3/);
assert.match(facts[1].text, /yaroqli.*3/);
assert.match(facts[2].text, /mijoz hisobi o'zgarmaydi/);
assert.equal(facts.some((fact) => fact.text.includes('Mijoz emas')), false);
assert.match(palletCancelSuccess(kind!, t, { factoryPalletBalance: 8, clientPalletBalance: 999 }), /8 dona/);
assert.doesNotMatch(palletCancelSuccess(kind!, t, undefined), /mijoz/);
console.log('Factory defect presentation: 14 checks passed');
