// lib/i18n.dict.ts — rus va ingliz tarjimalari lug'ati.
// Kalit = o'zbek lotin manba matni. Qiymat = [ru, en].
// uz-cyrl bu yerda YO'Q — u transliteratsiya orqali avtomatik olinadi.
// Bu yerda topilmagan matn o'zbek lotin ko'rinishida qoladi (fallback).

import { PART as P_orders } from "./i18n.part.orders";
import { PART as P_parties } from "./i18n.part.parties";
import { PART as P_catalog } from "./i18n.part.catalog";
import { PART as P_finance } from "./i18n.part.finance";
import { PART as P_treasury } from "./i18n.part.treasury";
import { PART as P_admin } from "./i18n.part.admin";
import { PART as P_comp1 } from "./i18n.part.comp1";
import { PART as P_comp2 } from "./i18n.part.comp2";

const RAW: Record<string, [string, string]> = {
  // ── Navigatsiya / qobiq ──────────────────────────────────────────────
  'Ish stoli': ['Рабочий стол', 'Dashboard'],
  'Kassa terminali': ['Кассовый терминал', 'Cash terminal'],
  'AI suhbat': ['AI-чат', 'AI chat'],
  'AI yordamchi': ['AI-помощник', 'AI assistant'],
  Buyurtmalar: ['Заказы', 'Orders'],
  Buyurtma: ['Заказ', 'Order'],
  Mijozlar: ['Клиенты', 'Clients'],
  Mijoz: ['Клиент', 'Client'],
  Agentlar: ['Агенты', 'Agents'],
  Agent: ['Агент', 'Agent'],
  "To'lovlar": ['Платежи', 'Payments'],
  "To'lov": ['Оплата', 'Payment'],
  Qarzlar: ['Долги', 'Debts'],
  Qarz: ['Долг', 'Debt'],
  Kassa: ['Касса', 'Cash desk'],
  'Bank hisoblar': ['Банковские счета', 'Bank accounts'],
  Zavodlar: ['Заводы', 'Factories'],
  Zavod: ['Завод', 'Factory'],
  Mahsulotlar: ['Товары', 'Products'],
  'Bonus hamyonlar': ['Бонусные кошельки', 'Bonus wallets'],
  Paddonlar: ['Поддоны', 'Pallets'],
  Moshinalar: ['Машины', 'Vehicles'],
  Foydalanuvchilar: ['Пользователи', 'Users'],
  'Tizim sozlamalari': ['Настройки системы', 'System settings'],
  'Excel import': ['Импорт Excel', 'Excel import'],
  Profil: ['Профиль', 'Profile'],
  "Mening ko'rsatkichlarim": ['Мои показатели', 'My metrics'],
  Yana: ['Ещё', 'More'],
  Terminal: ['Терминал', 'Terminal'],

  // Menyu bo'lim sarlavhalari
  SAVDO: ['ПРОДАЖИ', 'SALES'],
  MOLIYA: ['ФИНАНСЫ', 'FINANCE'],
  "TA'MINOT": ['СНАБЖЕНИЕ', 'SUPPLY'],
  TIZIM: ['СИСТЕМА', 'SYSTEM'],
  KATALOG: ['КАТАЛОГ', 'CATALOG'],

  // Qobiq boshqaruvlari
  'Qidiruv…': ['Поиск…', 'Search…'],
  'Qidiruv (Ctrl+K)': ['Поиск (Ctrl+K)', 'Search (Ctrl+K)'],
  'Yon panelni ochish': ['Открыть панель', 'Open sidebar'],
  "Yon panelni yig'ish": ['Свернуть панель', 'Collapse sidebar'],
  'SmartBlok — bosh sahifa': ['SmartBlok — главная', 'SmartBlok — home'],
  'Gazoblok diller ERP': ['ERP дилера газоблоков', 'Gas-block dealer ERP'],
  'Hisob menyusi': ['Меню аккаунта', 'Account menu'],
  Menyu: ['Меню', 'Menu'],
  'Asosiy navigatsiya': ['Основная навигация', 'Main navigation'],
  'Koʻproq': ['Ещё', 'More'],
  'Yorug‘ rejim': ['Светлая тема', 'Light mode'],
  'Tungi rejim': ['Тёмная тема', 'Dark mode'],
  'Klaviatura yorliqlari': ['Горячие клавиши', 'Keyboard shortcuts'],
  Chiqish: ['Выход', 'Log out'],
  'Boshqa amallar': ['Другие действия', 'More actions'],
  Til: ['Язык', 'Language'],
  'Tilni tanlang': ['Выберите язык', 'Select language'],

  // ── Klaviatura yorliqlari oynasi ────────────────────────────────────
  Umumiy: ['Общее', 'General'],
  'Buyruqlar paneli (yozuvlar / amallar / sahifalar)': [
    'Командная панель (записи / действия / страницы)',
    'Command palette (records / actions / pages)',
  ],
  "O'tish: Ish stoli / Buyurtmalar / Mijozlar / To'lovlar / Qarzlar / Kassa": [
    'Переход: Рабочий стол / Заказы / Клиенты / Платежи / Долги / Касса',
    'Go to: Dashboard / Orders / Clients / Payments / Debts / Cash desk',
  ],
  'Ustki oynani yopish': ['Закрыть окно', 'Close overlay'],
  "Ro'yxatlar": ['Списки', 'Lists'],
  'Qidiruvga fokus': ['Фокус на поиск', 'Focus search'],
  "Yangi (sahifaning asosiy amali)": ['Создать (основное действие)', "New (page's primary action)"],
  "Filtr qo'shish": ['Добавить фильтр', 'Add filter'],
  "Saqlangan ko'rinishlar": ['Сохранённые виды', 'Saved views'],
  'Qator kursori': ['Курсор строки', 'Row cursor'],
  'Qatorni ochish': ['Открыть строку', 'Open row'],
  'Peek panelni ochish/yopish': ['Открыть/закрыть панель просмотра', 'Toggle peek panel'],
  'Qatorni tanlash': ['Выбрать строку', 'Select row'],
  'Qator amallari': ['Действия со строкой', 'Row actions'],
  "To'lov — qator tarafiga bog'langan": [
    'Оплата — привязана к стороне строки',
    "Payment — bound to the row's party",
  ],
  Formalar: ['Формы', 'Forms'],
  "Qator qo'shish (buyurtma)": ['Добавить строку (заказ)', 'Add line (order)'],
  'FIFO avto-taqsimlash': ['FIFO авто-распределение', 'FIFO auto-allocation'],
  "Bekor qilish (o'zgarish tekshiruvi)": ['Отмена (проверка изменений)', 'Cancel (dirty check)'],
  Kartalar: ['Карточки', 'Cards'],
  Tahrirlash: ['Редактировать', 'Edit'],
  'Chop etish menyusi': ['Меню печати', 'Print menu'],
  'Keyingi bosqich': ['Следующий этап', 'Next stage'],

  // ── AI suhbat doki ──────────────────────────────────────────────────
  'Yangi suhbat': ['Новый чат', 'New chat'],
  Suhbatlar: ['Чаты', 'Chats'],
  'Suhbatlar tarixi': ['История чатов', 'Chat history'],
  "Suhbat yo‘q": ['Нет чатов', 'No chats'],
  "Hali suhbatlar yo‘q": ['Пока нет чатов', 'No chats yet'],
  "Suhbatni o‘chirish?": ['Удалить чат?', 'Delete chat?'],
  "O‘chirish": ['Удалить', 'Delete'],
  Bekor: ['Отмена', 'Cancel'],
  'Xabar yozing…': ['Напишите сообщение…', 'Type a message…'],
  Yuborish: ['Отправить', 'Send'],
  'yozmoqda…': ['печатает…', 'typing…'],
  'Savolingizni yozing — yangi suhbat avtomatik boshlanadi.': [
    'Напишите вопрос — новый чат начнётся автоматически.',
    'Type your question — a new chat starts automatically.',
  ],
  'Yordamchi AI bilan suhbatlashing — suhbatlar saqlanadi': [
    'Общайтесь с AI-помощником — чаты сохраняются',
    'Chat with the AI assistant — conversations are saved',
  ],
  'AI yordamchi bilan suhbat': ['Чат с AI-помощником', 'Chat with the AI assistant'],
  'Suhbatni yopish': ['Закрыть чат', 'Close chat'],
  'AI yordamchini ochish': ['Открыть AI-помощника', 'Open AI assistant'],
  '{count} xabar': ['{count} сообщений', '{count} messages'],

  // ── Umumiy holat / feedback komponentlari ───────────────────────────
  'Filtrlarni tozalash': ['Очистить фильтры', 'Clear filters'],
  "Ma'lumotlarni yuklab bo'lmadi": ['Не удалось загрузить данные', 'Failed to load data'],
  'Qayta urinish': ['Повторить', 'Retry'],
  Saqlash: ['Сохранить', 'Save'],
  'Bekor qilish': ['Отмена', 'Cancel'],
  "Ma'lumot yo'q": ['Нет данных', 'No data'],
  Yopish: ['Закрыть', 'Close'],
  Tanlang: ['Выберите', 'Select'],
  Qidirish: ['Поиск', 'Search'],
  'Qidirish…': ['Поиск…', 'Search…'],

  // ── Umumiy jadval / atama ──────────────────────────────────────────
  Jami: ['Итого', 'Total'],
  Sana: ['Дата', 'Date'],
  Holat: ['Статус', 'Status'],
  Summa: ['Сумма', 'Amount'],
  Izoh: ['Примечание', 'Note'],
  Nomi: ['Название', 'Name'],
  Amallar: ['Действия', 'Actions'],
  Telefon: ['Телефон', 'Phone'],
  Manzil: ['Адрес', 'Address'],
  Miqdor: ['Количество', 'Quantity'],
  Narx: ['Цена', 'Price'],
  Yangi: ['Новый', 'New'],
  Hammasi: ['Все', 'All'],
  Faol: ['Активный', 'Active'],
  Nofaol: ['Неактивный', 'Inactive'],
  Ha: ['Да', 'Yes'],
  "Yo'q": ['Нет', 'No'],

  // ── status-maps: buyurtma holati ───────────────────────────────────
  Tasdiqlangan: ['Подтверждён', 'Confirmed'],
  Yuklanmoqda: ['Загружается', 'Loading'],
  Yetkazilmoqda: ['Доставляется', 'Delivering'],
  Yetkazildi: ['Доставлен', 'Delivered'],
  Yakunlandi: ['Завершён', 'Completed'],
  'Bekor qilingan': ['Отменён', 'Cancelled'],

  // Cost holati
  "Zavodga to'lanmagan": ['Не оплачено заводу', 'Unpaid to factory'],
  'Qisman to‘langan': ['Частично оплачено', 'Partially paid'],
  "To'langan": ['Оплачено', 'Paid'],

  // Transport to'lov
  "To'lanmagan": ['Не оплачено', 'Unpaid'],
  "Mijoz to'lagan": ['Оплатил клиент', 'Paid by client'],
  Aniqlanmagan: ['Не определено', 'Undetermined'],

  // Transport rejimi
  "Mijozning o'z moshinasi": ['Транспорт клиента', "Client's own vehicle"],
  "O'zimiz to'laymiz": ['Оплачиваем сами', 'We pay'],
  'Mijoz hisobiga yoziladi': ['На счёт клиента', 'Charged to client'],

  // To'lov turlari
  "Mijozdan to'lov": ['Оплата от клиента', 'Payment from client'],
  'Mijozga qaytarish': ['Возврат клиенту', 'Refund to client'],
  "Zavodga to'lov": ['Оплата заводу', 'Payment to factory'],
  'Zavoddan qaytim': ['Возврат от завода', 'Refund from factory'],
  "Shofyorga to'lov": ['Оплата водителю', 'Payment to driver'],
  "Mijoz shofyorga to'lagan": ['Клиент оплатил водителю', 'Client paid the driver'],

  // To'lov usullari
  Naqd: ['Наличные', 'Cash'],
  Bank: ['Банк', 'Bank'],
  Karta: ['Карта', 'Card'],
  'Bonus hisobidan': ['Из бонусов', 'From bonus'],

  // Narx turlari
  'Zavod naqd': ['Завод (наличные)', 'Factory (cash)'],
  "Zavod o'tkazma": ['Завод (перечисление)', 'Factory (transfer)'],
  'Sotuv narxi': ['Цена продажи', 'Sale price'],

  // Ledger manbalari
  'Buyurtma savdosi': ['Продажа по заказу', 'Order sale'],
  'Buyurtma tannarxi': ['Себестоимость заказа', 'Order cost'],
  'Tannarx farqi': ['Разница себестоимости', 'Cost adjustment'],
  'Transport haqi': ['Плата за транспорт', 'Transport charge'],
  'Transport xarajati': ['Транспортные расходы', 'Transport cost'],
  "To'lov stornosi": ['Сторно оплаты', 'Payment void'],
  'Buyurtma bekor qilindi': ['Заказ отменён', 'Order cancelled'],
  "Paddon puli (yo'qolgan)": ['Оплата за поддоны (утеряны)', 'Pallet charge (lost)'],
  'Paddon qaytarish krediti': ['Кредит за возврат поддонов', 'Pallet return credit'],
  'Bonusdan yopildi': ['Погашено из бонуса', 'Covered by bonus'],
  'Avansdan yechildi': ['Списано с аванса', 'Drawn from advance'],
  "Tuzatish (qo'lda)": ['Корректировка (вручную)', 'Adjustment (manual)'],
  'Import yozuvi': ['Импортированная запись', 'Import entry'],

  // Ledger tomonlari
  Shofyor: ['Водитель', 'Driver'],

  // Rollar
  Administrator: ['Администратор', 'Administrator'],
  Buxgalter: ['Бухгалтер', 'Accountant'],
  Kassir: ['Кассир', 'Cashier'],

  // Kassa
  Kirim: ['Приход', 'Income'],
  Chiqim: ['Расход', 'Expense'],
  "Qo'lda kiritilgan": ['Введено вручную', 'Manual entry'],
  Xarajat: ['Расход', 'Expense'],
  'Bonus yechish': ['Снятие бонуса', 'Bonus withdrawal'],
  Storno: ['Сторно', 'Reversal'],

  // Valyuta
  "so'm": ['сум', 'sum'],

  // Bonus
  "Dastur yo'q": ['Нет программы', 'No program'],
  'Har m³ uchun': ['За каждый m³', 'Per m³'],
  Foizli: ['Процентная', 'Percentage'],
  Hisoblandi: ['Начислено', 'Accrued'],
  'Naqd yechildi': ['Снято наличными', 'Withdrawn (cash)'],
  "Qarzga o'tkazildi": ['Переведено в долг', 'Moved to debt'],
  Tuzatish: ['Корректировка', 'Adjustment'],

  // Paddon
  'Zavoddan olindi': ['Получено с завода', 'Received from factory'],
  'Mijozga yuborildi': ['Отправлено клиенту', 'Delivered to client'],
  'Mijoz qaytardi': ['Возвращено клиентом', 'Returned by client'],
  'Zavodga qaytarildi': ['Возвращено заводу', 'Returned to factory'],
  "Pulga o'tkazildi (yo'qolgan)": ['Переведено в деньги (утеряно)', 'Charged as lost'],

  // Yuridik shaxs
  'Diler firmasi': ['Фирма дилера', 'Dealer company'],
  'Zavod firmasi': ['Фирма завода', 'Factory company'],
  'Uchinchi tomon': ['Третья сторона', 'Third party'],

  // Audit
  Yaratildi: ['Создано', 'Created'],
  "O'zgartirildi": ['Изменено', 'Updated'],
  "O'chirildi": ['Удалено', 'Deleted'],
  'Bekor qilindi': ['Отменено', 'Voided'],
  "Holat o'zgardi": ['Статус изменён', 'Status changed'],
  'Tannarx qotirildi': ['Себестоимость зафиксирована', 'Cost finalized'],
  Kirish: ['Вход', 'Login'],
  'Kirish xatosi': ['Ошибка входа', 'Login failed'],
  Import: ['Импорт', 'Import'],
  Eksport: ['Экспорт', 'Export'],
  Tekshirilmagan: ['Не сверено', 'Unreconciled'],

  // ── Login / Landing ────────────────────────────────────────────────
  'Tizimga kirish': ['Вход в систему', 'Sign in'],
  'Davom etish uchun login va parolingizni kiriting': [
    'Введите логин и пароль для продолжения',
    'Enter your username and password to continue',
  ],
  Login: ['Логин', 'Username'],
  Parol: ['Пароль', 'Password'],
  'Loginni kiriting': ['Введите логин', 'Enter your username'],
  'Parolni kiriting': ['Введите пароль', 'Enter your password'],
  '⚠ Caps Lock yoqilgan': ['⚠ Включён Caps Lock', '⚠ Caps Lock is on'],
  'Bosh sahifa': ['Главная', 'Home'],
  'Gazoblok diller tizimi': ['Система дилера газоблоков', 'Gas-block dealer system'],
  'Gazoblok biznesini': ['Бизнесом газоблоков', 'Run your gas-block business'],
  'bitta oynadan boshqaring': ['управляйте из одного окна', 'from a single window'],
  'Savdo, qarz, kassa va yetkazib berish — barchasi bir joyda, aniq va real vaqtda.': [
    'Продажи, долги, касса и доставка — всё в одном месте, точно и в реальном времени.',
    'Sales, debts, cash and delivery — all in one place, precise and real-time.',
  ],
  'Buyurtma → zavod → yetkazish → to‘lov — bitta zanjirda': [
    'Заказ → завод → доставка → оплата — в одной цепочке',
    'Order → factory → delivery → payment — in one chain',
  ],
  'Mijoz, agent va zavod qarzlari — har doim aniq qoldiq': [
    'Долги клиентов, агентов и заводов — всегда точный остаток',
    'Client, agent and factory debts — always an exact balance',
  ],
  'Kassa, bank va bonus hamyonlar — jonli balans': [
    'Касса, банк и бонусные кошельки — живой баланс',
    'Cash desk, bank and bonus wallets — a live balance',
  ],
  'Rollar bo‘yicha kirish · to‘liq audit · real vaqtli yangilanish': [
    'Доступ по ролям · полный аудит · обновления в реальном времени',
    'Role-based access · full audit · real-time updates',
  ],

  // ── DataTable / FilterBar chrome (barcha ro'yxat sahifalariga tarqaladi) ──
  'Filtrga mos yozuv topilmadi': ['По фильтру ничего не найдено', 'No matches for the filter'],
  "Hozircha yozuv yo'q": ['Пока нет записей', 'No records yet'],
  'Jami: {n} ta': ['Итого: {n}', 'Total: {n}'],
  "server tartiblashni qo'llab-quvvatlamaydi": ['сервер не поддерживает сортировку', 'server sorting not supported'],
  Yashirish: ['Скрыть', 'Hide'],
  "Ko'rsatish": ['Показать', 'Show'],
  Faqat: ['Только', 'Only'],
  Filtr: ['Фильтр', 'Filter'],
  Tozalash: ['Очистить', 'Clear'],
  Orqaga: ['Назад', 'Back'],
  "Boshqa filtr yo'q": ['Других фильтров нет', 'No more filters'],
  '{label} filtrini olib tashlash': ['Убрать фильтр {label}', 'Remove {label} filter'],

  // ── Umumiy jadval sarlavhalari / atamalar (ko'p sahifalarda uchraydi) ──
  Turi: ['Тип', 'Type'],
  Sabab: ['Причина', 'Reason'],
  Qoldiq: ['Остаток', 'Balance'],
  Balans: ['Баланс', 'Balance'],
  "To'lov usuli": ['Способ оплаты', 'Payment method'],
  Yaratilgan: ['Создан', 'Created'],
  'Sana va vaqt': ['Дата и время', 'Date & time'],
  Kim: ['Кто', 'Who'],
  Hujjat: ['Документ', 'Document'],
  Mahsulot: ['Товар', 'Product'],
  Hajm: ['Объём', 'Volume'],
  "O'lcham": ['Размер', 'Size'],
  Zichlik: ['Плотность', 'Density'],
  Rusum: ['Марка', 'Grade'],
  Soni: ['Кол-во', 'Count'],
  Dona: ['шт', 'pcs'],
  Firma: ['Фирма', 'Company'],
  Viloyat: ['Область', 'Region'],
  Tuman: ['Район', 'District'],
  Ismi: ['Имя', 'Name'],
  Rol: ['Роль', 'Role'],
  Holati: ['Статус', 'Status'],
  Boshlanish: ['Начало', 'Start'],
  Tugash: ['Конец', 'End'],
  Muddat: ['Срок', 'Due date'],
  Kunlar: ['Дней', 'Days'],
  Foiz: ['Процент', 'Percent'],
  Qolgan: ['Осталось', 'Remaining'],
  Izohlar: ['Примечания', 'Notes'],
  Amal: ['Действие', 'Action'],

  // ── Umumiy amal tugmalari ──
  "Qo'shish": ['Добавить', 'Add'],
  "O'chirish": ['Удалить', 'Delete'],
  "Ko'rish": ['Просмотр', 'View'],
  'Yuklab olish': ['Скачать', 'Download'],
  'Chop etish': ['Печать', 'Print'],
  Tasdiqlash: ['Подтвердить', 'Confirm'],
  Batafsil: ['Подробнее', 'Details'],
  "Ma'lumot topilmadi": ['Данные не найдены', 'No data found'],
  'Yuklanmoqda…': ['Загрузка…', 'Loading…'],
};

// ── Dashboard / Landing / CommandPalette (2026-07-16 to'liq tarjima) ──
// Alohida obyekt — RAW bilan kalit takrorlansa TS xato bermaydi (merge overwrite).
const RAW2: Record<string, [string, string]> = {
  // Dashboard — inline / KPI / band / tooltip
  kamomad: ['недостача', 'shortfall'],
  kirim: ['приход', 'in'],
  chiqim: ['расход', 'out'],
  'UZS jami': ['UZS всего', 'UZS total'],
  'USD jami': ['USD всего', 'USD total'],
  Davr: ['Период', 'Period'],
  'Boshlanish sanasi': ['Дата начала', 'Start date'],
  'Tugash sanasi': ['Дата окончания', 'End date'],
  "Qo'llash": ['Применить', 'Apply'],
  '{n} kun': ['{n} дн.', '{n} days'],
  Toshkent: ['Ташкент', 'Tashkent'],
  buyurtma: ['заказ', 'order'],
  mijoz: ['клиент', 'client'],
  Transport: ['Транспорт', 'Transport'],
  ta: ['шт', 'pcs'],
  Kassalar: ['Кассы', 'Cash desks'],
  'Kassa →': ['Касса →', 'Cash desk →'],
  'To‘liq →': ['Полностью →', 'Full →'],
  "To'liq →": ['Полностью →', 'Full →'],
  'Buyurtmalar →': ['Заказы →', 'Orders →'],
  'Hammasi →': ['Все →', 'All →'],
  'Mening ko‘rsatkichlarim →': ['Мои показатели →', 'My metrics →'],
  "Mening ko'rsatkichlarim →": ['Мои показатели →', 'My metrics →'],
  'Savdo va tushum': ['Продажи и поступления', 'Sales and collections'],
  Savdo: ['Продажи', 'Sales'],
  savdo: ['продажи', 'sales'],
  Tushum: ['Поступления', 'Collections'],
  tushum: ['поступления', 'collections'],
  "Yig'ilgan": ['Собрано', 'Collected'],
  "Barcha davrlar Toshkent taqvimi bo'yicha": [
    'Все периоды по ташкентскому календарю',
    'All periods by the Tashkent calendar',
  ],
  "Qarzdorlik — hozirgi qoldiq (tanlangan oydan qat'i nazar, faqat musbat qoldiqlar)": [
    'Задолженность — текущий остаток (независимо от выбранного месяца, только положительные остатки)',
    'Debt — current balance (regardless of the selected month, positive balances only)',
  ],
  'Agentlar reytingi': ['Рейтинг агентов', 'Agent ranking'],
  'Oldingi oy': ['Предыдущий месяц', 'Previous month'],
  'Keyingi oy': ['Следующий месяц', 'Next month'],
  'Qarz limiti': ['Лимит долга', 'Debt limit'],
  "Band = mijozlaringizning musbat qoldiqlari yig'indisi. Bir mijozning avansi boshqasining qarzini yopmaydi.": [
    'Занято = сумма положительных остатков ваших клиентов. Аванс одного клиента не покрывает долг другого.',
    "Used = the sum of your clients' positive balances. One client's advance does not cover another's debt.",
  ],
  "Limit to'lgan — yangi qarzli buyurtma bloklanadi": [
    'Лимит исчерпан — новый заказ в долг блокируется',
    'Limit reached — new debt orders are blocked',
  ],
  '14 kunlik trend': ['14-дневный тренд', '14-day trend'],
  "To'lov qabul qilish": ['Принять оплату', 'Accept payment'],
  "Zavodga to'lash": ['Оплатить заводу', 'Pay the factory'],
  "Shofyorga to'lash": ['Оплатить водителю', 'Pay the driver'],
  'Butun davr: Σ kirim − Σ chiqim': ['За весь период: Σ приход − Σ расход', 'Whole period: Σ in − Σ out'],
  Bonus: ['Бонус', 'Bonus'],
  Vaqt: ['Время', 'Time'],
  "Yo'nalish": ['Направление', 'Direction'],
  Kvitansiya: ['Квитанция', 'Receipt'],
  'Hujjatni ochish': ['Открыть документ', 'Open document'],
  'Bugungi amallar': ['Сегодняшние операции', "Today's operations"],
  taxminiy: ['ориентировочно', 'estimated'],

  // Dashboard — StatCard / CompactStat / Band labels
  'Davr savdosi': ['Продажи за период', 'Period sales'],
  'Sof foyda': ['Чистая прибыль', 'Net profit'],
  "Yig'ilgan to'lov": ['Собранные платежи', 'Collected payments'],
  'Yig‘ilgan to‘lov': ['Собранные платежи', 'Collected payments'],
  "Yig'ilgan to'lov (oy)": ['Собранные платежи (месяц)', 'Collected payments (month)'],
  'Bugungi savdo': ['Продажи за сегодня', "Today's sales"],
  'Mijozlar qarzi': ['Долг клиентов', "Clients' debt"],
  // NET client balance (debts − advances) — replaced the «qarzi» wording on the cards
  'Mijozlar balansi': ['Баланс клиентов', 'Clients balance'],
  'Mijozlarim balansi': ['Баланс моих клиентов', "My clients' balance"],
  "Mijozlardan sof tushum — to'lovlardan qaytarilgan/ushlab qolingan summalar ayirilgan (tanlangan davr)": [
    'Чистые поступления от клиентов — за вычетом возвратов/удержаний (выбранный период)',
    'Net receipts from clients — refunds/deductions subtracted (selected period)',
  ],
  "Mijozlar balansi — qarzlardan avanslar ayirilgan sof qiymat (daftardagi «Ост»); manfiy bo'lsa umumiy avans": [
    'Баланс клиентов — долги минус авансы («Ост» в тетради); отрицательное значение = общий аванс',
    'Clients balance — debts minus advances (the daftar «Ост»); negative means a net advance',
  ],
  'Zavodlarga qarzimiz': ['Наш долг заводам', 'We owe factories'],
  'Shofyorlarga qarzimiz': ['Наш долг водителям', 'We owe drivers'],
  'Oy savdosi': ['Продажи за месяц', 'Month sales'],
  'Mijozlarim qarzi': ['Долг моих клиентов', "My clients' debt"],
  'Yil savdosi': ['Продажи за год', 'Year sales'],
  "Yo'ldagi buyurtmalar": ['Заказы в пути', 'Orders in transit'],
  'Mijozlardagi paddonlar': ['Поддоны у клиентов', 'Pallets at clients'],
  'Sotilgan hajm (oy)': ['Проданный объём (месяц)', 'Volume sold (month)'],
  'Davr natijasi': ['Итог периода', 'Period result'],
  // Dashboard — «Aniqlanmagan» (PROFIT RULE): to'lov usuli aniq bo'lmagan va hali
  // hisob-kitob qilinmagan buyurtmalar sof foydaga kirmaydi, diapazon bilan turadi.
  'Aniqlanmagan foyda': ['Неопределённая прибыль', 'Undetermined profit'],
  "to'lov usuli aniq bo'lmagani uchun bu buyurtmalarning foydasi hali aniq emas": [
    'способ оплаты не определён, поэтому прибыль по этим заказам пока неизвестна',
    'the pay method is not decided yet, so the profit on these orders is not known',
  ],
  "Zavod tannarxi: naqd {cash} · o'tkazma {bank}": [
    'Себестоимость завода: наличные {cash} · перевод {bank}',
    'Factory cost: cash {cash} · transfer {bank}',
  ],
  '{n} ta buyurtma sanalmadi — foydasi aniq emas': [
    '{n} заказ(ов) не учтено — прибыль не определена',
    '{n} order(s) not counted — profit undetermined',
  ],
  'Qarz va balanslar': ['Долги и балансы', 'Debts and balances'],
  Tahlil: ['Аналитика', 'Analytics'],
  Kassa: ['Касса', 'Cash desk'],

  // Dashboard — CardTip tooltips
  'Bekor qilinmagan buyurtmalar savdosi (tanlangan davr)': [
    'Продажи по неотменённым заказам (выбранный период)',
    'Sales of non-cancelled orders (selected period)',
  ],
  "Sof foyda = Mahsulot foydasi + Transport foydasi (tanlangan davr). Faqat to'lov usuli aniq buyurtmalar sanaladi. Ochiq tannarxlar bo'lsa taxminiy.": [
    'Чистая прибыль = прибыль от товара + прибыль от транспорта (выбранный период). Считаются только заказы с определённым способом оплаты. При открытых себестоимостях — ориентировочно.',
    'Net profit = goods profit + transport profit (selected period). Only orders with a determined pay method are counted. Estimated while costs are still open.',
  ],
  "Faqat CLIENT_IN, bekor qilinmagan to'lovlar (tanlangan davr)": [
    'Только CLIENT_IN, неотменённые платежи (выбранный период)',
    'Only CLIENT_IN, non-voided payments (selected period)',
  ],
  'Bugungi bekor qilinmagan savdo': ['Сегодняшние неотменённые продажи', "Today's non-cancelled sales"],
  "Faqat musbat qoldiqlar yig'indisi — bir mijozning avansi boshqasining qarzini yopmaydi": [
    'Сумма только положительных остатков — аванс одного клиента не покрывает долг другого',
    "Sum of positive balances only — one client's advance does not cover another's debt",
  ],
  "Faqat manfiy zavod qoldiqlari, musbat qilib ko'rsatilgan": [
    'Только отрицательные остатки заводов, показаны как положительные',
    'Only negative factory balances, shown as positive',
  ],
  "Faqat manfiy shofyor qoldiqlari, musbat qilib ko'rsatilgan": [
    'Только отрицательные остатки водителей, показаны как положительные',
    'Only negative driver balances, shown as positive',
  ],
  'Bonus hamyonlar jami (zavod → diller chegirma hamyoni)': [
    'Итого бонусные кошельки (завод → кошелёк скидок дилера)',
    'Total bonus wallets (factory → dealer discount wallet)',
  ],

  // Dashboard — PageHeader subtitles / actions / deltas / empty states
  "Biznes ko'rsatkichlari, qarzlar va e'tibor markazi": [
    'Бизнес-показатели, долги и центр внимания',
    'Business metrics, debts and focus',
  ],
  "Mening mijozlarim, qarzlar va yig'im": ['Мои клиенты, долги и сборы', 'My clients, debts and collections'],
  "Tez kassa amallari va to'lovlar": ['Быстрые кассовые операции и платежи', 'Quick cash operations and payments'],
  'Yangi buyurtma': ['Новый заказ', 'New order'],
  "o'tgan oyning shu davriga nisbatan": [
    'по сравнению с тем же периодом прошлого месяца',
    'vs the same period last month',
  ],
  'kechaga nisbatan': ['по сравнению со вчера', 'vs yesterday'],
  'Faol kassalar topilmadi': ['Активные кассы не найдены', 'No active cash desks found'],
  "Bu oyda ma'lumot yo'q": ['За этот месяц нет данных', 'No data for this month'],
  "Bugun hali amal yo'q": ['Сегодня ещё нет операций', 'No operations yet today'],

  // CommandPalette
  "Qidiruv… (mijoz, buyurtma, to'lov, amal, sahifa)": [
    'Поиск… (клиент, заказ, платёж, действие, страница)',
    'Search… (client, order, payment, action, page)',
  ],
  tanlash: ['выбрать', 'select'],
  ochish: ['открыть', 'open'],
  yopish: ['закрыть', 'close'],
  'Hech narsa topilmadi': ['Ничего не найдено', 'Nothing found'],
  'Hisob yopiq': ['Счёт закрыт', 'Account settled'],
  "So'nggi": ['Недавние', 'Recent'],
  Sahifalar: ['Страницы', 'Pages'],
  Yozuvlar: ['Записи', 'Records'],
  'Paddon qaytarish qabul qilish': ['Принять возврат поддонов', 'Accept pallet return'],

  // Landing — nav / hero / mockup
  Modullar: ['Модули', 'Modules'],
  'Qarz zanjiri': ['Цепочка долгов', 'Debt chain'],
  'Ish jarayoni': ['Рабочий процесс', 'Workflow'],
  Xavfsizlik: ['Безопасность', 'Security'],
  Aloqa: ['Контакты', 'Contact'],
  'Ishlab chiquvchi': ['Разработчик', 'Developed by'],
  'Gazoblok diller uchun ERP': ['ERP для дилеров газоблоков', 'ERP for gas-block dealers'],
  'Gazoblok savdosini': ['Продажами газоблоков', 'Gas-block sales'],
  'bitta tizimda boshqaring': ['управляйте в одной системе', 'manage in one system'],
  'Buyurtmadan to‘lovgacha bo‘lgan butun zanjir — savdo, qarz, kassa va yetkazib berish. Har bir so‘m aniq, har bir raqam bosiladigan eshik.': [
    'Вся цепочка от заказа до оплаты — продажи, долги, касса и доставка. Каждый сум точен, каждое число — открывающаяся дверь.',
    'The whole chain from order to payment — sales, debts, cash and delivery. Every sum is exact, every number a door you can open.',
  ],
  'Modullarni ko‘rish': ['Смотреть модули', 'View modules'],
  'Rollar bo‘yicha': ['По ролям', 'By role'],
  'Real vaqt': ['Реальное время', 'Real time'],
  'Ish stoli — SmartBlok': ['Рабочий стол — SmartBlok', 'Dashboard — SmartBlok'],
  Demo: ['Демо', 'Demo'],
  '● Savdo': ['● Продажи', '● Sales'],
  '● Tushum': ['● Поступления', '● Collections'],
  'Kassa balansi': ['Баланс кассы', 'Cash balance'],
  Modul: ['Модуль', 'Module'],
  Status: ['Статус', 'Status'],
  Valyuta: ['Валюта', 'Currency'],
  'To‘lovlar': ['Платежи', 'Payments'],
  modul: ['модулей', 'modules'],
  rol: ['ролей', 'roles'],
  daraja: ['уровень', 'level'],

  // Landing — sections
  'Kerakli hamma narsa — ortiqchasiz': ['Всё нужное — без лишнего', 'Everything you need — nothing extra'],
  'Gazoblok biznesining har bir bo‘limi bitta tizimda. Soxta modul yo‘q — faqat kunlik ishga keragi.': [
    'Каждый отдел газоблок-бизнеса в одной системе. Никаких лишних модулей — только нужное для ежедневной работы.',
    'Every part of the gas-block business in one system. No fake modules — only what daily work needs.',
  ],
  'Asosiy farq': ['Ключевое отличие', 'The key difference'],
  'Qarz zanjiri — har doim aniq qoldiq': ['Цепочка долгов — всегда точный остаток', 'Debt chain — always an exact balance'],
  'markazida uch tomonlama qarz hisobi turadi. Kim kimga, qancha qarzdor — hech qachon chalkashmaydi.': [
    ' — в центре трёхсторонний учёт долгов. Кто кому и сколько должен — никогда не путается.',
    ' — at its center is a three-way debt ledger. Who owes whom, and how much — never gets confused.',
  ],
  'Buyurtma real hajm bilan zavoddan chiqqanda, uch daraja ham avtomatik qayta hisoblanadi — qo‘lda tuzatish shart emas.': [
    'Когда заказ выходит с завода с реальным объёмом, все три уровня пересчитываются автоматически — ручная правка не нужна.',
    'When an order leaves the factory with its real volume, all three levels recompute automatically — no manual fixing.',
  ],
  'Buyurtma yo‘li — boshidan oxirigacha': ['Путь заказа — от начала до конца', "The order's path — from start to finish"],
  'Har bir buyurtma aniq bosqichlardan o‘tadi. Doskada qaysi buyurtma qayerdaligi bir qarashda ko‘rinadi.': [
    'Каждый заказ проходит чёткие этапы. На доске сразу видно, где какой заказ.',
    'Every order goes through clear stages. The board shows at a glance where each order is.',
  ],
  Rollar: ['Роли', 'Roles'],
  'Har kim o‘z ishida': ['Каждый при своём деле', 'Everyone in their own role'],
  'To‘rt rol — har biri o‘ziga kerakli ko‘rinish va ruxsat bilan. Ortiqcha narsa ko‘rinmaydi.': [
    'Четыре роли — у каждой свой вид и права. Лишнее не показывается.',
    'Four roles — each with its own view and permissions. Nothing extra is shown.',
  ],
  'Ishonch va xavfsizlik': ['Надёжность и безопасность', 'Trust and security'],
  'Har bir so‘m — hisobdor': ['Каждый сум — под учётом', 'Every sum is accounted for'],
  'Pul harakati o‘chirilmaydigan ledgerga yoziladi, balans esa doim yozuvlardan hisoblanadi. Ishonchli, tekshiriladigan, adashmaydigan.': [
    'Движение денег пишется в неизменяемый реестр, а баланс всегда считается из записей. Надёжно, проверяемо, без ошибок.',
    'Money movements are written to an immutable ledger, and the balance is always computed from entries. Reliable, auditable, error-free.',
  ],
  'Gazoblok biznesingizni tartibga soling': ['Наведите порядок в газоблок-бизнесе', 'Bring order to your gas-block business'],
  'Bugundan boshlab har bir buyurtma, to‘lov va qarz — bitta tizimda, aniq va nazorat ostida.': [
    'С сегодняшнего дня каждый заказ, платёж и долг — в одной системе, точно и под контролем.',
    'From today, every order, payment and debt — in one system, precise and under control.',
  ],
  'Gazoblok dillerlari uchun to‘liq ERP — savdo, qarz, kassa va yetkazib berish bitta joyda.': [
    'Полный ERP для дилеров газоблоков — продажи, долги, касса и доставка в одном месте.',
    'A complete ERP for gas-block dealers — sales, debts, cash and delivery in one place.',
  ],

  // Landing — MODULES descriptions
  'Trend va hisobot': ['Тренды и отчёты', 'Trends and reports'],
  "Buyurtma yaratilgan payti yakunlanadi — qarz, tannarx va bonus o'sha zahoti yoziladi. To'langan va to'lanmaganlar alohida tab.": [
    'Заказ завершается в момент создания — долг, себестоимость и бонус записываются сразу. Оплаченные и неоплаченные — отдельными вкладками.',
    'An order is final the moment it is created — debt, cost and bonus post at once. Paid and unpaid live in separate tabs.',
  ],
  'Balans, kredit limiti, akt-sverka va to‘lov tarixi — bitta kartada.': [
    'Баланс, кредитный лимит, акт-сверка и история платежей — в одной карточке.',
    'Balance, credit limit, reconciliation and payment history — on one card.',
  ],
  'Sotuvchilar, qarz limiti, oylik reyting va sof foyda hisobi.': [
    'Продавцы, лимит долга, месячный рейтинг и учёт чистой прибыли.',
    'Sellers, debt limit, monthly ranking and net-profit accounting.',
  ],
  'Kirim/chiqim reestri, avanslarni buyurtmalarga taqsimlash.': [
    'Реестр приход/расход, распределение авансов по заказам.',
    'In/out register, allocating advances to orders.',
  ],
  'Kim kimga qarzdor — eng muddati o‘tganidan boshlab yig‘ish.': [
    'Кто кому должен — сбор начиная с самых просроченных.',
    'Who owes whom — collect starting from the most overdue.',
  ],
  'Naqd, bank, Click, terminal — har bir kassaning jonli balansi.': [
    'Наличные, банк, Click, терминал — живой баланс каждой кассы.',
    'Cash, bank, Click, terminal — a live balance for each cash desk.',
  ],
  'Yetkazib beruvchilar bilan hisob-kitob va tannarx nazorati.': [
    'Взаиморасчёты с поставщиками и контроль себестоимости.',
    'Settlements with suppliers and cost control.',
  ],
  'Narx darajalari (naqd/o‘tkazma/sotuv) va zavod tannarxi.': [
    'Уровни цен (наличные/перечисление/продажа) и заводская себестоимость.',
    'Price tiers (cash/transfer/sale) and factory cost.',
  ],
  'Zavod bonuslari hisobi, yechish va qarzdan yopish.': [
    'Учёт заводских бонусов, снятие и погашение долга.',
    'Factory bonus accounting, withdrawal and debt offset.',
  ],
  'Mijoz va zavoddagi paddon qoldig‘i, qaytarish jurnali.': [
    'Остаток поддонов у клиента и на заводе, журнал возвратов.',
    'Pallet balances at clients and factories, and a return log.',
  ],
  'Transport, sig‘im, shofyor qarzi va yo‘nalishlar.': [
    'Транспорт, вместимость, долг водителя и маршруты.',
    'Transport, capacity, driver debt and routes.',
  ],
  'Savdo, tushum va foyda trendlari — Toshkent taqvimi bo‘yicha.': [
    'Тренды продаж, поступлений и прибыли — по ташкентскому календарю.',
    'Sales, collection and profit trends — by the Tashkent calendar.',
  ],

  // Landing — NODES / LEVELS
  Diller: ['Дилер', 'Dealer'],
  'Yetkazib beruvchi': ['Поставщик', 'Supplier'],
  'Siz — markaz': ['Вы — центр', 'You — the hub'],
  Sotuvchi: ['Продавец', 'Seller'],
  Xaridor: ['Покупатель', 'Buyer'],
  'Mijoz qarzi': ['Долг клиента', 'Client debt'],
  'Zavodga qarz': ['Долг заводу', 'Debt to factory'],
  'Mijoz sotuv narxida qarzdor. Bir mijozning avansi boshqasining qarzini yopmaydi.': [
    'Клиент должен по цене продажи. Аванс одного клиента не покрывает долг другого.',
    "The client owes at the sale price. One client's advance does not cover another's debt.",
  ],
  'Diller zavod narxida qarzdor — real chiqqan hajm bo‘yicha aniqlanadi.': [
    'Дилер должен по заводской цене — определяется по реально вышедшему объёму.',
    'The dealer owes at the factory price — determined by the actual dispatched volume.',
  ],
  'Shofyor xizmati alohida track — savdo zanjiriga aralashmaydi.': [
    'Услуга водителя — отдельный трек, не вмешивается в цепочку продаж.',
    "The driver's service is a separate track — it doesn't mix into the sales chain.",
  ],

  // Landing — ROLES descriptions
  'To‘liq nazorat: sozlamalar, foydalanuvchilar, barcha modullar.': [
    'Полный контроль: настройки, пользователи, все модули.',
    'Full control: settings, users, all modules.',
  ],
  'Moliya, qarzlar, kassa va zavodlar bilan hisob-kitob.': [
    'Финансы, долги, касса и взаиморасчёты с заводами.',
    'Finance, debts, cash and settlements with factories.',
  ],
  'O‘z mijozlari, buyurtmalari va qarz limiti — telefonga moslashgan.': [
    'Свои клиенты, заказы и лимит долга — адаптировано для телефона.',
    'Own clients, orders and debt limit — adapted for mobile.',
  ],
  'Kassa terminali: to‘lov qabul qilish va rasmiylashtirish.': [
    'Кассовый терминал: приём и оформление платежей.',
    'Cash terminal: accepting and recording payments.',
  ],

  // Landing — SECURITY
  'Ledger asosida': ['На основе реестра', 'Ledger-based'],
  'To‘liq audit': ['Полный аудит', 'Full audit'],
  'Rollar bo‘yicha kirish': ['Доступ по ролям', 'Role-based access'],
  'Ikki valyuta': ['Две валюты', 'Two currencies'],
  'Balans hech qachon saqlanmaydi — har doim yozuvlar yig‘indisidan. O‘zgartirib bo‘lmaydi.': [
    'Баланс никогда не хранится — всегда из суммы записей. Изменить нельзя.',
    'The balance is never stored — always from the sum of entries. It cannot be altered.',
  ],
  'Har bir amal kim, qachon, nima o‘zgartirganini yozib boradi.': [
    'Каждое действие фиксирует, кто, когда и что изменил.',
    'Every action records who changed what and when.',
  ],
  'Har kim faqat o‘ziga tegishlisini ko‘radi. Agent zavod tannarxini ko‘rmaydi.': [
    'Каждый видит только своё. Агент не видит заводскую себестоимость.',
    "Everyone sees only what's theirs. An agent can't see the factory cost.",
  ],
  'UZS va USD — kurs bilan, hech qachon aralashtirilmaydi.': [
    'UZS и USD — по курсу, никогда не смешиваются.',
    'UZS and USD — with a rate, never mixed.',
  ],
};

// ── Qamrov bo'shlig'i (2026-07-20) ────────────────────────────────────────
// t() bilan o'ralgan, lekin lug'atda hech qachon bo'lmagan matnlar: ru/en da
// ular o'zbek lotin ko'rinishida "sizib" chiqardi (i18n.ts:60 fallback).
// Ko'p qismi mobil ishida hardcode holatidan t() ga o'tkazilgan — eng ko'rinadigani
// LiveBadge: u HAR BIR sahifada TopBar'da turadi.
const RAW3: Record<string, [string, string]> = {
  '{n} dona': ['{n} шт.', '{n} pcs'],
  '{n} paddon ortiqcha': ['{n} поддонов сверх нормы', '{n} pallets over capacity'],
  '{n} paddon ortiqcha — server rad etadi': [
    '{n} поддонов сверх нормы — сервер отклонит',
    '{n} pallets over capacity — the server will reject',
  ],
  'Limitdan oshgan: {sum}': ['Превышение лимита: {sum}', 'Over limit: {sum}'],
  'Limit: {sum}': ['Лимит: {sum}', 'Limit: {sum}'],
  'Band: {sum}': ['Занято: {sum}', 'Used: {sum}'],
  "Faqat oldindan to'lov": ['Только предоплата', 'Prepayment only'],
  "Bo'sh: {sum}": ['Свободно: {sum}', 'Available: {sum}'],
  Tanlash: ['Выбрать', 'Select'],
  "Toshkent kuni bo'yicha": ['По ташкентскому дню', 'By Tashkent day'],
  Filtrlar: ['Фильтры', 'Filters'],
  Jonli: ['В эфире', 'Live'],
  'Ulanmoqda…': ['Подключение…', 'Connecting…'],
  Oflayn: ['Офлайн', 'Offline'],
  'Oxirgi yangilanish: {time}': ['Последнее обновление: {time}', 'Last update: {time}'],
  'Hali yangilanish kelmadi': ['Обновлений пока не было', 'No update has arrived yet'],
  'Ulanish holati': ['Состояние соединения', 'Connection status'],
  "Oflayn — ma'lumot {time} holatiga": ['Офлайн — данные на {time}', 'Offline — data as of {time}'],
  Kurs: ['Курс', 'Rate'],
  'USD summa va kursni kiriting': ['Введите сумму в USD и курс', 'Enter the USD amount and the rate'],
  "Chegara: {sum} so'm": ['Предел: {sum} сум', 'Cap: {sum} sum'],
  "Ko'pi bilan: {sum} so'm": ['Не более: {sum} сум', 'At most: {sum} sum'],
  '{n} paddon': ['{n} поддонов', '{n} pallets'],
  '{n} ta mijoz': ['{n} клиентов', '{n} clients'],
  '… yana {n} ta — qidiruvni aniqlashtiring': ['… ещё {n} — уточните поиск', '… {n} more — refine the search'],
  '… natijalar cheklangan — qidiruvni aniqlashtiring': [
    '… результаты ограничены — уточните поиск',
    '… results are limited — refine the search',
  ],
  'Avtomatik taqsimlandi (eng eski buyurtmadan)': [
    'Распределено автоматически (с самого старого заказа)',
    'Auto-allocated (oldest order first)',
  ],
  "Ko'rinishni o'chirish": ['Удалить вид', 'Delete view'],
  "«{name}» ko'rinishi o'chiriladi.": ['Вид «{name}» будет удалён.', 'The «{name}» view will be deleted.'],
  "{n} ta muddati o'tgan": ['{n} просрочено', '{n} overdue'],
  'Umumiy hisobot': ['Общий отчёт', 'Overall report'],
  Yalpi: ['Валовая', 'Gross'],
  'Butun davr — Excel bilan tasdiqlangan': ['Весь период — сверено с Excel', 'All time — verified against Excel'],
  'Bazaga yozildi ✓ — butun baza shu fayl bilan almashtirildi': [
    'Записано в базу ✓ — вся база заменена этим файлом',
    'Committed ✓ — the entire database was replaced with this file',
  ],
  'Butun bazani almashtirish?': ['Заменить всю базу?', 'Replace the entire database?'],
  'Maʼlumotlar bazasiga qoʼshish?': ['Добавить в базу данных?', 'Append to the database?'],
  'DIQQAT: butun maʼlumotlar bazasi (buyurtma, mijoz, agent, zavod, toʼlov, kassa, ledger, poddon — hammasi) oʼchiriladi va faqat shu fayldan qayta quriladi. Login foydalanuvchilar va sozlamalar saqlanadi. Qaytarib boʼlmaydi.': [
    'ВНИМАНИЕ: вся база данных (заказы, клиенты, агенты, заводы, платежи, касса, реестр, поддоны — всё) будет удалена и заново построена только из этого файла. Пользователи и настройки сохранятся. Отменить нельзя.',
    'WARNING: the entire database (orders, clients, agents, factories, payments, cash desk, ledger, pallets — everything) is deleted and rebuilt from this file alone. Login users and settings are kept. This cannot be undone.',
  ],
  '{n} ta avvalgi import ham oʼchadi': [
    '{n} предыдущих импортов также будут удалены',
    '{n} earlier imports will be deleted too',
  ],
  'Maʼlumot mavjudlarning ustiga qoʼshiladi (avvalgilari saqlanadi).': [
    'Данные будут добавлены к существующим (прежние сохранятся).',
    'The data is appended on top of what exists (earlier records are kept).',
  ],
  'Ha, butun bazani almashtirish': ['Да, заменить всю базу', 'Yes, replace the entire database'],
  'Ha, qoʼshish': ['Да, добавить', 'Yes, append'],
  'butun baza oʼchirilib, shu fayldan qayta quriladi': [
    'вся база будет удалена и заново построена из этого файла',
    'the entire database is wiped and rebuilt from this file',
  ],
  'mavjud maʼlumot ustiga qoʼshiladi': [
    'добавляется поверх существующих данных',
    'appended on top of the existing data',
  ],
  'Ustiga qoʼshish': ['Добавить сверху', 'Append'],
  'Toʼliq almashtirish': ['Полная замена', 'Full replace'],
  'Qoldiq: {a} {c}': ['Остаток: {a} {c}', 'Balance: {a} {c}'],
  'Boshqa kassani tanlang': ['Выберите другую кассу', 'Choose a different cashbox'],
  'Haqiqiy naqd qoldiq': ['Фактический остаток наличных', 'Actual cash balance'],
  'kassa hech qachon minusga tushmaydi': ['касса никогда не уходит в минус', 'the cash desk never goes negative'],
  'Bu davr kirim': ['Приход за период', 'Inflow this period'],
  'Bu davr chiqim': ['Расход за период', 'Outflow this period'],
  "O'tkazma bajarildi": ['Перевод выполнен', 'Transfer completed'],
  "Kassalar o'rtasida o'tkazma": ['Перевод между кассами', 'Transfer between cash desks'],
  'Sotuvdan tannarx va transport ayirilgach qolgan foyda — kassaga tushadi': [
    'Прибыль, остающаяся после вычета себестоимости и транспорта из продажи — поступает в кассу',
    'The profit left after cost and transport are deducted from the sale — it lands in the cash desk',
  ],
  'yuk chiqqach hisoblanadi': ['рассчитывается после отгрузки', 'calculated once the load ships'],
  'To‘langan': ['Оплачено', 'Paid'],
  Yopildi: ['Закрыт', 'Closed'],
  "Pozitsiyalar yo'q": ['Позиций нет', 'No line items'],
  Ortga: ['Назад', 'Back'],
  'BEKOR QILINGAN': ['ОТМЕНЕНО', 'VOIDED'],
  Yozib: ['Прописью', 'In words'],
  'Taqsimlangan buyurtmalar': ['Распределённые заказы', 'Allocated orders'],
  Topshirdi: ['Сдал', 'Handed over by'],
  'Qabul qildi': ['Принял', 'Received by'],
  'SmartBlok tizimi orqali chiqarildi': ['Выдано через систему SmartBlok', 'Issued through the SmartBlok system'],
  "TO'LOV KVITANSIYASI": ['КВИТАНЦИЯ ОБ ОПЛАТЕ', 'PAYMENT RECEIPT'],
};

export const DICT: Record<string, { ru: string; en: string }> = {};
for (const key of Object.keys(RAW)) {
  DICT[key] = { ru: RAW[key][0], en: RAW[key][1] };
}
for (const key of Object.keys(RAW2)) {
  DICT[key] = { ru: RAW2[key][0], en: RAW2[key][1] };
}
for (const key of Object.keys(RAW3)) {
  DICT[key] = { ru: RAW3[key][0], en: RAW3[key][1] };
}

for (const part of [P_orders, P_parties, P_catalog, P_finance, P_treasury, P_admin, P_comp1, P_comp2]) {
  for (const key of Object.keys(part)) {
    DICT[key] = { ru: part[key][0], en: part[key][1] };
  }
}
