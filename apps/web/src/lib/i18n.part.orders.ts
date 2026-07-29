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
  // ── jadval TEPASIDAGI yakun (SummaryStrip) ──
  // Bekor qilinganlar 2026-07-28 dan boshlab HECH BIR yakunga kirmaydi, shuning uchun
  // «Shundan bekor qilingan» pul figurasi va uni izohlagan uchta qamrov jumlasi
  // o'chirildi — izohlashga narsa qolmadi. O'rnida bitta SON izohi bor: jadvalda
  // ko'rinib turgan, lekin sanalmagan qatorlar nechta ekanini aytadi.
  Hajmi: ['Объём', 'Volume'],
  '{count} ta buyurtma': ['{count} заказов', '{count} orders'],
  '{count} ta bekor qilingan (hisobga olinmagan)': [
    '{count} отменённых (не учтены)',
    '{count} cancelled (not counted)',
  ],
  'Buyurtma tarkibi': ['Состав заказа', 'Order contents'],
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
  // ── Bekor qilish oynasi (CancelOrderModal, egasi qoidasi 2026-07-29) ──
  // BITTA savol ikkala tomonni hal qiladi: «Ha» da pul jismonan qayerda bo'lsa o'sha
  // yerda (mijozda + zavodda avans) qoladi, «Yo'q» da ikkala hujjat ham storno qilinadi.
  "To'langan pullar avansda qoladimi?": [
    'Останутся ли уплаченные деньги авансом?',
    'Does the money already paid stay as an advance?',
  ],
  'Ha — avansda qoladi': ['Да — останется авансом', 'Yes — it stays as an advance'],
  // ikkala kanaldan ham to'langan buyurtma uchun — `naqd`/`o'tkazma` alohida allaqachon bor
  "naqd va o'tkazma": ['наличные и перечисление', 'cash and bank transfer'],
  "Yo'q — to'lamagandek bo'lsin": [
    'Нет — как будто не платили',
    'No — as if nothing was ever paid',
  ],
  "Bu buyurtma bo'yicha na mijoz to'lagan, na zavodga o'tkazilgan — tanlovning ahamiyati yo'q": [
    'По этому заказу ни клиент не платил, ни заводу не переводили — выбор ни на что не влияет',
    'On this order neither the client paid nor the factory was wired — the choice changes nothing',
  ],
  "Mijozning puli bizda, bizning pulimiz zavodda qoladi — ikkalasi ham avansga aylanadi": [
    'Деньги клиента остаются у нас, наши — на заводе; и то, и другое становится авансом',
    "The client's money stays with us and ours stays at the factory — both become advances",
  ],
  "Ikkala to'lov hujjati ham bekor qilinadi — hech kim hech kimga to'lamagandek bo'ladi": [
    'Оба платёжных документа отменяются — как будто никто никому не платил',
    'Both payment records are voided — as if nobody paid anybody',
  ],
  "Mijoz bizga to'lagan": ['Клиент заплатил нам', 'Client paid us'],
  "Mijoz shofyorga to'lagan": ['Клиент заплатил водителю', 'Client paid the driver'],
  "Biz zavodga o'tkazganimiz": ['Мы перевели заводу', 'We wired to the factory'],
  'Mijozning avansida qoladi': ['Останется авансом клиента', "Stays as the client's advance"],
  'Mijozda qoladi': ['Останется у клиента', 'Stays with the client'],
  'Zavodda qoladigan avansimiz': ['Наш аванс, остающийся на заводе', 'Our advance left at the factory'],
  "Buyurtma savdosi bekor qilinadi — mijozning bu buyurtma bo'yicha {sum} qarzi yo'qoladi": [
    'Продажа заказа отменяется — долг клиента по этому заказу {sum} исчезает',
    "The order's sale is reversed — the client's {sum} debt on it disappears",
  ],
  "Zavodga o'tkazgan {sum} pulimiz ZAVODDA qoladi — {channel} avansimiz bo'lib turadi va keyingi buyurtmada «avansdan yechish» bilan ishlatiladi (kassaga QAYTMAYDI)":
    [
      'Переведённые заводу {sum} ОСТАЮТСЯ НА ЗАВОДЕ — это наш {channel} аванс, он пойдёт на следующий заказ через «списание с аванса» (в кассу НЕ возвращается)',
      'The {sum} we wired STAYS AT THE FACTORY — it is our {channel} advance and will be spent on the next order via «draw from advance» (it does NOT come back to the till)',
    ],
  "Zavodga o'tkazgan {sum} pulimiz ZAVODDA, avansimiz bo'lib qoladi — keyingi buyurtmada «avansdan yechish» bilan ishlatiladi (kassaga QAYTMAYDI)":
    [
      'Переведённые заводу {sum} ОСТАЮТСЯ НА ЗАВОДЕ нашим авансом — пойдут на следующий заказ через «списание с аванса» (в кассу НЕ возвращается)',
      'The {sum} we wired STAYS AT THE FACTORY as our advance — it will be spent on the next order via «draw from advance» (it does NOT come back to the till)',
    ],
  "Zavodga o'tkazgan {sum} pulimiz to'liq orqaga qaytadi — zavodda avans QOLMAYDI (biz o'sha pulni umuman o'tkazmagandek bo'lamiz)":
    [
      'Переведённые заводу {sum} возвращаются полностью — аванса на заводе НЕ ОСТАЁТСЯ (как будто мы эти деньги вообще не переводили)',
      'The {sum} we wired comes back in full — NO advance is left at the factory (as if we never wired it at all)',
    ],
  "Bundan {sum} bonus hisobidan yopilgan — u avansga aylanmaydi va hamyonga ham qaytmaydi (zavoddagi ortiqcha to'lovimiz bo'lib qoladi)":
    [
      'Из них {sum} закрыто с бонусного счёта — они не становятся авансом и в кошелёк не возвращаются (остаются нашей переплатой заводу)',
      'Of that, {sum} was settled from the bonus wallet — it becomes neither an advance nor a wallet refund (it stays as our overpayment to the factory)',
    ],
  "Zavodga bu buyurtma bo'yicha to'lov qilinmagan — zavod qarzimiz bekor bo'ladi": [
    'По этому заказу заводу не платили — наш долг заводу просто отменяется',
    'Nothing was paid to the factory on this order — our payable is simply reversed',
  ],
  "Mijozning to'lagan {sum} puli uning AVANSIDA qoladi — keyingi buyurtmasiga ishlatiladi": [
    'Уплаченные клиентом {sum} остаются его АВАНСОМ — пойдут на следующий заказ',
    'The {sum} the client paid stays as their ADVANCE — it will go toward their next order',
  ],
  "Mijozning to'lagan {sum} puli — u bizga umuman to'lamagandek bo'ladi (to'lov hujjati bekor qilinadi)":
    [
      'Уплаченные клиентом {sum} — как будто он нам вообще не платил (платёжный документ отменяется)',
      "The {sum} the client paid — as if they never paid us at all (the payment record is voided)",
    ],
  "Mijoz shofyorga bergan {sum} hujjati bekor qilinadi — bu pul bizdan o'tmagan, mijoz oldida qarz qoldirmaydi":
    [
      'Документ об отданных водителю {sum} отменяется — эти деньги через нас не проходили и долга перед клиентом не создают',
      'The {sum} handed to the driver is voided — that money never passed through us and leaves no debt to the client',
    ],
  "Shu buyurtmadan olinadigan {sum} sof foyda yo'qoladi": [
    'Чистая прибыль {sum} по этому заказу исчезает',
    "This order's {sum} net profit disappears",
  ],
  "Shu buyurtmaning {sum} zarari ham bekor bo'ladi": [
    'Убыток {sum} по этому заказу тоже отменяется',
    "This order's {sum} loss is reversed as well",
  ],
  'Poddon harakati va bonus hisobi ham bekor qilinadi': [
    'Движение поддонов и начисление бонуса тоже отменяются',
    'Pallet movements and the bonus accrual are reversed too',
  ],
  'YAKUNDA: mijozning avansida {client}, zavoddagi avansimizda esa {factory} qoladi': [
    'ИТОГО: авансом клиента остаётся {client}, нашим авансом на заводе — {factory}',
    "IN THE END: {client} stays as the client's advance and {factory} as our advance at the factory",
  ],
  "YAKUNDA: mijozning avansida {client} qoladi; zavodga bu buyurtma bo'yicha pul o'tkazilmagan": [
    'ИТОГО: авансом клиента остаётся {client}; заводу по этому заказу денег не переводили',
    "IN THE END: {client} stays as the client's advance; nothing was wired to the factory on this order",
  ],
  "YAKUNDA: zavoddagi avansimizda {factory} qoladi; mijoz bu buyurtma uchun to'lov qilmagan": [
    'ИТОГО: нашим авансом на заводе остаётся {factory}; клиент по этому заказу не платил',
    'IN THE END: {factory} stays as our advance at the factory; the client paid nothing on this order',
  ],
  "YAKUNDA: bu buyurtma bo'yicha pul harakati bo'lmagan — hech kimda hech narsa qolmaydi": [
    'ИТОГО: по этому заказу движения денег не было — ни у кого ничего не остаётся',
    'IN THE END: no money moved on this order — nothing is left anywhere',
  ],
  'YAKUNDA: buyurtma huddi YARATILMAGANDEK bo‘ladi — na mijozda, na zavodda iz qolmaydi': [
    'ИТОГО: заказ как будто НЕ СОЗДАВАЛСЯ — следов не остаётся ни у клиента, ни на заводе',
    'IN THE END: the order reads as if it was NEVER CREATED — no trace at the client or the factory',
  ],
  "Mijozning {sum} to'lovi BOSHQA buyurtma bilan bitta hujjatda — uni bekor qilib bo'lmaydi (boshqa buyurtma ochilib ketardi). Shuning uchun bu pul baribir mijozning AVANSIDA qoladi":
    [
      'Платёж клиента {sum} оформлен одним документом с ДРУГИМ заказом — отменить его нельзя (тот заказ снова стал бы неоплаченным). Поэтому эти деньги всё равно останутся АВАНСОМ клиента',
      "The client's {sum} payment shares one document with ANOTHER order — it cannot be voided (that order would reopen). So this money stays as the client's ADVANCE anyway",
    ],
  'YAKUNDA: zavodda iz qolmaydi, lekin mijozning avansida {client} qoladi — ulashilgan to‘lov hujjati bekor qilinmaydi':
    [
      'ИТОГО: на заводе следов не остаётся, но авансом клиента остаётся {client} — общий платёжный документ не отменяется',
      'IN THE END: no trace at the factory, but {client} stays as the client’s advance — a shared payment document is not voided',
    ],
  // ── bekor qilingandan KEYIN: pul qayerda qolgani (OrderDetail banner + Tarix chipi) ──
  "Pul harakati bo'lmadi: mijozning to'lagani uning avansida, biz zavodga o'tkazganimiz esa zavoddagi avansimizda qoldi.":
    [
      'Движения денег не было: уплаченное клиентом осталось его авансом, а переведённое нами — нашим авансом на заводе.',
      "No money moved: what the client paid stays as their advance, and what we wired stays as our advance at the factory.",
    ],
  "Ikkala to'lov hujjati ham storno qilindi — kassa buyurtmadan oldingi holatiga qaytdi, mijozda ham, zavodda ham iz qolmadi.":
    [
      'Оба платёжных документа сторнированы — касса вернулась к состоянию до заказа, следов не осталось ни у клиента, ни на заводе.',
      'Both payment records were reversed — the till is back to its pre-order state and no trace is left at the client or the factory.',
    ],
  "Buyurtmadan uzildi — puli avansda": ['Отвязан от заказа — деньги авансом', 'Detached from the order — money stays as advance'],
  'Bekor qilingan buyurtma': ['Отменённый заказ', 'Cancelled order'],
  "{orders} bekor qilingan — bu to'lov o'sha buyurtmadan uzildi (hujjatning o'zi tirik)": [
    '{orders} отменён — платёж отвязан от заказа (сам документ жив)',
    '{orders} was cancelled — the payment was detached from it (the document itself is alive)',
  ],
  "{orders} bekor qilingan — bu to'lov hujjati ham storno qilindi": [
    '{orders} отменён — этот платёжный документ тоже сторнирован',
    '{orders} was cancelled — this payment record was reversed too',
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
  "Sana, moshina, haydovchi va izoh o'zgartiriladi. Summalar (narx, hajm, tannarx) o'zgarmaydi.": [
    'Изменяются дата, машина, водитель и примечание. Суммы (цена, объём, себестоимость) не меняются.',
    'The date, vehicle, driver and note change. Amounts (price, volume, cost) stay the same.',
  ],
  "Sana ko'chirilsa buyurtmaning qarz va poddon yozuvlari ham o'sha kunga o'tadi — hisobotlarda buyurtma bir davrda, uning qarzi boshqasida qolib ketmaydi. Narxlar qayta hisoblanmaydi: buyurtma o'z narxlarida qoladi.": [
    'При переносе даты долговые и поддонные записи заказа переходят на тот же день — в отчётах заказ не окажется в одном периоде, а его долг в другом. Цены не пересчитываются: заказ остаётся со своими ценами.',
    "When the date moves, the order's debt and pallet records move to that day too — reports will not leave the order in one period and its debt in another. Prices are not recalculated: the order keeps its own prices.",
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
