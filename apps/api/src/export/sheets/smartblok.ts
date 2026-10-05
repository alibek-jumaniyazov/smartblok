import { type CellValue, type Worksheet } from 'exceljs';
import { D, ZERO } from '../../common/money';
import { COLOR, FONT, NUMFMT, THIN_BORDER } from '../xlsx/theme';
import { colLetter } from '../xlsx/sheet-builder';
import type { Ctx } from './ctx';
import { TEMPLATE_SHEETS, total, n, type Plain, type SmartblokData } from './smartblok-data';

export const GOODS_HEADERS = ['Тўлов тури', 'Поставшик', 'Агент', 'Клиент', 'Дата', '№ авто', 'Размер', 'Блок\nКуб', 'Цена\nПриход', 'Сумма\nПриход', 'Поддон\nШт', 'Цена\nПоддон', 'Сумма Поддон', 'Блок+\nПоддон', 'Цена\nПродажа', 'Сумма\nПродажа', 'Расход\nАвто', 'Общая прибль', 'Авто услу', 'Мижозга', 'Агент (бириктирилган)', 'Агент текшируви', 'Рухсат этилган агент', 'ПРИМЕЧАНИЕ', 'ИНН', '№ ЭСФ', 'СТАТУС ЭСФ'];
export const PAYMENT_HEADERS = ['Дата', 'Агент', 'Клиент', 'ПР-Сумма', 'Плателщик', 'Поддон', 'Учун', 'Накд', 'Клик', 'Терминал', 'Жами сумма', 'Получател', 'Изох', 'Поддон нархи', 'Поддон пули', 'Товарга', 'Агент (бириктирилган)', 'Агент текшируви', 'Рухсат этилган агент', 'Тўлов усули', 'USD миқдори', 'Курс', 'Тизим ID'];

const fill = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } });
const f = (formula: string, result: number | string | Date): CellValue => ({ formula, result });
const sum = (rows: Plain[][], index: number, name?: string, nameIndex?: number): number => total(name === undefined ? rows : rows.filter((r) => r[nameIndex!] === name), index);
const ref = (name: string, column: string, start: number, rows: number) => `'${name}'!$${column}$${start}:$${column}$${Math.max(start, start + rows - 1)}`;
const safeCriteria = (cell: string) => `SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(${cell},"~","~~"),"*","~*"),"?","~?")`;
const sumif = (sheet: string, rows: number, start: number, value: string, names: string, criteria: string) =>
  `SUMIF(${ref(sheet, names, start, rows)},${safeCriteria(criteria)},${ref(sheet, value, start, rows)})`;
const factoryMovementSumif = (rows: number, value: string, criteria: string, type: string) =>
  `SUMIFS(${ref('Поддон қайтариш заводга', value, 4, rows)},${ref('Поддон қайтариш заводга', 'D', 4, rows)},${safeCriteria(criteria)},${ref('Поддон қайтариш заводга', 'I', 4, rows)},"${type}")`;

export function header(ws: Worksheet, row: number, labels: string[]): void {
  labels.forEach((label, i) => {
    const cell = ws.getRow(row).getCell(i + 1);
    cell.value = label; cell.font = FONT.header; cell.fill = fill(COLOR.ink);
    cell.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
    cell.border = THIN_BORDER;
  });
  ws.getRow(row).height = labels.some((label) => label.length > 32) ? 56 : 38;
}
export function blockTitle(ws: Worksheet, row: number, value: string, width: number): void {
  ws.mergeCells(row, 1, row, width);
  const cell = ws.getRow(row).getCell(1);
  cell.value = value; cell.font = FONT.title; cell.fill = fill(COLOR.brand);
  cell.alignment = { vertical: 'middle', wrapText: true };
  ws.getRow(row).height = 30;
}
function decorate(ws: Worksheet, row: number, column: number, value: CellValue): void {
  const cell = ws.getRow(row).getCell(column);
  cell.value = value;
  cell.font = FONT.body; cell.border = THIN_BORDER;
  cell.alignment = { vertical: 'middle', wrapText: column === 24 || column === 13 };
  if (row % 2 === 0) cell.fill = fill(COLOR.band);
  cell.numFmt = value instanceof Date ? NUMFMT.date : typeof value === 'number' || (value && typeof value === 'object' && 'formula' in value) ? NUMFMT.money : NUMFMT.text;
}
function table(ctx: Ctx, ws: Worksheet, labels: string[], start: number, rows: Plain[][], calculated: Record<number, (r: number, values: Plain[]) => CellValue> = {}, totals: number[] = []): void {
  header(ws, start, labels);
  rows.forEach((row, index) => row.forEach((value, column) => decorate(ws, start + index + 1, column + 1, calculated[column]?.(start + index + 1, row) ?? value)));
  if (start > 2 && rows.length && totals.length) {
    ws.getRow(start - 1).getCell(1).value = 'ЖАМИ';
    for (const index of totals) {
      const column = colLetter(index + 1);
      const cell = ws.getRow(start - 1).getCell(index + 1);
      cell.value = f(`SUBTOTAL(109,${column}${start + 1}:${column}${start + rows.length})`, total(rows, index));
      cell.numFmt = NUMFMT.money; cell.font = FONT.total;
    }
  }
  ws.views = [{ state: 'frozen', ySplit: start, xSplit: 2 }];
  if (rows.length) ws.autoFilter = { from: { row: start, column: 1 }, to: { row: start + rows.length, column: labels.length } };
  ctx.book.count(ws, rows.length);
}

/** All source-compatible tabs are created in the reference workbook's exact order. */
export function createSmartblokSheets(ctx: Ctx): Map<string, Worksheet> {
  const sheets = new Map<string, Worksheet>();
  for (const name of TEMPLATE_SHEETS) {
    const ws = ctx.book.sheet(name === 'KPI' ? 'kpi' : 'ops', { tab: name, title: name, desc: 'Smartblok.xlsb шаклидаги маълумотлар ва ҳисобот', exactName: true });
    for (let column = 1; column <= 27; column++) ws.getColumn(column).width = column === 2 || column === 3 || column === 4 ? 25 : 20;
    ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
    ws.properties.defaultRowHeight = 20;
    sheets.set(name, ws);
  }
  return sheets;
}

export function writeSmartblokTables(ctx: Ctx, data: SmartblokData, sheets: Map<string, Worksheet>, settings: { taxPerM3: string; agentShare: string; companyShare: string }): void {
  const ws = (name: string) => sheets.get(name)!;
  const goods = ws('Товар');
  table(ctx, goods, GOODS_HEADERS, 3, data.goods, {
    11: (_r, v) => f("'Кўрсаткичлар'!$B$4", Number(v[11])),
    12: (r, v) => f(`ROUND(K${r}*L${r},2)`, Number(v[12])),
    13: (r, v) => f(`J${r}+M${r}`, Number(v[13])),
    17: (r, v) => f(`ROUND(P${r}-J${r}-S${r},2)`, Number(v[17])),
  }, [7, 9, 10, 12, 13, 15, 17, 18, 19]);
  data.goods.forEach((_, i) => { goods.getCell(i + 4, 8).numFmt = NUMFMT.m3; goods.getCell(i + 4, 11).numFmt = NUMFMT.int; });
  table(ctx, ws('Оплата'), PAYMENT_HEADERS, 4, data.clientPayments, {
    10: (r, v) => f(`SUM(D${r},H${r}:J${r})`, Number(v[10])),
    14: (r, v) => f(`ROUND(F${r}*N${r},2)`, Number(v[14])),
    15: (r, v) => f(`K${r}-O${r}`, Number(v[15])),
  }, [3, 5, 7, 8, 9, 10, 14, 15]);
  table(ctx, ws('Оплата поставшику'), ['Дата', 'В-о', 'Сумма', 'Плательщик', 'Получатель', 'Изох', 'Тизим ID'], 2, data.factoryPayments);
  table(ctx, ws('Поддон қайтариш'), ['Дата', 'Клиент', 'Поддон дона', 'Изох'], 3, data.clientReturns, {}, [2]);
  table(ctx, ws('Поддон қайтариш заводга'), ['Дата', 'Поддон сони', 'Жўнатувчи', 'Қабул қилувчи', '1 дона қайтариш ўртача нархи', 'Қайтариш харажати жами', 'Изох', 'Тўлов тури', 'Ҳаракат тури'], 3, data.factoryMovements,
    { 5: (r, v) => f(`ROUND(B${r}*E${r},2)`, Number(v[5])) }, [1, 5]);
  const warehouse = ws('Поддон қайтариш заводга');
  const returnedByClients = total(data.clientReturns, 2), returnedToFactories = total(data.factoryReturns, 1), defective = total(data.factoryDefects, 1);
  warehouse.getColumn(10).width = 44;
  warehouse.getCell('J3').value = 'ПОДДОН ҚОЛДИҒИ'; warehouse.getCell('J3').font = FONT.total;
  for (const [row, label] of [[4, 'Мижозлардан келган поддон сони'], [5, 'Заводга қайтарилган поддон сони'], [6, 'Қолдиқ (қайтарилмаган) поддон'], [7, 'Қайтариш фоизи']] as const) {
    warehouse.getCell(row, 10).value = label; warehouse.getCell(row, 10).font = FONT.body;
    warehouse.getCell(row, 11).numFmt = row === 7 ? '0.0%' : NUMFMT.int;
  }
  warehouse.getCell('K4').value = f(`SUM(${ref('Поддон қайтариш', 'C', 4, data.clientReturns.length)})`, returnedByClients);
  warehouse.getCell('K5').value = f(`SUMIF(${ref('Поддон қайтариш заводга', 'I', 4, data.factoryMovements.length)},"RETURNED_TO_FACTORY",${ref('Поддон қайтариш заводга', 'B', 4, data.factoryMovements.length)})`, returnedToFactories);
  warehouse.getCell('J8').value = 'Заводдан яроқсиз — ҳисобдан чиқарилган';
  warehouse.getCell('K8').value = f(`SUMIF(${ref('Поддон қайтариш заводга', 'I', 4, data.factoryMovements.length)},"DEFECTIVE_FROM_FACTORY",${ref('Поддон қайтариш заводга', 'B', 4, data.factoryMovements.length)})`, defective);
  warehouse.getCell('K8').numFmt = NUMFMT.int;
  warehouse.getCell('K6').value = f('K4-K5-K8', returnedByClients - returnedToFactories - defective);
  warehouse.getCell('K7').value = f('IFERROR(K5/K4,0)', returnedByClients ? returnedToFactories / returnedByClients : 0);
  const indicators = ws('Кўрсаткичлар');
  blockTitle(indicators, 1, 'ТИЗИМ КЎРСАТКИЧЛАРИ', 10);
  indicators.getCell('A4').value = 'Поддон базавий нархи (сўм)'; indicators.getCell('B4').value = n(data.palletPrice);
  indicators.getCell('A5').value = 'Солиқ (1 куб учун, сўм)'; indicators.getCell('B5').value = Number(settings.taxPerM3);
  indicators.getCell('A6').value = 'КПИ улуши (агент)'; indicators.getCell('B6').value = Number(settings.agentShare);
  indicators.getCell('A7').value = 'Соф фойда улуши (фирма)'; indicators.getCell('B7').value = f('1-B6', Number(settings.companyShare));
  indicators.getCell('B6').numFmt = indicators.getCell('B7').numFmt = '0.00%';
  indicators.getCell('C4').value = 'Қолган поддонларнинг жорий баҳоси: мижоз ва завод қарзига қўшилади. Олдинги поддон тўловлари ўзгармайди.';
  indicators.getCell('C5').value = 'KPI = (савдо − таннарх − транспорт − куб × солиқ) × агент улуши';
  indicators.getCell('C6').value = 'Танланган давр KPI варағида. Шаблон манба жадваллари — бутун тарих.';
  indicators.getColumn(1).width = 42; indicators.getColumn(3).width = 42;
  for (const row of [4, 5, 6, 7]) { indicators.getRow(row).height = 34; indicators.getCell(row, 1).alignment = { wrapText: true }; indicators.getCell(row, 3).alignment = { wrapText: true }; }
  header(indicators, 10, ['Расмий ном', 'Варианти-1', 'Варианти-2', 'Эски варақ', 'Агент', 'Агент', 'Изох', '', 'Поставшик', 'Изох']);
  data.clients.forEach((client, i) => [client.name, client.aliases[0]?.name ?? null, client.aliases[1]?.name ?? null, client.aliases[2]?.name ?? null, client.agent?.name ?? null].forEach((value, j) => decorate(indicators, i + 11, j + 1, value)));
  data.agents.forEach((agent, i) => decorate(indicators, i + 11, 6, agent.name));
  data.factories.forEach((factory, i) => { decorate(indicators, i + 11, 9, factory.name); decorate(indicators, i + 11, 10, factory.note); });
  ctx.book.count(indicators, data.clients.length + data.agents.length + data.factories.length);
  writeClientBalances(ctx, data, ws('Мижозлар қолдиғи'));
  writeFactoryBalances(ctx, data, ws('Поставшиклар ҳисоби'));
  writeSearch(ctx, data, ws('Қидирув'));
  writeClientCard(ctx, data, ws('Мижоз картаси'));
  writeChecks(ctx, data, ws('Текширув'));
}

function writeClientBalances(ctx: Ctx, data: SmartblokData, ws: Worksheet): void {
  blockTitle(ws, 1, 'МИЖОЗЛАР ҚОЛДИҒИ', 17);
  ws.getCell('A2').value = 'Пул қолдиғида манфий = қарз, мусбат = аванс. A:M — шаблон манбалари; N:Q — лойиҳанинг барча тўлов ва қўлдаги тузатишлари билан ҳақиқий қолдиқлари. O — мижоздаги поддон (мусбат = қайтариши керак).';
  ws.mergeCells('A2:Q2'); ws.getRow(2).height = 34; ws.getCell('A2').alignment = { wrapText: true };
  const rows = data.clients.map((client): Plain[] => {
    const sale = sum(data.goods, 19, client.name, 3); const paid = sum(data.clientPayments, 15, client.name, 2);
    const received = sum(data.goods, 10, client.name, 3); const returned = sum(data.clientReturns, 2, client.name, 1);
    const charged = sum(data.clientPayments, 5, client.name, 2); const chargeMoney = sum(data.clientPayments, 14, client.name, 2);
    const units = returned + charged - received;
    const owed = D(paid).minus(sale); const palletMoney = data.palletPrice.mul(units);
    const actualBase = (data.balances.get(client.id) ?? ZERO).negated();
    const actualUnits = data.clientPalletBalances.get(client.id) ?? 0;
    const actualPalletMoney = data.palletPrice.mul(actualUnits);
    return [client.agent?.name ?? null, client.name, sale, paid, n(owed), received, returned, charged, chargeMoney, units, n(data.palletPrice), n(palletMoney), n(owed.plus(palletMoney)), n(actualBase), actualUnits, n(actualPalletMoney), n(actualBase.minus(actualPalletMoney))];
  });
  table(ctx, ws, ['Агент', 'Мижоз', 'Товар сотуви (мижозга)', 'Товарга тўлов', 'ТОВАР ҚАРЗИ', 'Олган поддон', 'Қайтарган', 'Тўлаган дона', 'Тўлаган сумма', 'ПОДДОН ҚАРЗИ (дона)', 'Поддон нархи', 'ПОДДОН ҚАРЗИ (сўм)', 'ЖАМИ ҚАРЗ', 'ЛОЙИҲА — ПОДДОНСИЗ ҚОЛДИҚ', 'ЛОЙИҲА — ПОДДОН ҚОЛДИҒИ (дона)', 'ЛОЙИҲА — ПОДДОН ҚИЙМАТИ', 'ЛОЙИҲА — ПОДДОН БИЛАН ҚОЛДИҚ'], 4, rows, {
    2: (r, v) => f(sumif('Товар', data.goods.length, 4, 'T', 'D', `B${r}`), Number(v[2])),
    3: (r, v) => f(sumif('Оплата', data.clientPayments.length, 5, 'P', 'C', `B${r}`), Number(v[3])),
    4: (r, v) => f(`D${r}-C${r}`, Number(v[4])),
    5: (r, v) => f(sumif('Товар', data.goods.length, 4, 'K', 'D', `B${r}`), Number(v[5])),
    6: (r, v) => f(sumif('Поддон қайтариш', data.clientReturns.length, 4, 'C', 'B', `B${r}`), Number(v[6])),
    7: (r, v) => f(sumif('Оплата', data.clientPayments.length, 5, 'F', 'C', `B${r}`), Number(v[7])),
    8: (r, v) => f(sumif('Оплата', data.clientPayments.length, 5, 'O', 'C', `B${r}`), Number(v[8])),
    9: (r, v) => f(`G${r}+H${r}-F${r}`, Number(v[9])), 10: (_r, v) => f("'Кўрсаткичлар'!$B$4", Number(v[10])),
    11: (r, v) => f(`J${r}*K${r}`, Number(v[11])), 12: (r, v) => f(`E${r}+L${r}`, Number(v[12])),
    15: (r, v) => f(`ROUND(O${r}*K${r},2)`, Number(v[15])),
    16: (r, v) => f(`N${r}-P${r}`, Number(v[16])),
  });
  rows.forEach((_, index) => { ws.getCell(index + 5, 15).numFmt = NUMFMT.int; });
  // Totals below the dictionary match the importer's report convention.
  const r = rows.length + 5; ws.getCell(r, 2).value = 'ЖАМИ';
  for (const index of [2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16]) {
    const cell = ws.getCell(r, index + 1);
    cell.value = f(rows.length ? `SUM(${colLetter(index + 1)}5:${colLetter(index + 1)}${r - 1})` : '0', total(rows, index));
    cell.numFmt = [5, 6, 7, 9, 14].includes(index) ? NUMFMT.int : NUMFMT.money;
    cell.font = FONT.total;
  }
}

function writeFactoryBalances(ctx: Ctx, data: SmartblokData, ws: Worksheet): void {
  blockTitle(ws, 1, 'ПОСТАВШИКЛАР ҲИСОБ-КИТОБИ', 22);
  ws.getCell('A2').value = 'Пул қолдиғида манфий = заводга қарз, мусбат = аванс. M/P — шаблоннинг поддонсиз/поддон билан қолдиғи; Q/T — лойиҳанинг барча тузатишлари билан ҳақиқий қолдиқлари. H — эски шаблоннинг қайтаришгача қолдиғи. R — заводга қайтариладиган поддон.';
  ws.mergeCells('A2:U2'); ws.getRow(2).height = 34; ws.getCell('A2').alignment = { wrapText: true };
  const rows = data.factories.map((factory): Plain[] => {
    const cost = sum(data.goods, 9, factory.name, 1), deposit = sum(data.goods, 12, factory.name, 1), paid = sum(data.factoryPayments, 2, factory.name, 4);
    const received = sum(data.goods, 10, factory.name, 1), returned = sum(data.factoryReturns, 1, factory.name, 3);
    const defective = sum(data.factoryDefects, 1, factory.name, 3);
    const expense = sum(data.factoryReturns, 5, factory.name, 3), units = received - returned - defective;
    const base = D(paid).plus(expense).minus(cost), palletMoney = data.palletPrice.mul(units);
    const actualCredit = data.factoryReturnCredits.get(factory.id) ?? ZERO;
    const actualBase = (data.factoryBuckets.get(factory.id)?.net ?? ZERO).plus(actualCredit);
    const actualUnits = data.factoryPalletBalances.get(factory.id) ?? 0;
    const actualPalletMoney = data.palletPrice.mul(actualUnits);
    return [factory.name, sum(data.goods, 7, factory.name, 1), cost, received, deposit, n(D(cost).plus(deposit)), paid, n(D(paid).minus(cost).minus(deposit)), n(data.factoryBuckets.get(factory.id)?.net ?? ZERO), returned, expense, units, n(base), n(data.palletPrice), n(palletMoney), n(base.minus(palletMoney)), n(actualBase), actualUnits, n(actualPalletMoney), n(actualBase.minus(actualPalletMoney)), n(actualCredit), defective];
  });
  table(ctx, ws, ['Поставшик', 'Товар миқдори (куб)', 'Товар суммаси', 'Поддон сони', 'Поддон суммаси', 'ЖАМИ ОЛИНГАН', 'ТЎЛАНГАН', 'ҚОЛДИҚ (қайтаришгача)', 'ПУЛ ДАФТАРИ БАЛАНСИ', 'Қайтарилган поддон', 'Қайтариш харажати', 'Қолган поддон', 'ПОДДОНСИЗ ҚОЛДИҚ', 'Жорий поддон нархи', 'Қолган поддон суммаси', 'ПОДДОН БИЛАН ҚОЛДИҚ', 'ЛОЙИҲА — ПОДДОНСИЗ ҚОЛДИҚ', 'ЛОЙИҲА — ПОДДОН ҚОЛДИҒИ (дона)', 'ЛОЙИҲА — ПОДДОН ҚИЙМАТИ', 'ЛОЙИҲА — ПОДДОН БИЛАН ҚОЛДИҚ', 'ЛОЙИҲА — ҚАЙТАРИШ ХАРАЖАТИ ЧЕГИРМАСИ', 'ЗАВОДДАН ЯРОҚСИЗ — ЧИҚАРИЛГАН'], 3, rows, {
    1: (r, v) => f(sumif('Товар', data.goods.length, 4, 'H', 'B', `A${r}`), Number(v[1])),
    2: (r, v) => f(sumif('Товар', data.goods.length, 4, 'J', 'B', `A${r}`), Number(v[2])),
    3: (r, v) => f(sumif('Товар', data.goods.length, 4, 'K', 'B', `A${r}`), Number(v[3])),
    4: (r, v) => f(sumif('Товар', data.goods.length, 4, 'M', 'B', `A${r}`), Number(v[4])),
    5: (r, v) => f(`C${r}+E${r}`, Number(v[5])),
    6: (r, v) => f(sumif('Оплата поставшику', data.factoryPayments.length, 3, 'C', 'E', `A${r}`), Number(v[6])),
    7: (r, v) => f(`G${r}-F${r}`, Number(v[7])),
    9: (r, v) => f(factoryMovementSumif(data.factoryMovements.length, 'B', `A${r}`, 'RETURNED_TO_FACTORY'), Number(v[9])),
    10: (r, v) => f(sumif('Поддон қайтариш заводга', data.factoryMovements.length, 4, 'F', 'D', `A${r}`), Number(v[10])),
    11: (r, v) => f(`D${r}-J${r}-V${r}`, Number(v[11])),
    12: (r, v) => f(`G${r}+K${r}-C${r}`, Number(v[12])),
    13: (_r, v) => f("'Кўрсаткичлар'!$B$4", Number(v[13])),
    14: (r, v) => f(`ROUND(L${r}*N${r},2)`, Number(v[14])),
    15: (r, v) => f(`M${r}-O${r}`, Number(v[15])),
    16: (r, v) => f(`I${r}+U${r}`, Number(v[16])),
    18: (r, v) => f(`ROUND(R${r}*N${r},2)`, Number(v[18])),
    19: (r, v) => f(`Q${r}-S${r}`, Number(v[19])),
    21: (r, v) => f(factoryMovementSumif(data.factoryMovements.length, 'B', `A${r}`, 'DEFECTIVE_FROM_FACTORY'), Number(v[21])),
  });
  rows.forEach((_, index) => { ws.getCell(index + 4, 18).numFmt = ws.getCell(index + 4, 22).numFmt = NUMFMT.int; });
  const end = rows.length + 4; ws.getCell(end, 1).value = 'ЖАМИ';
  for (const index of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21]) {
    const cell = ws.getCell(end, index + 1);
    cell.value = f(rows.length ? `SUM(${colLetter(index + 1)}4:${colLetter(index + 1)}${end - 1})` : '0', total(rows, index));
    cell.numFmt = [3, 9, 11, 17, 21].includes(index) ? NUMFMT.int : NUMFMT.money; cell.font = FONT.total;
  }
}

function writeSearch(ctx: Ctx, data: SmartblokData, ws: Worksheet): void {
  blockTitle(ws, 1, 'ҚИДИРУВ — мижоз ва агентлар', 7);
  ws.getCell('A3').value = 'Мижоз ва агент устунларининг фильтридан керакли номни танланг.';
  const rows: Plain[][] = data.clients.map((client) => [client.name, client.agent?.name ?? null, client.aliases.map((a) => a.name).join(' / ')]);
  table(ctx, ws, ['Мижоз', 'Агент', 'Ном вариантлари'], 5, rows);
}

function writeClientCard(ctx: Ctx, data: SmartblokData, ws: Worksheet): void {
  blockTitle(ws, 1, 'МИЖОЗ КАРТАСИ — барча мижозлар ҳаракати', 12);
  ws.getCell('A3').value = 'Мижоз фильтри орқали карточкани танланг. Пул ва поддон ҳаракатлари алоҳида устунларда.';
  const rows: Plain[][] = [];
  for (const g of data.goods) rows.push([g[3], g[4], 'Товар', g[20], g[5], g[6], g[7], g[19], 0, g[10], 0, g[23]]);
  for (const p of data.clientPayments) rows.push([p[2], p[0], Number(p[5]) ? 'Поддон ҳисоби' : 'Тўлов', p[16], null, null, 0, 0, p[15], 0, p[5], p[12]]);
  const clientNames = new Set(data.clients.map((client) => client.name));
  for (const p of data.clientReturns) if (clientNames.has(String(p[1]))) rows.push([p[1], p[0], 'Поддон қайтариш', null, null, null, 0, 0, 0, 0, p[2], p[3]]);
  rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])) || (a[1] as Date).getTime() - (b[1] as Date).getTime());
  table(ctx, ws, ['Мижоз', 'Дата', 'Ҳаракат', 'Агент', '№ авто', 'Размер', 'Куб', 'Мижозга', 'Товарга тўлов', 'Берилган поддон', 'Қайтган / тўланган поддон', 'Изоҳ'], 6, rows, {}, [6, 7, 8, 9, 10]);
}

function writeChecks(ctx: Ctx, data: SmartblokData, ws: Worksheet): void {
  blockTitle(ws, 1, 'ТЕКШИРУВ — ЭКСПОРТ ҚАМРОВИ ВА НАЗОРАТ', 6);
  const rows: Plain[][] = [
    ['Товар қаторлари', data.goods.length, 'Бекор қилинмаган буюртмалар; барча маҳсулот қаторлари.'],
    ['Товар ҳажми (куб)', total(data.goods, 7), 'Товар!H'],
    ['Фойда (сўм)', total(data.goods, 17), 'Савдо − таннарх − транспорт.'],
    ['Мижоздан тушган пул', total(data.clientPayments, 10), 'Қайтарилган пул манфий; поддон ҳисоби кассага пул қўшмайди.'],
    ['Поддон пули', total(data.clientPayments, 14), 'Поддон ҳисоби пул тушумидан алоҳида; бир хил пул икки марта ҳисобланмайди.'],
    ['Товарга тўлов', total(data.clientPayments, 15), 'Жами тўлов − поддон ҳисоби.'],
    ['Шаблондан ташқари тўловлар', data.unsupported.length, 'USD / бонус каби қўшимча каналлар «Тўловлар» варағида тўлиқ сақланган.'],
    ['Қайта импорт чегараси', null, 'Шаблон — беш манба жадвали. Қўлдаги баланс тузатишлари, бонус, USD ва аудит ёзувлари қўшимча варақларда; автоматик база тиклаш эмас.'],
    ['Заводдан яроқсиз поддон', total(data.factoryDefects, 1), 'Манба I устунида DEFECTIVE_FROM_FACTORY: қайтариш ва пул ҳаракати эмас. Завод мажбурияти ва яроқли омбор захирасидан чиқарилади. БРАК омбор тузатиши эса алоҳида.'],
    ['Поддон билан қарз', null, 'Поддонсиз қарз + қолган поддон × жорий нарх. Қайтариш харажати завод қарзидан айирилади; баҳолаш янги касса тўлови эмас.'],
  ];
  for (const warning of data.unsupported) rows.push(['Шаблондан ташқари', null, warning]);
  for (const client of data.clients) {
    const received = sum(data.goods, 10, client.name, 3), returned = sum(data.clientReturns, 2, client.name, 1), paid = sum(data.clientPayments, 5, client.name, 2);
    if (returned + paid > received) rows.push([client.name, returned + paid - received, 'Қайтарилган + тўланган поддон берилганидан кўп.']);
  }
  table(ctx, ws, ['Назорат', 'Қиймат', 'Изоҳ'], 4, rows);
  ws.getColumn(1).width = 36; ws.getColumn(3).width = 100;
  ws.eachRow((row, index) => { if (index > 4) { row.height = 34; row.getCell(3).alignment = { wrapText: true }; } });
}

export { f as formula, decorate, ref, safeCriteria };
