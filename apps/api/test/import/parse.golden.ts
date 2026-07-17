/**
 * Golden fixture: parse the real «Smart blok.xlsx» and assert the totals hold.
 * Run:  npx tsx test/import/parse.golden.ts ["<abs path to xlsx>"]
 * Every expected number was recomputed directly from the workbook's cached formulas.
 */
import { Prisma } from '@prisma/client';
import { join } from 'node:path';
import { WorkbookReader } from '../../src/import/parse/workbook.reader';
import { parseJurnal, parseFactoryTransfers, parseAgentSummary } from '../../src/import/parse/jurnal.parser';
import { parseAgentSheets } from '../../src/import/parse/agent-sheet.parser';
import { normalizePlate } from '../../src/import/resolve/entity-resolver';
import { norm } from '../../src/import/resolve/normalize';

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;

export const DEFAULT_XLSX = join(__dirname, '../../../../docs/Smart blok.xlsx');

let fails = 0;
function eq(label: string, got: unknown, want: unknown) {
  const ok = String(got) === String(want);
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}: ${got}${ok ? '' : `   (kutilgan: ${want})`}`);
  if (!ok) fails++;
}
function near(label: string, got: Dec, want: number, eps = 1) {
  const ok = got.minus(want).abs().lte(eps);
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}: ${got.toFixed(3)}${ok ? '' : `   (kutilgan ≈ ${want})`}`);
  if (!ok) fails++;
}
const sumD = <T>(rows: T[], f: (r: T) => Dec | null): Dec =>
  rows.reduce((a, r) => a.plus(f(r) ?? 0), new D(0));
const sumN = <T>(rows: T[], f: (r: T) => number | null): number =>
  rows.reduce((a, r) => a + (f(r) ?? 0), 0);

async function main() {
  const xlsx = process.argv[2] ?? DEFAULT_XLSX;
  const wb = await WorkbookReader.fromFile(xlsx);

  eq('jurnal varag‘i', wb.goodsSheetName(), 'Лист1');
  eq('agent varaqlari soni', wb.agentSheetNames().length, 4);

  // ── ЛИСТ1 (jurnal) ──
  const ship = parseJurnal(wb);
  console.log('\n== ЛИСТ1 (jurnal) ==');
  eq('data rows', ship.length, 21);
  near('Σ Блок Куб (H)', sumD(ship, (r) => (r.cube === null ? null : new D(String(r.cube)))), 680.832, 0.001);
  near('Σ Сумма Приход (H×I)', sumD(ship, (r) => (r.cube !== null && r.costPrice ? new D(String(r.cube)).mul(r.costPrice) : null)), 340_416_000, 1);
  eq('Σ Поддон Шт (K)', sumN(ship, (r) => r.palletQty), 394);
  near('Σ Сумма Поддон (K×L)', sumD(ship, (r) => (r.palletQty && r.palletPrice ? r.palletPrice.mul(r.palletQty) : null)), 51_220_000, 1);
  near('Σ Сумма Продажа (R)', sumD(ship, (r) => r.saleSum), 501_414_039.36, 0.01);
  near('Σ Расход Авто (S)', sumD(ship, (r) => r.transport), 43_500_000, 1);
  eq('mijozsiz qatorlar', ship.filter((r) => !r.clientRaw).length, 0);
  eq('transport ustunida so‘z', ship.filter((r) => r.transportWord).length, 0);
  eq('hammasi «Туланди»', ship.filter((r) => /туланди/i.test(r.autoPaid)).length, 21);
  eq('agentlar jurnalda', new Set(ship.map((r) => r.agentRaw)).size, 4);
  eq('mijozlar jurnalda', new Set(ship.map((r) => r.clientRaw)).size, 9);

  // ── Zavod o‘tkazmalari («Утказилган пул») ──
  const fac = parseFactoryTransfers(wb);
  console.log('\n== УТКАЗИЛГАН ПУЛ (zavod) ==');
  eq('data rows', fac.length, 8);
  eq('Σ Сумма', sumD(fac, (r) => r.amount).toFixed(0), '262014900');
  eq('birinchi sana', fac[0]?.date?.toISOString().slice(0, 10), '2026-06-25');
  eq('oxirgi sana', fac[fac.length - 1]?.date?.toISOString().slice(0, 10), '2026-06-30');

  // ── Agent svodkasi ──
  const summ = parseAgentSummary(wb);
  console.log('\n== AGENT SVODKASI ==');
  eq('rows', summ.length, 4);
  near('Σ Расход (sotuvlar)', sumD(summ, (s) => s.sales), 501_414_039.36, 0.01);
  near('Σ Приход (to‘lovlar)', sumD(summ, (s) => s.paid), 262_014_900, 1);
  eq('Σ Паддон', sumN(summ, (s) => s.pallets), 394);

  // ── Agent daftarlari ──
  const ledgers = parseAgentSheets(wb);
  console.log('\n== AGENT DAFTARLARI ==');
  eq('daftarlar', ledgers.length, 4);
  const blocks = ledgers.flatMap((l) => l.clients);
  eq('mijoz bloklari', blocks.length, 10);
  const pays = blocks.flatMap((b) => b.payments);
  const delivs = blocks.flatMap((b) => b.deliveries);
  eq('to‘lovlar', pays.length, 7);
  eq('Σ to‘lovlar', sumD(pays, (p) => p.total).toFixed(0), '262014900');
  eq('poddon qaytarishlar', sumN(pays, (p) => p.palletReturn), 0);
  eq('daftar yetkazmalari', delivs.length, 21);
  near('Σ daftar yetkazmalari', sumD(delivs, (d) => d.total), 501_414_039.36, 0.01);

  // agent daftar raqamlari: Жамол=1, Арслон=2, Зафар=3, Шохрух=4
  const noByAgent = new Map(ledgers.map((l) => [l.agentName, l.clients[0]?.agentNo]));
  eq('Жамол 22-22 → №1', noByAgent.get('Жамол 22-22'), 1);
  eq('Арслон ога → №2', noByAgent.get('Арслон ога'), 2);
  eq('Зафар ога → №3', noByAgent.get('Зафар ога'), 3);
  eq('Шохрух ога → №4', noByAgent.get('Шохрух ога'), 4);

  // faqat to‘lov qilgan (yetkazmasiz) mijoz — oldindan to‘lov
  const fidato = blocks.find((b) => /фидато/i.test(b.clientRaw));
  eq('Фидато Гроуп: to‘lov bor, yetkazma yo‘q', `${fidato?.payments.length}/${fidato?.deliveries.length}`, '1/0');
  eq('Фидато to‘lovi', fidato?.payments[0]?.total?.toFixed(0), '22703000');
  const rustam = blocks.find((b) => /рустам/i.test(b.clientRaw));
  eq('Рустам to‘lovchisi (Примечание)', rustam?.payments[0]?.payer, '"Ифтихор" хусусий корхонаси');

  // ── O‘ZARO TEKSHIRUV: har bir daftar yetkazmasi jurnalda 1:1 topilishi kerak ──
  console.log('\n== DAFTAR ↔ JURNAL 1:1 ==');
  const key = (client: string, date: Date | null, truck: string, cube: number | null) =>
    [norm(client).key, date?.toISOString().slice(0, 10) ?? '', normalizePlate(truck), cube?.toFixed(3) ?? ''].join('|');
  const used = new Set<number>();
  let matched = 0;
  for (const b of blocks) {
    for (const d of b.deliveries) {
      const i = ship.findIndex((r, idx) => !used.has(idx) && key(r.clientRaw, r.date, r.truck, r.cube) === key(b.clientRaw, d.date, d.truck, d.cube));
      if (i >= 0) { used.add(i); matched++; }
    }
  }
  eq('mos kelgan juftliklar', matched, 21);
  eq('jurnalda daftarsiz qator', ship.length - matched, 0);

  console.log(`\n${fails === 0 ? 'HAMMA GOLDEN TEKSHIRUV O‘TDI ✓' : `${fails} ta tekshiruv YIQILDI ✗`}`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
