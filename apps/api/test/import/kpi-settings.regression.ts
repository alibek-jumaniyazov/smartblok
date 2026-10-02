/** Review must reject every KPI setting that the transactional writer would reject. */
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { RULES, type RuleContext } from '../../src/import/rules/rule-registry';
import { parseAgentKpiSettings } from '../../src/agents/agent-kpi.calculator';

const rule = RULES.find((r) => r.id === 'KPI_SOZLAMALARI')!;
let checks = 0;
const findings = (tax: string | null, share: string | null) => rule.run({ master: { settings: {
  palletBasePrice: null, taxPerM3: tax === null ? null : new Prisma.Decimal(tax),
  agentKpiShare: share === null ? null : new Prisma.Decimal(share),
} } } as RuleContext);
assert.deepEqual(findings(null, null), [], 'Legacy files may omit both settings'); checks++;
for (const [tax, share] of [
  ['0', '0'], ['0', '1'], ['10000', '0.3333333333333333'], ['999999999999', '0.1234567890123456789'],
  ['0.123456', '0.25'], ['10000', '0.00000000000000000001'],
]) {
  assert.deepEqual(findings(tax, share), [], `Valid settings ${tax}/${share} pass review`); checks++;
  assert.doesNotThrow(() => parseAgentKpiSettings({ taxPerM3: tax, agentShare: share })); checks++;
  const canonical = parseAgentKpiSettings({ taxPerM3: tax, agentShare: share });
  assert.deepEqual(parseAgentKpiSettings(canonical), canonical, 'Every canonical setting can be read back'); checks++;
}
for (const [tax, share] of [
  [null, '0.5'], ['10000', null], ['-1', '0.5'], ['10000', '-0.1'], ['10000', '1.000001'],
  ['1000000000000', '0.5'], ['0.0000001', '0.5'], ['10000', '0.000000000000000000001'],
  ['NaN', '0.5'], ['Infinity', '0.5'], ['10000', 'NaN'], ['10000', 'Infinity'],
]) {
  const result = findings(tax, share);
  assert.equal(result.length, 1, `Invalid settings ${tax}/${share} produce one review finding`); checks++;
  assert.equal(result[0].severity, 'BLOCK', 'Invalid KPI settings cannot reach preview or commit'); checks++;
  assert.throws(() => parseAgentKpiSettings({ taxPerM3: tax, agentShare: share })); checks++;
}
console.log(`Import KPI settings rules: ${checks} assertions passed`);
