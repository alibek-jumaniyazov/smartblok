/** Workbook KPI controls + financial and calendar edge cases; no database or live writes. */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import * as XLSX from 'xlsx';
import { Prisma } from '@prisma/client';
import {
  AgentKpiAggregate, buildAgentKpiReport, calculateAgentKpi, DEFAULT_AGENT_KPI_SETTINGS,
  parseAgentKpiSettings,
} from '../../src/agents/agent-kpi.calculator';
import { AgentKpiService } from '../../src/agents/agent-kpi.service';
import { RequestUser } from '../../src/common/scoping';

const D = Prisma.Decimal;
const workbook = XLSX.readFile(resolve(__dirname, '../../../../docs/Smartblok.xlsb'), { cellDates: false });
const source = workbook.Sheets['Товар'];
const control = workbook.Sheets.KPI;
const settingSheet = workbook.Sheets['Кўрсаткичлар'];
let checks = 0;
function eq(actual: unknown, expected: unknown, note: string) {
  assert.deepEqual(actual, expected, note); checks++;
}
function close(actual: string, expected: number | string, note: string) {
  assert.ok(new D(actual).minus(expected).abs().lte('0.0001'), `${note}: ${actual} != ${expected}`); checks++;
}
const settings = parseAgentKpiSettings({ taxPerM3: settingSheet.B5.v, agentShare: settingSheet.B6.v });
eq(settings, DEFAULT_AGENT_KPI_SETTINGS, 'workbook 10000 tax and exact third normalize correctly');
const agents = Array.from({ length: 6 }, (_, i) => ({
  id: `agent-${i}`, name: String(control[`B${i + 10}`].v), sortNo: i + 1,
}));
const names = new Map(agents.map((a) => [a.name, a.id]));
const aggregates: AgentKpiAggregate[] = [];
const lastRow = XLSX.utils.decode_range(source['!ref']!).e.r + 1;
for (let row = 4; row <= lastRow; row++) {
  const quantity = source[`H${row}`]?.v;
  if (typeof quantity !== 'number' || quantity <= 0) continue;
  const serial = source[`E${row}`]?.v;
  assert.equal(typeof serial, 'number', `E${row} has an Excel date`);
  const date = XLSX.SSF.parse_date_code(serial);
  assert.ok(date);
  const key = `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
  const name = String(source[`U${row}`]?.v ?? '');
  assert.ok(names.has(name), `U${row} is present in the source agent dictionary`);
  aggregates.push({ agentId: names.get(name)!, date: key, ordersCount: 1,
    quantityM3: String(quantity), profit: String(source[`R${row}`]?.v) });
}
eq(aggregates.length, 548, 'all 548 source shipments are accounted for');
const report = buildAgentKpiReport('2026-09', settings, agents, aggregates);
eq(report.monthly.rows.length, 6, 'zero-sale agent remains visible');
eq(report.daily.rows.length, 30, 'September has 30 real calendar days, no blank day 31');
eq(report.availableMonths, ['2026-09', '2026-08', '2026-07', '2026-06'], 'all source months included');
eq(report.lifetime.from, '2026-06-24', 'source lifetime start');
eq(report.lifetime.to, '2026-09-26', 'source lifetime end');
const metricColumns = { quantityM3: 'C', profit: 'D', taxAmount: 'F', netProfit: 'G', agentKpi: 'H', companyProfit: 'I' } as const;
for (let i = 0; i < 6; i++) {
  for (const [metric, column] of Object.entries(metricColumns)) {
    close(report.monthly.rows[i][metric as keyof typeof metricColumns], control[`${column}${i + 10}`].v,
      `${agents[i].name} September ${metric}`);
    close(report.lifetime.rows[i][metric as keyof typeof metricColumns], control[`${column}${i + 20}`].v,
      `${agents[i].name} lifetime ${metric}`);
  }
}
for (const [metric, column] of Object.entries(metricColumns)) {
  close(report.monthly.totals[metric as keyof typeof metricColumns], control[`${column}16`].v, `September total ${metric}`);
  close(report.lifetime.totals[metric as keyof typeof metricColumns], control[`${column}26`].v, `lifetime total ${metric}`);
}
const dailyColumns = { quantityM3: 'B', profit: 'C', taxAmount: 'D', netProfit: 'E', agentKpi: 'F', companyProfit: 'G' } as const;
for (let i = 0; i < 30; i++) {
  for (const [metric, column] of Object.entries(dailyColumns)) {
    close(report.daily.rows[i][metric as keyof typeof dailyColumns], control[`${column}${i + 31}`].v, `September day ${i + 1} ${metric}`);
  }
}
eq(report.monthly.totals, report.daily.totals, 'monthly and daily totals reconcile');

// Independent fixed controls, rather than trusting a workbook's cached formula alone.
close(report.monthly.totals.quantityM3, '4629.96', 'September fixed quantity');
close(report.monthly.totals.profit, '194974122.001192', 'September fixed gross profit');
close(report.lifetime.totals.quantityM3, '16983', 'lifetime fixed quantity');
close(report.lifetime.totals.profit, '873087320.7162592', 'lifetime fixed gross profit');
close(report.lifetime.totals.taxAmount, '169830000', 'lifetime fixed tax');

const negative = calculateAgentKpi('1', '9000', settings, 1);
eq(negative.netProfit, '-1000', 'volume tax can exceed gross profit');
assert.ok(new D(negative.agentKpi).lt(0)); checks++;
eq(new D(negative.agentKpi).plus(negative.companyProfit).toString(), negative.netProfit, 'negative shares reconcile exactly');
eq(calculateAgentKpi(1, -1000, { taxPerM3: '0', agentShare: '0' }).companyProfit, '-1000', 'zero share and negative gross preserved');
eq(calculateAgentKpi(1, 12000, { taxPerM3: '10000', agentShare: '1' }).companyProfit, '0', '100% agent share leaves zero company amount');
eq(calculateAgentKpi('0.001', '1', { taxPerM3: '0.000001', agentShare: '0.25' }).taxAmount, '1e-9', 'fractional rate and quantity are not rounded per shipment');
eq(buildAgentKpiReport('2028-02', settings, [], []).daily.rows.length, 29, 'leap February');
eq(buildAgentKpiReport('2027-02', settings, [], []).daily.rows.length, 28, 'non-leap February');
eq(buildAgentKpiReport('2026-12', settings, [], []).daily.rows.length, 31, '31-day month');
for (const month of ['2026-00', '2026-13', '2026-9', '2026-09-01', 'invalid']) {
  assert.throws(() => buildAgentKpiReport(month, settings, [], [])); checks++;
}
for (const bad of [null, {}, { taxPerM3: -1, agentShare: 0.5 }, { taxPerM3: 1, agentShare: 1.01 },
  { taxPerM3: 1, agentShare: -0.1 }, { taxPerM3: 'NaN', agentShare: 0.5 },
  { taxPerM3: Infinity, agentShare: 0.5 }, { taxPerM3: '0.0000001', agentShare: 0.5 },
  { taxPerM3: 1, agentShare: null }, { taxPerM3: ' ', agentShare: 0.5 }]) {
  assert.throws(() => parseAgentKpiSettings(bad)); checks++;
}
const scoped = buildAgentKpiReport('2026-09', settings, agents, aggregates, 'agent-0');
eq(scoped.monthly.rows.length, 1, 'agent scope hides other agent rows');
eq(scoped.monthly.totals, Object.fromEntries(Object.keys(scoped.monthly.totals)
  .map((k) => [k, report.monthly.rows[0][k as keyof typeof report.monthly.totals]])), 'agent scope totals contain only their sales');
const unassigned = buildAgentKpiReport('2026-09', settings, [], [
  { agentId: null, date: '2026-09-01', quantityM3: 1, profit: 12000, ordersCount: 1 },
]);
eq(unassigned.monthly.rows[0].agentId, null, 'unassigned shipment is disclosed');
eq(unassigned.monthly.rows[0].agentKpi, unassigned.daily.totals.agentKpi, 'unassigned volumes reconcile with the daily table');

// An unlinked AGENT must never fall through to the office-wide query.
async function accessChecks() {
  const service = new AgentKpiService({ $transaction: () => { throw new Error('unscoped database query'); } } as never, {} as never);
  const user: RequestUser = { userId: 'user', username: 'agent', name: 'Agent', role: 'AGENT', agentId: null };
  await assert.rejects(() => service.report({}, user), (e: any) => e.getStatus?.() === 403); checks++;
  await assert.rejects(() => service.report({ agentId: 'other' }, { ...user, agentId: 'own' }), (e: any) => e.getStatus?.() === 403); checks++;
  await assert.rejects(() => service.updateSettings(settings, user), (e: any) => e.getStatus?.() === 403); checks++;
}
accessChecks().then(() => console.log(`Agent KPI regression: ${checks} checks passed`)).catch((e) => { console.error(e); process.exitCode = 1; });
