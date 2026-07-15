import { readDate, readInt, readMoney, readNumber, readText } from './cells';
import { SHEET, WorkbookReader } from './workbook.reader';
import type { ShipmentRow } from './types';

// «Товар» columns (1-indexed). Header is on row 3; data starts on row 4.
const C = {
  no: 1, supplier: 2, agent: 3, client: 4, date: 5, truck: 6, size: 7, cube: 8,
  costPrice: 9, costSum: 10, palletQty: 11, palletPrice: 12, palletSum: 13,
  purchTotal: 14, salePrice: 15, diff: 16, izoh: 17, saleSum: 18, transport: 19,
  profit: 20, autoPaid: 21,
} as const;

const DATA_START = 4;

/** Parse every real shipment line of «Товар». A row counts as data if it carries a
 *  size or a cube — this KEEPS the 8 rows whose client cell is blank (they are real
 *  trucks the owner must name; dropping them would silently unbalance the factory ledger). */
export function parseTovar(wb: WorkbookReader): ShipmentRow[] {
  const ws = wb.worksheet(SHEET.goods);
  const last = wb.lastRow(ws);
  const rows: ShipmentRow[] = [];

  for (let r = DATA_START; r <= last; r++) {
    const size = readText(wb.cell(ws, r, C.size));
    const cube = readNumber(wb.cell(ws, r, C.cube));
    if (!size && cube === null) continue; // truly empty row

    const s = wb.cell(ws, r, C.transport);
    const money = readMoney(s);

    rows.push({
      origin: { sheetName: ws.name, excelRow: r },
      no: readInt(wb.cell(ws, r, C.no)),
      supplier: readText(wb.cell(ws, r, C.supplier)),
      agentRaw: readText(wb.cell(ws, r, C.agent)),
      clientRaw: readText(wb.cell(ws, r, C.client)),
      date: readDate(wb.cell(ws, r, C.date)),
      truck: readText(wb.cell(ws, r, C.truck)),
      size,
      cube,
      costPrice: readMoney(wb.cell(ws, r, C.costPrice)).value,
      palletQty: readInt(wb.cell(ws, r, C.palletQty)),
      palletPrice: readMoney(wb.cell(ws, r, C.palletPrice)).value,
      salePrice: readMoney(wb.cell(ws, r, C.salePrice)).value,
      diff: readMoney(wb.cell(ws, r, C.diff)).value,
      saleSum: readMoney(wb.cell(ws, r, C.saleSum)).value,
      transport: money.value,
      transportWord: money.text,
      autoPaid: readText(wb.cell(ws, r, C.autoPaid)),
      izoh: readText(wb.cell(ws, r, C.izoh)),
    });
  }
  return rows;
}
