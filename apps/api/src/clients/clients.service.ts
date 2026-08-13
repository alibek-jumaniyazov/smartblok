import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  LedgerAccount,
  LedgerSource,
  PalletTransactionType,
  PaymentKind,
  Prisma,
} from '@prisma/client';
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

    return {
      ...paged(
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
      ),
      summary: await this.listSummary(where, total),
    };
  }

  /**
   * «Mijozlar jami» — the roll-up above the clients table.
   *
   * This list is SERVER-paginated, so summing the 20 visible rows would be a page total
   * masquerading as a grand total. It therefore folds every client matching the CURRENT
   * FILTER, page or not.
   *
   * Debt and advance are kept APART instead of being handed over as one net figure: a
   * page showing «12 000 000» hides whether that is one debtor or forty debtors against
   * a big prepayment. `net` is published too, because that is the «Ост» semantics the
   * dashboard and the workbook use.
   */
  private async listSummary(where: Prisma.ClientWhereInput, total: number) {
    const all = await this.prisma.client.findMany({ where, select: { id: true } });
    const ids = all.map((c) => c.id);
    if (ids.length === 0) {
      return {
        clients: total,
        debtors: 0,
        inAdvance: 0,
        owedToUs: ZERO,
        weOweThem: ZERO,
        net: ZERO,
        palletsAtClients: 0,
      };
    }
    const [balances, stats] = await Promise.all([this.ledger.clientBalances(ids), this.palletStats(ids)]);

    let owedToUs = ZERO;
    let weOweThem = ZERO;
    let debtors = 0;
    let inAdvance = 0;
    for (const id of ids) {
      const b = balances.get(id) ?? ZERO;
      // >0 ⇒ mijoz bizga qarzdor; <0 ⇒ bizda uning avansi turibdi
      if (b.greaterThan(0)) {
        owedToUs = owedToUs.plus(b);
        debtors++;
      } else if (b.lessThan(0)) {
        weOweThem = weOweThem.plus(b.negated());
        inAdvance++;
      }
    }
    let pallets = 0;
    for (const id of ids) pallets += stats.get(id)?.balance ?? 0;

    return {
      clients: total,
      debtors,
      inAdvance,
      owedToUs: round2(owedToUs),
      weOweThem: round2(weOweThem),
      /** «Ост» — qarzdorlar minus avans berganlar */
      net: round2(owedToUs.minus(weOweThem)),
      palletsAtClients: pallets,
    };
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

    const [balance, palletStats, orders, payments, statement, paymentTotals] = await Promise.all([
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
      // `payments` above is only the last 20 rows — it can never answer «shu mijozdan
      // hozirgacha jami qancha pul oldik». This folds the FULL payment history.
      this.paymentTotals(id),
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
      /** all-time «shu mijozdan qancha pul oldik» — to'liq daftardan */
      paymentTotals,
      orders,
      payments,
      statement,
    };
  }

  /**
   * «Shu mijozdan hozirgacha jami qancha pul oldik» — all-time, voided documents excluded.
   *
   * ┌ NEGA IKKI USTUN: «hujjat» va «kassa» (2026-08-13) ┐
   * Bu figura HUJJATLARNI sanaydi, mijoz kartochkasining yonidagi «Tranzaksiyalar» jurnali
   * esa KASSA qatorlarini (CashTransaction) ko'rsatadi. Ikkalasi teng bo'lishi SHART emas:
   * Excel importidagi «шопр учун барди» qatorlari mijozning to'lovi sifatida daftarga
   * kiradi (uning qarzini kamaytiradi), lekin pul bizning kassamizga umuman kirmagan —
   * u yo'lda shofyorning qo'liga berilgan. Bunday hujjatda `cashboxId` yo'q va kassa
   * qatori ham yozilmaydi.
   *
   * Shu sababli ekran «138 621 500 olindi» deb turib, jurnalda 126 121 500 ko'rsatardi va
   * farqni HECH NARSA izohlamasdi (eski izoh faqat TRANSPORT_DIRECT haqida edi, uning
   * qatorlari esa bu bazada umuman yo'q). Endi ayirma o'z nomi bilan chiqadi:
   *   received = viaKassa + offKassa   (ikkalasi ham mijoz qarzini kamaytiradi)
   * `offKassa` YOLG'IZ o'zi hech narsani inkor qilmaydi — u shunchaki «kassaga tushmagan»
   * degan FAKT, va aynan shu farq jurnalda ko'rinmaydigan summaga TENG.
   *
   * `paidToDriver` (TRANSPORT_DIRECT) o'z o'rnida qoladi va `received` dan TASHQARIDA:
   * u to'lov emas, buyurtma yaratilishida mijoz qarzidan ajratilgan transport ulushi.
   * `offKassa` esa haqiqiy to'lov — faqat kassadan o'tmagani.
   */
  private async paymentTotals(clientId: string) {
    const where: Prisma.PaymentWhereInput = {
      clientId,
      voidedAt: null,
      kind: { in: [PaymentKind.CLIENT_IN, PaymentKind.CLIENT_REFUND, PaymentKind.TRANSPORT_DIRECT] },
    };
    const [groups, dates] = await Promise.all([
      // Kassasiz hujjat aynan shu ikki ustunning NULL i bilan ajraladi (Prisma `where` da
      // «IS NULL bo'yicha guruhlash» yo'q, shuning uchun guruhlab, keyin yig'amiz —
      // kassalar soni oltitadan oshmaydi). `usdCashboxId` ham SHART: sof dollar to'lovida
      // so'm kassasi bo'lmaydi, lekin kassa qatori YOZILADI va u jurnalda ko'rinadi —
      // faqat `cashboxId` ga qarash uni «kassadan tashqari» deb yolg'on belgilardi.
      this.prisma.payment.groupBy({
        by: ['kind', 'cashboxId', 'usdCashboxId'],
        where,
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.payment.aggregate({ where, _min: { date: true }, _max: { date: true } }),
    ]);
    type Group = (typeof groups)[number];
    const sumOf = (kind: PaymentKind, pick: (g: Group) => boolean) =>
      groups
        .filter((g) => g.kind === kind && pick(g))
        .reduce((a, g) => a.plus(D(g._sum.amount ?? 0)), D(0));
    const countOf = (kind: PaymentKind, pick: (g: Group) => boolean) =>
      groups.filter((g) => g.kind === kind && pick(g)).reduce((a, g) => a + g._count._all, 0);
    const any = () => true;
    const offBox = (g: Group) => g.cashboxId === null && g.usdCashboxId === null;

    const received = round2(sumOf(PaymentKind.CLIENT_IN, any));
    const refunded = round2(sumOf(PaymentKind.CLIENT_REFUND, any));
    // Kassadan tashqari kirim va chiqim ALOHIDA turadi — ular bitta gapga qo'shilsa,
    // «kassadan tashqari 2 000 000 (2 ta hujjat)» degan jumla chiqardi, holbuki ikkinchi
    // hujjat 220 000 lik QAYTARIM va u boshqa tomonga ketadi. Har raqam o'z hujjatlari
    // sonini olib yuradi.
    const offKassaIn = round2(sumOf(PaymentKind.CLIENT_IN, offBox));
    const offKassaOut = round2(sumOf(PaymentKind.CLIENT_REFUND, offBox));
    return {
      /** Σ CLIENT_IN — mijoz to'lagan pul (kassaga tushgani ham, tushmagani ham) */
      received,
      /** Σ CLIENT_REFUND — mijozga qaytarganimiz */
      refunded,
      /** received − refunded */
      netReceived: round2(received.minus(refunded)),
      /** shundan KASSAGA tushgani — «Tranzaksiyalar» jurnalidagi qatorlar aynan shular */
      viaKassa: round2(received.minus(offKassaIn)),
      /** shundan KASSADAN TASHQARI (shofyor qo'liga berilgani) — jurnalda ko'rinmaydi */
      offKassa: offKassaIn,
      /** kassadan tashqari QAYTARIM — o'z soni bilan, kirimga qo'shilmaydi */
      offKassaRefunded: offKassaOut,
      offKassaRefundedCount: countOf(PaymentKind.CLIENT_REFUND, offBox),
      /** kassadan tashqari KIRIM hujjatlari soni — `offKassa` ning aynan o'z soni */
      offKassaCount: countOf(PaymentKind.CLIENT_IN, offBox),
      /** Σ TRANSPORT_DIRECT — mijoz shofyorga bergani (kassadan o'tmaydi) */
      paidToDriver: round2(sumOf(PaymentKind.TRANSPORT_DIRECT, any)),
      paymentCount: groups.reduce((s, g) => s + g._count._all, 0),
      firstPaymentAt: dates._min.date ?? null,
      lastPaymentAt: dates._max.date ?? null,
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
