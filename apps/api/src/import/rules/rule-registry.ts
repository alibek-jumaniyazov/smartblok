import { Prisma, ImportIssueSeverity as Sev } from '@prisma/client';
import type { ShipmentRow, ClientPaymentRow, FactoryPaymentRow, ClientSheet, RowOrigin } from '../parse/types';
import { norm } from '../resolve/normalize';
import type { ImportRulesConfig } from './config';

const D = Prisma.Decimal;

export interface Finding {
  ruleId: string;
  severity: Sev;
  origin: RowOrigin;
  field?: string;
  message: string; // Uzbek, full sentence
  currentValue?: unknown;
  suggestedValue?: unknown;
}

export interface RuleContext {
  shipments: ShipmentRow[];
  clientPayments: ClientPaymentRow[];
  factoryPayments: FactoryPaymentRow[];
  clientSheets: ClientSheet[];
  agentKeys: Set<string>; // normalized agent-name keys (for MIJOZ_AGENT_NOMI)
  cfg: ImportRulesConfig;
}

export interface Rule {
  id: string;
  nameUz: string;
  run(ctx: RuleContext): Finding[];
}

const fmt = (d: Prisma.Decimal | number | null | undefined): string =>
  d == null ? '—' : new D(d as any).toDecimalPlaces(0).toNumber().toLocaleString('ru-RU');

// Words that legitimately appear in the money column «Расход Авто» (col S).
const TRANSPORT_WORD_WHITELIST = /^(клентдан|бизадан|туланди|х-?туланди)$/i;

export const RULES: Rule[] = [
  {
    id: 'MIJOZ_YOQ',
    nameUz: 'Mijoz yozilmagan',
    run: ({ shipments }) =>
      shipments
        .filter((r) => !r.clientRaw)
        .map((r) => ({
          ruleId: 'MIJOZ_YOQ',
          severity: Sev.BLOCK,
          origin: r.origin,
          field: 'clientRaw',
          message: `Bu yuklamada mijoz yozilmagan (${r.truck || 'raqamsiz'}, ${r.size}). Mijozni nomlang — aks holda buyurtma yaratilmaydi.`,
          currentValue: '',
        })),
  },
  {
    id: 'PUL_USTUNIDA_MATN',
    nameUz: 'Pul ustunida kutilmagan so‘z',
    run: ({ shipments }) =>
      shipments
        .filter((r) => r.transportWord && !TRANSPORT_WORD_WHITELIST.test(r.transportWord.trim()))
        .map((r) => ({
          ruleId: 'PUL_USTUNIDA_MATN',
          severity: Sev.BLOCK,
          origin: r.origin,
          field: 'transport',
          message: `«Расход Авто» ustunida «${r.transportWord}» yozilgan — bu son emas. Transport summasi qancha edi?`,
          currentValue: r.transportWord,
        })),
  },
  {
    id: 'FOYDA_PODDON_QOSHILGAN',
    nameUz: 'Foydaga poddon narxi qo‘shilgan',
    run: ({ shipments }) =>
      shipments
        .filter((r) => r.diff && r.salePrice && r.costPrice && r.palletPrice)
        .flatMap((r) => {
          const buggy = r.salePrice!.plus(r.palletPrice!).minus(r.costPrice!);
          const correct = r.salePrice!.minus(r.costPrice!);
          const isBug = r.diff!.minus(buggy).abs().lt(1) && r.diff!.minus(correct).abs().gte(1);
          return isBug
            ? [{
                ruleId: 'FOYDA_PODDON_QOSHILGAN',
                severity: Sev.CONFIRM,
                origin: r.origin,
                field: 'diff',
                message: `Bu qatorda 1 m³ foydasi ${fmt(r.diff)} deb yozilgan, lekin ${fmt(r.salePrice)} − ${fmt(r.costPrice)} = ${fmt(correct)}. «Разница» formulasi bitta poddon narxini (${fmt(r.palletPrice)}) qo‘shib yuborgan. Bu ustun hech qanday jamiga kirmaydi — pulingiz kamaymagan.`,
                currentValue: r.diff!.toNumber(),
                suggestedValue: correct.toNumber(),
              }]
            : [];
        }),
  },
  {
    id: 'NARX_BUTUN_SON_EMAS',
    nameUz: 'Sotish narxi butun son emas',
    run: ({ shipments, cfg }) =>
      shipments
        .filter((r) => r.salePrice && !r.salePrice.isInteger())
        .map((r) => {
          const round = cfg.yaxlitlashChegarasi.uzs || 1000;
          const lump = r.saleSum ? new D(Math.round(r.saleSum.toNumber() / round) * round) : null;
          return {
            ruleId: 'NARX_BUTUN_SON_EMAS',
            severity: Sev.CONFIRM,
            origin: r.origin,
            field: 'salePrice',
            message: `Sotish narxi ${r.salePrice!.toFixed(3)} — yaxlit son emas (jami summadan orqaga hisoblangan). Yaxlit summani saqlaymiz: ${fmt(lump)}.`,
            currentValue: r.salePrice!.toNumber(),
            suggestedValue: lump?.toNumber(),
          };
        }),
  },
  {
    id: 'SANA_ORALIQDAN_TASHQARI',
    nameUz: 'Sana oraliqdan tashqarida',
    run: ({ shipments, cfg }) => {
      const times = shipments.map((r) => r.date?.getTime()).filter((t): t is number => t != null).sort((a, b) => a - b);
      if (times.length < 5) return [];
      const median = times[Math.floor(times.length / 2)];
      const span = cfg.sanaOgishiKun.days * 86_400_000;
      return shipments
        .filter((r) => r.date && Math.abs(r.date.getTime() - median) > span)
        .map((r) => ({
          ruleId: 'SANA_ORALIQDAN_TASHQARI',
          severity: Sev.CONFIRM,
          origin: r.origin,
          field: 'date',
          message: `Sana ${r.date!.toISOString().slice(0, 10)} — boshqa qatorlardan ${cfg.sanaOgishiKun.days} kundan uzoq. Xato bo‘lishi mumkin.`,
          currentValue: r.date!.toISOString().slice(0, 10),
        }));
    },
  },
  {
    id: 'TANNARX_NARXNOMAGA_MOS_EMAS',
    nameUz: 'Tannarx narxnomaga mos emas',
    run: ({ shipments }) => {
      // per-day modal cost price; flag rows that deviate from a clear majority
      const byDay = new Map<string, Prisma.Decimal[]>();
      for (const r of shipments) {
        if (!r.date || !r.costPrice) continue;
        const k = r.date.toISOString().slice(0, 10);
        (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(r.costPrice);
      }
      const modal = new Map<string, string>();
      for (const [k, prices] of byDay) {
        const freq = new Map<string, number>();
        for (const p of prices) freq.set(p.toString(), (freq.get(p.toString()) ?? 0) + 1);
        const sorted = [...freq].sort((a, b) => b[1] - a[1]);
        if (sorted.length && sorted[0][1] >= 2) modal.set(k, sorted[0][0]); // need a real majority
      }
      return shipments
        .filter((r) => r.date && r.costPrice)
        .flatMap((r) => {
          const k = r.date!.toISOString().slice(0, 10);
          const m = modal.get(k);
          if (!m || r.costPrice!.toString() === m) return [];
          return [{
            ruleId: 'TANNARX_NARXNOMAGA_MOS_EMAS',
            severity: Sev.CONFIRM,
            origin: r.origin,
            field: 'costPrice',
            message: `Zavod narxi ${fmt(r.costPrice)}, lekin o‘sha kuni (${k}) boshqa qatorlar ${fmt(new D(m))}. → ${fmt(new D(m))} ga tuzatamizmi?`,
            currentValue: r.costPrice!.toNumber(),
            suggestedValue: new D(m).toNumber(),
          }];
        });
    },
  },
  {
    id: 'MIJOZ_AGENT_NOMI',
    nameUz: 'Mijoz o‘rniga agent nomi',
    run: ({ clientPayments, agentKeys }) =>
      clientPayments
        .filter((p) => p.clientRaw && agentKeys.has(norm(p.clientRaw).key))
        .map((p) => ({
          ruleId: 'MIJOZ_AGENT_NOMI',
          severity: Sev.BLOCK,
          origin: p.origin,
          field: 'clientRaw',
          message: `Mijoz o‘rniga agent nomi «${p.clientRaw}» yozilgan. To‘lovchi: «${p.payer || '—'}» (${fmt(p.total)} so‘m). Bu qaysi mijozning to‘lovi?`,
          currentValue: p.clientRaw,
        })),
  },
  {
    id: 'ZAVOD_TOLOVI_ZAVODGA_EMAS',
    nameUz: 'Zavod to‘lovi zavodga bormagan',
    run: ({ factoryPayments }) =>
      factoryPayments
        .filter((f) => !f.receiver || /^\d[\d\s]{6,}$/.test(f.receiver.trim()) || /нахт|пластик/i.test(f.payer))
        .map((f) => ({
          ruleId: 'ZAVOD_TOLOVI_ZAVODGA_EMAS',
          severity: Sev.CONFIRM,
          origin: f.origin,
          field: 'receiver',
          message: `${fmt(f.amount)} so‘m — to‘lovchi «${f.payer || '—'}», qabul qiluvchi «${f.receiver || 'bo‘sh'}». CAOLS KS ga bormagan ko‘rinadi. Baribir zavod to‘lovimi?`,
          currentValue: f.receiver || null,
        })),
  },
  {
    id: 'BIR_XIL_TOLOV',
    nameUz: 'Bir xil to‘lov (takrormi?)',
    run: ({ clientPayments, cfg }) => {
      if (!cfg.ogohlantirishlar.enabled) return [];
      const seen = new Map<string, ClientPaymentRow>();
      const out: Finding[] = [];
      for (const p of clientPayments) {
        const key = `${p.date?.getTime() ?? ''}|${norm(p.clientRaw).key}|${p.total?.toString() ?? ''}`;
        if (!p.total) continue;
        const prev = seen.get(key);
        if (prev) {
          out.push({
            ruleId: 'BIR_XIL_TOLOV',
            severity: Sev.WARN,
            origin: p.origin,
            field: 'total',
            message: `Bir xil to‘lov: «${p.clientRaw}» ${fmt(p.total)} so‘m — r${prev.origin.excelRow} bilan aynan bir xil. Takror bo‘lmasa, ikkalasini ham saqlaymiz.`,
            currentValue: p.total.toNumber(),
          });
        } else {
          seen.set(key, p);
        }
      }
      return out;
    },
  },
];
