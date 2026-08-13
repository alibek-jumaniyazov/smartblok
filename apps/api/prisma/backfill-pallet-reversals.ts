/**
 * Bekor qilingan buyurtmalarning QIRQILGAN paddon stornolarini davom ettiradi.
 *
 * Nega kerak: buyurtma bekor qilinganda uning paddon stornosi mijoz O'SHA PAYTDA ushlab
 * turgan songa qadar qirqilardi va qolgan bo'lak — `reversalOfId` UNIQUE bo'lgani uchun —
 * hech qachon yozilmasdi (migration 20260813120000 ni ko'ring). Natijada mijoz
 * kartochkasi bekor qilingan buyurtmaning paddonini uning o'z qarzi qilib ko'rsatardi:
 *
 *     «Mijozga jami berilgan 5 · Mijoz qaytargan 0 · Hozir mijozda 5»
 *
 * — va o'sha 5 dona qaysi buyurtmadan kelgani hech qayerda yozilmagan edi. Kod endi
 * bo'lakni o'zi davom ettiradi (mijozning qoldig'i ko'tarilgan har safar), lekin
 * ALLAQACHON shu holatda qolgan bazani hech kim tuzatmaydi — bu skript aynan shuning
 * uchun.
 *
 * Nima qiladi: har bir mijoz uchun status = CANCELLED bo'lgan buyurtmalarning
 * stornolanmagan bo'laklarini topadi va PalletService.reverseForOrder ni qayta ishga
 * tushiradi — ya'ni JONLI kod bilan bir xil yo'l, bir xil chegara (mijoz qoldig'idan
 * ortiq stornolamaydi) va bir xil qatorlar. Import partiyalari buzilmaydi: storno asl
 * qatorning `importBatchId` ida qoladi, shuning uchun rollback isboti hamon nolga tushadi.
 *
 * IDEMPOTENT: ikkinchi marta ishga tushirilsa hech narsa yozmaydi.
 *
 *   npm run db:backfill-pallet-reversals -w apps/api            # yozadi
 *   npm run db:backfill-pallet-reversals -w apps/api -- --dry   # faqat hisobot
 */
import { OrderStatus, PalletTransactionType, Prisma, PrismaClient } from '@prisma/client';
import { attributePalletLots } from '../src/pallets/pallet-origins';

const prisma = new PrismaClient();
const dryRun = process.argv.includes('--dry');

/**
 * «Shu buyurtmadan mijozda hozir nechta qolgan» — PalletService.stillHeldFromOrder ning
 * ayni o'zi. Umumiy qoldiq CHEGARA sifatida YARAMAYDI: u boshqa (tirik) buyurtmaning
 * paddonini yeb qo'yishi mumkin — pallets.service.ts dagi izohga qarang.
 */
async function stillHeldFromOrder(
  db: Prisma.TransactionClient,
  clientId: string,
  orderId: string,
): Promise<number> {
  const rows = await db.palletTransaction.findMany({
    where: { clientId },
    orderBy: [{ date: 'asc' }, { at: 'asc' }],
    select: {
      id: true, at: true, date: true, type: true, qty: true,
      orderId: true, reversalOfId: true, importBatchId: true,
    },
  });
  const balance = rows.reduce(
    (a, r) =>
      r.type === PalletTransactionType.DELIVERED_TO_CLIENT ? a + r.qty
      : r.type === PalletTransactionType.RETURNED_BY_CLIENT || r.type === PalletTransactionType.CHARGED_LOST ? a - r.qty
      : r.type === PalletTransactionType.ADJUSTMENT || r.type === PalletTransactionType.REVERSAL ? a + r.qty
      : a,
    0,
  );
  return attributePalletLots(rows, balance)
    .lots.filter((l) => l.orderId === orderId)
    .reduce((a, l) => a + l.outstanding, 0);
}

interface Pending {
  clientId: string;
  clientName: string;
  orderId: string;
  orderNo: string;
  rowId: string;
  qty: number;
  undone: number;
}

/** Bekor qilingan buyurtmalarning hali yopilmagan yetkazish bo'laklari. */
async function findPending(db: Prisma.TransactionClient | PrismaClient): Promise<Pending[]> {
  return db.$queryRaw<Pending[]>(Prisma.sql`
    SELECT
      pt."clientId"  AS "clientId",
      c."name"       AS "clientName",
      pt."orderId"   AS "orderId",
      o."orderNo"    AS "orderNo",
      pt."id"        AS "rowId",
      pt."qty"::int  AS qty,
      COALESCE(-SUM(rev."qty"), 0)::int AS undone
    FROM "PalletTransaction" pt
    JOIN "Order"  o ON o."id" = pt."orderId"
    JOIN "Client" c ON c."id" = pt."clientId"
    LEFT JOIN "PalletTransaction" rev ON rev."reversalOfId" = pt."id"
    WHERE pt."type" = ${PalletTransactionType.DELIVERED_TO_CLIENT}::"PalletTransactionType"
      AND o."status" = ${OrderStatus.CANCELLED}::"OrderStatus"
      AND pt."clientId" IS NOT NULL
    GROUP BY pt."id", c."name", o."orderNo"
    HAVING pt."qty" + COALESCE(SUM(rev."qty"), 0) > 0
    ORDER BY c."name", o."orderNo"`);
}

async function main() {
  const pending = await findPending(prisma);
  if (pending.length === 0) {
    console.log('Bekor qilingan buyurtmalarda osilib qolgan paddon yo‘q — bajariladigan ish yo‘q.');
    return;
  }

  const byClient = new Map<string, { name: string; qty: number; orders: Set<string> }>();
  for (const p of pending) {
    const acc = byClient.get(p.clientId) ?? { name: p.clientName, qty: 0, orders: new Set<string>() };
    acc.qty += p.qty - p.undone;
    acc.orders.add(p.orderNo);
    byClient.set(p.clientId, acc);
  }

  console.log(`Bekor qilingan buyurtmalarda osilib qolgan paddon: ${byClient.size} mijoz`);
  for (const [, acc] of byClient) {
    console.log(`  · ${acc.name}: ${acc.qty} dona — ${[...acc.orders].join(', ')}`);
  }
  if (dryRun) {
    console.log('\n[DRY] hech narsa yozilmadi.');
    return;
  }

  // Jonli koddagi ayni yo'l: har bir buyurtma uchun reverseForOrder. Uni bu yerda
  // takrorlamaymiz — Nest konteynerisiz PalletService ni qurish uchun uning bog'liqliklari
  // (ledger/audit/settings) kerak bo'lardi, holbuki bizga faqat SHU metod kerak. Shuning
  // uchun mantiq bir joyda: quyidagi halqa reverseForOrder ning aynan o'zini bajaradi —
  // mijoz qatori qulflanadi, taqsimot o'qiladi, bo'lak qirqiladi. Chegara ham AYNAN
  // o'sha: mijozning umumiy qoldig'i emas, «SHU buyurtmadan qolgani» (pallet-origins.ts).
  let written = 0;
  for (const [clientId] of byClient) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM "Client" WHERE id = ${clientId} FOR UPDATE`;
      // Buyurtmalar eng eskisidan: chegara qisqa bo'lganda tartib natijaga ta'sir
      // qiladi va u BASHORATLI bo'lishi kerak.
      const rows = (await findPending(tx)).filter((r) => r.clientId === clientId);
      const orderIds = [...new Set(rows.map((r) => r.orderId))];
      for (const orderId of orderIds) {
        const cap = await stillHeldFromOrder(tx, clientId, orderId);
        if (cap <= 0) continue;

        const sides = await tx.palletTransaction.findMany({
          where: {
            orderId,
            type: {
              in: [
                PalletTransactionType.RECEIVED_FROM_FACTORY,
                PalletTransactionType.DELIVERED_TO_CLIENT,
              ],
            },
          },
          include: { reversals: { select: { qty: true } } },
          orderBy: { at: 'asc' },
        });
        const remainingOf = (r: (typeof sides)[number]) =>
          Math.max(0, r.qty + r.reversals.reduce((a, x) => a + x.qty, 0));
        const delivered = sides.filter((r) => r.type === PalletTransactionType.DELIVERED_TO_CLIENT);
        const received = sides.filter((r) => r.type === PalletTransactionType.RECEIVED_FROM_FACTORY);
        const allowance = Math.max(0, Math.min(delivered.reduce((a, r) => a + remainingOf(r), 0), cap));
        if (allowance <= 0) continue;

        for (const side of [delivered, received]) {
          let left = allowance;
          for (const row of side) {
            if (left <= 0) break;
            const remaining = remainingOf(row);
            if (remaining <= 0) continue;
            const qty = Math.min(remaining, left);
            left -= qty;
            await tx.palletTransaction.create({
              data: {
                type: PalletTransactionType.REVERSAL,
                qty: -qty,
                clientId: row.clientId,
                factoryId: row.factoryId,
                orderId,
                date: new Date(),
                reversalOfId: row.id,
                reversalOfType: row.type,
                note: 'Bekor qilingan buyurtmaning qirqilgan stornosi davom ettirildi (tuzatish)',
                importBatchId: row.importBatchId,
              },
            });
            written++;
          }
        }
      }
    });
  }

  const left = await findPending(prisma);
  console.log(`\nYozildi: ${written} storno qatori.`);
  if (left.length > 0) {
    // Qoldig'i yetmagan mijoz: bo'lak hamon osilib turadi va bu TO'G'RI — uni yopish
    // mijoz qoldig'ini manfiyga tushirardi. Keyingi qaytarish stornosi yoki yangi yuk
    // uni jonli kodda o'zi davom ettiradi.
    const stillQty = left.reduce((a, r) => a + (r.qty - r.undone), 0);
    console.log(
      `Qolgani: ${stillQty} dona (${new Set(left.map((r) => r.clientName)).size} mijoz) — ` +
        `mijoz qo'lidagi son yetmadi. Bular mijoz keyingi paddon olganda avtomatik yopiladi.`,
    );
  } else {
    console.log('Bekor qilingan buyurtmalarda osilib qolgan paddon qolmadi.');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
