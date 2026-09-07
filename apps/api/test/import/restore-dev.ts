/**
 * DEV bazasini `docs/Smart blok.xlsx` dan qayta tiklaydi (upload → preview → commit).
 *
 * `test/_reset-data.mjs` DATABASE_URL siz chaqirilsa .env dagi DEV bazani TRUNCATE qiladi —
 * bu skript o'sha holatdan chiqish yo'li. Faqat BO'SH bazada ishlaydi: buyurtma yoki
 * to'lov bo'lsa, rad etadi (ustiga import qilib, ma'lumotni ikkilantirmasin).
 *
 *   DATABASE_URL=postgresql://postgres@localhost:5433/smartblok npx tsx test/import/restore-dev.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { ImportService } from '../../src/import/import.service';
import { AiReviewService } from '../../src/import/rules/ai-review.service';

const XLSX = join(__dirname, '../../../../docs/Smart blok.xlsx');

async function main() {
  const prisma = new PrismaClient();
  const [orders, payments] = await Promise.all([prisma.order.count(), prisma.payment.count()]);
  if (orders > 0 || payments > 0) {
    throw new Error(`Baza bo'sh emas (${orders} buyurtma, ${payments} to'lov) — import qilinmadi.`);
  }
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true, username: true } });
  const buffer = readFileSync(XLSX);
  delete process.env.ANTHROPIC_API_KEY; // AI ikkinchi fikri shart emas, natija deterministik bo'lsin
  const service = new ImportService(prisma as any, new AiReviewService());
  const user = { userId: admin?.id ?? null, username: admin?.username ?? 'admin', role: 'ADMIN', name: 'restore', agentId: null };

  console.log('1) UPLOAD → STAGE');
  const sum = await service.uploadAndStage(buffer, 'Smart blok.xlsx', user as any);
  const id = sum.batch.id;
  console.log(`   batch ${id} · to'siq ${sum.openBlockers} · aniqlanmagan nom ${sum.pendingEntities}`);

  console.log('2) PREVIEW');
  const prev = await service.preview(id);
  console.log(`   zavod balansi ${prev.factoryBalance} · mijoz qarzi ${prev.clientDebtTotal} · poddon (mijozlarda) ${prev.pallets.clientDebt}`);

  console.log('3) COMMIT');
  const res = await service.commit(id, prev.previewHash, user as any);
  console.log('   ', JSON.stringify(res, null, 1).slice(0, 600));

  const after = await Promise.all([
    prisma.client.count(),
    prisma.order.count(),
    prisma.payment.count(),
    prisma.palletTransaction.count(),
  ]);
  console.log(`\nTiklandi: ${after[0]} mijoz · ${after[1]} buyurtma · ${after[2]} to'lov · ${after[3]} paddon qatori`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
