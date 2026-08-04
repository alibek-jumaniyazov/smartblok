// Paddon tarixi («olingan − qaytargan = qoldiq») ru/en translations — 2026-07-25.
// Bu bo'lim TOMONGA bog'langan atamalarni saqlaydi: bitta figura bitta nom bilan
// ataladi va u Paddonlar sahifasi, mijoz/zavod kartochkasi, ish stoli doskasi va
// PalletChip popoverida AYNAN bir xil o'qiladi — shuning uchun ular bitta faylda.
// Sana oynasi yo'q: raqamlar butun davr uchun (egasi qarori).
export const PART: Record<string, [string, string]> = {
  // ── PalletStatsPanel — zavod tomoni ───────────────────────────────────
  'Zavoddan jami olingan': ['Всего получено с завода', 'Total received from factory'],
  'Zavodga qaytarilgan': ['Возвращено заводу', 'Returned to factory'],
  // qarz DONADA, pulda emas — shuning uchun ru/en da summa emas, sof «должны»
  'Hozir qarzmiz': ['Сейчас должны', 'We owe now'],

  // ── PalletStatsPanel — mijoz tomoni ───────────────────────────────────
  'Mijozga jami berilgan': ['Всего выдано клиенту', 'Total given to client'],
  'Mijoz qaytargan': ['Клиент вернул', 'Client returned'],
  'Hozir mijozda': ['Сейчас у клиента', 'At the client now'],

  // ── Reykadagi shartli hadlar (faqat nolga teng bo'lmaganda chiqadi) ──
  // «Tuzatish» kaliti lug'atda allaqachon bor (Корректировка) — takrorlanmaydi.
  "Yo'qotilgan (undirilgan)": ['Утеряно (взыскано)', 'Lost (charged)'],

  // ── Panel izohi: daraja va sanalar ────────────────────────────────────
  'Qaytarish darajasi': ['Уровень возврата', 'Return rate'],
  'Oxirgi harakat': ['Последнее движение', 'Last movement'],
  'Oxirgi qaytargan': ['Последний возврат', 'Last return'],
  'Hech qachon qaytarmagan': ['Ни разу не возвращал', 'Never returned any'],
  'Paddon tarixi': ['История поддонов', 'Pallet history'],

  // ── Paddonlar sahifasi: jadval sarlavhalari va reyting ────────────────
  // Ustun sarlavhalarida tomon nomi takrorlanmaydi (karta sarlavhasi va birinchi
  // ustun uni allaqachon aytadi), lekin qoldiq ustuni paneldagi AYNAN o'sha nomni
  // oladi — chip ochilganda ikkita nom ko'rinmasin.
  'Jami olingan': ['Всего получено', 'Total received'],
  Qaytargan: ['Возвращено', 'Returned'],
  // «Yo'qotilgan (undirilgan)» ning tor joylar (jadval sarlavhasi, telefon
  // kartasining qirqiladigan satri) uchun qisqa juftligi — to'liq shakl esa
  // panelda va popoverda qoladi.
  "Yo'qotilgan": ['Утеряно', 'Lost'],
  "Eng ko'p paddon ushlab turganlar": [
    'Больше всего поддонов на руках',
    'Holding the most pallets',
  ],

  // ── ClientDetail «Paddonlar» tabi ─────────────────────────────────────
  'Barcha harakatlar →': ['Все движения →', 'All movements →'],

  // ── Mijoz kartochkasidagi paddon amallari (egasi so'rovi, 2026-07-30) ──
  // Varaq sarlavhalari, maydonlari va xabarlari /paddonlar sahifasidan AYNAN qayta
  // ishlatiladi («Mijozdan paddon qabul qilish», «Mijozda mavjud: {n} dona»,
  // «Yo'qotilganini undirish» …) — bitta amal bitta nom bilan atalishi shart, shuning
  // uchun bu yerda faqat mijoz kartochkasiga XOS uchta yangi satr bor.
  //
  // Tugma nomida «paddon» so'zi MAJBURIY: u sarlavhada «To'lov qabul qilish» yonida
  // turadi va /paddonlar sahifasidagi qisqa «Qaytarish qabul qilish» o'sha qatorda
  // «nimani qaytarish?» degan savol tug'dirardi.
  'Paddon qaytarib olish': ['Принять возврат поддонов', 'Accept pallet return'],
  "Bu mijozda hisobda paddon yo'q": [
    'У этого клиента нет поддонов на учёте',
    'This client holds no pallets on the books',
  ],
  "Mijozning pul qarzi o'zgarmaydi: faqat uning paddon qoldig'i kamayadi.": [
    'Денежный долг клиента не меняется — уменьшается только остаток поддонов.',
    "The client's money debt is unchanged — only his pallet balance goes down.",
  ],

  // ── Qaytarishni bekor qilish (egasi so'rovi, 2026-08-01) ──────────────
  // «Paddonni oldik, keyin qarasak bu boshqa mijoz ekan» — defterdagi qatorning
  // stornosi. «Bekor qilish» va «Bekor qilingan» lug'atda allaqachon bor, shuning
  // uchun bu yerda faqat shu amalga XOS satrlar.
  'Qaytarishni bekor qilish': ['Отменить возврат', 'Cancel the return'],
  'Qaytarish bekor qilindi — mijozda {n} dona paddon qoldi': [
    'Возврат отменён — за клиентом осталось {n} шт поддонов',
    'Return cancelled — {n} pallets stay with the client',
  ],
  'Qaytarish bekor qilindi': ['Возврат отменён', 'Return cancelled'],
  'Nega bekor qilinmoqda? (masalan: paddon boshqa mijozdan olingan)': [
    'Почему отменяется? (например: поддоны забрали у другого клиента)',
    'Why is it being cancelled? (e.g. the pallets came from another client)',
  ],
  '«{client}» hisobiga {n} dona paddon qaytadi — qarzi shunga oshadi': [
    'На счёт «{client}» вернётся {n} шт поддонов — его долг вырастет на столько же',
    '{n} pallets go back onto «{client}» — his pallet debt grows by the same amount',
  ],
  "Diller qo'lidagi bo'sh zaxira {n} donaga kamayadi": [
    'Свободный запас на руках у дилера уменьшится на {n} шт',
    "The dealer's loose stock goes down by {n}",
  ],
  "Pul harakati yo'q — mijozning pul qarzi o'zgarmaydi": [
    'Движения денег нет — денежный долг клиента не меняется',
    "No money moves — the client's money debt is unchanged",
  ],
  // Bu satr IKKALA turga ham tegishli («qaytarish» emas, «asl yozuv»), chunki endi
  // undirish ham bekor qilinadi — matn turga qarab o'zgarmasligi kerak.
  "Qator o'chirilmaydi: asl yozuv ham, uni bekor qilgan storno ham defterda qoladi": [
    'Строка не удаляется: и сама запись, и отменяющее её сторно остаются в журнале',
    'Nothing is deleted: both the original row and the reversal that undoes it stay in the ledger',
  ],
  'Nimaning stornosi': ['Сторно чего', 'Reversal of'],

  // ── Undirishni bekor qilish (egasi so'rovi, 2026-08-04) ───────────────
  // «Yo'qolgan deb undirdik, keyin paddon topildi» yoki «xato mijozdan undirilgan».
  // Qaytarish stornosidan FARQI: bu yerda PUL ham qaytadi (PALLET_CHARGE ledger
  // qatori stornolanadi), diller zaxirasi esa umuman qimirlamaydi.
  'Undirishni bekor qilish': ['Отменить взыскание', 'Cancel the charge'],
  'Undirish bekor qilingan': ['Взыскание отменено', 'Charge cancelled'],
  'Undirish bekor qilindi': ['Взыскание отменено', 'Charge cancelled'],
  'Undirish bekor qilindi — {sum} qarzdan yechildi, mijozda {n} dona paddon qoldi': [
    'Взыскание отменено — {sum} снято с долга, за клиентом осталось {n} шт поддонов',
    'Charge cancelled — {sum} removed from the debt, {n} pallets stay with the client',
  ],
  'Undirish bekor qilindi — {sum} mijoz qarzidan yechildi': [
    'Взыскание отменено — {sum} снято с долга клиента',
    "Charge cancelled — {sum} removed from the client's debt",
  ],
  'Nega bekor qilinmoqda? (masalan: paddon topildi / xato mijozdan undirilgan)': [
    'Почему отменяется? (например: поддоны нашлись / взыскано не с того клиента)',
    'Why is it being cancelled? (e.g. the pallets turned up / the wrong client was charged)',
  ],
  '«{client}» ning pul qarzi {sum} ga kamayadi': [
    'Денежный долг «{client}» уменьшится на {sum}',
    "«{client}»'s money debt goes down by {sum}",
  ],
  '«{client}» ning pul qarzi undirilgan summaga kamayadi': [
    'Денежный долг «{client}» уменьшится на взысканную сумму',
    "«{client}»'s money debt goes down by the charged amount",
  ],
  '{n} dona paddon yana «{client}» hisobiga qaytadi — paddon qarzi shunga oshadi': [
    'На счёт «{client}» вернётся {n} шт поддонов — его поддонный долг вырастет на столько же',
    '{n} pallets go back onto «{client}» — his pallet debt grows by the same amount',
  ],
  "Diller qo'lidagi zaxira o'zgarmaydi — yo'qolgan paddon qo'limizga qaytmagan edi": [
    'Запас на руках у дилера не меняется — утерянные поддоны к нам и не возвращались',
    "The dealer's loose stock is unchanged — the lost pallets never came back to us",
  ],
};
