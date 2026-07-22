import { Prisma, ImportIssueSeverity as Sev } from '@prisma/client';
import type { AgentLedger, AgentSummaryRow, ClientPaymentRow, FactoryPaymentRow, ShipmentRow, RowOrigin } from '../parse/types';
import type { JurnalDeclaredTotals } from '../parse/jurnal.parser';
import { norm } from '../resolve/normalize';
import { matchName } from '../resolve/matcher';
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
  /** the journal's own SUM row (null when the file has none) — for JAMLAMA_QATORI_NOTOGRI */
  jurnalTotals?: JurnalDeclaredTotals | null;
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

/**
 * Fold a raw name onto the canonical client registry (the agent-sheet block headers) —
 * the SAME resolution ImportService.resolvedName applies before staging, so the rules
 * reason about the client the commit will actually write to.
 *
 * Without it the journal's «Мустофо Машал» and the daftar's «Мустафо машал» are two
 * different clients to every rule, and this workbook alone produced 26 phantom
 * «daftarda yozilmagan» warnings for trucks that are recorded on both sides.
 */
function canonicalizer(ledgers: AgentLedger[]): (raw: string) => string {
  const canon = [...new Map(
    ledgers.flatMap((l) => l.clients.map((c) => [norm(c.clientRaw).key, c.clientRaw] as const)),
  ).values()];
  const cache = new Map<string, string>();
  return (raw: string): string => {
    const t = (raw ?? '').trim();
    if (!t) return '';
    const hit = cache.get(t);
    if (hit !== undefined) return hit;
    const m = matchName(t, canon);
    const out = m.best && m.verdict !== 'none' ? m.best : t;
    cache.set(t, out);
    return out;
  };
}

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
      const canonical = canonicalizer(ledgers);
      const journal = new Map<string, ShipmentRow[]>();
      for (const r of shipments) {
        if (!r.clientRaw) continue;
        const k = shipKey(canonical(r.clientRaw), r.date, r.truck, r.cube);
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
      const canonical = canonicalizer(ledgers);
      const agentByClient = new Map<string, string>(); // client norm key → agent sheet name
      for (const lg of ledgers) {
        for (const block of lg.clients) agentByClient.set(norm(block.clientRaw).key, lg.agentName);
      }
      return shipments
        .filter((r) => r.clientRaw && r.agentRaw)
        .flatMap((r) => {
          const ledgerAgent = agentByClient.get(norm(canonical(r.clientRaw)).key);
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
    id: 'JAMLAMA_QATORI_NOTOGRI',
    nameUz: 'Excel jamlama qatori qatorlarga mos emas',
    // The owner checks the site against the SUM row under his table. On this file
    // «Общая прибль» and «Соф фойда» are `SUM(T4:T116)` / `SUM(V4:V116)` — the range was
    // never stretched when rows 117..147 were added, so the sheet understates its own
    // profit by 72 032 960 / 4 032 960. The import totals the ROWS (which is right), so
    // without this warning the owner reads a correct site as a broken one.
    run: ({ shipments, jurnalTotals }) => {
      if (!jurnalTotals || !shipments.length) return [];
      const sum = (f: (r: ShipmentRow) => Prisma.Decimal | null) =>
        shipments.reduce((a, r) => a.plus(f(r) ?? 0), new D(0));
      const cube = (r: ShipmentRow) => (r.cube === null ? null : new D(String(r.cube)));
      const cost = (r: ShipmentRow) => (r.cube !== null && r.costPrice ? new D(String(r.cube)).mul(r.costPrice) : null);
      const gross = sum((r) => r.saleSum).minus(sum(cost));

      const checks: Array<[string, Prisma.Decimal | null, Prisma.Decimal]> = [
        ['«Блок Куб»', jurnalTotals.cube, sum(cube)],
        ['«Сумма Приход»', jurnalTotals.costSum, sum(cost)],
        ['«Поддон Шт»', jurnalTotals.palletQty, new D(shipments.reduce((a, r) => a + (r.palletQty ?? 0), 0))],
        ['«Сумма Продажа»', jurnalTotals.saleSum, sum((r) => r.saleSum)],
        ['«Расход Авто»', jurnalTotals.transport, sum((r) => r.transport)],
        ['«Общая прибль»', jurnalTotals.grossProfit, gross],
        ['«Соф фойда»', jurnalTotals.netProfit, gross.minus(sum((r) => r.transport))],
      ];

      return checks.flatMap(([label, declared, actual]) => {
        if (!declared || declared.minus(actual).abs().lt(1)) return [];
        return [{
          ruleId: 'JAMLAMA_QATORI_NOTOGRI',
          severity: Sev.WARN,
          origin: { sheetName: shipments[0].origin.sheetName, excelRow: jurnalTotals.excelRow },
          message: `Excel jamlama qatorida (r${jurnalTotals.excelRow}) ${label} = ${fmt(declared)}, lekin ${shipments.length} ta qatorning haqiqiy yigʼindisi ${fmt(actual)} — farq ${fmt(declared.minus(actual))}. Odatda buning sababi: SUM formulasi oxirgi qatorlargacha choʼzilmagan. Bazaga QATORLAR boʼyicha hisoblangan (toʼgʼri) qiymat yoziladi — sayt bilan Excel jamlamasi farq qilsa, ayb shu formulada.`,
          currentValue: declared.toNumber(),
          suggestedValue: actual.toNumber(),
        }];
      });
    },
  },
  {
    id: 'ZAVOD_QOLDIGI',
    nameUz: 'Zavod hisobi (Олинган / Берилган)',
    // Лист1's «Завод» block is the one number the owner checks first: what the trucks cost
    // («Олинган», Σ col J — BLOCKS only, pallets are in-kind) against what was transferred
    // («Берилган», the «Утказилган пул» block). The import books them into two SEPARATE
    // factory pockets — cost into PAYABLE, transfers into ADVANCE_BANK — so this states the
    // three numbers up front and lets the owner tick them off the sheet before committing.
    run: ({ shipments, factoryPayments }) => {
      const olingan = shipments.reduce(
        (a, r) => (r.cube != null && r.costPrice ? a.plus(new D(String(r.cube)).mul(r.costPrice)) : a),
        new D(0),
      );
      const berilgan = factoryPayments.reduce((a, f) => a.plus(f.amount ?? 0), new D(0));
      if (olingan.isZero() && berilgan.isZero()) return [];
      const delta = berilgan.minus(olingan);
      const verdict = delta.isZero()
        ? 'zavod bilan hisob teng'
        : delta.gt(0)
          ? `zavodda ${fmt(delta)} soʼm AVANSIMIZ qoladi (bank oʼtkazmasi cho‘ntagida)`
          : `zavodga ${fmt(delta.negated())} soʼm QARZDORMIZ`;
      return [{
        ruleId: 'ZAVOD_QOLDIGI',
        severity: Sev.INFO,
        origin: factoryPayments[0]?.origin ?? shipments[0]?.origin ?? { sheetName: '—', excelRow: 0 },
        message: `Zavod hisobi: «Олинган» (blok tannarxi) ${fmt(olingan)} · «Берилган» (o‘tkazmalar, ${factoryPayments.length} ta) ${fmt(berilgan)} → ${verdict}. Лист1 «Завод» bloki bilan solishtiring.`,
        currentValue: delta.toNumber(),
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
    run: ({ shipments, clientPayments, ledgers }) => {
      // journal names must be folded onto the daftar's canonical client first, or a return
      // recorded under «Мустафо машал» would never see «Мустофо Машал»'s deliveries
      const canonical = canonicalizer(ledgers);
      const delivered = new Map<string, number>();
      for (const r of shipments) {
        if (!r.clientRaw || !r.palletQty) continue;
        const k = norm(canonical(r.clientRaw)).key;
        delivered.set(k, (delivered.get(k) ?? 0) + r.palletQty);
      }
      const returned = new Map<string, number>();
      const out: Finding[] = [];
      for (const p of clientPayments) {
        if (!p.palletReturn || p.palletReturn <= 0) continue;
        const k = norm(canonical(p.clientRaw)).key;
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
