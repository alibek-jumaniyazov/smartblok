# frontend-arch

## Domain summary
STACK (apps/web): Vite 6 + React 18.3 + TypeScript 5.7 (strict, noEmit; path alias @/* unused in practice), Tailwind CSS v4 (CSS-first @theme in index.css, no tailwind.config, @tailwindcss/vite), TanStack React Query 5, axios, react-router-dom 6, framer-motion 11, lucide-react icons, recharts 2, clsx. No AntD, no form lib, no validation lib, no global store (state = react-query cache + AuthContext + local useState), no ESLint/tests. Dev proxy /api->localhost:4000; baseURL VITE_API_URL||'/api'. dist/ build artifacts are committed.

ARCHITECTURE: main.tsx mounts QueryClientProvider>AuthProvider>ToasterProvider>BrowserRouter. App.tsx: flat Routes; Protected wrapper checks only token/user existence (no role guards). 22 pages under src/pages (all default exports, ~50-300 lines each, uniform pattern: useQuery via lib/api.ts endpoints object, useState<any> hand-rolled forms with set(k,v), useMutation with toast). lib/api.ts = axios instance + Bearer interceptor from localStorage('sb_token') + 401 hard-redirect + ~50 endpoint fns all typed (d: any). lib/format.ts (fmtUZS/fmtNum/fmtDate/fmtShort, ru-RU locale), lib/nav.ts (role-filtered nav model, Role union, routeLabels), lib/orderStatus.ts (status meta, tone: any), lib/utils.ts (cn = clsx only, no tailwind-merge). auth/AuthContext.tsx: login/logout/refresh, user+token persisted in localStorage, no refresh token/expiry handling. Dark mode: .dark class on html + CSS custom properties + Tailwind @custom-variant; persisted 'sb_theme'; ThemeToggle flips it. i18n: none — Uzbek-latin strings hardcoded inline everywhere; ru-RU only for Intl formatting. CSS: semantic tokens (--surface/--text/--primary...) bridged into Tailwind colors; custom utilities glass/grad-brand/grad-hero/hairline-top/skeleton/app-canvas.

COMPONENT INVENTORY (name -> purpose -> AntD equivalent):
ui/Button -> motion button, variants primary/outline/ghost/danger/subtle, sm/md, loading spinner -> Button (type/danger/loading/size).
ui/Card + CardTitle -> animated surface card with entrance delay, interactive hover -> Card (title/extra/hoverable).
ui/Field + Input + Textarea + Select -> label wrapper (required/hint/error) + styled native inputs; Select uses inline SVG chevron -> Form.Item + Input / Input.TextArea / Select.
ui/Badge + StatusBadge(DEAD) -> tonal pill w/ dot, 7 tones; payment-status taxonomy -> Tag / Badge status.
ui/PageHeader -> title/subtitle/breadcrumb/action with gradient bar -> Breadcrumb + Typography + Space (AntD PageHeader deprecated; or ProComponents PageContainer).
ui/KpiCard -> KPI stat card, useCountUp animation, tone glows, hero gradient variant, delta arrows -> Card + Statistic (count-up must stay custom).
ui/MoneyInput -> thousand-separated numeric input + currency addon -> InputNumber formatter/parser + addonAfter.
ui/Toaster (ToasterProvider/useToast) -> custom toast queue, 3.2s auto-dismiss -> App.useApp() message/notification.
ui/Drawer -> right slide-over, header/footer, backdrop close (no Esc/focus trap) -> Drawer.
ui/Modal (DEAD, never imported) -> centered dialog -> Modal.
ui/EntityTable -> generic Column<T> table: client-side search/pagination(12), density toggle, CSV export (BOM+;), row actions, empty state, skeleton -> Table + Input.Search (CSV export stays custom).
ui/Skeleton (Skeleton/TableSkeleton/CardSkeleton-DEAD) -> shimmer placeholders -> Skeleton / Table loading.
ui/useCountUp -> rAF count-up hook (restarts from 0 each target change).
Layout -> app shell: fixed Sider + glass header, crumb, UserMenu dropdown, mobile drawer nav, Ctrl+K binding -> Layout.Sider/Header/Content + Dropdown (or ProLayout).
Sidebar -> grouped role-filtered nav, framer layoutId active pill -> Menu in Sider.
CommandPalette -> Ctrl+K page search (nav items only) -> keep custom (no AntD equivalent).
ThemeToggle -> dark-class toggle -> keep; drive ConfigProvider darkAlgorithm.
PageTransition -> route entrance motion -> optional keep.
Logo (LogoMark) -> inline SVG brand -> keep.

## Findings
### [high/CONFIRMED] No role-based route guards — authorization is nav-hiding only
apps/web/src/App.tsx:29
Protected only checks localStorage token OR cached user existence. Role filtering happens exclusively in lib/nav.ts visibleGroups() which hides sidebar items. Every route (/users ADMIN-only, /kassa, /reports, /debts, /import) is mounted for any authenticated role; an AGENT or CASHIER can deep-link to /users and the page renders, fires the API calls, and shows action buttons (create/edit/delete users). If the server ever misses a check, the UI offers full admin surface to any role.
EVIDENCE: 1) apps/web/src/App.tsx:29-34 — `Protected` checks only token/user existence, no role: `function Protected({ children }...) { const { user } = useAuth(); const token = localStorage.getItem('sb_token'); if (!token && !user) return <Navigate to="/login" replace />; return <>{children}</>; }`. 2) App.tsx:42-64 — every route, including `/users` (line 61), `/kassa` (59), `/reports` (60), `/debts` (57), `/import` (62), is mounted inside the single `<Protected><Layout /></Protected>` wrapper with zero per-route role checks. 3) apps/web/src/lib/nav.ts:48-52 — `visibleGroups(role)` filters `navGroups` items by `i.roles.includes(role)`; this is the ONLY role filtering in the web app, and it is consumed solely by apps/web/src/components/Sidebar.tsx:11 (`const groups = visibleGroups(user?.role);`) and CommandPalette.tsx:15 — pure nav-hiding. A grep for `role` across apps/web/src/components found no redirect/guard, only nav filtering and a role label display (Layout.tsx:25). 4) apps/web/src/pages/Users.tsx:24-25 — queries fire on mount for any role: `useQuery({ queryKey: ['users'], queryFn: endpoints.users })` and `useQuery({ queryKey: ['agents'], queryFn: endpoints.agents })`; lines 50, 53-54 render the "Yangi foydalanuvchi" create button and per-row Pencil/Trash2 edit/delete buttons unconditionally — no role check anywhere in the file. So an AGENT/CASHIER deep-linking to /users gets the full admin UI surface exactly as claimed. Mitigating server-side context (anticipated by the claim's conditional wording, not a refutation): apps/api/src/users/users.controller.ts:7-8 — `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles('ADMIN')` at controller level, so the fired API calls would 403 for non-admins today; the defect is the total absence of client-side defense-in-depth.
REC: Add a RequireRole route wrapper (roles prop reusing nav.ts Role) and, in the AntD migration, gate menu items AND routes from a single permission map; render 403 page for unauthorized deep links.

### [high/CONFIRMED] Financially destructive deletes fire with zero confirmation
apps/web/src/pages/Orders.tsx:51
Trash-icon buttons call del.mutate(id) directly in Orders.tsx:51, Payments.tsx:61, Users.tsx:54, Kassa.tsx:91, Products.tsx and Expenses.tsx. There is no confirm() or dialog anywhere in src (grep confirms zero matches). Per owner rules, order deletion is a soft-cancel with financial reversal — one misclick on a 15px icon inside a hover-revealed action cluster reverses recognized debt/kassa entries silently.
EVIDENCE: All six cited call sites observed verbatim, each a bare Trash2 icon firing the delete mutation with no confirmation step:
- apps/web/src/pages/Orders.tsx:51 — `<button title="O'chirish" onClick={() => del.mutate(o.id)} className="rounded-lg p-1.5 text-faint transition hover:bg-red-500/10 hover:text-red-500"><Trash2 size={15} /></button>` (icon literally 15px, `size={15}`).
- apps/web/src/pages/Payments.tsx:61 — `actions={(p) => <button onClick={() => del.mutate(p.id)} ...><Trash2 size={15} /></button>}`
- apps/web/src/pages/Users.tsx:54 — `<button onClick={() => del.mutate(u.id)} ...><Trash2 size={15} /></button>`
- apps/web/src/pages/Kassa.tsx:91 — `actions={(t) => <button onClick={() => del.mutate(t.id)} ...><Trash2 size={15} /></button>}`
- apps/web/src/pages/Products.tsx:50 and apps/web/src/pages/Expenses.tsx:52 — same pattern.
Orders.tsx:24 shows the mutation fires the API call immediately: `const del = useMutation({ mutationFn: (id: string) => endpoints.deleteOrder(id), onSuccess: () => { qc.invalidateQueries(); toast("O'chirildi"); } });`

"No confirm() or dialog anywhere in src" — verified: a case-insensitive grep for confirm/ConfirmDialog/AlertDialog/"are you sure" across apps/web/src matches only the password-confirmation field in Profile.tsx (`pw.confirm`) and the CONFIRMED order status in lib/orderStatus.ts. There is no window.confirm and no confirmation dialog component in the codebase.

Financial-reversal consequence verified server-side: apps/api/src/orders/orders.service.ts:230-238 — comment "Deleting an order soft-cancels it (status=CANCELLED): the row and its linked payments are preserved for history, but a cancelled order and its payments drop out of every balance/kassa calculation", then `return this.prisma.order.update({ where: { id }, data: { status: 'CANCELLED' } });`. So one click silently reverses recognized debt and drops linked payments from kassa/balances. Payment delete is even harder: apps/api/src/payments/payments.service.ts:117-121 hard-deletes the payment AND its mirrored cashTransaction in one transaction.

Mitigations found (do not refute the claim, but bound it): (1) order DELETE is role-restricted to ADMIN/ACCOUNTANT — apps/api/src/orders/orders.controller.ts:19 `@Roles('ADMIN', 'ACCOUNTANT') @Delete(':id')`; (2) kassa journal only allows deleting MANUAL rows — apps/api/src/kassa/kassa.service.ts:52-59; (3) order remove is idempotent and recoverable via PATCH :id/status. Two minor inaccuracies in the claim's framing: the action cluster is not strictly hover-revealed — apps/web/src/components/ui/EntityTable.tsx:128 renders it always visible at `opacity-60` with `group-hover:opacity-100` (dimmed, not hidden); and the actions cell has stopPropagation (EntityTable.tsx:127) so a row click cannot itself trigger delete. Neither detail changes the substance: financially destructive deletes fire on a single unconfirmed click of a 15px icon.
REC: During AntD migration wrap every delete in Popconfirm (or Modal.confirm with the amount shown); this is the highest-leverage single fix.

### [high/CONFIRMED] AuthUser typed with numeric ids but backend uses UUID strings
apps/web/src/auth/AuthContext.tsx:5
AuthUser declares id: number and agentId: number | null, but prisma schema.prisma User.id is String @default(uuid()) (v2 migration commit 'UUID ids'). The type is stale and actively wrong; any code comparing user.agentId === agent.id or using strict-typed helpers will be misled, and it demonstrates the API contract is untracked — there are 148 `any` occurrences across 25 of 27 src files, every endpoint in lib/api.ts is (d: any) => any, every table is Column<any>.
EVIDENCE: apps/web/src/auth/AuthContext.tsx:4-11: "export interface AuthUser { id: number; ... agentId: number | null; }" — declared numeric. apps/api/prisma/schema.prisma:11: "id        String   @id @default(uuid())" and :19 "agentId   String?" — backend ids are UUID strings. apps/api/src/auth/auth.service.ts:38-42: "private sign(user: { id: string; username: string; role: string; name: string; agentId: string | null }) { ... user: { id: user.id, username: user.username, name: user.name, role: user.role, agentId: user.agentId } }" — the login/me payload assigned into AuthUser state (AuthContext.tsx:41-42 "localStorage.setItem('sb_user', JSON.stringify(res.user)); setUser(res.user);") carries string UUIDs at runtime, so the type is actively wrong. No mitigation exists: apps/web/src/lib/api.ts:21-30 "const p = (url: string, data?: any) => api.post(url, data).then((r) => r.data); ... login: (d: any) => p('/auth/login', d), me: () => g('/auth/me')" — everything crossing the API boundary is `any`, so tsc cannot catch the mismatch. Supporting stats verified: all 13 table column declarations are `Column<any>` (e.g. apps/web/src/pages/Orders.tsx:26 "const columns: Column<any>[] = ["; same in Agents:31, Clients:29, Expenses:36, Factories:27, Kassa:42, Debts:24/31/37, Payments:42, Products:34, Users:34, Vehicles:27); every body-taking endpoint in lib/api.ts is `(d: any)` (lines 28-101). Exactly 25 files contain `any` as claimed. Minor numeric drift in the auditor's color stats: measured 167 word-boundary `any` occurrences (128 `: any` annotations) vs claimed 148, and 50 total ts/tsx files under apps/web/src vs claimed 27; also parameter-less GET/DELETE endpoints have no `(d: any)` though their returns are still untyped `any`. One nuance: no code currently compares user.agentId === agent.id, so the mislead risk is latent rather than an observed runtime failure — but the type-vs-runtime contradiction itself is directly observed.
REC: Create a shared types package (or generate from the NestJS DTOs / Prisma) in the monorepo; fix AuthUser ids to string; type endpoints' params and returns before the AntD rewrite so migrated pages are typed from day one.

### [medium] Blanket qc.invalidateQueries() nukes the entire cache on most mutations
apps/web/src/lib/api.ts:21
17 call sites across 13 pages call invalidateQueries() with no key (e.g. Clients.tsx:26, Payments.tsx:35, Orders.tsx:23), refetching every active query app-wide after any create/delete. Combined with useCountUp restarting from 0 on each value change (useCountUp.ts resets fromRef to 0), all dashboard KPIs visibly re-animate and the API takes an N-query refetch storm per mutation.
REC: Adopt a query-key factory and invalidate only affected keys; fix useCountUp to animate from previous value. In the AntD migration, centralize per-entity hooks (useClients/useCreateClient) so invalidation is defined once.

### [medium] No error states on any query — API failure renders infinite skeleton
apps/web/src/components/ui/EntityTable.tsx:70
Every page destructures only { data } from useQuery; EntityTable shows TableSkeleton whenever data is undefined, which is also the terminal state after an error (retry: 1). A 500/403 leaves the user staring at shimmer forever with no message and no retry. Same for Dashboard cards and detail pages (ClientDetail.tsx:37 returns skeleton when !data).
REC: Surface isError with an AntD Result/Alert + retry button; consider a QueryErrorBoundary at Layout level.

### [medium] JWT + user object in localStorage with no expiry/refresh handling and permissive guard
apps/web/src/auth/AuthContext.tsx:24
Token stored in localStorage (XSS-readable), user profile cached and trusted from localStorage without validation (role read from it drives nav), no refresh-token flow, no exp decoding. Protected uses `if (!token && !user)` — an expired token or a stale sb_user alone passes the guard until the first 401 triggers a hard location.href='/login' redirect that drops all state. AuthContext default value is `{} as AuthCtx`. The boot-time me() call swallows errors with .catch(() => {}), so an invalid token keeps stale user rendered.
REC: Move toward httpOnly-cookie or at least in-memory token + refresh endpoint; validate cached user via /auth/me before trusting role; on 401 clear cache via queryClient.clear() and use router navigation.

### [medium] All list data fetched unbounded; search/pagination are client-side only
apps/web/src/components/ui/EntityTable.tsx:38
endpoints.orders()/clients()/payments() take no pagination params; EntityTable filters and paginates in memory (pageSize 12). For an ERP with years of orders/payments this means multi-MB payloads on every page visit and every blanket invalidation refetches them all.
REC: Add server-side pagination/filtering to the API and use AntD Table's controlled pagination + react-query keepPreviousData during the migration.

### [medium] Demo credentials including admin password rendered on the login page
apps/web/src/pages/Login.tsx:10
demos array hardcodes admin/admin123, hisob/hisob123, jamol/agent123, kassa/kassa123 and displays them as clickable autofill buttons on the production login screen; username/password state also defaults to admin/admin123.
REC: Gate behind import.meta.env.DEV or delete before any deployment.

### [medium] Copy-pasted payment-form logic in four pages with hardcoded USD rate 12700
apps/web/src/pages/Payments.tsx:22
The payment drawer (method map, USD amount+rate branch, date/note/payer fields, empty-form factory) is duplicated in Payments.tsx, ClientDetail.tsx:26, FactoryDetail.tsx:19 and VehicleDetail.tsx:19, each with slightly divergent method lists (VehicleDetail lacks USD/TERMINAL). The UZS/USD rate default 12700 is hardcoded in 5 spots — it will silently drift from reality. roleLabel map is triplicated (Layout.tsx:11, Users.tsx:15, Profile.tsx:13); routeLabels duplicates navGroups labels; Layout.tsx:69 special-cases crumbs for '/orders/new' and '/profile'.
REC: Extract a shared <PaymentForm type=.../> and constants module (methods, roleLabel, defaultUsdRate fetched from API); derive crumbs from a single route config.

### [medium] Hand-rolled untyped form state with no validation layer
apps/web/src/pages/NewOrder.tsx:63
Every form is useState<any>(empty) + set(k,v) spread updates; validation is only native HTML `required` plus one manual check in NewOrder (submit() toast). No react-hook-form/zod; numeric fields keep string values ('quantity', rate via e.target.value) that get Number()-coerced ad hoc; server errors surfaced only via toast of e.response.data.message.
REC: Migrate forms to AntD Form (rules, typed values via Form.useForm<T>) — this replaces the entire pattern and the Field wrapper for free.

### [low] Dead components: Modal, StatusBadge, CardSkeleton; stale dist/ committed
apps/web/src/components/ui/Modal.tsx:5
Modal.tsx is never imported anywhere (all dialogs use Drawer); StatusBadge (Badge.tsx:35) and its PAID/UNPAID/PARTIAL/DEBT/ADVANCE/SETTLED taxonomy are unused; CardSkeleton (Skeleton.tsx:18) unused. apps/web/dist/ (index-*.js/css) is committed to git and will go stale.
REC: Delete dead exports before migration inventory freezes; add dist/ to .gitignore.

### [low] No i18n framework despite RU/UZ requirement; locale mixed
apps/web/src/lib/nav.ts:11
All UI strings are hardcoded Uzbek-latin inline (nav labels, toasts, table headers, empty states), while number/date formatting uses ru-RU and index.html lang="uz". There is no mechanism to switch language and AntD's own component strings will need locale wiring anyway.
REC: Introduce i18next (or lingui) with uz/ru catalogs during the AntD migration and pass AntD ConfigProvider locale accordingly; centralize the currency formatter with it.

### [low] cn() is plain clsx without tailwind-merge; Button erases prop types
apps/web/src/lib/utils.ts:2
cn() does not merge conflicting Tailwind classes, so className overrides passed to Button/Card (e.g. 'p-0' on Card with padded default) rely on CSS order luck. Button spreads {...(props as any)} into motion.button, discarding type-checking of event handlers, and motion whileHover still nudges disabled buttons.
REC: Mostly moot after AntD adoption; where custom components remain, add tailwind-merge and drop the `as any` spread.

### [low] Custom Drawer/Modal lack Escape-close, focus trap and aria-modal
apps/web/src/components/ui/Drawer.tsx:8
Drawer (used by every create/edit flow) closes only via backdrop click or X button; keyboard users cannot Esc out, focus is not trapped or restored, and no role=dialog/aria-modal is set. CommandPalette implements its own key handling but also lacks a focus trap.
REC: AntD Drawer/Modal provide all of this natively — prioritize these two components in the migration.

### [low] Dark-mode strategy must be bridged to AntD tokens
apps/web/src/index.css:44
Theming is .dark class + ~40 CSS custom properties consumed via Tailwind v4 @theme mapping, plus premium utilities (glass, grad-hero, app-canvas) and recharts colors partially hardcoded (#4F46E5/#F59E0B in Dashboard.tsx ignore theme vars). AntD uses ConfigProvider theme algorithm, not a class — the two systems will coexist during migration and can diverge.
REC: Drive both from one source: keep ThemeToggle state in context, feed ConfigProvider {algorithm: dark? darkAlgorithm: defaultAlgorithm, token: {colorPrimary:'#4F46E5', borderRadius: 12}} and keep the .dark class for residual Tailwind styling; move chart colors to tokens.
