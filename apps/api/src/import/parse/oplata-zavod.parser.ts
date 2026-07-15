import { readDate, readMoney, readText } from './cells';
import { SHEET, WorkbookReader } from './workbook.reader';
import type { FactoryPaymentRow } from './types';

// «Оплата Завод» columns (1-indexed). Header on row 2; data starts on row 3.
const C = { date: 1, amount: 2, payer: 3, receiver: 4 } as const;
const DATA_START = 3;

export function parseOplataZavod(wb: WorkbookReader): FactoryPaymentRow[] {
  const ws = wb.worksheet(SHEET.factoryPayments);
  const last = wb.lastRow(ws);
  const rows: FactoryPaymentRow[] = [];

  for (let r = DATA_START; r <= last; r++) {
    const amount = readMoney(wb.cell(ws, r, C.amount)).value;
    if (amount === null) continue; // trailing blank rows

    rows.push({
      origin: { sheetName: ws.name, excelRow: r },
      date: readDate(wb.cell(ws, r, C.date)),
      amount,
      payer: readText(wb.cell(ws, r, C.payer)),
      receiver: readText(wb.cell(ws, r, C.receiver)),
    });
  }
  return rows;
}
