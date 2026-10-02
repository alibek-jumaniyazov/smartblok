import { PalletTransactionType, PaymentKind, Prisma } from '@prisma/client';
import { Book, Group } from './xlsx/book';
import { Col, kpiRow, num0, titleBand, writeTable } from './xlsx/sheet-builder';
import { NUMFMT } from './xlsx/theme';
import { COST_STATUS, LEDGER_SOURCE, ORDER_STATUS, PALLET_TX, PAYMENT_KIND, PAYMENT_METHOD, TRANSPORT_MODE, TRANSPORT_PAID, label } from './xlsx/labels';
import { round2, ZERO } from '../common/money';
import { clientChargeable } from '../common/transport';
import { cyr } from '../common/translit';
import type { RequestUser } from '../common/scoping';
import type { ClientExportSnapshot } from './client-export.service';

/** Excel stores wall-clock values without a timezone: every displayed date uses Tashkent. */
const date = (value: Date | null): Date | null => value ? new Date(value.getTime() + 5 * 60 * 60 * 1000) : null;
const money = (value: Prisma.Decimal.Value) => num0(round2(value));
const UNIT_PRICE_FORMAT = '#,##0.000000;-#,##0.000000;"—"' as typeof NUMFMT.money;
const signedPallet = (type: PalletTransactionType, qty: number) =>
  type === 'RETURNED_BY_CLIENT' || type === 'CHARGED_LOST' ? -qty :
  ['DELIVERED_TO_CLIENT', 'ADJUSTMENT', 'REVERSAL'].includes(type) ? qty : 0;
const activePayment = (p: ClientExportSnapshot['payments'][number]) =>
  p.voidedAt || p.kind === PaymentKind.TRANSPORT_DIRECT ? ZERO :
    p.kind === PaymentKind.CLIENT_REFUND ? p.amount.negated() : p.amount;

/** The client's book contains no global company datasets, including hidden sheets. */
export async function buildClientWorkbook(s: ClientExportSnapshot, user: RequestUser): Promise<Buffer> {
  const book = new Book(user.name);
  const scope = `${s.client.name} — butun tarix. Faqat shu mijozning maʼlumotlari.`;
  const orderById = new Map(s.orders.map((o) => [o.id, o]));
  const orderNo = (id: string | null) => id ? orderById.get(id)?.orderNo ?? null : null;
  function table<T>(name: string, group: Group, description: string, rows: T[], columns: Col<T>[]) {
    const ws = book.sheet(group, { tab: name, exactName: true, title: name, desc: description });
    book.count(ws, writeTable(ws, { title: name, subtitle: `${scope} ${description}`, rows, columns, freezeCols: 2 }));
    ws.getRow(4).height = 48;
    return ws;
  }

  const card = book.sheet('debt', { tab: 'Мижоз картаси', exactName: true, title: 'Mijoz kartasi', desc: 'Joriy qarz va butun tarixdagi harakatlar.' });
  card.getColumn(1).width = 43; card.getColumn(2).width = 32; card.getColumn(3).width = 86;
  titleBand(card, { title: `Mijoz kartasi — ${s.client.name}`, subtitle: 'Musbat balans — mijoz qarzi; manfiy balans — mijoz avansi. Barcha sanalar Toshkent vaqti.', colCount: 3 });
  const info = (row: number, name: string, value: string | number | Date | null, hint?: string) =>
    kpiRow(card, row, { label: name, value, hint, fmt: typeof value === 'number' ? NUMFMT.money : value instanceof Date ? NUMFMT.dateTime : NUMFMT.text });
  info(5, 'Mijoz', s.client.name);
  info(6, 'Telefon', s.client.phone);
  info(7, 'Biriktirilgan agent', s.client.agent?.name ?? null);
  info(8, 'Hudud', s.client.region?.name ?? null);
  info(9, 'Mijoz holati', cyr(s.client.active ? 'Faol' : 'Nofaol'));
  info(10, 'Yuridik shaxs', s.client.legalEntity);
  info(11, 'Hisobot yaratilgan vaqt', date(s.generatedAt));
  info(12, 'Paddonsiz sof balans', money(s.debt.debtWithoutPallets), 'Hisob daftaridagi barcha yozuvlar, jumladan qoʼlda tuzatishlar va stornolar. Tarixiy undirilgan paddon puli allaqachon shu hisobda.');
  info(13, 'Qaytarilmagan paddon (dona)', s.debt.palletDebtQuantity, 'Olingan − qaytarilgan − pulga oʼtkazilgan + imzoli tuzatishlar.');
  card.getCell('B13').numFmt = NUMFMT.int;
  info(14, 'Paddon joriy narxi', money(s.debt.palletUnitPrice), 'Sozlamadagi narx; tarixiy toʼlov va undirish narxlarini oʼzgartirmaydi.');
  info(15, 'Qaytarilmagan paddon qiymati', money(s.debt.palletDebtAmount));
  card.getCell('B15').value = { formula: 'ROUND(B13*B14,2)', result: money(s.debt.palletDebtAmount) };
  info(16, 'Paddon bilan sof balans', money(s.debt.debtWithPallets), 'Paddonsiz balans + qolgan paddonning joriy qiymati.');
  card.getCell('B16').value = { formula: 'ROUND(B12+B15,2)', result: money(s.debt.debtWithPallets) };
  const grossIn = s.payments.filter((p) => !p.voidedAt && p.kind === 'CLIENT_IN').reduce((sum, p) => sum.plus(p.amount), ZERO);
  const refunds = s.payments.filter((p) => !p.voidedAt && p.kind === 'CLIENT_REFUND').reduce((sum, p) => sum.plus(p.amount), ZERO);
  const direct = s.payments.filter((p) => !p.voidedAt && p.kind === 'TRANSPORT_DIRECT').reduce((sum, p) => sum.plus(p.amount), ZERO);
  [
    ['Sof olingan paddon', s.palletStats.received], ['Sof qaytarilgan paddon', s.palletStats.returned],
    ['Pulga oʼtkazilgan paddon', s.palletStats.chargedLost], ['Undirilgan paddon puli (tarixiy)', money(s.palletStats.chargedLostAmount)],
    ['Mijozdan olingan toʼlov', money(grossIn)], ['Mijozga qaytarilgan pul', money(refunds)],
    ['Sof olingan toʼlov', money(grossIn.minus(refunds))], ['Mijozning shofyorga bevosita toʼlovi', money(direct)],
    ['Buyurtmalar tarixi (jami)', s.orders.length], ['Faol buyurtmalar', s.orders.filter((o) => o.status !== 'CANCELLED').length],
    ['Bekor qilingan buyurtmalar', s.orders.filter((o) => o.status === 'CANCELLED').length], ['Toʼlovlar tarixi (jami)', s.payments.length],
    ['Hisob daftari yozuvlari', s.statement.length], ['Paddon harakatlari', s.pallets.length], ['Ilova hujjatlar', s.documents.length],
  ].forEach(([name, value], index) => {
    info(18 + index, name as string, value as number);
    if (index <= 2 || index >= 8) card.getCell(`B${18 + index}`).numFmt = NUMFMT.int;
  });
  info(34, 'Toʼlov muddati (kun)', s.client.paymentTermDays);
  info(35, 'Kredit limiti', s.client.creditLimit === null ? cyr('Cheksiz') : money(s.client.creditLimit));
  info(37, 'Hisob daftari boshlangʼich qoldigʼi', 0, 'Butun mavjud tarix eksport qilinadi. Boshlangʼich va qoʼlda tuzatishlar ham hisob daftari ichida.');
  info(38, 'Hisob daftari yakuniy qoldigʼi', money(s.debt.debtWithoutPallets), 'Акт сверка varagʼining oxirgi qoldigʼi bilan teng.');
  info(40, 'Eksport qamrovi', cyr('Bitta mijoz; barcha mavjud sanalar'), 'Bu shaxsiy hisobot. Tashkilotning umumiy import fayli sifatida ishlatilmaydi.');
  info(41, 'Eksport muallifi', user.name);
  card.views = [{ state: 'frozen', ySplit: 4 }];
  card.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  book.count(card, 37);

  table('Акт сверка', 'debt', 'Barcha yozuvlar imzosi bilan: storno asl yozuvni yopadi; oxirgi qoldiq kartaga teng.', s.statement, [
    { header: 'Sana', value: (r) => date(r.date), fmt: NUMFMT.date },
    { header: 'Manba', value: (r) => label(LEDGER_SOURCE, r.source), width: 30 },
    { header: 'Buyurtma', value: (r) => orderNo(r.orderId) },
    { header: 'Qarz oshishi', value: (r) => r.amount.gt(0) ? money(r.amount) : 0, fmt: NUMFMT.money, total: 'sum' },
    { header: 'Qarz kamayishi', value: (r) => r.amount.lt(0) ? money(r.amount.negated()) : 0, fmt: NUMFMT.money, total: 'sum' },
    { header: 'Imzoli summa', value: (r) => money(r.amount), fmt: NUMFMT.money, total: 'sum' },
    { header: 'Joriy qoldiq', value: (r) => money(r.running), fmt: NUMFMT.money },
    { header: 'Holat', value: (r) => cyr(r.reversalOfId ? 'Storno' : r.reversedBy ? 'Stornolangan asl yozuv' : 'Amaldagi yozuv') },
    { header: 'Izoh', value: (r) => r.note, wrap: true, width: 54 },
    { header: 'Toʼlov ID', value: (r) => r.paymentId },
    { header: 'Paddon harakati ID', value: (r) => r.palletTransactionId },
    { header: 'Asl yozuv ID', value: (r) => r.reversalOfId },
    { header: 'Yozuv ID', value: (r) => r.id },
    { header: 'Kiritilgan vaqt', value: (r) => date(r.at), fmt: NUMFMT.dateTime },
  ]);

  const orderCols: Col<ClientExportSnapshot['orders'][number]>[] = [
    { header: 'Buyurtma', value: (r) => r.orderNo },
    { header: 'Sana', value: (r) => date(r.date), fmt: NUMFMT.date },
    { header: 'Holat', value: (r) => label(ORDER_STATUS, r.status) },
    { header: 'Zavod', value: (r) => r.factory.name },
    { header: 'Agent', value: (r) => r.agent?.name ?? s.client.agent?.name ?? null },
    { header: 'Avto', value: (r) => r.vehicle?.plate ?? r.vehicle?.name ?? null },
    { header: 'Shofyor (buyurtmadagi)', value: (r) => r.driverName },
    { header: 'Sotuv summasi (hujjat)', value: (r) => money(r.saleTotal), fmt: NUMFMT.money },
    { header: 'Sotuv summasi (faol)', value: (r) => r.status === 'CANCELLED' ? 0 : money(r.saleTotal), fmt: NUMFMT.money, total: 'sum' },
    { header: 'Mijozdan olinadigan (faol)', value: (r) => r.status === 'CANCELLED' ? 0 : money(clientChargeable(r)), fmt: NUMFMT.money, total: 'sum' },
    { header: 'Transport usuli', value: (r) => label(TRANSPORT_MODE, r.transportMode) },
    { header: 'Transport summasi', value: (r) => money(r.transportCost), fmt: NUMFMT.money },
    { header: 'Transport toʼlov holati', value: (r) => label(TRANSPORT_PAID, r.transportPaidStatus) },
    { header: 'Transport toʼlangan vaqt', value: (r) => date(r.transportPaidAt), fmt: NUMFMT.dateTime },
    { header: 'Toʼlov muddati', value: (r) => date(r.dueDate), fmt: NUMFMT.date },
    { header: 'Bekor qilish sababi', value: (r) => r.cancelReason, wrap: true },
    { header: 'Bekor qilish pul rejimi', value: (r) => r.cancelMoneyMode === 'REFUND' ? cyr('Avansda qoldirish') :
      r.cancelMoneyMode === 'VOID_ALL' ? cyr('Bogʼliq pul hujjatlarini storno qilish') : null },
    { header: 'Izoh', value: (r) => r.note, width: 55, wrap: true },
    { header: 'Tizim ID', value: (r) => r.id },
  ];
  if (s.office) orderCols.push(
    { header: 'Tannarx (hujjat)', value: (r) => money(r.costTotal), fmt: NUMFMT.money },
    { header: 'Tannarx holati', value: (r) => label(COST_STATUS, r.costStatus) },
  );
  table('Буюртмалар', 'ops', 'Bekor qilingan hujjatlar tarixda saqlanadi, faol yigʼindiga kirmaydi. Mijoz qarzi Акт сверка boʼyicha.', s.orders, orderCols);

  const goods = s.orders.flatMap((order) => order.items.map((item) => ({ order, item })));
  const goodsCols: Col<(typeof goods)[number]>[] = [
    { header: 'Buyurtma', value: (r) => r.order.orderNo }, { header: 'Sana', value: (r) => date(r.order.date), fmt: NUMFMT.date },
    { header: 'Holat', value: (r) => label(ORDER_STATUS, r.order.status) },
    { header: 'Mahsulot', value: (r) => r.item.product.name }, { header: 'Oʼlcham', value: (r) => r.item.product.size },
    { header: 'Reja m³', value: (r) => num0(r.item.quantityM3), fmt: NUMFMT.m3 },
    { header: 'Haqiqiy m³ (hujjat)', value: (r) => num0(r.item.actualQuantityM3 ?? r.item.quantityM3), fmt: NUMFMT.m3 },
    { header: 'Haqiqiy m³ (faol)', value: (r) => r.order.status === 'CANCELLED' ? 0 : num0(r.item.actualQuantityM3 ?? r.item.quantityM3), fmt: NUMFMT.m3, total: 'sum' },
    { header: 'Paddon (hujjat)', value: (r) => r.item.actualPalletCount ?? r.item.palletCount, fmt: NUMFMT.int },
    { header: 'Sotuv narxi / m³', value: (r) => num0(r.item.salePricePerM3), fmt: UNIT_PRICE_FORMAT },
    { header: 'Narxnoma sotuv narxi / m³', value: (r) => r.item.listPricePerM3 === null ? null : num0(r.item.listPricePerM3), fmt: UNIT_PRICE_FORMAT },
    { header: 'Sotuv summasi (hujjat)', value: (r) => money(r.item.saleTotal), fmt: NUMFMT.money },
    { header: 'Sotuv summasi (faol)', value: (r) => r.order.status === 'CANCELLED' ? 0 : money(r.item.saleTotal), fmt: NUMFMT.money, total: 'sum' },
    { header: 'Narx kutilmoqda', value: (r) => cyr(r.item.pricePending ? 'Ha' : 'Yoʼq') },
    { header: 'Qatʼiy summa', value: (r) => r.item.saleLumpSum === null ? null : money(r.item.saleLumpSum), fmt: NUMFMT.money },
    { header: 'Pozitsiya ID', value: (r) => r.item.id },
  ];
  if (s.office) goodsCols.push(
    { header: 'Tannarx narxi / m³', value: (r) => num0(r.item.finalCostPricePerM3 ?? r.item.costPricePerM3), fmt: UNIT_PRICE_FORMAT },
    { header: 'Tannarx (hujjat)', value: (r) => money(r.item.costTotal), fmt: NUMFMT.money },
  );
  table('Товар', 'ops', 'Har bir buyurtmaning barcha mahsulot pozitsiyalari; transport buyurtma varagʼida bir marta koʼrsatiladi.', goods, goodsCols);

  table('Оплата', 'money', 'Bekor toʼlovlar faol yakunga kirmaydi. Shofyorga bevosita toʼlov sof kirimga qayta qoʼshilmaydi.', s.payments, [
    { header: 'Sana', value: (r) => date(r.date), fmt: NUMFMT.date },
    { header: 'Turi', value: (r) => label(PAYMENT_KIND, r.kind) }, { header: 'Usul', value: (r) => label(PAYMENT_METHOD, r.method) },
    { header: 'Hujjat summasi', value: (r) => money(r.amount), fmt: NUMFMT.money },
    { header: 'Sof kirim (faol)', value: (r) => money(activePayment(r)), fmt: NUMFMT.money, total: 'sum' },
    { header: 'USD miqdori', value: (r) => money(r.usdAmount), fmt: NUMFMT.money },
    { header: 'Kurs', value: (r) => money(r.rate), fmt: NUMFMT.money },
    { header: 'Holat', value: (r) => cyr(r.voidedAt ? 'Bekor qilingan' : 'Faol') },
    { header: 'Toʼlovchi', value: (r) => r.payerName ?? r.payerEntity?.name ?? null },
    { header: 'Qabul qiluvchi', value: (r) => r.receiverName ?? r.receiverEntity?.name ?? null },
    { header: 'Kassa orqali', value: (r) => cyr(r.cashboxId || r.usdCashboxId ? 'Ha' : 'Yoʼq') },
    { header: 'Solishtirilgan', value: (r) => cyr(r.reconciled ? 'Ha' : 'Yoʼq') },
    { header: 'Izoh', value: (r) => r.note, width: 52, wrap: true },
    { header: 'Bekor qilish sababi', value: (r) => r.voidReason, wrap: true },
    { header: 'Bekor qilingan vaqt', value: (r) => date(r.voidedAt), fmt: NUMFMT.dateTime },
    { header: 'Tizim ID', value: (r) => r.id },
  ]);

  const chargeByPallet = new Map<string, Prisma.Decimal>();
  for (const row of s.statement) if (row.palletTransactionId) chargeByPallet.set(row.palletTransactionId, (chargeByPallet.get(row.palletTransactionId) ?? ZERO).plus(row.amount));
  table('Поддон ҳаракати', 'ops', 'Asl harakat va stornolar birga yigʼiladi. Pulga oʼtkazish tarixiy narxda, qolgan paddon joriy narxda.', s.pallets, [
    { header: 'Sana', value: (r) => date(r.date), fmt: NUMFMT.date }, { header: 'Harakat', value: (r) => label(PALLET_TX, r.type) },
    { header: 'Buyurtma', value: (r) => orderNo(r.orderId) }, { header: 'Hujjat donasi', value: (r) => r.qty, fmt: NUMFMT.int },
    { header: 'Qoldiq taʼsiri (dona)', value: (r) => signedPallet(r.type, r.qty), fmt: NUMFMT.int, total: 'sum' },
    { header: 'Tarixiy undirish narxi', value: (r) => r.unitPrice ? money(r.unitPrice) :
      r.reversalOf?.clientId === s.client.id && r.reversalOf.unitPrice ? money(r.reversalOf.unitPrice) : null, fmt: NUMFMT.money },
    { header: 'Pul hisobiga taʼsiri', value: (r) => money(chargeByPallet.get(r.id) ?? ZERO), fmt: NUMFMT.money, total: 'sum' },
    { header: 'Holat', value: (r) => cyr(r.type === 'REVERSAL' ? 'Storno' : !r.reversals.length ? 'Amaldagi harakat' :
      signedPallet(r.type, r.qty) + r.reversals.reduce((sum, rev) => sum + rev.qty, 0) === 0 ? 'Toʼliq stornolangan' : 'Qisman stornolangan') },
    { header: 'Izoh', value: (r) => r.note, wrap: true, width: 54 },
    { header: 'Asl harakat ID', value: (r) => r.reversalOfId }, { header: 'Tizim ID', value: (r) => r.id },
  ]);

  table('Тақсимотлар', 'money', 'Faqat shu mijoz toʼlovi va shu mijoz buyurtmasi orasidagi taqsimotlar. Zavod toʼlovlari kiritilmaydi.', s.allocations, [
    { header: 'Buyurtma', value: (r) => orderNo(r.orderId) }, { header: 'Toʼlov sanasi', value: (r) => date(r.payment.date), fmt: NUMFMT.date },
    { header: 'Toʼlov turi', value: (r) => label(PAYMENT_KIND, r.payment.kind) },
    { header: 'Summa (hujjat)', value: (r) => money(r.amount), fmt: NUMFMT.money },
    { header: 'Summa (faol)', value: (r) => r.voidedAt || r.payment.voidedAt || orderById.get(r.orderId)?.status === 'CANCELLED' ? 0 : money(r.amount), fmt: NUMFMT.money, total: 'sum' },
    { header: 'Holat', value: (r) => cyr(r.voidedAt || r.payment.voidedAt || orderById.get(r.orderId)?.status === 'CANCELLED' ? 'Faol emas' : 'Faol') },
    { header: 'Bekor qilish sababi', value: (r) => r.voidReason, wrap: true },
    { header: 'Kiritilgan vaqt', value: (r) => date(r.createdAt), fmt: NUMFMT.dateTime },
    { header: 'Toʼlov ID', value: (r) => r.paymentId }, { header: 'Taqsimot ID', value: (r) => r.id },
  ]);
  table('Ҳолатлар тарихи', 'raw', 'Barcha buyurtma holati oʼzgarishlari.', s.statuses, [
    { header: 'Buyurtma', value: (r) => orderNo(r.orderId) }, { header: 'Vaqt', value: (r) => date(r.at), fmt: NUMFMT.dateTime },
    { header: 'Oldingi holat', value: (r) => r.from ? label(ORDER_STATUS, r.from) : null },
    { header: 'Yangi holat', value: (r) => label(ORDER_STATUS, r.to) },
    { header: 'Kim', value: (r) => r.by?.name ?? null }, { header: 'Izoh', value: (r) => r.note, width: 60, wrap: true },
  ]);
  table('Изоҳлар', 'raw', 'Shu mijoz buyurtmalariga yozilgan izohlar.', s.comments, [
    { header: 'Buyurtma', value: (r) => orderNo(r.orderId) }, { header: 'Vaqt', value: (r) => date(r.createdAt), fmt: NUMFMT.dateTime },
    { header: 'Kim', value: (r) => r.by?.name ?? null }, { header: 'Izoh', value: (r) => r.text, width: 90, wrap: true },
  ]);
  table('Мижоз номлари', 'ref', 'Faqat shu mijozga tegishli nom variantlari.', [{ name: s.client.name }, ...s.client.aliases], [
    { header: 'Nom', value: (r) => r.name, width: 65 },
    { header: 'Turi', value: (_r, index) => cyr(index === 0 ? 'Rasmiy nom' : 'Nom varianti') },
  ]);
  table('Махсус нархлар', 'ref', 'Shu mijozga belgilangan sotuv narxlarining barcha versiyalari. Zavod narxnomalari kiritilmaydi.', s.prices, [
    { header: 'Mahsulot', value: (r) => r.product.name, width: 36 }, { header: 'Oʼlcham', value: (r) => r.product.size },
    { header: 'Amal qilish sanasi', value: (r) => date(r.effectiveFrom), fmt: NUMFMT.date },
    { header: 'Sotuv narxi / m³', value: (r) => num0(r.pricePerM3), fmt: UNIT_PRICE_FORMAT }, { header: 'Tizim ID', value: (r) => r.id },
  ]);
  table('Ҳужжатлар', 'ref', 'Ilova fayllarining roʼyxati. Fayllarning oʼzi yoki serverdagi saqlash manzili eksport qilinmaydi.', s.documents, [
    { header: 'Buyurtma', value: (r) => orderNo(r.orderId) }, { header: 'Fayl nomi', value: (r) => r.filename, width: 65, wrap: true },
    { header: 'Turi', value: (r) => r.mime }, { header: 'Hajmi (bayt)', value: (r) => r.size, fmt: NUMFMT.int },
    { header: 'Yuklangan vaqt', value: (r) => date(r.createdAt), fmt: NUMFMT.dateTime }, { header: 'Tizim ID', value: (r) => r.id },
  ]);
  book.wb.calcProperties.fullCalcOnLoad = true;
  return book.toBuffer();
}
