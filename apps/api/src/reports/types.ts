import type { CostStatus, FactoryPayIntent, OrderStatus, PaymentKind, PaymentMethod } from '@prisma/client';

/**
 * ZAVOD BO'YICHA HISOBOT — sim shakllari.
 *
 * Pul har doim SATR (`round2().toFixed(2)`), hajm — satr 3 kasrda, narx — satr 6 kasrda.
 * Sabab bitta: JS `number` 18 xonali so'mni aniq saqlamaydi va brauzerda qilingan har
 * qanday qo'shish tiyinlik farq beradi. Shuning uchun frontend BIROR arifmetika qilmaydi
 * — har bir yakun, jumladan ro'yxat yig'indisi ham, shu yerdan tayyor holda ketadi.
 */
export type Money = string;
export type M3 = string;
export type Price = string;

export interface ReportPeriod {
  /** foydalanuvchi tanlagan chegaralar (null ⇒ ochiq) */
  from: string | null;
  /** KIRITUVCHI kun — server ichida [gte, lt) yarim ochiq oynaga aylanadi */
  to: string | null;
  gte: string;
  lt: string;
  /** «01.07.2026 — 31.07.2026» yoki «Butun davr» */
  label: string;
}

/** Ledger konvensiyasi: payable <0 ⇒ BIZ qarzdormiz; advance >0 ⇒ pulimiz zavodda turibdi. */
export interface FactoryBucketsWire {
  payable: Money;
  advanceCash: Money;
  advanceBank: Money;
  advanceTotal: Money;
  net: Money;
}

/** «Shu narxda shuncha kub olingan» — egasining asosiy savoli. */
export interface PriceBucket {
  /** OrderItem.costPricePerM3 — buyurtmaning O'Z langari, narx kitobidan qayta o'qilmaydi */
  pricePerM3: Price;
  /** true ⇔ narx 0: mahsulotga zavod narxi umuman kiritilmagan (sotuv baribir bloklanmaydi) */
  priceMissing: boolean;
  cubeM3: M3;
  /** kitobga haqiqatan tushgan pul (aralash yopilgan buyurtmada langardan farq qiladi) */
  costTotal: Money;
  /** cubeM3 × pricePerM3 — «narxnoma bo'yicha bo'lishi kerak edi» */
  anchorTotal: Money;
  items: number;
  orders: number;
}

export interface FactoryReportProduct {
  productId: string;
  productName: string;
  size: string | null;
  cubeM3: M3;
  plannedCubeM3: M3;
  costTotal: Money;
  /** costTotal / cubeM3 — O'RTACHA, narxnoma raqami emas. Hajm 0 bo'lsa null. */
  avgPricePerM3: Money | null;
  palletCount: number;
  orders: number;
  items: number;
  /** shu mahsulot ichida narx bo'yicha taqsimot */
  prices: PriceBucket[];
}

export interface FactoryReportPayments {
  /** Σ FACTORY_OUT, BONUSsiz — kassadan HAQIQATAN chiqqan pul */
  paid: Money;
  paidCash: Money;
  paidBank: Money;
  /** Σ FACTORY_REFUND — zavod bizga qaytargani */
  refunded: Money;
  netPaid: Money;
  /** method=BONUS: qarzni yopdi, lekin kassa qimirlamadi — «o'tkazilgan pul»ga KIRMAYDI */
  bonusOffset: Money;
  paymentCount: number;
  firstPaymentAt: string | null;
  lastPaymentAt: string | null;
  byMethod: {
    method: PaymentMethod;
    kind: PaymentKind;
    family: 'CASH' | 'BANK' | 'BONUS';
    amount: Money;
    count: number;
  }[];
}

export interface FactoryReportSettlement {
  byPriceKind: {
    cash: Money;
    bank: Money;
    /** priceKind = NULL — bankka QO'SHILMAYDI, o'z qatorida turadi */
    unknown: Money;
    total: Money;
  };
  allocationCount: number;
  /** «avansdan yechish» — zavodda turgan pul buyurtmaga o'tkazilgani (yangi pul EMAS) */
  drawnFromAdvance: { cash: Money; bank: Money; total: Money };
  /** davrda avans cho'ntagiga tushgan SOF pul (qaytarilgani ayirilgan) */
  advanceIn: { cash: Money; bank: Money; total: Money };
}

export interface FactoryReportOrderRow {
  id: string;
  orderNo: string;
  date: string;
  status: OrderStatus;
  costStatus: CostStatus;
  /** NIYAT (uch qiymatli) — yopilgan narxnoma kanali bilan bir xil narsa EMAS */
  factoryPayIntent: FactoryPayIntent;
  client: { id: string; name: string } | null;
  products: { id: string; name: string; size: string | null }[];
  cubeM3: M3;
  palletCount: number;
  costTotal: Money;
  /** Σ tirik FACTORY_OUT taqsimotlari */
  factoryPaid: Money;
  /** costTotal − factoryPaid; tannarx hali daftarga tushmagan bo'lsa 0 */
  factoryOpen: Money;
}

export interface FactoryReportOrdersResponse {
  items: FactoryReportOrderRow[];
  total: number;
  page: number;
  pageSize: number;
  /** BUTUN filtr bo'yicha — sahifadagi qatorlardan yig'ilmaydi */
  summary: {
    orders: number;
    cubeM3: M3;
    costTotal: Money;
    factoryPaid: Money;
    factoryOpen: Money;
    cancelledOrders: number;
  };
}

export interface FactoryReport {
  factory: { id: string; name: string; active: boolean; note: string | null };
  period: ReportPeriod;

  purchase: {
    orders: number;
    /** faqat SON — bu qatorlarning birorta raqami hech bir yakunga kirmagan */
    cancelledOrders: number;
    /** HAQIQIY hajm: actualQuantityM3 ?? quantityM3 */
    cubeM3: M3;
    /** REJA hajmi — farq ko'rinsin uchun, yakun sifatida ishlatilmaydi */
    plannedCubeM3: M3;
    costTotal: Money;
    avgPricePerM3: Money | null;
    /** davrda zavoddan olingan poddon (paddon daftaridan, sof) */
    palletsReceived: number;
    palletsReturned: number;
    /** shu davr buyurtmalarining hali yopilmagan zavod qarzi */
    openDebt: Money;
    openOrders: number;
    openByIntent: { cash: Money; bank: Money; unknown: Money };
  };

  products: FactoryReportProduct[];
  priceBreakdown: PriceBucket[];
  payments: FactoryReportPayments;
  settlement: FactoryReportSettlement;

  balances: {
    /** ledger yozuvlari davr oxirigacha — «bugungi bilim bo'yicha o'sha sanadagi holat» */
    asOfPeriodEnd: FactoryBucketsWire;
    /** zavod kartochkasidagi raqam bilan AYNAN bir xil */
    current: FactoryBucketsWire;
    /** shundan qo'lda kiritilgan off-book tuzatish (Dashboard uni chiqarib tashlaydi) */
    offBook: { asOfPeriodEnd: Money; current: Money };
  };

  bonus: {
    /**
     * Davr buyurtmalaridan hisoblangan bonus (ACCRUAL + keyingi ADJUSTMENT tuzatishlari).
     * «Qaysi hajm/summadan hisoblangan» degan BAZA ataylab berilmaydi: ADJUSTMENT qatori
     * bazani delta emas, to'liq qiymat qilib yozadi va uni yig'ish raqamni shishirardi.
     */
    accruedInPeriod: Money;
    offsetInPeriod: Money;
    walletCurrent: Money;
    program: {
      kind: string;
      ratePerM3: Money | null;
      percent: string | null;
      effectiveFrom: string;
    } | null;
  };

  pallets: {
    /** butun tarix — «hozir zavodga nechta poddon qarzmiz» */
    balance: number;
    receivedAllTime: number;
    returnedAllTime: number;
  };

  /**
   * Nazorat qatorlari. Farq chiqsa hisobot bittasini JIMGINA tanlamaydi — ikkalasini ham
   * ko'rsatadi va farqni ataydi. Normal holatda hammasi nol.
   */
  checks: {
    /** Σ Order.costTotal (yuqoridagi Σ OrderItem.costTotal bilan solishtirish uchun) */
    orderCostTotal: Money;
    costTotalDrift: Money;
    /** narxnoma bo'yicha «bo'lishi kerak edi» */
    anchorCostTotal: Money;
    /** narxi umuman kiritilmagan hajm */
    zeroPricedCubeM3: M3;
    /** zavodga to'lov boshqa kanal narxida yopgan pozitsiyalar soni */
    blendedItems: number;
  };
}
