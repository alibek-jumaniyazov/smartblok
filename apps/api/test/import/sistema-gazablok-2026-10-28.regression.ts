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

/**
 * «Система газаблок.xlsb» (egasining 2026-10-28 fayli, asl nomi «Система газаблок (1).xlsb»).
 *
 * Shablon 2026-10-02 bilan bir xil, ma'lumot esa yangi: 680 yuk, 287 to'lov, 2 yangi agent
 * (УТКИР, ДИЛЬМУРАД), 4 yangi mijoz va «Поддон қайтариш» da uchta OMBOR qatori — «БРАК» −35,
 * «РАЗНИЦА» +52, «БРАК» +39. Import natijasi egasining O'Z hisob varaqlari bilan katakma-katak
 * solishtiriladi: «Мижозлар қолдиғи» (61 mijozning hammasi), «Поставшиклар ҳисоби»,
 * «Акт (умумий)», «KPI», «Поддон қайтариш заводга» qoldiq paneli va «Текширув».
 */
const D = Prisma.Decimal;
let checks = 0;
function equal(actual: unknown, expected: unknown, label: string) {
  checks++; assert.deepEqual(actual, expected, label);
}
function near(actual: Prisma.Decimal.Value | null | undefined, expected: Prisma.Decimal.Value, label: string, tolerance = '0.011') {
  checks++;
  assert.ok(actual !== null && actual !== undefined, `${label}: missing value`);
  const delta = new D(actual!).minus(expected).abs();
  assert.ok(delta.lte(tolerance), `${label}: ${actual}, expected ${expected}, delta ${delta}`);
}
const sum = (values: (Prisma.Decimal.Value | null | undefined)[]) => values.reduce<Prisma.Decimal>((a, b) => a.plus(b ?? 0), new D(0));

async function main() {
  const buffer = readFileSync(join(__dirname, '../../../../docs/Система газаблок.xlsb'));
  equal(createHash('sha256').update(buffer).digest('hex'), '392bdb9a0b989eedf5fba90983408ec145507cd0e46fedd6a65c9bbd9c4a9f2b', 'unchanged owner workbook');
  const p = await parseWorkbook(buffer);
  const reader = await WorkbookReader.fromBuffer(buffer);
  const cell = (sheet: string, row: number, col: number) => reader.cell(reader.worksheet(sheet)!, row, col).v;
  const dict = Dictionary.from(p.master);

  equal(reader.sheetNames().length, 15, 'all source tabs');
  equal(p.shipments.length, 680, 'shipments');
  equal(p.clientPayments.length, 287, 'client payment rows');
  equal(p.factoryPayments.length, 101, 'factory payment rows');
  equal(p.palletReturns.length, 191, '188 client return rows and three warehouse rows');
  equal(p.factoryPalletReturns.length, 24, 'factory return rows');
  equal(p.master.clients.length, 61, 'dictionary clients');
  equal(p.master.agents, ['Арслон ога', 'Жамол 22-22', 'Зафар ога', 'Сардор ога', 'Темур', 'Шохрух ога', 'УТКИР', 'ДИЛЬМУРАД'], 'agents including the two new ones');
  equal(p.master.factories, ['Коалс', 'Ментора'], 'factories');
  near(p.master.settings.palletBasePrice, 130000, 'pallet setting');
  near(p.master.settings.taxPerM3, 10000, 'KPI tax');
  near(p.master.settings.agentKpiShare, new D(1).div(3), 'KPI share', '0.000000000001');
  for (const [client, agent] of [['SHOVOT TEMIR BETON', 'ДИЛЬМУРАД'], ['OBOD MCHJ', 'УТКИР'], ['ПЕНОБЛОКЧИ', 'ДИЛЬМУРАД'], ['Райцентр', 'ДИЛЬМУРАД']]) {
    equal(dict.agentForClient(client), agent, `${client} belongs to ${agent}`);
  }

  // r160: «Поддон дона» bo'sh, 100 qo'shni «Изох» ustuniga yozilgan. Egasining yig'indisi ham
  // uni sanamaydi — import qo'shmaydi, lekin qatorni va undagi sonni nomma-nom ko'rsatadi.
  equal(p.incomplete.map((r) => [r.origin.sheetName, r.origin.excelRow, r.summary, r.missing]),
    [['Поддон қайтариш', 160, 'Кахрамон ога Урганч · 2026-10-09 · Изох: 100', ['paddon soni']]], 'only the misplaced quantity row is incomplete');

  const warehouse = p.palletReturns.filter(isWarehousePalletMovement);
  equal(warehouse.map((r) => [r.origin.excelRow, r.clientRaw, r.qty]), [[144, 'БРАК', -35], [155, 'РАЗНИЦА', 52], [189, 'БРАК', 39]], 'warehouse rows are not customers');

  const findings = runRules({ ...p, dict, cfg: DEFAULT_RULES_CONFIG });
  const rows = (rule: string) => findings.filter((f) => f.ruleId === rule).map((f) => f.origin.excelRow).sort((a, b) => a - b);
  equal(findings.filter((f) => f.severity === 'BLOCK').map((f) => f.message), [], 'no blocking findings');
  equal(rows('JAMI_FARQI'), [], 'every total agrees with «Мижозлар қолдиғи» and «Поставшиклар ҳисоби»');
  equal(rows('FORMULA_FARQI'), [], 'every cached formula agrees with recomputation');
  equal(rows('AGENT_FARQI'), [], 'row agents agree with the dictionary');
  equal(rows('TAKRORIY_YUK'), [304, 641], 'possible duplicate trucks are confirmed by the owner');
  assert.match(findings.find((f) => f.ruleId === 'TAKRORIY_YUK' && f.origin.excelRow === 304)!.message, /transport 2\s400\s000 ≠ 2\s700\s000/); checks++;
  assert.match(findings.find((f) => f.ruleId === 'TAKRORIY_YUK' && f.origin.excelRow === 641)!.message, /№ ЭСФ 612 ≠ 621/); checks++;
  equal(rows('TOLOV_KANALI_FARQI'), [42, 70, 71], 'bank-column money received by «Касса» is disclosed');
  equal(rows('QATOR_TOLIQ_EMAS'), [160], 'misplaced quantity is disclosed');
  assert.match(findings.find((f) => f.ruleId === 'QATOR_TOLIQ_EMAS')!.message, /Изох: 100/); checks++;
  // «Текширув» §1 (ОШИҚЧА ПОДДОН) lists the same eleven customers.
  const overflow = findings.filter((f) => f.ruleId === 'PADDON_ORTIQCHA').map((f) => /^«([^»]+)»/.exec(f.message)![1]).sort();
  const sheetOverflow: string[] = [];
  for (let row = 6; row <= 16; row++) sheetOverflow.push(String(cell('Текширув', row, 1)));
  equal(overflow, sheetOverflow.sort(), 'pallet overflow customers match the workbook check sheet');

  // ── butun daftar yig'indilari ──
  const charge = sum(p.shipments.map((s) => s.clientChargeDeclared));
  const paid = sum(p.clientPayments.map((s) => s.goodsMoneyDeclared));
  near(sum(p.shipments.map((s) => s.cube)), '21175.776', 'volume', '0.000001');
  near(sum(p.shipments.map((s) => s.costSumDeclared)), '12478733874', 'goods factory cost');
  near(sum(p.shipments.map((s) => s.saleSumDeclared)), '15109008619.914259', 'sales');
  near(sum(p.shipments.map((s) => s.transportCost)), '1639796105.198', 'transport');
  near(sum(p.shipments.map((s) => s.profitDeclared)), '990478640.716259', 'profit before tax');
  near(charge, '13900584619.942259', 'client goods charge');
  near(sum(p.clientPayments.map((s) => s.totalDeclared)), '13213117940', 'actual customer cash');
  near(sum(p.clientPayments.map((s) => s.palletMoneyDeclared)), '267280000', 'signed pallet allocations');
  near(paid, '12945837940', 'goods payments');
  near(charge.minus(paid), '954746679.942259', 'client goods debt');
  near(sum(p.factoryPayments.map((s) => s.amount)), '11374787420', 'factory payments');
  for (const [address, expected] of [[[2, 8], '21175.776'], [[2, 10], '12478733874'], [[2, 20], '13900584619.942263']] as const) {
    near(cell('Товар', address[0], address[1]) as number, expected, `«Товар» subtotal ${address.join(',')}`, '0.01');
  }

  // ── poddon (dona) ──
  const sent = sum(p.shipments.map((s) => s.palletQty));
  const clientReturned = sum(p.palletReturns.filter((s) => !isWarehousePalletMovement(s)).map((s) => s.qty));
  const adjustment = sum(warehouse.map((s) => s.qty));
  const palletPaid = sum(p.clientPayments.map((s) => s.palletQty));
  const factoryReturned = sum(p.factoryPalletReturns.map((s) => s.qty));
  near(sent, 12248, 'pallets sent', '0');
  near(clientReturned, 9688, 'client returns exclude warehouse rows', '0');
  near(adjustment, 56, 'signed warehouse adjustments', '0');
  near(palletPaid, 2056, 'signed paid pallets', '0');
  near(factoryReturned, 9452, 'factory returns', '0');
  const outstanding = sent.minus(clientReturned).minus(palletPaid);
  near(outstanding, 504, 'customers still hold', '0');
  near(charge.minus(paid).plus(outstanding.mul(130000)), '1020266679.942259', 'client debt including pallets');
  // «Поддон қайтариш заводга» J4:L6 paneli: kelgan (jadval butunligicha), qaytarilgan, qoldiq.
  near(cell('Поддон қайтариш заводга', 4, 11) as number, clientReturned.plus(adjustment), 'panel: arrived from customers including warehouse rows', '0');
  near(cell('Поддон қайтариш заводга', 5, 11) as number, factoryReturned, 'panel: returned to factories', '0');
  near(cell('Поддон қайтариш заводга', 6, 11) as number, clientReturned.plus(adjustment).minus(factoryReturned), 'panel: physical warehouse stock 292', '0');
  near(clientReturned.plus(adjustment).minus(factoryReturned), 292, 'warehouse stock', '0');

  // ── «Мижозлар қолдиғи»: 61 mijozning har biri, har ustuni ──
  const balances = reader.worksheet('Мижозлар қолдиғи')!;
  const seen = new Set<string>();
  for (let row = 5; row <= 65; row++) {
    const name = String(reader.cell(balances, row, 2).v);
    seen.add(name);
    equal(String(reader.cell(balances, row, 1).v), dict.agentForClient(name), `${name} agent column`);
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
  equal([...seen].sort(), p.master.clients.map((c) => c.officialName).sort(), 'balance sheet lists every dictionary client');
  equal(normalizeEmpty(reader.cell(balances, 66, 2).v), '', 'no client beyond row 65');
  near(p.declared.clientBalances?.goodsDebt, '-954746679.942259', 'unfiltered signed client goods balance');
  equal(p.declared.clientBalances?.origin.excelRow, 76, 'ЖАМИ row');

  // ── zavodlar: «Поставшиклар ҳисоби» (paddon qaytarishisiz) va «Акт (умумий)» (to'liq) ──
  const factoryExpected = [
    { name: 'Коалс', sheetRow: 4, actRow: 13, goods: '810640426', qty: 874, combined: '924260426' },
    { name: 'Ментора', sheetRow: 5, actRow: 14, goods: '273938028', qty: 1922, combined: '523798028' },
  ];
  for (const f of factoryExpected) {
    const shipments = p.shipments.filter((r) => r.factoryRaw === f.name);
    const payments = p.factoryPayments.filter((r) => r.factoryRaw === f.name);
    const returns = p.factoryPalletReturns.filter((r) => r.factoryRaw === f.name);
    near(cell('Поставшиклар ҳисоби', f.sheetRow, 2) as number, sum(shipments.map((s) => s.cube)), `${f.name} cube`, '0.000001');
    near(cell('Поставшиклар ҳисоби', f.sheetRow, 3) as number, sum(shipments.map((s) => s.costSumDeclared)), `${f.name} goods`);
    near(cell('Поставшиклар ҳисоби', f.sheetRow, 4) as number, sum(shipments.map((s) => s.palletQty)), `${f.name} pallets taken`, '0');
    near(cell('Поставшиклар ҳисоби', f.sheetRow, 7) as number, sum(payments.map((s) => s.amount)), `${f.name} paid`);
    const goods = sum(shipments.map((s) => s.costSumDeclared)).minus(sum(payments.map((s) => s.amount))).minus(sum(returns.map((s) => s.totalCostDeclared)));
    const qty = sum(shipments.map((s) => s.palletQty)).minus(sum(returns.map((s) => s.qty)));
    near(goods, f.goods, `${f.name} debt without pallets credits return expenses`);
    near(qty, f.qty, `${f.name} remaining pallets`, '0');
    near(goods.plus(qty.mul(130000)), f.combined, `${f.name} combined debt`);
    near(new D(cell('Акт (умумий)', f.actRow, 18) as number).plus(cell('Акт (умумий)', f.actRow, 19) as number).neg(), f.combined, `${f.name} «Акт (умумий)» full-period balance`);
    near(cell('Акт (умумий)', f.actRow, 20) as number, qty, `${f.name} «Акт (умумий)» pallets to return`, '0');
  }

  // ── har bir moliyaviy qator mustaqil qayta hisoblanadi (keshga ishonilmaydi) ──
  for (const s of p.shipments) {
    const qty = new D(s.cube ?? 0), cost = qty.mul(s.costPrice ?? 0), sales = qty.mul(s.salePrice ?? 0);
    near(cost, s.costSumDeclared!, `cost row ${s.origin.excelRow}`);
    near(sales, s.saleSumDeclared!, `sales row ${s.origin.excelRow}`);
    near(new D(s.palletQty ?? 0).mul(s.palletPrice ?? 0), s.palletSumDeclared!, `pallet value row ${s.origin.excelRow}`);
    near(sales.minus(cost).minus(s.transportCost ?? 0), s.profitDeclared!, `profit row ${s.origin.excelRow}`);
    near(sales.minus(s.transportPayerRaw === 'Клиент' ? s.transportCost ?? 0 : 0), s.clientChargeDeclared!, `charge row ${s.origin.excelRow}`);
    equal(dict.resolveAgent(s.agentRaw), dict.agentForClient(dict.resolveClient(s.clientRaw).canonical!), `shipment agent row ${s.origin.excelRow}`);
  }
  for (const r of p.clientPayments) {
    const cash = sum([r.bank, r.cash, r.click, r.terminal]);
    const pallets = new D(r.palletQty ?? 0).mul(r.palletPrice ?? 0);
    near(cash, r.totalDeclared!, `payment cash row ${r.origin.excelRow}`);
    near(pallets, r.palletMoneyDeclared!, `payment pallet allocation row ${r.origin.excelRow}`);
    near(cash.minus(pallets), r.goodsMoneyDeclared!, `payment goods allocation row ${r.origin.excelRow}`);
  }

  // ── KPI: varaqda faqat 6 agent bor; УТКИР va ДИЛЬМУРАД varaqqa qo'shilmagan ──
  const kpiAgents: string[] = [];
  for (let row = 20; row <= 25; row++) kpiAgents.push(String(cell('KPI', row, 2)));
  equal(kpiAgents, p.master.agents.slice(0, 6), 'KPI sheet still has six fixed agent rows');
  const month = (cell('KPI', 3, 4) as Date).toISOString().slice(0, 7);
  const ownerOf = (s: typeof p.shipments[number]) => dict.agentForClient(dict.resolveClient(s.clientRaw).canonical!) ?? s.agentRaw;
  for (const [index, agent] of kpiAgents.entries()) {
    for (const [records, row] of [[p.shipments.filter((r) => r.date?.toISOString().startsWith(month)), 10 + index], [p.shipments, 20 + index]] as const) {
      const own = records.filter((s) => ownerOf(s) === agent);
      const qty = sum(own.map((s) => s.cube)), gross = sum(own.map((s) => s.profitDeclared));
      const tax = qty.mul(10000), net = gross.minus(tax);
      for (const [col, expected] of [[3, qty], [4, gross], [6, tax], [7, net], [8, net.div(3)], [9, net.mul(2).div(3)]] as const) {
        near(cell('KPI', row, col) as number, expected, `${agent} KPI row ${row}, column ${col}`);
      }
    }
  }
  const newAgentsCube = sum(p.shipments.filter((s) => ['УТКИР', 'ДИЛЬМУРАД'].includes(ownerOf(s))).map((s) => s.cube));
  near(new D(cell('KPI', 26, 3) as number).plus(newAgentsCube), '21175.776', 'KPI sheet total + new agents = all volume', '0.000001');

  console.log(`Система газаблок 2026-10-28 workbook contract: ${checks} checks passed. ${findings.length} review findings.`);
}
const normalizeEmpty = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
main().catch((error) => { console.error(error); process.exitCode = 1; });
