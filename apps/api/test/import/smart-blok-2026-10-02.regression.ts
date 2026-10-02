import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma } from '@prisma/client';
import { parseWorkbook } from '../../src/import/import.service';
import { WorkbookReader } from '../../src/import/parse/workbook.reader';
import { Dictionary } from '../../src/import/resolve/dictionary';
import { runRules } from '../../src/import/rules/validate.service';
import { DEFAULT_RULES_CONFIG } from '../../src/import/rules/config';
import { isWarehousePalletMovement } from '../../src/import/parse/pallet-kind';

// The owner's .xlsx-named file contains an XLSB container. Keep its original bytes.
// Independent controls and the settings-price policy: docs/audit/smart-blok-xlsx-2026-10-02.md.
const D = Prisma.Decimal;
let checks = 0;
function equal(actual: unknown, expected: unknown, label: string) {
  checks++; assert.equal(actual, expected, label);
}
function near(actual: Prisma.Decimal.Value | null | undefined, expected: Prisma.Decimal.Value, label: string, tolerance = '0.011') {
  checks++;
  assert.ok(actual !== null && actual !== undefined, `${label}: missing value`);
  const delta = new D(actual!).minus(expected).abs();
  assert.ok(delta.lte(tolerance), `${label}: ${actual}, expected ${expected}, delta ${delta}`);
}
const sum = (values: (Prisma.Decimal.Value | null | undefined)[]) => values.reduce<Prisma.Decimal>((a, b) => a.plus(b ?? 0), new D(0));

async function main() {
  const buffer = readFileSync(join(__dirname, '../../../../docs/Smart blok.xlsx'));
  equal(createHash('sha256').update(buffer).digest('hex'), '2e7a7ab5ec8bc257f1954f84b82aa9ca9a94c539afdac61b9c7a4a3bdf7b6b11', 'unchanged owner workbook');
  const p = await parseWorkbook(buffer);
  const reader = await WorkbookReader.fromBuffer(buffer);
  const dict = Dictionary.from(p.master);
  equal(reader.sheetNames().length, 15, 'all source tabs');
  equal(p.shipments.length, 584, 'shipments');
  equal(p.clientPayments.length, 256, 'payment and pallet allocation rows');
  equal(p.factoryPayments.length, 77, 'factory payment rows');
  equal(p.palletReturns.length, 144, '143 client return rows and one warehouse damage row');
  equal(p.factoryPalletReturns.length, 19, 'factory return rows');
  equal(p.master.clients.length, 58, 'clients');
  equal(p.master.agents.length, 6, 'agents');
  equal(p.master.factories.length, 2, 'factories');
  equal(p.incomplete.length, 0, 'no incomplete source rows');
  const findings = runRules({ ...p, dict, cfg: DEFAULT_RULES_CONFIG });
  const blocks = findings.filter((f) => f.severity === 'BLOCK');
  equal(blocks.length, 5, `source gaps remain visible: ${JSON.stringify(blocks)}`);
  equal(blocks.filter((f) => f.field === 'salePrice').map((f) => f.origin.excelRow).sort().join(','), '543,544,563', 'missing prices are never fabricated from cached zeros');
  equal(blocks.filter((f) => f.field === 'transportPayerRaw').map((f) => f.origin.excelRow).sort().join(','), '543,544', 'warehouse transport responsibility requires explicit resolution');
  near(p.master.settings.palletBasePrice, 130000, 'pallet setting');
  near(p.master.settings.taxPerM3, 10000, 'KPI tax');
  near(p.master.settings.agentKpiShare, new D(1).div(3), 'KPI share', '0.000000000001');

  const volume = sum(p.shipments.map((s) => s.cube));
  const charge = sum(p.shipments.map((s) => s.clientChargeDeclared));
  const paid = sum(p.clientPayments.map((s) => s.goodsMoneyDeclared));
  near(volume, '18164.952', 'volume', '0.000001');
  near(sum(p.shipments.map((s) => s.costSumDeclared)), '10657185354', 'goods factory cost');
  near(sum(p.shipments.map((s) => s.saleSumDeclared)), '12928393579.914259', 'sales');
  near(sum(p.shipments.map((s) => s.transportCost)), '1396996105.199', 'transport');
  near(sum(p.shipments.map((s) => s.profitDeclared)), '874212120.715259', 'profit before tax');
  near(charge, '11859969579.942259', 'client goods charge');
  near(sum(p.clientPayments.map((s) => s.totalDeclared)), '11414736660', 'actual customer cash');
  near(sum(p.clientPayments.map((s) => s.palletMoneyDeclared)), '423020000', 'historical signed pallet allocations');
  near(paid, '10991716660', 'goods payments');
  near(charge.minus(paid), '868252919.942259', 'client debt without pallets');
  const sent = sum(p.shipments.map((s) => s.palletQty));
  const clientReturned = sum(p.palletReturns.filter((s) => !isWarehousePalletMovement(s)).map((s) => s.qty));
  const warehouseAdjustment = sum(p.palletReturns.filter(isWarehousePalletMovement).map((s) => s.qty));
  const palletPaid = sum(p.clientPayments.map((s) => s.palletQty));
  const factoryReturned = sum(p.factoryPalletReturns.map((s) => s.qty));
  near(sent, 10508, 'pallets sent', '0');
  near(clientReturned, 7061, 'client returns exclude warehouse damage', '0');
  near(warehouseAdjustment, -52, 'warehouse damage is not client debt', '0');
  near(palletPaid, 3254, 'signed paid pallets', '0');
  near(factoryReturned, 6892, 'factory returns', '0');
  near(clientReturned.minus(factoryReturned).plus(warehouseAdjustment), 117, 'physical warehouse stock', '0');
  const outstanding = sent.minus(clientReturned).minus(palletPaid);
  near(outstanding, 193, 'client remaining pallets', '0');
  near(charge.minus(paid).plus(outstanding.mul(130000)), '893342919.942259', 'client debt including pallets');

  const balances = reader.worksheet('Мижозлар қолдиғи')!;
  const cell = (sheet: string, row: number, col: number) => reader.cell(reader.worksheet(sheet)!, row, col).v;
  // Check all 58 clients, including negative pallet quantities and positive advances.
  for (let row = 5; row <= 62; row++) {
    const name = String(reader.cell(balances, row, 2).v);
    const shipments = p.shipments.filter((s) => s.clientRaw === name);
    const payments = p.clientPayments.filter((s) => s.clientRaw === name);
    const returned = sum(p.palletReturns.filter((s) => s.clientRaw === name).map((s) => s.qty));
    const sales = sum(shipments.map((s) => s.clientChargeDeclared));
    const goodsPaid = sum(payments.map((s) => s.goodsMoneyDeclared));
    const delivered = sum(shipments.map((s) => s.palletQty));
    const paidQty = sum(payments.map((s) => s.palletQty));
    const signedPalletQty = returned.plus(paidQty).minus(delivered);
    for (const [col, expected] of [[3, sales], [4, goodsPaid], [5, goodsPaid.minus(sales)], [6, delivered], [7, returned], [8, paidQty], [9, sum(payments.map((s) => s.palletMoneyDeclared))], [10, signedPalletQty], [11, new D(130000)], [12, signedPalletQty.mul(130000)], [13, goodsPaid.minus(sales).plus(signedPalletQty.mul(130000))]] as const) {
      near(reader.cell(balances, row, col).v as number, expected, `${name} balance column ${col}`);
    }
  }
  near(p.declared.clientBalances?.goodsDebt, '-868252919.942259', 'unfiltered signed client goods balance');
  equal(p.clientPayments.find((r) => r.origin.excelRow === 226)?.clientRaw, 'Гранд', 'latest source corrects payment owner again');
  equal(p.master.clients.find((r) => r.officialName === 'СКЛАДГА')?.agentName, 'Шохрух ога', 'current warehouse attribution');

  const factoryExpected = [
    { name: 'Коалс', row: 13, goods: '858888426', qty: 874, combined: '972508426' },
    { name: 'Ментора', row: 14, goods: '49689508', qty: 2742, combined: '406149508' },
  ];
  for (const f of factoryExpected) {
    const shipments = p.shipments.filter((r) => r.factoryRaw === f.name);
    const payments = p.factoryPayments.filter((r) => r.factoryRaw === f.name);
    const returns = p.factoryPalletReturns.filter((r) => r.factoryRaw === f.name);
    const goods = sum(shipments.map((s) => s.costSumDeclared)).minus(sum(payments.map((s) => s.amount))).minus(sum(returns.map((s) => s.totalCostDeclared)));
    const qty = sum(shipments.map((s) => s.palletQty)).minus(sum(returns.map((s) => s.qty)));
    near(goods, f.goods, `${f.name} debt excludes pallets and credits return expenses`);
    near(qty, f.qty, `${f.name} remaining pallets`, '0');
    near(goods.plus(qty.mul(130000)), f.combined, `${f.name} combined debt`);
    near(new D(cell('Акт (умумий)', f.row, 18) as number).plus(cell('Акт (умумий)', f.row, 19) as number).neg(), f.combined, `${f.name} authoritative returns-aware reconciliation`);
    near(cell('Акт (умумий)', f.row, 20) as number, qty, `${f.name} source pallet quantity`, '0');
  }

  // Independently verify every financial source row rather than trusting cached totals.
  for (const s of p.shipments) {
    const qty = new D(s.cube ?? 0), cost = qty.mul(s.costPrice ?? 0), sales = qty.mul(s.salePrice ?? 0);
    near(cost, s.costSumDeclared!, `cost row ${s.origin.excelRow}`);
    near(sales, s.saleSumDeclared!, `sales row ${s.origin.excelRow}`);
    near(new D(s.palletQty ?? 0).mul(s.palletPrice ?? 0), s.palletSumDeclared!, `pallet value row ${s.origin.excelRow}`);
    near(sales.minus(cost).minus(s.transportCost ?? 0), s.profitDeclared!, `profit row ${s.origin.excelRow}`);
    near(sales.minus(s.transportPayerRaw === 'Клиент' ? s.transportCost ?? 0 : 0), s.clientChargeDeclared!, `charge row ${s.origin.excelRow}`);
  }
  for (const r of p.clientPayments) {
    const cash = sum([r.bank, r.cash, r.click, r.terminal]);
    const pallets = new D(r.palletQty ?? 0).mul(r.palletPrice ?? 0);
    near(cash, r.totalDeclared!, `payment cash row ${r.origin.excelRow}`);
    near(pallets, r.palletMoneyDeclared!, `payment pallet allocation row ${r.origin.excelRow}`);
    near(cash.minus(pallets), r.goodsMoneyDeclared!, `payment goods allocation row ${r.origin.excelRow}`);
  }

  const month = (cell('KPI', 3, 4) as Date).toISOString().slice(0, 7);
  for (const [index, agent] of p.master.agents.entries()) {
    for (const [records, row] of [[p.shipments.filter((r) => r.date?.toISOString().startsWith(month)), 10 + index], [p.shipments, 20 + index]] as const) {
      const own = records.filter((s) => (p.master.clients.find((c) => c.officialName === s.clientRaw)?.agentName || s.agentRaw) === agent);
      const qty = sum(own.map((s) => s.cube)), gross = sum(own.map((s) => s.profitDeclared));
      const tax = qty.mul(10000), net = gross.minus(tax);
      for (const [col, expected] of [[3, qty], [4, gross], [6, tax], [7, net], [8, net.div(3)], [9, net.mul(2).div(3)]] as const) {
        near(cell('KPI', row, col) as number, expected, `${agent} KPI row ${row}, column ${col}`);
      }
    }
  }
  console.log(`Smart blok 2026-10-02 workbook contract: ${checks} checks passed. ${findings.length} review findings.`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
