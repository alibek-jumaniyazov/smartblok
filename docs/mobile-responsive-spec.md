# SmartBlok — Mobile Responsive Engineering Contract

**Status:** normative. **Version:** 1.0 (2026-07-20). **Scope:** `apps/web`.
Every agent working on the mobile effort codes against THIS document. Where this
document and an auditor's recon note disagree, THIS document wins.

Owner's goal (verbatim): *"Loyihani full mobil versiya uchun ham yaxshi ishlaydigan
qilib ber, mobile responsive, dasgina ham qiynalmasdan aniq ishlashi kerak."*
Translation into an engineering target: **at 320 / 360 / 390 / 414 px wide, every
screen must be readable, every action reachable, no horizontal page scroll, no
clipped overlay, no unreachable button, no data that exists only in a hover tooltip.**

---

## 0. THE THREE LAWS

1. **Desktop ≥ 992px is frozen.** Byte-for-byte visually unchanged. Every mobile
   behaviour is behind a breakpoint (CSS media query or a `useIsPhone()` branch).
   No "simplification" of the desktop layout to make mobile easier. If a change
   cannot be expressed behind a breakpoint, do not make it.
2. **No business logic changes.** No API calls, money math, permissions, allocation
   rules, data shapes, query keys, or mutation payloads are touched. This is a
   presentation/layout effort only.
3. **No untranslated strings.** Every user-visible string goes through `t()` from
   `useT()`. Reuse existing Uzbek wording; do not invent a second phrasing for an
   idea that already has one.

---

## 1. BREAKPOINTS & TOKENS

### 1.1 Breakpoint names (AntD-aligned — nobody invents new ones)

| name      | JS predicate                  | CSS query                              |
|-----------|-------------------------------|----------------------------------------|
| `phone`   | `width < 768`                 | `@media (max-width: 767.98px)`         |
| `tablet`  | `768 ≤ width < 992`           | `@media (min-width: 768px) and (max-width: 991.98px)` |
| `desktop` | `width ≥ 992`                 | `@media (min-width: 992px)`            |

AntD raw breakpoints, for reference only: `xs 0 · sm 576 · md 768 · lg 992 · xl 1200 · xxl 1600`.

**The `.98` rule is mandatory.** All CSS max-width queries use `575.98 / 767.98 /
991.98`, never `575 / 767 / 991`. Integer max-widths desynchronise from AntD's
`(min-width: 768px)` JS query at fractional viewport widths (Android non-integer
DPR, desktop zoom, devtools emulation) — that is the existing bug where the
MobileTabBar renders with no bottom padding reserved under it.

Existing violations the Foundation agent must correct: `design.css:780` (767),
`design.css:786` (991), `design.css:1112` (575 → must become 767.98 so the ChatDock
FAB layer covers the whole range in which the tab bar exists).

### 1.2 CSS custom properties — declared once on `:root` in `design.css`

Magic numbers are banned. These are the only permitted sources of truth:

```css
:root {
  --sb-topbar-h: 48px;                       /* sticky Layout.Header height        */
  --sb-tabbar-h: 56px;                       /* fixed MobileTabBar height (phone)  */
  --sb-safe-t: env(safe-area-inset-top, 0px);
  --sb-safe-b: env(safe-area-inset-bottom, 0px);
  --sb-safe-l: env(safe-area-inset-left, 0px);
  --sb-safe-r: env(safe-area-inset-right, 0px);
  --sb-fab-h: 52px;                          /* ChatDock launcher                  */
  --sb-touch: 44px;                          /* minimum touch target               */
  /* bottom reserve for page content on phone: tab bar + FAB stack + breathing room */
  --sb-content-pad-b: calc(var(--sb-tabbar-h) + 72px + var(--sb-safe-b));
}
```

Consumption rules:
- `.sb-shell-content` phone padding-bottom = `var(--sb-content-pad-b)`. Nothing else.
- `.sb-tabbar` sets `min-height: var(--sb-tabbar-h)` and
  `padding-bottom: var(--sb-safe-b)` — the token is the source of truth, not a
  measurement of its children.
- ChatDock FAB: `bottom: calc(var(--sb-tabbar-h) + 12px + var(--sb-safe-b))`.
- `PageHeader` sticky `top` = `var(--sb-topbar-h)`; `DataTable` `offsetHeader` = 48
  (the TS constant `TOPBAR_H`, §1.4).
- `.ant-table-sticky-scroll` phone bottom = `calc(var(--sb-tabbar-h) + var(--sb-safe-b))`.

The `76px` literal currently repeated at `design.css:782/1115/1126` is deleted in
favour of these tokens.

### 1.3 `viewport-fit=cover` — DO THIS FIRST

`apps/web/index.html:5` must become:

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
```

Never add `maximum-scale` or `user-scalable=no` (kills pinch-zoom accessibility).

Until this ships, **every `env(safe-area-inset-*)` in the codebase evaluates to 0**
— all four existing reservations in `design.css` are dead code. No agent may add
new `env()` padding before this lands, because it would silently do nothing.

Because `apple-mobile-web-app-status-bar-style: black-translucent` is set, the
sticky header must also reserve the top inset:

```css
.sb-topbar { padding-top: var(--sb-safe-t); height: calc(var(--sb-topbar-h) + var(--sb-safe-t)); }
```

### 1.4 TypeScript constants — `src/lib/responsive.ts`

```ts
export const BP = { xs: 0, sm: 576, md: 768, lg: 992, xl: 1200, xxl: 1600 } as const;
export type Bp = keyof typeof BP;

export const PHONE_MAX  = 767.98;   // inclusive upper bound of "phone"
export const TABLET_MAX = 991.98;   // inclusive upper bound of "tablet"

export const QUERY_PHONE   = '(max-width: 767.98px)';
export const QUERY_TABLET   = '(min-width: 768px) and (max-width: 991.98px)';
export const QUERY_DESKTOP = '(min-width: 992px)';
export const QUERY_TOUCH   = '(hover: none), (pointer: coarse)';

export const TOPBAR_H = 48;   // keep in sync with --sb-topbar-h
export const TABBAR_H = 56;   // keep in sync with --sb-tabbar-h
export const TOUCH_MIN = 44;  // keep in sync with --sb-touch
```

**No file outside `responsive.ts` may contain a literal `767`, `768`, `991`, `992`,
`575` or `576` in a media query string or a width comparison.**

---

## 2. SHARED PRIMITIVES (built by the Foundation agent — coded against by everyone)

### 2.1 `src/lib/responsive.ts` — the hook set

Full public surface. Signatures are normative; the Foundation agent may not rename
or re-order parameters.

```ts
/** Generic matchMedia subscription. Correct on the FIRST render. */
export function useMediaQuery(query: string): boolean;

/** width < 768 — "phone" per §1.1. */
export function useIsPhone(): boolean;

/** 768 <= width < 992. */
export function useIsTablet(): boolean;

/** width >= 992 — the frozen surface. */
export function useIsDesktop(): boolean;

/** true when the viewport is at or above the named AntD breakpoint. */
export function useBreakpointUp(bp: Bp): boolean;

/** coarse pointer / no hover — for replacing hover-only affordances. */
export function useIsTouch(): boolean;

/** Drawer panel width safe at 320px. drawerWidth(520) -> "min(520px, 100vw)" */
export function drawerWidth(desktopPx: number): string;

/** Modal width safe at 320px. modalWidth(560) -> "min(560px, calc(100vw - 24px))" */
export function modalWidth(desktopPx: number): string;

/** Cap for portal-rendered popups (Select/Picker/Popover panels). */
export function popupMaxWidth(): string; // "calc(100vw - 24px)"
```

**THE FIRST-RENDER TRAP — read this before writing any breakpoint branch.**
AntD's `Grid.useBreakpoint()` returns `{}` on the very first render and only fills
in after an effect. `!screens.md` is therefore `true` on the first paint **on
desktop too**, which flashes the mobile layout on every desktop page load and
remounts tables/charts. `Grid.useBreakpoint()` is **banned in all new and modified
code.** `useMediaQuery` must be implemented with `useSyncExternalStore` so the very
first render already has the correct value:

```ts
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback((cb: () => void) => {
    const mql = window.matchMedia(query);
    mql.addEventListener('change', cb);
    return () => mql.removeEventListener('change', cb);
  }, [query]);
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches, // client snapshot — correct on render #1
    () => false,                             // server snapshot — desktop-first default
  );
}
```

`AppShell.tsx`'s existing `Grid.useBreakpoint()` usage is migrated to these hooks by
the Foundation agent; no other file may keep it.

### 2.2 `DataTable` — mobile card mode

**The decision (auditors disagreed; this is final):**

- **Primary list pages render as a touch CARD LIST on phone.** Applies to: Orders,
  Clients, Agents, Factories, Vehicles, Users, Products, Debts (all four boards),
  Pallets (balances + transactions), Bonus, Board lanes, and the embedded tables in
  ClientDetail / AgentDetail / FactoryDetail / OrderDetail.
- **Dense financial ledgers stay TABULAR** with a horizontally scrollable body and a
  pinned first column. Applies to: `TransactionsJournal` (/payments), Kassa
  «Jurnal», and `PartyStatement` (akt-sverka — it is a document, its column
  alignment carries meaning).
- **Un-annotated tables degrade to the scrollable-table path.** A page that has not
  yet added `mobile` metadata never breaks — it just gets the ledger treatment.

#### 2.2.1 Column opt-in metadata

`SbColumn<T>` gains three optional fields (additive; existing columns compile
unchanged):

```ts
export type MobileRole = 'title' | 'subtitle' | 'value' | 'meta' | 'hidden';

export type SbColumn<T> = ColumnType<T> & {
  columnKey?: string;
  serverSort?: string;
  sortable?: boolean;
  /** phone card slot. Absent => column is dropped from the card (same as 'hidden'). */
  mobile?: MobileRole;
  /** label for 'meta' rows rendered as label/value lines. Must be a t() key. */
  mobileLabel?: string;
  /** ordering inside the 'meta' block (ascending, default = column order). */
  mobileOrder?: number;
};
```

Slot semantics (exactly one `title` and at most one `value` per table):

| role       | placement in the card                                    | count |
|------------|----------------------------------------------------------|-------|
| `title`    | line 1, left, 15px/600, single line + ellipsis            | exactly 1 |
| `value`    | line 1, right, `flex: 0 0 auto` — the ONE money figure    | 0..1 |
| `subtitle` | line 2, left, 12.5px secondary, up to 2 lines             | 0..2 |
| `meta`     | line 3+, a wrapping chip/label row or `label: value` lines | 0..n |
| `hidden`   | never rendered on phone                                   | n |

`MoneyCell` is `white-space: nowrap` by design (~165px for a 9-digit sum). That is
why only ONE money figure may occupy the `value` slot; every further amount becomes
a `meta` line.

#### 2.2.2 `DataTableProps<T>` additions

```ts
export interface MobileCardModel {
  title: ReactNode;
  subtitle?: ReactNode;
  /** the single right-aligned primary figure */
  value?: ReactNode;
  /** chips / dates / secondary identity — wrapping row */
  meta?: ReactNode;
  /** label/value rows under the meta row */
  lines?: { label: string; value: ReactNode }[];
  /** full-width footer action(s) inside the card */
  actions?: ReactNode;
  /** ghost (voided/cancelled) styling for this card */
  ghost?: boolean;
}

export interface DataTableProps<T> {
  // …existing props unchanged…

  /** 'auto' (default): cards when a mobileCard fn OR any column carries `mobile`,
   *  otherwise the scrollable-table path. 'cards' / 'table' force the choice. */
  mobileMode?: 'auto' | 'cards' | 'table';

  /** Full manual card renderer. Wins over column metadata when both exist. */
  mobileCard?: (row: T) => MobileCardModel;

  /** Scrollable-table path only: stamp fixed:'left' on the first visible column
   *  when phone. Default true. */
  pinFirstColumn?: boolean;
}
```

**Resolution order (normative):** `mobileCard` → column `mobile` metadata →
scrollable table. `mobileMode: 'table'` short-circuits to the table path even when
metadata exists (used by the three ledgers).

#### 2.2.3 Rendering contract — card path

- Container `<ul className="sb-mcards">`; each row is
  `<li className="sb-mcard" role="button" tabIndex={0}>` when `onRowOpen` exists,
  otherwise a plain `<li>`.
- `min-height: 64px`, `padding: 12px 14px`, full-width, 10px gap between cards,
  card is edge-to-edge inside the (full-bleed on phone) TableCard.
- Trailing `<RightOutlined />` chevron on every card that has `onRowOpen`.
- `:active { background: var(--sb-surface-2) }` — touch needs immediate feedback;
  `:hover` and `cursor: pointer` are meaningless here.
- `ghostWhen(row)` still applies → `.sb-mcard--ghost`.
- **Loading:** the skeleton branch must render 8 card-shaped skeletons on the card
  path, never the 8-column skeleton table. A wide-table→narrow-card snap on every
  load and every filter change is a defect.
- **Empty / error:** unchanged, shared with the desktop path.
- **Pagination on phone:** `simple: true`, `size: 'small'`, `showSizeChanger: false`,
  `showTotal: undefined`. Desktop pager is untouched.
- **Totals:** `totalsRow` gains `columnCount?: number` and `stacked?: boolean`;
  `DataTable` passes the RENDERED column count. On the card path the summary renders
  as a single sticky footer strip inside the TableCard, not as a table summary row.

#### 2.2.4 Touch equivalents for the desktop keyboard affordances

The keyboard cursor (J/K/arrows/Enter/Space/X/Esc) stays exactly as-is on desktop.
On phone it is unreachable, so each affordance gets a touch twin:

| desktop            | phone equivalent |
|--------------------|------------------|
| `Enter` → `onRowOpen` | tap anywhere on the card |
| `Space` → `onPeek`  | card kebab (`MoreOutlined`, ≥44×44) → menu item `t('Ko\'rish')`. If the table is `peekable` and has NO `onRowOpen`, tap = peek. |
| `X` → start selection | a `t('Tanlash')` toggle button in the DataTable toolbar, rendered on phone whenever `selectable` — this breaks the current dead loop where selection can only be started by a key that does not exist on a phone |
| `Esc` → clear cursor | n/a (no cursor on phone) |
| row hover highlight | `:active` state |

The card kebab menu contains, in order: `t('Ochish')` (when `onRowOpen`),
`t('Ko\'rish')` (when `peekable`), then any page-supplied row actions passed through
`MobileCardModel.actions`. **Row action buttons never live inside a card's inline
row** — they go in the kebab or as a full-width footer button.

#### 2.2.5 Rendering contract — scrollable-table path (ledgers + un-annotated fallback)

- `scroll` prop default becomes `{ x: 'max-content' }` (explicit caller values still
  win). Every hardcoded numeric `scroll={{ x: N }}` in the codebase is replaced with
  `'max-content'` — a desktop-era pixel floor prevents the table from ever compacting.
- `pinFirstColumn` stamps `fixed: 'left'` on the first visible column on phone only.
- `sticky` becomes `{ offsetHeader: TOPBAR_H }` so the header parks under the TopBar
  instead of behind it.
- The scroll body gets `.sb-scroll-x`: `-webkit-overflow-scrolling: touch;
  overscroll-behavior-x: contain;` plus a right-edge fade mask so the user can see
  that columns continue off-screen.

### 2.3 `FormDrawer` — phone bottom sheet

Decision: **on phone the FormDrawer becomes a bottom sheet.** A right-side drawer
clamped to `100vw` has no visible mask, so it reads as a page with no exit, and
`maskClosable` is effectively dead.

```tsx
const isPhone = useIsPhone();
<Drawer
  placement={isPhone ? 'bottom' : 'right'}
  height={isPhone ? '92dvh' : undefined}
  styles={{
    wrapper: isPhone ? { width: '100%' } : { width: drawerWidth(width) },
    body:    isPhone ? { padding: '14px 12px' } : { paddingTop: 18 },
    footer:  { padding: isPhone
      ? '12px 12px calc(12px + var(--sb-safe-b))'
      : '12px 20px' },
  }}
/>
```

- Numeric `width` from callers is coerced through `drawerWidth(n)` — never emitted raw.
- The footer keeps the same buttons; on phone they become `block` and stack
  (primary on top) so long Uzbek labels never clip.
- The Ctrl+Enter handler stays (harmless, helps Bluetooth keyboards) but the
  `«Ctrl+Enter»` hint text is hidden on phone.
- Rounded top corners, a 4px drag pill above the title.

This single change fixes all ~20 FormDrawer call sites at once. Page agents **must
not** pass phone-specific widths — pass the desktop number and let FormDrawer decide.

### 2.4 `PageHeader` — phone stack

On phone the identity row stacks instead of competing for one line:

- Row gets `flexWrap: 'wrap'`, title column gets `minWidth: 0`.
- `h1`: `whiteSpace: 'normal'`, `fontSize: 17`, 2-line clamp
  (`display:'-webkit-box'; WebkitLineClamp:2; WebkitBoxOrient:'vertical'; overflow:'hidden'`).
- `subtitle` is **hidden on phone** (decorative page identity, not data — buys back
  ~18px above every list).
- `meta` chips move to their own line under the title.
- Action block gets `flex: '1 1 100%'`; the primary action renders `block`.
- Overflow-menu items: `KbdHint` chips suppressed, `minWidth: 160` → `0`, item
  min-height 44px.
- **`sticky` is disabled on phone** (`stickyOn = sticky && !isPhone`) — a 667px
  viewport cannot afford TopBar + sticky header + filter card + tab bar and still
  show five rows.

### 2.5 `FilterBar` — phone bottom sheet + full-width search

- Search `<Input>`: `style={{ width: isPhone ? '100%' : 240, minWidth: 0 }}`.
- Filter **editors move from a Popover to a bottom `<Drawer placement="bottom"
  height="auto">` on phone.** Rationale: the `daterange` editor embeds a two-panel
  RangePicker (~636px) inside a ~344px popover — the end date is literally
  unpickable today, and `body{overflow-x:hidden}` clips rather than scrolls it.
- All editor controls inside that sheet: `width: '100%'`, `minWidth: 0`.
- `autoFocus` is dropped on phone everywhere in FilterBar (it raises the iOS keyboard
  over the very list the user needs to read).
- Active-filter chips: `height: 32`, `maxWidth: '100%'`, label
  `overflow:hidden; textOverflow:ellipsis; minWidth:0`; the `✕` gets a 28×28 padded
  hit box (`padding: 8; margin: -8`) instead of a bare 10px glyph.
- `meta` slot: `width: '100%'`, no `marginInlineStart: 'auto'` on phone.
- The global `.sb-filterbar` CSS rule (§2.7) makes every hand-rolled filter block on
  Clients / Agents / Factories / Vehicles / Users / Products full-width **without
  touching those six files**.

### 2.6 `TableCard`, `PeekPanel`, `MobileTabBar`, `AppShell`

**TableCard (phone):**
- `.sb-table-card__head` → `flex-wrap: wrap; align-items: flex-start; row-gap: 8px`;
  `__title { min-width: 0 }`; `__extra { width: 100% }` (its controls get their own row).
- Card goes full-bleed: `border-radius: 0; margin-inline: -12px` — recovers 24px.
- `__head` / `__toolbar` / `__footer` padding → `10px 12px`.

**PeekPanel (phone):**
- Full-screen sheet starting at `top: var(--sb-topbar-h)` (never `top: 0`) so the
  TopBar remains a visible escape hatch.
- `zIndex: 900` — strictly BELOW AntD's `zIndexPopupBase` (1000), so Modals and
  Drawers opened from inside a peek always stack above it. The current `zIndex: 1000`
  plus portal re-insertion makes stacking depend on DOM order; a ReasonModal opened
  from a peek can render *underneath* it and the app looks frozen.
- Portal container created once in a ref, not re-appended on every open.
- Header icon buttons: 44×44, `gap: 6`; drop the ↑/↓ triage buttons on phone.
- Add a drag pill + swipe-down-to-close on the header.
- Body: `overscroll-behavior: contain` **and** a body scroll-lock while open
  (`position: fixed; top: -scrollY` — plain `overflow: hidden` does not hold on iOS).
- Footer padding: `12px 16px calc(12px + var(--sb-safe-b))`.
- `DescRow`/`DRow` label columns (`flex: 0 0 96px|104px`) stack (label above value)
  on phone.

**MobileTabBar:** height driven by `--sb-tabbar-h`; each button ≥ 48px tall;
`padding-inline: var(--sb-safe-l) var(--sb-safe-r)` for landscape notches.
Tab sets stay as they are (nothing is unreachable — the Drawer covers every route);
this effort does not re-prioritise them.

**AppShell TopBar (phone):** `<LiveBadge compact />` (dot only), LangSwitcher +
theme toggle move into the avatar Dropdown, the 1px divider is not rendered, the
title wrapper gets `flex: 1 1 auto; minWidth: 0`. The `Ctrl+K` KbdHint and the
`Klaviatura yorliqlari` menu item are suppressed on phone. `ShortcutsModal` returns
`null` on phone.

**Viewport-height sweep** (Foundation, all four at once):
`AppShell` `minHeight:'100vh'` → class `.sb-shell { min-height: 100vh; min-height: 100dvh; }`;
`design.css:559` `.sb-login`; `design.css:971` `.sb-chat-dock`; `design.css:904`
`.sb-route-fallback` (`60vh` → `60dvh`). Progressive pair only — no JS `--vh` hacks.

### 2.7 The mobile CSS layer

**Location:** ONE appended block at the end of `apps/web/src/design.css`, opened with
the banner comment:

```css
/* ══════════════════════════════════════════════════════════════════════════
   MOBILE LAYER (2026-07-20) — phone-only overrides. Everything here is inside
   @media (max-width: 767.98px) or a (hover)/(pointer) query. Desktop >= 992px
   is not reachable from this block. Only the Foundation agent edits it.
   ══════════════════════════════════════════════════════════════════════════ */
```

**What it MAY do:**
- iOS zoom guard (exactly 16px, this is the threshold):
  ```css
  @media (max-width: 767.98px) {
    .ant-input, .ant-input-number-input, .ant-select-selection-search-input,
    .ant-select-selection-item, .ant-picker-input > input, textarea.ant-input { font-size: 16px; }
  }
  ```
- Split the global `white-space: nowrap` on table cells (`design.css:848/854`):
  keep it inside `@media (min-width: 768px)`; below that, `td { white-space: normal;
  word-break: break-word }` with `td.num` / `.num` staying `nowrap` (money and dates
  already carry `className: 'num'`). **This is the single highest-leverage line in
  the whole effort** — without it every other table fix is inert.
- Table header on phone: `text-transform: none; letter-spacing: 0; font-size: 11px`.
- Touch sizing: `.ant-btn-icon-only { min-width: 44px; min-height: 44px }`,
  `.ant-btn-sm { min-height: 40px }`, `.ant-dropdown-menu-item { min-height: 44px }`,
  `.ant-table-row-expand-icon { width: 28px; height: 28px }`,
  `.ant-select-selector, .ant-picker { min-height: 44px }`.
- Overlay safety net: `.ant-picker-panels { flex-direction: column }`,
  `.ant-picker-panel-container { max-width: calc(100vw - 16px) }`,
  `.ant-select-dropdown, .ant-popover-inner { max-width: calc(100vw - 24px) }`.
- `.sb-filterbar > .ant-input-affix-wrapper, > .ant-input, > .ant-select, > .ant-picker
  { flex: 1 1 100% !important; min-width: 0 !important; width: 100% !important; }`
  and `.sb-filterbar > .ant-btn { flex: 1 1 calc(50% - 4px) }`. The existing
  `min-width: 160px` floor at `design.css:888` is wrapped in `@media (min-width: 768px)`.
- Wrap `.sb-table-card__head` and `.sb-panel__head`; `min-width: 0` on their titles.
- Grid floors: `.sb-kpi-grid` → `minmax(150px, 1fr)`, `.sb-stat-strip` →
  `minmax(140px, 1fr)`, `gap: 10px` (turns ~20 stacked full-width blocks into 2-up).
- Safe-area padding on `.sb-shell-content` (`max(12px, var(--sb-safe-l))` inline),
  `.sb-tabbar`, `.sb-sider__footer`.
- Kill the dark-mode fixed radial gradient on phone:
  `[data-theme='dark'] .sb-shell-content::before { display: none }` — a fixed
  full-viewport gradient repaints every scroll frame on iOS/low-end Android and is
  a large part of the "qiynalib ishlaydi" feel.
- Collect **all** unguarded `:hover` rules (`design.css` 387, 478, 671, 704, 957,
  1099) into one `@media (hover: hover) and (pointer: fine) { … }` block. On touch
  `:hover` latches after a tap and never clears. `design.css:273` is the reference
  pattern already in the file.

**What it MAY NOT do:**
- Touch anything at `min-width: 992px`, or change any rule outside a media query.
- Change colours, brand tokens, radii, or typography scale for desktop.
- Add page-specific selectors (`.orders-…`, `.kassa-…`). It is a layer of primitives
  and AntD-level overrides only.
- Use `!important` except where an existing `!important` or an inline style must be
  beaten (`.sb-table-card .ant-pagination` at `design.css:838`, and the six
  copy-pasted inline filter widths).

**`src/index.css`** gets exactly two additions on `body`:
`-webkit-text-size-adjust: 100%` (stops iOS inflating text in landscape and
desynchronising the 10.5–14px scale) and `overscroll-behavior-y: contain` (stops
Android pull-to-refresh reloading the SPA and destroying an in-progress order form).

**A note on `body { overflow-x: hidden }` (`design.css:787`):** it MASKS overflow,
it does not fix it. Because `html` is `overflow: visible`, body's value propagates
to the viewport, so anything too wide is clipped and permanently unreachable — no
scrollbar, no swipe. While auditing, comment it out to make overflow visible. Never
cite it as the reason a wide element is "fine".

---

## 3. RULES EVERY PAGE AGENT MUST APPLY

Mechanical checklist. Each rule has one canonical idiom — produce identical code.

**R1 — Never call `Grid.useBreakpoint()`.**
```tsx
import { useIsPhone } from '../lib/responsive';
const isPhone = useIsPhone();
```
It returns `{}` on first render and flashes the mobile layout on desktop (§2.1).

**R2 — Every `<Col>` declares an `xs`.**
```tsx
<Col xs={24} md={12} lg={8}>…</Col>
```
No `<Col span={8}>` without an `xs` survives review.

**R3 — Every `Modal width={N}` becomes `modalWidth(N)`.**
```tsx
<Modal width={modalWidth(480)} …>
```
(AntD v6 already clamps to `calc(100vw - 16px)` below 575px, so this is about the
576–767 band and about intent, not about page overflow — do not "fix" imaginary
horizontal overflow.)

**R4 — Every `Drawer width={N}` becomes `drawerWidth(N)`; every create/edit Drawer
becomes a `FormDrawer`.** Raw `<Drawer>` create/edit forms (ClientDetail:216/353,
FactoryDetail:1540/1666) are migrated to `FormDrawer` so the phone bottom-sheet
behaviour lands once.

**R5 — No inline fixed width > 280px survives on phone.**
```tsx
style={{ width: isPhone ? '100%' : 240, minWidth: isPhone ? 0 : undefined }}
```
Applies to every `width: 240|260|300|320` and `minWidth: 130..240` on Selects,
Inputs, AutoCompletes and `Space.Compact` groups.

**R6 — Every flex child that holds text gets `minWidth: 0`.** Without it a flex
item's min-content width is its full text width and the row cannot shrink.
```tsx
<div style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
```

**R7 — Every `display:flex; justifyContent:'space-between'` header row that holds a
title plus actions gets `flexWrap: 'wrap'` and `rowGap: 8`.** The action cluster
becomes `flex: '1 1 100%'` on phone.

**R8 — Every sticky/fixed bottom bar clears the tab bar and the home indicator.**
```tsx
style={{ bottom: isPhone ? 'calc(var(--sb-tabbar-h) + var(--sb-safe-b))' : 0, zIndex: 210 }}
```
(ImportReview's commit bar at `bottom: 0, zIndex: 20` is currently painted over by
the `zIndex: 200` tab bar — its primary submit button is unreachable.)

**R9 — No `position: 'sticky'` on a tall content rail below `lg`.**
```tsx
...(isDesktop ? { position: 'sticky' as const, top: TOPBAR_H + 16 } : null)
```
A sticky element taller than the viewport pins its top and its lower half becomes
permanently unscrollable (OrderDetail finance rail, NewOrder «Xulosa»).

**R10 — Every `<Table>` / `<DataTable>` has a `scroll`.** Numeric `scroll={{x:N}}`
becomes `scroll={{ x: 'max-content' }}`. Raw `<Table>` instances with no `scroll`
must gain one.

**R11 — Every list table gets phone treatment.** Either annotate columns with
`mobile:` (preferred — one field per column, desktop `columns` array otherwise
byte-identical) or pass `mobileCard`. Ledgers pass `mobileMode="table"` +
`pinFirstColumn`.

**R12 — A Tooltip may DECORATE a visible value; it may never BE the value.** Any
datum that today exists only inside a `<Tooltip>` becomes visible text (a `meta`
line in the card, a caption under the card title, or a `Popover trigger={['click']}`
behind a visible `ⓘ` button). Known offenders: Bonus «Buyurtma / asos» basis,
Dashboard `Vaqt` full date, Dashboard netted-balance definition, OrderDetail
planned-vs-actual m³, DataTable disabled-sort explanation, Dashboard `CardTip` KPI
definitions, LiveBadge last-update timestamp, SettleDrawer FIFO explanation.

**R13 — Every icon-only control carries `aria-label`** using the same `t()` string as
its Tooltip. Tooltips do not exist on touch; the label must survive without them.

**R14 — Phone numbers are tappable.**
```tsx
<a href={`tel:${c.phone}`}>{c.phone}</a>
```

**R15 — Drop `autoFocus` on phone** for every overlay input.
```tsx
autoFocus={!isPhone}
```
It raises the iOS keyboard on mount and hides the confirm/cancel footer — critical
in ReasonModal (payment void, order cancel, import rollback) and CommandPalette.

**R16 — Overlay bodies that scroll get a dvh cap, not a px cap.**
```tsx
styles={{ body: { maxHeight: 'min(440px, 55dvh)', overflowY: 'auto' } }}
```
and destructive/confirm modals get `centered` on phone so the footer stays visible.

**R17 — Hero money clamps.**
```tsx
style={{ fontSize: 'clamp(20px, 7vw, 30px)', lineHeight: 1.25 }}
```
and the ` so'm` unit is rendered as a **sibling** span outside the `nowrap` money
span (the `StatCard` pattern), so it can wrap instead of forcing a 290px min-width.

**R18 — Charts get a phone spec branch.** `height: isPhone ? 200 : 300`, legend
`position: 'bottom'`, secondary axis hidden, per-series end labels removed.

**R19 — Keyboard-shortcut chrome is hidden on phone.** `KbdHint`, `Ctrl+K`,
`Ctrl+Enter`, `↑↓ tanlash / Enter ochish / Esc yopish` legends: `{!isPhone && …}`.

**R20 — Every new visible string goes through `t()`.**
```tsx
const t = useT();
…
{t('Tanlash')}
```
Reuse existing Uzbek wording. Source strings ARE the keys — never invent a synonym
for a phrase that already exists in the codebase.

**R21 — Do not add rules to `design.css`.** Page agents style inline or via existing
classes. If a page genuinely needs a new shared class, request it from the
Foundation agent; do not write it yourself.

**R22 — Do not change any `useQuery` key, mutation, permission check, formula, or
rounding.** If a layout fix appears to require one, stop and report instead.

**R23 — Verify with `npx tsc --noEmit` before returning.** Strict mode. No `any`
casts to paper over a type error; type it properly (`as const` on style literals
where TS widens `position`/`flexDirection`).

**R24 — Self-check at 320px.** Before declaring a page done, mentally (or via
devtools) walk it at 320 / 360 / 414: no horizontal page scroll, page title
readable, primary action reachable with a thumb, every money figure fully visible,
every overlay dismissible.

---

## 4. TOUCH ERGONOMICS

- **Minimum target: 44×44 CSS px** (`--sb-touch`), with ≥ 8px separation between
  adjacent targets. The theme's `controlHeight: 36` / `controlHeightSM: 28` is the
  root cause of nearly every undersized target — it is **not** changed in `theme.ts`
  (that would alter desktop density). It is corrected by the phone CSS layer (§2.7).
- **Input font-size is exactly 16px on phone.** Below 16px iOS Safari auto-zooms on
  focus and never zooms back, leaving the SPA scaled and horizontally panned for the
  rest of the session. 16px is the threshold; 15.5px does not work. Handled once,
  globally, in the CSS layer — no page agent implements this individually.
- **Hover has no touch equivalent.** Every `:hover` rule is wrapped in
  `@media (hover: hover) and (pointer: fine)`. Every hover-triggered Tooltip that
  carries information becomes visible text or a click-triggered Popover (R12).
  `cursor: 'pointer'` conveys nothing on touch — use an explicit chevron plus an
  `:active` background instead.
- **Keyboard-only affordances get touch twins** per §2.2.4 (`X`→«Tanlash» toggle,
  `Space`→card kebab «Ko'rish», `Enter`→card tap). Shortcut advertising is hidden
  (R19). The shortcuts modal does not render on phone.
- **Every fullscreen surface has a visible, finger-sized exit.** A 24px `✕` in a
  corner with no mask and no swipe gesture is a trap (PeekPanel, ChatDock).
- **Gesture safety:** `overscroll-behavior-x: contain` on horizontal table scrollers
  (otherwise a sideways swipe triggers iOS back-navigation) and
  `overscroll-behavior: contain` on drawer/peek/nav-drawer bodies (otherwise scroll
  chains to the page behind and the user loses their place).
- **Safe areas:** nothing interactive may sit inside the bottom 34px home-indicator
  strip or under a notch in landscape. Every fixed footer adds `var(--sb-safe-b)`;
  the shell and tab bar add `var(--sb-safe-l/r)`.

---

## 5. FILE OWNERSHIP MAP

### 5.1 Foundation agent — EXCLUSIVE ownership

No other agent may edit, append to, or reformat these files:

```
apps/web/index.html
apps/web/src/index.css
apps/web/src/design.css
apps/web/src/theme.ts
apps/web/src/main.tsx
apps/web/src/lib/responsive.ts          (new)
apps/web/src/components/index.ts
apps/web/src/components/DataTable.tsx
apps/web/src/components/TableCard.tsx
apps/web/src/components/FormDrawer.tsx
apps/web/src/components/PageHeader.tsx
apps/web/src/components/FilterBar.tsx
apps/web/src/components/PeekPanel.tsx
apps/web/src/components/AppShell.tsx
apps/web/src/components/MobileTabBar.tsx
apps/web/src/components/LiveBadge.tsx
apps/web/src/components/CommandPalette.tsx
apps/web/src/components/TotalsRow.tsx
apps/web/src/components/DateRangeControl.tsx
```

### 5.2 Every other agent

- Edits **only** its assigned page/component files.
- **Never** edits a §5.1 file — not "just one line", not to add a class.
- **Never** adds CSS to `design.css` (R21). Styling is inline or via existing classes.
- **Never** invents a breakpoint constant, media query string, or a second
  `useIsPhone`-like hook. Import from `src/lib/responsive.ts`.
- **Never** adds a phone-specific width to a `FormDrawer` / `PageHeader` /
  `FilterBar` / `DataTable` call site — those primitives already decide. Pass the
  desktop value.
- If a needed primitive is missing, report it up rather than local-hacking it.

### 5.3 Sequencing

The Foundation agent lands first, in this order:
`viewport-fit=cover` → `:root` tokens + `.98` breakpoint corrections →
`responsive.ts` → dvh sweep → CSS mobile layer → shared components. Page agents
start only after `responsive.ts` and the mobile CSS layer exist, otherwise they will
write `env()` padding that silently does nothing and `Grid.useBreakpoint()` branches
that flash on desktop.

---

## 6. NON-GOALS / ANTI-REGRESSION

**Non-goals (explicitly out of scope for this effort):**
- Redesigning the desktop UI, changing the visual language, colours, or type scale.
- Re-prioritising MobileTabBar tab sets per role (owner's call, not a bug).
- Removing `Modal width={N}` values because of imagined horizontal overflow — AntD
  v6.5 already clamps `.ant-modal` to `calc(100vw - 32px)` (16px below 575px) and
  `.ant-drawer-content-wrapper` to `max-width: 100vw`. The real damage is vertical
  (keyboard occlusion, uncapped scroll bodies, missing safe areas) and inner layout.
  Do not spend edits on width clamping beyond the mechanical `modalWidth`/`drawerWidth`
  substitution.
- Adding a service worker, offline mode, native gestures beyond swipe-to-close, or
  any new dependency.
- Fixing the desktop G-chord navigating away from an open drawer (real, but not a
  mobile issue — leave it).

**Anti-regression, verified before any agent reports done:**
1. At ≥ 992px the app is visually identical to `main`. Every mobile behaviour sits
   behind `@media (max-width: 767.98px)`, `(hover:none)/(pointer:coarse)`, or a
   `useIsPhone()/useIsTablet()` branch.
2. `npx tsc --noEmit` is clean. No new `any`.
3. No `useQuery`/`useMutation` key, endpoint, payload, permission gate, money
   formula, or rounding rule differs from `main` (`git diff` review).
4. Every string added or moved is inside `t()`, using existing Uzbek wording where
   one exists.
5. No new literal breakpoint number outside `src/lib/responsive.ts`.
6. No new rule in `design.css` written by a non-Foundation agent.
7. E2E suite (`test/e2e-core.mjs` against `smartblok_test` on :5433, API :4100)
   stays green — this effort must not move a single assertion.
