/**
 * ═══════ PARSER GOLDEN — «docs/Smart blok.xlsb» (shablon v5) ═══════
 *
 * Bu to'plam BITTA savolga javob beradi: parser faylni EGASI KO'RGANIDEK o'qidimi?
 *
 * Etalonlar docs/audit/smart-blok-xlsb.md dagi mustaqil pyxlsb/Decimal auditidan.
 * Filtrlangan SUBTOTAL global jami emas; barcha mijoz tafsilotlari yig'iladi.
 * Manbada mijozsiz 163 350 000 so'm mavjud va bu pul parserdan yo'qolmasligi shart.
 *
 * Ishga tushirish:
 *   cd apps/api && npx tsx test/import/parse.golden.ts
 */
import { WorkbookReader } from '../../src/import/parse/workbook.reader';
import { parseMasterData, parseDeclaredTotals } from '../../src/import/parse/master.parser';
import {
  parseShipments, parseClientPayments, parseFactoryPayments,
  parsePalletReturns, parseFactoryPalletReturns,
} from '../../src/import/parse/sheets.parser';
import { Prisma } from '@prisma/client';

const FILE = process.env.WORKBOOK ?? '../../docs/Smart blok.xlsb';
const D = Prisma.Decimal;

let checks = 0;
let failures = 0;
const eq = (actual: unknown, expected: unknown, label: string, tol = 0.01) => {
  checks++;
  const a = Number(actual ?? NaN);
  const e = Number(expected ?? NaN);
  const ok = Number.isFinite(a) && Number.isFinite(e) && Math.abs(a - e) <= tol;
  if (!ok) { failures++; console.error(`  ✗ ${label}: kutilgan ${expected}, keldi ${actual}`); }
  else console.log(`  ✓ ${label} = ${expected}`);
};
const is = (actual: unknown, expected: unknown, label: string) => {
  checks++;
  if (actual !== expected) { failures++; console.error(`  ✗ ${label}: kutilgan «${expected}», keldi «${actual}»`); }
  else console.log(`  ✓ ${label} = «${expected}»`);
};
const sum = (xs: Array<Prisma.Decimal | null>) => xs.reduce<Prisma.Decimal>((a, x) => (x ? a.plus(x) : a), new D(0));
const sumN = (xs: Array<number | null>) => xs.reduce<number>((a, x) => a + (x ?? 0), 0);

async function main() {
  const wb = await WorkbookReader.fromFile(FILE);
  eq(wb.sheetNames().length, 15, 'barcha XLSB varaqlari o`qildi');
  is(wb.table('Товар').headerRow, 3, 'Товар asl sarlavha qatori');
  is(wb.table('Оплата').headerRow, 4, 'Оплата boshidagi bo`sh qator saqlandi');

  console.log('\n— справочник —');
  const master = parseMasterData(wb);
  eq(master.settings.palletBasePrice, 130000, 'poddon bazaviy narxi');
  eq(master.settings.taxPerM3, 10000, 'soliq (1 kub)');
  eq(master.clients.length, 55, 'справочникdagi mijozlar soni');
  eq(master.agents.length, 6, 'agentlar soni');
  eq(master.factories.length, 2, 'zavodlar soni');
  is(master.factories.slice().sort().join(','), 'Коалс,Ментора', 'zavod nomlari');
  is(master.payTypes.slice().sort().join(','), 'Касса,Перечисления', 'to`lov turlari');
  {
    const jasr = master.clients.find((c) => c.officialName === 'Жаср Версал');
    is(jasr?.agentName, 'Темур', '«Жаср Версал» agenti');
    is(jasr?.variants.join('|'), 'Жасур Версал|Жасур Версал', '«Жаср Версал» yozilish variantlari');
    is(jasr?.legacyKey, '5-Жаср Версал', '«Жаср Версал» eski varaq kaliti');
  }

  console.log('\n— «Товар» (yuklar) —');
  const shipsP = parseShipments(wb); const ships = shipsP.rows;
  eq(ships.length, 478, 'yuk qatorlari soni');
  eq(sumN(ships.map((s) => s.cube)), 14783.256, 'Блок Куб jami', 0.001);
  eq(sum(ships.map((s) => s.costSumDeclared)), 8602320762, 'Сумма Приход jami');
  eq(sumN(ships.map((s) => s.palletQty)), 8551, 'Поддон Шт jami');
  eq(sum(ships.map((s) => s.palletSumDeclared)), 1111630000, 'Сумма Поддон jami');
  eq(sum(ships.map((s) => s.takenSumDeclared)), 9713950762, 'Блок+Поддон jami');
  eq(sum(ships.map((s) => s.saleSumDeclared)), 10541629899.914259, 'Сумма Продажа jami');
  eq(sum(ships.map((s) => s.transportCost)), 1116796105.199, 'Авто услу jami');
  eq(sum(ships.map((s) => s.profitDeclared)), 822513032.715259, 'Общая прибль jami');
  eq(sum(ships.map((s) => s.clientChargeDeclared)), 9677805899.942259, 'Мижозга jami');
  is(ships[0].date?.toISOString().slice(0, 10), '2026-06-24', 'XLSB sana bir kun siljimadi');
  is(ships[0].salePrice?.toString(), '732542.438', 'kasr narx ko`paytirishdan oldin yaxlitlanmadi');
  eq(ships.filter((s) => s.invoiceNo).length, 9, 'to`qqiz ESF metama`lumoti');
  eq(ships.filter((s) => s.sourceNotes).length, 10, 'o`nta Excel katak izohi saqlandi');
  {
    const invoice = ships.find((s) => s.origin.excelRow === 473);
    is(invoice?.taxId, '308000738', 'STIR identifikator sifatida saqlandi');
    is(invoice?.invoiceNo, '395', 'ESF raqami');
    is(invoice?.invoiceStatus, 'ОТПРАВЛЕНО', 'ESF holati');
    is(invoice?.note?.includes('2,470,000'), true, 'poddon qaytarish matni saqlandi');
  }
  // hisoblangan ustunlar HAQIQATAN formulaga mos kelishi — parser ustunni adashtirmaganining isboti
  {
    let bad = 0;
    for (const s of ships) {
      const m3 = new D(String(s.cube ?? 0));
      const cost = m3.mul(s.costPrice ?? 0);
      const sale = m3.mul(s.salePrice ?? 0);
      const pal = new D(s.palletQty ?? 0).mul(s.palletPrice ?? 0);
      const charge = sale.minus(s.transportPayerRaw === 'Клиент' ? (s.transportCost ?? new D(0)) : new D(0));
      if (cost.minus(s.costSumDeclared ?? 0).abs().gt(1)) bad++;
      else if (sale.minus(s.saleSumDeclared ?? 0).abs().gt(1)) bad++;
      else if (pal.minus(s.palletSumDeclared ?? 0).abs().gt(1)) bad++;
      else if (charge.minus(s.clientChargeDeclared ?? 0).abs().gt(1)) bad++;
    }
    eq(bad, 0, 'har qatorda Куб×Нарх va «Мижозга» formulasi tushdi');
  }
  {
    const payers = new Set(ships.map((s) => s.transportPayerRaw));
    is([...payers].sort().join(','), 'Клиент,Сотувчи', '«Расход Авто» faqat ikki qiymat');
    const channels = new Set(ships.map((s) => s.factoryPayChannel));
    is([...channels].sort().join(','), 'Касса,Перечисления', '«Тўлов тури» faqat ikki qiymat');
    const factories = new Set(ships.map((s) => s.factoryRaw));
    is([...factories].sort().join(','), 'Коалс,Ментора', 'zavodlar faqat справочникdagilar');
  }

  console.log('\n— «Оплата» (mijoz to`lovlari) —');
  const paysP = parseClientPayments(wb); const pays = paysP.rows;
  eq(pays.length, 224, 'to`lov qatorlari soni');
  eq(sum(pays.map((p) => p.bank)), 9295321100, 'ПР-Сумма (o`tkazma) jami');
  eq(sum(pays.map((p) => p.cash)), 112814800, 'Накд jami');
  eq(sum(pays.map((p) => p.click)), 25565000, 'Клик jami');
  eq(sum(pays.map((p) => p.terminal)), 0, 'Терминал jami');
  eq(sum(pays.map((p) => p.totalDeclared)), 9433700900, 'Жами сумма');
  eq(sumN(pays.map((p) => p.palletQty)), 2935, 'to`langan paddon donasi');
  eq(sum(pays.map((p) => p.palletMoneyDeclared)), 381550000, 'Поддон пули');
  eq(sum(pays.map((p) => p.goodsMoneyDeclared)), 9052150900, 'Товарга');
  {
    const unnamed = pays.find((p) => p.origin.excelRow === 226);
    is(unnamed?.clientRaw, '', 'mijozsiz qator parserda saqlandi');
    eq(unnamed?.bank, 163350000, 'mijozsiz 163 350 000 so`m yo`qolmadi');
    is(unnamed?.payer, 'OOO "GRAND TORG KARAVAN"', 'to`lovchi aynan saqlandi');
    const mixed = pays.find((p) => p.origin.excelRow === 204);
    eq(mixed?.cash, 22325000, 'aralash to`lov naqd qismi');
    eq(mixed?.click, 785000, 'aralash to`lov Click qismi');
    eq(mixed?.palletQty, 19, 'aralash to`lovda yagona poddon miqdori');
    eq(pays.find((p) => p.origin.excelRow === 227)?.click, -5000000, 'Click refund manfiy saqlandi');
    eq(pays.find((p) => p.origin.excelRow === 190)?.palletQty, -71, 'poddon bekor qilish miqdori');
    eq(pays.filter((p) => p.totalDeclared?.lt(0)).length, 8, 'sakkiz pul qaytarishi');
  }
  {
    // K = D+H+I+J — kanal ustunlari jamiga tushishi SHART, aks holda pul yo`qoladi
    let bad = 0;
    for (const p of pays) {
      const t = sum([p.bank, p.cash, p.click, p.terminal]);
      if (t.minus(p.totalDeclared ?? 0).abs().gt(0.01)) bad++;
    }
    eq(bad, 0, 'har to`lovda kanallar yig`indisi «Жами сумма» ga teng');
  }

  console.log('\n— «Оплата поставшику» (zavodga to`lov) —');
  const fpaysP = parseFactoryPayments(wb); const fpays = fpaysP.rows;
  eq(fpays.length, 66, 'zavod to`lovi qatorlari');
  eq(sum(fpays.map((p) => p.amount)), 8255239420, 'zavodga jami to`langan');
  {
    const byFactory = new Map<string, Prisma.Decimal>();
    for (const p of fpays) byFactory.set(p.factoryRaw, (byFactory.get(p.factoryRaw) ?? new D(0)).plus(p.amount ?? 0));
    eq(byFactory.get('Коалс'), 2395089420, 'Коалс ga to`langan');
    eq(byFactory.get('Ментора'), 5860150000, 'Ментора ga to`langan');
  }

  console.log('\n— «Поддон қайтариш» (mijozdan) —');
  const pretsP = parsePalletReturns(wb); const prets = pretsP.rows;
  eq(prets.length, 118, 'mijoz qaytarishi qatorlari');
  eq(sumN(prets.map((p) => p.qty)), 5511, 'mijozlardan qaytgan paddon');
  eq(prets.find((p) => p.origin.excelRow === 118)?.qty, -8, 'yangi manfiy qaytarish saqlandi');

  console.log('\n— «Поддон қайтариш заводга» —');
  const fretsP = parseFactoryPalletReturns(wb); const frets = fretsP.rows;
  // r18: 500 dona yordamchi I ustunida; qabul qilingan B ustuni bo'sh.
  // r17 esa B=500 bilan haqiqiy qaytarish, faqat pul kanali yozilmagan.
  eq(frets.length, 14, 'zavodga qaytarish qatorlari (tugallanganlari)');
  eq(sumN(frets.map((p) => p.qty)), 4392, 'zavodga qaytarilgan paddon');
  eq(sum(frets.map((p) => p.totalCostDeclared)), 19368000, 'qaytarish harajati jami');
  eq(frets.find((p) => p.origin.excelRow === 17)?.qty, 500, 'kanalsiz 500 dona haqiqiy qaytarish');
  is(frets.find((p) => p.origin.excelRow === 17)?.channel, '', 'bo`sh kanal o`ylab topilmadi');
  {
    const byFactory = new Map<string, number>();
    for (const p of frets) byFactory.set(p.factoryRaw, (byFactory.get(p.factoryRaw) ?? 0) + (p.qty ?? 0));
    eq(byFactory.get('Коалс'), 2421, 'Коалс ga qaytarilgan');
    eq(byFactory.get('Ментора'), 1971, 'Ментора ga qaytarilgan');
  }

  console.log('\n— TO`LDIRILMAGAN qatorlar: tashlanadi, lekin SANAB beriladi —');
  {
    // Bu qatorlar daftar’ga yozilmaydi, lekin JIMGINA ham yo'qolmaydi: har biri o'z
    // koordinatasi bilan review ekraniga chiqadi. Etalon faylda ular oxirgi kunning
    // boshlanib qolgan yozuvlari.
    eq(shipsP.incomplete.length, 0, '«Товар»: mijozi yozilmagan qatorlar');
    eq(fretsP.incomplete.length, 1, '«Поддон қайтариш заводга»: qabul qilingani yozilmagan qator');
    eq(paysP.incomplete.length, 0, '«Оплата»: to`liqsiz qator yo`q');
    eq(pretsP.incomplete.length, 0, '«Поддон қайтариш»: to`liqsiz qator yo`q');
    eq(fpaysP.incomplete.length, 0, '«Оплата поставшику»: to`liqsiz qator yo`q');
    is(fretsP.incomplete[0]?.origin.excelRow, 18, 'tugallanmagan qaytarish asl r18 koordinatasida');
  }

  console.log('\n— egasining O`Z yig`indilari (solishtirish uchun) —');
  const declared = parseDeclaredTotals(wb);
  eq(declared.clientBalances?.sales, 9677805899.942259, '«Мижозлар қолдиғи» sotuv');
  eq(declared.clientBalances?.paid, 8888800900, '«Мижозлар қолдиғи» to`lov');
  eq(declared.clientBalances?.goodsDebt, -789004999.942259, '«Мижозлар қолдиғи» tovar qarzi');
  eq(declared.clientBalances?.palletsTaken, 8551, 'olgan paddon');
  eq(declared.clientBalances?.palletsReturned, 5511, 'qaytargan paddon');
  eq(declared.clientBalances?.palletsPaidQty, 2935, 'puli to`langan paddon');
  eq(declared.clientBalances?.palletDebtQty, -105, 'paddon qarzi (dona)');
  {
    const koals = declared.factories.find((f) => f.name === 'Коалс');
    const mentora = declared.factories.find((f) => f.name === 'Ментора');
    eq(koals?.balance, -784000634, 'Коалс qoldig`i (paddon qaytarishisiz)');
    eq(mentora?.balance, -674710708, 'Ментора qoldig`i');
    eq(koals?.taken, 3179090054, 'Коалс dan olingan jami');
    eq(mentora?.taken, 6534860708, 'Ментора dan olingan jami');
  }

  console.log('\n— KESISHMA: varaqlar bir-biriga tushadimi —');
  // «Мижозлар қолдиғи» C ustuni «Товар» T ustunidan yig'iladi ⇒ ikkalasi teng bo'lishi SHART
  eq(sum(ships.map((s) => s.clientChargeDeclared)), declared.clientBalances?.sales, 'Товар «Мижозга» === qoldiq varag`i sotuvi');
  eq(sum(pays.filter((p) => p.clientRaw).map((p) => p.goodsMoneyDeclared)), declared.clientBalances?.paid, 'Mijozli Оплата «Товарга» === barcha mijoz qoldig`i to`lovi');
  eq(sumN(ships.map((s) => s.palletQty)), declared.clientBalances?.palletsTaken, 'Товар paddoni === qoldiq varag`i «Олган»');
  eq(sumN(prets.map((p) => p.qty)), declared.clientBalances?.palletsReturned, 'Qaytarish varag`i === qoldiq varag`i «Қайтарган»');
  eq(sumN(pays.map((p) => p.palletQty)), declared.clientBalances?.palletsPaidQty, 'Оплата paddoni === qoldiq varag`i «Тўлаган дона»');

  console.log(`\n${checks} tekshiruv, ${failures} xato`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
