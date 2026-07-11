import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input, List, Modal, Tag, Typography } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useAuth } from '../auth/AuthContext';
import type { Role } from '../lib/types';

interface Cmd {
  label: string;
  hint?: string;
  path: string;
  roles: Role[];
  keywords: string;
}

const COMMANDS: Cmd[] = [
  { label: 'Boshqaruv paneli', path: '/', roles: ['ADMIN', 'ACCOUNTANT', 'AGENT', 'CASHIER'], keywords: 'dashboard panel boshqaruv' },
  { label: 'Yangi buyurtma', hint: 'buyurtma yaratish', path: '/orders/new', roles: ['ADMIN', 'ACCOUNTANT', 'AGENT'], keywords: 'new order yangi buyurtma yaratish' },
  { label: 'Buyurtmalar', path: '/orders', roles: ['ADMIN', 'ACCOUNTANT', 'AGENT'], keywords: 'orders buyurtma zakaz' },
  { label: 'Mijozlar', path: '/clients', roles: ['ADMIN', 'ACCOUNTANT', 'AGENT'], keywords: 'clients mijoz klient' },
  { label: "To'lovlar", path: '/payments', roles: ['ADMIN', 'ACCOUNTANT', 'AGENT', 'CASHIER'], keywords: 'payments tolov oplata pul' },
  { label: 'Qarzlar', path: '/debts', roles: ['ADMIN', 'ACCOUNTANT', 'AGENT'], keywords: 'debts qarz balans' },
  { label: 'Paddonlar', path: '/pallets', roles: ['ADMIN', 'ACCOUNTANT', 'AGENT'], keywords: 'pallets paddon poddon' },
  { label: 'Kassa', path: '/kassa', roles: ['ADMIN', 'ACCOUNTANT', 'CASHIER'], keywords: 'kassa cash naqd' },
  { label: 'Xarajatlar', path: '/expenses', roles: ['ADMIN', 'ACCOUNTANT', 'CASHIER'], keywords: 'expenses xarajat rasxod' },
  { label: 'Bonus hamyonlar', path: '/bonus', roles: ['ADMIN', 'ACCOUNTANT'], keywords: 'bonus hamyon wallet' },
  { label: 'Zavodlar', path: '/factories', roles: ['ADMIN', 'ACCOUNTANT'], keywords: 'factories zavod' },
  { label: 'Mahsulotlar', path: '/products', roles: ['ADMIN', 'ACCOUNTANT'], keywords: 'products mahsulot gazoblok narx' },
  { label: 'Moshinalar', path: '/vehicles', roles: ['ADMIN', 'ACCOUNTANT'], keywords: 'vehicles moshina avto truck' },
  { label: 'Agentlar', path: '/agents', roles: ['ADMIN', 'ACCOUNTANT'], keywords: 'agents agent' },
  { label: 'Hududlar', path: '/regions', roles: ['ADMIN', 'ACCOUNTANT'], keywords: 'regions hudud region' },
  { label: 'Yuridik shaxslar', path: '/legal-entities', roles: ['ADMIN', 'ACCOUNTANT'], keywords: 'legal entity yuridik firma' },
  { label: 'Hisobotlar', path: '/reports', roles: ['ADMIN', 'ACCOUNTANT'], keywords: 'reports hisobot svod' },
  { label: 'Excel import', path: '/import', roles: ['ADMIN', 'ACCOUNTANT'], keywords: 'import excel migratsiya' },
  { label: "Ta'minot matritsasi", path: '/procurement', roles: ['ADMIN', 'ACCOUNTANT'], keywords: 'procurement taminot tannarx matritsa' },
  { label: 'Foydalanuvchilar', path: '/users', roles: ['ADMIN'], keywords: 'users foydalanuvchi login' },
  { label: 'Tizim sozlamalari', path: '/settings', roles: ['ADMIN'], keywords: 'settings sozlama limit' },
  { label: 'Profil', path: '/profile', roles: ['ADMIN', 'ACCOUNTANT', 'AGENT', 'CASHIER'], keywords: 'profile profil parol' },
];

/** Ctrl+K / ⌘K command palette — keyboard-first navigation across the ERP. */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
        setQ('');
        setActive(0);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const results = useMemo(() => {
    if (!user) return [];
    const allowed = COMMANDS.filter((c) => c.roles.includes(user.role));
    const needle = q.trim().toLowerCase();
    if (!needle) return allowed;
    return allowed.filter((c) => (c.label + ' ' + c.keywords).toLowerCase().includes(needle));
  }, [q, user]);

  const go = (cmd: Cmd) => {
    setOpen(false);
    navigate(cmd.path);
  };

  return (
    <Modal
      open={open}
      onCancel={() => setOpen(false)}
      footer={null}
      closable={false}
      width={560}
      style={{ top: 96 }}
      styles={{ body: { padding: 8 } }}
      destroyOnHidden
    >
      <Input
        autoFocus
        size="large"
        prefix={<SearchOutlined />}
        placeholder="Sahifa yoki amal qidirish… (↑↓ + Enter)"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, results.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter' && results[active]) {
            go(results[active]);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        variant="borderless"
      />
      <List
        size="small"
        dataSource={results}
        style={{ maxHeight: 380, overflowY: 'auto' }}
        renderItem={(item, i) => (
          <List.Item
            onClick={() => go(item)}
            onMouseEnter={() => setActive(i)}
            style={{
              cursor: 'pointer',
              borderRadius: 6,
              padding: '8px 12px',
              background: i === active ? 'rgba(46,101,132,0.15)' : undefined,
            }}
          >
            <Typography.Text strong={i === active}>{item.label}</Typography.Text>
            {item.hint && <Tag style={{ marginLeft: 'auto' }}>{item.hint}</Tag>}
          </List.Item>
        )}
      />
    </Modal>
  );
}
