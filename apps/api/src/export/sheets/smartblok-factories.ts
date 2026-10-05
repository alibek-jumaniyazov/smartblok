import { D, ZERO } from '../../common/money';
import { NUMFMT } from '../xlsx/theme';
import { colLetter } from '../xlsx/sheet-builder';
import type { Ctx } from './ctx';
import { total, n, type Plain, type SmartblokData } from './smartblok-data';
import { blockTitle, decorate, formula as f, header, ref, safeCriteria } from './smartblok';
import type { Worksheet } from 'exceljs';

const date = (value: Plain) => (value as Date).getTime();
const cash = (value: Plain) => value === 'Касса' || value === 'Нахт пластика';
const sum = (rows: Plain[][], column: number) => total(rows, column);
const ts = (day: string) => new Date(`${day}T00:00:00Z`).getTime();

function slice(data: SmartblokData, factory: string, from: number, to: number) {
  const goods = data.goods.filter((r) => r[1] === factory && date(r[4]) >= from && date(r[4]) < to);
  const payments = data.factoryPayments.filter((r) => r[4] === factory && date(r[0]) >= from && date(r[0]) < to);
  const returns = data.factoryReturns.filter((r) => r[3] === factory && date(r[0]) >= from && date(r[0]) < to);
  const defects = data.factoryDefects.filter((r) => r[3] === factory && date(r[0]) >= from && date(r[0]) < to);
  const defective = sum(defects, 1);
  const cashGoods = goods.filter((r) => cash(r[0])); const bankGoods = goods.filter((r) => !cash(r[0]));
  const cashReturns = returns.filter((r) => cash(r[7])); const bankReturns = returns.filter((r) => !cash(r[7]));
  const expenses = sum(returns, 5);
  return {
    goods, payments, returns, defective,
    cashIn: n(D(sum(payments.filter((r) => cash(r[1])), 2)).plus(expenses)),
    bankIn: sum(payments.filter((r) => !cash(r[1])), 2),
    cashCost: sum(cashGoods, 9), cashM3: sum(cashGoods, 7), bankCost: sum(bankGoods, 9), bankM3: sum(bankGoods, 7),
    cashDeposit: sum(cashGoods, 12), cashPallets: sum(cashGoods, 10), bankDeposit: sum(bankGoods, 12), bankPallets: sum(bankGoods, 10),
    cashReturnQty: sum(cashReturns, 1), cashReturnMoney: n(data.palletPrice.mul(sum(cashReturns, 1))),
    bankReturnQty: sum(bankReturns, 1), bankReturnMoney: n(data.palletPrice.mul(sum(bankReturns, 1))),
    cost: sum(goods, 9), deposit: sum(goods, 12), paid: sum(payments, 2), returned: sum(returns, 1), expenses,
    palletBalance: sum(goods, 10) - sum(returns, 1) - defective,
    balanceWithoutPallets: n(D(sum(payments, 2)).plus(expenses).minus(sum(goods, 9))),
    balance: n(D(sum(payments, 2)).plus(expenses).plus(data.palletPrice.mul(sum(returns, 1) + defective)).minus(sum(goods, 9)).minus(sum(goods, 12))),
  };
}

/** Two valuation views share the same physical quantities and actual payment history. */
export function writeSmartblokFactoryReports(ctx: Ctx, data: SmartblokData, sheets: Map<string, Worksheet>, month: string): void {
  const from = ts(`${month}-01`); const to = Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1);
  const act = sheets.get('Акт (умумий)')!;
  blockTitle(act, 1, 'АКТ (УМУМИЙ) — ПОДДОНСИЗ ВА ПОДДОН БИЛАН', 25);
  act.getCell('A2').value = 'Ой:'; act.getCell('B2').value = new Date(from); act.getCell('B2').numFmt = 'mm.yyyy';
  act.getCell('D2').value = 'Манфий = қарз, мусбат = аванс. R/S — каналлар бўйича яроқсиз чиқаришгача; W — яроқсиз X донани чиқаргандан кейинги умумий қолдиқ. Яроқсиз қиймат Y пул тўлови эмас.';
  const labels = ['№', 'Поставшик', 'Тушум — касса', 'Тушум — переч', 'Товар — касса сумма', 'Куб — касса', 'Товар — переч сумма', 'Куб — переч', 'Поддон — касса сумма', 'Поддон — касса сони', 'Поддон — переч сумма', 'Поддон — переч сони', 'ЖАМИ ОЛИНГАН', 'Қайтган — касса сумма', 'Қайтган — касса сони', 'Қайтган — переч сумма', 'Қайтган — переч сони', 'Қолдиқ — касса', 'Қолдиқ — переч', 'Поддон қарзи (дона)'];
  const block = (start: number, all: boolean): number => {
    header(act, start, [...labels, 'ПОДДОНСИЗ ҚОЛДИҚ', 'Қолган поддон суммаси', 'ПОДДОН БИЛАН ҚОЛДИҚ', 'Заводдан яроқсиз (жами дона)', 'Яроқсиз — мажбуриятдан чиқарилган қиймат']);
    const blockRows: Plain[][] = [];
    data.factories.forEach((factory, index) => {
      const a = slice(data, factory.name, all ? -Infinity : from, all ? Infinity : to);
      const cumulative = slice(data, factory.name, -Infinity, all ? Infinity : to);
      const r = start + index + 1;
      const values: Plain[] = [index + 1, factory.name, a.cashIn, a.bankIn, a.cashCost, a.cashM3, a.bankCost, a.bankM3,
        a.cashDeposit, a.cashPallets, a.bankDeposit, a.bankPallets, n(D(a.cost).plus(a.deposit)), a.cashReturnMoney, a.cashReturnQty, a.bankReturnMoney, a.bankReturnQty,
        n(D(cumulative.cashIn).minus(cumulative.cashCost).minus(cumulative.cashDeposit).plus(cumulative.cashReturnMoney)),
        n(D(cumulative.bankIn).minus(cumulative.bankCost).minus(cumulative.bankDeposit).plus(cumulative.bankReturnMoney)), cumulative.palletBalance,
        cumulative.balanceWithoutPallets, n(data.palletPrice.mul(cumulative.palletBalance)), cumulative.balance,
        cumulative.defective, n(data.palletPrice.mul(cumulative.defective))];
      blockRows.push(values); values.forEach((v, i) => decorate(act, r, i + 1, v));
      for (const [column, formula] of [[13, `SUM(E${r},G${r},I${r},K${r})`], [14, `O${r}*'Кўрсаткичлар'!$B$4`], [16, `Q${r}*'Кўрсаткичлар'!$B$4`]] as const) act.getCell(r, column).value = f(formula, Number(values[column - 1]));
      act.getCell(r, 9).value = f(`J${r}*'Кўрсаткичлар'!$B$4`, Number(values[8]));
      act.getCell(r, 11).value = f(`L${r}*'Кўрсаткичлар'!$B$4`, Number(values[10]));
      // Monthly balances include the opening history; retain its base and units
      // in the formula so changing B4 recalculates historical outstanding stock.
      act.getCell(r, 18).value = f(`${n(D(cumulative.cashIn).minus(cumulative.cashCost))}-(${cumulative.cashPallets - cumulative.cashReturnQty})*'Кўрсаткичлар'!$B$4`, Number(values[17]));
      act.getCell(r, 19).value = f(`${n(D(cumulative.bankIn).minus(cumulative.bankCost))}-(${cumulative.bankPallets - cumulative.bankReturnQty})*'Кўрсаткичлар'!$B$4`, Number(values[18]));
      act.getCell(r, 22).value = f(`T${r}*'Кўрсаткичлар'!$B$4`, Number(values[21]));
      act.getCell(r, 23).value = f(`U${r}-V${r}`, Number(values[22]));
      act.getCell(r, 25).value = f(`X${r}*'Кўрсаткичлар'!$B$4`, Number(values[24]));
      if (all) {
        act.getCell(r, 18).value = f(`C${r}-E${r}-I${r}+N${r}`, Number(values[17]));
        act.getCell(r, 19).value = f(`D${r}-G${r}-K${r}+P${r}`, Number(values[18]));
      }
    });
    const end = start + data.factories.length + 1;
    act.getCell(end, 2).value = 'ЖАМИ';
    for (let column = 3; column <= 25; column++) act.getCell(end, column).value = f(data.factories.length ? `SUM(${colLetter(column)}${start + 1}:${colLetter(column)}${end - 1})` : '0', total(blockRows, column - 1));
    return end;
  };
  const endMonthly = block(6, false);
  blockTitle(act, endMonthly + 2, 'БУТУН ДАВР БЎЙИЧА', 23);
  const endLifetime = block(endMonthly + 3, true);
  act.getCell(endLifetime + 2, 2).value = 'Касса тушумига қайтариш харажати қўшилган — файл формуласи. Бу заводга реал пул ўтказмаси эмас.';
  ctx.book.count(act, data.factories.length * 2);

  const daily = sheets.get('Ҳисобот')!;
  blockTitle(daily, 1, 'КУНЛИК ҲИСОБОТ — БАРЧА ЗАВОДЛАР', 17);
  const dates = [...data.goods.map((r) => date(r[4])), ...data.factoryPayments.map((r) => date(r[0])), ...data.factoryMovements.map((r) => date(r[0]))].filter((value) => value >= from && value < to);
  const selected = dates.length ? Math.max(...dates) : from;
  daily.getCell('A3').value = 'Сана:'; daily.getCell('B3').value = new Date(selected); daily.getCell('B3').numFmt = NUMFMT.date;
  daily.getCell('A4').value = 'Манфий = қарз, мусбат = аванс. K — поддон билан қолдиқ; N — поддонсиз қолдиқ.';
  const dailyLabels = ['Завод', 'Кун бошига қолдиқ', 'Товар суммаси', 'Поддон суммаси', 'ЖАМИ ОЛИНГАН', 'Заводга тўлов', 'Қайтган поддон', 'Қайтган поддон суммаси', 'Қайтариш харажати', 'ЖАМИ ҲИСОБГА ОЛИНГАН', 'КУН ОХИРИГА ҚОЛДИҚ', 'Поддон қарзи', 'ЛОЙИҲА ПУЛ БАЛАНСИ (ҳозир)'];
  header(daily, 6, [...dailyLabels, 'ПОДДОНСИЗ ҚОЛДИҚ', 'Қолган поддон суммаси', 'Заводдан яроқсиз (дона)', 'Яроқсиз — чиқарилган қиймат']);
  data.factories.forEach((factory, index) => {
    const a = slice(data, factory.name, selected, selected + 86400000), opening = slice(data, factory.name, -Infinity, selected), closing = slice(data, factory.name, -Infinity, selected + 86400000);
    const values: Plain[] = [factory.name, opening.balance, a.cost, a.deposit, n(D(a.cost).plus(a.deposit)), a.paid, a.returned, n(data.palletPrice.mul(a.returned)), a.expenses,
      n(D(a.paid).plus(data.palletPrice.mul(a.returned + a.defective)).plus(a.expenses)), closing.balance, closing.palletBalance, n(data.factoryBuckets.get(factory.id)?.net ?? ZERO), closing.balanceWithoutPallets, n(data.palletPrice.mul(closing.palletBalance)), a.defective, n(data.palletPrice.mul(a.defective))];
    const r = 7 + index; values.forEach((v, column) => decorate(daily, r, column + 1, v));
    daily.getCell(r, 5).value = f(`C${r}+D${r}`, Number(values[4]));
    daily.getCell(r, 2).value = f(`${opening.balanceWithoutPallets}-(${opening.palletBalance})*'Кўрсаткичлар'!$B$4`, Number(values[1]));
    daily.getCell(r, 4).value = f(`${a.palletBalance + a.returned + a.defective}*'Кўрсаткичлар'!$B$4`, Number(values[3]));
    daily.getCell(r, 8).value = f(`G${r}*'Кўрсаткичлар'!$B$4`, Number(values[7]));
    daily.getCell(r, 10).value = f(`F${r}+H${r}+I${r}+Q${r}`, Number(values[9]));
    daily.getCell(r, 11).value = f(`B${r}-E${r}+J${r}`, Number(values[10]));
    daily.getCell(r, 15).value = f(`L${r}*'Кўрсаткичлар'!$B$4`, Number(values[14]));
    daily.getCell(r, 17).value = f(`P${r}*'Кўрсаткичлар'!$B$4`, Number(values[16]));
  });
  ctx.book.count(daily, data.factories.length);

  const reconciliation = sheets.get('Акт сверка')!;
  blockTitle(reconciliation, 1, 'АКТ СВЕРКА — КУНЛИК ҲАРАКАТЛАР', 14);
  reconciliation.getCell('A3').value = 'Манфий = қарз, мусбат = аванс. I — поддон билан; K — поддонсиз қолдиқ. Нархи «Кўрсаткичлар»!B4 дан.';
  header(reconciliation, 5, ['Завод', 'Дата', 'Бошланғич қолдиқ', 'Товар суммаси', 'Поддон суммаси', 'Тўлов', 'Қайтган поддон (дона)', 'Қайтариш харажати', 'ПОДДОН БИЛАН ҚОЛДИҚ', 'Поддон қарзи', 'ПОДДОНСИЗ ҚОЛДИҚ', 'Қолган поддон суммаси', 'Заводдан яроқсиз (дона)', 'Яроқсиз — чиқарилган қиймат']);
  let r = 6;
  for (const factory of data.factories) {
    const events = new Set<number>();
    data.goods.filter((row) => row[1] === factory.name).forEach((row) => events.add(date(row[4])));
    data.factoryPayments.filter((row) => row[4] === factory.name).forEach((row) => events.add(date(row[0])));
    data.factoryReturns.filter((row) => row[3] === factory.name).forEach((row) => events.add(date(row[0])));
    data.factoryDefects.filter((row) => row[3] === factory.name).forEach((row) => events.add(date(row[0])));
    let balance = ZERO, baseBalance = ZERO, units = 0;
    for (const day of [...events].sort((a, b) => a - b)) {
      const a = slice(data, factory.name, day, day + 86400000);
      const opening = balance, openingBase = baseBalance, openingUnits = units;
      balance = balance.plus(a.balance); baseBalance = baseBalance.plus(a.balanceWithoutPallets); units += a.palletBalance;
      const values: Plain[] = [factory.name, new Date(day), n(opening), a.cost, a.deposit, a.paid, a.returned, a.expenses, n(balance), units, n(baseBalance), n(data.palletPrice.mul(units)), a.defective, n(data.palletPrice.mul(a.defective))];
      values.forEach((value, column) => decorate(reconciliation, r, column + 1, value));
      reconciliation.getCell(r, 9).value = f(`C${r}-D${r}-E${r}+F${r}+G${r}*'Кўрсаткичлар'!$B$4+H${r}+N${r}`, n(balance));
      reconciliation.getCell(r, 3).value = f(`${n(openingBase)}-(${openingUnits})*'Кўрсаткичлар'!$B$4`, n(opening));
      reconciliation.getCell(r, 5).value = f(`${a.palletBalance + a.returned + a.defective}*'Кўрсаткичлар'!$B$4`, a.deposit);
      reconciliation.getCell(r, 12).value = f(`J${r}*'Кўрсаткичлар'!$B$4`, Number(values[11]));
      reconciliation.getCell(r, 14).value = f(`M${r}*'Кўрсаткичлар'!$B$4`, Number(values[13]));
      r++;
    }
  }
  if (r > 6) reconciliation.autoFilter = { from: { row: 5, column: 1 }, to: { row: r - 1, column: 14 } };
  reconciliation.views = [{ state: 'frozen', ySplit: 5, xSplit: 2 }];
  ctx.book.count(reconciliation, r - 6);
}
