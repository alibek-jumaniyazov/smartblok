// Typed API client (v3 routes). Decimal money crosses the wire as strings.
import axios from 'axios';
import type {
  AdvanceBucket,
  Agent,
  AuthUser,
  BonusTransaction,
  BonusWalletRow,
  Cashbox,
  CashTransaction,
  ClientRow,
  DashboardSummary,
  CancelMoneyMode,
  FactoryBalanceRow,
  FactoryPayIntent,
  KassaSummary,
  Factory,
  LedgerEntryRow,
  Order,
  OrderComment,
  Paged,
  PageQuery,
  PalletBalanceRow,
  PalletOverview,
  Payment,
  Product,
  Vehicle,
} from './types';

const baseURL = import.meta.env.VITE_API_URL || '/api';
export const api = axios.create({ baseURL });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('sb_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err?.response?.status === 401 && !location.pathname.includes('/login')) {
      localStorage.removeItem('sb_token');
      localStorage.removeItem('sb_user');
      location.href = '/login';
    }
    return Promise.reject(err);
  },
);

/**
 * Human message out of a Nest error payload.
 *
 * Infrastructure failures get named explicitly: axios turns a dead backend into a bare
 * "Network Error" and a crashed DB into an opaque 500, both of which surfaced as a blank
 * red toast that told the user nothing about what to actually fix.
 */
export function apiError(err: unknown): string {
  const e = err as {
    code?: string;
    response?: { status?: number; data?: { message?: string | string[] } };
    message?: string;
  };
  const data = e?.response?.data;
  const m = data?.message;
  if (Array.isArray(m)) return m.join('; ');
  if (m) return m;

  // no response at all ⇒ the API (or the dev proxy) is not answering
  if (!e?.response) {
    if (e?.code === 'ECONNABORTED') return "So'rov vaqti tugadi — backend juda sekin javob berayapti.";
    return "Backend javob bermayapti. Server ishga tushganini tekshiring («npm run dev»).";
  }
  const status = e.response.status;
  if (status === 502 || status === 503 || status === 504) {
    return "Backend javob bermayapti. Server va ma'lumotlar bazasi ishga tushganini tekshiring.";
  }
  if (status === 500) {
    return "Serverda ichki xatolik. Ko'pincha ma'lumotlar bazasi o'chgan bo'ladi — uni tekshiring.";
  }
  return e?.message || 'Xatolik yuz berdi';
}

const g = <T>(url: string, params?: object): Promise<T> => api.get<T>(url, { params }).then((r) => r.data);
const p = <T>(url: string, data?: object): Promise<T> => api.post<T>(url, data).then((r) => r.data);
const pu = <T>(url: string, data?: object): Promise<T> => api.put<T>(url, data).then((r) => r.data);
const pa = <T>(url: string, data?: object): Promise<T> => api.patch<T>(url, data).then((r) => r.data);
const del = <T>(url: string, data?: object): Promise<T> => api.delete<T>(url, { data }).then((r) => r.data);

export const endpoints = {
  // auth
  login: (d: { username: string; password: string }) => p<{ accessToken: string; user: AuthUser }>('/auth/login', d),
  me: () => g<AuthUser>('/auth/me'),
  updateProfile: (d: object) => pu('/auth/me', d),

  // dashboard
  dashboard: (params?: { from?: string; to?: string }) => g<DashboardSummary>('/dashboard/summary', params),
  trends: (days = 30) => g<any>('/dashboard/trends', { days }),
  trendsRange: (params: { from?: string; to?: string }) => g<any>('/dashboard/trends', params),
  agentsRanking: (month?: string) => g<any[]>('/dashboard/agents-ranking', month ? { month } : undefined),
  kassaDashboard: () => g<any>('/dashboard/kassa'),

  // catalog
  agents: () => g<Agent[] | Paged<Agent>>('/agents'),
  agentMe: () => g<Agent>('/agents/me'),
  agent: (id: string) => g<Agent & Record<string, any>>(`/agents/${id}`),
  createAgent: (d: object) => p<Agent>('/agents', d),
  updateAgent: (id: string, d: object) => pu<Agent>(`/agents/${id}`, d),
  deleteAgent: (id: string) => del(`/agents/${id}`),

  clients: (q?: PageQuery & { agentId?: string }) => g<Paged<ClientRow>>('/clients', q),
  client: (id: string) => g<ClientRow & Record<string, any>>(`/clients/${id}`),
  createClient: (d: object) => p<ClientRow>('/clients', d),
  updateClient: (id: string, d: object) => pu<ClientRow>(`/clients/${id}`, d),
  deleteClient: (id: string) => del(`/clients/${id}`),
  addClientAlias: (id: string, name: string) => p(`/clients/${id}/aliases`, { name }),
  deleteClientAlias: (id: string, aliasId: string) => del(`/clients/${id}/aliases/${aliasId}`),
  addClientPrice: (id: string, d: object) => p(`/clients/${id}/prices`, d),
  /** «Balansni nazorat qilish» — off-book manual balance correction (ADMIN). */
  adjustClientBalance: (id: string, d: { amount: string | number; note?: string; date?: string }) =>
    p<{ id: string; balance: string }>(`/clients/${id}/adjust-balance`, d),

  // ⚠ ALWAYS pass paging (like vehicles). Without it the server defaults to pageSize=50 and
  // silently truncates the list — the Factories page filters CLIENT-SIDE, so search/holat
  // (and the Orders/Products factory selects) would miss any factory beyond the 50th.
  factories: () => g<Factory[] | Paged<Factory>>('/factories', { pageSize: 200 }),
  factory: (id: string) => g<Factory & Record<string, any>>(`/factories/${id}`),
  createFactory: (d: object) => p<Factory>('/factories', d),
  updateFactory: (id: string, d: object) => pu<Factory>(`/factories/${id}`, d),
  deleteFactory: (id: string) => del(`/factories/${id}`),
  bonusProgram: (factoryId: string) => g<any>(`/factories/${factoryId}/bonus-program`),
  setBonusProgram: (factoryId: string, d: object) => p(`/factories/${factoryId}/bonus-program`, d),
  /** «Balansni nazorat qilish» — off-book manual balance correction (ADMIN). */
  adjustFactoryBalance: (id: string, d: { amount: string | number; note?: string; date?: string }) =>
    p<Record<string, any>>(`/factories/${id}/adjust-balance`, d),

  products: (q?: { factoryId?: string; page?: number; pageSize?: number; search?: string }) =>
    g<Product[] | Paged<Product>>('/products', q),
  createProduct: (d: object) => p<Product>('/products', d),
  updateProduct: (id: string, d: object) => pu<Product>(`/products/${id}`, d),
  deleteProduct: (id: string) => del(`/products/${id}`),
  productPrices: (id: string) => g<any[]>(`/products/${id}/prices`),
  addProductPrice: (id: string, d: object) => p(`/products/${id}/prices`, d),
  /** noto'g'ri SANA bilan kiritilgan narx versiyasini olib tashlash */
  deleteProductPrice: (id: string, priceId: string) => del(`/products/${id}/prices/${priceId}`),

  // ⚠ ALWAYS pass paging. Without it the server applies its default pageSize=50 and
  // silently truncates the fleet — that is why imported trucks «went missing» from the
  // Moshinalar page and from the order picker.
  vehicles: (q?: PageQuery & { active?: boolean }) => g<Vehicle[] | Paged<Vehicle>>('/vehicles', q),
  vehicle: (id: string) => g<Vehicle & Record<string, any>>(`/vehicles/${id}`),
  createVehicle: (d: object) => p<Vehicle>('/vehicles', d),
  updateVehicle: (id: string, d: object) => pu<Vehicle>(`/vehicles/${id}`, d),
  deleteVehicle: (id: string) => del(`/vehicles/${id}`),

  settings: () => g<Record<string, unknown>>('/settings'),
  setSetting: (key: string, value: unknown) => pu(`/settings/${key}`, { value }),

  // orders
  orders: (q?: PageQuery & { status?: string; paid?: string; clientId?: string; agentId?: string; factoryId?: string; dateFrom?: string; dateTo?: string }) =>
    g<Paged<Order>>('/orders', q),
  order: (id: string) => g<Order>(`/orders/${id}`),
  orderTimeline: (id: string) => g<any[]>(`/orders/${id}/timeline`),
  createOrder: (d: object) => p<Order>('/orders', d),
  updateOrder: (id: string, d: object) => pu<Order>(`/orders/${id}`, d),
  /**
   * Super-admin tahriri: moshina/haydovchi/izoh + buyurtma SANASI (YYYY-MM-DD).
   * Sana ko'chsa server u bilan birga buyurtmaning ledger va poddon qatorlarini ham
   * ko'chiradi (summalar o'zgarmaydi) — shuning uchun chaqiruvchi mijoz/qarz/kassa
   * kabi keshlarni ham yangilashi kerak.
   */
  adminPatchOrder: (
    id: string,
    d: { date?: string; vehicleId?: string | null; driverName?: string | null; note?: string | null },
  ) => pa<Order>(`/orders/${id}/admin`, d),
  setOrderStatus: (id: string, to: string, note?: string) => pa<Order>(`/orders/${id}/status`, { to, note }),
  // mode: REFUND — mijozga to'lagani naqd qaytadi + shofyorga bergani balansida kredit;
  //       VOID_ALL — shu buyurtmaning HAMMA to'lovi yo'qoladi (mijoz balansi ham 0).
  cancelOrder: (id: string, reason: string, mode: CancelMoneyMode = 'REFUND') =>
    del<Order>(`/orders/${id}`, { reason, mode }),
  applyActualLoading: (id: string, items: { itemId: string; actualQuantityM3: number | string }[]) =>
    p<Order>(`/orders/${id}/actual-loading`, { items }),
  priceOrderItem: (orderId: string, itemId: string, d: object) => pa<Order>(`/orders/${orderId}/items/${itemId}/price`, d),
  adminRepriceOrderItem: (orderId: string, itemId: string, d: object) => pa<Order>(`/orders/${orderId}/items/${itemId}/admin-price`, d),
  orderComments: (id: string) => g<OrderComment[]>(`/orders/${id}/comments`),
  addOrderComment: (id: string, text: string) => p<OrderComment>(`/orders/${id}/comments`, { text }),
  /**
   * «AVANSDAN YECHISH» — money standing at the factory NEVER settles an order by itself
   * (owner rule R2); this is the only door. The bucket picked fixes the price basis of
   * the slice it buys, so it is a pricing decision, not just a transfer.
   * `amount` omitted ⇒ draw as much as the order needs and the channel holds.
   */
  drawFactoryAdvance: (
    id: string,
    d: { bucket: AdvanceBucket; amount?: string | number; date?: string; note?: string },
  ) => p<Order>(`/orders/${id}/factory-advance-draw`, d),
  setFactoryPayIntent: (id: string, factoryPayIntent: FactoryPayIntent) =>
    pa<Order>(`/orders/${id}/factory-pay-intent`, { factoryPayIntent }),

  // payments
  payments: (q?: PageQuery & { kind?: string; method?: string; clientId?: string; agentId?: string; factoryId?: string; dateFrom?: string; dateTo?: string; voided?: boolean; reconciled?: boolean }) =>
    g<Paged<Payment>>('/payments', q),
  payment: (id: string) => g<Payment>(`/payments/${id}`),
  createPayment: (d: object) => p<Payment>('/payments', d),
  allocatePayment: (id: string, allocations: { orderId: string; amount: string | number }[]) =>
    p<Payment>(`/payments/${id}/allocations`, { allocations }),
  voidPayment: (id: string, reason: string) => p<Payment>(`/payments/${id}/void`, { reason }),
  /** Undo ONE settlement — the money goes back to the advance channel it came from (R5). */
  voidAllocation: (paymentId: string, allocationId: string, reason: string) =>
    p<Payment>(`/payments/${paymentId}/allocations/${allocationId}/void`, { reason }),

  // pallets
  // Every row now carries its FULL all-time history (`stats`), not just the netted
  // balance, plus a company-wide `totals` roll-up. An AGENT gets the same shape scoped
  // to his own clients: `factories`/`dealerInHand` are company liabilities he must not
  // see, so they come back absent/zero and `totals` holds only his client column.
  palletBalances: () =>
    g<{
      clients: PalletBalanceRow[];
      factories?: FactoryBalanceRow[];
      dealerInHand?: number;
      totals: PalletOverview;
    }>('/pallets/balances'),
  palletTransactions: (q?: PageQuery & { clientId?: string; factoryId?: string }) => g<Paged<any>>('/pallets/transactions', q),
  palletClientReturn: (d: object) => p('/pallets/client-return', d),
  palletFactoryReturn: (d: object) => p('/pallets/factory-return', d),
  palletChargeLost: (d: object) => p('/pallets/charge-lost', d),

  // bonus
  bonusWallets: () => g<BonusWalletRow[]>('/bonus/wallets'),
  bonusTransactions: (q?: PageQuery & { factoryId?: string }) => g<Paged<BonusTransaction>>('/bonus/transactions', q),
  bonusWithdraw: (d: object) => p('/bonus/withdraw', d),
  bonusOffset: (d: object) => p('/bonus/offset', d),
  bonusReverse: (id: string, reason: string) => p(`/bonus/transactions/${id}/reverse`, { reason }),

  // kassa / expenses
  cashboxes: () => g<Cashbox[]>('/kassa/cashboxes'),
  createCashbox: (d: { name: string; type: string; currency?: string }) => p<Cashbox>('/kassa/cashboxes', d),
  updateCashbox: (id: string, d: { name?: string; active?: boolean }) => pu<Cashbox>(`/kassa/cashboxes/${id}`, d),
  deleteCashbox: (id: string) => del<Cashbox>(`/kassa/cashboxes/${id}`),
  /** «Kassa balansini tahrirlash» — set the box to an EXACT balance (not a delta; the server
   *  diffs against the live figure under a lock). Off-book: moves the balance, never counts as
   *  kirim/chiqim. ADMIN only. */
  setCashboxBalance: (id: string, d: { balance: string | number; note?: string; date?: string }) =>
    p<Cashbox & { balance: string; delta: string }>(`/kassa/cashboxes/${id}/balance`, d),
  // `factoryId` / `clientId` scope the whole-system journal to one party — that is what
  // the factory and client hubs' «To'lovlar» tabs render.
  kassaTransactions: (q?: PageQuery & { cashboxId?: string; factoryId?: string; clientId?: string; scope?: 'cash' | 'bank'; direction?: string; source?: string; dateFrom?: string; dateTo?: string }) =>
    g<Paged<CashTransaction>>('/kassa/transactions', q),
  kassaManual: (d: object) => p('/kassa/manual', d),
  kassaTransfer: (d: { fromCashboxId: string; toCashboxId: string; amount: string | number; date?: string; note?: string }) =>
    p('/kassa/transfer', d),
  kassaReverse: (id: string, reason: string) => p(`/kassa/transactions/${id}/reverse`, { reason }),
  kassaSummary: (q?: { dateFrom?: string; dateTo?: string }) => g<KassaSummary>('/kassa/summary', q),

  // debts
  debtsSummary: () => g<Record<string, any>>('/debts/summary'),
  debtsClients: (q?: PageQuery & { days?: number; dir?: 'debt' | 'avans' }) =>
    g<Paged<any>>('/debts/clients', q),
  /** ochiq zavod qarzi — BUYURTMA darajasida (server yakunlari bilan) */
  debtsFactoryOrders: (q?: PageQuery & { intent?: FactoryPayIntent; factoryId?: string }) =>
    g<any>('/debts/factory-orders', q),
  debtsStatement: (q: { account: 'CLIENT' | 'FACTORY' | 'VEHICLE'; partyId: string; from?: string; to?: string }) =>
    g<any>('/debts/statement', q),

  // export — butun bazani bitta Excel faylga (ADMIN + BUXGALTER)
  exportXlsx: (params?: { from?: string; to?: string }) => downloadFile('/export/xlsx', params),

  // users
  users: () => g<AuthUser[]>('/users'),
  createUser: (d: object) => p<AuthUser>('/users', d),
  updateUser: (id: string, d: object) => pu<AuthUser>(`/users/${id}`, d),
  deleteUser: (id: string) => del(`/users/${id}`),
};

/** normalizes list endpoints that may return either an array or a Paged */
export function asItems<T>(data: T[] | Paged<T> | undefined | null): T[] {
  if (!data) return [];
  return Array.isArray(data) ? data : (data.items ?? []);
}

/**
 * Xatolik matnini blob javobdan o'qiydi.
 *
 * `responseType: 'blob'` bilan axios xato JSON'ini ham Blob qilib o'raydi, shuning
 * uchun {@link apiError} u yerdan `message` ni topa olmaydi va «Request failed with
 * status code 500» deb qaytaradi — yoki bundan yomoni, 500 uchun «ma'lumotlar bazasi
 * o'chgan bo'lsa kerak» degan tayyor matnni beradi, holbuki baza tirik. Shuning
 * uchun yuklab olish xatolari SHU funksiyadan o'tkaziladi.
 */
export async function blobError(err: unknown): Promise<string> {
  const data = (err as { response?: { data?: unknown } })?.response?.data;
  if (data instanceof Blob) {
    try {
      const text = await data.text();
      const parsed = JSON.parse(text) as { message?: string | string[] };
      const m = parsed?.message;
      if (Array.isArray(m)) return m.join('; ');
      if (m) return m;
    } catch {
      /* JSON emas — pastdagi umumiy matnga tushamiz */
    }
  }
  return apiError(err);
}

/** Content-Disposition dan fayl nomi: avval RFC 5987 (`filename*`), keyin oddiy `filename`. */
function filenameFrom(disposition: string, fallback: string): string {
  const star = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  if (star) {
    try {
      return decodeURIComponent(star);
    } catch {
      /* buzuq kodlash — oddiy variantga o'tamiz */
    }
  }
  return /filename="?([^";]+)"?/.exec(disposition)?.[1] || fallback;
}

/**
 * Autentifikatsiyalangan faylni (xlsx) yuklab oladi va brauzerda saqlashni boshlaydi.
 *
 * Oddiy `<a href>` yoki `window.open()` BU YERDA ISHLAMAYDI: token localStorage'da
 * turadi va brauzer o'zi boshlagan navigatsiyaga `Authorization` sarlavhasini
 * qo'shmaydi — so'rov 401 qaytaradi. Shuning uchun fayl axios orqali olinadi.
 */
export async function downloadFile(url: string, params?: object, fallbackName = 'export.xlsx'): Promise<void> {
  const res = await api.get(url, { params, responseType: 'blob' });
  const name = filenameFrom((res.headers['content-disposition'] as string) || '', fallbackName);

  const href = URL.createObjectURL(res.data as Blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = name;
  // DOM'ga qo'shish shart: ba'zi brauzerlar hujjatga ulanmagan havolaning
  // bosilishini e'tiborsiz qoldiradi.
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // URL'ni DARHOL bo'shatib bo'lmaydi — Firefox va Safari yuklash boshlanishidan
  // oldin blob yo'q qilinsa saqlashni bekor qiladi.
  setTimeout(() => URL.revokeObjectURL(href), 60_000);
}
