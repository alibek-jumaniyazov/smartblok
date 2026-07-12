# SmartBlok — Hero Workflows (v1, FINAL)

**Status:** binding specification. Every step names the exact UI, labels (Uzbek), keys, and
API call. All server behavior is the existing API, untouched. Components:
`04-components.md`; routes/params: `03-shell-and-ia.md`; tokens & platform state law:
`02-design-language.md`.

Contents: §1–§5 the five hero workflows · §A payment allocation UX (SettleDrawer, full) ·
§B order stuck-states rescue · §C reconciliation worklists · §6 print document flows ·
§D edge-path catalog (binding).

---

## §1. Hero (a) — Create an order for a client who is on the phone with an agent

*Persona: ACCOUNTANT at the desk, phone on shoulder; the agent dictates. Target: under 60s,
hands never leaving the keyboard. AGENT-on-phone self-service variant: §1.1.*

1. **Entry, 2 keystrokes + a name.** `Ctrl+K` → type `jam` → the palette's Yozuvlar group
   shows «Жамол Ургенч» with its BalanceTag («Qarz 4 200 000») → `↓` to the record-scoped
   action row **«Yangi buyurtma — Жамол Ургенч»** → `Enter`. Lands on
   `/orders/new?clientId=…` with the client locked in and focus in the date field. (Mouse
   path: `/orders` → «Yangi buyurtma» → PartySelect. Also: `N` on `/orders`; ClientDetail
   header action.)
2. **Screen.** Full-page composer: left column = form in 4 visual stages; right =
   sticky **LedgerPreview rail** (`04` §3.5), alive from second zero because the client is
   known — BalanceTag, CreditGauge headroom, PalletChip «12 dona», overdue chip, and the
   **agent's** debt-limit headroom beneath. If the agent is at his cap, an amber banner says
   so before a single item is typed. Draft persists to sessionStorage (keyed per route) — a
   second phone call costs nothing.
3. **Stage 1 — Mijoz.** Client (pre-filled, changeable) · business date (default today) ·
   intended factory-payment segmented control **«O'tkazma (bank) | Naqd»** with caption
   «taxminiy tannarx shu narxda hisoblanadi» — the provisional-cost consequence explained at
   the point of choice.
4. **Stage 2 — Mahsulotlar.** Items are a keyboard grid, not nested cards: columns
   `Mahsulot · Paddon · m³ · Narx rejimi · Narx · Summa`. First product pick **locks the
   catalog to that factory** (header chip «Zavod: CAOLS KS ✕» with an explicit
   «Zavodni almashtirish» escape that clears items) — the single-factory rule is built into
   the control, not an error banner. Paddon `19` → m³ autofills `19 × 1.728 = 32,832`
   (badge `avto`; typing your own flips it to `qo'lda` and autofill never overwrites again).
   Narx rejimi segmented: `Katalog / Kelishilgan / Umumiy summa / Narxlanmagan*` (*A/B
   only). Katalog shows the resolved price **including the ClientPrice override**, labeled
   «maxsus narx» (fetched per selected client — the estimate finally matches the server),
   still labeled «taxminiy — server tasdiqlaydi». Kelishilgan shows the AGENT floor
   proactively («Eng past: 625 000 — zavod bank narxi») and clamps with an inline error.
   Umumiy summa stores the lump exactly, back-solved per-m³ in small text. `Alt+Enter` adds
   a row; `Ctrl+Backspace` deletes one. The rail updates per keystroke: CapacityMeter,
   Σ m³, «Taxminiy savdo».
5. **Stage 3 — Transport.** Vehicle PartySelect (name · plate · «19 pd» · shofyor);
   picking fills driver name **only if untouched** and re-bases the CapacityMeter on that
   truck. Mode segmented: `Mijozning o'z transporti / Diler hisobidan (default) / Mijozdan
   olinadi`. Cost/charge MoneyInputs appear per mode (fields for other modes do not exist);
   DEALER_CHARGED shows live «Transport foydasi: +200 000». **Guard:** transportCost > 0
   with no vehicle → blocking inline warning «Moshina tanlanmagan — shofyor qarzi hisobga
   olinmaydi» requiring an explicit checkbox (the untracked-driver-debt hole closed at the
   UI).
6. **Stage 4 — Yakun.** Note field; the rail's bottom card is the **ledger preview** — the
   actual postings in statement language, and the projected post-save balance with the
   CreditGauge re-drawn. Limit breach: AGENT — submit disabled with figures; A/B — warning
   tone + explicit override click (server row-lock stays authoritative).
7. **Submit.** `Ctrl+Enter` → single POST → toast «ORD-000158 yaratildi» → navigate to
   `/orders/:id`: StatusFlow at NEW, next action «Tasdiqlash» focused; header offers «Chop
   etish ▾» so the invoice prints while the agent is told the number. Server rejections
   (credit/capacity/floor) render verbatim under the relevant stage, focus moved to the
   offending field. Draft cleared.

Keyboard path: `Ctrl+K "jam" ↓ ⏎ → Tab Tab → "d50"⏎ Tab 19 Tab → Ctrl+Enter` — ~9 gestures
plus typing.

### 1.1 AGENT mobile variant (the ➕ tab)

The same composer as a 4-step wizard (Mijoz → Mahsulot → Transport → Tasdiqlash), one
thought per screen, with the **collapsed bottom-sheet summary bar** («19/19 paddon ·
23,9 mln · qarzga yoziladi») expanding by swipe to the full LedgerPreview. Client step shows
the credit card (balance, headroom, pallets, overdue) sized for sunlight; blocked-limit
states announced here, not at submit. Paddon uses big ± steppers; Narxlanmagan absent; floor
errors inline. Step 4 **is** the ledger preview — the agent turns the phone to the client;
the tap that follows is informed consent. Steps validate on advance; back preserves state;
sessionStorage survives a tab switch. Submit sticky, 48px, above the tab bar.

---

## §2. Hero (b) — Collect a payment on a debt, from the Debts view

*Persona: ACCOUNTANT during collections hour; also CASHIER when a client walks in; AGENT
variant on the phone (§2.1). The most frequent task in the company.*

1. `G` `Q` → `/debts?tab=mijozlar&days=7`. The undiruv board, worst-first: mijoz (link) ·
   agent · MoneyCell (alarm red — collections context) · **aging in the row** (OverdueChip
   «2 ta · 6 200 000», never a tooltip) · PalletChip · to'lov muddati · trailing
   **«To'lov qabul qilish»** button. Header: window select feeding «Kutilayotgan tushum» +
   tab totals row.
2. `↓`…`↓` to «Гофур Хазорасп» (row cursor). `→` expands the row: the client's open orders
   inline (order no · sana · muddat, overdue in red · outstanding) — no page switch to
   understand what the 8,3M consists of. `Space` peeks the client statement if needed.
3. **`T`** (or the row button) → **PaymentComposer** opens as a drawer over the list — no
   navigation, no context loss. Pre-bound: kind CLIENT_IN (chooser skipped), client locked
   with BalanceTag, **amount pre-filled with the outstanding balance** rendered selected —
   typing `5000000` replaces it (partial payments are normal). Quick chips beneath:
   «To'liq qarz» · «Muddati o'tgani (6,2 mln)». Method defaults to the client's last-used;
   cashbox auto-picked to the method's currency with live balance («Naqd kassa —
   12 450 000»).
4. **Allocate at entry (A/B).** The SettleDrawer section is open inline, **pre-run with
   FIFO oldest-first**: the two overdue orders take 4 100 000 and 900 000; «Taqsimlanmagan:
   0». Amounts adjustable; the default is already right.
5. **`Ctrl+Enter`** saves (idempotent). Success state: «Yangi balans: Qarz 3 340 000» +
   **«Kvitansiya chop etish»** (opens `/print/receipt/:paymentId`) + «Yana to'lov». Behind
   the drawer the debt row has already re-rendered via socket (row pulse; overdue chip
   recalculated); **the cursor stays on the row** — `↓` moves to the next debtor.
6. **CASHIER path:** identical minus the allocation section (locked rule); an info line
   says «Taqsimlashni buxgalter bajaradi». The payment lands in the **Taqsimlanmagan
   to'lovlar** worklist on the accountant's cockpit; each row there opens the payment peek
   with «Taqsimlash» → SettleDrawer (§A).

Loop cost: **6 keystrokes + the amount per client**, cursor never leaves the list. From
seeing the debt to a printed receipt: 4 interactions (was ~12 across three pages, no receipt
at all).

### 2.1 AGENT mobile

From a client card, debt row, or the ➕ sheet: full-screen composer — client pre-bound,
amount keypad-first with the balance as a one-tap chip, method chips, cashbox auto. No
allocation step. Success: big check + amount + «⎙ Kvitansiya» (system print/share sheet) +
«Yana to'lov».

---

## §3. Hero (c) — Settle with a factory (pay + allocate + finalize cost + spend bonus)

*Persona: ACCOUNTANT/ADMIN, weekly big-tranche settlement with «CAOLS KS». One page, zero
re-selection of the factory.*

1. **Entry.** `Ctrl+K` → `caols` → `Enter` → `/factories/:id` — the settlement hub.
   PartyBalanceHeader: «Zavodga qarzimiz: 184 250 000 so'm» (or «Avansimiz…», green), bonus
   chip «Bonus: 4 310 000 · PER_M3 5 000/m³ · 01.06 dan», paddon chip «bizda 214 dona»,
   actions: **To'lash · Taqsimlash · Bonusdan yopish ▾ · Paddon qaytarish**. A slim
   **«Ochiq buyurtmalar»** strip above the statement: «14 ta buyurtma tannarxi qotirilmagan
   — 96,4 mln qoplanmagan». Tabs: Hisob-kitob (default) · To'lovlar · Bonus dasturi ·
   Paddonlar.
2. **Pay.** «To'lash» → PaymentComposer pre-bound FACTORY_OUT + factory. Method choice shows
   its consequence up front: «O'TKAZMA — taqsimlanganda tannarx ZAVOD O'TKAZMA narxida
   qotiriladi» (Naqd/Karta/USD → zavod naqd narxi). Amount 150 000 000 · «Bank (Септем
   Алока)» (live balance; a shortfall would render the server's exact figure) · receiver
   LegalEntitySelect «CAOLS KS MCHJ» pre-picked. Check **«Saqlash va taqsimlash»** →
   `Ctrl+Enter`.
3. **Allocate.** SettleDrawer opens chained: «Taqsimlanmagan qoldiq: 150 000 000», «Narx
   asosi: ZAVOD O'TKAZMA (to'lov usulidan)». Body: the factory's non-FINAL orders
   oldest-first — ORD no · sana · mijoz · taxminiy tannarx · qoplangan (PARTIAL hairline) ·
   **qoplanmagan** · input. Press **`A`** — FIFO fills 11 orders fully, the 12th partially;
   per-row forecast chips «→ FINAL (o'tkazma narxi)» / «→ PARTIAL». Footer
   LedgerImpactPreview: «11 ta buyurtma tannarxi QOTIRILADI (O'TKAZMA narxida, buyurtma
   sanasidagi narx qatori) · 1 ta buyurtma QISMAN · tannarx farqlari COST_ADJUSTMENT
   sifatida yoziladi · 3 ta yakunlangan buyurtmaning FOIZLI bonusi qayta hisoblanadi».
   Confirm «Taqsimlash — 150 000 000» → `POST /payments/:id/allocations`.
4. **Verify in place.** The statement gains the FACTORY_OUT row and the COST_ADJUSTMENT
   deltas (each linking to its order); the «Ochiq buyurtmalar» strip drops to «3 ta ·
   12,1 mln»; the header balance recomputes (no animation — row pulse only); cost chips flip
   to «Qotirilgan» app-wide via socket.
5. **Spend bonus.** «Bonusdan yopish ▾» → `Zavod qarziga o'tkazish`: focused modal, wallet
   **refetched on open** («Hamyonda: 4 310 000»), MoneyInput with max chip, «Qoladi:
   1 810 000» live line, one-sentence canonical-chain explanation: «BONUS usulidagi zavod
   to'lovi yaratiladi — kassadan o'tmaydi». Confirm → BONUS_OFFSET row appears in the
   statement; wallet chip decrements. `Naqd yechish` variant asks for the UZS cashbox and
   names the box it credits.
6. **Paper.** Header overflow → «Akt sverki» → `/print/statement/factory/:id?from&to`.

---

## §4. Hero (d) — Settle transport with a driver

*Persona: ACCOUNTANT/CASHIER; the driver is standing at the desk.*

1. **Find the driver.** Cockpit worklist «Shofyorlarga qarz» preview row «Isuzu 01 A 774 —
   4 000 000» → click → `/vehicles/:id`. (Or `Ctrl+K` → plate → Enter.)
2. **The driver hub.** PartyBalanceHeader: «Shofyorga qarzimiz: 4 000 000 so'm», shofyor
   name, phone (tap-to-call), «Sig'imi: 19 paddon». Actions: **«Shofyorga to'lash»** ·
   «Mijoz to'lagan deb yozish». Panel **«To'lanmagan yuklar (2)»** — the vehicle's own
   orders from the detail payload (window labeled «oxirgi 50 reys»), UNPAID/UNKNOWN first,
   checkbox rows: `ORD-000101 · 05.07 · Жамол Ургенч · 2 000 000 · To'lanmagan` and
   `ORD-000107 · 08.07 · … · 2 000 000 · Aniqlanmagan` (violet). Both checked by default;
   **BulkBar**: «2 ta tanlandi · 4 000 000 · Shofyorga to'lash». Below: the full
   PartyStatement.
3. **Pay.** `T` / the BulkBar verb → PaymentComposer VEHICLE_OUT, vehicle bound, **amount
   pre-filled 4 000 000**, cashbox with live balance, «Saqlash va taqsimlash» pre-checked →
   SettleDrawer **pre-built from the checked trucks** at their outstanding amounts, qoldiq
   already 0 — the allocation list IS the unpaid-trucks list (no 100-row picker). Impact
   line: «2 ta buyurtma transporti TO'LANDI holatiga o'tadi». `Ctrl+Enter`. Print
   «Kvitansiya» for the driver's signature.
4. **The «клентдан» case.** If the client paid the driver directly: row kebab «Mijoz
   to'lagan deb yozish» (also on the order workbench's Transport card) → composer in
   TRANSPORT_DIRECT with client + vehicle + amount pre-bound, cashbox absent, fixed info
   line «Bu to'lov kassadan o'tmaydi — mijoz hisobidan kamayadi, shofyor hisobi yopiladi».
   Allocation marks the truck «Mijoz to'lagan». The statement renders the double effect as
   one row with two consequences («Mijoz: −500 000 · Shofyor: +500 000»).
5. **UNKNOWN resolution.** Imported «Aniqlanmagan» trucks sit in the unpaid panel wearing
   violet; resolving = recording the real payment (either kind) — the derived status
   recomputes server-side. The Debts hub's Shofyorlar tab is the fleet-wide sweep view (all
   vehicles with nonzero liability, per-row pay action).

Keyboard sweep: `x x t Ctrl+Enter` per driver.

---

## §5. Hero (e) — The owner's morning check: cockpit → anomaly → act

*Persona: ADMIN (the owner), 08:30, first coffee. Same flow works on his phone.*

1. **`/` Ish stoli.** Top: **InboxRail** («E'tibor kerak») reads like a to-do list —
   `Muddati o'tgan qarzlar 4 — 21,4 mln` (danger) · `Tekshirilmagan to'lovlar 12 —
   95,8 mln` (violet) · `Taqsimlanmagan to'lovlar 3` (warning) · `Narxlanmagan 1` ·
   `Moshina biriktirilmagan 1` · collapsed green strip «5 ta ro'yxat toza ✓». Below: KpiBand
   SAVDO (Bugungi savdo · Oy savdosi ↑4% · Sotilgan hajm · Yo'ldagi buyurtmalar — finally
   rendered), FOYDA (Mahsulot foydasi «taxminiy — 3 ta tannarx ochiq» · Transport foydasi,
   separate, sign-colored), QARZLAR (Mijozlar qarzi · Zavodlarga qarzimiz · Shofyorlarga
   qarzimiz — finally rendered · Bonus hamyonlar · Mijozlardagi paddonlar). Every figure
   full-precision, every card a link, sparklines from the trends payload. Chart card:
   range control 7/30/90/365 (`?days=`), order-count bar layer, period totals in the
   header, point-click → that day's orders.
2. **Anomaly 1: Transport foydasi −1,1 mln** (danger ink). Click →
   `/reports?tab=reestr&from&to&preset=logistika` sorted by transport profit asc. Top row:
   ORD-000104, cost 2 000 000, charge 0, «Diler hisobidan». One click into the order — the
   dispatcher forgot DEALER_CHARGED.
3. **Act in place.** The order is CONFIRMED + PROVISIONAL, so **Tahrirlash** is live
   (`/orders/:id/edit`): mode flipped to «Mijozdan olinadi», charge 2 200 000; the edit
   banner explains reverse+repost and re-check; the rail shows the client's new exposure.
   Save.
4. **Anomaly 2: overdue queue.** Click the worklist header → `/debts?tab=mijozlar&
   chip=overdue`. Expand the worst row, «Akt sverki» → the print statement; WhatsApp the PDF
   from the phone. One client promised cash today — left for the accountant's §2 flow.
5. **Trust check.** A cancelled order in a client statement shows its chained storno pair
   netting to zero — no suspicion, no Excel. Back-arrow twice returns through URL-synced
   state to the exact cockpit; the LiveBadge confirms freshness.

Under three minutes; every number either acted on or consciously deferred — the queue badges
remember for him.

---

## §A. Payment allocation UX (SettleDrawer) — complete specification

The deepest business rules (cost-at-allocation, aging, transport status, PERCENT bonus)
hang off this surface. Component anatomy: `04` §3.2. Behavioral spec:

**Remaining-unpaid inline.** Every candidate row shows the figure that matters, resolved
per kind:

| Payment kind | Candidate set | Per-row figure |
|---|---|---|
| CLIENT_IN | the client's open orders, oldest-first | «Qoldiq» = saleTotal + transportCharge − Σ active allocations (fixes the sale-only progress math) |
| FACTORY_OUT | the factory's non-FINAL orders, oldest-first | «Qoplanmagan» = provisional cost − covered (PARTIAL hairline) + costStatus chip |
| VEHICLE_OUT / TRANSPORT_DIRECT | the vehicle's own orders from `GET /vehicles/:id` (window labeled) | «Transport qoldig'i» + transport status chip |

If outstanding must be lazily resolved (`03` §10c), each cell shows its own small spinner —
never a blocking overlay.

**Auto-distribute.** `A` = «Eskisidan boshlab taqsimlash»: fills rows oldest-first with
`min(outstanding, remaining)` until the payment is exhausted; rows fill sequentially (40ms
apart, values instant); «Taqsimlanmagan qoldiq» live-counts to 0. «Tozalash» resets. The
fill is always user-confirmed — never auto-committed.

**Consequences before commit.** Footer LedgerImpactPreview per §3 step 3; per-row forecast
chips (→ FINAL basis / → PARTIAL / «Transport: To'langan bo'ladi»). FACTORY_OUT header
carries the price-basis line derived from the payment method.

**Guards.** Per-row input max = `min(outstanding, remaining)`; Σ active allocations >
payment amount is unreachable (inputs clamp; footer shows the exact excess if server data
drifted). Rows already carrying an active allocation from this payment: disabled, existing
amount shown, caption «avval bekor qiling». Party-mismatch and CANCELLED orders: disabled
with reason. CASHIER/AGENT: read-only rows + «Taqsimlashni buxgalter bajaradi».

**The allocation inbox.** Payments with unallocated remainder surface as the
«Taqsimlanmagan to'lovlar» WorklistCard and the `/payments?chip=alloc-open` chip; the
register's «taqsimlangan/qoldiq» mini-bar column shows the amber remainder. Each row opens
the peek → «Taqsimlash». This closes the cashier→accountant loop that keeps costs
provisional.

**Void interplay.** Voiding a payment (ReasonModal) previews: allocations to void, orders
whose cost reverts PROVISIONAL (named), transport statuses re-derived, bonus wallet
restoration for BONUS payments, kassa REVERSAL rows.

---

## §B. Order stuck-states rescue

**B1. Vehicle assigned later (the stuck-order fix).** An order created without a vehicle is
blocked from LOADING. The StatusFlow renders the blocker **on the Yuklash step**: amber chip
«Moshina biriktirilmagan» + inline **«Biriktirish»** action → popover PartySelect (vehicles,
capacity + BalanceTag) → minimal `PUT /orders/:id` resending current items + vehicleId
(allowed: NEW/CONFIRMED + PROVISIONAL). CapacityMeter re-checks against the chosen truck
before submit. The «Moshina biriktirilmagan» worklist drills to
`/orders?status=CONFIRMED&chip=novehicle` where the row kebab offers the same popover. The
old dead-end toast is extinct.

**B2. Edit order (`/orders/:id/edit`).** The composer pre-filled via GET, submitting
`PUT /orders/:id` (full item replace). Permanent banner: «Tahrirlash barcha moliyaviy
yozuvlarni storno qilib qayta yozadi; kredit limiti qayta tekshiriladi. CONFIRMED holatdan
keyin yoki tannarx qotirilgach tahrirlash yopiladi.» `intendedPaymentMethod` rendered
disabled (immutable). Confirm shows LedgerImpactPreview of the reverse+repost; settled
transport survives (stated in the banner). Entry points: workbench header «Tahrirlash»
(enabled only while NEW/CONFIRMED + PROVISIONAL — otherwise a lock chip with the reason
«Tannarx allokatsiya bilan qotirilgan»), the Moshinasiz queue, the owner flow §5.3.

**B3. Late pricing (Narxlanmagan).** Gold badge on the register row and the «Narxlanmagan»
worklist. On the workbench items table, pending rows carry «Narxlash» → controlled modal:
per-m³ / umumiy summa radio + MoneyInput; note «qarz buyurtma sanasi bilan yoziladi»
(recognition happens late at the order's business date, per the locked rule). Saving posts
ORDER_SALE; the «≈» disappears from totals.

**B4. Cancel (soft).** «Bekor qilish» → ReasonModal with full impact preview (ledger
reversals, pallet reversal, allocation voiding — «pul mijoz hisobida qoladi», bonus reversal
warning when status=COMPLETED). Cancelled workbench: StatusFlow replaced by the danger
banner + reason + link to the netting reversal set in the activity feed.

**B5. Privileged status moves.** A/B overflow on the StatusFlow: skip forward…, «Bir qadam
orqaga» (ReasonModal with the mandatory transition note the API supports). AGENT sees only
the single legal +1 verb.

---

## §C. Reconciliation worklists

**C1. Imported-payments review queue (`/payments?reconciled=false`).** The ~95,8M flagged
history becomes workable: the «Tekshirilmagan to'lovlar» WorklistCard (violet) + the
FilterBar tri-state + the SavedView «Tekshirilmagan». Rows carry the amber dot; the peek
shows payer/method/id (what the owner needs against bank statements); `↑↓` triages through
rows without losing the list. Review affordances only: open payment, open client statement,
print, void-if-wrong (ReasonModal). **No mark-reconciled button** — the endpoint does not
exist; the queue drains by voiding wrong payments or naturally after owner sign-off; the
badge is the memory. Statement rows with `reconciled:false` carry the same amber dot, so a
finance user reading any client statement sees which history is unconfirmed workbook data.

**C2. Import wizard (`/import`, ADMIN only) — 4 steps.**

1. **Yuklash:** dragger (.xlsx, ≤20MB) + guards summary (empty-base rule, seed
   preconditions, prior-batch state).
2. **Tekshiruv (dry run):** checks as a table — `Tekshiruv · Kutilgan · Haqiqiy · Δ` (red
   deltas; check names as ArtifactText «Σ Оплата»); per-kind payment count chips (the
   `[object Object]` rendering dies); the **95,8M unreconciled warning read from the
   correct payload path** with a preview table (sana · mijoz · payer · usul · summa);
   unmatched driver-truck/payment lists as structured columns (qator, mijoz, sana, raqam,
   summa); kassa balances with negative warnings. Dry-run results persist to localStorage
   with a «qoralama» history row — a refresh never costs a 2-minute rerun.
3. **Import:** the confirm modal **embeds the last clean dry-run's checks and counts** — the
   admin commits numbers, not prose; requires a prior clean dry-run of the same file.
   Progress overlay with stage labels (o'qish → tekshirish → buyurtmalar → to'lovlar →
   solishtirish).
4. **Solishtirish:** auto-opens after a real import. Headline chip row: `mos N` · `farqli N`
   · **`izohsiz N — import xatosi`** · `flagged Σ`. Per-client rows expandable to
   **sheetGaps detail** («Товар 12-qator varaqda yo'q (+18 400 000)» as ArtifactText), each
   mismatch badged **violet «daftar nuqsoni bilan izohlangan»** (the reserved
   workbook-defect channel, `02` §2.4) vs **red «izohsiz — import
   xatosi»** — the backend's decisive classification finally rendered. Factory balance block
   (expected 973 619 270). Flagged-payments checklist with payer/method/id columns +
   deep link to `/payments?reconciled=false`.

**Rollback:** one ReasonModal — typed «ROLLBACK» input + the exact per-entity deletion
counts from the batch. Two-modal chain dies.

**C3. Svod identity checks (`/reports?tab=svod`).** The two farq checks pinned at top as
headline chips — green «Mos (0)» / red «Farq: X so'm» styled as an incident banner (a
non-zero value is a defect signal, not a display option).

---

## §6. Print document flows

All frontend-only: `/print/*` routes render `PrintDocument` (`04` §4.7) from data the API
already serves. Each opens as an on-screen preview with a sticky «Chop etish» toolbar (copy
count, dealer-entity select — remembered); browsers provide PDF. Entry points are contextual
(`P` on detail pages opens the print menu). Money tabular, single «so'm» per column header,
black-on-white, states as bracketed words.

**6.1 Yuk xati (driver waybill)** — A5 landscape, 2 copies per sheet (haydalma nusxa /
ofis). Entry: order workbench «Chop etish ▾» (offered by toast at LOADING). Content: ORD №
+ sana large; Zavod (yuklash) → Mijoz (name, hudud, telefon); Moshina (plate 14pt) +
Shofyor (snapshot name + phone); items table (Mahsulot, o'lchami, paddon, m³); **Σ paddon
huge** (what the gate counts) + Σ m³; pallet note «Paddonlar qaytariladigan idish — N dona
mijoz zimmasiga o'tadi»; signatures: Yukladi (zavod) / Shofyor / Qabul qildi (mijoz).
**No prices** — cost is confidential, the driver carries no money data (sale-price toggle
in the toolbar exists, default off).

**6.2 Hisob-faktura (client invoice)** — A4, from the order workbench. Sotuvchi (dealer
entity + INN) / Xaridor columns; items: Mahsulot · m³ · narx (so'm/m³, stored precision) ·
Summa; lump-sum rows print the agreed total + «kelishilgan summa» note with back-solved
unit price small; sub-total «Mahsulot jami» → conditional «Transport xizmati» line (only
DEALER_CHARGED) → **JAMI = saleTotal + transportCharge** (14pt) + amount in words; footnote
«Paddonlar (N dona) qaytariladi — narxga kirmaydi» (the in-kind rule made contractual);
to'lov muddati (dueDate); Narxlanmagan items render «narx kelishilmoqda» rows excluded from
totals with an asterisk; optional balance-after line (toggle); signatures.

**6.3 Kvitansiya (cashier receipt)** — A5, 2-up (mijoz nusxasi / kassa nusxasi). Entry:
composer success state, payment peek, kassa feed rows. Content: КВИТАНЦИЯ-style header «№ +
datetime»; Kimdan/Kimga (party); Summa large + **so'z bilan** (Uzbek number-to-words
frontend util); usul + kassa; USD equation when applicable; allocation mini-list
(«ORD-000214 uchun: 3 000 000»); the party's new balance line («Qoldiq: Qarz 7 450 000
so'm»); Topshirdi / Qabul qildi signatures. **Guard: TRANSPORT_DIRECT and voided payments
refuse to print** — the route renders an explainer instead («kassadan pul o'tmagan — mijoz
shofyorga to'lagan» / «hujjat bekor qilingan»).

**6.4 Akt sverki (solishtirish dalolatnomasi)** — A4, multi-page-safe; client and factory
variants. Entry: party page header, Debts row action, `?from&to`. Content: title
«O'ZARO HISOB-KITOB SOLISHTIRISH DALOLATNOMASI» + period + both party blocks; framed opening
balance («Davr boshiga mijozning qarzi: …»); the PartyStatement verbatim in classic two-column
money form (Sana / Hujjat / Izoh / Debet / Kredit / Qoldiq); reversal pairs printed with the
«storno» marker and chain reference; TRANSPORT_DIRECT lines annotated «shofyorga to'langan»;
unreconciled rows marked «tekshirilmagan» honestly; framed closing balance in digits and
words; **paddon qo'shimchasi** mini-table (davr boshi / berildi / qaytarildi / undirildi /
davr oxiri — «pulga kirmaydi»); dual signatures (Diler / Mijoz yoki Zavod) + «e'tirozlar 10
kun ichida bildiriladi» line; page numbers, repeating table headers.

---

## §D. Edge-path catalog (binding — designed, not hoped for)

- **Credit rejection at order submit:** the rail's projected-balance block turns danger and
  renders the server's limit/current/new figures verbatim; nothing entered is lost; editing
  items or removing the transport charge re-validates live.
- **Capacity rejection:** unreachable — the rail blocks submit at Σ paddon > capacity with
  the vehicle's own number shown; switching vehicles re-evaluates.
- **Cashbox shortfall race:** live box balance shown at pick; if the server still rejects,
  the inline panel prints the server's shortfall figure and the CashboxSelect refetches.
- **«Already allocated to this order»:** unreachable — rows disabled with «avval bekor
  qiling» (§A guards).
- **Void cascades:** ReasonModal impact preview enumerates from loaded data — the user
  confirms consequences, not prose.
- **Composer/stepper resume:** sessionStorage per route restores entered values after a
  hard refresh; cleared on submit/cancel — a phone call mid-order costs zero re-typing.
- **Concurrent edits:** a socket event touching the record open in a drawer shows the amber
  ribbon «Yozuv yangilandi — qayta yuklandi» (or «— Yangilash» when a form is in flight);
  forms are never silently overwritten; server row-locks remain the actual guard.
- **Session expiry mid-flow:** 401 → `/login?next=` → re-login lands back on the exact
  filtered view; composer drafts survive via sessionStorage.
- **Socket down in the field:** amber reconnect banner on agent mobile, pull-to-refresh
  enabled, «oxirgi yangilanish HH:mm» always visible; refetch-on-focus safety net.
- **Double-click on any money submit:** idempotency key returns the original payment;
  buttons self-disable keeping their verb — the UI never has to apologize.
