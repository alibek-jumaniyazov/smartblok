import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { D } from '../src/common/money';
import { buildAgentKpiReport, DEFAULT_AGENT_KPI_SETTINGS } from '../src/agents/agent-kpi.calculator';
import { parseWorkbook } from '../src/import/import.service';
import { Book } from '../src/export/xlsx/book';
import { writeTable } from '../src/export/xlsx/sheet-builder';
import { ExportService } from '../src/export/export.service';
import { loadSmartblokData, splitAmount, TEMPLATE_SHEETS, total } from '../src/export/sheets/smartblok-data';
import { createSmartblokSheets, writeSmartblokTables } from '../src/export/sheets/smartblok';
import { writeSmartblokFactoryReports } from '../src/export/sheets/smartblok-factories';
import { writeAgentKpi } from '../src/export/sheets/agent-kpi';
import { isWarehousePalletMovement } from '../src/import/parse/pallet-kind';

async function main() {
  assert.deepEqual(splitAmount(D('1'), [D(1), D(1), D(1)]).map(String), ['0.33', '0.33', '0.34']);
  assert.deepEqual(splitAmount(D('-1'), [D(1), D(1), D(1)]).map(String), ['-0.33', '-0.33', '-0.34']);
  const agent = { id: 'a', name: 'Агент * ?', sortNo: 1 };
  const oldAgent = { id: 'old', name: 'Аввалги агент', sortNo: 2 };
  const client = { id: 'c', name: 'Клиент * ?', agent, aliases: [{ name: 'Вариант' }] };
  const factory = { id: 'f', name: 'Завод', note: null };
  const date = new Date('2026-08-31T21:00:00Z'); // September 1 in Tashkent.
  const item = (id: string) => ({ id, quantityM3: D(1), actualQuantityM3: null, palletCount: 2, actualPalletCount: null,
    palletPrice: D(130000), saleTotal: D(150000), costTotal: D(100000), product: { name: 'Блок', size: '600x300x200' } });
  const order = { id: 'o', orderNo: 'ORD-1', date, factoryPayIntent: 'BANK', client, agent: oldAgent, factory,
    vehicle: { plate: '01 A 123 AA' }, driverName: null, items: [item('1'), item('2'), item('3')],
    transportCost: D(1), saleTotal: D(450000), costTotal: D(300000), transportMode: 'CLIENT_PAYS_DRIVER',
    note: 'ИНН: 123456789 · № ЭСФ: 42 · Статус ЭСФ: Юборилди' };
  const payment = (id: string, kind: string, amount: number, method = 'BANK') => ({ id, date, kind, amount: D(amount), method,
    agent, client, factory: null, payerName: 'Тўловчи', receiverName: null, payerEntity: null, receiverEntity: null,
    usdAmount: D(0), rate: D(0), note: null });
  const pallet = { id: 'p', date, at: date, type: 'CHARGED_LOST', qty: 2, client, factory: null,
    unitPrice: D(120000), note: 'Асл нарх', reversals: [{ qty: 2 }], reversalOfId: null, reversalOfType: null };
  const reversal = { ...pallet, id: 'r', type: 'REVERSAL', qty: 2, date: new Date('2026-09-02T00:00:00Z'),
    unitPrice: null, reversals: [], reversalOfId: 'p', reversalOfType: 'CHARGED_LOST' };
  const remaining = { ...pallet, id: 'keep', date: new Date('2026-09-02T00:00:00Z'), qty: 1, reversals: [] };
  const ret = { ...pallet, id: 'ret', type: 'RETURNED_BY_CLIENT', qty: 1, unitPrice: null, reversals: [] };
  const query = (rows: unknown[]) => ({ findMany: async () => rows });
  const ctx: any = {
    book: new Book('Test'),
    prisma: { order: query([order]), payment: query([payment('in', 'CLIENT_IN', 200000), payment('refund', 'CLIENT_REFUND', 10000), payment('usd', 'CLIENT_IN', 12000, 'USD')]),
      palletTransaction: query([pallet, ret, reversal, remaining]), client: query([client]), agent: query([agent, oldAgent]), factory: query([factory]), expense: query([]), $queryRaw: async () => [] },
    ledger: { clientBalances: async () => new Map([['c', D(379999)]]), factoryBucketsMap: async () => new Map([['f', { net: D(-300000) }]]) },
    pallets: { clientPalletBalances: async () => new Map([['c', 4]]), factoryPalletBalances: async () => new Map([['f', 6]]) },
    settings: { get: async () => 130000 }, periodLabel: 'Бутун давр', window: null,
  };
  const data = await loadSmartblokData(ctx);
  assert.equal(data.goods.length, 3, 'each order item exported once');
  assert.equal(total(data.goods, 18), 1, 'transport allocated once with exact residual');
  assert.equal(total(data.goods, 19), 449999, 'client direct transport subtracted exactly once');
  assert.equal(total(data.goods, 17), 149999, 'export gross profit equals order profit');
  assert.equal((data.goods[0][4] as Date).toISOString(), '2026-09-01T00:00:00.000Z', 'Excel dates use Tashkent business day');
  assert.equal(data.goods[0][20], agent.name, 'assigned KPI agent comes from current client dictionary');
  assert.equal(data.goods[0][2], oldAgent.name, 'historical order agent still preserved');
  assert.equal(data.goods[0][16], 'Клиент', 'source-compatible transport label');
  assert.equal(total(data.clientPayments, 10), 190000, 'refund remains signed; unsupported USD is not relabelled as cash');
  assert.equal(total(data.clientPayments, 14), 120000, 'pallet correction uses original price, not default price');
  assert.equal(total(data.clientPayments, 15), 70000, 'zero-cash pallet charges and credits affect goods funds');
  assert.equal(data.unsupported.length, 1);
  const sameSnapshot = buildAgentKpiReport('2026-09', DEFAULT_AGENT_KPI_SETTINGS, data.agents, data.kpiAggregates);
  assert.equal(sameSnapshot.monthly.totals.profit, String(total(data.goods, 17)), 'KPI aggregate uses the exported order read');
  assert.equal(sameSnapshot.monthly.totals.quantityM3, String(total(data.goods, 7)));
  const report = buildAgentKpiReport('2026-09', DEFAULT_AGENT_KPI_SETTINGS, [agent, oldAgent], [{
    agentId: 'a', date: '2026-09-01', ordersCount: 1, quantityM3: '3', profit: '149999',
  }], null);
  const sheets = createSmartblokSheets(ctx);
  writeSmartblokTables(ctx, data, sheets, report.settings);
  writeSmartblokFactoryReports(ctx, data, sheets, report.month);
  writeAgentKpi(ctx, sheets.get('KPI')!, report, data.goods.length);
  const buffer = await ctx.book.toBuffer();
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buffer);
  assert.deepEqual(wb.worksheets.map((sheet) => sheet.name), [...TEMPLATE_SHEETS]);
  assert.equal(wb.getWorksheet('KPI')!.getCell('H10').result, Number(report.monthly.rows[0].agentKpi), 'KPI cache comes from the shared calculator');
  assert.match(wb.getWorksheet('KPI')!.getCell('C10').formula, /SUBSTITUTE/, 'wildcards in real agent names are treated literally');
  assert.equal(wb.getWorksheet('Товар')!.getCell('R2').result, 149999, 'totals available before Excel recalculation');
  assert.equal(wb.getWorksheet('Поддон қайтариш заводга')!.getCell('K6').result, 1, 'warehouse balance retains the template return reconciliation');
  const errors: string[] = [];
  wb.eachSheet((sheet) => sheet.eachRow((row) => row.eachCell((cell) => {
    if (cell.formula) {
      if (cell.result === undefined) assert.ok(sheet.name === 'KPI' && /^IF\(/.test(cell.formula), `${sheet.name}!${cell.address} formula cache`);
      if (cell.formula.includes('#REF!') || /10485\d\d/.test(cell.formula)) errors.push(cell.address);
    }
  })));
  assert.deepEqual(errors, [], 'no copied broken source references');
  const parsed = await parseWorkbook(buffer);
  assert.equal(parsed.shipments.length, 3);
  assert.equal(parsed.clientPayments.length, 5);
  assert.equal(parsed.master.clients[0].officialName, client.name);
  assert.equal(parsed.master.settings.taxPerM3?.toString(), '10000');
  assert.equal(parsed.shipments[0].taxId, '123456789');
  assert.equal(parsed.shipments[0].invoiceNo, '42');
  assert.equal(parsed.shipments[0].date?.toISOString(), '2026-09-01T00:00:00.000Z');
  assert.equal(parsed.shipments.reduce((a, r) => a.plus(r.transportCost!), D(0)).toString(), '1');
  assert.equal(parsed.clientPayments.reduce((a, r) => a.plus(r.goodsMoneyDeclared!), D(0)).toString(), '70000');

  // Current pallet valuation is independent from historical paid-pallet prices.
  // Native order rows store a zero palletPrice because their financial postings are goods-only.
  const returnDate = new Date('2026-09-03T00:00:00Z');
  const factoryReturn = { id: 'factory-return', date: returnDate, at: returnDate, type: 'RETURNED_TO_FACTORY', qty: 2,
    client: null, clientId: null, factory, factoryId: factory.id, unitPrice: null,
    importBatchId: 'batch', note: 'Excel «Поддон қайтариш заводга» r4', reversals: [], reversalOfId: null, reversalOfType: null };
  const warehouseDamage = { id: 'warehouse', date: returnDate, at: returnDate, type: 'ADJUSTMENT', qty: -52,
    client: null, clientId: null, factory: null, factoryId: null, unitPrice: null,
    importBatchId: 'batch', note: 'Warehouse damage', reversals: [], reversalOfId: null, reversalOfType: null };
  const returnExpense = { id: 'return-expense', date: returnDate, importBatchId: 'batch', note: factoryReturn.note,
    cashbox: { type: 'CASH' }, cashTransactions: [{ direction: 'OUT', amount: D('340.50') }] };
  const valuedCtx = { ...ctx, book: new Book('Current pallet price'), settings: { get: async () => 150000 },
    pallets: { clientPalletBalances: async () => new Map([['c', 4]]), factoryPalletBalances: async () => new Map([['f', 4]]) },
    ledger: { ...ctx.ledger, factoryBucketsMap: async () => new Map([['f', { net: D(-200000) }]]) },
    prisma: { ...ctx.prisma,
      order: query([{ ...order, items: order.items.map((row, index) => index === 0 ? { ...row, palletPrice: D(0) } : row) }]),
      payment: query([payment('in', 'CLIENT_IN', 200000), payment('refund', 'CLIENT_REFUND', 10000),
        { ...payment('factory-pay', 'FACTORY_OUT', 100000), client: null, factory }]),
      palletTransaction: query([pallet, ret, reversal, remaining, factoryReturn, warehouseDamage]),
      expense: query([returnExpense]),
      $queryRaw: async () => [{ factoryId: 'f', amount: D('340.50') }],
    } };
  const valuedData = await loadSmartblokData(valuedCtx);
  assert.equal(valuedData.goods[0][11], 150000, 'native zero stored pallet price uses current valuation');
  assert.equal(valuedData.goods[0][12], 300000, 'native order two pallets gain current deposit valuation');
  assert.equal(total(valuedData.goods, 12), 900000, 'current price revalues every goods pallet');
  assert.equal(total(valuedData.clientPayments, 14), 120000, 'past pallet charges and reversals retain their 120000 price');
  assert.equal(total(valuedData.clientPayments, 15), 70000, 'changing current price leaves paid goods allocation unchanged');
  assert.equal(total(valuedData.factoryReturns, 5), 340.5, 'linked factory return expense is included exactly once');
  assert.deepEqual(valuedData.clientReturns.find((row) => row[1] === 'БРАК')?.slice(1, 3), ['БРАК', -52], 'warehouse damage uses signed isolated source row');
  assert.equal(valuedData.clients.length, 1, 'warehouse damage never becomes a customer dictionary entry');
  const valuedSheets = createSmartblokSheets(valuedCtx);
  writeSmartblokTables(valuedCtx, valuedData, valuedSheets, report.settings);
  writeSmartblokFactoryReports(valuedCtx, valuedData, valuedSheets, report.month);
  const factorySheet = valuedSheets.get('Поставшиклар ҳисоби')!;
  const effective = (address: string) => factorySheet.getCell(address).result ?? factorySheet.getCell(address).value;
  assert.deepEqual(['A4', 'B4', 'C4', 'D4', 'E4', 'F4', 'G4', 'H4'].map(effective),
    ['Завод', 3, 300000, 6, 900000, 1200000, 100000, -1100000], 'factory first A:H remain source-compatible before return credit');
  assert.equal(factorySheet.getCell('H4').formula, 'G4-F4', 'legacy source factory balance formula remains in H');
  assert.equal(effective('J4'), 2, 'factory returned quantity is appended');
  assert.equal(effective('K4'), 340.5, 'factory return credit is transparent');
  assert.equal(effective('L4'), 4, 'only outstanding factory pallets are valued');
  assert.equal(effective('M4'), -199659.5, 'factory source debt without pallets includes payment and return expense once');
  assert.equal(effective('N4'), 150000, 'factory current unit price stays independent from paid pallets');
  assert.equal(effective('O4'), 600000, 'factory outstanding pallet value uses current price');
  assert.equal(effective('P4'), -799659.5, 'factory source debt including pallets follows source negative-debt convention');
  assert.equal(valuedSheets.get('Товар')!.getCell('L4').formula, "'Кўрсаткичлар'!$B$4", 'editing workbook price recalculates order pallet valuation');
  assert.equal(valuedSheets.get('Поддон қайтариш заводга')!.getCell('K6').result, -53, 'warehouse reconciles one client return, minus 52 damage, minus two factory returns');
  const clientSheet = valuedSheets.get('Мижозлар қолдиғи')!;
  assert.equal(clientSheet.getCell('E5').result, -379999, 'warehouse adjustment never changes customer goods balance');
  assert.equal(clientSheet.getCell('J5').result, -4, 'warehouse adjustment never changes customer outstanding pallets');
  assert.equal(clientSheet.getCell('M5').result, -979999, 'client total uses four current-price pallets with historical payments');
  assert.equal(clientSheet.getCell('O5').value, 4, 'appended client quantity uses canonical current pallet balance');
  assert.equal(clientSheet.getCell('Q5').result, -979999, 'actual and source client combined balance agree without extra adjustments');
  assert.equal(factorySheet.getCell('Q4').result, -199659.5, 'actual factory balance shares API return expense credit');
  assert.equal(factorySheet.getCell('T4').result, -799659.5, 'actual and source factory combined balance agree without extra adjustments');
  const valuedParsed = await parseWorkbook(await valuedCtx.book.toBuffer());
  assert.equal(valuedParsed.master.settings.palletBasePrice?.toString(), '150000', 'export reimport preserves current pallet setting');
  assert.equal(valuedParsed.palletReturns.filter(isWarehousePalletMovement).length, 1, 'warehouse damage remains explicitly classified after reimport');
  assert.equal(valuedParsed.palletReturns.filter(isWarehousePalletMovement)[0].qty, -52);

  const adjustedCtx = { ...valuedCtx, book: new Book('Manual balances'),
    ledger: { clientBalances: async () => new Map([['c', D('-125.50')]]),
      factoryBucketsMap: async () => new Map([['f', { net: D('550000.25') }]]) },
    pallets: { clientPalletBalances: async () => new Map([['c', -2]]), factoryPalletBalances: async () => new Map([['f', 3]]) },
  };
  const adjustedData = await loadSmartblokData(adjustedCtx);
  const adjustedSheets = createSmartblokSheets(adjustedCtx);
  writeSmartblokTables(adjustedCtx, adjustedData, adjustedSheets, report.settings);
  const adjustedClients = adjustedSheets.get('Мижозлар қолдиғи')!;
  const adjustedFactories = adjustedSheets.get('Поставшиклар ҳисоби')!;
  assert.equal(adjustedClients.getCell('M5').result, -979999, 'source client A:M remains unchanged by manual system adjustments');
  assert.equal(adjustedClients.getCell('N5').value, 125.5, 'actual client goods advance preserves signed manual ledger adjustment');
  assert.equal(adjustedClients.getCell('O5').value, -2, 'actual client pallets preserve signed manual corrections');
  assert.equal(adjustedClients.getCell('P5').result, -300000, 'actual client pallet correction valued at current price');
  assert.equal(adjustedClients.getCell('Q5').result, 300125.5, 'actual client combined balance includes manual ledger and pallet changes');
  assert.equal(adjustedClients.getCell('Q5').formula, 'N5-P5', 'actual client combined formula stays recalculable');
  assert.equal(adjustedFactories.getCell('P4').result, -799659.5, 'source factory dual balance remains source-compatible');
  assert.equal(adjustedFactories.getCell('Q4').result, 550340.75, 'actual factory balance preserves advance and return credit');
  assert.equal(adjustedFactories.getCell('R4').value, 3, 'actual factory pallets use canonical adjusted balance');
  assert.equal(adjustedFactories.getCell('S4').result, 450000, 'actual factory pallets valued once at current price');
  assert.equal(adjustedFactories.getCell('T4').result, 100340.75, 'actual factory remains in advance after pallet valuation');
  assert.equal(adjustedFactories.getCell('U4').value, 340.5, 'actual factory credited expense is visible');
  assert.equal(adjustedFactories.getCell('T4').formula, 'Q4-S4', 'actual factory combined formula stays recalculable');
  const empty = { ...data, goods: [], clientPayments: [], factoryPayments: [], clientReturns: [], factoryReturns: [], clients: [], agents: [], factories: [] };
  const emptyCtx = { ...ctx, book: new Book('Empty') };
  const emptySheets = createSmartblokSheets(emptyCtx); writeSmartblokTables(emptyCtx, empty, emptySheets, report.settings);
  const emptyParsed = await parseWorkbook(await emptyCtx.book.toBuffer());
  assert.equal(emptyParsed.shipments.length, 0, 'empty source sheets remain valid and importable');
  assert.equal(emptySheets.get('Мижозлар қолдиғи')!.getCell('C5').formula, '0', 'empty totals do not refer to themselves');
  const unassignedCtx = { ...ctx, book: new Book('Unassigned'), prisma: { ...ctx.prisma,
    order: query([{ ...order, agent: null, client: { ...client, agent: null }, date: new Date('2026-08-01T00:00:00Z') }]) } };
  const unassignedData = await loadSmartblokData(unassignedCtx);
  assert.equal(unassignedData.goods[0][20], null, 'unassigned source remains blank instead of creating a synthetic agent');
  const unassignedReport = buildAgentKpiReport('2026-09', DEFAULT_AGENT_KPI_SETTINGS, unassignedData.agents, unassignedData.kpiAggregates);
  const unassignedSheets = createSmartblokSheets(unassignedCtx);
  writeSmartblokTables(unassignedCtx, unassignedData, unassignedSheets, unassignedReport.settings);
  writeAgentKpi(unassignedCtx, unassignedSheets.get('KPI')!, unassignedReport, unassignedData.goods.length);
  assert.match(unassignedSheets.get('KPI')!.getCell('C12').formula, /\$U\$4:\$U\$6,""/, 'unassigned monthly KPI matches blank assignment cells');
  assert.equal(unassignedSheets.get('KPI')!.getCell('H12').result, 0, 'an empty selected month retains the unassigned row for later month changes');
  const unknownCtx = { ...ctx, prisma: { ...ctx.prisma, payment: query([payment('unknown', 'CLIENT_IN', 123, 'UNKNOWN')]) } };
  const unknownData = await loadSmartblokData(unknownCtx);
  assert.equal(total(unknownData.clientPayments, 10), 0, 'unsupported payment cannot create a cache that disappears on recalculation');
  assert.equal(unknownData.unsupported.length, 1);
  const totalsBook = new Book('Totals'); const totalsWs = totalsBook.sheet('ops', { tab: 'Totals', title: 'Totals', desc: '' });
  writeTable(totalsWs, { title: 'Total', columns: [{ header: 'Name', value: (r: any) => r.name, total: 'count' }, { header: 'Amount', value: (r: any) => r.amount, total: 'sum' }], rows: [{ name: 'a', amount: 0.1 }, { name: 'b', amount: 0.2 }] });
  assert.equal(totalsWs.getCell('B7').result, 0.3);
  assert.equal(totalsWs.getCell('A7').result, 2);
  const service = new ExportService(...Array(8).fill(null) as [any, any, any, any, any, any, any, any]);
  await assert.rejects(service.buildWorkbook({ from: '2026-02-31' }, {} as any), /haqiqiy/);
  await assert.rejects(service.buildWorkbook({ from: '2026-09-30', to: '2026-09-01' }, {} as any), /Boshlanish/);
  console.log('Smartblok export regressions passed: source-shaped XLSX round trip, split loads, signed payments, pallet corrections, timezone, KPI, caches, empty sheets and date validation.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
