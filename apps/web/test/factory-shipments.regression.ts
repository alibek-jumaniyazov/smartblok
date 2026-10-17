import assert from 'node:assert/strict';
import { canCancelShipment, formatAcceptanceValue, inspectionPreview, SHIPMENT_STATUS } from '../src/lib/pallet-shipments';
import { can } from '../src/lib/permissions';
import { makeT } from '../src/lib/i18n';
import type { FactoryPalletShipment } from '../src/lib/types';

let checks = 0;
function equal(actual: unknown, expected: unknown) { assert.deepEqual(actual, expected); checks++; }

// Different condition prices and partial inspection preserve exact tiyin.
const split = inspectionPreview([{ qty: 8, unitPrice: '100000.10' }, { qty: 3, unitPrice: '80000.20' }], 2, 20);
equal(split, { acceptedQty: 11, rejectedQty: 2, totalQty: 13, remainingQty: 7, amount: '1040001.40', valid: true });
equal(inspectionPreview([{ qty: 3, unitPrice: '0.10' }], 0, 3).amount, '0.30');
equal(inspectionPreview([{ qty: 10000, unitPrice: '999999999999.99' }], 0, 10000).amount, '9999999999999900.00');
equal(inspectionPreview([{ qty: 10001, unitPrice: '999999999999.99' }], 0, 10001).valid, false);
equal(inspectionPreview([{ qty: 2, unitPrice: '0' }], 0, 2).valid, true);
equal(inspectionPreview([], 4, 4).valid, true); // reject-only batch
equal(inspectionPreview([], 0, 4).valid, false);
equal(inspectionPreview([{ qty: 4, unitPrice: '1' }], 1, 4).valid, false);
equal(inspectionPreview([{ qty: 0, unitPrice: '1' }], 1, 4).valid, false);
equal(inspectionPreview([{ qty: 1.5, unitPrice: '1' }], 0, 4).valid, false);
equal(inspectionPreview([{ qty: 1, unitPrice: '-1' }], 0, 4).valid, false);
equal(inspectionPreview([{ qty: 1, unitPrice: '' }], 0, 4).valid, false);
equal(inspectionPreview([{ qty: 1, unitPrice: 'NaN' }], 0, 4).valid, false);
equal(inspectionPreview([{ qty: 1, unitPrice: '1.001' }], 0, 4).valid, false);
equal(inspectionPreview([{ qty: 1, unitPrice: '1' }], -1, 4).valid, false);
equal(inspectionPreview([{ qty: 1, unitPrice: '1' }], 0.5, 4).valid, false);
equal(formatAcceptanceValue('1000000.10'), '1 000 000.10');
equal(formatAcceptanceValue('0.3'), '0.30');
equal(formatAcceptanceValue('0.00'), '0');
equal(formatAcceptanceValue('9999999999999990.00'), '9 999 999 999 999 990');

const base = { status: 'IN_TRANSIT', arrivedAt: null, acceptedQty: 0, rejectedQty: 0, returnedQty: 0 } as FactoryPalletShipment;
equal(canCancelShipment(base), true);
for (const status of ['INSPECTING', 'AWAITING_RETURN', 'COMPLETED', 'CANCELLED'] as const) equal(canCancelShipment({ ...base, status }), false);
equal(canCancelShipment({ ...base, arrivedAt: '2026-10-17T00:00:00Z' }), false);
equal(canCancelShipment({ ...base, acceptedQty: 1 }), false);
equal(canCancelShipment({ ...base, rejectedQty: 1 }), false);
equal(canCancelShipment({ ...base, returnedQty: 1 }), false);
for (const role of ['ADMIN', 'ACCOUNTANT', 'AGENT', 'CASHIER'] as const) equal(can(role, 'pallets.factoryShipments'), role === 'ADMIN' || role === 'ACCOUNTANT');
const english = makeT('en');
for (const status of Object.values(SHIPMENT_STATUS)) { assert.notEqual(english(status.label), status.label); checks++; }
equal(english('Zavod qabul qilgan'), 'Accepted by factory');
console.log(`Factory shipment presentation: ${checks} checks passed`);
