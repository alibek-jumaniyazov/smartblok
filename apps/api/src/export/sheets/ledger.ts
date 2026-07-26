import { LedgerAccount } from '@prisma/client';
import {
  AUDIT_ACTION,
  FACTORY_BUCKET,
  LEDGER_ACCOUNT,
  LEDGER_SOURCE,
  PAYMENT_KIND,
  YES_NO,
  label,
} from '../xlsx/labels';
import { NUMFMT } from '../xlsx/theme';
import { debtTone, num0, txt, writeTable, type Col } from '../xlsx/sheet-builder';
import { dateWhere, type Ctx } from './ctx';

// ══════════════════════════ BOSH DAFTAR ══════════════════════════

/**
 * Butun moliyaning MANBASI. Har bir balans — shu jadvaldagi summalarning yig'indisi,
 * boshqa hech qayerda saqlanmaydi.
 *
 * Summa uchta ALOHIDA ustunga bo'lingan (mijoz / zavod / shofyor). Bitta ustunga
 * yig'ilsa, pastdagi JAMI mijozlarning qarzini zavodlarga bo'lgan qarzimiz bilan
 * qo'shib yuboradi va ma'nosiz son chiqadi. Uchta ustun bo'lganda esa har birining
 * jamisi o'zining haqiqiy balansini beradi.
 */
export async function writeLedger(ctx: Ctx): Promise<void> {
  const rows = await ctx.prisma.ledgerEntry.findMany({
    where: dateWhere(ctx.window),
    orderBy: [{ date: 'asc' }, { at: 'asc' }],
    include: {
      client: { select: { name: true } },
      factory: { select: { name: true } },
      vehicle: { select: { name: true } },
      order: { select: { orderNo: true } },
      payment: { select: { kind: true, date: true } },
      createdBy: { select: { name: true } },
      reversalOf: { select: { id: true } },
      reversedBy: { select: { id: true } },
      importBatch: { select: { filename: true } },
    },
  });

  type R = (typeof rows)[number];
  const per = (r: R, acc: LedgerAccount): number | null => (r.account === acc ? num0(r.amount) : null);

  const cols: Col<R>[] = [
    { header: 'Sana', value: (r) => r.date, fmt: NUMFMT.date, total: 'count' },
    { header: 'Yozuv vaqti', value: (r) => r.at, fmt: NUMFMT.dateTime },
    { header: 'Hisob', value: (r) => label(LEDGER_ACCOUNT, r.account), align: 'center' },
    { header: 'Asos', value: (r) => label(LEDGER_SOURCE, r.source), width: 28 },
    { header: 'Summa (belgili)', value: (r) => num0(r.amount), fmt: NUMFMT.money, tone: debtTone },
    { header: 'Mijoz hisobi', value: (r) => per(r, LedgerAccount.CLIENT), fmt: NUMFMT.money, total: 'sum', tone: debtTone },
    { header: 'Zavod hisobi', value: (r) => per(r, LedgerAccount.FACTORY), fmt: NUMFMT.money, total: 'sum', tone: debtTone },
    { header: 'Shofyor hisobi', value: (r) => per(r, LedgerAccount.VEHICLE), fmt: NUMFMT.money, total: 'sum', tone: debtTone },
    { header: "Zavod choʼntagi", value: (r) => label(FACTORY_BUCKET, r.factoryBucket), align: 'center', width: 16 },
    { header: 'Mijoz', value: (r) => txt(r.client?.name ?? null), width: 26 },
    { header: 'Zavod', value: (r) => txt(r.factory?.name ?? null), width: 22 },
    { header: 'Shofyor', value: (r) => txt(r.vehicle?.name ?? null), width: 20 },
    { header: 'Buyurtma №', value: (r) => txt(r.order?.orderNo ?? null), align: 'center' },
    { header: "Toʼlov turi", value: (r) => label(PAYMENT_KIND, r.payment?.kind ?? null), width: 22 },
    { header: "Toʼlov sanasi", value: (r) => r.payment?.date ?? null, fmt: NUMFMT.date },
    { header: 'Storno yozuvi', value: (r) => YES_NO(!!r.reversalOf), align: 'center' },
    { header: 'Storno qilingan', value: (r) => YES_NO(!!r.reversedBy), align: 'center', tone: (r) => (r.reversedBy ? 'slate' : undefined) },
    { header: 'Izoh', value: (r) => txt(r.note), width: 34, wrap: true },
    { header: 'Kiritgan', value: (r) => txt(r.createdBy?.name ?? null) },
    { header: 'Import fayli', value: (r) => txt(r.importBatch?.filename ?? null), width: 20 },
  ];

  const ws = ctx.book.sheet('raw', {
    tab: 'Bosh daftar',
    title: 'Bosh daftar — barcha balans yozuvlari',
    desc: 'Mijoz, zavod va shofyor balanslarining manbasi: har bir yozuv, storno bilan birga.',
  });
  writeTable(ws, {
    title: 'Bosh daftar — barcha balans yozuvlari',
    subtitle: ctx.periodLabel,
    columns: cols,
    rows,
    freezeCols: 1,
    footnote:
      "Bu jadval butun moliyaning MANBASI — har bir balans shu summalarning yigʼindisi, boshqa hech qayerda saqlanmaydi. Ishora: MIJOZ hisobida musbat — mijoz bizga qarz; ZAVOD va SHOFYOR hisobida manfiy — biz ularga qarzdormiz. Summa uchta alohida ustunga ajratilgan, chunki bitta ustunda ular qoʼshilib ketsa jami maʼnosiz boʼladi — uchta ustunning jamisi esa aynan uchta balansni beradi. " +
      "Storno yozuvlari roʼyxatdan OLIB TASHLANMAYDI: ular asl yozuvni yoʼqqa chiqaradi va shuning uchun jami toʼgʼri chiqadi. Storno asl yozuvning SANASINI oladi, shuning uchun sana filtri qoʼyilganda ikkalasi ham bir davrda koʼrinadi. «Zavod choʼntagi» — zavod hisobining qaysi qismi: mol qarzi, naqd avans yoki bank avansi.",
  });
  ctx.book.count(ws, rows.length);
}

// ══════════════════════════ AUDIT JURNALI ══════════════════════════

export async function writeAudit(ctx: Ctx): Promise<void> {
  const rows = await ctx.prisma.auditLog.findMany({
    where: dateWhere(ctx.window, 'at'),
    orderBy: { at: 'asc' },
    select: {
      at: true,
      action: true,
      entity: true,
      entityId: true,
      note: true,
      ip: true,
      user: { select: { name: true, username: true } },
    },
  });

  type R = (typeof rows)[number];
  const cols: Col<R>[] = [
    { header: 'Vaqti', value: (r) => r.at, fmt: NUMFMT.dateTime, total: 'count' },
    { header: 'Foydalanuvchi', value: (r) => txt(r.user?.name ?? r.user?.username ?? null), width: 24 },
    { header: 'Amal', value: (r) => label(AUDIT_ACTION, r.action), align: 'center', width: 18 },
    { header: 'Obyekt turi', value: (r) => r.entity, width: 20 },
    { header: 'Obyekt raqami', value: (r) => txt(r.entityId), width: 36, fmt: NUMFMT.text },
    { header: 'Izoh', value: (r) => txt(r.note), width: 40, wrap: true },
    { header: 'IP manzil', value: (r) => txt(r.ip), fmt: NUMFMT.text },
  ];

  const ws = ctx.book.sheet('raw', {
    tab: 'Audit jurnali',
    title: 'Audit jurnali — kim nima qilgani',
    desc: 'Tizimda bajarilgan amallar tarixi: yaratish, tahrirlash, bekor qilish, kirish.',
  });
  writeTable(ws, {
    title: 'Audit jurnali — kim nima qilgani',
    subtitle: `${ctx.periodLabel} · Sana sifatida amal bajarilgan vaqt olinadi.`,
    columns: cols,
    rows,
    freezeCols: 1,
    emptyText: 'Bu davrda audit yozuvi yoʼq',
    footnote:
      "Bu jurnal TOʼLIQ emas: yozuv tranzaksiyadan tashqarida yozilsa, xatolik yuz berganda u jimgina tushib qoladi — asosiy amal esa bajariladi. Yaʼni bu yerda koʼrinmagan amal boʼlmagan degani emas. Amalning oʼzgarish tafsilotlari (eski/yangi qiymatlar) bu varaqqa chiqarilmaydi — ular ichki texnik formatda saqlanadi va faylni oʼqib boʼlmas darajada shishirib yuborardi.",
  });
  ctx.book.count(ws, rows.length);
}
