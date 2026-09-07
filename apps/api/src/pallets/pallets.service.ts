import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  LedgerAccount,
  LedgerSource,
  PalletTransactionType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { LedgerService } from '../common/ledger.service';
import { SETTING_KEYS, SettingsService } from '../common/settings.service';
import { assertPositiveMoney, round2 } from '../common/money';
import { pageArgs, Paged, paged } from '../common/pagination';
import { assertOwnAgent, clientAgentScope, RequestUser } from '../common/scoping';
import {
  ChargeLostDto,
  ClientReturnDto,
  FactoryReturnDto,
  PalletTxQueryDto,
  ReversePalletTxDto,
} from './dto';
import {
  EMPTY_PALLET_STATS,
  foldPalletStats,
  hasPalletHistory,
  palletStatsSql,
  sumPalletStats,
  type PalletOverview,
  type PalletPartyStats,
  type PalletStatsRow,
} from './pallet-stats';
import { attributePalletLots, consumersFeedingOrder, type ConsumerTake, type PalletOriginBreakdown } from './pallet-origins';

/**
 * Owner-locked default pallet money value (130 000 UZS) — used ONLY when a client is
 * charged for pallets he lost. A pallet handed back to the factory is worth nothing.
 */
export const DEFAULT_PALLET_UNIT_PRICE = 130000;

// Fixed key for the transaction-scoped advisory lock that serializes every
// factory-return against the single global loose-stock pool (see returnToFactory).
const PALLET_INHAND_ADVISORY_KEY = 748923;

type TypeSums = Partial<Record<PalletTransactionType, number>>;

/**
 * Pallets are owed IN KIND (counts, not money). Money appears through exactly ONE
 * explicit flow: CHARGED_LOST — a client who lost pallets is billed for them (one
 * linked CLIENT LedgerEntry) — and leaves through that same flow's storno
 * (reverseClientMovement), which reverses that one entry and nothing else.
 * Everything on the FACTORY side is count-only:
 * RECEIVED_FROM_FACTORY and RETURNED_TO_FACTORY never touch the ledger, never carry a
 * unitPrice, and a DB CHECK (pallet_factory_return_moneyless / ledger_no_pallet_return_credit)
 * makes it impossible to reintroduce.
 *
 * Client balance  = Σ DELIVERED_TO_CLIENT − Σ RETURNED_BY_CLIENT − Σ CHARGED_LOST
 *                   + Σ signed (ADJUSTMENT + REVERSAL with clientId)
 * Factory balance = Σ RECEIVED_FROM_FACTORY − Σ RETURNED_TO_FACTORY
 *                   + Σ signed (ADJUSTMENT + REVERSAL with factoryId)
 *
 * Return quantities are CAPPED so the books can never go physically impossible:
 *   - a client can hand back / be charged for at most what he still holds;
 *   - the dealer can send a factory at most min(loose in-hand stock, what he owes
 *     that factory). See recordClientReturn / chargeLost / returnToFactory.
 */

/**
 * Bekor qilingan buyurtmani yechishda BUTUN bo'lib stornolangan qaytarish/undirish
 * qatorining TIRIK buyurtmalarga tegishli ulushi — u buyurtma stornosidan KEYIN qayta
 * yoziladi (releaseForCancelledOrder dagi «uch qadamning tartibi» izohiga qarang).
 */
interface PendingRebook {
  type: PalletTransactionType;
  clientId: string;
  qty: number;
  date: Date;
  /** faqat undirishda — qayta yozilganda AYNAN shu narx bilan pul ham tiklanadi */
  unitPrice: Prisma.Decimal | null;
  importBatchId: string | null;
}

@Injectable()
export class PalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  // ── order hooks (called by OrdersService inside ITS transaction) ──

  /** One truck: pallets received from the factory and delivered to the client in the same move. */
  async recordOrderPallets(
    tx: Prisma.TransactionClient,
    args: {
      orderId: string;
      clientId: string;
      factoryId: string;
      date: Date;
      items: Array<{ palletCount: number; palletPrice?: any }>;
      createdById?: string | null;
      importBatchId?: string | null;
    },
  ): Promise<void> {
    const total = args.items.reduce((acc, i) => acc + (i.palletCount || 0), 0);
    if (total <= 0) return;
    await tx.palletTransaction.create({
      data: {
        type: PalletTransactionType.RECEIVED_FROM_FACTORY,
        factoryId: args.factoryId,
        qty: total,
        orderId: args.orderId,
        date: args.date,
        createdById: args.createdById ?? null,
        importBatchId: args.importBatchId ?? null,
      },
    });
    await tx.palletTransaction.create({
      data: {
        type: PalletTransactionType.DELIVERED_TO_CLIENT,
        clientId: args.clientId,
        qty: total,
        orderId: args.orderId,
        date: args.date,
        createdById: args.createdById ?? null,
        importBatchId: args.importBatchId ?? null,
      },
    });
    // DIQQAT — bu yerda qirqilgan stornolarni DAVOM ETTIRMASLIK kerak. Bir qarashda
    // «mijoz qo'lidagi son ko'tarildi, demak joy bor» degan mantiq to'g'ri ko'rinadi,
    // lekin YANGI YUK boshqa paddonlarni olib keladi: u mijoz qoldig'ini ham, zavod
    // oldidagi qarzni ham BIRGA ko'taradi. Bekor qilingan buyurtmaning bo'lagini o'sha
    // hisobdan yopish ikkalasini ham teng kamaytiradi — konservatsiya tenglamasi yopiq
    // qoladi (shuning uchun hech qanday tekshiruv buni ko'rmaydi), ammo TARKIB buziladi:
    // mijoz qo'lidagi haqiqiy paddon hisobdan yo'qoladi (uni endi na qaytarib olib
    // bo'ladi, na yo'qolgan deb undirib), zavod qarzi esa biz uning paddonini omborda
    // ushlab turganimizga qaramay nolga tushadi (`returnToFactory` chegarasi = 0).
    //
    // Qirqish faqat uni tug'dirgan sabab yo'qolganda o'rinsiz bo'ladi — ya'ni qaytarish
    // yoki undirish BEKOR QILINGANDA (reverseClientMovement). O'sha yerda paddon
    // dillerning zaxirasidan mijozga qaytadi, ya'ni AYNAN o'sha paddonlar haqida gap
    // ketadi. Shu sababli davom ettirish yagona joyda qoladi.
  }

  /**
   * Order cancel/edit: compensating REVERSAL rows for the order's OWN delivery
   * movements only (RECEIVED_FROM_FACTORY / DELIVERED_TO_CLIENT — both additive,
   * so qty is negated). Client returns and lost-pallet charges are standalone
   * physical/financial facts: negating their qty here would DOUBLE-subtract them
   * from the balance (they enter the formula with a minus already), and a
   * cancelled order does not un-return pallets a client physically brought back.
   *
   * CLAMPED to what the client still holds OF THIS ORDER. Pallets he already handed back
   * (or was charged for) are settled facts; reversing the full original delivery on top of
   * them would subtract the same pallets twice — driving his in-kind balance NEGATIVE
   * and minting phantom loose stock (which a factory-return would turn into real money
   * credit). The un-reversed remainder is not lost: it stays as a real factory
   * obligation, exactly matched by the loose stock we now physically hold, so
   *   factoryOwed = clientHeld + dealerInHand + chargedLost
   * still balances in every case:
   *   delivered 6, returned 0 → reverse 6 (full, unchanged behaviour)
   *   delivered 6, returned 2 → reverse 4 → client 0, inHand 2, factory owes 2
   *   delivered 6, returned 6 → reverse 0 → client 0, inHand 6, factory owes 6
   *
   * ┌ NEGA «SHU BUYURTMANIKI», umumiy qoldiq EMAS (2026-08-13) ┐
   * Chegara ilgari mijozning BUTUN qoldig'i edi va u boshqa buyurtmaning paddonini yeb
   * qo'yishi mumkin edi: mijozda X buyurtmasidan 10 dona bor, u hammasini qaytargan;
   * keyin Y buyurtmasidan yana 10 dona kelgan. X bekor qilinsa, «qoldiq 10» chegarasi
   * X ning stornosini to'liq yozar va natijada mijoz hisobida 0 qolardi — holbuki u
   * jismonan Y ning 10 donasini ushlab turibdi, X ning 10 donasi esa BIZNING omborda.
   * Konservatsiya tenglamasi buni ko'rmaydi (ikkala tomon teng siljiydi), lekin tarkib
   * buziladi. Shuning uchun chegara `pallet-origins.ts` taqsimotidan olinadi: qaytarish
   * eng eski partiyadan yopilgani uchun «shu buyurtmadan qancha qolgan» degan savolga
   * aniq javob bor, va u har doim umumiy qoldiqdan kichik yoki teng.
   *
   * ┌ QIRQILGAN BO'LAK DAVOM ETTIRILADI (2026-08-13) ┐
   * Qirqish VAQTINCHALIK holat: mijoz qo'lidagi son qaytadan ko'tarilsa (qaytarish yoki
   * undirish bekor qilindi, yangi yuk ketdi), qolgan bo'lak yozilishi SHART. Ilgari bu
   * mumkin emas edi — `reversalOfId` UNIQUE bo'lgani uchun asl qatorning yagona storno
   * uyasi band bo'lib qolardi va bo'lak abadiy osilib, bekor qilingan buyurtmaning
   * paddoni mijoz kartochkasida «tirilib» qolardi. Endi bir qator BIR NECHTA storno
   * oladi (migration 20260813120000) va bu metod IDEMPOTENT: har chaqirilganda faqat
   * QOLGANINI yozadi, ya'ni uni xohlagancha ko'p marta chaqirish mumkin.
   *
   * `full: true` — TAHRIR yo'li uchun: qirqishsiz, butun qoldiq stornolanadi. Tahrirda
   * storno darhol yangi qatorlar bilan ustidan yoziladi (recordOrderPallets), shuning
   * uchun qirqish u yerda buyurtmaning paddonini IKKI MARTA sanashga olib kelardi.
   */
  async reverseForOrder(
    tx: Prisma.TransactionClient,
    orderId: string,
    createdById?: string | null,
    opts?: { full?: boolean },
  ): Promise<void> {
    // Mijoz qatori qatorlarni O'QISHDAN OLDIN qulflanadi: `remainingOf` qulf ostida
    // o'qilmasa, ikkita parallel amal bir xil «qolgan» sonini ko'rib, ikkalasi ham yozib
    // yuborishi mumkin edi (ilgari bunga UNIQUE indeks to'siq bo'lardi, endi u yo'q).
    // Buyurtma bitta mijozniki, shuning uchun bitta so'rov yetarli.
    const owner = await tx.order.findUnique({ where: { id: orderId }, select: { clientId: true } });
    if (owner?.clientId) {
      await tx.$executeRaw`SELECT id FROM "Client" WHERE id = ${owner.clientId} FOR UPDATE`;
    }
    const rows = await tx.palletTransaction.findMany({
      where: {
        orderId,
        type: {
          in: [PalletTransactionType.RECEIVED_FROM_FACTORY, PalletTransactionType.DELIVERED_TO_CLIENT],
        },
      },
      // Har bir qatorning QOLGAN bo'lagi kerak — «stornosi bormi» degan savol endi
      // javob emas (qisman storno ham stornodir).
      include: { reversals: { select: { qty: true } } },
      orderBy: { at: 'asc' },
    });
    if (rows.length === 0) return;

    /** qatorning hali stornolanmagan bo'lagi (storno qty'si MANFIY ⇒ qo'shiladi) */
    const remainingOf = (r: (typeof rows)[number]) =>
      Math.max(0, r.qty + r.reversals.reduce((a, x) => a + x.qty, 0));

    const delivered = rows.filter((r) => r.type === PalletTransactionType.DELIVERED_TO_CLIENT);
    const received = rows.filter((r) => r.type === PalletTransactionType.RECEIVED_FROM_FACTORY);
    const deliveredQty = delivered.reduce((a, r) => a + remainingOf(r), 0);

    // how much of this order's delivery may still be un-delivered on the books
    let allowance = deliveredQty;
    const clientId = delivered.find((r) => r.clientId)?.clientId ?? null;
    if (clientId && !opts?.full) {
      // qulf yuqorida, o'qishdan oldin olingan — chegara ham o'sha qulf ostida hisoblanadi
      allowance = Math.max(0, Math.min(deliveredQty, await this.stillHeldFromOrder(tx, clientId, orderId)));
    }
    if (allowance <= 0) return; // fully settled by returns/charges — nothing to reverse

    // RECEIVED and DELIVERED are booked in equal qty per order (recordOrderPallets),
    // so the same allowance applies to both sides and conservation is preserved.
    const reverseSide = async (side: typeof rows) => {
      let left = allowance;
      for (const row of side) {
        if (left <= 0) break;
        // BUTUN qty emas, QOLGANI: aks holda davom ettirish allaqachon yopilgan
        // bo'lakni ikkinchi marta stornolar va qoldiqni manfiyga tushirardi.
        const remaining = remainingOf(row);
        if (remaining <= 0) continue; // `pallet_qty_nonzero` CHECK nol qatorni ham rad etadi
        const qty = Math.min(remaining, left);
        left -= qty;
        await tx.palletTransaction.create({
          data: {
            type: PalletTransactionType.REVERSAL,
            qty: -qty,
            clientId: row.clientId,
            factoryId: row.factoryId,
            orderId,
            date: new Date(),
            reversalOfId: row.id,
            reversalOfType: row.type,
            createdById: createdById ?? null,
            // Storno asl qatorning IMPORT PARTIYASIDA qoladi. Rollback partiyani
            // `importBatchId` bo'yicha yig'ib «nolga tushdimi» deb tekshiradi va allaqachon
            // storno qilingan qatorni qayta stornolamaydi — demak storno partiyadan
            // tashqarida qolsa, import qilingan buyurtmani BEKOR QILISH o'sha partiyaning
            // rollbackini butunlay qulflab qo'yardi («Rollback nolga tushmadi (poddon): 2q»),
            // va REPLACE rejimidagi qayta import ham u bilan birga o'lardi.
            importBatchId: row.importBatchId,
          },
        });
      }
    };
    await reverseSide(delivered);
    await reverseSide(received);
  }

  /**
   * ═══════ BEKOR QILINGAN BUYURTMANI PADDONDAN TO'LIQ YECHISH ═══════
   *
   * Egasining qarori (2026-09-04): «bekor qilingan buyurtmaning paddoni HECH QAYERDA
   * qolmasin — mijozning qaytargani ham, yo'qotilgani uchun undirilgan PUL ham qaytsin».
   *
   * ┌ NIMA BUZUQ EDI ┐
   * `reverseForOrder` yetkazish stornosini mijoz O'SHA PAYTDA ushlab turgan songa qadar
   * QIRQARDI. Mijoz paddonni allaqachon qaytargan (yoki undirilgan) bo'lsa, chegara 0 ga
   * tushar va storno UMUMAN yozilmasdi: bekor qilingan buyurtmaning 5 donasi ham mijoz
   * tarixida, ham zavod qarzida tirik qolardi. Egasi ko'rgan xato aynan shu edi va u
   * to'rtta yo'lda takrorlanardi (hammasi mijoz qaytargan/undirilgan holatlar):
   *     5 berildi → 5 qaytardi → bekor           ⇒ 5 dona osilib qolardi
   *     5 berildi → 2 qaytardi → bekor           ⇒ 2 dona
   *     5+5, FIFO eskisini yopgan → eskisi bekor ⇒ 5 dona
   *     5 berildi → 5 undirildi → bekor          ⇒ 5 dona (+ pul mijozda qarz bo'lib qolardi)
   *
   * ┌ YECHIM ┐
   * Yetkazishni stornolashdan OLDIN uni yopgan qatorlarni bo'shatamiz. Qaysi qator shu
   * buyurtmani yopganini `consumersFeedingOrder` aytadi — u ekrandagi «qaysi buyurtmadan»
   * paneli BILAN BITTA algoritmdan oziqlanadi, ya'ni ikkalasi hech qachon ikki xil javob
   * bermaydi. Bo'shatilgandan keyin mijoz qo'lidagi son ko'tariladi va `reverseForOrder`
   * ning O'Z chegarasi butun yetkazishga yo'l beradi — chegara OLIB TASHLANMAYDI (u mijoz
   * qoldig'ini manfiydan saqlaydigan kafolat), shunchaki endi qisib qo'ymaydi.
   *
   * ┌ BOSHQA BUYURTMAGA TEGMASLIK ┐
   * Qaytarish/undirish qatori BUTUN bo'lib bekor qilinadi — bazadagi
   * `PalletTransaction_whole_row_reversal_once` qisman unique indeksi qisman stornoga yo'l
   * qo'ymaydi (undirishning pul tomoni `LedgerEntry.reversalOfId` UNIQUE bilan baribir 1:1).
   * Bitta qaytarish bir nechta buyurtmani yopgan bo'lishi mumkin, shuning uchun BOSHQA
   * (tirik) buyurtmalarga tegishli ulush darhol QAYTA YOZILADI — aks holda bitta buyurtmani
   * bekor qilish begona buyurtmaning qaytarishini ham o'chirib yuborardi.
   *
   * ┌ ZAVODGA JO'NATIB BO'LINGAN PADDON ┐
   * Qaytarilgan paddon allaqachon zavodga qaytarib yuborilgan bo'lsa, uning stornosi diller
   * zaxirasini MANFIYGA tushirardi (o'sha zaxiradan `returnToFactory` chegarasi oziqlanadi).
   * Bunday qator bo'shatilmaydi — bekor qilish TO'XTAMAYDI, shunchaki eski (qirqilgan)
   * xatti-harakat o'sha bo'lak uchun saqlanadi. Bu yagona holat bo'lib, unda paddon jismonan
   * zavodda: uni «bo'lmagan» deb yozish daftarni yolg'onga aylantirardi.
   */
  async releaseForCancelledOrder(
    tx: Prisma.TransactionClient,
    orderId: string,
    createdById?: string | null,
  ): Promise<void> {
    const order = await tx.order.findUnique({ where: { id: orderId }, select: { clientId: true } });
    const clientId = order?.clientId ?? null;
    if (!clientId) {
      await this.reverseForOrder(tx, orderId, createdById);
      return;
    }
    // Qulf O'QISHDAN OLDIN — taqsimot ham, chegara ham shu qulf ostida hisoblanadi
    // (reverseForOrder dagi kafolatning ayni o'zi; u ham shu qulfni qayta oladi).
    await tx.$executeRaw`SELECT id FROM "Client" WHERE id = ${clientId} FOR UPDATE`;

    // ┌ UCH QADAMNING TARTIBI MUHIM ┐
    // Qayta yozish (3) STORNODAN KEYIN bo'lishi SHART. Aks holda u FIFO bo'yicha yana
    // eng eski ochiq partiyaga — ya'ni AYNAN bekor qilinayotgan buyurtmaga — tushar,
    // `reverseForOrder` ning chegarasi o'sha songa qisilar va buyurtmaning bir bo'lagi
    // yana osilib qolardi (5+5 dan 7 qaytarilgan holatda 2 dona). Storno yozilgandan
    // keyin bekor qilingan partiya umuman qolmaydi, shuning uchun qayta yozilgan ulush
    // faqat TIRIK buyurtmalarga tushadi.
    const rebooks = await this.releaseConsumersOf(tx, clientId, orderId, createdById); // 1
    await this.reverseForOrder(tx, orderId, createdById);                              // 2
    for (const r of rebooks) await this.rebookForLiveOrders(tx, r, createdById);        // 3
  }

  /**
   * Shu buyurtmaning partiyalarini yopgan qaytarish/undirish qatorlarini bo'shatadi.
   * Qaytarilgan ro'yxat — BOSHQA (tirik) buyurtmalarga tegishli bo'lgani uchun keyin
   * qayta yozilishi kerak bo'lgan ulushlar.
   */
  private async releaseConsumersOf(
    tx: Prisma.TransactionClient,
    clientId: string,
    orderId: string,
    createdById?: string | null,
  ): Promise<PendingRebook[]> {
    const rows = await tx.palletTransaction.findMany({
      where: { clientId },
      orderBy: [{ date: 'asc' }, { at: 'asc' }],
      select: {
        id: true, at: true, date: true, type: true, qty: true,
        orderId: true, reversalOfId: true, importBatchId: true,
      },
    });
    const { takes } = consumersFeedingOrder(rows, orderId);
    const rebooks: PendingRebook[] = [];
    for (const take of takes) {
      const r = await this.releaseConsumerRow(tx, take, createdById);
      if (r) rebooks.push(r);
    }
    return rebooks;
  }

  /**
   * Bitta qaytarish/undirish qatorini BUTUNLAY bekor qiladi. Pul tomoni faqat undirishda
   * bor va u `LedgerService.reverse` orqali ketadi — `reverseClientMovement` bilan bir xil
   * yo'l, shuning uchun «paddon qaytdi-yu puli qaytmadi» holati tug'ila olmaydi.
   *
   * Qator boshqa (tirik) buyurtmalarni ham yopgan bo'lsa, o'sha ulush DARHOL qayta
   * yozilmaydi — u qaytariladi va `releaseForCancelledOrder` uni yetkazish stornosidan
   * KEYIN yozadi (sababi o'sha yerdagi «uch qadamning tartibi» izohida).
   */
  private async releaseConsumerRow(
    tx: Prisma.TransactionClient,
    take: ConsumerTake,
    createdById?: string | null,
  ): Promise<PendingRebook | null> {
    const isReturn = take.type === PalletTransactionType.RETURNED_BY_CLIENT;

    // Allaqachon butunlay bekor qilingan qatorni ikkinchi marta stornolamaymiz — bazadagi
    // qisman unique indeks buni baribir rad etardi, lekin xato matni foydasiz bo'lardi.
    const already = await tx.palletTransaction.count({ where: { reversalOfId: take.rowId } });
    if (already > 0) return null;

    // Zavodga jo'natib bo'lingan paddonni «qaytmagan» deb yozib bo'lmaydi — izohga qarang.
    if (isReturn && take.qty > (await this.dealerInHandOn(tx))) return null;

    const full = await tx.palletTransaction.findUniqueOrThrow({
      where: { id: take.rowId },
      include: { ledgerEntry: { select: { id: true, reversedBy: { select: { id: true } } } } },
    });

    const reversal = await tx.palletTransaction.create({
      data: {
        type: PalletTransactionType.REVERSAL,
        qty: take.qty, // MUSBAT: yopilgan partiyani qayta ochadi (balans deltasi imzosi)
        clientId: full.clientId,
        factoryId: null, // mijoz tomonidagi harakat zavodga UMUMAN tegmaydi
        orderId: full.orderId,
        unitPrice: null, // pul faqat asl qatorda turadi — pallet-stats.ts uni AYIRADI
        reversalOfType: full.type,
        date: new Date(),
        note: 'Buyurtma bekor qilindi — paddon qaytarildi',
        reversalOfId: full.id,
        createdById: createdById ?? null,
        importBatchId: full.importBatchId,
      },
    });

    // ── PUL (faqat undirish): mijozdagi qarz aynan o'sha summaga kamayadi ──
    if (!isReturn && full.ledgerEntry && !full.ledgerEntry.reversedBy) {
      await this.ledger.reverse(
        tx,
        full.ledgerEntry.id,
        'Buyurtma bekor qilindi: yoʼqotilgan paddon undirilishi qaytarildi',
        createdById ?? null,
        { palletTransactionId: reversal.id },
      );
    }

    const others = take.qty - take.takenFromOrder;
    await this.audit.log({
      tx,
      userId: createdById ?? null,
      action: AuditAction.VOID,
      entity: 'PalletTransaction',
      entityId: full.id,
      before: { type: full.type, qty: full.qty, date: full.date.toISOString() },
      after: { reversalId: reversal.id, releasedForOrder: take.takenFromOrder, rebookedForOthers: others },
      note: 'Buyurtma bekor qilindi',
    });

    return others > 0
      ? {
          type: full.type,
          clientId: full.clientId as string,
          qty: others,
          date: full.date,
          unitPrice: isReturn ? null : full.unitPrice,
          importBatchId: full.importBatchId,
        }
      : null;
  }

  /**
   * Bekor qilingan buyurtma bilan BIRGA o'chib ketmasligi kerak bo'lgan ulushni qayta
   * yozadi: bitta qaytarish bir nechta buyurtmani yopgan bo'lsa, tirik buyurtmalarga
   * tegishli qismi shu yerda daftar’ga qaytadi. Buyurtma stornosi allaqachon yozilgani
   * uchun FIFO uni faqat TIRIK partiyalarga taqsimlaydi.
   */
  private async rebookForLiveOrders(
    tx: Prisma.TransactionClient,
    r: PendingRebook,
    createdById?: string | null,
  ): Promise<void> {
    const row = await tx.palletTransaction.create({
      data: {
        type: r.type,
        clientId: r.clientId,
        qty: r.qty,
        date: r.date, // ASL sana — davr hisobotlari joyidan qimirlamasin
        unitPrice: r.unitPrice,
        note: 'Bekor qilingan buyurtmadan ajratildi (boshqa buyurtmalarga tegishli qism)',
        createdById: createdById ?? null,
        importBatchId: r.importBatchId,
      },
    });
    // undirishda PUL ham qayta yoziladi — ASL narx bilan, sozlamadagi bugungisi bilan emas
    if (r.type === PalletTransactionType.CHARGED_LOST && r.unitPrice) {
      await this.ledger.post(tx, {
        date: r.date,
        account: LedgerAccount.CLIENT,
        source: LedgerSource.PALLET_CHARGE,
        amount: round2(r.unitPrice.times(r.qty)),
        clientId: r.clientId,
        palletTransactionId: row.id,
        note: 'Bekor qilingan buyurtmadan ajratildi',
        createdById: createdById ?? null,
      });
    }
  }

  /**
   * «Shu buyurtmadan mijozda hozir nechta paddon qolgan» — buyurtma stornosining
   * chegarasi. Javob `pallet-origins.ts` taqsimotidan olinadi (qaytarish eng eski
   * partiyadan yopiladi), ya'ni ekrandagi «Qaysi buyurtmalardan» paneli va storno
   * chegarasi BITTA qoidadan oziqlanadi — ikkalasi hech qachon ikki xil javob bermaydi.
   *
   * Har doim mijozning umumiy qoldig'idan kichik yoki teng, shuning uchun eski
   * kafolat («qoldiq manfiyga tushmaydi») saqlanadi.
   */
  private async stillHeldFromOrder(
    db: Prisma.TransactionClient,
    clientId: string,
    orderId: string,
  ): Promise<number> {
    const rows = await db.palletTransaction.findMany({
      where: { clientId },
      orderBy: [{ date: 'asc' }, { at: 'asc' }],
      select: {
        id: true, at: true, date: true, type: true, qty: true,
        orderId: true, reversalOfId: true, importBatchId: true,
      },
    });
    const balance = await this.clientBalanceOn(db, clientId);
    const out = attributePalletLots(rows, balance);
    return out.lots.filter((l) => l.orderId === orderId).reduce((a, l) => a + l.outstanding, 0);
  }

  // ── balances (sums over movements; >0 ⇒ the client holds our pallets) ──

  async clientPalletBalance(clientId: string): Promise<number> {
    const rows = await this.prisma.palletTransaction.groupBy({
      by: ['type'],
      where: { clientId },
      _sum: { qty: true },
    });
    const sums: TypeSums = {};
    for (const r of rows) sums[r.type] = r._sum.qty ?? 0;
    return this.combineClientSums(sums);
  }

  /** Per-client balances in ONE grouped query; optional `clientIds` narrows the sweep (agent card). */
  async clientPalletBalances(clientIds?: string[]): Promise<Map<string, number>> {
    if (clientIds && clientIds.length === 0) return new Map();
    const rows = await this.prisma.palletTransaction.groupBy({
      by: ['clientId', 'type'],
      where: { clientId: clientIds ? { in: clientIds } : { not: null } },
      _sum: { qty: true },
    });
    const perClient = new Map<string, TypeSums>();
    for (const r of rows) {
      if (!r.clientId) continue;
      const sums = perClient.get(r.clientId) ?? {};
      sums[r.type] = r._sum.qty ?? 0;
      perClient.set(r.clientId, sums);
    }
    const result = new Map<string, number>();
    for (const [clientId, sums] of perClient) result.set(clientId, this.combineClientSums(sums));
    return result;
  }

  /** Pallets we are accountable for at the factory. */
  async factoryPalletBalance(factoryId: string): Promise<number> {
    const rows = await this.prisma.palletTransaction.groupBy({
      by: ['type'],
      where: { factoryId },
      _sum: { qty: true },
    });
    const sums: TypeSums = {};
    for (const r of rows) sums[r.type] = r._sum.qty ?? 0;
    return this.combineFactorySums(sums);
  }

  async factoryPalletBalances(): Promise<Map<string, number>> {
    const rows = await this.prisma.palletTransaction.groupBy({
      by: ['factoryId', 'type'],
      where: { factoryId: { not: null } },
      _sum: { qty: true },
    });
    const perFactory = new Map<string, TypeSums>();
    for (const r of rows) {
      if (!r.factoryId) continue;
      const sums = perFactory.get(r.factoryId) ?? {};
      sums[r.type] = r._sum.qty ?? 0;
      perFactory.set(r.factoryId, sums);
    }
    const result = new Map<string, number>();
    for (const [factoryId, sums] of perFactory) result.set(factoryId, this.combineFactorySums(sums));
    return result;
  }

  // ── full breakdown (jami olingan / jami qaytarilgan / hozirgi qoldiq) ──
  // The netted balances above answer «hozir qancha», these answer «shu paytgacha
  // qancha». Both come out of the same rows; see pallet-stats.ts for why the
  // decomposition can never drift away from the balance.

  /** Per-client pallet history breakdown. `clientIds` narrows the sweep (detail cards). */
  async clientPalletStats(clientIds?: string[]): Promise<Map<string, PalletPartyStats>> {
    if (clientIds && clientIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<PalletStatsRow[]>(palletStatsSql('clientId', clientIds));
    return foldPalletStats(rows, 'client', (s) => this.combineClientSums(s));
  }

  /** Per-factory pallet history breakdown. */
  async factoryPalletStats(factoryIds?: string[]): Promise<Map<string, PalletPartyStats>> {
    if (factoryIds && factoryIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<PalletStatsRow[]>(palletStatsSql('factoryId', factoryIds));
    return foldPalletStats(rows, 'factory', (s) => this.combineFactorySums(s));
  }

  /** Single-party helpers — the detail pages ask for exactly one. */
  async clientPalletStatsOne(clientId: string): Promise<PalletPartyStats> {
    return (await this.clientPalletStats([clientId])).get(clientId) ?? { ...EMPTY_PALLET_STATS };
  }

  async factoryPalletStatsOne(factoryId: string): Promise<PalletPartyStats> {
    return (await this.factoryPalletStats([factoryId])).get(factoryId) ?? { ...EMPTY_PALLET_STATS };
  }

  /**
   * One factory's pallet movement INSIDE a date window — «shu davrda zavoddan nechta
   * poddon oldik va nechtasini qaytardik».
   *
   * DIQQAT: qaytgan obyektning `balance` maydoni QOLDIQ EMAS, davr DELTASI («qarzimiz shu
   * davrda qanchaga o'zgardi»). Qoldiq har doim `factoryPalletStatsOne` dan olinadi — u
   * butun daftarni yig'adi. Ikkalasi bir ekranda ko'rsatilsa, nomlari ham shunday ajratiladi.
   */
  async factoryPalletStatsPeriod(
    factoryId: string,
    window: { gte: Date; lt: Date },
  ): Promise<PalletPartyStats> {
    const rows = await this.prisma.$queryRaw<PalletStatsRow[]>(
      palletStatsSql('factoryId', [factoryId], window),
    );
    return (
      foldPalletStats(rows, 'factory', (s) => this.combineFactorySums(s)).get(factoryId) ?? {
        ...EMPTY_PALLET_STATS,
      }
    );
  }

  /**
   * Company-wide roll-up. `drift` is the conservation check
   *   zavodlarga qarzimiz  ==  mijozlardagi + qo'limizdagi + yo'qotilgan
   * — it stays 0 for every movement the app itself can produce, so a non-zero
   * value is a fingerprint of a manual ADJUSTMENT, never of normal trading.
   */
  async overview(scopedStats?: {
    client: Map<string, PalletPartyStats>;
    factory: Map<string, PalletPartyStats>;
    dealerInHand: number;
  }): Promise<PalletOverview> {
    const [clientMap, factoryMap, dealerInHand] = scopedStats
      ? [scopedStats.client, scopedStats.factory, scopedStats.dealerInHand]
      : await Promise.all([this.clientPalletStats(), this.factoryPalletStats(), this.dealerInHand()]);

    const client = sumPalletStats(clientMap.values());
    const factory = sumPalletStats(factoryMap.values());
    return {
      factory: {
        received: factory.received,
        returned: factory.returned,
        adjustment: factory.adjustment,
        balance: factory.balance,
      },
      client: {
        received: client.received,
        returned: client.returned,
        chargedLost: client.chargedLost,
        chargedLostAmount: client.chargedLostAmount,
        adjustment: client.adjustment,
        balance: client.balance,
      },
      dealerInHand,
      drift: factory.balance - (client.balance + dealerInHand + client.chargedLost),
    };
  }

  private combineClientSums(s: TypeSums): number {
    return (
      (s.DELIVERED_TO_CLIENT ?? 0) -
      (s.RETURNED_BY_CLIENT ?? 0) -
      (s.CHARGED_LOST ?? 0) +
      (s.ADJUSTMENT ?? 0) +
      (s.REVERSAL ?? 0)
    );
  }

  private combineFactorySums(s: TypeSums): number {
    return (
      (s.RECEIVED_FROM_FACTORY ?? 0) -
      (s.RETURNED_TO_FACTORY ?? 0) +
      (s.ADJUSTMENT ?? 0) +
      (s.REVERSAL ?? 0)
    );
  }

  // ── tx-aware balances (recomputed under a row lock inside a mutation) ──
  // `db` may be the request-scoped transaction (validation must see uncommitted
  // rows locked FOR UPDATE) or the base client (read endpoints). PrismaClient is
  // structurally assignable to TransactionClient, so both callers type-check.

  private async clientBalanceOn(db: Prisma.TransactionClient, clientId: string): Promise<number> {
    const rows = await db.palletTransaction.groupBy({
      by: ['type'],
      where: { clientId },
      _sum: { qty: true },
    });
    const sums: TypeSums = {};
    for (const r of rows) sums[r.type] = r._sum.qty ?? 0;
    return this.combineClientSums(sums);
  }

  /**
   * «Mijozda manfiy paddon» fizik jihatdan mumkin emas — u qaytarganidan kam olgan
   * bo'lib chiqadi va zaxirada yo'q paddonni «bor» qilib ko'rsatadi (zavodga qaytarish
   * chegarasi aynan shu zaxiradan o'qiydi). Buyurtma TAHRIRI shu holatga olib kelishi
   * mumkin bo'lgan yagona yo'l, shuning uchun tekshiruv o'sha yerda chaqiriladi.
   */
  async assertClientNotNegative(tx: Prisma.TransactionClient, clientId: string): Promise<void> {
    const held = await this.clientBalanceOn(tx, clientId);
    if (held < 0) {
      throw new BadRequestException(
        `Bu tahrirdan keyin mijozda ${held} dona paddon qolardi — u allaqachon qaytargan ` +
          `paddondan kamini olgan bo'lib chiqadi. Avval qaytarish qatorini tuzating.`,
      );
    }
  }

  private async factoryBalanceOn(db: Prisma.TransactionClient, factoryId: string): Promise<number> {
    const rows = await db.palletTransaction.groupBy({
      by: ['type'],
      where: { factoryId },
      _sum: { qty: true },
    });
    const sums: TypeSums = {};
    for (const r of rows) sums[r.type] = r._sum.qty ?? 0;
    return this.combineFactorySums(sums);
  }

  /**
   * Dealer's loose in-hand pallet stock (global): pallets clients handed back that
   * have not yet been sent on to a factory — «diller qo'lidagi paddon».
   *   inHand = Σ RETURNED_BY_CLIENT − Σ RETURNED_TO_FACTORY
   * RECEIVED_FROM_FACTORY and DELIVERED_TO_CLIENT are always booked together in equal
   * qty per order (recordOrderPallets), and reverseForOrder negates BOTH — so they
   * cancel and never add to loose stock. This pool is what a factory-return draws from.
   */
  private async dealerInHandOn(db: Prisma.TransactionClient): Promise<number> {
    // Reversals of a RETURN are netted out here (2026-07-25). An import rollback
    // writes REVERSAL rows against RETURNED_BY_CLIENT — the previous groupBy did not
    // look at REVERSAL at all, so a rolled-back import left phantom loose stock in
    // the pool and let a factory-return draw against pallets nobody was holding.
    // The reversal's qty is a signed BALANCE delta (+qty when it un-does a return),
    // hence the flipped signs on the REVERSAL branches.
    const [row] = await db.$queryRaw<Array<{ inHand: number }>>(Prisma.sql`
      SELECT COALESCE(SUM(
        CASE
          WHEN pt."type" = 'RETURNED_BY_CLIENT' THEN pt."qty"
          WHEN pt."type" = 'RETURNED_TO_FACTORY' THEN -pt."qty"
          WHEN pt."type" = 'REVERSAL' AND src."type" = 'RETURNED_BY_CLIENT' THEN -pt."qty"
          WHEN pt."type" = 'REVERSAL' AND src."type" = 'RETURNED_TO_FACTORY' THEN pt."qty"
          ELSE 0
        END
      ), 0)::int AS "inHand"
      FROM "PalletTransaction" pt
      LEFT JOIN "PalletTransaction" src ON src."id" = pt."reversalOfId"`);
    return Number(row?.inHand ?? 0);
  }

  /** Global loose in-hand pallet stock (read endpoints / dashboard). */
  async dealerInHand(): Promise<number> {
    return this.dealerInHandOn(this.prisma);
  }

  // ── read endpoints ──

  /**
   * Client balances (AGENT: own clients only) + factory summary for ADMIN/ACCOUNTANT.
   *
   * Every row now carries its FULL history (`stats`), not just the netted balance, and
   * the payload gains a company-wide `totals` roll-up. `balance` is still emitted at the
   * row root — it is `stats.balance`, kept as its own field so existing callers, the
   * debts board and the e2e suites keep reading the shape they always read.
   *
   * An AGENT gets the same shape scoped to his own clients: factory accountability and
   * the dealer's loose stock are company liabilities he must not see, so they come back
   * as zeros (the UI already hides those panels when `factories` is empty).
   *
   * THE COLUMNS MUST SUM TO THE HEADER. `totals` is the roll-up of the WHOLE stats map,
   * so a party that is hidden from `clients`/`factories` while still carrying lifetime
   * history would make the strip larger than the table beneath it — and, worse, would
   * answer «shu paytgacha jami qancha oldik» differently for an ADMIN and for the AGENT
   * of the same client. Hence `hasPalletHistory`: the active-only filter still hides the
   * dead weight (a deactivated client that never touched a pallet), but anything that
   * ever moved a pallet keeps its row. Deactivation requires a zero pallet balance, so
   * without this every settled-and-closed client silently left its lifetime figures in
   * the header with no row to explain them.
   */
  async balances(user: RequestUser) {
    const isAgent = user.role === 'AGENT';
    const emptyTotals = this.emptyOverview();
    if (isAgent && !user.agentId) return { clients: [], totals: emptyTotals };

    const clients = await this.prisma.client.findMany({
      where: isAgent ? { agentId: user.agentId as string } : {},
      orderBy: { name: 'asc' },
      select: { id: true, name: true, phone: true, agentId: true, active: true },
    });
    const clientStats = await this.clientPalletStats(isAgent ? clients.map((c) => c.id) : undefined);
    const clientRows = clients
      .map((client) => {
        const stats = clientStats.get(client.id) ?? { ...EMPTY_PALLET_STATS };
        return { client, balance: stats.balance, stats };
      })
      .filter((r) => r.client.active || hasPalletHistory(r.stats));

    if (isAgent) {
      // the same basis the ADMIN branch uses — the full scoped map, not the filtered
      // rows, so both roles publish one definition of «jami».
      const own = sumPalletStats(clientStats.values());
      return {
        clients: clientRows,
        totals: {
          ...emptyTotals,
          client: {
            received: own.received,
            returned: own.returned,
            chargedLost: own.chargedLost,
            chargedLostAmount: own.chargedLostAmount,
            adjustment: own.adjustment,
            balance: own.balance,
          },
        },
      };
    }

    const factories = await this.prisma.factory.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, active: true },
    });
    const [factoryStats, dealerInHand] = await Promise.all([
      this.factoryPalletStats(),
      // «diller qo'lida» loose stock — the pool a factory-return may draw from.
      this.dealerInHand(),
    ]);
    const factoryRows = factories
      .map((factory) => {
        const stats = factoryStats.get(factory.id) ?? { ...EMPTY_PALLET_STATS };
        return { factory, balance: stats.balance, stats };
      })
      .filter((r) => r.factory.active || hasPalletHistory(r.stats));

    const totals = await this.overview({ client: clientStats, factory: factoryStats, dealerInHand });

    return { clients: clientRows, factories: factoryRows, dealerInHand, totals };
  }

  private emptyOverview(): PalletOverview {
    return {
      factory: { received: 0, returned: 0, adjustment: 0, balance: 0 },
      client: { received: 0, returned: 0, chargedLost: 0, chargedLostAmount: '0.00', adjustment: 0, balance: 0 },
      dealerInHand: 0,
      drift: 0,
    };
  }

  async transactions(q: PalletTxQueryDto, user: RequestUser): Promise<Paged<unknown>> {
    const { skip, take, page, pageSize } = pageArgs(q);
    if (user.role === 'AGENT' && !user.agentId) return paged([], 0, page, pageSize);

    const where: Prisma.PalletTransactionWhereInput = {
      ...(q.clientId ? { clientId: q.clientId } : {}),
      ...(q.factoryId ? { factoryId: q.factoryId } : {}),
      // AGENT sees only rows of clients belonging to him (factory-only rows excluded)
      ...clientAgentScope(user),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.palletTransaction.findMany({
        where,
        skip,
        take,
        orderBy: [{ date: 'desc' }, { at: 'desc' }],
        include: {
          client: { select: { id: true, name: true } },
          factory: { select: { id: true, name: true } },
          order: { select: { id: true, orderNo: true } },
          // Juftlikning IKKALA uchi ham yuboriladi. Ekran shu paytgacha «bu qator bekor
          // qilinganmi» degan savolga AYNI SAHIFADAGI storno qatoriga qarab javob berardi —
          // ya'ni asli boshqa sahifaga tushib qolgan bekor qilingan qator jonli bo'lib
          // ko'rinardi (va endi «Bekor qilish» tugmasini ham ko'rsatardi, bosilganda 400).
          // Server javobi sahifalashdan qat'i nazar aniq.
          reversals: { select: { id: true, qty: true, date: true, note: true } },
          reversalOf: { select: { id: true, type: true, qty: true, date: true } },
        },
      }),
      this.prisma.palletTransaction.count({ where }),
    ]);
    /**
     * Ekran «bu qator bekor qilinganmi» degan savolni endi MASSIV ustida so'ramasin:
     * bo'sh massiv ham rost bo'ladi va uchala sirt (mijoz kartochkasi, /paddonlar,
     * zavod kartasi) jimgina HAR BIR qatorni bekor qilingan deb chizardi. Server bitta
     * halol skalyar beradi — qatorning hali yopilmagan bo'lagi.
     */
    const rows = items.map((r) => {
      const signed = r.reversals.reduce((a, x) => a + x.qty, 0);
      // storno qty'si BALANS deltasi: minus tomondagi turlarda (+), plyus tomonda (−)
      const undone = Math.abs(signed);
      const remainingQty = r.type === PalletTransactionType.REVERSAL ? r.qty : Math.max(0, r.qty - undone);
      return {
        ...r,
        remainingQty,
        /** butunlay yopilgan — «Bekor qilingan» yorlig'i va xiralashish shundan */
        fullyReversed: r.reversals.length > 0 && remainingQty === 0,
        /** qisman yopilgan — «Qisman bekor qilingan (4/6)» */
        partiallyReversed: r.reversals.length > 0 && remainingQty > 0,
      };
    });
    return paged(rows, total, page, pageSize);
  }

  /**
   * «Mijozdagi paddon AYNAN QAYSI BUYURTMALARDAN qolgan» (egasi so'rovi, 2026-08-13).
   *
   * Taqsimot qoidasi va «ustunlar qoldiqqa teng» kafolati pallet-origins.ts da — bu
   * yerda faqat o'qish va qamrov. `balance` AYNAN kartochkadagi raqam (clientPalletStats
   * dan), ya'ni panel hech qachon chip bilan bahslashmaydi.
   */
  async clientPalletOrigins(clientId: string, user: RequestUser): Promise<PalletOriginBreakdown> {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true, agentId: true },
    });
    if (!client) throw new NotFoundException('Mijoz topilmadi');
    assertOwnAgent(user, client.agentId);

    const [rows, stats] = await Promise.all([
      this.prisma.palletTransaction.findMany({
        where: { clientId },
        orderBy: [{ date: 'asc' }, { at: 'asc' }],
        select: {
          id: true,
          at: true,
          date: true,
          type: true,
          qty: true,
          orderId: true,
          reversalOfId: true,
          importBatchId: true,
          order: {
            select: {
              id: true,
              orderNo: true,
              date: true,
              status: true,
              factory: { select: { id: true, name: true } },
            },
          },
          importBatch: { select: { id: true, filename: true, createdAt: true } },
        },
      }),
      this.clientPalletStatsOne(clientId),
    ]);
    return attributePalletLots(rows, stats.balance);
  }

  // ── mutations (ADMIN/ACCOUNTANT — plus AGENT on client-return only, see below) ──

  /**
   * Client hands pallets back — reduces his in-kind counter. No money. Capped at what he holds.
   *
   * Takes the whole RequestUser, not just an id: since 2026-07-30 an AGENT may record this
   * (he is the one who physically collects the pallets), and the ONLY thing standing between
   * him and a foreign client's counter is `assertOwnAgent` below. A bare `userId` could not
   * express that check, so the signature carries the role.
   */
  async recordClientReturn(dto: ClientReturnDto, user: RequestUser) {
    const userId = user.userId;
    return this.prisma.$transaction(async (tx) => {
      const client = await tx.client.findUnique({ where: { id: dto.clientId } });
      if (!client) throw new NotFoundException('Mijoz topilmadi');
      // AGENT: faqat o'z mijozidan qaytarish yozadi (begonasi → 403). ADMIN/BUXGALTER o'tadi.
      // Tekshiruv mijoz o'qilgandan KEYIN: «yo'q mijoz» 404 bo'lib qolsin, 403 emas.
      assertOwnAgent(user, client.agentId);
      if (dto.orderId) {
        const order = await tx.order.findUnique({
          where: { id: dto.orderId },
          select: { id: true, clientId: true },
        });
        if (!order) throw new NotFoundException('Buyurtma topilmadi');
        // …va u AYNAN shu mijozning buyurtmasi bo'lishi shart. Aks holda qaytarish qatori
        // begona buyurtmaning jurnaliga yopishib qolardi (paddon harakatlarida havola bo'lib
        // ko'rinadi) — endi agent ham yozadigan bo'lgani uchun bu tekshiruv qamrovning bir qismi.
        if (order.clientId !== dto.clientId) {
          throw new BadRequestException('Buyurtma bu mijozga tegishli emas');
        }
      }
      // a client can hand back at most what he still physically holds — lock his row
      // so two concurrent returns can't each pass the check against the same balance.
      await tx.$executeRaw`SELECT id FROM "Client" WHERE id = ${dto.clientId} FOR UPDATE`;
      const held = await this.clientBalanceOn(tx, dto.clientId);
      if (dto.qty > held) {
        throw new BadRequestException(
          `Mijozda ${held} dona paddon bor — ${dto.qty} dona qaytarib bo'lmaydi`,
        );
      }
      const row = await tx.palletTransaction.create({
        data: {
          type: PalletTransactionType.RETURNED_BY_CLIENT,
          clientId: dto.clientId,
          qty: dto.qty,
          date: new Date(dto.date),
          orderId: dto.orderId ?? null,
          note: dto.note ?? null,
          createdById: userId,
        },
      });
      await this.audit.log({
        tx,
        userId,
        action: AuditAction.CREATE,
        entity: 'PalletTransaction',
        entityId: row.id,
        after: row,
      });
      return row;
    });
  }

  /**
   * ── MIJOZ TOMONIDAGI HARAKATNI BEKOR QILISH (storno) ──────────────────────
   *
   * Bitta endpoint IKKI xil xatoni tuzatadi — ikkalasi ham «mijozdan olingan paddon»
   * hikoyasining bir qismi, shuning uchun bitta tugma, bitta sabab oynasi, bitta jurnal:
   *
   *   1) «Mijoz qaytardi» (RETURNED_BY_CLIENT) — egasi so'rovi 2026-08-01: «bitta mijozdan
   *      paddon oldik, keyin qarasak bu boshqa mijoz ekan». Paddon O'SHA mijozda qoladi,
   *      PUL umuman qatnashmaydi.
   *   2) «Yo'qotilganini undirish» (CHARGED_LOST) — egasi so'rovi 2026-08-04: «undirib
   *      qo'ydik, keyin paddon topildi» yoki «xato mijozdan undirildi». Bunda PUL ham
   *      qaytadi: undirish yozgan CLIENT ledger qatori (PALLET_CHARGE) stornolanadi, ya'ni
   *      mijozning qarzi undirilgan summaga kamayadi va paddon yana uning hisobiga o'tadi.
   *
   * Qator O'CHIRILMAYDI: kassa stornosi bilan bir xil qoida — asli ham, uni yo'qqa
   * chiqaruvchi qator ham jurnalda qoladi (`reversalOfId` juftlikni bog'laydi, u UNIQUE ⇒
   * bir qator ikki marta bekor qilinmaydi). Faktni o'chirib tashlash daftardan izni
   * yo'qotardi; xato tuzatilishi kerak, tarix esa emas.
   *
   * ┌ IMZO: `qty` MUSBAT (ikkala turda ham) ┐
   * REVERSAL qatorining qty'si — SIGNED BALANS DELTASI, u qaytaradigan turning soni emas.
   * RETURNED_BY_CLIENT ham, CHARGED_LOST ham balansga MINUS bilan kiradi
   * (combineClientSums), demak ikkalasini ham yo'qqa chiqarish uchun +qty kerak: mijoz
   * qoldig'i o'sha songa QAYTIB oshadi. Aynan shu imzoni import rollback ham yozadi
   * (import-rollback.service.ts) va pallet-stats.ts uni `reversalOf.type` bo'yicha O'Z
   * katagiga («qaytargan» yoki «yo'qotilgan») qaytarib ayiradi — ya'ni gross figura
   * kamayadi, «tuzatish» katagi esa 0 bo'lib qoladi.
   *
   * ┌ CHEGARA: diller qo'lidagi zaxira (FAQAT qaytarish uchun) ┐
   * Qaytarishni bekor qilish mijozga +qty bersa, o'sha paddonlar diller qo'lidagi bo'sh
   * zaxiradan CHIQADI (dealerInHand −qty). Agar ular allaqachon zavodga qaytarib yuborilgan
   * bo'lsa, zaxira MANFIY bo'lardi — «qo'limizda −5 dona» degan fizik jihatdan mumkin
   * bo'lmagan holat, va u keyingi zavodga qaytarishlar chegarasini (returnToFactory)
   * buzardi. Shuning uchun `inHand >= row.qty` shart, va xato matni to'g'ri yo'lni AYTADI.
   *
   * Undirishni bekor qilishda bu chegara YO'Q va bo'lmasligi ham kerak: yo'qolgan paddon
   * hech qachon dillerning qo'liga qaytib kelmagan — u faqat mijoz hisobidan PULGA
   * o'tkazilgan. Shuning uchun zaxira umuman qimirlamaydi.
   *
   * Konservatsiya tenglamasi (zavodga qarz = mijozlarda + qo'limizda + yo'qotilgan) ikkala
   * yo'lda ham butun qoladi:
   *   qaytarish stornosi:  mijoz +qty, zaxira −qty, zavod tegilmaydi;
   *   undirish stornosi:   mijoz +qty, «yo'qotilgan» −qty, zaxira va zavod tegilmaydi.
   */
  async reverseClientMovement(id: string, dto: ReversePalletTxDto, user: RequestUser) {
    const userId = user.userId;
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.palletTransaction.findUnique({
        where: { id },
        include: {
          // 1:N bo'lgani uchun MASSIV. «Bo'shmi» degan savol `.length` bilan so'raladi —
          // `if (row.reversals)` bo'sh massivda ham rost bo'lib, HAR BIR qatorni
          // «allaqachon bekor qilingan» deb rad etardi.
          reversals: { select: { id: true } },
          client: { select: { id: true, name: true, agentId: true } },
          // Undirishning PUL tomoni. Bog'lanish 1:1 (LedgerEntry.palletTransactionId UNIQUE),
          // shuning uchun bu yerda «qaysi biri» degan savol yo'q — bittasi bor yoki yo'q.
          ledgerEntry: {
            select: { id: true, amount: true, source: true, reversedBy: { select: { id: true } } },
          },
        },
      });
      if (!row) throw new NotFoundException('Paddon harakati topilmadi');
      // Rol qamrovi mijoz o'qilgandan KEYIN: «yo'q qator» 404 bo'lib qolsin, 403 emas.
      // AGENT qaytarishni O'ZI yozadi (2026-07-30), demak o'z xatosini o'zi tuzatadi ham —
      // begona mijozning qatori esa u uchun umuman yo'q.
      assertOwnAgent(user, row.client?.agentId ?? null);

      const kind = this.reversibleKind(row.type);
      // Qolgan turlarning har biri o'z tuzatish yo'liga ega va uni AYTIB berish kerak —
      // «bekor qilib bo'lmaydi» degan quruq rad javobi foydalanuvchini boshi berk
      // ko'chada qoldiradi.
      if (!kind) throw new BadRequestException(this.notReversableMessage(row.type));

      // PUL yozadigan amalni bekor qilish ham PUL amali. `charge-lost` ning o'zi A·B da
      // (pallets.mutate) — uni AGENT bekor qila olsa, u yozolmaydigan amalni yechib
      // yuborardi. Kontroller darvozasi AGENTni qaytarish uchun ochiq qoldiradi, shuning
      // uchun tur bo'yicha qamrov aynan shu yerda.
      if (kind === 'CHARGE' && user.role !== 'ADMIN' && user.role !== 'ACCOUNTANT') {
        throw new ForbiddenException(
          "Undirishni bekor qilish mijozning pul qarzini kamaytiradi — buni faqat admin yoki buxgalter qila oladi",
        );
      }

      // Bu ikki tur BUTUN QATOR bo'yicha bekor qilinadi — qisman storno yo'q, shuning
      // uchun bitta storno bo'lsa ham qator yopilgan. Buni `PalletTransaction_whole_row_
      // reversal_once` qisman unique indeksi bazada ham ushlaydi (pastdagi P2002).
      if (row.reversals.length > 0) {
        throw new BadRequestException(
          kind === 'RETURN'
            ? 'Bu qaytarish allaqachon bekor qilingan'
            : 'Bu undirish allaqachon bekor qilingan',
        );
      }
      if (!row.clientId) {
        // ma'lumot buzilgan holat: mijozsiz «mijoz qaytardi» / «undirildi» qatori
        throw new BadRequestException("Qatorda mijoz ko'rsatilmagan — bekor qilib bo'lmaydi");
      }

      // Zaxira pooli GLOBAL: uni returnToFactory bilan bitta advisory lock serializatsiya
      // qiladi, aks holda ikki parallel amal bir xil zaxiraga qarab o'tib ketardi. Undirish
      // stornosi zaxiraga tegmaydi, shuning uchun u global qulfni olmaydi — olsa, butun
      // kompaniya bo'yicha keraksiz navbat yasagan bo'lardi.
      if (kind === 'RETURN') {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PALLET_INHAND_ADVISORY_KEY})`;
      }
      // Mijoz qatori IKKALA yo'lda ham qulflanadi — qoldiq o'qilishi bilan yozuv orasiga
      // qaytarish/undirish suqilib kirmasin (recordClientReturn dagi kafolatning ayni o'zi).
      await tx.$executeRaw`SELECT id FROM "Client" WHERE id = ${row.clientId} FOR UPDATE`;

      if (kind === 'RETURN') {
        const inHand = await this.dealerInHandOn(tx);
        if (row.qty > inHand) {
          // AGENTga zaxira SONI aytilmaydi: `balances()` unga `dealerInHand` ni ataylab
          // yubormaydi («kompaniya majburiyati, agentning ishi emas»), xato matni orqali
          // sizib chiqishi ham mumkin emas.
          throw new BadRequestException(
            user.role === 'AGENT'
              ? `Bu qaytarishni bekor qilib bo'lmaydi — paddonlar allaqachon zavodga jo'natilgan. Buxgalterga murojaat qiling`
              : `Bekor qilib bo'lmaydi: qaytarish ${row.qty} dona edi, diller qo'lida esa ${inHand} dona qoldi — ` +
                `qolgani zavodga qaytarib yuborilgan. Agar paddon boshqa mijozdan olingan bo'lsa, ` +
                `avval o'sha mijozdan qaytarishni yozing, keyin bu qatorni bekor qiling.`,
          );
        }
      }

      const reversal = await tx.palletTransaction
        .create({
          data: {
            type: PalletTransactionType.REVERSAL,
            qty: row.qty, // MUSBAT — yuqoridagi «IMZO» izohiga qarang
            clientId: row.clientId,
            // Mijoz tomonidagi harakat zavodga UMUMAN tegmaydi. `row.factoryId` ni ko'chirish
            // (u odatda null, lekin kafolat yo'q) stornoni combineFactorySums ga +qty
            // bo'lib qo'shar va konservatsiya tenglamasini shu songa buzardi.
            factoryId: null,
            orderId: row.orderId,
            // NARX KO'CHIRILMAYDI. Storno qatoriga `unitPrice` qo'yilsa, statistikaning pul
            // ustuni (palletStatsSql: money) uni yana bir marta QO'SHAR va «yo'qotilgan
            // paddon puli» ikki baravar bo'lib ketardi. Pul faqat asl qatorda turadi, storno
            // uni `reversalOf.unitPrice` orqali AYIRADI — pallet-stats.ts ga qarang.
            unitPrice: null,
            // Asl turi qatorga ko'chiriladi — u BUTUN QATOR stornosini bazada bir marta
            // bo'lishga majburlaydigan qisman unique indeksning predikati.
            reversalOfType: row.type,
            // Devor soati, asl sana emas — buyurtma stornosi (reverseForOrder) bilan bir xil.
            // Davr STATISTIKASI baribir aslning sanasiga qarab oynalanadi
            // (palletStatsSql: COALESCE(src."date", pt."date")), shuning uchun iyulda yozilib
            // avgustda bekor qilingan qaytarish tarix panelida ikkala oyni ham buzmaydi.
            // (Excel «Paddon harakatlari» varag'i esa xom `date` bo'yicha oynalanadi — u yerda
            // storno o'z oyida ko'rinadi, asl qator esa «Storno qilingan: Ha» deb turadi.)
            date: new Date(),
            note: dto.reason,
            reversalOfId: row.id,
            createdById: userId,
            // Import qatorining stornosi O'SHA partiyada qoladi. Import rollback partiyani
            // `importBatchId` bo'yicha yig'ib «nolga tushdimi» deb tekshiradi (palletSum) va
            // allaqachon bekor qilingan qatorni qayta stornolamaydi: storno partiyadan
            // tashqarida qolsa, o'sha yig'indi −qty bo'lib, rollback «Rollback nolga tushmadi
            // (poddon)» deb yiqilardi. Qo'lda yozilgan qatorda bu maydon baribir null.
            importBatchId: row.importBatchId,
          },
        })
        .catch((e) => {
          // `reversalOfId` UNIQUE. Yuqoridagi tekshiruv qulf ostida bo'lgani uchun bu yerga
          // faqat poyga tushadi — javob esa o'sha tekshiruv bilan bir xil bo'lsin.
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
            throw new BadRequestException(
              kind === 'RETURN'
                ? 'Bu qaytarish allaqachon bekor qilingan'
                : 'Bu undirish allaqachon bekor qilingan',
            );
          }
          throw e;
        });

      // ── PUL tomoni (faqat undirish) ─────────────────────────────────────────
      // Undirish mijozga qarz yozgan (LedgerSource.PALLET_CHARGE, musbat summa). Uni
      // bekor qilish o'sha qatorning stornosini yozadi ⇒ qarz aynan o'sha summaga kamayadi.
      //
      // `palletTransactionId` MAJBURIY va u YANGI storno qatoriga ishora qiladi: ustun
      // UNIQUE, ya'ni storno aslining id'sini qayta ishlata olmaydi, `ledger_pallet_link`
      // CHECK esa PALLET_CHARGE qatorini poddonsiz qoldirmaydi. LedgerService.reverse aynan
      // shuning uchun bu parametrni so'raydi (usiz butun tranzaksiya CHECK da yiqilardi).
      //
      // Ledger stornosi ASL biznes sanasini oladi (LedgerService.reverse) — iyulda undirilib
      // avgustda bekor qilingan pul iyul hisobotida ikkalasi bir-birini yopadi, «avgustda
      // daromad kamaydi» degan yolg'on chiqmaydi.
      let reversedAmount: Prisma.Decimal | null = null;
      if (kind === 'CHARGE' && row.ledgerEntry && !row.ledgerEntry.reversedBy) {
        const entry = await this.ledger.reverse(
          tx,
          row.ledgerEntry.id,
          `Paddon undirilishi bekor qilindi: ${dto.reason}`,
          userId,
          { palletTransactionId: reversal.id },
        );
        // storno summasi manfiy (asl qarzning teskarisi) — ekranga «qarzdan yechildi»
        // degan MUSBAT son ketadi
        reversedAmount = entry.amount.negated();
      }

      // ── «bu harakat umuman bo'lmaganida nima bo'lardi» ──────────────────────
      // Buyurtma bekor qilinganda uning yetkazish stornosi mijoz O'SHA PAYTDA ushlab
      // turgan songa qadar QIRQILADI (reverseForOrder allowance): mijoz hammasini
      // qaytarib bo'lgan (yoki hammasi yo'qolgan deb undirilgan) bo'lsa, storno umuman
      // yozilmaydi. Endi biz o'sha qatorni yo'qqa chiqaryapmiz — ya'ni mijoz qo'lidagi son
      // ortdi, demak qirqilgan storno DAVOM ETISHI kerak. Aks holda bekor qilingan
      // buyurtmaning paddoni mijoz kartochkasida tirilib qolardi («jami berilgan 5 ·
      // qaytargan 0 · hozir mijozda 5») va egasining «bekor qilinganlar hech qayerda
      // hisoblanmaydi» qoidasini buzardi. Konservatsiya tenglamasi buni KO'RMAYDI (ikkala
      // tomon teng siljiydi), shuning uchun bu yerda ataylab qo'lda yopiladi.
      await this.continueCancelledOrderReversals(tx, row.clientId, userId);

      await this.audit.log({
        tx,
        userId,
        action: AuditAction.VOID,
        entity: 'PalletTransaction',
        entityId: row.id,
        before: {
          type: row.type,
          qty: row.qty,
          clientId: row.clientId,
          date: row.date.toISOString(),
          unitPrice: row.unitPrice ? row.unitPrice.toFixed(2) : null,
        },
        after: {
          reversalId: reversal.id,
          qty: reversal.qty,
          reversedAmount: reversedAmount ? reversedAmount.toFixed(2) : null,
        },
        note: dto.reason,
      });
      // Yakuniy qoldiq QAYTARILADI, chunki u har doim `+qty` bo'lavermaydi: yuqoridagi
      // bekor qilingan buyurtma stornosi uni qaytadan tushirishi mumkin. Ekran «paddon
      // mijozda qoldi» deb umumiy gap aytish o'rniga SERVER hisoblagan sonni ko'rsatsin —
      // aks holda tugmani bosgan odam raqam qimirlamaganini ko'rib, xatolikka yo'yardi.
      // `reversedAmount` ham shu sababdan: undirish bekor qilinganda ekran AYNAN qancha
      // so'm yechilganini aytadi (narx qatorda saqlangan, sozlamadagi bugungi narx emas).
      return {
        ...reversal,
        reversedKind: kind,
        clientPalletBalance: await this.clientBalanceOn(tx, row.clientId),
        reversedAmount: reversedAmount ? reversedAmount.toFixed(2) : null,
      };
    });
  }

  /** Bekor qilinadigan ikki tur — boshqasi uchun `null` (sabab: notReversableMessage). */
  private reversibleKind(type: PalletTransactionType): 'RETURN' | 'CHARGE' | null {
    if (type === PalletTransactionType.RETURNED_BY_CLIENT) return 'RETURN';
    if (type === PalletTransactionType.CHARGED_LOST) return 'CHARGE';
    return null;
  }

  /**
   * Bekor qilingan buyurtmaning QIRQILGAN paddon stornosini davom ettiradi.
   *
   * Mijoz qo'lidagi son ko'targan HAR QANDAY hodisa shu yerdan o'tadi — qaytarish yoki
   * undirish stornosi (reverseClientMovement) va yangi yuk (recordOrderPallets) — aks
   * holda bekor qilingan buyurtmaning paddoni mijoz kartochkasida tirilib qolardi.
   *
   * 2026-08-13 gacha bu yerda qo'shimcha chegara bor edi: qisman qirqilgan storno
   * (6 berilgan, 2 qaytgan, 4 storno) DAVOM ETTIRIB bo'lmasdi, chunki `reversalOfId`
   * UNIQUE edi va asl qatorning yagona storno uyasi band bo'lardi — aynan shu bo'shliq
   * egasi ko'rgan «bekor qilingan buyurtmalar, lekin 5 dona paddon qayerdandir bor»
   * holatini tug'dirardi. Endi bir qator bir nechta bo'lak storno oladi, shuning uchun
   * filtr «stornosi yo'q» emas, «QOLGANI bor»: buni SQL da yig'ib so'raymiz, chunki
   * Prisma `where` da bunday jamlanma shart yo'q.
   */
  private async continueCancelledOrderReversals(
    tx: Prisma.TransactionClient,
    clientId: string,
    userId?: string | null,
  ): Promise<void> {
    // Ro'yxat AYNAN ekran ko'rsatadigan taqsimotdan olinadi: «bekor qilingan buyurtma,
    // lekin unda hamon qarz bor» degan qatorlar. Tartib eng eski partiyadan (lots
    // shunday saralangan) — chegara qisqa bo'lganda qaysi buyurtma yopilishi
    // BASHORATLI bo'lishi kerak, aks holda bir xil ma'lumot ikki xil natija berardi.
    const rows = await tx.palletTransaction.findMany({
      where: { clientId },
      orderBy: [{ date: 'asc' }, { at: 'asc' }],
      select: {
        id: true, at: true, date: true, type: true, qty: true,
        orderId: true, reversalOfId: true, importBatchId: true,
        order: { select: { id: true, orderNo: true, date: true, status: true } },
      },
    });
    const balance = await this.clientBalanceOn(tx, clientId);
    const pending = attributePalletLots(rows, balance)
      .lots.filter((l) => l.cancelled && l.outstanding > 0 && l.orderId)
      .map((l) => l.orderId as string);
    for (const orderId of [...new Set(pending)]) {
      await this.reverseForOrder(tx, orderId, userId);
    }
  }

  /** Nega bu qator bekor qilinmaydi — va o'rniga nima qilish kerak. */
  private notReversableMessage(type: PalletTransactionType): string {
    switch (type) {
      case PalletTransactionType.DELIVERED_TO_CLIENT:
      case PalletTransactionType.RECEIVED_FROM_FACTORY:
        return "Bu qator buyurtmadan kelib chiqqan — uni bekor qilish uchun buyurtmaning o'zini bekor qiling";
      case PalletTransactionType.RETURNED_TO_FACTORY:
        return "Zavodga qaytarishni bu yerdan bekor qilib bo'lmaydi";
      case PalletTransactionType.REVERSAL:
        return "Storno qatorining o'zini bekor qilib bo'lmaydi";
      default:
        return "Faqat «Mijoz qaytardi» va «Yo'qotilganini undirish» qatorlarini bekor qilish mumkin";
    }
  }

  /**
   * Send pallets back to the factory — UNITS ONLY, never money.
   *
   * Owner rule (2026-07-21): «zavod u paddonlar uchun pul bermaydi — faqat paddonlarni
   * sonida qarz bo'lgan bo'lamiz». The dealer owes the factory a COUNT; handing the
   * pallets back discharges that count and settles nothing financial. So this method
   * writes ONE PalletTransaction and NOTHING else: no LedgerEntry, no unitPrice, no
   * factory-balance movement. The retired PALLET_RETURN_CREDIT posting (which used to
   * grow the dealer's factory advance) is gone — historical rows keep rendering, but
   * `ledger_no_pallet_return_credit` now blocks any new one at the DB level, and the DTO
   * rejects a unitPrice outright instead of ignoring it.
   */
  async returnToFactory(dto: FactoryReturnDto, userId: string) {
    const date = new Date(dto.date);
    return this.prisma.$transaction(async (tx) => {
      const factory = await tx.factory.findUnique({ where: { id: dto.factoryId } });
      if (!factory) throw new NotFoundException('Zavod topilmadi');
      // serialize every factory-return on the single global loose-stock pool, then also
      // lock this factory's account. Cap = min(what the dealer physically holds, what he
      // still owes THIS factory): you can't send back pallets you don't have, and you
      // can't over-credit a factory past its debt («undan ortiq berib bo'lmaydi»).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PALLET_INHAND_ADVISORY_KEY})`;
      await tx.$executeRaw`SELECT id FROM "Factory" WHERE id = ${dto.factoryId} FOR UPDATE`;
      const owed = await this.factoryBalanceOn(tx, dto.factoryId);
      const inHand = await this.dealerInHandOn(tx);
      const cap = Math.max(0, Math.min(owed, inHand));
      if (dto.qty > cap) {
        throw new BadRequestException(
          `Zavodga ${dto.qty} dona qaytarib bo'lmaydi — diller qo'lida ${inHand} dona, zavod oldida ${owed} dona (maksimum ${cap} dona)`,
        );
      }
      const row = await tx.palletTransaction.create({
        data: {
          type: PalletTransactionType.RETURNED_TO_FACTORY,
          factoryId: dto.factoryId,
          qty: dto.qty,
          date,
          unitPrice: null, // in-kind: a return is worth no money (DB CHECK enforces it too)
          note: dto.note ?? null,
          createdById: userId,
        },
      });
      await this.audit.log({
        tx,
        userId,
        action: AuditAction.CREATE,
        entity: 'PalletTransaction',
        entityId: row.id,
        after: { ...row },
      });
      return row;
    });
  }

  /**
   * Price a LOST pallet is billed at when the caller omits one. Reads the
   * `palletPriceDefault` app setting — the single remaining pallet-money knob, since the
   * factory side is count-only. A missing or non-positive value means «not configured»
   * and falls back to the owner-locked 130 000.
   */
  private async defaultLostPalletPrice(): Promise<number> {
    const raw = await this.settings.get<unknown>(SETTING_KEYS.palletPriceDefault);
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_PALLET_UNIT_PRICE;
  }

  /** Convert lost pallets into client money debt (explicit flow only). Capped at what he holds. */
  async chargeLost(dto: ChargeLostDto, userId: string) {
    const unitPrice = this.toPositiveMoney(dto.unitPrice ?? (await this.defaultLostPalletPrice()), 'unitPrice');
    const date = new Date(dto.date);
    return this.prisma.$transaction(async (tx) => {
      const client = await tx.client.findUnique({ where: { id: dto.clientId } });
      if (!client) throw new NotFoundException('Mijoz topilmadi');
      // can't charge more lost than the client still holds — the pallets converted to
      // money leave his in-kind counter, which must not be driven negative by a charge.
      await tx.$executeRaw`SELECT id FROM "Client" WHERE id = ${dto.clientId} FOR UPDATE`;
      const held = await this.clientBalanceOn(tx, dto.clientId);
      if (dto.qty > held) {
        throw new BadRequestException(
          `Mijozda ${held} dona paddon bor — ${dto.qty} donani yo'qotilgan deb hisoblab bo'lmaydi`,
        );
      }
      const row = await tx.palletTransaction.create({
        data: {
          type: PalletTransactionType.CHARGED_LOST,
          clientId: dto.clientId,
          qty: dto.qty,
          date,
          unitPrice,
          note: dto.note ?? null,
          createdById: userId,
        },
      });
      const entry = await this.ledger.post(tx, {
        date,
        account: LedgerAccount.CLIENT,
        source: LedgerSource.PALLET_CHARGE,
        amount: round2(unitPrice.times(dto.qty)), // >0: client owes the dealer
        clientId: dto.clientId,
        palletTransactionId: row.id,
        note: dto.note ?? null,
        createdById: userId,
      });
      await this.audit.log({
        tx,
        userId,
        action: AuditAction.CREATE,
        entity: 'PalletTransaction',
        entityId: row.id,
        after: { ...row, ledgerEntryId: entry.id },
      });
      return row;
    });
  }

  private toPositiveMoney(v: Prisma.Decimal.Value, field: string): Prisma.Decimal {
    try {
      return assertPositiveMoney(v, field);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }
}
