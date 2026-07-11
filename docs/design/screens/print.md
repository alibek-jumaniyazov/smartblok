# SmartBlok — Screen Spec: Print Document System (v1)

**Status:** implementation-ready screen spec. Governed by `02-design-language.md` (tokens,
platform state law), `03-shell-and-ia.md` (routes §4, print chrome §1.5, params §7, keys §8),
`04-components.md` §4.7 `PrintDocument`, `05-hero-workflows.md` §6 (print flows — LAW).
Frontend-only: every document renders from data the API already serves. No new endpoints.

Scope — four paper documents on five routes:

| # | Document | Route | Roles |
|---|---|---|---|
| 1 | Yuk xati (driver waybill / load sheet) | `/print/waybill/:orderId` | A B G(own) |
| 2 | Hisob-faktura (client invoice) | `/print/invoice/:orderId` | A B G(own) |
| 3 | Kvitansiya (cashier receipt) | `/print/receipt/:paymentId` | A B K G(own) |
| 4a | Akt sverki — mijoz | `/print/statement/client/:id?from&to` | A B G(own) |
| 4b | Akt sverki — zavod | `/print/statement/factory/:id?from&to` | A B |

Today the app has **zero** print documents — only a generic `@media print` rule in
`index.css` that strips chrome when someone Ctrl+P's a page. Everything below is net-new;
nothing existing is lost (inventory in §7).

---

## 0. Shared foundations (all five routes)

### 0.1 Route shell

Print routes render **outside** `AppFrame` in a minimal `PrintLayout`: no SideNav, no
TopBar, no PeekPanel host. Auth guard + `PERMISSIONS` role guard identical to any route
(403 → Result 403 + «Bosh sahifaga qaytish»). The screen shows:

```
┌──────────────────────────────────────────────────────────────────────┐
│ PrintToolbar (sticky top, e2, no-print)                              │
│ [← Orqaga]  Yuk xati — ORD-000214   [Diler: Септем Алока ▾]          │
│             [Nusxa: − 1 +] [doc-specific toggles]   [⎙ Chop etish]   │
├──────────────────────────────────────────────────────────────────────┤
│              colorBgLayout backdrop, centered                        │
│         ┌──────────────────────────────────┐                         │
│         │  white .sheet  (A4/A5/80mm)      │  ← always white paper,  │
│         │  black ink, e2 shadow on screen  │    both app themes      │
│         └──────────────────────────────────┘                         │
└──────────────────────────────────────────────────────────────────────┘
```

- The **sheet is deliberately theme-invariant**: white background, near-black ink
  (`#111`), in light and dark app themes alike — it previews paper. The backdrop and
  toolbar are normal token-themed surfaces.
- Data is fetched **once on mount** (react-query, socket invalidation deliberately NOT
  wired to print routes): a paper snapshot must not reflow mid-preview. Freshness is
  anchored by the footer timestamp. Toolbar overflow carries «Yangilash» (manual refetch).
- «Orqaga» returns to the invoker (`history.back()`; fallback: the document's source
  record — order / payment / party page).

### 0.2 `PrintToolbar` (one component, instanced per doc)

| Control | Behavior |
|---|---|
| «← Orqaga» | back to invoker; `Esc` triggers it |
| Title | 14px/600: doc name + record id («Kvitansiya — 12.07.2026 №A4F2») |
| **Diler firmasi** select | options = `GET /legal-entities` filtered `kind=DEALER`, `active=true` (name + INN in the option row). Choice persisted as a **snapshot** `{id, name, inn}` in `localStorage sb_print_entity` — remembered across sessions and documents. Visible to A, B, K. **Hidden for AGENT** (endpoint is A/B/K-only — never a faked select); AGENT letterhead uses the device's stored snapshot if one exists, else the fill-by-hand fallback (§0.3). |
| «Nusxa» stepper | `?copies=1..5` (default 1) — renders the whole document N times with page breaks (for kiosk/driver-copy scenarios; the browser dialog's own copies also works) |
| Doc-specific toggles | see each screen; every content-changing toggle is a URL param (shareable, back-button-safe per `03` §7) |
| «⎙ Chop etish» | primary; calls `window.print()`; `Ctrl+P` equivalent (intercepted so the browser prints the preview, not the toolbar) |

### 0.3 `PrintDocument` scaffold (from `04` §4.7 — exact anatomy)

Every sheet, top to bottom:

1. **Letterhead**: dealer legal-entity name + «INN: …» (from the toolbar snapshot) + the
   printing user's phone (from auth profile, if set). Fallback when no snapshot exists
   (fresh AGENT device): a blank ruled line `Diler: ______________________` — a paper
   fill-by-hand fallback, never invented data.
2. **Title block**: document title (16pt/650) + document № + sana (`DD.MM.YYYY`).
3. **Body** (per document below).
4. **Signature strips**: per document; each strip = role label over a rule line + «Sana:
   ________»; `break-inside: avoid`.
5. **Footer** (repeats per page): `SmartBlok · chop etildi 12.07.2026 14:32 · [user name]`
   + `N / M sahifa` (see §6 page-number strategy).

### 0.4 Shared formatting law on paper

- Money via shared `fmtMoney` (`1 249 547 319`), «so'm» once — on hero figures and totals;
  table columns carry «(so'm)» in the header once. True minus U+2212. No `fmtShort`
  anywhere on paper.
- Dates `DD.MM.YYYY`; datetimes `DD.MM.YYYY HH:mm`; Tashkent-local.
- Volumes 3dp «m³»; pallets integer «dona»; per-m³ prices at stored precision (6dp values
  like `729 928.1` print as stored — never silently rounded).
- **Status words, not chips**: on paper every status renders as its canonical label from
  `lib/status-maps.ts` in brackets — `[To'langan]`, `[Tekshirilmagan]`, `[storno]`.
  Semantic colors degrade to weight/brackets — black-on-white ink only.
- **Sum in words**: new frontend util `lib/num-words-uz.ts` («yigirma uch million to'qqiz
  yuz ming so'm») — used by Kvitansiya, Hisob-faktura JAMI, Akt sverki closing balance.
- Legacy Cyrillic workbook strings inside notes render through `ArtifactText` semantics:
  on paper = same serif-italic wrapped in « » (quoted evidence, never translated). Party
  names in Cyrillic («Жамол Ургенч») are canonical data and print verbatim, upright.
- One column of meaning per table; no vertical rules; 0.5pt horizontal hairlines.

### 0.5 Shared states (platform law `02` §9 applied)

| State | Treatment |
|---|---|
| Loading | Sheet-shaped skeleton (letterhead bar, title bar, 6 body rows) inside the white sheet — toolbar renders immediately; layout never jumps |
| Query error | `ErrorState` in place of the sheet: Uzbek message + server text verbatim + «Qayta urinish»; toolbar chrome survives |
| Guard-refused | Explainer card in place of the sheet (04 §4.7 state): one 20px icon + one sentence naming the rule + one link back to the record. Never a blank page, never a fake document |
| 403 / foreign record (AGENT) | server 403 → Result 403 + «Bosh sahifaga qaytish» |
| Print event | `@media print` hides toolbar/backdrop; only `.sheet` prints |

### 0.6 Keyboard (all print routes)

| Keys | Action |
|---|---|
| `Ctrl+P` / `Enter` | Chop etish |
| `Esc` | Orqaga (back to invoker) |
| `P` on OrderDetail / ClientDetail / FactoryDetail / payment peek | opens the contextual print menu that leads here (03 §8) |

### 0.7 Responsive

- ≥900px: sheet at natural size (A4 210mm ≈ 794px), centered.
- <900px: sheet scales to viewport width (`transform: scale()` with top origin — never
  horizontal page scroll); toolbar wraps to two rows; «Chop etish» becomes a sticky 48px
  bottom bar on AGENT phones and hands off to the **system print/share sheet** (05 §2.1 —
  WhatsApp-a-PDF is a first-class path for the owner/agent).
- Print output is unaffected by viewport — `@page` sizes rule.

---

## 1. `/print/waybill/:orderId` — Yuk xati (nakladnaya)

### 1.1 Purpose

The paper the **driver** carries: what to load at the factory, where to take it, and how
many pallets the gate counts. It is a logistics document — **money-free by default**: cost
prices are confidential (locked rule: AGENT never sees factory prices; a driver never
carries the dealer's economics). Two copies per sheet: one rides with the truck, one stays
in the office.

### 1.2 Data mapping

| Data | Source |
|---|---|
| Order: `orderNo, date, status, note, driverName, transportMode, items[]`, `vehicle{name, plate, driver, phone, capacityPallets}`, `factory{name}`, `client{name, phone}`, `agent{name}` | `GET /orders/:id` (existing detail payload) |
| Client **hudud** (region name) + fallback phone | `GET /clients/:id` → `region.name` (order payload embeds client scalars only, not the region relation — a second parallel fetch; renders «—» while absent/failed, the sheet never blocks on it) |
| Items table rows | `items[].product.name`, `product.size`, `palletCount`, `quantityM3` |
| Σ paddon / Σ m³ | client-side Σ over `items[]` (display math only) |
| Sale prices (toggle, default OFF) | `items[].salePricePerM3`, `items[].saleTotal`, order `saleTotal` |
| Driver | `order.driverName` snapshot; fallback `vehicle.driver` (snapshot wins — Vehicle.driver may have changed since) |

### 1.3 Layout — **A5 landscape, 2 copies per A4 sheet** (top: «Haydalma nusxa», bottom: «Ofis nusxasi» — small 9pt corner captions)

```
┌───────────────────────────────────────────────────────────────────┐
│ Септем Алока · INN 305… · tel +998…            [haydalma nusxa]   │
│                                                                   │
│ YUK XATI  № ORD-000214              Sana: 05.07.2026              │
│───────────────────────────────────────────────────────────────────│
│ Yuklash (zavod):  "CAOLS KS" MCHJ                                 │
│ Mijoz:  Жамол Ургенч · Urganch tumani · +998 91 …                 │
│ Agent:  Жамол                                                     │
│                                                                   │
│ Moshina:  01 A 774 BA   (Isuzu)      Shofyor: Baxtiyor · +998 …   │
│───────────────────────────────────────────────────────────────────│
│ Mahsulot            O'lchami        Paddon        Hajm (m³)       │
│ Gazoblok D500       600×300×200         19          32,832        │
│ Gazoblok D600       600×300×250          —           4,500        │
│───────────────────────────────────────────────────────────────────│
│ JAMI PADDON:   19 dona        Jami hajm: 37,332 m³                │
│         ↑ 22pt/700 — what the gate counts                         │
│                                                                   │
│ Paddonlar qaytariladigan idish — 19 dona mijoz zimmasiga o'tadi.  │
│ Izoh: «…»  (only when order.note is set)                          │
│                                                                   │
│ Yukladi (zavod)        Shofyor            Qabul qildi (mijoz)     │
│ ______________         ______________     ______________          │
│ Sana: ________         Sana: ________     Sana: ________          │
│ SmartBlok · chop etildi 12.07.2026 14:32 · Alibek        1/1      │
└───────────────────────────────────────────────────────────────────┘
```

Exact arrangement rules:

- № + sana are the largest text after the pallet total; **plate number 14pt/700** (checked
  at gates); Σ paddon is the hero figure (22pt/700) — per 05 §6.1 «what the gate counts».
- Items table: 4 columns only (Mahsulot / O'lchami / Paddon / Hajm (m³)); zero pallets
  renders «—»; volumes 3dp. With the price toggle ON, two columns append: «Narx (so'm/m³)»
  and «Summa (so'm)» + a JAMI money row — and a 9pt caption «narxlar mijoz uchun» so a
  priced copy is visibly a client copy.
- The pallet note prints **always** when Σ paddon > 0 (locked rule made physical: pallets
  are in-kind debt, the driver and client both sign under it). Hidden when Σ paddon = 0.
- `transportMode = CLIENT_OWN` → the Moshina line renders «Mijozning o'z transporti» +
  plate/driver if a vehicle was still recorded.
- **No cost prices, no factory prices, no balances — ever.** The sale-price toggle is the
  only money that can appear.

### 1.4 Component instances

| Instance | Component (04) | Notes |
|---|---|---|
| Toolbar | `PrintToolbar` (§0.2) | + toggle «Sotish narxlari» → `?prices=1`, **default off** |
| Sheet | `PrintDocument` | A5 landscape 2-up variant |
| Money cells (toggle on) | `MoneyCell` print rendering | neutral variant, tabular |
| Status word | shared `STATUS` map | only in the guard explainer, not on the sheet |

### 1.5 Actions

| Action | Where |
|---|---|
| Chop etish | toolbar primary / `Ctrl+P` |
| Sotish narxlari ko'rsatish | toolbar Switch (URL-synced `prices`) |
| Nusxa soni | toolbar stepper (`copies` — repeats the full A4 2-up sheet) |
| Orqaga | toolbar / `Esc` → OrderDetail |

Entry points into this route: OrderDetail header «Chop etish ▾ → Yuk xati» (`P` menu);
the **success toast at the LOADING transition** («Yuklanmoqda — Yuk xatini chop etish →»,
05 §6.1); Orders register row kebab «Chop etish → Yuk xati»; command palette «Chop etish»
scoped to an order record.

### 1.6 URL params

`prices` (0/1, default 0) · `copies` (1–5, default 1). No other filters.

### 1.7 Guards / states

| Case | Treatment |
|---|---|
| `status ∈ {NEW, CONFIRMED}` | guard-refused explainer: «Yuk xati YUKLANMOQDA holatidan boshlab chop etiladi — buyurtma hali yuklanmagan.» + link «Buyurtmaga qaytish». (OrderDetail's print menu item is likewise disabled pre-LOADING with this reason as caption — the route guard is the backstop for pasted URLs.) |
| `status = CANCELLED` | explainer: «Buyurtma bekor qilingan — yuk xati haqiqiy emas.» + reason (`cancelReason`) + link |
| No vehicle | unreachable at LOADING+ (server rule); belt-and-braces: explainer «Moshina biriktirilmagan» + link to the workbench (its StatusFlow carries «Biriktirish») |
| LOADING…COMPLETED | prints; reprint is always allowed |
| region fetch fails | hudud renders «—»; sheet still prints (secondary fact never blocks the truck) |

### 1.8 Role variations

- **A / B**: full, incl. price toggle.
- **AGENT**: own orders only (server-scoped); price toggle available (sale prices are the
  agent's own numbers); dealer-entity select hidden (§0.2); phone flow uses system share.
- **CASHIER**: no route (not in `03` §4 route table; nav/palette never offer it).

### 1.9 Removed vs today

Net-new. Today a driver gets nothing, or a phone photo of the order screen (which exposes
cost status, profit and balances). The old «Ctrl+P the workbench» path dies for this use —
replaced by a money-free paper. Nothing existing removed.

### 1.10 Rules made visible

Pallet in-kind rule (signed note line) · cost confidentiality (no cost anywhere) ·
driver-name snapshot (order.driverName, not live vehicle.driver) · one order = one truck
(single vehicle block) · status gate LOADING+ · soft-cancel (refusal names the reason).

---

## 2. `/print/invoice/:orderId` — Hisob-faktura

### 2.1 Purpose

The client-facing bill for one order. Since **debt is recognized at order creation**
(locked owner decision), the invoice is valid from NEW — it documents the exposure the
ledger already carries: `JAMI = saleTotal + transportCharge`. It also makes the pallet
rule contractual on paper.

### 2.2 Data mapping

| Data | Source |
|---|---|
| Order header: `orderNo, date, dueDate, status, note, transportMode, transportCharge, saleTotal`, `factory{name}`, `agent{name}`, `client` scalars (`name, phone, legalEntityId`) | `GET /orders/:id` (`include: {client: true}` — client **scalars only**, no `region`/`legalEntity` relation) |
| Items: `product{name, size}`, `quantityM3`, `salePricePerM3` (6dp stored), `listPricePerM3`, `saleTotal`, `pricePending` | same payload |
| Xaridor block region + optional balance line + legal-entity name | `GET /clients/:id` → `region.name`, `balance` (and `legalEntity.name` **only if** the client payload exposes the relation — else the «Yur. shaxs» line is omitted, never resolved from the bare `legalEntityId`) |
| Sotuvchi block | `sb_print_entity` snapshot (§0.2) |
| JAMI in words | `lib/num-words-uz.ts` over `saleTotal + transportCharge` |

### 2.3 Layout — **A4 portrait**

```
┌──────────────────────────────────────────────────────────────────┐
│ HISOB-FAKTURA  № ORD-000214                    Sana: 05.07.2026  │
│                                                                  │
│ Sotuvchi                          Xaridor                        │
│ Септем Алока MCHJ                 Жамол Ургенч                   │
│ INN: 305…                         Yur. shaxs: … (if set)         │
│ Tel: +998 …                       Hudud: Urganch · Tel: +998 …   │
│                                   Agent: Жамол                   │
│──────────────────────────────────────────────────────────────────│
│ №  Mahsulot          O'lchami   Hajm(m³)  Narx (so'm/m³)  Summa  │
│ 1  Gazoblok D500     600×300…    32,832       729 928,1  23 964… │
│      kelishilgan summa — narx qayta hisoblangan (9pt, indented)  │
│ 2  Gazoblok D600*    600×300…     4,500   narx kelishilmoqda  —* │
│──────────────────────────────────────────────────────────────────│
│                              Mahsulot jami:        23 964 500    │
│                              Transport xizmati:       300 000    │
│                              JAMI:              24 264 500 so'm  │  ← 14pt/700
│        So'z bilan: yigirma to'rt million ikki yuz oltmish …      │
│                                                                  │
│ To'lov muddati: 19.07.2026                                       │
│ * Narxi kelishilmagan pozitsiya jamiga kirmagan.  (only if any)  │
│ Paddonlar (19 dona) qaytariladi — narxga kirmaydi.               │
│ Hisob holati: Qarz 24 264 500 so'm (12.07.2026 holatiga) [toggle]│
│                                                                  │
│ Sotuvchi ______________            Xaridor ______________        │
│ SmartBlok · chop etildi … · [user]                        1/1    │
└──────────────────────────────────────────────────────────────────┘
```

Rules of arrangement:

- **Narx column at stored precision** — back-solved 6dp prices print as stored (`729 928,1`
  is real; locked rule). When `salePricePerM3` differs from `listPricePerM3`, a 9pt
  indented note under the row: «kelishilgan narx»; when it also carries a fractional
  remainder past 2dp (the lump-sum back-solve signature) the note reads «kelishilgan
  summa — narx qayta hisoblangan» and the row's Summa is the exactly-stored agreed total
  (05 §6.2). Display heuristic only — totals always come from stored `saleTotal`.
- **`pricePending` rows**: product line prints with `*`, Narx cell «narx kelishilmoqda»,
  Summa «—», excluded from all totals; the asterisk footnote appears once. The client sees
  honestly that one truck is not yet priced.
- «Transport xizmati» line renders **only** when `transportMode = DEALER_CHARGED` and
  `transportCharge > 0` (locked 3-mode rule; CLIENT_OWN/DEALER_ABSORBED invoices show no
  transport line at all — absorbed cost is the dealer's business, never the client's).
- `JAMI = saleTotal + transportCharge` — the exposure-correct total (the same figure the
  credit gate checked), 14pt/700, + so'z bilan line.
- `To'lov muddati` prints only when `dueDate` set.
- Pallet footnote prints whenever Σ `palletCount` > 0 — the in-kind rule made contractual.
- **Balance line** (toggle, default off, `?balance=1`): «Hisob holati: Qarz X so'm /
  Avans X so'm / Hisob yopiq (DD.MM.YYYY holatiga)» from the client-detail balance —
  explicitly stamped with «holatiga» because it is *current*, not as-of-order (honesty
  rule; |balance| < 1 → «Hisob yopiq»). Rendered only if the balance fetch succeeded.
- No cost, no profit, no factory prices — sale side only.

### 2.4 Component instances

| Instance | Component | Notes |
|---|---|---|
| Toolbar | `PrintToolbar` | + toggle «Hisob holati» → `?balance=1` |
| Sheet | `PrintDocument` A4 |
| Money | `MoneyCell` print | neutral; JAMI `body-strong`→14pt |
| Balance sentence | `BalanceTag` phrasing (words only on paper) | Qarz / Avans / Hisob yopiq |

### 2.5 Actions & entry points

Toolbar: Chop etish · Diler firmasi · Nusxa · Hisob holati toggle · Orqaga.
Entry: OrderDetail «Chop etish ▾ → Hisob-faktura» (`P`); order-create success screen
(05 §1.7 — invoice printed while the agent is told the number); Orders row kebab; **BulkBar
batch print** (04 §1.8): selection on `/orders` → «Hisob-faktura chop etish» opens this
route with `?ids=<id,id,…>` — one invoice per order, page-break between; the toolbar title
shows «5 ta hisob-faktura», the balance toggle applies to all. (`:orderId` stays the
canonical single form; `ids` is the batch extension that makes 04 §1.8's verb real.)

### 2.6 URL params

`balance` (0/1, default 0) · `copies` (1–5) · `ids` (batch list, optional — overrides the
path id).

### 2.7 Guards / states

| Case | Treatment |
|---|---|
| `status = CANCELLED` | explainer: «Buyurtma bekor qilingan — hisob-faktura haqiqiy emas. Sabab: …» + link. In batch mode, cancelled ids are skipped and the toolbar states «1 ta bekor qilingani o'tkazib yuborildi». |
| Any other status | prints (debt exists from creation) |
| All items pricePending | prints with JAMI 0 + the asterisk footnote — never blocked, the paper is honest («narx kelishilmoqda») |
| Balance fetch fails/forbidden | balance line silently absent (never guessed) |

### 2.8 Role variations

- **A / B**: full.
- **AGENT**: own orders; balance toggle works (`GET /clients/:id` is agent-scoped-own);
  entity select hidden (§0.2). Mobile: system share sheet.
- **CASHIER**: no route.

### 2.9 Removed vs today

Net-new. Today the closest artifact is printing the OrderDetail page raw (exposes cost
status, goods profit, internal tags to the client) — retired for client-facing use.

### 2.10 Rules made visible

Debt at creation (invoice valid from NEW, dueDate line) · exposure = sale + transport
(JAMI) · transport 3 modes (conditional line) · pallets in-kind never billed (footnote) ·
stored-precision prices / exact lump sums · pricePending excluded from totals · settled
epsilon («Hisob yopiq») · soft-cancel (refusal + reason).

---

## 3. `/print/receipt/:paymentId` — Kvitansiya

### 3.1 Purpose

Proof-of-payment handed across the desk the moment money moves: client payments, factory
payments, driver payments (the driver signs the office copy — 05 §4.3). Prints seconds
after `PaymentComposer` success. **Not a fiscal receipt** — footer carries «ichki hujjat»
so the paper never impersonates a government fiscal check.

### 3.2 Data mapping — `GET /payments/:id` (detail payload; no second fetch required except the optional balance line)

| Sheet element | Field(s) |
|---|---|
| № + datetime | `id` short-form (last 8, upper) + `date`/`createdAt` (`DD.MM.YYYY HH:mm`) |
| Kimdan / Kimga | derived from `kind` (matrix below) using `client{name}`, `factory{name}`, `vehicle{name, plate, driver}`, `payerEntity/receiverEntity` (fallback `payerName`/`receiverName` free text) |
| Summa | `amount` (large) + so'z bilan |
| USD equation | when `method=USD`: `usdAmount × rate = amount so'm` — the full equation, always (02 §7) |
| Usul / Kassa | `method` label (shared map) + `cashbox.name` (+ currency); `method=BONUS` → «Kassa: — (bonus hisobidan)» |
| Taqsimot mini-list | active `allocations[]`: «ORD-000214 uchun: 3 000 000» per row (voided allocations omitted) |
| Qoldiq line | party balance — CLIENT: `GET /clients/:id .balance`; VEHICLE: `GET /vehicles/:id` balance; FACTORY: `GET /factories/:id` balance. Rendered **only when the role may fetch it** (§3.8) |
| Tekshirilmagan mark | `reconciled=false` → bracketed `[tekshirilmagan]` under the amount |
| Qabul qildi | `createdBy.name` |
| Izoh | `note` (imported Cyrillic notes in `ArtifactText` style) |

Kimdan/Kimga per kind (labels from shared `PAYMENT_KIND` map):

| kind | Kimdan | Kimga |
|---|---|---|
| CLIENT_IN | mijoz (payerEntity/payerName if set) | diler (receiver entity / letterhead) |
| CLIENT_REFUND | diler | mijoz |
| FACTORY_OUT | diler | zavod (receiverEntity, e.g. «CAOLS KS» MCHJ / card № as text) |
| FACTORY_REFUND | zavod | diler |
| VEHICLE_OUT | diler | shofyor (vehicle.driver · plate) |
| TRANSPORT_DIRECT | **refused** (§3.7) |

### 3.3 Layout — default **A5 portrait, 2-up on A4** («mijoz nusxasi» / «kassa nusxasi»); toggle **80mm termal**

A5 copy:

```
┌──────────────────────────────────────┐
│ Септем Алока · INN … [kassa nusxasi] │
│ KVITANSIYA  № 7A19F3C2               │
│ 12.07.2026 15:41                     │
│──────────────────────────────────────│
│ Kimdan: Гофур Хазорасп               │
│ Kimga:  Септем Алока MCHJ            │
│                                      │
│ SUMMA:      5 000 000 so'm           │  ← 20pt/700
│ [tekshirilmagan]  (only when false)  │
│ So'z bilan: besh million so'm        │
│ $394.32 × 12 680 = 5 000 000 so'm    │  (USD only)
│ Usul: Naqd · Kassa: Naqd kassa (UZS) │
│──────────────────────────────────────│
│ Taqsimot:                            │
│  ORD-000101 uchun:     4 100 000     │
│  ORD-000107 uchun:       900 000     │
│──────────────────────────────────────│
│ Qoldiq: Qarz 3 340 000 so'm          │  (when permitted)
│ Izoh: «…»                            │
│                                      │
│ Topshirdi ________  Qabul qildi ____ │
│ SmartBlok · ichki hujjat · chop      │
│ etildi 12.07.2026 15:41 · Malika 1/1 │
└──────────────────────────────────────┘
```

**80mm variant** (`?paper=80`): same content stacked single-column at 72mm printable
width, 10–11pt, no signature rules (thermal roll — signatures collapse to one «Imzo:
________» line), no letterhead INN wrap issues (name on its own line). One copy (roll
printers cut per document; use the copies stepper for a duplicate).

### 3.4 Component instances

| Instance | Component | Notes |
|---|---|---|
| Toolbar | `PrintToolbar` | + Segmented «Qog'oz: A5 2-nusxa / 80mm» → `?paper` |
| Sheet | `PrintDocument` A5-2up / 80mm |
| Summa | `MoneyCell` hero print, `moneyIn` semantics degraded to weight |
| Qoldiq sentence | `BalanceTag` phrasing in words (Qarz / Avans / Qarzimiz / Hisob yopiq — party-correct) |
| Izoh | `ArtifactText` print styling |

### 3.5 Actions & entry points

Toolbar: Chop etish · Diler firmasi · Nusxa · Qog'oz toggle · Orqaga.
Entry points: **PaymentComposer success state «Kvitansiya chop etish»** (hero flow §2.5);
payment PeekPanel header ⎙ (`/payments/:id`); Kassa journal payment-sourced rows; CASHIER
terminal live feed per-row «Kvitansiya»; Debts flow post-collection; command palette.

### 3.6 URL params

`paper` (`a5` default / `80`) · `copies` (1–5; 80mm only — A5 is inherently 2-up).
`paper` persists last choice per device in `localStorage sb_print_paper` (a cash desk with
a thermal printer sets it once); explicit URL param wins.

### 3.7 Guards (03 route table — binding)

| Case | Explainer instead of document |
|---|---|
| `kind = TRANSPORT_DIRECT` | «Kvitansiya chop etilmaydi — kassadan pul o'tmagan: mijoz shofyorga to'lagan.» + link to the payment peek. (Locked rule: TRANSPORT_DIRECT never touches the kassa — a cash receipt would assert a cash event that didn't happen.) |
| `voidedAt ≠ null` | «Hujjat bekor qilingan — DD.MM.YYYY, sabab: …» (voidReason verbatim) + link. Every entry-point button on voided rows is likewise absent/disabled; the route is the backstop. |
| `method = BONUS` | prints, with «Kassa: — (bonus hisobidan)» — an internal offset document, honestly labeled |

### 3.8 Role variations

- **A / B**: full, incl. Qoldiq line for all party types.
- **CASHIER**: prints all payment kinds it can read; **Qoldiq line omitted** — `GET
  /clients/:id`, `/vehicles/:id`, `/factories/:id` are not CASHIER-readable; the line
  simply doesn't render (never faked, never erroring the sheet).
- **AGENT**: own CLIENT_IN receipts only (server scoping); Qoldiq via own-client detail
  works; entity select hidden; phone → system share sheet.

### 3.9 Removed vs today

Net-new — today a client paying 5M so'm gets nothing on paper (05 §2 names this: «no
receipt at all»). No existing feature removed. The `denominations` JSON field remains
UI-less (as today) — a cash-count helper is composer scope, not print scope.

### 3.10 Rules made visible

TRANSPORT_DIRECT no-kassa rule (refusal text teaches it) · void immutability (refusal +
reason) · USD server-computed equation · reconciled=false honesty mark · allocation
transparency (which orders the money settled) · idempotent creation (the receipt reprints
identically — № is the payment id, so a double-print is visibly the same document).

---

## 4. `/print/statement/client/:id` & `/print/statement/factory/:id` — Akt sverki

### 4.1 Purpose

The reconciliation statement two parties sign: «O'ZARO HISOB-KITOB SOLISHTIRISH
DALOLATNOMASI» (title literal per 05 §6.4 — set as text, not a CSS transform). Replaces
the owner's Excel screenshots on WhatsApp. The body is the `PartyStatement` **verbatim**
in classic two-column money form; multi-page-safe. Client and factory variants share one
implementation, differing in party block, sign phrasing, and the pallet appendix source.

### 4.2 Data mapping

| Data | Source |
|---|---|
| Statement | `GET /debts/statement?account=CLIENT\|FACTORY&partyId=:id&from&to` → `party{name}`, `openingBalance`, `entries[]` (`date`, `source`, `amount`, `note`, `orderId/paymentId/reversalOfId`, `order{orderNo}`, `payment{kind,method}`, `running`), `closingBalance` |
| Row label | shared `LEDGER_SOURCE` map («Buyurtma savdosi», «To'lov», «Transport xizmati», «Paddon undirish», «Tannarx tuzatish», «Bonus hisobidan», «Storno», «Import») + document № («· ORD-000214») |
| Party block (client) | `GET /clients/:id`: name, `legalEntity`, phone, `region.name`, `agent.name` |
| Party block (factory) | `GET /factories/:id`: name (+ INN when the factory legal entity is known via letterhead-style snapshot; else name only) |
| Unreconciled marks | `GET /payments?clientId=:id&reconciled=false&pageSize=200` (server filter — hard constraint list) → set of payment ids; entries whose `paymentId` matches print `[tekshirilmagan]`. If >200 rows exist the footer states «tekshirilmagan belgilar oxirgi 200 to'lov bo'yicha» — bounded, labeled, never silent |
| TRANSPORT_DIRECT annotation | `payment.kind = TRANSPORT_DIRECT` → row note «shofyorga to'langan» |
| Pallet appendix (client variant) | `GET /pallets/transactions?clientId=:id&pageSize=500` (all pages fetched; endpoint has no date filter) — windowed client-side: davr boshi = Σ signed movements `< from`; berildi / qaytarildi / undirildi = Σ per type within window; davr oxiri = running result. Footnote names the derivation: «paddon hisob-kitobi harakatlar jurnalidan hisoblangan» |
| Pallet appendix (factory variant) | same endpoint `?factoryId=` (RECEIVED_FROM_FACTORY / RETURNED_TO_FACTORY ± adjustments — the pallet-module formula, one truth) |
| Closing in words | `num-words-uz` |

### 4.3 Layout — **A4 portrait, multi-page-safe**

```
┌────────────────────────────────────────────────────────────────────┐
│ O'ZARO HISOB-KITOB SOLISHTIRISH DALOLATNOMASI                      │
│ Davr: 01.06.2026 — 30.06.2026                                      │
│                                                                    │
│ Diler:  Септем Алока MCHJ · INN …          Mijoz: Жамол Ургенч     │
│ Tel: …                                     Hudud: Urganch · Agent: │
│────────────────────────────────────────────────────────────────────│
│ ┌ Davr boshiga mijozning qarzi: 8 200 000 so'm ┐   ← framed row    │
│────────────────────────────────────────────────────────────────────│
│ Sana      Hujjat              Izoh          Debet     Kredit  Qoldiq│
│ 03.06.26  Buyurtma savdosi    —          4 500 000       —  12 700…│
│           · ORD-000198                                              │
│ 05.06.26  To'lov · Naqd       —               —   3 000 000  9 700…│
│ 06.06.26  To'lov · O'tkazma   [tekshirilmagan] — 1 200 000  8 500…│
│ 08.06.26  To'lov              shofyorga       —     500 000  8 000…│
│                               to'langan                             │
│ 10.06.26  Buyurtma savdosi ⟲  storno      2 100 000      —  10 100…│
│ 10.06.26  Bekor qilish    ⟲  storno          —   2 100 000  8 000…│
│   (pair chained: ⟲ marker + shared reference index, nets to zero)  │
│ …                                                                   │
│────────────────────────────────────────────────────────────────────│
│ ┌ Davr oxiriga mijozning qarzi: 8 000 000 so'm ┐                   │
│   So'z bilan: sakkiz million so'm                                  │
│                                                                    │
│ Paddon qo'shimchasi (pulga kirmaydi):                              │
│ Davr boshi   Berildi   Qaytarildi   Undirildi   Davr oxiri         │
│    12          19          10           2           19  dona       │
│                                                                    │
│ E'tirozlar 10 kun ichida bildiriladi.                              │
│ Diler ______________              Mijoz ______________             │
│ SmartBlok · chop etildi … · [user]                       1 / 2     │
└────────────────────────────────────────────────────────────────────┘
```

Arrangement rules:

- **Debet / Kredit mapping**: entry `amount > 0` → Debet, `< 0` → |amount| in Kredit —
  same for both variants (sign convention lives in the component, not the reader's head).
  The Qoldiq column is the server `running` (opening-adjusted), printed unsigned with the
  balance *sentence* reserved for the framed opening/closing rows.
- Framed opening/closing rows use party-correct phrasing: client — «mijozning qarzi» /
  «mijozning avansi»; factory — «zavod oldidagi qarzimiz» / «zavoddagi avansimiz»;
  |balance| < 1 → «0 so'm — hisob yopiq» (locked epsilon rule).
- **Reversal pairs**: rows linked via `reversalOfId` both carry the ⟲ glyph + «storno»
  bracket + a shared superscript index (¹, ²…) so an accountant matches them on paper;
  reversals carry the ORIGINAL business date (ledger law) so windows net to zero — the
  pair is adjacent by date, visibly netting.
- Month separators when the window spans months: 10pt sub-header row «Iyun 2026» on the
  inset-gray band; 40%-tint zebra on statement rows (the one zebra exception, 02 §6).
- `thead` repeats per page (`display: table-header-group`); framed opening row prints on
  page 1 only; framed closing + words + appendix + signatures `break-inside: avoid` as one
  block (pushed to a new page whole if they don't fit).
- Empty period: «Bu davrda harakat yo'q» line between the two framed rows — opening =
  closing, still a signable statement (platform law).
- Imported-row notes print via `ArtifactText` («шопр учун барди») — quoted evidence.
- Factory variant extras: cost-side sources render with their full labels («Buyurtma
  tannarxi», «Tannarx tuzatish (qotirish)», «Paddon qaytarish krediti», «Bonus hisobidan
  yopish») — this document exposes cost data and is therefore **A/B only** (route + server
  both enforce; AGENT gets 403 → Result screen).

### 4.4 Component instances

| Instance | Component | Notes |
|---|---|---|
| Toolbar | `PrintToolbar` | + `DateRangeControl` (presets Bugun · 7 kun · Shu oy · O'tgan oy · Shu yil · Oraliq…) writing `?from&to` |
| Body | `PartyStatement` with `printMode` (04 §2.4 — «doubles verbatim as the akt sverki print body») |
| Rows | `MoneyCell` print, `LEDGER_SOURCE` labels, `ArtifactText` |
| Balance sentences | `BalanceTag` phrasing (words) |
| Pallet appendix | `PalletChip` math table («pulga kirmaydi» caption — in-kind never money) |

### 4.5 Actions & entry points

Toolbar: Chop etish · Diler firmasi · Nusxa · Davr (`DateRangeControl`) · Orqaga.
Entry: ClientDetail `PartyBalanceHeader` action «Akt sverki» (`P` menu); Debts board row
verb «Akt sverki» (hero flow §5.4 — expand worst row → print → WhatsApp the PDF);
FactoryDetail header overflow «Akt sverki» (hero flow §3.6); clients register row kebab;
command palette record-scoped action.

### 4.6 Filters + URL params

`from`, `to` (YYYY-MM-DD, Tashkent-local days, per 03 §7). Defaults: **Shu oy** when
launched from party pages (matching the on-screen statement period the user was viewing —
the entry point passes its current `?from&to` through); a bare URL without params renders
full history with the opening row labeled «Hisob boshidan». Changing the range refetches
in place (2px hairline; sheet content swaps, no spinner over data).

### 4.7 Guards / states

| Case | Treatment |
|---|---|
| Party not found | ErrorState + server text |
| AGENT on factory variant / foreign client | server 403 → Result 403 |
| Empty period | statement still renders (§4.3) |
| Unreconciled-list fetch fails | statement prints **without** the marks + one toolbar-side amber note «tekshirilmagan belgilar yuklanmadi» — degradation is visible, never silent |
| Pallet appendix fetch fails / >500 movements truncated | appendix replaced by «paddon ma'lumoti yuklanmadi» line / footnote states the window — the money statement never blocks on the appendix |

### 4.8 Role variations

- **A / B**: both variants, all clients/factories.
- **AGENT**: client variant, own clients only (server `assertOwnAgent`); entity select
  hidden; the phone path (share as PDF to WhatsApp) is primary.
- **CASHIER**: no route.

### 4.9 Removed vs today

Net-new. Today reconciliation = exporting/screenshotting the ClientDetail statement tab
(20-row-capped views, no opening balance framing, no signatures, no pallet appendix).
Nothing existing removed; `GET /debts/statement` finally gains its second consumer.

### 4.10 Rules made visible

Ledger immutability + storno pairs netting to zero (chained ⟲ rows) · reversals carry
original business date (window honesty) · debt at creation (ORDER_SALE rows dated at
order date, incl. late pricing) · TRANSPORT_DIRECT double effect («shofyorga to'langan»)
· pallets in-kind appendix «pulga kirmaydi» · epsilon settle («hisob yopiq») ·
reconciled=false honesty marks · cost confidentiality (factory variant A/B-only).

---

## 5. Print CSS strategy (binding for implementation)

Lives inside `design.css`'s `@media print` section (02 §11.1 allots it) plus per-route
`<style>` injection for the `@page` size — only one document renders at a time, so each
print route injects exactly one `@page` rule:

| Route | `@page` |
|---|---|
| waybill | `A4 portrait; margin: 10mm` (sheet internally splits into two A5-landscape halves with a dashed cut line) |
| invoice, statement | `A4 portrait; margin: 14mm` |
| receipt a5 | `A4 portrait; margin: 10mm` (2-up A5) |
| receipt 80mm | `size: 80mm auto; margin: 4mm` |

Rules (04 §4.7 + 02 §11.1):

- `.sheet` is the only printable subtree; `PrintLayout` marks toolbar/backdrop `no-print`.
  The existing global `no-print` utility survives for the rest of the app (a raw Ctrl+P on
  a normal page still degrades gracefully) — but all four documents get dedicated routes.
- Black-on-white: sheet ink `#111` fixed; semantic colors degrade to **weight + bracketed
  words**; hairlines `0.5pt solid #999`.
- `font-feature-settings: 'tnum' 1, 'lnum' 1` on all numeric cells (`.num` global).
- `thead { display: table-header-group }`; `tr, .sig-block, .frame-row { break-inside:
  avoid }`.
- Page numbers `N / M`: `@page` margin boxes with `counter(page)` / `counter(pages)`
  (supported in Chromium ≥131). Degradation on older engines: the footer prints without
  the counter — never a wrong number.
- Fonts: self-hosted Inter var (already CSP-safe); print inherits it — no print-only font.
- `prefers-reduced-motion` and theming are irrelevant inside the sheet (static white
  paper); the preview backdrop obeys both themes normally.

---

## 6. Cross-link + shortcut summary (system-level)

| From | Gesture | To |
|---|---|---|
| OrderDetail | `P` → «Chop etish ▾» split-button | Yuk xati (disabled < LOADING, reason as caption) · Hisob-faktura |
| LOADING transition toast | link | Yuk xati |
| PaymentComposer success | «Kvitansiya chop etish» | Kvitansiya |
| Payment peek header | ⎙ | Kvitansiya |
| CASHIER terminal feed / Kassa journal | row «Kvitansiya» | Kvitansiya |
| ClientDetail header / Debts row / clients kebab | «Akt sverki» (`P`) | Akt sverki client (passes current `?from&to`) |
| FactoryDetail overflow | «Akt sverki» | Akt sverki factory |
| Orders BulkBar | «Hisob-faktura chop etish» | invoice `?ids=` batch |
| Palette | «Chop etish» (record-scoped) | contextual menu |
| Every guard explainer | one link | back to its source record |

Round-trip: every document footer names its record №; every entry point is ≤1 gesture from
the record; «Orqaga»/`Esc` restores the exact prior view (URL-synced state upstream).

## 7. Deliberately not designed (backend-first backlog — acknowledged, never faked)

- No PDF generation server-side; browsers' Print→PDF is the export path (stated in no UI —
  it is simply how printing works).
- No file attachment of printed docs to records (Document/attachments gap).
- No fiscal-receipt fields (QR, fiscal module IDs) — «ichki hujjat» label instead.
- No «mark reconciled» from print surfaces (endpoint doesn't exist — marks are read-only).
- No factory-side waybill or purchase order — out of scope, no data model.
