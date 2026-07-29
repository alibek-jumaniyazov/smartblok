# Excel import — «Smart blok.xlsx» → baza (AUTHORITATIVE)

Sana: 2026-07-29 · Fayl: `docs/Smart blok.xlsx` · Kod: `apps/api/src/import/`

Bu hujjat importning **hozirgi** xatti-harakatini tasvirlaydi. Eski
`docs/09-excel-import-va-migratsiya.md` v1 modulini (endi mavjud emas) tasvirlaydi —
undan spetsifikatsiya sifatida foydalanilmasin.

> **2026-07-29 oʼzgarishi.** Egasi jurnalga ikki ustun qoʼshdi — **W «Завотга толов»**
> (shu mashina uchun zavodga toʼlangan summa) va **X «тўлов тури»** (`Банк` / `Нахт`).
> Shu paytgacha zavod puli qaysi mashinani yopgani **taxmin** edi (eng eski buyurtmadan
> boshlab). Endi fayl javobni qatorma-qator beradi, va import aynan shuni bajaradi.
> Egasining soʼzlari bilan:
>
> > «Сумма Приход» 15 552 000 va «Завотга толов» 15 552 000 ⇒ bu buyurtma full zavodga
> > toʼlangan, bu boʼyicha zavodga qarzdor emasmiz.
> > «Завотга толов» 0 va «тўлов тури» Нахт ⇒ bu buyurtma zavodga **naqd** qarzimizga
> > qoʼshiladi.

### Joriy fayl — import nima yozadi

| | |
|---|---|
| jurnal qatorlari → buyurtma | **170** (163 tannarxi aniq · 1 qisman · 6 toʼlanmagan) |
| mijozlar / agentlar / mijoz toʼlovlari | 35 · 6 · **177** |
| sotuv (Σ «Сумма Продажа») | **3 760 776 119.38** |
| zavoddan olingan mol (Σ «Сумма Приход») | **3 035 493 990** |
| zavodga oʼtkazilgan («Жами», 23 oʼtkazma) | **3 427 089 420** |
| **zavodda qolgan pulimiz** | **391 595 430** — naqd **0** · oʼtkazma **489 470 806** − naqd qarz **97 875 376** |
| mijozlar qoldigʼi (Σ «Ост») | **−94 799 900.62** (mijozlarda avans) |
| poddon tashqarida | **3 079** dona |
| kassa: bank / naqd / Click | 122 389 800 · 69 099 800 · 40 033 000 |
| mijoz → shofyor (kassadan tashqarida) | 253 404 000 |

---

## 1. Fayl tuzilishi

| Varaq | Nima |
|---|---|
| `Лист1` | jurnal: har qator = bitta mashina yuklamasi. Sarlavha r3, maʼlumot r4.., jamlama qatori, undan pastda agent svodkasi + «Утказилган пул» + «Завод» bloklari |
| 6 ta agent varagʼi | tab nomi = agent nomi. Ichida mijoz **bloklari**: chapda toʼlovlar (A–E), oʼngda yetkazmalar (F–M) |

Jurnal = **buyurtmalarning yagona manbai**. Agent daftaridagi yetkazmalar faqat
solishtirish uchun (bazaga yozilmaydi); daftardagi **toʼlovlar** esa mijoz toʼlovlarining
yagona manbai.

Qator/ustun raqamlari **muzlatilmagan**: jurnal jamlamasi shakl boʼyicha topiladi, W/X
ustunlari **sarlavha matni** boʼyicha (`locateOrderPayColumns`), «Утказилган пул» bloki
esa oʼz sarlavhasi va shakli boʼyicha. Egasi qator qoʼshsa yoki blokni pastroqqa
koʼchirsa import buzilmaydi.

---

## 2. Ustunlar → baza

### `Лист1` (buyurtma)

| Ustun | Excel | Bazaga |
|---|---|---|
| D | `Клиент` | `Client` (nomi normallashtiriladi, § 4) |
| C | `Агент` | `Order.agentId` (mijozning agenti orqali) |
| E | `Дата` | `Order.date` |
| F | `№ авто` | `Vehicle` (plate normallashtirilgan, mavjud park qayta ishlatiladi) |
| G | `Размер` | `Product` (`m3PerPallet`: ×250 → 1.8, aks holda 1.728) |
| H | `Блок Куб` | `OrderItem.quantityM3` |
| I | `Цена Приход` | `OrderItem.costPricePerM3` + `ProductPrice(**X ustuni kanali**)` |
| J | `Сумма Приход` (=H×I) | `Order.costTotal` — **faqat bloklar** |
| K | `Поддон Шт` | `PalletTransaction` ×2 (zavoddan olindi + mijozga berildi) |
| L | `Цена Поддон` | **yozilmaydi** (`OrderItem.palletPrice = 0`) — poddon naturada |
| O | `Цена Продажа` | `OrderItem.salePricePerM3` + `ProductPrice(DEALER_SALE)` |
| R | `Сумма Продажа` (=H×O) | `Order.saleTotal` |
| S | `Расход Авто` | `Order.transportCost` |
| U | `Авто услу барлдми?` | boʼsh emas ⇒ `VEHICLE_OUT` toʼlovi + taqsimoti ⇒ `PAID` |
| **W** | **`Завотга толов`** | shu buyurtma uchun zavod avansidan yechiladigan summa (§ 5.1) |
| **X** | **`тўлов тури`** | `Order.factoryPayIntent` + `OrderItem.provisionalPriceKind` + narxnoma kanali |
| P, T, V, Q, B, N, M | — | **oʼqilmaydi** (hosila ustunlar; § 6) |

Har bir qator uchun yoziladi: `Order` (COMPLETED, `factoryPayIntent` = **X ustunidan**,
`transportMode=DEALER_ABSORBED`, `costStatus=PROVISIONAL`) + `OrderItem` +
`OrderStatusHistory` + ledger qatorlari + poddon harakatlari + (agar dastur boʼlsa) bonus.

### W «Завотга толов» + X «тўлов тури»

| X qiymati | `factoryPayIntent` | tannarx bazasi (`PriceKind`) | avans choʼntagi |
|---|---|---|---|
| `Банк`, `bank`, `ўтказма` | `BANK` | `FACTORY_BANK` | `ADVANCE_BANK` |
| `Нахт`, `нақд`, `naqd` | `CASH` | `FACTORY_CASH` | `ADVANCE_CASH` |
| `Клик` / `Пластик` | `CASH` | `FACTORY_CASH` | `ADVANCE_CASH` |
| boʼsh yoki tanilmagan | soʼraladi (`ZAVOD_TOLOV_TURI_NOMALUM`), javobsiz `BANK` | | |

**Nega kanal muhim:** naqd mol haqiqatan arzon. Shu faylda 08.07 kuni bank narxi
593 750, naqd narxi 517 750; 14.07 da 593 750 va 489 250. Kanalni bilmasdan naqd narx
**bank narxnomasiga** yozilardi va (a) bank kitobi buzilardi, (b) har bir naqd mashina
«tannarx narxnomaga mos emas» deb belgilanardi, (c) buyurtma kartochkasidagi «naqd
tannarx» oʼtkazma narxidan **qarzga olingan** raqamni koʼrsatardi
(`common/factory-coverage.ts` → `hasPrice`).

`W` — pul, bayroq emas: qisman toʼlov haqiqiy hol (bu faylda bitta qator: 13 420 080 lik
mashinaga 4 109 024 toʼlangan). Mol narxidan oshib ketsa, ortiqchasi **sarflanmaydi** —
faqat shu mashinaning tannarxichasi yopiladi va `ZAVOD_TOLOVI_ORTIQCHA` ogohlantiradi.

Ustunlar **sarlavha matni** boʼyicha topiladi. Fayl ularsiz boʼlsa (2026-07-29 dan oldingi
har qanday fayl) `factoryPaid = null` boʼladi va import eski **blok-FIFO** rejimiga
qaytadi — egasi iyul faylini qayta yuklasa oʼsha kungi raqamlarni oladi.

### Agent varagʼi (mijoz toʼlovi)

Tab nomi = agent. Ichida mijoz **bloklari** (`«{daftar №}-{mijoz nomi}»`), har blokda chapda
toʼlovlar, oʼngda yetkazmalar. Toʼlov — **mijoz pulining yagona manbai**; oʼngdagi
yetkazmalar faqat jurnal bilan solishtirish uchun.

| Ustun | Excel | Bazaga |
|---|---|---|
| A | `№` | — (blok ichidagi tartib) |
| B | `Дата` | `Payment.date` |
| C | `Сумма` | musbat ⇒ `CLIENT_IN`, **manfiy ⇒ `CLIENT_REFUND`** (qarzni oshiradi) |
| D | `Примечание` | `Payment.payerName` + `note` + kassa kanalini aniqlaydi (§ 3) |
| E | `Возврат паддон` | `PalletTransaction(RETURNED_BY_CLIENT)`, yetkazilgandan oshmaydi |
| H/I | `Клент шопрга барди:` | **solishtirish uchun** (`AgentLedger.driverDeclared`) — bazaga yozilmaydi |

Toʼlov qatori boʼlishi uchun: `№` bor **yoki** sana bilan summa birga. Sarlavha qatorlari va
Excel jadvalining ustun-indeks qatori (`|1|2|3|4|9|10|…`) hech qachon toʼlov sifatida
oʼqilmaydi — ular `readInt`/`readDate` dan `null` qaytaradi.

**«Клент шопрга барди:»** (2026-07-29) — egasi har varaqqa qoʼshgan
`SUMIFS(C:C, D:D, "шопр учун барди")` katagi: mijoz pulining qanchasi bizning kassaga
emas, **shofyor qoʼliga** oʼtgani. Import bu katakni **oʼqiydi, lekin ishlatmaydi** — har
qatorni oʼzi maʼnosi boʼyicha tasniflaydi (`isDriverHandover`), chunki egasining SUMIFS
filtri faqat aynan «шопр учун барди» matnini sanaydi va boshqa imlolarni oʼtkazib yuboradi:

| Agent | import | faylning SUMIFS | farq sababi |
|---|---|---|---|
| Сардор ога | 53 004 000 | 53 004 000 | — |
| Темур | 90 480 000 | 90 480 000 | — |
| Шохрух ога | 30 600 000 | 30 600 000 | — |
| Зафар ога | 62 680 000 | 62 900 000 | «Шопир пули 5%» **−220 000** (chegirma qatori) |
| Арслон ога | 9 500 000 | 7 500 000 | «Клентни Ози Шовйор» **+2 000 000** |
| Жамол 22-22 | 6 700 000 | *(katak yoʼq)* | — |

Farq `SHOFYOR_PULI_FARQI` (INFO) bilan qatorlari nomi bilan koʼrsatiladi. Bu pul **kassaga
tushmaydi** (`cashboxId = null`), lekin mijoz qarzini kamaytiradi — «Ост» aynan shu bilan
qaytadi.

### «Утказилган пул» bloki (zavod)

`sana | kanal | summa` (2026-07-27 dan; undan oldin `sana | summa`) → `FACTORY_OUT`
toʼlovi. Kanal soʼzi qaysi **kassadan** pul chiqqanini va qaysi **avans choʼntagida**
turishini belgilaydi (`bank` ⇒ `ADVANCE_BANK`, `naxt`/`click`/`karta` ⇒ `ADVANCE_CASH`).
Tanilmagan soʼz — `BLOCK`, hech qachon taxmin qilinmaydi.

**«Жами» — egasining eʼloni** (qarori, 2026-07-29). Blokning oʼz jamlama katagi qaysi
qatorlarni qoʼshsa, **oʼsha** pul zavodga oʼtgan hisoblanadi.

Import formulani oʼqiydi (`rowsCoveredByFormula`: `SUM(L178:L200)` ham,
`L178+L179+…` zanjiri ham) va qamrab olinmagan qatorni **yozmaydi**. Lekin hech qachon
jimgina tashlab ketmaydi: `ZAVOD_JAMIDAN_TASHQARI` har bir qatorni sanasi, kanali va
summasi bilan atab ogohlantiradi, preview esa jamini alohida koʼrsatadi. Formulani
oʼqib boʼlmasa (oddiy son yoki notanish shakl) — **hammasi hisobga olinadi**: notoʼgʼri
oʼqilgan formula hech qachon pulni oʼchira olmasligi kerak.

> Nima uchun bu kerak edi: 2026-07-29 kuni fayl bir muddat qoʼlda yozilgan
> `=L178+…+L194+L197+…+L200` zanjiri bilan keldi — u `L195` («Нахт» 6 000 000) va `L196`
> («Клик» 50 000 000) ni atlab oʼtardi, ya'ni fayl 3 371 089 420 deb eʼlon qilar, qatorlar
> esa 3 427 089 420 berardi. Egasi formulani `SUM(L178:L200)` ga tuzatdi va farq yoʼqoldi
> (hozir 0 ta qator tashqarida). Mexanizm oʼz oʼrnida qoladi — keyingi safar shunday
> boʼlsa, 56 mln jimgina yoʼqolmaydi.

---

## 3. Kassa kanali («Примечание» matnidan)

| Matn | Usul | Kassa |
|---|---|---|
| `шопр учун барди`, `Шофйор пули`, `Шопир пули`, `…Шовйор` | CASH | Naqd |
| `Нахт`, `накд`, `naqd` | CASH | Naqd |
| `Клик` / `click` | CLICK | Click |
| `пластик` / `karta` | CARD | Karta |
| qolgani (МЧЖ, ООО, ЧП, хусусий корхона …) | BANK | Bank |

⚠ `Шовот` / `SHOVOT` — bu **joy nomi** (firma nomlarida uchraydi), shofyor emas.

Kassa hech qachon manfiy boʼlmaydi: yetishmagan qismga `CashSource.CAPITAL`
(«Diller kapitali») kirim qatori yoziladi.

---

## 4. Mijoz nomi

1. Kanonik roʼyxat = agent varaqlaridagi blok sarlavhalari.
2. Jurnaldagi imlo variantlari `matchName` bilan shu roʼyxatga yopishtiriladi
   (≥0.95 avtomatik, 0.86–0.95 **egasidan soʼraladi** — commit shu javobsiz oʼtmaydi).
3. **Daftar doirasi** (`resolve/daftar-scope.ts`): bir xil nom **bir nechta agentda**
   uchrasa (masalan «Нахт клент» — Сардор ham, Арслон ham yuritadi), u agent nomi bilan
   ajratiladi: `Нахт клент (Арслон ога)`. Aks holda ikki agentning naqd mijozi bitta
   mijozga qoʼshilib, agentlar oʼrtasida pul siljiydi.

---

## 5. Ledger va cho'ntaklar

```
ORDER_SALE     CLIENT  +saleTotal
ORDER_COST     FACTORY −costTotal      cho'ntak: PAYABLE                 ← «Завод · Олинган»
TRANSPORT_COST VEHICLE −transportCost
PAYMENT        VEHICLE +transportCost  («Туланди» ⇒ VEHICLE_OUT + taqsimot)
PAYMENT        CLIENT  −summa (ishorali: qaytarish qarzni oshiradi)
PAYMENT        FACTORY +summa          cho'ntak: ADVANCE_BANK|_CASH      ← «Завод · Берилган»
ADVANCE_DRAW   FACTORY −W              cho'ntak: ADVANCE_* (buyurtma kanali)
ADVANCE_DRAW   FACTORY +W              cho'ntak: PAYABLE                 ← «Завотга толов»
```

### 5.1. Zavod hisobi — «Завотга толов» qaysi mashina yopilganini aytadi

Egasining «Завод» bloki ayirma yozadi:

```
Олинган   3 035 493 990     ← Σ ORDER_COST (jurnal J ustuni)
Берилган  3 427 089 420     ← «Утказилган пул» → «Жами» (23 oʼtkazma)
──────────────────────────
qolgani     391 595 430     ← «zavodda qolgan bizni pulimiz»
              Нахт 0 · банк 391 595 430
```

Import shu ayirmani aynan qaytaradi, lekin **qaysi mashina yopilgani** endi taxmin emas:
har qator oʼzining `W «Завотга толов»` summasichasini zavod avansidan yechadi. Har yechim
`PaymentsService.drawFromAdvance` bilan bir xil yozadi: `fromAdvance` belgili
`PaymentAllocation` + nol yigʼindili `ADVANCE_DRAW` jufti (`ADVANCE_* −x` / `PAYABLE +x`).
Zavodning **sof** balansi yechimdan oʼzgarmaydi — faqat choʼntaklar orasidagi taqsimot
siljiydi:

| | import yozgani |
|---|---|
| `PAYABLE` | −3 035 493 990 + 2 937 618 614 = **−97 875 376** ← yopilmagan mol qarzi |
| `ADVANCE_BANK` | +3 371 089 420 (bank oʼtkazmalari) − 2 881 618 614 = **489 470 806** |
| `ADVANCE_CASH` | +56 000 000 (naqd+Click) − 56 000 000 = **0** ← faylning «Нахт 0» qatori |
| sof | **391 595 430** ✓ |

`ADVANCE_CASH` aynan nolga tushishi tasodif emas: naqd/Click bilan zavodga oʼtkazilgan
56 000 000 «Завотга толов» ustunidagi naqd toʼlovlar yigʼindisiga **soʼmigacha** teng.

Qarzlar sahifasida bu **naqd qarz 97 875 376 / oʼtkazma qarz 0** boʼlib koʼrinadi —
chunki 10 ta `Нахт` mashinadan 6 tasi umuman toʼlanmagan, bittasi qisman.

Ikki tafsilot — ularsiz raqamlar baribir «toʼgʼri» chiqadi, lekin notoʼgʼri joyda
turadi:

1. **KANAL IZOLYATSIYASI** (egasi qoidasi, 2026-07-29): «buyurtmaning toʼlov turi naqd
   boʼlsa, uni oʼtkazma avansdan toʼlab boʼlmaydi». Naqd mashina FAQAT `ADVANCE_CASH` dan
   yopiladi, bank mashinasi FAQAT `ADVANCE_BANK` dan. Oʼz choʼntagi qurib qolsa buyurtma
   **ochiq qoladi** — aynan shu egasi Qarzlar'da koʼradigan **naqd qarz**; uni jimgina bank
   pulidan yopish oʼsha raqamni yoʼq qilar va naqd molni oʼtkazma narxida yozib qoʼyardi.
   Xuddi shu qoida jonli ishda ham amal qiladi (`orders.drawFactoryAdvance` rad etadi);
   `UNKNOWN` usulli buyurtma ataylab tashqarida — u ARALASH yopilishi mumkin.
2. `PaymentAllocation.priceKind` — **buyurtmaning oʼz** langari (`provisionalPriceKind`),
   choʼntakniki emas. `factory-coverage.ts` toʼlangan summani `totals[priceKind]` ga
   boʼlib qamrovni hisoblaydi; choʼntak kaliti bilan 17 893 440 lik naqd mashina oʼzining
   (qimmatroq) bank narxiga boʼlinib, abadiy «qisman toʼlangan» boʼlib qolardi.

Yechim summasi buyurtmaning **oʼz** `costTotal` i (jurnaldagi raqam), narxnomadan
olinmaydi: bir kunda bitta oʼlcham ikki xil tannarxda kelishi mumkin
(600x300x200 → 625 000 va 545 000), narxnomaga tayangan ulush esa haqiqiy raqamdan
siljib ketardi. Toʼliq yopilgan buyurtma `costStatus = FINAL` boʼladi va `COST_ADJUSTMENT`
yozilmaydi — tannarx oʼzgarmadi; qisman yopilgani `PARTIAL`, toʼlanmagani `PROVISIONAL`.

**Eski fayl (W ustuni yoʼq):** import avvalgidek ishlaydi — eng eski buyurtmadan boshlab,
eng eski oʼtkazmadan, choʼntakka qaramasdan. Bu rejim faqat shu fayllar uchun saqlangan.

⚠ Avtomatik yechim **faqat import** uchun. Jonli ishda avans hech qachon oʼzi sarflanmaydi
(2026-07-21 qoidasi) — u yerda «avansdan yechish» egasining ongli amali.

### 5.2. Mijoz puli

**FIFO** boʼyicha eng eski buyurtmadan boshlab `PaymentAllocation` qatorlari bilan
yopishtiriladi (pul harakatlanmaydi — balans baribir ledger yigʼindisi). Ortgani mijozda
avans boʼlib qoladi.

2026-07-29 fayli boʼyicha: 177 toʼlov, jami **3 855 576 020** — svodkaning Σ`Приход` i
bilan **soʼmigacha** teng. Kanal kesimida: bank 3 493 479 220 (84 ta) · shofyorga
252 964 000 (86 ta, **kassadan tashqarida**) · naqd 69 099 800 (5 ta) · Click 40 033 000
(2 ta). Mijozlar bu faylda **avansda**: Σ`Ост` = −94 799 900.62.

---

## 6. Solishtirish (egasi tekshiradigan raqamlar)

| Site | Excel | 2026-07-29 fayli |
|---|---|---|
| `saleTotal` | svodka Σ`Расход` = jurnal `R` jamlamasi | 3 760 776 119.38 |
| `clientPaidTotal` | svodka Σ`Приход` | 3 855 576 020 |
| `clientDebtTotal` | svodka Σ`Ост` | −94 799 900.62 (mijozlarda avans) |
| `factoryGoodsTaken` | «Завод · Олинган» | 3 035 493 990 |
| `factoryTransferred` | «Завод · Берилган» = «Утказилган пул» `Жами` | 3 427 089 420 |
| `factoryBalance` | «Завод» blokining pastki raqami | **391 595 430** |
| `factoryAdvanceCash` | «Завод» blokidagi `Нахт` | **0** |
| `factoryAdvanceBank` | (kanal boʼyicha brutto avans) | 489 470 806 |
| `factoryPayable` | −Σ(`Сумма Приход` − `Завотга толов`) | **−97 875 376** |
| `palletsOut` | svodka Σ`Паддон` = `K` jamlamasi | 3 079 |

`factoryAdvanceBank + factoryAdvanceCash + factoryPayable = factoryBalance` — uchta
choʼntak **ledgerda** hech qachon oʼzi qisqartirilmaydi (2026-07-21 qoidasi).

**Ekranda esa FAQAT egasining oʼz raqami turadi** (qarori, 2026-07-29:
«489 470 806 bu xato, 391 595 430 toʼgʼri — bu summa hech qayerda chiqmasin»). Brutto
choʼntak simda qoladi (ledger haqiqati, testlar unga tayanadi) va **hech bir ekranda
chiqmaydi**. Har bir sirt `advanceNet*` / `factoryAdvanceNet` ni oʼqiydi:

| Sahifa | Nima koʼrinadi |
|---|---|
| Ish stoli | «Zavodda qolgan pulimiz» **391 595 430** |
| Qarzlar (karta) | «Zavoddagi avansimiz» **391 595 430** · naqd **0** / oʼtkazma **391 595 430** |
| Qarzlar → Zavodlar jadvali | «Avans — naqd/oʼtkazma» ustunlari — **sof** |
| Zavodlar roʼyxati | xuddi shunday, jamlamasi ham sof |
| Zavod kartochkasi | «Zavodda qolgan pulimiz» **391 595 430** + naqd/oʼtkazma sof |
| Buyurtma → «Avansdan yechish» | «Naqd avans / Oʼtkazma avans» — **sof** |
| Zavod hisoboti (+ Excel eksport) | «Zavodga qarzimiz» va «Zavodda qolgan pulimiz» |
| Import preview | «Zavodda qolgan pulimiz» **391 595 430** |

Yagona manba — `common/factory-net-advance.ts` (`netAdvance()`), ya'ni raqam ekranlar
orasida ajralib keta olmaydi. Ochiq mol qarzi `DebtsService.factoryOpenDebtByFactory()`
dan olinadi (`costTotal − Σ allocations` ikkinchi nusxasi yozilmaydi).

Kanal boʼyicha sof qoldiq: har kanal oʼz qoldigʼini koʼrsatadi (**noldan past tushmaydi**),
kamomadi esa ikkinchi qatorga oʼtadi — aynan shuning uchun egasining bloki «Нахт 0 · банк
391 595 430» deb yozadi, «Нахт −97 875 376 · банк 489 470 806» deb emas. Kamomad
yashirilmaydi: uning oʼz **«Zavodlarga qarzimiz — naqd»** kartasi bor va yuqoridagi
izolyatsiya qoidasi boʼyicha u faqat naqd pul bilan yopiladi.

⚠ Serverning **oʼz tekshiruvi** («avansdan yechish» shifti) baribir haqiqiy choʼntakni
oʼqiydi — sof qiymat ekran uchun, qonuniy yechim bloklanmaydi.

### 6.2. Faylning oʼzi bilan solishtirish — qamrov

Import **faqat jamlamalarni emas**, faylning har bir oʼz-arifmetikasini qaytaradi:

| Faylning oʼz raqami | Tekshiruv |
|---|---|
| Лист1 jamlama qatori (kub / tannarx / poddon / sotuv / transport / foyda) | `JAMLAMA_QATORI_NOTOGRI` + `parse.golden` |
| «Утказилган пул» → «Жами» | `ZAVOD_JAMI_FARQI` + `parse.golden` |
| «Завод» bloki (Олинган / Берилган / qolgan / Нахт·банк) | `ZAVOD_QOLDIGI` xabarida yonma-yon |
| Agent svodkasi (Расход / Приход / Ост / Паддон) — **har agent** | `SVOD_FARQI` + `excel-parity.e2e` |
| **Har mijoz bloki**: SUBTOTAL(toʼlov) · SUBTOTAL(yetkazma) · «ID-Клиента» balansi | `parse.golden` — 35/35 blok soʼmigacha mos |
| «Клент шопрга барди» — har varaq | `SHOFYOR_PULI_FARQI` |
| Daftar yetkazmasi ↔ jurnal qatori (1:1) | `DAFTAR_JURNAL_FARQI` |

Joriy faylda **35 mijozning 35 tasida** daftar yetkazmalari jurnal sotuviga soʼmigacha
teng (Σ 3 760 776 119.38 = Σ 3 760 776 119.38), shuning uchun saytdagi mijoz balansi
daftardagi «ID-Клиента» bilan bir xil. `DAFTAR_JURNAL_FARQI` ning 4 ta ogohlantirishi —
**pul farqi emas**, ikki juft qatorning sana/raqam boʼyicha bir-biriga ulanmagani.

⚠ **Jurnalning oʼz jamlama qatoriga koʼr-koʼrona ishonmang.** Iyul faylida `T148`/`V148`
`SUM(T4:T116)` edi — diapazon oxirgi qatorlargacha choʼzilmagan, shuning uchun Excel oʼz
foydasini kam koʼrsatardi. Import har doim **qatorlar boʼyicha** hisoblaydi (toʼgʼri), va
har bir farq `JAMLAMA_QATORI_NOTOGRI` bilan ogohlantirish sifatida chiqadi. 2026-07-29
faylida bunday xato yoʼq.

### 6.1. Import qoʼyadigan savollar (yangi ustunlarga oid)

| Qoida | Daraja | Qachon |
|---|---|---|
| `ZAVOD_TOLOV_TURI_NOMALUM` | CONFIRM | `X` katagi boʼsh yoki soʼz tanilmadi |
| `ZAVOD_TOLOVI_ORTIQCHA` | CONFIRM | `W` > mol narxi |
| `ZAVOD_TOLOVI_QOPLANMADI` | WARN | Σ`W` > «Жами» — fayl oʼzi bilan oʼzi ziddiyatda |
| `ZAVOD_JAMIDAN_TASHQARI` | WARN | qator «Жами» formulasiga kirmagan ⇒ import qilinmaydi |
| `ZAVOD_QOLDIGI` | INFO | Олинган/Берилган/kanal kesimi + faylning oʼz «Завод» bloki |
| `TOLOV_QATORI_TOLIQ_EMAS` | WARN | daftarda toʼlovchi/sana bor, «Сумма» boʼsh ⇒ qator yozilmadi |
| `SHOFYOR_PULI_FARQI` | INFO | «Клент шопрга барди» katagi bilan farq + sababi |
| `AGENT_DAFTARLARI` | INFO | har agent: mijoz/toʼlov soni, yigʼim, shofyorga bergani |

`TANNARX_NARXNOMAGA_MOS_EMAS` endi **kun + kanal** kesimida hisoblaydi. Ilgari kun
boʼyicha edi, va yangi faylda bu 10 ta naqd mashinani «bank narxiga tuzatamizmi?» deb
soʼrardi — bittasini qabul qilish zavod qarzini oshirib, foydani yeb qoʼyardi.

---

## 7. Nima uchun `DEALER_ABSORBED` (va `CLIENT_PAYS_DRIVER` emas)

Daftarda mijozga **toʼliq** `Сумма Продажа` yoziladi, uning shofyorga bergan puli esa
oddiy `Приход` sifatida oʼsha summaga qarshi hisoblanadi. `CLIENT_PAYS_DRIVER` esa har
bir buyurtmaning **oʼz** `transportCost` ini savdodan ayiradi — egasining shofyor puli
esa 4 000 000 kabi yaxlit boʼlaklarda keladi va bitta reysning 2 200 000 iga toʼgʼri
kelmaydi. Ikkala yoʼl mijoz balansida faqat qatorma-qator mos kelgandagina teng boʼladi;
`DEALER_ABSORBED` hech qanday taxminni talab qilmaydi va «Ост» ni aynan qaytaradi.
