/**
 * Full lifecycle against an ISOLATED test DB (smartblok_test): upload → resolve
 * blockers → preview → REAL commit → verify live balances → rollback → prove Σ=0.
 *   DATABASE_URL=…smartblok_test npx tsx test/import/lifecycle.e2e.ts "<abs xlsx>"
 */
import { readFileSync } from 'node:fs';
import { PrismaClient, Prisma } from '@prisma/client';
import { ImportService } from '../../src/import/import.service';
import { AiReviewService } from '../../src/import/rules/ai-review.service';

const D = Prisma.Decimal;
let fails = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = String(got) === String(want);
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}: ${got}${ok ? '' : `   (kutilgan ${want})`}`);
  if (!ok) fails++;
};

async function main() {
  const xlsx = process.argv[2];
  if (!xlsx) throw new Error('xlsx yo‘li kerak');
  if (!/smartblok_test/.test(process.env.DATABASE_URL ?? '')) throw new Error('E2E faqat smartblok_test DB da (DATABASE_URL)');
  const buffer = readFileSync(xlsx);
  const prisma = new PrismaClient();
  const service = new ImportService(prisma as any, new AiReviewService());
  const user = { userId: null as any, username: 't', role: 'ADMIN' as const, name: 't', agentId: null };

  console.log('1) UPLOAD → STAGE');
  const sum = await service.uploadAndStage(buffer, 'lifecycle.xlsx', user as any);
  const id = sum.batch.id;
  console.log(`   batch ${id}  blockers=${sum.openBlockers} pending=${sum.pendingEntities}`);

  console.log('2) egasining qarorlari: to‘siqlarni acknowledge + nomlarni tasdiqlash');
  for (const i of await prisma.importIssue.findMany({ where: { batchId: id, severity: 'BLOCK', status: 'OPEN' } })) {
    await service.resolveIssue(id, i.id, { status: 'IGNORED' }, user as any);
  }
  await prisma.importEntityMap.updateMany({ where: { batchId: id, decision: 'PENDING' }, data: { decision: 'CREATE' } });

  console.log('3) PREVIEW');
  const prev = await service.preview(id);
  eq('preview factoryBalance', prev.factoryBalance, '242034270.00');

  console.log('4) COMMIT (haqiqiy — bazaga yoziladi)');
  const res = await service.commit(id, prev.previewHash, user as any);
  const batch1 = await service.getBatch(id);
  eq('status → COMMITTED', batch1.batch.status, 'COMMITTED');
  const factory = await prisma.ledgerEntry.aggregate({ where: { importBatchId: id, account: 'FACTORY' }, _sum: { amount: true } });
  eq('JONLI zavod qoldig‘i (ledger)', (factory._sum.amount ?? new D(0)).toFixed(2), '242034270.00');
  const orders = await prisma.order.count({ where: { importBatchId: id } });
  console.log(`   ${orders} buyurtma yozildi, ${res.palletsOut} poddon`);
  eq('poddon tashqarida', res.palletsOut, 1630);

  console.log('5) ROLLBACK (kompensatsiya)');
  const rb = await service.rollback(id, user as any);
  console.log(`   ${rb.reversedLedger} ledger + ${rb.reversedPallets} poddon teskari, ${rb.voidedPayments} to‘lov bekor, ${rb.cancelledOrders} buyurtma bekor`);
  eq('ledger Σ (importBatchId) = 0', rb.ledgerSum, '0.00');
  eq('poddon Σ = 0', rb.palletSum, 0);
  const batch2 = await service.getBatch(id);
  eq('status → ROLLED_BACK', batch2.batch.status, 'ROLLED_BACK');
  const liveOrders = await prisma.order.count({ where: { importBatchId: id, status: { not: 'CANCELLED' } } });
  eq('barcha buyurtmalar bekor', liveOrders, 0);

  await prisma.$disconnect();
  console.log(`\n${fails === 0 ? 'TO‘LIQ LIFECYCLE E2E O‘TDI ✓ — commit + rollback isbotlangan' : `${fails} ta YIQILDI ✗`}`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
