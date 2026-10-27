# Система газаблок.xlsb — import tekshiruvi (2026-10-28)

Foydalanuvchi bergan `Downloads/Система газаблок (1).xlsb` o‘zgartirilmasdan `docs/Система газаблок.xlsb` ga nusxalandi.
Hajmi 275 213 bayt, SHA-256 `392bdb9a0b989eedf5fba90983408ec145507cd0e46fedd6a65c9bbd9c4a9f2b`. VBA va tashqi havola yo‘q.

## Fayl tuzilishi

Shablon 2-oktabrdagi faylniki bilan bir xil: 15 varaq, ustunlar o‘rni o‘zgarmagan, import sarlavha bo‘yicha o‘qiydi.
O‘zgargani — ma’lumot:

| Varaq | Qatorlar | Yangilik |
|---|---:|---|
| Товар | 680 yuk (r4–r683) | 21 175,776 m³; 2 yangi agent: УТКИР (6 yuk), ДИЛЬМУРАД (26 yuk) |
| Оплата | 287 to‘lov | 13 213 117 940 so‘m; 2 056 dona poddon puli 267 280 000 so‘m |
| Оплата поставшику | 101 | 11 374 787 420 so‘m; to‘lovchi: Септем Алока, Септем ПСБ, НАКД, Нахт пластика |
| Поддон қайтариш | 191 + 1 to‘liqsiz | 188 mijoz qaytarishi, 3 ombor qatori, r160 da son yo‘q |
| Поддон қайтариш заводга | 24 | 9 452 dona; 5 qatorda jo‘natuvchi `"AEROSTONE" МЧЖ` |
| Кўрсаткичлар | 61 mijoz, 8 agent, 2 zavod | yangi mijozlar: SHOVOT TEMIR BETON, OBOD MCHJ, ПЕНОБЛОКЧИ, Райцентр |

## Importdagi tuzatishlar

| Muammo (eski import) | Endi |
|---|---|
| `Поддон қайтариш` r155 «РАЗНИЦА» +52 va r189 «БРАК» +39 mijoz deb o‘qilib, import **MIJOZ_YOQ** bilan to‘xtardi | «БРАК» (ikkala ishora), «РАЗНИЦА», «ОМБОР ТУЗАТИШИ» — imzoli ombor tuzatmasi. Egasining o‘z formulasi ham shunday: `K4 = SUM(Table48)`, mijoz qoldig‘ida esa yo‘q |
| «Гранд» справочникда bor, lekin yagona to‘lovi (r226) «Шовот» ga o‘tkazilgan — saytda 60 mijoz chiqardi | Справочникдаги har bir mijoz va agent harakati bo‘lmasa ham yaratiladi: saytda 61 mijoz = «Мижозлар қолдиғи» |
| r160: «Поддон дона» bo‘sh, 100 soni «Изох» ustunida — ogohlantirishda bu ko‘rinmasdi | Ogohlantirish matnida `Изох: 100` ko‘rinadi |
| Zavod qaytarishidagi «Жўнатувчи» yo‘qolardi | Izohga yoziladi; xarajatni zavodga bog‘lash buzilmaydi |
| Takroriy yuk ogohlantirishi farqni aytmasdi | Farq ko‘rsatiladi: r304 transport 2 400 000 ≠ 2 700 000; r641 № ЭСФ 612 ≠ 621 |
| Pul «ПР-Сумма» ustunida, «Получател» esa «Касса» — jimgina bankka yozilardi | Yangi `TOLOV_KANALI_FARQI` ogohlantirishi: r42, r70, r71 |
| Faqat ogohlantirish bo‘lsa ham ekranda «29 ta muammo hal qilinishi kerak» qizil yozuvi chiqardi | Faqat to‘siq bo‘lsa qizil; aks holda «ogohlantirish importni to‘xtatmaydi» |

## Fayl bilan solishtirish

Import natijasi (sayt servislari, lokal PostgreSQL) egasining hisob varaqlari bilan:

| Ko‘rsatkich | Fayl | Sayt |
|---|---:|---:|
| Mijozga yoziladi («Мижозга») | 13 900 584 619,94 | 13 900 584 619,94 |
| Mijozlar paddonsiz qarzi (−E76) | 954 746 679,94 | 954 746 679,94 |
| Mijozlar paddon bilan qarzi (−M76) | 1 020 266 679,94 | 1 020 266 679,94 |
| 61 mijozning har biri: E, M, J ustunlari | «Мижозлар қолдиғи» r5–r65 | mos |
| Коалс paddonsiz / paddon bilan | 810 640 426 / 924 260 426 | mos |
| Ментора paddonsiz / paddon bilan | 273 938 028 / 523 798 028 | mos |
| Zavodlar jami paddon bilan («Акт (умумий)»!R16) | 1 448 058 454 | 1 448 058 454 |
| Mijozlarda / zavodga qarz / omborda poddon | 504 / 2 796 / 292 | 504 / 2 796 / 292 |
| KPI (varaqdagi 6 agent, oy va butun davr) | «KPI» r10–r15, r20–r25 | mos (tiyingacha yaxlitlash, < 1 so‘m) |
| Kassa: bank / naqd / Click | — | 1 364 572 560 / 428 824 960 / 25 565 000 |

## Egasi ko‘rib chiqishi kerak

- `Поддон қайтариш!160` (Кахрамон ога Урганч, 09.10.2026): 100 «Изох» ustunida. Egasining o‘z yig‘indisi ham uni
  sanamaydi, import ham qo‘shmaydi. Qaytarish bo‘lsa, sonni C160 ga ko‘chirib qayta yuklash kerak.
- `Товар!303/304` va `633/641`: bir mijoz, sana, mashina va hajm. Ikkalasi ham fayldagidek import qilinadi; takror bo‘lsa
  bittasini fayldan o‘chirish kerak.
- `Оплата!42, 70, 71` (62 233 000 so‘m): pul «ПР-Сумма» ustunida, «Получател» — «Касса». Sayt bankka yozadi.
- `Товар` da 8 yuk tannarxda sotilgan (605 000 → 605 000): «Шовот» 7 ta, «Турткул 5555» 1 ta. Ogohlantirish, xato emas.
- «KPI» va «Текширув» §5 varaqlarida faqat 6 agent bor — УТКИР va ДИЛЬМУРАД qo‘shilmagan. Saytda 8 agent ham hisoblanadi.
  «Текширув» §5 to‘lovni poddon puli bilan birga sanaydi, shuning uchun u «Мижозлар қолдиғи» dagi qarzdan farq qiladi.

## Tekshiruv

- `npm run test:smartblok:sistema -w apps/api` — 5 824 tekshiruv: har bir yuk/to‘lov formulasi, 61 mijoz, 2 zavod, KPI, poddon paneli.
- `npm run test:smartblok:sistema:e2e -w apps/api` — 464 tekshiruv: staging → preview → commit, sayt servislari,
  eksport → qayta import, rollback. Ajratilgan sxemada, `DATABASE_URL` lokal PostgreSQL bo‘lishi va API build qilingan bo‘lishi kerak.
- Oldingi fayllar regressiyasi (2-oktabr: 4 446 + 359, 29-sentabr: 2 436, 22-sentabr: 462) va barcha import/eksport/KPI testlari o‘tdi.
- UI: yuklash HTTP orqali, ko‘rib chiqish, preview va commit vaqtinchalik lokal bazada tekshirildi; production bazasiga yozilmadi.
