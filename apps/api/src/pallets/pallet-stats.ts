import { PalletTransactionType, Prisma } from '@prisma/client';

/**
 * ═══════════════════════════ PADDON STATISTIKASI ═══════════════════════════
 *
 * The pallet ledger has always known *everything* — how many pallets came off a
 * factory's truck, how many went out to a client, how many came back — but only
 * ever published the netted balance. This module opens the box: it decomposes the
 * same rows into the four figures the owner actually asks for
 *
 *     «zavoddan jami qancha oldik / qanchasini qaytardik / hozir qancha qarzmiz»
 *     «mijoz bizdan jami qancha oldi / qanchasini qaytardi / hozir qancha ushlab turibdi»
 *
 * without ever letting the decomposition drift from the balance the rest of the
 * app enforces (order caps, return caps, debts board, dashboard).
 *
 * ── Why this is not a trivial GROUP BY ────────────────────────────────────
 *
 * A REVERSAL row's `qty` is a SIGNED BALANCE DELTA, not a signed quantity of the
 * type it reverses. Cancel an order and the delivery reversal is −qty; roll back
 * an import and the reversal of a client RETURN is **+qty** (see
 * import-rollback.service.ts — «RETURNED_BY_CLIENT subtracts from the client →
 * reversal +qty»). Folding every REVERSAL into one bucket, or naively negating it,
 * therefore corrupts the gross figures: a rolled-back return would *increase*
 * «jami qaytargan» instead of erasing it.
 *
 * So each reversal is routed back to the bucket of the row it reverses
 * (`reversalOf.type`) and its sign is undone there:
 *
 *     bucket(rev) = reversalOf.type
 *     qty  (rev)  = reversalOf.type is a MINUS-side type ? −rev.qty : +rev.qty
 *
 * The owner's rule (2026-07-25) is SOF ye. NET: a cancelled order's pallets never
 * physically arrived, so they must not inflate «jami olingan».
 *
 * ── Why `balance` here can never disagree with PalletService ───────────────
 *
 * `balance` is NOT recomputed from the buckets. It is computed from the RAW type
 * sums with the exact same formula PalletService.combineClientSums /
 * combineFactorySums use, and `adjustment` is then derived as the RESIDUAL that
 * closes the arithmetic:
 *
 *     client:  adjustment = balance − received + returned + chargedLost
 *     factory: adjustment = balance − received + returned
 *
 * That makes two guarantees structural rather than hopeful: the number shown next
 * to «hozir qarzmiz» is byte-identical to the one every cap and board already
 * uses, AND the column arithmetic on screen always adds up — even if a future
 * pallet type, an orphan reversal, or a manual ADJUSTMENT shows up that this
 * module has never seen. Anything unrecognised lands in `adjustment` instead of
 * silently breaking the subtraction.
 */

/** Types that enter a balance formula with a MINUS sign — their reversals flip back. */
const MINUS_SIDE = new Set<string>([
  PalletTransactionType.RETURNED_BY_CLIENT,
  PalletTransactionType.RETURNED_TO_FACTORY,
  PalletTransactionType.CHARGED_LOST,
]);

export interface PalletPartyStats {
  /**
   * Pallets that physically moved TO this party's counterparty side, net of
   * cancellations. Client → «mijoz bizdan olgan» (DELIVERED_TO_CLIENT).
   * Factory → «biz zavoddan olgan» (RECEIVED_FROM_FACTORY).
   */
  received: number;
  /** Pallets handed back, net of cancellations (RETURNED_BY_CLIENT / RETURNED_TO_FACTORY). */
  returned: number;
  /** Client-only: pallets written off to money because the client lost them. Always 0 for a factory. */
  chargedLost: number;
  /** Client-only: UZS billed for those lost pallets, as a decimal string. '0' for a factory. */
  chargedLostAmount: string;
  /** Everything else that moves the balance — manual corrections and orphan reversals (signed). */
  adjustment: number;
  /** THE balance. Identical to PalletService.clientPalletBalance / factoryPalletBalance. */
  balance: number;
  /** How many ledger rows this party has (reversals included) — 0 means «never traded pallets». */
  movements: number;
  firstMovementAt: string | null;
  lastMovementAt: string | null;
  /** Last real (non-reversed) delivery/receipt date. */
  lastReceivedAt: string | null;
  /** Last real return date — «oxirgi marta qachon qaytargan». */
  lastReturnAt: string | null;
}

export const EMPTY_PALLET_STATS: PalletPartyStats = {
  received: 0,
  returned: 0,
  chargedLost: 0,
  chargedLostAmount: '0',
  adjustment: 0,
  balance: 0,
  movements: 0,
  firstMovementAt: null,
  lastMovementAt: null,
  lastReceivedAt: null,
  lastReturnAt: null,
};

/**
 * Did this party ever really trade pallets?
 *
 * NOT `movements > 0`. `movements` counts LEDGER ROWS, and a fully cancelled order
 * leaves two of them (the delivery plus its storno) that net to nothing — so a client
 * whose only pallet order was cancelled would read as «has history» and be shown an
 * all-zero breakdown. This asks the only question that matters: did any figure move?
 */
export function hasPalletHistory(s: PalletPartyStats): boolean {
  return (
    s.received !== 0 || s.returned !== 0 || s.chargedLost !== 0 || s.adjustment !== 0 || s.balance !== 0
  );
}

/** Company-wide roll-up shown on the Paddonlar cockpit and the dashboard. */
export interface PalletOverview {
  /** Zavodlar tomoni: jami olingan / qaytarilgan / hozir qarzmiz. */
  factory: Pick<PalletPartyStats, 'received' | 'returned' | 'adjustment' | 'balance'>;
  /** Mijozlar tomoni: jami berilgan / qaytargan / yo'qotgan / hozir ularda. */
  client: Pick<
    PalletPartyStats,
    'received' | 'returned' | 'chargedLost' | 'chargedLostAmount' | 'adjustment' | 'balance'
  >;
  /** Loose stock sitting with the dealer: taken back from clients, not yet sent on. */
  dealerInHand: number;
  /**
   * Conservation identity — what we owe the factories must equal what is out at
   * clients + what is in our yard + what was written off as lost. A non-zero
   * `drift` means a manual ADJUSTMENT broke the chain somewhere and the counts
   * no longer describe a physically possible situation.
   */
  drift: number;
}

/** One aggregate row as the SQL below returns it. */
export interface PalletStatsRow {
  party: string;
  rawType: string;
  bucket: string;
  rawQty: number;
  bucketQty: number;
  money: Prisma.Decimal | null;
  rowCount: number;
  firstAt: Date | null;
  lastAt: Date | null;
}

/**
 * Grouped aggregate over the whole pallet ledger for ONE side.
 *
 * Grouping by BOTH the raw type and the reversal-resolved bucket in a single pass
 * is what lets the caller derive the canonical balance (raw) and the gross
 * breakdown (bucket) from the same read — no chance of the two being computed
 * against different snapshots.
 *
 * `side` is a hard-coded column name, never user input.
 *
 * ── `window` (ixtiyoriy) ──
 * Berilsa, natija QOLDIQ emas — o'sha davrning DELTASI bo'ladi (`balance` = davr ichida
 * qarz qanchaga o'zgargani). Chaqiruvchi buni bilib turishi shart.
 *
 * Sana sharti ATAYLAB `COALESCE(src."date", pt."date")` — xom `pt."date"` EMAS. Paddon
 * stornosi ledger stornosidan farq qiladi: u original biznes sanasini emas, DEVOR SOATINI
 * oladi (pallets.service.ts, `date: new Date()`). Xom ustun bilan oynalansa, iyulda olingan
 * va avgustda bekor qilingan buyurtmaning poddoni iyul hisobotida «olingan» bo'lib qolar,
 * uni bekor qiluvchi qator esa avgustga tushib ketardi — ikkala oy ham noto'g'ri chiqardi.
 */
export function palletStatsSql(
  side: 'clientId' | 'factoryId',
  partyIds?: string[],
  window?: { gte: Date; lt: Date },
): Prisma.Sql {
  const column = side === 'clientId' ? Prisma.sql`pt."clientId"` : Prisma.sql`pt."factoryId"`;
  const narrow =
    partyIds && partyIds.length > 0 ? Prisma.sql`AND ${column} IN (${Prisma.join(partyIds)})` : Prisma.empty;
  const period = window
    ? Prisma.sql`AND COALESCE(src."date", pt."date") >= ${window.gte} AND COALESCE(src."date", pt."date") < ${window.lt}`
    : Prisma.empty;
  return Prisma.sql`
    SELECT
      ${column} AS party,
      pt."type"::text AS "rawType",
      CASE WHEN pt."type" = 'REVERSAL' THEN COALESCE(src."type"::text, 'REVERSAL') ELSE pt."type"::text END AS bucket,
      COALESCE(SUM(pt."qty"), 0)::int AS "rawQty",
      COALESCE(SUM(
        CASE
          WHEN pt."type" = 'REVERSAL'
           AND src."type" IN ('RETURNED_BY_CLIENT', 'RETURNED_TO_FACTORY', 'CHARGED_LOST')
          THEN -pt."qty"
          ELSE pt."qty"
        END
      ), 0)::int AS "bucketQty",
      COALESCE(SUM(
        CASE
          -- Undirishning stornosi PULNI ham qaytaradi (pallets.service reverseClientMovement:
          -- PALLET_CHARGE ledger qatori stornolanadi). Storno qatorining O'ZIDA narx YO'Q va
          -- ataylab yo'q — u bo'lsa bu yig'indi uni QO'SHIB, «yo'qotilgan paddon puli» ni ikki
          -- baravar qilardi. Shuning uchun summa ASL qatorning narxidan olinadi va AYIRILADI:
          -- soni (bucketQty) bilan puli bitta yo'nalishda harakatlanadi.
          WHEN pt."type" = 'REVERSAL' AND src."type" = 'CHARGED_LOST'
          THEN -(pt."qty" * COALESCE(src."unitPrice", 0))
          ELSE pt."qty" * COALESCE(pt."unitPrice", 0)
        END
      ), 0) AS money,
      COUNT(*)::int AS "rowCount",
      MIN(pt."date") AS "firstAt",
      MAX(pt."date") AS "lastAt"
    FROM "PalletTransaction" pt
    LEFT JOIN "PalletTransaction" src ON src."id" = pt."reversalOfId"
    WHERE ${column} IS NOT NULL ${narrow} ${period}
    GROUP BY 1, 2, 3`;
}

const iso = (d: Date | null | undefined): string | null => (d ? new Date(d).toISOString() : null);
const laterOf = (a: string | null, b: string | null): string | null =>
  a && b ? (a > b ? a : b) : (a ?? b);
const earlierOf = (a: string | null, b: string | null): string | null =>
  a && b ? (a < b ? a : b) : (a ?? b);

/**
 * Fold the SQL rows into per-party stats.
 *
 * `combineBalance` MUST be the very same function PalletService uses for that
 * side — that is the whole point of passing it in rather than re-deriving it here.
 */
export function foldPalletStats(
  rows: PalletStatsRow[],
  side: 'client' | 'factory',
  combineBalance: (sums: Partial<Record<PalletTransactionType, number>>) => number,
): Map<string, PalletPartyStats> {
  const receivedType =
    side === 'client'
      ? PalletTransactionType.DELIVERED_TO_CLIENT
      : PalletTransactionType.RECEIVED_FROM_FACTORY;
  const returnedType =
    side === 'client'
      ? PalletTransactionType.RETURNED_BY_CLIENT
      : PalletTransactionType.RETURNED_TO_FACTORY;

  interface Acc {
    raw: Partial<Record<PalletTransactionType, number>>;
    bucket: Record<string, number>;
    money: Prisma.Decimal;
    movements: number;
    firstMovementAt: string | null;
    lastMovementAt: string | null;
    lastReceivedAt: string | null;
    lastReturnAt: string | null;
  }
  const acc = new Map<string, Acc>();

  for (const r of rows) {
    if (!r.party) continue;
    let a = acc.get(r.party);
    if (!a) {
      a = {
        raw: {},
        bucket: {},
        money: new Prisma.Decimal(0),
        movements: 0,
        firstMovementAt: null,
        lastMovementAt: null,
        lastReceivedAt: null,
        lastReturnAt: null,
      };
      acc.set(r.party, a);
    }
    const rawType = r.rawType as PalletTransactionType;
    a.raw[rawType] = (a.raw[rawType] ?? 0) + Number(r.rawQty ?? 0);
    a.bucket[r.bucket] = (a.bucket[r.bucket] ?? 0) + Number(r.bucketQty ?? 0);
    a.movements += Number(r.rowCount ?? 0);

    const first = iso(r.firstAt);
    const last = iso(r.lastAt);
    a.firstMovementAt = earlierOf(a.firstMovementAt, first);
    a.lastMovementAt = laterOf(a.lastMovementAt, last);

    // «oxirgi harakat» dates describe REAL movements — a storno row is bookkeeping,
    // not a truck arriving, so it must not masquerade as the last delivery/return.
    if (rawType === receivedType) a.lastReceivedAt = laterOf(a.lastReceivedAt, last);
    if (rawType === returnedType) a.lastReturnAt = laterOf(a.lastReturnAt, last);
    // BUCKET bo'yicha, xom tur bo'yicha EMAS. Undirish bekor qilinganda storno qatorining
    // xom turi REVERSAL, biznes ma'nosi esa CHARGED_LOST — xom tur bilan tekshirilganda
    // uning manfiy summasi bu yerga umuman yetib kelmasdi va «yo'qotilgan: 0 dona
    // (2 600 000 so'm)» degan yolg'on qolardi.
    if (r.bucket === PalletTransactionType.CHARGED_LOST) {
      a.money = a.money.plus(r.money ?? 0);
    }
  }

  const out = new Map<string, PalletPartyStats>();
  for (const [party, a] of acc) {
    const balance = combineBalance(a.raw);
    const received = a.bucket[receivedType] ?? 0;
    const returned = a.bucket[returnedType] ?? 0;
    const chargedLost = side === 'client' ? (a.bucket[PalletTransactionType.CHARGED_LOST] ?? 0) : 0;
    // residual — see the header: this is what keeps the on-screen subtraction exact
    // no matter what else is in the ledger.
    const adjustment = balance - received + returned + chargedLost;
    out.set(party, {
      received,
      returned,
      chargedLost,
      chargedLostAmount: a.money.toFixed(2),
      adjustment,
      balance,
      movements: a.movements,
      firstMovementAt: a.firstMovementAt,
      lastMovementAt: a.lastMovementAt,
      lastReceivedAt: a.lastReceivedAt,
      lastReturnAt: a.lastReturnAt,
    });
  }
  return out;
}

/** Sum a set of per-party stats into one company-wide column. */
export function sumPalletStats(all: Iterable<PalletPartyStats>): PalletPartyStats {
  const total = { ...EMPTY_PALLET_STATS };
  let money = new Prisma.Decimal(0);
  for (const s of all) {
    total.received += s.received;
    total.returned += s.returned;
    total.chargedLost += s.chargedLost;
    total.adjustment += s.adjustment;
    total.balance += s.balance;
    total.movements += s.movements;
    total.firstMovementAt = earlierOf(total.firstMovementAt, s.firstMovementAt);
    total.lastMovementAt = laterOf(total.lastMovementAt, s.lastMovementAt);
    total.lastReceivedAt = laterOf(total.lastReceivedAt, s.lastReceivedAt);
    total.lastReturnAt = laterOf(total.lastReturnAt, s.lastReturnAt);
    money = money.plus(s.chargedLostAmount || 0);
  }
  total.chargedLostAmount = money.toFixed(2);
  return total;
}

/** MINUS_SIDE is exported for tests that assert the reversal routing table stays honest. */
export const PALLET_MINUS_SIDE_TYPES = MINUS_SIDE;
