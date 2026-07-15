/**
 * Rule-engine golden test on the REAL workbook. The deterministic rules must find
 * exactly the anomalies the human audit did. Run:
 *   npx tsx test/import/rules.golden.ts "<abs xlsx path>"
 */
import { WorkbookReader } from '../../src/import/parse/workbook.reader';
import { parseTovar } from '../../src/import/parse/tovar.parser';
import { parseOplata } from '../../src/import/parse/oplata.parser';
import { parseOplataZavod } from '../../src/import/parse/oplata-zavod.parser';
import { parseAllClientSheets } from '../../src/import/parse/client-sheet.parser';
import { norm } from '../../src/import/resolve/normalize';
import { runRules, countByRule } from '../../src/import/rules/validate.service';
import { DEFAULT_RULES_CONFIG } from '../../src/import/rules/config';
import type { RuleContext } from '../../src/import/rules/rule-registry';

const AGENTS = ['Жамол 22-22', 'Зафар ога', 'Арслон ога', 'Шохрух ога', 'Темур', 'Темур ога', 'Сардор ога'];

let fails = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = String(got) === String(want);
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}: ${got}${ok ? '' : `   (kutilgan ${want})`}`);
  if (!ok) fails++;
};

async function main() {
  const xlsx = process.argv[2];
  if (!xlsx) throw new Error('xlsx yo‘li kerak');
  const wb = await WorkbookReader.fromFile(xlsx);

  const ctx: RuleContext = {
    shipments: parseTovar(wb),
    clientPayments: parseOplata(wb),
    factoryPayments: parseOplataZavod(wb),
    clientSheets: parseAllClientSheets(wb),
    agentKeys: new Set(AGENTS.map((a) => norm(a).key)),
    cfg: DEFAULT_RULES_CONFIG,
  };

  const findings = runRules(ctx);
  const counts = countByRule(findings);
  console.log('Topilgan xatolar (qoida → soni):');
  for (const [rule, n] of Object.entries(counts).sort()) console.log(`   ${rule}: ${n}`);

  console.log('\n== FOYDA_PODDON_QOSHILGAN (siz topgan xato) ==');
  for (const f of findings.filter((f) => f.ruleId === 'FOYDA_PODDON_QOSHILGAN')) {
    console.log(`   ${f.origin.sheetName} r${f.origin.excelRow}: ${f.currentValue} → ${f.suggestedValue}`);
  }
  const sample = (id: string) => findings.find((f) => f.ruleId === id);
  console.log('\n== namuna xabarlar ==');
  for (const id of ['MIJOZ_YOQ', 'PUL_USTUNIDA_MATN', 'MIJOZ_AGENT_NOMI', 'ZAVOD_TOLOVI_ZAVODGA_EMAS']) {
    const f = sample(id);
    if (f) console.log(`   [${f.severity}] ${id} (${f.origin.sheetName} r${f.origin.excelRow}): ${f.message}`);
  }

  console.log('\n== assertions ==');
  eq('MIJOZ_YOQ (blocker)', counts['MIJOZ_YOQ'] ?? 0, 8);
  eq('PUL_USTUNIDA_MATN «Х» (blocker)', counts['PUL_USTUNIDA_MATN'] ?? 0, 1);
  eq('FOYDA_PODDON_QOSHILGAN', counts['FOYDA_PODDON_QOSHILGAN'] ?? 0, 5);
  eq('NARX_BUTUN_SON_EMAS', counts['NARX_BUTUN_SON_EMAS'] ?? 0, 3);
  eq('MIJOZ_AGENT_NOMI', counts['MIJOZ_AGENT_NOMI'] ?? 0, 2);
  // BLOCK-severity total gates the commit button:
  const blocks = findings.filter((f) => f.severity === 'BLOCK').length;
  console.log(`   (jami TO‘SIQ: ${blocks} — bular hal qilinmaguncha "yuborish" o‘chiq)`);

  console.log(`\n${fails === 0 ? 'HAMMA QOIDA TEKSHIRUV O‘TDI ✓' : `${fails} ta YIQILDI ✗`}`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
