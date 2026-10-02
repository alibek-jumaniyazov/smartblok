import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { dailyReportWorkbook } from '../src/dashboard/daily-report.xlsx';
import type { DailyReport, DailyReportRow } from '../src/dashboard/daily-report.types';

let checks = 0;
function equal(actual: unknown, expected: unknown, message: string) {
  assert.deepEqual(actual, expected, message);
  checks++;
}
function ok(actual: unknown, message: string) { assert.ok(actual, message); checks++; }
const days = ['2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30'];
const constant = (value: string) => days.map(() => value);
const movement = (value: string) => [value, '0.00', '0.00', '0.00', '0.00'];
function row(key: string, label: string, section: DailyReportRow['section'], tone: DailyReportRow['tone'], values: string[], total: string,
  totalMode: DailyReportRow['totalMode'] = 'sum', unit: DailyReportRow['unit'] = 'money'): DailyReportRow {
  return { key, label, section, tone, values, total, totalMode, unit };
}
function fixture(): DailyReport {
  return {
    from: days[0], to: days.at(-1)!, generatedAt: '2026-10-03T19:30:00.000Z', palletUnitPrice: '130000.00', days,
    provisionalOrderCount: 0,
    notes: ['Manfiy qoldiq — zavodga qarz.', '=HYPERLINK("https://invalid.example", "Bu oddiy matn")'],
    warnings: ['Sinov izohi'],
    rows: [
      row('opening', 'Kun boshiga qoldiq', 'settlement', 'green', ['-628795054.00', ...constant('-742016206.00').slice(1)], '-628795054.00', 'opening'),
      row('purchases', 'Olingan tovar', 'settlement', 'green', movement('113221152.00'), '113221152.00'),
      row('payments', 'Qilingan to‘lov', 'settlement', 'green', constant('0.00'), '0.00'),
      row('closing', 'Kun oxiriga qoldiq', 'settlement', 'peach', constant('-742016206.00'), '-742016206.00', 'closing'),
      row('palletOpening', 'Kun boshiga qoldiq poddon', 'pallets', 'blue', ['-3818', ...constant('-3932').slice(1)], '-3818', 'opening', 'quantity'),
      row('received', 'Olingan poddon', 'pallets', 'blue', ['114', '0', '0', '0', '0'], '114', 'sum', 'quantity'),
      row('returned', 'Qaytarilgan poddon', 'pallets', 'blue', constant('0'), '0', 'sum', 'quantity'),
      row('palletClosing', 'Kun oxiriga qoldiq poddon (dona)', 'pallets', 'peach', constant('-3932'), '-3932', 'closing', 'quantity'),
      row('palletValue', 'Kun oxiriga qoldiq poddon (summa)', 'pallets', 'peach', constant('-511160000.00'), '-511160000.00', 'closing'),
      row('allDebt', 'Jami qarzdorlik', 'pallets', 'yellow', constant('-1253176206.00'), '-1253176206.00', 'closing'),
      row('cost', 'Tovar zavod narxida', 'factoryMargin', 'plain', movement('113221152.00'), '113221152.00'),
      row('list', 'Tovar narxnoma narxida', 'factoryMargin', 'plain', movement('119180160.00'), '119180160.00'),
      row('factoryMargin', 'Zavoddan olishdagi farq', 'factoryMargin', 'peach', movement('5959008.00'), '5959008.00'),
      row('listAgain', 'Tovar narxnoma narxida', 'salesMargin', 'plain', movement('119180160.00'), '119180160.00'),
      row('sales', 'Tovar sotuv narxida', 'salesMargin', 'plain', movement('125034240.00'), '125034240.00'),
      row('salesMargin', 'Agentlar sotishidagi farq', 'salesMargin', 'peach', movement('5854080.00'), '5854080.00'),
      row('result', 'Yakuniy tovar farqi', 'result', 'total', movement('11813088.00'), '11813088.00'),
    ],
  };
}
async function load(report: DailyReport) {
  const buffer = await dailyReportWorkbook(report);
  equal(buffer.subarray(0, 2).toString(), 'PK', 'Export is an XLSX ZIP workbook');
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(buffer as any);
  return book;
}
function value(cell: ExcelJS.Cell) { return cell.type === ExcelJS.ValueType.Formula ? cell.result : cell.value; }

async function main() {
  const report = fixture();
  const book = await load(report);
  equal(book.worksheets.map((sheet) => sheet.name), ['Kunlik hisobot', 'Izohlar'], 'Only report and explanatory sheets are exported');
  const sheet = book.getWorksheet('Kunlik hisobot')!;
  equal(sheet.getCell('A6').value, 'Gazoblok', 'Reference-style header label');
  equal(sheet.getCell('G6').value, 'Jami', 'Total follows selected daily columns');
  equal(sheet.getCell('B3').value, 130000, 'Current pallet price is numeric metadata');
  equal(sheet.getCell('A4').value, 'Yaratildi: 04.10.2026, 00:30:00 (Toshkent vaqti)', 'Generated time uses Tashkent, including day rollover');
  days.forEach((day, index) => {
    const cell = sheet.getCell(6, index + 2);
    equal((cell.value as Date).toISOString(), `${day}T00:00:00.000Z`, 'Daily header is an actual Excel date without timezone drift');
    equal(cell.numFmt, 'dd.mm.yyyy', 'Date formatting matches screenshot');
  });
  let previous: string | undefined;
  let rowNumber = 7;
  const rowNumbers = new Map<string, number>();
  for (const row of report.rows) {
    if (previous && previous !== row.section) {
      equal(sheet.getRow(rowNumber++).height, 10, 'Section separator remains blank');
    }
    previous = row.section;
    rowNumbers.set(row.key, rowNumber);
    equal(sheet.getCell(rowNumber, 1).value, row.label, 'Server row order and label are preserved');
    row.values.forEach((canonical, index) => equal(value(sheet.getCell(rowNumber, index + 2)), Number(canonical), 'Every daily cell matches canonical API result'));
    const total = sheet.getCell(rowNumber, 7);
    equal(total.result, Number(row.total), 'Cached total matches API, without all-time data');
    equal(total.formula, row.totalMode === 'sum' ? `ROUND(SUM(B${rowNumber}:F${rowNumber}),${row.unit === 'money' ? 2 : 0})`
      : `${row.totalMode === 'opening' ? 'B' : 'F'}${rowNumber}`, 'Flow/opening/closing use distinct formula semantics');
    rowNumber++;
  }
  const debtCell = sheet.getCell(rowNumbers.get('allDebt')!, 2);
  equal((debtCell.fill as ExcelJS.FillPattern).fgColor?.argb, 'FFF200', 'Combined debt has yellow reference highlight');
  ok(debtCell.numFmt.includes('[Red]-'), 'Negative debt is displayed red');
  ok(sheet.getCell('B9').numFmt.includes('"—"'), 'Zero is displayed as a dash');
  equal(sheet.getCell(rowNumbers.get('received')!, 2).numFmt, '#,##0;[Red]-#,##0;"—"', 'Pallet quantity displays integer counts');
  equal((sheet.getCell('B6').fill as ExcelJS.FillPattern).fgColor?.argb, '203B60', 'Header is navy');
  equal(sheet.views[0].state, 'frozen', 'Matrix has frozen panes');
  equal((sheet.views[0] as ExcelJS.WorksheetViewFrozen).xSplit, 1, 'Labels remain visible while scrolling dates');
  equal((sheet.views[0] as ExcelJS.WorksheetViewFrozen).ySplit, 6, 'Date header remains visible while scrolling rows');
  equal(sheet.pageSetup.orientation, 'landscape', 'Landscape printing');
  equal(sheet.pageSetup.printTitlesColumn, 'A:A', 'Labels repeat across printed pages');
  equal(sheet.autoFilter, undefined, 'Matrix is not an inappropriate filterable record table');
  const noteSheet = book.getWorksheet('Izohlar')!;
  const noteValues: unknown[] = [];
  noteSheet.eachRow((row) => noteValues.push(row.getCell(2).value));
  for (const note of [...report.notes, ...report.warnings]) ok(noteValues.includes(note), 'Every server note and warning is included verbatim');
  const textNote = noteSheet.getCell('B7');
  equal(textNote.formula, undefined, 'Formula-like note is stored as literal text');

  const single: DailyReport = {
    ...fixture(), from: '2026-10-01', to: '2026-10-01', days: ['2026-10-01'], warnings: [], notes: [], palletUnitPrice: '130000.25',
    rows: [
      row('opening', 'Opening', 'settlement', 'green', ['-10.25'], '-10.25', 'opening'),
      row('zero', 'No activity', 'settlement', 'plain', ['0.00'], '0.00'),
      row('closing', 'Closing', 'settlement', 'peach', ['-10.25'], '-10.25', 'closing'),
    ],
  };
  const singleSheet = (await load(single)).getWorksheet('Kunlik hisobot')!;
  equal(singleSheet.getCell('C6').value, 'Jami', 'Single day has exactly one date and a total');
  equal(singleSheet.getCell('B7').value, -10.25, 'Cents and negative signs survive XLSX roundtrip');
  equal(singleSheet.getCell('C8').result, 0, 'Empty activity caches zero, not an omitted result');
  equal(singleSheet.getCell('C9').formula, 'B9', 'Single-day closing references the same day');
  equal(singleSheet.getCell('B3').value, 130000.25, 'Pallet setting retains cents');

  const precision = { ...single, rows: [row('huge', 'Large canonical amount', 'settlement', 'plain', ['9999999999999999.99'], '9999999999999999.99')] };
  const exact = await load(precision);
  equal(exact.getWorksheet('Kunlik hisobot')!.getCell('B7').value, '9999999999999999.99', 'More than 15 significant digits is exact text, never rounded');
  equal(exact.getWorksheet('Kunlik hisobot')!.getCell('C7').value, '9999999999999999.99', 'Large total stays exact and is not SUM of text');
  ok(exact.getWorksheet('Izohlar')!.getSheetValues().flat(2).some((v) => typeof v === 'string' && v.includes('15 ahamiyatli')), 'Precision limitation is explicit');

  const nonSum = { ...single, rows: [row('canonical', 'Canonical server total', 'settlement', 'plain', ['10.00'], '9.99')] };
  const canonical = (await load(nonSum)).getWorksheet('Kunlik hisobot')!;
  equal(canonical.getCell('C7').value, 9.99, 'Renderer preserves server total even if SUM would change it');
  equal(canonical.getCell('C7').formula, undefined, 'No inconsistent recalculation formula is emitted');

  const manyDays = Array.from({ length: 3660 }, (_, index) => new Date(Date.UTC(2020, 0, 1 + index)).toISOString().slice(0, 10));
  const long = { ...single, from: manyDays[0], to: manyDays.at(-1)!, days: manyDays,
    rows: [row('long', 'Long range', 'settlement', 'plain', manyDays.map(() => '1.25'), '4575.00')] };
  const longSheet = (await load(long)).getWorksheet('Kunlik hisobot')!;
  equal(longSheet.getCell(6, 3662).value, 'Jami', 'Maximum supported long range stays inside Excel column limits');
  equal(longSheet.getCell(7, 3662).result, 4575, 'Wide matrix cached total is intact');
  equal(longSheet.getCell(7, 3661).value, 1.25, 'Last daily column is intact beyond two-letter Excel columns');
  equal(longSheet.pageSetup.fitToWidth, 0, 'Long ranges print across readable pages, not as one tiny page');

  await assert.rejects(dailyReportWorkbook({ ...single, rows: [{ ...single.rows[0], values: [] }] }), /ustunlari mos emas/);
  await assert.rejects(dailyReportWorkbook({ ...single, rows: [row('bad', 'Bad number', 'settlement', 'plain', ['=1+1'], '0.00')] }), /yaroqsiz son/);
  await assert.rejects(dailyReportWorkbook({ ...single, days: ['2026-02-30'] }), /kuni yaroqsiz/);
  checks += 3;
  console.log(`Daily report Excel: ${checks} checks passed`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
