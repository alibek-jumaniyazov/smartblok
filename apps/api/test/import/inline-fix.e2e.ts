/**
 * Review-screen fixes must actually reach the commit (isolated smartblok_test DB):
 *  - accepting a NARX_BUTUN_SON_EMAS suggestion rounds the stored saleSum;
 *  - resolveEntity renames a client across all its staged rows;
 *  - patchRow edits a row field directly.
 *   DATABASE_URL=…smartblok_test npx tsx test/import/inline-fix.e2e.ts ["<abs xlsx>"]
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { ImportService } from '../../src/import/import.service';
import { AiReviewService } from '../../src/import/rules/ai-review.service';

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
  delete process.env.ANTHROPIC_API_KEY;
  const service = new ImportService(prisma as any, new AiReviewService());
  const user = { userId: null as any, username: 't', role: 'ADMIN' as const, name: 't', agentId: null };

  console.log('1) UPLOAD');
  const sum = await service.uploadAndStage(buffer, 'inline-fix.xlsx', user as any);
  const id = sum.batch.id;

  console.log('2) NARX_BUTUN_SON_EMAS ni qabul qilish → saleSum yaxlitlanadi');
  // Рустам Шпик row (Лист1 r20): saleSum 23 964 999.3792 → suggested 23 965 000
  const issues = await prisma.importIssue.findMany({ where: { batchId: id, ruleId: 'NARX_BUTUN_SON_EMAS' }, include: { row: true } });
  eq('3 ta NARX topilmasi', issues.length, 3);
  const rustam = issues.find((i) => i.row?.excelRow === 20)!;
  eq('taklif 23 965 000', rustam.suggestedValue, 23_965_000);
  await service.resolveIssue(id, rustam.id, { status: 'ACCEPTED' }, user as any);
  const row20 = await prisma.importRow.findUniqueOrThrow({ where: { id: rustam.rowId! } });
  eq('resolvedJson.saleSum yangilandi', (row20.resolvedJson as any).saleSum, 23_965_000);

  console.log('3) resolveEntity → mijoz nomi barcha qatorlarda almashadi');
  const fidatoMap = await prisma.importEntityMap.findFirstOrThrow({ where: { batchId: id, kind: 'CLIENT', sourceName: 'Фидато Гроуп' } });
  await service.resolveEntity(id, fidatoMap.id, 'Фидато Гроуп MCHJ');
  const fidatoRows = await prisma.importRow.findMany({ where: { batchId: id } });
  const stamped = fidatoRows.filter((r) => (r.resolvedJson as any).resolvedClientName === 'Фидато Гроуп MCHJ');
  eq('Фидато qatorlari qayta nomlandi', stamped.length, 1); // 1 payment, 0 orders

  console.log('4) patchRow → transport tahriri');
  const ship4 = await prisma.importRow.findFirstOrThrow({ where: { batchId: id, kind: 'SHIPMENT', excelRow: 4 } });
  await service.patchRow(id, ship4.id, { transport: '2100000' });
  const ship4b = await prisma.importRow.findUniqueOrThrow({ where: { id: ship4.id } });
  eq('transport patch yozildi', (ship4b.resolvedJson as any).transport, '2100000');

  console.log('4b) patchRow → poddon qaytarish («Возврат паддон» 5 dona, Урганч)');
  // Урганч Тамирлаш payment lives on «Жамол 22-22» r7; client received 36 pallets
  const urganchPay = await prisma.importRow.findFirstOrThrow({ where: { batchId: id, kind: 'CLIENT_PAYMENT', sheetName: 'Жамол 22-22', excelRow: 7 } });
  await service.patchRow(id, urganchPay.id, { palletReturn: 5 });

  console.log('5) PREVIEW → tahrirlar balansda ko‘rinadi');
  const prev = await service.preview(id);
  // saleTotal: 501 414 039.36 − 23 964 999.38 + 23 965 000.00 = 501 414 039.98
  eq('saleTotal yaxlitlashni aks ettiradi', prev.saleTotal, '501414039.98');
  eq('clientDebtTotal mos siljiydi', prev.clientDebtTotal, '239399139.98');
  eq('vehicleBalance baribir 0 (to‘langan)', prev.vehicleBalance, '0.00');
  eq('palletsOut 394−5 qaytarish = 389', prev.palletsOut, 389);

  console.log('6) COMMIT + tekshiruv + ROLLBACK');
  const res = await service.commit(id, prev.previewHash, user as any);
  eq('commit saleTotal', res.saleTotal, '501414039.98');
  const renamed = await prisma.client.findFirst({ where: { name: 'Фидато Гроуп MCHJ' } });
  eq('qayta nomlangan mijoz yaratildi', !!renamed, true);
  const ret = await prisma.palletTransaction.findMany({ where: { importBatchId: id, type: 'RETURNED_BY_CLIENT' } });
  eq('poddon qaytarish yozildi (1×5)', ret.map((r) => r.qty).join(','), '5');
  const rb = await service.rollback(id, user as any);
  eq('rollback Σ=0', rb.ledgerSum, '0.00');
  eq('rollback poddon balans-Σ=0 (qaytarish ham teskarilangan)', rb.palletSum, 0);
  eq('qaytarish REVERSAL +5 bilan yopilgan', rb.reversedPallets, 43); // 21×2 harakat + 1 qaytarish

  await prisma.$disconnect();
  console.log(`\n${fails === 0 ? 'INLINE-FIX E2E O‘TDI ✓ — tahrirlar bazagacha yetadi' : `${fails} ta YIQILDI ✗`}`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
