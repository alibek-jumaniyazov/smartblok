/**
 * One-off: settle every EXISTING client payment against that client's orders, oldest
 * order first — the same FIFO rule new payments now follow automatically.
 *
 * SAFETY — this cannot change a single balance. A client's balance is the plain sum of his
 * CLIENT LedgerEntry rows, and those were posted when each payment was created. Allocation
 * rows carry no ledger weight for client money; they only record WHICH order each payment
 * answered for, which is what the new per-order "Mijoz qarzi" figures read. Every reconciled
 * total (Ост, dashboard, agent balances) is therefore untouched by design, and the dry run
 * prints the before/after balance of every affected client so you can confirm it.
 *
 * Overpayment is left as an advance, exactly as in the live path.
 * Idempotent: re-running places only what is still unplaced.
 *
 *   npm run db:backfill-allocations -w apps/api -- --dry   # report only
 *   npm run db:backfill-allocations -w apps/api            # write
 */
import { LedgerAccount, PaymentKind, Prisma, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const D = Prisma.Decimal;
const ZERO = new D(0);
const dry = process.argv.includes('--dry');
const money = (d: Prisma.Decimal) =>
  d.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

async function clientBalance(clientId: string): Promise<Prisma.Decimal> {
  const r = await prisma.ledgerEntry.aggregate({
    where: { account: LedgerAccount.CLIENT, clientId },
    _sum: { amount: true },
  });
  return new D(r._sum.amount ?? 0);
}

async function main() {
  const clients = await prisma.client.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } });
  let totalPlaced = ZERO;
  let rowsWritten = 0;
  let touchedClients = 0;
  const balanceDrift: string[] = [];

  for (const client of clients) {
    const before = await clientBalance(client.id);

    const payments = await prisma.payment.findMany({
      where: { clientId: client.id, kind: PaymentKind.CLIENT_IN, voidedAt: null },
      select: {
        id: true,
        amount: true,
        date: true,
        allocations: { where: { voidedAt: null }, select: { amount: true } },
      },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    });
    if (!payments.length) continue;

    const orders = await prisma.order.findMany({
      where: { clientId: client.id, status: { not: 'CANCELLED' } },
      select: { id: true, orderNo: true, saleTotal: true },
      orderBy: [{ date: 'asc' }, { orderNo: 'asc' }],
    });
    if (!orders.length) continue;

    // running outstanding per order, seeded from allocations that already exist
    const outstanding = new Map<string, Prisma.Decimal>();
    for (const o of orders) {
      const agg = await prisma.paymentAllocation.aggregate({
        where: {
          orderId: o.id,
          voidedAt: null,
          payment: { voidedAt: null, kind: { in: [PaymentKind.CLIENT_IN, PaymentKind.TRANSPORT_DIRECT] } },
        },
        _sum: { amount: true },
      });
      const left = new D(o.saleTotal).minus(new D(agg._sum.amount ?? 0));
      outstanding.set(o.id, left.lessThan(0) ? ZERO : left);
    }

    let clientPlaced = ZERO;
    const lines: string[] = [];

    for (const pay of payments) {
      const already = pay.allocations.reduce((a, x) => a.plus(new D(x.amount)), ZERO);
      let free = new D(pay.amount).minus(already);
      if (free.lessThanOrEqualTo(0)) continue;

      for (const o of orders) {
        if (free.lessThanOrEqualTo(0)) break;
        const left = outstanding.get(o.id) ?? ZERO;
        if (left.lessThanOrEqualTo(0)) continue;
        const take = left.lessThan(free) ? left : free;

        if (!dry) {
          const existing = await prisma.paymentAllocation.findFirst({
            where: { paymentId: pay.id, orderId: o.id, voidedAt: null },
            select: { id: true, amount: true },
          });
          if (existing) {
            await prisma.paymentAllocation.update({
              where: { id: existing.id },
              data: { amount: new D(existing.amount).plus(take).toDP(2) },
            });
          } else {
            await prisma.paymentAllocation.create({
              data: { paymentId: pay.id, orderId: o.id, amount: take.toDP(2) },
            });
          }
        }
        rowsWritten++;
        lines.push(`      ${o.orderNo}  +${money(take)}`);
        outstanding.set(o.id, left.minus(take));
        free = free.minus(take);
        clientPlaced = clientPlaced.plus(take);
      }
      if (free.greaterThan(0)) lines.push(`      (avans qoldi: ${money(free)})`);
    }

    if (clientPlaced.greaterThan(0)) {
      touchedClients++;
      totalPlaced = totalPlaced.plus(clientPlaced);
      console.log(`\n  ${client.name} — taqsimlandi ${money(clientPlaced)}`);
      for (const l of lines.slice(0, 12)) console.log(l);
      if (lines.length > 12) console.log(`      … yana ${lines.length - 12} qator`);

      if (!dry) {
        const after = await clientBalance(client.id);
        if (!after.equals(before)) {
          balanceDrift.push(`${client.name}: ${money(before)} → ${money(after)}`);
        }
      }
    }
  }

  console.log(`\n${dry ? '[DRY] ' : ''}Mijozlar: ${touchedClients} · taqsimot qatorlari: ${rowsWritten} · jami: ${money(totalPlaced)}`);

  if (!dry) {
    if (balanceDrift.length) {
      console.error('\n!!! BALANS O‘ZGARDI — bu bo‘lmasligi kerak edi:');
      for (const d of balanceDrift) console.error('   ' + d);
      process.exitCode = 1;
    } else {
      console.log('Hech bir mijoz balansi o‘zgarmadi ✓ (kutilganidek — taqsimot pul ko‘chirmaydi)');
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
