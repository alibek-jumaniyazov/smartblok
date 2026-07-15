import { readInt, readMoney, readText } from './cells';
import { WorkbookReader } from './workbook.reader';
import type { ClientSheet } from './types';

/**
 * Read one per-client account sheet's TOTALS. These totals are used only for
 * reconciliation/preview — never as ledger truth (the ledger is rebuilt from
 * «Товар» + «Оплата»). Cell map is taken from «Свод Завод», which references
 * these exact cells: C5 payments, M5 goods, K5 pallets-delivered, E5 returned,
 * F2 balance, D1 name, I1 «Клент шопрга барди».
 */
export function parseClientSheet(wb: WorkbookReader, sheetName: string): ClientSheet {
  const ws = wb.worksheet(sheetName);
  const title = ws.name;
  const m = /^(\d+)\s*-/.exec(title.trim());

  return {
    origin: { sheetName: ws.name, excelRow: 1 },
    sheetTitle: title,
    agentNo: m ? Number(m[1]) : null,
    displayName: readText(wb.cell(ws, 1, 4)), // D1
    payTotal: readMoney(wb.cell(ws, 5, 3)).value, // C5
    goodsTotal: readMoney(wb.cell(ws, 5, 13)).value, // M5
    palletsDelivered: readInt(wb.cell(ws, 5, 11)), // K5
    palletsReturned: readInt(wb.cell(ws, 5, 5)), // E5
    balance: readMoney(wb.cell(ws, 2, 6)).value, // F2
    shoprGaBardi: readMoney(wb.cell(ws, 1, 9)).value, // I1
  };
}

export function parseAllClientSheets(wb: WorkbookReader): ClientSheet[] {
  return wb.clientSheetNames().map((n) => parseClientSheet(wb, n));
}
