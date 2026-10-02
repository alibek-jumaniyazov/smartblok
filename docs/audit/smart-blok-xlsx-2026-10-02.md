# Smart blok.xlsx — qarz, poddon va hisob-kitob auditi

Tekshiruv sanasi: 2026-10-02. Foydalanuvchi bergan `Downloads/Smart blok.xlsx` o‘zgartirilmasdan `docs/Smart blok.xlsx`ga nusxalandi. Hajmi 255 281 bayt, SHA-256 `2e7a7ab5ec8bc257f1954f84b82aa9ca9a94c539afdac61b9c7a4a3bdf7b6b11`.

## Fayl turi va tekshiruv chegarasi

Nomida `.xlsx` bo‘lsa ham konteyner ichida `xl/workbook.bin` va `xl/worksheets/*.bin` bor: bu **XLSB mazmunli fayl**. Import kengaytmaga qarab ExcelJS tanlamaydi; SheetJS konteyner mazmunini o‘qiydi. Manbani qayta saqlab yoki nomini almashtirib yuborish shart emas. Ishlab chiqariladigan eksport haqiqiy XLSX bo‘ladi.

15 varaqdagi **32 456 saqlangan katak qiymati** SheetJS 0.20.3 va mustaqil pyxlsb 1.0.10 bilan solishtirildi. Faqat `Акт (умумий)!G23` xato qiymatining ifodasi farq qiladi: `29` va `0x1d`, ikkalasi `#NAME?`. Qolgan barcha saqlangan qiymatlar mos. 20 080 formula katagi topildi. Barcha 584 yuk, 256 to‘lov, 58 mijoz qoldig‘i, 2 zavod qoldig‘i va agentlarning oylik/umumiy KPI summalari Decimal arifmetika bilan tekshirildi.

XLSB dekoderi strukturali havolalarni ba’zan `Table…[#Data]` va nisbiy yig‘indi manzillarini Excel chegarasidan katta qator raqamlarida ko‘rsatadi. Bu dekoder ifodasini tayyor XLSX formulasi sifatida ko‘chirish mumkin emas. Biznes ma’nosi ustun sarlavhalari, kirish qiymatlari, saqlangan formula natijalari va mustaqil hisob orqali tasdiqlandi. Native Excel qayta hisoblashi yoki manbaning vizual ekran tekshiruvi bajarilmadi; audit barcha native funksiyalar boshqa dvigatelda qayta ishlaganini da’vo qilmaydi.

Arxivda 82 qism, 9 table va 10 yuk katagi izohi bor. VBA loyihasi va tashqi workbook havolasi yo‘q. Oxirgi saqlash 2026-10-02 11:28:45 UTC. Fayldagi ko‘rsatma/makro matnlari faqat hujjat mazmuni sifatida o‘qildi, buyruq sifatida bajarilmadi.

## Varaq qamrovi

| Varaq | Diapazon | Formulalar | Vazifasi va muhim holat |
|---|---|---:|---|
| Кўрсаткичлар | A1:J68 | 1 | 58 mijoz, 6 agent, 2 zavod, narx/KPI parametrlari |
| Мижозлар қолдиғи | A1:N76 | 934 | Tovar qarzi E, poddon qarzi L, jami M; 60 qator yashirilgan |
| Мижоз картаси | A1:T200 | 15 | Tanlangan `КЛИЕНТ 5001`; kartadagi natijalar yangi operatsiya emas |
| Қидирув | A1:J40 | 4 | Yashirin qidiruv yordamchisi |
| Поставшиклар ҳисоби | A1:I60 | 61 | Yashirin zavod yig‘masi; qaytarishni chegirmaydigan eski H qoldiq |
| Акт сверка | A1:Z80 | 29 | Yashirin; Ментора, 2026-yil iyul tanlangan |
| Ҳисобот | A1:M36 | 61 | 2026-09-22, Ментора kunlik hisobi; qaytarish va xarajatni hisobga oladi |
| Акт (умумий) | A1:AA23 | 116 | Sentabr va butun davr; qaytarish bilan to‘liq zavod qoldig‘i |
| KPI | A1:L64 | 350 | Sentabr, butun davr va kunlik agent hisoblari |
| Поддон қайтариш заводга | A1:L199 | 34 | 19 qaytarish, ombor qoldig‘i paneli |
| Поддон қайтариш | A1:F147 | 1 | 143 mijoz qaytarishi va 1 ombor brak yozuvi |
| Оплата | A1:T1100 | 8 478 | 256 to‘lov/poddon puli taqsimoti |
| Оплата поставшику | A1:H97 | 1 | 77 zavod to‘lovi |
| Товар | A1:AA1173 | 9 809 | 584 yuk; 143 invoice raqami, 10 katak izohi |
| Текширув | A1:J60 | 186 | Ortiqcha poddon, avans va to‘liqlik nazorati |

Haqiqiy yozuvlar oxiri: Товар 587, Оплата 260, zavod to‘lovi 79, mijoz qaytarish/brak 147, zavod qaytarishi 22-qator. Formula bilan to‘lgan bo‘sh dumlar va yig‘ma varaqlar operatsiya sifatida import qilinmaydi. Yuk sanalari 2026-06-24–2026-10-01; mijoz to‘lovlari va qaytarishlari 2026-10-02gacha. KPI tanlangan sentabr davri bilan butun faylning yakuniy qoldig‘i bir xil davr emas.

## Mijozning ikki xil qarzi

Manba `Мижозлар қолдиғи`dagi 58 mijozning har biri quyidagicha hisoblangan:

- C = `Товар!T` mijozga yozilgan tovar summasi. T = sotuv P − transport S, faqat Q=`Клиент` bo‘lsa; Q=`Сотувчи` bo‘lsa T=P.
- D = `Оплата!P` tovar uchun ajratilgan pul. To‘lov K = D+H+I+J kanallari yig‘indisi; poddon puli O = F dona × N narx; tovar puli P = K−O.
- E = D−C — poddonsiz qoldiq.
- F = yuborilgan, G = tabiiy qaytarilgan, H = puli to‘langan poddon donasi; J = G+H−F.
- K = shu mijozga tegishli oxirgi yukning L poddon narxi, topilmasa `Кўрсаткичлар!B4`.
- L = J×K — poddon pul qoldig‘i; M = E+L — poddon bilan qoldiq.

**Excel manfiy sonni qarz, musbat sonni avans deb ko‘rsatadi. Ilovaning qarz maydonlari musbat qarz, manfiy avans bo‘ladi.** Hisob aynan bir xil, faqat belgi konvensiyasi teskari. To‘langan poddonni yana qarzga qo‘shish yoki uning pulini tovar uchun to‘lov deb hisoblash mumkin emas.

Narxni sozlamadan boshqarish foydalanuvchining joriy talabidir. Ilovada ikkala tomon uchun **qolgan dona × joriy global narx** ishlatiladi. Manba faylida barcha yuk L narxlari 130 000 bo‘lgani uchun hozirgi natijalar aynan mos. Kelgusida setting o‘zgarsa, dastur qolgan dona qiymatini qayta baholaydi. Manbaning oxirgi yuk narxini qidiradigan K formulasi global setting o‘zgarganda tarixiy L=130 000ni ushlab qolishi mumkin; yangi ilova talabi ataylab shu cheklovni bartaraf qiladi.

Avvalgi to‘lovlar, to‘langan poddon donasi va uning tarixiy narxi o‘zgarmaydi. Narx almashtirish yangi pul tushumi, xarajat yoki ledger yozuvi yaratmaydi. Manfiy poddon qoldiqlari va avanslar nolga kesilmaydi.

## Brak va ombor qoldig‘i

`Поддон қайтариш!A144:D144` = 2026-09-30, `БРАК`, −52, `БРАК`. Bu nom mijozlar lug‘atida yo‘q. Bu yozuv mijozdan −52 dona qaytarish emas, ombordagi yaroqsiz poddonni hisobdan chiqarishdir. Uni `Бунёдкор`ga o‘xshash nom sifatida biriktirish yoki soxta `БРАК` mijozini yaratish noto‘g‘ri bo‘ladi.

Aniq ajratish:

| Ko‘rsatkich | Dona |
|---|---:|
| Mijozlarga yuborilgan | 10 508 |
| Mijozlardan haqiqiy qaytarilgan | 7 061 |
| Mijozlar pulini to‘lagan, signed | 3 254 |
| Mijozlarda qolgan = 10 508−7 061−3 254 | **193** |
| Zavodlarga qaytarilgan | 6 892 |
| Ombor braki | −52 |
| Omborda bor = 7 061−6 892−52 | **117** |
| Zavodga qaytarish majburiyati = 10 508−6 892 | **3 616** |

Manba qaytarish varag‘i umumiy yig‘indisi 7 009 = 7 061−52. Uni mijoz qaytarish yig‘indisi deb olish mijoz qarzini 52×130 000 = **6 760 000 so‘mga noto‘g‘ri oshiradi**. Ilovadagi bu yozuv client/factorysiz `ADJUSTMENT` sifatida omborga ta’sir qiladi. Import bekor qilinganda shu stock tuzatishi ham qaytadi. Konservatsiya: 3 616 = 193 + 117 + 3 254 + 52.

## Zavodning ikki xil qarzi

Qaytarishlarni hisobga oladigan manbalar `Ҳисобот` va `Акт (умумий)`dir. Butun davr uchun musbat qarz ko‘rinishida:

`Poddonsiz qarz = blok tannarxi − zavodga to‘lovlar − poddon qaytarish xarajati.`

`Poddon bilan qarz = poddonsiz qarz + (zavoddan olingan dona − zavodga qaytarilgan dona) × joriy narx.`

Manbada yuk poddon summasi `Товар!K×L`; qaytarilgan summa esa qaytarish donasi × B4. Hozir L va B4 ikkalasi 130 000, shuning uchun farq qolgan dona × narxga aynan teng.

Qaytarish xarajati — poddonning o‘z narxi emas, uni zavodga olib borish xarajati. Manba zavod hisobida ushbu xarajatni bizning foydamizga kredit sifatida chegiradi. Xarajat allaqachon kassa chiqimi sifatida qayd etilgan bo‘lsa, qoldiqni ko‘rsatish uchun uni yana pul operatsiyasi qilib yozish mumkin emas. Importdagi aniq batch/sana/manba qatori bilan bog‘langan qaytarish xarajati bir marta hisobga olinadi. Oddiy boshqa xarajatni tavsifiga qarab zavodga taxminiy biriktirish mumkin emas.

| Zavod | Blok tannarxi | To‘langan | Qaytarish xarajati | Poddonsiz qarz | Qolgan dona | Poddon qiymati | Poddon bilan qarz |
|---|---:|---:|---:|---:|---:|---:|---:|
| Коалс | 3 273 345 846 | 2 395 089 420 | 19 368 000 | **858 888 426** | 874 | 113 620 000 | **972 508 426** |
| Ментора | 7 383 839 508 | 7 334 150 000 | 0 | **49 689 508** | 2 742 | 356 460 000 | **406 149 508** |
| Jami | 10 657 185 354 | 9 729 239 420 | 19 368 000 | **908 577 934** | 3 616 | 470 080 000 | **1 378 657 934** |

`Акт (умумий)!R13+S13` = −972 508 426, R14+S14 = −406 149 508. `Поставшиклар ҳисоби!H4:H5` qaytarishni ham, qaytarish xarajatini ham chegirmaydi va boshqa katta qarz chiqadi. Bu manbaning ichki nomuvofiqligi; yangi ilova kunlik/aktning to‘liq hisobiga mos keladi. Kanal bo‘yicha eski akt qaytarish xarajatini doim CASHga qo‘shadi; umumiy qoldiq to‘g‘ri, bu yangi real CASH tushumi degani emas.

## Moliyaviy nazorat summalari

Quyidagi qiymatlar manbaning saqlangan natijalari bo‘lib, pastdagi 3 ta yetishmagan sotuv narxi tuzatilganda mijoz/KPI natijalari o‘zgarishi mumkin.

| Ko‘rsatkich | Manba natijasi |
|---|---:|
| Hajm | 18 164,952 m³ |
| Blok tannarxi | 10 657 185 354 |
| Sotuv P | 12 928 393 579,914259 |
| Transport S | 1 396 996 105,199 |
| Yalpi foyda R=P−J−S | 874 212 120,715259 |
| Mijozga yozilgan tovar T | 11 859 969 579,942259 |
| Mijozlar haqiqiy pul to‘lovi | 11 414 736 660 |
| To‘langan poddon puli | 423 020 000 |
| Tovarga ajratilgan pul | 10 991 716 660 |
| Mijozlar poddonsiz qarzi | **868 252 919,942259** |
| Mijozlar poddon qarzi | **25 090 000** |
| Mijozlar poddon bilan qarzi | **893 342 919,942259** |

`Мижозлар қолдиғи!76` filtrlangan subtotal, barcha mijozlar yig‘indisi emas. Audit 5:62 qatorlardagi 58 mijozni yig‘di. E76=+57 107 759,999 va M76=+121 587 759,999ni butun biznes qoldig‘i deb olish noto‘g‘ri.

KPI qoidasi avvalgidek: hajm × 10 000 soliq; (yalpi foyda − soliq) × 1/3 agentga, qolgan 2/3 firmaga. To‘lov kelgan-kelmaganiga bog‘liq emas. Mijozning joriy lug‘atdagi agenti ustuvor. Sentabr hajmi 5 582,088, yalpi foyda 189 269 162,000192, agent ulushi 44 482 760,666731. Butun davr soliqdan keyingi foyda 692 562 600,715259; agent ulushi 230 854 200,238420. Ulushni 0,333 yoki 33%ga kesish mumkin emas.

## Oldingi 2026-09-29 fayldan muhim o‘zgarishlar

- Yuklar 548→584; mijoz to‘lovlari 248→256; zavod to‘lovlari 70→77; qaytarish/brak qatorlari 134→144; zavod qaytarishlari 17→19; mijozlar 57→58.
- `Склад` → `СКЛАДГА`; agent Темур → Шохрух ога. Yangi mijoz `Музаффар ога 8888  (20 МАШИН)`, agent Зафар ога.
- `Оплата!C226` egasi Шовотdan **Гранд**ga o‘zgartirilgan. Oldingi fayldagi egani yangi faylga majburan saqlash mumkin emas.
- `Товар` 483, 484, 493, 498, 499-qatorlarda sotuv narxi 605 000→720 000, transport 0→2 800 000.
- 543/544-qatorlarda ombor nomi/agent o‘zgargan, sotuv narxi va transport javobgari o‘chirilgan; bu holat alohida ko‘rib chiqilishi kerak.
- To‘langan poddon donasi Оплата190 −71→−52; 231 149→190; 240 35→bo‘sh; 241 bo‘sh→19. 248dan keyin qatorlar qayta joylashtirilgan, shuning uchun Excel qator raqamini global doimiy ID deb qabul qilish mumkin emas.
- Invoice raqamlari 42→143. Tovar izohlari va 10 katak note saqlanadi. Mavjud ko‘rinadigan takroriy yozuvlarni avtomatik yo‘qotish mumkin emas.

Bu faqat yangi operatsiyalar qo‘shilgan fayl emas: tarixiy egalar, summalar va narxlar ham tuzatilgan. Oldingi ma’lumotlar bor bazaga oddiy APPEND qilish eski operatsiyalarni takrorlaydi. Tasdiqlangan import rejimi va oldingi batch holati hisobga olinadi; audit production importini o‘z-o‘zidan bajarmaydi.

## Hal qilinishi kerak bo‘lgan manba bo‘shliqlari

| Manba qatori | Mijoz | Yetishmayotgan qiymat | Saqlangan natija |
|---|---|---|---|
| Товар543 | СКЛАДГА | Sotuv narxi va transport javobgari | 17,28 m³, tannarx 10 454 400; sotuv/tovar qarzi 0 |
| Товар544 | СКЛАДГА | Sotuv narxi va transport javobgari | 15,552 m³, tannarx 9 408 960; sotuv/tovar qarzi 0 |
| Товар563 | Акмал 91 510 50 01 | Sotuv narxi | 32,832 m³, tannarx 19 863 360, transport 2 800 000; sotuv/tovar qarzi 0 |

Bo‘sh narxni avtomatik 0 deb saqlash real qarzni yashirishi mumkin. Import hozir ushbu **5 maydon bo‘yicha BLOCK** ko‘rsatadi. Omborga yuklashni tijoriy bepul sotuv deb taxmin qilish ham to‘g‘ri emas. Foydalanuvchi aniq qiymat yoki alohida biznes amaliyotini tasdiqlamaguncha asl fayl to‘liq commit qilinmaydi. Formula keshi 0 bo‘lishi manba narxi 0 ekanining isboti emas.

`БРАК`ning aniq ma’noli −52 ombor tuzatishi esa mijozsiz stock yozuvi sifatida qo‘llab-quvvatlanadi, noaniq mijozga biriktirilmaydi. `Акт (умумий)!G23`dagi mavjud `#NAME?` eksportga ko‘chirilmaydi.

## Regressiya va sinov qoidalari

`apps/api/test/import/smart-blok-2026-10-02.regression.ts`: **4 446 tekshiruv o‘tdi**. Original hash, barcha input qatorlar, 58 mijozning har bir E/M qoldig‘i, 584 yukning moliyaviy ustunlari, 256 to‘lov taqsimoti, 2 zavod va 6 agentning ikki davr KPI natijalari tekshirildi. 19 ta review finding ichida 5 ta haqiqiy blocker saqlanadi.

`apps/api/test/import/smart-blok-2026-10-02.lifecycle.ts` alohida local PostgreSQL sxemasida ishlaydi. Avval asl faylning preview/commitga tayyor emasligini tekshiradi. Keyin faqat sinov xotirasida 3 noma’lum narxga **sun’iy 1 so‘m/m³**, 2 transport maydoniga `Сотувчи` qo‘yadi. Bu haqiqiy biznes qiymati emas, foydalanuvchiga taklif emas va manba faylini tahrirlash emas. Sun’iy tovar qarzi farqi 17,28+15,55+32,83 = **65,66 so‘m** alohida hisobga olinadi. Zavod tannarxi, to‘lovlar, poddonlar va ombor qoldig‘i o‘zgarmaydi.

**359 lifecycle tekshiruvi o‘tdi.** Sinov import/preview/rollback, barcha 58 mijozning ikki qarzi, ikkala zavod, joriy narx o‘zgargandagi qayta baholash va tarixiy to‘lovlar o‘zgarmasligini tekshirdi. Compiled Nest `ExportService` yaratgan haqiqiy XLSX qayta import qilindi: 584 yuk, pul summalari, 193 mijoz poddoni, 117 ombor qoldig‘i, −52 brak va zavod xarajat krediti saqlandi. Eksportning barcha varaqlarida saqlangan formula xatolari yo‘q, import uchun 0 blocker. `БРАК` yoki `ОМБОР ТУЗАТИШИ` degan soxta mijoz yaratilmagan.

Uchta rollbackning ledger, kassa va poddon yig‘indisi nolga qaytdi. Birinchi va eksportdan qayta import rollbacki avvalgi 125 000 narxni tikladi. Keyin foydalanuvchi qo‘lda 150 000ga almashtirgan narx oxirgi rollbackda saqlandi. 130 000→150 000 narx almashishi mijozlar jami qarziga faqat 193×20 000, zavodlar qarziga faqat 3 616×20 000ni qo‘shdi. Tarixiy Payment, CashTransaction, LedgerEntry va to‘langan poddon narxlari aynan o‘zgarmadi.

Faqat avtomatik yaratilgan tasodifiy local test sxemasi ishlatildi va test oxirida olib tashlandi; public sxemaga yoki productionga yozilmadi. Ushbu muvaffaqiyat asl fayldagi 5 noma’lum maydon avtomatik to‘ldirilganini anglatmaydi.
