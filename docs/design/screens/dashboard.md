# Screen Spec — `/` Dashboard: Ish stoli · Agent kokpiti · Kassa terminali

**Status:** implementation-ready. Binding parents: `02-design-language.md` (tokens, money
semantics, platform state law §9), `03-shell-and-ia.md` (§1 shell, §4 route table, §6 worklist
taxonomy, §7 URL contract, §8 keys, §11 responsive), `04-components.md` (all component
anatomies referenced by name), `05-hero-workflows.md` (§5 owner's morning check is the
acceptance script for §1 below). Nothing here invents a component or a color; everything is
an instance.

`/` renders one of three role cockpits, dispatched from the JWT role via `PERMISSIONS`
(`lib/permissions.ts`) — there is no role switcher:

| Role | Variant | Section |
|---|---|---|
| ADMIN, ACCOUNTANT | **Ish stoli** (global cockpit) | §1 |
| AGENT | **Agent kokpiti** (own-scope, phone-first) | §2 |
| CASHIER | **Kassa terminali** | §3 |

All money renders via `MoneyCell`/`fmtMoney` — full-precision space-grouped so'm on desktop,
`fmtShort` only on chart axes and AGENT-mobile primary values (with the full value as a
permanent secondary caption). Numbers never animate (02 §5). All day/month windows are
Tashkent-calendar (server-side; the UI states it once, §1.6).

**Realtime (all three variants):** socket `change` events invalidate the `['dashboard', …]`
and `['worklist', …]` key families, coalesced in the 2s window (`lib/realtime.ts` contract).
Refetch shows the 2px hairline under the PageHeader; values swap without animation. Socket
state lives in the TopBar `LiveBadge` (never a decorative tag); while offline every KpiBand
label gains the «14:32 holatiga» suffix and `refetchOnWindowFocus` turns on. The old
hardcoded green «● LIVE» Tag is dead.

---

## §1. ADMIN / ACCOUNTANT — «Ish stoli»

### 1.1 Purpose

The owner's and accountant's first screen of the day: (1) a finite to-do list of money
anomalies that can reach zero (InboxRail), (2) the company's vital signs grouped by question
— nima sotdik / nima ishladik / kim kimga qarz (KpiBands), (3) cash on hand (kassa strip),
(4) the trend picture and agent race. Every number is a door: KPI → filtered register,
queue → chip'd register, chart point → that day's orders, ranking row → agent card.

### 1.2 Layout

Content column max 1440px, 24px padding, 20px between regions. Region order is fixed
(severity before vanity): InboxRail → KpiBands → Kassa strip → chart + ranking.

```
┌ PageHeader ─────────────────────────────────────────────────────────────────┐
│ Ish stoli                                                     (2px hairline)│
├ A. InboxRail «E'tibor kerak» — 2-col masonry ───────────────────────────────┤
│ ┌ Muddati o'tgan qarzlar  4 · 21 400 000 ┐ ┌ Tekshirilmagan to'lovlar 12 ┐  │
│ │  Гофур Хазорасп · 8 300 000 · 12 kun   │ │  … top-3 preview rows       │  │
│ │  …(top-3)              Hammasi →       │ │              Hammasi →      │  │
│ └────────────────────────────────────────┘ └─────────────────────────────┘  │
│ ┌ Taqsimlanmagan 3 ┐ ┌ Narxlanmagan 1 ┐ ┌ Moshina biriktirilmagan 1 ┐ …    │
│ ├──────────────────────────────────────────────────────────────────────┤   │
│ │ ✓ Toza: Tannarx qotirilmagan · Shofyorlarga qarz · Limit chegarasida │   │
├ B. KpiBand SAVDO ────────────────────────────────────────────────────────────┤
│ [Oy savdosi (hero)]  [Bugungi savdo]  [Oyda yig'ilgan to'lov]                │
│ [Yil savdosi] [Sotilgan hajm (oy)] [Yo'ldagi buyurtmalar]   (compact row)    │
├ B. KpiBand FOYDA ────────────────────────────────────────────────────────────┤
│ [Mahsulot foydasi (oy) «taxminiy»]   [Transport foydasi (oy)]                │
├ B. KpiBand QARZLAR ──────────────────────────────────────────────────────────┤
│ [Mijozlar qarzi] [Zavodlarga qarzimiz] [Shofyorlarga qarzimiz]               │
│ [Bonus hamyonlar] [Mijozlardagi paddonlar]                  (compact row)    │
├ C. Kassa strip ──────────────────────────────────────────────────────────────┤
│ UZS jami: 18 250 000 so'm · USD jami: $4 120.00 │ [Naqd kassa 12 450 000] …  │
├ D. Chart ──────────────────────────────┬ E. Agentlar reytingi ───────────────┤
│ Savdo va tushum   [7·30·90·365 kun]    │  ‹ 2026-07 ›   To'liq reyting →    │
│ Σ savdo … · Σ tushum … · N buyurtma    │  Agent | Savdo | Yig'ilgan | …     │
│ (2 lines + order-count bars, 300px)    │  (compact rows → /agents/:id)      │
└────────────────────────────────────────┴────────────────────────────────────┘
```

### 1.3 Region A — `InboxRail` («E'tibor kerak»)

`InboxRail` + `WorklistCard` instances exactly per 03 §6 (order fixed by severity, never
user-configurable; zero-count cards collapse into the single green «Toza ✓» strip). Queries
are shared with the SideNav badges (same `['worklist', <queue>]` keys — one fetch feeds
both). Card anatomy per 04 §3.4: overline title + live count (+ Σ where money-shaped) +
top-3 preview rows + «Hammasi →». Client-derived queues print their window on the card
footer («oyna: joriy oy»).

| # | Card title | Severity | Data (exact) | Count / Σ | Preview row (top-3) | «Hammasi →» drill |
|---|---|---|---|---|---|---|
| 1 | Muddati o'tgan qarzlar | danger | `GET /debts/clients?days=7&pageSize=100` → rows with `hasOverdueOrders=true` | count of rows; Σ `overdueOrdersTotal` | `name` · `overdueOrdersTotal` (`MoneyCell owedToUs`) → `/clients/:id` | `/debts?tab=mijozlar&chip=overdue` |
| 2 | Tekshirilmagan to'lovlar | violet | `GET /payments?reconciled=false&pageSize=3` → paged `total` (server filter) | `total`; Σ only if payload aggregates (else count-only — never «sahifa jami» posing as whole) | date · client · `amount` → `/payments/:id` | `/payments?reconciled=false` |
| 3 | Transport aniqlanmagan | violet | `GET /orders?from=<oy boshi>&to=<bugun>&pageSize=100`, client-filter `transportPaidStatus='UNKNOWN'` | count; Σ `transportCost` | orderNo · plate · `transportCost` → `/orders/:id` | `/orders?chip=transport-unknown` (window selector on register) |
| 4 | Taqsimlanmagan to'lovlar | warning | payments where Σ active allocations < `amount` (allocatable kinds, non-voided) — from list payload allocations if present, else lazy per-row over the labeled window (03 §10c) | count; Σ open remainder | date · party · qoldiq → `/payments/:id?panel=taqsimlash` | `/payments?chip=alloc-open` |
| 5 | Narxlanmagan buyurtmalar | warning | non-cancelled orders with `pricePending` items, month window — **verify note §5.a** (list payload lacks the flag today) | count | orderNo · client · «Narxlanmagan» chip → `/orders/:id` | `/orders?chip=unpriced` |
| 6 | Moshina biriktirilmagan | warning | `GET /orders?status=CONFIRMED&pageSize=100`, client-filter `vehicleId=null` | count | orderNo · client · date → `/orders/:id` (StatusFlow «Biriktirish») | `/orders?status=CONFIRMED&chip=novehicle` |
| 7 | Tannarx qotirilmagan (>7 kun) | warning | `GET /orders?status=COMPLETED&from=<oyna>&pageSize=100`, client-filter `costStatus≠'FINAL'` and `date` older than 7 days | count; Σ `costTotal` («taxminiy») | orderNo · factory · `costTotal` → `/orders/:id` | `/orders?status=COMPLETED&chip=cost-open` |
| 8 | Shofyorlarga qarz | warning | `GET /vehicles` list payload → rows with negative balance | count; Σ negated balances | name+plate · `BalanceTag Qarzimiz` → `/vehicles/:id` | `/vehicles?chip=owed` |
| 9 | Limit chegarasida | neutral | queue-1 payload reuse: rows where `creditLimit≠null` and `balance ≥ 0.8×creditLimit` | count | name · `CreditGauge` mini · balance → `/clients/:id` | `/clients?chip=near-limit` |
| 10 | Yo'ldagi buyurtmalar | neutral (info) | 3 parallel `GET /orders?status=CONFIRMED|LOADING|DELIVERING&pageSize=100`, merged | count (= summary `ordersInFlight` cross-check); Σ `saleTotal` labeled «sahifa jami» if any query capped | orderNo · client · `StatusChip` → `/orders/:id` | `/orders?chip=inflight` |

Counts are `aria-live="polite"`. Preview rows are real links (middle-click works). If a
queue's fetch errors, that card alone renders `ErrorState`-inline (title + «Qayta urinish»);
the rail never blocks the page.

### 1.4 Region B — `KpiBand` × 3 (`StatCard` instances)

All values from **`GET /dashboard/summary`** (react-query key `['dashboard','summary']`).
Deltas and sparklines derive from a fixed background **`GET /dashboard/trends?days=62`**
(`['dashboard','trends',62]`) — exact server day-buckets, no estimation: «bugun vs kecha» =
yesterday's bucket; «oy vs o'tgan oy» = Σ month-to-date buckets vs Σ the previous month's
first same-N-days. If the 62-day query fails, cards render without delta/sparkline (deltas
are decoration; the value never blocks). Balances (QARZLAR) have **no deltas and no
sparklines** — the ledger has no balance history endpoint and we do not fabricate one.
`DeltaTag` color follows business goodness (sales ↑ green; a debt delta would be red — n/a
here). Every card: whole card is a link, «→» affordance, info tooltip carrying its exact
definition (listed below — these sentences surface the locked rules).

**SAVDO** (band overline «Savdo»):

| Card | Field | Style | Delta / sparkline | Drill | Definition tooltip |
|---|---|---|---|---|---|
| Oy savdosi (hero) | `monthSales` | `money-hero` 28px — the page's largest text | `DeltaTag` «o'tgan oyning shu davriga nisbatan» + 32px `Sparkline` (62-kun `sales`) | `/orders?from=<oy boshi>&to=<bugun>` | «Bekor qilinmagan buyurtmalar savdosi, Toshkent oyi» |
| Bugungi savdo | `todaySales` | `money-lg` | `DeltaTag` «kechaga nisbatan» | `/orders?from=<bugun>&to=<bugun>` | «Bugungi (Toshkent kuni) buyurtmalar savdosi» |
| Oyda yig'ilgan to'lov | `collectedThisMonth` | `money-lg`, `moneyIn` ink | `DeltaTag` + `Sparkline` (`collected`) | `/payments?kind=client_in&from=<oy boshi>&to=<bugun>` | «Faqat CLIENT_IN, bekor qilinmagan to'lovlar» |
| Yil savdosi | `yearSales` | compact stat | — | `/orders?from=<yil boshi>&to=<bugun>` | — |
| Sotilgan hajm (oy) | `cubeSoldMonth` | compact stat, `fmtM3` 3dp «m³» | — | `/orders?from=<oy boshi>&to=<bugun>` (register totals row shows Σ m³) | — |
| Yo'ldagi buyurtmalar | `ordersInFlight` | compact stat, count «ta» | — | `/orders?chip=inflight` | «CONFIRMED + LOADING + DELIVERING» — **rendered for the first time** (today: fetched, never shown) |

**FOYDA** (band overline «Foyda» — two cards, **never merged**, per the owner's 3-mode
transport rule):

| Card | Field | Style | Extras | Drill |
|---|---|---|---|---|
| Mahsulot foydasi (oy) | `goodsProfitMonth` | `money-lg`, sign-colored (`moneyIn` / negative `moneyOwedToUs`) | amber chip **«taxminiy — N ta tannarx ochiq»** while the month window contains `costStatus≠FINAL` orders (N from the queue-3/7 shared scan; plain «taxminiy» if the scan is unavailable) | `/reports?tab=svod&from=<oy boshi>&to=<bugun>` |
| Transport foydasi (oy) | `transportProfitMonth` | `money-lg`, sign-colored | caption «mahsulot foydasidan alohida» | `/reports?tab=reestr&preset=logistika&from=<oy boshi>&to=<bugun>` (hero flow §5.2 anomaly path) |

**QARZLAR** (band overline «Qarzlar» — no deltas/sparklines, see above):

| Card | Field | Style | Drill | Definition tooltip |
|---|---|---|---|---|
| Mijozlar qarzi | `clientsOweUs` | `money-lg` (neutral ink here — alarm red only on collections surfaces per 02 §2.4) | `/debts?tab=mijozlar` | «Faqat musbat qoldiqlar yig'indisi — bir mijozning avansi boshqasining qarzini yopmaydi» |
| Zavodlarga qarzimiz | `weOweFactories` | `money-lg`, `moneyWeOwe` ink | `/debts?tab=zavodlar` | «Faqat manfiy zavod qoldiqlari, musbat qilib ko'rsatilgan» |
| Shofyorlarga qarzimiz | `weOweVehicles` | `money-lg`, `moneyWeOwe` ink | `/debts?tab=shofyorlar` | **rendered for the first time** (today: fetched, never shown) |
| Bonus hamyonlar | `bonusWallets` | compact stat | `/bonus` | — |
| Mijozlardagi paddonlar | `palletsAtClients` | compact stat, integer «dona», styled via `PalletChip` glyph — adjacent to, never mixed with money | `/debts?tab=paddonlar` | «Naturadagi qarz — pulga kirmaydi» |

**Killed on purpose:** the «Kutilayotgan tushum» card. `expectedCollections` is a
byte-for-byte duplicate of `clientsOweUs` (dashboard.service.ts returns the same variable) —
two cards with one number erode trust. The *real* windowed figure («Kutilayotgan tushum
(7/14/30 kun)») lives where it is actionable: the `/debts` header, fed by
`GET /debts/clients?days=` which computes it properly. The summary field stays unrendered.

### 1.5 Region C — Kassa strip

One slim full-width card (no Card-in-Card), data **`GET /dashboard/kassa`**
(`['dashboard','kassa']`; role-guarded ADMIN/ACCOUNTANT/CASHIER).

- Leading: per-currency grand totals — «UZS jami: 18 250 000 so'm» · «USD jami: $4 120.00»
  (Σ `balance` of active boxes grouped by `currency`; **UZS and USD are never merged**).
- Then one chip per box: `name` + `MoneyCell` `balance` (negative → `moneyOwedToUs` ink +
  word «kamomad» — cashbox shortfall is the one red outflow context) + small «↑ `todayIn` ·
  chiqim `todayOut`» line. **Chiqim renders in neutral `colorText`** — spending is not an
  error (02 §2.4).
- Each chip links to `/kassa?cashboxId=<id>`; the strip header carries «Kassa →» (`/kassa`).

### 1.6 Region D — Trends chart («Savdo va tushum»)

Card with `DateRangeControl`-variant Segmented **«7 kun · 30 kun · 90 kun · 1 yil»** writing
**`/?days=7|30|90|365`** (default 30). Data **`GET /dashboard/trends?days=<days>`**
(`['dashboard','trends',days]`, `keepPreviousData`).

- **Series (02 §2.6):** line `Savdo` (`sales`) `#1F6F9E`/dark `#5CA3CF`; line `Tushum`
  (`collected`) `#B47A00`/dark `#D9A94A`; bar layer `Buyurtmalar soni` (`orders`)
  `#94A3B8 @ 60%` on a right integer axis — the per-day order count is finally used
  (today it is fetched and thrown away). Direct end-labels on both lines (no legend-only
  encoding). Height 300px fixed (no layout jump).
- **Header meta (exact, from the payload):** «Σ savdo 412 300 000 · Σ tushum 388 150 000 ·
  96 buyurtma». Axis labels `fmtShort` (its only desktop home); tooltip shows all three
  values in full `fmtMoney` + date `DD.MM.YYYY`.
- **Point/bar click → `/orders?from=<D>&to=<D>`** (that day's register). Cursor pointer on
  plot points only.
- Footer microcopy (once for the whole page): «Barcha davrlar Toshkent taqvimi bo'yicha».
- Chart animates only its first 200ms draw; range switches and refetches swap data
  instantly.

### 1.7 Region E — Agentlar reytingi (compact)

Card, data **`GET /dashboard/agents-ranking?month=<YYYY-MM>`**
(`['dashboard','ranking',month]`). Header: `‹` `›` month stepper + month label opening an
AntD month-picker popover — writes **`/?month=YYYY-MM`** (default: current Tashkent month;
future months disabled). The `?month` API param is finally wired (today the UI is locked to
the current month). Header link: **«To'liq reyting →»** `/reports?tab=reyting&month=<oy>`
(MoM deltas and export live there).

`DataTable` (compact, no pagination — agent count is small; server-sorted by `sales` desc,
sort headers disabled-with-tooltip per 02 §6):

| Column | Field | Notes |
|---|---|---|
| Agent | `agent` | link → `/agents/:id` (whole row clickable) |
| Savdo (so'm) | `sales` | month figure |
| Mahsulot foydasi (so'm) | `goodsProfit` | signed, sign-colored |
| Yig'ilgan (so'm) | `collected` | month figure |
| Qarzdorlik — **hozirgi qoldiq** (so'm) | `outstandingDebt` | header carries the qualifier + tooltip «tanlangan oydan qat'i nazar, bugungi holat» — the mixed-timeframe trap named in place (locked rule: as-of-now, positive balances only) |
| Buyurtmalar | `orders` | count |

### 1.8 Actions (complete inventory)

| Action | Where | Result |
|---|---|---|
| Open queue record | WorklistCard preview row | record page / peek (`/orders/:id`, `/payments/:id`, `/clients/:id`, `/vehicles/:id`) |
| Drill queue | WorklistCard header / «Hammasi →» | chip'd register URL (table §1.3) |
| Drill KPI | any StatCard (whole card) | filtered register (tables §1.4) |
| Change chart range | Segmented in chart header | `?days=` rewrite + refetch |
| Open a day | chart point/bar click | `/orders?from=D&to=D` |
| Change ranking month | `‹ ›` stepper / month popover | `?month=` rewrite + refetch |
| Open agent | ranking row | `/agents/:id` |
| Full ranking | «To'liq reyting →» | `/reports?tab=reyting&month=` |
| Open cashbox | kassa strip chip | `/kassa?cashboxId=` |
| Global creates | Ctrl+K palette («Yangi buyurtma», «To'lov qabul qilish», …) | composers per 03 §2 — the cockpit itself carries no create buttons; queues and the palette are the doors |

### 1.9 Filters & URL params

`/?days=7|30|90|365&month=YYYY-MM` — both optional, both restored by back/forward via
`useUrlFilters` (extends the 03 §7 table for `/` with `month`, mirroring `/reports`).
Invalid values fall back to defaults silently (no FilterBar on this page to show a red
token). Every drill URL above is itself a shareable filter state.

### 1.10 Keyboard

Global chords per 03 §8 (`Ctrl+K`, `G`+`D/O/M/T/Q/K`, `[`, `?`, `Esc`). Page-specific:
roving `Tab`/`Shift+Tab` (and `←→↑↓`) across WorklistCards → StatCards → strip chips →
ranking rows; `Enter` opens the focused card's drill; preview rows are plain links in tab
order. Chart Segmented: `←→` (AntD native). No `N`/`/` here — the cockpit is not a register.
Every focus is ringed (02 §10).

### 1.11 States (per 02 §9 — acceptance criteria)

| State | Treatment |
|---|---|
| First load | Full-layout skeleton: 4 skeleton WorklistCards, skeleton StatCards (label bar + value bar), 300px chart block, 5 skeleton ranking rows. Header intact, zero layout jump. Never a page spinner. |
| Refetch (socket/range/month) | 2px hairline under PageHeader; existing values stay (`keepPreviousData`); no spinners over data; numbers swap without animation. |
| Region error | `ErrorState` replaces only the failed region (Uzbek line + server text verbatim + «Qayta urinish»); the other regions live. A failed StatCard renders an em-dash value + retry glyph. |
| Delta source (62-kun trends) error | cards silently render without delta/sparkline. |
| Empty queues | zero-count cards collapse into the green «Toza ✓» strip listing their titles — a clean day is visibly clean. |
| Empty ranking | `EmptyState` «Bu oyda ma'lumot yo'q». |
| Empty kassa strip | «Faol kassalar topilmadi» + «Kassa →». |
| Zero-history chart | zero-filled series still draw (server zero-fills) — a flat line is information. |
| Offline | LiveBadge grey; every band label suffixed «HH:mm holatiga»; `refetchOnWindowFocus` on. |
| 403 (deep link by wrong role) | route-level Result 403 + «Bosh sahifaga qaytish». |

### 1.12 Responsive (03 §11)

| Range | Behavior |
|---|---|
| ≥1600 | as sketched: rail 2-col masonry; hero cards 3-up; chart 2/3 + ranking 1/3 side by side |
| 1200–1599 | chart and ranking stack full-width; compact stats 3-up |
| 1024–1199 | hero cards 2-up; kassa strip chips wrap to 2 rows |
| 768–1023 | single column everywhere; rail single-col; ranking becomes 2-line rows (agent+orders / money) |
| <768 (desk role on a phone — read-and-approve) | single column, order preserved (queues first); StatCards keep **full-precision** values (desk roles never get fmtShort primaries); horizontal scroll only inside the ranking table's own container |

### 1.13 Removed vs today (Dashboard.tsx `MainDashboard`) — and why

| Today | Fate | Why |
|---|---|---|
| Static green «● LIVE» Tag | → TopBar `LiveBadge` (real state + last-refresh) | it lied when the socket dropped |
| «Kutilayotgan tushum» card | **dead**; windowed truth on `/debts` header | byte-duplicate of «Mijozlar qarzi» |
| `fmtShort` card values + exact value in hover Tooltip | full precision always; fmtShort only chart axes | touch-hostile; 1,15 vs 1,24 mlrd both read «1.2 mlrd» |
| Flat 12-card wall, no hierarchy | 3 labeled KpiBands with heroes/compacts | grouping by business question; profits/debts separated |
| Dead-end cards (no links, no deltas, no sparklines) | every card a door + deltas + sparklines | «a KPI you cannot act on is a decoration» |
| Chart locked to 30 days; `orders` field discarded | `?days=` switcher + order-count bar layer + header totals | API supported it all along |
| Ranking locked to current month, rows inert, full table on the cockpit | compact card + `?month=` stepper + row links; full table at `/reports?tab=reyting` | past months unreachable; cockpit stays scannable |
| «Qarzdorlik» column unqualified | «hozirgi qoldiq» in the header | mixed timeframes must say so |
| Missing: ordersInFlight, weOweVehicles | rendered (SAVDO compact / QARZLAR card) | fetched-but-invisible KPIs |
| Missing: worklists, kassa visibility | InboxRail + kassa strip | the cockpit's actual job |
| Per-section `Alert` + retry | shared `ErrorState`/skeleton law | one platform behavior |

Nothing else existed on this page; nothing is lost.

---

## §2. AGENT — Agent kokpiti

### 2.1 Purpose

A field salesperson on a phone answers three questions in ten seconds: **can I sell more
(limit headroom), who must pay today, how am I doing this month.** Everything is
server-scoped to `agentId` — the UI never relies on client-side hiding (locked rule); the
`summary.scope==='agent'` field is asserted in dev builds.

### 2.2 Layout (phone-first; desktop is the same column, max 720px, centered)

```
┌ PageHeader: Ish stoli ───────────────────────────┐
│ A. Limit card (hero)                             │
│  Qarz limiti            Mening ko'rsatkichlarim →│
│  ▓▓▓▓▓▓▓▓░░░░  71%                               │
│  Limit: 20 000 000 · Band: 14 200 000 ·          │
│  Bo'sh: 5 800 000 so'm                           │
├ B. Own queues (single-col InboxRail) ────────────┤
│  ┌ Muddati o'tgan qarzlar 2 · 6 200 000 ┐        │
│  ┌ Muddati kelganlar (7 kun) 3 ┐                 │
│  ┌ Yo'ldagi buyurtmalarim 4 ┐                    │
├ C. KPI cards (own scope) ────────────────────────┤
│  [Oy savdosi]  [Bugungi savdo]                   │
│  [Yig'ilgan (oy)] [Mijozlarim qarzi]             │
│  [Hajm (oy)] [Paddonlar] [Yil savdosi]           │
│  [Mahsulot foydasi (oy)] [Transport foydasi (oy)]│
├ D. 14 kunlik trend (mini chart) ─────────────────┤
│  Savdo / Tushum · Σ captions                     │
└──────────────────────────────────────────────────┘
│ [Ish stoli] [Buyurtmalar] (➕) [Mijozlar] [Qarzlar]│  ← bottom tab bar <768px
```

### 2.3 Region A — Limit card (`CreditGauge` agent variant, 04 §2.7)

Data **`GET /agents/me`** (`['agent','me']`; AGENT-only route — its first UI): fields
`outstandingDebt`, `debtLimit` (effective = own ?? default), `ownDebtLimit`, `clientCount`,
`name`, `active`.

- Bar = `outstandingDebt / debtLimit`; caption «Limit: X · Band: Y · Bo'sh: Z so'm» — full
  precision (mobile: `fmtShort` primary + full value as the permanent secondary line).
- States: `<60%` neutral · `60–90%` warning · `>90%` danger · **`debtLimit=null`** → plain
  text «Cheklanmagan — limit qo'yilmagan», no bar · **`debtLimit=0`** → danger «Yangi qarzli
  buyurtma bloklanadi — faqat oldindan to'lov» · **≥100%** → danger «Limit to'lgan — Yangi
  buyurtma bloklanadi» (the same figures the order composer will show — no submit surprise).
- Info popover: «Band = mijozlaringizning musbat qoldiqlari yig'indisi. Bir mijozning avansi
  boshqasining qarzini yopmaydi» (locked rule, in words).
- Header link «Mening ko'rsatkichlarim →» → `/me`. Refetches on order/payment socket events.

### 2.4 Region B — own queues (`WorklistCard` × 3, single column)

| Card | Severity | Data | Drill |
|---|---|---|---|
| Muddati o'tgan qarzlar | danger | `GET /debts/clients?days=7` (server-scoped) rows `hasOverdueOrders=true`; Σ `overdueOrdersTotal`; preview → client card | `/debts?tab=mijozlar&chip=overdue` |
| Muddati kelganlar (7 kun) | warning | same payload, rows `dueWithinWindow=true`; window named on the card; preview shows `name` + `balance` `BalanceTag` | `/debts?days=7` |
| Yo'ldagi buyurtmalarim | neutral | 3 × `GET /orders?status=` merged (own rows) | `/orders?chip=inflight` |

Preview rows on mobile are ≥44px tap targets; a row's `T` affordance is the register's job —
here rows just open the record.

### 2.5 Region C — KPI cards (`StatCard` compact grid, 2-up)

From `GET /dashboard/summary` (scope=agent): Oy savdosi (hero of this band, `DeltaTag` from
the scoped 62-kun trends), Bugungi savdo, Yig'ilgan to'lov (oy), **Mijozlarim qarzi**
(`clientsOweUs` scoped → `/debts`), Sotilgan hajm (oy), Mijozlardagi paddonlar
(→ `/debts?tab=paddonlar` — pallets live inside Qarzlar for agents), Yil savdosi, Mahsulot
foydasi (oy) and Transport foydasi (oy) (sign-colored, «taxminiy» chip — same rule as §1.4).
Drills go to the agent's own registers (server re-scopes). **Not rendered at all:**
Zavodlarga qarzimiz, Shofyorlarga qarzimiz, Bonus hamyonlar — the server forces them to 0
for agents and the cards would be noise; their absence is by design, not client-side hiding
of real data. Mobile money: `fmtShort` primary + permanent full-value caption (02 §7).

### 2.6 Region D — 14 kunlik trend

Compact chart card, 160px: `GET /dashboard/trends?days=14` (scoped) — the two standard
lines with end-labels, no bar layer, axis-free left edge (sparkline discipline), caption
«Σ savdo … · Σ tushum … so'm» in full precision. Tap → `/orders`. No `?days` control here —
the agent page stays one-glance; deeper analysis lives on the registers.

### 2.7 Actions

Queue rows → records; KPI cards → own registers; limit card → `/me`; bottom tab bar
**➕** (raised) → sheet: «Yangi buyurtma» (`/orders/new`, 4-step wizard) · «To'lov qabul
qilish» (PaymentComposer AGENT variant — CLIENT_IN only, own clients). Palette (`Ctrl+K` on
desktop) sees only own-scope records.

### 2.8 URL params · keyboard

No URL params (fixed windows: 7-kun queues, 14-kun trend — each named in its label).
Keyboard (desktop agent): global chords + Tab/Enter traversal as §1.10. Mobile: no chords;
no hover-dependent info anywhere (hard rule).

### 2.9 States

Same law as §1.11, plus: `GET /agents/me` 404 («Agent profili topilmadi» — user not bound
to an Agent) → `ErrorState` in the limit card with the server text verbatim; the rest of
the cockpit still renders. Offline (field reality): amber reconnect banner, pull-to-refresh
enabled, «oxirgi yangilanish HH:mm» visible, refetch-on-focus on.

### 2.10 Responsive

<768px is the primary design (bottom tab bar 56px with safe-area, card lists, 44px
targets); 768–1023 two-up KPI grid; ≥1024 the same single column centered at 720px — an
agent at a desktop gets a focused page, not a fake admin cockpit.

### 2.11 Removed vs today — and why

| Today | Fate | Why |
|---|---|---|
| Same 10-card admin wall, scoped | limit-first cockpit + queues | an agent's blocking constraint (debt limit) was invisible until an order failed at submit |
| «Kutilayotgan tushum» card | dead | duplicate (as §1.13) |
| 30-day full chart | 14-kun mini trend | phone estate; registers carry analysis |
| Hover tooltips for exact money | permanent secondary captions | no tooltip-only info on mobile (law) |
| Nothing else removed | ranking was never shown to agents (403) — unchanged | |

---

## §3. CASHIER — «Kassa terminali»

### 3.1 Purpose

A cash-desk terminal, not an ERP: **take money, pay out, see box balances, print
receipts.** Kept open all shift; everything reachable without leaving the page.

### 3.2 Layout

```
┌ PageHeader: Kassa terminali ─────────────────────────────────────────────┐
│ A. Intent buttons (one row, 40px, KbdHints)                              │
│ [ To'lov qabul qilish  T ] [ Zavodga to'lash ] [ Shofyorga to'lash ]     │
│ [ Xarajat kiritish ]                                                     │
├ B. Cashbox cards (grid) ─────────────────────────────────────────────────┤
│ UZS jami: 18 250 000 so'm · USD jami: $4 120.00                          │
│ ┌ Naqd kassa ────────┐ ┌ Bank (Септем Алока) ┐ ┌ Valyuta (USD) ┐ …       │
│ │ 12 450 000 so'm    │ │ …                   │ │ $4 120.00     │         │
│ │ ↑ kirim 3 200 000  │ │                     │ │               │         │
│ │   chiqim 1 000 000 │ │                     │ │               │         │
├ C. Bugungi amallar (feed) ───────────────────────────────────────────────┤
│ 14:32 · Naqd kassa · Kirim + 4 500 000 · To'lov — Гофур Хазорасп · [⋮]   │
│ 13:10 · Naqd kassa · Chiqim − 2 000 000 · Shofyorga to'lov — Isuzu 01A…  │
│ 11:05 · Click · Kirim + 1 200 000 · To'lov — Жамол Ургенч (storno) ghost │
│                                                        Hammasi → /kassa  │
└──────────────────────────────────────────────────────────────────────────┘
```

### 3.3 Region A — intent buttons (`PaymentComposer` entries, 04 §3.3)

Four **intent-named** buttons — the kind never morphs mid-form:

| Button | Composer kind | Notes |
|---|---|---|
| To'lov qabul qilish `T` | CLIENT_IN | CASHIER variant: **no allocation section**; fixed info line «Taqsimlashni buxgalter bajaradi» — the payment lands in the accountant's «Taqsimlanmagan to'lovlar» queue (hero flow §2.6). Success state: «Yangi balans: …» + **«Kvitansiya chop etish»** (`/print/receipt/:paymentId`) + «Yana to'lov». |
| Zavodga to'lash | FACTORY_OUT | method-consequence line shown; no allocation for K |
| Shofyorga to'lash | VEHICLE_OUT | — |
| Xarajat kiritish | expense create modal (existing `/expenses` modal: category select with inline «+», cashbox with live balance) | posts to expenses; feed row appears via socket |

Cashbox shortfall on OUT: the server's exact figure renders inline verbatim and the
`CashboxSelect` refetches (02 §9). Every composer opens with a fresh idempotency key.

### 3.4 Region B — cashbox cards

Data `GET /dashboard/kassa`. Per-currency grand totals first (UZS/USD **never merged**).
One card per active box: `name` + type chip (`StatusChip` neutral from the shared map, no
raw enum) + `balance` `money-lg` (currency-correct format; negative → `moneyOwedToUs` ink +
«kamomad») + «↑ kirim `todayIn` · chiqim `todayOut`» — kirim in `moneyIn`, **chiqim in
neutral `colorText`** (spending is not an error; today's red ↓ arrow dies). Card click →
`/kassa?cashboxId=<id>`. Balance definition tooltip: «Butun davr: Σ kirim − Σ chiqim».

### 3.5 Region C — Bugungi amallar (live feed)

Data **`GET /kassa/transactions?dateFrom=<bugun>&dateTo=<bugun>&pageSize=20`**
(`['kassa','tx',{today}]`) — rows already embed `cashbox`, `payment` (kind, method, amount,
client/factory/vehicle, voidedAt), `expense` (category, note, voidedAt), `bonusTransaction`,
`reversalOf`/`reversedBy`, `createdBy`. `DataTable` (36px rows):

| Column | Content |
|---|---|
| Vaqt | `date` HH:mm (absolute in tooltip) |
| Kassa | `cashbox.name` |
| Yo'nalish | word + sign: «Kirim +X» (`moneyIn`) / «Chiqim −X» (neutral) — one colored column per table |
| Hujjat | source label from the shared `LEDGER_SOURCE`-style map: «To'lov — <mijoz/zavod/moshina nomi>» (link → `/payments/:id` peek) · «Xarajat — <kategoriya>» · «Qo'lda kiritilgan» · «Storno» (chained glyph → paired row, both ghost-styled per 02 §6) · «Bonus — <zavod>» |
| Kim | `createdBy.name` |
| ⋮ (labeled kebab) | **«Kvitansiya»** (payment-backed rows only → `/print/receipt/:paymentId`; the print route itself refuses voided payments with an explainer — and TRANSPORT_DIRECT never appears here because it never touches kassa) · «Hujjatni ochish» |

Footer: «Hammasi → /kassa». New rows arrive via socket invalidation (CASHIER room receives
kassa-affecting events) and pulse once (1.2s `colorPrimaryBg`). Voided/storno rows render as
ghost rows — history stays visible during the shift.

### 3.6 URL params · keyboard

No URL params (the terminal is always «bugun»; history lives at `/kassa?from&to`).
Keyboard: `T` opens To'lov qabul qilish (the page's primary create — `KbdHint` on the
button); composers use the standard `Ctrl+Enter` / `Esc` (dirty-check) map; feed table:
`↑↓`/`J/K` cursor, `Enter` opens the payment peek, `.` kebab. Global: `Ctrl+K` (palette
scoped to payments/expenses/kassa), `?`, `Esc`.

### 3.7 States

Platform law §1.11 applies. Specifics: empty boxes → `EmptyState` «Faol kassalar
topilmadi»; empty feed → «Bugun hali amal yo'q» + the intent buttons above remain the
action; feed loading → 8 skeleton rows, header intact; feed refetch → hairline, rows stay;
offline → grey LiveBadge + «ma'lumot HH:mm holatiga» on the totals; composer double-submit
impossible (idempotency key + self-disabling verb button).

### 3.8 Responsive

≥1200: 3–4 box cards per row, feed full-width. 768–1199: 2-up cards. <768: intent buttons
become a 2×2 grid of 48px buttons; box cards single column; feed rows 2-line (time+box+
direction / document+amount); bottom sheet composers.

### 3.9 Removed vs today (`KassaDashboard`) — and why

| Today | Fate | Why |
|---|---|---|
| Balance + today in/out cards only — dead end | + intent buttons, + today feed with per-row Kvitansiya, + per-currency totals | the cashier had to leave the page for every task; UZS/USD were never summed anywhere |
| Red «Bugun chiqim» with ↓ arrow | neutral ink + word | kassa OUT is not an error (02 §2.4) |
| Raw `type` enum in the corner Tag | `StatusChip` label from the shared map | raw enums never render |
| `fmtShort` flows with no exact value | full precision | terminal users reconcile exact figures |
| Static «● LIVE» | LiveBadge + «HH:mm holatiga» | honesty |

Nothing else existed; nothing is lost.

---

## §4. Locked-rule visibility matrix (brief → where the UI shows it)

| Locked rule (01 brief, Dashboard section) | Where visibly handled |
|---|---|
| Balances = Σ immutable ledger postings; sign convention in components | all balances via `MoneyCell`/`BalanceTag` semantics; no raw signed numbers anywhere on the cockpits |
| clientsOweUs = Σ positive balances only (advances never offset) | «Mijozlar qarzi» tooltip §1.4; agent limit-card popover §2.3 |
| weOweFactories/Vehicles = Σ negative balances, reported positive | `moneyWeOwe` ink + «…qarzimiz» card names + tooltips |
| CANCELLED orders excluded everywhere | KPI definition tooltips; chart tooltip footnote «bekor qilinganlarsiz» |
| Collections = CLIENT_IN, non-voided only | «Yig'ilgan to'lov» tooltip; drill URL carries `kind=client_in` |
| Goods vs transport profit NEVER merged | two separate FOYDA cards + caption «alohida» (§1.4, §2.5) |
| ordersInFlight = CONFIRMED+LOADING+DELIVERING | card tooltip + queue-10 definition |
| Pallet balance = in-kind, never money | `PalletChip` styling + «pulga kirmaydi» tooltip; lives beside, never inside, money |
| Tashkent calendar windows | chart footer note §1.6; all drills use Tashkent-day `from/to` |
| Server-side role scoping (never client-hiding alone) | §2.5: zeroed company cards not rendered; ranking never queried for AGENT (PERMISSIONS); CASHIER routed to §3 |
| Cashbox balance = all-time Σ IN−OUT, active boxes only | balance tooltip §3.4 |
| Realtime post-commit, thin payloads, room-scoped | LiveBadge + invalidation-refetch; 2s coalescing (the refetch-storm fix) |
| Money 2dp / volume 3dp server Decimals, display-only strings | `fmtMoney`/`fmtM3`; no client arithmetic except labeled delta derivation from server buckets (§1.4) |
| trends days 1–365; ranking month YYYY-MM | `?days` Segmented values; `?month` picker validation |
| Debt at order creation, credit/agent limits (order-domain rules) | agent limit card (§2.3) mirrors the exact gate the composer enforces |

## §5. Verify before build (this screen's additions to 03 §10)

- **a. `pricePending` is NOT in the orders list payload today** (`orders.service.ts findAll`
  includes only `_count.items`). The «Narxlanmagan buyurtmalar» card (§1.3 #5) and the
  `/orders?chip=unpriced` chip need one shared recipe: either the list payload gains the
  flag (backend backlog — not assumed) or the queue derives from bounded per-order detail
  hydration over the month window, cached and window-labeled. If neither is acceptable at
  build time, the card ships count-less as a link tile — never a fake number.
- **b. Payments list aggregate/allocations** — as 03 §10c; queue 2 shows Σ only if the
  payload provides it; queue 4 falls back to lazy per-row fetch.
- **c. Queue window caps** — every `pageSize=100` scan labels its window on the card footer
  and the drill page repeats it; at 10× volume the fix is a backend filter param (noted,
  never designed around).
