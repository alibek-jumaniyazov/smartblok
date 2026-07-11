import { Prisma } from '@prisma/client';
import * as XLSX from 'xlsx';
import { D, round2, ZERO } from '../common/money';

/**
 * Pure decoder for the owner's «Газоблок Счет.xlsx» workbook.
 * Column maps and self-validation targets come verbatim from
 * docs/audit/excel-spec.md §2–§6; nothing here touches the database.
 */

type Dec = Prisma.Decimal;

// ── normalization helpers ──

/** case/space-insensitive key for name matching across sheets */
export const normKey = (s: unknown): string =>
  String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

/**
 * Workbook dates carry a …T18:59:49Z artifact (≈ local midnight UTC+5).
 * Normalize to the LOCAL calendar day: add 5h, truncate, store as UTC midnight.
 */
export const normalizeWorkbookDate = (v: unknown): Date | null => {
  if (!(v instanceof Date) || isNaN(v.getTime())) return null;
  const shifted = new Date(v.getTime() + 5 * 3_600_000);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
};

const num = (v: unknown): number => (typeof v === 'number' && isFinite(v) ? v : 0);
const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s ? s : null;
};

// ── parsed row shapes ──

export type TransportKind = 'DEALER' | 'CLIENT_DIRECT' | 'NONE';

export interface TovarRow {
  excelRow: number;
  agentRaw: string;
  clientRaw: string;
  date: Date;
  plate: string;
  size: string;
  m3: Dec;
  costPricePerM3: Dec; // 6dp
  palletCount: number;
  palletPrice: Dec;
  salePricePerM3: Dec | null; // null ⇒ shipped before price agreed (pricePending)
  saleTotal: Dec; // round2(m³ × salePrice), 0 when pending
  costTotal: Dec; // round2(m³ × cost + pallets × palletPrice)
  transportKind: TransportKind; // numeric S / «клентдан» / blank-«Х»
  transportAmount: Dec; // numeric S only
  transportPaid: boolean; // U = «Туланди» or a date
  transportPaidDate: Date | null; // U when it is a date
}

export interface OplataChannel {
  method: 'BANK' | 'CASH' | 'CLICK' | 'TERMINAL' | 'USD' | 'OTHER';
  amount: Dec; // UZS value (usd × rate for USD)
  usdAmount: Dec;
  rate: Dec;
}

export interface OplataRow {
  excelRow: number;
  date: Date;
  agentRaw: string | null;
  clientRaw: string;
  payerRaw: string | null;
  receiverRaw: string | null; // string entity name or numeric card number as text
  receiverIsNumeric: boolean;
  note: string | null;
  channels: OplataChannel[];
  total: Dec;
}

export interface FactoryPaymentRow {
  excelRow: number;
  date: Date;
  amount: Dec;
  payerRaw: string | null; // Септем Алока → BANK, Нахт → CASH, Нахт пластика → CARD
  receiverRaw: string | null;
  receiverIsNumeric: boolean;
}

export interface SheetPayment {
  excelRow: number;
  date: Date | null;
  amount: Dec;
  noteRaw: string | null; // payer entity text, or «шопр учун барди»
  driverDirect: boolean;
}

export interface SheetGoodsRow {
  excelRow: number;
  date: Date | null;
  plate: string | null;
  size: string | null;
  m3: Dec;
  palletCount: number;
  pricePerM3: Dec;
  total: Dec; // round2(m³ × price)
}

export interface SheetPalletReturn {
  excelRow: number;
  date: Date | null;
  qty: number;
}

export interface ClientSheet {
  sheetName: string;
  canonicalName: string; // sheet name minus the numeric prefix — wins as canonical
  payments: SheetPayment[];
  goods: SheetGoodsRow[];
  palletReturns: SheetPalletReturn[];
  /** −F2 recomputed: Σ right-half round2(m³×price) − Σ left-half payments (incl. driver-direct) */
  expectedBalance: Dec;
  /** Σ right-half pallets − Σ returns */
  expectedPallets: number;
  driverDirectTotal: Dec;
}

export interface ValidationCheck {
  name: string;
  expected: string;
  actual: string;
  ok: boolean;
}

export interface ParsedWorkbook {
  tovar: TovarRow[];
  oplata: OplataRow[];
  factoryPayments: FactoryPaymentRow[];
  clientSheets: ClientSheet[];
  checks: ValidationCheck[];
  errors: string[];
  ok: boolean;
}

// ── self-validation targets (excel-spec.md §2–§4, row-2 subtotals) ──

const EXPECT = {
  blockCost: '992269250',
  palletMoney: '135200000',
  blockPlusPallet: '1127469250',
  saleTotal: '1249547319.36', // ±1 (float residue of back-solved prices)
  pallets: '1040',
  factoryPaid: '2101088520',
  oplataTotal: '1024066320',
};

export function parseWorkbook(buffer: Buffer): ParsedWorkbook {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const errors: string[] = [];
  const rowsOf = (name: string): unknown[][] => {
    const ws = wb.Sheets[name];
    if (!ws) {
      errors.push(`Лист топилмади: «${name}»`);
      return [];
    }
    return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null });
  };

  // ── Товар: data rows = client (D) non-empty AND m³ (H) > 0 ──
  const tovar: TovarRow[] = [];
  const tovarRows = rowsOf('Товар');
  for (let i = 0; i < tovarRows.length; i++) {
    const r = tovarRows[i] ?? [];
    const client = typeof r[3] === 'string' ? str(r[3]) : null;
    if (!client || !(typeof r[7] === 'number' && r[7] > 0)) continue;
    const excelRow = i + 1; // used range starts at A1
    const date = normalizeWorkbookDate(r[4]);
    if (!date) {
      errors.push(`Товар ${excelRow}-қатор: сана йўқ ёки нотўғри`);
      continue;
    }
    const m3 = D(r[7]);
    const costPricePerM3 = D(num(r[8])).toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP);
    const palletCount = Math.round(num(r[10]));
    const palletPrice = round2(num(r[11]));
    const saleRaw = num(r[14]);
    const salePricePerM3 = saleRaw > 0 ? D(saleRaw).toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP) : null;

    // transport S (idx 18): numeric ⇒ dealer pays driver; «клентдан» ⇒ client paid driver; Х/blank ⇒ none
    const sRaw = r[18];
    let transportKind: TransportKind = 'NONE';
    let transportAmount = ZERO;
    if (typeof sRaw === 'number' && sRaw > 0) {
      transportKind = 'DEALER';
      transportAmount = round2(sRaw);
    } else if (typeof sRaw === 'string' && normKey(sRaw).includes('клент')) {
      transportKind = 'CLIENT_DIRECT';
    }

    // transport-paid U (idx 20): «Туланди» or a date ⇒ paid
    const uRaw = r[20];
    const uDate = normalizeWorkbookDate(uRaw);
    const transportPaid = uDate !== null || (typeof uRaw === 'string' && normKey(uRaw).includes('туланди'));

    tovar.push({
      excelRow,
      agentRaw: str(r[2]) ?? '',
      clientRaw: client,
      date,
      plate: str(r[5]) ?? '—',
      size: str(r[6]) ?? '',
      m3,
      costPricePerM3,
      palletCount,
      palletPrice,
      salePricePerM3,
      saleTotal: salePricePerM3 ? round2(m3.times(salePricePerM3)) : ZERO,
      costTotal: round2(m3.times(costPricePerM3).plus(palletPrice.times(palletCount))),
      transportKind,
      transportAmount,
      transportPaid,
      transportPaidDate: uDate,
    });
  }

  // ── Оплата: used range starts at Excel row 3 ⇒ index 0 = subtotal, 1 = header, data from 2 ──
  const oplata: OplataRow[] = [];
  const oplRows = rowsOf('Оплата');
  for (let i = 2; i < oplRows.length; i++) {
    const r = oplRows[i] ?? [];
    const bank = num(r[3]);
    const cash = num(r[5]);
    const click = num(r[11]);
    const terminal = num(r[12]);
    const usd = num(r[13]);
    const rate = num(r[14]);
    const other = num(r[16]);
    const usdValue = round2(D(usd).times(D(rate)));
    const total = round2(D(bank).plus(cash).plus(click).plus(terminal).plus(other).plus(usdValue));
    if (total.isZero()) continue;
    const excelRow = i + 3; // used range offset (A3)
    const client = str(r[2]);
    const date = normalizeWorkbookDate(r[0]);
    if (!client || !date) {
      errors.push(`Оплата ${excelRow}-қатор: мижоз ёки сана йўқ`);
      continue;
    }
    const channels: OplataChannel[] = [];
    const push = (method: OplataChannel['method'], amount: Dec, usdAmount = ZERO, r8 = ZERO) => {
      if (!amount.isZero()) channels.push({ method, amount: round2(amount), usdAmount, rate: r8 });
    };
    push('BANK', D(bank));
    push('CASH', D(cash));
    push('CLICK', D(click));
    push('TERMINAL', D(terminal));
    if (usd > 0 && rate > 0) push('USD', usdValue, D(usd), D(rate));
    push('OTHER', D(other));

    const receiverStr = str(r[18]);
    oplata.push({
      excelRow,
      date,
      agentRaw: str(r[1]),
      clientRaw: client,
      payerRaw: str(r[4]),
      receiverRaw: receiverStr,
      receiverIsNumeric: typeof r[18] === 'number',
      note: str(r[19]),
      channels,
      total,
    });
  }

  // ── Оплата Завод: headers at Excel row 2, data from row 3 (index 2) ──
  const factoryPayments: FactoryPaymentRow[] = [];
  const ozRows = rowsOf('Оплата Завод');
  for (let i = 2; i < ozRows.length; i++) {
    const r = ozRows[i] ?? [];
    const amount = num(r[1]);
    if (amount === 0) continue;
    const excelRow = i + 1;
    const date = normalizeWorkbookDate(r[0]);
    if (!date) {
      errors.push(`Оплата Завод ${excelRow}-қатор: сана йўқ`);
      continue;
    }
    factoryPayments.push({
      excelRow,
      date,
      amount: round2(amount),
      payerRaw: str(r[2]),
      receiverRaw: str(r[3]),
      receiverIsNumeric: typeof r[3] === 'number',
    });
  }

  // ── client sheets: /^\d+-/ except «0»; ledger rows 7..49 (0-based 6..48) ──
  const clientSheets: ClientSheet[] = [];
  for (const sheetName of wb.SheetNames.filter((n) => /^\d+-/.test(n))) {
    const rows = rowsOf(sheetName);
    const canonicalName = sheetName.replace(/^\d+-/, '').trim();
    const payments: SheetPayment[] = [];
    const goods: SheetGoodsRow[] = [];
    const palletReturns: SheetPalletReturn[] = [];
    for (let i = 6; i <= 48 && i < rows.length; i++) {
      const r = rows[i] ?? [];
      const excelRow = i + 1;
      // left half: 1 date, 2 amount, 3 note, 4 pallet return
      if (typeof r[2] === 'number' && r[2] > 0) {
        const noteRaw = str(r[3]);
        payments.push({
          excelRow,
          date: normalizeWorkbookDate(r[1]),
          amount: round2(r[2]),
          noteRaw,
          driverDirect: normKey(noteRaw).includes('шопр'),
        });
      }
      if (typeof r[4] === 'number' && r[4] > 0) {
        palletReturns.push({ excelRow, date: normalizeWorkbookDate(r[1]), qty: Math.round(r[4]) });
      }
      // right half: 6 date, 7 plate, 8 size, 9 m³, 10 pallets, 11 price, 12 total
      if (typeof r[9] === 'number' && r[9] > 0) {
        const m3 = D(r[9]);
        const price = D(num(r[11]));
        goods.push({
          excelRow,
          date: normalizeWorkbookDate(r[6]),
          plate: str(r[7]),
          size: str(r[8]),
          m3,
          palletCount: Math.round(num(r[10])),
          pricePerM3: price,
          total: round2(m3.times(price)),
        });
      }
    }
    const paySum = payments.reduce((a, p) => a.plus(p.amount), ZERO);
    const goodsSum = goods.reduce((a, g) => a.plus(g.total), ZERO);
    const returnSum = palletReturns.reduce((a, p) => a + p.qty, 0);
    clientSheets.push({
      sheetName,
      canonicalName,
      payments,
      goods,
      palletReturns,
      expectedBalance: goodsSum.minus(paySum),
      expectedPallets: goods.reduce((a, g) => a + g.palletCount, 0) - returnSum,
      driverDirectTotal: payments.filter((p) => p.driverDirect).reduce((a, p) => a.plus(p.amount), ZERO),
    });
  }

  // ── self-validation (§2–§4 grand totals) ──
  const checks: ValidationCheck[] = [];
  const check = (name: string, actual: Dec, expected: string, tolerance = 0) => {
    const ok = actual.minus(D(expected)).abs().lte(tolerance);
    checks.push({ name, expected, actual: actual.toFixed(2), ok });
  };
  const dsum = (vals: Dec[]) => vals.reduce((a, v) => a.plus(v), ZERO);

  check('Товар: Σ блок таннархи (m³×нарх)', dsum(tovar.map((t) => round2(t.m3.times(t.costPricePerM3)))), EXPECT.blockCost);
  check('Товар: Σ паддон пули', dsum(tovar.map((t) => t.palletPrice.times(t.palletCount))), EXPECT.palletMoney);
  check('Товар: Σ блок+паддон', dsum(tovar.map((t) => t.costTotal)), EXPECT.blockPlusPallet);
  check('Товар: Σ сотув суммаси', dsum(tovar.map((t) => t.saleTotal)), EXPECT.saleTotal, 1);
  check('Товар: Σ паддонлар сони', D(tovar.reduce((a, t) => a + t.palletCount, 0)), EXPECT.pallets);
  check('Оплата Завод: Σ', dsum(factoryPayments.map((f) => f.amount)), EXPECT.factoryPaid);
  check('Оплата: Σ қатор суммалари', dsum(oplata.map((o) => o.total)), EXPECT.oplataTotal);

  return {
    tovar,
    oplata,
    factoryPayments,
    clientSheets,
    checks,
    errors,
    ok: errors.length === 0 && checks.every((c) => c.ok),
  };
}
