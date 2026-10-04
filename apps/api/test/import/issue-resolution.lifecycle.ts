/**
 * Real workbook review corrections in a freshly migrated LOCAL disposable schema.
 * Prices chosen below are hypothetical test inputs, never guesses for a live import.
 * Usage: npx tsx test/import/issue-resolution.lifecycle.ts [workbook.xlsx]
 */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { ImportService } from '../../src/import/import.service';
import type { RequestUser } from '../../src/common/scoping';

const API = resolve(__dirname, '../..');
const workbook = resolve(process.argv[2] ?? resolve(API, '../../docs/Smart blok.xlsx'));
let checks = 0;
function eq(actual: unknown, expected: unknown, note: string) { assert.deepEqual(actual, expected, note); checks++; }
async function rejected(action: () => Promise<unknown>, status = 400) {
  await assert.rejects(action, (error: any) => error?.getStatus?.() === status); checks++;
}

async function run(prisma: PrismaClient) {
  const ai = { review: async () => [] };
  const user = { userId: null, username: 'isolated-review', role: 'ADMIN', name: 'Review fixture', agentId: null } as unknown as RequestUser;
  const service = new ImportService(prisma as never, ai as never);
  const staged = await service.uploadAndStage(readFileSync(workbook), 'source-review-fixture.xlsx', user);
  const id = staged.batch.id;
  const issues = await prisma.importIssue.findMany({ where: { batchId: id, severity: 'BLOCK' } });
  eq(issues.length, 5, 'source has exactly five unresolved prices/transport decisions');
  const rows = await service.listRows(id, 'SHIPMENT');
  const ship = (number: number) => rows.find((r) => r.excelRow === number)!;
  const issue = (number: number, field: string) => issues.find((i) => i.rowId === ship(number).id && i.field === field)!;
  const sale = issue(543, 'salePrice'), transport = issue(543, 'transportPayerRaw');
  assert.ok(sale && transport, 'real O543 and Q543 issues are present'); checks++;
  const reviewIssues = await service.listIssues(id);
  const priceReview = reviewIssues.find((i) => i.id === sale.id)!;
  eq(priceReview.guidance?.sourceCell, 'Товар!O543', 'review exposes actual source price coordinate');
  eq(priceReview.context?.agentName, 'Шохрух ога', 'review identifies the responsible agent');
  eq(priceReview.context?.factoryName, 'Ментора', 'review identifies the actual supplier');
  eq(priceReview.sourceValue, null, 'review does not invent the missing original sale price');
  eq(reviewIssues.find((i) => i.id === transport.id)?.guidance?.sourceCell, 'Товар!Q543', 'transport decision shows its own source coordinate');
  const sourceBatch = await prisma.importBatch.findUniqueOrThrow({ where: { id } });
  const settings = (sourceBatch.stats as any).master.settings;
  eq(staged.sourceSettings, {
    palletPriceDefault: settings.palletBasePrice, taxPerM3: settings.taxPerM3, agentShare: settings.agentKpiShare,
  }, 'summary discloses exact imported settings');
  eq((sourceBatch.stats as any).sourceLayout.SHIPMENT.columns.salePrice, 'O', 'source column mapping survives staging');
  const snapshot = async () => ({
    batch: await prisma.importBatch.findUniqueOrThrow({ where: { id } }),
    row: await prisma.importRow.findUniqueOrThrow({ where: { id: ship(543).id } }),
    issues: await prisma.importIssue.findMany({ where: { batchId: id }, orderBy: { id: 'asc' } }),
  });
  await prisma.importBatch.update({ where: { id }, data: {
    status: 'READY', previewHash: 'previous-preview', preview: { marker: 'unchanged on rejection' }, previewAt: new Date(),
  } });
  const before = await snapshot();
  for (const entry of issues) {
    await rejected(() => service.resolveIssue(id, entry.id, { status: 'IGNORED' }, user));
    await rejected(() => service.resolveIssue(id, entry.id, { status: 'ACCEPTED' }, user));
    await rejected(() => service.resolveIssue(id, entry.id, { status: 'EDITED' }, user));
  }
  for (const value of [null, '', '0', '-1', 'NaN', 'Infinity', true, '1 000', '650000xyz']) {
    await rejected(() => service.resolveIssue(id, sale.id, { status: 'EDITED', value }, user));
  }
  for (const value of ['', 'Омбор', 'Mijoz', 'Seller', false]) {
    await rejected(() => service.resolveIssue(id, transport.id, { status: 'EDITED', value }, user));
  }
  for (const patch of [
    { salePrice: '0' }, { salePrice: '-1' }, { cube: 0 }, { cube: '1.0001' },
    { transportCost: '-1' }, { palletQty: '0.5' }, { transportPayerRaw: 'Омбор' },
    { date: '2026-02-30' }, { origin: { sheetName: 'spoofed', excelRow: 1 } },
  ]) await rejected(() => service.patchRow(id, ship(543).id, patch));
  eq(await snapshot(), before, 'all failed decisions preserve source, issues and previous preview atomically');

  // A late failure after the row UPDATE must roll back the update and invalidation.
  const originalSync = (service as any).syncBlockingIssues;
  (service as any).syncBlockingIssues = async () => { throw new Error('Injected late transaction failure'); };
  await assert.rejects(() => service.patchRow(id, ship(543).id, { salePrice: '650000' }), /Injected late/); checks++;
  (service as any).syncBlockingIssues = originalSync;
  eq(await snapshot(), before, 'late failure cannot leave a changed row or a cleared preview');

  await service.patchRow(id, ship(543).id, { salePrice: '650000' });
  const corrected = await snapshot();
  eq((corrected.row.resolvedJson as any).salePrice, '650000', 'valid price saved exactly');
  eq(corrected.row.parsedJson, before.row.parsedJson, 'uploaded source remains unchanged');
  eq(corrected.row.status, 'PENDING', 'other missing field keeps this row pending');
  assert.ok(corrected.row.editedAt); checks++;
  eq(corrected.batch.previewHash, null, 'successful correction invalidates old confirmation');
  eq(corrected.batch.preview, null, 'successful correction clears stale preview values');
  eq(corrected.batch.previewAt, null, 'successful correction clears stale preview time');
  eq(corrected.issues.find((i) => i.id === sale.id)!.status, 'EDITED', 'raw row correction closes the corrected price issue');
  eq(corrected.issues.find((i) => i.id === transport.id)!.status, 'OPEN', 'unrelated transport issue remains open');
  const priceAfter = (await service.listIssues(id)).find((i) => i.id === sale.id)!;
  eq(priceAfter.sourceValue, null, 'source price remains blank after a staged correction');
  eq(priceAfter.effectiveValue, '650000', 'review identifies the actual corrected price');
  eq((await service.getBatch(id)).openBlockers, 4, 'summary reflects actual unresolved fields');
  await service.resolveIssue(id, sale.id, { status: 'ACCEPTED' }, user);
  eq((await service.getBatch(id)).openBlockers, 4, 'already repaired issue can be acknowledged without new value');

  // Two field edits on the same row serialize; neither overwrites the other.
  await Promise.all([
    service.resolveIssue(id, issue(544, 'salePrice').id, { status: 'EDITED', value: '660000' }, user),
    service.resolveIssue(id, issue(544, 'transportPayerRaw').id, { status: 'EDITED', value: 'Сотувчи' }, user),
  ]);
  const concurrent = await prisma.importRow.findUniqueOrThrow({ where: { id: ship(544).id } });
  eq((concurrent.resolvedJson as any).salePrice, '660000', 'concurrent price edit is retained');
  eq((concurrent.resolvedJson as any).transportPayerRaw, 'Сотувчи', 'concurrent transport edit is retained');
  eq(concurrent.status, 'READY', 'both validated fields make the row ready');

  // Accepted suggestion is written, with the actual applied value recorded in audit.
  await prisma.importIssue.update({ where: { id: transport.id }, data: { suggestedValue: 'Клиент' } });
  const accepted = await service.resolveIssue(id, transport.id, { status: 'ACCEPTED' }, user);
  eq(accepted.resolvedValue, 'Клиент', 'accepted suggestion records the actual applied value');
  await service.resolveIssue(id, issue(563, 'salePrice').id, { status: 'EDITED', value: '670000' }, user);
  eq((await service.getBatch(id)).openBlockers, 0, 'all five explicit decisions clear source blockers');
  eq((await service.getBatch(id)).commitReady, true, 'summary becomes ready only after all values are valid');
  const input = await (service as any).buildCommitInput(id);
  eq(input.shipments.find((s: any) => s.origin.excelRow === 543).salePrice.toFixed(), '650000', 'commit reads corrected price');
  eq(input.shipments.find((s: any) => s.origin.excelRow === 543).transportPayerRaw, 'Клиент', 'commit reads confirmed transport responsibility');
  await rejected(() => service.patchRow(id, ship(543).id, { salePrice: '1', transportCost: '2000000' }));
  eq((await service.getBatch(id)).openBlockers, 0, 'derived client-charge error cannot replace valid data');

  // Nonblocking acknowledgements, including accounting policy confirmations, stay supported.
  for (const severity of ['WARN', 'CONFIRM'] as const) for (const status of ['ACCEPTED', 'IGNORED'] as const) {
    const advisory = await prisma.importIssue.create({ data: {
      batchId: id, severity, ruleId: 'TEST_OFFBOOK_CONFIRMATION', message: 'Fixture policy confirmation',
    } });
    eq((await service.resolveIssue(id, advisory.id, { status }, user)).status, status, `${severity} may be ${status} without an invented value`);
  }

  // Legacy closed blockers reopen when their persisted row is still invalid.
  await prisma.importRow.update({ where: { id: ship(563).id }, data: {
    resolvedJson: { ...(ship(563).resolvedJson as any), salePrice: null },
  } });
  await prisma.importIssue.update({ where: { id: issue(563, 'salePrice').id }, data: { status: 'IGNORED' } });
  await service.patchRow(id, ship(543).id, { note: 'Fixture correction audit' });
  eq((await prisma.importIssue.findUniqueOrThrow({ where: { id: issue(563, 'salePrice').id } })).status, 'OPEN', 'invalid legacy closed blocker reopens');
  eq((await service.getBatch(id)).commitReady, false, 'legacy invalid data cannot appear ready after an edit');
  await service.resolveIssue(id, issue(563, 'salePrice').id, { status: 'EDITED', value: '670000' }, user);

  // A commit that read a preview before an edit may not pass its later gate.
  await prisma.importBatch.update({ where: { id }, data: { status: 'READY', previewHash: 'race-token', preview: { importMode: 'APPEND' } } });
  let started!: () => void, resume!: () => void;
  const atGate = new Promise<void>((resolve) => { started = resolve; });
  const release = new Promise<void>((resolve) => { resume = resolve; });
  const gated = prisma.$extends({ query: { importBatch: { async updateMany({ args, query }) {
    if (args.data.status === 'COMMITTING') { started(); await release; }
    return query(args);
  } } } });
  const racingService = new ImportService(gated as never, ai as never);
  const commitAttempt = rejected(() => racingService.commit(id, 'race-token', user), 409);
  await atGate;
  try { await service.patchRow(id, ship(543).id, { note: 'Edited after commit read its old preview' }); }
  finally { resume(); }
  await commitAttempt;
  eq((await prisma.importBatch.findUniqueOrThrow({ where: { id } })).status, 'DRAFT', 'stale concurrent commit leaves edited batch as draft');

  // Keep the real preview path small while exercising the edit-at-final-save race.
  const previewBatch = await prisma.importBatch.create({ data: {
    filename: 'one-row-preview-race.xlsx', status: 'DRAFT', stats: sourceBatch.stats as any, rulesSnapshot: sourceBatch.rulesSnapshot as any,
  } });
  const { id: originalRowId, createdAt: originalCreatedAt, ...rowData } = await prisma.importRow.findUniqueOrThrow({ where: { id: ship(543).id } });
  const previewRow = await prisma.importRow.create({ data: { ...rowData as any, batchId: previewBatch.id } });
  const maps = await prisma.importEntityMap.findMany({ where: { batchId: id } });
  for (const { id: originalId, ...data } of maps) await prisma.importEntityMap.create({ data: { ...data as any, batchId: previewBatch.id } });
  let previewReady!: () => void, finishPreview!: () => void;
  const beforeSave = new Promise<void>((resolve) => { previewReady = resolve; });
  const allowSave = new Promise<void>((resolve) => { finishPreview = resolve; });
  const previewGated = prisma.$extends({ query: { importBatch: { async updateMany({ args, query }) {
    if (args.data.status === 'READY') { previewReady(); await allowSave; }
    return query(args);
  } } } });
  const previewService = new ImportService(previewGated as never, ai as never);
  const previewAttempt = rejected(() => previewService.preview(previewBatch.id), 409);
  await beforeSave;
  try { await service.patchRow(previewBatch.id, previewRow.id, { salePrice: '675000' }); }
  finally { finishPreview(); }
  await previewAttempt;
  const racedPreview = await prisma.importBatch.findUniqueOrThrow({ where: { id: previewBatch.id } });
  eq(racedPreview.status, 'DRAFT', 'old computed preview cannot replace a newer row edit');
  eq(racedPreview.previewHash, null, 'old computed preview cannot mint a valid confirmation token');
  const freshPreview = await service.preview(previewBatch.id);
  assert.ok(freshPreview.previewHash); checks++;
  eq(await prisma.order.count(), 0, 'actual preview rolls its business writes back');

  const map = maps.find((m) => m.kind === 'CLIENT' && m.sourceName === (ship(543).resolvedJson as any).clientRaw)!;
  assert.ok(map); checks++;
  await service.resolveEntity(id, map.id, `${map.sourceName} — fixture name`);
  const afterEntity = await prisma.importRow.findUniqueOrThrow({ where: { id: ship(543).id } });
  eq((afterEntity.resolvedJson as any).resolvedClientName, `${map.sourceName} — fixture name`, 'entity resolution stamps actual commit routing');
  eq((await service.getBatch(id)).commitReady, true, 'valid entity correction preserves resolved prices');

  for (const status of ['COMMITTING', 'COMMITTED', 'ROLLED_BACK'] as const) {
    await prisma.importBatch.update({ where: { id }, data: { status } });
    await rejected(() => service.patchRow(id, ship(543).id, { salePrice: '680000' }), 409);
    await rejected(() => service.resolveIssue(id, sale.id, { status: 'EDITED', value: '680000' }, user), 409);
  }
  eq(await prisma.order.count(), 0, 'review checks never import business orders');
  eq(await prisma.ledgerEntry.count(), 0, 'review checks never write the ledger');
}

async function main() {
  const configured = process.env.IMPORT_REVIEW_TEST_DATABASE_URL ?? process.env.DATABASE_URL ??
    readFileSync(resolve(API, '.env'), 'utf8').match(/^\s*DATABASE_URL\s*=\s*(.+)\s*$/m)?.[1]?.trim().replace(/^(['"])(.*)\1$/, '$2');
  assert.ok(configured, 'Local DATABASE_URL is required');
  const url = new URL(configured);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Only local PostgreSQL is allowed');
  const schema = `import_review_test_${Date.now()}_${randomBytes(6).toString('hex')}`;
  assert.match(schema, /^import_review_test_\d+_[a-f0-9]{12}$/);
  const isolated = new URL(url); isolated.searchParams.set('schema', schema); isolated.searchParams.set('connection_limit', '3');
  for (const entry of readdirSync(resolve(API, 'prisma/migrations'), { withFileTypes: true }).filter((e) => e.isDirectory())) {
    const sql = readFileSync(resolve(API, 'prisma/migrations', entry.name, 'migration.sql'), 'utf8');
    assert.ok(!/(?:\bpublic|"public")\s*\./i.test(sql), 'Public-targeted migrations forbidden in isolated tests');
  }
  const admin = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const prisma = new PrismaClient({ datasources: { db: { url: isolated.toString() } }, transactionOptions: { maxWait: 30_000, timeout: 120_000 } });
  let created = false;
  try {
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`); created = true;
    const result = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
      cwd: API, env: { ...process.env, DATABASE_URL: isolated.toString() }, encoding: 'utf8', timeout: 120_000, windowsHide: true,
    });
    if (result.status !== 0) throw new Error('Disposable schema migration failed');
    eq((await prisma.$queryRaw<{ schema: string }[]>`SELECT current_schema() AS schema`)[0].schema, schema, 'exact disposable schema used');
    await run(prisma);
    console.log(`Import issue resolution lifecycle: ${checks} assertions passed`);
  } finally {
    await prisma.$disconnect();
    if (created) await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.$disconnect();
  }
}
main().catch((error) => { console.error(String(error.message ?? error).replace(/postgres(?:ql)?:\/\/[^\s'"`]+/gi, '[redacted PostgreSQL URL]')); process.exitCode = 1; });
