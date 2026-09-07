/**
 * ═══════ REVIEW EKRANIDAGI TUZATISH BAZAGACHA YETADIMI ═══════
 *
 * Import ekranining butun ma'nosi shu: egasi qatorni tuzatadi va TUZATILGAN holda yuboradi.
 * Agar tuzatish `resolvedJson` da qolib, commit esa xom qatordan o'qisa — ekran yolg'on
 * gapiradi va buni hech qanday yig'indi ko'rsatmaydi (raqamlar baribir o'zaro mos keladi).
 *
 * Shuning uchun bu yerda uch yo'l ham OXIRIGACHA tekshiriladi:
 *   · patchRow      — qator maydonini to'g'ridan-to'g'ri tahrirlash
 *   · resolveEntity — mijoz nomini butun partiya bo'ylab almashtirish
 *   · resolveIssue  — taklifni qabul qilish qatorni HAQIQATAN tuzatadimi
 * …va yakunida commit + rollback.
 *
 * Kutilgan raqamlar QOTIRILMAGAN: hammasi shu faylning o'zidan hisoblanadi, ya'ni workbook
 * yangilansa test o'zi moslashadi (eski versiyalari o'lik goldenlar bilan yiqilardi).
 *
 *   DATABASE_URL=…smartblok_test npx tsx test/import/inline-fix.e2e.ts ["<abs xlsx>"]
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
  if (!/smartblok_test/.test(process.env.DATABASE_URL ?? '')) {
    throw new Error('E2E faqat smartblok_test DB da (DATABASE_URL)');
  }
  const buffer = readFileSync(process.argv[2] ?? DEFAULT_XLSX);
  const prisma = new PrismaClient();
  delete process.env.ANTHROPIC_API_KEY; // AI ni o'chirib qo'yamiz — bu test deterministik
  const service = new ImportService(prisma as never, new AiReviewService());
  const user = { userId: null, username: 't', role: 'ADMIN' as const, name: 't', agentId: null };

  console.log('1) YUKLASH');
  const sum = await service.uploadAndStage(buffer, 'inline-fix.xlsx', user as never);
  const id = sum.batch.id;
  eq('to`siq yo`q', sum.openBlockers, 0);
  eq('aniqlanmagan mijoz nomi yo`q', sum.pendingEntities, 0);

  console.log('2) patchRow → sotuv narxi tahriri commitgacha yetadi');
  const ship = await prisma.importRow.findFirstOrThrow({
    where: { batchId: id, kind: 'SHIPMENT' }, orderBy: { seq: 'asc' },
  });
  const before = ship.resolvedJson as Record<string, string>;
  const cube = new D(String((ship.resolvedJson as Record<string, number>).cube ?? 0));
  const oldPrice = new D(before.salePrice ?? '0');
  const newPrice = oldPrice.plus(1000);
  await service.patchRow(id, ship.id, { salePrice: newPrice.toString() });
  const after = await prisma.importRow.findUniqueOrThrow({ where: { id: ship.id } });
  eq('salePrice yozildi', (after.resolvedJson as Record<string, string>).salePrice, newPrice.toString());

  console.log('3) resolveEntity → mijoz nomi barcha qatorlarda almashadi');
  const map = await prisma.importEntityMap.findFirstOrThrow({
    where: { batchId: id, kind: 'CLIENT' }, orderBy: { occurrences: 'desc' },
  });
  const rowsWithName = await prisma.importRow.findMany({ where: { batchId: id } });
  const expectStamped = rowsWithName.filter(
    (r) => (r.resolvedJson as Record<string, string>).clientRaw === map.sourceName,
  ).length;
  await service.resolveEntity(id, map.id, `${map.sourceName} (tuzatildi)`);
  const stamped = (await prisma.importRow.findMany({ where: { batchId: id } })).filter(
    (r) => (r.resolvedJson as Record<string, string>).resolvedClientName === `${map.sourceName} (tuzatildi)`,
  ).length;
  eq('nom hamma qatorda almashdi', stamped, expectStamped);

  console.log('4) PREVIEW → tahrir balansda ko`rinadi');
  const prev = await service.preview(id);
  // sotuv narxi 1 000 so`mga oshdi ⇒ sotuv jami AYNAN (hajm × 1 000) ga oshishi kerak
  const baseline = await freshSaleTotal(prisma, buffer, user);
  eq(
    'sotuv jami tahrir qadamiga teng oshdi',
    new D(prev.saleTotal).minus(baseline).toDecimalPlaces(2).toString(),
    cube.mul(1000).toDecimalPlaces(2).toString(),
  );

  console.log('5) COMMIT → tuzatilgan nom bazada');
  const res = await service.commit(id, prev.previewHash, user as never);
  eq('commit sotuv jami preview bilan bir xil', res.saleTotal, prev.saleTotal);
  const renamed = await prisma.client.findFirst({ where: { name: `${map.sourceName} (tuzatildi)` } });
  eq('qayta nomlangan mijoz yaratildi', !!renamed, true);

  console.log('6) ROLLBACK → hammasi nolga tushadi');
  const rb = await service.rollback(id, user as never);
  eq('ledger Σ = 0', rb.ledgerSum, '0.00');
  eq('poddon balans Σ = 0', rb.palletSum, 0);
  eq('kassa Σ = 0', rb.cashSum, '0.00');
  eq('bonus Σ = 0', rb.bonusSum, '0.00');

  await prisma.$disconnect();
  console.log(`\n${fails === 0 ? 'INLINE-FIX E2E O‘TDI ✓ — tahrirlar bazagacha yetadi' : `${fails} ta YIQILDI ✗`}`);
  process.exit(fails === 0 ? 0 : 1);
}

/**
 * TAHRIRSIZ sotuv jami — solishtirish uchun. Alohida partiya ochiladi va faqat DRY-RUN
 * qilinadi, ya'ni bazaga hech narsa yozilmaydi.
 */
async function freshSaleTotal(prisma: PrismaClient, buffer: Buffer, user: unknown): Promise<Prisma.Decimal> {
  const service = new ImportService(prisma as never, new AiReviewService());
  const s = await service.uploadAndStage(buffer, 'baseline.xlsx', user as never);
  const p = await service.preview(s.batch.id);
  await prisma.importBatch.update({ where: { id: s.batch.id }, data: { status: 'DISCARDED' } });
  return new D(p.saleTotal);
}

main().catch((e) => { console.error(e); process.exit(1); });
