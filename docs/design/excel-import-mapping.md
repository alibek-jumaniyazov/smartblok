# Excel import — «Smart blok.xlsx» → baza (AUTHORITATIVE)

Sana: 2026-07-22 · Fayl: `docs/Smart blok.xlsx` · Kod: `apps/api/src/import/`

Bu hujjat importning **hozirgi** xatti-harakatini tasvirlaydi. Eski
`docs/09-excel-import-va-migratsiya.md` v1 modulini (endi mavjud emas) tasvirlaydi —
undan spetsifikatsiya sifatida foydalanilmasin.

---

## 1. Fayl tuzilishi

| Varaq | Nima |
|---|---|
| `Лист1` | jurnal: har qator = bitta mashina yuklamasi. Sarlavha r3, maʼlumot r4..r147, jamlama r148, undan pastda agent svodkasi + «Утказилган пул» + «Завод» bloklari |
| 6 ta agent varagʼi | tab nomi = agent nomi. Ichida mijoz **bloklari**: chapda toʼlovlar (A–E), oʼngda yetkazmalar (F–M) |

Jurnal = **buyurtmalarning yagona manbai**. Agent daftaridagi yetkazmalar faqat
solishtirish uchun (bazaga yozilmaydi); daftardagi **toʼlovlar** esa mijoz toʼlovlarining
yagona manbai.

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
| I | `Цена Приход` | `OrderItem.costPricePerM3` + `ProductPrice(FACTORY_BANK)` |
| J | `Сумма Приход` (=H×I) | `Order.costTotal` — **faqat bloklar** |
| K | `Поддон Шт` | `PalletTransaction` ×2 (zavoddan olindi + mijozga berildi) |
| L | `Цена Поддон` | **yozilmaydi** (`OrderItem.palletPrice = 0`) — poddon naturada |
| O | `Цена Продажа` | `OrderItem.salePricePerM3` + `ProductPrice(DEALER_SALE)` |
| R | `Сумма Продажа` (=H×O) | `Order.saleTotal` |
| S | `Расход Авто` | `Order.transportCost` |
| U | `Авто услу барлдми?` | boʼsh emas ⇒ `VEHICLE_OUT` toʼlovi + taqsimoti ⇒ `PAID` |
| P, T, V, Q, B, N, M | — | **oʼqilmaydi** (hosila ustunlar; P/T/V da Excel formulasi buzuq, § 6) |

Har bir qator uchun yoziladi: `Order` (COMPLETED, `factoryPayIntent=BANK`,
`transportMode=DEALER_ABSORBED`, `costStatus=PROVISIONAL`) + `OrderItem` +
`OrderStatusHistory` + ledger qatorlari + poddon harakatlari + (agar dastur boʼlsa) bonus.

### Agent varagʼi (mijoz toʼlovi)

| Ustun | Excel | Bazaga |
|---|---|---|
| B | `Дата` | `Payment.date` |
| C | `Сумма` | musbat ⇒ `CLIENT_IN`, **manfiy ⇒ `CLIENT_REFUND`** (qarzni oshiradi) |
| D | `Примечание` | `Payment.payerName` + kassa kanalini aniqlaydi (§ 3) |
| E | `Возврат паддон` | `PalletTransaction(RETURNED_BY_CLIENT)`, yetkazilgandan oshmaydi |

### «Утказилган пул» bloki (zavod)

Sana + summa juftliklari → `FACTORY_OUT` toʼlovi, **usul = BANK**, cho'ntak =
**`ADVANCE_BANK`**. Soʼng § 5.1 boʼyicha olingan molga yopiladi.

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
ORDER_COST     FACTORY −costTotal      cho'ntak: PAYABLE       ← «Завод · Олинган»
TRANSPORT_COST VEHICLE −transportCost
PAYMENT        VEHICLE +transportCost  («Туланди» ⇒ VEHICLE_OUT + taqsimot)
PAYMENT        CLIENT  −summa (ishorali: qaytarish qarzni oshiradi)
PAYMENT        FACTORY +summa          cho'ntak: ADVANCE_BANK  ← «Завод · Берилган»
```

### 5.1. Zavod hisobi — oʼtkazma olingan molni YOPADI

Egasining «Завод» bloki ayirma yozadi:

```
Олинган   2 672 144 640     ← Σ ORDER_COST
Берилган  2 971 089 420     ← Σ «Утказилган пул»
──────────────────────────
qolgani     298 944 780     ← «zavodda qolgan bizni pulimiz»
```

Bu ayirma — egasining hisobi: oʼtkazmalar **oʼsha mashinalar uchun toʼlangan**, ochiq
qarz yonida tegilmay turgan avans emas. Shuning uchun import 144 marta qoʼlda bosilishi
kerak boʼlgan «avansdan yechish» ni oʼzi bajaradi — eng eski buyurtmadan boshlab, eng
eski oʼtkazmadan toʼlanadi. Har yechim `PaymentsService.drawFromAdvance` bilan bir xil
yozadi: `fromAdvance` belgili `PaymentAllocation` + nol yigʼindili `ADVANCE_DRAW` jufti
(`ADVANCE_BANK −x` / `PAYABLE +x`). Zavodning **sof** balansi oʼzgarmaydi — faqat ikki
cho'ntak orasidagi taqsimot siljiydi:

| | import yozgani |
|---|---|
| `PAYABLE` | −2 672 144 640 + 2 672 144 640 = **0** |
| `ADVANCE_BANK` | +2 971 089 420 − 2 672 144 640 = **298 944 780** |
| sof | **298 944 780** ✓ |

Yechim summasi buyurtmaning **oʼz** `costTotal` i (jurnaldagi raqam), narxnomadan
olinmaydi: bir kunda bitta oʼlcham ikki xil tannarxda kelishi mumkin
(600x300x200 → 625 000 va 545 000), narxnomaga tayangan ulush esa haqiqiy raqamdan
siljib ketardi. Toʼliq yopilgan buyurtma `costStatus = FINAL` boʼladi va `COST_ADJUSTMENT`
yozilmaydi — tannarx oʼzgarmadi.

Oʼtkazma molidan kam boʼlsa, qolgan buyurtmalar `PARTIAL`/`PROVISIONAL` boʼlib qoladi va
`PAYABLE` manfiy turadi — «zavodga qarzdormiz».

⚠ Bu **faqat import** uchun. Jonli ishda avans hech qachon oʼzi sarflanmaydi
(2026-07-21 qoidasi) — u yerda «avansdan yechish» egasining ongli amali.

### 5.2. Mijoz puli

**FIFO** boʼyicha eng eski buyurtmadan boshlab `PaymentAllocation` qatorlari bilan
yopishtiriladi (pul harakatlanmaydi — balans baribir ledger yigʼindisi). Ortgani mijozda
avans boʼlib qoladi.

---

## 6. Solishtirish (egasi tekshiradigan raqamlar)

| Site | Excel |
|---|---|
| `saleTotal` | svodka Σ`Расход` = jurnal `R148` |
| `clientPaidTotal` | svodka Σ`Приход` |
| `clientDebtTotal` | svodka Σ`Ост` |
| `factoryGoodsTaken` | «Завод · Олинган» |
| `factoryTransferred` | «Завод · Берилган» = «Утказилган пул» `Жами` |
| `factoryBalance` | «Завод» blokining pastki raqami (qolgan pulimiz) |
| `factoryPayable` | 0 — oʼtkazma molni qopalgan boʼlsa |
| `palletsOut` | svodka Σ`Паддон` = `K148` |

⚠ **Jurnal `T148`/`V148` («Общая прибль», «Соф фойда») ga ishonmang.** Ular
`SUM(T4:T116)` — diapazon 147-qatorgacha choʼzilmagan, shuning uchun Excel oʼz foydasini
kam koʼrsatadi. Import qatorlar boʼyicha hisoblaydi (toʼgʼri), va bu farq
`JAMLAMA_QATORI_NOTOGRI` qoidasi bilan ogohlantirish sifatida chiqadi.

---

## 7. Nima uchun `DEALER_ABSORBED` (va `CLIENT_PAYS_DRIVER` emas)

Daftarda mijozga **toʼliq** `Сумма Продажа` yoziladi, uning shofyorga bergan puli esa
oddiy `Приход` sifatida oʼsha summaga qarshi hisoblanadi. `CLIENT_PAYS_DRIVER` esa har
bir buyurtmaning **oʼz** `transportCost` ini savdodan ayiradi — egasining shofyor puli
esa 4 000 000 kabi yaxlit boʼlaklarda keladi va bitta reysning 2 200 000 iga toʼgʼri
kelmaydi. Ikkala yoʼl mijoz balansida faqat qatorma-qator mos kelgandagina teng boʼladi;
`DEALER_ABSORBED` hech qanday taxminni talab qilmaydi va «Ост» ni aynan qaytaradi.
