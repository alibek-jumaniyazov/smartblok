/**
 * Golden fixture: parse the real «Газоблок Счет.xlsx» and assert the totals hold.
 * Run:  npx tsx test/import/parse.golden.ts "<abs path to xlsx>"
 * Every expected number here was recomputed directly from the workbook's raw XML.
 */
import { Prisma } from '@prisma/client';
import { WorkbookReader } from '../../src/import/parse/workbook.reader';
import { parseTovar } from '../../src/import/parse/tovar.parser';
import { parseOplata } from '../../src/import/parse/oplata.parser';
import { parseOplataZavod } from '../../src/import/parse/oplata-zavod.parser';
import { parseAllClientSheets } from '../../src/import/parse/client-sheet.parser';

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;

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
  const xlsx = process.argv[2];
  if (!xlsx) throw new Error('xlsx yo‘li kerak: npx tsx test/import/parse.golden.ts "<path>"');
  const wb = await WorkbookReader.fromFile(xlsx);

  console.log('Sheets:', wb.sheetNames().length, '| client sheets:', wb.clientSheetNames().length);

  // ── ТОВАР ──
  const tovar = parseTovar(wb);
  console.log('\n== ТОВАР ==');
  eq('data rows', tovar.length, 88);
  near('Σ Блок Куб (H)', sumD(tovar, (r) => (r.cube === null ? null : new D(String(r.cube)))), 2817.578, 0.01);
  near('Σ Сумма Приход (H×I)', sumD(tovar, (r) => (r.cube !== null && r.costPrice ? new D(String(r.cube)).mul(r.costPrice) : null)), 1_647_154_250, 1);
  eq('Σ Поддон Шт (K)', sumN(tovar, (r) => r.palletQty), 1630);
  near('Σ Сумма Поддон (K×L)', sumD(tovar, (r) => (r.palletQty && r.palletPrice ? r.palletPrice.mul(r.palletQty) : null)), 211_900_000, 1);
  near('Σ Сумма Продажа (R)', sumD(tovar, (r) => r.saleSum), 2_006_657_519.36, 1);

  const blankClient = tovar.filter((r) => !r.clientRaw);
  eq('mijozsiz (MIJOZ_YOQ) qatorlar', blankClient.length, 8);
  const xRows = tovar.filter((r) => r.transportWord === 'Х');
  eq('transport ustunida «Х» (blocker)', xRows.length, 1);
  const klentdan = tovar.filter((r) => /клентдан/i.test(r.transportWord ?? ''));
  console.log('  · «клентдан» qatorlar:', klentdan.length);
  const bizadan = tovar.filter((r) => /бизадан/i.test(r.transportWord ?? ''));
  console.log('  · «Бизадан» qatorlar:', bizadan.length);
  console.log('  · Расход Авто raqamli jami:', sumD(tovar, (r) => r.transport).toFixed(0));

  // ── ОПЛАТА ──
  const oplata = parseOplata(wb);
  console.log('\n== ОПЛАТА ==');
  eq('data rows', oplata.length, 38);
  eq('Σ Жами сумма (R)', sumD(oplata, (r) => r.total).toFixed(0), '1509053920');

  // ── ОПЛАТА ЗАВОД ──
  const zavod = parseOplataZavod(wb);
  console.log('\n== ОПЛАТА ЗАВОД ==');
  console.log('  · data rows:', zavod.length);
  eq('Σ Сумма (B)', sumD(zavod, (r) => r.amount).toFixed(0), '2101088520');

  // ── MIJOZ VARAQLARI ──
  const sheets = parseAllClientSheets(wb);
  console.log('\n== MIJOZ VARAQLARI ==');
  eq('count', sheets.length, 24);
  const cPay = sumD(sheets, (s) => s.payTotal);
  const cGoods = sumD(sheets, (s) => s.goodsTotal);
  const cDeliv = sumN(sheets, (s) => s.palletsDelivered);
  const cRet = sumN(sheets, (s) => s.palletsReturned);
  console.log('  · Σ C5 (to‘lovlar):', cPay.toFixed(0));
  console.log('  · Σ M5 (mol):', cGoods.toFixed(0));
  console.log('  · Σ K5 (poddon berilgan):', cDeliv);
  console.log('  · Σ E5 (poddon qaytgan):', cRet);
  eq('Σ K5 poddon berilgan', cDeliv, 1416);
  eq('Σ E5 poddon qaytgan', cRet, 0);

  console.log(`\n${fails === 0 ? 'HAMMA GOLDEN TEKSHIRUV O‘TDI ✓' : `${fails} ta tekshiruv YIQILDI ✗`}`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
