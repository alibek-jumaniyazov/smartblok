// Role → capability map, hand-aligned with the backend @Roles matrix
// (apps/api/src/*/*.controller.ts, audited 2026-07-11). UI hiding is cosmetic:
// this map MIRRORS the server, it never invents exposure (03 §1.3).
// Every capability's comment names its backend endpoint(s) so drift is auditable.
// AGENT rows are additionally row-scoped server-side (own clients/orders/payments).
import type { Role } from './types';

const A = 'ADMIN', B = 'ACCOUNTANT', G = 'AGENT', K = 'CASHIER';

/** capability → roles allowed, straight from the controllers */
const MATRIX = {
  // ── auth ──────────────────────────────────────────────────────────────
  /** PUT /auth/me (profile + password) — A B G K */
  'profile.edit': [A, B, G, K],

  // ── orders ────────────────────────────────────────────────────────────
  /** GET /orders · GET /orders/:id (+ /timeline, /comments) — AGENT row-scoped */
  'orders.view': [A, B, G],
  /** POST /orders */
  'orders.create': [A, B, G],
  /** PUT /orders/:id — NEW/CONFIRMED only, items full-replace (A/B only) */
  'orders.edit': [A, B],
  /** PATCH /orders/:id/status — AGENT allowed (service limits to +1 forward) */
  'orders.setStatus': [A, B, G],
  /** PATCH /orders/:id/items/:itemId/price — price pending items (Narxlash) */
  'orders.price': [A, B],
  /** DELETE /orders/:id — soft-cancel with reason */
  'orders.cancel': [A, B],
  /** POST /orders/:id/comments */
  'orders.comment': [A, B, G],

  // ── payments ──────────────────────────────────────────────────────────
  /** GET /payments · GET /payments/:id — AGENT sees own CLIENT_IN */
  'payments.view': [A, B, K, G],
  /** POST /payments — kinds restricted per role in service (AGENT: CLIENT_IN) */
  'payments.create': [A, B, K, G],
  /** POST /payments/:id/allocations — SettleDrawer (K/G read-only) */
  'payments.allocate': [A, B],
  /** POST /payments/:id/void */
  'payments.void': [A, B],

  // ── clients ───────────────────────────────────────────────────────────
  /** GET /clients · GET /clients/:id — AGENT scoped to own */
  'clients.view': [A, B, G],
  /** POST /clients — AGENT allowed (agentId forced to self, credit fields stripped) */
  'clients.create': [A, B, G],
  /** PUT /clients/:id — basic fields (name/phone/region/legalEntity) */
  'clients.edit': [A, B, G],
  /** PUT /clients/:id privileged fields: creditLimit, paymentTermDays, agentId,
   *  active (activate/deactivate) — stripped server-side for AGENT */
  'clients.editCredit': [A, B],
  /** DELETE /clients/:id — hard deactivate */
  'clients.delete': [A],
  /** POST /clients/:id/aliases · DELETE /clients/:id/aliases/:aliasId */
  'clients.aliases': [A, B],
  /** POST /clients/:id/prices — client special prices */
  'clients.prices': [A, B],

  // ── debts ─────────────────────────────────────────────────────────────
  /** GET /debts/summary — the six headline figures (A/B only!) */
  'debts.summary': [A, B],
  /** GET /debts/clients · GET /debts/statement — AGENT scoped */
  'debts.view': [A, B, G],

  // ── kassa ─────────────────────────────────────────────────────────────
  /** GET /kassa/cashboxes · /transactions · /summary */
  'kassa.view': [A, B, K],
  /** POST /kassa/manual — manual IN/OUT */
  'kassa.manual': [A, B, K],
  /** POST /kassa/transactions/:id/reverse — storno (MANUAL rows only) */
  'kassa.storno': [A, B],

  // ── expenses ──────────────────────────────────────────────────────────
  /** GET /expenses · GET /expenses/categories */
  'expenses.view': [A, B, K],
  /** POST /expenses */
  'expenses.create': [A, B, K],
  /** POST /expenses/:id/void */
  'expenses.void': [A, B],
  /** POST/PUT/DELETE /expenses/categories — category CRUD (References tab) */
  'expenses.categories': [A, B],

  // ── factories ─────────────────────────────────────────────────────────
  /** GET /factories (list) — AGENT may list (pickers) */
  'factories.view': [A, B, G],
  /** GET /factories/:id — settlement hub (A/B only, no AGENT) */
  'factories.detail': [A, B],
  /** POST/PUT/DELETE /factories */
  'factories.manage': [A, B],
  /** GET/POST /factories/:id/bonus-program — versioned program history */
  'factories.bonusProgram': [A, B],

  // ── bonus ─────────────────────────────────────────────────────────────
  /** GET /bonus/wallets · GET /bonus/transactions */
  'bonus.view': [A, B],
  /** POST /bonus/withdraw — cash out through kassa */
  'bonus.withdraw': [A, B],
  /** POST /bonus/offset — apply wallet to factory debt */
  'bonus.offset': [A, B],
  /** POST /bonus/transactions/:id/reverse */
  'bonus.reverse': [A, B],

  // ── pallets ───────────────────────────────────────────────────────────
  /** GET /pallets/balances · /transactions — AGENT scoped read */
  'pallets.view': [A, B, G],
  /** POST /pallets/client-return · /factory-return · /charge-lost */
  'pallets.mutate': [A, B],

  // ── vehicles ──────────────────────────────────────────────────────────
  /** GET /vehicles (list) — AGENT may list (composer picker) */
  'vehicles.view': [A, B, G],
  /** GET /vehicles/:id — driver settlement hub (A/B only) */
  'vehicles.detail': [A, B],
  /** POST/PUT/DELETE /vehicles */
  'vehicles.manage': [A, B],

  // ── agents ────────────────────────────────────────────────────────────
  /** GET /agents (list) */
  'agents.view': [A, B],
  /** GET /agents/me — the AGENT self card (/me, cockpit limit card) */
  'agents.me': [G],
  /** GET /agents/:id — AGENT allowed (own card, service-scoped) */
  'agents.detail': [A, B, G],
  /** POST /agents · PUT /agents/:id */
  'agents.manage': [A, B],
  /** DELETE /agents/:id */
  'agents.delete': [A],

  // ── products & procurement ────────────────────────────────────────────
  /** GET /products — AGENT may list (order composer) */
  'products.view': [A, B, G],
  /** GET/POST /products/:id/prices — price book (versioned) */
  'products.prices': [A, B],
  /** POST/PUT/DELETE /products */
  'products.manage': [A, B],
  /** GET /procurement/matrix · GET /procurement/routes */
  'procurement.view': [A, B],
  /** POST /procurement/routes — new versioned tariff */
  'procurement.createRoute': [A, B],

  // ── references ────────────────────────────────────────────────────────
  /** GET /regions — AGENT may list (client form) */
  'regions.view': [A, B, G],
  /** POST/PUT/DELETE /regions */
  'regions.manage': [A, B],
  /** GET /legal-entities — CASHIER needs payer/receiver pickers */
  'legalEntities.view': [A, B, K],
  /** POST/PUT/DELETE /legal-entities */
  'legalEntities.manage': [A, B],

  // ── dashboard & reports ───────────────────────────────────────────────
  /** GET /dashboard/summary · /trends — AGENT gets scoped variant */
  'dashboard.view': [A, B, G],
  /** GET /dashboard/agents-ranking */
  'dashboard.ranking': [A, B],
  /** GET /dashboard/kassa — the cashier terminal feed */
  'dashboard.kassa': [A, B, K],
  /** GET /reports/svod · /orders-register (+ .xlsx twins) */
  'reports.view': [A, B],

  // ── system ────────────────────────────────────────────────────────────
  /** GET /settings — B gets the read-only view */
  'settings.read': [A, B],
  /** PUT /settings/:key — ADMIN only */
  'settings.write': [A],
  /** GET/POST/PUT/DELETE /users — ADMIN only */
  'users.manage': [A],
  /** POST /import/excel · GET /import/batches(+/:id/reconciliation) ·
   *  DELETE /import/batches/:id — ADMIN ONLY end to end (nav, route, palette) */
  'import.use': [A],
} as const satisfies Record<string, readonly Role[]>;

export type Capability = keyof typeof MATRIX;

/** role → the set of capabilities it holds (derived from MATRIX, never edited by hand) */
export const PERMISSIONS: Record<Role, ReadonlySet<Capability>> = (() => {
  const sets: Record<Role, Set<Capability>> = {
    ADMIN: new Set(),
    ACCOUNTANT: new Set(),
    AGENT: new Set(),
    CASHIER: new Set(),
  };
  for (const cap of Object.keys(MATRIX) as Capability[]) {
    for (const role of MATRIX[cap]) sets[role].add(cap);
  }
  return sets;
})();

/** The one gate every nav item, route guard, and action button asks. */
export function can(role: Role | null | undefined, cap: Capability): boolean {
  if (!role) return false;
  return PERMISSIONS[role].has(cap);
}
