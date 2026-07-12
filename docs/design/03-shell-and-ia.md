# SmartBlok — App Shell & Information Architecture (v1, FINAL)

**Status:** binding specification. Base: Ledger Clarity IA + Role Cockpit's worklist engine
and `/references` consolidation + Command Density's URL/peek/saved-view mechanics +
Progressive Calm's honesty and cross-link contracts. Design tokens: `02-design-language.md`.
Components referenced here are specified in `04-components.md`.

Roles legend used throughout: **A** = ADMIN (Administrator), **B** = ACCOUNTANT (Buxgalter),
**G** = AGENT (server-scoped to own rows), **K** = CASHIER (Kassir).

---

## 1. Shell anatomy

```
┌──────────┬──────────────────────────────────────────────────────────────────┐
│          │ TopBar 48px: breadcrumb · [⌕ Qidiruv… Ctrl+K] · LiveBadge · ☾ · 👤│
│ SideNav  ├──────────────────────────────────────────────────────────────────┤
│ 240px    │ PageHeader: breadcrumb-title · status/meta chips · actions · tabs│
│ (rail    ├──────────────────────────────────────────────────────────────────┤
│  64px)   │ Content: max-width 1440px centered, 24px padding                 │
│          │ optional PeekPanel 420–560px docked right (registers)            │
└──────────┴──────────────────────────────────────────────────────────────────┘
```

### 1.1 SideNav

- 240px, collapsible to a 64px icon rail (`[` toggles; state persisted in localStorage).
- **Surface-colored, not dark**: light `#F1F3F6` + 1px border; dark `#12171D`. The chrome
  gives contrast away to the numbers.
- Wordmark row: stacked-blocks SVG glyph + «SmartBlok» 15px/600 — doubles as home link.
- Below the wordmark: a full-width **search button styled as an input** («Qidiruv… Ctrl+K»)
  opening the command palette — clickable for mouse users.
- Nav grouped by money-flow, ordered by frequency (§3). Group labels: overline style
  (11px/600, +0.06em, no uppercase transform, `colorTextTertiary`), collapsed-group state
  persisted per user. Every item has an icon. Active item: `colorPrimaryBg` pill +
  primary-colored text (no left borders, no inverse blocks).
- Queue-bearing items carry live count badges fed by the worklist queries (§6), refreshed by
  the existing realtime invalidation.

### 1.2 TopBar (48px, `colorBgContainer`, hairline bottom border)

Left → right:

1. **Breadcrumb trail** («Buyurtmalar / ORD-000214») — 12px, secondary; mirrors PageHeader.
2. Spacer.
3. **LiveBadge** — real socket state, never decorative: green dot «Jonli» / amber pulse
   «Ulanmoqda…» / grey «Oflayn — ma'lumot 14:32 holatiga» with last-refresh timestamp in the
   tooltip («Oxirgi yangilanish: 14:32:05»). Clicking opens the worklist popover (compact
   InboxRail); while offline, `refetchOnWindowFocus` turns on and every KPI band shows the
   «HH:mm holatiga» suffix.
4. **Theme toggle** — sun/moon icon button (not a Switch). Persists `sb_theme`; stamps
   `data-theme` on `<html>`.
5. **Avatar chip** — initial avatar + name + **localized role label** from the single shared
   `ROLES` map («Administrator», «Buxgalter», «Agent», «Kassir» — the raw enum never renders
   again). Dropdown: Profil · Klaviatura yorliqlari (`?`) · Chiqish.

### 1.3 Role behavior (there is no role switcher)

Roles are fixed per login (JWT). The shell renders per-role: nav tree, route guards, and
in-page action visibility all derive from **one shared `PERMISSIONS` map**
(`lib/permissions.ts`: role → capability), hand-aligned with the backend `@Roles` matrix.
The Import/ACCOUNTANT 403-drift class of bug becomes structurally impossible. UI hiding is
cosmetic — the map mirrors the server, it never invents exposure. `/` renders a per-role
variant (A/B cockpit · G agent cockpit · K kassa terminal); switching users = logout/login.

### 1.4 Notifications

There is no bell feed and no notifications endpoint. **Queues are the notification system**:
live counts on WorklistCards and nav badges + the LiveBadge. Toasts appear only for the
actor's own action results (platform law, `02` §9).

### 1.5 Print chrome

Print CSS strips SideNav + TopBar (`no-print`, kept). Dedicated `/print/*` routes render
`PrintDocument` previews with a sticky «Chop etish» toolbar (see `05` §6).

---

## 2. Command palette (Ctrl+K / ⌘K)

One palette, opened by the sidebar search button, `Ctrl/Cmd+K` anywhere, or `/` focuses the
page FilterBar search instead (list pages). 640px surface at e3, 15px input, grouped results,
right-aligned key hints, footer legend (`↑↓ tanlash · Enter ochish · Esc yopish`).

Three result groups, queried in parallel (debounced 250ms):

1. **Yozuvlar (records)** — federated server search: clients by name/phone/alias
   (`GET /clients?search=`), orders by number/client (`GET /orders?search=`), payments
   (`GET /payments?search=`), vehicles by plate (via vehicles search). Top 5 per group; each
   row shows the identifying fact inline (client → `BalanceTag`; order → date + status chip;
   payment → amount + kind; vehicle → plate + `BalanceTag`). Enter opens the record.
2. **Amallar (actions)** — verb-first, role-filtered: «Yangi buyurtma», «To'lov qabul
   qilish», «Zavodga to'lash», «Shofyorga to'lash», «Xarajat kiritish», «Paddon qaytarish
   qabul qilish», «Chop etish». **Record-scoped actions:** when a record result is
   highlighted, the action list re-scopes — highlighting client «Жамол Ургенч» offers
   «Yangi buyurtma — Жамол Ургенч» and «To'lov qabul qilish — Жамол Ургенч», opening the
   composer with the party pre-bound. A phone order starts in 2 keystrokes. Opening the
   palette on a party page pre-scopes actions to that party.
3. **Sahifalar (pages)** — the role-filtered route list, with the existing
   Uzbek/Russian/English keyword aliases (typing «оплата» finds To'lovlar).

Recents: last 8 opened records (localStorage per user) shown before typing. AGENT's palette
sees only own-scope records + their pages; CASHIER's sees payments/expenses/kassa.

---

## 3. Navigation tree per role (exact labels + routes)

### ADMIN

| Group | Item | Route | Badge |
|---|---|---|---|
| — | **Ish stoli** | `/` | Σ open queues |
| SAVDO | Buyurtmalar | `/orders` | — |
| | Mijozlar | `/clients` | — |
| | Agentlar | `/agents` | — |
| MOLIYA | To'lovlar | `/payments` | Taqsimlanmagan + Tekshirilmagan |
| | Qarzlar | `/debts` | Muddati o'tgan |
| | Kassa | `/kassa` | — |
| | Xarajatlar | `/expenses` | — |
| | Hisobotlar | `/reports` | — |
| TA'MINOT | Zavodlar | `/factories` | — |
| | Bonus hamyonlar | `/bonus` | — |
| | Paddonlar | `/pallets` | — |
| | Moshinalar | `/vehicles` | Shofyorlarga qarz (count) |
| | Ta'minot matritsasi | `/procurement` | — |
| KATALOG | Mahsulotlar | `/products` | — |
| | Ma'lumotnomalar | `/references` | — |
| TIZIM | Foydalanuvchilar | `/users` | — |
| | Tizim sozlamalari | `/settings` | — |
| | Excel import | `/import` | — |

### ACCOUNTANT (Buxgalter)

Identical minus the TIZIM group, **except** «Tizim sozlamalari» remains and opens the
**read-only** settings view (`GET /settings` already permits B — every field disabled with an
explainer). **Excel import disappears entirely** for B (nav, route guard, palette) — aligned
with the API's `@Roles('ADMIN')` reality via the PERMISSIONS map.

### AGENT (flat, no groups; bottom tab bar on phones — see §11)

| Item | Route |
|---|---|
| Ish stoli | `/` (agent cockpit incl. the `/agents/me` limit card) |
| Buyurtmalar | `/orders` (own) |
| Mijozlar | `/clients` (own) |
| Qarzlar | `/debts` (own; pallet tab folded in) |
| To'lovlar | `/payments` (own CLIENT_IN) |

«Mening ko'rsatkichlarim» (`/me`) is reachable from the agent cockpit card and the avatar
menu. Paddonlar for an agent lives as a tab inside Qarzlar (`/debts?tab=paddonlar`) — an
agent thinks «what does my client owe» (money + pallets together), not «pallet subsystem».

### CASHIER (Kassir — a terminal, not an ERP)

| Item | Route |
|---|---|
| Kassa terminali | `/` |
| To'lovlar | `/payments` |
| Kassa | `/kassa` |
| Xarajatlar | `/expenses` |

---

## 4. Full route table

All list-page filters are URL search params (§7). `?panel=` opens URL-addressable drawers.
`/payments/:id` renders the register **with the peek open** (deep-linkable master-detail).

| Route | Roles | Page / what it shows |
|---|---|---|
| `/login` | public | Centered 400px card: wordmark, Login/Parol, «Kirish». Identical error copy for unknown user/wrong password (anti-enumeration); «Hisob bloklangan» on 403; caps-lock hint. Nothing else. |
| `/` | A B G K | Role-variant cockpit. **A/B — Ish stoli**: InboxRail of severity-ordered WorklistCards (§6) on top, then KpiBands SAVDO / FOYDA / QARZLAR (drillable StatCards, full precision, deltas, sparklines), then the trends chart (`?days=` 7/30/90/365, order-count bar layer, point-click → that day's orders) + compact current-month agent ranking linking to `/reports?tab=reyting`. Duplicate «Kutilayotgan tushum» card is dead. **G — agent cockpit**: limit card (`GET /agents/me` CreditGauge) first, scoped KPIs, own queues (Muddati o'tgan, Bugun muddati kelganlar, Yo'ldagi buyurtmalarim), 14-day sparkline. **K — Kassa terminali**: 4 intent buttons (To'lov qabul qilish · Zavodga to'lash · Shofyorga to'lash · Xarajat), cashbox cards with today in/out, per-currency grand totals (UZS/USD never merged), live today-operations feed with per-row «Kvitansiya». |
| `/me` | G | Agent self card (`GET /agents/me`): HeadroomMeter hero (limit / ochiq qarz / bo'sh), monthly + all-time KPIs, own client board with balances. |
| `/orders` | A B G(own) | Register: status segmented strip + worklist chips (Narxlanmagan · Moshinasiz · Aniqlanmagan · Tannarx ochiq), FilterBar (search, client, factory, date), SavedViews, totals row (Σ savdo «sahifa jami»; Σ m³ / Σ paddon only if the list payload carries item sums — see orders.md §1.3), blocker badges on rows, muddat column (overdue red), row kebab (Ko'rish · Holatni oshirish · Chop etish · Bekor qilish), PeekPanel. |
| `/orders/new` | A B G | Full-page order composer: 4 visual stages down one column + sticky LedgerPreview rail (see `05` §1). AGENT variant hides Narxsiz mode, enforces the price floor inline. |
| `/orders/:id` | A B G(own) | Two-column order workbench: document left (items + Narxlash, note, pallet movements, unified ActivityTimeline), sticky money rail right (StatusFlow with blockers, Moliya with exposure-correct progress = saleTotal + transportCharge, Transport card with pay actions, paddon chip). Header: Tahrirlash (gated), Chop etish ▾ (Yuk xati · Hisob-faktura), Bekor qilish (ReasonModal + impact). `?tab=` deep-links left-column sections. |
| `/orders/:id/edit` | A B | **NEW** — the composer pre-filled over `PUT /orders/:id`. Only NEW/CONFIRMED + costStatus=PROVISIONAL; permanent banner explains reverse+repost, credit re-check, immutable intendedPaymentMethod (rendered disabled). Entry: OrderDetail header, Moshinasiz queue. |
| `/clients` | A B G(own) | Register: FilterBar (search; region/agent selects where the API filters — hidden otherwise, never faked), BalanceTag column, CreditGauge mini-column, paddon chip, overdue chip. Row kebab: To'lov qabul qilish · Yangi buyurtma · Akt sverki · Tahrirlash · Faollashtirish/Deaktivatsiya. Create + edit unify in one 480px right drawer. |
| `/clients/:id` | A B G(own) | The archetypal party page: PartyBalanceHeader (balance sentence, paddon, overdue, CreditGauge, actions: To'lov qabul qilish · Yangi buyurtma · Akt sverki) over tabs: **Hisob-kitob** (PartyStatement, default) · Buyurtmalar · To'lovlar (server-paginated + «Hammasini ko'rish →» to the filtered registers — the 20-row cap dies) · Taxalluslar · Maxsus narxlar (grouped by product, current highlighted, future badged «kelgusi»). `?panel=tolov` opens the prefilled composer. |
| `/payments` | A B K G(own CLIENT_IN) | Register + intent buttons (To'lov qabul qilish · Zavodga to'lash · Shofyorga to'lash · overflow: refunds, Mijoz shofyorga to'ladi). FilterBar: kind, method, party, date, **reconciled tri-state**, voided tri-state, **`alloc=open` chip** (unallocated remainder). Filtered per-kind sums above the table. SavedViews («Tekshirilmagan», «Bugungi kirimlar»). Row click / `Space` opens the PeekPanel. |
| `/payments/:id` | A B K G(own) | Same register with the payment PeekPanel open via URL (fixes every dead deep link). Peek: descriptions with translated ledger sources, USD equation, allocations mini-table + **«Taqsimlash»** (opens SettleDrawer, `?panel=taqsimlash`), Kvitansiya print, Bekor qilish (ReasonModal + impact). `↑/↓` moves the peek through rows. |
| `/debts` | A B G(own) | Collections hub, tabs `?tab=mijozlar|zavodlar|shofyorlar|paddonlar`. Header: the six summary figures as drillable tab-linked cards (A/B only). **Mijozlar** (default): debt board worst-first — balance (alarm red here), aging in-row (overdue count + Σ, never a tooltip), paddon, term, expandable row (open orders + due dates), row verbs: `T` = To'lov qabul qilish · Akt sverki · Mijoz kartasi; window select 7/14/30 feeding «Kutilayotgan tushum». **Zavodlar / Shofyorlar**: liability boards with per-row pay actions. **Paddonlar**: in-kind balances (agent's scoped view lives here). |
| `/kassa` | A B K | Treasury: ONE period control governs the page; cashbox cards act as scoping filters (click = scope summary + journal; selected ring); per-currency grand totals; period summary table (opening/in/out/closing); journal where **source documents are links** (payment peek, expense row); manual IN/OUT modal (strict radio); storno on MANUAL rows only via ReasonModal. |
| `/expenses` | A B K | Register + header stat strip (filtered total + per-category chips, scope-labeled), FilterBar (search, category, cashbox, date, voided tri-state), totals row, create modal (category select with inline «+», cashbox with live balance), void via ReasonModal. Category management lives in `/references`. Tashkent-day basis noted on the range picker. |
| `/pallets` | A B G(read, scoped) | In-kind ledger: balances (clients \| factories) side by side, one primary action per side + row kebabs; movements table with date-range + type filters and totals footer (net in-kind delta; qty × narx line totals for money-bearing rows). Mutation modals show current → post-action balance (warn, don't block, on negative); unit price prefills from `palletPriceDefault` setting with a deviation hint. |
| `/bonus` | A B | Wallet cards (balance, program badge PER_M3 5 000/m³ · % 1,5 · —, actions Naqd yechish / Qarzga o'tkazish pre-scoped; clicking a card filters the journal). Journal: accrual basis as real columns («25 m³ × 5 000 = 125 000»), program version linked; ADJUSTMENT rows self-explain («tannarx qotirilgani uchun qayta hisob»); WITHDRAWAL rows keep Qaytarish (ReasonModal); DEBT_OFFSET rows deep-link to their payment for voiding. Actions duplicated on FactoryDetail. |
| `/factories` | A B | Server-searched/paginated register (50-row silent cap dies): name, BalanceTag (Avansimiz/Qarzimiz), bonus wallet, **program badge**, paddon accountability (pallet-module formula — one truth), status. Row → hub. |
| `/factories/:id` | A B | **Settlement hub**: PartyBalanceHeader (balance sentence, bonus chip, paddon chip) + four pre-scoped actions (To'lash · Taqsimlash · Bonusdan yopish ▾ · Paddon qaytarish); «Ochiq buyurtmalar» strip (count + uncovered cost of non-FINAL orders); tabs `?tab=hisob|tolovlar|bonus|paddonlar` — statement default (server-paginated, date-windowed — verify §10), Bonus tab with versioned program history + «Yangi dastur» (non-retroactivity note, same-date collision pre-check). Akt sverki print in overflow. |
| `/products` | A B | Catalog: live-debounced search, price columns show value + effective-from date + «kelgusi narx» badge for future rows. Price drawer: per-kind tabs, current row pinned, future rows badged. **«Narxlarni yangilash» bulk sheet**: pick factory → editable grid products × 3 kinds pre-filled with current, one effectiveFrom, «+X%» quick fill; save = N versioned POSTs with per-row result report. |
| `/procurement` | A B | Tabs `?tab=matritsa|marshrutlar`. Matritsa: **grouped by product**, cheapest factory marked within each group, global sort toggle; dropped products with fix links («Narx kiritish →» product drawer, «Marshrut qo'shish →» routes tab). Marshrutlar (**NEW**): versioned routes per factory×region + «Yangi tarif» form (cost/truck, capacity default from settings, effectiveFrom) over the existing GET/POST. |
| `/vehicles` | A B | Fleet register wired to server search/pagination: name, plate, **Shofyor** (canonical term), phone, capacity, BalanceTag («Qarzimiz» amber), status. Row → detail. |
| `/vehicles/:id` | A B | **NEW — driver settlement hub** (`GET /vehicles/:id`): PartyBalanceHeader («Shofyorga qarzimiz: …», driver, phone tap-to-call, capacity), actions «Shofyorga to'lash» · «Mijoz to'lagan deb yozish»; **«To'lanmagan yuklar»** panel (the vehicle's own orders from the detail payload — unpaid/UNKNOWN first, checkbox rows + BulkBar Σ) above the full PartyStatement. |
| `/agents` | A B | Register: name, phone, clients count, open debt, effective limit + CreditGauge («0 — bloklangan» phrasing), status. |
| `/agents/:id` | A B | Agent card: edit action in header, month picker (ranking `?month=` data) beside all-time KPIs, client board with per-row debt actions and links. |
| `/reports` | A B | Tabs `?tab=svod|reestr|reyting`. **Svod**: agent blocks expanded as one grouped table with sticky subtotal rows, every client/factory name linked, identity checks pinned as headline chips (green «Mos (0)» / red «Farq: X» styled as a defect signal); export shaped like the on-screen layout where backend permits. **Reestr**: column presets (Moliya / Logistika / Hammasi), server totals row for the whole filter, transport-status + vehicle filters, xlsx kept. **Reyting**: month picker, MoM deltas, debt column labeled «hozirgi qoldiq», rows → `/agents/:id`. |
| `/references` | A B | Three tabs (**consolidation** — old routes 301-redirect): **Hududlar** (client-count links to filtered `/clients`; delete disabled with reason when referenced), **Yuridik shaxslar** (one activate/deactivate toggle; drives PaymentComposer payer/receiver pickers at last), **Xarajat kategoriyalari** (usage counts from `_count.expenses`, inline rename, delete-when-unused — first UI for existing endpoints). |
| `/import` | A only | 4-step wizard: Yuklash → Tekshiruv → Import → Solishtirish (full spec `05` §5). ADMIN-only end to end — nav, route, palette. |
| `/users` | A | Register + search, role/status filter chips, email column, blocked rows sorted last, symmetric Bloklash / **Faollashtirish** actions, shared ROLES labels. |
| `/settings` | A (write), B (read-only) | Per-field save affordance (each key PUTs independently with inline ✓/✗ — partial-write confusion dies); `saleMarginMinPct` carries an amber «hozircha tizimda qo'llanilmaydi» badge until the backend consumes it; effective values cross-referenced («qayerda ishlatiladi» hints; pallet modals read `palletPriceDefault`). |
| `/profile` | A B G K | One editable card (name, login, **email** — finally exposed, phone) + password card with the session-invalidation note. Duplicate read-only block dies. |
| `/print/waybill/:orderId` | A B G(own) | Yuk xati — chrome-free print route (`05` §6.1). |
| `/print/invoice/:orderId` | A B G(own) | Hisob-faktura (`05` §6.2). |
| `/print/receipt/:paymentId` | A B K G(own) | Kvitansiya (`05` §6.3) — refuses TRANSPORT_DIRECT & voided payments with an explainer. |
| `/print/statement/client/:id` | A B G(own) | Akt sverki (solishtirish dalolatnomasi), `?from&to` (`05` §6.4). |
| `/print/statement/factory/:id` | A B | Factory akt sverki, `?from&to`. |

Redirects kept: `/regions` → `/references?tab=hududlar`, `/legal-entities` →
`/references?tab=yuridik`. `/bonus` stays a first-class page (its actions are additionally
duplicated in context on FactoryDetail).

---

## 5. Where every one of the 26 current pages lands

| Current page | Fate |
|---|---|
| Dashboard.tsx | **Splits into three role cockpits at `/`** (Ish stoli / Agent / Kassa terminali). KPI wall → InboxRail + tiered KpiBands; ranking → `/reports?tab=reyting` (compact copy stays on the cockpit); duplicate expectedCollections card dies; fake LIVE tag → LiveBadge; `?days`/`?month` finally wired. |
| Orders.tsx | Stays; gains URL filters, SavedViews, worklist chips, sorting, totals row, blocker badges, row kebab, PeekPanel. |
| NewOrder.tsx | Rebuilt as the 4-stage composer + LedgerPreview rail; same route; reused pre-filled by `/orders/:id/edit`. |
| OrderDetail.tsx | Rebuilt as the two-column workbench; gains Edit, inline vehicle assignment, privileged status menu (skip/one-back + note), print split-button, exposure-correct progress, merged activity feed (Izohlar tab dies into it). |
| Payments.tsx | Stays; the 961-line morphing modal **dies** → PaymentComposer (kind-first) + SettleDrawer; detail Drawer → URL-addressable PeekPanel at `/payments/:id`; `?reconciled=` + `alloc=open` queues; filtered per-kind sums. |
| Kassa.tsx | Stays; three desynced sections unified under one period control; cashbox cards become scoping filters; journal documents clickable. |
| Debts.tsx | **Promoted to the collections hub** — 4 tabs covering all three debt sides + in-kind; six dead stat cards become drillable headers; every row carries its settle action; in-row aging. |
| Pallets.tsx | Stays; row-launched actions with current→post-action balance; date+type filters; totals footer; setting-driven unit price. |
| Clients.tsx | Stays; structured FilterBar, CreditGauge column, one drawer for create+edit, row actions; **Faollashtirish** appears only if the one approved DTO change lands (§10). |
| ClientDetail.tsx | Rebuilt as the archetypal party page (PartyBalanceHeader + statement-first tabs + full-history links). |
| Factories.tsx | Stays; server search/pagination; program badge column. |
| FactoryDetail.tsx | **Promoted to settlement hub** (hero workflow c). |
| Bonus.tsx | Stays as the cross-factory overview; wallet cards become actionable filters; accrual basis becomes columns; actions duplicated on FactoryDetail. |
| Products.tsx | Stays; effective dates + future-price badges; per-kind price drawer tabs; **bulk price sheet** added. |
| Procurement.tsx | Stays; matrix grouped per product; **Marshrutlar tab born** (existing routes API, zero UI today). |
| Vehicles.tsx | Stays; rows stop being terminal → **`/vehicles/:id` is born**. |
| Agents.tsx / AgentDetail.tsx | Stay; detail gains edit + month scope; `/me` born for AGENT. |
| Regions.tsx | **Dies as a route** → `/references?tab=hududlar` (redirect kept). |
| LegalEntities.tsx | **Dies as a route** → `/references?tab=yuridik`; entity pickers finally wired into PaymentComposer. |
| Reports.tsx | Stays; absorbs agents ranking; Svod expanded + linked; Reestr presets + server totals. |
| Expenses.tsx | Stays; filtered totals, category chips, voided tri-state; category CRUD → `/references`. |
| Import.tsx | Rebuilt as the ADMIN-only 4-step wizard rendering sheetGaps + explained-vs-unexplained (the backend's hidden verdict). |
| Users.tsx | Stays; search/filters/email/symmetric activate. |
| Settings.tsx | Stays; per-field save; no-op field badged; B read-only variant. |
| Profile.tsx | De-duplicated; email added. |
| Login.tsx | Kept minimal; restyled to tokens. |

---

## 6. The worklist engine (`/` InboxRail) — queue taxonomy

The A/B cockpit's centerpiece: **InboxRail** («E'tibor kerak») of WorklistCards, order fixed
by severity (danger → violet → warning → neutral), not user-configurable. Zero-count cards
collapse into a single green «Toza ✓» strip at the bottom — a clean day is visibly clean.
Counts update via the (2s-coalesced) realtime invalidation.

**Honesty governance (binding):** a queue ships only if its count comes from a server filter
or a **bounded, visibly-labeled** client-side derivation. Every client-derived queue names
its endpoint + window on the drill page (window selector shown on the tab — «the scan is
honest about its bounds»). At 10× volume the fix is a backend filter param — noted, never
designed around.

| # | Worklist (title) | Severity | Definition (existing API) | Drill URL | Roles |
|---|---|---|---|---|---|
| 1 | Muddati o'tgan qarzlar | danger | `GET /debts/clients` rows with `hasOverdueOrders` (server-computed) | `/debts?tab=mijozlar&chip=overdue` | A B G(own) |
| 2 | Tekshirilmagan to'lovlar | violet | `GET /payments?reconciled=false` (server filter) — the ~95.8M review queue | `/payments?reconciled=false` | A B |
| 3 | Transport aniqlanmagan | violet | orders with `transportPaidStatus=UNKNOWN` — register scan over a visible window (default: joriy oy; selector on tab) | `/orders?chip=transport-unknown` | A B |
| 4 | Taqsimlanmagan to'lovlar | warning | payments where Σ active allocations < amount (allocatable kinds, non-voided) — from list payload allocations if present, else lazy per-row fetch over a labeled window (verify §10c) | `/payments?chip=alloc-open` | A B |
| 5 | Narxlanmagan buyurtmalar | warning | non-cancelled orders containing pricePending items — register scan, visible window | `/orders?chip=unpriced` | A B |
| 6 | Moshina biriktirilmagan | warning | orders `status=CONFIRMED` with `vehicleId=null` (blocked from LOADING) — from in-flight status fetches, client-filtered | `/orders?status=CONFIRMED&chip=novehicle` | A B |
| 7 | Tannarx qotirilmagan (>7 kun) | warning | COMPLETED orders with `costStatus ≠ FINAL` older than 7 days — bounded scan, visible window | `/orders?status=COMPLETED&chip=cost-open` | A B |
| 8 | Shofyorlarga qarz | warning | vehicles with negative balance (list payload) | `/vehicles?chip=owed` | A B |
| 9 | Limit chegarasida | neutral | debts/clients rows where balance ≥ 80% of creditLimit (computed from returned rows) | `/clients?chip=near-limit` | A B |
| 10 | Yo'ldagi buyurtmalar | neutral (info card, not alarm) | `GET /orders?status=` CONFIRMED + LOADING + DELIVERING (3 parallel queries, merged) — also surfaces the invisible `ordersInFlight` KPI | `/orders?chip=inflight` | A B |
| 11 | Bugun muddati kelganlar (agent) | warning | own debts rows due within window (days=1..7) | `/debts?days=7` | G |

WorklistCard anatomy/states: `04-components.md` §3.4. Preview rows (top-3) open the record
directly; the card header drills to the filtered list. The `chip=` values are UI-side saved
filters (see §7) that reconstruct the queue's query on the register.

---

## 7. URL parameter conventions (the FilterBar contract)

Single source of truth: `useSearchParams` via one shared `useUrlFilters` hook — **no parallel
useState**. Back/forward restores the exact param set; URLs are shareable; every KPI/worklist
drill-down is just a link.

| Route | Params |
|---|---|
| `/orders` | `status, search, clientId, factoryId, vehicleId*, from, to, chip, view, sort*, page, pageSize, peek` |
| `/payments` | `kind, method, clientId, factoryId, vehicleId*, search, from, to, voided(hide/show/only), reconciled(true/false), chip, view, page, peek, panel(taqsimlash)` |
| `/clients` | `search, regionId*, agentId*, status, chip, page` |
| `/clients/:id` | `tab, from, to, panel(tolov)` |
| `/debts` | `tab(mijozlar/zavodlar/shofyorlar/paddonlar), days(7/14/30), chip, search, page` |
| `/kassa` | `cashboxId, from, to, source, dir(in/out), page` |
| `/expenses` | `categoryId, cashboxId, search, from, to, voided, page` |
| `/reports` | `tab(svod/reestr/reyting), from, to, month(YYYY-MM), clientId, factoryId, preset(moliya/logistika/hammasi)` |
| `/factories/:id`, `/vehicles/:id`, `/agents/:id` | `tab, from, to` |
| `/procurement` | `tab(matritsa/marshrutlar), regionId, productId` |
| `/products` | `factoryId, search, page` |
| `/references` | `tab(hududlar/yuridik/kategoriyalar)` |
| `/` | `days(7/30/90/365)` |
| `/print/statement/*` | `from, to` |

Rules:

- Dates `YYYY-MM-DD`, Tashkent-local calendar days; enums lowercase in URLs, mapped to API
  enums; unknown params ignored (rendered as a red clearable token if they reach FilterBar).
- Every param change resets `page` to 1 — except `page`/`pageSize`/`peek` themselves.
- `peek=<id>` addresses the PeekPanel; `/payments/:id` is the canonical alias (route param
  wins; moving the peek with `↑/↓` rewrites the URL via replaceState).
- `panel=` opens a named drawer over the page (taqsimlash → SettleDrawer, tolov → composer).
- `view=` names a SavedView (localStorage `sb_views:<userId>:<route>`; a view = query string
  + column set + density).
- `chip=` names a queue filter recipe from §6 (client-side where derived — the page shows the
  window selector).
- Params marked `*` ship only if the API honors them (verify §10); otherwise the control is
  hidden — never a silently-ignored filter.

---

## 8. Keyboard shortcut map (the `?` overlay content)

Chords disabled inside text inputs. Every menu item and button renders its `KbdHint` chip —
learnable by osmosis. All five hero workflows are keyboard-complete.

**Global**

| Keys | Action |
|---|---|
| `Ctrl+K` | Command palette (records / actions / pages) |
| `G` then `D / O / M / T / Q / K` | Go: Ish stoli / Buyurtmalar / Mijozlar / To'lovlar / Qarzlar / Kassa |
| `[` | Sidebar collapse |
| `?` | Shortcut cheatsheet overlay |
| `Esc` | Close topmost surface (peek → drawer → modal → palette), dirty-check guarded |

**List pages (registers)**

| Keys | Action |
|---|---|
| `/` | Focus FilterBar search |
| `N` | New (page's primary create) |
| `F` | Open filter adder |
| `V` | SavedViews menu / cycle views |
| `↑↓` or `J/K` | Row cursor |
| `Enter` | Open row (full page) |
| `Space` | Toggle PeekPanel on cursor row; with peek open, `↑↓` moves the peek through rows |
| `X` | Select row (BulkBar appears); `Shift+↑↓` extends |
| `.` | Row action menu (kebab) |
| `T` | To'lov — payment composer pre-bound to the row's party (debt/client/vehicle rows) |
| `→` | Expand row (where rows expand, e.g. Debts aging) |

**Forms & composers**

| Keys | Action |
|---|---|
| `Tab / Shift+Tab` | Field walk |
| `Ctrl+Enter` | Submit (composers: save; success state offers print) |
| `Alt+Enter` | Add item row (order composer) |
| `Ctrl+Backspace` | Delete item row |
| `A` | FIFO auto-distribute («Eskisidan boshlab taqsimlash») in SettleDrawer |
| `Esc` | Cancel with dirty-check |

**Detail pages**

| Keys | Action |
|---|---|
| `E` | Edit (when legal) |
| `P` | Print menu (contextual: order → Yuk xati/Hisob-faktura; client → Akt sverki) |
| `Enter` | Primary next-step verb (order workbench StatusFlow) |

Focus management: drawers/modals trap focus and return it to the invoker; destructive
confirms never default-focused; toasts `aria-live=polite`.

---

## 9. Cross-link contract (audited per screen)

Every entity reference anywhere is a link, and every link round-trips:

- order ↔ payment (via `/payments/:id` peek), kassa row → source document (peek), statement
  row → document, svod client/factory cell → party page, ranking row → `/agents/:id`,
  KPI card → filtered register, chart point → that day's orders (`/orders?from=X&to=X`),
  region client-count → `/clients?regionId=`, procurement dropped-row reason → the fix
  (price drawer / routes tab), bonus DEBT_OFFSET row → its payment peek.
- Back button always restores the exact filter state (URL-synced).
- QA reverse test: from any number, reach its postings in ≤2 clicks; from any posting, reach
  its document in 1.

---

## 10. Verify before build (API facts the design depends on)

| # | Assumption | If false |
|---|---|---|
| a | Factory/vehicle statements support pagination + date window + opening balance | Fall back to windowed client-side computation from detail payloads, labeled with its window |
| b | List endpoints accept `?sort=field:dir` | Sort headers render disabled-with-tooltip (default posture until confirmed) |
| c | Payments list payload embeds allocations (needed for the Taqsimlanmagan queue + remainder column) | Lazy per-row fetch over a labeled window, visible per-cell spinner |
| d | **The one approved backend change:** add `active` to `UpdateClientDto` so client reactivation exists | The «Faollashtirish» action hides entirely and the gap is documented in-UI (tooltip on the Nofaol tag) — never a fake toggle |
| e | `?vehicleId=` filter on `GET /orders` | VEHICLE_OUT allocation candidates come exclusively from the vehicle-detail payload (its own orders — already the designed default) |

---

## 11. Responsive behavior

| Range | Shell | Lists | Detail |
|---|---|---|---|
| ≥1600px | sidebar 240 + content max 1440 | full tables + peek | workbench, rail 320 |
| 1200–1599 | sidebar 240 | tables; low-priority columns fold into row expand | workbench, rail 300 |
| 1024–1199 | sidebar auto-collapses to 64 rail | column presets forced; peek overlays | rail becomes top summary strip |
| 768–1023 | rail + overlay drawer nav | 2-line rows (identity+status / money+meta) | single column |
| <768 | **AGENT: bottom tab bar** (56px, safe-area): Ish stoli · Buyurtmalar · ➕ (raised: Yangi buyurtma / To'lov qabul qilish) · Mijozlar · Qarzlar. Desk roles: overlay nav, read-and-approve support | card lists only, filter chip scroller + sheet | single column, sticky bottom ActionBar |

AGENT mobile: tables never render — card lists only (identity line, BalanceTag right, chips
beneath, whole card tappable); drawers become bottom sheets (drag handle); order composer
becomes the 4-step wizard with the **collapsed bottom-sheet summary bar** («19/19 paddon ·
23,9 mln · qarzga yoziladi») expanding to the full LedgerPreview; money entry
`inputmode="numeric"`; no hover-only information anywhere (hard rule); touch targets ≥44px;
offline shows the amber reconnect banner. Desk roles on phones: reading and approving
(cockpit, detail, status advance, ReasonModal) — heavy entry shows a polite «kompyuterda
qulayroq» note but does not block.

---

## 12. Canonical glossary (one term, one script, everywhere)

Role labels and all status labels come from single shared maps (`ROLES`, `STATUS`,
`LEDGER_SOURCE`) consumed by every screen and print doc. No screen may introduce a synonym.
Workbook Cyrillic strings render only as `ArtifactText` quotes (Import + statements).

| Concept | Canonical | Banned variants |
|---|---|---|
| Driver | **Shofyor** | Haydovchi, шопир |
| Accountant role | **Buxgalter** | Hisobchi, raw enums |
| Admin role | **Administrator** | ADMIN raw |
| Pallet | Paddon (dona) | Pallet, поддон |
| Allocation | Taqsimlash / taqsimot | Allokatsiya (helper text only), ajratish |
| Provisional / final cost | Taxminiy tannarx / Tannarx qotirilgan | raw PROVISIONAL/FINAL |
| Price-pending | **Narxlanmagan** | Narxsiz (short chip label only) |
| Unreconciled | **Tekshirilmagan** | Tekshirilsin |
| Settled | **Hisob yopiq** | Hisob teng, Hisob toza, bare «0» |
| Void / storno | Bekor qilish (hujjat) / Storno (kassa/ledger yozuvi) | O'chirish — forbidden word |
| Collections | Undiruv | — |
| Worklist | E'tibor kerak | Inbox, Navbatlar |
| Statement | Hisob-kitob | Vypiska |
| Waybill | **Yuk xati** | Yo'l varaqasi, nakladnaya (print subtitle in parentheses allowed) |
| Invoice | Hisob-faktura | schyot |
| Receipt | Kvitansiya | chek |
| Reconciliation statement | Akt sverki (solishtirish dalolatnomasi) | — |
| They owe us / their advance | Qarz / Avans | signed-only numbers |
| We owe / our advance | Qarzimiz / Avansimiz | — |
