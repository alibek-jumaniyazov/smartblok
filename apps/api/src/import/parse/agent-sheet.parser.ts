import { readDate, readInt, readMoney, readText } from './cells';
import { WorkbookReader } from './workbook.reader';
import type { AgentLedger, ClientPaymentRow, LedgerClientBlock, LedgerDelivery } from './types';

/**
 * Agent account sheets. Tab name = agent name. The body is a stack of CLIENT BLOCKS:
 *
 *   «4-Рустам Шпик»                ← header: {agentNo}-{clientName} (col A..E, often merged)
 *   ID-Клиента … (2-3 header rows, sometimes a digit index row " |1|2|3|4|9|10|…")
 *   A № | B Дата | C Сумма | D Примечание | E Возврат паддон   ← payments (left)
 *   F № | G Дата | H Авто | I Размер | J Куб | K Поддон | L От | M Сумма ← deliveries (right)
 *   … data rows (left and right sides are INDEPENDENT lists sharing rows) …
 *   SUBTOTAL row (no № in A nor F) — ends the block
 *
 * Deliveries are reconciliation-only (the journal is the ledger truth); payments are
 * the ONLY source of client payments in this template.
 */

// left (payments) columns
const P = { no: 1, date: 2, amount: 3, payer: 4, palletReturn: 5 } as const;
// right (deliveries) columns
const G = { no: 6, date: 7, truck: 8, size: 9, cube: 10, palletQty: 11, price: 12, total: 13 } as const;

// «N-Name» with any common dash; prefix ≤3 digits (an agent daftar number, not a year)
const HEADER_RE = /^(\d{1,3})\s*[-–—]\s*(.+)$/;

/** Block header CELL test: «N-Name» where Name contains a letter and the cell isn't a date. */
function blockHeader(text: string): { agentNo: number; client: string } | null {
  const t = text.trim();
  if (!t || /^\d{4}-\d{2}-\d{2}/.test(t)) return null; // ISO date rendered by readText
  const m = HEADER_RE.exec(t);
  if (!m || !/\p{L}/u.test(m[2])) return null;
  return { agentNo: Number(m[1]), client: m[2].trim() };
}

/**
 * A header-looking cell only STARTS a block when the block's own header rows follow —
 * «ID-Клиента» or the «№ | Дата» pair within the next 6 rows. Ordinary data text like
 * a payer «25-мактаб» in the Примечание column never has that shape below it.
 */
function confirmedHeaderAt(wb: WorkbookReader, ws: ReturnType<WorkbookReader['worksheet']>, r: number, last: number): boolean {
  for (let rr = r + 1; rr <= Math.min(r + 6, last); rr++) {
    for (let c = 1; c <= 6; c++) {
      const t = readText(wb.cell(ws, rr, c));
      if (/^id[-\s]?клиента$/i.test(t)) return true;
      if (t === '№' && readText(wb.cell(ws, rr, c + 1)).toLowerCase().startsWith('дата')) return true;
    }
  }
  return false;
}

export function parseAgentSheet(wb: WorkbookReader, sheetName: string): AgentLedger {
  const ws = wb.worksheet(sheetName);
  const last = wb.lastRow(ws);

  // 1) locate every block header row (first matching cell in cols A..F wins), with
  //    a shape confirmation so payer/date text can't spawn phantom clients
  const headers: Array<{ row: number; agentNo: number; client: string }> = [];
  for (let r = 1; r <= last; r++) {
    for (let c = 1; c <= 6; c++) {
      const h = blockHeader(readText(wb.cell(ws, r, c)));
      if (h) {
        if (confirmedHeaderAt(wb, ws, r, last)) headers.push({ row: r, agentNo: h.agentNo, client: h.client });
        break;
      }
    }
  }

  // 2) read each block's rows up to the next header
  const clients: LedgerClientBlock[] = [];
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    const end = i + 1 < headers.length ? headers[i + 1].row - 1 : last;
    const payments: ClientPaymentRow[] = [];
    const deliveries: LedgerDelivery[] = [];

    for (let r = h.row + 1; r <= end; r++) {
      // left side: a payment normally carries a numeric № in A; a row the owner appended
      // WITHOUT a № still counts when it has BOTH a real date and an amount (the header /
      // digit-index / SUBTOTAL rows never do — their date cell is text or empty)
      const pNo = readInt(wb.cell(ws, r, P.no));
      const pDate = readDate(wb.cell(ws, r, P.date));
      const pAmount = readMoney(wb.cell(ws, r, P.amount)).value;
      const pReturn = readInt(wb.cell(ws, r, P.palletReturn));
      const isPayment = pNo !== null ? (pDate || pAmount || pReturn) : (pDate && pAmount);
      if (isPayment) {
        payments.push({
          origin: { sheetName: ws.name, excelRow: r },
          no: pNo,
          date: pDate,
          agentRaw: ws.name.trim(),
          agentNo: h.agentNo,
          clientRaw: h.client,
          total: pAmount,
          payer: readText(wb.cell(ws, r, P.payer)),
          palletReturn: pReturn,
          note: '',
        });
      }

      // right side: a delivery needs a numeric № in F, a date in G, and real cargo shape
      // (a cube or a truck) — otherwise stray numeric pairs (e.g. an ID-Клиента balance
      // that happens to land in the date-serial window) would fabricate deliveries
      const dNo = readInt(wb.cell(ws, r, G.no));
      if (dNo !== null) {
        const date = readDate(wb.cell(ws, r, G.date));
        const truck = readText(wb.cell(ws, r, G.truck));
        const cube = readMoney(wb.cell(ws, r, G.cube)).value?.toNumber() ?? null;
        if (date && (cube !== null || truck)) {
          deliveries.push({
            origin: { sheetName: ws.name, excelRow: r },
            refNo: dNo,
            date,
            truck,
            size: readText(wb.cell(ws, r, G.size)),
            cube,
            palletQty: readInt(wb.cell(ws, r, G.palletQty)),
            price: readMoney(wb.cell(ws, r, G.price)).value,
            total: readMoney(wb.cell(ws, r, G.total)).value,
          });
        }
      }
    }

    clients.push({
      origin: { sheetName: ws.name, excelRow: h.row },
      agentNo: h.agentNo,
      clientRaw: h.client,
      payments,
      deliveries,
    });
  }

  return { sheetName: ws.name, agentName: ws.name.trim(), clients };
}

/** All agent daftars: every non-journal sheet that actually contains client blocks —
 *  stray sheets (notes, leftovers, an empty «Лист2») are not agents. */
export function parseAgentSheets(wb: WorkbookReader): AgentLedger[] {
  return wb.agentSheetNames()
    .map((n) => parseAgentSheet(wb, n))
    .filter((l) => l.clients.length > 0);
}
