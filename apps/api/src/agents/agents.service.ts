import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, OrderStatus, PaymentKind, Prisma, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { LedgerService } from '../common/ledger.service';
import { D, round2, ZERO } from '../common/money';
import { SETTING_KEYS, SettingsService } from '../common/settings.service';
import { assertOwnAgent, RequestUser } from '../common/scoping';
import { PalletService } from '../pallets/pallets.service';
import { CreateAgentDto, UpdateAgentDto } from './dto';

const isUniqueViolation = (e: unknown): boolean =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

@Injectable()
export class AgentsService {
  constructor(
    private prisma: PrismaService,
    private ledger: LedgerService,
    private audit: AuditService,
    private settings: SettingsService,
    private pallets: PalletService,
  ) {}

  // ─────────────────────────── queries ───────────────────────────

  /** Office-only overview: v2 leaked every agent's financials to any user — closed at the controller. */
  async list() {
    const [agents, debts, defaultLimit] = await Promise.all([
      this.prisma.agent.findMany({
        orderBy: [{ sortNo: 'asc' }, { name: 'asc' }],
        include: { _count: { select: { clients: true } } },
      }),
      this.outstandingDebtByAgent(),
      this.settings.get<number | null>(SETTING_KEYS.agentDebtLimitDefault),
    ]);
    return agents.map((a) => ({
      id: a.id,
      name: a.name,
      phone: a.phone,
      sortNo: a.sortNo,
      active: a.active,
      clientCount: a._count.clients,
      outstandingDebt: debts.get(a.id) ?? ZERO,
      debtLimit: this.effectiveDebtLimit(a.debtLimit, defaultLimit),
      ownDebtLimit: a.debtLimit,
    }));
  }

  /** The AGENT's own dashboard card — same shape as a list row. */
  async me(user: RequestUser) {
    if (!user.agentId) throw new NotFoundException('Agent profili topilmadi');
    return this.card(user.agentId);
  }

  async detail(id: string, user: RequestUser) {
    // an AGENT may only open his own card
    assertOwnAgent(user, id);
    const agent = await this.prisma.agent.findUnique({
      where: { id },
      include: {
        clients: {
          orderBy: { name: 'asc' },
          include: { region: { select: { id: true, name: true } } },
        },
      },
    });
    if (!agent) throw new NotFoundException('Agent topilmadi');
    const clientIds = agent.clients.map((c) => c.id);

    const [balances, orderAgg, collectedAgg, palletBalances, defaultLimit] =
      await Promise.all([
        this.ledger.clientBalances(clientIds),
        this.prisma.order.aggregate({
          where: { agentId: id, status: { not: OrderStatus.CANCELLED } },
          _count: { _all: true },
          _sum: { saleTotal: true, costTotal: true },
        }),
        // «Yigʼilgan toʼlovlar» is NET: CLIENT_IN minus CLIENT_REFUND (deductions the
        // owner books against a client, e.g. «Шопир пули 5%») — matches the daftar «Приход».
        this.prisma.payment.groupBy({
          by: ['kind'],
          where: { agentId: id, kind: { in: [PaymentKind.CLIENT_IN, PaymentKind.CLIENT_REFUND] }, voidedAt: null },
          _sum: { amount: true },
        }),
        // ONE grouped query over PalletTransaction for all this agent's clients
        this.pallets.clientPalletBalances(clientIds),
        this.settings.get<number | null>(SETTING_KEYS.agentDebtLimitDefault),
      ]);

    // NET balance across his clients (debts minus advances) — the daftar's «Ост»
    const outstandingDebt = round2(
      clientIds.reduce((total, cid) => total.plus(balances.get(cid) ?? ZERO), ZERO),
    );

    const saleTotal = D(orderAgg._sum.saleTotal ?? 0);
    const costTotal = D(orderAgg._sum.costTotal ?? 0);

    return {
      ...agent,
      clients: agent.clients.map((c) => ({
        ...c,
        balance: balances.get(c.id) ?? ZERO,
        palletBalance: palletBalances.get(c.id) ?? 0,
      })),
      debtLimit: this.effectiveDebtLimit(agent.debtLimit, defaultLimit),
      ownDebtLimit: agent.debtLimit,
      kpi: {
        ordersCount: orderAgg._count._all,
        saleTotal,
        goodsProfit: round2(saleTotal.minus(costTotal)),
        collected: collectedAgg.reduce(
          (net, g) =>
            g.kind === PaymentKind.CLIENT_REFUND ? net.minus(g._sum.amount ?? 0) : net.plus(g._sum.amount ?? 0),
          ZERO,
        ),
        outstandingDebt,
        // Σ of the same per-client balances — no separate query needed
        palletExposure: clientIds.reduce((total, cid) => total + (palletBalances.get(cid) ?? 0), 0),
      },
    };
  }

  // ─────────────────────────── mutations ───────────────────────────

  async create(dto: CreateAgentDto, user: RequestUser) {
    // debtLimit is a financial control — ADMIN only, silently stripped for ACCOUNTANT
    const debtLimit =
      user.role !== 'ADMIN' || dto.debtLimit === undefined || dto.debtLimit === null
        ? null
        : this.nonNegativeMoney(dto.debtLimit, 'debtLimit');

    // optional login: username+password → auto-create a linked AGENT user (same tx)
    const username = dto.username?.trim();
    const wantsUser = !!(username && dto.password);
    if (username && !dto.password) throw new BadRequestException('Login uchun parol ham kiriting');
    if (dto.password && !username) throw new BadRequestException('Login uchun username ham kiriting');
    if (wantsUser) {
      const dup = await this.prisma.user.findUnique({ where: { username } });
      if (dup) throw new ConflictException('Bu username allaqachon band');
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.agent.create({
          data: {
            name: dto.name,
            phone: dto.phone ?? null,
            sortNo: dto.sortNo ?? null,
            active: dto.active ?? true,
            debtLimit,
          },
        });
        await this.audit.log({
          tx,
          userId: user.userId,
          action: AuditAction.CREATE,
          entity: 'Agent',
          entityId: created.id,
          after: created,
        });

        if (wantsUser) {
          const password = await bcrypt.hash(dto.password!, 12);
          const newUser = await tx.user.create({
            data: {
              username: username!,
              password,
              name: dto.name,
              role: Role.AGENT,
              phone: dto.phone ?? null,
              agentId: created.id,
            },
          });
          await this.audit.log({
            tx,
            userId: user.userId,
            action: AuditAction.CREATE,
            entity: 'User',
            entityId: newUser.id,
            after: { username: newUser.username, name: newUser.name, role: newUser.role, agentId: created.id, password: '***' },
            note: 'Agent bilan birga avtomatik yaratildi',
          });
        }
        return created;
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new BadRequestException('Bu nomdagi agent yoki username allaqachon mavjud');
      throw e;
    }
  }

  async update(id: string, dto: UpdateAgentDto, user: RequestUser) {
    const before = await this.prisma.agent.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Agent topilmadi');

    const data: Prisma.AgentUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.sortNo !== undefined) data.sortNo = dto.sortNo;
    if (dto.active !== undefined) data.active = dto.active;

    let debtLimitChanged = false;
    if (dto.debtLimit !== undefined && user.role === 'ADMIN') {
      const next = dto.debtLimit === null ? null : this.nonNegativeMoney(dto.debtLimit, 'debtLimit');
      const prev = before.debtLimit;
      debtLimitChanged =
        (prev === null) !== (next === null) ||
        (prev !== null && next !== null && !prev.equals(next));
      data.debtLimit = next;
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const after = await tx.agent.update({ where: { id }, data });
        await this.audit.log({
          tx,
          userId: user.userId,
          action: AuditAction.UPDATE,
          entity: 'Agent',
          entityId: id,
          before,
          after,
          ...(debtLimitChanged ? { note: 'debtLimit changed' } : {}),
        });
        return after;
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new BadRequestException('Bu nomdagi agent allaqachon mavjud');
      throw e;
    }
  }

  /** Soft-delete: deactivate only — historical orders/payments keep their agent snapshot. */
  async remove(id: string, user: RequestUser) {
    const before = await this.prisma.agent.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Agent topilmadi');
    return this.prisma.$transaction(async (tx) => {
      const after = await tx.agent.update({ where: { id }, data: { active: false } });
      await this.audit.log({
        tx,
        userId: user.userId,
        action: AuditAction.DELETE,
        entity: 'Agent',
        entityId: id,
        before,
        after,
        note: 'deactivated (soft delete)',
      });
      return after;
    });
  }

  // ─────────────────────────── helpers ───────────────────────────

  private async card(agentId: string) {
    const agent = await this.prisma.agent.findUnique({
      where: { id: agentId },
      include: { _count: { select: { clients: true } } },
    });
    if (!agent) throw new NotFoundException('Agent topilmadi');
    const [debts, defaultLimit] = await Promise.all([
      this.outstandingDebtByAgent(), // NET «Ост» — consistent with the list and detail
      this.settings.get<number | null>(SETTING_KEYS.agentDebtLimitDefault),
    ]);
    const outstandingDebt = debts.get(agentId) ?? ZERO;
    return {
      id: agent.id,
      name: agent.name,
      phone: agent.phone,
      sortNo: agent.sortNo,
      active: agent.active,
      clientCount: agent._count.clients,
      outstandingDebt,
      debtLimit: this.effectiveDebtLimit(agent.debtLimit, defaultLimit),
      ownDebtLimit: agent.debtLimit,
    };
  }

  /**
   * One grouped query: NET client balance per agent (debts minus advances) — the
   * journal's «Ост» = Расход − Приход. This is a DISPLAY figure; the debt-limit
   * gate stays on the conservative positive-only ledger.agentOutstandingDebt.
   */
  private async outstandingDebtByAgent(): Promise<Map<string, Prisma.Decimal>> {
    const rows = await this.prisma.$queryRaw<{ agentId: string; total: Prisma.Decimal | null }[]>`
      SELECT c."agentId" AS "agentId", SUM(le."amount") AS total
      FROM "LedgerEntry" le
      JOIN "Client" c ON c."id" = le."clientId"
      WHERE le."account" = 'CLIENT' AND c."agentId" IS NOT NULL
      GROUP BY c."agentId"`;
    return new Map(rows.map((r) => [r.agentId, D(r.total ?? 0)]));
  }

  private effectiveDebtLimit(
    own: Prisma.Decimal | null,
    fallback: number | null | undefined,
  ): Prisma.Decimal | null {
    if (own !== null) return own;
    return fallback === null || fallback === undefined ? null : D(fallback);
  }

  /** debtLimit may legitimately be 0 (new orders blocked) — non-negative, 2dp. */
  private nonNegativeMoney(v: number | string, field: string): Prisma.Decimal {
    const d = D(v);
    if (!d.isFinite() || d.isNegative()) {
      throw new BadRequestException(`${field} manfiy bo'lishi mumkin emas`);
    }
    return round2(d);
  }
}
