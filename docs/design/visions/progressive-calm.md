# SmartBlok — UX Vision: «PROGRESSIVE CALM»

> Design vision for the ground-up UX redesign of SmartBlok — the ERP of a gas-block wholesale
> dealer in Khorezm, Uzbekistan. Angle: **Apple/Notion-grade calm minimalism with progressive
> disclosure.** Each screen shows only what the current task needs; complexity reveals itself
> on demand. Business logic is locked; this document redesigns only the experience, wiring the
> existing NestJS API (including the endpoints that today have no UI: `PUT /orders/:id`,
> `GET /vehicles/:id`, `POST /payments/:id/allocations`, `GET /agents/me`, `?reconciled=`,
> logistics routes CRUD, dashboard `?days` / `?month`).
>
> Stack: React 18 + Ant Design v6 (ConfigProvider tokens + custom CSS), @ant-design/plots,
> react-query, react-router 6, socket.io. UI language: Uzbek (Latin). Money: UZS via
> `lib/format.ts` conventions. Light and dark themes are both first-class.

---

## 1. Design philosophy

Five principles, each derived from how this specific business actually breathes — not generic
platitudes. Every screen decision in this document traces back to one of them.

### P1 — One number first. Everything else is disclosure.

This business runs on balances: a client's ledger sum, a factory's advance, a driver's unpaid
trucks, a bonus wallet, a cashbox. The immutable ledger means every one of these numbers is
*the truth*, computed live. Therefore **every screen leads with exactly one hero number set in
display type**, with its semantic verdict attached in words (`Qarz` / `Avans` / `Hisob-kitob
yopiq`), and everything beneath it is supporting evidence you reveal as needed. No screen ever
opens on a 12-tile wall of equally-weighted statistics. If the user must hover to learn the
exact so'm value, the design has failed — full grouped figures are always visible on desk
screens; abbreviations exist only where a thumb, not a cursor, is the pointer.

### P2 — Ask only what this step of the task needs.

An order is a client, a truckload, and a transport arrangement — three thoughts, in that
order. A payment is a verb ("receive from client", "pay the factory") before it is a form.
Multi-step flows become **guided steppers with a persistent live summary rail** that
accumulates the financial consequence (projected balance, credit headroom, capacity) as the
user types. Fields for other branches simply do not exist on screen: choose `CLIENT_OWN`
transport and the cost/charge inputs are gone, not disabled. The server remains the authority
(prices, credit gates, capacity); the UI's job is to make the server's verdict *unsurprising*
by previewing it live.

### P3 — Detail pages are documents, not tab mazes.

The owner ran this business in a paper-shaped workbook. The calm translation of that instinct:
an order, a client, a factory, a driver each get a **single scannable document** — header
verdict, then sections in reading order, an anchored mini-map on wide screens, one unified
activity feed at the end. No `Tabs` component on any detail page. Tabs hide; documents flow.
The same document metaphor extends literally to paper: waybill, invoice, receipt, and akt
sverki are print-CSS renderings of the same data the screen shows.

### P4 — Typography carries hierarchy; color is reserved for verdicts.

Spacing and type weight do the layout work — hairline borders only where whitespace cannot.
Color appears exclusively when it *means* something in this domain: red = money owed to us is
at risk or we owe (debt/overdue/void), green = advance/settled/final, amber = provisional,
pending, unreconciled — the "not yet trustworthy" state this ledger-centric system must always
flag honestly. Status pills, signed money, and the LIVE connection dot are the only colored
elements on a typical screen. Everything decorative — gradients, illustrations, icon
backgrounds, colored card headers — is deleted.

### P5 — The next action is one keystroke (or one thumb) away.

ADMIN and ACCOUNTANT live in this product 8 hours a day: every list is keyboard-navigable,
every workflow has a home-row path, `Ctrl+K` finds *records* (clients, order numbers,
payments), not just pages. The AGENT sells from a phone in a truck yard: their five jobs (check
standing, list clients, book a truck, take a payment, check debts) are one-thumb flows with
44px targets. The CASHIER gets a terminal, not an ERP. Every KPI drills down to the filtered
list that explains it; every filter lives in the URL so Back always works and any view can be
sent over Telegram to a colleague.

---

## 2. App shell & navigation

### 2.1 Layout anatomy

```
┌──────────┬──────────────────────────────────────────────────────────┐
│          │  Header (56px): [Qidiruv… Ctrl+K]        ● Jonli  ◐  (A) │
│  Sidebar ├──────────────────────────────────────────────────────────┤
│  240px   │                                                          │
│  light   │   Content: max-width 1440px, 24px gutters               │
│  surface │   PageHeader (breadcrumb · title · actions)              │
│          │   … page body …                                          │
│  groups  │                                                          │
│          │                                                          │
│  ▾ user  │                                                          │
└──────────┴──────────────────────────────────────────────────────────┘
```

The single biggest shell change vs today: **the dark sider dies.** Progressive Calm uses a
light sidebar (`#FBFBF9` light / `#141619` dark) that belongs to the same visual world as the
content — the current near-black `#16222c` sider is the loudest element on every screen and
carries zero meaning. The 🧱 emoji wordmark is replaced by the word **SmartBlok** set in
15px/600 with a 6px-radius primary-color monogram block ("S") beside it.

- **Sidebar**: 240px, collapsible to a 64px icon rail (state persisted in `localStorage`).
  Nav items are 34px-high pills: 16px icon + 14px label; the active item gets a primary-tint
  pill (`rgba(46,101,132,0.10)` light / `rgba(100,160,194,0.16)` dark) and primary-colored
  text — no left borders, no inverse blocks. Group labels are 11px/600 uppercase,
  letter-spacing 0.06em, `text/tertiary`, 24px top margin. Every item has an icon (collapsed
  rail must never show blank rows — a current defect).
- **Header** (56px, `bg/surface`, hairline bottom border): left — a **real search field-shaped
  button** 280px wide, placeholder «Qidiruv… `Ctrl+K`» (the current dead grey hint text
  becomes clickable and opens the palette). Right — the **LiveDot** (see §5) showing true
  socket state (`● Jonli` green / `● Ulanmoqda…` amber pulse / `● Oflayn` grey, with
  last-updated tooltip — the hardcoded LIVE tag dies), the theme toggle (sun/moon icon button,
  not a Switch), and the user chip: initial avatar + name + *localized* role label from one
  shared `ROLE` map («Administrator», «Buxgalter», «Agent», «Kassir» — the raw `ADMIN` enum
  never renders again). Dropdown: Profil · Chiqish.
- **Content**: 24px padding, max-width 1440px centered (calm reading measure on ultrawide
  monitors); print CSS strips shell (`no-print` retained).
- **No breadcrumbs in the header** — orientation lives in each page's `PageHeader` component
  (§5), giving one consistent place for title, trail, and actions.

### 2.2 Navigation tree per role (exact items, Uzbek labels, order)

**ADMIN** (everything):

| Group | Items (in order) | Route |
|---|---|---|
| — | **Bosh sahifa** | `/` |
| **SAVDO** | Buyurtmalar | `/orders` |
| | Mijozlar | `/clients` |
| | Qarzlar | `/debts` |
| **MOLIYA** | To'lovlar | `/payments` |
| | Kassa | `/kassa` |
| | Xarajatlar | `/expenses` |
| | Hisobotlar | `/reports` |
| **TA'MINOT** | Zavodlar | `/factories` |
| | Paddonlar | `/pallets` |
| | Bonus hamyonlar | `/bonus` |
| | Ta'minot matritsasi | `/procurement` |
| **KATALOG** *(collapsed by default)* | Mahsulotlar | `/products` |
| | Moshinalar | `/vehicles` |
| | Agentlar | `/agents` |
| | Hududlar | `/regions` |
| | Yuridik shaxslar | `/legal-entities` |
| **TIZIM** *(collapsed by default)* | Foydalanuvchilar | `/users` |
| | Tizim sozlamalari | `/settings` |
| | Excel import | `/import` |

**ACCOUNTANT**: identical minus Foydalanuvchilar and Excel import; «Tizim sozlamalari» remains
but opens the **read-only** settings view (GET `/settings` already permits ACCOUNTANT — the
business parameters that constrain their daily work stop being invisible). The Import
role-drift is resolved by *hiding* `/import` from ACCOUNTANT entirely, matching the
`@Roles('ADMIN')` reality of every import endpoint.

**AGENT** (sidebar on desktop, bottom tab bar on mobile — §8):

| Item | Route | Note |
|---|---|---|
| Bosh sahifa | `/` | scoped dashboard incl. the **/agents/me** standing card |
| Buyurtmalar | `/orders` | own orders |
| Mijozlar | `/clients` | own clients |
| Qarzlar | `/debts` | own clients, no company summary |
| To'lovlar | `/payments` | own CLIENT_IN |
| Paddonlar | `/pallets` | read-only, scoped |

**CASHIER** (a terminal, not an ERP — three items, no groups):

| Item | Route |
|---|---|
| Kassa | `/kassa` *(landing page)* |
| To'lovlar | `/payments` |
| Xarajatlar | `/expenses` |

Ordering rationale: groups are sorted by *frequency of touch*, and within groups by the daily
rhythm (orders before clients before debts; payments before the cash log). Excel import — a
one-time migration tool — falls to the very bottom of TIZIM instead of sitting between
Hisobotlar and Ta'minot matritsasi as it does today.

### 2.3 Global search & command palette (`Ctrl+K`)

One surface, three result groups, in priority order:

1. **Yozuvlar (records)** — live server search as you type: clients by name/phone/alias
   (existing clients search), orders by `ORD-______` number or client (existing orders
   search), payments by party (existing payments search). Each result row: icon, primary
   text, secondary meta (balance for clients, date + amount for payments), and jumps straight
   to the detail document.
2. **Amallar (actions)** — «Yangi buyurtma», «To'lov qabul qilish», «Yangi xarajat», «Paddon
   qaytarish qabul qilish» — role-filtered; selecting one opens the corresponding flow.
3. **Sahifalar (pages)** — the current route list with Uzbek/Russian/English synonym keywords
   (kept from today's palette).

Recents (last 5 visited records) show before typing. `↑↓` navigate, `Enter` opens, `Alt+Enter`
opens in a background tab. The palette is the mouse-user's search too — the header field opens
it on click.

### 2.4 Keyboard grammar (desk roles)

| Key | Anywhere | On a list page | In a stepper/form |
|---|---|---|---|
| `Ctrl+K` | palette | — | — |
| `/` | — | focus the FilterBar search | — |
| `C` | — | primary create action | — |
| `↑` `↓` `Enter` | — | move row focus / open | — |
| `Alt+←` `Alt+→` | — | — | previous / next step |
| `Ctrl+Enter` | — | — | submit |
| `Esc` | close drawer/modal | clear row focus | cancel (with dirty-check) |

All shortcuts are advertised in-place (kbd hints in tooltips and at the foot of steppers),
never required.

---

## 3. Information architecture

### 3.1 Full route tree with role access

`A` = ADMIN, `B` = ACCOUNTANT (Buxgalter), `G` = AGENT (server-scoped), `K` = CASHIER.
**(new)** marks routes that do not exist today; every new route is powered by an *existing*
endpoint.

```
/login                                  public
/                                       A B G K     role-variant dashboard (K → kassa terminal)
/orders                                 A B G       URL filters: ?status&search&client&factory&from&to&page
/orders/new                             A B G       3-step guided flow
/orders/:id                             A B G(own)  document page
/orders/:id/edit           (new)        A B         wires PUT /orders/:id (NEW/CONFIRMED + PROVISIONAL only)
/clients                                A B G(own)
/clients/:id                            A B G(own)  document page + statement
/payments                               A B G(own) K   ?kind&method&client&factory&reconciled&voided&from&to
/payments/:id               (new)       A B G(own) K   URL-addressed detail drawer over the list
      └ allocation panel    (new)       A B         wires POST /payments/:id/allocations
/debts                                  A B G(own)  three-sided balances hub (Mijozlar/Zavodlar/Shofyorlar)
/kassa                                  A B K
/expenses                               A B K
/pallets                                A B G(read)
/factories                              A B
/factories/:id                          A B         settlement hub (statement + wallet + actions)
/bonus                                  A B         cross-factory wallet overview + journal
/products                               A B
/procurement                            A B         two tabs: Matritsa | Marshrutlar (new — routes CRUD)
/vehicles                               A B
/vehicles/:id               (new)       A B         wires GET /vehicles/:id — driver settlement hub
/agents                                 A B
/agents/:id                             A B
/me                         (new)       G           wires GET /agents/me — agent standing card
/regions                                A B
/legal-entities                         A B         (CASHIER retains API read for payment forms; no nav item)
/reports                                A B         Svod | Reestr | Agentlar reytingi (?month wired)
/import                                 A           (ACCOUNTANT removed — matches backend @Roles)
/users                                  A
/settings                               A (write) B (read-only view)
/profile                                A B G K
/print/waybill/:orderId     (new)       A B         print route, GET /orders/:id data
/print/invoice/:orderId     (new)       A B G(own)
/print/receipt/:paymentId   (new)       A B G(own) K
/print/statement/:clientId  (new)       A B G(own)  ?from&to — GET /debts/statement data
```

**URL-synced filters are a platform rule**: every list's filter state (tabs, search, selects,
ranges, page, density) serializes to search params via one shared hook (`useUrlFilters`).
Back-button restores context; any KPI drill-down is just a link to a parameterized list.

### 3.2 Where the 26 existing pages land

| Today | Fate in Progressive Calm |
|---|---|
| Dashboard | **Rebuilt** — tiered morning-brief layout (§7.1); CASHIER variant becomes the Kassa terminal landing |
| Orders | **Rebuilt** — worklist chips + calm table, URL filters, totals footer |
| NewOrder | **Rebuilt** — 3-step guided stepper + persistent SummaryRail |
| OrderDetail | **Rebuilt** — tabless document; tabs (To'lovlar/Paddonlar/Tarix/Izohlar) become in-flow sections; comments and timeline **merge** into one activity feed |
| Payments | **Rebuilt** — verb-first creation, `/payments/:id` deep link, AllocationPanel, reconciliation queue via `?reconciled=false` |
| Kassa | **Rebuilt** — one period control; cashbox cards act as filters; per-currency totals |
| Debts | **Promoted** — becomes the three-sided balances hub (client rows + factory & vehicle sides), the workbook's Свод-at-a-glance |
| Pallets | **Simplified** — single balances table with side switcher, kebab row actions, balance-aware modals |
| Clients | **Kept, filtered** — structured FilterBar (region/agent/status/balance-state where API allows) |
| ClientDetail | **Rebuilt** — document page with action header («Yangi buyurtma», «To'lov qabul qilish», «Akt sverki») |
| Factories | Kept, thinner — balance columns unified with pallet module math via detail links |
| FactoryDetail | **Promoted** — settlement hub: pay / allocate / spend bonus / return pallets, pre-scoped |
| Bonus | **Kept, demoted** — overview + journal; actions duplicated *in context* on FactoryDetail |
| Products | **Kept + price-book drawer redesigned** (per-kind history, current/future markers) |
| Procurement | **Split into tabs** — Matritsa (grouped per product) + **Marshrutlar** (new routes CRUD UI) |
| Vehicles | Kept; rows now open **VehicleDetail (new)** |
| Agents / AgentDetail | Kept; AgentDetail gains period selector via dashboard `?month` ranking data |
| Regions | Kept as-is (calm table + modal) |
| LegalEntities | Kept; **payment form finally consumes it** (payer/receiver entity Select) |
| Reports | **Rebuilt** — Svod expanded by default with sticky subtotals + drill links; Reestr with column presets; Agentlar reytingi moves in with a month picker |
| Expenses | Kept + filtered-total header, three-state voided filter |
| Import | **Rebuilt** — staged layout, checks table with expected/actual/Δ, mismatch triage (explained vs unexplained), single-modal rollback |
| Users | Kept + search/role/status filters, symmetric activate/deactivate, email column |
| Settings | Kept; read-only variant for ACCOUNTANT; `saleMarginMinPct` field flagged «hozircha qo'llanilmaydi» pending owner decision |
| Profile | **Simplified** — one editable card (duplicate read-only block dies), email field added |
| Login | Kept, restyled |

**Pages that die**: none outright — but the *Tabs component* dies on every detail page, the
*dark sider* dies, the static *LIVE tag* dies, and the standalone «Kutilayotgan tushum»
dashboard card (a byte-for-byte duplicate of «Mijozlar qarzi») dies; expected collections
lives only on `/debts` where its `?days` window control gives it meaning.

### 3.3 Cross-link matrix (round-trip navigability contract)

Every cross-entity reference in the app must be a working link whose destination can carry
the user back with context intact. The dead `?paymentId=` deep link is the cautionary tale;
this matrix is the audit checklist:

| From | Link | To | Back guarantee |
|---|---|---|---|
| Dashboard tile / chip | parameterized route | filtered list | URL filters restore on Back |
| Debts client row | name / row | `/clients/:id` | Back returns to filtered hub |
| Debts factory / vehicle row | row | `/factories/:id` · `/vehicles/:id` | same |
| Order document | client name | `/clients/:id` | breadcrumb + Back |
| Order Moliya allocations | payment no | `/payments/:id` (drawer over list) | Esc returns; URL shareable |
| Payment drawer | order no in allocations | `/orders/:id` | breadcrumb |
| Payment drawer | cashbox name | `/kassa?box=` | URL filter |
| Kassa feed row | linked document | payment/expense drawer | Esc returns to scrolled feed |
| Bonus journal row | order / payment | respective documents | breadcrumb |
| FactoryDetail statement row | source document | order / payment | breadcrumb |
| ClientDetail «Hammasi →» | orders/payments | `/orders?client=` · `/payments?client=` | filters in URL |
| Svod client/factory cell | name | detail documents | Back restores expanded report |
| Agents ranking row | agent | `/agents/:id` | Back to dashboard/report |
| Import flagged payments | «navbatga o'tish» | `/payments?reconciled=false` | URL filter |
| Procurement dropped row | reason chip action | product price drawer / routes tab | Back |
| Regions client count | count link | `/clients?region=` | URL filter |

### 3.4 Responsive breakpoints

| Breakpoint | Shell | Lists | Detail documents |
|---|---|---|---|
| ≥1280px | sidebar 240px + DocAnchors rails | full tables | two-zone (document + anchors) |
| 1024–1279px | sidebar collapses to 64px rail | full tables, horizontal scroll inside card | single column, anchors hidden |
| 768–1023px | rail; header search collapses to icon | tables keep ≤6 priority columns, rest in row-expand | single column |
| <768px (AGENT-first) | bottom tab bar (§8.1) | card lists | accordion sections, sticky action bar |

---

## 4. Design language

All values are concrete AntD v6 `ConfigProvider` tokens or custom CSS constants. One
`tokens.ts` file is the single source; both themes are first-class.

### 4.1 Color system

**Brand & interaction**

| Token | Light | Dark | Use |
|---|---|---|---|
| `colorPrimary` | `#2E6584` | `#64A0C2` | actions, links, active nav, focus rings |
| `colorPrimaryHover` | `#3B7699` | `#7FB2CF` | |
| `colorPrimaryBg` (tint) | `rgba(46,101,132,.10)` | `rgba(100,160,194,.16)` | active pill, selected row |

**Surfaces** (spacing over borders: cards are flat surfaces on a faintly warm canvas)

| Token | Light | Dark |
|---|---|---|
| `colorBgLayout` (canvas) | `#F6F6F3` | `#101214` |
| `colorBgContainer` (card/surface) | `#FFFFFF` | `#17191C` |
| `bg/subtle` (table header, rails, code) | `#FAFAF8` | `#1C2024` |
| `bg/sidebar` | `#FBFBF9` | `#141619` |
| `colorBorderSecondary` (hairline) | `#E9E8E3` | `#2A2F34` |
| `colorSplit` | `rgba(0,0,0,.05)` | `rgba(255,255,255,.06)` |

**Text**

| Token | Light | Dark |
|---|---|---|
| `colorText` | `#1F2328` | `#E8EAEC` |
| `colorTextSecondary` | `#646A70` | `#A5ABB2` |
| `colorTextTertiary` | `#9AA0A6` | `#737980` |

**Semantic (verdict) colors** — the only saturated colors on a normal screen:

| Meaning | Light | Dark | Where |
|---|---|---|---|
| Debt / overdue / void / danger | `#B3362E` | `#E5736B` | «Qarz» balances, «Muddati o'tgan», void actions |
| Advance / settled / final / success | `#1E7A46` | `#58B383` | «Avans», «Tannarx qotirilgan», paid |
| Provisional / pending / unreconciled | `#9A6700` | `#D9A521` | «Taxminiy», «Narxlanmagan», «Tekshirilsin», PARTIAL |
| Info / in-progress | = `colorPrimary` | = `colorPrimary` | CONFIRMED…DELIVERING pills, links |

Chart series stay CVD-safe: `#1F6F9E` (savdo) and `#B47A00` (yig'ilgan) in light;
`#64A0C2` / `#D9A521` in dark — never red/green pairs on the same chart.

**Status pill palette** (tinted-bg pills, 10–14% alpha bg + full-strength text — no solid
AntD Tag colors):

| Status | Treatment |
|---|---|
| NEW «Yangi» | neutral: `text/secondary` on `bg/subtle` |
| CONFIRMED «Tasdiqlangan» / LOADING «Yuklanmoqda» / DELIVERING «Yetkazilmoqda» | primary tint, with a 6px progress tick underline that fills across the three stages |
| DELIVERED «Yetkazildi» | primary tint, full underline |
| COMPLETED «Yakunlandi» | success tint |
| CANCELLED «Bekor qilindi» | danger tint, strikethrough order number in lists |
| Cost: PROVISIONAL/PARTIAL → amber tint «Taxminiy» / «Qisman»; FINAL → success «Qotirilgan» |
| Transport: UNPAID danger «To'lanmagan», PAID success, PAID_BY_CLIENT primary «Mijoz to'lagan», UNKNOWN amber outline «Aniqlanmagan» (a real state the owner must resolve — never grey) |

### 4.2 Typography scale

Font stack unchanged: `'Segoe UI Variable Text','Segoe UI',system-ui,-apple-system,sans-serif`
(zero external fonts — CSP-safe, fast in Khorezm bandwidth). `font-variant-numeric:
tabular-nums` on every numeric cell, stat, and money figure via the existing `.num` class.

| Style | Size/Line | Weight | Use |
|---|---|---|---|
| Display | 28/36 | 600 | hero balances on document pages, dashboard hero KPI |
| H1 | 20/28 | 600 | PageHeader title |
| H2 | 16/24 | 600 | document section headings |
| H3 | 14/22 | 600 | card titles, table group headers |
| Body | 14/22 | 400 | default |
| Body-strong | 14/22 | 570 (var. weight; 600 fallback) | emphasized cells, primary money |
| Caption | 12/18 | 400 | meta lines, helper text, group labels |
| Mono-num | 13/20 tabular | 450 | table money/qty columns |
| Kbd | 11/16 | 500 | shortcut hints |

AntD tokens: `fontSize: 14`, `fontSizeHeading3: 20`, `lineHeight: 1.57`.

### 4.3 Spacing, radius, elevation

- **Spacing scale** (4-base): `4, 8, 12, 16, 20, 24, 32, 48, 64`. Page gutter 24; card
  padding 20; gap between document sections 32; gap between related controls 8; FilterBar
  internal gap 8.
- **Radius**: cards & drawers 10; inputs/buttons 7 (`borderRadius: 7`); status pills 999;
  modals 12. One radius family, no mixing.
- **Elevation**: level 0 = flat surface on canvas, **no border, no shadow** (whitespace
  separates); level 1 (sticky rails, dropdowns) = hairline border; level 2 (drawers, modals,
  palette) = `0 8px 24px rgba(15,20,25,.10)` light / `0 8px 24px rgba(0,0,0,.45)` dark.
  Tables inside cards use row hairlines (`colorSplit`) only — no vertical rules, no outer
  border, header on `bg/subtle`.

### 4.4 Motion

Two easings, three durations — nothing else:

| Token | Value | Use |
|---|---|---|
| `ease-out-calm` | `cubic-bezier(0.22, 1, 0.36, 1)` | entrances: drawers, palette, section expand |
| `ease-standard` | `cubic-bezier(0.4, 0, 0.2, 1)` | hovers, pill/underline transitions |
| fast | 120ms | hover states, focus rings, row highlight |
| mid | 200ms | drawer/modal/palette in-out, disclosure expand/collapse |
| slow | 240ms | stepper step transition (horizontal 12px slide + fade) |

What animates: surface entrances, disclosure open/close, the status-pill underline on
transition, the LiveDot pulse while reconnecting, row flash (`colorPrimaryBg`, 800ms fade)
when a socket event updates a visible row. What **never** animates: numbers (no count-ups —
money must be stable the instant it renders), charts beyond initial 200ms draw, layout shifts
on data refresh (react-query `keepPreviousData` everywhere). `prefers-reduced-motion` disables
all of it.

### 4.5 Table density & behavior

- Default row height **40px** (10px block padding, 13px mono-num); a density toggle in every
  table's toolbar switches to **32px compact** (persisted per user in localStorage). Header
  row 36px, 12/600 uppercase-free labels, `bg/subtle`.
- Whole rows are clickable (hover: `bg/subtle`; focused row: 2px primary inset outline);
  explicit actions live in a right-aligned kebab menu with *labeled* items — icon-only
  buttons die.
- Numeric columns right-aligned tabular; first column is the identity link; status pills
  never exceed one per column.
- Every money table gets a **TotalsFooter** for the current page («Sahifa jami») and, where
  the API returns filtered aggregates, for the whole filter («Jami») — always labeled which.
- Pagination bottom-right, 20/page default; «Jami: N ta» bottom-left.
- Voided/cancelled rows: 60% opacity + strikethrough identity cell, *hidden by default*
  behind a three-state filter chip («Bekorlar: yashirin / ko'rsatish / faqat»).

### 4.6 Number, money, date rules

- **Money**: whole so'm, space-grouped thousands (`1 250 000`), tabular. Full figures always
  visible on desk surfaces; `fmtShort` («1.2 mlrd») is allowed only on AGENT mobile cards and
  chart axes — and then the full value renders as a permanent secondary caption, never a
  hover-only tooltip.
- **Signed balances** render as *verdict framing*, never bare minus signs: `1 250 000 so'm
  Qarz` (danger) / `1 250 000 so'm Avans` (success) / `Hisob yopiq` when `|balance| < 1` (the
  settled-epsilon rule). Raw `+/−` signs appear only in statement amount columns where
  direction is the point.
- **Per-m³ prices** display up to 6dp as stored (`729 928.1` stays exact); **volumes** 3dp
  with `m³`; **pallets** are counts with «dona».
- **Dates**: `DD.MM.YYYY`, datetimes `DD.MM.YYYY HH:mm`; all pickers and range presets
  operate in Tashkent-local days (labels: Bugun · Kecha · 7 kun · 30 kun · Oy boshidan).
- **Locale**: the mixed `ru_RU` ConfigProvider dies. We ship a hand-written `uz_Latn` AntD
  locale object (pagination, picker months, empty texts — ~40 strings, frontend-only) and set
  dayjs to an `uz-latn` locale. Digit grouping keeps the space separator (correct for UZS).
  One glossary is fixed app-wide: *Shofyor* (not Haydovchi), *Paddon*, *Buxgalter* (not
  Hisobchi), «Bekor qilingan» for voided. The full glossary is Appendix E.

### 4.7 Feedback, loading, empty, and error states (platform rules)

Calm software is predictable under every condition, not just the happy path. These rules are
uniform across all screens:

- **Toasts** are for *confirmations only* — one line, Uzbek verb-first («To'lov saqlandi»,
  «Buyurtma bekor qilindi»), 3s, top-center, never stacked more than 2. Toasts never carry
  errors that require action.
- **Errors live where the user acts**: field errors inline under the field; form-level
  server rejections in a quiet danger panel *inside the form/rail* rendering the server's
  Uzbek message verbatim (credit-limit rejections include the server's own figures);
  page-load errors as the existing `ErrorPane` (Alert + «Qayta urinish») in place of
  content. No error modal ever interrupts unrelated work.
- **Loading**: skeletons mirror the final layout (PageHeader title bar, hero number block,
  N table rows at the correct density) — no spinner-only screens; in-place refetches keep
  previous data (`keepPreviousData`) with a 1px progress shimmer under the PageHeader, so
  tables never blank or jump.
- **Empty states** always contain exactly one icon, one sentence, and one action («Hozircha
  buyurtmalar yo'q — Yangi buyurtma»). Filtered-empty differs from truly-empty: «Filtrga mos
  yozuv topilmadi — Filtrni tozalash».
- **Realtime**: socket events invalidate query families as today, but bursts are coalesced
  client-side in a 2s window before refetch (the refetch-storm mitigation); a row visible on
  screen that changes flashes `colorPrimaryBg` once (800ms). When the socket is down,
  `LiveDot` says so and refetch-on-focus turns on — staleness is never silent.
- **Dirty-state protection**: steppers and drawers with entered data intercept close/back
  with one confirm («Kiritilgan ma'lumotlar saqlanmagan»); saved filters and URL state make
  everything else safely abandonable.
- **Double-submit**: every money-writing form disables its submit on flight and relies on
  the server idempotency key — a double-click can never post twice, and the UI never has to
  apologize for it.

### 4.8 Accessibility & focus discipline

- Focus is always visible: 2px primary outline, 2px offset, on every interactive element —
  including table rows (roving tabindex) and status pills that act as filters.
- Drawers and modals trap focus, return it to the invoking element on close, and set
  `aria-labelledby` from their title; `Esc` closes (with dirty-check).
- Icon-only controls are extinct in the primary UI; the few that remain (kebab, theme
  toggle, density) carry `aria-label`s in Uzbek.
- Color is never the only carrier: debt/advance always paired with the word («Qarz» /
  «Avans»), overdue with text, chart series with direct labels at line ends, not just a
  legend.
- Contrast: all text tokens meet WCAG AA on their surfaces in both themes (verified pairs:
  `#646A70` on `#FFFFFF` = 5.9:1; `#A5ABB2` on `#17191C` = 7.2:1; semantic colors ≥ 4.5:1
  on both canvases).
- Touch targets ≥ 44px on agent-facing pages; desktop compact density never applies to
  mobile layouts.

---

## 5. Component system

The reusable kit this vision requires. Each component: purpose, anatomy, states. All are thin
compositions over AntD primitives + tokens — no parallel design system.

### 5.1 `PageHeader`
- **Purpose**: one consistent identity block on every page; kills the level-3-vs-level-4
  title drift and the missing breadcrumbs.
- **Anatomy**: breadcrumb trail (Caption, links, e.g. `Buyurtmalar / ORD-000123`) → H1 title
  row (title + optional status pill + optional meta caption like «12.07.2026 · Jasur Versal»)
  → right slot: 0–1 primary Button, 0–2 default Buttons, overflow «⋯» menu for the rest.
  Optional bottom slot for view chips (worklist filters).
- **States**: loading (title skeleton), sticky-condensed (on scroll, collapses to 48px:
  breadcrumb hides, title 16px, actions stay — the next action is never scrolled away).

### 5.2 `StatTile`
- **Purpose**: drillable KPI. Every number on the dashboard is a link.
- **Anatomy**: Caption label → Display/H2 value (full grouped so'm, `.num`) → optional
  secondary line (delta vs previous period: `▲ 12% o'tgan oyga nisbatan`, colored by
  *business* goodness not sign — debt going up is red) → optional 32px sparkline (from
  already-fetched trends data) → whole tile is an anchor to a parameterized route.
- **States**: default, hover (bg/subtle + «→» affordance in corner), loading skeleton, error
  (inline retry link), pressed.

### 5.3 `MoneyCell` / `BalanceText`
- **Purpose**: single rendering path for money; kills copy-pasted formatters.
- **Anatomy**: `MoneyCell` — right-aligned tabular figure, optional signed coloring, optional
  caption sub-line (`usd 1 200 × 12 650`). `BalanceText` — verdict framing («Qarz» / «Avans»
  / «Hisob yopiq») with semantic color; sizes S(13) M(14) L(20) XL(28 display).
- **States**: settled (renders `0 so'm · Hisob yopiq`, tertiary), provisional (amber dot
  prefix + tooltip «Tannarx hali qotirilmagan»).

### 5.4 `FilterBar`
- **Purpose**: URL-synced filtering on every list; one grammar app-wide.
- **Anatomy**: 36px row — search input (`/` focuses, 240px, debounced 300ms) · 2–3
  first-class Select filters (server-searched, paginated — the 200-option truncation dies) ·
  RangePicker with Tashkent presets · «Yana filtr» popover for rare filters · active-filter
  chips with per-chip clear · «Tozalash» ghost link when ≥1 active.
- **States**: idle, active (chips visible), synced-from-URL (renders identically), disabled
  during first load.

### 5.5 `WorklistChips`
- **Purpose**: progressive disclosure of exceptions — the calm alternative to alarm
  dashboards. A row of count chips above a list; each chip is a saved filter.
- **Anatomy**: pill chips: label + count badge, e.g. «Narxlanmagan 3» (amber), «Muddati
  o'tgan 7» (danger), «Tekshirilsin 12» (amber, `?reconciled=false`), «Yo'lda 5» (primary,
  in-flight statuses). Clicking applies the URL filter; active chip is filled.
- **States**: zero-count chips *hide themselves* — a clean day shows a clean page.
- **Honesty rule**: a chip exists only where the API can actually filter or the count is
  server-computed (in-flight from `/dashboard/summary`, overdue from `/debts`, reconciled
  from `?reconciled=`); no fake client-side scans of partial pages.

### 5.6 `PartyHeader`
- **Purpose**: hero block of every party document (client, factory, vehicle, agent).
- **Anatomy**: left — H1 name + status pill + Caption meta (agent · region · phone);
  right — XL `BalanceText` verdict + secondary chips (`PalletChip`, bonus wallet for
  factories, credit `CreditGauge` for clients); beneath — action row of 2–3 contextual
  buttons («To'lov qabul qilish», «Yangi buyurtma», «Akt sverki ⎙»).
- **States**: loading skeleton (name + number shimmer), inactive party (grey wash + «Nofaol»
  pill), agent-view (financial actions hidden per role matrix).

### 5.7 `PartyStatement`
- **Purpose**: the running-balance ledger document — the single most trusted artifact.
- **Anatomy**: period control (from/to, presets) → opening balance line («Boshlang'ich
  qoldiq») → table: Sana · Hujjat (source label in Uzbek from ONE shared `LEDGER_SOURCE`
  map, linked to order/payment) · Izoh · Summa (signed, `+/−`) · Qoldiq (running,
  verdict-colored) → closing balance line. Reversal pairs render linked: the reversal row
  shows «↩︎ storno» and hovering either row highlights both.
- **States**: windowed (opening ≠ 0 explained), unreconciled rows (amber left rule +
  «Tekshirilsin»), print mode (becomes the akt sverki body, §9.4).

### 5.8 `StatusFlow`
- **Purpose**: order lifecycle as *current state + one legal next action*, not a permanent
  6-step frieze.
- **Anatomy**: status pill + thin 4px progress track (6 segments, filled to current) + the
  single role-legal primary action button labeled as a verb («Tasdiqlash» → «Yuklashni
  boshlash» → …). For ADMIN/ACCOUNTANT an adjacent «⋯» menu discloses privileged moves:
  skip-forward targets and «Bir qadam orqaga» (opens ReasonModal — the API's transition note
  finally gets UI). Blockers render *in place of* the action: no vehicle at CONFIRMED ⇒
  amber inline notice «Moshina biriktirilmagan» + «Moshina biriktirish» button (minimal
  `PUT /orders/:id` resending current items + vehicleId) — the dead-end toast dies.
- **States**: advancing (button spinner, track segment fills at 200ms), cancelled (track
  replaced by danger banner with reason + date), completed (success fill + «Bonus hisoblandi»
  caption when an accrual was posted).

### 5.9 `SummaryRail`
- **Purpose**: the persistent live consequence panel of every stepper (P2).
- **Anatomy**: sticky 320px right rail (bottom sheet on mobile): party line with current
  balance → accumulating figures grouped by section (Yuk: paddon/capacity meter + m³ + sale
  sum; Transport: cost/charge/profit; the money line «Mijoz qarziga yoziladi» = sale +
  charge) → projected balance after save (`BalanceText` L) → `CreditGauge` headroom →
  validation notices (capacity exceeded = danger and submit-blocking; near credit limit =
  amber «server tekshiradi»).
- **States**: empty (quiet placeholders), computing (values settle without layout shift),
  blocking-error (rail header turns danger, submit disabled with reason).

### 5.10 `AllocationPanel`
- **Purpose**: the settlement surface — allocate a payment across open orders; the weakest
  UX in v3 becomes a first-class component (used in the payment drawer, FactoryDetail,
  VehicleDetail).
- **Anatomy**: header — payment amount · allocated · **«Taqsimlanmagan: X so'm»** live
  remainder; body — the party's open orders (existing party-filtered orders query; each
  candidate's outstanding lazily computed from its detail allocations), rows: orderNo ·
  date · total · outstanding · amount input (auto-suggested = min(remainder, outstanding));
  footer — «Eng eskisidan taqsimlash» button (fills oldest-first; always user-confirmed,
  never auto-committed) + price-basis banner for FACTORY_OUT: «Ushbu to'lov usuli: NAQD →
  zavod naqd narxi qo'llanadi» with the finalization consequence (PROVISIONAL → FINAL) named
  before commit.
- **States**: fully allocated (success line), over-allocation (input-level inline error, not
  a page banner), locked (CASHIER/AGENT see read-only rows — «Taqsimlash buxgalter
  tomonidan bajariladi»).

### 5.11 `KindPicker`
- **Purpose**: verb-first payment creation; the morphing 720px mega-modal dies.
- **Anatomy**: the «Yangi to'lov» button opens a menu of verbs (role-filtered): «Mijozdan
  qabul qilish» · «Zavodga to'lash» · «Shofyorga to'lash» · «Mijoz shofyorga to'ladi» ·
  «Mijozga qaytarish» · «Zavoddan qaytim». Each opens the *same* PaymentDrawer pre-bound to
  a kind, so only that kind's fields exist (party → amount/method → cashbox → optional
  allocation step).
- **States**: AGENT sees exactly one verb; contextual launches (from Debts row, from
  FactoryDetail) skip the picker entirely.

### 5.12 `PaymentDrawer`
- **Purpose**: create/view a payment; URL-addressed at `/payments/:id`.
- **Anatomy (create)**: 480px drawer, two steps max — 1) party (pre-filled when contextual;
  option rows show `BalanceText`), date, method segmented control, amount (USD: usd + rate
  inputs, rate pre-filled from the last USD payment's rate visible in the list cache, UZS
  preview read-only), cashbox Select filtered to currency *showing live box balance*,
  payer/receiver **legal-entity Select** (active entities + free-text fallback — the catalog
  finally drives payments), note; 2) (ADMIN/ACCOUNTANT, allocatable kinds) AllocationPanel.
  TRANSPORT_DIRECT: cashbox field absent + info line «Bu to'lov kassadan o'tmaydi». Fresh
  idempotency key per open; submit is double-click-safe.
- **Anatomy (view)**: verdict header (kind verb + amount + state pill) → KeyValueList →
  AllocationPanel (read or edit per role) → ledger postings in Uzbek labels → void action.
- **States**: voided (danger banner + reason), unreconciled (amber banner «Import
  tekshiruvida» — statement/list rows carry the same marker).

### 5.13 `ReasonModal`
- **Purpose**: one controlled surface for every destructive/privileged act (void, cancel,
  storno, step-back). The closure-variable `modal.confirm` anti-pattern dies.
- **Anatomy**: danger-styled modal: impact preview list (computed from data already on
  screen: «3 ta taqsimot bekor bo'ladi», «Tannarx PROVISIONAL holatga qaytadi», «Bonus
  hisoblanishi storno bo'ladi», «Pul mijoz hisobida qoladi») → required reason TextArea with
  inline validation → typed-confirmation input only for import rollback («ROLLBACK») →
  danger confirm labeled with the verb.
- **States**: reason-empty (confirm disabled), submitting, server-error inline.

### 5.14 `CreditGauge`
- **Purpose**: credit headroom made visible before the server says no.
- **Anatomy**: 6px track: used vs limit, caption «Limit 50 mln · Bo'sh 12,4 mln»;
  `Cheklanmagan` renders as a quiet caption, `0` renders «Faqat oldindan to'lov» amber.
  Appears on client rows (compact), ClientDetail header, the order stepper client card, and
  the agent's `/me` card (agent debt-limit variant: Σ positive client balances vs effective
  limit).
- **States**: <70% quiet, 70–99% amber, ≥100% danger + «Yangi buyurtma bloklanadi».

### 5.15 `PalletChip`
- **Purpose**: in-kind pallet debt is never money — it gets its own visual atom so it can
  never be misread as so'm.
- **Anatomy**: bordered chip `⬛ 18 dona` (outline style, amber when >0 on a client, danger
  when negative), always adjacent to — never mixed into — money balances.
- **States**: zero (hidden in lists, `0 dona` on documents), with tooltip breakdown
  (delivered − returned − charged ± adjustments).

### 5.16 `LiveDot`
- **Purpose**: honest realtime state; binds to actual socket connection.
- **Anatomy**: 8px dot + caption in the header: `● Jonli` (success) / `● Ulanmoqda…` (amber,
  1.2s pulse) / `● Oflayn — oxirgi yangilanish 09:41` (grey). While offline, react-query
  refetch-on-focus turns on as a safety net.

### 5.17 `SectionCard` & `DocAnchors`
- **Purpose**: the document-page skeleton (P3).
- **Anatomy**: `SectionCard` — H2 heading + optional header meta/action + body, 32px gap
  between siblings, optional `collapsed` for secondary sections (Paddonlar, Tarix) that
  render header + one summary line until expanded. `DocAnchors` — sticky right mini-map of
  section links on ≥1280px, highlighting the section in view.

### 5.18 `ActivityFeed`
- **Purpose**: one merged timeline per document (statuses + payments + pricing + comments) —
  the duplicated Tarix/Izohlar tabs die.
- **Anatomy**: composer on top (comment input, `Ctrl+Enter` sends), then reverse-chron
  entries: icon by type, body, actor + timestamp caption; financial events link to their
  documents.
- **States**: filter chips (Hammasi / Izohlar / Moliya / Holat), empty («Hozircha yozuvlar
  yo'q»), pending-send optimistic row.

### 5.19 `PrintDocument`
- **Purpose**: shared frame for the four paper artifacts (§9).
- **Anatomy**: A4/A5 sheet frame — letterhead row (dealer name + legal entity, document
  title + number, date) → parties block → body table → totals block → signature row
  («Topshirdi ______ / Qabul qildi ______») → Caption footer «SmartBlok · chop etildi
  DD.MM.YYYY HH:mm · [user]». Print CSS: `@page` margins 14mm, black-on-white ink-safe,
  hairline table rules; on screen renders centered on canvas with a sticky «⎙ Chop etish»
  bar.

### 5.20 `MoneyInput`
- **Purpose**: one money entry control app-wide; the copy-pasted formatter/parser pair in
  NewOrder/OrderDetail/Payments dies.
- **Anatomy**: InputNumber with space-grouped live formatting, «so'm» suffix, `inputmode=
  "numeric"`, min 1 (the `min=0` foot-gun dies), optional max bound fed by live data (wallet
  balance, cashbox balance) with the bound printed as helper text; a USD twin variant pairs
  usd amount + rate and renders the computed UZS as read-only text (never editable — server
  computes).
- **States**: default, out-of-bound (inline error naming the bound: «Hamyonda 4 250 000
  mavjud»), suggestion-filled (pre-filled values render selected so one keystroke replaces
  them).

### 5.21 `PartySelect`
- **Purpose**: one shared, server-searched, paginated picker for clients/factories/vehicles
  — the six divergent ad-hoc selects (200-option caps, stale embedded balances) die.
- **Anatomy**: searchable Select, 300ms debounce, infinite scroll; option rows: name +
  `BalanceText` (semantic framing, not raw signed numbers) + caption meta (region/agent for
  clients, plate/driver for vehicles); a footer row shows «yana yozish orqali qidiring»
  when results are capped. Shares its react-query cache across all mounts.
- **States**: loading, no-results (with «Yangi mijoz…» inline-create for clients where the
  role allows), error (inline retry), scoped (AGENT sees only own clients — server does the
  scoping; the UI adds no fake options).

### 5.22 Supporting atoms
`KeyValueList` (label/value grid, 12/400 labels, values Body-strong), `TotalsFooter`,
`DeltaTag`, `EmptyState` (one icon + one sentence + one action — always an action),
`DensityToggle`, `RolePill` (shared ROLE map), `KbdHint`, `ErrorPane` (Alert + «Qayta
urinish», unchanged behavior, restyled).

---

## 6. The five hero workflows, redesigned step by step

### 6.1 (a) Create an order for a client who is on the phone with an agent

*Persona: ACCOUNTANT at the desk; the agent calls in a truck. (The agent's own phone flow is
§8.3 — same stepper, vertical.)*

Route: `/orders/new` — a full-page **3-step guided stepper** with the `SummaryRail` pinned
right. Steps across the top: **1 Mijoz → 2 Yuk → 3 Transport va tasdiqlash**. `Alt+→`
advances, `Ctrl+Enter` submits from anywhere when valid.

**Step 1 — Mijoz** (3 fields, nothing else on screen):
1. `C` on `/orders` (or palette → «Yangi buyurtma») opens the stepper with focus already in
   the client Select. Type «vers…» — server search, option rows show name + `BalanceText`
   («1 250 000 Qarz» red) + region caption. `Enter` selects.
2. The moment a client is chosen, a quiet **client card** materializes below the select
   (progressive disclosure): current balance, `CreditGauge` headroom, `PalletChip` 18 dona,
   «Muddati o'tgan: 1 ta» if any, agent name. The rail header fills with the same. The
   accountant reads the credit verdict to the agent *before any goods are entered* — the
   blocked-at-submit surprise dies here.
3. Sana (defaults today, `Tab` past it), and — because it decides the provisional cost —
   «Zavodga to'lov usuli (mo'ljal)»: segmented `BANK | NAQD` with caption «taxminiy tannarx
   narxini belgilaydi». `Alt+→`.

**Step 2 — Yuk** (the truck):
4. Product Select, grouped by factory, focused on entry. Picking the first product **locks
   the catalog to that factory** (caption appears: «Zavod: CAOLS KS — o'zgartirish», with an
   explicit escape that clears items) — mixing factories becomes impossible rather than
   correctable.
5. Item row: Paddon (InputNumber, ↑↓-steppable) → m³ autofills `pallets × m3PerPallet`
   (caption «1.728 × 11»); explicit m³ edits stick — a `≠` badge marks manual override and
   later pallet edits stop clobbering it. Price segment: `Katalog | Kelishilgan | Umumiy
   summa | Narxsiz` (last only ADMIN/ACCOUNTANT). Katalog shows the resolved effective price
   *for this client* (ClientPrice override included, labeled «maxsus narx» when it wins).
   Kelishilgan input validates the agent floor inline for AGENT users («Zavod bank narxidan
   past bo'lishi mumkin emas: 625 000»). «+ Mahsulot qo'shish» (Enter on the last field adds
   a row).
6. The rail live-updates: capacity meter «Paddon: 19 / 19» (fills; >capacity turns danger
   and blocks submit), Σ m³, «Sotuv: 23 950 000 so'm», and «Mijoz qarziga yoziladi» with the
   projected balance. `Alt+→`.

**Step 3 — Transport va tasdiqlash**:
7. Vehicle Select (option: name · plate · «19 paddon» · driver). Driver field autofills but
   only when untouched. Mode segmented: `Mijozning o'z transporti | Dilerning hisobidan |
   Mijozdan olinadi` — cost/charge inputs exist only for the modes that need them; a live
   the live split caption «dillerga X · shofyorga Y» appears for CLIENT_PAYS_DRIVER
   (transport is INSIDE saleTotal — [authoritative transport model](../00-business-map.md#transport-authoritative)). Entering a cost with no
   vehicle raises an amber inline notice: «Moshina tanlanmagan — shofyor qarzi hisobga
   olinmaydi» requiring an explicit checkbox to proceed.
8. Note textarea, then the **review block**: the whole order restated as a compact document
   (client, items, money lines, transport, «Qarzga yoziladi: sotuv + transport»), so the
   accountant reads the total back to the agent on the phone.
9. `Ctrl+Enter` → server transaction. Success: navigate to `/orders/:id`; the document opens
   with the NEW pill and a one-time toast «ORD-000124 yaratildi — qarz mijoz hisobiga
   yozildi». A credit/limit rejection renders the server's verbatim figures inside the rail
   (not a toast), with the client card highlighted.

Total keyboard path: `C → type client → Enter → Alt+→ → type product → Enter → pallets →
Alt+→ → vehicle → Ctrl+Enter`. Nine deliberate acts for a standard truck.

### 6.2 (b) Collect a payment on a debt, from the Debts view

*Persona: ACCOUNTANT (or CASHIER on `/payments`; AGENT variant in §8.4). Frequency: the most
common task in the company.*

1. `/debts` → «Mijozlar» side (default). WorklistChips: «Muddati o'tgan 7» — click narrows
   the table (URL: `/debts?overdue=1`). Rows sorted by debt desc: client · agent ·
   `BalanceText` · `PalletChip` · overdue pill with count+total *in the row* (not a tooltip)
   · muddati.
2. Focused row (`↑↓`), press `Enter` on the row's primary action or click **«To'lov qabul
   qilish»** in the row kebab. The `PaymentDrawer` opens over the list — *no navigation, no
   context loss* — pre-bound: kind = Mijozdan qabul qilish, client pre-filled with its
   `BalanceText` shown, **amount pre-filled with the outstanding balance** (editable — most
   collections are partial; the suggestion is a start, not a decision).
3. Method segmented (Naqd default) → cashbox Select filtered to UZS, each option shows the
   live box balance. USD path: usd amount + rate (pre-filled from the last used rate), UZS
   preview computed read-only, USD boxes only.
4. ADMIN/ACCOUNTANT optionally expand «Taqsimlash» (AllocationPanel): client's open orders,
   oldest-first auto-fill button. A cashier skips this — and the payment lands in the
   **allocation queue** the accountant works later (§7.5).
5. `Ctrl+Enter` → saved. The drawer flips to view-state with a success line and **«⎙
   Kvitansiya»** (opens `/print/receipt/:id`). Behind it, the debts row updates live via
   socket, flashing once; if settled, it leaves the default filter.

Four interactions replace today's five-page trek (leave Debts → Payments → modal → re-search
client → re-type amount).

### 6.3 (c) Settle with a factory (pay + allocate + finalize cost + spend bonus)

*Persona: ACCOUNTANT, weekly big-money session. Everything happens on `/factories/:id` — the
settlement hub — without ever re-selecting the factory.*

1. Open «CAOLS KS» (palette: `Ctrl+K → caols`). `PartyHeader`: XL BalanceText «973 619 270
   Avans» (or «… Qarz»), chips: `Bonus hamyon: 4 250 000` · `Paddon: 214 dona`. Action row:
   **«To'lov qilish»** · «Bonusni ishlatish ▾» · «Paddon qaytarish» · «⎙ Hisob-kitob».
2. Below, the document: **Ochiq buyurtmalar** section — this factory's orders with
   non-final cost (costStatus pill, provisional total, covered-so-far), then
   **Hisob-kitob** (PartyStatement), then Bonus and Paddon sections (collapsed summaries).
3. Click «To'lov qilish» → PaymentDrawer, kind = Zavodga to'lash, factory pre-bound. Amount
   2 000 000 000; method `O'tkazma`; cashbox «Bank (Септем Алока)» with live balance; the
   cashbox-never-negative rule surfaces as a live «qoldiq yetarli ✓» caption.
4. Step 2 — AllocationPanel with the price-basis banner: «Usul: O'TKAZMA → zavod o'tkazma
   narxi qo'llanadi». Open orders listed oldest-first with uncovered cost per order. «Eng
   eskisidan taqsimlash» fills inputs; the accountant reviews, adjusts the last partial row,
   sees «Taqsimlanmagan: 0». Each fully-covered row previews its consequence inline:
   «Tannarx qotiriladi (FINAL)» success pill; partial rows show «Qisman». `Ctrl+Enter`.
5. The document updates in place: covered orders' cost pills flip to «Qotirilgan», the
   statement grows a FACTORY_OUT row and COST_ADJUSTMENT deltas, the header balance
   recomputes, and if a completed order had a PERCENT program, the bonus section shows the
   traceable ADJUSTMENT row («Tannarx qotirilishi bo'yicha: +37 500»).
6. Spend the wallet without leaving: «Bonusni ishlatish ▾» → «Zavod qarziga o'tkazish»
   (modal: amount ≤ live wallet, shows remaining-after; explains the canonical chain: «BONUS
   usulidagi to'lov yaratiladi, kassadan o'tmaydi») or «Naqd yechish» (amount + UZS cashbox
   IN). Both actions also exist on `/bonus`, pre-scoped from the wallet card — but the hub
   makes the cross-page trek unnecessary.

### 6.4 (d) Settle transport with a driver

*Persona: ACCOUNTANT/CASHIER. New surface: `/vehicles/:id` — wiring the orphaned
`GET /vehicles/:id`.*

1. `/vehicles` list: rows show plate · shofyor · capacity · `BalanceText` («2 000 000 Qarzimiz»
   danger when negative). Click the row → **VehicleDetail** document.
2. `PartyHeader`: «Isuzu — 90 A 123 BA», driver + phone, XL balance «Biz qarzdormiz:
   2 000 000». Actions: **«Shofyorga to'lash»** · «⎙ Hisob-kitob».
3. Sections: **To'lanmagan yuklar** — from the endpoint's last-50 orders, rows filtered to
   `transportPaidStatus ∈ {UNPAID, UNKNOWN}`: orderNo · date · client · transport cost ·
   status pill (UNKNOWN rows amber «Aniqlanmagan» — the imported blanks the owner must
   resolve finally have a home); then the full **Hisob-kitob** statement; then «Oxirgi
   yuklar» (collapsed).
4. «Shofyorga to'lash» → PaymentDrawer, kind = Shofyorga to'lash, vehicle pre-bound,
   **amount pre-filled with the outstanding balance**, cashbox with live balance. Step 2:
   AllocationPanel listing exactly this vehicle's unpaid trucks (from the detail payload —
   the silently-incomplete 100-row client-side hack dies), oldest-first auto-fill.
   `Ctrl+Enter` → covered orders flip to «To'langan», the balance heads to «Hisob yopiq».
5. The client-paid case: on an order document's Transport section (or here), «Mijoz
   shofyorga to'ladi» opens the TRANSPORT_DIRECT drawer — client + vehicle pre-bound, no
   cashbox field, info line «Kassadan o'tmaydi: mijoz hisobi kamayadi, shofyor hisobi
   yopiladi» — the double-posting rendered in words. Allocation marks the truck «Mijoz
   to'lagan».

### 6.5 (e) The owner's morning check: dashboard → anomaly → act

*Persona: ADMIN, 8:30 with tea. Goal: 90 calm seconds to «all is well», or a direct path to
what isn't.*

1. `/` opens on the **Ertalabki holat** layout (§7.1). Line 1 — three hero StatTiles with
   full figures and deltas: «Bugungi savdo», «Oyda yig'ilgan to'lov», «Mijozlar qarzi».
   Line 2 — the **Diqqat talab qiladi** strip (WorklistChips, only non-zero chips render):
   today it shows «Muddati o'tgan mijozlar 7» · «Tekshirilsin to'lovlar 12» · «Yo'ldagi
   buyurtmalar 5» · «Narxlanmagan 2».
2. The debt tile's delta reads «▲ 8,4 mln kechadan beri» in danger — that's the anomaly.
   Click the tile → `/debts?sort=balance_desc` (URL-filtered, Back returns to the
   dashboard intact).
3. Top row: «Shiddat monalit — 46 200 000 Qarz», overdue pill «2 ta · 31 500 000». Click →
   ClientDetail. The header shows the verdict; the statement's most recent rows explain it:
   two trucks posted yesterday, no payments. The activity feed shows the agent's comment
   «to'lov juma kuni».
4. Act from the header, without navigation: «To'lov qabul qilish» if cash arrived; or «⎙
   Akt sverki» to print the statement for a hard conversation; or a comment in the feed
   («Jasur: juma — nazoratda») which timestamps the decision for the team.
5. Back (twice, filters intact) to the dashboard; the trend chart (now with a `7/30/90/365`
   range control wired to `?days`) and the Agentlar reytingi (month picker wired to
   `?month`, debt column honestly labeled «hozirgi qoldiq») fill the remaining minute.
   Every number he read was clickable; nothing required the sidebar.

### 6.6 Edge paths the five flows must survive (designed, not hoped for)

- **Order stepper — credit rejection**: the server rejects with its limit/current/new
  figures. The rail's projected-balance block turns danger and renders those figures; the
  client card gains a «Limitni ko'rish» link (office roles) to the client drawer. Nothing
  entered is lost; changing items or removing the transport charge re-validates live.
- **Order stepper — capacity rejection**: cannot happen — the rail blocks submit at
  `Σ paddon > capacity` with the vehicle's own number shown («Isuzu: 19 paddon»); switching
  vehicles re-evaluates.
- **Payment drawer — cashbox shortfall**: OUT payments show the live box balance next to
  the cashbox option; if the server still rejects (race), the inline panel prints the
  server's shortfall figure and the cashbox select re-fetches balances.
- **Allocation — «already allocated to this order»**: the panel disables order rows that
  already carry an active allocation from this payment, with the caption «avval bekor
  qiling» — the raw constraint error becomes unreachable.
- **Void cascades**: ReasonModal impact preview enumerates, from data already loaded: N
  allocations to void, orders whose cost reverts PROVISIONAL (named), transport statuses to
  re-derive, bonus wallet restoration for BONUS payments. The user confirms consequences,
  not prose.
- **Stepper resume**: a hard refresh mid-stepper restores entered values from
  sessionStorage (keyed per route, cleared on submit/cancel) — a phone call interrupting
  order entry costs nothing.
- **Concurrent edits**: if a socket event invalidates the document underlying an open
  drawer (e.g. someone else voided the payment), the drawer shows a quiet amber ribbon
  «Yozuv yangilandi — qayta yuklandi» and re-renders; forms in flight are never silently
  overwritten.

---

## 7. Screen-by-screen approach

### 7.1 Dashboard `/` (ADMIN · ACCOUNTANT)
Tiered morning brief replacing the flat 12-tile wall. **Tier 1**: three hero StatTiles
(Bugungi savdo · Oyda yig'ilgan · Mijozlar qarzi) — Display type, full so'm, deltas,
sparklines, each drilling to its filtered list. **Tier 2**: the «Diqqat talab qiladi»
WorklistChips strip (overdue clients, `?reconciled=false` count, orders in flight — the
until-now invisible `ordersInFlight` finally renders — and pending-price count). **Tier 3**:
two labeled bands of quiet secondary tiles — *Moliya*: Oy savdosi, Mahsulot foydasi (oy),
Transport foydasi (oy) (always separate, per the locked rule), Zavodlarga qarzimiz,
Shofyorlarga qarzimiz (also newly rendered), Bonus hamyonlar; *Logistika*: Mijozlardagi
paddonlar, Sotilgan hajm (oy). The duplicate «Kutilayotgan tushum» tile dies. **Tier 4**: the
trends chart with a `7/30/90/365` segmented range (wired to `?days`) and period totals in the
header; Agentlar reytingi with a month picker (`?month`), rows linking to `/agents/:id`.
LiveDot in the PageHeader is real. AGENT variant: same tiers scoped, plus the `/me` standing
card (§8.2) on top; CASHIER lands on the Kassa terminal (§7.6).

### 7.2 Orders `/orders`
PageHeader with «Yangi buyurtma» (`C`). Status Tabs strip survives (it matches the mental
model) but becomes quiet text-tabs with counts; WorklistChips add cross-cutting saved views
(Narxlanmagan, Aniqlanmagan transport) where server-filterable. FilterBar: search, client,
factory, range — all URL-synced. Table: orderNo (identity link) · sana · mijoz · zavod ·
moshina · **muddat** (dueDate, red when overdue — the column finally exists) · summa · cost
pill · status pill · transport pill; row kebab: «Ochish», «Tasdiqlash» (next legal step),
«⎙ Yuk xati». TotalsFooter: page Σ sale, Σ m³, Σ paddon. Rows are fully clickable.

### 7.3 New order `/orders/new`
The 3-step stepper with SummaryRail, exactly as §6.1. On ≤768px it becomes the vertical
one-thought-per-screen flow of §8.3. Edit mode `/orders/:id/edit` reuses the same stepper
pre-filled (PUT semantics: full item replace), reachable only while NEW/CONFIRMED +
PROVISIONAL; otherwise the entry point renders disabled with the reason («Tannarx
allokatsiya bilan qotirilgan — tahrirlash yopiq»).

### 7.4 Order detail `/orders/:id`
A document, not a card stack. PageHeader: breadcrumb, «ORD-000124» + status pill + meta
(client link · date), StatusFlow with the single next action, overflow: Tahrirlash · Bekor
qilish · «⎙ Chop etish ▾» (Yuk xati / Hisob-faktura). Hero strip: three quiet figures —
Sotuv · Tannarx (+cost pill) · Mahsulot foydasi, with Transport foydasi as a fourth when
applicable, labeled provisional in amber until FINAL. Sections in flow (DocAnchors on the
right): **Ma'lumotlar** (KeyValueList) → **Pozitsiyalar** (items table; pending rows amber
with inline «Narxlash» opening a controlled modal) → **Moliya** (coverage bar measured
against `clientChargeable(order)` — the true exposure ([authoritative transport model](../00-business-map.md#transport-authoritative)) — plus the allocations list
linking to `/payments/:id`) → **Transport** (mode, cost/charge/profit, paid pill, and the
in-context actions «Shofyorga to'lash» / «Mijoz shofyorga to'ladi») → **Paddonlar**
(collapsed summary line, expandable movements) → **Faoliyat** (ActivityFeed: statuses +
payments + pricing + comments merged, composer on top). Cancelled orders: danger banner with
reason; the ReasonModal for cancel previews impact (reversals, allocation voiding, bonus
reversal — including the COMPLETED warning).

### 7.5 Payments `/payments`
FilterBar adds the **«Tekshirilsin»** chip (`?reconciled=false` — the dead-end 95.8M queue
becomes workable: filter, open, review with the owner, void or allocate; absent a
mark-reconciled endpoint the queue is a review surface, honestly labeled). KindPicker on the
primary button; contextual entry points everywhere else. Table: sana · kind verb · usul
(+`usd × rate` caption) · party (TRANSPORT_DIRECT renders «Mijoz → Shofyor») · summa ·
kassa · state pill · taqsimlanmagan remainder (amber when > 0 — the allocation backlog
becomes visible); header shows filtered Σ per direction («Kirim: … · Chiqim: …», page-level,
labeled). Row click → `/payments/:id` drawer (§5.12). Voids via ReasonModal with impact
preview.

### 7.6 Kassa `/kassa`
One period control governs the whole page (the two desynced pickers die). Cashbox cards
across the top (name, currency, balance, today in/out) act as **filter chips** — selecting
one scopes the summary row and the transaction feed beneath. Per-currency grand totals (UZS
and USD lines — never summed together). Feed: datetime · box · IN/OUT · signed amount ·
source pill · **linked document** (payment/expense opens its drawer — the plain-text column
dies) · note; MANUAL rows carry the storno action (ReasonModal). «Qo'lda kirim/chiqim»
stays a compact modal with strict IN/OUT segmented control. CASHIER landing = this page plus
a quick-action row («To'lov qabul qilish», «Yangi xarajat») — the dead-end cashier dashboard
dies.

### 7.7 Debts `/debts`
The three-sided balances hub — the workbook's Свод instinct as one screen. Top: six summary
StatTiles grouped in three labeled pairs (Mijozlar: bizga qarz / avanslari · Zavodlar:
avansimiz / qarzimiz · Shofyorlar: qarzimiz — plus the pallets tile), each drilling down.
Side switcher (quiet tabs): **Mijozlar** (default; the collection worklist of §6.2 with
aging context: overdue count+total in-row, `?days` window control beside «Kutilayotgan
tushum») · **Zavodlar** (factory balances + bonus wallet chips, rows → FactoryDetail) ·
**Shofyorlar** (vehicle balances, rows → VehicleDetail). AGENT sees only the scoped client
table, no summary tiles. Expandable client rows lazily list open orders with due dates.

### 7.8 Pallets `/pallets`
One balances table with a `Mijozlar | Zavodlar` segmented switcher replacing the two cramped
side-by-side cards; row kebab carries the actions (Qaytarish qabul qilish / Undirish /
Zavodga qaytarish) with the party pre-bound. Action modals show the party's current balance
and the **post-action balance** inline, warn (not block) on negative, and prefill unit price
from the `palletPriceDefault` setting with a deviation hint. Movements feed below with
client/factory filters and a computed line-total column for money-bearing rows. AGENT:
read-only scoped balances + movements.

### 7.9 Clients `/clients` & ClientDetail `/clients/:id`
List: FilterBar (search + region/agent selects where the API filters; status chip), columns
add a compact CreditGauge; row kebab: Ochish · To'lov qabul qilish · Yangi buyurtma.
Create/edit unify on one right drawer (the modal/drawer split dies). Detail: PartyHeader
(balance verdict, CreditGauge, PalletChip, overdue pill) with actions «Yangi buyurtma» ·
«To'lov qabul qilish» · «⎙ Akt sverki»; sections: **Hisob-kitob** (PartyStatement with
period control) → **Buyurtmalar** (recent + «Hammasi →» linking to `/orders?client=…` — the
20-row cap stops lying) → **To'lovlar** (same pattern) → office-only **Maxsus narxlar**
(grouped by product, current price highlighted, future-dated badged) and **Taxalluslar** →
**Faoliyat**. Reactivation of deactivated clients is *not* designed (no API path — see §10).

### 7.10 Factories `/factories` & FactoryDetail `/factories/:id`
List: name · BalanceText · bonus wallet · **program pill** (PER_M3/PERCENT/yo'q — the
cross-factory program blindness dies) · paddon · status; rows → detail. Detail = the
settlement hub of §6.3: PartyHeader with actions, Ochiq buyurtmalar (non-final cost),
PartyStatement, **Bonus** section (current program card + «Yangi dastur» versioned modal
with non-retroactivity notice + wallet journal where accrual basis renders as a real
formula column: «25 m³ × 5 000 = 125 000»), **Paddonlar** section with «Zavodga qaytarish»
in context. One pallet-balance source of truth (the pallets endpoint) renders everywhere.

### 7.11 Bonus `/bonus`
Cross-factory overview: wallet cards (factory, balance, program pill) that act as journal
filters and carry «Naqd yechish» / «Qarzga o'tkazish» actions pre-scoped. Journal columns
include base and rate (no tooltip-only math); DEBT_OFFSET rows carry «to'lovni bekor qilish
orqali qaytariladi →» deep-linking to the payment drawer; WITHDRAWAL rows keep the reverse
action via ReasonModal. Modals refetch the wallet on open and show remaining-after.

### 7.12 Products `/products`
Table adds effective-from captions under each current price and a «rejalashtirilgan» badge
when a future-dated price exists. The price drawer is rebuilt: per-kind tabs (Sotish · Zavod
naqd · Zavod o'tkazma), current row pinned and marked, future rows badged, vertical compact
add-form. A factory-level «Narxlarni yangilash» bulk grid (factory → its products × 3 kinds,
one effectiveFrom, N versioned inserts on save) kills the 100-interaction repricing marathon
— it only batches existing single-price POSTs client-side.

### 7.13 Procurement `/procurement`
Two tabs. **Matritsa**: region select up front with the last-used region remembered; results
grouped by product with the cheapest factory marked *within each product group* (the
apples-to-oranges trophy dies); dropped products listed with reason chips whose actions
deep-link to the fix («Narx kiritish →» product drawer, «Marshrut qo'shish →» routes tab).
**Marshrutlar** (new): versioned route list per factory×region (current + history), «Yangi
marshrut» form (factory, region, costPerTruck, capacity default from settings, effectiveFrom)
— wiring the existing `POST /procurement/routes`.

### 7.14 Vehicles `/vehicles` & VehicleDetail `/vehicles/:id`
List wired to server search/pagination; rows clickable → the new detail hub of §6.4. One
driver word app-wide: «Shofyor».

### 7.15 Agents `/agents` & AgentDetail `/agents/:id`
List: name · phone · clients · open debt · limit (with the `0 — bloklangan` phrasing) ·
status; row → detail. Detail gains an edit action in the header and a month segmented
control that reuses the ranking endpoint's `?month` data for monthly KPIs beside the
all-time cards; client table rows carry compact CreditGauges.

### 7.16 Reports `/reports`
Three quiet tabs sharing one period control. **Svod**: agent blocks render *expanded* as one
grouped table with sticky agent-subtotal rows; every client/factory name links to its
document; the two identity checks render as a verdict banner («Mos ✓ 0 so'm» / danger «Farq:
…»). **Buyurtmalar reestri**: column presets (Moliya ko'rinishi / Logistika ko'rinishi /
Hammasi) tame the 22-column wall; page TotalsFooter labeled «sahifa»; xlsx export kept.
**Agentlar reytingi**: the dashboard table with a month picker and month-over-month deltas;
debt column labeled «hozirgi qoldiq». Both existing exports keep their buttons; the svod
xlsx keeps its current server format (reshaping it is backend work — out of scope).

### 7.17 Expenses `/expenses`
Header adds the filtered total («Davr jami: …», page-honest) and per-category chips from
loaded data; three-state voided filter; category management gets a small drawer (list with
usage counts, rename, delete-when-unused — endpoints exist). Create modal unchanged in
substance; date filtering surfaces the Tashkent-day convention in the preset labels.

### 7.18 Import `/import` (ADMIN only)
Restructured into three stages on one page — Yuklash → Natija → Solishtirish — with
auto-scroll/navigation between them (a real import auto-opens Solishtirish). The checks
table renders name · kutilgan · haqiqiy · **Δ** (the backend already sends the values).
Dry-run results render structured: per-kind payment chips, real columns for unmatched rows
(the JSON blobs die), and the unreconciled-total warning reads the correct field. The
reconciliation centerpiece: summary chip row (mos / farqli / **izohlanmagan**), per-client
rows expandable to sheetGaps detail, and the explained-vs-unexplained classification as
amber «Daftar nuqsoni» vs danger «Izohlanmagan — import xatosi» badges — the backend's most
valuable signal finally renders. Flagged payments gain payer/method columns and a deep link
to `/payments?reconciled=false`. Rollback collapses to one ReasonModal with typed ROLLBACK +
deletion counts; the import confirm shows the last clean dry-run's numbers inline. Script
policy: chrome in Uzbek Latin; workbook sheet names quoted verbatim («Товар», «Оплата») as
artifacts.

### 7.19 Admin pages
**Users `/users`**: search + role/status filter chips, email column, symmetric
«Faollashtirish» on blocked rows, RolePill everywhere; create/edit drawer unchanged in
fields. **Settings `/settings`**: same four keys, per-field save state (each key PUTs
independently with inline success/error — partial-write confusion dies); ACCOUNTANT gets
the read-only rendering; `saleMarginMinPct` carries an amber caption «Hozircha tizimda
qo'llanilmaydi» until the owner decides. **Profile `/profile`**: one editable card (name,
login, phone, **email**) + password card; the duplicated read-only block dies. **403**: adds
«Bosh sahifaga qaytish».

### 7.20 Login `/login`
Centered 400px column on the canvas: monogram + «SmartBlok», caption «Gazoblok biznesini
bitta tizimda boshqaring», two 40px fields, full-width primary «Kirish», error line inline
under the form (identical message for unknown user/wrong password, per the locked rule).
Theme-aware; no language switcher, no demo buttons.

---

## 8. The AGENT mobile experience

The agent is a salesperson in a truck yard with a phone. Their surface is the same app at
≤768px — no separate build — but their pages re-layout to one-column, thumb-first patterns.

### 8.1 Shell
Sidebar is replaced by a **bottom tab bar** (56px, safe-area padded): Bosh sahifa ·
Buyurtmalar · **+ (Yangi)** · Mijozlar · Qarzlar. The center «+» is a raised primary circle
opening a two-action sheet: «Yangi buyurtma» / «To'lov qabul qilish» — the agent's two
money-making acts are always one thumb away. To'lovlar and Paddonlar live inside Bosh sahifa
links and party documents. Header shrinks to 48px: page title + LiveDot + avatar. All
targets ≥44px; tables become card lists; drawers become full-height sheets.

### 8.2 Bosh sahifa + «Mening holatim» (`/me`)
Top card — the previously unreachable `GET /agents/me` standing: CreditGauge of the agent's
debt limit («Limit: 80 mln · Ochiq qarz: 64,2 mln · Bo'sh: 15,8 mln»), amber at 70%, danger
with «Yangi buyurtma bloklanadi» at 100% — the agent stops discovering the block from a
server error. Below: scoped hero tiles (Bugungi savdo, Oy savdosi, Yig'ilgan), fmtShort
values with full so'm as permanent captions, then a compact 30-day sparkline. Company
liabilities never render (server zeroes them).

### 8.3 New order on the phone
The same 3-step flow, vertical: one thought per screen, numeric keypads
(`inputmode="numeric"`) for pallets/money, the SummaryRail as a **collapsed bottom sheet** —
a 56px bar showing «19/19 paddon · 23,9 mln · qarzga yoziladi» that expands with a swipe to
the full consequence panel. Client step shows the same credit card (balance, headroom,
pallets, overdue) sized for glancing in sunlight. Price floor errors render inline at the
field. Submit button is full-width, sticky above the tab bar.

### 8.4 Take a payment
From a client card, debt row, or the «+» sheet: full-screen PaymentDrawer variant — client
pre-bound, amount keypad-first with the outstanding balance as a one-tap suggestion chip,
method segmented, cashbox list with balances. No allocation step (role-locked); a quiet
caption says the office will allocate. Success screen: big check, amount, «⎙ Kvitansiya»
(the receipt print route works from the phone for Bluetooth/PDF sharing) and «Yana to'lov»
shortcut.

### 8.5 Clients, debts, orders as card lists
Client cards: name, BalanceText, PalletChip, overdue pill; tap → the document page
(sections collapse to accordions on mobile, statement rows condense to two-line entries).
Debts list defaults to the agent's overdue-first ordering with tap-to-call phone links.
Orders: status-grouped card list; the order document keeps StatusFlow with the single legal
+1 action as a full-width button.

---

## 9. Print documents (frontend-only, from existing API data)

All four render through `PrintDocument` (§5.19) at dedicated `/print/*` routes (data via the
same react-query endpoints; window.print() from a sticky toolbar; A4 portrait except the
receipt at A5). Ink-safe: black text, hairline rules, no tints; status pills render as plain
bracketed words. Numbers-to-words for totals («yigirma uch million to'qqiz yuz ellik ming
so'm») is a small frontend util used on invoice/receipt.

### 9.1 Yuk xati (driver waybill — printed at LOADING)
Data: `GET /orders/:id`. Header: dealer name + legal entity | «YUK XATI № ORD-000124» +
date. Parties grid: Zavod (name) → Mijoz (name, phone, region/address) · Moshina (name,
plate) · Shofyor (name, phone). Body table: № · Mahsulot · O'lcham · Paddon · m³ — **no
prices by default** (a «narxlar bilan» toggle on the toolbar adds them for the trusted-client
variant). Totals: Σ paddon, Σ m³, «Qaytariladigan paddonlar: N dona» highlighted — the pallet
count is a debt the driver carries back knowledge of. Footer: Yukladi ____ · Shofyor ____ ·
Qabul qildi ____ signature triplet.

### 9.2 Hisob-faktura (client invoice)
Data: `GET /orders/:id`. Same letterhead; parties: Sotuvchi (dealer + INN via legal entity)
/ Xaridor (client). Body: № · Mahsulot · O'lcham · m³ · Narx (so'm/m³, up to 6dp as stored)
· Summa. Lines below the table: Mahsulot jami · «shundan shofyorga» deduction (only when
CLIENT_PAYS_DRIVER) · **Jami: `clientChargeable(order)`** bold, then the amount in words.
Meta block: to'lov
muddati (dueDate), buyurtma sanasi, agent. Caption footer: «Paddonlar (N dona) qaytariladi —
hisobga kirmaydi» making the in-kind rule explicit on paper. Signatures both sides.

### 9.3 Kvitansiya (cashier receipt, A5)
Data: `GET /payments/:id`. Compact: «KVITANSIYA № …» + datetime · qabul qilindi: client name
· summa (large, + words) · usul (USD shows `1 200 $ × 12 650 = 15 180 000 so'm`) · kassa ·
qabul qildi (user name) · optional allocation lines («ORD-000119 uchun: 10 000 000») ·
mijozning yangi qoldig'i (BalanceText, from the client document the drawer already has).
Duplicated top/bottom halves with a scissor rule for the tear-off copy.

### 9.4 Solishtirish dalolatnomasi / Akt sverki (client reconciliation statement)
Data: `GET /debts/statement?clientId&from&to`. Header: «SOLISHTIRISH DALOLATNOMASI»,
period, parties. Body = the PartyStatement in print form: opening balance row, entries
(date · document · debit · credit — signed amounts split into two columns for accounting
convention) · running balance, closing balance bold with the verdict in words («Mijozning
qarzi: …»). A second short table states the pallet balance in kind («Paddonlar: 18 dona
mijozda»). Footer: two signature blocks (Diler / Mijoz) with date lines — the paper the
owner takes to a hard conversation, straight from the screen of §6.5.

---

## 10. What we deliberately do NOT do

Restraint is the product. Each «no» protects a principle or a locked rule.

1. **No UI that needs new endpoints.** No cashbox CRUD, no manual ledger ADJUSTMENT entry,
   no opening-balance editor, no file attachments, no mark-reconciled button (the queue is a
   review surface until the endpoint exists), no client reactivation toggle (no API path) —
   these are named backend gaps, not design gaps.
2. **No invented metrics or merged profits.** Goods profit and transport profit never
   combine; no consolidated P&L page is faked from partial page data; expected collections
   appears only where its `?days` window gives it meaning.
3. **No agent commissions, gamification, leaderboards-with-confetti.** Agent motivation data
   = the existing KPIs and ranking, presented plainly.
4. **No dashboards of decoration.** No gradients, glass, illustrations, animated counters,
   or a single chart that doesn't answer a question the owner actually asks. One line chart
   and sparklines are the entire chart inventory.
5. **No customization platform.** No draggable widgets, no per-user dashboard builder, no
   column-designer beyond the three register presets. Calm means opinionated defaults.
6. **No second interaction grammar.** One create/edit surface (drawer), one destructive
   surface (ReasonModal), one document layout, one FilterBar. No page earns a bespoke
   pattern.
7. **No tabs on detail pages, no hover-only truths.** If it matters, it's in the flow and
   visible on touch. Tooltips only *repeat* visible data in fuller precision.
8. **No i18n switcher in v1.** One language, uz-Latn, done properly (custom AntD locale, one
   glossary); workbook Cyrillic terms are quoted artifacts, not UI copy. String extraction
   can come later without a visual change.
9. **No optimistic money.** Balances render only what the server confirmed; mutations show
   their consequence after commit (socket-refetched), never predicted-then-corrected. The
   only optimistic element is a comment row.
10. **No hiding of the system's honesty.** Voided rows, reversal pairs, provisional costs,
    UNKNOWN transport, unreconciled imports all remain visible states with explicit visual
    language — calm never means concealment.
11. **No bulk destructive actions.** No multi-select void/cancel; each reversal is one
    deliberate, reasoned act — matching the audit-first ledger.
12. **No new business vocabulary.** Buyurtmalar, Mijozlar, To'lovlar, Qarzlar, Paddonlar,
    Kassa, Zavodlar, Agentlar, Hududlar stay; the redesign fixes only inconsistencies
    (Shofyor vs Haydovchi, Buxgalter vs Hisobchi, raw role enums).

---

## Appendix A — AntD token sheet (drop-in `theme.ts` direction)

```ts
// tokens shared by both modes
const shared = {
  fontFamily: "'Segoe UI Variable Text','Segoe UI',system-ui,-apple-system,sans-serif",
  borderRadius: 7,
  borderRadiusLG: 10,
  controlHeight: 34,
  fontSize: 14,
  motionDurationFast: '0.12s',
  motionDurationMid: '0.2s',
  motionDurationSlow: '0.24s',
};

export const lightTheme: ThemeConfig = {
  algorithm: antdTheme.defaultAlgorithm,
  token: {
    ...shared,
    colorPrimary: '#2E6584',
    colorInfo: '#2E6584',
    colorError: '#B3362E',
    colorSuccess: '#1E7A46',
    colorWarning: '#9A6700',
    colorBgLayout: '#F6F6F3',
    colorBgContainer: '#FFFFFF',
    colorBorderSecondary: '#E9E8E3',
    colorText: '#1F2328',
    colorTextSecondary: '#646A70',
    colorTextTertiary: '#9AA0A6',
  },
  components: {
    Layout: { siderBg: '#FBFBF9', headerBg: '#FFFFFF' },
    Menu: { itemBg: 'transparent', itemSelectedBg: 'rgba(46,101,132,0.10)',
            itemSelectedColor: '#2E6584', itemBorderRadius: 7 },
    Table: { headerBg: '#FAFAF8', cellPaddingBlock: 10, headerSplitColor: 'transparent' },
    Card: { paddingLG: 20 },
  },
};

export const darkTheme: ThemeConfig = {
  algorithm: antdTheme.darkAlgorithm,
  token: {
    ...shared,
    colorPrimary: '#64A0C2',
    colorInfo: '#64A0C2',
    colorError: '#E5736B',
    colorSuccess: '#58B383',
    colorWarning: '#D9A521',
    colorBgLayout: '#101214',
    colorBgContainer: '#17191C',
    colorBorderSecondary: '#2A2F34',
  },
  components: {
    Layout: { siderBg: '#141619', headerBg: '#17191C' },
    Menu: { itemBg: 'transparent', itemSelectedBg: 'rgba(100,160,194,0.16)',
            itemSelectedColor: '#64A0C2', itemBorderRadius: 7 },
    Table: { headerBg: '#1C2024', cellPaddingBlock: 10, headerSplitColor: 'transparent' },
  },
};
```

## Appendix B — URL filter contract (examples)

```
/orders?status=CONFIRMED&client=<id>&from=2026-07-01&to=2026-07-11&page=2
/payments?kind=CLIENT_IN&reconciled=false
/debts?side=clients&overdue=1&days=14&sort=balance_desc
/kassa?box=<id>&from=2026-07-01&to=2026-07-11
/reports?tab=svod&from=2026-07-01&to=2026-07-11
/?days=90&month=2026-06
```

Rules: params mirror API params 1:1 where they exist; UI-only state (density, side switcher,
tab) uses short reserved keys; empty params are omitted; every drill-down link in the app is
generated from this contract so KPIs, chips, and cross-links can never drift from what lists
actually accept.

## Appendix C — Migration order (design-only sequencing note)

1. Shell + tokens + PageHeader/FilterBar/URL-sync (every page benefits immediately).
2. Payments drawer + AllocationPanel + Debts hub (the money loop — highest daily pain).
3. Order stepper + order document + StatusFlow (+ edit & assign-vehicle paths).
4. FactoryDetail/VehicleDetail hubs + Bonus context actions + `/me`.
5. Print routes (waybill, invoice, receipt, akt sverki).
6. Dashboard tiers, Reports, Import, catalog & admin polish, agent mobile pass.

## Appendix D — Key screen wireframes (structure, not pixels)

### D.1 Dashboard (ADMIN/ACCOUNTANT, ≥1280px)

```
PageHeader:  Bosh sahifa                                   ● Jonli   [7|30|90|365]
┌───────────────────────┬───────────────────────┬───────────────────────┐
│ BUGUNGI SAVDO         │ OYDA YIG'ILGAN        │ MIJOZLAR QARZI        │
│ 46 800 000 so'm       │ 312 450 000 so'm      │ 1 214 800 000 so'm    │
│ ▲ 12% kechaga nisb.   │ ▲ 4% o'tgan oyga      │ ▲ 8 400 000 kechadan  │  ← danger
│ ▁▂▄▂▆▇▅  →            │ ▂▃▃▅▄▆▇  →            │ ▅▅▆▆▆▇▇  →            │
└───────────────────────┴───────────────────────┴───────────────────────┘
Diqqat talab qiladi:  (Muddati o'tgan 7) (Tekshirilsin 12) (Yo'lda 5) (Narxlanmagan 2)
MOLIYA ────────────────────────────────────────────────────────────────
[Oy savdosi] [Mahsulot foydasi (oy)] [Transport foydasi (oy)] [Zavodlarga qarz]
[Shofyorlarga qarz] [Bonus hamyonlar]
LOGISTIKA ─────────────────────────────────────────────────────────────
[Mijozlardagi paddonlar] [Sotilgan hajm (oy)]
┌─ So'nggi 30 kun: savdo va yig'ilgan ──────────┐ ┌─ Agentlar reytingi [2026-06 ▾] ─┐
│  (line chart, 2 series, end-labeled)          │ │ Jamol   84,2m  12,1m  61,0m  … │
│                                               │ │ Baxtiyor 71,9m  9,8m  55,4m  … │
└───────────────────────────────────────────────┘ └────────────────────────────────┘
```

### D.2 Order document `/orders/:id`

```
Buyurtmalar / ORD-000124
ORD-000124  [Tasdiqlangan]  Jasur Versal · 12.07.2026     [Yuklashni boshlash] [⋯]
▔▔▔▔▔▔▔▔▔▔ status track ██████░░░░░░
SOTUV 23 950 000    TANNARX 19 800 000 [Taxminiy]    FOYDA 4 150 000    TRANSPORT +400 000
                                                                        ┌ DocAnchors ┐
Ma'lumotlar                                                             │ Ma'lumotlar│
  Agent Jamol · Zavod CAOLS KS · Moshina Isuzu 90A123BA · Shofyor …     │ Pozitsiyalar│
Pozitsiyalar                                                            │ Moliya     │
  Gazoblok D500 600×300×200 · 11 paddon · 19.008 m³ · 730 000 · 13,9m   │ Transport  │
  Gazoblok D600 …                                        [Narxlash]     │ Paddonlar  │
Moliya                                                                  │ Faoliyat   │
  To'langan ▓▓▓▓▓▓░░░░ 14 000 000 / 24 350 000 (sotuv + transport)     └────────────┘
  Taqsimotlar: TLV-2231 → 10 000 000 · TLV-2240 → 4 000 000
Transport
  Mijozdan olinadi · xarajat 2 000 000 · mijozdan 2 400 000 · foyda 400 000
  [To'lanmagan]   [Shofyorga to'lash] [Mijoz shofyorga to'ladi]
Paddonlar (yig'ilgan: 11 dona mijozda)                        ▸ ochish
Faoliyat  [Hammasi|Izohlar|Moliya|Holat]
  [izoh yozish…                                   Ctrl+Enter]
  ● 12.07 14:02 Holat: Tasdiqlangan — A.Alibek
  ● 12.07 11:30 To'lov TLV-2231 10 000 000 — kassir
```

### D.3 Debts hub `/debts` (Mijozlar side)

```
Qarzlar                                              [Mijozlar | Zavodlar | Shofyorlar]
MIJOZLAR: bizga qarz 1 214,8m · avanslari 88,2m   ZAVODLAR: avans 973,6m · qarz 0
SHOFYORLAR: qarzimiz 6,2m                         PADDONLAR: 214 dona mijozlarda
(Muddati o'tgan 7)  (Muddati yaqin 4)     Kutilayotgan tushum [7|14|30 kun]: 214,0m
🔍 qidiruv…                                                        Bekorlar: yashirin ▾
Mijoz            Agent    Balans              Paddon   Muddati o'tgan        Muddat
Shiddat monalit  Jamol    46 200 000 Qarz     18 dona  2 ta · 31 500 000     15 kun
  ▸ ochiq buyurtmalar: ORD-000119 (12,4m, muddati 05.07) · ORD-000121 (…)
Gofur Xazorasp   Baxtiyor 21 700 000 Qarz     —        —                     30 kun
…                                             Sahifa jami: 214 000 000
```

### D.4 Payment drawer with AllocationPanel (FACTORY_OUT)

```
┌─ Zavodga to'lash ────────────────────────────── ✕ ─┐
│ Zavod    CAOLS KS        Avans: 973 619 270        │
│ Sana     11.07.2026      Usul  [Naqd|O'tkazma|…]   │
│ Summa    [ 2 000 000 000 ] so'm                    │
│ Kassa    Bank (Септем Алока) — qoldiq 2,4 mlrd ✓   │
│ Oluvchi  (yuridik shaxs ▾)   Izoh …                │
│ ── Taqsimlash ────────────────────────────────────  │
│ Usul: O'TKAZMA → zavod o'tkazma narxi qo'llanadi    │
│ Taqsimlanmagan: 0 so'm          [Eng eskisidan]    │
│ ORD-000098  02.07  19,8m  qoldiq 19,8m [19 800 000]│ → Qotiriladi ✓
│ ORD-000104  04.07  20,1m  qoldiq 20,1m [20 100 000]│ → Qotiriladi ✓
│ ORD-000110  06.07  18,9m  qoldiq 18,9m [ 4 000 000]│ → Qisman
│                              [Bekor]  [Saqlash ⏎]  │
└────────────────────────────────────────────────────┘
```

### D.5 Agent mobile home (≤768px)

```
┌──────────────────────────────┐
│ Bosh sahifa        ● Jonli 👤│
│ ┌──────────────────────────┐ │
│ │ MENING HOLATIM           │ │
│ │ Limit 80 mln             │ │
│ │ ▓▓▓▓▓▓▓▓░░ 64,2 mln      │ │
│ │ Bo'sh: 15,8 mln          │ │
│ └──────────────────────────┘ │
│ [Bugungi savdo]  [Oy savdosi]│
│  4,2 mln          84,2 mln   │
│  4 180 000 so'm   84 150 000 │
│ [Yig'ilgan (oy)] 61,0 mln    │
│  ▁▂▄▂▆▇▅ 30 kun              │
│ Muddati o'tgan mijozlarim (3)│
│  Shiddat monalit  46,2m Qarz │
│  …                           │
├──────────────────────────────┤
│  🏠     📦    (＋)    👥   💰 │
│ Sahifa Buyur.  Yangi Mijoz Qarz│
└──────────────────────────────┘
```

## Appendix E — Terminology glossary (fixed app-wide)

| Concept | Canonical UI term | Notes / banned variants |
|---|---|---|
| Order | Buyurtma / Buyurtmalar | — |
| Client | Mijoz / Mijozlar | — |
| Payment | To'lov / To'lovlar | — |
| Debt | Qarz | positive client balance |
| Advance / prepayment | Avans | negative client balance; factory positive = «Avansimiz» |
| Settled | Hisob yopiq | `|balance| < 1` UZS |
| Pallet | Paddon | in-kind counts, «dona»; never «poddon/pallet» |
| Cash desk | Kassa | boxes = «kassalar» |
| Factory | Zavod / Zavodlar | — |
| Driver | Shofyor | «Haydovchi» banned |
| Vehicle | Moshina / Moshinalar | — |
| Agent | Agent / Agentlar | — |
| Region | Hudud / Hududlar | — |
| Legal entity | Yuridik shaxs | — |
| Accountant (role) | Buxgalter | «Hisobchi» banned |
| Cashier (role) | Kassir | — |
| Admin (role) | Administrator | raw `ADMIN` enum banned |
| Voided | Bekor qilingan | struck-through, hidden by default |
| Reversal / storno | Storno | paired-row rendering |
| Provisional cost | Taxminiy tannarx | amber |
| Final cost | Tannarx qotirilgan | success |
| Price-pending | Narxlanmagan | amber, loud until priced |
| Unreconciled (import) | Tekshirilsin | amber; queue at `?reconciled=false` |
| Transport unknown | Aniqlanmagan | amber outline; owner must resolve |
| Allocation | Taqsimlash / Taqsimot | «allokatsiya» allowed in helper text only |
| Waybill | Yuk xati | print doc |
| Invoice | Hisob-faktura | print doc |
| Receipt | Kvitansiya | print doc |
| Reconciliation statement | Solishtirish dalolatnomasi (akt sverki) | print doc |
| Bonus wallet | Bonus hamyon | — |
| Statement | Hisob-kitob | running-balance ledger view |
| Workbook sheet names | «Товар», «Оплата», … | quoted verbatim as artifacts, never translated |

*— end of vision —*
