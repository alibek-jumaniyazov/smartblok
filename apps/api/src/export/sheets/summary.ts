import type { Worksheet } from 'exceljs';
import { Prisma } from '@prisma/client';
import { cyr } from '../../common/translit';
import { COLOR, FONT, NUMFMT } from '../xlsx/theme';
import { kpiRow, num0, sectionHeading, titleBand, type KpiLine } from '../xlsx/sheet-builder';

/** DashboardService.summary() qaytaradigan shakl — faqat kerakli qismi. */
type Summary = Awaited<ReturnType<import('../../dashboard/dashboard.service').DashboardService['summary']>>;

export interface CashTotals {
  uzsBalance: Prisma.Decimal;
  uzsIn: Prisma.Decimal;
  uzsOut: Prisma.Decimal;
  uzsAdjust: Prisma.Decimal;
  usdBalance: Prisma.Decimal;
  boxCount: number;
}

export interface SummaryInput {
  summary: Summary;
  cash: CashTotals;
  /** Tanlangan davr; null ⇒ butun baza eksport qilindi. */
  window: { from: string; to: string } | null;
  counts: Record<string, number>;
}

/**
 * ═══ UMUMIY KO'RSATKICHLAR ═══
 *
 * Bu varaqning raqamlari saytdagi Boshqaruv paneli bilan AYNAN bir xil bo'lishi shart,
 * shuning uchun ular qayta hisoblanmaydi — DashboardService.summary() ning o'zi chaqiriladi.
 * Formulani bu yerda takrorlash eng oson yo'l edi va eng tez chalkashadigan yo'l ham:
 * «sof foyda» faqat tannarxi aniq buyurtmalar ustidan hisoblanadi, «kirim» sof (qaytarish
 * ayirilgan), «zavodga qarz» esa avans bilan netlashtirilmaydi. Bittasi ham qo'lda
 * takrorlanganda uzoq qolmaydi.
 */
export function writeSummary(ws: Worksheet, input: SummaryInput): number {
  const { summary: s, cash } = input;
  const all = s.allTime;

  ws.getColumn(1).width = 40;
  ws.getColumn(2).width = 22;
  ws.getColumn(3).width = 72;

  titleBand(ws, {
    title: 'Umumiy koʼrsatkichlar',
    subtitle: input.window
      ? `Qoldiqlar — bugungi holat. Oqim raqamlari: butun davr + tanlangan davr (${input.window.from} — ${input.window.to})`
      : 'Qoldiqlar — bugungi holat. Oqim raqamlari — butun davr boʼyicha',
    colCount: 3,
  });

  let r = 5;
  // Mundarijada «nechta koʼrsatkich» deb chiqadi. Modul darajasidagi sanagich EMAS:
  // ikkita eksport bir vaqtda ishlasa, umumiy oʼzgaruvchi ikkalasini ham buzardi.
  let kpiCount = 0;
  const put = (start: number, items: KpiLine[]): number => {
    kpiCount += items.length;
    return lines(ws, start, items);
  };

  // ── 1. Sof natija ──
  sectionHeading(ws, r, 'Butun davr — sof natija', 3);
  r += 1;
  r = put(r, [
    {
      label: 'Savdo summasi',
      value: num0(all.sales),
      hint: "Bekor qilinmagan barcha buyurtmalar. Transport shu summaning ichida.",
    },
    { label: 'Tannarx (zavod narxi)', value: num0(all.cost), hint: 'Barcha buyurtmalar boʼyicha eng aniq maʼlum tannarx. Paddon bunga kirmaydi.' },
    {
      label: 'Tannarxi aniq savdo',
      value: num0(all.determinedSales),
      hint: 'Foyda faqat SHU savdodan hisoblanadi — zavodga toʼlash usuli tanlangan yoki pul toʼlangan buyurtmalar.',
    },
    { label: 'Tannarxi aniq tannarx', value: num0(all.determinedCost) },
    { label: 'Mol foydasi', value: num0(all.goodsProfit), tone: toneOf(all.goodsProfit), hint: 'Tannarxi aniq savdo − tannarxi aniq tannarx.' },
    { label: 'Transport xarajati', value: num0(all.transportCost), hint: 'Shofyorlarga toʼlangan haq (tannarxi aniq buyurtmalar boʼyicha).' },
    {
      label: 'Transport foydasi',
      value: num0(all.transportProfit),
      tone: toneOf(all.transportProfit),
      hint: 'Transport savdo summasining ichida boʼlgani uchun bu son odatda MANFIY — bu zarar emas, mol foydasi ichidan shofyorga ketgan ulush.',
    },
    {
      label: 'SOF FOYDA',
      value: num0(all.netProfit),
      tone: toneOf(all.netProfit),
      strong: true,
      hint: 'Mol foydasi + transport foydasi. Tannarxi aniq buyurtmalar boʼyicha.',
    },
  ]);

  r += 1;

  // ── 2. Aniqlanmagan buyurtmalar ──
  const und = all.undetermined;
  sectionHeading(ws, r, 'Tannarxi hali aniqlanmagan buyurtmalar', 3);
  r += 1;
  r = put(r, [
    {
      label: 'Buyurtmalar soni',
      value: und.orders,
      fmt: NUMFMT.int,
      hint: 'Zavodga naqdmi yoki oʼtkazmami toʼlanishi hali tanlanmagan va pul ham tushmagan.',
    },
    { label: 'Ularning savdosi', value: num0(und.sales) },
    { label: 'Naqd narxda tannarx', value: num0(und.costCash) },
    { label: 'Oʼtkazma narxda tannarx', value: num0(und.costBank) },
    { label: 'Foyda — eng kam', value: num0(und.profitMin), tone: 'muted' },
    { label: 'Foyda — eng koʼp', value: num0(und.profitMax), tone: 'muted' },
    {
      label: 'Sof foyda oraligʼi (eng kam)',
      value: num0(all.netProfitMin),
      strong: true,
      hint: 'Yuqoridagi SOF FOYDA + aniqlanmaganlarning eng yomon holati.',
    },
    {
      label: 'Sof foyda oraligʼi (eng koʼp)',
      value: num0(all.netProfitMax),
      strong: true,
      hint: 'Yuqoridagi SOF FOYDA + aniqlanmaganlarning eng yaxshi holati.',
    },
  ]);

  r += 1;

  // ── 3. Pul oqimi ──
  sectionHeading(ws, r, 'Butun davr — pul oqimi', 3);
  r += 1;
  r = put(r, [
    {
      label: 'Kirim — mijozlardan',
      value: num0(all.collected),
      tone: 'success',
      hint: "SOF: mijozlardan olingan minus mijozlarga qaytarilgan. Bu TOʼLOV hujjatlari boʼyicha — kassaga tushgan pul emas (mijoz shofyorga bergani kassaga kirmaydi).",
    },
    { label: 'Zavodlarga toʼlangan', value: num0(all.factoryPaid), hint: 'SOF: toʼlangan minus zavoddan qaytgan.' },
    { label: 'Shofyorlarga toʼlangan', value: num0(all.vehiclePaid) },
    {
      label: 'Chiqim — jami',
      value: num0(all.chiqim),
      strong: true,
      hint: 'Zavod + shofyor. Xarajatlar va bonus yechish bunga KIRMAYDI.',
    },
  ]);

  r += 1;

  // ── 4. Hozirgi qoldiqlar ──
  sectionHeading(ws, r, 'Hozirgi qoldiqlar', 3);
  r += 1;
  r = put(r, [
    {
      label: 'Mijozlar balansi (sof)',
      value: num0(s.clientsOweUs),
      tone: toneDebt(s.clientsOweUs),
      strong: true,
      hint: "Musbat — mijozlar bizga qarz. Bu SOF son: bir mijozning avansi boshqasining qarzini yopadi. Har bir mijoz alohida «Mijozlar» varagʼida.",
    },
    {
      label: 'Zavodlarga qarzimiz',
      value: num0(s.weOweFactories),
      tone: 'amber',
      hint: 'Musbat son — biz qarzdormiz. Zavoddagi avansimiz bundan AYIRILMAGAN.',
    },
    { label: 'Zavodda turgan naqd avans', value: num0(s.factoryAdvanceCash), tone: 'success' },
    { label: 'Zavodda turgan bank avansi', value: num0(s.factoryAdvanceBank), tone: 'success' },
    {
      label: 'Zavoddagi avans — jami',
      value: num0(s.factoryAdvanceTotal),
      tone: 'success',
      strong: true,
      hint: 'Bu pul zavodda turibdi. Buyurtma qarzini avtomatik yopmaydi — «avansdan yechish» amali kerak.',
    },
    { label: 'Shofyorlarga qarzimiz', value: num0(s.weOweVehicles), tone: 'amber' },
    { label: 'Bonus hamyonlari', value: num0(s.bonusWallets), tone: 'success', hint: 'Zavodlardan yigʼilgan, hali ishlatilmagan bonus.' },
  ]);

  r += 1;

  // ── 5. Kassa ──
  sectionHeading(ws, r, 'Kassa va bank', 3);
  r += 1;
  r = put(r, [
    { label: 'Hisoblar soni', value: cash.boxCount, fmt: NUMFMT.int },
    {
      label: 'Qoldiq — soʼm',
      value: num0(cash.uzsBalance),
      strong: true,
      hint: 'Balans tuzatishlari va diller kapitali bilan BIRGA — bu kassadagi haqiqiy pul.',
    },
    { label: 'Kirim — soʼm', value: num0(cash.uzsIn), tone: 'success', hint: 'Tuzatish va kapital bunga kirmaydi.' },
    { label: 'Chiqim — soʼm', value: num0(cash.uzsOut), tone: 'danger' },
    {
      label: 'Balans tuzatishlari — soʼm',
      value: num0(cash.uzsAdjust),
      tone: 'muted',
      hint: 'Qoldiq = kirim − chiqim + shu ustun. Aynan shuning uchun «kirim − chiqim» qoldiqqa teng chiqmaydi.',
    },
    {
      label: 'Qoldiq — {USD}',
      value: num0(cash.usdBalance),
      fmt: NUMFMT.money,
      hint: "Dollar hech qachon soʼmga qoʼshilmaydi — alohida hisoblarda turadi.",
    },
  ]);

  r += 1;

  // ── 6. Paddon ──
  const p = s.pallets;
  sectionHeading(ws, r, 'Paddon (dona)', 3);
  r += 1;
  r = put(r, [
    { label: 'Zavoddan jami olingan', value: p.factoryReceived, fmt: NUMFMT.int },
    { label: 'Zavodga jami qaytarilgan', value: p.factoryReturned, fmt: NUMFMT.int },
    { label: 'Tuzatish (zavod tomoni)', value: p.factoryAdjustment, fmt: NUMFMT.int, tone: 'muted' },
    {
      label: 'Zavodlarga qarzmiz',
      value: p.owedToFactories,
      fmt: NUMFMT.int,
      strong: true,
      hint: 'Olingan − qaytarilgan + tuzatish.',
    },
    { label: 'Mijozlarga jami berilgan', value: p.clientDelivered, fmt: NUMFMT.int },
    { label: 'Mijozlar jami qaytargan', value: p.clientReturned, fmt: NUMFMT.int },
    { label: 'Yoʼqotilgani uchun pulga oʼtkazilgan', value: p.chargedLost, fmt: NUMFMT.int },
    { label: 'Tuzatish (mijoz tomoni)', value: p.clientAdjustment, fmt: NUMFMT.int, tone: 'muted' },
    {
      label: 'Hozir mijozlarda',
      value: p.atClients,
      fmt: NUMFMT.int,
      strong: true,
      hint: 'Berilgan − qaytargan − yoʼqotilgan + tuzatish.',
    },
    { label: 'Bizning omborda', value: p.dealerInHand, fmt: NUMFMT.int, hint: 'Mijozdan qaytib olingan, hali zavodga joʼnatilmagan.' },
    {
      label: 'Yoʼqotilgan paddon puli',
      value: num0(p.chargedLostAmount),
      hint: 'Yagona paddon puli. Mijoz qarziga yozilgan.',
    },
  ]);

  r += 1;

  // ── 7. Hajm va sonlar ──
  sectionHeading(ws, r, 'Hajm va sonlar', 3);
  r += 1;
  r = put(r, [
    { label: 'Buyurtmalar soni', value: all.orders, fmt: NUMFMT.int, hint: 'Bekor qilinganlar hisobga olinmagan.' },
    {
      label: 'Sotilgan hajm (m³)',
      value: num0(all.cubeSold),
      fmt: NUMFMT.m3,
      hint: "REJADAGI hajm. Zavoddan chiqqan haqiqiy hajm buyurtma varagʼida alohida ustunda.",
    },
    { label: 'Mijozlar', value: input.counts.clients ?? 0, fmt: NUMFMT.int },
    { label: 'Agentlar', value: input.counts.agents ?? 0, fmt: NUMFMT.int },
    { label: 'Zavodlar', value: input.counts.factories ?? 0, fmt: NUMFMT.int },
    { label: 'Moshinalar', value: input.counts.vehicles ?? 0, fmt: NUMFMT.int },
    { label: 'Mahsulotlar', value: input.counts.products ?? 0, fmt: NUMFMT.int },
    { label: 'Toʼlov hujjatlari', value: input.counts.payments ?? 0, fmt: NUMFMT.int },
  ]);

  // ── 8. Tanlangan davr (faqat sana tanlangan boʼlsa) ──
  if (input.window) {
    r += 1;
    const per = s.period;
    sectionHeading(ws, r, `Tanlangan davr: ${input.window.from} — ${input.window.to}`, 3);
    r += 1;
    r = put(r, [
      { label: 'Savdo summasi', value: num0(per.sales) },
      { label: 'Tannarx', value: num0(per.cost) },
      { label: 'Mol foydasi', value: num0(per.goodsProfit), tone: toneOf(per.goodsProfit) },
      { label: 'Transport foydasi', value: num0(per.transportProfit), tone: toneOf(per.transportProfit) },
      { label: 'Sof foyda', value: num0(per.netProfit), tone: toneOf(per.netProfit), strong: true },
      { label: 'Kirim — mijozlardan', value: num0(per.collected), tone: 'success' },
      { label: 'Buyurtmalar soni', value: per.orders, fmt: NUMFMT.int },
      { label: 'Sotilgan hajm (m³)', value: num0(per.cubeSold), fmt: NUMFMT.m3 },
    ]);
  }

  r += 2;
  ws.mergeCells(`A${r}:C${r}`);
  const note = ws.getCell(`A${r}`);
  note.value = cyr(
    "Eslatma: mijoz/zavod sahifalaridagi qoldiqlar «balansni nazorat qilish» qoʼlbola tuzatishlarini ham oʼz ichiga oladi, yuqoridagi umumiy raqamlar esa olmaydi. Shuning uchun mijozlar varagʼidagi balanslar yigʼindisi bu yerdagi «Mijozlar balansi» dan farq qilishi mumkin — ikkalasi ham toʼgʼri, asosi boshqa.",
  );
  note.font = { ...FONT.subtitle };
  note.alignment = { vertical: 'top', horizontal: 'left', indent: 1, wrapText: true };
  ws.getRow(r).height = 44;

  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 4, showGridLines: false }];
  ws.pageSetup = {
    orientation: 'portrait',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    paperSize: 9,
    printTitlesRow: '1:2',
  };
  return kpiCount;
}

/** Ketma-ket KPI qatorlari; keyingi bo'sh qator raqamini qaytaradi. */
function lines(ws: Worksheet, start: number, items: KpiLine[]): number {
  let r = start;
  for (const line of items) {
    kpiRow(ws, r, line);
    r += 1;
  }
  return r;
}

const toneOf = (v: Prisma.Decimal | number): 'success' | 'danger' | undefined => {
  const n = num0(v);
  if (n === 0) return undefined;
  return n > 0 ? 'success' : 'danger';
};

const toneDebt = (v: Prisma.Decimal | number): 'danger' | 'success' | undefined => {
  const n = num0(v);
  if (n === 0) return undefined;
  return n > 0 ? 'danger' : 'success';
};

void COLOR;
