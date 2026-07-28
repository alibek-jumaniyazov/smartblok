// chat/tools.ts — AI yordamchining MA'LUMOTGA ULANGAN qo'llari.
//
// Har bir tool — FAQAT O'QIYDIGAN, rol bo'yicha chegaralangan va TAYYOR SHAKLGA
// keltirilgan so'rov. Xom Prisma qatorlari qaytarilmaydi: model kontekstiga faqat
// javob berish uchun kerak bo'lgan maydonlar tushadi (tokenni tejaydi va model
// tushunmaydigan ichki ustunlarni ko'rsatmaydi).
//
// Uchta qat'iy qoida:
//   1. ROL — har tool o'zi ruxsat berilgan rollarni e'lon qiladi va AGENT so'rovi
//      har doim o'z mijozlari/buyurtmalari bilan cheklanadi (scoping.ts bilan bir xil).
//      Ruxsat etilmagan tool modelga UMUMAN ko'rsatilmaydi — «yo'q narsani chaqirish»
//      imkoniyati ham qolmasin.
//   2. BEKOR QILINGANLAR — voided to'lov / cancelled buyurtma hech qanday summaga
//      kirmaydi (ekrandagi raqamlar bilan bir xil qoida).
//   3. YOZISH YO'Q — bu yerda birorta ham mutatsiya yo'q. AI hech narsani
//      o'zgartira olmaydi.
import { Injectable } from '@nestjs/common';
import type Anthropic from '@anthropic-ai/sdk';
import { OrderStatus, PaymentKind, PriceKind, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../common/ledger.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { KassaService } from '../kassa/kassa.service';
import { DebtsService } from '../debts/debts.service';
import { PalletService } from '../pallets/pallets.service';
import { FactoriesService } from '../factories/factories.service';
import { D, round2, ZERO } from '../common/money';
import { NOT_CANCELLED } from '../common/order-scope';
import { tashkentDateStr } from '../common/tashkent-time';
import { toCyrillic } from '../common/translit';
import type { RequestUser } from '../common/scoping';

type Role = RequestUser['role'];

const FIN: readonly Role[] = ['ADMIN', 'ACCOUNTANT'];
const FIN_CASH: readonly Role[] = ['ADMIN', 'ACCOUNTANT', 'CASHIER'];
const FIN_AGENT: readonly Role[] = ['ADMIN', 'ACCOUNTANT', 'AGENT'];
const EVERYONE: readonly Role[] = ['ADMIN', 'ACCOUNTANT', 'AGENT', 'CASHIER'];

export interface ToolDef {
  name: string;
  description: string;
  input_schema: Anthropic.Tool['input_schema'];
  roles: readonly Role[];
  run(input: Record<string, any>, user: RequestUser): Promise<unknown>;
}

// ── wire helpers: Decimal → 2dp string, Date → YYYY-MM-DD (Toshkent) ──
const m = (v: Prisma.Decimal | number | string | null | undefined): string => round2(D(v ?? 0)).toFixed(2);
const d = (v: Date | null | undefined): string | null => (v ? tashkentDateStr(v) : null);
const n3 = (v: Prisma.Decimal | number | string | null | undefined): string => D(v ?? 0).toFixed(3);

/** Ro'yxat tool'lari uchun umumiy shift — kontekstni bosib ketmasligi uchun. */
const LIMIT_DEFAULT = 20;
const LIMIT_MAX = 50;
const clampLimit = (v: unknown): number => {
  const num = Number(v);
  if (!Number.isFinite(num) || num <= 0) return LIMIT_DEFAULT;
  return Math.min(LIMIT_MAX, Math.floor(num));
};

const dayStart = (s?: string): Date | undefined => (s ? new Date(s) : undefined);
const dayEnd = (s?: string): Date | undefined => {
  if (!s) return undefined;
  const dt = new Date(s);
  if (!s.includes('T')) dt.setTime(dt.getTime() + 86_400_000 - 1);
  return dt;
};

/** Ism bo'yicha qidirish: lotin ham, kirill ham (daftar kirillcha yozilgan). */
const nameWhere = (q: string): Prisma.StringFilter[] => {
  const variants = new Set([q.trim(), toCyrillic(q.trim())].filter(Boolean));
  return [...variants].map((v) => ({ contains: v, mode: Prisma.QueryMode.insensitive }));
};

const SCHEMA_DATES = {
  from: { type: 'string', description: 'Boshlanish sanasi YYYY-MM-DD (ixtiyoriy)' },
  to: { type: 'string', description: 'Tugash sanasi YYYY-MM-DD, shu kun ham kiradi (ixtiyoriy)' },
} as const;

@Injectable()
export class ChatToolsService {
  private readonly defs: ToolDef[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly dashboard: DashboardService,
    private readonly kassa: KassaService,
    private readonly debts: DebtsService,
    private readonly pallets: PalletService,
    private readonly factories: FactoriesService,
  ) {
    this.defs = this.build();
  }

  /** Rolga ruxsat etilgan tool'larning Anthropic sxemasi (kesh uchun BARQAROR tartibda). */
  specs(role: Role): Anthropic.Tool[] {
    return this.defs
      .filter((t) => t.roles.includes(role))
      .map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
  }

  has(name: string, role: Role): boolean {
    return this.defs.some((t) => t.name === name && t.roles.includes(role));
  }

  /** Tool'ni ishga tushiradi. Rol tekshiruvi SHU YERDA ham takrorlanadi (ikkinchi to'siq). */
  async run(name: string, input: Record<string, any>, user: RequestUser): Promise<unknown> {
    const def = this.defs.find((t) => t.name === name);
    if (!def) return { xato: `Bunday tool yo'q: ${name}` };
    if (!def.roles.includes(user.role)) {
      return { xato: `«${name}» ma'lumoti ${user.role} roli uchun yopiq` };
    }
    return def.run(input ?? {}, user);
  }

  // ───────────────────────── party resolvers ─────────────────────────

  /** «Жамол» / «jamol» / uuid → mijoz. Bir nechta topilsa — ro'yxat qaytariladi. */
  private async findClient(q: string, user: RequestUser) {
    const scope: Prisma.ClientWhereInput =
      user.role === 'AGENT' && user.agentId ? { agentId: user.agentId } : {};
    const byId = /^[0-9a-f-]{36}$/i.test(q)
      ? await this.prisma.client.findFirst({ where: { id: q, ...scope } })
      : null;
    if (byId) return { one: byId, many: [] as { id: string; name: string }[] };
    const rows = await this.prisma.client.findMany({
      where: { OR: nameWhere(q).map((f) => ({ name: f })), ...scope },
      orderBy: { name: 'asc' },
      take: 10,
    });
    if (rows.length === 1) return { one: rows[0], many: [] };
    return { one: null, many: rows.map((r) => ({ id: r.id, name: r.name })) };
  }

  private async findFactory(q: string) {
    const byId = /^[0-9a-f-]{36}$/i.test(q) ? await this.prisma.factory.findUnique({ where: { id: q } }) : null;
    if (byId) return { one: byId, many: [] as { id: string; name: string }[] };
    const rows = await this.prisma.factory.findMany({
      where: { OR: nameWhere(q).map((f) => ({ name: f })) },
      orderBy: { name: 'asc' },
      take: 10,
    });
    if (rows.length === 1) return { one: rows[0], many: [] };
    return { one: null, many: rows.map((r) => ({ id: r.id, name: r.name })) };
  }

  // ───────────────────────── tool definitions ─────────────────────────

  private build(): ToolDef[] {
    return [
      // ═══ 1. Umumiy holat ═══
      {
        name: 'umumiy_holat',
        description:
          "Kompaniyaning umumiy moliyaviy holati: davr bo'yicha savdo, sof foyda, kirim; " +
          "shuningdek butun tarix bo'yicha savdo/tannarx/foyda, mijozlar qarzi, zavodlarga qarz va " +
          "avanslar, bonus hamyonlar, paddon manzarasi. Sana berilmasa — joriy oy. " +
          "«Ishlar qalay», «bu oy qancha ishladik», «umumiy foyda qancha» kabi savollar uchun.",
        input_schema: { type: 'object', properties: { ...SCHEMA_DATES } },
        roles: FIN_AGENT,
        run: async (input, user) => {
          const s = await this.dashboard.summary(user, { from: input.from, to: input.to });
          const out: Record<string, unknown> = {
            davr: {
              dan: s.period.from,
              gacha: s.period.to,
              savdo: m(s.period.sales),
              tannarx: m(s.period.cost),
              mol_foydasi: m(s.period.goodsProfit),
              transport_foydasi: m(s.period.transportProfit),
              sof_foyda: m(s.period.netProfit),
              mijozlardan_kirim: m(s.period.collected),
              buyurtmalar: s.period.orders,
              sotilgan_m3: s.period.cubeSold,
              tannarxi_aniqlanmagan_buyurtma: s.period.undetermined.orders,
            },
            butun_tarix: {
              savdo: m(s.allTime.sales),
              tannarx: m(s.allTime.cost),
              sof_foyda: m(s.allTime.netProfit),
              kirim_mijozlardan: m(s.allTime.collected),
              // Kompaniya chiqimlari AGENT uchun servisda 0 ga tenglashtiriladi. Nolni
              // ko'rsatish — «chiqim yo'q» degan YOLG'ON; shuning uchun butunlay olib
              // tashlanadi (pastda), «yopiq» degan izoh bilan.
              chiqim_zavod_va_shofyor: m(s.allTime.chiqim),
              zavodga_tolangan: m(s.allTime.factoryPaid),
              shofyorlarga_tolangan: m(s.allTime.vehiclePaid),
              buyurtmalar: s.allTime.orders,
              sotilgan_m3: s.allTime.cubeSold,
            },
            hozirgi_qoldiqlar: {
              mijozlar_bizga_qarzdor: m(s.clientsOweUs),
              zavodlarga_qarzimiz_netto: m(s.weOweFactories),
              zavoddagi_avansimiz_naqd: m(s.factoryAdvanceCash),
              zavoddagi_avansimiz_otkazma: m(s.factoryAdvanceBank),
              shofyorlarga_qarzimiz: m(s.weOweVehicles),
              bonus_hamyonlar: m(s.bonusWallets),
            },
            paddon: s.pallets,
            malumot_oraligi: s.dataRange,
            koʻrinish: s.scope === 'agent' ? 'faqat sizning mijozlaringiz' : 'butun kompaniya',
          };
          if (user.role === 'AGENT') {
            delete out.hozirgi_qoldiqlar;
            const past = out.butun_tarix as Record<string, unknown>;
            delete past.tannarx;
            delete past.sof_foyda;
            delete past.chiqim_zavod_va_shofyor;
            delete past.zavodga_tolangan;
            delete past.shofyorlarga_tolangan;
            const period = out.davr as Record<string, unknown>;
            delete period.tannarx;
            delete period.mol_foydasi;
            delete period.transport_foydasi;
            delete period.sof_foyda;
            out.yopiq_bolimlar =
              'tannarx, foyda, zavod va kassa raqamlari AGENT roli uchun ko‘rsatilmaydi';
          }
          return out;
        },
      },

      // ═══ 2. Kassa ═══
      {
        name: 'kassa',
        description:
          "Kassa va bank hisoblari: har birining qoldig'i, davr bo'yicha kirim/chiqim va " +
          "yakuniy qoldiq, hamda butun tarix bo'yicha SOF FOYDA. «Kassada qancha pul bor», " +
          "«bankda nima qoldi», «bu oy kassaga qancha tushdi» savollari uchun.",
        input_schema: { type: 'object', properties: { ...SCHEMA_DATES } },
        roles: FIN_CASH,
        run: async (input) => {
          const s = await this.kassa.summary({ dateFrom: input.from, dateTo: input.to });
          return {
            davr: { dan: s.dateFrom, gacha: s.dateTo },
            hisoblar: s.cashboxes.map((b) => ({
              nomi: b.name,
              turi: b.type,
              valyuta: b.currency,
              faol: b.active,
              boshlangich_qoldiq: m(b.opening),
              kirim: m(b.in),
              chiqim: m(b.out),
              offbook_tuzatish: m(b.adjustment),
              yakuniy_qoldiq: m(b.closing),
            })),
            jami_qoldiq: { UZS: m(s.totals.UZS), USD: m(s.totals.USD) },
            sof_foyda_butun_tarix: {
              savdo: m(s.profit.sales),
              tannarx: m(s.profit.cost),
              mol_foydasi: m(s.profit.goodsProfit),
              transport_foydasi: m(s.profit.transportProfit),
              sof_foyda: m(s.profit.netProfit),
            },
          };
        },
      },

      // ═══ 3. Zavodlar ═══
      {
        name: 'zavodlar',
        description:
          "Barcha zavodlar: ochiq mol qarzimiz, naqd va o'tkazma avansimiz, bonus hamyoni, " +
          "paddon qoldig'i va HOZIRGACHA JAMI TO'LAGAN summamiz. Oxirida barcha zavodlar " +
          "bo'yicha umumiy yig'indi ham bor. «Zavodlarga jami qancha to'ladik», " +
          "«qaysi zavodga qarzimiz bor» savollari uchun.",
        input_schema: {
          type: 'object',
          properties: { qidiruv: { type: 'string', description: 'Zavod nomi bo‘yicha filtr (ixtiyoriy)' } },
        },
        roles: FIN,
        run: async (input, user) => {
          const res = (await this.factories.findAll(user, { pageSize: 200, search: input.qidiruv })) as {
            items: any[];
            total: number;
            paymentSummary?: any;
          };
          return {
            zavodlar: res.items.map((f) => ({
              nomi: f.name,
              faol: f.active,
              ochiq_qarzimiz: m(f.payable),
              avans_naqd: m(f.advanceCash),
              avans_otkazma: m(f.advanceBank),
              bonus_hamyon: m(f.bonusBalance),
              paddon_qarzimiz_dona: f.palletsHeld,
              jami_otkazilgan: m(f.paymentTotals?.paid),
              zavoddan_qaytgan: m(f.paymentTotals?.refunded),
              sof_tolangan: m(f.paymentTotals?.netPaid),
              tolov_soni: f.paymentTotals?.paymentCount ?? 0,
              oxirgi_tolov: d(f.paymentTotals?.lastPaymentAt),
            })),
            hammasi_boyicha_jami: res.paymentSummary
              ? {
                  jami_otkazilgan: m(res.paymentSummary.paid),
                  zavoddan_qaytgan: m(res.paymentSummary.refunded),
                  sof_tolangan: m(res.paymentSummary.netPaid),
                  bonusdan_yopilgan: m(res.paymentSummary.bonusOffset),
                  tolov_soni: res.paymentSummary.paymentCount,
                  birinchi_tolov: d(res.paymentSummary.firstPaymentAt),
                  oxirgi_tolov: d(res.paymentSummary.lastPaymentAt),
                }
              : null,
            zavodlar_soni: res.total,
          };
        },
      },

      // ═══ 4. Bitta zavod ═══
      {
        name: 'zavod',
        description:
          "Bitta zavodning to'liq kartasi: ochiq qarz, avans kanallari, bonus dasturi va hamyoni, " +
          "paddon tarixi, hozirgacha jami to'langan summa va oxirgi to'lovlar ro'yxati. " +
          "Nomning BIR QISMI yetarli (lotin ham, kirill ham) — to'liq nom shart emas; " +
          "bir nechta zavod mos kelsa, variantlar ro'yxati qaytadi.",
        input_schema: {
          type: 'object',
          properties: {
            zavod: { type: 'string', description: 'Zavod nomi yoki uning bir qismi (yoki id)' },
          },
          required: ['zavod'],
        },
        roles: FIN,
        run: async (input) => {
          const { one, many } = await this.findFactory(String(input.zavod ?? ''));
          if (!one) {
            return many.length
              ? { aniqlashtiring: 'Bir nechta zavod topildi', variantlar: many.map((r) => r.name) }
              : { xato: 'Zavod topilmadi' };
          }
          const f = (await this.factories.findOne(one.id)) as any;
          const program = await this.factories.getBonusProgram(one.id);
          return {
            nomi: f.name,
            faol: f.active,
            izoh: f.note ?? null,
            ochiq_qarzimiz: m(f.payable),
            avans_naqd: m(f.advanceCash),
            avans_otkazma: m(f.advanceBank),
            avans_jami: m(f.advanceTotal),
            netto_balans: m(f.balance),
            bonus_hamyon: m(f.bonusBalance),
            bonus_dasturi: program.current
              ? {
                  turi: program.current.kind,
                  m3_uchun_som: program.current.ratePerM3 ? m(program.current.ratePerM3) : null,
                  foiz: program.current.percent ? String(program.current.percent) : null,
                  kuchga_kirgan: d(program.current.effectiveFrom),
                }
              : null,
            paddon: {
              jami_oldik: f.palletStats?.received ?? 0,
              jami_qaytardik: f.palletStats?.returned ?? 0,
              hozir_qarzmiz: f.palletsHeld ?? 0,
            },
            tolov_jamilari: {
              jami_otkazilgan: m(f.paymentTotals?.paid),
              zavoddan_qaytgan: m(f.paymentTotals?.refunded),
              sof_tolangan: m(f.paymentTotals?.netPaid),
              bonusdan_yopilgan: m(f.paymentTotals?.bonusOffset),
              tolov_soni: f.paymentTotals?.paymentCount ?? 0,
              birinchi_tolov: d(f.paymentTotals?.firstPaymentAt),
              oxirgi_tolov: d(f.paymentTotals?.lastPaymentAt),
            },
            oxirgi_tolovlar: (f.payments ?? []).slice(0, 10).map((p: any) => ({
              sana: d(p.date),
              usul: p.method,
              summa: m(p.amount),
              kassa: p.cashbox?.name ?? null,
              izoh: p.note ?? null,
            })),
          };
        },
      },

      // ═══ 5. Mijozlar ═══
      {
        name: 'mijozlar',
        description:
          "Mijozlar ro'yxati va ularning balansi (musbat = bizga qarzdor, manfiy = avansi bor). " +
          "Qidiruv, agent bo'yicha filtr va «faqat qarzdorlar» rejimi bor. AGENT faqat o'z " +
          "mijozlarini ko'radi.",
        input_schema: {
          type: 'object',
          properties: {
            qidiruv: { type: 'string', description: 'Mijoz nomi bo‘yicha filtr' },
            agent: { type: 'string', description: 'Agent nomi bo‘yicha filtr' },
            faqat_qarzdorlar: { type: 'boolean', description: 'Faqat bizga qarzdor mijozlar' },
            limit: { type: 'integer', description: `Nechta qator (standart ${LIMIT_DEFAULT}, maksimum ${LIMIT_MAX})` },
          },
        },
        roles: FIN_AGENT,
        run: async (input, user) => {
          const limit = clampLimit(input.limit);
          const where: Prisma.ClientWhereInput = {
            ...(user.role === 'AGENT' && user.agentId ? { agentId: user.agentId } : {}),
            ...(input.qidiruv ? { OR: nameWhere(String(input.qidiruv)).map((f) => ({ name: f })) } : {}),
            ...(input.agent ? { agent: { OR: nameWhere(String(input.agent)).map((f) => ({ name: f })) } } : {}),
          };
          const rows = await this.prisma.client.findMany({
            where,
            orderBy: { name: 'asc' },
            take: 500,
            select: { id: true, name: true, phone: true, creditLimit: true, active: true, agent: { select: { name: true } } },
          });
          const balances = await this.ledger.clientBalances(rows.map((r) => r.id));
          const list = rows
            .map((r) => ({
              nomi: r.name,
              agent: r.agent?.name ?? null,
              telefon: r.phone ?? null,
              balans: m(balances.get(r.id) ?? ZERO),
              balans_soni: Number(m(balances.get(r.id) ?? ZERO)),
              kredit_limiti: r.creditLimit ? m(r.creditLimit) : null,
              faol: r.active,
            }))
            .filter((r) => (input.faqat_qarzdorlar ? r.balans_soni > 0 : true))
            .sort((a, b) => b.balans_soni - a.balans_soni);
          const jami = list.reduce((s, r) => s + r.balans_soni, 0);
          return {
            mijozlar: list.slice(0, limit).map(({ balans_soni: _drop, ...rest }) => rest),
            topildi: list.length,
            korsatildi: Math.min(limit, list.length),
            jami_balans: jami.toFixed(2),
            izoh: 'balans > 0 ⇒ mijoz bizga qarzdor; balans < 0 ⇒ bizda uning avansi turibdi',
          };
        },
      },

      // ═══ 6. Bitta mijoz ═══
      {
        name: 'mijoz',
        description:
          "Bitta mijozning kartasi: balansi, kredit limiti, agenti, paddon qoldig'i, " +
          "HOZIRGACHA UNDAN JAMI QANCHA PUL OLGANIMIZ, oxirgi buyurtmalari va oxirgi " +
          "to'lovlari. Nomning BIR QISMI yetarli (lotin ham, kirill ham) — to'liq nom shart " +
          "emas; bir nechta mijoz mos kelsa, variantlar ro'yxati qaytadi.",
        input_schema: {
          type: 'object',
          properties: {
            mijoz: { type: 'string', description: 'Mijoz nomi yoki uning bir qismi (yoki id)' },
          },
          required: ['mijoz'],
        },
        roles: FIN_AGENT,
        run: async (input, user) => {
          const { one, many } = await this.findClient(String(input.mijoz ?? ''), user);
          if (!one) {
            return many.length
              ? { aniqlashtiring: 'Bir nechta mijoz topildi', variantlar: many.map((r) => r.name) }
              : { xato: 'Mijoz topilmadi (yoki sizga ko‘rinmaydi)' };
          }
          const [balance, agent, palletStats, orders, payments, totals] = await Promise.all([
            this.ledger.clientBalance(one.id),
            one.agentId ? this.prisma.agent.findUnique({ where: { id: one.agentId }, select: { name: true } }) : null,
            this.pallets.clientPalletStatsOne(one.id),
            this.prisma.order.findMany({
              // bekor qilingani ro'yxatga ham tushmaydi: modelga «savdo: 4 mln» deb
              // uzatilgan qator, yonida `holat` tursa ham, javobda qo'shilib ketadi
              where: { clientId: one.id, ...NOT_CANCELLED },
              orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
              take: 10,
              select: {
                orderNo: true, date: true, status: true, saleTotal: true, costTotal: true,
                factory: { select: { name: true } },
              },
            }),
            this.prisma.payment.findMany({
              where: { clientId: one.id, voidedAt: null },
              orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
              take: 10,
              select: { date: true, kind: true, method: true, amount: true, note: true },
            }),
            // butun tarix bo'yicha jamilar — mijoz kartasidagi strip bilan bir xil manba
            this.prisma.payment.groupBy({
              by: ['kind'],
              where: {
                clientId: one.id,
                voidedAt: null,
                kind: { in: [PaymentKind.CLIENT_IN, PaymentKind.CLIENT_REFUND, PaymentKind.TRANSPORT_DIRECT] },
              },
              _sum: { amount: true },
            }),
          ]);
          const sumOf = (kind: PaymentKind) => D(totals.find((g) => g.kind === kind)?._sum.amount ?? 0);
          const received = sumOf(PaymentKind.CLIENT_IN);
          const refunded = sumOf(PaymentKind.CLIENT_REFUND);
          return {
            nomi: one.name,
            agent: agent?.name ?? null,
            telefon: one.phone ?? null,
            faol: one.active,
            balans: m(balance),
            balans_izohi: D(balance).greaterThan(0) ? 'bizga qarzdor' : D(balance).lessThan(0) ? 'avansi bor' : 'hisob yopiq',
            kredit_limiti: one.creditLimit ? m(one.creditLimit) : 'cheklanmagan',
            paddon: {
              jami_berdik: palletStats.received,
              jami_qaytardi: palletStats.returned,
              yoqotgani: palletStats.chargedLost,
              hozir_mijozda: palletStats.balance,
            },
            tolov_jamilari: {
              jami_olingan: m(received),
              qaytarilgan: m(refunded),
              sof_olingan: m(received.minus(refunded)),
              // kassamizdan o'tmagan: mijoz shofyorga to'g'ridan-to'g'ri bergani
              shofyorga_bergani: m(sumOf(PaymentKind.TRANSPORT_DIRECT)),
            },
            oxirgi_buyurtmalar: orders.map((o) => ({
              raqam: o.orderNo,
              sana: d(o.date),
              holat: o.status,
              zavod: o.factory.name,
              savdo: m(o.saleTotal),
              ...(user.role === 'AGENT' ? {} : { tannarx: m(o.costTotal) }),
            })),
            oxirgi_tolovlar: payments.map((p) => ({
              sana: d(p.date),
              turi: p.kind,
              usul: p.method,
              summa: m(p.amount),
              izoh: p.note ?? null,
            })),
          };
        },
      },

      // ═══ 7. Buyurtmalar ═══
      {
        name: 'buyurtmalar',
        description:
          "Buyurtmalar ro'yxati va yig'indisi. Mijoz, zavod, agent, sana oralig'i va holat " +
          "bo'yicha filtrlash mumkin. Yig'indida savdo, tannarx, foyda va m³ bor. " +
          "«Falon mijozga nechta buyurtma bo'ldi», «shu oyda qancha sotdik» savollari uchun.",
        input_schema: {
          type: 'object',
          properties: {
            mijoz: { type: 'string', description: 'Mijoz nomi' },
            zavod: { type: 'string', description: 'Zavod nomi' },
            agent: { type: 'string', description: 'Agent nomi' },
            // BEKOR QILINGAN ATAYLAB YO'Q (egasi qoidasi, 2026-07-28). Ilgari butun
            // enum e'lon qilinar edi va `holat` standart shartni ALMASHTIRARDI — ya'ni
            // `holat: 'CANCELLED'` bilan chaqirilgan tool bekor qilingan buyurtmalar
            // ustidan savdo/tannarx/foyda/m³ yig'indisini hisoblab berardi. Modelga
            // ko'rinmaydigan variantni tanlash imkoni bo'lmasligi kerak.
            holat: {
              type: 'string',
              enum: Object.values(OrderStatus).filter((s) => s !== OrderStatus.CANCELLED),
              description: 'Buyurtma holati. Bekor qilinganlar hech qachon kirmaydi.',
            },
            ...SCHEMA_DATES,
            limit: { type: 'integer', description: `Nechta qator (standart ${LIMIT_DEFAULT}, maksimum ${LIMIT_MAX})` },
          },
        },
        roles: FIN_AGENT,
        run: async (input, user) => {
          const limit = clampLimit(input.limit);
          const from = dayStart(input.from);
          const to = dayEnd(input.to);
          const where: Prisma.OrderWhereInput = {
            ...(user.role === 'AGENT' && user.agentId ? { agentId: user.agentId } : {}),
            // `holat` bekor qilinganlar shartini ALMASHTIRMAYDI, ustiga QO'SHILADI:
            // holat berilsa ham, berilmasa ham bekor qilinganlar hech qachon kirmaydi.
            ...(input.holat && input.holat !== OrderStatus.CANCELLED
              ? { status: input.holat as OrderStatus }
              : NOT_CANCELLED),
            ...(input.mijoz ? { client: { OR: nameWhere(String(input.mijoz)).map((f) => ({ name: f })) } } : {}),
            ...(input.zavod ? { factory: { OR: nameWhere(String(input.zavod)).map((f) => ({ name: f })) } } : {}),
            ...(input.agent ? { agent: { OR: nameWhere(String(input.agent)).map((f) => ({ name: f })) } } : {}),
            ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
          };
          const [rows, agg, cubes, total] = await Promise.all([
            this.prisma.order.findMany({
              where,
              orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
              take: limit,
              select: {
                orderNo: true, date: true, status: true, saleTotal: true, costTotal: true,
                costStatus: true, transportCost: true, transportCharge: true,
                client: { select: { name: true } },
                factory: { select: { name: true } },
                agent: { select: { name: true } },
              },
            }),
            this.prisma.order.aggregate({
              where,
              _sum: { saleTotal: true, costTotal: true, transportCharge: true, transportCost: true },
              _count: true,
            }),
            this.prisma.orderItem.aggregate({ where: { order: where }, _sum: { quantityM3: true } }),
            this.prisma.order.count({ where }),
          ]);
          const sale = D(agg._sum.saleTotal ?? 0);
          const cost = D(agg._sum.costTotal ?? 0);
          const tProfit = D(agg._sum.transportCharge ?? 0).minus(agg._sum.transportCost ?? 0);
          const hideCost = user.role === 'AGENT';
          return {
            jami: {
              buyurtmalar: agg._count,
              savdo: m(sale),
              ...(hideCost
                ? {}
                : {
                    tannarx: m(cost),
                    mol_foydasi: m(sale.minus(cost)),
                    transport_foydasi: m(tProfit),
                    sof_foyda: m(sale.minus(cost).plus(tProfit)),
                  }),
              m3: n3(cubes._sum.quantityM3 ?? 0),
            },
            korsatildi: rows.length,
            topildi: total,
            buyurtmalar: rows.map((o) => ({
              raqam: o.orderNo,
              sana: d(o.date),
              holat: o.status,
              mijoz: o.client.name,
              zavod: o.factory.name,
              agent: o.agent?.name ?? null,
              savdo: m(o.saleTotal),
              ...(hideCost ? {} : { tannarx: m(o.costTotal), tannarx_holati: o.costStatus }),
            })),
          };
        },
      },

      // ═══ 8. Bitta buyurtma ═══
      {
        name: 'buyurtma',
        description: "Bitta buyurtmaning to'liq kartasi: mahsulotlari, summasi, transporti, to'lovlari va paddoni.",
        input_schema: {
          type: 'object',
          properties: { raqam: { type: 'string', description: 'Buyurtma raqami, masalan ORD-1042' } },
          required: ['raqam'],
        },
        roles: FIN_AGENT,
        run: async (input, user) => {
          const raw = String(input.raqam ?? '').trim();
          const order = await this.prisma.order.findFirst({
            where: {
              OR: [{ orderNo: { equals: raw, mode: Prisma.QueryMode.insensitive } }, { id: raw }],
              ...(user.role === 'AGENT' && user.agentId ? { agentId: user.agentId } : {}),
            },
            include: {
              client: { select: { name: true } },
              factory: { select: { name: true } },
              agent: { select: { name: true } },
              vehicle: { select: { name: true, plate: true, driver: true } },
              items: { include: { product: { select: { name: true } } } },
              allocations: {
                where: { voidedAt: null },
                include: { payment: { select: { kind: true, method: true, date: true } } },
              },
              palletTransactions: { select: { type: true, qty: true, date: true } },
            },
          });
          if (!order) return { xato: 'Buyurtma topilmadi (yoki sizga ko‘rinmaydi)' };
          const hideCost = user.role === 'AGENT';
          return {
            raqam: order.orderNo,
            sana: d(order.date),
            tolov_muddati: d(order.dueDate),
            holat: order.status,
            mijoz: order.client.name,
            zavod: order.factory.name,
            agent: order.agent?.name ?? null,
            moshina: order.vehicle ? `${order.vehicle.name}${order.vehicle.plate ? ' · ' + order.vehicle.plate : ''}` : null,
            shofyor: order.driverName ?? order.vehicle?.driver ?? null,
            savdo_summasi: m(order.saleTotal),
            ...(hideCost
              ? {}
              : {
                  tannarx: m(order.costTotal),
                  tannarx_holati: order.costStatus,
                  zavodga_tolash_niyati: order.factoryPayIntent,
                  mol_foydasi: m(D(order.saleTotal).minus(order.costTotal)),
                }),
            transport: {
              rejim: order.transportMode,
              shofyorga_xarajat: hideCost ? undefined : m(order.transportCost),
              mijozdan_olingan: m(order.transportCharge),
              tolangan_holati: order.transportPaidStatus,
            },
            mahsulotlar: order.items.map((i) => ({
              nomi: i.product.name,
              m3: n3(i.actualQuantityM3 ?? i.quantityM3),
              paddon: i.actualPalletCount ?? i.palletCount,
              sotuv_narxi_m3: m(i.salePricePerM3),
              summa: m(i.saleTotal),
            })),
            tolovlar: order.allocations.map((a) => ({
              sana: d(a.payment.date),
              turi: a.payment.kind,
              usul: a.payment.method,
              summa: m(a.amount),
            })),
            paddon_harakatlari: order.palletTransactions.map((p) => ({ sana: d(p.date), turi: p.type, dona: p.qty })),
            bekor_sababi: order.cancelReason ?? null,
            izoh: order.note ?? null,
          };
        },
      },

      // ═══ 9. To'lovlar ═══
      {
        name: 'tolovlar',
        description:
          "To'lovlar ro'yxati va turlar bo'yicha yig'indisi. Tur (CLIENT_IN, FACTORY_OUT, ...), " +
          "mijoz, zavod va sana oralig'i bo'yicha filtrlanadi. Bekor qilinganlar hisobga olinmaydi.",
        input_schema: {
          type: 'object',
          properties: {
            tur: { type: 'string', enum: Object.values(PaymentKind), description: "To'lov turi" },
            mijoz: { type: 'string', description: 'Mijoz nomi' },
            zavod: { type: 'string', description: 'Zavod nomi' },
            ...SCHEMA_DATES,
            limit: { type: 'integer', description: `Nechta qator (standart ${LIMIT_DEFAULT}, maksimum ${LIMIT_MAX})` },
          },
        },
        roles: EVERYONE,
        run: async (input, user) => {
          const limit = clampLimit(input.limit);
          const from = dayStart(input.from);
          const to = dayEnd(input.to);
          const where: Prisma.PaymentWhereInput = {
            voidedAt: null,
            ...(user.role === 'AGENT' && user.agentId ? { client: { agentId: user.agentId } } : {}),
            ...(input.tur ? { kind: input.tur as PaymentKind } : {}),
            ...(input.mijoz ? { client: { OR: nameWhere(String(input.mijoz)).map((f) => ({ name: f })) } } : {}),
            ...(input.zavod ? { factory: { OR: nameWhere(String(input.zavod)).map((f) => ({ name: f })) } } : {}),
            ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
          };
          const [rows, groups, total] = await Promise.all([
            this.prisma.payment.findMany({
              where,
              orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
              take: limit,
              select: {
                date: true, kind: true, method: true, amount: true, note: true,
                client: { select: { name: true } },
                factory: { select: { name: true } },
                vehicle: { select: { name: true } },
                cashbox: { select: { name: true } },
              },
            }),
            this.prisma.payment.groupBy({ by: ['kind'], where, _sum: { amount: true }, _count: { _all: true } }),
            this.prisma.payment.count({ where }),
          ]);
          return {
            turlar_boyicha_jami: groups.map((g) => ({
              tur: g.kind,
              soni: g._count._all,
              summa: m(g._sum.amount ?? 0),
            })),
            korsatildi: rows.length,
            topildi: total,
            tolovlar: rows.map((p) => ({
              sana: d(p.date),
              turi: p.kind,
              usul: p.method,
              summa: m(p.amount),
              tomon: p.client?.name ?? p.factory?.name ?? p.vehicle?.name ?? null,
              kassa: p.cashbox?.name ?? null,
              izoh: p.note ?? null,
            })),
          };
        },
      },

      // ═══ 10. Qarzdorlar ═══
      {
        name: 'qarzdorlar',
        description:
          "Qarzdorlik manzarasi: kompaniya bo'yicha umumiy yig'indi (mijozlar qarzi, zavodga qarz, " +
          "avanslar, paddon) va eng katta qarzdor mijozlar ro'yxati. «Kim qancha qarzdor», " +
          "«qancha pul yig'ishimiz kerak» savollari uchun.",
        input_schema: {
          type: 'object',
          properties: {
            limit: { type: 'integer', description: `Nechta qarzdor (standart ${LIMIT_DEFAULT}, maksimum ${LIMIT_MAX})` },
          },
        },
        roles: FIN,
        run: async (input, user) => {
          const limit = clampLimit(input.limit);
          const [summary, list] = await Promise.all([
            this.debts.summary(),
            this.debts.clients(user, { page: 1, pageSize: limit, dir: 'debt' }),
          ]);
          const items = list.items ?? [];
          return {
            kutilayotgan_yigim: m(list.expectedCollections),
            umumiy: {
              mijozlar_bizga_qarzdor: m(summary.clientsOweUs),
              mijozlarda_avansimiz: m(summary.weOweClients),
              zavodlarga_ochiq_mol_qarzi: m(summary.factoryPayableOpen),
              zavodlarga_qarzimiz_netto: m(summary.weOweFactories),
              zavodlardagi_avansimiz: m(summary.factoryAdvance),
              shofyorlarga_qarzimiz: m(summary.weOweVehicles),
              mijozlardagi_paddon_dona: summary.palletsAtClients,
              zavodlarga_paddon_qarzimiz_dona: summary.palletsOwedToFactories,
            },
            eng_katta_qarzdorlar: items.map((c) => ({
              mijoz: c.name,
              agent: typeof c.agent === 'string' ? c.agent : (c.agent?.name ?? null),
              qarzi: m(c.balance),
              muddati_otgan_summa: m(c.overdueOrdersTotal),
              muddati_otgan_buyurtma: c.overdueOrdersCount,
              paddon_dona: c.palletBalance,
              faqat_paddon_qarzi: c.palletOnly,
            })),
            qarzdorlar_soni: list.total,
          };
        },
      },

      // ═══ 11. Paddonlar ═══
      {
        name: 'paddonlar',
        description:
          "Paddon (poddon) manzarasi donada: zavodlardan jami oldik/qaytardik va hozir qancha " +
          "qarzdormiz, mijozlarga jami berdik/qaytarib oldik va hozir ularda qancha bor, " +
          "omborimizdagi bo'sh paddon. Paddon PUL emas — NATURADA yuritiladi.",
        input_schema: { type: 'object', properties: {} },
        roles: FIN_AGENT,
        run: async (_input, user) => {
          const b = (await this.pallets.balances(user)) as {
            clients: { client: { name: string }; balance: number; stats: { received: number; returned: number; chargedLost: number } }[];
            factories?: { factory: { name: string }; balance: number; stats: { received: number; returned: number } }[];
            dealerInHand?: number;
            totals: { factory: unknown; client: unknown; dealerInHand: number };
          };
          return {
            // AGENT ga zavod tomoni umuman kelmaydi (kompaniya majburiyati)
            zavodlar: b.factories
              ? b.factories.map((f) => ({
                  zavod: f.factory.name,
                  jami_oldik: f.stats.received,
                  jami_qaytardik: f.stats.returned,
                  hozir_qarzmiz_dona: f.balance,
                }))
              : 'bu bo‘lim sizning rolingiz uchun yopiq',
            mijozlar: b.clients
              .filter((c) => c.balance !== 0)
              .slice(0, 25)
              .map((c) => ({
                mijoz: c.client.name,
                jami_berdik: c.stats.received,
                jami_qaytardi: c.stats.returned,
                yoqotgani: c.stats.chargedLost,
                hozir_mijozda_dona: c.balance,
              })),
            ombordagi_bosh_paddon: b.dealerInHand ?? null,
            jami: b.totals,
            izoh: 'barcha raqamlar DONADA; paddon pul emas',
          };
        },
      },

      // ═══ 12. Agentlar ═══
      {
        name: 'agentlar',
        description:
          "Agentlar reytingi: oy bo'yicha savdo, mol foydasi, yig'ilgan pul, buyurtmalar soni va " +
          "mijozlarining ochiq qarzi. «Qaysi agent ko'p sotdi» savoli uchun.",
        input_schema: {
          type: 'object',
          properties: { oy: { type: 'string', description: 'YYYY-MM formatida oy (standart — joriy oy)' } },
        },
        roles: FIN,
        run: async (input) => {
          const r = await this.dashboard.agentsRanking(input.oy);
          return {
            oy: r.month,
            agentlar: r.agents.map((a) => ({
              agent: a.agent,
              savdo: m(a.sales),
              mol_foydasi: m(a.goodsProfit),
              yigilgan_pul: m(a.collected),
              buyurtmalar: a.orders,
              mijozlar_qarzi: m(a.outstandingDebt),
            })),
          };
        },
      },

      // ═══ 13. Mahsulotlar va narxlar ═══
      {
        name: 'mahsulotlar',
        description:
          "Mahsulotlar (blok o'lchamlari) va ularning JORIY narxlari: zavod naqd narxi, zavod " +
          "o'tkazma narxi va bizning sotuv narximiz (m³ uchun).",
        input_schema: {
          type: 'object',
          properties: { zavod: { type: 'string', description: 'Zavod nomi bo‘yicha filtr' } },
        },
        roles: FIN,
        run: async (input) => {
          const products = await this.prisma.product.findMany({
            where: {
              active: true,
              ...(input.zavod ? { factory: { OR: nameWhere(String(input.zavod)).map((f) => ({ name: f })) } } : {}),
            },
            orderBy: [{ factory: { name: 'asc' } }, { name: 'asc' }],
            take: 100,
            select: {
              id: true, name: true, size: true, m3PerPallet: true,
              factory: { select: { name: true } },
            },
          });
          const now = new Date();
          const prices = await this.prisma.productPrice.findMany({
            where: { productId: { in: products.map((p) => p.id) }, effectiveFrom: { lte: now } },
            orderBy: { effectiveFrom: 'desc' },
            select: { productId: true, kind: true, pricePerM3: true, effectiveFrom: true },
          });
          // newest-first ⇒ the FIRST row seen per (product, kind) is the one in force
          const current = new Map<string, { price: Prisma.Decimal; from: Date }>();
          for (const p of prices) {
            const key = `${p.productId}:${p.kind}`;
            if (!current.has(key)) current.set(key, { price: p.pricePerM3, from: p.effectiveFrom });
          }
          const at = (id: string, kind: PriceKind) => {
            const row = current.get(`${id}:${kind}`);
            return row ? m(row.price) : null;
          };
          return {
            mahsulotlar: products.map((p) => ({
              zavod: p.factory.name,
              nomi: p.name,
              olchami: p.size ?? null,
              m3_paddonda: n3(p.m3PerPallet),
              zavod_naqd_narxi_m3: at(p.id, PriceKind.FACTORY_CASH),
              zavod_otkazma_narxi_m3: at(p.id, PriceKind.FACTORY_BANK),
              sotuv_narxi_m3: at(p.id, PriceKind.DEALER_SALE),
            })),
            izoh: 'narxlar 1 m³ uchun, bugungi kunda amal qiladigan narx kitobidan',
          };
        },
      },
    ];
  }
}
