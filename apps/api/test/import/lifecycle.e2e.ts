/**
 * Full lifecycle against an ISOLATED test DB (smartblok_test): upload → preview →
 * REAL commit → verify live balances + agent/client links → rollback → prove Σ=0.
 *   DATABASE_URL=…smartblok_test npx tsx test/import/lifecycle.e2e.ts ["<abs xlsx>"]
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient, Prisma } from '@prisma/client';
import { ImportService } from '../../src/import/import.service';
import { AiReviewService } from '../../src/import/rules/ai-review.service';

const D = Prisma.Decimal;
const DEFAULT_XLSX = join(__dirname, '../../../../docs/Smart blok.xlsx');

let fails = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = String(got) === String(want);
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}: ${got}${ok ? '' : `   (kutilgan ${want})`}`);
  if (!ok) fails++;
};

async function main() {
  if (!/smartblok_test/.test(process.env.DATABASE_URL ?? '')) throw new Error('E2E faqat smartblok_test DB da (DATABASE_URL)');
  const buffer = readFileSync(process.argv[2] ?? DEFAULT_XLSX);
  const prisma = new PrismaClient();
  delete process.env.ANTHROPIC_API_KEY; // deterministic run
  const service = new ImportService(prisma as any, new AiReviewService());
  const user = { userId: null as any, username: 't', role: 'ADMIN' as const, name: 't', agentId: null };

  console.log('1) UPLOAD → STAGE');
  const sum = await service.uploadAndStage(buffer, 'lifecycle.xlsx', user as any);
  const id = sum.batch.id;
  console.log(`   batch ${id}  blockers=${sum.openBlockers} pending=${sum.pendingEntities}`);
  eq('to‘siqlar yo‘q (toza fayl)', sum.openBlockers, 0);
  eq('aniqlanmagan nomlar yo‘q', sum.pendingEntities, 0);
  eq('commitReady', sum.commitReady, true);

  console.log('2) PREVIEW');
  const prev = await service.preview(id);
  eq('preview factoryBalance (Лист1 «Завод»)', prev.factoryBalance, '-78401100.00');
  eq('preview clientDebtTotal', prev.clientDebtTotal, '239399139.36');
  eq('preview palletsOut', prev.palletsOut, 394);

  console.log('3) COMMIT (haqiqiy — bazaga yoziladi)');
  const res = await service.commit(id, prev.previewHash, user as any);
  const batch1 = await service.getBatch(id);
  eq('status → COMMITTED', batch1.batch.status, 'COMMITTED');
  const factory = await prisma.ledgerEntry.aggregate({ where: { importBatchId: id, account: 'FACTORY' }, _sum: { amount: true } });
  eq('JONLI zavod qoldig‘i (ledger)', (factory._sum.amount ?? new D(0)).toFixed(2), '-78401100.00');
  const client = await prisma.ledgerEntry.aggregate({ where: { importBatchId: id, account: 'CLIENT' }, _sum: { amount: true } });
  eq('JONLI mijozlar qarzi (ledger)', (client._sum.amount ?? new D(0)).toFixed(2), '239399139.36');
  const vehicle = await prisma.ledgerEntry.aggregate({ where: { importBatchId: id, account: 'VEHICLE' }, _sum: { amount: true } });
  eq('JONLI shofyor qoldig‘i', (vehicle._sum.amount ?? new D(0)).toFixed(2), '0.00');
  eq('buyurtmalar', await prisma.order.count({ where: { importBatchId: id } }), 21);
  eq('poddon tashqarida', res.palletsOut, 394);

  console.log('4) AGENT/MIJOZ bog‘lanishlari');
  const agents = await prisma.agent.findMany({ where: { name: { in: ['Жамол 22-22', 'Арслон ога', 'Зафар ога', 'Шохрух ога'] } } });
  eq('4 agent yaratildi', agents.length, 4);
  const sortNos = new Map(agents.map((a) => [a.name, a.sortNo]));
  eq('Жамол 22-22 daftar №1', sortNos.get('Жамол 22-22'), 1);
  eq('Шохрух ога daftar №4', sortNos.get('Шохрух ога'), 4);
  const orphanClients = await prisma.client.count({ where: { orders: { some: { importBatchId: id } }, agentId: null } });
  eq('agentga bog‘lanmagan mijoz yo‘q', orphanClients, 0);
  // Гайрат Штб has no payments — only journal rows — the agent vote must still land
  const gayrat = await prisma.client.findFirst({ where: { name: 'Гайрат Штб' }, include: { agent: true } });
  eq('Гайрат Штб → Шохрух ога (jurnal ovozi)', gayrat?.agent?.name, 'Шохрух ога');
  // Фидато Гроуп has ONLY a payment (prepayment, no orders) — created via the ledger row
  const fidato = await prisma.client.findFirst({ where: { name: 'Фидато Гроуп' }, include: { agent: true } });
  eq('Фидато Гроуп → Жамол 22-22 (daftar ovozi)', fidato?.agent?.name, 'Жамол 22-22');
  const fidatoBal = await prisma.ledgerEntry.aggregate({ where: { importBatchId: id, clientId: fidato?.id }, _sum: { amount: true } });
  eq('Фидато avansi −22 703 000', (fidatoBal._sum.amount ?? new D(0)).toFixed(0), '-22703000');
  const pay = await prisma.payment.findFirst({ where: { importBatchId: id, kind: 'CLIENT_IN', clientId: fidato?.id ?? undefined } });
  eq('to‘lovchi nomi saqlangan', pay?.payerName, 'OOO "FIDATO GROUP"');

  console.log('4b) COMMIT holati himoyalari');
  // preview after commit must NOT resurrect the batch (double-commit guard)
  const prevAfter = await service.preview(id).then(() => 'OK').catch((e) => e.constructor.name);
  eq('commitdan keyin preview rad etiladi', prevAfter, 'ConflictException');
  // the same file must not be uploadable while its committed twin exists
  const reUp = await service.uploadAndStage(buffer, 'dup.xlsx', user as any).then(() => 'OK').catch((e) => e.constructor.name);
  eq('bir xil fayl qayta yuklab boʼlmaydi (409)', reUp, 'ConflictException');
  // a second commit with the old token must be rejected
  const reCommit = await service.commit(id, prev.previewHash, user as any).then(() => 'OK').catch((e) => e.constructor.name);
  eq('takroriy commit rad etiladi', reCommit, 'ConflictException');

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
