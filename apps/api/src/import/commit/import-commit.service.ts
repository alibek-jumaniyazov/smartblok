import { BadRequestException } from '@nestjs/common';
import {
  Prisma, PrismaClient, BonusProgramKind, BonusTransactionType, FactoryBucket, FactoryPayIntent,
  LedgerAccount, LedgerSource, OrderStatus, CostStatus, PriceKind,
  TransportMode, TransportPaidStatus, PaymentKind, PaymentMethod, PalletTransactionType,
  CashboxType, CashDirection, CashSource,
} from '@prisma/client';
import type { ShipmentRow, ClientPaymentRow, FactoryPaymentRow } from '../parse/types';
import { normalizePlate, normalizeSize } from '../resolve/entity-resolver';
import { findFleetVehicleByPlate, plateKey } from '../../common/plate';

const D = Prisma.Decimal;
type Tx = Prisma.TransactionClient;

/**
 * Pallet volume from a normalized «600x300x250» size. A standard pallet is 1.8 m³ for
 * ×250 blocks and 1.728 m³ for ×200; anything unrecognized keeps the schema default.
 * Used at import time so the order form's pallet↔m³ conversion is right from row one.
 */
function m3PerPalletForSize(size: string): Prisma.Decimal {
  const thickness = /x(\d{2,3})$/.exec(size)?.[1];
  return new D(thickness === '250' ? '1.8' : '1.728');
}

// ── payment channel classification («Примечание» / payer cell → PaymentMethod) ──
//
// The workbook records WHO paid and HOW in one free-text cell. Reading it is what puts the
// money in the right cashbox, and getting it wrong is invisible: the balance still adds up,
// it just adds up in the wrong box.
//
// Every pattern is TOKEN-ANCHORED. Un-anchored `/клик/` matched anywhere in the cell, so a
// firm called «Клика курилиш» would have banked its transfer in the Click wallet — the same
// shape of bug as the old «anything that isn't нахт is a transfer» rule that filed 188 mln of
// driver cash into the bank box. `\b` is ASCII-only and never fires on Cyrillic, which is why
// the old `/нал\b/` branch was dead code; TOKEN does the job for both alphabets.
//
// Order matters: DRIVER is tested FIRST because it is the most specific — «Шопир пули 5%»
// must not be read as a firm name. «Шовот»/«SHOVOT» is a PLACE inside firm names («Шовот
// темур битон хусусий корхонаси»), so the driver pattern must never match a bare «шов».
const TOKEN = (body: string) => new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:${body})(?![\\p{L}\\p{N}])`, 'iu');
const DRIVER_NOTE = TOKEN('шоп[иоы]?р\\p{L}*|шоф[йи]?[оёе]?р\\p{L}*|шовйор|shop[io]?r\\p{L}*|shof[yi]?or\\p{L}*|haydovchi|хайдовчи');
const CASH_NOTE = TOKEN('нахт|нақт|нақд|накд|naqd|naxt|нал|наличн\\p{L}*');
const CLICK_NOTE = TOKEN('клик|click');
const CARD_NOTE = TOKEN('пластик|plastik|карта|karta');
/** the owner's walk-in accounts — «6-Нахт клент Сардор», «2-Нахт клент Арслон» */
const CASH_BLOCK = TOKEN('нахт|нақт|нақд|накд|naqd|naxt');

/**
 * TRUE when this row is the client handing cash straight to the DRIVER at the truck
 * («шопр учун барди», «Клентни Ози Шовйор», «Шопир пули 5%»).
 *
 * Egasining qoidasi (2026-07-23): bu pul mijoz qo'lidan shofyor qo'liga o'tadi — BIZNING
 * kassamizga hech qachon kirmaydi. U mijozning qarzini kamaytiradi (daftar uni «Приход» deb
 * sanaydi) va o'sha mashinaning transport xarajatini yopadi, lekin kassada na kirim, na
 * chiqim bo'ladi.
 *
 * Proof this is what the cell means: per client, Σ of these rows equals that client's Σ «Расход
 * Авто» (col S) to the som on 14 of 32 clients and closely on the rest — 205 684 000 against
 * 324 700 002 of total transport. It is the truck fee, not a payment into the till.
 */
export function isDriverHandover(note: string): boolean {
  return DRIVER_NOTE.test((note ?? '').trim());
}

/**
 * Which cash channel a CLIENT payment row came through. «Клик» is the Click wallet; «Нахт» is
 * naqd; everything else in this template is a firm paying by transfer (the cell holds its
 * legal name). Driver rows are CASH by nature but never reach a cashbox — see isDriverHandover.
 *
 * `blockName` is the second, independent cash signal: the owner books his walk-in trade under
 * a client block literally named «Нахт клент …», so every row inside one is naqd even when the
 * «Примечание» cell only names a person. Relying on one free-text cell is what made the owner
 * say «Нахт uchun yozilgani aniq emas».
 */
export function clientPaymentMethod(note: string, blockName = ''): PaymentMethod {
  const t = (note ?? '').trim();
  if (DRIVER_NOTE.test(t)) return PaymentMethod.CASH;
  if (CLICK_NOTE.test(t)) return PaymentMethod.CLICK;
  if (CARD_NOTE.test(t)) return PaymentMethod.CARD;
  if (CASH_NOTE.test(t)) return PaymentMethod.CASH;
  if (CASH_BLOCK.test((blockName ?? '').trim())) return PaymentMethod.CASH;
  if (!t) return PaymentMethod.BANK;
  return PaymentMethod.BANK;
}

/** «bank» ustunidagi so'zlar — o'tkazma oilasi (ADVANCE_BANK cho'ntagi). */
const BANK_NOTE = TOKEN("bank|банк|otkazma|o'tkazma|oʼtkazma|утказма|ўтказма|перечислен\\p{L}*|transfer");

/**
 * Which channel a FACTORY settlement came through, read from the «Утказилган пул» block's
 * OWN channel column («bank» · «naxt» · «click»). Until 2026-07-27 that column did not
 * exist and every so'm was booked as a bank transfer; the owner then started recording the
 * channel per row, and it is the single cell that decides which kassa the money left and
 * whether the advance stands in the naqd or the o'tkazma pocket.
 *
 * The SAME token-anchored constants as the client side are reused so both alphabets and all
 * of the owner's spellings stay consistent between the two paths.
 *
 * '' (the legacy 2-column file, or a cell he left blank) ⇒ BANK — the historical default and
 * his original instruction for this block.
 * A word that matches nothing ⇒ null: the caller must REFUSE, never guess. A mis-filed
 * channel is unrecoverable by inspection afterwards — every total still reconciles to the
 * som, only the pocket and the kassa are silently wrong.
 */
export function classifyFactoryChannel(channel: string): PaymentMethod | null {
  const t = (channel ?? '').trim();
  if (!t) return PaymentMethod.BANK;
  // CLICK before CASH: CASH_NOTE already matches «naxt», and «click» must not fall through
  if (CLICK_NOTE.test(t)) return PaymentMethod.CLICK;
  if (CARD_NOTE.test(t)) return PaymentMethod.CARD;
  if (CASH_NOTE.test(t)) return PaymentMethod.CASH;
  if (BANK_NOTE.test(t)) return PaymentMethod.BANK;
  return null; // unrecognised — ZAVOD_KANALI_NOMALUM blocks it at review time
}

/**
 * Which channel a JOURNAL ROW is settled through, read from «Лист1» col X «тўлов тури»
 * («Банк» / «Нахт»). New on 2026-07-29 — before it, every imported truck was hardcoded to
 * BANK, which was harmless only because the file had no other channel.
 *
 * It decides three things at once, and all three are invisible when wrong:
 *   · order.factoryPayIntent → which card an unpaid truck lands on in Qarzlar (naqd vs oʼtkazma)
 *   · item.provisionalPriceKind → the cost basis the order is ANCHORED to (factory-coverage.ts)
 *   · which ProductPrice book the row's «Цена Приход» seeds — and naqd really is cheaper here
 *     (08.07: bank 593 750 · naqd 517 750 · 14.07: bank 593 750 · naqd 489 250), so filing a
 *     naqd price as a bank price would corrupt the bank book AND make every naqd truck look
 *     like it deviates from the day's price.
 *
 * Click/karta sit in the naqd family, exactly as advanceBucketFor treats them.
 * '' ⇒ null: the caller decides (BANK on a file that has no such column, an owner question
 * on a file that has one and left the cell blank). An unrecognised word ⇒ null as well —
 * ZAVOD_TOLOV_TURI_NOMALUM asks rather than guessing.
 */
export function classifyOrderChannel(word: string): PaymentMethod | null {
  const t = (word ?? '').trim();
  if (!t) return null;
  if (CLICK_NOTE.test(t)) return PaymentMethod.CLICK;
  if (CARD_NOTE.test(t)) return PaymentMethod.CARD;
  if (CASH_NOTE.test(t)) return PaymentMethod.CASH;
  if (BANK_NOTE.test(t)) return PaymentMethod.BANK;
  return null;
}

/** «тўлов тури» → the owner's three buttons on the order form. */
export function payIntentFor(method: PaymentMethod): FactoryPayIntent {
  return FACTORY_CASH_METHODS.includes(method) ? FactoryPayIntent.CASH : FactoryPayIntent.BANK;
}

/**
 * Mirrors PaymentsService.advanceBucketFor — money SENT to the factory stands in the
 * channel it travelled through, and that channel later decides its cost basis
 * (naqd → FACTORY_CASH, o'tkazma → FACTORY_BANK). Keeping the two classifiers identical
 * is what lets an imported advance be drawn («avansdan yechish») exactly like a live one.
 */
const FACTORY_CASH_METHODS: readonly PaymentMethod[] = [
  PaymentMethod.CASH, PaymentMethod.CLICK, PaymentMethod.CARD, PaymentMethod.USD,
];
function advanceBucketFor(method: PaymentMethod): FactoryBucket {
  if (method === PaymentMethod.BONUS) return FactoryBucket.PAYABLE;
  return FACTORY_CASH_METHODS.includes(method) ? FactoryBucket.ADVANCE_CASH : FactoryBucket.ADVANCE_BANK;
}
/**
 * Import cash routing: every payment the import posts (client money IN, factory & driver
 * money OUT) also lands in the kassa so the cashbox/dashboard reflect the real flows.
 * Each payment method settles into the matching cashbox family. Imported (historical)
 * cash intentionally BYPASSES the never-below-zero guard the live kassa applies: a period
 * that paid the factory/drivers ahead of collection legitimately draws a box negative —
 * the still-open receivable side («Ост») is what replenishes it, not phantom opening cash.
 */
const CASH_TYPE_FOR_METHOD: Record<PaymentMethod, CashboxType> = {
  [PaymentMethod.CASH]: CashboxType.CASH,
  [PaymentMethod.CLICK]: CashboxType.CLICK,
  [PaymentMethod.TERMINAL]: CashboxType.TERMINAL,
  [PaymentMethod.BANK]: CashboxType.BANK,
  [PaymentMethod.CARD]: CashboxType.CARD,
  [PaymentMethod.USD]: CashboxType.CASH,
  [PaymentMethod.BONUS]: CashboxType.CASH, // never used for import cash (no bonus payments imported)
};
const CASHBOX_DEFAULT_NAME: Record<CashboxType, string> = {
  [CashboxType.CASH]: 'Naqd kassa',
  [CashboxType.BANK]: 'Bank',
  [CashboxType.CLICK]: 'Click',
  [CashboxType.TERMINAL]: 'Terminal',
  [CashboxType.CARD]: 'Karta',
};

/** Result of a commit or dry-run: the balances the owner compares against the journal's totals. */
export interface PreviewResult {
  orders: number;
  /**
   * «Завод» blokining pastki raqami — zavodda QOLGAN pulimiz (Берилган − Олинган).
   * >0 ⇒ zavodda pulimiz turibdi · <0 ⇒ zavodga qarzdormiz.
   */
  factoryBalance: string;
  /** «Завод → Олинган»: Σ olingan molning tannarxi (bloklar; poddon naturada) */
  factoryGoodsTaken: string;
  /** «Завод → Берилган»: Σ «Утказилган пул» */
  factoryTransferred: string;
  /** o'tkazma bilan yopilgan mol puli — «avansdan yechish» qatorlari */
  factorySettled: string;
  /** zavod tomonidan to'liq yopilgan buyurtmalar soni */
  factoryOrdersSettled: number;
  /** «Завотга толов» qisman to'langan buyurtmalar (0 < to'lov < tannarx) */
  factoryOrdersPartial: number;
  /** «Завотга толов» = 0 — zavodga qarz bo'lib turgan buyurtmalar */
  factoryOrdersUnpaid: number;
  /** hali yopilmagan mol qarzi (PAYABLE) — 0 bo'lsa hammasi yopilgan */
  factoryPayable: string;
  /**
   * «тўлов тури» kesimida — egasi Qarzlar sahifasida aynan shu ikki raqamni ko'radi.
   * goods = olingan mol, paid = «Завотга толов» bo'yicha yopilgani, debt = qolgan qarz.
   */
  factoryByChannel: Array<{ channel: 'naqd' | "o'tkazma"; orders: number; goods: string; paid: string; debt: string }>;
  /**
   * «Утказилган пул» blokida bor, lekin uning «Жами» formulasi qamramagan qatorlar —
   * import qilinmadi (egasining qarori, 2026-07-29). 0 bo'lsa blok to'liq olingan.
   */
  factoryTransfersSkipped: number;
  factoryTransfersSkippedTotal: string;
  /**
   * «Завотга толов» deb yozilgan, lekin blokda unga yetadigan pul topilmagan qismi.
   * >0 ⇒ fayl o'zi bilan o'zi ziddiyatda (ZAVOD_TOLOVI_QOPLANMADI buni aytadi).
   */
  factoryUnfunded: string;
  /** o'tkazmadan zavodda qolgani */
  factoryAdvanceBank: string;
  /**
   * naqddan zavodda qolgani. 0.00 on the reference workbook — but only because Pass C3's
   * FIFO fully consumes its 56 000 000 of naqd+Click transfers, NOT because this template
   * cannot carry them. Since 2026-07-27 the «Утказилган пул» block records a channel per row.
   */
  factoryAdvanceCash: string;
  clientDebtTotal: string; // Σ CLIENT ledger — >0 = clients owe us
  vehicleBalance: string; // Σ VEHICLE ledger — ~0 when «Туланди» rows post VEHICLE_OUT
  saleTotal: string; // Σ ORDER_SALE
  costTotal: string; // Σ ORDER_COST (blocks ONLY — pallets are an in-kind deposit, Лист1 col J)
  factoryPaidTotal: string; // Σ FACTORY_OUT
  clientPaidTotal: string; // Σ CLIENT_IN
  palletsOut: number; // delivered − returned
  cashIn: string; // Σ kassa KIRIM (client money into cashboxes — PAYMENT rows only)
  cashOut: string; // Σ kassa CHIQIM (factory money out — PAYMENT rows only)
  cashCapital: string; // Σ «Diller kapitali» injected so no box ends below zero
  /**
   * Per-cashbox proof, so the owner reads WHERE his money landed before he commits — not
   * afterwards on the Kassa page. This is the number his complaint was about: the reference
   * workbook must show naqd 46 114 800 (52 114 800 in − 6 000 000 to the factory, no capital) ·
   * Click 0.00 (40 033 000 in − 50 000 000 out ⇒ 9 967 000 capital) · Bank 0.00 (147 103 300
   * capital) — Σ capital 157 070 300. A box that lands on exactly 0.00 with a capital top-up is
   * visible here instead of silent; the Click one is the file saying he clicked more OUT to the
   * factory than ever came IN that way.
   */
  cashboxes: Array<{
    name: string;
    type: CashboxType;
    in: string; // real PAYMENT kirim
    out: string; // real PAYMENT chiqim
    capital: string; // «Diller kapitali» top-up
    balance: string; // in − out + capital
  }>;
  /**
   * Money the client handed straight to the driver at the truck («шопр учун барди»): it settles
   * his debt but never enters a cashbox. Reported so the kirim figure cannot be mistaken for
   * «this much cash reached us».
   */
  clientPaidDriver: string;
  /** Σ transport the drivers were paid, none of it out of the till (owner rule 2026-07-23) */
  transportPaidByClient: string;
  /** Σ CLIENT_IN money FIFO-matched onto orders (drives the «toʼlangan» tabs) */
  allocatedToOrders: string;
  /** how many imported orders came out fully covered by client money */
  ordersFullyPaid: number;
  /** client money left over after FIFO — a real standing advance, not an error */
  clientAdvanceLeft: string;
}

export class DryRunRollback extends Error {
  constructor(public readonly result: PreviewResult) {
    super('dry-run');
  }
}

export interface CommitInput {
  batchId: string;
  filename?: string; // only used to create the batch row in a dry-run test flow
  factoryName: string;
  shipments: ShipmentRow[];
  clientPayments: ClientPaymentRow[];
  factoryPayments: FactoryPaymentRow[];
  /** resolved canonical client NAME for a raw name (owner decisions already applied) */
  resolveClient: (rawName: string, origin: { sheetName: string; excelRow: number }) => string;
  /** agent NAME that owns a resolved client (for the order's agent snapshot) */
  agentForClient?: (clientName: string) => string | null;
  /** the agent's daftar number (block-header prefix) — stored as Agent.sortNo on create */
  agentSortNo?: (agentName: string) => number | null;
  createdById?: string | null;
  /**
   * REPLACE mode: wipe EVERY business/transactional record (orders, clients, agents,
   * factories, payments, kassa, ledger, pallets, …) before writing this file, so the
   * imported dataset fully replaces whatever was there. Login users + AppSettings +
   * this batch's own staging survive. Runs INSIDE the commit transaction (atomic).
   */
  wipeFirst?: boolean;
}

const TX_OPTS = { maxWait: 15_000, timeout: 180_000 } as const;

/**
 * col U «Авто услу барлдми?» = "was the auto service paid?". Any entry means yes:
 * «Туланди», a date (paid on that date), or an amount. Only a blank col U leaves a
 * real unpaid-driver debt (a handful of rows the owner resolves). This is what nets
 * the VEHICLE ledger to ~0 instead of a phantom 68.1M debt.
 */
function transportPaid(autoPaid: string): boolean {
  return autoPaid.trim().length > 0;
}

/**
 * Bonus accrual for one imported order — the same rule BonusService.accrueForOrder applies
 * when an order is created live (an order is born COMPLETED since 2026-07-22, and that is
 * when the factory bonus accrues). Inlined rather than injected because runCommit is a plain
 * function over a PrismaClient, not a Nest provider.
 *
 * Straight after a REPLACE there is no BonusProgram (the wipe removes them), so this is a
 * no-op for the reference workbook. It matters for APPEND onto a live database that already
 * runs a programme: without it, imported trucks would silently earn nothing while
 * hand-entered ones did — the same m³ valued two different ways.
 *
 * PERCENT base is BLOCKS ONLY (pallet money is never part of it), matching bonus.service.
 */
async function accrueBonus(
  tx: Tx,
  p: { orderId: string; factoryId: string; at: Date; m3: Prisma.Decimal; costTotal: Prisma.Decimal; by: string | null },
): Promise<void> {
  const program = await tx.bonusProgram.findFirst({
    where: { factoryId: p.factoryId, effectiveFrom: { lte: p.at } },
    orderBy: { effectiveFrom: 'desc' },
  });
  if (!program || program.kind === BonusProgramKind.NONE) return;

  let amount: Prisma.Decimal;
  let baseAmount: Prisma.Decimal | null = null;
  let baseM3: Prisma.Decimal | null = null;
  if (program.kind === BonusProgramKind.PER_M3) {
    baseM3 = p.m3.toDP(3);
    amount = new D(program.ratePerM3 ?? 0).mul(baseM3).toDP(2);
  } else {
    baseAmount = p.costTotal.toDP(2);
    amount = baseAmount.mul(new D(program.percent ?? 0)).div(100).toDP(2);
  }
  if (amount.lte(0)) return;

  await tx.bonusTransaction.create({
    data: {
      type: BonusTransactionType.ACCRUAL, amount, factoryId: p.factoryId, orderId: p.orderId,
      programId: program.id, baseAmount, baseM3, createdById: p.by,
    },
  });
}

/** Next value of the order_no_seq Postgres SEQUENCE (real commits get ORD-nnnnnn). */
async function nextOrderSeq(tx: Tx): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ n: bigint }>>`SELECT nextval('order_no_seq') AS n`;
  return Number(rows[0].n);
}

/** Run the import. dryRun=true writes everything then rolls back, returning the balances. */
export async function runCommit(prisma: PrismaClient, input: CommitInput, opts: { dryRun: boolean }): Promise<PreviewResult> {
  try {
    return await prisma.$transaction(async (tx) => {
      const result = await commitInner(tx, input, opts.dryRun);
      if (opts.dryRun) throw new DryRunRollback(result);
      return result;
    }, TX_OPTS);
  } catch (e) {
    if (e instanceof DryRunRollback) return e.result; // rolled back cleanly
    throw e;
  }
}

async function commitInner(tx: Tx, input: CommitInput, dryRun: boolean): Promise<PreviewResult> {
  const { batchId, shipments, clientPayments, factoryPayments } = input;
  const by = input.createdById ?? null;

  // batch row must exist for the LedgerEntry/Order FKs (real flow: created at upload;
  // dry-run: created here and rolled back with everything else)
  await tx.importBatch.upsert({
    where: { id: batchId },
    update: {},
    create: { id: batchId, filename: input.filename ?? 'import', status: 'COMMITTING' },
  });

  // REPLACE: wipe all prior business data first (atomic — same tx as the rewrite). If a
  // dry-run reaches here it wipes then rolls back, so preview stays side-effect free.
  // Capture each AGENT user's agent NAME before the wipe drops the agents, so we can
  // re-attach the user to the same-named rebuilt agent afterwards (else their row-scoping
  // breaks — a null agentId would widen an AGENT user to every agent's data).
  const userAgentLinks = input.wipeFirst
    ? await tx.$queryRaw<Array<{ userId: string; agentName: string }>>`
        SELECT u.id AS "userId", a.name AS "agentName" FROM "User" u JOIN "Agent" a ON a.id = u."agentId"`
    : [];
  if (input.wipeFirst) await wipeAllBusinessData(tx, batchId);

  // ── Pass A: catalog ──
  const factory = await tx.factory.upsert({ where: { name: input.factoryName }, update: {}, create: { name: input.factoryName } });

  const agentIdByName = new Map<string, string>();
  const ensureAgent = async (name: string): Promise<string> => {
    if (agentIdByName.has(name)) return agentIdByName.get(name)!;
    const sortNo = input.agentSortNo?.(name) ?? null;
    const a = await tx.agent.upsert({ where: { name }, update: {}, create: { name, sortNo } });
    agentIdByName.set(name, a.id);
    return a.id;
  };

  const clientId = new Map<string, string>();
  const clientAgentId = new Map<string, string | null>(); // agent that owns each client (for the order snapshot)
  const ensureClient = async (name: string): Promise<string> => {
    if (clientId.has(name)) return clientId.get(name)!;
    const agentName = input.agentForClient?.(name) ?? null;
    const agentId = agentName ? await ensureAgent(agentName) : null;
    const c = await tx.client.upsert({ where: { name }, update: {}, create: { name, agentId } });
    // fill a missing agent link on a pre-existing client, but never clobber a manual one
    if (agentId && !c.agentId) await tx.client.update({ where: { id: c.id }, data: { agentId } });
    clientId.set(name, c.id);
    clientAgentId.set(name, c.agentId ?? agentId);
    return c.id;
  };

  const productId = new Map<string, string>();
  const ensureProduct = async (size: string): Promise<string> => {
    const key = normalizeSize(size) || 'noma’lum';
    if (productId.has(key)) return productId.get(key)!;
    const p = await tx.product.upsert({
      where: { factoryId_name: { factoryId: factory.id, name: key } },
      update: {},
      // m3PerPallet derived from the size, not left on the 1.728 schema default: a
      // 600x300x250 pallet holds 1.8 m³, and the default silently mis-sized every ×250
      // product (pallet↔m³ conversion on the order form reads straight off this).
      create: { factoryId: factory.id, name: key, size: key, m3PerPallet: m3PerPalletForSize(key) },
    });
    productId.set(key, p.id);
    return p.id;
  };

  /**
   * Price-book observations harvested from the shipment rows.
   *
   * The import used to create Products with NO ProductPrice rows at all, which left the
   * catalog price-less: every later hand-entered order died on «… narxi kiritilmagan»
   * because PricingService found no row in force. The workbook already carries a per-row
   * sale price and factory cost price, so the book is rebuilt from the real history —
   * one versioned row per price CHANGE (the model is versioned by design), keyed by the
   * shipment date. Deduped on [productId, kind, effectiveFrom] to respect the unique index.
   *
   * One day can legitimately carry SEVERAL prices for the same product (this workbook has
   * 600x300x200 at both 625 000 and 545 000 on four separate days, and up to three sale
   * prices on one day). The book stores one row per day, so the winner is the MODAL price —
   * what that product actually sold/cost that day — with ties going to the DEARER one, the
   * same «never understate the factory debt» bias the UNKNOWN pay-intent uses. Taking
   * whichever row happened to be parsed last, as this did before, could seed the catalog
   * with a one-off 545 000 and mis-price every later hand-entered order.
   */
  const priceVotes = new Map<string, { productId: string; kind: PriceKind; at: Date; counts: Map<string, number> }>();
  const observePrice = (pid: string, kind: PriceKind, price: Prisma.Decimal | null | undefined, at: Date) => {
    if (!price || !price.isFinite() || price.lte(0)) return;
    const day = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
    const key = `${pid}|${kind}|${day.toISOString()}`;
    const slot = priceVotes.get(key) ?? { productId: pid, kind, at: day, counts: new Map<string, number>() };
    const v = price.toDP(6).toString();
    slot.counts.set(v, (slot.counts.get(v) ?? 0) + 1);
    priceVotes.set(key, slot);
  };
  /** modal price for a day; ties broken toward the higher value */
  const winningPrice = (counts: Map<string, number>): Prisma.Decimal =>
    new D([...counts].sort((a, b) => b[1] - a[1] || new D(b[0]).comparedTo(new D(a[0])))[0][0]);

  // keyed by plateKey (spacing-insensitive), not the display form: a hand-added
  // «90X700CA» and the sheet's «90 X 700 CA» are the SAME truck and must not be split.
  const vehicleId = new Map<string, string>();
  const ensureVehicle = async (plateRaw: string): Promise<string | null> => {
    const plate = normalizePlate(plateRaw);
    if (!plate) return null;
    const key = plateKey(plate);
    if (vehicleId.has(key)) return vehicleId.get(key)!;
    const found = await findFleetVehicleByPlate(tx, plate);
    const id = found?.id ?? (await tx.vehicle.create({ data: { name: plate, plate } })).id;
    vehicleId.set(key, id);
    return id;
  };

  /**
   * FACTORY postings carry an explicit bucket (owner rule, 2026-07-21) — the dealer's
   * money at the factory does NOT auto-consume his goods debt:
   *
   *   ORDER_COST  → PAYABLE                (Лист1 «Завод · Олинган» = −2 759 538 240)
   *   FACTORY_OUT → ADVANCE_BANK / _CASH   (Лист1 «Завод · Берилган» = +3 027 089 420)
   *   Σ           = the workbook's own «Завод» delta   (+267 551 180)
   *
   * Which advance pocket a transfer lands in follows its «Утказилган пул» channel column
   * (bank 2 971 089 420 → ADVANCE_BANK · naxt 6 000 000 + click 50 000 000 → ADVANCE_CASH).
   *
   * The previous import netted both into PAYABLE, which collapsed those two columns the
   * owner reads separately into one number and made «avansdan yechish» impossible on
   * imported history. Spending the advance stays a deliberate act, exactly as live.
   */
  const postLedger = (
    account: LedgerAccount,
    source: LedgerSource,
    amount: Prisma.Decimal,
    party: { clientId?: string; factoryId?: string; vehicleId?: string },
    orderId?: string,
    paymentId?: string,
    date?: Date,
    factoryBucket: FactoryBucket = FactoryBucket.PAYABLE,
    allocationId?: string,
  ) =>
    tx.ledgerEntry.create({
      data: {
        date: date ?? new Date(0),
        account, source, amount,
        factoryBucket: account === LedgerAccount.FACTORY ? factoryBucket : null,
        clientId: party.clientId ?? null,
        factoryId: party.factoryId ?? null,
        vehicleId: party.vehicleId ?? null,
        orderId: orderId ?? null,
        paymentId: paymentId ?? null,
        // ADVANCE_DRAW only — this is what makes one draw individually reversible
        allocationId: allocationId ?? null,
        importBatchId: batchId,
        createdById: by,
      },
    });

  // ── kassa: every import payment also moves cash (kirim/chiqim) ──
  // One cashbox per method-family, reused across the batch. Prefer an existing active
  // UZS box (the seed's «Naqd kassa» / «Bank …» / …) so imported cash lands in the real
  // kassa the owner already uses; create a fallback only if none exists.
  const cashboxByType = new Map<CashboxType, string>();
  const ensureCashbox = async (method: PaymentMethod): Promise<string> => {
    const type = CASH_TYPE_FOR_METHOD[method] ?? CashboxType.CASH;
    const cached = cashboxByType.get(type);
    if (cached) return cached;
    const existing = await tx.cashbox.findFirst({
      where: { type, currency: 'UZS', active: true },
      orderBy: [{ createdAt: 'asc' }, { name: 'asc' }],
    });
    const box = existing ?? (await tx.cashbox.create({ data: { name: CASHBOX_DEFAULT_NAME[type], type, currency: 'UZS' } }));
    cashboxByType.set(type, box.id);
    return box.id;
  };
  /**
   * Write one import kassa row (no never-below-zero guard — historical cash, see note above).
   *
   * `note` carries the workbook's own «Примечание» verbatim («Нахт», «Клик», «ООО FIDATO
   * GROUP»…). It used to be the constant 'Excel import' on all 307 rows, so the kassa journal
   * could not tell naqd from a transfer — the mechanical half of the owner's «Нахт uchun
   * yozilgani aniq emas».
   */
  const writeCash = (cashboxId: string, direction: CashDirection, amount: Prisma.Decimal, paymentId: string, date: Date, note?: string) =>
    tx.cashTransaction.create({
      data: {
        cashboxId, date, direction, amount: amount.toDP(2), source: CashSource.PAYMENT,
        paymentId, importBatchId: batchId,
        note: [note?.trim(), 'Excel import'].filter(Boolean).join(' · '),
        createdById: by,
      },
    });

  // ── Pass B: shipments → order + item + 3 ledgers + 2 pallets ──
  let n = 0;
  const palletsDeliveredTo = new Map<string, number>(); // client name → Σ delivered (for return clamping)
  /**
   * Every imported order, per client, in the order FIFO settlement must walk them
   * (date → orderNo — the same comparator autoAllocateClientPayment uses). Collected here
   * so Pass D can match client money onto orders without 3 000 round-trips to Postgres.
   */
  const ordersOf = new Map<string, Array<{ id: string; date: Date; seq: number; chargeable: Prisma.Decimal; settled: Prisma.Decimal }>>();
  /** every imported order in journal order, with what it owes the factory — Pass C3 settles these */
  const supply: Array<{
    id: string; itemId: string; date: Date; cost: Prisma.Decimal; costPerM3: Prisma.Decimal;
    /** «Завотга толов» — what THIS truck has already been paid; null on a file without the column */
    paid: Prisma.Decimal | null;
    /** the pocket its own channel draws from first (naqd truck → naqd advance) */
    bucket: FactoryBucket;
    /** the cost basis it is anchored to — the allocation must carry it, see Pass C3 */
    priceKind: PriceKind;
  }> = [];
  /**
   * TRUE when the workbook carries «Завотга толов» at all. It is a FILE-level switch, not a
   * per-row one: on such a file a blank cell means «0 — hali to'lanmagan», while on an older
   * file the same blank means «this sheet does not say», and those two must never settle the
   * same way. Falling back per row would let one un-filled cell silently re-enable the old
   * oldest-first FIFO for that truck alone.
   */
  const perOrderFactoryPay = shipments.some((r) => r.factoryPaid !== null);
  for (const r of shipments) {
    const cName = input.resolveClient(r.clientRaw, r.origin);
    const cid = await ensureClient(cName);
    const pid = await ensureProduct(r.size);
    const vid = r.truck ? await ensureVehicle(r.truck) : null;
    const date = r.date ?? new Date(0);

    const m3 = new D(String(r.cube ?? 0));
    const costPrice = r.costPrice ?? new D(0);
    const palletCount = r.palletQty ?? 0;
    const saleTotal = r.saleSum ?? m3.mul(r.salePrice ?? 0);
    // Factory debt = BLOCKS ONLY (Лист1 col J) — this is the «Завод · Олинган» column the
    // owner's own transfers are netted against (see Pass C3). Pallet money (col M) is NOT
    // owed: pallets are a returnable deposit tracked in UNITS via PalletTransaction, and a
    // lost one is charged to the CLIENT via pallets/charge-lost, never to the factory.
    const costTotal = m3.mul(costPrice);
    const transportCost = r.transport ?? new D(0);
    const paid = transportCost.gt(0) && transportPaid(r.autoPaid);

    // «тўлов тури» → intent + cost basis. A file WITHOUT the column keeps the historical
    // reading (every transfer in this template is an o'tkazma ⇒ BANK); a file WITH it but a
    // blank/odd cell is stopped by ZAVOD_TOLOV_TURI_NOMALUM at review time, and BANK here is
    // only the belt-and-braces default for a row hand-patched past that gate.
    const payMethod = classifyOrderChannel(r.factoryPayChannel) ?? PaymentMethod.BANK;
    const payIntent = payIntentFor(payMethod);
    const costKind = payIntent === FactoryPayIntent.CASH ? PriceKind.FACTORY_CASH : PriceKind.FACTORY_BANK;

    // rebuild the catalog price book from the row's real prices (see priceObs above)
    const salePrice = r.salePrice != null ? new D(String(r.salePrice)) : m3.gt(0) ? saleTotal.div(m3) : null;
    observePrice(pid, PriceKind.DEALER_SALE, salePrice, date);
    // …into the book of the channel the truck was actually bought through. Both books get
    // real rows now, which is what makes «naqd tannarx» a fact on screen instead of a number
    // borrowed from the o'tkazma book (common/factory-coverage.ts hasPrice).
    observePrice(pid, costKind, costPrice, date);

    const order = await tx.order.create({
      data: {
        orderNo: dryRun
          ? `DRY-${String(++n).padStart(6, '0')}`
          : `ORD-${String(await nextOrderSeq(tx)).padStart(6, '0')}`,
        date, status: OrderStatus.COMPLETED, completedAt: date,
        clientId: cid, factoryId: factory.id, vehicleId: vid,
        agentId: clientAgentId.get(cName) ?? null,
        saleTotal: saleTotal.toDP(2), costTotal: costTotal.toDP(2), costStatus: CostStatus.PROVISIONAL,
        // «тўлов тури» ustunidan. UNKNOWN hech qachon yozilmaydi: u butun tarixni dashboard'ning
        // «aniqlanmagan foyda» chelagiga tashlab, davr «sof foyda»sini nolga tushirardi — va
        // faylda bu ustun bor, ya'ni javob ma'lum.
        factoryPayIntent: payIntent,
        // DEALER_ABSORBED, deliberately — and it is the ONLY mode this template supports.
        // Лист1's «Сумма Продажа» (col R) is what the agent daftar charges the client, and
        // col S transport is already inside that margin (700 000 sale − 625 000 cost ≈ the
        // 2.2–2.5 mln truck). The daftar then counts the client's «шопр учун барди» cash as
        // an ordinary «Приход» against that FULL amount. CLIENT_PAYS_DRIVER would instead
        // carve each order's own transportCost out of its sale — and the owner's driver cash
        // arrives in lumps (4 000 000) that do not line up with per-truck costs (2 200 000),
        // so the carve-out could not be made to reproduce «Ост». Both routes net to the same
        // client balance only when they agree row-by-row; DEALER_ABSORBED needs no guessing.
        transportMode: TransportMode.DEALER_ABSORBED,
        transportCost: transportCost.toDP(2), transportCharge: new D(0),
        transportPaidStatus: transportCost.gt(0) ? (paid ? TransportPaidStatus.PAID : TransportPaidStatus.UNPAID) : TransportPaidStatus.NOT_APPLICABLE,
        note: `Excel «${r.origin.sheetName}» r${r.origin.excelRow}`,
        importBatchId: batchId, createdById: by,
        items: {
          create: [{
            // palletPrice 0: pallets are an in-kind deposit here, not a cost component —
            // this keeps recomputeOrderCost (cost finalization) from re-adding pallet money
            productId: pid, quantityM3: m3.toDP(3), palletCount, palletPrice: new D(0),
            salePricePerM3: new D(String(r.salePrice ?? 0)).toDP(6),
            saleTotal: saleTotal.toDP(2),
            provisionalPriceKind: costKind,
            costPricePerM3: costPrice.toDP(6),
            costTotal: costTotal.toDP(2),
          }],
        },
      },
      include: { items: { select: { id: true } } },
    });
    if (costTotal.gt(0)) {
      supply.push({
        id: order.id, itemId: order.items[0].id, date, cost: costTotal.toDP(2), costPerM3: costPrice.toDP(6),
        // clamp: the owner may type a rounder figure than the truck cost («Завотга толов»
        // 15 552 000 for a 15 552 000 truck is the norm, but a stray extra zero must not buy
        // the NEXT truck too). The excess is reported by ZAVOD_TOLOVI_ORTIQCHA, never spent.
        paid: r.factoryPaid === null ? null : D.max(0, D.min(r.factoryPaid, costTotal)).toDP(2),
        bucket: advanceBucketFor(payMethod),
        priceKind: costKind,
      });
    }

    // Live parity: OrdersService.create writes the birth transition (null → COMPLETED).
    // Without it an imported order's timeline opens empty and reads as never finalized.
    await tx.orderStatusHistory.create({ data: { orderId: order.id, from: null, to: OrderStatus.COMPLETED, byId: by, note: 'Excel import' } });

    // CLIENT +sale (client owes us)   ·   FACTORY −cost (we owe factory, PAYABLE bucket)
    await postLedger(LedgerAccount.CLIENT, LedgerSource.ORDER_SALE, saleTotal.toDP(2), { clientId: cid }, order.id, undefined, date);
    await postLedger(LedgerAccount.FACTORY, LedgerSource.ORDER_COST, costTotal.toDP(2).negated(), { factoryId: factory.id }, order.id, undefined, date, FactoryBucket.PAYABLE);

    // VEHICLE −cost; if the driver was already paid, a VEHICLE_OUT payment nets it to 0
    if (transportCost.gt(0) && vid) {
      await postLedger(LedgerAccount.VEHICLE, LedgerSource.TRANSPORT_COST, transportCost.toDP(2).negated(), { vehicleId: vid }, order.id, undefined, date);
      if (paid) {
        // NO CASHBOX, NO KASSA ROW — egasining qoidasi (2026-07-23): «mijozni o'zi transportga
        // to'lagan deb hisoblaymiz». Uning hisobi: mijoz 22 mln qarzdor bo'lsa, transportni o'zi
        // to'lasa 2 mln shofyorga + 20 mln bizga beradi; biz to'lasak 22 mln bizga keladi va 2
        // mln'ni biz to'laymiz — HAR IKKALA HOLDA HAM bizga 20 mln qoladi. Foyda bir xil, demak
        // transport pulini kassadan o'tkazishning ma'nosi yo'q.
        //
        // The payment row itself STAYS: transportPaidStatus is derived (common/transport.ts
        // recomputeTransportStatus) from Σ active VEHICLE_OUT allocations, so without it every
        // «Туланди» flips back to UNPAID the first time the owner edits the order. The VEHICLE
        // ledger pair still nets to ~0. Only the till is left alone.
        //
        // What this cost before: 324 700 002 of chiqim and 205 684 000 of matching kirim churned
        // through «Naqd kassa» — 213 rows of movements that physically never happened — dragging
        // the box to −67 121 202 so the never-below-zero top-up landed it on exactly 0.00. That
        // zero IS the owner's «naqd kassaga tushmayabdi».
        const pay = await tx.payment.create({ data: { date, kind: PaymentKind.VEHICLE_OUT, method: PaymentMethod.CASH, amount: transportCost.toDP(2), vehicleId: vid, note: 'Transportni mijoz toʼlagan (Excel import)', importBatchId: batchId, createdById: by } });
        // The ALLOCATION is what makes «Туланди» survive. transportPaidStatus is no longer a
        // stored flag anyone may trust: common/transport.ts recomputeTransportStatus derives it
        // from Σ active VEHICLE_OUT/TRANSPORT_DIRECT allocations, and it runs on every later
        // edit/void. An imported order with a payment but no allocation flipped straight back
        // to UNPAID the first time the owner touched it.
        await tx.paymentAllocation.create({ data: { paymentId: pay.id, orderId: order.id, amount: transportCost.toDP(2), createdById: by } });
        await postLedger(LedgerAccount.VEHICLE, LedgerSource.PAYMENT, transportCost.toDP(2), { vehicleId: vid }, order.id, pay.id, date);
      }
    }

    // pallets: received from factory + delivered to client (both additive)
    if (palletCount > 0) {
      await tx.palletTransaction.create({ data: { type: PalletTransactionType.RECEIVED_FROM_FACTORY, factoryId: factory.id, qty: palletCount, orderId: order.id, date, importBatchId: batchId, createdById: by } });
      await tx.palletTransaction.create({ data: { type: PalletTransactionType.DELIVERED_TO_CLIENT, clientId: cid, qty: palletCount, orderId: order.id, date, importBatchId: batchId, createdById: by } });
      palletsDeliveredTo.set(cName, (palletsDeliveredTo.get(cName) ?? 0) + palletCount);
    }

    // Bonus accrues at COMPLETED, and an imported order is born COMPLETED — same as live.
    // No program in force (the usual case straight after a REPLACE) ⇒ silently nothing.
    await accrueBonus(tx, { orderId: order.id, factoryId: factory.id, at: date, m3, costTotal, by });

    // DEALER_ABSORBED ⇒ the whole sale is the client's exposure (clientChargeable)
    const list = ordersOf.get(cName) ?? [];
    list.push({ id: order.id, date, seq: list.length, chargeable: saleTotal.toDP(2), settled: new D(0) });
    ordersOf.set(cName, list);
  }

  // ── Pass B2: write the harvested price book ──
  // Without this the imported catalog has no price in force and hand-entered orders are
  // impossible. createMany + skipDuplicates so a re-import (APPEND mode) is idempotent
  // against the [productId, kind, effectiveFrom] unique index instead of exploding.
  if (priceVotes.size) {
    await tx.productPrice.createMany({
      data: [...priceVotes.values()].map((o) => ({
        productId: o.productId,
        kind: o.kind,
        pricePerM3: winningPrice(o.counts),
        effectiveFrom: o.at,
        createdBy: by,
      })),
      skipDuplicates: true,
    });
  }

  // ── Pass C: client payments (CLIENT_IN + in-kind pallet returns) & factory payments (FACTORY_OUT) ──
  /** client name → the CLIENT_IN money Pass D must spread over that client's orders, FIFO */
  const clientCash = new Map<string, Array<{ id: string; date: Date; seq: number; amount: Prisma.Decimal }>>();
  /** «Утказилган пул» transfers with their unspent remainder — Pass C3 draws from these */
  const factoryCash: Array<{ id: string; date: Date; seq: number; free: Prisma.Decimal; bucket: FactoryBucket }> = [];
  const palletsReturnedBy = new Map<string, number>();
  // pallets the client already held BEFORE this batch — a legitimate return against
  // pre-import stock must not be truncated by a batch-only baseline
  const dbHeld = new Map<string, number>();
  const heldBeforeBatch = async (cid: string): Promise<number> => {
    if (dbHeld.has(cid)) return dbHeld.get(cid)!;
    const rows = await tx.palletTransaction.findMany({
      where: { clientId: cid, OR: [{ importBatchId: null }, { importBatchId: { not: batchId } }] },
      select: { type: true, qty: true },
    });
    const held = rows.reduce((a, r) =>
      r.type === PalletTransactionType.DELIVERED_TO_CLIENT ? a + r.qty
      : r.type === PalletTransactionType.RETURNED_BY_CLIENT || r.type === PalletTransactionType.CHARGED_LOST ? a - r.qty
      : r.type === PalletTransactionType.ADJUSTMENT || r.type === PalletTransactionType.REVERSAL ? a + r.qty
      : a, 0);
    dbHeld.set(cid, held);
    return held;
  };
  for (const p of clientPayments) {
    const cName = input.resolveClient(p.clientRaw, p.origin);
    // A NEGATIVE «Приход» cell is a real deduction the owner booked against the client
    // («Шопир пули 5%», a correction…): money handed back / charged to him, which RAISES
    // his balance. It must post as a CLIENT_REFUND — silently skipping it (the old
    // `> 0` guard) overstated collections and pushed «Ост» off by the whole deduction.
    if (p.total && !p.total.isZero()) {
      const cid = await ensureClient(cName);
      // the payment's agent = the agent SHEET it physically sits on (its daftar), which
      // survives a mid-period client handover; vote-winner only as fallback
      const agentId = p.agentRaw ? await ensureAgent(p.agentRaw) : clientAgentId.get(cName) ?? null;
      // Which cashbox this money really belongs in. «Нахт» is naqd, «Клик» is the Click
      // wallet, a «Нахт клент …» block is naqd whatever its cell says, and the rest of the
      // «Примечание» cells hold a firm's legal name — a transfer.
      const method = clientPaymentMethod(p.payer, p.blockName);
      // …but a driver hand-over never reaches a cashbox at all: the client paid the truck at
      // the roadside. The Payment + CLIENT ledger still post (the daftar counts it as «Приход»,
      // and «Ост» must reproduce to the som), it simply has no cashbox and no kassa row.
      // 66 rows / 205 684 000 on this workbook.
      const toDriver = isDriverHandover(p.payer);
      const cashboxId = toDriver ? null : await ensureCashbox(method);
      const refund = p.total.isNegative();
      const amount = p.total.abs().toDP(2); // Payment.amount has a CHECK > 0 — kind carries the sign
      const pay = await tx.payment.create({
        data: {
          date: p.date ?? new Date(0),
          kind: refund ? PaymentKind.CLIENT_REFUND : PaymentKind.CLIENT_IN,
          method, amount, clientId: cid, agentId,
          // A positive row's «payer» cell is the paying entity. A NEGATIVE row's cell holds
          // the REASON for the deduction («Шопир пули 5%») — as receiverName it would print
          // «Qabul qiluvchi: Шопир пули 5%» on the receipt, so it becomes the note instead.
          // Either way the note now keeps the cell verbatim: it is the only record of HOW the
          // money travelled, and the Payments/Kassa journals are read straight off it.
          ...(refund ? {} : { payerName: p.payer || null }),
          note: [...new Set([p.payer, p.note].map((s) => s?.trim()).filter(Boolean))].join(' · ') || null,
          cashboxId, importBatchId: batchId, createdById: by,
        },
      });
      // negating the SIGNED total does both directions: a payment lowers the client's
      // balance, a deduction/refund raises it — so Σ CLIENT ledger reproduces «Ост».
      await postLedger(LedgerAccount.CLIENT, LedgerSource.PAYMENT, p.total.toDP(2).negated(), { clientId: cid }, undefined, pay.id, p.date ?? undefined);
      // kassa KIRIM / CHIQIM — skipped for a driver hand-over (money never entered the till)
      if (cashboxId) await writeCash(cashboxId, refund ? CashDirection.OUT : CashDirection.IN, amount, pay.id, p.date ?? new Date(0), p.payer);
      // Only real incoming money settles orders (CLIENT_SETTLING_KINDS = [CLIENT_IN]).
      if (!refund) {
        const q = clientCash.get(cName) ?? [];
        q.push({ id: pay.id, date: p.date ?? new Date(0), seq: q.length, amount });
        clientCash.set(cName, q);
      }
    }
    // «Возврат паддон» — in-kind, no money; clamped so a typo can't drive a client negative
    if (p.palletReturn && p.palletReturn > 0) {
      const cid = await ensureClient(cName);
      const held = (await heldBeforeBatch(cid)) + (palletsDeliveredTo.get(cName) ?? 0) - (palletsReturnedBy.get(cName) ?? 0);
      const qty = Math.min(p.palletReturn, Math.max(held, 0));
      if (qty > 0) {
        await tx.palletTransaction.create({ data: { type: PalletTransactionType.RETURNED_BY_CLIENT, clientId: cid, qty, date: p.date ?? new Date(0), note: `Excel «${p.origin.sheetName}» r${p.origin.excelRow}`, importBatchId: batchId, createdById: by } });
        palletsReturnedBy.set(cName, (palletsReturnedBy.get(cName) ?? 0) + qty);
      }
    }
  }
  /** «Жами» qamramagan qatorlar — import qilinmadi, lekin preview ularni ayta oladi */
  const skippedTransfers = { count: 0, total: new D(0) };
  for (const f of factoryPayments) {
    // same rule as the client side: a negative transfer is money coming BACK from the
    // factory (FACTORY_REFUND) — it must post, not be dropped.
    if (!f.amount || f.amount.isZero()) continue;
    // The block's own «Жами» is the owner's declaration of what the factory received
    // (decision 2026-07-29). A row his SUM chain steps over is NOT imported — but it is
    // counted here and named row-by-row by ZAVOD_JAMIDAN_TASHQARI, so 56 000 000 can never
    // go missing quietly the way the 2026-07-27 layout change made 3 mlrd go missing.
    if (!f.inDeclaredTotal) {
      skippedTransfers.count++;
      skippedTransfers.total = skippedTransfers.total.plus(f.amount.abs());
      continue;
    }
    // The «Утказилган пул» block now records HOW each transfer travelled («bank»/«naxt»/
    // «click»), so the money leaves the kassa it really left and stands in the matching
    // factory pocket — naqd/Click ⇒ ADVANCE_CASH, o'tkazma ⇒ ADVANCE_BANK.
    const method = classifyFactoryChannel(f.channel);
    // ZAVOD_KANALI_NOMALUM (Sev.BLOCK) stops an unknown channel at review time; this is the
    // belt-and-braces guard for a resolvedJson that was hand-patched past it.
    if (method === null) {
      throw new BadRequestException(
        `«Утказилган пул» r${f.origin.excelRow}: «${f.channel}» kanali tanilmadi — «bank», «naxt» yoki «click» deb yozing.`,
      );
    }
    const bucket = advanceBucketFor(method);
    const cashboxId = await ensureCashbox(method);
    const refund = f.amount.isNegative();
    const amount = f.amount.abs().toDP(2);
    // Naming the channel is not decoration: without it a Naqd-kassa CHIQIM and a Click CHIQIM
    // both read «Zavodga oʼtkazma», which is the very defect already fixed on the client side
    // (307 identical «Excel import» rows made naqd indistinguishable from a transfer).
    const channelWord = method === PaymentMethod.CASH ? 'naqd'
      : method === PaymentMethod.CLICK ? 'Click'
      : method === PaymentMethod.CARD ? 'karta'
      : 'oʼtkazma';
    const pay = await tx.payment.create({
      data: {
        date: f.date ?? new Date(0),
        kind: refund ? PaymentKind.FACTORY_REFUND : PaymentKind.FACTORY_OUT,
        method, amount, factoryId: factory.id,
        // the «Утказилган пул» block has no receiver column — name the factory the money went
        // to, so the Payments journal and the printed receipt are not blank on 21 rows
        receiverName: f.receiver || input.factoryName || null,
        note: `Zavodga ${channelWord}${f.channel ? ` («${f.channel}»)` : ''}`,
        cashboxId, importBatchId: batchId, createdById: by,
      },
    });
    // Signed as-is, into the ADVANCE channel it travelled through: paying the factory
    // raises that advance (+), a refund draws it down (−). PAYABLE is left alone so the
    // owner's «Олинган» column stays readable next to «Берилган» — exactly the two numbers
    // the Лист1 «Завод» block shows, and exactly what «avansdan yechish» later moves.
    await postLedger(LedgerAccount.FACTORY, LedgerSource.PAYMENT, f.amount.toDP(2), { factoryId: factory.id }, undefined, pay.id, f.date ?? undefined, bucket);
    await writeCash(cashboxId, refund ? CashDirection.IN : CashDirection.OUT, amount, pay.id, f.date ?? new Date(0), `Zavodga ${channelWord}`); // kassa CHIQIM / KIRIM
    if (!refund) factoryCash.push({ id: pay.id, date: f.date ?? new Date(0), seq: factoryCash.length, free: amount, bucket });
  }

  // ── Pass C3: «Завод» bloki — o'tkazilgan pul olingan molni YOPADI ──
  //
  //   Олинган  3 035 493 990      ← Σ ORDER_COST (jurnal J ustuni)
  //   Берилган 3 371 089 420      ← «Утказилган пул» blokining «Жами»si
  //   ─────────────────────────
  //   qolgani    335 595 430      ← «zavodda qolgan bizni pulimiz» (Лист1 M180)
  //
  // That subtraction IS the owner's book: the transfers were payment FOR those trucks, not
  // a prepayment sitting untouched beside an open debt. Leaving both sides gross made the
  // site say «zavoddagi pulimiz 3 027 089 420» while the file said the remainder, and it
  // simultaneously claimed a 2,76 mlrd payable the owner does not owe.
  //
  // WHICH truck each so'm bought used to be a guess — oldest order first, oldest transfer
  // first — because the file only gave two totals. Since 2026-07-29 it gives the answer per
  // row («Завотга толов» + «тўлов тури»), and the owner states it as the rule:
  //
  //     «Сумма Приход 15 552 000 · Завотга толов 15 552 000 ⇒ full zavodga to'langan,
  //      bu buyurtma bo'yicha qarzdor emasmiz»
  //     «Завотга толов 0 · тўлов тури Нахт ⇒ zavodga NAQD qarzimizga qo'shiladi»
  //
  // So the settlement now buys exactly what column W says, no more (a fully-paid truck stops
  // consuming the pool the moment it is covered) and no less (an unpaid truck stays PAYABLE
  // even though there is advance money sitting right there — spending it is the owner's
  // deliberate act, exactly as live). FIFO survives only as the fallback for files that
  // predate the column, so re-importing a July workbook still reproduces its old numbers.
  //
  // Each draw writes exactly what PaymentsService.drawFromAdvance writes — a fromAdvance
  // PaymentAllocation plus the zero-sum ADVANCE_DRAW pair (ADVANCE_* −x / PAYABLE +x). The
  // factory's NET balance is untouched by a draw; only the split between pockets moves.
  //
  // Two details that are wrong-and-invisible if skipped:
  //  · the pool is walked SAME-POCKET FIRST (a naqd truck spends the naqd advance before it
  //    reaches into the o'tkazma one), so «Нахт» money is not quietly re-labelled bank money;
  //  · the allocation's priceKind is the ORDER'S OWN anchor, not the pocket's. factory-coverage
  //    divides the paid amount by totals[priceKind] to decide how much of the order is bought;
  //    with the pocket's kind, a 17 893 440 naqd truck settled out of a bank transfer would be
  //    divided by its (dearer) BANK price and read as part-unpaid forever.
  //
  // The draw amount is the order's OWN costTotal (the journal's number), NOT a price-book
  // lookup: one product can carry two cost prices on the same day (600x300x200 at 625 000
  // and 545 000), so a book-derived share would drift away from what the truck actually cost.
  const channelStat = () => ({ orders: 0, goods: new D(0), paid: new D(0) });
  const settlement = {
    drawn: new D(0), ordersSettled: 0, ordersPartial: 0, ordersUnpaid: 0,
    leftAtFactory: new D(0), unfunded: new D(0),
    skippedTransfers: skippedTransfers.count,
    skippedTransfersTotal: skippedTransfers.total,
    /** «тўлов тури» kesimi — Qarzlar sahifasidagi «naqd» / «o'tkazma» kartochkalari */
    naqd: channelStat(),
    otkazma: channelStat(),
  };
  {
    /** oldest-first inside each pocket; `cursor` is the FIFO head of the fallback walk */
    let cursor = 0;
    /** take up to `need` from the pool, preferring `prefer`'s pocket — returns what was taken */
    const drawInto = async (o: (typeof supply)[number], need: Prisma.Decimal): Promise<Prisma.Decimal> => {
      let left = need;
      let took = new D(0);
      // pass 1: the order's own pocket · pass 2: whatever is left anywhere
      for (const sameBucket of [true, false]) {
        for (let i = perOrderFactoryPay ? 0 : cursor; i < factoryCash.length && left.gt(0); i++) {
          const pay = factoryCash[i];
          if (pay.free.lte(0)) continue;
          // legacy FIFO is pocket-BLIND by design (it reproduced the pre-2026-07-29 files);
          // only the per-order mode prefers the truck's own pocket
          if (sameBucket && perOrderFactoryPay && pay.bucket !== o.bucket) continue;
          const take = D.min(pay.free, left).toDP(2);
          if (take.lte(0)) continue;
          const alloc = await tx.paymentAllocation.create({
            data: {
              paymentId: pay.id, orderId: o.id, amount: take,
              priceKind: o.priceKind, fromAdvance: true, createdById: by,
            },
          });
          // zero-sum pair: out of the advance channel … and onto this order's debt
          await postLedger(LedgerAccount.FACTORY, LedgerSource.ADVANCE_DRAW, take.negated(), { factoryId: factory.id }, o.id, pay.id, o.date, pay.bucket, alloc.id);
          await postLedger(LedgerAccount.FACTORY, LedgerSource.ADVANCE_DRAW, take, { factoryId: factory.id }, o.id, pay.id, o.date, FactoryBucket.PAYABLE, alloc.id);
          pay.free = pay.free.minus(take);
          left = left.minus(take);
          took = took.plus(take);
          settlement.drawn = settlement.drawn.plus(take);
        }
        // the legacy FIFO keeps ONE moving head across all orders (its pocket-blind walk is
        // what reproduced the old files); the per-order mode re-scans, since a fully-paid
        // truck may leave a transfer half-spent for a later one.
        if (!perOrderFactoryPay) {
          while (cursor < factoryCash.length && factoryCash[cursor].free.lte(0)) cursor++;
          break; // legacy mode never had a second, pocket-aware pass
        }
      }
      return took;
    };

    for (const o of supply) {
      const stat = o.bucket === FactoryBucket.ADVANCE_CASH ? settlement.naqd : settlement.otkazma;
      stat.orders++;
      stat.goods = stat.goods.plus(o.cost);
      // per-order mode buys exactly «Завотга толов»; legacy mode buys as much as the pool has
      const want = perOrderFactoryPay ? (o.paid ?? new D(0)) : o.cost;
      const covered = want.gt(0) ? await drawInto(o, want) : new D(0);
      stat.paid = stat.paid.plus(covered);
      if (covered.lt(want)) settlement.unfunded = settlement.unfunded.plus(want.minus(covered));
      if (covered.lte(0)) { settlement.ordersUnpaid++; continue; }
      // Fully bought ⇒ the cost is FINAL at the journal's own price. No COST_ADJUSTMENT:
      // the number did not change, it was never provisional in any real sense.
      if (o.cost.minus(covered).lte(new D('0.5'))) {
        settlement.ordersSettled++;
        await tx.orderItem.update({ where: { id: o.itemId }, data: { finalCostPricePerM3: o.costPerM3 } });
        await tx.order.update({ where: { id: o.id }, data: { costStatus: CostStatus.FINAL, costFinalizedAt: o.date } });
      } else {
        settlement.ordersPartial++;
        await tx.order.update({ where: { id: o.id }, data: { costStatus: CostStatus.PARTIAL } });
      }
    }
    settlement.leftAtFactory = factoryCash.reduce((a, p) => a.plus(p.free), new D(0));
  }

  // ── Pass C2: FIFO — client money settles his OLDEST open order first ──
  // Owner rule 2026-07-20 (common/auto-allocate.ts): there is no manual «taqsimlash» for
  // client money any more. The import used to write ZERO allocations, so every imported
  // order landed in the «toʼlanmagan» tab even for clients who had paid in full, and the
  // order card showed the whole sale still outstanding. These rows move NO money — a
  // client's balance is the plain sum of his CLIENT ledger rows, already posted above —
  // they only record WHICH order each payment answered for.
  //
  // Scope is deliberately THIS BATCH: a file's money settles that file's orders. Reaching
  // across batches would create allocations whose payment belongs to another import, which
  // is exactly the «tashqi toʼlov bogʼlangan» condition that makes a rollback refuse — an
  // APPEND would quietly make the previous import un-rollbackable.
  const allocation = { placed: new D(0), advanceLeft: new D(0), fullyPaid: 0 };
  for (const [cName, cash] of clientCash) {
    const orders = (ordersOf.get(cName) ?? []).sort((a, b) => a.date.getTime() - b.date.getTime() || a.seq - b.seq);
    const queue = [...cash].sort((a, b) => a.date.getTime() - b.date.getTime() || a.seq - b.seq);
    let cursor = 0;
    for (const pay of queue) {
      let left = pay.amount;
      while (left.gt(0) && cursor < orders.length) {
        const o = orders[cursor];
        const open = o.chargeable.minus(o.settled);
        if (open.lte(0)) { cursor++; continue; }
        const take = (open.lt(left) ? open : left).toDP(2);
        if (take.lte(0)) { cursor++; continue; }
        await tx.paymentAllocation.create({ data: { paymentId: pay.id, orderId: o.id, amount: take, createdById: by } });
        o.settled = o.settled.plus(take);
        left = left.minus(take);
        allocation.placed = allocation.placed.plus(take);
        if (o.chargeable.minus(o.settled).lte(0)) cursor++;
      }
      // Whatever FIFO could not place is a genuine standing advance (the client paid ahead,
      // or paid more than this file's orders) — it stays free on the payment, as live.
      if (left.gt(0)) allocation.advanceLeft = allocation.advanceLeft.plus(left);
    }
  }
  for (const list of ordersOf.values()) {
    for (const o of list) if (o.chargeable.gt(0) && o.chargeable.minus(o.settled).lte(0)) allocation.fullyPaid++;
  }

  // REPLACE only: reconnect AGENT users to the rebuilt (same-named) agents.
  if (userAgentLinks.length) {
    for (const link of userAgentLinks) {
      const agent = await tx.agent.findUnique({ where: { name: link.agentName }, select: { id: true } });
      if (agent) await tx.user.update({ where: { id: link.userId }, data: { agentId: agent.id } });
    }
  }

  // ── Pass D: kassa never below zero ──
  // A period that paid the factory/drivers ahead of collection would draw a box
  // negative. The owner's rule: the dealer covers the gap from his OWN pocket, the
  // payment still counts as made, and the kassa never shows a minus. We honour that
  // by topping up each box that would end negative with a «Diller kapitali» IN row —
  // the box lands at 0 (or above), and as clients pay the box climbs toward the profit.
  await ensureCashboxesNonNegative(tx, batchId, by);

  // ── Pass E: balances (from this batch only) ──
  return computeBalances(tx, batchId, allocation, settlement);
}

/**
 * Top up every cashbox this batch touched whose ALL-TIME balance would end below zero,
 * with a single CAPITAL (dealer's own money) IN row dated at the box's earliest
 * movement. Guarantees the never-below-zero invariant on the displayed balance without
 * clamping the real factory/driver outflows (which must still reconcile to the Excel).
 */
async function ensureCashboxesNonNegative(tx: Tx, batchId: string, by: string | null): Promise<void> {
  const touched = await tx.cashTransaction.findMany({
    where: { importBatchId: batchId },
    select: { cashboxId: true },
    distinct: ['cashboxId'],
  });
  for (const { cashboxId } of touched) {
    // lock the box row FOR UPDATE (same mutex the live kassa ops take) so a concurrent
    // manual/transfer OUT can't commit between our balance read and this commit and leave
    // the box negative — the other writer blocks until we finish, then re-reads.
    await tx.$executeRaw`SELECT id FROM "Cashbox" WHERE id = ${cashboxId} FOR UPDATE`;
    const agg = await tx.cashTransaction.groupBy({ by: ['direction'], where: { cashboxId }, _sum: { amount: true } });
    let bal = new D(0);
    for (const g of agg) bal = g.direction === CashDirection.IN ? bal.plus(g._sum.amount ?? 0) : bal.minus(g._sum.amount ?? 0);
    if (bal.isNegative()) {
      const need = bal.negated().toDP(2);
      const earliest = await tx.cashTransaction.findFirst({ where: { cashboxId }, orderBy: [{ date: 'asc' }, { createdAt: 'asc' }], select: { date: true } });
      await tx.cashTransaction.create({
        data: {
          cashboxId, date: earliest?.date ?? new Date(0), direction: CashDirection.IN,
          amount: need, source: CashSource.CAPITAL, importBatchId: batchId,
          note: "Diller kapitali — kassa manfiy boʼlmasligi uchun", createdById: by,
        },
      });
    }
  }
}

/**
 * REPLACE wipe: delete every business/transactional row in FK-safe (children-first)
 * order — Prisma FKs are onDelete: Restrict, so ordering (not CASCADE) is what keeps it
 * valid. Preserves User + AppSetting + AuditLog + AI chat + this import's own staging.
 * Other ImportBatch rows are removed (their staging cascades); their business rows are
 * already gone by the time we reach them. User→Agent links are nulled first so agents
 * can be deleted (they are re-created from the workbook with fresh ids).
 */
async function wipeAllBusinessData(tx: Tx, keepBatchId: string): Promise<void> {
  await tx.$executeRaw`UPDATE "User" SET "agentId" = NULL`;
  await tx.document.deleteMany({});
  await tx.cashTransaction.deleteMany({});
  await tx.expense.deleteMany({});
  // LedgerEntry BEFORE PaymentAllocation: an ADVANCE_DRAW row references its allocation
  // (LedgerEntry_allocationId_fkey, ON DELETE RESTRICT), so PaymentAllocation is now the
  // PARENT of the pair. Deleting it first aborts the whole REPLACE import with a 23503 on
  // any database where «avansdan yechish» has ever been used.
  await tx.ledgerEntry.deleteMany({});
  await tx.paymentAllocation.deleteMany({});
  await tx.bonusTransaction.deleteMany({});
  await tx.bonusProgram.deleteMany({});
  await tx.palletTransaction.deleteMany({});
  await tx.orderComment.deleteMany({});
  await tx.orderStatusHistory.deleteMany({});
  await tx.orderItem.deleteMany({});
  await tx.payment.deleteMany({});
  await tx.order.deleteMany({});
  await tx.clientPrice.deleteMany({});
  await tx.clientAlias.deleteMany({});
  await tx.productPrice.deleteMany({});
  await tx.product.deleteMany({});
  await tx.client.deleteMany({});
  await tx.vehicle.deleteMany({});
  await tx.logisticsRoute.deleteMany({});
  await tx.agent.deleteMany({});
  await tx.factory.deleteMany({});
  await tx.region.deleteMany({});
  await tx.cashbox.deleteMany({});
  await tx.expenseCategory.deleteMany({});
  await tx.legalEntity.deleteMany({});
  await tx.importBatch.deleteMany({ where: { id: { not: keepBatchId } } });
}

interface ChannelStat { orders: number; goods: Prisma.Decimal; paid: Prisma.Decimal }
interface Settlement {
  drawn: Prisma.Decimal;
  ordersSettled: number;
  ordersPartial: number;
  ordersUnpaid: number;
  leftAtFactory: Prisma.Decimal;
  unfunded: Prisma.Decimal;
  skippedTransfers: number;
  skippedTransfersTotal: Prisma.Decimal;
  naqd: ChannelStat;
  otkazma: ChannelStat;
}

async function computeBalances(
  tx: Tx,
  batchId: string,
  allocation: { placed: Prisma.Decimal; advanceLeft: Prisma.Decimal; fullyPaid: number },
  settlement: Settlement,
): Promise<PreviewResult> {
  const led = await tx.ledgerEntry.groupBy({ by: ['account', 'source'], where: { importBatchId: batchId }, _sum: { amount: true } });
  const sum = (pred: (a: LedgerAccount, s: LedgerSource) => boolean) =>
    led.filter((g) => pred(g.account, g.source)).reduce((a, g) => a.plus(g._sum.amount ?? 0), new D(0));

  // The three factory pockets, read the way the Лист1 «Завод» block prints them.
  const buckets = await tx.ledgerEntry.groupBy({
    by: ['factoryBucket'],
    where: { importBatchId: batchId, account: LedgerAccount.FACTORY },
    _sum: { amount: true },
  });
  const bucket = (b: FactoryBucket) =>
    buckets.filter((g) => g.factoryBucket === b).reduce((a, g) => a.plus(g._sum.amount ?? 0), new D(0));

  const factoryBalance = sum((a) => a === LedgerAccount.FACTORY);
  const clientDebt = sum((a) => a === LedgerAccount.CLIENT);
  const vehicleBalance = sum((a) => a === LedgerAccount.VEHICLE);
  const saleTotal = sum((a, s) => a === LedgerAccount.CLIENT && s === LedgerSource.ORDER_SALE);
  const costTotal = sum((a, s) => a === LedgerAccount.FACTORY && s === LedgerSource.ORDER_COST);
  const factoryPaid = sum((a, s) => a === LedgerAccount.FACTORY && s === LedgerSource.PAYMENT);
  const clientPaid = sum((a, s) => a === LedgerAccount.CLIENT && s === LedgerSource.PAYMENT);

  const orders = await tx.order.count({ where: { importBatchId: batchId } });
  const deliv = await tx.palletTransaction.aggregate({ where: { importBatchId: batchId, type: PalletTransactionType.DELIVERED_TO_CLIENT }, _sum: { qty: true } });
  const ret = await tx.palletTransaction.aggregate({ where: { importBatchId: batchId, type: PalletTransactionType.RETURNED_BY_CLIENT }, _sum: { qty: true } });

  // kassa proof: real client money IN and factory+driver money OUT are the PAYMENT rows
  // (reconcile to the Excel «Утказилган пул»); CAPITAL rows (owner's own money) are the
  // top-up that keeps a box from ending negative — reported separately, not as «kirim».
  const cash = await tx.cashTransaction.groupBy({ by: ['direction', 'source'], where: { importBatchId: batchId }, _sum: { amount: true } });
  const cashSum = (dir: CashDirection, src: CashSource) =>
    cash.filter((c) => c.direction === dir && c.source === src).reduce((a, c) => a.plus(c._sum.amount ?? 0), new D(0));
  const cashIn = cashSum(CashDirection.IN, CashSource.PAYMENT);
  const cashOut = cashSum(CashDirection.OUT, CashSource.PAYMENT);
  const cashCapital = cashSum(CashDirection.IN, CashSource.CAPITAL);

  // per-box proof (see PreviewResult.cashboxes)
  const perBox = await tx.cashTransaction.groupBy({
    by: ['cashboxId', 'direction', 'source'],
    where: { importBatchId: batchId },
    _sum: { amount: true },
  });
  const boxIds = [...new Set(perBox.map((r) => r.cashboxId))];
  const boxRows = boxIds.length
    ? await tx.cashbox.findMany({ where: { id: { in: boxIds } }, select: { id: true, name: true, type: true } })
    : [];
  const boxById = new Map(boxRows.map((b) => [b.id, b]));
  const boxAgg = new Map<string, { in: Prisma.Decimal; out: Prisma.Decimal; capital: Prisma.Decimal }>();
  for (const r of perBox) {
    const slot = boxAgg.get(r.cashboxId) ?? { in: new D(0), out: new D(0), capital: new D(0) };
    const amt = new D(r._sum.amount ?? 0);
    if (r.source === CashSource.CAPITAL) slot.capital = slot.capital.plus(amt);
    else if (r.direction === CashDirection.IN) slot.in = slot.in.plus(amt);
    else slot.out = slot.out.plus(amt);
    boxAgg.set(r.cashboxId, slot);
  }
  const cashboxes = [...boxAgg].map(([id, v]) => ({
    name: boxById.get(id)?.name ?? id,
    type: boxById.get(id)?.type ?? CashboxType.CASH,
    in: v.in.toFixed(2),
    out: v.out.toFixed(2),
    capital: v.capital.toFixed(2),
    balance: v.in.minus(v.out).plus(v.capital).toFixed(2),
  })).sort((a, b) => a.name.localeCompare(b.name));

  // money that bypassed the kassa on purpose (owner rule 2026-07-23)
  const driverAgg = await tx.payment.aggregate({
    where: { importBatchId: batchId, cashboxId: null, kind: { in: [PaymentKind.CLIENT_IN, PaymentKind.CLIENT_REFUND] } },
    _sum: { amount: true },
  });
  const transportAgg = await tx.payment.aggregate({
    where: { importBatchId: batchId, kind: PaymentKind.VEHICLE_OUT },
    _sum: { amount: true },
  });

  return {
    orders,
    factoryBalance: factoryBalance.toFixed(2),
    // «Олинган» / «Берилган» are reported from the SOURCE rows, not from the buckets — the
    // draw moves value between buckets, so a bucket read would show them already netted and
    // the owner could no longer tick his two columns off the sheet.
    factoryGoodsTaken: costTotal.negated().toFixed(2),
    factoryTransferred: factoryPaid.toFixed(2),
    factorySettled: settlement.drawn.toFixed(2),
    factoryOrdersSettled: settlement.ordersSettled,
    factoryOrdersPartial: settlement.ordersPartial,
    factoryOrdersUnpaid: settlement.ordersUnpaid,
    factoryByChannel: [
      {
        channel: "o'tkazma" as const, orders: settlement.otkazma.orders,
        goods: settlement.otkazma.goods.toFixed(2), paid: settlement.otkazma.paid.toFixed(2),
        debt: settlement.otkazma.goods.minus(settlement.otkazma.paid).toFixed(2),
      },
      {
        channel: 'naqd' as const, orders: settlement.naqd.orders,
        goods: settlement.naqd.goods.toFixed(2), paid: settlement.naqd.paid.toFixed(2),
        debt: settlement.naqd.goods.minus(settlement.naqd.paid).toFixed(2),
      },
    ].filter((c) => c.orders > 0),
    factoryTransfersSkipped: settlement.skippedTransfers,
    factoryTransfersSkippedTotal: settlement.skippedTransfersTotal.toFixed(2),
    factoryUnfunded: settlement.unfunded.toFixed(2),
    factoryPayable: bucket(FactoryBucket.PAYABLE).toFixed(2),
    factoryAdvanceBank: bucket(FactoryBucket.ADVANCE_BANK).toFixed(2),
    factoryAdvanceCash: bucket(FactoryBucket.ADVANCE_CASH).toFixed(2),
    allocatedToOrders: allocation.placed.toFixed(2),
    ordersFullyPaid: allocation.fullyPaid,
    clientAdvanceLeft: allocation.advanceLeft.toFixed(2),
    clientDebtTotal: clientDebt.toFixed(2),
    vehicleBalance: vehicleBalance.toFixed(2),
    saleTotal: saleTotal.toFixed(2),
    costTotal: costTotal.negated().toFixed(2),
    factoryPaidTotal: factoryPaid.toFixed(2),
    clientPaidTotal: clientPaid.negated().toFixed(2),
    palletsOut: (deliv._sum.qty ?? 0) - (ret._sum.qty ?? 0),
    cashIn: cashIn.toFixed(2),
    cashOut: cashOut.toFixed(2),
    cashCapital: cashCapital.toFixed(2),
    cashboxes,
    clientPaidDriver: new D(driverAgg._sum.amount ?? 0).toFixed(2),
    transportPaidByClient: new D(transportAgg._sum.amount ?? 0).toFixed(2),
  };
}
