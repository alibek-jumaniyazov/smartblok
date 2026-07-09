import {
  LayoutDashboard, ClipboardList, Users, UserCog, Factory, Package, Truck,
  Calculator, Wallet, Scale, Receipt, Landmark, BarChart3, Shield, Upload, type LucideIcon,
} from 'lucide-react';

export type Role = 'ADMIN' | 'ACCOUNTANT' | 'AGENT' | 'CASHIER';
export interface NavItem { to: string; label: string; icon: LucideIcon; roles: Role[]; }
export interface NavGroup { title: string; items: NavItem[]; }
const ALL: Role[] = ['ADMIN', 'ACCOUNTANT', 'AGENT', 'CASHIER'];

export const navGroups: NavGroup[] = [
  { title: 'UMUMIY', items: [
    { to: '/', label: 'Boshqaruv paneli', icon: LayoutDashboard, roles: ALL },
  ] },
  { title: 'SAVDO', items: [
    { to: '/orders', label: 'Buyurtmalar', icon: ClipboardList, roles: ['ADMIN', 'ACCOUNTANT', 'AGENT'] },
    { to: '/clients', label: 'Mijozlar', icon: Users, roles: ['ADMIN', 'ACCOUNTANT', 'AGENT'] },
    { to: '/agents', label: 'Agentlar', icon: UserCog, roles: ['ADMIN', 'ACCOUNTANT'] },
  ] },
  { title: 'KATALOG', items: [
    { to: '/factories', label: 'Zavodlar', icon: Factory, roles: ['ADMIN', 'ACCOUNTANT'] },
    { to: '/products', label: 'Mahsulotlar', icon: Package, roles: ['ADMIN', 'ACCOUNTANT'] },
    { to: '/vehicles', label: 'Moshinalar', icon: Truck, roles: ['ADMIN', 'ACCOUNTANT'] },
    { to: '/procurement', label: 'Tannarx matritsasi', icon: Calculator, roles: ['ADMIN', 'ACCOUNTANT'] },
  ] },
  { title: 'MOLIYA', items: [
    { to: '/payments', label: "To'lovlar", icon: Wallet, roles: ['ADMIN', 'ACCOUNTANT', 'AGENT', 'CASHIER'] },
    { to: '/debts', label: 'Qarzlar', icon: Scale, roles: ['ADMIN', 'ACCOUNTANT'] },
    { to: '/expenses', label: 'Xarajatlar', icon: Receipt, roles: ['ADMIN', 'ACCOUNTANT', 'CASHIER'] },
    { to: '/kassa', label: 'Kassalar', icon: Landmark, roles: ['ADMIN', 'ACCOUNTANT', 'CASHIER'] },
  ] },
  { title: 'HISOBOTLAR', items: [
    { to: '/reports', label: 'Hisobot', icon: BarChart3, roles: ['ADMIN', 'ACCOUNTANT'] },
  ] },
  { title: 'TIZIM', items: [
    { to: '/users', label: 'Foydalanuvchilar', icon: Shield, roles: ['ADMIN'] },
    { to: '/import', label: 'Excel import', icon: Upload, roles: ['ADMIN', 'ACCOUNTANT'] },
  ] },
];

export const routeLabels: Record<string, string> = {
  '/': 'Boshqaruv paneli', '/orders': 'Buyurtmalar', '/clients': 'Mijozlar', '/agents': 'Agentlar',
  '/factories': 'Zavodlar', '/products': 'Mahsulotlar', '/vehicles': 'Moshinalar', '/procurement': 'Tannarx matritsasi',
  '/payments': "To'lovlar", '/debts': 'Qarzlar', '/expenses': 'Xarajatlar', '/kassa': 'Kassalar',
  '/reports': 'Hisobot', '/users': 'Foydalanuvchilar', '/import': 'Excel import', '/profile': 'Profil',
};

export function visibleGroups(role: string | undefined): NavGroup[] {
  return navGroups
    .map((grp) => ({ ...grp, items: grp.items.filter((i) => !role || i.roles.includes(role as Role)) }))
    .filter((grp) => grp.items.length > 0);
}
