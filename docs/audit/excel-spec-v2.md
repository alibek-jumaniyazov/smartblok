# «Smart blok.xlsx» — shablon spetsifikatsiyasi (v2)

> 2026-07-17. Bu hujjat importer moslashtirilgan YANGI ish kitobini tavsiflaydi.
> Eski «Газоблок Счет.xlsx» shabloni uchun `excel-spec.md` (v1) qoladi — u endi tarixiy.

## 1. Varaqlar inventari

| Varaq | Roli |
|---|---|
| **Лист1** | Jurnal: har qator = bitta mashina yetkazmasi (asosiy hisob manbai). Pastida ikkita svodka bloki (§3, §4) |
| **Жамол 22-22**, **Зафар ога**, **Шохрух ога**, **Арслон ога** | Agent daftarlari: tab nomi = agent nomi; ichida mijoz bloklari (§5) |

Eski shablondagi «Товар / Оплата / Оплата Завод / Свод Завод» va mijoz-varaqlar YO‘Q.
Importer jurnal varag‘ini nomi («Лист1») bo‘yicha, topilmasa 3-qator sarlavhalarida
«Агент»+«Клиент» borligi bo‘yicha taniydi; qolgan hamma varaq agent daftari hisoblanadi.

## 2. «Лист1» jurnali (sarlavha 3-qator, ma’lumot 4-qatordan)

Ustunlar eski «Товар» bilan aynan bir xil (A–U) + yangi V:

| Ust. | Sarlavha | Ma’nosi | Import |
|---|---|---|---|
| A | В-о | tartib raqami | ✓ |
| B | Поставшик | mahsulot turkumi («Газоблок») | ✓ |
| C | Агент | agent nomi (daftar bilan solishtiriladi — `AGENT_NOMI_FARQI`) | ✓ |
| D | Клиент | mijoz (bo‘sh ⇒ `MIJOZ_YOQ` bloker) | ✓ |
| E | Дата | sana | ✓ |
| F | № авто | mashina raqami → Vehicle | ✓ |
| G | Размер | blok o‘lchami («600x300x200») → Product | ✓ |
| H | Блок Куб | hajm m³ | ✓ |
| I | Цена Приход | zavod narxi/m³ (500 000) | ✓ |
| J | Сумма Приход | =H×I | hisoblanadi |
| K | Поддон Шт | poddon soni | ✓ |
| L | Цена Поддон | 130 000 | ✓ |
| M | Сумма Поддон | =K×L | hisoblanadi |
| N | Блок+Поддон | =J+M — zavodga qarz (poddon bilan) | hisoblanadi |
| O | Цена Продажа | sotuv narxi/m³ | ✓ |
| P | Разница | =O−I (tarixan buggy bo‘lgan — `FOYDA_PODDON_QOSHILGAN` kuzatadi) | faqat flag |
| Q | ИЗОХ | izoh | ✓ |
| R | Сумма Продажа | =H×O — mijoz qarzi (poddon PULI mijozga yozilmaydi) | ✓ |
| S | Расход Авто | transport (2–2,5 mln) — son yoki so‘z | ✓ |
| T | Общая прибль | =R−J | hisoblanadi |
| U | Авто услу барлдми? | «Туланди» ⇒ shofyorga to‘langan (VEHICLE 0 ga tenglashadi) | ✓ |
| V | Соф фойда | =T−S | hisoblanadi |

**Qator testi:** H raqam BO‘LSA yoki G «NxNxN» shaklida bo‘lsa — ma’lumot.
(25-qator jami, 36–45 svodka bloklari shunday chetlab o‘tiladi.)

## 3. Agent svodkasi (Лист1, «Агент | Расход | Приход | Ост | Паддон сони»)

Sarlavhasi matn bo‘yicha topiladi (joyi qat’iy emas). Faqat solishtiruv (reconciliation)
uchun — bazaga yozilmaydi. Daftar yig‘indisidan farq qilsa `SVOD_FARQI` (INFO) chiqadi.

## 4. Zavod o‘tkazmalari (Лист1, «Утказилган пул» bloki)

Sarlavha matni bo‘yicha topiladi; ostidagi (sana, summa) juftlari «Жами» qatorigacha
o‘qiladi → `FACTORY_OUT` to‘lovlar. Yonidagi «Завод Олинган/Берилган» katakchalari —
faqat ko‘rish uchun (bloklar puli, poddonsiz).

## 5. Agent daftari varag‘i — mijoz bloklari

```
«4-Рустам Шпик»            ← blok sarlavhasi: {agent№}-{mijoz} (A..E, ko‘pincha merged)
ID-Клиента … (2–3 sarlavha qatori, ba’zan raqam-indeks qatori)
A №  B Дата  C Сумма  D Примечание       E Возврат паддон   ← TO‘LOVLAR (chap)
F №  G Дата  H Авто   I Размер  J Куб  K Поддон  L От  M Сумма ← YETKAZMALAR (o‘ng)
…                       SUBTOTAL qatori blokni yopadi
```

- Agent raqamlari: Жамол=1, Арслон=2, Зафар=3, Шохрух=4 (blok sarlavha prefiksi) → `Agent.sortNo`.
- **To‘lov qatori**: A da raqam + (B sana yoki C summa yoki E poddon). D = to‘lovchi yuridik nomi
  (`Payment.payerName`). E «Возврат паддон» = naturada qaytarilgan poddon → `RETURNED_BY_CLIENT`
  (pulsiz; yetkazilganidan oshig‘i kesiladi + `PODDON_QAYTARISH_ORTIQCHA`).
- **Yetkazma qatori**: F da raqam + G da sana. Bazaga yozilmaydi — jurnal bilan 1:1
  solishtiriladi (`DAFTAR_JURNAL_FARQI`: kalit = mijoz+sana+mashina+kub).
- Blok balansi (F2 formulasi) = to‘lovlar − yetkazmalar; keshlangan bo‘lgani uchun ishonilmaydi.

## 6. 2026-07-17 fayl bo‘yicha tasdiqlangan raqamlar (golden)

| Ko‘rsatkich | Qiymat |
|---|---|
| Yetkazmalar (mashinalar) | **21** (24-iyun – 30-iyun) |
| Σ sotuv (R) | **501 414 039,36** |
| Σ zavod bloklari (J) — **zavod tannarxi** | **340 416 000** |
| Σ poddon puli (M) — *ma’lumot uchun, qarzga KIRMAYDI* | 51 220 000 |
| Poddonlar | **394** (Жамол 168, Зафар 132, Шохрух 57, Арслон 37) — naturada qaytariladi |
| Mijoz to‘lovlari (7 ta) | **262 014 900** |
| Zavod o‘tkazmalari (8 ta) | **262 014 900** (mijoz puli to‘liq zavodga o‘tgan) |
| Mijozlar qarzi («Ост» jami, SOF — avanslar ayirilgan) | **239 399 139,36** |
| Zavod qoldig’i (= Лист1 «Завод» bloki) | **−78 401 100** (262 014 900 − 340 416 000) |
| Yalpi foyda («Общая прибль» T25) | **160 998 039,36** |
| Sof foyda («Соф фойда» V25 = yalpi − transport 43 500 000) | **117 498 039,36** |
| Transport (hammasi «Туланди») | **43 500 000** → VEHICLE qoldiq 0 |
| Mijozlar | 10 (jumladan «Фидато Гроуп» — faqat avans +22 703 000, yetkazmasiz) |

Daftar ↔ jurnal o‘zaro tekshiruvi: 21/21 mos, farq yo‘q. Qoidalar faqat 3× `NARX_BUTUN_SON_EMAS`
(732 542,438 ×2 va 729 928,1 — kasr narxlar) beradi; bloker yo‘q — fayl darhol commit-ready.

## 7. Import oqimi (o‘zgarmagan arxitektura)

upload → parse → nom-moslashtirish (agentlar endi varaq nomlaridan, hardcode YO‘Q) →
qoidalar + AI (Haiku) → staged review → preview (dry-run) → commit (bitta tranzaksiya) →
kompensatsion rollback. Testlar: `apps/api/test/import/*` (default yo‘l `docs/Smart blok.xlsx`).
