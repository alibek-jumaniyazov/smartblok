# SmartBlok — Canonical Design Language (v1, FINAL)

**Status:** binding specification. Merged by the design director from the four competition
visions after jury scoring. Base: **Ledger Clarity** (design language, money semantics,
component soul). Grafts: Role Cockpit (reserved violet channel, worklist engine, print
guards), Command Density (list mechanics, motion taste rules, no-uppercase typography),
Progressive Calm (platform feedback/accessibility law, edge-path resilience).
Companion docs: `03-shell-and-ia.md`, `04-components.md`, `05-hero-workflows.md`.

Stack context: React 18 + Ant Design v6 (ConfigProvider tokens + one custom CSS file
`design.css` ≤ 400 lines), @ant-design/plots, TanStack Query v5, react-router 6, socket.io.
No new backend endpoints are assumed anywhere in this document.

---

## 1. Governing principles

1. **The balance IS the interface.** Every party surface leads with the live ledger-derived
   balance rendered as a semantic sentence («Mijoz bizga qarz: 12 450 000 so'm»), never a raw
   signed number. Sign conventions live in components (`MoneyCell`, `BalanceTag`), never in
   the user's head.
2. **Chrome yields to numbers.** Page titles are 20px; the largest text on any screen is
   always a money figure. The sidebar is surface-colored, not a dark slab.
3. **Immutability is visible.** Voided/cancelled/reversed rows are first-class ghost rows
   with chained storno pairs. Every destructive action shows a `LedgerImpactPreview` naming
   exact consequences before the reason field.
4. **Every debt carries its own next action**, and every number drills down to the filtered
   list that produced it. A KPI you cannot act on from where you see it is a decoration.
5. **Numbers never animate. This is a ledger.** Motion exists for surfaces and orientation
   only.
6. **Honesty over polish.** Client-derived counts state their window; client-side sums are
   labeled «sahifa jami»; estimates are labeled «taxminiy»; nothing renders more settled than
   the ledger says it is.

---

## 2. Color system

All values exact, both themes first-class. Dark is designed as its own elevation system
(surface lightening), not a filter over light.

### 2.1 Brand & interaction

| Token | Light | Dark | Use |
|---|---|---|---|
| `colorPrimary` | `#26617F` | `#7FB0CC` | actions, links, focus, selected nav, active chips |
| `colorPrimaryBg` | `#E8F0F5` | `#1B2E3A` | selected rows, active filter chips, row pulse |
| `colorLink` | `#26617F` | `#7FB0CC` | every entity cross-link |
| Focus ring | `#26617F @ 35%`, 2px, offset 1px | `#7FB0CC @ 45%` | every focusable element |

### 2.2 Surfaces

| Token | Light | Dark |
|---|---|---|
| `colorBgLayout` (canvas) | `#F6F7F9` | `#0E1216` |
| `colorBgContainer` (cards, tables, header) | `#FFFFFF` | `#161C22` |
| Raised (drawers, popovers, peek panel, palette) | `#FFFFFF` + shadow e2 | `#1C242C` |
| SideNav | `#F1F3F6` | `#12171D` |
| Inset (table headers, statement opening/closing rows, input wells) | `#F3F5F7` | `#10151A` |
| `colorBorder` | `#E3E7EC` | `#2A333C` |
| `colorBorderSecondary` (hairlines) | `#EDF0F3` | `#222A32` |

### 2.3 Text

| Token | Light | Dark | Rule |
|---|---|---|---|
| `colorText` | `#1B2530` | `#E6EBF0` | default; ≈14.9:1 / ≈13.8:1 |
| `colorTextSecondary` | `#5B6774` | `#9AA7B4` | labels, meta; ≥4.5:1 both themes |
| `colorTextTertiary` | `#8A94A0` | `#6C7885` | **supplementary content only** (timestamps duplicated elsewhere, group labels, kbd hints). Essential information never renders below `colorTextSecondary`. |

### 2.4 Semantic money palette (fixed meanings — never decorative)

This is the app's most important convention. Color carries *meaning only*, and the meanings
are fixed app-wide:

| Meaning | Token | Light ink | Dark ink | Where |
|---|---|---|---|---|
| Receivable / they owe us / overdue risk | `moneyOwedToUs` (= `colorError`) | `#C2413B` | `#E8827C` | client Qarz on collections surfaces, overdue chips, negative profit, cashbox shortfall, void/cancel |
| Our liability / we owe them | `moneyWeOwe` (= `colorWarning`) | `#9A6700` | `#D9A94A` | Qarzimiz to factory/driver, mijoz avansi (their money with us), provisional/PARTIAL states, due-soon, Tekshirilmagan |
| Inflow / settled / in our favor | `moneyIn` (= `colorSuccess`) | `#1A7F37` | `#6CC495` | payments in, Avansimiz, FINAL cost, PAID, identity check = 0 |
| Outflow (neutral spend) | `colorText` | — | — | kassa OUT, expenses, factory payments: **not red — spending is not an error** |
| Ghost (voided/cancelled/reversed) | `colorTextTertiary` + strikethrough on the amount only | | | preserved history |
| **Reserved violet** | `--sb-violet` | `#6D5BD0` | `#9B8CF0` | **imported-UNKNOWN / owner-must-resolve states ONLY**: transport `Aniqlanmagan`, workbook-defect-explained badges. Nothing else in the product may ever borrow this channel. |

**Enforcement rules:**

- **Never color more than one column per table.** The colored column is the balance/amount
  that answers the page's question.
- Alarm-strength red ink on positive client balances appears **only on collections surfaces**
  (Debts board, overdue contexts) and party headers; elsewhere balances render as tinted
  `BalanceTag` chips (12% alpha fill + full-strength ink) — red everywhere would blind the
  alarm channel.
- Chip fills: 12% alpha of the ink over the surface; text at the full-strength ink; no solid
  AntD preset Tag colors. The only filled (solid) chips: violet «Aniqlanmagan» and danger
  «Bekor qilingan».
- `|balance| < 1 UZS` renders as `0 so'm` + grey «Hisob yopiq» chip (locked epsilon rule).
- Color is never the only carrier: every semantic color is paired with a word (Qarz / Avans /
  Qarzimiz / Avansimiz / Hisob yopiq; state chips carry labels; deltas carry arrows + words).

### 2.5 Status hues (chips only)

Rendered as `StatusChip`: dot-style in tables (dot + label, no fill), 12%-tint filled style in
headers. One shared label+color map (`lib/status-maps.ts`) feeds every screen and print doc.

| Status | Light ink | Dark ink | Label |
|---|---|---|---|
| NEW | `#64748B` | `#94A3B8` | Yangi |
| CONFIRMED | `#2563EB` | `#7EA8F2` | Tasdiqlangan |
| LOADING | `#9A6700` | `#D9A94A` | Yuklanmoqda |
| DELIVERING | `#C2410C` | `#E8926B` | Yetkazilmoqda |
| DELIVERED | `#0D9488` | `#4FB3A9` | Yetkazildi |
| COMPLETED | `#1A7F37` | `#6CC495` | Yakunlandi |
| CANCELLED | `#C2413B` | `#E8827C` | Bekor qilingan |
| Cost PROVISIONAL | `#64748B` | `#94A3B8` | Taxminiy |
| Cost PARTIAL | `#9A6700` | `#D9A94A` | Qisman |
| Cost FINAL | `#1A7F37` | `#6CC495` | Qotirilgan |
| Transport UNPAID | `#C2413B` | `#E8827C` | To'lanmagan |
| Transport PAID | `#1A7F37` | `#6CC495` | To'langan |
| Transport PAID_BY_CLIENT | `#0D9488` | `#4FB3A9` | Mijoz to'lagan |
| Transport UNKNOWN | `#6D5BD0` (violet, filled) | `#9B8CF0` | Aniqlanmagan |
| Transport NOT_APPLICABLE | em-dash, no chip | | — |
| Payment reconciled=false | `#9A6700` amber dot | `#D9A94A` | Tekshirilmagan |

UNKNOWN must never look like NOT_APPLICABLE: it is a task waiting for the owner, not an
absence. The violet chip also carries a `?` glyph (grayscale-readable).

### 2.6 Charts

Max 2 line series per chart. Sales `#1F6F9E` / dark `#5CA3CF`; collections `#B47A00` / dark
`#D9A94A` (existing CVD-safe pair, kept). Order-count bar layer `#94A3B8` at 60% alpha.
Series colors never reuse semantic red/green. Grid lines = `colorBorder`; axis labels
`colorTextTertiary` 11px; tooltips show exact `fmtMoney` values. Sparklines: 32px, axis-free,
single primary-colored line.

---

## 3. Typography

**Font:** self-hosted **Inter variable** (woff2, `font-display: swap`, no CDN — CSP-safe),
fallback `'Segoe UI Variable Text', 'Segoe UI', system-ui, -apple-system, sans-serif`.
All numerals in money/quantity/date cells get `font-feature-settings: 'tnum' 1, 'lnum' 1`
(the `.num` class, applied by default to all table cells, stat values, and money components).

| Style | Size/Line | Weight | Use |
|---|---|---|---|
| `money-hero` | 28/34 | 650 | party balance headers, dashboard hero figures |
| `money-lg` | 20/26 | 600 | stat cards, drawer totals, worklist sums |
| `h1` | 20/28 | 650 | page titles (PageHeader) |
| `h2` | 16/24 | 600 | card/section titles, statement month separators |
| `h3` | 14/20 | 600 | drawer titles, grouped table sections |
| `body` | 14/22 | 400 | default |
| `body-strong` | 14/22 | 600 | emphasized cells, totals rows |
| `table` | 13/20 | 400 (500 for money cells) | all data tables |
| `small` | 12/18 | 400 | secondary cell lines, helper text, timestamps |
| `overline` | 11/16 | 600, letter-spacing +0.06em, **no uppercase transform** | nav group labels, table headers, KPI band labels |
| `kbd` | 11/14 | 500 | keyboard hint chips |

**Rules:**

- **No uppercase transforms anywhere.** Uzbek Latin diacritics (oʻ, gʻ) read badly in caps.
  Overlines get hierarchy from weight + letter-spacing + `colorTextSecondary`, not case.
- Hierarchy is typographic: the largest text on any screen is always a money figure, never
  chrome.
- Mobile (AGENT): table style never used — cards use `body`/`body-strong`; labels never below
  13px.

---

## 4. Spacing, radius, elevation

- **Spacing scale (4px base):** 4, 8, 12, 16, 20, 24, 32, 40, 48, 64.
  Page padding 24 (16 below 768px). Card body 16 (12 dense). Gap between page sections 20.
  Form item gap 16 vertical / 12 horizontal. FilterBar internal gap 8.
- **Space over borders:** cards use a 1px `colorBorderSecondary` hairline and **no shadow at
  rest**; grouping inside cards uses whitespace and overline labels, never nested boxes or
  Dividers. No Card inside Card. Descriptions grids have no cell borders.
- **Radius:** `borderRadius: 8` (inputs, buttons), `borderRadiusLG: 10` (cards, drawers,
  modals, table container), `borderRadiusSM: 6` (chips/tags), 999 (pills, status dots).
- **Elevation** — elevation communicates *temporariness*; persistent surfaces separate by
  spacing and border:

| Level | Light | Dark |
|---|---|---|
| rest | border only | border only |
| e1 (hover, row focus) | `0 1px 2px rgba(15,23,32,.06)` | surface +4% L, no shadow |
| e2 (drawers, popovers, peek, sticky bars) | `0 8px 24px rgba(15,23,32,.10)` | surface `#1C242C` + `0 8px 24px rgba(0,0,0,.45)` |
| e3 (modals, palette) | `0 16px 40px rgba(15,23,32,.18)` | `0 16px 40px rgba(0,0,0,.6)` |

- **Controls:** height 32 (`controlHeight`), 26 small (dense toolbars), input font 14.

---

## 5. Motion

Durations & easing:

| Token | Value | Applies to |
|---|---|---|
| `fast` | 120ms | hover fills, focus rings, checkbox/chip toggles |
| `mid` | 180ms | dropdowns, popovers, tab underline, row expand |
| `slow` | 240ms | drawer slide (24px + fade), modal fade + 4px rise, palette |
| easing | `cubic-bezier(0.2, 0, 0, 1)`; exits `cubic-bezier(0.4, 0, 1, 1)` at 60% duration | everything |

**What animates:** surface entry/exit; the StatusFlow rail fills its segment on advance
(240ms); a **1.2s one-shot `colorPrimaryBg` row pulse** when realtime invalidation changes a
visible row; FIFO auto-distribute fills allocation rows **sequentially at 40ms intervals**
(each value renders instantly — the sequence is animated, the numbers are not); skeleton
shimmer 1.2s linear.

**What NEVER animates:** numbers — no count-ups, no crossfades, no ticker digits, ever (this
is a ledger); sorting/pagination (instant); money changed by the user's own typing; table
data swaps (keepPreviousData + a 2px progress hairline under the PageHeader during refetch);
route transitions; charts after first 200ms draw. Nothing bounces, ever.

`prefers-reduced-motion`: everything collapses to ≤80ms opacity-only.

---

## 6. Tables & density

- Default density: 36px rows, 13px type, 8px vertical cell padding. Header row 32px,
  overline-styled on the inset background, **sticky**. Power registers (Orders, Payments,
  Kassa, Reestr, Debts) offer a density toggle 36 → 44px («Keng»), persisted per user in
  localStorage (`sb_density:<userId>:<route>`).
- Only horizontal hairlines (`colorBorderSecondary @ 60%`); no vertical rules; zebra OFF
  (statement tables: 40% inset zebra ON for running-balance scanning).
- Numeric columns right-aligned tabular; date columns fixed-width; identity column and
  actions never wrap. Column headers carry the unit once («Summa (so'm)», «Hajm (m³)») so
  cells stay bare numbers.
- Whole row clickable (hover: e1 + pointer); the explicit link stays on the identity cell for
  middle-click/new-tab. Keyboard cursor row: 2px `colorPrimary` left accent bar. Row actions
  in a trailing kebab menu with **labeled** items — icon-only buttons are extinct.
- **Summary rows are standard:** every filtered register pins a totals row — server aggregate
  for the whole filter where the API returns one; otherwise honestly labeled «sahifa jami».
- **Ghost rows** (voided/cancelled/reversed): 60% opacity, strikethrough on the amount only
  (dates and parties stay legible for audit reading), inline reason chip, chain-link glyph
  jumping to the compensating row. Tri-state visibility filter everywhere:
  «Bekorlar: yashirish / ko'rsatish / faqat».
- Sorting: server-driven where the API supports it; otherwise the sort header renders
  **disabled with a tooltip** («server tartiblashni qo'llab-quvvatlamaydi») — never a silent
  client-side sort of one page.

---

## 7. Money, number, date formatting

- **Money:** space-grouped integer so'm (`1 249 547 319`) via the shared `fmtMoney`; «so'm»
  suffix on hero figures, totals, and print docs — inside tables the header carries «(so'm)»
  once. Minus is a true minus `−` (U+2212). **No abbreviated money as a primary value
  anywhere on desktop**; `fmtShort` («1,2 mlrd») survives only on chart axes and AGENT mobile
  cards — and there the full value renders as a permanent secondary caption, never
  tooltip-only.
- **Signs:** statement amounts render `+ 4 500 000` / `− 4 500 000` with semantic color AND a
  direction word in the row label; balances render unsigned with their semantic tag («Qarz»,
  «Avans», «Qarzimiz», «Avansimiz»). `|balance| < 1` renders `0 so'm · Hisob yopiq`.
- **USD:** always the full equation `$1 250.00 × 12 650 = 15 812 500 so'm`. UZS computed
  server-side, never typed by the user. Rate pre-filled from the last USD payment.
- **Volumes** 3dp «m³» (`32,832 m³`); **pallets** integer «dona»; **per-m³ prices** shown at
  stored precision (up to 6dp, never silently rounded in price-book surfaces — back-solved
  prices like `729 928.1` are real); percent 2dp.
- **Dates** `DD.MM.YYYY`, datetimes `DD.MM.YYYY HH:mm`, Tashkent-local calendar everywhere.
  Relative stamps («3 kun oldin») only in activity feeds, absolute value in tooltip. Every
  range control is the shared `DateRangeControl` with presets: Bugun · Kecha · 7 kun ·
  Shu oy · O'tgan oy · Shu yil · Oraliq… — all Tashkent-day based, stated in the picker
  footer.
- **Locale:** hand-built `uz_Latn` AntD locale pack (~40 strings: pagination, pickers, empty
  states) + dayjs `uz-latn`. The `ru_RU` ConfigProvider dies. Digit grouping keeps the space
  separator (identical output — no retraining).
- **ArtifactText policy:** legacy Cyrillic/Russian workbook strings («Товар», «Оплата»,
  «шопр учун барди») render only through the `ArtifactText` component — serif-italic,
  tertiary color, wrapped in « » — visually fenced off as quoted evidence, never translated,
  never mixed into UI copy.
- Client-side money math is display-only; previews label themselves «taxminiy — server
  tasdiqlaydi»; the server is the only calculator.

---

## 8. Iconography

`@ant-design/icons` outlined set only. 16px in tables/menus, 20px in page headers. Every nav
item has an icon (a collapsed rail must never show blank rows). No emoji in product UI — the
🧱 wordmark is replaced by a stacked-blocks SVG glyph. Empty states: one 20px icon, one
sentence, one action button — no illustrations, no gradients, no confetti.

---

## 9. Platform state law (binding on every screen)

One implementation per state class, reused everywhere. This table is acceptance criteria.

| State | Treatment |
|---|---|
| List loading (first) | Skeleton rows (8 × row height), header intact — layout never jumps. Never a centered spinner on an empty page. |
| List refetch | Existing rows stay (`keepPreviousData`) + 2px progress hairline under the PageHeader; no spinners over data. |
| Detail loading | Skeleton of the real layout (balance block, tab bar, 6 statement rows). |
| Empty register (no filter) | `EmptyState`: one line + primary action («Hali buyurtma yo'q — Yangi buyurtma»). |
| Empty register (filtered) | «Filtrga mos yozuv topilmadi» + «Filtrlarni tozalash» link — never the generic empty. |
| Empty statement period | «Bu davrda harakat yo'q» + opening = closing balance rows still rendered (a statement with no rows is still a statement). |
| Query error | `ErrorState` in place of the failed region only (page chrome survives): Uzbek message + server text verbatim + «Qayta urinish». |
| Mutation error | Inline under the offending field where mappable — server messages carry figures (limit/current/new, box shortfalls) and render **verbatim, never paraphrased**; toast only as fallback. No error modal ever interrupts unrelated work. |
| Toasts | Confirmations only — one line, verb-first («To'lov saqlandi»), 4s, deep link where useful («ORD-000123 →»), max 2 stacked, only for the actor's own mutations. Never for socket/background events. |
| 403 route | Result 403 + «Bosh sahifaga qaytish» button. |
| Session expiry | 401 anywhere → storage cleared → `/login?next=<url>` with «sessiya tugadi» note; re-login returns to the exact filtered view. |
| Socket down | LiveBadge grey «Oflayn — ma'lumot HH:mm holatiga»; `refetchOnWindowFocus: true` as safety net; KPI bands show inline «14:32 holatiga» suffix — numbers are never silently stale. |
| Realtime bursts | Socket `change` events coalesced per entity key family in a **2s window** before refetch (the refetch-storm fix). Changed visible rows pulse once (§5). The entity-name-first query-key convention is a locked contract with `lib/realtime.ts`. |
| Composer collision | If a socket event touches the record open in a drawer, a non-blocking amber ribbon appears: «Bu hujjat boshqa foydalanuvchi tomonidan o'zgartirildi — Yangilash». Forms in flight are never silently overwritten. |
| Dirty-form close | Esc/close intercepted with one confirm («Kiritilgan ma'lumotlar saqlanmagan»). |
| Form resume | Order composer and multi-field money forms persist drafts to sessionStorage (keyed per route, cleared on submit/cancel) — a hard refresh or phone call mid-entry costs nothing. |
| Double submit | Idempotency key per composer open (payments) + submit self-disables with spinner keeping its verb («Qabul qilinmoqda…»). A double-click can never post twice. |
| Stale balance in composer | Party/cashbox/wallet balances refetch on drawer open; client-side max bounds are advisory — server remains authoritative. |
| Already-allocated rows | Disabled in SettleDrawer with the caption «avval bekor qiling» — the raw constraint error is unreachable. |

---

## 10. Accessibility contract

- **Focus always visible:** 2px primary ring, 1px offset, on every interactive element,
  including table rows (roving tabindex) and filter chips. Focus is styled, never removed.
- Drawers/modals trap focus, return it to the invoker on close, set `aria-labelledby` from
  their title. Destructive confirm buttons are never default-focused.
- Icon-only controls are extinct in primary UI; the residuals (kebab, theme toggle, density)
  carry Uzbek `aria-label`s. Kebab menus labeled («ORD-000123 amallari»).
- Table rows carry `aria-label` summarizing party + amount; WorklistCard counts are
  `aria-live="polite"`.
- Color independence: fully readable in grayscale — every semantic color pairs with a word;
  violet UNKNOWN also carries `?`; chart series get direct end-labels, not legend-only.
- Contrast: all essential text ≥ 4.5:1 on its surface in both themes (§2 inks chosen for
  this); tertiary text is restricted to supplementary content (§2.3).
- Hit targets ≥ 32px desktop, ≥ 44px touch. A table row is never the only path to a
  destructive action.
- All five hero workflows are executable keyboard-only (map in `03-shell-and-ia.md` §8).
- `prefers-reduced-motion` honored (§5). Toasts `aria-live="polite"`.

---

## 11. AntD v6 ThemeConfig (drop-in `theme.ts`)

```ts
// theme.ts — SmartBlok canonical themes (replaces existing wholesale)
import { theme as antdTheme, type ThemeConfig } from 'antd';

const font =
  "'Inter var', 'Segoe UI Variable Text', 'Segoe UI', system-ui, -apple-system, sans-serif";

const shared = {
  fontFamily: font,
  fontSize: 14,
  fontSizeSM: 13,            // tables
  fontSizeHeading3: 20,      // page titles
  lineHeight: 1.5715,
  borderRadius: 8,
  borderRadiusLG: 10,
  borderRadiusSM: 6,
  controlHeight: 32,
  controlHeightSM: 26,
  motionDurationFast: '0.12s',
  motionDurationMid: '0.18s',
  motionDurationSlow: '0.24s',
  motionEaseInOut: 'cubic-bezier(0.2, 0, 0, 1)',
};

export const lightTheme: ThemeConfig = {
  algorithm: antdTheme.defaultAlgorithm,
  token: {
    ...shared,
    colorPrimary: '#26617F', colorInfo: '#26617F', colorLink: '#26617F',
    colorSuccess: '#1A7F37', colorWarning: '#9A6700', colorError: '#C2413B',
    colorBgLayout: '#F6F7F9', colorBgContainer: '#FFFFFF',
    colorBorder: '#E3E7EC', colorBorderSecondary: '#EDF0F3',
    colorText: '#1B2530', colorTextSecondary: '#5B6774', colorTextTertiary: '#8A94A0',
    colorFillTertiary: '#F3F5F7',
    boxShadow: '0 1px 2px rgba(15,23,32,.06)',
    boxShadowSecondary: '0 8px 24px rgba(15,23,32,.10)',
  },
  components: {
    Layout: { siderBg: '#F1F3F6', headerBg: '#FFFFFF', headerHeight: 48 },
    Menu: {
      itemBg: 'transparent', itemHeight: 34, itemBorderRadius: 8,
      itemSelectedBg: '#E8F0F5', itemSelectedColor: '#26617F',
      groupTitleFontSize: 11,
    },
    Table: {
      headerBg: '#F3F5F7', headerColor: '#5B6774',
      cellPaddingBlockSM: 8, cellPaddingInlineSM: 12,
      rowHoverBg: '#F6F8FA', fontSizeSM: 13,
      headerSplitColor: 'transparent',
    },
    Card:   { borderRadiusLG: 10, paddingLG: 16 },
    Drawer: { paddingLG: 20 },
    Modal:  { borderRadiusLG: 10 },
    Tag:    { borderRadiusSM: 6, defaultBg: '#F3F5F7' },
    Tabs:   { horizontalItemPadding: '10px 12px' },
    Segmented: { itemSelectedBg: '#FFFFFF' },
    Statistic: { contentFontSize: 20 },
  },
};

export const darkTheme: ThemeConfig = {
  algorithm: antdTheme.darkAlgorithm,
  token: {
    ...shared,
    colorPrimary: '#7FB0CC', colorInfo: '#7FB0CC', colorLink: '#7FB0CC',
    colorSuccess: '#6CC495', colorWarning: '#D9A94A', colorError: '#E8827C',
    colorBgLayout: '#0E1216', colorBgContainer: '#161C22', colorBgElevated: '#1C242C',
    colorBorder: '#2A333C', colorBorderSecondary: '#222A32',
    colorText: '#E6EBF0', colorTextSecondary: '#9AA7B4', colorTextTertiary: '#6C7885',
    colorFillTertiary: '#10151A',
    boxShadow: 'none',
    boxShadowSecondary: '0 8px 24px rgba(0,0,0,.45)',
  },
  components: {
    Layout: { siderBg: '#12171D', headerBg: '#161C22', headerHeight: 48 },
    Menu: {
      itemBg: 'transparent', itemHeight: 34, itemBorderRadius: 8,
      itemSelectedBg: '#1B2E3A', itemSelectedColor: '#7FB0CC',
      groupTitleFontSize: 11,
    },
    Table: {
      headerBg: '#10151A', headerColor: '#9AA7B4',
      cellPaddingBlockSM: 8, cellPaddingInlineSM: 12,
      rowHoverBg: '#1B222A', fontSizeSM: 13,
      headerSplitColor: 'transparent',
    },
    Card:   { borderRadiusLG: 10, paddingLG: 16 },
    Drawer: { paddingLG: 20 },
    Modal:  { borderRadiusLG: 10 },
    Tag:    { borderRadiusSM: 6 },
    Tabs:   { horizontalItemPadding: '10px 12px' },
    Statistic: { contentFontSize: 20 },
  },
};
```

### 11.1 `design.css` custom-property inventory (everything tokens cannot express)

```css
:root {
  --sb-violet: #6D5BD0;            /* reserved: imported-UNKNOWN only */
  --sb-violet-fill: rgba(109,91,208,.12);
  --sb-money-owed: #C2413B;  --sb-money-weowe: #9A6700;  --sb-money-in: #1A7F37;
  --sb-shadow-e1: 0 1px 2px rgba(15,23,32,.06);
  --sb-shadow-e2: 0 8px 24px rgba(15,23,32,.10);
  --sb-shadow-e3: 0 16px 40px rgba(15,23,32,.18);
}
[data-theme='dark'] {
  --sb-violet: #9B8CF0; --sb-violet-fill: rgba(155,140,240,.16);
  --sb-money-owed: #E8827C; --sb-money-weowe: #D9A94A; --sb-money-in: #6CC495;
  --sb-shadow-e1: none;
  --sb-shadow-e2: 0 8px 24px rgba(0,0,0,.45);
  --sb-shadow-e3: 0 16px 40px rgba(0,0,0,.6);
}
```

`design.css` additionally carries only: `.num { font-variant-numeric: tabular-nums lining-nums }`
(global on `td, .stat, .money`); `:focus-visible` ring; `.row-cursor` 2px left accent bar;
`.pulse-row` one-shot 1200ms background keyframe; ghost-row treatment (60% opacity +
amount strikethrough); statement storno connector gutter; sticky condensed PageHeader;
`.kbd` chip (11px, tertiary, 1px border, 4px radius, 2px 5px padding); the 2px refetch
hairline animation; density variant `body[data-density='keng'] td { padding-block: 12px }`;
`@media print` sheet (see `05-hero-workflows.md` §6); `prefers-reduced-motion` overrides.
Nothing else is hand-styled.

---

## 12. What this language deliberately does NOT contain

1. No new colors for decoration — the color budget is spent on meaning (§2.4).
2. No count-up/ticker/crossfade number animation of any kind (§5).
3. No uppercase text transforms (§3).
4. No dark sidebar — the chrome yields to the numbers.
5. No illustrations, gradients, glass effects, or celebratory motion.
6. No abbreviated money as a primary desktop value; no tooltip-only information on mobile.
7. No second design system: AntD compositions + tokens + one CSS file only.
8. No optimistic money — balances render only what the server confirmed (the only optimistic
   element anywhere is a comment row).
