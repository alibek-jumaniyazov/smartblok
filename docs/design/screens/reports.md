# SmartBlok — Screen Spec: Hisobotlar (`/reports`) & Xarajatlar (`/expenses`) (v1)

**Status:** implementation-ready screen specification. Binds to `02-design-language.md`
(tokens, money semantics, platform state law §9), `03-shell-and-ia.md` (shell, routes §4,
URL contract §7, keyboard map §8), `04-components.md` (every component named here),
`05-hero-workflows.md` (§5 owner flow lands on Reestr; §C3 identity checks).
Business logic is LOCKED — every endpoint referenced below already exists; nothing here
requires a backend change.

**Screens covered:**

| # | Screen | Route | Roles |
|---|---|---|---|
| 1 | Hisobotlar hub (shell) | `/reports` | A B |
| 1.1 | Svod (Свод Завод twin) | `/reports?tab=svod` (default) | A B |
| 1.2 | Buyurtmalar reestri | `/reports?tab=reestr` | A B |
| 1.3 | Agentlar reytingi | `/reports?tab=reyting` | A B |
| 2 | Xarajatlar register | `/expenses` | A B K |
| 3 | Print-friendly outputs (frontend-only) | print CSS of 1.1/1.2/1.3/2 | as parent |

**API surface used (complete inventory — nothing else is called):**

| Endpoint | Returns (fields consumed) | Roles |
|---|---|---|
| `GET /reports/svod?from&to` | `{ from, to, factory{goods,pallets,goodsWithPallets,paidToFactory,factoryBalance}, factories[{factoryId,factory,goods,pallets,goodsWithPallets,paidToFactory,factoryBalance}], agents[{agentId,agent,rows[{clientId,client,goods,payments,balance,palletBalance,driverDirect}],subtotal{goods,payments,balance,palletBalance,driverDirect}}], totals{…same}, checks{goodsIdentity,paymentsIdentity} }` | A B |
| `GET /reports/svod.xlsx?from&to` | server flatten workbook (kept as fallback export) | A B |
| `GET /reports/orders-register?from&to&clientId&factoryId&page&pageSize` | paged rows `{id,orderNo,date,status,agent,client,factory,plate,driver,sizes,m3,costPrice,costTotal,costStatus,pallets,palletMoney,salePrice,saleTotal,transportCost,transportCharge,transportPaidStatus,goodsProfit}` + `total,page,pageSize` (pageSize ≤ 200; ordered date asc; **`search` is accepted by the DTO but ignored by the service — no search control renders**) | A B |
| `GET /reports/orders-register.xlsx?…` | whole-filter xlsx (server pages internally) | A B |
| `GET /dashboard/agents-ranking?month=YYYY-MM` | `{ month, agents[{agentId,agent,sales,goodsProfit,collected,outstandingDebt,orders}] }` sorted by sales desc | A B |
| `GET /expenses?page&pageSize&search&categoryId&cashboxId&dateFrom&dateTo&includeVoided` | paged items `{id,date,amount,note,voidedAt,voidReason,category{id,name},cashbox{id,name,currency},createdBy{id,name}}` | A B K |
| `GET /expenses/categories` | `[{id,name,_count.expenses}]` | A B K |
| `POST /expenses` `{date,amount,categoryId?,cashboxId,note?}` | created expense | A B K |
| `POST /expenses/:id/void` `{reason}` | voided expense | A B |
| `GET /kassa/cashboxes` | boxes with `entity`, `currency`, `active`, in/out totals → live balance (feeds `CashboxSelect`) | A B K |

---

## 0. Shared honesty rule for these screens (binding)

Neither report endpoint returns whole-filter aggregates, sorting, or transport/vehicle
filters. Per `03` §6 the design uses **bounded, visibly-labeled client-side derivation**:

- **Full-window mode (Reestr, Xarajatlar aggregates):** the page fetches every page of the
  current filter sequentially (`pageSize=200`, max 10 requests = **2 000 rows**). Under the
  cap, whole-filter totals, client-side sort, and derived filter chips are enabled and the
  FilterBar result meta says `«N ta yozuv · to'liq filtr bo'yicha»`. Over the cap the page
  falls back to plain server paging: sort headers render **disabled with tooltip**
  «server tartiblashni qo'llab-quvvatlamaydi», derived chips hide, and the pinned totals
  row is labeled **«sahifa jami»**. The mode is never silent — the label always states
  which scope the numbers cover. At 10× volume the fix is a backend aggregate/sort param
  (noted, not designed around).
- All client-side sums are display-only; the server stays the only calculator.

---

## 1. Hisobotlar hub — shell (`/reports`)

### 1.0 Purpose

One financial-report workbench for ADMIN/ACCOUNTANT: the workbook's **Свод Завод** master
summary (Svod), the flat **Товар** truck register (Reestr), and the monthly **agent
ranking** absorbed here from the old dashboard. It is a read surface that drills everywhere:
every party name links to its page, the register cross-links to the order workbench, the
ranking to agent cards. No mutations happen on `/reports`.

### 1.1 Layout & shell

`AppFrame` shell (`04` §1.1) → `PageHeader` (`04` §1.2) → shared period control →
tab body. Content max-width 1440, 24px padding.

```
┌ SideNav ┬ TopBar: Hisobotlar · [⌕ Ctrl+K] · LiveBadge · ☾ · 👤 ──────────────┐
│ MOLIYA  ├──────────────────────────────────────────────────────────────────┤
│  …      │ PageHeader                                                         │
│ ▸Hisob- │  Hisobotlar                        [Chop etish  P] [Eksport ▾]     │
│  otlar◂ │  ┌ tabs (?tab=) ──────────────────────────────────────────────┐   │
│         │  │ Svod │ Buyurtmalar reestri │ Agentlar reytingi │            │   │
│         │  └──────────────────────────────────────────────────────────────┘ │
│         ├──────────────────────────────────────────────────────────────────┤
│         │ Period bar:  [Bugun][Kecha][7 kun][Shu oy•][O'tgan oy][Shu yil]   │
│         │              [Oraliq…]        (Reyting tab swaps in a Oy picker)  │
│         │  caption: «Toshkent kuni · davr — oqim (buyurtma/to'lov); qoldiq  │
│         │            — joriy holat»                                         │
│         ├──────────────────────────────────────────────────────────────────┤
│         │ TAB BODY (§1.1 / §1.2 / §1.3)                                     │
└─────────┴──────────────────────────────────────────────────────────────────┘
```

- **PageHeader.** title «Hisobotlar» (20px, `h1`); breadcrumb «Hisobotlar»; tab strip synced
  to `?tab=`; right ActionBar = one primary **«Chop etish»** (`P`, contextual to the active
  tab) + overflow **«Eksport ▾»** (per-tab export items, §3 / §1.1.7). Sticky-condensed on
  scroll (`04` §1.2).
- **Period bar** = one `DateRangeControl` (`04` §3.6) writing `?from&to`, Tashkent-day basis
  stated in its footer. It is shared by Svod and Reestr; the Reyting tab replaces it with a
  **month picker** writing `?month=YYYY-MM` (the two report families use different windows,
  so the control swaps rather than pretends). Default range **Shu oy** (month-to-date).
- The **balance-vs-flow caption** under the period bar is permanent and is the single place
  the locked rule (svod balances are current, flows are windowed — brief rule) is surfaced.

### 1.2 Role variations (hub)

- **A / B only.** `/reports` is absent from AGENT and CASHIER nav, route guard, and palette
  (mirrors backend `@Roles('ADMIN','ACCOUNTANT')` via the shared `PERMISSIONS` map). An
  AGENT/CASHIER who pastes the URL gets the 403 Result + «Bosh sahifaga qaytish» (`02` §9).
- No per-field role differences inside — A and B see identical reports (both have full read).

### 1.3 Keyboard (hub)

| Keys | Action |
|---|---|
| `1 / 2 / 3` | Switch tab Svod / Reestr / Reyting (chords disabled in inputs) |
| `P` | Print the active tab (opens the print preview, §3) |
| `/` | Focus the tab's search/filter control where one exists (Reestr client picker) |
| `Ctrl+K` | Command palette («Hisobotlar» page result; no dedicated Go-alias in `03` §8) |

### 1.4 States (hub)

Loading/refetch/empty/error are per-tab (below). The hub chrome (PageHeader, tabs, period
bar) always renders — a failing tab body shows `ErrorState` in place, chrome survives
(`02` §9).

---

## 1.1 Svod tab (`/reports?tab=svod`)

### Purpose

The digital twin of the workbook's **Свод Завод** master sheet: factory block + per-agent
client blocks + grand totals + the two reconciliation identities. Redesigned so the whole
picture is visible at a glance (the sheet's entire point), every party drills down, and the
identity checks read as an **incident signal**, not a footnote.

### Layout (regions, top→bottom)

```
┌ IDENTITY BANNER (pinned, §C3) ───────────────────────────────────────────────┐
│  ✔ Tovar identifikligi: Mos (0)      ✔ To'lov identifikligi: Mos (0)          │  ← green calm
│  ── OR, when non-zero: ──                                                     │
│  ⚠ To'lov identifikligi buzilgan — Farq: 1 240 000 so'm.  Yetim yozuvlar bor:│  ← danger incident
│    Σ to'lov (butun) − Σ ustun jami. [Reestrni tekshirish →]                   │
└──────────────────────────────────────────────────────────────────────────────┘

┌ ZAVODLAR BLOKI ──────────────────────────────────────────────────────────────┐
│ Zavod         Tovar(so'm)   Paddon(so'm)  Jami       To'landi     Balans      │
│ CAOLS KS →    864 200 000   135 200 000   999 400 000 2 101 088 520 [Avansimiz…]│
│ …                                                                             │
│ ▸ Jami        …             …             …           …          [Avansimiz …]│  ← pinned totals
│ caption: «Tovar — eng aniq tannarxda (taxminiy, allokatsiyagacha). Paddon puli│
│           balansga kiritilgan. To'landi — bonusdan yopilganlar ham.»          │
└──────────────────────────────────────────────────────────────────────────────┘

┌ AGENTLAR BO'YICHA MIJOZLAR  (one grouped table, agent subtotal rows sticky) ──┐
│ ══ Jamol (22-22)  ·  8 mijoz  ·  [Qarz 41 200 000]              [Agent →]     │  ← sticky group header
│ Mijoz            Tovar      To'lovlar   ·shofyorga to'g'ri  Qoldiq     Paddon │
│ Жамол Ургенч →   24 300 000 20 100 000       500 000       [Qarz 4,2M]  12 dona│
│ …                                                                            │
│ ── Jami (Jamol) 132 400 000 91 200 000       500 000     [Qarz 41,2M]  84 dona│  ← subtotal, inset bg
│ ══ Shuhrat  ·  6 mijoz  ·  [Qarz 18 900 000]                   [Agent →]     │
│ …                                                                            │
│ ══ Biriktirilmagan · 2 mijoz …                                               │
│ ═══ UMUMIY JAMI  …                            …          [Qarz …]     … dona  │  ← grand totals, bold
└──────────────────────────────────────────────────────────────────────────────┘
```

### Components + data sources

| Region | Component (`04`) | Data (from `GET /reports/svod`) |
|---|---|---|
| Identity banner | `StatusChip` (calm) / `ErrorState`-styled **incident banner** (`04` §4.6) | `checks.goodsIdentity`, `checks.paymentsIdentity`; `isSettled(v)` → green «Mos (0)», else red «Farq: `fmtMoney(v)` so'm» |
| Zavodlar bloki | `DataTable` (`04` §1.5), no pagination | `factories[]`; pinned totals from `factory{…}` |
| — money cells | `MoneyCell` variant `neutral` (`04` §2.1) | `goods, pallets, goodsWithPallets, paidToFactory` |
| — Balans col | `BalanceTag` partyType `factory` (`04` §2.2) | `factoryBalance` → «Avansimiz N» (positive) / «Qarzimiz N» (negative) / «Hisob yopiq» (`|v|<1`) |
| — Zavod cell | linked identity cell → `/factories/:id` | `factoryId, factory` |
| Agent groups | `DataTable` with **grouped rows + sticky subtotal rows** (`02` §6, `04` §1.5) | `agents[]` → group per `{agentId,agent}`; sticky group header, `subtotal{…}` as an inset subtotal row; final grand-total row from `totals{…}` |
| — Agent header | group header + client `BalanceTag` chip + «Agent →» link → `/agents/:id` | `agent`, `subtotal.balance` |
| — Mijoz cell | linked → `/clients/:id` | `clientId, client` |
| — Tovar / To'lovlar | `MoneyCell` neutral | `goods`, `payments` |
| — ·shofyorga to'g'ri | `MoneyCell` neutral, muted `small` caption col | `driverDirect` |
| — Qoldiq | `BalanceTag` partyType `client` (tinted, **not** alarm red — this is a report, not a collections surface: `02` §2.4) | `balance` |
| — Paddon | `PalletChip` (`04` §2.9) / bare «N dona» | `palletBalance` (in-kind units, never money) |

### Business rules visibly handled (Svod)

- **Identity checks are a promise, not a widget** (`§C3`, brief rule): pinned at top; a
  non-zero value renders as a **danger incident banner** with the exact farq and a
  «Reestrni tekshirish →» link — a defect signal, never a quiet tag. `isSettled` (|v|<1)
  gates green (float residue tolerance, brief rule).
- **Balances are current, flows are windowed** (brief rule): the period-bar caption states
  it; Qoldiq/Balans columns carry a header tooltip «joriy ledger qoldig'i — davrga bog'liq
  emas». Tovar/To'lovlar columns are the windowed flows.
- **Factory goods = provisional cost** (`quantityM3 × (finalCostPricePerM3 ?? costPricePerM3)`;
  brief rule): the block caption says «taxminiy, allokatsiyagacha»; pallet money is its own
  column and is included in the balance (caption states it).
- **Paid-to-factory includes BONUS offsets** (brief rule): «To'landi» header tooltip
  «bonusdan yopilgan to'lovlar ham».
- **TRANSPORT_DIRECT breakout** (brief rule): the «·shofyorga to'g'ridan» column shows the
  slice of «To'lovlar» that was «шопр учун барди» (client paid the driver, no kassa row); a
  header tooltip explains it is *inside* To'lovlar, not additional.
- **Pallet balance is in-kind** (brief rule): `PalletChip`/«N dona», never a money format,
  always its own column — the money/units separation is structural.
- **Cancelled orders excluded** (brief rule): server-side (`status != CANCELLED`); a header
  meta note «bekor qilinganlar hisobga olinmagan».

### Actions & where they live (Svod)

- **Drill:** click any factory / client / agent name → its detail page (`03` §9 cross-link
  contract). Whole row hover = e1 + pointer; identity link on the name cell for
  middle-click/new-tab.
- **Print:** PageHeader «Chop etish» / `P` → Svod print sheet (§3.1).
- **Export ▾:** «Excel (.xlsx) — server» (`GET /reports/svod.xlsx`, kept as the raw fallback,
  labeled «xom eksport») **and** «CSV — ekrandagi ko'rinish» (client-side, factory block +
  agent blocks with subtotals + grand totals + checks, mirroring the layout — the formatted
  export the accountant actually wants, built from the already-fetched JSON, no backend
  change; `04` §1.5 export slot).

### Filters + URL (Svod)

`?tab=svod`, `?from`, `?to`. No search/party filters on Svod (the endpoint takes only the
date window — none are faked). Range change refetches; balances stay current by design.

### States (Svod)

- **Loading (first):** skeleton — banner strip + factory table (6 skeleton rows) + one agent
  group of 6 skeleton rows (layout never jumps, `02` §9).
- **Refetch:** 2px hairline under PageHeader, existing tables stay (`keepPreviousData`).
- **Empty period:** factory/agent tables render with only the totals rows at 0 and a line
  «Bu davrda oqim yo'q — qoldiqlar joriy holatda ko'rsatilgan» (a summary with no flow is
  still a summary; balances are current so they may be non-zero — stated).
- **Error:** `ErrorState` replacing the tab body, server text verbatim + «Qayta urinish».

### Responsive (Svod)

Wide grouped tables live inside an `overflow-x:auto` container (page body never scrolls
horizontally). ≤1024 the low-priority columns (·shofyorga to'g'ridan, Paddon on factory) fold
into a per-row expand; the identity banner and Qoldiq column always survive. Desk-role phone
users get read support only (Svod is a desk analysis surface; a polite «kompyuterda qulayroq»
note, never blocking). AGENT never reaches it.

---

## 1.2 Buyurtmalar reestri tab (`/reports?tab=reestr`)

### Purpose

The flat **Товар** ledger: one row per order/truck, the 22 register fields, with per-m³
prices back-solved at stored precision. Redesigned from a 2 400px wall into a preset-driven
register with a totals row, cross-links to the order workbench, and (in full-window mode)
client-side sort — the surface hero-flow (e) lands on to find the mis-charged transport.

### Layout

```
┌ FilterBar (URL-synced) ──────────────────────────────────────────────────────┐
│ [Davr: Shu oy ×] [Mijoz: … ×] [Zavod: … ×]   ustunlar:[Moliya│Logistika│Hammasi]│
│                              214 ta · to'liq filtr bo'yicha   [Keng ⇕][Eksport ▾]│
└──────────────────────────────────────────────────────────────────────────────┘
┌ DataTable (sticky header; Sana + № left-fixed; horizontal scroll) ───────────┐
│ Sana  №        Mijoz→   …  Hajm  Tannarx jami  Sotish jami  Foyda      Holat  │
│ 05.07 ORD-104→ Жамол   … 32,832  60 100 000    64 600 000   [4 500 000] Yakun. │
│ …                                                                            │
│ ▸ Sahifa jami / Davr jami   Σm³  Σtannarx      Σsotish      Σfoyda            │  ← TotalsRow (scope-labeled)
└──────────────────────────────────────────────────────────────────────────────┘
```

### Column presets (`04` §1.5 columnPresets, client-side; `?preset=`)

Only **one ink-colored column per preset** (`02` §2.4). Sana & № always left-fixed.

| Preset | Columns (in order) | Colored answer col |
|---|---|---|
| **Moliya** (default) | Sana · № · Mijoz→ · Agent · Hajm(m³) · Tannarx jami · Sotish jami · **Foyda** · Tannarx holati · Holat | `goodsProfit` (green/red) |
| **Logistika** | Sana · № · Mijoz→ · Zavod→ · Moshina · Shofyor · Paddon · Paddon puli · Transport tannarx · Transport (mijozdan) · **Transport foydasi** · Transport holati · Holat | derived `transportCharge − transportCost` |
| **Hammasi** | all 22 fields + derived Transport foydasi | `goodsProfit` primary |

Derived **Transport foydasi** = `transportCharge − transportCost` (client-side, labeled;
enables hero-flow (e) sort-asc to surface a `Diler hisobidan` truck charged 0). Presets are a
UI-side `SavedView` (`04` §1.4); `V` cycles Moliya/Logistika/Hammasi.

### Components + data (`GET /reports/orders-register`, one page of `items[]`)

| Column | Component | Field | Format / rule |
|---|---|---|---|
| Sana | text, fixed-width | `date` | `fmtDate` DD.MM.YYYY |
| № | linked identity → `/orders/:id` | `orderNo` | middle-click new-tab |
| Agent / Mijoz→ / Zavod→ | text; Mijoz→`/clients/:id`, Zavod→`/factories/:id` | `agent, client, factory` | `—` when null |
| Moshina / Shofyor | text | `plate, driver` | `—` when null |
| O'lchamlar | text ellipsis | `sizes` | |
| Hajm | `.num` right | `m3` | `fmtM3` 3dp «m³» |
| Tannarx (so'm/m³) | `.num` right | `costPrice` | `fmtNum(v,6)` — **back-solved, stored precision, never silently rounded** (brief rule) |
| Tannarx jami | `MoneyCell` neutral | `costTotal` | includes pallet money (brief rule) |
| Tannarx holati | `StatusChip` | `costStatus` | Taxminiy / Qisman / Qotirilgan (`02` §2.5) |
| Paddon | `.num` right | `pallets` | «N dona» (units) |
| Paddon puli | `MoneyCell` neutral | `palletMoney` | |
| Sotish (so'm/m³) | `.num` right | `salePrice` | `fmtNum(v,6)`; unpriced trucks read `0` (see note) |
| Sotish jami | `MoneyCell` `body-strong` neutral | `saleTotal` | `0` for pricePending trucks (note) |
| Transport tannarx / (mijozdan) | `MoneyCell` neutral | `transportCost, transportCharge` | |
| **Transport foydasi** | `MoneyCell` signed (Logistika colored col) | derived | green positive / red negative |
| Transport holati | `StatusChip` | `transportPaidStatus` | To'lanmagan / To'langan / Mijoz to'lagan / **Aniqlanmagan (violet + ?)** / — (`02` §2.5) |
| **Foyda** | `MoneyCell` signed (Moliya colored col) | `goodsProfit` | `saleTotal − costTotal`; header meta «Foyda = sotish − tannarx (paddon puli bilan)» — states which profit definition (brief rule) |
| Holat | `StatusChip` | `status` | order status map |

> **Unpriced-truck note:** the register payload has no `pricePending` flag; a truck shipped
> before price agreement returns `saleTotal:"0"` / `salePrice:0` and shows a literal `0`
> (honest). The «Narxlanmagan» badge and the pricing action live on the order workbench
> (`05` §B3) — the № cell links straight there.

### TotalsRow (`04` §4.8, `02` §6)

Pinned bottom row. **Default scope = «sahifa jami»** (Σ over the visible page: Σ m³, Σ Tannarx
jami, Σ Sotish jami, Σ Foyda / Σ Transport foydasi per preset). A **«Butun oraliqni hisoblash»**
chip triggers full-window mode (§0): sequentially fetches all filter pages (≤2 000 rows), and
the row relabels **«Davr jami · N qator»**; over the cap it stays «sahifa jami» with the note.
The server returns no register aggregate, so the scope label is mandatory — the number never
lies about its coverage.

### Sorting

Server sorts `date asc` only (fixed). Under full-window mode client-side sort of the **whole**
fetched filter is enabled (not a one-page sort — that is banned, `02` §6); over the cap the
sort headers render **disabled with tooltip** «server tartiblashni qo'llab-quvvatlamaydi».
Default view is date-ascending, matching the workbook.

### Filters + URL (Reestr)

`?tab=reestr`, `?from`, `?to`, `?clientId`, `?factoryId`, `?preset`, `?page`, `?pageSize`.

- **Davr** — `DateRangeControl` (the shared period bar) → `from,to`.
- **Mijoz** — `PartySelect` clients, server-searched (`04` §2.11) → `clientId`.
- **Zavod** — factory select → `factoryId`.
- **No** free-text search (`search` is ignored by the service — omitted, never faked, `03`
  §10/§7 `*` rule). **No** transport-status/vehicle filter (endpoint doesn't honor them) — a
  FilterBar footnote «Transport/moshina bo'yicha filtr — to'liq registrda: [Buyurtmalar →]»
  routes to `/orders?chip=transport-unknown` etc. where those filters are real.
- Any filter change resets `page` to 1 (`03` §7).

### Actions & keyboard (Reestr)

Power register → `04` §1.5 mechanics + `03` §8 list keys.

| Keys / control | Action |
|---|---|
| `↑↓` / `J K` | Row cursor (2px primary left accent) |
| `Enter` | Open the row's order → `/orders/:id` |
| `V` | Cycle presets (Moliya/Logistika/Hammasi) |
| `Keng ⇕` (`DensityToggle`) | 36↔44px rows, persisted `sb_density:<user>:/reports` |
| `P` | Print Reestr (§3.2) |
| `Eksport ▾` | «Excel (.xlsx)» → `GET /reports/orders-register.xlsx` (server pages the **whole filter**, kept) |

### States (Reestr)

- **Loading:** 8 skeleton rows, sticky header intact.
- **Refetch / paging:** rows stay + 2px hairline; pagination/sort instant (`02` §5).
- **Empty (filtered):** «Filtrga mos buyurtma topilmadi» + «Filtrlarni tozalash» (`02` §9),
  never the generic empty.
- **Error:** `ErrorState` in place + «Qayta urinish».

### Responsive (Reestr)

≥1200 full table (horizontal scroll container). 1024–1199 the active **column preset is
forced** (Hammasi disabled) so the row fits; low-priority columns fold into row-expand.
≤1024 two-line rows (identity+status / money+meta). Desk-role phone = read support. AGENT
never reaches it.

---

## 1.3 Agentlar reytingi tab (`/reports?tab=reyting`)

### Purpose

The agent performance ranking, **moved off the dashboard** (which kept only a compact copy)
to a real reporting surface with a month picker and month-over-month deltas — historical
comparison the old fixed-to-current-month card made impossible.

### Layout

```
┌ Period: [◂ Iyun 2026 ▸]  (month picker → ?month=YYYY-MM)     [Eksport ▾][Chop P]│
│ meta: «Savdo/foyda/yig'ilgan — tanlangan oy · Qoldiq — hozirgi holat»          │
├────────────────────────────────────────────────────────────────────────────────┤
│ #  Agent →      Savdo         Δ oy    Mahsulot foydasi  Yig'ilgan  Hozirgi qoldiq  Buyurtma │
│ 1  Jamol →      132 400 000  ↑ 12%   [+18 200 000]     91 200 000  [Qarz 41,2M]      44     │
│ 2  Shuhrat →     98 100 000  ↓ 4%    [+11 400 000]     80 300 000  [Qarz 18,9M]      31     │
│ …                                                                                          │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Components + data

| Column | Component | Field (`GET /dashboard/agents-ranking?month=`) | Rule |
|---|---|---|---|
| # | rank index | (client, from sorted order) | server sorts by `sales` desc |
| Agent → | linked → `/agents/:id?month=<same>` | `agent, agentId` | cross-link (`03` §9) |
| Savdo | `MoneyCell` neutral `body-strong` | `sales` | full precision |
| Δ oy | `DeltaTag` (`04` §4.8) | derived vs previous month | fetched with a **second query** `month = prev(month)`; matched by `agentId`; colored by *business goodness* (sales ↑ = green); «yangi» when no prior row |
| Mahsulot foydasi | `MoneyCell` signed (the ink-colored column) | `goodsProfit` | green/red |
| Yig'ilgan | `MoneyCell` variant `in` | `collected` | non-voided CLIENT_IN this month |
| Hozirgi qoldiq | `BalanceTag` partyType `client` (tinted chip) | `outstandingDebt` | **labeled «hozirgi qoldiq»** — as-of-now, not month-end (brief rule / honesty); header tooltip states the time-frame mix |
| Buyurtma | `.num` | `orders` | count |

### Business rules handled (Reyting)

- **Time-frame honesty** (brief rule): the meta line + the «Hozirgi qoldiq» label + header
  tooltip make explicit that flows are for the month but debt is current — the old silent mix
  is gone.
- **Cancelled excluded / debt-at-creation** (server): meta note «bekor qilinganlar hisobga
  olinmagan».
- **MoM delta** is a derived, labeled comparison (two months of the same endpoint) — no new
  API.

### Actions, filters, keyboard

- `?month=YYYY-MM` (default current Tashkent month). Month picker `◂ ▸` steppers + picker.
- Rows client-side sortable by any column (the full agent set is returned unpaged — a whole-
  dataset sort, allowed by `02` §6). Default sales-desc.
- `Enter`/click row → `/agents/:id` carrying the selected month.
- `Eksport ▾` → «CSV — ekrandagi ko'rinish» (client-side; no server export exists for
  ranking — honest CSV of the table, `04` §1.5). `P` → print (§3.3).

### States (Reyting)

Loading = 8 skeleton rows. Empty month = «Bu oyda agent faoliyati yo'q» (all-zero rows still
listed — a ranking of zeros is still a ranking). Error = `ErrorState`. The delta query
failing degrades gracefully: Δ column shows «—» with a tooltip, the ranking still renders.

### Responsive (Reyting)

≤1024 folds Δ/Buyurtma into row-expand; Agent/Savdo/Foyda/Qoldiq stay. Desk-role read
support on phone.

---

## 2. Xarajatlar register (`/expenses`)

### Purpose

The cash-outflow register: record an expense against a UZS cashbox, review/void the history,
and — new — read the **filtered total and per-category breakdown** without exporting to
Excel. Expenses are **neutral spend, never red** (`02` §2.4: spending is not an error).

### Layout

```
┌ SideNav ┬ TopBar ────────────────────────────────────────────────────────────┐
│ MOLIYA/ ├ PageHeader                                                          │
│ (K:Kassa│  Xarajatlar                                   [Yangi xarajat  N]    │
│  termi- ├──────────────────────────────────────────────────────────────────┤
│  nali)  │ HEADER STATS (scope-labeled)                                       │
│         │  ┌ Davr xarajati ────────┐   Kategoriyalar (bosib filtrlang):      │
│         │  │  24 850 000 so'm       │   [Yoqilg'i 9,2M][Ish haqi 7,0M]       │
│         │  │  312 ta · to'liq filtr │   [Ijara 5,4M][Boshqa 3,2M] …          │
│         │  └────────────────────────┘   caption: «davr jami · mahalliy hisob»│
│         ├──────────────────────────────────────────────────────────────────┤
│         │ FilterBar: [⌕ izoh] [Kategoriya][Kassa][Davr] [Bekorlar: yashir▾] │
│         ├──────────────────────────────────────────────────────────────────┤
│         │ DataTable                                                          │
│         │  Sana   Kategoriya  Summa      Kassa       Izoh    Kiritdi  Holat ⋮│
│         │  10.07  Yoqilg'i    1 200 000  Naqd kassa  benzin  A.Q.     Faol   │
│         │  ~~09.07 Ijara      3 000 000  Naqd kassa  ~~..~~  …    [Bekor]  ⋮ │  ← ghost row
│         │  ▸ sahifa/davr jami                Σ …                             │  ← TotalsRow
└─────────┴──────────────────────────────────────────────────────────────────┘
```

### Header stats (client-side aggregate — brief high-priority gap)

`/expenses` has **no summary endpoint** (out of scope to add). Aggregation is bounded
full-window client derivation (§0), fetched over the current filter with `includeVoided`
matching the voided toggle, **non-voided only** counted into money:

| Component | Data | Rule |
|---|---|---|
| `StatCard` «Davr xarajati» (`04` §4.1) | Σ `amount` of non-voided rows across the filter | value `money-lg`, full precision; sub-line «N ta · to'liq filtr bo'yicha» or, over cap, «sahifa jami» |
| Per-category chips | grouped Σ `amount` by `category.name` (null → «Kategoriyasiz») | each chip «Nom · `fmtShort`Σ»; **click = set `categoryId` filter** (drill-down, `02` §1.4); scope caption «davr jami · mahalliy hisob» |

Both are honest client sums (`02` §1 honesty; labeled «mahalliy hisob»). The StatCard is the
drillable KPI; the chips are drillable filters — every number is a door (`02` §1.4).

### Create — «Yangi xarajat» (ExpenseComposer, 560px right drawer)

Money-document create = PaymentComposer-style drawer (`04` interaction grammar; supersedes
the legacy stacked modal). Opened by PageHeader «Yangi xarajat» / `N` / palette action
«Xarajat kiritish» / (CASHIER) the terminal intent button.

| Field | Component | Rule (locked, brief) |
|---|---|---|
| Sana | DatePicker, default **bugun** | Tashkent day |
| Summa | `MoneyInput` (`04` §2.10) | min 1 (positive Decimal); **max bound = selected box live balance** with «Hamyonda: N» chip + one-click max; bound advisory, server authoritative |
| Kassa | `CashboxSelect` (`04` §2.11) | **only ACTIVE UZS boxes offered** (currency-filtered) — the «faqat UZS» rule is built into the picker, not an error; option rows show live balance |
| Kategoriya | Select + inline **«+ Yangi»** (A/B only) | optional; duplicate-name create returns the server message verbatim; rename/delete live in `/references` (cross-ref) |
| Izoh | TextArea, ≤1000 | optional |
| Footer | «Saqlash» (`Ctrl+Enter`), self-disabling with spinner keeping its verb; «Yana xarajat» on success | draft persists to sessionStorage per route (`02` §9 form-resume) |

**Balance-sufficiency (locked):** the server rejects if the box would go negative (FOR UPDATE
check). The composer shows the live balance as the MoneyInput max; if the server still rejects
(race), the exact server figure «Kassada mablag' yetarli emas: joriy qoldiq X, xarajat Y»
renders **verbatim inline** under Summa and `CashboxSelect` refetches (`02` §9, `05` §D). No
optimistic money.

### Void — «Bekor qilish» (`ReasonModal` + `LedgerImpactPreview`)

Row kebab (A/B) → `ReasonModal` (`04` §2.6), replacing the old `modal.confirm`+uncontrolled
textarea:

- Title (danger): «Xarajatni bekor qilish — qaytarib bo'lmaydi».
- `LedgerImpactPreview` facts from the loaded row: «Kassaga qaytim (storno): `<cashbox>`
  + `fmtMoney(amount)` so'm» · «Xarajat bekor qilingan deb belgilanadi (o'chirilmaydi)».
- Required reason TextArea (≥3 chars, inline validation), danger confirm «Bekor qilish»,
  never default-focused.
- On success the row becomes a **ghost row** (`02` §6): 60% opacity, strikethrough on the
  **amount only** (date/category/box stay legible for audit), inline «Bekor qilingan» chip,
  reason in the chip tooltip. The compensating `REVERSAL` IN is idempotent server-side; an
  already-voided row shows no void action (`02` §9 already-actioned).

### Columns + data (`GET /expenses`, `items[]`)

| Column | Component | Field | Rule |
|---|---|---|---|
| Sana | text | `date` | `fmtDate` |
| Kategoriya | `Tag` (neutral, not a status) | `category.name` | «—» / «Kategoriyasiz» |
| Summa | `MoneyCell` variant **`neutral`** | `amount` | **not red** — neutral spend (`02` §2.4); ghost strikethrough if voided |
| Kassa | text link → Kassa journal (`/kassa?cashboxId=`) | `cashbox.name` | cross-link to the source box |
| Izoh | text ellipsis | `note` | |
| Kiritdi | text `small` (new — was captured, never shown) | `createdBy.name` | |
| Holat | `StatusChip` | `voidedAt` | «Faol» / «Bekor qilingan» (reason tooltip) |
| ⋮ | trailing kebab, labeled items | | «Bekor qilish» (A/B, non-voided only); «Kvitansiya» is **not** offered (expenses have no receipt doc) |

### Filters + URL (Expenses)

`?categoryId`, `?cashboxId`, `?search`, `?from`, `?to`, `?voided`, `?page` (`03` §7).

| Control | Component | Maps to API |
|---|---|---|
| ⌕ izoh | FilterBar search (debounce 300ms) | `search` (server: `note contains`, insensitive) |
| Kategoriya | Select (from `/expenses/categories`, shows `_count`) | `categoryId` |
| Kassa | `CashboxSelect` | `cashboxId` |
| Davr | `DateRangeControl` | `dateFrom`, `dateTo` |
| **Bekorlar** tri-state | ghost toggle «yashirish / ko'rsatish / faqat» (`02` §6) | hide→omit (`voidedAt=null`); show→`includeVoided=true`; **faqat**→`includeVoided=true` + client filter to voided-only (server can't return only-voided — noted; page-scoped) |

Default = **yashirish** (voided hidden — fixes the hard-coded `includeVoided=true`). Any
filter change resets `page` to 1.

> **Date basis note (brief rule):** the expenses service filters on the stored date-only
> field via UTC day boundaries, while Reports use Tashkent-day helpers. Because an expense's
> stored `date` is the UTC-midnight of the picked calendar day, the picked-day filter is
> consistent for expenses; the `DateRangeControl` footer states «Toshkent kuni» and the two
> screens read the same day labels. (True backend unification is a server change, out of
> scope — the UI is honest about the basis.)

### Keyboard (Expenses)

| Keys | Action |
|---|---|
| `N` | Yangi xarajat (composer) |
| `/` | Focus izoh search |
| `↑↓` / `J K` | Row cursor |
| `.` | Row kebab (Bekor qilish) |
| `Keng ⇕` | Density toggle (persisted) |
| `P` | Print period report (§3.4) |
| `Ctrl+Enter` | Submit composer |
| `Esc` | Close composer (dirty-check) / clear selection |

### TotalsRow (Expenses)

Pinned Σ Summa, scope-labeled «sahifa jami» / «davr jami · N qator» (mirrors the header
StatCard scope). Voided rows excluded from the sum even when shown.

### Role variations (Expenses)

| Capability | A | B | K | G |
|---|---|---|---|---|
| See register + header stats | ✓ | ✓ | ✓ | ✗ (no nav/route/palette) |
| Create expense (`N`, composer) | ✓ | ✓ | ✓ | ✗ |
| Add category «+ Yangi» | ✓ | ✓ | ✗ (Select only) | — |
| Void (kebab «Bekor qilish») | ✓ | ✓ | ✗ (no kebab item) | — |

Derived from the shared `PERMISSIONS` map mirroring backend `@Roles`. CASHIER reaches
`/expenses` from the Kassa-terminal nav and the terminal «Xarajat» intent button; sees the
full history but only creates. AGENT has no access at any layer.

### States (Expenses)

Per `02` §9: first-load skeleton (header stat skeleton + 8 table rows); refetch keeps rows +
hairline; empty (no filter) «Hali xarajat yo'q — Yangi xarajat»; empty (filtered) «Filtrga
mos xarajat topilmadi» + «Filtrlarni tozalash»; query error `ErrorState` in place; create/void
errors inline verbatim (never a modal over unrelated work); confirmation toasts one-line
(«Xarajat saqlandi» / «Xarajat bekor qilindi»), 4s, only for the actor.

### Responsive (Expenses)

≥1024 full table + side-by-side header stats. 768–1023 stats stack above a 2-line-row table;
FilterBar collapses to «Filtrlar (N)» sheet; composer becomes a bottom sheet (`03` §11).
CASHIER terminal on a fixed cash-desk screen keeps the desktop density. AGENT excluded.

---

## 3. Print-friendly outputs (frontend-only, no new endpoints)

Each report/register prints from **already-fetched data** via `PrintDocument` (`04` §4.7):
print CSS strips SideNav+TopBar (`no-print`), a sticky «Chop etish» toolbar carries copy-count
and the remembered dealer-entity/INN letterhead; browsers provide PDF. Money tabular,
single «so'm» per column header, black-on-white (semantic color degrades to weight),
`StatusChip` → bracketed words, `thead{display:table-header-group}`, `break-inside:avoid` on
rows and blocks, `@page` 14mm, footer «SmartBlok · chop etildi DD.MM.YYYY HH:mm · [user] ·
N/M». `P` on each tab opens its preview.

> These are the **reporting** print sheets. The four contractual paper documents (Yuk xati,
> Hisob-faktura, Kvitansiya, Akt sverki) are specified in `screens/print.md` and reached from
> the order/payment/party pages — Svod is a management summary, **not** the akt sverki.

| # | Sheet | Source (in-memory) | Layout |
|---|---|---|---|
| 3.1 | **Svod** (Свод) | `svod` JSON | A4 portrait: letterhead → title «SVOD (ЗАВОД) — `<davr>`» → factory block table → per-agent blocks with subtotals → grand totals → identity-check line («Tekshiruv: Tovar [Mos 0] · To'lov [Mos 0]» or the farq) → note «qoldiqlar joriy holatda». Workbook terms («Товар», «Оплата») via `ArtifactText` where quoted. |
| 3.2 | **Buyurtmalar reestri** | current filter rows (full-window fetch) | A4 **landscape**: letterhead → title + period + active filters → the **active preset's** columns only (all 22 don't fit paper; preset choice honored) → totals row. |
| 3.3 | **Agentlar reytingi** | ranking JSON | A4 portrait: title + month → ranking table (rank, agent, savdo, foyda, yig'ilgan, hozirgi qoldiq, buyurtma) + optional Δ column → footer. |
| 3.4 | **Davr xarajatlari** | expenses full-window rows | A4 portrait: title + period + filters → **per-category breakdown** (Kategoriya · N ta · Σ) → detail rows (Sana/Kategoriya/Kassa/Izoh/Summa) → grand total. Voided rows excluded (or a separate «bekor qilinganlar» section when «faqat»). |

---

## 4. What was removed vs today (nothing lost) + why

**Reports**

| Removed / changed | Why |
|---|---|
| Card-title `Typography.Title level={4}` per tab | → `PageHeader` (20px `h1`), ends the title lottery (`02` §2). |
| `DatePicker.RangePicker` raw + ru_RU pickers | → shared `DateRangeControl` presets, uz_Latn locale (`02` §7). |
| Svod `Collapse`, all agent panels collapsed by default | → **one grouped table, agent subtotal rows sticky, expanded** — the whole picture at a glance (brief pain 351). |
| Unlinked client/factory/agent names | → every name a cross-link (brief pain 351, `03` §9). |
| Identity checks buried in a bottom `Descriptions` card | → **pinned incident banner** at top; red = defect signal (`§C3`, brief rule). |
| `svod.xlsx` generic flatten as the only export | **kept** as labeled raw fallback **+** on-screen-shaped CSV + print (brief pain 353) — no backend change. |
| Reestr: 22-col wall, no totals, no presets | → column presets (Moliya/Logistika/Hammasi) + scope-labeled TotalsRow + `Keng` density (brief pain 352). |
| Reestr silent-ignored `search`; faked transport/vehicle filters | omitted honestly; cross-link to `/orders` where those filters are real (`03` §10). |
| Agents ranking stranded on the dashboard, fixed to current month | → moved here with month picker + MoM deltas + row links (brief pain 358); compact copy stays on `/`. |
| Nothing in the register/svod payloads dropped | all 22 register fields + every svod field render. |

**Expenses**

| Removed / changed | Why |
|---|---|
| Zero aggregation (no total, no breakdown, no export) | → header `StatCard` total + per-category drill chips + CSV/print (client-side, labeled) — the top brief gap (pain 349). |
| `includeVoided` hard-coded `true` | → **Bekorlar** tri-state (default hide) (brief pain 355). |
| `modal.confirm` void + uncontrolled textarea | → `ReasonModal` + `LedgerImpactPreview` + inline-validated reason (`04` §2.6). |
| Create `Modal` + stacked category `Modal` | → 560px `ExpenseComposer` drawer (money-doc grammar), inline category «+»; `MoneyInput` with live box-balance bound. |
| `Money strong` amount with no meaning | → `MoneyCell` **neutral** (spend is not an error, `02` §2.4). |
| `createdBy` captured but never shown | → «Kiritdi» column. |
| Full category CRUD absent | rename/delete → `/references?tab=kategoriyalar` (brief pain 356); inline create stays here for A/B. |
| Nothing in the expense payload dropped | all fields render; void reason preserved in tooltip. |

---

## 5. Business-rule traceability (acceptance checklist)

| Locked rule (brief) | Where surfaced |
|---|---|
| Debt at order creation; cancelled excluded everywhere | server `status != CANCELLED`; meta note on Svod & Reestr & Reyting |
| Svod identity checks must be 0 / defect signal | pinned incident banner (§1.1) |
| Factory goods = provisional best-known cost; pallet money separate but in balance | Zavodlar bloki caption (§1.1) |
| Paid-to-factory includes BONUS offsets | «To'landi» header tooltip (§1.1) |
| TRANSPORT_DIRECT credits client + settles vehicle, no kassa; broken out | «·shofyorga to'g'ridan» column + tooltip (§1.1) |
| Goods profit = saleTotal − costTotal (incl pallet); transport profit separate; label which | Foyda header meta + separate Transport foydasi column (§1.2) |
| Pallet balance in-kind units, never money | `PalletChip`/«dona» column (§1.1) |
| Per-m³ prices back-solved 6dp, never rounded | `fmtNum(v,6)` cost/sale price columns (§1.2) |
| \|balance\| < 1 = settled | `isSettled` gates check tags + «Hisob yopiq» BalanceTag (§1.1) |
| Report windows Tashkent-day, from incl/to excl; balances current | period-bar caption + column tooltips (§1.0/§1.1) |
| Ranking debt is as-of-now, not month-end | «Hozirgi qoldiq» label + meta + tooltip (§1.3) |
| Expense: active UZS box only, positive, balance-sufficiency | `CashboxSelect` UZS-only + `MoneyInput` min 1/max balance + verbatim server shortfall (§2) |
| Expense void soft + reversal IN, no hard delete | `ReasonModal`+`LedgerImpactPreview`, ghost row (§2) |
| Expense category unique, delete-when-unused | inline create verbatim error; rename/delete in `/references` (§2) |
| Expenses are neutral spend (not red) | `MoneyCell` neutral (§2) |
| Role gates (reports A/B; expenses A/B/K, void A/B) | `PERMISSIONS` map → nav/route/action visibility (§1.2, §2) |
