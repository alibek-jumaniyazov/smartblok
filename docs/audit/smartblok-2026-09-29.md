# Smartblok.xlsb — import, eksport va agent KPI auditi

Tekshiruv sanasi: 2026-09-29. Manba: `docs/Smartblok.xlsb`, 252 742 bayt.

SHA-256: `7f030c702dc17e18157cf15e522000a6994c77ba19ec7dd8353d036cf0754772`.

Bu fayl avvalgi `Smart blok.xlsb` bilan bir xil emas. Manba o‘zgartirilmadi. Avvalgi fayl `git HEAD`dan binar nusxa sifatida olinib, eski regressiyalar uchun `apps/api/test/import/fixtures/smart-blok-2026-09-22.xlsb`da saqlandi. Eski va yangi biznes qiymatlari alohida tekshirildi; eski test etalonlari yangi sonlarga almashtirib yashirilmadi.

## Tekshiruv usuli va chegarasi

15 varaqning **31 861 saqlangan katak qiymati**, jumladan formula natijasidagi bo‘sh matnlar, SheetJS 0.20.3 va mustaqil pyxlsb 1.0.10 bilan solishtirildi. Bitta ifoda farqi: `Акт (умумий)!G23` — SheetJS `29`, pyxlsb `0x1d`, ikkalasi ham Excel `#NAME?`. Boshqa qiymatlar aynan mos. SheetJS 20 149 formula katagini aniqladi. 548 yetkazmaning har bir hisoblangan ustuni, 248 to‘lovning pul/poddon taqsimoti, 57 mijoz qoldig‘i va barcha KPI bo‘limlari Decimal arifmetika bilan qayta hisoblandi.

XLSB uchun artifact-tool hujjatlashtirilgan import API yo‘q; binar formatni o‘qish uchun SheetJS/pyxlsb ishlatildi. SheetJS ayrim strukturali havolalarni `Table1[#?Current]` yoki umumiy `[#Data]` ko‘rinishida chiqaradi. Masalan `KPI!B62`dagi dekodlangan `SUM(B1048607:B1048637)` Excel qator chegarasidan oshadi: buni manba faylda aniq buzilgan formula deb da’vo qilish mumkin emas, bu dekoderning nisbiy havola ifodalash cheklovidir. Hisob ma’nosi, asl katak qiymatlari va mustaqil yig‘indilar tekshirildi; noto‘liq dekodlangan formula eksportga ko‘chirib qo‘yilmaydi.

Excelning o‘zida `CalculateFullRebuild` yoki vizual ekran tekshiruvi bajarilmadi. Auditdagi manba sonlari saqlangan natijalar va mustaqil hisobdan olingan, barcha Excel funksiyalarini boshqa dvigatelda qayta bajarish isboti emas. Binar faylning fontlar, son formatlari, ustun kengliklari, birlashmalar va yashirin qator/varaqlar metama’lumotlari o‘qildi. SheetJS orqali barcha rang/border/qoidalarni aynan tiklash kafolati yo‘q.

Fayl 1900 sanalar tizimida (`date1904=false`), hisoblash avtomatik, iteratsiya o‘chiq. Arxivda 82 qism, 9 Excel table, 10 katak izohi mavjud. Chart, VBA loyihasi va tashqi workbook havolasi yo‘q. Yaratilgan: 2026-05-10 07:06:29 UTC; oxirgi saqlash: 2026-09-28 11:17:22 UTC. `Текширув!H7`dagi makro qo‘yish matni faqat hujjat mazmuni sifatida o‘qildi, buyruq sifatida bajarilmadi.

## 1. Har bir varaqning vazifasi

| Varaq | Diapazon | Formula kataklari | Ko‘rinish va roli |
|---|---|---:|---|
| Кўрсаткичлар | A1:J67 | 1 | 57 mijoz, 6 agent, 2 zavod, parametrlar |
| Мижозлар қолдиғи | A1:N76 | 934 | Mijozlar qoldig‘i; 61 qator yashirilgan, jami filtrlangan |
| Мижоз картаси | A1:T200 | 15 | Tanlangan mijozning qoldiq/yetkazma/to‘lov/qaytarish kartasi |
| Қидирув | A1:J40 | 4 | Yashirin; mijoz va agent nomini qidirish |
| Поставшиклар ҳисоби | A1:I60 | 61 | Yashirin; zavodlarning tovar+poddon pul hisoboti |
| Акт сверка | A1:Z80 | 29 | Yashirin; bitta zavod va tanlangan oy bo‘yicha akt |
| Ҳисобот | A1:N36 | 63 | Bir kun, bir zavod va barcha zavodlar yakuni |
| Акт (умумий) | A1:AA23 | 116 | Oy va butun davr, CASH/BANK bo‘yicha zavod akti |
| KPI | A1:L64 | 350 | Tanlangan oy, butun davr va kunlik agent ulushi |
| Поддон қайтариш заводга | A1:L199 | 34 | 17 zavodga qaytarish, ombor paneli |
| Поддон қайтариш | A1:F138 | 1 | 134 mijoz poddon qaytarishi |
| Оплата | A1:T1101 | 8 482 | 248 mijoz to‘lovi/tuzatishi; ko‘p qator yashirilgan |
| Оплата поставшику | A1:H97 | 1 | 70 zavod to‘lovi |
| Товар | A1:AA1180 | 9 872 | 548 yetkazma, narx va hisob-faktura metama’lumotlari |
| Текширув | A1:J60 | 186 | Ortiqcha poddon, avans, lug‘at/to‘liqlik/agent nazorati |

Yig‘ma varaqlar mustaqil operatsiya emas: ularni asosiy qatorlar bilan birga import qilish ikki marta yozadi. Formula bilan to‘ldirilgan dumlar ham operatsiya emas. Haqiqiy yozuvlar oxiri Товар 551, Оплата 252, zavod to‘lovi 72, mijoz qaytarishi 137, zavod qaytarishi 20-qator.

### Кўрсаткичлар

`B4=130000` — poddon uchun zaxira narx. `B5=10000` — har m³ uchun KPI solig‘i. `B6=1/3` — agent ulushi, `B7=1-B6` — firma ulushi. B6 ko‘rsatishda 33,3% bo‘lsa ham biznes qiymati 0,333 yoki 0,33 ga kesilmasin. Mijozlar A10:E67, agentlar F10:G16, zavodlar I10:J12, to‘lov turlari I15:I17. Rasmiy nom/alias/oldingi varaq/agent har biri alohida ma’no beradi. Yangi mijozlar `Шовот` (Шохрух ога), `Склад` (Темур).

### Мижозлар қолдиғи

A agent; B mijoz; C mijozga yozilgan tovar; D tovar uchun to‘lov; E=D−C; F olingan poddon; G qaytarilgan; H puli to‘langan dona; I poddon puli; J=G+H−F; K poddon narxi; L=J×K; M=E+L. Manfiy qiymat mijoz qarzi, musbat qiymat avans/ortiqcha qaytarish. N15/N38/N42 dagi bir xil yuridik nom matnlari mijozlarni avtomatik birlashtirishga asos emas.

57 tafsilot qatorining C:M qiymatlari mustaqil operatsiyalardan hisoblanganda 0,011 so‘m aniqlikda mos. `C4` sarlavha o‘rnida 0 formulasi bor; haqiqiy C ustun ma’nosi C3da yozilgan. `A4:M75` filtri faqat Зафар ога bo‘yicha 10 haqiqiy qatorni ko‘rsatmoqda. `C76=3100815807,376421`, `D76=3092047280` barcha mijozlar yig‘indisi emas.

### Мижоз картаси va Қидирув

`Мижоз картаси!C3=Кахрамон ога Урганч`; E3 lug‘atdagi agent. A6:B17 qoldiq, D6:J… yuklar, L6:Q… to‘lovlar, boshqa pastki qism qaytarishlar. Kartada bir xil qatorning qayta ko‘rinishi import operatsiyasi bo‘lmaydi. Tovar to‘lovlari poddon pulidan ajratiladi. `Қидирув!B4=нахт`, E4=ога, natija mos ravishda 2 mijoz va 4 agent. Bu qidiruv holati, biznes filtrining majburiy sharti emas.

### Поставшиклар ҳисоби, Акт сверка, Ҳисобот, Акт (умумий)

`Поставшиклар ҳисоби` C tovar, E poddon pulini qo‘shib F to‘liq olingan summani, H=G−F qoldiqni chiqaradi; qaytarilgan poddonni bu jadval chegirmaydi. A11:C11 tarix sarlavhasida B=Сумма va C=Плателщик deb yozilgan, ammo B12:B30da to‘lov kanali, C12:C30da summa turibdi. Eksport bu siljigan sarlavhani takrorlamasin.

`Акт сверка!B4=Ментора`, B5=2026-07-01. Oy boshiga qoldiq, oy tovari, poddon, to‘lov, oy oxiridagi qoldiq CASH/BANKga ajratilgan; yordamchi oy ro‘yxati Z2:Z5. Bu tanlangan iyul ko‘rinishi sentabrdagi KPI davri bilan almashtirib talqin qilinmasin.

`Ҳисобот!B4=2026-09-26`, B5=Ментора. B8 ochilish, B9 blok, B10 poddon puli, B12 to‘lov, B13:B15 qaytarish dona/pul/xarajat, B17 yopilish. Tanlangan kundagi 6 mashina, 196,992 m³, 114 poddon, blok 119 180 160, poddon 14 820 000. Mavjud manba hisobi bo‘yicha Men­tora yakuni −787 148 548. B29:M32 barcha zavodlar bo‘yicha shu kunni takrorlaydi. N30/N31 yordamchi qo‘shimcha sonlar asosiy kirim yozuvi emas. Oy oxiri emasligi uchun B23/E35 solishtirishni raqam bilan 0 qilib ko‘rsatmaydi.

`Акт (умумий)!B2=2026-09-01`. 7:9 oy harakati, 13:15 butun davr. C/D tushum, E:H blok, I:L poddon, M jami, N:Q qaytarilgan poddon puli/dona, R/S qoldiq, T poddon qarzi. Qaytarish xarajati kanalidan qat’i nazar C kataklardagi kassa tushumiga qo‘shiladi — bu manbaning hisob ma’nosi, real yangi bank/kassa tushumi deb takror import qilinmaydi. G23 `КОН` bo‘sh aniqlangan nomiga tayangan `#NAME?` xatosi saqlanib qolgan; yangi hisob fayliga ko‘chirilmasin.

**Zavod hisobidagi mavjud siyosat farqi:** loyiha zavod poddonlarini dona sifatida yuritadi. Manbaning yuqoridagi hisobotlari esa poddon pulini zavod qarziga qo‘shib, qaytarilganini pul sifatida chegiradi. KPI hisoblash va import/export moslashuvi bu avvaldan mavjud biznes siyosatini o‘zboshimcha almashtirishga asos emas. Loyiha zavod pul qarzi blok tannarxidan hisoblanadi; poddon dona ko‘rsatkichi alohida. Hisobotlarda bu farq tushunarli nomlanishi kerak.

### Товар — barcha 27 ustun

| Ustun | Mazmun va formula |
|---|---|
| A | Завод тўлов тури: Касса yoki Перечисления |
| B | Поставшик, har yetkazmaning zavodi |
| C | Kiritilgan agent |
| D | Mijoz nomi |
| E | Sana; tarixiy kalendar kuni |
| F | Mashina raqami |
| G | Blok o‘lchami |
| H | Hajm m³, 3 kasr aniqligi |
| I | Zavod narxi, m³ uchun |
| J | H×I, blok tannarxi |
| K | Poddon dona |
| L | Poddon narxi |
| M | K×L |
| N | J+M, manbaning blok+poddon jami |
| O | Sotuv narxi/m³; kasr narxni oldindan 2 kasrga kesmaslik kerak |
| P | H×O, sotuv |
| Q | Transport to‘lovchisi Клиент yoki Сотувчи |
| R | P−J−S, transportdan keyingi va soliqdan oldingi foyda |
| S | Transport xarajati |
| T | P−(Q=Клиент ? S : 0), mijozdan olinadigan summa |
| U | Lug‘atdagi agent, bo‘lmasa C; KPI shu ustunga bog‘liq |
| V | Agent moslik tekshiruvi |
| W | Lug‘atdagi ruxsat etilgan agent |
| X | Operatsiya izohi, 26 qatorda mavjud |
| Y | STIR identifikatori, 42 qatorda |
| Z | ESF raqami, 42 qatorda |
| AA | ESF holati, 42 qatorda |

548 qatorning barchasida U=C. Zavodlar: Коалс 180 qator, Ментора 368. To‘lov niyati: BANK 544, CASH 4. Transport: mijoz 417, sotuvchi 131. Qatordagi E sanasi asosiy sana: katak izohida boshqa sotilgan sana yozilgan bo‘lsa, u avtomatik sana o‘rniga qo‘yilmaydi, metadata sifatida saqlanadi.

### Оплата — barcha biznes ustunlari

A sana; B agent; C mijoz; D bank; E to‘lovchi; F poddon dona; G=F×G3 eski yordamchi narx; H naqd; I Click; J terminal; K=D+H+I+J; L qabul qiluvchi; M izoh; N sana bo‘yicha topilgan poddon narxi yoki B4 zaxira narx; O=F×N; P=K−O; Q lug‘atdan agent; R tekshiruv; S ruxsat etilgan agent. T ma’lumot hududi biznes ustuni emas.

17 tarixiy qatorda tuzatish bor, lekin tarixiy to‘lov summalari qayta yig‘ilganda operatsiyalar soni kamaymaydi. F musbat va K=0 bo‘lganda bu yangi pul tushumi emas, avvalgi avansning poddonga ajratilishi. F manfiy va K=0 bo‘lganda avvalgi poddon undiruvi bekor qilinib tovar avansi qaytariladi. Manfiy D/H/I/J haqiqiy pul refundini anglatadi.

`Оплата`da 1 056 yashirilgan qator, amaldagi 248 yozuv ichida faqat 103, 211, 240 qatorlar ko‘rinadi. `K3=800000000` faqat shu ko‘rinayotgan uch to‘lov yig‘indisi. Barcha yozuvlar bo‘yicha to‘lov 10 963 498 340. Import/eksport ko‘rinmayotgan operatsiyalarni yo‘qotmasin.

### Qaytarish va zavod to‘lovi

`Оплата поставшику` sarlavha 2-qator: A sana, B В-о kanal, C summa, D Плательщик, E Получатель. 70 haqiqiy yozuv, kassa 50 000 000, bank 8 624 239 420.

`Поддон қайтариш` sarlavha 3-qator: A sana, B mijoz, C dona, D izoh. 134 yozuvning signed dona yig‘indisi 6 499. Tarixiy −19/−8 tuzatishlari saqlanadi; ularni 0 qilib kesish yoki tashlash mumkin emas.

`Поддон қайтариш заводга` sarlavha 3-qator: A sana, B haqiqiy qabul qilingan dona, C jo‘natuvchi, D zavod, E bir dona qaytarish xarajati, F=B×E, G izoh, H kanal, I yordamchi hisob, J:L ombor paneli. 17 haqiqiy yozuvda signed dona 5 892, xarajat 19 368 000. −113 brak qaytarish manfiyligicha qoladi. I15=485 bilan B15=480 farqi 5 brak va izoh bilan tushuntirilgan; haqiqiy miqdor Bdan olinadi. K4=6499, K5=5892, K6=L6=607 — operatsiya emas, ombor nazorati.

### Текширув

1) Uch mijozda ortiqcha qaytargan/to‘lagan poddon bor: Журат ога хонка +104, Одилбек Ера хоус +373, Элликкала Бостон +19. 2) Avans bo‘limi 18 mijozni chiqaradi. 3) Mijoz/agent/zavod nomlari lug‘atda bor. 4) To‘liq bo‘lmagan tovar qatorlari 0. 5) Agent yig‘imi kassa tushumi bilan mijozga yozilgan tovar summasini solishtiradi; bunda poddon puli ajratilmagan. Shuning uchun `Текширув!D60=152265479,9432602` tovar sof qarzi 539 015 479,943259 ga teng bo‘lishi shart emas — farq poddon puli 386 750 000.

## 2. Avvalgi fayldan o‘zgargan muhim qiymatlar

- 70 yetkazma, 24 mijoz to‘lovi, 4 zavod to‘lovi, 16 mijoz qaytarishi qo‘shilgan. Zavod qaytarishidagi oldin tugallanmagan 18-qator to‘ldirilgan va 19/20-qatorlar qo‘shilgan.
- `Товар!A468`: Касса → Перечисления. `I473:I481`: 574 750 → 605 000, jami 9 tarixiy yetkazmaning tannarxi o‘zgargan.
- `Оплата!B226/C226` endi Шохрух ога / Шовот. 163 350 000 so‘mni oldingi taxmin bo‘yicha Грандga bog‘lash mumkin emas.
- `Оплата!F` tuzatishlari: 93 19→57; 103 107→104; 116 117→106; 138 38→bo‘sh; 143 57→35; 146 19→bo‘sh; 147 38→bo‘sh; 160 57→bo‘sh; 162 76→8; 163 5→bo‘sh; 184 152→45; 206 bo‘sh→19; 211 bo‘sh→38; 221 22→41; 222 133→51; 223 bo‘sh→4.
- Poddon bekor qilish qatorlari: Оплата190 −71, 238 −9, 245 −88. 244/246/247 qatorlarda har biri +19 dona, K=0 va P=−2 470 000. 246 va 247 qiymatlari bir xil ko‘rinsa ham manbada ikki mustaqil qator mavjud; o‘zboshimcha birini o‘chirish mumkin emas.
- `Оплата!252` — 2026-09-08 sanali −1 000 000 bank qaytarishi, eng oxiriga kiritilgan. Qatorlar ketma-ketligini sana bo‘yicha tartiblangan deb taxmin qilish noto‘g‘ri.
- `Поддон қайтариш заводга!18` — 2026-09-15, 500 dona Ментора; 19 va 20 — har biri 2026-09-22, 500 dona. Xarajat 0, kanal Перечисления. Oldingi 18-qator yonidagi 500 yordamchi raqam bilan yangi B18 haqiqiy dona aralashtirilmasin.

Yangi fayl avvalgi operatsiyalarni ham o‘zgartirgan. Uni mavjud bazaga qo‘shimcha sifatida to‘liq takror import qilish tarixni ikki marta yozishi mumkin. Mavjud import rejimi va review nazorati saqlanishi kerak.

## 3. Mustaqil moliyaviy nazorat jami

| Ko‘rsatkich | Qiymat |
|---|---:|
| Yetkazilgan hajm | 16 983,000 m³ |
| Zavod blok tannarxi | 9 942 104 394,00 |
| Sotuv P | 12 105 787 819,914259 |
| Transport S | 1 290 596 105,198000 |
| Transportdan oldingi foyda P−J | 2 163 683 425,914259 |
| Transportdan keyingi KPI foydasi R | 873 087 320,716259 |
| Mijozga yoziladigan T | 11 115 763 819,943259 |
| Bank tushumi D | 10 493 765 580,00 |
| Naqd H | 444 167 760,00 |
| Click I | 25 565 000,00 |
| Terminal J | 0,00 |
| Barcha pul K | 10 963 498 340,00 |
| Poddon puli O | 386 750 000,00 |
| Tovar uchun pul P | 10 576 748 340,00 |
| Mijoz tovar sof qarzi | 539 015 479,943259 |
| Mijoz poddon sof qarzi | 350 dona / 45 500 000,00 |
| Mijoz jami sof qarzi | 584 515 479,943259 |
| Zavodga pul to‘lovi | 8 674 239 420,00 |
| Zavod blok bo‘yicha qarz | 1 267 864 974,00 |
| Berilgan poddon | 9 824 dona |
| Mijoz qaytargan | 6 499 dona |
| Puli to‘langan | 2 975 dona |
| Zavodga qaytgan | 5 892 dona |
| Zavod poddon qarzi | 3 932 dona |
| Ombor | 607 dona |
| Zavodga qaytarish xarajati | 19 368 000,00 |

Poddon konservatsiyasi: **3 932 = 350 + 607 + 2 975**, farq 0.

Har bir qator natijasi 2 kasrga yaxlitlanganda J=9 942 104 394,00; P=12 105 787 819,91; R=873 087 320,71; T=11 115 763 819,93. Avval transport va sotuv alohida yaxlitlanadigan bazadagi hisob bundan sentga farq qilishi mumkin; ikki turdagi yaxlitlashni bir tekshiruvda aralashtirmaslik kerak. Hajm/narxni hisobdan oldin noto‘g‘ri kesish esa oddiy ko‘rsatish farqi emas.

## 4. KPI — aniq biznes qoidasi

KPI tanlangan oyning yetkazmalari bo‘yicha hisoblanadi. Sana — `Товар!E`, agent — U, hajm — H, foyda — R. R=P−J−S bo‘lgani sabab transport ikkinchi marta ayrilmaydi. To‘lov sanasi, to‘langanlik darajasi, undirilgan pul, zavod bonuslari yoki poddon puliga bog‘liq shart yo‘q.

Har agent uchun:

```text
hajm       = SUM(shu agentga tegishli H)
foyda      = SUM(shu agentga tegishli P − J − S)
soliq      = hajm × soliqNarxi
sofFoyda   = foyda − soliq
agentKpi   = sofFoyda × agentUlushi
firmaFoyda = sofFoyda × (1 − agentUlushi)
```

Soliq 10 000 so‘m/m³, agent ulushi aniq 1/3. Pog‘ona, minimal savdo, maqsad foizi, limit, kechiktirilgan to‘lov jarimasi yoki `MAX(0, sofFoyda)` yo‘q. Zarar bo‘lsa manfiy KPI saqlanadi. Oyning chegarasi tizimda kalendar oy boshidan keyingi oy boshigacha, yuqori chegara kiritilmaydigan shart bilan olinishi mumkin; bu oy oxiridagi vaqtli yozuvlarni ham qamraydi.

Agent ustuvorligi: mijoz lug‘atidagi agent mavjud bo‘lsa shu agent, aks holda operatsiya agenti. Mavjud agent bilan keyingi qayta biriktirish vaqtida tarixni qanday saqlash loyihaning agent modeliga mos izchil amalga oshirilishi kerak. Ushbu manbada 548 qatorda C va U teng.

KPI jadvalining birinchi bo‘limi A9:I16 — 2026-09, ikkinchisi A19:I26 — 2026-06-24…2026-09-26. Uchinchisi A30:G62 — sentabrning har kuni, barcha agentlar jamlangan. Sotuvsiz kunlar 0; sentabr uchun 31-kun bo‘sh. `F64=B62−C16`, `G64=C62−D16`: kunlik va agent kesimidagi hajm/foyda farqi 0.

Asosiy sarlavhalar: №, Агент, Сотган миқдор (куб), Фойда (сўм), Солиқ нархи (1 куб), Солиқ суммаси, Соф фойда, Агент KPI, Фирма фойдаси. Ko‘rsatish hajmi 2 kasrga formatlangan bo‘lsa ham saqlangan 3-kasr hajm yo‘qolmasin. Foiz 1 kasr, pul manbada butun so‘m ko‘rinishida; hisobda kasr qiymatlar mavjud.

## 5. Eksport va import uchun shartlar

- XLSB binar o‘qish va XLSX chiqishi haqiqiy format nomi bilan ko‘rsatilishi kerak. Faqat kengaytmani almashtirish konversiya emas.
- Beshta asosiy operatsiya jadvali yuqoridagi ustunlar, sanalar, signed tuzatishlar va metadata bilan qayta import qilinadigan bo‘lsin. Parametrlar va 57 mijoz/6 agent/2 zavod lug‘ati alohida saqlansin.
- Moliyaviy hisoblar bitta aniq xizmatdan olinib, ekrandagi KPI va Excel natijasi bir davr/bir narx/bir yaxlitlash bilan mos kelsin. KPI eksporti oyning olti agent qatori, butun davr va kunlik kesimni qamrasin.
- Foyda R bilan yalpi P−J bir xil ko‘rsatkich deb nomlanmasin. Agent KPI bazasi R−soliq.
- Formula maydonlari yangi faylning o‘z ma’lumotlariga bog‘lansin; source fayldagi eski kesh yoki noto‘liq dekodlangan strukturali formula ko‘chirilmasin.
- Manba bo‘yicha bo‘sh qator, formula dumi, hidden/filter holati sabab haqiqiy yozuv tushib qolmasin. Filtrlangan SUBTOTAL ma’lumot yaxlitligi nazorati emas.
- Izoh/ESF/STIR, 0 puldagi poddon yozuvi va manfiy refund qayta importda yo‘qolmasin; qo‘shimcha asosiy manba bo‘lmagan hisobot varaqlari yangi tranzaksiya bo‘lmasin.
- Asl fayldagi G23 xatosi, supplier history sarlavha siljishi, C4 formula-sarlavha va makro ko‘rsatmalari mahsulotning ishchi hisobiga ko‘chirilmasin.

## 6. Regressiya tekshiruvlari

`apps/api/test/import/smartblok-2026-09-29.regression.ts` yangi faylning mustaqil nazorat qiymatlarini tekshiradi: barcha qatorlar, tarixiy tuzatishlar, to‘lov egasi, haqiqiy formula ustunlari, barcha agent/kun KPIlari, metadata va filtrga bog‘liq bo‘lmagan qoldiqlar. Eski 2026-09-22 regressiyalari o‘z muzlatilgan nusxasida mijozsiz to‘lov/to‘liq bo‘lmagan qaytarish holatlarini tekshirishda davom etadi.

Quyidagi tafsilot jadvallari source kataklaridan mustaqil yig‘ilgan va ko‘rsatish uchun 2 kasrga yaxlitlangan. Ushbu ko‘rsatish yaxlitlashlari hisobning bazadagi pul aniqligini almashtirmaydi.


## 7. Sentabr 2026 — agentlar

| Agent | Hajm, m³ | Foyda | Soliq | Sof foyda | Agent KPI | Firma ulushi |
|---|---:|---:|---:|---:|---:|---:|
| Арслон ога | 263,304 | 14 451 738,00 | 2 633 040,00 | 11 818 698,00 | 3 939 566,00 | 7 879 132,00 |
| Жамол 22-22 | 0,000 | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 |
| Зафар ога | 1 740,096 | 72 581 376,00 | 17 400 960,00 | 55 180 416,00 | 18 393 472,00 | 36 786 944,00 |
| Сардор ога | 1 149,120 | 47 059 984,00 | 11 491 200,00 | 35 568 784,00 | 11 856 261,33 | 23 712 522,67 |
| Темур | 886,464 | 40 247 712,00 | 8 864 640,00 | 31 383 072,00 | 10 461 024,00 | 20 922 048,00 |
| Шохрух ога | 590,976 | 20 633 312,00 | 5 909 760,00 | 14 723 552,00 | 4 907 850,67 | 9 815 701,33 |
| **Jami** | 4 629,960 | 194 974 122,00 | 46 299 600,00 | 148 674 522,00 | 49 558 174,00 | 99 116 348,00 |

## 8. Butun davr — agentlar

| Agent | Hajm, m³ | Foyda | Soliq | Sof foyda | Agent KPI | Firma ulushi |
|---|---:|---:|---:|---:|---:|---:|
| Арслон ога | 992,088 | 72 444 166,01 | 9 920 880,00 | 62 523 286,01 | 20 841 095,34 | 41 682 190,67 |
| Жамол 22-22 | 1 480,896 | 83 021 702,74 | 14 808 960,00 | 68 212 742,74 | 22 737 580,91 | 45 475 161,83 |
| Зафар ога | 4 753,728 | 232 615 887,38 | 47 537 280,00 | 185 078 607,38 | 61 692 869,13 | 123 385 738,25 |
| Сардор ога | 3 205,440 | 145 479 216,85 | 32 054 400,00 | 113 424 816,85 | 37 808 272,28 | 75 616 544,57 |
| Темур | 4 157,568 | 187 138 704,00 | 41 575 680,00 | 145 563 024,00 | 48 521 008,00 | 97 042 016,00 |
| Шохрух ога | 2 393,280 | 152 387 643,73 | 23 932 800,00 | 128 454 843,73 | 42 818 281,24 | 85 636 562,49 |
| **Jami** | 16 983,000 | 873 087 320,72 | 169 830 000,00 | 703 257 320,72 | 234 419 106,91 | 468 838 213,81 |

## 9. Oylar bo‘yicha mustaqil KPI nazorati

| Oy | Hajm, m³ | Foyda | Soliq | Sof foyda | Agent KPI | Firma ulushi |
|---|---:|---:|---:|---:|---:|---:|
| 2026-06 | 680,832 | 117 498 040,35 | 6 808 320,00 | 110 689 720,35 | 36 896 573,45 | 73 793 146,90 |
| 2026-07 | 5 102,928 | 227 999 386,78 | 51 029 280,00 | 176 970 106,78 | 58 990 035,59 | 117 980 071,18 |
| 2026-08 | 6 569,280 | 332 615 771,59 | 65 692 800,00 | 266 922 971,59 | 88 974 323,86 | 177 948 647,73 |
| 2026-09 | 4 629,960 | 194 974 122,00 | 46 299 600,00 | 148 674 522,00 | 49 558 174,00 | 99 116 348,00 |

## 10. Sentabr kunlik kesimi

| Sana | Hajm, m³ | Foyda | Soliq | Sof foyda | Agent KPI | Firma ulushi |
|---|---:|---:|---:|---:|---:|---:|
| 01.09.2026 | 65,664 | 3 937 696,00 | 656 640,00 | 3 281 056,00 | 1 093 685,33 | 2 187 370,67 |
| 02.09.2026 | 263,304 | 15 844 906,00 | 2 633 040,00 | 13 211 866,00 | 4 403 955,33 | 8 807 910,67 |
| 03.09.2026 | 262,656 | 15 750 784,00 | 2 626 560,00 | 13 124 224,00 | 4 374 741,33 | 8 749 482,67 |
| 04.09.2026 | 98,496 | 5 906 544,00 | 984 960,00 | 4 921 584,00 | 1 640 528,00 | 3 281 056,00 |
| 05.09.2026 | 98,496 | 5 706 544,00 | 984 960,00 | 4 721 584,00 | 1 573 861,33 | 3 147 722,67 |
| 06.09.2026 | 32,832 | 1 968 848,00 | 328 320,00 | 1 640 528,00 | 546 842,67 | 1 093 685,33 |
| 07.09.2026 | 32,832 | 1 968 848,00 | 328 320,00 | 1 640 528,00 | 546 842,67 | 1 093 685,33 |
| 08.09.2026 | 131,328 | 7 675 392,00 | 1 313 280,00 | 6 362 112,00 | 2 120 704,00 | 4 241 408,00 |
| 09.09.2026 | 164,160 | 9 844 240,00 | 1 641 600,00 | 8 202 640,00 | 2 734 213,33 | 5 468 426,67 |
| 10.09.2026 | 361,152 | 21 657 328,00 | 3 611 520,00 | 18 045 808,00 | 6 015 269,33 | 12 030 538,67 |
| 11.09.2026 | 164,160 | 9 844 240,00 | 1 641 600,00 | 8 202 640,00 | 2 734 213,33 | 5 468 426,67 |
| 12.09.2026 | 131,328 | 7 875 392,00 | 1 313 280,00 | 6 562 112,00 | 2 187 370,67 | 4 374 741,33 |
| 13.09.2026 | 0,000 | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 |
| 14.09.2026 | 328,320 | 18 699 440,00 | 3 283 200,00 | 15 416 240,00 | 5 138 746,67 | 10 277 493,33 |
| 15.09.2026 | 295,488 | 8 781 120,00 | 2 954 880,00 | 5 826 240,00 | 1 942 080,00 | 3 884 160,00 |
| 16.09.2026 | 0,000 | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 |
| 17.09.2026 | 0,000 | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 |
| 18.09.2026 | 295,488 | 6 829 760,00 | 2 954 880,00 | 3 874 880,00 | 1 291 626,67 | 2 583 253,33 |
| 19.09.2026 | 295,488 | 5 854 080,00 | 2 954 880,00 | 2 899 200,00 | 966 400,00 | 1 932 800,00 |
| 20.09.2026 | 65,664 | 1 951 360,00 | 656 640,00 | 1 294 720,00 | 431 573,33 | 863 146,67 |
| 21.09.2026 | 558,144 | 15 807 200,00 | 5 581 440,00 | 10 225 760,00 | 3 408 586,67 | 6 817 173,33 |
| 22.09.2026 | 196,992 | 5 854 080,00 | 1 969 920,00 | 3 884 160,00 | 1 294 720,00 | 2 589 440,00 |
| 23.09.2026 | 328,320 | 9 556 800,00 | 3 283 200,00 | 6 273 600,00 | 2 091 200,00 | 4 182 400,00 |
| 24.09.2026 | 0,000 | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 |
| 25.09.2026 | 262,656 | 7 805 440,00 | 2 626 560,00 | 5 178 880,00 | 1 726 293,33 | 3 452 586,67 |
| 26.09.2026 | 196,992 | 5 854 080,00 | 1 969 920,00 | 3 884 160,00 | 1 294 720,00 | 2 589 440,00 |
| 27.09.2026 | 0,000 | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 |
| 28.09.2026 | 0,000 | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 |
| 29.09.2026 | 0,000 | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 |
| 30.09.2026 | 0,000 | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 |

## 11. 57 mijoz bo‘yicha manba qoldiqlari

Belgi manbadagidek: musbat — avans, manfiy — qarz. Poddon ustuni signed dona. Qoldiq foyda yoki KPI emas.

| Mijoz | Agent | Tovar qoldig‘i | Poddon dona | Jami qoldiq |
|---|---|---:|---:|---:|
| Алибобо | Шохрух ога | 15 860 000,00 | -122 | 0,00 |
| Бахтиёр ога Шовот | Зафар ога | -18 891 120,00 | 0 | -18 891 120,00 |
| Бунёдкор | Шохрух ога | 0,00 | 0 | 0,00 |
| Газ сув монтаж | Шохрух ога | 0,00 | -5 | -650 000,00 |
| Гайрат Штб | Шохрух ога | 0,00 | 0 | 0,00 |
| Гофур хазорасп | Арслон ога | 0,00 | 0 | 0,00 |
| Жамол 009 | Шохрух ога | -91 929 600,00 | 0 | -91 929 600,00 |
| Жаср Версал | Темур | 0,00 | 0 | 0,00 |
| Журат ога хонка | Темур | 7 409 600,00 | 104 | 20 929 600,00 |
| Инвест Холдинг | Шохрух ога | 0,00 | 0 | 0,00 |
| Инноватцион | Жамол 22-22 | -480 520 960,00 | -41 | -485 850 960,00 |
| Ирригатсия темир бетон | Шохрух ога | 0,00 | 0 | 0,00 |
| Кахрамон ога Урганч | Зафар ога | 55 720 592,63 | 0 | 55 720 592,63 |
| Кувондик курувчи | Арслон ога | 0,00 | -19 | -2 470 000,00 |
| Мактаб | Темур | -200,00 | 0 | -200,00 |
| Мамун Университети | Сардор ога | 80,00 | 0 | 80,00 |
| Музаффар 0010 | Сардор ога | -279,55 | 0 | -279,55 |
| Мурод ога 4884 | Зафар ога | -49 199 440,00 | 0 | -49 199 440,00 |
| Мурод ога Урганч | Зафар ога | 0,00 | 0 | 0,00 |
| Мустафо машал | Темур | 752 000,00 | 0 | 752 000,00 |
| Мята Газаблок | Темур | -4 529 040,00 | 0 | -4 529 040,00 |
| Нахт клиент-А | Арслон ога | 8 000,00 | -2 | -252 000,00 |
| Низомиддин хонка | Темур | 0,00 | 0 | 0,00 |
| Нормат Умидбек | Шохрух ога | -803 200,00 | -4 | -1 323 200,00 |
| Одилбек Ера хоус | Темур | 53 161 480,00 | 373 | 101 651 480,00 |
| Отабек дамирчи | Сардор ога | 37 030 080,00 | -57 | 29 620 080,00 |
| Рустам Шпик | Шохрух ога | -28 365 040,36 | -64 | -36 685 040,36 |
| Сарвар ога Шовот | Зафар ога | -520 000,00 | 0 | -520 000,00 |
| Сохил буйи Уткир ога | Сардор ога | 459,99 | -6 | -779 540,01 |
| Сулаймон Ога Газаблок | Зафар ога | 1 902 239,99 | 0 | 1 902 239,99 |
| Сулаймон Ога Хазарасп | Зафар ога | 0,00 | 0 | 0,00 |
| Уктир ога Шовот | Зафар ога | 0,00 | -38 | -4 940 000,00 |
| Урганч сити | Жамол 22-22 | -12 894 400,00 | 0 | -12 894 400,00 |
| Урганч Тамирлаш | Жамол 22-22 | 295 000 000,02 | -36 | 290 320 000,02 |
| Уткир мини | Сардор ога | -19 369 040,00 | -38 | -24 309 040,00 |
| Фидато Груп | Шохрух ога | -1 920,00 | -3 | -391 920,00 |
| Фм хоус | Сардор ога | 8 399,98 | 0 | 8 399,98 |
| Хонкага | Жамол 22-22 | -128 127 360,00 | -12 | -129 687 360,00 |
| Шиддат маналит | Арслон ога | -28 548 060,01 | -19 | -31 018 060,01 |
| Элликкала Бостон | Шохрух ога | -2 346 652,63 | 19 | 123 347,37 |
| Акмал 91 510 50 01 | Шохрух ога | 360 960,00 | -19 | -2 109 040,00 |
| Нахт клиент-С | Сардор ога | 0,00 | 0 | 0,00 |
| Бахти Ташкентский | Темур | 4 072 480,00 | -19 | 1 602 480,00 |
| Хонка Про-Макс | Темур | 0,00 | 0 | 0,00 |
| NO WAY MCHJ Турткул | Зафар ога | -0,00 | 0 | -0,00 |
| Сухроб 00-00 | Темур | -727 120,00 | 0 | -727 120,00 |
| Фаррух 85-88 | Шохрух ога | 27 782 880,00 | -57 | 20 372 880,00 |
| Бобур чакка | Шохрух ога | -25 105 220,00 | 0 | -25 105 220,00 |
| Мирза ога кушкупир | Арслон ога | 1 920,00 | 0 | 1 920,00 |
| Жасур Стар Сити | Темур | 0,00 | 0 | 0,00 |
| Жамол 009 (Сардор ога) | Сардор ога | -2 509 040,00 | 0 | -2 509 040,00 |
| Музаффар ога 8888 | Зафар ога | 2 219 200,00 | 0 | 2 219 200,00 |
| Алибобо (Сардор ога) | Сардор ога | -189 112 320,00 | -152 | -208 872 320,00 |
| Турткул 5555 | Шохрух ога | -0,00 | -19 | -2 470 000,00 |
| Гранд | Шохрух ога | 0,00 | 0 | 0,00 |
| Шовот | Шохрух ога | 64 033 200,00 | -95 | 51 683 200,00 |
| Склад | Темур | -20 839 040,00 | -19 | -23 309 040,00 |
| **Jami** | | -539 015 479,94 | -350 | -584 515 479,94 |

## 12. Zavodlar bo‘yicha nazorat

| Zavod | Hajm, m³ | Blok tannarxi | To‘lov | Poddon olingan | Qaytgan | Poddon qarzi | Qaytarish xarajati |
|---|---:|---:|---:|---:|---:|---:|---:|
| Коалс | 5 694,696 | 3 273 345 846,00 | 2 395 089 420,00 | 3 295 | 2 421 | 874 | 19 368 000,00 |
| Ментора | 11 288,304 | 6 668 758 548,00 | 6 279 150 000,00 | 6 529 | 3 471 | 3 058 | 0,00 |

## 13. Saqlanadigan 10 katak izohi

| Varaq/katak | Muallif | Matn |
|---|---|---|
| Товар!Q76 | ids | ВАЖ |
| Товар!Q90 | ids | ВАЖ |
| Товар!I140 | ids | ids: / 517 750 |
| Товар!I152 | ids | ids: / 517 750 |
| Товар!H213 | ids | ids: / Нахт киммат нарх |
| Товар!H229 | ids | ids: / Нахт киммат нарх |
| Товар!E406 | Пользователь | Пользователь: / 3/9 da sotilgan |
| Товар!E415 | ids | ids: / 03/09 да сотилган |
| Товар!E424 | Пользователь | Пользователь: / 4/9 da sotildi |
| Товар!E468 | Пользователь | Пользователь: / 15/9 da sotildi |

## 14. Format va mavjud Excel obyektlari

- Sonlar haqiqiy numeric; sana numeric serial + sana formati. Hajm uchun 0,000 saqlash, KPI uchun 0,00 ko‘rsatish bir-biridan ajraladi. Son formatlarida qizil manfiylar va nol uchun tire qo‘llangan. Mijoz qoldig‘ida musbat yashil, manfiy qizil formatlar mavjud.
- Asosiy fontlar Aptos Narrow va Arial, eski izohlarda Tahoma. Bu audit barcha font yozuvlarini va CellXf son formatlarini o‘qidi, lekin Excel ekranidagi yakuniy rang va borderlarni render orqali tasdiqlamadi.
- KPI!A1:I1 sarlavha birlashgan; A8:I8 oy bo‘limi, A18:E18 butun davr, F18:I18 davr matni, A28:I28 hisob izohi, A29:C29 kunlik bo‘limi va D29:G29 davr matni birlashgan. Uch biznes jadvalidagi ma’lumot ustunlari alohida.
- KPI ustun kengliklari: A=44; B=13,4258; C=19; D=15,5703; E=19,5703; F=15,5703; G=19,2852; H=20; I=20. L oylar yordamchi ro‘yxati; 2026-06,07,08,09.
- Ko‘rinadigan named ranges: АгентРўйхати, МижозРўйхати, ПоставшикРўйхати, ТурРўйхати. Qo‘shimcha _xlfn/_xlpm nomlari Excelning zamonaviy formula yordamchi nomlari; ularning #NAME? markerlari har biri alohida xato katagi degani emas. `КОН` bo‘sh nomi G23 xatosiga sabab bo‘lgan.
- Manba shablonidagi uch yashirin hisobot va filtrlash holati hisobning to‘liq manba qamrovini o‘zgartirmaydi. Yangi foydalanuvchi eksporti barcha agent va operatsiyalarni odatiy holatda ko‘rsatishi kerak.

## 15. Yakuniy tekshiruv — 02.10.2026

- Yangi faylning manba shartnomasi: **2 436 tekshiruv**; eski import lifecycle: **462 tekshiruv**. Alohida PostgreSQL sinov bazasida yangi faylni import → KPI → eksport → eksportni haqiqiy qayta import qilish → rollback zanjiri **437 tekshiruvdan** o‘tdi. Qayta import qilingan bazaning moliyaviy natijalari eksport olingan bazaga aynan mos keldi.
- KPI hisoblagichi: **308**, KPI ning bazadagi ssenariylari: **39**; import sozlamalari: **55** va ularning bazadagi ssenariylari: **168**; realtime yangilanishlar: **68**; foizni aniq o‘girish: **32 tekshiruv**. API va web build muvaffaqiyatli yakunlandi.
- Brauzerda oylik, kunlik va butun davr KPI, agentning faqat o‘z hisobotini ko‘rishi va sozlamalarni qiymatini o‘zgartirmay saqlash tekshirildi. Tekshirilgan oqimlarda konsol xatolari: **0**.
- Yakuniy eksport **43 varaqdan** iborat: manbaga mos 15 varaq va 28 qo‘shimcha diagnostika varag‘i. `Поддон қайтариш заводга!K6` dagi `K4-K5` formulasi keshi **607 dona** ombor qoldig‘ini ko‘rsatadi.
- Yakuniy eksportni alohida tekshirishdagi **47 tasdiq** muvaffaqiyatli: barcha 43 varaq bo‘yicha formula keshlarida xato **0**; KPI ning oylik `H16` yig‘indisi butun so‘mga yaxlitlanganda **49 558 174**, butun davr `H26` yig‘indisi **234 419 107**.
- Manba Excel kasrlarini bazaning ikki kasr xonasiga ega pul ustunlari bilan solishtirishda umumiy yig‘indiga **0,15 so‘m** tolerans qo‘llandi. Bu chegaradan alohida ravishda, bazadan eksport va haqiqiy qayta import natijalari aniq mosligi tekshirildi.
- Yakuniy `.xlsx` faylining KPI (`A1:I26`), sozlamalar (`A1:J16`) va mijoz qoldiqlari (`A1:N12`) qismlari artifact-tool orqali PNG ga render qilinib, ko‘zdan kechirildi: sarlavhalar, ustunlar va summalar o‘qiladi. Renderer KPI oyini sana o‘rniga `46266` seriali sifatida ko‘rsatdi; faylni ExcelJS bilan qayta o‘qish `D3` qiymati **01.09.2026**, formati **`mm.yyyy`** ekanini tasdiqladi. Bu render tekshiruvi Microsoft Excel ichidagi qayta hisoblash tekshiruvi emas; native Excel recalculation sinovi bajarilgani da’vo qilinmaydi.
