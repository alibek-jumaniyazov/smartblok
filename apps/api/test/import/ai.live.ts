/**
 * LIVE Haiku check. Loads .env, does a DIRECT structured-output call (errors
 * surface, not swallowed), then the real AiReviewService on staged data.
 *   npx tsx test/import/ai.live.ts "<abs xlsx path>"
 */
import { readFileSync } from 'node:fs';

// load .env into process.env (tsx does not auto-load it)
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*(\w+)\s*=\s*"?([^"]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

import Anthropic from '@anthropic-ai/sdk';
import { WorkbookReader } from '../../src/import/parse/workbook.reader';
import { parseTovar } from '../../src/import/parse/tovar.parser';
import { parseOplata } from '../../src/import/parse/oplata.parser';
import { parseOplataZavod } from '../../src/import/parse/oplata-zavod.parser';
import { norm } from '../../src/import/resolve/normalize';
import { runRules } from '../../src/import/rules/validate.service';
import { DEFAULT_RULES_CONFIG } from '../../src/import/rules/config';
import { AiReviewService } from '../../src/import/rules/ai-review.service';
import type { RuleContext } from '../../src/import/rules/rule-registry';

const AGENTS = ['Жамол 22-22', 'Зафар ога', 'Арслон ога', 'Шохрух ога', 'Темур', 'Темур ога', 'Сардор ога'];

async function main() {
  const xlsx = process.argv[2];
  if (!xlsx) throw new Error('xlsx yo‘li kerak');
  console.log('key present:', !!process.env.ANTHROPIC_API_KEY, '· model:', process.env.ANTHROPIC_MODEL);

  const wb = await WorkbookReader.fromFile(xlsx);
  const ctx: RuleContext = {
    shipments: parseTovar(wb), clientPayments: parseOplata(wb), factoryPayments: parseOplataZavod(wb),
    clientSheets: [], agentKeys: new Set(AGENTS.map((a) => norm(a).key)), cfg: DEFAULT_RULES_CONFIG,
  };
  const findings = runRules(ctx);

  // ── 1) DIRECT structured-output probe (no try/catch — see the real error) ──
  console.log('\n1) DIRECT Haiku structured-output probe…');
  const client = new Anthropic();
  const model = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5';
  const schema = {
    type: 'object', additionalProperties: false, required: ['findings'],
    properties: { findings: { type: 'array', items: {
      type: 'object', additionalProperties: false, required: ['sheet', 'excelRow', 'severity', 'messageUz'],
      properties: {
        sheet: { type: 'string' }, excelRow: { type: 'integer' },
        severity: { type: 'string', enum: ['CONFIRM', 'WARN', 'INFO'] }, messageUz: { type: 'string' },
      },
    } } },
  };
  const params: Record<string, unknown> = {
    model, max_tokens: 2000,
    system: 'Test. Javobni sxemaga mos JSON qaytar.',
    messages: [{ role: 'user', content: 'Товар r6 da 1 m³ foyda 330000 deb yozilgan lekin 700000-500000=200000. Bir topilma qaytar (sheet=Товар, excelRow=6, severity=CONFIRM).' }],
    output_config: { format: { type: 'json_schema', schema } },
  };
  const res = (await client.messages.create(params as any)) as Anthropic.Message;
  console.log('   stop_reason:', res.stop_reason, '· usage:', JSON.stringify(res.usage));
  console.log('   content block types:', res.content.map((b) => b.type).join(', '));
  const text = res.content.filter((b) => b.type === 'text').map((b: any) => b.text).join('');
  console.log('   raw text (first 300):', text.slice(0, 300));
  const parsed = JSON.parse(text);
  console.log('   ✓ parsed findings:', parsed.findings?.length);

  // ── 2) the real service on the real staged data ──
  console.log('\n2) AiReviewService.review() on real data (deterministic already found', findings.length, ')…');
  const ai = new AiReviewService();
  console.log('   enabled:', ai.enabled);
  const aiFindings = await ai.review(ctx, findings);
  console.log(`   🤖 AI qo‘shimcha topilmalar: ${aiFindings.length}`);
  for (const f of aiFindings.slice(0, 8)) console.log(`     [${f.severity}] ${f.ruleId} (${f.origin.sheetName} r${f.origin.excelRow}): ${f.message}`);

  console.log('\nAI JONLI ISHLAYAPTI ✓');
}

main().catch((e) => { console.error('AI XATO:', e?.message ?? e); if (e?.response?.data) console.error(JSON.stringify(e.response.data)); process.exit(1); });
