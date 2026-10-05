/** Financial regressions independent of workbook snapshots or a live database. */
import assert from 'node:assert/strict';
import { Prisma, PaymentMethod } from '@prisma/client';
import { runCommit, reconcileClientFunds, factoryReturnExpense, factoryDefectInputError } from '../../src/import/commit/import-commit.service';
import { runRules } from '../../src/import/rules/validate.service';
import { DEFAULT_RULES_CONFIG } from '../../src/import/rules/config';
import { Dictionary } from '../../src/import/resolve/dictionary';
import type { ParsedWorkbook, ClientPaymentRow, FactoryPalletReturnRow, ShipmentRow } from '../../src/import/parse/types';

const D = Prisma.Decimal;
const date = new Date('2026-09-01T00:00:00Z');
const origin = (sheetName: string, excelRow = 4) => ({ sheetName, excelRow });
const shipment: ShipmentRow = {
  origin: origin('Товар'), factoryPayChannel: 'Перечисления', factoryRaw: 'Коалс',
  agentRaw: 'Agent', clientRaw: 'Client', date, truck: '', size: '600x300x200',
  cube: 1, costPrice: new D(600), costSumDeclared: new D(600),
  palletQty: 10, palletPrice: new D(100), palletSumDeclared: new D(1000), takenSumDeclared: new D(1600),
  salePrice: new D(1500), saleSumDeclared: new D(1500), transportPayerRaw: 'Сотувчи',
  profitDeclared: new D(900), transportCost: new D(0), clientChargeDeclared: new D(1500),
  note: 'Original note', taxId: '123456789', invoiceNo: 'INV-5', invoiceStatus: 'Тасдиқланган',
};
const payment: ClientPaymentRow = {
  origin: origin('Оплата'), date, agentRaw: 'Agent', clientRaw: 'Client',
  bank: new D(2000), cash: null, click: null, terminal: null, totalDeclared: new D(2000),
  payer: 'Payer', palletQty: 10, palletPrice: new D(100), palletMoneyDeclared: new D(1000),
  goodsMoneyDeclared: new D(1000), receiver: '', note: '',
};
const factoryReturn: FactoryPalletReturnRow = {
  origin: origin('Поддон қайтариш заводга'), date, qty: 1, senderRaw: 'Dealer', factoryRaw: 'Коалс',
  unitCost: new D(12), totalCostDeclared: new D(12), note: '', channel: 'Перечисления',
};
const master: ParsedWorkbook['master'] = {
  clients: [{ origin: origin('Кўрсаткичлар'), officialName: 'Client', variants: [], legacyKey: '', agentName: 'Agent' }],
  agents: ['Agent'], factories: ['Коалс'], payTypes: ['Перечисления', 'Касса'],
  settings: { palletBasePrice: new D(100), taxPerM3: null, agentKpiShare: null },
};
const base = (): ParsedWorkbook => ({
  master, shipments: [{ ...shipment }], clientPayments: [{ ...payment }], factoryPayments: [],
  palletReturns: [], factoryPalletReturns: [], declared: { clientBalances: null, factories: [] }, incomplete: [],
});
const findings = (p: ParsedWorkbook) => runRules({ ...p, dict: Dictionary.from(p.master), cfg: DEFAULT_RULES_CONFIG });
const has = (p: ParsedWorkbook, rule: string) => findings(p).some((f) => f.ruleId === rule && f.severity === 'BLOCK');

assert.equal(findings(base()).filter((f) => f.severity === 'BLOCK').length, 0);
for (const invalid of [null, new Date('invalid')]) {
  const p = base(); p.clientPayments[0].date = invalid;
  assert.ok(has(p, 'SANA_NOTOGRI'), 'payment with invalid date is blocked');
}
{ const p = base(); p.shipments[0].factoryRaw = ''; assert.ok(has(p, 'ZAVOD_NOMALUM')); }
for (const bad of [1.25, -1, Infinity]) {
  const p = base(); p.shipments[0].palletQty = bad; assert.ok(has(p, 'SON_NOTOGRI'));
}
{ const p = base(); p.shipments[0].transportCost = new D(-1); assert.ok(has(p, 'SON_NOTOGRI')); }
{ const p = base(); p.shipments[0].cube = 1.2345; assert.ok(has(p, 'SON_NOTOGRI')); }
{ const p = base(); p.shipments[0].cube = 32.83200000000001; assert.equal(has(p, 'SON_NOTOGRI'), false); }
{ const p = base(); p.factoryPalletReturns = [{ ...factoryReturn, channel: 'Unknown' }]; assert.ok(has(p, 'TOLOV_TURI_NOMALUM')); }
{ const p = base(); p.factoryPalletReturns = [{ ...factoryReturn, qty: 500, unitCost: null, totalCostDeclared: new D(0), channel: '' }]; assert.equal(has(p, 'TOLOV_TURI_NOMALUM'), false); }
{ const p = base(); p.clientPayments[0].palletQty = -1; assert.ok(has(p, 'PADDON_TUZATISH')); }
{ const p = base(); p.clientPayments.push({ ...payment, origin: origin('Оплата', 5), palletQty: -3, palletPrice: new D(200) }); assert.ok(has(p, 'PADDON_TUZATISH')); }
{ const p = base(); p.clientPayments.push({ ...payment, origin: origin('Оплата', 5), palletQty: -3 }); assert.equal(has(p, 'PADDON_TUZATISH'), false); }
for (const field of ['palletSumDeclared', 'takenSumDeclared', 'profitDeclared'] as const) {
  const p = base(); p.shipments[0][field] = new D(999999);
  assert.ok(findings(p).some((f) => f.ruleId === 'FORMULA_FARQI'));
}
for (const field of ['palletMoneyDeclared', 'goodsMoneyDeclared'] as const) {
  const p = base(); p.clientPayments[0][field] = new D(999999);
  assert.ok(findings(p).some((f) => f.ruleId === 'FORMULA_FARQI'));
}
assert.equal(factoryReturnExpense({ ...factoryReturn, totalCostDeclared: new D(999999) }).toFixed(2), '12.00');
assert.equal(factoryReturnExpense({ ...factoryReturn, qty: -2 }).toFixed(2), '-24.00');
{
  const p = base();
  const defect = { ...factoryReturn, movementType: 'DEFECTIVE_FROM_FACTORY', unitCost: new D(0), totalCostDeclared: new D(0), note: 'Zavoddan singan holda kelgan', channel: '' };
  p.factoryPalletReturns = [defect];
  assert.equal(findings(p).filter((f) => f.severity === 'BLOCK').length, 0, 'explicit moneyless defect accepted');
  assert.equal(factoryReturnExpense(defect).toFixed(2), '0.00', 'defect has no expense');
  p.factoryPalletReturns = [{ ...defect, movementType: 'BROKEN_UNKNOWN' }];
  assert.ok(has(p, 'SON_NOTOGRI'), 'unknown explicit marker never silently becomes return');
  p.factoryPalletReturns = [{ ...defect, unitCost: new D(1) }];
  assert.ok(has(p, 'SON_NOTOGRI'), 'defect expense rejected');
  p.factoryPalletReturns = [{ ...defect, note: '' }];
  assert.ok(has(p, 'SON_NOTOGRI'), 'defect reason required');
  p.factoryPalletReturns = [{ ...defect, note: 'a'.repeat(1000) }];
  assert.equal(has(p, 'SON_NOTOGRI'), false, '1000-character defect reason accepted');
  p.factoryPalletReturns = [{ ...defect, note: 'a'.repeat(1001) }];
  assert.ok(has(p, 'SON_NOTOGRI'), '1001-character defect reason rejected');
  p.factoryPalletReturns = [{ ...defect, date: new Date(Date.now() + 2 * 86400000) }];
  assert.ok(has(p, 'SON_NOTOGRI'), 'future defect business date rejected');
  p.factoryPalletReturns = [{ ...factoryReturn, date: new Date(Date.now() + 2 * 86400000), note: 'a'.repeat(1001) }];
  assert.equal(has(p, 'SON_NOTOGRI'), false, 'legacy real return rules unchanged');
  const midnightTashkent = new Date('2026-10-04T19:00:00Z');
  assert.equal(factoryDefectInputError({ ...defect, date: new Date('2026-10-05T18:59:59Z') }, midnightTashkent), null, 'same Tashkent business day accepted');
  assert.equal(factoryDefectInputError({ ...defect, date: new Date('2026-10-05T19:00:00Z') }, midnightTashkent)?.field, 'date', 'next Tashkent business day rejected');
  p.factoryPalletReturns = [{ ...factoryReturn, qty: 5 }, { ...defect, qty: -1 }];
  assert.ok(has(p, 'PADDON_TUZATISH'), 'defect correction cannot consume physical return');
  p.factoryPalletReturns = [defect, { ...defect, qty: -1 }];
  assert.equal(has(p, 'PADDON_TUZATISH'), false, 'defect corrects its own movement bucket');
}
{
  const p = base();
  p.declared.clientBalances = {
    origin: origin('Мижозлар қолдиғи'), sales: new D(1500), paid: new D(1000), goodsDebt: new D(-500),
    palletsTaken: 10, palletsReturned: 0, palletsPaidQty: 10, palletsPaidMoney: new D(1000), palletDebtQty: 0,
  };
  assert.equal(findings(p).filter((f) => f.ruleId === 'JAMI_FARQI').length, 0, 'Excel balances use credit-positive signs');
  p.clientPayments[0].palletQty = 5;
  p.declared.clientBalances.paid = new D(1500);
  p.declared.clientBalances.goodsDebt = new D(0);
  p.declared.clientBalances.palletsPaidQty = 5;
  p.declared.clientBalances.palletsPaidMoney = new D(500);
  p.declared.clientBalances.palletDebtQty = -5;
  assert.equal(findings(p).filter((f) => f.ruleId === 'JAMI_FARQI').length, 0, 'Excel pallet debt is negative');
}

const funds = [{ id: 'p', date, seq: 0, amount: new D(1000), capacity: new D(2000) }];
assert.equal(reconcileClientFunds(funds, new D(1300))[0].amount.toFixed(2), '1300.00', 'pallet credit frees reserved cash');
assert.equal(reconcileClientFunds(funds, new D(900))[0].amount.toFixed(2), '900.00', 'refund reduces available cash');
assert.equal(funds[0].amount.toFixed(2), '1000.00', 'reconciliation leaves source records intact');
assert.throws(() => reconcileClientFunds(funds, new D(2001)), /kredit/);

/** Minimal recording transaction: exercises actual commit postings and allocations. */
function recordingDatabase() {
  const rows: Record<string, any[]> = {};
  let next = 0;
  const matches = (r: any, where: any = {}): boolean => Object.entries(where).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v && typeof v === 'object') {
      if ('not' in v) return r[k] !== v.not;
      if ('in' in v) return v.in.includes(r[k]);
      return true;
    }
    return (r[k] ?? null) === v;
  });
  const table = (name: string) => {
    const data = rows[name] ??= [];
    const create = async ({ data: value }: any) => {
      const row = { id: `${name}-${++next}`, ...value };
      if (name === 'order') {
        row.items = value.items.create.map((item: any) => ({ id: `item-${++next}`, ...item }));
        (rows.orderItem ??= []).push(...row.items);
      }
      data.push(row); return row;
    };
    return {
      create,
      upsert: async ({ where, create: value }: any) => data.find((r) => matches(r, where)) ?? create({ data: value }),
      findFirst: async ({ where = {} }: any = {}) => data.find((r) => matches(r, where)) ?? null,
      findUnique: async ({ where = {} }: any = {}) => data.find((r) => matches(r, where)) ?? null,
      aggregate: async ({ where = {}, _sum }: any) => ({ _sum: Object.fromEntries(Object.keys(_sum).map((key) =>
        [key, data.filter((r) => matches(r, where)).reduce((sum, row) => sum + (row[key] ?? 0), 0)])) }),
      findMany: async ({ where = {}, distinct }: any = {}) => {
        const selected = data.filter((r) => matches(r, where));
        return distinct ? selected.filter((r, i) => selected.findIndex((x) => distinct.every((k: string) => x[k] === r[k])) === i) : selected;
      },
      count: async ({ where = {} }: any = {}) => data.filter((r) => matches(r, where)).length,
      update: async ({ where, data: patch }: any) => Object.assign(data.find((r) => matches(r, where)), patch),
      createMany: async ({ data: values }: any) => { for (const value of values) await create({ data: value }); return { count: values.length }; },
      groupBy: async ({ by, where = {}, _sum }: any) => {
        const groups = new Map<string, any>();
        for (const r of data.filter((x) => matches(x, where))) {
          const key = JSON.stringify(by.map((k: string) => r[k]));
          const entry = groups.get(key) ?? { ...Object.fromEntries(by.map((k: string) => [k, r[k]])), _sum: {} };
          for (const k of Object.keys(_sum)) entry._sum[k] = k === 'qty'
            ? (entry._sum[k] ?? 0) + (r[k] ?? 0) : new D(entry._sum[k] ?? 0).plus(r[k] ?? 0);
          groups.set(key, entry);
        }
        return [...groups.values()];
      },
    };
  };
  const tx: any = { $executeRaw: async () => 1, $queryRaw: async () => [] };
  for (const name of ['appSetting', 'importBatch', 'factory', 'agent', 'client', 'product', 'cashbox', 'order', 'orderItem',
    'orderStatusHistory', 'productPrice', 'ledgerEntry', 'payment', 'paymentAllocation', 'cashTransaction',
    'palletTransaction', 'bonusProgram', 'expenseCategory', 'expense']) tx[name] = table(name);
  return { rows, prisma: { $transaction: async (action: any) => action(tx) } as any };
}

async function main() {
  const db = recordingDatabase();
  const result = await runCommit(db.prisma, {
    batchId: 'regression', shipments: [shipment],
    clientPayments: [payment, { ...payment, origin: origin('Оплата', 5), bank: null, totalDeclared: new D(0), palletQty: -3, palletPrice: new D(200) }],
    factoryPayments: [
      { origin: origin('Оплата поставшику'), date: new Date('2026-09-03'), channel: 'Перечисления', amount: new D(400), payer: 'Late', factoryRaw: 'Коалс' },
      { origin: origin('Оплата поставшику', 5), date: new Date('2026-08-01'), channel: 'Перечисления', amount: new D(100), payer: 'Early', factoryRaw: 'Коалс' },
      { origin: origin('Оплата поставшику', 6), date: new Date('2026-09-05'), channel: 'Перечисления', amount: new D(-50), payer: 'Refund', factoryRaw: 'Коалс' },
    ],
    palletReturns: [{ origin: origin('Поддон қайтариш'), date, clientRaw: 'Client', qty: 1, note: '' }],
    factoryPalletReturns: [{ ...factoryReturn, totalCostDeclared: new D(999999) }],
    resolveClient: (name) => name, agentForClient: () => 'Agent', resolveFactory: (name) => name,
    resolveAgent: () => 'Wrong row agent', palletBasePrice: new D(130),
  }, { dryRun: true });
  assert.equal(result.clientPaidPallets, '700.00', 'original charge price controls reversal');
  assert.equal(result.clientPaidGoods, '1300.00');
  assert.equal(result.allocatedToOrders, '1300.00', 'credit-only correction reaches order FIFO');
  assert.equal(result.clientDebtTotal, '200.00');
  assert.equal(result.cashIn, '2050.00', 'pallet credit does not fabricate a cash payment');
  assert.equal(result.cashOut, '512.00', 'return expense ignores stale formula cache');
  assert.equal(result.factorySettled, '450.00', 'refunded advances are excluded from settlement');
  assert.equal(result.factoryAdvanceBank, '0.00');
  assert.equal(result.palletMoneyGap.takenMoney, '1000.00', 'receipt price is preserved instead of multiplying by base price');
  const factoryAllocations = db.rows.paymentAllocation.filter((a) => a.fromAdvance);
  const firstPayment = db.rows.payment.find((p) => p.id === factoryAllocations[0].paymentId);
  assert.match(firstPayment.note, /Early/, 'factory FIFO follows payment date, not worksheet row order');
  assert.equal(firstPayment.method, PaymentMethod.BANK);
  for (const draw of db.rows.ledgerEntry.filter((l) => l.source === 'ADVANCE_DRAW')) {
    const pay = db.rows.payment.find((p) => p.id === draw.paymentId);
    assert.ok(draw.date >= pay.date && draw.date >= date, 'advance is never spent before its receipt or order date');
  }
  assert.match(db.rows.order[0].note, /Original note.*ИНН: 123456789.*№ ЭСФ: INV-5.*Статус ЭСФ/);
  const paymentAgent = db.rows.agent.find((a) => a.id === db.rows.payment.find((p) => p.kind === 'CLIENT_IN').agentId);
  assert.equal(paymentAgent.name, 'Agent', 'dictionary agent controls both order and payment attribution');
  console.log('Financial and validation regressions passed');
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
