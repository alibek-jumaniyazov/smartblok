# SmartBlok — Product-lead decisions (binding on implementation)

Resolutions to the consistency-audit findings. These override any conflicting
detail in the screen specs. Implementation agents MUST follow this document.

---

## D1 — AGENT price floor is enforced at submit only, never disclosed (HIGH)

**Finding:** `screens/orders.md §2.4` and `screens/mobile-agent.md §4.3` originally
rendered agents a proactive floor hint «Eng past: 625 000 — zavod bank narxi» read
from `prices.FACTORY_BANK`.

**Why it's wrong:** (a) locked rule — agents must NEVER see factory cost prices;
(b) technically impossible — `products.service.ts` (line 35, 58) returns AGENT users
**only `DEALER_SALE`**; `FACTORY_CASH`/`FACTORY_BANK` are stripped. The floor value IS
the confidential cost, so showing any floor number leaks it.

**Decision (in scope, no backend change):** For AGENT, the «Kelishilgan» price floor is
**enforced at submit only**. The agent types a per-m³ price; if it is below the server
floor, `POST /orders` (or the late-pricing PATCH) is rejected and the server's Uzbek
error renders **verbatim** under the price field/step; nothing entered is lost;
re-typing re-validates. **No proactive number, no client-side clamp** for AGENT (there is
no floor value in their payload to clamp against). A/B users, whose payload does carry
`FACTORY_BANK`, keep an amber advisory hint and may proceed below it.

Specs `orders.md` (§0 API table, §2.4, §2.10, §11 rule table) and `mobile-agent.md`
(§4.3, edge-paths, locked-rule table) have been edited to match.

---

## D2 — AGENT payment recording is a pre-existing backend gap; do NOT fake it, do NOT expand backend (LOW→resolved)

**Finding:** `POST /payments` CLIENT_IN requires a `cashboxId` for every kind except
TRANSPORT_DIRECT (`payments.service.ts:206-207`), and AGENT is admitted for CLIENT_IN —
but `GET /kassa/cashboxes` is `@Roles('ADMIN','ACCOUNTANT','CASHIER')` (no AGENT). An
agent therefore cannot enumerate a cashbox to satisfy the required field.

**Status:** This is **pre-existing** — the current `Payments.tsx` already fetches
`endpoints.cashboxes()` when the CLIENT_IN modal opens (line 171-174), so an agent hits
the same 403 today. The redesign does not introduce it.

**Decision:** Do **not** grant AGENT access to `GET /kassa/cashboxes` — it returns
treasury balances (`inTotal/outTotal/balance`); exposing them to field agents is a
custody/visibility leak, and cash custody legitimately belongs to CASHIER/ACCOUNTANT.
Do **not** add speculative backend surface. In the redesign, the **AGENT role's money
experience is collections visibility + handoff**, not cash booking: agents get the debt
board, client balances/statements, akt-sverki print, and the ability to *surface* what
needs collecting — but the actual cash receipt (with a cashbox) is booked by
CASHIER/ACCOUNTANT (matching the existing permission model and the cashier→accountant
allocation handoff already in the specs).

**Implementation:** In `PaymentComposer`, the AGENT variant is **not wired for CLIENT_IN
cash booking**. If a future owner decision authorizes agent cash custody, the minimal
enabling change is an agent-safe cashbox lookup that omits balances — noted here, not
built. Where `screens/mobile-agent.md` / `screens/money.md §3.4` imply an agent CLIENT_IN
composer, treat it as gated on this capability and render the honest degraded state
(«To'lovni kassir yoki buxgalter rasmiylashtiradi») rather than a broken cashbox picker.

---

## D3 — reconciled=false review queue MAY use the violet «owner-must-resolve» tier (LOW)

`02-design-language.md §2.4` reserves violet for transport-`Aniqlanmagan` + workbook-defect
badges. **Director's ruling:** the `Tekshirilmagan to'lovlar` (reconciled=false) **worklist
queue** is authorized to use the violet *severity* tier on the InboxRail — it is
semantically the same channel ("imported data the owner must resolve"). This is the
**queue severity**, distinct from the **row status dot**, which stays amber per §2.5. No
other borrowing of violet is permitted. No spec edit required.

---

## D4 — remaining LOW items (accepted, resolve during implementation)

- **`/references?tab=kategoriyalar`** (expense-category CRUD): no full screen spec beyond
  the `03 §4` one-liner. Implement it mirroring `parties.md §5` (Hududlar) and
  `catalog.md §7` (Yuridik shaxslar) — columns (Nomi · ishlatilgan soni from
  `_count.expenses`) · inline rename · delete-when-unused; the inline «+» on Expenses
  stays. No feature loss.
- **`/products/reprice`** route + «Narxlarni yangilash» palette action: add both to the
  router and palette action list during the catalog wave (they exist only inline in
  `catalog.md §2` today).
- **`AgentCard`**: an instance of the `03 §11` responsive-card anatomy; acceptable without
  its own `04-components.md` entry. Build it as a thin composition, not a new primitive.
- **`GET /kassa/cashboxes` AGENT note** appears only in `mobile-agent.md §0.8a` — see D2;
  it applies equally to the desktop AGENT composer.
