# New file smart blok.xlsx: tekshiruv va narx mas’uliyati

2026-10-04 kuni berilgan `new file smart blok.xlsx` oldingi `docs/Smart blok.xlsx` bilan baytma-bayt bir xil. SHA-256: `2e7a7ab5ec8bc257f1954f84b82aa9ca9a94c539afdac61b9c7a4a3bdf7b6b11`. Nomi yangi, lekin hisob ma’lumotlari yangilanmagan. Faylning asl nusxasi o‘zgartirilmadi.

15 varaqdagi 32 456 saqlangan qiymat SheetJS va mustaqil pyxlsb bilan qayta solishtirildi. 20 080 formula katagi, 9 jadval, 82 arxiv qismi tekshirildi. Fayl `.xlsx` deb nomlangan XLSB konteyneridir; parser mazmuniga qarab o‘qiydi. VBA va tashqi workbook havolalari yo‘q. Excelning native qayta hisoblash dvigateli ishga tushirilmadi; muhim moliyaviy formulalar kirish qiymatlaridan Decimal arifmetika bilan mustaqil hisoblandi.

Barcha varaqlarning vazifasi, 584 yuk, 256 mijoz to‘lovi, 77 zavod to‘lovi, 144 qaytarish/brak, 19 zavod qaytarishi, 58 mijoz va 6 agentning qoldiq/KPI tekshiruvlari [to‘liq moliyaviy auditda](smart-blok-xlsx-2026-10-02.md) berilgan. Shu audit yangi berilgan faylga ham to‘liq tegishli.

## Haqiqiy qiymat talab qilinadigan joylar

| Aniq katak | Sana va tomon | Ma’lum qiymatlar | Kimdan nimani olish kerak |
|---|---|---|---|
| Товар!O543, Q543 | 25.09.2026, СКЛАДГА | 17,28 m³, 90 185 GBA, Ментора, zavod narxi 605 000 so‘m/m³ | Шохрух ога va ombor mas’uli: ichki ombor kirimimi yoki sotuvmi? Sotuv bo‘lsa mijoz narxi va transportni kim to‘lagani |
| Товар!O544, Q544 | 25.09.2026, СКЛАДГА | 15,552 m³, 90 185 GBA, Ментора, zavod narxi 605 000 so‘m/m³ | Xuddi shu ikki qaror, aynan shu yuk bo‘yicha |
| Товар!O563 | 28.09.2026, Акмал 91 510 50 01 | 32,832 m³, 01 A 970 ZC, Ментора, zavod narxi 605 000; transport 2 800 000, to‘lovchi Сотувчи | Шохрух ога: mijoz bilan kelishilgan 1 m³ sotuv narxi |

Agent tegishliligi `Кўрсаткичлар!A51/E51` va `A67/E67` bilan tasdiqlangan. Mas’ul agent narx kelishuvini beradi; uning ismi avtomatik ravishda dasturdagi administrator huquqini anglatmaydi. Importdagi tuzatishni ADMIN kiritadi, ACCOUNTANT ko‘rib chiqadi.

605 000 — **Ментора zavodining xarid narxi**. Uni mijozning bo‘sh sotuv narxiga ko‘chirishga asos yo‘q. Ombor kirimini bepul sotuv deb belgilash, mijozga yoki agentga sun’iy zarar yozish mumkin emas. Agar 543–544 haqiqiy ichki ombor kirimi bo‘lsa, tijoriy sotuv sifatida import qilishdan oldin alohida ombor amaliyoti aniqlashtiriladi. Joriy sotuv modeli bu ikki qatorga sun’iy narx qo‘ymaydi.

Uchta bo‘sh narx fayldagi saqlangan sotuv/mijoz summasini 0 qiladi va jami −42 526 720 so‘m yalpi foyda ko‘rsatadi. 65,664 m³ uchun 656 640 so‘m soliqni ayirganda −43 183 360 so‘m chiqadi. Bu to‘liq bo‘lmagan manbaning natijasi; haqiqiy zarar yoki bepul berilgan mol deb qabul qilinmaydi. Uchta sotuv narxi va ikkita transport to‘lovchisi aniqlanmaguncha to‘liq import to‘siladi.

## Narxlar qayerga tegishli va kim boshqaradi

| Manba / maydon | Ma’nosi va hisobi | Biznes mas’uli va dasturdagi amal |
|---|---|---|
| Товар!I, Цена Приход | 1 m³ zavod narxi. H × I = tannarx; zavod B va to‘lov kanali A ga tegishli | Zavod hisob hujjati bo‘yicha buxgalter tekshiradi. Mahsulot narx versiyalari ADMIN/ACCOUNTANT orqali yuritiladi |
| Товар!O, Цена Продажа | 1 m³ mijozga sotuv narxi. H × O = sotuv P | Mijozning agenti kelishuvni beradi. Oddiy buyurtmada ADMIN/ACCOUNTANT/AGENT kiritadi; kutilayotgan narxni ADMIN/ACCOUNTANT hal qiladi; yakunlangan narx tuzatishi ADMIN |
| Товар!S, Авто услу | Butun reys transport summasi; 1 m³ narxi emas | Logistika mas’uli/haydovchi hujjati, buxgalter tekshiruvi |
| Товар!Q, Расход Авто | Клиент: mijoz haydovchiga to‘laydi, bizga T=P−S. Сотувчи: biz to‘laymiz, mijozdan T=P olinadi | Amalda kim to‘lagani agent/logistika bilan aniqlanadi. Transport foydadan bir marta chegiriladi |
| Товар!L va Оплата!N | Operatsiya paytidagi poddon narxi. To‘langan poddon puli = dona × tarixiy narx | Buxgalter hujjatga qarab tekshiradi. Eski pul operatsiyasi joriy narx bilan qayta yozilmaydi |
| Кўрсаткичлар!B4 = 130 000 | Qolgan poddonni baholash narxi. Qarz bilan qarzsiz farqi = qolgan dona × joriy narx | ADMIN, Sozlamalar → Paddon narxi. Mijoz va zavod tomonida bir xil baholash |
| Кўрсаткичлар!B5 = 10 000; B6 = 1/3 | Agent KPI = (sotuv − tannarx − transport − hajm × soliq) × ulush | Korxona rahbari qoidani tasdiqlaydi, ADMIN sozlamani boshqaradi. 1/3 ni 33% yoki 0,333 ga qisqartirish mumkin emas |
| Поддон қайтариш заводга, 1 dona xarajat | Poddonni zavodga tashish xarajati; poddonning o‘z bahosi emas | Logistika beradi, buxgalter tasdiqlaydi. Zavod qoldig‘ida bir marta kredit; kassaga takror yozilmaydi |

## Boshqa topilmalar

- `Товар!303/304`: 20.08.2026, Хонкага, Жамол 22-22, 90 Y 617 RA, 32,832 m³ — takroriy yuk belgilariga ega. S303=2 400 000 va S304=2 700 000 farq qiladi. Ikki haqiqiy reysmi, mas’ul tasdiqlashi kerak; tizim o‘zicha qator o‘chirmaydi.
- `Товар!H505/K505` va H506/K506 hajm/poddon nisbati odatdagidan farq qiladi; K60=20 belgilangan 19 dona sig‘imdan ortiq. 9 mijozda qaytarilgan/to‘langan poddon yuborilganidan ko‘p. Tizim signed qoldiqni saqlab, ko‘rib chiqish uchun ko‘rsatadi.
- `Поддон қайтариш!144` dagi БРАК −52 ombor tuzatmasidir. Mijoz qaytarishi qilib hisoblash mijoz qarzini 6 760 000 so‘mga noto‘g‘ri oshiradi. Mijozlarda 193, omborda 117, zavod oldida 3 616 poddon qoladi.
- `Поставшиклар ҳисоби!H4:H5` qaytarishlarni to‘liq ayirmaydi. Zavodning to‘liq qoldig‘i qaytarish/xarajatni hisobga olgan `Акт (умумий)` va ilovadagi ikki qarz bo‘yicha olinadi.
- `Мижозлар қолдиғи!E76/M76` filtrlangan subtotal. Butun biznes bo‘yicha 58 mijozning 5:62 qatorlari olinadi.
- `Акт (умумий)!G23` da `#NAME?` bor. Ushbu buzilgan formula ilova eksportiga ko‘chirilmaydi.

## Dasturdagi tuzatishlar

Import muammosi endi aniq katak, sana, mijoz, lug‘atdagi mas’ul agent, manba agenti, zavod, avtomobil, hajm va mavjud narxlar bilan ko‘rsatiladi. Kim narxni berishi, kim kiritishi va qaysi hisobga ta’siri yozilgan. Katak manzili haqiqiy sarlavhadan olinadi: ustun joyi almashtirilsa ham to‘g‘ri katak ko‘rsatiladi. Eski importda manzil metama’lumoti bo‘lmasa, tizim taxminiy ustun ko‘rsatmaydi.

Majburiy xatoni e’tiborsiz qoldirish yoki qiymatsiz tasdiqlash orqali tayyor holatga o‘tkazish yopildi. Tuzatish, qoidalarni qayta tekshirish, masala holati va previewni bekor qilish bir tranzaksiyada bajariladi. Boshqa majburiy maydon qolgan bo‘lsa, u ochiq qoladi. Asl Excel qiymati va tuzatilgan qiymat alohida saqlanadi. Narx soni kasrlari ko‘rsatishda yo‘qotilmaydi.

Bir xil fayl oldin import qilingan bo‘lsa, alohida ogohlantirish chiqadi. APPEND eski operatsiyalarni yana qo‘shadi. REPLACE mavjud biznes ma’lumotlarini, shu jumladan qo‘lda kiritilganini ham, shu fayldan qayta quradi; avvalgi destruktiv tasdiqlash saqlangan. Bu audit productionga import, REPLACE yoki deploy bajarmaydi.

## Tekshiruv chegarasi

Asl fayldagi noma’lum narxlar o‘zgartirilmadi. Sinovlarda qo‘yilgan qiymatlar faqat alohida test sxemasidagi texnik misollar; ular foydalanuvchiga taklif qilinadigan narxlar emas. Ishlaydigan import/eksport yo‘li tekshirilishi manbadagi noma’lum kelishuv avtomatik aniqlanganini anglatmaydi.

Tekshiruv natijalari:

- Manba shartnomasi: 4 446 tekshiruv; mustaqil SheetJS/pyxlsb solishtirish.
- Yangi import tuzatish lifecycle: 98 tekshiruv; noto‘g‘ri narx, transport, avval noto‘g‘ri yopilgan xato, atomar rollback, parallel tuzatish va eskirgan preview/commit rad etilishi.
- Import → qarz/poddon qayta baholash → eksport → qayta import → rollback: 359 tekshiruv, alohida PostgreSQL sxemasida.
- Eski import regressiyalari, 2 436 tekshiruvli sentabr fayli, eksport round-trip, 18 eksport diagnostikasi va 308 KPI tekshiruvi o‘tdi.
- Aniq manba katagi va O→AB ko‘chirilgan ustun, asl/tuzatilgan qiymatlar, mijoz almashgandagi mas’ul agent sinovi o‘tdi.
- Desktop va 390 px mobil import ekranida ma’lumotlar ko‘rindi, gorizontal chiqib ketish bo‘lmadi. Mobil tasdiqlash paneli uzun sahifa oxirida qolib ketishi tuzatildi. Faqat test bazasida bitta narxni saqlash ochiq to‘siqlarni 5→4 kamaytirdi, yakuniy import yopiq qoldi.
- Poddon dona taklifi so‘m sifatida chiqishi to‘g‘rilandi. Faqat hisobiy tavsiyasi bor, tahrir maydoni yo‘q ogohlantirish endi hech narsani o‘zgartirmay «To‘g‘rilash» deb ko‘rsatmaydi.
- API va web production buildlari o‘tdi. Production bazasi va saytiga bu topshiriqda o‘zgartirish yuborilmadi.
