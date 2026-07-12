# SmartBlok — Screen Spec: Katalog & ta'minot (v1)

**Scope:** `/products` (+ price drawer + bulk reprice sheet), `/procurement` (matritsa +
marshrutlar), `/vehicles`, `/vehicles/:id` (NEW), Yuridik shaxslar
(`/references?tab=yuridik`) incl. the `LegalEntitySelect` wiring into payment forms.

**Binding parents:** tokens & platform state law `02-design-language.md`; shell/IA/params
`03-shell-and-ia.md`; components `04-components.md`; workflows `05-hero-workflows.md`.
Everything below composes ONLY components from `04` — no new primitives. All labels Uzbek
(Latin), money via `fmtMoney` (space-grouped, «so'm» per §7 of `02`), dates `DD.MM.YYYY`.
No new backend endpoints are assumed anywhere; every data source names an existing route.

Roles legend: **A** ADMIN · **B** ACCOUNTANT · **G** AGENT · **K** CASHIER.

---

## 1. `/products` — Mahsulotlar (catalog + versioned price book)

### 1.1 Purpose

The per-factory block catalog and the three-kind price book (FACTORY_CASH · FACTORY_BANK ·
DEALER_SALE, append-only, per-m³ 6dp). Answers: «bu mahsulot hozir qancha turadi, qachondan
beri, va yaqinda o'zgaradimi?» — and launches the two write flows: single price version
(drawer) and factory-wide bulk repricing (sheet, §2).

### 1.2 Layout

```
┌ PageHeader ──────────────────────────────────────────────────────────────────┐
│ Katalog / Mahsulotlar                                                        │
│ Mahsulotlar            [Narxlarni yangilash] [Yangi mahsulot ⏎N] [⋯]         │
├ FilterBar ───────────────────────────────────────────────────────────────────┤
│ [⌕ Nomi bo'yicha qidirish… /] [Zavod: CAOLS KS ×] [+ Filtr F]  «12 ta»       │
├ DataTable ───────────────────────────────────────────────────────────────────┤
│ Mahsulot        O'lcham   Zavod   m³/pad. Blok  Sotish narxi   Zavod naqd    │
│                                                 (so'm/m³)      (so'm/m³) …   │
│ Gazoblok D500   600×300…  CAOLS   1,728   48    729 928,1      625 000       │
│                                                 01.06.2026 dan 12.05 dan     │
│                                                 ⚑ kelgusi narx               │
│ …rows 36px, row click → Narxlar drawer, kebab trailing …                     │
└──────────────────────────────────────────────────────────────────────────────┘
```

Single full-width `DataTable` under `PageHeader` + `FilterBar`. No peek panel (the price
drawer is this register's detail surface). Price columns are two-line cells: line 1 the
stored-precision price (`.num`, 500 weight; DEALER_SALE `body-strong`), line 2 `small`
tertiary «DD.MM.YYYY dan». A violet-free amber-free **neutral** «kelgusi narx» chip
(`StatusChip` dot-style, `#2563EB` CONFIRMED-blue ink — informational, not a task) renders
under whichever kind has a scheduled future row.

### 1.3 Components & data

| Instance | Source (`04`) | Data |
|---|---|---|
| PageHeader | §1.2 | title «Mahsulotlar»; actions: primary «Yangi mahsulot», secondary «Narxlarni yangilash» (→ §2), overflow kebab (none else) |
| FilterBar | §1.3 | `GET /products?search&factoryId&page&pageSize` — `search` (name contains, **live-debounced 300ms**, `/` focuses), Zavod token (`PartySelect` over `GET /factories`), result meta «N ta» from `total` |
| DataTable | §1.5 | columns: Mahsulot (identity link, opens drawer) · O'lcham (`size`) · Zavod (`factoryName`, links `/factories/:id`) · m³/paddon (`m3PerPallet`, 3dp) · Blok/paddon (`blocksPerPallet` or —) · Sotish narxi (`prices.DEALER_SALE.pricePerM3` + `effectiveFrom`) · Zavod naqd (`prices.FACTORY_CASH`) · Zavod o'tkazma (`prices.FACTORY_BANK`) · Holat (`StatusChip` «Faol»/grey «Nofaol») · kebab. Sort headers **disabled + tooltip** («server tartiblashni qo'llab-quvvatlamaydi») — API sorts factory,name asc only |
| Kelgusi-narx badge | StatusChip | per-row lazy fetch `GET /products/:id/prices` for the **visible page only** (≤ pageSize rows, react-query cached 5 min, per-cell micro-spinner) — the sanctioned bounded lazy pattern (`03` §10c analogue); badge when any row has `effectiveFrom > now` |
| Create/edit drawer | grammar «simple record → right drawer 480px» | `POST /products` / `PUT /products/:id`. Fields: Zavod (`PartySelect`, **disabled on edit** + helper «Zavodni o'zgartirib bo'lmaydi — eski buyurtmalar buziladi»), Nomi, O'lchami, Hajmi (m³/paddon, 3dp), Bloklar soni (paddonda), O'lchov birligi (default «m³»), edit-only Faol toggle |
| Narxlar drawer | below §1.4 | `GET /products/:id/prices`, `POST /products/:id/prices` |
| EmptyState / ErrorState | §4.6 | platform law |

### 1.4 The price drawer («Narxlar — Gazoblok D500»)

560px right drawer, URL-addressable: `?panel=narx&productId=<id>` (deep-linked from the
procurement matrix fix links, `03` §9). Anatomy top→bottom:

1. **Header:** product name + size + factory chip; close ✕.
2. **Versioning note** (one quiet line, not an Alert box): «Narx versiyalanadi — yangi narx
   eski buyurtmalarga ta'sir qilmaydi.»
3. **Add form** (A/B only), vertical, one column — the ragged horizontal Space dies:
   Narx turi (segmented, 3 options: Sotish narxi · Zavod naqd narxi · Zavod o'tkazma narxi)
   → Narx (so'm/m³) (`MoneyInput`, 6dp decimal variant — stored precision is sacred, helper
   shows the current price of the picked kind: «Joriy: 729 928,1 · 01.06.2026 dan») →
   Kuchga kirish sanasi (`DatePicker`, default bugun; future date shows caption «kelgusi
   narx sifatida yoziladi») → «Qo'shish» (Ctrl+Enter). Duplicate (kind, effectiveFrom)
   renders the server text verbatim inline: «Shu tur va shu vaqt uchun narx allaqachon
   kiritilgan».
4. **History as per-kind tabs** (Sotish · Zavod naqd · Zavod o'tkazma) — the interleaved
   single table dies. Inside a tab: rows desc by `effectiveFrom`; **the current row is
   pinned** at top on inset background with a green dot chip «amaldagi»; future rows above
   it badged «kelgusi» (blue dot chip); older rows plain. Columns: Narx (so'm/m³, 6dp) ·
   Kuchga kirgan (`DD.MM.YYYY HH:mm`). No edit/delete anywhere — append-only is visible.

### 1.5 Actions

| Action | Where | Behavior |
|---|---|---|
| Yangi mahsulot (`N`) | header primary | create drawer |
| Narxlarni yangilash | header secondary | → `/products/reprice?factoryId=` (§2), factory pre-filled from the active filter |
| Narxlar | row click + kebab item | price drawer (`?panel=narx&productId=`) |
| Tahrirlash (`E` on cursor row) | kebab | edit drawer |
| Nofaol qilish / Faollashtirish | kebab | confirm modal (plain — API takes no reason field): «„Gazoblok D500" nofaol qilinadi — yangi buyurtmalarda ko'rinmaydi, tarix saqlanadi.» → `DELETE /products/:id`; reactivate = `PUT {active:true}` symmetric item on Nofaol rows |
| Ta'minotda ko'rish | kebab | → `/procurement?tab=matritsa&productId=<id>` cross-link |

### 1.6 Filters & URL params

`/products?factoryId&search&page&pageSize&panel=narx&productId` (extends the `03` §7 table
with the `panel`/`productId` drawer address — same `panel=` convention as taqsimlash/tolov).
Every change resets `page` to 1 except page/pageSize/panel.

### 1.7 Keyboard

Global set + list set (`03` §8): `/` search, `N` new, `F` filter adder, `J/K`/arrows cursor,
`Enter` opens the price drawer on cursor row, `.` kebab, `E` edit. Drawer: `Ctrl+Enter`
submits the add form, `Esc` closes (dirty-check on a touched form).

### 1.8 States

- Loading: 8 skeleton rows, header intact. Refetch: 2px hairline, rows stay.
- Empty (no filter): «Hali mahsulot yo'q — Yangi mahsulot». Filtered-empty: «Filtrga mos
  yozuv topilmadi» + «Filtrlarni tozalash».
- Price-cell lazy badge failed: badge silently absent (supplementary info), drawer remains
  the truth; drawer history error → `ErrorState` in the drawer body with server text +
  «Qayta urinish».
- Mutation errors inline under the field (duplicate name: «Bu zavodda shu nomli mahsulot
  allaqachon bor» — verbatim).

### 1.9 Roles

Route A B only (`03` §4). G is stripped server-side to DEALER_SALE + active rows but has
**no nav entry and no route** — a pasted URL hits the 403 Result with «Bosh sahifaga
qaytish». Locked rule surfaced: factory cost kinds are confidential — no G surface ever
renders FACTORY_CASH/FACTORY_BANK. K: no access.

### 1.10 Responsive

1200–1599: Blok/paddon and O'lcham fold into row expand. 1024–1199: price columns collapse
to one «Narxlar» column (DEALER_SALE + «+2» affordance opening the drawer). <1024 (desk
roles on phone): 2-line card rows (name+factory / sale price+date), read-and-approve; create
stays available, bulk sheet shows «kompyuterda qulayroq» note.

### 1.11 Removed vs today

- Icon-only edit/stop buttons + 190px Amallar column → labeled kebab (a11y law, `02` §10).
- Enter-only `Input.Search` → live debounced search (pain point, consistency).
- Create/edit **Modal** → 480px right drawer (one surface per intent, `04` grammar).
- Interleaved 3-kind history table (no current marker) → per-kind tabs with pinned
  «amaldagi» + «kelgusi» badges (pain point: invisible future prices, double-entry risk).
- Bare price numbers → price + effective-from date on the register (pain point).
- Nothing else is lost: every field of the old modal, the factory filter, search, versioning
  note, deactivate flow and full history survive.

### 1.12 Locked rules visibly handled

Append-only price book (no edit/delete affordances; versioning note at the point of entry);
6dp precision never rounded (`729 928,1` renders as stored); current = latest
`effectiveFrom ≤ now` (pinned row); factoryId immutable (disabled field + reason);
soft-delete only (Nofaol chip, symmetric reactivate); AGENT price stripping (route absence).

---

## 2. `/products/reprice` — Narxlarni yangilash (bulk price sheet)

### 2.1 Purpose

Factory-wide repricing in one sitting — the ~100-interaction click marathon dies. Output:
N versioned `POST /products/:id/prices` rows sharing one `effectiveFrom`.

### 2.2 Layout

Full-page editable sheet (`04` grammar «Bulk price edit»), URL
`/products/reprice?factoryId=<id>`.

```
┌ PageHeader ──────────────────────────────────────────────────────────────────┐
│ Mahsulotlar / Narxlarni yangilash                                            │
│ Narxlarni yangilash — CAOLS KS      [Zavod: CAOLS KS ▾]  [Bekor qilish]      │
├ Toolbar ─────────────────────────────────────────────────────────────────────┤
│ Kuchga kirish sanasi [11.07.2026 ▾]   Tez to'ldirish: [ +X % ▾ ustun tanlang]│
│ [Tozalash]                                                                   │
├ Sheet (DataTable, editable) ─────────────────────────────────────────────────┤
│ Mahsulot        │ Sotish narxi        │ Zavod naqd         │ Zavod o'tkazma  │
│                 │ joriy      yangi    │ joriy     yangi    │ joriy    yangi  │
│ Gazoblok D500   │ 729 928,1 [750 000] │ 625 000  [       ] │ 640 000 [660 000]│
│ Gazoblok D600   │ 810 000   [       ] │ …                                    │
├ Sticky footer bar (e2) ──────────────────────────────────────────────────────┤
│ 7 ta yangi narx yoziladi · eski buyurtmalarga ta'sir qilmaydi                │
│                                              [Saqlash — 7 ta narx  Ctrl+⏎]  │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 2.3 Components & data

- **Factory picker:** `PartySelect` over `GET /factories`; empty state until picked
  («Zavodni tanlang — uning barcha mahsulotlari jadvalga tushadi»).
- **Grid rows:** `GET /products?factoryId=<id>&pageSize=200` (API cap 200; if
  `total > 200` a pager appears with the honest note «bir sahifada 200 tagacha»). «joriy»
  cells read `prices.<kind>.pricePerM3` (stored precision, tertiary when absent: «narx
  yo'q»); «yangi» cells are `MoneyInput` 6dp, empty by default — **only touched cells POST**.
- **One effectiveFrom** (`DateRangeControl`'s single-date sibling — plain DatePicker,
  default bugun, footer notes Tashkent-day basis; future date caption «kelgusi narx
  sifatida»).
- **«+X %» quick fill:** popover — percent input (2dp, may be negative) + kind checkboxes
  (Sotish / Naqd / O'tkazma) → fills `yangi = joriy × (1 + X/100)` for rows that have a
  joriy, labeled «taxminiy — server tasdiqlaydi» is unnecessary (pure client fill the user
  confirms); filled values render selected so one keystroke replaces them (`MoneyInput`
  contract).
- **Deviation hint:** a yangi value differing from joriy by >±50% gets an amber inline
  caption «joriy narxdan keskin farq — tekshiring» (warn, never block).
- **No-op guard:** yangi == joriy renders the cell caption «o'zgarmagan — yozilmaydi» and is
  excluded from the count.
- **Save:** sequential `POST /products/:id/prices` per changed cell (kind, pricePerM3,
  effectiveFrom). Progress renders per-row: a trailing result column fills ✓ green /
  ✗ danger with the **server message verbatim** («Shu tur va shu vaqt uchun narx allaqachon
  kiritilgan»). Succeeded cells lock (become joriy); failed cells stay editable; footer
  flips to «5/7 yozildi · 2 ta xato — Qayta urinish (faqat xatolar)». Partial completion is
  honest, never silent.
- **Draft resume:** sheet state persists to sessionStorage per route (`02` §9 form-resume
  law); cleared on full success or explicit cancel. Dirty close intercepted.

### 2.4 Filters & URL

`/products/reprice?factoryId=<id>`. No other params; the sheet is a composer, not a
register.

### 2.5 Keyboard

`Tab/Shift+Tab` cell walk (row-major through yangi cells), `Ctrl+Enter` save, `Esc` cancel
with dirty-check. Entry points: `/products` header button; command palette action
«Narxlarni yangilash» (A/B).

### 2.6 States, roles, responsive

Loading: skeleton grid (8 rows). Error loading products: `ErrorState` in place. Empty
factory: «Bu zavodda mahsulot yo'q — Yangi mahsulot». Roles A B; G/K → 403. <1024: page
renders read-only joriy table + «kompyuterda qulayroq» note (heavy entry posture, `03` §11).

### 2.7 Removed vs today

Nothing removed — this screen is net-new (pain point: no bulk entry, no copy-from-current,
no percent uplift). The single-price drawer remains for one-off changes.

---

## 3. `/procurement?tab=matritsa` — Ta'minot matritsasi

### 3.1 Purpose

Landed-cost decision support per region: «bu haftada fura qaysi zavoddan olib kelinsin?»
Formula (locked): `yetkazilgan tannarx = zavod o'tkazma narxi + fura narxi / (sig'imi ×
m³/paddon)`. Dropped products are surfaced with a reason **and a fix path** — never
silently hidden.

### 3.2 Layout

```
┌ PageHeader ──────────────────────────────────────────────────────────────────┐
│ Ta'minot / Ta'minot matritsasi                                               │
│ Ta'minot matritsasi                                    [Yangi tarif]         │
│ [ Matritsa ]  [ Marshrutlar ]                    ← tabs, ?tab=               │
├ FilterBar ───────────────────────────────────────────────────────────────────┤
│ [Hudud: Urganch ×] [Mahsulot: barchasi ▾]  Ko'rinish: (Mahsulot bo'yicha ▪ | │
│                                                        Umumiy ro'yxat)      │
│ formula caption: «Yetkazilgan tannarx = zavod o'tkazma narxi + fura narxi /  │
│ (sig'imi × m³/paddon)» — small, secondary                                    │
├ Grouped DataTable ───────────────────────────────────────────────────────────┤
│ ── Gazoblok D500 · 600×300×200 ──────────────────────── (overline group h.) │
│ Zavod       Zavod narxi  Fura narxi  Sig'imi  Fura hajmi  Yetk. tannarx     │
│ CAOLS KS ●Eng arzon  625 000   2 000 000   19    32,832 m³   685 902,44     │
│ XON ZAVOD            640 000   1 800 000   19    32,832 m³   694 823,12     │
│ ── Gazoblok D600 … ─────────────────────────────────────────────────────────│
├ «Hisobga kirmagan mahsulotlar (3)» panel ────────────────────────────────────┤
│ Gazoblok D700 · XON ZAVOD  «FACTORY_BANK narxi kiritilmagan» [Narx kiritish→]│
│ Gazoblok D500 · YANGI Z.   «Bu hudud uchun marshrut yo'q» [Marshrut qo'shish→]│
└──────────────────────────────────────────────────────────────────────────────┘
```

### 3.3 Components & data

| Instance | Data |
|---|---|
| PageHeader + tabs | tabs synced to `?tab=matritsa\|marshrutlar`; header action «Yangi tarif» opens the routes drawer (§4) from either tab |
| FilterBar | Hudud (`GET /regions`, required for data; **defaults to the last-used region** — localStorage `sb_region:<userId>` — so the page is never pointlessly blank; until one exists: EmptyState «Taqqoslash uchun hududni tanlang»); Mahsulot (options `GET /products?pageSize=200`, label «Nomi (o'lcham) — Zavod»); Ko'rinish segmented (grouped default / flat) |
| Matrix | `GET /procurement/matrix?regionId&productId` → `{region, cheapest, rows[], dropped[]}`. Row fields: `factory` (links `/factories/:id`) · `factoryPricePerM3` · `costPerTruck` · `capacityPallets` · `truckM3` (3dp m³) · `landedCostPerM3` (`body-strong`). Columns carry units once in headers («(so'm/m³)», «(so'm)», «(paddon)») |
| Grouping | **client-side group by `productId`** (the payload is complete and unpaged — grouping is exact, no honesty caveat). Group header: product + size, `h3`/overline style, sticky. Within a group rows sort landed asc; the first row gets the green dot chip «Eng arzon» — the apples-to-oranges global trophy dies. Flat view: one table sorted landed asc; only the true global cheapest row gets the chip + a one-line banner «Eng arzon: CAOLS KS — Gazoblok D500 — 685 902,44 so'm/m³ (Urganch hududiga yetkazilgan holda)» |
| Dropped panel | `dropped[]` rows: Mahsulot · Zavod · Sabab (amber dot chip, reason text verbatim) · fix link: reason «FACTORY_BANK narxi kiritilmagan» → «Narx kiritish →» = `/products?factoryId=<id>&panel=narx&productId=<id>` (drawer opens on FACTORY_BANK tab); reason «Bu hudud uchun marshrut yo'q» → «Marshrut qo'shish →» = `/procurement?tab=marshrutlar&panel=yangi&factoryId=<id>&regionId=<current>` (drawer pre-filled). The `03` §9 cross-link contract, closed |

No pagination (matrix payload is whole). No row kebab — rows are comparisons, not records;
the factory name is the drill link.

### 3.4 Filters & URL

`/procurement?tab=matritsa&regionId&productId` (per `03` §7) + `view=flat` for the segmented
toggle (SavedView-free page; the toggle is a URL param so links share the exact view).

### 3.5 Keyboard

`/` focuses the region select, `F` filter adder, `J/K` row cursor, `Enter` on a row →
`/factories/:id`. `N` = «Yangi tarif» (page primary create).

### 3.6 States

Skeleton table on first load (header + 8 rows). No region chosen: EmptyState with the region
select focused. Matrix error: `ErrorState` with server text + «Qayta urinish» (page chrome
and tabs survive). Empty matrix with dropped rows only: the dropped panel promotes to the
top with the line «Hech bir mahsulot taqqoslashga kirmadi — sabablarini quyida ko'ring».

### 3.7 Roles

A B only (matrix exposes factory cost — locked). G/K: no nav, 403 route.

### 3.8 Responsive

1200↓: Fura hajmi folds into row expand; ≤1023: 2-line rows (zavod + chip / landed cost);
the table scrolls inside its own container, the page never scrolls horizontally.

### 3.9 Removed vs today

- Global-only «Eng arzon» trophy across different products → per-product-group cheapest
  (pain point: misleading purchasing signal). Global banner survives only in flat view where
  it is honest.
- Blank-page-until-region → remembered default region.
- Success-Alert banner box → quiet one-line banner (chrome yields to numbers).
- Dead-end dropped rows → fix links. Formula caption, all 8 columns, dropped reasons —
  all survive.

---

## 4. `/procurement?tab=marshrutlar` — Marshrutlar (NEW: logistics routes CRUD)

### 4.1 Purpose

First UI over the existing `GET/POST /procurement/routes`: the versioned factory×region
tariff book (cost per truck + capacity). Fixes «Bu hudud uchun marshrut yo'q» dead-ends and
stops dispatchers re-typing 2 000 000 from memory.

### 4.2 Layout

```
├ FilterBar ───────────────────────────────────────────────────────────────────┤
│ [Zavod: barchasi ▾] [Hudud: barchasi ▾]                    «14 ta»           │
├ DataTable ───────────────────────────────────────────────────────────────────┤
│ Zavod      Hudud     Fura narxi (so'm)  Sig'imi  Kuchga kirgan     Holat     │
│ CAOLS KS   Urganch   2 000 000          19       01.06.2026 09:00  ● amaldagi│
│ CAOLS KS   Urganch   1 800 000          19       01.01.2026 00:00  eskirgan  │
│ CAOLS KS   Xiva      2 200 000          19       15.07.2026 00:00  ⚑ kelgusi │
│ … row kebab: [Shu yo'nalishga yangi tarif]                                   │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 4.3 Components & data

| Instance | Data |
|---|---|
| DataTable | `GET /procurement/routes?factoryId&regionId&page&pageSize=50` → paged rows `{factory{name}, region{name}, costPerTruck, capacityPallets, effectiveFrom}` desc by `effectiveFrom`. Columns as sketched; Fura hajmi is NOT shown (it is product-dependent — matrix territory) |
| Holat chip | computed client-side **within the loaded result set** per (factory, region) pair: newest `effectiveFrom ≤ now` = «amaldagi» (green dot), `> now` = «kelgusi» (blue dot), rest «eskirgan» (plain tertiary text). When the pair's history spans past the current page (pagination truncation), the chip renders «—» with tooltip «to'liq tarix uchun zavod/hudud filtrini qo'llang» — never a guessed status (honesty law) |
| «Yangi tarif» drawer | 480px right drawer (`04` grammar), URL `?panel=yangi&factoryId&regionId`. Fields: Zavod (`PartySelect`, `GET /factories`) → Hudud (select, `GET /regions`) → Fura narxi (so'm) (`MoneyInput`, whole so'm) → Sig'imi (paddon) (InputNumber 1–40, **pre-filled from `GET /settings` `truckCapacityPallets`**, helper «Tizim sozlamasidan: 19 paddon» — deviation from the setting shows a quiet hint) → Kuchga kirish sanasi (default hozir; future → caption «kelgusi tarif sifatida yoziladi») → info line «Marshrut versiyalanadi — eski hisob-kitoblarga ta'sir qilmaydi». Submit `POST /procurement/routes` (Ctrl+Enter) |
| Collision pre-check | if a loaded row matches (factory, region, same date) an inline warning appears before submit; the server duplicate error renders verbatim: «Shu zavod-hudud jufti uchun aynan shu vaqtdan kuchga kiruvchi marshrut allaqachon mavjud» |
| Row kebab | «Shu yo'nalishga yangi tarif» — opens the drawer with factory+region+capacity pre-filled from the row (the version-bump path) |

No edit, no delete, anywhere — routes are append-only like prices, and the UI's lack of
those verbs is the rule made visible.

### 4.4 Filters & URL

`/procurement?tab=marshrutlar&factoryId&regionId&page&panel=yangi` (extends `03` §7 —
`factoryId` is honored by the API, so the control ships).

### 4.5 Keyboard

`N` new tarif, `/`→ first filter, `J/K` cursor, `.` kebab, drawer `Ctrl+Enter`/`Esc`.

### 4.6 States

First load: 8 skeleton rows. Empty (no routes at all): «Hali marshrut yo'q — Yangi tarif».
Filtered-empty: standard variant. Create success: toast «Tarif saqlandi», list refetch,
new row pulses (realtime law); if the matrix tab is revisited its query refetches (routes
invalidate the matrix key family).

### 4.7 Roles / responsive / removed

A B only. Responsive: ≤1023 two-line rows (yo'nalish / narx+holat). Removed vs today:
nothing — this tab is net-new (the API had zero UI).

---

## 5. `/vehicles` — Moshinalar (fleet register)

### 5.1 Purpose

The fleet + driver-liability register: which trucks exist, who drives them, and **whom we
owe**. Rows stop being terminal — every row opens the new settlement hub (§6). Nav badge:
«Shofyorlarga qarz» count (worklist #8, computed from this list payload).

### 5.2 Layout

```
┌ PageHeader ──────────────────────────────────────────────────────────────────┐
│ Ta'minot / Moshinalar                                                        │
│ Moshinalar                                   [Yangi moshina ⏎N]              │
├ FilterBar ───────────────────────────────────────────────────────────────────┤
│ [⌕ Nomi / raqami / shofyor… /] [Qarzdorlar] ← chip=owed     «9 ta»           │
├ DataTable ───────────────────────────────────────────────────────────────────┤
│ Moshina     Davlat raqami  Shofyor      Telefon      Sig'imi  Balans   Holat │
│ Isuzu 01    01 A 774 BC    Baxtiyor     +998 …       19       Qarzimiz  Faol │
│                                                               4 000 000      │
│ Howo 2      01 B 220 AA    Rustam       —            19       Hisob     Faol │
│                                                               yopiq          │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 5.3 Components & data

| Instance | Data |
|---|---|
| FilterBar | `GET /vehicles?search&page&pageSize=50` — **server** search over name/plate/driver (the client-side filter dies); «Qarzdorlar» chip = `chip=owed` recipe: client-side filter `balance < 0` over the loaded result, window label on the chip «yuklangan 50 ta qator ichida» when `total > pageSize` (honesty governance, `03` §6) |
| DataTable | columns: Moshina (`name`, identity link) · Davlat raqami (`plate`, `.num` fixed-width) · **Shofyor** (`driver` — canonical term app-wide, «Haydovchi» dies) · Telefon (`phone`, `tel:` link) · Sig'imi (paddon) (`capacityPallets`) · Balans (`BalanceTag` partyType=vehicle: `balance<0` → amber «Qarzimiz 4 000 000»; `>0` → green «Avansimiz N»; `|bal|<1` → grey «Hisob yopiq») · Holat («Faol»/«Nofaol») · kebab. Whole row click → `/vehicles/:id`; sort disabled-with-tooltip (API sorts name asc only) |
| Row kebab | «Ko'rish» · «Shofyorga to'lash» (`T` — PaymentComposer VEHICLE_OUT pre-bound to the vehicle) · «Tahrirlash» (`E`) · «Nofaol qilish»/«Faollashtirish» (confirm: «Tarix saqlanadi, o'chirilmaydi» → `DELETE /vehicles/:id` / `PUT {active:true}`) |
| Create/edit drawer | 480px right drawer over `POST /vehicles` / `PUT /vehicles/:id`: Nomi (required) · Davlat raqami (unique — server error verbatim «Bu davlat raqamli moshina allaqachon mavjud») · Shofyor · Telefon · Sig'imi (paddon) (1–40, default 19, helper «Bitta furaga sig'adigan paddonlar soni (standart 19)») |
| Nav badge | count of `balance < 0` rows from the same query (fleet-scale, pageSize 50; the WorklistCard on `/` states the window when truncated) |

### 5.4 Filters & URL

`/vehicles?search&chip=owed&page&pageSize`.

### 5.5 Keyboard

List set: `/`, `N`, `J/K`, `Enter` (open hub), `Space` — no peek on this register (the hub
is one keystroke away and the row carries no money document), `X` unused, `.` kebab, `T`
pay driver, `E` edit.

### 5.6 States

Skeletons; empty «Hali moshina yo'q — Yangi moshina»; filtered-empty standard; errors per
platform law. Realtime: payment/order writes pulse affected rows (balance re-fetched via the
2s-coalesced invalidation).

### 5.7 Roles

A B full. G: server returns the order-form shape (no balance) but G has **no route** here —
vehicles reach agents only inside the order composer's `PartySelect`. K: no access (driver
payments launch from `/payments` and the kassa terminal).

### 5.8 Responsive

1200↓: Telefon folds into expand; ≤1023: 2-line rows (name+plate / BalanceTag+driver);
<768 desk-role phones: card list, tap → hub.

### 5.9 Removed vs today

- Client-side search over the loaded page → server search/pagination (pain point: invisible
  matches).
- Signed raw `Money` + red «Qarzimiz» tag → `BalanceTag` (sign conventions live in
  components; red freed for collections surfaces — driver debt is amber `moneyWeOwe`).
- Icon-only edit/stop → labeled kebab; edit Modal → drawer.
- Terminal rows → row click opens §6. Nothing else lost.

---

## 6. `/vehicles/:id` — Shofyor hisob markazi (NEW: driver settlement hub)

### 6.1 Purpose

The screen `GET /vehicles/:id` always deserved: one place where the driver's balance, his
unpaid trucks, and the settle action live together — hero workflow (d). The cross-page trek
(order → payments → re-find vehicle → re-find order) dies.

### 6.2 Layout

```
┌ PageHeader (sticky-condensed on scroll) ─────────────────────────────────────┐
│ Moshinalar / Isuzu 01                                                        │
│ Isuzu 01  ● Faol   01 A 774 BC · Shofyor: Baxtiyor · ☎ +998… · Sig'imi: 19 pd│
├ PartyBalanceHeader ──────────────────────────────────────────────────────────┤
│ Shofyorga qarzimiz: 4 000 000 so'm            [Shofyorga to'lash T]          │
│ (money-hero, amber)                           [Mijoz to'lagan deb yozish] [⋯]│
├ «To'lanmagan yuklar (2)» panel ──── window: «oxirgi 50 reys ichida» ─────────┤
│ ☑ ORD-000101  05.07  Жамол Ургенч   2 000 000   ● To'lanmagan                │
│ ☑ ORD-000107  08.07  Гофур Хазорасп 2 000 000   ? Aniqlanmagan (violet)      │
│ └ BulkBar (e2): «2 ta tanlandi · Σ 4 000 000 · [Shofyorga to'lash]»          │
├ Tabs  [ Hisob-kitob ]  [ Reyslar (50) ]        ?tab= ────────────────────────┤
│ PartyStatement: period chips · opening row · rows · closing row              │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 6.3 Components & data

All data from **one call**: `GET /vehicles/:id` →
`{ name, plate, driver, phone, capacityPallets, active, balance, statement[], orders[≤50] }`.

| Instance | Spec |
|---|---|
| PartyBalanceHeader | `04` §2.3. Sentence from `balance`: `<0` → «Shofyorga qarzimiz: 4 000 000 so'm» (amber ink); `>0` → «Shofyorda avansimiz: N so'm» (green); `\|bal\|<1` → «0 so'm · Hisob yopiq» grey chip. Meta chips: plate (`.num`), Shofyor name, phone (tap-to-call), «Sig'imi: 19 paddon». Inactive vehicle: grey wash + «Nofaol» pill. Actions (PERMISSIONS-filtered): primary **«Shofyorga to'lash»** (`T`) — PaymentComposer VEHICLE_OUT, vehicle locked, **amount pre-filled with \|balance\|** when negative (rendered selected); secondary **«Mijoz to'lagan deb yozish»** — PaymentComposer TRANSPORT_DIRECT, vehicle locked, client picked in-form (or pre-bound when launched from an order row), cashbox absent with the fixed line «Bu to'lov kassadan o'tmaydi — mijoz hisobidan kamayadi, shofyor hisobi yopiladi»; overflow kebab: Tahrirlash (`E`, drawer §5.3) · Nofaol qilish/Faollashtirish |
| To'lanmagan yuklar panel | from `orders[]`: rows where `transportPaidStatus ∈ {UNPAID, UNKNOWN}` (CANCELLED excluded), oldest-first, window labeled **«oxirgi 50 reys ichida»** (the payload cap — honesty law). Row: checkbox · order no (link) · sana · mijoz (link) · Transport qoldig'i · `StatusChip` (To'lanmagan danger dot / **Aniqlanmagan violet filled `?`**). Qoldiq resolution: UNKNOWN ⇒ full `transportCost` (no payment evidence by definition — locked derivation rule); UNPAID ⇒ lazily resolved per row from `GET /orders/:id` allocations (per-cell micro-spinner, `05` §A) since the vehicle payload carries no coverage sums. All rows **checked by default**; `X`/`Shift+↑↓` adjust |
| BulkBar | `04` §1.8: «N ta tanlandi · Σ X · Shofyorga to'lash» → PaymentComposer VEHICLE_OUT with amount = Σ and «Saqlash va taqsimlash» pre-checked → SettleDrawer **pre-built from the checked trucks** at their qoldiq amounts, «Taqsimlanmagan qoldiq: 0». Footer impact: «2 ta buyurtma transporti TO'LANDI holatiga o'tadi». Mixed selection with an UNKNOWN row: allowed — recording the real payment IS the UNKNOWN resolution (`05` §4.5); the impact line adds «1 ta Aniqlanmagan holat haqiqiy to'lov bilan yechiladi» |
| Tab «Hisob-kitob» (default) | `PartyStatement` (`04` §2.4) over `statement[]` (already running-balanced server-side). `?from&to` window filters **client-side over the complete in-memory history** — exact, and labeled «to'liq tarixdan hisoblangan»; opening row = running balance before the window. Row labels via shared `LEDGER_SOURCE`: «Reys xizmati · ORD-000101» (TRANSPORT_COST, links the order), «Shofyorga to'lov · Naqd» (VEHICLE_OUT, links `/payments/:id` peek), «Mijoz shofyorga to'ladi — mijoz krediti + shofyor hisobi yopildi» (TRANSPORT_DIRECT double effect in words), storno pairs chained with the gutter connector; ghost rows per `02` §6 |
| Tab «Reyslar (50)» | all `orders[]` rows, window labeled: Buyurtma (link) · Sana · Mijoz (link) · Zavod (link) · Holat (`StatusChip`) · Transport turi (Mijozning o'z transporti / Diler hisobidan / Mijozdan olinadi) · Tannarx (so'm) · Mijozdan (so'm) (`transportCharge`, NOT_APPLICABLE renders —) · To'lov holati (`StatusChip`; NOT_APPLICABLE = em-dash, never a chip) · kebab («Ko'rish» · «Shofyorga to'lash» · «Mijoz to'lagan deb yozish» pre-bound to order+client). CANCELLED rows ghost-styled |

### 6.4 URL params

`/vehicles/:id?tab=hisob|reyslar&from&to` (per `03` §7). Composer surfaces are drawers over
the page (idempotency key per open; success state offers «Kvitansiya chop etish» →
`/print/receipt/:paymentId` — the guard refusing TRANSPORT_DIRECT receipts applies).

### 6.5 Keyboard

`T` pay driver · `E` edit · `X` toggle row in the unpaid panel · `Esc` clears selection /
closes topmost surface · in SettleDrawer `A` FIFO fill · `Ctrl+Enter` submit. Full sweep:
`x x t Ctrl+Enter` per driver (`05` §4).

### 6.6 States

Detail loading: skeleton of the real layout (balance block, panel rows, tab bar, 6 statement
rows). Error: `ErrorState` in place, chrome survives. Empty unpaid panel: green one-liner
«To'lanmagan yuk yo'q ✓» (a clean driver is visibly clean). Empty statement period:
opening = closing rows still render. Realtime: socket events on payments/orders touching
this vehicle coalesce 2s → refetch; if a composer is open, the amber ribbon «Bu hujjat
boshqa foydalanuvchi tomonidan o'zgartirildi — Yangilash» (never silent overwrite). Balance
refetches on composer open (stale-balance law).

### 6.7 Roles

A B only (route + API). K pays drivers from its own surfaces; G never sees vehicle
financials (locked). 403 elsewhere.

### 6.8 Responsive

1024–1199: the money rail behavior n/a (single column already); header condenses. ≤1023:
panel rows 2-line; BulkBar full-width bottom. <768: read-and-approve — balance, unpaid list,
statement readable; «Shofyorga to'lash» still works (composer as bottom sheet).

### 6.9 Removed vs today / business rules

Net-new screen (the API had zero consumers). Locked rules visibly handled:
`transportPaidStatus` is **derived** — no manual status flip exists anywhere, resolution is
always a real payment; VEHICLE_OUT allocates only to this vehicle's orders (candidates ARE
the panel — the 100-recent-orders client-side filter dies); TRANSPORT_DIRECT never touches
kassa (fixed info line + no cashbox field); balance < 0 ⇒ Qarzimiz phrasing; partial
coverage stays «To'lanmagan» (a 1-so'm allocation can't read as paid — qoldiq column shows
the remainder); UNKNOWN ≠ NOT_APPLICABLE (violet `?` chip vs em-dash); driverName on orders
is a snapshot (the Reyslar tab renders order-time data, header renders current
`Vehicle.driver`).

---

## 7. Yuridik shaxslar — `/references?tab=yuridik` (+ payment-form pickers)

### 7.1 Purpose

The audited legal-entity catalog (DEALER / FACTORY / THIRD_PARTY firms) — and, at last, the
thing it exists for: **entity pickers in the payment composer**, so bank-payment attribution
to «Септем Алока»/«CAOLS KS» stops depending on typed names. `/legal-entities` dies as a
route (301 → `/references?tab=yuridik`).

### 7.2 Layout (the tab body inside `/references`)

```
│ [ Hududlar ]  [ Yuridik shaxslar ]  [ Xarajat kategoriyalari ]   ?tab=       │
├ FilterBar ───────────────────────────────────────────────────────────────────┤
│ [⌕ Nomi / INN… /]  Holat: (Faol ▪ | Nofaol | Hammasi)   [Yangi yuridik shaxs]│
├ DataTable ───────────────────────────────────────────────────────────────────┤
│ Nomi                Turi            INN         Izoh        Holat            │
│ Септем Алока        Diler firmasi   30489…      —           Faol             │
│ "CAOLS KS" MCHJ     Zavod firmasi   20177…      —           Faol             │
│ …kebab: Tahrirlash · Nofaol qilish/Faollashtirish                            │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 7.3 Components & data

| Instance | Data |
|---|---|
| DataTable | `GET /legal-entities` (unpaged, complete, name asc) — search + Holat segmented filter are **client-side over the full list** (complete data ⇒ no honesty caveat; result meta «N ta» reflects the filter). Columns: Nomi · Turi (plain dot-style chip, neutral ink — kind is categorical, not money-semantic: «Diler firmasi» / «Zavod firmasi» / «Uchinchi tomon») · INN (`.num`) · Izoh (ellipsis, full in expand) · Holat («Faol»/«Nofaol»). Default view: Faol (Nofaol rows reachable via the segmented control, rendered grey-washed) |
| Create/edit drawer | 480px right drawer: Nomi (unique — server error verbatim) · Turi (segmented 3) · INN · Izoh. `POST /legal-entities` / `PUT /legal-entities/:id` |
| Activate toggle | **one** path (the duplicate stop-button + edit-switch pair dies): kebab «Nofaol qilish» → confirm «„Септем Алока" nofaol qilinadi — to'lovlar tarixi saqlanadi» → `DELETE /legal-entities/:id` (soft); «Faollashtirish» on Nofaol rows → `PUT {active:true}`. Never hard-deleted — no delete verb exists in the UI |

### 7.4 `LegalEntitySelect` wiring (the pickers, `04` §2.11)

Consumes the same cached `GET /legal-entities` query (K is allowed on this GET precisely for
this). Anatomy: options grouped by kind with overline group labels («Diler firmalari»,
«Zavod firmalari», «Uchinchi tomon»); option row = name + INN (`small`, tertiary); inactive
entities excluded from options (history still renders their names on old payments);
client-filtered as-you-type (list is complete). Footer: «Yangi qo'shish» inline-create
(A/B only → mini-form name+kind → POST → auto-selected). **Free-text fallback:** typing a
string with no match offers the last option «„<matn>" — matn sifatida yozish», which
submits `payerName`/`receiverName` instead of an entity id — imported card-number receivers
and one-off payers stay possible, never blocked.

Placement per payment kind in `PaymentComposer` (`04` §3.3):

| Kind | Kimdan (payer) | Kimga (receiver) |
|---|---|---|
| CLIENT_IN («To'lov qabul qilish») | LegalEntitySelect, optional — THIRD_PARTY group first (client-side firms); fallback free-text | LegalEntitySelect, DEALER group first, **pre-filled with the last-used DEALER entity** (localStorage) |
| FACTORY_OUT («Zavodga to'lash») | DEALER group first | FACTORY group first, pre-picked by the bound factory's matching entity name when unambiguous («"CAOLS KS" MCHJ») |
| VEHICLE_OUT («Shofyorga to'lash») | DEALER group first | free-text default (drivers are not entities) — picker available |
| TRANSPORT_DIRECT | fixed line — no picker (mijoz → shofyor, kassadan o'tmaydi) | — |

The `PrintDocument` toolbar's dealer-letterhead select (`04` §4.7) reads the DEALER-kind
rows of this same catalog (name + INN) — one truth for «who are we on paper».

### 7.5 URL, keyboard, states, roles, responsive

URL: `/references?tab=yuridik` (redirect from `/legal-entities` kept). Keyboard: list set
(`/`, `N`, `J/K`, `.`; `Enter` opens edit drawer). States: skeletons; empty «Hali yuridik
shaxs yo'q — Yangi yuridik shaxs»; errors per law. Roles: tab A B (writes A B); K reads the
catalog only through pickers. Responsive: ≤1023 2-line rows (name+kind / INN+holat).

### 7.6 Removed vs today

- Standalone route/page → References tab (IA consolidation; 301 kept).
- Two deactivation paths with different affordances → one toggle with confirm.
- Edit Modal + Active switch inside it → drawer + row-level toggle.
- Icon-only buttons → labeled kebab. Fields, search (name/INN), kind labels and colors'
  *meaning* (labels), soft-delete semantics — all survive.
- **Added, not removed:** the pickers — the catalog finally drives daily payments instead
  of being write-only.

---

## 8. Cross-cutting acceptance notes for this spec

1. Every table above obeys `02` §6 (36px rows, sticky overline headers, one colored column
   max — here only Balans/BalanceTag columns carry semantic ink).
2. Every number drills: matrix factory → `/factories/:id`; vehicle rows → hub; hub orders →
   `/orders/:id`; hub payments → `/payments/:id` peek; dropped reasons → their fix; nav
   badge → `/vehicles?chip=owed`. Reverse test (`03` §9) passes: from any figure to its
   postings ≤2 clicks.
3. Append-only surfaces (price book, routes) expose **no** edit/delete verbs — absence of
   affordance is part of the spec.
4. All client-derived figures/windows are labeled in place («oxirgi 50 reys ichida»,
   «yuklangan 50 ta qator ichida», lazy qoldiq spinners) — nothing renders more settled
   than the server says (honesty law, `02` §1.6).
5. No new endpoints; the only param-table extensions are UI-side drawer addresses
   (`panel=narx&productId=`, `panel=yangi&factoryId&regionId`, `view=flat`) following the
   existing `panel=`/`view=` conventions of `03` §7.
