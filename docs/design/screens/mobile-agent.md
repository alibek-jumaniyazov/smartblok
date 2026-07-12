# SmartBlok — AGENT Mobile Experience (screens spec, v1)

**Status:** implementation-ready screen specification. Governed by `02-design-language.md`
(tokens, money semantics, platform state law), `03-shell-and-ia.md` (IA, routes, URL
contract, §11 responsive law), `04-components.md` (component anatomy), `05-hero-workflows.md`
(§1.1 agent order wizard, §2.1 agent payment, §D edge paths). Nothing here invents a second
design language — every surface below is an instance of an existing component.

**Scope:** the AGENT (rol: Agent) experience on their pages — `/` (agent cockpit), `/orders`,
`/orders/:id`, `/orders/new`, `/clients`, `/clients/:id`, `/debts`, `/payments` (+ `/payments/:id`),
`/me`, `/profile`, and the print routes an agent may open. The agent is a field salesperson:
one thumb, sunlight, spotty network, client standing next to them. Everything is designed
mobile-first at <768px; §0.6 defines what changes at 768–1023 and ≥1024.

**API truth used throughout (verified in `apps/api/src`):** AGENT is row-scoped server-side
(agentScope/assertOwnAgent) on clients, orders, payments, debts, pallets. AGENT may: read own
everything, create orders (POST /orders), advance status exactly +1 (PATCH /orders/:id/status),
comment (POST /orders/:id/comments), create/edit own clients (POST/PUT /clients — credit
fields silently stripped), create CLIENT_IN payments only (POST /payments), read
GET /agents/me and GET /agents/:id (own). AGENT may NOT: edit orders (PUT is A/B), cancel,
price pending items, allocate or void payments, touch kassa/expenses/bonus/reports, see
company liabilities (GET /debts/summary is A/B, GET /dashboard/agents-ranking is A/B).

---

## 0. The AGENT shell on a phone (<768px)

### 0.1 The decision: bottom tab bar, not a drawer

**Bottom tab bar wins** (already fixed by `03` §11; recorded rationale):

- The agent's world is 5 destinations that cover ~95% of field work. A hamburger drawer
  costs two gestures to reach anything, hides the ➕ money actions, and gives zero ambient
  signal (badges). A tab bar is one thumb-tap, always visible, and carries live badges.
- The drawer pattern survives only for **desk roles** on phones (`03` §11 — read-and-approve
  support); it is not the agent experience.

### 0.2 Tab bar anatomy

```
┌──────────────────────────────────────────────┐
│                 (page content)               │
├──────────────────────────────────────────────┤
│  Ish stoli  Buyurtmalar  (➕)  Mijozlar  Qarzlar │  56px + safe-area
└──────────────────────────────────────────────┘
```

- 56px height + `env(safe-area-inset-bottom)`; `colorBgContainer`; top hairline
  `colorBorderSecondary`; e2 shadow only when content scrolls beneath.
- 5 slots, fixed (`03` §11): **Ish stoli** (`/`) · **Buyurtmalar** (`/orders`) · **➕**
  (raised action button) · **Mijozlar** (`/clients`) · **Qarzlar** (`/debts`).
- Items: 20px outlined icon + 11px label (overline style, **no uppercase**). Active item:
  `colorPrimary` icon + label (no pill — the bar is small). Inactive: `colorTextSecondary`.
  Hit area = full slot, ≥44×56px.
- **Badges:** Qarzlar tab carries a danger-count badge = own `hasOverdueOrders` client count
  (from the already-fetched `GET /debts/clients` worklist query, 2s-coalesced realtime).
  No other tab carries a badge — one alarm channel.
- The ➕ slot is a **raised 48px circle**, `colorPrimary`, elevated e2, icon «+» 24px. Tap
  opens the **action sheet** (§0.3). It never navigates by itself.
- On routes not represented in the bar (`/payments`, `/me`, `/profile`, `/orders/:id`, …)
  **no tab renders active**; the TopBar shows a back arrow (§0.4).

### 0.3 The ➕ action sheet

Bottom sheet (e2, drag handle, 240ms slide per `02` §5), three verb-first rows, 52px each,
icon + label + caption:

| Row | Caption | Opens |
|---|---|---|
| **Yangi buyurtma** | «Mijoz uchun buyurtma» | `/orders/new` (4-step wizard, §4) |
| **To'lov qabul qilish** | «Mijozdan pul olish» | full-screen PaymentComposer (§9) |
| **Yangi mijoz** | «Mijoz ro'yxatga olish» | client form sheet (§5.4) |

- When the agent's debt limit is exhausted (`GET /agents/me`: outstandingDebt ≥ debtLimit,
  debtLimit ≠ null), the «Yangi buyurtma» row keeps working but carries a danger caption
  «Limit to'lgan — buyurtma bloklanadi» — the block is *announced before the wizard*, and
  again with figures inside it (hero §1.1). Never a disabled mystery row.
- `Esc`/swipe-down closes. The sheet is the mobile twin of the palette's «Amallar» group.

### 0.4 Mobile TopBar (48px)

```
┌──────────────────────────────────────────────┐
│ ←  Buyurtmalar            ⌕   ●Jonli   (J)   │
└──────────────────────────────────────────────┘
```

- Left: back arrow on sub-routes (history back, URL-state-safe), otherwise the stacked-blocks
  wordmark glyph. Then the page title (h1 20px shrinks to 16px on <768).
- Right: **⌕ search icon** → command palette as a full-screen sheet (records/actions/pages,
  agent-scoped per `03` §2; recents first; record-scoped actions work — «To'lov qabul
  qilish — Жамол Ургенч» starts a payment in two taps). **LiveBadge** compact (dot only;
  tap opens the tooltip state: «Oxirgi yangilanish: 14:32», offline text). **Avatar chip**
  (initial only) → menu: **Mening ko'rsatkichlarim** (`/me`) · **Profil** (`/profile`) ·
  **Tungi rejim** (theme toggle) · **Chiqish**.
- PageHeader below it behaves per `04` §1.2: sticky-condensed on scroll; on party pages the
  balance stays visible in the condensed bar.

### 0.5 Platform behavior (binding for every screen in this doc)

- **Cards, never tables** (<768): every register renders `AgentCard` rows — an instance of
  the `03` §11 anatomy: line 1 = identity (body-strong) + right-aligned money/BalanceTag;
  line 2 = meta (small, `colorTextSecondary`); line 3 = chips (StatusChip dot-style,
  PalletChip, OverdueChip). Whole card tappable (≥64px tall), e1 on press. Typography per
  `02` §3: body/body-strong, labels never below 13px, `.num` tabular digits.
- **Money on mobile:** list rows and detail figures render **full grouped values**
  (`fmtMoney`). `fmtShort` appears only on cockpit StatCards — always with the exact value
  as a **permanent secondary caption** (never tooltip-only; `02` §7). Balances always via
  `BalanceTag`/semantic sentence — a raw signed number never renders.
- **Bottom sheets replace drawers/modals:** forms and peeks open as bottom sheets with a
  drag handle; money documents (payment peek) are full-height sheets. Dirty-close guarded
  («Kiritilgan ma'lumotlar saqlanmagan»). `?panel=`/`?peek=`/route params address them (URL
  law `03` §7) — a shared link opens the same sheet.
- **Filters** collapse into a «Filtrlar (n)» button opening a filter sheet (`04` §1.3 mobile
  state) + a horizontal **chip scroller** for the primary dimension (status/tab). All filter
  state is URL params — back button and shared links restore it exactly.
- **Pagination:** «Yana 20 tasini yuklash» append button at list end (writes `page` via
  replaceState); header shows «Jami: N ta». `keepPreviousData` + 2px refetch hairline under
  the PageHeader — rows never vanish during refetch.
- **Pull-to-refresh** on every card list (invalidates that page's query family).
- **Offline:** persistent amber hairline under the TopBar «Oflayn — ma'lumot 14:32
  holatiga»; KPI values gain the «14:32 holatiga» suffix; `refetchOnWindowFocus` on. Socket
  reconnect clears it. Numbers are never silently stale.
- **Touch targets ≥44px**; primary submit buttons 48px, sticky above the tab bar. **No
  hover-only information anywhere** (hard rule). No keyboard chords on touch — every
  shortcut has a visible tap path.
- Drafts: order wizard and PaymentComposer persist to sessionStorage per route; a phone
  call mid-entry costs nothing (`02` §9 form resume).

### 0.6 Breakpoints for AGENT pages

| Range | Behavior |
|---|---|
| <768px | Everything in this document: tab bar, cards, sheets, wizard. |
| 768–1023px | Tab bar is replaced by the 64px icon rail + overlay nav (`03` §11); lists switch to 2-line rows (identity+status / money+meta); detail stays single column; sheets become right drawers. Keyboard map active. |
| ≥1024px | Agent gets the **desktop registers** exactly as specced in the desktop screen docs, with the role variations noted there (own scope, hidden controls). This doc stops applying except for role rules. |

### 0.7 Keyboard (hardware keyboard present / ≥768)

Global map (`03` §8) applies with the agent's Go targets: `G` `D/O/M/T/Q` (Ish stoli /
Buyurtmalar / Mijozlar / To'lovlar / Qarzlar), `Ctrl+K` palette, `/` search, `N` new,
`T` payment on debt/client rows, `Ctrl+Enter` submit, `Esc` close. On touch: none — chords
require a physical keyboard; `KbdHint` chips do not render on coarse pointers.

### 0.8 Verify before build (agent-specific API facts)

| # | Assumption | If false |
|---|---|---|
| a | **AGENT can list cashboxes.** `POST /payments` (CLIENT_IN) requires `cashboxId`, but `GET /kassa/cashboxes` is currently `@Roles('ADMIN','ACCOUNTANT','CASHIER')` — today the agent's cashbox query 403s and agent payment entry is dead on arrival. The design needs the one-line role addition (AGENT read on the cashbox list; the agent UI **hides box balances** — only name + currency render for agents). This is a permission alignment, not new business logic — same class as `03` §10d. | «To'lov qabul qilish» disappears for AGENT everywhere (➕ sheet, client header, debts rows) and is replaced by the honest caption «To'lovni kassir yoki ofis qabul qiladi» — never a form that cannot submit. |
| b | `GET /clients` ignores `regionId`/`agentId` (confirmed: PageQueryDto) | Already designed around: no region/agent filter controls render on the agent's client list (`03` §7 starred params). |
| c | No `?sort=` on list endpoints (default posture) | Mobile lists state their fixed order in the header meta («yangi birinchi», «qarz bo'yicha»); no sort control renders. |
| d | Debt-row expansion needs the client's open orders; there is no `open=true` filter | Expansion fetches `GET /orders?clientId=X&pageSize=20` and filters non-CANCELLED client-side, labeled «oxirgi 20 buyurtma ichida» — bounded, visible window (`03` §6 honesty rule). |

---

## 1. `/` — Ish stoli (agent cockpit)

**Purpose:** the agent's morning answer to three questions: *may I still sell on credit?*
(limit), *who must pay today?* (queues), *how is my month going?* (KPIs). It is the G-variant
of the role cockpit (`03` §4) — this section is its full spec.

### 1.1 Layout

```
┌ TopBar: SmartBlok · ⌕ · ●Jonli · (J) ────────────────┐
│ ┌───────────────────────────────────────────────────┐│
│ │ LIMIT CARD (HeadroomMeter hero)                   ││
│ │ Qarz limiti      Mening ko'rsatkichlarim →        ││
│ │ ▓▓▓▓▓▓▓▓░░░░  71%                                 ││
│ │ Limit: 20 000 000 · Band: 14 200 000              ││
│ │ Bo'sh: 5 800 000 so'm                             ││
│ │ ---- 14 kunlik savdo sparkline ----               ││
│ └───────────────────────────────────────────────────┘│
│ E'tibor kerak                                        │
│ ┌ Muddati o'tgan qarzlar · 3 ta · 8 400 000 ───────┐ │
│ │ Гофур Хазорасп        6 200 000   12 kun         │ │
│ │ Жамол Ургенч          1 400 000    3 kun         │ │
│ │ …                              Hammasi →         │ │
│ └──────────────────────────────────────────────────┘ │
│ ┌ Bugun muddati kelganlar · 2 ta ──────────────────┐ │
│ ┌ Yo'ldagi buyurtmalarim · 4 ta ───────────────────┐ │
│ │            (yoki:  Toza ✓ — navbatlar bo'sh)     │ │
│ SAVDO                                                │
│ ┌ Bugungi savdo ┐ ┌ Oy savdosi ┐ ┌ Hajm (oy) ┐      │
│ │ 4,2 mln       │ │ 118,4 mln  │ │ 312,5 m³  │      │
│ │ 4 180 000 so'm│ │ 118 380 500│ │           │      │
│ MOLIYA                                               │
│ ┌ Oyda yig'ilgan ┐ ┌ Mijozlarim qarzi ┐ ┌ Paddon ┐  │
│ ┌ Mahsulot foydasi (oy) ┐ ┌ Transport foydasi ┐     │
│ ┌ Chart: Savdo va yig'im · 7|30|90|365 ────────────┐ │
│ └──────────────────────────────────────────────────┘ │
├──────── Ish stoli · Buyurtmalar · ➕ · Mijozlar · Qarzlar ┤
```

Single column, 16px page padding, 20px between sections. Order is fixed: limit → queues →
KPIs → chart (the limit gates everything the agent does; queues are today's work; KPIs are
reflection).

### 1.2 Components & data

| Instance | Component (`04`) | Data |
|---|---|---|
| Limit card | `CreditGauge` agent variant (§2.7) + `Sparkline` | `GET /agents/me` → `outstandingDebt`, `debtLimit` (effective), `ownDebtLimit`; sparkline from `GET /dashboard/trends?days=14` (`sales` series). Refetched on socket invalidation + pull-to-refresh. |
| Queue cards | `WorklistCard` ×3, single-column `InboxRail` | #1 **Muddati o'tgan qarzlar** (danger): `GET /debts/clients` rows with `hasOverdueOrders=true`; count + Σ `overdueOrdersTotal`; preview rows = worst 3 (name · `overdueOrdersTotal` · overdue age). #11 **Bugun muddati kelganlar** (warning): rows with `dueWithinWindow=true` at `days=1`; card footer names the window. #10 **Yo'ldagi buyurtmalarim** (neutral): `GET /orders?status=CONFIRMED|LOADING|DELIVERING` (3 parallel queries, merged; count only, labeled). |
| KPI bands | `KpiBand` SAVDO / MOLIYA of `StatCard`s | `GET /dashboard/summary` (server-scoped to agentId): `todaySales`, `monthSales`, `yearSales` (secondary), `cubeSoldMonth`, `collectedThisMonth`, `clientsOweUs` (own clients), `palletsAtClients`, `goodsProfitMonth`, `transportProfitMonth`. Mobile StatCard: `fmtShort` value + permanent full-precision caption; delta chips vs previous period only where the trends payload supports it (sales/collected); profit cards signed ink + labeled «taxminiy» while any own order's cost is non-FINAL is **not computable for the agent** — profit cards instead carry the standing footnote «tannarx zavod to'lovlariga qarab aniqlashadi». |
| Chart | `@ant-design/plots` Line, 2 series + count bar layer | `GET /dashboard/trends?days=` (7/30/90/365 segmented, default 30) → `sales`, `collected`, `orders` (bar layer 60% alpha). Point tap → `/orders?from=X&to=X`. |
| LiveBadge / offline | `LiveBadge` (§4.5) | socket state; offline = amber banner + «HH:mm holatiga» suffix on every KPI. |

### 1.3 Actions & drill-downs (every number is a door)

| Element | Target |
|---|---|
| Limit card body | `/me` |
| Muddati o'tgan header / preview row | `/debts?chip=overdue` / `/clients/:id` |
| Bugun muddati kelganlar | `/debts?days=1` |
| Yo'ldagi buyurtmalarim | `/orders?chip=inflight` |
| Bugungi savdo / Oy savdosi | `/orders?from&to` (today / current month) |
| Oyda yig'ilgan | `/payments?from&to` (current month) |
| Mijozlarim qarzi | `/debts` |
| Paddonlar | `/debts?tab=paddonlar` |
| Chart point | `/orders?from=X&to=X` |

### 1.4 Filters / URL / keyboard

- URL: `?days=7|30|90|365` (chart range). Nothing else — the cockpit is not a register.
- Keyboard (≥768): `G D` returns here; `Ctrl+K` palette; queue preview rows focusable.

### 1.5 States

- Loading: skeleton of the real layout (limit card block, 3 card skeletons, 2 KPI rows) —
  no layout jump. Refetch: hairline only.
- All queues zero → the three cards collapse into one green strip «Toza ✓ — bugun navbat
  bo'sh» (a clean day is visibly clean).
- Limit states: `debtLimit=null` → «Cheklanmagan» plain text, no bar; `=0` → danger
  «Faqat oldindan to'lov — yangi buyurtma bloklanadi»; ≥80% warning ink; ≥100% danger +
  «Yangi buyurtma bloklanadi».
- Error: `ErrorState` per failed region only (a dead summary never kills the queues).

### 1.6 Role variations & responsive

This IS the AGENT variant of `/`. A/B and K variants are separate specs. 768–1023: KPI cards
2-up, queues 2-column masonry. ≥1024: desktop agent cockpit (same content, 3-up).

### 1.7 Removed vs today — and why

| Removed | Why |
|---|---|
| «Kutilayotgan tushum» card | Byte-identical duplicate of clientsOweUs (`03` §5 decision); the real forecast lives on `/debts` with its window. |
| Static «● LIVE» tag | Lied when the socket died → real `LiveBadge`. |
| Hover-tooltip exact money | Unusable on touch → permanent secondary caption. |
| Flat 10-card KPI wall | Regrouped into limit → queues → SAVDO/MOLIYA; every card now drills down (was: zero links). |

---

## 2. `/orders` — Buyurtmalar

**Purpose:** the agent's own order register — find an order, check its status/blockers, open
it. Feature-complete vs today's 10-column table, re-expressed as cards.

### 2.1 Layout

```
┌ TopBar: Buyurtmalar · ⌕ · ● · (J) ───────────────────┐
│ [⌕ Qidiruv: raqam yoki mijoz…]      [Filtrlar (2)]   │
│ ‹ Hammasi · Yangi · Tasdiqlangan · Yuklanmoqda · … › │  ← chip scroller
│ Jami: 214 ta · yangi birinchi                        │
│ ┌───────────────────────────────────────────────────┐│
│ │ ORD-000214 · Жамол Ургенч          4 500 000 so'm ││
│ │ 08.07.2026 · CAOLS KS · 19 paddon                 ││
│ │ ● Yuklanmoqda   ⚠ Moshinasiz   [Narxlanmagan]     ││
│ └───────────────────────────────────────────────────┘│
│ ┌ ORD-000213 · Гофур Хазорасп …                     ┐│
│ │ … (ghost 60%: bekor qilingan, summa strikethrough)││
│ [ Yana 20 tasini yuklash ]                           │
├──────── tab bar (Buyurtmalar faol) ──────────────────┤
```

### 2.2 Components & data

- `FilterBar` (mobile collapsed): search input (debounced 300ms, «raqam yoki mijoz») +
  «Filtrlar (n)» sheet: **Mijoz** (`PartySelect`, own clients, `GET /clients?search=`),
  **Zavod** (`GET /factories` — read allowed; if the agent's role lacks it, the control
  hides, never fakes), **Sana** (`DateRangeControl` presets Bugun · Kecha · 7 kun · Shu oy ·
  O'tgan oy · Oraliq…).
- Status **chip scroller** (Segmented, horizontally scrollable): Hammasi · Yangi ·
  Tasdiqlangan · Yuklanmoqda · Yetkazilmoqda · Yetkazildi · Yakunlandi · Bekor qilingan →
  `?status=`.
- Card list: `GET /orders?status&search&clientId&factoryId&dateFrom&dateTo&page&pageSize`
  (agent-scoped server-side). Card fields: `orderNo`, `client.name`, `saleTotal`
  (MoneyCell neutral, full precision; «≈» prefix + gold «Narxlanmagan» chip when any item
  `pricePending`), `date`, `factory.name`, Σ `palletCount` («N paddon»), `StatusChip`
  (dot-style), blocker chip «⚠ Moshinasiz» when `status=CONFIRMED && !vehicleId`,
  `TransportPaidStatus` chip only when not NOT_APPLICABLE (violet «Aniqlanmagan ?» kept —
  the owner's UNKNOWNs stay visible to the agent whose client it is), due chip «Muddati
  o'tgan» (danger) when `dueDate < now && status ≠ CANCELLED`.
- Ghost rows: CANCELLED orders at 60% opacity, amount struck through, «Bekor qilingan»
  filled danger chip. Tri-state «Bekorlar: yashirish/ko'rsatish/faqat» lives in the filter
  sheet (client-side over the status filter — CANCELLED is a status here, honest and exact).
- Header meta: «Jami: N ta · yangi birinchi» (server total; fixed sort stated — verify §0.8c).
  No money Σ line: the API returns no filter aggregate for orders — nothing fake renders;
  Σ savdo appears on desktop where the totals row is labeled «sahifa jami».

### 2.3 Actions

- Tap card → `/orders/:id`. That is the only row action on mobile — advance/print/cancel
  live on the detail (agents cannot cancel anyway; a mis-tap on a money action in a moving
  car is worse than one extra tap).
- ➕ tab → «Yangi buyurtma».
- Realtime: socket `order` events (2s-coalesced) refetch; a changed visible card pulses once.

### 2.4 Filters & URL

`/orders?status&search&clientId&factoryId&from&to&chip&page` (URL names per `03` §7; `from/to`
map to API `dateFrom/dateTo`). `chip=inflight` = the cockpit queue recipe (CONFIRMED+LOADING+
DELIVERING merged; the chip renders as a removable token «Yo'lda ×»). Every change resets
`page`. Unknown params → red clearable token.

### 2.5 Keyboard (≥768)

`/` search · `N` new order · `F` filter sheet · `J/K` cursor · `Enter` open · `Esc` clear.

### 2.6 States

- First load: 8 skeleton cards. Empty (no filter): «Hali buyurtma yo'q — Yangi buyurtma»
  (primary action). Empty (filtered): «Filtrga mos buyurtma topilmadi» + «Filtrlarni
  tozalash». Error: `ErrorState` + server text verbatim + «Qayta urinish». Offline banner
  per §0.5.

### 2.7 Role variations / responsive / removed

- This page for A/B is the desktop register (separate spec); the AGENT variant differs only
  in scope (own), no SavedViews below 768 (power feature — returns at ≥1024), no bulk bar,
  no row kebab.
- 768–1023: 2-line rows; ≥1024 desktop register.
- **Removed vs today:** the 10-column table (<768 tables are banned); Agent column (always
  «me» — meaningless in own scope); cost-status tag on the card (office concern; still on
  detail) — everything else (status tabs, search, client/factory/date filters, sale total,
  transport tag, pagination totals) is preserved. **Added:** blocker/overdue/Narxlanmagan
  chips, URL-synced filters, ghost rendering.

---

## 3. `/orders/:id` — Buyurtma (mobile workbench)

**Purpose:** one order end-to-end for its agent: where it stands, what blocks it, the single
legal next step, the money picture, and the paper.

### 3.1 Layout (single column, in this order)

```
┌ ← ORD-000214 · ● Yuklanmoqda ────────────────────────┐  sticky condensed on scroll
│ Жамол Ургенч → · 08.07.2026 · CAOLS KS               │
│ ┌ HOLAT ────────────────────────────────────────────┐│
│ │ ●──●──●──○──○──○   Yangi→Yakunlandi rail          ││
│ │ [⚠ Moshina biriktirilmagan — ofis biriktiradi]    ││
│ │ ┌───────────────────────────────────────────────┐ ││
│ │ │        Yetkazishga jo'natish                  │ ││  ← 48px, one legal +1 verb
│ │ └───────────────────────────────────────────────┘ ││
│ ┌ MOLIYA ───────────────────────────────────────────┐│
│ │ Savdo: 24 300 000 · Transport: +300 000           ││
│ │ Jami yozilgan qarz: 24 600 000 so'm               ││
│ │ To'langan: ▓▓▓▓░░ 16 000 000 / 24 600 000         ││
│ │ Mijoz balansi: [Qarz 12 450 000]                  ││
│ ┌ MAHSULOTLAR ──────────────────────────────────────┐│
│ │ D500 60×30×20 · 19 paddon · 32,832 m³             ││
│ │ 740 000 so'm/m³ = 24 300 000    [Narxlanmagan]    ││
│ ┌ TRANSPORT ────────────────────────────────────────┐│
│ │ Diler hisobidan · Isuzu 01A774 · Shofyor: Karim   ││
│ │ Xarajat: 2 000 000 · Mijozdan: 2 200 000          ││
│ │ Holati: ● To'lanmagan                             ││
│ ┌ PADDONLAR ────────────────────────────────────────┐│
│ │ ⬛ Mijozga 19 dona berildi · qaytarilgani: 0       ││
│ ┌ TARIX ────────────────────────────────────────────┐│
│ │ (ActivityTimeline + izoh yozish)                  ││
│ └───────────────────────────────────────────────────┘│
├──────── tab bar (hech biri faol emas) ───────────────┤
```

`?tab=` deep-links scroll anchors (holat/moliya/mahsulotlar/transport/paddonlar/tarix) —
the desktop workbench's tabs become scroll sections; the URL contract survives.

### 3.2 Components & data

All from `GET /orders/:id` (includes items+product, client/agent/factory/vehicle, createdBy,
statusHistory, comments, allocations+payment, palletTransactions) + `GET /orders/:id/timeline`.

| Instance | Component | Notes / fields |
|---|---|---|
| Header | `PageHeader` sticky-condensed | orderNo + `StatusChip` (12%-tint filled); meta: client (link `/clients/:id`), date, factory; overflow ⋮: «Chop etish ▾», «Izoh yozish» (scrolls to composer). |
| Status rail | `StatusFlow` mobile variant (§3.1: «one big button») | 6-dot compact rail with dates/actors beneath (from `statusHistory`); ONE 48px verb button = the agent's single legal +1 transition (Tasdiqlash → Yuklashni boshlash → Yetkazishga jo'natish → Yetkazildi deb belgilash → Yakunlash) → `PATCH /orders/:id/status {to}`. Pre-COMPLETED hint «Yakunlanganda zavod bonusi hisoblanadi» (bonus is factory-side; shown as info, not agent money). Button self-disables with its verb while posting. |
| Blocker | blocker chip on the Yuklash node | `status=CONFIRMED && !vehicleId` → amber «Moshina biriktirilmagan — ofis biriktiradi» + secondary «Izoh yozish →» (agents cannot call `PUT /orders/:id`; the A/B inline «Biriktirish» does not render). The advance button is disabled with the same words — the old dead-end error toast is extinct. |
| Moliya | Descriptions + progress | `saleTotal` («≈» + gold chip when pricePending items exist), `transportCharge` line only when DEALER_CHARGED; **exposure = saleTotal + transportCharge** headline «Jami yozilgan qarz» (locked rule: debt at creation, transport included); paid progress = Σ active CLIENT_IN allocations (from `allocations`) vs exposure — the sale-only bar bug dies; client `BalanceTag` (from the client link payload, refetched on open). Cost/tannarx and goods profit render as a collapsed «Tannarx (ofis)» row — agent sees them today, kept, but demoted (cost is finalized by office allocation; chip Taxminiy/Qisman/Qotirilgan from `costStatus`). |
| Mahsulotlar | item cards | per item: product name+size, `palletCount` dona, `quantityM3` m³ (3dp), price (stored precision) or «Narxlanmagan» chip + caption «narxlashni ofis bajaradi» (PATCH price is A/B), line total. Lump-sum items: agreed total + back-solved price small. |
| Transport | Descriptions | mode label (Mijozning o'z transporti / Diler hisobidan / Mijozdan olinadi), vehicle name+plate, driverName snapshot, cost, charge, «Transport foydasi» signed — plus `TransportPaidStatus` StatusChip (violet «Aniqlanmagan ?» kept visible). No pay actions (office/cashier). |
| Paddonlar | `PalletChip` + mini-list | from `palletTransactions`: delivered/returned rows, net «mijoz zimmasida N dona». In-kind only — never mixed with money. |
| Tarix | `ActivityTimeline` (§4.4) | merged statuses+payments+pallets+comments from `/timeline`; composer at bottom → `POST /orders/:id/comments` (optimistic row — the app's only optimism); filter chips Hammasi/Izohlar/Moliya/Holat. The separate Izohlar tab is dead. |
| Cancelled state | danger banner | replaces the rail: «Buyurtma bekor qilingan» + reason + link to the netting reversal set in Tarix. Ghost math stays readable. |

### 3.3 Actions

| Action | Where | API |
|---|---|---|
| Advance +1 | StatusFlow button (`Enter` ≥768) | `PATCH /orders/:id/status` |
| Izoh yozish | timeline composer (`Ctrl+Enter`) | `POST /orders/:id/comments` |
| Chop etish ▾ | header overflow (`P` ≥768) | «Yuk xati» → `/print/waybill/:orderId`; «Hisob-faktura» → `/print/invoice/:orderId` (both G-own per route table; §12) |
| Mijoz kartasi | client name link | `/clients/:id` |
| To'lov qabul qilish | Moliya card secondary button | PaymentComposer pre-bound to the client (§9) — collect against this client without leaving the order |

On entering LOADING, the success toast offers «Yuk xati chop etish →» (hero §6.1 entry).

### 3.4 States / edge paths

- Loading: skeleton of the real layout. Server transition rejections (vehicle, sequence)
  render **verbatim** under the rail button. Composer collision: socket event on this order
  → amber ribbon «Bu hujjat o'zgartirildi — Yangilash». Realtime: transport/cost chips flip
  app-wide via socket with one pulse; numbers never animate.

### 3.5 Role variations / responsive / removed

- A/B on this route get the two-column workbench (separate spec) with edit/cancel/skip —
  none of that renders for AGENT (server truth: PUT/DELETE/price are A/B).
- **Removed vs today for agents:** «Bekor qilish» button (was rendered A/B-only already),
  Izohlar tab (merged into Tarix), Steps widget (→ StatusFlow). **Added:** blocker made
  visible pre-click, exposure-correct progress, print menu, pre-bound payment action.

---

## 4. `/orders/new` — Yangi buyurtma (the ➕ wizard)

**Purpose:** hero workflow §1.1 — a full order booked one-thumb in front of the client, with
credit truth **before** typing and the ledger consequence **before** submitting. Same route
and POST as desktop; the wizard is the <768 rendering of the 4-stage composer.

### 4.1 Frame

```
┌ ← Yangi buyurtma        1 Mijoz · 2 Mahsulot · 3 Transport · 4 Tasdiqlash ┐
│                    (step content, one thought per screen)                 │
│ ┌────────────────────────────────────────────────────┐                    │
│ │ 19/19 paddon · 23,9 mln · qarzga yoziladi        ⌃ │ ← summary bar 56px │
│ └────────────────────────────────────────────────────┘                    │
│ [        Davom etish        ]  ← 48px sticky, above tab bar               │
└───────────────────────────────────────────────────────────────────────────┘
```

- The **collapsed summary bar** is the mobile `LedgerPreview` (§3.5): always shows Σ paddon
  vs capacity · Σ taxminiy savdo · the consequence phrase «qarzga yoziladi». Swipe-up/tap
  expands it to the full LedgerPreview sheet at any step.
- Steps validate on advance; back preserves state; sessionStorage draft survives refresh/
  call (cleared on submit/cancel). Tab bar stays (escape hatch); leaving dirty → confirm.

### 4.2 Step 1 — Mijoz

- **Mijoz** `PartySelect` (server-searched `GET /clients?search=`, own scope, infinite
  scroll, option = name + `BalanceTag`; inline «Yangi mijoz qo'shish» opens §5.4 sheet).
  Pre-bound and locked (with ✕) when launched from a client card / palette.
- On pick, the **credit card** renders sized for sunlight (data `GET /clients/:id` +
  `GET /agents/me` + `GET /debts/clients?search=<name>` for the overdue chip, window-labeled):
  `BalanceTag` («Qarz 4 200 000»), `CreditGauge` («Limit: 10 mln · Band: 4,2 · Bo'sh: 5,8» /
  «Cheklanmagan» / danger «Faqat oldindan to'lov» at 0), `PalletChip` «⬛ 12 dona»,
  OverdueChip «2 ta muddati o'tgan · 6,2 mln», and beneath — **the agent's own headroom**
  line («Mening limitim: bo'sh 5,8 mln»). Blocked limits are announced HERE, not at submit:
  client at cap → danger note + figures; agent at cap → danger banner «Limit to'lgan —
  buyurtma bloklanadi» and «Davom etish» disabled (server stays authoritative).
- **Sana** (default today, DatePicker) · **Zavodga to'lov turi** segmented «O'tkazma (bank) |
  Naqd» with caption «taxminiy tannarx shu narxda hisoblanadi» (locked: intended method
  fixes provisional price kind; immutable later).

### 4.3 Step 2 — Mahsulot

- Product picker `GET /products` (search; options grouped by factory, label shows size +
  m³/paddon). **First pick locks the catalog to that factory**: header chip «Zavod: CAOLS
  KS ✕» with explicit «Zavodni almashtirish» escape that clears items — the one-order-one-
  factory rule is built into the control (locked rule).
- Per item card: **Paddon** big ± steppers (44px, `inputmode="numeric"`) → **m³ autofills**
  `paddon × m3PerPallet` with an `avto` badge; editing m³ flips it to `qo'lda` and autofill
  never overwrites again. **Narx rejimi** segmented: `Katalog / Kelishilgan / Umumiy summa`
  — **Narxlanmagan absent for AGENT** (A/B only; hero §1.1).
  - *Katalog:* resolved price shown incl. the client's ClientPrice override (current
    effective row from `GET /clients/:id → prices`), labeled «maxsus narx» when overridden,
    always «taxminiy — server tasdiqlaydi».
  - *Kelishilgan:* `MoneyInput` so'm/m³. The **floor is enforced at submit only, never shown**
    (locked rule: agents must never see factory cost; the agent's products payload carries only
    DEALER_SALE — FACTORY_BANK is stripped server-side, so there is no floor number to display
    or clamp against). If the entered price is below the server floor, the POST is rejected and
    the server's Uzbek error renders verbatim under the field; nothing entered is lost.
  - *Umumiy summa:* lump `MoneyInput`; stored exactly; back-solved per-m³ shown small.
- «+ Yana mahsulot» adds an item card (`Alt+Enter` ≥768); swipe-left / ✕ deletes
  (`Ctrl+Backspace`). Summary bar recomputes per keystroke (display-only math, «taxminiy»).

### 4.4 Step 3 — Transport

- **Moshina** `PartySelect` (`GET /vehicles`, active only, agent shape: name · plate ·
  «19 pd» · shofyor — **no balances for agents**). Picking re-bases the `CapacityMeter`
  («17/19 paddon», amber ≥90%, red + **submit block** when exceeded with the exact overflow
  «2 paddon ortiqcha — server rad etadi») and fills **Shofyor** only if untouched.
- **Rejim** segmented: `Mijozning o'z transporti / Diler hisobidan (standart) / Mijozdan
  olinadi`. Cost/charge `MoneyInput`s exist only for the active mode; DEALER_CHARGED shows
  live «Transport foydasi: +200 000» and adds the charge to the exposure line.
- **Guard (locked-hole closure):** `transportCost > 0` with no vehicle → blocking inline
  warning «Moshina tanlanmagan — shofyor qarzi hisobga olinmaydi» + explicit checkbox to
  proceed.

### 4.5 Step 4 — Tasdiqlash (the ledger preview IS the step)

Full `LedgerPreview` (§3.5) as the page: client credit picture → load figures (CapacityMeter,
Σ m³, «Taxminiy savdo») → transport figures → the postings block in statement language:

> «Mijoz hisobiga qarz: +24 300 000 (savdo) + 300 000 (transport)» ·
> «Paddon: mijozga 19 dona (naturada)» ·
> «To'lov muddati: 18.07.2026 (10 kun)» ·
> projected post-save balance + re-drawn CreditGauge — labeled «taxminiy — server tasdiqlaydi».

The agent turns the phone to the client; the tap that follows is informed consent. Note
field lives here. Submit «Buyurtma yaratish» (48px, `Ctrl+Enter` ≥768) → single
`POST /orders` (items, vehicleId, driverName, transportMode/cost/charge,
intendedPaymentMethod, note).

### 4.6 Submit outcomes

- Success: toast «ORD-000158 yaratildi» → navigate `/orders/:id` (rail at Yangi, next verb
  focused); draft cleared.
- **Credit rejection:** the preview block turns danger and renders the server's
  limit/current/new figures **verbatim**; nothing entered is lost; editing items or charge
  re-validates live (edge path §D).
- Capacity rejection: unreachable by design (blocked client-side with the vehicle's own
  capacity number). **Floor rejection (AGENT): reachable by design** — the floor is never shown
  to agents (locked rule), so a below-floor price is caught at submit; the server's Uzbek error
  renders verbatim under the price step, focus moved there, nothing lost.
- Double-tap safe: button self-disables «Yaratilmoqda…».

### 4.7 States / roles / removed

- Wizard resumes mid-step from sessionStorage («Qoralama tiklandi» ribbon + «Boshqatdan»).
- A/B on ≥768 get the 4-stage single-page composer (separate spec); this wizard is the
  <768 rendering for **all** roles, but Narxlanmagan appears only for A/B.
- **Removed vs today (agent):** Narxsiz pricing mode (A/B-only rule made structural);
  two-column form+summary (→ wizard + summary bar); silent m³ overwrite (→ avto/qo'lda);
  mixed-factory error banner (→ catalog lock). **Nothing else lost:** every field of
  today's form exists in a step.

---

## 5. `/clients` — Mijozlar

**Purpose:** the agent's portfolio: find a client, see their standing at a glance, start an
action. Own scope, server-enforced.

### 5.1 Layout

```
│ [⌕ Ism, telefon yoki taxallus…]        [+ Yangi]     │
│ Jami: 17 ta                                          │
│ ┌ Жамол Ургенч                    [Qarz 4 200 000] ┐ │
│ │ Urganch · +998 91 234-56-78                      │ │
│ │ ⬛ 12 dona   [2 ta muddati o'tgan]                │ │
│ └──────────────────────────────────────────────────┘ │
│ ┌ Нормат Умидбек (Nofaol)          [Hisob yopiq]   ┐ │
├──────── tab bar (Mijozlar faol) ─────────────────────┤
```

### 5.2 Components & data

- Search `GET /clients?search=&page&pageSize` (name/phone/alias, server-side). No region/
  agent filter controls (API ignores them — §0.8b; never a fake filter).
- `AgentCard`: `name` (+ grey «Nofaol» pill when `active=false`), `BalanceTag` from
  `balance` (Qarz/Avans/«Hisob yopiq» at |bal|<1 — locked epsilon), meta `region.name` ·
  `phone`, `PalletChip` from `palletBalance` (amber >0), overdue chip only if the debts
  query already in cache marks the client (`hasOverdueOrders`) — supplementary, no extra
  fetch storm.
- Credit limit is not a list column on mobile (office control); it renders on the detail
  header CreditGauge.

### 5.3 Actions

- Tap card → `/clients/:id`. «+ Yangi» (header, and ➕ sheet, `N` ≥768) → §5.4.
- No swipe actions on money — deliberate (§2.3 rationale).

### 5.4 Client form (create/edit bottom sheet)

- Fields for AGENT: **Ism** (required, unique — duplicate error verbatim), **Telefon**,
  **Hudud** (`GET /regions` select). Footer note: «Kredit limiti va to'lov muddatini ofis
  belgilaydi» — credit fields do not render for agents (server strips them; the form tells
  the truth instead of showing disabled inputs). `POST /clients` / `PUT /clients/:id`
  (client force-bound to own agent).
- A/B variant of the same sheet (desktop drawer) adds agent/credit/term fields — separate
  spec.

### 5.5 URL / keyboard / states

- `/clients?search&page`. `/` focus search, `N` new (≥768).
- Empty: «Hali mijoz yo'q — Yangi mijoz». Filtered-empty: «Topilmadi» + «Tozalash».
  Loading 8 skeleton cards; error per law.

### 5.6 Removed vs today — and why

| Removed (agent view) | Why |
|---|---|
| Kredit limiti column | Office-owned; visible as CreditGauge on detail. |
| Deactivate stop-icon | ADMIN-only today and stays so; agents never had it. |
| Icon-only edit button | Editing moved to the detail header («Tahrirlash» labeled) — icon-only controls are extinct. |
| Agent column | Own scope. |

---

## 6. `/clients/:id` — Mijoz kartasi (party page, mobile)

**Purpose:** the archetypal party page (`03` §4) for the person who knows this client by
face: the balance sentence, the paper trail, and the two actions that matter.

### 6.1 Layout

```
┌ ← Жамол Ургенч ──────────────────────────────────────┐  sticky: name+balance+1 action
│ Urganch · +998 91 234-56-78 📞 · muddat: 10 kun      │
│ Mijoz bizga qarz:                                    │
│ 12 450 000 so'm                    (money-hero 28px) │
│ ⬛ 12 dona   [2 ta muddati o'tgan · 8,4 mln]          │
│ ▓▓▓▓▓░░ Limit: 20 mln · Bo'sh: 7,55 mln              │
│ [ To'lov qabul qilish ]  [ Yangi buyurtma ]   ⋮      │
│ ‹ Hisob-kitob · Buyurtmalar · To'lovlar ›            │
│ ── Bugun · 7 kun · Shu oy · O'tgan oy · Oraliq… ──   │
│ ┌ Boshlang'ich qoldiq · 01.06.2026    [Qarz 8,2 mln]┐│
│ │ 08.07 Buyurtma savdosi · ORD-000214 → +4 500 000  ││
│ │       qoldiq: Qarz 12 700 000                     ││
│ │ 06.07 To'lov (Naqd) · KVT →       − 250 000  ●    ││  ← amber dot: Tekshirilmagan
│ │ …storno pairs chained, ghost rows 60%…            ││
│ ┌ Yakuniy qoldiq · 11.07.2026      [Qarz 12 450 000]┐│
├──────── tab bar (hech biri faol emas) ───────────────┤
```

### 6.2 Components & data

| Instance | Component | Data |
|---|---|---|
| Header | `PartyBalanceHeader` (§2.3) mobile | `GET /clients/:id`: name, active, region, phone (**tap-to-call** `tel:`), paymentTermDays, creditLimit, `balance` → semantic sentence («Mijoz bizga qarz: …» / «Mijoz avansi: …» / «0 so'm · Hisob yopiq»), `palletBalance` → PalletChip, CreditGauge; overdue chip from the cached debts row. Sticky-condensed: 48px name + balance + «To'lov qabul qilish». Inactive client: grey wash + «Nofaol» pill. |
| Tabs | `?tab=hisob|buyurtmalar|tolovlar` | default `hisob`. |
| Hisob-kitob | `PartyStatement` (§2.4) mobile: compact rows, 40% inset zebra, month sub-headers sticky | `GET /debts/statement?account=CLIENT&partyId=:id&from&to` → openingBalance, rows (date, source via `LEDGER_SOURCE` map + document link, note — imported Cyrillic notes as `ArtifactText`, signed MoneyCell, running balance), closing. Reversal pairs chained (gutter connector, «storno» chips, pair nets to zero); `reconciled:false` rows amber-dotted «Tekshirilmagan»; TRANSPORT_DIRECT rows render the double effect in words. `DateRangeControl` presets; empty period: «Bu davrda harakat yo'q» + opening=closing still rendered. |
| Buyurtmalar | AgentCard mini-list | `GET /orders?clientId=:id&page` server-paginated + **«Hammasini ko'rish →»** `/orders?clientId=` — the 20-row cap dies. |
| To'lovlar | payment mini-cards | `GET /payments?clientId=:id&page` + «Hammasini ko'rish →» `/payments?clientId=`. Voided ghosts included per tri-state. |

Taxalluslar and Maxsus narxlar tabs do **not** render for AGENT (alias/price endpoints are
A/B) — the special price still reaches the agent where it matters: the wizard's catalog price.

### 6.3 Actions

| Action | Where | Behavior |
|---|---|---|
| To'lov qabul qilish | header primary; `?panel=tolov`; `T` ≥768 | PaymentComposer full-screen, client locked, amount pre-filled with outstanding (§9) |
| Yangi buyurtma | header | `/orders/new?clientId=` (step 1 pre-bound) — blocked-limit states already visible on this very header |
| Akt sverki | header ⋮ overflow (`P` ≥768) | `/print/statement/client/:id?from&to` (current statement window carried over) — share as PDF via system sheet (§12) |
| Tahrirlash | header ⋮ | §5.4 sheet (agent fields) |
| Statement row document | row link | order → `/orders/:id`; payment → `/payments/:id` sheet |

### 6.4 URL / states / removed

- `/clients/:id?tab&from&to&panel=tolov`. Loading: skeleton of balance block + tab bar +
  6 statement rows. Errors regional.
- **Removed vs today:** duplicate raw signed «Qoldiq» numbers (→ semantic running balance),
  20-row capped tabs (→ pagination + full links), office-only tabs for agents (never worked
  — endpoints 403). **Added:** actions on the header (was: zero cross-links), tap-to-call,
  akt sverki, CreditGauge, URL-synced period.

---

## 7. `/debts` — Qarzlar (undiruv, own)

**Purpose:** the agent's collection round: who owes, how stale, who is due in the window —
and collect on the spot. Paddonlar (in-kind) folded in as a tab: the agent thinks «what does
my client owe» — money and pallets together (`03` §3).

### 7.1 Layout

```
│ ‹ Mijozlar · Paddonlar ›                 (?tab=)     │
│ Kutilayotgan tushum (7 kun): 18 400 000 so'm         │
│ [7 kun ▾]  [⌕ Qidiruv]  [Muddati o'tganlar ×]        │
│ ┌ Гофур Хазорасп                      8 300 000 ──┐  │  ← alarm-red (collections surface)
│ │ [2 ta muddati o'tgan · 6 200 000] · muddat 10 k │  │
│ │ ⬛ 6 dona · [muddati yaqin]                      │  │
│ │ [ To'lov qabul qilish ]              ⌄ ochish   │  │
│ │   ⌄ ORD-000101 · 05.07 · muddati 15.07 o'tgan   │  │
│ │     4 100 000 · ● Yetkazildi                    │  │
│ │     («oxirgi 20 buyurtma ichida» label)         │  │
│ │   [Mijoz kartasi]  [Akt sverki]                 │  │
│ └─────────────────────────────────────────────────┘  │
├──────── tab bar (Qarzlar faol) ──────────────────────┤
```

### 7.2 Mijozlar tab — components & data

- `GET /debts/clients?days&search&page` (own scope; rows pre-sorted worst-first server-side).
  Header figure: `expectedCollections` (server, full-window) + the `days` select (7/14/30)
  feeding it — the number explains itself: «muddati shu oynada kelgan mijozlarning qarzi».
- Debt card: `name`, **balance in alarm-red MoneyCell** (this is a collections surface —
  the one place red ink on client debt is law, `02` §2.4), `OverdueChip`
  «`overdueOrdersCount` ta · `overdueOrdersTotal`» **in the card, never a tooltip**,
  `PalletChip` (`palletBalance`), «muddat N kun» (`paymentTermDays`), «muddati yaqin» chip
  (`dueWithinWindow`), phone tap-to-call icon.
- **Expand** (⌄ / `→` ≥768): the client's open orders inline — `GET /orders?clientId=X&pageSize=20`,
  non-CANCELLED, dueDate shown, overdue dates in danger ink; honestly labeled «oxirgi 20
  buyurtma ichida» (§0.8d). Expansion also offers «Mijoz kartasi» and «Akt sverki».
- Per-card **«To'lov qabul qilish»** button (44px) → PaymentComposer pre-bound: client
  locked, **amount pre-filled with the balance rendered selected**, quick chips «To'liq
  qarz» · «Muddati o'tgani (6,2 mln)» (hero §2). On success the card re-renders via socket
  (pulse), the list keeps scroll position — next debtor is one flick away.
- Filter chip «Muddati o'tganlar» (`chip=overdue`) — client-side over the returned rows'
  server-computed `hasOverdueOrders` flag (honest: the flag is server truth).

### 7.3 Paddonlar tab

- In-kind balances of own clients: rows from `GET /pallets/balances` (agent-scoped; falls
  back to the `palletBalance` column of the debts payload if the balances endpoint returns
  the same shape — one source, stated in code review). Card: client name · «⬛ 18 dona»
  (amber; danger when negative) · tap → history sheet: `GET /pallets/transactions?clientId=`
  (date · type label · ±qty · order link), totals footer (net delta).
- **Read-only for agents** (returns/charges are A/B mutations): standing caption «Paddon
  qaytarishni ofis qayd etadi». In-kind never renders as money (locked rule) — no so'm
  appears on this tab.

### 7.4 URL / keyboard / states / removed

- `/debts?tab=mijozlar|paddonlar&days=7|14|30&chip&search&page`.
- ≥768: `T` = payment on cursor row, `→` expand, `/` search.
- Empty: «Qarzdor mijoz yo'q — barakalla» (+ green Toza strip mirrors cockpit). Filtered-
  empty per law. Loading skeletons; error regional.
- **Role variations:** A/B get 4 tabs + six drillable summary cards (`GET /debts/summary`);
  the agent variant renders **no summary cards** (endpoint is A/B — nothing fake) — the
  agent's aggregate is the cockpit «Mijozlarim qarzi» card.
- **Removed vs today:** overdue totals hidden in tooltips (→ in-card), the six office
  summary cards from the agent's view (they always 403'd server-side), region/agent columns.
  **Added:** per-card collect action, order-level expansion, window-fed forecast label,
  paddon tab (was a separate office page the agent could reach read-only).

---

## 8. `/payments` — To'lovlar (own CLIENT_IN)

**Purpose:** the agent's receipt log — verify «did my payment land», re-print a receipt,
answer a client's «men to'lagandim-ku». Not a tab (the tab bar carries the 5 highest-
frequency destinations); reached from: cockpit «Oyda yig'ilgan» card, client detail
To'lovlar tab, payment success «Yana to'lov», avatar/palette. Back arrow returns.

### 8.1 Layout

```
│ ← To'lovlar        [⌕]        [Filtrlar (1)]         │
│ Jami: 96 ta · sahifa jami: 12 450 000 so'm           │
│ ┌ 08.07.2026 · Жамол Ургенч        +4 500 000 so'm ┐ │
│ │ Naqd · ● Tekshirilmagan                          │ │
│ ┌ 06.07.2026 · Гофур Хазорасп      +2 000 000 ─────┐ │
│ │ USD · $160.00 × 12 500 = 2 000 000               │ │
│ ┌ 01.07 (ghost) · …                ~~500 000~~     │ │
│ │ Bekor qilingan: «xato summa»                     │ │
│ [ Yana 20 tasini yuklash ]                           │
```

### 8.2 Components & data

- `GET /payments?method&clientId&dateFrom&dateTo&voided&reconciled&search&page` — server
  scopes AGENT to own-client CLIENT_IN regardless of params (verified). **No kind control
  renders** (it would be a lie of choice); the page subtitle states the scope: «Mijozlardan
  qabul qilingan to'lovlar».
- Filter sheet: **Mijoz** (PartySelect), **Usul** (Naqd/O'tkazma/Click/Terminal/Karta/USD),
  **Sana** (DateRangeControl), **Bekorlar** tri-state (yashirish/ko'rsatish/faqat →
  `voided`), **Tekshirilmagan** tri-state (`reconciled=false/true/—`).
- Card: date · client name · MoneyCell `in` (+ sign, green) · method chip · USD equation
  line when applicable (`usdAmount × rate = amount`) · amber dot «Tekshirilmagan» when
  `reconciled=false` · ghost treatment for voided (amount struck, reason chip).
- Header meta: count (server) + **«sahifa jami»** Σ (client-side over the page, honestly
  labeled — no server aggregate exists).

### 8.3 `/payments/:id` — payment peek (full-height bottom sheet)

URL-addressable (route param; deep links open list+sheet; `↑/↓` moves through rows ≥768).
Data `GET /payments/:id`:

- Descriptions: sana, usul (+ USD equation), summa, mijoz (link), kassa nomi, qabul qildi
  (createdBy), izoh, holat («Tekshirilmagan» amber / «Bekor qilingan» + reason + voidedBy).
- Allocations mini-table (order no → link, amount, active/voided) — **read-only** with the
  caption «Taqsimlashni buxgalter bajaradi» (locked: allocations are A/B).
- Ledger lines translated via `LEDGER_SOURCE` (raw enums never render).
- Footer: **«⎙ Kvitansiya»** → `/print/receipt/:paymentId` (§12; the route itself refuses
  voided payments with an explainer). No void button (A/B).

### 8.4 URL / keyboard / states / removed

- `/payments?method&clientId&from&to&voided&reconciled&search&page&peek`; `/payments/:id`
  canonical alias.
- ≥768: `Space` peek, `↑/↓` walk, `/` search, `N` new payment.
- Empty: «Hali to'lov yo'q — To'lov qabul qilish». States per law.
- **Removed vs today (agent):** kind select (locked scope made structural), factory filter
  (агент scope has no factories), void icon (A/B), the 961-line morphing modal (→ §9
  composer), eye-icon drawer (→ URL-addressable sheet: deep links finally work).

---

## 9. To'lov qabul qilish — mobile PaymentComposer (AGENT variant)

**Purpose:** hero §2.1 — money taken in the field in under 15 seconds, receipt in hand.
`PaymentComposer` (§3.3) as a **full-screen sheet**; kind fixed CLIENT_IN (never a chooser).

### 9.1 Layout & fields

```
┌ ✕ To'lov qabul qilish ───────────────────────────────┐
│ Mijoz:  [Жамол Ургенч  ✕]   [Qarz 12 450 000]        │
│ Summa (so'm):                                        │
│ ┌──────────────────────────────┐                     │
│ │ 12 450 000                   │  ← selected, keypad │
│ └──────────────────────────────┘                     │
│ [To'liq qarz] [Muddati o'tgani (6,2 mln)]            │
│ Usul: (Naqd) O'tkazma  Click  Terminal  Karta  USD   │
│ Kassa: Naqd kassa (avto)                             │
│ Sana: 11.07.2026 ▾      Izoh: [__________]           │
│ ⓘ Taqsimlashni buxgalter bajaradi                    │
│ [       Qabul qilish — 12 450 000 so'm       ] 48px  │
└──────────────────────────────────────────────────────┘
```

| Field | Behavior | Data |
|---|---|---|
| Mijoz | `PartySelect` own clients; **locked** (with ✕) when launched from client/debt/order context; BalanceTag always visible, refetched on open (stale-balance law) | `GET /clients?search=` / `GET /clients/:id` |
| Summa | `MoneyInput`, `inputmode="numeric"`, space-grouped live; **pre-filled with outstanding, rendered selected** — first keystroke replaces (partials are normal); quick chips «To'liq qarz» / «Muddati o'tgani (X)» | balance from client payload; overdue Σ from debts row |
| Usul | chip row; defaults to the client's last-used (from the client's payments cache, else Naqd) | — |
| Kassa | auto-picked to the method's currency; agent variant shows **name + currency only, no balance** (§0.8a); switchable if several match | `GET /kassa/cashboxes` (verify §0.8a) |
| USD | method=USD swaps in `usdAmount` + `rate` (pre-filled from the agent's last USD payment) with the read-only equation «$160.00 × 12 500 = 2 000 000 so'm» — UZS computed server-side | — |
| Sana / Izoh | default today; optional note | — |

- **No allocation section** (locked: A/B only) — the fixed info line replaces it; the
  payment lands in the accountant's «Taqsimlanmagan to'lovlar» queue automatically.
- Fresh idempotency key per open; submit self-disables «Qabul qilinmoqda…» — a double tap
  can never post twice. Draft persists (sessionStorage) through an interruption.

### 9.2 Success state

Big check (the only celebratory moment, still no motion on numbers) + «4 500 000 so'm qabul
qilindi» + delta line **«Yangi balans: Qarz 7 950 000»** (from the response/refetch) +
buttons: **«⎙ Kvitansiya»** (→ `/print/receipt/:id`, system print/share sheet) · «Yana
to'lov» (same client cleared, composer stays) · «Yopish». Behind the sheet the debt card has
already pulsed via socket.

### 9.3 Errors / states

- Server rejections verbatim inline under the mapped field (cashbox/method mismatch, scope).
- Offline: submit disabled with the amber banner — money is never queued client-side.
- Entry points recap: ➕ sheet · client header · client `?panel=tolov` · debt card button ·
  order Moliya card · palette record-scoped action.

---

## 10. `/me` — Mening ko'rsatkichlarim

**Purpose:** the agent's own standing — the limit that gates his livelihood, his numbers,
his portfolio. Fixes the «agent learns his limit from an error» pain (brief: high).

### 10.1 Layout & data

```
│ ← Mening ko'rsatkichlarim                            │
│ ┌ Qarz limiti (HeadroomMeter hero) ─────────────────┐│
│ │ ▓▓▓▓▓▓▓░░░ 71% band                               ││
│ │ Limit: 20 000 000 · Band: 14 200 000              ││
│ │ Bo'sh: 5 800 000 so'm                             ││
│ │ (yoki «Cheklanmagan» / «0 — yangi buyurtma        ││
│ │  bloklanadi» danger)                              ││
│ ┌ Shu oy ───────────────────────────────────────────┐│
│ │ Savdo · Yig'ilgan · Hajm m³ · Foyda (taxminiy)    ││
│ ┌ Umumiy (boshidan) ─────────────────────────────────┐
│ │ Buyurtmalar: 214 · Savdo: 1,2 mlrd (1 249 547 319)││
│ │ Yig'ilgan · Ochiq qarz · Paddonlar                ││
│ ┌ Mijozlarim (17) ──────────────────────────────────┐│
│ │ Жамол Ургенч   [Qarz 4 200 000]  [To'lov] [→]     ││
│ │ …                                                 ││
```

| Block | Data |
|---|---|
| HeadroomMeter | `GET /agents/me`: `outstandingDebt`, `debtLimit`, `ownDebtLimit` («shaxsiy limit» vs «umumiy sozlama» stated in a caption when ownDebtLimit=null) |
| Shu oy | `GET /dashboard/summary` (scoped): monthSales, collectedThisMonth, cubeSoldMonth, goodsProfitMonth. Month-picker does **not** render — the ranking endpoint is A/B; caption «boshqa oylar ofis hisobotida» (honesty over a dead control). |
| Umumiy | `GET /agents/:id` (own id from JWT): `kpi.ordersCount/saleTotal/goodsProfit/collected/outstandingDebt/palletExposure` — fmtShort + permanent exact caption |
| Mijozlarim | same payload `clients[]` with balances: BalanceTag rows, per-row «To'lov» (composer pre-bound) + link to `/clients/:id` |

Entry: cockpit limit card, avatar menu. URL: none beyond the route. States per law; the
whole page is the G-only route (`03` §4); A/B see `/agents/:id` instead.

**Removed vs today:** nothing — this page did not exist (the API did). It is pure gap-fill.

---

## 11. `/profile` — Profil

**Purpose:** self-service identity. Shared page (all roles) — agent notes only.

- One **editable** card (the duplicate read-only block dies): Ism, Login, **Email**
  (exposed at last), Telefon → `PUT /auth/me`; role renders as `RolePill` «Agent» (raw enums
  never). Second card: password change (min 8, twice) with the note «boshqa qurilmalardagi
  sessiyalar tugatiladi» — the returned fresh token adopted silently.
- Mobile: two stacked cards, 48px save buttons; theme toggle lives in the TopBar avatar
  menu. Bound agent record shown read-only («Agent: Жамол — biriktirish ofis tomonidan»).
- States: inline per-field errors verbatim (username taken); success toast «Saqlandi».
- **Removed vs today:** the duplicated Descriptions block (redundancy), nothing else.

---

## 12. Printing from a phone (G-scope print routes)

All four documents are chrome-free `/print/*` routes rendering `PrintDocument` (§4.7); on
mobile the sticky toolbar's «Chop etish» invokes the system print/share sheet → AirPrint/
PDF → WhatsApp (the real-world delivery channel). Copies/dealer-entity selectors persist.

| Doc | Route | Agent entry points | Guard |
|---|---|---|---|
| Yuk xati | `/print/waybill/:orderId` | order detail «Chop etish ▾»; LOADING toast | own orders only; **no prices** (locked: driver carries no money data) |
| Hisob-faktura | `/print/invoice/:orderId` | order detail «Chop etish ▾» | own orders; JAMI = saleTotal + transportCharge; Narxlanmagan rows «narx kelishilmoqda», excluded from totals |
| Kvitansiya | `/print/receipt/:paymentId` | composer success; payment sheet | voided → explainer instead of the document |
| Akt sverki | `/print/statement/client/:id?from&to` | client header ⋮; debts expansion | own clients; unreconciled rows marked «tekshirilmagan»; paddon annex «pulga kirmaydi» |

---

## 13. Locked-rule traceability (rule → where the agent SEES it)

| Locked rule | Visible handling |
|---|---|
| Debt at order creation (incl. transportCharge) | Wizard summary bar «qarzga yoziladi»; step 4 postings block; order Moliya «Jami yozilgan qarz = savdo + transport» |
| Client creditLimit (null/0 semantics) | CreditGauge states on client header, wizard step 1, debt cards; «Faqat oldindan to'lov» at 0; server figures verbatim on rejection |
| Agent debtLimit gate (Σ positive balances) | Cockpit + `/me` HeadroomMeter; ➕ sheet caption; wizard step 1 banner + disabled submit at cap |
| AGENT price floor (never disclosed) | Enforced at submit via verbatim server error; no cost number shown or clamped (FACTORY_BANK stripped from agent payload — locked rule) |
| One order = one factory | Catalog lock chip + explicit escape |
| Capacity ≤ vehicle/19 | CapacityMeter re-based per truck; submit blocked with exact overflow |
| intendedPaymentMethod fixes provisional cost | Step 1 caption «taxminiy tannarx shu narxda hisoblanadi» |
| AGENT status = exactly +1; vehicle required at LOADING | One verb button; blocker chip «ofis biriktiradi» (no fake fix action) |
| Soft-cancel only, office-only | No cancel anywhere for agents; cancelled = danger banner + chained storno pairs netting zero |
| Pallets in-kind, never money | PalletChip everywhere adjacent to (never inside) money; Paddonlar tab so'm-free; waybill/akt annexes «pulga kirmaydi» |
| CLIENT_IN only, own clients | Composer has no kind chooser; payments page states its scope |
| Allocations/void = A/B | Read-only allocation table + «Taqsimlashni buxgalter bajaradi»; no void controls |
| TRANSPORT_DIRECT double effect | Statement rows render both consequences in words |
| |balance| < 1 ⇒ settled | «0 so'm · Hisob yopiq» chip everywhere |
| reconciled=false history | Amber «Tekshirilmagan» dots on payment cards, sheets, statement rows, akt sverki |
| Balances never stored / server is the calculator | All previews «taxminiy — server tasdiqlaydi»; no optimistic money; refetch-on-open in composers |
| Idempotent money submits | Key per composer open; self-disabling verbs |
| Attribution snapshot | Agent name on orders/payments shown as historical fact, never editable |

---

## 14. Consolidated removed-features audit (agent surface)

Everything the agent can do today survives. The only *removals* are controls that were
lies for this role (403-backed or server-stripped), replaced with honest structure:

1. Payments kind select / factory filter / void / allocation editor → scope-fixed UI +
   read-only allocations + captions (server always enforced this).
2. Debts summary cards → never loaded for agents (A/B endpoint); replaced by cockpit KPI.
3. Client credit/term/agent form fields → removed for agents (server strips them silently);
   caption states who owns them.
4. Clients list agent/region filters → hidden until the API filters (never fake).
5. Narxsiz pricing mode → A/B only, structurally absent from the agent wizard.
6. Tables below 768px, icon-only buttons, tooltip-only money, static LIVE tag, duplicate
   expectedCollections card, duplicate Izohlar tab, read-only+form Profile duplication —
   all per design law, with their information preserved elsewhere on the same screen.
