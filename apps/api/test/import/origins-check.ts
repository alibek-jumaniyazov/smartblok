/**
 * «Qaysi buyurtmalardan» taqsimotini HAQIQIY import qilingan ma'lumot ustida tekshiradi:
 * har bir mijoz uchun Σ(partiyalar qarzi) + manbasiz === kartochkadagi qoldiq.
 *
 *   DATABASE_URL=postgresql://postgres@localhost:5433/smartblok npx tsx test/import/origins-check.ts
 */
import { PrismaClient } from '@prisma/client';
import { attributePalletLots } from '../../src/pallets/pallet-origins';

async function main() {
  const prisma = new PrismaClient();
  const clients = await prisma.client.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } });
  let bad = 0;
  let shown = 0;
  for (const c of clients) {
    const rows = await prisma.palletTransaction.findMany({
      where: { clientId: c.id },
      orderBy: [{ date: 'asc' }, { at: 'asc' }],
      select: {
        id: true, at: true, date: true, type: true, qty: true, orderId: true,
        reversalOfId: true, importBatchId: true,
        order: { select: { id: true, orderNo: true, date: true, status: true, factory: { select: { id: true, name: true } } } },
        importBatch: { select: { id: true, filename: true, createdAt: true } },
      },
    });
    if (rows.length === 0) continue;
    // kanonik qoldiq — PalletService.combineClientSums bilan bir xil formula
    const balance = rows.reduce(
      (a, r) =>
        r.type === 'DELIVERED_TO_CLIENT' ? a + r.qty
        : r.type === 'RETURNED_BY_CLIENT' || r.type === 'CHARGED_LOST' ? a - r.qty
        : r.type === 'ADJUSTMENT' || r.type === 'REVERSAL' ? a + r.qty
        : a,
      0,
    );
    const out = attributePalletLots(rows as never, balance);
    const sum = out.lots.reduce((a, l) => a + l.outstanding, 0) + out.unassigned;
    const okRow = sum === out.balance;
    if (!okRow) bad++;
    if (out.balance !== 0 && shown < 6) {
      shown++;
      console.log(`\n${c.name}: qoldiq ${out.balance} · ochiq ${out.openLots} · yopilgan ${out.settledLots} · manbasiz ${out.unassigned}`);
      for (const l of out.lots.slice(0, 5)) {
        console.log(
          `   ${l.orderNo ?? '—'}  ${l.date.slice(0, 10)}  berilgan ${l.delivered} · qaytgan ${l.returned} → QARZ ${l.outstanding}` +
            `${l.importBatchLabel ? `  [${l.importBatchLabel}]` : ''}${l.cancelled ? '  [BEKOR]' : ''}`,
        );
      }
      if (out.lots.length > 5) console.log(`   … yana ${out.lots.length - 5} ta partiya`);
    }
  }
  console.log(`\n${clients.length} mijoz tekshirildi · ustunlar qoldiqqa tushmagan mijozlar: ${bad}`);
  await prisma.$disconnect();
  process.exit(bad > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
