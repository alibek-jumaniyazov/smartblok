# Smartblok.xlsb shaklidagi eksport

> **2026-10-02 yangilanishi:** joriy manba `docs/Smart blok.xlsx`. Mijoz va zavod hisobotlari endi paddonsiz hamda paddon bilan qarzni ko‘rsatadi. Qolgan paddon qiymati sozlamadagi joriy narxda; oldingi to‘lov/undirishlar asl summasida qoladi. Zavod qaytarish xarajati qarzdan chegiriladi. Ombordagi `БРАК` mijoz hisobi emas. Quyidagi tarixiy “zavod paddoni faqat dona” izohlari pul daftarining o‘zgarmasligiga tegishli, ekrandagi yangi ikki qarz ko‘rinishini cheklamaydi. [Joriy audit](smart-blok-xlsx-2026-10-02.md).

`GET /api/export/xlsx` endi `docs/Smartblok.xlsb` dagi 15 varaqni o'sha tartibda yaratadi. Natija haqiqiy `.xlsx`; `.xlsb` kengaytmasi bilan niqoblanmaydi. Avvalgi batafsil eksport varaqlari undan keyin saqlanadi. ADMIN / ACCOUNTANT ruxsatlari o'zgarmagan.

## Manbalar va hisoblash

- `Товар`, `Оплата`, `Оплата поставшику`, `Поддон қайтариш`, `Поддон қайтариш заводга` hamda `Кўрсаткичлар` importer taniydigan sarlavha va ustunlarni saqlaydi. Hamma jonli yozuvlar sahifalashsiz bazadan olinadi. Bekor qilingan buyurtmalar va bekor qilingan to'lovlar manba jadvallariga kirmaydi.
- `Товар` bitta buyurtmaning har bir mahsulotini alohida chiqaradi. Buyurtmaning transport summasi mahsulotlarga Decimal bilan taqsimlanib, oxirgi qatorga yaxlitlash qoldig'i beriladi. Transport yoki mijoz qarzi ko'p mahsulotli buyurtmada takroran hisoblanmaydi. `R = P − J − S`; `T` mijoz transportni haydovchiga bergan ulushni chiqaradi.
- Sana kataklari Toshkent kalendar kunini saqlaydi. Narx, pul, hajm va dona matn sifatida yozilmaydi. INN, EHF raqami/holati va import izohlari saqlanadi.
- To'lov qaytarishlari manfiy summada chiqadi. Paddon undiruvi to'lovga taxminan bog'lanmaydi: alohida, nol pul kirimli qator bo'ladi. Shuning uchun `Жами сумма` pul harakatini, `Поддон пули` paddon pul hisobini, `Товарга = Жами − Поддон пули` esa molga ajratilgan mablag'ni ifodalaydi. Undiruv stornosi asl narxida chiqariladi.
- Paddon qaytarish stornolari imzosi bilan saqlanadi; ular yo'qolgan dona yoki yangi qaytarish sifatida ko'rsatilmaydi. Import qilingan zavod qaytarish xarajati ayni manba belgisi bo'yicha xarajat yozuvi bilan bog'lanadi.
- `Поддон қайтариш заводга!J3:K7` ombor paneli mijozlardan qaytgan, zavodga jo'natilgan, qolgan poddon va qaytarish foizini qayta hisoblanadigan formulalar bilan saqlaydi.
- `KPI` saytdagi `AgentKpiService` bilan umumiy hisoblagichni ishlatadi: oylik agentlar, butun tarix, oylik kunlik kesim. Eksport uchun KPI aynan `Товар` ga yuklangan buyurtmalardan olinadi; alohida ikkinchi buyurtma so'rovi orasidagi o'zgarish hisobni buzmaydi. Soliq = m³ × sozlangan soliq, sof foyda = foyda − soliq, agent KPI = sof foyda × agent ulushi; firma ulushi qoldiq sifatida olinadi. Har kunlik jadval 31 joyni saqlaydi; fevraldan martga oy o'zgarsa kunlar kesilib qolmaydi. Agent nomidagi `*`, `?`, `~` Excel wildcard sifatida hisoblanmaydi. Agent biriktirilmagan yuklar alohida qatorda hisoblanadi; ularning manba agenti bo'sh saqlanadi va oy almashtirilganda ham yig'indidan tushib qolmaydi.
- Formula kataklariga natija keshi ham yoziladi. Fayl qayta hisoblanmasdan ochilganida ham jami va KPI ko'rinadi. Manba faylidagi shubhali strukturalangan havolalar yoki diapazondan tashqari formula manzillari nusxalanmaydi.

## Qamrovning aniq chegarasi

Dastlabki 15 varaqning manba jadvallari butun tarixni oladi: bu KPI ning butun tarix bo'limi, mijozi va zavod qoldig'ini to'g'ri saqlash uchun kerak. Eksportning ixtiyoriy `from/to` sanalari avvalgi qo'shimcha harakat varaqlarini chegaralaydi. KPI uchun `to` sanasining oyi, u bo'lmasa `from` oyi, ikkalasi ham bo'lmasa joriy Toshkent oyi ishlatiladi.

Manbadagi zavod hisoboti paddon qiymati va qaytarish xarajatini zavod hisobiga qo'shadi. Ilovaning amaldagi qoidasi esa zavod paddonini dona sifatida yuritadi. Eksport buni aralashtirmaydi: shablon hisoboti alohida tushuntiriladi, haqiqiy ilova pul balansi qo'shimcha ustunda va avvalgi `Заводлар` / bosh daftar varaqlarida beriladi. Eksport bazaga moliyaviy yozuv qo'shmaydi.

Shablondagi to'rtta mijoz to'lov kanali USD, CARD yoki bonusni to'liq ifodalamaydi. Bunday yozuvlar boshqa kanal nomi bilan almashtirilmaydi: `Текширув` varag'ida sanaladi, avvalgi to'liq `Тўловлар` varag'ida saqlanadi. USD kurslari, bonus, qo'lda kiritilgan balans tuzatishlari va barcha ichki audit aloqalarini qayta tiklash uchun shablon importi to'liq baza zaxirasi emas.

`Мижоз картаси`, `Қидирув`, `Акт сверка` bir tanlangan mijoz/zavod bilan cheklanmaydi: barcha yozuvlar beriladi, Excel filtri kerakli kartochka va davrni tanlaydi. Zavodning kunlik va umumiy hisobotlari eksport olingan paytdagi hisob; fayl bazadagi keyingi o'zgarishlarni avtomatik yuklamaydi.

## Tekshirish

`npx tsx test/export-smartblok.regression.ts` (`apps/api` ichida): ko'p mahsulotli transport taqsimoti, Toshkent sanasi, manfiy to'lov, paddonning asl narxdagi tuzatishi, nol pul kirimli paddon qatori, xom XLSX ni haqiqiy importer bilan qayta o'qish, ayni yuklardan olingan KPI keshi va formulalari, agentsiz yuklar, noma'lum to'lov kanali, bo'sh manba jadvallarida aylanma formula yo'qligi, kalendar xatosi va teskari davrni rad etish.

Haqiqiy yangi fayl bilan PostgreSQL import → KPI → eksport → qayta o'qish tekshiruvi alohida import lifecycle testida bajariladi. Manba `docs/Smartblok.xlsb` o'zgartirilmaydi.
