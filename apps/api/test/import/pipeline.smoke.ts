/**
 * End-to-end backend pipeline against the LIVE DB: upload → stage → preview.
 * Instantiates the real ImportService (no HTTP/auth), then cleans up the batch.
 *   npx tsx test/import/pipeline.smoke.ts ["<abs xlsx path>"]
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
  const buffer = readFileSync(process.argv[2] ?? DEFAULT_XLSX);
  const prisma = new PrismaClient();
  delete process.env.ANTHROPIC_API_KEY; // deterministic: no AI findings in the smoke
  const service = new ImportService(prisma as any, new AiReviewService());
  const user = { userId: null as any, username: 'test', role: 'ADMIN' as const, name: 'test', agentId: null };

  let batchId: string | null = null;
  try {
    console.log('1) UPLOAD → STAGE');
    const sum = await service.uploadAndStage(buffer, 'Smart blok.xlsx', user as any);
    batchId = sum.batch.id;
    console.log(`   batch ${batchId}  status=${sum.batch.status}`);
    console.log(`   rows: ${JSON.stringify(sum.rowsByKind)}`);
    console.log(`   openBlockers=${sum.openBlockers}  pendingEntities=${sum.pendingEntities}`);
    eq('SHIPMENT rows staged', sum.rowsByKind['SHIPMENT'], 21);
    eq('CLIENT_PAYMENT rows staged', sum.rowsByKind['CLIENT_PAYMENT'], 7);
    eq('FACTORY_PAYMENT rows staged', sum.rowsByKind['FACTORY_PAYMENT'], 8);
    eq('open blockers', sum.openBlockers, 0);
    eq('pending client names', sum.pendingEntities, 0);
    eq('commitReady darhol', sum.commitReady, true);

    console.log('\n2) staged tables persisted?');
    eq('ImportRow count', await prisma.importRow.count({ where: { batchId } }), 36);
    eq('ImportIssue count (3× NARX_BUTUN_SON_EMAS)', await prisma.importIssue.count({ where: { batchId } }), 3);
    eq('CLIENT entity maps (10 mijoz)', await prisma.importEntityMap.count({ where: { batchId, kind: 'CLIENT' } }), 10);
    eq('AGENT entity maps (4 daftar)', await prisma.importEntityMap.count({ where: { batchId, kind: 'AGENT' } }), 4);

    console.log('\n3) PREVIEW (dry-run balances)');
    const prev = await service.preview(batchId!);
    console.log(`   Zavod qoldig‘i: ${(+prev.factoryBalance).toLocaleString('ru-RU')}  ·  poddon: ${prev.palletsOut}  ·  previewHash: ${prev.previewHash.slice(0, 12)}…`);
    eq('preview saleTotal', prev.saleTotal, '501414039.36');
    eq('preview factoryBalance (Лист1 «Завод»)', prev.factoryBalance, '-78401100.00');
    eq('preview clientDebtTotal (Лист1 «Ост»)', prev.clientDebtTotal, '239399139.36');
    eq('preview palletsOut', prev.palletsOut, 394);
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
