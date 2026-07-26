import { LedgerSource, Prisma } from '@prisma/client';
import { D, isSettled, ZERO } from '../../common/money';
import { L } from '../xlsx/labels';
import { NUMFMT } from '../xlsx/theme';
import { minus, num0, txt, writeTable, type Col, type Tone } from '../xlsx/sheet-builder';
import type { Ctx } from './ctx';
import type { CashTotals, SummaryInput } from './summary';

interface RecRow {
  group: string;
  label: string;
  som: number | null;
  qty: number | null;
  basis: string;
  where: string;
  tone?: Tone;
}

/** Nazorat qatori: farq 1 so'mdan kichik bo'lsa «mos», aks holda farqni ko'rsatadi. */
const check = (group: string, label: string, diff: number, where: string): RecRow => {
  const ok = Math.abs(diff) < 1;
  return {
    group,
    label,
    som: ok ? 0 : diff,
    qty: null,
    basis: ok ? L('Mos keldi — farq yoʼq') : L('FARQ BOR — quyidagi ikki qatorni solishtiring'),
    where,
    tone: ok ? 'success' : 'danger',
  };
};

const checkQty = (group: string, label: string, diff: number, where: string): RecRow => ({
  group,
  label,
  som: null,
  qty: diff,
  basis: diff === 0 ? L('Mos keldi — farq yoʼq') : L('FARQ BOR — qoʼlbola tuzatish zanjirni buzgan'),
  where,
  tone: diff === 0 ? 'success' : 'danger',
});

/**
 * ═══ SOLISHTIRMA ═══
 *
 * Bitta savolga javob beradigan varaq: «nega ikki joyda ikki xil son turibdi?»
 *
 * Bu tizimda bir nechta raqamning IKKITA to'g'ri ta'rifi bor — masalan «mijozlar
 * qarzi» kompaniya jamlanmasida qo'lbola tuzatishlarsiz, mijoz sahifasida esa ular
 * bilan hisoblanadi. Ikkalasi ham to'g'ri, lekin yonma-yon qo'yilmasa, faylni o'qigan
 * odam birini xato deb o'ylaydi. Shuning uchun bu yerda har ikkalasi va ular
 * orasidagi farqning SABABI yozib qo'yiladi.
 */
export async function writeReconciliation(ctx: Ctx, input: SummaryInput, cash: CashTotals): Promise<void> {
  const s = input.summary;
  const all = s.allTime;

  const [clientBalances, buckets, offBookAgg, palletOverview] = await Promise.all([
    ctx.ledger.clientBalances(), // off-book BILAN — tomon sahifalaridagi kabi
    ctx.ledger.factoryBucketsMap(), // off-book BILAN
    ctx.prisma.ledgerEntry.groupBy({
      by: ['account'],
      where: { source: LedgerSource.OFFBOOK_ADJUSTMENT },
      _sum: { amount: true },
    }),
    ctx.pallets.overview(),
  ]);

  let clientNetWithOffBook = ZERO;
  let debtors = ZERO;
  let advances = ZERO;
  let settledCount = 0;
  for (const b of clientBalances.values()) {
    clientNetWithOffBook = clientNetWithOffBook.plus(b);
    if (isSettled(b)) settledCount += 1;
    else if (b.greaterThan(0)) debtors = debtors.plus(b);
    else advances = advances.plus(b);
  }

  let payableGross = ZERO;
  let advCash = ZERO;
  let advBank = ZERO;
  let factoryNet = ZERO;
  for (const b of buckets.values()) {
    if (b.payable.lessThan(0)) payableGross = payableGross.plus(b.payable.negated());
    advCash = advCash.plus(b.advanceCash);
    advBank = advBank.plus(b.advanceBank);
    factoryNet = factoryNet.plus(b.net);
  }

  const offBook = new Map(offBookAgg.map((g) => [g.account, D(g._sum.amount ?? 0)]));
  const offBookClient = offBook.get('CLIENT') ?? ZERO;

  const rows: RecRow[] = [];
  const G1 = L('Mijozlar qarzi');
  const G2 = L('Zavod hisobi');
  const G3 = L('Kassa');
  const G4 = L('Foyda');
  const G5 = L('Paddon');

  // ── 1. Mijozlar ──
  rows.push(
    {
      group: G1,
      label: L('Mijozlar balansi — kompaniya jamlanmasi'),
      som: num0(s.clientsOweUs),
      qty: null,
      basis: L('Barcha mijozlar balansining yigʼindisi, «balansni nazorat qilish» tuzatishlarisiz. Bosh sahifadagi son shu.'),
      where: L('Umumiy koʼrsatkichlar'),
    },
    {
      group: G1,
      label: L('Mijozlar balansi — mijozlar varagʼidagi yigʼindi'),
      som: num0(clientNetWithOffBook),
      qty: null,
      basis: L('Xuddi shu yigʼindi, lekin qoʼlbola tuzatishlar BILAN. Mijoz sahifasidagi son shu.'),
      where: L('Mijozlar'),
    },
    {
      group: G1,
      label: L('Farq sababi — qoʼlbola balans tuzatishlari'),
      som: num0(offBookClient),
      qty: null,
      basis: L('Egasi qoʼlda kiritgan balans tuzatishlari. Ular mijozning oʼz balansiga kiradi, kompaniya jamlanmasiga kirmaydi.'),
      where: L('Bosh daftar — «Balans tuzatildi» qatorlari'),
      tone: 'muted',
    },
    check(
      G1,
      L('Nazorat: jamlanma + tuzatish = mijozlar varagʼi'),
      minus(D(s.clientsOweUs).plus(offBookClient), clientNetWithOffBook),
      L('Mijozlar'),
    ),
    {
      group: G1,
      label: L('Faqat qarzdorlar (musbat qoldiqlar yigʼindisi)'),
      som: num0(debtors),
      qty: null,
      basis: L('Agentning qarz limiti aynan shu songa qaraydi — bir mijozning avansi boshqasining qarzini yopmaydi.'),
      where: L('Mijozlar — «Holati» ustuni «Qarz»'),
      tone: 'danger',
    },
    {
      group: G1,
      label: L('Faqat avanslar (manfiy qoldiqlar yigʼindisi)'),
      som: num0(advances),
      qty: null,
      basis: L('Mijozlar oldindan bergan pul.'),
      where: L('Mijozlar — «Holati» ustuni «Avans»'),
      tone: 'success',
    },
    {
      group: G1,
      label: L('Qoldigʼi 1 soʼmdan kichik mijozlar'),
      som: null,
      qty: settledCount,
      basis: L('Bular «yopiq» hisoblanadi. Kichik qoldiqlar teskari yoʼl bilan chiqarilgan narxlardan qoladi va ekranlarda koʼrsatilmaydi.'),
      where: L('Mijozlar'),
      tone: 'muted',
    },
  );

  // ── 2. Zavod ──
  rows.push(
    {
      group: G2,
      label: L('Zavodlarga qarzimiz — kompaniya jamlanmasi (netto)'),
      som: num0(s.weOweFactories),
      qty: null,
      basis: L('Har bir zavodning uchta choʼntagi qoʼshilgandan keyin manfiy chiqqanlari. Bosh sahifadagi son shu.'),
      where: L('Umumiy koʼrsatkichlar'),
      tone: 'amber',
    },
    {
      group: G2,
      label: L('Ochiq mol qarzimiz — YALPI'),
      som: num0(payableGross),
      qty: null,
      basis: L('Faqat mol choʼntagi. Avans bundan ayirilmagan — chunki avans qarzni oʼzi yopmaydi.'),
      where: L('Zavodlar — «Mol qarzimiz (ochiq)»'),
      tone: 'amber',
    },
    {
      group: G2,
      label: L('Zavodda turgan avans — jami'),
      som: num0(advCash.plus(advBank)),
      qty: null,
      basis: L('Naqd va bank avansi. Bu pul zavodda turibdi, lekin buyurtma qarzini avtomatik yopmaydi.'),
      where: L('Zavodlar — avans ustunlari'),
      tone: 'success',
    },
    {
      group: G2,
      label: L('Naqd avans'),
      som: num0(advCash),
      qty: null,
      basis: L('Zavodga naqd berilgan, hali molga aylanmagan pul.'),
      where: L('Zavodlar'),
      tone: 'success',
    },
    {
      group: G2,
      label: L('Bank avansi'),
      som: num0(advBank),
      qty: null,
      basis: L("Zavodga oʼtkazma qilingan, hali molga aylanmagan pul."),
      where: L('Zavodlar'),
      tone: 'success',
    },
    {
      group: G2,
      label: L('Netto (eski usul: avans qarzdan ayirilgan)'),
      som: num0(factoryNet),
      qty: null,
      basis: L('Faqat eski hisobotlar bilan solishtirish uchun. Kundalik ishda ishlatmang — u 15 mln avans ortidagi 5 mln qarzni koʼrinmas qiladi.'),
      where: L('Zavodlar — «Netto (eski usul)»'),
      tone: 'muted',
    },
  );

  // ── 3. Kassa ──
  const cashIdentity = minus(cash.uzsIn.minus(cash.uzsOut).plus(cash.uzsAdjust), cash.uzsBalance);
  rows.push(
    { group: G3, label: L('Kassa va bank qoldigʼi (soʼm)'), som: num0(cash.uzsBalance), qty: null, basis: L('Hamma hisoblardagi haqiqiy pul.'), where: L('Kassa qoldiqlari') },
    { group: G3, label: L('Kirim (soʼm)'), som: num0(cash.uzsIn), qty: null, basis: L('Tuzatish va diller kapitalisiz.'), where: L('Kassa qoldiqlari'), tone: 'success' },
    { group: G3, label: L('Chiqim (soʼm)'), som: num0(cash.uzsOut), qty: null, basis: L('Tuzatish va diller kapitalisiz.'), where: L('Kassa qoldiqlari'), tone: 'danger' },
    {
      group: G3,
      label: L('Tuzatish va diller kapitali (soʼm)'),
      som: num0(cash.uzsAdjust),
      qty: null,
      basis: L('Qoldiqqa kiradi, kirim/chiqimga kirmaydi. «Kirim − chiqim» qoldiqqa teng chiqmasligining sababi aynan shu.'),
      where: L('Tuzatish va oʼtkazma'),
      tone: 'muted',
    },
    check(G3, L('Nazorat: kirim − chiqim + tuzatish = qoldiq'), cashIdentity, L('Kassa qoldiqlari')),
    {
      group: G3,
      label: L('Mijozlardan yigʼilgan pul (toʼlov hujjatlari boʼyicha)'),
      som: num0(all.collected),
      qty: null,
      basis: L('Kassa kirimidan FARQ QILADI: mijoz shofyorga oʼz qoʼli bilan bergan pul hujjatda bor, lekin kassaga kirmagan.'),
      where: L("Toʼlovlar"),
    },
  );

  // ── 4. Foyda ──
  const grossDiff = minus(all.sales, all.cost, all.netProfit);
  rows.push(
    { group: G4, label: L('SOF FOYDA (tannarxi aniq buyurtmalar)'), som: num0(all.netProfit), qty: null, basis: L('Mol foydasi + transport foydasi, faqat tannarxi aniq buyurtmalar boʼyicha.'), where: L('Umumiy koʼrsatkichlar') },
    { group: G4, label: L('Savdo − tannarx (BARCHA buyurtmalar)'), som: minus(all.sales, all.cost), qty: null, basis: L('Oddiy ayirma. Bu SOF FOYDA emas — tannarxi hali aniqlanmagan buyurtmalar va transport bunda boshqacha hisobga olingan.'), where: L('Buyurtmalar') },
    {
      group: G4,
      label: L('Farq sababi — aniqlanmagan buyurtmalar va transport'),
      som: grossDiff,
      qty: null,
      basis: L('Ikkala son bir xil boʼlishi SHART EMAS. Farq: tannarxi aniqlanmagan buyurtmalar (foydaga kirmaydi) va transport xarajati.'),
      where: L('Buyurtmalar — «Tannarxi aniqmi» ustuni'),
      tone: 'muted',
    },
    {
      group: G4,
      label: L('Tannarxi aniqlanmagan buyurtmalar'),
      som: null,
      qty: all.undetermined.orders,
      basis: L('Zavodga naqdmi yoki oʼtkazmami toʼlanishi hali tanlanmagan.'),
      where: L('Buyurtmalar'),
      tone: 'violet',
    },
    { group: G4, label: L('Sof foyda — eng kam'), som: num0(all.netProfitMin), qty: null, basis: L('Aniqlanmaganlar eng qimmat tannarxda hisoblansa.'), where: L('Umumiy koʼrsatkichlar') },
    { group: G4, label: L('Sof foyda — eng koʼp'), som: num0(all.netProfitMax), qty: null, basis: L('Aniqlanmaganlar eng arzon tannarxda hisoblansa.'), where: L('Umumiy koʼrsatkichlar') },
  );

  // ── 5. Paddon ──
  const p = palletOverview;
  rows.push(
    { group: G5, label: L('Zavodlarga qarzmiz (dona)'), som: null, qty: p.factory.balance, basis: L('Zavoddan olingan − zavodga qaytarilgan + tuzatish.'), where: L('Paddon xulosasi') },
    { group: G5, label: L('Hozir mijozlarda (dona)'), som: null, qty: p.client.balance, basis: L('Mijozga berilgan − qaytargan − yoʼqotilgan + tuzatish.'), where: L('Paddon xulosasi') },
    { group: G5, label: L('Bizning omborda (dona)'), som: null, qty: p.dealerInHand, basis: L('Mijozdan qaytib olingan, hali zavodga joʼnatilmagan.'), where: L('Paddon xulosasi') },
    { group: G5, label: L('Yoʼqotilgan, pulga oʼtkazilgan (dona)'), som: null, qty: p.client.chargedLost, basis: L('Mijoz yoʼqotgan va puli undirilgan paddon.'), where: L('Paddon xulosasi') },
    checkQty(
      G5,
      L('Nazorat: zavodga qarzmiz = mijozlarda + omborda + yoʼqotilgan'),
      p.drift,
      L('Paddon xulosasi'),
    ),
  );

  const cols: Col<RecRow>[] = [
    { header: "Boʼlim", value: (r) => r.group, width: 20 },
    { header: "Koʼrsatkich", value: (r) => r.label, width: 46, wrap: true },
    { header: 'Summa (soʼm)', value: (r) => r.som, fmt: NUMFMT.money, tone: (r) => r.tone },
    { header: 'Dona', value: (r) => r.qty, fmt: NUMFMT.int, tone: (r) => r.tone },
    { header: 'Nima uchun shunday', value: (r) => txt(r.basis), width: 62, wrap: true },
    { header: 'Qaysi varaqda', value: (r) => txt(r.where), width: 26, wrap: true },
  ];

  const ws = ctx.book.sheet('kpi', {
    tab: 'Solishtirma',
    title: 'Solishtirma — bir xil narsaning ikki xil soni nega farq qiladi',
    desc: 'Varaqlar orasida farq qilishi MUMKIN boʼlgan raqamlar yonma-yon va farqning sababi bilan.',
  });
  writeTable(ws, {
    title: 'Solishtirma — bir xil narsaning ikki xil soni nega farq qiladi',
    subtitle: 'Bugungi holat. «Nazorat» qatorlari yashil boʼlsa hamma narsa joyida.',
    columns: cols,
    rows,
    freezeCols: 2,
    totals: false,
    footnote:
      "Bu tizimda ayrim raqamning IKKITA toʼgʼri taʼrifi bor va ikkalasi ham kerak. Masalan mijozlar qarzi: kompaniya jamlanmasida qoʼlbola tuzatishlar hisobga olinmaydi, mijozning oʼz sahifasida esa olinadi. Ikkalasi ham toʼgʼri — shunchaki asosi boshqa. Shuning uchun ular bu yerda yonma-yon qoʼyilgan. «Nazorat» qatori qizil boʼlsa, yuqoridagi ikki qatorni solishtiring: koʼpincha sabab qoʼlbola tuzatishda boʼladi.",
  });
  ctx.book.count(ws, rows.length);
}

void Prisma;
