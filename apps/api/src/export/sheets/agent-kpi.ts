import type { Worksheet } from 'exceljs';
import { calculateAgentKpi, type AgentKpiMetrics, type AgentKpiReport, type AgentKpiRow } from '../../agents/agent-kpi.calculator';
import { NUMFMT } from '../xlsx/theme';
import { colLetter } from '../xlsx/sheet-builder';
import type { Ctx } from './ctx';
import { blockTitle, decorate, formula as f, header, ref, safeCriteria } from './smartblok';

const columns = ['№', 'Агент', 'Сотган миқдор (куб)', 'Фойда (сўм)', 'Солиқ нархи (1 куб)', 'Солиқ суммаси', 'Соф фойда (фойда − солиқ)', 'Агент KPI', 'Фирма фойдаси'];
const metrics = (row: AgentKpiMetrics): number[] => [Number(row.quantityM3), Number(row.profit), Number(row.taxAmount), Number(row.netProfit), Number(row.agentKpi), Number(row.companyProfit)];

/** Shared report values are cached; normal Excel formulas keep all three sections editable. */
export function writeAgentKpi(ctx: Ctx, ws: Worksheet, report: AgentKpiReport, goodsCount: number): void {
  blockTitle(ws, 1, 'АГЕНТЛАР KPI', 9);
  ws.getCell('A3').value = 'Ой:'; ws.getCell('D3').value = new Date(`${report.month}-01T00:00:00Z`); ws.getCell('D3').numFmt = 'mm.yyyy';
  ws.getCell('A4').value = 'Солиқ нархи (1 куб учун, сўм):'; ws.getCell('D4').value = f("'Кўрсаткичлар'!$B$5", Number(report.settings.taxPerM3));
  ws.getCell('A5').value = 'Агент улуши (KPI):'; ws.getCell('D5').value = f("'Кўрсаткичлар'!$B$6", Number(report.settings.agentShare));
  ws.getCell('A6').value = 'Фирма улуши (фойда):'; ws.getCell('D6').value = f('1-D5', Number(report.settings.companyShare));
  for (const row of [4, 5, 6]) { ws.mergeCells(row, 1, row, 3); ws.getRow(row).height = 24; }
  ws.getCell('D4').numFmt = NUMFMT.money;
  ws.getCell('D5').numFmt = ws.getCell('D6').numFmt = '0.00%';
  ws.getCell('L2').value = 'Ойлар рўйхати';
  report.availableMonths.forEach((month, index) => { ws.getCell(index + 3, 12).value = new Date(`${month}-01T00:00:00Z`); ws.getCell(index + 3, 12).numFmt = 'mm.yyyy'; });
  if (report.availableMonths.length) ws.getCell('D3').dataValidation = { type: 'list', allowBlank: false, formulae: [`$L$3:$L$${report.availableMonths.length + 2}`] };
  const range = (column: string) => ref('Товар', column, 4, goodsCount);
  const agentSum = (column: string, row: number, monthly: boolean, unassigned: boolean): string =>
    `SUMIFS(${range(column)},${range('U')},${unassigned ? '""' : safeCriteria(`B${row}`)}${monthly ? `,${range('E')},">="&$D$3,${range('E')},"<"&EOMONTH($D$3,0)+1` : ''})`;
  const agentBlock = (start: number, rows: AgentKpiRow[], totals: AgentKpiMetrics, monthly: boolean): number => {
    header(ws, start, columns);
    rows.forEach((row, index) => {
      const r = start + index + 1;
      [index + 1, row.agentName, Number(row.quantityM3), Number(row.profit), Number(report.settings.taxPerM3), Number(row.taxAmount), Number(row.netProfit), Number(row.agentKpi), Number(row.companyProfit)]
        .forEach((value, column) => decorate(ws, r, column + 1, value));
      ws.getCell(r, 1).numFmt = NUMFMT.int;
      ws.getCell(r, 3).value = f(agentSum('H', r, monthly, row.agentId === null), Number(row.quantityM3)); ws.getCell(r, 3).numFmt = NUMFMT.m3;
      ws.getCell(r, 4).value = f(agentSum('R', r, monthly, row.agentId === null), Number(row.profit));
      ws.getCell(r, 5).value = f('$D$4', Number(report.settings.taxPerM3));
      ws.getCell(r, 6).value = f(`C${r}*E${r}`, Number(row.taxAmount));
      ws.getCell(r, 7).value = f(`D${r}-F${r}`, Number(row.netProfit));
      ws.getCell(r, 8).value = f(`G${r}*$D$5`, Number(row.agentKpi));
      ws.getCell(r, 9).value = f(`G${r}-H${r}`, Number(row.companyProfit));
    });
    const r = start + rows.length + 1;
    ws.getCell(r, 2).value = 'ЖАМИ';
    [3, 4, 6, 7, 8, 9].forEach((column, index) => {
      ws.getCell(r, column).value = f(rows.length ? `SUM(${colLetter(column)}${start + 1}:${colLetter(column)}${r - 1})` : '0', metrics(totals)[index]);
      ws.getCell(r, column).numFmt = column === 3 ? NUMFMT.m3 : NUMFMT.money;
    });
    return r;
  };
  blockTitle(ws, 8, '1-ЖАДВАЛ: ТАНЛАНГАН ОЙ БЎЙИЧА', 9);
  const monthRows = [...report.monthly.rows];
  const unassigned = report.lifetime.rows.find((row) => row.agentId === null);
  if (unassigned && !monthRows.some((row) => row.agentId === null)) {
    // Keep the row when D3 changes to another month containing unassigned loads.
    monthRows.push({ ...unassigned, ...calculateAgentKpi(0, 0, report.settings) });
  }
  const monthTotal = agentBlock(9, monthRows, report.monthly.totals, true);
  blockTitle(ws, monthTotal + 2, '2-ЖАДВАЛ: БУТУН ДАВР БЎЙИЧА', 9);
  const lifetimeTotal = agentBlock(monthTotal + 3, report.lifetime.rows, report.lifetime.totals, false);
  ws.getCell(lifetimeTotal + 2, 1).value = 'KPI = (савдо − таннарх − транспорт − куб × солиқ) × агент улуши. Тўлов йиғилишига боғлиқ эмас; манфий натижа сақланади.';
  ws.mergeCells(lifetimeTotal + 2, 1, lifetimeTotal + 2, 9);
  ws.getCell(lifetimeTotal + 2, 1).alignment = { wrapText: true, vertical: 'middle' };
  ws.getRow(lifetimeTotal + 2).height = 32;
  const dailyTitle = lifetimeTotal + 3;
  blockTitle(ws, dailyTitle, '3-ЖАДВАЛ: ТАНЛАНГАН ОЙ — КУНЛИК КЕСИМДА', 9);
  header(ws, dailyTitle + 1, ['Сана', 'Сотган миқдор (куб)', 'Фойда (сўм)', 'Солиқ суммаси', 'Соф фойда', 'Агент KPI', 'Фирма фойдаси']);
  // Always reserve 31 dates. Changing D3 from February to March must not lose 3 days.
  const dailyStart = dailyTitle + 2;
  for (let index = 0; index < 31; index++) {
    const r = dailyStart + index; const row = report.daily.rows[index];
    const cachedDate: Date | string = row ? new Date(`${row.date}T00:00:00Z`) : '';
    decorate(ws, r, 1, f(`IF(${index}<DAY(EOMONTH($D$3,0)),$D$3+${index},"")`, cachedDate)); ws.getCell(r, 1).numFmt = NUMFMT.date;
    const values = row ? metrics(row) : [0, 0, 0, 0, 0, 0];
    const formulas = [
      `SUMIFS(${range('H')},${range('E')},A${r})`, `SUMIFS(${range('R')},${range('E')},A${r})`,
      `B${r}*$D$4`, `C${r}-D${r}`, `E${r}*$D$5`, `E${r}-F${r}`,
    ];
    formulas.forEach((formula, column) => decorate(ws, r, column + 2, f(`IF(A${r}="","",${formula})`, row ? values[column] : '')));
    ws.getCell(r, 2).numFmt = NUMFMT.m3;
  }
  const dailyTotal = dailyStart + 31;
  ws.getCell(dailyTotal, 1).value = 'ЖАМИ';
  metrics(report.daily.totals).forEach((value, index) => {
    ws.getCell(dailyTotal, index + 2).value = f(`SUM(${colLetter(index + 2)}${dailyStart}:${colLetter(index + 2)}${dailyTotal - 1})`, value);
    ws.getCell(dailyTotal, index + 2).numFmt = index === 0 ? NUMFMT.m3 : NUMFMT.money;
  });
  ws.getCell(dailyTotal + 2, 1).value = 'ТЕКШИРУВ: кунлик жами − агентлар жами (0 бўлиши керак)';
  ws.mergeCells(dailyTotal + 2, 1, dailyTotal + 2, 5);
  ws.getCell(dailyTotal + 2, 1).alignment = { wrapText: true, vertical: 'middle' };
  ws.getRow(dailyTotal + 2).height = 30;
  ws.getCell(dailyTotal + 2, 6).value = f(`F${dailyTotal}-H${monthTotal}`, 0);
  ws.getCell(dailyTotal + 2, 7).value = f(`G${dailyTotal}-I${monthTotal}`, 0);
  ws.views = [{ state: 'frozen', ySplit: 9, xSplit: 2 }];
  ws.getColumn(2).width = 28;
  ws.getColumn(1).width = 14;
  for (const row of [9, monthTotal + 3, dailyTitle + 1]) ws.getRow(row).height = 48;
  ctx.book.count(ws, report.monthly.rows.length + report.lifetime.rows.length + report.daily.rows.length);
}
