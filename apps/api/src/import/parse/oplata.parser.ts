import { Prisma } from '@prisma/client';
import { readDate, readMoney, readText } from './cells';
import { SHEET, WorkbookReader } from './workbook.reader';
import type { ClientPaymentRow } from './types';

const hasMoney = (d: Prisma.Decimal | null): boolean => d !== null && !d.isZero();

// «Оплата» columns (1-indexed). Header on row 4; data starts on row 5.
const C = {
  date: 1, agent: 2, client: 3, transfer: 4, payer: 5, cash: 6,
  click: 12, terminal: 13, usd: 14, rate: 15, sumCol: 16, other: 17, total: 18,
  receiver: 19, note: 20,
} as const;

const DATA_START = 5;

export function parseOplata(wb: WorkbookReader): ClientPaymentRow[] {
  const ws = wb.worksheet(SHEET.clientPayments);
  const last = wb.lastRow(ws);
  const rows: ClientPaymentRow[] = [];

  for (let r = DATA_START; r <= last; r++) {
    const client = readText(wb.cell(ws, r, C.client));
    const transfer = readMoney(wb.cell(ws, r, C.transfer)).value;
    const total = readMoney(wb.cell(ws, r, C.total)).value;
    // Оплата's table (Таблица15) runs to row 1049 with a SUM formula in EVERY row —
    // empty rows evaluate to 0 (not null). Skip on: no client AND no money.
    if (!client && !hasMoney(transfer) && !hasMoney(total)) continue;

    rows.push({
      origin: { sheetName: ws.name, excelRow: r },
      date: readDate(wb.cell(ws, r, C.date)),
      agentRaw: readText(wb.cell(ws, r, C.agent)),
      clientRaw: client,
      transfer,
      payer: readText(wb.cell(ws, r, C.payer)),
      cash: readMoney(wb.cell(ws, r, C.cash)).value,
      click: readMoney(wb.cell(ws, r, C.click)).value,
      terminal: readMoney(wb.cell(ws, r, C.terminal)).value,
      usd: readMoney(wb.cell(ws, r, C.usd)).value,
      rate: readMoney(wb.cell(ws, r, C.rate)).value,
      sumCol: readMoney(wb.cell(ws, r, C.sumCol)).value,
      other: readMoney(wb.cell(ws, r, C.other)).value,
      total,
      receiver: readText(wb.cell(ws, r, C.receiver)),
      note: readText(wb.cell(ws, r, C.note)),
    });
  }
  return rows;
}
