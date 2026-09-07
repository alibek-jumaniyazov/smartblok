import { Prisma, ImportIssueSeverity as Sev } from '@prisma/client';
import type {
  ClientPaymentRow, DeclaredTotals, FactoryPalletReturnRow, FactoryPaymentRow, IncompleteRow,
  MasterData, PalletReturnRow, RowOrigin, ShipmentRow,
} from '../parse/types';
import { normalizeSize } from '../resolve/entity-resolver';
import type { Dictionary } from '../resolve/dictionary';
import type { ImportRulesConfig } from './config';
import { classifyChannel } from '../commit/import-commit.service';

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
const day = (d: Date | null): string => (d ? d.toISOString().slice(0, 10) : '—');
const at = (o: RowOrigin) => `«${o.sheetName}» r${o.excelRow}`;

/** Bir varaqning yig'indi qatori uchun sun'iy koordinata (qatorga bog'lanmagan topilma). */
const SHEET_LEVEL = (sheet: string): RowOrigin => ({ sheetName: sheet, excelRow: 0 });

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
    for (const p of ctx.palletReturns) check(p.clientRaw, p.origin);
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
      if (!t || ctx.dict.resolveFactory(t) || seen.has(t)) return;
      seen.add(t);
      out.push({
        ruleId: ZAVOD_NOMALUM.id, severity: Sev.BLOCK, origin, field: 'factoryRaw',
        message: `${at(origin)}: «${t}» zavodi справочникда yo‘q — hisob qaysi zavodga yozilishi noma’lum.`,
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
      if (!r.date) miss('date', 'sana');
      if (r.cube == null || r.cube <= 0) miss('cube', 'blok hajmi (куб)');
      if (!r.costPrice || r.costPrice.lte(0)) miss('costPrice', 'zavod narxi (Цена Приход)');
      if (!r.salePrice || r.salePrice.lte(0)) miss('salePrice', 'sotuv narxi (Цена Продажа)');
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
    for (const r of ctx.shipments) {
      const m3 = new D(String(r.cube ?? 0));
      const cost = m3.mul(r.costPrice ?? 0);
      const sale = m3.mul(r.salePrice ?? 0);
      const clientPays = /^клиент$/i.test(r.transportPayerRaw.trim());
      const charge = sale.minus(clientPays ? (r.transportCost ?? new D(0)) : new D(0));
      const cmp = (calc: Prisma.Decimal, declared: Prisma.Decimal | null, what: string) => {
        if (!declared) return;
        if (calc.minus(declared).abs().lte(TOL)) return;
        out.push({
          ruleId: FORMULA_FARQI.id, severity: Sev.WARN, origin: r.origin,
          message:
            `${at(r.origin)}: ${what} — faylda ${fmt(declared)}, hisoblanganda ${fmt(calc)}. ` +
            'Import HISOBLANGANINI oladi (Excel katagi eskirgan bo‘lishi mumkin).',
          currentValue: declared.toString(), suggestedValue: calc.toString(),
        });
      };
      cmp(cost, r.costSumDeclared, '«Сумма Приход»');
      cmp(sale, r.saleSumDeclared, '«Сумма Продажа»');
      cmp(charge, r.clientChargeDeclared, '«Мижозга»');
    }
    for (const p of ctx.clientPayments) {
      const total = [p.bank, p.cash, p.click, p.terminal].reduce<Prisma.Decimal>((a, v) => (v ? a.plus(v) : a), new D(0));
      if (p.totalDeclared && total.minus(p.totalDeclared).abs().gt(TOL)) {
        out.push({
          ruleId: FORMULA_FARQI.id, severity: Sev.WARN, origin: p.origin,
          message:
            `${at(p.origin)}: kanallar yig‘indisi ${fmt(total)}, «Жами сумма» esa ${fmt(p.totalDeclared)}. ` +
            'Import KANAL ustunlarini oladi.',
          currentValue: p.totalDeclared.toString(), suggestedValue: total.toString(),
        });
      }
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
    if (!d) return out;
    const origin = d.origin;
    const TOL = new D('1');

    const sales = ctx.shipments.reduce<Prisma.Decimal>((a, r) => {
      const m3 = new D(String(r.cube ?? 0));
      const sale = m3.mul(r.salePrice ?? 0);
      const clientPays = /^клиент$/i.test(r.transportPayerRaw.trim());
      return a.plus(sale.minus(clientPays ? (r.transportCost ?? new D(0)) : new D(0)));
    }, new D(0));
    if (d.sales && sales.minus(d.sales).abs().gt(TOL)) {
      out.push({
        ruleId: JAMI_FARQI.id, severity: Sev.WARN, origin,
        message:
          `«Мижозлар қолдиғи» sotuv jami ${fmt(d.sales)}, import hisobladi ${fmt(sales)} — ` +
          `farq ${fmt(sales.minus(d.sales))} so‘m.`,
        currentValue: d.sales.toString(), suggestedValue: sales.toString(),
      });
    }

    const takenQty = ctx.shipments.reduce((a, r) => a + (r.palletQty ?? 0), 0);
    const retQty = ctx.palletReturns.reduce((a, r) => a + (r.qty ?? 0), 0);
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

    return out;
  },
};

/**
 * ZAVOD PADDONI — Excel bilan ATAYLAB farq qiladigan joy.
 *
 * Excel zavod qarziga paddon PULINI ham qo'shadi, sayt esa paddonni naturada sanaydi
 * (egasining qarori, 2026-09-04). Farq shu qoidada OCHIQ aytiladi: egasi ikki raqamni
 * solishtirganda sababi darhol ko'rinishi kerak, aks holda u importni buzuq deb o'ylaydi.
 */
const ZAVOD_PADDON_PULI: Rule = {
  id: 'ZAVOD_PADDON_PULI',
  nameUz: 'Zavod qarzida paddon puli hisoblanmaydi',
  run: (ctx) => {
    const price = ctx.master.settings.palletBasePrice ?? new D(130000);
    const takenQty = ctx.shipments.reduce((a, r) => a + (r.palletQty ?? 0), 0);
    const backQty = ctx.factoryPalletReturns.reduce((a, r) => a + (r.qty ?? 0), 0);
    const expense = ctx.factoryPalletReturns.reduce<Prisma.Decimal>((a, r) => a.plus(r.totalCostDeclared ?? 0), new D(0));
    if (takenQty === 0) return [];
    const gap = price.mul(takenQty).minus(price.mul(backQty)).minus(expense);
    return [{
      ruleId: ZAVOD_PADDON_PULI.id, severity: Sev.INFO,
      origin: SHEET_LEVEL('Поставшиклар ҳисоби'),
      message:
        `Excel zavod qarziga paddon pulini ham qo‘shadi, sayt esa paddonni DONA bo‘lib sanaydi ` +
        `(sizning qaroringiz). Shu sababli zavod qoldig‘i Excel’nikidan ${fmt(gap)} so‘m farq qiladi: ` +
        `olingan paddon ${takenQty} × ${fmt(price)} − qaytarilgan ${backQty} × ${fmt(price)} − ` +
        `qaytarish harajati ${fmt(expense)}. Paddon qarzi DONA bo‘lib alohida ko‘rinadi.`,
      currentValue: gap.toString(),
    }];
  },
};

export const RULES: Rule[] = [
  MIJOZ_YOQ,
  ZAVOD_NOMALUM,
  AGENT_FARQI,
  QATOR_TOLIQ_EMAS,
  YUK_MAJBURIY_MAYDON,
  TOLOV_TURI_NOMALUM,
  TRANSPORT_TOLOVCHI_NOMALUM,
  TOLOV_KANALI_YOQ,
  FORMULA_FARQI,
  TAKRORIY_YUK,
  USTAMA_CHEGARASI,
  PODDON_NISBATI,
  MOSHINA_SIGIMI,
  PADDON_ORTIQCHA,
  JAMI_FARQI,
  ZAVOD_PADDON_PULI,
];
