import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  BonusProgramKind,
  FactoryBucket,
  LedgerAccount,
  LedgerSource,
  PaymentKind,
  PaymentMethod,
  Prisma,
} from '@prisma/client';
import { PalletService } from '../pallets/pallets.service';
import { EMPTY_PALLET_STATS, type PalletPartyStats } from '../pallets/pallet-stats';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { LedgerService } from '../common/ledger.service';
import { assertPositiveMoney, D, round2, ZERO } from '../common/money';
import { AdjustBalanceDto } from '../common/adjust-balance.dto';
import { pageArgs, paged, PageQueryDto } from '../common/pagination';
import { RequestUser } from '../common/scoping';
import { CreateFactoryDto, SetBonusProgramDto, UpdateFactoryDto } from './dto';

/** Decimal/Date-safe snapshot for AuditLog Json columns. */
const asJson = (v: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;

/** The two payment kinds that move REAL money between the dealer and a factory. */
const FACTORY_PAYMENT_KINDS: PaymentKind[] = [PaymentKind.FACTORY_OUT, PaymentKind.FACTORY_REFUND];

/**
 * «Shu zavodga hozirgacha jami qancha pul o'tkazganmiz» — the all-time settlement
 * history of ONE factory, folded from the whole Payment table (never from the last-50
 * tail the detail screen renders).
 *
 * `bonusOffset` is carved OUT of `paid` on purpose: a FACTORY_OUT whose method is BONUS
 * is a wallet offset created by /bonus/offset — it settles debt without a single so'm
 * leaving a cashbox. Counting it as money transferred would overstate the figure the
 * owner cross-checks against his kassa.
 */
export interface FactoryPaymentTotals {
  /** Σ FACTORY_OUT (BONUS-dan tashqari) — kassadan haqiqatan chiqqan pul */
  paid: Prisma.Decimal;
  /**
   * `paid` split by CHANNEL (owner rule, 2026-07-26). The app's own vocabulary reserves
   * «o'tkazma» for the BANK family, yet this figure was labelled «jami o'tkazilgan pul»
   * while summing naqd + click + terminal + bank — the same screen used one word with two
   * meanings, two lines apart. The split is what the owner actually reads, so it is served
   * rather than left to be guessed from the row list.
   */
  paidCash: Prisma.Decimal;
  paidBank: Prisma.Decimal;
  /** Σ FACTORY_REFUND — zavod bizga qaytargani */
  refunded: Prisma.Decimal;
  /** paid − refunded: «sof o'tkazilgan pul» */
  netPaid: Prisma.Decimal;
  /** Σ FACTORY_OUT (method=BONUS) — bonus hamyonidan yopilgani, pul emas */
  bonusOffset: Prisma.Decimal;
  /** bekor qilinmagan to'lov hujjatlari soni (bonus offsetlar ham kiradi) */
  paymentCount: number;
  firstPaymentAt: Date | null;
  lastPaymentAt: Date | null;
}

/**
 * Which methods are NAQD money (mirrors PaymentsService.FACTORY_CASH_METHODS — CLICK counts
 * as cash-equivalent by owner decision 2026-07-13; CARD/USD are retired but historical).
 *
 * Exported so the factory REPORT classifies a method the same way this fold does. Its
 * per-method table is built from a separate groupBy (the fold below throws the method away),
 * and a private copy there would have been the fourth in the codebase — the day CLICK moves
 * families, the report and the factory card would disagree with no error anywhere.
 */
export const FACTORY_CASH_METHODS: PaymentMethod[] = [
  PaymentMethod.CASH,
  PaymentMethod.CLICK,
  PaymentMethod.CARD,
  PaymentMethod.USD,
];

/** «Bu usul naqdmi, o'tkazmami, yoki umuman pul emasmi?» — yagona javob beruvchi. */
export type PaymentMethodFamily = 'CASH' | 'BANK' | 'BONUS';
export const methodFamily = (method: PaymentMethod): PaymentMethodFamily =>
  method === PaymentMethod.BONUS ? 'BONUS' : FACTORY_CASH_METHODS.includes(method) ? 'CASH' : 'BANK';

export const emptyPaymentTotals = (): FactoryPaymentTotals => ({
  paid: ZERO,
  paidCash: ZERO,
  paidBank: ZERO,
  refunded: ZERO,
  netPaid: ZERO,
  bonusOffset: ZERO,
  paymentCount: 0,
  firstPaymentAt: null,
  lastPaymentAt: null,
});

@Injectable()
export class FactoriesService {
  constructor(
    private prisma: PrismaService,
    private ledger: LedgerService,
    private audit: AuditService,
    private pallets: PalletService,
  ) {}

  /**
   * factoryId → «hozirgacha jami to'langan» roll-up, scoped by the SAME factory filter the
   * caller is listing with (`{}` = every factory). ONE grouped sweep of the payment table —
   * never a per-row query — so a 90-factory list still costs two round-trips.
   *
   * Voided payments are excluded everywhere: a cancelled document never moved money.
   */
  async paymentTotalsMap(
    where: Prisma.FactoryWhereInput,
    /**
     * Ixtiyoriy davr oynasi (Toshkent kunlaridan hosil qilingan UTC chegaralari).
     * Berilmasa — BUTUN tarix, ya'ni list/detail ekranlarining bugungi xulqi aynan saqlanadi.
     * Zavod hisoboti esa aynan shu foldni davr bilan chaqiradi, chunki «shu oyda qancha
     * to'ladik» va «hozirgacha qancha to'ladik» bitta formuladan chiqishi kerak.
     */
    window?: { gte: Date; lt: Date },
  ): Promise<Map<string, FactoryPaymentTotals>> {
    const scope: Prisma.PaymentWhereInput = {
      factoryId: { not: null },
      voidedAt: null,
      kind: { in: FACTORY_PAYMENT_KINDS },
      ...(window ? { date: { gte: window.gte, lt: window.lt } } : {}),
      ...(Object.keys(where).length ? { factory: where } : {}),
    };
    const [groups, dates] = await Promise.all([
      this.prisma.payment.groupBy({
        // method is in the grouping so the BONUS offsets separate from real money in
        // the same pass (see FactoryPaymentTotals.bonusOffset)
        by: ['factoryId', 'kind', 'method'],
        where: scope,
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.payment.groupBy({
        by: ['factoryId'],
        where: scope,
        _min: { date: true },
        _max: { date: true },
      }),
    ]);

    const map = new Map<string, FactoryPaymentTotals>();
    const row = (id: string) => {
      const cur = map.get(id) ?? emptyPaymentTotals();
      map.set(id, cur);
      return cur;
    };
    for (const g of groups) {
      if (!g.factoryId) continue;
      const t = row(g.factoryId);
      const amount = D(g._sum.amount ?? 0);
      if (g.kind === PaymentKind.FACTORY_REFUND) t.refunded = t.refunded.plus(amount);
      else if (g.method === PaymentMethod.BONUS) t.bonusOffset = t.bonusOffset.plus(amount);
      else {
        t.paid = t.paid.plus(amount);
        if (FACTORY_CASH_METHODS.includes(g.method)) t.paidCash = t.paidCash.plus(amount);
        else t.paidBank = t.paidBank.plus(amount);
      }
      t.paymentCount += g._count._all;
    }
    for (const d of dates) {
      if (!d.factoryId) continue;
      const t = row(d.factoryId);
      t.firstPaymentAt = d._min.date ?? null;
      t.lastPaymentAt = d._max.date ?? null;
    }
    for (const t of map.values()) {
      t.paid = round2(t.paid);
      t.paidCash = round2(t.paidCash);
      t.paidBank = round2(t.paidBank);
      t.refunded = round2(t.refunded);
      t.bonusOffset = round2(t.bonusOffset);
      t.netPaid = round2(t.paid.minus(t.refunded));
    }
    return map;
  }

  /** Σ of a totals map — the «barcha zavodlarga jami» strip on the list screen. */
  private foldPaymentTotals(map: Map<string, FactoryPaymentTotals>) {
    const all = emptyPaymentTotals();
    for (const t of map.values()) {
      all.paid = all.paid.plus(t.paid);
      all.paidCash = all.paidCash.plus(t.paidCash);
      all.paidBank = all.paidBank.plus(t.paidBank);
      all.refunded = all.refunded.plus(t.refunded);
      all.bonusOffset = all.bonusOffset.plus(t.bonusOffset);
      all.paymentCount += t.paymentCount;
      if (t.firstPaymentAt && (!all.firstPaymentAt || t.firstPaymentAt < all.firstPaymentAt)) {
        all.firstPaymentAt = t.firstPaymentAt;
      }
      if (t.lastPaymentAt && (!all.lastPaymentAt || t.lastPaymentAt > all.lastPaymentAt)) {
        all.lastPaymentAt = t.lastPaymentAt;
      }
    }
    all.paid = round2(all.paid);
    all.paidCash = round2(all.paidCash);
    all.paidBank = round2(all.paidBank);
    all.refunded = round2(all.refunded);
    all.bonusOffset = round2(all.bonusOffset);
    all.netPaid = round2(all.paid.minus(all.refunded));
    return { ...all, factories: map.size };
  }

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

    const [rows, total, buckets, bonusRows, palletMap, paidMap] = await Promise.all([
      this.prisma.factory.findMany({ where, orderBy: { name: 'asc' }, skip, take }),
      this.prisma.factory.count({ where }),
      this.ledger.factoryBucketsMap(),
      this.prisma.bonusTransaction.groupBy({ by: ['factoryId'], _sum: { amount: true } }),
      // Single source of truth for the count (it also folds ADJUSTMENT/REVERSAL rows).
      // This screen used to re-implement the formula WITHOUT them, so after any order
      // cancel it reported a higher pallet count than the pallets page did.
      // One grouped sweep over the whole pallet ledger — never per row — and it now
      // carries the «jami oldik / qaytardik» breakdown alongside the netted balance,
      // so `palletsHeld` is read off the same fold and cannot drift from it.
      this.pallets.factoryPalletStats(),
      // «Hozirgacha jami to'langan» — the same filter the page is listing with, so the
      // roll-up under the table can never disagree with the rows above it.
      this.paymentTotalsMap(where),
    ]);

    const bonusMap = new Map(bonusRows.map((r) => [r.factoryId, D(r._sum.amount ?? 0)]));

    const items = rows.map((f) => {
      const b = buckets.get(f.id);
      // A factory that has never shipped a pallet has no ledger rows at all, so the
      // fold simply skips it — the zero row keeps the shape uniform for the client.
      const palletStats: PalletPartyStats = palletMap.get(f.id) ?? { ...EMPTY_PALLET_STATS };
      const paidTotals = paidMap.get(f.id) ?? emptyPaymentTotals();
      return {
        ...f,
        /** >0 ⇒ dealer's advance at the factory; <0 ⇒ dealer owes the factory */
        balance: b?.net ?? ZERO,
        /** open GOODS debt only — money standing at the factory no longer hides it */
        payable: b?.payable ?? ZERO,
        advanceCash: b?.advanceCash ?? ZERO,
        advanceBank: b?.advanceBank ?? ZERO,
        advanceTotal: b?.advanceTotal ?? ZERO,
        bonusBalance: bonusMap.get(f.id) ?? ZERO,
        /** pallets owed to this factory — a COUNT, never money */
        palletsHeld: palletStats.balance,
        /** «zavoddan jami oldik / qaytardik / hozir qarzmiz» — sof (net of cancels) */
        palletStats,
        /** all-time «shu zavodga qancha pul o'tkazdik» (bekor qilinganlarsiz) */
        paymentTotals: paidTotals,
      };
    });
    return {
      ...paged(items, total, page, pageSize),
      /** the whole filter, not just this page — the list screen labels it «Jami» */
      paymentSummary: this.foldPaymentTotals(paidMap),
    };
  }

  async findOne(id: string) {
    const factory = await this.prisma.factory.findUnique({ where: { id } });
    if (!factory) throw new NotFoundException('Zavod topilmadi');

    const [
      statement,
      payments,
      bonusPrograms,
      bonusTransactions,
      palletTransactions,
      buckets,
      bonusAgg,
      palletStats,
      paymentTotals,
    ] = await Promise.all([
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
        this.ledger.factoryBuckets(id),
        this.prisma.bonusTransaction.aggregate({ where: { factoryId: id }, _sum: { amount: true } }),
        // `palletTransactions` above is only the last 50 rows — a paged tail can never
        // answer «shu paytgacha jami qancha». This one aggregates the FULL ledger, and
        // its `balance` is the same number the caps and the pallets page enforce, so the
        // legacy `palletsHeld` is derived from it instead of costing a second query.
        this.pallets.factoryPalletStatsOne(id),
        // `payments` above is the last 50 rows — it can never answer «shu paytgacha
        // jami qancha to'ladik». This folds the FULL payment history of the factory.
        this.paymentTotalsMap({ id }).then((m) => m.get(id) ?? emptyPaymentTotals()),
      ]);

    return {
      ...factory,
      // The owner's three numbers. `balance` stays the legacy net so nothing that
      // already reads it breaks; payable/advance* are what the screens now show.
      balance: buckets.net,
      payable: buckets.payable,
      advanceCash: buckets.advanceCash,
      advanceBank: buckets.advanceBank,
      advanceTotal: buckets.advanceTotal,
      bonusBalance: D(bonusAgg._sum.amount ?? 0),
      palletsHeld: palletStats.balance,
      /** «zavoddan jami oldik / qaytardik / hozir qarzmiz» + oxirgi harakat sanalari */
      palletStats,
      /** all-time «shu zavodga qancha pul o'tkazdik» (to'liq daftardan, oxirgi 50 dan emas) */
      paymentTotals,
      statement,
      payments,
      bonusPrograms,
      bonusTransactions,
      palletTransactions,
    };
  }

  /**
   * «Balansni nazorat qilish» — an off-book manual correction of the factory balance. Posts a
   * single OFFBOOK_ADJUSTMENT ledger row to the PAYABLE bucket (no kassa row): it moves THIS
   * factory's balance and shows in its statement, but is excluded from the dashboard rollups
   * and the transactions journal (owner rule, 2026-07-22). ADMIN-only (controller-gated).
   */
  async adjustBalance(id: string, dto: AdjustBalanceDto, user: RequestUser) {
    const factory = await this.prisma.factory.findUnique({ where: { id } });
    if (!factory) throw new NotFoundException('Zavod topilmadi');
    const amount = round2(D(dto.amount));
    if (!amount.isFinite() || amount.isZero()) {
      throw new BadRequestException("Tuzatish summasi noldan farqli bo'lishi kerak");
    }
    return this.prisma.$transaction(async (tx) => {
      await this.ledger.post(tx, {
        date: dto.date ? new Date(dto.date) : new Date(),
        account: LedgerAccount.FACTORY,
        source: LedgerSource.OFFBOOK_ADJUSTMENT,
        factoryId: id,
        // PAYABLE — the open-goods-debt bucket the factory hero shows; >0 shrinks our debt.
        factoryBucket: FactoryBucket.PAYABLE,
        amount,
        note: dto.note?.trim() || "Balans qo'lda tuzatildi (off-book)",
        createdById: user.userId,
      });
      await this.audit.log({
        tx,
        userId: user.userId,
        action: AuditAction.UPDATE,
        entity: 'Factory',
        entityId: id,
        after: asJson({ offBookAdjustment: amount.toFixed(2), note: dto.note ?? null }),
        note: 'Off-book balans tuzatildi',
      });
      const buckets = await this.ledger.factoryBuckets(id, tx);
      return {
        id,
        balance: buckets.net,
        payable: buckets.payable,
        advanceCash: buckets.advanceCash,
        advanceBank: buckets.advanceBank,
        advanceTotal: buckets.advanceTotal,
      };
    });
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
