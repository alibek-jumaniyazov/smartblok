import { useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Avatar, Dropdown, Layout, Menu, Space, Switch, Typography, theme as antdTheme } from 'antd';
import {
  ApartmentOutlined,
  AppstoreOutlined,
  BankOutlined,
  BarChartOutlined,
  CarOutlined,
  ContainerOutlined,
  DashboardOutlined,
  DollarOutlined,
  GiftOutlined,
  GoldOutlined,
  LogoutOutlined,
  MoonOutlined,
  SettingOutlined,
  ShopOutlined,
  ShoppingCartOutlined,
  SunOutlined,
  TeamOutlined,
  UserOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import { useAuth } from '../auth/AuthContext';
import { useThemeMode } from './ThemeContext';
import type { Role } from '../lib/types';

interface NavItem {
  key: string;
  label: string;
  icon?: React.ReactNode;
  roles: Role[];
  children?: NavItem[];
}

const NAV: NavItem[] = [
  { key: '/', label: 'Boshqaruv paneli', icon: <DashboardOutlined />, roles: ['ADMIN', 'ACCOUNTANT', 'AGENT', 'CASHIER'] },
  { key: '/orders', label: 'Buyurtmalar', icon: <ShoppingCartOutlined />, roles: ['ADMIN', 'ACCOUNTANT', 'AGENT'] },
  { key: '/clients', label: 'Mijozlar', icon: <TeamOutlined />, roles: ['ADMIN', 'ACCOUNTANT', 'AGENT'] },
  { key: '/payments', label: "To'lovlar", icon: <DollarOutlined />, roles: ['ADMIN', 'ACCOUNTANT', 'AGENT', 'CASHIER'] },
  { key: '/debts', label: 'Qarzlar', icon: <WalletOutlined />, roles: ['ADMIN', 'ACCOUNTANT', 'AGENT'] },
  { key: '/pallets', label: 'Paddonlar', icon: <ContainerOutlined />, roles: ['ADMIN', 'ACCOUNTANT', 'AGENT'] },
  { key: '/kassa', label: 'Kassa', icon: <BankOutlined />, roles: ['ADMIN', 'ACCOUNTANT', 'CASHIER'] },
  { key: '/expenses', label: 'Xarajatlar', icon: <GoldOutlined />, roles: ['ADMIN', 'ACCOUNTANT', 'CASHIER'] },
  { key: '/bonus', label: 'Bonus hamyonlar', icon: <GiftOutlined />, roles: ['ADMIN', 'ACCOUNTANT'] },
  {
    key: 'catalog',
    label: 'Katalog',
    icon: <AppstoreOutlined />,
    roles: ['ADMIN', 'ACCOUNTANT'],
    children: [
      { key: '/factories', label: 'Zavodlar', icon: <ShopOutlined />, roles: ['ADMIN', 'ACCOUNTANT'] },
      { key: '/products', label: 'Mahsulotlar', roles: ['ADMIN', 'ACCOUNTANT'] },
      { key: '/vehicles', label: 'Moshinalar', icon: <CarOutlined />, roles: ['ADMIN', 'ACCOUNTANT'] },
      { key: '/agents', label: 'Agentlar', roles: ['ADMIN', 'ACCOUNTANT'] },
      { key: '/regions', label: 'Hududlar', roles: ['ADMIN', 'ACCOUNTANT'] },
      { key: '/legal-entities', label: 'Yuridik shaxslar', roles: ['ADMIN', 'ACCOUNTANT'] },
    ],
  },
  { key: '/reports', label: 'Hisobotlar', icon: <BarChartOutlined />, roles: ['ADMIN', 'ACCOUNTANT'] },
  { key: '/procurement', label: "Ta'minot matritsasi", icon: <ApartmentOutlined />, roles: ['ADMIN', 'ACCOUNTANT'] },
  {
    key: 'admin',
    label: 'Boshqaruv',
    icon: <SettingOutlined />,
    roles: ['ADMIN'],
    children: [
      { key: '/users', label: 'Foydalanuvchilar', roles: ['ADMIN'] },
      { key: '/settings', label: 'Tizim sozlamalari', roles: ['ADMIN'] },
    ],
  },
];

function filterNav(items: NavItem[], role: Role): NavItem[] {
  return items
    .filter((i) => i.roles.includes(role))
    .map((i) => (i.children ? { ...i, children: filterNav(i.children, role) } : i));
}

export default function AppShell() {
  const { user, logout } = useAuth();
  const { mode, toggle } = useThemeMode();
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { token } = antdTheme.useToken();

  const items = useMemo(() => (user ? filterNav(NAV, user.role) : []), [user]);
  const selected = '/' + (location.pathname.split('/')[1] ?? '');

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Sider collapsible collapsed={collapsed} onCollapse={setCollapsed} width={232} theme="dark">
        <div
          style={{
            height: 52,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            color: '#fff',
            fontWeight: 700,
            fontSize: collapsed ? 14 : 17,
            letterSpacing: 0.3,
          }}
        >
          🧱 {!collapsed && 'SmartBlok'}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selected === '/' ? '/' : location.pathname, selected]}
          items={items as never}
          onClick={({ key }) => key.startsWith('/') && navigate(key)}
        />
      </Layout.Sider>
      <Layout>
        <Layout.Header
          style={{
            background: token.colorBgContainer,
            padding: '0 20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 16,
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
            height: 52,
            lineHeight: '52px',
          }}
        >
          <Switch
            checked={mode === 'dark'}
            onChange={toggle}
            checkedChildren={<MoonOutlined />}
            unCheckedChildren={<SunOutlined />}
            aria-label="Tema"
          />
          <Dropdown
            menu={{
              items: [
                { key: 'profile', icon: <UserOutlined />, label: 'Profil', onClick: () => navigate('/profile') },
                { type: 'divider' },
                { key: 'logout', icon: <LogoutOutlined />, label: 'Chiqish', onClick: logout },
              ],
            }}
          >
            <Space style={{ cursor: 'pointer' }}>
              <Avatar size="small" style={{ background: token.colorPrimary }}>
                {user?.name?.[0] ?? '?'}
              </Avatar>
              <Typography.Text strong>{user?.name}</Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {user?.role}
              </Typography.Text>
            </Space>
          </Dropdown>
        </Layout.Header>
        <Layout.Content style={{ padding: 20 }}>
          <Outlet />
        </Layout.Content>
      </Layout>
    </Layout>
  );
}
