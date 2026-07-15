/**
 * Verifies the review-screen inline fixes actually reach the data the commit uses:
 *  - naming a client (MIJOZ_YOQ / MIJOZ_AGENT_NOMI, field=clientRaw) writes BOTH
 *    clientRaw AND resolvedClientName on the row → the order lands on that client.
 *  - correcting a number (transport, cost, …) writes the number on the row.
 *  - resolving a PENDING name variant (resolveEntity) stamps the chosen name onto
 *    every matching row and clears the commit blocker.
 *  - after all fixes, commitReady flips true and a real commit succeeds; rollback cleans up.
 *
 *   DATABASE_URL=…smartblok_test npx tsx test/import/inline-fix.e2e.ts "<abs xlsx>"
 */
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { ImportService } from '../../src/import/import.service';
import { AiReviewService } from '../../src/import/rules/ai-review.service';
import { norm } from '../../src/import/resolve/normalize';

let fails = 0;
const ok = (label: string, cond: boolean, extra = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${label}${extra ? '  ' + extra : ''}`);
  if (!cond) fails++;
};

async function main() {
  const xlsx = process.argv[2];
  if (!xlsx) throw new Error('xlsx yoʼli kerak');
  if (!/smartblok_test/.test(process.env.DATABASE_URL ?? '')) throw new Error('faqat smartblok_test DB da');
  const prisma = new PrismaClient();
  const service = new ImportService(prisma as any, new AiReviewService());
  const user = { userId: null as any, username: 't', role: 'ADMIN' as const, name: 't', agentId: null };

  console.log('1) UPLOAD → STAGE');
  const sum = await service.uploadAndStage(readFileSync(xlsx), 'inline-fix.xlsx', user as any);
  const id = sum.batch.id;
  console.log(`   batch ${id}  blockers=${sum.openBlockers} pending=${sum.pendingEntities}`);

  const rowJson = async (rowId: string) => (await prisma.importRow.findUniqueOrThrow({ where: { id: rowId } })).resolvedJson as any;

  console.log('2) MIJOZ nomini yozish (clientRaw) → resolvedClientName ham yoziladi');
  const nameIssue = await prisma.importIssue.findFirst({ where: { batchId: id, field: 'clientRaw', status: 'OPEN', rowId: { not: null } } });
  if (nameIssue) {
    await service.resolveIssue(id, nameIssue.id, { status: 'ACCEPTED', value: 'Sinov Mijoz A' }, user as any);
    const rj = await rowJson(nameIssue.rowId!);
    ok('clientRaw yozildi', rj.clientRaw === 'Sinov Mijoz A');
    ok('resolvedClientName yozildi (commit shuni ishlatadi)', rj.resolvedClientName === 'Sinov Mijoz A');
  } else {
    console.log('   (clientRaw muammosi yoʼq — oʼtkazib yuborildi)');
  }

  console.log('3) SON toʼgʼrilash (transport) → row.transport yangilanadi');
  const numIssue = await prisma.importIssue.findFirst({ where: { batchId: id, field: 'transport', status: 'OPEN', rowId: { not: null } } });
  if (numIssue) {
    await service.resolveIssue(id, numIssue.id, { status: 'ACCEPTED', value: 450000 }, user as any);
    const rj = await rowJson(numIssue.rowId!);
    ok('transport soni yozildi', Number(rj.transport) === 450000);
  } else {
    console.log('   (transport muammosi yoʼq — oʼtkazib yuborildi)');
  }

  console.log('4) PENDING nom variantini hal qilish (resolveEntity)');
  const ent = await prisma.importEntityMap.findFirst({ where: { batchId: id, decision: 'PENDING' } });
  if (ent) {
    const chosen = ent.suggestion ? (ent.suggestion as any).targetName : ent.sourceName;
    await service.resolveEntity(id, ent.id, chosen);
    const still = await prisma.importEntityMap.findUniqueOrThrow({ where: { id: ent.id } });
    ok('entity PENDING emas', still.decision !== 'PENDING', `→ ${still.decision}`);
    const rows = await prisma.importRow.findMany({ where: { batchId: id } });
    const stamped = rows.filter((r) => norm(String((r.resolvedJson as any).clientRaw ?? '')).key === ent.normalizedKey);
    ok('mos qatorlarga nom yozildi', stamped.length > 0 && stamped.every((r) => (r.resolvedJson as any).resolvedClientName === chosen), `${stamped.length} qator`);
  } else {
    console.log('   (PENDING nom yoʼq — oʼtkazib yuborildi)');
  }

  console.log('5) qolgan barcha toʼsiq + nomlarni hal qilib commitReady ni tekshirish');
  for (const i of await prisma.importIssue.findMany({ where: { batchId: id, field: 'clientRaw', status: 'OPEN' } })) {
    await service.resolveIssue(id, i.id, { status: 'ACCEPTED', value: `Sinov Mijoz ${i.id.slice(0, 4)}` }, user as any);
  }
  for (const i of await prisma.importIssue.findMany({ where: { batchId: id, severity: 'BLOCK', status: 'OPEN' } })) {
    // remaining non-name blockers (e.g. transport word) → provide a number
    await service.resolveIssue(id, i.id, { status: 'ACCEPTED', value: 0 }, user as any);
  }
  for (const e of await prisma.importEntityMap.findMany({ where: { batchId: id, decision: 'PENDING' } })) {
    await service.resolveEntity(id, e.id, e.sourceName);
  }
  const ready = await service.getBatch(id);
  ok('openBlockers = 0', ready.openBlockers === 0);
  ok('pendingEntities = 0', ready.pendingEntities === 0);
  ok('commitReady = true (preview shart emas)', ready.commitReady === true);

  console.log('6) PREVIEW → COMMIT → ROLLBACK (tozalash)');
  const prev = await service.preview(id);
  const res = await service.commit(id, prev.previewHash, user as any);
  const after = await service.getBatch(id);
  ok('status → COMMITTED', after.batch.status === 'COMMITTED', `${res.orders} buyurtma`);

  // agents from the workbook (col C «Товар» / col 2 «Оплата») must be created and linked
  const committedOrders = await prisma.order.findMany({ where: { importBatchId: id }, select: { agentId: true, clientId: true } });
  const clientsWithAgent = await prisma.client.count({ where: { agentId: { not: null }, orders: { some: { importBatchId: id } } } });
  const agentCount = await prisma.agent.count();
  ok('agentlar yaratildi', agentCount > 0, `${agentCount} ta agent`);
  ok('mijozlar agentga ulandi', clientsWithAgent > 0, `${clientsWithAgent} ta mijoz`);
  ok('buyurtmalar agentga biriktirildi', committedOrders.some((o) => o.agentId), `${committedOrders.filter((o) => o.agentId).length}/${committedOrders.length}`);
  const rb = await service.rollback(id, user as any);
  ok('rollback ledger Σ = 0', rb.ledgerSum === '0.00');

  await prisma.$disconnect();
  console.log(`\n${fails === 0 ? 'INLINE-FIX E2E OʼTDI ✓ — har bir muammo oʼsha joyda toʼgʼrilanadi va commitga yetib boradi' : `${fails} ta YIQILDI ✗`}`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
