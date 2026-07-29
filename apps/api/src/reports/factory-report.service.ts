import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  BonusTransactionType,
  FactoryBucket,
  LedgerAccount,
  LedgerSource,
  PaymentKind,
  PriceKind,
  Prisma,
} from '@prisma/client';
import { BonusService } from '../bonus/bonus.service';
import { LedgerService, type FactoryBuckets } from '../common/ledger.service';
import { D, round2, round3, round6, ZERO } from '../common/money';
import { liveOrders, NOT_CANCELLED_SQL } from '../common/order-scope';
import { parseTashkentFrom, parseTashkentTo } from '../common/tashkent-time';
import { DebtsService } from '../debts/debts.service';
import {
  emptyPaymentTotals,
  FactoriesService,
  methodFamily,
  type FactoryPaymentTotals,
} from '../factories/factories.service';
import { PalletService } from '../pallets/pallets.service';
import { PrismaService } from '../prisma/prisma.service';
import type { FactoryReportOrdersQueryDto, FactoryReportQueryDto } from './dto';
import type {
  FactoryBucketsWire,
  FactoryReport,
  FactoryReportOrderRow,
  FactoryReportOrdersResponse,
  FactoryReportProduct,
  PriceBucket,
  ReportPeriod,
} from './types';

const DAY_MS = 24 * 60 * 60 * 1000;
const FACTORY_MONEY_KINDS: PaymentKind[] = [PaymentKind.FACTORY_OUT, PaymentKind.FACTORY_REFUND];
const ADVANCE_BUCKETS: FactoryBucket[] = [FactoryBucket.ADVANCE_CASH, FactoryBucket.ADVANCE_BANK];

/** Toshkent kunlaridan hosil qilingan yarim ochiq UTC oynasi: [gte, lt). */
interface Window {
  gte: Date;
  lt: Date;
  /** foydalanuvchi haqiqatan `to` berdimi — «davr oxiriga» ustuni shunga qarab hal qilinadi */
  bounded: boolean;
}

/** Mahsulot × narx kesimi — bitta xom SQL qaytaradigan qator. */
interface ProductPriceRow {
  productId: string;
  productName: string;
  size: string | null;
  pricePerM3: Prisma.Decimal;
  cubeM3: Prisma.Decimal;
  plannedM3: Prisma.Decimal;
  costTotal: Prisma.Decimal;
  anchorTotal: Prisma.Decimal;
  palletCount: number;
  items: number;
  orders: number;
  blended: number;
}

/** Faqat narx kesimi — buyurtma sonini mahsulotlar bo'ylab TAKRORLAMASDAN sanash uchun. */
type PriceOnlyRow = Omit<ProductPriceRow, 'productId' | 'productName' | 'size' | 'plannedM3' | 'palletCount'>;

const m = (v: Prisma.Decimal.Value): string => round2(v).toFixed(2);
const vol = (v: Prisma.Decimal.Value): string => round3(v).toFixed(3);
const price = (v: Prisma.Decimal.Value): string => round6(v).toFixed(6);
const iso = (d: Date | null | undefined): string | null => (d ? new Date(d).toISOString() : null);

/** costTotal / cubeM3 — hajm nol bo'lsa null («0 so'm» deb yozish «bepul oldik» degani bo'lardi). */
const avgPrice = (cost: Prisma.Decimal, cube: Prisma.Decimal): string | null =>
  cube.isZero() ? null : m(cost.div(cube));

const wireBuckets = (b: FactoryBuckets): FactoryBucketsWire => ({
  payable: m(b.payable),
  advanceCash: m(b.advanceCash),
  advanceBank: m(b.advanceBank),
  advanceTotal: m(b.advanceTotal),
  net: m(b.net),
});

const fmtDate = (d: Date): string => {
  const s = new Date(d.getTime() + 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}`;
};

/**
 * ═══════════════ ZAVOD BO'YICHA HISOBOT ═══════════════
 *
 * Egasining savoli: «shu zavoddan shu oyda nima oldim, qancha to'ladim, qancha qarzim
 * qoldi» — bitta ekranda, ichki ma'lumotlarigacha.
 *
 * ── Bu servis QAYSI FORMULANI O'ZI YOZMAYDI ──
 * Qarz/avans — LedgerService, zavodga to'langan pul — FactoriesService fold'i, ochiq
 * buyurtma qarzi — DebtsService doskasi, poddon — PalletService. Hammasi ATAYLAB shunday:
 * bu raqamlar saytning boshqa ekranlarida ham chiqadi va ular hech qachon farq qilmasligi
 * kerak. Kod bazasining eng qimmat xatosi — bitta formulani ikkinchi marta yozish: ikkalasi
 * bir kun ajralib ketadi va ekranda hech qanday xato ko'rinmaydi, shunchaki raqam boshqa
 * bo'ladi.
 *
 * O'zi yozadigani — faqat shu hisobotga xos KESIMLAR (mahsulot × narx, narxnoma kanali,
 * davr oxiriga qarz), ular boshqa hech qayerda mavjud emas.
 *
 * ── Bekor qilingan buyurtma ──
 * Hech bir raqamga kirmaydi (egasining qoidasi, common/order-scope.ts). Faqat SONI
 * `cancelledOrders` da qoladi, chunki «nega buyurtmalar soni 12 emas 10?» degan savolga
 * ekranning o'zi javob berishi kerak.
 */
@Injectable()
export class FactoryReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly factories: FactoriesService,
    private readonly debts: DebtsService,
    private readonly pallets: PalletService,
    private readonly bonus: BonusService,
  ) {}

  /**
   * from/to (Toshkent kunlari) → UTC oynasi. `to` kunning O'ZI to'liq ichida
   * (yuqori chegara — keyingi kunning yarim tuni).
   */
  private resolveWindow(q: FactoryReportQueryDto): Window {
    const gte = parseTashkentFrom(q.from) ?? new Date(0);
    const bounded = !!q.to;
    // ochiq yuqori chegara: kelajak sanali yozuvlar ham tushib qolmasin
    const lt = parseTashkentTo(q.to) ?? new Date(Date.now() + 365 * DAY_MS);
    if (lt.getTime() <= gte.getTime()) {
      throw new BadRequestException("Sana oralig'i teskari: «dan» «gacha» dan keyin turibdi");
    }
    return { gte, lt, bounded };
  }

  /**
   * `label` — o'zbek lotinda yasaladi va ATAYLAB faqat EXCEL uchun (kitob baribir
   * kirillga o'giriladi). Sahifa o'z davr yorlig'ini `from`/`to` dan t() bilan yasaydi:
   * serverdan kelgan tayyor matn ru/en da tarjimasiz qolib ketardi.
   */
  private periodWire(q: FactoryReportQueryDto, w: Window): ReportPeriod {
    const label =
      q.from || q.to
        ? `${q.from ? fmtDate(w.gte) : 'boshidan'} — ${q.to ? fmtDate(new Date(w.lt.getTime() - DAY_MS)) : 'hozirgacha'}`
        : 'Butun davr';
    return { from: q.from ?? null, to: q.to ?? null, gte: w.gte.toISOString(), lt: w.lt.toISOString(), label };
  }

  /** Hisobotning HAMMA joyida ishlatiladigan yagona buyurtma predikati. */
  private orderScope(factoryId: string, w: Window): Prisma.OrderWhereInput {
    return liveOrders({ factoryId, date: { gte: w.gte, lt: w.lt } });
  }

  // ─────────────────────────── 1) to'liq hisobot ───────────────────────────

  async factoryReport(q: FactoryReportQueryDto): Promise<FactoryReport> {
    const w = this.resolveWindow(q);
    const factory = await this.prisma.factory.findUnique({ where: { id: q.factoryId } });
    if (!factory) throw new NotFoundException('Zavod topilmadi');

    const scope = this.orderScope(factory.id, w);

    const [
      byProductPrice,
      byPrice,
      orderCounts,
      orderCostAgg,
      paymentTotals,
      methodRows,
      allocRows,
      advanceRows,
      currentBuckets,
      offBookAll,
      offBookAsOf,
      debtBoard,
      palletPeriod,
      palletAll,
      bonusAgg,
      walletCurrent,
      program,
    ] = await Promise.all([
      this.productPriceRows(factory.id, w),
      this.priceRows(factory.id, w),
      Promise.all([
        this.prisma.order.count({ where: scope }),
        this.prisma.order.count({
          where: { factoryId: factory.id, date: { gte: w.gte, lt: w.lt }, status: 'CANCELLED' },
        }),
      ]),
      this.prisma.order.aggregate({ where: scope, _sum: { costTotal: true } }),
      this.factories
        .paymentTotalsMap({ id: factory.id }, w)
        .then((map) => map.get(factory.id) ?? emptyPaymentTotals()),
      this.prisma.payment.groupBy({
        by: ['kind', 'method'],
        where: {
          factoryId: factory.id,
          voidedAt: null,
          kind: { in: FACTORY_MONEY_KINDS },
          date: { gte: w.gte, lt: w.lt },
        },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      // Narxnoma kanali. Oyna ATAYLAB `payment.date` orqali: PaymentAllocation da biznes
      // sanasi umuman yo'q (faqat `createdAt` — devor soati), va butun kod bazasi
      // taqsimotni to'lovning o'z sanasi bilan oynalaydi.
      this.prisma.paymentAllocation.groupBy({
        by: ['priceKind'],
        where: {
          voidedAt: null,
          payment: {
            kind: PaymentKind.FACTORY_OUT,
            voidedAt: null,
            factoryId: factory.id,
            date: { gte: w.gte, lt: w.lt },
          },
        },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      // «Avansdan yechilgani» va «avansga tushgani» — IKKALASI ham daftardan, cho'ntak
      // ustunidan. `PaymentAllocation.fromAdvance` ishlatilmaydi: u har qanday FACTORY_OUT
      // taqsimotiga true qo'yiladi, ya'ni hamma narsa «avans» bo'lib chiqardi.
      this.prisma.ledgerEntry.groupBy({
        by: ['source', 'factoryBucket'],
        where: {
          account: LedgerAccount.FACTORY,
          factoryId: factory.id,
          source: { in: [LedgerSource.ADVANCE_DRAW, LedgerSource.PAYMENT] },
          factoryBucket: { in: ADVANCE_BUCKETS },
          date: { gte: w.gte, lt: w.lt },
        },
        _sum: { amount: true },
      }),
      this.ledger.factoryBuckets(factory.id),
      this.prisma.ledgerEntry.aggregate({
        where: {
          account: LedgerAccount.FACTORY,
          factoryId: factory.id,
          source: LedgerSource.OFFBOOK_ADJUSTMENT,
        },
        _sum: { amount: true },
      }),
      this.prisma.ledgerEntry.aggregate({
        where: {
          account: LedgerAccount.FACTORY,
          factoryId: factory.id,
          source: LedgerSource.OFFBOOK_ADJUSTMENT,
          date: { lt: w.lt },
        },
        _sum: { amount: true },
      }),
      this.debts.factoryOrderDebtBoard({ factoryId: factory.id, date: { gte: w.gte, lt: w.lt } }),
      this.pallets.factoryPalletStatsPeriod(factory.id, w),
      this.pallets.factoryPalletStatsOne(factory.id),
      this.prisma.bonusTransaction.aggregate({
        where: {
          factoryId: factory.id,
          type: { in: [BonusTransactionType.ACCRUAL, BonusTransactionType.ADJUSTMENT] },
          reversedBy: null,
          // `BonusTransaction.at` bo'yicha KESILMAYDI — u @default(now()) devor soati va
          // import qilingan butun tarix import kuniga yig'ilib qolardi. Davr buyurtmaning
          // O'Z sanasidan olinadi.
          order: scope,
        },
        // `baseM3`/`baseAmount` ATAYLAB yig'ilmaydi. ADJUSTMENT qatori `amount` ni DELTA
        // qilib yozadi, lekin `baseAmount` ga buyurtmaning TO'LIQ qayta hisoblangan bazasini
        // qo'yadi (payments.service.ts, adjustBonusForOrder). Ya'ni tannarx har safar
        // qotirilganda o'sha buyurtmaning bazasi yig'indiga YANA BIR MARTA qo'shilardi va
        // «bonus qaysi summadan hisoblangan» degan raqam ikki-uch barobar shishib chiqardi.
        // To'g'ri bazani chiqarish uchun har buyurtmaning OXIRGI holatini olish kerak —
        // bu hisobot uchun kerak bo'lmagan murakkablik, shuning uchun maydonning o'zi yo'q.
        _sum: { amount: true },
      }),
      this.bonus.walletBalance(factory.id),
      // Dastur davr OXIRIDAGI holat bo'yicha o'qiladi, lekin hech qachon KELAJAKDAN emas:
      // `to` berilmaganda `w.lt` bir yil oldinda turadi va hali kuchga kirmagan narx
      // dasturi «amaldagi» bo'lib ko'rinardi.
      this.bonus.programInForce(
        this.prisma,
        factory.id,
        new Date(Math.min(w.lt.getTime() - 1, Date.now())),
      ),
    ]);

    // «Davr oxiriga» — foydalanuvchi yuqori chegara bergandagina alohida hisoblanadi.
    // Bermasa u aynan bugungi holat bo'ladi, va o'sha bitta o'qishni takrorlash shart emas.
    const asOfBuckets = w.bounded
      ? await this.ledger.factoryBucketsAsOf(factory.id, w.lt)
      : currentBuckets;

    const [liveOrderCount, cancelledCount] = orderCounts;

    // ── mahsulot × narx ──
    const products = this.foldProducts(byProductPrice);
    const priceBreakdown = byPrice
      .map((r) => this.priceBucket(r))
      .sort((a, b) => Number(b.cubeM3) - Number(a.cubeM3));

    const totals = byProductPrice.reduce(
      (acc, r) => ({
        cube: acc.cube.plus(r.cubeM3),
        planned: acc.planned.plus(r.plannedM3),
        cost: acc.cost.plus(r.costTotal),
        anchor: acc.anchor.plus(r.anchorTotal),
        blended: acc.blended + r.blended,
      }),
      { cube: ZERO, planned: ZERO, cost: ZERO, anchor: ZERO, blended: 0 },
    );
    const zeroPricedCube = byProductPrice
      .filter((r) => D(r.pricePerM3).isZero())
      .reduce<Prisma.Decimal>((a, r) => a.plus(r.cubeM3), ZERO);

    const orderCostTotal = D(orderCostAgg._sum.costTotal ?? 0);

    // ── to'lov usuli kesimi ──
    const byMethod = methodRows
      .map((g) => ({
        method: g.method,
        kind: g.kind,
        family: methodFamily(g.method),
        amount: m(D(g._sum.amount ?? 0)),
        count: g._count._all,
      }))
      .sort((a, b) => Number(b.amount) - Number(a.amount));

    // ── narxnoma kanali kesimi ──
    const allocOf = (kind: PriceKind | null) =>
      allocRows.filter((r) => r.priceKind === kind).reduce<Prisma.Decimal>((a, r) => a.plus(r._sum.amount ?? 0), ZERO);
    const settleCash = allocOf(PriceKind.FACTORY_CASH);
    const settleBank = allocOf(PriceKind.FACTORY_BANK);
    const settleUnknown = allocOf(null).plus(allocOf(PriceKind.DEALER_SALE));

    const ledgerSum = (source: LedgerSource, bucket: FactoryBucket) =>
      advanceRows
        .filter((r) => r.source === source && r.factoryBucket === bucket)
        .reduce<Prisma.Decimal>((a, r) => a.plus(r._sum.amount ?? 0), ZERO);
    // ADVANCE_DRAW cho'ntakdan MANFIY yechadi — ekranda musbat «yechilgan summa» kerak.
    // Storno o'sha cho'ntakka musbat qaytadi va shu yig'indi ichida o'zi nolga yopadi.
    const drawCash = ledgerSum(LedgerSource.ADVANCE_DRAW, FactoryBucket.ADVANCE_CASH).negated();
    const drawBank = ledgerSum(LedgerSource.ADVANCE_DRAW, FactoryBucket.ADVANCE_BANK).negated();
    const advInCash = ledgerSum(LedgerSource.PAYMENT, FactoryBucket.ADVANCE_CASH);
    const advInBank = ledgerSum(LedgerSource.PAYMENT, FactoryBucket.ADVANCE_BANK);

    return {
      factory: { id: factory.id, name: factory.name, active: factory.active, note: factory.note },
      period: this.periodWire(q, w),

      purchase: {
        orders: liveOrderCount,
        cancelledOrders: cancelledCount,
        cubeM3: vol(totals.cube),
        plannedCubeM3: vol(totals.planned),
        costTotal: m(totals.cost),
        avgPricePerM3: avgPrice(round2(totals.cost), round3(totals.cube)),
        palletsReceived: palletPeriod.received,
        palletsReturned: palletPeriod.returned,
        openDebt: m(debtBoard.total),
        openOrders: debtBoard.count,
        openByIntent: {
          cash: m(debtBoard.byIntent.CASH),
          bank: m(debtBoard.byIntent.BANK),
          unknown: m(debtBoard.byIntent.UNKNOWN),
        },
      },

      products,
      priceBreakdown,

      payments: this.wirePayments(paymentTotals, byMethod),

      settlement: {
        byPriceKind: {
          cash: m(settleCash),
          bank: m(settleBank),
          unknown: m(settleUnknown),
          total: m(settleCash.plus(settleBank).plus(settleUnknown)),
        },
        allocationCount: allocRows.reduce((a, r) => a + r._count._all, 0),
        drawnFromAdvance: { cash: m(drawCash), bank: m(drawBank), total: m(drawCash.plus(drawBank)) },
        advanceIn: { cash: m(advInCash), bank: m(advInBank), total: m(advInCash.plus(advInBank)) },
      },

      balances: {
        asOfPeriodEnd: wireBuckets(asOfBuckets),
        current: wireBuckets(currentBuckets),
        offBook: {
          asOfPeriodEnd: m(D(offBookAsOf._sum.amount ?? 0)),
          current: m(D(offBookAll._sum.amount ?? 0)),
        },
      },

      bonus: {
        accruedInPeriod: m(D(bonusAgg._sum.amount ?? 0)),
        offsetInPeriod: m(paymentTotals.bonusOffset),
        walletCurrent: m(walletCurrent),
        program: program
          ? {
              kind: program.kind,
              ratePerM3: program.ratePerM3 == null ? null : m(program.ratePerM3),
              percent: program.percent == null ? null : D(program.percent).toFixed(2),
              effectiveFrom: program.effectiveFrom.toISOString(),
            }
          : null,
      },

      pallets: {
        balance: palletAll.balance,
        receivedAllTime: palletAll.received,
        returnedAllTime: palletAll.returned,
      },

      checks: {
        orderCostTotal: m(orderCostTotal),
        costTotalDrift: m(orderCostTotal.minus(round2(totals.cost))),
        anchorCostTotal: m(totals.anchor),
        zeroPricedCubeM3: vol(zeroPricedCube),
        blendedItems: totals.blended,
      },
    };
  }

  private wirePayments(t: FactoryPaymentTotals, byMethod: FactoryReport['payments']['byMethod']) {
    return {
      paid: m(t.paid),
      paidCash: m(t.paidCash),
      paidBank: m(t.paidBank),
      refunded: m(t.refunded),
      netPaid: m(t.netPaid),
      bonusOffset: m(t.bonusOffset),
      paymentCount: t.paymentCount,
      firstPaymentAt: iso(t.firstPaymentAt),
      lastPaymentAt: iso(t.lastPaymentAt),
      byMethod,
    };
  }

  // ─────────────────────────── kesimlar (xom SQL) ───────────────────────────

  /**
   * Mahsulot × narx kesimi.
   *
   * HAJM = `COALESCE(actualQuantityM3, quantityM3)` — zavoddan chiqqandagi HAQIQIY yuk.
   * Prisma `aggregate` ikki ustun orasida COALESCE qila olmaydi, shuning uchun xom SQL.
   * Xom `SUM(quantityM3)` yozish eng oson yo'l edi va u REJA hajmini beradi — o'sha raqam
   * buyurtmalar ro'yxatining «Hajmi» yakuni bilan mos kelmasdi.
   *
   * NARX guruhlash kaliti — `costPricePerM3`, ya'ni buyurtmaning O'Z LANGARI.
   * `finalCostPricePerM3` bilan guruhlanmaydi: u `cost / qty` ARALASH narx bo'lib, qisman
   * naqd / qisman o'tkazma yopilgan buyurtmada 612 500.000000 kabi hech qaysi narxnomada
   * yo'q raqam beradi — egasi «500 000 narxda 100 kub» so'raganida guruhlar sochilib
   * ketardi. Narx kitobi ham qayta o'qilmaydi (u naqd olingan molni o'tkazma narxida
   * yozib qo'yardi — factory-coverage.ts dagi ANCHOR izohi).
   */
  private productPriceRows(factoryId: string, w: Window) {
    return this.prisma.$queryRaw<ProductPriceRow[]>(Prisma.sql`
      SELECT
        oi."productId"                                                     AS "productId",
        p."name"                                                           AS "productName",
        p."size"                                                           AS "size",
        oi."costPricePerM3"                                                AS "pricePerM3",
        COALESCE(SUM(COALESCE(oi."actualQuantityM3", oi."quantityM3")), 0)  AS "cubeM3",
        COALESCE(SUM(oi."quantityM3"), 0)                                  AS "plannedM3",
        COALESCE(SUM(oi."costTotal"), 0)                                   AS "costTotal",
        COALESCE(SUM(ROUND(COALESCE(oi."actualQuantityM3", oi."quantityM3") * oi."costPricePerM3", 2)), 0) AS "anchorTotal",
        -- Poddon ham hajm kabi HAQIQIY sonda: buyurtmalar ro'yxati aynan shu ifodani
        -- ishlatadi, va ikkalasi bir sahifada turgani uchun asoslari ham bir xil bo'lishi
        -- shart (aks holda mahsulot kesimi «25», ro'yxat esa «23» deb turardi).
        COALESCE(SUM(COALESCE(oi."actualPalletCount", oi."palletCount")), 0)::int AS "palletCount",
        COUNT(*)::int                                                      AS "items",
        COUNT(DISTINCT oi."orderId")::int                                  AS "orders",
        COUNT(*) FILTER (
          WHERE oi."finalCostPricePerM3" IS NOT NULL
            AND oi."finalCostPricePerM3" <> oi."costPricePerM3"
        )::int                                                             AS "blended"
      FROM "OrderItem" oi
      JOIN "Order"   o ON o."id" = oi."orderId"
      JOIN "Product" p ON p."id" = oi."productId"
      WHERE o."factoryId" = ${factoryId}
        AND o."date" >= ${w.gte}
        AND o."date" <  ${w.lt}
        AND ${NOT_CANCELLED_SQL}
      GROUP BY oi."productId", p."name", p."size", oi."costPricePerM3"
      ORDER BY "cubeM3" DESC`);
  }

  /**
   * Faqat narx bo'yicha yalpi kesim.
   *
   * Yuqoridagi qatorlardan JS da yig'ilmaydi: bitta buyurtma bir necha mahsulotni bir xil
   * narxda olishi mumkin va `COUNT(DISTINCT orderId)` lar qo'shilganda o'sha buyurtma ikki
   * marta sanalardi. Ikkinchi so'rov arzon, noto'g'ri son esa emas.
   */
  private priceRows(factoryId: string, w: Window) {
    return this.prisma.$queryRaw<PriceOnlyRow[]>(Prisma.sql`
      SELECT
        oi."costPricePerM3"                                                AS "pricePerM3",
        COALESCE(SUM(COALESCE(oi."actualQuantityM3", oi."quantityM3")), 0)  AS "cubeM3",
        COALESCE(SUM(oi."costTotal"), 0)                                   AS "costTotal",
        COALESCE(SUM(ROUND(COALESCE(oi."actualQuantityM3", oi."quantityM3") * oi."costPricePerM3", 2)), 0) AS "anchorTotal",
        COUNT(*)::int                                                      AS "items",
        COUNT(DISTINCT oi."orderId")::int                                  AS "orders",
        COUNT(*) FILTER (
          WHERE oi."finalCostPricePerM3" IS NOT NULL
            AND oi."finalCostPricePerM3" <> oi."costPricePerM3"
        )::int                                                             AS "blended"
      FROM "OrderItem" oi
      JOIN "Order" o ON o."id" = oi."orderId"
      WHERE o."factoryId" = ${factoryId}
        AND o."date" >= ${w.gte}
        AND o."date" <  ${w.lt}
        AND ${NOT_CANCELLED_SQL}
      GROUP BY oi."costPricePerM3"
      ORDER BY "cubeM3" DESC`);
  }

  private priceBucket(r: PriceOnlyRow | ProductPriceRow): PriceBucket {
    return {
      pricePerM3: price(r.pricePerM3),
      // Narx kitobida zavod narxi bo'lmasa buyurtma NOL narx bilan yaratiladi (sotuvni
      // bloklamaslik uchun, ataylab). Shu chelak YASHIRILMAYDI — aks holda jami tannarx
      // jimgina kam ko'rinardi va hech kim sababini bilmasdi.
      priceMissing: D(r.pricePerM3).isZero(),
      cubeM3: vol(r.cubeM3),
      costTotal: m(r.costTotal),
      anchorTotal: m(r.anchorTotal),
      items: r.items,
      orders: r.orders,
    };
  }

  private foldProducts(rows: ProductPriceRow[]): FactoryReportProduct[] {
    const byProduct = new Map<string, ProductPriceRow[]>();
    for (const r of rows) {
      const list = byProduct.get(r.productId) ?? [];
      list.push(r);
      byProduct.set(r.productId, list);
    }
    return [...byProduct.values()]
      .map((list) => {
        const head = list[0];
        const cube = list.reduce<Prisma.Decimal>((a, r) => a.plus(r.cubeM3), ZERO);
        const planned = list.reduce<Prisma.Decimal>((a, r) => a.plus(r.plannedM3), ZERO);
        const cost = list.reduce<Prisma.Decimal>((a, r) => a.plus(r.costTotal), ZERO);
        return {
          productId: head.productId,
          productName: head.productName,
          size: head.size,
          cubeM3: vol(cube),
          plannedCubeM3: vol(planned),
          costTotal: m(cost),
          avgPricePerM3: avgPrice(round2(cost), round3(cube)),
          palletCount: list.reduce((a, r) => a + r.palletCount, 0),
          // Bitta mahsulot bitta buyurtmada bir necha narxda kelmaydi (bitta pozitsiya —
          // bitta narx), shuning uchun bu yerda distinct sonlarni qo'shish xavfsiz.
          orders: list.reduce((a, r) => a + r.orders, 0),
          items: list.reduce((a, r) => a + r.items, 0),
          prices: list
            .map((r) => this.priceBucket(r))
            .sort((a, b) => Number(b.cubeM3) - Number(a.cubeM3)),
        };
      })
      .sort((a, b) => Number(b.cubeM3) - Number(a.cubeM3));
  }

  // ─────────────────────── 2) davrdagi buyurtmalar ro'yxati ───────────────────────

  /**
   * Hisobot ostidagi ro'yxat.
   *
   * `OrdersService.findAll` ATAYLAB qayta ishlatilmaydi: uning sana oynasi `lte: new
   * Date(dateTo)` — yalang'och UTC yarim tuni va INKLYUZIV, ya'ni «gacha» kuni deyarli
   * butunlay tushib qoladi va Toshkent chegarasini bilmaydi. Ro'yxat tepadagi figuralar
   * bilan AYNAN bir xil oynani ishlatishi shart, aks holda ikkalasi bir sahifada turib
   * bir-birini yolg'onga chiqaradi.
   */
  async factoryReportOrders(
    q: FactoryReportOrdersQueryDto,
    /**
     * `true` ⇒ sahifalashsiz, davrning HAMMA buyurtmasi bitta o'qishda (Excel eksporti).
     *
     * Eksport avval sahifama-sahifa aylanardi, va bu jimgina buzuq edi: o'qishlar orasida
     * yangi buyurtma yaratilsa (tartib `date desc`) u ro'yxat TEPASIGA tushib, keyingi
     * sahifaning `skip` i oldingi sahifaning oxirgi qatorini QAYTA qaytarardi — Excel
     * yakunlari o'sha buyurtmani ikki marta sanardi. Bitta o'qish bu poygani butunlay
     * yo'q qiladi.
     */
    all = false,
  ): Promise<FactoryReportOrdersResponse> {
    const w = this.resolveWindow(q);
    const factory = await this.prisma.factory.findUnique({
      where: { id: q.factoryId },
      select: { id: true },
    });
    if (!factory) throw new NotFoundException('Zavod topilmadi');

    const page = all ? 1 : Math.max(1, q.page ?? 1);
    const pageSize = all ? 0 : Math.min(200, Math.max(1, q.pageSize ?? 20));
    const scope = this.orderScope(factory.id, w);

    const [rows, total, cancelledOrders, debtBoard, paidRows] = await Promise.all([
      this.prisma.order.findMany({
        where: scope,
        orderBy: [{ date: 'desc' }, { orderNo: 'desc' }],
        ...(all ? {} : { skip: (page - 1) * pageSize, take: pageSize }),
        select: {
          id: true,
          orderNo: true,
          date: true,
          status: true,
          costStatus: true,
          factoryPayIntent: true,
          costTotal: true,
          client: { select: { id: true, name: true } },
          items: {
            select: {
              quantityM3: true,
              actualQuantityM3: true,
              palletCount: true,
              actualPalletCount: true,
              product: { select: { id: true, name: true, size: true } },
            },
          },
        },
      }),
      this.prisma.order.count({ where: scope }),
      this.prisma.order.count({
        where: { factoryId: factory.id, date: { gte: w.gte, lt: w.lt }, status: 'CANCELLED' },
      }),
      this.debts.factoryOrderDebtBoard({ factoryId: factory.id, date: { gte: w.gte, lt: w.lt } }),
      // `orderId: { in: [...] }` EMAS — o'sha predikat orqali. Id ro'yxati cheklanmagan
      // o'sadi va bir kun drayverning bind-parametr shipiga urilardi.
      this.prisma.paymentAllocation.groupBy({
        by: ['orderId'],
        where: {
          voidedAt: null,
          payment: { voidedAt: null, kind: PaymentKind.FACTORY_OUT },
          order: scope,
        },
        _sum: { amount: true },
      }),
    ]);

    const paidMap = new Map(paidRows.map((r) => [r.orderId, D(r._sum.amount ?? 0)]));
    const openMap = new Map(debtBoard.rows.map((r) => [r.id, r.open]));

    const items: FactoryReportOrderRow[] = rows.map((o) => {
      const cube = o.items.reduce<Prisma.Decimal>(
        (a, it) => a.plus(D(it.actualQuantityM3 ?? it.quantityM3)),
        ZERO,
      );
      const pallets = o.items.reduce((a, it) => a + (it.actualPalletCount ?? it.palletCount), 0);
      const seen = new Set<string>();
      const products: FactoryReportOrderRow['products'] = [];
      for (const it of o.items) {
        if (seen.has(it.product.id)) continue;
        seen.add(it.product.id);
        products.push({ id: it.product.id, name: it.product.name, size: it.product.size });
      }
      return {
        id: o.id,
        orderNo: o.orderNo,
        date: o.date.toISOString(),
        status: o.status,
        costStatus: o.costStatus,
        factoryPayIntent: o.factoryPayIntent,
        client: o.client,
        products,
        cubeM3: vol(cube),
        palletCount: pallets,
        costTotal: m(o.costTotal),
        factoryPaid: m(paidMap.get(o.id) ?? ZERO),
        // Doskadagi qatori bo'lmasa qarz yopilgan (yoki tannarx hali daftarga tushmagan) —
        // ikkalasi ham 0. Formula bu yerda QAYTA yozilmaydi.
        factoryOpen: m(openMap.get(o.id) ?? ZERO),
      };
    });

    // Yakunlar BUTUN filtr bo'yicha — sahifadagi qatorlardan yig'ilmaydi (sahifa
    // almashganda «jami» o'zgarib ketardi).
    const [cubeAgg, paidAgg] = await Promise.all([
      this.prisma.$queryRaw<{ cube: Prisma.Decimal; cost: Prisma.Decimal }[]>(Prisma.sql`
        SELECT
          COALESCE(SUM(COALESCE(oi."actualQuantityM3", oi."quantityM3")), 0) AS "cube",
          COALESCE(SUM(oi."costTotal"), 0)                                  AS "cost"
        FROM "OrderItem" oi
        JOIN "Order" o ON o."id" = oi."orderId"
        WHERE o."factoryId" = ${factory.id}
          AND o."date" >= ${w.gte}
          AND o."date" <  ${w.lt}
          AND ${NOT_CANCELLED_SQL}`),
      this.prisma.paymentAllocation.aggregate({
        where: {
          voidedAt: null,
          payment: { voidedAt: null, kind: PaymentKind.FACTORY_OUT },
          order: scope,
        },
        _sum: { amount: true },
      }),
    ]);

    return {
      items,
      total,
      page,
      pageSize: all ? items.length : pageSize,
      summary: {
        orders: total,
        cubeM3: vol(cubeAgg[0]?.cube ?? 0),
        costTotal: m(cubeAgg[0]?.cost ?? 0),
        factoryPaid: m(D(paidAgg._sum.amount ?? 0)),
        factoryOpen: m(debtBoard.total),
        cancelledOrders,
      },
    };
  }

  /**
   * Excel eksporti uchun — agregatlar + davrning HAMMA buyurtmasi (sahifalashsiz).
   *
   * Eksport «to'liq hisobot» deb ataladi, shuning uchun ro'yxat jimgina kesilmaydi.
   */
  async factoryReportBundle(q: FactoryReportQueryDto) {
    const [report, orders] = await Promise.all([
      this.factoryReport(q),
      this.factoryReportOrders({ ...q }, true),
    ]);
    return { report, orders };
  }
}
