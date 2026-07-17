/**
 * DRY-RUN against the LIVE database (writes everything, then rolls back). Proves the
 * imported balances reconcile with the workbook's own totals. THE key safety test.
 *   npx tsx test/import/commit.dryrun.ts ["<abs xlsx path>"]
 *
 * Expected numbers (recomputed from «Smart blok.xlsx» — the owner's own model):
 *   sotuv (Σ Сумма Продажа, 2 xona)      = 501 414 039.36
 *   zavod tannarxi (FAQAT bloklar, Лист1 J) = 340 416 000  — poddon puli zavod qarziga
 *     KIRMAYDI (poddonlar naturada qaytariladigan depozit; birlikda hisoblanadi)
 *   zavodga to‘langan / mijoz to‘lovlari = 262 014 900 (pul to‘liq zavodga o‘tgan)
 *   zavod qoldig‘i = 262 014 900 − 340 416 000 = −78 401 100  (= Лист1 «Завод» bloki)
 *   mijozlar qarzi = 501 414 039.36 − 262 014 900 = 239 399 139.36  (= Лист1 «Ост» jami)
 */
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { WorkbookReader } from '../../src/import/parse/workbook.reader';
import { parseJurnal, parseFactoryTransfers } from '../../src/import/parse/jurnal.parser';
import { parseAgentSheets } from '../../src/import/parse/agent-sheet.parser';
import { matchName } from '../../src/import/resolve/matcher';
import { norm } from '../../src/import/resolve/normalize';
import { runCommit } from '../../src/import/commit/import-commit.service';

const DEFAULT_XLSX = join(__dirname, '../../../../docs/Smart blok.xlsx');

let fails = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = String(got) === String(want);
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}: ${got}${ok ? '' : `   (kutilgan ${want})`}`);
  if (!ok) fails++;
};

async function main() {
  const wb = await WorkbookReader.fromFile(process.argv[2] ?? DEFAULT_XLSX);
  const prisma = new PrismaClient();

  const ledgers = parseAgentSheets(wb);
  const CANON = [...new Map(ledgers.flatMap((l) => l.clients.map((c) => [norm(c.clientRaw).key, c.clientRaw] as const))).values()];
  const agentByClientKey = new Map(ledgers.flatMap((l) => l.clients.map((c) => [norm(c.clientRaw).key, l.agentName] as const)));
  const agentNoByName = new Map(ledgers.map((l) => [l.agentName, l.clients.find((c) => c.agentNo != null)?.agentNo ?? null] as const));

  const resolveClient = (raw: string): string => {
    if (!raw) return 'Nomaʼlum mijoz (import)';
    const m = matchName(raw, CANON);
    return m.best && m.verdict !== 'none' ? m.best : raw;
  };

  console.log('DRY-RUN (hammasi yoziladi, keyin orqaga qaytariladi)…');
  const res = await runCommit(prisma, {
    batchId: randomUUID(), filename: 'dry-run', factoryName: 'Газоблок',
    shipments: parseJurnal(wb),
    clientPayments: ledgers.flatMap((l) => l.clients.flatMap((c) => c.payments)),
    factoryPayments: parseFactoryTransfers(wb),
    resolveClient,
    agentForClient: (name) => agentByClientKey.get(norm(name).key) ?? null,
    agentSortNo: (name) => agentNoByName.get(name) ?? null,
  }, { dryRun: true });

  console.log('\n== KUTILAYOTGAN BAZA HOLATI (dry-run) ==');
  console.log(`  buyurtmalar: ${res.orders}`);
  console.log(`  Sotuv jami:        ${(+res.saleTotal).toLocaleString('ru-RU')}`);
  console.log(`  Zavod tannarxi:    ${(+res.costTotal).toLocaleString('ru-RU')}  (bloklar + poddon)`);
  console.log(`  Zavodga to‘langan: ${(+res.factoryPaidTotal).toLocaleString('ru-RU')}`);
  console.log(`  Zavod qoldig‘i:    ${(+res.factoryBalance).toLocaleString('ru-RU')}`);
  console.log(`  Mijoz to‘lovlari:  ${(+res.clientPaidTotal).toLocaleString('ru-RU')}`);
  console.log(`  Mijozlar qarzi:    ${(+res.clientDebtTotal).toLocaleString('ru-RU')}  (Лист1 «Ост» jami)`);
  console.log(`  Shofyor qoldig‘i:  ${(+res.vehicleBalance).toLocaleString('ru-RU')}`);
  console.log(`  Poddon tashqarida: ${res.palletsOut}`);

  console.log('\n== assertions ==');
  eq('buyurtmalar (21 mashina)', res.orders, 21);
  eq('Sotuv jami (Лист1 R)', res.saleTotal, '501414039.36');
  eq('Zavod tannarxi (faqat bloklar, Лист1 J)', res.costTotal, '340416000.00');
  eq('Zavodga to‘langan («Утказилган пул»)', res.factoryPaidTotal, '262014900.00');
  eq('Mijoz to‘lovlari (daftarlar)', res.clientPaidTotal, '262014900.00');
  eq('Zavod qoldig‘i = Лист1 «Завод» bloki', res.factoryBalance, '-78401100.00');
  eq('Mijozlar qarzi = Лист1 «Ост» jami', res.clientDebtTotal, '239399139.36');
  eq('Shofyor qoldig‘i 0 (hammasi «Туланди»)', res.vehicleBalance, '0.00');
  eq('Poddon tashqarida', res.palletsOut, 394);

  // prove the dry-run left NOTHING behind
  const leaked = await prisma.order.count({ where: { orderNo: { startsWith: 'DRY-' } } });
  eq('dry-run hech narsa qoldirmadi', leaked, 0);

  await prisma.$disconnect();
  console.log(`\n${fails === 0 ? 'DRY-RUN BALANS ISBOTI O‘TDI ✓ — hisob-kitob aralashmaydi' : `${fails} ta YIQILDI ✗`}`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
