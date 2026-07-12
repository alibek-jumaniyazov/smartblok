import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, BonusProgramKind, LedgerAccount, PalletTransactionType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { LedgerService } from '../common/ledger.service';
import { assertPositiveMoney, D, ZERO } from '../common/money';
import { pageArgs, paged, PageQueryDto } from '../common/pagination';
import { RequestUser } from '../common/scoping';
import { CreateFactoryDto, SetBonusProgramDto, UpdateFactoryDto } from './dto';

/** Decimal/Date-safe snapshot for AuditLog Json columns. */
const asJson = (v: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;

@Injectable()
export class FactoriesService {
  constructor(
    private prisma: PrismaService,
    private ledger: LedgerService,
    private audit: AuditService,
  ) {}

  /**
   * Same route, role-shaped payload:
   * - ADMIN / ACCOUNTANT: factory + ledger balance + bonus wallet + pallet accountability
   * - AGENT: only { id, name, active } (needed for the order form — no financials)
   */
  async findAll(user: RequestUser, q: PageQueryDto) {
    const { skip, take, page, pageSize } = pageArgs(q);
    const where: Prisma.FactoryWhereInput = q.search
      ? { name: { contains: q.search, mode: Prisma.QueryMode.insensitive } }
      : {};

    if (user.role === 'AGENT') {
      const [rows, total] = await Promise.all([
        this.prisma.factory.findMany({
          where,
          orderBy: { name: 'asc' },
          skip,
          take,
          select: { id: true, name: true, active: true },
        }),
        this.prisma.factory.count({ where }),
      ]);
      return paged(rows, total, page, pageSize);
    }

    const [rows, total, balances, bonusRows, palletRows] = await Promise.all([
      this.prisma.factory.findMany({ where, orderBy: { name: 'asc' }, skip, take }),
      this.prisma.factory.count({ where }),
      this.ledger.factoryBalances(),
      this.prisma.bonusTransaction.groupBy({ by: ['factoryId'], _sum: { amount: true } }),
      this.prisma.palletTransaction.groupBy({
        by: ['factoryId', 'type'],
        where: {
          factoryId: { not: null },
          type: { in: [PalletTransactionType.RECEIVED_FROM_FACTORY, PalletTransactionType.RETURNED_TO_FACTORY] },
        },
        _sum: { qty: true },
      }),
    ]);

    const bonusMap = new Map(bonusRows.map((r) => [r.factoryId, D(r._sum.amount ?? 0)]));
    // pallet accountability = Σ RECEIVED_FROM_FACTORY − Σ RETURNED_TO_FACTORY
    const palletMap = new Map<string, number>();
    for (const r of palletRows) {
      if (!r.factoryId) continue;
      const qty = r._sum.qty ?? 0;
      const cur = palletMap.get(r.factoryId) ?? 0;
      palletMap.set(r.factoryId, r.type === PalletTransactionType.RECEIVED_FROM_FACTORY ? cur + qty : cur - qty);
    }

    const items = rows.map((f) => ({
      ...f,
      /** >0 ⇒ dealer's advance at the factory; <0 ⇒ dealer owes the factory */
      balance: balances.get(f.id) ?? ZERO,
      bonusBalance: bonusMap.get(f.id) ?? ZERO,
      palletsHeld: palletMap.get(f.id) ?? 0,
    }));
    return paged(items, total, page, pageSize);
  }

  async findOne(id: string) {
    const factory = await this.prisma.factory.findUnique({ where: { id } });
    if (!factory) throw new NotFoundException('Zavod topilmadi');

    const [statement, payments, bonusPrograms, bonusTransactions, palletTransactions, balance, bonusAgg] =
      await Promise.all([
        this.ledger.statement(LedgerAccount.FACTORY, id),
        this.prisma.payment.findMany({
          where: { factoryId: id, voidedAt: null },
          orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
          take: 50,
          include: { cashbox: { select: { name: true, type: true } } },
        }),
        this.prisma.bonusProgram.findMany({ where: { factoryId: id }, orderBy: { effectiveFrom: 'desc' } }),
        this.prisma.bonusTransaction.findMany({
          where: { factoryId: id },
          orderBy: { at: 'desc' },
          take: 50,
          include: { order: { select: { orderNo: true } } },
        }),
        this.prisma.palletTransaction.findMany({
          where: { factoryId: id },
          orderBy: [{ date: 'desc' }, { at: 'desc' }],
          take: 50,
        }),
        this.ledger.factoryBalance(id),
        this.prisma.bonusTransaction.aggregate({ where: { factoryId: id }, _sum: { amount: true } }),
      ]);

    return {
      ...factory,
      balance,
      bonusBalance: D(bonusAgg._sum.amount ?? 0),
      statement,
      payments,
      bonusPrograms,
      bonusTransactions,
      palletTransactions,
    };
  }

  /** Bonus dastur maydonlarini tekshiradi/normallashtiradi (create + setBonusProgram uchun). */
  private resolveBonusFields(
    kind: BonusProgramKind,
    ratePerM3?: number | string | null,
    percent?: number | string | null,
  ): { ratePerM3: Prisma.Decimal | null; percent: Prisma.Decimal | null } {
    const hasRate = ratePerM3 !== undefined && ratePerM3 !== null;
    const hasPercent = percent !== undefined && percent !== null;
    if (kind === BonusProgramKind.PER_M3) {
      if (!hasRate) throw new BadRequestException('PER_M3 dasturi uchun ratePerM3 majburiy');
      if (hasPercent) throw new BadRequestException('PER_M3 dasturi percent maydonini qabul qilmaydi');
      return { ratePerM3: this.positiveMoney(ratePerM3 as number | string, 'ratePerM3'), percent: null };
    }
    if (kind === BonusProgramKind.PERCENT) {
      if (!hasPercent) throw new BadRequestException('PERCENT dasturi uchun percent majburiy');
      if (hasRate) throw new BadRequestException('PERCENT dasturi ratePerM3 maydonini qabul qilmaydi');
      const p = D(percent as number | string).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      if (!p.isFinite() || p.lessThanOrEqualTo(0) || p.greaterThan(100)) {
        throw new BadRequestException("percent 0 dan katta va 100 dan oshmaydigan son bo'lishi kerak");
      }
      return { ratePerM3: null, percent: p };
    }
    if (hasRate || hasPercent) throw new BadRequestException('NONE dasturi ratePerM3/percent maydonlarini qabul qilmaydi');
    return { ratePerM3: null, percent: null };
  }

  async create(dto: CreateFactoryDto, user: RequestUser) {
    const wantsBonus = dto.bonusKind !== undefined && dto.bonusKind !== BonusProgramKind.NONE;
    const bonusFields = wantsBonus
      ? this.resolveBonusFields(dto.bonusKind as BonusProgramKind, dto.bonusRatePerM3, dto.bonusPercent)
      : null;
    let row;
    try {
      row = await this.prisma.$transaction(async (tx) => {
        const factory = await tx.factory.create({ data: { name: dto.name.trim(), note: dto.note ?? null } });
        if (bonusFields) {
          await tx.bonusProgram.create({
            data: {
              factoryId: factory.id,
              kind: dto.bonusKind as BonusProgramKind,
              ratePerM3: bonusFields.ratePerM3,
              percent: bonusFields.percent,
              effectiveFrom: new Date(),
              createdBy: user.userId,
            },
          });
        }
        return factory;
      });
    } catch (e) {
      this.rethrowUnique(e);
    }
    await this.audit.log({
      userId: user.userId,
      action: AuditAction.CREATE,
      entity: 'Factory',
      entityId: row.id,
      after: asJson(row),
    });
    return row;
  }

  async update(id: string, dto: UpdateFactoryDto, user: RequestUser) {
    const before = await this.prisma.factory.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Zavod topilmadi');
    const data: Prisma.FactoryUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.note !== undefined) data.note = dto.note;
    if (dto.active !== undefined) data.active = dto.active;
    let row;
    try {
      row = await this.prisma.factory.update({ where: { id }, data });
    } catch (e) {
      this.rethrowUnique(e);
    }
    await this.audit.log({
      userId: user.userId,
      action: AuditAction.UPDATE,
      entity: 'Factory',
      entityId: id,
      before: asJson(before),
      after: asJson(row),
    });
    return row;
  }

  /** Soft-delete: factories with history are never hard-deleted — deactivate only. */
  async deactivate(id: string, user: RequestUser) {
    const before = await this.prisma.factory.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Zavod topilmadi');
    if (!before.active) return before;
    const row = await this.prisma.factory.update({ where: { id }, data: { active: false } });
    await this.audit.log({
      userId: user.userId,
      action: AuditAction.DELETE,
      entity: 'Factory',
      entityId: id,
      before: asJson(before),
      after: asJson(row),
      note: 'Soft-delete: zavod nofaol qilindi',
    });
    return row;
  }

  // ── bonus program (versioned inserts, never updated, never retroactive) ──

  async setBonusProgram(factoryId: string, dto: SetBonusProgramDto, user: RequestUser) {
    const factory = await this.prisma.factory.findUnique({ where: { id: factoryId }, select: { id: true } });
    if (!factory) throw new NotFoundException('Zavod topilmadi');

    const hasRate = dto.ratePerM3 !== undefined && dto.ratePerM3 !== null;
    const hasPercent = dto.percent !== undefined && dto.percent !== null;
    let ratePerM3: Prisma.Decimal | null = null;
    let percent: Prisma.Decimal | null = null;

    if (dto.kind === BonusProgramKind.PER_M3) {
      if (!hasRate) throw new BadRequestException('PER_M3 dasturi uchun ratePerM3 majburiy');
      if (hasPercent) throw new BadRequestException('PER_M3 dasturi percent maydonini qabul qilmaydi');
      ratePerM3 = this.positiveMoney(dto.ratePerM3 as number | string, 'ratePerM3');
    } else if (dto.kind === BonusProgramKind.PERCENT) {
      if (!hasPercent) throw new BadRequestException('PERCENT dasturi uchun percent majburiy');
      if (hasRate) throw new BadRequestException('PERCENT dasturi ratePerM3 maydonini qabul qilmaydi');
      const p = D(dto.percent as number | string).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      if (!p.isFinite() || p.lessThanOrEqualTo(0) || p.greaterThan(100)) {
        throw new BadRequestException("percent 0 dan katta va 100 dan oshmaydigan son bo'lishi kerak");
      }
      percent = p;
    } else {
      // NONE — switches the program off; carries no rate fields
      if (hasRate || hasPercent) {
        throw new BadRequestException('NONE dasturi ratePerM3/percent maydonlarini qabul qilmaydi');
      }
    }

    const effectiveFrom = dto.effectiveFrom ? new Date(dto.effectiveFrom) : new Date();

    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.bonusProgram.create({
          data: { factoryId, kind: dto.kind, ratePerM3, percent, effectiveFrom, createdBy: user.userId },
        });
        await this.audit.log({
          tx,
          userId: user.userId,
          action: AuditAction.CREATE,
          entity: 'BonusProgram',
          entityId: row.id,
          after: asJson(row),
          note:
            'Bonus dasturi versiyalanadi, retroaktiv emas: faqat effectiveFrom dan keyin COMPLETED bo‘lgan buyurtmalarga ta’sir qiladi',
        });
        return row;
      });
    } catch (e) {
      if ((e as { code?: string })?.code === 'P2002') {
        throw new BadRequestException("Shu zavod uchun aynan shu vaqtdan kuchga kiruvchi dastur allaqachon mavjud");
      }
      throw e;
    }
  }

  async getBonusProgram(factoryId: string) {
    const factory = await this.prisma.factory.findUnique({ where: { id: factoryId }, select: { id: true } });
    if (!factory) throw new NotFoundException('Zavod topilmadi');
    const history = await this.prisma.bonusProgram.findMany({
      where: { factoryId },
      orderBy: { effectiveFrom: 'desc' },
    });
    const now = new Date();
    const current = history.find((p) => p.effectiveFrom <= now) ?? null;
    return { current, history };
  }

  private positiveMoney(v: number | string, field: string): Prisma.Decimal {
    try {
      return assertPositiveMoney(v, field);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }

  private rethrowUnique(e: unknown): never {
    if ((e as { code?: string })?.code === 'P2002') {
      throw new BadRequestException('Bu nomli zavod allaqachon mavjud');
    }
    throw e;
  }
}
