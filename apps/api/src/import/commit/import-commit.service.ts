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
// The workbook records WHO paid and HOW in one free-text cell. Reading it is what puts
// the money in the right cashbox: 188 mln of «шопр учун барди» cash used to land in the
// BANK box because the old rule was «anything that isn't нахт is a transfer».
//
// «Шовот»/«SHOVOT» is a PLACE that appears in firm names («Шовот темур битон хусусий
// корхонаси»), so the driver pattern must never match a bare «шов».
const DRIVER_NOTE = /шоп[иоы]?р|шоф[йи]?[оёе]?р|шовйор|shop[io]?r|shof[yi]?or|haydovchi|хайдовчи/i;
const CASH_NOTE = /нахт|нақт|нақд|накд|naqd|naxt|нал\b/i;
const CLICK_NOTE = /клик|click/i;
const CARD_NOTE = /пластик|plastik|карта|karta/i;

/**
 * Which cash channel a CLIENT payment row came through. Driver money is physically cash
 * handed over at the truck; «Клик» is the Click wallet; «Нахт» is naqd; everything else
 * in this template is a firm paying by transfer (the cell holds its legal name).
 */
export function clientPaymentMethod(note: string): PaymentMethod {
  const t = (note ?? '').trim();
  if (!t) return PaymentMethod.BANK;
  if (CLICK_NOTE.test(t)) return PaymentMethod.CLICK;
  if (CARD_NOTE.test(t)) return PaymentMethod.CARD;
  if (DRIVER_NOTE.test(t) || CASH_NOTE.test(t)) return PaymentMethod.CASH;
  return PaymentMethod.BANK;
}

/**
 * Which channel a FACTORY settlement came through. Egasining ko'rsatmasi: «Утказилган
 * пул» bloki — bu BANK O'TKAZMASI, shuning uchun standart kanal BANK va u zavoddagi
 * pulni ADVANCE_BANK cho'ntagiga qo'yadi.
 */
export function factoryPaymentMethod(payer: string): PaymentMethod {
  const t = (payer ?? '').trim();
  if (!t) return PaymentMethod.BANK;
  if (CARD_NOTE.test(t)) return PaymentMethod.CARD;
  if (CASH_NOTE.test(t)) return PaymentMethod.CASH;
  return PaymentMethod.BANK;
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
/** which cost basis a draw from that channel applies (mirrors PaymentsService.bucketPriceKind) */
function bucketPriceKind(bucket: FactoryBucket): PriceKind {
  return bucket === FactoryBucket.ADVANCE_CASH ? PriceKind.FACTORY_CASH : PriceKind.FACTORY_BANK;
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
  /** hali yopilmagan mol qarzi (PAYABLE) — 0 bo'lsa hammasi yopilgan */
  factoryPayable: string;
  /** o'tkazmadan zavodda qolgani */
  factoryAdvanceBank: string;
  /** naqddan zavodda qolgani (0 for this template — every settlement is a transfer) */
  factoryAdvanceCash: string;
  clientDebtTotal: string; // Σ CLIENT ledger — >0 = clients owe us
  vehicleBalance: string; // Σ VEHICLE ledger — ~0 when «Туланди» rows post VEHICLE_OUT
  saleTotal: string; // Σ ORDER_SALE
  costTotal: string; // Σ ORDER_COST (blocks ONLY — pallets are an in-kind deposit, Лист1 col J)
  factoryPaidTotal: string; // Σ FACTORY_OUT
  clientPaidTotal: string; // Σ CLIENT_IN
  palletsOut: number; // delivered − returned
  cashIn: string; // Σ kassa KIRIM (client money into cashboxes — PAYMENT rows only)
  cashOut: string; // Σ kassa CHIQIM (factory + driver money out — PAYMENT rows only)
  cashCapital: string; // Σ «Diller kapitali» injected so no box ends below zero
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
   *   ORDER_COST  → PAYABLE       (Лист1 «Завод · Олинган» = −2 672 144 640)
   *   FACTORY_OUT → ADVANCE_BANK  (Лист1 «Завод · Берилган» = +2 971 089 420)
   *   Σ           = the workbook's own «Завод» delta   (+298 944 780)
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
  /** Write one import kassa row (no never-below-zero guard — historical cash, see note above). */
  const writeCash = (cashboxId: string, direction: CashDirection, amount: Prisma.Decimal, paymentId: string, date: Date) =>
    tx.cashTransaction.create({
      data: {
        cashboxId, date, direction, amount: amount.toDP(2), source: CashSource.PAYMENT,
        paymentId, importBatchId: batchId, note: 'Excel import', createdById: by,
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
  const supply: Array<{ id: string; itemId: string; date: Date; cost: Prisma.Decimal; costPerM3: Prisma.Decimal }> = [];
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

    // rebuild the catalog price book from the row's real prices (see priceObs above)
    const salePrice = r.salePrice != null ? new D(String(r.salePrice)) : m3.gt(0) ? saleTotal.div(m3) : null;
    observePrice(pid, PriceKind.DEALER_SALE, salePrice, date);
    observePrice(pid, PriceKind.FACTORY_BANK, costPrice, date);

    const order = await tx.order.create({
      data: {
        orderNo: dryRun
          ? `DRY-${String(++n).padStart(6, '0')}`
          : `ORD-${String(await nextOrderSeq(tx)).padStart(6, '0')}`,
        date, status: OrderStatus.COMPLETED, completedAt: date,
        clientId: cid, factoryId: factory.id, vehicleId: vid,
        agentId: clientAgentId.get(cName) ?? null,
        saleTotal: saleTotal.toDP(2), costTotal: costTotal.toDP(2), costStatus: CostStatus.PROVISIONAL,
        // The workbook's factory settlements are all transfers («Утказилган пул»), and every
        // imported item is priced at FACTORY_BANK — so the intent is BANK, not «aniq emas».
        // Leaving it UNKNOWN would park all of history in the dashboard's undetermined-profit
        // bucket and zero out «sof foyda» for the entire imported period.
        factoryPayIntent: FactoryPayIntent.BANK,
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
            provisionalPriceKind: PriceKind.FACTORY_BANK,
            costPricePerM3: costPrice.toDP(6),
            costTotal: costTotal.toDP(2),
          }],
        },
      },
      include: { items: { select: { id: true } } },
    });
    if (costTotal.gt(0)) {
      supply.push({ id: order.id, itemId: order.items[0].id, date, cost: costTotal.toDP(2), costPerM3: costPrice.toDP(6) });
    }

    // Live parity: OrdersService.create writes the birth transition (null → COMPLETED).
    // Without it an imported order's timeline opens empty and reads as never finalized.
    await tx.orderStatusHistory.create({ data: { orderId: order.id, from: null, to: OrderStatus.COMPLETED, byId: by, note: 'Excel import' } });

    // CLIENT +sale (client owes us)   ·   FACTORY −cost (we owe factory, PAYABLE bucket)
    await postLedger(LedgerAccount.CLIENT, LedgerSource.ORDER_SALE, saleTotal.toDP(2), { clientId: cid }, order.id, undefined, date);
    await postLedger(LedgerAccount.FACTORY, LedgerSource.ORDER_COST, costTotal.toDP(2).negated(), { factoryId: factory.id }, order.id, undefined, date, FactoryBucket.PAYABLE);

    // VEHICLE −cost; if the dealer already paid the driver, a VEHICLE_OUT payment nets it to 0
    if (transportCost.gt(0) && vid) {
      await postLedger(LedgerAccount.VEHICLE, LedgerSource.TRANSPORT_COST, transportCost.toDP(2).negated(), { vehicleId: vid }, order.id, undefined, date);
      if (paid) {
        const cashboxId = await ensureCashbox(PaymentMethod.CASH); // driver paid in cash
        const pay = await tx.payment.create({ data: { date, kind: PaymentKind.VEHICLE_OUT, method: PaymentMethod.CASH, amount: transportCost.toDP(2), vehicleId: vid, cashboxId, importBatchId: batchId, createdById: by } });
        // The ALLOCATION is what makes «Туланди» survive. transportPaidStatus is no longer a
        // stored flag anyone may trust: common/transport.ts recomputeTransportStatus derives it
        // from Σ active VEHICLE_OUT/TRANSPORT_DIRECT allocations, and it runs on every later
        // edit/void. An imported order with a payment but no allocation flipped straight back
        // to UNPAID the first time the owner touched it.
        await tx.paymentAllocation.create({ data: { paymentId: pay.id, orderId: order.id, amount: transportCost.toDP(2), createdById: by } });
        await postLedger(LedgerAccount.VEHICLE, LedgerSource.PAYMENT, transportCost.toDP(2), { vehicleId: vid }, order.id, pay.id, date);
        await writeCash(cashboxId, CashDirection.OUT, transportCost.toDP(2), pay.id, date); // kassa CHIQIM
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
      // Which cashbox this money really belongs in. «шопр учун барди» / «Шофйор пули» /
      // «Нахт» is CASH the client handed over, «Клик» is the Click wallet, and the rest of
      // the «Примечание» cells hold a firm's legal name — a transfer. The old rule («not
      // нахт ⇒ BANK») filed 188 mln of driver cash into the bank box.
      const method = clientPaymentMethod(p.payer);
      const cashboxId = await ensureCashbox(method);
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
          ...(refund ? {} : { payerName: p.payer || null }),
          note: refund ? [p.payer, p.note].filter(Boolean).join(' · ') || null : p.note || null,
          cashboxId, importBatchId: batchId, createdById: by,
        },
      });
      // negating the SIGNED total does both directions: a payment lowers the client's
      // balance, a deduction/refund raises it — so Σ CLIENT ledger reproduces «Ост».
      await postLedger(LedgerAccount.CLIENT, LedgerSource.PAYMENT, p.total.toDP(2).negated(), { clientId: cid }, undefined, pay.id, p.date ?? undefined);
      await writeCash(cashboxId, refund ? CashDirection.OUT : CashDirection.IN, amount, pay.id, p.date ?? new Date(0)); // kassa KIRIM / CHIQIM
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
  for (const f of factoryPayments) {
    // same rule as the client side: a negative transfer is money coming BACK from the
    // factory (FACTORY_REFUND) — it must post, not be dropped.
    if (!f.amount || f.amount.isZero()) continue;
    // «Утказилган пул» = BANK O'TKAZMA (egasining ko'rsatmasi) — the template carries no
    // payer column, so BANK is both the default and the truth for this workbook.
    const method = factoryPaymentMethod(f.payer);
    const bucket = advanceBucketFor(method); // BANK ⇒ ADVANCE_BANK
    const cashboxId = await ensureCashbox(method);
    const refund = f.amount.isNegative();
    const amount = f.amount.abs().toDP(2);
    const pay = await tx.payment.create({
      data: {
        date: f.date ?? new Date(0),
        kind: refund ? PaymentKind.FACTORY_REFUND : PaymentKind.FACTORY_OUT,
        method, amount, factoryId: factory.id, receiverName: f.receiver || null,
        cashboxId, importBatchId: batchId, createdById: by,
      },
    });
    // Signed as-is, into the ADVANCE channel it travelled through: paying the factory
    // raises that advance (+), a refund draws it down (−). PAYABLE is left alone so the
    // owner's «Олинган» column stays readable next to «Берилган» — exactly the two numbers
    // the Лист1 «Завод» block shows, and exactly what «avansdan yechish» later moves.
    await postLedger(LedgerAccount.FACTORY, LedgerSource.PAYMENT, f.amount.toDP(2), { factoryId: factory.id }, undefined, pay.id, f.date ?? undefined, bucket);
    await writeCash(cashboxId, refund ? CashDirection.IN : CashDirection.OUT, amount, pay.id, f.date ?? new Date(0)); // kassa CHIQIM / KIRIM
    if (!refund) factoryCash.push({ id: pay.id, date: f.date ?? new Date(0), seq: factoryCash.length, free: amount, bucket });
  }

  // ── Pass C3: «Завод» bloki — o'tkazilgan pul olingan molni YOPADI ──
  //
  //   Олинган  2 672 144 640      ← Σ ORDER_COST (jurnal J ustuni)
  //   Берилган 2 971 089 420      ← Σ «Утказилган пул»
  //   ─────────────────────────
  //   qolgani    298 944 780      ← «zavodda qolgan bizni pulimiz»
  //
  // That subtraction IS the owner's book: the transfers were payment FOR those trucks, not
  // a prepayment sitting untouched beside an open debt. Leaving both sides gross made the
  // site say «zavoddagi pulimiz 2 971 089 420» while the file said 298 944 780, and it
  // simultaneously claimed a 2,67 mlrd payable the owner does not owe.
  //
  // So the import performs the same «avansdan yechish» the owner would have to click 144
  // times: oldest order first, funded by the oldest transfer first, writing exactly what
  // PaymentsService.drawFromAdvance writes — a fromAdvance PaymentAllocation plus the
  // zero-sum ADVANCE_DRAW pair (ADVANCE_BANK −x / PAYABLE +x). The factory's NET balance is
  // untouched by the draw; only the split between the two pockets moves.
  //
  // The draw amount is the order's OWN costTotal (the journal's number), NOT a price-book
  // lookup: one product can carry two cost prices on the same day (600x300x200 at 625 000
  // and 545 000), so a book-derived share would drift away from what the truck actually cost.
  const settlement = { drawn: new D(0), ordersSettled: 0, leftAtFactory: new D(0) };
  {
    let cursor = 0;
    for (const o of supply) {
      let need = o.cost;
      let covered = new D(0);
      while (need.gt(0) && cursor < factoryCash.length) {
        const pay = factoryCash[cursor];
        if (pay.free.lte(0)) { cursor++; continue; }
        const take = (pay.free.lt(need) ? pay.free : need).toDP(2);
        if (take.lte(0)) { cursor++; continue; }
        const alloc = await tx.paymentAllocation.create({
          data: {
            paymentId: pay.id, orderId: o.id, amount: take,
            priceKind: bucketPriceKind(pay.bucket), fromAdvance: true, createdById: by,
          },
        });
        // zero-sum pair: out of the advance channel … and onto this order's debt
        await postLedger(LedgerAccount.FACTORY, LedgerSource.ADVANCE_DRAW, take.negated(), { factoryId: factory.id }, o.id, pay.id, o.date, pay.bucket, alloc.id);
        await postLedger(LedgerAccount.FACTORY, LedgerSource.ADVANCE_DRAW, take, { factoryId: factory.id }, o.id, pay.id, o.date, FactoryBucket.PAYABLE, alloc.id);
        pay.free = pay.free.minus(take);
        need = need.minus(take);
        covered = covered.plus(take);
        settlement.drawn = settlement.drawn.plus(take);
        if (pay.free.lte(0)) cursor++;
      }
      if (covered.lte(0)) continue;
      // Fully bought ⇒ the cost is FINAL at the journal's own price. No COST_ADJUSTMENT:
      // the number did not change, it was never provisional in any real sense.
      if (need.lte(0)) {
        settlement.ordersSettled++;
        await tx.orderItem.update({ where: { id: o.itemId }, data: { finalCostPricePerM3: o.costPerM3 } });
        await tx.order.update({ where: { id: o.id }, data: { costStatus: CostStatus.FINAL, costFinalizedAt: o.date } });
      } else {
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

async function computeBalances(
  tx: Tx,
  batchId: string,
  allocation: { placed: Prisma.Decimal; advanceLeft: Prisma.Decimal; fullyPaid: number },
  settlement: { drawn: Prisma.Decimal; ordersSettled: number; leftAtFactory: Prisma.Decimal },
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
  };
}
