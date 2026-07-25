import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, LedgerAccount, LedgerSource, PalletTransactionType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { LedgerService } from '../common/ledger.service';
import { assertPositiveMoney, D, isSettled, round2, ZERO } from '../common/money';
import { AdjustBalanceDto } from '../common/adjust-balance.dto';
import { pageArgs, paged } from '../common/pagination';
import { startOfDayUtc } from '../common/pricing.service';
import { agentScope, assertOwnAgent, RequestUser } from '../common/scoping';
import {
  EMPTY_PALLET_STATS,
  foldPalletStats,
  palletStatsSql,
  type PalletPartyStats,
  type PalletStatsRow,
} from '../pallets/pallet-stats';
import { ClientQueryDto, CreateAliasDto, CreateClientDto, CreateClientPriceDto, UpdateClientDto } from './dto';

const isUniqueViolation = (e: unknown): boolean =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

/** pallet types that enter the client pallet-balance formula */
const PALLET_BALANCE_TYPES: PalletTransactionType[] = [
  PalletTransactionType.DELIVERED_TO_CLIENT,
  PalletTransactionType.RETURNED_BY_CLIENT,
  PalletTransactionType.CHARGED_LOST,
  PalletTransactionType.ADJUSTMENT,
  PalletTransactionType.REVERSAL,
];

/** Σ DELIVERED − RETURNED − CHARGED_LOST + signed ADJUSTMENT/REVERSAL */
const signedPalletQty = (type: PalletTransactionType, qty: number): number => {
  switch (type) {
    case PalletTransactionType.DELIVERED_TO_CLIENT:
      return qty;
    case PalletTransactionType.RETURNED_BY_CLIENT:
    case PalletTransactionType.CHARGED_LOST:
      return -qty;
    default:
      return qty; // ADJUSTMENT / REVERSAL rows carry their own sign
  }
};

/**
 * The same formula, applied to pre-grouped per-type sums instead of raw rows. Handing THIS
 * to foldPalletStats is what makes the balance inside `palletStats` the very number this
 * module has always published as `palletBalance` — not a lookalike recomputed from buckets.
 */
const combineClientPalletSums = (sums: Partial<Record<PalletTransactionType, number>>): number =>
  PALLET_BALANCE_TYPES.reduce((total, type) => total + signedPalletQty(type, sums[type] ?? 0), 0);

@Injectable()
export class ClientsService {
  constructor(
    private prisma: PrismaService,
    private ledger: LedgerService,
    private audit: AuditService,
  ) {}

  // ─────────────────────────── queries ───────────────────────────

  async list(user: RequestUser, q: ClientQueryDto) {
    const { skip, take, page, pageSize } = pageArgs(q);
    const search = q.search?.trim();
    const where: Prisma.ClientWhereInput = {
      // caller filter first — agentScope spreads AFTER it, so an AGENT can never widen
      // the scope to another agent by passing ?agentId= (office roles have empty scope)
      ...(q.agentId ? { agentId: q.agentId } : {}),
      ...agentScope(user),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { phone: { contains: search, mode: 'insensitive' } },
              { aliases: { some: { name: { contains: search, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    };

    const [total, rows] = await Promise.all([
      this.prisma.client.count({ where }),
      this.prisma.client.findMany({
        where,
        orderBy: { name: 'asc' },
        skip,
        take,
        include: {
          region: { select: { id: true, name: true } },
          agent: { select: { id: true, name: true } },
        },
      }),
    ]);

    const ids = rows.map((c) => c.id);
    // one grouped query for the WHOLE page — the breakdown rides along with the balance
    // it is derived from, so the list never degrades into a per-row pallet query
    const [balances, palletStats] = await Promise.all([
      this.ledger.clientBalances(ids),
      this.palletStats(ids),
    ]);

    return paged(
      rows.map((c) => {
        const stats = palletStats.get(c.id) ?? { ...EMPTY_PALLET_STATS };
        return {
          ...c,
          balance: balances.get(c.id) ?? ZERO,
          palletBalance: stats.balance,
          palletStats: stats,
        };
      }),
      total,
      page,
      pageSize,
    );
  }

  async detail(id: string, user: RequestUser) {
    const client = await this.prisma.client.findUnique({
      where: { id },
      include: {
        region: true,
        agent: true,
        aliases: { orderBy: { name: 'asc' } },
        prices: {
          orderBy: { effectiveFrom: 'desc' },
          include: { product: { select: { id: true, name: true, size: true } } },
        },
      },
    });
    if (!client) throw new NotFoundException('Mijoz topilmadi');
    // the v2 IDOR: an AGENT must never see a foreign client
    assertOwnAgent(user, client.agentId);

    const [balance, palletStats, orders, payments, statement] = await Promise.all([
      this.ledger.clientBalance(id),
      this.palletStats([id]),
      this.prisma.order.findMany({
        where: { clientId: id },
        orderBy: { date: 'desc' },
        take: 20,
        include: {
          factory: { select: { id: true, name: true } },
          vehicle: { select: { id: true, name: true, plate: true } },
        },
      }),
      this.prisma.payment.findMany({
        where: { clientId: id, voidedAt: null },
        orderBy: { date: 'desc' },
        take: 20,
      }),
      this.ledger.statement(LedgerAccount.CLIENT, id),
    ]);

    // «hozir mijozda» (palletBalance) is stats.balance, not a second opinion about it —
    // see palletStats(): the same combiner produces both, so the card's
    // olingan − qaytargan − yo'qotilgan arithmetic always lands on the shown balance.
    const pallets = palletStats.get(id) ?? { ...EMPTY_PALLET_STATS };

    return {
      ...client,
      balance,
      palletBalance: pallets.balance,
      palletStats: pallets,
      orders,
      payments,
      statement,
    };
  }

  // ─────────────────────────── mutations ───────────────────────────

  async create(dto: CreateClientDto, user: RequestUser) {
    const isAgent = user.role === 'AGENT';
    const agentId = isAgent ? user.agentId : (dto.agentId ?? null);
    if (isAgent && !agentId) {
      throw new ForbiddenException('Agent profili topilmadi');
    }
    // AGENT cannot grant credit terms — financial controls stay with the office
    const creditLimit =
      isAgent || dto.creditLimit === undefined || dto.creditLimit === null
        ? null
        : this.nonNegativeMoney(dto.creditLimit, 'creditLimit');
    const paymentTermDays = isAgent ? null : (dto.paymentTermDays ?? null);

    await this.assertRefsExist(dto.regionId ?? null, agentId);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.client.create({
          data: {
            name: dto.name,
            legalEntity: dto.legalEntity ?? null,
            phone: dto.phone ?? null,
            regionId: dto.regionId ?? null,
            agentId,
            creditLimit,
            paymentTermDays,
          },
        });
        await this.audit.log({
          tx,
          userId: user.userId,
          action: AuditAction.CREATE,
          entity: 'Client',
          entityId: created.id,
          after: created,
        });
        return created;
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new BadRequestException('Bu nomdagi mijoz allaqachon mavjud');
      throw e;
    }
  }

  async update(id: string, dto: UpdateClientDto, user: RequestUser) {
    const before = await this.prisma.client.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Mijoz topilmadi');
    const isAgent = user.role === 'AGENT';
    assertOwnAgent(user, before.agentId);

    const data: Prisma.ClientUncheckedUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.legalEntity !== undefined) data.legalEntity = dto.legalEntity;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.regionId !== undefined) data.regionId = dto.regionId;
    if (!isAgent) {
      // creditLimit / agentId / paymentTermDays / active are office-only — silently stripped for AGENT
      if (dto.agentId !== undefined) data.agentId = dto.agentId;
      if (dto.creditLimit !== undefined) {
        data.creditLimit =
          dto.creditLimit === null ? null : this.nonNegativeMoney(dto.creditLimit, 'creditLimit');
      }
      if (dto.paymentTermDays !== undefined) data.paymentTermDays = dto.paymentTermDays;
      if (dto.active !== undefined) data.active = dto.active;
    }

    await this.assertRefsExist(
      dto.regionId !== undefined ? dto.regionId : null,
      !isAgent && dto.agentId !== undefined ? dto.agentId : null,
    );

    try {
      return await this.prisma.$transaction(async (tx) => {
        const after = await tx.client.update({ where: { id }, data });
        await this.audit.log({
          tx,
          userId: user.userId,
          action: AuditAction.UPDATE,
          entity: 'Client',
          entityId: id,
          before,
          after,
        });
        return after;
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new BadRequestException('Bu nomdagi mijoz allaqachon mavjud');
      throw e;
    }
  }

  /** Soft-delete: deactivate only, and only when the money balance is settled. */
  async remove(id: string, user: RequestUser) {
    const before = await this.prisma.client.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Mijoz topilmadi');
    const balance = await this.ledger.clientBalance(id);
    if (!isSettled(balance)) {
      throw new BadRequestException('Balans nolga teng emas');
    }
    return this.prisma.$transaction(async (tx) => {
      const after = await tx.client.update({ where: { id }, data: { active: false } });
      await this.audit.log({
        tx,
        userId: user.userId,
        action: AuditAction.DELETE,
        entity: 'Client',
        entityId: id,
        before,
        after,
        note: 'deactivated (soft delete)',
      });
      return after;
    });
  }

  /**
   * «Balansni nazorat qilish» — an off-book manual correction of ONE client's balance. Posts a
   * single OFFBOOK_ADJUSTMENT ledger row (no kassa row), so it moves THIS client's balance and
   * shows in their statement, but is excluded from the dashboard rollups and the transactions
   * journal (owner rule, 2026-07-22). ADMIN-only (controller-gated).
   */
  async adjustBalance(id: string, dto: AdjustBalanceDto, user: RequestUser) {
    await this.ensureClient(id);
    const amount = round2(D(dto.amount));
    if (!amount.isFinite() || amount.isZero()) {
      throw new BadRequestException("Tuzatish summasi noldan farqli bo'lishi kerak");
    }
    return this.prisma.$transaction(async (tx) => {
      await this.ledger.post(tx, {
        date: dto.date ? new Date(dto.date) : new Date(),
        account: LedgerAccount.CLIENT,
        source: LedgerSource.OFFBOOK_ADJUSTMENT,
        clientId: id,
        amount, // signed: >0 ⇒ client owes us more, <0 ⇒ credit (we owe them)
        note: dto.note?.trim() || "Balans qo'lda tuzatildi (off-book)",
        createdById: user.userId,
      });
      await this.audit.log({
        tx,
        userId: user.userId,
        action: AuditAction.UPDATE,
        entity: 'Client',
        entityId: id,
        after: { offBookAdjustment: amount.toFixed(2), note: dto.note ?? null },
        note: 'Off-book balans tuzatildi',
      });
      const balance = await this.ledger.clientBalance(id, tx);
      return { id, balance };
    });
  }

  // ─────────────────────────── aliases ───────────────────────────

  async addAlias(clientId: string, dto: CreateAliasDto) {
    await this.ensureClient(clientId);
    try {
      return await this.prisma.clientAlias.create({
        data: { clientId, name: dto.name },
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new BadRequestException('Bu nom allaqachon band');
      throw e;
    }
  }

  /** Aliases are import-matching helpers, not financial rows — hard delete is fine. */
  async removeAlias(clientId: string, aliasId: string) {
    const alias = await this.prisma.clientAlias.findUnique({ where: { id: aliasId } });
    if (!alias || alias.clientId !== clientId) throw new NotFoundException('Taxallus topilmadi');
    return this.prisma.clientAlias.delete({ where: { id: aliasId } });
  }

  // ─────────────────────────── special prices ───────────────────────────

  /** Versioned insert — price history is never updated in place. */
  async addPrice(clientId: string, dto: CreateClientPriceDto, user: RequestUser) {
    await this.ensureClient(clientId);
    const product = await this.prisma.product.findUnique({ where: { id: dto.productId } });
    if (!product) throw new BadRequestException('Mahsulot topilmadi');
    const pricePerM3 = this.positivePricePerM3(dto.pricePerM3, 'pricePerM3');

    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.clientPrice.create({
          data: {
            clientId,
            productId: dto.productId,
            pricePerM3,
            // UTC-midnight bucket, same as ProductPrice: orders carry a business DATE, so
            // a wall-clock effectiveFrom would hide a price from the very day it was set.
            effectiveFrom: startOfDayUtc(dto.effectiveFrom ? new Date(dto.effectiveFrom) : new Date()),
            createdBy: user.userId,
          },
        });
        await this.audit.log({
          tx,
          userId: user.userId,
          action: AuditAction.CREATE,
          entity: 'ClientPrice',
          entityId: created.id,
          after: created,
        });
        return created;
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new BadRequestException('Bu sana uchun narx allaqachon kiritilgan');
      }
      throw e;
    }
  }

  // ─────────────────────────── helpers ───────────────────────────

  /**
   * Client pallet history, inline (still no cross-module dependency on PalletService — we
   * borrow its PURE helpers, never inject the service):
   *   balance = Σ DELIVERED_TO_CLIENT − Σ RETURNED_BY_CLIENT − Σ CHARGED_LOST
   *             + Σ signed ADJUSTMENT/REVERSAL rows
   * plus the gross «mijozga jami berilgan / mijoz qaytargan» decomposition the netted
   * balance used to hide. Units, not money — plain ints.
   *
   * `stats.balance` and the `palletBalance` we publish are ONE figure by construction:
   * foldPalletStats does not re-derive a balance from its own buckets, it calls the
   * combiner handed to it, and that combiner is this module's own
   * PALLET_BALANCE_TYPES/signedPalletQty math (combineClientPalletSums). A future pallet
   * type or an orphan reversal therefore lands in `adjustment` — it can shift the
   * breakdown, never the balance the debts board and the return caps enforce.
   */
  private async palletStats(clientIds: string[]): Promise<Map<string, PalletPartyStats>> {
    if (clientIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<PalletStatsRow[]>(palletStatsSql('clientId', clientIds));
    return foldPalletStats(rows, 'client', combineClientPalletSums);
  }

  private async ensureClient(clientId: string) {
    const client = await this.prisma.client.findUnique({ where: { id: clientId } });
    if (!client) throw new NotFoundException('Mijoz topilmadi');
    return client;
  }

  private async assertRefsExist(regionId: string | null | undefined, agentId: string | null | undefined) {
    if (regionId) {
      const region = await this.prisma.region.findUnique({ where: { id: regionId } });
      if (!region) throw new BadRequestException('Hudud topilmadi');
    }
    if (agentId) {
      const agent = await this.prisma.agent.findUnique({ where: { id: agentId } });
      if (!agent) throw new BadRequestException('Agent topilmadi');
    }
  }

  /** creditLimit may legitimately be 0 (prepay only) — non-negative, 2dp. */
  private nonNegativeMoney(v: number | string, field: string): Prisma.Decimal {
    const d = D(v);
    if (!d.isFinite() || d.isNegative()) {
      throw new BadRequestException(`${field} manfiy bo'lishi mumkin emas`);
    }
    return round2(d);
  }

  /** Positive per-m³ price kept at 6dp (back-solved lump-sum prices must reproduce totals). */
  private positivePricePerM3(v: number | string, field: string): Prisma.Decimal {
    try {
      assertPositiveMoney(v, field);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    return D(v).toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP);
  }
}
