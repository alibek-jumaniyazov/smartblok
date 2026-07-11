# SmartBlok — Business-Math Specification derived from «Газоблок Счет.xlsx»

Source of truth: the owner's real workbook (dumped at `.../scratchpad/xlsx-dump/`, original at `docs/Газоблок Счет.xlsx`). Currency: UZS. Period covered: 2026-06-23 … 2026-07-07. All formulas below are re-stated in plain math from the actual cell formulas.

## 0. Parties and vocabulary

- **Factory** (поставщик/завод): `"CAOLS KS" MCHJ`. Product label in the ledger is always «Газоблок».
- **Dealer** (the business): operates through owner legal entities — pays the factory from **«Септем Алока»**, sometimes receives client money into **«Септем семент»**, and also pays factory in cash («Нахт») and cash-to-card («Нахт пластика», card № 9860190103054400). The ERP must support multiple receiving/paying legal entities (or at least tag payments with payer/receiver entity).
- **Agents** (агент, numbered; the number is the prefix of client account sheets): 1 = Жамол («Жамол 22-22»), 2 = Арслон ога, 3 = Зафар ога, 4 = Шохрух ога, 5 = Темур **and also** 5 = Сардор ога (two distinct agents share number 5 in Свод Завод; Сардор's client sheet is prefixed 6). Agents do not hold money in this workbook — they are grouping/attribution only.
- **Clients** (клиент): 17 have dedicated account sheets; at least one (Отабек дамирчи) appears in the goods ledger without an account sheet. Sheet «0» is the blank client-sheet template.
- **Driver / transport** (шопир, авто): each shipment is one truck; transport is a per-truck cost normally paid by the dealer, sometimes paid by the client directly to the driver («клентдан» / «шопр учун барди»).
- **Pallet** (паддон/поддон): returnable wooden pallet. Dealer buys them from the factory at 130 000 UZS each **as part of the factory invoice**; clients are **not billed** for pallets in money but owe them back **in kind** (per-client pallet counter).

## 1. Sheet inventory

| Sheet | Purpose |
|---|---|
| **Товар** (A1:W1123, data rows 4–59, ~56 shipments) | Goods/shipments ledger. One row = one truckload from factory to a client. Master record for purchases (factory side) and sales (client side). |
| **Оплата** (A3:T1049, data rows 5–28) | Client payments ledger (money actually received by the dealer's entities). |
| **Оплата Завод** (A1:D35, data rows 3–21) | Dealer → factory payments ledger. |
| **Свод Завод** | Master summary: factory balance, per-agent blocks of per-client balances, pallet balances, and two reconciliation («фарк») checks. |
| **17 client sheets** «N-Имя» (e.g. «1-Урганч Тамирлаш», «3-Сулаймон Ога Хазарасп») | Per-client account: payments (left half) vs shipments (right half) side by side, plus pallet return tracking. Prefix N = agent number. |
| **«0»** | Empty client-sheet template. |

## 2. Товар (goods ledger) — columns and math

Columns (Excel letter / 0-based index for import):

| Col | Idx | Header | Meaning / formula |
|---|---|---|---|
| A | 0 | В-о | Row counter `A(n) = A(n-1)+1` |
| B | 1 | Поставшик | Product/supplier label — always «Газоблок» |
| C | 2 | Агент | Agent name |
| D | 3 | Клиент | Client name |
| E | 4 | Дата | Shipment date |
| F | 5 | № авто | Truck plate (identifies the vehicle/driver) |
| G | 6 | Размер | Block size: 600x300x200, 600x300x100, 600x300x250, 600x240x200 |
| H | 7 | Блок Куб | Volume in m³ (see §7 cube math) |
| I | 8 | Цена Приход | Purchase price per m³ (500 000 → later 625 000) |
| J | 9 | Сумма Приход | **= H × I** (block purchase cost) |
| K | 10 | Поддон Шт | Pallet count on the truck (18, 19, 13, 6…) |
| L | 11 | Цена Поддон | Pallet price = 130 000 (uniform) |
| M | 12 | Сумма Поддон | **= K × L** |
| N | 13 | Блок+Поддон | **= J + M** — what the dealer owes the factory for this truck |
| O | 14 | Цена Продажа | Sale price per m³ (700 000–760 000; sometimes back-computed, e.g. 732 542.438, 729 928.1 — derived from a negotiated lump sum ÷ m³) |
| P | 15 | Разница | Per-m³ margin. 1110 rows: **= O − I**. 5 early rows (legacy): **= (O + L) − I** — inconsistent variant, treat O − I as canonical |
| Q | 16 | ИЗОХ | Note; value «Фойда» (profit) when priced |
| R | 17 | Сумма Продажа | **= H × O** — what the client owes for this truck. **Pallets are NOT billed to the client.** |
| S | 18 | Расход Авто | Transport cost per truck. Numeric (2 000 000 typical, 2 550 000 seen) = dealer pays driver; text **«клентдан»** = client paid the driver directly; **«Х»** / blank = none/unknown |
| T | 19 | Общая прибль | **= R − J** (sale − block cost). **Does NOT subtract transport and does NOT include pallet cost.** |
| U | 20 | Авто услу барлдми? | Transport-paid status: «Туланди» (paid), a date (paid on that date), blank/«  » (unpaid/unknown) |
| W | — | (row 2 only) | `W2 = R2 − J2` cross-check of total profit |

Row 2 holds `SUBTOTAL(9, …)` grand totals (current values): H=1 769.762 m³; J=992 269 250; K=1 040 pallets; M=135 200 000; N=1 127 469 250; R=1 249 547 319.36; S=68 100 000 (numeric transport only); T=257 278 069.36.

Special rows: two Шиддат моналит trucks (rows 46–47, same plate 85 L 457 HA, split load 23.4 m³ + 10.37 m³) have **no sale price** → R=0, T negative — goods shipped before price agreed; client sheet shows them un-billed (M5=0) while the client has prepaid 86 M.

## 3. Оплата (client payments ledger) — columns

Header row is Excel row 4; data from row 5. `R3 = SUBTOTAL(9, [Жами сумма]) = 1 024 066 320`.

| Col | Idx | Header | Meaning |
|---|---|---|---|
| A | 0 | Дата | Payment date |
| B | 1 | Агент | Agent name |
| C | 2 | Клиент | Client name |
| D | 3 | ПР-Сумма | Bank-transfer (перечисление) amount |
| E | 4 | Плателщик | Paying legal entity (often ≠ client name — clients pay through third-party firms) |
| F | 5 | Накд | Cash amount |
| G–K | 6–10 | «-5» «-10» «-15» «-20» «-50» | Cash breakdown columns (banknote denominations ×1000, presumed — never used in data) |
| L | 11 | Клик | Click app amount |
| M | 12 | Терминал | POS terminal amount |
| N | 13 | $ | USD amount |
| O | 14 | Курс | Exchange rate |
| P | 15 | Сумма | Non-bank subtotal (always 0 in data) |
| Q | 16 | Прочие | Other |
| R | 17 | Жами сумма | **= D + P + Q** per row (total payment) |
| S | 18 | Получател | Receiving entity when not the default (e.g. «Септем семент») |
| T | 19 | Изох | Note (e.g. «бир машин газаблок даставка учун ташоди» — payment was for delivery of one truck) |

All 24 real payments so far are bank transfers (only D filled). **This ledger is incomplete relative to client sheets** — see reconciliation §6.

## 4. Оплата Завод (factory payments) — columns

Row 1: `B1 = SUBTOTAL(9,[Сумма]) = 2 101 088 520`. Headers row 2, data rows 3–21.

| Col | Idx | Header | Meaning |
|---|---|---|---|
| A | 0 | Дата | Date |
| B | 1 | Сумма | Amount |
| C | 2 | Платеелшик | Payer: «Септем Алока» (bank), «Нахт» (cash), «Нахт пластика» (cash to card) |
| D | 3 | Получател | Receiver: `"CAOLS KS" MCHJ` or card number |

## 5. Client account sheets («N-Имя») — layout and math

Each sheet is one Excel table with two side-by-side ledgers (fixed 43 data rows, 7–49; totals in row 5 and row 50):

**Left half — payments from the client:**
- A «№», B «Дата», C «Сумма» (payment amount), D «Примечание» (payer entity, or the literal marker **«шопр учун барди»** = "gave it to the driver"), E «Возврат паддон» (pallets returned, count).

**Right half — shipments to the client (mirror of Товар rows):**
- F «№», G «Дата», H «Авто» (plate), I «Размер», J «Блок Куб» (m³), K «Поддон Шт», L «Цена Продажа»/«От» (sale price per m³), M «Сумма» **= J × L**.

**Totals / balance cells:**
- `C5` = Σ payments (table Totals row) — includes «шопр учун барди» rows.
- `E5` = Σ pallets returned (currently 0 on every sheet — no returns recorded yet).
- `K5` = Σ pallets delivered.
- `M5` = Σ goods value.
- **`F2` = C5 − M5 — the client balance.** Negative ⇒ client owes the dealer; positive ⇒ client has credit/prepayment. (Sign convention is opposite to the ERP's `delivered − paid`.)
- `I1 = SUMIFS(C:C, D:D, "шопр учун барди")` — total the client paid directly to drivers (labelled «Клент шопрга барди»). These amounts are **inside** C5 (they reduce the client's debt) but are **not** in the Оплата ledger (the dealer never received that money) and correspond to Товар rows where Расход Авто = «клентдан».
- **Pallets outstanding at the client = K5 − E5** (delivered − returned); computed in Свод Завод, not on the sheet itself.
- A2 «ID-Клиента» — label present, value never filled.
- Row 6 contains internal Excel-table column keys (" ",1,2,3,4,9,10,11,114,113,1132,15,16) — ignore on import.

Current per-client balances (F2): Урганч Тамирлаш −6 929 600; Инвест Холдинг 0; Нормат Умидбек 0; Фидато Груп −720; Ирригатсия темир бетон +8 700 480; Хонкага −23 967 360; Гофур Хазорасп 0; Шиддат маналит +86 082 400 (prepaid, deliveries un-priced); Сулаймон Ога Хазарасп −68 947 000; Мурод ога Урганч 0; Сарвар ога Шовот 0; Гайрат Штб 0; Рустам Шпик +0.62 (float residue of back-computed price 729 928.1); Жаср(Жасур) Версал −43 964 800; Мустафо машал +17 600; Уткир мини +18 981 600.

## 6. Свод Завод (master summary) — every formula

**Factory block (col A/B/D, rows 1–5):**
- `B1 = Товар!J2` — blocks purchased = 992 269 250; `D1 = Товар!M2` — pallets purchased = 135 200 000.
- `B2 = Товар!N2` — purchases **with pallets** = 1 127 469 250.
- `B3 = 'Оплата Завод'!B1` — paid to factory = 2 101 088 520.
- **`B4 = B3 − B2` = «Завод Остаток» = 973 619 270** — dealer's prepaid credit at the factory (positive ⇒ factory owes goods). This is the headline factory balance and it **includes pallets**.
- `D2 = B3 − B1`, `B5 = D2` — «Завод Остаток без паддон» = 1 108 819 270 (alternative balance excluding pallet purchases). Both views are maintained; the difference is exactly the pallet money.

**Per-agent blocks** (4 blocks across columns D–AD for agents 1–4, rows 4–14; a second band rows 15–23 for agent 5 Темур and agent 5 Сардор ога). Each block has columns: Клиенты | Товар | Оплата | Остаток | Остаток Паддон | «Клент шопрга барди». Per client row: Товар = `'sheet'!M5`; Оплата = `'sheet'!C5`; Остаток = `'sheet'!F2`; Остаток Паддон = `'sheet'!K5 − 'sheet'!E5`; шопрга = `'sheet'!I1`. Row 5/16 = SUM per block.
- Per-agent balances shown (B9–B12): Жамол −22 197 200; Арслон +86 082 400; Зафар −68 947 000; Шохрух +0.62. (Агент balance = Σ of his clients' F2.)
- **`B8 = G5+N5+U5+AB5+G16` = «Жами остатка» = −49 008 999.36** — total net client balance. NOTE: it structurally omits the Сардор-ога group's Остаток column (N16), whose references are broken (see §8), so the true total including Уткир мини (+18 981 600) is ≈ −30 027 399.
- **`B7 = −(H5+O5+V5+AC5)` = «остаток паддон» = −812** — pallets outstanding at clients of agents 1–4 (sign-flipped: dealer must recover / return 812 pallets). Omits agent-5/6 groups (another 114 + 19 pallets per client sheets). Pallets purchased = 1 040; returns recorded = 0.

**Reconciliation («фарк») rows — the workbook's own invariants:**
- `B17 = ΣОплата columns of all blocks = 1 147 397 552.83` («Клентларга тушилган ПУЛ» — money credited to clients per client sheets).
- `B18 = Σ«шопрга» cells = 27 500 000` («Клентлар шопрга» — client-paid-driver total).
- `B19 = Оплата!R3 = 1 024 066 320` («Оплата лист»).
- **`B20 = B19 − B17 + B18` = фарк(payments) = −95 831 232.83.** Invariant intended: `Оплата ledger total = Σ client-sheet payments − driver-direct payments` ⇒ фарк should be 0. It is −95.8 M: client sheets contain ≈95.8 M of payments never entered in the Оплата ledger (identified: Шиддат ≈63 M, Ирригатсия 32.832 M, Уткир 1.964 M).
- `B23 = ΣТовар columns of blocks = 1 154 442 519.36` («Клентларга тушилган ТОВАР»; omits Сардор group L16 = 22 982 400 — formula defect).
- `B24 = Товар!R2 = 1 249 547 319.36` («Товар лист»).
- **`B25 = B24 − B23` = фарк(goods) = +95 104 800.** Invariant intended: goods ledger = Σ client-sheet shipments ⇒ 0. The gap comes from: clients without sheets (Отабек дамирчи 16.38 M), the omitted Сардор block, un-copied/mismatched trucks (e.g. Уткир: Товар has two 23.4 m³ trucks = 32.76 M, client sheet shows one 32.832 m³ truck = 22.98 M), and unpriced Шиддат deliveries.

## 7. Cube, pallet and pricing math (decoded)

- **Pallet volume**: 1 pallet of 600x300x200 = **1.728 m³** (48 blocks × 0.036 m³). Hence standard truck loads: 18 pallets = **31.104 m³**, 19 pallets = **32.832 m³**. 10.37 ≈ 6 × 1.728. The 600x300x250 truck shows 23.4 m³ with 13 pallets ⇒ **1.8 m³/pallet** (40 × 0.045 m³). Three later rows record 23.4 m³ with K=19 — pallet/cube inconsistency (mini trucks or data errors). The ERP should derive m³ from (pallets × per-size pallet volume) and validate against the entered cube.
- **Prices per m³**: purchase 500 000 → 625 000 (changed ~2026-07-01); sale 700 000 / 730 000 / 735 000 / 750 000 / 760 000 depending on client. Fractional prices (732 542.438; 729 928.1) are back-solved from a negotiated lump sum: `price = lumpSum / m³` — the ERP should support lump-sum entry with derived unit price to keep totals exact.
- **Pallet money**: only between dealer and factory (130 000 × count, in Блок+Поддон). Clients owe pallets **in kind**; per-client counter = delivered − returned. No pallet charge to clients anywhere in the workbook.

## 8. Transport rules

- Transport is per truck (Расход Авто), typically 2 000 000; dealer-absorbed (matches owner decision).
- **Profit column ignores transport**: Общая прибль = sale − blockCost. Real net profit = Σ(R−J) − Σ numeric S − (unrecovered pallet cost, if any). The ERP «profit» = saleTotal − costTotal − transportFee differs from the workbook's per-row figure — reports must label which definition is used.
- **«Клент шопрга барди» flow**: when the client pays the driver, (a) Товар.S holds the text «клентдан» (dealer owes driver nothing), and (b) the amount appears as a payment row in the client sheet with note «шопр учун барди», crediting the client's account. ERP model: a client payment with destination TRANSPORT that simultaneously settles the truck's transport liability — two postings, no cash through dealer's kassa. Totals: 27.5 M so far (I1 per sheet, B18 in Свод).
- Payment status of dealer-paid transport is tracked in Товар.U («Туланди»/date/blank). There is no money ledger for driver payments — U is the only record.

## 9. Balances — canonical definitions for the ERP

| Balance | Workbook formula | Sign |
|---|---|---|
| Client | `Σ payments (incl. driver-direct) − Σ (m³ × salePrice)` per client (`F2 = C5 − M5`) | negative ⇒ client owes dealer |
| Client pallets | `Σ pallets delivered − Σ pallets returned` (`K5 − E5`) | positive ⇒ client holds dealer's pallets |
| Factory (primary) | `Σ paid to factory − Σ (blockCost + palletCost)` (`B4 = B3 − B2`) | positive ⇒ dealer prepaid |
| Factory (secondary) | same excluding pallets (`B5`) | — |
| Transport | per truck: numeric Расход Авто with paid-status flag; no aggregate balance kept | — |
| Agent | Σ of his clients' balances (attribution only, no agent money) | — |

**Reconciliation invariants the ERP must keep at 0** (the workbook checks them manually and currently fails both):
1. `Σ(Оплата ledger) + Σ(driver-direct payments) = Σ(per-client payment totals)`.
2. `Σ(Товар ledger sale amounts) = Σ(per-client shipment totals)`.
3. `pallets purchased = Σ per-client (delivered − returned) + pallets returned to factory` (returns to factory not yet modeled in workbook).

## 10. Workbook defects the migration must handle (not replicate)

1. Broken references in the Свод agent-5/6 band: `N18/N19 → '…'!M2` (wrong cell, yields 0 instead of остаток), `O18/O19 → R5−L5` (wrong, should be K5−E5), `L19/M19 → '5-Мустафо машал'!T5/J5` (pulls m³ into a money column). Consequence: Уткир мини's +18.98 M credit and 19 pallets are missing from all headline totals.
2. `B7` pallet total and `B23` goods total omit the agent-5/6 blocks.
3. Client-name spelling drift across sheets: «Жасур Версал»(Товар) vs «Жаср Версал»(sheet/Оплата); «Шиддат моналит» vs «Шиддат маналит»; «Нормат Умидбек» vs «NORMAT UMIDBEK» (Cyrillic vs Latin); «Гофур Хазорасп» vs «Гофур хазорасп». A canonical client registry + alias map is required before import, otherwise duplicate clients split the debt.
4. Отабек дамирчи has shipments but no account sheet; Шиддат trucks are unpriced; Уткир truck data disagrees between Товар and the client sheet (plate 95 653 vs 95 693 GBA; 23.4×2 vs 32.832×1 m³).
5. One payment date typo (Оплата R28: 2026-06-06, almost certainly 07-06). Dates carry a timezone artifact (…T18:59:49Z ≈ local midnight UTC+5); any `toISOString().slice(0,10)` day-grouping must convert to local time first.
6. Five legacy Разница formulas include pallet price; ignore.
7. Float residues from back-computed prices (e.g. balance 0.6208) — the ERP should treat |balance| < 1 UZS as settled.

## 11. Import mapping (workbook → ERP), corrected

- **Товар → orders**: agent r[2], client r[3], date r[4], plate r[5], size r[6], quantity(m³) r[7], costPricePerUnit r[8], salePricePerUnit r[14], transport r[18] (numeric only; «клентдан» must set a `transportPaidByClient` flag, not 0-and-forget), **pallet count r[10] and pallet price r[11] must be captured** (new fields), transport-paid status r[20].
- **Оплата → client payments**: date r[0], agent r[1], client r[2], bank amount r[3], payer r[4], cash r[5], click r[11], terminal r[12], usd r[13], rate r[14], total r[17] (= r[3]+r[15]+r[16]), receiver entity r[18], note r[19]. Data begins at sheet-range index 2 (the used range starts at Excel row 3: index 0 = subtotal row, index 1 = header row).
- **Оплата Завод → factory payments**: date r[0], amount r[1], payer r[2] (drives method: Септем Алока→BANK, Нахт→CASH, Нахт пластика→CARD), receiver r[3].
- **Client sheets (currently NOT imported — required for parity)**: driver-direct payments (D=«шопр учун барди»), payments missing from Оплата (~95.8 M), pallet returns (col E), per-client pallet balances.
- Post-import validation: reproduce Свод numbers — client balances per §5, factory balance 973 619 270 (with pallets) / 1 108 819 270 (without), pallets outstanding, and both фарк values (target 0 after the gaps above are resolved with the owner).