# SmartBlok UX Vision — «ROLE COCKPIT»

**Muallif:** Design vision #2 of 4 (jury merge candidate)
**Sana:** 2026-07-11
**Manba:** docs/design/01-design-brief.md (to'liq), 00-business-map.md, apps/web/src (v3 kod — yagona haqiqat)

---

## The one-sentence thesis

SmartBlok is not a database browser — it is four different jobs (owner-operator, accountant,
field agent, cashier) that share one immutable ledger; therefore **every role logs into a
purpose-built cockpit whose center is a live worklist of the things that block money today**,
and every other screen exists to close an item on that worklist in the fewest possible clicks.

The current v3 app is a well-built table-per-entity admin panel. Its highest-value data —
unallocated payments, unpriced trucks, orders stuck without a vehicle, drivers waiting to be
paid, imported payments awaiting the owner's sign-off — is *computed by the backend and
rendered nowhere*, or rendered as a dead-end tag with no filter and no action. The Role Cockpit
vision inverts the app: **navigation is organized by job-to-be-done, the landing page is a
triage inbox (SAP Fiori "My Inbox" × Linear triage), and every list/detail page carries its
actions with it** so no task requires re-finding a party in a dropdown you were just looking at.

Everything below uses ONLY existing API endpoints. The redesign additionally wires up the seven
endpoints that today have no UI: `PUT /orders/:id` (edit), `GET /vehicles/:id` (driver hub),
`POST /payments/:id/allocations` (allocate later), `GET /agents/me` (agent self-card),
`?reconciled=` (review queue), `POST /procurement/routes` (routes CRUD),
`GET /dashboard/trends?days=` + `GET /dashboard/agents-ranking?month=` (period pickers).

---

# 1. Design philosophy

Five principles, each specific to this business. Every screen decision in sections 6–9 traces
back to one of these.

### P1 — «Pul qayerda qotib qolgan?» (Where is money stuck?) is the home screen, not a chart wall

The dealer's day is not "browse orders". It is: *which payments haven't been allocated (so costs
aren't final and aging is meaningless), which trucks shipped without a price, which client blew
past their due date, which driver is owed money, which imported payment still needs the owner's
sign-off*. These are finite, countable queues that go to zero when the work is done. The cockpit
renders them as **worklist cards with counts and one-click actions** — a KPI you cannot act on
from where you see it is a decoration, and this design has no decorations. Every number
drills down to the filtered list that produced it.

### P2 — The party is the workbench; actions travel to the data

Client, Zavod, Moshina (driver) — each is a *settlement relationship*, not a table row. Their
detail pages become **operation hubs**: balance framed in human terms («Bizga qarzi» /
«Avansi»), a running statement, AND the actions that change that balance (accept payment, pay,
allocate, return pallets, spend bonus) pre-scoped to that party. The current app scatters
"settle with factory X" across four pages with four re-selections of X; here the rule is:
**if you can see a balance, you can act on it without leaving the page.**

### P3 — The ledger's honesty must be visible: provisional vs final, derived vs declared, reconciled vs flagged

This system's soul is an immutable ledger where cost is *provisional until allocation*,
transport status is *derived, never hand-set*, and 95.8M UZS of imported history is *flagged,
not hidden*. The UI must speak the same dialect: every money figure that can still move carries
a state chip (Taxminiy / Qisman / Qotirilgan; Aniqlanmagan as a loud violet "resolve me" state,
never a grey dash); voided/reversed rows render as visible storno pairs; a profit figure built
on provisional costs says so. **Never present a number as more settled than the ledger says it is.**

### P4 — Density for the desk, thumbs for the field

ADMIN and ACCOUNTANT sit at this software 8 hours a day: they get 13px tabular-numeral tables,
36px rows, URL-synced filters, column sorting, totals rows, keyboard chords (Ctrl+K palette
that finds *records*, G-chords for navigation, N for new). AGENT stands in a client's yard with
a phone: their five pages re-render as thumb-first card stacks with a bottom tab bar, a
44px-target order wizard, and their own debt-limit headroom always one glance away
(`GET /agents/me` — built, never called, now the top of their cockpit). CASHIER gets a
terminal: three giant buttons, a today feed, and a receipt printer. **One design system, three
ergonomic profiles — never a desktop table pinched onto a phone.**

### P5 — Typography and whitespace carry the hierarchy; color is reserved for meaning

The visual grammar is Stripe/Linear: near-monochrome surfaces, one restrained steel-blue brand,
weight/size/spacing doing the layout work — because in this app **color is a signal channel
with fixed semantics** (red = money at risk: overdue, negative profit, cashbox shortfall;
green = settled/final/in our favor; amber = provisional/waiting; violet = imported-unknown,
owner must resolve). A screen where every tag is a random AntD preset color has no alarm left
for the day the alarm matters. Borders are demoted: separation comes from spacing and subtle
surface shifts, and tables keep only horizontal hairlines.

---

# 2. App shell & navigation

## 2.1 Shell anatomy (desktop, ADMIN/ACCOUNTANT)

```
┌──────────┬────────────────────────────────────────────────────────────────┐
│          │  Header (48px): ⌘K search field · LiveBadge · 🌙 · Avatar      │
│  Sidebar ├────────────────────────────────────────────────────────────────┤
│  (240px, │  PageHeader (breadcrumb · title · meta chips · actions)        │
│  collaps.│────────────────────────────────────────────────────────────────│
│  to 56px)│  Content (max-width 1440px, 24px padding)                      │
│          │     — cockpit / list workbench / detail split-view             │
└──────────┴────────────────────────────────────────────────────────────────┘
```

- **Sidebar** — 240px, collapsible to 56px icon rail (state persisted). Same near-black navy
  surface in both themes (`#10161D`) so the brand frame is constant. Wordmark: a simple
  square-block glyph (SVG, no emoji) + «SmartBlok» in 15px/600. Nav is grouped by
  *job-to-be-done* (below), group labels 11px/600 uppercase letter-spaced `text-3`. Every item
  has an icon (collapsed rail stays legible). Active item: 3px steel-blue left bar +
  `rgba(91,147,179,.14)` fill — not a solid blue pill.
- **Header** — 48px, `surface` background, hairline bottom border. Left: a real **search
  button** styled as a 280px input ghost («Qidiruv… Ctrl+K») that opens the command palette —
  the current non-clickable grey hint is replaced. Center: nothing. Right: **LiveBadge**
  (socket state: green dot «Jonli» / amber «Ulanmoqda…» / grey «Oflayn — MA'LUMOT ESKI» with
  last-sync time; the current hardcoded LIVE tag dies), theme Switch, avatar chip
  (initial + name + **localized role label** from one shared ROLE map: Administrator /
  Buxgalter / Agent / Kassir — never the raw enum).
- **PageHeader** is part of the content scroll, not the shell: breadcrumb trail
  (`Buyurtmalar / ORD-000123`), 22px title, inline meta chips (status, date), right-aligned
  ActionBar. Every page has one; the current level-3-vs-level-4 title lottery ends.
- **No footer.** Print CSS removes sidebar+header wholesale (exists today, kept).

## 2.2 Command palette (Ctrl+K / ⌘K) — upgraded from nav-only to records + actions

Three result groups, searched in parallel as you type:

1. **Yozuvlar (records)** — clients by name/phone/alias (`GET /clients?search=`), orders by
   number (`GET /orders?search=`), payments by party — top 5 each, with balance/status chips
   inline. Enter opens the record.
2. **Amallar (actions)** — context verbs: «Yangi buyurtma», «To'lov qabul qilish»,
   «Zavodga to'lov», «Paddon qaytarish qabul qilish», «Chek chop etish»… When a record is
   highlighted, actions re-scope: highlighting client «Жамол Ургенч» offers
   «Yangi buyurtma — Жамол Ургенч». This is how a phone order starts in 2 keystrokes (§6a).
3. **Sahifalar (pages)** — the existing route list, role-filtered.

Recent items (last 8, localStorage) show before typing. Role-filtered: AGENT's palette only
sees own-scope records and their 5 pages; CASHIER's sees payments/expenses/kassa.

## 2.3 Global keyboard grammar (desk roles)

| Chord | Action |
|---|---|
| `Ctrl+K` | Palette (records / actions / pages) |
| `G` then `B` / `M` / `T` / `Q` / `K` | Go: Buyurtmalar / Mijozlar / To'lovlar / Qarzlar / Kassa |
| `N` | New (primary action of current page: order on /orders, payment on /payments…) |
| `/` | Focus the FilterBar search of the current list |
| `J` / `K`, `Enter` | Row down/up, open row (lists and inbox) |
| `E` | Edit (when the current detail allows it) |
| `Ctrl+P` | Print menu of the current document (order → waybill/invoice; client → akt sverki) |
| `Esc` | Close drawer/modal (never loses typed reason text — forms are controlled) |
| `?` | Shortcut cheatsheet overlay |

## 2.4 Navigation tree per role (exact items, Uzbek, in order)

### ADMIN

```
Ish stoli                          /            (cockpit + inbox)
— SAVDO —
Buyurtmalar                        /orders
Mijozlar                           /clients
Agentlar                           /agents
— MOLIYA —
To'lovlar                          /payments
Qarzlar                            /debts       (undiruv cockpit)
Kassa                              /kassa
Xarajatlar                         /expenses
— TA'MINOT —
Zavodlar                           /factories   (ichida: Bonus tab)
Mahsulotlar va narxlar             /products
Ta'minot tahlili                   /procurement (ichida: Marshrutlar tab)
— LOGISTIKA —
Moshinalar                         /vehicles
Paddonlar                          /pallets
— TAHLIL —
Hisobotlar                         /reports     (Svod · Reestr · Agent reytingi)
— TIZIM —
Foydalanuvchilar                   /users
Tizim sozlamalari                  /settings
Ma'lumotnomalar                    /references  (Hududlar · Yuridik shaxslar · Xarajat kategoriyalari)
Excel import                       /import
```

### ACCOUNTANT (Buxgalter)

Identical to ADMIN minus the TIZIM group, plus a read-only **Tizim sozlamalari** entry
(GET /settings already allows ACCOUNTANT — the values that constrain their daily work become
visible; every field disabled with an explainer). **Excel import disappears entirely** for
ACCOUNTANT — the nav/route/API permission drift (brief: high) is resolved by aligning the UI to
the API's ADMIN-only reality, from a single shared `PERMISSIONS` map consumed by nav, route
guards, and button visibility.

### AGENT (phone-first; desktop gets the same 5 items in the sidebar)

```
Ish stoli        /          (agent cockpit: own KPIs + limit headroom + own inbox)
Buyurtmalar      /orders    (own)
Mijozlar         /clients   (own)
Qarzlar          /debts     (own)
To'lovlar        /payments  (own CLIENT_IN)
```

On phones this renders as a **bottom tab bar**: Ish stoli · Buyurtmalar · ➕ (yangi buyurtma,
raised center button) · Mijozlar · Qarzlar. Paddonlar has no tab — pallet balances live on the
client card and in the cockpit. Profil via the header avatar.

### CASHIER (Kassir)

```
Kassa terminali   /          (cashier cockpit)
To'lovlar         /payments
Xarajatlar        /expenses
Kassa jurnali     /kassa
```

## 2.5 Where global things live

- **Search / palette:** header (button) + Ctrl+K everywhere.
- **Notifications:** none as a bell-feed (restraint §10) — realtime is expressed as live count
  changes on worklist cards and the LiveBadge. A toast appears only for *your own* action results.
- **Theme:** header switch; both themes first-class (all tokens defined in §4 for both).
- **Print:** a `Chop etish` split-button on OrderDetail (Yuk xati / Hisob-faktura), payment
  drawer (Kvitansiya), ClientDetail & Debts row (Akt sverki). Ctrl+P opens the same menu.
- **Session:** avatar → Profil / Chiqish. Role label localized.

---

# 3. Information architecture

## 3.1 Full route tree with role access

Roles: **A** = ADMIN, **B** = ACCOUNTANT (Buxgalter), **G** = AGENT (server-scoped to own),
**K** = CASHIER. `(own)` = agent row-scoping applies server-side; UI mirrors it.

| Route | A | B | G | K | Screen |
|---|---|---|---|---|---|
| `/login` | pub | pub | pub | pub | Login |
| `/` | ● | ● | ●(own) | ● | **Cockpit** — three variants by role (Ish stoli / Agent cockpit / Kassa terminali) |
| `/orders` | ● | ● | ●(own) | — | Orders workbench (status tabs + worklist chips + table) |
| `/orders/new` | ● | ● | ● | — | Order composer (client-first, split view) |
| `/orders/:id` | ● | ● | ●(own) | — | Order detail split-view |
| `/orders/:id/edit` | ● | ● | — | — | **NEW** — order edit (PUT /orders/:id; NEW/CONFIRMED + PROVISIONAL only) |
| `/clients` | ● | ● | ●(own) | — | Clients list + filters |
| `/clients/:id` | ● | ● | ●(own) | — | Client hub (statement · orders · payments · pallets · prices · aliases) |
| `/payments` | ● | ● | ●(own CLIENT_IN) | ● | Payments register + kind chips + reconcile queue view |
| `/payments/:id` | ● | ● | ●(own) | ● | **NEW as URL** — list + detail drawer opened by route (deep-linkable) |
| `/debts` | ● | ● | ●(own) | — | Undiruv cockpit (summary band + aging board) |
| `/pallets` | ● | ● | ●(own, read) | — | Pallet ledger (balances + movements) |
| `/kassa` | ● | ● | — | ● | Treasury (boxes + one period control + journal) |
| `/expenses` | ● | ● | — | ● | Expenses (+ totals, category chips) |
| `/factories` | ● | ● | — | — | Factories (tabs: Ro'yxat · **Bonus**) |
| `/factories/:id` | ● | ● | — | — | **Factory settlement hub** (actions + statement + bonus + pallets) |
| `/products` | ● | ● | — | — | Catalog + price book (bulk price editor drawer) |
| `/procurement` | ● | ● | — | — | Tabs: Matritsa · **Marshrutlar** (routes CRUD — POST /procurement/routes) |
| `/vehicles` | ● | ● | — | — | Fleet list |
| `/vehicles/:id` | ● | ● | — | — | **NEW** — Driver settlement hub (GET /vehicles/:id) |
| `/agents` | ● | ● | — | — | Agents list |
| `/agents/:id` | ● | ● | — | — | Agent performance card (+ month picker) |
| `/reports` | ● | ● | — | — | Tabs: Svod · Buyurtmalar reestri · **Agent reytingi** (?month=) |
| `/import` | ● | — | — | — | Excel import (stepper) — **ADMIN only, matching the API** |
| `/users` | ● | — | — | — | Users |
| `/settings` | ● | ro | — | — | Settings (ACCOUNTANT read-only — GET is already allowed) |
| `/references` | ● | ● | — | — | Tabs: Hududlar · Yuridik shaxslar · Xarajat kategoriyalari |
| `/profile` | ● | ● | ● | ● | Profile (single editable card) |
| `/print/waybill/:orderId` | ● | ● | ●(own) | — | Yuk xati (print route, §9) |
| `/print/invoice/:orderId` | ● | ● | ●(own) | — | Hisob-faktura |
| `/print/receipt/:paymentId` | ● | ● | ●(own) | ● | Kvitansiya |
| `/print/statement/:clientId?from&to` | ● | ● | ●(own) | — | Akt sverki (solishtirish dalolatnomasi) |

**URL-synced filters everywhere:** every list page serializes its full filter state
(status tab, search, party ids, date range, page, sort, density, `reconciled`, worklist chip)
into `?search` params via a shared `useUrlFilters` hook. Back button restores context; URLs are
shareable; every KPI/worklist drill-down is *just a link* to a filtered URL. This single hook
retires the "filter amnesia" pain point globally.

## 3.2 What merges, splits, or dies (all 26 current pages accounted for)

| Current page | Fate |
|---|---|
| `Dashboard.tsx` | **Splits into three cockpits** rendered at `/` by role: Ish stoli (A/B), Agent cockpit (G), Kassa terminali (K). KPI wall → tiered KpiBand + Inbox; ranking moves to /reports (kept as a compact cockpit card with a link). |
| `Orders.tsx` | Stays at /orders; gains worklist chips (Narxlanmagan · Moshinasiz · Transport aniqlanmagan), URL filters, totals footer, row actions, sorting. |
| `NewOrder.tsx` | Rebuilt as the **Order composer** (client-first split view); same route. Also reused (pre-filled) by `/orders/:id/edit`. |
| `OrderDetail.tsx` | Rebuilt as split-view workbench; gains Edit, assign-vehicle-inline, status menu (skip/back w/ note), print split-button, exposure-based progress. |
| `Payments.tsx` | Stays; the 961-line morphing modal is replaced by the **PaymentLauncher** (kind-first) + **AllocationEditor**; detail drawer becomes URL-addressable `/payments/:id`; adds `?reconciled=false` queue view and per-kind filtered totals. |
| `Kassa.tsx` | Stays; unified single period control; box cards become scoping filters; journal rows link to source documents. |
| `Debts.tsx` | Becomes the **Undiruv cockpit**: aging buckets, expandable client rows (open orders + due dates), row-level «To'lov olish» and «Akt sverki» actions. |
| `Pallets.tsx` | Stays; row-launched actions with current/post-action balance in the modal; date+type filters, totals footer. |
| `Clients.tsx` | Stays; gains structured FilterBar (region/agent/status/balance-state), credit-utilization column, reactivate action. |
| `ClientDetail.tsx` | Becomes a party hub: header ActionBar (Yangi buyurtma · To'lov olish · Akt sverki), full-history tabs linking to filtered registers. |
| `Factories.tsx` | Stays as tab 1 of /factories; **absorbs /bonus overview as tab 2** (wallet cards + program badges + journal). |
| `FactoryDetail.tsx` | Becomes the **factory settlement hub** — hero workflow (c) lives here. |
| `Bonus.tsx` | **Dies as a top-level page.** Route `/bonus` 301-redirects to `/factories?tab=bonus`. All actions move into wallet cards + FactoryDetail. |
| `Products.tsx` | Stays; price columns gain effective dates + upcoming-price badges; **bulk price editor** drawer (factory × 3 kinds grid, one effectiveFrom, N versioned inserts). |
| `Procurement.tsx` | Stays as tab 1; **Marshrutlar tab added** (versioned routes list + create — API exists); matrix groups by product; dropped-row reasons deep-link to the fix. |
| `Vehicles.tsx` | Stays; rows click through to **new `/vehicles/:id`**. |
| `Agents.tsx` / `AgentDetail.tsx` | Stay; detail gains edit access + month picker (dashboard ranking endpoint with ?month). |
| `Reports.tsx` | Stays; + Agent reytingi tab; Svod agent blocks expanded by default with sticky subtotals and hyperlinked parties; register gains server-fed totals row + column presets. |
| `Expenses.tsx` | Stays; + filtered totals, category chips, voided three-state filter; category management moves to /references. |
| `Import.tsx` | Rebuilt as a 4-step stepper (Yuklash → Tekshiruv → Import → Solishtirish); ADMIN-only; renders the invisible sheetGaps/explained-vs-unexplained triage. |
| `Users.tsx` | Stays; + search, role/status filters, email column, symmetric activate/deactivate. |
| `Settings.tsx` | Stays; per-field save states; saleMarginMinPct flagged «hozircha kuchga ega emas» until the owner decides. |
| `Regions.tsx`, `LegalEntities.tsx` | **Die as routes**; become tabs of `/references` (with Xarajat kategoriyalari as the third tab — rename/delete endpoints finally get a UI). Old routes redirect. |
| `Login.tsx` | Kept minimal; visual polish only (§7). |
| `Profile.tsx` | Deduplicated single editable card + email field + password card. |

## 3.3 The Inbox model (the cockpit's engine)

The **Inbox (E'tibor kerak)** is a stack of WorklistCards. Each is defined by: a *query* over
existing endpoints, a *count*, a *top-3 preview*, and a *drill URL*. At this business's scale
(2–4 trucks/day, ~20–40 active clients) queues that lack a dedicated server filter are derived
client-side over a bounded window (e.g. non-terminal orders, or last 90 days — one or two pages
of existing list endpoints), which is honest, cheap, and requires zero new API.

| Worklist (Uzbek title) | Definition (existing API) | Drill target | Roles |
|---|---|---|---|
| **Taqsimlanmagan to'lovlar** | payments where Σ active allocations < amount (kinds CLIENT_IN/FACTORY_OUT/VEHICLE_OUT/TRANSPORT_DIRECT, voided=false) | `/payments?alloc=open` (URL chip; client-derived) | A B |
| **Narxlanmagan buyurtmalar** | non-cancelled orders containing pricePending items | `/orders?chip=unpriced` | A B |
| **Moshina biriktirilmagan** | orders status=CONFIRMED with vehicleId=null (blocked from LOADING) | `/orders?status=CONFIRMED&chip=novehicle` | A B |
| **Tekshirilmagan to'lovlar** | `GET /payments?reconciled=false` (server filter exists) | `/payments?reconciled=false` | A B |
| **Muddati o'tgan qarzlar** | `GET /debts/clients` rows with hasOverdueOrders | `/debts?chip=overdue` | A B G(own) |
| **Transport aniqlanmagan** | orders transportPaidStatus=UNKNOWN (imported blanks) | `/orders?chip=transport-unknown` | A B |
| **Shofyorlarga qarz** | vehicles with negative balance (list payload) | `/vehicles?chip=owed` | A B |
| **Tannarx qotirilmagan** | COMPLETED orders with costStatus ≠ FINAL older than 7 days | `/orders?status=COMPLETED&chip=cost-open` | A B |
| **Limit chegarasida** | debts/clients rows where balance ≥ 80% of creditLimit | `/clients?chip=near-limit` | A B |
| **Bugun muddati kelganlar** (agent) | own debts rows dueWithinWindow(days=1..7) | `/debts?window=7` | G |

Card anatomy and states in §5. Counts update live via the existing socket invalidation.


---

# 4. Design language

All values are concrete and map to AntD v6 `ConfigProvider` tokens plus one small custom CSS
layer (`design.css`, replacing today's 47-line index.css). Both themes are specified fully;
`data-theme` drives non-token CSS custom properties.

## 4.1 Color system

### Brand & interaction

| Token | Light | Dark | Usage |
|---|---|---|---|
| `primary` | `#2E6584` | `#5B93B3` | Buttons, links, focus, active nav bar, selected states |
| `primary-hover` | `#27566F` | `#74A6C2` | Hover on primary |
| `primary-active` | `#1F4759` | `#8FB7CE` | Pressed |
| `primary-subtle` | `#E3EEF4` | `rgba(91,147,179,.16)` | Selected row/nav fill, info chips |
| `primary-border` | `#B7CFDD` | `#33566B` | Focus ring base, selected outlines |

Kept deliberately close to the existing steel blue — the brand is already right: enterprise,
not flashy. `colorInfo = primary`.

### Semantic (fixed meanings — never used decoratively)

| Token | Light | Dark | Meaning in SmartBlok |
|---|---|---|---|
| `success` | `#1A7F37` | `#46B36B` | Settled, FINAL cost, PAID, Avans (in our favor), identity check = 0 |
| `danger` | `#B42318` | `#F0716A` | Overdue debt, negative profit, cashbox shortfall, void/cancel, UNPAID |
| `warning` | `#B45309` | `#DFA04A` | Provisional/PARTIAL, due-soon, flagged (Tekshirilsin), capacity near-full |
| `violet` | `#6D5BD0` | `#9B8CF0` | **Imported-UNKNOWN states only** (transport UNKNOWN, workbook-defect-explained) — a reserved "owner must resolve" channel that nothing else may use |
| `info` | = primary | = primary | Neutral informational alerts |

Fills for chips: 12% alpha of the base over `surface`; text at the full-strength value; no
solid-colored tags except the violet resolve-me chip and danger `Bekor qilingan`.

### Surfaces & text

| Token | Light | Dark |
|---|---|---|
| `bg` (layout) | `#F6F7F9` | `#0E1116` |
| `surface` (cards, tables, header) | `#FFFFFF` | `#151A21` |
| `surface-raised` (drawers, popovers, palette) | `#FFFFFF` + e2 shadow | `#1B222B` |
| `surface-sunken` (input wells, statement zebra) | `#F0F2F5` | `#11151B` |
| `sidebar` | `#10161D` (both themes) | `#10161D` |
| `border` | `#E4E7EC` | `#262E38` |
| `border-strong` | `#D0D5DD` | `#333D4A` |
| `text-1` | `#1A202B` | `#E7ECF2` |
| `text-2` | `#5A6472` | `#A6B0BD` |
| `text-3` (captions, group labels) | `#8B94A3` | `#6F7A88` |

Contrast: all text/semantic pairs verified >= 4.5:1 on their surfaces (danger/success on
subtle fills use the full-strength ink values above, not the fill color).

### Money color rules (the app's most important convention)

- Positive client balance (**bizga qarzi**) = `danger` ink **only on Debts/collections
  surfaces and when overdue**; elsewhere (statements, pickers) it is `text-1` with an explicit
  `Qarz` BalancePill — red everywhere would blind the alarm channel (P5).
- Negative client balance (**avansi**) = `success` ink + `Avans` pill.
- Factory balance: >0 = `Avansimiz` (success), <0 = `Qarzimiz` (danger). Vehicle: <0 =
  `Shofyorga qarzimiz` (warning — a normal operating liability, not an emergency).
- Profit figures: sign-colored (success/danger), always labeled which profit
  (Mahsulot foydasi / Transport foydasi — never merged, locked rule).
- |balance| < 1 UZS renders as `0 so'm` + grey `Yopilgan` pill (isSettled rule).

### Chart palette (@ant-design/plots, CVD-safe, theme-aware)

Series order: `#2E6584` (savdo), `#B47A00` (yig'ilgan), `#6D5BD0` (accent 3), `#5A6472`
(neutral 4). Dark: `#5B93B3`, `#DFA04A`, `#9B8CF0`, `#A6B0BD`. Grid lines `border` color;
axis labels `text-3` 11px; tooltips show exact `fmtUZS` values.

## 4.2 Typography

Font stack: `'Inter Variable', Inter, 'Segoe UI Variable Text', 'Segoe UI', system-ui,
-apple-system, sans-serif` — Inter bundled locally via `@fontsource-variable/inter` (no CDN);
Segoe fallback keeps current Windows rendering acceptable if the bundle fails.
`font-feature-settings: 'tnum' 1` on every numeric cell (class `.num` retained).

| Style | Size/Line | Weight | Usage |
|---|---|---|---|
| `display` | 28/34 | 650 | Cockpit hero money figures |
| `h1` | 22/28 | 650 | Page titles (PageHeader) |
| `h2` | 17/24 | 600 | Card/section titles |
| `h3` | 15/22 | 600 | Sub-sections, drawer titles |
| `body` | 14/22 | 400 | Forms, prose, descriptions |
| `body-strong` | 14/22 | 600 | Emphasis, primary cell values |
| `table` | 13/20 | 400 | All data tables (desk density) |
| `caption` | 12/16 | 400 | Meta, helper text, timestamps |
| `overline` | 11/14 | 600, +0.06em, uppercase | Nav group labels, KPI labels, statement section heads |
| `money-lg` | 20/26 | 650 tabular | Balances on detail headers |

Mobile (AGENT): `table` style is not used — cards use `body`/`body-strong`; touch labels
never below 13px.

## 4.3 Spacing, radius, elevation

**Spacing scale (px):** 2 - 4 - 8 - 12 - 16 - 24 - 32 - 48 - 64. Page padding 24 (desktop),
16 (<=1024px), 12 (phone). Card padding 20 (16 compact). Vertical rhythm between cards 16;
between page sections 24. Form field gap 16 vertical, 12 horizontal. Related controls in a
FilterBar: 8.

**Radius:** inputs/buttons 6 - cards 10 - modals/drawers 12 - chips/tags 4 - pills/badges 999
- table container 10 (cells square).

**Elevation:**

| Level | Light | Dark |
|---|---|---|
| e0 | border only | border only |
| e1 (cards) | `0 1px 2px rgba(16,24,40,.05)` | none — surface shift instead |
| e2 (drawers, dropdowns, sticky bars) | `0 4px 16px rgba(16,24,40,.10)` | `0 4px 16px rgba(0,0,0,.45)` + `surface-raised` |
| e3 (modals, palette) | `0 16px 48px rgba(16,24,40,.18)` | `0 16px 48px rgba(0,0,0,.6)` |

Rule: elevation communicates *temporariness* (overlays) — persistent surfaces separate by
spacing and `border`, not shadow stacking.

## 4.4 Motion

| Token | Value | Applies to |
|---|---|---|
| `fast` | 100ms, ease-out | Hover fills, focus rings, checkbox/switch |
| `base` | 180ms, `cubic-bezier(0.2, 0, 0, 1)` | Dropdowns, popovers, tab ink, chip toggles, row expand |
| `overlay` | 240ms, same curve | Drawer slide, modal fade + 4px rise, palette |
| `count` | 300ms | Worklist count ticker (old digit slides up) — the only "delight" animation |
| skeleton | 1.2s linear shimmer | Loading states |

Never animated: table data swaps (keepPreviousData + a 2px progress hairline under the
PageHeader during refetch), money values (except the inbox ticker), route transitions, charts
after first paint. `prefers-reduced-motion` collapses everything to 0ms except opacity fades.

## 4.5 Tables (the desk workhorse)

- Density: default row 36px (13px text, 8px vertical padding); `Kompakt` toggle 30px persisted
  per user; AGENT mobile never renders these tables (card lists instead).
- Header: 32px, `surface-sunken`, 12px/600 `text-2`, sticky within the card.
- Only horizontal hairlines (`border`); no vertical rules; zebra OFF by default (statement
  tables ON with `surface-sunken` at 40% for scanability of running balances).
- Numeric columns right-aligned tabular; money columns never wrap; the column header carries
  the unit («Savdo, so'm» - «Hajm, m³») so cells stay bare numbers.
- Row hover: `primary-subtle` at 40%; whole row clickable when a detail exists (cursor
  pointer + chevron ghost on hover); explicit actions live in a trailing kebab menu with
  *labeled* items (icon-only buttons die).
- Sorting: server-driven `?sort=field:dir` on money/date/count columns (arrow in header).
- **Totals row**: pinned summary for the *entire current filter* (server aggregate where the
  API returns one, e.g. debts expectedCollections; client-side sum of the loaded window
  labeled «sahifa jami» when only page data exists — the label must always say which).
- Voided/cancelled rows: 60% opacity + strikethrough on the amount only, `Bekor qilingan`
  chip, default-hidden behind a three-state filter (Yashirish / Ko'rsatish / Faqat).

## 4.6 Numbers, money, dates

- Money: space-grouped ru-RU digits, whole so'm (`1 249 547 319`), suffix `so'm` only in
  headers/KPIs/prose — never repeated in every cell. Minus is a true minus (U+2212).
- Abbreviation (`1,25 mlrd`) is allowed ONLY on cockpit hero cards and always with the exact
  value as a permanent 12px secondary line beneath — never hover-only (touch rule).
- Per-m³ prices display 2dp trimmed with the exact 6dp value in tooltip; volumes 3dp
  (`32,832 m³`); pallets are integers with `dona`.
- USD: `$1 200 × 12 650 = 15 180 000 so'm` — the computation always shown, never editable
  (server computes; locked rule).
- Dates `DD.MM.YYYY`, datetimes `DD.MM.YYYY HH:mm`, relative stamps («3 kun oldin») only in
  activity feeds with the absolute date in tooltip. All range filters state their Tashkent-day
  basis in the picker footer.
- Locale: AntD `uz_UZ` + dayjs `uz-latn` (ends the Russian pagination/pickers inside an Uzbek
  UI). Number formatting stays ru-RU-style space grouping (matches existing lib/format.ts).

## 4.7 Iconography & illustration

`@ant-design/icons` outlined set only, 16px in tables/menus, 20px in headers. No emoji in
product UI (the brick emoji wordmark is replaced by an SVG glyph). Empty states: no
illustrations — a 20px icon, one sentence, one action button («Hali to'lovlar yo'q —
To'lov qabul qilish»).

---

# 5. Component system

Named, reusable, and deliberately few. Each entry: purpose -> anatomy -> states. All are AntD
compositions (no new UI library).

### 5.1 `AppFrame`
Shell described in §2.1. Owns sidebar collapse state, LiveBadge socket state, palette mount,
and the role->nav map. States: expanded/rail; online/reconnecting/offline (offline adds a
persistent amber top hairline «Oflayn — ma'lumot 12:41 holatiga ko'ra»).

### 5.2 `PageHeader`
Every page's first block. Anatomy: breadcrumb (linked ancestors) -> title row (h1 + status
chips + meta) -> optional sub-line (caption) -> right ActionBar (1 primary + overflow kebab)
-> optional tab strip. Sticky variant for detail pages (condenses to 40px: breadcrumb + title
+ actions) so lifecycle actions never scroll away. States: default, sticky-condensed, loading
(skeleton title).

### 5.3 `FilterBar`
URL-synced filter strip under the PageHeader tabs. Anatomy: search input (`/` focuses,
300ms debounce, server-side) -> typed filter chips (party selects, date RangePicker with
presets Bugun/Hafta/Oy/Chorak) -> three-state voided toggle where relevant -> active-filter
pills with × clear -> «Tozalash». Overflow folds into a «Filtrlar +N» popover. Every change
writes `?params` (replaceState) and resets page=1. States: idle, active (pill row visible),
overflowed.

### 5.4 `DataTable`
The §4.5 table contract as one component: server pagination/sorting, density toggle, totals
row slot, row-click routing, kebab actions, voided-row rendering, export button slot
(xlsx where the backend has it — reports; CSV-of-current-page elsewhere, honestly labeled).
States: loading (skeleton rows ×8), refreshing (header hairline), empty (EmptyState), error
(inline Alert + Qayta urinish).

### 5.5 `WorklistCard`
The cockpit's atom. Anatomy: overline title + live count (ticker) -> top-3 preview rows
(compact: party - figure - age) -> footer link «Barchasi →» (drill URL). Count badge colors by
queue semantics (danger for overdue, warning for provisional, violet for UNKNOWN). Clicking a
preview row opens the record directly; clicking the card header drills to the filtered list.
States: loaded, zero («Hammasi joyida» — zero states render green and *collapsed to one
line*, so a clean day is visibly clean), loading, error-inline.

### 5.6 `InboxRail`
Arranges WorklistCards: 2-column masonry on desktop cockpit, single column on mobile; order is
fixed by severity (danger queues first), zero-count cards sink to a collapsed «Toza» strip at
the bottom. Not user-configurable — the order is opinionated (P1).

### 5.7 `StatCard`
KPI tile. Anatomy: overline label -> money-lg/display value (exact, or abbreviated + exact
sub-line) -> delta chip vs previous period (↑ 12%, muted when n/a) -> 32px sparkline (trends
data) -> whole card is a link (drill URL). States: default, negative (value in danger ink),
loading, link-hover (border -> primary-border).

### 5.8 `KpiBand`
A horizontal band of 3 hero StatCards + up to 6 secondary compact stats (label + value only,
no sparkline). Used on cockpit, Debts, Kassa, Reports headers. Secondary stats are also links.

### 5.9 `Money` / `MoneyCell`
The existing atom, extended: value (tabular), optional sign coloring, optional unit, settled
rendering (<1 UZS -> `0`), USD variant showing the ×rate math, and a `state` prop that appends
a CostStatus/Provisional chip when the figure is not yet final (P3).

### 5.10 `BalancePill`
Human framing of signed balances: `Qarz 4 200 000` (danger tint) / `Avans 1 300 000`
(success) / `Yopilgan` (grey). Direction ALWAYS from the dealer's viewpoint, with the party
type resolving the words: client -> Qarzi/Avansi, factory -> Qarzimiz/Avansimiz,
vehicle -> Shofyorga qarzimiz. Kills the raw-minus-sign cognitive tax everywhere.

### 5.11 `CreditGauge`
Client credit headroom. Anatomy: mini progress (balance vs creditLimit) + caption
«Limit: 10 mln - Bo'sh joy: 3,2 mln». Colors: <60% neutral, 60–90% warning, >90% danger;
`Cheklanmagan` renders as plain text; `0 — faqat oldindan to'lov` as a danger note. Also an
agent variant for `GET /agents/me` (outstanding vs debtLimit). Used in: client picker
dropdowns, ClientDetail header, Order composer rail, agent cockpit. States: ok / near /
blocked / unlimited / loading.

### 5.12 `PartySelect`
One shared, server-searched, paginated async select for client/factory/vehicle/legal-entity
(replaces five hand-rolled ones and the 200-row cap). Option row: name - secondary line
(agent/region or plate/driver) - right-aligned BalancePill. Never silently truncates: shows
«… yana N ta — qidiruvni aniqlashtiring». States: idle, searching, empty (+ inline «Yangi
qo'shish» where role allows).

### 5.13 `PartyStatement`
The running-balance ledger view used by Client/Factory/Vehicle hubs and the akt sverki print.
Anatomy: period FilterBar -> opening balance row (pinned) -> entries (date - source label from
ONE shared LEDGER_SOURCE map - linked document - note - signed amount - running balance) ->
closing balance row (pinned). Reversal pairs render linked: a storno glyph and shared hover
highlight between original and reversal, netting explained in the tooltip. TRANSPORT_DIRECT
rows render their double effect in words: «Mijoz shofyorga to'ladi — mijoz krediti + shofyor
hisobi yopildi». States: loading, empty period, exporting/printing.

### 5.14 `AllocationEditor`
The settlement panel — the redesign's most important new surface (drives cost finalization,
aging, transport status). Anatomy: header (payment amount - allocated - **qoldiq** live) ->
party's open orders table (order no - date - the figure that matters: sale outstanding /
uncovered cost / transport cost qoldig'i - current status chip) -> per-row amount inputs
(pre-filled with the row's remainder) -> «Avto-taqsimlash (eskisidan boshlab)» button (fills
oldest-first until the payment is exhausted) -> consequence preview line per row (FACTORY_OUT:
«PARTIAL -> FINAL, zavod naqd narxi qo'llanadi»; VEHICLE_OUT: «Transport: To'langan bo'ladi»)
-> footer (Σ vs payment guard — over-allocation disables save with the exact excess). Reached
from: the payment drawer («Taqsimlash»), FactoryDetail, VehicleDetail, OrderDetail payments
tab, and the Taqsimlanmagan worklist. States: balanced, remainder>0, over-allocated (blocked),
read-only (CASHIER/AGENT see allocations but no editor — locked rule).

### 5.15 `StatusFlow`
Order lifecycle strip. Anatomy: 6 compact steps with dates/actors underneath -> **blocker
chips rendered on the step that needs them** («Moshina biriktirilmagan» on Yuklash, with an
inline assign action) -> right side: the single legal next-action button for the role
(verb-labeled) + a privileged overflow menu (skip forward… / bir qadam orqaga — with mandatory
note field, per API). Cancelled replaces the strip with a danger banner + reason + a link to
the netting reversal entries. States: on-track, blocked (amber step), cancelled, completed
(bonus accrual note: «Bonus hisoblandi: 125 000»).

### 5.16 `DetailScaffold`
Two-column workbench for detail pages: left = content column (940px max: items, tabs,
statement); right = 320px sticky **side rail** (financial summary card, state chips, quick
actions, related links). Collapses to single column under 1200px with the rail becoming a top
summary strip. Used by OrderDetail, ClientDetail, FactoryDetail, VehicleDetail, order
composer. States: default, rail-collapsed.

### 5.17 `ReasonModal`
The one blessed destructive-confirm: controlled Form (never a closure-variable TextArea),
required reason with inline validation, **impact preview list** built from the record
(«3 ta taqsimot bekor bo'ladi - tannarx PROVISIONAL holatiga qaytadi - bonus 125 000
storno»), danger button disabled until valid. Variants: cancel order, void payment, void
expense, kassa storno, bonus reversal, ROLLBACK-typed import rollback (single modal, typed
word + deletion counts). States: invalid, valid, submitting.

### 5.18 `PaymentLauncher`
Kind-first payment entry replacing the morphing 720px modal. Step 0 is a verb chooser (six
cards): «Mijozdan qabul qilish» - «Mijozga qaytarish» - «Zavodga to'lash» - «Zavoddan qaytim»
- «Shofyorga to'lash» - «Mijoz shofyorga to'ladi». Choosing a verb opens a *stable* form
(party -> amount/method -> cashbox -> note -> allocations for A/B) — kind never morphs
mid-form, so nothing is silently wiped. Context launches (from Debts row, client hub, factory
hub, vehicle hub) skip step 0 with party + amount pre-filled. USD method remembers the last
used rate (localStorage) and shows the server-computed preview. TRANSPORT_DIRECT hides the
cashbox and shows the double-effect info line. Idempotency key per open (kept). Cashbox
options always show live balances; OUT shortfalls surface the server's exact figure.

### 5.19 `PalletCounter`
In-kind balance chip: `12 dona` (orange when >0), used beside money balances on client rows,
hubs, and order detail. Its action popover shows delivered/returned/lost math and launches the
right pallet modal with the party pre-filled and **current -> post-action balance** preview
(warn, don't block, on negative).

### 5.20 `LiveBadge`
Header socket indicator bound to real connection state + last event time. States: jonli
(green dot), ulanmoqda (amber pulse), oflayn (grey + timestamp + refetch-on-focus fallback
enabled).

### 5.21 `MoneyInput`
One shared input (ends the copy-pasted formatter/parser): space-grouping while typing,
so'm suffix, min/max, 2dp cap, Enter submits the owning form. USD variant pairs amount + rate
with the computed UZS line.

### 5.22 `PrintDocument`
Print-route scaffold (§9): loads the record via existing GET, renders a paper-layout DOM,
auto-opens the browser print dialog, `@media print` strips chrome. Toolbar (screen only):
copy count, «Diler rekviziti» select (from active DEALER legal entities), back link.

### 5.23 `RoleBadge` + `StatusChip` family
One shared map file: role labels/colors, ORDER_STATUS, COST_STATUS, TRANSPORT_PAID,
PAYMENT_KIND/METHOD, LEDGER_SOURCE — consumed by every screen and print doc (ends the
Buxgalter/Hisobchi drift and the raw enum leaks in kassa/ledger views).

### 5.24 `EmptyState`, `ErrorState`
Standardized: icon + one sentence + one action; error always includes «Qayta urinish» and the
server's Uzbek message. The 403 page gains «Bosh sahifaga qaytish».

---

# 6. The five hero workflows, redesigned step-by-step

Each flow lists: entry points, every screen state, every field, the keyboard path, and what
the user sees at each moment. All server behavior is the existing API, untouched.

---

## 6a. Create an order for a client who is on the phone with an agent

**Persona:** ACCOUNTANT at the desk; the agent calls in a truck order for client «Жамол
Ургенч». (The AGENT-on-phone variant of this same flow is in §8.)

**Entry (2 keystrokes + a name):** `Ctrl+K` → type `jam` → palette shows the client record
with its BalancePill (`Qarz 4 200 000`) → arrow-down to the scoped action row
**«Yangi buyurtma — Жамол Ургенч»** → Enter. Lands on `/orders/new?clientId=…` with the
client locked in. (Mouse path: Buyurtmalar → Yangi buyurtma → PartySelect; or ClientDetail →
header action.)

**Screen: Order composer** — DetailScaffold: left = the form, right = sticky **Xulosa rail**.
The rail is alive from second zero because the client is known:

```
XULOSA (sticky rail)
Mijoz: Жамол Ургенч            [Qarz 4 200 000]
CreditGauge: ████████░░ 78% — Bo'sh joy: 2 800 000
Paddonlar: 12 dona · Muddati o'tgan: yo'q
─────────────────────────────
Yuk:  0 / 19 paddon · 0 m³        (capacity bar)
Mahsulot: 0 so'm
Transport: —
─────────────────────────────
MIJOZ QARZIGA YOZILADI:  0 so'm
Saqlashdan keyingi balans: 4 200 000
```

**Step 1 — Sarlavha (header row):** client (pre-filled, changeable), business date (default
today), **intended factory-payment method** segmented control `O'tkazma (bank) / Naqd` with a
caption «taxminiy tannarx shu narxda hisoblanadi» — the provisional-cost consequence is
explained at the point of choice, not discovered later.

**Step 2 — Mahsulotlar (items):** a keyboard-friendly line grid, not nested cards.
Each row: product (type-ahead; after the first pick the catalog **auto-scopes to that
factory** with a header chip «Zavod: CAOLS KS ✕» — the single-factory rule is built into the
control, not an error banner) → paddon (integer stepper) → m³ (auto = paddon × m3PerPallet,
badge `avto`; typing your own flips the badge to `qo'lda` and autofill stops overwriting —
fixes the silent-overwrite bug) → pricing segmented control: `Katalog / Kelishilgan /
Umumiy summa / Narxsiz*` (*A/B only) → price field per mode → row total.
Under the price field the effective catalog price renders with its source:
«Katalog: 732 542 so'm/m³ · **maxsus narx amal qiladi**» (the composer fetches the client's
ClientPrice rows — an existing endpoint — so the estimate finally matches the server for
special-price clients; still labeled «taxminiy — server tasdiqlaydi»). For AGENT the floor is
shown proactively: «Eng past: 625 000 (zavod bank narxi)» and the input clamps with an inline
error rather than a submit surprise. `Enter` on the last cell adds the next row; `Ctrl+Backspace`
deletes a row.

**Step 3 — Transport:** vehicle PartySelect (plate · driver · capacity · BalancePill of the
driver) — picking it fills driverName *only if untouched*; capacity bar in the rail updates
(19/19 turns the bar amber at 90%, red + submit-block at overflow, with the exact overflow
count). Mode segmented: `Mijozning o'z transporti / Dilerning hisobidan / Mijozdan olinadi`.
Cost/charge MoneyInputs appear per mode; DEALER_CHARGED shows live «Transport foydasi:
+150 000». **Guard:** transportCost > 0 with no vehicle raises a blocking inline warning
(«Shofyor qarzi hisobga olinmaydi — moshina tanlang yoki tasdiqlang») requiring an explicit
checkbox — the untracked-driver-debt hole is closed at the UI.

**Step 4 — Izoh** (optional textarea), then **`Ctrl+Enter` yoki «Buyurtma yaratish»**.
The rail has been continuously showing the two numbers that matter: *MIJOZ QARZIGA YOZILADI*
(saleTotal + transportCharge — debt-at-creation made explicit, per the locked rule) and the
post-save balance vs limit. If the gauge is in the red, the submit button carries a warning
tone but stays enabled — the server's row-locked check is authoritative, and its error
(with limit/current/new figures) renders verbatim under the button.

**After save:** toast «ORD-000123 yaratildi», navigate to `/orders/:id`. StatusFlow shows NEW
with the next action «Tasdiqlash» focused; the side rail offers «Chop etish ▾» (Yuk xati /
Hisob-faktura) — the agent can be told the order number while the invoice prints.
Total: ~20 seconds of typing for a 2-item truck, zero page switches, zero re-search.

---

## 6b. Collect a payment on a debt, from the Debts view

**Persona:** ACCOUNTANT doing the daily undiruv sweep; client «Гофур Хазорасп» has come in
to pay 5 000 000 cash.

1. `G` `Q` → `/debts`. The Undiruv cockpit (§7) shows the client table sorted by debt desc;
   the FilterBar search or `/` + `gof` finds the row: balance `Qarz 8 340 000` (danger — it
   carries the `Muddati o'tgan · 2 ta buyurtma · 6 200 000` chip), pallets `7 dona`,
   window chip `7 kun ichida`.
2. Row expand (`Enter` or chevron) shows the client's open orders inline: order no · date ·
   due date (overdue in danger) · outstanding — no page switch to understand what the 8.3M
   consists of. Row actions: **«To'lov olish»** · «Akt sverki» · «Mijoz kartasi».
3. **«To'lov olish»** opens the PaymentLauncher directly in the CLIENT_IN form (step 0
   skipped, client pre-bound):
   - Summa: MoneyInput, **pre-filled 8 340 000** (the full balance) — the accountant types
     `5000000` over it. Quick chips beneath: `To'liq qarz` · `Muddati o'tgani (6,2 mln)`.
   - Usul: segmented `Naqd / O'tkazma / Click / Terminal / Karta / USD` (default: last used
     for this client). Kassa: auto-selected to the currency-matching box, its live balance
     shown («Naqd kassa — 12 450 000»).
   - **Taqsimlash (A/B only):** AllocationEditor is open inline, pre-run with
     auto-allocate-oldest-first: the two overdue orders get 4 100 000 and 900 000, remainder 0.
     Each row shows the order's outstanding before/after. The accountant can drag amounts, but
     the default is already right — this is what kills the "blind allocation" pain.
   - Izoh optional. `Ctrl+Enter` saves.
4. **Post-save moment:** the launcher's success state offers **«Kvitansiya chop etish»**
   (opens `/print/receipt/:paymentId` — §9.3) and «Yana to'lov». Behind it, the Debts row has
   already re-rendered via socket: balance `Qarz 3 340 000`, the overdue chip gone if covered.
   The Taqsimlanmagan worklist on the cockpit never even incremented, because allocation
   happened at entry.
5. **CASHIER variant:** identical launcher without the AllocationEditor (locked rule); the
   payment lands in the **Taqsimlanmagan to'lovlar** worklist, where the accountant later
   opens it (`/payments/:id`) and hits «Taqsimlash» — the previously UI-less
   `POST /payments/:id/allocations` finally has its surface.

Clicks from debt row to printed receipt: **4** (expand → To'lov olish → Ctrl+Enter → print).
Today it is ~12 across three pages.

---

## 6c. Settle with a factory: pay + allocate to orders + finalize cost + spend bonus

**Persona:** ADMIN, weekly settlement with «CAOLS KS» MCHJ.

**Entry:** `Ctrl+K` → `caols` → factory record → `/factories/:id` — the **factory settlement
hub** (P2). Header rail:

```
"CAOLS KS" MCHJ                       [Faol]
Balans:  Qarzimiz 42 500 000          (danger pill)
Bonus hamyon: 3 750 000               [PER_M3 · 5 000/m³ · 01.06 dan]
Paddon hisobi: bizda 214 dona
[ To'lov qilish ]  [ Taqsimlash ]  [ Paddon qaytarish ]  [ Bonus sarflash ▾ ]
```

Content tabs: **Ochiq buyurtmalar** (default — non-FINAL orders with uncovered cost) ·
Hisob-kitob (PartyStatement) · Bonus · Paddonlar · To'lovlar.

**Step 1 — Pay.** «To'lov qilish» opens PaymentLauncher in FACTORY_OUT with the factory
bound. Method choice displays its cost consequence inline, because method decides the price
kind: choosing `Naqd` shows «taqsimotlar **zavod naqd narxida** qotiriladi», `O'tkazma` shows
bank narxida. Amount 40 000 000 from «Bank (Септем Алока)» (box balance shown; shortfall would
render the server's exact figure). Save.

**Step 2 — Allocate.** The success state flows straight into the **AllocationEditor** (same
payment, factory scope). It lists the factory's open orders oldest-first with **uncovered
provisional cost** per row (`ORD-000098 · 04.07 · qoplanmagan: 18 400 000 · PROVISIONAL`).
«Avto-taqsimlash» fills rows until 40M is exhausted; the qoldiq counter live-updates to 0.
Each fully covered row shows its consequence line: «PROVISIONAL → **FINAL** — zavod bank
narxi, farq COST_ADJUSTMENT bilan yoziladi»; partially covered rows show «→ PARTIAL».
A footer note lists PERCENT-bonus re-derivations where relevant («ORD-000098: bonus
qayta hisoblanadi»). Save → per-order cost chips across the whole app flip via socket.

**Step 3 — Verify.** The hub's header balance ticks to `Qarzimiz 2 500 000`; the Hisob-kitob
tab shows the payment and the COST_ADJUSTMENT deltas as fresh statement rows with running
balance — the admin never leaves the page to confirm what happened.

**Step 4 — Spend bonus.** «Bonus sarflash ▾» → `Zavod qarziga o'tkazish` (or `Naqd yechish`).
The offset modal is pre-scoped to this factory, wallet refetched on open (stale-balance bug
fixed): «Hamyon: 3 750 000 · O'tkaziladi: [2 500 000] · Qoladi: 1 250 000». Info line explains
the canonical chain in words: «BONUS usulidagi zavod to'lovi yaratiladi — kassaga tegmaydi».
Save → balance pill flips to `Yopilgan`, wallet 1 250 000. A `Naqd yechish` variant asks for a
UZS cashbox and shows the box it credits.

One page, four actions, factory context never re-selected. Today: four pages, four dropdowns.

---

## 6d. Settle transport with a driver

**Persona:** ACCOUNTANT; driver Baxtiyor (moshina «Isuzu 01 234 ABA») is at the office asking
to be paid for last week's trucks.

**Entry:** cockpit worklist **«Shofyorlarga qarz»** shows `Isuzu 01 234 ABA — 4 000 000` in
its preview → click → `/vehicles/:id` — the **driver settlement hub** (the never-called
`GET /vehicles/:id` finally rendered):

```
Isuzu · 01 234 ABA · Baxtiyor aka · +998 …        Sig'imi: 19 paddon
Balans: Shofyorga qarzimiz 4 000 000  (warning pill)
[ Shofyorga to'lash ]   [ Tahrirlash ]
Tabs: To'lanmagan reyslar (2) · Hisob-kitob · Barcha reyslar
```

1. **To'lanmagan reyslar** tab: the vehicle's orders with transportPaidStatus UNPAID or
   UNKNOWN (from the detail payload's order list): checkbox rows —
   `ORD-000101 · 05.07 · Жамол Ургенч · transport: 2 000 000 · To'lanmagan` and
   `ORD-000107 · 08.07 · … · 2 000 000 · Aniqlanmagan` (violet chip). Both checked by default;
   footer sums «Tanlangan: 4 000 000».
2. **«Shofyorga to'lash»** opens PaymentLauncher in VEHICLE_OUT, vehicle bound, amount
   pre-filled 4 000 000, and the AllocationEditor **pre-built from the checked trucks** —
   the silent-100-row picker is gone; the allocation list IS the unpaid-trucks list. Cashbox:
   Naqd kassa (balance shown). Consequence lines: «Transport: **To'langan** bo'ladi».
3. Save → hub balance pill «Yopilgan»; the violet UNKNOWN chip on ORD-000107 resolves to
   green PAID (derived status recomputed server-side, per the locked rule); the cockpit
   worklist count ticks down. Optional «Kvitansiya» print for the driver's signature.
4. **«Mijoz shofyorga to'lagan» variant:** if the driver says client paid him directly, the
   row kebab on the unpaid truck offers «Mijoz to'lagan deb qayd etish» → PaymentLauncher in
   TRANSPORT_DIRECT with client+vehicle+amount pre-bound, cashbox hidden, the double-effect
   line shown; allocation to that order marks it PAID_BY_CLIENT. The UNKNOWN-resolution job
   the importer left behind is now a 3-click task from the same screen.

---

## 6e. The owner's morning check: dashboard → drill into anomaly → act

**Persona:** ADMIN (the owner), 08:30, coffee, desktop (same flow works on his phone —
cockpit is responsive).

1. **Login → `/` Ish stoli.** Top band, three hero StatCards with sparklines and deltas:
   `Oy savdosi 412 mln (↑8%)` · `Oyda yig'ilgan 386 mln (↓4%)` · `Mahsulot foydasi 38,2 mln`
   + `Transport foydasi −1,1 mln` (danger ink — separate figure, locked rule). Secondary
   stat row: Bugungi savdo · Mijozlar qarzi · Zavodlarga qarzimiz · Shofyorlarga qarz ·
   Bonus hamyonlar · Paddonlar mijozlarda. Every card is a link.
2. **Inbox scan.** The InboxRail reads like a to-do list:
   `Taqsimlanmagan to'lovlar 3` (warning) · `Tekshirilmagan to'lovlar 12 — 95,8 mln` (violet)
   · `Muddati o'tgan qarzlar 4 — 21,4 mln` (danger) · `Narxlanmagan buyurtmalar 1` ·
   `Moshina biriktirilmagan 1` · below, a collapsed green strip «5 ta ro'yxat toza ✓».
3. **Anomaly:** Transport foydasi is negative. Click the card → `/reports?tab=reestr&from=…
   &to=…&sort=transportProfit:asc` — the orders register pre-filtered to the month, sorted by
   transport profit ascending, column preset «Logistika». Top row: ORD-000104, cost 2 000 000,
   charge 0, mode «Dilerning hisobidan», client «Шиддат». One click into the order shows the
   composer note; the owner realizes the dispatcher forgot to set DEALER_CHARGED.
4. **Act:** order is CONFIRMED and cost PROVISIONAL, so **«Tahrirlash»** is available
   (`/orders/:id/edit` — the UI-less PUT finally exposed). He flips mode to «Mijozdan
   olinadi», sets charge 2 200 000; the edit screen (same composer, banner: «Tahrirlash barcha
   yozuvlarni qayta yozadi — kredit limiti qayta tekshiriladi») shows the client's new
   exposure in the rail. Save. Transport profit card will tick up on the next glance.
5. **Second anomaly:** `Muddati o'tgan qarzlar 4`. He clicks the worklist header →
   `/debts?chip=overdue`, scans the four, expands the worst, presses «Akt sverki» →
   `/print/statement/:clientId?from=2026-01-01` renders the reconciliation statement; he
   WhatsApps the PDF (browser print-to-PDF) to the client from his phone. One of the four has
   promised cash today — he leaves the row for the accountant's 6b flow.
6. Total time: under three minutes, and *every* number he saw was either actionable in place
   or one click from the filtered evidence behind it. Nothing required remembering where a
   page lives: the inbox brought the work to him.

---

# 7. Screen-by-screen approach

For every major screen: layout in one breath, then what changes vs today. (Print routes are
§9; AGENT phone adaptations are §8.)

### 7.1 Ish stoli — ADMIN/ACCOUNTANT cockpit (`/`)
Layout: KpiBand (3 hero StatCards with sparklines + 6 secondary linked stats) → InboxRail
(WorklistCards, §3.3) → bottom row: trend chart card (sales vs collected vs order count as a
bar layer; **range selector 7/30/90/365** — the existing `?days` param finally exposed) beside
a compact Agentlar reytingi card (current month, rows link to `/agents/:id`, «Batafsil →
Hisobotlar»). Changes vs today: the 12-card KPI wall becomes 3+6 tiered and *every* figure is
a drill link; `ordersInFlight` and `weOweVehicles` (computed-but-invisible) surface as
secondary stats; the duplicate `Kutilayotgan tushum` card dies (it equals Mijozlar qarzi —
one card, honest label); the fake LIVE tag becomes the real LiveBadge; the inbox exists at all.

### 7.2 Agent cockpit (`/`, AGENT)
Layout (phone-first): greeting header → **Limit card** (CreditGauge from `GET /agents/me`:
outstanding vs debt limit, headroom, «0 — yangi buyurtma bloklangan» state loud and red) →
own KpiBand (bugungi/oylik savdo, yig'ilgan, mijozlar qarzi) → own inbox (Muddati o'tganlar,
Bugun muddati kelganlar, own orders in flight with status chips) → 30-day mini trend. Changes:
agents finally see the limit that silently blocks their orders; factory/bonus cards are gone
(server zeroes them anyway); everything is a card list, no tables.

### 7.3 Kassa terminali — CASHIER cockpit (`/`, CASHIER)
Layout: three giant action buttons («To'lov qabul qilish» primary / «Xarajat kiritish» /
«Qo'lda kirim-chiqim») → per-cashbox cards (balance + today in/out) with per-currency grand
totals (UZS jami, USD alohida — never summed, locked rule) → **Bugungi operatsiyalar feed**
(live list of today's cash transactions, each linking to its source document) → shift summary
line. Changes: the dead-end card grid becomes an actionable terminal; the feed and totals stop
the cashier's constant /kassa round-trips; receipt print offered after every accepted payment.

### 7.4 Buyurtmalar (`/orders`)
Layout: PageHeader (+ Yangi buyurtma) → status Tabs (Barchasi + 7) → **worklist chip row**
(Narxlanmagan N · Moshinasiz N · Transport aniqlanmagan N · Tannarx ochiq N — the queues from
§3.3 as toggleable filters) → FilterBar (search, client, factory, **vehicle**, date presets)
→ DataTable: order no · sana · mijoz · agent · zavod · moshina · **savdo (with pending-price
badge)** · tannarx chip · holat chip · transport chip · muddat (overdue in danger) · kebab
(Ko'rish / Tahrirlash / Holat / Bekor qilish). Totals row: Σ savdo, Σ m³, Σ paddon of the
filter. Changes: URL-synced filters, sorting, row click, aggregates, due-date column, blocker
badges — the list becomes a triage surface instead of a lookup table.

### 7.5 Yangi buyurtma (`/orders/new`) — the composer
Fully specified in §6a. Vs today: client-first with CreditGauge and pallet/overdue context;
factory auto-scoping instead of post-hoc error; ClientPrice-aware estimates; manual-m³
protection; vehicle-required-when-cost guard; explicit «MIJOZ QARZIGA YOZILADI» framing;
Ctrl+Enter; sticky rail instead of a below-fold summary.

### 7.6 Buyurtma (`/orders/:id`) — order workbench
DetailScaffold. Left: StatusFlow (blockers inline — vehicle assignment happens *here* via a
popover PartySelect when missing, fixing the stuck-order hole) → items table (Narxlash button
on pending rows; per-item price source) → tabs: To'lovlar (progress vs **saleTotal +
transportCharge** exposure + AllocationEditor for A/B) · Paddonlar · **Faoliyat** (one merged
timeline: statuses, payments, comments, with composer — the duplicate Izohlar tab dies).
Right rail: Moliya summary (sale / cost + chip / mahsulot foydasi labeled provisional-or-final
/ transport block with mode, cost, charge, foyda, paid chip + **«Shofyorga to'lash»** quick
action) → client mini-card (balance, pallets, link) → meta (agent, dates, creator) →
«Chop etish ▾» split button → privileged actions (Tahrirlash — enabled only NEW/CONFIRMED +
PROVISIONAL with an explainer tooltip otherwise; Bekor qilish → ReasonModal with impact
preview incl. bonus reversal warning from COMPLETED). Changes vs today: two-column, sticky
actions, edit exists, vehicle assignable, status menu supports privileged skip/back with note,
exposure-correct progress, single activity feed, print.

### 7.7 Buyurtmani tahrirlash (`/orders/:id/edit`)
The composer pre-filled (full item replace semantics of PUT /orders/:id), with a permanent
banner: «Tahrirlash barcha moliyaviy yozuvlarni storno qilib qayta yozadi; kredit limiti qayta
tekshiriladi. Tannarx qotirilgach yoki CONFIRMED holatdan keyin tahrirlash yopiladi.»
intendedPaymentMethod rendered read-only (immutable per API). New screen — closes the
"cancel + retype to fix a typo" hole.

### 7.8 To'lovlar (`/payments`)
Layout: PageHeader (+ To'lov — opens PaymentLauncher) → kind chip row with **filtered sums**
(Mijozdan 12,4 mln · Zavodga 40 mln · …) → FilterBar (search, kind, method, party, date,
voided three-state, **Tekshirilmagan** toggle = `?reconciled=false`, **Taqsimlanmagan** chip)
→ DataTable: sana · kind chip · usul (USD shows ×rate) · tomon (linked) · summa · kassa ·
taqsimlangan/qoldiq mini-bar · holat (Tasdiqlangan / violet Tekshirilsin / danger Bekor) →
row click opens the drawer at `/payments/:id`. Drawer: full descriptions with translated
ledger sources, allocations table (+ **«Taqsimlash»** → AllocationEditor), linked documents,
«Kvitansiya» print, void via ReasonModal with impact preview. Changes: deep-linkable detail,
allocation-after-the-fact exists, reconciliation queue exists, per-filter sums exist, the
morphing modal is dead.

### 7.9 Qarzlar / Undiruv (`/debts`)
Layout: KpiBand of the six liability/asset headline stats (A/B only) → FilterBar (search,
agent, region, window 7/14/30 with «Kutilayotgan tushum» beside it, **aging preset chips**:
Muddati o'tgan · 0–30 · 31–60 · 61+ derived from order due dates in the expanded data) →
client DataTable: mijoz · agent · balance (danger ink here — collections context) · paddon ·
overdue chip with count+total **in the cell, not a tooltip** · muddat (term days) →
**expandable row**: the client's open orders with due dates and outstanding, plus actions
«To'lov olish» · «Akt sverki» · «Mijoz kartasi». Changes: the row-action payment (hero 6b),
inline aging evidence, exportable, totals row (Σ qarz of filter), and the summary cards are
now links (clientsOweUs → this table; weOweVehicles → /vehicles?chip=owed…).

### 7.10 Kassa (`/kassa`)
Layout: **one period control** governing the whole page (presets + range) → cashbox cards
(click = scope filter, selected state ring; balance + period in/out) with UZS/USD grand-total
strip → summary table (opening/in/out/closing per box for the period) → transaction journal
(box, direction, amount, source chip, **linked document** — payment/expense/bonus rows open
their drawer; the plain-text dead end dies) → «Qo'lda kirim-chiqim» button; storno only on
MANUAL rows via ReasonModal. Changes: single period, card-as-filter scoping, clickable
provenance, no more three-desync-sections.

### 7.11 Xarajatlar (`/expenses`)
Layout: PageHeader (+ Yangi xarajat) → KPI strip: period total + per-category chips (top 5 +
boshqalar) → FilterBar (search, category, cashbox, date, voided three-state) → DataTable with
totals row → create modal (category select with inline +; cashbox with live balance). Category
rename/delete lives in /references. Changes: aggregation exists, voided rows filterable,
Tashkent-day basis note on the range picker (the UTC drift is at least labeled until backend
unifies).

### 7.12 Paddonlar (`/pallets`)
Layout: two balance cards side by side (Mijozlardagi paddonlar / Zavodlardagi hisobdorlik —
single source formula, the list/detail divergence noted for backend fix) → movements DataTable
with FilterBar (client, factory, **type, date range**) and a totals footer (net in-kind delta,
Σ charged money, Σ credited money) → actions launched from balance rows (kebab: Qaytarish
qabul qilish / Undirish; factory rows: Zavodga qaytarish) with modals showing current →
post-action balance and the money preview; unit price prefilled **from the palletPriceDefault
setting** (the hardcoded 130 000 goes through the settings value) with a deviation hint.
Changes: filters, totals, balance-aware modals, single global action button (+ Harakat) instead
of three duplicated button sets.

### 7.13 Mijozlar (`/clients`)
Layout: PageHeader (+ Yangi mijoz) → FilterBar (search, region, agent, holat, balans holati:
Qarzdor/Avansda/Yopilgan) → DataTable: nomi · hudud · agent · telefon · BalancePill ·
CreditGauge mini (limit utilization) · paddon · kebab (Tahrirlash / **Faollashtirish** on
inactive rows / Deaktivatsiya). Changes: structured filters wired to server params, credit
utilization visible, reactivation exists (needs the `active` field on the update path —
flagged as the one DTO-level fix this vision requests), one edit surface (drawer) for
create+edit.

### 7.14 Mijoz kartasi (`/clients/:id`) — client hub
DetailScaffold. Left tabs: **Hisob-kitob** (PartyStatement with period control) ·
Buyurtmalar · To'lovlar (both server-paginated, «Barchasini ko'rish →» deep links to the
filtered registers) · Paddonlar · Maxsus narxlar (grouped by product, current price
highlighted, future-dated badged) · Taxalluslar. Right rail: BalancePill money-lg +
CreditGauge + PalletCounter + overdue strip → **ActionBar: Yangi buyurtma · To'lov olish ·
Akt sverki · Paddon qaytarishi** → profile facts (edit inline) → agent/region links. Changes:
the hub carries its actions (P2), history is complete not last-20, special prices readable,
statement printable.

### 7.15 Zavodlar (`/factories`)
Tab 1 **Ro'yxat:** DataTable (nomi · BalancePill · bonus hamyon · **bonus dasturi badge**
(PER_M3 5 000/m³ …) · paddon hisobi · holat · kebab) — server-paginated + searched (the 50-row
silent cap dies). Tab 2 **Bonus:** wallet cards per factory (balance, program badge, actions
Naqd yechish / Qarzga o'tkazish pre-scoped — cards also filter…) above the bonus journal
(factory filter, type, date; **basis columns visible**: baza m³/summa, stavka/foiz, formula
rendered in the expanded row; DEBT_OFFSET rows carry a «to'lovni bekor qilish orqali
qaytariladi →» deep link). Changes: /bonus merges here; program overview exists; accrual
explainability is a column, not a hover.

### 7.16 Zavod kartasi (`/factories/:id`) — settlement hub
Specified in §6c. Vs today: read-only tabs become an operations hub with four pre-scoped
actions; statement is server-paginated with period control and export; bonus tab gains program
versioning UI (new-version modal with same-day collision pre-check) and in-context spend;
pallet tab gains the return action.

### 7.17 Mahsulotlar va narxlar (`/products`)
Layout: FilterBar (factory, search — live debounced) → DataTable: nomi · o'lchami · zavod ·
m³/paddon · **three price columns each showing value + effective date + «yangi narx
kutilmoqda» badge when future-dated** · holat · kebab (Narxlar / Tahrirlash / Deaktivatsiya).
Price drawer: per-kind tabs, current row pinned and marked, future rows badged, history below.
**Bulk price editor** (header button «Ommaviy narx o'zgartirish»): pick factory → editable
grid products × 3 kinds pre-filled with current, one effectiveFrom, «+X%» helper, single save
= N versioned inserts with a confirm summary. Changes: the repricing click-marathon becomes
one grid; effective-dating is visible everywhere.

### 7.18 Ta'minot tahlili (`/procurement`)
Tab 1 **Matritsa:** region select (defaults to last used) + optional product; results
**grouped by product**, cheapest factory marked within each group (the apples-to-oranges
trophy dies); dropped products listed with reason chips that **deep-link to the fix** («narx
kiritish →» opens the product's price drawer; «marshrut qo'shish →» opens tab 2 pre-filled).
Tab 2 **Marshrutlar:** versioned routes table (factory × region, costPerTruck, capacity,
effectiveFrom, current marked) + «Yangi marshrut» form — the fully-built, UI-less
POST /procurement/routes finally drivable. Changes: routes manageable, matrix honest,
gaps fixable in place.

### 7.19 Moshinalar (`/vehicles`)
DataTable (server search/pagination): nomi · raqam · shofyor · telefon · sig'imi · BalancePill
(warning «Shofyorga qarzimiz») · holat · kebab; **row click → `/vehicles/:id`**. The detail
hub is §6d. Changes: detail exists; terminology unified to **Shofyor** everywhere (glossary
decision — matches payment kind label).

### 7.20 Agentlar (`/agents`, `/agents/:id`)
List: adds search + status filter; debt-limit column with the ADMIN-only edit kept. Detail:
header gains **Tahrirlash** and a **month picker** (agents-ranking ?month endpoint) so KPIs
show all-time AND selected-month side by side; clients table gains balance sorting and links;
the agent's own user account (if any) linked for ADMIN. Changes: editable in place,
month-comparable, cross-linked.

### 7.21 Hisobotlar (`/reports`)
Tabs: **Svod** (agent blocks expanded by default as one grouped table with sticky agent
subtotal rows; every client/factory name links to its hub; identity checks pinned at top as
green/red chips — non-zero is a defect signal, styled as an incident banner) · **Buyurtmalar
reestri** (server totals row for the whole filter; column presets «Moliya ko'rinishi /
Logistika ko'rinishi»; transport-status and vehicle filters; xlsx kept) · **Agent reytingi**
(month picker, MoM delta column, «Qarzdorlik — hozirgi qoldiq» honestly labeled). Changes:
drill-down everywhere, presets, the ranking gets a home with history.

### 7.22 Excel import (`/import`) — ADMIN only
A 4-step stepper replacing the endless page: **1 Yuklash** (dragger + guards summary) →
**2 Tekshiruv** (dry-run result: checks as a table name/expected/actual/Δ; counts with
per-kind chips; the unreconciled-95,8M warning rendered from the correct payload field;
unmatched lists as structured tables; dry-run results persisted to localStorage with a
«qoralama» history) → **3 Import** (confirm modal embeds the dry-run summary; progress overlay
with stage labels) → **4 Solishtirish** (headline chips: mos / farqli / **izohsiz** /
flagged-total; per-client rows expandable to sheetGaps detail; amber «daftar nuqsoni bilan
izohlangan» vs red «izohsiz — import xatosi» badges — the backend's most valuable output
finally rendered; flagged-payments checklist with payer/method columns). Rollback: single
ReasonModal with typed ROLLBACK + deletion counts. Changes: everything the pain-point list
demanded, in one wizard, one writing system for chrome (Uzbek Latin) with workbook terms
quoted verbatim.

### 7.23 Foydalanuvchilar (`/users`)
Adds: search, role/status filter chips, email column, «Bloklangan» section sorted last,
symmetric row actions (Bloklash / **Faollashtirish**), shared ROLE labels. The modal keeps its
strong invariants (agent binding, password hints).

### 7.24 Tizim sozlamalari (`/settings`)
Per-field save affordance (each key saves independently with inline success/error — matching
the API's per-key PUT reality); saleMarginMinPct carries a warning badge «hozircha hech narsa
tekshirmaydi» until the owner wires or drops it; ACCOUNTANT gets the read-only variant.
Pallet default price is cross-referenced by the Pallets modals (§7.12).

### 7.25 Ma'lumotnomalar (`/references`)
Three tabs: **Hududlar** (client-count links to filtered /clients; delete disabled with
reason when referenced) · **Yuridik shaxslar** (one activate/deactivate toggle; used by
PaymentLauncher's payer/receiver PartySelect — the write-only catalog finally drives payment
attribution) · **Xarajat kategoriyalari** (usage counts, inline rename, delete-when-unused —
existing endpoints, first UI).

### 7.26 Login (`/login`)
Kept austere: centered 380px card, wordmark, two fields, «Kirish». Adds: theme-correct
rendering, caps-lock hint, the same identical-error copy (anti-enumeration), and nothing else
— a login page is not a brand billboard.

### 7.27 Profil (`/profile`)
One editable card (name/username/email/phone — email finally exposed) + password card with the
session-invalidation note. The duplicate read-only block dies.

---

# 8. AGENT mobile experience

The AGENT persona is a field salesperson standing in a client's yard, one thumb free, sun on
the screen, over mobile data. Their surface is exactly five pages plus the composer, and every
one of them is designed at 360×780 first and merely *allowed* to widen.

## 8.1 Frame

- **Bottom tab bar** (56px, safe-area aware): Ish stoli · Buyurtmalar · **➕** (raised 56px
  center button → order composer) · Mijozlar · Qarzlar. Active tab: filled icon + primary ink.
- Top bar (48px): page title, search icon (opens a full-screen search sheet — the palette's
  phone form), avatar (Profil / Chiqish / theme).
- No sidebar, no breadcrumbs (back arrows in the top bar), no hover-dependent affordances,
  no tables — **card lists only**. Touch targets ≥ 44px; primary actions are full-width
  bottom-sticky buttons; destructive actions require the ReasonModal (full-screen sheet).
- All drawers/modals become bottom sheets (radius 12 top, drag handle, `overlay` motion).
- LiveBadge logic still runs; offline shows the amber hairline + pull-to-refresh enabled.

## 8.2 Ish stoli (agent cockpit)

Vertical stack: Limit card (CreditGauge — the number that gates their livelihood, always
first) → three stat chips (Bugungi savdo · Oy savdosi · Yig'ilgan oyda) → «E'tibor kerak»
cards: Muddati o'tgan mijozlar (n + Σ), Bugun-7 kun ichida muddati kelganlar, Yo'ldagi
buyurtmalarim (status chips, tap → order) → mini 30-day sparkline card. Every card: one tap to
the filtered list.

## 8.3 Buyurtmalar

Status filter as a horizontal chip scroller (Barchasi · Yangi · … ). Order cards:
`ORD-000123 · 08.07` / client name / `2 060 000 so'm` + status chip + transport chip; tap →
order detail (single column: StatusFlow condensed to a progress pill + **one big forward
button** — agents move exactly +1, so the mobile UI is literally one button), items list,
money summary, activity. Pull-to-refresh; infinite scroll instead of pagination.

## 8.4 Order composer on the phone (the ➕ tab)

The §6a form restructured as a **4-step wizard** with a persistent summary footer
(qarzga yoziladi + capacity bar always visible):

1. **Mijoz** — search sheet with recent clients first; the selected client card shows
   BalancePill, CreditGauge, pallets, overdue chip. Blocked-limit states are announced here,
   not at submit.
2. **Mahsulot** — product picker (factory auto-scope), pallet stepper with big ± targets,
   m³ auto-fill, price mode (Katalog/Kelishilgan/Umumiy summa — Narxsiz absent for agents),
   floor price shown; «+ yana mahsulot» repeats.
3. **Transport** — vehicle picker (plate-first labels), 3-mode segmented, cost/charge inputs
   with the same no-vehicle guard.
4. **Tasdiqlash** — full recap (items, totals, exposure, post-save balance vs limit) →
   «Buyurtma yaratish». Success screen: order number huge, status NEW, buttons «Ko'rish» /
   «Yana buyurtma».

Steps validate on advance; back preserves state; the wizard survives an accidental tab switch
(state kept in memory until submitted or discarded).

## 8.5 Mijozlar & Qarzlar

Mijozlar: search-first list of client cards (name, region, BalancePill, pallet chip); tap →
client hub (phone layout: balance header + action row «To'lov olish» / «Yangi buyurtma» +
tabbed history as cards). Qarzlar: the undiruv list sorted worst-first, aging chips, tap-to-
expand open orders, **«To'lov olish»** as a full-width button in the expanded card — the 6b
flow is identical on the phone, launcher as a bottom sheet, numeric keypad (`inputmode=
numeric`) for MoneyInput, method chips sized for thumbs. After save: «Kvitansiya» opens the
print route — on a phone this becomes share-as-PDF via the system print sheet.

## 8.6 To'lovlar

Own CLIENT_IN history as cards (date, client, amount, method chip, reconciled state). Create
= the same launcher, CLIENT_IN only (server enforces; UI doesn't tease other kinds).
No allocations UI (locked rule) — the card notes «taqsimlash ofisda amalga oshiriladi».

## 8.7 Performance & ergonomics budget

Lazy routes already exist; the agent bundle excludes charts except the sparkline (tiny SVG,
not @ant-design/plots, on phones). Lists render 20-at-a-time with intersection-observer
paging. All money entry uses the numeric keypad. Skeletons over spinners. Dark theme fully
supported (night deliveries are real).

---

# 9. Print documents (frontend-only, from existing API data)

Four documents, one `PrintDocument` scaffold (§5.22), rendered at dedicated print routes so
they are linkable from anywhere and reachable via Ctrl+P menus. Shared conventions:

- **Paper grammar:** A4 portrait (waybill, invoice, statement), A5 landscape ×2-up (receipt).
  Margins 14mm; base type 10.5pt/14 system serif-free stack (same Inter, prints crisply);
  headers 13pt/650; tables with 0.5pt hairlines, right-aligned tabular numbers; money as
  `1 249 547 319` with a single «so'm» in the column header. Black on white only — no color,
  no chips; states print as bracketed words (`[TO'LANMAGAN]`).
- **Document header block (all four):** dealer requisites from the selected DEALER legal
  entity (name, INN — picked once in the toolbar, remembered), document title + number +
  date, and a small «SmartBlok» set in 7pt at the footer with print timestamp and page N/M.
- **Signature block:** name lines + `Imzo: ____` + `Sana: ____`, two columns (berdi / oldi).
- Print CSS: `@media print` hides app chrome (exists), `@page { size: A4; margin: 14mm }`,
  `break-inside: avoid` on table rows and signature blocks.

### 9.1 Yuk xati (driver waybill) — printed at LOADING, from OrderDetail
Source: `GET /orders/:id`. Layout: header block → counterparty grid (2×3): Mijoz (name,
phone, region) · Zavod · Moshina (name + **plate large**, 14pt) · Shofyor (snapshot name +
phone) · Buyurtma № + sana · Agent → items table: № / Mahsulot (nomi, o'lchami) / Paddon /
m³ / — **no prices** (a waybill travels with the driver; cost is confidential; sale price
optional toggle in the toolbar, default off) → totals line: Σ paddon (**huge, this is what
gets counted at the gate**), Σ m³ → pallet note: «Paddonlar qaytariladigan idish hisobida —
N dona mijoz zimmasiga o'tadi» → signatures: Yukladi (zavod) / Qabul qildi (shofyor) /
Topshirdi (mijozga yetkazilganda). Two copies per sheet toggle (driver + office).

### 9.2 Hisob-faktura (client invoice) — from OrderDetail
Source: order + items with prices. Layout: header block → Sotuvchi (dealer entity) / Xaridor
(client, region, phone) columns → invoice meta (№ = order no, sana, agent) → items table:
Mahsulot / m³ / narx so'm/m³ / summa → sub-total Mahsulot jami → conditional line «Transport
xizmati» (only when DEALER_CHARGED, = transportCharge) → **JAMI** (saleTotal +
transportCharge, 14pt) → footnote block: «Paddonlar (N dona) qaytariladi — narxga kirmaydi»
(locked in-kind rule made contractual), to'lov muddati (dueDate) when present, pending-price
items rendered as «narx kelishilmoqda» rows excluded from totals with an asterisk note →
signatures + optional current-balance line («Ushbu hujjatdan keyingi qoldiq: …» toggle).

### 9.3 Kvitansiya (cashier receipt) — from payment drawer / launcher success
Source: `GET /payments/:id`. A5 landscape, printed 2-up (mijoz nusxasi / kassa nusxasi,
labeled). Layout: header block → КВИТАНЦИЯ № (payment id short) + datetime → grid: Kimdan
(client) / Summa (large, 16pt; USD payments show `$1 200 × 12 650 = 15 180 000 so'm`) / Usul /
Kassa / Qabul qildi (user name) → allocations mini-list when present («ORD-000101 uchun:
2 000 000») → amount-in-words line (frontend Uzbek number-to-words util — `o'n besh million
bir yuz sakson ming so'm`) → signatures: Topshirdi / Qabul qildi. TRANSPORT_DIRECT and voided
payments refuse to print a receipt (guard with explainer — no cash changed hands with the
dealer / document void).

### 9.4 Akt sverki (client reconciliation statement) — from ClientDetail, Debts row, print route
Source: `GET /debts/statement?clientId&from&to` (opening balance, entries, closing balance).
Layout: header block → title «O'ZARO HISOB-KITOB SOLISHTIRISH DALOLATNOMASI» + period + the
two party name blocks → opening balance line (framed: «Davr boshiga mijozning qarzi: …» or
avansi) → statement table: Sana / Hujjat (ORD-…/to'lov, source label) / Izoh / Qarzga (debit)
/ To'lovga (credit) / Qoldiq — reversal pairs print with a «storno» marker; TRANSPORT_DIRECT
lines annotated «shofyorga to'langan» → closing balance (bold, framed, in words) → **paddon
qo'shimchasi**: separate mini-table (davr boshi / berildi / qaytarildi / undirildi / davr oxiri
— in-kind counts, explicitly «pulga kirmaydi») → dual signature block (Diler / Mijoz) with
«e'tirozlar 10 kun ichida» line. This is the document the owner currently rebuilds in Excel
for every dispute; here it is two clicks from any debt row.

---

# 10. What we deliberately do NOT do

Restraint is part of the spec. Each item is a temptation this vision rejects, with the reason.

1. **No new backend endpoints.** Everything above runs on the existing API. Worklists that
   lack a server filter derive client-side over bounded windows appropriate to this business's
   scale; where that becomes wrong (10× volume), the fix is a backend filter param — noted,
   not designed around.
2. **No cashbox CRUD, no opening-balance UI, no manual ledger ADJUSTMENT screen, no file
   attachments.** All four are declared backend gaps (out of scope). The UI acknowledges them
   honestly (e.g. the import kassa warning explains opening balances are entered by the owner
   separately) instead of faking flows that cannot commit.
3. **No consolidated P&L report.** Goods profit, transport profit, and expenses stay separate
   surfaces because joining them needs a server aggregate that doesn't exist; we refuse to sum
   paginated pages client-side and call it profit (P3: never present a number as more settled
   than it is).
4. **No agent commissions, no promises/kanban/CRM features on Debts.** There is no commission
   model in the code and no promise entity; the undiruv cockpit works with what the ledger
   knows: balances, due dates, aging.
5. **No notification center / bell feed / email digests.** Realtime worklist counts + the
   LiveBadge are the notification system. A feed would duplicate the inbox and rot.
6. **No dashboard customization, no draggable widgets, no user-configurable inbox order.**
   The cockpit is opinionated by severity; configurability is where triage tools go to die.
7. **No charts beyond the trend line, sparklines, and the agents ranking.** No pie charts of
   payment methods, no gauges. Every pixel of the cockpit either counts work or drills down.
8. **No i18n switcher in v1 of the redesign.** One language decision (Uzbek Latin app copy +
   AntD uz_UZ locale) applied consistently; workbook terms (Товар, Оплата, «шопр учун барди»)
   are preserved verbatim as *quoted artifacts* in import screens only. String extraction to
   i18next may happen under the hood, but a RU/UZ toggle ships only if the owner asks.
9. **No soft-delete "undo" theatrics.** Voids, cancels, and stornos are forward-only
   compensations with reasons — the UI never offers an "undo" that would imply mutation of
   history (locked immutability rule).
10. **No client-side money math beyond display.** Estimates in the composer are labeled
    «taxminiy — server tasdiqlaydi»; totals rows on partial data are labeled «sahifa jami»;
    the authoritative number is always the server's.
11. **No merging of goods and transport profit, ever** — not in KPIs, not in reports, not in
    print docs (owner-locked). Same for pallets-as-money: pallet counts never render with a
    so'm sign except in the two explicit money flows.
12. **No reinvention of AntD.** The component system is compositions and tokens; no styled-
    components layer, no Tailwind, no second design system. Custom CSS is one file with
    custom properties.
13. **No "select all" bulk mutations on financial registers** (bulk void, bulk cancel).
    Every financial correction stays a deliberate, reasoned, single act — matching the audit
    model (one actor, one reason, one record).
14. **No speculative offline mode / PWA sync for agents.** Field reality is handled with
    resilient loading states and refetch-on-reconnect, not a conflict-resolution science
    project on top of an immutable ledger.
15. **No dropping of existing terminology.** Buyurtmalar, Mijozlar, To'lovlar, Qarzlar,
    Paddonlar, Kassa, Zavodlar, Svod, storno — the staff's vocabulary is the spec. The only
    unifications: Shofyor (over Haydovchi) and Buxgalter (over Hisobchi), each chosen because
    it already dominates the data and docs.

---

## Appendix A — Decisions this vision takes a position on (for the jury merge)

| Open question (brief) | Position here |
|---|---|
| Import visible to ACCOUNTANT? | No — ADMIN-only end to end, from one shared PERMISSIONS map (matches the API). |
| `expectedCollections` duplicate KPI | Card dies; `/debts` keeps the windowed figure where it has meaning. |
| `saleMarginMinPct` no-op | Stays editable but visibly badged as not-enforced until the owner decides. |
| creditLimit=0 semantics | «0 — faqat oldindan to'lov» (prepay-only) everywhere; the one contradicting doc line is treated as stale. |
| Driver word | Shofyor. |
| Role label | Buxgalter. |
| /bonus as a page | Dies into /factories (tab + hub actions); redirect kept. |
| Hududlar / Yuridik shaxslar / Kategoriyalar | One /references page, three tabs. |
| Client reactivation | Requires adding `active` to UpdateClientDto — the single, tiny API change this vision requests; if refused, the action hides and the gap is documented in-UI. |
| Agent deletion contradiction | Treated as soft-deactivate (matches snapshot-preservation rule). |
| Locale | AntD uz_UZ + dayjs uz-latn; ru-RU digit grouping retained. |

## Appendix B — Migration order (so the cockpit ships value early)

1. Foundations: tokens/theme, PageHeader, FilterBar+useUrlFilters, DataTable, Money/BalancePill,
   PartySelect, ReasonModal (every page benefits immediately).
2. `/payments/:id` route + AllocationEditor + PaymentLauncher (unblocks the money core).
3. Cockpits (Ish stoli inbox, Agent, Kassir) — the vision's face.
4. Hubs: ClientDetail, FactoryDetail, `/vehicles/:id`, OrderDetail split-view + `/orders/:id/edit`.
5. Print routes (waybill → receipt → invoice → akt sverki).
6. Undiruv board, Reports upgrades, Products bulk pricing, Procurement routes tab, References.
7. Import stepper (last — one operator, pre-go-live tool).


## Appendix C — Responsive breakpoints & layout behavior

| Token | Range | Shell | Lists | Detail |
|---|---|---|---|---|
| `desk-xl` | ≥1600px | sidebar 240 + content max 1440 | full DataTable, all columns | DetailScaffold, rail 320 |
| `desk` | 1200–1599 | sidebar 240 | DataTable, low-priority columns fold into row expand | DetailScaffold, rail 300 |
| `lap` | 1024–1199 | sidebar auto-collapses to 56px rail | DataTable, column presets forced | rail becomes top summary strip |
| `tab` | 768–1023 | rail + overlay drawer nav | tables switch to 2-line rows (party+figure / meta) | single column |
| `phone` | <768 | AGENT: bottom tabs; desk roles: overlay nav (view-only support) | card lists only | single column, sticky bottom ActionBar |

Column fold priority on Orders (example): kebab > holat > savdo > mijoz > sana > № are the
last to fold; agent, zavod, moshina, transport fold first (recoverable in row expand).
Desk roles on phones are supported for *reading and approving* (cockpit, detail pages, status
advance, ReasonModal) — heavy entry (composer, bulk pricing, import) shows a polite
«kompyuterda qulayroq» note but does not block.

## Appendix D — Interaction states & accessibility contract

- **Focus:** every interactive element shows a 2px `primary-border` outer ring (offset 1px);
  focus is never removed, only styled. Drawer/modal open moves focus to the first field;
  close returns focus to the invoker (ReasonModal and PaymentLauncher included).
- **Keyboard-complete:** all five hero workflows are executable without a mouse (§2.3 chords,
  Enter-to-advance in the composer grid, arrow navigation in tables and the inbox, Space to
  toggle checkbox rows in AllocationEditor, Ctrl+Enter to submit any form).
- **ARIA:** DataTable rows carry `aria-label` summarizing party + amount; kebab menus are
  labeled («ORD-000123 amallari»); WorklistCard counts are `aria-live=polite` so screen
  readers hear queue changes; icon-only controls are extinct, but any residual icon button
  must carry `aria-label`.
- **Color independence:** every semantic color is paired with a word (pill text, chip label,
  bracketed print state) — the app is fully readable in grayscale; the violet UNKNOWN channel
  also carries a `?` glyph.
- **Hit areas:** ≥32px desktop, ≥44px touch; a table row is never the only path to a
  destructive action (those live in the kebab with a confirm).
- **Error surfaces:** server messages render verbatim (they are already Uzbek and carry
  figures — limit/current/new, box shortfalls); the UI never paraphrases a financial error.
- **Toasts:** only for the actor's own mutations, 4s, with a deep link («ORD-000123 →»);
  never used for background/socket events (the inbox tickers carry those).
- **Skeletons:** shaped like the final content (KPI band, 8 table rows, statement rows);
  spinners allowed only inside buttons.
- **Session edge:** 401 anywhere → storage cleared → /login with a «sessiya tugadi» note and
  the return URL preserved (`?next=`), so re-login lands back on the filtered view.

## Appendix E — Glossary (one term, one writing system, everywhere)

| Concept | UI term (uz-Latn) | Banned variants |
|---|---|---|
| Order / truck | Buyurtma (reys in transport contexts) | Zakaz |
| Client | Mijoz | Klient |
| Debt / their balance | Qarz (mijozning qarzi) / Avans | raw signed numbers without a pill |
| Factory | Zavod | Fabrika |
| Driver | **Shofyor** | Haydovchi, шопир (except quoted workbook artifacts) |
| Pallet | Paddon (dona) | Pallet, поддон (quoted only) |
| Cash desk / box | Kassa / kassa qutisi | — |
| Accountant role | **Buxgalter** | Hisobchi |
| Provisional cost | Taxminiy tannarx | — |
| Finalized cost | Tannarx qotirilgan | — |
| Allocation | Taqsimlash / taqsimot | Allokatsiya |
| Void / reversal | Bekor qilish / storno | O'chirish (nothing is ever deleted) |
| Reconciliation stmt | Akt sverki (solishtirish dalolatnomasi) | — |
| Waybill | Yuk xati | Nakladnaya (print subtitle may carry it in parentheses) |
| Receipt | Kvitansiya | Chek |
| Collections | Undiruv | — |
| Worklist / inbox | E'tibor kerak | Inbox |

Workbook sheet names (Товар, Оплата, Свод…) and imported flag reasons remain verbatim,
always inside «…» quotes, only on Import screens — they are evidence, not UI copy.


## Appendix F — AntD v6 ConfigProvider token mapping (implementation-ready)

The §4 language expressed as the actual theme objects (replaces theme.ts values; both
algorithms keep AntD's derivation for anything not listed).

```ts
// Shared
const shared = {
  borderRadius: 6,
  borderRadiusLG: 10,          // cards, table container
  borderRadiusSM: 4,           // tags/chips
  fontFamily: "'Inter Variable', Inter, 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif",
  fontSize: 14,
  fontSizeSM: 13,              // tables
  controlHeight: 32,
  controlHeightSM: 26,
  motionDurationFast: '0.1s',
  motionDurationMid: '0.18s',
  motionDurationSlow: '0.24s',
  motionEaseInOut: 'cubic-bezier(0.2, 0, 0, 1)',
};

export const lightTheme: ThemeConfig = {
  algorithm: antdTheme.defaultAlgorithm,
  token: { ...shared,
    colorPrimary: '#2E6584', colorInfo: '#2E6584',
    colorSuccess: '#1A7F37', colorError: '#B42318', colorWarning: '#B45309',
    colorBgLayout: '#F6F7F9', colorBgContainer: '#FFFFFF',
    colorBorder: '#D0D5DD', colorBorderSecondary: '#E4E7EC',
    colorText: '#1A202B', colorTextSecondary: '#5A6472', colorTextTertiary: '#8B94A3',
    colorFillTertiary: '#F0F2F5',
  },
  components: {
    Layout: { siderBg: '#10161D', headerBg: '#FFFFFF', headerHeight: 48 },
    Menu:   { darkItemBg: '#10161D', darkSubMenuItemBg: '#0B1015',
              darkItemSelectedBg: 'rgba(91,147,179,.14)', itemBorderRadius: 6 },
    Table:  { headerBg: '#F0F2F5', cellPaddingBlockSM: 8, cellPaddingInlineSM: 12,
              rowHoverBg: 'rgba(227,238,244,.4)', fontSizeSM: 13 },
    Card:   { paddingLG: 20 },
    Tabs:   { horizontalItemPadding: '10px 12px' },
    Drawer: { paddingLG: 20 },
  },
};

export const darkTheme: ThemeConfig = {
  algorithm: antdTheme.darkAlgorithm,
  token: { ...shared,
    colorPrimary: '#5B93B3', colorInfo: '#5B93B3',
    colorSuccess: '#46B36B', colorError: '#F0716A', colorWarning: '#DFA04A',
    colorBgLayout: '#0E1116', colorBgContainer: '#151A21', colorBgElevated: '#1B222B',
    colorBorder: '#333D4A', colorBorderSecondary: '#262E38',
    colorText: '#E7ECF2', colorTextSecondary: '#A6B0BD', colorTextTertiary: '#6F7A88',
    colorFillTertiary: '#11151B',
  },
  components: {
    Layout: { siderBg: '#10161D', headerBg: '#151A21', headerHeight: 48 },
    Menu:   { darkItemBg: '#10161D', darkSubMenuItemBg: '#0B1015',
              darkItemSelectedBg: 'rgba(91,147,179,.16)', itemBorderRadius: 6 },
    Table:  { headerBg: '#11151B', rowHoverBg: 'rgba(91,147,179,.08)', fontSizeSM: 13 },
  },
};
```

Non-token CSS custom properties (design.css): `--sb-violet`, `--sb-violet-fill`,
`--sb-shadow-e1/e2/e3`, `--sb-sidebar`, statement zebra, print rules (§9), the `.num`
tabular class, and the 2px refetch hairline animation. Nothing else is hand-styled.
---

*End of vision. 10 sections, one thesis: bring the work to the person, keep the ledger honest,
and let every number defend itself one click deep.*
