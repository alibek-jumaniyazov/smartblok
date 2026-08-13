import { OrderStatus, PalletTransactionType } from '@prisma/client';

/**
 * ═════════════ PADDON QARZI — QAYSI BUYURTMADAN ═════════════
 *
 * Egasi so'rovi (2026-08-13): «mijoz bizga 15 paddon qarz — o'sha 15 dona AYNAN qaysi
 * buyurtmalardan qolgan? Excel importdan kelgan bo'lsa, u ham aniq ko'rinsin».
 *
 * Daftar shu paytgacha faqat SONNI bilardi: «hozir mijozda 15». Qaysi yuk mashinasining
 * paddoni ekani qatorlarda yotardi-yu, hech qayerda yig'ilmasdi — mijoz kartochkasida
 * «15 dona» degan yakka raqam turardi va uni qaysi buyurtmaga bog'lash kerakligini faqat
 * defterni ko'z bilan sanab chiqib bilsa bo'lardi.
 *
 * ── Model ────────────────────────────────────────────────────────────────────
 * Har bir DELIVERED_TO_CLIENT qatori — bitta PARTIYA (lot): «shu buyurtma bilan shuncha
 * paddon chiqdi». Qaytarish (RETURNED_BY_CLIENT) va yo'qotilganini undirish (CHARGED_LOST)
 * esa partiyalarni YOPADI. Qaysi partiyani yopishini daftar aytmaydi — paddonda seriya
 * raqami yo'q — shuning uchun taqsimot QOIDA bilan bo'ladi:
 *
 *   1) Qaytarish qatorida BUYURTMA ko'rsatilgan bo'lsa, avval O'SHA buyurtmaning partiyasi
 *      yopiladi. Bu foydalanuvchi bergan yagona aniq ma'lumot — uni e'tiborsiz qoldirib
 *      FIFO qilish, u yozgan narsani ekranda inkor qilish bo'lardi.
 *   2) Qolgani FIFO: eng eski ochiq partiyadan boshlab. Avval qaytarish sanasidan OLDIN
 *      chiqqan partiyalar (fizik jihatdan faqat ularni qaytarish mumkin), ular tugasa —
 *      qolganlari. Ikkinchi bosqich ma'lumot chalkash bo'lgan holat uchun (orqaga sanalangan
 *      buyurtma, importdagi sana aniqligi) — usiz qaytarish «osilib» qolib, qarz ikkala
 *      tomonda ham ko'rinib turardi.
 *
 * ── Storno (REVERSAL) ────────────────────────────────────────────────────────
 * Storno qatori MUSTAQIL harakat EMAS: u aslining soniga qo'shiladi. `qty` — signed BALANS
 * deltasi (pallet-stats.ts dagi bilan bir xil imzo), shuning uchun:
 *   · yetkazishning stornosi manfiy  ⇒ partiya kichrayadi (bekor qilingan buyurtma yo'qoladi);
 *   · qaytarishning stornosi musbat  ⇒ yopilgan partiya qayta OCHILADI.
 * Bitta qator BIR NECHTA storno olishi mumkin (qirqilgan storno keyin davom ettiriladi —
 * pallets.service.ts reverseForOrder), shuning uchun hammasi YIG'INDI bo'lib qo'llanadi.
 *
 * ── Kafolat: ustunlar qoldiqqa TENG ──────────────────────────────────────────
 * `unassigned` — QOLDIQ (residual): balans minus partiyalar yig'indisi. Ya'ni ekrandagi
 * jadval har doim mijoz kartochkasidagi «hozir mijozda» raqamiga tushadi, hatto daftarda
 * bu modul ko'rmagan narsa (qo'lda ADJUSTMENT, egasiz storno) bo'lsa ham — u yolg'on
 * ko'rsatish o'rniga «manbasi ko'rsatilmagan» qatoriga tushadi. Aynan shu usul
 * pallet-stats.ts da `adjustment` uchun ishlaydi.
 */

/** Bitta paddon qatori — servis AYNAN shu maydonlarni o'qiydi. */
export interface PalletOriginInput {
  id: string;
  at: Date;
  date: Date;
  type: PalletTransactionType;
  qty: number;
  orderId: string | null;
  reversalOfId: string | null;
  importBatchId: string | null;
  order?: {
    id: string;
    orderNo: string;
    date: Date;
    status: OrderStatus;
    factory?: { id: string; name: string } | null;
  } | null;
  importBatch?: { id: string; filename: string | null; createdAt: Date } | null;
}

/** Bitta partiya — «shu buyurtma bilan chiqqan va shunchasi qaytmagan». */
export interface PalletOriginLot {
  /** yetkazish qatorining id'si — ekran uchun barqaror kalit */
  id: string;
  orderId: string | null;
  orderNo: string | null;
  /** buyurtma sanasi (bo'lmasa — qatorning o'z sanasi) */
  date: string;
  orderStatus: OrderStatus | null;
  /** bekor qilingan buyurtmada qolgan paddon — bu HOLAT emas, OGOHLANTIRISH */
  cancelled: boolean;
  factoryId: string | null;
  factoryName: string | null;
  /** shu partiya bilan chiqqan (storno hisobga olingan) */
  delivered: number;
  /** shu partiyadan qaytarib olingan */
  returned: number;
  /** shu partiyadan yo'qotilgan deb undirilgan */
  chargedLost: number;
  /** hali qaytmagan — «shu buyurtmadan qarz» */
  outstanding: number;
  /** Excel importdan kelgan bo'lsa — partiya id'si va yorlig'i */
  importBatchId: string | null;
  importBatchLabel: string | null;
  /** necha kundan beri mijozda turibdi (faqat ochiq partiyalarda ma'noli) */
  ageDays: number;
}

export interface PalletOriginBreakdown {
  /** mijoz kartochkasidagi «hozir mijozda» — kanonik qoldiq (PalletService bilan bitta) */
  balance: number;
  /** ochiq partiyalar (outstanding > 0), eng eskisidan boshlab */
  lots: PalletOriginLot[];
  /** to'liq qaytarilgan partiyalar — ular ro'yxatga chiqmaydi, lekin sanaladi */
  settledLots: number;
  /** partiyalarga bog'lab bo'lmagan qoldiq (qo'lda tuzatish / egasiz storno) */
  unassigned: number;
  /** bekor qilingan buyurtmalarda osilib qolgan paddon — 0 bo'lishi SHART */
  cancelledOutstanding: number;
  /** ochiq partiyalar soni (= lots.length) va ulardagi jami dona */
  openLots: number;
  openQty: number;
}

const MINUS_SIDE = new Set<PalletTransactionType>([
  PalletTransactionType.RETURNED_BY_CLIENT,
  PalletTransactionType.CHARGED_LOST,
]);

/** kunlar farqi (butun, manfiy bo'lmaydi) */
function daysBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  return ms <= 0 ? 0 : Math.floor(ms / 86_400_000);
}

/** ikkita paddon qatorini daftar tartibiga soladi: sana → yozilgan vaqt → id */
function chrono(a: PalletOriginInput, b: PalletOriginInput): number {
  const d = a.date.getTime() - b.date.getTime();
  if (d !== 0) return d;
  const t = a.at.getTime() - b.at.getTime();
  if (t !== 0) return t;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function batchLabel(b: PalletOriginInput['importBatch']): string | null {
  if (!b) return null;
  const when = new Date(b.createdAt).toISOString().slice(0, 10);
  return b.filename ? `${b.filename} · ${when}` : `Excel import · ${when}`;
}

/**
 * Mijozning ochiq paddon partiyalarini hisoblaydi.
 *
 * `balance` MAJBURIY va u tashqaridan (PalletService/pallet-stats) keladi — bu modul uni
 * QAYTA HISOBLAMAYDI. Sabab pallet-stats.ts dagi bilan bir xil: ekranda ikkita raqam bitta
 * savolga («mijozda nechta») ikki xil javob bermasligi kerak. Bu yerda faqat o'sha bitta
 * raqam partiyalarga BO'LINADI, farqi esa `unassigned` ga tushadi.
 */
export function attributePalletLots(
  rows: PalletOriginInput[],
  balance: number,
  now: Date = new Date(),
): PalletOriginBreakdown {
  // ── 1) storno qatorlarini asl qatorlarga yig'ib qo'yamiz ──
  const reversalSum = new Map<string, number>();
  for (const r of rows) {
    if (r.type !== PalletTransactionType.REVERSAL || !r.reversalOfId) continue;
    reversalSum.set(r.reversalOfId, (reversalSum.get(r.reversalOfId) ?? 0) + r.qty);
  }
  /**
   * Qatorning SOF soni. Storno `qty` si balans deltasi bo'lgani uchun minus tomondagi
   * turlarda (qaytarish, undirish) u AYIRILADI, plyus tomonda esa QO'SHILADI. Natija
   * hech qachon manfiy bo'lmaydi: ortiqcha storno yozilishi mumkin emas (servis chegarasi),
   * lekin bo'lib qolsa ham nolga qisiladi — manfiy partiya ma'nosiz.
   */
  const netOf = (r: PalletOriginInput): number => {
    const rev = reversalSum.get(r.id) ?? 0;
    const net = MINUS_SIDE.has(r.type) ? r.qty - rev : r.qty + rev;
    return net > 0 ? net : 0;
  };

  // ── 2) partiyalar (yetkazishlar) va ularni yopadigan qatorlar ──
  const sorted = [...rows].sort(chrono);
  interface Lot extends PalletOriginLot {
    src: PalletOriginInput;
  }
  const lots: Lot[] = [];
  const consumers: PalletOriginInput[] = [];
  for (const r of sorted) {
    if (r.type === PalletTransactionType.DELIVERED_TO_CLIENT) {
      const delivered = netOf(r);
      if (delivered <= 0) continue; // to'liq bekor qilingan yetkazish — partiya yo'q
      const when = r.order?.date ?? r.date;
      lots.push({
        src: r,
        id: r.id,
        orderId: r.orderId,
        orderNo: r.order?.orderNo ?? null,
        date: when.toISOString(),
        orderStatus: r.order?.status ?? null,
        cancelled: r.order?.status === OrderStatus.CANCELLED,
        factoryId: r.order?.factory?.id ?? null,
        factoryName: r.order?.factory?.name ?? null,
        delivered,
        returned: 0,
        chargedLost: 0,
        outstanding: delivered,
        importBatchId: r.importBatchId,
        importBatchLabel: batchLabel(r.importBatch),
        ageDays: daysBetween(when, now),
      });
    } else if (MINUS_SIDE.has(r.type) && netOf(r) > 0) {
      consumers.push(r);
    }
  }

  // ── 3) taqsimot: ko'rsatilgan buyurtma → FIFO ──
  for (const c of consumers) {
    let left = netOf(c);
    const isCharge = c.type === PalletTransactionType.CHARGED_LOST;
    const take = (lot: Lot) => {
      if (left <= 0 || lot.outstanding <= 0) return;
      const qty = Math.min(lot.outstanding, left);
      lot.outstanding -= qty;
      if (isCharge) lot.chargedLost += qty;
      else lot.returned += qty;
      left -= qty;
    };
    // 1) qatorda buyurtma ko'rsatilgan bo'lsa — avval o'sha partiya
    if (c.orderId) for (const lot of lots) if (lot.orderId === c.orderId) take(lot);
    // 2) qaytarish sanasidan OLDIN chiqqan partiyalar, eng eskisidan
    if (left > 0) for (const lot of lots) if (lot.src.date <= c.date) take(lot);
    // 3) qolgani — istalgan ochiq partiya (chalkash sanalar uchun zaxira yo'l)
    if (left > 0) for (const lot of lots) take(lot);
    // left > 0 bo'lib qolsa: qaytarish partiyalardan oshib ketdi ⇒ farq `unassigned` ga
    // tushadi (pastda, qoldiq sifatida) va ekranda «manbasi ko'rsatilmagan» bo'lib ko'rinadi.
  }

  // ── 4) natija ──
  const open = lots.filter((l) => l.outstanding > 0);
  const openQty = open.reduce((a, l) => a + l.outstanding, 0);
  return {
    balance,
    lots: open.map(({ src: _src, ...lot }) => lot),
    settledLots: lots.length - open.length,
    // QOLDIQ, alohida hisoblangan raqam emas — sarlavhadagi izohga qarang
    unassigned: balance - openQty,
    cancelledOutstanding: open.reduce((a, l) => a + (l.cancelled ? l.outstanding : 0), 0),
    openLots: open.length,
    openQty,
  };
}
