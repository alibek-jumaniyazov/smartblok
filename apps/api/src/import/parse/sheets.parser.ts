import { readCell, readDate, readInt, readMoney, readNumber, readText } from './cells';
import { col, optionalCol, SheetTable, SHEET, WorkbookReader } from './workbook.reader';
import type {
  ClientPaymentRow, FactoryPalletReturnRow, FactoryPaymentRow, IncompleteRow, Parsed,
  PalletReturnRow, ShipmentRow,
} from './types';

/**
 * ═══════ SHABLON v5 — TEKIS JADVALLARNI O'QISH ═══════
 *
 * Beshala varaq ham bir xil shaklda: sarlavha qatori, undan pastda ma'lumot. Excel jadvali
 * (Таблица1, Тўловлар, …) formulalarni ma'lumot tugagandan KEYIN ham yuzlab qatorga cho'zib
 * qo'yadi — «Товар» da ma'lumot 418-qatorda tugaydi, jadval esa 1110-gacha ketadi. Shuning
 * uchun qator «bo'shmi» degan savol formula bilan emas, AYNIYAT kataklari bilan hal qilinadi
 * (`isDataRow`): faqat egasi qo'li bilan yozgan narsa ma'lumot hisoblanadi.
 *
 * BO'SH QATORDA TO'XTAMAYMIZ. Daftar o'rtasida bir-ikkita bo'sh qator qolishi normal
 * (egasi qatorni o'chirgan), va birinchi bo'shda to'xtash undan keyingi butun daftarni
 * JIMGINA yo'qotardi — importda bundan battar xato yo'q.
 */

/**
 * Bitta katak. `c === null` — ustun faylda yo'q (ixtiyoriy ustunlar), va u BO'SH katak
 * bilan bir xil o'qiladi: yo'q ustun 0 emas, «aytilmagan» degani.
 */
const R = (t: SheetTable, row: number, c: number | null) =>
  c === null ? { v: null as null, t: 'null' as const } : readCell(t.sheet.getRow(row).getCell(c));

const txt = (t: SheetTable, r: number, c: number | null) => readText(R(t, r, c));
const dat = (t: SheetTable, r: number, c: number | null) => readDate(R(t, r, c));
const mny = (t: SheetTable, r: number, c: number | null) => readMoney(R(t, r, c)).value;
const num = (t: SheetTable, r: number, c: number | null) => readNumber(R(t, r, c));
const int = (t: SheetTable, r: number, c: number | null) => readInt(R(t, r, c));

/**
 * Qatorda EGASI YOZGAN biror narsa bormi. Formula bilan to'ldirilgan bo'sh qator («Товар»
 * jadvali ma'lumot tugagandan keyin ham 1110-qatorgacha cho'ziladi) `false` beradi, chunki
 * bu yerda faqat egasi qo'li bilan yozadigan ustunlar so'raladi.
 */
const anyOf = (t: SheetTable, r: number, cols: Array<number | null>): boolean =>
  cols.some((c) => {
    const cell = R(t, r, c);
    return cell.t !== 'null' && String(cell.v ?? '').trim() !== '';
  });

// ─────────────────────────── «Товар» ───────────────────────────

export function parseShipments(wb: WorkbookReader): Parsed<ShipmentRow> {
  const t = wb.table(SHEET.goods);
  const C = {
    payChannel: col(t, 'тўлов тури'),
    factory: col(t, 'поставшик'),
    agent: col(t, 'агент'),
    client: col(t, 'клиент'),
    date: col(t, 'дата'),
    truck: col(t, '№ авто'),
    size: col(t, 'размер'),
    cube: col(t, 'блок куб', 'блок'),
    costPrice: col(t, 'цена приход'),
    costSum: col(t, 'сумма приход'),
    palletQty: col(t, 'поддон шт'),
    palletPrice: col(t, 'цена поддон'),
    palletSum: col(t, 'сумма поддон'),
    takenSum: optionalCol(t, 'блок+ поддон', 'блок+'),
    salePrice: col(t, 'цена продажа'),
    saleSum: col(t, 'сумма продажа'),
    transportPayer: col(t, 'расход авто'),
    profit: optionalCol(t, 'общая прибль', 'общая приб'),
    transportCost: col(t, 'авто услу'),
    clientCharge: col(t, 'мижозга'),
  };

  const out: ShipmentRow[] = [];
  const incomplete: IncompleteRow[] = [];
  // Egasi qo'li bilan yozadigan ustunlar — «qatorda umuman biror narsa bormi» shular bilan
  // o'lchanadi (formula ustunlari EMAS: ular jadval oxirigacha cho'zilgan).
  const typed = [C.client, C.date, C.truck, C.size, C.cube, C.costPrice, C.salePrice, C.factory, C.agent];

  for (let r = t.headerRow + 1; r <= t.lastRow; r++) {
    const clientRaw = txt(t, r, C.client);
    const date = dat(t, r, C.date);

    // AYNIYAT = MIJOZ. Mijozsiz qator yuk emas: uni buyurtma qilib bo'lmaydi (kimga
    // yozamiz?) va hajmi ham yo'q. Lekin qatorda egasi yozgan narsa bo'lsa — u JIMGINA
    // tashlanmaydi, nomma-nom sanab beriladi.
    if (!clientRaw) {
      if (!anyOf(t, r, typed)) continue; // butunlay bo'sh — jadvalning cho'zilgan dumi
      const missing = ['mijoz'];
      if (!date) missing.push('sana');
      if (num(t, r, C.cube) === null) missing.push('hajm (куб)');
      if (mny(t, r, C.salePrice) === null) missing.push('sotuv narxi');
      incomplete.push({
        origin: { sheetName: t.sheetName, excelRow: r },
        summary: [txt(t, r, C.truck), txt(t, r, C.size), date ? date.toISOString().slice(0, 10) : '']
          .filter(Boolean).join(' · '),
        missing,
      });
      continue;
    }

    out.push({
      origin: { sheetName: t.sheetName, excelRow: r },
      factoryPayChannel: txt(t, r, C.payChannel),
      factoryRaw: txt(t, r, C.factory),
      agentRaw: txt(t, r, C.agent),
      clientRaw,
      date,
      truck: txt(t, r, C.truck),
      size: txt(t, r, C.size),
      cube: num(t, r, C.cube),
      costPrice: mny(t, r, C.costPrice),
      costSumDeclared: mny(t, r, C.costSum),
      palletQty: int(t, r, C.palletQty),
      palletPrice: mny(t, r, C.palletPrice),
      palletSumDeclared: mny(t, r, C.palletSum),
      takenSumDeclared: mny(t, r, C.takenSum),
      salePrice: mny(t, r, C.salePrice),
      saleSumDeclared: mny(t, r, C.saleSum),
      transportPayerRaw: txt(t, r, C.transportPayer),
      profitDeclared: mny(t, r, C.profit),
      transportCost: mny(t, r, C.transportCost),
      clientChargeDeclared: mny(t, r, C.clientCharge),
    });
  }
  return { rows: out, incomplete };
}

// ─────────────────────────── «Оплата» ───────────────────────────

export function parseClientPayments(wb: WorkbookReader): Parsed<ClientPaymentRow> {
  const t = wb.table(SHEET.payments);
  const C = {
    date: col(t, 'дата'),
    agent: col(t, 'агент'),
    client: col(t, 'клиент'),
    bank: col(t, 'пр-сумма'),
    payer: col(t, 'плателщик'),
    palletQty: col(t, 'поддон'),
    cash: col(t, 'накд'),
    click: optionalCol(t, 'клик'),
    terminal: optionalCol(t, 'терминал'),
    total: col(t, 'жами сумма'),
    receiver: col(t, 'получател'),
    note: optionalCol(t, 'изох'),
    palletPrice: optionalCol(t, 'поддон нархи'),
    palletMoney: optionalCol(t, 'поддон пули'),
    goodsMoney: optionalCol(t, 'товарга'),
  };

  const out: ClientPaymentRow[] = [];
  const incomplete: IncompleteRow[] = [];
  const typed = [C.date, C.agent, C.client, C.bank, C.cash, C.click, C.terminal, C.payer, C.palletQty, C.receiver];

  for (let r = t.headerRow + 1; r <= t.lastRow; r++) {
    const clientRaw = txt(t, r, C.client);
    const date = dat(t, r, C.date);
    // AYNIYAT = MIJOZ: pul kimdan kelganini bilmasdan uni hisobga yozib bo'lmaydi.
    if (!clientRaw) {
      if (!anyOf(t, r, typed)) continue;
      const missing = ['mijoz'];
      if (!date) missing.push('sana');
      const any = [C.bank, C.cash, C.click, C.terminal].some((c) => mny(t, r, c) !== null);
      if (!any) missing.push('summa');
      incomplete.push({
        origin: { sheetName: t.sheetName, excelRow: r },
        summary: [txt(t, r, C.payer), date ? date.toISOString().slice(0, 10) : ''].filter(Boolean).join(' · '),
        missing,
      });
      continue;
    }
    out.push({
      origin: { sheetName: t.sheetName, excelRow: r },
      date,
      agentRaw: txt(t, r, C.agent),
      clientRaw,
      bank: mny(t, r, C.bank),
      cash: mny(t, r, C.cash),
      click: mny(t, r, C.click),
      terminal: mny(t, r, C.terminal),
      totalDeclared: mny(t, r, C.total),
      payer: txt(t, r, C.payer),
      palletQty: int(t, r, C.palletQty),
      palletPrice: mny(t, r, C.palletPrice),
      palletMoneyDeclared: mny(t, r, C.palletMoney),
      goodsMoneyDeclared: mny(t, r, C.goodsMoney),
      receiver: txt(t, r, C.receiver),
      note: txt(t, r, C.note),
    });
  }
  return { rows: out, incomplete };
}

// ─────────────────── «Оплата поставшику» ───────────────────

export function parseFactoryPayments(wb: WorkbookReader): Parsed<FactoryPaymentRow> {
  const t = wb.table(SHEET.factoryPayments);
  const C = {
    date: col(t, 'дата'),
    channel: col(t, 'в-о'),
    amount: col(t, 'сумма'),
    payer: optionalCol(t, 'платеелшик', 'плателщик'),
    factory: col(t, 'получател'),
  };
  const out: FactoryPaymentRow[] = [];
  const incomplete: IncompleteRow[] = [];
  const typed = [C.date, C.channel, C.amount, C.payer, C.factory];

  for (let r = t.headerRow + 1; r <= t.lastRow; r++) {
    const date = dat(t, r, C.date);
    const amount = mny(t, r, C.amount);
    // AYNIYAT = SUMMA: summasiz qator zavod hisobiga hech narsa qilmaydi.
    if (amount === null) {
      if (!anyOf(t, r, typed)) continue;
      incomplete.push({
        origin: { sheetName: t.sheetName, excelRow: r },
        summary: [txt(t, r, C.factory), date ? date.toISOString().slice(0, 10) : ''].filter(Boolean).join(' · '),
        missing: date ? ['summa'] : ['summa', 'sana'],
      });
      continue;
    }
    out.push({
      origin: { sheetName: t.sheetName, excelRow: r },
      date,
      channel: txt(t, r, C.channel),
      amount,
      payer: txt(t, r, C.payer),
      factoryRaw: txt(t, r, C.factory),
    });
  }
  return { rows: out, incomplete };
}

// ─────────────────── «Поддон қайтариш» ───────────────────

export function parsePalletReturns(wb: WorkbookReader): Parsed<PalletReturnRow> {
  const t = wb.table(SHEET.palletReturns);
  const C = {
    date: col(t, 'дата'),
    client: col(t, 'клиент'),
    qty: col(t, 'поддон дона'),
    note: optionalCol(t, 'изох'),
  };
  const out: PalletReturnRow[] = [];
  const incomplete: IncompleteRow[] = [];
  const typed = [C.date, C.client, C.qty, C.note];

  for (let r = t.headerRow + 1; r <= t.lastRow; r++) {
    const clientRaw = txt(t, r, C.client);
    const date = dat(t, r, C.date);
    const qty = int(t, r, C.qty);
    // AYNIYAT = MIJOZ + SON: paddon kimdan qaytganini bilmasdan qoldiqni kamaytirib bo'lmaydi.
    if (!clientRaw || qty === null) {
      if (!anyOf(t, r, typed)) continue;
      const missing = [!clientRaw ? 'mijoz' : null, qty === null ? 'paddon soni' : null].filter(Boolean) as string[];
      incomplete.push({
        origin: { sheetName: t.sheetName, excelRow: r },
        summary: [clientRaw, date ? date.toISOString().slice(0, 10) : ''].filter(Boolean).join(' · '),
        missing,
      });
      continue;
    }
    out.push({
      origin: { sheetName: t.sheetName, excelRow: r },
      date,
      clientRaw,
      qty,
      note: txt(t, r, C.note),
    });
  }
  return { rows: out, incomplete };
}

// ─────────────── «Поддон қайтариш заводга» ───────────────

export function parseFactoryPalletReturns(wb: WorkbookReader): Parsed<FactoryPalletReturnRow> {
  const t = wb.table(SHEET.factoryPalletReturns);
  const C = {
    date: col(t, 'дата'),
    qty: col(t, 'поддон сони'),
    sender: optionalCol(t, 'жўнатувчи'),
    factory: col(t, 'қабул қилувчи'),
    unitCost: optionalCol(t, '1 дона қайтариш ўртача нархи', '1 дона'),
    totalCost: optionalCol(t, 'қайтариш харажати жами', 'қайтариш харажати'),
    note: optionalCol(t, 'изох'),
    channel: optionalCol(t, 'тўлов тури'),
  };
  const out: FactoryPalletReturnRow[] = [];
  const incomplete: IncompleteRow[] = [];
  const typed = [C.date, C.qty, C.sender, C.factory, C.unitCost, C.channel];

  for (let r = t.headerRow + 1; r <= t.lastRow; r++) {
    const date = dat(t, r, C.date);
    const qty = int(t, r, C.qty);
    // AYNIYAT = SANA + SON. Varaqning O'NG tomonida «ПОДДОН ҚОЛДИҒИ» paneli turadi va
    // uning kataklari ham to'lgan — u ma'lumot emas, sanasi yo'qligi bilan ajraladi.
    if (!date || qty === null) {
      if (!anyOf(t, r, typed)) continue;
      incomplete.push({
        origin: { sheetName: t.sheetName, excelRow: r },
        summary: [txt(t, r, C.factory), date ? date.toISOString().slice(0, 10) : ''].filter(Boolean).join(' · '),
        missing: [!date ? 'sana' : null, qty === null ? 'paddon soni' : null].filter(Boolean) as string[],
      });
      continue;
    }
    out.push({
      origin: { sheetName: t.sheetName, excelRow: r },
      date,
      qty,
      senderRaw: txt(t, r, C.sender),
      factoryRaw: txt(t, r, C.factory),
      unitCost: mny(t, r, C.unitCost),
      totalCostDeclared: mny(t, r, C.totalCost),
      note: txt(t, r, C.note),
      channel: txt(t, r, C.channel),
    });
  }
  return { rows: out, incomplete };
}
