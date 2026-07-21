# LEDGER CLARITY — a UX vision for SmartBlok

**Angle:** money-flow-first design, Stripe-dashboard caliber. Every party is a beautiful running
statement. Every debt has a next action attached to it. Allocation is a first-class guided flow.
Immutability (reversals, never deletes) is made *visible* and therefore *trustworthy*.

**Scope discipline:** everything in this document is buildable against the existing NestJS API.
Where a screen "adds" capability, it is wiring an endpoint that exists today with no UI
(`PUT /orders/:id`, `GET /vehicles/:id`, `POST /payments/:id/allocations`, `GET /agents/me`,
`?reconciled=` filter, `GET/POST /procurement/routes`, `GET /dashboard/trends?days=`,
`GET /dashboard/agents-ranking?month=`), or composing existing endpoints on the frontend
(print documents, bulk price entry as N versioned POSTs). Nothing here requires a new endpoint.

Language: Uzbek (Latin) throughout, existing terminology preserved. Tech: React 18 + Ant Design v6
(ConfigProvider tokens + custom CSS), @ant-design/plots, react-query, react-router 6, socket.io.

---

## 1. Design philosophy

Five principles, specific to a three-sided-debt wholesale business running on an immutable ledger.

### 1.1 The balance IS the interface

In this business every conversation — with a client, a factory dispatcher, a truck driver —
starts with one number: *how do we stand?* So every party surface (client, factory,
vehicle/driver) leads with the live, ledger-derived balance rendered as a **semantic sentence**,
not a signed number: «Mijoz bizga qarz: 12 450 000 so'm», «Zavoddagi avansimiz: 973 619 270 so'm»,
«Shofyorga qarzimiz: 2 000 000 so'm». The balance is pinned (sticky) while you scroll the
statement beneath it, and every posting that produced it is one click away. The corollary: **no
screen ever shows a raw signed amount without translating the sign convention.** `+` on a CLIENT
account means "they owe us"; that knowledge lives in the design system (the `MoneyCell` semantic
variants), never in the user's head.

### 1.2 A statement is a story, not a table

Stripe made payment timelines legible by treating each row as an event in a narrative: what
happened, what it did to the balance, what document proves it. SmartBlok's `PartyStatement` is the
single most important component in this vision: opening balance → chronological postings with a
running balance column → closing balance, where every row names its source in Uzbek («Buyurtma
savdosi», «To'lov», «Shofyorga mijoz to'laydi (summa ichidan)», «Paddon undirish», «Bonus
hisobidan», «Storno»), links to
its document, and — critically — **reversal pairs are visually chained** (the storno row and its
original share a connector line and net to zero visibly). The user should be able to hand the
screen to the counterparty and settle an argument. The same component prints as the akt sverki.

### 1.3 Immutability is a feature you can see

The ledger's append-only nature is the system's biggest trust asset and today it is invisible —
voided rows hide behind toggles, reversals read as noise, reasons live in tooltips. We invert
this: voided/cancelled/reversed records are **first-class citizens rendered with pride** — a
muted "ghost" treatment, the reason inline, a chain-link glyph to the compensating row, and a
one-line explanation of what the correction did («Bu to'lov bekor qilingan — barcha yozuvlar
storno bilan qoplangan»). Every destructive action shows an **impact preview** before the reason
field: which ledger entries reverse, which allocations void, whether a cost un-finalizes,
whether a bonus reverses. The user always knows the ledger will *grow*, never shrink.

### 1.4 Every debt carries its own next action

A debt figure without an action button is a dead end (today's #1 navigation pain). In this
vision, wherever a receivable or liability appears — a Debts row, a client header, a factory
card, an unpaid-transport chip on an order, a bonus wallet — the settlement action is attached
in place, pre-filled with party, amount and candidate allocations: «To'lov qabul qilish»,
«Zavodga to'lash», «Shofyorga to'lash», «Taqsimlash», «Bonusdan yopish». The Payments page
remains the register; **settlement happens where the debt is seen.**

### 1.5 Allocation is the flagship flow, not a footnote

Cost finalization, aging, transport paid-status, PERCENT bonus adjustments — the deepest business
rules all hang off payment allocation, which today is a blind `Form.List` inside a modal. We
promote it to the `SettleDrawer`: a guided surface that always shows *remaining to allocate* on
the payment side, *outstanding per order* on the document side, a one-key **FIFO auto-distribute**
(«Eskisidan boshlab taqsimlash»), and an explicit preview of consequences («Bu taqsimot ORD-000214
tannarxini FACTORY_BANK narxida QOTIRADI»). Cashiers and agents create payments; the allocation
inbox makes sure an accountant finishes them the same day.

---

## 2. App shell & navigation

### 2.1 Layout anatomy

```
┌──────────┬──────────────────────────────────────────────────────────────┐
│          │  TopBar (48px): breadcrumb · ⌘K search · LIVE · 🌙 · avatar  │
│ SideNav  ├──────────────────────────────────────────────────────────────┤
│ (240px,  │  PageHeader: title + meta chips + actions (+ tabs)           │
│ collaps- ├──────────────────────────────────────────────────────────────┤
│ ible to  │  Content: max-width 1440px, 24px padding                     │
│ 64px)    │  (list pages, workbenches, statements)                       │
└──────────┴──────────────────────────────────────────────────────────────┘
```

- **SideNav**: 240px, collapsible to a 64px icon rail (state persisted). It is **surface-colored,
  not dark**: in light theme a very light neutral (`#F1F3F6`) with a 1px border; in dark theme
  `#12171D`. Rationale: the near-black sidebar of today fights the content for attention and makes
  the money the second-brightest thing on screen; Ledger Clarity gives the chrome away and lets
  the numbers carry the contrast. Wordmark top-left: a small square glyph (stacked-blocks mark, no
  emoji) + «SmartBlok» in 15px/600. Below the wordmark sits a full-width **search button** styled
  as an input («Qidiruv… ⌘K») — the palette is now clickable, not a text hint.
- **TopBar**: 48px, contains (left→right) breadcrumb trail («Buyurtmalar / ORD-000214»),
  spacer, **LiveBadge** (real socket state: green dot «Jonli» / amber «Ulanmoqda…» / grey
  «Oflayn — ma'lumot 14:32 holatiga» with last-refresh timestamp), theme toggle (Sun/Moon icon
  button, not a Switch), avatar chip (initial avatar + name + localized role label — «Admin»,
  «Buxgalter», «Agent», «Kassir» — never the raw enum) opening Profil / Chiqish.
- **Content**: 24px padding, `max-width: 1440px` centered on ultra-wide monitors (tables breathe;
  statements never exceed a readable measure). Print CSS strips SideNav + TopBar (`no-print`).

### 2.2 Navigation model: grouped by money-flow, ordered by frequency

Flat 12-item lists die. Navigation is grouped into labeled sections (11px overline group labels,
collapsed groups persist per user). Every item has an icon (a collapsed rail must never show blank
rows). Uzbek names are canonical and used verbatim below.

**ADMIN — full tree:**

| Group | Item | Route |
|---|---|---|
| — | **Boshqaruv paneli** | `/` |
| **SAVDO** | Buyurtmalar | `/orders` |
| | Mijozlar | `/clients` |
| | Agentlar | `/agents` |
| **MOLIYA** | To'lovlar | `/payments` |
| | Qarzlar | `/debts` |
| | Kassa | `/kassa` |
| | Xarajatlar | `/expenses` |
| | Hisobotlar | `/reports` |
| **TA'MINOT** | Zavodlar | `/factories` |
| | Bonus hamyonlar | `/bonus` |
| | Paddonlar | `/pallets` |
| | Moshinalar | `/vehicles` |
| | Ta'minot matritsasi | `/procurement` |
| **KATALOG** | Mahsulotlar | `/products` |
| | Hududlar | `/regions` |
| | Yuridik shaxslar | `/legal-entities` |
| **TIZIM** | Foydalanuvchilar | `/users` |
| | Tizim sozlamalari | `/settings` |
| | Excel import | `/import` |

**ACCOUNTANT:** identical minus the TIZIM group entirely (`/import` is ADMIN-only at the API —
we align the UI with the backend and remove the dead page; see §3). Settings gets a read-only
surface exposed contextually instead (effective pallet price and limits shown inside the forms
that use them), because `GET /settings` permits ACCOUNTANT.

**AGENT** (flat, no groups — five items):

| Item | Route |
|---|---|
| Boshqaruv paneli | `/` |
| Buyurtmalar | `/orders` |
| Mijozlar | `/clients` |
| To'lovlar | `/payments` |
| Qarzlar | `/debts` |

Paddonlar for an agent lives as a tab inside Qarzlar (`/debts?tab=paddonlar`) — an agent thinks
"what does my client owe" (money + pallets together), not "pallet subsystem". The agent's own
KPI/limit card (`GET /agents/me`) lives on their dashboard and under the avatar menu as
«Mening ko'rsatkichlarim» (`/me`).

**CASHIER** (flat, four items):

| Item | Route |
|---|---|
| Kassa paneli | `/` |
| To'lovlar | `/payments` |
| Kassa | `/kassa` |
| Xarajatlar | `/expenses` |

### 2.3 Global search & command palette (⌘K)

One palette, two modes, opened by the sidebar search button, `Ctrl/Cmd+K`, or `/` on any list page:

- **Type text** → federated record search across existing search-enabled endpoints, sections
  rendered as: Mijozlar (name/phone/alias via `GET /clients?search=`), Buyurtmalar (orderNo/client
  via `GET /orders?search=`), To'lovlar (`GET /payments?search=`), each row showing the party's
  semantic balance chip; Enter navigates to the record.
- **Type `>`** → command mode: navigation («Buyurtmalar sahifasi»), actions («Yangi buyurtma»,
  «To'lov qabul qilish», «Chop etish»), theme toggle. Recent items (last 8) shown on open.

Keyboard grammar app-wide: `⌘K` palette · `/` focus page search · `N` new record on list pages ·
`Esc` closes topmost surface · `⌘Enter` submits any form · `Alt+←` back. Every drawer/modal traps
focus and returns it on close.

### 2.4 Notifications = worklists, not toasts

There is no notifications endpoint, and this business doesn't need a bell — it needs **queues**.
The dashboard (and a compact popover on the TopBar LiveBadge) surfaces WorklistCards computed
from existing queries: «Tekshirilishi kerak to'lovlar» (`GET /payments?reconciled=false` — count +
sum), «Narxlanmagan buyurtmalar» (from the register data already fetched on Reports; on lists a
`Narxsiz` badge), «Yo'ldagi buyurtmalar» (`status IN CONFIRMED/LOADING/DELIVERING`). Realtime
socket events keep the counts fresh. Toasts remain only for action feedback (saved/voided).

---

## 3. Information architecture

### 3.1 Full route tree with role access

Legend: A=ADMIN, B=ACCOUNTANT (Buxgalter), G=AGENT, K=CASHIER (Kassir). All list-page filters are
URL search params (shareable, back-safe). `?panel=` opens URL-addressable drawers.

```
/login                                  public
/                                       A B G K   role-adaptive dashboard (K → Kassa terminali)
/me                                     G         agent self card (GET /agents/me) — also reachable via avatar

/orders                                 A B G     ?status&search&clientId&factoryId&from&to&page
/orders/new                             A B G     full-page composer
/orders/:id                             A B G(own) workbench; ?tab=tolovlar|paddonlar|tarix
/orders/:id/edit                        A B       NEW UI — wires PUT /orders/:id (NEW/CONFIRMED + PROVISIONAL only)

/clients                                A B G     ?search&regionId&agentId&page  (agentId honored where API supports; else client-side facet from loaded page is NOT used — filter hidden until param lands; region/agent filtering via search only if unsupported)
/clients/:id                            A B G(own) statement-first party page; ?tab=&from&to
                                                  ?panel=tolov (payment composer prefilled)

/payments                               A B G K   ?kind&method&clientId&factoryId&search&from&to&voided&reconciled
/payments/:id                           A B G(own) K   same list page with detail drawer open via URL (fixes dead deep-link)
                                                  ?panel=taqsimlash → SettleDrawer (POST /payments/:id/allocations)

/debts                                  A B G     collections hub; ?tab=mijozlar|zavodlar|shofyorlar|paddonlar&days&search
/pallets                                A B G(ro) in-kind ledger page (office); agent view folded into /debts?tab=paddonlar
/kassa                                  A B K     treasury; one period control; ?cashboxId&from&to&source
/expenses                               A B K     ?categoryId&cashboxId&from&to&voided
/bonus                                  A B       wallets overview + journal; actions also on /factories/:id
/reports                                A B       ?tab=svod|reestr|reyting&from&to&month
                                                  (reyting = GET /dashboard/agents-ranking?month — month picker at last)

/factories                              A B
/factories/:id                          A B       settlement hub; ?tab=hisob|tolovlar|bonus|paddonlar&from&to
/vehicles                               A B
/vehicles/:id                           A B       NEW UI — wires GET /vehicles/:id (driver statement + unpaid trucks)
/agents                                 A B
/agents/:id                             A B
/regions                                A B
/legal-entities                         A B
/products                               A B       + price-book drawer + bulk price sheet (N POSTs to existing endpoint)
/procurement                            A B       ?tab=matritsa|marshrutlar — routes tab wires GET/POST /procurement/routes

/import                                 A         ADMIN only — aligned with backend @Roles('ADMIN'); removed from B nav
/users                                  A
/settings                               A
/profile                                A B G K

/print/waybill/:orderId                 A B G(own)   yuk xati (chrome-free print route)
/print/invoice/:orderId                 A B G(own)   hisob-faktura
/print/receipt/:paymentId               A B G(own) K kvitansiya
/print/statement/client/:id             A B G(own)   akt sverki (solishtirish dalolatnomasi) ?from&to
/print/statement/factory/:id            A B          factory akt sverki
```

### 3.2 What merges, splits, or dies

| Today (26 pages) | In Ledger Clarity |
|---|---|
| Dashboard | **Rebuilt** as banded, drillable KPI page; CASHIER variant becomes a true Kassa terminal (§7). |
| Orders | Kept; gains URL filters, totals footer, blocker badges (Narxsiz, Moshina yo'q), row quick-advance. |
| NewOrder | Kept as full page; re-staged into 4 visual stages with a sticky live LedgerPreview rail (§6a). |
| OrderDetail | **Split into a two-column workbench**: document left, money+activity right; gains Edit, assign-vehicle, pay-driver actions, print menu. |
| Payments | Kept as register; create modal **dies**, replaced by kind-first PaymentComposer drawer; detail becomes URL-addressable; SettleDrawer attached. |
| Kassa | Kept; three sections unified under one period control; cashbox cards become scoping filters; documents linked. |
| Debts | **Promoted to the collections hub** — 4 tabs (Mijozlar / Zavodlar / Shofyorlar / Paddonlar) covering all three debt sides + in-kind; every row carries its settle action. Six dead stat cards become drillable tab headers. |
| Pallets | Kept for office (movement ledger + balances); agent-facing view merges into Debts. |
| Clients | Kept; gains real filters, credit gauge column, reactivation intentionally **not** added (no API — see §10). |
| ClientDetail | **Rebuilt as the archetypal party page**: sticky BalanceHeader with actions, PartyStatement default tab, full-history tabs linking to filtered registers. |
| Factories | Kept (server search wired). |
| FactoryDetail | **Promoted to settlement hub**: statement + quick actions (To'lash, Taqsimlash, Bonusdan yopish, Paddon qaytarish) pre-scoped to the factory. |
| Bonus | Kept as cross-factory overview; wallet cards become filters/links; program badges added; actions duplicated on FactoryDetail. |
| Products | Kept; price columns gain effective dates + upcoming-price badges; **bulk price sheet** added (composes existing versioned POST). |
| Procurement | Kept; gains Marshrutlar tab (routes CRUD — existing API, no UI today); matrix grouped per product. |
| Vehicles | Kept; **VehicleDetail page is born** (existing rich endpoint, zero UI today). |
| Agents | Kept; AgentDetail gains edit + month scope via ranking endpoint. |
| Regions, LegalEntities | Kept as light catalogs; entity picker finally wired into PaymentComposer (payer/receiver). |
| Reports | Absorbs agents ranking (month picker); Svod becomes expanded grouped table with drill links; register gains server-summary row + column presets. |
| Expenses | Kept; gains filtered totals + per-category chips + voided tri-state filter. |
| Import | **ADMIN-only wizard** (Yuklash → Tekshiruv → Import → Solishtirish); renders the classification the backend already computes (explained vs unexplained). |
| Users | Kept; search, role/status filters, email column, symmetric Faollashtirish action. |
| Settings | Kept ADMIN-only; per-field save state; `saleMarginMinPct` field **removed from UI** until the backend consumes it (no-op today — see §10). |
| Profile | De-duplicated: one editable card + password card; email field added (API supports it). |
| Login | Kept minimal; brand refresh only. |
| *(new)* | `/orders/:id/edit`, `/vehicles/:id`, `/me`, `/print/*`, SettleDrawer, Marshrutlar tab. |

### 3.3 Cross-link contract

Every entity reference anywhere in the app is a link, and every link round-trips: order ↔ payment
(via `/payments/:id`), kassa row → source document, statement row → document, svod client row →
`/clients/:id`, ranking row → `/agents/:id`, KPI card → filtered register, chart point → that
day's orders/payments (`/orders?from=X&to=X`). Back button always restores the exact filter state
(URL-synced). This is a hard acceptance criterion, audited per screen.

---

## 4. Design language

Everything expressed as AntD v6 ConfigProvider tokens plus a small custom-CSS layer
(`ledger.css`, ~300 lines). Both themes are first-class; values are exact.

### 4.1 Color system

**Brand.** Keep the restrained steel blue, sharpened one step for contrast:

| Token | Light | Dark | Use |
|---|---|---|---|
| `colorPrimary` | `#26617F` | `#7FB0CC` | actions, links, focused controls, selected nav |
| `colorPrimaryBg` | `#E8F0F5` | `#1B2E3A` | selected rows, active chips |
| `colorLink` | `#26617F` | `#7FB0CC` | all entity cross-links |

**Surfaces.**

| Token | Light | Dark |
|---|---|---|
| `colorBgLayout` (canvas) | `#F6F7F9` | `#0E1216` |
| `colorBgContainer` (cards, tables) | `#FFFFFF` | `#161C22` |
| Raised (drawers, popovers) | `#FFFFFF` + shadow e2 | `#1C242C` |
| SideNav | `#F1F3F6` | `#12171D` |
| Inset (statement opening/closing rows, table headers) | `#F3F5F7` | `#10151A` |
| `colorBorder` | `#E3E7EC` | `#2A333C` |
| `colorBorderSecondary` (hairlines) | `#EDF0F3` | `#222A32` |

**Text.**

| Token | Light | Dark |
|---|---|---|
| `colorText` | `#1B2530` | `#E6EBF0` |
| `colorTextSecondary` | `#5B6774` | `#9AA7B4` |
| `colorTextTertiary` (captions, overlines) | `#8A94A0` | `#6C7885` |

**Semantic money palette** — color carries *meaning only*, and the meanings are fixed app-wide:

| Meaning | Token | Light | Dark | Where |
|---|---|---|---|---|
| Receivable / they owe us / overdue risk | `moneyOwedToUs` | `#C2413B` | `#E8827C` | client Qarz, overdue tags |
| Our liability / we owe them | `moneyWeOwe` | `#B07A18` | `#D9A94A` | Qarzimiz to factory/driver, mijoz avansi |
| Inflow / settled / advance in our favor | `moneyIn` | `#2E8B57` | `#6CC495` | payments in, Avans (ours), settled, PAID |
| Outflow (neutral spend) | `colorText` | — | — | kassa OUT, expenses: **not red** — spending is not an error |
| Ghost (voided/cancelled/reversed) | `textTertiary` + strikethrough on amounts | | | preserved history |

This resolves the "positive is red?" confusion: red is reserved for *money at risk owed to us*,
amber for *what we must pay out*, green for *money in / settled*. Kassa outflows and factory
payments render in plain ink — they are normal operations, not alarms. Rule: **never color more
than one column per table**; the colored column is the balance/amount that answers the page's
question.

**Status hues** (chips only, 4.5:1 on their tinted backgrounds): NEW slate `#64748B` ·
CONFIRMED blue `#2563EB` · LOADING amber `#B45309` · DELIVERING orange `#C2410C` ·
DELIVERED teal `#0D9488` · COMPLETED green `#15803D` · CANCELLED red `#B91C1C` ·
PROVISIONAL slate / PARTIAL amber / FINAL green · transport UNKNOWN violet `#7C3AED` (must look
unlike "—/NOT_APPLICABLE": it is a task waiting for the owner, not an absence).

**Charts** (2 series max per chart): sales `#1F6F9E`, collections `#B47A00` (existing CVD-safe
pair, kept); bars for order counts `#94A3B8` at 60% alpha. Dark: `#5CA3CF` / `#D9A94A`.

### 4.2 Typography

Self-hosted **Inter variable** (woff2, ~100KB, `font-display: swap`), fallback
`'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif`. All numerals in money, quantity
and date cells get `font-feature-settings: 'tnum' 1, 'lnum' 1` (the existing `.num` class,
promoted into table-cell defaults).

| Style | Size/Line | Weight | Use |
|---|---|---|---|
| `money-hero` | 28/34 | 650 | party balance headers, dashboard hero KPIs |
| `money-lg` | 20/26 | 600 | stat cards, drawer totals |
| `h1` page title | 20/28 | 650 | PageHeader |
| `h2` section | 16/24 | 600 | card titles, statement month separators |
| `body` | 14/22 | 400 | default |
| `body-strong` | 14/22 | 600 | emphasized cells, totals rows |
| `table` | 13/20 | 400 (500 for money) | all table cells |
| `small` | 12/18 | 400 | secondary cell lines, timestamps |
| `overline` | 11/16 | 550, uppercase, +0.06em | nav group labels, table headers, KPI band labels |

Hierarchy is typographic: page titles are only 20px — **the largest text on any screen is always
a money figure**, never chrome.

### 4.3 Spacing, radius, elevation

- **Spacing scale (4px base):** 4, 8, 12, 16, 20, 24, 32, 40, 48, 64. Page padding 24 (16 below
  768px). Card body 16; dense card 12. Gap between page sections 20. Form item gap 16.
- **Space over borders:** cards use a 1px `colorBorderSecondary` hairline and *no* shadow at
  rest; grouping inside cards uses whitespace and overline labels, not nested boxes or Dividers.
  Descriptions grids lose their cell borders.
- **Radius:** 10 cards/drawers/modals, 8 inputs/buttons, 6 chips/tags, 999 status dots and pills
  (`borderRadius: 8` base token; Card override 10).
- **Elevation:** rest = border only. `e1` hover/row-focus `0 1px 2px rgba(15,23,32,.06)` ·
  `e2` drawers/popovers `0 8px 24px rgba(15,23,32,.10)` · `e3` modals
  `0 16px 40px rgba(15,23,32,.18)`. Dark theme replaces shadows with surface lightening (+4% L
  per level) and keeps a subtle `rgba(0,0,0,.4)` drop only at e3.

### 4.4 Motion

- Durations: **120ms** micro (hover, checkbox, chip), **180ms** standard (dropdowns, tab
  underline), **240ms** drawers/modals (24px slide + fade). Easing `cubic-bezier(0.2, 0, 0, 1)`;
  exits `cubic-bezier(0.4, 0, 1, 1)` at 60% duration. Nothing bounces, ever.
- **What animates:** surface entry/exit; the StatusFlow rail fills its segment on advance
  (240ms); realtime-updated numbers crossfade 200ms with a 4px rise plus a 1.2s soft
  `colorPrimaryBg` highlight on the changed row — the user *sees* the ledger move; FIFO
  auto-distribute fills allocation rows with a 40ms stagger so the distribution is legible.
- **What never animates:** sorting/pagination (instant), money changed by the user's own typing,
  page-level layout. `prefers-reduced-motion` collapses everything to 80ms opacity.

### 4.5 Tables & density

- Default density: AntD `small` — 36px rows, 13px type, 8px cell padding; header row 32px,
  overline-styled on the inset background, sticky. Power-desk registers (Orders, Payments, Kassa,
  Reestr) offer a density toggle (36 → 44px «Keng») persisted per user.
- Numeric columns right-aligned tabular; date columns fixed-width; identity column and actions
  never wrap. Whole row clickable (hover: e1 + pointer) with the explicit link kept on the
  identity cell for middle-click/new-tab; row actions live in a trailing kebab menu with labeled
  items (icon-only buttons die).
- **Summary rows are standard:** every filtered register pins a totals row — server aggregate for
  the whole filter where the API returns one; otherwise labeled honestly «sahifa bo'yicha jami».
- Ghost rows (voided/cancelled/reversed): 60% opacity, struck-through amount, inline reason chip,
  chain-link icon jumping to the compensating row. Tri-state visibility filter everywhere:
  Yashirish / Ko'rsatish / Faqat bekor qilinganlar.

### 4.6 Number, money, date formatting

- Money: space-grouped integer so'm (`1 249 547 319`) per existing `fmtMoney`; «so'm» suffix on
  hero figures, totals and print docs — inside tables the header carries «(so'm)» once. **No
  abbreviated money as a primary value anywhere**; `fmtShort` survives only in chart axes.
- Signs: statement amounts render `+ 4 500 000` / `− 4 500 000` with semantic color *and* a
  direction word in the row label; balances render unsigned with their semantic tag («Qarz»,
  «Avans», «Qarzimiz»). `|balance| < 1` renders «0 — hisob teng» (settled, locked epsilon rule).
- USD: `$1 250.00 × 12 650 = 15 812 500 so'm` — the equation always shown; UZS computed
  server-side, never typed by the user.
- Volumes 3dp «m³», pallets integer «dona», per-m³ prices shown at stored precision (6dp never
  silently rounded in price-book surfaces — back-solved prices are real).
- Dates `DD.MM.YYYY`, datetimes `DD.MM.YYYY HH:mm`, Tashkent-local calendar everywhere; every
  range control is one shared component with presets: Bugun · Kecha · Shu hafta · Shu oy ·
  O'tgan oy · Shu yil.
- **Locale unified:** a hand-built `uz_Latn` AntD locale pack (pagination, pickers, empty states)
  + dayjs `uz-latn`. Russian component chrome inside Uzbek screens ends. Legacy artifacts
  (workbook sheet names «Товар», «Оплата», flag texts «шопр учун барди») render verbatim inside
  quote-styled `ArtifactText` chips — quoted evidence, not UI copy.

---

## 5. Component system

The reusable kit this vision needs. Every component is AntD-composed (no new UI library), themed
via tokens, and lives in `apps/web/src/components/ledger/`.

### 5.1 Shell & structure

**`PageHeader`** — one component on every page.
*Anatomy:* breadcrumb (auto from route: «Mijozlar / Jasur Versal»), 20px title with optional
status chip, meta chip row (e.g. agent · region · phone on a party page), right-aligned action
slot (1 primary + overflow kebab), optional tab strip that scrolls with URL `?tab=`.
*States:* loading (skeleton title), sticky-condensed (on scroll the header collapses to 40px:
breadcrumb hides, title 14px, actions stay — balance stays visible on party pages).

**`FilterBar`** — the URL-synced filter row for all registers.
*Anatomy:* search input (debounced 300ms), 0–4 `Select`s (server-searched, paginated — the
50/200-option caps die), shared `RangePicker` with presets, tri-state ghost toggle, active-filter
chips with per-chip clear, «Tozalash» link. Every control writes `useSearchParams`; page resets
to 1 on change; state survives back/forward and is shareable.
*States:* collapsed on mobile into a «Filtrlar (3)» button opening a sheet.

**`SplitView`** — list + detail pane for triage surfaces (allocation inbox, reconciliation
review). Left: 360px worklist column; right: detail. Below 1100px degrades to list → push detail.

**`WorklistCard`** — a queue tile: overline label, count + sum (money-lg), top-3 rows preview,
«Hammasi →» link to the filtered register. Used on Dashboard and hub pages.
*States:* zero (celebration-free: «Hammasi joyida» in tertiary text), loading, error-retry.

### 5.2 Money & ledger primitives

**`MoneyCell`** — the atom under every amount.
*Props:* `value`, `variant: neutral | in | owedToUs | weOwe | ghost`, `signed?`, `suffix?`.
Renders tabular, right-aligned, semantic color per §4.1, strikethrough for ghost. Never receives
a raw sign convention — callers pass the *meaning*.

**`BalanceTag`** — semantic balance chip: «Qarz 12 450 000», «Avans 3 200 000», «Hisob teng»,
with the account-correct phrasing per party type (client: Qarz/Avans; factory: Qarzimiz/Avansimiz;
vehicle: Qarzimiz/—). Used in pickers, tables, headers.

**`PartyBalanceHeader`** — the hero of every party page.
*Anatomy:* party name + status; `money-hero` balance with semantic sentence («Mijoz bizga qarz»);
secondary counters (paddon balance «14 dona», overdue chip «3 ta muddati o'tgan · 8,4 mln»,
credit gauge); quick-action buttons wired to that party («To'lov qabul qilish», «Yangi buyurtma» /
«To'lash», «Bonusdan yopish» / «Shofyorga to'lash»); period selector for the statement below.
*States:* sticky-condensed on scroll (name + balance + one action remain in a 48px bar).

**`PartyStatement`** — the flagship (see §1.2).
*Anatomy:* inset **opening balance row** («Boshlang'ich qoldiq · 01.06.2026») → chronological
rows: date · source label + document link («Buyurtma savdosi · ORD-000214») · note · signed
amount (`MoneyCell`) · running balance (semantic) → inset **closing balance row**. Month
separators as 16px `h2` sticky sub-headers. Reversal pairs joined by a left-gutter connector and
a chain icon; both rows carry «storno» chips; hovering one highlights both. Rows flagged
`reconciled:false` show an amber dot + «Tekshirilmagan» chip.
*Controls:* period presets, «Chop etish» (opens `/print/statement/...`), xlsx export where the
API offers it.
*States:* loading skeleton rows, empty («Bu davrda harakat yo'q»), error-retry.

**`LedgerImpactPreview`** — the impact list rendered inside every destructive confirm and inside
SettleDrawer: bullet rows of exactly what will post/reverse, e.g. «3 ta ledger yozuvi storno
bo'ladi», «ORD-000214 tannarxi PROVISIONAL holatiga qaytadi», «Bonus hisoblanmasi −125 000
tuzatiladi», «Kassaga qaytim: Naqd kassa +2 000 000». Data comes from the record already loaded
(allocations, ledger entries in the payment detail response) — no new endpoints.

**`ReasonModal`** — the single destructive-confirm surface app-wide.
*Anatomy:* danger title, `LedgerImpactPreview`, controlled `TextArea` with inline required
validation (closure-variable anti-pattern dies), danger confirm disabled until reason ≥ 3 chars.
High-stakes variants (import rollback) add typed-word confirmation.

### 5.3 Flow components

**`StatusFlow`** — the order lifecycle rail.
*Anatomy:* 6 segments NEW→COMPLETED rendered as a slim progress rail with labeled nodes; the
*next* legal action is a primary button on the rail («Yuklashni boshlash»); blockers render as an
amber node badge with fix-action («Moshina biriktirilmagan — Biriktirish», opening the
vehicle-assign flow via order edit). ADMIN/ACCOUNTANT get an overflow menu on the rail: skip
forward, one-step back (mandatory note per API), cancel. Cancelled state replaces the rail with a
red banner + reason + link to the reversal set in Tarix.
*States:* per-node done/current/locked/blocked; the COMPLETED node shows «bonus hisoblanadi»
hint pre-completion and the accrued amount after.

**`SettleDrawer`** — the allocation workbench (hero component; full walkthrough §6b–d).
*Anatomy:* header = payment summary (kind, party, amount) + live «Taqsimlanmagan qoldiq» figure;
body = the party's open documents table (order no · date · outstanding/uncovered amount ·
suggested input pre-filled with remainder) with checkboxes; toolbar = «Eskisidan boshlab
taqsimlash» (FIFO auto-distribute), «Tozalash»; footer = consequences via `LedgerImpactPreview`
(cost finalization basis, transport paid flips) + confirm. Posts `POST /payments/:id/allocations`.
*States:* over-allocation hard-blocked inline (row input max = min(outstanding, remaining));
already-allocated rows shown disabled with their existing allocation; empty («Ochiq hujjat yo'q»).

**`PaymentComposer`** — kind-first payment entry, replacing the morphing modal.
*Anatomy:* a 560px drawer opened by intent-named buttons («To'lov qabul qilish» = CLIENT_IN,
«Zavodga to'lash» = FACTORY_OUT, «Shofyorga to'lash» = VEHICLE_OUT, «Mijoz shofyorga to'ladi» =
TRANSPORT_DIRECT, refunds under overflow) so the kind never morphs mid-form. Fields per kind:
party (`PartySelect`, pre-filled when launched from a party surface), amount (`MoneyInput`),
method segmented control, cashbox (`CashboxSelect` — currency-filtered, live balance, disabled
when TRANSPORT_DIRECT with the info line «Bu to'lov kassadan o'tmaydi»), payer/receiver
`LegalEntitySelect` with free-text fallback (finally wiring the catalog), date, note; USD method
swaps in usdAmount + rate (rate pre-filled from the last USD payment loaded from the register)
with the computed equation preview. For ADMIN/ACCOUNTANT a footer checkbox «Saqlash va
taqsimlash» chains straight into `SettleDrawer`. Fresh idempotency key per open; the submit
button is double-click-safe and says what it does: «Qabul qilish — 4 500 000 so'm».
*States:* AGENT sees only CLIENT_IN entry points; CASHIER sees create without allocation chain.

**`PartySelect` / `CashboxSelect` / `LegalEntitySelect`** — the unified pickers: server-searched,
infinite-scroll, option rows show name + `BalanceTag` (+ capacity for vehicles, + currency and
balance for cashboxes). One implementation, used by every form (the six divergent ad-hoc selects
die).

**`MoneyInput`** — formatted integer-so'm input (space grouping while typing), `min` enforced,
optional «max» helper chip («Hamyonda: 1 250 000») that sets the value on click.

**`CreditGauge`** — limit utilization: thin bar + «Limit: 20 mln · Band: 14,2 mln · Bo'sh: 5,8
mln» line; amber ≥ 80%, red at breach; renders in client pickers, client rows, order composer.

**`CapacityMeter`** — pallets vs truck capacity: «17 / 19 paddon» with fill bar; red + submit
guard when exceeded (server will reject — we say so before the click).

### 5.4 Data display

**`StatCard`** — dashboard/KPI atom: overline label, full-precision `money-lg` value, delta chip
vs previous period (↑ 12% «o'tgan oyga nisbatan»; computed from the trends payload already
fetched), 32px sparkline, and — mandatory — a drill-down link («Ko'rish →») to the filtered
register. Entire card clickable.
*Variants:* money, count, signed-profit (green/red value per sign).

**`KpiBand`** — a labeled row of StatCards («SAVDO», «FOYDA», «QARZLAR», «AMALIYOT») with an
overline band label; bands are the dashboard's grouping mechanism (§7 Dashboard).

**`StatusChip`** — single chip component for all enums (order/cost/transport/payment states),
sourced from one label+color map (today's three separate tag components merge). Dot-style for
tables (dot + label, no filled background — quieter at density), filled-tint style for headers.

**`ArtifactText`** — renders legacy Cyrillic/Russian workbook strings as quoted artifacts:
serif-italic, tertiary, wrapped in « » — visually fencing off non-UI language (§4.6).

**`Timeline`** (order Tarix) — unified activity feed: status changes, payments/allocations,
pallet events, comments, with actor + timestamp; composer at the bottom (the separate Izohlar tab
merges here). Grouped by day; money events show `MoneyCell` amounts inline.

**`PrintDocument`** — the print-route scaffold: A4/A5 sheet with dealer letterhead block (name,
INN via legal entity, phone), document title + number, body grid, signature strips («Topshirdi /
Qabul qildi»), and a footer «SmartBlok · chop etildi 11.07.2026 14:32 · foydalanuvchi». Print CSS
only (`@media print` + `@page`); on screen it renders as a preview page with a sticky «Chop
etish» button. Four templates (§9).

**`LiveBadge`** — real socket state (see §2.1); clicking opens the worklist popover.

**`EmptyState` / `ErrorState`** — consistent empties (one-line Uzbek + optional primary action)
and errors (message + «Qayta urinish»); the 403 screen gains «Bosh sahifaga qaytish».

---

## 6. The five hero workflows, redesigned step-by-step

### 6a. Create an order for a client who is on the phone with an agent

*Persona: ACCOUNTANT at the desk, phone wedged on shoulder; the agent dictates. Target: under
90 seconds, hands never leaving the keyboard.*

**Screen: `/orders/new` — a full-page composer in four visual stages down one column (form,
16/24), with a sticky `LedgerPreview` rail (8/24) that behaves like a live receipt.**

1. **Entry.** From anywhere: `⌘K` → «Yangi buyurtma» → Enter (or `N` on `/orders`). Page opens
   with focus already inside the client `PartySelect`.
2. **Stage 1 — Mijoz.** Types «jas…» → server search → option rows show name, agent, region and a
   `BalanceTag` («Qarz 12 450 000»). `↓` `Enter` selects. Instantly the right rail's top card
   fills: **client credit picture** — current balance, credit limit, `CreditGauge` headroom,
   pallets held, overdue chip; below it the *agent's* debt-limit headroom (both facts the server
   will enforce — surfaced *now*, not at submit). If the agent is at his cap, an amber banner
   states it before a single item is typed. `Tab` → date (defaults today) → `Tab` → intended
   factory-payment segmented control (BANK · NAQD) with helper «taxminiy tannarx narxini
   belgilaydi».
3. **Stage 2 — Mahsulotlar.** First item row is pre-created, focus in product select. Options
   grouped by factory; after the first pick the catalog **filters to that factory** (rule: one
   order = one truck = one factory), with an explicit «Zavodni almashtirish» escape that clears
   items. `Tab` → paddon count (types «19») → m³ autofills `19 × 1.728 = 32.832` (editable;
   user-touched m³ is never overwritten again). `Tab` → pricing segmented control: Katalog ·
   Kelishilgan · Umumiy summa · Narxsiz (last visible to office only). Katalog shows the resolved
   price inline — **including the ClientPrice override when one exists**, labeled «maxsus narx»
   (fetched per selected client, so the estimate matches the server). Kelishilgan reveals a
   per-m³ `MoneyInput` with the AGENT floor noted for agents («eng past: zavod o'tkazma narxi»).
   Umumiy summa takes the lump exactly and shows the back-solved per-m³ in small text.
   `Alt+Enter` adds another item row. The rail updates per keystroke: Σ paddon with
   `CapacityMeter`, Σ m³, «Taxminiy savdo».
4. **Stage 3 — Transport.** Vehicle `PartySelect` (options: name · plate · «19 pd» · driver);
   picking fills driver name (only if untouched) and re-bases the CapacityMeter on that truck.
   Mode segmented control (3 live modes): Mijozning transporti · Shofyorga diller to'laydi
   (default) · Shofyorga mijoz to'laydi. One cost `MoneyInput` — the transport is always INSIDE
   `saleTotal`, so under CLIENT_PAYS_DRIVER the rail shows the split «dillerga 22 300 000 ·
   shofyorga 2 000 000» and the exposure DROPS, it never rises
   ([authoritative model](../00-business-map.md#transport-authoritative)). Guard: transportCost > 0 with no vehicle → amber inline warning «Moshina
   tanlanmagan — shofyor qarzi hisobga olinmaydi» requiring an explicit checkbox to proceed.
5. **Stage 4 — Yakun.** Note field, then the rail's bottom card becomes the **ledger preview** —
   the actual postings this order will create, in statement language:
   «Mijoz hisobiga qarz: **+24 300 000** (savdo) − **2 000 000** (shofyorga mijoz to'laydi)
   = **22 300 000**» ·
   «Zavod hisobimizdan: **−21 870 000** (taxminiy, O'TKAZMA narxda)» ·
   «Shofyorga qarzimiz: **−2 000 000**» · «Paddon: mijozga 19 dona». Below it the projected
   client balance after save with the CreditGauge re-drawn. If the projection breaches the limit
   the submit button turns into a disabled explanation («Kredit limitdan oshadi — 3,2 mln»);
   office users may still submit (server is authoritative) via an explicit override click.
6. **Submit.** `⌘Enter` → single POST → success → navigate to `/orders/:id` where the StatusFlow
   rail sits at NEW and a toast offers «Yuk xatini chop etish» once LOADING is reached. Server
   rejections (credit, capacity, floor) render verbatim under the relevant stage, focus moved.

*Why it wins:* the person on the phone reads the rail out loud to the agent — «balansi o'n ikki
mln qarz, sig'im o'n to'qqizdan o'n to'qqiz, jami yigirma to'rt mln» — the receipt-style preview
is the conversation.

### 6b. Collect a payment on a debt, from the Debts view

*Persona: ACCOUNTANT during collections hour; also the CASHIER when a client walks in.*

1. **`/debts?tab=mijozlar&days=7`.** The Mijozlar tab shows the debt board sorted worst-first:
   client (link) · agent · `MoneyCell owedToUs` balance · aging chips (overdue count + sum shown
   *in the row*, not a tooltip) · paddon · payment term · trailing **«To'lov qabul qilish»**
   button on every row. Header: expected collections figure for the window + tab-level totals.
2. **Click the row's action** (or open the client, same button in `PartyBalanceHeader`).
   `PaymentComposer` opens as a drawer, pre-filled: kind CLIENT_IN, client locked, amount
   pre-filled with the outstanding balance (editable — partial payments are normal), method
   defaulting to the client's last-used method (from the loaded payments register), cashbox
   auto-picked to match the method's currency with live balance shown.
3. **Adjust & save.** Cashier types the actual amount «5 000 000», `⌘Enter`. Payment posts:
   ledger credit + kassa IN in one transaction. The drawer's success state shows a mini
   statement delta — «Yangi balans: Qarz 7 450 000» — plus two buttons: **«Kvitansiya chop
   etish»** (opens `/print/receipt/:paymentId`) and «Taqsimlash» (office only).
4. **Allocate (office).** «Taqsimlash» slides the `SettleDrawer` over: the client's open orders
   listed oldest-first with per-order outstanding (`clientChargeable(order)` − allocated —
   [authoritative model](../00-business-map.md#transport-authoritative)). One key: `A` = «Eskisidan boshlab taqsimlash» fills
   FIFO until the 5 000 000 is exhausted; footer shows «Taqsimlanmagan: 0». Confirm. Aging on
   the debt board updates via socket; the row's overdue chip recalculates.
5. **Behind the counter (CASHIER path):** identical steps 2–3 from `/payments`; allocation is
   not offered; the payment lands in the office **allocation inbox** — a WorklistCard on the
   accountant's dashboard listing payments with unallocated remainder (computed from the
   payments register + allocations already present in the payload), each row opening
   `SettleDrawer` directly.

*Total interactions from seeing the debt to printed receipt: 4 clicks (was: 3 pages, ~9
interactions, no receipt at all).*

### 6c. Settle with a factory (pay + allocate + finalize cost + spend bonus)

*Persona: ACCOUNTANT, weekly big-tranche settlement with «CAOLS KS».*

1. **`/factories/:id` — the settlement hub.** `PartyBalanceHeader`: «Zavodga qarzimiz:
   184 250 000 so'm» (or Avansimiz, green), bonus wallet chip «Bonus: 4 310 000», pallet
   accountability «112 dona», and four pre-scoped actions: **To'lash** · **Taqsimlash** ·
   **Bonusdan yopish** · **Paddon qaytarish**. Below, tabs: Hisob-kitob (PartyStatement,
   default) · To'lovlar · Bonus dasturi · Paddonlar. A slim «Ochiq buyurtmalar» strip above the
   statement shows count + uncovered cost of orders not yet FINAL («14 ta buyurtma tannarxi
   qotirilmagan — 96,4 mln qoplanmagan»).
2. **Pay: «To'lash»** opens `PaymentComposer` pre-filled FACTORY_OUT + this factory. Method
   choice displays its consequence up front, in a quiet info line: «O'TKAZMA — taqsimlanganda
   tannarx ZAVOD O'TKAZMA narxida qotiriladi» (CASH/CARD/USD → zavod naqd narxi). Enter
   150 000 000, pick «Bank (Септем Алока)» box (balance shown), check «Saqlash va taqsimlash»,
   `⌘Enter`.
3. **Allocate: `SettleDrawer`** opens with «Taqsimlanmagan qoldiq: 150 000 000». Body lists this
   factory's orders with uncovered provisional cost, oldest-first: ORD no · date · client ·
   provisional cost · covered so far (PARTIAL progress hairline) · **qoplanmagan** · input.
   Press `A` (FIFO): rows fill with a 40ms stagger — 11 orders fully covered, the 12th partially.
   Footer `LedgerImpactPreview` states precisely: «11 ta buyurtma tannarxi QOTIRILADI (O'TKAZMA
   narxida, buyurtma sanasidagi narx qatori) · 1 ta buyurtma QISMAN · tannarx farqlari
   COST_ADJUSTMENT sifatida yoziladi · 3 ta yakunlangan buyurtmaning FOIZLI bonusi qayta
   hisoblanadi». Confirm → `POST /payments/:id/allocations`.
4. **Observe.** Back on the hub the statement gains the payment row and the COST_ADJUSTMENT
   deltas (each linking to its order); the «Ochiq buyurtmalar» strip drops to «3 ta · 12,1 mln»;
   the header balance animates to its new figure. Cost chips on the affected orders flip to
   FINAL everywhere in the app via socket.
5. **Spend bonus: «Bonusdan yopish»** opens a focused modal: wallet balance refetched live
   («Hamyonda: 4 310 000»), amount `MoneyInput` (max chip = wallet), the canonical-chain
   explanation in one sentence («Bonus FACTORY_OUT to'lov sifatida qarzni kamaytiradi — kassadan
   o'tmaydi»), confirm. The statement shows the `BONUS_OFFSET` row; the wallet chip decrements.
   (Withdraw-as-cash lives one menu deeper and asks for the UZS cashbox.)
6. **Print.** Header overflow: «Akt sverki» → `/print/statement/factory/:id?from&to` — the same
   PartyStatement rendered as a signed reconciliation document to hand to the factory.

*The whole session happens on one page. Today it spans four pages with the factory re-selected
three times.*

### 6d. Settle transport with a driver

*Persona: ACCOUNTANT/CASHIER; a driver stands at the desk wanting his money.*

1. **Find the driver.** `⌘K` → type plate «01 A 774» → vehicle result shows `BalanceTag`
   «Qarzimiz 4 000 000» → Enter → **`/vehicles/:id`** (new page; wires the existing rich
   endpoint).
2. **The vehicle page** is a party page like any other: `PartyBalanceHeader` («Shofyorga
   qarzimiz: 4 000 000 so'm», driver name, phone, capacity), quick actions **«Shofyorga
   to'lash»** and «Mijoz to'lagan deb yozish» (TRANSPORT_DIRECT), then two panels:
   **«To'lanmagan yuklar»** — this vehicle's orders with transport cost, allocated coverage and
   UNPAID/UNKNOWN chips (from the vehicle-detail payload — no missing-orders bug: the data is
   the vehicle's own last-50 orders, not a client-side filter of 100 recents) — and the full
   `PartyStatement` beneath.
3. **Pay: «Shofyorga to'lash»** → `PaymentComposer` pre-filled VEHICLE_OUT + vehicle, amount
   pre-filled with the outstanding 4 000 000, cash box selected; «Saqlash va taqsimlash»
   checked by default → `SettleDrawer` lists exactly the unpaid trucks with per-order remaining;
   `A` distributes FIFO; the impact line says «2 ta buyurtma transporti TO'LANDI holatiga
   o'tadi». Confirm. Print «Kvitansiya» for the driver's signature.
4. **The «клентдан» case (CLIENT_PAYS_DRIVER orders only).** If the client paid the driver
   directly, the action «Mijoz to'lagan deb yozish» opens the composer in TRANSPORT_DIRECT:
   client + vehicle + at least one order allocation required, cashbox removed, fixed info line
   «Bu yozuv hech qanday balansni o'zgartirmaydi — bu ulush buyurtma ochilganda mijoz qarzidan
   allaqachon chiqarilgan». On save NOTHING moves in the ledger; the only visible change is the
   truck's transport chip flipping to «Mijoz to'lagan». The *balance* consequence is shown where
   it actually happened — the order's create-time «Shofyorga mijoz to'laydi (summa ichidan)»
   statement row ([authoritative model](../00-business-map.md#transport-authoritative)).
5. **UNKNOWN resolution.** Imported trucks with «Aniqlanmagan» transport sit in the vehicle's
   unpaid panel wearing the violet chip; resolving = recording the real payment (either kind),
   after which the derived status recomputes. The Debts hub's Shofyorlar tab lists all vehicles
   with nonzero liability, each row carrying the same pay action — the fleet-wide sweep view.

*From order detail, the same flow starts with one click: the Transport card's «Shofyorga
to'lash» button pre-binds vehicle + this order's allocation.*

### 6e. The owner's morning check: dashboard → anomaly → act

*Persona: ADMIN (the owner), 8:05, first coffee.*

1. **`/` loads in bands** (§7 Dashboard). Top band SAVDO: Bugungi savdo · Oy savdosi (delta vs
   o'tgan oy) · Sotilgan hajm m³ · Yo'ldagi buyurtmalar (finally rendered!). Band FOYDA: Mahsulot
   foydasi (oy) and Transport foydasi (oy), separately, each labeled with its formula on hover.
   Band QARZLAR: Mijozlar qarzi · Zavodlarga qarzimiz · Shofyorlarga qarzimiz (rendered at last) ·
   Bonus hamyonlar. Band AMALIYOT: Yig'ilgan to'lov (oy) · Mijozlardagi paddonlar · worklist
   cards (Tekshirilmagan to'lovlar; Taqsimlanmagan to'lovlar; Narxlanmagan buyurtmalar).
   Every figure full-precision; every card a link; sparklines from the trends payload.
2. **Anomaly.** «Mijozlar qarzi 1 248 300 000» wears a red delta «↑ 6,2% haftada». The
   owner clicks the card.
3. **Drill.** Lands on `/debts?tab=mijozlar` — the same number decomposed into the board, sorted
   worst-first, aging chips visible. The top row: «Jasur Versal — Qarz 84 200 000 · 3 ta muddati
   o'tgan · 41 kun». Click the client.
4. **Inspect.** `/clients/:id`: the statement shows the story at a glance — three June orders,
   no payments since 02.06, one storno pair from a cancelled order netting zero (visibly
   chained, so no suspicion). The header shows the agent («Jamol») and the CreditGauge at 96%.
5. **Act, in place.** Three actions without leaving: (a) «To'lov qabul qilish» if money arrived;
   (b) header overflow → «Akt sverki chop etish» to send the signed statement to the client;
   (c) click the agent chip → `/agents/:id` to see whether Jamol's whole book is drifting — the
   agent page shows his limit headroom and per-client balances, and `/reports?tab=reyting`
   month-picker comparison confirms whether collections dipped month-over-month.
6. **Close the loop.** Back arrow twice returns through URL-synced state to the exact dashboard.
   The LiveBadge confirms freshness; the numbers he verified are the numbers the accountant
   sees — one source, the ledger.

*Every number reachable in ≤2 clicks from its aggregate, every screen offering the corrective
action in place. This is «boshqaruv paneli» as a verb.*

---

## 7. Screen-by-screen approach

**Dashboard (`/`)** — Banded KPI page replacing the flat 12-card wall. Four `KpiBand`s (SAVDO,
FOYDA, QARZLAR, AMALIYOT) of drillable `StatCard`s with full-precision values, deltas and
sparklines; the duplicate «Kutilayotgan tushum» card is dropped (it equals Mijozlar qarzi — the
forecast figure lives on Debts where its window control is). Orders-in-flight and
Shofyorlarga-qarzimiz — computed today but never rendered — get cards. The 30-day chart gains a
range control (7/30/90/365 → `?days=`), an order-count bar layer, and period totals in its
header; clicking a point opens that day's orders. Agents ranking moves to Reports; in its place,
the worklist cards row. AGENT sees their scoped bands + a personal card from `GET /agents/me`
(limit, band, headroom). LiveBadge is real. — *vs today: grouping, drill-down everywhere, exact
values, visible liabilities, honest realtime.*

**Orders (`/orders`)** — Register with URL-synced FilterBar (status segmented strip stays, plus
client/factory/date/search) and a pinned totals row (Σ sale, Σ m³, Σ paddon for the filter).
Rows gain blocker badges: gold «Narxsiz» (pending price), amber «Moshina yo'q», violet transport
UNKNOWN chip; row kebab: Ko'rish · Holatni oshirish (legal next step only) · Chop etish ·
Bekor qilish (office). Row click opens the workbench. — *vs today: filters survive navigation,
aggregates exist, problems are visible at list level, actions without opening.*

**NewOrder (`/orders/new`)** — See §6a. Four-stage single column + sticky LedgerPreview rail;
client-resolved prices in the estimate; factory-filtered catalog after first item; credit/agent
headroom surfaced at selection time; capacity/vehicle guards before submit; ledger-preview
language for exposure. — *vs today: the summary becomes a live receipt; the invalid states
(mixed factories, over-capacity, cost-without-vehicle) become unreachable or explicit.*

**OrderDetail (`/orders/:id`)** — Two-column workbench. Left (document): items table with
per-item pricing chips and «Narxlash» action, note, pallet movements, Timeline (statuses +
payments + comments merged, composer inline). Right (money rail, sticky): StatusFlow at top;
Moliya card — sale, provisional/final cost with `StatusChip`, goods profit labeled «taxminiy»
until FINAL; To'lov qoplanishi progress based on **`clientChargeable(order)`**
([authoritative model](../00-business-map.md#transport-authoritative)); Transport card
with mode, cost (inside the sale total), paid chip and — new — a mode-scoped
«Shofyorga to'lash» (DEALER_ABSORBED) / «Mijoz to'lagan deb yozish» (CLIENT_PAYS_DRIVER) action; Paddon chip. Header actions: Tahrirlash (→ `/orders/:id/edit`, enabled
only while NEW/CONFIRMED + PROVISIONAL, with an explanatory lock reason otherwise — wired to the
existing PUT), Chop etish menu (Yuk xati · Hisob-faktura), Bekor qilish (ReasonModal with full
impact preview incl. bonus reversal warning from COMPLETED). Vehicle-missing renders as a
StatusFlow blocker with an inline assign action (via the edit endpoint). — *vs today: no more
6-card scroll; money always on screen; every dead-end (edit, vehicle, driver pay) fixed.*

**Order edit (`/orders/:id/edit`)** — The NewOrder composer pre-filled, with a top banner
stating the rules: full item replace, credit re-check, ledger reverse+repost, intended method
immutable (shown disabled), settled transport survives. Confirm shows LedgerImpactPreview of the
reversal/repost. — *new screen; wires the UI-less PUT.*

**Payments (`/payments`)** — Register + intent buttons («To'lov qabul qilish», «Zavodga
to'lash», «Shofyorga to'lash», overflow for refunds/direct). FilterBar adds the `?reconciled=`
filter (finally) and the voided tri-state; a chip row above the table shows filtered totals per
kind. Detail is a URL-addressable drawer (`/payments/:id`) with translated ledger-entry labels,
allocation list, and actions: Taqsimlash (SettleDrawer), Bekor qilish (ReasonModal + impact),
Kvitansiya. «Tekshirilmagan» amber rows carry the reconciliation context. — *vs today: dead
deep-links fixed, allocation reachable post-create, reconciliation queue filterable.*

**Kassa (`/kassa`)** — One period control governs the page. Cashbox cards across the top act as
scoping filters (click = filter summary + log to that box); each card: balance, today in/out,
currency; per-currency grand totals (UZS and USD never summed together). Below: the period
summary table (opening/in/out/closing) and the transaction log where **source documents are
links** (payment drawer, expense row) and MANUAL rows expose storno via ReasonModal. Manual
entry keeps the strict IN/OUT radio. — *vs today: three desynced sections become one scoped
view; investigation stops requiring memory.*

**Debts (`/debts`)** — The collections hub (§6b): tabs Mijozlar · Zavodlar · Shofyorlar ·
Paddonlar. Header stat row = the six summary figures rendered as drillable tab-linked cards.
Mijozlar tab: debt board with in-row aging (overdue count + sum), window select feeding
expected collections, per-row «To'lov qabul qilish», expandable row showing the client's open
orders with due dates. Zavodlar/Shofyorlar tabs: liability boards from the factories/vehicles
list endpoints, per-row pay actions. Paddonlar tab: in-kind balances (agent's scoped view lives
here). — *vs today: three-sided debt in one place, every row actionable, aging visible.*

**Pallets (`/pallets`)** — Office movement ledger: balances (clients | factories) side by side,
one primary action per side, row kebab for the rest; movement table gains date-range + type
filters and a totals footer (net in-kind delta; money totals for CHARGED_LOST/RETURNED rows with
the computed qty × price line total per row). All three mutation modals show the party's current
and post-action balance inline and warn on negative. Unit price prefills from the
`palletPriceDefault` setting (single source; deviation hint shown). — *vs today: investigable
history, guarded mutations, one price truth.*

**Clients (`/clients`)** — Register with FilterBar (search + region/agent selects where the API
honors them), `BalanceTag` column, CreditGauge mini-column, paddon chip, overdue chip. Row kebab:
To'lov qabul qilish · Yangi buyurtma · Akt sverki. Create modal and edit drawer unify into one
right drawer. — *vs today: filters, credit visibility, actions on rows.*

**ClientDetail (`/clients/:id`)** — The archetypal party page: `PartyBalanceHeader` (balance
sentence, paddon, overdue, CreditGauge, actions: To'lov qabul qilish · Yangi buyurtma · Akt
sverki) above tabs: **Hisob-kitob** (PartyStatement, default), Buyurtmalar and To'lovlar (each a
real paginated table *plus* «Hammasini ko'rish →» linking to the filtered global register — the
20-row cap dies), Taxalluslar, Maxsus narxlar (grouped by product, current price highlighted,
future-dated badged «kelgusi», history collapsed). — *vs today: statement-first, actions in
place, full history reachable.*

**Factories (`/factories`)** — Server-searched register: name, `BalanceTag` (Avansimiz/
Qarzimiz), bonus wallet, paddon accountability (from the pallet module's formula — one truth),
bonus-program badge (PER_M3 5 000 / % 1,5 / —), status. Row click → hub. — *vs today: silent
50-row truncation fixed, program overview exists.*

**FactoryDetail (`/factories/:id`)** — The settlement hub (§6c): PartyBalanceHeader with
pre-scoped actions, open-orders strip, PartyStatement default tab (server-paginated,
date-filtered), To'lovlar, Bonus dasturi (current program card + versioned history + «Yangi
dastur» with non-retroactivity note and same-date collision pre-check), Paddonlar. Akt sverki
print in overflow. — *vs today: read-only page becomes the place factory work happens.*

**Bonus (`/bonus`)** — Wallet cards become interactive: each shows balance, program badge, and
two actions (Naqd yechish · Qarzga o'tkazish) pre-scoped; clicking a card filters the journal
below. Journal rows show the accrual basis as real columns («25 m³ × 5 000 = 125 000» rendered,
program version linked), ADJUSTMENT rows explain themselves («tannarx qotirilgani uchun qayta
hisob»), WITHDRAWAL rows keep «Qaytarish» (ReasonModal), DEBT_OFFSET rows deep-link to their
payment for voiding with an explanatory hint. — *vs today: explainability out of tooltips,
actions in context.*

**Products (`/products`)** — Catalog table with live-debounced search; price columns show value
+ effective-from date in small text + «kelgusi narx» badge when a future row exists. Price
drawer: per-kind tabs, current row highlighted, future rows badged. New: **«Narxlarni yangilash»
bulk sheet** — pick factory → editable grid (products × 3 kinds) pre-filled with current prices,
one effectiveFrom, «+X%» quick fill; save issues N versioned POSTs to the existing endpoint with
a per-row result list. — *vs today: the 100-interaction reprice becomes one sheet; hidden future
prices become visible.*

**Procurement (`/procurement`)** — Tab Matritsa: matrix **grouped by product**, cheapest factory
marked within each group (the apples-to-oranges trophy dies), global sort toggle; dropped
products listed with fix links («Narx kiritish →» to Products, «Marshrut qo'shish →» to the
routes tab). Tab **Marshrutlar** (new): versioned route list per factory×region with «Yangi
tarif» form (cost/truck, capacity, effectiveFrom) — wires the existing GET/POST. — *vs today:
the dead-end gains its fix path; comparisons become honest.*

**Vehicles (`/vehicles`)** — Register wired to server search/pagination; columns name, plate,
driver («Shofyor» — the single canonical term app-wide), capacity, `BalanceTag`, status. Row
click → **VehicleDetail** (§6d). — *vs today: rows stop being terminal.*

**Agents (`/agents`)** — Register: name, clients count, open debt, effective limit with
CreditGauge, status. AgentDetail gains an edit action, a month scope (reusing the ranking
endpoint for monthly figures alongside all-time KPIs), and his client board with per-row debt
actions. `/me` renders the same card for the AGENT from `GET /agents/me`. — *vs today: agents
can finally see their own standing; office gets time-scoped review.*

**Reports (`/reports`)** — Three tabs. **Svod**: agent blocks rendered expanded as one grouped
table with sticky agent subtotal rows, every client/factory name linked, identity checks («farq»)
as headline chips pinned at top — green «Mos (0)» / red with the delta; export produces a
workbook shaped like the on-screen layout. **Reestr**: 22 columns tamed by column presets
(«Moliya» / «Logistika» / «Hammasi»), server totals row, fixed identity columns. **Reyting**:
agents ranking with month picker (`?month=`), MoM deltas, debt column labeled «hozirgi qoldiq»,
rows linking to agent pages. — *vs today: the owner's one-glance Свод truly is one glance.*

**Expenses (`/expenses`)** — Adds a header stat strip: filtered total + per-category chips
(client-computed from the filtered set the API returns); voided tri-state filter; category
management drawer (list with usage counts, rename, delete-when-unused — endpoints exist);
ReasonModal for void. — *vs today: counting the month stops meaning paging.*

**Import (`/import`)** — ADMIN-only 4-step wizard: Yuklash → Tekshiruv (checks as a table:
name · kutilgan · haqiqiy · Δ; unreconciled preview table with payer/method; per-kind count
chips; structured unmatched lists) → Import (confirm modal embeds the dry-run numbers being
committed; staged progress overlay) → Solishtirish (headline chips: mos / farqli / izohsiz /
flagged sum; per-client rows expandable to sheetGaps detail; **amber «daftar nuqsoni bilan
izohlangan» vs red «izohsiz — import xatosi»** badges rendering the classification the backend
already returns). Rollback: one ReasonModal with typed ROLLBACK + deletion counts. Dry-run
results persist in localStorage with a «dry run» history row. — *vs today: the decisive
signal (explained vs unexplained) finally on screen; one script policy: UI chrome Uzbek Latin,
workbook terms as ArtifactText.*

**Users (`/users`)** — Search + role/status filter chips, email column, symmetric row actions
(Bloklash / **Faollashtirish**), localized role labels from the single ROLE map. — *vs today:
findable users, discoverable reactivation.*

**Settings (`/settings`)** — Per-field save affordance (each key saves independently with
inline success/error — matching the per-key PUT reality); `saleMarginMinPct` removed from the
form until the backend consumes it; effective values (pallet price, limits) referenced with
«qayerda ishlatiladi» hints. — *vs today: no more silent partial saves, no placebo fields.*

**Profile (`/profile`)** — One editable card (name, login, email — added, phone) + password
card with the session-invalidation note. — *vs today: duplication removed, email reachable.*

**Login (`/login`)** — Unchanged flow; restyled: centered 400px card on the canvas color,
wordmark, two fields, one button; error text verbatim from the API. Dark-mode aware. No
extras — a cash business's front door should be boring.

---

## 8. AGENT mobile experience

The agent's phone is a first-class client of the same SPA — no separate app. Below 768px, agent
routes re-layout; the four office-only groups never render for them anyway.

- **Bottom tab bar** (fixed, 56px, safe-area aware) replaces the sidebar for AGENT on phones:
  Asosiy (`/`) · Buyurtmalar · Mijozlar · **＋** (center FAB: Yangi buyurtma / To'lov qabul
  qilish) · Qarzlar. The TopBar shrinks to breadcrumb-less: page title + LiveBadge + avatar.
- **Tables become card lists.** Every register renders `WorklistCard`-style rows on mobile:
  identity line, semantic balance right-aligned, chips underneath, whole card tappable, actions
  behind a long-press/kebab. No horizontal scrolling anywhere on agent pages.
- **Dashboard**: personal header card from `GET /agents/me` — «Limit: 20 mln · Band: 14,2 mln ·
  Bo'sh: 5,8 mln» with the CreditGauge — then Bugungi savdo, Oy savdosi, Yig'ilgan, Mening
  qarzdorlarim (top-5 debtor cards with call + To'lov buttons), trends chart simplified to 14
  days.
- **New order** becomes a 4-step wizard (one stage per screen: Mijoz → Mahsulot → Transport →
  Tasdiqlash) with a persistent bottom summary bar (Σ paddon · Σ m³ · Σ so'm) that expands into
  the full LedgerPreview on tap. Steppers for pallet counts (±1 targets 44px). The confirm
  screen is the ledger preview — the agent shows it to the client before submitting.
- **Client page**: balance header with tap-to-call phone; statement rows compressed to
  two-line cards (source + date / amount + running balance); «To'lov qabul qilish» as a sticky
  bottom button. Payment composer full-screen with numeric keypad input (`inputmode="numeric"`,
  space-grouped as they type).
- **Debts**: the agent's collection round — sorted debtor cards with distance-free essentials
  (balance, overdue chip, days), swipe-right action «To'lov», tap-to-call. Paddon tab shows
  in-kind counts for their clients.
- **Status advance** from the order card: the single legal next-step button rendered
  full-width; vehicle-missing blocker explains itself.
- Touch rules: min target 44×44, primary actions in thumb reach (bottom third), forms
  single-column, date pickers native-feeling AntD mobile pickers, all money visible without
  hover (no tooltip-only information anywhere on mobile — a hard rule).
- Performance: agent routes ship in the base chunk with charts lazy-loaded; skeletons under
  300ms; socket reconnect banner («Oflayn — oxirgi yangilanish 14:32») since field connectivity
  is patchy. True offline mode is explicitly out of scope (§10).

---

## 9. Print documents

All frontend-only: dedicated `/print/*` routes rendering `PrintDocument` from data already
served by the API, with `@page` CSS. Header on every document: dealer identity (DEALER legal
entity name + INN when linked, phone), document title + number, date. Footer: «SmartBlok»
micro-brand + print timestamp + user. Fonts: Inter; money tabular; A4 portrait unless noted.
Each document opens as an on-screen preview with a sticky «Chop etish» button; browsers handle
PDF.

**1. Yuk xati (driver waybill) — at LOADING, A5 landscape, 2 copies per sheet.**
For the driver and the factory gate. Content: ORD number + date big in the corner; FROM factory
name/address; TO client name, region, phone; vehicle plate + driver name; items table (mahsulot,
o'lchami, paddon, m³); Σ paddon / Σ m³ bold; paddon reminder line («qaytariladigan paddon: 19
dona»); signature strips: Zavod topshirdi · Shofyor qabul qildi · Mijoz qabul qildi. **No
prices anywhere** — drivers and gates don't see money.

**2. Hisob-faktura (client invoice) — from OrderDetail, A4.**
Items with per-m³ price and line totals, Σ savdo, then — under CLIENT_PAYS_DRIVER only — a
«shundan shofyorga» deduction line and the net JAMI the client owes the dealer (never a
transport line added on top — [authoritative model](../00-business-map.md#transport-authoritative));
client's balance before/after this order (from the statement math — the invoice doubles as a
mini reconciliation); payment terms + due date; requisites block (dealer legal entity, client
name); signatures. Lump-sum items print the lump with the back-solved unit price in small text.

**3. Kvitansiya (cashier receipt) — from any payment, A5 portrait, 2 copies (client/kassa).**
Payment number + datetime; received from / paid to (party); amount in digits **and words**
(Uzbek number-to-words, frontend util); method + cashbox; USD equation when applicable; the
client's new balance line («Qoldiq: Qarz 7 450 000 so'm»); allocation list when present
(ORD-000214: 3 000 000 …); cashier name + signature; client signature.

**4. Akt sverki (reconciliation statement) — from client/factory pages, A4, multi-page-safe.**
The PartyStatement verbatim in print form: period; opening balance; the rows (date, hujjat,
izoh, debet, kredit — two-column money in classic akt style derived from the signed amounts),
running balance; closing balance boxed and worded («11.07.2026 holatiga mijozning qarzi
7 450 000 so'm»); reversal pairs printed with their chain reference; unreconciled rows marked
«tekshirilmagan» honestly; two signature blocks (Diler / Mijoz yoki Zavod) with «e'tirozlar»
line. Page numbers «2/3»; table headers repeat per page (`thead { display: table-header-group }`).

Print CSS globals: chrome stripped; colors forced to ink (`print-color-adjust`; semantic colors
degrade to weight — bold for balances); hairline table borders; 12pt body, 10pt tables.

---

## 10. What we deliberately do NOT do

Restraint is part of the spec. Each item below is a conscious *no*, not an omission.

1. **No UI that needs new endpoints.** No cashbox CRUD (seed-only reality stays visible: the
   Kassa page states boxes come from setup), no file attachments (the dead Document model is
   ignored), no manual ADJUSTMENT ledger entry screen, no opening-balance wizard, no
   mark-reconciled write action (we filter and *display* reconciled state; clearing the flag
   awaits its endpoint), no audit-log browser. All flagged as backend-first backlog.
2. **No invented metrics.** «Kutilayotgan tushum» is not re-derived into a fantasy forecast; the
   duplicate dashboard card is removed and the honest windowed figure stays on Debts.
   `saleMarginMinPct` leaves the Settings UI until code consumes it. Expected vs actual stays
   exactly the backend's math.
3. **No agent commissions, no gamification.** The bonus machinery is factory-side by owner
   decision; the agents ranking stays a plain table — no leaderboards, badges, or streaks.
4. **No editing history, ever.** No «quick fix» affordances on posted rows, no inline amount
   editing in statements, no delete buttons renamed «archive». Corrections are storno/void/cancel
   with reasons — the UI makes the correct path fast instead of the wrong path possible.
5. **No dashboard customization, saved views, or widget builders.** One opinionated layout per
   role. URL-synced filters already give shareable views for free.
6. **No offline mode / PWA sync.** Field connectivity gaps are handled by honest staleness
   banners, not by a conflict-resolution science project on top of an immutable ledger.
7. **No multi-language toggle at launch.** One primary language (Uzbek Latin) applied
   consistently — including component chrome via the uz_Latn locale pack; Cyrillic/Russian
   workbook artifacts render as quoted `ArtifactText`, never translated, never mixed into UI
   copy. i18n extraction is prepared (strings centralized) but a RU switch ships only when the
   owner asks.
8. **No client-side money math beyond display.** Previews label themselves «taxminiy»; the
   server remains the only calculator; the UI never types a computed UZS for USD payments.
9. **No new colors for decoration.** Color budget is spent on meaning (§4.1); illustrations,
   gradients, and celebratory confetti do not exist in an ERP that moves a billion so'm a month.
10. **No kanban/board views for orders.** One order = one truck = a linear lifecycle; the
    StatusFlow rail expresses it better than draggable cards that would imply free status jumps
    the API forbids.
11. **No reactivation UI for clients** (UpdateClientDto has no `active` field — building the
    toggle would fake a capability); the gap is documented in-place with a tooltip on the
    Nofaol tag.
12. **No AI anything.** The trust story of this product is deterministic double-entry
    arithmetic; nothing probabilistic belongs between the owner and his ledger.

---

# Appendices — implementation-grade detail

## Appendix A — Key-screen wireframes (structural, not pixel)

### A.1 Dashboard (ADMIN/ACCOUNTANT, ≥1200px)

```
┌ TopBar: Boshqaruv paneli · [⌘K] · ● Jonli · ☾ · Alibek (Admin) ────────────────┐
│ SAVDO ─────────────────────────────────────────────────── [7k|30k|90k|365k]    │
│ ┌ Bugungi savdo ┐ ┌ Oy savdosi     ┐ ┌ Sotilgan hajm  ┐ ┌ Yo'ldagi buyurtmalar┐│
│ │ 48 300 000    │ │ 812 450 000    │ │ 402,336 m³     │ │ 7 ta                ││
│ │ ↑12% kechaga  │ │ ↑4% o'tgan oyga│ │ ~sparkline~    │ │ 3 yuklanmoqda       ││
│ │ ~sparkline~ → │ │ ~sparkline~  → │ │              → │ │                   → ││
│ └───────────────┘ └────────────────┘ └────────────────┘ └─────────────────────┘│
│ FOYDA                                QARZLAR                                    │
│ ┌ Mahsulot foydasi (oy) ┐┌ Transport ┐┌ Mijozlar qarzi ┐┌ Zavodlarga qarzimiz ┐│
│ │ +96 210 000 (taxminiy │└ +4 100 000┘│ 1 248 300 000  ││ 184 250 000         ││
│ │  3 ta tannarx ochiq)  │             │ ↑6,2% haftada ⚠││ Bonus: 4 310 000    ││
│ └───────────────────────┘             └──────────────→─┘└───────────────────→─┘│
│ ┌ Shofyorlarga qarzimiz: 6 000 000 → ┐ ┌ Mijozlardagi paddonlar: 1 040 dona → ┐│
│ AMALIYOT — ISHLAR                                                              │
│ ┌ Tekshirilmagan to'lovlar ┐ ┌ Taqsimlanmagan to'lovlar ┐ ┌ Narxlanmagan     ┐ │
│ │ 23 ta · 95 800 000       │ │ 4 ta · 12 500 000        │ │ 2 ta buyurtma    │ │
│ │ …top-3 rows… Hammasi →   │ │ …rows… Hammasi →         │ │ …rows… Hammasi → │ │
│ └──────────────────────────┘ └──────────────────────────┘ └──────────────────┘ │
│ ┌ So'nggi 30 kun: savdo va yig'ilgan to'lovlar  · Jami: 812,4M / 640,2M ─────┐ │
│ │ [line: Savdo] [line: Yig'ilgan] [bars: buyurtmalar soni]                   │ │
│ └─────────────────────────────────────────────────────────────────────────────┘│
```

### A.2 ClientDetail — the archetypal party page

```
┌ Mijozlar / Jasur Versal ────────────────────────────────────────────────────────┐
│ Jasur Versal   [Faol]      Agent: Jamol · Urganch · +998 …                      │
│                                                                                 │
│ MIJOZ BIZGA QARZ                          [To'lov qabul qilish] [Yangi buyurtma]│
│ 84 200 000 so'm                           [⋯ Akt sverki · Tahrirlash]           │
│ ⚠ 3 ta muddati o'tgan · 41 kun   Paddon: 14 dona   Limit ▓▓▓▓▓▓▓▓░░ 96%        │
├── Hisob-kitob ── Buyurtmalar ── To'lovlar ── Taxalluslar ── Maxsus narxlar ─────┤
│ [Shu oy ▾]  [Chop etish]                                                        │
│ ┌ Boshlang'ich qoldiq · 01.06.2026                         Qarz 41 300 000 ┐    │
│ │ 03.06  Buyurtma savdosi · ORD-000201        + 24 300 000  Qarz 65 600 000│    │
│ │ 03.06  Shofyorga mijoz to'laydi · ORD-000201 −  2 000 000  Qarz 63 600 000│   │
│ │ 05.06  To'lov · Naqd · PAY-000318           − 10 000 000  Qarz 53 600 000│    │
│ │ ┌ 09.06  Buyurtma savdosi · ORD-000205 (bekor) + 28 300 000  …           │    │
│ │ └⛓ 10.06  Storno · ORD-000205               − 28 300 000  Qarz 53 600 000│    │
│ │ 18.06  Buyurtma savdosi · ORD-000214        + 30 600 000  Qarz 84 200 000│    │
│ └ Yakuniy qoldiq · 30.06.2026                              Qarz 84 200 000 ┘    │
```

### A.3 SettleDrawer (FACTORY_OUT allocation)

```
┌ Taqsimlash — PAY-000412 · Zavodga to'lov · O'TKAZMA ──────────────── ✕ ┐
│ To'lov: 150 000 000 so'm      TAQSIMLANMAGAN QOLDIQ: 150 000 000       │
│ Narx asosi: ZAVOD O'TKAZMA (to'lov usulidan)                           │
│ [A — Eskisidan boshlab taqsimlash]                [Tozalash]           │
│ ☑ ORD-000188 02.06 Jasur Versal  tannarx 13,9M  ▓▓▓░ qoplanmagan 9,2M │
│      [ 9 200 000 ]                                                     │
│ ☑ ORD-000190 04.06 Shiddat       tannarx 14,2M  qoplanmagan 14,2M     │
│      [ 14 200 000 ]                                                    │
│ …                                                                      │
│ ─ Natija ──────────────────────────────────────────────────────────    │
│ • 11 ta buyurtma tannarxi QOTIRILADI (O'TKAZMA narxida)                │
│ • 1 ta buyurtma QISMAN qoplanadi                                       │
│ • Tannarx farqi COST_ADJUSTMENT sifatida yoziladi                      │
│ • 3 ta buyurtmaning foizli bonusi qayta hisoblanadi                    │
│                                  [Bekor]  [Taqsimlash — 150 000 000]   │
└────────────────────────────────────────────────────────────────────────┘
```

### A.4 OrderDetail workbench (≥1100px)

```
┌ Buyurtmalar / ORD-000214 · [Tasdiqlangan] ───────────────────────────────────────┐
│ ORD-000214 · 18.06.2026 · Jasur Versal (→)     [Tahrirlash] [Chop etish ▾] [⋯]  │
├───────────────────────────────────────┬──────────────────────────────────────────┤
│ POZITSIYALAR                          │ ○──●──○──○──○──○  NEW→…→COMPLETED        │
│ ┌ Gazoblok D500 600×300×200          │ [Yuklashni boshlash]                      │
│ │ 19 pd · 32,832 m³ · 740 000/m³     │ ⚠ Moshina biriktirilmagan → [Biriktirish] │
│ │ = 24 295 680  [katalog]            │                                           │
│ └ + Narxlash (agar narxsiz)          │ MOLIYA                                    │
│                                       │ Savdo            24 295 680               │
│ IZOH ……                               │ Tannarx (taxminiy)21 870 000 [PROVISIONAL]│
│                                       │ Mahsulot foydasi  +2 425 680 (taxminiy)   │
│ PADDON: mijozga 19 dona               │ To'lov qoplanishi ▓▓▓▓░░ 10M / 24,6M      │
│                                       │ TRANSPORT — Shofyorga diller to'laydi     │
│ TARIX (yagona lenta)                  │ Xarajat 2 000 000 (summa ichidan)         │
│ ● 18.06 14:02 Yaratildi (Alibek)      │ [To'lanmagan] [Shofyorga to'lash]         │
│ ● 18.06 14:05 Tasdiqlandi             │ PADDON: 19 dona mijozda                   │
│ ● 19.06 09:12 To'lov 10M (→PAY-000318)│                                           │
│ ✎ izoh yozish…                        │                                           │
└───────────────────────────────────────┴──────────────────────────────────────────┘
```

---

## Appendix B — Canonical glossary (one term, one script)

The redesign fixes one Uzbek (Latin) term per concept; deprecated synonyms are listed to be
purged from code and copy. Workbook/legacy terms render only as `ArtifactText` quotes.

| Concept | Canonical | Deprecated / legacy |
|---|---|---|
| Orders | Buyurtmalar | — |
| Order (one truck) | Buyurtma | «Товар» (workbook row) |
| Clients | Mijozlar | — |
| Payments | To'lovlar | «Оплата» |
| Debts / collections | Qarzlar | — |
| Pallets | Paddonlar | Поддон, «pallet» |
| Cash desk | Kassa | — |
| Expenses | Xarajatlar | Расход |
| Factories | Zavodlar | — |
| Bonus wallets | Bonus hamyonlar | — |
| Vehicles | Moshinalar | — |
| Driver | **Shofyor** | Haydovchi, шопир — purged |
| Agents | Agentlar | — |
| Regions | Hududlar | — |
| Legal entities | Yuridik shaxslar | — |
| Reports | Hisobotlar | — |
| Summary report | Svod | Свод Завод |
| Orders register | Buyurtmalar reestri | — |
| Statement | Hisob-kitob | выписка |
| Reconciliation statement | Akt sverki (solishtirish dalolatnomasi) | акт сверки |
| Waybill | Yuk xati | накладная |
| Receipt | Kvitansiya | — |
| Invoice | Hisob-faktura | счёт |
| Allocation | Taqsimlash / Taqsimot | аллокация |
| Void / storno | Bekor qilish (hujjat) / Storno (kassa/ledger yozuvi) | удалить — forbidden word |
| They owe us (client) | Qarz | — |
| Client's advance | Avans | — |
| We owe (factory/driver) | Qarzimiz | — |
| Our advance at factory | Avansimiz | — |
| Provisional cost | Taxminiy tannarx | — |
| Final cost | Tannarx qotirilgan | — |
| Pending price | Narxsiz | Narxlanmagan |
| Unreconciled | Tekshirilmagan | Tekshirilsin |
| Roles | Admin · Buxgalter · Agent · Kassir | Hisobchi (purged), raw enums (purged) |

Rules: role labels come from a single `ROLE` map (label + color); status labels from single
`STATUS` maps (the three tag components merge); no screen may introduce a synonym; every
Cyrillic string that reaches the UI from data is wrapped in `ArtifactText`.

---

## Appendix C — Interaction grammar & keyboard map

**Surface grammar (one pattern per intent, app-wide):**

| Intent | Surface |
|---|---|
| Browse/filter a register | Full page, FilterBar, URL-synced |
| Create simple record (client, product, vehicle, agent, region, entity, user) | Right drawer, 480px |
| Create money document (payment, expense, kassa manual) | PaymentComposer-style drawer, 560px |
| Compose complex document (order) | Full page with preview rail |
| View record detail | Party/workbench page (order, client, factory, vehicle, agent); URL-addressable drawer for payments and kassa rows |
| Allocate / settle | SettleDrawer over its context |
| Destroy/void/cancel/reverse | ReasonModal with LedgerImpactPreview |
| Bulk edit (prices) | Full-page editable sheet |

**Keyboard map:**

| Key | Context | Action |
|---|---|---|
| `⌘K` | global | palette (records + commands) |
| `/` | list pages | focus search |
| `N` | list pages | new record (role-permitting) |
| `F` | list pages | open filter bar first control |
| `E` | detail pages | edit (when legal) |
| `P` | detail pages | print menu |
| `A` | SettleDrawer | FIFO auto-distribute |
| `⌘Enter` | any form | submit |
| `Alt+Enter` | order composer | add item row |
| `Esc` | any | close topmost surface (guard on dirty forms) |
| `Alt+1…5` | global | jump to nav group's first item |
| `J / K` or `↑/↓` | tables | row focus; `Enter` opens; `.` opens row kebab |

Focus management: drawers/modals trap focus, return it on close; toasts are `aria-live=polite`;
destructive confirm buttons are never default-focused. Hit targets ≥ 32px desktop, ≥ 44px touch.
Contrast: all text ≥ 4.5:1 both themes (semantic palette pre-checked in §4.1); color is never
the only signal (chips carry words, deltas carry arrows + words).

---

## Appendix D — theme.ts token specification (drop-in shape)

```ts
// Light
{
  algorithm: antdTheme.defaultAlgorithm,
  token: {
    colorPrimary: '#26617F', colorInfo: '#26617F', colorLink: '#26617F',
    colorSuccess: '#2E8B57', colorWarning: '#B07A18', colorError: '#C2413B',
    colorBgLayout: '#F6F7F9', colorBgContainer: '#FFFFFF',
    colorBorder: '#E3E7EC', colorBorderSecondary: '#EDF0F3',
    colorText: '#1B2530', colorTextSecondary: '#5B6774', colorTextTertiary: '#8A94A0',
    borderRadius: 8, borderRadiusLG: 10, borderRadiusSM: 6,
    fontFamily: "'Inter var', 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif",
    fontSize: 14, fontSizeHeading3: 20, lineHeight: 1.5715,
    controlHeight: 32, controlHeightSM: 26,
    motionDurationFast: '0.12s', motionDurationMid: '0.18s', motionDurationSlow: '0.24s',
    motionEaseInOut: 'cubic-bezier(0.2, 0, 0, 1)',
    boxShadow: '0 1px 2px rgba(15,23,32,.06)',
    boxShadowSecondary: '0 8px 24px rgba(15,23,32,.10)',
  },
  components: {
    Layout: { siderBg: '#F1F3F6', headerBg: '#FFFFFF', headerHeight: 48 },
    Menu: { itemBg: 'transparent', itemSelectedBg: '#E8F0F5', itemSelectedColor: '#26617F',
            itemHeight: 34, groupTitleFontSize: 11 },
    Table: { headerBg: '#F3F5F7', headerColor: '#5B6774', cellPaddingBlockSM: 8,
             rowHoverBg: '#F6F8FA', fontSize: 13 },
    Card:  { borderRadiusLG: 10, paddingLG: 16 },
    Drawer:{ paddingLG: 20 },
    Tag:   { borderRadiusSM: 6 },
    Statistic: { contentFontSize: 20 },
  },
}
// Dark: darkAlgorithm + overrides
{
  colorPrimary: '#7FB0CC', colorLink: '#7FB0CC',
  colorSuccess: '#6CC495', colorWarning: '#D9A94A', colorError: '#E8827C',
  colorBgLayout: '#0E1216', colorBgContainer: '#161C22',
  colorBorder: '#2A333C', colorBorderSecondary: '#222A32',
  colorText: '#E6EBF0', colorTextSecondary: '#9AA7B4', colorTextTertiary: '#6C7885',
  components: { Layout: { siderBg: '#12171D', headerBg: '#161C22' },
                Table: { headerBg: '#10151A', rowHoverBg: '#1B222A' } }
}
```

Custom CSS (`ledger.css`) carries only: `.num` (tnum), statement connector gutter, ghost-row
treatment, sticky condensed headers, print rules, sparkline sizing, reduced-motion overrides.

---

## Appendix E — URL parameter schema (contract for FilterBar)

| Route | Params (all optional, all server-mapped) |
|---|---|
| `/orders` | `status, search, clientId, factoryId, from, to, page, pageSize, density` |
| `/payments` | `kind, method, clientId, factoryId, search, from, to, voided(hide/show/only), reconciled(true/false), page` |
| `/payments/:id` | `panel=taqsimlash` |
| `/clients` | `search, regionId, page` |
| `/clients/:id` | `tab, from, to, panel=tolov` |
| `/debts` | `tab(mijozlar/zavodlar/shofyorlar/paddonlar), days(7/14/30), search, page` |
| `/kassa` | `cashboxId, from, to, source, page` |
| `/expenses` | `categoryId, cashboxId, from, to, voided, page` |
| `/reports` | `tab(svod/reestr/reyting), from, to, month, clientId, factoryId, preset(moliya/logistika/hammasi)` |
| `/factories/:id`, `/vehicles/:id`, `/agents/:id` | `tab, from, to` |
| `/procurement` | `tab(matritsa/marshrutlar), regionId, productId` |
| `/` | `days` (chart range) |
| `/print/statement/*` | `from, to` |

Conventions: dates `YYYY-MM-DD` (Tashkent-local calendar days); enums lowercase in URL, mapped
to API enums; unknown params ignored; every param change resets `page` except `page/pageSize`
themselves; browser back restores the previous param set exactly (single source of truth:
`useSearchParams`, no parallel useState).

---

## Appendix F — Pain-point coverage matrix (brief → design response)

Every [high] pain point from the design brief, and where this vision answers it:

| Brief pain point | Answer |
|---|---|
| No UI to allocate an existing payment | SettleDrawer on `/payments/:id?panel=taqsimlash`, launched from payment drawer, factory hub, vehicle page, debt rows (§5.3, §6b–d) |
| Allocation rows are blind (no outstanding, no prefill) | SettleDrawer shows per-order outstanding/uncovered, prefilled remainders, FIFO `A`, live remaining (§6c) |
| Collecting payment from Debts takes many clicks | Row-level «To'lov qabul qilish» with prefilled composer + receipt print (§6b) |
| Reconciliation dead end (`reconciled=false` unfilterable) | `?reconciled=` wired into Payments FilterBar + worklist card + amber statement dots; write-action deferred to backend (§7 Payments, §10.1) |
| No order edit UI | `/orders/:id/edit` wires existing PUT with lock-reason messaging (§7) |
| Order stuck without vehicle | StatusFlow blocker + inline assign via edit endpoint (§5.3, §7 OrderDetail) |
| No vehicle detail / driver settlement trek | `/vehicles/:id` party page + pre-bound pay actions (§6d) |
| VEHICLE_OUT picker silently incomplete | Allocation candidates come from the vehicle-detail payload (its own orders), not a client-side filter of 100 recents (§6d) |
| KPI cards are dead ends; hidden KPIs (in-flight, weOweVehicles) | Every StatCard links; both hidden KPIs get cards (§7 Dashboard, §6e) |
| Fixed chart range / ranking month | `?days=` control; Reports Reyting tab with month picker (§7) |
| LIVE tag decorative | LiveBadge bound to socket state with last-refresh time (§2.1) |
| Factory settlement scattered across 4 pages | FactoryDetail settlement hub (§6c) |
| Bonus actions split from wallets; accrual basis hidden | Wallet cards act; basis rendered as columns with formula (§7 Bonus) |
| Import's explained/unexplained classification invisible | Solishtirish step renders the classification as amber/red badges + sheetGaps expansion (§7 Import) |
| Import role mismatch (ACCOUNTANT 403s) | `/import` ADMIN-only in nav, routes and UI — aligned to backend (§2.2, §3.1) |
| Svod collapsed panels, no links | Expanded grouped table, sticky subtotals, all names linked, farq chips pinned (§7 Reports) |
| No consolidated P&L | **Not built** (needs expense-join endpoint); the honest partial answer is labeled profit cards + register totals; flagged backend-first (§10.1) |
| Filter amnesia / dead deep links | URL-synced FilterBar everywhere + `/payments/:id` addressable (App. E) |
| Agent can't see own limit (`/agents/me` unused) | `/me` card + dashboard header card for AGENT (§8) |
| Client estimate ignores ClientPrice override | Composer fetches client-resolved prices on selection; estimates labeled taxminiy (§6a) |
| No printable documents | Four print routes, frontend-only (§9) |
| Clients list unfilterable; deactivated client unrecoverable | FilterBar; reactivation deliberately not faked — flagged (§10.11) |
| No aggregate footers anywhere | Summary rows standard on all registers (§4.5) |
| Logistics routes have no UI | Procurement → Marshrutlar tab over existing endpoints (§7) |
| Factory-wide reprice = click marathon | Bulk price sheet composing existing versioned POSTs (§7 Products) |
| Mixed ru/uz locale | uz_Latn locale pack + ArtifactText policy (§4.6, App. B) |

---

## Appendix G — Rollout order (design-led, risk-first)

1. **Foundation sprint:** tokens/theme, PageHeader, FilterBar+URL sync, MoneyCell/BalanceTag,
   StatusChip merge, uz_Latn locale, table density defaults. Every existing page re-skins
   without behavior change — the app looks like Ledger Clarity in week one.
2. **Money spine:** PartyStatement + PartyBalanceHeader on ClientDetail/FactoryDetail; Payments
   drawer URL-addressability; PaymentComposer; SettleDrawer; Debts hub tabs. (Hero flows b, c.)
3. **Operations:** OrderDetail workbench + StatusFlow + order edit; NewOrder composer rework;
   VehicleDetail; worklist cards; Dashboard bands. (Hero flows a, d, e.)
4. **Paper & periphery:** print routes; Reports rework; Products bulk sheet; Procurement routes
   tab; Kassa unification; Expenses totals; Users/Settings/Profile polish.
5. **Migration finale:** Import wizard (ADMIN), reconciliation rendering — timed with go-live.

Each phase ships behind the existing route structure; no big-bang.

---

## Appendix H — The CASHIER terminal (`/` for KASSIR), full specification

The cashier is a *focused terminal* persona: one person, one desk, cash and cards moving all
day. Their dashboard stops being a dead-end summary and becomes the working surface itself.

```
┌ Kassa paneli · ● Jonli · Gulnora (Kassir) ──────────────────────────────────────┐
│ [To'lov qabul qilish]  [Zavodga to'lash]  [Shofyorga to'lash]  [Xarajat]        │
│                                                                                 │
│ ┌ Naqd kassa      ┐ ┌ Bank (Септем Алока)┐ ┌ Click        ┐ ┌ Valyuta (USD)  ┐  │
│ │ 14 250 000      │ │ 182 400 000        │ │ 3 100 000    │ │ $2 130.00      │  │
│ │ ↑ 5,2M  ↓ 1,1M  │ │ ↑ 12,0M  ↓ 0       │ │ ↑ 600k ↓ 0   │ │ ↑ $0  ↓ $0     │  │
│ └─────────────────┘ └────────────────────┘ └──────────────┘ └────────────────┘  │
│ Jami UZS: 199 750 000 · Jami USD: $2 130.00                                     │
│                                                                                 │
│ BUGUNGI OPERATSIYALAR (jonli lenta)                                             │
│ 14:32  + 5 000 000  Naqd kassa   Mijozdan to'lov · Jasur Versal   [Kvitansiya]  │
│ 13:10  − 1 100 000  Naqd kassa   Xarajat · Yoqilg'i                             │
│ 11:47  +   600 000  Click        Mijozdan to'lov · Normat Umidbek [Kvitansiya]  │
│ …                                                        [Hammasi → /kassa]     │
└─────────────────────────────────────────────────────────────────────────────────┘
```

- **Quick actions first.** Four intent buttons sit above the fold; each opens the
  PaymentComposer/expense drawer pre-scoped. The cashier records a walk-in payment in three
  interactions and prints the kvitansiya from the success state — without ever "navigating".
- **Cashbox cards** show balance (money-lg), today's in/out mini-stats, currency; clicking a
  card filters the feed below and preselects that box in the next composer open. Per-currency
  grand totals render beneath the cards (UZS and USD summed separately, never merged).
- **Today's operations feed** is the cashier's audit trail: live rows (socket-fed) with
  direction-signed `MoneyCell`, source label, party, and a per-row Kvitansiya print for
  payment-sourced rows. Rows link to the payment drawer (read-only for KASSIR — no void, no
  allocation, matching the API matrix).
- **Boundaries visible:** allocation controls and void actions simply don't exist in the
  cashier's UI (not disabled-but-present); an info line under a saved payment says
  «Taqsimlashni buxgalter bajaradi» so the handoff is explicit. Manual kassa entry and
  storno-of-manual-rows remain on `/kassa` per the role matrix.
- End-of-shift: the Kassa page's period summary with «Bugun» preset is the reconciliation
  surface (opening/in/out/closing per box); printable via the browser through the same print
  CSS used elsewhere.

---

## Appendix I — State catalog (loading, empty, error, permission)

One implementation per state class, reused everywhere:

| State | Treatment |
|---|---|
| List loading (first) | Skeleton rows (5 × row-height), header intact — layout never jumps |
| List refetch | Existing rows stay (keepPreviousData) + 2px progress hairline under the header; no spinners over data |
| Detail loading | Skeleton of the real layout (balance block, tab bar, 6 statement rows) |
| Empty register (no filter) | EmptyState: one line + primary action («Hali buyurtma yo'q — Yangi buyurtma») |
| Empty register (filtered) | «Filtrga mos yozuv topilmadi» + «Filtrlarni tozalash» link — never the generic empty |
| Empty statement period | «Bu davrda harakat yo'q» + opening=closing balance rows still rendered (a statement with no rows is still a statement) |
| Query error | ErrorState card: Uzbek message + server text + «Qayta urinish»; never a blank region |
| Mutation error | Inline under the offending field where mappable (server messages carry limits/balances — shown verbatim); toast only as fallback |
| 403 route | Result 403 + «Bosh sahifaga qaytish» button |
| Socket down | LiveBadge grey «Oflayn — ma'lumot HH:mm holatiga»; refetch-on-focus enabled as safety net; amber reconnect banner on agent mobile |
| Dirty-form close | Confirm «O'zgarishlar saqlanmagan» (Esc guard) |
| Double submit | Idempotency key + button self-disables with spinner and keeps its verb («Qabul qilinmoqda…») |
| Stale balance in composer | Party balances in pickers refetch on drawer open; wallet/cashbox balances refetched before max-validation (client max is advisory; server remains authoritative) |

---

## Appendix J — Realtime & data-freshness behavior

- **Invalidation debounce:** socket `change` events are coalesced per entity family in a 2s
  window (a burst of 15 payment events → one refetch per affected key family). The existing
  entity-name-first query-key convention is preserved (it is a locked contract with
  `lib/realtime.ts`).
- **Row-level pulse:** when an invalidation lands on a visible list and a row's data changes,
  the row gets the 1.2s `colorPrimaryBg` pulse (§4.4) — activity is visible, not mysterious.
- **refetchOnWindowFocus: true** app-wide (was disabled) — the safety net for dropped sockets;
  staleTime stays 30s so focus-refetches are cheap.
- **Freshness stamp:** the LiveBadge tooltip shows «Oxirgi yangilanish: 14:32:05». When the
  socket is down, every KPI band shows a subtle inline «14:32 holatiga» suffix — numbers are
  never silently stale.
- **Composer collision courtesy:** if a socket event touches the record open in a drawer
  (e.g. someone else voided the payment you're allocating), a non-blocking banner appears in
  the drawer: «Bu hujjat boshqa foydalanuvchi tomonidan o'zgartirildi — Yangilash». Server
  row-locks remain the actual guard; the UI just avoids surprise rejections.

---

## Appendix K — Agent mobile wireframe (New order wizard, step 4)

```
┌ Yangi buyurtma — 4/4 Tasdiqlash ────────────┐
│ Jasur Versal            Qarz 12 450 000     │
│ ─────────────────────────────────────────── │
│ Gazoblok D500 · 19 pd · 32,832 m³           │
│ 740 000 so'm/m³ (maxsus narx)               │
│                        24 295 680 so'm      │
│ Transport: Diler hisobidan · 01 A 774       │
│ ─────────────────────────────────────────── │
│ MIJOZ QARZIGA YOZILADI                      │
│ 24 295 680 so'm                             │
│ Yangi balans:  Qarz 36 745 680              │
│ Limit ▓▓▓▓▓▓▓░░░ 73%                        │
│ Sizning limitingiz: bo'sh 5,8 mln ✓         │
│ ─────────────────────────────────────────── │
│ [◀ Orqaga]      [Buyurtma berish ✓]         │
├─────────────────────────────────────────────┤
│  🏠      📦      👥      ＋       💰        │
│ Asosiy Buyurtma Mijozlar        Qarzlar     │
└─────────────────────────────────────────────┘
```

The confirmation step *is* the ledger preview — the agent turns the phone to the client, both
see the same number that will hit the account, and the tap that follows is informed consent.
This, in one screen, is the whole vision: **the ledger, made legible, at the moment of
commitment.**

---

*End of vision. — LEDGER CLARITY: the ledger is the product; the UI is its clearest possible
reading. Balances you can trust at a glance, statements you can hand across the desk, and a
correction model that grows the record instead of erasing it.*
