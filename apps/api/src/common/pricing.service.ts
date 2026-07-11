import { BadRequestException, Injectable } from '@nestjs/common';
import { PriceKind, Prisma } from '@prisma/client';
import { D } from './money';

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

  async resolveFactoryPrice(
    tx: Prisma.TransactionClient,
    productId: string,
    kind: PriceKind,
    at: Date,
  ): Promise<Prisma.Decimal> {
    if (kind === PriceKind.DEALER_SALE) {
      throw new BadRequestException('Factory price kind expected');
    }
    return this.resolveBookPrice(tx, productId, kind, at);
  }

  private async resolveBookPrice(
    tx: Prisma.TransactionClient,
    productId: string,
    kind: PriceKind,
    at: Date,
  ): Promise<Prisma.Decimal> {
    const row = await tx.productPrice.findFirst({
      where: { productId, kind, effectiveFrom: { lte: at } },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (!row) {
      throw new BadRequestException(`Mahsulot uchun ${kind} narxi belgilanmagan`);
    }
    return D(row.pricePerM3);
  }
}
