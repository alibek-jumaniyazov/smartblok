# SmartBlok — Screen Spec: Zavodlar · Zavod hubi · Bonus · Paddonlar (v1)

**Scope:** `/factories`, `/factories/:id` (settlement hub), `/bonus`, `/pallets` + the factory
akt sverki print entry. Binding parents: `02-design-language.md` (tokens, money semantics,
platform state law), `03-shell-and-ia.md` (IA, URL contract, keyboard map), `04-components.md`
(component anatomy), `05-hero-workflows.md` §3 (hero c — factory settlement), §6.4 (akt sverki).
Business rules: `01-design-brief.md` — Factory ops & bonus, Warehouse/Pallets sections. Nothing
here invents a component or a color; everything composes the canonical library.

**Roles on these screens:** `/factories`, `/factories/:id`, `/bonus` → **A B only** (route guard
403 for G/K; AGENT receives only `{id,name,active}` from `GET /factories` — used solely by the
order composer, never by these pages). `/pallets` → **A B** full, **G** read-only own-scope
(primary entry for G is `/debts?tab=paddonlar`; the direct route renders the same scoped view).
**K** → 403 on all four.

---

## 0. API facts these screens are built on (verified in `apps/api/src`)

| Endpoint | Verified payload / params | Design consequence |
|---|---|---|
| `GET /factories?search&page&pageSize` | Server search + pagination (pageSize ≤ 200, default 50). A/B rows: `{id,name,note,active,balance,bonusBalance,palletsHeld}` | The 50-row silent cap dies: table wires `search` + `page` to the server. **`palletsHeld` uses the list-only formula (received − returned, no ADJUSTMENT/REVERSAL)** — the register's Paddon column instead joins `GET /pallets/balances` (pallet-module formula, one truth). |
| `GET /factories/:id` | `{…factory, balance, bonusBalance, statement[FULL, with running], payments[≤50 non-voided], bonusPrograms[all], bonusTransactions[≤50 + order.orderNo], palletTransactions[≤50]}` | **Verify `03` §10a = FALSE**: the statement arrives complete, un-windowed. Fallback per §10a: window client-side over the full payload — the opening balance is computed **exactly** (Σ rows before `from`), labeled «to'liq tarixdan hisoblangan». The three ≤50 lists are labeled «oxirgi 50» and always link to their full registers. |
| `GET /factories/:id/bonus-program` | `{current, history[]}` | Program badge source for register, wallet cards, hub. Per-row `useQueries` (cached, long staleTime) — honest N+1 over a tiny entity; at 10× factories the fix is a list field (noted, not designed around). |
| `POST /factories/:id/bonus-program` | `{kind, ratePerM3?, percent?, effectiveFrom?}`; unique `(factoryId, effectiveFrom)` | Same-date collision pre-checked client-side against the loaded `history` before submit. |
| `PUT /factories/:id` | accepts `active: boolean` | **Faollashtirish is real** for factories (unlike clients) — symmetric row action ships. |
| `GET /bonus/wallets` | `[{factory:{id,name,active}, balance}]`, active-or-nonzero only | Wallet cards. |
| `GET /bonus/transactions?factoryId&page&pageSize` | Paged rows incl. `factory`, `order{id,orderNo}`, `program{kind,ratePerM3,percent}`, `payment{id,kind,method,amount,date}`, `baseM3`, `baseAmount`, `reversalOfId` | Accrual basis renders as **real columns** («25,000 m³ × 5 000 = 125 000»); program version linkable; DEBT_OFFSET rows deep-link their payment. |
| `POST /bonus/withdraw` `{factoryId,amount,cashboxId,date?,note?}` / `POST /bonus/offset` `{factoryId,amount,date?,note?}` / `POST /bonus/transactions/:id/reverse` `{reason}` | Server re-checks wallet under `FOR UPDATE`; withdraw = UZS active cashbox only; reverse = WITHDRAWAL only | Focused modals (hero `05` §3.5), wallet refetched on open, server messages verbatim. |
| `GET /pallets/balances` | `{clients:[{client,balance}], factories:[{factory,balance}]}` — AGENT: clients only, own scope | The one truth for every pallet figure app-wide. |
| `GET /pallets/transactions?clientId&factoryId&page&pageSize` | **No server `type`/date params.** Rows incl. `client`, `factory`, `order{id,orderNo}`, `unitPrice` (**only CHARGED_LOST rows carry one — every factory-side row is `null`**), `reversalOfId` | Party filters are server-side; **Turi + sana filters are client-side over a labeled window** (visible «oxirgi 200 yozuv ichida» label — bounded, honest); totals footer labeled «sahifa jami». Backend filter params are the 10× fix (noted). |
| `POST /pallets/client-return` `{clientId,qty,date,orderId?,note?}` | `orderId` supported, no UI today | The modal gains an optional Buyurtma select. |
| `POST /pallets/factory-return` `{factoryId,qty,date,note?}` / `POST /pallets/charge-lost` `{clientId,qty,date,unitPrice?,note?}` | **Factory-return is moneyless: it takes NO `unitPrice` and rejects one with 400** (in-kind count only; two DB CHECKs — `pallet_factory_return_moneyless`, `ledger_no_pallet_return_credit` — make it unreintroducible). Only charge-lost carries money: its `unitPrice` defaults to 130 000 server-side | The factory-return modal has **no price field at all**; only Undirish prefills from `GET /settings → palletPriceDefault` (A/B readable) with a deviation hint — the hardcoded frontend constant dies. |
| `GET /orders?factoryId&status&dateFrom&dateTo&page&pageSize` | List rows carry all order scalars incl. `costStatus`, `costTotal`, `saleTotal` | Feeds the hub's «Ochiq buyurtmalar» strip (bounded windowed scan, window selector visible). No `costStatus` server filter → client-derived, labeled. |
| `GET /payments?kind=FACTORY_OUT&factoryId&dateFrom&dateTo&reconciled&voided&page` | Full server filtering | Hub To'lovlar tab «Hammasini ko'rish →» and the Taqsimlash entry list. |
| `POST /payments` (FACTORY_OUT) · `POST /payments/:id/allocations` | existing | PaymentComposer + SettleDrawer (`04` §3.2/§3.3) — entry points wired here, anatomy owned there. |

---

# 1. `/factories` — Zavodlar (register)

## 1.1 Maqsad

The supplier roster answered in one scan: *which factories do we owe, how much bonus sits in
each wallet, on what program, and how many pallets are we accountable for* — every figure a
door into the settlement hub. Roles: A B.

## 1.2 Layout

Standard register (interaction grammar row 1): `PageHeader` + `FilterBar` + `DataTable`.
No PeekPanel — a factory's detail is a full hub page, rows open it directly.

```
┌ PageHeader ──────────────────────────────────────────────────────────────┐
│ Zavodlar                                    [Yangi zavod  N] [⋯]         │
├ FilterBar ───────────────────────────────────────────────────────────────┤
│ [⌕ Qidirish…  /]                       3 ta · sahifa jami: Qarzimiz 184,3 mln │
├ DataTable ───────────────────────────────────────────────────────────────┤
│ Nomi          Balans (so'm)      Bonus hamyoni  Bonus dasturi  Paddon  … │
│ CAOLS KS      Qarzimiz 184 250 000   4 310 000  PER_M3 5 000/m³  214    ⋮ │
│ Xorazm GB     Avansimiz 12 400 000     320 000  1,5 %             36    ⋮ │
│ Eski zavod ᵍʳᵉʸ Hisob yopiq                  0  —                  0    ⋮ │
│ ── Sahifa jami ──  Qarzimiz 171 850 000 · 4 630 000 ·            250     │
└──────────────────────────────────────────────────────────────────────────┘
```

## 1.3 Component instances & data

| Instance | Component (`04`) | Data source |
|---|---|---|
| Header | `PageHeader` | `title: "Zavodlar"`, primary action «Yangi zavod» (`N`), overflow kebab: none needed. |
| Filter row | `FilterBar` | Search → `GET /factories?search=` (debounced 300ms, server-side). **No status/other filter tokens** — the API filters nothing else; a control the server ignores never renders (`03` §7). Result meta: «N ta» (server `total`) + «sahifa jami: …» net position of the visible page (honestly labeled). |
| Table | `DataTable` | `GET /factories?search&page&pageSize` (react-query, keepPreviousData). Columns below. Pagination server-driven. Sort headers **disabled with tooltip** «server tartiblashni qo'llab-quvvatlamaydi» (API sorts by name only). |
| Balans column | `BalanceTag` `partyType='factory'` | `items[].balance`. >0 → «Avansimiz 12 400 000» (green tint), <0 → «Qarzimiz 184 250 000» (amber tint — our liability, `moneyWeOwe`), \|v\|<1 → «Hisob yopiq» grey. Raw sign never shown. |
| Bonus hamyoni column | `MoneyCell` neutral | `items[].bonusBalance`. Header carries «(so'm)» once. |
| Bonus dasturi column | program badge — `StatusChip`-styled neutral chip | Per-row `GET /factories/:id/bonus-program` via `useQueries` (cached ≥5 min). Text: «PER_M3 5 000/m³» / «1,5 %» / «—» (NONE or none). Small per-cell shimmer while loading — never a page blocker. |
| Paddon column | plain `.num` + `PalletChip` popover on hover/focus | `GET /pallets/balances → factories[]` joined by id (**not** the list's `palletsHeld` — one formula, one truth). Header: «Paddon (dona)». |
| Holat | grey pill «Nofaol» on inactive rows only; row also gets the inactive grey wash | `items[].active` |
| Totals row | `TotalsRow` | «Sahifa jami» — page-scope net Balans (Σ, rendered as one BalanceTag), Σ bonus, Σ paddon. No server aggregate exists → honestly page-scoped. |
| Row kebab (labeled, aria «CAOLS KS amallari») | menu | «Ochish» → hub · «To'lash `T`» → PaymentComposer FACTORY_OUT pre-bound · «Tahrirlash» → drawer · «Nofaol qilish» / «Faollashtirish» (symmetric — `PUT /factories/:id {active}`). |
| Create/Edit | right drawer 480px (grammar: simple record) | `POST /factories` / `PUT /factories/:id`. Fields: Nomi (majburiy, ≤200) · Izoh (≤1000) · (edit) Faol switch. Duplicate-name server error verbatim inline under Nomi. |
| Deactivate confirm | plain confirm modal (not ReasonModal — the API takes no reason; a fake reason field would be dishonest) | copy: «"CAOLS KS" nofaol qilinadi. Tarix saqlanadi — hech narsa o'chirilmaydi.» Confirm «Nofaol qilish» (danger), never default-focused. |

## 1.4 Actions

- **Yangi zavod** (`N`, header) → create drawer.
- **Row click / `Enter`** → `/factories/:id`. Identity cell stays a real link (middle-click).
- **`T` on cursor row** → PaymentComposer FACTORY_OUT with the factory pre-bound (global list-key contract `03` §8).
- Kebab (`.`): Ochish · To'lash · Tahrirlash · Nofaol qilish/Faollashtirish.
- Palette: factory records searchable via `GET /factories?search=`; highlighting one offers «To'lash — CAOLS KS», «Ochish».

## 1.5 Filters & URL

`/factories?search=&page=` — that is all (`useUrlFilters`). Any param change resets `page`.
Unknown params → red clearable token.

## 1.6 Keyboard

Register standard (`03` §8): `/` search · `N` new · `J/K` `↑↓` cursor · `Enter` open · `.` kebab
· `T` pay. No `Space` (no peek), no `X` (no bulk verbs — financial corrections stay single).

## 1.7 States

Platform law (`02` §9) verbatim: 8 skeleton rows on first load; refetch hairline; empty base →
`EmptyState` «Hali zavod yo'q — Yangi zavod»; filtered-empty → «Filtrga mos yozuv topilmadi ·
Filtrlarni tozalash»; query error → `ErrorState` in place. Realtime: `factory`/`bonus`/`pallet`
key families invalidate (2s coalesced) → changed row pulses once.

## 1.8 Roles & responsive

A B identical. G/K: route 403 (+ «Bosh sahifaga qaytish»). 1200–1599: Bonus dasturi + Paddon
fold into row expand. <768 (desk role on phone): 2-line cards — name + «Nofaol»
/ BalanceTag + bonus beneath; read-and-approve posture.

## 1.9 Removed vs today — and why

| Today | Fate | Why |
|---|---|---|
| Client-side search over the first 50 rows | **Dies** → server `?search`+`page` | Silent truncation beyond 50 factories (brief pain point). |
| `palletsHeld` from the list payload | **Ignored** → joined from `/pallets/balances` | Two divergent formulas showed two different numbers for one factory; pallet-module formula is the mandated single truth (`03` §4). |
| Solid green «Avans» / red «Qarz» AntD tags + signed Money | **Die** → `BalanceTag` Avansimiz/Qarzimiz/Hisob yopiq | Sign convention moves out of the user's head (`02` §1); solid preset tags banned (`02` §2.4); «Avans» alone was ambiguous about whose advance. |
| Icon-only edit/stop buttons | **Die** → labeled kebab | Icon-only controls are extinct (`02` §10). |
| Card-wrapped title + centered create Modal | → `PageHeader` + 480px drawer | One identity block per page; grammar: simple record = right drawer. |
| Reactivation hidden inside edit modal switch | → symmetric «Faollashtirish» row action | API supports it; hidden flows die. |
| Nothing lost: create, edit, deactivate, search, all five columns survive. | | |

---

# 2. `/factories/:id` — Zavod hubi (settlement hub)

## 2.1 Maqsad

Hero workflow (c): the weekly big-tranche settlement — **pay, allocate, watch cost finalize,
spend bonus, return pallets — without ever re-selecting the factory or leaving the page.** The
balance sentence is the interface; the statement verifies every action in place. Roles: A B.

## 2.2 Layout

```
┌ PageHeader (breadcrumb: Zavodlar / CAOLS KS) ────────────────────────────────┐
│ CAOLS KS   [Nofaol?]                    [To'lash T] [Taqsimlash] [⋯ P]       │
├ PartyBalanceHeader ──────────────────────────────────────────────────────────┤
│ Zavodga qarzimiz: 184 250 000 so'm                (money-hero, amber ink)    │
│ [Bonus: 4 310 000 · PER_M3 5 000/m³ · 01.06 dan] [Paddon: bizda 214 dona]    │
│ [To'lash] [Taqsimlash] [Bonusdan yopish ▾] [Paddon qaytarish]                │
├ «Ochiq buyurtmalar» strip ───────────────────────────────────────────────────┤
│ ⚠ 14 ta buyurtma tannarxi qotirilmagan — jami 96,4 mln (taxminiy)            │
│   Taxminiy 11 · Qisman 3 · [oxirgi 90 kun ▾]              Hammasi → /orders  │
├ Tabs (?tab=) ────────────────────────────────────────────────────────────────┤
│ Hisob-kitob* · To'lovlar · Bonus dasturi · Paddonlar                          │
│ ┌ PartyStatement ─────────────────────────────────────────────────────────┐ │
│ │ [Bugun·7 kun·Shu oy·O'tgan oy·Shu yil·Oraliq…]        [Chop etish ⎙]    │ │
│ │ Boshlang'ich qoldiq · 01.07.2026            Qarzimiz 210 120 000 (inset)│ │
│ │ 03.07  Buyurtma tannarxi · ORD-000141   − 8 400 000   Qarzimiz 218 520 000│
│ │ 05.07  To'lov · Zavodga to'lov (O'tkazma) + 150 000 000  Qarzimiz 68 520 000│
│ │ 05.07  Tannarx tuzatish · ORD-000138        − 121 500   …                │ │
│ │ 05.07  Bonus hisobga olish · To'lov (BONUS) + 2 500 000  …               │ │
│ │ Yakuniy qoldiq · 11.07.2026                 Qarzimiz 184 250 000 (inset) │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
```

Sticky-condensed on scroll: 48px bar — «CAOLS KS · Qarzimiz 184 250 000» + «To'lash».

## 2.3 Component instances & data

| Instance | Component | Data source |
|---|---|---|
| Header | `PageHeader` | `GET /factories/:id` (name, active). Actions mirror the balance-header quick actions; overflow: «Tahrirlash `E`» · «Akt sverki `P`» → `/print/statement/factory/:id?from&to` · «Nofaol qilish». |
| Balance hero | `PartyBalanceHeader` | `balance` from detail. Sentence: <0 → «Zavodga qarzimiz: 184 250 000 so'm» (`moneyWeOwe` amber); >0 → «Zavodda avansimiz: 12 400 000 so'm» (`moneyIn` green); \|v\|<1 → «0 so'm · Hisob yopiq». Counters: bonus chip (wallet + program badge + «01.06 dan», from detail `bonusBalance` + bonus-program query; click → `?tab=bonus`) · `PalletChip` «bizda 214 dona» (from `GET /pallets/balances` factories row; popover shows received − returned ± adjustments math; click → `?tab=paddonlar`). Inactive factory: grey wash + «Nofaol» pill; mutating actions hidden, statement stays. |
| Quick actions | buttons on `PartyBalanceHeader`, PERMISSIONS-filtered | **To'lash** (`T`) · **Taqsimlash** · **Bonusdan yopish ▾** · **Paddon qaytarish** — all pre-scoped to this factory (§2.4). |
| Ochiq buyurtmalar strip | slim inline panel (composition: warning-tint bar, no Card-in-Card) | Bounded scan: `GET /orders?factoryId=:id&dateFrom=…` pages within the selected window (chips «oxirgi 30 kun / 90 kun / joriy yil», default 90 kun — the window is visible: honesty governance `03` §6), client-filtered `status ≠ CANCELLED && costStatus ≠ FINAL`. Renders: count + Σ `costTotal` labeled «taxminiy» + per-status chip counts (StatusChip «Taxminiy» grey / «Qisman» amber). Zero state: strip collapses to one green line «Barcha tannarxlar qotirilgan ✓» — the finalization pipeline is visibly clean. «Hammasi →» `/orders?factoryId=:id&chip=cost-open`. |
| Tab: Hisob-kitob (default) | `PartyStatement` `partyType='factory'` | Detail `statement[]` (full, with `running`). `DateRangeControl` presets write `?from&to`; window applied client-side; **pinned opening row** = Σ of rows before `from` (exact — full payload; caption «to'liq tarixdan hisoblangan»); pinned closing row. Source labels from shared `LEDGER_SOURCE` map: ORDER_COST → «Buyurtma tannarxi», COST_ADJUSTMENT → «Tannarx tuzatish», PAYMENT → «To'lov», BONUS_OFFSET → «Bonus hisobga olish», PALLET_RETURN_CREDIT → «Paddon qaytarish krediti» (**RETIRED source — this entry is a rendering label for historical rows only; nothing can post a new one, a factory return moves zero money**), ADJUSTMENT → «Tuzatish», IMPORT rows keep note as `ArtifactText`. Every row's document is a link: order → `/orders/:id`, payment → `/payments/:id` peek. Amounts signed `MoneyCell` (+ green inflow-to-our-favor / − plain text — spending is not an error), running balance as semantic word + amount. Reversal pairs chained (gutter connector, «storno» chips, hover pairs). 40% inset zebra ON (statement rule). Month separators sticky. |
| Tab: To'lovlar | `DataTable` (embedded, dense) | Detail `payments[]` — labeled **«oxirgi 50 · bekor qilinganlarsiz»**. Columns: Sana · Usul (Naqd/O'tkazma/Karta/USD/Bonus from shared map) · Summa (so'm) · Kassa · Taqsimot (mini-bar taqsimlangan/qoldiq — lazy per-row allocations fetch per `03` §10c, per-cell spinner) · Izoh. Row click → `/payments/:id` peek. Footer link: **«Hammasini ko'rish →»** `/payments?kind=FACTORY_OUT&factoryId=:id` — the 50-cap stops lying. |
| Tab: Bonus dasturi | program panel + history + movements | `GET /factories/:id/bonus-program`. **Joriy dastur** block: kind label («Har m³ uchun stavka» / «Xarid summasidan foiz» / «Bonus yo'q»), rate/percent at full precision, «Kuchga kirgan: 01.06.2026», permanent caption: «PERCENT asosi — faqat blok tannarxi, paddon puli hisobga kirmaydi» (locked rule made visible) + «Yangi dastur» button. **Dastur tarixi** table: Turi · Stavka/foiz · Kuchga kirgan · Kiritilgan — current row pinned/highlighted, future-dated rows badged «kelgusi». **Bonus harakatlari** table: detail `bonusTransactions[]` labeled «oxirgi 50», columns as `/bonus` journal (§3.3) minus Zavod; footer «To'liq jurnal →» `/bonus?factoryId=:id`. |
| Yangi dastur | right drawer 480px | `POST /factories/:id/bonus-program`. Permanent banner: «Dastur versiyalanadi — yangi shart faqat shu sanadan keyin YAKUNLANGAN buyurtmalarga qo'llanadi; eski hisob-kitoblar o'zgarmaydi.» Segmented kind (PER_M3 / PERCENT / NONE) → conditional `MoneyInput` stavka («so'm/m³») or percent (2dp, ≤100, >0); effectiveFrom date (default bugun). **Collision pre-check:** if `history` already has this `effectiveFrom` → inline error before submit: «Bu sana uchun dastur allaqachon kiritilgan — boshqa sanani tanlang» (the raw unique-constraint 500 is unreachable). Submit «O'rnatish» (Ctrl+Enter). |
| Tab: Paddonlar | `DataTable` + `PalletChip` header | Detail `palletTransactions[]` labeled «oxirgi 50». Columns: Sana · Turi (dot StatusChip from shared pallet map) · Soni (dona) · Izoh — **no Narx, no Jami: toward a factory a paddon is a COUNT and nothing else, so no row here can carry money**. REVERSAL rows ghost-styled, chained. Header: balance chip + one action «Paddon qaytarish». Footer: «To'liq harakatlar →» `/pallets?factoryId=:id`. |

## 2.4 Actions (all pre-scoped — the factory is never re-selected)

| Action | Surface | Wiring |
|---|---|---|
| **To'lash** (`T`) | `PaymentComposer` drawer 560px (`04` §3.3), kind FACTORY_OUT locked, factory locked with BalanceTag | `POST /payments`. Method segmented shows the consequence line at the point of choice: «O'tkazma — taqsimlanganda tannarx ZAVOD O'TKAZMA narxida qotiriladi» (Naqd/Karta/USD → «zavod naqd narxida»). Receiver `LegalEntitySelect` pre-picked from last payment. Checkbox **«Saqlash va taqsimlash»** chains into SettleDrawer. Idempotency key per open. |
| **Taqsimlash** | popover list → `SettleDrawer` (`04` §3.2) | Popover «Taqsimlanmagan to'lovlar»: `GET /payments?kind=FACTORY_OUT&factoryId=:id` (non-voided, window labeled «oxirgi 50 to'lov»), rows with open remainder (lazy §10c) shown as «05.07 · 150 000 000 · qoldiq 12 400 000»; exactly one open payment → skips the popover straight into the drawer; none → disabled with tooltip «Taqsimlanmagan to'lov yo'q». Drawer candidates: this factory's non-FINAL orders oldest-first; per-row «Qoplanmagan» + PARTIAL hairline + forecast chips «→ Qotiriladi (o'tkazma narxi)» / «→ Qisman»; `A` = FIFO; footer `LedgerImpactPreview` («N ta buyurtma tannarxi QOTIRILADI … tannarx farqi COST_ADJUSTMENT sifatida yoziladi · M ta foizli bonus qayta hisoblanadi»). `POST /payments/:id/allocations`. URL: `?panel=taqsimlash&payment=<id>`. |
| **Bonusdan yopish ▾** | split menu → two focused modals (hero `05` §3.5) | **Zavod qarziga o'tkazish** → `POST /bonus/offset`: wallet refetched on open («Hamyonda: 4 310 000»), `MoneyInput` with «max» chip, live «Qoladi: 1 810 000», canonical-chain sentence «BONUS usulidagi zavod to'lovi yaratiladi — kassadan o'tmaydi». **Naqd yechish** → `POST /bonus/withdraw`: + `CashboxSelect` (UZS-only, active, live balance) and the crediting line «Naqd kassaga kirim yoziladi». Both: server wallet re-check message verbatim on race. Success: BONUS_OFFSET / kassa row visible in statement via socket; wallet chip decrements (no animation — pulse only). Wallet 0 → menu disabled with «Hamyon bo'sh». |
| **Paddon qaytarish** | pallet factory-return modal (§4.5) pre-bound to this factory | `POST /pallets/factory-return`. No price field. Shows current → post-action accountability and the impact line «Pul harakati yo'q — faqat paddon soni hisoblanadi · Zavod hisobi (pul) o'zgarmaydi». |
| Tahrirlash (`E`) | edit drawer (same as register) | `PUT /factories/:id` |
| Akt sverki (`P`) | `/print/statement/factory/:id?from&to` (period = current statement window) | `05` §6.4 factory variant: framed opening/closing, Debet/Kredit columns, storno markers, paddon qo'shimchasi mini-table «pulga kirmaydi», dual signatures Diler / Zavod. |
| Nofaol qilish | confirm modal (as §1.3) | `DELETE /factories/:id` |

**Cost finalization made visible (locked rules on this screen):** factory debt appears the
moment an order is booked (ORDER_COST rows in the statement — «buyurtma yaratilganda yoziladi»
helper on the source label tooltip); cost is fixed only at allocation (the strip + Qisman/
Qotirilgan chips + COST_ADJUSTMENT statement rows each linking to their order); voiding a
FACTORY_OUT payment reverts orders to Taxminiy — previewed by the payment's own ReasonModal
(owned by `/payments`), and this hub reflects it via socket (strip count rises, row pulse).

## 2.5 Filters & URL

`/factories/:id?tab=hisob|tolovlar|bonus|paddonlar&from&to&panel=tolash|taqsimlash&payment=<id>`
(`03` §7 row). `from/to` govern the statement and the akt sverki link. `panel=` makes both
money surfaces deep-linkable (palette action «Zavodga to'lash — CAOLS KS» lands on
`?panel=tolash`).

## 2.6 Keyboard

`T` To'lash · `E` Tahrirlash · `P` print menu (Akt sverki) · `Esc` closes topmost surface ·
composer/drawer keys per `03` §8 (`Ctrl+Enter` submit, `A` FIFO in SettleDrawer). Tabs:
`?tab=` links are plain links (back-button safe).

## 2.7 States

Detail loading: skeleton of the real layout (balance block, action row, tab bar, 6 statement
rows). Statement empty period: «Bu davrda harakat yo'q» + opening = closing rows still pinned.
404 → `ErrorState` «Zavod topilmadi» + «Zavodlarga qaytish». Composer collision: amber ribbon
per platform law. Stale wallet/balance: refetched on every drawer/modal open; client max bounds
advisory — server authoritative. Socket: `factory|bonus|pallet|payment|order` families
invalidate → header balance, strip, statement refetch (2s coalesced), changed rows pulse.

## 2.8 Roles & responsive

A B full. G/K 403. 1024–1199: balance header condenses to top summary strip. 768–1023: single
column; quick actions wrap to 2×2. <768 (A/B on phone — read-and-approve): balance sentence +
chips + statement as 2-line rows; To'lash still opens the composer (bottom sheet); heavy
allocation shows «kompyuterda qulayroq» note but does not block.

## 2.9 Removed vs today — and why

| Today | Fate | Why |
|---|---|---|
| 3 Statistic cards (Balans/Bonus/Paddon) | **Die** → `PartyBalanceHeader` | The balance is a sentence, not a raw signed Statistic; largest text on screen must be the money figure (`02` §1). |
| Read-only page; pay/allocate/bonus/pallets on 4 other pages | **Dies** → 4 pre-scoped in-context actions | The #1 domain pain point: «settle with factory X» forced constant navigation + re-selection. |
| Full-ledger statement client-paginated 20/page, no dates | → windowed `PartyStatement` with exact opening/closing rows, presets, print | A statement is a story with a boundary; endless pagination hid the running position. |
| «oxirgi 50» payments/bonus/pallet tables as dead ends | Kept as previews, **labeled**, each gaining a «Hammasini ko'rish →» link to its filtered register | Honesty: caps stated, full history one click away — nothing silently truncated. |
| `palletsHeld` fetched from all-factories balances | Same endpoint kept (it IS the one-truth formula), read scoped to this row | Already correct source; now stated. |
| Bonus tab info Alert + program Descriptions | → integrated program panel with pinned current, «kelgusi» badges, collision pre-check, PERCENT-base caption | Alert-as-documentation dies; the rule renders where the decision happens. |
| Program modal | → 480px drawer | Interaction grammar (simple record). |
| Nothing lost: statement, payments, program view/set/history, bonus movements, pallet movements all survive and grow. | | |

---

# 3. `/bonus` — Bonus hamyonlar

## 3.1 Maqsad

Cross-factory rebate overview: every wallet, its program, and a fully explained journal —
«why is this accrual 437 500?» answered by a column, not a hover. Actions duplicated here and
on FactoryDetail (context beats navigation). Roles: A B.

## 3.2 Layout

```
┌ PageHeader ───────────────────────────────────────────────────────────────┐
│ Bonus hamyonlar              [Naqd yechish] [Qarzga o'tkazish]            │
├ Wallet cards (grid 4-across lg, act as journal filters) ──────────────────┤
│ ┌ CAOLS KS ─────────────┐ ┌ Xorazm GB ────────────┐                       │
│ │ 4 310 000 so'm        │ │ 320 000 so'm          │                       │
│ │ PER_M3 5 000/m³ ·01.06│ │ 1,5 % · 15.03         │                       │
│ │ [Yechish][O'tkazish][⋮]│ │ …                     │  (selected: primary ring)
│ └───────────────────────┘ └───────────────────────┘                       │
├ Jurnal ───────────────────────────────────────────────────────────────────┤
│ FilterBar: [Zavod: CAOLS KS ×]                      124 ta · sahifa jami… │
│ Sana        Turi          Asos                        Hujjat     Summa    │
│ 05.07 14:21 ● Hisoblandi  25,000 m³ × 5 000 = 125 000 ORD-000141 +125 000 │
│ 05.07 14:40 ● Tuzatish    tannarx qotirilgani uchun…  ORD-000138  +12 400 │
│ 06.07 09:10 ● Qarzga o'tk 05.07 to'lov (BONUS) →     To'lov     −2 500 000│
│ 06.07 10:02 ● Yechildi    Naqd kassaga kirim                     −500 000 ⋮│
└───────────────────────────────────────────────────────────────────────────┘
```

## 3.3 Component instances & data

| Instance | Component | Data source |
|---|---|---|
| Header | `PageHeader` | actions «Naqd yechish» (primary) · «Qarzga o'tkazish»; when `?factoryId=` is active both open pre-scoped to that factory. |
| Wallet cards | card grid (composition; `money-lg` value) | `GET /bonus/wallets`. Per card: factory name (link affordance to `/factories/:id`) · balance `money-lg` full precision · program badge + effective date (per-factory bonus-program query, cached) · «faol emas» grey pill for inactive factories · two inline actions «Yechish» / «O'tkazish» + kebab «Zavod sahifasi». **Card click toggles `?factoryId=`** — selected ring (`colorPrimaryBg`), journal + header actions re-scope. |
| Journal | `DataTable`, server-paginated | `GET /bonus/transactions?factoryId&page&pageSize`. Columns: **Sana** (DD.MM.YYYY HH:mm) · **Zavod** (hidden while filtered to one) · **Turi** dot `StatusChip` (Hisoblandi green / Yechildi amber / Qarzga o'tkazildi blue / Tuzatish grey / Qaytarildi red) · **Asos** (real column, from `baseM3`/`baseAmount`/`program`): PER_M3 → «25,000 m³ × 5 000 = 125 000»; PERCENT → «1,5 % × 8 340 000 = 125 100»; ADJUSTMENT default note «tannarx qotirilgani uchun qayta hisob»; program version chip in the cell links `?tab=bonus` history on the factory hub · **Hujjat**: ACCRUAL/ADJUSTMENT/REVERSAL → order link; DEBT_OFFSET/its REVERSAL → payment link (`/payments/:id` peek); WITHDRAWAL → «Kassa kirimi» text · **Summa (so'm)** signed `MoneyCell` (this is the page's one colored column) · **Izoh** · kebab. Reversed rows ghost-styled + chained to their REVERSAL. |
| Totals | `TotalsRow` | «Sahifa jami» net Σ (no server aggregate — honestly labeled). |
| Row kebab | labeled menu | WITHDRAWAL → **«Qaytarish»** (ReasonModal); DEBT_OFFSET → **«To'lovni ochish — bekor qilish shu yerda»** → `/payments/:id?panel=` peek (voiding the BONUS payment is the only legal reversal path — the locked asymmetry made discoverable); ACCRUAL → «Buyurtmani ochish» (reversal happens via order lifecycle only — no reverse verb here, matching the API). |
| Naqd yechish modal | focused modal | `POST /bonus/withdraw` — anatomy exactly as hub §2.4 (wallet refetch, max chip, qoladi line, UZS `CashboxSelect`, crediting line). Amount min 1 (the min=0 bug dies). |
| Qarzga o'tkazish modal | focused modal | `POST /bonus/offset` — as §2.4. Info line: «BONUS usulidagi zavod to'lovi yaratiladi — kassadan o'tmaydi». |
| Qaytarish | `ReasonModal` + `LedgerImpactPreview` | `POST /bonus/transactions/:id/reverse`. Impact facts from the row: «Hamyonga +500 000 qaytadi» · «Naqd kassadan chiqim (storno) yoziladi» · guard note «kassa balansi yetmasa server rad etadi» (shortfall message verbatim). Reason TextArea required ≥3, confirm «Qaytarish» danger, never default-focused. The closure-variable confirm dies. |

## 3.4 Actions

Header + wallet-card actions (pre-scoped) as above; journal row kebab; every order/payment/
factory reference is a round-tripping link (`03` §9 — bonus DEBT_OFFSET → payment peek is an
audited pair).

## 3.5 Filters & URL

`/bonus?factoryId=&page=&panel=yechish|otkazish` — `factoryId` is the server journal filter and
the card-selection state (one source of truth, shareable). `panel=` deep-links the two modals
(palette actions). Param change resets page.

## 3.6 Keyboard

`/` (no search field — focuses the Zavod filter token) · `J/K` cursor · `Enter` opens the row's
document (order/payment) · `.` kebab · `Esc`. Modals: `Ctrl+Enter` submit.

## 3.7 States

Wallet cards: skeleton cards ×3; error → `ErrorState` in the grid region only. Journal per
platform law. Empty journal (no filter): «Hali bonus harakati yo'q» (no action — accruals are
system-born). Filtered-empty variant standard. All wallet figures refetch on modal open.
Realtime: `bonus|kassa|payment|factory` invalidations; new accrual rows pulse.

## 3.8 Roles & responsive

A B only. <1200: cards 2-across; 768: single column, journal rows 2-line (turi+asos / summa);
<768 desk-on-phone: read-and-approve, actions available, tables → cards.

## 3.9 Removed vs today — and why

| Today | Fate | Why |
|---|---|---|
| Non-clickable wallet cards | → cards are filters + carry actions + program badge | Pain point: actions and balances lived on different pages; cards were decoration. |
| Accrual basis in a hover Tooltip | **Dies** → «Asos» real column with the formula | Invisible on touch, unprintable, per-row hover archaeology. |
| `modal.confirm` with closure-variable reason | **Dies** → `ReasonModal` | Validation-after-OK anti-pattern; impact preview required by `02` §1.3. |
| No path from DEBT_OFFSET to its reversal | → «To'lovni ochish — bekor qilish shu yerda» kebab item | The locked reversal asymmetry (offset dies only by voiding its payment) was undiscoverable. |
| Amount `min={0}` | → `MoneyInput` min 1 | API rejects non-positive; the UI stops offering it. |
| Program invisible outside one factory tab | → badge on every wallet card (+ register column) | Cross-factory program overview pain point. |
| Nothing lost: wallets, factory filter, withdraw, offset, reverse-withdrawal, order links, pagination survive. | | |

---

# 4. `/pallets` — Paddonlar (in-kind ledger)

## 4.1 Maqsad

The returnable-container ledger per party: who holds our pallets (clients), what we are
accountable for (factories), and every movement — with the single money-bearing flow
(Undirish) previewing its exact ledger consequence, and Zavodga qaytarish previewing its zero.
In-kind counts are never mixed with money. Roles: A B full · G read-only own scope.

## 4.2 Layout

```
┌ PageHeader ────────────────────────────────────────────────────────────────┐
│ Paddonlar                                                                  │
├ Balance boards (side by side ≥1200) ───────────────────────────────────────┤
│ ┌ Mijozlardagi paddonlar ──────────────┐ ┌ Zavodlar oldida hisobdorlik ──┐ │
│ │ [⌕ Mijoz…]   [Qaytarish qabul qilish]│ │        [Zavodga qaytarish]    │ │
│ │ Жамол Ургенч          ⬛ 19 dona   ⋮ │ │ CAOLS KS      ⬛ 214 dona  ⋮  │ │
│ │ Гофур Хазорасп        ⬛ 12 dona   ⋮ │ │ Xorazm GB     ⬛  36 dona  ⋮  │ │
│ │ Шиддат маналит       ⬛ −3 dona ⚠  ⋮ │ └───────────────────────────────┘ │
│ └──────────────────────────────────────┘                                   │
├ Paddon harakatlari ────────────────────────────────────────────────────────┤
│ FilterBar: [Mijoz ▾][Zavod ▾] | [Turi ▾][Sana ▾]* (*oxirgi 200 yozuv ichida)│
│ Sana   Turi              Mijoz      Zavod    Soni  Narx(dona)  Hujjat  Izoh│
│ 05.07  ● Mijozga yuborildi Жамол Ург.  —       19      —    ORD-000141  —  │
│ 06.07  ● Zavodga qaytarildi  —      CAOLS KS   20      —         —      —  │
│ ── Sahifa jami: kirim 39 · chiqim 20 (pul harakati yo'q) ──                │
└────────────────────────────────────────────────────────────────────────────┘
```

## 4.3 Component instances & data

| Instance | Component | Data source |
|---|---|---|
| Client board | dense `DataTable` inside a card | `GET /pallets/balances → clients[]` (active-or-nonzero). Columns: Mijoz (link `/clients/:id`) · `PalletChip` balance («19 dona», amber >0, danger negative with inline «⚠ manfiy» word — color never alone) · kebab. Client-side search over the full payload (the endpoint returns everything — bounded by nature, labeled «N ta mijoz»). One primary header action: **«Qaytarish qabul qilish»**. Row kebab: Qaytarish qabul qilish · Undirish (danger) · Mijoz sahifasi. |
| Factory board | dense `DataTable` | `balances → factories[]`. Columns: Zavod (link `/factories/:id?tab=paddonlar`) · `PalletChip` · kebab (Zavodga qaytarish · Zavod sahifasi). Header action: **«Zavodga qaytarish»**. Hidden entirely for G (server sends no factories key). |
| Movements | `DataTable`, server-paginated | `GET /pallets/transactions?clientId&factoryId&page&pageSize`. Columns: Sana · Turi dot `StatusChip` (shared pallet map: Zavoddan olindi / Mijozga yuborildi / Mijoz qaytardi / Zavodga qaytarildi / Undirildi / Tuzatish / Storno) · Mijoz (link) · Zavod (link) · Soni (dona) · **Narx (dona)** (only CHARGED_LOST rows carry a `unitPrice` — the posted client debt; every factory-side row shows «—», there is nothing to price) · Buyurtma (link) · Izoh. **No Jami column** — a per-line money total would imply the factory rows have one. Storno rows ghost-styled + chain glyph to `reversalOfId` pair. |
| FilterBar | `FilterBar` | Mijoz / Zavod `PartySelect` tokens → **server** params. **Turi + Sana oralig'i tokens are client-side** over a labeled window: when active, the page fetches up to 200 rows (API max) for the current party scope and filters locally; a permanent caption on the bar and the totals row states «oxirgi 200 yozuv ichida» — bounded, visible, honest (`03` §6 governance; server params are the 10× fix). Without Turi/Sana active, normal server pagination. |
| Totals | `TotalsRow` | «Sahifa jami» (or «oxirgi 200 yozuv» when the client window is active): net in-kind delta (kirim/chiqim dona) + Σ money of the money-bearing rows (Undirish only — a factory return adds nothing, so a page of pure factory returns honestly shows «pul harakati yo'q»). |
| Qaytarish qabul qilish | modal | `POST /pallets/client-return`. Fields: Mijoz (`PartySelect`, pre-bound from row; option rows show `PalletChip`) · Soni (dona, integer ≥1) · Sana (bugun) · **Buyurtma (ixtiyoriy)** — select of the client's orders (`GET /orders?clientId=`) — the API's `orderId` finally exposed · Izoh. **Balance preview:** «Hozir: 19 dona → Amaldan keyin: 7 dona»; if post-action < 0 → amber warning «Balans manfiy bo'ladi — tuzatish sifatida davom etish mumkin» (warn, don't block — locked design). Info line: «Pul harakati yo'q — faqat soni kamayadi.» |
| Zavodga qaytarish | modal | `POST /pallets/factory-return`. Zavod (pre-bound) · Soni (capped at min(diller qo'lidagi bo'sh paddon, o'sha zavod oldidagi hisobdorlik), cap stated in the field hint) · Sana · Izoh — **no price field at all; the API rejects a `unitPrice` with 400**. Preview: current → post-action accountability + **«Pul harakati yo'q — faqat paddon soni hisoblanadi»** («Zavod paddon uchun pul bermaydi: qaytarish faqat hisobdorlik sonini kamaytiradi») — zero ledger postings named. |
| Undirish | modal, danger confirm | `POST /pallets/charge-lost`. Mijoz (pre-bound) · Soni · **Dona narxi** `MoneyInput` prefilled from `GET /settings → palletPriceDefault` (fallback 130 000) with deviation hint «standart: 130 000» when edited — this is the price charged to a client for a LOST paddon, the app's only pallet-money figure · Sana · Izoh. Warning block: «Mijozga PUL qarzi yoziladi: +1 560 000 so'm» + post-action pallet balance. Confirm «Undirish» danger, never default-focused. |

## 4.4 Actions

One primary per board + row kebabs (the 300px duplicated action column dies). Every mutation
modal opens with the party pre-filled when launched from a row. Palette action «Paddon
qaytarish qabul qilish» → `/pallets?panel=qabul`.

**Locked rules visibly handled:** pallets are counts, never money — `PalletChip` renders
adjacent to, never inside, money; money enters only via the ONE explicit flow (Undirish — a
client billed for pallets he lost), whose modal names its single ledger posting, while
Zavodga qaytarish names its zero; order cancellation reverses only the order's own two
movements (Storno rows chain to them; client returns are never undone — no reverse verb exists
on RETURNED_BY_CLIENT rows); balances always computed, never stored (boards read the sum
endpoint live).

## 4.5 Filters & URL

`/pallets?clientId=&factoryId=&type=&from=&to=&page=&panel=qabul|zavodga|undirish`
(`clientId/factoryId` server; `type/from/to` client-window params — marked with the window
label when active). Param change resets page.

## 4.6 Keyboard

`/` client search · `N` = Qaytarish qabul qilish (page primary) · `J/K`/`↑↓` cursor within the
focused table · `Enter` opens the row party · `.` kebab · modal `Ctrl+Enter`.

## 4.7 States

Boards: skeleton rows; per-region `ErrorState`. Empty client board: «Paddon harakati hali
yo'q» (no action — pallets are born with orders). Movements empty/filtered-empty per law.
Negative balances always paired with the word «manfiy». Realtime: `pallet|client|factory|debts`
invalidations, row pulse.

## 4.8 Roles & responsive

**A B:** everything. **G:** read-only — own clients' balances + movements (server-scoped;
factory board and all mutation buttons absent, not disabled); reached primarily as
`/debts?tab=paddonlar`; on the phone the boards render as card lists (name + `PalletChip`,
whole card → client page), filter chips in a sheet, no hover-only info. **K:** 403.
1200↓: boards stack vertically; movements low-priority columns (Narx, Buyurtma, Izoh) fold
into row expand.

## 4.9 Removed vs today — and why

| Today | Fate | Why |
|---|---|---|
| Three global header buttons duplicating per-row buttons + 300px action column | **Die** → one primary per board + row kebab | Space and redundancy pain point; kebab items stay labeled. |
| Hardcoded `DEFAULT_PALLET_PRICE = 130000` in the frontend | **Dies** → Undirish prefills from the `palletPriceDefault` setting + deviation hint (Zavodga qaytarish has no price field to prefill) | Settings edit silently didn't change the prefill (pain point); single source of truth. The setting means «narx faqat mijoz yo'qotgan paddon uchun». |
| Balance visible only inside select-option labels | → in-modal current → post-action preview, warn on negative | Over-return guard pain point; adjustments stay legitimate (warn, not block). |
| No Turi/date filters, no totals, no line totals | → labeled-window Turi/Sana filters, `TotalsRow`, Narx ustuni only where money really exists (Undirish) | «Did the debt really move by 390 000?» becomes readable in place — and where no debt moved, the row stays «—». |
| `orderId` omitted from client-return | → optional Buyurtma select | API supports it; return-against-truck traceability was being thrown away. |
| Colored AntD Tags (blue/cyan/purple/volcano) for movement types | → dot `StatusChip`s from one shared map | Decorative color budget violation; meanings, not rainbow. |
| Nothing lost: both boards, search, all three mutations, party filters, order/client links, server pagination survive. | | |

---

## 5. Cross-cutting acceptance notes

- **Print:** factory akt sverki (`/print/statement/factory/:id?from&to`) is the only print doc
  born on these screens; entries: hub overflow, `P`. Kvitansiya for FACTORY_OUT/bonus-offset
  payments prints from the payment peek (owned by `/payments`).
- **Glossary compliance:** Paddon (dona) · Qarzimiz/Avansimiz · Taxminiy/Qisman/Qotirilgan ·
  Hisob yopiq · Storno (ledger rows) / Bekor qilish (documents) · Taqsimlash. No synonyms.
- **Numbers never animate**; wallet/balance changes land via refetch + one-shot row pulse.
- **QA reverse test:** from the register's Qarzimiz figure → hub statement rows → each row's
  document in ≤2 clicks; from any bonus accrual → its order in 1; from a DEBT_OFFSET → its
  payment peek in 1; from a money-bearing pallet row → its party page in 1.
