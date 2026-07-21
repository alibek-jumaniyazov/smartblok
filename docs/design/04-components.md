# SmartBlok — Component Library (v1, FINAL)

**Status:** binding specification — this is what an implementer builds first, in roughly this
order. All components are AntD v6 compositions themed by `02-design-language.md` tokens (no
new UI library, no styled-components, no Tailwind). They live in `apps/web/src/components/`.
Shared maps (`ROLES`, `STATUS`, `LEDGER_SOURCE`, `PERMISSIONS`) live in `lib/`. Platform
state law (`02` §9) binds every component's loading/empty/error behavior.

**Interaction grammar — one surface per intent, app-wide:**

| Intent | Surface |
|---|---|
| Browse/filter a register | Full page: PageHeader + FilterBar (URL-synced) + DataTable (+ PeekPanel) |
| View a money document (payment, kassa row) | URL-addressable PeekPanel over its register |
| View a party / workbench (order, client, factory, vehicle, agent) | Full page (workbench / party page) |
| Create a simple record (client, product, vehicle, agent, region, entity, user, route) | Right drawer, 480px |
| Create a money document (payment, expense, manual kassa) | PaymentComposer-style drawer, 560px |
| Compose a complex document (order) | Full page with LedgerPreview rail |
| Allocate / settle | SettleDrawer over its context |
| Destroy / void / cancel / storno / step-back | ReasonModal with LedgerImpactPreview |
| Bulk price edit | Full-page editable sheet |

---

## 1. Shell & structure

### 1.1 `AppFrame`
- **Purpose:** the shell (`03` §1): SideNav, TopBar, palette mount, socket state, role-driven
  nav from `PERMISSIONS`.
- **Anatomy:** SideNav (240/64px) · TopBar 48px (breadcrumb, search button, LiveBadge, theme
  toggle, avatar chip) · content outlet (max 1440px) · optional docked PeekPanel host.
- **Props:** none (reads auth/route context).
- **States:** expanded/rail; online/reconnecting/offline (offline = persistent amber top
  hairline «Oflayn — ma'lumot HH:mm holatiga»); AGENT mobile variant (bottom tab bar).
- **Used in:** every authed route.

### 1.2 `PageHeader`
- **Purpose:** one identity block on every page; ends the title-size lottery; feeds the
  TopBar breadcrumb.
- **Anatomy:** breadcrumb (linked ancestors, auto from route: «Mijozlar / Jasur Versal») →
  20px title + optional StatusChip + meta chips (date, party) → right ActionBar (1 primary +
  overflow kebab with KbdHints) → optional tab strip synced to `?tab=`.
- **Props:** `{ title, breadcrumb?, status?, meta?, actions?, tabs?, sticky? }`
- **States:** default; **sticky-condensed** (on scroll collapses to 40px: breadcrumb hides,
  title 14px, actions stay — on party pages the balance stays visible); loading (skeleton
  title).
- **Used in:** every page.

### 1.3 `FilterBar`
- **Purpose:** THE URL-synced filter row; retires filter amnesia globally.
- **Anatomy:** search input (debounced 300ms, `/` focuses) · 0–4 typed filters as removable
  tokens (`Holat: Yuklanmoqda ×`) editing in popovers (PartySelect, DateRangeControl,
  segmented) · «+ Filtr» adder (`F`) · tri-state ghost toggle where relevant («Bekorlar») ·
  active-filter chips with per-chip clear · «Tozalash» link · **SavedViews** dropdown (`V`) ·
  result meta («214 ta · Σ 1 249 547 319 so'm» when a server aggregate exists).
- **Props:** `{ schema: FilterField[], savedViewsKey?, aggregate? }` — every control writes
  `useUrlFilters`; page resets to 1 on change.
- **States:** idle (ghost prompt), active, overflowed (tokens wrap to 2 rows max then
  collapse into «+3»), invalid URL param (red clearable token), collapsed on mobile into a
  «Filtrlar (3)» button opening a sheet.
- **Used in:** every register.

### 1.4 `SavedViews`
- **Purpose:** per-user named filter+column+sort+density presets per list (one-keystroke
  recurring filters).
- **Anatomy:** dropdown inside FilterBar: built-ins per route (Orders: «Barchasi», «Yo'lda»,
  «Narxlanmagan*», «Bugungi trucklar»; Payments: «Tekshirilmagan», «Bugungi kirimlar») + user
  views + «Joriy ko'rinishni saqlash…». `V` cycles.
- **Props:** storage key `sb_views:<userId>:<route>`; a view = URL query string + column set
  + density. Views needing client-side derivation are starred and carry their window (`03` §6).
- **States:** built-in active, user view active, dirty (current filters ≠ view → «saqlash»
  affordance).
- **Used in:** Orders, Payments, Debts, Reestr (power registers).

### 1.5 `DataTable`
- **Purpose:** the one table; wraps AntD Table with the `02` §6 contract.
- **Anatomy:** sticky 32px header · keyboard cursor row (2px left accent; `J/K`/arrows) ·
  selection column (appears on first `X`; feeds BulkBar) · pinned totals row (server
  aggregate or «sahifa jami») · column chooser presets on wide registers («Moliya /
  Logistika / Hammasi») · density toggle (36/44px) · server sort headers (disabled+tooltip
  where unsupported) · trailing kebab (labeled items) · ghost-row rendering · export slot
  (xlsx where backend has it; CSV-of-filter client-side, honestly labeled).
- **Props:** `{ columns, query, rowKey, onRowOpen, peekable?, selectable?, totals?,
  columnPresets?, densityKey? }`
- **States:** loading (8 skeleton rows, header intact), refetching (2px hairline, rows stay),
  empty (EmptyState; filtered-empty variant), error (ErrorState in place), realtime pulse
  row, voided-row styling.
- **Used in:** every register and every embedded table.

### 1.6 `PeekPanel`
- **Purpose:** master-detail without losing the list — the structural fix for dead deep
  links and triage context loss.
- **Anatomy:** 420px (lists) / 560px (money documents) panel docked right at e2, 1px seam —
  the list does NOT reflow (panel overlays). Header: title + open-full-page `↗` + print ⎙ +
  close ✕. Body: description rows + mini-tables. Footer: action bar.
- **Props:** `{ id, renderer, width }` — URL contract: `?peek=<id>` or the route param
  (`/payments/:id`); deep links open the list **with** the peek.
- **States:** open/closed (180ms translateX); **`↑/↓` moves the peek through list rows**
  (rapid triage; URL rewritten via replaceState); `Esc` closes; mobile = full-height bottom
  sheet.
- **Used in:** Payments (canonical detail surface), Orders (mini-workbench), Kassa journal
  (source documents), Debts (client statement peek).

### 1.7 `CommandPalette`
- **Purpose:** the product's front door (spec `03` §2): records + record-scoped actions +
  pages, recents.
- **States:** empty (recents), searching (3 parallel providers), record-highlighted (action
  list re-scopes: «Yangi buyurtma — Жамол Ургенч»), no-results.
- **Used in:** global.

### 1.8 `BulkBar`
- **Purpose:** bulk operations on selected rows — primarily the driver-settlement sweep.
- **Anatomy:** floating bottom bar at e2: «N ta tanlandi · Σ 4 200 000» + verbs legal for the
  selection (vehicle unpaid trucks: «Shofyorga to'lash» pre-summing the payment; orders A/B:
  status advance — sequential PATCH with per-row result summary; CSV of selection; batch
  invoice print). `Esc` clears.
- **Props:** `{ selection, verbs: BulkVerb[] }`
- **States:** mixed-legality (illegal verbs disabled with counted reason: «3/5 tasida moshina
  yo'q»), executing (per-row progress), done (result toast summary).
- **Restraint:** never offers bulk void/cancel — financial corrections stay single, reasoned
  acts.
- **Used in:** VehicleDetail unpaid trucks, Orders register (A/B), Reestr export.

---

## 2. Money & ledger primitives

### 2.1 `MoneyCell`
- **Purpose:** the atom under every amount; callers pass **meaning**, never a raw sign
  convention.
- **Props:** `{ value: Money /* decimal string */, variant: 'neutral'|'in'|'owedToUs'|
  'weOwe'|'ghost', signed?: boolean, suffix?: 'so\'m', usd?: { amount, rate } }`
- **Anatomy:** right-aligned tabular grouped digits; semantic ink per `02` §2.4; true minus
  U+2212; ghost = strikethrough; USD variant renders the full equation; settled (<1 UZS)
  renders `0`.
- **States:** value, settled, pending («—» + «Narxlanmagan» chip).
- **Used in:** everywhere money renders.

### 2.2 `BalanceTag`
- **Purpose:** the one way party balances appear in pickers, rows, headers — kills the raw
  minus-sign cognitive tax.
- **Anatomy:** tinted chip (12% fill + full ink): «Qarz 12 450 000» / «Avans 3 200 000» /
  «Hisob yopiq», with party-correct phrasing: client → Qarz/Avans; factory →
  Qarzimiz/Avansimiz; vehicle → Qarzimiz. Optional paddon suffix «· 12 dona».
- **Props:** `{ balance: Money, partyType: 'client'|'factory'|'vehicle', compact?, pallets? }`
- **States:** debt, advance, settled, stale (refetch shimmer on drawer open).
- **Used in:** PartySelect options, register columns, PartyBalanceHeader, palette results.

### 2.3 `PartyBalanceHeader`
- **Purpose:** the hero of every party page — the balance IS the interface.
- **Anatomy:** party name + status + meta chips (agent · region · phone / plate · driver ·
  capacity) → `money-hero` balance with the semantic sentence («Mijoz bizga qarz: …»,
  «Zavodga qarzimiz: …», «Shofyorga qarzimiz: …») → secondary counters (PalletChip, overdue
  chip «3 ta muddati o'tgan · 8,4 mln», CreditGauge, bonus wallet chip for factories) →
  quick-action buttons pre-scoped to the party («To'lov qabul qilish» · «Yangi buyurtma» /
  «To'lash» · «Taqsimlash» · «Bonusdan yopish» / «Shofyorga to'lash») → period selector for
  the statement below.
- **Props:** `{ party, actions: Action[], counters }` (actions filtered by PERMISSIONS).
- **States:** sticky-condensed (48px bar: name + balance + one action); loading skeleton;
  inactive party (grey wash + «Nofaol» pill).
- **Used in:** ClientDetail, FactoryDetail, VehicleDetail, AgentDetail, `/me`.

### 2.4 `PartyStatement`
- **Purpose:** the flagship — a statement is a story. Doubles verbatim as the akt sverki
  print body.
- **Anatomy:** period control → **pinned opening balance row** on inset bg («Boshlang'ich
  qoldiq · 01.06.2026») → chronological rows: date · source label from the shared
  `LEDGER_SOURCE` map + document link («Buyurtma savdosi · ORD-000214») · note · signed
  `MoneyCell` · running balance (semantic) → **pinned closing balance row**. Month
  separators as sticky 16px sub-headers. **Reversal pairs visually chained**: left-gutter
  connector + chain glyph, «storno» chips on both rows, hovering one highlights both, the
  pair visibly nets to zero. `reconciled:false` rows: amber dot + «Tekshirilmagan» chip.
  TRANSPORT_DIRECT rows render the double effect in words («Mijoz shofyorga to'ladi — mijoz
  krediti + shofyor hisobi yopildi»). Ghost rows per `02` §6.
- **Props:** `{ partyType, partyId, from, to, printMode? }`
- **Controls:** period presets, «Chop etish» (opens `/print/statement/...`), export where the
  API offers it.
- **States:** loading skeleton rows; empty period (opening=closing still rendered); error.
- **Used in:** ClientDetail, FactoryDetail, VehicleDetail, Debts peek, print routes.

### 2.5 `LedgerImpactPreview`
- **Purpose:** the highest-value error prevention in the app — exact consequence lists
  before every commit. Data comes from the record already loaded (allocations, ledger
  entries in detail payloads) — no new endpoints.
- **Anatomy:** bullet rows of exactly what will post/reverse, in ledger language:
  «11 ta buyurtma tannarxi QOTIRILADI (O'TKAZMA narxida, buyurtma sanasidagi narx qatori)» ·
  «1 ta buyurtma QISMAN qoplanadi» · «Tannarx farqi COST_ADJUSTMENT sifatida yoziladi» ·
  «3 ta foizli bonus qayta hisoblanadi» · «3 ta ledger yozuvi storno bo'ladi» ·
  «ORD-000214 tannarxi PROVISIONAL holatiga qaytadi» · «Kassaga qaytim: Naqd kassa
  +2 000 000» · «Pul mijoz hisobida qoladi».
- **Props:** `{ facts: ImpactFact[] }` (builders per action type: allocate, void, cancel,
  edit, storno, bonus-reverse).
- **Used in:** SettleDrawer footer, every ReasonModal, order edit confirm.

### 2.6 `ReasonModal`
- **Purpose:** the single destructive-confirm surface; the closure-variable
  `modal.confirm` anti-pattern dies.
- **Anatomy:** danger title stating the irreversible fact → `LedgerImpactPreview` →
  controlled TextArea, required, inline validation (≥3 chars) → danger confirm labeled with
  the verb, disabled until valid, never default-focused.
- **Variants:** cancel order (warns about bonus reversal from COMPLETED), void payment, void
  expense, kassa storno, bonus withdrawal reversal, privileged status step-back (mandatory
  note per API), import rollback (adds typed «ROLLBACK» input + exact deletion counts — one
  modal, not two).
- **States:** invalid, valid, submitting, server-error inline.
- **Used in:** everywhere something is voided/cancelled/reversed/stepped back.

### 2.7 `CreditGauge` (agent-variant alias: `HeadroomMeter`)
- **Purpose:** credit headroom visible before the server says no.
- **Anatomy:** thin bar (used vs limit) + caption «Limit: 20 mln · Band: 14,2 mln · Bo'sh:
  5,8 mln». `Cheklanmagan` = plain text, no bar; `0` = danger note «Faqat oldindan to'lov».
  Agent variant reads `GET /agents/me` (outstanding vs debtLimit; «Yangi buyurtma
  bloklanadi» at 100%). This agent variant is the **`HeadroomMeter`** named by `03` §4
  (`/me`), the agent cockpit, and `/agents/:id` — the same component, not a second one.
- **States:** <60% neutral, 60–90% warning, >90% danger, blocked, unlimited, loading.
- **Used in:** client pickers, client rows, ClientDetail header, order composer rail, agent
  cockpit/`/me`.

### 2.8 `CapacityMeter`
- **Purpose:** pallets vs truck capacity, before the server rejects.
- **Anatomy:** «17 / 19 paddon» + fill bar; re-bases on vehicle pick; amber ≥90%, red +
  **submit guard** when exceeded (exact overflow shown: «2 paddon ortiqcha — server rad
  etadi»).
- **Used in:** order composer rail, order edit.

### 2.9 `PalletChip`
- **Purpose:** in-kind pallet debt can never be misread as money.
- **Anatomy:** outlined chip «⬛ 18 dona» (amber >0 on client, danger negative), always
  adjacent to — never mixed into — money balances. Popover: delivered − returned − charged ±
  adjustments math + launch of the right pallet modal with the party pre-filled and
  **current → post-action balance** preview (warn, don't block, on negative).
- **Used in:** client rows, party headers, order workbench, Debts paddon tab.

### 2.10 `MoneyInput`
- **Purpose:** one money entry control (the copy-pasted formatter/parser dies).
- **Anatomy:** space-grouped live formatting, «so'm» suffix, `inputmode="numeric"`, min 1,
  optional max bound fed by live data with the bound as helper text and a one-click «max»
  chip («Hamyonda: 1 250 000»); USD twin (usdAmount + rate, computed UZS read-only, rate
  pre-filled from the last USD payment). Pre-filled values render selected so one keystroke
  replaces them.
- **States:** default, out-of-bound (inline error naming the bound), suggestion-filled.
- **Used in:** every money form.

### 2.11 `PartySelect` / `CashboxSelect` / `LegalEntitySelect`
- **Purpose:** the unified pickers — six divergent ad-hoc selects and the 50/200-option caps
  die.
- **Anatomy:** server-searched (300ms debounce), infinite scroll, shared react-query cache
  across mounts. Option rows: name + secondary meta (agent/region; plate/driver; currency) +
  right-aligned `BalanceTag` (cashboxes: live balance). Footer when capped: «… yana N ta —
  qidiruvni aniqlashtiring» — never silent truncation. Inline «Yangi qo'shish» where role
  allows (clients).
- **States:** idle, searching, empty (+create), error (inline retry), scoped (AGENT sees own
  clients — server scoping, no fake options).
- **Used in:** every form that references a party, cashbox, or legal entity (PaymentComposer
  payer/receiver finally consumes the entity catalog).

---

## 3. Flow components

### 3.1 `StatusFlow`
- **Purpose:** the order lifecycle rail — one legal next action, blockers named in place.
- **Anatomy:** slim 6-segment progress rail (NEW→COMPLETED) with labeled nodes, dates/actors
  underneath; the **single legal next-step verb button** for the role on the rail
  («Tasdiqlash» → «Yuklashni boshlash» → …), `Enter` triggers; **blocker chips render on the
  step that needs them** — «Moshina biriktirilmagan» on Yuklash with an inline
  **«Biriktirish»** action (popover PartySelect → minimal `PUT /orders/:id` resending
  current items + vehicleId). A/B overflow menu: skip forward…, «Bir qadam orqaga» (ReasonModal
  with mandatory note per API), Bekor qilish. AGENT sees only the single +1 verb.
- **States:** on-track, blocked (amber node), advancing (segment fills 240ms), cancelled
  (rail replaced by danger banner + reason + link to the netting reversal set), completed
  («Bonus hisoblandi: 125 000» note; pre-completion hint «bonus hisoblanadi»).
- **Used in:** order workbench (rail top), order peek (condensed), agent mobile (one big
  button).

### 3.2 `SettleDrawer` (the allocation workbench; alias: AllocationEditor)
- **Purpose:** THE missing surface — allocate any allocatable payment
  (`POST /payments/:id/allocations`), inline at creation or later. Drives cost finalization,
  aging, transport status.
- **Anatomy:** header = payment summary (kind chip, party, amount, method) + live
  **«Taqsimlanmagan qoldiq: X»** counter + price-basis line for FACTORY_OUT («Narx asosi:
  ZAVOD O'TKAZMA — to'lov usulidan»). Body = the party's open documents table, oldest-first:
  order no · date · client · the figure that matters (**sale outstanding** = saleTotal +
  `clientChargeable(order)` − allocated / **uncovered provisional cost** with PARTIAL progress hairline
  / **transport qoldiq**) · current status chip · checkbox · per-row amount input
  **pre-filled with `min(outstanding, remaining)`**, input max hard-clamped. Toolbar:
  **«A — Eskisidan boshlab taqsimlash»** (FIFO fill until the payment is exhausted; rows fill
  sequentially at 40ms — values render instantly) · «Tozalash». Footer =
  `LedgerImpactPreview` (finalization basis, PARTIAL/FINAL forecast chips per row, transport
  flips, bonus re-derivations) + confirm «Taqsimlash — X so'm» + Σ guard.
- **Data:** candidates per kind — CLIENT_IN: the client's open orders; FACTORY_OUT: the
  factory's non-FINAL orders; VEHICLE_OUT/TRANSPORT_DIRECT: **the vehicle-detail payload's
  own orders** (window labeled) — never a client-side filter of 100 recents.
- **States:** balanced (qoldiq 0), remainder>0, over-allocation **hard-blocked** inline (per
  row and Σ, with the exact excess), already-allocated rows disabled with «avval bekor
  qiling» + existing amount, party-mismatch rows disabled with reason, empty («Ochiq hujjat
  yo'q»), read-only (K/G see allocations, no editor — «Taqsimlashni buxgalter bajaradi»).
- **Entry points:** payment peek «Taqsimlash» (`?panel=taqsimlash`), PaymentComposer
  «Saqlash va taqsimlash» chain, FactoryDetail, VehicleDetail (pre-checked from BulkBar),
  OrderDetail payments tab, Taqsimlanmagan worklist rows.

### 3.3 `PaymentComposer`
- **Purpose:** kind-first payment entry; the 720/961-line morphing modal dies.
- **Anatomy:** 560px drawer opened by **intent-named buttons** («To'lov qabul qilish» =
  CLIENT_IN, «Zavodga to'lash» = FACTORY_OUT, «Shofyorga to'lash» = VEHICLE_OUT, «Mijoz
  shofyorga to'ladi» = TRANSPORT_DIRECT, refunds under overflow) — the kind never morphs
  mid-form, nothing is silently wiped. Fields per kind: party (`PartySelect`, locked when
  launched from context, BalanceTag visible) · date · method segmented (Naqd / O'tkazma /
  Click / Terminal / Karta / USD; defaults to the party's last-used) · amount (`MoneyInput`;
  pre-filled with outstanding when launched from a debt row) · cashbox (`CashboxSelect`,
  currency-filtered, live balance; **absent** for TRANSPORT_DIRECT with the fixed info line
  «Bu to'lov kassadan o'tmaydi — mijoz hisobidan kamayadi, shofyor hisobi yopiladi») ·
  payer/receiver `LegalEntitySelect` with free-text fallback · note · USD swaps in
  usdAmount + rate with the computed equation preview (read-only). FACTORY_OUT shows the
  method consequence inline: «O'TKAZMA — taqsimlanganda tannarx ZAVOD O'TKAZMA narxida
  qotiriladi». Footer: «Saqlash» (Ctrl+Enter) + A/B checkbox **«Saqlash va taqsimlash»**
  chaining into SettleDrawer; submit button says what it does («Qabul qilish — 4 500 000
  so'm»).
- **Success state:** mini delta («Yangi balans: Qarz 7 450 000») + **«Kvitansiya chop
  etish»** + «Taqsimlash» (A/B) + «Yana to'lov».
- **States:** fresh idempotency key per open (double-click-safe); AGENT variant (CLIENT_IN
  only, own clients); CASHIER variant (no allocation chain — payment lands in the
  Taqsimlanmagan inbox with the handoff line visible); cashbox shortfall renders the
  server's exact figure and refetches balances.
- **Used in:** everywhere money is received/paid (register buttons, debt rows `T`, party
  hubs, palette actions, cashier terminal).
- **Sibling money-document composers:** the same 560px drawer pattern (money-doc grammar
  above) renders expense creation — the **`ExpenseComposer`** named in `screens/reports.md`
  §2 (fields: sana, summa, active-UZS `CashboxSelect`, category select, izoh) — and the
  `/kassa` manual IN/OUT modal. They are instances of this composer, not new components.

### 3.4 `WorklistCard` + `InboxRail`
- **Purpose:** the cockpit engine — finite countable queues that go to zero (taxonomy:
  `03` §6).
- **Anatomy (card):** overline title + live count + sum where money-shaped («23 ta ·
  95 800 000») → top-3 preview rows (party · figure · age; clicking opens the record) →
  «Hammasi →» drill link (filtered URL). Count badge colored by queue severity (danger /
  violet / warning / neutral).
- **Anatomy (rail):** 2-column masonry on desktop, single column mobile; **order fixed by
  severity**, not configurable; **zero-count cards collapse to a single green one-line
  «Toza ✓» strip** at the bottom — a clean day is visibly clean.
- **States:** loaded, zero (collapsed), loading, error-inline. Counts `aria-live=polite`;
  client-derived queues show their window label on the card footer.
- **Used in:** `/` cockpit (A/B), agent cockpit (scoped set), LiveBadge popover (compact).

### 3.5 `LedgerPreview` (order composer rail)
- **Purpose:** the live receipt — the actual postings the order will create, in statement
  language, before submit.
- **Anatomy:** sticky 320px rail (bottom sheet on AGENT mobile, collapsed to a 56px bar
  «19/19 paddon · 23,9 mln · qarzga yoziladi» that expands on tap): client credit picture
  (BalanceTag, CreditGauge, PalletChip, overdue chip, agent debt-limit headroom) → load
  figures (CapacityMeter, Σ m³, «Taxminiy savdo») → transport figures + live «Transport
  foydasi» → the ledger preview block: «Mijoz hisobiga qarz: +24 300 000 (savdo) + 300 000
  (transport)» · «Zavod hisobimizdan: −21 870 000 (taxminiy, O'TKAZMA narxda)» ·
  «Shofyorga qarzimiz: −2 000 000» · «Paddon: mijozga 19 dona» → projected post-save balance
  + re-drawn CreditGauge.
- **States:** empty (quiet placeholders), computing (no layout shift), limit-breach (AGENT:
  submit disabled with figures; A/B: warning tone, explicit override click — server stays
  authoritative), capacity-breach (submit blocked).
- **Used in:** `/orders/new`, `/orders/:id/edit`, agent mobile wizard step 4.

### 3.6 `DateRangeControl`
- **Purpose:** one period-control language everywhere.
- **Anatomy:** preset chips Bugun · Kecha · 7 kun · Shu oy · O'tgan oy · Shu yil · Oraliq…
  (+ RangePicker); writes `?from&to`; Tashkent-day basis stated in the picker footer.
- **Used in:** every register FilterBar, Kassa (single control governing the page),
  statements, reports, dashboard chart (`?days` variant).

---

## 4. Data display

### 4.1 `StatCard` + `KpiBand`
- **Purpose:** drillable KPIs — every number is a door.
- **Anatomy (StatCard):** overline label → full-precision `money-lg` value (abbreviation
  only on AGENT mobile, with the exact value as a permanent secondary line) → delta chip vs
  previous period (↑ 12% «o'tgan oyga nisbatan» — colored by *business goodness*, debt going
  up is red) → 32px sparkline (from the already-fetched trends payload) → whole card is a
  link («→» affordance). Profit cards labeled which profit and «taxminiy» while unfinalized
  orders exist.
- **Anatomy (KpiBand):** overline band label (SAVDO · FOYDA · QARZLAR) + row of 3 hero cards
  and up to 6 secondary compact stats (label + value, also links).
- **States:** default, negative (danger ink), loading, error dash, hidden-by-role (agent
  company KPIs simply don't render).
- **Used in:** cockpit, Debts header, Kassa header, Reports headers.

### 4.2 `StatusChip`
- **Purpose:** one chip component for all enums, from the single `STATUS` maps (`02` §2.5) —
  the three legacy tag components merge; raw enums never render.
- **Anatomy:** dot-style (dot + label) in tables; 12%-tint filled style in headers; violet
  UNKNOWN carries `?`.
- **Used in:** everywhere a state renders, including print (as bracketed words).

### 4.3 `ArtifactText`
- **Purpose:** the three-writing-systems answer — legacy Cyrillic/Russian workbook strings
  as quoted evidence.
- **Anatomy:** serif-italic, `colorTextTertiary`, wrapped in « » («Товар», «шопр учун
  барди»). Never translated, never mixed into UI copy.
- **Used in:** Import wizard (check names, sheet terms, flag reasons), statement rows
  carrying imported notes.

### 4.4 `ActivityTimeline`
- **Purpose:** one merged activity feed per document (statuses + payments/allocations +
  pricing + pallet events + comments) — the duplicate Izohlar tab dies.
- **Anatomy:** composer at the bottom (comment input, Ctrl+Enter), day-grouped entries: type
  icon, body (money events show MoneyCell inline, linked documents), actor + timestamp
  (relative, absolute in tooltip). Filter chips: Hammasi / Izohlar / Moliya / Holat.
- **States:** empty, optimistic pending comment row (the only optimistic element in the app),
  error-retry.
- **Used in:** order workbench; (later) party pages.

### 4.5 `LiveBadge`
- **Purpose:** honest realtime state (spec `03` §1.2).
- **States:** jonli (green dot) / ulanmoqda (amber pulse) / oflayn (grey + «ma'lumot HH:mm
  holatiga»; enables refetch-on-focus). Click opens the worklist popover; tooltip shows
  «Oxirgi yangilanish: HH:mm:ss».

### 4.6 `EmptyState` / `ErrorState`
- **Purpose:** the platform-law states (`02` §9) as components.
- **Anatomy:** EmptyState = 20px icon + one sentence + one action; filtered-empty variant
  with «Filtrlarni tozalash». ErrorState = message + server text verbatim + «Qayta urinish».
  The 403 screen gains «Bosh sahifaga qaytish».

### 4.7 `PrintDocument`
- **Purpose:** the print-route scaffold for the four paper documents (`05` §6).
- **Anatomy:** A4/A5 sheet: dealer letterhead block (DEALER legal entity name + INN — picked
  once in the toolbar, remembered; phone), document title + number + date, body grid/table,
  totals, signature strips («Topshirdi / Qabul qildi» with Sana lines), footer «SmartBlok ·
  chop etildi DD.MM.YYYY HH:mm · [user]» + page N/M. Screen: centered preview + sticky
  «Chop etish» toolbar (copy count, dealer-entity select, back). Print CSS: `@page` 14mm,
  black-on-white ink (semantic colors degrade to weight), 0.5pt hairlines, tabular numerals,
  `thead { display: table-header-group }`, `break-inside: avoid` on rows and signature
  blocks.
- **Companions (named in `screens/print.md`):** `PrintLayout` — the chrome-free route shell
  the `/print/*` routes render inside (no SideNav/TopBar/PeekPanel, `no-print` toolbar +
  backdrop, white theme-invariant sheet); `PrintToolbar` — the sticky preview toolbar
  instanced per document (Orqaga, title, DEALER `LegalEntitySelect` snapshot, Nusxa stepper,
  per-doc URL-synced toggles, «Chop etish»). Both are part of this scaffold, not new
  primitives.
- **States:** loading, guard-refused (e.g. receipt for TRANSPORT_DIRECT/voided — explainer
  instead of the document).

### 4.8 Small atoms
`KbdHint` (11px kbd chip), `RolePill` (from ROLES map), `DeltaTag` (arrow + % + word),
`TotalsRow` (labeled server-vs-page scope), `DensityToggle`, `Sparkline` (32px, axis-free),
`OverdueChip` (count + Σ in the cell, never a tooltip).

---

## 5. Build order (foundation → money spine → operations → paper)

1. **Foundation:** theme.ts tokens + design.css, PageHeader, FilterBar + `useUrlFilters`,
   DataTable, MoneyCell/BalanceTag, StatusChip + shared maps, PartySelect family, MoneyInput,
   ReasonModal + LedgerImpactPreview, EmptyState/ErrorState, uz_Latn locale, LiveBadge.
   (Every existing page re-skins without behavior change — the app looks canonical in week
   one.)
2. **Money spine:** PeekPanel + `/payments/:id`, PaymentComposer, SettleDrawer,
   PartyStatement + PartyBalanceHeader (ClientDetail, FactoryDetail), Debts hub tabs,
   CreditGauge, PalletChip. (Hero flows b, c.)
3. **Operations:** order workbench + StatusFlow + `/orders/:id/edit`, order composer +
   LedgerPreview + CapacityMeter, VehicleDetail + BulkBar, InboxRail/WorklistCard cockpits,
   StatCard/KpiBand, SavedViews, ActivityTimeline, CommandPalette upgrade (records +
   record-scoped actions). (Hero flows a, d, e.)
4. **Paper & periphery:** PrintDocument + four print routes, Reports rework, Products bulk
   sheet, Procurement routes tab, Kassa unification, Expenses totals, References,
   Users/Settings/Profile polish, agent mobile pass.
5. **Migration finale:** Import wizard (ADMIN) — timed with go-live.

---

## 6. What the component system deliberately does NOT include

- **No InlineEdit on catalog cells** (jury decision: low value at this catalog size, real
  optimistic-rollback cost). Catalog edits go through the drawer.
- **No kanban/board views** — the lifecycle is linear and role-gated; StatusFlow expresses
  it; drag would imply illegal jumps.
- **No drag-and-drop anywhere money moves** — allocation is typed and confirmed.
- **No bulk destructive verbs** (bulk void/cancel) — one actor, one reason, one record.
- **No notification bell/feed component** — queues + LiveBadge are the notification system.
- **No dashboard widget builder / user-configurable inbox order** — the cockpit is
  opinionated by severity.
- **No mark-reconciled button, no cashbox CRUD, no manual ledger ADJUSTMENT screen, no file
  attachments, no opening-balance wizard, no audit-log browser** — backend-first backlog,
  acknowledged honestly in-UI, never faked.
