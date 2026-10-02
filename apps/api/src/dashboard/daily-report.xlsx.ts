import ExcelJS from 'exceljs';
import { Prisma } from '@prisma/client';
import type { DailyReport, DailyReportRow } from './daily-report.types';

const NAVY = '203B60';
const BORDER = 'A8B8C6';
const FILLS: Record<DailyReportRow['tone'], string> = {
  green: 'DDF0D2', blue: 'C9EDF7', peach: 'FCE4D6',
  yellow: 'FFF200', plain: 'FFFFFF', total: 'DDEBF7',
};
const MONEY = '#,##0.00;[Red]-#,##0.00;"—"';
const QUANTITY = '#,##0;[Red]-#,##0;"—"';
const DATE = 'dd.mm.yyyy';

/** A decimal too precise for Excel stays exact text rather than silently losing cents. */
function excelNumber(value: string): number | string {
  if (!/^-?\d+(?:\.\d+)?$/.test(value)) throw new Error('Kunlik hisobotda yaroqsiz son mavjud');
  const decimal = new Prisma.Decimal(value);
  const numeric = Number(value);
  return decimal.precision() <= 15 && Number.isFinite(numeric) && new Prisma.Decimal(numeric.toString()).eq(decimal)
    ? numeric : value;
}

function displayedDate(value: string): string {
  const [year, month, day] = value.split('-');
  return `${day}.${month}.${year}`;
}

function generatedDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('Hisobot yaratilgan sana yaroqsiz');
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tashkent', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).format(date).replaceAll('/', '.');
}

/** Exports the calculated API cells; the workbook never queries or recalculates business data. */
export async function dailyReportWorkbook(report: DailyReport): Promise<Buffer> {
  if (!report.days.length || report.days.length > 16382 || report.rows.some((row) => row.values.length !== report.days.length)) {
    throw new Error('Kunlik hisobot ustunlari mos emas');
  }
  const generatedAt = new Date(report.generatedAt);
  const book = new ExcelJS.Workbook();
  book.creator = 'Smartblok';
  book.title = `Kunlik hisobot ${report.from} — ${report.to}`;
  book.subject = 'Zavod bilan hisob-kitob, poddonlar va tovar narxlari farqi';
  book.created = generatedAt;
  book.modified = generatedAt;
  book.calcProperties = { fullCalcOnLoad: true };
  const sheet = book.addWorksheet('Kunlik hisobot', { properties: { defaultRowHeight: 22 } });
  const headerRow = 6;
  const lastColumn = report.days.length + 2;
  const metadataWidth = Math.min(lastColumn, 8);
  sheet.getColumn(1).width = 43;
  for (let column = 2; column <= lastColumn; column++) sheet.getColumn(column).width = 20;
  sheet.getColumn(lastColumn).width = 23;
  sheet.views = [{ state: 'frozen', xSplit: 1, ySplit: headerRow, topLeftCell: 'B7', showGridLines: false }];

  const mergedText = (row: number, text: string, height = 25) => {
    sheet.mergeCells(row, 1, row, metadataWidth);
    const cell = sheet.getCell(row, 1);
    cell.value = text;
    cell.font = { name: 'Calibri', size: 11, color: { argb: NAVY } };
    cell.alignment = { vertical: 'middle', wrapText: true };
    sheet.getRow(row).height = height;
    return cell;
  };
  mergedText(1, 'SMARTBLOK · Kunlik hisob-kitob', 30).font = { name: 'Calibri', size: 17, bold: true, color: { argb: NAVY } };
  mergedText(2, `Davr: ${displayedDate(report.from)} — ${displayedDate(report.to)} (${report.days.length} kun)`);
  sheet.getCell('A3').value = "Poddon joriy narxi (so‘m)";
  sheet.getCell('A3').font = { name: 'Calibri', size: 11, color: { argb: NAVY } };
  sheet.getCell('B3').value = excelNumber(report.palletUnitPrice);
  sheet.getCell('B3').numFmt = MONEY;
  sheet.getCell('B3').font = { name: 'Calibri', size: 11, bold: true, color: { argb: NAVY } };
  sheet.getCell('B3').alignment = { horizontal: 'right' };
  mergedText(4, `Yaratildi: ${generatedDate(report.generatedAt)} (Toshkent vaqti)`);
  sheet.getRow(5).height = 7;

  const header = sheet.getRow(headerRow);
  header.height = 27;
  header.getCell(1).value = 'Gazoblok';
  report.days.forEach((day, index) => {
    const parsed = new Date(`${day}T00:00:00.000Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) throw new Error('Hisobot kuni yaroqsiz');
    const cell = header.getCell(index + 2);
    cell.value = parsed;
    cell.numFmt = DATE;
  });
  header.getCell(lastColumn).value = 'Jami';
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFF' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = { top: { style: 'thin', color: { argb: NAVY } }, bottom: { style: 'thin', color: { argb: NAVY } },
      left: { style: 'thin', color: { argb: BORDER } }, right: { style: 'thin', color: { argb: BORDER } } };
  });

  let nextRow = headerRow + 1;
  let previousSection: DailyReportRow['section'] | undefined;
  let exactTextCells = typeof sheet.getCell('B3').value === 'string' ? 1 : 0;
  for (const row of report.rows) {
    if (previousSection && previousSection !== row.section) sheet.getRow(nextRow++).height = 10;
    previousSection = row.section;
    const rowNumber = nextRow++;
    const output = sheet.getRow(rowNumber);
    output.height = row.label.length > 42 ? 34 : 23;
    output.getCell(1).value = row.label;
    const numbers = row.values.map(excelNumber);
    numbers.forEach((value, index) => { output.getCell(index + 2).value = value; });
    const total = excelNumber(row.total);
    const totalCell = output.getCell(lastColumn);
    totalCell.value = total;

    // Cached formulas keep Excel interactive, but only when recalculation preserves the API value.
    if (typeof total === 'number' && numbers.every((value) => typeof value === 'number')) {
      const firstAddress = output.getCell(2).address;
      const lastAddress = output.getCell(lastColumn - 1).address;
      const expected = row.totalMode === 'sum'
        ? row.values.reduce((sum, value) => sum.plus(value), new Prisma.Decimal(0))
        : new Prisma.Decimal(row.values[row.totalMode === 'opening' ? 0 : row.values.length - 1]);
      if (expected.eq(row.total)) {
        totalCell.value = {
          formula: row.totalMode === 'sum'
            ? `ROUND(SUM(${firstAddress}:${lastAddress}),${row.unit === 'money' ? 2 : 0})`
            : row.totalMode === 'opening' ? firstAddress : lastAddress,
          result: total,
        };
      }
    }
    exactTextCells += numbers.filter((value) => typeof value === 'string').length + (typeof total === 'string' ? 1 : 0);
    for (let column = 1; column <= lastColumn; column++) {
      const cell = output.getCell(column);
      const isEmphasized = column === 1 || column === lastColumn || ['peach', 'yellow', 'total'].includes(row.tone);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILLS[row.tone] } };
      cell.font = { name: 'Calibri', size: 11, bold: isEmphasized, color: { argb: '172B42' } };
      cell.alignment = { horizontal: column === 1 ? 'left' : 'right', vertical: 'middle', wrapText: column === 1 };
      cell.border = {
        top: { style: 'thin', color: { argb: BORDER } }, bottom: { style: 'thin', color: { argb: BORDER } },
        left: { style: column === lastColumn ? 'medium' : 'thin', color: { argb: column === lastColumn ? NAVY : BORDER } },
        right: { style: 'thin', color: { argb: BORDER } },
      };
      if (column > 1) {
        cell.numFmt = row.unit === 'money' ? MONEY : QUANTITY;
        if (typeof cell.value === 'string') {
          cell.numFmt = '@';
          if (cell.value.startsWith('-')) cell.font = { ...cell.font, color: { argb: 'FF0000' } };
        }
      }
    }
  }

  const notices = [...report.warnings];
  if (exactTextCells) notices.push(`${exactTextCells} ta qiymat Excelning 15 ahamiyatli raqam chegarasidan katta. Aniqlikni saqlash uchun bu kataklar matn sifatida yozildi; ularning jami serverda hisoblangan aniq qiymatdir.`);
  const notes = book.addWorksheet('Izohlar', { properties: { defaultRowHeight: 26 } });
  notes.getColumn(1).width = 22;
  notes.getColumn(2).width = 130;
  notes.addRow(['Turi', 'Izoh']);
  notes.getRow(1).height = 28;
  notes.getRow(1).eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFF' } };
  });
  const noteRows: [string, string][] = [
    ['Hisobot davri', `${displayedDate(report.from)} — ${displayedDate(report.to)}. Barcha sanalar Toshkent vaqti.`],
    ['Jami ustuni', 'Harakatlar faqat tanlangan davr bo‘yicha yig‘iladi. Boshlang‘ich qoldiq — birinchi kun boshi, yakuniy qoldiq — oxirgi kun oxiri; kunlik qoldiqlar qo‘shilmaydi.'],
    ['Poddon bahosi', `Poddon qoldig‘i joriy ${report.palletUnitPrice} so‘m narxda baholangan. Bu tarixiy sanadagi narx ekanligini anglatmaydi.`],
    ['Narxlar farqi', 'Tovar narxlari farqi sof foyda emas. Bu ko‘rsatkich barcha operatsion xarajatlar, transport va soliqlar chegirilgan yakuniy natijani anglatmaydi.'],
    ...report.notes.map((note): [string, string] => ['Hisoblash qoidasi', note]),
    ...notices.map((warning): [string, string] => ['Diqqat', warning]),
  ];
  for (const [kind, message] of noteRows) {
    const row = notes.addRow([kind, message]);
    row.height = Math.max(30, Math.min(180, 17 * Math.ceil(message.length / 110)));
    row.eachCell((cell) => {
      cell.font = { name: 'Calibri', size: 11, color: { argb: kind === 'Diqqat' ? '9C2F18' : '172B42' } };
      cell.alignment = { vertical: 'top', wrapText: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: kind === 'Diqqat' ? 'FFF2CC' : 'F2F6FA' } };
    });
  }
  notes.views = [{ state: 'frozen', ySplit: 1, showGridLines: false }];
  notes.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    printTitlesRow: '1:1', margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } };

  mergedText(nextRow + 1, 'Hisoblash qoidalari va ma’lumot cheklovlari: «Izohlar» varag‘i.', 30);
  if (notices.length) {
    const noticeCell = mergedText(nextRow + 2, `${notices.length} ta muhim izoh mavjud. Natijalarni talqin qilishdan oldin «Izohlar» varag‘ini ko‘ring.`, 36);
    noticeCell.font = { ...noticeCell.font, bold: true, color: { argb: '9C2F18' } };
  }
  sheet.pageSetup = {
    orientation: 'landscape', paperSize: 9, fitToPage: true,
    fitToWidth: report.days.length <= 7 ? 1 : 0, fitToHeight: 1,
    printTitlesRow: `1:${headerRow}`, printTitlesColumn: 'A:A',
    printArea: `A1:${sheet.getCell(nextRow + (notices.length ? 2 : 1), lastColumn).address}`,
    margins: { left: 0.25, right: 0.25, top: 0.35, bottom: 0.35, header: 0.15, footer: 0.15 },
  };
  sheet.headerFooter = { oddFooter: '&LSmartblok · Kunlik hisobot&R&P / &N' };
  notes.headerFooter = { oddFooter: '&LSmartblok · Hisobot izohlari&R&P / &N' };
  return Buffer.from(await book.xlsx.writeBuffer());
}
