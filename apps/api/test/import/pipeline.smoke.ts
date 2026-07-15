/**
 * End-to-end backend pipeline against the LIVE DB: upload → stage → preview.
 * Instantiates the real ImportService (no HTTP/auth), then cleans up the batch.
 *   DATABASE_URL=… npx tsx test/import/pipeline.smoke.ts "<abs xlsx path>"
 */
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { ImportService } from '../../src/import/import.service';
import { AiReviewService } from '../../src/import/rules/ai-review.service';

let fails = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = String(got) === String(want);
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}: ${got}${ok ? '' : `   (kutilgan ${want})`}`);
  if (!ok) fails++;
};

async function main() {
  const xlsx = process.argv[2];
  if (!xlsx) throw new Error('xlsx yo‘li kerak');
  const buffer = readFileSync(xlsx);
  const prisma = new PrismaClient();
  const service = new ImportService(prisma as any, new AiReviewService());
  const user = { userId: null as any, username: 'test', role: 'ADMIN' as const, name: 'test', agentId: null };

  let batchId: string | null = null;
  try {
    console.log('1) UPLOAD → STAGE');
    const sum = await service.uploadAndStage(buffer, 'Газоблок Счет.xlsx', user as any);
    batchId = sum.batch.id;
    console.log(`   batch ${batchId}  status=${sum.batch.status}`);
    console.log(`   rows: ${JSON.stringify(sum.rowsByKind)}`);
    console.log(`   openBlockers=${sum.openBlockers}  pendingEntities=${sum.pendingEntities}`);
    eq('SHIPMENT rows staged', sum.rowsByKind['SHIPMENT'], 88);
    eq('CLIENT_PAYMENT rows staged', sum.rowsByKind['CLIENT_PAYMENT'], 38);
    eq('FACTORY_PAYMENT rows staged', sum.rowsByKind['FACTORY_PAYMENT'], 19);
    eq('open blockers', sum.openBlockers, 11);
    eq('pending client names', sum.pendingEntities, 2);

    console.log('\n2) staged tables persisted?');
    eq('ImportRow count', await prisma.importRow.count({ where: { batchId } }), 145);
    const issues = await prisma.importIssue.count({ where: { batchId } });
    console.log(`   ImportIssue count = ${issues}`);
    // 36 distinct spellings collapse by normalizedKey (Бунёдкор/БУНЕДКОР → one) → 31 clients
    eq('ImportEntityMap count (deduped by name)', await prisma.importEntityMap.count({ where: { batchId } }), 31);

    console.log('\n3) PREVIEW (dry-run balances)');
    const prev = await service.preview(batchId!);
    console.log(`   Zavod qoldig‘i: ${(+prev.factoryBalance).toLocaleString('ru-RU')}  ·  poddon: ${prev.palletsOut}  ·  previewHash: ${prev.previewHash.slice(0, 12)}…`);
    eq('preview factoryBalance', prev.factoryBalance, '242034270.00');
    eq('preview palletsOut', prev.palletsOut, 1630);
    const after = await service.getBatch(batchId!);
    eq('status → READY after preview', after.batch.status, 'READY');
  } finally {
    if (batchId) {
      await prisma.importBatch.delete({ where: { id: batchId } }).catch(() => {});
      const left = await prisma.importBatch.count({ where: { id: batchId } });
      console.log(`\n   cleanup: batch deleted (${left === 0 ? 'ok' : 'LEFTOVER!'})`);
    }
    await prisma.$disconnect();
  }

  console.log(`\n${fails === 0 ? 'BACKEND PIPELINE SMOKE O‘TDI ✓' : `${fails} ta YIQILDI ✗`}`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
