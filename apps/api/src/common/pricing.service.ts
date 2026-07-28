import { BadRequestException, Injectable } from '@nestjs/common';
import { PriceKind, Prisma } from '@prisma/client';
import { D } from './money';

/**
 * Every price row is bucketed to UTC MIDNIGHT of its effective day.
 *
 * Orders carry a business DATE (`new Date('2026-07-20')` ⇒ UTC midnight), so a price row
 * stamped with the wall-clock time would fail `effectiveFrom <= orderDate` for an order
 * dated the same day — the price a user just entered would appear to do nothing. The
 * importer and the backfill script bucket the same way, so all three agree.
 */
export const startOfDayUtc = (d: Date): Date =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/**
 * naqd ⇄ bank — the fallback partner when the intended factory book is empty. Shared by
 * order creation and cost finalization so the two agree on what a half-priced product costs.
 */
export const otherFactoryKind = (k: PriceKind): PriceKind =>
  k === PriceKind.FACTORY_CASH ? PriceKind.FACTORY_BANK : PriceKind.FACTORY_CASH;

/** Uzbek labels for the three price-book kinds — enum names never reach the user. */
const PRICE_KIND_LABEL: Record<PriceKind, string> = {
  [PriceKind.DEALER_SALE]: 'sotuv',
  [PriceKind.FACTORY_CASH]: 'zavod (naqd)',
  [PriceKind.FACTORY_BANK]: 'zavod (bank)',
};

/** Egasi ko'radigan sana ko'rinishi — hamma joyda DD.MM.YYYY (ISO emas). */
export const dayLabel = (d: Date): string => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
};

/**
 * «Narx yo'q» refusalining YAGONA matni (2026-07-28).
 *
 * Ilgari har bir darvoza o'z matnini yozardi va ularning hech biri SANANI aytmasdi:
 * «…zavod naqd narxi belgilanmagan — «Mahsulotlar» bo'limida narxni kiriting». Egasi
 * narxni kiritardi (u BUGUNGI sana bilan yozilardi), o'sha eski buyurtmaga qaytardi va
 * xuddi shu xabarni yana ko'rardi — «qo'shsam ham kiritilmagan deyapti». Narx kitobi
 * sanaga bog'liqligi xabarda umuman ko'rinmasdi.
 *
 * Shuning uchun matn endi doim uchta faktni beradi: QAYSI mahsulot, QAYSI sanada
 * yetishmayapti, va narx umuman yo'qmi yoki KEYINROQDAN kuchga kiradimi.
 */
export function missingPriceText(p: {
  who: string;
  kind: PriceKind;
  at: Date;
  /** shu tur bo'yicha eng erta narx sanasi (bo'lsa) — «faqat shu kundan kuchda» */
  firstFrom: Date | null;
}): string {
  const label = PRICE_KIND_LABEL[p.kind];
  if (p.firstFrom) {
    return (
      `${p.who} uchun ${label} narxi ${dayLabel(p.at)} sanasida kuchda emas — ` +
      `narx faqat ${dayLabel(p.firstFrom)} dan boshlab kiritilgan. «Mahsulotlar» → «Narxlar» ` +
      `bo'limida shu narxni ${dayLabel(p.at)} (yoki undan oldingi) sanadan qo'shing.`
    );
  }
  return (
    `${p.who} uchun ${label} narxi kiritilmagan. «Mahsulotlar» → «Narxlar» bo'limida narx ` +
    `qo'shing va «Kuchga kirish sanasi»ni ${dayLabel(p.at)} (yoki undan oldingi) qilib belgilang — ` +
    `narx faqat o'sha kundan keyingi buyurtmalarga qo'llanadi.`
  );
}

/**
 * Price-book resolution. All prices are versioned rows; "the price in force"
 * for an order is the row with the latest effectiveFrom ≤ the ORDER's business
 * date (cost finalization also uses the order date, not the payment date —
 * the allocation only picks WHICH kind applies).
 */
@Injectable()
export class PricingService {
  /** DEALER_SALE with per-client override: ClientPrice wins over ProductPrice. */
  async resolveSalePrice(
    tx: Prisma.TransactionClient,
    productId: string,
    clientId: string | null,
    at: Date,
  ): Promise<Prisma.Decimal> {
    if (clientId) {
      const special = await tx.clientPrice.findFirst({
        where: { clientId, productId, effectiveFrom: { lte: at } },
        orderBy: { effectiveFrom: 'desc' },
      });
      if (special) return D(special.pricePerM3);
    }
    return this.resolveBookPrice(tx, productId, PriceKind.DEALER_SALE, at);
  }

  /**
   * Shu (mahsulot, tur) bo'yicha eng ERTA narx sanasi — narx bor, lekin buyurtma
   * sanasida hali kuchga kirmagan holatni ajratish uchun. Bu holat jimgina eski
   * buyurtmalarni bloklaydi va boshqa yo'l bilan ko'rinmaydi.
   */
  async firstBookDate(
    tx: Prisma.TransactionClient,
    productId: string,
    kind: PriceKind,
  ): Promise<Date | null> {
    const row = await tx.productPrice.findFirst({
      where: { productId, kind },
      orderBy: { effectiveFrom: 'asc' },
      select: { effectiveFrom: true },
    });
    return row?.effectiveFrom ?? null;
  }

  /**
   * Non-throwing book lookup — returns null when the price book has no row in force.
   * Callers that can proceed without a book price (an explicitly negotiated sale price,
   * a provisional cost) use this instead of paying for an exception.
   */
  async tryBookPrice(
    tx: Prisma.TransactionClient,
    productId: string,
    kind: PriceKind,
    at: Date,
  ): Promise<Prisma.Decimal | null> {
    const row = await tx.productPrice.findFirst({
      where: { productId, kind, effectiveFrom: { lte: at } },
      orderBy: { effectiveFrom: 'desc' },
    });
    return row ? D(row.pricePerM3) : null;
  }

  private async resolveBookPrice(
    tx: Prisma.TransactionClient,
    productId: string,
    kind: PriceKind,
    at: Date,
  ): Promise<Prisma.Decimal> {
    const price = await this.tryBookPrice(tx, productId, kind, at);
    if (!price) throw new BadRequestException(await this.missingPriceMessage(tx, productId, kind, at));
    return price;
  }

  /**
   * Actionable "no price" message: names the product and says WHERE to fix it, and
   * distinguishes «never priced» from «priced, but only from a later date» — the
   * latter silently blocks back-dated orders and is otherwise very hard to spot.
   *
   * Public: the factory-channel gates (factory-coverage, orders) refuse through the
   * non-throwing `tryBookPrice` and used to hand-write their own DATELESS text. One
   * wording, one place.
   */
  async missingPriceMessage(
    tx: Prisma.TransactionClient,
    productId: string,
    kind: PriceKind,
    at: Date,
  ): Promise<string> {
    const product = await tx.product.findUnique({ where: { id: productId }, select: { name: true } });
    return missingPriceText({
      who: product ? `«${product.name}»` : 'Mahsulot',
      kind,
      at,
      firstFrom: await this.firstBookDate(tx, productId, kind),
    });
  }
}
