import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { D, round2, ZERO } from '../common/money';
import { NOT_CANCELLED_SQL } from '../common/order-scope';
import { currentPalletPrice, factoryReturnExpenseCreditEntries } from '../common/pallet-debt';
import { parseTashkentFrom, tashkentDateStr, tashkentMonthStart } from '../common/tashkent-time';
import { SummaryQueryDto } from './dto';
import { DailyReport, DailyReportRow } from './daily-report.types';

const DAY = 86_400_000;
const OPENING = 'opening';

/** Validate calendar dates as well as their spelling (2026-02-31 must not roll into March). */
export function dailyReportWindow(q: SummaryQueryDto, now = new Date()) {
  const from = q.from ?? tashkentDateStr(tashkentMonthStart(now));
  const to = q.to ?? tashkentDateStr(now);
  const parse = (value: string) => {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? parseTashkentFrom(value) : undefined;
    if (!date || !Number.isFinite(date.getTime()) || tashkentDateStr(date) !== value) {
      throw new BadRequestException('Sana haqiqiy YYYY-MM-DD formatida bo‘lishi kerak');
    }
    return date;
  };
  const gte = parse(from), last = parse(to);
  const count = (last.getTime() - gte.getTime()) / DAY + 1;
  if (count < 1) throw new BadRequestException('Boshlanish sanasi tugash sanasidan keyin bo‘lishi mumkin emas');
  if (count > 3660) throw new BadRequestException('Bitta hisobot davri 3660 kundan oshmasligi kerak');
  return { from, to, gte, lt: new Date(last.getTime() + DAY),
    days: Array.from({ length: count }, (_, i) => tashkentDateStr(new Date(gte.getTime() + i * DAY))) };
}

type MoneyDay = { day: string; net: Prisma.Decimal; goods: Prisma.Decimal; paid: Prisma.Decimal };
type PalletDay = { day: string; balance: Prisma.Decimal; received: Prisma.Decimal; returned: Prisma.Decimal; defective: Prisma.Decimal };
type PriceDay = { day: string; factoryCost: Prisma.Decimal; factoryList: Prisma.Decimal;
  sale: Prisma.Decimal; provisional: number; pricePending: number };

@Injectable()
export class DailyReportService {
  constructor(private readonly prisma: PrismaService) {}

  async report(query: SummaryQueryDto): Promise<DailyReport> {
    const window = dailyReportWindow(query);
    // Prisma raw Date parameters are timestamptz; our business columns are UTC
    // timestamp-without-zone. Make the comparison independent of the DB session
    // timezone (production/local PostgreSQL may run in Asia/Tashkent).
    const lower = Prisma.sql`(${window.gte}::timestamptz AT TIME ZONE 'UTC')`;
    const upper = Prisma.sql`(${window.lt}::timestamptz AT TIME ZONE 'UTC')`;
    // One snapshot for money, pallets, order prices and setting; a concurrent payment
    // or cancellation cannot leave one half of this financial table a revision behind.
    return this.prisma.$transaction(async (db) => {
      const price = await currentPalletPrice(db);
      const money = await db.$queryRaw<MoneyDay[]>(Prisma.sql`
        WITH entries AS (
          SELECT COALESCE(src.date, e.date) AS date, e.amount,
            COALESCE(src.source, e.source)::text AS source
          FROM "LedgerEntry" e LEFT JOIN "LedgerEntry" src ON src.id = e."reversalOfId"
          WHERE e.account = 'FACTORY' AND e.source <> 'OFFBOOK_ADJUSTMENT'
            AND COALESCE(src.source, e.source) <> 'OFFBOOK_ADJUSTMENT'
            AND COALESCE(src.date, e.date) < ${upper}
        )
        SELECT CASE WHEN date < ${lower} THEN ${OPENING}
          ELSE to_char(date + interval '5 hours', 'YYYY-MM-DD') END AS day,
          SUM(amount) AS net,
          -SUM(CASE WHEN source IN ('ORDER_COST', 'COST_ADJUSTMENT') THEN amount ELSE 0 END) AS goods,
          SUM(CASE WHEN source IN ('PAYMENT', 'PAYMENT_VOID') THEN amount ELSE 0 END) AS paid
        FROM entries GROUP BY 1`);

      // Same raw balance signs and reversal buckets as pallet-stats.ts. A storno
      // belongs to its original business day, not the wall-clock cancellation date.
      const pallets = await db.$queryRaw<PalletDay[]>(Prisma.sql`
        WITH entries AS (
          SELECT COALESCE(src.date, p.date) AS date, p.type, p.qty,
            CASE WHEN p.type = 'REVERSAL' THEN COALESCE(src.type::text, 'REVERSAL') ELSE p.type::text END AS bucket,
            CASE WHEN p.type = 'REVERSAL' AND src.type IN ('RETURNED_TO_FACTORY', 'DEFECTIVE_FROM_FACTORY') THEN -p.qty ELSE p.qty END AS "bucketQty"
          FROM "PalletTransaction" p LEFT JOIN "PalletTransaction" src ON src.id = p."reversalOfId"
          WHERE p."factoryId" IS NOT NULL AND COALESCE(src.date, p.date) < ${upper}
        )
        SELECT CASE WHEN date < ${lower} THEN ${OPENING}
          ELSE to_char(date + interval '5 hours', 'YYYY-MM-DD') END AS day,
          SUM(CASE WHEN type IN ('RETURNED_TO_FACTORY', 'DEFECTIVE_FROM_FACTORY') THEN -qty
            WHEN type IN ('RECEIVED_FROM_FACTORY', 'ADJUSTMENT', 'REVERSAL') THEN qty ELSE 0 END)::numeric AS balance,
          SUM(CASE WHEN bucket = 'RECEIVED_FROM_FACTORY' THEN "bucketQty" ELSE 0 END)::numeric AS received,
          SUM(CASE WHEN bucket = 'RETURNED_TO_FACTORY' THEN "bucketQty" ELSE 0 END)::numeric AS returned,
          SUM(CASE WHEN bucket = 'DEFECTIVE_FROM_FACTORY' THEN "bucketQty" ELSE 0 END)::numeric AS defective
        FROM entries GROUP BY 1`);

      // The photo's «prays» is the FACTORY's original book cost, not the dealer's
      // nullable listPricePerM3. Sum rounded item prices before grouping split loads.
      // Do not apply the photo's unrecorded 5% discount to live debts or costs.
      const prices = await db.$queryRaw<PriceDay[]>(Prisma.sql`
        WITH orders AS (
          SELECT o.*, COALESCE(i."factoryList", 0) AS "factoryList",
            COALESCE(i."pricePending", false) AS "pricePending"
          FROM "Order" o
          LEFT JOIN LATERAL (
            SELECT SUM(ROUND(COALESCE(i."actualQuantityM3", i."quantityM3") * i."costPricePerM3", 2)) AS "factoryList",
              BOOL_OR(i."pricePending") AS "pricePending"
            FROM "OrderItem" i WHERE i."orderId" = o.id
          ) i ON true
          WHERE ${NOT_CANCELLED_SQL} AND o.date >= ${lower} AND o.date < ${upper}
        )
        SELECT to_char(date + interval '5 hours', 'YYYY-MM-DD') AS day,
          SUM("costTotal") AS "factoryCost", SUM("factoryList") AS "factoryList",
          SUM(GREATEST(0, "saleTotal" - CASE WHEN "transportMode" = 'CLIENT_PAYS_DRIVER'
            THEN LEAST(GREATEST("transportCost", 0), GREATEST("saleTotal", 0)) ELSE 0 END)) AS sale,
          COUNT(*) FILTER (WHERE "costStatus" <> 'FINAL')::int AS provisional,
          COUNT(*) FILTER (WHERE "pricePending")::int AS "pricePending"
        FROM orders GROUP BY 1`);
      const credits = await factoryReturnExpenseCreditEntries(db, undefined, window.lt);
      const creditMap = new Map<string, Prisma.Decimal>();
      for (const credit of credits) {
        const day = credit.date < window.gte ? OPENING : tashkentDateStr(credit.date);
        creditMap.set(day, (creditMap.get(day) ?? ZERO).plus(credit.amount));
      }
      const moneyMap = new Map(money.map((r) => [r.day, r]));
      const palletMap = new Map(pallets.map((r) => [r.day, r]));
      const priceMap = new Map(prices.map((r) => [r.day, r]));
      let balance = D(moneyMap.get(OPENING)?.net ?? 0).plus(creditMap.get(OPENING) ?? 0);
      let palletBalance = D(palletMap.get(OPENING)?.balance ?? 0).negated();
      const cells: Record<string, Prisma.Decimal[]> = {};
      const push = (key: string, value: Prisma.Decimal.Value) => (cells[key] ??= []).push(D(value));
      for (const day of window.days) {
        const m = moneyMap.get(day), p = palletMap.get(day), v = priceMap.get(day);
        const goods = D(m?.goods ?? 0), paid = D(m?.paid ?? 0), net = D(m?.net ?? 0);
        const credit = creditMap.get(day) ?? ZERO;
        const adjustments = net.plus(goods).minus(paid);
        const received = D(p?.received ?? 0), returned = D(p?.returned ?? 0), defective = D(p?.defective ?? 0);
        const palletDelta = D(p?.balance ?? 0).negated();
        push('moneyOpening', balance);
        push('goodsReceived', goods);
        push('factoryPayments', paid);
        push('returnExpenseCredit', credit);
        push('moneyAdjustments', adjustments);
        balance = balance.plus(net).plus(credit);
        push('moneyClosing', balance);
        push('palletOpening', palletBalance);
        push('palletReceived', received);
        push('palletReturned', returned);
        push('palletDefective', defective);
        push('palletAdjustments', palletDelta.plus(received).minus(returned).minus(defective));
        palletBalance = palletBalance.plus(palletDelta);
        push('palletClosing', palletBalance);
        push('palletValue', round2(palletBalance.mul(price)));
        push('totalDebt', round2(balance.plus(palletBalance.mul(price))));
        const cost = D(v?.factoryCost ?? 0), list = D(v?.factoryList ?? 0), sale = D(v?.sale ?? 0);
        push('factoryCost', cost);
        push('factoryList', list);
        push('factoryMargin', list.minus(cost));
        push('salesList', list);
        push('saleAmount', sale);
        push('salesMargin', sale.minus(list));
        push('totalMargin', sale.minus(cost));
      }
      const rows: DailyReportRow[] = [];
      const add = (key: string, label: string, section: DailyReportRow['section'], tone: DailyReportRow['tone'],
        totalMode: DailyReportRow['totalMode'] = 'sum', unit: DailyReportRow['unit'] = 'money', optional = false) => {
        const values = cells[key];
        if (optional && values.every((v) => v.isZero())) return;
        const total = totalMode === 'opening' ? values[0] : totalMode === 'closing' ? values[values.length - 1]
          : values.reduce((a, v) => a.plus(v), ZERO);
        const format = (n: Prisma.Decimal) => n.toFixed(unit === 'quantity' ? 0 : 2);
        rows.push({ key, label, section, tone, unit, totalMode, values: values.map(format), total: format(total) });
      };
      add('moneyOpening', 'Kun boshiga qoldiq', 'settlement', 'green', 'opening');
      add('goodsReceived', 'Olingan tovar', 'settlement', 'green');
      add('factoryPayments', 'Qilingan to‘lov (sof)', 'settlement', 'green');
      add('returnExpenseCredit', 'Poddon qaytarish xarajati krediti', 'settlement', 'green', 'sum', 'money', true);
      add('moneyAdjustments', 'Bonus va boshqa tuzatishlar', 'settlement', 'green', 'sum', 'money', true);
      add('moneyClosing', 'Kun oxiriga qoldiq', 'settlement', 'peach', 'closing');
      add('palletOpening', 'Kun boshiga qoldiq — poddon', 'pallets', 'blue', 'opening', 'quantity');
      add('palletReceived', 'Olingan poddon', 'pallets', 'blue', 'sum', 'quantity');
      add('palletReturned', 'Qaytarilgan poddon', 'pallets', 'blue', 'sum', 'quantity');
      add('palletDefective', 'Zavoddan yaroqsiz — qarzdan chiqarilgan', 'pallets', 'blue', 'sum', 'quantity', true);
      add('palletAdjustments', 'Poddon tuzatishlari', 'pallets', 'blue', 'sum', 'quantity', true);
      add('palletClosing', 'Kun oxiriga qoldiq — poddon (dona)', 'pallets', 'peach', 'closing', 'quantity');
      add('palletValue', 'Kun oxiriga qoldiq — poddon (so‘m)', 'pallets', 'peach', 'closing');
      add('totalDebt', 'Jami qarzdorlik', 'pallets', 'yellow', 'closing');
      add('factoryCost', 'Tovar — zavod narxi', 'factoryMargin', 'plain');
      add('factoryList', 'Tovar — zavod narxnomasi', 'factoryMargin', 'plain');
      add('factoryMargin', 'Zavoddan olishdagi narx farqi', 'factoryMargin', 'peach');
      add('salesList', 'Tovar — zavod narxnomasi', 'salesMargin', 'plain');
      add('saleAmount', 'Tovar — sotuv summasi', 'salesMargin', 'plain');
      add('salesMargin', 'Agentlar sotishidagi narx farqi', 'salesMargin', 'peach');
      add('totalMargin', 'Jami narx farqi', 'result', 'total');
      const provisionalOrderCount = prices.reduce((sum, p) => sum + p.provisional, 0);
      const pendingCount = prices.reduce((sum, p) => sum + p.pricePending, 0);
      const warnings: string[] = [];
      if (provisionalOrderCount) warnings.push(`${provisionalOrderCount} ta buyurtmaning tannarxi hali yakuniy emas. Narx farqi keyingi hisob-kitobda o‘zgarishi mumkin.`);
      if (pendingCount) warnings.push(`${pendingCount} ta buyurtmada sotuv narxi kelishilmagan. Sotuv summasi va narx farqi hozircha to‘liq emas.`);
      return { from: window.from, to: window.to, generatedAt: new Date().toISOString(),
        palletUnitPrice: price.toFixed(2), days: window.days, rows, warnings, provisionalOrderCount,
        notes: [
          'Barcha zavodlar bo‘yicha umumiy hisob. Manfiy qoldiq — zavodga qarzimiz, musbat qoldiq — avansimiz. Kunlar Toshkent vaqti bilan hisoblanadi.',
          'Jami: harakatlar faqat tanlangan davr uchun yig‘iladi. Boshlang‘ich qoldiq birinchi kun boshidan, yakuniy qoldiq oxirgi kun oxiridan olinadi; kunlik qoldiqlar qo‘shilmaydi.',
          'Pul qoldig‘i = boshlang‘ich qoldiq − olingan tovar + sof to‘lov + qaytarish xarajati krediti + boshqa tuzatishlar. To‘lovdan zavod qaytargan pul ayriladi.',
          'Poddon qoldig‘i = boshlang‘ich qoldiq − olingan + qaytarilgan + zavoddan yaroqsiz deb chiqarilgan + tuzatish. Yaroqsiz poddonni chiqarish qaytarish yoki pul to‘lovi emas. Poddonning barcha kunlardagi summasi sozlamadagi joriy narxda baholangan.',
          'Zavod narxnomasi: har bir mahsulotning saqlangan boshlang‘ich tannarxi × haqiqiy hajmi (haqiqiy hajm bo‘lmasa reja). Zavod narxi: buyurtmada saqlangan joriy tannarx. Avtomatik 5% chegirma qo‘llanmaydi.',
          'Narxlar bloki faol buyurtmalarning buyurtma sanasi bo‘yicha hisoblanadi. Mijoz bevosita shofyorga beradigan pul sotuvdan bir marta ayriladi. Jami narx farqi = sotuv − zavod narxi; bu sof foyda emas — diller transporti, agent KPI va boshqa xarajatlar bu yerda ayrilmagan.',
          'Bekor qilish va storno asl biznes sanasiga qaytariladi. Hisobot joriy tuzatilgan ma’lumotlarni ko‘rsatadi. Balansni nazorat qilishdagi qo‘lda kiritilgan off-book tuzatishlar umumiy dashboard qoidasiga muvofiq kiritilmaydi.',
        ] };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30_000 });
  }
}
