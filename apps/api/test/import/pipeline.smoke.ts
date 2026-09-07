/**
 * ═══════ PIPELINE SMOKE — upload → stage → preview (jonli baza ustida) ═══════
 *
 * Eng tez «quvur boshdan-oxir ishlaydimi» tekshiruvi: HTTP ham, auth ham yo'q — haqiqiy
 * `ImportService` chaqiriladi va oxirida partiya o'chiriladi (bazaga hech narsa qolmaydi).
 *
 * MUTLAQ RAQAM YO'Q. Kutilgan sonlar faylning O'ZIDAN hisoblanadi — ilgari bu yerda ikki
 * avlod oldingi workbook'ning goldenlari («21 mashina», 501 414 039.36) turardi va ular
 * har bir yangi faylda yiqilib, hech narsani isbotlamasdi. Aniq solishtirish
 * `excel-parity.e2e.mjs` da, u faylning O'Z yig'indi kataklarini o'qiydi.
 *
 *   npx tsx test/import/pipeline.smoke.ts ["<abs xlsx path>"]
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { ImportService, parseWorkbook } from '../../src/import/import.service';
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
  delete process.env.ANTHROPIC_API_KEY; // deterministik: smoke'da AI topilmalari bo'lmasin
  const service = new ImportService(prisma as never, new AiReviewService());
  const user = { userId: null, username: 'test', role: 'ADMIN' as const, name: 'test', agentId: null };

  // faylning o'zidan kutilgan sonlar
  const wb = await parseWorkbook(buffer);
  const wantRows =
    wb.shipments.length + wb.clientPayments.length + wb.factoryPayments.length +
    wb.palletReturns.length + wb.factoryPalletReturns.length;

  let batchId: string | null = null;
  try {
    console.log('1) UPLOAD → STAGE');
    const sum = await service.uploadAndStage(buffer, 'Smart blok.xlsx', user as never);
    batchId = sum.batch.id;
    console.log(`   batch ${batchId}  status=${sum.batch.status}`);
    console.log(`   rows: ${JSON.stringify(sum.rowsByKind)}`);
    eq('SHIPMENT qatorlari', sum.rowsByKind['SHIPMENT'], wb.shipments.length);
    eq('CLIENT_PAYMENT qatorlari', sum.rowsByKind['CLIENT_PAYMENT'], wb.clientPayments.length);
    eq('FACTORY_PAYMENT qatorlari', sum.rowsByKind['FACTORY_PAYMENT'], wb.factoryPayments.length);
    eq('PALLET_RETURN qatorlari', sum.rowsByKind['PALLET_RETURN'], wb.palletReturns.length);
    eq('FACTORY_PALLET_RETURN qatorlari', sum.rowsByKind['FACTORY_PALLET_RETURN'], wb.factoryPalletReturns.length);
    eq('to‘siq yo‘q', sum.openBlockers, 0);
    eq('aniqlanmagan mijoz nomi yo‘q', sum.pendingEntities, 0);
    eq('commitReady darhol', sum.commitReady, true);

    console.log('\n2) staging jadvallariga yozildimi?');
    eq('ImportRow soni', await prisma.importRow.count({ where: { batchId } }), wantRows);
    eq('CLIENT entity map soni', await prisma.importEntityMap.count({ where: { batchId, kind: 'CLIENT' } }),
      new Set(wb.shipments.map((s) => s.clientRaw.trim())
        .concat(wb.clientPayments.map((p) => p.clientRaw.trim()))
        .concat(wb.palletReturns.map((p) => p.clientRaw.trim()))
        .filter(Boolean)).size);
    eq('AGENT entity map soni', await prisma.importEntityMap.count({ where: { batchId, kind: 'AGENT' } }), wb.master.agents.length);
    eq('FACTORY entity map soni', await prisma.importEntityMap.count({ where: { batchId, kind: 'FACTORY' } }), wb.master.factories.length);

    console.log('\n3) PREVIEW (dry-run — bazaga yozmaydi)');
    const prev = await service.preview(batchId!);
    console.log(
      `   zavod qoldig‘i ${(+prev.factoryBalance).toLocaleString('ru-RU')}` +
      `  ·  mijozlarda poddon ${prev.pallets.clientDebt}` +
      `  ·  previewHash ${prev.previewHash.slice(0, 12)}…`,
    );
    eq('preview buyurtmalar', prev.orders, wb.shipments.length);
    eq('status → READY (previewdan keyin)', (await service.getBatch(batchId!)).batch.status, 'READY');
    // dry-run HECH NARSA yozmaganining isboti
    eq('dry-run buyurtma yozmadi', await prisma.order.count({ where: { importBatchId: batchId } }), 0);
  } finally {
    if (batchId) {
      await prisma.importBatch.delete({ where: { id: batchId } }).catch(() => {});
    }
    await prisma.$disconnect();
  }

  console.log(`\n${fails === 0 ? 'PIPELINE SMOKE O‘TDI ✓' : `${fails} ta YIQILDI ✗`}`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
