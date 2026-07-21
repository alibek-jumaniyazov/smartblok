import { useEffect, useMemo, useRef, useState } from 'react';
import { App, Button, Form, Input, Select, Space, Switch, theme } from 'antd';
import type { InputRef } from 'antd';
import { EditOutlined, PlusOutlined, SearchOutlined, StopOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiError, asItems, endpoints } from '../lib/api';
import { fmtDateTime, fmtNum } from '../lib/format';
import {
  DataTable,
  FormDrawer,
  PageHeader,
  StatusChip,
  TableCard,
  type MobileCardModel,
  type SbColumn,
} from '../components';
import { ROLES, type StatusMeta } from '../lib/status-maps';
import { useAuth } from '../auth/AuthContext';
import { useIsPhone } from '../lib/responsive';
import { useUrlFilters } from '../lib/useUrlFilters';
import { translate } from '../lib/i18n';
import { useT } from '../components/LangContext';
import type { Role } from '../lib/types';

// Active/blocked inks per 02 §2.5 (success green · danger red), consumed by StatusChip.
// Yorliqlar getter — joriy tilга tarjima qilinadi (status-maps `mk` bilan bir xil naqsh).
const ACTIVE_META: StatusMeta = { get label() { return translate('Faol'); }, light: '#1A7F37', dark: '#6CC495' };
const BLOCKED_META: StatusMeta = { get label() { return translate('Bloklangan'); }, light: '#C2413B', dark: '#E8827C' };

/** SAFE_SELECT shape from UsersService */
interface UserRow {
  id: string;
  username: string;
  email: string | null;
  name: string;
  role: Role;
  phone: string | null;
  active: boolean;
  agentId: string | null;
  agent: { id: string; name: string } | null;
  lastLoginAt: string | null;
  createdAt: string;
}

interface UserFormValues {
  username: string;
  name: string;
  role: Role;
  agentId?: string;
  email?: string;
  phone?: string;
  password?: string;
  active?: boolean;
}

export default function Users() {
  const { message, modal } = App.useApp();
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const t = useT();
  const isPhone = useIsPhone();

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [form] = Form.useForm<UserFormValues>();
  const roleWatch = Form.useWatch('role', form);

  const { token } = theme.useToken();
  const uf = useUrlFilters(['search', 'role', 'active']);
  const urlSearch = uf.get('search');
  const search = urlSearch.trim().toLowerCase();
  const roleFilter = uf.get('role');
  const activeFilter = uf.get('active');

  // Qidiruv lokal — Enter/«Qidirish» bosilganda URL'ga yoziladi (Mijozlar/Agentlar bilan bir xil).
  const [searchInput, setSearchInput] = useState(urlSearch);
  useEffect(() => {
    setSearchInput(urlSearch);
  }, [urlSearch]);
  const applySearch = () => uf.set({ search: searchInput.trim() || null });
  const clearFilters = () => {
    setSearchInput('');
    uf.clear(['search', 'role', 'active']);
  };
  const anyFilter = !!search || !!roleFilter || !!activeFilter;

  // '/' — qidiruv maydoniga fokus (boshqa list page'lardagi konventsiya)
  const searchRef = useRef<InputRef>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.key !== '/') return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const listQ = useQuery({
    queryKey: ['users'],
    queryFn: async () => (await endpoints.users()) as unknown as UserRow[],
  });
  const agentsQ = useQuery({
    queryKey: ['agents'],
    queryFn: () => endpoints.agents(),
  });
  const agents = asItems(agentsQ.data);

  const rows = useMemo(() => {
    const all = (listQ.data ?? []) as UserRow[];
    return all.filter((u) => {
      if (roleFilter && u.role !== roleFilter) return false;
      if (activeFilter === 'true' && !u.active) return false;
      if (activeFilter === 'false' && u.active) return false;
      if (search) {
        const hay = `${u.username} ${u.name} ${u.phone ?? ''}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });
  }, [listQ.data, search, roleFilter, activeFilter]);

  const save = useMutation({
    mutationFn: (vals: UserFormValues) => {
      const base: Record<string, unknown> = {
        username: vals.username,
        name: vals.name,
        role: vals.role,
        email: vals.email || undefined,
        phone: vals.phone || undefined,
        agentId: vals.role === 'AGENT' ? vals.agentId : editing ? null : undefined,
      };
      if (editing) {
        if (vals.password) base.password = vals.password;
        if (vals.active !== undefined) base.active = vals.active;
        return endpoints.updateUser(editing.id, base);
      }
      base.password = vals.password;
      return endpoints.createUser(base);
    },
    onSuccess: () => {
      message.success(editing ? t('Foydalanuvchi yangilandi') : t('Foydalanuvchi yaratildi'));
      qc.invalidateQueries({ queryKey: ['users'] });
      setModalOpen(false);
    },
    onError: (e) => message.error(apiError(e)),
  });

  const deactivate = useMutation({
    mutationFn: (id: string) => endpoints.deleteUser(id),
    onSuccess: () => {
      message.success(t('Foydalanuvchi bloklandi, sessiyalari bekor qilindi'));
      qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (e) => message.error(apiError(e)),
  });

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ role: 'AGENT' });
    setModalOpen(true);
  };
  const openEdit = (row: UserRow) => {
    setEditing(row);
    form.resetFields();
    form.setFieldsValue({
      username: row.username,
      name: row.name,
      role: row.role,
      agentId: row.agentId ?? undefined,
      email: row.email ?? '',
      phone: row.phone ?? '',
      active: row.active,
      password: '',
    });
    setModalOpen(true);
  };

  const confirmDeactivate = (row: UserRow) => {
    modal.confirm({
      title: t('Foydalanuvchini bloklash'),
      content: t('"{name}" ({username}) bloklanadi va barcha faol sessiyalari darhol bekor qilinadi. Hisob o\'chirilmaydi — keyin qayta yoqish mumkin.', { name: row.name, username: row.username }),
      okText: t('Bloklash'),
      okButtonProps: { danger: true },
      cancelText: t('Bekor qilish'),
      // telefonda markazlashtiriladi — aks holda uzun matn futerni surib yuboradi
      // va tasdiqlash tugmasi ko'rinmay qoladi (spec R16)
      centered: isPhone,
      onOk: () => deactivate.mutateAsync(row.id),
    });
  };

  const columns: SbColumn<UserRow>[] = [
    { title: 'Login', dataIndex: 'username', key: 'username', width: 160, ellipsis: true },
    { title: 'Ism', dataIndex: 'name', key: 'name', width: 200, ellipsis: true },
    {
      title: 'Rol',
      dataIndex: 'role',
      key: 'role',
      render: (v: Role) => <StatusChip meta={ROLES[v] ?? { label: v }} />,
    },
    { title: 'Agent', key: 'agent', width: 180, ellipsis: true, render: (_: unknown, r) => r.agent?.name ?? '—' },
    {
      title: 'Telefon',
      dataIndex: 'phone',
      key: 'phone',
      width: 150,
      ellipsis: true,
      render: (v: string | null) => v || '—',
    },
    {
      title: 'Holat',
      dataIndex: 'active',
      key: 'active',
      render: (v: boolean) => <StatusChip meta={v ? ACTIVE_META : BLOCKED_META} />,
    },
    {
      title: 'Oxirgi kirish',
      dataIndex: 'lastLoginAt',
      key: 'lastLoginAt',
      render: (v: string | null) => fmtDateTime(v),
    },
    {
      title: 'Amallar',
      key: 'actions',
      width: 140,
      render: (_: unknown, row) => (
        <Space>
          {/* ikonka-tugmalar uchun aria-label (R13) — ko'rinishi o'zgarmaydi */}
          <Button
            size="small"
            icon={<EditOutlined />}
            aria-label={t('Tahrirlash')}
            onClick={() => openEdit(row)}
          />
          {row.active && row.id !== me?.id && (
            <Button
              size="small"
              danger
              icon={<StopOutlined />}
              aria-label={t('Bloklash')}
              onClick={() => confirmDeactivate(row)}
            />
          )}
        </Space>
      ),
    },
  ];

  // Telefon kartasi (spec §2.2.2): sarlavha = ism, ostida login. Rol/holat —
  // chiplar; agent, telefon va oxirgi kirish — yorliqli qatorlar. Qator ichidagi
  // ikonka-tugmalar barmoq uchun juda kichik, shuning uchun amallar karta
  // futerida yorliqli chiqadi (§2.2.4). Telefon `tel:` havolasi (R14).
  const userCard = (r: UserRow): MobileCardModel => {
    const lines: NonNullable<MobileCardModel['lines']> = [];
    if (r.agent?.name) lines.push({ label: 'Agent', value: r.agent.name });
    if (r.phone) lines.push({ label: 'Telefon', value: <a href={`tel:${r.phone}`}>{r.phone}</a> });
    lines.push({ label: 'Oxirgi kirish', value: fmtDateTime(r.lastLoginAt) });

    return {
      title: r.name,
      subtitle: r.username,
      meta: (
        <>
          <StatusChip meta={ROLES[r.role] ?? { label: r.role }} />
          <StatusChip meta={r.active ? ACTIVE_META : BLOCKED_META} />
        </>
      ),
      lines,
      actions: (
        <>
          <Button icon={<EditOutlined />} onClick={() => openEdit(r)}>
            {t('Tahrirlash')}
          </Button>
          {r.active && r.id !== me?.id && (
            <Button danger icon={<StopOutlined />} onClick={() => confirmDeactivate(r)}>
              {t('Bloklash')}
            </Button>
          )}
        </>
      ),
    };
  };

  return (
    <div>
      <PageHeader
        title="Foydalanuvchilar"
        subtitle="Tizim foydalanuvchilari — rol, holat va oxirgi kirish"
        accent
        actions={[
          { key: 'new', label: 'Yangi foydalanuvchi', primary: true, icon: <PlusOutlined />, onClick: openCreate },
        ]}
      />

      {/* Filtrlar — buissnes_crm uslubida alohida karta: qidiruv + rol + holat + amallar */}
      <div
        className="sb-table-card"
        style={{ padding: isPhone ? '10px 12px' : '14px 16px', marginBottom: 16 }}
      >
        <div className="sb-filterbar">
          <Input
            ref={searchRef}
            allowClear
            prefix={<SearchOutlined style={{ color: token.colorTextTertiary }} />}
            placeholder={t('Ism yoki login')}
            value={searchInput}
            onChange={(e) => {
              const v = e.target.value;
              setSearchInput(v);
              if (v === '') uf.set({ search: null });
            }}
            onPressEnter={applySearch}
            style={{ width: isPhone ? '100%' : 260, minWidth: isPhone ? 0 : undefined }}
          />
          <Select
            allowClear
            placeholder={t('Rol')}
            value={roleFilter || undefined}
            onChange={(v?: string) => uf.set({ role: v || null })}
            options={(Object.keys(ROLES) as Role[]).map((r) => ({ value: r, label: ROLES[r].label }))}
            style={{ width: isPhone ? '100%' : undefined, minWidth: isPhone ? 0 : 160 }}
          />
          <Select
            allowClear
            placeholder={t('Holat')}
            value={activeFilter || undefined}
            onChange={(v?: string) => uf.set({ active: v || null })}
            options={[
              { label: t('Faol'), value: 'true' },
              { label: t('Bloklangan'), value: 'false' },
            ]}
            style={{ width: isPhone ? '100%' : undefined, minWidth: isPhone ? 0 : 160 }}
          />
          <Button type="primary" icon={<SearchOutlined />} onClick={applySearch}>
            {t('Qidirish')}
          </Button>
          <Button onClick={clearFilters} disabled={!anyFilter}>
            {t('Tozalash')}
          </Button>
          {/* telefonda `margin-inline-start: auto` yo'q — hisoblagich o'z qatorida */}
          <span
            className="num"
            style={{
              marginInlineStart: isPhone ? 0 : 'auto',
              width: isPhone ? '100%' : undefined,
              color: token.colorTextSecondary,
              fontSize: 13,
            }}
          >
            {fmtNum(rows.length)} {t('ta')}
          </span>
        </div>
      </div>

      <TableCard>
        <DataTable<UserRow>
          rowKey="id"
          columns={columns}
          query={{
            data: rows,
            isLoading: listQ.isLoading,
            isFetching: listQ.isFetching,
            isError: listQ.isError,
            error: listQ.error,
            refetch: listQ.refetch,
          }}
          emptyText="Hozircha foydalanuvchi yo'q"
          scroll={{ x: 'max-content' }}
          mobileCard={userCard}
        />
      </TableCard>

      <FormDrawer
        title={editing ? t('Foydalanuvchini tahrirlash') : t('Yangi foydalanuvchi')}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={() => form.validateFields().then((vals) => save.mutate(vals))}
        submitText="Saqlash"
        cancelText="Bekor qilish"
        submitting={save.isPending}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="username"
            label={t('Login')}
            rules={[
              { required: true, message: t('Login majburiy') },
              { min: 3, max: 32, message: t('3–32 belgi') },
              {
                pattern: /^[a-zA-Z0-9]+$/,
                message: t('Faqat lotin harflari va raqamlar'),
              },
            ]}
          >
            <Input placeholder={t('masalan botir1')} autoComplete="off" />
          </Form.Item>
          <Form.Item name="name" label={t('Ism')} rules={[{ required: true, message: t('Ism majburiy') }, { max: 128 }]}>
            <Input placeholder={t("To'liq ism")} />
          </Form.Item>
          <Form.Item name="role" label={t('Rol')} rules={[{ required: true, message: t('Rolni tanlang') }]}>
            <Select
              options={(Object.keys(ROLES) as Role[]).map((r) => ({ value: r, label: ROLES[r].label }))}
            />
          </Form.Item>
          {roleWatch === 'AGENT' && (
            <Form.Item
              name="agentId"
              label={t('Agent')}
              rules={[{ required: true, message: t('AGENT roli uchun agent majburiy') }]}
              extra={t('Bu foydalanuvchi qaysi agent nomidan ishlaydi')}
            >
              <Select
                showSearch
                optionFilterProp="label"
                placeholder={t('Agentni tanlang')}
                loading={agentsQ.isFetching}
                options={agents.map((a) => ({ value: a.id, label: a.name }))}
              />
            </Form.Item>
          )}
          <Form.Item
            name="password"
            label={editing ? t('Yangi parol (almashtirish uchun)') : t('Parol')}
            rules={
              editing
                ? [{ min: 8, message: t('Kamida 8 belgi') }]
                : [
                    { required: true, message: t('Parol majburiy') },
                    { min: 8, message: t('Kamida 8 belgi') },
                  ]
            }
            extra={
              editing
                ? t("Bo'sh qoldirsangiz parol o'zgarmaydi. Almashtirilsa, foydalanuvchi sessiyalari bekor qilinadi.")
                : t('Kamida 8 belgi')
            }
          >
            <Input.Password placeholder={editing ? t('Almashtirish uchun kiriting') : t('Parol')} autoComplete="new-password" />
          </Form.Item>
          <Form.Item name="email" label={t('Email')} rules={[{ type: 'email', message: t("Email noto'g'ri") }]}>
            <Input placeholder={t('ixtiyoriy')} />
          </Form.Item>
          <Form.Item name="phone" label={t('Telefon')} rules={[{ max: 32 }]}>
            <Input placeholder="+998 ..." />
          </Form.Item>
          {editing && (
            <Form.Item
              name="active"
              label={t('Faol')}
              valuePropName="checked"
              extra={t("O'chirilsa foydalanuvchi tizimga kira olmaydi (sessiyalari bekor qilinadi)")}
            >
              <Switch disabled={editing.id === me?.id} />
            </Form.Item>
          )}
        </Form>
      </FormDrawer>
    </div>
  );
}
