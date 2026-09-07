import { readMoney, readCell, readInt, readNumber, readText } from './cells';
import { WorkbookReader, SHEET, TemplateMismatchError, normHeader } from './workbook.reader';
import type {
  ClientDictEntry, DeclaredTotals, MasterData, MasterSettings, RowOrigin,
} from './types';

/**
 * ═══════ «Кўрсаткичлар» — SPRAVOCHNIK va SOZLAMALAR ═══════
 *
 * Yangi shablonning eng qimmatli varag'i: mijoz ayniyati, agent biriktirilishi va zavod
 * ro'yxati endi TAXMIN qilinmaydi, faylning o'zida yozilgan.
 *
 * Tuzilishi (egasi qo'shgan qatorlarga bardoshli bo'lishi uchun sarlavha bo'yicha izlanadi):
 *
 *   A3    «Асосий параметрлар»
 *   A4:B7  sozlamalar (poddon bazaviy narxi · soliq · KPI ulushi)
 *   A10:E… «Мижозлар справочниги»  → Расмий ном | Варианти-1 | Варианти-2 | Эски варақ | Агент
 *   F10:G… «Агентлар справочниги»  → Агент | Изох
 *   I10:J… «Поставшиклар справочниги» → Поставшик | Изох
 *   I15:I… «Тўлов тури»            → Тур
 */

/** Sozlama nomlari — qism bo'yicha solishtiriladi (egasi so'z qo'shsa ham topiladi). */
const SETTING_MARKS = {
  palletBasePrice: 'поддон базавий нархи',
  taxPerM3: 'солиқ',
  agentKpiShare: 'кпи улуши',
} as const;

const CLIENT_DICT_MARK = 'расмий ном';
const AGENT_DICT_MARK = 'агент';
const FACTORY_DICT_MARK = 'поставшик';
const PAYTYPE_DICT_MARK = 'тур';

export function parseMasterData(wb: WorkbookReader): MasterData {
  const ws = wb.worksheet(SHEET.masterData);
  if (!ws) throw new TemplateMismatchError(`«${SHEET.masterData}» varag'i topilmadi (справочник)`);

  const text = (r: number, c: number) => readText(wb.cell(ws, r, c));
  const last = ws.rowCount;

  // ── sozlamalar: A ustunidagi nom, B ustunidagi qiymat ──
  const settings: MasterSettings = { palletBasePrice: null, taxPerM3: null, agentKpiShare: null };
  for (let r = 1; r <= Math.min(last, 40); r++) {
    const label = normHeader(text(r, 1));
    if (!label) continue;
    const value = readMoney(wb.cell(ws, r, 2)).value;
    if (label.includes(SETTING_MARKS.palletBasePrice)) settings.palletBasePrice = value;
    else if (label.includes(SETTING_MARKS.taxPerM3)) settings.taxPerM3 = value;
    else if (label.includes(SETTING_MARKS.agentKpiShare)) settings.agentKpiShare = value;
  }

  // ── справочниклар: har biri O'Z sarlavha katagidan boshlanadi ──
  const dictAt = (mark: string): { row: number; col: number } | null => {
    for (let r = 1; r <= last; r++) {
      for (let c = 1; c <= ws.columnCount; c++) {
        if (normHeader(text(r, c)) === mark) return { row: r, col: c };
      }
    }
    return null;
  };

  const clients: ClientDictEntry[] = [];
  const head = dictAt(CLIENT_DICT_MARK);
  if (!head) {
    throw new TemplateMismatchError(
      `«${SHEET.masterData}» varag'ida «Расмий ном» sarlavhasi yo'q — mijozlar справочниги topilmadi`,
    );
  }
  for (let r = head.row + 1; r <= last; r++) {
    const officialName = text(r, head.col);
    if (!officialName) continue; // справочникda oraliq bo'sh qatorlar bo'lishi mumkin
    const variants = [text(r, head.col + 1), text(r, head.col + 2)].filter((v) => v.length > 0);
    clients.push({
      origin: { sheetName: ws.name, excelRow: r },
      officialName,
      variants,
      legacyKey: text(r, head.col + 3),
      agentName: text(r, head.col + 4),
    });
  }

  /**
   * Bitta ustunli kichik ro'yxat: sarlavhadan pastga, BIRINCHI BO'SH katakkacha.
   *
   * Bu ro'yxatlar (zavodlar, to'lov turlari) uzunligi 2–3 qator bo'lgan uzluksiz jadvallar
   * va ular BITTA ustunda ketma-ket joylashgan: «Поставшик» (I10) → Коалс, Ментора → bo'sh
   * qator → «Тўлов тури» sarlavhasi (I14) → «Тур» (I15) → Касса, Перечисления.
   *
   * Shuning uchun bo'sh katak — ro'yxatning oxiri. Ilgari bu yerda «varaq oxirigacha o'qib,
   * ma'lum sarlavhalarda to'xtash» qilingandi va u JIM XATO berardi: keyingi bo'limning
   * «Тўлов тури» sarlavhasi zavod nomi bo'lib ro'yxatga tushib qolgandi (zavodlar 2 emas,
   * 3 ta ko'rinardi).
   */
  const listUnder = (mark: string): string[] => {
    const at = dictAt(mark);
    if (!at) return [];
    const out: string[] = [];
    for (let r = at.row + 1; r <= last; r++) {
      const v = text(r, at.col);
      if (!v) break;
      out.push(v);
    }
    return out;
  };

  // «Агент» so'zi mijoz справочнигида ham ustun nomi sifatida bor (E10), shuning uchun
  // agentlar ro'yxati mijoz jadvalining O'NGIDAN qidiriladi.
  const agents = (() => {
    const at = (() => {
      for (let r = 1; r <= last; r++) {
        for (let c = head.col + 5; c <= ws.columnCount; c++) {
          if (normHeader(text(r, c)) === AGENT_DICT_MARK) return { row: r, col: c };
        }
      }
      return null;
    })();
    if (!at) return [];
    const out: string[] = [];
    for (let r = at.row + 1; r <= last; r++) {
      const v = text(r, at.col);
      if (v) out.push(v);
    }
    return out;
  })();

  return {
    settings,
    clients,
    agents,
    factories: listUnder(FACTORY_DICT_MARK),
    payTypes: listUnder(PAYTYPE_DICT_MARK),
  };
}

/**
 * ═══════ EGASINING O'Z YIG'INDILARI (solishtirish uchun) ═══════
 *
 * Bu varaqlar butunlay formula — ular import QILINMAYDI. Lekin egasi ekranni aynan shular
 * bilan solishtiradi, shuning uchun import o'zi hisoblagan raqamni EGASINING raqami bilan
 * yonma-yon ko'rsatadi. Farq chiqsa, u «sayt yolg'on gapiryapti» emas, «qaysi varaq nima
 * deyapti» degan aniq savolga aylanadi.
 *
 * Varaq yo'q bo'lsa yoki tuzilishi o'zgargan bo'lsa — `null`. Solishtirish IXTIYORIY:
 * uning yo'qligi importni to'xtatmasligi kerak.
 */
export function parseDeclaredTotals(wb: WorkbookReader): DeclaredTotals {
  return {
    clientBalances: parseClientBalanceTotals(wb),
    factories: parseFactoryAccountTotals(wb),
  };
}

const CLIENT_BALANCE_SHEET = 'Мижозлар қолдиғи';
const FACTORY_ACCOUNT_SHEET = 'Поставшиклар ҳисоби';

function parseClientBalanceTotals(wb: WorkbookReader): DeclaredTotals['clientBalances'] {
  const ws = wb.worksheet(CLIENT_BALANCE_SHEET);
  if (!ws) return null;
  // «ЖАМИ» qatori — B ustunida. Qator raqami qotirilmaydi (mijoz qo'shilsa u pastga suriladi).
  for (let r = ws.rowCount; r >= 1; r--) {
    if (normHeader(readText(wb.cell(ws, r, 2))) !== 'жами') continue;
    const origin: RowOrigin = { sheetName: ws.name, excelRow: r };
    const money = (c: number) => readMoney(wb.cell(ws, r, c)).value;
    const int = (c: number) => readInt(wb.cell(ws, r, c));
    return {
      origin,
      sales: money(3), // C
      paid: money(4), // D
      goodsDebt: money(5), // E
      palletsTaken: int(6), // F
      palletsReturned: int(7), // G
      palletsPaidQty: int(8), // H
      palletsPaidMoney: money(9), // I
      palletDebtQty: int(10), // J
    };
  }
  return null;
}

function parseFactoryAccountTotals(wb: WorkbookReader): DeclaredTotals['factories'] {
  const ws = wb.worksheet(FACTORY_ACCOUNT_SHEET);
  if (!ws) return [];
  // Sarlavha: «Поставшик | Товар миқдори (куб) | Товар суммаси | Поддон сони | Поддон
  // суммаси | ЖАМИ ОЛИНГАН | ТЎЛАНГАН | ҚОЛДИҚ». Undan keyin har zavod bitta qator, oxirida
  // «ЖАМИ» — u o'tkazib yuboriladi (import zavodlarni ALOHIDA solishtiradi).
  let header = 0;
  for (let r = 1; r <= Math.min(ws.rowCount, 12); r++) {
    if (normHeader(readText(wb.cell(ws, r, 1))) === 'поставшик') { header = r; break; }
  }
  if (!header) return [];
  const out: DeclaredTotals['factories'] = [];
  for (let r = header + 1; r <= ws.rowCount; r++) {
    const name = readText(wb.cell(ws, r, 1));
    if (!name) continue;
    if (normHeader(name) === 'жами') break;
    const money = (c: number) => readMoney(wb.cell(ws, r, c)).value;
    out.push({
      origin: { sheetName: ws.name, excelRow: r },
      name,
      cube: readNumber(readCell(ws.getRow(r).getCell(2))),
      goods: money(3),
      palletQty: readInt(wb.cell(ws, r, 4)),
      palletMoney: money(5),
      taken: money(6),
      paid: money(7),
      balance: money(8),
    });
  }
  return out;
}
