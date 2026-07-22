# SmartBlok — Business Map (source of truth for UX redesign)

> Generated 2026-07-11 by a 21-agent parallel study of the codebase. Business logic here is LOCKED — the redesign changes UI/UX only.

## Domains

---

## Excel Import & Reconciliation (one-time migration of the owner's «Газоблок Счет.xlsx» workbook into the ERP)

This domain migrates the gas-block dealer's entire manual bookkeeping — a single Excel workbook «Газоблок Счет.xlsx» with 21 sheets — into the ERP as real financial history. The parser (apps/api/src/import/workbook-parser.ts) reads 3 ledger sheets (Товар = one row per truckload sold, Оплата = client payments split across 6 channels, Оплата Завод = payments to the factory) plus 17 per-client account sheets named «N-Имя» (N = agent number; left half = payments/pallet returns, right half = shipments), ignoring the «0» template and the Свод summary. Before writing anything it self-validates 7 hardcoded grand totals against the workbook's own subtotal rows (e.g. Σ block cost = 992 269 250 UZS, Σ pallets = 1040); any failure aborts with a 400. The write pass (import.service.ts, one 120-second Prisma transaction) then creates COMPLETED orders, channel-split CLIENT_IN payments, FACTORY_OUT payments, synthesized VEHICLE_OUT transport payments, TRANSPORT_DIRECT client-to-driver payments, pallet transactions, ledger entries, cash transactions and payment allocations — exactly mirroring the postings the normal Orders/Payments services would have made — while find-or-creating clients, aliases, products, vehicles and legal entities. It encodes deep workbook forensics: a 4-entry alias map for client-name spelling drift, ±1 UZS / ±3 day fuzzy matching of client-sheet payments against the Оплата ledger (~95.8M UZS of sheet payments missing from Оплата are imported flagged reconciled:false), date-ordered matching of «клентдан»/«шопр учун барди» driver-direct payments to trucks, and a +5h timezone fix for the workbook's date artifact.

Usage pattern: this is a one-time pre-go-live migration, not a recurring feed. Hard guards enforce that: import refuses to run if any manually created order exists, and a second real import is blocked until the previous batch is rolled back (DELETE hard-deletes every row carrying the batch id). Dry-run (?dryRun=true) executes the full write inside the transaction then rolls it back via a sentinel exception, returning the stats — so the operator iterates dry-runs until clean, does one real import, verifies, and either keeps it or rolls back and retries. After a real import, GET /import/batches/:id/reconciliation recomputes each client's expected balance and pallet count independently from the client sheets, compares against the live ledger, and — crucially — classifies every mismatch as either "explained by a workbook defect" (sheetGaps: trucks in Товар never copied to the client sheet, extra sheet rows, Оплата rows not on the sheet) or "unexplained" (meaning the import itself is wrong). Factory balance is checked against 973 619 270 UZS expected prepayment.

The current UI (apps/web/src/pages/Import.tsx, route /import, menu «Excel import») is a single Ant Design page: a drag-drop upload card with «Tekshirish (dry run)» and a red «Import qilish» button, inline run results (checks list, counts grid, cashbox balance table with negative-balance warning), a batch history table with «Solishtirish» (compare) and «Orqaga qaytarish» (rollback) actions, an expandable reconciliation card (factory balance, per-client expected/actual/diff table sorted worst-first, flagged-payments table), and a rollback modal requiring the user to type ROLLBACK. Language is mixed: page chrome and confirmations are Uzbek in Latin script, backend error messages and flags are Uzbek in Cyrillic script, and check names / sheet terminology are Russian (Товар, Оплата, «шопр учун барди») — three writing systems on one screen. Note: docs/09-excel-import-va-migratsiya.md describes the obsolete v2 importer (3 sheets, replace mode, ADMIN+ACCOUNTANT, no cash posting) and must not be used as spec; the code and docs/audit/excel-spec.md are the truth.

### Entities

- **ImportBatch** — One import run; the anchor every imported row points to via importBatchId, enabling reconciliation and full rollback. Stats JSON stores checks, counts, unmatched/unreconciled lists, expected balances per client, and cashbox balances.
  - Fields: id; filename; stats (Json: checks, counts, unmatchedClientDriverTrucks, unmatchedDriverPayments, unreconciled{total,payments}, expected{factoryExpected, clients[expectedBalance, expectedPallets, sheetless, sheetGaps]}, cashboxBalances); createdById; createdAt; relations: orders, payments, ledgerEntries, palletTransactions, cashTransactions, expenses
- **ParsedWorkbook (in-memory)** — Pure decode of the 21-sheet workbook before any DB write: TovarRow[] (shipments), OplataRow[] (client payments with per-channel split), FactoryPaymentRow[], ClientSheet[] (payments, goods, pallet returns, expectedBalance = Σgoods − Σpayments), plus 7 self-validation checks against hardcoded workbook subtotals.
  - Fields: tovar[] (agentRaw, clientRaw, date, plate, size, m3, costPricePerM3 6dp, palletCount, palletPrice, salePricePerM3|null=pricePending, transportKind DEALER|CLIENT_DIRECT|NONE, transportPaid); oplata[] (channels BANK/CASH/CLICK/TERMINAL/USD/OTHER, payerRaw, receiverRaw, rate); factoryPayments[] (payer text drives method: Септем Алока→BANK, Нахт→CASH, Нахт пластика→CARD); clientSheets[] (canonicalName = sheet name minus numeric prefix, driverDirectTotal, expectedPallets); checks[] (name, expected, actual, ok)
  - States: ok=true (all 7 checks pass, no row errors) | ok=false (import refused)
- **Order (imported)** — One Товар row = one truckload, created directly as a completed sale with historical date; posts CLIENT +saleTotal and FACTORY −costTotal ledger entries.
  - Fields: orderNo (ORD-xxxxxx from order_no_seq); status=COMPLETED; date/completedAt = workbook date; saleTotal; costTotal (m³×cost + pallets×130000); costStatus=PROVISIONAL; transportMode=DEALER_ABSORBED; transportCost; transportPaidStatus; items[0].pricePending (true when shipped before price agreed); importBatchId
  - States: COMPLETED (always) | transportPaidStatus: PAID | PAID_BY_CLIENT | UNKNOWN | NOT_APPLICABLE
- **Payment (imported)** — Four kinds are synthesized: CLIENT_IN (one per Оплата channel, plus unmatched client-sheet payments flagged reconciled:false), FACTORY_OUT (Оплата Завод), VEHICLE_OUT (dealer transport marked «Туланди»), TRANSPORT_DIRECT (client paid the driver — no dealer cash touched, always reconciled).
  - Fields: kind; method (BANK/CASH/CLICK/TERMINAL/USD/CARD); amount; usdAmount+rate for USD; cashboxId (7 seeded boxes; receiver «Септем семент» reroutes BANK); payerEntityId/receiverEntityId (find-or-create LegalEntity); reconciled flag; importBatchId
  - States: reconciled=true (found in Оплата ledger or driver-direct) | reconciled=false (client-sheet payment missing from Оплата — needs owner review)
- **ClientAlias** — Maps workbook spelling drift to the canonical client (client-sheet spelling wins). 4 built-in seeds: Жасур Версал→Жаср Версал, Шиддат моналит→Шиддат маналит, NORMAT UMIDBEK→Нормат Умидбек, Гофур хазорасп→Гофур Хазорасп.
  - Fields: name (unique alias); clientId
- **PalletTransaction (imported)** — Per truck: RECEIVED_FROM_FACTORY + DELIVERED_TO_CLIENT of palletCount; client-sheet column E rows become RETURNED_BY_CLIENT. Drives the in-kind pallet debt counter (delivered − returned).
  - Fields: type; qty; clientId/factoryId; orderId; date; importBatchId
- **Reconciliation report (computed)** — Expected (recomputed from client sheets) vs actual (live ledger) per client: balance, diff, ok (<1 UZS tolerance), pallets expected/actual, plus sheetGaps that classify mismatches as explained-by-workbook-defect or unexplained (= import bug). Also factory balance check and flagged (reconciled:false) payments list.
  - Fields: clients[] (expectedBalance, actualBalance, diff, ok, expectedPallets, actualPallets, palletsOk, sheetless, sheetGaps{missingFromSheet, extraOnSheet, oplataNotOnSheet, adjustedExpectedBalance}, explainedByWorkbookDefect); factory{expected, actual, diff, ok}; flaggedPayments[]; summary{mismatched, unexplained, palletsUnexplained, flaggedTotal}

### Workflows

- **Dry-run validation loop** (ADMIN (backend enforces ADMIN on the endpoint despite the page being visible to ACCOUNTANT too); several times during migration prep, then never again)
  1. Open /import («Excel import» in the sidebar)
  1. Drag the .xlsx onto the Upload.Dragger (or click to browse); frontend accepts .xlsx only, backend checks the PK zip magic bytes and 20MB cap
  1. Click «Tekshirish (dry run)» — POST /import/excel?dryRun=true runs the FULL write inside a transaction, then rolls it back via a sentinel, returning stats
  1. Review inline results: 7 self-validation checks (green/red), record counts, warning if any cashbox would go negative (workbook has no opening balances), collapsible unmatched lists
  1. If the workbook fails self-validation (400 with failedChecks) fix the file and repeat
- **Real import** (ADMIN; once (pre-go-live); repeatable only after rollback)
  1. With a clean dry-run, click the red «Import qilish» button (ADMIN-only in UI)
  1. Confirm the modal warning that import must land in an empty base
  1. Backend guards: refuses if any manually created order exists, or if a prior batch exists (must rollback first); requires seeded factory «CAOLS KS» and 7 named cashboxes
  1. Single transaction writes everything: ~56 orders, channel-split client payments, factory payments, transport payments, pallet transactions, ledger + cash entries; find-or-creates clients/aliases/products/vehicles/legal entities; audit-logs the batch
  1. On success every React Query cache is invalidated and the reconciliation card auto-opens for the new batch
- **Reconciliation review** (ADMIN (with the business owner for flagged payments); a few times right after import, then never)
  1. Click «Solishtirish» on a batch row (or arrive automatically after import) — GET /import/batches/:id/reconciliation
  1. Read the top alert: «Hammasi mos» or «N ta nomuvofiqlik topildi»
  1. Check the factory balance block (expected 973 619 270 UZS prepayment vs live ledger)
  1. Scan the per-client table (worst mismatches sorted first): expected vs actual balance, diff (red when ≥1 UZS), pallets expected/actual, «Varaqsiz» tag for sheetless clients
  1. Review the flagged-payments table (client-sheet payments absent from the Оплата ledger, ~95.8M UZS) with the owner and confirm each
  1. Backend additionally classifies each mismatch as workbook-defect-explained vs unexplained — but the current UI does not render this, so the operator must hit the API directly for the verdict that matters
- **Rollback** (ADMIN; rare — only if reconciliation exposes an import error)
  1. Click «Orqaga qaytarish» on the batch row
  1. Confirm the first modal (warning: all batch records will be deleted, irreversible)
  1. In the second modal, type the literal word ROLLBACK to enable the button, then confirm
  1. DELETE /import/batches/:id with {confirm:true} hard-deletes cash transactions, ledger entries, pallet transactions, bonus transactions, allocations, payments, orders (children cascade), expenses in FK-safe order, then the batch itself; audit-logged
  1. All query caches invalidated; the base is empty again for a corrected re-import

### Roles

- **ADMIN**: Everything in this domain, enforced server-side with @Roles('ADMIN') on all 4 endpoints: upload/dry-run, real import, batch listing, reconciliation, rollback. Controller comment: the importer writes financial history directly, hence admin-only.
- **ACCOUNTANT**: Can SEE the page (route guard FIN = ADMIN+ACCOUNTANT, menu item visible, dry-run button enabled in UI) but every API call returns 403 — the frontend comment «dry-run for everyone» contradicts the ADMIN-only backend. Effectively: no working permissions; this is a frontend/backend mismatch the redesign must resolve (either hide the page or open dry-run + read endpoints to ACCOUNTANT).
- **AGENT / CASHIER**: No access: route guard blocks the page, menu item hidden, API denies.

### Current UI

Pages: /import — «Import va solishtirish» (sidebar label «Excel import», ContainerOutlined icon, also reachable via command palette «Excel import / migratsiya»)

One vertically stacked page (Ant Design v6), three Cards plus one Modal. (1) Upload card «Excel daftarini yuklash»: full-width Upload.Dragger (accept=.xlsx, maxCount=1, hint text names the «Газоблок Счёт» workbook), below it two buttons — «Tekshirish (dry run)» (default style, flask icon) and «Import qilish» (primary+danger, ADMIN-only) — and, after a run, an inline RunResult block: a blue/green status Alert, a «Tekshiruvlar» card listing the 7 validation checks as green-check/red-cross icon + Russian check name (a red «N ta o'tmadi» tag when failing), a bordered Descriptions grid (1/2/4 responsive columns) of record counts, an optional warning Alert about unreconciled payments, a Collapse of unmatched-record lists (raw JSON strings in a scrollable <ul>), and a «Kassa qoldiqlari» card with a 2-column table where negative balances are red plus a warning Alert explaining opening balances must be entered manually. (2) «Import tarixi (batchlar)» card: unpaginated small Table (Fayl | Sana | Kim | Yozuvlar as up-to-4 count Tags | actions), each row has «Solishtirish» (compare, turns primary when selected) and a red «Orqaga qaytarish». (3) Conditional «Solishtirish — <filename>» card that appears BELOW the history table when a batch is selected (Yopish button to close): success/error summary Alert («N ta nomuvofiqlik topildi»), «Zavod balansi» Descriptions row (Kutilgan/Haqiqiy/Farq/Holat), the per-client reconciliation Table (Mijoz + orange «Varaqsiz» tag | Kutilgan (Excel) | Haqiqiy (baza) | Farq red-bold when ≥1 | Balans icon | «Palletalar (Excel / baza)» + icon; sorted mismatches-first, pageSize 20, horizontal scroll x:960), and a nested «Tekshirilishi kerak bo'lgan to'lovlar (N)» card (total in header, warning Alert, table: Sana | Mijoz | Summa | Izoh). Rollback is a two-stage flow: modal.confirm dialog, then a second Modal where the user must type ROLLBACK into an Input to enable the red confirm button. All destructive actions red; diffs use tabular-nums; money via a shared <Money> component. UI text is Uzbek (Latin), server errors arrive in Uzbek (Cyrillic), check/sheet names in Russian.

### Pain points

- [high] Role mismatch renders the page dead for ACCOUNTANT: route/menu allow ADMIN+ACCOUNTANT and the dry-run button is enabled for accountants (frontend comment even promises 'dry-run for everyone'), but ALL four endpoints are @Roles('ADMIN') — an accountant gets a page where the batch list errors with 403 and every button fails.
  - Suggestion: Decide once: either hide /import from ACCOUNTANT entirely, or open dry-run + GET endpoints to ACCOUNTANT server-side and gate only real import/rollback to ADMIN. The redesigned UI should derive button visibility from the same permission source as the API.
- [high] The backend's most valuable reconciliation output is invisible: per-client sheetGaps (which trucks are missing from the client sheet, extra sheet rows, Оплата rows not on the sheet, adjustedExpectedBalance) and the explainedByWorkbookDefect / unexplained classification — the very signal that distinguishes 'the workbook is stale' from 'the import is buggy' — are computed and returned but never rendered; the summary object is only shown if it is a string (it is an object, so never).
  - Suggestion: Make the mismatch triage the centerpiece: expandable client rows showing sheetGaps detail, a badge distinguishing 'explained by workbook defect' (amber) from 'unexplained — import error' (red), and a headline summary chip row (clientsOk/mismatched/unexplained/flaggedTotal).
- [high] Frontend/backend stats contract drift hides key numbers after a dry run: the code reads stats.unreconciledTotal but the backend sends stats.unreconciled.total, so the warning about ~95.8M UZS of payments missing from the Оплата ledger NEVER appears at the decision point (before real import); counts.paymentsByKind (an object) renders literally as '[object Object]' in the counts grid and in the batch-history tags; unmatched driver-truck/payment lists render as raw JSON.stringify blobs in a bullet list.
  - Suggestion: Define a typed shared contract for stats (the defensive normalizers exist only because backend and frontend were built in parallel) and design real presentations: an unreconciled-payments preview table in the dry-run result, per-kind payment count chips, and structured columns (row, client, date, plate, amount) for unmatched items.
- [medium] Validation checks show only a name and a pass/fail icon: the backend sends expected and actual values for each of the 7 checks, but the UI reads nonexistent .detail/.message fields, so on failure the operator cannot see by how much a total is off without opening dev tools.
  - Suggestion: Render checks as a small table: check name | expected | actual | Δ, with the delta highlighted; on failure this is the operator's primary debugging surface.
- [medium] Everything lives on one endless vertical page: after clicking «Solishtirish» in the history table the reconciliation card mounts below the fold with no scroll-into-view, and the dry-run result block pushes the history/reconciliation further down; on a real import the page silently switches the selected batch while the user is still looking at the upload card.
  - Suggestion: Restructure as steps or tabs (Upload → Natija → Solishtirish), or open reconciliation in a dedicated view/drawer; auto-scroll or navigate to the reconciliation after a real import.
- [medium] Dry-run results are ephemeral component state: navigating away or refreshing loses the entire validation report (dry runs create no batch row), forcing a re-upload and re-run of a 2-minute transaction to see the numbers again.
  - Suggestion: Persist dry-run stats (e.g. a dryRun ImportBatch row or localStorage) and list them in history with a 'dry run' tag, so the operator can compare successive attempts.
- [medium] No progress feedback during a long operation: the import runs a single transaction with a 120s timeout, but the UI shows only a button spinner — no stage indicator, no row counter, and the disabled state is the only sign anything is happening.
  - Suggestion: At minimum an indeterminate progress overlay with stage labels (parsing → validating → orders → payments → reconciliation snapshot); ideally the backend streams stage progress.
- [medium] Three writing systems on one screen: page chrome in Uzbek Latin (Tekshirish, Solishtirish), backend errors and flag reasons in Uzbek Cyrillic («Импорт бўш базага киритилади», «шопр учун барди»), and check/sheet names in Russian (Товар, Оплата Завод) — cognitively taxing and inconsistent for a single-operator tool.
  - Suggestion: Pick one primary script for UI and backend messages (owner works in Uzbek Cyrillic/Russian per the workbook) and keep workbook sheet names verbatim as quoted artifacts; the redesign should establish an i18n convention for the whole app.
- [low] Rollback needs 4 interactions across two sequential modals (button → confirm → type ROLLBACK → confirm), and the first confirm modal adds no information the second one lacks; conversely the real-import confirm shows no dry-run summary, so the last thing the admin sees before writing financial history is generic prose rather than the numbers they are about to commit.
  - Suggestion: Collapse rollback to one modal with the typed confirmation plus a list of exactly what will be deleted (counts from the batch); make the import confirmation show the dry-run check results and counts inline, and require a prior clean dry-run of the same file.
- [low] Flagged-payments table omits fields the backend sends (payerName, method, payment id), which the owner needs to verify a payment against bank statements, and offers no action — after reviewing with the owner there is no way to mark a flagged payment as confirmed from this screen.
  - Suggestion: Add payer and method columns, and a per-row 'tasdiqlash' action that sets reconciled=true (needs a small new endpoint), turning the review from read-only into a completable checklist.

### LOCKED RULES

- Import is ADMIN-only at the API level — it writes financial history (orders, payments, ledger, cash) directly.
- Import lands only in an empty base: refused if any order with importBatchId=null exists; a second real import is refused until the previous batch is rolled back (DELETE /import/batches/:id with {confirm:true}).
- The workbook must pass 7 hardcoded self-validation checks against its own subtotal rows before anything is written (Σ block cost 992 269 250; Σ pallet money 135 200 000; Σ block+pallet 1 127 469 250; Σ sale 1 249 547 319.36 ±1; Σ pallets 1040; Σ factory paid 2 101 088 520; Σ Оплата 1 024 066 320); any failure or row error aborts with 400.
- File must be .xlsx (PK magic bytes checked), ≤20MB, multipart field 'file'; dryRun=true|1 executes the full write then rolls back via sentinel, returning identical stats.
- Entire write pass is one Prisma transaction (maxWait 20s, timeout 120s) — no partial imports possible (unlike the v2 importer described in docs/09).
- Workbook dates carry a ~T18:59:49Z UTC+5 artifact: normalize by +5h then truncate to UTC midnight of the local calendar day (normalizeWorkbookDate).
- Client identity: client-sheet spelling (sheet name minus numeric prefix) wins as canonical; 4 built-in aliases (Жасур Версал→Жаср Версал, Шиддат моналит→Шиддат маналит, NORMAT UMIDBEK→Нормат Умидбек, Гофур хазорасп→Гофур Хазорасп) become ClientAlias rows; name matching is case/whitespace-insensitive (normKey).
- Agent attribution: first Товар row per client wins, Оплата as fallback; agent name resolution allows prefix match («Жамол 22-22» → Жамол).
- Each Товар row becomes a COMPLETED order (historical date, ORD-###### from order_no_seq) posting CLIENT +saleTotal and FACTORY −costTotal; costTotal = round2(m³×costPrice + pallets×palletPrice); costStatus=PROVISIONAL, provisionalPriceKind=FACTORY_BANK; transportMode always DEALER_ABSORBED.
- Unpriced trucks (no sale price in col O) import with pricePending=true, saleTotal=0 — goods shipped before the price was agreed (the two Шиддат trucks).
- Pallets are in-kind debt: per truck create RECEIVED_FROM_FACTORY + DELIVERED_TO_CLIENT pallet transactions; client-sheet col E rows become RETURNED_BY_CLIENT; clients are never billed pallet money.
- Transport, three cases from Товар col S/U: numeric S = dealer pays driver (ledger VEHICLE −cost; if U says «Туланди» or a date, synthesize a CASH VEHICLE_OUT payment from «Naqd kassa» allocated to the order); «клентдан» = client paid driver directly (match to a «шопр учун барди» client-sheet payment in date order → TRANSPORT_DIRECT payment posting CLIENT − and VEHICLE +, reconciled by definition, no dealer cash); blank/«Х» = none; unmatched cases get transportPaidStatus=UNKNOWN for the owner to resolve.
- Leftover «шопр учун барди» payments with no matching «клентдан» truck still credit the client (they are inside the sheet's C5 total) and attach to the client's latest truck's vehicle; clients with no orders at all are skipped and reported.
- Оплата rows split into one CLIENT_IN payment per channel (BANK/CASH/CLICK/TERMINAL/USD/OTHER→CASH); USD amount = usd×rate stored with usdAmount+rate against the USD cashbox; receiver «Септем семент» reroutes BANK money to the «Bank (Септем семент)» cashbox; numeric receivers (card numbers) stay as text receiverName, others become LegalEntity rows (find-or-create).
- Client-sheet payments are matched against the Оплата ledger in two passes: (1) same client, amount ±1 UZS, date within ±3 days; (2) amount ±1 only (covers null dates and the known 06-06 date typo). Unmatched ones import as BANK CLIENT_IN with reconciled=false and are surfaced as flagged payments for owner review (~95.8M UZS).
- Оплата Завод payer text drives method and cashbox: «Септем Алока»→BANK, «Нахт»→CASH, «Нахт пластика»→CARD; posts FACTORY +amount; no cashbox balance guard — imported history may legitimately drive a box negative because opening balances are entered by the owner separately.
- No bonus accrual during import (no BonusProgram rows exist at these dates).
- Expected balances snapshot: per client expectedBalance = Σ sheet goods − Σ sheet payments (−F2 recomputed), expectedPallets = Σ delivered − Σ returned; factory expected = 2 101 088 520 − 1 127 469 250 = 973 619 270; sheetless clients' expected = their Товар sale total.
- Reconciliation tolerance: |diff| < 1 UZS counts as OK (float residue of back-solved prices); mismatches explained by the workbook's own staleness (sheetGaps: Товар↔sheet truck gaps matched by amount ±1, Оплата rows absent from sheets) are classified explainedByWorkbookDefect — anything in 'unexplained' means the import itself is wrong.
- Rollback hard-deletes every row carrying the importBatchId in FK-safe order (cash → ledger → pallet → bonus → allocations → payments → orders → expenses → batch), requires literal confirm:true, and is audit-logged; import and rollback both write AuditLog entries.
- Required seed preconditions: factory '"CAOLS KS" MCHJ' and the 7 named cashboxes (Naqd kassa, Bank (Септем Алока), Bank (Септем семент), Click, Terminal, Karta, Valyuta (USD)) must exist or import aborts.

### API

- POST /import/excel?dryRun=true|1 — upload the .xlsx (multipart field 'file', ≤20MB, ADMIN); parses, self-validates, writes everything in one transaction; dryRun rolls back and returns {stats}, real run returns {batchId, stats}
- GET /import/batches — list import batches with creator and per-relation row counts (orders, payments, ledgerEntries, palletTransactions, cashTransactions, expenses) (ADMIN)
- GET /import/batches/:id/reconciliation — expected-vs-actual comparison: per-client balances/pallets with sheetGaps + explainedByWorkbookDefect classification, factory balance, flagged (reconciled:false) payments, summary (ADMIN)
- DELETE /import/batches/:id — rollback: hard-delete all rows of the batch in FK-safe order; body must be {"confirm": true} (ADMIN)

---

## Auth / Roles / Users / Settings (SmartBlok ERP)

SmartBlok is an Uzbek-language (Latin script) ERP for a gas-block (gazoblok) trading business, built on NestJS + Prisma + PostgreSQL (API) and React + Ant Design + TanStack Query (web). The auth domain implements username+password login (no email login, no self-registration, no password reset) issuing a 7-day JWT. Security is layered: a global JwtAuthGuard (every route needs a token unless @Public), a global RolesGuard that is DEFAULT-DENY (a route with no @Roles annotation is ADMIN-only and logged as a warning), and per-request DB revalidation in JwtStrategy — the user must still exist, be active, and have a matching tokenVersion, so blocking a user, changing their role, or changing a password kills all live sessions instantly. Login is throttled to 5 attempts/min per IP and compares against a dummy bcrypt hash for unknown usernames to defeat timing-based user enumeration. NOTE: docs/03-rollar-va-xavfsizlik.md describes the older v2 system and is stale in several places (it claims no global guard, hard deletes, min password 4, no DB revalidation) — the v3 code is authoritative and fixes all of those.

There are exactly 4 roles (a real Prisma enum): ADMIN (full control, sole manager of users, settings, Excel import, and most deletes), ACCOUNTANT (Buxgalter — full sales/catalog/finance/reports but no users, no settings writes, no import), AGENT (a field sales rep bound to an Agent record via User.agentId; sees only own clients/orders/payments/debts/pallets through automatic agentId scoping; JWT carries agentId), and CASHIER (Kassir — payments, expenses, cashboxes only). Page access is enforced twice: frontend route guards (RequireRole renders a 403 Result screen) and backend @Roles on every endpoint. User management is ADMIN-only CRUD with strong invariants: AGENT users must be linked to an existing Agent; username is unique 3–32 Latin alphanumerics; delete is soft-only (active=false + session invalidation); you cannot deactivate yourself or the last active ADMIN; every mutation is audit-logged with the password masked. Any logged-in user can self-edit name/username/email/phone/password via PUT /auth/me but never role/agentId (no privilege escalation path).

Settings is a tiny but business-critical module: exactly 4 whitelisted keys stored in an AppSetting JSON table, each with server-side validation and before/after audit logging. agentDebtLimitDefault (null = unlimited, 0 = block all new credit orders) is the default ceiling on the sum of an agent's clients' open debt, checked at order creation, overridable per-agent via Agent.debtLimit; truckCapacityPallets (1–40, default 19) is the default truck capacity used by procurement routes and order logistics; palletPriceDefault (>0, code fallback 130,000 so'm) seeds pallet pricing on new orders; saleMarginMinPct (0–100) is validated and stored but I found no consumer in business code — it appears to be a not-yet-enforced no-op that should be confirmed with the owner before the redesign. The entire UI is in Uzbek (Latin script) with some Russian loanwords ('paddon' for pallet, 'Kassir'); role labels are inconsistently translated across files ('Buxgalter' vs 'Hisobchi', raw 'ADMIN' in the header).

### Entities

- **User** — A login account. Carries role, optional binding to an Agent record (agentId, mandatory when role=AGENT — this drives data scoping), active flag (soft-delete/block), and tokenVersion (bumped to invalidate all existing JWTs). Password is a bcrypt hash (12 rounds) and is never selected by any query.
  - Fields: id (uuid); username (unique, 3–32 Latin alphanumeric); password (bcrypt hash, never returned); name; role (enum, default AGENT); email (unique, optional); phone (optional); active (default true); tokenVersion (int, session-kill counter); agentId -> Agent (required for AGENT role); lastLoginAt; createdAt/updatedAt
  - States: active=true (Faol) | active=false (Bloklangan — cannot log in, sessions invalidated)
- **Role (Prisma enum)** — The 4 fixed roles: ADMIN, ACCOUNTANT, AGENT, CASHIER. Enforced at DB level as a real enum (v3; v2 was a plain string).
  - Fields: ADMIN; ACCOUNTANT; AGENT; CASHIER
- **AppSetting** — Key→JSON value store for the 4 global business parameters. Writes only via whitelisted, per-key-validated SettingsAdminService; every change audit-logged with before/after and updatedBy.
  - Fields: key (agentDebtLimitDefault | truckCapacityPallets | saleMarginMinPct | palletPriceDefault); value (JSON: number or null); updatedBy (userId)
- **AuditLog** — Immutable trail of user CRUD and settings changes (and other domain mutations). For users, snapshots contain identity fields only with password always '***'. No UI viewer exists for it.
  - Fields: at; userId (actor); action (CREATE/UPDATE/DELETE); entity ('User' | 'AppSetting' | ...); entityId; before/after (JSON); note
- **JWT session (implicit)** — Stateless token, default 7d expiry, payload {sub, username, role, name, agentId, tv}. Revalidated against DB on EVERY request: user must exist, be active, and tv must equal current tokenVersion — so revocation is instant despite statelessness.
  - Fields: sub (user id); role; agentId (drives AGENT scoping); tv (tokenVersion)
  - States: valid | revoked (tokenVersion bumped: password change, role change, deactivation) | expired (7d)

### Workflows

- **Login** (ADMIN, ACCOUNTANT, AGENT, CASHIER; many times/day)
  1. Open /login (centered card, SmartBlok brand)
  1. Enter username + password (Uzbek labels: Login / Parol)
  1. POST /api/auth/login (throttled 5/min/IP); unknown user and wrong password return identical error 'Login yoki parol xato'; blocked account returns 403 'Hisob bloklangan'
  1. On success token+user stored in localStorage (sb_token/sb_user), lastLoginAt stamped, redirect to dashboard '/'
  1. On app boot the stored session is re-validated via GET /auth/me; any 401 clears storage and redirects to /login
- **Create a user account** (ADMIN; rare)
  1. ADMIN opens Boshqaruv > Foydalanuvchilar (/users)
  1. Click 'Yangi foydalanuvchi' (top-right of card) → modal form opens with role pre-set to AGENT
  1. Fill username (3–32 Latin alphanumeric), full name, role; if role=AGENT a searchable Agent select appears and is mandatory
  1. Set password (min 8), optional email/phone
  1. Save → POST /api/users; server checks agent exists, username/email uniqueness; creates in a transaction with an audit log entry (password masked)
- **Edit user / reset password / change role** (ADMIN; rare)
  1. ADMIN clicks the edit icon on a row in /users → same modal pre-filled
  1. Optionally type a new password (leaving it blank keeps the old one; a hint explains a change kills the user's sessions)
  1. Optionally change role (AGENT still requires agent binding; demoting the last active ADMIN is rejected)
  1. Save → PUT /api/users/:id; tokenVersion is bumped (sessions killed) if password changed, role changed, or account deactivated; audit-logged with before/after
- **Block (deactivate) a user** (ADMIN; rare)
  1. ADMIN clicks the red stop icon on an active row (hidden for own account)
  1. Confirm dialog explains: account is blocked, all sessions revoked immediately, record is NOT deleted and can be re-enabled
  1. DELETE /api/users/:id → soft-delete only (active=false + tokenVersion bump); guards: cannot block self, cannot block the last active ADMIN; audit-logged as DELETE with note 'deaktivatsiya (soft delete)'
- **Reactivate a user** (ADMIN; rare)
  1. ADMIN opens the edit modal for a blocked user (no dedicated button — hidden flow)
  1. Toggle the 'Faol' switch on
  1. Save → PUT /api/users/:id with active=true
- **Self-service profile update** (ADMIN, ACCOUNTANT, AGENT, CASHIER; rare)
  1. Any user opens avatar dropdown → Profil (/profile)
  1. Left card: edit name/username/phone (email is NOT editable in the UI although the API supports it) → PUT /api/auth/me
  1. Right card: enter new password twice → PUT /api/auth/me; server bumps tokenVersion and returns a fresh accessToken which the client adopts, then shows an info modal: all other device sessions were ended, this one stays
- **Change global business settings** (ADMIN (write), ACCOUNTANT (API read only — but has no page for it); rare (weekly at most))
  1. ADMIN opens Boshqaruv > Tizim sozlamalari (/settings)
  1. Single form: 'Cheklanmagan' switch or default agent debt limit (so'm, space-grouped thousands), truck capacity in pallets (1–40), minimum sale margin %, default pallet price
  1. Click Saqlash → only CHANGED keys are written, one PUT /api/settings/:key per key (sequential; partial failure possible, UI resyncs)
  1. Each key is validated server-side against a whitelist and audit-logged with before/after

### Roles

- **ADMIN (Administrator)**: Everything. PAGES (frontend route guards in App.tsx): all 23 routes including the two ADMIN-only ones — /users and /settings. ACTIONS (backend @Roles): sole role for Users CRUD (GET/POST/PUT/DELETE /users — delete is soft-deactivate), settings writes (PUT /settings/:key), ALL of Excel import (/import/excel, batches, reconciliation, batch delete), agent hard-delete (DELETE /agents/:id), client delete (DELETE /clients/:id). Shares with ACCOUNTANT: everything financial/catalog (see ACCOUNTANT). Also implicitly the only role allowed on any route someone forgot to annotate (default-deny guard). Nav shows extra 'Boshqaruv' group (Foydalanuvchilar, Tizim sozlamalari).
- **ACCOUNTANT (Buxgalter; also labeled 'Hisobchi' in Profile — inconsistent)**: Finance + catalog + reports, NO user management, NO settings writes, NO import (despite the UI showing it — see painPoints). PAGES: /, /orders(+new/:id), /clients(+:id), /agents(+:id), /factories(+:id), /products, /vehicles, /regions, /legal-entities, /procurement, /payments, /debts, /pallets, /bonus, /expenses, /kassa, /reports, /import (route allowed but ALL import APIs 403), /profile. ACTIONS: orders create + edit (PUT) + per-item price patch + delete/cancel (there is no status lifecycle to drive since 2026-07-22); payments create + allocations + void; kassa manual transactions + reversal; expenses create/void + category CRUD; pallets returns/charge-lost; bonus wallets withdraw/offset/reverse; clients create/update + aliases + client prices; agents create/update (not delete); factories/products/vehicles/regions/legal-entities CRUD (no agent/client hard-deletes); procurement matrix + routes; reports svod + orders-register (+xlsx exports); dashboard summary/trends/agents-ranking/kassa; GET /settings (read-only, no UI page for it). Cannot touch /users (403).
- **AGENT (field sales agent, bound to one Agent record via agentId)**: Sales workspace scoped to own agent only — every list query is filtered by user.agentId server-side. PAGES: / (dashboard), /orders(+new/:id), /clients(+:id), /agents/:id (own agent detail), /payments, /debts, /pallets, /profile. Blocked pages: /agents list, catalog, /bonus, /expenses, /kassa, /reports, /import, /users, /settings (403 screen). ACTIONS: GET/POST orders, order comments — but NOT order edit (PUT), NOT price patch, NOT delete, and NO status stepping (the status workflow was removed 2026-07-22); clients GET/POST/PUT (created clients force-bound to own agentId), no delete, no aliases/prices; payments GET/POST (agentId forced to own); debts /clients + /statement (not /summary); pallets balances + transactions (read; no return/charge actions); GET /agents/me (own record) and GET /agents/:id; read-only reference lists: factories, products, vehicles, regions, procurement matrix is FIN-only in v3 (403); dashboard summary + trends (scoped). No settings access at all.
- **CASHIER (Kassir)**: Treasury only. PAGES: / (dashboard — kassa panel), /payments, /expenses, /kassa, /profile. Blocked: orders, clients, agents, debts, pallets, bonus, entire catalog, reports, import, users, settings. ACTIONS: payments GET/GET:id/POST (no allocations, no void); expenses GET/categories/POST (no void, no category management); kassa cashboxes/transactions/manual/summary (no reversal); legal-entities GET (read-only, needed for payment forms); dashboard /kassa endpoint only (no summary/trends/ranking). Cannot see or manage any users; no settings.

### Current UI

Pages: /login — Login.tsx (public), /users — Users.tsx (ADMIN only), /settings — Settings.tsx (ADMIN only), /profile — Profile.tsx (all roles, via avatar dropdown), AppShell.tsx — dark sider navigation + header (hosts role-filtered menu, theme toggle, Ctrl+K palette, avatar dropdown), RequireRole.tsx — full-page Ant Design 403 Result screen shown on role mismatch

LOGIN: full-viewport centered 380px AntD Card on the layout background; 'SmartBlok' title in primary color + tagline 'Gazoblok biznesini bitta tizimda boshqaring'; vertical form with two large fields (Login with user icon, Parol with lock icon) and a full-width 'Kirish' primary button; no demo-account buttons, no forgot-password, no language switcher. APP SHELL (all authed pages): collapsible dark Sider 232px with brick emoji + 'SmartBlok' logo and a role-filtered inline Menu — 9 flat items (Boshqaruv paneli, Buyurtmalar, Mijozlar, To'lovlar, Qarzlar, Paddonlar, Kassa, Xarajatlar, Bonus hamyonlar) plus two collapsible groups: 'Katalog' (Zavodlar, Mahsulotlar, Moshinalar, Agentlar, Hududlar, Yuridik shaxslar) and ADMIN-only 'Boshqaruv' (Foydalanuvchilar, Tizim sozlamalari), plus Hisobotlar/Excel import/Ta'minot matritsasi; 52px light header with 'Ctrl+K — tez qidiruv' hint on the left, dark-mode Switch, and an avatar dropdown (initial letter avatar, bold name, RAW role code like 'ADMIN' untranslated) opening Profil / Chiqish; content area padded 20px. USERS (/users): one full-width Card titled 'Foydalanuvchilar' with a primary '+ Yangi foydalanuvchi' button in the card's extra slot; inside, a horizontally-scrollable AntD Table (default 20/page, size changer) with columns Login, Ism, Rol (colored Tag: magenta/blue/green/gold), Agent (linked agent name or —), Telefon, Holat (green 'Faol' / red 'Bloklangan' Tag), Oxirgi kirish (datetime), Amallar (two small icon-only buttons: edit pencil; red stop icon shown only for active rows that aren't yourself). No search box, no column filters, no email column. Create and edit share ONE Modal with a vertical Form: Login, Ism, Rol Select, conditional searchable Agent Select (only when role=AGENT, with helper text), Parol (contextual label + helper: blank keeps old, changing kills sessions), Email, Telefon, and edit-only 'Faol' Switch (disabled for self). Deactivation uses modal.confirm with a danger button and a full explanation sentence. Errors show as a full-card Alert with a retry button; toasts via App.message. SETTINGS (/settings): a single Card 'Tizim sozlamalari' containing an info Alert ('only changed keys are saved; every change is audit-logged') and one vertical Form capped at 560px: section heading 'Agent qarz chegarasi' → 'Cheklanmagan' Switch, conditional 'Standart qarz chegarasi (so'm)' InputNumber with space-grouped thousands formatter and long helper text explaining 0-blocks-orders and per-agent override; Divider; 'Fura sig'imi (paddon)' integer InputNumber 1–40 with helper; 'Minimal sotish ustamasi (%)' InputNumber 0–100 step 0.1 with helper; 'Paddonning standart narxi (so'm)' InputNumber with custom >0 validator; single 'Saqlash' primary button at the bottom. Full-card Spin while loading; form remounts via JSON key when server data changes. PROFILE (/profile): max-width 960px, Typography title 'Profil', responsive 2-column Row (stacks on mobile): LEFT Card 'Shaxsiy ma'lumotlar' = read-only Descriptions list (Ism, Login, Rol as blue Tag, Telefon) followed immediately by an edit Form repeating name/login/phone with a Saqlash button (email not editable here at all); RIGHT Card 'Parolni o'zgartirish' = new password + confirm fields, a small grey caution paragraph, 'Parolni yangilash' button; after a password change a modal.info explains other-device sessions ended. 403 SCREEN: bare AntD Result status=403 with Uzbek subtitle 'Bu sahifaga kirish huquqingiz yo'q' and no navigation action.

### Pain points

- [high] Permission drift between UI and API for Excel import: the nav shows 'Excel import' to ACCOUNTANT and the /import route guard allows ACCOUNTANT, but every /api/import endpoint is @Roles('ADMIN') — an accountant opens the page and every request fails with 403.
  - Suggestion: Derive page visibility and route guards from a single shared permission map (role → capability) used by both nav and routes, and align it with backend @Roles; decide with the owner whether ACCOUNTANT should get import (docs v2 said yes, v3 backend says no).
- [medium] Role naming is inconsistent and duplicated across at least 3 files: Users.tsx labels ACCOUNTANT 'Buxgalter', Profile.tsx labels it 'Hisobchi', and the header avatar shows the raw enum string 'ADMIN'/'CASHIER' untranslated.
  - Suggestion: One shared ROLE constant (label + color) consumed everywhere; always show the localized label, never the enum code.
- [medium] Users table has no search, no filters (role/status/agent), and no email column — email is captured in the form but never displayed anywhere. Finding one user in a long list means manual pagination; auditing 'which logins exist for agent X' is impossible without opening each row.
  - Suggestion: Add text search + role/status filter chips and show email; consider default-sorting blocked users to the bottom or a separate 'Bloklangan' tab.
- [medium] Reactivating a blocked user is a hidden flow: the row shows a one-click 'block' button, but unblocking requires opening the edit modal, finding the 'Faol' switch, toggling it, and saving (3–4 clicks, undiscoverable).
  - Suggestion: Symmetric row-level action: show a 'Faollashtirish' button on blocked rows mirroring the block button.
- [medium] Profile page duplicates the same data twice on one card: a read-only Descriptions block (Ism/Login/Telefon) sits directly above an edit form with identical fields — redundant and confusing about which is current. Meanwhile email is editable via the API (PUT /auth/me) but absent from the Profile UI entirely.
  - Suggestion: Single editable view (or view-with-edit-toggle); add the email field.
- [medium] Settings save fires one sequential PUT per changed key, so a validation failure mid-batch leaves a partial write; the UI only shows a generic error and silently resyncs — the user can't tell which keys saved and which didn't.
  - Suggestion: Either a batch endpoint (single transaction) or per-field save state with inline success/error per key.
- [medium] ACCOUNTANT can read GET /api/settings but has no page for it (/settings route is ADMIN-only), so the business parameters that directly constrain their daily work (debt limit, min margin, pallet price) are invisible to them in the UI.
  - Suggestion: Read-only settings view for ACCOUNTANT, or surface the effective values contextually (e.g., in the order form).
- [medium] saleMarginMinPct is prominently editable in Settings with helper text promising it 'protects against lump-sum entry errors', but no business code consumes it — the setting appears to be a no-op, which silently betrays the admin's expectation.
  - Suggestion: Verify with the owner; either wire the enforcement into order pricing or remove/disable the field until it does something.
- [medium] Password policy is inconsistent: admin-created/updated users require min 8 chars (users/dto.ts), the Profile UI enforces min 8, but the backend UpdateProfileDto only requires @MinLength(4) — the API accepts a 4-char password for self-service changes.
  - Suggestion: Unify at min 8 server-side in UpdateProfileDto.
- [low] Profile username change does not pre-check uniqueness (unlike admin user update), so renaming to a taken username surfaces as a raw Prisma unique-constraint error (unhandled 500) instead of a friendly 'username band' message.
  - Suggestion: Add the same duplicate check + ConflictException used in UsersService.update.
- [low] Everything in this domain is meticulously audit-logged (user CRUD with masked passwords, settings before/after), yet there is no audit-log viewer anywhere in the UI — the trail is write-only.
  - Suggestion: Add an ADMIN audit page (filter by entity/user/date) — the data model already supports it.
- [low] The 403 screen (RequireRole) is a dead end: a bare Result with no button back to the dashboard, reached e.g. when an AGENT pastes a catalog URL.
  - Suggestion: Add a 'Bosh sahifaga qaytish' action button.
- [low] docs/03-rollar-va-xavfsizlik.md documents the v2 system and contradicts the v3 code on major points (claims no global guards, hard deletes, JWT not revalidated, min password 4, demo-account buttons on Login) — dangerous as a redesign reference.
  - Suggestion: Treat code as the source of truth; refresh the doc before the redesign.

### LOCKED RULES

- Exactly 4 roles as a Prisma enum: ADMIN, ACCOUNTANT, AGENT, CASHIER (User.role defaults to AGENT).
- RBAC is default-deny: JwtAuthGuard + RolesGuard are global APP_GUARDs; a route without @Roles() is ADMIN-only (and logged); only @Public bypasses auth (login only).
- Login is username+password only; unknown username and wrong password must return the identical message ('Login yoki parol xato') with constant-time dummy-hash compare (anti user-enumeration); blocked account returns 403 'Hisob bloklangan'; login throttled 5 attempts/min per IP; lastLoginAt stamped on success.
- JWT (default 7d, payload sub/username/role/name/agentId/tv) is revalidated against the DB on EVERY request: user must exist, be active, and tokenVersion must match — revocation is instant.
- tokenVersion MUST be bumped (killing all sessions) on: any password change (self or admin), role change, deactivation. Self password change returns a fresh token so the current session survives.
- Users CRUD is ADMIN-only. Deletion is soft-only: DELETE /users/:id sets active=false + bumps tokenVersion; never a hard delete; deactivating an already-inactive user is a no-op.
- An ADMIN cannot deactivate their own account, and cannot deactivate or demote the LAST active ADMIN (assertNotLastAdmin).
- role=AGENT requires a valid agentId referencing an existing Agent (on create and on update, considering the effective value); non-AGENT roles may have agentId null.
- AGENT data scoping: an AGENT user's queries for clients/orders/payments/debts/pallets are filtered to their own agentId; AGENT-created clients and payments are force-bound to their agentId; AGENT cannot edit orders (PUT), patch item prices, delete anything, allocate/void payments, or access kassa/expenses/bonus/reports/import/users/settings.
- Username: unique, 3–32 chars, Latin letters and digits only (^[a-zA-Z0-9]+$). Email: optional but unique. Admin-set passwords: min 8 / max 128, bcrypt with 12 rounds. Password hash is NEVER selected or returned by any endpoint; audit snapshots always mask it as '***'.
- Self-service profile (PUT /auth/me) can change name/username/email/phone/password ONLY — never role or agentId (no privilege-escalation path).
- Settings writes are ADMIN-only and strictly whitelisted to 4 keys with per-key validation: agentDebtLimitDefault (>= 0 or null; null = unlimited, 0 = new credit orders blocked; per-agent Agent.debtLimit overrides it; enforced at order creation), truckCapacityPallets (integer 1–40; default 19; used when a vehicle/route has no own capacity), saleMarginMinPct (0–100, 2dp), palletPriceDefault (> 0; orders fall back to 130,000 so'm if unset). Unknown keys are rejected.
- Every user mutation and every settings change is audit-logged (actor, action, entity, before/after JSON) inside the same transaction as the write.
- GET /settings is readable by ADMIN and ACCOUNTANT (business may rely on accountant read access even though the current UI hides it).

### API

- POST /api/auth/login — public, throttled 5/min/IP; returns {accessToken, user{id,username,name,role,agentId}}
- GET /api/auth/me — all 4 roles; current user (safe select, incl. phone/email/active)
- PUT /api/auth/me — all 4 roles; self-update name/username/email/phone/password (password change bumps tokenVersion and returns a fresh token)
- GET /api/users — ADMIN; full user list (safe select + agent{id,name}, lastLoginAt), ordered by createdAt
- GET /api/users/:id — ADMIN; single user
- POST /api/users — ADMIN; create user (agent binding required for AGENT role; uniqueness checks; audit-logged)
- PUT /api/users/:id — ADMIN; update user (self-block forbidden; last-admin protection; session-kill on password/role/active changes; audit-logged)
- DELETE /api/users/:id — ADMIN; SOFT delete: active=false + session invalidation (audit-logged)
- GET /api/settings — ADMIN, ACCOUNTANT; all settings merged over defaults
- PUT /api/settings/:key — ADMIN; whitelisted keys only (agentDebtLimitDefault, truckCapacityPallets, saleMarginMinPct, palletPriceDefault), validated per key, audit-logged with before/after

---

## Dashboard / KPI (SmartBlok ERP — gas-block wholesale dealer, Uzbekistan)

The dashboard is the landing page ('/') of SmartBlok, an ERP for a gas-block (gazoblok) wholesale dealer. It is a pure read-model: every number is a SQL aggregate computed on demand over the underlying financial tables (Order, OrderItem, Payment, LedgerEntry, PalletTransaction, CashTransaction, BonusTransaction, Cashbox) — nothing is precomputed or stored. Debt figures come from an immutable double-entry-style ledger (LedgerService): a party balance is always SUM(LedgerEntry.amount) with the sign convention >0 = they owe the dealer, <0 = the dealer owes them; the dashboard sums only positive client balances into 'clients owe us' (advances never offset other clients' debts) and only negative factory/vehicle balances (negated) into 'we owe' figures. All time windows (today / this month / this year / daily trend buckets) are Asia/Tashkent calendar units (fixed UTC+5, no DST) converted to UTC instants for querying; trend bucketing happens in Postgres via date_trunc AT TIME ZONE and is zero-filled client-side of the API so charts get a continuous series.

There are four endpoints with strict role guards. GET /dashboard/summary returns 14 KPIs: today/month/year sales (non-cancelled orders' saleTotal), orders in flight (CONFIRMED/LOADING/DELIVERING count), clients-owe-us, we-owe-factories, we-owe-vehicles, collected-this-month (non-voided CLIENT_IN payments), goods profit for the month (saleTotal − costTotal), transport profit for the month (transportCharge − transportCost, tracked separately per the owner's transport rules), bonus wallet total, pallets currently at clients (signed pallet-transaction formula), cubic meters sold this month, and expectedCollections (currently a literal duplicate of clientsOweUs). GET /dashboard/trends?days=N (1–365, default 30) returns per-day sales, order count, and collected payments. GET /dashboard/agents-ranking?month=YYYY-MM ranks agents by sales with goods profit, collected, current outstanding client debt, and order count. GET /dashboard/kassa returns per-cashbox all-time balance (ΣIN − ΣOUT) plus today's in/out flows.

Role behavior: ADMIN and ACCOUNTANT see company-wide numbers, the 30-day two-series line chart (sales vs collected), and the agents ranking table. AGENT hits the same summary/trends routes but the service scopes everything to their own agentId (own orders, own clients' payments/debts/pallets) and zeroes out company liabilities (factory/vehicle debts, bonus wallets); the ranking endpoint returns 403 for agents and its two KPI cards are hidden in the UI. CASHIER gets a completely different page — only the kassa view: one card per active cashbox with balance and today's in/out. Realtime: one socket.io connection per session, JWT-authenticated into rooms (role:ADMIN/ACCOUNTANT/CASHIER/AGENT plus agent:<id>); a global NestJS interceptor broadcasts a thin {entity, action, id} event after every successful non-GET on the seven financial controllers (post-commit, amounts never travel over the socket); the web client maps each entity to react-query key families and invalidates them, so the dashboard refetches automatically on any order/payment/kassa/expense/bonus/pallet write. Query defaults: staleTime 30s, no refetch-on-focus, retry 1.

UI language: page labels, KPI titles, chart series, tooltips, and error messages are all Uzbek in Latin script ("Boshqaruv paneli", "Bugungi savdo", "Mijozlar qarzi", "Kassa paneli"), consistent with the Uzbek docs. However the AntD ConfigProvider locale is ru_RU and dayjs is set to 'ru', so component built-ins (pagination, pickers, empty states) render in Russian, and numbers use ru-RU formatting (space thousands separator, comma decimals). Money is UZS, abbreviated on cards via fmtShort ("1.2 mlrd", "3.4 mln", "560 ming") with the exact so'm value only in a hover tooltip. Any redesign must keep the Uzbek-first labeling and preferably resolve the mixed ru/uz locale.

### Entities

- **DashboardSummary (read model)** — The 14-KPI aggregate returned by GET /dashboard/summary; computed live from orders, payments, ledger, pallets, and bonus tables — never stored.
  - Fields: scope ('agent'|'global'); todaySales / monthSales / yearSales (Σ saleTotal, non-cancelled, Tashkent windows); ordersInFlight (count of CONFIRMED|LOADING|DELIVERING); clientsOweUs (Σ positive client ledger balances); weOweFactories / weOweVehicles (Σ negative balances, negated; 0 for AGENT); collectedThisMonth (Σ non-voided CLIENT_IN payments); goodsProfitMonth (monthSale − monthCost); transportProfitMonth (Σ transportCharge − transportCost); bonusWallets (Σ bonusTransaction.amount; 0 for AGENT); palletsAtClients (signed pallet-transaction sum); cubeSoldMonth (Σ orderItem.quantityM3, 3 decimals); expectedCollections (currently identical to clientsOweUs)
- **TrendPoint (read model)** — One zero-filled daily bucket from GET /dashboard/trends; bucketing done in Postgres in Asia/Tashkent local days.
  - Fields: date (YYYY-MM-DD, Tashkent-local); sales (Σ saleTotal of non-cancelled orders); orders (count); collected (Σ non-voided CLIENT_IN payments)
- **AgentRankingRow (read model)** — Per-agent monthly performance row from GET /dashboard/agents-ranking, sorted by sales desc; every agent appears even with zero activity.
  - Fields: agentId, agent (name); sales (Σ saleTotal in month); goodsProfit (sales − cost); collected (Σ CLIENT_IN in month, attributed via payment.agentId); outstandingDebt (Σ positive client balances per agent, as-of-now, one grouped SQL); orders (count)
- **KassaBoxSnapshot (read model)** — Per-cashbox card data from GET /dashboard/kassa for the cashier panel; only active cashboxes, ordered by name.
  - Fields: cashboxId, name, type, currency; balance (all-time ΣIN − ΣOUT of CashTransaction); todayIn / todayOut (Tashkent-local today)
- **LedgerEntry (source of truth for debts)** — Immutable signed posting; the single write-path for all balance changes. Dashboard debt KPIs are sums over it. Corrections are compensating reversal entries (reversalOfId), never edits; reversals carry the original business date.
  - Fields: account (CLIENT|FACTORY|VEHICLE); amount (signed Decimal: >0 party owes dealer); clientId/factoryId/vehicleId (exactly one, matching account); date (business date) vs at (posting time); orderId, paymentId, reversalOfId
- **Order (KPI source)** — Sales/profit/volume source. Soft-cancelled orders (status CANCELLED + ledger reversals) are excluded from every dashboard aggregate.
  - Fields: saleTotal, costTotal (goods profit); transportCharge, transportCost (separate transport profit); date, status, agentId
  - States: NEW | CONFIRMED | LOADING | DELIVERING | DELIVERED | COMPLETED | CANCELLED
- **PalletTransaction (KPI source)** — Pallets ('paddon') held at clients, an in-kind liability. Dashboard balance = Σ DELIVERED_TO_CLIENT − RETURNED_BY_CLIENT − CHARGED_LOST + signed ADJUSTMENT/REVERSAL; factory-side rows (RECEIVED_FROM_FACTORY, RETURNED_TO_FACTORY) carry no clientId and count 0.
  - Fields: type; qty (signed for ADJ/REV); clientId
  - States: DELIVERED_TO_CLIENT | RETURNED_BY_CLIENT | CHARGED_LOST | ADJUSTMENT | REVERSAL | RECEIVED_FROM_FACTORY | RETURNED_TO_FACTORY
- **Payment (KPI source)** — Collections KPI counts only kind=CLIENT_IN with voidedAt IS NULL; agent scoping via client.agentId (summary) or payment.agentId (ranking).
  - Fields: kind; amount; date; voidedAt; clientId; agentId
  - States: CLIENT_IN | CLIENT_REFUND | FACTORY_OUT | FACTORY_REFUND | VEHICLE_OUT | TRANSPORT_DIRECT

### Workflows

- **Morning/continuous business health check** (ADMIN, ACCOUNTANT; many times/day)
  1. Log in → land on '/' (Boshqaruv paneli)
  1. Scan 12 KPI cards (sales today/month/year, collected, goods & transport profit, client debt, factory debt, bonus wallets, expected collections, pallets at clients, m³ sold)
  1. Hover a money card to read the exact so'm value (cards show abbreviated 'mln/mlrd')
  1. Read the 30-day line chart (Savdo vs Yig'ilgan to'lov)
  1. Review the Agentlar reytingi table (current month, sorted by sales)
  1. Navigate via sidebar or Ctrl+K palette to drill into Orders/Debts/Kassa — KPI cards themselves are not clickable
- **Agent self-monitoring** (AGENT; daily)
  1. Agent logs in → same '/' page, automatically scoped to own agentId by the API
  1. Sees own sales/collections/debt/pallets/volume KPIs; factory-debt and bonus-wallet cards are hidden (server returns 0, UI omits them)
  1. Views own 30-day sales/collections trend
  1. No ranking table (endpoint 403s for agents; query disabled in UI)
- **Cashier shift monitoring** (CASHIER; many times/day (kept open during shift))
  1. Cashier logs in → '/' renders the dedicated Kassa paneli instead of the executive dashboard
  1. One card per active cashbox: balance (Qoldiq) with currency, today's inflow (Bugun kirim, green ↑) and outflow (Bugun chiqim, red ↓)
  1. Cards refresh automatically when payments/expenses/kassa ops are posted anywhere (socket event → query invalidation)
  1. For transaction detail the cashier must leave the dashboard and open /kassa or /payments
- **Monthly agent performance review** (ADMIN, ACCOUNTANT; weekly/monthly)
  1. Open '/' → Agentlar reytingi card shows the current Tashkent-calendar month (label in card corner)
  1. Compare sales, goods profit, collected, current outstanding debt, order count per agent
  1. API supports any past month via ?month=YYYY-MM, but the UI offers no month picker — past months are unreachable without crafting the URL manually
  1. outstandingDebt column is as-of-now, not as-of-month-end (mixes time frames with the monthly columns)
- **Passive realtime refresh (system workflow)** (system (all roles as recipients); continuous — fires on every financial write company-wide)
  1. Any user performs a write on Orders/Payments/Kassa/Expenses/Bonus/Pallets/Clients controllers
  1. Post-commit, RealtimeInterceptor emits thin {entity, action, id} to role:ADMIN + role:ACCOUNTANT rooms (plus role:CASHIER for kassa-affecting entities, plus agent:<id> when the mutation result exposes agentId)
  1. Web client's useRealtime maps entity → query-key families (order/payment/kassa/expense/bonus/pallet all include 'dashboard') and invalidates them
  1. Active dashboard queries refetch; KPI cards/chart/table update without user action; a static green '● LIVE' tag advertises this

### Roles

- **ADMIN**: Full executive dashboard: global /summary, /trends, /agents-ranking; may also call /dashboard/kassa (UI shows it only to CASHIER — admins use the /kassa page instead). Sees all 12 KPI cards including factory debt and bonus wallets.
- **ACCOUNTANT**: Identical to ADMIN for this domain: global summary, trends, agents ranking, and kassa endpoint access.
- **AGENT**: Same /summary and /trends routes but server-scoped to own agentId (own orders, own clients' payments/debts/pallets). Company liabilities are hidden: weOweFactories/weOweVehicles/bonusWallets return 0 and their cards are not rendered. /agents-ranking and /dashboard/kassa are 403. Realtime events reach the agent's room only when the mutation result carries their agentId.
- **CASHIER**: Only GET /dashboard/kassa. UI replaces the whole dashboard with the Kassa paneli (per-cashbox balance + today in/out). Receives realtime events only for kassa-affecting entities (payments, kassa ops, expenses, bonus).

### Current UI

Pages: / — Dashboard.tsx, variant MainDashboard (ADMIN/ACCOUNTANT/AGENT): KPI card grid + 30-day line chart + agents ranking table, / — Dashboard.tsx, variant KassaDashboard (CASHIER): per-cashbox stat cards only

The page lives inside AppShell: a dark collapsible left sider (232px) with Uzbek nav labels and a 52px header (theme toggle, 'Ctrl+K — tez qidiruv' hint, user avatar dropdown); content area has 20px padding. MainDashboard: a title row — 'Boshqaruv paneli' (level-4 heading) left, a static green '● LIVE' tag with tooltip right. Below it a responsive AntD Row/Col grid of small Statistic cards (12px gutters): 2 per row on phones (xs=12), 3 on md, 4 on xl, 6 on xxl — 12 cards for admins/accountants (2 rows at xxl), 10 for agents. Card order: Bugungi savdo, Oy savdosi, Yil savdosi, Oyda yig'ilgan to'lov, Mahsulot foydasi (oy) [green/red by sign], Transport foydasi (oy) [green/red], Mijozlar qarzi, Zavodlarga qarzimiz [hidden for agents], Bonus hamyonlar [hidden for agents], Kutilayotgan tushum, Mijozlardagi paddonlar [count], Sotilgan hajm (oy) [m³]. Money values are abbreviated via fmtShort ('1.2 mlrd', '3.4 mln', '560 ming'); the exact so'm figure appears only in a hover Tooltip. Cards are static — no links, no deltas, no sparklines. Next, a full-width Card 'So'nggi 30 kun: savdo va yig'ilgan to'lovlar' containing a 300px @ant-design/plots Line chart: two series (Savdo, Yig'ilgan to'lov) with theme-aware CVD-safe colors (light: #1f6f9e/#b47a00), legend on top, x labels DD.MM with auto-hide, y labels fmtShort, tooltip shows full formatted UZS per series; dark-mode uses classicDark theme. Last (non-agents only), a Card 'Agentlar reytingi' with the month string (YYYY-MM) in the card corner, containing a small AntD Table without pagination inside a horizontal-scroll wrapper: columns Agent, Savdo, Mahsulot foydasi (signed green/red Money), Yig'ilgan, Qarzdorlik, Buyurtmalar — no sorting UI, no export, no month switcher, rows not clickable. Each of the three data sections has proper loading skeletons and an error Alert with a 'Qayta urinish' retry button. KassaDashboard: 'Kassa paneli' title + same LIVE tag, then a card grid (1–4 per row by breakpoint): each card titled with the cashbox name, a type Tag in the corner, a 'Qoldiq (UZS/USD)' Statistic using the signed Money atom, and two inline mini-statistics 'Bugun kirim' (green up arrow) / 'Bugun chiqim' (red down arrow) in fmtShort. Empty state: 'Faol kassalar topilmadi'. All labels Uzbek (Latin); AntD locale is ru_RU so built-in component texts are Russian; numbers formatted ru-RU.

### Pain points

- [high] No drill-down anywhere: all 12 KPI cards, chart points, and ranking rows are dead ends. Seeing 'Mijozlar qarzi 1.2 mlrd' and acting on it requires finding /debts in the sidebar and re-establishing context manually; agent rows don't link to /agents/:id.
  - Suggestion: Make every KPI card and ranking row a link to its filtered source page (debts, orders in flight, kassa, agent detail); make chart points open that day's orders/payments.
- [medium] Duplicate KPI: 'Kutilayotgan tushum' (expectedCollections) is byte-for-byte the same number as 'Mijozlar qarzi' (clientsOweUs) — dashboard.service.ts:160 returns the same variable. Two of twelve cards show identical values, wasting prime space and eroding trust in the numbers.
  - Suggestion: Drop one card, or make expectedCollections a genuinely different metric (e.g. due-this-week based on payment terms) — a product decision to settle before redesign.
- [high] Computed-but-invisible KPIs: ordersInFlight and weOweVehicles are returned by /summary but never rendered. Vehicle/driver debt is a core liability (the old v2 dashboard showed 'Moshinaga qarz') and orders-in-flight is the single most operational number — both are silently absent.
  - Suggestion: Surface orders-in-flight (linked to a filtered Orders view) and vehicle debt in the redesign, or delete them from the API response.
- [high] Fixed time ranges everywhere: the trends chart is hardcoded to 30 days although the API accepts days=1..365; the agents ranking is locked to the current month although the API accepts ?month=YYYY-MM. Past-period analysis is impossible from the UI.
  - Suggestion: Add a range selector (7/30/90/365 days or date picker) on the chart and a month picker on the ranking card — the backend already supports both with zero changes.
- [medium] Abbreviated money requires hover: cards show '1.2 mlrd / 3.4 mln' and the exact so'm value only lives in a Tooltip — unusable on touch devices and lossy for an accountant comparing figures (1.15 vs 1.24 mlrd both read '1.2 mlrd' at 2 decimals; 3-digit mln precision hides tens of millions).
  - Suggestion: Show full grouped values (tabular numerals handle width) or abbreviate only above a threshold with the full value as a permanent secondary line.
- [medium] Flat, ungrouped KPI wall: 12 visually identical small cards mix sales, profit, liabilities, and logistics with no hierarchy, grouping, deltas, or sparklines; on xxl the reading order (sales → collections → profits → debts → pallets → volume) is an undifferentiated 2×6 grid. No comparison to yesterday/last month anywhere.
  - Suggestion: Group into labeled bands (Savdo / Foyda / Qarzlar / Logistika), promote 2–3 hero metrics, and add period-over-period deltas and mini-sparklines from the trends data already fetched.
- [high] The '● LIVE' tag is decorative: it is a hardcoded green Tag with no connection state. If the socket drops (network blip, server restart) the dashboard silently degrades to 30s-stale cached data while still claiming LIVE. Agents are worst off — their room only receives events when the mutation result happens to expose agentId, and refetchOnWindowFocus is disabled.
  - Suggestion: Bind the tag to actual socket state (connected/reconnecting/offline + last-updated timestamp) and enable refetchOnWindowFocus or a fallback poll as a safety net.
- [medium] Cashier panel is a dead-end summary: per-cashbox balance and today's in/out only — no day history, no recent-transactions list, no grand total across boxes (UZS and USD boxes are never summed anywhere), and no shortcut to record a payment; the cashier must navigate to /kassa or /payments for everything.
  - Suggestion: Add per-currency totals, a today's-operations feed, and quick actions (accept payment, expense) directly on the cashier panel.
- [low] Trend data underused: the API returns per-day order counts, but the chart plots only sales and collected; order volume dynamics are fetched then thrown away. The chart also has no aggregate summary (period total/average) and no way to isolate one series beyond legend toggling.
  - Suggestion: Add order count as a secondary axis/bar layer or a separate mini-chart, plus period totals in the card header.
- [medium] Mixed-language surface: labels are Uzbek (Latin) but the AntD locale is ru_RU and dayjs is 'ru', so pickers, pagination, and empty texts render Russian inside an Uzbek UI, and number formatting is ru-RU. Undocumented and inconsistent for users.
  - Suggestion: Decide the redesign's locale strategy explicitly (uz-Latn primary with proper AntD locale, optional ru toggle) and unify number/date formatting behind it.
- [medium] Refetch storms under load: every entity change maps to broad key invalidation (a single payment invalidates 9 key families for every connected admin/accountant), and each dashboard summary refetch runs ~11 parallel aggregate queries plus two raw-SQL trend scans. With several concurrent writers, open dashboards hammer the API continuously with no debounce/coalescing.
  - Suggestion: Debounce invalidations client-side (e.g. 2–5s coalescing window) and/or have the redesign fetch a single consolidated dashboard payload; keep the per-entity invalidation map but batch bursts.
- [medium] Agents ranking mixes time frames without saying so: sales/collected/orders are for the selected month but 'Qarzdorlik' is the agent's total outstanding debt as of right now — a user naturally reads all columns as monthly. No column tooltips or export either.
  - Suggestion: Label the debt column 'hozirgi qoldiq' (current) or compute as-of-month-end debt; add header tooltips and CSV/print export to the redesigned table.

### LOCKED RULES

- Balances are never stored — always SUM over immutable LedgerEntry postings; sign convention: amount > 0 = party owes the dealer, < 0 = dealer owes the party; corrections only via compensating reversal entries (reverse()) carrying the ORIGINAL business date; one party per posting matching its account (CLIENT/FACTORY/VEHICLE).
- clientsOweUs / expectedCollections = Σ of only POSITIVE per-client balances — one client's prepayment (negative balance) must never offset another client's debt. Same per-agent rule in agents-ranking outstandingDebt and the agent debt-limit gate.
- weOweFactories / weOweVehicles = Σ of only NEGATIVE per-party balances, reported as positive figures.
- CANCELLED orders are excluded from every sales/profit/volume/trend aggregate (soft-cancel: status change + full ledger reversal, records preserved).
- Collections (collectedThisMonth, trend 'collected', ranking 'collected') count ONLY kind=CLIENT_IN payments with voidedAt IS NULL.
- Goods profit = saleTotal − costTotal; net profit = goods profit − transportCost, because transport is priced INSIDE saleTotal in every live mode — see [TRANSPORT MODEL — AUTHORITATIVE](#transport-authoritative). The legacy "transport profit = transportCharge − transportCost" KPI is kept only for historical DEALER_CHARGED rows (transportCharge = 0 for every live mode).
- Orders in flight = status ∈ {CONFIRMED, LOADING, DELIVERING}.
- Pallet balance at clients = Σ DELIVERED_TO_CLIENT − RETURNED_BY_CLIENT − CHARGED_LOST + signed ADJUSTMENT/REVERSAL qty; factory-side rows (RECEIVED_FROM_FACTORY, RETURNED_TO_FACTORY) never count toward client balances (they carry no clientId). Pallets are an in-kind liability.
- All business day/month/year boundaries are Asia/Tashkent calendar units (fixed UTC+5, no DST) while DB timestamps are UTC; trend buckets are Tashkent-local days computed in Postgres (AT TIME ZONE) and zero-filled for the full requested window; agents-ranking months are Tashkent-local [start, end) windows.
- Role scoping is server-side: AGENT gets the same summary/trends shape filtered to own agentId, with company liabilities (weOweFactories, weOweVehicles, bonusWallets) forced to 0; /agents-ranking is ADMIN/ACCOUNTANT only; /dashboard/kassa is ADMIN/ACCOUNTANT/CASHIER only. The UI must not rely on client-side hiding alone.
- Cashbox balance = all-time Σ IN − Σ OUT of its CashTransactions; today's in/out use the Tashkent day window; only active cashboxes are listed.
- Realtime events are emitted only AFTER the transaction commits, carry thin payloads ({entity, action, id} — never amounts/balances over the socket), and are room-scoped: ADMIN+ACCOUNTANT always, CASHIER only for kassa-affecting entities, agents only via their agent:<id> room. Clients react by refetching authorized endpoints.
- Money rounds to 2 decimals (round2), volume to 3 decimals (round3); all money arithmetic is server-side Decimal — the frontend treats amounts as display-only strings.
- Trends days parameter is validated 1–365 (default 30); ranking month must match YYYY-MM.

### API

- GET /dashboard/summary — 14-KPI aggregate (sales today/month/year, in-flight orders, debts, collections, goods+transport profit, bonus wallets, pallets at clients, m³ sold); roles ADMIN/ACCOUNTANT/AGENT, agent-scoped server-side
- GET /dashboard/trends?days=1..365 (default 30) — zero-filled daily buckets {date, sales, orders, collected} in Tashkent-local days; roles ADMIN/ACCOUNTANT/AGENT, agent-scoped
- GET /dashboard/agents-ranking?month=YYYY-MM (default current) — per-agent {sales, goodsProfit, collected, outstandingDebt(as-of-now), orders} sorted by sales desc; roles ADMIN/ACCOUNTANT only
- GET /dashboard/kassa — per-active-cashbox {balance, todayIn, todayOut, type, currency}; roles ADMIN/ACCOUNTANT/CASHIER
- WS socket.io '/' (JWT in handshake auth) — server→client 'change' events {entity, action, id, at}; rooms role:<ROLE> and agent:<agentId>; drives react-query invalidation for dashboard keys

---

## Order lifecycle (SmartBlok ERP — construction-block dealer: orders, statuses, debt recognition, pricing, transport, agent scoping)

SmartBlok is an ERP for a construction-block dealer who buys blocks from factories and resells them to clients, delivered by truck. The Order is the central document: one order = one truck load = one factory (all items must belong to a single factory, enforced server-side). An order is created for a client (whose agent is snapshotted onto the order for historical KPIs), on a business date, with one or more items (product, pallet count and/or explicit m³ volume), an optional vehicle/driver, a transport mode, and an intended factory-payment method (CASH/BANK) that selects the provisional cost price. Creation runs in a single DB transaction with row locks: it resolves prices server-authoritatively from an effective-dated price book (per-client ClientPrice overrides the DEALER_SALE book price; AGENTs may not sell below the FACTORY_BANK floor; negotiated lump sums are stored exactly with a back-solved 6-decimal per-m³ price; ADMIN/ACCOUNTANT may leave an item 'price pending' to be priced later), checks truck pallet capacity (vehicle's or default 19), enforces the client credit limit (null = unlimited) against ledger balance + new exposure (clientChargeable(order)), gates on the agent's aggregate debt limit, assigns a sequential order number (ORD-000001 from a Postgres sequence), and immediately posts ledger entries: client is debited saleTotal (debt recognized AT CREATION, not at delivery — an explicit owner decision), plus transportCharge if the dealer charges the client; the factory is credited the provisional costTotal (blocks + pallets at ~130,000 UZS each); the vehicle account is credited transportCost. Pallet in-kind movements are recorded, and everything is audit-logged.

The lifecycle is a strict linear flow NEW → CONFIRMED → LOADING → DELIVERING → DELIVERED → COMPLETED, plus CANCELLED reachable only via the cancel endpoint. AGENT users may advance exactly one step forward; ADMIN/ACCOUNTANT may skip forward or step exactly one step back. Moving to LOADING or beyond requires a vehicle. Entering COMPLETED stamps completedAt and accrues the factory bonus (versioned program rules); leaving COMPLETED reverses it. Cancellation is soft only (ADMIN/ACCOUNTANT, mandatory reason): the order flips to CANCELLED, every ledger entry gets a compensating reversal, pallet and bonus effects are reversed, and payment allocations are voided so the money stays on the client's account — no hard deletes, full history preserved. Orders can be edited (full item replace with ledger reverse + repost and credit re-check) only while NEW/CONFIRMED and while cost is still PROVISIONAL — but this API has NO UI. Cost is provisional at creation and is finalized later by factory-payment allocation (costStatus PROVISIONAL → PARTIAL → FINAL), another locked owner decision. Transport has three modes — client's own truck (no cost/charge), dealer-absorbed, dealer-charged — with transport profit (charge − cost) reported separately from goods profit, and a paid-status lifecycle (UNPAID → PAID / PAID_BY_CLIENT) settled through the payments domain.

The current UI is Ant Design (v6) in Uzbek (Latin script) throughout — labels like 'Buyurtmalar', 'Yangi buyurtma', 'Mijoz', 'Zavod', with Russian loanwords ('Moshina' = машина, 'Zavod' = завод, 'Paddon' = поддон); the docs mix Uzbek Latin and Cyrillic. Three screens exist: an Orders list (status tabs + filter row + 10-column table), a New Order form (two-column: form + live summary sidebar with capacity/credit warnings), and an Order Detail page (header with Steps progress and one forward-action button, descriptions cards, items table with late-pricing modal, money/transport cards, and tabs for payments/pallets/timeline/comments). Note: docs/05-biznes-jarayonlari-va-formulalar.md largely describes the LEGACY v2 system (debt at delivery, no credit-limit check, hard delete) — the v3 code plus the owner's recorded decisions (memory: debt-model-decisions) are authoritative, and any redesign must follow the code, not that doc.

### Entities

- **Order** — Central document: one truck load from one factory to one client; carries denormalized money totals and transport info; source of client debt at creation
  - Fields: orderNo (unique, ORD-###### from DB sequence); date (business date, drives price resolution); dueDate (date + client.paymentTermDays); status; agentId (snapshot of client's agent at creation); clientId; factoryId; vehicleId / driverName (driver snapshotted); saleTotal (Σ item saleTotal — transport is INSIDE this figure, see [TRANSPORT MODEL — AUTHORITATIVE](#transport-authoritative)); costTotal (Σ item cost incl. pallets, provisional); costStatus (PROVISIONAL/PARTIAL/FINAL); transportMode (CLIENT_OWN/DEALER_ABSORBED/CLIENT_PAYS_DRIVER + deprecated DEALER_CHARGED); transportCost (the driver's cut, carved out of saleTotal); transportCharge (legacy DEALER_CHARGED only — always 0 on live orders); transportPaidStatus (+transportPaidAt); note, cancelReason, cancelledAt, completedAt, costFinalizedAt; createdById, importBatchId
  - States: NEW | CONFIRMED | LOADING | DELIVERING | DELIVERED | COMPLETED | CANCELLED (only via cancel endpoint)
- **OrderItem** — One product line on the truck; holds both sale side (client price) and cost side (factory price) with full pricing provenance
  - Fields: productId; quantityM3 (3dp; explicit value wins over palletCount × m3PerPallet); palletCount; palletPrice (factory pallet price, default 130,000 UZS); listPricePerM3 (price-book reference at creation, discount derivable); salePricePerM3 (6dp; back-solved for lump sums); saleTotal (2dp; lump sums stored EXACTLY); pricePending (shipped before price agreed); provisionalPriceKind (FACTORY_CASH/FACTORY_BANK from intended payment method); costPricePerM3 / finalCostPricePerM3; costTotal (m³ × costPrice + pallets × palletPrice)
  - States: priced | pricePending (later priced via PATCH …/items/:itemId/price, posts late ORDER_SALE dated to order date)
- **OrderStatusHistory** — Immutable trail of every status transition including cancellation, with actor and optional note
  - Fields: from; to; at; byId; note
- **OrderComment** — Free-text collaboration thread on an order; merged into the unified timeline
  - Fields: text; byId; createdAt
- **PaymentAllocation (related)** — Links payments to orders; drives cost finalization and the paid-progress on the detail page; voided (not deleted) on order cancel
  - Fields: paymentId; orderId; amount; voidedAt
  - States: active | voided
- **Client (related)** — Buyer; owns credit limit and payment terms; balance computed from ledger
  - Fields: agentId; creditLimit (null ⇒ unlimited, 0 ⇒ prepay-only); paymentTermDays (→ order.dueDate); active
  - States: active | inactive (cannot receive new orders)
- **Agent (related)** — Salesperson owning a portfolio of clients; snapshotted on orders; aggregate debt limit gates new orders
  - Fields: debtLimit (null ⇒ AppSetting agentDebtLimitDefault; blocks creation when clients' outstanding debt ≥ limit)
- **Vehicle (related)** — Truck with pallet capacity constraint and default driver; carries a transport-liability ledger account
  - Fields: capacityPallets (default 19); driver; plate
- **LedgerEntry (related)** — Double-entry-style postings created at order time: ORDER_SALE (+client), TRANSPORT_CLIENT_DIRECT (−client, CLIENT_PAYS_DRIVER carve-out), ORDER_COST (−factory), TRANSPORT_COST (−vehicle, DEALER_ABSORBED only), legacy TRANSPORT_CHARGE (+client, deprecated DEALER_CHARGED rows); reversed by compensating entries on cancel/edit — see [TRANSPORT MODEL — AUTHORITATIVE](#transport-authoritative)
  - Fields: account (CLIENT/FACTORY/VEHICLE); source; amount; orderId; reversalOfId
  - States: posted | reversed

### Workflows

- **Create order** (AGENT (own clients only, price floor enforced), ADMIN, ACCOUNTANT; many times/day)
  1. Open /orders → 'Yangi buyurtma' → /orders/new
  1. Pick client (searchable select showing balance), business date, intended factory-payment method (BANK/CASH — sets provisional cost price kind)
  1. Add item rows: product (grouped by factory), pallet count (autofills m³ from m3PerPallet, editable), pricing mode per row: catalog price / negotiated per-m³ / lump sum / price-pending (ADMIN+ACCOUNTANT only)
  1. Optionally pick vehicle (autofills driver) and transport mode; enter the transport cost — it is always INSIDE saleTotal, and under CLIENT_PAYS_DRIVER the summary shows the client's net debt (saleTotal − transportCost) live
  1. Watch side summary: total pallets vs capacity, total m³, estimated sale, exposure ('written to client debt'), client balance, credit-limit warning
  1. Submit → server transaction: validates client/agent scope, single factory, capacity, credit limit, agent debt limit; resolves authoritative prices; creates order NEW + status history + ledger postings (debt NOW) + pallet movements + audit; navigates to detail
- **Advance order through lifecycle** (AGENT (forward only), ADMIN, ACCOUNTANT; many times/day (5 clicks per order across its life))
  1. Open order detail; header shows Steps progress and ONE primary forward-action button labeled as the action ('Tasdiqlash', 'Yuklashni boshlash', 'Yetkazishga jo'natish', 'Yetkazildi deb belgilash', 'Yakunlash')
  1. Click → PATCH /orders/:id/status; server locks the row, validates: AGENT only +1 step, ADMIN/ACCOUNTANT may skip forward or go exactly 1 step back; vehicle required for LOADING+
  1. On entering COMPLETED: completedAt stamped, factory bonus accrued; on leaving COMPLETED (privileged step-back): bonus reversed
  1. Status history row + audit written; timeline updates
- **Soft-cancel order** (ADMIN, ACCOUNTANT; rare)
  1. Order detail → 'Bekor qilish' (danger button, ADMIN/ACCOUNTANT only, any non-cancelled status incl. COMPLETED)
  1. Confirm modal: warning that all financial postings will be reversed and payments remain on the client account; mandatory reason textarea
  1. Server: status → CANCELLED, compensating ledger reversals for every posting, pallet reversal, bonus reversal (idempotent), payment allocations voided (money stays on client), audit VOID
  1. Detail page replaces Steps with a red 'Buyurtma bekor qilingan' alert showing the reason
- **Late pricing of a pending item** (ADMIN, ACCOUNTANT; weekly / rare (goods sometimes ship before price agreed))
  1. Order shipped with pricePending item(s) (sale = 0, excluded from totals; gold 'Narxlanmagan' tag)
  1. ADMIN/ACCOUNTANT opens detail → items table shows 'Narxlash' button per pending row
  1. Modal: choose per-m³ price or lump sum, enter value
  1. Server: item priced (lump back-solves per-m³), order saleTotal increased, ORDER_SALE ledger entry posted dated to the ORDER's business date (debt recognized late per creation rule), audit
- **Edit order (API only — no UI)** (ADMIN, ACCOUNTANT; rare (currently only possible via API))
  1. PUT /orders/:id with FULL item replacement (only while NEW/CONFIRMED and cost PROVISIONAL; intendedPaymentMethod immutable)
  1. Server: reverse all ledger + pallet postings, re-check credit limit at new exposure, re-price items at order date, repost everything, derive transport paid status (already-settled transport survives), audit before/after
- **Monitor & collaborate on order** (ADMIN, ACCOUNTANT, AGENT (own orders only); daily)
  1. Orders list: filter by status tab, search order-no/client, filter client/factory/date range; click order-no link
  1. Detail tabs: To'lovlar (allocation table + paid-progress bar vs saleTotal), Paddonlar (pallet movements), Tarix (unified timeline: statuses + payments + comments), Izohlar (comment thread with composer)

### Roles

- **ADMIN**: Everything: list/view all orders, create, full edit (NEW/CONFIRMED + provisional cost), any forward skip / one-step back status changes, soft-cancel, late pricing, comments. May sell below factory price floor.
- **ACCOUNTANT**: Identical to ADMIN within the orders domain (edit, cancel, late pricing, privileged status moves, below-floor pricing).
- **AGENT**: Row-scoped to own agentId: sees/creates orders only for own clients (assertOwnAgent + agentScope where-fragment); may advance status exactly one step forward; comments and timeline on own orders. CANNOT edit, cancel, price pending items, skip statuses, or go back. Sale price floor = factory BANK price at order date. Creation additionally gated by agent debt limit.
- **CASHIER**: No access to any /orders route (default-deny RolesGuard; every route has explicit @Roles without CASHIER). Interacts with orders only indirectly through kassa/payments.

### Current UI

Pages: /orders — Orders.tsx (list), /orders/new — NewOrder.tsx (creation form), /orders/:id — OrderDetail.tsx (detail/workbench)

All UI text is Uzbek (Latin script). ORDERS LIST: page title 'Buyurtmalar' with a primary '+ Yangi buyurtma' button top-right; below, one Card containing (1) a Tabs strip of 8 status filters ('Barchasi' + 7 statuses), (2) a wrap row of filters: search input (order no / client name, fires on Enter), client Select (loads first 200), factory Select, date RangePicker (DD.MM.YYYY), (3) a 10-column AntD Table with horizontal scroll at 1200px: order-no link (fixed left), date, client, agent, factory, vehicle plate, right-aligned sale total, cost-status tag, order-status tag, transport-paid tag; server pagination (20/page, size changer, 'Jami: N ta'). No row actions, no bulk actions, no totals row. NEW ORDER: back button + title, then a 16/8 two-column grid. Left Card = one long vertical Form: row of client select (option label embeds current balance) / date picker / BANK-CASH radio buttons; 'Mahsulotlar' divider; a Form.List where each item is a nested small Card with product select (options grouped by factory, label shows m³/pallet), pallet InputNumber, m³ InputNumber (autofilled from pallets, editable), a live '≈ sum' estimate, delete icon button, and a second row with a 4-button pricing-mode radio (Katalog/Kelishilgan/Umumiy summa/Narxsiz — last only for ADMIN/ACCOUNTANT) plus the conditional price/lump input or catalog-price hint; dashed 'Mahsulot qo'shish' add button; 'Transport' divider with vehicle select (autofills driver), driver input, transport-mode radio (3 modes), conditional cost/charge inputs with live transport-profit; note textarea; submit + cancel. Right Card 'Xulosa' = sticky-less summary: pallets vs capacity (red when exceeded), total m³, estimated goods sum, pending-price warning tag, transport figures, divider, 'Mijoz qarziga yoziladi' exposure, client balance, and a warning Alert if credit limit may be exceeded ('server tekshiradi'). Inline error Alerts for load/submit failures; multi-factory mix shows an error Alert. ORDER DETAIL: vertical stack of Cards. Header Card: back button, big order-no, status tag, date + client link; right side holds ONE primary forward-action button (action-verb label) and a danger 'Bekor qilish' button (ADMIN/ACCOUNTANT); below, a 6-step Steps component of the lifecycle (replaced by a red cancellation Alert with reason when cancelled). 'Ma'lumotlar' Card: Descriptions grid (1–3 cols responsive) of agent, factory, vehicle, driver, due date, cost-status tag, created-at/by, note. 'Pozitsiyalar' Card: small items Table (product, size, m³, pallets, per-m³ price, total, priced/pending tag, conditional 'Narxlash' button opening a Modal with per-m³/lump radio + amount input). Two half-width Cards: 'Moliya' (sale, cost + status tag, goods profit signed) and 'Transport' (mode, cost, charge, transport profit, paid tag). Final Card: Tabs — To'lovlar (client-paid progress bar vs saleTotal + allocations table with links to /payments), Paddonlar (pallet-movement table), Tarix (AntD Timeline mixing status/payment/comment events, color-coded), Izohlar (comment List with avatars + textarea/send composer). Cancel uses modal.confirm with an embedded reason textarea.

### Pain points

- [high] No UI at all for editing an order. PUT /orders/:id exists (ADMIN/ACCOUNTANT, NEW/CONFIRMED, provisional cost) and endpoints.updateOrder is defined in api.ts, but no page or button calls it. Fixing a wrong quantity/price/vehicle means cancel + full re-entry (losing allocations, history continuity, order number) or raw API calls.
  - Suggestion: Add an Edit mode on OrderDetail (or reuse the NewOrder form pre-filled) gated to the same server rules, with a clear banner explaining why editing locks after CONFIRMED / cost finalization.
- [high] An order created without a vehicle gets stuck: the server blocks LOADING+ without vehicleId, but OrderDetail has no way to assign a vehicle later (vehicle only settable at creation or via the edit API that has no UI). The forward button just fails with a toast 'Moshina biriktirilmagan'.
  - Suggestion: Add an inline 'assign vehicle/driver' action on OrderDetail (and surface vehicle-missing as a visible blocker on the Steps, not a post-click error).
- [medium] Price-pending (unpriced) orders are invisible at list level — no filter, column, or badge on /orders shows pricePending items, and the '≈' sale total silently excludes them. An accountant must open every order to find items awaiting pricing.
  - Suggestion: Add a 'Narxlanmagan' list filter/badge and a dashboard/worklist counter for orders with pending items; show them as a task queue.
- [medium] The New Order client-side estimate uses only the DEALER_SALE book price and ignores per-client ClientPrice overrides, so '≈ sum' and 'Mijoz qarziga yoziladi' (debt exposure) can differ from the authoritative server total for special-price clients — misleading exactly where money is decided.
  - Suggestion: Fetch effective (client-resolved) prices when a client is selected, or have the server expose a quote/preview endpoint the form calls before submit.
- [medium] Credit-limit and capacity problems are only advisory warnings discovered late: the credit warning sits in the side summary ('server tekshiradi'), capacity appears after items are entered, and the agent debt-limit gate isn't surfaced in the UI at all — agents learn of a block only from the submit error toast.
  - Suggestion: Surface client credit headroom and agent debt-limit headroom immediately on client selection, and validate against them inline as amounts change.
- [medium] Single-factory-per-order rule is enforced reactively: the product dropdown mixes all factories (grouped) and an error Alert appears only after the user has already mixed factories.
  - Suggestion: After the first product is chosen, filter the catalog to that factory (with an explicit 'change factory' escape), instead of letting an invalid state be built.
- [medium] Status control is a single forward button: the privileged one-step-back transition and the optional transition note (SetStatusDto.note) supported by the API are completely unreachable from the UI; corrections require the API. Cancel is also allowed from COMPLETED with no warning that a bonus accrual will be reversed.
  - Suggestion: Give ADMIN/ACCOUNTANT a status menu (forward, one-step back with mandatory note) and enrich the cancel modal with impact preview (ledger reversals, allocation voiding, bonus reversal).
- [medium] Client and product selects hard-cap at pageSize 200 ('request the max page to get the full catalog' comment) — beyond 200 records, options silently disappear; products aren't server-searched at all.
  - Suggestion: Use server-side search/infinite scroll for both selects; never truncate silently.
- [medium] OrderDetail is a long single-column stack of 6+ cards: financials, transport, and the payment progress live below the fold; the payment progress compares paid against raw saleTotal, so a CLIENT_PAYS_DRIVER order can never reach 100%.
  - Suggestion: Redesign as a two-column workbench (items+money left, activity right), keep status/actions sticky, and base paid-progress on `clientChargeable(order)` — see [TRANSPORT MODEL — AUTHORITATIVE](#transport-authoritative). (Never `saleTotal + transportCharge` — that formula is dead.)
- [low] Orders list gives no aggregates or operational cues: no sum of filtered saleTotal, no due-date/overdue column despite dueDate existing on the model, no pending-price/vehicle-missing indicators, no row actions (everything requires opening the detail), and manual quantity edits in NewOrder are silently overwritten when pallet count changes afterwards.
  - Suggestion: Add a totals footer, dueDate/overdue and blocker badges, quick actions on rows (advance status, cancel), and only auto-fill m³ when the user hasn't overridden it.
- [low] Comments appear twice (in the 'Tarix' timeline and in a separate 'Izohlar' tab) while the cancel-reason capture uses a closure variable inside modal.confirm — an anti-pattern that loses text on re-render and validates only on OK.
  - Suggestion: Merge comments into a single activity feed with a composer, and use a controlled form in a proper modal for cancellation.

### LOCKED RULES

- Debt is recognized at ORDER CREATION: ORDER_SALE (+saleTotal) and, for CLIENT_PAYS_DRIVER, the TRANSPORT_CLIENT_DIRECT carve-out (−transportCost) are posted to the client ledger the moment the order is booked, so the net receivable is `clientChargeable(order)` from second zero ([TRANSPORT MODEL — AUTHORITATIVE](#transport-authoritative)); every non-CANCELLED order counts toward debt (owner decision 2026-07-09, re-confirmed 2026-07-11; docs/05 describing recognition-at-delivery is legacy and must NOT be restored)
- Late-priced (pricePending) items post their ORDER_SALE dated to the order's BUSINESS date when priced — recognition simply happens late
- Client credit limit enforced inside the creation/update transaction under row locks (SELECT … FOR UPDATE on Client): reject when ledgerBalance + clientChargeable(order) > creditLimit ([TRANSPORT MODEL — AUTHORITATIVE](#transport-authoritative)); creditLimit null ⇒ unlimited, 0 ⇒ prepay-only
- Agent debt-limit gate on creation: if Σ positive balances of the agent's clients ≥ (agent.debtLimit ?? AppSetting agentDebtLimitDefault), new orders are blocked (prepayments of one client never offset another's debt)
- Delete = SOFT-CANCEL only (DELETE /orders/:id, ADMIN/ACCOUNTANT, mandatory reason, optional `mode`): status → CANCELLED, compensating ledger reversals (never row deletion), pallet + bonus reversals, payment allocations voided. MONEY UNWIND — TWO MODES (owner rule, 2026-07-22 EVENING; this SUPERSEDES both earlier rules of that same day — «cash just stays put» and «client keeps the whole credit»). **In BOTH modes the kassa returns to its pre-order state**: what the client paid us LEAVES the kassa and what we paid the factory COMES BACK into it, so a cancelled order never leaves money sitting in the till. The modes differ only in what remains on the CLIENT: (a) `REFUND` (default, «Ha — mijozga qaytariladi») — the client's CLIENT_IN money is returned to them as cash (a CLIENT_REFUND per source payment, kassa OUT), while the transport they handed the DRIVER directly (TRANSPORT_DIRECT) stays as a CREDIT on their balance because the dealer absorbs the transport. Every so'm the client paid therefore comes back — part as cash, part as credit — and the closing client balance is exactly −(driver-paid transport). (b) `VOID_ALL` («Yo'q — hamma o'tkazmalar yo'qolsin») — nothing survives: a CLIENT_IN belonging solely to this order is fully reversed and voided (ledger + kassa), the TRANSPORT_DIRECT record is voided too and NO credit is written, so the client balance lands on 0. The order reads as never placed and never paid. ORDERING MATTERS: the factory refund (cash IN) is posted BEFORE the client refund (cash OUT), otherwise an order whose money had gone to the factory could momentarily starve the box and fail with «Kassada mablag' yetarli emas». The never-below-zero rule still applies to both cash-out paths and reports which box is short. Shared payments unwind only THIS order's allocated portion (a payment split across orders is never voided wholesale). Cancelled orders drop out of all balance math. See orders.service.cancel → payments.service.refundOrderOnCancel, test/cancel-refund.e2e.mjs (29 checks, both modes).
- NO STATUS WORKFLOW (owner rule, 2026-07-22, SUPERSEDES the linear NEW→CONFIRMED→LOADING→DELIVERING→DELIVERED→COMPLETED flow): an order is COMPLETED the moment it is created (`completedAt` = wall-clock, not the business date), and everything — sale, factory cost, transport cost, bonus accrual — posts at creation. `GET /orders/board` and `PATCH /orders/:id/status` were REMOVED, not merely hidden: while the route lived, an ADMIN could step a completed order back and strip the factory-cost and transport legs off the ledger. Quantity/price corrections go through `PUT /orders/:id`, which reverses and re-posts the whole supply + bonus side. CANCELLED is the only surviving transition. The legacy statuses remain in the enum so pre-2026-07-22 rows keep rendering
- CREATION is the bonus event: the factory bonus accrues at creation off the versioned program in force at that wall-clock moment (a back-dated order still gets TODAY's program, never a retroactive one); cancel and edit reverse the accrual
- Factory cost is PROVISIONAL at creation. The order carries a THREE-WAY intent `Order.factoryPayIntent` (CASH «zavodga naqd» / BANK «zavodga o'tkazma» / UNKNOWN «to'lov usuli aniq emas», the default). CASH prices the provisional at FACTORY_CASH; BANK and UNKNOWN price it at FACTORY_BANK (the dearer book — a factory debt must never be understated). UNKNOWN orders display BOTH candidate costs and may settle as a naqd/o'tkazma MIX. The intent is EDITABLE after creation (`PATCH /orders/:id/factory-pay-intent`); re-picking it re-resolves the provisional block price and posts the difference as one COST_ADJUSTMENT. Superseded 2026-07-21 the previous «immutable after creation … plus pallets» rule.
- Pricing is server-authoritative and effective-dated at the order's business date: ClientPrice override beats the DEALER_SALE book price; lump sums are stored EXACTLY with a back-solved 6dp per-m³ price; per-m³ prices keep 6dp, money rounds to 2dp, volume to 3dp; AGENT floor: never below the FACTORY_BANK price (ADMIN/ACCOUNTANT may go below)
- One order = one truck = one factory: all items must share one factoryId; total pallets ≤ vehicle capacity (or default 19 from settings); quantityM3 explicit wins over palletCount × m3PerPallet
- Pallets are IN-KIND on BOTH sides (owner rule 2026-07-21): clients owe a pallet COUNT and the dealer owes the factory a pallet COUNT. NO pallet money exists on the factory side at all — `OrderItem.palletPrice` is always 0, costTotal is blocks-only, and returning pallets to the factory earns nothing. Pallet movements are recorded per order and reversed on cancel/edit. The single surviving money door is the manual CHARGED_LOST charge to a CLIENT.
- Transport is ALWAYS priced inside saleTotal and has 4 modes — CLIENT_OWN, DEALER_ABSORBED (default), CLIENT_PAYS_DRIVER, and the DEPRECATED DEALER_CHARGED (rejected on write) — full definition and formula in [TRANSPORT MODEL — AUTHORITATIVE](#transport-authoritative); transportPaidStatus derives from vehicle payments (incl. PAID_BY_CLIENT direct-to-driver) and an already-settled transport must survive order edits
- agentId is a SNAPSHOT of the client's agent at creation (agent KPIs are historical); AGENT users are row-scoped to their agentId on every read and write
- orderNo comes from the Postgres sequence order_no_seq (ORD-%06d) — unique and monotone
- Every financial mutation is audit-logged (CREATE/UPDATE/STATUS_CHANGE/VOID with before/after) and runs inside one transaction with FOR UPDATE row locks; edits do full ledger reverse + repost

### API

- GET /orders — paged list; filters: status, clientId, factoryId, dateFrom/dateTo, search (orderNo or client name); agent-scoped
- GET /orders/:id — full detail (items+product, client, agent, factory, vehicle, createdBy, statusHistory, comments, allocations, ledgerEntries, palletTransactions, documents)
- GET /orders/:id/timeline — merged chronological events: status changes, payment allocations (incl. voided), comments
- GET /orders/:id/comments — comment thread
- POST /orders/:id/comments — add comment (all three roles, agent-scoped)
- POST /orders — create order (transactional: pricing, capacity, credit-limit, agent-debt-limit, ledger, pallets, audit)
- PUT /orders/:id — ADMIN/ACCOUNTANT full edit with item replace; only NEW/CONFIRMED + cost PROVISIONAL; ledger reverse+repost (NO UI exists for this)
- PATCH /orders/:id/status — linear transition; AGENT +1 only; ADMIN/ACCOUNTANT skip-forward / one-step-back; vehicle required for LOADING+; COMPLETED accrues bonus; optional note (UI never sends it)
- PATCH /orders/:id/items/:itemId/price — ADMIN/ACCOUNTANT late pricing of pricePending item (per-m³ or lump sum)
- DELETE /orders/:id — ADMIN/ACCOUNTANT soft-cancel with mandatory reason in body; compensating reversals; payments stay on client account

---

## Payments / Kassa (cash desk) / Debts — money movement, cash custody, and receivables/payables tracking in the SmartBlok building-blocks dealer ERP

SmartBlok is an ERP for a construction-blocks dealer who buys from factories, sells to clients (often on credit through field agents), and pays truck drivers for delivery. The payment/cash/debt domain is built on an immutable double-entry-style LedgerEntry table: every balance (client, factory, vehicle) is Σ of signed ledger postings, never a stored counter. Sign convention: positive = asset for the dealer (client owes us / our advance at the factory), negative = dealer's liability. Payments are append-only documents with six kinds: CLIENT_IN (client pays dealer), CLIENT_REFUND, FACTORY_OUT (dealer pays factory), FACTORY_REFUND, VEHICLE_OUT (dealer pays driver), and TRANSPORT_DIRECT (client pays the driver directly — credits the client AND settles the vehicle, but never touches the dealer's cash desk). Each payment (except TRANSPORT_DIRECT and BONUS-funded ones) automatically writes a CashTransaction into a chosen Cashbox (CASH/BANK/CLICK/TERMINAL/CARD boxes in UZS or USD); USD payments store usdAmount × rate as the UZS amount, computed server-side. Nothing is ever hard-deleted: voiding a payment posts compensating ledger reversals, opposite-direction kassa rows, voids its allocations, and re-derives order cost and transport status; manual kassa rows are corrected only by storno (REVERSAL) rows. Cashbox balances may never go below zero — enforced under row locks.

The domain's most distinctive rule is cost-at-payment-allocation: an order's factory cost is only PROVISIONAL at creation. When the accountant allocates FACTORY_OUT payments to orders, each allocation carries a priceKind derived from the payment's method (CASH/CARD/USD → factory cash price; BANK/CLICK/TERMINAL → factory bank price). Once Σ active allocations covers the provisional cost, the order's cost is FINALIZED at the price kind of the latest allocation, a COST_ADJUSTMENT ledger delta is posted against the factory, and any PERCENT factory bonus is re-derived via a traceable ADJUSTMENT. If allocations later drop below the threshold (e.g. a payment is voided), finalization is reversed. CLIENT_IN allocations serve aging/settlement per order; VEHICLE_OUT/TRANSPORT_DIRECT allocations mark orders' transport as paid (a derived status, recomputed from surviving payments). Debt tracking is read-only aggregation: a summary (clients owe us, we owe clients/factories/drivers, pallets held by clients — pallets are owed in-kind as counts, not money), a per-client debt table with overdue flags and an expected-collections forecast window, and per-party ledger statements with running balances. Credit limits gate order creation (null = unlimited, 0 = prepay-only); CLIENT_REFUND takes the same client row lock so refunds cannot race the credit gate. A bonus wallet per factory can offset factory debt via a special FACTORY_OUT/BONUS payment created only in the bonus module.

The entire UI is in Uzbek (Latin script) — "To'lovlar", "Kassa", "Qarzlar", "Yangi to'lov", "Bekor qilish" — with a few Russian/Cyrillic trade terms in docs and data («Нахт пластика», «шопр учун барди»). The current front end is Ant Design v6 tables + modals + drawers: a Payments list page with a large conditional create-modal, a Kassa page with balance cards + period summary + transaction log, and a Debts page with six summary cards and a per-client debt table. Server API messages are also Uzbek.

### Entities

- **Payment** — Append-only money-movement document between the dealer and a client, factory, or vehicle/driver; the hub that spawns ledger postings, kassa rows, and allocations
  - Fields: date; kind (CLIENT_IN | CLIENT_REFUND | FACTORY_OUT | FACTORY_REFUND | VEHICLE_OUT | TRANSPORT_DIRECT); method (CASH | BANK | CLICK | TERMINAL | CARD | USD | BONUS); amount (always UZS; for USD = usdAmount × rate, server-computed); usdAmount / rate; clientId / factoryId / vehicleId (exactly the parties the kind requires); agentId (snapshot of client's agent at payment time); cashboxId (required except TRANSPORT_DIRECT and BONUS); payerEntityId / receiverEntityId / payerName / receiverName (legal-entity or free-text counterparties); denominations (JSON cash breakdown, unused in UI); idempotencyKey (double-submit guard); reconciled (import-reconciliation flag; false ⇒ needs owner review, ~95.8M UZS gap); voidedAt / voidReason / voidedById; note, createdById
  - States: active | voided (compensated, never deleted) | reconciled=true / reconciled=false (Tekshirilsin)
- **PaymentAllocation** — Links a payment to specific orders. CLIENT_IN → per-order debt settlement (aging); FACTORY_OUT → cost finalization carrying priceKind; VEHICLE_OUT/TRANSPORT_DIRECT (create-time) → transport-paid marking. One ACTIVE allocation per (payment, order); Σ active ≤ payment amount
  - Fields: paymentId; orderId; amount; priceKind (FACTORY_CASH | FACTORY_BANK — derived from payment method, FACTORY_OUT only); voidedAt; createdById
  - States: active | voided
- **Cashbox** — A cash desk / account holding money in one currency; balance is always derived as Σ(IN) − Σ(OUT) of its CashTransactions, never stored
  - Fields: name (unique); type (CASH | BANK | CLICK | TERMINAL | CARD); currency (UZS | USD); entityId (owning legal entity); active
  - States: active | inactive (faol emas)
- **CashTransaction** — One IN/OUT movement in a cashbox, in the cashbox's currency. Sources: payments (auto), expenses (auto), bonus withdrawals, manual entries, and REVERSAL (storno) compensations
  - Fields: cashboxId; direction (IN | OUT); amount (> 0, in box currency); rate; source (MANUAL | PAYMENT | EXPENSE | BONUS_WITHDRAWAL | REVERSAL); paymentId / expenseId / bonusTransactionId (backlink to origin document); reversalOfId / reversedBy; date, note, createdById
  - States: normal | reversed (has reversedBy storno row) | is-reversal (source=REVERSAL)
- **LedgerEntry** — Immutable signed posting; the SINGLE source of truth for every client/factory/vehicle balance. >0 = dealer's asset, <0 = dealer owes. SQL CHECKs enforce party-matches-account, amount ≠ 0
  - Fields: account (CLIENT | FACTORY | VEHICLE); source (ORDER_SALE, ORDER_COST, COST_ADJUSTMENT, TRANSPORT_CLIENT_DIRECT, TRANSPORT_COST, legacy TRANSPORT_CHARGE, PAYMENT, PALLET_CHARGE, PALLET_RETURN_CREDIT, BONUS_OFFSET, ADJUSTMENT, IMPORT, …); amount (signed Decimal 18,2); clientId / factoryId / vehicleId; orderId / paymentId / palletTransactionId; reversalOfId / reversedBy (compensation chain); date (business date) vs at (posting time)
  - States: posted | reversed (compensated by a linked reversal entry)
- **Client (debt-relevant fields)** — Debtor party; balance derived from ledger. Credit gate at order creation; pallets owed in kind (count)
  - Fields: creditLimit (null ⇒ unlimited; 0 ⇒ prepay-only); paymentTermDays (order.dueDate = date + term); agentId; balance (derived); palletBalance (derived count: delivered − returned − charged-lost ± adjustments)
  - States: active/inactive | in-debt (balance > 0) | prepaid (balance < 0) | settled (|balance| < 1 UZS residue rule)
- **Order (cost-status facet)** — Carries provisional factory cost until FACTORY_OUT allocations fix it; transport settlement also derived from payments
  - Fields: costTotal; costStatus; costFinalizedAt; items.finalCostPricePerM3; transportPaidStatus; dueDate
  - States: costStatus: PROVISIONAL → PARTIAL → FINAL (reversible if allocations drop) | transportPaidStatus: NOT_APPLICABLE | UNKNOWN | UNPAID | PAID | PAID_BY_CLIENT

### Workflows

- **Record a client payment (CLIENT_IN)** (CASHIER, AGENT (own clients only), ACCOUNTANT, ADMIN; many times/day)
  1. Open To'lovlar page → click 'Yangi to'lov' (fresh idempotencyKey generated per modal-open)
  1. Pick kind (agents locked to CLIENT_IN), method, date
  1. Search-select the client (dropdown shows current balance)
  1. Enter amount in UZS — or for USD method enter usdAmount + rate, UZS preview shown
  1. Pick a cashbox filtered to the matching currency (dropdown shows box balance)
  1. Optionally (ADMIN/ACCOUNTANT only) add allocation rows: order + amount, warned if Σ exceeds payment
  1. Save → server validates party/kind matrix, creates Payment, posts ledger (client credited), writes kassa IN row, applies allocations, audit-logs
- **Pay a factory and finalize order costs (cost-at-payment-allocation)** (ACCOUNTANT, ADMIN; daily)
  1. Create FACTORY_OUT payment (kassa OUT row, ledger: factory advance +)
  1. Allocate to that factory's orders — inline at creation or later via POST /payments/:id/allocations (no UI exists for the later path)
  1. Each allocation stamps priceKind from the payment method: CASH/CARD/USD → FACTORY_CASH price, BANK/CLICK/TERMINAL → FACTORY_BANK price
  1. Engine recomputes: covered < provisional cost → PARTIAL; covered ≥ provisional cost → FINAL, repricing every item at the latest allocation's price kind (resolved at the ORDER's date)
  1. Provisional→final delta posts as a COST_ADJUSTMENT ledger entry against the factory
  1. PERCENT factory bonus for completed orders is re-derived and the difference posted as a BonusTransaction ADJUSTMENT
- **Pay a driver / record client-paid transport** (CASHIER, ACCOUNTANT, ADMIN; daily)
  1. VEHICLE_OUT: dealer pays the driver from a cashbox; allocations to orders mark their transport as paid
  1. TRANSPORT_DIRECT: client paid the driver directly — a RECORD ONLY: it posts NO ledger rows (the carve-out already happened at order creation), touches no cashbox, and only re-derives transportPaidStatus → PAID_BY_CLIENT (UI shows an info alert). See [TRANSPORT MODEL — AUTHORITATIVE](#transport-authoritative)
  1. Transport paid status is re-derived from all surviving payments on each change (a partial allocation must not read as PAID)
- **Void a payment** (ACCOUNTANT, ADMIN; weekly / rare)
  1. From the payments table row or the detail drawer, click the stop icon → confirm modal demands a reason (max 500 chars)
  1. Server (under payment row lock): reverses every un-reversed ledger posting, writes opposite-direction kassa REVERSAL rows, voids all active allocations
  1. FACTORY_OUT → affected orders' costs recomputed (may un-finalize, reversing COST_ADJUSTMENTs and restoring provisional cost)
  1. VEHICLE_OUT/TRANSPORT_DIRECT → transport status re-derived
  1. BONUS-method payment → bonus money returned to the factory wallet
  1. Payment stamped voidedAt/voidReason/voidedBy; full audit log
- **Manual kassa entry and storno** (CASHIER (manual entry), ACCOUNTANT/ADMIN (also storno); daily)
  1. Kassa page → 'Qo'lda kirim/chiqim' → pick cashbox, IN/OUT radio, amount, optional date/note
  1. OUT is rejected if it would push the box balance below zero (serialized with FOR UPDATE)
  1. Corrections: 'Qaytarish' button on MANUAL rows only → reason required → compensating REVERSAL row (payment/expense-sourced rows must be fixed by voiding the source document)
- **Monitor debts and collections** (ADMIN, ACCOUNTANT, AGENT (own clients, no summary cards); daily)
  1. Qarzlar page: six summary cards (clients owe us / we owe clients / factory advance / we owe factories / we owe drivers / pallets at clients)
  1. Per-client table sorted by debt desc: balance (red/green), pallet count, overdue tag (orders past dueDate, tooltip with count+total), 'due soon' tag, payment term
  1. Pick forecast window (7/14/30 days) → 'Kutilayotgan tushum' expected-collections figure
  1. Click client name → ClientDetail page → statement tab with running-balance ledger rows linking to orders/payments
- **Offset factory debt from bonus wallet** (ADMIN, ACCOUNTANT; rare)
  1. Bonus page → offset action → POST /bonus/offset
  1. Creates Payment(FACTORY_OUT, method=BONUS, no cashbox) → LedgerEntry(BONUS_OFFSET) → BonusTransaction(DEBT_OFFSET)
  1. Payments page refuses method=BONUS at creation — the bonus module is the only birthplace
- **Credit-limit gate (order side, locked)** (system (automatic); many times/day)
  1. At order creation: if client.creditLimit ≠ null, reject when ledgerBalance + newExposure > limit (client row locked)
  1. CLIENT_REFUND payments take the same client row lock so a refund cannot race past the credit gate

### Roles

- **ADMIN**: Everything: create any payment kind, allocate, void, kassa view + manual + storno, all debts views and statements
- **ACCOUNTANT**: Same as ADMIN inside this domain: create/void/allocate payments, kassa manual + storno, debts summary/clients/statement, bonus offset
- **CASHIER**: Create payments of any kind but WITHOUT allocations (allocation = privileged cost-finalization), view payments list/detail, kassa view + manual entries; no void, no storno, no debts pages
- **AGENT**: Only CLIENT_IN payments for his own clients (create + view; list force-filtered to kind=CLIENT_IN + own-agent scope); debts clients list and CLIENT statements for own clients only; no kassa access, no debts summary, no factory/vehicle data

### Current UI

Pages: apps/web/src/pages/Payments.tsx — «To'lovlar» list + create modal + detail drawer, apps/web/src/pages/Kassa.tsx — «Kassa» balance cards + period summary + transaction log + manual-entry modal, apps/web/src/pages/Debts.tsx — «Qarzlar» summary cards + per-client debt table, apps/web/src/pages/ClientDetail.tsx — statement tab (running balance) and payments tab, adjacent to this domain, apps/web/src/pages/FactoryDetail.tsx — factory statement tab

All three pages are Ant Design v6, Uzbek-language, desktop-table-centric. PAYMENTS: title row with a primary 'Yangi to'lov' button; a filter Card holding a wrapping Space of 7 controls (free-text search, kind select, method select, client search-select, factory select, date RangePicker, 'Bekor qilinganlar' switch to include voided); below it a small, paginated Table (columns: date, kind as colored Tag, method with USD sub-line 'usd × rate', party text, right-aligned amount, cashbox name, state Tag [red Bekor qilingan / orange Tekshirilsin / green Tasdiqlangan], eye + void icon buttons). Clicking the eye opens a 640px right Drawer: Descriptions list (date, kind, method, USD math, amount, party, agent, cashbox, payer/receiver, note, creator, state, void info), then an allocations mini-table (order no, amount, active/voided Tag), then a raw ledger-entries mini-table (untranslated account/source enum strings). Creation is a single 720px Modal whose fields morph by kind: kind/method/date row, then conditional client/factory/vehicle search-selects (options embed live balances), an info Alert for TRANSPORT_DIRECT, amount OR usdAmount+rate with computed UZS preview, currency-filtered cashbox select showing box balances, note, and — for ADMIN/ACCOUNTANT on allocatable kinds — a Form.List of order+amount allocation rows behind a Divider, with a warning Alert if the sum exceeds the payment. Voiding uses modal.confirm with an uncontrolled TextArea for the mandatory reason. KASSA: page is a vertical stack — (1) a responsive grid of per-cashbox Cards (type icon, name, currency Tag, big derived balance); (2) a 'Davr bo'yicha xulosa' Card with its own RangePicker (defaults to current month) over a summary table (opening / +in / −out / closing per box, UZS & USD grand totals below); (3) a 'Tranzaksiyalar' Card with four filters (cashbox, direction, source, date range) over a paginated table (datetime, box name+icon, IN/OUT Tag, signed colored amount, source Tag, linked-document column rendering payment kind + party or expense category or bonus factory as text — no navigation links, note, and a 'Qaytarish' storno button only on un-reversed MANUAL rows). Manual entry is a small Modal (cashbox select, IN/OUT radio buttons, amount, date, note). DEBTS: six small statistic Cards in a responsive Row (each a label + colored money figure; agents don't see them), then a Card containing a search input, a 7/14/30-day window select, an 'expected collections' figure on the right, and the paginated client table (name links to /clients/:id, agent, region, phone, red/green balance, pallet count, overdue/due-soon Tags with a tooltip carrying count+total, payment term days). No row action to record a payment; no statement viewer on this page (GET /debts/statement is wired in api.ts as debtsStatement but never called from any page — client statements live only in ClientDetail).

### Pain points

- [high] No way to allocate an EXISTING payment from the UI: POST /payments/:id/allocations and api.ts allocatePayment exist, but no page calls it. Allocations can only be entered inside the create modal — if the accountant saves first (or a cashier created the payment, since cashiers can't allocate), the only recourse is voiding and re-entering the whole payment. This breaks the core cost-at-payment-allocation workflow.
  - Suggestion: Add an 'Allocate' action in the payment detail drawer (and on order/factory screens) showing unallocated remainder and the party's open orders with their outstanding amounts, with auto-fill oldest-first
- [high] Allocation rows in the create modal are blind: the order dropdown shows only orderNo/date/saleTotal — not how much of the order is still unpaid or its cost coverage — and the amount field is not pre-filled. The user must compute remaining balances mentally or in another tab; over-allocation is caught only by a warning banner and then a server rejection.
  - Suggestion: Show per-order outstanding (sale side) or uncovered cost (factory side) directly in the picker, auto-suggest the remainder, and running allocated-vs-payment totals
- [high] Recording a payment from the Debts page — the single most frequent collection task — takes many clicks: leave Qarzlar, open To'lovlar, click Yangi to'lov, re-search the same client, re-type the amount visible on the previous screen.
  - Suggestion: Row-level 'To'lov qabul qilish' action on the debt table (and on ClientDetail) opening the payment form pre-filled with client and outstanding balance
- [high] The reconciliation workflow is a dead end: ~95.8M UZS of imported payments carry reconciled=false and every list row shows an orange 'Tekshirilsin' tag, but there is no UI filter for reconciled (the API supports ?reconciled=) and no endpoint or button to mark a payment reviewed/reconciled at all — the flag can never be cleared.
  - Suggestion: Add a reconciliation queue view (filter + count badge) and a mark-reconciled action (new endpoint) with audit logging
- [medium] Kassa transaction log's 'Bog'liq hujjat' column renders the source payment/expense as plain tags and text with no link — investigating a cash movement requires manually finding the payment on another page by date and amount. The payment detail drawer likewise lists ledger entries with raw enum strings (CLIENT, COST_ADJUSTMENT) untranslated, while ClientDetail has proper Uzbek labels.
  - Suggestion: Make referenced documents clickable (open the payment drawer / expense), and reuse the LEDGER_SOURCE translation map everywhere
- [medium] Void and storno reasons are collected via modal.confirm with an uncontrolled TextArea mutated through a closure variable; validation fires only after pressing the danger button (a message.warning + silent Promise.reject keeps the modal open). No preview of downstream effects (which orders will un-finalize, which kassa rows reverse).
  - Suggestion: Use a proper form with inline required validation and show an impact summary (allocations to void, cost states that will revert) before confirming
- [medium] VEHICLE_OUT allocation candidates are fetched as the first 100 orders (pageSize:100) and filtered by vehicle client-side because the orders endpoint has no vehicle filter — older orders for that truck silently never appear in the dropdown.
  - Suggestion: Add a vehicleId filter to GET /orders (or a dedicated open-orders-for-party endpoint) and paginate/search the picker server-side
- [medium] The create modal is one long morphing form: changing kind wipes all party/cashbox/allocation fields without warning; agent restrictions surface as a disabled select; USD requires typing the exchange rate from memory every time (no remembered/default rate); the denominations (cash breakdown) field exists in the model but has no UI.
  - Suggestion: Redesign as a kind-first stepper or per-kind entry points ('Receive from client', 'Pay factory'…), remember the last USD rate, and optionally expose a denominations helper for cash counting
- [medium] Kassa page has three stacked sections with two independent date-range pickers (summary period vs transaction filter), which users must keep in sync manually; cashbox cards, summary table, and the transaction list repeat the same box names three times on one screen.
  - Suggestion: Unify around one period control; consider selecting a cashbox card to scope both summary and log
- [medium] Debts page offers only a binary 'Muddati o'tgan' tag — no aging buckets (0-30/31-60/61-90+), no per-order breakdown without leaving the page, no export, and the overdue total is hidden inside a tooltip. Expected collections is a single unexplained number.
  - Suggestion: Add aging columns or an expandable row with the client's open orders and dueDates; surface overdue totals directly
- [low] Payments list shows no aggregate for the current filter (e.g. total CLIENT_IN for the selected week) — only 'Jami: N' row count; staff reconcile daily takings by exporting or summing mentally.
  - Suggestion: Add filtered sum(s) per kind/direction above the table
- [low] Client/party dropdowns cap at 50 search results and embed raw signed balances ('balans -1 200 000') without explaining that positive means the client owes — new staff routinely misread the sign.
  - Suggestion: Label balances semantically ('qarzi: 1.2M' / 'avansi: 1.2M') with color, and paginate pickers

### LOCKED RULES

- Financial history is immutable: payments and kassa/ledger rows are NEVER hard-deleted — corrections are voids (payments) or compensating REVERSAL rows (kassa, ledger), each requiring a reason and audit-logged
- LedgerEntry is the single source of truth for all balances; balance = Σ signed amounts; sign convention >0 = dealer's asset, <0 = dealer owes; |balance| < 1 UZS is float residue treated as settled
- Debt is recognized at ORDER CREATION (any status except CANCELLED), not at delivery
- Credit limit enforced at order creation under a client row lock: reject when ledgerBalance + newOrderExposure > creditLimit; null limit = unlimited, 0 = prepay-only; CLIENT_REFUND takes the same lock so refund-vs-order cannot race
- BLENDED cost-at-settlement (owner-locked, supersedes «latest allocation wins» on 2026-07-21). An order is a QUANTITY of goods, not a fixed sum, because naqd and o'tkazma buy the same goods at different prices. A settlement of A so'm through a channel whose whole-order total is T buys A/T of the order at that channel's price; whatever is still open stays at the provisional price. cost = Σ(share × goods at that settlement's price) + remaining share × goods at the provisional price. Nothing settled → PROVISIONAL; partly → PARTIAL (and the cost ALREADY moves); under 1 so'm left to buy → FINAL. A settlement may never buy more of an order than is left. One append-only COST_ADJUSTMENT delta drives every direction, so voiding a settlement is simply the opposite delta — there is no separate un-finalize path. A single full settlement reduces to the old «reprice everything at that kind», so historical orders keep their value. See `apps/api/src/common/factory-coverage.ts`.
- Payment kind ↔ party matrix is a hard invariant (mirrors SQL CHECK payment_kind_party): CLIENT_IN/CLIENT_REFUND need clientId only, FACTORY_* need factoryId only, VEHICLE_OUT needs vehicleId only, TRANSPORT_DIRECT needs clientId+vehicleId
- TRANSPORT_DIRECT never touches a cashbox and (since 2026-07-20) posts NO ledger rows at all — it is a RECORD that the driver got his cash and drives transportPaidStatus only; it requires ≥1 order allocation and every allocated order must be CLIENT_PAYS_DRIVER; reconciled=true by definition. See [TRANSPORT MODEL — AUTHORITATIVE](#transport-authoritative)
- Every non-TRANSPORT_DIRECT, non-BONUS payment must write exactly one CashTransaction in a currency-matching, active cashbox; USD-method payments require usdAmount+rate, store amount = round2(usdAmount × rate) server-side (never client-supplied), and hit a USD box in USD
- Cashbox balances can never go below zero: every OUT (payment, manual, storno) checks Σ(IN)−Σ(OUT) under a FOR UPDATE row lock
- One ACTIVE allocation per (payment, order) — partial unique index; Σ active allocations must never exceed the payment amount; allocated orders must belong to the payment's party and must not be CANCELLED
- Transport paid status is DERIVED from surviving payments (recomputed, never clobbered — a 1-so'm allocation must not read as PAID)
- BONUS-method payments are born ONLY in the bonus module (/bonus/offset: Payment FACTORY_OUT/BONUS no-cashbox → LedgerEntry BONUS_OFFSET → BonusTransaction DEBT_OFFSET); voiding one returns the money to the factory's bonus wallet; factory bonus programs are versioned, never retroactive; PERCENT bonus re-derives on cost finalization over blocks only (pallet money excluded) via ADJUSTMENT transactions
- Pallets are owed IN-KIND: clients owe pallet counts (delivered − returned − charged-lost ± signed adjustments), never pallet money; pallet money exists only on the factory side and via explicit CHARGED_LOST ledger charges
- Idempotency: a repeated create with the same idempotencyKey returns the original payment (pre-check + unique-index race handling)
- Role gates: AGENT may only create/see CLIENT_IN for own clients (server-scoped); allocations (inline or endpoint) and voids are ADMIN/ACCOUNTANT only; kassa storno is ADMIN/ACCOUNTANT; only MANUAL kassa rows are storno-able — payment/expense-sourced rows must be fixed by voiding the source document
- Kassa manual direction is strict IN|OUT (v2's silent default-to-IN money inversion must never return); voided payments are excluded from lists by default; order soft-cancel never auto-refunds cash already in the kassa

### API

- GET /payments — paginated list; filters: kind, method, clientId, factoryId, dateFrom/dateTo, reconciled, voided (default excluded), search; AGENT force-scoped to own-client CLIENT_IN
- GET /payments/:id — full detail: parties, cashbox, allocations (+order cost/transport status), ledger entries, cash transactions, created/voided by
- POST /payments — create payment (ADMIN/ACCOUNTANT/CASHIER/AGENT-limited); optional inline allocations (ADMIN/ACCOUNTANT only); idempotencyKey supported
- POST /payments/:id/allocations — allocate an existing CLIENT_IN or FACTORY_OUT payment to orders (ADMIN/ACCOUNTANT); triggers cost recompute/finalization
- POST /payments/:id/void — void with mandatory reason (ADMIN/ACCOUNTANT); compensates ledger, kassa, allocations, cost, transport, bonus
- GET /kassa/cashboxes — all boxes with derived inTotal/outTotal/balance (ADMIN/ACCOUNTANT/CASHIER)
- GET /kassa/transactions — paginated cash log; filters: cashboxId, direction, source, dateFrom/dateTo; rows include origin payment/expense/bonus and reversal links
- POST /kassa/manual — manual IN/OUT entry (ADMIN/ACCOUNTANT/CASHIER); OUT blocked below zero
- POST /kassa/transactions/:id/reverse — storno a MANUAL row with reason (ADMIN/ACCOUNTANT)
- GET /kassa/summary — per-cashbox opening/in/out/closing over a date window + UZS/USD totals
- GET /debts/summary — six aggregates: clientsOweUs, weOweClients, factoryAdvance, weOweFactories, weOweVehicles, palletsAtClients (ADMIN/ACCOUNTANT)
- GET /debts/clients — per-client debt rows (balance, palletBalance, overdue flags/totals, dueWithinWindow) + expectedCollections over ?days window (ADMIN/ACCOUNTANT/AGENT own-scope)
- GET /debts/statement — ledger statement for account=CLIENT|FACTORY|VEHICLE + partyId with opening/running/closing balance (AGENT: own clients only) — currently unused by any web page
- POST /bonus/offset — adjacent: creates the FACTORY_OUT/BONUS debt-offset payment (ADMIN/ACCOUNTANT)

---

## Warehouse / Products / Pallets / Procurement (gas-block catalog, versioned price book, in-kind pallet container ledger, landed-cost procurement matrix) — SmartBlok ERP v3

SmartBlok is a gas-block (gazoblok / aerated-concrete) DEALER's ERP. Critically, there is NO physical warehouse or stock-on-hand model anywhere in the system: one order = one truck that drives factory → client directly, so "inventory" reduces to (a) a product catalog per factory, (b) a versioned three-kind price book, and (c) an in-kind ledger of returnable wooden pallets (paddon). "Stock valuation" happens per order item, not per warehouse: each OrderItem carries a provisional cost (current FACTORY_BANK book price × m³ + pallets × pallet price, default 130 000 UZS) that is finalized later when the dealer's payments to the factory are allocated (cost-at-payment-allocation, an owner-locked rule).

The product catalog is per-factory (unique factoryId+name; factoryId immutable after creation; soft-delete only). Each product is a block type/size (e.g. "Gazoblok D500", 600×300×200) measured in m³, with m3PerPallet (e.g. 1.728) and optional blocksPerPallet. Prices live in an append-only price book with three kinds — FACTORY_CASH (zavod naqd), FACTORY_BANK (zavod o'tkazma), DEALER_SALE (sotish) — stored as UZS per m³ with 6 decimal places; a new price is a new row with effectiveFrom, never an update, so historical orders are untouched. Per-client price overrides (ClientPrice, same versioning) win over DEALER_SALE at order time. AGENTs are server-side stripped to DEALER_SALE prices of active products only; factory cost kinds are confidential.

Pallets are owed IN KIND (counts, never money) — an explicit owner decision. Every order automatically posts two pallet movements in the order's transaction: RECEIVED_FROM_FACTORY (dealer becomes accountable to the factory) and DELIVERED_TO_CLIENT (client now holds our pallets). Client balance = delivered − returned_by_client − charged_lost ± adjustments/reversals; factory balance = received − returned_to_factory ± adjustments/reversals. Money enters only through two explicit flows, each posting exactly one linked LedgerEntry: CHARGED_LOST (converts lost pallets into client money debt at ~130 000 UZS/pallet) and RETURNED_TO_FACTORY (factory credits the dealer's advance). Order cancellation creates compensating REVERSAL rows for the order's own two movements only — physical client returns are never undone.

Procurement is decision support, not purchase orders: a landed-cost matrix per region computes landedCostPerM3 = current FACTORY_BANK price + costPerTruck / (route.capacityPallets × product.m3PerPallet) over versioned LogisticsRoute rows (factory↔region, append-only like prices), highlights the cheapest option, and honestly lists products dropped for missing price/route data. Notably the API for creating routes exists (POST /procurement/routes) but has NO UI at all. The entire UI is in Uzbek (Latin script): "Mahsulotlar", "Paddonlar", "Ta'minot matritsasi", money as "so'm"; docs are in Uzbek too, with occasional Russian trade jargon in legacy data. Frontend is Ant Design v6 + TanStack Query; all money crosses the wire as decimal strings.

### Entities

- **Product** — Catalog row: one gas-block type/size sold by one specific factory. Unit is m³; m3PerPallet converts pallet counts to volume (1.728 for ×200 blocks, 1.8 for ×250).
  - Fields: factoryId (immutable after create — moving would break past orders); name (unique per factory); size (free text, e.g. 600×300×200); m3PerPallet Decimal(6,3); blocksPerPallet Int?; unit (default m³); active
  - States: active | inactive (soft-deleted, hidden from agents and new orders, history preserved)
- **ProductPrice** — Append-only versioned price book, three kinds per product. Current price = latest row with effectiveFrom <= now. Rows are NEVER updated or deleted; old orders keep the price in force at their date.
  - Fields: kind: FACTORY_CASH | FACTORY_BANK | DEALER_SALE; pricePerM3 Decimal(18,6) UZS/m³; effectiveFrom (unique with productId+kind); createdBy
- **ClientPrice** — Per-client sale-price override (versioned identically). Order pricing resolves ClientPrice first, falls back to DEALER_SALE book price.
  - Fields: clientId; productId; pricePerM3 Decimal(18,6); effectiveFrom
- **PalletTransaction** — In-kind movement ledger for returnable pallets. Balances are pure sums over these rows — no stored counters. unitPrice is set only on the two money-bearing types, each linked 1:1 to a LedgerEntry.
  - Fields: type; qty Int (signed for ADJUSTMENT/REVERSAL); date + at; clientId? / factoryId? / orderId?; unitPrice Decimal(18,2)? (CHARGED_LOST, RETURNED_TO_FACTORY only); reversalOfId (1:1, cancel trail); note; createdById
  - States: RECEIVED_FROM_FACTORY (auto with order) | DELIVERED_TO_CLIENT (auto with order) | RETURNED_BY_CLIENT (manual, no money) | RETURNED_TO_FACTORY (manual, posts factory credit) | CHARGED_LOST (manual, posts client debt) | ADJUSTMENT (signed) | REVERSAL (signed, from order cancel)
- **LogisticsRoute** — Versioned factory→region trucking cost used by the landed-cost matrix. Append-only like prices; capacityPallets defaults from the truckCapacityPallets app setting (fallback 19, max 40).
  - Fields: factoryId; regionId; costPerTruck Decimal(18,2) UZS; capacityPallets Int (1–40); effectiveFrom (unique with factory+region)
- **OrderItem (cost side — adjacent but load-bearing)** — Where 'stock valuation' actually lives: quantityM3 (wins over palletCount × m3PerPallet when both given), palletCount + palletPrice feed costTotal = m³×costPricePerM3 + pallets×palletPrice. Pallets are NOT billed to the client (saleTotal excludes them).
  - Fields: quantityM3 Decimal(12,3); palletCount; palletPrice (default from palletPriceDefault setting, 130 000); provisionalPriceKind (default FACTORY_BANK); costPricePerM3 / finalCostPricePerM3; costTotal
  - States: costStatus: PROVISIONAL → PARTIAL → FINAL (fixed by factory-payment allocation)
- **Factory / Region (reference data)** — Factory owns products, pallet accountability and routes; Region groups clients and anchors routes/matrix.
  - Fields: name (unique); active
  - States: active | inactive

### Workflows

- **Maintain product catalog (create / edit / deactivate)** (ADMIN, ACCOUNTANT; rare (catalog is small and stable))
  1. Open Mahsulotlar page
  1. Click 'Yangi mahsulot' → modal: pick factory (locked after creation), name, size, m³/pallet, blocks/pallet, unit
  1. Save — audit-logged; duplicate name in same factory rejected
  1. Deactivate via red stop button + confirm dialog (soft-delete; product disappears from agent catalog and new orders)
- **Record a price change (versioned price book)** (ADMIN, ACCOUNTANT; weekly/monthly bursts when a factory reprices)
  1. Mahsulotlar page → row's 'Narxlar' button → 640px drawer opens
  1. Info alert explains versioning ('new price does not alter old records')
  1. Fill inline form: kind (3 options), price so'm/m³ (up to 6dp), optional effectiveFrom date (defaults to now; future-dating supported)
  1. Submit → new immutable row; history table below refreshes; catalog current-price columns update
  1. Repeat per kind and per product — there is no bulk entry
- **Compare landed cost before buying (procurement matrix)** (ADMIN, ACCOUNTANT; weekly / per purchasing decision)
  1. Open Ta'minot matritsasi
  1. Select region (mandatory — page is blank until then), optionally one product
  1. Read matrix sorted by landed cost asc: factory price (FACTORY_BANK), truck cost, capacity, truck m³, landed so'm/m³
  1. Cheapest row highlighted green with trophy tag + summary banner
  1. Check 'Hisobga kirmagan mahsulotlar' card for products dropped for missing FACTORY_BANK price or missing route
  1. Act on gaps by adding a price (Products page) or a route (NO UI — API only)
- **Automatic pallet flow with each order (system-side)** (AGENT, ACCOUNTANT, ADMIN (via order creation); many times/day)
  1. Agent/accountant creates an order (one truck); items carry palletCount
  1. Inside the order transaction the system posts RECEIVED_FROM_FACTORY (total pallets, factory side) and DELIVERED_TO_CLIENT (same qty, client side)
  1. Pallet cost (palletCount × palletPrice) is added into the order's costTotal; the client is never billed for pallets in saleTotal
  1. If the order is cancelled, compensating REVERSAL rows negate only these two movements
- **Accept pallet return from client** (ADMIN, ACCOUNTANT; daily)
  1. Paddonlar page → per-row 'Qaytarish qabul qilish' (client prefilled) or header button (pick client — options show current balance)
  1. Modal: qty, date (defaults today), optional order link (API supports orderId; UI omits it), note
  1. Save → RETURNED_BY_CLIENT row; client's in-kind counter drops; no money moves
- **Return pallets to factory (money-bearing)** (ADMIN, ACCOUNTANT; weekly)
  1. Paddonlar page → 'Zavodga qaytarish' (header or factory-row button)
  1. Modal: factory, qty, unit price (prefilled 130 000, editable), date, note; live preview 'Zavod hisobiga kredit: X so'm'
  1. Save → RETURNED_TO_FACTORY row + one FACTORY ledger entry (dealer's advance at the factory grows by qty × unitPrice)
- **Charge client for lost pallets (converts kind → money)** (ADMIN, ACCOUNTANT; rare)
  1. Paddonlar page → red 'Undirish' / 'Yo'qotilganini undirish'
  1. Modal: client, qty, unit price (prefilled 130 000), date; warning alert 'this writes money debt to the client' with live total
  1. Confirm (danger button) → CHARGED_LOST row + one CLIENT ledger entry (client debt grows)
- **Monitor pallet balances and movement history** (ADMIN, ACCOUNTANT, AGENT (read-only, scoped); daily)
  1. Paddonlar page: two balance cards (clients holding our pallets; our accountability at factories) + full movement table
  1. Filter movements by client or factory dropdowns; rows link to client and order pages
  1. AGENT sees only his own clients' balances/movements, no factory card, no action buttons
- **Create/version a logistics route** (ADMIN, ACCOUNTANT (API only); rare)
  1. POST /procurement/routes with factoryId, regionId, costPerTruck, optional capacityPallets (defaults from truckCapacityPallets setting, fallback 19), optional effectiveFrom
  1. New immutable row; old calculations unaffected
  1. NO UI exists for this today — matrix data can only be seeded via API/import

### Roles

- **ADMIN**: Everything in the domain: product CRUD (create/edit/soft-delete), add price-book rows, view full price history incl. factory cost kinds, procurement matrix + routes (list/create via API), all pallet balances (clients + factories), all three pallet mutations. Also owns Settings (truckCapacityPallets, palletPriceDefault).
- **ACCOUNTANT**: Identical to ADMIN within this domain (products, prices, matrix, routes, all pallet operations). Cannot access Settings/Users.
- **AGENT**: Products API read-only: active products only, DEALER_SALE price only — factory cost kinds stripped server-side (the /products page itself is not even routed for agents; they meet the catalog inside order creation). Pallets read-only: balances and transactions of HIS clients only (clientAgentScope; factory-only rows excluded); no mutation buttons. No procurement access at all — matrix would leak cost prices.
- **CASHIER**: No access to any page or endpoint of this domain.

### Current UI

Pages: /products — 'Mahsulotlar' (nav group 'Ma'lumotnomalar', ADMIN/ACCOUNTANT), /pallets — 'Paddonlar' (top-level nav, ADMIN/ACCOUNTANT/AGENT), /procurement — 'Ta'minot matritsasi' (top-level nav, ADMIN/ACCOUNTANT), /settings — two domain fields live here: 'Fura sig'imi (paddon)' and 'Paddonning standart narxi (so'm)' (ADMIN only), No page exists for logistics routes (API only)

PRODUCTS (/products): a single full-width AntD Card titled 'Mahsulotlar'. Card header extra: factory Select (200px), Input.Search (200px, fires on Enter/button only), primary '+ Yangi mahsulot' button. Body: one horizontally-scrollable Table (size middle, server-paginated 20/page with size changer) with columns: Nomi, O'lchami, Zavod, m³/paddon (right, 3dp), Blok/paddon, Sotish narxi (bold), Zavod naqd narxi, Zavod o'tkazma narxi, Holat (green 'Faol' tag), Amallar (three small buttons: 'Narxlar' with $ icon, pencil edit, red stop). Price columns show only the current number — no effective date, no history hint. Create/edit is a centered Modal with a vertical form (factory select disabled on edit with an explanatory hint, name, size, m³/paddon InputNumber step 0.001, blocks, unit, active Switch on edit only). Prices open a 640px right Drawer: info Alert about versioning, then a cramped horizontal inline form (kind Select 210px, price InputNumber 180px with space-grouped thousands, DatePicker, submit) that wraps awkwardly, a Divider, and the full history Table (kind, price at 6dp, effective datetime; all three kinds interleaved, client-paginated 15/page, no 'current' marker, no filter by kind).

PALLETS (/pallets): vertical stack. Header Flex row: H3 'Paddonlar' left; right side (ADMIN/ACCOUNTANT only) three global buttons: 'Qaytarish qabul qilish', 'Zavodga qaytarish', red 'Yo'qotilganini undirish'. Below, a 15/9 two-column Row: left small Card 'Mijozlardagi paddonlar' with client-side search in header and a small Table (client name → link to /clients/:id, balance right-aligned bold — orange if >0, red if <0, client-paginated 15 rows) plus a 300px per-row action column duplicating two of the header buttons with the client prefilled; right small Card 'Zavodlar oldidagi hisobdorlik' (hidden for agents) with a compact unpaginated factory balance Table and per-row 'Zavodga qaytarish' button. Bottom: full-width Card 'Paddon harakatlari' — two filter Selects (client, factory; searchable) and a server-paginated movement Table: Sana, Turi (colored Tags: Zavoddan olindi/blue, Mijozga yuborildi/cyan, Mijoz qaytardi/green, Zavodga qaytarildi/purple, Undirildi/red, Tuzatish, Storno/volcano), Mijoz (link), Zavod, Soni, Narx (dona), Buyurtma (link), Izoh. No date-range or type filter, no totals row, no export. All three mutations are centered Modals with vertical forms; client/factory Selects embed the live balance in the option label ('Name (balans: N)'); factory-return and charge-lost show live computed money previews in Alerts (info for factory credit, warning for client debt); unit price prefills a hardcoded 130 000.

PROCUREMENT (/procurement): one Card 'Ta'minot matritsasi' with header-extra region Select (200px, required) and optional product Select (260px, labels 'Name (size) — Factory'). A secondary paragraph states the formula in Uzbek. Until a region is chosen: info Alert 'Taqqoslash uchun hududni tanlang' — the page is otherwise empty. With data: green success banner naming the cheapest (factory — product — landed so'm/m³ for the region), then an unpaginated Table sorted by landed cost asc: Zavod (cheapest row gets green 'Eng arzon' trophy Tag + green row tint), Mahsulot, O'lchami, Zavod narxi, Fura narxi, Sig'imi (paddon), Fura hajmi, Yetkazilgan tannarx (bold). Below, a conditional small Card 'Hisobga kirmagan mahsulotlar' listing dropped products with orange reason Tags ('FACTORY_BANK narxi kiritilmagan' / 'Bu hudud uchun marshrut yo'q'). Entirely read-only — no way to fix the gaps from here, and no route management anywhere.

### Pain points

- [high] Logistics routes have NO UI at all: the matrix depends on LogisticsRoute rows, the API (GET/POST /procurement/routes) is fully built, but no page lists or creates routes — 'Bu hudud uchun marshrut yo'q' dead-ends the user with no fix path.
  - Suggestion: Add a routes management surface (a tab or side panel on the Procurement page): versioned list per factory×region with 'new version' form, and deep-link 'add route' / 'add price' actions directly from each dropped-row reason.
- [high] Factory-wide price change is a click marathon: each product requires open drawer → pick kind → type price → submit (~5 interactions), so repricing 10 products across 2 kinds is ~100 interactions with no bulk entry, no copy-from-current, no percent uplift.
  - Suggestion: Bulk price editor: select factory → editable grid of all its products × 3 kinds pre-filled with current prices, one effectiveFrom, single save creating N versioned rows; plus '+X%' quick action.
- [high] Procurement matrix 'Eng arzon' compares apples to oranges: without the optional product filter, the cheapest banner/trophy picks the single lowest landed cost across DIFFERENT products (a thin partition block always beats a D500 wall block), which is misleading for a purchasing decision.
  - Suggestion: Group the matrix by product (or size class) and mark the cheapest factory WITHIN each product group; keep a global sort toggle.
- [medium] Current-price columns on Products hide their effective dates and any scheduled future prices: findAll only returns prices with effectiveFrom <= now, so a future-dated price is invisible everywhere except deep in the unfiltered history drawer — easy to double-enter or miss.
  - Suggestion: Show effective-from date under each price, badge products with a scheduled upcoming price, and mark the 'current' row plus future rows distinctly in the history (with per-kind tabs instead of one interleaved table).
- [medium] Pallet unit price 130 000 is hardcoded in the Pallets page modals (DEFAULT_PALLET_PRICE constant) and in the API pallet service, while Settings has an editable 'Paddonning standart narxi' used by order creation — changing the setting silently does NOT change the pallet-return/charge prefill.
  - Suggestion: Prefill both modals from the palletPriceDefault setting (single source of truth) and show a hint when the entered price deviates from it.
- [medium] No guard against over-returning pallets: accepting a return larger than the client's balance silently drives the balance negative (rendered red with no explanation); the modal shows the balance only inside the select-option label.
  - Suggestion: Show the selected client's current balance and the post-action balance inside the modal, warn (not necessarily block — adjustments are legitimate) when it would go negative.
- [medium] Pallet movement history is hard to investigate: no date-range or type filter, no qty/money totals for the filtered set, no export/print, and the client filter dropdown is built from the balances payload so inactive clients with settled (zero) balances can't be selected at all.
  - Suggestion: Add date-range + type filters and a totals footer (net in-kind delta, money charged/credited); source the filter options from the clients endpoint; add export.
- [medium] Procurement page is blank until a region is picked and offers no cross-region view, so comparing 'where should this truck go this week' across regions means re-selecting regions one by one and memorizing numbers.
  - Suggestion: Default to the user's most-used region, and offer a pivot view (products × regions → landed cost) or side-by-side region comparison.
- [medium] Money-bearing pallet actions don't surface their ledger consequence afterwards: the transactions table shows unitPrice but never the line total (qty × price) nor a link to the posted LedgerEntry, so verifying 'did the client debt really move by 390 000?' requires mental math plus a trip to the Debts/Client page.
  - Suggestion: Add a computed total column for CHARGED_LOST / RETURNED_TO_FACTORY rows and link to the ledger entry / client balance impact.
- [low] Duplicated and space-hungry actions on Pallets: three global header buttons repeat the per-row buttons, and the 300px per-row action column ('Qaytarish qabul qilish' + 'Undirish') is rendered on every client row including zero-balance ones, crowding the balance table.
  - Suggestion: Collapse row actions into a single kebab/hover menu or a row-click detail panel; keep one primary global action.
- [low] Products search fires only on Enter or the search button (Input.Search onSearch) — typing alone never filters, which surprises users trained by every other searchable Select in the app that filters as you type.
  - Suggestion: Debounced live search (300ms) consistent with the app's Select behavior.
- [low] The add-price form inside the 640px drawer is a horizontal Space that wraps into a ragged two-line layout (210+180px controls + date + button), with the submit button aligned via an empty label hack.
  - Suggestion: Use a proper single-row grid or vertical compact form in the redesign.

### LOCKED RULES

- Price book is append-only and versioned: ProductPrice rows are NEVER updated or deleted; a change = new row with effectiveFrom; unique (productId, kind, effectiveFrom); the current price is the latest row with effectiveFrom <= now. Historical orders forever keep the price in force at their date.
- Exactly three price kinds per product: FACTORY_CASH, FACTORY_BANK, DEALER_SALE — all stored as UZS per m³ with 6 decimal places (do not round to 2dp: 732542.438-style per-m³ prices are real).
- AGENT must never see factory cost prices: the server strips FACTORY_CASH/FACTORY_BANK from /products for agents and limits them to active products; /procurement/matrix is ADMIN/ACCOUNTANT only because it exposes cost prices.
- Product.factoryId is immutable after creation (would break past orders' single-factory invariant); products are soft-deleted only (active=false), never hard-deleted.
- Sale price resolution order at order time: current ClientPrice override (versioned) → current DEALER_SALE book price. Pallets are NEVER billed in saleTotal.
- Pallets are owed IN KIND (counts, not money). Client balance = Σ DELIVERED_TO_CLIENT − Σ RETURNED_BY_CLIENT − Σ CHARGED_LOST + Σ signed (ADJUSTMENT + REVERSAL); factory balance = Σ RECEIVED_FROM_FACTORY − Σ RETURNED_TO_FACTORY + Σ signed (ADJUSTMENT + REVERSAL). Balances are always computed from movements, never stored.
- Every order (one truck) atomically posts TWO pallet movements for the total item palletCount: RECEIVED_FROM_FACTORY (factory side) and DELIVERED_TO_CLIENT (client side), inside the order's own DB transaction.
- Order cancellation posts compensating REVERSAL rows ONLY for the order's own RECEIVED_FROM_FACTORY / DELIVERED_TO_CLIENT movements (qty negated, linked via reversalOfId). Client returns and lost charges are standalone physical/financial facts and are never reversed by a cancel.
- Money enters the pallet world through exactly ONE explicit flow (2026-07-21): CHARGED_LOST → CLIENT account debit (client owes qty × unitPrice), a manual ADMIN/ACCOUNTANT action, default 130 000 UZS. RETURNED_TO_FACTORY posts NO ledger money at all — the factory never pays for pallets, so a return discharges a COUNT and nothing else. `LedgerSource.PALLET_RETURN_CREDIT` is retired: historical rows keep rendering, nothing writes it.
- Order item cost = m³ × costPricePerM3 + palletCount × palletPrice; cost is PROVISIONAL at creation (default kind FACTORY_BANK) and is FIXED only at factory-payment allocation (owner explicitly chose this over lock-at-creation); the provisional→final delta posts a COST_ADJUSTMENT ledger entry.
- quantityM3, when explicitly provided, WINS over palletCount × m3PerPallet; otherwise volume is derived as round3(m3PerPallet × palletCount).
- Landed cost formula (Decimal math, round 2dp): landedCostPerM3 = current FACTORY_BANK pricePerM3 + costPerTruck / (route.capacityPallets × product.m3PerPallet). Products missing a FACTORY_BANK price or a route for the region must be SURFACED as dropped with a reason, never silently hidden.
- LogisticsRoute rows are versioned inserts like prices — never updated or deleted; unique (factoryId, regionId, effectiveFrom); capacityPallets 1–40, defaulting from the truckCapacityPallets app setting (fallback 19).
- All money/volume math uses Prisma.Decimal (never parseFloat); money crosses the API as strings; volumes 3dp, money 2dp, per-m³ prices 6dp.
- Every mutation in the domain writes an AuditLog entry (CREATE/UPDATE/DELETE with before/after snapshots), inside the same transaction where one exists.

### API

- GET /products — paged catalog with current price per kind; role-shaped (AGENT: active only, DEALER_SALE only); filters: factoryId, search
- POST /products — create product (ADMIN/ACCOUNTANT)
- PUT /products/:id — update (factoryId not updatable)
- DELETE /products/:id — soft-deactivate (active=false)
- GET /products/:id/prices — full versioned price history, all three kinds (ADMIN/ACCOUNTANT)
- POST /products/:id/prices — append a versioned price row (kind, pricePerM3, optional effectiveFrom)
- GET /procurement/matrix?regionId&productId — landed-cost comparison matrix + cheapest + dropped rows (ADMIN/ACCOUNTANT only)
- GET /procurement/routes — paged versioned route list (filters: factoryId, regionId) — NOT wired to any UI
- POST /procurement/routes — append a versioned route (factoryId, regionId, costPerTruck, capacityPallets?, effectiveFrom?) — NOT wired to any UI
- GET /pallets/balances — client in-kind balances (+ factory accountability for ADMIN/ACCOUNTANT; AGENT: own clients only)
- GET /pallets/transactions — paged movement history (filters: clientId, factoryId; AGENT scoped to own clients)
- POST /pallets/client-return — RETURNED_BY_CLIENT (qty, date, optional orderId/note; no money)
- POST /pallets/factory-return — RETURNED_TO_FACTORY + FACTORY ledger credit (unitPrice default 130 000)
- POST /pallets/charge-lost — CHARGED_LOST + CLIENT ledger debit (unitPrice default 130 000)

---

## Accounting / Expenses / Legal Entities / Reports (SmartBlok ERP — gas-block dealer finance)

SmartBlok is an ERP for a gas-block (газоблок) dealer that buys from factories and resells to clients through agents. The accounting domain replaces a 21-sheet Excel workbook ("Газоблок Счет.xlsx"). Its heart is an immutable LedgerEntry table (LedgerService): every balance-affecting event posts a signed entry against a CLIENT, FACTORY, or VEHICLE account; balances are never stored, only summed, and corrections are compensating reversal entries that carry the original business date. On top of that: Expenses are cash outflows from a UZS cashbox (each expense atomically writes a CashTransaction OUT with source=EXPENSE, under a SELECT...FOR UPDATE lock with a balance-sufficiency check); voiding is soft (voidedAt + reason) and writes a compensating REVERSAL IN row — there is no update or hard delete. Legal entities (yuridik shaxslar) are a small catalog of firms — the dealer's own firms (DEALER, e.g. "Септем Алока"), factory firms (FACTORY, e.g. "CAOLS KS" MCHJ), and client-side payer firms (THIRD_PARTY) — referenced by cashboxes and by payments as payer/receiver; they are soft-deactivated, never deleted, and every change is audit-logged with before/after snapshots.

Reporting is spread across four surfaces. (1) Reports page (/reports, ADMIN+ACCOUNTANT only) has two tabs: "Svod" — the digital twin of the workbook's Свод Завод master summary: a factory block (goods at cost, pallet money, paid-to-factory including bonus offsets, current factory balance), per-agent collapsible blocks of per-client rows (goods, payments incl. driver-direct, balance, pallet balance), grand totals, and two reconciliation identity checks that must equal 0 (Σ order saleTotal vs Σ per-client goods; Σ client payments vs Σ per-client payments) — the Excel version of these checks ("фарк") was chronically broken, so keeping them at 0 is a core system promise; and "Buyurtmalar reestri" — a flat, paged, 22-column register of orders/trucks (the Товар ledger shape) with per-m³ prices back-solved from totals, goods profit (saleTotal − costTotal), transport cost vs charge, and cost/transport statuses. Both tabs export to xlsx. (2) Debts page (/debts) shows six company liability/asset headline cards plus a per-client debt table with overdue/due-soon flags and an "expected collections within N days" figure. (3) Dashboard carries the P&L-like KPIs — goods profit and transport profit for the current month (transport profit = transportCharge − transportCost, deliberately reported separately from goods profit) — plus a per-agent monthly performance ranking (sales, goods profit, collected, outstanding debt, order count). (4) Ledger statements per party (opening balance, running entries, closing balance) via /debts/statement, used on client/factory detail pages. Notably there is NO consolidated P&L report: operating expenses are never joined against profit anywhere.

The UI language is Uzbek in Latin script throughout ("Xarajatlar", "Yuridik shaxslar", "Hisobotlar", "Qarzlar", "Bekor qilish"), with Russian loanwords inherited from the workbook ("Svod", "reestr", "storno", "paddon" = поддон/pallet, "shofyor" = шофёр/driver); the project docs are written in Uzbek and the legacy Excel terms are Russian/Cyrillic. Money is UZS (so'm) with a separate USD channel; all report date windows are Tashkent-local calendar days. Frontend is React + Ant Design + TanStack Query; backend NestJS + Prisma/PostgreSQL with Decimal math and a default-deny roles guard.

### Entities

- **Expense** — A cash expense paid out of a kassa (cashbox). Creation atomically writes a CashTransaction OUT (source=EXPENSE); only allowed from an active UZS cashbox with sufficient balance.
  - Fields: date; amount Decimal(18,2) > 0; categoryId (optional); cashboxId (required on create); note; voidedAt / voidReason; createdById; importBatchId
  - States: active (voidedAt=null) | voided (soft-void + compensating REVERSAL cash row)
- **ExpenseCategory** — Flat catalog for classifying expenses (unique name). Hard delete allowed only when no expense references it.
  - Fields: name (unique); _count.expenses (usage count returned by API)
- **LegalEntity** — Firms involved in money flows: dealer's own firms, factory firms, third-party payer firms. Referenced by cashboxes (owner) and payments (payer/receiver). Soft-delete only; all changes audit-logged.
  - Fields: name (unique); kind: DEALER | FACTORY | THIRD_PARTY; inn (tax id, optional); note; active
  - States: active | inactive (soft-deleted)
- **Cashbox** — A till/account money sits in (kassa). Expenses draw from it; balance = Σ IN − Σ OUT of its CashTransactions.
  - Fields: name (unique); type: CASH|BANK|CLICK|TERMINAL|CARD; currency: UZS|USD; entityId → LegalEntity; active
  - States: active | inactive
- **CashTransaction** — Immutable kassa movement row. Expense create → OUT/EXPENSE; expense void → IN/REVERSAL linked via unique reversalOfId (idempotent).
  - Fields: cashboxId; direction IN|OUT; amount (in box currency, >0); source: MANUAL|PAYMENT|EXPENSE|BONUS_WITHDRAWAL|REVERSAL; expenseId/paymentId/bonusTransactionId; reversalOfId (unique)
- **LedgerEntry (via LedgerService)** — Single source of truth for all party balances. Signed amount: >0 = they owe dealer, <0 = dealer owes. Immutable; corrections are compensating reversals keeping the original business date.
  - Fields: account: CLIENT|FACTORY|VEHICLE; source (ORDER, PAYMENT, PALLET_CHARGE, BONUS_OFFSET, ADJUSTMENT, IMPORT...); amount signed Decimal; clientId/factoryId/vehicleId (exactly one, matching account); reversalOfId
- **Svod report (computed)** — Master reconciliation report = workbook's Свод Завод. Factory block + per-agent client blocks + grand totals + two identity checks that must be 0.
  - Fields: factories[]: goods (m³ × finalCostPricePerM3??costPricePerM3), pallets money, goodsWithPallets, paidToFactory (FACTORY_OUT incl. BONUS offsets), factoryBalance (current ledger); agents[]: rows{client, goods, payments, driverDirect, balance, palletBalance} + subtotal; totals; checks.goodsIdentity / checks.paymentsIdentity (must be 0); from/to bound flows only; balances always current
- **OrdersRegister row (computed)** — Flat one-row-per-order/truck ledger (Товар sheet shape) for review and xlsx export.
  - Fields: orderNo, date, status, agent, client, factory, plate, driver, sizes; m3, costPrice & salePrice (back-solved per-m³, 6dp); costTotal + costStatus (provisional until factory-payment allocation); pallets, palletMoney; saleTotal, transportCost, transportCharge, transportPaidStatus; goodsProfit = saleTotal − costTotal
- **Debts summary / client rows (computed)** — Company debt overview + per-client collection worklist over the ledger.
  - Fields: clientsOweUs / weOweClients / factoryAdvance / weOweFactories / weOweVehicles / palletsAtClients; per client: balance, palletBalance, hasOverdueOrders (dueDate < now), overdue count/total, dueWithinWindow, expectedCollections(days)
- **Agent ranking row (computed)** — Per-agent monthly performance (Tashkent calendar month): sales, goods profit, collected, outstanding client debt, order count; sorted by sales.
  - Fields: month; sales; goodsProfit = sales − cost; collected (CLIENT_IN); outstandingDebt (Σ positive client balances); orders

### Workflows

- **Record an expense** (CASHIER, ACCOUNTANT, ADMIN; many times/day)
  1. Open Xarajatlar page → click 'Yangi xarajat' (top-right primary button)
  1. Modal form: date (default today), amount (thousands-grouped InputNumber), optional category (Select with inline '+' to add a new category without leaving the form), cashbox (only active UZS boxes offered), optional note
  1. Submit → API validates: box exists, active, currency=UZS, category exists if given; locks the cashbox row (FOR UPDATE), computes balance from cash transactions, rejects if insufficient
  1. Expense + CashTransaction(OUT, source=EXPENSE) + audit log written in one DB transaction
  1. UI invalidates expenses/kassa/dashboard queries and shows a success toast
- **Void (cancel) an expense** (ADMIN, ACCOUNTANT; rare)
  1. On the expense row click the red 'Bekor qilish' button (only visible on non-voided rows to ADMIN/ACCOUNTANT)
  1. modal.confirm shows date/amount/category recap and a mandatory reason textarea; explains a storno (reversal) kassa row will be created
  1. API sets voidedAt/voidReason, finds the original OUT cash row and writes a compensating IN (source=REVERSAL, reversalOfId — idempotent), audit-logs with before/after
  1. Row stays in the list rendered struck-through with a red 'Bekor qilingan' tag (reason in tooltip)
- **Manage expense categories** (ADMIN, ACCOUNTANT; rare)
  1. Inline: from the new-expense modal press '+' → mini-modal with one name field → created category auto-selected in the form
  1. API also supports rename (PUT) and delete (DELETE, refused with a count message if any expense uses it) — but the current UI exposes only create; rename/delete have no screen
- **Maintain legal entities** (ADMIN, ACCOUNTANT; rare)
  1. Navigate Katalog → Yuridik shaxslar
  1. Click 'Yangi yuridik shaxs' or the row edit icon → modal: name, kind (Diler firmasi / Zavod firmasi / Uchinchi tomon), INN, note; edit mode adds an Active switch
  1. Deactivate via the row stop-icon → confirm dialog ('payment history is preserved'); UI calls update{active:false} (the dedicated DELETE endpoint does the same soft-deactivation)
  1. All writes audit-logged with full before/after JSON snapshots
- **Run the Svod reconciliation report** (ADMIN, ACCOUNTANT; daily)
  1. Reports → Svod tab (default range: current month-to-date, Tashkent-local)
  1. Review 'Zavodlar bloki' table: per-factory goods at cost / pallet money / total / paid / current balance, with a Jami summary row
  1. Expand each agent panel in 'Agentlar bo'yicha mijozlar' Collapse to see per-client goods/payments/driver-direct/balance/pallets with per-agent subtotals; unassigned clients appear under 'Biriktirilmagan'
  1. Check 'Umumiy natijalar va tekshiruvlar' Descriptions card: grand totals + two identity checks rendered as green 'Mos (0)' or red 'Farq: X so\'m' tags
  1. Optionally click 'Excel (svod.xlsx)' to download a flattened multi-sheet export
- **Review / export the orders register** (ADMIN, ACCOUNTANT; daily)
  1. Reports → 'Buyurtmalar reestri' tab
  1. Filter: date range (default month-to-date), client (server-searched Select), factory Select
  1. Scan the 22-column horizontally-scrolling table (m³, cost & sale per-m³ and totals, cost status, pallets & pallet money, transport cost/charge/status, per-order goods profit, order status)
  1. Click 'Excel (orders-register.xlsx)' — server re-queries all pages (up to 500×200 rows) and streams one xlsx sheet
- **Monitor debts and collections** (ADMIN, ACCOUNTANT, AGENT (own clients only, no summary cards); many times/day)
  1. Open Qarzlar page: six headline cards (clients owe us / we owe clients / factory advance / we owe factories / we owe vehicles / pallets at clients) — ADMIN/ACCOUNTANT only
  1. Client table sorted by debt desc, filtered to rows with a non-settled balance, pallets, or overdue orders; red/gold tags for overdue ('Muddati o'tgan') and due-soon ('Muddati yaqin')
  1. Pick the 7/14/30-day window to update 'Kutilayotgan tushum' (expected collections)
  1. Click a client name → client detail page (ledger statement with opening/closing balance available via /debts/statement)
- **Review agent performance** (ADMIN, ACCOUNTANT; weekly)
  1. Dashboard (ADMIN/ACCOUNTANT view) shows the agents-ranking table for the current Tashkent-local month: sales, goods profit, collected, outstanding debt, order count, sorted by sales
  1. Month is a query parameter on the API (GET /dashboard/agents-ranking?month=YYYY-MM) but the current dashboard UI does not expose a month picker

### Roles

- **ADMIN**: Everything in the domain: expense list/create/void, category CRUD, legal entity CRUD/deactivate, both reports + xlsx exports, debts summary/clients/statement, dashboard incl. agents ranking.
- **ACCOUNTANT**: Identical to ADMIN inside this domain (finance owner role): expense create/void, category CRUD, legal entity write, reports, debts, agent ranking.
- **CASHIER**: Expenses: view list, view categories, create expense (cannot void, cannot manage categories). Legal entities: read-only list (needed for payment forms per API comment). Dashboard: /dashboard/kassa only. No access to /reports, /debts summary, legal-entity pages (nav hides them; routes guarded).
- **AGENT**: No access to expenses, legal entities, or the Reports page. Debts: clients list and CLIENT statements scoped to own clients only (assertOwnAgent; FACTORY/VEHICLE statements explicitly forbidden). Dashboard summary/trends auto-scoped to own agentId with company liabilities zeroed.

### Current UI

Pages: /expenses — 'Xarajatlar' (apps/web/src/pages/Expenses.tsx), /legal-entities — 'Yuridik shaxslar', nested under the 'Katalog' sidebar submenu (apps/web/src/pages/LegalEntities.tsx), /reports — 'Hisobotlar' with two tabs: 'Svod' and 'Buyurtmalar reestri' (apps/web/src/pages/Reports.tsx), /debts — 'Qarzlar' debt report (apps/web/src/pages/Debts.tsx), Dashboard (/) — carries the P&L-ish KPIs (goods profit month, transport profit month) and the agents-ranking table (apps/web/src/pages/Dashboard.tsx)

All pages live inside an AntD sider-layout shell (AppShell) with an Uzbek-language nav menu and a command palette. EXPENSES: page title row ('Xarajatlar' + primary 'Yangi xarajat' button top-right), then one Card containing a horizontal filter strip (note-text search 240px, category Select, cashbox Select, date RangePicker) above a small, x-scrolling (900px min) paginated table: Sana, Kategoriya (Tag), Summa (right-aligned Money + so'm), Kassa, Izoh (ellipsis), Holat (green 'Faol' / red 'Bekor qilingan' tag with reason in a tooltip), and a per-row red 'Bekor qilish' button. Voided rows are struck-through at 55% opacity and always mixed into the list (includeVoided is hard-coded true, no toggle). Creation is a centered Modal with a vertical 5-field form; adding a category opens a second stacked Modal. Voiding uses modal.confirm with an uncontrolled TextArea for the reason. No totals, KPIs, or export anywhere on the page. LEGAL ENTITIES: a single Card whose header holds the title, a name/INN search input, and the create button; body is a client-side-filtered table (Nomi, Turi as colored Tag, INN, Izoh, Holat tag, Amallar = icon-only edit + deactivate buttons). Create/edit share one Modal (name, kind Select, INN, note, Active switch only when editing). Whole catalog loads unpaged from the API; pagination is client-side. REPORTS: one Card with AntD Tabs. Svod tab: filter strip (RangePicker defaulting to month-to-date + 'Excel (svod.xlsx)' download button); then a 'Zavodlar bloki' Card with a non-paginated 6-column factory table and bold Jami summary row; then an 'Agentlar bo'yicha mijozlar' Card containing an Accordion/Collapse — one panel per agent (header shows agent name, client-count Tag, subtotal balance), each panel holding a 6-column client table with its own summary row — all panels collapsed by default; finally an 'Umumiy natijalar va tekshiruvlar' Card with a bordered Descriptions grid (grand totals, period, and the two identity checks rendered as green 'Mos (0)' / red 'Farq: …' tags). Register tab: filter strip (RangePicker, server-search client Select, factory Select, xlsx button) over a 22-column size='small' table with scroll x=2400 (only Sana and № are left-fixed), status Tags for cost/transport/order state, right-aligned tabular numbers, standard pagination; no summary row and no column customization. DEBTS: title, a 6-card KPI grid (responsive Row/Col, red/orange/green Text colors), then a Card with search + a 7/14/30-day Select on the left and the 'Kutilayotgan tushum' figure on the right, above a paginated table (client name links to /clients/:id, agent, region, phone, color-coded balance, pallet count, overdue/due-soon tags, payment-term days). Everything is data-dense AntD default styling; forms are modals (no drawers), destructive actions use confirm dialogs, feedback via message toasts, all queries via TanStack Query with error Alerts + 'Qayta urinish' retry buttons.

### Pain points

- [high] No consolidated P&L anywhere: goods profit and transport profit live only as current-month Dashboard KPIs, per-order profit only as a register column, and operating expenses are joined against nothing — a user cannot answer 'what did we actually earn in period X' without exporting several screens to Excel.
  - Suggestion: Add a P&L report with a period picker: sales − goods cost − transport net − expenses (by category), reusing the exact existing formulas (goodsProfit = saleTotal − costTotal; transport = charge − cost) and clearly labeling which profit definition is used (excel-spec §8 warns the workbook's differs).
- [high] Expenses page has zero aggregation: no total for the filtered range, no per-category breakdown, no export. The docs even specify a summary endpoint (FR-EXP-02 GET /expenses/summary) that the v3 API no longer has. Counting 'this month's expenses' means paging through the table.
  - Suggestion: Show a filtered-total KPI and per-category subtotal chips above the table; restore a summary endpoint or aggregate server-side alongside the paged list; add xlsx export like the reports have.
- [high] Legal-entity catalog is write-only from the UI: payments API accepts payerEntityId/receiverEntityId (and CASHIER can read the catalog specifically 'for payment forms'), but the Payments screen never offers entity pickers — only free-text payerName/receiverName. Entity links are populated solely by the Excel importer, so the carefully-audited catalog drives nothing day-to-day.
  - Suggestion: In the redesigned payment form, make payer/receiver entity a searchable Select over active legal entities (with free-text fallback), so bank-payment attribution to Септем/CAOLS firms stops depending on typed names.
- [medium] Svod agent blocks are all collapsed by default with no expand-all: seeing the whole picture (the report's entire purpose — it replaces one Excel sheet visible at a glance) requires opening each agent panel one click at a time; client rows also have no link to the client card or ledger statement, and factory rows no link to factory detail.
  - Suggestion: Render agent blocks expanded (or as one grouped table with sticky agent subtotal rows) and hyperlink every client/factory name to its detail/statement page for drill-down.
- [medium] Orders register is a 2400px-wide 22-column wall with no summary row, no column chooser, and no per-period totals — to know total m³, sales, or profit for the filtered range the user must download the xlsx and sum it themselves.
  - Suggestion: Add a totals summary row (server-computed for the whole filter, not just the page), column show/hide presets ('money view', 'logistics view'), and keep the two fixed columns.
- [medium] The svod.xlsx export is a generic flatten (sheet 'Svod' of section/metric/value triples plus auto-generated sheets with raw JSON keys like goodsWithPallets) — it looks nothing like the Свод Завод layout the accountant has used for years and needs manual reshaping.
  - Suggestion: Export a formatted workbook mirroring the on-screen report: factory block, agent blocks with subtotals, totals and фарк checks, localized headers.
- [medium] Date-basis inconsistency across the domain: Reports/Dashboard parse from/to as Tashkent-local days (parseTashkentFrom/To), but the Expenses list filter uses raw UTC day boundaries (dayStart/dayEnd on the date string). An expense logged late evening local time can land in a different 'day' than the orders/payments next to it, silently breaking daily cross-checks.
  - Suggestion: Unify all date-range filtering on the Tashkent-local helpers (UI change only passes strings; the redesign should surface one consistent day convention and document it in the UI).
- [low] Voided expenses are always mixed into the list (includeVoided hard-coded 'true') with no UI toggle, even though the API supports excluding them; conversely there is no way to see only voided rows for review. The void dialog also captures the reason in a plain uncontrolled textarea with validation only on submit.
  - Suggestion: Add an 'include voided' filter (three-state: hide / show / only) and a proper small form in the void dialog with inline required validation.
- [medium] Category management is half-hidden: rename (PUT) and delete (DELETE with usage guard) endpoints exist but have no screen anywhere — the only UI is the '+' inside the new-expense modal, a modal stacked on a modal. Categories with typos live forever.
  - Suggestion: Give categories a small management surface (list with usage counts — the API already returns _count.expenses — inline rename, delete-when-unused) either on the Expenses page or in the catalog section.
- [low] Legal entity deactivation has two duplicate paths with different affordances: the row stop-button calls update{active:false} (not the dedicated DELETE endpoint) and the edit modal separately exposes an Active switch — same action, two flows, and reactivation is only discoverable inside the edit modal.
  - Suggestion: Consolidate into one clear activate/deactivate toggle with a confirm, and show inactive entities visually separated (filter default: active only, since inactive still appear in the single unpaged list).
- [medium] Agent performance ranking is buried on the Dashboard fixed to the current month — the API accepts ?month= but the UI has no month picker, so historical comparison (last month vs this month) is impossible without curl.
  - Suggestion: Move/duplicate agents-ranking into the Reports area with a month picker and simple month-over-month deltas.
- [low] Reports and Debts are separate top-level pages with different role gates, while the Svod already shows per-client balances — accountants effectively see the same debt data in two disconnected layouts (Debts table vs Svod agent blocks) with no navigation between them.
  - Suggestion: In the redesign, treat Debts, Svod and statements as one 'financial reports' hub with shared filters and cross-links, keeping the AGENT-scoped debts view as its own simplified screen.

### LOCKED RULES

- Expenses may only be paid from an ACTIVE cashbox whose currency is UZS; amount must be strictly positive (Decimal, 2dp); creation is rejected if the cashbox balance would go negative — checked inside a transaction holding SELECT ... FOR UPDATE on the Cashbox row (same lock as manual kassa OUT).
- Expense + CashTransaction(OUT, source=EXPENSE) are written atomically in one DB transaction; there is NO expense update endpoint and NO hard delete — only soft-void (voidedAt + mandatory reason) which writes a compensating CashTransaction(IN, source=REVERSAL) linked by unique reversalOfId (idempotent: never two reversals). Every create/void is audit-logged.
- Expense categories have unique names and may be hard-deleted only when zero expenses reference them (API refuses with the usage count).
- Legal entities have unique names and are NEVER hard-deleted (payments/cashboxes reference them) — deactivate (active=false) only; every create/update/deactivate is audit-logged with full before/after JSON snapshots.
- All party balances (client/factory/vehicle) are sums over the immutable LedgerEntry table — never stored/cached; corrections are compensating reversal entries that carry the ORIGINAL business date (so date-windowed statements net to zero); a ledger posting of exactly 0 is rejected; each entry references exactly one party matching its account type.
- Debt is recognized at ORDER CREATION: every report (svod, register, debts, dashboard, ranking) counts all orders with status != CANCELLED; cancelled orders and their reversed postings drop out of all math (soft-cancel, never hard delete).
- Svod reconciliation identities must be 0 by construction and must remain visible checks: (1) Σ order saleTotal == Σ per-client goods column; (2) Σ client payments (CLIENT_IN + TRANSPORT_DIRECT, non-voided) == Σ per-client payments column. These replace the workbook's broken фарк rows (excel-spec §6/§9) — a non-zero value flags orphaned rows and is a defect signal, not a display option.
- Svod factory 'goods' is valued at best-known factory cost: quantityM3 × (finalCostPricePerM3 ?? costPricePerM3) — cost is provisional until factory-payment allocation finalizes it (owner chose cost-at-payment-allocation over lock-at-creation); pallet money = palletCount × palletPrice is tracked as a separate column and IS included in the headline factory balance.
- 'Paid to factory' includes PaymentKind=FACTORY_OUT with method=BONUS (bonus-wallet debt offsets, which have no cashbox row); voided payments are always excluded everywhere (voidedAt=null filters).
- TRANSPORT_DIRECT payments (client pays the driver, «шопр учун барди») post NO ledger rows — the client's debt was already reduced by the TRANSPORT_CLIENT_DIRECT carve-out at order creation ([TRANSPORT MODEL — AUTHORITATIVE](#transport-authoritative)); in svod they are still shown as the driverDirect sub-column and still count in the svod payments identity (rule above), because that identity reconciles *money the client handed over*, not ledger movement — but they must never be re-used as a debt-reducing allocation (`CLIENT_SETTLING_KINDS = [CLIENT_IN]` only), or the transport slice is subtracted twice.
- Goods profit = saleTotal − costTotal (costTotal includes pallet money — the dashboard definition); net profit subtracts transportCost, which is priced INSIDE saleTotal in every live mode. Reports must label which profit definition is used.
- Client pallet balance (units, in kind — never money): Σ DELIVERED_TO_CLIENT − Σ RETURNED_BY_CLIENT − Σ CHARGED_LOST + Σ signed ADJUSTMENT/REVERSAL; factory-side pallet movements never affect client counters.
- |balance| < 1 UZS counts as settled (float residue from back-solved lump-sum prices, excel-spec §10.7) — isSettled() gates debts filters and the svod check tags.
- Report date filters are Tashkent-local calendar days (from inclusive, to exclusive via parseTashkentFrom/To); svod date range bounds FLOWS (orders/payments) only — balance columns are always CURRENT ledger sums regardless of the range.
- Role gates (default-deny RolesGuard, every route explicit): /reports/* and /debts/summary → ADMIN+ACCOUNTANT only; expense void and category/legal-entity writes → ADMIN+ACCOUNTANT; expense list/create and legal-entity read include CASHIER; debts clients/statement include AGENT but scoped to own clients (AGENT may never read FACTORY/VEHICLE statements); AGENT dashboards hide company-wide liabilities.
- Per-m³ prices in the orders register are back-solved from totals at 6dp (workbook keeps fractional negotiated prices like 729 928.1 — lump-sum entry with derived unit price must stay exact).

### API

- GET /expenses — paged expense list; filters: categoryId, cashboxId, dateFrom/dateTo (inclusive day), search (note, case-insensitive), includeVoided; roles ADMIN/ACCOUNTANT/CASHIER
- POST /expenses — create expense + atomic kassa OUT row (UZS-only, balance-checked); roles ADMIN/ACCOUNTANT/CASHIER
- POST /expenses/:id/void — soft-void with mandatory reason + compensating REVERSAL cash row; roles ADMIN/ACCOUNTANT
- GET /expenses/categories — unpaged categories with usage counts; roles ADMIN/ACCOUNTANT/CASHIER
- POST /expenses/categories — create category (unique name); roles ADMIN/ACCOUNTANT
- PUT /expenses/categories/:id — rename category; roles ADMIN/ACCOUNTANT
- DELETE /expenses/categories/:id — hard-delete category only if unused; roles ADMIN/ACCOUNTANT
- GET /legal-entities — unpaged catalog (payment forms need full list); roles ADMIN/ACCOUNTANT/CASHIER
- POST /legal-entities — create (name unique, kind, inn, note); roles ADMIN/ACCOUNTANT
- PUT /legal-entities/:id — update incl. active flag; roles ADMIN/ACCOUNTANT
- DELETE /legal-entities/:id — soft-deactivate (active=false), audit-logged; roles ADMIN/ACCOUNTANT
- GET /reports/svod?from&to — Свод Завод equivalent: factory block, per-agent client blocks, totals, identity checks; roles ADMIN/ACCOUNTANT
- GET /reports/svod.xlsx — flattened multi-sheet Excel export of svod; roles ADMIN/ACCOUNTANT
- GET /reports/orders-register?from&to&clientId&factoryId&page&pageSize — flat paged order/truck register; roles ADMIN/ACCOUNTANT
- GET /reports/orders-register.xlsx — full-filter Excel export (server pages through all rows); roles ADMIN/ACCOUNTANT
- GET /debts/summary — six headline figures (clientsOweUs, weOweClients, factoryAdvance, weOweFactories, weOweVehicles, palletsAtClients); roles ADMIN/ACCOUNTANT
- GET /debts/clients?search&days&page — per-client debt rows + overdue flags + expectedCollections for the window; roles ADMIN/ACCOUNTANT/AGENT (agent-scoped)
- GET /debts/statement?account&partyId&from&to — ledger statement with opening/running/closing balance; roles ADMIN/ACCOUNTANT/AGENT (CLIENT-own only)
- GET /dashboard/summary — KPIs incl. goodsProfitMonth and transportProfitMonth; roles ADMIN/ACCOUNTANT/AGENT (scoped)
- GET /dashboard/agents-ranking?month=YYYY-MM — per-agent monthly sales/profit/collected/debt/orders; roles ADMIN/ACCOUNTANT
- GET /dashboard/trends?days — daily sales/orders/collected buckets (Tashkent days); roles ADMIN/ACCOUNTANT/AGENT
- GET /dashboard/kassa — per-cashbox balances + today's in/out; roles ADMIN/ACCOUNTANT/CASHIER

---

## Factory operations & versioned factory-bonus system (SmartBlok ERP — gas-block dealer back office)

SmartBlok is a dealer-side ERP for a gas-block (газоблок) reseller in Uzbekistan. The FACTORY domain manages the dealer's supplier factories: each Factory is a counterparty with an immutable double-entry-style ledger (LedgerEntry, account=FACTORY) whose signed sum is the settlement balance — positive means the dealer holds an advance at the factory, negative means the dealer owes it. Factory debt is recognized the moment an order is booked: order creation posts ORDER_COST (negative) for blocks + pallet money at a PROVISIONAL price chosen by the order's intended payment method (CASH → FACTORY_CASH price, anything else → FACTORY_BANK price, from the versioned ProductPrice book). The cost is only FIXED later, when a dealer→factory payment (FACTORY_OUT) is allocated to the order: the latest active allocation's method decides cash-vs-bank price kind, items get finalCostPricePerM3, the provisional→final delta posts as a COST_ADJUSTMENT ledger entry, and costStatus walks PROVISIONAL→PARTIAL→FINAL. Pallets are owed in kind (counts); money enters the factory ledger only via the invoice (palletPrice inside ORDER_COST, default 130,000 UZS) and via PALLET_RETURN_CREDIT when pallets are physically returned to the factory. Factories are never hard-deleted, only deactivated.

The BONUS system is a per-factory loyalty rebate wallet. Each factory has a VERSIONED bonus program: BonusProgram rows are append-only inserts (never updated, unique on factoryId+effectiveFrom) of kind NONE, PER_M3 (fixed UZS per m³ purchased) or PERCENT (percent of the blocks-only purchase amount, pallet money always excluded). Versioning is explicitly non-retroactive: the program in force (latest effectiveFrom ≤ completedAt) at the moment an order reaches COMPLETED governs that order's accrual forever. Accrual is automatic inside the order-status transaction: entering COMPLETED creates a signed ACCRUAL BonusTransaction (idempotent — skipped if an un-reversed accrual exists), recording its audit base (baseM3 or baseAmount plus programId); leaving COMPLETED or cancelling creates a compensating REVERSAL. Because PERCENT accruals are computed on the then-best-known cost, later cost finalization (or void/un-finalization) posts a traceable ADJUSTMENT transaction so the wallet always equals percent × best-known blocks cost, with the original ACCRUAL untouched. Wallet balance is simply Σ signed BonusTransaction amounts per factory.

The wallet can be spent two ways, both ADMIN/ACCOUNTANT-only and serialized by a per-factory row lock so the balance can never go negative: (1) WITHDRAWAL — the factory pays the bonus out in cash, which enters an active UZS-only dealer cashbox as a CashTransaction (source BONUS_WITHDRAWAL); (2) DEBT_OFFSET — the wallet is applied against the dealer's debt to the same factory via a canonical chain Payment(kind=FACTORY_OUT, method=BONUS, no cashbox) → LedgerEntry(BONUS_OFFSET, positive) → BonusTransaction(DEBT_OFFSET, negative). The BONUS payment method is rejected by the generic payments endpoint — offsets are born only in the bonus module. Mistaken withdrawals are reversed through a dedicated endpoint (restores the wallet, compensates the kassa row, guarded against driving the cashbox negative); DEBT_OFFSETs are reversed by voiding their payment; ACCRUALs by the order lifecycle. Every mutation is audit-logged.

The current UI consists of three Ant Design pages — /factories (list), /factories/:id (detail with tabs), /bonus (wallet cards + transaction journal) — gated to ADMIN/ACCOUNTANT (AGENT gets only {id,name,active} from the API for the order form). The entire UI is in Uzbek (Latin script): "Zavodlar" (factories), "Bonus hamyonlar" (bonus wallets), "Hisob-kitob" (statement), "Paddonlar" (pallets, dialectal for pallets), amounts in UZS "so'm"; the project documentation is also Uzbek, with occasional Russian loan-terms surviving in imported data. A redesign must preserve the ledger/wallet math and the versioned, non-retroactive program semantics exactly.

### Entities

- **Factory** — Supplier factory counterparty. Carries no financial fields itself — balance, bonus wallet and pallet accountability are all derived sums.
  - Fields: id; name (unique); note; active; derived: balance = Σ LedgerEntry(FACTORY) — >0 advance / <0 dealer owes; derived: bonusBalance = Σ BonusTransaction.amount; derived: palletsHeld = Σ RECEIVED_FROM_FACTORY − Σ RETURNED_TO_FACTORY (+ signed adjustments in pallet module)
  - States: active | inactive (soft-deleted — never hard-deleted)
- **BonusProgram** — Versioned bonus rule for one factory. Append-only: every change is a new row with a later effectiveFrom; rows are never updated and never retroactive. The row in force at order completion governs that order's accrual forever.
  - Fields: factoryId; kind; ratePerM3 (Decimal 18,2 — PER_M3 only); percent (Decimal 5,2, 0<p≤100 — PERCENT only); effectiveFrom (unique per factory); createdBy/createdAt
  - States: kind: NONE (program off) | kind: PER_M3 (fixed UZS per m³) | kind: PERCENT (% of blocks-only purchase amount)
- **BonusTransaction** — Signed movement in a factory's bonus wallet; wallet balance = Σ amount. Records the accrual audit base (baseM3/baseAmount + programId) and reversal links.
  - Fields: factoryId; type; amount (signed: ACCRUAL/positive ADJUSTMENT +, WITHDRAWAL/DEBT_OFFSET −); baseAmount / baseM3 (what the accrual was computed from); orderId; programId; paymentId (unique — DEBT_OFFSET's BONUS payment); reversalOfId (unique); cashTransactions (withdrawal kassa rows)
  - States: ACCRUAL (on order COMPLETED) | WITHDRAWAL (cash out via kassa) | DEBT_OFFSET (applied to same factory's debt) | ADJUSTMENT (cost-finalization re-derive, signed) | REVERSAL (compensating entry) | reversed / un-reversed (via reversalOfId link)
- **LedgerEntry (account=FACTORY)** — Immutable settlement postings with the factory. Balance is a sum, never stored; corrections are compensating reversal entries carrying the original business date.
  - Fields: date + at; source (ORDER_COST, COST_ADJUSTMENT, PAYMENT, PAYMENT_VOID, BONUS_OFFSET, PALLET_RETURN_CREDIT, ORDER_CANCEL, ADJUSTMENT, IMPORT); amount (signed: >0 dealer's asset/advance, <0 dealer owes); factoryId; orderId / paymentId / palletTransactionId links; reversalOfId
- **Payment (factory kinds)** — FACTORY_OUT (dealer pays factory, +ledger) and FACTORY_REFUND (factory returns money, −ledger). method=BONUS is the special no-cashbox debt-offset payment created only by the bonus module. Never hard-deleted — void posts compensating rows everywhere.
  - Fields: kind; method (CASH/BANK/CLICK/TERMINAL/CARD/USD/BONUS); amount (UZS); factoryId; cashboxId (null for BONUS); voidedAt/voidReason; allocations
  - States: active | voided
- **PaymentAllocation (FACTORY_OUT)** — Ties a factory payment to specific orders and fixes their cost basis: priceKind derived from the payment method (CASH/CARD/... → FACTORY_CASH, else FACTORY_BANK). Drives costStatus PROVISIONAL→PARTIAL→FINAL; latest active allocation's kind wins at finalize.
  - Fields: paymentId; orderId; amount; priceKind; voidedAt
  - States: active | voided (rows kept)
- **OrderItem (cost side)** — Carries the purchase-pricing lifecycle: provisional cost at creation (intended-method price from the versioned ProductPrice book at order date), finalized by allocation; the PERCENT bonus base is Σ quantityM3 × (finalCostPricePerM3 ?? costPricePerM3), blocks only.
  - Fields: quantityM3 (12,3); palletCount / palletPrice (default 130 000); provisionalPriceKind; costPricePerM3; finalCostPricePerM3; costTotal = m³×costPrice + pallets×palletPrice
  - States: order.costStatus: PROVISIONAL | PARTIAL | FINAL
- **PalletTransaction (factory side)** — In-kind pallet accountability with the factory: pallets received with purchases vs physically returned; returning posts a linked PALLET_RETURN_CREDIT money entry to the factory ledger.
  - Fields: type (RECEIVED_FROM_FACTORY / RETURNED_TO_FACTORY / ADJUSTMENT / REVERSAL); qty; unitPrice (default 130 000 UZS); factoryId; date

### Workflows

- **Automatic bonus accrual / reversal on order lifecycle** (system (triggered by whoever changes order status: ADMIN, ACCOUNTANT, AGENT); many times/day)
  1. User moves an order to COMPLETED (order status flow, outside this domain's pages)
  1. Inside the same DB transaction, BonusService.accrueForOrder finds the program in force at completedAt (latest effectiveFrom ≤ completedAt; NONE ⇒ no accrual)
  1. PER_M3: amount = ratePerM3 × Σ item m³ (rounded 3dp then 2dp); PERCENT: amount = percent% × Σ(m³ × best-known blocks cost per item), pallets excluded
  1. A signed ACCRUAL BonusTransaction is created with baseM3/baseAmount + programId as the audit base (idempotent — skipped if an un-reversed accrual exists)
  1. If the order later leaves COMPLETED or is cancelled, a compensating REVERSAL transaction negates the accrual
- **Bonus ADJUSTMENT on purchase-cost finalization** (ACCOUNTANT, ADMIN; daily)
  1. Accountant records a FACTORY_OUT payment and allocates it to orders (Payments page)
  1. Allocation engine fixes each order's cost at cash-vs-bank price (latest active allocation's method wins; order date resolves the price-book row) and posts the COST_ADJUSTMENT ledger delta
  1. For completed orders with a PERCENT accrual, adjustBonusForOrder recomputes expected = percent × blocks-only best-known cost, compares against accrual + prior adjustments, and posts the delta as a BonusTransaction ADJUSTMENT (original ACCRUAL immutable)
  1. Voiding the payment un-finalizes cost and posts the opposite adjustment the same way
- **Set / change a factory's bonus program** (ADMIN, ACCOUNTANT; rare (per-factory renegotiation))
  1. Navigate Zavodlar → click factory name → 'Bonus dasturi' tab
  1. Click 'Yangi dastur' (New program) — modal warns the change is non-retroactive
  1. Pick kind via radio buttons (PER_M3 / PERCENT / NONE), enter rate or percent, optionally set effectiveFrom date (defaults today)
  1. POST /factories/:id/bonus-program inserts a NEW BonusProgram row (never updates); unique (factoryId, effectiveFrom) rejects a duplicate same-moment version
  1. History table and current-program card refresh; only orders completed after effectiveFrom use the new rule
- **Withdraw bonus as cash (Naqd yechish)** (ADMIN, ACCOUNTANT; weekly)
  1. Open /bonus page → 'Naqd yechish' button → modal
  1. Select factory (label shows wallet balance), enter amount (client-side max check against wallet), select an active UZS cashbox, date, optional note
  1. Server locks the Factory row FOR UPDATE, re-checks wallet ≥ amount, rejects non-UZS or inactive cashboxes
  1. Creates BonusTransaction WITHDRAWAL (negative) + CashTransaction IN (source BONUS_WITHDRAWAL) into the chosen cashbox; audit-logged
- **Offset bonus against factory debt (Zavod qarziga o'tkazish)** (ADMIN, ACCOUNTANT; weekly)
  1. Open /bonus page → 'Zavod qarziga o'tkazish' button → modal (info alert explains it becomes a BONUS-method payment)
  1. Select factory, amount (≤ wallet), date, note
  1. Server locks factory, re-checks wallet, then writes the canonical chain: Payment(FACTORY_OUT, method=BONUS, cashboxId=null) → LedgerEntry(FACTORY, source=BONUS_OFFSET, +amount reduces dealer debt) → BonusTransaction(DEBT_OFFSET, −amount)
  1. Factory balance and wallet update; reversal is done by voiding the payment on the Payments page (restores wallet via REVERSAL)
- **Reverse a mistaken withdrawal** (ADMIN, ACCOUNTANT; rare)
  1. On /bonus transaction table, WITHDRAWAL rows show a 'Qaytarish' button
  1. Confirm dialog requires a reason (free text)
  1. Server verifies type=WITHDRAWAL and not already reversed, creates a REVERSAL BonusTransaction (+amount back to wallet), and compensates each kassa IN with an OUT — rejected if the cashbox balance would go negative
  1. Audit-logged as VOID
- **Maintain factory records** (ADMIN, ACCOUNTANT; rare)
  1. Zavodlar page → 'Yangi zavod' or row edit icon → modal with name/note (+active switch when editing)
  1. Deactivate via row stop icon → confirm dialog ('history is kept, not deleted') → DELETE endpoint sets active=false
  1. All changes audit-logged; duplicate name rejected
- **Review factory settlement / statement** (ADMIN, ACCOUNTANT; daily)
  1. Zavodlar list shows per-factory Balans (with Avans/Qarz tag), Bonus hamyon, Paddon hisobi columns
  1. Click factory name → detail page with 3 stat cards (Balance, Bonus wallet, Pallets held) and tabs
  1. 'Hisob-kitob' tab shows the full running-balance ledger statement (source, linked order/payment, signed amount, running total)
  1. 'To'lovlar' tab shows last 50 non-voided payments; 'Paddonlar' tab last 50 pallet movements
  1. Actual settlement (paying the factory) happens on the separate Payments page (FACTORY_OUT + allocations)
- **Return pallets to factory (settlement credit)** (ADMIN, ACCOUNTANT; weekly)
  1. From the Pallets page (not FactoryDetail), record RETURNED_TO_FACTORY with qty and unit price (default 130 000 UZS)
  1. Posts PalletTransaction + linked LedgerEntry PALLET_RETURN_CREDIT (+qty×price) growing the dealer's advance at the factory

### Roles

- **ADMIN**: Full access: factory CRUD + deactivate, set bonus programs, view all financials/statements, withdraw/offset/reverse bonus, factory payments and allocations.
- **ACCOUNTANT**: Identical to ADMIN within this domain (all @Roles gates are 'ADMIN','ACCOUNTANT'): factory CRUD, bonus programs, wallets, spends, reversals, statements.
- **AGENT**: GET /factories only, role-shaped to {id, name, active} with zero financials (needed for the order form). No UI access to /factories, /factories/:id or /bonus (routes guarded to FIN = ADMIN+ACCOUNTANT; nav items hidden). Triggers accruals indirectly by completing orders.
- **CASHIER**: No access to any factory or bonus endpoint or page. Sees the cash effect of bonus withdrawals only as kassa rows (source BONUS_WITHDRAWAL).

### Current UI

Pages: /factories — Factories.tsx ('Zavodlar' list), /factories/:id — FactoryDetail.tsx (detail with tabs), /bonus — Bonus.tsx ('Bonus hamyonlar' wallets + journal), Sidebar (AppShell.tsx): 'Zavodlar' inside a directory group, 'Bonus hamyonlar' as a separate top-level item with gift icon; both also reachable via command palette

All three pages are Ant Design, entirely in Uzbek (Latin), desktop-table oriented. (1) /factories: a single Card titled 'Zavodlar' with a header row containing a 220px client-side search box and a 'Yangi zavod' primary button; inside, one Table (rowKey id, default 20/page) with columns Nomi (link to detail), Balans (signed Money + green 'Avans'/red 'Qarz' tag), Bonus hamyon, Paddon hisobi (pallet count), Holat (Faol/Nofaol tag), and an Amallar column with two icon-only buttons (edit, deactivate). Create/edit is a small centered Modal with vertical Form (name, note textarea, active switch when editing); deactivation is a modal.confirm. (2) /factories/:id: back-button + factory name + status tag header; a 3-card Statistic row (Balans with Avans/Qarz tag and green/red value color, Bonus hamyon, Paddonlar); below, one Card holding a Tabs component with 4 tabs — 'Hisob-kitob' (full ledger statement table with running balance, client-paginated 20/page), 'To'lovlar' (last-50 payments table), 'Bonus dasturi' (an info Alert explaining versioning, a 'Joriy dastur' card with Descriptions of kind/rate/effectiveFrom and a 'Yangi dastur' button, a 'Dastur tarixi' history table, and a 'Bonus harakatlari (oxirgi 50)' transactions table), 'Paddonlar' (last-50 pallet movements table). New-program Modal: warning alert, Radio.Button group PER_M3/PERCENT/NONE, conditional InputNumber for rate (space-grouped thousands) or percent, DatePicker for effectiveFrom. (3) /bonus: page title + two header buttons ('Naqd yechish' primary, 'Zavod qarziga o'tkazish'); a responsive grid (4-across on lg) of small wallet Cards, one per active-or-nonzero factory, showing gift icon + name + big balance; below, a 'Bonus operatsiyalari' Card with a single factory Select filter and a server-paginated transactions Table (date, factory, colored type Tag, signed amount, order link whose accrual basis — base m³/summa/stavka/foiz — is hidden in a hover Tooltip, note, and a 'Qaytarish' danger button on WITHDRAWAL rows). Withdraw and offset are separate Modals: factory Select (balance embedded in the option label), amount InputNumber with client-side max validation, cashbox Select (withdraw only, UZS-only), DatePicker, note; reverse is a modal.confirm with a bare reason textarea.

### Pain points

- [high] Bonus operations are split across two pages with no cross-navigation: FactoryDetail shows the wallet balance and transaction history but offers no withdraw/offset action; /bonus has the actions but the user must re-select the factory from a dropdown after already looking at it. Wallet cards on /bonus are not clickable — they neither filter the journal below nor link to the factory.
  - Suggestion: Make wallet actions available in context: withdraw/offset buttons on the factory's wallet card and on FactoryDetail's bonus tab, with the factory pre-selected; make wallet cards act as filters/links.
- [medium] The factories list silently truncates: the frontend calls GET /factories with no paging params so the server returns only the first 50 rows, while the client-side search box and AntD pagination operate on that partial set. The API's server-side search param is supported but never used. Beyond ~50 factories, rows invisibly disappear.
  - Suggestion: Wire the table to server pagination + the existing search param (as the Bonus journal already does), or explicitly fetch-all for this small entity.
- [medium] Pallet accountability is computed by two divergent formulas: the list page (factories.service.findAll) sums only RECEIVED_FROM_FACTORY − RETURNED_TO_FACTORY, while the pallet module (and FactoryDetail via /pallets/balances) also adds signed ADJUSTMENT/REVERSAL rows — the same factory can show different pallet counts on list vs detail. FactoryDetail also fetches balances for ALL factories just to display one number.
  - Suggestion: Single source of truth for the factory pallet balance (reuse PalletService.combineFactorySums everywhere); expose a per-factory balance endpoint.
- [high] History views are capped and unfilterable: FactoryDetail shows only the last 50 payments / bonus transactions / pallet movements with no date range, no 'load more', no export, while the 'Hisob-kitob' tab does the opposite — loads the ENTIRE ledger statement in one response and paginates client-side (slow and heavy for an old factory). No print/CSV anywhere in the domain despite being an accounting surface.
  - Suggestion: Server-paginated, date-filterable statement and history tables with export; consider a unified 'account activity' timeline per factory.
- [medium] Accrual explainability is hidden: on the /bonus journal the basis of an accrual (base m³, base amount, rate/percent) lives only in a hover Tooltip on the order link — invisible on touch devices and never printable; FactoryDetail's bonus-transactions table drops the program/rate columns entirely. Reconciling 'why is this accrual 437,500?' requires hovering row by row.
  - Suggestion: Show base and rate as real columns (or an expandable row with the formula rendered: 25 m³ × 5,000 so'm = 125,000), and link each transaction to its program version.
- [medium] Reversal workflows are asymmetric and undiscoverable: only WITHDRAWAL rows get a 'Qaytarish' button; reversing a DEBT_OFFSET requires knowing to go to the Payments page and void the underlying BONUS payment — nothing in the bonus UI says so. The reverse dialog captures the reason in a mutable closure with no inline validation (warning toast only after pressing OK).
  - Suggestion: Offer a contextual action on DEBT_OFFSET rows that deep-links to (or performs) the payment void; use a proper form with required-field validation in the reversal dialog.
- [medium] Changing a bonus program takes 4 clicks through a detail-page tab, and there is no cross-factory overview of programs: neither the factories list nor the /bonus page shows which factories have PER_M3 vs PERCENT vs no program, at what rate, or since when — the only place is one factory's tab. Setting two versions on the same day fails with a raw unique-constraint message the modal doesn't anticipate.
  - Suggestion: Add a program column/badge to the wallets grid and factories list; allow program management from the /bonus page; pre-validate same-effectiveFrom collisions with a friendly message.
- [low] Client-side wallet-balance validation in withdraw/offset modals checks against cached query data (label text also embeds the balance), which can be stale; the server re-check saves correctness but the user gets a late, different error. Amount InputNumber allows 0 (min={0}) though the API rejects non-positive amounts.
  - Suggestion: Refetch the wallet on modal open, show live remaining-after-operation, set min to 0.01/1 and a max bound from the fresh balance.
- [low] Signed-number conventions carry heavy cognitive load: factory balance >0 = 'Avans', <0 = 'Qarz' (opposite instinct for 'we owe them'), bonus amounts signed negative for spends, ledger statement mixes both. Tags help on two screens but the statement table and bonus journal rely on reading minus signs.
  - Suggestion: In the redesign, present debit/credit or 'Biz qarzdormiz / Bizning avans' framing consistently, with the sign convention translated everywhere a raw amount appears.
- [high] Factory settlement actions are scattered across four pages: pay factory (Payments), allocate/finalize cost (Payments), return pallets (Pallets), spend bonus (/bonus), while FactoryDetail — the natural hub — is read-only. A routine 'settle with factory X' session forces constant navigation and factory re-selection.
  - Suggestion: Design FactoryDetail as an operations hub: quick actions (pay, allocate, return pallets, spend bonus) pre-scoped to the factory, with the statement updating in place.

### LOCKED RULES

- Bonus programs are versioned, append-only and never retroactive: changes insert a new BonusProgram row (unique factoryId+effectiveFrom); rows are never updated; the program with latest effectiveFrom ≤ order.completedAt governs that order's accrual forever (owner-verbatim spec).
- Accrual fires only when an order enters COMPLETED, inside the same transaction, and is idempotent (skip if an un-reversed ACCRUAL exists); leaving COMPLETED or cancelling posts a compensating REVERSAL — accruals are never edited or deleted.
- PER_M3 accrual = ratePerM3 × Σ item m³ (m³ rounded to 3dp, money to 2dp). PERCENT accrual base is BLOCKS ONLY — Σ m³ × (finalCostPricePerM3 ?? costPricePerM3) per item — pallet money is never part of the base; percent must be >0 and ≤100 (2dp), ratePerM3 positive money.
- When a completed order's purchase cost is later finalized/un-finalized, the PERCENT bonus is re-derived and the delta posts as a BonusTransaction ADJUSTMENT (wallet always = percent × best-known blocks cost); the original ACCRUAL stays immutable.
- Wallet balance = Σ signed BonusTransaction.amount per factory; spends (withdraw/offset) run under a per-factory SELECT ... FOR UPDATE lock and must never drive the wallet negative.
- Cash withdrawal goes only into an ACTIVE, UZS-currency cashbox and creates a linked CashTransaction IN (source BONUS_WITHDRAWAL); reversing a withdrawal compensates the kassa with an OUT and is rejected if the cashbox balance would go below zero.
- Debt offset uses the canonical chain Payment(kind=FACTORY_OUT, method=BONUS, cashboxId=null) → LedgerEntry(account=FACTORY, source=BONUS_OFFSET, +amount) → BonusTransaction(DEBT_OFFSET, −amount); method=BONUS is forbidden on the generic payment-create endpoint; voiding the BONUS payment must restore the wallet via a REVERSAL.
- Only WITHDRAWAL may be reversed through the bonus endpoint; ACCRUAL reverses via the order lifecycle, DEBT_OFFSET via payment void — each exactly once (unique reversalOfId).
- Factory ledger is immutable and sum-derived, and since 2026-07-21 it is BUCKETED (`LedgerEntry.factoryBucket`, required for and only for account=FACTORY — SQL CHECK `ledger_factory_bucket`):
  - `PAYABLE` — open goods debt (ORDER_COST, COST_ADJUSTMENT, BONUS_OFFSET, every imported factory row). <0 = we owe the factory.
  - `ADVANCE_CASH` / `ADVANCE_BANK` — money standing at the factory, per channel. A FACTORY_OUT payment lands here and pays off NOTHING until someone presses «avansdan yechish».
  - INVARIANT: Σ over the three buckets == the legacy single netted balance, so `factoryBalance()` and every historical aggregate keep their exact value; only the breakdown is new.
  - «Avansdan yechish» posts a ZERO-SUM `ADVANCE_DRAW` pair (advance channel −X, PAYABLE +X) carrying orderId + allocationId, which is what makes one draw individually reversible. The channel drawn from sets that slice's price basis.
  - Corrections only as compensating entries carrying the original business date; SQL CHECKs bind exactly one party per account, BONUS_OFFSET ⇒ paymentId NOT NULL, ADVANCE_DRAW ⇒ orderId + allocationId NOT NULL.
- Factory debt is recognized at order creation (ORDER_COST negative posting immediately, any status except CANCELLED), at a PROVISIONAL cost priced by the intended payment method (CASH → FACTORY_CASH, else FACTORY_BANK) from the versioned price book at order date.
- Order cost is fixed at factory-payment allocation, not at creation (owner explicitly chose this): the latest active allocation's priceKind wins, order DATE resolves the price row, the provisional→final delta posts as COST_ADJUSTMENT, costStatus walks PROVISIONAL→PARTIAL→FINAL; voiding allocations re-derives everything.
- Pallets are owed in kind (counts, never money) — NO pallet money reaches the factory ledger by any route (2026-07-21); factory pallet accountability = received − returned, and it is surfaced as a debt COUNT on the Qarzlar board beside the money debt.
- Factories with history are never hard-deleted — DELETE deactivates (active=false); factory name is unique.
- Role shaping is contract: AGENT receives only {id, name, active} from GET /factories (no financials); every factory/bonus mutation is ADMIN/ACCOUNTANT-only and audit-logged (create/update/void with before/after snapshots).
- All money math is Decimal (never float), amounts arrive as numbers or numeric strings and are converted via assertPositiveMoney; ledger postings of zero are rejected.

### API

- GET /factories — paged list; role-shaped: ADMIN/ACCOUNTANT get rows + ledger balance + bonus wallet + pallets held, AGENT gets only {id,name,active}; supports search/page/pageSize
- GET /factories/:id — factory + balance + bonusBalance + full ledger statement + last-50 payments + all bonus programs + last-50 bonus transactions + last-50 pallet transactions (ADMIN/ACCOUNTANT)
- POST /factories — create factory (name unique, note)
- PUT /factories/:id — update name/note/active
- DELETE /factories/:id — soft-delete: sets active=false, never hard-deletes
- GET /factories/:id/bonus-program — { current, history } of versioned programs
- POST /factories/:id/bonus-program — insert a new program version (kind NONE|PER_M3|PERCENT, ratePerM3 xor percent, effectiveFrom; never retroactive)
- GET /bonus/wallets — per-factory wallet balances (active factories or nonzero balances)
- GET /bonus/transactions — paged journal, optional factoryId filter; includes factory/order/program/payment refs
- POST /bonus/withdraw — cash out wallet into an active UZS cashbox (factoryId, amount, cashboxId, date, note)
- POST /bonus/offset — apply wallet to the same factory's debt via Payment(FACTORY_OUT, BONUS) chain (factoryId, amount, date, note)
- POST /bonus/transactions/:id/reverse — reverse a WITHDRAWAL only (reason required)
- Related: POST /payments (kind=FACTORY_OUT/FACTORY_REFUND settles factory ledger; method=BONUS rejected here), POST /payments/:id/allocations (FACTORY_OUT allocation finalizes order cost and may trigger bonus ADJUSTMENT), POST /payments/:id/void (restores wallet for BONUS payments), POST /pallets/factory-return (posts PALLET_RETURN_CREDIT to factory ledger)

---

## Customer / Agent / Region management (parties & credit control) in SmartBlok — a gas-block (gazoblok) dealership ERP

SmartBlok is an ERP for a building-block dealer in Uzbekistan. This domain manages the three "party" catalogs the sales operation runs on: Clients (Mijozlar — the customers who buy blocks), Agents (Agentlar — field salespeople who own a portfolio of clients), and Regions (Hududlar — a flat geographic catalog used for client grouping and logistics routes). A client belongs to at most one agent and one region. Every AGENT-role login is bound to one Agent record (User.agentId), and the entire system row-scopes that user: they see and touch only their own clients, orders, and payments (agentScope on lists, assertOwnAgent on every detail/update — the v2 IDOR is explicitly closed in v3 code comments).

Money truth lives in an immutable ledger, not on the client row. A client's balance is always Σ of LedgerEntry rows (account=CLIENT): positive means the client owes the dealer ("Qarz", shown red), negative means prepayment/advance ("Avans", green); |balance| under 1 so'm counts as settled. Debt is recognized the moment an order is booked (any status except CANCELLED). Credit control is two-tier and enforced inside the order-creation transaction with row locks: (1) per-client creditLimit — null = unlimited, 0 = prepay only — rejects an order when balance + clientChargeable(order) would exceed it; (2) per-agent debtLimit — null falls back to a global AppSetting (agentDebtLimitDefault), 0 blocks all new orders — computed as the sum of only the POSITIVE balances of that agent's clients (prepaid clients never offset debtors). Agents cannot grant credit: creditLimit / paymentTermDays / agentId fields are silently stripped from AGENT requests, and debtLimit is ADMIN-only (stripped even for ACCOUNTANT). Agents also may not sell below the factory bank price in force at the order date. Clients additionally carry an in-kind pallet balance (units of paddon delivered − returned − charged-lost), a versioned special-price list per product (per-m³, 6 decimal places, insert-only history), and name aliases used to match spelling variants during Excel imports. Importantly, agents have NO commission/bonus model in the code — the BonusProgram/BonusTransaction machinery is factory-side (dealer's bonus wallet per factory); agent performance is tracked only as KPIs (orders count, sales, goods profit = sale − cost, collected payments, outstanding debt, pallet exposure) plus a monthly ranking on the office dashboard.

The current UI is Ant Design (v6) rendered entirely in Uzbek (Latin script) — "Mijozlar", "Hududlar", "Qarz/Avans", "Taxalluslar" — with Russian loanwords transliterated ("paddon" from поддон, "moshina"); amounts are UZS so'm with space-grouped digits; the project docs are written in Uzbek. Screens are classic table-CRUD: paginated tables with icon-button actions, create in Modals, client-edit in a right Drawer, detail pages as a header Card plus tabbed tables (statement / orders / payments / aliases / special prices). Everything works but is navigation-heavy: no structured filters on the client list, no cross-links from a client card to creating an order/payment for them, capped 20-row histories in tabs, no way for an AGENT to see their own KPI card (the /agents/me endpoint exists but no page calls it), and no way at all to reactivate a deactivated client (the update DTO has no `active` field).

### Entities

- **Client (Mijoz)** — A customer of the dealer; the unit of debt tracking, credit control, special pricing, and pallet accountability. Balance is never stored — always summed from the immutable ledger.
  - Fields: name (globally @unique); legalEntity (free text, no UI field exposes it); phone; regionId -> Region (optional); agentId -> Agent (optional; forced to own agent when an AGENT creates); creditLimit Decimal(18,2) — null = unlimited, 0 = prepay only (office-only field); paymentTermDays — order.dueDate = order.date + termDays (office-only); active (soft-delete flag); derived: balance (Σ ledger, >0 = Qarz/owes, <0 = Avans); derived: palletBalance (units: delivered − returned − charged-lost + signed adjustments)
  - States: active | inactive (soft-deleted; deactivation allowed only when balance settled; NO reactivation path exists in API/UI)
- **ClientAlias (Taxallus)** — Alternate spellings of a client name («Жаср Версал», "NORMAT UMIDBEK") used to match rows during Excel workbook import; searchable in the client list. Not financial — hard delete allowed.
  - Fields: clientId (cascade delete); name (globally @unique)
- **ClientPrice (Maxsus narx)** — Per-client special sale price for a product, overriding list price at order time. Versioned insert-only history: never updated in place; the row effective at the order date governs.
  - Fields: clientId; productId; pricePerM3 Decimal(18,6) — 6dp so back-solved lump-sum prices reproduce totals; effectiveFrom (unique per client+product+date); createdBy (userId)
- **Agent** — Field salesperson owning a client portfolio; the row-scoping anchor for AGENT logins (User.agentId) and the subject of the debt-limit gate on new orders. Attribution is snapshotted onto orders/payments at creation, so KPIs are historical.
  - Fields: name (globally @unique); phone; sortNo (display ordering only); debtLimit Decimal(18,2) — null ⇒ AppSetting agentDebtLimitDefault, 0 ⇒ new orders blocked (ADMIN-only field); active (soft-delete); derived: clientCount, outstandingDebt (Σ positive client balances only); derived KPI: ordersCount, saleTotal, goodsProfit (sale − cost), collected (CLIENT_IN payments), palletExposure
  - States: active (Faol) | inactive (Nofaol — soft-deleted, history preserved)
- **Region (Hudud)** — Flat geographic catalog (no hierarchy) for grouping clients and anchoring logistics routes/transport tariffs. Small, unpaged by design.
  - Fields: name (@unique); note; derived: _count.clients
  - States: (no active flag — hard delete permitted only while no client or LogisticsRoute references it)

### Workflows

- **Register / edit a client** (AGENT (own clients, no credit fields), ACCOUNTANT, ADMIN; daily)
  1. Open /clients, click 'Yangi mijoz' (Modal) or the row edit icon (Drawer)
  1. Fill name (required), phone, region (searchable select)
  1. Office users additionally set agent assignment, kredit limiti (empty = unlimited, 0 = prepay-only) and to'lov muddati (days)
  1. Save — server strips credit/agent/term fields if the caller is an AGENT and forces the agent's own agentId; duplicate name returns a friendly error; every change is audit-logged with before/after
- **Agent books an order for his client (the credit gates live here)** (AGENT, ACCOUNTANT, ADMIN; many times/day)
  1. Open /orders/new; pick client from a searchable select whose labels show current balance
  1. Add items; an AGENT cannot price below the factory bank price at the order date; client special price (ClientPrice) applies when one is in force
  1. UI shows the client's balance and warns if credit limit may be exceeded ('server tekshiradi')
  1. Server transaction: locks the Client and Agent rows FOR UPDATE, checks client creditLimit (balance + clientChargeable(order) must not exceed it — [TRANSPORT MODEL — AUTHORITATIVE](#transport-authoritative)), then the agent debt-limit gate (Σ positive balances of his clients must be below effective limit, else 'yangi buyurtma bloklandi')
  1. Order created with agentId snapshotted from the client; dueDate = date + paymentTermDays; debt (saleTotal) hits the client ledger immediately
  1. Agent advances status one step at a time (NEW→CONFIRMED→LOADING→DELIVERING→DELIVERED→COMPLETED); office may skip forward or step back one; cancel is office-only soft-cancel via compensating ledger entries
- **Collect a client payment** (AGENT, CASHIER, ACCOUNTANT, ADMIN; many times/day)
  1. Record payment kind CLIENT_IN against the client (AGENT allowed only for own clients — assertOwnAgent)
  1. Payment stores agentId snapshot from the client for historical attribution
  1. Ledger entry reduces the client balance; void is a compensating reversal, not a delete
- **Review a client's account** (AGENT (own clients), ACCOUNTANT, ADMIN; many times/day)
  1. Open /clients/:id
  1. Header shows profile facts + big colored balance (Qarz red / Avans green) + orange pallet tag
  1. 'Hisob-kitob' tab: full ledger statement with per-row running balance, source labels (order sale, payment, transport, pallet charge, bonus offset…), links to order documents
  1. 'Buyurtmalar' / 'To'lovlar' tabs: last 20 orders and 20 non-voided payments
- **Debt monitoring & collections** (ACCOUNTANT, ADMIN, AGENT (scoped, no summary); daily)
  1. Office opens /debts: six summary cards (clients owe us, we owe clients, factory advance/debt, vehicle debt, pallets at clients)
  1. Per-client debt board sorted by debt desc, flags overdue orders (dueDate < now) and clients due within a 7/14/30-day window; shows expectedCollections total
  1. AGENT sees the same board scoped to own clients; the office-only summary endpoint is blocked for them
  1. Drill into a client statement (openingBalance/closingBalance over a date window) via /debts/statement
- **Grant a client special price** (ACCOUNTANT, ADMIN; weekly)
  1. ClientDetail → 'Maxsus narxlar' tab (office only)
  1. Inline form: pick product (search across factories), enter per-m³ price, optional effectiveFrom date
  1. Server inserts a new version (never updates); duplicate (product, date) rejected; audit-logged
- **Maintain import aliases** (ACCOUNTANT, ADMIN; rare (around Excel imports))
  1. ClientDetail → 'Taxalluslar' tab (office only)
  1. Add a spelling variant so the 21-sheet Excel importer matches rows to this client; delete is hard (non-financial)
- **Manage agents & debt limits** (ACCOUNTANT (no debtLimit), ADMIN; rare)
  1. Open /agents (office only): table of agents with client count, live outstanding debt, effective debt limit
  1. Create/edit in a Modal: name, phone, sortNo, active switch; 'Qarz limiti' field appears only for ADMIN (null = global default, 0 = block new orders)
  1. debtLimit changes get a special audit note; deactivation is ADMIN-only soft-delete (history keeps the agent snapshot)
- **Review agent performance** (ACCOUNTANT, ADMIN, AGENT (own card only, but nothing in the UI links to it); weekly)
  1. Open /agents/:id: header (phone, client count, debt limit), six all-time KPI stat cards (orders, sales, goods profit, collected, outstanding debt, pallets at clients), table of his clients with balances
  1. For monthly comparison use the Dashboard's 'Agentlar reytingi' (office-only, Tashkent-calendar month)
- **Manage regions** (ACCOUNTANT, ADMIN; rare)
  1. Open /regions (office only): table with name, note, client count
  1. Create/edit in Modal; delete asks confirmation and the server refuses while clients or logistics routes reference the region
- **Deactivate a client** (ADMIN; rare)
  1. ADMIN clicks the red stop icon on /clients, confirms in a dialog
  1. Server verifies balance is settled ('Balans nolga teng emas' otherwise) then sets active=false with an audit row; the client stays visible with a 'Nofaol' tag but cannot receive orders

### Roles

- **ADMIN**: Everything in the domain: clients CRUD incl. credit fields; the only role that can deactivate clients (requires settled balance) and agents; the only role that can set/change Agent.debtLimit; regions CRUD; sees all agents' financials, debts summary, agent ranking.
- **ACCOUNTANT**: Clients create/update incl. creditLimit/paymentTermDays/agent assignment; aliases and special prices; agents create/update but debtLimit is silently stripped; regions CRUD incl. delete; agents list/detail, debts summary/board/statements. Cannot deactivate clients or agents.
- **AGENT**: Row-scoped to own agentId everywhere (agentScope on lists, assertOwnAgent on details/updates/orders/payments/statements). Can list/view/create/update only OWN clients; creditLimit/paymentTermDays/agentId are stripped from his payloads; cannot manage aliases or special prices; cannot list agents (only GET /agents/me and his own /agents/:id); regions read-only; debts board scoped to own clients, summary forbidden; order price floor = factory bank price; can only advance order status one step forward.
- **CASHIER**: No access to this domain: clients, agents list, and debts endpoints all exclude CASHIER; regions GET also excludes CASHIER in v3. Works only in payments/expenses/kassa modules.

### Current UI

Pages: /clients — Clients.tsx (list + create Modal + edit Drawer), /clients/:id — ClientDetail.tsx (header card + 5 tabs), /agents — Agents.tsx (office-only list + create/edit Modal), /agents/:id — AgentDetail.tsx (read-only KPI page), /regions — Regions.tsx (office-only simple CRUD table), related: /debts — Debts.tsx (summary cards + per-client debt board, window select 7/14/30 kun), related: Dashboard.tsx — 'Agentlar reytingi' monthly table (office)

All screens are Ant Design v6, Uzbek-language, inside an AppShell with a role-filtered side menu. CLIENTS LIST: title row with 'Mijozlar' + right-aligned 280px search box (searches name/phone/alias, server-side) and a primary 'Yangi mijoz' button; below, a server-paginated Table (default 20/page, size changer, 'Jami: N' total) with columns: Nomi (link to detail, grey 'Nofaol' tag when inactive), Hudud, Agent, Telefon, Balans (right-aligned colored text: red '123 456 Qarz' / green 'Avans', em-dash when settled), Paddon (orange '{n} dona' tag only when positive), Kredit limiti ('Cheklanmagan' in grey or formatted number), Amallar (small icon-only edit button; ADMIN also gets a red stop icon that opens a confirm dialog). Create opens a centered Modal; edit opens a 420px right-side Drawer with the same vertical form (name, phone, region select, and office-only agent select, credit limit InputNumber with space-grouped formatter, payment term days). CLIENT DETAIL: top Card with h3 client name + Nofaol tag, a small Descriptions grid (Agent, Hudud, Telefon, Kredit limiti, To'lov muddati) on the left and a large right-aligned Balans figure (h2, red/green, 'Qarz'/'Avans' suffix) with an orange pallet tag beneath; second Card holds Tabs: 'Hisob-kitob' (default — ledger statement table: date, source label, document link to order, note, signed amount, colored running balance; paginated 20), 'Buyurtmalar' (last 20 orders: no, date, factory, status tag, total; no pagination), "To'lovlar" (last 20 payments), 'Taxalluslar' (bordered List with inline add Input+button for office, delete via confirm), 'Maxsus narxlar' (office-only inline Form: product select / price InputNumber / DatePicker / add button, above a version-history table product+price+effectiveFrom). AGENTS LIST (office only): title + 'Yangi agent' button; Table with Nomi (link), Telefon, Mijozlar (count), Ochiq qarz (red when >0), Qarz limiti ('Cheklanmagan' / red tag '0 — bloklangan' / number), Holati (green Faol / red Nofaol tag), edit icon; create/edit share one Modal (name, phone, sortNo, active Switch, ADMIN-only Qarz limiti field with helper text 'null = umumiy limit, 0 = yangi buyurtmalar bloklanadi'). AGENT DETAIL: read-only — header Card (name + status tag, Descriptions: phone, client count, debt limit incl. '0 — yangi buyurtmalar bloklangan' phrasing), then a responsive row of six small Statistic cards (Buyurtmalar, Sotuvlar, Mahsulot foydasi, Yig'ilgan to'lovlar, Ochiq qarz in red, Mijozlardagi paddonlar), then a 'Mijozlar va balanslar' Card with a table of his clients (name link, region, phone, colored balance). REGIONS: minimal table (Nomi, Izoh, Mijozlar soni, edit + delete icons with confirm) and a shared create/edit Modal (name, note TextArea). Errors everywhere render an Alert with a 'Qayta urinish' retry button; success/failure via antd message toasts; destructive actions via modal.confirm.

### Pain points

- [high] Clients list has no structured filters — no region, agent, active/inactive, or has-debt filter; only one free-text search. The web API client even defines an agentId query param that the backend's PageQueryDto silently ignores. To answer 'show me agent X's clients' you must detour via Agents → AgentDetail.
  - Suggestion: Add filter bar (region, agent, status, balance state) wired to real server-side query params; make table columns sortable by balance/limit.
- [high] No workflow cross-links from ClientDetail: you cannot start a new order, record a payment, or open the full filtered order/payment history for this client from their card — every follow-up action forces navigation to another page and re-finding the client in a select.
  - Suggestion: Put primary actions ('Yangi buyurtma', 'To'lov kiritish') and 'view all orders/payments' links directly on the client header, pre-filtered to the client.
- [high] Deactivated clients can never be reactivated: DELETE sets active=false, but UpdateClientDto has no `active` field and the edit form has no toggle (agents DO have one). A mistaken deactivation is unrecoverable without touching the database.
  - Suggestion: In the redesign expose a reactivate action (and add `active` to the client update path) with the same audit logging.
- [high] AGENT users have no view of their own standing: GET /agents/me exists and returns their debt-limit card, but endpoints.agentMe is called by no page; the /agents menu is office-only, so an agent cannot see how close he is to his debt limit until an order is rejected with a server error.
  - Suggestion: Give AGENT a self-dashboard card (limit, current outstanding debt, headroom, KPIs) — the API already exists.
- [medium] ClientDetail 'Buyurtmalar' and 'To'lovlar' tabs are hard-capped at the last 20 rows with pagination disabled and no link to the full list — older history is simply invisible from the client card.
  - Suggestion: Server-paginate these tabs or link to the Orders/Payments pages pre-filtered by client.
- [medium] Special prices tab is a flat version history: nothing indicates which price is currently in force per product (rows just sorted by effectiveFrom desc across all products), and future-dated rows look identical to active ones.
  - Suggestion: Group by product with the effective price highlighted and history collapsed; badge future-dated prices.
- [medium] Credit exposure is not visualized: limit and balance sit in separate table columns with no % used / remaining headroom, and no warning appears until the order form (NewOrder shows a soft warning only after items are entered) or a server rejection.
  - Suggestion: Add a limit-utilization indicator (progress/percent, near-limit color) on the client list, client card, and order form client picker.
- [medium] Inconsistent editing patterns within one domain: client create = centered Modal but client edit = right Drawer, while agents and regions use a Modal for both; actions are icon-only buttons whose meaning is discoverable only via hover tooltips.
  - Suggestion: Pick one create/edit surface pattern; label destructive actions with text or move them into a row menu.
- [medium] Client.legalEntity exists in the schema and DTOs but no form anywhere exposes it — the field is only settable via import or raw API, so office staff cannot record a client's legal entity in the UI.
  - Suggestion: Either surface the field in the client form or drop it from the model during redesign.
- [medium] AgentDetail is read-only and all-time only: no edit button (must go back to the list, find the row, open the modal) and KPIs cannot be filtered by month — the monthly comparison lives on a completely different screen (Dashboard 'Agentlar reytingi').
  - Suggestion: Add edit access and a period selector on the agent card; unify with the dashboard ranking.
- [low] Two number conventions on one screen: the ClientDetail header shows 'fmtMoney(abs) + Qarz/Avans' while the statement 'Qoldiq' column shows raw signed values only colored — users must know that positive = debt.
  - Suggestion: Use one consistent signed-balance presentation (label + color) everywhere.
- [low] Any alias/price/region mutation invalidates the whole ['clients'] query family, refetching every clients list and every open client detail; Regions edit even invalidates clients wholesale because names are denormalized on screen.
  - Suggestion: Scope invalidations to the affected client id / list keys.
- [low] Regions page shows a client count but it isn't a link, and the delete restriction (used by clients or routes) is discovered only through a failed attempt after confirming the dialog.
  - Suggestion: Link the count to a filtered client list and disable/explain delete up front when the region is referenced.

### LOCKED RULES

- Client balance is never stored: always Σ LedgerEntry(account=CLIENT) rows; sign convention >0 = client owes dealer (Qarz), <0 = advance (Avans); |balance| < 1 UZS is float residue treated as settled (isSettled).
- Debt is recognized at order creation — any status except CANCELLED counts; cancellation is soft (compensating ledger reversals), payments already received stay on the client account.
- Client creditLimit semantics: null ⇒ unlimited, 0 ⇒ prepay only; enforced inside the order create/update transaction after SELECT … FOR UPDATE on the Client row: reject when balance + clientChargeable(order) > creditLimit (on update, old exposure is reversed first so the check is against the delta). The exposure is NET of the CLIENT_PAYS_DRIVER transport slice — see [TRANSPORT MODEL — AUTHORITATIVE](#transport-authoritative).
- Agent debtLimit semantics: null ⇒ fallback to AppSetting 'agentDebtLimitDefault' (null there ⇒ unlimited), 0 ⇒ new orders blocked; outstanding debt = Σ of only POSITIVE balances of that agent's clients (prepaid clients never offset debtors); checked at order creation after FOR UPDATE lock on the Agent row; order rejected when outstanding ≥ limit.
- Financial controls are office-only and silently stripped, never errored: AGENT payloads lose creditLimit/paymentTermDays/agentId on client create/update (client forced to the agent's own agentId); Agent.debtLimit is ADMIN-only (stripped for ACCOUNTANT) and every change is audit-noted 'debtLimit changed'.
- AGENT row-scoping is total in v3: agentScope filters every list, assertOwnAgent guards every detail/update/order/payment/statement — an AGENT must never see or touch a foreign client (v2 IDOR closed).
- AGENT price floor: may not sell below the factory FACTORY_BANK price effective at the order date; AGENT can advance order status only one step forward, never backward, never cancel/delete.
- Deletion is deactivation: clients may be deactivated only when their money balance is settled ('Balans nolga teng emas' otherwise) and only by ADMIN; agents are soft-deactivated so historical orders/payments keep their agent snapshot. ClientAlias is the explicit exception (non-financial, hard delete).
- ClientPrice history is versioned insert-only: never UPDATE a price row; pricePerM3 stored at 6 decimal places (back-solved lump-sum prices must reproduce totals); unique (clientId, productId, effectiveFrom).
- Client pallet balance is in-kind units, never money: Σ DELIVERED_TO_CLIENT − Σ RETURNED_BY_CLIENT − Σ CHARGED_LOST + signed ADJUSTMENT/REVERSAL rows; factory-side pallet movements are excluded from the client figure.
- paymentTermDays drives collections: order.dueDate = order.date + paymentTermDays; a client is overdue when any non-cancelled order has dueDate < now; expected collections = Σ positive balances of clients with a term or a due date inside the chosen window.
- Attribution is snapshotted: order.agentId and payment.agentId are copied from the client at creation time — reassigning a client to another agent must never rewrite historical KPIs.
- Regions may be hard-deleted only while no Client and no LogisticsRoute references them; Region/Client/Agent names are globally unique with friendly duplicate errors.
- Every mutation in this domain is audit-logged (before/after JSON) inside the same Prisma transaction as the write.
- There is no agent commission model: BonusProgram/BonusTransaction belong to factories (dealer's bonus wallet, versioned, accrued at order COMPLETION) — do not invent agent commissions in the redesign; agent motivation data = KPI aggregates and the monthly office ranking.

### API

- GET /api/clients — paged list (page/pageSize/search over name, phone, alias), AGENT-scoped; rows enriched with balance + palletBalance (roles: ADMIN, ACCOUNTANT, AGENT)
- GET /api/clients/:id — full profile: region, agent, aliases, price history, balance, palletBalance, last 20 orders, last 20 non-voided payments, full ledger statement with running balance (own-agent guarded)
- POST /api/clients — create client; AGENT forced to own agentId, credit fields stripped
- PUT /api/clients/:id — update; office-only fields (agentId, creditLimit, paymentTermDays) stripped for AGENT; no `active` field exists (no reactivation)
- DELETE /api/clients/:id — ADMIN only; soft-deactivate, rejected unless balance is settled
- POST /api/clients/:id/aliases — add import-matching alias (ADMIN, ACCOUNTANT)
- DELETE /api/clients/:id/aliases/:aliasId — hard-delete alias (ADMIN, ACCOUNTANT)
- POST /api/clients/:id/prices — insert versioned per-client special price (ADMIN, ACCOUNTANT)
- GET /api/agents — office-only list with clientCount, outstandingDebt (Σ positive client balances via one raw SQL group), effective debtLimit + ownDebtLimit (ADMIN, ACCOUNTANT)
- GET /api/agents/me — the AGENT's own card (same shape as a list row) — currently unused by the web UI
- GET /api/agents/:id — agent card + clients-with-balances + all-time KPI (ordersCount, saleTotal, goodsProfit, collected, outstandingDebt, palletExposure); AGENT may open only his own id
- POST /api/agents — create agent (ADMIN, ACCOUNTANT; debtLimit honored only for ADMIN)
- PUT /api/agents/:id — update agent (debtLimit ADMIN-only, change audit-noted)
- DELETE /api/agents/:id — ADMIN only; soft-deactivate
- GET /api/regions — unpaged catalog with client counts (ADMIN, ACCOUNTANT, AGENT)
- POST /api/regions | PUT /api/regions/:id — create/update region (ADMIN, ACCOUNTANT)
- DELETE /api/regions/:id — hard delete, refused while clients or logistics routes reference it (ADMIN, ACCOUNTANT)
- GET /api/debts/summary — company-wide balance split incl. clientsOweUs / weOweClients / palletsAtClients (ADMIN, ACCOUNTANT only)
- GET /api/debts/clients — per-client debt board (?days=7/14/30): balance, pallet balance, overdue orders count/total, due-within-window flag, expectedCollections; AGENT-scoped
- GET /api/debts/statement — ledger statement for CLIENT/FACTORY/VEHICLE party with opening/closing balance over a date window; AGENT limited to own clients
- GET /api/dashboard/agents-ranking?month=YYYY-MM — office-only monthly per-agent KPI ranking (Tashkent calendar month)
- POST /api/orders — where the client credit-limit and agent debt-limit gates actually execute (row locks + checks inside the transaction)

---

<a id="transport-authoritative"></a>

## TRANSPORT MODEL — AUTHORITATIVE (owner rule, 2026-07-20)

> **This section is the single source of truth for transport money and for what a client owes
> on an order.** Every other document — the Logistics section below, `docs/design/screens/*`,
> `docs/design/visions/*`, `docs/05`, `docs/06`, `docs/07` — must LINK here instead of restating
> the arithmetic. Restated formulas are exactly what drifted between 2026-07-11 and 2026-07-20.
> **If any other file contradicts this section, this section wins.**

### The rule, in the owner's own numbers

An order's transport cost is **ALWAYS INSIDE the goods total (`saleTotal`)**. It is never billed
on top.

```
saleTotal      = 22 000 000   ← what the goods are sold for, transport already inside
transportCost  =  2 000 000   ← the driver's cut, carved OUT of that 22 000 000
```

Under `transportMode = CLIENT_PAYS_DRIVER` («Shofyorga mijoz to'laydi») the client hands the
2 000 000 straight to the driver and only 20 000 000 to the dealer. Therefore, **from the moment
the order is created**:

* the client owes the dealer **20 000 000** — not 22 000 000, and **no payment entry is required**
  to make that number true;
* the dealer owes the driver **0** — the dealer is not in that money chain at all;
* every screen, endpoint, report and print-out shows the SAME **20 000 000**.

The owner's core complaint was that the same money read as different amounts on different
screens. One formula, one place: below.

### The four modes

| `TransportMode` | UI label | Who hands the driver his money | Client owes the dealer | Dealer owes the driver (VEHICLE account) |
|---|---|---|---|---|
| `CLIENT_OWN` | «Mijozning o'z transporti» | nobody — client's own truck | `saleTotal` | 0 (`transportCost` forced to 0) |
| `DEALER_ABSORBED` *(default)* | «Shofyorga diller to'laydi» | the dealer, via a `VEHICLE_OUT` payment | `saleTotal` (full) | `transportCost` |
| `CLIENT_PAYS_DRIVER` | «Shofyorga mijoz to'laydi» | the client, directly | `saleTotal − transportCost` | **0** |
| `DEALER_CHARGED` | «Summa ustiga qo'shilgan (eski)» | ⛔ **DEPRECATED** — see below | — | — |

**`DEALER_CHARGED` is DEPRECATED.** It modelled transport billed ON TOP of the goods total via a
separate `transportCharge`, which is the exact inverse of the owner's rule. It is **rejected on
write** for both create and update (`assertLiveTransportMode`, `orders.service.ts`); the enum
value survives *only* so historical rows keep rendering and reading correctly. Do not revive it,
do not offer it in any UI, do not write new specs against `transportCharge` — for every live
mode `transportCharge` is hard-zero.

### The one formula

Implemented once, in `apps/api/src/common/transport.ts` (pure functions, no db access):

```
clientDirectTransport(order) =
    mode === CLIENT_PAYS_DRIVER
      ? clamp(round2(transportCost), 0 … round2(saleTotal))   // never negative, never > saleTotal
      : 0

clientChargeable(order) = max(0, round2(saleTotal) − clientDirectTransport(order))
```

`clientChargeable` is **what the client owes the dealer for the order**. It is the number that
must appear as «Jami qarzga yozilgan», as the credit-limit and agent-debt-limit exposure, as the
invoice JAMI, as the denominator of every payment-progress bar, and as the per-order figure
inside every debt aggregate.

Per-order remaining balance (the collectable amount):

```
outstanding(order) = max(0, clientChargeable(order) − Σ active CLIENT_IN allocations)
```

Cancelled orders are excluded everywhere. **`TRANSPORT_DIRECT` allocations do NOT reduce this** —
the transport slice was already carved out at order creation, so counting it again would
understate the debt (22M → 20M → 18M, the double-deduct bug). `CLIENT_SETTLING_KINDS` is
therefore `[CLIENT_IN]` only.

**No other file may re-derive this inline** — not SQL, not report builders, not the web client.
Anything that needs the number imports the helper.

### Ledger postings (what actually hits `LedgerEntry`)

At order creation, for a `CLIENT_PAYS_DRIVER` order of 22 000 000 / 2 000 000:

| Account | Source | Amount | Meaning |
|---|---|---|---|
| `CLIENT` | `ORDER_SALE` | **+22 000 000** | the gross sale, shown as «Savdo summasi» |
| `CLIENT` | `TRANSPORT_CLIENT_DIRECT` | **−2 000 000** | «Shofyorga mijoz to'laydi (summa ichidan)» |
| `VEHICLE` | *(none)* | **0** | the dealer never owed this driver |

Net client balance = **+20 000 000**.

Keeping the gross `ORDER_SALE` row **and** a separate, visible carve-out row is DELIBERATE: the
order must still read «Savdo summasi 22 000 000» with the split shown underneath, and the
client's statement («hisob-kitob») must show WHY the balance is 20 000 000. Both rows carry
`orderId`, so `ledger.reverseAllForOrder` reverses them together on order edit and soft-cancel —
one reversal path, exactly like every other order posting.

For `DEALER_ABSORBED` nothing changes: `CLIENT +saleTotal` at create, `VEHICLE −transportCost`
at the LOADING transition, settled by a `VEHICLE_OUT` payment. For `CLIENT_OWN` there is nothing
to post. **The `VEHICLE` / `TRANSPORT_COST` leg is posted only for `DEALER_ABSORBED`** (and
legacy `DEALER_CHARGED` rows).

### `TRANSPORT_DIRECT` is a RECORD, not a money movement

The `TRANSPORT_DIRECT` payment kind survives, but under this model it posts **NOTHING** to the
ledger:

* the carve-out already happened at order creation — crediting the client again would
  double-deduct him down to 18 000 000;
* crediting the `VEHICLE` account would invent a phantom advance to a driver the dealer never
  owed.

What it still does: it **documents** that the driver actually received his cash, and it drives
`transportPaidStatus` via `recomputeTransportStatus` (→ `PAID_BY_CLIENT`). It never touches a
cashbox (`cashboxId` rejected; `reconciled = true` by definition). On create it requires at least
one order allocation and every allocated order must be `CLIENT_PAYS_DRIVER` — otherwise
«TRANSPORT_DIRECT faqat «Shofyorga mijoz to'laydi» rejimidagi buyurtmaga kiritiladi» /
«TRANSPORT_DIRECT to'lovi buyurtmaga bog'lanishi shart». Voiding one reverses no ledger rows
(there are none) but still voids the allocations and re-derives the transport status.

For `DEALER_ABSORBED` the operator pays the driver with `VEHICLE_OUT` — unchanged.

### Profit is unaffected

```
profit = (saleTotal − costTotal) − transportCost
```

still holds and already nets correctly (`dashboard.service.ts`, kassa net profit). Transport is a
cost of the sale in **every** mode; only *who physically hands the driver the cash* differs, and
that changes **receivables only, never profit**. The legacy "transport profit = transportCharge −
transportCost" KPI survives solely for historical `DEALER_CHARGED` rows; for every live mode
`transportCharge = 0`, so it reduces to `−transportCost` and `netProfit` stays
`saleTotal − costTotal − transportCost`.

### Consequences for readers of this map

* Client debt, credit limits, agent debt limits, overdue totals, expected collections, payment
  progress and the debts board all use `clientChargeable` — **never raw `saleTotal`**, and never
  `saleTotal + transportCharge`.
* `debts.service.ts overdueOrdersTotal` is Σ per-order `outstanding(order)`, not a raw
  `_sum: saleTotal` groupBy.
* The Excel importer hardcodes `DEALER_ABSORBED`, so imported workbook history and its golden
  totals are untouched by this rule.
* Migration `20260721130000_transport_client_pays_driver_carveout` retro-fits existing
  `CLIENT_PAYS_DRIVER` orders to `CLIENT = saleTotal − transportCost`, `VEHICLE = 0`.

---

## Logistics / Transport (vehicles, drivers, per-truck delivery, transport cost vs charge, transport profit) in SmartBlok ERP

SmartBlok is a gas-block (газоблок) dealer ERP. Every order is exactly one truckload ("one order = one truck"); split loads are multiple items on one truck. The transport domain models the truck fleet (Vehicle: name, unique plate, free-text driver name, phone, pallet capacity default 19), and the per-order transport economics. **⚠️ SUPERSEDED IN PART — the transport-money paragraphs of this section were rewritten on
2026-07-20. The authority is [TRANSPORT MODEL — AUTHORITATIVE](#transport-authoritative) above;
this section keeps only fleet/UI/workflow detail.**

Since the 2026-07-20 owner rule, transport is **always priced INSIDE `saleTotal`** and there are
FOUR modes on each order — CLIENT_OWN, DEALER_ABSORBED (default), CLIENT_PAYS_DRIVER, and the
DEPRECATED DEALER_CHARGED (rejected on write, historical rows only). What the client owes the
dealer is `clientChargeable(order) = saleTotal − clientDirectTransport(order)`; on a
CLIENT_PAYS_DRIVER order of 22 000 000 with 2 000 000 transport that is 20 000 000 from the
moment the order is created. Transport is pure cost in every mode: `profit = saleTotal −
costTotal − transportCost`. The old "transport profit = transportCharge − transportCost, reported
separately, never folded into sale totals" model and the old "exposure = saleTotal +
transportCharge" credit-limit formula are **dead** — see the authoritative section for the exact
formula, the ledger rows and the deprecation.

Money flows through an immutable double-entry-style ledger; the exact postings per mode are
tabulated in the authoritative section. In short: `ORDER_SALE +saleTotal` on the CLIENT account
always; a `TRANSPORT_CLIENT_DIRECT −transportCost` CLIENT carve-out row for CLIENT_PAYS_DRIVER;
a `TRANSPORT_COST −transportCost` VEHICLE row only for DEALER_ABSORBED (negative balance = dealer
owes the driver). Settlement: VEHICLE_OUT (dealer pays the driver in cash/bank through a cashbox)
for DEALER_ABSORBED, and TRANSPORT_DIRECT — the workbook's «шопр учун барди» case — for
CLIENT_PAYS_DRIVER, which posts NO ledger rows at all (the carve-out already happened at order
creation) and exists purely as a record that the driver got his cash; by rule it never touches
the dealer's kassa (cashboxId is rejected). An order's transportPaidStatus (NOT_APPLICABLE / UNKNOWN / UNPAID / PAID / PAID_BY_CLIENT) is never set by hand — it is derived (recomputeTransportStatus) from surviving, non-voided payment allocations: full coverage ⇒ PAID or PAID_BY_CLIENT depending on the latest payment's kind; partial ⇒ UNPAID; UNKNOWN survives only for imported rows with no payment evidence (Excel blanks the owner must resolve). Order edit and soft-cancel reverse all transport ledger postings compensatingly, and a settled transport status must survive an order edit.

The UI is written entirely in Uzbek (Latin script): "Moshinalar" (vehicles), "Shofyor"/"Haydovchi" (driver — two different words are used on different screens), "Transport foydasi" (transport profit), "Qarzimiz" (we owe), "Shofyorlarga qarzimiz" (debt to drivers). Docs and the source Excel workbook use Uzbek-Cyrillic/Russian terms (шопир, Расход Авто, Туланди, клентдан). The domain surfaces in seven places: a flat Vehicles CRUD page (ADMIN/ACCOUNTANT only), a Transport section inside the New Order form (vehicle select with capacity check, 3-mode radio, cost/charge inputs, live profit preview), a Transport card on Order Detail, a transport-status tag column on the Orders list, the Payments modal (VEHICLE_OUT / TRANSPORT_DIRECT kinds with order allocations), a dashboard KPI "Transport foydasi (oy)", a Debts summary card, and transport columns in the Reports order register (+ Excel export). Notably, a rich vehicle-detail API (balance + full ledger statement + last 50 orders) exists but no screen consumes it, and a LogisticsRoute tariff table (factory×region cost-per-truck, versioned) exists in the schema with no UI and no use in order pricing.

### Entities

- **Vehicle (Moshina)** — Registry of trucks the dealer hires; doubles as the driver's debt account (the driver is a free-text attribute of the truck, not a separate entity)
  - Fields: id (uuid); name (required, e.g. 'Howo 1'); plate (unique, nullable); driver (free text, nullable); phone (nullable); capacityPallets (int, default 19, DTO bounds 1–40); active (soft-delete flag); balance (computed: Σ VEHICLE ledger entries; < 0 ⇒ dealer owes driver)
  - States: active | inactive (soft-deleted via DELETE /vehicles/:id, history preserved)
- **Order — transport facet** — Per-truck transport economics attached to every order; carries the 4-mode model ([TRANSPORT MODEL — AUTHORITATIVE](#transport-authoritative)) and the derived paid status
  - Fields: vehicleId (nullable FK); driverName (snapshot at order time — Vehicle.driver may change later); transportMode (default DEALER_ABSORBED); transportCost Decimal(18,2) — the driver's cut, always carved out of saleTotal; transportCharge Decimal(18,2) — legacy DEALER_CHARGED only, 0 on every live order; transportPaidStatus; transportPaidAt
  - States: transportMode: CLIENT_OWN | DEALER_ABSORBED | CLIENT_PAYS_DRIVER | DEALER_CHARGED (deprecated, read-only) | transportPaidStatus: NOT_APPLICABLE | UNKNOWN (import blank) | UNPAID | PAID (dealer paid driver) | PAID_BY_CLIENT (client paid driver directly)
- **Payment (kinds VEHICLE_OUT, TRANSPORT_DIRECT)** — Driver settlement: VEHICLE_OUT = dealer pays driver through a cashbox (DEALER_ABSORBED); TRANSPORT_DIRECT = record that the client paid the driver directly (CLIENT_PAYS_DRIVER) — no ledger rows, no kassa row, status only
  - Fields: kind; vehicleId (required for both kinds); clientId (required for TRANSPORT_DIRECT, forbidden for VEHICLE_OUT); cashboxId (required for VEHICLE_OUT, forbidden for TRANSPORT_DIRECT); amount UZS; allocations[] → orders (drives transportPaidStatus); voidedAt/voidReason
  - States: active | voided (re-derives affected orders' transport status)
- **LedgerEntry — VEHICLE account** — Immutable postings forming the driver debt ledger; balance = Σ amount
  - Fields: account = VEHICLE; vehicleId; source: TRANSPORT_COST (−cost at order creation/import) | PAYMENT (+amount) | REVERSAL (order edit/cancel compensations); amount (signed Decimal); orderId / paymentId links
- **LogisticsRoute** — Versioned factory→region tariff (costPerTruck, capacityPallets, effectiveFrom). Exists in schema and blocks region deletion, referenced by procurement — but has NO UI page and is NOT used to prefill transportCost on orders
  - Fields: factoryId; regionId; costPerTruck Decimal(18,2); capacityPallets (default 19); effectiveFrom; @@unique(factoryId, regionId, effectiveFrom)

### Workflows

- **Create order with transport** (AGENT, ADMIN, ACCOUNTANT; many times/day)
  1. Open /orders/new; fill client, date, items
  1. Optionally pick a vehicle from Select (option label shows name, plate, capacity, driver); picking autofills driverName (still editable)
  1. Pick transport mode via 3-button radio (default 'Dilerning hisobidan' = DEALER_ABSORBED)
  1. If mode ≠ CLIENT_OWN enter transportCost (so'm to driver) — it is part of saleTotal, never added on top; under CLIENT_PAYS_DRIVER the summary card shows the split live: «Savdo summasi 22 000 000 · shundan shofyorga 2 000 000 · dillerga 20 000 000»
  1. Client-side capacity warning if Σ pallets > vehicle.capacityPallets (or default 19); server hard-rejects the same condition
  1. Submit: server locks client row, checks the credit limit against clientChargeable(order), creates order, posts CLIENT −transportCost as TRANSPORT_CLIENT_DIRECT (CLIENT_PAYS_DRIVER) and VEHICLE −transportCost as TRANSPORT_COST (DEALER_ABSORBED, cost>0, vehicle set), sets transportPaidStatus UNPAID or NOT_APPLICABLE — see [TRANSPORT MODEL — AUTHORITATIVE](#transport-authoritative)
- **Deliver order (status flow)** (AGENT (own orders), ADMIN, ACCOUNTANT; many times/day)
  1. On /orders/:id, click the single 'next step' button: NEW→CONFIRMED→LOADING→DELIVERING→DELIVERED→COMPLETED (Steps widget shows progress)
  1. Each transition writes OrderStatusHistory; COMPLETED accrues factory bonus
  1. Cancel is a separate danger button (reason required) → soft-cancel, compensating reversal of all transport/goods/pallet postings, payments detach to client account
- **Pay driver (VEHICLE_OUT)** (ADMIN, ACCOUNTANT, CASHIER (create only, no allocations); daily)
  1. Open /payments → 'Yangi to'lov' modal
  1. Pick kind 'Shofyorga to'lov' (VEHICLE_OUT) → vehicle Select and cashbox Select appear
  1. Enter amount (cash/bank/USD with rate)
  1. ADMIN/ACCOUNTANT may allocate to that vehicle's orders — modal fetches first 100 orders (no vehicle filter on the API) and filters client-side by vehicleId
  1. Save: kassa OUT row (never below zero), VEHICLE +amount ledger posting, recomputeTransportStatus flips covered orders to PAID
- **Client pays driver directly (TRANSPORT_DIRECT, «шопр учун барди»)** (ADMIN, ACCOUNTANT, CASHIER; weekly)
  1. Payments modal → kind 'Mijoz shofyorga to'ladi' → client AND vehicle selects appear; cashbox hidden; info alert: 'bu to'lov kassadan o'tmaydi'
  1. Save: posts CLIENT −amount (client's debt reduced) AND VEHICLE +amount (driver settled) — no cash transaction
  1. Allocation (ADMIN/ACCOUNTANT) marks orders PAID_BY_CLIENT; guard: order must belong to the same client, and to the same vehicle if the order has one
- **Manage fleet (vehicles CRUD)** (ADMIN, ACCOUNTANT; rare)
  1. Open /vehicles (menu 'Moshinalar')
  1. Create/edit in a modal (name required, plate, driver, phone, capacity 1–40 with default 19, active switch on edit)
  1. Deactivate via confirm dialog — soft-delete only, history preserved; unique-plate violation surfaces a friendly Uzbek error
  1. All mutations audit-logged with before/after snapshots
- **Edit order transport (repost)** (ADMIN, ACCOUNTANT; weekly)
  1. PUT /orders/:id (ADMIN/ACCOUNTANT, status NEW/CONFIRMED, cost still PROVISIONAL only)
  1. Server reverses ALL order ledger postings, re-checks credit limit, reposts with new mode/cost/charge
  1. recomputeTransportStatus re-derives paid status from surviving payments — an already-settled transport survives the edit
- **Monitor transport money** (ADMIN, ACCOUNTANT; daily)
  1. Dashboard KPI 'Transport foydasi (oy)' = Σ(charge−cost) for non-cancelled orders this month; 'Shofyorlarga qarzimiz' card on /debts (weOweVehicles)
  1. Vehicles table shows per-vehicle ledger balance with red 'Qarzimiz' tag when negative
  1. Reports → 'Buyurtmalar reestri' tab: per-truck rows with plate, driver, transport tannarx / (mijozdan) / holati columns; Excel export orders-register.xlsx
  1. Orders list shows a TransportPaidTag column per order
- **Import legacy workbook transport** (ADMIN; rare (one-time migration))
  1. 21-sheet Excel import: Расход Авто numeric → transportCost, DEALER mode; «Туланди»/date → synthesizes a VEHICLE_OUT payment + kassa row + allocation (status PAID)
  1. «клентдан» → matches a driver-payment from client sheets pool → TRANSPORT_DIRECT payment (PAID_BY_CLIENT); unmatched trucks reported
  1. Blank paid-status → transportPaidStatus UNKNOWN, preserved until the owner resolves it with a real payment

### Roles

- **ADMIN**: Full domain access: vehicles CRUD + deactivate, order create/edit/cancel/status, all payment kinds, allocations, void, reports, import, settings (default truck capacity)
- **ACCOUNTANT**: Same as ADMIN for this domain: vehicles CRUD, GET /vehicles/:id with balances/statement, order edit/cancel, VEHICLE_OUT / TRANSPORT_DIRECT payments with allocations, reports
- **AGENT**: Order-form access only: GET /vehicles returns active vehicles with id/name/plate/driver/capacityPallets (NO balances); creates orders with full transport fields; advances status of own clients' orders; payments limited to CLIENT_IN — cannot pay drivers; no /vehicles page (route guard), no reports
- **CASHIER**: Can create VEHICLE_OUT and TRANSPORT_DIRECT payments (no allocations — those are ADMIN/ACCOUNTANT only); works from /payments and /kassa; no vehicles page, no orders pages

### Current UI

Pages: /vehicles — Moshinalar (fleet list + create/edit modal), /orders/new — Transport section of the order form, /orders/:id — Transport card + vehicle/driver in details, /orders — Transport paid-status tag column, /payments — payment modal with VEHICLE_OUT / TRANSPORT_DIRECT kinds, / (Dashboard) — 'Transport foydasi (oy)' and 'Shofyorlarga qarzimiz' KPIs, /debts — 'Shofyorlarga qarzimiz' summary card, /reports — 'Buyurtmalar reestri' tab with transport columns + xlsx export

All screens are Ant Design v6, Uzbek (Latin) language. VEHICLES (/vehicles): one full-width Card titled 'Moshinalar'; card-extra holds a 240px search input (client-side filter over name/plate/driver despite the API supporting server search) and a primary 'Yangi moshina' button. Body is a middle-size Table with columns: Nomi, Davlat raqami, Shofyor, Telefon, Sig'imi (paddon), Balans (signed Money + red 'Qarzimiz' tag when negative), Holat (Faol/Nofaol tag), Amallar (icon-only edit + deactivate buttons, ADMIN/ACCOUNTANT). Create/edit is a centered Modal with a vertical Form: name, plate, driver, phone, capacityPallets InputNumber (extra text explains default 19), active Switch on edit. Deactivate uses Modal.confirm. There is NO row click, NO detail page/drawer — rows are terminal. NEW ORDER (/orders/new): two-column layout (form 16/24, sticky 'Xulosa' summary card 8/24). Transport lives under a 'Transport' Divider inside the single long form: Row with vehicle Select (searchable, allowClear; option label concatenates name, plate, capacity, driver) and 'Haydovchi' text input; below, a warning Alert appears when pallet total exceeds capacity ('server buyurtmani rad etadi'); then a 3-option button-style Radio.Group (Mijozning o'z transporti / Dilerning hisobidan / Mijozdan olinadi); conditional InputNumbers with thousand-space formatters for cost and charge, plus inline computed 'Transport foydasi'. The summary card repeats pallets/capacity, transport cost/charge/profit, and 'Mijoz qarziga yoziladi' exposure. ORDER DETAIL (/orders/:id): header Card with back button, orderNo, status tag, one-step status-advance button and cancel button, plus a Steps strip; 'Ma'lumotlar' Descriptions card (vehicle name+plate, driver, etc.); a Row of two side-by-side Descriptions cards — 'Moliya' (sale/cost/goods profit) and 'Transport' (mode label, cost, charge, profit, TransportPaidTag); below, Tabs: To'lovlar (allocation table + progress bar vs saleTotal only), Paddonlar, Tarix (timeline), Izohlar (comments). No transport-payment action anywhere on this page. PAYMENTS (/payments): filterable table (kind color tags; party column renders 'Client → Vehicle' for TRANSPORT_DIRECT) + a create Modal where the kind Select morphs the form: VEHICLE_OUT shows vehicle + cashbox selects; TRANSPORT_DIRECT shows client + vehicle, hides cashbox, and shows an info Alert ('bu to'lov kassadan o'tmaydi'); ADMIN/ACCOUNTANT get an inline allocations Form.List of order+amount rows. REPORTS: Tabs (Svod / Buyurtmalar reestri); register tab = date-range picker, client/factory selects, Excel button, and a small-size Table with scroll x 2400 containing plate, driver, transport tannarx, transport (mijozdan), transport holati columns. DASHBOARD: KPI stat cards grid includes 'Transport foydasi (oy)' colored by sign.

### Pain points

- [high] No vehicle detail view at all: GET /vehicles/:id already returns the driver's balance, full ledger statement, and the last 50 orders with transport cost/charge/paid-status — but the web never calls it (endpoints.vehicle() has zero usages). A driver's settlement history is invisible; the only financial signal is one Balans cell in the list.
  - Suggestion: Add a vehicle detail page/drawer (row click) with balance header, statement table, unpaid-trucks list, and a 'pay driver' action pre-filled with the outstanding amount.
- [high] Settling a driver requires a cross-page trek: from Order Detail (which shows 'To'lanmagan' but offers no action) the user must navigate to /payments, open the modal, re-select kind, re-find the vehicle, then re-find the order in the allocation list. 6–8 interactions for the most common transport task.
  - Suggestion: Put a 'Shofyorga to'lash' quick action on the Order Detail Transport card and on negative-balance vehicle rows, pre-binding vehicle, order allocation, and remaining amount.
- [high] VEHICLE_OUT allocation picker is silently incomplete: GET /orders has no vehicleId filter, so the modal fetches the 100 most recent orders of ALL clients and filters client-side by vehicle. An older unpaid truck simply never appears in the list, with no indication anything is missing.
  - Suggestion: Add a vehicleId + transportPaidStatus filter to the orders API and drive the picker from 'unpaid orders of this vehicle'; show each order's transportCost and remaining amount in the option rows.
- [medium] Imported UNKNOWN transport statuses ('Aniqlanmagan') must be resolved by the owner, but there is no screen to find them: the Orders list has a status filter but no transportPaidStatus or vehicle filter, and the register table cannot filter by transport status either.
  - Suggestion: Add a transport-status (and vehicle) filter to Orders/register, or a dedicated 'transport to resolve' worklist with resolve actions.
- [medium] If the dispatcher enters a transportCost but forgets to pick a vehicle, the cost is stored (and reduces the dashboard's transport profit) yet NO VEHICLE ledger debt is posted and status becomes NOT_APPLICABLE — money that will be paid to some driver is untracked. The form neither warns nor requires a vehicle when cost > 0.
  - Suggestion: UI-level guard: when transportCost > 0 require a vehicle (or an explicit 'no vehicle' confirmation with a visible warning that the debt won't be tracked).
- [medium] The LogisticsRoute tariff table (cost per truck per factory×region, versioned) exists in the DB but has no management UI and is never used to prefill transportCost — dispatchers retype the standard price (typically 2,000,000 so'm) on every order, inviting typos.
  - Suggestion: Either build a routes/tariffs screen and auto-suggest transportCost from factory + client region, or drop the dead model.
- [low] Picking a vehicle silently overwrites the driverName field via autofill even if the user already typed a custom driver name (onValuesChange sets driverName unconditionally on vehicleId change).
  - Suggestion: Only autofill when the field is empty/untouched, or show the overwrite as a suggestion.
- [low] Inconsistent driver terminology across screens: Vehicles page and payment kind say 'Shofyor', order form and Order Detail say 'Haydovchi'; docs/import use Cyrillic 'шопир'. Same concept, three labels.
  - Suggestion: Pick one term (and one script) in the redesigned UI's glossary.
- [low] Vehicles page search filters client-side over the currently loaded page even though the API supports server-side search and pagination — with a large fleet, matches beyond the fetched page are invisible; the AntD pagination is also client-side over a paged API response.
  - Suggestion: Wire search/pagination to the API's search/page params.
- [low] Capacity overflow is only a passive warning in the form ('server buyurtmani rad etadi') — the user can still fill everything out and submit, only to get a server rejection after the fact.
  - Suggestion: Disable submit (or demand explicit confirmation) while pallets exceed capacity; surface remaining capacity next to the vehicle select.
- [medium] Order Detail's payment progress bar tracks raw saleTotal; for CLIENT_PAYS_DRIVER orders the client only ever owes saleTotal − transportCost, so the bar can never reach 100%.
  - Suggestion: Base the payment progress and the Moliya card on `clientChargeable(order)` and show the split underneath — [TRANSPORT MODEL — AUTHORITATIVE](#transport-authoritative).

### LOCKED RULES

- **Transport money — do not restate here.** The mode table, the `clientDirectTransport` / `clientChargeable` formula, the exact ledger rows per mode, the DEALER_CHARGED deprecation and the TRANSPORT_DIRECT record-only rule are defined ONCE in [TRANSPORT MODEL — AUTHORITATIVE](#transport-authoritative). The four bullets that used to live here (3 modes, transport profit = charge − cost, exposure = saleTotal + transportCharge, TRANSPORT_DIRECT posts both ledger sides) described the pre-2026-07-20 model and were all wrong. Summary of what survives: transport is priced INSIDE saleTotal; the server zeroes transportCost for CLIENT_OWN and zeroes transportCharge for every live mode; VEHICLE account convention is unchanged (balance < 0 ⇒ dealer owes the driver); VEHICLE_OUT always goes through a cashbox (cash OUT, never below zero) while TRANSPORT_DIRECT never touches one.
- transportPaidStatus is DERIVED, never hand-set: Σ active allocations of non-voided VEHICLE_OUT/TRANSPORT_DIRECT payments ≥ transportCost ⇒ PAID (latest payment VEHICLE_OUT) or PAID_BY_CLIENT (latest TRANSPORT_DIRECT); partial coverage ⇒ UNPAID (a 1-so'm allocation must not read as PAID); CLIENT_OWN or cost ≤ 0 ⇒ NOT_APPLICABLE; imported UNKNOWN is preserved while no payment evidence exists. Void/edit re-derives instead of flipping flags.
- Allocation guards: VEHICLE_OUT may only be allocated to orders of the same vehicle; TRANSPORT_DIRECT to orders of the same client, and of the same vehicle when the order has one.
- One order = one truck; server rejects when Σ item pallets > vehicle.capacityPallets (or the truckCapacityPallets setting, default 19, when no vehicle chosen).
- Vehicles are soft-deleted only (active=false, 'Tarix saqlanadi'); plate is unique; every create/update/deactivate is audit-logged with before/after snapshots.
- driverName on the order is a snapshot at order time — Vehicle.driver may change later without rewriting history.
- Order edit (NEW/CONFIRMED only) does a full compensating reversal + repost of all ledger entries; an already-settled transport (standing VEHICLE_OUT/TRANSPORT_DIRECT payment) must survive the edit. Soft-cancel reverses transport postings and detaches payments to the client's account (no auto-refund).
- Role boundaries: AGENT sees only active vehicles without financials (order-form shape), may create orders but only CLIENT_IN payments; vehicle CRUD, vehicle detail, allocations, and voids are ADMIN/ACCOUNTANT; CASHIER may create (not allocate) driver payments.
- All money is Prisma.Decimal(18,2) UZS computed server-side; client-side arithmetic is display-only.

### API

- GET /vehicles — paged list + search; AGENT: active-only minimal fields; ADMIN/ACCOUNTANT: full rows + ledger balance per vehicle
- GET /vehicles/:id — vehicle + balance + full VEHICLE ledger statement + last 50 orders with transport fields (ADMIN/ACCOUNTANT; currently unused by the web UI)
- POST /vehicles — create vehicle (ADMIN/ACCOUNTANT)
- PUT /vehicles/:id — update incl. capacity and active flag
- DELETE /vehicles/:id — soft-deactivate (never hard-delete)
- POST /orders — create order with vehicleId, driverName, transportMode, transportCost, transportCharge; posts transport ledger entries
- PUT /orders/:id — edit NEW/CONFIRMED order; full reverse + repost; re-derives transport status
- PATCH /orders/:id/status — one-step delivery flow NEW→…→COMPLETED
- DELETE /orders/:id — soft-cancel with compensating transport reversals
- GET /orders — list (status/client/factory/date filters; NO vehicle filter — a gap the Payments UI works around client-side)
- POST /payments — create payment incl. VEHICLE_OUT (vehicle+cashbox) and TRANSPORT_DIRECT (client+vehicle, no cashbox); optional inline allocations (ADMIN/ACCOUNTANT)
- POST /payments/:id/allocations — allocate to orders; recomputes transportPaidStatus
- POST /payments/:id/void — void payment; re-derives transport status of affected orders
- GET /dashboard — includes transportProfitMonth and weOweVehicles KPIs
- GET /debts/summary — includes weOweVehicles ('Shofyorlarga qarzimiz')
- GET /debts/statement?account=VEHICLE&partyId=… — vehicle ledger statement (exists; not surfaced in Debts UI)
- GET /reports/orders-register(.xlsx) — per-truck register rows with plate, driver, transportCost/Charge/PaidStatus

---

## SmartBlok ERP (gazoblok/AAC-block dealer business, Khorezm UZ) — UI shell, navigation, theming and design-system layer of the v3 web client

SmartBlok's web client (apps/web) is a React 18.3 + Vite 6 SPA whose entire design system is Ant Design v6 (installed antd 6.5.0, @ant-design/icons 6.3.2, @ant-design/plots 2.6.8 for charts). There is no Tailwind and almost no custom CSS: index.css is a 47-line reset with three helpers (tabular-nums `.num` class, `.scroll-x`, and print CSS that strips the app chrome so OrderDetail prints like an invoice). Server state is TanStack Query v5 (30s staleTime, retry 1); a single socket.io connection (lib/realtime.ts) listens for `change` broadcasts and invalidates entity-name-first query keys app-wide, so every page updates live without polling. Routing is react-router-dom 6.28 with route-level code splitting (every page lazy-loaded, manualChunks split react/antd/charts vendors) and real per-route RBAC via a RequireRole guard that renders an AntD 403 Result for wrong roles. Auth is JWT in localStorage (sb_token/sb_user) with an axios interceptor that force-redirects to /login on 401 and re-validates the session via /auth/me on boot.

The UI language is a notable mix: all application copy — menu labels, buttons, statuses, empty states, toasts — is written in Uzbek (Latin script; `<html lang="uz">`, e.g. "Buyurtmalar", "To'lovlar", "Qarzlar", "Bekor qilish"), but the AntD ConfigProvider locale is ru_RU and dayjs is set to the Russian locale, so all built-in component text (pagination controls, date-picker months, filter dropdowns) appears in Russian, and numbers are formatted with ru-RU space grouping. i18next and react-i18next are declared in package.json but never imported — there is no i18n layer; every string is hardcoded Uzbek. Money is Decimal-as-string over the wire (`type Money = string`), rendered by a `Money` atom (tabular numerals, optional green/red sign coloring), and the client never does money arithmetic beyond display-only sums; dates are DD.MM.YYYY.

Theming is light/dark via ConfigProvider algorithm switching (theme.ts): a restrained steel-blue brand (#2E6584 light / #5b93b3 dark), borderRadius 6, Segoe UI Variable font stack, near-black navy sidebar in both modes (#16222c / #101418). Mode persists in localStorage `sb_theme` with prefers-color-scheme fallback, toggled by a Sun/Moon Switch in the header. The shell (AppShell.tsx) is a classic admin layout: 232px collapsible dark Sider with a 🧱 SmartBlok wordmark and a role-filtered inline Menu (12 top-level items + two submenu groups "Katalog" and "Boshqaruv"), a slim 52px header containing only a "Ctrl+K — tez qidiruv" text hint, the theme switch, and a user avatar dropdown (Profil / Chiqish), and a 20px-padded content Outlet. A Ctrl/Cmd+K CommandPalette (custom, built on Modal+Input+List) offers keyboard-first navigation over the same role-filtered route list — navigation only, it cannot search actual records. Important for the redesign: docs/08-foydalanuvchi-interfeysi.md describes the PREVIOUS v2 UI (Tailwind v4, Framer Motion, lucide icons, custom EntityTable/Drawer primitives) and is stale — the shipped v3 code is pure AntD and fixed most of the audit-era complaints (route RBAC, server pagination, error states with retry, typed API, realtime, code splitting).

### Entities

- **Order** — Central sales document: client order for AAC blocks from a factory, with items, transport, financing and lifecycle
  - Fields: orderNo; date; dueDate; client; agent; factory; vehicle/driverName; saleTotal; costTotal; costStatus; transportMode (CLIENT_OWN|DEALER_ABSORBED|CLIENT_PAYS_DRIVER|DEALER_CHARGED deprecated); transportCost; transportCharge (legacy, 0 on live orders); transportPaidStatus; items[]; statusHistory; comments; allocations; cancelReason
  - States: NEW | CONFIRMED | LOADING | DELIVERING | DELIVERED | COMPLETED | CANCELLED
- **OrderItem** — Line item: product, volume in m³, pallets, sale price (may be pending) and cost price
  - Fields: productId; quantityM3; palletCount; palletPrice; salePricePerM3; saleTotal; pricePending; provisionalPriceKind; costPricePerM3; finalCostPricePerM3; costTotal
  - States: pricePending true/false | costStatus: PROVISIONAL | PARTIAL | FINAL
- **Payment** — Money movement in 6 directions (client in/refund, factory out/refund, vehicle out, client-pays-driver direct) with method, optional USD leg, void and allocations to orders
  - Fields: date; kind (6 PaymentKind values); method (CASH|BANK|CLICK|TERMINAL|CARD|USD|BONUS); amount; usdAmount; rate; client/factory/vehicle party; cashbox; reconciled; voidedAt; voidReason; allocations[]
  - States: active | voided | reconciled/unreconciled (Tekshirilsin)
- **Client** — Buyer with region, owning agent, credit limit, payment terms, running debt balance and pallet balance
  - Fields: name; legalEntity; phone; region; agent; creditLimit (null = unlimited); paymentTermDays; balance; palletBalance; aliases; client-specific prices
  - States: active | inactive (soft-deactivated, requires zero balance)
- **Factory** — Supplier plant; carries payable balance, versioned bonus program and bonus wallet, pallet balance
  - Fields: name; balance (we owe); bonusWallet; palletBalance; bonusProgram (NONE|PER_M3|PERCENT, versioned)
  - States: active | inactive
- **Product** — Factory catalog item (block size) with m³-per-pallet conversion and price list per PriceKind
  - Fields: factory; name; size; m3PerPallet; blocksPerPallet; unit; prices[] {kind: FACTORY_CASH|FACTORY_BANK|DEALER_SALE, pricePerM3, effectiveFrom}
  - States: active | inactive
- **Vehicle** — Truck/driver used for delivery; carries payable balance for transport services
  - Fields: name; plate; driver; phone; capacityPallets (default 19); balance
  - States: active | inactive
- **Cashbox / CashTransaction** — Treasury: typed cash registers (CASH/BANK/CLICK/TERMINAL/CARD, UZS or USD) with an IN/OUT ledger fed by payments, expenses, bonus withdrawals, manual entries and reversals
  - Fields: cashbox: name, type, currency, balance, inTotal/outTotal; tx: date, direction, amount, source (MANUAL|PAYMENT|EXPENSE|BONUS_WITHDRAWAL|REVERSAL), note
  - States: cashbox active/inactive | tx direction IN/OUT
- **Expense** — Operating expense against a category and cashbox, voidable with reason
  - Fields: date; amount; category; cashbox; note; voidedAt
  - States: active | voided
- **BonusWallet / BonusTransaction** — Per-factory bonus accrual wallet: accruals from orders, withdrawals to kassa, debt offsets, adjustments, reversals
  - Fields: factory; balance; tx: type, amount, baseAmount, baseM3, order link, note
  - States: ACCRUAL | WITHDRAWAL | DEBT_OFFSET | ADJUSTMENT | REVERSAL
- **PalletBalance / PalletTransaction** — In-kind pallet (paddon) tracking per client and factory: received, delivered, returned, charged-lost, adjusted, reversed
  - Fields: client/factory; balance (count); tx: date, type, qty, note
  - States: RECEIVED_FROM_FACTORY | DELIVERED_TO_CLIENT | RETURNED_BY_CLIENT | RETURNED_TO_FACTORY | CHARGED_LOST | ADJUSTMENT | REVERSAL
- **Agent** — Field salesperson owning a client book; ranked on dashboard; own debt limit
  - Fields: name; phone; sortNo; debtLimit; clientCount; outstandingDebt
  - States: active | inactive
- **Region / LegalEntity / User / Settings** — Supporting catalogs: geographic regions, legal entities (DEALER|FACTORY|THIRD_PARTY with INN), system users with role+optional agent binding, key-value system settings
  - Fields: region: name, note; legalEntity: name, kind, inn; user: username, name, role, agentId; settings: key/value
  - States: active/inactive where applicable

### Workflows

- **Login and session** (ADMIN, ACCOUNTANT, AGENT, CASHIER; daily)
  1. Open /login (centered 380px Card, Uzbek copy, no demo credentials in v3)
  1. Submit username+password (AntD Form validation)
  1. JWT + user stored in localStorage, redirect to /
  1. On boot /auth/me re-validates; 401 anywhere clears storage and hard-redirects to /login
- **Navigate the app** (ADMIN, ACCOUNTANT, AGENT, CASHIER; many times/day)
  1. Pick item in dark 232px sidebar (role-filtered, 2 collapsible groups)
  1. OR press Ctrl/Cmd+K and type to fuzzy-match one of 22 route commands (Uzbek+Russian+English keywords), arrows+Enter to jump
  1. Header avatar dropdown for Profil/Chiqish; Switch toggles dark mode
- **Browse and filter a list (canonical list-page pattern)** (ADMIN, ACCOUNTANT, AGENT, CASHIER (payments/kassa only); many times/day)
  1. Page = Title row + primary action Button, then one Card
  1. Orders adds an 8-tab status strip (Barchasi + 7 statuses)
  1. Filter row: Input.Search + showSearch Selects (client, factory...) + DD.MM.YYYY RangePicker; every change resets to page 1
  1. Server-paginated AntD Table (20/page, size changer, 'Jami: N ta'), horizontal scroll x~1200, keepPreviousData during refetch
  1. Query error replaces table with Alert + 'Qayta urinish' retry button
  1. Click the linked first column (order no / client name) to open the detail page
- **Create an order** (ADMIN, ACCOUNTANT, AGENT; many times/day)
  1. Orders → 'Yangi buyurtma' → full page /orders/new (707-line form)
  1. Pick client (server-searched Select), date, factory-scoped products
  1. Per item: pallets/m³ with capacity math (default truck 19 pallets), pricing mode CATALOG/NEGOTIATED/LUMP/PENDING
  1. Choose transport mode (3 live modes) + transport cost (inside saleTotal), intended payment method CASH/BANK, note
  1. Save → debt recognized immediately, redirected to detail
- **Drive order lifecycle (OrderDetail workspace)** (ADMIN, ACCOUNTANT (full), AGENT (advance status, comment); many times/day)
  1. Header card: back button, orderNo, status tag, single forward-action button labeled as the ACTION (Tasdiqlash → ... → Yakunlash) + danger 'Bekor qilish'
  1. Steps strip visualizes NEW→...→COMPLETED; cancelled shows red Alert with reason
  1. Descriptions card (agent/factory/vehicle/driver/due date/creator), items table with per-item 'Narxlash' modal for pending prices (per-m³ or lump)
  1. Moliya + Transport twin cards show sale/cost/goods-profit and transport cost/charge/profit
  1. Tabs: To'lovlar (allocation Progress bar + table), Paddonlar, Tarix (Timeline of status/payment/comment events), Izohlar (comment thread with send box)
  1. Cancel = modal.confirm with mandatory reason TextArea; storno semantics explained in the dialog
- **Record and allocate a payment** (ADMIN, ACCOUNTANT, CASHIER, AGENT (own clients, CLIENT_IN); many times/day)
  1. Payments → 'Yangi to'lov' Modal (fresh idempotency key per open)
  1. Pick kind (6 kinds), method (7 methods incl. USD with amount×rate preview and BONUS), party, cashbox
  1. Optionally allocate to open orders via dynamic Form.List rows
  1. Row actions: eye icon opens detail Drawer; void = modal.confirm with mandatory reason
  1. Kassa ledger and balances update via socket broadcast everywhere
- **Treasury day (Kassa/Expenses)** (CASHIER, ACCOUNTANT, ADMIN; daily)
  1. CASHIER lands on a dedicated kassa dashboard (per-cashbox cards: balance, today in/out)
  1. Kassa page: cashbox cards + filterable transactions ledger, manual IN/OUT entry, reversal with reason
  1. Expenses: category-filtered list, create expense against a cashbox, void with reason
- **Monitor business (Dashboard)** (ADMIN, ACCOUNTANT, AGENT (scoped), CASHIER (kassa variant); many times/day)
  1. 12 KPI Statistic cards (today/month/year sales, collected, goods & transport profit colored by sign, client debt, factory debt, bonus wallets, expected collections, pallets at clients, m³ sold) — abbreviated fmtShort values, full so'm on hover Tooltip
  1. 30-day Line chart (sales vs collected, theme-aware CVD-safe colors)
  1. Agents ranking table (hidden from AGENT role; agents see scoped KPIs)
  1. LIVE tag indicates realtime socket updates
- **Reports and export** (ADMIN, ACCOUNTANT; weekly)
  1. Reports page: date-range Svod (per-factory and per-agent/client blocks with subtotals, identity checks) + Orders register tab
  1. Only place with real export: download server-generated .xlsx (svod.xlsx, orders-register.xlsx) via authenticated blob
- **Excel workbook import** (ADMIN, ACCOUNTANT; rare (migration))
  1. Import page: upload legacy 21-sheet workbook, preview parse, run import, view reconciliation stats
- **Catalog & admin maintenance** (ADMIN, ACCOUNTANT (catalog), ADMIN only (users/settings); weekly)
  1. Factories/Products/Vehicles/Agents/Regions/LegalEntities: table + create Modal + edit (Modal or Drawer), deactivate via modal.confirm
  1. Users: ADMIN creates users with role and optional agent binding
  1. Settings: ADMIN edits system key-values (limits etc.)

### Roles

- **ADMIN**: Everything: all 26 routes including /users and /settings; can cancel orders, void payments/expenses, deactivate clients; sees all financials
- **ACCOUNTANT**: All business pages (orders, clients, payments, debts, pallets, kassa, expenses, bonus, full catalog, reports, import, procurement); manages pricing, cancellations, voids; no /users, /settings
- **AGENT**: Dashboard (agent-scoped KPIs, no factory-debt/bonus cards), Orders, Clients, Payments, Debts, Pallets, agent detail pages; creates orders and client payments for own book; cannot see catalog admin, kassa, expenses, bonus, reports; client form hides creditLimit/agent fields (office-only)
- **CASHIER**: Kassa-only world: dedicated cashbox dashboard, Payments, Kassa, Expenses, Profile; no orders/clients/debts/catalog/reports. UI-level RBAC enforced BOTH in nav filtering and per-route RequireRole guard rendering AntD 403 Result

### Current UI

Pages: /login — Login (centered card), / — Dashboard (role-switched: MainDashboard vs CashierDashboard), /orders — Orders list (tabs+filters+table), /orders/new — NewOrder full-page form, /orders/:id — OrderDetail workspace, /clients — Clients list, /clients/:id — ClientDetail, /agents — Agents list (FIN only), /agents/:id — AgentDetail (SALES), /factories — Factories list, /factories/:id — FactoryDetail (tabs: payments, bonus program, pallets), /products — Products (catalog + price history drawer), /vehicles — Vehicles, /regions — Regions, /legal-entities — LegalEntities, /procurement — Procurement cost matrix (Ta'minot matritsasi), /payments — Payments (create modal + detail drawer), /debts — Debts (summary + aging list + statement), /pallets — Pallets (balances + transactions + return/charge-lost modals), /bonus — Bonus wallets + transactions, /expenses — Expenses (+categories), /kassa — Kassa (cashbox cards + ledger + manual tx), /reports — Reports (Svod + orders register, xlsx export), /import — Excel import (21-sheet workbook), /users — Users (ADMIN), /settings — Settings (ADMIN), /profile — Profile (personal info + password), * — redirect to /

Shell: fixed-height 100vh AntD Layout. Left: 232px collapsible dark Sider (#16222c light-mode / #101418 dark-mode) with a 52px '🧱 SmartBlok' wordmark and an inline dark Menu — 12 top-level items (Boshqaruv paneli, Buyurtmalar, Mijozlar, To'lovlar, Qarzlar, Paddonlar, Kassa, Xarajatlar, Bonus hamyonlar, Hisobotlar, Excel import, Ta'minot matritsasi) plus two submenus: 'Katalog' (Zavodlar, Mahsulotlar, Moshinalar, Agentlar, Hududlar, Yuridik shaxslar) and ADMIN-only 'Boshqaruv' (Foydalanuvchilar, Tizim sozlamalari); items filtered per role. Top: slim 52px header with, left, a plain grey text hint 'Ctrl+K — tez qidiruv' (not clickable), then a Sun/Moon theme Switch and a user chip (initial Avatar + name + role code) opening a Dropdown (Profil, divider, Chiqish). No breadcrumbs anywhere; page identity comes only from an in-content Typography.Title (inconsistently level 3 on Orders vs level 4 on Clients/Dashboard). Content: 20px padding, no max-width. LIST PAGES follow one template: title row with right-aligned primary Button, then a single Card containing (Orders only) an 8-item status Tabs strip, a wrapping filter Space (Input.Search ~240px, showSearch Selects for client/factory/kind/method, DD.MM.YYYY RangePicker), and a server-paginated AntD Table (rowKey id, pageSize 20 w/ size changer, showTotal 'Jami: N ta', scroll x≈1200, fixed-left link column on Orders). Numeric columns right-aligned with .num tabular figures; statuses are colored Tag atoms from three StatusTag components; money via the Money atom (grouped digits, optional signed green/red). Errors render an Alert with a retry Button in place of the table; loading uses Table loading spinners or Card loading; empty states are AntD Empty with Uzbek text. Row actions are small icon Buttons (edit pencil, red stop) with title tooltips. CREATE is usually a Modal form (Clients, Payments, Factories, Regions...); EDIT is sometimes a right Drawer (Clients, Products); record DETAIL is either a right Drawer (Payments) or a dedicated page (Orders, Clients, Factories, Agents). NewOrder is a full-page multi-card form instead of a modal. DESTRUCTIVE actions (cancel order, void payment/expense, deactivate client) all use App.useApp() modal.confirm with a mandatory-reason TextArea captured in a closure variable and danger OK button. DETAIL PAGES are stacked Cards: OrderDetail = header card (back arrow, orderNo, status tag, single forward-action primary button + danger cancel, Steps progress strip), Descriptions grid card, items Table card with per-row 'Narxlash' price modal, side-by-side Moliya/Transport Descriptions cards, and a Tabs card (To'lovlar with allocation Progress, Paddonlar, Tarix Timeline, Izohlar comment List + composer). Dashboard = title+LIVE tag, a 12-card responsive KPI grid (Statistic in small Cards, abbreviated values with full-value Tooltip, profit cards color-coded by sign), a theme-aware @ant-design/plots Line chart (30-day sales vs collected), and an agents-ranking Table; CASHIER gets a separate per-cashbox card grid (balance + today in/out). Login is a lone centered 380px Card on the layout background. Print stylesheet hides sider/buttons/pagination/tabs so OrderDetail doubles as a printable document. Feedback is exclusively antd message toasts (success Uzbek phrases, apiError() extracting Nest messages).

### Pain points

- [high] Dead deep link: OrderDetail's allocation table links to /payments?paymentId=... but Payments.tsx never reads any query param (no useSearchParams/location.search), so the user lands on the unfiltered payments list and must manually re-find the payment
  - Suggestion: In the redesign make payment detail addressable (e.g. /payments/:id or drawer opened from URL param) and audit every cross-entity link for round-trip navigability
- [high] Filter amnesia: all list filters (status tab, search, client/factory selects, date range, page) live in local useState with no URL sync; opening a detail page and going back loses the entire filter context — heavy daily friction on Orders/Payments
  - Suggestion: Persist filters in URL search params (shareable, back-button-safe) or a per-page filter store; keep the page-1-reset behavior on filter change
- [medium] Mixed-language UI: app copy is Uzbek but ConfigProvider locale is ru_RU and dayjs is 'ru', so pagination, date-picker months, and built-in placeholders render in Russian inside Uzbek screens; i18next is installed but completely unused (hardcoded strings)
  - Suggestion: Decide on one primary language (owner speaks Uzbek — docs are Uzbek), create/use an uz_Latn AntD locale pack, and wire the already-present i18next if RU/UZ switching is a real requirement
- [medium] Command palette is invisible to mouse users: the header shows a static grey text 'Ctrl+K — tez qidiruv' that is not clickable, and the palette only navigates to pages — it cannot find a client, order number, or payment, which is the search users actually need
  - Suggestion: Make the hint a real search button opening the palette, and extend the palette to query records (clients by name/phone, orders by number) with recent-items history
- [medium] No column sorting anywhere (zero `sorter:` usages) and no export on any list page — only Reports has xlsx export; accountants cannot sort clients by debt or payments by amount, nor pull an ad-hoc list into Excel
  - Suggestion: Add server-driven sorting to the shared table pattern and a standard export action on every register (backend already has an xlsx pipeline)
- [medium] Inconsistent interaction grammar: create=Modal here, full page there (NewOrder); edit=Drawer on Clients/Products but Modal on Factories/Regions; detail=Drawer for Payments but full pages for Orders/Clients; destructive confirms embed a TextArea inside modal.confirm with a closure `let reason` variable that only validates after pressing OK
  - Suggestion: Define one pattern per intent in the new design system (e.g. drawer for create/edit, page for workspaces, dedicated ReasonModal component with inline required validation) and apply it uniformly
- [medium] No breadcrumbs and inconsistent page headers (Title level 3 vs level 4, differing header rows): on detail pages the only way back is the browser or a small arrow button; users deep-linked from realtime/other pages lose orientation
  - Suggestion: Shared PageHeader component with breadcrumb trail (Buyurtmalar / SB-1042), consistent title size and action-slot placement
- [medium] Weak responsive story for field agents: fixed 232px Sider (no breakpoint prop), tables forced to scroll x=1200, 12-KPI dashboard grid — on a phone the primary AGENT persona (creating orders and taking payments on the road) gets a desktop UI squeezed down
  - Suggestion: Design mobile-first flows for the agent's three jobs (new order, take payment, check client debt); use responsive card lists instead of wide tables on small screens
- [low] 12 abbreviated KPI cards on the dashboard hide exact figures behind hover Tooltips (fmtShort '1.2 mlrd'), and the flat sidebar mixes daily-use items (Orders, Payments) with rare ones (Excel import, Ta'minot matritsasi) in one 12-item list; some submenu items have no icons so a collapsed sidebar shows blank entries
  - Suggestion: Tier the dashboard (3-4 hero KPIs + secondary grid, exact values visible), group nav by frequency (Savdo / Moliya / Katalog / Tizim), give every item an icon
- [low] Row-level affordances are small: navigation only via the tiny link in the first column (no onRow click on Orders/Clients), actions are icon-only buttons relying on HTML title (no aria-label, no text)
  - Suggestion: Make whole rows clickable with hover affordance, keep explicit kebab/action column with labeled menu items; add aria-labels for a11y
- [low] Realtime invalidation is coarse: one payment event invalidates 9 query families app-wide; on a busy day every open client refetches most of the app repeatedly (server already flagged for unbounded-list history)
  - Suggestion: Keep the entity-key convention but include ids in broadcasts to allow targeted invalidation, and debounce bursts
- [low] Giant single-file screens (Payments 961 lines, NewOrder 707, Import 785) each hand-roll their filter bars, money inputs and confirm dialogs — the moneyFormatter/moneyParser pair is copy-pasted in at least NewOrder and OrderDetail
  - Suggestion: Extract shared FilterBar, MoneyInput, ReasonConfirm, and ListPage scaffolding into the new design system to prevent drift (the v2 audit already flagged this class of duplication)

### LOCKED RULES

- Money is Decimal-as-string end-to-end (`type Money = string`): the client must never do float arithmetic on money — display-only formatting via lib/format (documented in types.ts and format.ts headers); all financial computation stays server-side
- Money display: ru-RU digit grouping, rounded to whole so'm, tabular numerals; |balance| < 1 UZS is float residue and must display as settled (isSettled)
- Debt is recognized at ORDER CREATION, not delivery (owner decision; docs/audit + memory), with client credit-limit enforcement
- Order cancellation is SOFT-CANCEL with a mandatory reason: financial entries are storno'd AND the money is fully unwound — the client is refunded and the factory payment reclaimed (owner rule 2026-07-22; the cancel dialog explicitly promises the refund). SUPERSEDES the earlier «payments remain on the client's account» behavior.
- Order status flow is forward-only single steps: NEW→CONFIRMED→LOADING→DELIVERING→DELIVERED→COMPLETED; CANCELLED is terminal; UI action labels are verbs for the next transition
- Cost lifecycle PROVISIONAL→PARTIAL→FINAL: final cost is fixed by allocation of factory payments (cost-at-payment-allocation), shown via CostStatusTag; item sale prices may be PENDING and priced later per-m³ or as a lump sum
- Transport is ALWAYS priced inside saleTotal; 3 live modes (CLIENT_OWN / DEALER_ABSORBED / CLIENT_PAYS_DRIVER) + deprecated DEALER_CHARGED — see [TRANSPORT MODEL — AUTHORITATIVE](#transport-authoritative)
- Pallets (paddonlar) are tracked in-kind as counts per client/factory with the 7 transaction types incl. CHARGED_LOST conversion to money debt
- Factory bonus programs are versioned (NONE/PER_M3/PERCENT); bonus wallets support withdraw, debt offset, and reversal with reason
- Payments have 6 kinds and 7 methods; USD payments carry usdAmount × rate; voiding requires a reason and preserves the record; payment creation uses a fresh idempotency key per form-open (double-submit protection)
- RBAC is exactly 4 roles (ADMIN, ACCOUNTANT, AGENT, CASHIER) enforced at route level (RequireRole → 403) and API level; AGENT data is server-scoped to own clients; role sets: FIN=ADMIN+ACCOUNTANT, SALES=+AGENT, TREASURY=ADMIN+ACCOUNTANT+CASHIER
- Every reversal/void/cancel/deactivate requires an explicit reason string; client deactivation requires zero balance
- React-query key convention is MANDATORY: list/detail keys start with the entity name (['orders'], ['orders', id]) so socket.io entity broadcasts invalidate everything (lib/realtime.ts contract)
- Dates display as DD.MM.YYYY (datetimes DD.MM.YYYY HH:mm); business runs in UZS with USD as a conversion leg only

### API

- POST /auth/login — authenticate, returns JWT + user
- GET /auth/me — validate session / refresh user
- PUT /auth/me — update own profile/password
- GET /dashboard/summary — KPI block (agent-scoped or global)
- GET /dashboard/trends?days — daily sales/orders/collected series
- GET /dashboard/agents-ranking?month — agent league table
- GET /dashboard/kassa — cashier dashboard boxes
- GET/POST/PUT/DELETE /regions[/:id] — regions CRUD
- GET /agents, GET /agents/me, GET/POST/PUT/DELETE /agents/:id — agents
- GET /clients (paged+search+agentId), GET/POST/PUT/DELETE /clients/:id — clients; POST/DELETE /clients/:id/aliases[/:aliasId]; POST /clients/:id/prices
- GET/POST/PUT/DELETE /factories[/:id]; GET/POST /factories/:id/bonus-program — factories + versioned bonus program
- GET/POST/PUT/DELETE /products[/:id]; GET/POST /products/:id/prices — catalog + price history
- GET/POST/PUT/DELETE /vehicles[/:id] — vehicles
- GET/POST/PUT /legal-entities[/:id] — legal entities
- GET /settings, PUT /settings/:key — system settings
- GET /procurement/matrix?regionId&productId — cost matrix
- GET /orders (paged, status/client/factory/date filters), GET /orders/:id, GET /orders/:id/timeline, POST /orders, PUT /orders/:id, PATCH /orders/:id/status, DELETE /orders/:id (soft-cancel w/ reason), PATCH /orders/:orderId/items/:itemId/price, GET/POST /orders/:id/comments
- GET /payments (paged, kind/method/party/date/voided), GET /payments/:id, POST /payments, POST /payments/:id/allocations, POST /payments/:id/void
- GET /pallets/balances, GET /pallets/transactions, POST /pallets/client-return, POST /pallets/factory-return, POST /pallets/charge-lost
- GET /bonus/wallets, GET /bonus/transactions, POST /bonus/withdraw, POST /bonus/offset, POST /bonus/transactions/:id/reverse
- GET /kassa/cashboxes, GET /kassa/transactions, POST /kassa/manual, POST /kassa/transactions/:id/reverse, GET /kassa/summary
- GET /expenses, POST /expenses, POST /expenses/:id/void, GET/POST /expenses/categories
- GET /debts/summary, GET /debts/clients (aging), GET /debts/statement (CLIENT|FACTORY|VEHICLE ledger)
- GET /reports/svod, GET /reports/orders-register, GET /reports/svod.xlsx + /reports/orders-register.xlsx (authenticated blob download)
- GET/POST/PUT/DELETE /users[/:id] — user management (ADMIN)

---

## SmartBlok — ERP for a gazoblock (aerated-concrete block) distribution dealer in Uzbekistan: the dealer buys blocks by the truckload from factories ("CAOLS KS" MCHJ), sells to clients through field agents, manages three-sided debts (clients / factories / truck drivers), returnable pallets, factory bonus wallets, multi-cashbox treasury (UZS/USD/Click/Bank/Card), and migration from the owner's Excel workbook «Газоблок Счет.xlsx».

SmartBlok digitizes a real dealer business previously run in one Excel workbook. The dealer buys gazoblock from factories by the truck (one order = one truck, 19 pallets ≈ 32.8 m³), pays the factory for blocks PLUS 130,000 UZS per wooden pallet, and sells to ~17+ clients at negotiated per-m³ prices (700–760k) attributed to numbered agents. Money flows through several cashboxes tied to the owner's legal entities (Септем Алока bank, cash, cash-to-card, Click/Terminal, USD). Debt is three-sided: clients owe the dealer, the dealer owes (or has an advance at) factories, and the dealer owes truck drivers for transport. Pallets are a fourth, in-kind ledger: clients owe pallet COUNTS back, never money, unless explicitly charged for lost ones. Factories run versioned bonus programs (fixed per m³ or % of purchase) that accrue into a per-factory bonus wallet on order completion, spendable as cash withdrawal or factory-debt offset.

The system was rebuilt (v3, 2026-07-11) on NestJS + PostgreSQL + Prisma Decimal after a 137-finding audit of v2. The financial core is an immutable double-entry-style ledger (LedgerEntry): every balance is a SUM over signed postings, never a stored number; corrections are compensating reversal rows linked by reversalOfId; payments/expenses/orders are voided or soft-cancelled, never hard-deleted. Owner-locked rules (recorded 2026-07-09/11 and encoded in code): client debt is recognized at ORDER CREATION (not delivery); credit limits ARE enforced (client limit + per-agent debt limit); order deletion = soft-cancel with reason; pallets are owed in kind; an order's factory cost stays PROVISIONAL until factory-payment allocation finalizes it at the cash-vs-bank price implied by the payment method; bonus programs are versioned and never retroactive; transport has three modes (client's own truck / dealer-absorbed / dealer-charged) with transport profit reported separately from goods profit, plus the special «шопр учун барди» flow where the client pays the driver directly (credits the client AND settles the vehicle without touching dealer cash).

The current UI is React 18 + Ant Design (v6.5 using a v5-compatible subset) with dark/light themes, WebSocket realtime invalidation, route-level code splitting, a Ctrl+K command palette, and server-side pagination everywhere. All UI copy is inline Uzbek (Latin script) — e.g. "Buyurtmalar", "To'lovlar", "Qarzlar" — while the underlying business vocabulary and the source workbook are Russian/Cyrillic (Свод, паддон, шопр); RU/UZ i18n extraction is an acknowledged backlog item. Layout: dark left sider menu (role-filtered), card-based list pages with status tabs + filter rows + paginated tables, a full-page order creation form with live totals/credit-risk/capacity warnings, a rich order detail page (Steps lifecycle, allocations progress, pallet movements, timeline, comments), and modal-driven flows for payments, pallets, bonus, kassa and expenses. Docs 05/06 (Uzbek TZ) still describe the v2 model — they are stale on the load-bearing rules (they say debt at DELIVERED and creditLimit unenforced); docs/audit/excel-spec.md + the v3 code are the source of truth.

### Entities

- **Order (+ OrderItem)** — One truck delivery from a factory to a client. Items = products on the truck (all must belong to the order's single factory). Carries denormalized saleTotal/costTotal recomputed server-side, transport block, and snapshots (agentId, driverName, per-item prices).
  - Fields: orderNo (from PG sequence, 'ORD-000001'); date, dueDate (= date + client.paymentTermDays); status; clientId, factoryId, vehicleId, agentId (snapshot); saleTotal, costTotal, costStatus; transportMode, transportCost, transportCharge, transportPaidStatus, transportPaidAt; cancelReason, cancelledAt, completedAt, costFinalizedAt; items[]: quantityM3 (3dp), palletCount, palletPrice, listPricePerM3, salePricePerM3 (6dp), saleTotal, pricePending, provisionalPriceKind, costPricePerM3, finalCostPricePerM3, costTotal
  - States: NEW | CONFIRMED | LOADING (vehicle required from here) | DELIVERING | DELIVERED | COMPLETED (bonus accrues) | CANCELLED (soft-cancel only) | costStatus: PROVISIONAL → PARTIAL → FINAL | transportPaidStatus: NOT_APPLICABLE | UNKNOWN | UNPAID | PAID | PAID_BY_CLIENT
- **Client (+ ClientAlias, ClientPrice)** — Buyer. Belongs to an agent and region. Aliases absorb workbook spelling variants on import; ClientPrice is a versioned per-client special sale price that overrides the product price book.
  - Fields: name (unique); agentId; regionId; creditLimit (null=unlimited, 0=prepay-only); paymentTermDays; legalEntity; active; aliases[].name; prices[]: productId, pricePerM3, effectiveFrom
  - States: active/inactive
- **Agent** — Field salesperson; pure attribution/grouping (holds no money). Orders/payments snapshot his id so KPIs stay historical. Carries a debt limit gating new orders.
  - Fields: name; sortNo (display only); debtLimit (null→AppSetting default, 0→new orders blocked); active; linked User logins
  - States: active/inactive
- **Factory (+ BonusProgram)** — Block supplier. Factory ledger balance >0 = dealer's prepaid advance, <0 = dealer owes. BonusProgram rows are insert-only versions: NONE | PER_M3 (UZS/m³) | PERCENT (of blocks-only purchase amount).
  - Fields: name; active; bonusPrograms[]: kind, ratePerM3, percent, effectiveFrom (never updated, only new rows)
  - States: active/inactive | program kind: NONE | PER_M3 | PERCENT
- **Product (+ ProductPrice)** — Block size catalog per factory. Cube math anchor: m3PerPallet (1.728 for 600x300x200, 1.8 for ×250). Three-price versioned book: FACTORY_CASH / FACTORY_BANK / DEALER_SALE, resolved by latest effectiveFrom ≤ order date.
  - Fields: factoryId; name, size; m3PerPallet, blocksPerPallet; prices[]: kind, pricePerM3 (6dp), effectiveFrom
  - States: active/inactive | price kinds: FACTORY_CASH | FACTORY_BANK | DEALER_SALE
- **Vehicle** — Truck/driver. Vehicle ledger balance <0 = dealer owes driver for transport. capacityPallets caps order size.
  - Fields: name; plate (unique); driver, phone; capacityPallets (default 19)
  - States: active/inactive
- **Payment** — Any money movement with a party. Six kinds; posts ledger entries and (except TRANSPORT_DIRECT / BONUS) exactly one kassa row. Never deleted — voided with compensating rows.
  - Fields: kind, method; amount (always UZS, server-computed for USD), usdAmount, rate, denominations(Json); clientId/factoryId/vehicleId (kind-matrix enforced + SQL CHECK); agentId (snapshot); payerEntityId/receiverEntityId/payerName/receiverName; cashboxId; idempotencyKey (unique); voidedAt/voidReason/voidedBy; reconciled (false = imported from client sheets, absent in Оплата ledger — needs owner sign-off)
  - States: active | voided | kinds: CLIENT_IN | CLIENT_REFUND | FACTORY_OUT | FACTORY_REFUND | VEHICLE_OUT | TRANSPORT_DIRECT | methods: CASH | BANK | CLICK | TERMINAL | CARD | USD | BONUS (bonus module only)
- **PaymentAllocation** — The ONLY payment↔order link. CLIENT_IN allocations settle client debt per order (aging); FACTORY_OUT allocations finalize order cost (priceKind from payment method); VEHICLE_OUT/TRANSPORT_DIRECT allocations settle the truck's transport. Σ active allocations ≤ payment amount; one active row per (payment, order).
  - Fields: paymentId, orderId, amount; priceKind (FACTORY_OUT only: FACTORY_CASH if method CASH/CARD/USD, else FACTORY_BANK); voidedAt
  - States: active | voided
- **LedgerEntry** — Immutable single source of truth for all party balances. Signed postings: >0 = asset for dealer (client owes us / our advance at factory), <0 = dealer's liability. Balance(party) = Σ amount. Corrections only via reverse() rows carrying the ORIGINAL business date.
  - Fields: account (CLIENT|FACTORY|VEHICLE); source (ORDER_SALE, ORDER_COST, COST_ADJUSTMENT, TRANSPORT_CLIENT_DIRECT, TRANSPORT_COST, legacy TRANSPORT_CHARGE, PAYMENT, PAYMENT_VOID, ORDER_CANCEL, PALLET_CHARGE, PALLET_RETURN_CREDIT, BONUS_OFFSET, ADJUSTMENT, IMPORT); amount (signed Decimal 18,2, never 0); date (business) vs at (recorded); clientId/factoryId/vehicleId (exactly one, matching account — SQL CHECK); orderId, paymentId, palletTransactionId; reversalOfId (unique)
  - States: posted | reversed (has reversedBy)
- **PalletTransaction** — In-kind pallet ledger (counts, not money). Client balance = Σ DELIVERED_TO_CLIENT − RETURNED_BY_CLIENT − CHARGED_LOST + signed ADJUSTMENT/REVERSAL; factory balance = RECEIVED_FROM_FACTORY − RETURNED_TO_FACTORY ± signed rows. CHARGED_LOST and RETURNED_TO_FACTORY each post exactly one linked money LedgerEntry.
  - Fields: type, qty (positive for directional types, signed for ADJUSTMENT/REVERSAL); clientId/factoryId/orderId; unitPrice (default 130,000 UZS for charge-lost / factory-return); reversalOfId
  - States: types: RECEIVED_FROM_FACTORY | DELIVERED_TO_CLIENT | RETURNED_BY_CLIENT | RETURNED_TO_FACTORY | CHARGED_LOST | ADJUSTMENT | REVERSAL
- **BonusTransaction** — Per-factory bonus wallet ledger. Wallet balance = Σ signed amounts. ACCRUAL on order COMPLETED (base recorded in baseAmount/baseM3), spends via WITHDRAWAL (cash IN to a UZS kassa) or DEBT_OFFSET (canonical chain: Payment(FACTORY_OUT, method=BONUS, no cashbox) → LedgerEntry(BONUS_OFFSET) → BonusTransaction).
  - Fields: factoryId, type, amount (signed); orderId, programId, paymentId (DEBT_OFFSET); baseAmount (PERCENT base = blocks-only cost), baseM3 (PER_M3 base); reversalOfId
  - States: types: ACCRUAL | WITHDRAWAL | DEBT_OFFSET | ADJUSTMENT | REVERSAL
- **Cashbox + CashTransaction** — Treasury. Each box is single-currency, optionally tied to a LegalEntity. Balance = Σ IN − Σ OUT (no cross-currency math; USD boxes store USD amounts). Every payment/expense/bonus-withdrawal mirrors into exactly one row; manual rows and reversals are explicit.
  - Fields: name, type (CASH|BANK|CLICK|TERMINAL|CARD), currency (UZS|USD), entityId, active; tx: direction (IN|OUT), amount (>0, box currency), rate, source, paymentId/expenseId/bonusTransactionId, reversalOfId
  - States: source: MANUAL | PAYMENT | EXPENSE | BONUS_WITHDRAWAL | REVERSAL
- **Expense (+ ExpenseCategory)** — Categorized cash outflow; creates a kassa OUT row atomically; voided (not deleted) with compensating kassa row.
  - Fields: date, categoryId, amount, cashboxId, note; voidedAt/voidReason
  - States: active | voided
- **LegalEntity** — Payer/receiver firms: the owner's own entities (Септем Алока, Септем семент), factory firms, and third-party payer firms clients pay through. Payments tag payer/receiver entity.
  - Fields: name, kind, inn; active
  - States: kind: DEALER | FACTORY | THIRD_PARTY
- **User + AuditLog + OrderStatusHistory** — Auth (JWT with tokenVersion invalidation) and full audit trail: every financial mutation logs before/after JSON with actor; every status change is a history row with from/to/by/note.
  - Fields: user: username, role, agentId, active, tokenVersion; audit: action, entity, entityId, before, after, ip, userId, at
  - States: roles: ADMIN | ACCOUNTANT | AGENT | CASHIER | audit actions: CREATE UPDATE DELETE VOID STATUS_CHANGE COST_FINALIZE LOGIN LOGIN_FAILED IMPORT EXPORT
- **AppSetting** — Runtime knobs: agentDebtLimitDefault (null=unlimited), truckCapacityPallets (19), saleMarginMinPct, palletPriceDefault (130,000).
  - Fields: key; value (Json); updatedBy
- **ImportBatch** — One workbook import run; every created order/payment/ledger/pallet/kassa row links back to it. stats JSON carries reconciliation data: per-client expected-vs-actual, factory balance check (target 973,619,270), unmatched driver payments/trucks, unreconciled payments total (~95.8M flagged reconciled=false).
  - Fields: filename; stats (expected balances, unmatched lists, cashboxBalances); createdBy

### Workflows

- **Create order (one truck)** (AGENT, ADMIN, ACCOUNTANT; many times/day (≈2-4 trucks/day in workbook data))
  1. Open /orders/new (full-page form)
  1. Pick client (searchable select; credit-risk warning computed live from balance + limit)
  1. Add items: product (grouped by factory), pallet count and/or explicit m³ (m³ defaults to pallets × m3PerPallet), pricing mode: catalog price / negotiated per-m³ / lump sum / price-pending (ADMIN/ACCOUNTANT only)
  1. Choose transport mode (client's own / dealer pays driver / client pays driver — [TRANSPORT MODEL — AUTHORITATIVE](#transport-authoritative)) + transport cost (inside saleTotal), vehicle, driver, intended factory payment method (CASH→cash price, else bank price for provisional cost)
  1. Server (single transaction): validates positive amounts, single-factory items, AGENT price floor (≥ factory bank price), truck pallet capacity, then row-locks client+agent and checks client credit limit (balance + clientChargeable(order) ≤ limit) and agent debt limit
  1. Server posts ledger: ORDER_SALE (+client), TRANSPORT_CLIENT_DIRECT (−client, CLIENT_PAYS_DRIVER carve-out), ORDER_COST (−factory, blocks+pallets), TRANSPORT_COST (−vehicle, DEALER_ABSORBED + vehicle set); records pallet movements (RECEIVED_FROM_FACTORY + DELIVERED_TO_CLIENT); writes status history + audit log
  1. Client debt exists IMMEDIATELY (status NEW)
- **Move order through lifecycle** (AGENT (forward only), ADMIN, ACCOUNTANT; many times/day)
  1. From order detail: primary button advances one step (NEW→CONFIRMED→LOADING→DELIVERING→DELIVERED→COMPLETED)
  1. AGENT may only go +1 forward; ADMIN/ACCOUNTANT may jump forward or step exactly one back
  1. LOADING and beyond blocked without a vehicle
  1. Entering COMPLETED sets completedAt and accrues factory bonus under the program in force at that moment; leaving COMPLETED reverses the accrual
  1. Every transition row-locked, recorded in OrderStatusHistory + audit
- **Receive client payment and allocate** (CASHIER, AGENT (own clients, CLIENT_IN only, no allocations), ADMIN, ACCOUNTANT (allocations); many times/day)
  1. Payments page → 'Yangi to'lov' modal: kind CLIENT_IN, method, date, client, cashbox (filtered to method currency, shows balance), amount (USD: usdAmount × rate computed server-side)
  1. Idempotency key generated per modal open blocks double-submit
  1. Server posts −amount on client ledger + kassa IN row in one transaction
  1. ADMIN/ACCOUNTANT may add inline allocations (order + amount rows) or later via payment drawer → POST /payments/:id/allocations; Σ allocations ≤ payment; order must belong to the client and not be cancelled
  1. Order detail shows allocation progress bar (allocated / saleTotal)
- **Pay factory and finalize order costs (owner-locked)** (ADMIN, ACCOUNTANT; daily to weekly (factory paid in large tranches))
  1. Create FACTORY_OUT payment (method decides cost basis: CASH/CARD/USD → FACTORY_CASH price, BANK/CLICK/TERMINAL → FACTORY_BANK price); kassa OUT row checked against box balance (never below zero, row-locked)
  1. ADMIN/ACCOUNTANT allocates the payment to specific orders
  1. Cost engine per order: covered = Σ active FACTORY_OUT allocations; covered=0 → PROVISIONAL, 0<covered<provisionalTotal → PARTIAL, covered ≥ provisionalTotal → FINAL at the price kind of the LATEST active allocation, price row resolved at the ORDER's business date
  1. Provisional→final delta posts as COST_ADJUSTMENT ledger entry (immutable trail); items get finalCostPricePerM3
  1. A completed order's PERCENT bonus is re-derived as a traceable BonusTransaction ADJUSTMENT
  1. Voiding the payment or allocation un-finalizes symmetrically (compensating entries, cost restored)
- **Settle transport** (ADMIN, ACCOUNTANT, CASHIER (VEHICLE_OUT without allocation); many times/week (one per truck))
  1. Dealer pays driver: VEHICLE_OUT payment (+vehicle ledger, kassa OUT), allocate to the truck's order(s)
  1. OR client pays driver directly («шопр учун барди»): TRANSPORT_DIRECT payment — posts BOTH −amount on client ledger AND +amount on vehicle ledger, NO kassa row (cashboxId forbidden)
  1. transportPaidStatus is DERIVED: Σ surviving transport allocations ≥ transportCost → PAID (latest VEHICLE_OUT) or PAID_BY_CLIENT (latest TRANSPORT_DIRECT); partial coverage stays UNPAID; imported UNKNOWN preserved until evidence exists
- **Pallet management** (ADMIN, ACCOUNTANT (mutations), AGENT (view own); weekly)
  1. Delivery auto-records pallet movements with the order
  1. Client returns pallets → 'client-return' modal (count, date, optional order) — reduces in-kind counter, no money
  1. Dealer returns pallets to factory → 'factory-return' (count + unit price, default 130k) — posts PALLET_RETURN_CREDIT (+factory ledger)
  1. Client lost pallets → 'charge-lost' (count + unit price) — posts PALLET_CHARGE (+client ledger, becomes money debt)
  1. Balances page: per-client pallet counts (agents see own clients), factory accountability table for ADMIN/ACCOUNTANT
- **Factory bonus wallet** (ADMIN, ACCOUNTANT; monthly / rare)
  1. ADMIN/ACCOUNTANT sets/updates a factory's bonus program (insert-only new version with effectiveFrom)
  1. Order COMPLETED → automatic ACCRUAL into the wallet (PER_M3: rate × m³; PERCENT: % of blocks-only purchase amount at best-known cost)
  1. Spend option A — withdraw: cash enters a UZS cashbox (source BONUS_WITHDRAWAL), wallet balance checked under a per-factory row lock
  1. Spend option B — offset: Payment(FACTORY_OUT, method BONUS, no cashbox) → LedgerEntry(BONUS_OFFSET, reduces debt to that same factory) → BonusTransaction(DEBT_OFFSET)
  1. Mistaken withdrawal reversed with compensating wallet + kassa rows; voiding a bonus-offset payment restores the wallet
- **Cancel order (soft-cancel)** (ADMIN, ACCOUNTANT; rare)
  1. Order detail → 'Bekor qilish' → reason required (modal)
  1. Status → CANCELLED, cancelReason/cancelledAt stored, status history row
  1. All the order's ledger entries reversed with compensating rows (original business date)
  1. Pallet delivery movements reversed (returns/charges untouched); bonus accrual reversed if any
  1. Active payment allocations voided AND fully refunded (owner rule 2026-07-22): the client gets a CLIENT_REFUND for what they paid (cash OUT, balance → 0) and the factory a FACTORY_REFUND for what we paid it (advance removed, cash back) — no money stays behind
- **Void payment / expense / kassa reversal** (ADMIN, ACCOUNTANT; rare)
  1. Payment void (reason required): every ledger posting compensated, kassa rows mirrored with opposite direction (source REVERSAL), allocations voided, FACTORY_OUT orders' costs re-derived, transport status re-derived, bonus-offset money returned to wallet
  1. Expense void: compensating kassa row
  1. Manual kassa reversal (ADMIN/ACCOUNTANT): only MANUAL-source rows, compensating row, OUT reversals balance-checked
- **Late pricing of a pending item** (ADMIN, ACCOUNTANT; rare)
  1. Item shipped with pricePending=true (goods sometimes ship before price agreed — Шиддат case)
  1. ADMIN/ACCOUNTANT opens order detail → item 'Narxlash' modal → per-m³ price OR negotiated lump sum (stored exactly, unit price back-solved to 6dp)
  1. ORDER_SALE ledger entry posted dated to the order's business date — debt recognition happens late but at creation-date per the locked rule
- **Debt monitoring & statements** (ADMIN, ACCOUNTANT, AGENT (own clients only); daily)
  1. Debts page: summary KPIs (clientsOweUs, weOweClients, factoryAdvance, weOweFactories, weOweVehicles, palletsAtClients) + per-client rows with pallet balance, overdue flags (dueDate < now), expected collections over a ?days window
  1. Party statement: running ledger history with opening/closing balance over a date window (client statements agent-scoped)
  1. |balance| < 1 UZS shown as settled (workbook float-residue rule)
- **Treasury / expenses day-to-day** (CASHIER, ADMIN, ACCOUNTANT; many times/day)
  1. Kassa page: box balances (Σ IN − Σ OUT per box, USD boxes in USD), transaction log with filters, manual IN/OUT modal (OUT balance-checked)
  1. Expense modal: category, amount, cashbox, date — atomic kassa OUT
  1. Cashier dashboard variant shows kassa KPIs only
- **Excel import + reconciliation sign-off** (ADMIN; rare (one-time migration + occasional re-import))
  1. ADMIN uploads the 21-sheet workbook
  1. Importer creates canonical clients via alias map, orders (unpriced trucks → pricePending), payments (client sheets WIN over the Оплата ledger; the ~95.8M gap imported as reconciled=false), TRANSPORT_DIRECT rows for «шопр учун барди», vehicle debts+payments for trucks marked «Туланди», real ledger + kassa postings
  1. Reconciliation endpoint compares expected (workbook) vs actual (ledger) per client and for the factory (target: 973,619,270 with pallets; фарк values reproduced and explained)
  1. Owner reviews unreconciled payments and unmatched truck lists; sets opening cashbox balances afterwards
- **Catalog & price book maintenance** (ADMIN, ACCOUNTANT; weekly / on factory price changes)
  1. Products page: create/edit products, append versioned price rows for the three kinds (effectiveFrom-driven; e.g. purchase 500k→625k on 2026-07-01)
  1. Client detail: append per-client special DEALER_SALE prices
  1. Procurement matrix: landed cost per m³ comparison per region (factory price + truck cost / capacity), cheapest source highlighted — analytical only, never posts money

### Roles

- **ADMIN**: Everything: all modules, user management, system settings (debt-limit default, truck capacity, margin floor), Excel import/batches/delete-batch, order edit/cancel, payment void/allocations, bonus and pallet mutations, kassa reversals. Only role that manages Users and Settings and runs Import.
- **ACCOUNTANT**: Full financial control minus admin: order create/edit/cancel/status (incl. backward steps and price-pending pricing), payment create/void/allocations (cost finalization), bonus programs/withdraw/offset, pallet mutations, expenses + categories, kassa incl. reversals, debts/statements/reports/exports, catalogs (factories, products+prices, vehicles, agents, regions, legal entities), procurement. No Users/Settings/Import.
- **AGENT**: Row-scoped to own agentId everywhere (enforced in services via agentScope/assertOwnAgent, plus route guards in UI): sees/creates orders and clients of own book only; may advance own orders one step forward only; sale price floored at factory bank price; payments limited to CLIENT_IN for own clients, cannot allocate; sees own clients' debts, pallet balances and statements; dashboard scoped to own KPIs. No factory/vehicle finances, no kassa, no expenses, no reports.
- **CASHIER**: Treasury only: payments list/create (any kind except allocations), kassa view + manual transactions (no reversals), expenses create/view, legal entities view, cashier dashboard (box balances). No orders, clients, debts, reports, catalogs.

### Current UI

Pages: Login, Dashboard (/): role-aware KPI Statistics + Recharts trends + agent ranking; cashier variant shows kassa boxes, Orders (/orders): status Tabs + search/client/factory/date filters + server-paginated Table, NewOrder (/orders/new): full-page creation form with dynamic items, live totals, credit-risk & capacity alerts, OrderDetail (/orders/:id): Steps lifecycle, advance/cancel actions, Descriptions cards (info, Moliya, Transport), items table with late-pricing modal, Tabs: allocations w/ Progress, pallet movements, Timeline, comments, Clients + ClientDetail (statement, special prices, aliases), Agents + AgentDetail, Factories + FactoryDetail (balance, bonus program, payments), Products (versioned 3-kind price book), Vehicles, Regions, LegalEntities, Procurement (landed-cost matrix per region), Payments (/payments): filterable register + detail Drawer (allocations, void) + CreatePaymentModal with inline allocation rows, Debts (/debts): summary KPIs + per-client debt/pallet/overdue table + statement access, Pallets (/pallets): client/factory balance tables + movement log + 3 action modals (client return / factory return / charge lost), Bonus (/bonus): per-factory wallets + transaction log + withdraw/offset modals, Expenses: register + create modal + categories, Kassa: box summary cards/table + transaction log + manual op modal + reversal, Reports: svod + orders register with .xlsx export endpoints, Import: workbook upload + batch stats + reconciliation view, Users (ADMIN), Settings (ADMIN): AppSettings editor, Profile

Ant Design (v6.5, v5-compatible subset) single-page app, all copy inline Uzbek (Latin). Shell: fixed dark left Sider (232px, collapsible) with role-filtered flat menu plus two submenu groups ('Katalog' and 'Boshqaruv'); slim 52px header with a 'Ctrl+K — tez qidiruv' hint, dark/light theme Switch, and user avatar dropdown (Profile/Logout); content area padded 20px; print CSS hides shell (no-print). Ctrl+K opens a CommandPalette for navigation. List pages follow one pattern: Typography.Title + primary action button on top, then a Card containing status Tabs (Orders), a wrap Space of filters (Input.Search, showSearch Selects capped at ~200 options, RangePicker), and a server-paginated antd Table (pageSize changer, 'Jami: N ta' total, horizontal scroll x:1200, fixed first column, right-aligned Money cells, colored StatusTag chips for order/cost/transport states). Errors render Alert-with-retry instead of the table. Detail pages are vertical stacks of Cards; OrderDetail is the richest: header Card with back button, orderNo, status tag, advance button (next step) and danger cancel button, plus a Steps strip of the 6-stage lifecycle (or a red cancelled Alert with reason); then Descriptions cards, an items Table, side-by-side Moliya (sale/cost/goods profit + cost-status tag) and Transport (mode, cost, charge, transport profit, paid tag) cards, and a Tabs card (To'lovlar with allocation Progress bar, Paddonlar, Tarix timeline, Izohlar with comment composer). Creation flows: NewOrder is a full page Form (client select with server search, dynamic item rows with pricing-mode radio, transport radio + conditional money inputs, InputNumber with thousands-space formatter, live footer calc: pallets/m³/sale/credit-risk/capacity alerts); everything else uses Modals (payments 720px modal with kind/method/party/cashbox-with-balance selects, USD amount×rate preview, inline allocation rows; pallets/bonus/kassa/expenses smaller modals; payment detail and void live in a right Drawer). Mutations show App.message toasts and invalidate query roots; a WebSocket pushes change events that invalidate queries app-wide (realtime multi-user freshness). Dark and light themes both supported via ThemeContext + antd tokens.

### Pain points

- [high] Allocation UX is the weakest link of the money flow: in the payment modal ADMIN/ACCOUNTANT must hand-pick each order and hand-type each amount, with no view of an order's remaining unpaid balance, no FIFO/auto-distribute button, and the order dropdown is a raw 100-row fetch filtered client-side (VEHICLE_OUT even filters vehicle client-side because the endpoint lacks the filter). Since costs finalize and aging depends on allocations, this is high-frequency, error-prone typing.
  - Suggestion: Redesign as a settlement screen: after entering amount+party, show that party's open orders with outstanding amounts, checkboxes and an auto-allocate (oldest-first) action; show live remaining-to-allocate; server-side party+open filter.
- [high] CASHIER and AGENT record payments but cannot allocate, and nothing surfaces the resulting backlog — there is no 'unallocated payments' worklist or badge, so an accountant must manually hunt payments whose allocations are empty before order costs finalize or client aging is meaningful.
  - Suggestion: Add an allocation inbox (payments with unallocated remainder > 0, ordered by date) as a first-class screen or Dashboard tile with one-click allocate.
- [medium] The credit picture during order entry is thin: the credit-risk Alert appears only after amounts are typed, uses the client list row's balance (may be stale relative to the row-locked server check), and shows no pallet balance, overdue orders, or payment history — the agent discovers a block only on submit error.
  - Suggestion: Client picker with an inline credit card: current balance, limit, headroom, pallets held, overdue flag; pre-validate exposure server-side as the form changes.
- [medium] Versioned price maintenance is per-product and modal-driven: a factory-wide price change (the real 500k→625k event) requires opening every product and appending three price-kind rows one by one; there is no effective-dated bulk price update or price history timeline view.
  - Suggestion: A price-book screen per factory: grid of products × 3 kinds with an 'apply new prices effective from…' bulk action and a visible version history.
- [medium] The three-sided + pallet 'Свод' view the owner lives in doesn't exist as one screen: Debts covers client rows well, but factory advance/debt, vehicle debts, bonus wallets and factory pallet accountability are scattered across Factories detail, Bonus and Pallets pages — reproducing the workbook's one-glance summary takes 4+ page visits.
  - Suggestion: One consolidated balances dashboard: clients (money + pallets + overdue), factories (money incl. pallet credit + bonus wallet), vehicles — each row linking to its statement.
- [medium] No printable per-order invoice or per-client statement document: print CSS exists and xlsx export covers only two reports (svod, orders register); the paper artifacts a dealer hands to clients/factory (invoice, act of reconciliation) are missing, so users go back to Excel.
  - Suggestion: Print/PDF templates for order invoice and party statement (opening balance, movements, closing balance) directly from the detail pages.
- [medium] UI is Uzbek-only inline text while the source workbook, entity names and much of the staff's vocabulary are Russian (Свод, паддон, Оплата); no i18n framework, so RU/UZ switching (an owner requirement) needs a full string extraction later — and terminology drifts (Paddon vs Поддон, 'Ta'minot matritsasi' vs 'Tannarx').
  - Suggestion: Extract strings to i18next with RU+UZ dictionaries during the redesign; fix one glossary for financial terms.
- [medium] List pages lack aggregate footers and bulk context the workbook's SUBTOTAL row provided: filtering orders by client/date shows rows but not Σ m³ / Σ sale / Σ pallets of the filtered set; payments register similarly has no period totals.
  - Suggestion: Table summary rows fed by a server aggregate for the current filter, plus quick period presets (today, week, month).
- [low] OrderDetail is a long vertical scroll (header, info, items, two money cards, tabs) with key states far apart — costStatus appears twice, transport in a third place, and the late-pricing action hides inside the items table; on cancel/void everything is reachable only through the tabs' history.
  - Suggestion: Two-column detail with a sticky financial summary sidebar (sale/cost/profit/transport/pallets/status) and actions grouped in one toolbar.
- [low] Mutation feedback invalidates up to 9 query roots per save (payments modal) on top of WebSocket invalidation — table flicker and redundant refetch storms on slow links; some selects refetch the whole 200-row client list per keystroke of search.
  - Suggestion: Targeted invalidation keys, debounced select search, and cache sharing between the many ad-hoc client/factory/vehicle pickers (one reusable PartySelect).
- [medium] Pallet actions (client return / factory return / charge lost) are three separate modals that don't show the counterparty's current pallet balance inside the modal, so charging 5 lost pallets to a client holding 3 is possible input; there is also no pallet aging (how long a client has held them).
  - Suggestion: Launch actions from the balance row with the current count pre-displayed and validated; add days-held column.
- [medium] Reconciliation of imported data (reconciled=false payments, unmatched trucks) is only visible inside Import batch stats — a finance user reviewing a client's statement gets no marker that some of its history is unconfirmed workbook data awaiting owner sign-off.
  - Suggestion: Surface reconciled=false as a badge on payment rows and statements with a filterable review queue and an 'approve' action.
- [low] Two orphaned backlog items acknowledged by the team: deep accessibility pass not done (modal-heavy flows, custom money inputs), and antd v6.5 is used through a v5-compatible subset (deprecation risk).
  - Suggestion: Address during redesign: keyboard-first forms, focus management in modals, and commit to the v6 API.

### LOCKED RULES

- DEBT AT ORDER CREATION — Rule: the client's debt — `clientChargeable(order)`, i.e. saleTotal minus the CLIENT_PAYS_DRIVER transport carve-out ([TRANSPORT MODEL — AUTHORITATIVE](#transport-authoritative)) — is posted to the immutable ledger the moment the order is created, at status NEW; every non-CANCELLED order counts in balances. Encoded as ORDER_SALE (+saleTotal) plus TRANSPORT_CLIENT_DIRECT (−transportCost) LedgerEntry rows inside the create transaction (orders.service.ts postOrderLedger). Why: owner's explicit choice (2026-07-09, re-confirmed 2026-07-11) — deposits net correctly instead of showing phantom advances, and it matches the workbook where a shipment row hits the client account immediately. UI: client balances must visibly change on order save (not delivery); order forms must show projected balance/limit headroom pre-save; status labels must NOT imply 'affects finance only when delivered' (docs 05/06 v2 text saying DELIVERED-only is stale and must not be copied).
- CLIENT CREDIT LIMIT ENFORCED — Rule: order create AND edit reject when currentLedgerBalance + clientChargeable(order) > client.creditLimit ([TRANSPORT MODEL — AUTHORITATIVE](#transport-authoritative)); creditLimit null = unlimited, 0 = prepay-only; the check runs after a SELECT … FOR UPDATE row lock on the client so concurrent orders cannot both pass. Why: v2 stored the limit but never checked it (audit critical finding); owner locked enforcement. UI: show limit, current balance and headroom in the client picker; surface the server error verbatim (it includes limit/current/new figures); admin edit of creditLimit is a privileged action (ADMIN/ACCOUNTANT/own-agent scoping).
- AGENT DEBT LIMIT — Rule: before creating an order, the agent's outstanding debt = Σ of ONLY the positive balances of his clients (prepayments never offset other clients' debts, computed via SQL HAVING SUM>0) must be < Agent.debtLimit (null falls back to AppSetting agentDebtLimitDefault, itself null=unlimited; 0 blocks all new orders). Why: caps the credit an agent can extend across his whole book. UI: agent dashboard/detail should show outstanding vs limit; order form should warn the agent before submit when near the cap.
- SOFT-CANCEL ONLY, WITH REASON — Rule: DELETE /orders/:id performs cancel(reason): status→CANCELLED + cancelReason/cancelledAt, compensating reversals of ALL the order's ledger entries (posted at the ORIGINAL business date), pallet delivery movements and any bonus accrual. MONEY UNWIND — TWO MODES (owner rule, 2026-07-22 evening, supersedes both earlier rules that day). In BOTH the kassa returns to its pre-order state (client money out, factory money back). `REFUND` (default) hands the client's own payment back as cash and leaves the driver-paid transport as a credit on their balance; `VOID_ALL` voids every payment tied to the order — client, driver, kassa and factory alike — so the balance lands on 0 and nothing survives. Allocations are then voided. A cancelled order cannot be edited, allocated to, or priced. Why: financial history is immutable; v2's hard delete destroyed history and orphaned cash. UI: 'delete' must be presented as cancellation with a mandatory reason field; cancelled orders stay visible (red banner + reason); client statements show the cancel reversals + refunds netting to zero.
- IMMUTABLE LEDGER / REVERSAL-ONLY CORRECTIONS — Rule: no financial row (LedgerEntry, CashTransaction, Payment, Expense, PalletTransaction, BonusTransaction) is ever hard-deleted or amount-edited; corrections are compensating rows linked via reversalOfId (idempotent — one reversal per row), voids are timestamped with reason and actor; party balances are ALWAYS live sums over LedgerEntry (no stored balance fields, no Debt table). Reversals keep the original business date so date-windowed statements net to zero. Why: audit integrity; the workbook's untraceable edits produced the 95.8M фарк. UI: every list must distinguish voided/reversed rows (default-hidden with a toggle); every void/cancel/reverse action requires a reason; statements show reversal pairs.
- ORDER EDIT FREEZE — Rule: PUT /orders/:id is ADMIN/ACCOUNTANT only, allowed only in status NEW or CONFIRMED and only while costStatus=PROVISIONAL ('Narx allokatsiya bilan qotirilgan' otherwise); an edit reverses all postings and pallet movements, re-checks the credit limit against the new exposure, reposts everything, and preserves derived transport settlement; intendedPaymentMethod (provisional price kind) is not editable after creation. Why: prevents retroactive mutation of recognized debt (v2 critical finding). UI: hide/disable Edit beyond CONFIRMED or once any factory allocation exists; explain why editing is locked.
- STATUS MACHINE WITH ROLE-GATED TRANSITIONS — Rule: linear flow NEW→CONFIRMED→LOADING→DELIVERING→DELIVERED→COMPLETED; AGENT may move only exactly +1 forward; ADMIN/ACCOUNTANT may jump forward or step exactly one back; vehicle mandatory from LOADING onward; CANCELLED reachable only via the cancel endpoint; transitions are row-locked (two racing COMPLETED cannot double-accrue bonus); entering COMPLETED sets completedAt + accrues bonus, leaving COMPLETED reverses it; every change is written to OrderStatusHistory with actor and note. Why: v2 allowed arbitrary status jumps that silently rewrote recognized debt. UI: show the flow as steps; expose only the legal next action per role; backward moves are privileged and should ask for a note.
- PALLETS IN-KIND — Rule: clients owe pallet COUNT, never pallet money: saleTotal never includes pallets; client pallet balance = Σ delivered − Σ returned − Σ charged-lost ± signed adjustments. Money appears only via two explicit flows, each posting exactly one linked LedgerEntry: CHARGED_LOST (client is charged qty × unitPrice, default 130,000 UZS — converts in-kind debt to money debt) and RETURNED_TO_FACTORY (factory credits dealer qty × unitPrice, growing the dealer's advance). The dealer's own pallet cost IS money: order costTotal = blocks + palletCount × palletPrice, so the factory balance includes pallet money (workbook's Завод Остаток 'с паддон' = B4 view). Order cancel reverses only that order's delivery movements — physical returns and charges survive. Why: exact workbook economics (Поддон subsystem) confirmed by owner 2026-07-11. UI: pallet counters must appear next to money balances on client rows/statements; charge-lost and returns are deliberate privileged actions with visible unit price; factory balance breakdown should note the pallet component.
- COST FIXED AT FACTORY-PAYMENT ALLOCATION (not at order creation) — Rule: at creation each item is costed PROVISIONALLY at the intended-method price (dto.intendedPaymentMethod CASH→FACTORY_CASH else FACTORY_BANK price row effective at the ORDER date). Real cost is decided by allocating FACTORY_OUT payments: covered = Σ active allocations; 0 → PROVISIONAL, partial → PARTIAL (no repricing), covered ≥ provisional total → FINAL at the price kind of the LATEST active allocation (payment method CASH/CARD/USD → cash price; BANK/CLICK/TERMINAL → bank price), price row still resolved at the order's business date — the allocation only picks WHICH kind applies. The provisional→final delta posts as a COST_ADJUSTMENT ledger entry; voiding allocations un-finalizes symmetrically; PERCENT bonuses are re-derived via BonusTransaction ADJUSTMENT. Why: the owner explicitly picked this over lock-at-creation (2026-07-11) because the factory charges different cash vs bank prices and the dealer decides how to pay later; factory debt legitimately fluctuates until allocation. UI: costStatus chip (PROVISIONAL/PARTIAL/FINAL) must be visible on order lists and detail; profit figures must be labeled provisional until FINAL; the allocation flow must show which price basis it will apply.
- VERSIONED FACTORY BONUS, NEVER RETROACTIVE — Rule: BonusProgram rows are insert-only versions per factory (kind NONE | PER_M3 ratePerM3 | PERCENT of the blocks-only purchase amount — pallet money is excluded from the base); the program with the latest effectiveFrom ≤ order.completedAt governs that order's accrual forever; accrual happens automatically when the order reaches COMPLETED (idempotent; reversed if un-completed/cancelled); accrual records its base (baseAmount/baseM3) for audit. Wallet = Σ signed BonusTransaction rows, may never go negative (row-locked balance checks). Spends: WITHDRAWAL — factory pays the bonus out in cash, money ENTERS a UZS cashbox (source BONUS_WITHDRAWAL); or DEBT_OFFSET — canonical chain Payment(kind=FACTORY_OUT, method=BONUS, cashboxId null) → LedgerEntry(source=BONUS_OFFSET, +factory) → BonusTransaction(DEBT_OFFSET), reducing debt to that SAME factory only. Every accrual/withdrawal/offset/adjustment is audit-logged. Why: verbatim owner spec 2026-07-11; retroactive recalcs would rewrite settled periods. UI: bonus program editor must create new versions (never edit in place) and show version history; wallet page shows balance + full transaction trail with links to orders/payments; offset must be constrained to the same factory.
- TRANSPORT IS ALWAYS INSIDE THE SALE TOTAL — Rule: defined once and in full in [TRANSPORT MODEL — AUTHORITATIVE](#transport-authoritative); do not restate the arithmetic here. In one line: `saleTotal` already contains `transportCost`, so what the client owes the dealer is `clientChargeable(order) = saleTotal − clientDirectTransport(order)` — for a 22 000 000 order with 2 000 000 transport under CLIENT_PAYS_DRIVER that is 20 000 000 from the moment of creation, with the dealer owing the driver 0. The pre-2026-07-20 "3 modes + transport billed on top + transport profit = charge − cost" rule that used to sit here is DEAD, and DEALER_CHARGED is DEPRECATED (rejected on write; historical rows only). Why: the owner's core complaint was the same money reading as different amounts on different screens. UI: the order form has one transport-cost field and shows the split, never a second "charge on top" field; reports label which profit definition they use.
- CLIENT-PAYS-DRIVER («шопр учун барди») — Rule: on a CLIENT_PAYS_DRIVER order the carve-out is posted AT ORDER CREATION (CLIENT / TRANSPORT_CLIENT_DIRECT, −transportCost), not when a payment is entered. PaymentKind TRANSPORT_DIRECT therefore posts NO ledger rows and NO kassa row (cashboxId rejected); it is a RECORD that the driver got his cash, requires ≥1 order allocation with every allocated order in CLIENT_PAYS_DRIVER mode, is reconciled=true by definition, and only flips transport status to PAID_BY_CLIENT. It must NEVER be counted as a debt-settling allocation (`CLIENT_SETTLING_KINDS = [CLIENT_IN]`) — doing so double-deducts the client to 18 000 000. Why: real workbook flow worth 27.5M UZS; the client hands cash to the driver out of money he never owed the dealer. UI: its own clearly-labeled payment type; no cashbox field; statements render the create-time carve-out row, not a payment effect.
- DERIVED TRANSPORT PAID STATUS — Rule: transportPaidStatus is never set by hand: CLIENT_OWN or transportCost=0 → NOT_APPLICABLE; Σ active allocations from non-voided VEHICLE_OUT/TRANSPORT_DIRECT payments ≥ transportCost → PAID (latest VEHICLE_OUT) or PAID_BY_CLIENT (latest TRANSPORT_DIRECT); otherwise UNPAID — except an imported UNKNOWN (workbook blank) survives until payment evidence exists. Recomputed after every payment create/void and order edit so a partial 1-so'm allocation can't read as PAID and a void can't clobber another payment's settlement. UI: transport status chip on order rows; UNKNOWN is a real state the owner must resolve, so it needs a distinct visual and a review filter.
- PAYMENT INTEGRITY RULES — Rule: amounts must be positive Decimals (assertPositiveMoney, rounded to 2dp); USD method requires usdAmount+rate, UZS value = usdAmount × rate computed SERVER-side, USD cashbox receives the USD amount, cashbox currency must match the method (USD→USD box, else UZS); kind↔party matrix enforced in service AND by SQL CHECK (CLIENT_IN/CLIENT_REFUND→clientId only; FACTORY_OUT/FACTORY_REFUND→factoryId only; VEHICLE_OUT→vehicleId only; TRANSPORT_DIRECT→clientId+vehicleId); idempotencyKey (unique) makes double-submit return the original payment; method=BONUS is rejected outside the bonus module; direction: CLIENT_IN & FACTORY_REFUND are kassa IN, all other cashbox kinds OUT. Why: v2 accepted negative/NaN amounts, client-supplied FX totals and double posts. UI: USD forms show the computed UZS preview but never let the user type it; cashbox selects filter by currency; save buttons can be safely double-clicked (idempotent).
- CASHBOX NEVER BELOW ZERO — Rule: every OUT movement (payment, expense, manual kassa OUT, bonus-withdrawal reversal, kassa reversal that flips to OUT) takes a FOR UPDATE lock on the cashbox and rejects if balance − amount < 0, with the current balance in the error; kassa balance = Σ IN − Σ OUT per box in the box's own currency (rate stored but never used for conversion; USD totals reported separately, never summed into UZS). Why: v2 boxes silently went negative. UI: show live box balances in payment/expense forms (already done — keep it); surface the shortfall error clearly.
- ALLOCATION RULES — Rule: only ADMIN/ACCOUNTANT may allocate (inline at create or via POST /payments/:id/allocations); only kinds CLIENT_IN, FACTORY_OUT, VEHICLE_OUT, TRANSPORT_DIRECT are allocatable; Σ active allocations ≤ payment.amount; exactly one ACTIVE allocation per (payment, order) — change requires voiding first (partial unique index); the target order must belong to the payment's party (client/factory/vehicle match) and must not be CANCELLED; payment row is locked during allocation so allocate-vs-void cannot interleave. Why: allocation drives cost finalization and aging — letting cashiers/agents allocate would let them finalize costs. UI: allocation editing is a privileged surface; remaining-to-allocate must be shown; errors ('already allocated to this order — void first') need graceful handling.
- SERVER-AUTHORITATIVE PRICING & AGENT FLOOR — Rule: prices come from the versioned book (ClientPrice per-client special price wins over ProductPrice DEALER_SALE), resolved at the order's business date; a user may enter a negotiated per-m³ price or a lump sum (lump sum is stored EXACTLY as saleTotal, unit price back-solved to 6dp — negotiated totals must reproduce to the tiyin), but an AGENT can never sell below the FACTORY_BANK price of the product at the order date; pricePending (unpriced shipment) is ADMIN/ACCOUNTANT-only, sale=0 until late pricing posts an ORDER_SALE entry dated to the order date. Client-supplied costPrice is never accepted — cost always comes from the factory price book. Why: v2's client-supplied prices were a critical fraud vector; lump-sum and unpriced-truck realities come from the workbook (Рустам Шпик 0.62 residue, Шиддат unpriced trucks). UI: pricing-mode selector (catalog/negotiated/lump/pending) with the floor communicated to agents; 'Narxsiz' state must be loudly visible on order rows until priced.
- MONEY PRECISION & SETTLEMENT EPSILON — Rule: all money is Prisma Decimal — 18,2 for totals (round half-up), 18,6 for per-m³ prices (never rounded to the money grid), 12,3 for volumes; JS floats never touch money. |balance| < 1 UZS is float residue from back-solved prices and is displayed/treated as settled (isSettled). Why: Float money was the audit's #1 critical; the 1-UZS rule is the owner's answer to workbook residues. UI: balances under 1 UZS render as zero/settled; money inputs use formatted integer-so'm entry.
- ONE ORDER = ONE TRUCK, CAPACITY & CUBE MATH — Rule: an order models a single truckload; multiple items allowed (split loads) but ALL must belong to the order's one factory; Σ palletCount over items ≤ vehicle.capacityPallets (or AppSetting truckCapacityPallets default 19) — exceeded → rejected; quantityM3 defaults to palletCount × product.m3PerPallet (1.728 for ×200, 1.8 for ×250) when not entered explicitly (explicit m³ wins); palletPrice defaults from AppSetting (130,000). Why: matches workbook physical reality (18–19 pallet trucks, 31.104/32.832 m³ loads) and validates data entry. UI: live pallet/m³/capacity readout on the order form (exists — keep); vehicle picker showing capacity.
- GAP-SAFE ORDER NUMBERING — Rule: orderNo comes from a PostgreSQL sequence (order_no_seq) rendered 'ORD-000001' — concurrency-safe, never reuses numbers after cancels. Why: v2's count()+1 produced duplicate numbers. UI: order number is system-assigned, never editable.
- AGENT SNAPSHOT ATTRIBUTION — Rule: order.agentId and payment.agentId snapshot the client's agent at creation time; reassigning a client to another agent never rewrites history (agent KPIs are historical). Why: fair commission/KPI accounting. UI: agent columns on historic rows may legitimately differ from the client's current agent — don't 'fix' them.
- DUE DATES & COLLECTIONS — Rule: order.dueDate = order.date + client.paymentTermDays (null term → no dueDate); an order is overdue when non-cancelled and dueDate < now; debts/clients aggregates overdue counts/totals per client and expectedCollections = Σ positive balances of clients with a term or a dueDate within the ?days window (default 7). Why: collection discipline the workbook lacked. UI: overdue badges on client debt rows, dueDate on order detail, a collections-horizon control.
- RBAC DEFAULT-DENY + ROW SCOPING — Rule: global JwtAuthGuard + default-deny RolesGuard; every route carries explicit @Roles; AGENT users are additionally row-scoped in services (agentScope/clientAgentScope/assertOwnAgent): own clients/orders/payments only, CLIENT_IN payments only, no factory/vehicle finance, no statements of non-clients; JWTs carry tokenVersion so deactivating a user or bumping the version kills sessions. Why: v2's fail-open guard caused IDOR and cross-agent finance leaks (audit criticals). UI: role-guarded routes exist client-side too (RequireRole), but UI hiding is cosmetic — the redesign must keep parity with the backend matrix, not invent new exposure.
- EVERYTHING AUDITED — Rule: every financial mutation writes an AuditLog row (action, entity, entityId, before/after JSON, userId, ip, note) inside the same transaction; status changes also write OrderStatusHistory; every money row carries createdById. Why: accountability replaces the workbook's anonymous edits. UI: detail pages should expose the trail (order Tarix tab exists); an admin audit browser is a natural addition.
- IMPORT = REAL POSTINGS + HONEST RECONCILIATION — Rule: workbook import creates canonical clients through an alias merge map, real ledger AND kassa postings (unlike v2), TRANSPORT_DIRECT rows for client-paid transport, vehicle debt+payment pairs for trucks marked «Туланди», pricePending orders for unpriced trucks; client account sheets WIN over the Оплата ledger and the ~95.8M gap is imported as payments flagged reconciled=false awaiting owner sign-off; the batch's reconciliation endpoint must reproduce the workbook's numbers exactly (factory balance 973,619,270 with pallets; фарк(goods) 95,104,800 explained, not replicated). Why: the workbook's own reconciliation rows fail — the ERP must surface, not hide, those gaps. UI: import review screens must show expected-vs-actual per client, unreconciled payment queue, and negative-cashbox warnings prompting opening-balance entry.

### API

- POST /api/auth/login — JWT login; GET/PUT /api/auth/me — profile
- GET /api/orders — paged/filterable list (status, clientId, factoryId, dateFrom/To, search); agent-scoped
- POST /api/orders — create order (credit/agent-limit/capacity/price-floor checks, ledger + pallet postings)
- GET /api/orders/:id — full detail (items, history, comments, allocations, ledger, pallets, documents)
- GET /api/orders/:id/timeline — merged status/payment/comment event stream
- PUT /api/orders/:id — edit (ADMIN/ACCOUNTANT; NEW/CONFIRMED + PROVISIONAL only; full repost)
- PATCH /api/orders/:id/status — role-gated transition (+1 for AGENT; jumps/−1 for ADMIN/ACCOUNTANT); COMPLETED accrues bonus
- PATCH /api/orders/:id/items/:itemId/price — late pricing of pricePending item (per-m³ or lump sum)
- DELETE /api/orders/:id — soft-cancel with reason (ADMIN/ACCOUNTANT)
- GET/POST /api/orders/:id/comments — order comments
- GET /api/payments — paged register (kind/method/party/date/reconciled/voided filters; AGENT: own CLIENT_IN only)
- POST /api/payments — create payment (idempotencyKey, kind↔party matrix, USD conversion, kassa row, optional inline allocations)
- POST /api/payments/:id/allocations — allocate to orders (ADMIN/ACCOUNTANT; triggers cost finalization / transport settle)
- POST /api/payments/:id/void — compensating void (ledger + kassa reversals, allocation void, cost/transport re-derive, bonus restore)
- GET /api/debts/summary — clientsOweUs / weOweClients / factoryAdvance / weOweFactories / weOweVehicles / palletsAtClients
- GET /api/debts/clients — per-client debt rows with pallets, overdue, expectedCollections (?days)
- GET /api/debts/statement — party ledger statement with opening/closing balance (account, partyId, from, to)
- GET/POST/PUT/DELETE /api/clients(+/:id) — CRUD (delete ADMIN); POST /api/clients/:id/aliases, /api/clients/:id/prices — alias + special price
- GET /api/agents, GET /api/agents/me, GET/POST/PUT/DELETE /api/agents/:id — agent CRUD + KPIs (debtLimit)
- GET/POST/PUT/DELETE /api/factories(+/:id); GET/POST /api/factories/:id/bonus-program — versioned program
- GET /api/products, POST/PUT/DELETE /api/products(:id); GET/POST /api/products/:id/prices — versioned 3-kind price book
- GET/POST/PUT/DELETE /api/vehicles, /api/regions, /api/legal-entities — catalogs
- GET /api/pallets/balances — client (+factory for FIN) pallet balances; GET /api/pallets/transactions — movement log
- POST /api/pallets/client-return | factory-return | charge-lost — pallet mutations (ADMIN/ACCOUNTANT)
- GET /api/bonus/wallets, /api/bonus/transactions — wallet balances + trail
- POST /api/bonus/withdraw | /api/bonus/offset | /api/bonus/transactions/:id/reverse — wallet spends/reversal
- GET /api/kassa/cashboxes | /api/kassa/summary | /api/kassa/transactions — treasury reads
- POST /api/kassa/manual — manual IN/OUT (balance-checked); POST /api/kassa/transactions/:id/reverse — MANUAL-row reversal
- GET/POST /api/expenses; POST /api/expenses/:id/void; GET/POST/PUT/DELETE /api/expenses/categories
- GET /api/dashboard/summary | /trends | /agents-ranking | /kassa — role-scoped KPIs (goods vs transport profit split, cashUSD separate)
- GET /api/reports/svod | /orders-register (+.xlsx exports)
- GET /api/procurement/matrix?regionId= | GET/POST /api/procurement/routes — landed-cost analytics
- POST /api/import/excel — 21-sheet workbook import (ADMIN); GET /api/import/batches, GET /api/import/batches/:id/reconciliation, DELETE /api/import/batches/:id
- GET /api/settings (FIN) / PUT /api/settings/:key (ADMIN) — AppSettings
- GET/POST/PUT/DELETE /api/users — user admin (ADMIN only)

---

# Gap investigations

## CONTRADICTION — agent deletion: Auth/Roles map lists 'agent hard-delete (DELETE /agents/:id)' under ADMIN, while the Customer/Agent/Region map says agents are soft-deactivated so historical orders keep their snapshot.

RESOLVED — not a real contradiction in the code; the two maps described different layers, and the Auth/Roles map's "hard-delete" label is wrong about semantics (likely inherited from legacy v2 docs).

1. The route exists and is ADMIN-only, exactly as the Auth/Roles map says. C:/Users/mello/Documents/GitHub/smartblok/apps/api/src/agents/agents.controller.ts:47-51 — `@Delete(':id')` with `@Roles('ADMIN')` calls `service.remove(id, user)`. So "DELETE /agents/:id under ADMIN" is correct as an authorization fact.

2. But the handler's semantics are soft-delete, exactly as the Customer/Agent/Region map says. C:/Users/mello/Documents/GitHub/smartblok/apps/api/src/agents/agents.service.ts:201-219 — `remove()` is doc-commented "Soft-delete: deactivate only — historical orders/payments keep their agent snapshot." It does `tx.agent.update({ where: { id }, data: { active: false } })` (line 206) inside a transaction — no `agent.delete()` anywhere. The row is preserved.

3. Nuance worth recording: the audit log entry uses `action: AuditAction.DELETE` with `note: 'deactivated (soft delete)'` (agents.service.ts:210-215). So the audit trail shows action=DELETE for what is physically an update to active=false — anyone reading only the AuditAction enum (or the HTTP verb DELETE) would reasonably label this "delete"; the note field is what disambiguates.

4. Where the "hard-delete" wording almost certainly came from: the legacy (pre-v3-rebuild) spec docs describe the OLD system where all removes were physical. C:/Users/mello/Documents/GitHub/smartblok/docs/07-api-spetsifikatsiyasi.md:243 ("DELETE /api/agents/:id | ADMIN | ochirilgan agent | Agent ochirish") and line 739 ("Hard delete — barcha `remove` operatsiyalari fizik ochirish"); docs/06-funksional-talablar.md:272 (FR-AGN-05 "Ochirish"); docs/10-nofunksional-talablar.md:67 (role matrix row for DELETE /agents/:id = ADMIN only). These documents are the audit of the legacy v2 codebase that the 2026-07 ERP rebuild replaced; the v3 code deliberately changed the semantics while keeping the route shape and ADMIN gating.

5. No hard-delete path for agents exists anywhere in v3. The only bulk hard-delete in the API is import rollback (apps/api/src/import/import.service.ts:1195-1261), and it deletes only transactional rows (cashTransactions, ledgerEntries, palletTransactions, bonusTransactions, paymentAllocations, payments, orders, expenses, the ImportBatch itself) — it never deletes Agent (or Client) rows. Soft-delete-only is the consistent v3 pattern across masters: factories.service.ts:164, vehicles.service.ts:142, products.service.ts:152, users.service.ts:176 all carry the same "deactivate, never hard-delete" comment. The one deliberate exception is Region (apps/api/src/regions/regions.service.ts:50-51: hard delete allowed only while nothing references it, explicitly justified as non-financial data), plus client aliases (clients.service.ts:271).

6. Frontend detail: the web client defines `deleteAgent: (id) => del('/agents/${id}')` at apps/web/src/lib/api.ts:84, but no page ever calls it (grep across apps/web finds only the definition; Agents.tsx has no delete/Popconfirm UI). Deactivation from the UI would go through PUT /agents/:id since UpdateAgentDto exposes `active?: boolean` (apps/api/src/agents/dto.ts:74-76, also on create at 47-49), which ADMIN and ACCOUNTANT can both call (agents.controller.ts:37-45). So in practice the ADMIN-only DELETE endpoint is currently a dead API surface from the UI's perspective, and ACCOUNTANT can achieve the same deactivation via PUT.

Corrections to apply to the maps: (a) Auth/Roles map — relabel the ADMIN capability as "agent deactivation via DELETE /agents/:id (soft-delete: sets active=false; row and historical order/payment snapshots preserved)"; (b) note that ACCOUNTANT has an equivalent path via PUT /agents/:id {active:false}, so DELETE's ADMIN-only gating does not actually restrict who can deactivate an agent; (c) Customer/Agent/Region map is correct as written and needs no change.

## CONTRADICTION — route count: Auth map says ADMIN sees 'all 23 routes' vs UI-shell map's 'all 26 routes'; which is the authoritative route/role matrix for the redesign?

VERDICT: The UI-shell map is correct — 26 guarded in-shell routes. The Auth map's "23" matches no artifact in the code and must not be used as the route matrix.

GROUND TRUTH (C:/Users/mello/Documents/GitHub/smartblok/apps/web/src/App.tsx, lines 58-95 — verified the ONLY route-definition site in the app; `grep '<Route'` across apps/web/src hits App.tsx alone, 29 occurrences = 1 layout route + /login + 26 children + 1 wildcard):

- 26 guarded routes inside the Protected>AppShell layout route (lines 67-92), each wrapped in Guard/RequireRole.
- Plus /login (line 59, unguarded) and `*` → redirect to `/` (line 94).
- 27 page components exist in apps/web/src/pages/ (verified by glob): 26 in-shell pages + Login. Exact 1:1 with routes — no orphan pages, no missing pages.

ROLE CONSTANTS (App.tsx lines 39-42):
- ALL = ADMIN, ACCOUNTANT, AGENT, CASHIER
- FIN = ADMIN, ACCOUNTANT
- SALES = ADMIN, ACCOUNTANT, AGENT
- TREASURY = ADMIN, ACCOUNTANT, CASHIER

FULL ROUTE MATRIX (26 routes):
- ALL (3): /, /payments, /profile
- SALES (8): /orders, /orders/new, /orders/:id, /clients, /clients/:id, /agents/:id, /debts, /pallets
- FIN (11): /agents, /factories, /factories/:id, /products, /vehicles, /regions, /legal-entities, /procurement, /bonus, /reports, /import
- TREASURY (2): /expenses, /kassa
- ADMIN-only (2): /users, /settings
Total 3+8+11+2+2 = 26.

PER-ROLE VISIBILITY (derived, use this for the redesign):
- ADMIN: all 26
- ACCOUNTANT: 24 (everything except /users, /settings)
- AGENT: 11 (ALL 3 + SALES 8)
- CASHIER: 5 (ALL 3 + TREASURY 2)

Note the deliberate asymmetry: /agents (list) is FIN but /agents/:id (detail) is SALES — an AGENT can open an agent detail page but not the agents list.

Guard behavior (apps/web/src/auth/RequireRole.tsx): no user → redirect /login with `from` state; wrong role → renders an AntD 403 Result (explicit, no silent hiding). Protected (App.tsx:48-53) additionally wires useRealtime(token) app-wide.

WHERE '23' LIKELY CAME FROM (and why every candidate fails):
- Sidebar NAV (apps/web/src/components/AppShell.tsx lines 38-75) has 20 leaf items (9 top-level + reports/import/procurement + 6 Catalog children + 2 Boshqaruv children) — not 23. /profile is reachable only via the header avatar dropdown (AppShell.tsx:149), and 5 routes have no nav entry at all: /orders/new, /orders/:id, /clients/:id, /agents/:id, /factories/:id. 20 nav + 1 profile + 5 detail/new = 26.
- 26 minus the three /orders and /clients sub-routes (/orders/new, /orders/:id, /clients/:id) = 23 — the most plausible undercount: the Auth map apparently collapsed those into their parents while still counting /agents/:id and /factories/:id.
- No repo doc states 23 or 26 routes: docs/08-foydalanuvchi-interfeysi.md is the v2-era TZ (dated 2026-07-09, explicitly notes v2 had NO route-level RBAC — "Protected faqat token/user borligini tekshiradi"), and docs/audit/frontend-arch.md line 32-34 documents that pre-rebuild gap plus the REC that led to the current RequireRole design. Those describe the OLD app and also must not be used as the current matrix.

RECOMMENDATION: Treat App.tsx lines 39-42 (role constants) + 67-92 (route elements) as the single authoritative route+role matrix. Discard the Auth map's page inventory; if the redesign needs a nav model, AppShell.tsx NAV (20 leaves + profile dropdown) is the authoritative sidebar structure, with the 5 detail/new routes reachable only by navigation from list pages.

## Document model (file attachments) exists in schema and is included in the order detail API response, but has no create path, no upload/download endpoints, no UI, no docs coverage — dead end-to-end. Redesign must decide: build the attachments UX or drop the model.

## Document model: schema-only, provably dead end-to-end

### 1. The model (apps/api/prisma/schema.prisma:856-872, under section comment "attachments / import" at :854)
`model Document { id uuid, filename String, storedPath String, mime String?, size Int?, orderId?/order, clientId?/client, uploadedById?/uploadedBy(User), createdAt }` with `@@index([orderId])` and `@@index([clientId])`. Back-relations `documents Document[]` exist on User (schema.prisma:217), Client (:311), and Order (:529). Precision: User is linked only as **uploader** (uploadedBy), not as an attachment target — attachable entities are Order and Client only.

### 2. The table ships in production, always empty
- Created in the v3 init migration: apps/api/prisma/migrations/20260710233436_v3_init/migration.sql:502-513 (table), :771/:774 (indexes), :987-993 (FKs, all `ON DELETE SET NULL`).
- Nothing ever writes a row: no `prisma.document.create` anywhere in apps/api/src; the Excel importer (apps/api/src/import/) never touches Document; seed.ts has zero matches.

### 3. Sole consumer: a cosmetic include
apps/api/src/orders/orders.service.ts:317 — `documents: true` inside `findOne()`'s include. So `GET /api/orders/:id` always returns `documents: []` forever. That include is the model's only reference in all of apps/api/src (the other grep hit, reports.controller.ts:90, is just the xlsx content-type header string).

### 4. No upload/download infrastructure
- apps/api/src has 23 module directories (agents, auth, bonus, clients, ..., vehicles) — none for documents/attachments/files.
- Only multer usage is the Excel importer: apps/api/src/import/import.controller.ts (FileInterceptor + `memoryStorage` — buffered, parsed, discarded).
- No `StreamableFile`, `createReadStream`, `ServeStatic`, or `express.static` anywhere in apps/api — no way to download a file even if a row existed.
- Vestigial storage placeholder: **.gitignore:38-39** reserves `apps/api/uploads/` under the comment "# uploaded documents" — a directory nothing ever writes to. No UPLOAD_DIR/config setting exists.

### 5. Zero UI
Grep for `documents` in apps/web/src: no matches (only a CSS comment about print "documents"). apps/web/src/pages/OrderDetail.tsx receives `documents: []` from findOne and silently drops it; its tab array (OrderDetail.tsx:403) is payments / pallets / timeline / comments — the natural insertion point for an "Hujjatlar" (attachments) tab. No attachment UI on client pages either.

### 6. Docs: absent from the TZ, but present in the audit as the model's origin story
- None of the 10 TZ chapters (docs/01-...10-*.md) mention attachments; ch.07 (API spec) documents only real endpoints, and Document has none.
- **docs/audit/db-schema.md:111-114** ([medium] "Missing business entities: ... documents ...") recommended adding `Document { entityType, entityId, filename, path, uploadedBy }`. The v3 Phase 1 commit **510c078** ("Phase 1: v3 foundation — PostgreSQL + Decimal ledger schema") added the model (with concrete Order/Client FKs instead of the recommended polymorphic entityType/entityId) — but Phases 2-6 never built endpoints or UI. Echoed in docs/audit/DIGEST.md:19.
- Related audit demand signals if the feature is built: docs/audit/db-schema.md:98 notes payments lack a "receipt/document number for cashier traceability"; docs/audit/backend-financial.md:64 suggests a "correction-document pattern" for post-DELIVERED edits — i.e., signed invoices/receipts are a real audit-driven use case beyond contracts and delivery photos.

### 7. Decision inputs for the redesign
**Build** requires: a documents module (multipart POST scoped to order/client, disk storage under apps/api/uploads/, streaming GET with RBAC + agent-scoping via `order.agentId` like `assertOwnAgent` in orders.service.ts:321, DELETE/void), size+MIME limits (security audit already flagged the importer for lacking these — docs/audit/security.md:72-74), an attachments tab in OrderDetail.tsx:403 and on the client page, and a backup story for files living outside Postgres (NFR-BAK in docs/10). Current model gaps to fix if kept: no `kind` discriminator (contract vs delivery photo vs signed invoice), no soft-delete, and `ON DELETE SET NULL` FKs orphan rows with dangling `storedPath` when an order/client is deleted.
**Drop** costs one small change set: remove `documents: true` (orders.service.ts:317), the three back-relations (schema.prisma:217/311/529), the model (:856-872), a drop-table migration, and .gitignore:38-39. Nothing else references it — confirmed by exhaustive grep.

## CONTRADICTION — creditLimit=0 semantics: Logistics/Transport map claims '0 = unlimited' while Order, Payments, Customer, and master maps say null = unlimited and 0 = prepay-only.

VERDICT: The Logistics/Transport map is wrong on the parenthetical only; its formula is right. Current v3 code is unambiguous: null = unlimited, 0 = prepay-only. The other four maps are correct.

CODE EVIDENCE (all paths absolute):

1. C:/Users/mello/Documents/GitHub/smartblok/apps/api/src/orders/orders.service.ts:929-942 — `assertClientCreditLimit(tx, clientId, creditLimit: Prisma.Decimal | null, newExposure)`. Line 935 is the load-bearing line: `if (creditLimit === null) return; // null ⇒ unlimited`. There is NO zero check. Line 936-937: `balance = await this.ledger.clientBalance(clientId, tx)` then `if (balance.plus(newExposure).gt(D(creditLimit))) throw BadRequestException('Kredit limiti oshib ketdi...')`. With creditLimit=0 this throws whenever balance + newExposure > 0, i.e. any order that would leave the client owing anything is rejected. A client with a prepaid (negative) ledger balance can still order up to that prepayment — exactly "prepay-only", not "unlimited".

2. Exposure formula (the part the Logistics map got RIGHT): orders.service.ts:148 (create) — `assertClientCreditLimit(tx, client.id, client.creditLimit, built.saleTotal.plus(transportCharge))`; transportCharge is nonzero only for TransportMode.DEALER_CHARGED (lines 137-140). Same on update at lines 437-442, checked after `reverseAllForOrder` (line 433) so the check is against the net new exposure. Both check sites are serialized by `SELECT ... FOR UPDATE` row locks on Client (lines 143, 431).

3. C:/Users/mello/Documents/GitHub/smartblok/apps/api/prisma/schema.prisma:299 — `creditLimit Decimal? @db.Decimal(18, 2) // null ⇒ unlimited; 0 ⇒ no credit (prepay only)`.

4. C:/Users/mello/Documents/GitHub/smartblok/apps/api/src/clients/clients.service.ts:355 — comment `/** creditLimit may legitimately be 0 (prepay only) — non-negative, 2dp. */`; lines 150-153: undefined/null (or AGENT-created client) stores null = unlimited, otherwise 0 is accepted as a real limit; line 199-203: creditLimit is office-only, silently stripped from AGENT updates.

5. Frontend agrees: C:/Users/mello/Documents/GitHub/smartblok/apps/web/src/pages/Clients.tsx:238 and ClientDetail.tsx:311 render 'Cheklanmagan' (unlimited) only for `creditLimit == null`; NewOrder.tsx:215-216 pre-warns with `creditLimit != null && num(balance) + exposure > num(creditLimit)` — 0 triggers the warning, consistent with the server.

WHERE THE WRONG CLAIM CAME FROM (two stale sources, do not re-ingest):
- The v2 codebase genuinely had 0 = unlimited: docs/audit/backend-platform.md:30 quotes old orders.service.ts:130-133 `// credit limit (creditLimit 0 = unlimited)` / `if (client.creditLimit && client.creditLimit > 0 ...)`. That audit describes pre-rebuild code; docs/audit/db-schema.md:144 even RECs documenting "0 = unlimited". These audits are historical, superseded by the v3 rebuild.
- Persistent memory file debt-model-decisions.md (in the .claude project memory) line 13 said "creditLimit = 0 means unlimited" from the 2026-07-09 v2 fix session. I corrected that line during this investigation to the v3 semantics (null = unlimited, 0 = prepay-only, exposure = saleTotal + transportCharge) so it cannot re-seed the error.
- Legacy TZ doc docs/05-biznes-jarayonlari-va-formulalar.md:604 still says creditLimit is not checked at all — also pre-rebuild, ignore for v3.

**⚠️ 2026-07-20: the exposure half of this investigation is SUPERSEDED. `transportCharge` is dead; exposure is now `clientChargeable(order) = saleTotal − clientDirectTransport(order)` — see [TRANSPORT MODEL — AUTHORITATIVE](#transport-authoritative). Only the creditLimit-semantics half (null = unlimited, 0 = prepay-only) still stands.**

CORRECTED LOCKED RULE for the Logistics/Transport map: "credit-limit check on order create/update = ledger clientBalance + (saleTotal + transportCharge, transportCharge only in DEALER_CHARGED mode) must not exceed client.creditLimit; creditLimit null = unlimited (check skipped), creditLimit 0 = prepay-only (rejects any order leaving a positive balance); check runs inside the order tx under a Client row lock, and on update after old ledger entries are reversed." The maps' consensus (Order/Payments/Customer/master) needs no change. Note the maps themselves are not files in this repo or the scratchpad — no on-disk map file exists to edit, so the parent orchestrator must apply this correction to its Logistics map state.

## Returns/refunds workflow: what CLIENT_REFUND and FACTORY_REFUND actually do end-to-end, how they relate to order soft-cancel (which never auto-refunds), and the system's position on GOODS returns (partial return of delivered blocks).

REFUND KINDS ARE FULLY IMPLEMENTED, BUT ONLY AS ACCOUNT-LEVEL CASH MOVEMENTS — THE WORKFLOW AROUND THEM IS UNDESIGNED.

1. What CLIENT_REFUND does (apps/api/src/payments/payments.service.ts)
- Party/cashbox matrix (lines 43-50, mirrored by SQL CHECK "payment_kind_party" and by the UI KIND_SPEC at apps/web/src/pages/Payments.tsx:36-43): CLIENT_REFUND requires clientId + cashboxId; FACTORY_REFUND requires factoryId + cashboxId.
- Ledger (postLedger, lines 356-363, sign convention >0 = they owe us per apps/api/src/common/ledger.service.ts:97): CLIENT_REFUND posts +amount to the CLIENT account (draws down the client's credit / increases their debt); FACTORY_REFUND posts -amount to FACTORY (draws down our prepaid advance at the factory).
- Cash: CASH_IN_KINDS = [CLIENT_IN, FACTORY_REFUND] (line 53), so CLIENT_REFUND is a kassa OUT protected by the never-below-zero cashbox guard under FOR UPDATE (lines 292-309); FACTORY_REFUND is a kassa IN. Cashbox currency must match method (USD method -> USD kassa).
- Concurrency: CLIENT_REFUND takes the Client row FOR UPDATE (lines 231-234) — the same lock the order-creation credit gate uses — so refund-vs-new-order cannot race. But the lock only serializes; see gap (4) below.
- Refunds are voidable like any payment (compensating ledger + kassa reversals, lines 712-812) and idempotency-key protected.
- Roles: POST /payments is open to ADMIN/ACCOUNTANT/CASHIER/AGENT (payments.controller.ts:34); service line 132 restricts AGENT to CLIENT_IN only, so refunds are creatable by ADMIN, ACCOUNTANT, and CASHIER. UI hides non-CLIENT_IN kinds from agents (Payments.tsx:209-211). Uzbek labels (format.ts:70-72): "Mijozga qaytarish" / "Zavoddan qaytim".

2. Refunds are deliberately NON-allocatable
ALLOCATABLE_KINDS excludes both refund kinds (payments.service.ts:63-68; UI mirror Payments.tsx:45), and applyAllocations rejects them (line 416-418). The /payments/:id/allocations endpoint accepts only CLIENT_IN and FACTORY_OUT (lines 383-387). Consequence: a refund can NEVER reference an order — it is purely an account-balance movement.

3. Soft-cancel does NOT auto-refund — confirmed (apps/api/src/orders/orders.service.ts:605-653)
cancel() reverses the order's ledger entries (reverseAllForOrder matches by orderId; payment postings carry paymentId and no orderId, so they survive), reverses pallets and bonus, then voids the order's paymentAllocations with the explicit comment "detach payments from the dead order — the money stays on the client's account" (line 631). Net effect of cancelling a prepaid order: the client ends with a credit balance (dealer owes them) while the cash stays in kassa. Paying it out is a separate, manual CLIENT_REFUND. This is consistent with the owner's locked rule in memory/debt-model-decisions.md ("Physical cash already received stays in the kassa (no auto-refund)") and implements the v2 audit REC at docs/audit/backend-financial.md:46 ("Add a CLIENT_REFUND payment type (direction OUT) posting a kassa OUT"). Note docs/audit/DIGEST.md:33 ("no refund mechanism exists") is stale relative to v3.

4. Design gaps in the refund half of the cancellation story
- No linkage/liability tracking: a CLIENT_REFUND carries no orderId and no reference to the cancellation that caused it. Nothing marks a cancelled prepaid order as "refund pending"; reconciliation of cancellation -> refund owed -> refund paid is pure operator discipline.
- No over-refund guard: create() only checks the client exists. There is no check that the client's credit balance covers the refund, and no credit-limit check on the debt the refund creates — assertClientCreditLimit exists only in orders.service (lines 148, 437, 932-940). ADMIN/ACCOUNTANT/CASHIER can refund any amount to any client, pushing them into unbounded debt (bounded only by the cashbox balance). Same for FACTORY_REFUND: no check against the factory advance; an oversized one flips the books to "we owe the factory".
- No UI workflow: Orders.tsx contains no refund affordance after cancel (grep for REFUND/qaytar: zero hits); the operator must independently open Payments -> Yangi to'lov -> Mijozga qaytarish.
- Zero test coverage: apps/api/test/e2e-core.mjs has no refund cases.
- Zero product-doc coverage: none of docs/01..10 mention refund kinds; only the audit files do.

5. Goods returns: the system's position is "full soft-cancel or nothing" — confirmed structurally
- No block/product return entity exists anywhere. The only "return" machinery in schema.prisma is for PALLETS: PalletEventType RETURNED_BY_CLIENT / RETURNED_TO_FACTORY (schema.prisma:138-139) and LedgerSource PALLET_RETURN_CREDIT — pallets are in-kind count balances per the owner's rule.
- Partial return of delivered blocks is impossible by construction: order item quantities are validated non-negative (IsMoneyValue v>=0 and palletCount @Min(0), apps/api/src/orders/dto.ts:36,52), so no negative "return lines"; and update() is hard-locked to status NEW/CONFIRMED with PROVISIONAL cost (orders.service.ts:385-390), so a delivered (COMPLETED) or cost-finalized order's quantities can never be reduced.
- cancel() has no status restriction other than already-CANCELLED, so even a COMPLETED order can be fully soft-cancelled — that full cancel (+ optional re-book of a smaller order, which re-runs the credit gate and reprices at current price rows) is the only workaround for a partial return today.

6. Questions that must go to the owner (cannot be discovered from code)
- Is "full cancel + re-book smaller order" an acceptable stand-in for partial returns of delivered blocks, or does a real GoodsReturn document (qty per item, restock/no-restock, cost/bonus/pallet unwind) need designing?
- Should CLIENT_REFUND be capped at the client's current credit balance (block over-refund), or is free-form refund intentional for dispute settlements?
- Should a cancelled order with surviving cash surface as an explicit "refund owed" liability (dashboard/debts) until a CLIENT_REFUND clears it, and should the refund carry a reference to the cancelled order for audit?

## Cashbox catalog management: no API endpoint or UI exists to create, rename, deactivate, re-link (legal entity), or set the currency of a Cashbox. The seven boxes come exclusively from prisma/seed.ts; the `active` flag is enforced as a hard gate by every money-writing path yet is untoggleable through the application; the Excel importer and its replace mode hard-depend on the seven exact seeded display names. Confirmed as a real operational hole the redesign must resolve.

CONFIRMED — the gap is real, and slightly worse than stated because `active` is load-bearing but frozen.

1. Endpoint surface (C:/Users/mello/Documents/GitHub/smartblok/apps/api/src/kassa/kassa.controller.ts, 47 lines): exactly 5 routes — GET /kassa/cashboxes, GET /kassa/transactions, POST /kassa/manual, POST /kassa/transactions/:id/reverse, GET /kassa/summary. No POST/PUT/PATCH/DELETE for the Cashbox entity. kassa/dto.ts defines only TransactionsQueryDto, ManualCashDto, ReverseCashDto, KassaSummaryQueryDto — no cashbox-shaped DTO. Grep for `cashbox.(create|update|upsert|delete)` across apps/api/src: zero matches. The only writer of Cashbox rows in the entire codebase is the seed.

2. Seed is the sole source (apps/api/prisma/seed.ts:50-71): upserts 7 boxes by unique name — Naqd kassa (CASH/UZS), Bank (Септем Алока) (BANK/UZS, entity-linked), Bank (Септем семент) (BANK/UZS, entity-linked), Click (CLICK/UZS), Terminal (TERMINAL/UZS), Karta (CARD/UZS), Valyuta (USD) (CASH/USD). Critically the upsert uses `update: {}` — re-running seed never corrects type/currency/entityId of an existing box, so a mis-set currency is permanent short of raw SQL.

3. Schema was designed for management nothing exercises (apps/api/prisma/schema.prisma:772-785): Cashbox has name @unique, type, currency, optional entityId → LegalEntity, `active Boolean @default(true)`; CashTransaction.cashboxId is onDelete: Restrict (line 790) — i.e. deactivate-not-delete semantics are modeled, but no code path ever flips `active` or sets entityId post-seed.

4. `active` is enforced everywhere but changeable nowhere: payments.service.ts:209-212 rejects payment into an inactive box ("Kassa topilmadi yoki faol emas") and validates box currency vs method (:213-216); kassa.service.ts:141 rejects manual entries into inactive boxes; expenses.service.ts:88 rejects expenses ("Kassa faol emas"); web UI Kassa.tsx:292 filters `activeBoxes` for the manual-entry select and :443 renders a "faol emas" tag; Dashboard.tsx:168 shows "Faol kassalar topilmadi". So v3 fixed the old audit complaint (docs/06-funksional-talablar.md:672 — active never filtered) on the read/enforce side only; the toggle itself requires psql.

5. Import seed-precondition confirmed (apps/api/src/import/import.service.ts): :37-45 hardcodes the CASHBOX name map mirroring seed.ts; :147-153 resolver `cb(name)` throws BadRequestException "Касса топилмади: <name> (seed ишга туширилганми?)", aborting the entire single-transaction import (same abort for the factory at :144-145). Payment routing is by display name — :683-688 client channels (BANK→one of two entity banks, CASH/OTHER→Naqd kassa, CLICK, TERMINAL, else USD box) and :823-825 factory payments (CARD/CASH/BANK). Renaming any seeded box (nothing prevents it at DB level, nothing enables it at app level) silently breaks any future re-import. Replace mode (:1213-1246) deletes batch rows but never touches Cashbox.

6. Cashbox is uniquely orphaned among catalogs: legal-entities.controller.ts has the full pattern — GET, POST, PUT/:id, DELETE/:id implemented as deactivate — and products/regions/vehicles/agents/factories all have modules plus web pages (LegalEntities.tsx, Products.tsx, Regions.tsx, Vehicles.tsx…). The settings module is no escape hatch: settings-admin.service.ts:21-52 whitelists exactly 4 keys (agentDebtLimitDefault, truckCapacityPallets, saleMarginMinPct, palletPriceDefault) and rejects unknown keys; Settings.tsx has zero cashbox references.

7. Prior audit already prescribed half the fix: docs/audit/backend-financial.md:106-109 flagged name-coupled payment routing and recommended a stable machine `code` column on Cashbox. v3 fixed this for live payments (client sends cashboxId; service validates active + currency) but the importer still routes by display name.

Redesign implications (concrete): (a) add an ADMIN(/ACCOUNTANT) cashbox CRUD module modeled on legal-entities — POST create (name, type, currency whitelisted UZS/USD, optional entityId), PUT rename/re-link, DELETE→deactivate toggle, audit-logged; deletion stays impossible via the existing Restrict FK. (b) Deactivation needs no downstream work — all three write paths and the UI already honor it. (c) Forbid currency change once the box has transactions (balances are Σ(IN)−Σ(OUT) in box currency, kassa.service.ts:34-47). (d) Decouple the importer from display names via the audit-recommended `code` column (or treat the 7 seed names as frozen codes), otherwise rename capability breaks re-import. (e) Operations currently impossible without psql: opening a box for a new bank account/legal entity, retiring Click/Terminal, fixing a name typo, adding a second USD box, linking Naqd kassa to an entity.

## Opening balances at go-live / onboarding: how does the owner seed a pre-existing client debt, factory advance, or driver liability outside the one-time Excel import, given cashbox opening balances are entered manually but no manual LedgerEntry endpoint exists?

CONFIRMED GAP: there is no mechanism to set an opening ledger balance for a client, factory, or vehicle outside the one-time Excel import. The feature was designed into the schema and even into the web UI's display layer, but the write path was never implemented.

1. Single ledger write path, zero manual endpoints. LedgerService.post (C:/Users/mello/Documents/GitHub/smartblok/apps/api/src/common/ledger.service.ts:33) is the only LedgerEntry writer ("The single write-path for balance-affecting postings... Balances are sums, never stored"). Its complete caller set: orders.service.ts (ORDER_SALE, TRANSPORT_CHARGE, ORDER_COST, TRANSPORT_COST), payments.service.ts (PAYMENT kinds + COST_ADJUSTMENT), pallets.service.ts (PALLET_CHARGE, PALLET_RETURN_CREDIT), bonus.service.ts (BONUS_OFFSET), import.service.ts (same sources tagged with importBatchId). No controller (debts.controller.ts has only GET summary/clients/statement) exposes a posting endpoint. Since clientBalance/factoryBalance/vehicleBalance are pure SUMs over LedgerEntry, a party with no history has an unfixable zero balance.

2. Dead enum values prove the intent. schema.prisma:131 declares LedgerSource.ADJUSTMENT ("manual, audit-logged") and :132 LedgerSource.IMPORT — grep shows NEITHER is referenced anywhere in apps/api/src (the importer posts ORDER_SALE/ORDER_COST/TRANSPORT_COST/PAYMENT, not IMPORT). The frontend already ships translation labels for the missing feature: apps/web/src/pages/ClientDetail.tsx:46 (ADJUSTMENT: "Qo'lda tuzatish") and FactoryDetail.tsx:52 — read-side ready, write-side absent. Same pattern for pallets: PalletTransactionType.ADJUSTMENT (schema.prisma:141, signed qty) is honored by every balance formula (clients.service.ts:19-32, agents.service.ts, debts.service.ts:64, pallets.service.ts, dashboard, reports) and by the DB CHECK constraint pallet_qty_positive_directional (migrations/20260710233436_v3_init/migration.sql:1023), but pallets.controller.ts exposes only client-return / factory-return / charge-lost — no adjustment endpoint, so opening pallet counters can't be seeded either.

3. Onboarding a client who already owes money: impossible without corrupting the books. CreateClientDto (apps/api/src/clients/dto.ts:35-67) has only name/legalEntity/phone/region/agent/creditLimit/paymentTermDays — no opening-balance field. Workarounds all distort data: (a) a fake order inflates revenue, m³ stats, factory cost, pallet counters and bonus accrual; (b) a CLIENT_REFUND payment does post +amount to the client ledger (payments.service.ts:357) but cashboxId is mandatory for every kind except TRANSPORT_DIRECT (payments.service.ts:206-207) and mirrors a kassa OUT CashTransaction guarded by a never-below-zero balance check (payments.service.ts:295-308) — i.e. it fabricates a cash outflow that never happened and fails outright if the kassa lacks funds. Meanwhile the missing debt silently weakens the credit-limit and agent debt-limit gates (ledger.service.ts:160 agentOutstandingDebt), which assume ledger balances are complete.

4. Second factory with an existing advance: doubly blocked. The importer cannot help — it is hard-wired to FACTORY_NAME = '"CAOLS KS" MCHJ' (import.service.ts:35, resolved at :144-145 with a seed-dependent error) and to the seeded cashbox names, so it only ever replays this one workbook for this one factory. The manual route, FACTORY_OUT payment (+advance, payments.service.ts:360), forcibly mirrors a balance-checked kassa OUT — so the owner would have to fake a manual kassa IN and then a fictitious FACTORY_OUT, polluting cash history and the audit trail with money movements that never occurred at go-live.

5. Vehicles are strictly worse. A dealer-owes-driver balance (<0) is created only by TRANSPORT_COST postings tied to orders (orders.service.ts:917-923; import.service.ts:553). No payment kind creates a vehicle liability (VEHICLE_OUT reduces it), so a pre-existing transport debt cannot be represented at all, even with fabricated cash.

6. Cashboxes are the ONLY party with a working onboarding path, matching the Import-map note. POST /kassa/manual (kassa.controller.ts:25-29, ADMIN/ACCOUNTANT/CASHIER; ManualCashDto in kassa/dto.ts) takes direction IN/OUT + amount + note, and the e2e suite uses it exactly this way: apps/api/test/e2e-core.mjs:94-96 posts {direction:'IN', amount:60000000, note:'opening balance'}. The importer explicitly punts here — import.service.ts:958 comment "cashbox balances (owner decides opening entries)": it only reports computed per-cashbox in/out/balance in batch stats (lines 958-976), never seeding CashTransactions. Note manual cash rows (CashSource MANUAL) never touch party ledgers, so this path cannot substitute for ledger openings.

7. Even the import has no opening-balance concept — it replays full history. Balances materialize as sums of re-created orders/payments/pallet rows since inception (docs/audit/excel-spec.md §9 canonical balance formulas, §11 import mapping; no opening-balance section exists in §10 or anywhere in the spec). So "onboard via import" only works for parties whose complete history lives in the 21-sheet CAOLS workbook, and re-import is destructive anyway (docs/audit/backend-platform.md:78 — replace deletes manually-entered expenses; rollback is DELETE /import/batches/:id, ADMIN-only).

CONCLUSION / smallest fix consistent with the architecture: implement the already-designed ADJUSTMENT posting — an ADMIN-only endpoint (e.g. POST /debts/adjustment or /ledger/adjustments) that calls LedgerService.post with source=ADJUSTMENT, a signed amount, required party (client/factory/vehicle per assertPartyMatchesAccount, ledger.service.ts:193), mandatory note, and an AuditService record; plus the matching signed PalletTransactionType.ADJUSTMENT endpoint (DB constraint already permits it). Corrections stay immutable via the existing reverse() machinery, no cash is fabricated, and the UI labels for both already exist.

## NOT COVERED — printing / paper documents as a domain: driver waybill (nakladnaya) at LOADING, client invoice, cashier payment receipt (kvitansiya), and printable client reconciliation statement (akt sverki). Only print support is a CSS rule stripping app chrome; only export is 2 xlsx report endpoints.

CONFIRMED — the entire print/document surface of SmartBlok v3 is 20 lines of CSS, and every paper artifact a truckload+cash business needs is missing. Concrete findings:

1. TOTAL PRINT SURFACE. apps/web/src/index.css:28-47 — one @media print block: hides `.no-print`, `.ant-layout-sider`, `.ant-btn`, `.ant-pagination`, `.ant-tabs-nav`; whitens layout; borders cards (`break-inside: avoid`). `.no-print` is applied in exactly 2 places: apps/web/src/components/AppShell.tsx:97 (sidebar) and :123 (header). There is NO `window.print()` call, no print button on any of the 26 pages, and zero PDF/print dependencies in apps/web/package.json or apps/api/package.json (no jspdf/pdfmake/react-to-print/puppeteer). The user must know to press Ctrl+P.

2. THE "INVOICE" LEAKS INTERNAL MARGINS. The CSS comment ("order workspace → invoice-like output") points at OrderDetail (apps/web/src/pages/OrderDetail.tsx, 717 lines), but printing it prints the operational workspace: the "Moliya" card (lines 619-642) with dealer cost `costTotal` (Tannarx) and `goodsProfit` (Tovar foydasi), and the "Transport" card (644-670) with `transportCost` vs `transportCharge` and transport profit — numbers a dealer would never hand to a client or driver. It also prints the Steps progress bar, cost-status tags, and whichever tab panel happens to be active (tabs nav is hidden in print but only the active panel renders). No company header, no legal-entity requisites, no signature/stamp blocks, no document date/number layout. It is not usable as a client invoice.

3. WAYBILL (NAKLADNAYA) — ALL DATA EXISTS, NO DOCUMENT. Order already carries everything a driver load sheet needs: orderNo (`B-0001`, the only human-readable doc number in the system, schema.prisma:483), client + phone, factory, vehicle {name, plate} and free-text `driverName` (autofilled from vehicle.driver, editable — NewOrder.tsx:250-253, 572-573; Vehicle has plate/driver/phone/capacityPallets, types.ts:110-117), items with product/size/m³/palletCount, and pallet transactions. The LOADING transition (OrderDetail.tsx:61-70 STATUS_FLOW/NEXT_ACTION; vehicle is mandatory for LOADING per docs/05) produces no paper artifact — there is no template, route, or endpoint to render one.

4. PAYMENT RECEIPT (KVITANSIYA) — NOT EVEN REFERENCEABLE. Payment (schema.prisma:599-629) has no document/receipt number at all — only uuid and `idempotencyKey`. The `denominations Json?` field (cash breakdown {"5000": n, …}) exists in the schema but has ZERO UI (grep: no matches in apps/web/src). Payments.tsx (961 lines) and Kassa.tsx have no print/receipt affordance. The CASHIER role records cash and has nothing to hand the payer. Payer/receiver LegalEntity relations + free-text payerName/receiverName (schema:619-624) exist — raw material for formal receipt requisites — but nothing renders them.

5. AKT SVERKI — BACKEND IS ~90% BUILT, FRONTEND ORPHANED IT. `GET /debts/statement` (apps/api/src/debts/debts.controller.ts:25-29, roles ADMIN/ACCOUNTANT/AGENT; debts.service.ts:192-246) already computes exactly a reconciliation statement: date-windowed entries, openingBalance (pre-window ledger sum), per-row running balance, closingBalance, party name, for CLIENT/FACTORY/VEHICLE. LedgerService.statement (common/ledger.service.ts:174-184) takes from/to, and reversals deliberately carry the original business date "so a date-windowed statement nets to zero" (ledger.service.ts:58-63). BUT the web helper `endpoints.debtsStatement` (apps/web/src/lib/api.ts:179-180) is dead code — called by no page. ClientDetail's "Hisob-kitob" tab (ClientDetail.tsx:342-355) instead shows the all-time statement embedded in GET /clients/:id (clients.service.ts:128 — no from/to) with no date filter, no export, no print; FactoryDetail.tsx:439-446 same. Debts.tsx (251 lines) never touches the statement endpoint either.

6. ONLY EXPORT = 2 INTERNAL XLSX REPORTS. reports.controller.ts:26 (`orders-register.xlsx`) and :41 (`svod.xlsx`), ADMIN/ACCOUNTANT only, consumed at Reports.tsx:224 and :564 via downloadFile (api.ts:198-207). These are accountant artifacts, not client/driver documents. No other page exports anything.

7. KNOWN, TWICE-FLAGGED, PARTIALLY ADDRESSED. The v2 audit already called this out: docs/audit/frontend-pages.md:185-188 — "no printable invoice/waybill for an order (essential for a wholesale dealer handing documents to drivers/clients)", REC: "Prioritize: printable order/invoice view…"; carried into docs/audit/DIGEST.md:108. The v3 rebuild's Phase 6 ("polish — … print CSS", commit 992bb4f) answered it with only the CSS rule. The nine docs chapters (docs/01–09) contain zero occurrences of print/chop/bosma — printing is undocumented as a domain.

8. OWNER INTERVIEW NEEDED (cannot be resolved from code). Questions to put to the owner: (a) at LOADING, does the factory issue its own nakladnaya, or must the dealer print a load sheet per truck (and does the driver sign for pallet counts)? (b) what does the client sign at DELIVERED — anything retained for debt disputes? (c) cash payments: does the cashier hand out any kvitansiya today, and is a thermal 80mm printer or A4 the target? (d) does tax require official schet-faktura via Uzbekistan's e-invoice systems (didox.uz / soliq.uz / E-aktivlar), or is this a fully informal cash business where only internal documents matter? (e) akt sverki: which period granularity and does it need dual-signature blocks with legal-entity requisites? (f) language of documents — Uzbek Latin (current UI), Cyrillic (workbook headers), or Russian?

RECOMMENDED SHAPE (grounded in what exists): a print-only document layer (dedicated routes like /orders/:id/waybill and /orders/:id/invoice rendering only client-facing fields + LegalEntity header + signature blocks + window.print button), a receipt view on payment create success (needs a receipt number column on Payment), and wiring the already-built GET /debts/statement into ClientDetail with a date range picker + print/xlsx — that last one is the cheapest win since the API, opening/closing balance math, and the dead client helper (api.ts:179) all already exist.

