export const ORDER_STATUSES = ['NEW', 'CONFIRMED', 'LOADING', 'DELIVERING', 'DELIVERED', 'COMPLETED'];
export const statusMeta: Record<string, { label: string; tone: any }> = {
  NEW: { label: 'Yangi', tone: 'neutral' },
  CONFIRMED: { label: 'Tasdiqlandi', tone: 'blue' },
  LOADING: { label: 'Yuklanmoqda', tone: 'amber' },
  DELIVERING: { label: 'Yetkazilmoqda', tone: 'violet' },
  DELIVERED: { label: 'Yetkazildi', tone: 'teal' },
  COMPLETED: { label: 'Yakunlandi', tone: 'green' },
  CANCELLED: { label: 'Bekor qilindi', tone: 'red' },
};
