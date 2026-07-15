/**
 * DRY-RUN against the LIVE database (writes everything, then rolls back). Proves the
 * imported balances reconcile with the owner's «Свод Завод». THE key safety test.
 *   DATABASE_URL=… npx tsx test/import/commit.dryrun.ts "<abs xlsx path>"
 */
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { WorkbookReader } from '../../src/import/parse/workbook.reader';
import { parseTovar } from '../../src/import/parse/tovar.parser';
import { parseOplata } from '../../src/import/parse/oplata.parser';
import { parseOplataZavod } from '../../src/import/parse/oplata-zavod.parser';
import { matchName } from '../../src/import/resolve/matcher';
import { clientNameFromSheetTitle } from '../../src/import/resolve/entity-resolver';
import { runCommit } from '../../src/import/commit/import-commit.service';

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
  const prisma = new PrismaClient();

  const CANON = wb.clientSheetNames().map(clientNameFromSheetTitle);
  // owner decisions the review screen would collect (the 2 agent-name-as-client payments):
  const overrides = new Map<string, string>([
    ['Оплата|31', 'Фидато Груп'],
    ['Оплата|33', 'Ирригатсия темир бетон'],
  ]);
  const resolveClient = (raw: string, o: { sheetName: string; excelRow: number }): string => {
    const k = `${o.sheetName}|${o.excelRow}`;
    if (overrides.has(k)) return overrides.get(k)!;
    if (!raw) return 'Nomaʼlum mijoz (import)'; // the 8 blank-client trucks → placeholder
    const m = matchName(raw, CANON);
    return m.best && m.verdict !== 'none' ? m.best : raw;
  };

  console.log('DRY-RUN (hammasi yoziladi, keyin orqaga qaytariladi)…');
  const res = await runCommit(prisma, {
    batchId: randomUUID(), filename: 'dry-run', factoryName: 'Газоблок',
    shipments: parseTovar(wb), clientPayments: parseOplata(wb), factoryPayments: parseOplataZavod(wb),
    resolveClient,
  }, { dryRun: true });

  console.log('\n== KUTILAYOTGAN BAZA HOLATI (dry-run) ==');
  console.log(`  buyurtmalar: ${res.orders}`);
  console.log(`  Zavod qoldig‘i:  ${(+res.factoryBalance).toLocaleString('ru-RU')}   (Свод Завод B4 = 242 034 270)`);
  console.log(`  Sotuv jami:      ${(+res.saleTotal).toLocaleString('ru-RU')}`);
  console.log(`  Zavod tannarxi:  ${(+res.costTotal).toLocaleString('ru-RU')}`);
  console.log(`  Zavodga to‘langan: ${(+res.factoryPaidTotal).toLocaleString('ru-RU')}`);
  console.log(`  Mijozlar qarzi:  ${(+res.clientDebtTotal).toLocaleString('ru-RU')}`);
  console.log(`  Mijoz to‘lovlari: ${(+res.clientPaidTotal).toLocaleString('ru-RU')}`);
  console.log(`  Shofyor qoldig‘i: ${(+res.vehicleBalance).toLocaleString('ru-RU')}`);
  console.log(`  Poddon tashqarida: ${res.palletsOut}`);

  console.log('\n== assertions ==');
  eq('Zavod qoldig‘i = «Свод Завод» B4', res.factoryBalance, '242034270.00');
  eq('Sotuv jami (Товар R)', res.saleTotal, '2006657519.36');
  eq('Zavod tannarxi (bloklar+poddon)', res.costTotal, '1859054250.00');
  eq('Zavodga to‘langan', res.factoryPaidTotal, '2101088520.00');
  eq('Poddon tashqarida', res.palletsOut, 1630);
  const veh = Math.abs(+res.vehicleBalance);
  eq('Shofyor qoldig‘i ~0 (soxta 68.1 mln emas)', veh < 5_000_000, true);

  // prove the dry-run left NOTHING behind
  const leaked = await prisma.order.count({ where: { orderNo: { startsWith: 'DRY-' } } });
  eq('dry-run hech narsa qoldirmadi', leaked, 0);

  await prisma.$disconnect();
  console.log(`\n${fails === 0 ? 'DRY-RUN BALANS ISBOTI O‘TDI ✓ — hisob-kitob aralashmaydi' : `${fails} ta YIQILDI ✗`}`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
