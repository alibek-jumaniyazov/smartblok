# SmartBlok — Screen Spec: Pul harakati (To'lovlar · Kassa · Qarzlar)

**Status:** implementation-ready screen specification. Binding parents:
`02-design-language.md` (tokens, money semantics, platform state law §9),
`03-shell-and-ia.md` (routes, URL params §7, worklists §6, keyboard §8),
`04-components.md` (every component instance below), `05-hero-workflows.md`
(hero b §2, hero c §3, hero d §4, allocation §A, reconciliation §C, print §6).
Business logic LOCKED — every call below is an existing endpoint.

**Screens in scope:**
§1 `/payments` register · §2 payment PeekPanel (`/payments/:id`) ·
§3 PaymentComposer · §4 SettleDrawer (Taqsimlash) · §5 worklists
(Taqsimlanmagan · Tekshirilmagan) · §6 `/kassa` · §7 `/debts` hub ·
§8 print entry points · §9 kind×role matrix · §10 keyboard · §11 removed vs today.

---

## §0. Verified API facts this spec is built on (checked against `apps/api/src`)

| # | Fact | Consequence |
|---|---|---|
| 0.1 | `GET /payments` (A B K, G own) accepts `page, pageSize(≤200), search, kind, method, clientId, factoryId, dateFrom, dateTo, reconciled(true/false), voided(true=include)`. **No `vehicleId`, no `sort`.** | Vehicle filter control is **not rendered** (03 §7 rule — never a fake filter); sort headers render disabled with tooltip «server tartiblashni qo'llab-quvvatlamaydi». |
| 0.2 | The payments **list payload embeds active allocations** (`allocations: {where voidedAt:null, include order.orderNo}`) plus client/factory/vehicle(plate,driver)/agent/cashbox. | 03 §10c resolves TRUE: the «Taqsimot» remainder column is **exact server data per row** — no lazy fetch, no window disclaimer on the column. The `alloc-open` queue count still scans a labeled window (§5.1). |
| 0.3 | `GET /payments/:id` returns detail: parties, `payerEntity/receiverEntity`, `createdBy/voidedBy`, allocations (incl. voided, with `order.costStatus`, `order.transportPaidStatus`), `ledgerEntries`, `cashTransactions`. | The peek and every `LedgerImpactPreview` build from this payload — zero new endpoints. |
| 0.4 | `POST /payments` (A B K, G): AGENT only `kind=CLIENT_IN`; `method=BONUS` rejected («/bonus/offset orqali»); inline `allocations` A/B only; `idempotencyKey` returns the original on repeat; `usdAmount+rate` required for USD, UZS computed server-side; `payerEntityId/receiverEntityId` + free-text `payerName/receiverName` supported; optional `denominations` JSON. | Composer field map §3. Server Uzbek errors render verbatim. |
| 0.5 | `POST /payments/:id/allocations` (A/B), kinds `CLIENT_IN, FACTORY_OUT, VEHICLE_OUT, TRANSPORT_DIRECT`; Σ active ≤ amount; one active allocation per (payment, order); party must match; CANCELLED orders rejected. `POST /payments/:id/void` (A/B) `{reason ≤500}`. | SettleDrawer §4; ReasonModal §2.4. |
| 0.6 | `GET /kassa/cashboxes` (A B K) → boxes + all-time `inTotal/outTotal/adjustTotal/balance`. `GET /kassa/transactions` → `cashboxId, direction, source, dateFrom, dateTo, page` with embedded `payment` (kind, party, voidedAt), `expense` (category), `bonusTransaction` (factory), `reversalOf/reversedBy`, `createdBy`. `GET /kassa/summary?dateFrom&dateTo` → per-box `opening/in/out/adjustment/closing` + `totals {UZS, USD}`. `POST /kassa/manual` (A B K, strict `direction IN|OUT`). `POST /kassa/transactions/:id/reverse` (A/B, MANUAL rows only, reason required). | §6. Opening balance and per-currency totals are server figures — rendered as server truth, not «sahifa jami». |
| 0.10 | `POST /kassa/cashboxes/:id/balance` (**A only**) `{balance, note?, date?}` — «kassa balansini tahrirlash». The TARGET balance is sent, not a delta; the server diffs under a `FOR UPDATE` lock, writes one `CashSource=BALANCE_ADJUSTMENT` row, and returns `{...box, balance, delta, transaction}`. Negative target → 400, inactive box → 400, zero delta → `transaction: null` and no row. That source is EXCLUDED from `summary.in/out`, `dashboard.kassa.todayIn/todayOut` and the journal page totals, but INCLUDED in every balance; it is NOT storno-able (400). | §6.10. The correction moves the qoldiq and is visible in the journal, yet can never inflate a kirim/chiqim figure. |
| 0.7 | `GET /debts/summary` (A/B) → `clientsOweUs, weOweClients, factoryAdvance, weOweFactories, weOweVehicles, palletsAtClients`. `GET /debts/clients?days(1–365)&search&page` (A B, G own) → rows `{balance, palletBalance, hasOverdueOrders, overdueOrdersCount, overdueOrdersTotal, dueWithinWindow, paymentTermDays, creditLimit, agent, region, phone}` + `expectedCollections`; settled zero-rows already filtered server-side; sorted worst-first. `GET /debts/statement?account&partyId&from&to` → `openingBalance`, entries with `running`, `closingBalance`. | §7. Overdue flag is **server-computed** — the queue is honest. |
| 0.8 | `GET /factories` (A/B) → paged rows + `balance`, `bonusBalance`, pallet accountability. `GET /vehicles` → rows + `balance`. `GET /vehicles/:id` → vehicle + `balance` + `statement` + **own orders, last 50** (`transportCost/Charge/PaidStatus`). `GET /pallets/balances` (A B, G own). | Debts boards §7.3–7.5; VEHICLE_OUT/TRANSPORT_DIRECT candidates §4. |
| 0.9 | `GET /orders` accepts `status, clientId, factoryId, dateFrom, dateTo, search, page, pageSize(≤200)` — **no costStatus filter, no vehicleId, list rows carry `saleTotal, transportCharge, costStatus, transportPaidStatus` scalars but NOT allocations**; `GET /orders/:id` includes allocations with their payments. | CLIENT_IN / FACTORY_OUT candidate outstanding is resolved lazily per row (§4.2) — per-cell spinner, never a blocking overlay. |

---

## §1. `/payments` — To'lovlar (register)

### 1.1 Purpose

The append-only book of every money document. One page answers: what came in,
what went out, what is still **taqsimlanmagan** (blocking cost finalization /
aging / transport status), and what is still **tekshirilmagan** (imported,
unconfirmed). Detail lives in the docked peek — triage never leaves the list.

### 1.2 Layout

```
┌ PageHeader ─────────────────────────────────────────────────────────────────┐
│ To'lovlar                    [To'lov qabul qilish] [Zavodga to'lash]        │
│                              [Shofyorga to'lash] [⋯ boshqa ▾]               │
├ FilterBar ──────────────────────────────────────────────────────────────────┤
│ [⌕ Qidirish… /] [Turi ▾] [Usul ▾] [Mijoz ▾] [Zavod ▾] [DateRangeControl]   │
│ [Bekorlar: yashirish ▾] [Tekshiruv: hammasi ▾] [+ Filtr F] [Ko'rinishlar V]│
│ Jami: 214 ta        Sahifa jami: Kirim +12 450 000 · Chiqim −8 200 000     │
├ DataTable ──────────────────────────────────────┬ PeekPanel 560px (§2) ─────┤
│ Sana | Turi | Usul | Tomon | Summa (so'm) |     │  (ochiq bo'lsa)           │
│ Taqsimot | Kassa | Holat | ⋯                    │                           │
│ …rows…                                          │                           │
│ ▸ TotalsRow «Sahifa jami: …»                    │                           │
└ pagination ─────────────────────────────────────┴───────────────────────────┘
```

Max-width 1440, 24px padding. PeekPanel overlays from the right (list does not
reflow).

### 1.3 Component instances & data

| Instance | Component (04) | Data |
|---|---|---|
| Page header | `PageHeader` | title «To'lovlar»; actions per role (§1.4) |
| Filter row | `FilterBar` | writes URL via `useUrlFilters`; result meta «Jami: N ta» from `total` |
| Register | `DataTable` (peekable, density toggle `sb_density:<uid>:/payments`) | `GET /payments` with all URL params mapped 1:1 |
| Kind chip | `StatusChip` (dot style) | `kind` → shared `PAYMENT_KIND` labels: Mijozdan to'lov · Mijozga qaytarish · Zavodga to'lov · Zavoddan qaytim · Shofyorga to'lov · Mijoz shofyorga to'ladi |
| Amount | `MoneyCell` | `amount`; variant `in` for CLIENT_IN/FACTORY_REFUND, `neutral` for OUT kinds (spending is not an error — 02 §2.4), `ghost` for voided. USD rows: second line `small` «1 250,00 $ × 12 650» |
| Taqsimot column | mini progress bar + caption (custom cell, §5.1) | row `amount` − Σ embedded active `allocations[].amount` — exact server data (fact 0.2) |
| Holat column | amber dot «Tekshirilmagan» when `reconciled=false`; filled danger chip «Bekor qilingan» when `voidedAt` | list payload |
| Saved views | `SavedViews` | built-ins: «Tekshirilmagan» (`reconciled=false`), «Bugungi kirimlar» (`kind=client_in&from=today&to=today`), «Taqsimlanmagan*» (`chip=alloc-open`, starred — client-derived, window shown) |
| Totals | `TotalsRow` | API returns no filter aggregate → honestly labeled «Sahifa jami» (02 §6); per-direction split: Kirim (CLIENT_IN + FACTORY_REFUND) / Chiqim (FACTORY_OUT + CLIENT_REFUND + VEHICLE_OUT); TRANSPORT_DIRECT listed apart: «Kassadan tashqari: X» |
| Export | DataTable export slot | «CSV (sahifa)» — client-side, honestly labeled; no server export exists |

Columns (36px rows, 13px, unit in header once): Sana `DD.MM.YYYY` (fixed) ·
Turi (StatusChip) · Usul (text; USD sub-line) · Tomon (identity link — client →
`/clients/:id`, factory → `/factories/:id`, vehicle → `/vehicles/:id`;
TRANSPORT_DIRECT renders «Mijoz → Moshina» both linked) · Summa (so'm) ·
Taqsimot · Kassa (text) · Holat · trailing kebab. Row `aria-label`:
«Mijozdan to'lov, Жамол Ургенч, 4 500 000 so'm». Sort headers disabled with
tooltip (fact 0.1).

### 1.4 Actions

| Action | Where | Who | Behavior |
|---|---|---|---|
| To'lov qabul qilish (CLIENT_IN) | header primary; palette | A B K G | opens PaymentComposer §3 |
| Zavodga to'lash (FACTORY_OUT) | header | A B K | composer §3 |
| Shofyorga to'lash (VEHICLE_OUT) | header | A B K | composer §3 |
| ⋯ boshqa ▾: Mijozga qaytarish · Zavoddan qaytim · Mijoz shofyorga to'ladi | header overflow | A B K | composer §3 (refunds and TRANSPORT_DIRECT are rarer — off the primary row) |
| Ochish (peek) | row click / `Space` | all | §2 |
| Taqsimlash | row kebab (allocatable kinds, remainder ≥ 1, non-voided) | A B | SettleDrawer §4 (`?panel=taqsimlash`) |
| Kvitansiya | row kebab | all | `/print/receipt/:paymentId` (§8 guards) |
| Bekor qilish | row kebab (non-voided) | A B | ReasonModal §2.4 |
| Filtrlarni tozalash | FilterBar | all | clears all URL params |

Kebab is labeled («TO'LOV 12.07 4 500 000 amallari»); icon-only buttons are
extinct — the current eye/stop icon pair dies.

### 1.5 Filters + URL params (03 §7 contract)

`/payments?kind, method, clientId, factoryId, search, from, to,
voided(hide|show|only), reconciled(true|false), chip, view, page, peek,
panel(taqsimlash)`

- `kind` lowercase in URL (`client_in`…), mapped to API enum. Kind filter also
  narrows the Sahifa jami strip to one sum.
- `voided` tri-state ghost toggle «Bekorlar: yashirish / ko'rsatish / faqat» —
  maps to API `voided=true` for show/only; `only` filters `voidedAt≠null`
  client-side on the page with the chip visibly labeled «faqat bekorlar
  (sahifada)».
- `reconciled` tri-state «Tekshiruv: hammasi / Tekshirilmagan / Tekshirilgan» —
  **server filter** (`?reconciled=`), the C1 review queue.
- `chip=alloc-open` — the Taqsimlanmagan recipe (§5.1).
- `peek=<id>` opens the PeekPanel; canonical alias route `/payments/:id`.
  **Legacy deep link `?paymentId=<id>` is accepted and normalized** to
  `/payments/<id>` via replaceState — no dead link survives.
- Every change resets `page=1` (except page/pageSize/peek). Back/forward
  restores exactly.

AGENT variant: kind and factory filter controls not rendered (server scopes to
own CLIENT_IN); client select is server-scoped to own clients.

### 1.6 Keyboard

`/` search · `F` filter adder · `V` views · `N` = To'lov qabul qilish ·
`J/K`/`↑↓` cursor · `Enter` open `/payments/:id` · `Space` peek toggle; with
peek open `↑↓` moves the peek (URL replaceState) · `.` kebab · `Esc` closes
peek. Global `G T` navigates here.

### 1.7 States (platform law 02 §9 instantiated)

- First load: 8 skeleton rows, header + FilterBar intact.
- Refetch: rows stay, 2px hairline under PageHeader.
- Empty (no filter): «Hali to'lov yo'q — To'lov qabul qilish» (EmptyState +
  primary action).
- Empty (filtered): «Filtrga mos to'lov topilmadi» + «Filtrlarni tozalash».
- Error: ErrorState in the table region, server text verbatim, «Qayta urinish».
- Realtime: `payment` entity events coalesced 2s → refetch; changed visible row
  pulses once. Voided-elsewhere row flips to ghost in place.
- Voided rows: ghost (60% opacity, strikethrough on the amount only), inline
  reason chip, chain glyph → opens the peek at the void block.

### 1.8 Role variations

| Role | Sees | Creates | Taqsimlash / Bekor qilish |
|---|---|---|---|
| ADMIN, ACCOUNTANT | everything | all kinds | yes / yes |
| CASHIER | everything (unscoped) | all kinds, **no allocation section** — handoff line «Taqsimlashni buxgalter bajaradi» (locked: inline allocations A/B only) | no / no (kebab items absent) |
| AGENT | own clients' CLIENT_IN only (server-scoped) | CLIENT_IN for own clients | no / no |

### 1.9 Responsive

≥1200 full table + peek. 1024–1199: Kassa and Usul columns fold into row
expand; peek overlays. 768–1023: 2-line rows (Tomon + Turi chip / Summa +
Sana). <768 (AGENT): card list — Tomon `body-strong`, Summa right as MoneyCell
with full value always visible (no tooltip-only), chips beneath (Sana ·
Tekshirilmagan); peek becomes full-height bottom sheet; filters collapse into
«Filtrlar (2)» sheet.

---

## §2. Payment PeekPanel — `/payments/:id` (canonical document surface)

### 2.1 Purpose

View one money document without losing the list; the URL-addressable answer to
every cross-link (kassa journal, order workbench, bonus DEBT_OFFSET,
statements). Renders the register **with the peek open** — deep links land in
context.

### 2.2 Layout (PeekPanel 560px, e2)

```
┌──────────────────────────────────────────────┐
│ Mijozdan to'lov · 12.07.2026      ↗  ⎙  ✕   │  header
│ [Naqd] [Tekshirilmagan]                      │  chips (12%-tint style)
├──────────────────────────────────────────────┤
│ 4 500 000 so'm                    money-lg   │
│ $ bo'lsa: 1 250,00 $ × 12 650 = 15 812 500   │
│ Tomon      Жамол Ургенч → mijoz sahifasi     │
│ Agent      Jamol                             │
│ Kassa      Naqd kassa                        │
│ To'lovchi  «Жамол Ургенч» (yozma)            │
│ Kiritdi    B. Karimova · 12.07 14:32         │
│ Izoh       …                                 │
├ Taqsimotlar ─────────────────────────────────┤
│ Taqsimlanmagan qoldiq: 900 000  [Taqsimlash] │
│ ORD-000214  3 000 000   Faol                 │
│ ORD-000208    600 000   Faol                 │
├ Ledger yozuvlari ────────────────────────────┤
│ 12.07 · Mijoz to'lovi (PAYMENT_IN) −4 500 000│
├ Kassa harakati ──────────────────────────────┤
│ 12.07 14:32 · Naqd kassa · Kirim +4 500 000  │
├ footer ──────────────────────────────────────┤
│ [Kvitansiya chop etish]        [Bekor qilish]│
└──────────────────────────────────────────────┘
```

### 2.3 Components & data (`GET /payments/:id`, fact 0.3)

- Header: kind as title from `PAYMENT_KIND`, date meta; `↗` opens nothing new —
  `/payments/:id` **is** the full surface (peek = canonical); `⎙` = print menu.
- Description rows: Tomon links to the party page; `payerEntity/receiverEntity`
  names when set, free-text `payerName/receiverName` labeled «(yozma)»;
  `createdBy` + `createdAt`.
- **Taqsimotlar** mini-table: allocations incl. voided (ghost rows), columns
  Buyurtma (link → `/orders/:id`) · Summa · Holat (Faol / ghost «Bekor») ·
  FACTORY_OUT rows add Narx asosi chip («Naqd narx» / «O'tkazma narx» from
  `priceKind`). Live «Taqsimlanmagan qoldiq: X» line (amount − Σ active);
  **[Taqsimlash]** button (A/B, allocatable kind, remainder ≥ 1, non-voided) →
  SettleDrawer, URL `?panel=taqsimlash`.
- **Ledger yozuvlari**: rows through the shared `LEDGER_SOURCE` map (raw enum
  strings die); signed MoneyCell with direction words; reversal pairs chained
  (storno chips, hover highlights both).
- **Kassa harakati**: `cashTransactions` rows (datetime · box · direction word ·
  signed amount); REVERSAL rows chained.
- TRANSPORT_DIRECT: fixed info line «Kassadan ham, hisob-kitobdan ham pul
  o'tmagan — bu ulush buyurtma ochilganda qarzdan chiqarilgan. Bu yozuv faqat
  shofyor pulini olganini qayd etadi.» The ledger block is EMPTY by design (no
  rows are posted); instead it links to the order's create-time
  `TRANSPORT_CLIENT_DIRECT` row. See the
  [authoritative transport model](../00-business-map.md#transport-authoritative).
- Voided payment: danger banner top «Bekor qilingan — 13.07 09:10 · B. Karimova
  · sabab: …» + chain links to reversal ledger/kassa rows; footer actions
  reduce to Kvitansiya-guard explainer.

### 2.4 Bekor qilish (void) — ReasonModal instance

Danger title «To'lovni bekor qilish — 4 500 000 so'm, Жамол Ургенч».
`LedgerImpactPreview` built from the already-loaded detail payload:

- «2 ta taqsimot bekor bo'ladi (ORD-000214, ORD-000208)»
- FACTORY_OUT: «ORD-000198 tannarxi PROVISIONAL holatiga qaytadi —
  COST_ADJUSTMENT storno bo'ladi» (from `allocations[].order.costStatus`)
- VEHICLE_OUT / TRANSPORT_DIRECT: «transport holati qayta hisoblanadi»
- «Kassa: Naqd kassa −4 500 000 (qaytim yozuvi)» — non-cash kinds:
  «Kassaga tegmaydi»
- BONUS-funded: «Bonus hamyoniga qaytadi: +X»

Required reason (≥3 chars, ≤500), confirm labeled «Bekor qilish», never
default-focused. Server errors inline verbatim. On success: toast
«To'lov bekor qilindi», row goes ghost, all key families invalidate.

### 2.5 States

Loading: skeleton of the real layout (amount block + 6 description rows +
2 mini-tables). Error: ErrorState inside the panel, list survives. Composer
collision: socket event on the open payment → amber ribbon «Bu hujjat boshqa
foydalanuvchi tomonidan o'zgartirildi — Yangilash». K/G: footer shows only
Kvitansiya; allocation block read-only with «Taqsimlashni buxgalter bajaradi».

---

## §3. PaymentComposer — kind-first entry drawer (560px)

The 961-line morphing modal dies. One intent = one button = one fixed form;
the kind **never morphs mid-form** (the silent field-wipe dies with it).

### 3.1 Entry points

Register header buttons (§1.4) · Debts row `T`/button (§7.2, pre-bound) ·
party pages (pre-bound) · palette record-scoped actions («To'lov qabul
qilish — Жамол Ургенч») · cashier terminal intent buttons · vehicle hub
BulkBar (05 §4).

### 3.2 Fields per kind (maps to `CreatePaymentDto`, fact 0.4)

| Field | CLIENT_IN | CLIENT_REFUND | FACTORY_OUT | FACTORY_REFUND | VEHICLE_OUT | TRANSPORT_DIRECT |
|---|---|---|---|---|---|---|
| Party (`PartySelect`, BalanceTag in options) | Mijoz | Mijoz | Zavod | Zavod | Moshina | Mijoz **va** Moshina |
| Sana (default bugun) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Usul segmented: Naqd · O'tkazma · Click · Terminal · Karta · Valyuta (USD) | ✓ default = party's last-used | ✓ | ✓ + consequence line | ✓ | ✓ | ✓ |
| Summa (`MoneyInput`) / USD twin (usdAmount + kurs, UZS read-only equation) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Kassa (`CashboxSelect`, currency-filtered, live balance) | ✓ | ✓ | ✓ | ✓ | ✓ | **yo'q** — fixed line «Bu to'lov kassadan o'tmaydi — mijoz hisobidan kamayadi, shofyor hisobi yopiladi» |
| To'lovchi / Qabul qiluvchi (`LegalEntitySelect` + free-text fallback → `payerEntityId/payerName`, `receiverEntityId/receiverName`) | To'lovchi | Qabul qiluvchi | Qabul qiluvchi | To'lovchi | Qabul qiluvchi (shofyor nomi prefilled) | — |
| Izoh (≤1000) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Taqsimlash section (A/B, inline SettleDrawer body §4) | ✓ | — | ✓ | — | ✓ | ✓ |

Behavior notes:

- **Kurs pre-fill:** last USD payment's `rate` fetched once per drawer open
  (`GET /payments?method=USD&pageSize=1`), rendered selected — one keystroke
  replaces (04 §2.10).
- **FACTORY_OUT consequence line** under Usul: «O'TKAZMA — taqsimlanganda
  tannarx ZAVOD O'TKAZMA narxida qotiriladi» / «Naqd/Karta/USD — zavod naqd
  narxida» (locked cost-at-allocation rule made visible at the point of choice).
- Amount pre-fill when launched from a debt row: outstanding balance, rendered
  selected; quick chips beneath: «To'liq qarz (8 340 000)» ·
  «Muddati o'tgani (6 200 000)» (from `balance` / `overdueOrdersTotal`).
- Method BONUS never appears (locked: born only in `/bonus/offset`).
- Cashbox balances refetch on drawer open (stale-balance law); shortfall server
  error renders verbatim inline under Kassa and the select refetches.
- Fresh `idempotencyKey` per open; submit self-disables keeping its verb
  («Qabul qilinmoqda…»).
- Draft persists to sessionStorage per route; dirty-close confirmed.
- Footer: primary states its act — «Qabul qilish — 4 500 000 so'm» /
  «To'lash — 150 000 000 so'm» (`Ctrl+Enter`); A/B checkbox
  «Saqlash va taqsimlash» chains into §4 when the inline section wasn't used.
- `denominations` stays API-only (component law 04 omits it — backlog note,
  no UI is faked).

### 3.3 Success state

Mini delta from the refetched party balance: «Yangi balans: Qarz 3 340 000» +
**[Kvitansiya chop etish]** (→ `/print/receipt/:id`) + [Taqsimlash] (A/B, if
remainder > 0) + [Yana to'lov]. Behind the drawer the source row re-renders via
socket (pulse); the debt-board cursor stays on its row (hero b step 5).

### 3.4 Role variants

AGENT: only CLIENT_IN opens; party select server-scoped to own clients; no
allocation section; mobile = full-screen sheet, keypad-first amount
(`inputmode="numeric"`), balance as one-tap chip. CASHIER: all kinds, no
allocation section — info line «Taqsimlashni buxgalter bajaradi», payment lands
in the Taqsimlanmagan queue (§5.1). A/B: full.

---

## §4. SettleDrawer — «Taqsimlash» (allocation workbench)

Full behavioral spec: 05 §A. This section fixes the data wiring to verified
endpoints. Opens over its context (payment peek `?panel=taqsimlash`, composer
chain, FactoryDetail, VehicleDetail, Debts, worklist rows). Commits via
**`POST /payments/:id/allocations`** `{allocations: [{orderId, amount}]}` —
the endpoint that today has **no UI at all**.

### 4.1 Header

Payment summary (kind chip · party · amount · method) + live counter
**«Taqsimlanmagan qoldiq: X»** + FACTORY_OUT price-basis line
«Narx asosi: ZAVOD O'TKAZMA — to'lov usulidan».

### 4.2 Candidate table per kind (oldest-first)

| Kind | Candidate source | Per-row figure («qoldiq» column) | Resolution |
|---|---|---|---|
| CLIENT_IN | `GET /orders?clientId=&pageSize=200` non-CANCELLED, window labeled «oxirgi 200 buyurtma» | **Qoldiq** = `clientChargeable(order)` − Σ active CLIENT_IN allocations ([authoritative model](../00-business-map.md#transport-authoritative)) | list scalars are server data; the allocation Σ resolves lazily per row via `GET /orders/:id` — small per-cell spinner (fact 0.9), never a blocking overlay |
| FACTORY_OUT | `GET /orders?factoryId=&pageSize=200`, client-filtered to `costStatus ≠ FINAL`, window labeled | **Qoplanmagan** = provisional `costTotal` − covered (PARTIAL hairline) + costStatus chip | covered Σ lazy via `GET /orders/:id` |
| VEHICLE_OUT / TRANSPORT_DIRECT | **`GET /vehicles/:id` own-orders payload** (last 50, window labeled «oxirgi 50 reys»); VEHICLE_OUT lists DEALER_ABSORBED orders, TRANSPORT_DIRECT lists CLIENT_PAYS_DRIVER orders — **the server rejects the wrong pairing** | **Transport qoldig'i** = `transportCost` − allocated; transport status chip (To'lanmagan / violet «Aniqlanmagan ?») | the 100-recents client-side filter hack dies (fact 0.8) |

Row anatomy: checkbox · ORD no · sana · mijoz (FACTORY_OUT) · the figure above
· status chip · amount `MoneyInput` **pre-filled `min(outstanding, remaining)`**,
max hard-clamped.

### 4.3 Toolbar, guards, footer

- **`A` — «Eskisidan boshlab taqsimlash»**: FIFO fill until the payment is
  exhausted; rows fill sequentially at 40ms (values render instantly — numbers
  never animate); «Taqsimlanmagan qoldiq» counts to 0. «Tozalash» resets.
  Always user-confirmed, never auto-committed.
- Guards: Σ > amount unreachable (inputs clamp; exact excess shown if server
  data drifted); rows already holding an active allocation from this payment
  disabled with existing amount + «avval bekor qiling»; party-mismatch /
  CANCELLED disabled with reason; empty state «Ochiq hujjat yo'q».
- Footer `LedgerImpactPreview` + per-row forecast chips: «→ FINAL (o'tkazma
  narxi)» / «→ PARTIAL» / «Transport: To'langan bo'ladi»; PERCENT-bonus
  re-derivation named when FACTORY_OUT finalizes COMPLETED orders. Confirm:
  **«Taqsimlash — 150 000 000 so'm»** (`Ctrl+Enter`).
- Read-only variant (K/G): rows visible, no inputs, caption «Taqsimlashni
  buxgalter bajaradi».
- Success: toast «Taqsimlandi», peek allocations refresh, order cost chips flip
  app-wide via socket; the «Ochiq buyurtmalar» strip on FactoryDetail drops.

---

## §5. Worklists on `/payments`

### 5.1 Taqsimlanmagan to'lovlar (`chip=alloc-open`) — warning severity

**Definition:** non-voided payment, kind ∈ {CLIENT_IN, FACTORY_OUT, VEHICLE_OUT,
TRANSPORT_DIRECT}, `amount − Σ active allocations ≥ 1` UZS. Because the list
payload embeds active allocations (fact 0.2), the **per-row remainder is exact**;
only the *count/sum across pages* is a scan.

- Register column «Taqsimot»: mini-bar (allocated share, primary fill) +
  caption — full: «to'liq» (small, `moneyIn` ink); partial/none: amber
  «qoldiq 900 000»; non-allocatable kinds: em-dash.
- `chip=alloc-open` recipe: sets `voided=hide`, default window `from=` current
  month start (DateRangeControl visible and editable — the scan is honest about
  its bounds), fetches with `pageSize=200` and client-filters remainder ≥ 1;
  caption chip on FilterBar: «Taqsimlanmagan — oyna: Shu oy».
- WorklistCard (cockpit, A/B): «Taqsimlanmagan to'lovlar · N ta · Σ X» + top-3
  preview rows (party · remainder · age) opening the peek directly; «Hammasi →»
  drills to `/payments?chip=alloc-open`. Window label on the card footer.
- Each queue row's peek leads with the amber remainder line + [Taqsimlash] —
  this closes the cashier→accountant loop that keeps costs provisional.

### 5.2 Tekshirilmagan to'lovlar (`?reconciled=false`) — violet severity (05 §C1)

The ~95,8M imported review queue, now a **server filter**.

- FilterBar tri-state «Tekshiruv» + SavedView «Tekshirilmagan» + nav badge on
  To'lovlar (count from `GET /payments?reconciled=false&pageSize=1` → `total`).
- Rows carry the amber dot; the peek shows exactly what the owner checks
  against bank statements: `payerName`/entity, method, date, amount, id.
- Review affordances only: open payment · open client statement (peek link) ·
  Kvitansiya · Bekor qilish if wrong (ReasonModal). **No «tasdiqlash» button —
  the endpoint does not exist** (locked backend gap, honestly absent; the queue
  drains by voiding wrong payments; the badge is the memory).
- `↑/↓` triages through rows without losing the list; statement rows elsewhere
  reuse the same amber dot so unconfirmed history is visible everywhere.

---

## §6. `/kassa` — Kassa (treasury)

### 6.1 Purpose

Where is the cash, per box and per currency; what moved in the period; every
movement traceable to its source document in one click. A/B/K only.

### 6.2 Layout — ONE period control governs the whole page

```
┌ PageHeader ─────────────────────────────────────────────────────────────────┐
│ Kassa      [DateRangeControl: Bugun·Kecha·7 kun·Shu oy·…]  [Qo'lda kirim/chiqim]│
├ Cashbox cards (scoping filters) ────────────────────────────────────────────┤
│ ┌Naqd kassa ┐ ┌Bank Septem A.┐ ┌Click┐ ┌Terminal┐ ┌Karta┐ ┌Valyuta USD┐    │
│ │12 450 000 │ │ 84 200 000   │ │ …   │ │ …      │ │ …   │ │ 1 250,00 $│    │
│ └───────────┘ └──────────────┘ └─────┘ └────────┘ └─────┘ └───────────┘    │
│ Jami UZS: 96 650 000 so'm        Jami USD: 1 250,00 $   (hech qachon qo'shilmaydi)│
├ Davr xulosasi (period summary) ─────────────────────────────────────────────┤
│ Kassa | Boshlang'ich | Kirim | Chiqim | Yakuniy       ← server figures      │
├ Jurnal (FilterBar: [Yo'nalish ▾] [Manba ▾]) ────────────────────────────────┤
│ Sana/vaqt | Kassa | Yo'nalish | Summa | Manba | Hujjat | Izoh | ⋯           │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 6.3 Components & data

| Instance | Component | Data |
|---|---|---|
| Period control | `DateRangeControl` (default: Shu oy) | writes `?from&to` → feeds BOTH `GET /kassa/summary` and `GET /kassa/transactions` (the two desynced pickers die) |
| Cashbox cards | StatCard-style cards acting as **scoping filters** | `GET /kassa/cashboxes`: name, type icon, currency chip, live all-time `balance` (`money-lg`, full precision). Click toggles `?cashboxId=` — selected card gets the primary ring; summary + journal scope together. Inactive box: grey wash + «Nofaol» pill, still listed (history exists) |
| Currency totals | inline line under cards | Σ balances per currency from the same payload — **UZS and USD never merged** (locked) |
| Period summary | `DataTable` (non-paged) | `GET /kassa/summary?dateFrom&dateTo`: per box `opening / in / out / adjustment / closing` — server truth, no «sahifa jami» caveat; grand totals row from `totals {UZS, USD}`. Opening row on inset background. `closing = opening + in − out + adjustment`; `adjustment` is signed and only rendered when nonzero |
| Balance edit | inside the cashbox edit `FormDrawer` (§6.10) | `POST /kassa/cashboxes/:id/balance` — ADMIN only; the field sits under «Nomi» prefilled with the live balance |
| Journal | `DataTable` (paged, density toggle) | `GET /kassa/transactions?cashboxId&direction&source&dateFrom&dateTo&page` |
| Manual op | modal (04 grammar: money document → composer-style, but 2 fields → focused modal) | `POST /kassa/manual` |
| Storno | `ReasonModal` | `POST /kassa/transactions/:id/reverse` |

Journal columns: Sana `DD.MM.YYYY HH:mm` · Kassa (hidden when a card is
selected) · Yo'nalish (word: Kirim / Chiqim) · Summa (so'm): signed MoneyCell —
IN `+` in `moneyIn`, **OUT `−` in `colorText` — spending is not an error**
(current red dies; 02 §2.4) · Manba `StatusChip` (Qo'lda / To'lov / Xarajat /
Bonus yechish / Storno / O'tkazma / Diller kapitali / **Balans tuzatildi**) ·
**Hujjat** (link column):

> **Balans tuzatildi** rows render «—» in the Yo'nalish column and are skipped by
> the Kirim/Chiqim filter: they are neither, and the page's own kirim/chiqim
> figures exclude them (§6.10). Asking for them by `?source=` still works.

- payment → «Mijozdan to'lov · Жамол Ургенч» → `/payments/<id>` (peek opens in
  context); voided source payments render the chip ghosted;
- expense → «Xarajat · Transport» → `/expenses?cashboxId=<box>&from=<kun>&to=<kun>`
  (defined params only; the row is on that page);
- bonusTransaction → «Bonus yechish · CAOLS KS» → `/bonus`;
- REVERSAL rows → chained: «Storno ← 12.07 14:32» chain glyph jumps to the
  original row (both highlight on hover); original reversed rows carry
  «Qaytarilgan» chip + forward chain link.

Trailing kebab (labeled): «Qaytarish (storno)» — only on `source=MANUAL`,
un-reversed rows, A/B (locked: payment/expense-sourced rows are fixed by
voiding the source document — the kebab on those rows offers «Hujjatni ochish»
instead); «Kvitansiya» on payment-sourced rows.

### 6.4 Manual op modal — «Qo'lda kirim/chiqim» (A B K)

- Kassa: `CashboxSelect` (active boxes, live balance in option).
- Yo'nalish: strict segmented **Kirim | Chiqim** — **no preselection**; submit
  disabled until chosen (the v2 default-to-IN inversion stays dead at the UI
  too).
- Summa: `MoneyInput` (min 1). When Chiqim: advisory bound line «Kassada:
  12 450 000» (client-side warning at exceed; server remains authoritative —
  its shortfall figure renders verbatim inline on reject).
- Sana (default bugun), Izoh.
- Submit «Saqlash» (`Ctrl+Enter`), self-disables; success toast «Kassa yozuvi
  saqlandi», cards + summary + journal invalidate.

### 6.5 Storno — ReasonModal instance

Title «Kassa yozuvini qaytarish (storno)». `LedgerImpactPreview`:
«Qarama-qarshi yozuv yaratiladi: Naqd kassa − 2 000 000 (kirim stornosi)» +
box balance after. Reason required; confirm «Qaytarish». A reversal that would
drive the box negative is rejected by the server — error verbatim.

### 6.6 Filters + URL

`/kassa?cashboxId, from, to, source, dir(in|out), page`. (`dir` is a
page-local addition to the 03 §7 table — the existing direction filter may not
be lost; documented here as the canonical param.) `Esc` clears card scoping.

### 6.7 Keyboard

`N` manual op · `J/K` journal cursor · `Enter` opens the row's source document ·
`.` kebab · `1..9` quick-select cashbox card (hint chips on cards) · `/` not
applicable (no search on this endpoint — no fake search box).

### 6.8 States & roles

Skeleton: 6 card skeletons + summary table skeleton + 8 journal rows. Empty
journal (filtered): «Filtrga mos yozuv topilmadi». Error per region (cards /
summary / journal fail independently — page chrome survives). Realtime: kassa
events coalesced 2s; changed card + row pulse. CASHIER: full page, no storno
kebab. ADMIN/ACCOUNTANT: full — but the balance field of the cashbox edit drawer
is **ADMIN-only** (§6.10); ACCOUNTANT sees the same drawer without it. AGENT: no
access (nav absent, route 403 + «Bosh sahifaga qaytish»).

### 6.9 Responsive

Cards wrap 4→2→1; below 768 the journal becomes 2-line rows (box+source /
amount+time); period control collapses to a chip row; manual op becomes a
bottom sheet. Desk roles on phones: read-and-approve.

### 6.10 «Kassa balansini tahrirlash» — off-book qoldiq tuzatishi

Owner rule, 2026-07-23. The opening balance gets entered wrong, or reality and
the system drift apart. The owner must be able to retype the balance — **exactly
like retyping the name** — without that number pretending to be income.

**Entry point.** No separate modal: the cashbox card's pencil already opens the
edit `FormDrawer`, and the balance is just another field in it, sitting under
«Nomi» prefilled with the box's live balance (`Kassadagi pul` / `Hisobdagi pul`
on `/bank`). `MoneyInput` selects on focus, so one keystroke replaces it. Shown
to **ADMIN only** — the drawer itself stays A/B. Edit mode only: a new box has no
id and no balance yet, so an opening balance is «create, then edit».

**What travels over the wire is the TARGET balance, never a delta.** The server
diffs it against the live figure under the same `FOR UPDATE` lock the live kassa
ops take. Consequences that a delta cannot give: a stale prefill can neither
over- nor under-shoot, two admins cannot race into a double correction, and
saving the same number twice is a genuine no-op (no row, `delta: 0`).

**The rule the whole feature exists for:**

| Figure | Correction counted? |
|---|---|
| cashbox card `balance`, `summary.opening`, `summary.closing`, `dashboard.kassa.balance` | **YES** — it is the real money |
| `summary.in` / `summary.out` («Bu davr kirim/chiqim») | **no** |
| `dashboard.kassa.todayIn` / `todayOut` | **no** |
| journal «Sahifa jami» Kirim/Chiqim/Sof (Payments page) | **no** |
| `dashboard.allTime.collected` / `.chiqim` / `.netProfit` | **no** — Payment-derived, structurally immune |
| never-below-zero guards (payment OUT, manual OUT, transfer, bonus reversal) | **YES** — they must see the corrected truth |

So the window carries a fourth signed figure, `adjustment`, and
`closing = opening + in − out + adjustment`. The Kassa hero grows a
«Qo'lda tuzatish» tile when it is nonzero — without it «Haqiqiy naqd qoldiq» and
«Bu davr kirim/chiqim» sit on one screen and stop reconciling.

**Visible, not hidden.** Unlike the ledger-side «Balansni nazorat qilish»
(§ClientDetail), which writes no cash row at all, this one **must** write a row —
a cashbox balance is nothing but Σ(IN) − Σ(OUT). So it appears in the journal
under its own «Balans tuzatildi» chip (muted gold), with «—» for direction. A
qoldiq that moved with no visible cause is an audit black hole.

**Not storno-able.** A storno row is `source=REVERSAL`, which *is* a kirim/chiqim
source — reversing a correction would inject a phantom kirim. The kebab therefore
offers no storno on these rows and the endpoint returns 400 («qoldiqni qaytadan
tahrirlang»). A wrong correction is fixed by setting the balance again.

**Never negative.** The owner rule «kassa/bank hech qachon minusga tushmaydi» has
no exemption here: a negative target is rejected outright. Zero is allowed.

Single exclusion list: `apps/api/src/common/cash-flow.ts`. Guarded by
`apps/api/test/kassa-balance-edit.e2e.mjs`.

---

## §7. `/debts` — Qarzlar (collections hub)

### 7.1 Purpose & structure

The undiruv workbench: all three debt sides + in-kind pallets in one place,
worst-first, **every row carrying its own settle action** (governing principle
№4). Tabs sync to `?tab=mijozlar|zavodlar|shofyorlar|paddonlar` (default
mijozlar).

```
┌ PageHeader ─────────────────────────────────────────────────────────────────┐
│ Qarzlar                                    [Oyna: 7 kun ▾]                  │
│ ┌Mijozlar bizga qarz┐┌Mijozlar avansi┐┌Zavod avansimiz┐┌Zavodlarga qarzimiz┐│
│ │ 1 249 547 319     ││ 12 400 000    ││ 973 619 270   ││ 0                 ││
│ └── danger ─────────┘└── amber ──────┘└── green ──────┘└── amber ──────────┘│
│ ┌Shofyorlarga qarzimiz┐┌Mijozlardagi paddonlar┐   Kutilayotgan tushum (7 kun):│
│ │ 4 000 000           ││ 1 040 dona           │   84 520 000 so'm            │
│ └── amber ────────────┘└── neutral ───────────┘                              │
├ Tabs: [Mijozlar] [Zavodlar] [Shofyorlar] [Paddonlar] ───────────────────────┤
│ FilterBar (per tab) + board table                                            │
└──────────────────────────────────────────────────────────────────────────────┘
```

Header cards: `KpiBand` of 6 `StatCard`s from **`GET /debts/summary`** (A/B
only — endpoint 403s AGENT; the band simply doesn't render). Full precision,
semantic inks (02 §2.4), every card **a link**:

| Card (label) | Field | Drill |
|---|---|---|
| Mijozlar bizga qarz | `clientsOweUs` | `?tab=mijozlar` |
| Mijozlar avansi (qarzimiz) | `weOweClients` | `?tab=mijozlar&chip=avans` |
| Zavoddagi avansimiz | `factoryAdvance` | `?tab=zavodlar&chip=avans` |
| Zavodlarga qarzimiz | `weOweFactories` | `?tab=zavodlar&chip=qarz` |
| Shofyorlarga qarzimiz | `weOweVehicles` | `?tab=shofyorlar` |
| Mijozlardagi paddonlar | `palletsAtClients` (dona) | `?tab=paddonlar` |

`chip=avans/qarz/overdue` are client-side row filters applied per loaded page
with a visible caption «filtr sahifa ichida — jami summa yuqoridagi kartadan»
(honesty governance 03 §6; the headline figures are server truth).

URL: `/debts?tab, days(7|14|30), chip, search, page`.

### 7.2 Tab «Mijozlar» — the debt board (hero workflow b)

Data: **`GET /debts/clients?days&search&page`** (server-sorted worst-first;
settled zero rows already excluded server-side — fact 0.7).

Columns (36px, density toggle):

| Column | Render |
|---|---|
| Mijoz | link → `/clients/:id`; second line `small`: agent · region (folds at narrow) |
| Qarz balansi (so'm) | **alarm-red MoneyCell — this is a collections surface** (02 §2.4 exception); advances render as `BalanceTag` «Avans X» instead (never red); `|balance|<1` never appears (server-filtered) |
| Muddati o'tgan | `OverdueChip` — **count + Σ in the cell, never a tooltip**: «2 ta · 6 200 000»; em-dash when none; «Muddati yaqin» gold chip when `dueWithinWindow` |
| Paddon | `PalletChip` «⬛ 18 dona» (amber >0) — in-kind, adjacent to money, never mixed |
| To'lov sharti | «30 kun» / em-dash (`paymentTermDays`) |
| trailing | **[To'lov qabul qilish]** button + kebab: Akt sverki · Hisob-kitob (peek) · Mijoz kartasi |

Row interactions:

- `→` **expands the row**: the client's open orders inline — lazy
  `GET /orders?clientId=&pageSize=50` (non-CANCELLED), columns ORD no (link) ·
  sana · muddat (overdue dates in red) · Summa = `clientChargeable(order)`
  ([authoritative model](../00-business-map.md#transport-authoritative)) ·
  status chip; caption «oxirgi 50 buyurtma» (labeled window). No page switch to
  understand what the 8,3M consists of.
- `Space` peeks the **client statement**: PeekPanel 560px hosting
  `PartyStatement` over `GET /debts/statement?account=CLIENT&partyId=&from&to`
  (opening row, running balance, closing row, storno pairs chained,
  `reconciled:false` rows amber-dotted).
- **`T` / [To'lov qabul qilish]** → PaymentComposer §3, pre-bound: kind
  CLIENT_IN skipped, client locked with BalanceTag, **amount pre-filled with
  `balance` rendered selected**, quick chips «To'liq qarz» ·
  «Muddati o'tgani (6,2 mln)», method = last-used, cashbox auto. A/B: inline
  allocation section pre-run FIFO oldest-first. On success the drawer's delta
  shows the new balance; the row re-renders via socket (pulse) and **the cursor
  stays** — `↓` moves to the next debtor. Loop cost: 6 keystrokes + amount.
- Akt sverki → `/print/statement/client/:id?from&to` (§8).

Header row of the tab: window select «Oyna: 7 / 14 / 30 kun» (`?days=`) feeding
«Kutilayotgan tushum (N kun): X so'm» (server `expectedCollections` — a real
window-based forecast; the dashboard's duplicate card is dead) + search
(server `?search=`).

`chip=overdue` (worklist №1 drill): client-side filter to
`hasOverdueOrders=true` rows per page, caption visible; the flag itself is
server-computed.

### 7.3 Tab «Zavodlar» — liability board (A/B)

Data: `GET /factories?search&page` (fact 0.8). Columns: Zavod (link →
`/factories/:id`) · `BalanceTag` party-correct («Qarzimiz X» amber /
«Avansimiz X» green / «Hisob yopiq») · Bonus hamyon (MoneyCell + program badge
chip) · Paddon (accountability count, PalletChip) · trailing **[To'lash]**
(PaymentComposer FACTORY_OUT pre-bound; «Saqlash va taqsimlash» pre-checked —
hero c) + kebab: Zavod kartasi · Akt sverki (`/print/statement/factory/:id`).
`chip=qarz/avans` per-page filters, captioned. The full settlement ritual
(allocate → finalize → bonus) lives on `/factories/:id`; this tab is the
sweep list.

### 7.4 Tab «Shofyorlar» — driver sweep (A/B)

Data: `GET /vehicles?search&page` (rows carry `balance`). Default
`chip=owed` — rows with negative balance first (client-side order within page,
captioned). Columns: Moshina (link → `/vehicles/:id`; second line: plate ·
shofyor name) · Telefon (tap-to-call) · `BalanceTag` «Qarzimiz X» · trailing
**[Shofyorga to'lash]** (composer VEHICLE_OUT pre-bound, amount pre-filled
with |balance|) + kebab: Moshina kartasi · «Mijoz to'lagan deb yozish»
(composer TRANSPORT_DIRECT — client picked in-form, vehicle pre-bound).
Deep settlement (per-truck checkboxes + BulkBar) lives on `/vehicles/:id`
(05 §4); this tab is the fleet-wide list.

### 7.5 Tab «Paddonlar» — in-kind balances

Data: `GET /pallets/balances` (A B; G server-scoped). Client-side board:
Mijoz (link) · `PalletChip` balance («⬛ 18 dona», amber >0; popover shows the
delivered − returned − charged ± adjustments math) · agent · trailing
**[Paddon qaytarish]** (A/B — the pallet-return modal from the `/pallets`
spec, party pre-filled, **current → post-action balance** preview, **no price
field — a return moves zero money**, info line «Pul harakati yo'q — faqat soni
kamayadi»; commits `POST /pallets/client-return`). Kebab:
Mijoz kartasi · Paddon harakati (→ `/pallets` filtered). Locked rule surfaced
in the tab header caption: «Paddon — pul emas, dona hisobidagi qarz». AGENT
sees own clients read-only (mutations A/B).

### 7.6 States, roles, responsive

- Loading: KpiBand skeletons + 8 board skeleton rows per tab; tab switch keeps
  the header band (no jump).
- Empty (mijozlar, unfiltered): green EmptyState «Qarzdor mijoz yo'q — hammasi
  hisob yopiq ✓» (a clean board is visibly clean). Filtered-empty per law.
- Errors per region; summary band failure never blocks the board.
- Realtime: payment/order events → debts keys invalidated (2s coalesced),
  changed rows pulse.
- **AGENT**: no summary band (403), tabs reduced to **Mijozlar · Paddonlar**
  (own clients, server-scoped); no Zavodlar/Shofyorlar (nav, tabs, guards from
  the PERMISSIONS map). Row action «To'lov qabul qilish» opens the agent
  composer variant.
- Mobile (<768, AGENT): card list — client name `body-strong`, red debt figure
  right (full value, `fmtShort` only as the permanent secondary line), chips
  beneath (overdue · paddon · muddat); whole card tappable → bottom-sheet with
  actions (To'lov qabul qilish · Hisob-kitob · Akt sverki); `days` select as
  chip scroller; ≥44px targets; no hover-only info.
- Desk 1024–1199: Telefon/To'lov sharti fold into row expand.

---

## §8. Print entry points in this scope (full specs: 05 §6)

| Document | Route | Data | Entry points here | Guards |
|---|---|---|---|---|
| **Kvitansiya** (A5, 2-up: mijoz nusxasi / kassa nusxasi) | `/print/receipt/:paymentId` | `GET /payments/:id` (amount, so'z bilan, usul+kassa, allocation mini-list, party); new-balance line from the party's refetched balance | Composer success (§3.3) · payment peek footer (§2) · payments row kebab (§1.4) · kassa journal payment rows (§6.3) · K terminal feed | **Refuses TRANSPORT_DIRECT** («kassadan pul o'tmagan — mijoz shofyorga to'lagan») **and voided** («hujjat bekor qilingan») — explainer instead of the sheet |
| **Akt sverki** (client) | `/print/statement/client/:id?from&to` | `GET /debts/statement?account=CLIENT&partyId=` — the PartyStatement verbatim + paddon mini-table («pulga kirmaydi») | Debts row kebab (§7.2) · client statement peek toolbar | unreconciled rows marked «tekshirilmagan» honestly |
| **Akt sverki** (factory) | `/print/statement/factory/:id?from&to` | factory statement | Debts zavodlar kebab (§7.3) | — |

All print routes are chrome-free `PrintDocument` previews with the sticky
«Chop etish» toolbar (copy count, dealer-entity select — remembered); `P` on
detail surfaces opens the contextual print menu.

---

## §9. Payment kinds matrix per role (create surface, aligned with the server)

Rendered nowhere as a table — it is compiled into `lib/permissions.ts` and
drives which intent buttons exist per role. Reference:

| Kind (label) | A | B | K | G | Party fields | Kassa | Allocatable | Kvitansiya |
|---|---|---|---|---|---|---|---|---|
| CLIENT_IN — To'lov qabul qilish | ✓ | ✓ | ✓ | ✓ (own) | mijoz | ✓ | ✓ | ✓ |
| CLIENT_REFUND — Mijozga qaytarish | ✓ | ✓ | ✓ | — | mijoz | ✓ | — | ✓ |
| FACTORY_OUT — Zavodga to'lash | ✓ | ✓ | ✓ | — | zavod | ✓ | ✓ (cost finalization) | ✓ |
| FACTORY_REFUND — Zavoddan qaytim | ✓ | ✓ | ✓ | — | zavod | ✓ | — | ✓ |
| VEHICLE_OUT — Shofyorga to'lash | ✓ | ✓ | ✓ | — | moshina | ✓ | ✓ (transport) | ✓ |
| TRANSPORT_DIRECT — Mijoz shofyorga to'ladi | ✓ | ✓ | ✓ | — | mijoz + moshina | **yo'q** | ✓ **majburiy** (transport; every allocated order must be CLIENT_PAYS_DRIVER) | **yo'q** |
| method=BONUS | born only in `/bonus/offset` — never offered in any composer | | | | | | | |

> **TRANSPORT_DIRECT posts NO ledger rows** — neither client nor vehicle. The client's debt
> was already reduced by the order's create-time `TRANSPORT_CLIENT_DIRECT` carve-out, and the
> dealer never owed this driver. The payment exists to record that the driver got his cash and
> to drive `transportPaidStatus`. See the
> [authoritative transport model](../00-business-map.md#transport-authoritative).

Allocation entry (inline or §4) and void: **A/B only**, all kinds. The
kind↔party matrix is a hard server invariant — composer forms simply cannot
express an illegal combination (fields for other parties do not exist).

---

## §10. Keyboard summary (scope-local; global map 03 §8)

| Keys | Where | Action |
|---|---|---|
| `G T` / `G Q` / `G K` | global | To'lovlar / Qarzlar / Kassa |
| `N` | /payments, /kassa | To'lov qabul qilish / Qo'lda kirim-chiqim |
| `T` | debt rows, client rows, vehicle rows | composer pre-bound to the row's party |
| `Space` / `↑↓` | registers | peek toggle / move peek through rows |
| `→` | /debts mijozlar | expand row (open orders) |
| `A` | SettleDrawer | Eskisidan boshlab taqsimlash (FIFO) |
| `Ctrl+Enter` | composers, SettleDrawer, manual op | submit |
| `P` | peek/detail surfaces | print menu (Kvitansiya / Akt sverki) |
| `.` | any register row | kebab |
| `Esc` | everywhere | close topmost surface, dirty-checked |

---

## §11. Removed / replaced vs today (feature-loss audit — nothing lost)

### /payments (Payments.tsx)

| Today | Fate | Why |
|---|---|---|
| 720px morphing create modal (kind select wipes party/cashbox/allocations) | **dies** → intent-named PaymentComposer §3 | kind-first grammar; silent field-wipe is a data-loss trap |
| «Yangi to'lov» single button | → per-intent buttons + overflow | the kind chooser moves into the entry verb |
| Detail Drawer (state-only, no URL) | → URL-addressable PeekPanel `/payments/:id` | dead deep links die; `?paymentId=` legacy alias normalized |
| Eye + stop icon-only buttons | → row click + labeled kebab | icon-only controls are extinct (02 §10) |
| «Tekshirilsin» orange Tag | → canonical «Tekshirilmagan» amber dot + server `?reconciled=` filter + queue | glossary; the flag becomes workable, not decorative |
| Raw ledger enum strings in the drawer (CLIENT, COST_ADJUSTMENT) | → shared `LEDGER_SOURCE` labels | one translation map everywhere |
| `modal.confirm` void with closure-variable TextArea | → ReasonModal + LedgerImpactPreview | consequences before reason; validation inline |
| Voided switch (binary) | → tri-state «Bekorlar» | law 02 §6 |
| Allocation Form.List (blind order dropdown, no outstanding, no prefill) | → SettleDrawer §4 | the core pain point; over-allocation becomes unreachable |
| Client picker «balans −1 200 000» raw signed | → BalanceTag in options | sign convention leaves the user's head |
| Allocation candidates = first 100 orders filtered client-side by vehicle | → vehicle-detail own-orders payload | fact 0.8; silent truncation dies |
| Kept as-is | idempotency-key-per-open; USD equation; all 7 filters (kind/method/client/factory/search/date/voided); pagination; party text; kassa column | — |

### /kassa (Kassa.tsx)

| Today | Fate | Why |
|---|---|---|
| Two independent RangePickers (summary vs journal) | **one** DateRangeControl governs the page | desync trap dies |
| Box names repeated in 3 sections | cashbox cards become scoping filters (`?cashboxId=`) | one selection scopes summary + journal |
| Red OUT amounts | OUT renders in `colorText` | spending is not an error (02 §2.4) |
| «Bog'liq hujjat» plain tags/text | source documents are links (payment peek, expense register, bonus) | cross-link contract 03 §9 |
| `modal.confirm` storno | ReasonModal + impact preview | one destructive surface |
| Manual modal defaults direction to IN | no preselection, strict choice | the v2 inversion class stays dead |
| Icon-only Qaytarish button | labeled kebab item | 02 §10 |
| Kept | per-box cards with balances; opening/in/out/closing summary + UZS/USD totals; all 4 journal filters (+`dir` param added to URL contract); MANUAL-only storno rule; inactive-box display |

### /debts (Debts.tsx)

| Today | Fate | Why |
|---|---|---|
| Six static stat cards | drillable KpiBand cards → tab/chip targets | every number is a door |
| Overdue count+total in a Tooltip | `OverdueChip` inline in the cell | no tooltip-only information |
| No row payment action (the №1 pain) | [To'lov qabul qilish] + `T`, prefilled client+amount, FIFO pre-run | hero workflow b |
| Single client table | 4-tab hub: Mijozlar · Zavodlar · Shofyorlar · Paddonlar | all three debt sides + in-kind in one place |
| `debtsStatement` wired in api.ts but never called | statement peek (`Space`) + Akt sverki print | first UI for an existing endpoint |
| Red/green raw balance column | alarm-red debt (collections surface) / BalanceTag for advances | 02 §2.4 enforcement |
| Kept | search; 7/14/30 window + expectedCollections; paddon count; payment-term column; agent/region/phone; worst-first sort; server overdue flags |

### Deliberately NOT designed (backend-first backlog, honestly absent)

Mark-reconciled action (no endpoint) · cashbox CRUD · manual ledger ADJUSTMENT
screen · opening-balance wizard · denominations helper UI · aging buckets
beyond the server's overdue flag (no bucket data in `GET /debts/clients` —
the row expand + statement peek carry the per-order truth instead; a server
aging param is the 10× fix, noted, not faked).
