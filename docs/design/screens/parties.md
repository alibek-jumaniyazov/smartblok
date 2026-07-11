# SmartBlok — Screen Spec: Parties (Mijozlar · Agentlar · Hududlar)

**Status:** implementation-ready screen spec, v1. Governed by `02-design-language.md` (tokens,
money semantics, platform state law), `03-shell-and-ia.md` (shell, routes, URL contract,
keyboard map), `04-components.md` (component anatomy), `05-hero-workflows.md` (flows §1, §2,
§6.4). Nothing here overrides those documents; where this spec names a component, its anatomy
and states are the 04 spec verbatim.

**Screens covered:**

| # | Screen | Route | Roles |
|---|---|---|---|
| 1 | Mijozlar (register) | `/clients` | A B G(own) |
| 2 | Mijoz kartasi (party page) | `/clients/:id` | A B G(own) |
| 3 | Agentlar (register) | `/agents` | A B |
| 4 | Agent kartasi | `/agents/:id` | A B (G's own card lives at `/me` — separate spec) |
| 5 | Hududlar | `/references?tab=hududlar` (`/regions` → 301) | A B |

---

## 0. Verified API facts this spec is built on (checked against `apps/api/src` 2026-07-11)

| # | Fact | Consequence in this spec |
|---|---|---|
| a | `GET /clients` accepts **only** `page` (default 1), `pageSize` (≤200, default 50), `search` (name/phone/alias, insensitive). Rows carry `region{id,name}`, `agent{id,name}`, `phone`, `active`, `creditLimit`, `paymentTermDays`, `legalEntity`, `balance` (ledger Σ), `palletBalance` (units). | Region/agent/status filter **controls are specced but verify-gated** (03 §7 star rule): they ship only when the API honors `?regionId/?agentId/?status`. Today it does not → controls hidden, never silently ignored. Backlog note per honesty governance (03 §6): the fix is three query params on the existing endpoint, never a client-side fake. |
| b | `GET /debts/clients?days&search&page&pageSize` returns **every** client with a nonzero balance, pallet balance, or overdue order (agent-scoped), each row with `balance`, `palletBalance`, `hasOverdueOrders`, `overdueOrdersCount`, `overdueOrdersTotal`, `dueWithinWindow`, `creditLimit`, `agent`, `region` + `expectedCollections`. Server-computed over the full ledger, then paged. | This is the honest engine for the `/clients` **chip queues** (Qarzdor · Limit chegarasida · Paddonli) and for the ClientDetail header's OverdueChip. Chips are exact (server-computed set), not a window. |
| c | `GET /debts/statement?account=CLIENT&partyId&from&to` returns `openingBalance`, chronological `entries` (each: `date`, `source`, `amount`, `running`, `note`, `orderId`, `order{orderNo}`, `payment{kind,method}`), `closingBalance`, `party{id,name}`. | PartyStatement and the akt sverki print are fed by this — the 20-row cap and the missing opening balance die. |
| d | Statement entries' `payment` select carries **kind + method only** — no `reconciled` flag. | The amber «Tekshirilmagan» dot on statement rows (04 §2.4) is **verify-gated**: ships when the one-line select adds `reconciled`. Fallback: no dot on statement rows (the To'lovlar tab, fed by `GET /payments`, does carry it). |
| e | `UpdateClientDto` has **no `active` field**; `DELETE /clients/:id` (ADMIN) refuses unless balance is settled («Balans nolga teng emas»). | «Faollashtirish» for clients is gated on the one approved DTO change (03 §10d). If it never lands: the action hides entirely and the «Nofaol» chip's tooltip states the gap — never a fake toggle. |
| f | `GET /agents` (A/B, **unpaginated**, ordered `sortNo, name`) rows: `clientCount`, `outstandingDebt` (Σ positive client balances only), `debtLimit` (**effective** — own or global default), `ownDebtLimit`, `active`, `phone`, `sortNo`. | Register renders the complete dataset; client-side quick-search/facets over it are exact, not a window (allowed: full set in hand). Column sort headers otherwise disabled-with-tooltip per 02 §6. |
| g | `GET /agents/:id` (A/B + AGENT for own id) returns all his clients (name asc, with `region`, `balance` — **no** pallet/overdue per row) + all-time `kpi{ordersCount, saleTotal, goodsProfit, collected, outstandingDebt, palletExposure}` + effective/own debtLimit. `GET /agents/me` (AGENT) returns the card shape only. | AgentDetail portfolio board and KPI band come from one payload. Monthly figures come from `GET /dashboard/agents-ranking?month=YYYY-MM` (A/B only). |
| h | `PUT /agents/:id`: `active` writable by A **and** B; `debtLimit` silently stripped unless ADMIN; audit note «debtLimit changed». `DELETE /agents/:id` A-only (soft). | Faollashtirish/Deaktivatsiya for agents ships for A/B via `PUT {active}`. debtLimit field renders for ADMIN only; ACCOUNTANT sees the value read-only with a lock note — a field the server would strip is never shown editable. |
| i | `GET /regions` (A/B/G) unpaginated with `_count.clients`; `DELETE /regions/:id` (A/B) hard-deletes, refused while clients **or logistics routes** reference it («Hudud mijozlar yoki marshrutlarda ishlatilmoqda — o'chirib bo'lmaydi»). Route references are **not** in the list payload. | Delete pre-disables on `_count.clients > 0` with the counted reason; the route-reference case surfaces as the server message verbatim in the confirm modal (platform law: verbatim, never paraphrased). |
| j | `GET /orders` honors `clientId, status, factoryId, dateFrom, dateTo` (no `agentId`); `GET /payments` honors `clientId, kind, method, dateFrom, dateTo, reconciled, voided` (no `agentId`). | ClientDetail Buyurtmalar/To'lovlar tabs are real server-paginated register queries. Agent-KPI drill-downs to `/orders`/`/payments` are gated on a future `?agentId` param — until then those cards drill in-page (see §4). |
| k | Client mutations: `POST /clients` (A/B/G), `PUT /clients/:id` (A/B/G — AGENT loses `agentId/creditLimit/paymentTermDays` silently, `assertOwnAgent` guards); `legalEntity` accepted for every role. Aliases + prices: A/B only; prices insert-only, 6dp, unique (product, sana). | Drawer field visibility mirrors the strip rules exactly (never show a field the server will discard). `legalEntity` finally gets a form field. |

---

## 1. `/clients` — Mijozlar (register)

### 1.1 Purpose

The party catalog and the launchpad for the two most frequent follow-ups (order, payment).
One glance per row answers: who is this, whose portfolio, **what is the money state**
(BalanceTag), how close to the credit ceiling (CreditGauge), and what in-kind exposure
(PalletChip). Every row carries its own next action — nobody re-finds a client in a select.

### 1.2 Layout

Standard register (04 grammar: PageHeader + FilterBar + DataTable). No PeekPanel on this
register — a client's detail is a full party page (interaction grammar, 04 §0).

```
┌ PageHeader ─────────────────────────────────────────────────────────────────┐
│ Mijozlar                                              [＋ Yangi mijoz  N]   │
├ FilterBar ──────────────────────────────────────────────────────────────────┤
│ [⌕ Qidirish… /] [Qarzdor] [Limit chegarasida] [Paddonli]   (+ Filtr F)      │
│ ▸ verify-gated tokens: Hudud ▾ · Agent ▾ · Holat ▾   Jami: 214 ta  Tozalash │
├ DataTable (36px rows, sticky header) ───────────────────────────────────────┤
│ Nomi              Hudud     Agent      Telefon      Balans        Limit  ⋮  │
│ Жамол Ургенч      Urganch   Jamol      +998…   [Qarz 4 200 000] ▂▂▂▂░ 68% ⋮ │
│ Гофур Хазорасп ⬛5 Xazorasp  Gofur      +998…   [Qarz 8 300 000] Cheklanmagan│
│ Shiddat monolit   —         Jamol      —       [Hisob yopiq]    Faqat oldindan
│ Eski mijoz (Nofaol, 60%)    …          …       [Hisob yopiq]    …        ⋮  │
└──────────────────────────────────────────────────────── 20 / sahifa ────────┘
```

### 1.3 Component instances & data

| Instance | Component (04) | Data source |
|---|---|---|
| Page header | `PageHeader` | title «Mijozlar»; primary action «Yangi mijoz» (KbdHint `N`) |
| Filter row | `FilterBar` | writes `useUrlFilters`; result meta «Jami: N ta» from `GET /clients` `total`. **No Σ money in the meta** — the API returns no balance aggregate and a page-sum of mixed debt/advance rows would mislead (labeled sums are for one-sign registers only). |
| Chip queues | FilterBar chips (`chip=`) | dataset switches to `GET /debts/clients?days=7&search&page` (fact 0b); the bar shows the source label «Manba: qarzdorlik ro'yxati» — 03 §6 honesty rule |
| Table | `DataTable` | `GET /clients?page&pageSize&search` (default pageSize 50); chip mode: `GET /debts/clients` |
| Nomi cell | identity link + `StatusChip` grey «Nofaol» on `active=false` (row ghosted per 02 §6 at 60% only when Nofaol — amounts NOT struck: nothing is voided) | `name`, `active`; imported-Cyrillic names render as-is (they are canonical names, not ArtifactText — aliases are the quoted artifacts) |
| Hudud / Agent cells | text; **Agent cell is a link** to `/agents/:id` (cross-link contract 03 §9) | `region.name`, `agent{id,name}` |
| Balans column | `BalanceTag` (partyType `client`) — tinted chip, never alarm-red here (02 §2.4: alarm ink is for collections surfaces) | `balance`; `|balance|<1` → «Hisob yopiq» grey chip |
| Paddon | `PalletChip` compact «⬛ 5 dona», adjacent to (never inside) the money column | `palletBalance` (units) |
| Limit column | `CreditGauge` mini: thin bar used/limit + «68%»; `null` → plain text «Cheklanmagan»; `0` → danger text «Faqat oldindan to'lov» | `creditLimit` + `balance` (used = max(balance, 0)) |
| Row actions | trailing kebab, labeled items (aria: «Жамол Ургенч amallari») | see 1.4 |
| Totals row | none | no server aggregate; see Balans note above |

Column sort headers: **disabled with tooltip** «server tartiblashni qo'llab-quvvatlamaydi»
(API orders by name asc; no `sort` param) — never a silent client-side sort of one page.
Exception in chip mode: `GET /debts/clients` returns the complete queue already sorted by
debt desc — header shows the fixed order as text («qarz bo'yicha»), not a toggle.

### 1.4 Actions

| Action | Where | Behavior |
|---|---|---|
| Yangi mijoz | header primary; `N`; palette «Yangi mijoz»; URL `?panel=yangi` | 480px right drawer (04 grammar «create a simple record»). Fields: Nomi* · Telefon · Hudud (select over `GET /regions`) · Yuridik shaxs (free text — `legalEntity`, first UI for the field) · — office only: Agent (select over `GET /agents`) · Kredit limiti (`MoneyInput`, helper «Bo'sh — cheklanmagan; 0 — faqat oldindan to'lov») · To'lov muddati (kun). Submit `Ctrl+Enter` → `POST /clients`. Duplicate name error renders **verbatim** («Bu nomdagi mijoz allaqachon mavjud») under Nomi. AGENT variant: only Nomi/Telefon/Hudud/Yuridik shaxs — fields the server strips are absent, plus the caption «Mijoz sizning portfelingizga biriktiriladi». |
| Tahrirlash | row kebab; `E` on ClientDetail | **Same drawer**, pre-filled (create/edit unify — the Modal/Drawer duality dies). `PUT /clients/:id`. When office changes Agent, helper text under the select: «Tarixiy buyurtmalar va to'lovlar avvalgi agent hisobida qoladi» (locked rule: attribution is snapshotted). |
| To'lov qabul qilish | row kebab; `T` on cursor row | `PaymentComposer` drawer, kind CLIENT_IN, client locked with its `BalanceTag`, amount pre-filled with outstanding when balance > 0 (hero flow §2 anatomy). |
| Yangi buyurtma | row kebab | navigate `/orders/new?clientId=<id>` — composer opens with the client bound (hero flow §1). |
| Akt sverki | row kebab | navigate `/print/statement/client/<id>?from&to` (default: yil boshidan bugungacha). |
| Deaktivatsiya | row kebab, **ADMIN only**, only on active rows | Danger confirm modal: «"Жамол Ургенч" nofaol holatga o'tkaziladi. Yangi buyurtma qabul qilolmaydi; tarix saqlanadi.» Pre-disabled with counted reason when `|balance| ≥ 1` or `palletBalance ≠ 0`: «Balans yopiq emas — avval hisob-kitobni yoping» (server stays authoritative; its refusal renders verbatim). `DELETE /clients/:id`. No reason field — the API stores none, and we never collect what we cannot persist. |
| Faollashtirish | row kebab on Nofaol rows, ADMIN | **Gated on fact 0e.** If `active` lands in `UpdateClientDto`: `PUT /clients/:id {active:true}`, symmetric to Deaktivatsiya. Until then the item does not render and the «Nofaol» chip tooltip reads: «Qayta faollashtirish hozircha server tomonidan qo'llab-quvvatlanmaydi». |
| Row open | click anywhere on row / `Enter` | `/clients/:id`. Identity cell stays a real `<a>` for middle-click. |

### 1.5 Filters & URL params (03 §7 row, honored exactly)

`/clients?search&regionId*&agentId*&status*&chip&page&pageSize&panel`

| Param | Control | Mechanics |
|---|---|---|
| `search` | FilterBar search, debounced 300ms, `/` focuses | server (`GET /clients?search=`) — matches name, phone, **taxallus** (placeholder says so) |
| `chip=qarzdor` | chip «Qarzdor» | rows of `GET /debts/clients` with `balance > 0` — server-computed, exact |
| `chip=limit` | chip «Limit chegarasida» | `GET /debts/clients` rows where `balance ≥ 80% × creditLimit` (finite limits only) — the worklist #9 recipe (03 §6); computed from the returned complete queue, source-labeled |
| `chip=paddon` | chip «Paddonli» | `GET /debts/clients` rows with `palletBalance > 0` |
| `regionId` / `agentId` / `status` | Select tokens via «+ Filtr» | **verify-gated (fact 0a): hidden until the API honors them.** Interim honest paths: Agent portfolio → `/agents/:id` (server-scoped by definition; the Agent column links there); Hudud → region client-counts stay plain text (§5); Holat → Nofaol rows are visibly ghosted and searchable by name. |
| `page`, `pageSize` | pagination | server; every other param change resets `page=1` |
| `panel=yangi` | create drawer | URL-addressable so the palette action deep-links |

Chips are mutually exclusive (one queue at a time); an active chip renders as a filled
`colorPrimaryBg` token with ×. `search` inside chip mode maps to `GET /debts/clients?search=`.
Unknown params → red clearable token (03 §7).

### 1.6 Keyboard

Global map (03 §8) plus: `/` search · `N` new client · `F` filter adder · `↑↓/J/K` cursor ·
`Enter` open · `T` payment composer for cursor row · `.` kebab · `E` edit (via kebab focus) ·
`Esc` closes drawer (dirty-guarded). `G M` navigates here from anywhere.

### 1.7 States

| State | Treatment (02 §9 law, instantiated) |
|---|---|
| First load | 8 skeleton rows, header + FilterBar intact |
| Refetch / realtime | rows stay (`keepPreviousData`), 2px hairline under PageHeader; socket `client`/`payment`/`order` events coalesced 2s → changed visible row pulses once |
| Empty (no filter) | `EmptyState`: «Hali mijoz yo'q — Yangi mijoz» (primary action) |
| Empty (filtered/chip) | «Filtrga mos mijoz topilmadi» + «Filtrlarni tozalash»; chip variant: «Bu navbat toza ✓» (a drained queue is good news) |
| Query error | `ErrorState` in place of the table: Uzbek line + server text verbatim + «Qayta urinish» |
| Mutation error | inline under the mapped field (duplicate name → Nomi); deactivation balance error verbatim in the confirm modal |
| Lookups (regions/agents) fail inside drawer | inline `ErrorState` above the form with per-source retry — the form's other fields stay usable |

### 1.8 Role variations

| Role | Difference |
|---|---|
| ADMIN | everything; sole Deaktivatsiya/Faollashtirish |
| ACCOUNTANT | no Deaktivatsiya (API `DELETE` is A-only); all else identical |
| AGENT | server-scoped to own clients (no UI filter needed — the scope is real); drawer shows only unstripped fields; kebab: To'lov qabul qilish · Yangi buyurtma · Tahrirlash · Akt sverki (no deactivate); chips work (debts/clients is agent-scoped) |
| CASHIER | no nav item, route 403 («Bosh sahifaga qaytish») |

### 1.9 Responsive

Per 03 §11. 1200–1599: Telefon folds into row expand. 768–1023: 2-line rows (name+chips /
balance+region·agent). **<768 AGENT:** card list only — identity line + «Nofaol» pill,
`BalanceTag` right, beneath: PalletChip · region · agent; whole card taps to detail;
long-press/kebab equivalent = trailing «⋮» 44px target opening a bottom sheet with the row
verbs; FilterBar collapses to «Filtrlar (1)» button + sheet; search stays inline. fmtShort
never used in the BalanceTag (money renders full — chips wrap).

### 1.10 Removed vs today, and why

- **Create-Modal / edit-Drawer duality** → one 480px drawer (inconsistency pain point; 04 grammar).
- **Icon-only edit/stop buttons** → labeled kebab items (icon-only controls are extinct, 02 §10).
- **Raw colored balance text** («123 456 Qarz» in red/green ink) → `BalanceTag` chips; em-dash for settled → «Hisob yopiq» chip (glossary: bare «0»/«—» banned for settled accounts).
- **Local `useState` search/page** → URL-synced (`useUrlFilters`) — back-button and shareable links work.
- **Nothing removed functionally**: search semantics, pagination, create/edit fields, ADMIN deactivate, Nofaol tag, pallet tag, credit-limit display all survive — credit limit gains the gauge, and the row gains order/payment/akt launchers.

---

## 2. `/clients/:id` — Mijoz kartasi (the archetypal party page)

### 2.1 Purpose

One page that answers «qancha, nimadan, nima qilay?»: the live balance as a sentence, the
running ledger story under it, and every follow-up action pre-bound to this client. This is
the template PartyBalanceHeader + PartyStatement page other party pages copy (03 §5).

### 2.2 Layout

```
┌ PageHeader (breadcrumb: Mijozlar / Жамол Ургенч) ───────────────────────────┐
│ PartyBalanceHeader                                                          │
│  Жамол Ургенч  [Nofaol?]   Agent: Jamol → · Hudud: Urganch · +998 90 …      │
│                Yuridik shaxs: «…» · To'lov muddati: 14 kun                  │
│  Mijoz bizga qarz: 12 450 000 so'm            (money-hero, semantic ink)    │
│  [⬛ 18 dona] [3 ta muddati o'tgan · 8,4 mln] [CreditGauge ▂▂▂░ 62%]         │
│  [To'lov qabul qilish T] [Yangi buyurtma] [Akt sverki P] [⋮ Tahrirlash…]    │
├ Tabs (?tab=) ────────────────────────────────────────────────────────────────┤
│ Hisob-kitob · Buyurtmalar · To'lovlar · Taxalluslar · Maxsus narxlar        │
├ Tab body ───────────────────────────────────────────────────────────────────┤
│ [DateRangeControl: Bugun·Kecha·7 kun·Shu oy·O'tgan oy·Shu yil·Oraliq…] [⎙]  │
│ ┌ Boshlang'ich qoldiq · 01.07.2026            Qarz 9 950 000  (inset row) ┐ │
│ │ 03.07  Buyurtma savdosi · ORD-000214 →   izoh   +4 500 000  Qarz 14 450 000│
│ │ 05.07  To'lov (Naqd)                            −2 000 000  Qarz 12 450 000│
│ │ ⛓ 06.07 Buyurtma bekor qilingan · ORD-000209 (storno pair, ghost rows)   │ │
│ └ Yakuniy qoldiq · 11.07.2026                Qarz 12 450 000              ┘ │
└──────────────────────────────────────────────────────────────────────────────┘
```

Sticky-condensed header on scroll (48px: name + balance + one action) — the balance never
leaves the screen (04 §2.3).

### 2.3 Component instances & data

| Instance | Component | Data source |
|---|---|---|
| Header | `PartyBalanceHeader` | `GET /clients/:id`: `name`, `active`, `agent`, `region`, `phone` (tap-to-call link), `legalEntity`, `paymentTermDays`, `balance`, `palletBalance`, `creditLimit`. Balance sentence per 02 §1: «Mijoz bizga qarz: X so'm» / «Mijoz avansi: X so'm» (moneyWeOwe ink — their money with us) / «0 so'm · Hisob yopiq». Party headers may use full-strength semantic ink (02 §2.4 exception). |
| OverdueChip | `OverdueChip` «3 ta muddati o'tgan · 8 400 000» | this client's row in `GET /debts/clients?days=7&search=<name>` matched by `id` (fact 0b — server-computed over all orders). Row absent ⇒ no chip. Chip links to `/orders?clientId=<id>&chip=overdue`. |
| CreditGauge | `CreditGauge` | `creditLimit` + `balance`: «Limit: 20 mln · Band: 12,45 mln · Bo'sh: 7,55 mln»; null → «Cheklanmagan» text; 0 → danger «Faqat oldindan to'lov» |
| PalletChip | `PalletChip` with popover math (delivered − returned − charged ± adj.) | `palletBalance`; popover launches the pallet return modal pre-bound (pallet module spec) — visible to A/B; read-only popover for G |
| Statement tab | `PartyStatement` (zebra 40% inset ON) | `GET /debts/statement?account=CLIENT&partyId=:id&from&to` — `openingBalance` pinned row, entries with `LEDGER_SOURCE`-mapped labels + document links (`order.orderNo` → `/orders/:orderId`; payment rows → `/payments?peek=` via `paymentId`), signed `MoneyCell` + direction word, running balance rendered as `BalanceTag`-phrased text («Qarz 14 450 000») — the two-conventions pain point dies. Reversal pairs chained (gutter connector, «storno» chips, hover-pairing, net-zero visible). Default window: **Shu oy**. Month separators for multi-month windows. «Tekshirilmagan» amber dot: gated per fact 0d. |
| Buyurtmalar tab | `DataTable` | `GET /orders?clientId=:id&page&pageSize` (server-paginated — the 20-row cap dies). Columns: № (link) · Sana · Zavod · Holat (`StatusChip`) · Muddat (overdue in `moneyOwedToUs` ink + word «o'tgan») · Summa (so'm). Footer link: «Hammasini ko'rish →» `/orders?clientId=:id`. |
| To'lovlar tab | `DataTable` | `GET /payments?clientId=:id&page&pageSize` (server-paginated). Columns: Sana · Turi · Usul · Summa (so'm) · Tekshirilmagan amber dot (payload has `reconciled`) · Izoh. Ghost rows for voided when shown. Voided toggle: «Bekorlar: yashirish / ko'rsatish» (two-state — the API's `voided=true` *includes*; a «faqat» state would be a client-side fake, so it does not ship here). Row click → `/payments/:id` (register with peek — deep link per 03 §4). Footer: «Hammasini ko'rish →» `/payments?clientId=:id`. |
| Taxalluslar tab (A/B) | list + inline add | detail payload `aliases`. Alias names render as `ArtifactText` («Жасур Версал») — they are import-matching artifacts. Add: input + «Qo'shish» → `POST /clients/:id/aliases` (duplicate «Bu nom allaqachon band» inline). Delete: labeled «O'chirish» + confirm (hard delete is the locked exception — the confirm says «moliyaviy emas, tarixga ta'sir qilmaydi»). |
| Maxsus narxlar tab (A/B) | grouped table + «Yangi narx» | detail payload `prices` (complete history). **Grouped by product**; within a group the row in force today is highlighted (`colorPrimaryBg`), future rows badged «kelgusi», past rows collapsed under «Tarix (N)». Prices at stored precision, up to 6dp — never rounded (`729 928.1` is real). «Yangi narx» → 480px drawer: Mahsulot (server-searched select over `GET /products`) · Narx (m³) `MoneyInput` (6dp permitted) · Amal qilish sanasi (default bugun) → `POST /clients/:id/prices`; duplicate-(mahsulot, sana) server error verbatim inline. Insert-only versioning stated in the drawer footer: «Narxlar tarixi o'zgartirilmaydi — yangi qator qo'shiladi». |

### 2.4 Actions (header)

| Action | Trigger | Behavior |
|---|---|---|
| To'lov qabul qilish | button · `T` · `?panel=tolov` · palette record-scoped | `PaymentComposer` CLIENT_IN, client locked, amount pre-filled with outstanding (selected — one keystroke replaces), quick chips «To'liq qarz» · «Muddati o'tgani (8,4 mln)» (from the OverdueChip data). Success: «Yangi balans: Qarz …» + «Kvitansiya chop etish» + «Taqsimlash» (A/B). Header balance refetches; **no optimistic money**. |
| Yangi buyurtma | button · palette | `/orders/new?clientId=:id` |
| Akt sverki | button · `P` print menu | `/print/statement/client/:id?from=<from>&to=<to>` carrying the statement tab's current window (05 §6.4 document: opening/closing framed, Debet/Kredit columns, paddon qo'shimchasi, storno markers, «tekshirilmagan» marks) |
| Tahrirlash | overflow kebab · `E` | the §1.4 edit drawer, pre-filled |
| Deaktivatsiya / Faollashtirish | overflow kebab (ADMIN) | same rules as §1.4; on an inactive client the whole header takes the grey wash + «Nofaol» pill (04 §2.3 state), and «Yangi buyurtma» disables with reason «Nofaol mijoz buyurtma qabul qilmaydi» |

Composer collision: a socket event touching this client while a drawer is open shows the
amber ribbon (02 §9) — never a silent overwrite.

### 2.5 URL params

`/clients/:id?tab=hisob|buyurtmalar|tolovlar|taxalluslar|narxlar&from&to&panel=tolov&page`
— `tab` default `hisob`; `from/to` bind the statement window (and flow into the print link);
`page` belongs to the active server-paginated tab; params survive back/forward (03 §7).

### 2.6 Keyboard

`E` edit · `T` payment · `P` print menu (Akt sverki) · `Esc` closes drawer/panel ·
tab strip reachable via `Tab`; statement rows are focusable (roving tabindex), `Enter`
follows the row's document link. `Ctrl+K` on this page pre-scopes palette actions to this
client (03 §2).

### 2.7 States

| State | Treatment |
|---|---|
| Loading | skeleton of the real layout: balance block, action row, tab bar, 6 statement rows (02 §9) |
| Statement empty period | «Bu davrda harakat yo'q» + opening = closing rows still pinned |
| Buyurtmalar/To'lovlar empty | «Bu mijozda hali buyurtma yo'q — Yangi buyurtma» / «To'lov yo'q — To'lov qabul qilish» |
| Taxalluslar empty | «Taxallus yo'q» + one-line explainer «Excel import mos yozuvlarini bog'lash uchun» |
| Narxlar empty | «Maxsus narx yo'q — katalog narxi amal qiladi» + «Yangi narx» |
| Detail 404 / AGENT foreign client | `ErrorState` full-region: server text verbatim («Mijoz topilmadi» / 403) + «Mijozlarga qaytish» |
| Tab query error | `ErrorState` inside the tab only — header survives |

### 2.8 Role variations

- **A/B**: all tabs, all actions (Deaktivatsiya A-only).
- **AGENT**: own clients only (server `assertOwnAgent`); Taxalluslar and Maxsus narxlar tabs
  absent (API A/B); edit drawer without credit fields; PalletChip popover read-only;
  To'lov qabul qilish and Yangi buyurtma fully available; Akt sverki available
  (print route allows G(own), statement endpoint permits own clients).
- **CASHIER**: no route access.

### 2.9 Responsive

≥1024: header two-row, tabs inline. 768–1023: counters wrap under the balance; tabs scroll.
**<768 (AGENT)**: header stacks — name, balance sentence (money-hero shrinks to 24px,
never abbreviated; fmtShort only as chart/secondary per 02 §7), chips row scrolls
horizontally; actions become a **sticky bottom ActionBar** («To'lov» primary · «Buyurtma» ·
⎙); tabs become a segmented scroller; statement rows render as 2-line cards (date+source /
amount+running); drawers become bottom sheets. No hover-only info anywhere.

### 2.10 Removed vs today, and why

- **Header Card + Descriptions grid + right-aligned h2 balance** → `PartyBalanceHeader` (one hero pattern app-wide; balance becomes a sentence, not a signed number).
- **Statement from the detail payload** (uncapped dump, client-side 20/page, no opening balance, raw signed «Qoldiq») → windowed `GET /debts/statement` with pinned opening/closing and semantic running balance. Full-history reading stays possible («Shu yil», «Oraliq…» presets).
- **Buyurtmalar/To'lovlar last-20 tables** (detail payload, pagination disabled) → real register queries + «Hammasini ko'rish →». Nothing lost: the payload rows were a strict subset.
- **Inline «add price» Form.inline** → drawer (04 grammar); the flat price-version list → grouped-by-product with in-force highlight and «kelgusi» badges (pain point).
- **Izohsiz deletion confirms** (`modal.confirm` closures) → standard confirm surfaces.
- **Nothing else removed**: aliases CRUD, price history, all Descriptions facts (agent, hudud, telefon, limit, muddat) survive in the header meta; `legalEntity` is added, not removed.

---

## 3. `/agents` — Agentlar (register)

### 3.1 Purpose

The office's credit-control panel over field salespeople: portfolio size, live open debt
(the number the order gate checks), and the effective limit with headroom — plus the entry
to each agent's card. Not a commission screen: **no commission model exists and none is
rendered** (locked rule).

### 3.2 Layout

```
┌ PageHeader ─────────────────────────────────────────────────────────────────┐
│ Agentlar                                               [＋ Yangi agent  N]  │
├ FilterBar ──────────────────────────────────────────────────────────────────┤
│ [⌕ Qidirish…/]  [Nofaollar: yashirish ▾]        6 tadan 6 ta ko'rsatilmoqda │
├ DataTable (unpaginated — complete catalog) ─────────────────────────────────┤
│ Nomi      Telefon    Mijozlar  Ochiq qarz (so'm)  Limit           Holati  ⋮ │
│ Jamol     +998…        22      [Qarz 41 200 000]  ▂▂▂▂░ 82% 50 mln  Faol  ⋮ │
│ Gofur     +998…        14      [Qarz 12 800 000]  Cheklanmagan      Faol  ⋮ │
│ Eski agent —            3      [Hisob yopiq]      [0 — bloklangan] Nofaol ⋮ │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 3.3 Component instances & data

| Instance | Component | Data |
|---|---|---|
| Table | `DataTable`, no pagination (complete unpaginated payload, fact 0f) | `GET /agents` |
| Nomi | link → `/agents/:id`; grey «Nofaol» `StatusChip` when inactive (row 60% ghost, nothing struck) | `name`, `active` |
| Mijozlar | plain count (the portfolio itself lives on the detail page) | `clientCount` |
| Ochiq qarz | `BalanceTag`-styled tinted chip, `moneyOwedToUs` ink at 12% fill (this is the page's question column — the only colored column); «Hisob yopiq» when < 1 | `outstandingDebt` (Σ positive client balances only — column header tooltip: «faqat qarzdor mijozlar; avanslar hisobga olinmaydi», locked rule made visible) |
| Limit | `CreditGauge` mini: used = `outstandingDebt`, limit = `debtLimit` (effective). `null` → «Cheklanmagan» text; `0` → danger chip «0 — bloklangan» (canonical phrasing); own-vs-default source shown as small suffix «standart» when `ownDebtLimit=null` and a global default applies | `debtLimit`, `ownDebtLimit`, `outstandingDebt` |
| Holati | `StatusChip` Faol/Nofaol | `active` |
| Kebab | labeled: Ko'rish · Tahrirlash · Deaktivatsiya/Faollashtirish | — |
| Search / Nofaol toggle | FilterBar; **client-side facets over the complete dataset** — exact, honestly labeled «N tadan M ta ko'rsatilmoqda» (no window: the payload is the whole catalog) | in-memory |

Sort: server order is `sortNo, name` (the operator-chosen order — kept as default). Column
sorting by Ochiq qarz / Limit is a **full client-side sort of the complete dataset** —
enabled and exact (02 §6's ban targets one-page sorts of paged data; this payload is total).

### 3.4 Actions

| Action | Where | Behavior |
|---|---|---|
| Yangi agent | header primary, `N`, `?panel=yangi` | 480px drawer: Nomi* · Telefon · Tartib raqami (`sortNo`, helper «faqat ro'yxat tartibi») · Faol (default on) · **Qarz limiti — ADMIN only** (`MoneyInput`, helper «Bo'sh — umumiy standart limit amal qiladi; 0 — yangi buyurtmalar bloklanadi»). ACCOUNTANT sees the limit as a read-only row with lock note «Faqat administrator o'zgartiradi» — the server strips it silently (fact 0h), so we never render it editable. `POST /agents`; duplicate name verbatim inline. |
| Tahrirlash | kebab; header of AgentDetail | same drawer pre-filled → `PUT /agents/:id`. Changing debtLimit shows a caption «O'zgarish auditga alohida yoziladi» (server notes «debtLimit changed»). |
| Deaktivatsiya | kebab on active rows (A/B — `PUT {active:false}`) | confirm modal: «Agent nofaol bo'ladi. Tarixiy buyurtma va to'lovlar agent nomida qoladi (snapshot).» |
| Faollashtirish | kebab on Nofaol rows (A/B) | symmetric `PUT {active:true}` — the hidden-flow pain point dies |
| Row open | click/`Enter` | `/agents/:id` |

### 3.5 URL params

`/agents?search&status=faol|nofaol|hammasi&panel=yangi` — search/status are exact in-memory
facets (fact 0f); still URL-synced for shareability. Default `status=hammasi` with Nofaol
rows ghosted (they matter for history).

### 3.6 Keyboard

`/` search · `N` new · `↑↓/J/K` cursor · `Enter` open · `.` kebab · `Esc` drawer close.
No `T` here — payments bind to clients/vehicles, not agents.

### 3.7 States

Loading: 6 skeleton rows. Empty: «Hali agent yo'q — Yangi agent». Error: `ErrorState`
verbatim + retry. Realtime: `agent`-family invalidation; changed row pulses.

### 3.8 Roles

A/B only (nav + route + API). AGENT: no nav item; the API 403s the list — his own numbers
live at `/me`. CASHIER: 403 route.

### 3.9 Responsive

1200↓: Telefon folds into expand. 768–1023: 2-line rows (name+status / debt+limit). <768
(desk roles reading on a phone): card list, read-and-approve; drawer entry allowed with the
polite «kompyuterda qulayroq» note (03 §11).

### 3.10 Removed vs today, and why

- **Centered Modal** create/edit → 480px drawer (grammar).
- **Icon-only edit button** → labeled kebab; **Faollashtirish becomes a first-class symmetric action** (was: hidden inside the edit form's Switch — the Switch stays in the drawer too, but the row verb is the discoverable path).
- **Raw red money text** for Ochiq qarz → tinted chip (alarm red is reserved for collections surfaces).
- Kept: sortNo, all columns, ADMIN-only debtLimit editing, «0 — bloklangan» phrasing, pageless flow (list was paginated client-side over a complete payload — the fake pagination dies).

---

## 4. `/agents/:id` — Agent kartasi (portfolio + credit headroom)

### 4.1 Purpose

Everything the office needs before saying «yes» to more credit through this agent: the
debt-limit headroom (the exact gate the server enforces at order creation), his month vs
all-time performance, and the client portfolio with per-row collection actions. Also the
canonical answer to «show me agent X's clients» (fact 0a workaround).

### 4.2 Layout

```
┌ PageHeader (Agentlar / Jamol) ──────────────────────────────────────────────┐
│ Jamol  [Faol]   Telefon: +998… · Mijozlar: 22 · Tartib: 1   [Tahrirlash E ⋮]│
├ Limit card (hero) ─────────────┬ KPI bands ─────────────────────────────────┤
│ Qarz limiti (HeadroomMeter)    │ SHU OY [◀ 2026-07 ▶]        UMUMIY         │
│ ▂▂▂▂▂▂▂▂░░ 82%                 │ Savdo 84,2 mln → reyting    Buyurtmalar 214│
│ Limit: 50 000 000              │ Mahsulot foydasi 6,1 mln    Savdo 1,02 mlrd│
│ Band: 41 200 000 (ochiq qarz)  │ Yig'ilgan 71,5 mln          Foyda 74,3 mln │
│ Bo'sh: 8 800 000               │ Buyurtmalar 18              Yig'ilgan …    │
│ «100% da yangi buyurtma        │ (hozirgi qoldiq: 41,2 mln — Paddon 214 dona│
│  bloklanadi»                   │  oylik emas, joriy)                        │
├ Mijozlar portfeli ──────────────────────────────────────────────────────────┤
│ [Hammasi | Qarzdor | Avansda | Hisob yopiq | Nofaol]     22 tadan 9 ta      │
│ Mijoz            Hudud      Telefon    Balans              amallar          │
│ Жамол Ургенч     Urganch    +998…      [Qarz 12 450 000]  [To'lov T] ⋮     │
│ …                                                                            │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 4.3 Component instances & data

| Instance | Component | Data |
|---|---|---|
| Header | `PageHeader` + meta chips (not `PartyBalanceHeader` — an agent has no ledger account; the hero here is headroom, not a balance sentence) | `GET /agents/:id`: `name`, `active`, `phone` (tap-to-call), `clients.length`, `sortNo` |
| **Agent debt-limit card** | `CreditGauge` agent variant (HeadroomMeter): bar + caption «Limit: … · Band: … · Bo'sh: …»; states <60% neutral / 60–90% warning / >90% danger / blocked («0 — yangi buyurtmalar bloklangan», danger) / unlimited («Cheklanmagan», no bar). Source line: «Shaxsiy limit» vs «Standart limit (sozlamalardan)» from `ownDebtLimit == null`. Footer note at ≥100%: «Yangi buyurtma server tomonidan bloklanadi». | `debtLimit` (effective), `ownDebtLimit`, `kpi.outstandingDebt` |
| SHU OY KpiBand | `KpiBand` + `StatCard`s (Savdo · Mahsulot foydasi · Yig'ilgan · Buyurtmalar), month picker writes `?month=YYYY-MM` (defaults to current Tashkent month) | this agent's row in `GET /dashboard/agents-ranking?month=` (A/B). Cards **drill to `/reports?tab=reyting&month=`** (same data, all-agents context — every KPI is a door). Agent absent from the month's ranking ⇒ zeros + caption «Bu oyda faoliyat bo'lmagan». Debt is deliberately NOT in this band — it is not a monthly figure. |
| UMUMIY KpiBand | compact stats: Buyurtmalar · Savdo · Mahsulot foydasi · Yig'ilgan · Ochiq qarz · Mijozlardagi paddonlar | detail `kpi` (all-time). «Ochiq qarz» card is labeled «hozirgi qoldiq» (time-frame honesty, brief pain point) and drills **in-page** to the portfolio board with the «Qarzdor» facet (no `?agentId` on `/debts` or `/orders` exists — fact 0j; the in-page board IS the drill). «Mijozlardagi paddonlar» renders without a link + tooltip «Agent kesimidagi ro'yxat uchun server filtri kerak» — an honest dead-end beats a wrong link. «Buyurtmalar»/«Savdo» drills to `/orders?agentId=` ship **only when** the param lands (gated). Profit card labeled «taxminiy» while the agent has non-FINAL cost orders? — cost status is not in this payload; the card carries the standing footnote «tannarx qotirilmagan buyurtmalar taxminiy hisoblanadi» (02 §1 honesty, no fake precision). |
| Portfolio board | `DataTable` over the **complete** `clients` array; segmented facet (exact, in-memory): Hammasi · Qarzdor · Avansda · Hisob yopiq · Nofaol; count label «22 tadan 9 ta»; full client-side sort by Balans (complete dataset — allowed) | detail `clients[]`: `name`, `active`, `region.name`, `phone`, `balance` |
| Board row verbs | trailing: «To'lov qabul qilish» button (visible, not buried — collections is the point) + kebab: Yangi buyurtma · Akt sverki · Mijoz kartasi | `PaymentComposer` CLIENT_IN pre-bound; `/orders/new?clientId=`; `/print/statement/client/:id`; `/clients/:id` |

### 4.4 Actions

Header: **Tahrirlash** (`E`) → §3.4 drawer; overflow kebab: Deaktivatsiya/Faollashtirish
(§3.4 semantics). Board rows: `T` payment · `Enter` opens the client. Month picker: `←/→`
arrow buttons step months, writes `?month=`.

### 4.5 URL params

`/agents/:id?month=YYYY-MM&f=qarzdor|avans|yopiq|nofaol` — extends the 03 §7 row for this
route with `month` (same convention as `/reports`); `f` is the board facet (exact in-memory
filter over a complete payload — URL-synced for shareable drills).

### 4.6 Keyboard

`E` edit · `↑↓/J/K` board cursor · `T` payment for cursor client · `Enter` open client ·
`.` row kebab · `Esc` close drawer.

### 4.7 States

Loading: skeleton of the real layout (header, limit card, two bands, 6 board rows).
Ranking query error: `ErrorState` **inside the SHU OY band only** — limit card and board
survive (per-region errors, 02 §9). Board empty: «Bu agentda mijoz yo'q — mijozni
biriktirish uchun mijoz kartasidan Agent maydonini o'zgartiring» (no fake «add client here»
— assignment lives on the client). Nofaol agent: header grey wash + «Nofaol» pill; all
verbs stay (history reading is the use case).

### 4.8 Roles

A/B. (The AGENT-facing twin of this page is `/me`, fed by `GET /agents/me` +
`GET /agents/:ownId` — specced with the cockpit; it reuses the limit card and board verbatim,
minus the SHU OY ranking band, which 403s for agents — its monthly figures come from the
agent-scoped dashboard summary instead.) CASHIER/AGENT hitting `/agents/:id`: 403 route
(AGENT's own id technically permitted by the API; the UI still routes him to `/me` to keep
one surface per role).

### 4.9 Responsive

1024↓: limit card and bands stack vertically; board unchanged. 768↓: KPI cards 2-per-row;
board rows 2-line. <768: read-and-approve; «To'lov» row verb keeps a 44px target.

### 4.10 Removed vs today, and why

- **Six flat Statistic cards** → two labeled bands (SHU OY / UMUMIY) + the limit card promoted
  to hero — the flat KPI wall dies (02 §1: the largest text is a money figure that matters).
- **Read-only page** → Tahrirlash in the header (pain point: edit required a trek to the list).
- **All-time-only KPIs** → month picker over the existing ranking endpoint (`?month=` finally wired).
- **Descriptions row «Qarz limiti: 0 — yangi buyurtmalar bloklangan»** → HeadroomMeter with
  the same canonical phrasing (kept verbatim as the blocked-state caption).
- Kept entirely: every KPI, client board columns, Nofaol handling. The board *gains* facets,
  sort, and per-row actions.

---

## 5. `/references?tab=hududlar` — Hududlar (Regions)

### 5.1 Purpose

Flat geographic catalog used for client grouping and logistics-route tariffs. Lives as the
first tab of the consolidated **Ma'lumotnomalar** page (03 §4); `/regions` 301-redirects
here, bookmarks survive.

### 5.2 Layout

```
┌ PageHeader ─────────────────────────────────────────────────────────────────┐
│ Ma'lumotnomalar                                        [＋ Yangi hudud  N]  │
│ [Hududlar] [Yuridik shaxslar] [Xarajat kategoriyalari]        (?tab=)       │
├ DataTable ──────────────────────────────────────────────────────────────────┤
│ Nomi        Izoh                  Mijozlar soni                       ⋮     │
│ Urganch     —                     12                                  ⋮     │
│ Xazorasp    shimoliy yo'nalish    5                                   ⋮     │
│ Yangi hudud —                     0                                   ⋮     │
└──────────────────────────────────────────────────────────────────────────────┘
```

(The Yuridik shaxslar and Kategoriyalar tabs are specced with their own domains; the header
primary action follows the active tab.)

### 5.3 Component instances & data

| Instance | Component | Data |
|---|---|---|
| Table | `DataTable`, unpaginated («small catalog — unpaged by design», service comment) | `GET /regions`: `name`, `note`, `_count.clients` |
| Mijozlar soni | count. **Link → `/clients?regionId=<id>` is gated on fact 0a**; until the param ships the count renders as plain text (a link that ignores its filter is banned). When gated off, cell tooltip: «Hudud bo'yicha mijozlar filtri serverda hali yo'q». | `_count.clients` |
| Kebab | Tahrirlash · O'chirish | — |

### 5.4 Actions

| Action | Behavior |
|---|---|
| Yangi hudud (`N`, `?panel=yangi`) | 480px drawer: Nomi* · Izoh (TextArea) → `POST /regions`; duplicate «Bu nomdagi hudud allaqachon mavjud» verbatim inline |
| Tahrirlash | same drawer pre-filled → `PUT /regions/:id` |
| O'chirish | **Pre-disabled** with counted reason when `_count.clients > 0`: kebab item disabled + «12 ta mijoz biriktirilgan — o'chirib bo'lmaydi» (discover-by-failing dies). When clients = 0: danger confirm modal «"Yangi hudud" butunlay o'chiriladi (moliyaviy ma'lumot emas).» → `DELETE /regions/:id`; if logistics routes still reference it (not visible in the payload — fact 0i) the server refusal renders **verbatim** in the modal with a link «Marshrutlar →» `/procurement?tab=marshrutlar&regionId=<id>`. |

Region rename invalidates only `region`-family + affected client list keys (the wholesale
`['clients']` invalidation dies — scoped keys per `lib/realtime.ts` convention).

### 5.5 URL params

`/references?tab=hududlar&panel=yangi` (03 §7). `/regions` and `/regions/*` → 301 to this URL.

### 5.6 Keyboard

`N` new · `↑↓/J/K` cursor · `.` kebab · `Enter` opens edit drawer (rows have no detail
page — edit IS the row's surface) · `Esc` close.

### 5.7 States

Loading: 6 skeleton rows under intact tabs. Empty: «Hali hudud yo'q — Yangi hudud».
Error: `ErrorState` verbatim + retry, tab strip survives.

### 5.8 Roles

A/B read+write (API: GET also permits AGENT — but agents consume regions only inside the
client form's select; they get no References nav/route). CASHIER: 403.

### 5.9 Responsive

Trivially fluid; <768 the table becomes 2-line cards (name+count / note). Desk-role
read-and-approve rules apply.

### 5.10 Removed vs today, and why

- **`/regions` as a standalone route** → References tab (nav consolidation, 03 §5; redirect kept so nothing breaks).
- **Modal** → drawer; **icon-only edit/delete** → labeled kebab.
- **Delete-then-discover failure** → pre-disabled with reason + verbatim server fallback.
- Kept: name/note fields, client counts, unique-name error, hard-delete semantics (locked rule: allowed only while unreferenced — stated in the confirm copy).

---

## 6. Cross-cutting acceptance notes for this domain

1. **Every business rule visible where it bites:** credit-limit semantics (null/0) captioned
   on every CreditGauge; agent limit «Band» explicitly defined as Σ positive balances only;
   attribution snapshot warned at agent reassignment; deactivation preconditions pre-checked
   with the server as final word; pallet units never adjacent-mixed into money; `<1 UZS` ⇒
   «Hisob yopiq» everywhere; price history insert-only and 6dp-precise; no agent commissions
   anywhere.
2. **Honesty gates recap (build checklist):** `?regionId/?agentId/?status` on `/clients`
   (hidden until honored) · client «Faollashtirish» (hidden until `UpdateClientDto.active`)
   · statement «Tekshirilmagan» dot (until `reconciled` joins the statement select) ·
   region client-count link (until `?regionId`) · agent KPI drills to `/orders`/`/payments`
   (until `?agentId`). Each has a designed fallback above — nothing is faked, nothing waits
   on a new endpoint.
3. **Query keys:** `client`-, `agent`-, `region`-first key families; mutations invalidate
   the touched id + list keys only; realtime coalesced 2s; visible-row pulse.
4. **Print:** only the akt sverki (05 §6.4) originates from these screens; entry points are
   the ClientDetail header, the client-row kebab, and the AgentDetail board kebab — all
   passing the active `from/to`.
