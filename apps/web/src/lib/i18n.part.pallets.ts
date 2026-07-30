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
};
