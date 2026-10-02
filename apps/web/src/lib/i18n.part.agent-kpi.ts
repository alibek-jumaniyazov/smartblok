export const PART: Record<string, [string, string]> = {
  'Agent KPI': ['KPI агента', 'Agent KPI'],
  'KPI oyi': ['Месяц KPI', 'KPI month'],
  'Oylik KPI': ['KPI за месяц', 'Monthly KPI'],
  'Kunlik KPI': ['KPI по дням', 'Daily KPI'],
  'Umumiy KPI': ['KPI за весь период', 'Lifetime KPI'],
  'KPI sozlamalari': ['Настройки KPI', 'KPI settings'],
  'KPI sozlamalari saqlandi': ['Настройки KPI сохранены', 'KPI settings saved'],
  'Barcha agentlar': ['Все агенты', 'All agents'],
  'Hajm (m³)': ['Объём (м³)', 'Volume (m³)'],
  'Transportdan keyingi foyda': ['Прибыль после транспорта', 'Profit after transport'],
  'Soliq': ['Налог', 'Tax'],
  'Firma ulushi': ['Доля компании', 'Company share'],
  'Agent ulushi': ['Доля агента', 'Agent share'],
  'Bir kub uchun soliq': ['Налог за один кубометр', 'Tax per cubic metre'],
  'Bu davrda yuklar yo‘q': ['За этот период отгрузок нет', 'No shipments in this period'],
  'Sof foyda = sotuv − tannarx − transport − soliq. Agent KPI = sof foyda × agent ulushi. To‘lov holati hisobga ta’sir qilmaydi.': [
    'Чистая прибыль = продажа − себестоимость − транспорт − налог. KPI агента = чистая прибыль × доля агента. Расчёт не зависит от оплаты.',
    'Net profit = sales − cost − transport − tax. Agent KPI = net profit × agent share. Payment status does not affect the calculation.',
  ],
  'KPI mijozga hozir biriktirilgan agent bo‘yicha hisoblanadi.': [
    'KPI относится к агенту, который сейчас закреплён за клиентом.',
    'KPI is attributed to the agent currently assigned to the client.',
  ],
  'Stavkalar barcha agentlar va davrlar uchun amal qiladi. Import tasdiqlanganda fayldagi KPI stavkalari qo‘llanadi.': [
    'Ставки действуют для всех агентов и периодов. После подтверждения импорта применяются ставки KPI из файла.',
    'Rates apply to all agents and periods. Confirming an import applies the KPI rates from the workbook.',
  ],
  'Import bilan agent KPI stavkalari ham saqlanadi': ['При импорте сохранятся и ставки KPI агентов', 'The import also saves agent KPI rates'],
  'Smartblok shablonidagi yuklar, to‘lovlar, poddonlar, mijozlar qoldig‘i va agent KPI bir faylda. Qo‘shimcha varaqlarda kassa, narxlar va bosh daftar tafsilotlari saqlanadi.': [
    'Отгрузки, платежи, поддоны, остатки клиентов и KPI агентов по шаблону Smartblok в одном файле. Дополнительные листы содержат кассу, цены и главную книгу.',
    'Shipments, payments, pallets, client balances and agent KPI in the Smartblok template. Additional sheets retain cash, pricing and ledger details.',
  ],
  'Smartblok .xlsb yoki .xlsx · 10 MB gacha. Fayl darhol bazaga yozilmaydi — avval ko‘rib chiqasiz.': [
    'Smartblok .xlsb или .xlsx · до 10 МБ. Перед записью в базу вы проверите файл.',
    'Smartblok .xlsb or .xlsx · up to 10 MB. Review the file before it is saved to the database.',
  ],
  'Shablon jadvallari — butun tarix. Sana oralig‘i batafsil hisobotlarga, oxirgi oy esa KPI ga qo‘llanadi.': [
    'Таблицы шаблона содержат всю историю. Даты ограничивают подробные отчёты; последний месяц применяется к KPI.',
    'Template tables contain full history. The date range filters detailed reports; its final month selects the KPI month.',
  ],
};
