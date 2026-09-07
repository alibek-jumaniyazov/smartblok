# Excel import — «Smart blok.xlsx» ustunlar xaritasi (SHABLON v5)

**Oxirgi yangilanish:** 2026-09-05 · **Fayl:** `docs/Smart blok.xlsx` · **Modul:** `apps/api/src/import/`

Bu hujjat importning YAGONA haqiqiy tavsifi: qaysi katak qayerga tushadi, qaysi qoida nima
uchun bor, va sayt raqami egasining varag'idan qayerda va NEGA farq qiladi.

---

## 0. Shablon v5 — nima o'zgardi

Egasi daftarni 2026-09 da butunlay qayta qurdi. **Eski shablon o'lik**: «Лист1» jurnali ham,
har bir agent uchun alohida varaq ham yo'q. Yangi fayl — 5 ta TEKIS jadval + справочник,
qolgani formula bilan hisoblanadigan hisobot varaqlari.

| Eski (v1–v4) | Yangi (v5) |
|---|---|
| «Лист1» jurnali + 6 ta agent varag'i | 5 ta tekis jadval |
| Mijoz ayniyati FUZZY moslashtirish bilan | «Кўрсаткичлар» **справочниги** — taxmin yo'q |
| Bitta zavod («Газоблок») | **Ikkita** zavod: «Коалс», «Ментора» |
| To'lov kanali erkin matndan chamalanardi | Har kanal **o'z ustunida** |
| Transportni kim to'lagani noma'lum | «Расход Авто» = `Клиент` / `Сотувчи` |
| Paddon qaytarish to'lov qatori ichida | **Ikkita alohida varaq** |

> **DIQQAT — jim xato xavfi.** Eski parser jurnal varag'ini «3-qatorida `Агент`+`Клиент`
> sarlavhalari bor» degan belgi bilan topardi, va yangi fayldagi «Товар» varag'i ham AYNAN
> shu belgiga to'g'ri keladi. Ya'ni eski kod yangi faylni **jimgina qabul qilib**, butunlay
> boshqa ustunlarni o'qigan bo'lardi (yangi `A` = «Тўлов тури», eskisida `A` = «В-о»).
> Shu sabab `workbook.reader.ts` shablonni **ataylab qattiq** tekshiradi va mos kelmasa
> import BOSHLANMAYDI (`TemplateMismatchError`).

---

## 1. Varaqlar

### Import qilinadi

| Varaq | Nima | Qatorlar (etalon fayl) |
|---|---|---|
| `Товар` | bitta mashina yuki | 415 |
| `Оплата` | mijoz to'lovi | 194 |
| `Оплата поставшику` | zavodga to'lov | 58 |
| `Поддон қайтариш` | mijoz paddonni naturada qaytardi | 88 |
| `Поддон қайтариш заводга` | biz zavodga qaytardik | 12 |
| `Кўрсаткичлар` | **справочник** + sozlamalar | — |

### O'qilmaydi (faqat solishtirish uchun)

`Мижозлар қолдиғи` · `Ҳисобот` · `Поставшиклар ҳисоби` · `Акт (умумий)` · `Акт сверка` ·
`KPI` · `Текширув` · `Қидирув` · `Мижоз картаси`

Bular butunlay formula. Import ulardan **hech narsa olmaydi**, lekin ikkitasining yig'indisini
o'qib, o'zi hisoblagani bilan yonma-yon qo'yadi (`JAMI_FARQI` qoidasi) — egasi farqni
«sayt yolg'on gapiryapti» emas, «qaysi varaq nima deyapti» deb ko'rishi uchun.

---

## 2. «Кўрсаткичлар» — справочник

Importning eng qimmatli yangiligi: **mijoz kimligi endi taxmin qilinmaydi.**

| Blok | Ustunlar | Vazifasi |
|---|---|---|
| Асосий параметрлар | nom / qiymat | «Поддон базавий нархи» = 130 000 |
| Мижозлар справочниги | Расмий ном · Варианти-1 · Варианти-2 · Эски варақ · **Агент** | mijoz ayniyati + agent biriktirilishi |
| Агентлар справочниги | Агент · Изох | 6 agent |
| Поставшиклар справочниги | Поставшик · Изох | Коалс · Ментора |
| Тўлов тури | Тур | Касса · Перечисления |

**Qidirish tartibi** (`resolve/dictionary.ts`): rasmiy nom → variant → eski varaq kaliti →
**normallashtirilgan kalit** (`norm()`: translit + ё/е, х/ҳ, қ/к, ў/у yig'ilishi) → topilmasa
fuzzy **TAKLIF** (qaror emas — lug'at egasining hujjati, unga nom qo'shish ham uning ishi).

Etalon faylda 48 nomning **48 tasi ham rasmiy nom bilan aynan mos** keladi — fuzzy umuman
ishlatilmaydi.

---

## 3. «Товар» → buyurtma

| Katak | Nima | Qayerga tushadi |
|---|---|---|
| `A` Тўлов тури | Касса / Перечисления | `Order.factoryPayIntent` + qaysi tannarx kitobi (naqd mol arzon) |
| `B` Поставшик | Коалс / Ментора | `Order.factoryId` — **har qatorda boshqa bo'lishi mumkin** |
| `C` Агент | agent | tekshiruv uchun; ustuvorlik справочникда (`AGENT_FARQI`) |
| `D` Клиент | mijoz | `Order.clientId` (справочник orqali) |
| `E` Дата | sana | `Order.date`, `completedAt` |
| `F` № авто | mashina | `Vehicle` (raqam normallashtiriladi) |
| `G` Размер | 600x300x200 … | `Product` (zavod + o'lcham) |
| `H` Блок Куб | m³ | `OrderItem.quantityM3` |
| `I` Цена Приход | zavod narxi / m³ | `OrderItem.costPricePerM3` |
| `K` Поддон Шт | dona | `PalletTransaction` ×2 (zavoddan olindi + mijozga berildi) |
| `L` Цена Поддон | 130 000 | **`OrderItem.palletPrice` = 0** — paddon naturada (§7) |
| `O` Цена Продажа | sotuv narxi / m³ | `OrderItem.salePricePerM3` |
| `Q` Расход Авто | **Клиент** / **Сотувчи** | `Order.transportMode` |
| `S` Авто услу | transport xarajati | `Order.transportCost` + VEHICLE ledger |
| `T` Мижозга | mijozdan so'raladigan summa | tekshiruv: `clientChargeable` shunga TENG bo'lishi shart |

### Transport rejimi — eng muhim yangilik

Faylning o'z formulasi:

```
T = «Сумма Продажа» − ( «Расход Авто» = "Клиент" ? «Авто услу» : 0 )
```

Bu loyihadagi `common/transport.ts → clientChargeable()` funksiyasining **aynan o'zi**:

| «Расход Авто» | `transportMode` | Mijozdan so'raladi |
|---|---|---|
| `Клиент` | `CLIENT_PAYS_DRIVER` | sotuv − transport (mijoz shofyorga o'zi to'laydi) |
| `Сотувчи` | `DEALER_ABSORBED` | to'liq sotuv |

Ledger'ga **ikki qator** yoziladi (tirik yo'l bilan bir xil): to'liq `ORDER_SALE` va uning
ostiga `TRANSPORT_CLIENT_DIRECT` (manfiy). Sabab: buyurtma «Savdo 22 000 000» bo'lib
o'qilishi kerak, mijoz hisobvarag'i esa NEGA 20 000 000 qolganini ko'rsatishi shart.

**Kassaga tegmaydi.** Yangi shablon shofyorga to'lov qatorlarini yuritmaydi — u faqat
xarajat sonini beradi. Shuning uchun transport har ikkala rejimda ham «yopilgan» deb
yoziladi (to'lov qatori + taqsimot bilan, kassasiz), aks holda daftar ko'rmagan
«shofyorlarga qarz» ekranda o'zidan paydo bo'lardi.

---

## 4. «Оплата» → mijoz to'lovi

| Katak | Nima | Qayerga |
|---|---|---|
| `D` ПР-Сумма | o'tkazma | `Payment{method: BANK}` + Bank kassasi |
| `H` Накд | naqd | `Payment{method: CASH}` + Naqd kassa |
| `I` Клик | Click | `Payment{method: CLICK}` + Click |
| `J` Терминал | terminal | `Payment{method: TERMINAL}` |
| `K` Жами сумма | = D+H+I+J | tekshiruv (`FORMULA_FARQI`) |
| `F` Поддон | **dona** | paddon puli (pastga qarang) |
| `O` Поддон пули | = F × narx | `PALLET_CHARGE` ledger |
| `P` Товарга | = K − O | **faqat shu qism buyurtmalarni yopadi** |

**Kanal endi TAXMIN QILINMAYDI.** Eski shablonda bitta «Примечание» katagidagi erkin
matndan kanal chamalanardi — importning eng ko'p yolg'on chiqaradigan joyi. Etalon faylda
har qatorda **aynan bitta** kanal ustuni to'ldirilgan (185 bank · 5 naqd · 3 Click).

### Paddon puli = «yo'qotilganini undirish»

Mijoz paddonni qaytarmay, PULINI to'laydi. Loyiha modelida bu aynan `CHARGED_LOST`: paddon
mijozning dona hisobidan chiqadi va pulga aylanadi. **Ikki qator** yoziladi — qarz
(`PALLET_CHARGE`) va uni yopadigan to'lov — shuning uchun mijozning **pul balansi
o'zgarmaydi**, faqat paddon donasi kamayadi. Excel ham shunday sanaydi:

```
7 392 (olingan) − 4 036 (qaytargan) − 2 853 (puli to'langan) = 503 dona qarz   ✓
```

---

## 5. Zavod hisobi

`Оплата поставшику` → `Payment{kind: FACTORY_OUT}` + `FACTORY` ledger **avans cho'ntagiga**
(`ADVANCE_BANK` / `ADVANCE_CASH`), `PAYABLE` ga emas: egasi «olingan» va «to'langan»
ustunlarini alohida o'qiydi, avansni sarflash esa uning ataylab qiladigan ishi.

Keyin **FIFO**: eng eski buyurtma eng eski to'lovdan yopiladi. Taqsimot **zavod ichida**
qoladi (Коалс puli Ментора molini yopmaydi) va **kanal izolyatsiyasi** saqlanadi — naqd
buyurtma o'tkazma avansidan yopilmaydi (egasining qoidasi, 2026-07-26).

> Yangi shablonda per-order «Завотга толов» ustuni **yo'q** (u v4 da bor edi), shuning uchun
> qaysi mashina qaysi pul bilan olingani FIFO bilan taqsimlanadi.

---

## 6. Paddon harakati

| Manba | Tur | Tomon |
|---|---|---|
| `Товар` K | `RECEIVED_FROM_FACTORY` + `DELIVERED_TO_CLIENT` | zavod + mijoz |
| `Поддон қайтариш` | `RETURNED_BY_CLIENT` | mijoz |
| `Оплата` F | `CHARGED_LOST` (+ pul) | mijoz |
| `Поддон қайтариш заводга` | `RETURNED_TO_FACTORY` — **narxsiz** | zavod |

### Manfiy qatorlar = TUZATISH

Daftarda uchta manfiy son bor: −19 (qaytarish ortiqcha yozilgan), −71 (paddon puli ortiqcha),
−113 («БРАК кабул ыилмадилар»). Ular **`ADJUSTMENT` bo'lib yozilmaydi** — `ADJUSTMENT`
«manbasi ko'rsatilmagan qo'l tuzatishi» degan chelak va uni hech bir o'quvchi qaytarishga
bog'lay olmaydi (`dealerInHand` uni umuman ko'rmaydi ⇒ ombor qoldig'i va `drift` siljib
qolardi).

Buning o'rniga: **butun qator stornolanadi + qoldig'i darhol qayta yoziladi.** Qisman storno
ataylab ishlatilmaydi — bazada «Mijoz qaytardi»/«Undirish» qatori bitta storno uyasiga ega
(`PalletTransaction_whole_row_reversal_once`), va uni qisman storno band qilib qo'ysa,
importni **orqaga qaytarish** yiqilardi.

### Konservatsiya (etalon fayl)

```
zavodga qarz 4 000 = mijozlarda 503 + omborda 644 + puli to'langan 2 853   ✓  (drift = 0)
```

---

## 7. ⚠ Excel bilan ATAYLAB farq — zavod paddon puli

Yangi Excel zavod qarziga **paddon pulini ham** qo'shadi va qaytarilganini 130 000 dan
qaytaradi. **Egasi buni so'ralganda rad etdi** (2026-09-04) va 2026-07-23 dagi qoidani
saqlab qoldi: zavod tomonida paddon faqat **DONA** bo'lib yuradi, hech qachon pulga
aylanmaydi (bazadagi `pallet_factory_return_moneyless` CHECK shuni ushlab turadi).

| | Excel | Sayt |
|---|---|---|
| Zavod qoldig'i | −629 881 630 | **−129 249 630** |
| Zavodga paddon qarzi | 4 000 dona (+ pulda) | **4 000 dona** (faqat dona) |

Farq **tasodif emas** va aniq hisoblanadi:

```
paddon puli 960 960 000 − qaytarilgani 440 960 000 − qaytarish harajati 19 368 000
= 500 632 000
```

Bu farq **yashirilmaydi**: preview'da `palletMoneyGap` bo'lib alohida chiqadi va
`ZAVOD_PADDON_PULI` qoidasi uni o'zbekcha gap bilan izohlaydi. Paddon qaytarish harajati
(19 368 000) esa haqiqatan kassadan chiqadi, shuning uchun `Expense` bo'lib yoziladi.

---

## 8. Qoidalar

| ID | Daraja | Nima uchun |
|---|---|---|
| `MIJOZ_YOQ` | BLOCK | справочникда yo'q mijoz — pul kimga yozilishi noma'lum |
| `ZAVOD_NOMALUM` | BLOCK | справочникда yo'q zavod |
| `TOLOV_TURI_NOMALUM` | BLOCK | kanal tanilmadi — pul qaysi kassadan o'tishi noma'lum |
| `TRANSPORT_TOLOVCHI_NOMALUM` | BLOCK | «Расход Авто» ≠ Клиент/Сотувчи — mijoz summasi noaniq |
| `YUK_MAJBURIY_MAYDON` | BLOCK | sana / hajm / narx yo'q |
| `TOLOV_KANALI_YOQ` | BLOCK | jami bor, kanal ustunlari bo'sh |
| `FORMULA_FARQI` | WARN | fayldagi keshlangan katak eskirgan |
| `TAKRORIY_YUK` | CONFIRM | bir xil mijoz+sana+mashina+hajm |
| `AGENT_FARQI` | WARN | qatordagi agent справочникдагиdan boshqa |
| `USTAMA_CHEGARASI` · `PODDON_NISBATI` · `MOSHINA_SIGIMI` | WARN | mantiqiy chegaralar |
| `PADDON_ORTIQCHA` | WARN | qaytargan+to'lagan > olgan («Текширув» §1 bilan bir xil) |
| `QATOR_TOLIQ_EMAS` | WARN | tugallanmagan qator — import QILINMADI, lekin sanaladi |
| `JAMI_FARQI` | WARN | yig'indi egasining varag'i bilan mos emas |
| `ZAVOD_PADDON_PULI` | INFO | §7 dagi farqni izohlaydi |

**Etalon faylda BLOCK yo'q** — egasi hech nima tuzatmasdan yuborishi mumkin.

---

## 9. Tugallanmagan qatorlar

Qator IMPORT QILINADI faqat ayniyat kataklari to'ldirilgan bo'lsa (yukda — mijoz;
to'lovda — mijoz; zavod to'lovida — summa; paddonda — mijoz+son / sana+son).

Etalon faylda 7 ta bunday qator bor: 6 tasi «Товар»da (mashina raqami yozilgan, mijoz/hajm
hali yo'q — egasi bugun boshlagan) va 1 tasi «Поддон қайтариш заводга»da (500 dona
jo'natilgan, zavod nechtasini qabul qilgani hali yozilmagan — faylning o'z yig'indisi
ham uni sanamaydi).

Ular **jimgina tashlanmaydi**: har biri koordinatasi bilan review ekranida chiqadi.

---

## 10. Solishtirish raqamlari (etalon fayl)

Hammasi faylning O'Z katagidan olingan — qo'lda hisoblangan emas.

| Ko'rsatkich | Qiymat | Manba |
|---|---|---|
| Yuklar | 415 | `Товар` |
| Blok hajmi | 12 780.504 m³ | SUBTOTAL |
| Zavoddan olingan (blok) | 7 451 239 050 | «Сумма Приход» |
| Sotuv jami | 9 100 435 039.91 | «Сумма Продажа» |
| **Mijozga yoziladi** | **8 375 011 039.94** | «Мижозга» = `Мижозлар қолдиғи` C61 |
| Mol uchun to'lov | 7 532 732 040 | «Товарга» = D61 |
| Paddon uchun to'lov | 370 890 000 | «Поддон пули» = I61 |
| **Mijozlar qarzi** | **842 278 999.94** | «ТОВАР ҚАРЗИ» = E61 |
| Zavodga to'langan | 7 321 989 420 | `Оплата поставшику` |
| Paddon: berilgan/qaytgan/to'langan/qoldiq | 7 392 / 4 036 / 2 853 / **503** | F61…J61 |
| Zavodga qaytarilgan / omborda | 3 392 / **644** | `Поддон қайтариш заводга` |

**Testlar:**

```bash
cd apps/api
npx tsx test/import/parse.golden.ts      # parser fayl bilan mosmi (67 tekshiruv)
npx tsx test/import/resolve.names.ts     # справочник hamma nomni qamradimi (10)
npx tsx test/import/rules.golden.ts      # qoidalar: toza faylda BLOCK yo'q + har biri ishlaydi (25)
npx tsx test/import/template-guard.ts    # noto'g'ri fayl RAD etiladimi (4)
DATABASE_URL=…smartblok_test npx tsx test/import/inline-fix.e2e.ts   # tahrir commitgacha yetadimi
DATABASE_URL=…smartblok_test npx tsx test/import/lifecycle.e2e.ts    # to'liq sikl + bonus + rollback
API_URL=http://localhost:4100/api node test/import/excel-parity.e2e.mjs      # Excel bilan tenglik (49+)
API_URL=http://localhost:4100/api node test/import/kassa-dashboard.e2e.mjs   # kassa/dashboard invariantlari
API_URL=http://localhost:4100/api node test/import/modes.e2e.mjs             # APPEND / REPLACE
```
