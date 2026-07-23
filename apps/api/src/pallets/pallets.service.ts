import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  LedgerAccount,
  LedgerSource,
  PalletTransactionType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { LedgerService } from '../common/ledger.service';
import { SETTING_KEYS, SettingsService } from '../common/settings.service';
import { assertPositiveMoney, round2 } from '../common/money';
import { pageArgs, Paged, paged } from '../common/pagination';
import { clientAgentScope, RequestUser } from '../common/scoping';
import { ChargeLostDto, ClientReturnDto, FactoryReturnDto, PalletTxQueryDto } from './dto';

/**
 * Owner-locked default pallet money value (130 000 UZS) — used ONLY when a client is
 * charged for pallets he lost. A pallet handed back to the factory is worth nothing.
 */
export const DEFAULT_PALLET_UNIT_PRICE = 130000;

// Fixed key for the transaction-scoped advisory lock that serializes every
// factory-return against the single global loose-stock pool (see returnToFactory).
const PALLET_INHAND_ADVISORY_KEY = 748923;

type TypeSums = Partial<Record<PalletTransactionType, number>>;

/**
 * Pallets are owed IN KIND (counts, not money). Money appears through exactly ONE
 * explicit flow: CHARGED_LOST — a client who lost pallets is billed for them (one
 * linked CLIENT LedgerEntry). Everything on the FACTORY side is count-only:
 * RECEIVED_FROM_FACTORY and RETURNED_TO_FACTORY never touch the ledger, never carry a
 * unitPrice, and a DB CHECK (pallet_factory_return_moneyless / ledger_no_pallet_return_credit)
 * makes it impossible to reintroduce.
 *
 * Client balance  = Σ DELIVERED_TO_CLIENT − Σ RETURNED_BY_CLIENT − Σ CHARGED_LOST
 *                   + Σ signed (ADJUSTMENT + REVERSAL with clientId)
 * Factory balance = Σ RECEIVED_FROM_FACTORY − Σ RETURNED_TO_FACTORY
 *                   + Σ signed (ADJUSTMENT + REVERSAL with factoryId)
 *
 * Return quantities are CAPPED so the books can never go physically impossible:
 *   - a client can hand back / be charged for at most what he still holds;
 *   - the dealer can send a factory at most min(loose in-hand stock, what he owes
 *     that factory). See recordClientReturn / chargeLost / returnToFactory.
 */
@Injectable()
export class PalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  // ── order hooks (called by OrdersService inside ITS transaction) ──

  /** One truck: pallets received from the factory and delivered to the client in the same move. */
  async recordOrderPallets(
    tx: Prisma.TransactionClient,
    args: {
      orderId: string;
      clientId: string;
      factoryId: string;
      date: Date;
      items: Array<{ palletCount: number; palletPrice?: any }>;
      createdById?: string | null;
      importBatchId?: string | null;
    },
  ): Promise<void> {
    const total = args.items.reduce((acc, i) => acc + (i.palletCount || 0), 0);
    if (total <= 0) return;
    await tx.palletTransaction.create({
      data: {
        type: PalletTransactionType.RECEIVED_FROM_FACTORY,
        factoryId: args.factoryId,
        qty: total,
        orderId: args.orderId,
        date: args.date,
        createdById: args.createdById ?? null,
        importBatchId: args.importBatchId ?? null,
      },
    });
    await tx.palletTransaction.create({
      data: {
        type: PalletTransactionType.DELIVERED_TO_CLIENT,
        clientId: args.clientId,
        qty: total,
        orderId: args.orderId,
        date: args.date,
        createdById: args.createdById ?? null,
        importBatchId: args.importBatchId ?? null,
      },
    });
  }

  /**
   * Order cancel/edit: compensating REVERSAL rows for the order's OWN delivery
   * movements only (RECEIVED_FROM_FACTORY / DELIVERED_TO_CLIENT — both additive,
   * so qty is negated). Client returns and lost-pallet charges are standalone
   * physical/financial facts: negating their qty here would DOUBLE-subtract them
   * from the balance (they enter the formula with a minus already), and a
   * cancelled order does not un-return pallets a client physically brought back.
   *
   * CLAMPED to what the client STILL HOLDS. Pallets he already handed back (or was
   * charged for) are settled facts; reversing the full original delivery on top of
   * them would subtract the same pallets twice — driving his in-kind balance NEGATIVE
   * and minting phantom loose stock (which a factory-return would turn into real money
   * credit). The un-reversed remainder is not lost: it stays as a real factory
   * obligation, exactly matched by the loose stock we now physically hold, so
   *   factoryOwed = clientHeld + dealerInHand + chargedLost
   * still balances in every case:
   *   delivered 6, returned 0 → reverse 6 (full, unchanged behaviour)
   *   delivered 6, returned 2 → reverse 4 → client 0, inHand 2, factory owes 2
   *   delivered 6, returned 6 → reverse 0 → client 0, inHand 6, factory owes 6
   * A partial reversal marks its source row reversed (reversalOfId is unique); the
   * remainder is already accounted for by the return/charge rows themselves.
   */
  async reverseForOrder(
    tx: Prisma.TransactionClient,
    orderId: string,
    createdById?: string | null,
  ): Promise<void> {
    const rows = await tx.palletTransaction.findMany({
      where: {
        orderId,
        type: {
          in: [PalletTransactionType.RECEIVED_FROM_FACTORY, PalletTransactionType.DELIVERED_TO_CLIENT],
        },
        reversedBy: null,
      },
      orderBy: { at: 'asc' },
    });
    if (rows.length === 0) return;

    const delivered = rows.filter((r) => r.type === PalletTransactionType.DELIVERED_TO_CLIENT);
    const received = rows.filter((r) => r.type === PalletTransactionType.RECEIVED_FROM_FACTORY);
    const deliveredQty = delivered.reduce((a, r) => a + r.qty, 0);

    // how much of this order's delivery may still be un-delivered on the books
    let allowance = deliveredQty;
    const clientId = delivered.find((r) => r.clientId)?.clientId ?? null;
    if (clientId) {
      // lock the client row: a concurrent return/charge must not slip between the
      // balance read and the reversal insert (same guard the return caps use).
      await tx.$executeRaw`SELECT id FROM "Client" WHERE id = ${clientId} FOR UPDATE`;
      const held = await this.clientBalanceOn(tx, clientId);
      allowance = Math.max(0, Math.min(deliveredQty, held));
    }
    if (allowance <= 0) return; // fully settled by returns/charges — nothing to reverse

    // RECEIVED and DELIVERED are booked in equal qty per order (recordOrderPallets),
    // so the same allowance applies to both sides and conservation is preserved.
    const reverseSide = async (side: typeof rows) => {
      let left = allowance;
      for (const row of side) {
        if (left <= 0) break;
        const qty = Math.min(row.qty, left);
        left -= qty;
        await tx.palletTransaction.create({
          data: {
            type: PalletTransactionType.REVERSAL,
            qty: -qty,
            clientId: row.clientId,
            factoryId: row.factoryId,
            orderId,
            date: new Date(),
            reversalOfId: row.id,
            createdById: createdById ?? null,
          },
        });
      }
    };
    await reverseSide(delivered);
    await reverseSide(received);
  }

  // ── balances (sums over movements; >0 ⇒ the client holds our pallets) ──

  async clientPalletBalance(clientId: string): Promise<number> {
    const rows = await this.prisma.palletTransaction.groupBy({
      by: ['type'],
      where: { clientId },
      _sum: { qty: true },
    });
    const sums: TypeSums = {};
    for (const r of rows) sums[r.type] = r._sum.qty ?? 0;
    return this.combineClientSums(sums);
  }

  /** Per-client balances in ONE grouped query; optional `clientIds` narrows the sweep (agent card). */
  async clientPalletBalances(clientIds?: string[]): Promise<Map<string, number>> {
    if (clientIds && clientIds.length === 0) return new Map();
    const rows = await this.prisma.palletTransaction.groupBy({
      by: ['clientId', 'type'],
      where: { clientId: clientIds ? { in: clientIds } : { not: null } },
      _sum: { qty: true },
    });
    const perClient = new Map<string, TypeSums>();
    for (const r of rows) {
      if (!r.clientId) continue;
      const sums = perClient.get(r.clientId) ?? {};
      sums[r.type] = r._sum.qty ?? 0;
      perClient.set(r.clientId, sums);
    }
    const result = new Map<string, number>();
    for (const [clientId, sums] of perClient) result.set(clientId, this.combineClientSums(sums));
    return result;
  }

  /** Pallets we are accountable for at the factory. */
  async factoryPalletBalance(factoryId: string): Promise<number> {
    const rows = await this.prisma.palletTransaction.groupBy({
      by: ['type'],
      where: { factoryId },
      _sum: { qty: true },
    });
    const sums: TypeSums = {};
    for (const r of rows) sums[r.type] = r._sum.qty ?? 0;
    return this.combineFactorySums(sums);
  }

  async factoryPalletBalances(): Promise<Map<string, number>> {
    const rows = await this.prisma.palletTransaction.groupBy({
      by: ['factoryId', 'type'],
      where: { factoryId: { not: null } },
      _sum: { qty: true },
    });
    const perFactory = new Map<string, TypeSums>();
    for (const r of rows) {
      if (!r.factoryId) continue;
      const sums = perFactory.get(r.factoryId) ?? {};
      sums[r.type] = r._sum.qty ?? 0;
      perFactory.set(r.factoryId, sums);
    }
    const result = new Map<string, number>();
    for (const [factoryId, sums] of perFactory) result.set(factoryId, this.combineFactorySums(sums));
    return result;
  }

  private combineClientSums(s: TypeSums): number {
    return (
      (s.DELIVERED_TO_CLIENT ?? 0) -
      (s.RETURNED_BY_CLIENT ?? 0) -
      (s.CHARGED_LOST ?? 0) +
      (s.ADJUSTMENT ?? 0) +
      (s.REVERSAL ?? 0)
    );
  }

  private combineFactorySums(s: TypeSums): number {
    return (
      (s.RECEIVED_FROM_FACTORY ?? 0) -
      (s.RETURNED_TO_FACTORY ?? 0) +
      (s.ADJUSTMENT ?? 0) +
      (s.REVERSAL ?? 0)
    );
  }

  // ── tx-aware balances (recomputed under a row lock inside a mutation) ──
  // `db` may be the request-scoped transaction (validation must see uncommitted
  // rows locked FOR UPDATE) or the base client (read endpoints). PrismaClient is
  // structurally assignable to TransactionClient, so both callers type-check.

  private async clientBalanceOn(db: Prisma.TransactionClient, clientId: string): Promise<number> {
    const rows = await db.palletTransaction.groupBy({
      by: ['type'],
      where: { clientId },
      _sum: { qty: true },
    });
    const sums: TypeSums = {};
    for (const r of rows) sums[r.type] = r._sum.qty ?? 0;
    return this.combineClientSums(sums);
  }

  private async factoryBalanceOn(db: Prisma.TransactionClient, factoryId: string): Promise<number> {
    const rows = await db.palletTransaction.groupBy({
      by: ['type'],
      where: { factoryId },
      _sum: { qty: true },
    });
    const sums: TypeSums = {};
    for (const r of rows) sums[r.type] = r._sum.qty ?? 0;
    return this.combineFactorySums(sums);
  }

  /**
   * Dealer's loose in-hand pallet stock (global): pallets clients handed back that
   * have not yet been sent on to a factory — «diller qo'lidagi paddon».
   *   inHand = Σ RETURNED_BY_CLIENT − Σ RETURNED_TO_FACTORY
   * RECEIVED_FROM_FACTORY and DELIVERED_TO_CLIENT are always booked together in equal
   * qty per order (recordOrderPallets), and reverseForOrder negates BOTH — so they
   * cancel and never add to loose stock. This pool is what a factory-return draws from.
   */
  private async dealerInHandOn(db: Prisma.TransactionClient): Promise<number> {
    const rows = await db.palletTransaction.groupBy({
      by: ['type'],
      where: {
        type: {
          in: [PalletTransactionType.RETURNED_BY_CLIENT, PalletTransactionType.RETURNED_TO_FACTORY],
        },
      },
      _sum: { qty: true },
    });
    let inHand = 0;
    for (const r of rows) {
      const q = r._sum.qty ?? 0;
      inHand += r.type === PalletTransactionType.RETURNED_BY_CLIENT ? q : -q;
    }
    return inHand;
  }

  /** Global loose in-hand pallet stock (read endpoints / dashboard). */
  async dealerInHand(): Promise<number> {
    return this.dealerInHandOn(this.prisma);
  }

  // ── read endpoints ──

  /** Client balances (AGENT: own clients only) + factory summary for ADMIN/ACCOUNTANT. */
  async balances(user: RequestUser) {
    const isAgent = user.role === 'AGENT';
    if (isAgent && !user.agentId) return { clients: [] };

    const clients = await this.prisma.client.findMany({
      where: isAgent ? { agentId: user.agentId as string } : {},
      orderBy: { name: 'asc' },
      select: { id: true, name: true, phone: true, agentId: true, active: true },
    });
    const balances = await this.clientPalletBalances();
    const clientRows = clients
      .map((client) => ({ client, balance: balances.get(client.id) ?? 0 }))
      .filter((r) => r.client.active || r.balance !== 0);

    if (isAgent) return { clients: clientRows };

    const factories = await this.prisma.factory.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, active: true },
    });
    const factoryBalances = await this.factoryPalletBalances();
    const factoryRows = factories
      .map((factory) => ({ factory, balance: factoryBalances.get(factory.id) ?? 0 }))
      .filter((r) => r.factory.active || r.balance !== 0);

    // «diller qo'lida» loose stock — the pool a factory-return may draw from.
    const dealerInHand = await this.dealerInHand();

    return { clients: clientRows, factories: factoryRows, dealerInHand };
  }

  async transactions(q: PalletTxQueryDto, user: RequestUser): Promise<Paged<unknown>> {
    const { skip, take, page, pageSize } = pageArgs(q);
    if (user.role === 'AGENT' && !user.agentId) return paged([], 0, page, pageSize);

    const where: Prisma.PalletTransactionWhereInput = {
      ...(q.clientId ? { clientId: q.clientId } : {}),
      ...(q.factoryId ? { factoryId: q.factoryId } : {}),
      // AGENT sees only rows of clients belonging to him (factory-only rows excluded)
      ...clientAgentScope(user),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.palletTransaction.findMany({
        where,
        skip,
        take,
        orderBy: [{ date: 'desc' }, { at: 'desc' }],
        include: {
          client: { select: { id: true, name: true } },
          factory: { select: { id: true, name: true } },
          order: { select: { id: true, orderNo: true } },
        },
      }),
      this.prisma.palletTransaction.count({ where }),
    ]);
    return paged(items, total, page, pageSize);
  }

  // ── mutations (ADMIN/ACCOUNTANT) ──

  /** Client hands pallets back — reduces his in-kind counter. No money. Capped at what he holds. */
  async recordClientReturn(dto: ClientReturnDto, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const client = await tx.client.findUnique({ where: { id: dto.clientId } });
      if (!client) throw new NotFoundException('Mijoz topilmadi');
      if (dto.orderId) {
        const order = await tx.order.findUnique({ where: { id: dto.orderId }, select: { id: true } });
        if (!order) throw new NotFoundException('Buyurtma topilmadi');
      }
      // a client can hand back at most what he still physically holds — lock his row
      // so two concurrent returns can't each pass the check against the same balance.
      await tx.$executeRaw`SELECT id FROM "Client" WHERE id = ${dto.clientId} FOR UPDATE`;
      const held = await this.clientBalanceOn(tx, dto.clientId);
      if (dto.qty > held) {
        throw new BadRequestException(
          `Mijozda ${held} dona paddon bor — ${dto.qty} dona qaytarib bo'lmaydi`,
        );
      }
      const row = await tx.palletTransaction.create({
        data: {
          type: PalletTransactionType.RETURNED_BY_CLIENT,
          clientId: dto.clientId,
          qty: dto.qty,
          date: new Date(dto.date),
          orderId: dto.orderId ?? null,
          note: dto.note ?? null,
          createdById: userId,
        },
      });
      await this.audit.log({
        tx,
        userId,
        action: AuditAction.CREATE,
        entity: 'PalletTransaction',
        entityId: row.id,
        after: row,
      });
      return row;
    });
  }

  /**
   * Send pallets back to the factory — UNITS ONLY, never money.
   *
   * Owner rule (2026-07-21): «zavod u paddonlar uchun pul bermaydi — faqat paddonlarni
   * sonida qarz bo'lgan bo'lamiz». The dealer owes the factory a COUNT; handing the
   * pallets back discharges that count and settles nothing financial. So this method
   * writes ONE PalletTransaction and NOTHING else: no LedgerEntry, no unitPrice, no
   * factory-balance movement. The retired PALLET_RETURN_CREDIT posting (which used to
   * grow the dealer's factory advance) is gone — historical rows keep rendering, but
   * `ledger_no_pallet_return_credit` now blocks any new one at the DB level, and the DTO
   * rejects a unitPrice outright instead of ignoring it.
   */
  async returnToFactory(dto: FactoryReturnDto, userId: string) {
    const date = new Date(dto.date);
    return this.prisma.$transaction(async (tx) => {
      const factory = await tx.factory.findUnique({ where: { id: dto.factoryId } });
      if (!factory) throw new NotFoundException('Zavod topilmadi');
      // serialize every factory-return on the single global loose-stock pool, then also
      // lock this factory's account. Cap = min(what the dealer physically holds, what he
      // still owes THIS factory): you can't send back pallets you don't have, and you
      // can't over-credit a factory past its debt («undan ortiq berib bo'lmaydi»).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PALLET_INHAND_ADVISORY_KEY})`;
      await tx.$executeRaw`SELECT id FROM "Factory" WHERE id = ${dto.factoryId} FOR UPDATE`;
      const owed = await this.factoryBalanceOn(tx, dto.factoryId);
      const inHand = await this.dealerInHandOn(tx);
      const cap = Math.max(0, Math.min(owed, inHand));
      if (dto.qty > cap) {
        throw new BadRequestException(
          `Zavodga ${dto.qty} dona qaytarib bo'lmaydi — diller qo'lida ${inHand} dona, zavod oldida ${owed} dona (maksimum ${cap} dona)`,
        );
      }
      const row = await tx.palletTransaction.create({
        data: {
          type: PalletTransactionType.RETURNED_TO_FACTORY,
          factoryId: dto.factoryId,
          qty: dto.qty,
          date,
          unitPrice: null, // in-kind: a return is worth no money (DB CHECK enforces it too)
          note: dto.note ?? null,
          createdById: userId,
        },
      });
      await this.audit.log({
        tx,
        userId,
        action: AuditAction.CREATE,
        entity: 'PalletTransaction',
        entityId: row.id,
        after: { ...row },
      });
      return row;
    });
  }

  /**
   * Price a LOST pallet is billed at when the caller omits one. Reads the
   * `palletPriceDefault` app setting — the single remaining pallet-money knob, since the
   * factory side is count-only. A missing or non-positive value means «not configured»
   * and falls back to the owner-locked 130 000.
   */
  private async defaultLostPalletPrice(): Promise<number> {
    const raw = await this.settings.get<unknown>(SETTING_KEYS.palletPriceDefault);
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_PALLET_UNIT_PRICE;
  }

  /** Convert lost pallets into client money debt (explicit flow only). Capped at what he holds. */
  async chargeLost(dto: ChargeLostDto, userId: string) {
    const unitPrice = this.toPositiveMoney(dto.unitPrice ?? (await this.defaultLostPalletPrice()), 'unitPrice');
    const date = new Date(dto.date);
    return this.prisma.$transaction(async (tx) => {
      const client = await tx.client.findUnique({ where: { id: dto.clientId } });
      if (!client) throw new NotFoundException('Mijoz topilmadi');
      // can't charge more lost than the client still holds — the pallets converted to
      // money leave his in-kind counter, which must not be driven negative by a charge.
      await tx.$executeRaw`SELECT id FROM "Client" WHERE id = ${dto.clientId} FOR UPDATE`;
      const held = await this.clientBalanceOn(tx, dto.clientId);
      if (dto.qty > held) {
        throw new BadRequestException(
          `Mijozda ${held} dona paddon bor — ${dto.qty} donani yo'qotilgan deb hisoblab bo'lmaydi`,
        );
      }
      const row = await tx.palletTransaction.create({
        data: {
          type: PalletTransactionType.CHARGED_LOST,
          clientId: dto.clientId,
          qty: dto.qty,
          date,
          unitPrice,
          note: dto.note ?? null,
          createdById: userId,
        },
      });
      const entry = await this.ledger.post(tx, {
        date,
        account: LedgerAccount.CLIENT,
        source: LedgerSource.PALLET_CHARGE,
        amount: round2(unitPrice.times(dto.qty)), // >0: client owes the dealer
        clientId: dto.clientId,
        palletTransactionId: row.id,
        note: dto.note ?? null,
        createdById: userId,
      });
      await this.audit.log({
        tx,
        userId,
        action: AuditAction.CREATE,
        entity: 'PalletTransaction',
        entityId: row.id,
        after: { ...row, ledgerEntryId: entry.id },
      });
      return row;
    });
  }

  private toPositiveMoney(v: Prisma.Decimal.Value, field: string): Prisma.Decimal {
    try {
      return assertPositiveMoney(v, field);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }
}
