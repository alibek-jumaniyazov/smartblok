import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma } from '@prisma/client';
import { parseWorkbook } from '../../src/import/import.service';
import { WorkbookReader } from '../../src/import/parse/workbook.reader';
import { Dictionary } from '../../src/import/resolve/dictionary';
import { runRules } from '../../src/import/rules/validate.service';
import { DEFAULT_RULES_CONFIG } from '../../src/import/rules/config';

// Independent controls from a complete pyxlsb extraction and Decimal arithmetic:
// docs/audit/smartblok-2026-09-29.md. Never substitute the legacy fixture here.
const D = Prisma.Decimal;
let checks = 0;
function equal(actual: unknown, expected: unknown, label: string) {
  checks++;
  assert.equal(actual, expected, label);
}
function near(actual: Prisma.Decimal.Value | null | undefined, expected: Prisma.Decimal.Value, label: string, tolerance = '0.011') {
  checks++;
  assert.ok(actual !== null && actual !== undefined, `${label}: missing value`);
  const delta = new D(actual!).minus(expected).abs();
  assert.ok(delta.lte(tolerance), `${label}: ${actual}, expected ${expected}, delta ${delta}`);
}
const sum = (values: (Prisma.Decimal.Value | null | undefined)[]) => values.reduce<Prisma.Decimal>((a, b) => a.plus(b ?? 0), new D(0));

async function main() {
  const buffer = readFileSync(join(__dirname, '../../../../docs/Smartblok.xlsb'));
  const p = await parseWorkbook(buffer);
  const reader = await WorkbookReader.fromBuffer(buffer);
  const dict = Dictionary.from(p.master);
  equal(reader.sheetNames().length, 15, 'all reference sheets are readable');
  equal(p.shipments.length, 548, 'shipment rows, including new September records');
  equal(p.clientPayments.length, 248, 'all payment and pallet adjustment rows');
  equal(p.factoryPayments.length, 70, 'factory payments');
  equal(p.palletReturns.length, 134, 'signed client returns');
  equal(p.factoryPalletReturns.length, 17, 'completed factory returns');
  equal(p.master.clients.length, 57, 'expanded client dictionary');
  equal(p.master.agents.length, 6, 'agents');
  equal(p.incomplete.length, 0, 'previous incomplete return is now complete');
  equal(runRules({ ...p, dict, cfg: DEFAULT_RULES_CONFIG }).filter((f) => f.severity === 'BLOCK').length, 0, 'valid current workbook has no blocking findings');
  near(p.master.settings.taxPerM3, 10000, 'tax per m3');
  near(p.master.settings.agentKpiShare, new D(1).div(3), 'agent share', '0.000000000001');
  near(p.master.settings.palletBasePrice, 130000, 'pallet price');
  equal(dict.resolveClient('Шовот').canonical, 'Шовот', 'new payment owner');
  equal(dict.resolveClient('Склад').canonical, 'Склад', 'new shipment client');

  near(sum(p.shipments.map((s) => s.cube)), 16983, 'total volume', '0.000001');
  near(sum(p.shipments.map((s) => s.costSumDeclared)), 9942104394, 'factory goods cost');
  near(sum(p.shipments.map((s) => s.saleSumDeclared)), '12105787819.914259', 'sales');
  near(sum(p.shipments.map((s) => s.transportCost)), '1290596105.198', 'transport');
  near(sum(p.shipments.map((s) => s.profitDeclared)), '873087320.7162592', 'profit after transport, before tax');
  near(sum(p.shipments.map((s) => s.clientChargeDeclared)), '11115763819.943259', 'client charges');
  near(sum(p.clientPayments.map((s) => s.totalDeclared)), 10963498340, 'cash receipts include hidden rows');
  near(sum(p.clientPayments.map((s) => s.palletMoneyDeclared)), 386750000, 'signed pallet payment money');
  near(sum(p.clientPayments.map((s) => s.goodsMoneyDeclared)), 10576748340, 'goods receipts');
  near(sum(p.factoryPayments.map((s) => s.amount)), 8674239420, 'factory payments');

  const sent = sum(p.shipments.map((s) => s.palletQty));
  const returned = sum(p.palletReturns.map((s) => s.qty));
  const paid = sum(p.clientPayments.map((s) => s.palletQty));
  const toFactory = sum(p.factoryPalletReturns.map((s) => s.qty));
  near(sent, 9824, 'pallets delivered', '0');
  near(returned, 6499, 'pallets returned by clients', '0');
  near(paid, 2975, 'pallets paid, signed', '0');
  near(toFactory, 5892, 'pallets returned to factories', '0');
  near(sent.minus(returned).minus(paid), 350, 'client pallet debt', '0');
  near(returned.minus(toFactory), 607, 'warehouse stock', '0');
  near(sent.minus(toFactory), 3932, 'factory pallet debt', '0');
  near(p.declared.clientBalances?.sales, '11115763819.943259', 'unfiltered report charges');
  near(p.declared.clientBalances?.paid, 10576748340, 'unfiltered report payments');
  near(p.declared.clientBalances?.goodsDebt, '-539015479.943259', 'report signed goods balance');
  equal(p.declared.clientBalances?.palletsTaken, 9824, 'report does not use filtered subtotal');

  const corrected = p.clientPayments.find((r) => r.origin.excelRow === 226)!;
  equal(corrected.clientRaw, 'Шовот', 'payment owner follows explicit new source, not a previous guess');
  equal(corrected.agentRaw, 'Шохрух ога', 'corrected payment agent');
  near(corrected.bank, 163350000, 'corrected payment retained');
  for (let row = 473; row <= 481; row++) {
    near(p.shipments.find((r) => r.origin.excelRow === row)?.costPrice, 605000, `historical cost correction at row ${row}`);
  }
  for (const row of [244, 246, 247]) {
    const payment = p.clientPayments.find((r) => r.origin.excelRow === row)!;
    equal(payment.palletQty, 19, `zero-cash pallet charge row ${row}`);
    near(payment.totalDeclared, 0, `no invented cash for pallet charge ${row}`, '0');
    near(payment.goodsMoneyDeclared, -2470000, `goods advance reserved for pallet charge ${row}`, '0');
  }
  for (const [row, qty] of [[190, -71], [238, -9], [245, -88]]) {
    equal(p.clientPayments.find((r) => r.origin.excelRow === row)?.palletQty, qty, `signed pallet reversal ${row}`);
  }
  // Both rows exist in the owner's source; matching values do not authorize deletion.
  equal(p.clientPayments.filter((r) => r.origin.excelRow === 246 || r.origin.excelRow === 247).length, 2, 'repeated-looking source rows are retained');
  equal(p.factoryPalletReturns.find((r) => r.origin.excelRow === 18)?.qty, 500, 'completed return uses actual quantity column B');
  equal(p.shipments.filter((r) => r.sourceNotes).length, 10, 'all source cell notes');
  equal(p.shipments.filter((r) => r.invoiceNo).length, 42, 'expanded invoice metadata');
  equal(p.shipments.filter((r) => r.note).length, 26, 'shipment row notes');
  equal(p.shipments.find((r) => r.origin.excelRow === 468)?.factoryPayChannel, 'Перечисления', 'historical factory channel correction');

  const kpi = reader.worksheet('KPI')!;
  const cell = (row: number, col: number) => reader.cell(kpi, row, col).v as number;
  const controls: Record<string, [number, string]> = {
    'Арслон ога': [263.304, '14451738'],
    'Жамол 22-22': [0, '0'],
    'Зафар ога': [1740.096, '72581376'],
    'Сардор ога': [1149.120, '47059984'],
    'Темур': [886.464, '40247712.001'],
    'Шохрух ога': [590.976, '20633312.000192'],
  };
  const september = p.shipments.filter((r) => r.date?.toISOString().startsWith('2026-09'));
  const allByAgent: Prisma.Decimal[] = [];
  for (const [index, agent] of p.master.agents.entries()) {
    for (const [records, targetRow] of [[september, 10 + index], [p.shipments, 20 + index]] as const) {
      const own = records.filter((s) => (p.master.clients.find((c) => c.officialName === s.clientRaw)?.agentName || s.agentRaw) === agent);
      const qty = sum(own.map((s) => s.cube));
      const profit = sum(own.map((s) => new D(s.cube ?? 0).mul(s.salePrice ?? 0).minus(new D(s.cube ?? 0).mul(s.costPrice ?? 0)).minus(s.transportCost ?? 0)));
      const tax = qty.mul(10000), net = profit.minus(tax);
      near(qty, cell(targetRow, 3), `${agent} quantity agrees with KPI row ${targetRow}`, '0.000001');
      near(profit, cell(targetRow, 4), `${agent} source-based profit agrees with KPI row ${targetRow}`);
      near(tax, cell(targetRow, 6), `${agent} tax`);
      near(net, cell(targetRow, 7), `${agent} net`);
      near(net.div(3), cell(targetRow, 8), `${agent} KPI share`);
      near(net.mul(2).div(3), cell(targetRow, 9), `${agent} firm share`);
      if (targetRow < 20) {
        near(qty, controls[agent][0], `${agent} independent September volume`, '0.000001');
        near(profit, controls[agent][1], `${agent} independent September profit`);
      } else allByAgent.push(profit);
    }
  }
  near(sum(allByAgent), '873087320.7162592', 'all-agent independent total');
  near(cell(16, 3), 4629.96, 'September KPI total volume', '0.000001');
  near(cell(16, 8), '49558174.000397333', 'September total agent share');
  near(cell(26, 8), '234419106.905419733', 'lifetime total agent share');
  for (let day = 1; day <= 30; day++) {
    const dayRows = september.filter((s) => s.date?.getUTCDate() === day);
    const qty = sum(dayRows.map((s) => s.cube));
    const gross = sum(dayRows.map((s) => s.profitDeclared));
    near(qty, cell(30 + day, 2), `daily ${day} volume`, '0.000001');
    near(gross, cell(30 + day, 3), `daily ${day} gross`);
    near(gross.minus(qty.mul(10000)).div(3), cell(30 + day, 6), `daily ${day} agent share`);
  }
  // Every shipment's derived columns are independently recalculated, not just totals.
  for (const s of p.shipments) {
    const qty = new D(s.cube ?? 0), cost = qty.mul(s.costPrice ?? 0), sales = qty.mul(s.salePrice ?? 0);
    near(cost, s.costSumDeclared!, `cost row ${s.origin.excelRow}`);
    near(sales, s.saleSumDeclared!, `sales row ${s.origin.excelRow}`);
    near(sales.minus(cost).minus(s.transportCost ?? 0), s.profitDeclared!, `profit row ${s.origin.excelRow}`);
    near(sales.minus(s.transportPayerRaw === 'Клиент' ? s.transportCost ?? 0 : 0), s.clientChargeDeclared!, `charge row ${s.origin.excelRow}`);
  }
  console.log(`Smartblok 2026-09-29 workbook contract: ${checks} checks passed.`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
