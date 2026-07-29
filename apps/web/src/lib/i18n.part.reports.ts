// Zavod bo'yicha hisobot (pages/FactoryReport.tsx) — rus va ingliz tarjimalari.
// Kalit = koddagi o'zbek lotin matnining AYNAN o'zi (apostrof turi ham muhim).
// uz-cyrl bu yerda yo'q — u transliteratsiya orqali avtomatik olinadi.
//
// ⚠ TUZOQ: bu qism i18n.dict.ts halqasida OXIRGI bo'lib yoziladi, ya'ni kalit
// takrorlansa BU FAYL g'olib chiqadi va o'sha so'z BUTUN ILOVADA o'zgaradi.
// «Qoldiq», «Turi», «Hujjat», «o'tkazma» kabi umumiy so'zlar boshqa qismlarda
// allaqachon tarjima qilingan — ular ATAYLAB bu yerga yozilmagan. Yangi kalit
// qo'shishdan oldin u boshqa i18n.part.*.ts da yo'qligiga ishonch hosil qiling,
// aks holda Paddonlar yoki To'lovlar sahifasining ruscha matni jimgina o'zgaradi.
export const PART: Record<string, [string, string]> = {
  // ── sahifa sarlavhasi va filtr ──
  "Zavod bo'yicha hisobot": ['Отчёт по заводу', 'Factory report'],
  'Zavod hisoboti': ['Отчёт по заводу', 'Factory report'],
  "Bitta zavod, tanlangan davr: nima oldik, qancha to'ladik, qancha qarzimiz qoldi": [
    'Один завод, выбранный период: что взяли, сколько заплатили, сколько остались должны',
    'One factory, selected period: what we took, what we paid, what we still owe',
  ],
  Zavod: ['Завод', 'Factory'],
  Davr: ['Период', 'Period'],
  'Butun davr': ['Весь период', 'All time'],
  'Excel yuklab olish': ['Скачать Excel', 'Download Excel'],
  'Excel fayl yuklab olindi': ['Excel-файл скачан', 'Excel file downloaded'],
  "Zavodni tanlang — hisobot bitta zavod uchun tuziladi, har zavodning o'z narxnomasi bor": [
    'Выберите завод — отчёт строится по одному заводу, у каждого свой прайс',
    'Pick a factory — the report covers one factory, each has its own price list',
  ],
  'Yuklanmoqda…': ['Загрузка…', 'Loading…'],

  // ── yakun lentasi ──
  'Jami tannarx': ['Итого себестоимость', 'Total cost'],
  "To'langan (naqd + o'tkazma)": ['Оплачено (нал + перевод)', 'Paid (cash + transfer)'],
  "Davr buyurtmalari bo'yicha qarz": ['Долг по заказам периода', 'Debt on the period’s orders'],
  'Avansimiz (bugungi)': ['Наш аванс (на сегодня)', 'Our advance (today)'],
  Buyurtmalar: ['Заказы', 'Orders'],
  'Bekor qilingan buyurtmalar hech bir raqamga kirmaydi': [
    'Отменённые заказы не входят ни в одну цифру',
    'Cancelled orders are counted nowhere',
  ],
  'Bekor qilingan {n} ta buyurtma hech bir raqamga kirmagan — ular butunlay hisobdan tashqarida': [
    'Отменённых заказов: {n} — они не вошли ни в одну цифру',
    '{n} cancelled orders — none of their figures are counted',
  ],

  // ── xarid bloki ──
  'Zavoddan olingan mol': ['Взято с завода', 'Goods taken from the factory'],
  'Jami hajm': ['Итого объём', 'Total volume'],
  "Reja bo'yicha hajm": ['Объём по плану', 'Planned volume'],
  'Reja va haqiqiy yuk farq qilgan': [
    'План и фактическая загрузка различаются',
    'Planned and actual load differ',
  ],
  "O'rtacha 1 m³ narxi": ['Средняя цена за 1 m³', 'Average price per m³'],
  "Jami tannarx ÷ jami hajm — bu o'rtacha, narxnoma raqami emas": [
    'Итого себестоимость ÷ итого объём — это среднее, а не цена из прайса',
    'Total cost ÷ total volume — an average, not a price-list figure',
  ],
  'Olingan poddon': ['Взято поддонов', 'Pallets received'],
  'Qaytarilgan poddon': ['Возвращено поддонов', 'Pallets returned'],
  "Hajm — haqiqiy olingan yuk (zavoddan chiqqanda o'zgargan bo'lsa, o'zgargani). Poddon donada hisoblanadi, pulga aylanmaydi.":
    [
      'Объём — фактически взятый груз (если при отгрузке изменился — изменённый). Поддоны считаются в штуках, в деньги не переводятся.',
      'Volume is the actual load (the adjusted figure when it changed at loading). Pallets are counted in units, never in money.',
    ],

  // ── mahsulot / narx jadvallari ──
  "Mahsulot va narx bo'yicha": ['По товарам и ценам', 'By product and price'],
  "Qatorni oching — o'sha mahsulot qaysi narxda qancha olingani chiqadi": [
    'Разверните строку — увидите, сколько и по какой цене взято этого товара',
    'Expand a row to see how much of that product was taken at each price',
  ],
  "Narx bo'yicha yalpi taqsimot": ['Сводка по ценам', 'Overall price breakdown'],
  "Mahsulotdan qat'i nazar: qaysi narxda jami qancha kub": [
    'Независимо от товара: по какой цене сколько кубов всего',
    'Regardless of product: how many m³ at each price',
  ],
  Mahsulot: ['Товар', 'Product'],
  Hajm: ['Объём', 'Volume'],
  Summa: ['Сумма', 'Amount'],
  "O'rtacha 1 m³": ['Средняя за 1 m³', 'Average per m³'],
  Narxlar: ['Цены', 'Prices'],
  Poddon: ['Поддоны', 'Pallets'],
  Buyurtma: ['Заказ', 'Order'],
  '{n} xil': ['{n} видов', '{n} kinds'],
  'Narx (1 m³)': ['Цена (1 m³)', 'Price (per m³)'],
  "Narxnoma bo'yicha": ['По прайсу', 'Per price list'],
  'narxi kiritilmagan': ['цена не задана', 'price not entered'],
  "Mahsulotga zavod narxi kiritilmagan — tannarxga 0 bo'lib tushgan": [
    'Заводская цена товара не задана — в себестоимость попало 0',
    'No factory price for this product — it entered cost as 0',
  ],
  'Bu buyurtma boshqa kanal narxida yopilgan': [
    'Этот заказ закрыт по цене другого канала',
    'This order was settled at the other channel’s price',
  ],
  "Bu davrda bu zavoddan mol olinmagan": [
    'В этом периоде с этого завода товар не брали',
    'No goods were taken from this factory in this period',
  ],

  // ── to'lov usuli ──
  "Zavodga to'langan pul — to'lov usuli bo'yicha": [
    'Оплачено заводу — по способу оплаты',
    'Paid to the factory — by payment method',
  ],
  'Naqd (kassadan)': ['Наличные (из кассы)', 'Cash (from the cash desk)'],
  "O'tkazma (bankdan)": ['Перевод (из банка)', 'Transfer (from the bank)'],
  "Jami to'langan": ['Итого оплачено', 'Total paid'],
  'Zavod qaytargani': ['Завод вернул', 'Returned by the factory'],
  "Sof o'tkazilgan": ['Чистая оплата', 'Net paid'],
  "Pul emas — bonus hamyonidan qarzga o'tkazilgani": [
    'Не деньги — перенос из бонусного кошелька в счёт долга',
    'Not money — moved from the bonus wallet against the debt',
  ],
  "Bu blok pulning FIZIK yo'lini o'lchaydi: kassadan naqd chiqdimi yoki bankdan o'tkazildimi. Bonusdan yopilgani «jami to'langan» ga kirmaydi — u qarzni kamaytiradi, lekin kassadan bir so'm ham chiqarmaydi.":
    [
      'Этот блок про ФИЗИЧЕСКИЙ путь денег: вышли наличные из кассы или ушёл перевод из банка. Закрытое бонусом не входит в «итого оплачено» — оно уменьшает долг, но из кассы не выходит ни сума.',
      'This block is about the PHYSICAL route of the money: cash out of the till or a bank transfer. Bonus settlements are excluded from «total paid» — they cut the debt without a single so‘m leaving the till.',
    ],
  "To'lov usullari kesimi": ['Разрез по способам оплаты', 'Breakdown by payment method'],
  Usuli: ['Способ', 'Method'],
  Kanal: ['Канал', 'Channel'],
  "Zavodga to'lov": ['Оплата заводу', 'Payment to factory'],
  'Zavod qaytardi': ['Возврат от завода', 'Refund from factory'],
  naqd: ['наличные', 'cash'],
  bonusdan: ['из бонуса', 'from bonus'],

  // ── narxnoma kanali ──
  'Qaysi narxnomada yopildi (narx kanali)': [
    'По какому прайсу закрыто (ценовой канал)',
    'Which price list settled it (price channel)',
  ],
  'Naqd narxnomada': ['По наличному прайсу', 'At the cash price list'],
  "O'tkazma narxnomada": ['По безналичному прайсу', 'At the transfer price list'],
  "Kanali ko'rsatilmagan": ['Канал не указан', 'Channel not recorded'],
  "Eski yozuvlar — o'tkazmaga qo'shilmaydi": [
    'Старые записи — к переводу не добавляются',
    'Legacy rows — not folded into the transfer figure',
  ],
  'Jami taqsimlangan': ['Итого распределено', 'Total allocated'],
  'Avansdan yechilgan': ['Списано с аванса', 'Drawn from the advance'],
  "Zavodda turgan pul buyurtmaga o'tkazilgani — yangi pul emas": [
    'Деньги, стоявшие на заводе, перенесены на заказ — это не новые деньги',
    'Money already standing at the factory moved onto an order — not new money',
  ],
  'Avansga tushgan': ['Поступило в аванс', 'Paid into the advance'],
  "Davrda avans cho'ntagiga tushgan sof pul": [
    'Чистые деньги, поступившие в аванс за период',
    'Net money that entered the advance during the period',
  ],
  "Bu YUQORIDAGIDAN BOSHQA savol: mol qaysi narx kitobida hisob-kitob qilingani. Bank o'tkazmasi naqd narxnomali buyurtmani yopishi mumkin, shuning uchun ikkala blokning yig'indisi teng chiqmasligi normal — farqni hali taqsimlanmagan avans tashkil qiladi.":
    [
      'Это ДРУГОЙ вопрос, чем выше: по какому прайсу закрыт товар. Банковский перевод может закрыть заказ с наличным прайсом, поэтому расхождение итогов двух блоков — норма: разницу составляет нераспределённый аванс.',
      'A DIFFERENT question from the block above: which price book settled the goods. A bank transfer may settle a cash-priced order, so the two blocks not matching is normal — the gap is the still-unallocated advance.',
    ],

  // ── qarz / avans ──
  'Qarz va avans — davr oxiriga': ['Долг и аванс — на конец периода', 'Debt and advance — at period end'],
  'Qarz va avans — bugungi holat': ['Долг и аванс — на сегодня', 'Debt and advance — today'],
  'Avans — naqd': ['Аванс — наличные', 'Advance — cash'],
  'Avans jami': ['Аванс всего', 'Advance total'],
  'Sof holat': ['Чистое сальдо', 'Net position'],
  'Musbat — pulimiz zavodda; manfiy — biz qarzdormiz': [
    'Плюс — наши деньги на заводе; минус — мы должны',
    'Positive — our money sits at the factory; negative — we owe',
  ],
  "Shundan qo'lda tuzatish": ['Из них ручная корректировка', 'Of which manual correction'],
  'Off-book tuzatish. Boshqaruv paneli va Qarzlar sahifasi uni hisobga olmaydi': [
    'Внебалансовая корректировка. Дашборд и страница Долгов её не учитывают',
    'Off-book correction. The dashboard and the Debts page exclude it',
  ],
  "Bugungi bilim bo'yicha o'sha sanadagi holat: keyin qilingan bekor qilish daftarga original sana bilan tushadi, ya'ni bu ustun keyinchalik o'zgarishi mumkin.":
    [
      'Состояние на ту дату по сегодняшним данным: более поздняя отмена записывается в книгу исходной датой, поэтому эта колонка может измениться позже.',
      'That date’s position as known today: a later cancellation is booked under the original date, so this column can change afterwards.',
    ],
  'Zavod kartochkasidagi raqam bilan aynan bir xil.': [
    'Точно та же цифра, что в карточке завода.',
    'Byte-identical to the figure on the factory card.',
  ],
  'Davr buyurtmalarining ochiq qarzi': [
    'Открытый долг по заказам периода',
    'Open debt on the period’s orders',
  ],
  'Jami ochiq': ['Итого открыто', 'Total open'],
  'Ochiq buyurtmalar': ['Открытых заказов', 'Open orders'],
  "Naqd to'lash niyatida": ['С намерением платить наличными', 'Intended to be paid in cash'],
  "O'tkazma niyatida": ['С намерением платить переводом', 'Intended to be paid by transfer'],
  'Niyati aniqlanmagan': ['Намерение не определено', 'Intent undecided'],
  "Faqat shu davrda olingan mol bo'yicha. Yuqoridagi umumiy qarzdan farq qiladi: unda eski davrlarning qoldig'i ham bor.":
    [
      'Только по товару этого периода. Отличается от общего долга выше: там есть и остаток прошлых периодов.',
      'Only for goods taken in this period. It differs from the overall debt above, which also carries earlier periods’ balance.',
    ],

  // ── bonus / poddon ──
  'Bonus va poddon': ['Бонус и поддоны', 'Bonus and pallets'],
  'Davrda hisoblangan bonus': ['Начислено бонуса за период', 'Bonus accrued in the period'],
  "Davrda qarzga o'tkazilgan": ['Перенесено в счёт долга за период', 'Moved against debt in the period'],
  'Bonus hamyoni (bugungi)': ['Бонусный кошелёк (на сегодня)', 'Bonus wallet (today)'],
  'Zavodga poddon qarzimiz': ['Наш долг по поддонам заводу', 'Pallets we owe the factory'],
  "Bonus hamyoni va poddon qoldig'i — BUGUNGI holat (davrga bog'liq emas). Poddon donada hisoblanadi.": [
    'Бонусный кошелёк и остаток поддонов — состояние на СЕГОДНЯ (не зависит от периода). Поддоны считаются в штуках.',
    'The bonus wallet and pallet balance are TODAY’s position (period-independent). Pallets are counted in units.',
  ],

  'Jami olingan {a} · qaytarilgan {b}': [
    'Всего взято {a} · возвращено {b}',
    'Received {a} · returned {b} in total',
  ],

  // ── nazorat ──
  Nazorat: ['Контроль', 'Cross-checks'],
  'Buyurtma jamlari: {x}': ['Итоги заказов: {x}', 'Order totals: {x}'],
  "Narxnoma bo'yicha bo'lishi kerak edi: {x}": [
    'По прайсу должно было быть: {x}',
    'Per the price list it should have been: {x}',
  ],
  'Buyurtma jamlari bilan farq': ['Расхождение с итогами заказов', 'Drift against order totals'],
  'Narxi kiritilmagan hajm': ['Объём без заданной цены', 'Volume with no price entered'],
  "Bu hajm tannarxga 0 so'm bo'lib tushgan — mahsulotga zavod narxi kiritilmagan": [
    'Этот объём попал в себестоимость как 0 сум — заводская цена товара не задана',
    'This volume entered cost as 0 so‘m — the product has no factory price',
  ],
  'Aralash narxda yopilgan pozitsiyalar': [
    'Позиций, закрытых по смешанной цене',
    'Positions settled at a blended price',
  ],
  "Bu qatorlar faqat farq bo'lganda chiqadi. Hisobot ikkitadan bittasini jimgina tanlamaydi — ikkalasini ham ko'rsatadi.":
    [
      'Эти строки появляются только при расхождении. Отчёт не выбирает молча одну из двух цифр — он показывает обе.',
      'These rows appear only when something drifts. The report never silently picks one of two figures — it shows both.',
    ],

  // ── buyurtmalar jadvali ──
  'Davrdagi buyurtmalar': ['Заказы периода', 'Orders in the period'],
  Sana: ['Дата', 'Date'],
  Mijoz: ['Клиент', 'Client'],
  Tannarx: ['Себестоимость', 'Cost'],
  "To'langan": ['Оплачено', 'Paid'],
  "To'lash niyati": ['Намерение оплаты', 'Pay intent'],
  'Tannarx holati': ['Статус себестоимости', 'Cost status'],
  Holat: ['Статус', 'Status'],
  "Bu davrda buyurtma yo'q": ['В этом периоде заказов нет', 'No orders in this period'],
  '{n} ta · {cube} · {sum}': ['{n} шт · {cube} · {sum}', '{n} · {cube} · {sum}'],
};
