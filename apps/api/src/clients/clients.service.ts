import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, LedgerAccount, PalletTransactionType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { LedgerService } from '../common/ledger.service';
import { assertPositiveMoney, D, isSettled, round2, ZERO } from '../common/money';
import { PageQueryDto, pageArgs, paged } from '../common/pagination';
import { agentScope, assertOwnAgent, RequestUser } from '../common/scoping';
import { CreateAliasDto, CreateClientDto, CreateClientPriceDto, UpdateClientDto } from './dto';

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

@Injectable()
export class ClientsService {
  constructor(
    private prisma: PrismaService,
    private ledger: LedgerService,
    private audit: AuditService,
  ) {}

  // ─────────────────────────── queries ───────────────────────────

  async list(user: RequestUser, q: PageQueryDto) {
    const { skip, take, page, pageSize } = pageArgs(q);
    const search = q.search?.trim();
    const where: Prisma.ClientWhereInput = {
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
    const [balances, palletBalances] = await Promise.all([
      this.ledger.clientBalances(ids),
      this.palletBalances(ids),
    ]);

    return paged(
      rows.map((c) => ({
        ...c,
        balance: balances.get(c.id) ?? ZERO,
        palletBalance: palletBalances.get(c.id) ?? 0,
      })),
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

    const [balance, palletBalances, orders, payments, statement] = await Promise.all([
      this.ledger.clientBalance(id),
      this.palletBalances([id]),
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

    return {
      ...client,
      balance,
      palletBalance: palletBalances.get(id) ?? 0,
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
            ...(dto.effectiveFrom ? { effectiveFrom: new Date(dto.effectiveFrom) } : {}),
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
   * Client pallet balance, inline (no cross-module dependency on PalletService):
   * Σ DELIVERED_TO_CLIENT − Σ RETURNED_BY_CLIENT − Σ CHARGED_LOST
   * + Σ signed ADJUSTMENT/REVERSAL rows. Units, not money — plain ints.
   */
  private async palletBalances(clientIds: string[]): Promise<Map<string, number>> {
    if (clientIds.length === 0) return new Map();
    const rows = await this.prisma.palletTransaction.groupBy({
      by: ['clientId', 'type'],
      where: { clientId: { in: clientIds }, type: { in: PALLET_BALANCE_TYPES } },
      _sum: { qty: true },
    });
    const map = new Map<string, number>();
    for (const r of rows) {
      if (!r.clientId) continue;
      map.set(r.clientId, (map.get(r.clientId) ?? 0) + signedPalletQty(r.type, r._sum.qty ?? 0));
    }
    return map;
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
