/** The real September 29 workbook, production services, and an isolated local schema. */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Prisma, PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';
import { ImportService, parseWorkbook } from '../../src/import/import.service';
import { AgentKpiService } from '../../src/agents/agent-kpi.service';
import { AuditService } from '../../src/common/audit.service';
import { Dictionary } from '../../src/import/resolve/dictionary';
import { runRules } from '../../src/import/rules/validate.service';
import { resolveRulesConfig } from '../../src/import/rules/config';
import type { RequestUser } from '../../src/common/scoping';

const API = resolve(__dirname, '../..');
const D = Prisma.Decimal;
let checks = 0;
function eq(actual: unknown, expected: unknown, label: string) { assert.deepEqual(actual, expected, label); checks++; }
function near(actual: unknown, expected: unknown, label: string, tolerance = '0.15') {
  assert.ok(new D(String(actual)).minus(String(expected)).abs().lte(tolerance), `${label}: ${actual} != ${expected}`); checks++;
}

async function scenario(db: PrismaClient, databaseUrl: string) {
  const source = readFileSync(resolve(API, '../../docs/Smartblok.xlsb'));
  const workbook = XLSX.read(source, { type: 'buffer', cellFormula: true });
  const service = new ImportService(db as never, { review: async () => [] } as never);
  const actor = await db.user.create({ data: { username: 'smartblok-contract', name: 'Contract test', password: 'unusable-test-hash', role: 'ADMIN' } });
  const user: RequestUser = { userId: actor.id, username: actor.username, name: actor.name, role: actor.role, agentId: null };
  const kpi = new AgentKpiService(db as never, new AuditService(db as never));
  const previous = { taxPerM3: '9000', agentShare: '0.25' };
  await db.appSetting.create({ data: { key: 'agentKpi', value: previous, updatedBy: actor.id } });
  const staged = await service.uploadAndStage(source, 'Smartblok.xlsb', user);
  eq(staged.rowsByKind, { SHIPMENT: 548, CLIENT_PAYMENT: 248, FACTORY_PAYMENT: 70, PALLET_RETURN: 134, FACTORY_PALLET_RETURN: 17 }, 'all current workbook transactions staged');
  eq(staged.openBlockers, 0, 'current workbook has no blocking source issue');
  eq(staged.incompleteRows.length, 0, 'new source has completed the old missing row');
  const id = staged.batch.id;
  const preview = await service.preview(id, 'APPEND');
  eq(await kpi.getSettings(), previous, 'preview does not apply KPI configuration');
  eq(await db.order.count(), 0, 'preview does not persist financial data');
  eq(preview.kpiSettings?.taxPerM3, '10000', 'preview discloses imported tax');
  const committed = await service.commit(id, preview.previewHash, user, 'APPEND');
  const { previewHash: _ignored, ...expected } = preview;
  eq(committed, expected, 'preview and commit financial/configuration results match');
  eq(committed.orders, 548, 'all shipments committed');
  near(committed.saleTotal, '12105787819.914259', 'source audited sale total');
  near(committed.costTotal, '9942104394', 'corrected source cost total');
  near(committed.transportSettled, '1290596105.198', 'source transport total');
  near(committed.clientChargeable, '11115763819.943259', 'source client charge');
  near(committed.clientPaidTotal, '10963498340', 'all payment channels including refunds');
  near(committed.clientPaidPallets, '386750000', 'signed pallet settlements');
  near(committed.clientPaidGoods, '10576748340', 'goods funds after paid pallets');
  eq(committed.skipped.length, 0, 'no staged financial record silently skipped');
  const report = await kpi.report({ month: '2026-09' }, user);
  eq(report.lifetime.totals.ordersCount, 548, 'KPI counts every live shipment');
  near(report.lifetime.totals.quantityM3, 16983, 'all-time KPI volume', '0');
  near(report.monthly.totals.quantityM3, '4629.96', 'monthly KPI volume', '0');
  const fields = { quantityM3: 'C', profit: 'D', taxAmount: 'F', netProfit: 'G', agentKpi: 'H', companyProfit: 'I' } as const;
  for (const [section, start, end] of [['monthly', 10, 15], ['lifetime', 20, 25]] as const) {
    for (let row = start; row <= end; row++) {
      const name = workbook.Sheets.KPI[`B${row}`].v;
      const actual = report[section].rows.find((r) => r.agentName === name);
      assert.ok(actual, `KPI agent ${name} exists`); checks++;
      for (const [field, col] of Object.entries(fields)) near(actual[field as keyof typeof fields], workbook.Sheets.KPI[`${col}${row}`].v, `${section} ${name} ${field}`);
    }
  }
  for (const row of report.daily.rows) {
    const sourceRow = 30 + Number(row.date.slice(-2));
    for (const [field, col] of Object.entries({ quantityM3: 'B', profit: 'C', taxAmount: 'D', netProfit: 'E', agentKpi: 'F', companyProfit: 'G' })) {
      near(row[field as keyof typeof fields], workbook.Sheets.KPI[`${col}${sourceRow}`]?.v ?? 0, `daily ${row.date} ${field}`);
    }
  }

  // Use compiled Nest modules: tsx does not emit constructor injection metadata.
  process.env.DATABASE_URL = databaseUrl;
  process.env.JWT_SECRET = 'local-contract-test-only-not-a-production-secret';
  process.env.CORS_ORIGIN = 'http://localhost:4173';
  process.env.NODE_ENV = 'test';
  const { NestFactory } = require('@nestjs/core');
  const { AppModule } = require(resolve(API, 'dist/app.module.js'));
  const { ExportService } = require(resolve(API, 'dist/export/export.service.js'));
  const context = await NestFactory.createApplicationContext(AppModule, { logger: false });
  let output: Buffer;
  try { output = (await context.get(ExportService).buildWorkbook({ from: '2026-09-01', to: '2026-09-30' }, user)).buffer; }
  finally { await context.close(); }
  if (process.env.SMARTBLOK_EXPORT_OUTPUT) writeFileSync(process.env.SMARTBLOK_EXPORT_OUTPUT, output!);
  const exported = await parseWorkbook(output!);
  const findings = runRules({ ...exported, dict: Dictionary.from(exported.master), cfg: resolveRulesConfig(null) });
  eq(findings.filter((finding) => finding.severity === 'BLOCK').map((finding) => finding.message), [], 'export can be read without blocking validation errors');
  eq(exported.shipments.length, 548, 'export retains every source shipment');
  near(exported.shipments.reduce((sum, row) => sum.plus(row.saleSumDeclared ?? 0), new D(0)), committed.saleTotal, 'export sales round trip', '0');
  near(exported.shipments.reduce((sum, row) => sum.plus(row.costSumDeclared ?? 0), new D(0)), committed.costTotal, 'export costs round trip', '0');
  near(exported.clientPayments.reduce((sum, row) => sum.plus(row.totalDeclared ?? 0), new D(0)), committed.clientPaidTotal, 'export payments round trip', '0');
  near(exported.clientPayments.reduce((sum, row) => sum.plus(row.palletMoneyDeclared ?? 0), new D(0)), committed.clientPaidPallets, 'export pallet charges round trip', '0');
  const exportedBook = XLSX.read(output!, { type: 'buffer' });
  assert.ok(exportedBook.SheetNames.includes('KPI')); checks++;
  for (const [section, start] of [['monthly', 10], ['lifetime', 20]] as const) {
    for (let index = 0; index < report[section].rows.length; index++) {
      const actual = report[section].rows[index];
      eq(exportedBook.Sheets.KPI[`B${start + index}`].v, actual.agentName, `export ${section} agent name`);
      for (const [field, col] of Object.entries(fields)) {
        near(exportedBook.Sheets.KPI[`${col}${start + index}`].v, actual[field as keyof typeof fields], `export ${section} ${actual.agentName} ${field}`, '0.0001');
      }
    }
  }
  for (const [sheet, cells] of Object.entries(exportedBook.Sheets)) {
    eq(Object.entries(cells).filter(([address, cell]) => !address.startsWith('!') && cell.t === 'e').map(([address]) => address), [], `no cached formula errors in ${sheet}`);
  }

  const rolledBack = await service.rollback(id, user);
  eq(rolledBack.ledgerSum, '0.00', 'new import rollback financial conservation');
  eq(rolledBack.palletSum, 0, 'new import rollback pallet conservation');
  eq(rolledBack.cashSum, '0.00', 'new import rollback cash conservation');
  eq(await kpi.getSettings(), previous, 'rollback restores previous KPI settings');
  const after = await kpi.report({ month: '2026-09' }, user);
  eq(after.lifetime.totals.ordersCount, 0, 'rolled-back orders do not earn KPI');

  // Re-import the generated workbook into the rolled-back test database, rather
  // than checking only parser totals: FIFO, signed pallets and refunds must agree too.
  const roundtrip = await service.uploadAndStage(output!, 'Smartblok-export.xlsx', user);
  eq(roundtrip.openBlockers, 0, 'actual exported file stages without blockers');
  const againPreview = await service.preview(roundtrip.batch.id, 'APPEND');
  const again = await service.commit(roundtrip.batch.id, againPreview.previewHash, user, 'APPEND');
  for (const field of ['saleTotal', 'costTotal', 'transportSettled', 'clientChargeable', 'clientPaidTotal', 'clientPaidPallets', 'clientPaidGoods'] as const) {
    near(again[field], committed[field], `real re-import ${field}`, '0.00');
  }
  eq(again.orders, 548, 'real re-import keeps all548 shipments');
  const againKpi = await kpi.report({ month: '2026-09' }, user);
  eq(againKpi.monthly.totals, report.monthly.totals, 'real re-import preserves monthly KPI');
  eq(againKpi.lifetime.totals, report.lifetime.totals, 'real re-import preserves lifetime KPI');
  const againRollback = await service.rollback(roundtrip.batch.id, user);
  eq(againRollback.ledgerSum, '0.00', 're-import rollback ledger conservation');
  eq(againRollback.cashSum, '0.00', 're-import rollback cash conservation');
  eq(againRollback.palletSum, 0, 're-import rollback pallet conservation');
  eq(await kpi.getSettings(), previous, 're-import rollback restores earlier settings');
  console.log(`SMARTBLOK LIFECYCLE PASSED: ${checks} checks`);
}

async function main() {
  assert.ok(process.env.DATABASE_URL, 'Provide an isolated localhost PostgreSQL DATABASE_URL');
  const base = new URL(process.env.DATABASE_URL!);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname), 'Only local PostgreSQL is allowed');
  const schema = `smartblok_contract_${Date.now()}_${randomBytes(5).toString('hex')}`;
  assert.match(schema, /^smartblok_contract_\d+_[a-f0-9]{10}$/);
  const isolated = new URL(base);
  isolated.searchParams.set('schema', schema);
  isolated.searchParams.set('connection_limit', '5');
  for (const migration of readdirSync(resolve(API, 'prisma/migrations'), { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
    assert.ok(!/(?:\bpublic|"public")\s*\./i.test(readFileSync(resolve(API, 'prisma/migrations', migration.name, 'migration.sql'), 'utf8')), 'Migration must not target public schema');
  }
  const admin = new PrismaClient({ datasources: { db: { url: base.toString() } } });
  const db = new PrismaClient({ datasources: { db: { url: isolated.toString() } } });
  let created = false;
  try {
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    created = true;
    const migration = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
      cwd: API, env: { ...process.env, DATABASE_URL: isolated.toString() }, encoding: 'utf8', timeout: 120_000, windowsHide: true,
    });
    assert.equal(migration.status, 0, 'Isolated-schema migration succeeded');
    await scenario(db, isolated.toString());
  } finally {
    await db.$disconnect();
    if (created) await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.$disconnect();
  }
}
main().catch((error: unknown) => {
  console.error((error instanceof Error ? error.message : String(error)).replace(/postgres(?:ql)?:\/\/[^\s'"`]+/gi, '[redacted PostgreSQL URL]'));
  process.exitCode = 1;
});
