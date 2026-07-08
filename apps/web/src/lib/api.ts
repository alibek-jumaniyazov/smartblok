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
      localStorage.removeItem('sb_token');
      localStorage.removeItem('sb_user');
      location.href = '/login';
    }
    return Promise.reject(err);
  },
);

export const endpoints = {
  login: (data: any) => api.post('/auth/login', data).then((r) => r.data),
  me: () => api.get('/auth/me').then((r) => r.data),
  updateProfile: (data: any) => api.put('/auth/me', data).then((r) => r.data),

  dashboard: () => api.get('/dashboard/summary').then((r) => r.data),
  salesTrend: () => api.get('/dashboard/sales-trend').then((r) => r.data),
  agentPerformance: () => api.get('/dashboard/agent-performance').then((r) => r.data),

  agents: () => api.get('/agents').then((r) => r.data),
  clients: () => api.get('/clients').then((r) => r.data),
  regions: () => api.get('/regions').then((r) => r.data),
  blockSizes: () => api.get('/block-sizes').then((r) => r.data),
  factories: () => api.get('/factories').then((r) => r.data),

  sales: (params?: any) => api.get('/sales', { params }).then((r) => r.data),
  createSale: (data: any) => api.post('/sales', data).then((r) => r.data),
  deleteSale: (id: number) => api.delete(`/sales/${id}`).then((r) => r.data),

  payments: (params?: any) => api.get('/payments', { params }).then((r) => r.data),
  createPayment: (data: any) => api.post('/payments', data).then((r) => r.data),
  deletePayment: (id: number) => api.delete(`/payments/${id}`).then((r) => r.data),

  matrix: (regionId: number) => api.get('/procurement/matrix', { params: { regionId } }).then((r) => r.data),

  pallets: () => api.get('/pallets/summary').then((r) => r.data),
  createPalletReturn: (data: any) => api.post('/pallets/return', data).then((r) => r.data),

  factoryPayments: () => api.get('/factory-payments').then((r) => r.data),

  statement: (id: number) => api.get(`/reports/client/${id}/statement`).then((r) => r.data),
  svod: () => api.get('/reports/svod').then((r) => r.data),

  // users
  users: () => api.get('/users').then((r) => r.data),
  createUser: (data: any) => api.post('/users', data).then((r) => r.data),
  updateUser: (id: number, data: any) => api.put(`/users/${id}`, data).then((r) => r.data),
  deleteUser: (id: number) => api.delete(`/users/${id}`).then((r) => r.data),

  // kassa
  kassaSummary: () => api.get('/kassa/summary').then((r) => r.data),
  kassaTransactions: (cashboxId?: number) => api.get('/kassa/transactions', { params: cashboxId ? { cashboxId } : {} }).then((r) => r.data),
  createKassaTx: (data: any) => api.post('/kassa/transactions', data).then((r) => r.data),
  createCashbox: (data: any) => api.post('/kassa/cashboxes', data).then((r) => r.data),
  deleteKassaTx: (id: number) => api.delete(`/kassa/transactions/${id}`).then((r) => r.data),

  // import
  importExcel: (file: File, replace: boolean) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post(`/import/excel?replace=${replace}`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data);
  },
};
