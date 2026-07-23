# SmartBlok — Screen Spec: Tizim (Login · Users · Settings · Profile · Import)

**Status:** implementation-ready screen specification. Governed by `02-design-language.md`
(tokens, money semantics, platform state law), `03-shell-and-ia.md` (shell, routes, URL
contract, shortcuts), `04-components.md` (component anatomy), `05-hero-workflows.md`
(Import wizard = §C2). Nothing here invents a parallel design language; every component
instance below is one from `04`. All server behavior is the existing API, untouched.

Scope: `/login`, `/users`, `/settings`, `/profile`, `/import`.
Roles legend: **A** = ADMIN (Administrator), **B** = ACCOUNTANT (Buxgalter),
**G** = AGENT, **K** = CASHIER (Kassir).

API surface verified against `apps/api/src/`:

| Endpoint | Roles | Payload facts this spec depends on |
|---|---|---|
| `POST /auth/login` | public | `{username, password}` → `{accessToken, user}`; throttled 5/min/IP; unknown user & wrong password return the identical `Login yoki parol xato`; blocked → 403 `Hisob bloklangan` |
| `GET /auth/me` | A B G K | `{id, username, email, name, role, phone, active, agentId}` — **no** lastLoginAt, no agent name |
| `PUT /auth/me` | A B G K | accepts `name?, username?, email?, phone?, password?` only; password change bumps tokenVersion and returns a fresh `accessToken` |
| `GET /users` | A | full unpaginated list, SAFE_SELECT: `id, username, email, name, role, phone, active, agentId, agent{id,name}, lastLoginAt, createdAt, updatedAt` |
| `POST /users` / `PUT /users/:id` | A | username unique 3–32 `[a-zA-Z0-9]`; password min 8; role=AGENT requires valid `agentId`; `active` togglable on update |
| `DELETE /users/:id` | A | soft-only (active=false + tokenVersion bump); guards: not self, not last active ADMIN |
| `GET /settings` | A **B** | merges a **4-key** `DEFAULTS` map (`agentDebtLimitDefault:null, truckCapacityPallets:19, saleMarginMinPct:0, palletPriceDefault:null`) over stored rows — so **`palletPriceDefault` arrives as `null` until a row is written**; the 130 000 so'm fallback is code-only (`PalletService.chargeLost`, lost-pallet charge), never in the response (§3.3 handles the unset case) |
| `PUT /settings/:key` | A | one key per call; **write-whitelist is all 4 keys** (`palletPriceDefault` = the price a CLIENT is billed for a LOST pallet; ≥ 0, `0` ⇒ «belgilanmagan» ⇒ 130 000 applies); validated (server messages are Uzbek **Latin**: e.g. «truckCapacityPallets 1 dan 40 gacha butun son bo'lishi kerak»), audit-logged before/after, returns `{key, value}` (used to patch the `['settings']` cache per field) |
| `POST /import/excel?dryRun=` | **A only** | → `{batchId?, stats}`; `stats = {filename, dryRun, checks[{name, expected, actual, ok}], counts{orders, payments, paymentsByKind{KIND:n}, ledgerEntries, palletTransactions, cashTransactions, allocations, clientsCreated, vehiclesCreated, productsCreated, entitiesCreated, aliasesCreated}, unmatchedClientDriverTrucks[{excelRow, client, date, plate}], unmatchedDriverPayments[{client, amount, date, imported, reason}], unreconciled{total, payments[{client, amount, date, payer}]}, expected{…}, cashboxBalances[{cashboxId, name, currency, in, out, balance}]}` — **the number lives at `stats.unreconciled.total`, not `stats.unreconciledTotal`** (contract drift fixed here) |
| `GET /import/batches` | A only | rows with `filename, createdAt, createdBy{name}, stats, _count{orders, payments, ledgerEntries, palletTransactions, cashTransactions, expenses}` |
| `GET /import/batches/:id/reconciliation` | A only | `{clients[{name, clientId, sheetless, expectedBalance, actualBalance, diff, ok, expectedPallets, actualPallets, palletsOk, sheetGaps?{missingFromSheet[{excelRow,date,plate,amount,pallets}], extraOnSheet[…], oplataNotOnSheet[{date,amount}], adjustedExpectedBalance, adjustedExpectedPallets}, explainedByWorkbookDefect?, palletsExplainedByWorkbookDefect?}], factory{factoryId, expected, actual, diff, ok}, flaggedPayments[{id, date, client, amount, method, payerName, note}], summary{clientsTotal, clientsOk, mismatched[], palletsMismatched[], unexplained[], palletsUnexplained[], factoryOk, flaggedCount, flaggedTotal}}` |
| `DELETE /import/batches/:id` | A only | body `{confirm:true}`; hard-deletes the batch (FK-safe order) |

---

## 1. `/login` — Kirish

### 1.1 Purpose

The product's first impression and its fastest screen. One job: username + password →
cockpit, in under five seconds, on any device, in either theme. Premium comes from
typography, spacing, focus craft and speed — **not** from artwork (no illustrations,
gradients, or glass; `02` §12). Route-table contract (`03` §4) is binding: wordmark,
Login/Parol, «Kirish», anti-enumeration error copy, «Hisob bloklangan» on 403, caps-lock
hint — **nothing else**. No self-registration, no password reset, no demo buttons, no
language switcher: these are deliberate absences, not gaps (the API has no such endpoints).

### 1.2 Layout

Full-viewport `colorBgLayout` canvas. One 400px card (`colorBgContainer`, 1px
`colorBorderSecondary` hairline, `borderRadiusLG` 10, shadow e2 — the only resting shadow
in the app: the login card is a temporary surface by nature). Vertically centered with a
slight optical lift (48% from top). 32px card padding.

```
┌────────────────────────────────────────────────────────────┐
│                     (colorBgLayout canvas)                  │
│                                                            │
│              ┌──────────────────────────────┐              │
│              │  ▦ SmartBlok                 │  wordmark:   │
│              │  Gazoblok biznesini bitta    │  blocks SVG  │
│              │  tizimda boshqaring          │  + 20px/650  │
│              │                              │              │
│              │  (amber note slot:           │              │
│              │   «Sessiya tugadi …»)        │              │
│              │                              │              │
│              │  Login                       │              │
│              │  ┌──────────────────────┐    │              │
│              │  │ ⌷                    │    │  autofocus   │
│              │  └──────────────────────┘    │              │
│              │  Parol            (⚠ Caps)   │              │
│              │  ┌──────────────────────┐    │              │
│              │  │            [👁 aria] │    │              │
│              │  └──────────────────────┘    │              │
│              │  (inline error slot)         │              │
│              │  ┌──────────────────────┐    │              │
│              │  │        Kirish        │    │  40px, block │
│              │  └──────────────────────┘    │              │
│              └──────────────────────────────┘              │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

- **Wordmark row:** stacked-blocks SVG glyph (24px) + «SmartBlok» 20px/650 `colorText`
  (not primary-tinted — chrome yields; the glyph carries the brand color). Tagline
  «Gazoblok biznesini bitta tizimda boshqaring» in `body`/`colorTextSecondary`. The 🧱
  emoji is extinct (`02` §8).
- **Theme:** the page honors `sb_theme` from localStorage, falling back to
  `prefers-color-scheme` — a returning dark-theme user never gets flashed white. No theme
  toggle on this page (nothing else).
- Controls at `size="large"` (40px) — the one screen where controls exceed 32px: it is a
  focus moment, and touch-first for agents.

### 1.3 Component instances & data

| Instance | Source (`04`) | Data |
|---|---|---|
| Login form | plain AntD Form themed by tokens | `POST /auth/login {username: trim(login), password}` |
| Session-expired note | inline amber note (not a toast) | rendered when `?next=` is present AND arrival was a 401 redirect (`02` §9 Session expiry): «Sessiya tugadi — qayta kiring» |
| Inline error | mutation-error law (`02` §9) | server message **verbatim**: `Login yoki parol xato` (401 — identical for unknown user and wrong password, anti-enumeration), `Hisob bloklangan` (403), throttler 429 rendered verbatim with fallback «Juda ko'p urinish — bir daqiqadan keyin qayta urining» |
| Caps-lock hint | `KbdHint`-styled inline warning | keyboard event detection on the Parol field: «⚠ Caps Lock yoqilgan» beside the field label, amber ink + word (color never alone) |
| Submit | primary Button, block | self-disables on submit keeping its verb: «Kirilmoqda…» (double-submit law) |

### 1.4 Actions

| Action | Where | Result |
|---|---|---|
| Kirish | button / `Enter` in any field | on success: token+user → localStorage (`sb_token`/`sb_user`), navigate to `?next=` target if present and same-origin path, else `/` (role-variant cockpit) — re-login returns to the exact filtered view (platform law) |
| Parolni ko'rsatish | eye toggle inside Parol input | `aria-label="Parolni ko'rsatish"` |

Already-authenticated visitors to `/login` redirect to `/` (kept from today).

### 1.5 URL params

| Param | Meaning |
|---|---|
| `next` | percent-encoded in-app path (+query) to return to after login. Only same-origin relative paths are honored; anything else falls back to `/`. Written by the global 401 handler (`/login?next=<current url>`). |

### 1.6 Keyboard

Username field autofocused. `Tab` → Parol → Kirish. `Enter` submits from any field. No
global chords (`Ctrl+K` etc. mount only inside the authed shell).

### 1.7 States

| State | Treatment |
|---|---|
| Submitting | button spinner + «Kirilmoqda…»; fields stay enabled (user may correct a typo mid-flight — the request is cheap) |
| 401 / 403 / 429 | inline error line above the button, `colorError` ink + icon, server text verbatim; the Parol field is cleared and refocused on 401; no shake, nothing bounces |
| Offline / network error | same slot: «Server bilan aloqa yo'q — qayta urining» + the transport error verbatim |
| Empty | n/a (validation: «Loginni kiriting» / «Parolni kiriting» inline on submit) |

### 1.8 Roles

Public; identical for everyone. Role differentiation happens after login (`/` cockpit
variant per role, `03` §1.3).

### 1.9 Responsive

<768px: card becomes full-width with 16px page padding, still vertically centered;
inputs stay 40px (≥44px touch targets with padding); `autocomplete="username"` /
`"current-password"` retained so mobile password managers work. Landscape-phone: card
scrolls, never clips.

### 1.10 Removed vs today, and why

- `Typography.Title` primary-colored 24px+ «SmartBlok» → wordmark glyph + 20px/650 text:
  the largest text budget belongs to money, not chrome; brand color moves into the glyph.
- Ad-hoc 380px width and `boxShadowSecondary` inline style → tokenized 400px / e2 per `03` §4.
- `message.error` toast for login failure → inline error in the form (mutation-error law:
  toasts are confirmations only).
- Added (were missing, all frontend-only): caps-lock hint, `?next=` return contract,
  session-expired note, verbatim 403/429 handling, theme pre-hydration.

---

## 2. `/users` — Foydalanuvchilar

### 2.1 Purpose

ADMIN's account registry: create logins, bind AGENT users to their Agent record, reset
passwords, block/reactivate — with the session-kill consequences of each act stated in
place. Today's page has no search, no filters, no email column, and hides reactivation
inside the edit modal; all four die here.

### 2.2 Layout

Standard register (interaction grammar: PageHeader + FilterBar + DataTable). No PeekPanel
— a user row's full record fits in the edit drawer; there is no user detail page.

```
┌ PageHeader ────────────────────────────────────────────────────────┐
│ Tizim / Foydalanuvchilar                                           │
│ Foydalanuvchilar (20px)                    [ + Yangi foydalanuvchi ]│  ← N
├ FilterBar ─────────────────────────────────────────────────────────┤
│ [⌕ Qidiruv…/]  [Rol: Barchasi ▾] [Holat: Faol ▾]  Tozalash   20 ta │
├ DataTable ─────────────────────────────────────────────────────────┤
│ Login    Ism            Rol           Agent      Email  Telefon  Holat        Oxirgi kirish     ⋮ │
│ botir1   Botir Q.       Administrator —          b@…    +998…    ● Faol       08.07.2026 14:32  ⋮ │
│ jamol22  Жамол          Agent         Жамол →    —      +998…    ● Faol       10.07.2026 09:05  ⋮ │
│ …                                                                  │
│ olim3    Olim T.        Kassir        —          —      —        ● Bloklangan 01.05.2026 11:20  ⋮ │  ← blocked last, ghost-tinted
└────────────────────────────────────────────────────────────────────┘
                                    ┌ Drawer 480px (e2) ─────────────┐
                                    │ Yangi foydalanuvchi        ✕   │
                                    │ …form…                         │
                                    │            [Bekor]  [Saqlash]  │
                                    └────────────────────────────────┘
```

### 2.3 Component instances & data

| Instance | Source (`04`) | Data / config |
|---|---|---|
| `PageHeader` | §1.2 | title «Foydalanuvchilar», breadcrumb «Tizim / Foydalanuvchilar», primary action «Yangi foydalanuvchi» (+ KbdHint `N`) |
| `FilterBar` | §1.3 | search + 2 typed filters (below). **Honesty note:** `GET /users` returns the complete unpaginated list, so search/filter/sort run client-side over the *full* payload — complete, not a window; no scope label needed. Result meta: «N ta» (no money → no Σ) |
| `DataTable` | §1.5 | `GET /users`; 36px rows; columns below; **no server sort exists, but because the full dataset is loaded, client-side sort headers are enabled** (this is not the forbidden «silent sort of one page» — the set is whole); default order: Faol first, then `name` A→Z, Bloklangan rows always last |
| `RolePill` | §4.8 | from the single shared `ROLES` map (Administrator / Buxgalter / Agent / Kassir) — the per-page ROLE map in `Users.tsx` dies |
| `StatusChip` | §4.2 | Holat: dot-style «Faol» (success ink) / «Bloklangan» (danger ink); blocked rows additionally render at ghost opacity (60%) with **no** strikethrough (nothing is voided — the account is dormant) |
| Create/edit drawer | grammar: simple record → right drawer 480px | fields §2.4; `POST /users` / `PUT /users/:id` |
| Agent select in drawer | `PartySelect` §2.11 (agent flavor) | `GET /agents` — option rows: name + phone; no BalanceTag (not a money party here) |
| Block confirm | danger confirm modal — **deliberately not `ReasonModal`**: `DELETE /users/:id` accepts no reason field, and we never fake inputs the API ignores | consequence sentence, §2.4 |
| `EmptyState` / `ErrorState` | §4.6 | per platform law |

Columns (left→right): Login (identity cell, explicit link target for middle-click — opens
the edit drawer) · Ism · Rol (`RolePill`) · Agent (linked `agent.name` → `/agents/:id`,
em-dash when null) · Email (`email`, em-dash when null — **finally rendered**) · Telefon ·
Holat (`StatusChip`) · Oxirgi kirish (`lastLoginAt` as `DD.MM.YYYY HH:mm`, em-dash if
never) · trailing kebab. At <1200px Email and Oxirgi kirish fold into the row expand
(`03` §11).

### 2.4 Actions

| Action | Where | Behavior |
|---|---|---|
| Yangi foydalanuvchi | header primary / `N` / palette «Amallar» | opens the 480px drawer, role pre-set AGENT (API default), focus on Login |
| Tahrirlash | row click / `Enter` on cursor row / kebab «Tahrirlash» | same drawer pre-filled; title «Foydalanuvchini tahrirlash — botir1» |
| Bloklash | kebab, danger item — **only** on active rows that are not me (self-block is impossible server-side; the item simply doesn't render for my own row) | danger confirm modal: title «Foydalanuvchini bloklash», body «‹Ism› (login) bloklanadi va barcha faol sessiyalari darhol bekor qilinadi. Hisob o'chirilmaydi — keyinchalik qayta faollashtirish mumkin.», confirm «Bloklash» (danger, never default-focused) → `DELETE /users/:id` |
| Faollashtirish | kebab, **symmetric** primary item on blocked rows (the hidden edit-modal-switch flow dies) | one-click `PUT /users/:id {active:true}`; toast «‹login› faollashtirildi» |
| Parolni almashtirish | inside the edit drawer (no separate row action) | password field, §below |

Kebab menu is labeled per a11y law: `aria-label="botir1 amallari"`; all items carry words,
never icons alone.

**Drawer form** (vertical, 16px gaps, footer «Bekor qilish» + «Saqlash» `Ctrl+Enter`):

| Field | Control | Rules surfaced (all server-mirrored) |
|---|---|---|
| Login | Input | required, 3–32, `[a-zA-Z0-9]` only — helper «Faqat lotin harflari va raqamlar, 3–32 belgi»; uniqueness conflict renders the server 409 verbatim under the field |
| Ism | Input | required, ≤128 |
| Rol | Select from `ROLES` | required. **On edit, when this row is the last active Administrator, the option list disables non-ADMIN choices with the inline reason «Oxirgi faol administrator — rolini o'zgartirib bo'lmaydi»** (server `assertNotLastAdmin` mirrored, never invented). Changing role shows the persistent inline note: «Rol o'zgartirilsa foydalanuvchining barcha sessiyalari bekor qilinadi» |
| Agent | `PartySelect` (agents) | renders **only** when Rol = Agent; required then; helper «Bu foydalanuvchi qaysi agent nomidan ishlaydi». Switching away from Agent clears the binding (PUT sends `agentId: null`) |
| Parol | Input.Password | create: required, min 8 («Kamida 8 belgi»); edit: optional — «Bo'sh qoldirilsa parol o'zgarmaydi. Almashtirilsa, foydalanuvchining barcha sessiyalari bekor qilinadi.» |
| Email | Input | optional, email format; uniqueness 409 verbatim under the field |
| Telefon | Input | optional, ≤32, placeholder «+998 …» |
| Faol | Switch (edit only) | disabled for my own row with reason «O'z hisobingizni bloklab bo'lmaydi»; disabled+reason on the last active Administrator; turning off shows the same session-kill note |

Footer of the drawer carries the audit line (small, `colorTextSecondary`): «Har bir
o'zgarish audit jurnaliga yoziladi». Dirty-close guarded (`02` §9). Mutation errors map
inline to fields where the server names them; otherwise render verbatim above the footer.

### 2.5 Filters & URL params

| Param | Values | Filter |
|---|---|---|
| `search` | text | client-side over login + ism + email + telefon (full payload) |
| `role` | `admin/accountant/agent/cashier` | Rol select (labels from `ROLES`) |
| `status` | `faol/bloklangan` | Holat select; default absent = Barchasi (blocked still sort last) |
| `page` | number | table page (client-side pagination, 20/page) |

All via `useUrlFilters`; shareable; every change resets `page`.

### 2.6 Keyboard

Register-standard (`03` §8): `/` search · `N` new · `F` filter adder · `J/K`/`↑↓` cursor ·
`Enter` edit drawer · `.` kebab · `Esc` closes drawer (dirty-guarded). No `X`/BulkBar —
there are no legal bulk verbs on users (bulk destructive is banned; bulk activate is not
worth a surface at this table size).

### 2.7 States

| State | Treatment |
|---|---|
| First load | 8 skeleton rows, header intact |
| Refetch (after mutation) | rows stay + 2px hairline |
| Empty (unfiltered) | practically unreachable (the admin themself exists); still: EmptyState «Hali foydalanuvchi yo'q — Yangi foydalanuvchi» |
| Empty (filtered) | «Filtrga mos yozuv topilmadi» + «Filtrlarni tozalash» |
| Error | ErrorState in the table region; header + FilterBar survive |
| Mutation success | toast, verb-first: «Foydalanuvchi yaratildi» / «Yangilandi» / «‹login› bloklandi — sessiyalari bekor qilindi» / «‹login› faollashtirildi» |

### 2.8 Role variations

A only — nav item (TIZIM group), route guard, palette entry all derive from the one
`PERMISSIONS` map. B/G/K hitting the URL get the 403 Result **with «Bosh sahifaga
qaytish»** (the dead-end 403 dies app-wide).

### 2.9 Responsive

1200–1599: full table. 1024–1199: Email + Oxirgi kirish fold into row expand. <1024
(admin on a phone — read-and-approve posture): 2-line rows (Login+Ism+RolePill / Holat +
oxirgi kirish), drawer becomes full-height sheet; creating users on a phone works but is
not optimized (polite «kompyuterda qulayroq» note in the drawer, non-blocking).

### 2.10 Removed vs today

- Icon-only pencil/stop buttons → labeled kebab items (icon-only controls are extinct).
- Create/edit **Modal** → 480px right drawer (interaction grammar: simple record = drawer).
- Hidden reactivation (edit modal → Faol switch → save) → symmetric one-click
  «Faollashtirish» row action.
- Local `ROLE` color-tag map (magenta/blue/green/gold decorative colors) → shared `ROLES`
  `RolePill`; decorative tag colors die (color budget is spent on meaning).
- Card-title page frame → PageHeader; `listQ.isFetching` table spinner → skeleton/hairline law.
- Added: search, role/status URL filters, Email column, blocked-last ordering,
  last-admin guard surfaced in-form instead of as a surprise 400.

---

## 3. `/settings` — Tizim sozlamalari

### 3.1 Purpose

The four business parameters that gate daily operations (credit ceiling, truck capacity,
margin floor, lost-pallet price) — editable by A with **per-field saves** (the sequential
multi-PUT partial-write confusion dies), readable by B at last, and each value
cross-referenced to where the system actually uses it.

### 3.2 Layout

One page, max 720px content column. No card-in-card, no Dividers — sections separated by
whitespace + overline labels (`02` §4). Each setting is a **field row**: label + control +
per-field save affordance + inline status, followed by its «qayerda ishlatiladi» line.

```
┌ PageHeader ────────────────────────────────────────────────┐
│ Tizim / Tizim sozlamalari                                  │
│ Tizim sozlamalari (20px)                                   │
├────────────────────────────────────────────────────────────┤
│ KREDIT NAZORATI                                (overline)  │
│                                                            │
│ Agent qarz chegarasi (standart)                            │
│ ( ) Cheklanmagan   (•) Chegara:  [ 50 000 000 ] so'm       │
│                                  [Saqlash]  ✓ Saqlandi 14:32│
│ 0 — yangi qarzga buyurtmalar to'liq bloklanadi.            │
│ Ishlatiladi: buyurtma yaratishda kredit tekshiruvi;        │
│ har bir agentning o'z chegarasi bu qiymatdan ustun →       │
│ Agentlar                                                   │
│                                                            │
│ LOGISTIKA                                                  │
│                                                            │
│ Fura sig'imi (paddon)                                      │
│ [ 19 ]                            [Saqlash]                │
│ 1–40. Ishlatiladi: moshina/marshrutda o'z sig'imi          │
│ bo'lmaganda → Moshinalar · Ta'minot matritsasi             │
│                                                            │
│ NARXLAR                                                    │
│                                                            │
│ Minimal sotish ustamasi (%)   ⟨hozircha tizimda            │
│ [ 5,00 ]                      qo'llanilmaydi⟩ (amber chip) │
│                                   [Saqlash]                │
│ Saqlanadi va auditga yoziladi, lekin buyurtma narxlashda   │
│ hali tekshirilmaydi — backend uni iste'mol qilganda chip   │
│ olib tashlanadi.                                           │
│                                                            │
│ Yo'qolgan paddon narxi (so'm)                              │
│ [ 130 000 ] so'm                  [Saqlash]                │
│ Ishlatiladi: faqat mijozdan yo'qolgan paddonni undirish    │
│ (bo'sh bo'lsa 130 000). Buyurtmada va zavodga qaytarishda  │
│ paddon pulsiz — bu narx ularga tegishli emas.              │
│                                                            │
│ Har bir o'zgarish audit jurnaliga yoziladi (oldingi va     │
│ yangi qiymat bilan).                       (small, tertiary)│
└────────────────────────────────────────────────────────────┘
```

### 3.3 Component instances & data

| Instance | Source | Data / config |
|---|---|---|
| `PageHeader` | `04` §1.2 | title «Tizim sozlamalari»; B variant adds header meta chip «Faqat o'qish» (neutral) |
| Setting field rows | page-local composition of existing atoms (sanctioned by `03` §4: «per-field save affordance») — **not** a new library component | `GET /settings` for values; each save = `PUT /settings/:key {value}` — one key, one request, one inline result; no batch, no cross-field coupling |
| `MoneyInput` | `04` §2.10 | agentDebtLimitDefault, palletPriceDefault: space-grouped, «so'm» suffix, `inputmode="numeric"` |
| InputNumber (AntD) | tokens | truckCapacityPallets (integer 1–40), saleMarginMinPct (0–100, step 0,01, 2dp) |
| Segmented (AntD) | tokens | Cheklanmagan / Chegara for the null-vs-number limit semantics (clearer than a Switch: null is a value, not an on/off) |
| No-op chip | `StatusChip` filled amber (`moneyWeOwe` ink — provisional-state channel) | on saleMarginMinPct: «hozircha tizimda qo'llanilmaydi» — required by `03` §4; removed only when the backend consumes the key |
| Cross-reference links | `colorLink` | «Agentlar» → `/agents`; «Moshinalar» → `/vehicles`; «Ta'minot matritsasi» → `/procurement`; «Paddonlar» → `/pallets` |

**Per-field save mechanics:** the save button materializes only when the field is dirty
(value ≠ server value); `Enter` inside the field also saves it. During flight the button
keeps its verb («Saqlanmoqda…»). Success: button dissolves, inline «✓ Saqlandi 14:32»
(success ink + word) fades to the timestamp; the react-query `['settings']` cache patches
that key. Failure: «✗» + the server validation message **verbatim** under the field
(server messages carry the bound: e.g. rejected range); value stays editable. One field's
failure never touches another field — the partial-write ambiguity is structurally gone.

**Value semantics surfaced in place (locked rules):**

- `agentDebtLimitDefault` — Segmented «Cheklanmagan» ⇒ `PUT {value: null}`; «Chegara» ⇒
  MoneyInput ≥ 0. Persistent helper: «0 — yangi qarzga buyurtmalar to'liq bloklanadi.
  Har bir agent uchun alohida chegara bu qiymatdan ustun.» When the current value is 0,
  an inline danger note (word + ink): «Hozir barcha yangi qarzga buyurtmalar bloklangan».
- `truckCapacityPallets` — integer clamp 1–40 in-control; helper names the default (19)
  and the fallback chain (vehicle → route → this setting).
- `saleMarginMinPct` — editable and saved (the API validates and audits it) but honestly
  chip-flagged as unconsumed; helper explains exactly that. We neither hide the field nor
  pretend it enforces anything.
- `palletPriceDefault` — labelled «Yo'qolgan paddon narxi (so'm)»; ≥ 0 (the server rejects
  negatives; `0` means «belgilanmagan» and the owner-locked 130 000 applies, as does an
  unset key). It is the default price used when a **client** is billed for a **lost**
  pallet (`PalletService.chargeLost`) and nothing else: orders always book pallets at 0 and
  a factory return moves no money at all. Helper names the 130 000 so'm code fallback and
  that scope; cross-link goes to the «Yo'qotilganini undirish» modal (`03` §4 `/pallets`).

### 3.4 Actions

Per-field Saqlash only. No page-level submit, no reset button (a field's escape is typing
the old value back; the server value is always visible as the anchor when dirty:
small «joriy: 19» caption appears under a dirty field).

### 3.5 Filters & URL params

None — four fields, no register. (Deep link `/settings` only.)

### 3.6 Keyboard

`Tab` field walk in document order; `Enter` saves the focused dirty field; `Esc` reverts
the focused field to the server value (with the dirty state, this is the undo). No global
chords beyond the shell's.

### 3.7 States

| State | Treatment |
|---|---|
| Loading | skeleton of the real layout: 3 section labels + 4 field-row skeletons (no full-page Spin — layout never jumps) |
| Error (GET) | ErrorState in the content region, «Qayta urinish» |
| Save error | inline per field, server text verbatim; toast never |
| Dirty navigation | route-leave guard when any field is dirty: «Kiritilgan ma'lumotlar saqlanmagan» |
| Realtime | settings have no socket entity; `refetchOnWindowFocus` default applies |

### 3.8 Role variations

- **A:** full write, as specified.
- **B:** the page renders (nav keeps «Tizim sozlamalari» for B — `03` §3), every control
  `disabled`, save affordances absent, one header chip «Faqat o'qish» + per-page explainer
  line: «Sozlamalarni faqat administrator o'zgartiradi». Values and «qayerda ishlatiladi»
  links fully visible — the parameters that constrain B's daily work stop being invisible.
  This mirrors the server exactly (`GET` allows B; `PUT` is A-only).
- **G/K:** 403 with «Bosh sahifaga qaytish»; no nav item.

### 3.9 Responsive

Single column by construction; <768px the 720px column becomes full-width, 16px padding;
controls stay ≥44px touch. Nothing folds.

### 3.10 Removed vs today

- Single batch «Saqlash» + sequential loop of PUTs → per-field saves (kills the
  partial-write state the old code apologized for in a comment).
- `key={JSON.stringify(data)}` form-remount hack → per-field controlled values patched
  from the cache.
- Info Alert banner → quiet audit footnote (banners are for states, not furniture).
- «Cheklanmagan» Switch + conditional field → Segmented with both semantics visible.
- saleMarginMinPct helper text that *promised* enforcement («…xatolardan himoya qiladi»)
  → honest unconsumed-flag chip. The old copy silently lied; honesty over polish.
- Dividers → overline-labeled whitespace sections.

---

## 4. `/profile` — Profil

### 4.1 Purpose

Self-service identity: every role edits their own name/login/**email**/phone and password.
The API (`PUT /auth/me`) always supported email — the field finally exists. The duplicate
read-only Descriptions block dies; there is exactly one representation of each fact.

### 4.2 Layout

Max 880px. Two cards side-by-side ≥1024px, stacked below. Identity header strip above
them (who am I — not editable facts).

```
┌ PageHeader ────────────────────────────────────────────────┐
│ Profil (20px)                                              │
├────────────────────────────────────────────────────────────┤
│ (B) Botir Qodirov  · Administrator (RolePill)              │
│     AGENT varianti: · Agent (RolePill) · [Mening           │
│     ko'rsatkichlarim →]                                    │
├───────────────────────────┬────────────────────────────────┤
│ Shaxsiy ma'lumotlar (h2)  │ Parolni o'zgartirish (h2)      │
│                           │                                │
│ Ism      [Botir Qodirov ] │ Yangi parol      [••••••••]    │
│ Login    [botir1        ] │ Parolni tasdiqlang [••••••••]  │
│ Email    [b@mail.uz     ] │                                │
│ Telefon  [+998 …        ] │ Parol o'zgartirilganda boshqa  │
│                           │ qurilmalardagi barcha seanslar │
│          [Saqlash]        │ yakunlanadi — bu seans ochiq   │
│                           │ qoladi.        (secondary)     │
│                           │       [Parolni yangilash]      │
└───────────────────────────┴────────────────────────────────┘
```

### 4.3 Component instances & data

| Instance | Source | Data |
|---|---|---|
| `PageHeader` | `04` §1.2 | title «Profil» |
| Identity strip | initial avatar (32px) + name `body-strong` + `RolePill` from `ROLES` | `GET /auth/me` `{name, role}` — the localized role label; the raw enum never renders. **No lastLoginAt here — `/auth/me` does not return it** (we do not fetch `/users/:id` for self; that endpoint is A-only) |
| Agent link (G only) | link chip | when `agentId != null` and role = AGENT: «Mening ko'rsatkichlarim →» to `/me` (the `GET /agents/me` card lives there, not here) |
| Identity form card | AntD Form, tokens | initial values from `GET /auth/me`; submit `PUT /auth/me {name, username, email, phone}` (trimmed; empty email sends `""` → server nulls it) |
| Password form card | AntD Form | `PUT /auth/me {password}`; response carries a fresh `accessToken` — the client **must** adopt it into `sb_token` before any other request (tokenVersion bumped server-side), then confirm |
| Post-change confirm | modal.info equivalent (e3) | «Parol o'zgartirildi — boshqa qurilmalardagi barcha seanslar yakunlandi. Ushbu seans ochiq qoladi.» |

Field rules mirrored from the server: Ism required; Login required, pattern
`[a-zA-Z0-9]{3,32}` validated client-side with the same helper copy as `/users` (the
backend's raw unique-constraint 500 on a taken username is a known API gap — the UI
pre-validates format and renders whatever the server returns verbatim under the field;
we do not paraphrase it into a fake friendly message); Email optional, format-checked,
409/500 rendered verbatim; Parol min 8 both fields + match validator («Parollar mos
kelmadi») — the UI holds the 8-char line even though `UpdateProfileDto` would accept 4
(documented server drift; the stricter bound is ours to keep).

Role and agent binding are **visibly absent from the forms** — `PUT /auth/me` cannot
change them (no privilege-escalation path, locked rule). The RolePill in the identity
strip is the only place role appears.

### 4.4 Actions

| Action | Where | Result |
|---|---|---|
| Saqlash (identity) | left card / `Ctrl+Enter` in its fields | PUT → `refresh()` of the auth context (TopBar avatar name updates); toast «Profil saqlandi» |
| Parolni yangilash | right card / `Ctrl+Enter` | PUT → adopt fresh token → reset fields → info modal |
| Mening ko'rsatkichlarim | identity strip (G) | navigate `/me` |

### 4.5 URL params

None.

### 4.6 Keyboard

`Tab` walk; `Ctrl+Enter` submits the form owning focus; `Esc` — nothing to close (full
page). Dirty-leave guard on the identity form.

### 4.7 States

| State | Treatment |
|---|---|
| Loading | auth context is already hydrated on any authed page — render immediately from context; a background `GET /auth/me` refresh patches silently |
| Identity save error | inline per field where mappable (username/email conflicts), else verbatim above the button |
| Password save error | verbatim above the button |
| Success | toasts as in §4.4; password path uses the modal (a session-scope consequence deserves more than a toast) |

### 4.8 Role variations

Identical form for A/B/G/K (the API is identical). G gets the `/me` link chip. K/G on
phones get the responsive layout below. Entry for everyone: avatar dropdown → «Profil».

### 4.9 Responsive

<1024px: cards stack (identity first). <768px: full-width, 16px padding, inputs ≥44px;
`autocomplete` attributes kept (`name`, `username`, `email`, `tel`, `new-password`).
This page is part of the AGENT phone surface — no hover-dependent anything.

### 4.10 Removed vs today

- The read-only `Descriptions` block duplicating Ism/Login/Telefon above the same fields
  as inputs → one editable representation (the duplication confused which value was
  current).
- `ROLE_LABEL` local map with **'Hisobchi'** → shared `ROLES` («Buxgalter») — the banned
  synonym dies (`03` §12).
- Blue decorative role Tag → `RolePill`.
- Added: Email field (API supported, UI never exposed), agent `/me` link, dirty guard,
  Ctrl+Enter.

---

## 5. `/import` — Excel import (A only)

### 5.1 Purpose

The one-time pre-go-live migration console for «Газоблок Счёт.xlsx»: iterate dry-runs
until the workbook passes its 7 self-checks, commit one real import, then **triage the
reconciliation verdict** — the backend already classifies every mismatch as
workbook-defect-explained vs unexplained-import-error, and per-client `sheetGaps` name the
exact missing/extra rows; the current UI renders none of it. This screen's centerpiece is
that verdict. Full workflow law: `05` §C2.

**Role fix (structural):** every `/import` endpoint is `@Roles('ADMIN')`. Nav item, route
guard, and palette entry are A-only via the shared `PERMISSIONS` map — the
ACCOUNTANT-sees-a-dead-page drift class is impossible by construction (`03` §1.3, §3).

### 5.2 Layout

A 4-step wizard, one step visible at a time, with the batch/draft history rail always
present below the step body. Steps: **1 Yuklash → 2 Tekshiruv → 3 Import → 4 Solishtirish**.

```
┌ PageHeader ───────────────────────────────────────────────────────┐
│ Tizim / Excel import                                              │
│ Excel import (20px)                                               │
│ ①Yuklash ─── ②Tekshiruv ─── ③Import ─── ④Solishtirish   (Steps)   │
├ Step body ────────────────────────────────────────────────────────┤
│  (step content — below)                                           │
├ Tarix ────────────────────────────────────────────────────────────┤
│ IMPORT TARIXI                                        (overline)   │
│ Fayl            Sana             Kim     Yozuvlar          ⋮      │
│ Газоблок….xlsx  10.07.26 21:14   Botir   56 buyurtma ·           │
│                                          312 to'lov · …    ⋮      │
│ Газоблок….xlsx  10.07.26 20:02   Botir   ⟨qoralama⟩ 7/7 ✓  ⋮      │  ← dry-run draft (localStorage)
└───────────────────────────────────────────────────────────────────┘
```

Step reachability: ② requires a run result (fresh or a stored draft); ③ requires a
**clean** dry-run (7/7 ✓) **of the same file** (matched by filename + size + lastModified
captured at upload); ④ requires a real batch (`?batch=`). Unreachable steps render
disabled with their reason as a tooltip-equivalent inline caption (never silently dead).

#### Step 1 — Yuklash

```
┌ Guards summary ───────────────────────────────────────────┐
│ ● Baza bo'sh bo'lishi shart — qo'lda yaratilgan buyurtma  │
│   bo'lsa server rad etadi                                 │
│ ● Oldingi partiya:  yo'q ✓   (yoki: «1 ta partiya mavjud  │
│   — yangi import uchun avval orqaga qaytariladi» + link)  │
│ ● Talab: «CAOLS KS» zavodi va 7 nomlangan kassa seed      │
│   qilingan bo'lishi kerak                                 │
├ Dragger ──────────────────────────────────────────────────┤
│      ⭳  .xlsx faylni shu yerga tashlang yoki tanlang      │
│      «Газоблок Счёт» daftari — barcha varaqlar bilan,     │
│      20 MB gacha                                          │
├───────────────────────────────────────────────────────────┤
│              [ Tekshirish (dry run) ]                     │
└───────────────────────────────────────────────────────────┘
```

- Guards summary is informational text derived from data we already have: prior-batch
  state from `GET /import/batches` (count > 0 ⇒ the amber line + link to that batch row's
  rollback); the empty-base and seed rules are stated as prose because only the server
  can verify them — their failures arrive as 400s and render verbatim in place.
- Dragger accepts `.xlsx`, single file, 20MB client cap (server re-checks PK magic).
- «Tekshirish (dry run)» → `POST /import/excel?dryRun=true` → advance to ② with the
  result. There is **no** import button on this step — the red button lives on ③ behind
  the clean-dry-run gate.

#### Step 2 — Tekshiruv (dry-run natijasi)

```
┌ Verdict banner ───────────────────────────────────────────────────┐
│ ✓ 7/7 tekshiruv o'tdi — import qilishga tayyor    [③ ga o'tish →] │
│ (yoki) ✗ 2 ta tekshiruv o'tmadi — fayl tuzatilishi kerak          │
├ Tekshiruvlar (DataTable, 7 rows) ─────────────────────────────────┤
│ Tekshiruv                        Kutilgan (so'm)   Haqiqiy (so'm)      Δ      │
│ «Товар: Σ блок таннархи (m³×нарх)»  992 269 250     992 269 250        0  ✓   │
│ «Оплата: Σ қатор суммалари»       1 024 066 320   1 023 966 320  −100 000 ✗   │
├ Yozuvlar soni ────────────────────────────────────────────────────┤
│ Buyurtmalar 56 · Ledger 1 204 · Paddon 312 · Kassa 640 ·          │
│ Taqsimotlar 118 · Yangi: mijoz 24 · moshina 9 · mahsulot 6 ·      │
│ yur. shaxs 3 · taxallus 4                                         │
│ TO'LOVLAR: 312 — Mijozdan 268 · Zavodga 22 · Shofyorga 14 ·       │
│ Mijoz→shofyor 8                             (per-kind chips)      │
├ Tekshirilmagan to'lovlar ─────────────────────────────────────────┤
│ ⚠ «Оплата» daftarida yo'q to'lovlar: 95 800 000 so'm — import     │
│ ularni «Tekshirilmagan» belgisi bilan kiritadi (keyin             │
│ To'lovlar → Tekshirilmagan navbatida ko'riladi)                   │
│ Sana        Mijoz            Payer (varaqdan)         Summa (so'm)│
│ 06.06.2025  Гофур Хазорасп   «шопр учун барди»         500 000    │
├ Mos kelmagan yozuvlar (2 ta jadval) ──────────────────────────────┤
│ «клентдан» yuklar (Оплатада to'lov topilmadi):                    │
│   Qator  Mijoz   Sana        Raqam (moshina)                      │
│ Shofyor to'lovlari (mos yuk yo'q):                                │
│   Mijoz  Summa (so'm)  Sana   Kiritildimi   Sabab                 │
├ Kassa qoldiqlari (import bo'yicha) ───────────────────────────────┤
│ Kassa           Valyuta   Kirim      Chiqim     Qoldiq (so'm)     │
│ Naqd kassa      UZS       …          …          −12 400 000  ⚠    │
│ ⚠ Daftar kassalarning boshlang'ich qoldiqlarini o'z ichiga        │
│ olmaydi — manfiy qoldiq xato emas; boshlang'ich qoldiqlar egasi   │
│ tomonidan alohida kiritiladi (hozircha tizimda bunday oyna yo'q). │
└───────────────────────────────────────────────────────────────────┘
```

Data mapping (all from the `POST …?dryRun=true` response — **typed contract, the
defensive normalizers die**):

| Region | Fields |
|---|---|
| Tekshiruvlar table | `stats.checks[] {name, expected, actual, ok}` — check names are workbook artifacts, rendered as `ArtifactText` («Товар: Σ блок таннархи…»); Kutilgan/Haqiqiy right-aligned `MoneyCell` neutral; **Δ = actual − expected computed client-side**, `MoneyCell` signed, danger ink when `!ok`, `0` + ✓ otherwise. This table is the operator's debugging surface — the by-how-much finally visible |
| Yozuvlar soni | `stats.counts` — named chips in a wrap row; `counts.paymentsByKind` renders as **per-kind chips with intent labels** (CLIENT_IN → «Mijozdan», FACTORY_OUT → «Zavodga», VEHICLE_OUT → «Shofyorga», TRANSPORT_DIRECT → «Mijoz→shofyor», from the shared kind map) — the `[object Object]` rendering dies |
| Tekshirilmagan preview | **`stats.unreconciled.total`** (the drift fix — the ~95,8M warning finally appears at the decision point) + `stats.unreconciled.payments[] {client, amount, date, payer}` as a 4-column table (payer as `ArtifactText`), paginated 10/page |
| «клентдан» unmatched | `stats.unmatchedClientDriverTrucks[] {excelRow → Qator, client, date, plate}` — structured columns, JSON blobs die |
| Shofyor unmatched | `stats.unmatchedDriverPayments[] {client, amount, date, imported → StatusChip «Kiritildi»/«Kiritilmadi», reason → ArtifactText}` |
| Kassa qoldiqlari | `stats.cashboxBalances[] {name, currency, in, out, balance}` — balance `MoneyCell`, negative in danger ink + ⚠ word chip «manfiy» (cashbox shortfall channel, `02` §2.4); UZS/USD never merged into one total |

**Draft persistence:** every dry-run result is written to
`localStorage sb_import_drafts:<userId>` (stats + filename + file fingerprint + timestamp,
last 5 kept) and listed in the history rail with a grey «qoralama» chip — a refresh or
navigation never costs the 2-minute rerun. Opening a draft re-renders ② from storage with
a header note «Saqlangan natija — HH:mm holatiga».

If the dry-run itself 400s (failed checks abort server-side with `failedChecks`), the
error region renders the server message verbatim **plus** the failed-check table from the
400 payload when present.

#### Step 3 — Import (haqiqiy)

Reachable only with a clean 7/7 dry-run of the same file fingerprint; otherwise the step
body says exactly what is missing («Avval shu faylning toza dry-run natijasi kerak») with
a link back to ①.

The commit surface is a confirm modal that **embeds the numbers being committed** — the
admin confirms figures, not prose:

```
┌ Modal: Haqiqiy import — «Газоблок Счёт.xlsx» ─────────────┐
│ Tekshiruvlar: 7/7 ✓ (dry-run 21:02)                       │
│ Yoziladi: 56 buyurtma · 312 to'lov · 1 204 ledger ·       │
│ 312 paddon · 640 kassa · 118 taqsimot                     │
│ Tekshirilmagan to'lovlar: 95 800 000 so'm (belgi bilan)   │
│                                                           │
│ Import faqat bo'sh bazaga kiritiladi; server buni o'zi    │
│ tekshiradi. Bitta tranzaksiya — qisman import bo'lmaydi.  │
│                                                           │
│              [Bekor qilish]   [Import qilish] (danger)    │
└───────────────────────────────────────────────────────────┘
```

Confirm → `POST /import/excel` (no dryRun). During the run (up to 120s, one
transaction): a blocking overlay with an **indeterminate** progress bar, elapsed timer,
and the stage chain rendered as a static diagram — `o'qish → tekshirish → buyurtmalar →
to'lovlar → solishtirish` — labeled «bosqichlar ma'lumot uchun; server bitta
tranzaksiyada bajaradi». No fake per-stage checkmarks: the API does not stream progress,
and we do not pretend it does.

On success: invalidate **all** react-query caches (the import repopulates the entire
base), toast «Import kiritildi — ‹batchId›», and **auto-navigate to
`/import?step=solishtirish&batch=<id>`** (the below-the-fold reconciliation pain dies).
On failure: the 400/409 renders verbatim in the step body (Cyrillic backend messages are
server text — platform law says verbatim, never paraphrased).

#### Step 4 — Solishtirish (reconciliation)

The centerpiece. Opens automatically after a real import, or from any batch row's
«Solishtirish» action. Data: `GET /import/batches/:id/reconciliation`.

```
┌ Headline chips (from summary) ────────────────────────────────────┐
│ [✓ Mos 41]  [Farqli 6]  [✗ Izohsiz 1 — import xatosi]             │
│ [Paddon farqi 3]  [Tekshirilmagan 24 ta · 95 800 000 so'm →]      │
├ Zavod balansi ────────────────────────────────────────────────────┤
│ Kutilgan (Excel) 973 619 270 · Haqiqiy (baza) 973 619 270 ·       │
│ Farq 0 ✓                                                          │
├ Mijozlar (DataTable, expandable rows, worst-first) ───────────────┤
│ Mijoz            Kutilgan(so'm) Haqiqiy(so'm)   Farq     Holat    Paddon │
│ Уткир мини       12 400 000     30 800 000   +18 400 000 ⟨daftar  18/36  │
│  ▸                                                        nuqsoni │
│                                                           bilan   │
│                                                           izohlangan⟩ (violet) │
│ Жасур Версал      8 200 000      8 950 000     +750 000  ✗ Izohsiz —      │
│  ▸                                                        import xatosi (red) │
│ Гофур Хазорасп   22 100 000     22 100 000            0  ✓ Mos    12/12 ✓ │
│ NORMAT UMIDBEK «Varaqsiz»  …                              ✓ Mos           │
│                                                                   │
│  ▾ (expanded row — sheetGaps detail)                              │
│  «Товар»da bor, varaqda yo'q yuklar (2):                          │
│    Qator 12 · 04.05.2025 · «01 A 774» · +9 200 000 · 19 paddon    │
│    Qator 31 · 18.05.2025 · «95 774 AAA» · +9 200 000 · 19 paddon  │
│  Varaqda ortiqcha yozuvlar (0)                                    │
│  «Оплата»da bor, varaqda yo'q to'lovlar (1):                      │
│    02.06.2025 · −1 000 000                                        │
│  Tuzatilgan kutilma: 30 800 000 so'm → haqiqiy bilan mos ✓        │
│  (paddon: tuzatilgan 36 dona → mos ✓)                             │
├ Tekshirilishi kerak bo'lgan to'lovlar (24 ta · Σ 95 800 000) ─────┤
│ Sana   Mijoz→   Payer            Usul      Summa (so'm)  Izoh    │
│ 06.06  Гофур →  «шопр учун барди» O'tkazma     500 000   «…»     │
│         [To'lovlar → Tekshirilmagan navbatiga o'tish →]           │
└───────────────────────────────────────────────────────────────────┘
```

| Region | Data & rules |
|---|---|
| Headline chips | `summary`: «Mos N» = `clientsOk` (success); «Farqli N» = `mismatched.length` (neutral-warning); «Izohsiz N — import xatosi» = `unexplained.length` — **danger, filled**, the one number that means the import itself is wrong (0 renders as a green «Izohsiz: 0 ✓»); «Paddon farqi N» = `palletsMismatched.length`; «Tekshirilmagan N ta · Σ» = `flaggedCount`/`flaggedTotal`, links to the flagged table anchor. Chips are filters on the client table (click «Farqli» → only mismatched rows; URL `chip=`) |
| Zavod balansi | `factory {expected, actual, diff, ok}` — one inline row, `MoneyCell`s, Δ danger when `!ok`; expected is the locked 973 619 270 figure |
| Mijozlar table | `clients[]`, default sort worst-first: unexplained → explained → pallet-only → ok, then `|diff|` desc. Columns: Mijoz (client name; `sheetless` → grey chip «Varaqsiz» with tooltip-free inline meaning: expected = faqat «Товар» yig'indisi) · Kutilgan (Excel) · Haqiqiy (baza) — both `MoneyCell` neutral · Farq — `MoneyCell` signed, danger ink when `!ok` (`|diff| ≥ 1` so'm; sub-1 residue renders 0 ✓ per the epsilon rule) · **Holat verdict chip** · Paddon «kutilgan/haqiqiy» + ✓/farq |
| Holat verdict chip | the backend's classification finally rendered: `ok` → dot «Mos» (success); `!ok && explainedByWorkbookDefect` → **violet filled chip «daftar nuqsoni bilan izohlangan»** — the reserved violet channel per `02` §2.4, which explicitly assigns workbook-defect-explained badges to it (this supersedes the «amber» wording in `05` §C2 — `02` is the color law); `!ok && !explained` → **danger filled chip «izohsiz — import xatosi»**. Pallet mismatches get the same pair via `palletsExplainedByWorkbookDefect` on the Paddon cell |
| Expanded row | renders only when `sheetGaps` exists: three mini-lists — `missingFromSheet` («Товар»da bor, varaqda yo'q: Qator `excelRow` · sana · plate as `ArtifactText` · `+amount` · paddon), `extraOnSheet` (mirror, `−amount`), `oplataNotOnSheet` (sana · `−amount`); then the reconciliation math line: «Tuzatilgan kutilma: `adjustedExpectedBalance` so'm → haqiqiy bilan mos ✓/✗» and the pallet twin with `adjustedExpectedPallets`. Rows with no gaps don't expand (no chevron) |
| Flagged payments | `flaggedPayments[] {date, client, payerName → ArtifactText, method → shared method label, amount, note → ArtifactText}` + **id retained for the row link** — each row deep-links to `/payments/:id` (the payment peek). Footer action: «To'lovlar → Tekshirilmagan navbatiga o'tish →» = `/payments?reconciled=false`. **No per-row «tasdiqlash» button** — no mark-reconciled endpoint exists (`04` §6); the checklist drains via the C1 review queue, stated in one honest caption line |

#### History rail (all steps)

`GET /import/batches` table: Fayl · Sana (`DD.MM.YYYY HH:mm`) · Kim (`createdBy.name`) ·
Yozuvlar (chips from `_count`: «56 buyurtma · 312 to'lov · 1 204 ledger · 312 paddon ·
640 kassa», expenses when nonzero) · kebab: «Solishtirish» (→ step ④ with
`?batch=`) · «Orqaga qaytarish» (danger). Dry-run drafts from localStorage interleave
(newest first) with the «qoralama» chip and their 7/7 badge; draft kebab: «Natijani
ochish» (→ step ② from storage) · «O'chirish» (removes the draft — local data only, no
confirm needed beyond the item being labeled).

### 5.3 Rollback

One `ReasonModal` (import-rollback variant, `04` §2.6) — the old two-modal chain dies:

```
┌ ReasonModal: Importni orqaga qaytarish ───────────────────┐
│ «Газоблок Счёт.xlsx» (10.07.2026 21:14) partiyasi bazadan │
│ butunlay o'chiriladi. Bu amalni qaytarib bo'lmaydi.       │
│ LedgerImpactPreview (exact deletion counts from _count):  │
│  · 56 buyurtma o'chiriladi                                │
│  · 312 to'lov (taqsimotlari bilan) o'chiriladi            │
│  · 1 204 ledger yozuvi o'chiriladi                        │
│  · 312 paddon harakati o'chiriladi                        │
│  · 640 kassa yozuvi o'chiriladi                           │
│  · 0 xarajat                                              │
│ Tasdiqlash uchun ROLLBACK so'zini yozing:                 │
│ [___________]                                             │
│          [Bekor qilish]  [Orqaga qaytarish] (danger,      │
│                           enabled only on exact match,    │
│                           never default-focused)          │
└───────────────────────────────────────────────────────────┘
```

→ `DELETE /import/batches/:id {confirm:true}`. Success: toast «Import orqaga
qaytarildi», full cache invalidation, history refetch, and if the rolled-back batch was
open in ④, the wizard returns to ①. The typed-word input replaces the reason TextArea in
this variant (the API takes no reason; the friction is the confirmation itself).

### 5.4 Filters & URL params

| Param | Values | Meaning |
|---|---|---|
| `step` | `yuklash / tekshiruv / import / solishtirish` | wizard position (default `yuklash`; unreachable steps redirect to the last reachable one) |
| `batch` | batch id | which batch ④ shows; also set by «Solishtirish» row actions |
| `chip` | `farqli / izohsiz / paddon / mos` | client-table verdict filter on ④ |
| `page` | number | ④ client table page (client-side, 20/page — the payload is the complete set) |

Deep link `/import?step=solishtirish&batch=X&chip=izohsiz` reproduces the triage view
exactly (shareable with the owner).

### 5.5 Keyboard

Wizard is mouse-first by nature (one-time operator tool); still: `Esc` closes modals
(dirty-guarded), `Enter` confirms enabled modal primary, `/` is unused (no FilterBar
search here), step headers are focusable and `Enter`-activatable when reachable. The
ROLLBACK input is `autoFocus` inside its modal.

### 5.6 States

| State | Treatment |
|---|---|
| History loading | skeleton rows under the overline; step ① renders immediately |
| Dry-run / import in flight | ① and ③ buttons self-disable keeping verbs («Tekshirilmoqda…» / «Kiritilmoqda…»); ③ shows the overlay (§5.2); the Dragger disables |
| Upload guard fail | inline under the Dragger: «Faqat .xlsx, 20 MB gacha» |
| Server 400 (checks failed / base not empty / seeds missing / batch exists) | verbatim in the step body via `ErrorState` styling — Cyrillic server text untouched |
| ④ loading | skeleton of the real layout: chip row + 6 table rows |
| ④ error | `ErrorState` in the reconciliation region; history rail survives |
| Empty history | «Hozircha import yo'q — faylni ① bosqichda yuklang» |
| Realtime | import entities broadcast no dedicated socket family; after import/rollback the page relies on its own full invalidation |

### 5.7 Role variations

**A only, end to end** — nav (TIZIM group), route, palette. B/G/K: no nav item; direct
URL → 403 + «Bosh sahifaga qaytish». There is no read-only variant: every endpoint the
page touches is ADMIN-gated, and per the honesty rule the UI never renders a surface
whose every query would 403.

### 5.8 Responsive

Desktop-first (an admin migration console). 1024–1199: tables scroll horizontally inside
their own containers; the wizard column is single anyway. <768px: read-only review is
possible (steps ② and ④ render; card-style tables), but ① dragger and ③ commit show the
polite «kompyuterda qulayroq» note — non-blocking, per shell law.

### 5.9 Removed vs today, and why

- **ACCOUNTANT visibility** (nav + route + enabled dry-run button that 403s) → gone; the
  page derives from `PERMISSIONS` = the `@Roles` truth.
- One endless vertical page (upload → results → history → below-the-fold reconciliation)
  → 4-step wizard with auto-advance to ④ after a real import.
- `stats.unreconciledTotal` read (never present) → **`stats.unreconciled.total`** + the
  payments preview table; the 95,8M warning finally exists at the decision point.
- `[object Object]` for `counts.paymentsByKind` (counts grid + history tags) → per-kind
  intent-labeled chips.
- Check list of name + icon only (reading nonexistent `.detail`) → 4-column table
  Tekshiruv · Kutilgan · Haqiqiy · Δ from the real `{expected, actual}` fields.
- Raw `JSON.stringify` bullet lists for unmatched records → two structured tables with
  Qator/Mijoz/Sana/Raqam/Summa/Sabab columns.
- Reconciliation `summary` rendered only-if-string (it is an object — never rendered) →
  the headline chip row from `summary`'s real fields, with **unexplained** as the
  page-defining danger signal.
- Invisible `sheetGaps` / `explainedByWorkbookDefect` → expandable verdict rows (the
  entire point of step ④).
- Flagged table missing payer/method/id → all three rendered, each row linking to its
  payment peek; deep link to the C1 review queue added.
- Two-stage rollback (confirm → typed modal) → one ReasonModal with typed «ROLLBACK» +
  exact deletion counts.
- Generic real-import confirm prose → the dry-run numbers embedded; import gated on a
  clean same-file dry-run.
- Ephemeral dry-run state → localStorage drafts with history rows.
- All defensive shape-normalizers (`getChecks`/`getCounts`/`getUnmatched`/…) → one typed
  contract mirroring `import.service.ts` (the shapes above are verified against code).
- Mixed-script chaos → convention applied: UI chrome Uzbek Latin; workbook artifacts
  («Товар», «шопр учун барди», check names, payer strings) only ever inside
  `ArtifactText`; backend messages verbatim as server evidence.

---

## 6. Cross-screen notes for the implementer

- **Shared maps first:** `ROLES` (used by `/users`, `/profile`, TopBar avatar), the
  payment-kind label map (used by Import ② chips and ④ flagged table), and `PERMISSIONS`
  (nav/routes/palette for `/users`, `/settings` write-vs-read, `/import` A-only) must land
  before these screens — they are the anti-drift mechanism, not decoration.
- **No new endpoints anywhere above.** The only near-misses, deliberately not designed:
  mark-reconciled (flagged payments stay a read-and-go-review list), audit-log viewer
  (trail stays write-only), opening balances (named in the Import ② cashbox caption as
  «hozircha tizimda bunday oyna yo'q»), batch settings write (per-field PUTs instead).
- **Password/session law appears verbatim on all three surfaces that touch it** (users
  drawer, profile password card, block confirm): any password change, role change, or
  deactivation kills sessions instantly (tokenVersion). Self password change adopts the
  returned fresh token before the next request — implementers: this ordering is a
  correctness requirement, not a nicety.
- Money on these screens (settings limits/prices, import figures) renders through
  `MoneyCell`/`fmtMoney` — space-grouped, so'm in the column header once, true minus.
  Import Δ and Farq columns are the only signed money here; both carry ✓/✗ words beside
  ink (grayscale-safe).
