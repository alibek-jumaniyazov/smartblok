import axios from 'axios';

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
      localStorage.removeItem('sb_token'); localStorage.removeItem('sb_user'); location.href = '/login';
    }
    return Promise.reject(err);
  },
);

const g = (url: string, params?: any) => api.get(url, { params }).then((r) => r.data);
const p = (url: string, data?: any) => api.post(url, data).then((r) => r.data);
const pu = (url: string, data?: any) => api.put(url, data).then((r) => r.data);
const pa = (url: string, data?: any) => api.patch(url, data).then((r) => r.data);
const del = (url: string) => api.delete(url).then((r) => r.data);

export const endpoints = {
  login: (d: any) => p('/auth/login', d),
  me: () => g('/auth/me'),
  updateProfile: (d: any) => pu('/auth/me', d),

  dashboard: () => g('/dashboard/summary'),
  salesTrend: () => g('/dashboard/sales-trend'),
  agentPerformance: () => g('/dashboard/agent-performance'),
  orderFunnel: () => g('/dashboard/order-funnel'),

  agents: () => g('/agents'),
  agent: (id: string) => g(`/agents/${id}`),
  createAgent: (d: any) => p('/agents', d),
  updateAgent: (id: string, d: any) => pu(`/agents/${id}`, d),
  deleteAgent: (id: string) => del(`/agents/${id}`),

  clients: () => g('/clients'),
  client: (id: string) => g(`/clients/${id}`),
  createClient: (d: any) => p('/clients', d),
  updateClient: (id: string, d: any) => pu(`/clients/${id}`, d),
  deleteClient: (id: string) => del(`/clients/${id}`),

  regions: () => g('/regions'),
  createRegion: (d: any) => p('/regions', d),

  factories: () => g('/factories'),
  factory: (id: string) => g(`/factories/${id}`),
  createFactory: (d: any) => p('/factories', d),
  updateFactory: (id: string, d: any) => pu(`/factories/${id}`, d),
  deleteFactory: (id: string) => del(`/factories/${id}`),

  products: (factoryId?: string) => g('/products', factoryId ? { factoryId } : undefined),
  createProduct: (d: any) => p('/products', d),
  updateProduct: (id: string, d: any) => pu(`/products/${id}`, d),
  deleteProduct: (id: string) => del(`/products/${id}`),

  vehicles: () => g('/vehicles'),
  vehicle: (id: string) => g(`/vehicles/${id}`),
  createVehicle: (d: any) => p('/vehicles', d),
  updateVehicle: (id: string, d: any) => pu(`/vehicles/${id}`, d),
  deleteVehicle: (id: string) => del(`/vehicles/${id}`),

  orders: (params?: any) => g('/orders', params),
  order: (id: string) => g(`/orders/${id}`),
  createOrder: (d: any) => p('/orders', d),
  updateOrder: (id: string, d: any) => pu(`/orders/${id}`, d),
  advanceOrder: (id: string) => pa(`/orders/${id}/advance`),
  setOrderStatus: (id: string, status: string) => pa(`/orders/${id}/status`, { status }),
  deleteOrder: (id: string) => del(`/orders/${id}`),

  payments: (params?: any) => g('/payments', params),
  createPayment: (d: any) => p('/payments', d),
  deletePayment: (id: string) => del(`/payments/${id}`),

  debts: () => g('/debts/summary'),

  expenses: () => g('/expenses'),
  expenseSummary: () => g('/expenses/summary'),
  expenseCategories: () => g('/expenses/categories'),
  createExpense: (d: any) => p('/expenses', d),
  createExpenseCategory: (d: any) => p('/expenses/categories', d),
  deleteExpense: (id: string) => del(`/expenses/${id}`),

  matrix: (regionId: string) => g('/procurement/matrix', { regionId }),
  svod: () => g('/reports/svod'),

  kassaSummary: () => g('/kassa/summary'),
  kassaTransactions: (cashboxId?: string) => g('/kassa/transactions', cashboxId ? { cashboxId } : undefined),
  createKassaTx: (d: any) => p('/kassa/transactions', d),
  deleteKassaTx: (id: string) => del(`/kassa/transactions/${id}`),

  users: () => g('/users'),
  createUser: (d: any) => p('/users', d),
  updateUser: (id: string, d: any) => pu(`/users/${id}`, d),
  deleteUser: (id: string) => del(`/users/${id}`),

  importExcel: (file: File, replace: boolean) => {
    const fd = new FormData(); fd.append('file', file);
    return api.post(`/import/excel?replace=${replace}`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data);
  },
};
