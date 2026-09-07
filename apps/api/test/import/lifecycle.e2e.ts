/**
 * ═══════ TO'LIQ HAYOT SIKLI (izolyatsiyalangan smartblok_test bazasi) ═══════
 *
 * upload → preview → HAQIQIY commit → jonli qoldiqlarni tekshirish → rollback → Σ=0.
 *
 * `excel-parity.e2e.mjs` dan FARQI — bu yerda BONUS DASTURI kuchda bo'lgan holat sinaladi.
 * Import har bir mashina uchun bonus yozadi, lekin faqat kuchdagi `BonusProgram` bo'lsa;
 * etalon faylda dastur yo'q, ya'ni butun bonus yo'li boshqa hech qayerda qamralmaydi — va
 * aynan o'sha yo'lda teshik bor edi: rollback buyurtmalarni bekor qilar, bonusni esa
 * hamyonda QOLDIRARDI (`BonusTransaction` da `importBatchId` ustuni yo'q, ya'ni partiya
 * bo'yicha yuruvchi hech bir supurgi va hech bir isbot uni ko'rmasdi).
 *
 * Kutilgan raqamlar QOTIRILMAGAN: hammasi shu faylning o'zidan hisoblanadi.
 *
 *   DATABASE_URL=…smartblok_test npx tsx test/import/lifecycle.e2e.ts ["<abs xlsx>"]
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient, Prisma } from '@prisma/client';
import { ImportService, parseWorkbook } from '../../src/import/import.service';
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
  if (!/smartblok_test/.test(process.env.DATABASE_URL ?? '')) {
    throw new Error('E2E faqat smartblok_test DB da (DATABASE_URL)');
  }
  const buffer = readFileSync(process.argv[2] ?? DEFAULT_XLSX);
  const prisma = new PrismaClient();
  delete process.env.ANTHROPIC_API_KEY;
  const service = new ImportService(prisma as never, new AiReviewService());
  const user = { userId: null, username: 't', role: 'ADMIN' as const, name: 't', agentId: null };

  // faylning O'ZIDAN kutilgan sonlar
  const wb = await parseWorkbook(buffer);
  const wantOrders = wb.shipments.length;
  const wantPalletsDelivered = wb.shipments.reduce((a, s) => a + (s.palletQty ?? 0), 0);
  const wantAgents = new Set(wb.master.agents).size;

  console.log('1) UPLOAD → STAGE');
  const sum = await service.uploadAndStage(buffer, 'lifecycle.xlsx', user as never);
  const id = sum.batch.id;
  console.log(`   batch ${id}  blockers=${sum.openBlockers} pending=${sum.pendingEntities}`);
  eq('to‘siqlar yo‘q (toza fayl)', sum.openBlockers, 0);
  eq('aniqlanmagan nomlar yo‘q', sum.pendingEntities, 0);
  eq('commitReady', sum.commitReady, true);

  // ── BONUS DASTURI: fayldagi HAR BIR zavod uchun kuchga kiritamiz ──
  // Zavodlar commit paytida upsert qilinadi — biz ularni oldindan yaratamiz, shunda
  // dastur o'sha zavodlarga bog'lanadi va bonus yo'li haqiqatan ishga tushadi.
  for (const name of wb.master.factories) {
    const f = await prisma.factory.upsert({ where: { name }, update: {}, create: { name } });
    await prisma.bonusProgram.create({
      data: { factoryId: f.id, kind: 'PER_M3', ratePerM3: new D(1000), effectiveFrom: new Date('2020-01-01') },
    });
  }

  console.log('2) PREVIEW');
  const prev = await service.preview(id);
  eq('preview buyurtmalar', prev.orders, wantOrders);
  eq('preview berilgan poddon', prev.pallets.delivered, wantPalletsDelivered);
  // ICHKI IZCHILLIK: mijozda qolgan = berilgan − qaytargan − puli to'langan
  eq(
    'mijozlarda qolgan poddon izchil',
    prev.pallets.clientDebt,
    prev.pallets.delivered - prev.pallets.returnedByClients - prev.pallets.paidByClients,
  );
  eq('omborda = qaytargan − zavodga qaytarilgan',
    prev.pallets.dealerInHand,
    prev.pallets.returnedByClients - prev.pallets.returnedToFactory);

  console.log('3) COMMIT (haqiqiy — bazaga yoziladi)');
  const res = await service.commit(id, prev.previewHash, user as never);
  eq('status → COMMITTED', (await service.getBatch(id)).batch.status, 'COMMITTED');
  eq('buyurtmalar', await prisma.order.count({ where: { importBatchId: id } }), wantOrders);
  eq('commit = preview (buyurtmalar)', res.orders, prev.orders);

  // JONLI ledger preview bilan bir xil bo'lishi SHART — aks holda ekran commitdan oldin
  // bir raqam, keyin boshqasini ko'rsatardi.
  const led = async (account: 'FACTORY' | 'CLIENT' | 'VEHICLE') =>
    ((await prisma.ledgerEntry.aggregate({ where: { importBatchId: id, account }, _sum: { amount: true } }))._sum.amount ?? new D(0)).toFixed(2);
  eq('JONLI zavod qoldig‘i = preview', await led('FACTORY'), new D(prev.factoryBalance).toFixed(2));
  eq('JONLI mijozlar qarzi = preview', await led('CLIENT'), new D(prev.clientDebtTotal).toFixed(2));
  eq('JONLI shofyor qoldig‘i 0 (hammasi yopilgan)', await led('VEHICLE'), '0.00');

  const walletAfterCommit = (await prisma.bonusTransaction.aggregate({ _sum: { amount: true } }))._sum.amount ?? new D(0);
  eq('bonus hamyoni to‘ldi (dastur kuchda)', walletAfterCommit.greaterThan(0), true);

  console.log('4) AGENT/MIJOZ bog‘lanishlari');
  // SANOQ emas, BORLIK tekshiriladi: seed ham o'z agentlari va zavodini yaratadi, ya'ni
  // jadvaldagi umumiy son faylnikidan katta bo'lishi NORMAL. Muhim savol — справочникдаги
  // har bir nom bazada bormi (aks holda o'sha agentning butun daftari egasiz qolardi).
  eq(
    'справочникdagi hamma agent bazada bor',
    await prisma.agent.count({ where: { name: { in: wb.master.agents } } }),
    wantAgents,
  );
  eq(
    'справочникdagi hamma zavod bazada bor',
    await prisma.factory.count({ where: { name: { in: wb.master.factories } } }),
    wb.master.factories.length,
  );
  const orphan = await prisma.client.count({ where: { agentId: null } });
  eq('agentsiz mijoz yo‘q (справочник hammasini biriktirdi)', orphan, 0);

  console.log('5) ROLLBACK');
  const rb = await service.rollback(id, user as never);
  eq('ledger Σ = 0', rb.ledgerSum, '0.00');
  eq('poddon balans Σ = 0', rb.palletSum, 0);
  eq('kassa Σ = 0', rb.cashSum, '0.00');
  eq('bonus Σ = 0 (hamyonda qolmadi)', rb.bonusSum, '0.00');
  const walletAfterRollback = (await prisma.bonusTransaction.aggregate({ _sum: { amount: true } }))._sum.amount ?? new D(0);
  eq('bonus hamyoni bo‘shadi', walletAfterRollback.toFixed(2), '0.00');
  eq('buyurtmalar bekor qilindi', await prisma.order.count({ where: { importBatchId: id, status: { not: 'CANCELLED' } } }), 0);

  await prisma.$disconnect();
  console.log(`\n${fails === 0 ? 'LIFECYCLE E2E O‘TDI ✓' : `${fails} ta YIQILDI ✗`}`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
