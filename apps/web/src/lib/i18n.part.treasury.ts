// Auto: treasury pages ru/en translations.
export const PART: Record<string, [string, string]> = {
  // ── Cashbox / bank account cards ──
  'Tahrirlash': ['Редактировать', 'Edit'],
  '{name} — tahrirlash': ['{name} — редактировать', '{name} — edit'],
  'Nofaol': ['Неактивный', 'Inactive'],
  'Faol': ['Активный', 'Active'],
  "so'm": ['сум', 'sum'],
  'Bank hisob qo‘shish': ['Добавить банковский счёт', 'Add bank account'],
  'Kassa qo‘shish': ['Добавить кассу', 'Add cash desk'],
  "Jami so'm:": ['Итого сум:', 'Total sum:'],
  'Jami USD:': ['Итого USD:', 'Total USD:'],
  "(valyutalar hech qachon qo'shilmaydi)": [
    '(валюты никогда не суммируются)',
    '(currencies are never summed)',
  ],

  // ── Manual income/expense modal ──
  'Kassa yozuvi saqlandi': ['Кассовая запись сохранена', 'Cash entry saved'],
  "Qo'lda kirim/chiqim": ['Ручной приход/расход', 'Manual income/expense'],
  'Saqlash': ['Сохранить', 'Save'],
  'Orqaga': ['Назад', 'Back'],
  'Bank hisob': ['Банковский счёт', 'Bank account'],
  'Kassa': ['Касса', 'Cash desk'],
  "Yo'nalish": ['Направление', 'Direction'],
  'Kirim': ['Приход', 'Income'],
  'Chiqim': ['Расход', 'Expense'],
  "Yo'nalishni tanlang": ['Выберите направление', 'Select direction'],
  'Summa': ['Сумма', 'Amount'],
  'Kassada: {amount} {curr}': ['В кассе: {amount} {curr}', 'In cash desk: {amount} {curr}'],
  'Sana': ['Дата', 'Date'],
  'Izoh': ['Примечание', 'Note'],
  'Izoh (ixtiyoriy)': ['Примечание (необязательно)', 'Note (optional)'],

  // ── Cashbox / bank account create + edit drawer ──
  "Bank hisob qo'shildi": ['Банковский счёт добавлен', 'Bank account added'],
  "Kassa qo'shildi": ['Касса добавлена', 'Cash desk added'],
  'Saqlandi': ['Сохранено', 'Saved'],
  'Bank hisobni tahrirlash': ['Редактировать банковский счёт', 'Edit bank account'],
  'Kassani tahrirlash': ['Редактировать кассу', 'Edit cash desk'],
  'Yangi bank hisob': ['Новый банковский счёт', 'New bank account'],
  'Yangi kassa': ['Новая касса', 'New cash desk'],
  'Nomi': ['Название', 'Name'],
  'Masalan: Kapital Bank': ['Например: Kapital Bank', 'e.g. Kapital Bank'],
  'Masalan: Asosiy kassa': ['Например: Основная касса', 'e.g. Main cash desk'],
  'Turi': ['Тип', 'Type'],
  'Naqd kassa': ['Наличная касса', 'Cash box'],
  'Click': ['Click', 'Click'],
  'Terminal': ['Терминал', 'Terminal'],
  'Valyuta': ['Валюта', 'Currency'],
  "So'm (UZS)": ['Сум (UZS)', 'Sum (UZS)'],
  'Dollar (USD)': ['Доллар (USD)', 'Dollar (USD)'],
  'Holati': ['Статус', 'Status'],

  // ── Page header (title / subtitle / actions) ──
  'Bank hisoblar': ['Банковские счета', 'Bank accounts'],
  'Bank va terminal hisoblari — qoldiq, kirim/chiqim va jurnal': [
    'Банковские и терминальные счета — остаток, приход/расход и журнал',
    'Bank and terminal accounts — balance, in/out and journal',
  ],
  'Naqd kassalar — qoldiq, kirim/chiqim va tranzaksiyalar jurnali': [
    'Наличные кассы — остаток, приход/расход и журнал транзакций',
    'Cash desks — balance, in/out and a transactions journal',
  ],

  // ── Journal (columns + row actions) ──
  'Manba': ['Источник', 'Source'],
  'Hujjat': ['Документ', 'Document'],
  'Hujjatni ochish': ['Открыть документ', 'Open document'],
  'Kvitansiya': ['Квитанция', 'Receipt'],
  'Qaytarish (storno)': ['Сторнировать', 'Reverse (storno)'],
  'Amallar': ['Действия', 'Actions'],
  'Jurnal': ['Журнал', 'Journal'],
  'Tozalash': ['Очистить', 'Clear'],
  "Bu davrda kassa harakati yo'q": [
    'За этот период нет движений по кассе',
    'No cash movements in this period',
  ],

  // ── HujjatCell (source-document labels) ──
  'Xarajat': ['Расход', 'Expense'],
  'Bonus yechish': ['Снятие бонуса', 'Bonus withdrawal'],
  'Qaytarilgan': ['Сторнировано', 'Reversed'],

  // ── Storno (ReasonModal + impact facts) ──
  'Kassa yozuvini qaytarish (storno)': [
    'Сторно кассовой записи',
    'Reverse the cash entry (storno)',
  ],
  'Qaytarish': ['Сторнировать', 'Reverse'],
  'kirim': ['приход', 'in'],
  'chiqim': ['расход', 'out'],
  'Qarama-qarshi yozuv: {box} {sign} {amount} {curr} ({dir} stornosi)': [
    'Обратная запись: {box} {sign} {amount} {curr} (сторно {dir})',
    'Opposite entry: {box} {sign} {amount} {curr} (reversal of {dir})',
  ],
  "Kassa qoldig'i: {amount} {curr} bo'ladi": [
    'Остаток кассы станет: {amount} {curr}',
    'Cash balance will be: {amount} {curr}',
  ],
};
