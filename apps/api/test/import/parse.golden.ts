/**
 * ═══════ PARSER GOLDEN — «docs/Smart blok.xlsx» (shablon v5) ═══════
 *
 * Bu to'plam BITTA savolga javob beradi: parser faylni EGASI KO'RGANIDEK o'qidimi?
 *
 * Har bir kutilgan raqam faylning O'Z yig'indi katagidan olingan (Excel'ning SUBTOTAL
 * qatorlari va «Мижозлар қолдиғи»/«Поставшиклар ҳисоби» varaqlari), qo'lda hisoblangan
 * emas. Ya'ni test «parser o'zi bilan kelishdimi» degan foydasiz savolni emas, «parser
 * daftar bilan kelishdimi» degan savolni tekshiradi.
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

const FILE = process.env.WORKBOOK ?? '../../docs/Smart blok.xlsx';
const D = Prisma.Decimal;

let checks = 0;
let failures = 0;
const eq = (actual: unknown, expected: unknown, label: string, tol = 0.01) => {
  checks++;
  const a = Number(actual ?? NaN);
  const e = Number(expected ?? NaN);
  const ok = Number.isNaN(a) && Number.isNaN(e) ? true : Math.abs(a - e) <= tol;
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

  console.log('\n— справочник —');
  const master = parseMasterData(wb);
  eq(master.settings.palletBasePrice, 130000, 'poddon bazaviy narxi');
  eq(master.settings.taxPerM3, 10000, 'soliq (1 kub)');
  eq(master.clients.length, 48, 'справочникdagi mijozlar soni');
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
  eq(ships.length, 415, 'yuk qatorlari soni');
  eq(sumN(ships.map((s) => s.cube)), 12780.504, 'Блок Куб jami', 0.001);
  eq(sum(ships.map((s) => s.costSumDeclared)), 7451239050, 'Сумма Приход jami');
  eq(sumN(ships.map((s) => s.palletQty)), 7392, 'Поддон Шт jami');
  eq(sum(ships.map((s) => s.palletSumDeclared)), 960960000, 'Сумма Поддон jami');
  eq(sum(ships.map((s) => s.takenSumDeclared)), 8412199050, 'Блок+Поддон jami');
  eq(sum(ships.map((s) => s.saleSumDeclared)), 9100435039.914066, 'Сумма Продажа jami');
  eq(sum(ships.map((s) => s.transportCost)), 945196105.199, 'Авто услу jami');
  eq(sum(ships.map((s) => s.profitDeclared)), 703999884.715067, 'Общая прибль jami');
  eq(sum(ships.map((s) => s.clientChargeDeclared)), 8375011039.942068, 'Мижозга jami');
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
  eq(pays.length, 194, 'to`lov qatorlari soni');
  eq(sum(pays.map((p) => p.bank)), 7823842240, 'ПР-Сумма (o`tkazma) jami');
  eq(sum(pays.map((p) => p.cash)), 49999800, 'Накд jami');
  eq(sum(pays.map((p) => p.click)), 29780000, 'Клик jami');
  eq(sum(pays.map((p) => p.terminal)), 0, 'Терминал jami');
  eq(sum(pays.map((p) => p.totalDeclared)), 7903622040, 'Жами сумма');
  eq(sumN(pays.map((p) => p.palletQty)), 2853, 'to`langan paddon donasi');
  eq(sum(pays.map((p) => p.palletMoneyDeclared)), 370890000, 'Поддон пули');
  eq(sum(pays.map((p) => p.goodsMoneyDeclared)), 7532732040, 'Товарга');
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
  eq(fpays.length, 58, 'zavod to`lovi qatorlari');
  eq(sum(fpays.map((p) => p.amount)), 7321989420, 'zavodga jami to`langan');
  {
    const byFactory = new Map<string, Prisma.Decimal>();
    for (const p of fpays) byFactory.set(p.factoryRaw, (byFactory.get(p.factoryRaw) ?? new D(0)).plus(p.amount ?? 0));
    eq(byFactory.get('Коалс'), 2395089420, 'Коалс ga to`langan');
    eq(byFactory.get('Ментора'), 4926900000, 'Ментора ga to`langan');
  }

  console.log('\n— «Поддон қайтариш» (mijozdan) —');
  const pretsP = parsePalletReturns(wb); const prets = pretsP.rows;
  eq(prets.length, 88, 'mijoz qaytarishi qatorlari');
  eq(sumN(prets.map((p) => p.qty)), 4036, 'mijozlardan qaytgan paddon');

  console.log('\n— «Поддон қайтариш заводга» —');
  const fretsP = parseFactoryPalletReturns(wb); const frets = fretsP.rows;
  // 12, 13 emas: r16 da 500 dona JO'NATILGAN («Столбец1»), lekin zavod nechtasini qabul
  // qilgani hali yozilmagan (B ustuni bo'sh). Faylning O'Z yig'indisi (3 392) ham uni
  // sanamaydi — ya'ni egasi ham uni «hali tugallanmagan» deb hisoblaydi.
  eq(frets.length, 12, 'zavodga qaytarish qatorlari (tugallanganlari)');
  eq(sumN(frets.map((p) => p.qty)), 3392, 'zavodga qaytarilgan paddon');
  eq(sum(frets.map((p) => p.totalCostDeclared)), 19368000, 'qaytarish harajati jami');
  {
    const byFactory = new Map<string, number>();
    for (const p of frets) byFactory.set(p.factoryRaw, (byFactory.get(p.factoryRaw) ?? 0) + (p.qty ?? 0));
    eq(byFactory.get('Коалс'), 2421, 'Коалс ga qaytarilgan');
    eq(byFactory.get('Ментора'), 971, 'Ментора ga qaytarilgan');
  }

  console.log('\n— TO`LDIRILMAGAN qatorlar: tashlanadi, lekin SANAB beriladi —');
  {
    // Bu qatorlar daftar’ga yozilmaydi, lekin JIMGINA ham yo'qolmaydi: har biri o'z
    // koordinatasi bilan review ekraniga chiqadi. Etalon faylda ular oxirgi kunning
    // boshlanib qolgan yozuvlari.
    eq(shipsP.incomplete.length, 6, '«Товар»: mijozi yozilmagan qatorlar');
    eq(fretsP.incomplete.length, 1, '«Поддон қайтариш заводга»: qabul qilingani yozilmagan qator');
    eq(paysP.incomplete.length, 0, '«Оплата»: to`liqsiz qator yo`q');
    eq(pretsP.incomplete.length, 0, '«Поддон қайтариш»: to`liqsiz qator yo`q');
    eq(fpaysP.incomplete.length, 0, '«Оплата поставшику»: to`liqsiz qator yo`q');
    // …va ular PUL olib ketmaydi: yig'indilar yuqorida faylning o'z SUBTOTAL'iga tushdi
    is(shipsP.incomplete.every((x) => x.missing.includes('mijoz')), true, 'hammasida yetishmayotgani — mijoz');
  }

  console.log('\n— egasining O`Z yig`indilari (solishtirish uchun) —');
  const declared = parseDeclaredTotals(wb);
  eq(declared.clientBalances?.sales, 8375011039.942068, '«Мижозлар қолдиғи» sotuv');
  eq(declared.clientBalances?.paid, 7532732040, '«Мижозлар қолдиғи» to`lov');
  eq(declared.clientBalances?.goodsDebt, -842278999.942067, '«Мижозлар қолдиғи» tovar qarzi');
  eq(declared.clientBalances?.palletsTaken, 7392, 'olgan paddon');
  eq(declared.clientBalances?.palletsReturned, 4036, 'qaytargan paddon');
  eq(declared.clientBalances?.palletsPaidQty, 2853, 'puli to`langan paddon');
  eq(declared.clientBalances?.palletDebtQty, -503, 'paddon qarzi (dona)');
  {
    const koals = declared.factories.find((f) => f.name === 'Коалс');
    const mentora = declared.factories.find((f) => f.name === 'Ментора');
    eq(koals?.balance, -293176218, 'Коалс qoldig`i (paddon qaytarishisiz)');
    eq(mentora?.balance, -797033412, 'Ментора qoldig`i');
    eq(koals?.taken, 2688265638, 'Коалс dan olingan jami');
    eq(mentora?.taken, 5723933412, 'Ментора dan olingan jami');
  }

  console.log('\n— KESISHMA: varaqlar bir-biriga tushadimi —');
  // «Мижозлар қолдиғи» C ustuni «Товар» T ustunidan yig'iladi ⇒ ikkalasi teng bo'lishi SHART
  eq(sum(ships.map((s) => s.clientChargeDeclared)), declared.clientBalances?.sales, 'Товар «Мижозга» === qoldiq varag`i sotuvi');
  eq(sum(pays.map((p) => p.goodsMoneyDeclared)), declared.clientBalances?.paid, 'Оплата «Товарга» === qoldiq varag`i to`lovi');
  eq(sumN(ships.map((s) => s.palletQty)), declared.clientBalances?.palletsTaken, 'Товар paddoni === qoldiq varag`i «Олган»');
  eq(sumN(prets.map((p) => p.qty)), declared.clientBalances?.palletsReturned, 'Qaytarish varag`i === qoldiq varag`i «Қайтарган»');
  eq(sumN(pays.map((p) => p.palletQty)), declared.clientBalances?.palletsPaidQty, 'Оплата paddoni === qoldiq varag`i «Тўлаган дона»');

  console.log(`\n${checks} tekshiruv, ${failures} xato`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
