import { Prisma, ImportIssueSeverity as Sev } from '@prisma/client';
import { isWarehousePalletMovement } from '../parse/pallet-kind';
import type {
  ClientPaymentRow, DeclaredTotals, FactoryPalletReturnRow, FactoryPaymentRow, IncompleteRow,
  MasterData, PalletReturnRow, RowOrigin, ShipmentRow,
} from '../parse/types';
import { normalizeSize } from '../resolve/entity-resolver';
import type { Dictionary } from '../resolve/dictionary';
import type { ImportRulesConfig } from './config';
import { classifyChannel, factoryReturnExpense, factoryDefectInputError } from '../commit/import-commit.service';
import { parseAgentKpiSettings } from '../../agents/agent-kpi.calculator';

const D = Prisma.Decimal;

/**
 * ═══════ QOIDALAR — SHABLON v5 ═══════
 *
 * Har bir qoida BITTA savolga javob beradi va uning javobi EGASIGA ko'rsatiladi. Qoida
 * qo'shishning yagona mezoni: «bu narsa noto'g'ri bo'lsa, u JIMGINA noto'g'ri bo'ladimi?»
 * Ekranda darhol ko'rinadigan xato uchun qoida kerak emas.
 *
 * Darajalar:
 *   BLOCK   — tuzatilmasa import qilinmaydi (pul yoki ayniyat noaniq)
 *   CONFIRM — tizim taklif qiladi, egasi ha/yo'q deydi
 *   WARN    — ko'rib chiqishga arziydi, lekin to'sib qo'ymaydi
 *   INFO    — shunchaki ma'lumot
 */

export interface Finding {
  ruleId: string;
  severity: Sev;
  origin: RowOrigin;
  field?: string;
  message: string; // to'liq o'zbekcha gap
  currentValue?: unknown;
  suggestedValue?: unknown;
}

export interface RuleContext {
  master: MasterData;
  shipments: ShipmentRow[];
  clientPayments: ClientPaymentRow[];
  factoryPayments: FactoryPaymentRow[];
  palletReturns: PalletReturnRow[];
  factoryPalletReturns: FactoryPalletReturnRow[];
  declared: DeclaredTotals;
  incomplete: IncompleteRow[];
  dict: Dictionary;
  cfg: ImportRulesConfig;
}

export interface Rule {
  id: string;
  nameUz: string;
  run(ctx: RuleContext): Finding[];
}

const fmt = (d: Prisma.Decimal | number | null | undefined): string =>
  d == null ? '—' : new D(d as Prisma.Decimal.Value).toDecimalPlaces(0).toNumber().toLocaleString('ru-RU');
const validDate = (d: Date | null): boolean => d instanceof Date && Number.isFinite(d.getTime());
const day = (d: Date | null): string => (validDate(d) ? d!.toISOString().slice(0, 10) : '—');
const at = (o: RowOrigin) => `«${o.sheetName}» r${o.excelRow}`;

/** Bir varaqning yig'indi qatori uchun sun'iy koordinata (qatorga bog'lanmagan topilma). */
const SHEET_LEVEL = (sheet: string): RowOrigin => ({ sheetName: sheet, excelRow: 0 });

const PALLET_SOZLAMALARI: Rule = {
  id: 'PALLET_SOZLAMALARI', nameUz: 'Poddon baholash narxi',
  run: ({ master }) => {
    const price = master.settings.palletBasePrice;
    if (price === null || (price.isFinite() && price.gt(0) && price.lte('999999999999') && price.decimalPlaces() <= 2)) return [];
    return [{ ruleId: 'PALLET_SOZLAMALARI', severity: Sev.BLOCK, origin: SHEET_LEVEL('Кўрсаткичлар'),
      field: 'palletBasePrice', message: 'Poddon narxi 0 dan katta, ko‘pi bilan 999999999999 va 2 kasr xonali bo‘lishi kerak.' }];
  },
};

const KPI_SOZLAMALARI: Rule = {
  id: 'KPI_SOZLAMALARI',
  nameUz: 'Agent KPI sozlamalari',
  run: ({ master }) => {
    const { taxPerM3, agentKpiShare } = master.settings;
    // Old templates can omit both. A half-filled setting must not silently use defaults.
    if (taxPerM3 === null && agentKpiShare === null) return [];
    try {
      parseAgentKpiSettings({ taxPerM3: taxPerM3?.toFixed(), agentShare: agentKpiShare?.toFixed() });
      return [];
    } catch { /* Surface the same validation as a review blocker before preview/commit. */ }
    return [{
      ruleId: 'KPI_SOZLAMALARI', severity: Sev.BLOCK,
      origin: SHEET_LEVEL('Кўрсаткичлар'),
      message: '«Кўрсаткичлар»: soliq 0 dan 999999999999 gacha (ko‘pi bilan 6 kasr xonasi), agent KPI ulushi 0 dan 1 gacha (ko‘pi bilan 20 kasr xonasi) bo‘lishi kerak. Ikkala sozlamani faylda to‘ldirib, qayta yuklang.',
    }];
  },
};

// ═══════════════ 1) AYNIYAT ═══════════════

const MIJOZ_YOQ: Rule = {
  id: 'MIJOZ_YOQ',
  nameUz: 'Mijoz справочникда yo‘q',
  run: (ctx) => {
    const out: Finding[] = [];
    const seen = new Set<string>();
    const check = (raw: string, origin: RowOrigin) => {
      const t = raw.trim();
      if (!t) {
        out.push({
          ruleId: MIJOZ_YOQ.id, severity: Sev.BLOCK, origin, field: 'clientRaw',
          message: `${at(origin)}: mijoz nomi bo‘sh — kimning hisobiga yozilishini ayting.`,
        });
        return;
      }
      const r = ctx.dict.resolveClient(t);
      if (r.canonical) return;
      if (seen.has(t)) return;
      seen.add(t);
      out.push({
        ruleId: MIJOZ_YOQ.id, severity: Sev.BLOCK, origin, field: 'clientRaw',
        message:
          `${at(origin)}: «${t}» «Кўрсаткичлар» справочнигида yo‘q. ` +
          (r.suggestion
            ? `Ehtimol «${r.suggestion.name}» (o‘xshashlik ${r.suggestion.confidence}).`
            : 'Справочникка qo‘shing yoki to‘g‘ri nomni tanlang.'),
        currentValue: t,
        suggestedValue: r.suggestion?.name,
      });
    };
    for (const r of ctx.shipments) check(r.clientRaw, r.origin);
    for (const p of ctx.clientPayments) check(p.clientRaw, p.origin);
    for (const p of ctx.palletReturns) if (!isWarehousePalletMovement(p)) check(p.clientRaw, p.origin);
    return out;
  },
};

const ZAVOD_NOMALUM: Rule = {
  id: 'ZAVOD_NOMALUM',
  nameUz: 'Zavod справочникда yo‘q',
  run: (ctx) => {
    const out: Finding[] = [];
    const seen = new Set<string>();
    const check = (raw: string, origin: RowOrigin) => {
      const t = raw.trim();
      if (ctx.dict.resolveFactory(t) || (t && seen.has(t))) return;
      seen.add(t);
      out.push({
        ruleId: ZAVOD_NOMALUM.id, severity: Sev.BLOCK, origin, field: 'factoryRaw',
        message: `${at(origin)}: «${t || '(bo‘sh)'}» zavodi справочникда yo‘q — hisob qaysi zavodga yozilishi noma’lum.`,
        currentValue: t,
      });
    };
    for (const r of ctx.shipments) check(r.factoryRaw, r.origin);
    for (const p of ctx.factoryPayments) check(p.factoryRaw, p.origin);
    for (const p of ctx.factoryPalletReturns) check(p.factoryRaw, p.origin);
    return out;
  },
};

/**
 * Varaqdagi agent справочникдаги agentdan farq qiladi.
 *
 * Faylning O'ZIDA shu tekshiruv bor («Товар» V ustuni «Агент текшируви»), ya'ni egasi uni
 * ko'rishga odatlangan. Import ham ko'rsatadi: aks holda buyurtma BOSHQA agentning hisobiga
 * tushib, uning yig'ish foizi va KPI'si jimgina buzilardi.
 */
const AGENT_FARQI: Rule = {
  id: 'AGENT_FARQI',
  nameUz: 'Agent справочникдагиdan farq qiladi',
  run: (ctx) => {
    const out: Finding[] = [];
    const check = (clientRaw: string, agentRaw: string, origin: RowOrigin) => {
      const c = ctx.dict.resolveClient(clientRaw);
      if (!c.canonical || !c.agentName) return;
      const sheetAgent = ctx.dict.resolveAgent(agentRaw);
      if (!sheetAgent || sheetAgent === c.agentName) return;
      out.push({
        ruleId: AGENT_FARQI.id, severity: Sev.WARN, origin, field: 'agentRaw',
        message:
          `${at(origin)}: «${c.canonical}» справочникда «${c.agentName}» ga biriktirilgan, ` +
          `qatorda esa «${sheetAgent}». Справочник ustun deb olinadi.`,
        currentValue: sheetAgent, suggestedValue: c.agentName,
      });
    };
    for (const r of ctx.shipments) check(r.clientRaw, r.agentRaw, r.origin);
    for (const p of ctx.clientPayments) check(p.clientRaw, p.agentRaw, p.origin);
    return out;
  },
};

// ═══════════════ 2) TO'LIQLIK ═══════════════

const QATOR_TOLIQ_EMAS: Rule = {
  id: 'QATOR_TOLIQ_EMAS',
  nameUz: 'Qator to‘ldirilmagan — import qilinmadi',
  run: (ctx) =>
    ctx.incomplete.map((x) => ({
      ruleId: QATOR_TOLIQ_EMAS.id, severity: Sev.WARN, origin: x.origin,
      message:
        `${at(x.origin)}${x.summary ? ` (${x.summary})` : ''}: ${x.missing.join(', ')} yozilmagan — ` +
        'bu qator import QILINMADI. To‘ldirib qayta yuklang yoki e’tiborsiz qoldiring.',
      currentValue: x.summary || null,
    })),
};

const YUK_MAJBURIY_MAYDON: Rule = {
  id: 'YUK_MAJBURIY_MAYDON',
  nameUz: 'Yukda majburiy maydon yo‘q',
  run: (ctx) => {
    const out: Finding[] = [];
    for (const r of ctx.shipments) {
      const miss = (field: string, what: string) =>
        out.push({
          ruleId: YUK_MAJBURIY_MAYDON.id, severity: Sev.BLOCK, origin: r.origin, field,
          message: `${at(r.origin)}: ${what} yo‘q — buyurtma yozib bo‘lmaydi.`,
        });
      if (!validDate(r.date)) miss('date', 'to‘g‘ri sana');
      if (r.cube == null || !Number.isFinite(r.cube) || r.cube <= 0) miss('cube', 'blok hajmi (куб)');
      if (!r.costPrice?.isFinite() || r.costPrice.lte(0)) miss('costPrice', 'zavod narxi (Цена Приход)');
      if (!r.salePrice?.isFinite() || r.salePrice.lte(0)) miss('salePrice', 'sotuv narxi (Цена Продажа)');
    }
    return out;
  },
};

const SANA_NOTOGRI: Rule = {
  id: 'SANA_NOTOGRI', nameUz: 'Amaliyot sanasi noto‘g‘ri',
  run: (ctx) => [
    ...ctx.clientPayments, ...ctx.factoryPayments, ...ctx.palletReturns, ...ctx.factoryPalletReturns,
  ].filter((r) => !validDate(r.date)).map((r) => ({
    ruleId: 'SANA_NOTOGRI', severity: Sev.BLOCK, origin: r.origin, field: 'date',
    message: `${at(r.origin)}: sana yo‘q yoki noto‘g‘ri — hisob davrini aniqlamasdan import qilib bo‘lmaydi.`,
  })),
};

const SON_NOTOGRI: Rule = {
  id: 'SON_NOTOGRI', nameUz: 'Son yoki summa noto‘g‘ri',
  run: (ctx) => {
    const out: Finding[] = [];
    const reject = (origin: RowOrigin, field: string, message: string) => out.push({
      ruleId: SON_NOTOGRI.id, severity: Sev.BLOCK, origin, field, message: `${at(origin)}: ${message}`,
    });
    const qty = (value: number | null, origin: RowOrigin, field: string, signed: boolean) => {
      if (value === null) return;
      if (!Number.isSafeInteger(value) || Math.abs(value) > 2_147_483_647 || (!signed && value < 0)) {
        reject(origin, field, 'paddon soni butun dona bo‘lishi kerak; yukdagi son manfiy bo‘lishi mumkin emas.');
      }
    };
    const money = (value: Prisma.Decimal | null, origin: RowOrigin, field: string) => {
      if (value && !value.isFinite()) reject(origin, field, 'summa chekli raqam bo‘lishi kerak.');
    };
    for (const r of ctx.shipments) {
      qty(r.palletQty, r.origin, 'palletQty', false);
      if (r.cube !== null && Number.isFinite(r.cube) &&
        new D(String(r.cube)).minus(new D(String(r.cube)).toDP(3)).abs().gt('0.000000001')) {
        reject(r.origin, 'cube', 'hajm aniqligi 0.001 m³ dan oshmasligi kerak — jim yaxlitlash qilinmaydi.');
      }
      money(r.transportCost, r.origin, 'transportCost');
      if (r.transportCost?.lt(0)) reject(r.origin, 'transportCost', 'transport xarajati manfiy bo‘lishi mumkin emas.');
      if (/^клиент$/i.test(r.transportPayerRaw.trim()) && r.cube !== null && Number.isFinite(r.cube) &&
        r.salePrice?.isFinite() && r.transportCost?.gt(r.salePrice.mul(r.cube))) {
        reject(r.origin, 'transportCost', 'mijoz to‘laydigan transport sotuv summasidan oshgan.');
      }
    }
    for (const p of ctx.clientPayments) {
      qty(p.palletQty, p.origin, 'palletQty', true);
      for (const field of ['bank', 'cash', 'click', 'terminal', 'palletPrice'] as const) money(p[field], p.origin, field);
      const price = p.palletPrice ?? ctx.master.settings.palletBasePrice;
      if (p.palletQty && price && (!price.isFinite() || price.lte(0))) {
        reject(p.origin, 'palletPrice', 'paddon puli yozilgan qatorda narx musbat bo‘lishi kerak.');
      }
    }
    for (const p of ctx.factoryPayments) money(p.amount, p.origin, 'amount');
    for (const p of ctx.palletReturns) qty(p.qty, p.origin, 'qty', true);
    for (const p of ctx.factoryPalletReturns) {
      qty(p.qty, p.origin, 'qty', true);
      if (p.movementType && !['RETURNED_TO_FACTORY', 'DEFECTIVE_FROM_FACTORY'].includes(p.movementType)) {
        reject(p.origin, 'movementType', 'harakat turi RETURNED_TO_FACTORY (qaytarish) yoki DEFECTIVE_FROM_FACTORY (zavoddan yaroqsiz) bo‘lishi kerak.');
      }
      if (p.movementType === 'DEFECTIVE_FROM_FACTORY') {
        if ((p.unitCost && !p.unitCost.isZero()) || (p.totalCostDeclared && !p.totalCostDeclared.isZero())) {
          reject(p.origin, 'unitCost', 'zavoddan yaroqsiz poddonni chiqarish pul yoki qaytarish xarajati yaratmaydi — xarajat 0 bo‘lishi kerak.');
        }
        const invalid = factoryDefectInputError(p);
        if (invalid) reject(p.origin, invalid.field, invalid.message);
      }
      money(p.unitCost, p.origin, 'unitCost');
      money(p.totalCostDeclared, p.origin, 'totalCostDeclared');
      if (!p.qty && !factoryReturnExpense(p).isZero()) {
        reject(p.origin, 'qty', 'qaytarish xarajati bor, lekin paddon soni 0 — xarajatni zavod qaytarishiga bog‘lash uchun dona sonini to‘ldiring.');
      }
      if (p.unitCost?.lt(0)) reject(p.origin, 'unitCost', 'bir dona qaytarish xarajati manfiy bo‘lishi mumkin emas.');
    }
    return out;
  },
};

// ═══════════════ 3) KANAL / REJIM ═══════════════

const TOLOV_TURI_NOMALUM: Rule = {
  id: 'TOLOV_TURI_NOMALUM',
  nameUz: 'To‘lov turi tanilmadi',
  run: (ctx) => {
    const out: Finding[] = [];
    const check = (word: string, origin: RowOrigin, field: string, what: string) => {
      const t = word.trim();
      if (t && classifyChannel(t)) return;
      out.push({
        ruleId: TOLOV_TURI_NOMALUM.id, severity: Sev.BLOCK, origin, field,
        message:
          `${at(origin)}: ${what} «${t || '(bo‘sh)'}» tanilmadi. ` +
          '«Касса» yoki «Перечисления» deb yozing — bu pul qaysi kassadan o‘tishini belgilaydi.',
        currentValue: t,
      });
    };
    for (const r of ctx.shipments) check(r.factoryPayChannel, r.origin, 'factoryPayChannel', 'to‘lov turi');
    for (const p of ctx.factoryPayments) check(p.channel, p.origin, 'channel', 'to‘lov turi (В-о)');
    for (const p of ctx.factoryPalletReturns) {
      if (!factoryReturnExpense(p).isZero()) check(p.channel, p.origin, 'channel', 'qaytarish xarajati to‘lov turi');
    }
    return out;
  },
};

const TRANSPORT_TOLOVCHI_NOMALUM: Rule = {
  id: 'TRANSPORT_TOLOVCHI_NOMALUM',
  nameUz: 'Transportni kim to‘lagani noma’lum',
  run: (ctx) =>
    ctx.shipments
      .filter((r) => !/^(клиент|сотувчи)$/i.test(r.transportPayerRaw.trim()))
      .map((r) => ({
        ruleId: TRANSPORT_TOLOVCHI_NOMALUM.id, severity: Sev.BLOCK, origin: r.origin, field: 'transportPayerRaw',
        message:
          `${at(r.origin)}: «Расход Авто» = «${r.transportPayerRaw || '(bo‘sh)'}». ` +
          '«Клиент» (mijoz shofyorga o‘zi to‘laydi) yoki «Сотувчи» (biz to‘laymiz) bo‘lishi kerak — ' +
          'bu mijozdan so‘raladigan summani belgilaydi.',
        currentValue: r.transportPayerRaw,
      })),
};

const TOLOV_KANALI_YOQ: Rule = {
  id: 'TOLOV_KANALI_YOQ',
  nameUz: 'To‘lovda kanal ustuni bo‘sh',
  run: (ctx) =>
    ctx.clientPayments
      .filter((p) => {
        const any = [p.bank, p.cash, p.click, p.terminal].some((v) => v && !v.isZero());
        const declared = p.totalDeclared && !p.totalDeclared.isZero();
        return !any && declared;
      })
      .map((p) => ({
        ruleId: TOLOV_KANALI_YOQ.id, severity: Sev.BLOCK, origin: p.origin,
        message:
          `${at(p.origin)}: «Жами сумма» ${fmt(p.totalDeclared)} so‘m, lekin ПР-Сумма/Накд/Клик/Терминал ` +
          'ustunlarining hammasi bo‘sh — pul qaysi kassaga tushganini ayting.',
        currentValue: p.totalDeclared?.toString(),
      })),
};

// ═══════════════ 4) FORMULA / IZCHILLIK ═══════════════

/**
 * Faylning KESHLANGAN formula natijasi qayta hisoblangani bilan mos kelmaydi.
 *
 * Excel formulani qayta hisoblamasdan saqlanishi mumkin (masalan boshqa faylga havola
 * uzilgan bo'lsa). Import har doim O'ZI qayta hisoblaydi, lekin farqni AYTADI — aks holda
 * egasi ekranda ko'rgan raqam faylidagidan boshqa bo'lib chiqadi va sababi ko'rinmaydi.
 */
const FORMULA_FARQI: Rule = {
  id: 'FORMULA_FARQI',
  nameUz: 'Fayldagi hisoblangan katak mos emas',
  run: (ctx) => {
    const out: Finding[] = [];
    const TOL = new D('1'); // 1 so'm — Excel'ning o'z yaxlitlashi
    const cmp = (origin: RowOrigin, calc: Prisma.Decimal, declared: Prisma.Decimal | null, what: string) => {
      if (!declared || !calc.isFinite() || !declared.isFinite()) return;
      if (calc.minus(declared).abs().lte(TOL)) return;
      out.push({
        ruleId: FORMULA_FARQI.id, severity: Sev.WARN, origin,
        message: `${at(origin)}: ${what} — faylda ${fmt(declared)}, hisoblanganda ${fmt(calc)}. ` +
          'Import HISOBLANGANINI oladi (Excel katagi eskirgan bo‘lishi mumkin).',
        currentValue: declared.toString(), suggestedValue: calc.toString(),
      });
    };
    for (const r of ctx.shipments) {
      const m3 = new D(String(r.cube ?? 0));
      const cost = m3.mul(r.costPrice ?? 0);
      const sale = m3.mul(r.salePrice ?? 0);
      const clientPays = /^клиент$/i.test(r.transportPayerRaw.trim());
      const charge = sale.minus(clientPays ? (r.transportCost ?? new D(0)) : new D(0));
      const pallet = new D(r.palletQty ?? 0).mul(r.palletPrice ?? ctx.master.settings.palletBasePrice ?? 130000);
      cmp(r.origin, cost, r.costSumDeclared, '«Сумма Приход»');
      cmp(r.origin, sale, r.saleSumDeclared, '«Сумма Продажа»');
      cmp(r.origin, charge, r.clientChargeDeclared, '«Мижозга»');
      cmp(r.origin, pallet, r.palletSumDeclared, '«Сумма Поддон»');
      cmp(r.origin, cost.plus(pallet), r.takenSumDeclared, '«Блок+Поддон»');
      cmp(r.origin, sale.minus(cost).minus(r.transportCost ?? 0), r.profitDeclared, '«Общая прибль»');
    }
    for (const p of ctx.clientPayments) {
      const total = [p.bank, p.cash, p.click, p.terminal].reduce<Prisma.Decimal>((a, v) => (v ? a.plus(v) : a), new D(0));
      const pallet = new D(p.palletQty ?? 0).mul(p.palletPrice ?? ctx.master.settings.palletBasePrice ?? 130000);
      cmp(p.origin, total, p.totalDeclared, '«Жами сумма»');
      cmp(p.origin, pallet, p.palletMoneyDeclared, '«Поддон пули»');
      cmp(p.origin, total.minus(pallet), p.goodsMoneyDeclared, '«Товарга»');
    }
    for (const p of ctx.factoryPalletReturns) {
      if (p.unitCost !== null) cmp(p.origin, factoryReturnExpense(p), p.totalCostDeclared, '«Қайтариш харажати жами»');
    }
    return out;
  },
};

/** Bir xil mijoz + sana + mashina + hajm — ikki marta yozilgan yuk. */
const TAKRORIY_YUK: Rule = {
  id: 'TAKRORIY_YUK',
  nameUz: 'Yuk ikki marta yozilgan bo‘lishi mumkin',
  run: (ctx) => {
    const seen = new Map<string, RowOrigin>();
    const out: Finding[] = [];
    for (const r of ctx.shipments) {
      const key = [r.clientRaw.trim(), day(r.date), r.truck.trim(), String(r.cube ?? '')].join('|');
      const first = seen.get(key);
      if (first) {
        out.push({
          ruleId: TAKRORIY_YUK.id, severity: Sev.CONFIRM, origin: r.origin,
          message:
            `${at(r.origin)}: ${at(first)} bilan bir xil (mijoz, sana, mashina, hajm). ` +
            'Haqiqatan ikki mashinami yoki takroriy yozuvmi?',
          currentValue: key,
        });
      } else seen.set(key, r.origin);
    }
    return out;
  },
};

// ═══════════════ 5) MANTIQIY CHEGARALAR ═══════════════

const USTAMA_CHEGARASI: Rule = {
  id: 'USTAMA_CHEGARASI',
  nameUz: 'Ustama odatdagidan chetda',
  run: (ctx) => {
    const { minPct, maxPct } = ctx.cfg.ustamaChegarasi;
    const out: Finding[] = [];
    for (const r of ctx.shipments) {
      if (!r.costPrice || r.costPrice.lte(0) || !r.salePrice || r.salePrice.lte(0)) continue;
      const pct = r.salePrice.minus(r.costPrice).div(r.costPrice).mul(100);
      if (pct.gte(minPct) && pct.lte(maxPct)) continue;
      out.push({
        ruleId: USTAMA_CHEGARASI.id, severity: Sev.WARN, origin: r.origin,
        message:
          `${at(r.origin)}: ustama ${pct.toDecimalPlaces(1)}% ` +
          `(zavod ${fmt(r.costPrice)} → sotuv ${fmt(r.salePrice)}), odatdagi oraliq ${minPct}–${maxPct}%.`,
        currentValue: pct.toDecimalPlaces(2).toString(),
      });
    }
    return out;
  },
};

const PODDON_NISBATI: Rule = {
  id: 'PODDON_NISBATI',
  nameUz: 'Poddon soni hajmga mos emas',
  run: (ctx) => {
    const { m3PerPallet, bySize, tolerance } = ctx.cfg.poddonNisbati;
    const out: Finding[] = [];
    for (const r of ctx.shipments) {
      if (!r.palletQty || r.palletQty <= 0 || !r.cube) continue;
      const per = bySize[normalizeSize(r.size)] ?? m3PerPallet;
      const expected = r.cube / per;
      if (Math.abs(expected - r.palletQty) <= tolerance) continue;
      out.push({
        ruleId: PODDON_NISBATI.id, severity: Sev.WARN, origin: r.origin,
        message:
          `${at(r.origin)}: ${r.cube} m³ uchun ~${expected.toFixed(1)} poddon kutiladi, ` +
          `qatorda ${r.palletQty} ta.`,
        currentValue: r.palletQty, suggestedValue: Math.round(expected),
      });
    }
    return out;
  },
};

const MOSHINA_SIGIMI: Rule = {
  id: 'MOSHINA_SIGIMI',
  nameUz: 'Bitta mashinaga sig‘maydigan yuk',
  run: (ctx) =>
    ctx.shipments
      .filter((r) => (r.palletQty ?? 0) > ctx.cfg.moshinaSigimi.pallets)
      .map((r) => ({
        ruleId: MOSHINA_SIGIMI.id, severity: Sev.WARN, origin: r.origin,
        message:
          `${at(r.origin)}: ${r.palletQty} poddon — bitta mashina sig‘imi ${ctx.cfg.moshinaSigimi.pallets} ta. ` +
          'Ikki reysmi yoki xato yozuvmi?',
        currentValue: r.palletQty,
      })),
};

// ═══════════════ 6) PADDON MUVOZANATI ═══════════════

/**
 * Mijoz olganidan KO'PROQ qaytargan yoki puli to'langan.
 *
 * Faylning O'Z «Текширув» varag'ining 1-bo'limi aynan shuni sanaydi va etalon faylda 7 ta
 * mijoz chiqadi (masalan «Мята Газаблок»: olgani 171, puli to'langani 228). Bu odatda XATO
 * emas — mijoz paddonni fayl davri BOSHLANISHIDAN oldin olgan, faylda esa boshlang'ich
 * qoldiq ustuni yo'q. Import qatorni QISQARTIRMAYDI (pul yo'qolmasin), lekin har birini
 * nomma-nom aytadi.
 */
const PADDON_ORTIQCHA: Rule = {
  id: 'PADDON_ORTIQCHA',
  nameUz: 'Mijozda ortiqcha poddon',
  run: (ctx) => {
    const taken = new Map<string, number>();
    const returned = new Map<string, number>();
    const paid = new Map<string, number>();
    const where = new Map<string, RowOrigin>();
    const key = (raw: string) => ctx.dict.resolveClient(raw).canonical ?? raw.trim();

    for (const r of ctx.shipments) {
      const k = key(r.clientRaw);
      taken.set(k, (taken.get(k) ?? 0) + (r.palletQty ?? 0));
      if (!where.has(k)) where.set(k, r.origin);
    }
    for (const p of ctx.palletReturns) {
      if (isWarehousePalletMovement(p)) continue;
      const k = key(p.clientRaw);
      returned.set(k, (returned.get(k) ?? 0) + (p.qty ?? 0));
      if (!where.has(k)) where.set(k, p.origin);
    }
    for (const p of ctx.clientPayments) {
      const k = key(p.clientRaw);
      paid.set(k, (paid.get(k) ?? 0) + (p.palletQty ?? 0));
      if (!where.has(k)) where.set(k, p.origin);
    }

    const out: Finding[] = [];
    for (const k of new Set([...taken.keys(), ...returned.keys(), ...paid.keys()])) {
      const t = taken.get(k) ?? 0;
      const rt = returned.get(k) ?? 0;
      const pd = paid.get(k) ?? 0;
      const excess = rt + pd - t;
      if (excess <= 0) continue;
      out.push({
        ruleId: PADDON_ORTIQCHA.id, severity: Sev.WARN,
        origin: where.get(k) ?? SHEET_LEVEL('Поддон қайтариш'),
        message:
          `«${k}»: olgani ${t}, qaytargani ${rt}, puli to‘langani ${pd} — ${excess} ta ortiqcha. ` +
          'Odatda bu paddon fayl davridan OLDIN olingan degani; qator o‘zgartirilmasdan import qilinadi.',
        currentValue: excess,
      });
    }
    return out;
  },
};

/** A negative correction must have a matching earlier movement; never fabricate stock. */
const PADDON_TUZATISH: Rule = {
  id: 'PADDON_TUZATISH', nameUz: 'Paddon tuzatishining asl qatori topilmadi',
  run: (ctx) => {
    const out: Finding[] = [];
    const check = (
      rows: Array<{ origin: RowOrigin; party: string; qty: number | null; price?: Prisma.Decimal }>,
    ) => {
      const pools = new Map<string, Array<{ qty: number; price?: Prisma.Decimal }>>();
      for (const row of rows) {
        if (!row.qty || !Number.isSafeInteger(row.qty)) continue;
        const pool = pools.get(row.party) ?? [];
        pools.set(row.party, pool);
        if (row.qty > 0) { pool.push({ qty: row.qty, price: row.price }); continue; }
        let left = -row.qty;
        let actualMoney = new D(0);
        for (let i = pool.length - 1; i >= 0 && left > 0; i--) {
          const take = Math.min(left, pool[i].qty);
          pool[i].qty -= take;
          left -= take;
          if (pool[i].price) actualMoney = actualMoney.plus(pool[i].price!.mul(take));
        }
        if (left > 0) {
          out.push({
            ruleId: PADDON_TUZATISH.id, severity: Sev.BLOCK, origin: row.origin,
            message: `${at(row.origin)}: ${left} dona manfiy tuzatish uchun shu tomonning oldingi musbat qatori yo‘q. ` +
              'Asl harakatni kiriting — qoldiq sun’iy tuzatish bilan almashtirilmaydi.',
            currentValue: row.qty,
          });
        } else if (row.price && actualMoney.minus(row.price.mul(-row.qty)).abs().gt('0.01')) {
          out.push({
            ruleId: PADDON_TUZATISH.id, severity: Sev.BLOCK, origin: row.origin, field: 'palletPrice',
            message: `${at(row.origin)}: paddon tuzatishi asl narxlar bo‘yicha ${fmt(actualMoney)} so‘m. ` +
              'Tuzatish qatoridagi narx avvalgi undirish narxiga mos emas.',
            currentValue: row.price.toString(),
          });
        }
      }
    };
    const client = (raw: string) => ctx.dict.resolveClient(raw).canonical ?? raw.trim();
    check(ctx.palletReturns.filter((p) => !isWarehousePalletMovement(p)).map((p) => ({ ...p, party: client(p.clientRaw) })));
    check(ctx.factoryPalletReturns.map((p) => ({ ...p, party: `${p.movementType || 'RETURNED_TO_FACTORY'}|${ctx.dict.resolveFactory(p.factoryRaw) ?? p.factoryRaw.trim()}` })));
    check(ctx.clientPayments.map((p) => ({
      origin: p.origin, party: client(p.clientRaw), qty: p.palletQty,
      price: p.palletPrice ?? ctx.master.settings.palletBasePrice ?? new D(130000),
    })));
    return out;
  },
};

// ═══════════════ 7) EGASINING O'Z YIG'INDILARI BILAN SOLISHTIRISH ═══════════════

/**
 * Import hisoblagan yig'indi egasining O'Z hisobot varaqlaridagi raqamga tushdimi.
 *
 * Bu qoidaning maqsadi xatoni topish emas — ISHONCH: egasi «Мижозлар қолдиғи» varag'idagi
 * raqamni yodda tutadi va saytda boshqa son ko'rsa, importga ishonmay qo'yadi. Farq bo'lsa
 * u YASHIRILMAYDI, aynan qaysi varaq nima deyayotgani yoziladi.
 */
const JAMI_FARQI: Rule = {
  id: 'JAMI_FARQI',
  nameUz: 'Yig‘indi egasining varag‘i bilan mos emas',
  run: (ctx) => {
    const out: Finding[] = [];
    const d = ctx.declared.clientBalances;
    const TOL = new D('1');
    const compareMoney = (origin: RowOrigin, calc: Prisma.Decimal, declared: Prisma.Decimal | null, label: string) => {
      if (!declared || !calc.isFinite() || calc.minus(declared).abs().lte(TOL)) return;
      out.push({
        ruleId: JAMI_FARQI.id, severity: Sev.WARN, origin,
        message: `${at(origin)} ${label}: varaqda ${fmt(declared)}, import hisobladi ${fmt(calc)} — ` +
          `farq ${fmt(calc.minus(declared))} so‘m.`,
        currentValue: declared.toString(), suggestedValue: calc.toString(),
      });
    };
    for (const f of ctx.declared.factories) {
      const name = ctx.dict.resolveFactory(f.name) ?? f.name;
      const ships = ctx.shipments.filter((s) => (ctx.dict.resolveFactory(s.factoryRaw) ?? s.factoryRaw) === name);
      const paid = ctx.factoryPayments.filter((p) => (ctx.dict.resolveFactory(p.factoryRaw) ?? p.factoryRaw) === name)
        .reduce((a, p) => a.plus(p.amount ?? 0), new D(0));
      const goods = ships.reduce((a, s) => a.plus(new D(s.cube ?? 0).mul(s.costPrice ?? 0).toDP(2)), new D(0));
      const pallets = ships.reduce((a, s) => a.plus(new D(s.palletQty ?? 0).mul(s.palletPrice ?? ctx.master.settings.palletBasePrice ?? 130000)), new D(0));
      compareMoney(f.origin, goods, f.goods, `${name} blok tannarxi`);
      compareMoney(f.origin, paid, f.paid, `${name} to‘langan summa`);
      compareMoney(f.origin, pallets, f.palletMoney, `${name} Excel paddon puli`);
    }
    if (!d) return out;
    const origin = d.origin;

    const sales = ctx.shipments.reduce<Prisma.Decimal>((a, r) => {
      const m3 = new D(String(r.cube ?? 0));
      const sale = m3.mul(r.salePrice ?? 0);
      const clientPays = /^клиент$/i.test(r.transportPayerRaw.trim());
      return a.plus(sale.minus(clientPays ? (r.transportCost ?? new D(0)) : new D(0)));
    }, new D(0));
    const paidPallets = ctx.clientPayments.reduce((a, p) => a.plus(new D(p.palletQty ?? 0)
      .mul(p.palletPrice ?? ctx.master.settings.palletBasePrice ?? 130000)), new D(0));
    const paidTotal = ctx.clientPayments.reduce((a, p) => a.plus([p.bank, p.cash, p.click, p.terminal]
      .reduce<Prisma.Decimal>((sum, amount) => sum.plus(amount ?? 0), new D(0))), new D(0));
    const paidGoods = paidTotal.minus(paidPallets);
    compareMoney(origin, sales, d.sales, 'mijozga sotuv');
    compareMoney(origin, paidGoods, d.paid, 'tovarga to‘lov');
    compareMoney(origin, paidPallets, d.palletsPaidMoney, 'paddon uchun to‘lov');
    // Excel uses credit-positive balances; the application's debt view has the
    // opposite sign. Compare in the workbook's convention here.
    compareMoney(origin, paidGoods.minus(sales), d.goodsDebt, 'tovar qarzi');

    const takenQty = ctx.shipments.reduce((a, r) => a + (r.palletQty ?? 0), 0);
    const retQty = ctx.palletReturns.filter((r) => !isWarehousePalletMovement(r)).reduce((a, r) => a + (r.qty ?? 0), 0);
    const paidQty = ctx.clientPayments.reduce((a, p) => a + (p.palletQty ?? 0), 0);
    const cmpQty = (calc: number, declared: number | null, what: string) => {
      if (declared == null || calc === declared) return;
      out.push({
        ruleId: JAMI_FARQI.id, severity: Sev.WARN, origin,
        message: `«Мижозлар қолдиғи» ${what}: varaqda ${declared} dona, import hisobladi ${calc} dona.`,
        currentValue: declared, suggestedValue: calc,
      });
    };
    cmpQty(takenQty, d.palletsTaken, 'olingan poddon');
    cmpQty(retQty, d.palletsReturned, 'qaytarilgan poddon');
    cmpQty(paidQty, d.palletsPaidQty, 'puli to‘langan poddon');
    cmpQty(retQty + paidQty - takenQty, d.palletDebtQty, 'paddon qarzi');

    return out;
  },
};

/** Disclose both debt views while retaining the stable legacy rule identifier. */
const ZAVOD_PADDON_PULI: Rule = {
  id: 'ZAVOD_PADDON_PULI',
  nameUz: 'Zavod qarzi — paddonsiz va paddon bilan',
  run: (ctx) => {
    const price = ctx.master.settings.palletBasePrice ?? new D(130000);
    const takenQty = ctx.shipments.reduce((a, r) => a + (r.palletQty ?? 0), 0);
    const takenMoney = ctx.shipments.reduce((a, r) => a.plus(new D(r.palletQty ?? 0).mul(r.palletPrice ?? price)), new D(0));
    const backQty = ctx.factoryPalletReturns.reduce((a, r) => a + (r.qty ?? 0), 0);
    const expense = ctx.factoryPalletReturns.reduce<Prisma.Decimal>((a, r) => a.plus(factoryReturnExpense(r)), new D(0));
    if (takenQty === 0) return [];
    const gap = takenMoney.minus(price.mul(backQty)).minus(expense);
    return [{
      ruleId: ZAVOD_PADDON_PULI.id, severity: Sev.INFO,
      origin: SHEET_LEVEL('Поставшиклар ҳисоби'),
      message:
        `Zavod hisobi ikki ko‘rinishda: paddonsiz qarz = mol summasi − to‘lov − qaytarish harajati (${fmt(expense)}). ` +
        `Paddon bilan qarz = paddonsiz qarz + qolgan ${takenQty - backQty} dona × joriy narx ${fmt(price)}. ` +
        `Narxni sozlamadan o‘zgartirish oldingi to‘lovlarni o‘zgartirmaydi.`,
      currentValue: gap.toString(),
    }];
  },
};

export const RULES: Rule[] = [
  KPI_SOZLAMALARI,
  PALLET_SOZLAMALARI,
  MIJOZ_YOQ,
  ZAVOD_NOMALUM,
  AGENT_FARQI,
  QATOR_TOLIQ_EMAS,
  YUK_MAJBURIY_MAYDON,
  SANA_NOTOGRI,
  SON_NOTOGRI,
  TOLOV_TURI_NOMALUM,
  TRANSPORT_TOLOVCHI_NOMALUM,
  TOLOV_KANALI_YOQ,
  FORMULA_FARQI,
  TAKRORIY_YUK,
  USTAMA_CHEGARASI,
  PODDON_NISBATI,
  MOSHINA_SIGIMI,
  PADDON_ORTIQCHA,
  PADDON_TUZATISH,
  JAMI_FARQI,
  ZAVOD_PADDON_PULI,
];
