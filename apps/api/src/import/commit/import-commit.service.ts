import {
  Prisma, PrismaClient, LedgerAccount, LedgerSource, OrderStatus, CostStatus, PriceKind,
  TransportMode, TransportPaidStatus, PaymentKind, PaymentMethod, PalletTransactionType,
  CashboxType, CashDirection, CashSource,
} from '@prisma/client';
import type { ShipmentRow, ClientPaymentRow, FactoryPaymentRow } from '../parse/types';
import { normalizePlate, normalizeSize } from '../resolve/entity-resolver';

const D = Prisma.Decimal;
type Tx = Prisma.TransactionClient;

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
  factoryBalance: string; // Σ FACTORY ledger — >0 = advance at factory (Лист1 «Завод» bloki, poddon puli bilan)
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
      create: { factoryId: factory.id, name: key, size: key },
    });
    productId.set(key, p.id);
    return p.id;
  };

  const vehicleId = new Map<string, string>();
  const ensureVehicle = async (plateRaw: string): Promise<string | null> => {
    const plate = normalizePlate(plateRaw);
    if (!plate) return null;
    if (vehicleId.has(plate)) return vehicleId.get(plate)!;
    let v = await tx.vehicle.findFirst({ where: { plate, oneTime: false } });
    if (!v) v = await tx.vehicle.create({ data: { name: plate, plate } });
    vehicleId.set(plate, v.id);
    return v.id;
  };

  const postLedger = (account: LedgerAccount, source: LedgerSource, amount: Prisma.Decimal, party: { clientId?: string; factoryId?: string; vehicleId?: string }, orderId?: string, paymentId?: string, date?: Date) =>
    tx.ledgerEntry.create({
      data: {
        date: date ?? new Date(0),
        account, source, amount,
        clientId: party.clientId ?? null,
        factoryId: party.factoryId ?? null,
        vehicleId: party.vehicleId ?? null,
        orderId: orderId ?? null,
        paymentId: paymentId ?? null,
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
    // Factory debt = BLOCKS ONLY (Лист1 col J; the owner's «Завод» block nets against
    // this, −78 401 100 on the reference file). Pallet money (col M) is NOT owed —
    // pallets are a returnable deposit tracked in UNITS via PalletTransaction; a lost
    // pallet is charged to the CLIENT via pallets/charge-lost, never to the factory.
    const costTotal = m3.mul(costPrice);
    const transportCost = r.transport ?? new D(0);
    const paid = transportCost.gt(0) && transportPaid(r.autoPaid);

    const order = await tx.order.create({
      data: {
        orderNo: dryRun
          ? `DRY-${String(++n).padStart(6, '0')}`
          : `ORD-${String(await nextOrderSeq(tx)).padStart(6, '0')}`,
        date, status: OrderStatus.COMPLETED, completedAt: date,
        clientId: cid, factoryId: factory.id, vehicleId: vid,
        agentId: clientAgentId.get(cName) ?? null,
        saleTotal: saleTotal.toDP(2), costTotal: costTotal.toDP(2), costStatus: CostStatus.PROVISIONAL,
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
    });

    // CLIENT +sale (client owes us)   ·   FACTORY −cost (we owe factory)
    await postLedger(LedgerAccount.CLIENT, LedgerSource.ORDER_SALE, saleTotal.toDP(2), { clientId: cid }, order.id, undefined, date);
    await postLedger(LedgerAccount.FACTORY, LedgerSource.ORDER_COST, costTotal.toDP(2).negated(), { factoryId: factory.id }, order.id, undefined, date);

    // VEHICLE −cost; if the dealer already paid the driver, a VEHICLE_OUT payment nets it to 0
    if (transportCost.gt(0) && vid) {
      await postLedger(LedgerAccount.VEHICLE, LedgerSource.TRANSPORT_COST, transportCost.toDP(2).negated(), { vehicleId: vid }, order.id, undefined, date);
      if (paid) {
        const cashboxId = await ensureCashbox(PaymentMethod.CASH); // driver paid in cash
        const pay = await tx.payment.create({ data: { date, kind: PaymentKind.VEHICLE_OUT, method: PaymentMethod.CASH, amount: transportCost.toDP(2), vehicleId: vid, cashboxId, importBatchId: batchId, createdById: by } });
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
  }

  // ── Pass C: client payments (CLIENT_IN + in-kind pallet returns) & factory payments (FACTORY_OUT) ──
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
    if (p.total && p.total.gt(0)) {
      const cid = await ensureClient(cName);
      // the payment's agent = the agent SHEET it physically sits on (its daftar), which
      // survives a mid-period client handover; vote-winner only as fallback
      const agentId = p.agentRaw ? await ensureAgent(p.agentRaw) : clientAgentId.get(cName) ?? null;
      // payers are legal entities paying by transfer; an explicit «нахт»/naqd note means cash
      const method = /нахт|naqd/i.test(p.payer) ? PaymentMethod.CASH : PaymentMethod.BANK;
      const cashboxId = await ensureCashbox(method);
      const pay = await tx.payment.create({ data: { date: p.date ?? new Date(0), kind: PaymentKind.CLIENT_IN, method, amount: p.total.toDP(2), clientId: cid, agentId, payerName: p.payer || null, note: p.note || null, cashboxId, importBatchId: batchId, createdById: by } });
      await postLedger(LedgerAccount.CLIENT, LedgerSource.PAYMENT, p.total.toDP(2).negated(), { clientId: cid }, undefined, pay.id, p.date ?? undefined);
      await writeCash(cashboxId, CashDirection.IN, p.total.toDP(2), pay.id, p.date ?? new Date(0)); // kassa KIRIM
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
    if (!f.amount || f.amount.lte(0)) continue;
    const method = /пластик/i.test(f.payer) ? PaymentMethod.CARD : /нахт/i.test(f.payer) ? PaymentMethod.CASH : PaymentMethod.BANK;
    const cashboxId = await ensureCashbox(method);
    const pay = await tx.payment.create({ data: { date: f.date ?? new Date(0), kind: PaymentKind.FACTORY_OUT, method, amount: f.amount.toDP(2), factoryId: factory.id, receiverName: f.receiver || null, cashboxId, importBatchId: batchId, createdById: by } });
    await postLedger(LedgerAccount.FACTORY, LedgerSource.PAYMENT, f.amount.toDP(2), { factoryId: factory.id }, undefined, pay.id, f.date ?? undefined);
    await writeCash(cashboxId, CashDirection.OUT, f.amount.toDP(2), pay.id, f.date ?? new Date(0)); // kassa CHIQIM
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
  return computeBalances(tx, batchId);
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
  await tx.paymentAllocation.deleteMany({});
  await tx.ledgerEntry.deleteMany({});
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

async function computeBalances(tx: Tx, batchId: string): Promise<PreviewResult> {
  const led = await tx.ledgerEntry.groupBy({ by: ['account', 'source'], where: { importBatchId: batchId }, _sum: { amount: true } });
  const sum = (pred: (a: LedgerAccount, s: LedgerSource) => boolean) =>
    led.filter((g) => pred(g.account, g.source)).reduce((a, g) => a.plus(g._sum.amount ?? 0), new D(0));

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
