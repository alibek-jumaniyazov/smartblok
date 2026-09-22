# Smart blok.xlsb — to‘liq import auditi

Tekshiruv sanasi: 2026-09-22. Manba: `docs/Smart blok.xlsb` (243 464 bayt).

SHA-256: `7eea7da8ebe89891cf02dffa098d6114e2e683e7a8444f683173b6ce744d140b`.

Bu hujjat aynan XLSB nusxasiga tegishli. Oldingi `Smart blok.xlsx` etalonining 415/194/58/88/12 qator sonlari bu faylga qo‘llanmaydi. Manba fayl o‘zgartirilmadi.

## Tekshiruv usuli va chegarasi

Barcha 15 varaqning barcha to‘ldirilgan kataklari pyxlsb orqali asl qator/ustun koordinatasi bilan olindi va SheetJS 0.20.3 orqali mustaqil tekshirildi. **30 525 katak qiymati** solishtirildi: birgina farq `Акт (умумий)!G23` xatosining ifodasi (`0x1d` va 29), ikkisi ham `#NAME?`. Qolgan qiymatlar aynan mos. Pul hisoblari Python Decimal bilan qayta hisoblandi; formulalardagi Excel suzuvchi nuqta qoldiqlari bilan haqiqiy moliyaviy farqlar ajratildi.

SheetJS XLSB formula matnlarida ayrim strukturali havolalarning ustun nomlarini `Table1[#Data]`/`[#?Current]` tarzida soddalashtiradi, ayrim nisbiy manzillarni esa noto‘g‘ri yozib beradi. Shu sabab formula matnini qayta bajarish isboti deb olish mumkin emas. Tekshiruvda manba kataklari, keshlangan natijalar va jadval ma’nosidan mustaqil hisob ishlatildi. Excelning o‘zida `CalculateFullRebuild` bajarilmadi. Import uchun hisobot formulalarini bajarish shart emas: asosiy jadvallar qayta hisoblanadi. Ko‘rinish/dizayn tahrirlanmadi; audit barcha kataklar va hisob ma’nosini qamrab oladi, Excel ekranining vizual renderi bajarilmadi.

Fayl Excel 1900 sanalar tizimida (`date1904=false`). Sana seriyalari kalendar kun sifatida saqlanishi kerak; UTC/lokal vaqt konversiyasi sanani bir kun orqaga surmasin. Fayl metama’lumotlari: yaratilgan 2026-05-10 07:06:29 UTC; o‘zgartirilgan 2026-09-18 13:00:54 UTC; hisoblash `auto`, iteratsiya o‘chiq. Arxivda 9 Excel table, calcChain, 10 katak izohi, bitta VML chizma va webextension bor. `vbaProject.bin` va externalLinks qismlari yo‘q; izoh va chizma makro bajarishga asos emas.

## 1. Barcha varaqlar inventari

Formulalar soni parser aniqlagan formula kataklar soni; dinamik massivning to‘kilgan qiymatlari alohida formula hisoblanmaydi.

| Varaq | Saqlangan diapazon | Formula | Ko‘rinish | Importdagi roli |
|---|---|---:|---|---|
| Кўрсаткичлар | A1:J65 | 1 | ochiq | 55 mijoz, 6 agent, 2 zavod, kanal va sozlamalar |
| Мижозлар қолдиғи | A1:M76 | 934 | ochiq | 55 mijoz bo‘yicha nazorat; filtrlangan ЖАМИ ishlatilmasin |
| Мижоз картаси | A1:T200 | 15 | ochiq | Tanlangan mijoz kartasi; takroriy yozuvlar import qilinmaydi |
| Қидирув | A1:J40 | 4 | yashirilgan | Mijoz/agent qidiruv interfeysi |
| Поставшиклар ҳисоби | A1:I60 | 61 | yashirilgan | Zavodlar hisoboti; poddon qaytarishini chegirmaydi |
| Акт сверка | A1:Z80 | 29 | yashirilgan | Bitta zavod va oy bo‘yicha hisoboti |
| Ҳисобот | A1:M36 | 61 | ochiq | Kunlik/all-factory nazorat; miqdor va pul farqi alohida |
| Акт (умумий) | A1:AA23 | 116 | ochiq | Oy/all-period nazorat, kanal bo‘yicha poddon farqi bor |
| KPI | A1:L64 | 350 | ochiq | Hisoblangan agent KPI; alohida operatsiya emas |
| Поддон қайтариш заводга | A1:L199 | 34 | ochiq | 14 haqiqiy + 1 tugallanmagan qaytarish qatori |
| Поддон қайтариш | A1:F133 | 1 | ochiq | 118 mijoz qaytarishi, 2 manfiy tuzatish bilan |
| Оплата | A1:T1101 | 8479 | ochiq | 223 ayniyati bor + 1 mijozsiz to‘lov qatori |
| Оплата поставшику | A1:H97 | 1 | ochiq | 66 zavod to‘lovi |
| Товар | A1:AA1188 | 9943 | ochiq | 478 yetkazma, qo‘shimcha hisob-faktura metama’lumotlari |
| Текширув | A1:J60 | 186 | ochiq | Nazorat paneli; yangi moliyaviy operatsiya emas |

Hisobot varaqlari asosiy jadvallarning qayta ko‘rinishi. Ularni yana operatsiya sifatida import qilish summalarni ikki marta yozadi. Jadvalning formula bilan davom ettirilgan dumlari haqiqiy yozuv emas: `Товар` 1188-qatorgacha, `Оплата` 1101-qatorgacha saqlangan, haqiqiy yozuvlar esa mos ravishda 481 va 228-qatorda tugaydi.

## 2. Asosiy jadvallar va davrlar

| Jadval | Sarlavha | Ma’lumot | Operatsiyalar | Davr |
|---|---:|---|---:|---|
| Товар | 3 | 4:481 | 478 | 2026-06-24 – 2026-09-15 |
| Оплата | 4 | 5:228 | 224: 223 mijozli, 1 mijozsiz | 2026-06-25 – 2026-09-17 |
| Оплата поставшику | 2 | 3:68 | 66 | 2026-06-25 – 2026-09-15 |
| Поддон қайтариш | 3 | 4:121 | 118 | 2026-06-25 – 2026-09-18 |
| Поддон қайтариш заводга | 3 | 4:17 | 14 | 2026-07-16 – 2026-09-09 |

`Оплата` 1-qatori bo‘sh. Uni o‘qishda ro‘yxat indeksini Excel qator raqami deb olish mumkin emas. `Товар!E3` sarlavhasi `Дата ` (oxirida bo‘shliq); `Оплата!A4` sarlavhasi `Дата`.

### Товар — barcha 27 ustun

| Ustun | Mazmun | Hisob/saqlash |
|---|---|---|
| A | Тўлов тури | BANK/CASH zavod niyati; boshqa kanalga o‘zboshimcha o‘tkazilmaydi |
| B | Поставшик | Har qatorning Коалс/Ментора zavodi |
| C | Агент | Kiritilgan agent; lug‘at bilan tekshirish |
| D | Клиент | Lug‘atdagi rasmiy mijoz |
| E | Дата | Buyurtmaning asl kalendar sanasi |
| F | № авто | Mashina raqami |
| G | Размер | Mahsulot o‘lchami |
| H | Блок Куб | Hajm, m³ |
| I | Цена Приход | Zavod narxi/m³ |
| J | Сумма Приход | H × I |
| K | Поддон Шт | Poddon dona: zavoddan olindi + mijozga berildi |
| L | Цена Поддон | 130 000; zavod qarziga qo‘shilmaydi |
| M | Сумма Поддон | K × L; nazorat uchun |
| N | Блок+Поддон | J + M; Excel qiymati, saytning zavod tannarxi emas |
| O | Цена Продажа | Sotuv narxi/m³, kasr aniqligi saqlanadi |
| P | Сумма Продажа | H × O |
| Q | Расход Авто | Клиент / Сотувчи |
| R | Общая прибль | P − J − S; **transportdan keyingi** foyda |
| S | Авто услу | Transport xarajati |
| T | Мижозга | P − (Q=Клиент ? S : 0) |
| U | Агент (бириктирилган) | Lug‘atdan formula; eski profit ustuni deb o‘qilmasin |
| V | Агент текшируви | Agent moslik tekshiruvi |
| W | Рухсат этилган агент | Tasdiqlangan agent yordamchi ustuni |
| X | ПРИМЕЧАНИЕ | Izohni saqlash |
| Y | ИНН | STIR identifikatori, hisoblash soni emas |
| Z | № ЭСФ | Hisob-faktura raqami |
| AA | СТАТУС ЭСФ | Hisob-faktura holati; buyurtma statusi bilan aralashtirilmasin |

Ustunlardagi satr uzilishlari va chet bo‘shliqlar sarlavhani topishda normallashtiriladi. 478 qatorning hammasida mijoz/sana/mashina/o‘lcham/hajm/tannarx/sotuv narxi bor; hajm va narx nol yoki manfiy emas. 473 bank va 5 kassa zavod niyati. 364 qatorda transportni mijoz, 114 qatorda sotuvchi to‘laydi. Transport kassadan yana chiqarilmasligi kerak: manbada alohida shofyor to‘lov daftari yo‘q.

### Оплата — barcha biznes ustunlari

A sana; B agent; C mijoz; D bank; E to‘lovchi; F poddon dona; G `Учун` yordamchi poddon qiymati; H naqd; I Click; J terminal; K D+H+I+J; L qabul qiluvchi; M izoh; N poddon narxi; O F×N; P K−O; Q lug‘atdagi agent; R agent tekshiruvi; S ruxsat etilgan agent. T saqlangan diapazonda bor, biznes sarlavhasi/qiymati yo‘q.

Faqat D/H/I/J pul kanali hisoblanadi. F/G/O poddonning alohida qismi, bankka ikkinchi tushum emas. Manfiy pul yozuvi refund/qaytarish sifatida, manfiy F esa poddon undirishini bekor qilish sifatida talqin qilinadi.

### Qolgan manba jadvallari

`Оплата поставшику`: A sana, B `В-о` kanal, C summa, D **Плательщик**, E **Получатель**. Bu faylda sarlavhalar imlosi avvalgi `Платеелшик`/`Получател` variantlaridan farq qiladi. 65 bank to‘lovi 8 205 239 420, bitta kassa to‘lovi 50 000 000. Barcha 66 qatorda sana, kanal, summa va zavod mavjud.

`Поддон қайтариш`: A sana, B mijoz, C dona, D izoh. Manfiy −19 va −8 oldingi qaytarishni kamaytiradi. E/F ishlatilmagan maydonlar.

`Поддон қайтариш заводга`: A sana, B qabul qilingan dona, C jo‘natuvchi, D zavod, E bir dona qaytarish xarajati, F jami xarajat, G izoh, H kanal, I `Столбец1` yordamchi ma’lumot, J:L ombor paneli. Panel qiymatlari hamda I18 dagi 500 dona alohida qabul qilingan qaytarish sifatida import qilinmaydi.

## 3. Tekshirilgan hisoblar

Quyidagi pul sonlari manba qiymatlarini yig‘ib, ko‘rsatish uchun 2 kasrga yaxlitlangan. Pulning har qatori 2 kasrda saqlanadigan tizimdagi yakuniy farqlar keyingi bo‘limda ko‘rsatilgan.

| Ko‘rsatkich | Qiymat | Manba/hisob |
|---|---:|---|
| Yetkazilgan hajm | 14 783,256 m³ | Товар H4:H481 |
| Zavod blok tannarxi | 8 602 320 762,00 | Товар J4:J481 |
| Sotuv | 10 541 629 899,91 | Товар P4:P481 |
| Transport jami | 1 116 796 105,20 | Товар S4:S481 |
| Mijoz to‘laydigan transport | 863 823 999,97 | Q=Клиент |
| Sotuvchi to‘laydigan transport | 252 972 105,23 | Q=Сотувчи |
| Mijozga yoziladigan summa | 9 677 805 899,94 | Товар T4:T481 |
| Yalpi foyda (transportdan oldin) | 1 939 309 137,91 | P−J; U2 dagi tarixiy jami |
| Transportdan keyingi foyda | 822 513 032,72 | R=P−J−S |
| Barcha pul kanallari, mijozsiz qator bilan | 9 433 700 900,00 | Оплата K3, 5:228 |
| Mijozga bog‘langan pul | 9 270 350 900,00 | Оплата 226-qatorsiz |
| Mijozsiz pul | 163 350 000,00 | Оплата D226/K226/P226 |
| Poddon uchun to‘langan qism | 381 550 000,00 | Оплата O, signed |
| Tovar uchun to‘langan qism, mijozsiz qator bilan | 9 052 150 900,00 | Оплата P5:P228 |
| Tovar uchun to‘langan qism, mijozli | 8 888 800 900,00 | Оплата P, 226-qatorsiz |
| Mijozlar sof tovar qarzi | 789 004 999,94 | Tovar T − Оплата P; avanslar chegirilgan |
| Zavodga to‘lov | 8 255 239 420,00 | Оплата поставшику C3:C68 |
| Sayt zavod balansi | −347 081 342,00 | To‘lov − blok tannarxi |
| Mijozlarga berilgan poddon | 8 551 dona | Товар K |
| Mijoz qaytargan poddon | 5 511 dona | Поддон қайтариш C, signed |
| Mijoz puli to‘lagan poddon | 2 935 dona | Оплата F, signed |
| Mijozlar sof poddon qarzi | 105 dona | 8 551−5 511−2 935 |
| Zavodga qaytarilgan poddon | 4 392 dona | factory return B, signed |
| Zavodga poddon qarzi | 4 159 dona | 8 551−4 392 |
| Omborda poddon | 1 119 dona | 5 511−4 392 |
| Poddon qaytarish xarajati | 19 368 000,00 | factory return F, signed |

Konservatsiya: **4 159 = 105 + 1 119 + 2 935**, farq 0. Mijozlar kesimida ortiqcha qaytarish/undirish bo‘lishi mumkin; global sonni nolga kesish yoki qatorlarni tashlash mumkin emas.

### Yaxlitlash

6 qatorda kasr sotuv narxi bor: 4, 5, 20, 145, 201, 468. Masalan 732 542,438 va 709 774,6101 qiymatlar mahsulotga ko‘paytirishdan oldin 2 kasrga yaxlitlanmasin. Hajm ham 400/401-qatorda 22,709 va 10,123 m³ kabi kasr ko‘rinishda keladi.

Har qator formulasini Decimal bilan qayta hisoblab so‘ng 2 kasrga yaxlitlaganda: J=8 602 320 762,00; P=10 541 629 899,91; T=9 677 805 899,93; R=822 513 032,71. S ni har qator 2 kasrga yaxlitlash 1 116 796 105,22 beradi (mijoz 863 823 999,98; sotuvchi 252 972 105,24). `round(P−J−S)` va `round(P)−round(J)−round(S)` bir xil ketma-ketlik emas. Tizimning amaldagi pul chegaralariga izchil amal qilish kerak; oxirgi sent farqlari source discrepancy deb talqin qilinmasin. 478 qator J/M/N/P/R/T kataklarining har biri mustaqil hisobdan 0,011 so‘mdan katta farq bermadi.

### Zavodlar

| Zavod | Yuk | m³ | Blok tannarxi | To‘lov | Sayt pul balansi | Olingan poddon | Qaytgan | Dona qarz |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Коалс | 157 | 4 939,560 | 2 807 550 054 | 2 395 089 420 | −412 460 634 | 2 858 | 2 421 | 437 |
| Ментора | 321 | 9 843,696 | 5 794 770 708 | 5 860 150 000 | +65 379 292 | 5 693 | 1 971 | 3 722 |

Bank/kassa FIFO zavod va kanal ichida saqlanadi. Bank niyatidagi blok tannarxi 8 522 456 922; kassa niyatidagi 79 863 840. Zavod to‘lovlari bankda 8 205 239 420, kassada 50 000 000.

### Oylar bo‘yicha yetkazmalar

| Oy | Yuk | m³ | Poddon | Blok tannarxi | Sotuv | Mijozga |
|---|---:|---:|---:|---:|---:|---:|
| 2026-06 | 21 | 680.832 | 394 | 340 416 000.00 | 501 414 040.35 | 501 414 040.35 |
| 2026-07 | 164 | 5 102.928 | 2 951 | 2 982 725 388.00 | 3 581 770 880.02 | 3 303 186 880.02 |
| 2026-08 | 217 | 6 569.280 | 3 800 | 3 882 412 728.00 | 4 709 678 499.55 | 4 301 238 499.57 |
| 2026-09 | 76 | 2 430.216 | 1 406 | 1 396 766 646.00 | 1 748 766 480.00 | 1 571 966 480.00 |

## 4. Manbaning barcha muhim nomuvofiqliklari

1. **Mijozsiz 163 350 000 so‘m — Оплата 226-qator.** Sana 2026-09-15, to‘lovchi `OOO "GRAND TORG KARAVAN"`, qabul qiluvchi `Септем Алока`; B agent va C mijoz bo‘sh. Lug‘atda `Гранд` bor, lekin bu to‘lovni aynan unga avtomatik yozish uchun manbada aniq bog‘lanish yo‘q. Import pulni jim tashlamasligi, xavfni bloklovchi xabar qilib ko‘rsatishi va foydalanuvchi aniq mijozni tuzatishini talab qilishi kerak.
2. **Filtrlangan mijoz jami — Мижозлар қолдиғи 76-qator.** AutoFilter A4:M75; keshlangan SUBTOTAL faqat Арслон guruhini ko‘rsatadi: C76=638 677 600,008; D76=630 978 500; F76=551. Bu global summa emas. Nazorat 55 mijozning barcha 5:59 tafsilotidan, yashirilgan qatorlarni ham qo‘shib hisoblanadi.
3. **Factory return 18-qator tugallanmagan.** Sana 2026-09-11, Ментора, jo‘natuvchi bor; asosiy B dona yo‘q. I18 dagi 500 yordamchi ustunda. Kelishilgan qabul miqdori deb o‘tkazilmaydi; qator va miqdor qayerda turgani ochiq ko‘rsatiladi.
4. **Factory return 17-qator kanali bo‘sh.** 2026-09-09, Ментора, 500 dona — haqiqiy qaytarish, xarajat yo‘q. Miqdor import qilinadi. Excelning umumiy kunlik hisoboti bu 500 donani oladi; kanalga bo‘lingan Акт esa puldan 65 000 000 ni tushirib qoldiradi. Pul kanali taxmin qilinmaydi.
5. **Takroriy yuk kaliti — Товар 303/304.** Хонкага, 2026-08-20, `90 Y 617 RA`, 32,832 m³. Ikkala manba qatori ham saqlanadi; aynan bir yoki ikki yuk ekanini review tasdiqlaydi. Avtomatik deduplikatsiya manba summasini o‘zgartiradi.
6. **Poddon hajmi — Товар 400/401.** Кахрамон ога Урганч: 22,709 m³/13 dona va 10,123 m³/6 dona. Alohida qatorda standart 1,728 m³/dona emas, ikkisi birga 32,832 m³/19 dona. Qatorlar tashlanmasin yoki 1,728 ga majburan qayta hisoblanmasin.
7. **Bitta report formula xatosi — Акт (умумий)!G23.** `КОН` nomi bo‘sh havolaga ega, cached `#NAME?`. Asosiy operatsiyalar hisobini buzmaydi; hisobotdagi mavjud xato sifatida qayd qilinadi. `_xlfn.*` compatibility nomlarining `#NAME?` ta’rifi alohida haqiqiy katak xatosi deb sanalmaydi.
8. **Pul va poddon stornolari.** 8 manfiy pul qatori jami −35 063 880; 1 nol pul/+9 230 000 tovar qismi bo‘lgan poddon bekor qilish; mijoz qaytarish −19/−8; zavod qaytarish −113 va −904 000 xarajat. Bularni `abs`, nol yoki oddiy musbat payment qilib yozish manba balansini buzadi.
9. **Aralash kanal — Оплата 204-qator.** Мирза ога кушкупир, 2026-09-05: CASH 22 325 000 + CLICK 785 000 = 23 110 000. Poddon 19×130 000=2 470 000; tovar qismi 20 640 000. Ikkita real pul kanali va bitta poddon undirish yozuvi kerak, ikkita poddon undirish emas.

### Refund va tuzatishlar reyestri

| Varaq/qator | Sana | Tomon | Pul / dona | Ma’no |
|---|---|---|---:|---|
| Оплата 25 | 2026-07-06 | Шиддат маналит | -100 000.00 | BANK refund |
| Оплата 36 | 2026-07-08 | Ирригатсия темир бетон | -6 230 480.00 | BANK refund |
| Оплата 46 | 2026-07-10 | Сарвар ога Шовот | -220 000.00 | BANK refund |
| Оплата 66 | 2026-07-17 | Газ сув монтаж | -20 482 400.00 | BANK refund |
| Оплата 98 | 2026-07-28 | Сулаймон Ога Хазарасп | -2 671 000.00 | BANK refund |
| Оплата 134 | 2026-08-13 | Мурод ога 4884 | -260 000.00 | BANK refund |
| Оплата 181 | 2026-08-26 | NO WAY MCHJ Турткул | -100 000.00 | BANK refund |
| Оплата 227 | 2026-09-17 | Хонка Про-Макс | -5 000 000.00 | CLICK refund |
| Оплата 190 | 2026-08-29 | Шиддат маналит | −71 dona / −9 230 000 | Poddon charge bekor; real pul 0; tovar qismi +9 230 000 |
| Поддон қайтариш 70 | 2026-08-21 | Одилбек Ера хоус | -19 dona | Oldingi qaytarish stornosi |
| Поддон қайтариш 118 | 2026-09-16 | Инноватцион | -8 dona | Oldingi qaytarish stornosi |
| Поддон қайтариш заводга 9 | 2026-08-08 | Коалс | −113 dona / −904 000 | Brak qabul qilinmagan; qaytarish va xarajat kamayadi |

### Zavod pul siyosati — manbada uch xil jami

Loyihada oldindan tasdiqlangan qoida saqlanadi: **zavod poddoni faqat dona**, zavod pul qarziga poddon narxi yozilmaydi. Qaytarish xarajati esa haqiqiy expense.

| Nazorat manbai | Balans | Sabab |
|---|---:|---|
| Sayt, faqat blok | −347 081 342 | 8 255 239 420 − 8 602 320 762 |
| Ҳисобот L32, 17.09 | −868 383 342 | Poddon olindi/qaytdi va qaytarish xarajati bilan |
| Акт (умумий) R16 | −933 383 342 | Yuqoridagidan −65 000 000: 17-qator kanali bo‘sh |
| Поставшиклар ҳисоби H6 | −1 458 711 342 | Poddon olinishini qo‘shadi; qaytarish/expense hisobga olinmagan |

Kunlik hisobot bilan izohlanadigan farq: **1 111 630 000 − 570 960 000 − 19 368 000 = 521 302 000**. Bu farq bank/kassa aralashuvi emas. To‘rtta manbani bitta "Excel total" deb solishtirish noto‘g‘ri. Saytning asosiy hisobi avvalgi qoida bo‘yicha, Excel tafovuti esa preview’da nomi va manbasi bilan ko‘rsatiladi.

## 5. Spravochnik, agentlar va mijozlar

`Кўрсаткичлар!A11:E65` da 55 rasmiy mijoz. F11:F16 da 6 agent: Арслон ога, Жамол 22-22, Зафар ога, Сардор ога, Темур, Шохрух ога. I11:I12 zavodlari Коалс/Ментора; I16:I17 kanallari Касса/Перечисления. B4=130 000 poddon narxi; B5=10 000/m³ soliq; B6=1/3 agent ulushi; B7=2/3 firma ulushi.

Barcha nomi yozilgan Товар/Оплата/Поддон qaytarish mijozlari rasmiy lug‘at bilan aynan mos. Fuzzy merge kerak emas. `Жамол 009` va `Жамол 009 (Сардор ога)`, `Алибобо` va `Алибобо (Сардор ога)` alohida mijozlar; qavs yoki agent nomini olib tashlab qo‘shib yuborish mumkin emas. Faqat `Гранд` ning rasmiy nomida operatsiya yo‘q.

Lug‘atdagi variantlar (bir xil qaytarilgan aliaslar bir marta):

| Rasmiy mijoz | Variantlar |
|---|---|
| Жаср Версал | Жасур Версал |
| Журат ога хонка | Журат хонка |
| Мустафо машал | Мустофо машал |
| Одилбек Ера хоус | Одилбек ога Эра хоус |
| Сохил буйи Уткир ога | Сохил буйи Уткир; Сохил буйи |
| Сулаймон Ога Газаблок | Сулаймон ога Газоблок |
| Уктир ога Шовот | Уткир ога шовот |
| Фидато Груп | Фидато Гроуп |
| Шиддат маналит | Шиддат моналит |

### Barcha mijozlar nazorat reyestri

Pul balansi = **tovar uchun to‘lov − mijozga yozilgan summa**; manfiy — mijoz qarzi, musbat — avans. Poddon balansi bu jadvalda **berilgan − qaytgan − puli to‘langan**; musbat — dona qarzi, manfiy — ortiqcha. Bu ustun Excelning J ustunidan teskari ishorada.

| Mijoz | Agent | Mijozga | Tovar uchun to‘lov | Pul balansi | Berilgan | Qaytgan | To‘langan dona | Dona qarz |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| Алибобо | Шохрух ога | 225 192 960.00 | 0.00 | -225 192 960.00 | 181 | 59 | 0 | 122 |
| Бахтиёр ога Шовот | Зафар ога | 20 582 400.00 | 47 530 000.00 | 26 947 600.00 | 19 | 0 | 19 | 0 |
| Бунёдкор | Шохрух ога | 50 641 600.00 | 51 641 600.00 | 1 000 000.00 | 46 | 16 | 0 | 30 |
| Газ сув монтаж | Шохрух ога | 10 805 600.00 | 10 805 600.00 | 0.00 | 11 | 6 | 0 | 5 |
| Гайрат Штб | Шохрух ога | 49 904 640.00 | 49 904 640.00 | 0.00 | 38 | 38 | 0 | 0 |
| Гофур хазорасп | Арслон ога | 121 824 000.00 | 121 824 000.00 | 0.00 | 94 | 94 | 0 | 0 |
| Жамол 009 | Шохрух ога | 91 929 600.00 | 0.00 | -91 929 600.00 | 76 | 76 | 0 | 0 |
| Жаср Версал | Темур | 413 548 000.00 | 413 548 000.00 | 0.00 | 380 | 380 | 0 | 0 |
| Журат ога хонка | Темур | 397 245 280.00 | 404 654 880.00 | 7 409 600.00 | 361 | 351 | 114 | -104 |
| Инвест Холдинг | Шохрух ога | 67 737 600.00 | 67 737 600.00 | 0.00 | 56 | 56 | 0 | 0 |
| Инноватцион | Жамол 22-22 | 680 520 960.00 | 200 000 000.00 | -480 520 960.00 | 555 | 398 | 0 | 157 |
| Ирригатсия темир бетон | Шохрух ога | 24 131 520.00 | 24 131 520.00 | 0.00 | 19 | 0 | 19 | 0 |
| Кахрамон ога Урганч | Зафар ога | 512 879 007.37 | 486 090 000.00 | -26 789 007.37 | 472 | 365 | 107 | 0 |
| Кувондик курувчи | Арслон ога | 62 960 480.00 | 62 960 480.00 | 0.00 | 57 | 0 | 38 | 19 |
| Мактаб | Темур | 12 935 200.00 | 12 935 000.00 | -200.00 | 12 | 6 | 6 | 0 |
| Мамун Университети | Сардор ога | 103 432 920.00 | 103 433 000.00 | 80.00 | 95 | 32 | 63 | 0 |
| Музаффар 0010 | Сардор ога | 246 337 119.55 | 239 587 000.00 | -6 750 119.55 | 223 | 112 | 174 | -63 |
| Мурод ога 4884 | Зафар ога | 316 585 600.00 | 213 004 240.00 | -103 581 360.00 | 285 | 60 | 225 | 0 |
| Мурод ога Урганч | Зафар ога | 47 934 720.00 | 47 934 720.00 | 0.00 | 38 | 36 | 2 | 0 |
| Мустафо машал | Темур | 103 212 000.00 | 103 964 000.00 | 752 000.00 | 95 | 95 | 0 | 0 |
| Мята Газаблок | Темур | 252 468 480.00 | 254 868 480.00 | 2 400 000.00 | 228 | 0 | 228 | 0 |
| Нахт клиент-А | Арслон ога | 22 192 000.00 | 22 200 000.00 | 8 000.00 | 20 | 18 | 0 | 2 |
| Низомиддин хонка | Темур | 40 964 800.00 | 40 964 800.00 | 0.00 | 38 | 38 | 0 | 0 |
| Нормат Умидбек | Шохрух ога | 123 197 760.00 | 122 394 560.00 | -803 200.00 | 99 | 95 | 0 | 4 |
| Одилбек Ера хоус | Темур | 754 525 760.00 | 724 331 080.00 | -30 194 680.00 | 684 | 465 | 456 | -237 |
| Отабек дамирчи | Сардор ога | 608 135 680.00 | 659 410 000.00 | 51 274 320.00 | 551 | 323 | 243 | -15 |
| Рустам Шпик | Шохрух ога | 422 320 440.36 | 393 955 400.00 | -28 365 040.36 | 381 | 227 | 90 | 64 |
| Сарвар ога Шовот | Зафар ога | 212 107 200.00 | 211 587 200.00 | -520 000.00 | 190 | 91 | 99 | 0 |
| Сохил буйи Уткир ога | Сардор ога | 123 651 040.01 | 123 651 500.00 | 459.99 | 114 | 89 | 19 | 6 |
| Сулаймон Ога Газаблок | Зафар ога | 380 802 720.01 | 394 894 000.00 | 14 091 279.99 | 342 | 109 | 233 | 0 |
| Сулаймон Ога Хазарасп | Зафар ога | 721 955 200.00 | 721 955 200.00 | 0.00 | 645 | 645 | 0 | 0 |
| Уктир ога Шовот | Зафар ога | 40 964 800.00 | 40 964 800.00 | 0.00 | 38 | 0 | 0 | 38 |
| Урганч сити | Жамол 22-22 | 137 894 400.00 | 125 000 000.00 | -12 894 400.00 | 114 | 114 | 0 | 0 |
| Урганч Тамирлаш | Жамол 22-22 | 45 569 999.98 | 340 570 000.00 | 295 000 000.02 | 36 | 0 | 0 | 36 |
| Уткир мини | Сардор ога | 399 315 200.00 | 429 553 280.00 | 30 238 080.00 | 361 | 316 | 171 | -126 |
| Фидато Груп | Шохрух ога | 110 181 920.00 | 110 180 000.00 | -1 920.00 | 95 | 92 | 0 | 3 |
| Фм хоус | Сардор ога | 52 091 600.02 | 52 100 000.00 | 8 399.98 | 46 | 46 | 0 | 0 |
| Хонкага | Жамол 22-22 | 188 127 360.00 | 60 000 000.00 | -128 127 360.00 | 152 | 140 | 0 | 12 |
| Шиддат маналит | Арслон ога | 390 423 040.01 | 382 714 020.00 | -7 709 020.01 | 342 | 305 | 37 | 0 |
| Элликкала Бостон | Шохрух ога | 44 114 652.63 | 41 768 000.00 | -2 346 652.63 | 41 | 60 | 0 | -19 |
| Акмал 91 510 50 01 | Шохрух ога | 23 639 040.00 | 24 000 000.00 | 360 960.00 | 19 | 0 | 0 | 19 |
| Нахт клиент-С | Сардор ога | 29 914 800.00 | 29 914 800.00 | 0.00 | 28 | 28 | 0 | 0 |
| Бахти Ташкентский | Темур | 231 629 440.00 | 279 850 000.00 | 48 220 560.00 | 209 | 54 | 155 | 0 |
| Хонка Про-Макс | Темур | 63 717 120.00 | 63 717 120.00 | 0.00 | 57 | 57 | 0 | 0 |
| NO WAY MCHJ Турткул | Зафар ога | 62 617 120.00 | 62 617 120.00 | 0.00 | 57 | 0 | 57 | 0 |
| Сухроб 00-00 | Темур | 63 317 120.00 | 62 590 000.00 | -727 120.00 | 57 | 0 | 57 | 0 |
| Фаррух 85-88 | Шохрух ога | 62 517 120.00 | 0.00 | -62 517 120.00 | 57 | 0 | 0 | 57 |
| Бобур чакка | Шохрух ога | 83 356 160.00 | 65 437 100.00 | -17 919 060.00 | 76 | 0 | 76 | 0 |
| Мирза ога кушкупир | Арслон ога | 41 278 080.00 | 41 280 000.00 | 1 920.00 | 38 | 19 | 19 | 0 |
| Жасур Стар Сити | Темур | 83 356 160.00 | 83 356 160.00 | 0.00 | 76 | 0 | 76 | 0 |
| Жамол 009 (Сардор ога) | Сардор ога | 21 239 040.00 | 18 730 000.00 | -2 509 040.00 | 19 | 0 | 19 | 0 |
| Музаффар ога 8888 | Зафар ога | 212 751 360.00 | 222 710 000.00 | 9 958 640.00 | 171 | 0 | 133 | 38 |
| Алибобо (Сардор ога) | Сардор ога | 47 278 080.00 | 0.00 | -47 278 080.00 | 38 | 0 | 0 | 38 |
| Турткул 5555 | Шохрух ога | 19 850 000.00 | 19 850 000.00 | -0.00 | 19 | 0 | 0 | 19 |
| Гранд | Шохрух ога | 0.00 | 0.00 | 0.00 | 0 | 0 | 0 | 0 |

Poddoni ortiqcha 6 mijoz: Журат ога хонка 104, Музаффар 0010 63, Одилбек Ера хоус 237, Отабек дамирчи 15, Уткир мини 126, Элликкала Бостон 19. Bu manbaning o‘z `Текширув` panelida ham bor. Qaytarish va pulini to‘lash birga yuritilgan, jimgina nolga kesish tarixni o‘zgartiradi.

## 6. Metama’lumotlar va katak izohlari

473:481-qatorda 9 hisob-faktura mavjud, raqamlar 395–403, hammasining statusi `ОТПРАВЛЕНО`. 473-qator X izohi: `Паддон: пулидан 2,470,000 сум кайтилоди`. Bu matnning o‘zi yangi refund yoki pallet operatsiya yaratishga yetarli emas; buyurtma izohi bo‘lib saqlanadi.

| Товар qatori | Mijoz | STIR | ESF |
|---|---|---|---|
| 473 | Отабек дамирчи | 308000738 | 395 |
| 474 | Отабек дамирчи | 308000738 | 396 |
| 475 | Бахти Ташкентский | 311040689 | 397 |
| 476 | Музаффар ога 8888 | 200408933 | 398 |
| 477 | Музаффар ога 8888 | 200408933 | 399 |
| 478 | Кахрамон ога Урганч | 304899373 | 400 |
| 479 | Кахрамон ога Урганч | 304899373 | 401 |
| 480 | Бахти Ташкентский | 311040689 | 402 |
| 481 | Музаффар ога 8888 | 200408933 | 403 |

10 katak izohi ham biznes kontekstini saqlaydi. Ular joriy qiymatni o‘zgartirishga ko‘rsatma emas; tarixiy kontekst sifatida izohga ko‘chirilishi mumkin:

| Katak | Izoh matni (muallif prefiksi bilan) |
|---|---|
| Q76 | ВАЖ |
| Q90 | ВАЖ |
| I140 | ids: / 517 750 |
| I152 | ids: / 517 750 |
| H213 | ids: / Нахт киммат нарх |
| H229 | ids: / Нахт киммат нарх |
| E406 | Пользователь: / 3/9 da sotilgan |
| E415 | ids: / 03/09 да сотилган |
| E424 | Пользователь: / 4/9 da sotildi |
| E468 | Пользователь: / 15/9 da sotildi |

## 7. Hisobotlar bo‘yicha qo‘shimcha tekshiruv

- **Мижоз картаси**: tanlangan mijoz Кахрамон ога Урганч. Sotuv 512 879 007,368421, tovar to‘lovi 486 090 000, qarz −26 789 007,368421; 472 berilgan = 365 qaytgan + 107 pulini to‘lagan. Asosiy mijoz reyestriga mos.
- **Қидирув**: `нахт` uchun 2 mijoz, `ога` uchun 4 agent natijasi saqlangan. Bu qidiruv yordami, biznes operatsiyasi emas.
- **Поставшиклар ҳисоби**: jami tannarx/to‘lov to‘g‘ri, yuqoridagi poddon semantik farqi bor. Quyi payment-history sarlavhalari `Дата / Сумма / Плателщик`, lekin cached natijalar `sana / kanal / summa`: source report ustunlari siljigan. Import bu qayta ko‘rinishdan foydalanmaydi.
- **Акт сверка**: Ментора, 2026-07 tanlangan. Gazoblok 1 125 051 750, poddon 142 350 000, jami 1 267 401 750, to‘lov 1 276 000 000, qoldiq +8 598 250. Bu faqat tanlangan davr.
- **Ҳисобот**: 2026-09-17, Ментора, shu kun oqimlari 0; hisobning oldingi qoldig‘i −418 480 708. All-factory jami −868 383 342, dona qarzi 4 159. Bu mijoz qarzi yoki saytning blok-only balansi emas.
- **Акт (умумий)**: 2026-09 tanlangan; yuqori blok oy, quyi blok barcha davr. Kanal bo‘sh 500 dona tufayli 65 000 000 farq va G23 xatosi bor.
- **KPI**: 2026-09 uchun hajm 2 430,216; transportdan keyingi foyda 144 399 834,000192; soliq 24 302 160; soliqdan keyin 120 097 674,000192; agent ulushi 40 032 558,000064; firma 80 065 116,000128. Barcha davr: foyda 822 513 032,7152592; soliq 147 832 560; qolgan 674 680 472,7152592; agent 224 893 490,90508637; firma 449 786 981,81017286. KPI formulasi import paytida qo‘shimcha payment/expense yaratmaydi.
- **Текширув**: 6 ortiqcha poddon mijoz, 17 avans mijoz. Noma’lum nom nazorati bo‘sh/mijozsiz Оплата 226-qatorini tutmaydi; manbadagi yashil holat importga avtomatik rozilik emas. Agent yig‘im nazoratida to‘liq tushum K ishlatilgan (9 270 350 900), mijoz tovar balansida esa poddon chiqarilgan P (8 888 800 900). Farqi aynan 381 550 000 poddon puli.

## 8. Importning qabul mezonlari

1. XLSB haqiqiy format sifatida ochiladi; 15 varaq/478 yetkazma/66 zavod to‘lovi/118 mijoz qaytarishi/14 zavod qaytarishi yo‘qolmaydi. Formula dumlari va hisobotlar operatsiya bo‘lmaydi.
2. Mijozsiz 163 350 000 review’da aniq bloklovchi holat; import uni jimgina tashlamaydi yoki payerdan mijoz o‘ylab topmaydi. To‘g‘ri mijoz manbada belgilangandan keyin pul hisobga tushadi.
3. Tannarx, transport, mijozga yoziladigan summa, bank/kassa/Click, refund, poddon charge va stornolar signed qiymatlarni saqlaydi. Takroriy/ortiqcha manba yozuvlari ochiq review qiladi.
4. Filtrlangan SUBTOTAL global reconciliation uchun ishlatilmaydi. Zavodning uch xil Excel hisobotidagi semantik farqlar izohlanadi; oldindan tasdiqlangan dona-only zavod siyosati o‘zgarmaydi.
5. ESF/STIR/status, qator izohi va mavjud katak izohlari yo‘qolmaydi. Pul deb talqin qilinmasligi kerak bo‘lgan metadata hisobni o‘zgartirmaydi.
6. Import preview va commit bir xil yaxlitlash ketma-ketligini qo‘llaydi; Decimal hisob qoidalari va rollback regressiyalari tekshiriladi. Manba nusxasi checksum bo‘yicha o‘zgarishsiz qoladi.

## 9. Amalga oshirilgan tekshiruvlar

`npm run test:import -w apps/api` parserning 90, qoidalarning 28, nomlarning 14 ta
golden tekshiruvini, shablon qo‘riqchisini va XLSB/XLSX, sana, izoh, moliyaviy tuzatish,
FIFO hamda keyingi buyurtmada poddon pulini qayta ishlatmaslik regressiyalarini bajaradi.

`npm run test:import:e2e -w apps/api` lokal `DATABASE_URL` orqali faqat o‘zi yaratgan
tasodifiy `import_xlsb_test_*` PostgreSQL sxemasida ishlaydi. Xohishga ko‘ra
`XLSB_TEST_DB_PORT` boshqa lokal test portini tanlaydi. Migratsiya, upload, muammoni
hal qilish, preview, commit va rollback tekshiriladi; sxema yakunda o‘chiriladi.

2026-09-22 sinovida alohida vaqtinchalik PostgreSQL 17 serverida **459 tekshiruv o‘tdi**.
478 buyurtma real test bazasiga yozildi; pul/poddon jamlari preview bilan mos keldi.
Rollback har bir mijoz, zavod, mashina, zavod hisob turi va kassa bo‘yicha alohida
nol qoldiq berdi. Keyingi buyurtma uchun qoladigan haqiqiy avans ham previewga teng.
Test serveri to‘xtatildi; mavjud biznes bazasi o‘zgartirilmadi.

Sinovda 226-qatorni `Гранд`ga biriktirish faqat test sharti sifatida ishlatildi.
Bu haqiqiy mijozni tasdiqlamaydi; original fayl va uning bo‘sh C226 katagi o‘zgarmagan.
Import oynasida mijozni foydalanuvchi belgilashi talab qilinadi. 18-qator yordamchi
I ustunidagi 500 dona esa review izohida saqlanadi, qaytarish miqdori deb olinmaydi.
