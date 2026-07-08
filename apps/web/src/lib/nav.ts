import {
  LayoutDashboard, ShoppingCart, Wallet, Users, UserCog, Factory,
  Package, Landmark, ClipboardList, Shield, Upload, type LucideIcon,
} from 'lucide-react';

export type Role = 'ADMIN' | 'ACCOUNTANT' | 'AGENT' | 'CASHIER';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  roles: Role[];
}
export interface NavGroup {
  title: string;
  items: NavItem[];
}

const ALL: Role[] = ['ADMIN', 'ACCOUNTANT', 'AGENT', 'CASHIER'];

export const navGroups: NavGroup[] = [
  {
    title: 'UMUMIY',
    items: [
      { to: '/', label: 'Boshqaruv paneli', icon: LayoutDashboard, roles: ALL },
    ],
  },
  {
    title: 'SAVDO',
    items: [
      { to: '/sales', label: 'Sotuvlar', icon: ShoppingCart, roles: ['ADMIN', 'ACCOUNTANT', 'AGENT'] },
      { to: '/payments', label: "To'lovlar", icon: Wallet, roles: ['ADMIN', 'ACCOUNTANT', 'AGENT', 'CASHIER'] },
      { to: '/clients', label: 'Mijozlar', icon: Users, roles: ['ADMIN', 'ACCOUNTANT', 'AGENT'] },
      { to: '/agents', label: 'Agentlar', icon: UserCog, roles: ['ADMIN', 'ACCOUNTANT'] },
    ],
  },
  {
    title: 'KATALOG',
    items: [
      { to: '/procurement', label: 'Zavod narxlari', icon: Factory, roles: ['ADMIN', 'ACCOUNTANT'] },
      { to: '/pallets', label: 'Poddonlar', icon: Package, roles: ['ADMIN', 'ACCOUNTANT', 'AGENT'] },
    ],
  },
  {
    title: 'MOLIYA',
    items: [
      { to: '/kassa', label: 'Kassalar', icon: Landmark, roles: ['ADMIN', 'ACCOUNTANT', 'CASHIER'] },
    ],
  },
  {
    title: 'HISOBOTLAR',
    items: [
      { to: '/reports', label: 'Hisobot (Svod)', icon: ClipboardList, roles: ['ADMIN', 'ACCOUNTANT'] },
    ],
  },
  {
    title: 'TIZIM',
    items: [
      { to: '/users', label: 'Foydalanuvchilar', icon: Shield, roles: ['ADMIN'] },
      { to: '/import', label: 'Excel import', icon: Upload, roles: ['ADMIN', 'ACCOUNTANT'] },
    ],
  },
];

export const routeLabels: Record<string, string> = {
  '/': 'Boshqaruv paneli',
  '/sales': 'Sotuvlar',
  '/payments': "To'lovlar",
  '/clients': 'Mijozlar',
  '/agents': 'Agentlar',
  '/procurement': 'Zavod narxlari',
  '/pallets': 'Poddonlar',
  '/kassa': 'Kassalar',
  '/reports': 'Hisobot',
  '/users': 'Foydalanuvchilar',
  '/import': 'Excel import',
};

export function visibleGroups(role: string | undefined): NavGroup[] {
  return navGroups
    .map((g) => ({ ...g, items: g.items.filter((i) => !role || i.roles.includes(role as Role)) }))
    .filter((g) => g.items.length > 0);
}
