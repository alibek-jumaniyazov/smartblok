import { Prisma, ImportIssueSeverity as Sev } from '@prisma/client';
import type { AgentLedger, AgentSummaryRow, ClientPaymentRow, FactoryPaymentRow, ShipmentRow, RowOrigin } from '../parse/types';
import { norm } from '../resolve/normalize';
import { normalizePlate, normalizeSize } from '../resolve/entity-resolver';
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
  ledgers: AgentLedger[]; // per-agent sheets (client blocks) — reconciliation source
  agentSummary: AgentSummaryRow[]; // «Агент|Расход|Приход|Ост» table on the journal
  factoryDeclaredTotal: Prisma.Decimal | null; // the «Жами» of the «Утказилган пул» block
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

const day = (d: Date | null): string => (d ? d.toISOString().slice(0, 10) : '—');

// Words that legitimately appear in the money column «Расход Авто» (col S).
const TRANSPORT_WORD_WHITELIST = /^(клентдан|бизадан|туланди|х-?туланди)$/i;

/** Match key for journal-row ↔ ledger-delivery reconciliation. */
const shipKey = (client: string, date: Date | null, truck: string, cube: number | null): string =>
  [norm(client).key, day(date), normalizePlate(truck), cube == null ? '' : cube.toFixed(3)].join('|');

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
            // the commit stores saleSum as the order total — accepting must round THAT,
            // not the per-m³ price (which is only the back-solved artifact)
            field: 'saleSum',
            message: `Sotish narxi ${r.salePrice!.toFixed(3)} — yaxlit son emas (jami summadan orqaga hisoblangan). Yaxlit summani saqlaymiz: ${fmt(lump)}.`,
            currentValue: r.saleSum?.toNumber(),
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
          message: `Sana ${day(r.date)} — boshqa qatorlardan ${cfg.sanaOgishiKun.days} kundan uzoq. Xato bo‘lishi mumkin.`,
          currentValue: day(r.date),
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
        const k = day(r.date);
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
          const k = day(r.date);
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
            message: `Bir xil to‘lov: «${p.clientRaw}» ${fmt(p.total)} so‘m — «${prev.origin.sheetName}» r${prev.origin.excelRow} bilan aynan bir xil. Takror bo‘lmasa, ikkalasini ham saqlaymiz.`,
            currentValue: p.total.toNumber(),
          });
        } else {
          seen.set(key, p);
        }
      }
      return out;
    },
  },
  {
    id: 'DAFTAR_JURNAL_FARQI',
    nameUz: 'Agent daftari jurnalga mos emas',
    // Every delivery listed in an agent sheet's client block must have exactly one
    // matching journal row (same client, date, truck, m³) — and vice versa. A gap on
    // either side means the owner forgot to copy a truck somewhere.
    run: ({ shipments, ledgers }) => {
      const out: Finding[] = [];
      const journal = new Map<string, ShipmentRow[]>();
      for (const r of shipments) {
        if (!r.clientRaw) continue;
        const k = shipKey(r.clientRaw, r.date, r.truck, r.cube);
        (journal.get(k) ?? journal.set(k, []).get(k)!).push(r);
      }
      const matched = new Set<ShipmentRow>();
      for (const lg of ledgers) {
        for (const block of lg.clients) {
          for (const d of block.deliveries) {
            const k = shipKey(block.clientRaw, d.date, d.truck, d.cube);
            const cand = (journal.get(k) ?? []).find((r) => !matched.has(r));
            if (cand) {
              matched.add(cand);
            } else {
              out.push({
                ruleId: 'DAFTAR_JURNAL_FARQI',
                severity: Sev.WARN,
                origin: d.origin,
                message: `«${lg.agentName}» daftarida ${block.clientRaw} uchun ${day(d.date)} kuni ${d.truck || 'raqamsiz'} (${d.cube ?? '—'} m³) yetkazma bor, lekin jurnalda bunday qator topilmadi.`,
                currentValue: d.total?.toNumber(),
              });
            }
          }
        }
      }
      for (const r of shipments) {
        if (!r.clientRaw || matched.has(r)) continue;
        out.push({
          ruleId: 'DAFTAR_JURNAL_FARQI',
          severity: Sev.WARN,
          origin: r.origin,
          message: `Jurnal qatori — ${r.clientRaw}, ${day(r.date)}, ${r.truck || 'raqamsiz'} (${r.cube ?? '—'} m³) — hech bir agent daftarida yozilmagan. Daftarni tekshiring.`,
          currentValue: r.saleSum?.toNumber(),
        });
      }
      return out;
    },
  },
  {
    id: 'AGENT_NOMI_FARQI',
    nameUz: 'Jurnal agenti daftar agentiga mos emas',
    // The journal's «Агент» column must agree with the agent SHEET that lists the client.
    run: ({ shipments, ledgers }) => {
      const agentByClient = new Map<string, string>(); // client norm key → agent sheet name
      for (const lg of ledgers) {
        for (const block of lg.clients) agentByClient.set(norm(block.clientRaw).key, lg.agentName);
      }
      return shipments
        .filter((r) => r.clientRaw && r.agentRaw)
        .flatMap((r) => {
          const ledgerAgent = agentByClient.get(norm(r.clientRaw).key);
          if (!ledgerAgent || norm(ledgerAgent).key === norm(r.agentRaw).key) return [];
          return [{
            ruleId: 'AGENT_NOMI_FARQI',
            severity: Sev.CONFIRM,
            origin: r.origin,
            field: 'agentRaw',
            message: `Jurnalda bu yuklama «${r.agentRaw}» agentiga yozilgan, lekin «${r.clientRaw}» mijozi «${ledgerAgent}» daftarida turibdi. Daftar bo‘yicha «${ledgerAgent}» deb olamizmi?`,
            currentValue: r.agentRaw,
            suggestedValue: ledgerAgent,
          }];
        });
    },
  },
  {
    id: 'SVOD_FARQI',
    nameUz: 'Agent svodkasi hisobga mos emas',
    // The journal's per-agent summary («Расход/Приход») vs what the agent sheets actually
    // contain. Advisory only — the summary holds cached formula results that can be stale.
    run: ({ ledgers, agentSummary }) => {
      const out: Finding[] = [];
      for (const s of agentSummary) {
        const lg = ledgers.find((l) => norm(l.agentName).key === norm(s.agent).key);
        if (!lg) continue;
        const sales = lg.clients.reduce((a, c) => c.deliveries.reduce((b, d) => b.plus(d.total ?? 0), a), new D(0));
        const paid = lg.clients.reduce((a, c) => c.payments.reduce((b, p) => b.plus(p.total ?? 0), a), new D(0));
        if (s.sales && s.sales.minus(sales).abs().gte(1)) {
          out.push({
            ruleId: 'SVOD_FARQI', severity: Sev.INFO, origin: s.origin,
            message: `Svodkada «${s.agent}» sotuvi ${fmt(s.sales)} deb turibdi, daftardagi yig‘indi esa ${fmt(sales)}. Excel formulasi eskirgan bo‘lishi mumkin — bazaga daftar yig‘indisi yoziladi.`,
            currentValue: s.sales.toNumber(), suggestedValue: sales.toNumber(),
          });
        }
        if (s.paid && s.paid.minus(paid).abs().gte(1)) {
          out.push({
            ruleId: 'SVOD_FARQI', severity: Sev.INFO, origin: s.origin,
            message: `Svodkada «${s.agent}» yig‘imi ${fmt(s.paid)} deb turibdi, daftardagi to‘lovlar yig‘indisi esa ${fmt(paid)}. Bazaga daftar yig‘indisi yoziladi.`,
            currentValue: s.paid.toNumber(), suggestedValue: paid.toNumber(),
          });
        }
      }
      return out;
    },
  },
  {
    id: 'ZAVOD_JAMI_FARQI',
    nameUz: 'Zavod o‘tkazmalari «Жами»ga mos emas',
    // The «Утказилган пул» block carries its own SUM row. If Σ of the parsed transfers
    // differs, either the parser missed rows (a spacer/edited label) or the sheet SUM is
    // stale — the owner must look before this money reaches the ledger.
    run: ({ factoryPayments, factoryDeclaredTotal }) => {
      if (!factoryDeclaredTotal) return [];
      const total = factoryPayments.reduce((a, f) => a.plus(f.amount ?? 0), new D(0));
      if (factoryDeclaredTotal.minus(total).abs().lt(1)) return [];
      const origin = factoryPayments[0]?.origin ?? { sheetName: '—', excelRow: 0 };
      return [{
        ruleId: 'ZAVOD_JAMI_FARQI',
        severity: Sev.WARN,
        origin,
        message: `«Утказилган пул» blokining «Жами» qiymati ${fmt(factoryDeclaredTotal)}, lekin o‘qilgan o‘tkazmalar yig‘indisi ${fmt(total)} (${factoryPayments.length} ta qator). Blokda o‘tkazib yuborilgan yoki ortiqcha qator bo‘lishi mumkin — tekshiring.`,
        currentValue: total.toNumber(),
        suggestedValue: factoryDeclaredTotal.toNumber(),
      }];
    },
  },
  {
    id: 'SANA_YOQ',
    nameUz: 'Sana yozilmagan',
    // A row without a date would land in the ledger as 1970-01-01 and fall out of every
    // period report — surface it for an explicit fix.
    run: ({ shipments, clientPayments, factoryPayments }) => {
      const out: Finding[] = [];
      for (const r of shipments) {
        if (r.date) continue;
        out.push({
          ruleId: 'SANA_YOQ', severity: Sev.CONFIRM, origin: r.origin, field: 'date',
          message: `Bu yuklamada sana yozilmagan (${r.clientRaw || 'mijozsiz'}, ${r.truck || 'raqamsiz'}). Sanani kiriting — aks holda u davr hisobotlaridan tushib qoladi.`,
        });
      }
      for (const p of clientPayments) {
        if (p.date || !p.total) continue;
        out.push({
          ruleId: 'SANA_YOQ', severity: Sev.CONFIRM, origin: p.origin, field: 'date',
          message: `Bu to‘lovda sana yozilmagan («${p.clientRaw}», ${fmt(p.total)} so‘m). Sanani kiriting.`,
        });
      }
      for (const f of factoryPayments) {
        if (f.date || !f.amount) continue;
        out.push({
          ruleId: 'SANA_YOQ', severity: Sev.CONFIRM, origin: f.origin, field: 'date',
          message: `Bu zavod o‘tkazmasida sana yozilmagan (${fmt(f.amount)} so‘m). Sanani kiriting.`,
        });
      }
      return out;
    },
  },
  {
    id: 'PODDON_QAYTARISH_ORTIQCHA',
    nameUz: 'Poddon qaytarish yetkazilgandan ko‘p',
    // In-kind pallet returns («Возврат паддон») per client cannot exceed what the journal delivered.
    run: ({ shipments, clientPayments }) => {
      const delivered = new Map<string, number>();
      for (const r of shipments) {
        if (!r.clientRaw || !r.palletQty) continue;
        const k = norm(r.clientRaw).key;
        delivered.set(k, (delivered.get(k) ?? 0) + r.palletQty);
      }
      const returned = new Map<string, number>();
      const out: Finding[] = [];
      for (const p of clientPayments) {
        if (!p.palletReturn || p.palletReturn <= 0) continue;
        const k = norm(p.clientRaw).key;
        const ret = (returned.get(k) ?? 0) + p.palletReturn;
        returned.set(k, ret);
        const have = delivered.get(k) ?? 0;
        if (ret > have) {
          out.push({
            ruleId: 'PODDON_QAYTARISH_ORTIQCHA',
            severity: Sev.CONFIRM,
            origin: p.origin,
            field: 'palletReturn',
            message: `«${p.clientRaw}» jami ${ret} poddon qaytargan bo‘lib chiqyapti, lekin BU fayl bo‘yicha unga ${have} poddon yetkazilgan. Import oldidan bazada poddon qoldig‘i bo‘lsa, o‘shanisi ham hisobga olinadi; bo‘lmasa ortiqchasi yozilmaydi — sonni tekshiring.`,
            currentValue: p.palletReturn,
          });
        }
      }
      return out;
    },
  },
];
