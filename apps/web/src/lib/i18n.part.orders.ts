// Auto: orders pages ru/en translations.
export const PART: Record<string, [string, string]> = {
  // ── Page chrome: headers, filters, search ──
  Buyurtmalar: ['Заказы', 'Orders'],
  Buyurtma: ['Заказ', 'Order'],
  Mijoz: ['Клиент', 'Client'],
  Zavod: ['Завод', 'Factory'],
  Sana: ['Дата', 'Date'],
  Agent: ['Агент', 'Agent'],
  Moshina: ['Машина', 'Vehicle'],
  Transport: ['Транспорт', 'Transport'],
  Holat: ['Статус', 'Status'],
  Tannarx: ['Себестоимость', 'Cost'],
  Hajm: ['Объём', 'Volume'],
  Summa: ['Сумма', 'Amount'],
  'Savdo summasi': ['Сумма продажи', 'Sale amount'],
  'Yangi buyurtma': ['Новый заказ', 'New order'],
  'Buyurtma № yoki mijoz': ['Заказ № или клиент', 'Order № or client'],
  "Barcha buyurtmalar ro'yxati — filtr va qidiruv": [
    'Список всех заказов — фильтр и поиск',
    'All orders list — filter and search',
  ],
  "Buyurtmalar ro'yxati": ['Список заказов', 'Orders list'],
  'Buyurtma topilmadi': ['Заказы не найдены', 'No orders found'],

  // ── To'lov bo'yicha 3 tab (status doskasi 2026-07-22 da olib tashlandi) ──
  'Barcha buyurtmalar': ['Все заказы', 'All orders'],
  "Qisman to'langan": ['Частично оплачено', 'Partially paid'],
  "Buyurtmalar — to'lov holati": ['Заказы — статус оплаты', 'Orders — payment status'],

  Paddonlar: ['Поддоны', 'Pallets'],
  Paddon: ['Поддоны', 'Pallets'],
  Pallet: ['Поддоны', 'Pallets'],
  paddon: ['поддон', 'pallets'],
  pallet: ['поддон', 'pallets'],
  ta: ['шт', 'pcs'],
  "so'm": ['сум', 'sum'],
  'Qayta urinish': ['Повторить', 'Retry'],

  // ── Order actions (header). Bosqichma-bosqich status o'tishlari 2026-07-22 da olib
  //    tashlandi (buyurtma yaratilganda yakunlanadi) — o'sha verblar ham o'chirildi.
  Tasdiqlash: ['Подтвердить', 'Confirm'],
  'Haqiqiy yuk': ['Фактическая загрузка', 'Actual load'],
  Tahrirlash: ['Редактировать', 'Edit'],
  'Bekor qilish': ['Отмена', 'Cancel'],

  // ── Order status labels (format.ORDER_STATUS, Steps) ──
  Yangi: ['Новый', 'New'],
  Tasdiqlangan: ['Подтверждён', 'Confirmed'],
  Yuklanmoqda: ['Загружается', 'Loading'],
  Yetkazilmoqda: ['Доставляется', 'Delivering'],
  Yetkazildi: ['Доставлен', 'Delivered'],
  Yakunlandi: ['Завершён', 'Completed'],
  'Bekor qilindi': ['Отменён', 'Cancelled'],

  // ── Transport modes ──
  "Mijozning o'z transporti": ['Транспорт клиента', "Client's own transport"],
  'Diler hisobidan': ['За счёт дилера', "At the dealer's expense"],
  'Mijozdan undiriladi': ['Взимается с клиента', 'Charged to the client'],
  'Dilerning hisobidan': ['За счёт дилера', "At the dealer's expense"],
  'Mijozdan olinadi': ['Взимается с клиента', 'Charged to the client'],
  // transport sits INSIDE the goods total — the mode names who hands the driver his cut
  "Shofyorga diller to'laydi": ['Водителю платит дилер', 'Dealer pays the driver'],
  "Shofyorga mijoz to'laydi": ['Водителю платит клиент', 'Client pays the driver'],
  "Shofyorga diller to'laydi (summa ichidan)": [
    'Водителю платит дилер (из суммы)',
    'Dealer pays the driver (out of the total)',
  ],
  "Shofyorga mijoz to'laydi (summa ichidan)": [
    'Водителю платит клиент (из суммы)',
    'Client pays the driver (out of the total)',
  ],
  'Summa ustiga qo‘shilgan (eski)': ['Добавлено сверх суммы (старое)', 'Added on top (legacy)'],
  'Summa ustiga qo‘shilgan (eski usul)': [
    'Добавлено сверх суммы (старый способ)',
    'Added on top (legacy method)',
  ],
  'Mijoz o‘z moshinasida olib ketadi — transport xarajati yo‘q.': [
    'Клиент забирает своей машиной — транспортных расходов нет.',
    'The client collects with their own truck — no transport cost.',
  ],
  'Mijoz butun summani dillerga beradi, diller shofyorga o‘zi to‘laydi.': [
    'Клиент отдаёт всю сумму дилеру, дилер сам платит водителю.',
    'The client pays the dealer in full; the dealer pays the driver.',
  ],
  'Mijoz shofyorga transport pulini beradi, qolganini dillerga beradi.': [
    'Клиент отдаёт водителю плату за транспорт, остальное — дилеру.',
    "The client hands the driver the transport money and the rest to the dealer.",
  ],
  "Transport puli (shofyorga, so'm)": ['Плата за транспорт (водителю, сум)', 'Transport money (to driver, sum)'],
  'Mahsulot summasi': ['Сумма товара', 'Goods total'],
  'Shofyorga (mijoz beradi)': ['Водителю (платит клиент)', 'To the driver (client pays)'],
  'Shofyorga (diller beradi)': ['Водителю (платит дилер)', 'To the driver (dealer pays)'],
  'Dillerga tushadi': ['Поступит дилеру', 'Reaches the dealer'],
  'Dillerda qoladi': ['Останется у дилера', 'Stays with the dealer'],
  'Mijoz dillerga beradi': ['Клиент отдаёт дилеру', 'Client hands the dealer'],
  'Mijoz dillerga beradi (to‘liq)': ['Клиент отдаёт дилеру (полностью)', 'Client hands the dealer (in full)'],
  '— shundan shofyorga': ['— из них водителю', '— of which to the driver'],
  '— shundan dillerga': ['— из них дилеру', '— of which to the dealer'],
  'Transport puli mahsulot summasidan katta — dillerga hech narsa qolmaydi': [
    'Плата за транспорт больше суммы товара — дилеру ничего не останется',
    'Transport money exceeds the goods total — nothing is left for the dealer',
  ],
  'Mijozdan undirilgan (eski usul)': ['Взыскано с клиента (старый способ)', 'Charged to the client (legacy)'],

  // ── «Shofyorga mijoz to'laydi» — savdo summasi ichidagi bo'linish ──
  'Mijoz bizga qarz': ['Клиент должен нам', 'Client owes us'],
  'shundan transport (mijoz shofyorga)': [
    'из них транспорт (клиент — водителю)',
    'of which transport (client → driver)',
  ],
  'Diller shofyorga qarzdor emas': ['Дилер не должен водителю', 'The dealer owes the driver nothing'],
  'summa mijoz qarzidan chiqarilgan': ['сумма вычтена из долга клиента', 'amount carved out of the client debt'],
  "Shofyorga to'landi deb yozish": ['Отметить оплату водителю', 'Record payment to the driver'],

  // ── Pallet transaction labels ──
  'Zavoddan qabul qilindi': ['Принято с завода', 'Received from factory'],
  'Mijozga yuborildi': ['Отправлено клиенту', 'Delivered to client'],
  'Mijozdan qaytdi': ['Возвращено клиентом', 'Returned by client'],
  'Zavodga qaytarildi': ['Возвращено заводу', 'Returned to factory'],
  "Yo'qotilgan (hisobga o'tkazildi)": ['Утеряно (переведено в счёт)', 'Lost (charged to account)'],
  Tuzatish: ['Корректировка', 'Adjustment'],
  Storno: ['Сторно', 'Reversal'],

  // ── Price state chips ──
  Narxlanmagan: ['Без цены', 'Unpriced'],
  Narxlangan: ['С ценой', 'Priced'],

  // ── Payment kinds (format.PAYMENT_KIND) ──
  "Mijozdan to'lov": ['Оплата от клиента', 'Payment from client'],
  'Mijozga qaytarish': ['Возврат клиенту', 'Refund to client'],
  "Zavodga to'lov": ['Оплата заводу', 'Payment to factory'],
  'Zavoddan qaytim': ['Возврат от завода', 'Refund from factory'],
  "Shofyorga to'lov": ['Оплата водителю', 'Payment to driver'],
  "Mijoz shofyorga to'ladi": ['Клиент оплатил водителю', 'Client paid the driver'],

  // ── Payment methods (format.PAYMENT_METHOD) ──
  Naqd: ['Наличные', 'Cash'],
  "O'tkazma": ['Перечисление', 'Transfer'],
  Click: ['Click', 'Click'],
  Terminal: ['Терминал', 'Terminal'],
  Karta: ['Карта', 'Card'],
  'Valyuta (USD)': ['Валюта (USD)', 'Currency (USD)'],
  'Bonus hisobidan': ['Из бонусов', 'From bonus'],

  // ── OrderDetail: toasts / confirms / warnings ──
  'Buyurtma tahrirlandi': ['Заказ изменён', 'Order updated'],
  'Buyurtma holati yangilandi': ['Статус заказа обновлён', 'Order status updated'],
  'Buyurtma bekor qilindi': ['Заказ отменён', 'Order cancelled'],
  'Pozitsiya narxlandi': ['Позиция оценена', 'Line priced'],
  'Haqiqiy yuk kiritildi — balanslar yangilandi': [
    'Фактическая загрузка внесена — балансы обновлены',
    'Actual load recorded — balances updated',
  ],
  'Buyurtmani yuklashda xatolik': ['Ошибка загрузки заказа', 'Error loading the order'],
  'Kamida bitta pozitsiya uchun haqiqiy hajm kiriting': [
    'Введите фактический объём хотя бы для одной позиции',
    'Enter the actual volume for at least one line',
  ],
  'Buyurtmani bekor qilish': ['Отменить заказ', 'Cancel order'],
  // ── Bekor qilish oynasi (CancelOrderModal, 2026-07-22 kechqurun egasi qoidasi) ──
  "Mijozning to'lagan puli balansida qoladimi?": [
    'Останутся ли уплаченные клиентом деньги на его балансе?',
    'Does the money the client paid stay on their balance?',
  ],
  'Ha — mijozga qaytariladi': ['Да — вернуть клиенту', 'Yes — return it to the client'],
  "Yo'q — hamma o'tkazmalar yo'qolsin": [
    'Нет — все проводки должны исчезнуть',
    'No — wipe every transaction',
  ],
  "Mijoz bizga to'lagan": ['Клиент заплатил нам', 'Client paid us'],
  "Mijoz shofyorga to'lagan": ['Клиент заплатил водителю', 'Client paid the driver'],
  "Biz zavodga to'laganimiz": ['Мы заплатили заводу', 'We paid the factory'],
  'Mijozga naqd qaytariladi': ['Вернётся клиенту наличными', 'Returned to the client in cash'],
  'Mijoz balansida kredit qoladi': ['Останется кредитом на балансе', 'Stays as balance credit'],
  'Mijoz balansida qoladi': ['Останется на балансе клиента', "Stays on the client's balance"],
  "Buyurtma savdosi bekor qilinadi — mijozning bu buyurtma bo'yicha {sum} qarzi yo'qoladi": [
    'Продажа заказа отменяется — долг клиента по этому заказу {sum} исчезает',
    "The order's sale is reversed — the client's {sum} debt on it disappears",
  ],
  "Zavodga to'langan {sum} kassaga qaytariladi — zavod qarzimiz ham, avansimiz ham tozalanadi": [
    'Оплаченные заводу {sum} возвращаются в кассу — и наш долг, и наш аванс очищаются',
    'The {sum} paid to the factory returns to the till — both our payable and our advance are cleared',
  ],
  "Zavodga bu buyurtma bo'yicha to'lov qilinmagan — zavod qarzimiz bekor bo'ladi": [
    'По этому заказу заводу не платили — наш долг заводу просто отменяется',
    'Nothing was paid to the factory on this order — our payable is simply reversed',
  ],
  "Mijozning bizga to'lagan {sum} puli unga NAQD qaytariladi — kassadan chiqim yoziladi": [
    'Уплаченные нам {sum} возвращаются клиенту НАЛИЧНЫМИ — записывается расход из кассы',
    'The {sum} the client paid us is returned to them in CASH — a till outflow is recorded',
  ],
  "Mijozning {sum} to'lovi butunlay bekor qilinadi — kassadan ham, mijoz hisobidan ham yo'qoladi": [
    'Платёж клиента {sum} отменяется полностью — исчезает и из кассы, и со счёта клиента',
    "The client's {sum} payment is voided entirely — it leaves both the till and their account",
  ],
  "Mijoz shofyorga bergan {sum} balansida KREDIT bo'lib qoladi — transportni diller o'z zimmasiga oladi": [
    'Отданные водителю {sum} останутся КРЕДИТОМ на его балансе — транспорт берёт на себя дилер',
    "The {sum} handed to the driver stays as CREDIT on their balance — the dealer absorbs the transport",
  ],
  "Mijoz shofyorga bergan {sum} hujjati ham bekor qilinadi — balansida hech narsa qolmaydi": [
    'Документ об оплате водителю {sum} тоже отменяется — на балансе ничего не остаётся',
    'The {sum} driver-payment record is voided too — nothing is left on their balance',
  ],
  "Shu buyurtmadan kassada turgan {sum} sof foyda yo'qoladi": [
    'Чистая прибыль {sum} по этому заказу, лежащая в кассе, исчезает',
    'The {sum} net profit this order left in the till disappears',
  ],
  "Shu buyurtmaning {sum} zarari ham bekor bo'ladi": [
    'Убыток {sum} по этому заказу тоже отменяется',
    "This order's {sum} loss is reversed as well",
  ],
  'Poddon harakati va bonus hisobi ham bekor qilinadi': [
    'Движение поддонов и начисление бонуса тоже отменяются',
    'Pallet movements and the bonus accrual are reversed too',
  ],
  'Kassa buyurtmadan OLDINGI holatiga qaytadi — bu buyurtmaning puli kassada qolmaydi': [
    'Касса возвращается к состоянию ДО заказа — деньги по этому заказу в кассе не остаются',
    'The till returns to its pre-order state — no money from this order stays in it',
  ],
  'Yakunda mijoz balansida {sum} kredit qoladi (shofyorga bergan puli)': [
    'В итоге на балансе клиента останется кредит {sum} (то, что он отдал водителю)',
    "In the end the client keeps a {sum} credit (what they handed the driver)",
  ],
  "Yakunda mijoz balansi 0 — to'lagan hamma puli qaytarildi": [
    'В итоге баланс клиента 0 — все уплаченные деньги возвращены',
    'In the end the client balance is 0 — every so‘m they paid has been returned',
  ],
  "Yakunda mijoz balansi 0 — buyurtma umuman berilmagandek, to'lov umuman qilinmagandek": [
    'В итоге баланс клиента 0 — как будто заказа не было и оплаты не было',
    'In the end the client balance is 0 — as if the order was never placed and never paid',
  ],
  "Mijoz bu buyurtma bo'yicha to'lov qilmagan — tanlovning ahamiyati yo'q": [
    'По этому заказу клиент не платил — выбор ни на что не влияет',
    'The client made no payment on this order — the choice changes nothing',
  ],
  'Bekor qilingan buyurtma': ['Отменённый заказ', 'Cancelled order'],
  "{orders} bekor qilingan, bu buyurtma uchun to'langan pullar qaytarildi": [
    '{orders} отменён — деньги, уплаченные по этому заказу, возвращены',
    '{orders} was cancelled — the money paid for it has been returned',
  ],
  'Bekor qilish sababi': ['Причина отмены', 'Cancellation reason'],
  'Nima uchun bekor qilinmoqda (majburiy)': [
    'Почему отменяется (обязательно)',
    'Why it is being cancelled (required)',
  ],
  'Bekor qilish sababi (majburiy)': ['Причина отмены (обязательно)', 'Cancellation reason (required)'],
  Yopish: ['Закрыть', 'Close'],
  'Sabab kiritilishi shart': ['Причина обязательна', 'A reason is required'],
  'Musbat qiymat kiriting': ['Введите положительное значение', 'Enter a positive value'],
  Saqlash: ['Сохранить', 'Save'],

  // ── OrderDetail: item / allocation / pallet / comment columns ──
  Mahsulot: ['Товар', 'Product'],
  "O'lcham": ['Размер', 'Size'],
  'Rejadagi hajm: {v}': ['Плановый объём: {v}', 'Planned volume: {v}'],
  haqiqiy: ['факт', 'actual'],
  '1 m³ narxi': ['Цена за 1 m³', 'Price per 1 m³'],
  'Narx holati': ['Статус цены', 'Price status'],
  Narxlash: ['Оценить', 'Set price'],
  'Narxni tuzatish': ['Исправить цену', 'Adjust price'],
  Turi: ['Тип', 'Type'],
  Usul: ['Способ', 'Method'],
  "To'lov": ['Оплата', 'Payment'],
  Soni: ['Кол-во', 'Count'],
  Izoh: ['Примечание', 'Note'],
  "Noma'lum": ['Неизвестно', 'Unknown'],

  // ── OrderDetail: tabs ──
  "To'lovlar": ['Платежи', 'Payments'],
  'Mijozdan qabul qilingan:': ['Получено от клиента:', 'Received from client:'],
  "Allokatsiyalar yo'q": ['Нет распределений', 'No allocations'],
  "Paddon harakatlari yo'q": ['Нет движений поддонов', 'No pallet movements'],
  Tarix: ['История', 'History'],
  'Tarixni yuklashda xatolik': ['Ошибка загрузки истории', 'Error loading history'],
  "Hodisalar yo'q": ['Нет событий', 'No events'],
  Izohlar: ['Примечания', 'Comments'],
  'Izohlarni yuklashda xatolik': ['Ошибка загрузки примечаний', 'Error loading comments'],
  "Izohlar yo'q": ['Нет примечаний', 'No comments'],
  'Izoh yozing...': ['Напишите примечание...', 'Write a comment...'],
  Yuborish: ['Отправить', 'Send'],

  // ── OrderDetail: sections, descriptions, finance rail ──
  "Ma'lumotlar": ['Данные', 'Details'],
  Pozitsiyalar: ['Позиции', 'Lines'],
  'Buyurtma bekor qilingan': ['Заказ отменён', 'Order cancelled'],
  Haydovchi: ['Водитель', 'Driver'],
  "To'lov muddati": ['Срок оплаты', 'Payment due date'],
  'Tannarx holati': ['Статус себестоимости', 'Cost status'],
  Yaratilgan: ['Создан', 'Created'],
  Moliya: ['Финансы', 'Finance'],
  "Zavod tannarxi (to'langan)": ['Себестоимость завода (оплачено)', 'Factory cost (paid)'],
  'Tovar foydasi': ['Прибыль от товара', 'Goods profit'],
  'Zavod tannarxi — naqd': ['Себестоимость завода — наличные', 'Factory cost — cash'],
  'Zavod tannarxi — bank': ['Себестоимость завода — банк', 'Factory cost — bank'],
  'Tovar foydasi (naqd)': ['Прибыль от товара (наличные)', 'Goods profit (cash)'],
  'Tovar foydasi (bank)': ['Прибыль от товара (банк)', 'Goods profit (bank)'],
  Rejim: ['Режим', 'Mode'],
  'Transport xarajati': ['Транспортные расходы', 'Transport cost'],
  'Mijozdan undiriladigan': ['Взимается с клиента', 'Charged to client'],
  'Transport foydasi': ['Прибыль от транспорта', 'Transport profit'],
  "To'lov holati": ['Статус оплаты', 'Payment status'],

  // ── OrderDetail: price / edit / actual-load drawers ──
  "Joriy summa: {sum} so'm. Yangi summa bilan farqi mijoz balansiga tuzatma sifatida yoziladi (zavod tannarxi va bonusga tegilmaydi).": [
    'Текущая сумма: {sum} сум. Разница с новой суммой запишется как корректировка на баланс клиента (себестоимость завода и бонус не затрагиваются).',
    "Current amount: {sum} sum. The difference from the new amount is recorded as an adjustment on the client's balance (factory cost and bonus are untouched).",
  ],
  'Hajm:': ['Объём:', 'Volume:'],
  "1 m³ narxi bo'yicha": ['По цене за 1 m³', 'By price per 1 m³'],
  'Umumiy summa (kelishilgan)': ['Общая сумма (договорная)', 'Lump sum (agreed)'],
  "1 m³ uchun narx (so'm)": ['Цена за 1 m³ (сум)', 'Price per 1 m³ (sum)'],
  "Umumiy summa (so'm)": ['Общая сумма (сум)', 'Lump sum (sum)'],
  "Faqat moshina, haydovchi va izoh o'zgartiriladi. Moliyaviy ma'lumot (narx, hajm, summa, tannarx) o'zgarmaydi — logika buzilmaydi.": [
    'Изменяются только машина, водитель и примечание. Финансовые данные (цена, объём, сумма, себестоимость) не меняются — логика не нарушается.',
    'Only the vehicle, driver and note change. Financial data (price, volume, amount, cost) stays the same — the logic is not broken.',
  ],
  'Moshina tanlang': ['Выберите машину', 'Select a vehicle'],
  'Haydovchi ismi': ['Имя водителя', "Driver's name"],
  'Izoh (ixtiyoriy)': ['Примечание (необязательно)', 'Note (optional)'],
  'Zavoddan chiqqan haqiqiy hajm (m³)': [
    'Фактический объём, вышедший с завода (m³)',
    'Actual volume dispatched from the factory (m³)',
  ],
  "Barcha balanslar (mijoz sotuvi va zavod tannarxi) shu hajmga moslashadi. Kelishilgan qat'iy summalar va transport (moshinaga) o'zgarmaydi. Narx bu yerda kiritilmaydi.": [
    'Все балансы (продажа клиенту и себестоимость завода) подстроятся под этот объём. Договорные фиксированные суммы и транспорт (машине) не меняются. Цена здесь не вводится.',
    'All balances (client sale and factory cost) adjust to this volume. Agreed lump sums and transport (to the vehicle) stay the same. Price is not entered here.',
  ],
  'Rejadagi:': ['Плановый:', 'Planned:'],
  narxsiz: ['без цены', 'unpriced'],

  // ── NewOrder: pricing options ──
  'Katalog narxi': ['Каталожная цена', 'Catalog price'],
  'Kelishilgan narx': ['Договорная цена', 'Negotiated price'],
  'Umumiy summa': ['Общая сумма', 'Lump sum'],
  Narxsiz: ['Без цены', 'Unpriced'],

  // ── NewOrder: errors, toasts, breadcrumb ──
  'Yuklashda xatolik': ['Ошибка загрузки', 'Loading error'],
  'Buyurtma {orderNo} yaratildi': ['Заказ {orderNo} создан', 'Order {orderNo} created'],
  '{n}-qator: pallet soni yoki hajm (m³) kiritilishi shart': [
    'Строка {n}: укажите количество поддонов или объём (m³)',
    'Row {n}: pallet count or volume (m³) is required',
  ],
  "Ma'lumotlarni yuklashda xatolik": ['Ошибка загрузки данных', 'Error loading data'],
  'Buyurtma yaratilmadi': ['Заказ не создан', 'Order not created'],

  // ── NewOrder: form fields ──
  'Mijozni tanlang': ['Выберите клиента', 'Select a client'],
  'Mijozni qidiring…': ['Поиск клиента…', 'Search for a client…'],
  balans: ['баланс', 'balance'],
  'Sanani tanlang': ['Выберите дату', 'Select a date'],
  // ── NewOrder: zavodga to'lov usuli (egasining uchta tugmasi) ──
  "Zavodga to'lov usuli": ['Способ оплаты заводу', 'How the factory is paid'],
  "Zavodga naqd orqali to'lanadi": ['Заводу оплачивается наличными', 'The factory is paid in cash'],
  "Zavodga o'tkazma orqali to'lanadi": [
    'Заводу оплачивается переводом',
    'The factory is paid by bank transfer',
  ],
  "To'lov usuli aniq emas": ['Способ оплаты неизвестен', 'Payment method not decided'],
  'Tannarx zavodning naqd narxi bo‘yicha hisoblanadi.': [
    'Себестоимость считается по цене завода за наличные.',
    "The cost is calculated at the factory's cash price.",
  ],
  'Tannarx zavodning o‘tkazma (bank) narxi bo‘yicha hisoblanadi.': [
    'Себестоимость считается по цене завода за перевод (банк).',
    "The cost is calculated at the factory's bank-transfer price.",
  ],
  'Ikkala narx ham ko‘rsatiladi — haqiqiy to‘lov aniqlaydi, aralash ham bo‘lishi mumkin.': [
    'Показываются обе цены — определит фактическая оплата, возможна и смешанная.',
    'Both prices are shown — the actual payment decides, and it may even be a mix.',
  ],
  Mahsulotlar: ['Товары', 'Products'],
  "Kamida bitta mahsulot qo'shing": ['Добавьте хотя бы один товар', 'Add at least one product'],
  'Mahsulotni tanlang': ['Выберите товар', 'Select a product'],
  'Hajm (m³)': ['Объём (m³)', 'Volume (m³)'],
  Taxminiy: ['Ориентировочно', 'Estimated'],
  "O'chirish": ['Удалить', 'Delete'],
  'Narx kiriting': ['Введите цену', 'Enter a price'],
  "Narx (1 m³, so'm)": ['Цена (1 m³, сум)', 'Price (1 m³, sum)'],
  'Summani kiriting': ['Введите сумму', 'Enter an amount'],
  'Katalog: {price} / m³': ['Каталог: {price} / m³', 'Catalog: {price} / m³'],
  'Katalog narxi topilmadi — server aniqlaydi': [
    'Каталожная цена не найдена — определит сервер',
    'Catalog price not found — the server will determine it',
  ],
  'Narx keyinroq belgilanadi': ['Цена будет назначена позже', 'Price will be set later'],
  "Mahsulot qo'shish": ['Добавить товар', 'Add product'],
  "Bitta buyurtmadagi barcha mahsulotlar bitta zavodga tegishli bo'lishi kerak": [
    'Все товары в одном заказе должны принадлежать одному заводу',
    'All products in one order must belong to the same factory',
  ],
  "Bir martalik moshina (ro'yxatga saqlanmaydi, faqat shu buyurtma uchun)": [
    'Разовая машина (не сохраняется в списке, только для этого заказа)',
    'One-time vehicle (not saved to the list, only for this order)',
  ],
  'Moshina nomi/turi': ['Название/тип машины', 'Vehicle name/type'],
  'Moshina nomini kiriting': ['Введите название машины', 'Enter the vehicle name'],
  'masalan: Isuzu / yuk moshinasi': ['например: Isuzu / грузовик', 'e.g. Isuzu / truck'],
  'Davlat raqami': ['Гос. номер', 'License plate'],
  Telefon: ['Телефон', 'Phone'],
  "Moshina sig'imi oshib ketdi: {pallets} > {capacity} pallet{extra} — server buyurtmani rad etadi": [
    'Вместимость машины превышена: {pallets} > {capacity} поддонов{extra} — сервер отклонит заказ',
    'Vehicle capacity exceeded: {pallets} > {capacity} pallets{extra} — the server will reject the order',
  ],
  '(standart sig’im)': ['(стандартная вместимость)', '(standard capacity)'],
  'Transport turi': ['Тип транспорта', 'Transport type'],
  "Transport xarajati (shofyorga, so'm)": ['Транспортные расходы (водителю, сум)', 'Transport cost (to driver, sum)'],
  "Mijozdan olinadigan haq (so'm)": ['Плата с клиента (сум)', 'Charge to client (sum)'],
  'Transport foydasi:': ['Прибыль от транспорта:', 'Transport profit:'],
  "Qo'shimcha izoh (ixtiyoriy)": ['Дополнительное примечание (необязательно)', 'Additional note (optional)'],
  'Buyurtma yaratish': ['Создать заказ', 'Create order'],

  // ── NewOrder: summary card ──
  Xulosa: ['Итог', 'Summary'],
  'Pallet jami': ['Всего поддонов', 'Total pallets'],
  'Hajm jami': ['Всего объём', 'Total volume'],
  'Tovar summasi (taxminiy)': ['Сумма товара (ориентировочно)', 'Goods amount (estimated)'],
  'Narxsiz pozitsiyalar bor — summaga kirmagan': [
    'Есть позиции без цены — не вошли в сумму',
    'There are unpriced lines — not included in the total',
  ],
  'Mijozdan transport haqi': ['Плата за транспорт с клиента', 'Transport charge from client'],
  'Mijoz qarziga yoziladi': ['Запишется в долг клиента', "Charged to the client's debt"],
  'Mijozning joriy balansi': ['Текущий баланс клиента', "Client's current balance"],
  'Taxminiy zavod tannarxi': ['Ориентировочная себестоимость завода', 'Estimated factory cost'],
  'Taxminiy zavod tannarxi (naqd)': [
    'Ориентировочная себестоимость завода (наличные)',
    'Estimated factory cost (cash)',
  ],
  "Taxminiy zavod tannarxi (o'tkazma)": [
    'Ориентировочная себестоимость завода (перевод)',
    'Estimated factory cost (bank transfer)',
  ],
  'Taxminiy diller foydasi': ['Ориентировочная прибыль дилера', 'Estimated dealer profit'],
  "Naqd bilan to'lasangiz — tannarx": ['Если оплатите наличными — себестоимость', 'If you pay cash — cost'],
  "Naqd bilan to'lasangiz — foyda": ['Если оплатите наличными — прибыль', 'If you pay cash — profit'],
  "O'tkazma bilan to'lasangiz — tannarx": [
    'Если оплатите переводом — себестоимость',
    'If you pay by transfer — cost',
  ],
  "O'tkazma bilan to'lasangiz — foyda": [
    'Если оплатите переводом — прибыль',
    'If you pay by transfer — profit',
  ],
  "To'lov usuli aniqlanmagunicha foyda shu ikki chegara orasida — «Sof foyda»ga kirmaydi": [
    'Пока способ оплаты не определён, прибыль лежит между этими границами — в «Чистую прибыль» не входит',
    'Until the payment method is decided the profit lies between these two bounds — it is not counted in «Net profit»',
  ],
  "Ba'zi mahsulotlarda zavod narxi yo'q — foyda taxminiy": [
    'У некоторых товаров нет заводской цены — прибыль ориентировочная',
    'Some products have no factory price — profit is estimated',
  ],
  'Kredit limiti oshishi mumkin (limit: {limit}) — server tekshiradi': [
    'Кредитный лимит может быть превышен (лимит: {limit}) — проверит сервер',
    'The credit limit may be exceeded (limit: {limit}) — the server will check',
  ],

  // ── OrderDetail: «Zavodga to'lov turi» (R1) — niyat va uning oqibati ──
  "Zavodga to'lov turi": ['Способ оплаты заводу', 'Factory payment method'],
  "Zavodga to'lov turi o'zgartirildi": ['Способ оплаты заводу изменён', 'Factory payment method changed'],
  'Naqd orqali': ['Наличными', 'By cash'],
  "O'tkazma orqali": ['Переводом', 'By bank transfer'],
  'Aniq emas': ['Не определён', 'Not decided'],
  'tannarx zavod naqd narxida hisoblanadi': [
    'себестоимость считается по наличной цене завода',
    'the cost is computed at the factory cash price',
  ],
  "tannarx zavod o'tkazma narxida hisoblanadi": [
    'себестоимость считается по цене завода для перевода',
    'the cost is computed at the factory bank price',
  ],
  "tannarx to'lov qilinganda aniqlanadi — foyda hozircha aniqlanmagan": [
    'себестоимость определится при оплате — прибыль пока не определена',
    'the cost is decided when the money is paid — profit is undetermined for now',
  ],
  reja: ['план', 'planned'],

  // ── OrderDetail: moliya rail, coverage bo'yicha (naqd/o'tkazma aralashmasi) ──
  'Zavod tannarxi (haqiqiy)': ['Себестоимость завода (фактическая)', 'Factory cost (actual)'],
  "Zavod tannarxi — o'tkazma": ['Себестоимость завода — перевод', 'Factory cost — bank transfer'],
  "Tovar foydasi (o'tkazma)": ['Прибыль от товара (перевод)', 'Goods profit (bank transfer)'],
  "naqd bilan to'landi": ['оплачено наличными', 'paid with cash'],
  "o'tkazma bilan to'landi": ['оплачено переводом', 'paid by transfer'],
  "qolgani naqd bilan to'lansa": ['если остаток оплатить наличными', 'if the rest is paid with cash'],
  "qolgani o'tkazma bilan to'lansa": ['если остаток оплатить переводом', 'if the rest is paid by transfer'],

  // ── OrderDetail: «AVANSDAN YECHISH» (R2/R3) ──
  'AVANSDAN YECHISH': ['СПИСАТЬ С АВАНСА', 'DRAW FROM ADVANCE'],
  'Avansdan yechish': ['Списать с аванса', 'Draw from advance'],
  'Avansdan yechildi': ['Списано с аванса', 'Drawn from the advance'],
  'avval yuklashni boshlang': ['сначала начните погрузку', 'start the loading first'],
  "bu buyurtma bo'yicha zavodga qarz yo'q": [
    'по этому заказу нет долга заводу',
    'there is no factory debt on this order',
  ],
  'zavodda avans qolmagan': ['на заводе не осталось аванса', 'no advance left at the factory'],
  "Buyurtma qoldig'i": ['Остаток по заказу', 'Remaining on the order'],
  'Naqd avans': ['Наличный аванс', 'Cash advance'],
  "O'tkazma avans": ['Аванс переводом', 'Bank advance'],
  'Qaysi avansdan': ['С какого аванса', 'From which advance'],
  'naqd avansdan yechsangiz tannarx ZAVOD NAQD narxida hisoblanadi': [
    'если списать с наличного аванса, себестоимость посчитается по НАЛИЧНОЙ цене завода',
    'drawing from the cash advance computes the cost at the FACTORY CASH price',
  ],
  "o'tkazma avansdan yechsangiz tannarx ZAVOD O'TKAZMA narxida hisoblanadi": [
    'если списать с аванса переводом, себестоимость посчитается по цене завода ДЛЯ ПЕРЕВОДА',
    'drawing from the bank advance computes the cost at the FACTORY BANK price',
  ],
  "Shu kanaldan ko'pi bilan: {sum} so'm": [
    'С этого канала максимум: {sum} сум',
    'From this channel at most: {sum} sum',
  ],
  'Musbat summa kiriting': ['Введите положительную сумму', 'Enter a positive amount'],
  // server so'ralgan summadan KAM yechishi mumkin (kanal/buyurtma ehtiyoji tugasa) — R2
  "So'ralgan {requested} so'mdan faqat {drawn} so'm yechildi — {why}": [
    'Из запрошенных {requested} сум списано только {drawn} сум — {why}',
    'Only {drawn} of the requested {requested} sum was drawn — {why}',
  ],
  'buyurtmaning shu kanaldagi ehtiyoji shuncha edi, xolos': [
    'потребность заказа по этому каналу была именно такой',
    "that was all the order still needed on this channel",
  ],
  'kanalda shuncha avans qolgan edi, xolos': [
    'в канале оставалось именно столько аванса',
    'that was all the advance left in this channel',
  ],

  // ── OrderDetail: taqsimot bazasi + bitta taqsimotni orqaga qaytarish (R5) ──
  'Narx bazasi': ['База цены', 'Price basis'],
  avansdan: ['с аванса', 'from advance'],
  'Taqsimotni bekor qilish': ['Отменить распределение', 'Void the allocation'],
  'Taqsimot bekor qilindi': ['Распределение отменено', 'Allocation voided'],
  "{sum} so'm taqsimoti bekor qilinadi": [
    'Распределение на {sum} сум будет отменено',
    'The {sum} sum allocation will be voided',
  ],
  "Pul o'z avans kanaliga qaytadi": [
    'Деньги вернутся в свой канал аванса',
    'The money returns to its own advance channel',
  ],
  "To'lov taqsimlanmagan holatga qaytadi": [
    'Платёж вернётся в нераспределённое состояние',
    'The payment goes back to unallocated',
  ],
  'Buyurtma tannarxi qayta hisoblanadi': [
    'Себестоимость заказа пересчитается',
    "The order's cost is recomputed",
  ],

  // ── OrderDetail: paddon FAQAT donada (R4) ──
  'Paddonlar (dona)': ['Поддоны (шт)', 'Pallets (pcs)'],
  'Mijozga berilgan': ['Выдано клиенту', 'Given to the client'],
  'Mijozdan qaytgan': ['Возвращено клиентом', 'Returned by the client'],
  'Mijozda qolgan': ['Осталось у клиента', 'Still at the client'],
  'Zavodga qarzimiz (dona)': ['Наш долг заводу (шт)', 'We owe the factory (pcs)'],
};
