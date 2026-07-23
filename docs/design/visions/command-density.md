# SmartBlok UX Vision — «BUYRUQ VA ZICHLIK» (Command & Density)

> Design vision, 2026-07. Angle: keyboard-first, information-dense enterprise UI in the
> Linear / GitHub / Stripe tradition. Business logic LOCKED — this is a UI/UX vision over the
> existing NestJS API. Everything specified here is buildable with React 18 + Ant Design v6
> (ConfigProvider tokens + custom CSS), @ant-design/plots, TanStack Query, react-router 6 and
> the already-wired socket.io realtime layer. No new backend endpoints are assumed anywhere;
> where a queue or preview is computed client-side over existing endpoints, the document says so
> explicitly and bounds the computation.

**Contents**

1. Design philosophy
2. App shell & navigation
3. Information architecture (full route tree, fate of all 26 pages)
4. Design language (tokens: color, type, space, radius, elevation, motion, density, number rules)
5. Component system
6. The five hero workflows, redesigned step-by-step
7. Screen-by-screen approach
8. AGENT mobile experience
9. Print documents
10. What we deliberately do NOT do

---

# 1. Design philosophy

Five principles, each derived from how this specific business works — a gas-block dealer in
Khorezm moving 2–4 trucks a day on an immutable double-entry ledger, run by two desk
professionals, a handful of field agents on phones, and one cashier.

### 1.1 The ledger is the interface

Every balance in SmartBlok is `Σ` of immutable postings — never a stored number. The UI must
honor that: **every money figure on screen is a door, not a decoration.** Clicking any balance,
KPI, or total opens the postings that produced it (a filtered list, a statement, a peek panel).
There are zero dead numbers. Corollary: reversals, voids and storno rows are never hidden by
default styling tricks alone — they render as visible strike-through pairs that net to zero, so
the trust the immutable ledger earns in the database is *felt* in the interface. The old
workbook died of untraceable edits (the 95.8M фарк); the UI's job is to make traceability
ambient, not a feature you go looking for.

### 1.2 One keystroke from anywhere to any money action

ADMIN and ACCOUNTANT live in this app 8 hours a day. The unit of cost is the interaction, and
today's flows spend them recklessly (6–8 interactions to pay a driver; leave Qarzlar → open
To'lovlar → re-find the same client to record a payment). The command palette (`Ctrl+K`) is the
front door to the entire product: it navigates, it searches records (clients by name/phone,
orders by number, payments), and it *performs* — "yangi buyurtma", "to'lov qabul qilish",
"shofyorga to'lash" — pre-scoping the action to whatever entity is on screen. Every list has
single-key verbs (Linear-style): `t` = to'lov, `o` = ochish, `p` = peek. If a daily task takes
more than three keystrokes plus typing, the design has failed.

### 1.3 Never lose the list

Master-detail without navigation loss is the structural signature of this vision. Lists are
where orientation lives; detail opens **beside** the list in a peek panel, not instead of it.
The URL captures everything — filters as query tokens, the peeked record id, the saved view —
so back-button, refresh, and pasted links always reconstruct the exact screen. The current app's
"filter amnesia" (all filter state in `useState`, dead deep links like
`/payments?paymentId=…` that nothing reads) is the single most corrosive daily friction; this
vision makes the URL the one true filter store.

### 1.4 Density with hierarchy — typography over chrome

The workbook this ERP replaced showed a whole month of trucks on one screen. Professionals want
that density back, but structured: 13px tabular-numeral tables at 36px row height, hierarchy
expressed through type weight/size and a strict two-accent color budget (money-green,
debt-red; everything else neutral), spacing instead of borders, no card-inside-card nesting.
Color is spent only on meaning: signed money, status, and blocked states. If a screen looks
"designed", we've decorated; if it looks like a well-set financial newspaper page, we've
succeeded.

### 1.5 The system names the unfinished work

This domain is full of legitimately *pending* states the current UI renders invisible:
payments nobody allocated (so costs never finalize), unpriced trucks (Narxlanmagan), imported
transport rows the owner must resolve (Aniqlanmagan), unreconciled workbook payments
(Tekshirilsin, ~95.8M UZS), orders stuck without a vehicle, overdue debts. Each becomes a
first-class **queue** with a live count — a worklist you drain, not a report you interpret.
Queues are composed purely from existing endpoints (`?reconciled=false`, status filters, the
debts overdue flags, the orders register scan) — see §3.4 for the exact data recipe per queue.

---

# 2. App shell & navigation

## 2.1 Layout geometry

```
┌──────────────┬──────────────────────────────────────────────────────────────┐
│              │  Header 44px: [breadcrumb] [⌘K command bar] [live] [☾] [user]│
│   Sidebar    ├──────────────────────────────────────────────────────────────┤
│   240px      │                                                              │
│   (rail 56px)│   Content (PageHeader + body), padding 20px,                 │
│              │   optional PeekPanel 420–560px docked right                  │
│              │                                                              │
└──────────────┴──────────────────────────────────────────────────────────────┘
```

- **Sidebar**: 240px, collapsible to a 56px icon rail (`[` toggles). NOT a dark slab anymore —
  it uses the app's raised surface (light `#F7F8FA`, dark `#14181E`) separated from content by
  a 1px `colorBorderSecondary` line. Same tone family as content = one calm workspace, Linear
  style. Wordmark row 44px: `▦ SmartBlok` (13px/600, brand color glyph), doubles as home link.
- **Header**: 44px (down from 52). Contents left→right:
  1. Breadcrumb trail (from PageHeader context): `Buyurtmalar / ORD-000123` — 12px, secondary.
  2. **Command bar** — centered, a real button styled as a 320px search field:
     `⌕ Qidiruv va buyruqlar…  Ctrl+K`. Clickable for mouse users (fixes the dead grey hint).
  3. **LiveDot** — real socket state, not decoration: green `● Jonli` / amber `↻ Ulanmoqda…` /
     grey `○ Oflayn — oxirgi yangilanish 09:41`. Clicking forces a refetch of the current page's
     queries.
  4. Theme toggle (sun/moon icon button, not a Switch).
  5. User chip: avatar + name + **localized** role label from one shared ROLES map
     (Administrator / Buxgalter / Agent / Kassir — never the raw enum). Dropdown: Profil,
     Klaviatura yorliqlari (`?`), Chiqish.
- **Content**: max-width none (density wins), 20px padding. Print CSS hides shell (`no-print`).

## 2.2 Navigation tree per role

Items grouped by *frequency of use*, not by entity type. Every item has an icon (rail mode must
never show blank rows). Badge counts on queue-bearing items are populated from cheap existing
queries (see §3.4) and update via the realtime invalidation the app already has.

**ADMIN / ACCOUNTANT** (identical except last group):

```
  Boshqaruv paneli                 (/)            icon: dashboard
  Navbatlar                 [7]    (/navbatlar)   icon: inbox — queue hub, count = Σ queues

  SAVDO ────────────────
  Buyurtmalar                      (/orders)
  Mijozlar                         (/clients)
  Qarzlar                          (/debts)

  MOLIYA ───────────────
  To'lovlar                        (/payments)
  Kassa                            (/kassa)
  Xarajatlar                       (/expenses)
  Paddonlar                        (/pallets)
  Bonus hamyonlar                  (/bonus)

  TAHLIL ───────────────
  Hisobotlar                       (/reports)
  Ta'minot                         (/procurement)   (matritsa + marshrutlar)

  KATALOG ── (collapsed group by default) ──
  Zavodlar                         (/factories)
  Mahsulotlar                      (/products)
  Moshinalar                       (/vehicles)
  Agentlar                         (/agents)
  Hududlar                         (/regions)
  Yuridik shaxslar                 (/legal-entities)

  TIZIM ── (ADMIN only; ACCOUNTANT sees only read-only Tizim sozlamalari) ──
  Foydalanuvchilar                 (/users)
  Tizim sozlamalari                (/settings)
  Excel import                     (/import)        ADMIN only (fixes the 403 role mismatch)
```

**AGENT** (desktop; mobile shell in §8):

```
  Panelim                          (/)              scoped dashboard
  Buyurtmalar                      (/orders)
  Mijozlar                         (/clients)
  Qarzlar                          (/debts)
  To'lovlar                        (/payments)
  Paddonlar                        (/pallets)
  Ko'rsatkichlarim                 (/me)            NEW — GET /agents/me finally has a home
```

**CASHIER**:

```
  Kassa paneli                     (/)              terminal dashboard
  To'lovlar                        (/payments)
  Kassa                            (/kassa)
  Xarajatlar                       (/expenses)
```

Rules: nav visibility, route guards and in-page action visibility all derive from **one shared
permission map** (`lib/permissions.ts`: role → capability), aligned by hand with the backend
`@Roles` matrix. The Import/ACCOUNTANT drift class of bug becomes structurally impossible.

## 2.3 The command palette — the product's front door

Built on the existing CommandPalette shell, extended from "navigate to 22 routes" to three
stacked providers, queried in parallel as you type:

1. **Buyruqlar (actions)** — verb-first entries, role-filtered, context-aware:
   - `Yangi buyurtma` (`c o`), `To'lov qabul qilish` (`c p`), `Xarajat kiritish` (`c x`),
     `Qo'lda kassa amali`, `Paddon qaytarish qabul qilish`, `Zavodga to'lov`,
     `Shofyorga to'lash`, `Bonus: naqd yechish`, `Bonus: qarzga o'tkazish`.
   - Context pre-scoping: when the palette opens on `/clients/:id`, action entries show the
     party chip — `To'lov qabul qilish → Jasur Versal` — and open the composer pre-filled.
2. **Yozuvlar (records)** — live server search, debounced 250ms, three queries in parallel:
   `GET /clients?search=`, `GET /orders?search=` (matches order no and client name),
   `GET /payments?search=`. Results grouped with count chips; each row shows the identifying
   fact inline (client → balance chip; order → date + status tag; payment → amount + kind).
   Enter opens; `Shift+Enter` opens as peek on the current list where applicable.
3. **Sahifalar (navigation)** — the current route list, with Uzbek/Russian/English keyword
   aliases preserved (typing «оплата» finds To'lovlar).

Recents: last 10 opened records per user in localStorage, shown when the query is empty.
Anatomy: 640px surface, 15px input, grouped results, right-aligned key hints, footer legend
(`↑↓ tanlash · Enter ochish · Shift+Enter peek · Esc yopish`). Opens in 160ms fade+scale.

## 2.4 Global keyboard map

Single-key "go" chords (Linear grammar), active outside inputs:

| Keys | Action |
|---|---|
| `Ctrl+K` / `/` on lists | Command palette / focus search token |
| `g` `d` | Boshqaruv paneli |
| `g` `o` | Buyurtmalar |
| `g` `m` | Mijozlar |
| `g` `t` | To'lovlar |
| `g` `q` | Qarzlar |
| `g` `k` | Kassa |
| `g` `n` | Navbatlar |
| `c` `o` | Yangi buyurtma |
| `c` `p` | Yangi to'lov |
| `c` `x` | Yangi xarajat |
| `[` | Sidebar collapse |
| `?` | Keyboard cheat-sheet overlay |
| `Esc` | Close peek / modal / palette (in that nesting order) |

List-scope keys (every DataGrid): `↑/↓` or `j/k` row focus, `Enter` open detail page,
`Space` or `p` toggle peek, `x` select row, `Shift+↑/↓` extend selection, `t` To'lov (on
debts/clients rows), `e` edit (where legal), `f` open filter bar, `v` saved-views menu,
`.` row action menu. All shortcuts are listed in the `?` overlay and shown as hints in menus.
Keyboard hints render as `<kbd>` chips (11px, tertiary, 1px border) — visible, never cryptic.

## 2.5 Where things live

- **Global search / palette**: header center + `Ctrl+K`. There is no separate "search page".
- **Notifications**: none invented (no backend). The realtime layer's job is silent freshness;
  the LiveDot plus queue badges are the only "notification" surface.
- **Theme**: header icon button; both themes are first-class (§4).
- **Saved views**: per-list dropdown in the FilterBar (localStorage per user id, §5.3).
- **Print**: on detail pages and peek panels as explicit actions (`Ctrl+P` remaps to the
  contextual document where one exists, e.g. invoice on OrderDetail).

---
# 3. Information architecture

## 3.1 Full route tree with role access

Roles: **A**=ADMIN, **B**=ACCOUNTANT (Buxgalter), **G**=AGENT, **K**=CASHIER (Kassir).
`(G:own)` = server-scoped to the agent's own rows. All list routes are URL-synced:
`?q=&status=&clientId=&factoryId=&from=&to=&page=&view=&peek=<id>` (only the params each list
supports; unknown params ignored).

```
/login                                   public
/                                        A B G K   role-variant dashboard (G scoped, K terminal)
/navbatlar                               A B       queue hub (frontend-composed, §3.4)

/orders                                  A B G(own)     list + peek panel
/orders/new                              A B G          full-page command form
/orders/:id                              A B G(own)     workbench
/orders/:id/edit                         A B            NEW — wires PUT /orders/:id
                                                        (guard: NEW/CONFIRMED + costStatus=PROVISIONAL)

/clients                                 A B G(own)
/clients/:id                             A B G(own)     party workspace + statement
/debts                                   A B G(own; no summary cards)

/payments                                A B K G(own CLIENT_IN)   list; detail = ?peek=<id>
/payments/:id                            → redirect to /payments?peek=:id (URL-addressable detail;
                                                        fixes the dead deep link from OrderDetail)
/kassa                                   A B K
/expenses                                A B K          + category manager (existing PUT/DELETE)
/pallets                                 A B G(scoped read-only)
/bonus                                   A B

/factories                               A B
/factories/:id                           A B            settlement hub (§7)
/products                                A B            catalog + price drawer + bulk price grid
/vehicles                                A B
/vehicles/:id                            A B            NEW — wires GET /vehicles/:id
/agents                                  A B
/agents/:id                              A B
/me                                      G              NEW — wires GET /agents/me
/regions                                 A B
/legal-entities                          A B

/procurement                             A B            tabs: Matritsa | Marshrutlar
                                                        (Marshrutlar wires GET/POST /procurement/routes)
/reports                                 A B            tabs: Svod | Reestr | Agentlar | Davr
/import                                  A             (was A+B in nav — backend is ADMIN-only; fixed)

/users                                   A
/settings                                A (write), B (read-only — GET /settings already allows it)
/profile                                 A B G K

/print/order/:id/invoice                 A B G(own)     Hisob-faktura
/print/order/:id/waybill                 A B G(own)     Yo'l varaqasi
/print/payment/:id/receipt               A B K G(own)   Kvitansiya
/print/client/:id/statement?from&to      A B G(own)     Solishtirish dalolatnomasi (akt sverki)
```

Dashboard params wired at last: the trends chart drives `GET /dashboard/trends?days=` from a
range control (7/30/90/365) and the agents ranking drives `?month=YYYY-MM` from a month picker —
both synced to the URL (`/?days=90`, `/reports?tab=agentlar&month=2026-06`).

## 3.2 Fate of the 26 existing pages

| Existing page | Fate in this vision |
|---|---|
| Dashboard | **Rebuilt** — banded KPIs, every card drills down, range/month params wired (§7.1) |
| Orders | **Rebuilt** — token FilterBar, saved views, split peek, summary row, bulk bar (§7.3) |
| NewOrder | **Rebuilt in place** — same route, keyboard-first command form (§6.a) |
| OrderDetail | **Rebuilt** — two-column workbench + sticky money rail, status menu, quick actions (§7.5) |
| — | **NEW /orders/:id/edit** — pre-filled NewOrder form over PUT /orders/:id |
| Payments | **Rebuilt** — peek panel replaces Drawer, URL-addressable, allocation workbench, reconciled filter (§7.7) |
| Kassa | **Restructured** — one period control; cashbox cards are filters; linked documents clickable (§7.8) |
| Debts | **Rebuilt as collections cockpit** — row actions, expandable open-orders, statement peek (§7.9) |
| Pallets | **Restructured** — balances master + movement detail, actions in row menus (§7.10) |
| Clients | **Kept, upgraded** — real filters (region/agent/status/balance-state), credit headroom column (§7.11) |
| ClientDetail | **Rebuilt as party workspace** — action bar, full-history tabs, statement print (§7.12) |
| Factories | **Kept, upgraded** — server pagination/search, program column (§7.13) |
| FactoryDetail | **Rebuilt as settlement hub** — pay/allocate/bonus/pallet actions in place (§6.c, §7.14) |
| Bonus | **Kept, upgraded** — wallet cards become actionable + filter the journal (§7.15) |
| Products | **Kept + NEW bulk price grid** mode per factory (§7.16) |
| Procurement | **Kept + NEW Marshrutlar tab**; matrix grouped by product (§7.17) |
| Vehicles | **Kept**; rows open **NEW VehicleDetail** (§7.18) |
| Agents / AgentDetail | **Kept, upgraded** — period selector, edit in place (§7.19) |
| — | **NEW /me** for AGENT (§8) |
| Regions | **Kept as light catalog**; client count links to filtered /clients |
| LegalEntities | **Kept as light catalog**; entity pickers surfaced in payment composer |
| Reports | **Expanded hub** — Svod (expanded default, linked), Reestr (summary row, column presets), Agentlar (moved from dashboard w/ month picker), Davr (client-composed period digest) (§7.20) |
| Expenses | **Kept, upgraded** — filtered totals strip, voided tri-state filter, category manager (§7.21) |
| Import | **Rebuilt as stepper**, ADMIN-only, renders the hidden reconciliation verdicts (§7.22) |
| Users | **Kept, upgraded** — search/filters, email column, symmetric activate action (§7.23) |
| Settings | **Kept**; ACCOUNTANT gets read-only view; no-op field flagged (§7.23) |
| Profile | **Simplified** — single editable card + email field (§7.23) |
| Login | **Kept**, restyled (§7.24) |

Nothing is deleted; two page-shaped things die as *patterns*: the Payments detail **Drawer**
(replaced by URL-addressable peek) and the dashboard-locked agents ranking (moves to Reports
with a month picker; the dashboard keeps a compact current-month copy that links there).

## 3.3 Cross-linking contract

Every detail surface must expose, as links or peek triggers: its party (client/factory/vehicle
→ their workspace), its documents (order ↔ payments via allocations, kassa row → source
payment/expense via `?peek=`), and its money trail (every LedgerEntry row → its source
document). Every KPI and summary card carries `→` navigation to the filtered list that produced
it. Reverse test used in QA: from any number, reach its postings in ≤2 clicks; from any posting,
reach its document in 1.

## 3.4 The queue hub — /navbatlar (data recipes, all existing endpoints)

| Queue (tab) | Count & rows come from | Notes |
|---|---|---|
| **Tekshirilsin** — unreconciled imported payments | `GET /payments?reconciled=false` | The ~95.8M UZS review queue. No "mark reconciled" endpoint exists, so rows offer *review* affordances only: open payment peek, open client statement, print. The queue drains by voiding wrong payments (existing) or naturally after owner sign-off; the badge is the memory. |
| **Muddati o'tgan** — overdue clients | `GET /debts/clients` rows where `hasOverdueOrders` | Row action `t` opens payment composer pre-filled. |
| **Yo'lda** — orders in flight | 3 parallel `GET /orders?status=` (CONFIRMED, LOADING, DELIVERING), merged client-side | Also surfaces the dashboard's invisible `ordersInFlight` KPI. |
| **Moshinasiz** — in-flight orders without vehicle | Same fetch as Yo'lda, filtered client-side on `vehicle == null` | Row action: assign vehicle inline (via /orders/:id/edit path or the OrderDetail quick action). |
| **Narxlanmagan** — price-pending trucks | `GET /reports/orders-register?from&to` scan (paged), rows with pricePending/sale=0 | Register endpoint already returns these columns; window selector (default: joriy oy) is shown on the tab so the scan is honest about its bounds. A B only. |
| **Transport aniqlanmagan** — imported UNKNOWN transport | Same register scan, `transport holati = Aniqlanmagan` | Row action: open order → Transport card → settle. A B only. |

The hub is one page with left tab rail (counts), right DataGrid per queue, and each row's
primary resolving action bound to `Enter`. The nav badge on «Navbatlar» is the sum, fetched
lazily (counts only, first page metadata) and refreshed by the existing realtime invalidation.

---
# 4. Design language

All values are concrete and map onto AntD v6 ConfigProvider tokens plus a small custom CSS
layer (`design.css`, target < 400 lines). Both themes are specified fully; dark is not a filter
over light.

## 4.1 Color system

### Brand & interaction

| Token | Light | Dark | Use |
|---|---|---|---|
| `colorPrimary` | `#2E6584` | `#6FA3C1` | actions, links, focused controls, selected nav |
| primary hover | `#3A7699` | `#82B1CC` | |
| primary active | `#24536E` | `#5D93B4` | |
| primary subtle bg | `#E9F1F6` | `#182A36` | selected rows, active tab underlay, info chips |
| focus ring | `#2E6584 @ 35%` 2px outside | `#6FA3C1 @ 45%` | every focusable element, keyboard-first demands visible focus |

### Semantic (color = meaning, used nowhere else)

| Meaning | Light | Dark | Subtle bg (light/dark) |
|---|---|---|---|
| Money-in / success / settled | `#157F3D` | `#4BC17B` | `#E7F4EC` / `#12291B` |
| Money-out / debt / danger | `#C0362C` | `#F0655D` | `#FBEAE8` / `#331714` |
| Warning / provisional / due-soon | `#9A6700` | `#DDA043` | `#FFF3D6` / `#33270F` |
| Info / in-progress | = primary | = primary | primary subtle |
| Special (imported, adjustment, USD) | `#6D5BB8` | `#A79BE0` | `#EFEBFA` / `#231D3A` |

Status tag mapping (replaces the current 7-hue Tag zoo with a 6-hue budget):
- **Order**: NEW neutral · CONFIRMED info · LOADING warning · DELIVERING warning (filled) ·
  DELIVERED teal `#0E7A8A`/`#4FB3C4` · COMPLETED success · CANCELLED danger.
- **Cost**: PROVISIONAL neutral-outline · PARTIAL warning · FINAL success.
- **Transport paid**: UNPAID danger · PAID success · PAID_BY_CLIENT teal · UNKNOWN special ·
  NOT_APPLICABLE neutral em-dash.
- Charts follow the existing CVD-safe pair (`#1f6f9e`/`#b47a00` light) extended per the dataviz
  palette; series colors never reuse the semantic red/green.

### Surfaces & text

| Token | Light | Dark |
|---|---|---|
| `colorBgLayout` (canvas) | `#F3F4F6` | `#0E1116` |
| `colorBgContainer` (cards, tables) | `#FFFFFF` | `#161A20` |
| raised (sidebar, peek panel, sticky rails) | `#F7F8FA` | `#14181E` |
| overlay (modal, palette) | `#FFFFFF` | `#1C2129` |
| `colorBorderSecondary` | `#E5E7EC` | `#262C36` |
| text primary | `#1B2430` | `#E7EBF1` |
| text secondary | `#5A6472` | `#9AA4B2` |
| text tertiary / hints / kbd | `#8B94A3` | `#6B7484` |
| table header text | secondary, 12px/500 | same |

Rule: **spacing over borders** — sibling blocks separate with 16–24px gaps; borders are
reserved for table internals (row hairlines at `colorBorderSecondary @ 60%`), input outlines,
and the shell seams. No `Card` inside `Card`.

## 4.2 Typography

Font stack (zero-latency system fonts, tabular numerals everywhere numbers appear):
`"Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, "Inter", sans-serif`;
numerals get `font-variant-numeric: tabular-nums lining-nums` via the global `.num` class and
on all table cells, stat values, and money components by default.

| Style | Size/Line | Weight | Use |
|---|---|---|---|
| Stat hero | 28/34 | 650 | dashboard band leads, party balance headers |
| H1 page title | 20/28 | 600 | PageHeader only |
| H2 section | 16/24 | 600 | band titles, panel headers |
| H3 card/group | 14/20 | 600 | grouped table sections, modal titles |
| Body | 14/22 | 400 | forms, prose, descriptions |
| Table body | 13/20 | 400 | all DataGrids |
| Money emphasis | 13/20 | 600 | totals, balances in cells |
| Label / caption | 12/16 | 500 | column headers, field labels, meta chips |
| Micro / kbd | 11/14 | 500 | key hints, timestamps, footnotes |

No uppercase transforms (Uzbek Latin diacritics read badly in caps); hierarchy comes from
weight + color, not case.

## 4.3 Spacing, radius, elevation

- **Spacing scale (px)**: 2, 4, 8, 12, 16, 20, 24, 32, 40, 48. Page padding 20; grid gutter 12;
  form vertical rhythm 12; band gap 24; control-to-label 4.
- **Radius**: controls 6; cards/panels/peek 8; modals/palette 10; tags/pills 999; table cells 0.
- **Elevation** (light / dark adds 1px border instead of deep shadow):
  - e0 flat: none (tables, in-page cards — border-separated only where needed)
  - e1 raised card: `0 1px 2px rgba(16,24,40,.05)`
  - e2 popover/dropdown/peek: `0 4px 16px rgba(16,24,40,.10)`
  - e3 modal/palette: `0 12px 32px rgba(16,24,40,.18)`
- **Controls**: height 32 (28 in dense table toolbars), input font 14, `controlPaddingHorizontal` 10.

## 4.4 Motion

| Event | Duration / easing | What animates |
|---|---|---|
| Hover/focus states | 100ms linear | bg, border, shadow |
| Dropdown/popover | 120ms ease-out | opacity + 4px translateY |
| Peek panel open/close | 180ms `cubic-bezier(.2,0,0,1)` | translateX; list width does NOT reflow (panel overlays with 1px seam) |
| Modal / palette | 160ms | opacity + scale .98→1 |
| Realtime row change | 1200ms ease-out fade | one-shot subtle primary-subtle background pulse on the changed row — data itself never animates |
| Status/step transitions | 200ms | StatusFlow segment fill |
| Numbers | **never** | no count-up animations, ever — this is a ledger |
| `prefers-reduced-motion` | all → opacity-only, ≤80ms | |

## 4.5 Table density & data presentation

- Row height 36px default («Zich»), 44px «Keng» toggle per user (localStorage), header 32px.
- Cell padding 6px 12px; first column 16px inset; numeric columns right-aligned `.num`.
- Sticky header always; sticky **summary row** (Σ of the *entire current filter*, server totals
  where the endpoint provides them, otherwise labeled «sahifa jami»).
- Row hover raises bg one step; focused row gets a 2px left accent bar (keyboard cursor);
  selected rows use primary subtle bg + checkbox.
- Voided/cancelled rows: 60% opacity + strike-through on the amount only (not the whole row —
  dates and parties stay legible for audit reading).
- Column headers get unit suffixes so cells don't repeat them: «Summa (so'm)», «Hajm (m³)».

## 4.6 Number, money, date rules

- Locale: **uz-Latn primary end-to-end.** ConfigProvider gets a project-maintained uz-Latn
  locale pack (pagination «Jami: N ta», picker months in Uzbek), dayjs locale `uz-latn`.
  Digit grouping stays space-separated (`1 249 547 319`) — identical output to today's ru-RU
  grouping, so no retraining.
- Money: whole so'm everywhere (`fmtMoney`); `so'm` appears in headers/labels, not in every
  cell. Signed money renders with a true minus `−` and semantic color; positive collections
  green only in explicitly signed contexts (statements, kassa IN/OUT), otherwise neutral.
- Balance semantics are always **worded**, never sign-only: `1 250 000 Qarz` (red) /
  `1 250 000 Avans` (green) / `Hisob toza` (settled, |x| < 1 so'm per `isSettled`).
- Abbreviation (`fmtShort` «1.2 mlrd») is allowed ONLY in chart axes and the mobile agent
  dashboard; desktop KPIs show full grouped values with a smaller secondary delta line.
- USD: `$1 250.00 × 12 650 = 15 812 500 so'm` — always the full equation, rate visible.
- Dates `DD.MM.YYYY`, datetimes `DD.MM.YYYY HH:mm`; relative stamps («3 daqiqa oldin») only in
  activity feeds with the absolute value in the tooltip. All range presets are Tashkent-days:
  Bugun · Kecha · 7 kun · Joriy oy · O'tgan oy · Joriy yil · Oraliq…
- Per-m³ prices display up to 6dp trimmed (`732 542.438`); volumes 3dp; percent 2dp.

---

# 5. Component system

The reusable kit. Each entry: purpose · anatomy · states/behavior. All are AntD-composed
(no new UI library), themed by the §4 tokens.

### 5.1 PageHeader
Purpose: one consistent page identity + action surface; feeds the shell breadcrumb.
Anatomy: breadcrumb (parent list link) · H1 title with inline meta chips (status tag, id,
date) · right action cluster (1 primary + overflow `…` menu with key hints) · optional tab row.
States: sticky on scroll (compresses to 44px, title 14px); loading skeleton; print-hidden.

### 5.2 FilterBar (token filters)
Purpose: every list filter is a removable keyboard token, URL-synced.
Anatomy: `⌕` free-text token (always first) + typed tokens (`Holat: Yuklanmoqda ×`,
`Mijoz: Jasur Versal ×`, `Sana: joriy oy ×`) + `+ Filtr` adder menu + RangeChips presets +
SavedViews dropdown + result meta («214 ta yozuv · Σ 1 249 547 319 so'm»).
Behavior: `f` opens the adder; each token edits in a popover with the matching control
(Select w/ server search, RangePicker, segmented); every change writes `searchParams`
(replace, page→1); back/forward restore exactly; tokens serialize compactly (`?status=LOADING`).
States: empty (ghost prompt «Filtr qo'shish uchun f»), overflowing (tokens wrap to 2 rows max
then collapse into `+3`), invalid param in URL (token rendered red with clear affordance).

### 5.3 SavedViews
Purpose: per-user named filter+column+sort+density presets per list (Linear views).
Anatomy: dropdown in FilterBar: built-ins (e.g. Orders: «Barchasi», «Yo'lda», «Narxlanmagan*»,
«Bugungi trucklar») + user views + «Joriy ko'rinishni saqlash…».
Behavior: stored in localStorage keyed `sb_views:<userId>:<route>`; a view is just a URL query
string + column set; `v` cycles views. (*views that need client-side computation are marked and
scoped to a window, per §3.4.)

### 5.4 DataGrid
Purpose: the one table. Wraps AntD Table with the vision's contract.
Anatomy: sticky header · keyboard cursor row · selection column (appears on first `x`) ·
summary row · column chooser (presets: «Pul», «Logistika», «Hammasi» on wide registers) ·
density toggle · sort headers (server-driven where API supports, else disabled with tooltip).
States: loading (header + 8 skeleton rows, never spinner-on-empty), error (inline Alert +
Qayta urinish), empty (EmptyState with the action that would create data), realtime pulse row,
voided-row styling.

### 5.5 SplitView + PeekPanel
Purpose: master-detail without losing the list (§1.3).
Anatomy: list occupies full width; PeekPanel (420px lists / 560px money documents) docks right
with e2 shadow, header (title, open-full-page `↗`, print, close), body of Description rows +
mini-tables, footer action bar.
Behavior: opened by `Space`/`p`/row click on non-link cells; `?peek=<id>` in URL; `↑/↓` while
peek is open moves the peek through rows (rapid triage); `Esc` closes; deep links from other
pages open the list *with* the peek (the /payments?peek= contract).

### 5.6 CommandPalette
As specified in §2.3 (actions · records · pages, context pre-scoping, recents).

### 5.7 StatCard
Purpose: KPI that drills down.
Anatomy: 12px label · 20–28px tabular value (full precision) · secondary line (delta vs prior
period computed from the trends payload, e.g. `▲ 12% o'tgan oyga nisbatan`, or a composition
hint) · optional 32px sparkline · whole card is a link (`→` affordance on hover).
States: positive/negative delta coloring (semantic budget), loading skeleton, error dash,
`disabled` (agent-hidden company KPIs simply don't render).

### 5.8 MoneyCell / Money
Purpose: single money renderer (kills the copy-pasted formatters).
Anatomy: grouped tabular numerals; optional signed coloring; optional worded suffix
(Qarz/Avans); strike-through variant for voided; USD equation variant.
States: settled (renders «0» neutral per isSettled), pending («—» with «Narxlanmagan» tag).

### 5.9 BalanceChip
Purpose: the one way party balances appear in pickers, headers, rows.
Anatomy: `1 250 000 Qarz` red / `340 000 Avans` green / `Hisob toza` neutral; optional pallet
suffix `· 12 paddon`.
States: stale (refetching shimmer), compact (chips inside Select options).

### 5.10 HeadroomMeter
Purpose: credit-limit visibility before the server rejects (client limit + agent limit).
Anatomy: label («Kredit limiti»), 4px progress bar (used/limit), figures
`8 200 000 / 10 000 000 · bo'sh: 1 800 000`; agent variant reads from /agents/me.
States: unlimited («Cheklanmagan», no bar), prepay-only (0 → red «Faqat oldindan to'lov»),
near-limit ≥80% warning, exceeded-by-draft red with projected post-order figure.

### 5.11 StatusFlow
Purpose: compact order lifecycle control replacing the fat Steps.
Anatomy: 6 segments (NEW→…→COMPLETED) 8px tall with labels on hover; current segment filled;
right-attached action menu: primary next-step verb button + `▾` menu (privileged skip-forward,
one-step-back with mandatory note field, Bekor qilish).
States: blocked (vehicle missing → segment LOADING shows a red lock icon + inline «Moshina
biriktirilmagan — biriktirish» link-action), cancelled (flow replaced by red banner with
reason), agent-view (menu shows only the single legal +1 verb).

### 5.12 PartyLink
Purpose: consistent entity reference: name + type glyph, hover mini-card (balance chip, phone,
agent), click → workspace, `Shift+click` → peek. Used for client/factory/vehicle/agent
everywhere, including inside statements and kassa rows.

### 5.13 LedgerStatement
Purpose: the running-balance statement for any party (client/factory/vehicle) — one component,
three account types, print-ready.
Anatomy: header (party, period control, opening balance) · rows: date · source label
(translated LEDGER_SOURCE map — no raw enums anywhere) · document PartyLink/peek ·
note · signed amount · running balance · footer closing balance; reversal pairs get a `↩`
glyph linking each to its counterpart.
States: windowed (from/to), full-history, print variant (§9.4), agent-scoped.

### 5.14 AllocationEditor — the settlement workbench
Purpose: THE missing surface — allocate any existing allocatable payment
(POST /payments/:id/allocations) or compose inline allocations at creation.
Anatomy: header: payment summary + **«Ajratilmagan qoldiq: X so'm»** live counter · candidate
table: order rows (No · Sana · Summa/Tannarx · «Ochiq qoldiq» — lazily fetched via
`GET /orders/:id` for the visible rows, cached; spinner-per-cell while resolving) · per-row
amount input (auto-filled with min(remaining, outstanding)) · toolbar: «Eng eskisidan
taqsimlash» auto-allocate (oldest-first fill until remainder = 0) · footer: Σ allocations vs
payment amount with over-allocation hard-block.
For FACTORY_OUT it additionally shows each order's costStatus chip and the note
«Ushbu to'lov usuli: BANK → tannarx zavod o'tkazma narxida qotiriladi» (the priceKind
implication, worded, not implied). For VEHICLE_OUT, candidates come from the vehicle detail
payload (its last-50 orders with transport outstanding — no fake completeness; a caption
states the window).
States: readonly (CASHIER/AGENT see allocations but no editor), party-mismatch rows disabled
with reason, already-allocated rows shown checked with void-first hint.

### 5.15 PaymentComposer
Purpose: kind-first payment entry replacing the 720px morphing modal.
Anatomy: step 0 is a 6-tile kind chooser (Mijozdan to'lov · Mijozga qaytarish · Zavodga to'lov ·
Zavoddan qaytim · Shofyorga to'lov · Mijoz shofyorga to'ladi) — skipped whenever the composer
opens pre-scoped from context; then ONE stable form per kind: party (locked when pre-scoped,
BalanceChip visible) · date · method segmented control · amount (USD variant: usdAmount + rate
with remembered last rate, server-computed UZS preview) · cashbox select filtered by currency
with live box balance (hidden + info note for TRANSPORT_DIRECT: «bu to'lov kassadan o'tmaydi —
mijoz hisobi kamayadi, shofyor hisobi yopiladi») · payer/receiver **legal entity picker**
(searchable over /legal-entities, free-text fallback) · note · optional AllocationEditor
section (A/B only) · footer: Enter=Saqlash, Ctrl+Enter=Saqlash va kvitansiya chop etish.
States: idempotency key per open (safe double-Enter), method↔cashbox mismatch impossible by
construction, agent-locked variant (kind fixed CLIENT_IN, own clients only).

### 5.16 ReasonModal + ImpactPreview
Purpose: one destructive-confirmation pattern for void/cancel/storno/reverse.
Anatomy: title states the irreversible fact · ImpactPreview list (computed from the record:
«3 ta ledger yozuvi storno qilinadi», «2 ta allokatsiya bekor bo'ladi», «ORD-000123 tannarxi
PROVISIONAL holatiga qaytadi», «Bonus hisobiga 125 000 qaytariladi», «Pul mijoz hisobida
qoladi») · controlled Form with required reason TextArea (inline validation, no closure-variable
anti-pattern) · danger confirm.
States: cancel-order variant warns about bonus reversal when status=COMPLETED; rollback-import
variant embeds the typed-ROLLBACK input in the same single modal.

### 5.17 WorklistCard
Purpose: queue tiles on Dashboard/Navbatlar.
Anatomy: count (24px) · queue name · oldest-item age («eng eskisi: 12 kun») · `→` to the queue.
States: zero (muted «✓ bo'sh»), loading, error.

### 5.18 RangeChips
Purpose: one period control language everywhere (kassa, reports, charts, statements):
chip row `Bugun · 7 kun · Joriy oy · O'tgan oy · Yil · Oraliq…` + custom RangePicker; writes
`?from&to`; all math Tashkent-days.

### 5.19 InlineEdit
Purpose: dense catalog editing without modals where the API allows plain PUT (client phone/
region/note, vehicle driver/phone/capacity, product name/size, agent phone).
Anatomy: cell renders value; `e`/double-click swaps to the matching control; Enter saves
(optimistic + rollback on error), Esc cancels. Never used on money, prices (versioned!),
or anything status-bearing.

### 5.20 BulkBar
Purpose: bulk operations on selected rows.
Anatomy: floating bottom bar «N ta tanlandi» + verbs legal for the selection (orders: status
advance for A/B — sequential PATCH per row with per-row result toast summary; export CSV of
selection client-side; print batch invoices), Esc clears.
States: mixed-legality selection disables illegal verbs with counted reason («3/5 tasida
moshina yo'q»).

### 5.21 PrintDocument
Purpose: shared print frame for the four documents (§9): A4/A5 sheet, dealer letterhead block,
document title + number, meta grid, body table, totals, signature row, «SmartBlok» micro-footer
with print timestamp; rendered on dedicated `/print/*` routes with `@media print` CSS and a
screen preview toolbar (Chop etish · Yopish).

### 5.22 EmptyState, KeyHint, LiveDot, Sparkline
Small atoms: EmptyState (icon, one sentence, one action); KeyHint (`<kbd>` chip); LiveDot
(§2.1); Sparkline (32px @ant-design/plots tiny-line, axis-free, tooltip full values).

---
# 6. The five hero workflows, redesigned step-by-step

Conventions: `[key]` = keystroke; every step names the screen state the user actually sees.
API calls named are all existing.

## 6.a Create an order for a client who is on the phone with an agent

Persona: ACCOUNTANT at the desk; a field agent calls in a truck for «Jasur Versal». Target:
booked in under 60 seconds without touching the mouse. (Agent-on-phone self-service variant
in §8.3.)

1. **Anywhere** → `[c]` `[o]` (or `Ctrl+K`, type «yan», Enter). Route → `/orders/new`.
   The command form opens with **Mijoz** combobox focused. Layout: left column = form (640px),
   right = sticky **Xulosa** rail (320px, raised surface).
2. Type `ver` → server-searched dropdown; each option is a two-line row:
   `Jasur Versal · Urganch · Agent: Jamol` + BalanceChip `2 400 000 Qarz · 8 paddon`.
   `[↓]` `[Enter]` selects.
3. **The instant a client is chosen**, the Xulosa rail populates its top block — the
   **HeadroomMeter**: current balance, kredit limiti, bo'sh limit bar, overdue chip if any
   (`2 ta muddati o'tgan buyurtma`), pallet count; below it the *agent's* debt-limit headroom
   (from the client's agent). The accountant reads the credit answer aloud to the agent
   *before* entering a single item — no more submit-and-discover.
4. `[Tab]` → **Sana** (default: bugun; typing `09.07` accepted). `[Tab]` → **To'lov usuli
   (zavodga)** segmented BANK|CASH (`[←][→]`, default BANK) with the microcopy
   «taxminiy tannarx: zavod o'tkazma narxi».
5. `[Tab]` lands in item row 1 — items are a **grid, not stacked cards**: columns
   `Mahsulot · Paddon · m³ · Narx rejimi · Narx · Summa`. Product combobox searches the
   catalog; after the first pick the catalog **locks to that factory** (banner:
   `Zavod: CAOLS KS — o'zgartirish` escape link) — the single-factory rule is now proactive,
   not a post-hoc error.
6. Pick «Gazoblok D500 600×300×200» → `[Tab]` → Paddon: type `19` → m³ auto-fills `32.832`
   (editable; a `✎` marker appears if overridden and auto-fill stops for that row).
   Narx rejimi is a 4-key segmented control: `[K]`atalog / `[N]`kelishilgan / `[U]`mumiy summa /
   `[–]` Narxsiz (last visible to A/B only). Katalog shows the resolved price *for this client*
   (ClientPrice override when present, labeled «maxsus narx») — the estimate now matches the
   server's authority instead of lying to special-price clients. Row Summa renders live.
   `[Enter]` in the last cell adds row 2; `[Ctrl+Backspace]` deletes a row.
7. The Xulosa rail updates per keystroke: `Paddon: 19 / 19` capacity meter (red + submit-block
   when exceeded), `Hajm: 32.832 m³`, `Savdo: ≈ 24 020 000`, then the load-bearing line —
   **«Mijoz qarziga yoziladi: 24 020 000»** and projected post-order balance against the limit
   bar. If the projection exceeds the limit, the rail shows the red block panel with the exact
   figures the server would return — and the submit button converts to disabled with reason.
8. `[Tab]` → **Transport** block: Moshina combobox (option rows: `50A 123BC · Isuzu · 19 paddon ·
   Baxtiyor`) — picking fills Haydovchi *only if untouched*; mode segmented control
   `Mijozning o'zi / Diler hisobidan / Mijozdan olinadi` (default Diler hisobidan); conditional
   a single `Transport narxi` input (inside saleTotal — [authoritative transport model](../00-business-map.md#transport-authoritative)) with live
   `Transport foydasi: +200 000`. If transportCost > 0 and no vehicle: inline warning
   «Moshina tanlanmagan — shofyor qarzi hisobga olinmaydi» requiring an explicit checkbox to
   proceed (the untracked-driver-debt trap, surfaced).
9. `[Ctrl+Enter]` submits → single POST; on success: toast `ORD-000158 yaratildi`, navigate to
   `/orders/ORD-000158` with the StatusFlow on NEW, and a transient action strip:
   `Tasdiqlash [Enter] · Hisob-faktura chop etish [Ctrl+P]`. Server rejections (credit/capacity/
   floor) render as a form-top Alert with the server's verbatim figures AND scroll-to the
   offending field.

Full keyboard path: `c o → "ver"↓⏎ → Tab Tab → Tab → "d50"⏎ Tab 19 Tab → Ctrl+Enter` —
9 gestures plus typing.

## 6.b Collect a payment on a debt, from the Debts view

Persona: ACCOUNTANT working the morning collections list.

1. `[g]` `[q]` → `/debts`. Cockpit layout: six summary StatCards (each links to its filtered
   source), FilterBar (`Agent:`, `Hudud:`, `Holat: muddati o'tgan`, days window chips 7/14/30),
   DataGrid sorted by balance desc with columns Mijoz · Agent · Balans (BalanceChip) ·
   Paddon · Muddati (overdue/due-soon chips **with visible totals**, not tooltips) · Limit
   foydalanish (HeadroomMeter mini) · To'lov muddati.
2. `[↓]`…`[↓]` to «Gofur Xazorasp» (row cursor, 2px accent bar). `[Space]` peeks the client:
   PeekPanel shows balance header, last 5 statement rows, open orders with dueDates
   (expandable row alternative: `[→]` expands aging inline under the row).
3. `[t]` (To'lov) → **PaymentComposer** opens pre-scoped: kind=CLIENT_IN (tile step skipped),
   client locked with BalanceChip, **amount pre-filled with the full balance** (editable —
   partial payments common), method defaults to this user's last-used, cashbox auto-selected
   by method currency showing its live balance, date = today.
4. Agent takes 5 000 000 of the 7 240 000: type `5000000` (input groups digits live). `[Tab]`
   method `Naqd` `[Enter]`… wait — A/B also see the **AllocationEditor** section already
   populated with the client's open orders (oldest first, outstanding lazily resolved);
   `[Ctrl+A]` triggers «Eng eskisidan taqsimlash» — 5 000 000 fills order ORD-000102 fully
   (3 100 000) and ORD-000131 partially (1 900 000); remainder counter hits 0.
5. `[Ctrl+Enter]` = Saqlash va kvitansiya → POST /payments (idempotent) → success toast with
   the payment peek link; `/print/payment/:id/receipt` opens in a print view (§9.3). The debts
   row pulses (realtime), balance chip drops to `2 240 000 Qarz`, cursor stays on the same row.
6. `[↓]` next debtor. The whole loop is 6 keystrokes + amount per client. CASHIER gets the
   identical flow minus the AllocationEditor (their payments land in the «unallocated» reality
   which A/B see contextually on payment peeks — «Ajratilmagan: 5 000 000 · Ajratish» button).

## 6.c Settle with a factory (pay + allocate + finalize cost + spend bonus)

Persona: ACCOUNTANT doing the weekly CAOLS KS settlement. Today this spans 4 pages; here it is
ONE screen: `/factories/:id` — the settlement hub.

1. `Ctrl+K` → type «caols» → Enter → `/factories/caols-id`. Header: factory name + status,
   three hero figures with worded semantics: **Balans: 973 619 270 Avans** (green,
   «bizning avansimiz»), **Bonus hamyon: 4 812 000**, **Paddon hisobi: 214 dona**; action bar:
   `To'lov qilish [t] · Ajratish [a] · Paddon qaytarish · Bonus ▾ · Chop etish`.
   Body: left = tabs (Hisob-kitob statement default · Buyurtmalar · To'lovlar · Bonus dasturi ·
   Paddonlar) with server-paginated, date-filterable tables (kills the last-50 caps); right =
   sticky context rail: current bonus program card (PERCENT 1.5% · 01.06.2026 dan), unfinalized
   orders count chip («8 ta buyurtma tannarxi taxminiy»), recent activity.
2. `[t]` → PaymentComposer pre-scoped: kind=FACTORY_OUT, factory locked. Choose method
   `O'tkazma (BANK)` — the composer states the consequence in words:
   **«BANK usuli: allokatsiya qilinganda tannarx zavod o'tkazma narxida qotiriladi.»** Amount
   `250 000 000`, cashbox «Bank (Септем Алока)» (balance shown), receiver legal entity
   «CAOLS KS MCHJ» pre-picked. `[Enter]` saves.
3. The success state pivots straight into the **AllocationEditor** (no navigation): header
   «Ajratilmagan qoldiq: 250 000 000», candidate table = this factory's non-cancelled orders,
   oldest first, each with costStatus chip and «Qoplanmagan tannarx» resolving in place.
4. `[Ctrl+A]` auto-allocates oldest-first. Rows that will cross the finalization threshold get
   an inline forecast chip: `→ FINAL (o'tkazma narxi)`. Partial fills show `→ PARTIAL`.
   The accountant adjusts one row by hand (types a smaller amount — chip recomputes), then
   `[Enter]` commits → POST /payments/:id/allocations. Toast summarizes: «6 ta buyurtma:
   4 FINAL, 2 PARTIAL». The statement tab, balance header and the unfinalized-orders chip all
   update in place (query invalidation); COST_ADJUSTMENT rows appear in the statement with the
   `↩`-style source label «Tannarx tuzatish».
5. Spend the wallet without leaving: `Bonus ▾` → «Zavod qarziga o'tkazish» → modal pre-scoped
   to this factory: wallet balance refetched on open, amount input (max = live balance,
   min 1), live «Qoldiq keyin: X» line, info note about the canonical BONUS payment chain.
   `[Enter]` → POST /bonus/offset → wallet figure and statement update; the offset appears as
   a payment row (method «Bonus hisobidan») linked from both statement and To'lovlar tab.
6. Verify: statement tab shows today's block — FACTORY_OUT −250 000 000, COST_ADJUSTMENT
   deltas, BONUS_OFFSET — each row peek-able to its document. `Chop etish` offers the factory
   statement print for the period. Zero page-switches, zero re-finding the factory.

## 6.d Settle transport with a driver

Persona: ADMIN; driver Baxtiyor is waiting outside for his money.

1. `Ctrl+K` → «baxti» → the records provider matches the vehicle (`50A 123BC · Baxtiyor`) →
   Enter → **`/vehicles/:id`** — the page that never existed, now wired to GET /vehicles/:id.
   Header: plate + name + driver + phone (tap-to-call), hero figure
   **«Shofyorga qarzimiz: 4 200 000»** (red, worded), capacity meta. Body: left = orders table
   from the detail payload (last 50: No · Sana · Mijoz · Transport narxi · Holati chip ·
   «Ochiq» amount), unpaid rows pre-sorted first; right = ledger statement with running
   balance.
2. `[x]` `[x]` `[x]` selects the three UNPAID trucks (Σ shown in BulkBar: «3 ta · 4 200 000»).
3. `[t]` («Shofyorga to'lash») → PaymentComposer pre-scoped: kind=VEHICLE_OUT, vehicle locked,
   **amount pre-filled 4 200 000**, cashbox select (Naqd kassa, balance visible — insufficient
   balance renders the shortfall inline before submit), AllocationEditor pre-checked with the
   three selected orders at their outstanding amounts, remainder already 0.
4. `[Ctrl+Enter]` → payment + allocations in one flow → the three rows flip to green
   `To'langan`, the hero figure drops to `Hisob toza`, BulkBar clears. Offer:
   «Kvitansiya chop etish» (driver gets paper, §9.3).
5. Variant — client paid the driver directly («шопр учун барди»): from OrderDetail's Transport
   card, action «Mijoz shofyorga to'ladi» → composer kind=TRANSPORT_DIRECT with client AND
   vehicle locked from the order, no cashbox field, the double-effect note rendered as two
   lines with icons: `− mijoz qarzi kamayadi · ✓ shofyor hisobi yopiladi`; allocation to this
   order pre-filled → status flips `Mijoz to'lagan` (teal).

## 6.e Owner's morning check: dashboard → anomaly → act

Persona: ADMIN (the owner), 8:30, tea in hand.

1. Login lands on `/`. The dashboard is **three labeled bands**, not a 12-card wall:
   - **Bugun**: Bugungi savdo · Yig'ilgan (bugun) · **Yo'ldagi buyurtmalar** (the formerly
     invisible ordersInFlight — links to /navbatlar?tab=yolda) · Kassa qoldig'i (link /kassa).
   - **Joriy oy** (RangeChips-driven, `?days=` wired): Oy savdosi + delta + sparkline ·
     Mahsulot foydasi (labeled «taxminiy tannarxlar bilan» while unfinalized orders exist) ·
     Transport foydasi (separate, always) · Sotilgan hajm (m³) · Yig'ilgan to'lov.
   - **Qarzlar** (the three-sided debt row, one glance = the whole workbook Свод headline):
     Mijozlar qarzi · Zavodlar bilan hisob (worded Avans/Qarz) · **Shofyorlarga qarzimiz**
     (formerly invisible) · Bonus hamyonlar · Mijozlardagi paddonlar. Every card is a link.
   - Below: 30/90/365-day chart (savdo vs yig'ilgan, order-count as faint bar layer;
     **clicking a point opens that day's orders**), WorklistCard strip (Navbatlar counts),
     compact current-month agent ranking linking to /reports?tab=agentlar.
   The duplicate «Kutilayotgan tushum» card is gone (it equaled Mijozlar qarzi byte-for-byte);
   expected collections lives on /debts where its window control means something.
2. Anomaly: «Shofyorlarga qarzimiz 6 400 000» shows `▲ +4 200 000` vs yesterday (delta from
   trends/kassa payloads). Click → `/vehicles?sort=balance` — sorted worst-first.
3. Top row `50A 123BC — 4 200 000 Qarzimiz`. `[Space]` peek: statement shows three TRANSPORT_COST
   postings from yesterday's trucks, no payments. This is not an error — just unpaid work.
   `[Enter]` opens the vehicle page; flow 6.d settles it in four keystrokes, OR the owner
   leaves it and the number remains an honest liability on tomorrow's band.
4. Second anomaly path: chart shows collected ≪ sales for 3 days → click the last point →
   `/orders?from=…&to=…` → FilterBar already scoped; add token `Holat: Yakunlandi`; summary row
   shows Σ sale for the day; `[v]` switch to saved view «Qarzdorlar bo'yicha» … the drill is
   always a *filtered list*, never a dead tooltip.
5. Total time: under two minutes, and every number the owner saw was either acted on or
   consciously deferred — with the queue badges remembering for him.

---
# 7. Screen-by-screen approach

### 7.1 Boshqaruv paneli (Dashboard — ADMIN/ACCOUNTANT)
Three labeled KPI bands (Bugun / Joriy oy / Qarzlar) as specified in §6.e — full-precision
values, deltas, sparklines, every card a drill-down link. Chart card gains a RangeChips control
wired to `?days=` and an order-count bar layer; agents ranking becomes a compact
current-month table whose header links to the full Reports tab with month picker. WorklistCard
strip surfaces the Navbatlar counts. The LIVE tag is replaced by the honest LiveDot; the
duplicate expectedCollections card is removed. AGENT and CASHIER variants in §7.2/§7.8.

### 7.2 Agent dashboard (AGENT `/`)
Scoped KPI band (own sales/collections/debt/pallets/m³), own 30-day trend, and — new — the
**HeadroomMeter card from GET /agents/me**: limit, outstanding, bo'sh limit, with the warning
state the agent today only discovers as a rejected order. Below: own queue chips (muddati
o'tgan mijozlarim, yo'ldagi buyurtmalarim). Mobile-first layout per §8.

### 7.3 Buyurtmalar (Orders)
The canonical DataGrid page: FilterBar tokens (holat, mijoz, zavod, sana, matn) + saved views
(«Yo'lda», «Bugungi trucklar», «Narxlanmagan*»), status Tabs die in favor of tokens. Columns
add Muddat (dueDate w/ overdue chip) and blocker glyphs (moshinasiz, narxlanmagan) on the No
cell; sticky summary row (page Σ sale, labeled). Row cursor + peek panel (order mini-workbench:
status flow, items, money, quick actions); BulkBar for A/B (status advance, CSV, batch invoice
print). «Jami: N ta» stays.

### 7.4 Yangi buyurtma (NewOrder)
Rebuilt as the §6.a command form: items as a keyboard grid, factory lock after first product,
client-resolved prices (maxsus narx labeled), HeadroomMeter + agent-limit rail, capacity meter
with hard block, vehicle-less-cost confirmation, Ctrl+Enter submit. Same route; AGENT variant
hides Narxsiz mode and enforces the floor message inline («zavod narxidan past — taqiqlangan»).

### 7.5 Buyurtma sahifasi (OrderDetail)
Two-column workbench. Left (fluid): items table (with per-row Narxlash for pending, A/B),
payments/allocation tab with progress vs **`clientChargeable(order)`** exposure, pallet movements,
unified activity feed (statuses + payments + comments, one composer — the duplicate Izohlar tab
dies). Right (320px sticky rail): StatusFlow with action menu (single legal verb for agents;
skip/one-step-back with note for A/B; cancel with ImpactPreview), Moliya block (sale, cost +
costStatus chip, goods profit labeled provisional-until-FINAL), Transport block with inline
actions «Shofyorga to'lash» / «Mijoz shofyorga to'ladi» (§6.d), vehicle assign action when
missing, print menu (Hisob-faktura, Yo'l varaqasi). Header: PageHeader with breadcrumb, Edit
button (visible only while NEW/CONFIRMED + PROVISIONAL, else a lock chip explaining why —
«Tannarx allokatsiya bilan qotirilgan»).

### 7.6 Buyurtmani tahrirlash (OrderEdit — NEW)
The NewOrder form pre-filled via GET /orders/:id, submitting PUT /orders/:id (full item
replace). Banner explains the reverse+repost mechanics and that intendedPaymentMethod is
immutable; credit re-check errors render like NewOrder's. Entry points: OrderDetail Edit, the
Moshinasiz queue.

### 7.7 To'lovlar (Payments)
DataGrid + FilterBar (kind, method, party, sana, **reconciled tri-state**, voided tri-state) +
saved views («Tekshirilsin», «Bugungi kirimlar»). Filtered Σ per direction in the summary row.
Peek panel is the payment document: descriptions with translated enums, USD equation,
allocations mini-table with **«Ajratish» opening the AllocationEditor** (the missing POST
/payments/:id/allocations UI), ledger postings with translated source labels, void action with
ImpactPreview, receipt print. `?peek=<id>` makes every payment addressable — OrderDetail's
allocation links finally round-trip.

### 7.8 Kassa
One RangeChips period control governs the whole page. Cashbox cards form a selectable rail
(click = filter everything to that box; Σ per currency shown — UZS boxes summed, USD separate,
never merged); below, the period summary strip (ochilish / kirim / chiqim / yopilish for the
selection) and the transaction DataGrid whose «Hujjat» column renders PartyLink/peek to the
source payment or expense (clickable at last). Manual IN/OUT and storno keep their modals with
ReasonModal; storno only on MANUAL rows as today. CASHIER's `/` terminal dashboard: big box
cards + today's operations feed + two giant actions (To'lov qabul qilish, Xarajat) sized for a
till.

### 7.9 Qarzlar (Debts)
The collections cockpit of §6.b: six linked StatCards (A/B), FilterBar (agent, hudud, holat,
window chips), DataGrid with worded BalanceChips, visible overdue totals, mini HeadroomMeter,
expandable row (client's open orders with dueDates via lazy order fetch), row verbs `t` to'lov ·
`Space` statement peek · print akt sverki. Expected collections figure sits beside the window
control that defines it, with a one-line explanation of the formula.

### 7.10 Paddonlar (Pallets)
Master-detail: left = balances (Mijozlar tab / Zavodlar tab) with search and worded counts;
right = movement history for the selected party (date-range + type filters added, totals footer
for the filtered set: Σ dona always, plus line totals qty × narx for Undirish rows — the one
money-bearing kind). Global actions collapse into
one «Amal ▾» menu + row-scoped verbs; the three modals gain the party's current balance and the
post-action balance inline, warn (not block) on negative; Undirish alone carries a unit price,
prefilled from the palletPriceDefault setting (single source of truth, deviation hint when
edited) — Zavodga qaytarish has no price field by rule. Movement rows
link order and ledger consequences.

### 7.11 Mijozlar (Clients)
FilterBar (hudud, agent, holat faol/nofaol, balans holati qarz/avans/toza) wired to server
params where they exist and labeled page-scope otherwise; columns add limit-utilization mini
meter; InlineEdit on phone/region; row peek = client mini-card. Create stays a modal; edit
unifies on the same drawer-free peek→workspace pattern. ADMIN reactivate action appears
symmetric to deactivate (uses the existing update path; if the API truly lacks `active` on
update, the action is hidden and the gap is listed for the backend backlog — no fake UI).

### 7.12 Mijoz sahifasi (ClientDetail)
Party workspace. Header: name + Nofaol tag, meta (agent, hudud, telefon InlineEdit, limit +
HeadroomMeter, to'lov muddati), hero BalanceChip + paddon chip; **action bar: Yangi buyurtma ·
To'lov qabul qilish · Paddon qaytarish · Akt sverki chop etish** — all pre-scoped (the missing
cross-links). Tabs: Hisob-kitob (LedgerStatement, windowed, print), Buyurtmalar and To'lovlar
(server-paginated, «hammasini ko'rish →» links to the pre-filtered global lists — the 20-row
cap dies), Maxsus narxlar (grouped by product, current price highlighted, future-dated badged,
new-version inline form), Taxalluslar. Unreconciled imported payments show the special-purple
«Tekshirilsin» chip inline in the statement.

### 7.13 Zavodlar (Factories)
Server-paginated + server-searched table (fixes the silent 50-row truncation) with columns
Balans (worded), Bonus hamyon, **Bonus dasturi** (kind + rate chip — the missing cross-factory
program overview), Paddon (single balance formula — the pallet module's), Holat. Row → hub.

### 7.14 Zavod sahifasi (FactoryDetail)
The settlement hub of §6.c: hero figures, action bar (To'lov qilish · Ajratish · Paddon
qaytarish · Bonus ▾ · Chop etish), statement-first tabs all server-paginated and date-windowed,
sticky context rail (current program, unfinalized count, activity). Bonus tab shows program
version history and transactions **with base/rate as real columns** («25 m³ × 5 000 = 125 000»)
and links to program versions.

### 7.15 Bonus hamyonlar
Wallet cards become actionable: each card = factory link + balance + program chip + inline
`Yechish · Qarzga o'tkazish` actions pre-scoped; selecting a card filters the journal below.
Journal columns add Asos (base × rate rendered, not tooltip-buried); WITHDRAWAL rows keep
Qaytarish (ReasonModal); DEBT_OFFSET rows get «To'lovni ochish →» deep link to the payment peek
where voiding lives — the reversal path becomes discoverable.

### 7.16 Mahsulotlar (Products) + bulk price grid
Catalog table adds effective-date under each current price and an «kelgusi narx» badge for
future-dated rows. The Narxlar drawer reorganizes into per-kind tabs with the current row
pinned and future rows badged. NEW: **«Narxlarni yangilash»** mode per factory — an editable
grid (rows = products, cols = 3 kinds) pre-filled with current prices, one shared effectiveFrom,
`+X%` quick fill, one Save issuing the N versioned POSTs with a per-cell result report. Debounced
live search (300ms) replaces Enter-only search.

### 7.17 Ta'minot (Procurement)
Tab 1 Matritsa: grouped **by product**, cheapest factory marked within each group (fixes the
apples-to-oranges trophy), global sort toggle, dropped-products card keeps honest reasons and
gains deep links («narx kiritish →» to the price grid, «marshrut qo'shish →» to tab 2). Tab 2
Marshrutlar (NEW): versioned route list per factory×region (GET /procurement/routes) with a
new-version form (POST) — capacity defaults from settings; append-only semantics stated in the
UI like the price book.

### 7.18 Moshinalar (Vehicles) + VehicleDetail
List wires server search/pagination; Balans column worded («Qarzimiz»); row → `/vehicles/:id`
(§6.d): hero liability figure, unpaid-first orders table from the detail payload, statement
rail, «Shofyorga to'lash» pre-filled flow, driver phone tap-to-call. One glossary term
everywhere: **Shofyor** (Haydovchi retired).

### 7.19 Agentlar / Agent sahifasi
List adds Ochiq qarz vs limit meter. Detail gains an edit button, a month RangeChips selector
feeding the KPI cards (from agents-ranking `?month=` for the monthly figures, all-time kept as a
second row), and the client table with worded balances. `/me` (AGENT) reuses the same layout
scoped by GET /agents/me.

### 7.20 Hisobotlar (Reports)
Four tabs, shared RangeChips + export. **Svod**: agent blocks rendered expanded as one grouped
table with sticky agent subtotal rows; every client/factory name is a PartyLink; the two
identity checks live in a pinned header strip (`Mos (0)` green / `Farq: X` red — defect signal
styling). **Reestr**: column presets (Pul / Logistika / Hammasi), two fixed columns, sticky
server-fed totals row for the whole filter; transport & cost status chips filterable
client-side within the fetched pages (labeled). **Agentlar**: the ranking with month picker
(`?month=`), MoM delta column, «Qarzdorlik (hozirgi qoldiq)» honestly labeled. **Davr**: a
client-composed period digest — savdo, mahsulot foydasi, transport foydasi (register totals),
xarajatlar by category (bounded scan of /expenses pages for the window, computation basis
stated on-screen) — explicitly NOT a formal P&L, it is labeled «taxminiy davr xulosasi» until a
backend summary exists.

### 7.21 Xarajatlar (Expenses)
Adds a filtered-totals strip (davr jami + per-category chips, computed over the filtered
result set server pages), voided tri-state filter (yashirish / ko'rsatish / faqat), xlsx-less
CSV export of the filter client-side, and a **Kategoriyalar** manager popover (list with usage
counts from `_count.expenses`, inline rename via PUT, delete-when-unused via DELETE — endpoints
existed, UI didn't). Void uses ReasonModal.

### 7.22 Excel import (ADMIN only)
Rebuilt as a three-step vertical flow with a sticky stepper: **1 Yuklash** (dragger + file
facts) → **2 Tekshiruv** (dry-run results: checks as a table `nomi · kutilgan · haqiqiy · Δ`
with red deltas; per-kind payment count chips; structured unmatched tables (qator, mijoz, sana,
raqam, summa); the unreconciled-total warning rendered from the correct payload path; kassa
balances; results persisted to localStorage with a «dry run» history so a refresh doesn't cost
a 2-minute rerun) → **3 Import va solishtirish** (real-import confirm shows the dry-run numbers
inline; progress overlay with stage labels; reconciliation auto-opens: headline chip row
`mos / farqli / izohlangan / izohsiz / flagged Σ`, per-client rows expandable to **sheetGaps
detail**, and the load-bearing badge pair — amber «Daftar nuqsoni bilan izohlangan» vs red
«Izohsiz — import xatosi» — finally rendered). Rollback = one ReasonModal with typed ROLLBACK +
the exact deletion counts. Flagged payments table gains payer/method/id columns for owner
review (read-only; no mark-reconciled endpoint exists).

### 7.23 Boshqaruv (Users, Settings, Profile)
**Foydalanuvchilar**: search + role/status filter chips, email column, blocked users sorted
last, symmetric «Faollashtirish» on blocked rows, one shared ROLES map for labels/colors.
**Tizim sozlamalari**: same four fields; per-field save state (each key PUTs independently with
inline ✓/✗ so partial failures are visible); saleMarginMinPct gets a «hozircha qo'llanmaydi»
info chip until the backend consumes it; ACCOUNTANT sees the page read-only. **Profil**: one
editable card (view-with-edit-toggle), email field added, password card with the session-reset
notice.

### 7.24 Kirish (Login)
Centered 380px card on the canvas surface, wordmark, two large fields, full-width Kirish,
theme-aware. Error and blocked states verbatim from the server. The 403 screen gains
«Bosh sahifaga qaytish».

### 7.25 Hududlar / Yuridik shaxslar
Light catalog pattern: single table + modal, InlineEdit for notes; region client-count links to
the filtered clients list; delete disabled with explanation when referenced. Legal entities:
active-only default filter, one activate/deactivate toggle; their real payoff is the picker in
PaymentComposer (§5.15).

---

# 8. AGENT mobile experience

The agent's phone is a first-class client of the same SPA — responsive CSS, no separate app.
Breakpoint: below 768px the shell transforms.

## 8.1 Mobile shell
Sidebar and header collapse into: a top bar (40px: wordmark, LiveDot, avatar) and a **bottom
tab bar** (56px, safe-area aware): `Panelim · Buyurtmalar · [ + ] · Mijozlar · Qarzlar`. The
center `+` is a raised action button opening a two-option sheet: **Yangi buyurtma / To'lov
qabul qilish** — the agent's two jobs, one thumb. To'lovlar and Ko'rsatkichlarim live behind
the avatar sheet. Command palette exists (search icon in top bar) but keyboard chords do not.

## 8.2 Lists become card stacks
Every DataGrid renders its mobile ListCard variant: one card per row, two-line layout —
line 1: primary identity + status chip; line 2: the money fact (BalanceChip full-size) + meta.
Filters compress to a horizontal chip scroller + a filter sheet; the URL-sync contract is
unchanged. Peek panels become full-height bottom sheets (drag-to-dismiss). Tables never
horizontal-scroll on phones.

## 8.3 New order on a phone
The §6.a form re-stacks into a 4-step sheet flow (Mijoz → Mahsulotlar → Transport → Xulosa)
with a persistent bottom summary bar (Σ paddon/m³/savdo + «qarzga yoziladi») that expands to
the full Xulosa. HeadroomMeter shows immediately after client pick — the agent knows *before
loading the truck* whether the order will be blocked (client limit AND own agent limit from
/agents/me). Item entry uses big steppers for paddon; price mode limited to Katalog/Kelishilgan
(floor enforced with the exact minimum shown). Submit button is sticky, 48px.

## 8.4 Collections in the field
Qarzlar (scoped) sorts the agent's debtors by balance; each card: client, worded balance,
overdue chip, paddon count, `📞` call link and «To'lov» button → mobile PaymentComposer
(kind locked CLIENT_IN, client locked, amount keypad-first with the balance as a one-tap
preset, method chips, cashbox auto). Success screen offers «Kvitansiya» (share/print via the
print route — mobile browsers hand it to the OS share sheet).

## 8.5 Ko'rsatkichlarim (/me)
The agent's own standing: HeadroomMeter hero (limit / ochiq qarz / bo'sh), monthly KPI cards
(own sales, collected, orders), own client list with balances. Directly answers «can I book
another credit order today?» — the question the API could always answer and the UI never did.

---

# 9. Print documents (frontend-only, from existing API data)

All four render on `/print/*` routes via PrintDocument (§5.21): A4 portrait (receipt A5
landscape-half), 12mm margins, pure black-on-white (print CSS ignores theme), 12px body /
16px titles, tabular numerals, «— nusxa: mijoz / diler —» duplicate markers where two copies
are customary. Each shows a footer «SmartBlok · chop etildi: DD.MM.YYYY HH:mm · [user]».

### 9.1 Yo'l varaqasi (driver waybill — printed at LOADING)
Source: GET /orders/:id. Header: dealer name/phone (from settings-agnostic static config) +
«YO'L VARAQASI № ORD-000158» + sana. Meta grid: Zavod (yuklash manzili) · Mijoz + telefon +
hudud (yetkazish) · Moshina (raqam, nomi) · Shofyor + telefon. Body table: Mahsulot · O'lchami ·
Paddon · m³ — with Σ row (paddon jami vs sig'im). Pallet notice line: «Mijozga topshirilgan
paddonlar: N dona (qaytariladi)». NO prices anywhere (driver document). Signature row: Yukladi /
Shofyor / Qabul qildi, each with date line.

### 9.2 Hisob-faktura (client invoice)
Source: GET /orders/:id (+ client balance). Header: «HISOB-FAKTURA № ORD-000158», sana,
to'lov muddati (dueDate). Parties block: Sotuvchi (dealer legal entity) / Xaridor (client,
telefon, hudud). Items: Mahsulot · m³ · narx (so'm/m³, 6dp trimmed) · Summa; lump-sum rows
print the agreed total with «kelishilgan summa» note. Totals stack: Mahsulotlar jami ·
«shundan shofyorga» (faqat CLIENT_PAYS_DRIVER, ayirma qatori) · **Jami qarzga yoziladi** · Mijoz balansi
(hujjatdan keyin, worded). Pallet in-kind note: «N paddon — qaytariladigan idish, pulga
kirmaydi». Signatures: Topshirdi / Qabul qildi.

### 9.3 Kvitansiya (cashier receipt)
Source: GET /payments/:id. Half-A5, two copies per sheet (mijoz/kassa). «KVITANSIYA № <short
id>» · sana-vaqt · Mijoz/Zavod/Shofyor (party) · Summa raqam bilan + **so'z bilan** (frontend
number-to-words in Uzbek, e.g. «besh million so'm») · usul + kassa nomi · USD equation when
applicable · qabul qildi (user) + imzo. TRANSPORT_DIRECT receipts state «kassadan o'tmagan —
mijoz shofyorga to'lagan».

### 9.4 Solishtirish dalolatnomasi / akt sverki (client statement)
Source: GET /debts/statement?clientId&from&to (opening/closing + rows). Header: both parties,
davr. Body: LedgerStatement print variant — Sana · Hujjat (ORD-/to'lov) · Izoh · Debet ·
Kredit · Qoldiq (running); reversal pairs marked ↩. Footer: Ochilish qoldig'i · Davr aylanmasi
(debet/kredit Σ) · **Yopilish qoldig'i (worded: Mijoz qarzi / Mijoz avansi)** · paddon balansi
as an in-kind line · two signature blocks (Diler / Mijoz) with «kelishmovchiliklar 10 kun
ichida bildiriladi» boilerplate. Also printable for factories and vehicles from their
statements (same component, party-typed labels).

---

# 10. What we deliberately do NOT do

1. **No UI that needs new endpoints.** No mark-reconciled button, no cashbox CRUD, no manual
   ledger ADJUSTMENT entry, no file attachments, no opening-balance editor, no server-side
   saved views, no batch settings PUT. Where a gap bites (mark-reconciled), the UI reviews but
   does not pretend to complete.
2. **No invented metrics or money math in the browser.** Client-side sums are labeled with
   their scope («sahifa jami», «taxminiy davr xulosasi»); authoritative numbers always come
   from the ledger endpoints. No count-up animations, no rounded «friendly» figures on desktop.
3. **No agent commissions, no inventory/warehouse, no CRM funnel.** The domain has none;
   the redesign adds no phantom modules.
4. **No kanban/board view for orders.** One order = one truck in a strict linear lifecycle;
   a board implies drag-driven status change, which would fight the role-gated transition rules.
5. **No dashboard sprawl.** Three bands + chart + queues + ranking. New KPIs must displace an
   existing card, not join it. CASHIER keeps a terminal, not an executive dashboard.
6. **No multi-language toggle in v1.** One script, one voice: Uzbek Latin, one glossary
   (Shofyor, Paddon, Hisob-kitob), uz-Latn AntD locale. Workbook sheet names (Товар, Оплата)
   remain verbatim as quoted artifacts in Import only. i18n extraction is deferred until RU
   becomes a real requirement.
7. **No mobile app, no offline mode.** Responsive web for agents; offline queuing of financial
   writes is a correctness minefield against row-locked credit gates.
8. **No drag-and-drop anywhere money moves.** Allocation is typed and confirmed; drag is for
   nothing in this product.
9. **No soft-hiding of voided history.** Tri-state filters default to hiding noise, but voided
   rows are one toggle away and always render with their reversal pairs — never deleted from
   view models.
10. **No decorative realtime.** The socket layer invalidates queries; the UI shows one honest
    LiveDot and row pulses. No toast storms («X updated an order») — this is a 5-person
    company, not Slack.
11. **No per-user server preferences.** Density, saved views, last-used method/rate live in
    localStorage; losing them costs seconds, and it keeps the API untouched.
12. **No redesign of the financial rules' language.** Worded semantics (Qarz/Avans, taxminiy/
    qotirilgan tannarx) restate the locked rules — they never soften them. Debt at creation,
    cost-at-allocation, in-kind pallets, separate transport profit: the UI teaches these rules;
    it never negotiates with them.


---

# Appendix A — AntD v6 ThemeConfig mapping (implementation-ready)

The §4 tokens expressed as the two ConfigProvider themes. This replaces `theme.ts` wholesale;
`design.css` carries only what tokens cannot (focus ring, kbd chips, row cursor bar, print).

```ts
// theme.ts — «Buyruq va Zichlik»
import { theme as antdTheme, type ThemeConfig } from 'antd';

const font =
  `'Segoe UI Variable Text','Segoe UI',system-ui,-apple-system,'Inter',sans-serif`;

export const lightTheme: ThemeConfig = {
  algorithm: antdTheme.defaultAlgorithm,
  token: {
    colorPrimary: '#2E6584',
    colorInfo: '#2E6584',
    colorSuccess: '#157F3D',
    colorError: '#C0362C',
    colorWarning: '#9A6700',
    colorBgLayout: '#F3F4F6',
    colorBgContainer: '#FFFFFF',
    colorBorderSecondary: '#E5E7EC',
    colorText: '#1B2430',
    colorTextSecondary: '#5A6472',
    colorTextTertiary: '#8B94A3',
    borderRadius: 6,
    borderRadiusLG: 8,
    fontFamily: font,
    fontSize: 14,
    controlHeight: 32,
    lineHeight: 22 / 14,
  },
  components: {
    Layout: { siderBg: '#F7F8FA', headerBg: '#FFFFFF', headerHeight: 44 },
    Menu: {
      itemBg: 'transparent', itemHeight: 32, itemBorderRadius: 6,
      itemSelectedBg: '#E9F1F6', itemSelectedColor: '#2E6584',
      groupTitleFontSize: 11,
    },
    Table: {
      headerBg: '#FFFFFF', headerColor: '#5A6472',
      cellPaddingBlock: 8, cellPaddingInline: 12,
      cellFontSize: 13, rowHoverBg: '#F7F8FA',
      headerSplitColor: 'transparent',
    },
    Card: { paddingLG: 16 },
    Modal: { borderRadiusLG: 10 },
    Tag: { borderRadiusSM: 4, defaultBg: '#F3F4F6' },
    Segmented: { itemSelectedBg: '#FFFFFF' },
    Statistic: { contentFontSize: 24 },
  },
};

export const darkTheme: ThemeConfig = {
  algorithm: antdTheme.darkAlgorithm,
  token: {
    colorPrimary: '#6FA3C1',
    colorInfo: '#6FA3C1',
    colorSuccess: '#4BC17B',
    colorError: '#F0655D',
    colorWarning: '#DDA043',
    colorBgLayout: '#0E1116',
    colorBgContainer: '#161A20',
    colorBorderSecondary: '#262C36',
    colorText: '#E7EBF1',
    colorTextSecondary: '#9AA4B2',
    colorTextTertiary: '#6B7484',
    borderRadius: 6, borderRadiusLG: 8, fontFamily: font, fontSize: 14,
    controlHeight: 32,
  },
  components: {
    Layout: { siderBg: '#14181E', headerBg: '#161A20', headerHeight: 44 },
    Menu: {
      itemBg: 'transparent', itemHeight: 32, itemBorderRadius: 6,
      itemSelectedBg: '#182A36', itemSelectedColor: '#6FA3C1',
    },
    Table: {
      headerBg: '#161A20', headerColor: '#9AA4B2',
      cellPaddingBlock: 8, cellPaddingInline: 12, cellFontSize: 13,
      rowHoverBg: '#1A1F27', headerSplitColor: 'transparent',
    },
    Modal: { borderRadiusLG: 10 },
  },
};
```

`design.css` responsibilities (each ≤ a dozen lines): `:focus-visible` ring
(2px `colorPrimary @ 35/45%`, offset 1px); `.row-cursor td:first-child` 2px inset accent bar;
`.kbd` chip (11px, tertiary text, 1px border, 4px radius, 2px 5px padding); `.pulse-row`
one-shot 1200ms background keyframe; `.num { font-variant-numeric: tabular-nums }` applied
globally to `td, .stat, .money`; `@media print` sheet for §9; `prefers-reduced-motion`
overrides; density variant `body[data-density='keng'] td { padding-block: 12px }`.

---

# Appendix B — Canonical screen wireframes

ASCII schematics of the load-bearing layouts. Proportions annotated; all measurements from §4.

## B.1 Canonical list page (Orders shown) with peek open

```
┌ Sidebar ─┬───────────────────────────────────────────────────────────────────────┐
│ 240px    │ Header 44px  Buyurtmalar / —        [⌕ Qidiruv… Ctrl+K]   ●Jonli ☾ AJ │
│          ├───────────────────────────────────────────────────────────────────────┤
│ Boshqaruv│ Buyurtmalar                                  [Saqlangan: Yo'lda ▾] [+ Yangi buyurtma]
│ Navbatlar│ ┌─────────────────────────────────────────────────────────────────────┐
│ ──SAVDO──│ │ ⌕ matn…  Holat: Yuklanmoqda ×  Sana: joriy oy ×  [+ Filtr]  214 ta · Σ 1 249 547 319 │
│ Buyurtma…│ ├──────────────────────────────────────────────┬──────────────────────┤
│ Mijozlar │ │ №        Sana    Mijoz        Zavod   Summa  │ PEEK  ORD-000158  ↗ ⎙ ✕
│ Qarzlar  │ │ ORD-158⚑ 09.07   Jasur Versal CAOLS  24 020 000│ ──────────────────── │
│ ──MOLIYA─│ │▌ORD-157  09.07   Gofur Xaz.   CAOLS  18 400 000│ NEW ▸CONF ▸LOAD…     │
│ To'lovlar│ │ ORD-156  08.07   Shiddat      CAOLS   —  ⚑narxsiz│ [Tasdiqlash ⏎] [▾]  │
│ Kassa    │ │ …36px rows, 13px tabular…                    │ Mijoz: Jasur Versal  │
│ …        │ ├──────────────────────────────────────────────┤ 2 400 000 Qarz       │
│          │ │ Σ (filtr): 214 ta · 1 249 547 319 so'm       │ Mahsulotlar (2) …    │
│          │ │ ‹ 1 2 3 … ›   Jami: 214 ta                   │ Moliya · Transport   │
│          │ └──────────────────────────────────────────────┴──────────────────────┘
└──────────┴───────────────────────────────────────────────────────────────────────┘
  ▌ = keyboard cursor row (2px accent bar)   ⚑ = blocker glyph (moshinasiz / narxsiz)
```

## B.2 Dashboard (ADMIN/ACCOUNTANT)

```
Boshqaruv paneli                                        [7 kun|30|90|365]  ●Jonli
BUGUN ────────────────────────────────────────────────────────────────────────────
[Bugungi savdo     ] [Yig'ilgan (bugun) ] [Yo'ldagi buyurtmalar] [Kassa qoldig'i ]
[ 48 400 000     → ] [ 22 150 000     → ] [ 5 ta             → ] [ 61 208 000  → ]
JORIY OY ─────────────────────────────────────────────────────────────────────────
[Oy savdosi ▲12% ∿] [Mahsulot foydasi*] [Transport foydasi] [Hajm m³] [Yig'ilgan]
QARZLAR ──────────────────────────────────────────────────────────────────────────
[Mijozlar qarzi →] [Zavod: Avans →] [Shofyorlarga qarz →] [Bonus →] [Paddonlar →]
┌ So'nggi 30 kun: savdo va yig'ilgan (nuqta bosilsa → o'sha kun) ────────────────┐
│  ∿∿∿ line ×2 + faint order-count bars, 300px                                   │
└─────────────────────────────────────────────────────────────────────────────────┘
[Navbatlar: Tekshirilsin 12 · Muddati o'tgan 4 · Moshinasiz 1 · Narxlanmagan 2  →]
┌ Agentlar reytingi (2026-07) → to'liq hisobot ──────────────────────────────────┐
  * «taxminiy tannarxlar bilan» chip while unfinalized orders exist
```

## B.3 OrderDetail workbench

```
Buyurtmalar / ORD-000158        [Tahrirlash] [Chop etish ▾] [⋯]
┌ Left (fluid) ───────────────────────────────┬ Right rail 320px (sticky) ────────┐
│ Mahsulotlar                                 │ ▮▮▮▯▯▯  LOADING                   │
│  Mahsulot        m³      narx      Summa    │ [Yetkazishga jo'natish ⏎] [▾ menu]│
│  D500 600×300    32.832  732 542.4 24 020 000│  ▾: skip / bir qadam orqaga+izoh │
│  [Narxlash] on pending rows                 │     / Bekor qilish (Impact)       │
│ To'lovlar ▸ progress: 5 000 000 / 24 020 000│ MOLIYA                            │
│   (sale + transport exposure)               │  Savdo   24 020 000               │
│   allokatsiyalar → payment peek links       │  Tannarx 21 300 000 [Taxminiy]    │
│ Paddonlar ▸ movements                       │  Foyda*  +2 720 000               │
│ Faoliyat (tarix + izohlar, bitta kompozer)  │ TRANSPORT                         │
│                                             │  Diler hisobidan · 2 000 000      │
│                                             │  [Shofyorga to'lash] [Mijoz to'ladi]│
│                                             │  Moshina: 50A123BC (yo'q bo'lsa:  │
│                                             │  «Biriktirish» qizil action)      │
└─────────────────────────────────────────────┴───────────────────────────────────┘
```

## B.4 NewOrder command form

```
Yangi buyurtma                                                    [Bekor] [Saqlash Ctrl+⏎]
┌ Form 640px ─────────────────────────────────┬ Xulosa rail 320px (sticky) ───────┐
│ Mijoz  [Jasur Versal · Urganch · Jamol   ▾] │ Jasur Versal                      │
│ Sana [09.07.2026]  Usul (zavod) [BANK|CASH] │ 2 400 000 Qarz · 8 paddon         │
│ ── Mahsulotlar (Zavod: CAOLS KS — o'zgart.) │ Limit ▓▓▓▓▓▓▓░░ 8.2M/10M          │
│ │Mahsulot     │Pad.│ m³    │Rejim│Narx│Σ  │ │ Agent limiti ▓▓▓░░░ 41M/60M       │
│ │D500 600×300 │ 19 │32.832✎│ K   │…   │…  │ │ ─────────────────────             │
│ │+ qator (⏎)                              │ │ Paddon 19/19 ▓▓▓▓▓▓▓▓▓            │
│ ── Transport                                │ Hajm 32.832 m³                    │
│ Moshina [50A123BC ▾]  Shofyor [Baxtiyor]    │ Savdo ≈ 24 020 000                │
│ (Mijoz o'zi|Diler hisobidan|Mijozdan olinadi)│ Transport +200 000 foyda          │
│ Narxi [2 000 000]  Mijozdan [2 200 000]     │ ═ QARZGA YOZILADI: 26 220 000     │
│ Izoh [                                    ] │ Keyin balans: 28 620 000 / 10M ⚠  │
└─────────────────────────────────────────────┴───────────────────────────────────┘
```

## B.5 FactoryDetail settlement hub

```
Zavodlar / CAOLS KS MCHJ                 [To'lov qilish t] [Ajratish a] [Paddon] [Bonus ▾] [⎙]
BALANS: 973 619 270 Avans        BONUS HAMYON: 4 812 000        PADDON: 214 dona
┌ Tabs: Hisob-kitob | Buyurtmalar | To'lovlar | Bonus dasturi | Paddonlar ┬ Rail ─┐
│ [davr chips]  running-balance statement, server-paginated               │Dastur:│
│ 09.07  Zavodga to'lov   → payment   −250 000 000   723 619 270          │PERCENT│
│ 09.07  Tannarx tuzatish → ORD-000151    −1 250 000 …                    │1.5%   │
│ 09.07  Bonus hisobidan  → payment      +4 000 000 …                     │01.06→ │
│  ↩ storno pairs linked                                                  │8 ta   │
│                                                                          │taxminiy│
└──────────────────────────────────────────────────────────────────────────┴───────┘
```

## B.6 PaymentComposer + AllocationEditor (FACTORY_OUT state)

```
┌ Zavodga to'lov — CAOLS KS ──────────────────────────────────────── ✕ ┐
│ Sana [09.07]  Usul [Naqd|O'tkazma|Click|Terminal|Karta|USD]           │
│ ⓘ BANK usuli: allokatsiyada tannarx zavod O'TKAZMA narxida qotiriladi │
│ Summa [250 000 000]        Kassa [Bank (Септем Алока) · 312 400 000 ▾]│
│ Qabul qiluvchi (yur. shaxs) [CAOLS KS MCHJ ▾]   Izoh [            ]  │
│ ── ALLOKATSIYA ──────────────── Ajratilmagan qoldiq: 0 ───────────── │
│ [Eng eskisidan taqsimlash Ctrl+A]                                     │
│ ☑ ORD-000141 02.07  tannarx 41 200 000  ochiq 41 200 000 → [41 200 000] → FINAL │
│ ☑ ORD-000144 03.07  tannarx 38 100 000  ochiq 38 100 000 → [38 100 000] → FINAL │
│ ☑ ORD-000151 05.07  tannarx 45 000 000  ochiq 45 000 000 → [20 700 000] → PARTIAL│
│ Σ allokatsiya 250 000 000 / to'lov 250 000 000  ✓                     │
│                                   [Bekor Esc]  [Saqlash ⏎] [Saqlash+⎙]│
└───────────────────────────────────────────────────────────────────────┘
```

## B.7 VehicleDetail

```
Moshinalar / 50A 123BC — Isuzu             [Shofyorga to'lash t] [⎙ hisob-kitob]
SHOFYORGA QARZIMIZ: 4 200 000     Shofyor: Baxtiyor · +998 …📞     Sig'im: 19
┌ Buyurtmalar (oxirgi 50; to'lanmaganlar birinchi) ────────┬ Hisob-kitob rail ──┐
│ x │ №       Sana   Mijoz     Narxi      Holati    Ochiq  │ running balance    │
│ ☑ │ ORD-155 08.07  Gofur     1 400 000  To'lanmagan 1 400 000│ …              │
│ ☑ │ ORD-152 07.07  Jasur     1 400 000  To'lanmagan 1 400 000│                │
│   │ ORD-149 05.07  Shiddat   2 000 000  Mijoz to'lagan  —  │                  │
│ [BulkBar: 2 ta tanlandi · 2 800 000 · Shofyorga to'lash]  │                    │
└───────────────────────────────────────────────────────────┴────────────────────┘
```

## B.8 Import stepper (ADMIN)

```
Excel import          ① Yuklash ─── ② Tekshiruv ─── ③ Import va solishtirish
② Tekshiruv (dry run · saqlangan 09:12):
  Tekshiruv               Kutilgan          Haqiqiy           Δ
  ✓ Σ blok tannarxi       992 269 250       992 269 250       0
  ✗ Σ Оплата            1 024 066 320     1 023 966 320  −100 000  ← red
  [Yozuvlar: 56 buyurtma · to'lovlar: CLIENT_IN 214 · FACTORY_OUT 31 · …chips]
  ⚠ 95 812 400 so'm to'lovlar Оплата daftarida yo'q (reconciled=false) [ro'yxat ▾]
③ Solishtirish: [mos 14] [farqli 3] [izohlangan 2] [IZOHSIZ 1 — import xatosi]
  mijoz rows expandable → sheetGaps: «Товар 12-qator varaqda yo'q (+18 400 000)» …
```

## B.9 AGENT mobile shell

```
┌────────────────────────────┐
│ ▦ SmartBlok        ● 🔍 AJ │  top bar 40px
│ Panelim                    │
│ [Limit ▓▓▓▓░ 41M/60M]      │  HeadroomMeter hero (from /agents/me)
│ [Oy savdom] [Yig'dim]      │
│ [Qarzdorlarim 4 →]         │
│  …card stacks…             │
├────────────────────────────┤
│ Panel Buyurt. (+) Mijoz Qarz│  bottom tabs 56px, center (+) raised
└────────────────────────────┘
  (+) → sheet: Yangi buyurtma / To'lov qabul qilish
```

---

# Appendix C — Terminology glossary (one voice, one script)

The redesign fixes one Uzbek (Latin) term per concept, applied across UI, print docs and
server-error surfacing. Existing dominant terms win; drifted synonyms are retired.

| Concept | Canonical term | Retired variants |
|---|---|---|
| Driver | **Shofyor** | Haydovchi, шопир |
| Pallet | **Paddon** | Поддон, pallet |
| Truck/vehicle | **Moshina** | Fura (kept only in «fura sig'imi» setting label) |
| Factory | **Zavod** | — |
| Statement | **Hisob-kitob** | Vypiska |
| Debt / advance | **Qarz / Avans** | signed-only numbers |
| Settled | **Hisob toza** | «0», «—» |
| Allocation | **Ajratish / Allokatsiya** (verb/noun) | raspredeleniye |
| Provisional / final cost | **Taxminiy / Qotirilgan tannarx** | PROVISIONAL/FINAL raw |
| Void / storno | **Bekor qilish (hujjat) / Storno (kassa)** | o'chirish |
| Reconciliation flag | **Tekshirilsin** | unreconciled |
| Waybill | **Yo'l varaqasi** | nakladnaya |
| Invoice | **Hisob-faktura** | schyot |
| Receipt | **Kvitansiya** | chek |
| Recon statement | **Solishtirish dalolatnomasi (akt sverki)** | — |
| Queue/worklist | **Navbat** | — |
| Roles | **Administrator · Buxgalter · Agent · Kassir** | Hisobchi, raw enums |
| Buyer of blocks | **Mijoz** | klient |
| Price pending | **Narxlanmagan** | narxsiz (kept as short chip label only) |
| Loading/unloading points | **Yuklash manzili / Yetkazish manzili** | — |

Rules: backend messages surface verbatim (they are already Uzbek); workbook sheet names
(Товар, Оплата, Свод) remain quoted Cyrillic artifacts inside Import screens only; ledger
source enums are always rendered through one shared translation map (never raw
`COST_ADJUSTMENT` on screen).

---

# Appendix D — Full keyboard reference (the `?` overlay content)

**Global** — `Ctrl+K` palette · `g d/o/m/t/q/k/n` go-to · `c o/p/x` create ·
`[` sidebar · `?` this overlay · `Esc` close topmost surface.

**Lists** — `↑↓`/`j k` cursor · `Enter` open · `Space`/`p` peek · `→` expand row (where rows
expand) · `x` select · `Shift+↑↓` extend · `Ctrl+A` select filtered page · `.` row menu ·
`t` to'lov (party rows) · `e` inline edit (catalog cells) · `f` add filter · `/` focus search
token · `v` saved views · `Ctrl+Shift+E` export CSV of filter.

**Forms/composers** — `Tab`/`Shift+Tab` field walk · `Enter` commit row (item grids) /
save (single-action modals) · `Ctrl+Enter` save (full forms) or save+print (composers) ·
`Ctrl+A` auto-allocate (AllocationEditor) · `Ctrl+Backspace` delete item row · `Esc` cancel
with dirty-check.

**OrderDetail** — `Enter` primary next-step verb · `Shift+E` edit (when legal) · `Ctrl+P`
contextual print (invoice; waybill when status=LOADING).

**Peek** — `↑↓` moves peek through list rows · `↗`/`o` open full page · `⎙` print · `Esc` close.

All chords are disabled inside text inputs; every menu item and button renders its KeyHint chip
so the map is learnable by osmosis, not documentation.

---

# Appendix E — Interaction states & accessibility contract

**Loading**: skeletons mirror final layout (header + 8 rows for grids, label+bar for stats);
never a centered spinner on an empty page; `keepPreviousData` on all paged queries so filter
changes never blank the table.

**Empty**: EmptyState always names the next action («Hali to'lovlar yo'q — To'lov qabul
qilish»); filtered-empty differs from true-empty («Filtrga mos yozuv topilmadi — filtrlarni
tozalash»).

**Error**: inline Alert + Qayta urinish in place of the failed region only (page chrome
survives); server validation errors map to fields, with the server's Uzbek text verbatim;
mutation errors never silently reset forms.

**Realtime**: socket invalidations are debounced 2s per key family client-side (coalesces the
refetch storms); LiveDot reflects true socket state; visible rows that change under the user
pulse once — data never reorders under the keyboard cursor without the pulse.

**Focus & a11y**: every interactive element reachable by Tab with a visible §4 focus ring;
modals/peeks trap focus and restore it to the invoker on close; icon-only buttons carry
`aria-label` (Uzbek); tables use proper th/scope; status tags include text (never color-only);
contrast: all §4.1 text/surface pairs hold ≥ 4.5:1 (13px table text on both themes verified);
touch targets ≥ 44px on mobile breakpoints; `prefers-reduced-motion` honored (§4.4).

**Destructive actions**: always ReasonModal with ImpactPreview; the danger button is never the
default-focused element; double-submit safety comes from idempotency keys (payments) and
disabled-while-pending everywhere else.

---

*End of vision. — «Buyruq va Zichlik»: the ledger you can see, the keyboard you can trust.*
