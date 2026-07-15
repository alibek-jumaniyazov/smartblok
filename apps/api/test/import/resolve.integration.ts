/**
 * Parser + resolver on the REAL workbook: the owner must face a SMALL set of
 * name decisions, not one per row. Run:
 *   npx tsx test/import/resolve.integration.ts "<abs xlsx path>"
 */
import { WorkbookReader } from '../../src/import/parse/workbook.reader';
import { parseTovar } from '../../src/import/parse/tovar.parser';
import { parseOplata } from '../../src/import/parse/oplata.parser';
import { resolveClients, clientNameFromSheetTitle, RawName } from '../../src/import/resolve/entity-resolver';
import { norm } from '../../src/import/resolve/normalize';
import { ImportEntityDecision } from '@prisma/client';

const AGENTS = ['Жамол 22-22', 'Зафар ога', 'Арслон ога', 'Шохрух ога', 'Темур', 'Темур ога', 'Сардор ога'];
const agentKeys = new Set(AGENTS.map((a) => norm(a).key));

let fails = 0;
const check = (ok: boolean, label: string) => { console.log(`${ok ? '  ✓' : '  ✗'} ${label}`); if (!ok) fails++; };

async function main() {
  const xlsx = process.argv[2];
  if (!xlsx) throw new Error('xlsx yo‘li kerak');
  const wb = await WorkbookReader.fromFile(xlsx);

  // distinct client names from Товар + Оплата, minus empties & agent-names-as-client
  const counts = new Map<string, { n: number; rows: string[] }>();
  const add = (name: string, tag: string) => {
    const t = name.trim();
    if (!t || agentKeys.has(norm(t).key)) return;
    const e = counts.get(t) ?? { n: 0, rows: [] };
    e.n++; if (e.rows.length < 3) e.rows.push(tag);
    counts.set(t, e);
  };
  for (const r of parseTovar(wb)) add(r.clientRaw, `Товар r${r.origin.excelRow}`);
  for (const r of parseOplata(wb)) add(r.clientRaw, `Оплата r${r.origin.excelRow}`);

  const raws: RawName[] = [...counts].map(([name, e]) => ({ name, occurrences: e.n, sampleRows: e.rows }));
  const canonicals = wb.clientSheetNames().map((t) => ({ id: null as string | null, name: clientNameFromSheetTitle(t) }));

  const decisions = resolveClients(raws, canonicals);
  const by = (d: ImportEntityDecision) => decisions.filter((x) => x.decision === d);
  const link = by(ImportEntityDecision.LINK);
  const pending = by(ImportEntityDecision.PENDING);
  const create = by(ImportEntityDecision.CREATE);

  console.log(`Distinct raw client spellings: ${raws.length}  ·  canonical sheet-clients: ${canonicals.length}`);
  console.log(`  LINK (auto): ${link.length}  ·  PENDING (owner confirms): ${pending.length}  ·  CREATE (new client): ${create.length}`);
  console.log('\n  — PENDING (owner sees a suggestion) —');
  for (const d of pending) console.log(`    "${d.sourceName}"  →  taklif: "${d.suggestion?.targetName}" (${d.suggestion?.confidence.toFixed(2)})  [${d.sampleRows.join(', ')}]`);
  console.log('  — CREATE (genuinely new, no sheet) —');
  for (const d of create) console.log(`    "${d.sourceName}"  [${d.sampleRows.join(', ')}]`);

  console.log('\n== assertions ==');
  const ownerDecisions = pending.length; // the only names the owner MUST look at
  check(ownerDecisions <= 6, `owner name-decisions small (${ownerDecisions} ≤ 6)`);
  const find = (raw: string) => decisions.find((d) => d.sourceName === raw);
  check(find('Жасур Версал')?.decision === 'LINK' && find('Жасур Версал')?.targetName === 'Жаср Версал', 'Жасур Версал → LINK Жаср Версал');
  check(find('Гофур хазорасп')?.decision === 'LINK', 'Гофур хазорасп → LINK');
  check(find('Бунёдкор')?.decision === 'CREATE', 'Бунёдкор → CREATE (no sheet)');
  check(!!find('Нахт клиент') && find('Нахт клиент')?.decision !== 'LINK', 'Нахт клиент does NOT auto-LINK');

  console.log(`\n${fails === 0 ? 'RESOLVER INTEGRATSIYA O‘TDI ✓' : `${fails} ta YIQILDI ✗`}`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
