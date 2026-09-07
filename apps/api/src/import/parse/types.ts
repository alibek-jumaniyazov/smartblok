import { Prisma } from '@prisma/client';

/**
 * ═══════════ SHABLON v5 — PARSER CHIQARADIGAN QATORLAR ═══════════
 *
 * Bu tiplar faylning O'ZIDA yozilganini olib yuradi va HECH NARSANI hisoblamaydi. Qoida:
 * daftar aytgan raqam shu yerda saqlanadi, undan biznes ma'nosi chiqarish esa commit'ning
 * ishi. Sabab tajribadan: parserda «hisoblab qo'yish» eng arzon usul bo'lib ko'rinadi, lekin
 * keyin egasi ekranda ko'rgan raqam faylda YO'Q raqamga aylanadi va farqni topib bo'lmaydi.
 *
 * Shu sababli formula bilan chiqadigan ustunlar (Сумма Приход = Куб×Нарх va h.k.) ham
 * O'QILADI: ular tekshiruv uchun (`*Declared`), hisob uchun emas.
 */

/** Qator qayerdan kelgani — egasining koordinatasi, review ekranida ko'rinadi. */
export interface RowOrigin {
  sheetName: string; // aynan faylda qanday bo'lsa (chetidagi bo'shliq ham saqlanadi)
  excelRow: number;
}

// ─────────────────────────── «Товар» ───────────────────────────

/**
 * Bitta mashina yuki. Ustunlar: A Тўлов тури · B Поставшик · C Агент · D Клиент · E Дата ·
 * F № авто · G Размер · H Блок Куб · I Цена Приход · J Сумма Приход · K Поддон Шт ·
 * L Цена Поддон · M Сумма Поддон · N Блок+Поддон · O Цена Продажа · P Сумма Продажа ·
 * Q Расход Авто · R Общая прибль · S Авто услу · T Мижозга
 */
export interface ShipmentRow {
  origin: RowOrigin;
  /** A «Тўлов тури» — SHU YUK qaysi kanal orqali zavodga to'lanadi («Касса»/«Перечисления»).
   *  Bu bezak emas: u buyurtmaning `factoryPayIntent` ini va QAYSI tannarx kitobiga
   *  langar tashlashini belgilaydi (naqd mol o'tkazmadan arzon). */
  factoryPayChannel: string;
  /** B «Поставшик» — ZAVOD nomi («Коалс» / «Ментора»). Yangi shablonda zavod har qatorda
   *  boshqacha bo'lishi mumkin, shuning uchun u endi bitta qotirilgan nom emas. */
  factoryRaw: string;
  agentRaw: string; // C «Агент»
  clientRaw: string; // D «Клиент» (bo'sh ⇒ MIJOZ_YOQ to'sig'i)
  date: Date | null; // E «Дата»
  truck: string; // F «№ авто»
  size: string; // G «Размер» (600x300x200 …)
  cube: number | null; // H «Блок Куб» m³
  costPrice: Prisma.Decimal | null; // I «Цена Приход» — 1 m³ zavod narxi
  costSumDeclared: Prisma.Decimal | null; // J «Сумма Приход» (= H×I, tekshiruv uchun)
  palletQty: number | null; // K «Поддон Шт»
  palletPrice: Prisma.Decimal | null; // L «Цена Поддон» (130 000)
  palletSumDeclared: Prisma.Decimal | null; // M «Сумма Поддон» (= K×L)
  takenSumDeclared: Prisma.Decimal | null; // N «Блок+Поддон» (= J+M)
  salePrice: Prisma.Decimal | null; // O «Цена Продажа» — 1 m³ sotuv narxi
  saleSumDeclared: Prisma.Decimal | null; // P «Сумма Продажа» (= H×O)
  /**
   * Q «Расход Авто» — transport HARAJATINI kim ko'taradi: «Клиент» yoki «Сотувчи».
   *
   * Eski shablonda bu ma'lumot YO'Q edi va import hamma yukni DEALER_ABSORBED deb yozardi
   * (izoh commit'da). Yangi faylda javob har qatorda turibdi va u T ustunini ham belgilaydi:
   *   «Клиент»  ⇒ mijoz shofyorga O'ZI to'laydi ⇒ biz undan P − S so'raymiz
   *   «Сотувчи» ⇒ transportni biz to'laganmiz  ⇒ biz undan to'liq P so'raymiz
   */
  transportPayerRaw: string;
  profitDeclared: Prisma.Decimal | null; // R «Общая прибль» (= P − J − S)
  transportCost: Prisma.Decimal | null; // S «Авто услу» — mashina xarajati
  /**
   * T «Мижозга» — mijozdan SO'RALADIGAN summa, daftarning o'z formulasi bilan:
   *   T = P − (Q="Клиент" ? S : 0)
   * «Мижозлар қолдиғи» varag'i mijoz qarzini AYNAN shu ustundan yig'adi, shuning uchun u
   * import uchun eng muhim pul ustuni — sotuv summasi emas.
   */
  clientChargeDeclared: Prisma.Decimal | null;
}

// ─────────────────────────── «Оплата» ───────────────────────────

/**
 * Bitta mijoz to'lovi. Ustunlar: A Дата · B Агент · C Клиент · D ПР-Сумма · E Плателщик ·
 * F Поддон · G Учун · H Накд · I Клик · J Терминал · K Жами сумма · L Получател · M Изох ·
 * N Поддон нархи · O Поддон пули · P Товарга
 */
export interface ClientPaymentRow {
  origin: RowOrigin;
  date: Date | null; // A
  agentRaw: string; // B
  clientRaw: string; // C
  /**
   * TO'LOV USULI ENDI TAXMIN QILINMAYDI. Eski shablonda bitta «Примечание» katagidagi
   * erkin matndan («Нахт», «Клик», bir firma nomi) kanal chamalanardi. Yangi faylda har
   * kanal O'Z USTUNIDA turadi, ya'ni klassifikator umuman kerak emas — bu importning eng
   * ko'p yolg'on chiqaradigan joyi edi.
   */
  bank: Prisma.Decimal | null; // D «ПР-Сумма» — o'tkazma
  cash: Prisma.Decimal | null; // H «Накд»
  click: Prisma.Decimal | null; // I «Клик»
  terminal: Prisma.Decimal | null; // J «Терминал»
  totalDeclared: Prisma.Decimal | null; // K «Жами сумма» (= D+H+I+J)
  payer: string; // E «Плателщик» — to'lovchi yuridik shaxs
  /**
   * F «Поддон» — SHU TO'LOV bilan yopilgan paddon DONASI. Manfiy ham bo'ladi (qaytarilgan
   * pul). Bu paddonni MOL bo'lib qaytarish EMAS: mijoz paddon PULINI to'ladi, ya'ni paddon
   * unda qoladi-yu, hisob yopiladi. Naturadagi qaytarish «Поддон қайтариш» varag'ida.
   */
  palletQty: number | null;
  palletPrice: Prisma.Decimal | null; // N «Поддон нархи» (odatda 130 000)
  palletMoneyDeclared: Prisma.Decimal | null; // O «Поддон пули» (= F×N)
  goodsMoneyDeclared: Prisma.Decimal | null; // P «Товарга» (= K − O)
  receiver: string; // L «Получател» — pul BIZNING qaysi hisobimizga tushdi
  note: string; // M «Изох»
}

// ─────────────────── «Оплата поставшику» ───────────────────

/** Zavodga to'lov. A Дата · B В-о (kanal) · C Сумма · D Платеелшик · E Получател (zavod). */
export interface FactoryPaymentRow {
  origin: RowOrigin;
  date: Date | null;
  channel: string; // B «В-о» — «Перечисления» / «Касса»
  amount: Prisma.Decimal | null; // C
  payer: string; // D — bizning qaysi hisobimizdan ketdi
  factoryRaw: string; // E — QAYSI zavodga
}

// ─────────────────── «Поддон қайтариш» ───────────────────

/** Mijoz paddonni NATURADA qaytardi. A Дата · B Клиент · C Поддон дона · D Изох. */
export interface PalletReturnRow {
  origin: RowOrigin;
  date: Date | null;
  clientRaw: string;
  /** manfiy ham bo'ladi — egasi noto'g'ri yozilgan qaytarishni shu bilan tuzatadi */
  qty: number | null;
  note: string;
}

// ─────────────── «Поддон қайтариш заводга» ───────────────

/**
 * Biz zavodga paddon qaytardik. A Дата · B Поддон сони · C Жўнатувчи · D Қабул қилувчи ·
 * E 1 дона қайтариш ўртача нархи · F Қайтариш харажати жами · G Изох · H Тўлов тури.
 *
 * DIQQAT: `unitCost`/`totalCost` — paddonning NARXI EMAS, uni zavodga OLIB BORISH xarajati
 * (transport). Paddonning o'zi naturada qaytadi va hech qachon pulga aylanmaydi
 * (`pallet_factory_return_moneyless` CHECK buni bazada ushlab turadi).
 */
export interface FactoryPalletReturnRow {
  origin: RowOrigin;
  date: Date | null;
  qty: number | null;
  senderRaw: string; // C — biz (SEPTEM CEMENT TRADE)
  factoryRaw: string; // D — qaysi zavodga
  unitCost: Prisma.Decimal | null; // E
  totalCostDeclared: Prisma.Decimal | null; // F
  note: string; // G
  channel: string; // H — xarajat qaysi kanaldan to'langan
}

// ─────────────── «Кўрсаткичлар» (спрaвочник) ───────────────

/**
 * Mijoz справочниги qatori: rasmiy nom + 2 ta yozilish varianti + eski varaqdagi kaliti +
 * biriktirilgan agent.
 *
 * Bu importdagi eng qimmatli yangilik. Ilgari mijoz ayniyati FUZZY moslashtirish bilan
 * topilardi («Жаср Версал» ≟ «Жасур Версал») va egasi har importda o'nlab nom tasdiqlashi
 * kerak edi. Endi javob faylning O'ZIDA — taxmin qilinadigan narsa qolmadi.
 */
export interface ClientDictEntry {
  origin: RowOrigin;
  officialName: string; // A «Расмий ном»
  variants: string[]; // B, C «Варианти-1/2» (bo'shlari tashlanadi)
  legacyKey: string; // D «Эски варақ» («3-Сулаймон Ога Хазарасп»)
  agentName: string; // E «Агент»
}

/** Sozlamalar bloki — «Асосий параметрлар» (A4:B7). */
export interface MasterSettings {
  /** «Поддон базавий нархи» — to'lovda paddon narxi topilmasa ishlatiladi */
  palletBasePrice: Prisma.Decimal | null;
  /** «Солиқ (1 куб учун)» — KPI varag'i uchun, importga kirmaydi */
  taxPerM3: Prisma.Decimal | null;
  /** «КПИ улуши (агент)» — 1/3 */
  agentKpiShare: Prisma.Decimal | null;
}

export interface MasterData {
  settings: MasterSettings;
  clients: ClientDictEntry[];
  agents: string[]; // «Агентлар справочниги»
  factories: string[]; // «Поставшиклар справочниги»
  payTypes: string[]; // «Тўлов тури» («Касса», «Перечисления»)
}

// ─────────────── to'ldirilmagan qatorlar ───────────────

/**
 * Egasi BOSHLAB QO'YGAN, lekin tugatmagan qator: mashina raqami va o'lchami yozilgan, mijoz
 * ham, hajm ham yo'q (mashina kelgan, yuk hali taqsimlanmagan). Etalon faylda shundaylar
 * 6 ta va hammasi oxirgi kunga tegishli.
 *
 * ┌ NEGA ALOHIDA TUR ┐
 * Bunday qatorni buyurtma qilib bo'lmaydi (mijozi yo'q, hajmi yo'q ⇒ pul ham yo'q), lekin
 * uni JIMGINA tashlab ketish importda eng xavfli xatti-harakat: keyingi safar o'sha qatorda
 * haqiqiy yuk turgan bo'lishi mumkin va u ekrandan ko'rinmasdan yo'qolardi. Shuning uchun
 * har biri nomma-nom sanab beriladi (QATOR_TOLIQ_EMAS), lekin daftar’ga yozilmaydi.
 */
export interface IncompleteRow {
  origin: RowOrigin;
  /** qatorda nima bo'lsa — egasi o'zini tanishi uchun («90 127 DBA · 600x300x200») */
  summary: string;
  /** nimasi yetishmayapti */
  missing: string[];
}

/** Parser natijasi: yozilishi mumkin bo'lgan qatorlar + tashlab ketilganlar (sanaladi). */
export interface Parsed<T> {
  rows: T[];
  incomplete: IncompleteRow[];
}

// ─────────────── hisoblangan varaqlar (solishtirish uchun) ───────────────

/**
 * Egasining O'Z yig'indilari. Import ularni HECH QACHON ishlatmaydi — faqat o'zi
 * hisoblaganini yonma-yon qo'yadi. Sabab: raqam farq qilsa, egasi «sayt yolg'on gapiryapti»
 * demasdan oldin QAYSI varaq boshqacha aytayotganini ko'radi.
 */
export interface DeclaredTotals {
  /** «Мижозлар қолдиғи» r61 «ЖАМИ» qatori */
  clientBalances: {
    origin: RowOrigin;
    sales: Prisma.Decimal | null; // C «Товар сотуви (мижозга)»
    paid: Prisma.Decimal | null; // D «Товарга тўлов»
    goodsDebt: Prisma.Decimal | null; // E «ТОВАР ҚАРЗИ» (manfiy = mijoz qarzdor)
    palletsTaken: number | null; // F «Олган поддон»
    palletsReturned: number | null; // G «Қайтарган»
    palletsPaidQty: number | null; // H «Тўлаган дона»
    palletsPaidMoney: Prisma.Decimal | null; // I «Тўлаган сумма»
    palletDebtQty: number | null; // J «ПОДДОН ҚАРЗИ (дона)»
  } | null;
  /** «Поставшиклар ҳисоби» — zavod bo'yicha (paddon qaytarishisiz) */
  factories: Array<{
    origin: RowOrigin;
    name: string;
    cube: number | null;
    goods: Prisma.Decimal | null;
    palletQty: number | null;
    palletMoney: Prisma.Decimal | null;
    taken: Prisma.Decimal | null;
    paid: Prisma.Decimal | null;
    balance: Prisma.Decimal | null;
  }>;
}

/** Butun fayldan chiqqan hamma narsa — bitta joyda (rules ham, commit ham shundan oziqlanadi). */
export interface ParsedWorkbook {
  master: MasterData;
  shipments: ShipmentRow[];
  clientPayments: ClientPaymentRow[];
  factoryPayments: FactoryPaymentRow[];
  palletReturns: PalletReturnRow[];
  factoryPalletReturns: FactoryPalletReturnRow[];
  declared: DeclaredTotals;
  /** hamma varaqdan yig'ilgan to'ldirilmagan qatorlar — review ekranida nomma-nom chiqadi */
  incomplete: IncompleteRow[];
}
