/**
 * LIVE AI review probe (needs ANTHROPIC_API_KEY in apps/api/.env or the environment):
 * proves the Haiku structured-output call works over the parsed «Smart blok.xlsx».
 *   npx tsx test/import/ai.live.ts ["<abs xlsx>"]
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { WorkbookReader } from '../../src/import/parse/workbook.reader';
import { parseJurnal, parseFactoryTransfers, parseAgentSummary } from '../../src/import/parse/jurnal.parser';
import { parseAgentSheets } from '../../src/import/parse/agent-sheet.parser';
import { runRules } from '../../src/import/rules/validate.service';
import { DEFAULT_RULES_CONFIG } from '../../src/import/rules/config';
import { AiReviewService } from '../../src/import/rules/ai-review.service';
import { norm } from '../../src/import/resolve/normalize';

const DEFAULT_XLSX = join(__dirname, '../../../../docs/Smart blok.xlsx');

// load .env manually (no Nest bootstrap here)
const envPath = join(__dirname, '../../.env');
if (!process.env.ANTHROPIC_API_KEY && existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('ANTHROPIC_API_KEY yo‘q — AI sinovi o‘tkazib yuborildi (bu xato emas).');
    return;
  }
  const wb = await WorkbookReader.fromFile(process.argv[2] ?? DEFAULT_XLSX);
  const ledgers = parseAgentSheets(wb);
  const ctx = {
    shipments: parseJurnal(wb),
    clientPayments: ledgers.flatMap((l) => l.clients.flatMap((c) => c.payments)),
    factoryPayments: parseFactoryTransfers(wb),
    ledgers,
    agentSummary: parseAgentSummary(wb),
    agentKeys: new Set(ledgers.map((l) => norm(l.agentName).key)),
    cfg: DEFAULT_RULES_CONFIG,
  };
  const deterministic = runRules(ctx);
  console.log(`deterministik topilmalar: ${deterministic.length}`);
  const ai = new AiReviewService();
  const findings = await ai.review(ctx, deterministic);
  console.log(`AI topilmalari: ${findings.length}`);
  for (const f of findings) console.log(`  [${f.severity}] ${f.ruleId} @ ${f.origin.sheetName} r${f.origin.excelRow}: ${f.message}`);
  console.log('AI LIVE PROBE O‘TDI ✓ (chaqiruv ishladi)');
}

main().catch((e) => { console.error(e); process.exit(1); });
