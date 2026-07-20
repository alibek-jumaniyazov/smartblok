/**
 * Backfill the product price book from existing order history.
 *
 * Why this exists: the Excel importer used to create Products with NO ProductPrice rows,
 * which left the catalog with no price in force. Every hand-entered order then died on
 * «… narxi kiritilmagan», because PricingService resolves the book at the order's date.
 * The importer now writes the book itself, but an ALREADY-imported database still has
 * price-less products — this repairs it in place, without a re-import.
 *
 * Source of truth: OrderItem.salePricePerM3 / costPricePerM3, which the import DID write.
 * One versioned row per distinct (product, kind, day) price, exactly as the importer now
 * emits, so a later re-import is a no-op rather than a conflict.
 *
 * Idempotent: skipDuplicates against the [productId, kind, effectiveFrom] unique index.
 *
 *   npm run db:backfill-prices -w apps/api            # write
 *   npm run db:backfill-prices -w apps/api -- --dry   # report only
 */
import { PriceKind, Prisma, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const D = Prisma.Decimal;
const dryRun = process.argv.includes('--dry');

/** Pallet volume implied by a «600x300x250» size — see m3PerPalletForSize in the importer. */
function m3PerPalletForSize(size: string | null): Prisma.Decimal | null {
  const thickness = size ? /x(\d{2,3})\s*$/i.exec(size.replace(/[х×]/g, 'x'))?.[1] : undefined;
  if (!thickness) return null;
  return new D(thickness === '250' ? '1.8' : '1.728');
}

async function main() {
  const products = await prisma.product.findMany({
    select: { id: true, name: true, size: true, m3PerPallet: true },
    orderBy: { name: 'asc' },
  });
  if (!products.length) {
    console.log('Mahsulot yo‘q — bajariladigan ish yo‘q.');
    return;
  }

  // key: productId|kind|ISO-day  →  the row to insert
  const rows = new Map<string, Prisma.ProductPriceCreateManyInput>();
  const perProduct = new Map<string, { sale: number; cost: number }>();

  for (const p of products) {
    perProduct.set(p.id, { sale: 0, cost: 0 });
    const items = await prisma.orderItem.findMany({
      where: {
        productId: p.id,
        order: { cancelledAt: null },
      },
      select: {
        salePricePerM3: true,
        costPricePerM3: true,
        order: { select: { date: true } },
      },
      orderBy: { order: { date: 'asc' } },
    });

    for (const it of items) {
      const at = it.order.date;
      const day = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
      const add = (kind: PriceKind, raw: Prisma.Decimal | null) => {
        const price = raw ? new D(raw) : null;
        if (!price || !price.isFinite() || price.lte(0)) return;
        const key = `${p.id}|${kind}|${day.toISOString()}`;
        if (rows.has(key)) return;
        rows.set(key, {
          productId: p.id,
          kind,
          pricePerM3: price.toDP(6),
          effectiveFrom: day,
        });
        const c = perProduct.get(p.id)!;
        if (kind === PriceKind.DEALER_SALE) c.sale++;
        else c.cost++;
      };
      add(PriceKind.DEALER_SALE, it.salePricePerM3);
      add(PriceKind.FACTORY_BANK, it.costPricePerM3);
    }
  }

  // Products with no usable history at all still need SOMETHING in force, otherwise the
  // order form stays blocked for them. Report them loudly rather than inventing a price.
  const orphans = products.filter((p) => (perProduct.get(p.id)?.sale ?? 0) === 0);

  console.log(`\nMahsulotlar: ${products.length}`);
  for (const p of products) {
    const c = perProduct.get(p.id)!;
    console.log(
      `  · ${p.name.padEnd(18)} sotuv narxlari: ${String(c.sale).padStart(3)}   zavod narxlari: ${String(c.cost).padStart(3)}`,
    );
  }

  // m3PerPallet repair: the importer left every product on the 1.728 default, which is
  // wrong for ×250 (1.8) and silently mis-converts pallets → m³ on the order form.
  const sizeFixes = products
    .map((p) => ({ p, want: m3PerPalletForSize(p.size ?? p.name) }))
    .filter((x) => x.want != null && !new D(x.p.m3PerPallet).equals(x.want!));

  if (dryRun) {
    console.log(`\n[DRY] yoziladigan narx qatorlari: ${rows.size}`);
    console.log(`[DRY] tuzatiladigan m3PerPallet: ${sizeFixes.length}`);
    for (const { p, want } of sizeFixes) {
      console.log(`[DRY]   · ${p.name}: ${new D(p.m3PerPallet).toString()} → ${want!.toString()}`);
    }
    if (orphans.length) {
      console.log(`\n[DRY] TARIXSIZ mahsulotlar (narx qo‘lda kiritilishi kerak): ${orphans.map((o) => o.name).join(', ')}`);
    }
    return;
  }

  const written = await prisma.productPrice.createMany({
    data: [...rows.values()],
    skipDuplicates: true,
  });
  console.log(`\nYozildi: ${written.count} narx qatori (${rows.size} nomzoddan; qolgani allaqachon bor edi).`);

  for (const { p, want } of sizeFixes) {
    await prisma.product.update({ where: { id: p.id }, data: { m3PerPallet: want! } });
    console.log(`  m3PerPallet tuzatildi: ${p.name} ${new D(p.m3PerPallet).toString()} → ${want!.toString()}`);
  }

  if (orphans.length) {
    console.log(
      `\nDIQQAT — bu mahsulotlarda sotuv tarixi yo‘q, «Mahsulotlar» bo‘limida narx qo‘lda kiritilsin:\n  ${orphans
        .map((o) => o.name)
        .join('\n  ')}`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
