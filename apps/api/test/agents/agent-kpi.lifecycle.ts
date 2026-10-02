/** Real PostgreSQL KPI queries in a uniquely named disposable local schema. */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { AuditService } from '../../src/common/audit.service';
import { RequestUser } from '../../src/common/scoping';
import { AgentKpiService } from '../../src/agents/agent-kpi.service';

const API = resolve(__dirname, '../..');
let checks = 0;
function eq(actual: unknown, expected: unknown, note: string) { assert.deepEqual(actual, expected, note); checks++; }

async function run(prisma: PrismaClient) {
  const service = new AgentKpiService(prisma as never, new AuditService(prisma as never));
  const adminRow = await prisma.user.create({ data: { username: 'kpi-admin', name: 'KPI test', password: 'unusable-test-hash', role: 'ADMIN' } });
  const admin: RequestUser = { userId: adminRow.id, username: adminRow.username, name: adminRow.name, role: 'ADMIN', agentId: null };
  const old = await prisma.agent.create({ data: { name: 'Old assignment', sortNo: 1 } });
  const current = await prisma.agent.create({ data: { name: 'Current assignment', sortNo: 2 } });
  await prisma.agent.create({ data: { name: 'Zero sales', sortNo: 3 } });
  const client = await prisma.client.create({ data: { name: 'Reassigned client', agentId: current.id } });
  const fallback = await prisma.client.create({ data: { name: 'No dictionary agent' } });
  const factory = await prisma.factory.create({ data: { name: 'KPI factory' } });
  const product = await prisma.product.create({ data: { name: 'KPI blocks', factoryId: factory.id } });
  async function order(input: { no: string; date: string; clientId?: string; agentId?: string | null;
    qty?: number; gross: number; status?: 'CANCELLED' | 'NEW'; split?: boolean }) {
    return prisma.order.create({ data: {
      orderNo: input.no, date: new Date(input.date), clientId: input.clientId ?? client.id,
      agentId: input.agentId === undefined ? old.id : input.agentId, factoryId: factory.id,
      status: input.status ?? 'NEW', cancelledAt: input.status === 'CANCELLED' ? new Date(input.date) : null,
      saleTotal: input.gross + 30000, costTotal: 20000, transportCost: 10000,
      // Must not be added to workbook R = P-J-S, whatever a transport charge says.
      transportCharge: 777,
      items: { create: input.split ? [
        { productId: product.id, quantityM3: 2, actualQuantityM3: 3 },
        { productId: product.id, quantityM3: 4, actualQuantityM3: 0 },
      ] : [{ productId: product.id, quantityM3: input.qty ?? 1 }] },
    } });
  }
  const first = await order({ no: 'KPI-1', date: '2026-08-31T19:00:00Z', gross: 70000, split: true });
  await order({ no: 'KPI-2', date: '2026-08-31T18:59:59Z', gross: 40000, qty: 2 });
  await order({ no: 'KPI-3', date: '2026-09-30T18:59:59Z', gross: 25000, clientId: fallback.id });
  await order({ no: 'KPI-4', date: '2026-09-30T19:00:00Z', gross: 40000 });
  await order({ no: 'KPI-CANCELLED', date: '2026-09-15T00:00:00Z', gross: 1000000, qty: 100, status: 'CANCELLED' });
  await order({ no: 'KPI-UNASSIGNED', date: '2026-09-20T00:00:00Z', gross: 1000, qty: 0.5, clientId: fallback.id, agentId: null });
  const report = await service.report({ month: '2026-09' }, admin);
  eq(report.monthly.totals.ordersCount, 3, 'cancelled and adjacent months excluded');
  eq(report.monthly.totals.quantityM3, '4.5', 'actual volume including zero replaces planned; multi-item order counted once');
  eq(report.monthly.totals.profit, '96000', 'each order profit counted once; no transport-charge addition');
  eq(report.monthly.totals.taxAmount, '45000', 'tax based on effective delivered volume');
  eq(report.monthly.totals.netProfit, '51000', 'monthly profit after volume tax');
  eq(report.monthly.totals.agentKpi, '17000', 'exact third of monthly profit');
  eq(report.monthly.totals.companyProfit, '34000', 'company remainder reconciles');
  eq(report.monthly.rows.find((r) => r.agentId === current.id)?.profit, '70000', 'current dictionary agent wins over order snapshot');
  eq(report.monthly.rows.find((r) => r.agentId === old.id)?.profit, '25000', 'manual historical agent used when dictionary assignment missing');
  eq(report.monthly.rows.find((r) => r.agentId === null)?.netProfit, '-4000', 'unassigned loss is visible and never clamped');
  eq(report.monthly.rows.length, 4, 'zero-sale agent and unassigned row retained');
  eq(report.daily.rows[0].ordersCount, 1, 'UTC previous evening belongs to Tashkent first day');
  eq(report.daily.rows[29].ordersCount, 1, 'month final second included');
  eq(report.daily.rows.length, 30, 'exact calendar length');
  eq(report.daily.totals, report.monthly.totals, 'daily and monthly totals reconcile');
  eq(report.lifetime.totals.ordersCount, 5, 'lifetime excludes cancelled only');
  eq(report.lifetime.totals.quantityM3, '7.5', 'lifetime effective quantity');
  eq(report.lifetime.totals.profit, '176000', 'lifetime source profit');
  eq(report.availableMonths, ['2026-10', '2026-09', '2026-08'], 'month choices use local business dates');
  eq(await prisma.payment.count(), 0, 'unpaid orders still earn workbook performance KPI');

  const agentUser = { ...admin, role: 'AGENT', agentId: current.id } as RequestUser;
  const own = await service.report({ month: '2026-09' }, agentUser);
  eq(own.monthly.rows.length, 1, 'agent sees only own row');
  eq(own.monthly.totals.quantityM3, '3', 'agent scope applied to dictionary assignment');
  eq(own.lifetime.totals.ordersCount, 3, 'agent lifetime never leaks other agents');
  await assert.rejects(() => service.report({ month: '2026-09', agentId: old.id }, agentUser), (e: any) => e.getStatus?.() === 403); checks++;
  await assert.rejects(() => service.report({}, { ...agentUser, agentId: null }), (e: any) => e.getStatus?.() === 403); checks++;

  const next = await service.updateSettings({ taxPerM3: '2000', agentShare: '0.25' }, admin);
  eq(next, { taxPerM3: '2000', agentShare: '0.25' }, 'administrative settings saved atomically');
  const updated = await service.report({ month: '2026-09' }, admin);
  eq(updated.monthly.totals.taxAmount, '9000', 'saved rate drives report');
  eq(updated.monthly.totals.agentKpi, '21750', 'saved share drives report');
  eq(updated.monthly.totals.companyProfit, '65250', 'company share is always complementary');
  eq(await prisma.auditLog.count({ where: { entity: 'AppSetting', entityId: 'agentKpi' } }), 1, 'setting change has transactional audit');
  eq(await prisma.bonusTransaction.count(), 0, 'agent KPI creates no factory wallet entries');
  eq(await prisma.cashTransaction.count(), 0, 'performance calculation does not pay cash');
  eq(await prisma.ledgerEntry.count(), 0, 'KPI never changes client or factory debt');

  await prisma.client.update({ where: { id: client.id }, data: { agentId: old.id } });
  const reassigned = await service.report({ month: '2026-09' }, admin);
  eq(reassigned.monthly.rows.find((r) => r.agentId === current.id)?.profit, '0', 'dictionary reassignment updates KPI like workbook U');
  eq(reassigned.monthly.rows.find((r) => r.agentId === old.id)?.profit, '95000', 'new owner receives historical client KPI');
  eq((await prisma.order.findUniqueOrThrow({ where: { id: first.id } })).agentId, old.id, 'display attribution does not mutate order snapshots');
  const noOrders = await service.report({ month: '2028-02' }, admin);
  eq(noOrders.monthly.totals.ordersCount, 0, 'empty selected month returns zero');
  eq(noOrders.daily.rows.length, 29, 'leap month returns real calendar days');
}

async function main() {
  const url = new URL(process.env.KPI_TEST_DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:55433/postgres');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Only local PostgreSQL is allowed');
  const schema = `agent_kpi_test_${Date.now()}_${randomBytes(6).toString('hex')}`;
  assert.match(schema, /^agent_kpi_test_\d+_[a-f0-9]{12}$/);
  const isolated = new URL(url); isolated.searchParams.set('schema', schema); isolated.searchParams.set('connection_limit', '3');
  const migrations = resolve(API, 'prisma/migrations');
  for (const entry of readdirSync(migrations, { withFileTypes: true }).filter((e) => e.isDirectory())) {
    const sql = readFileSync(resolve(migrations, entry.name, 'migration.sql'), 'utf8');
    assert.ok(!/(?:\bpublic|"public")\s*\./i.test(sql), 'public-targeted migrations forbidden in test harness');
  }
  const admin = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const prisma = new PrismaClient({ datasources: { db: { url: isolated.toString() } } });
  let created = false;
  try {
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`); created = true;
    const result = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
      cwd: API, env: { ...process.env, DATABASE_URL: isolated.toString() }, encoding: 'utf8', timeout: 120000, windowsHide: true,
    });
    if (result.status !== 0) throw new Error('Disposable schema migration failed');
    eq((await prisma.$queryRaw<{ schema: string }[]>`SELECT current_schema() AS schema`)[0].schema, schema, 'exact disposable schema in use');
    await run(prisma);
    console.log(`Agent KPI lifecycle: ${checks} assertions passed`);
  } finally {
    await prisma.$disconnect();
    if (created) await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.$disconnect();
  }
}
main().catch((e) => { console.error(String(e.message ?? e).replace(/postgres(?:ql)?:\/\/[^\s'"`]+/gi, '[redacted PostgreSQL URL]')); process.exitCode = 1; });
