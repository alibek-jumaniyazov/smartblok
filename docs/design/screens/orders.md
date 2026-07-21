# SmartBlok — Screen Spec: Orders (v1)

**Scope:** `/orders` (register) · `/orders/new` (composer) · `/orders/:id` (workbench) ·
`/orders/:id/edit` (composer re-used) · order print entry points (Yuk xati, Hisob-faktura).
**Binding parents:** `02-design-language.md` (tokens, platform state law §9, money rules),
`03-shell-and-ia.md` (routes §4, URL contract §7, keys §8, worklists §6),
`04-components.md` (all component anatomies), `05-hero-workflows.md` (§1 create, §B rescue
paths, §6 print). This document only *instantiates* those laws for the order screens — it
introduces no new component, color, or term.

**API surface used (verified against `apps/api/src/orders/*`):**

| Call | Notes |
|---|---|
| `GET /orders` | params: `page, pageSize(≤200), search(orderNo/client), status, clientId, factoryId, dateFrom, dateTo`. **No `vehicleId`, no `sort`, no server aggregates** → vehicle filter hidden, sort headers disabled-with-tooltip, totals row is «sahifa jami» (see §1.6). Row payload: full Order scalars (saleTotal, costTotal, costStatus, status, transportMode/Cost/Charge/PaidStatus, dueDate, cancelReason, vehicleId) + client/agent/factory/vehicle name refs + `_count.items`. **No item-level data (pricePending, pallets, m³) in list rows.** |
| `GET /orders/:id` | full document: items(+product), statusHistory(+by), comments(+by), allocations(+payment incl. voidedAt), ledgerEntries, palletTransactions, client/agent/factory/vehicle, createdBy. |
| `GET /orders/:id/timeline` | merged status/payment/comment events. |
| `GET /orders/:id/comments`, `POST /orders/:id/comments` | comment thread. |
| `POST /orders` | create (CreateOrderDto). |
| `PUT /orders/:id` | A/B only; NEW/CONFIRMED + costStatus=PROVISIONAL only; **full item replace**; `clientId` and `intendedPaymentMethod` immutable; `vehicleId` may be set/cleared; reverse+repost + credit re-check server-side. |
| `PATCH /orders/:id/status` | `{to, note?}`; AGENT +1 only; A/B skip forward / exactly one back; vehicle required ≥LOADING; CANCELLED refused here. |
| `PATCH /orders/:id/items/:itemId/price` | A/B; `{salePricePerM3}` xor `{saleLumpSum}`; only pricePending items; posts ORDER_SALE at the order's business date. |
| `DELETE /orders/:id` | A/B soft-cancel `{reason}` from any non-cancelled status incl. COMPLETED. |
| `GET /clients?search=` / `GET /clients/:id` | PartySelect; detail carries `balance, palletBalance, creditLimit, paymentTermDays, prices[]` (ClientPrice + product) — the composer's client-resolved price source. |
| `GET /products?factoryId&pageSize` | catalog; `prices` record per PriceKind. **A/B payload:** DEALER_SALE + FACTORY_CASH + FACTORY_BANK. **AGENT payload:** DEALER_SALE ONLY — factory cost prices are stripped server-side (products.service.ts), so the AGENT floor can never be rendered, only enforced at submit. |
| `GET /vehicles` | active fleet; `capacityPallets, driver, plate, balance`. |
| `GET /agents/me` | AGENT limit card (outstanding vs debtLimit) for the composer rail. |
| `GET /debts/clients` | server-computed `hasOverdueOrders` + overdue sums — rail overdue chip source. |

---

## 1. `/orders` — Buyurtmalar (register)

### 1.1 Purpose

The operational register of every truckload: find any order in seconds, see at a glance
which orders are blocked (moshinasiz, narxlanmagan, transport aniqlanmagan, tannarx ochiq),
act on a row without leaving the list (status advance, print, cancel, payment), and drill
from every cockpit worklist chip into the exact same filtered view. URL is the single
source of filter truth — every view is shareable and back-button-safe.

### 1.2 Layout

```
┌ PageHeader (sticky-condense on scroll) ──────────────────────────────────────┐
│ Buyurtmalar                                    [Yangi buyurtma  N] [⋯ kebab] │
│ ┌ status strip (Segmented) ────────────────────────────────────────────────┐ │
│ │ Barchasi · Yangi · Tasdiqlangan · Yuklanmoqda · Yetkazilmoqda ·          │ │
│ │ Yetkazildi · Yakunlandi · Bekor qilingan                                 │ │
│ └──────────────────────────────────────────────────────────────────────────┘ │
├ FilterBar ────────────────────────────────────────────────────────────────────┤
│ [⌕ Raqam yoki mijoz… /] [Mijoz ▾] [Zavod ▾] [Sana: Shu oy ▾] [+ Filtr F]     │
│ [Tozalash]                          [Ko'rinishlar V ▾]  214 ta · sahifa jami │
│ chips:  Narxlanmagan* 1 · Moshinasiz 1 · Aniqlanmagan 3 · Tannarx ochiq* 14  │
├ DataTable ───────────────────────────────────────────────────┬ PeekPanel ────┤
│ Buyurtma│Sana │Mijoz │Agent│Zavod│Moshina│Muddat│Savdo (so'm)│ │ ORD-000214 ↗ │
│ ▸ ORD-000214 [Moshinasiz]  …                    …    24 300 000│ condensed    │
│   ORD-000213 [Narxlanmagan]…                    …    18 100 000│ StatusFlow,  │
│   ~~ORD-000208~~ (ghost, Bekor qilingan · sabab chip)          │ items mini,  │
│ ── Sahifa jami ────────────────────────────Σ 412 706 000 ──── │ Moliya,      │
│ pagination: server, 20/sahifa                                  │ amallar      │
├ BulkBar (X bilan tanlanganda, e2 floating) ──────────────────────────────────┤
│ 3 ta tanlandi · Σ 66 400 000   [Holatni oshirish] [Hisob-faktura (3)] [CSV] │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 1.3 Component instances & data

| Instance | Component (04) | Data source |
|---|---|---|
| Page header | `PageHeader` | title «Buyurtmalar»; primary action «Yangi buyurtma»; kebab: «CSV (sahifa)» (client-side, honestly labeled), `DensityToggle` (36/44px, `sb_density:<userId>:/orders`). |
| Status strip | Segmented (part of FilterBar schema) | writes `?status=`; labels/inks from shared `STATUS` map (`lib/status-maps.ts`). Counts are NOT shown per tab (no server aggregate — never fake counts). |
| Filter row | `FilterBar` | search → `GET /orders?search=` (debounced 300ms, `/` focuses); Mijoz → `PartySelect` (server-searched `GET /clients?search=`, options carry `BalanceTag`) → `?clientId=`; Zavod → select over `GET /factories` → `?factoryId=`; Sana → `DateRangeControl` presets → `?from&to` (mapped to API `dateFrom/dateTo`). **No Moshina filter** — `GET /orders` has no `vehicleId` param (03 §10e): the control does not render. **No sort headers active** — API has fixed `date desc`; every header sort affordance renders disabled with tooltip «server tartiblashni qo'llab-quvvatlamaydi». |
| Queue chips | FilterBar chip row (03 §6 recipes) | `?chip=` values below (§1.5). Starred chips are client-derived and show their window label + selector on the bar («oxirgi 30 kun ichida skanerlangan»). |
| Saved views | `SavedViews` | built-ins: «Barchasi» (`?`), «Yo'lda» (`?chip=inflight`), «Narxlanmagan*» (`?chip=unpriced`), «Bugungi trucklar» (`?from=today&to=today`); user views in `sb_views:<userId>:/orders`. `V` cycles. |
| Table | `DataTable` | `GET /orders` with URL params; `keepPreviousData`; realtime: `order` entity events invalidate (2s coalesced), changed visible rows pulse once. |
| Peek | `PeekPanel` 420px | `GET /orders/:id` on open; URL `?peek=<id>`; `↑/↓` moves peek through rows. |
| Bulk bar | `BulkBar` | selection client-side; verbs: «Holatni oshirish» (sequential `PATCH /orders/:id/status` +1 each, per-row result summary; illegal rows disabled with counted reason «3/5 tasida moshina yo'q»), «Hisob-faktura (N)» (batch print route queue), «CSV». **Never bulk cancel** (04 §1.8 restraint). A/B only. |
| Totals row | `TotalsRow` | «Sahifa jami» — Σ `saleTotal` of the current page rows only (no server aggregate exists). Count «214 ta» from `total`. **Deviation from 03 §4 note:** Σ m³ / Σ paddon are NOT in the list payload (items are not embedded) — they do not render. Verify item: if the API later embeds per-order pallet/m³ sums, add them; never compute them from `_count.items`. |

**Columns** (13px, 36px rows, right-aligned numerics, unit in header once):

| Column | Field | Rendering |
|---|---|---|
| Buyurtma | `orderNo` | identity link (middle-click safe) + blocker badges: «Moshinasiz» amber chip (`status=CONFIRMED && !vehicleId` — derivable from row), «Narxlanmagan» gold chip (from the §1.5 unpriced-scan cache when the row is inside the scanned window — never guessed). |
| Sana | `date` | `DD.MM.YYYY`, fixed width. |
| Mijoz | `client.name` | link → `/clients/:id`. |
| Agent | `agent.name` | text (snapshot). |
| Zavod | `factory.name` | link → `/factories/:id` (A/B). |
| Moshina | `vehicle.plate ?? vehicle.name` | link → `/vehicles/:id` (A/B); em-dash when none. |
| Muddat | `dueDate` | date; when `dueDate < today` and status ∉ {COMPLETED, CANCELLED}: date in `moneyOwedToUs` ink + word «o'tgan» (color never alone). Em-dash when null. |
| Savdo (so'm) | `saleTotal` | `MoneyCell` neutral — the **only** colored-capable column stays neutral here; this page's question is operational, not collections. |
| Tannarx | `costStatus` | `StatusChip` dot: Taxminiy / Qisman / Qotirilgan. |
| Holat | `status` | `StatusChip` dot from shared map. |
| Transport | `transportPaidStatus` | `StatusChip`: To'lanmagan / To'langan / Mijoz to'lagan / violet filled «Aniqlanmagan ?» / em-dash for NOT_APPLICABLE. |
| ⋯ | — | trailing kebab, labeled «ORD-000214 amallari». |

**Ghost rows:** `status=CANCELLED` rows render per 02 §6 — 60% opacity, strikethrough on
Savdo only, inline chip «Bekor qilingan» with reason in tooltip + full reason in peek.
Visible only when `?status=cancelled` or via the tri-state on the FilterBar
(«Bekorlar: yashirish / ko'rsatish / faqat» — implemented as status filter sugar since
CANCELLED is a status here, not a voided flag; default «yashirish» hides them from
«Barchasi» — deviation from today, where Barchasi mixed them in silently).

### 1.4 Row actions (kebab — labeled items, no icon-only)

| Verb | Roles | Behavior |
|---|---|---|
| Ko'rish | A B G | navigate `/orders/:id` (same as Enter/row click). |
| *next-step verb* («Tasdiqlash» / «Yuklashni boshlash» / …) | A B; G only the +1 verb on own rows | `PATCH /orders/:id/status {to}`; label from `NEXT_ACTION` map; hidden on COMPLETED/CANCELLED. Errors verbatim as toast fallback (e.g. «Moshina biriktirilmagan»). |
| Moshina biriktirish | A B; only when the Moshinasiz badge shows | inline popover `PartySelect` (vehicles: name · plate · sig'imi · shofyor) + `CapacityMeter` re-check → minimal `PUT /orders/:id` resending current items (fetched on popover open via `GET /orders/:id`) + `vehicleId` (05 §B1). |
| To'lov qabul qilish | A B K; G own | `T` — `PaymentComposer` CLIENT_IN pre-bound to the row's client. |
| Chop etish ▸ Yuk xati / Hisob-faktura | A B G(own) | `/print/waybill/:id`, `/print/invoice/:id`. |
| Bekor qilish | A B | `ReasonModal` + `LedgerImpactPreview` (§3.8 spec) — needs `GET /orders/:id` fetched on modal open to enumerate impact. |

### 1.5 Filters & URL params (the 03 §7 contract, instantiated)

`/orders?status&search&clientId&factoryId&from&to&chip&view&page&pageSize&peek`

- enums lowercase in URL (`status=confirmed` → `CONFIRMED`); every change resets `page=1`
  except `page/pageSize/peek`; unknown params render as red clearable tokens.
- `chip=` recipes (all drill targets of the cockpit worklists — 03 §6):

| chip | Recipe | Honesty label |
|---|---|---|
| `novehicle` | server `status=CONFIRMED`, then client filter `vehicleId=null` over fetched pages | none needed (server-filtered base; the null-vehicle test is per-row payload fact) |
| `transport-unknown` | client filter `transportPaidStatus=UNKNOWN` over a windowed scan (default `from`=joriy oy boshi; window selector shown on the bar) | «joriy oy — skanerlangan oynani kengaytiring» |
| `unpriced` * | windowed scan: pages of `GET /orders` for the window (non-cancelled), then per-order `GET /orders/:id` lazily (bounded, ≤200 orders) testing `items.some(pricePending)`; per-row cell spinner while resolving (03 §10c posture) | «oxirgi 30 kun · N ta buyurtma tekshirildi» |
| `cost-open` * | server `status=COMPLETED`, client filter `costStatus ≠ FINAL && completedAt < now−7d` | window label = the fetched pages |
| `inflight` | 3 parallel queries `status=CONFIRMED/LOADING/DELIVERING`, merged client-side; pagination disabled, sorted by date desc client-side with the merge labeled | «3 holat birlashtirildi» |
| `overdue` | server pages + client filter `dueDate < today && status ∉ {COMPLETED,CANCELLED}` | window label |

At 10× volume these become backend filter params — noted, never designed around (03 §6).

### 1.6 Keyboard

`/` search · `N` new order · `F` filter adder · `V` views · `J/K`/`↑↓` cursor ·
`Enter` open · `Space` peek (then `↑↓` moves peek) · `X` select (BulkBar) · `.` kebab ·
`T` payment composer for the row's client · `→` no-op (rows don't expand here) ·
`Esc` closes peek. Global `G O` arrives here.

### 1.7 States

Per 02 §9 exactly: 8 skeleton rows on first load (header intact); refetch = 2px hairline
under PageHeader, rows stay; empty unfiltered = `EmptyState` «Hali buyurtma yo'q — Yangi
buyurtma»; filtered-empty = «Filtrga mos yozuv topilmadi» + «Filtrlarni tozalash»; error =
`ErrorState` in the table region only (chrome survives), server text verbatim + «Qayta
urinish». Realtime pulse on changed visible rows. Peek deep-link (`?peek=`) opens list +
panel together.

### 1.8 Roles

- **A/B:** everything above.
- **AGENT:** server-scoped to own rows automatically; sees the same register minus: BulkBar
  status advance is hidden (bulk PATCH would offer skips), Bekor qilish absent, Moshina
  biriktirish absent (edit is A/B), chips limited to `unpriced`(read-only badge)/`inflight`/
  `overdue`; kebab = Ko'rish · +1 verb · To'lov qabul qilish · Chop etish. Zavod/Moshina
  cells render as text, not links (target pages are A/B).
- **CASHIER:** no route (403 screen with «Bosh sahifaga qaytish»).

### 1.9 Responsive

Per 03 §11: 1200–1599 fold Agent/Zavod into row expand; 1024–1199 column preset forced
(Buyurtma·Sana·Mijoz·Savdo·Holat), peek overlays; 768–1023 two-line rows (orderNo+status /
mijoz+savdo+muddat); <768 (AGENT) card list: line 1 `ORD-000214 · Holat chip`, line 2
mijoz, line 3 `24 300 000 so'm` (full value — `fmtShort` only as chart/secondary), chips
beneath (Muddat o'tgan / Narxlanmagan / Moshinasiz); filter chip scroller + «Filtrlar (3)»
sheet; whole card taps to detail; FAB dies — creation lives on the ➕ tab.

### 1.10 Removed vs today, and why

| Removed | Why |
|---|---|
| Tabs strip (8 AntD Tabs) as filter | replaced by Segmented strip writing `?status=` — tabs implied navigation, and state was lost on refresh (filter amnesia). |
| Local `useState` filters | `useUrlFilters` only — shareable, back-safe (03 §7). |
| Client select preloading 200 rows | `PartySelect` server-searched — silent 200-cap dies (04 §2.11). |
| «Jami: N ta» pagination text as the only aggregate | FilterBar result meta + pinned «sahifa jami» totals row. |
| Cancelled rows mixed into «Barchasi» | ghost-row treatment + default-hidden tri-state — history preserved, noise removed. |
| Zero row actions | kebab + BulkBar + `T` — the register acts, not just lists. |

---

## 2. `/orders/new` — Yangi buyurtma (composer)

### 2.1 Purpose

Create one truckload order in under 60 seconds, keyboard-only, with every locked rule
surfaced *before* submit: single factory, capacity, client credit limit, agent debt limit,
AGENT price floor, transport-mode economics, in-kind pallets, and the exact ledger postings
the order will create. The same page, pre-filled, is the edit surface (§4).

### 2.2 Layout

Full page (no drawer — a complex document per the interaction grammar). Left column = form
in 4 visual stages (whitespace + overline labels, no nested cards); right = sticky 320px
`LedgerPreview` rail. Content max 1440px.

```
┌ PageHeader: Buyurtmalar / Yangi buyurtma            [Bekor qilish] [Saqlash Ctrl+⏎] ┐
├──────────────────────────────────────────────┬──────────────────────────────────────┤
│ 1 · MIJOZ                                    │ LedgerPreview (sticky)               │
│ [Mijoz: Жамол Ургенч ▾ Qarz 4 200 000]       │ ┌ Mijoz krediti ────────────────┐    │
│ [Sana: 11.07.2026]  [Zavodga to'lov turi:    │ │ BalanceTag «Qarz 4 200 000»   │    │
│   (O'tkazma (bank) | Naqd)]                  │ │ CreditGauge  Limit 20 mln ·   │    │
│   taxminiy tannarx shu narxda hisoblanadi    │ │  Band 14,2 · Bo'sh 5,8        │    │
│                                              │ │ ⬛ 12 dona · 2 ta muddati      │    │
│ 2 · MAHSULOTLAR      [Zavod: CAOLS KS ✕]     │ │  o'tgan · 6,2 mln             │    │
│ ┌ item grid ─────────────────────────────┐   │ │ Agent limiti: Bo'sh 3,1 mln   │    │
│ │Mahsulot│Paddon│m³ (avto)│Rejim│Narx│Σ  │   │ └───────────────────────────────┘    │
│ │ D500 60│  19  │ 32,832  │Kat.│625 000│…│   │ CapacityMeter  17/19 paddon ▓▓▓░     │
│ └────────────────────────────────────────┘   │ Σ hajm 32,832 m³                     │
│ [+ Mahsulot qo'shish  Alt+⏎]                 │ Taxminiy savdo 24 300 000            │
│                                              │ shundan shofyorga −2 000 000         │
│ 3 · TRANSPORT                                │ ┌ Buxgalteriya (taxminiy) ──────┐    │
│ [Moshina ▾]  [Shofyor: ___]                  │ │ Mijoz hisobiga qarz:          │    │
│ (Mijozning o'z transporti | Shofyorga        │ │  +24 300 000 (savdo)          │    │
│  diller to'laydi | Shofyorga mijoz to'laydi) │ │  −2 000 000 (shofyorga, ichdan)│   │
│ [Xarajat (summa ichidan): 2 000 000]         │ │  = 22 300 000 dillerga        │    │
│                                              │ │ Zavod hisobimizdan:           │    │
│                                              │ │  −21 870 000 (O'TKAZMA narxda)│    │
│ 4 · YAKUN                                    │ │ Shofyorga qarzimiz: −2 000 000│    │
│ [Izoh …]                                     │ │ Paddon: mijozga 19 dona       │    │
│                                              │ └───────────────────────────────┘    │
│                                              │ Saqlashdan keyin: Qarz 28 800 000    │
│                                              │ CreditGauge (qayta chizilgan)        │
└──────────────────────────────────────────────┴──────────────────────────────────────┘
```

### 2.3 Stage 1 — Mijoz

| Element | Component | Data / behavior |
|---|---|---|
| Mijoz | `PartySelect` | `GET /clients?search=`; option rows: name + agent/region meta + `BalanceTag`. Pre-filled and locked-open focus from `?clientId=` (palette record-scoped action, ClientDetail header, Debts row). On pick: fetch `GET /clients/:id` (balance, palletBalance, creditLimit, paymentTermDays, `prices[]`) and `GET /debts/clients?search=<name>` for the overdue chip — the rail comes alive. Inline «Yangi qo'shish» where role allows. |
| Sana | DatePicker | default today, `DD.MM.YYYY`, Tashkent-day. Helper: «To'lov muddati: sana + N kun (mijoz sharti)» when `paymentTermDays` set — the dueDate consequence shown at entry. |
| Zavodga to'lov turi | Segmented «O'tkazma (bank) \| Naqd» | maps BANK/CASH → `intendedPaymentMethod`; caption «taxminiy tannarx shu narxda hisoblanadi» (locked rule: sets provisional price kind; **immutable after creation** — stated in helper). Default O'tkazma. |

### 2.4 Stage 2 — Mahsulotlar (keyboard grid, not nested cards)

Columns: `Mahsulot · Paddon · m³ · Narx rejimi · Narx · Summa · ✕`.

- **Mahsulot:** select over `GET /products?pageSize=200` (server-searchable; footer «yana N
  ta — qidiruvni aniqlashtiring» if capped). First pick **locks the catalog to that
  factory**: header chip «Zavod: CAOLS KS ✕» with explicit «Zavodni almashtirish» escape
  that clears all items after confirm — the single-factory rule is built into the control
  (the old post-hoc error Alert dies).
- **Paddon:** integer input. Typing `19` autofills m³ = `19 × m3PerPallet` (badge «avto»);
  the moment the user edits m³ the badge flips to «qo'lda» and autofill never overwrites
  again (fixes today's silent overwrite). Validation: paddon > 0 OR m³ > 0 per row, inline.
- **m³:** 3dp, `fmtM3`.
- **Narx rejimi:** segmented `Katalog / Kelishilgan / Umumiy summa / Narxlanmagan*`
  (*A/B only — absent for AGENT, per DTO+role reality).
  - *Katalog:* resolved price shown = ClientPrice override effective at the order date if
    present (labeled «maxsus narx»), else DEALER_SALE book price; always captioned
    «taxminiy — server tasdiqlaydi». Source: `GET /clients/:id → prices[]` +
    `GET /products → prices.DEALER_SALE`. (Fixes today's special-price blindness.)
  - *Kelishilgan:* `MoneyInput` per-m³ (6dp allowed). **AGENT floor is enforced at submit
    only, never disclosed** (locked rule: agents must never see factory cost; the API strips
    FACTORY_CASH/FACTORY_BANK from an agent's `/products` payload — the floor value IS the
    confidential cost, so no proactive number is shown). The agent types a price; if it is
    below the server floor, the POST is rejected and the server's Uzbek error renders verbatim
    under the field («Narx zavod narxidan past bo'lishi mumkin emas»); nothing entered is lost
    and re-typing re-validates. No client-side clamp for AGENT (there is no floor number to
    clamp against). A/B, whose payload DOES carry FACTORY_BANK, get an amber advisory hint
    «past narx — zavod bank narxidan quyi» and may proceed.
  - *Umumiy summa:* `MoneyInput` lump; stored exactly; back-solved per-m³ renders in small
    text beside («729 928,1 so'm/m³») — lump-sum entry is first-class, not a workaround.
  - *Narxlanmagan:* row Summa renders «—» + gold chip «Narxlanmagan»; rail totals carry
    «≈» and the note «narxlanmagan pozitsiyalar summaga kirmagan».
- **Summa:** per-row estimate, `MoneyCell` neutral, «taxminiy».
- Row keys: `Alt+Enter` add row, `Ctrl+Backspace` delete row; delete disabled at 1 row.

### 2.5 Stage 3 — Transport (3 live modes — see the [authoritative transport model](../00-business-map.md#transport-authoritative))

> **Transport haqi HAR DOIM `saleTotal` ICHIDA.** Hech qachon summa ustiga qo'shilmaydi.
> Rejimlar, formula (`clientChargeable`), ledger yozuvlari va DEALER_CHARGED'ning bekor
> qilinishi faqat bitta joyda ta'riflangan:
> [00-business-map.md § TRANSPORT MODEL — AUTHORITATIVE](../00-business-map.md#transport-authoritative).
> Bu yerda arifmetika takrorlanmaydi — aynan takrorlangan formulalar 2026-07-20 da
> haqiqatdan ajralib qolgan edi.

| Element | Behavior |
|---|---|
| Moshina | `PartySelect` over `GET /vehicles` (active): rows `name · plate · «19 pd» · shofyor`; A/B rows also show `BalanceTag` («Qarzimiz» amber) — AGENT variant hides financials (role rule). Picking re-bases the `CapacityMeter` and fills Shofyor **only if untouched** (suggestion, not overwrite). Clearable — «keyin biriktiriladi» hint appears with the consequence: «Yuklash bosqichi moshinasiz bloklanadi». |
| Shofyor | text input (snapshot; canonical term Shofyor — Haydovchi dies). |
| Rejim | segmented, 3 live modes: `Mijozning o'z transporti / Shofyorga diller to'laydi (default) / Shofyorga mijoz to'laydi`. **`Mijozdan olinadi` (DEALER_CHARGED) is DEPRECATED and must not be offered** — the server rejects it on write; it renders read-only («Summa ustiga qo'shilgan (eski)») on historical orders. CLIENT_OWN zeroes the cost; `transportCharge` is zero in every live mode. |
| Xarajat (shofyorga, so'm) | `MoneyInput`, modes ≠ CLIENT_OWN. Caption: «summa ICHIDAN — ustiga qo'shilmaydi». |
| Split line (CLIENT_PAYS_DRIVER only) | display-only, no input: «Savdo summasi 22 000 000 · shundan shofyorga 2 000 000 · **dillerga 20 000 000**» — the last figure is `clientChargeable` and is the number the credit gauge, the ledger preview and Moliya must all repeat. |
| **Vehicle-less cost guard** | transportCost > 0 with no vehicle → blocking inline warning «Moshina tanlanmagan — shofyor qarzi hisobga olinmaydi» + explicit checkbox «Baribir davom etaman» required to submit (closes the untracked-driver-debt hole at the UI; server stores the cost without a VEHICLE posting). |

### 2.6 Stage 4 — Yakun

Note textarea (2000). The rail's bottom card is the **ledger preview** (04 §3.5): postings
in statement language + projected post-save balance + re-drawn `CreditGauge`. Submit =
`Ctrl+Enter` / «Saqlash».

### 2.7 The rail (`LedgerPreview`) — data map

| Rail block | Source |
|---|---|
| BalanceTag / CreditGauge | `GET /clients/:id` → `balance`, `creditLimit` (refetched on open; advisory — server authoritative). |
| PalletChip «12 dona» | `GET /clients/:id → palletBalance`. |
| Overdue chip «2 ta · 6,2 mln» | `GET /debts/clients` row (server-computed), lazy; hidden if fetch fails (never blocks composing). |
| Agent limiti headroom | `GET /agents/me` (AGENT); for A/B composing on behalf: the selected client's agent headroom is not fetchable per-agent without `/agents/:id` — A/B see the client gauge only; the server gate remains and rejects verbatim. |
| CapacityMeter | Σ paddon vs `vehicle.capacityPallets ?? 19` (default from settings for A/B via `GET /settings`; AGENT cannot read settings → constant 19 labeled «standart sig'im»). ≥90% amber; exceeded → red + **submit blocked** with exact overflow «2 paddon ortiqcha — server rad etadi». |
| Taxminiy savdo / Σ m³ | client-side from the grid, labeled «taxminiy — server tasdiqlaydi». |
| Ledger preview lines | derived display-only, mirroring the real postings ([authoritative model](../00-business-map.md#transport-authoritative)): `+saleTotal (savdo)`; `−transportCost (shofyorga mijoz to'laydi — summa ichidan)` when CLIENT_PAYS_DRIVER; `−costTotal (taxminiy, O'TKAZMA/NAQD narxda)` factory side; `−transportCost (shofyorga qarzimiz)` only when DEALER_ABSORBED + vehicle + cost; «Paddon: mijozga N dona». The projected client balance uses the NET figure. |
| Limit breach | AGENT: submit disabled + figures; A/B: warning tone + explicit override click — server row-lock stays the judge (05 §D). |

### 2.8 Actions

- **Saqlash (Ctrl+Enter):** single `POST /orders`. Success: toast «ORD-000158 yaratildi»
  → navigate `/orders/:id` with StatusFlow next verb focused; draft cleared.
- **Bekor qilish / Esc:** dirty-check confirm («Kiritilgan ma'lumotlar saqlanmagan»).
- Server rejections (credit limit with limit/current/new figures, capacity, agent gate,
  AGENT floor, single-factory) render **verbatim** under the relevant stage; focus moves to
  the offending field; nothing entered is lost (02 §9 mutation-error law).
- Draft persists to sessionStorage keyed per route; restored after refresh; cleared on
  submit/cancel. Submit self-disables keeping its verb («Saqlanmoqda…»).

### 2.9 URL, keyboard, states

- `/orders/new?clientId=<id>` — pre-bound client (palette, ClientDetail, Debts row, agent ➕).
- Keys: `Tab/Shift+Tab` walk, `Alt+Enter` add row, `Ctrl+Backspace` delete row,
  `Ctrl+Enter` submit, `Esc` cancel (guarded). Full path: 05 §1 (~9 gestures).
- Loading: skeleton of the real 4-stage layout + rail placeholders (no layout shift).
  Catalog/vehicle/client load errors: inline `ErrorState` per control with retry
  (composing continues where possible). Empty catalog: «Mahsulot topilmadi — avval katalog
  kiriting» + link `/products` (A/B).

### 2.10 Roles & responsive

- **AGENT:** own clients only (server-scoped options); Narxlanmagan absent; floor enforced at
  submit only (no cost number shown — §2.4 Kelishilgan); limit breach blocks submit; vehicles
  without financials. **Mobile (<768):** 4-step wizard
  (Mijoz → Mahsulot → Transport → Tasdiqlash) per 05 §1.1 — one thought per screen, big ±
  steppers for paddon, `inputmode="numeric"` money, collapsed bottom-sheet summary bar
  «19/19 paddon · 23,9 mln · qarzga yoziladi» expanding to the full rail; step 4 IS the
  ledger preview (turn the phone to the client); sticky 48px submit above the tab bar;
  steps validate on advance; back preserves state.
- **A/B:** all modes; override on limit warning; desk-density form.
- **CASHIER:** no route.

### 2.11 Removed vs today, and why

| Removed | Why |
|---|---|
| Nested Card per item row | keyboard grid — density + Alt+Enter flow (05 §1.4). |
| Balance embedded in client option label («balans -1 200 000») | `BalanceTag` semantics — raw signed numbers banned (02 §1.1). |
| DEALER_SALE-only estimate | client-resolved ClientPrice estimate — the money preview finally matches the server. |
| Multi-factory error Alert after the fact | factory lock chip — invalid state unbuildable. |
| Silent m³ overwrite on pallet change | avto/qo'lda badge, overwrite only while untouched. |
| Passive capacity warning («server rad etadi») | CapacityMeter submit guard with exact overflow. |
| «Narxsiz» label | «Narxlanmagan» (canonical; «Narxsiz» survives only as short chip label per glossary). |
| Driver autofill unconditionally clobbering typed name | fill only when untouched. |

---

## 3. `/orders/:id` — order workbench

### 3.1 Purpose

One order, everything about it, one screen: where it stands (StatusFlow with blockers named
in place), what it costs and what it earned (Moliya with exposure-correct progress), how the
truck gets paid (Transport card with pay actions), what physically moved (items, paddonlar),
and everything that ever happened to it (unified ActivityTimeline). Every rescue path for a
stuck order starts here (05 §B).

### 3.2 Layout — two-column workbench

```
┌ PageHeader ──────────────────────────────────────────────────────────────────┐
│ Buyurtmalar / ORD-000214   [Tasdiqlangan]  11.07.2026 · Жамол Ургенч · CAOLS │
│                    [Tahrirlash E] [Chop etish ▾ P] [⋯: Bekor qilish]         │
├──────────────────────────────────────────────┬───────────────────────────────┤
│ LEFT — hujjat (document)                     │ RIGHT — pul reyka (sticky 320) │
│                                              │                               │
│ POZITSIYALAR                                 │ ┌ StatusFlow ───────────────┐ │
│ Mahsulot│O'lcham│m³│Paddon│Narx│Summa│       │ │ ●──●──○──○──○──○          │ │
│ D500 60 │600×300│32,832│19│625 000│20,8 mln │ │ │ Yangi Tasdiqlangan …      │ │
│ D400 60 │…      │ —  │ 4│  —  │ — [Narxlan- │ │ │ ⚠ Moshina biriktirilmagan │ │
│          magan] [Narxlash]                   │ │ │   [Biriktirish]           │ │
│ Izoh: «qo'shimcha izoh matni»                │ │ [Yuklashni boshlash ⏎] [⋯] │ │
│                                              │ └───────────────────────────┘ │
│ PADDONLAR  ⬛ mijozda 19 dona                 │ ┌ Moliya ───────────────────┐ │
│ Sana│Turi│Soni│Izoh                          │ │ Savdo        24 300 000   │ │
│ …                                            │ │ shundan shofyorga         │ │
│                                              │ │             −2 000 000    │ │
│ TO'LOVLAR (taqsimotlar)                      │ │ Jami qarz    22 300 000   │ │
│ Sana│Turi│Usul│Summa│→ to'lov                │ │ To'langan     4 100 000   │ │
│ …                                            │ │ ▓▓░░░░░░░░ 18%            │ │
│                                              │ │ Qoldiq       18 200 000   │ │
│                                              │ │ Tannarx [Taxminiy]        │ │
│ FAOLIYAT  (Hammasi·Izohlar·Moliya·Holat)     │ │  21 870 000               │ │
│ 11.07 14:02 [Tasdiqlangan] A.Alibek          │ │ Tovar foydasi  +2 430 000 │ │
│ 11.07 12:40 To'lov 4 100 000 (Naqd) →        │ │  taxminiy                 │ │
│ 10.07 18:11 Izoh: «…»                        │ └───────────────────────────┘ │
│ [Izoh yozing…            Ctrl+⏎ Yuborish]    │ ┌ Transport ────────────────┐ │
│                                              │ │ Rejim: Shofyorga mijoz    │ │
│                                              │ │        to'laydi           │ │
│                                              │ │ Xarajat 2 000 000         │ │
│                                              │ │  (summa ichidan)          │ │
│                                              │ │ [To'lanmagan]             │ │
│                                              │ │ [Shofyorga to'lash]       │ │
│                                              │ │ [Mijoz to'lagan deb…]     │ │
│                                              │ └───────────────────────────┘ │
└──────────────────────────────────────────────┴───────────────────────────────┘
```

`?tab=` deep-links the left sections by scrolling + highlight:
`?tab=pozitsiyalar|paddonlar|tolovlar|faoliyat`. On 1024–1199 the rail becomes a top
summary strip; <1024 single column in rail-first order (status → money → document → feed).

### 3.3 Header (`PageHeader`)

- Breadcrumb «Buyurtmalar / ORD-000214»; title = orderNo (20px — the money in the rail is
  the largest text); `StatusChip` 12%-tint filled; meta chips: date, client link, factory
  link, agent name. Sticky-condensed keeps orderNo + status + next-verb.
- **Tahrirlash** (`E`): visible A/B; enabled only while `status ∈ {NEW, CONFIRMED}` AND
  `costStatus = PROVISIONAL`; otherwise a lock chip with the server's own reason as tooltip
  — «Faqat NEW yoki CONFIRMED holatda» / «Narx allokatsiya bilan qotirilgan». → `/orders/:id/edit`.
- **Chop etish ▾** (`P`): «Yuk xati» → `/print/waybill/:id`; «Hisob-faktura» →
  `/print/invoice/:id`. Disabled with reason on CANCELLED («hujjat bekor qilingan»).
- Kebab: «Bekor qilish» (A/B, danger — §3.8); «CSV (pozitsiyalar)».

### 3.4 StatusFlow (rail top) — the status-flow UI

Component 04 §3.1 over `GET /orders/:id` (`status`, `statusHistory` for dates/actors) +
`PATCH /orders/:id/status`.

- 6 labeled nodes (shared STATUS map), dates + actor names beneath from `statusHistory`.
- **One legal next-step verb** for the role, `Enter` triggers: Tasdiqlash → Yuklashni
  boshlash → Yetkazishga jo'natish → Yetkazildi deb belgilash → Yakunlash. Advancing fills
  the segment 240ms; numbers never animate.
- **Blockers render on the step that needs them:** amber chip «Moshina biriktirilmagan» on
  Yuklash when `vehicleId=null` + inline **«Biriktirish»** (popover `PartySelect` vehicles
  with capacity + BalanceTag → `CapacityMeter` pre-check → minimal `PUT /orders/:id`
  resending current items + `vehicleId`). The old dead-end toast is extinct (05 §B1).
- Pre-completion hint on Yakunlash: «bonus hisoblanadi»; after COMPLETED the rail notes
  «Bonus hisoblandi» (amount visible on the factory page — not fetched here).
- **A/B overflow ⋯ on the rail:** «Oldinga o'tkazish…» (skip forward — submenu of legal
  targets, each still `PATCH {to}`), «Bir qadam orqaga» (`ReasonModal` variant: UI-mandatory
  note sent as `dto.note`; when leaving COMPLETED the impact preview warns «bonus bekor
  qilinadi»), «Bekor qilish». AGENT sees only the single +1 verb.
- CANCELLED: rail replaced by danger banner «Buyurtma bekor qilingan» + reason + link «storno
  yozuvlarini ko'rish» jumping to the netting reversal set in FAOLIYAT (ledgerEntries carry
  the reversal pairs).
- Transition errors render verbatim inline under the rail (e.g. «Faqat keyingi bosqichga
  o'tish mumkin»).
- Success advancing to **LOADING**: toast «Holat: Yuklanmoqda · Yuk xati chop etish →»
  (deep link to `/print/waybill/:id`) — the waybill offered exactly when the gate needs it.

### 3.5 Moliya card (rail) — exposure-correct money

Source: order payload fields + `allocations`.

| Line | Formula (display-only, `.num`) |
|---|---|
| Savdo summasi | `saleTotal` — transport already inside (with «≈» + «narxlanmagan pozitsiyalar kirmagan» note while any `items.pricePending`) |
| Shundan shofyorga | `transportCost`, only when CLIENT_PAYS_DRIVER — caption «mijoz shofyorga o'zi beradi» |
| **Jami qarzga yozilgan** | `clientChargeable(order)` = `saleTotal − clientDirectTransport(order)` — the NET exposure the ledger actually carries. For 22 000 000 with 2 000 000 transport under CLIENT_PAYS_DRIVER this reads **20 000 000**. Never `saleTotal + transportCharge` — that formula is dead ([authoritative model](../00-business-map.md#transport-authoritative)). |
| To'langan | Σ active CLIENT_IN allocations (`!voidedAt && !payment.voidedAt && kind=CLIENT_IN`) |
| progress hairline | To'langan / Jami; 100% = `moneyIn` ink + «To'liq qoplangan» |
| Qoldiq | Jami − To'langan, `MoneyCell owedToUs` when > 0 |
| Tannarx | `costTotal` + `StatusChip` Taxminiy/Qisman/Qotirilgan; caption for PARTIAL: covered progress from FACTORY_OUT allocations |
| Tovar foydasi | `saleTotal − costTotal`, signed `MoneyCell`, labeled «taxminiy» until costStatus=FINAL |

Every figure is a door: To'langan → `?tab=tolovlar`; Tannarx chip → the factory's
settlement hub `/factories/:id` (A/B); Qoldiq → «To'lov qabul qilish» quick action beneath
(PaymentComposer CLIENT_IN, client + amount=Qoldiq pre-bound, this order's allocation row
pre-checked in the inline SettleDrawer for A/B).

### 3.6 Transport card (rail) — 3 live modes + settlement

Source: `transportMode/Cost/PaidStatus`, `vehicle`, `driverName`.
Money semantics: [authoritative transport model](../00-business-map.md#transport-authoritative).

- Rejim label from shared map: Mijozning o'z transporti / Shofyorga diller to'laydi /
  Shofyorga mijoz to'laydi (+ read-only «Summa ustiga qo'shilgan (eski)» for historical
  DEALER_CHARGED rows). CLIENT_OWN renders one quiet line, no money, no chip
  (NOT_APPLICABLE = em-dash).
- **Xarajat (shofyorga)** with the caption «savdo summasi ICHIDAN». Under CLIENT_PAYS_DRIVER
  add the split line «Mijoz dillerga: 20 000 000 · shofyorga: 2 000 000» and the note
  «dillerning shofyorga qarzi yo'q». There is no «Mijozdan olinadigan» field and no
  «Transport foydasi» line any more — transport is pure cost.
- `StatusChip`: To'lanmagan / To'langan / Mijoz to'lagan / violet **«Aniqlanmagan ?»**
  (filled) with caption «import qilingan — haqiqiy to'lovni kiriting, holat o'zi qayta
  hisoblanadi» (derived status, never hand-set).
- Actions (A/B/K; hidden when NOT_APPLICABLE or cost=0) — **mode-scoped, they are not
  interchangeable**:
  - **DEALER_ABSORBED only — «Shofyorga to'lash»** → `PaymentComposer` VEHICLE_OUT: vehicle
    pre-bound, amount pre-filled with this order's transport qoldig'i, «Saqlash va
    taqsimlash» pre-checked (A/B) → SettleDrawer with this order's row pre-checked
    (`POST /payments/:id/allocations`).
  - **CLIENT_PAYS_DRIVER only — «Mijoz to'lagan deb yozish»** → composer TRANSPORT_DIRECT:
    client + vehicle + amount pre-bound, cashbox absent, at least one order allocation
    REQUIRED (the server rejects an unallocated one, and rejects any allocated order that is
    not CLIENT_PAYS_DRIVER). Fixed info line: «Bu yozuv kassaga ham, hisob-kitobga ham
    ta'sir qilmaydi — bu pul buyurtma ochilganda allaqachon qarzdan chiqarilgan. Faqat
    shofyor pulini olgani qayd etiladi.» It changes the transport chip to «Mijoz to'lagan»
    and nothing else ([authoritative model](../00-business-map.md#transport-authoritative)).
  - Vehicle line links to `/vehicles/:id` (A/B). CASHIER creates payments but sees
    allocations read-only («Taqsimlashni buxgalter bajaradi»).

### 3.7 Left column — document sections

**Pozitsiyalar** (embedded `DataTable`, no pagination): Mahsulot · O'lcham · Hajm (m³) ·
Paddon (dona) · Narx (so'm/m³, stored precision ≤6dp) · Summa (so'm). Lump-priced rows show
«kelishilgan summa» micro-note with the back-solved unit price small. Pending rows: Narx/Summa
= «—», gold chip «Narxlanmagan», and (A/B, non-cancelled) button **«Narxlash»**:

> **Late-pricing modal (05 §B3)** — controlled form, e3 modal: header «Narxlash —
> D400 60» + «Hajm: 8,4 m³»; radio «1 m³ narxi bo'yicha / Umumiy summa (kelishilgan)»;
> `MoneyInput`; live preview line «Summa: 8,4 × 730 000 = 6 132 000 so'm» (or back-solved
> per-m³ for lump), labeled «taxminiy — server tasdiqlaydi»; note **«qarz buyurtma sanasi
> bilan yoziladi»** (recognition happens late at the order's business date — locked rule);
> «Saqlash» → `PATCH /orders/:id/items/:itemId/price`. Success: chip flips, totals lose
> «≈», FAOLIYAT gains a Moliya event, register badge clears via socket.

Note block: order `note` as quiet body text (ArtifactText treatment if imported Cyrillic).

**Paddonlar:** `PalletChip` header «mijozda 19 dona (shu buyurtma bo'yicha)» with the
popover math (berildi − qaytdi − undirildi ± tuzatish); movements table from
`palletTransactions`: Sana · Turi (shared labels: Zavoddan qabul qilindi / Mijozga yuborildi /
Mijozdan qaytdi / Zavodga qaytarildi / Yo'qotilgan (hisobga o'tkazildi) / Tuzatish / Storno)
· Soni (dona) · Izoh. REVERSAL rows ghost-styled and chained to their originals.
Caption: «Paddon — qaytariladigan idish, pulga kirmaydi» (in-kind rule visible).

**To'lovlar (taqsimotlar):** from `allocations` (+payment). Two groups with overline labels
— «Mijoz to'lovlari» (CLIENT_IN) and «Transport to'lovlari» (VEHICLE_OUT / TRANSPORT_DIRECT);
FACTORY_OUT allocations appear as «Zavod to'lovlari (tannarx qoplash)» for A/B with the
covered progress. Columns: Sana · Turi · Usul · Summa (so'm) · link «→» opening
`/payments/:id` (register + peek — the canonical payment surface). Voided allocations render
as ghost rows («bekor qilingan»). Empty: «Taqsimot yo'q — To'lov qabul qilish».
TRANSPORT_DIRECT rows carry the double-effect words «mijoz → shofyor».

**FAOLIYAT — `ActivityTimeline`** (04 §4.4): sources merged client-side from
`GET /orders/:id/timeline` (status/payment/comment) + pricing events (audit not exposed —
pricing appears as its ORDER_SALE ledger entry from `ledgerEntries`, labeled via
`LEDGER_SOURCE`) + `palletTransactions`. Filter chips: Hammasi / Izohlar / Moliya / Holat.
Composer at bottom (`POST /orders/:id/comments`, Ctrl+Enter, optimistic pending row — the
app's only optimistic element). Day-grouped; relative stamps with absolute tooltip.
**The separate Izohlar tab dies** — one feed.

### 3.8 Cancel flow (soft, with reason)

`ReasonModal` (04 §2.6) from header kebab or StatusFlow overflow. A/B only; any
non-cancelled status.

- Danger title: «ORD-000214 bekor qilinadi — qaytarib bo'lmaydi».
- `LedgerImpactPreview` built from the already-loaded payload:
  «N ta ledger yozuvi storno bo'ladi (savdo, transport, tannarx)» ·
  «Paddon harakatlari qaytariladi (19 dona)» ·
  «M ta to'lov taqsimoti bekor qilinadi — **pul mijoz hisobida qoladi** (avtomatik qaytarilmaydi)» ·
  when `status=COMPLETED`: «Zavod bonusi bekor qilinadi» ·
  «Buyurtma balans hisob-kitobidan chiqadi».
- Required reason TextArea (≥3 chars, ≤2000, inline validation); confirm labeled
  «Bekor qilish», danger, never default-focused; submitting keeps verb («Bekor
  qilinmoqda…»). → `DELETE /orders/:id {reason}`.
- After: danger banner replaces the rail flow; ghost styling app-wide; toast
  «ORD-000214 bekor qilindi».

### 3.9 Keyboard, states, realtime

- `E` edit (when legal) · `P` print menu · `Enter` next-step verb · `Esc` closes
  popover/modal (dirty-guarded) · `Ctrl+Enter` sends comment.
- Loading: skeleton of the real layout (rail blocks + items rows) — 02 §9. Error: full-region
  `ErrorState`. Timeline/comments errors: inline per-section with retry, page survives.
- Realtime: `order`/`payment` events (2s coalesced) refetch; if a socket event touches this
  order while the late-pricing modal / composer is open → amber ribbon «Bu hujjat boshqa
  foydalanuvchi tomonidan o'zgartirildi — Yangilash» (never silent overwrite).

### 3.10 Roles

- **A/B:** everything.
- **AGENT (own rows only, server-enforced):** next verb = +1 only; no overflow menu, no
  Tahrirlash, no Bekor qilish, no Narxlash, no transport pay actions (sees the status chip
  and figures), no factory/vehicle links; comments allowed. Mobile: single column, StatusFlow
  as one big verb button, sticky bottom ActionBar (verb + Chop etish), feed collapsed.
- **CASHIER:** no route access (payments are their surface).

### 3.11 Removed vs today, and why

| Removed | Why |
|---|---|
| 6-card vertical stack | two-column workbench — money and status always on screen (pain: financials below the fold). |
| AntD `Steps` + lone forward button | StatusFlow with blockers-in-place, skip/one-back for A/B (API supported, UI unreachable before). |
| Progress vs raw `saleTotal` | exposure = `clientChargeable(order)`, so a CLIENT_PAYS_DRIVER order can actually reach 100% ([authoritative model](../00-business-map.md#transport-authoritative)). |
| «Izohlar» tab | merged into ActivityTimeline (duplicate surface). |
| `modal.confirm` cancel with closure-variable reason | ReasonModal, controlled + impact preview (anti-pattern dies). |
| `Ma'lumotlar` Descriptions card | header meta chips + rail cards absorb every field (agent, zavod, moshina, shofyor, muddat, yaratilgan/kim, izoh — nothing lost: muddat renders under Moliya as «To'lov muddati: 18.07.2026», createdAt/by in FAOLIYAT's first event). |
| Raw ledger enum strings in linked payment drawer | `/payments/:id` peek with `LEDGER_SOURCE` labels (payments spec). |
| Link `/payments?paymentId=` (dead deep link) | `/payments/:id` canonical peek route. |

---

## 4. `/orders/:id/edit` — Tahrirlash (composer re-used)

### 4.1 Purpose

The missing UI for `PUT /orders/:id`: fix quantities, prices, transport, vehicle, date or
note on a NEW/CONFIRMED order whose cost is still PROVISIONAL — without cancel + re-entry,
keeping the order number, history and settled transport. A/B only.

### 4.2 Layout & behavior

The §2 composer, pre-filled from `GET /orders/:id`, with these deltas:

- **Permanent banner (top, warning tone):** «Tahrirlash barcha moliyaviy yozuvlarni storno
  qilib qayta yozadi; kredit limiti qayta tekshiriladi. CONFIRMED holatdan keyin yoki
  tannarx qotirilgach tahrirlash yopiladi. To'langan transport holati saqlanadi.»
- **Mijoz:** rendered disabled (server keeps `clientId` — immutable). Caption «mijozni
  o'zgartirish uchun buyurtmani bekor qilib, yangisini yarating».
- **Zavodga to'lov turi:** rendered disabled («taxminiy narx turi yaratilganda qotirilgan»)
  — `intendedPaymentMethod` immutable per service.
- Sana editable (dueDate re-derives server-side — helper states it).
- Items grid pre-filled; **full replace semantics stated** on the add/delete affordances
  («barcha pozitsiyalar qayta yoziladi»). Priced-pending rows keep their mode.
- Vehicle settable/clearable (`vehicleId: null` allowed); CapacityMeter re-checks.
- Rail shows **delta framing**: «Hozirgi qarz yozuvi: 24 600 000 → Yangisi: 26 800 000
  (Δ +2 200 000)», re-drawn CreditGauge at the new exposure.
- **Confirm before submit** (e3 modal): `LedgerImpactPreview` — «Barcha buyurtma yozuvlari
  storno qilinadi va qayta yoziladi» · «Kredit limiti yangi summada qayta tekshiriladi» ·
  «Paddon harakatlari qayta yoziladi» · «To'langan transport holati saqlanadi (qayta
  hisoblanadi)». Confirm «Saqlash — ORD-000214» → `PUT /orders/:id`.
- Guard rails: if the order state changed while editing (socket) → amber ribbon + refetch
  offer; if the server now refuses (status advanced / cost finalized) the verbatim message
  renders at top («Faqat NEW yoki CONFIRMED holatdagi buyurtmani tahrirlash mumkin» /
  «Narx allokatsiya bilan qotirilgan») with a link back to the workbench.
- Success: toast «ORD-000214 yangilandi» → back to `/orders/:id`.

**Entry points:** workbench header «Tahrirlash» (`E`), Moshinasiz queue row kebab, owner
flow 05 §5.3. **URL:** no extra params. **Roles:** A/B only (route-guarded; AGENT never
sees the entry affordances). **Draft:** sessionStorage per route; dirty-close guarded.

---

## 5. Print entry points (frontend-only; full doc specs in 05 §6)

| Document | Route | Entry from order screens | Data | Guard |
|---|---|---|---|---|
| **Yuk xati** (waybill) | `/print/waybill/:orderId` | workbench «Chop etish ▾», register kebab, LOADING toast deep link | `GET /orders/:id`: orderNo, date, factory (yuklash), client + region + phone (`GET /clients/:id` if region/phone absent from order payload), vehicle plate 14pt, driverName snapshot, items (Mahsulot, o'lchami, paddon, m³), **Σ paddon huge**, Σ m³, pallet note «Paddonlar qaytariladigan idish — N dona mijoz zimmasiga o'tadi», signatures Yukladi/Shofyor/Qabul qildi | **no prices by default** (sale-price toggle in toolbar, default off); CANCELLED refuses with explainer. |
| **Hisob-faktura** (invoice) | `/print/invoice/:orderId` | workbench, register kebab, composer success toast | order items (m³ · narx stored precision · summa), lump rows «kelishilgan summa» + back-solved small, «Mahsulot jami» → **JAMI = `clientChargeable(order)`** + so'z bilan, with a «shundan shofyorga N so'm — mijoz shofyorga o'zi to'laydi» sub-line under CLIENT_PAYS_DRIVER (never a «Transport xizmati» line added ON TOP — [authoritative model](../00-business-map.md#transport-authoritative)); dueDate; Narxlanmagan rows «narx kelishilmoqda»* excluded from totals; footnote «Paddonlar (N dona) qaytariladi — narxga kirmaydi»; optional balance-after line (toggle; `GET /clients/:id → balance`) | CANCELLED refuses; dealer entity picked in toolbar (remembered). |

Both open as `PrintDocument` previews (04 §4.7) with sticky «Chop etish» toolbar; print CSS
strips chrome; states as bracketed words; tabular numerals; A5-landscape 2-up waybill, A4
invoice.

---

## 6. Business-rule visibility checklist (acceptance)

| Locked rule | Where it is visible |
|---|---|
| Debt at creation = `clientChargeable` (sale − direct-to-driver slice) | composer rail ledger preview + «Jami qarzga yozilgan» in Moliya; invoice JAMI. All three must show the SAME number (20 000 000 in the canonical 22M/2M example). |
| Late pricing posts at order business date | Narxlash modal note; FAOLIYAT event date. |
| Credit limit / agent gate under row lock | CreditGauge + agent headroom in rail; blocked/override submit; verbatim server figures on reject. |
| Cost provisional → PARTIAL → FINAL via factory allocation | Tannarx chip everywhere; Moliya caption; edit lock reason «Narx allokatsiya bilan qotirilgan». |
| intendedPaymentMethod immutable | disabled control + caption in edit. |
| One order = one truck = one factory | factory lock chip in composer. |
| Capacity ≤ vehicle/19 | CapacityMeter with submit guard, re-based on vehicle pick. |
| Pallets in-kind, never money | PalletChip adjacency, «pulga kirmaydi» captions, waybill/invoice footnotes. |
| Transport always inside saleTotal; 3 live modes; DEALER_CHARGED deprecated; status derived ([authoritative model](../00-business-map.md#transport-authoritative)) | Transport card; mode-scoped fields + split line; violet UNKNOWN with resolve hint; pay actions re-derive status. |
| Soft-cancel only, money stays with client | ReasonModal impact list; ghost rows; danger banner + storno links. |
| Status linear; AGENT +1; A/B skip/one-back+note; vehicle ≥ LOADING | StatusFlow verbs, overflow, blocker chip with inline fix. |
| Bonus accrues at COMPLETED / reverses on leave | pre-completion hint; step-back and cancel impact warnings. |
| AGENT scoping, floor (never disclosed), no Narxlanmagan | scoped selects; floor enforced at submit via verbatim server error (no cost number shown); mode absent. |
| Server is the only calculator | every client-side figure labeled «taxminiy — server tasdiqlaydi». |
