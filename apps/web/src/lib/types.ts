// Backend contract types (v3). Money Decimals arrive as JSON strings — keep
// them as `Money` (string) and format with lib/format; never do JS float math.
export type Money = string;

export type Role = 'ADMIN' | 'ACCOUNTANT' | 'AGENT' | 'CASHIER';

export type OrderStatus =
  | 'NEW'
  | 'CONFIRMED'
  | 'LOADING'
  | 'DELIVERING'
  | 'DELIVERED'
  | 'COMPLETED'
  | 'CANCELLED';

export type TransportMode = 'CLIENT_OWN' | 'DEALER_ABSORBED' | 'DEALER_CHARGED';
export type TransportPaidStatus = 'NOT_APPLICABLE' | 'UNKNOWN' | 'UNPAID' | 'PAID' | 'PAID_BY_CLIENT';
export type PaymentKind =
  | 'CLIENT_IN'
  | 'CLIENT_REFUND'
  | 'FACTORY_OUT'
  | 'FACTORY_REFUND'
  | 'VEHICLE_OUT'
  | 'TRANSPORT_DIRECT';
export type PaymentMethod = 'CASH' | 'BANK' | 'CLICK' | 'TERMINAL' | 'CARD' | 'USD' | 'BONUS';
export type PriceKind = 'FACTORY_CASH' | 'FACTORY_BANK' | 'DEALER_SALE';
export type CostStatus = 'PROVISIONAL' | 'PARTIAL' | 'FINAL';
export type BonusProgramKind = 'NONE' | 'PER_M3' | 'PERCENT';
export type BonusTransactionType = 'ACCRUAL' | 'WITHDRAWAL' | 'DEBT_OFFSET' | 'ADJUSTMENT' | 'REVERSAL';
export type CashDirection = 'IN' | 'OUT';

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PageQuery {
  page?: number;
  pageSize?: number;
  search?: string;
}

export interface AuthUser {
  id: string;
  username: string;
  email?: string | null;
  name: string;
  role: Role;
  agentId: string | null;
}

export interface Region {
  id: string;
  name: string;
  note?: string | null;
}

export interface Agent {
  id: string;
  name: string;
  phone?: string | null;
  sortNo?: number | null;
  debtLimit?: Money | null;
  active: boolean;
  clientCount?: number;
  outstandingDebt?: Money;
}

export interface ClientRow {
  id: string;
  name: string;
  legalEntity?: string | null;
  phone?: string | null;
  regionId?: string | null;
  region?: Region | null;
  agentId?: string | null;
  agent?: { id: string; name: string } | null;
  creditLimit?: Money | null;
  paymentTermDays?: number | null;
  active: boolean;
  balance?: Money;
  palletBalance?: number;
}

export interface Factory {
  id: string;
  name: string;
  note?: string | null;
  active: boolean;
  balance?: Money;
  bonusWallet?: Money;
  palletBalance?: number;
}

export interface Product {
  id: string;
  factoryId: string;
  factory?: { id: string; name: string };
  name: string;
  size?: string | null;
  m3PerPallet: string;
  blocksPerPallet?: number | null;
  unit: string;
  active: boolean;
  prices?: { kind: PriceKind; pricePerM3: Money; effectiveFrom: string }[];
}

export interface Vehicle {
  id: string;
  name: string;
  plate?: string | null;
  driver?: string | null;
  phone?: string | null;
  capacityPallets: number;
  active: boolean;
  balance?: Money;
}

export interface OrderItem {
  id: string;
  productId: string;
  product?: Product;
  quantityM3: string;
  /** actual delivered volume entered at LOADING; null ⇒ actual == planned */
  actualQuantityM3?: string | null;
  palletCount: number;
  palletPrice: Money;
  listPricePerM3?: Money | null;
  salePricePerM3: Money;
  saleTotal: Money;
  pricePending: boolean;
  provisionalPriceKind: PriceKind;
  costPricePerM3: Money;
  finalCostPricePerM3?: Money | null;
  costTotal: Money;
}

export interface Order {
  id: string;
  orderNo: string;
  date: string;
  dueDate?: string | null;
  status: OrderStatus;
  agentId?: string | null;
  agent?: { id: string; name: string } | null;
  clientId: string;
  client?: { id: string; name: string } | null;
  factoryId: string;
  factory?: { id: string; name: string } | null;
  vehicleId?: string | null;
  vehicle?: { id: string; name: string; plate?: string | null } | null;
  driverName?: string | null;
  saleTotal: Money;
  costTotal: Money;
  costStatus: CostStatus;
  transportMode: TransportMode;
  transportCost: Money;
  transportCharge: Money;
  transportPaidStatus: TransportPaidStatus;
  note?: string | null;
  cancelReason?: string | null;
  completedAt?: string | null;
  createdAt: string;
  items?: OrderItem[];
  statusHistory?: { id: string; from?: OrderStatus | null; to: OrderStatus; at: string; by?: { name: string } | null; note?: string | null }[];
  comments?: OrderComment[];
  allocations?: Allocation[];
}

export interface OrderComment {
  id: string;
  text: string;
  createdAt: string;
  by?: { id: string; name: string } | null;
}

// ── Board (doska) ──
export interface BoardOrderRow {
  id: string;
  orderNo: string;
  date: string;
  status: OrderStatus;
  saleTotal: Money;
  costStatus: CostStatus;
  transportPaidStatus: TransportPaidStatus;
  client?: { id: string; name: string } | null;
  agent?: { id: string; name: string } | null;
  factory?: { id: string; name: string } | null;
  vehicle?: { id: string; name: string; plate?: string | null } | null;
  totalM3: string;
  totalPallets: number;
  itemCount: number;
}
export interface BoardLane {
  status: OrderStatus;
  count: number;
  saleTotal: Money;
  totalM3: string;
  totalPallets: number;
  rows: BoardOrderRow[];
}
export interface OrderBoard {
  groups: BoardLane[];
  grand: { count: number; saleTotal: Money; totalM3: string; totalPallets: number };
}

export interface Allocation {
  id: string;
  paymentId: string;
  orderId: string;
  amount: Money;
  priceKind?: PriceKind | null;
  voidedAt?: string | null;
  order?: { id: string; orderNo: string };
  payment?: Payment;
}

export interface Payment {
  id: string;
  date: string;
  kind: PaymentKind;
  method: PaymentMethod;
  amount: Money;
  usdAmount: Money;
  rate: Money;
  clientId?: string | null;
  client?: { id: string; name: string } | null;
  factoryId?: string | null;
  factory?: { id: string; name: string } | null;
  vehicleId?: string | null;
  vehicle?: { id: string; name: string; plate?: string | null } | null;
  agent?: { id: string; name: string } | null;
  cashbox?: Cashbox | null;
  payerName?: string | null;
  receiverName?: string | null;
  note?: string | null;
  voidedAt?: string | null;
  voidReason?: string | null;
  reconciled: boolean;
  allocations?: Allocation[];
}

export interface Cashbox {
  id: string;
  name: string;
  type: 'CASH' | 'BANK' | 'CLICK' | 'TERMINAL' | 'CARD';
  currency: 'UZS' | 'USD';
  active: boolean;
  balance?: Money;
  inTotal?: Money;
  outTotal?: Money;
}

export interface CashTransaction {
  id: string;
  cashboxId: string;
  cashbox?: Cashbox;
  date: string;
  direction: CashDirection;
  amount: Money;
  source: 'MANUAL' | 'PAYMENT' | 'EXPENSE' | 'BONUS_WITHDRAWAL' | 'REVERSAL' | 'TRANSFER' | 'CAPITAL';
  transferPairId?: string | null;
  note?: string | null;
}

export interface KassaSummaryBox {
  id: string;
  name: string;
  type: Cashbox['type'];
  currency: 'UZS' | 'USD';
  active: boolean;
  opening: Money;
  in: Money;
  out: Money;
  closing: Money;
}

export interface KassaSummary {
  dateFrom: string | null;
  dateTo: string | null;
  cashboxes: KassaSummaryBox[];
  totals: { UZS: Money; USD: Money };
  /** all-time sof foyda block (sales − cost + transport margin) for the kassa headline */
  profit: {
    sales: Money;
    cost: Money;
    goodsProfit: Money;
    transportProfit: Money;
    netProfit: Money;
  };
}

export interface Expense {
  id: string;
  date: string;
  amount: Money;
  category?: { id: string; name: string } | null;
  cashbox?: { id: string; name: string } | null;
  note?: string | null;
  voidedAt?: string | null;
}

export interface LegalEntity {
  id: string;
  name: string;
  kind: 'DEALER' | 'FACTORY' | 'THIRD_PARTY';
  inn?: string | null;
  note?: string | null;
  active: boolean;
}

export interface BonusWalletRow {
  factory: { id: string; name: string; active: boolean };
  balance: Money;
}

export interface BonusTransaction {
  id: string;
  at: string;
  type: BonusTransactionType;
  amount: Money;
  baseAmount?: Money | null;
  baseM3?: string | null;
  factory?: { id: string; name: string };
  order?: { id: string; orderNo: string } | null;
  note?: string | null;
}

export interface PalletBalanceRow {
  client: { id: string; name: string };
  balance: number;
}

export interface LedgerEntryRow {
  id: string;
  date: string;
  source: string;
  amount: Money;
  note?: string | null;
  running?: Money;
  order?: { orderNo: string } | null;
  payment?: { kind: PaymentKind; method: PaymentMethod } | null;
}

export interface DashboardSummary {
  todaySales: Money;
  monthSales: Money;
  yearSales: Money;
  ordersInFlight: number;
  clientsOweUs: Money;
  weOweFactories: Money;
  weOweVehicles: Money;
  collectedThisMonth: Money;
  goodsProfitMonth: Money;
  transportProfitMonth: Money;
  bonusWalletsTotal: Money;
  palletsAtClients: number;
  cubeSoldMonth: string;
  expectedCollections: Money;
  [k: string]: unknown;
}
