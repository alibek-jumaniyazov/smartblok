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
import { assertOwnAgent, clientAgentScope, RequestUser } from '../common/scoping';
import { ChargeLostDto, ClientReturnDto, FactoryReturnDto, PalletTxQueryDto } from './dto';
import {
  EMPTY_PALLET_STATS,
  foldPalletStats,
  hasPalletHistory,
  palletStatsSql,
  sumPalletStats,
  type PalletOverview,
  type PalletPartyStats,
  type PalletStatsRow,
} from './pallet-stats';

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

  // ── full breakdown (jami olingan / jami qaytarilgan / hozirgi qoldiq) ──
  // The netted balances above answer «hozir qancha», these answer «shu paytgacha
  // qancha». Both come out of the same rows; see pallet-stats.ts for why the
  // decomposition can never drift away from the balance.

  /** Per-client pallet history breakdown. `clientIds` narrows the sweep (detail cards). */
  async clientPalletStats(clientIds?: string[]): Promise<Map<string, PalletPartyStats>> {
    if (clientIds && clientIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<PalletStatsRow[]>(palletStatsSql('clientId', clientIds));
    return foldPalletStats(rows, 'client', (s) => this.combineClientSums(s));
  }

  /** Per-factory pallet history breakdown. */
  async factoryPalletStats(factoryIds?: string[]): Promise<Map<string, PalletPartyStats>> {
    if (factoryIds && factoryIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<PalletStatsRow[]>(palletStatsSql('factoryId', factoryIds));
    return foldPalletStats(rows, 'factory', (s) => this.combineFactorySums(s));
  }

  /** Single-party helpers — the detail pages ask for exactly one. */
  async clientPalletStatsOne(clientId: string): Promise<PalletPartyStats> {
    return (await this.clientPalletStats([clientId])).get(clientId) ?? { ...EMPTY_PALLET_STATS };
  }

  async factoryPalletStatsOne(factoryId: string): Promise<PalletPartyStats> {
    return (await this.factoryPalletStats([factoryId])).get(factoryId) ?? { ...EMPTY_PALLET_STATS };
  }

  /**
   * One factory's pallet movement INSIDE a date window — «shu davrda zavoddan nechta
   * poddon oldik va nechtasini qaytardik».
   *
   * DIQQAT: qaytgan obyektning `balance` maydoni QOLDIQ EMAS, davr DELTASI («qarzimiz shu
   * davrda qanchaga o'zgardi»). Qoldiq har doim `factoryPalletStatsOne` dan olinadi — u
   * butun daftarni yig'adi. Ikkalasi bir ekranda ko'rsatilsa, nomlari ham shunday ajratiladi.
   */
  async factoryPalletStatsPeriod(
    factoryId: string,
    window: { gte: Date; lt: Date },
  ): Promise<PalletPartyStats> {
    const rows = await this.prisma.$queryRaw<PalletStatsRow[]>(
      palletStatsSql('factoryId', [factoryId], window),
    );
    return (
      foldPalletStats(rows, 'factory', (s) => this.combineFactorySums(s)).get(factoryId) ?? {
        ...EMPTY_PALLET_STATS,
      }
    );
  }

  /**
   * Company-wide roll-up. `drift` is the conservation check
   *   zavodlarga qarzimiz  ==  mijozlardagi + qo'limizdagi + yo'qotilgan
   * — it stays 0 for every movement the app itself can produce, so a non-zero
   * value is a fingerprint of a manual ADJUSTMENT, never of normal trading.
   */
  async overview(scopedStats?: {
    client: Map<string, PalletPartyStats>;
    factory: Map<string, PalletPartyStats>;
    dealerInHand: number;
  }): Promise<PalletOverview> {
    const [clientMap, factoryMap, dealerInHand] = scopedStats
      ? [scopedStats.client, scopedStats.factory, scopedStats.dealerInHand]
      : await Promise.all([this.clientPalletStats(), this.factoryPalletStats(), this.dealerInHand()]);

    const client = sumPalletStats(clientMap.values());
    const factory = sumPalletStats(factoryMap.values());
    return {
      factory: {
        received: factory.received,
        returned: factory.returned,
        adjustment: factory.adjustment,
        balance: factory.balance,
      },
      client: {
        received: client.received,
        returned: client.returned,
        chargedLost: client.chargedLost,
        chargedLostAmount: client.chargedLostAmount,
        adjustment: client.adjustment,
        balance: client.balance,
      },
      dealerInHand,
      drift: factory.balance - (client.balance + dealerInHand + client.chargedLost),
    };
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
    // Reversals of a RETURN are netted out here (2026-07-25). An import rollback
    // writes REVERSAL rows against RETURNED_BY_CLIENT — the previous groupBy did not
    // look at REVERSAL at all, so a rolled-back import left phantom loose stock in
    // the pool and let a factory-return draw against pallets nobody was holding.
    // The reversal's qty is a signed BALANCE delta (+qty when it un-does a return),
    // hence the flipped signs on the REVERSAL branches.
    const [row] = await db.$queryRaw<Array<{ inHand: number }>>(Prisma.sql`
      SELECT COALESCE(SUM(
        CASE
          WHEN pt."type" = 'RETURNED_BY_CLIENT' THEN pt."qty"
          WHEN pt."type" = 'RETURNED_TO_FACTORY' THEN -pt."qty"
          WHEN pt."type" = 'REVERSAL' AND src."type" = 'RETURNED_BY_CLIENT' THEN -pt."qty"
          WHEN pt."type" = 'REVERSAL' AND src."type" = 'RETURNED_TO_FACTORY' THEN pt."qty"
          ELSE 0
        END
      ), 0)::int AS "inHand"
      FROM "PalletTransaction" pt
      LEFT JOIN "PalletTransaction" src ON src."id" = pt."reversalOfId"`);
    return Number(row?.inHand ?? 0);
  }

  /** Global loose in-hand pallet stock (read endpoints / dashboard). */
  async dealerInHand(): Promise<number> {
    return this.dealerInHandOn(this.prisma);
  }

  // ── read endpoints ──

  /**
   * Client balances (AGENT: own clients only) + factory summary for ADMIN/ACCOUNTANT.
   *
   * Every row now carries its FULL history (`stats`), not just the netted balance, and
   * the payload gains a company-wide `totals` roll-up. `balance` is still emitted at the
   * row root — it is `stats.balance`, kept as its own field so existing callers, the
   * debts board and the e2e suites keep reading the shape they always read.
   *
   * An AGENT gets the same shape scoped to his own clients: factory accountability and
   * the dealer's loose stock are company liabilities he must not see, so they come back
   * as zeros (the UI already hides those panels when `factories` is empty).
   *
   * THE COLUMNS MUST SUM TO THE HEADER. `totals` is the roll-up of the WHOLE stats map,
   * so a party that is hidden from `clients`/`factories` while still carrying lifetime
   * history would make the strip larger than the table beneath it — and, worse, would
   * answer «shu paytgacha jami qancha oldik» differently for an ADMIN and for the AGENT
   * of the same client. Hence `hasPalletHistory`: the active-only filter still hides the
   * dead weight (a deactivated client that never touched a pallet), but anything that
   * ever moved a pallet keeps its row. Deactivation requires a zero pallet balance, so
   * without this every settled-and-closed client silently left its lifetime figures in
   * the header with no row to explain them.
   */
  async balances(user: RequestUser) {
    const isAgent = user.role === 'AGENT';
    const emptyTotals = this.emptyOverview();
    if (isAgent && !user.agentId) return { clients: [], totals: emptyTotals };

    const clients = await this.prisma.client.findMany({
      where: isAgent ? { agentId: user.agentId as string } : {},
      orderBy: { name: 'asc' },
      select: { id: true, name: true, phone: true, agentId: true, active: true },
    });
    const clientStats = await this.clientPalletStats(isAgent ? clients.map((c) => c.id) : undefined);
    const clientRows = clients
      .map((client) => {
        const stats = clientStats.get(client.id) ?? { ...EMPTY_PALLET_STATS };
        return { client, balance: stats.balance, stats };
      })
      .filter((r) => r.client.active || hasPalletHistory(r.stats));

    if (isAgent) {
      // the same basis the ADMIN branch uses — the full scoped map, not the filtered
      // rows, so both roles publish one definition of «jami».
      const own = sumPalletStats(clientStats.values());
      return {
        clients: clientRows,
        totals: {
          ...emptyTotals,
          client: {
            received: own.received,
            returned: own.returned,
            chargedLost: own.chargedLost,
            chargedLostAmount: own.chargedLostAmount,
            adjustment: own.adjustment,
            balance: own.balance,
          },
        },
      };
    }

    const factories = await this.prisma.factory.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, active: true },
    });
    const [factoryStats, dealerInHand] = await Promise.all([
      this.factoryPalletStats(),
      // «diller qo'lida» loose stock — the pool a factory-return may draw from.
      this.dealerInHand(),
    ]);
    const factoryRows = factories
      .map((factory) => {
        const stats = factoryStats.get(factory.id) ?? { ...EMPTY_PALLET_STATS };
        return { factory, balance: stats.balance, stats };
      })
      .filter((r) => r.factory.active || hasPalletHistory(r.stats));

    const totals = await this.overview({ client: clientStats, factory: factoryStats, dealerInHand });

    return { clients: clientRows, factories: factoryRows, dealerInHand, totals };
  }

  private emptyOverview(): PalletOverview {
    return {
      factory: { received: 0, returned: 0, adjustment: 0, balance: 0 },
      client: { received: 0, returned: 0, chargedLost: 0, chargedLostAmount: '0.00', adjustment: 0, balance: 0 },
      dealerInHand: 0,
      drift: 0,
    };
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

  // ── mutations (ADMIN/ACCOUNTANT — plus AGENT on client-return only, see below) ──

  /**
   * Client hands pallets back — reduces his in-kind counter. No money. Capped at what he holds.
   *
   * Takes the whole RequestUser, not just an id: since 2026-07-30 an AGENT may record this
   * (he is the one who physically collects the pallets), and the ONLY thing standing between
   * him and a foreign client's counter is `assertOwnAgent` below. A bare `userId` could not
   * express that check, so the signature carries the role.
   */
  async recordClientReturn(dto: ClientReturnDto, user: RequestUser) {
    const userId = user.userId;
    return this.prisma.$transaction(async (tx) => {
      const client = await tx.client.findUnique({ where: { id: dto.clientId } });
      if (!client) throw new NotFoundException('Mijoz topilmadi');
      // AGENT: faqat o'z mijozidan qaytarish yozadi (begonasi → 403). ADMIN/BUXGALTER o'tadi.
      // Tekshiruv mijoz o'qilgandan KEYIN: «yo'q mijoz» 404 bo'lib qolsin, 403 emas.
      assertOwnAgent(user, client.agentId);
      if (dto.orderId) {
        const order = await tx.order.findUnique({
          where: { id: dto.orderId },
          select: { id: true, clientId: true },
        });
        if (!order) throw new NotFoundException('Buyurtma topilmadi');
        // …va u AYNAN shu mijozning buyurtmasi bo'lishi shart. Aks holda qaytarish qatori
        // begona buyurtmaning jurnaliga yopishib qolardi (paddon harakatlarida havola bo'lib
        // ko'rinadi) — endi agent ham yozadigan bo'lgani uchun bu tekshiruv qamrovning bir qismi.
        if (order.clientId !== dto.clientId) {
          throw new BadRequestException('Buyurtma bu mijozga tegishli emas');
        }
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
