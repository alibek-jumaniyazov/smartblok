// Mijozlar — ro'yxat + yaratish/tahrirlash. Balans (qarz qizil / avans yashil),
// kredit limiti, agent bog'lanishi, paddon qoldig'i.
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Form, Input, InputNumber, Select, Space, Typography, theme } from 'antd';
import type { InputRef } from 'antd';
import { EditOutlined, PlusOutlined, ReloadOutlined, SearchOutlined, StopOutlined } from '@ant-design/icons';
import { apiError, asItems, endpoints } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { useUrlFilters } from '../lib/useUrlFilters';
import { fmtMoney, fmtNum, num } from '../lib/format';
import { useT } from '../components/LangContext';
import { translate } from '../lib/i18n';
import {
  BalanceTag,
  DataTable,
  FormDrawer,
  PageHeader,
  PalletChip,
  StatusChip,
  TableCard,
  type SbColumn,
} from '../components';
import type { StatusMeta } from '../lib/status-maps';
import type { Agent, ClientRow } from '../lib/types';

interface ClientFormValues {
  name: string;
  phone?: string | null;
  agentId?: string | null;
  creditLimit?: number | string | null;
  paymentTermDays?: number | null;
}

const moneyFormatter = (v: string | number | undefined) =>
  `${v ?? ''}`.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const moneyParser = (v: string | undefined) => (v ?? '').replace(/\s/g, '');

/** Nofaol mijoz belgisi — neytral StatusChip (enum bo'lmagan holat, label-only meta). */
const INACTIVE_META: StatusMeta = {
  get label() {
    return translate('Nofaol');
  },
};

function ClientFormFields({ office, agents }: { office: boolean; agents: Agent[] }) {
  const t = useT();
  return (
    <>
      <Form.Item name="name" label={t('Nomi')} rules={[{ required: true, message: t('Nomi majburiy') }]}>
        <Input placeholder={t('Mijoz nomi')} />
      </Form.Item>
      <Form.Item name="phone" label={t('Telefon')}>
        <Input placeholder="+998 ..." />
      </Form.Item>
      {office && (
        <Form.Item name="agentId" label={t('Agent')}>
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder={t('Agent tanlang')}
            options={agents.map((a) => ({ value: a.id, label: a.name }))}
          />
        </Form.Item>
      )}
      {office && (
        <Form.Item
          name="creditLimit"
          label={t('Kredit limiti')}
          extra={t("Bo'sh — cheklanmagan; 0 — faqat oldindan to'lov")}
        >
          <InputNumber min={0} style={{ width: '100%' }} formatter={moneyFormatter} parser={moneyParser} />
        </Form.Item>
      )}
      {office && (
        <Form.Item name="paymentTermDays" label={t("To'lov muddati (kun)")}>
          <InputNumber min={0} style={{ width: '100%' }} />
        </Form.Item>
      )}
    </>
  );
}

export default function Clients() {
  const { message, modal } = App.useApp();
  const { hasRole } = useAuth();
  const qc = useQueryClient();
  const { token } = theme.useToken();
  const t = useT();
  const office = hasRole('ADMIN', 'ACCOUNTANT');
  const isAdmin = hasRole('ADMIN');

  const navigate = useNavigate();
  const uf = useUrlFilters(['search', 'agentId']);
  const page = Number(uf.get('page')) || 1;
  const pageSize = Number(uf.get('pageSize')) || 20;
  const search = uf.get('search') || undefined;
  const agentId = uf.get('agentId') || undefined;
  // Qidiruv matni lokal — buissnes_crm kabi «Qidirish» tugmasi/Enter bosilганda
  // URL'ga yoziladi (har harfda emas). URL tashqaridan o'zgarsa (orqaga tugmasi) sinxron.
  const [searchInput, setSearchInput] = useState(uf.get('search'));
  useEffect(() => {
    setSearchInput(uf.get('search'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);
  const [createOpen, setCreateOpen] = useState(false);
  const [editRow, setEditRow] = useState<ClientRow | null>(null);
  const [createForm] = Form.useForm<ClientFormValues>();
  const [editForm] = Form.useForm<ClientFormValues>();

  const clientsQ = useQuery({
    queryKey: ['clients', 'list', page, pageSize, search, agentId],
    queryFn: () => endpoints.clients({ page, pageSize, search, agentId }),
  });
  const agentsQ = useQuery({
    queryKey: ['agents'],
    queryFn: () => endpoints.agents(),
    enabled: office, // /agents is ADMIN/ACCOUNTANT-only
  });
  const agents = asItems(agentsQ.data);

  const applySearch = () => uf.set({ search: searchInput.trim() || null });
  const clearFilters = () => {
    setSearchInput('');
    uf.clear(['search', 'agentId']);
  };
  const anyFilter = !!search || !!agentId;

  // '/' — qidiruv maydoniga fokus (boshqa list page'lardagi FilterBar konventsiyasi)
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

  const lookupsAlert = office && agentsQ.error ? (
    <Alert
      type="error"
      showIcon
      style={{ marginBottom: 12 }}
      message={t('Agentlarni yuklashda xatolik')}
      description={apiError(agentsQ.error)}
      action={
        <Button size="small" icon={<ReloadOutlined />} onClick={() => agentsQ.refetch()}>
          {t('Qayta urinish')}
        </Button>
      }
    />
  ) : null;

  const toPayload = (v: ClientFormValues) => ({
    name: v.name,
    phone: v.phone ?? null,
    ...(office
      ? {
          agentId: v.agentId ?? null,
          creditLimit: v.creditLimit === undefined || v.creditLimit === null || v.creditLimit === '' ? null : v.creditLimit,
          paymentTermDays: v.paymentTermDays ?? null,
        }
      : {}),
  });

  const createMut = useMutation({
    mutationFn: (v: ClientFormValues) => endpoints.createClient(toPayload(v)),
    onSuccess: () => {
      message.success(t("Mijoz qo'shildi"));
      qc.invalidateQueries({ queryKey: ['clients'] });
      setCreateOpen(false);
      createForm.resetFields();
    },
    onError: (err) => message.error(apiError(err)),
  });

  const updateMut = useMutation({
    mutationFn: (v: ClientFormValues) => endpoints.updateClient(editRow!.id, toPayload(v)),
    onSuccess: () => {
      message.success(t('Mijoz yangilandi'));
      qc.invalidateQueries({ queryKey: ['clients'] });
      setEditRow(null);
    },
    onError: (err) => message.error(apiError(err)),
  });

  const deactivateMut = useMutation({
    mutationFn: (id: string) => endpoints.deleteClient(id),
    onSuccess: () => {
      message.success(t('Mijoz nofaol holatga o‘tkazildi'));
      qc.invalidateQueries({ queryKey: ['clients'] });
    },
    onError: (err) => message.error(apiError(err)),
  });

  const confirmDeactivate = (c: ClientRow) => {
    modal.confirm({
      title: t('Mijozni nofaol qilish'),
      content: t('"{name}" nofaol holatga o\'tkaziladi. Buning uchun mijoz balansi nolga teng bo\'lishi shart.', {
        name: c.name,
      }),
      okText: t('Nofaol qilish'),
      okButtonProps: { danger: true },
      cancelText: t('Bekor qilish'),
      onOk: () => deactivateMut.mutateAsync(c.id),
    });
  };

  const columns: SbColumn<ClientRow>[] = [
    {
      title: 'Nomi',
      dataIndex: 'name',
      key: 'name',
      width: 220,
      ellipsis: true,
      render: (_, c) => (
        <Space>
          <Link to={`/clients/${c.id}`} style={{ fontWeight: 600 }}>{c.name}</Link>
          {!c.active && <StatusChip meta={INACTIVE_META} />}
        </Space>
      ),
    },
    { title: 'Agent', key: 'agent', width: 160, ellipsis: true, render: (_, c) => c.agent?.name ?? '—' },
    { title: 'Telefon', dataIndex: 'phone', key: 'phone', width: 150, ellipsis: true, render: (v: string | null) => v || '—' },
    {
      title: 'Balans',
      key: 'balance',
      align: 'right',
      sortable: true,
      render: (_, c) => <BalanceTag balance={c.balance ?? '0'} partyType="client" compact />,
    },
    {
      title: 'Paddon',
      key: 'palletBalance',
      align: 'center',
      render: (_, c) => ((c.palletBalance ?? 0) > 0 ? <PalletChip pallets={c.palletBalance ?? 0} compact /> : '—'),
    },
    {
      title: 'Kredit limiti',
      key: 'creditLimit',
      align: 'right',
      render: (_, c) =>
        c.creditLimit == null ? (
          <Typography.Text type="secondary">{t('Cheklanmagan')}</Typography.Text>
        ) : (
          <span className="num">{fmtMoney(c.creditLimit)}</span>
        ),
    },
    {
      title: '',
      key: 'actions',
      width: 90,
      align: 'right',
      render: (_, c) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} title={t('Tahrirlash')} onClick={() => setEditRow(c)} />
          {isAdmin && c.active && (
            <Button size="small" danger icon={<StopOutlined />} title={t('Nofaol qilish')} onClick={() => confirmDeactivate(c)} />
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Mijozlar"
        subtitle="Mijozlar ro'yxati — balans, kredit limiti va agent bog'lanishi"
        accent
        actions={[
          { key: 'new', label: 'Yangi mijoz', primary: true, icon: <PlusOutlined />, onClick: () => setCreateOpen(true) },
        ]}
      />

      {/* Filtrlar — buissnes_crm uslubida alohida karta: qidiruv + agent + amallar */}
      <div className="sb-table-card" style={{ padding: '14px 16px', marginBottom: 16 }}>
        <div className="sb-filterbar">
          <Input
            ref={searchRef}
            allowClear
            prefix={<SearchOutlined style={{ color: token.colorTextTertiary }} />}
            placeholder={t('Nomi yoki telefon')}
            value={searchInput}
            onChange={(e) => {
              const v = e.target.value;
              setSearchInput(v);
              // ✕ tugmasi / hammasini o'chirish → darhol filtrsiz ko'rsat (desync bo'lmasin)
              if (v === '') uf.set({ search: null });
            }}
            onPressEnter={applySearch}
            style={{ width: 260 }}
          />
          {office && (
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder={t('Agent')}
              value={agentId}
              onChange={(v?: string) => uf.set({ agentId: v || null })}
              options={agents.map((a) => ({ value: a.id, label: a.name }))}
              style={{ minWidth: 200 }}
            />
          )}
          <Button type="primary" icon={<SearchOutlined />} onClick={applySearch}>
            {t('Qidirish')}
          </Button>
          <Button onClick={clearFilters} disabled={!anyFilter}>
            {t('Tozalash')}
          </Button>
          <span className="num" style={{ marginInlineStart: 'auto', color: token.colorTextSecondary, fontSize: 13 }}>
            {fmtNum(clientsQ.data?.total ?? 0)} {t('ta')}
          </span>
        </div>
      </div>

      <TableCard>
        <DataTable<ClientRow>
          rowKey="id"
          columns={columns}
          query={clientsQ}
          onRowOpen={(c) => navigate(`/clients/${c.id}`)}
          emptyText="Hozircha mijoz yo'q"
          scroll={{ x: 'max-content' }}
        />
      </TableCard>

      <FormDrawer
        title={t('Yangi mijoz')}
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          createForm.resetFields();
        }}
        onSubmit={() => createForm.submit()}
        submitText="Saqlash"
        cancelText="Bekor qilish"
        submitting={createMut.isPending}
        width={440}
      >
        {lookupsAlert}
        <Form form={createForm} layout="vertical" onFinish={(v) => createMut.mutate(v)}>
          <ClientFormFields office={office} agents={agents} />
        </Form>
      </FormDrawer>

      <FormDrawer
        title={t('Mijozni tahrirlash')}
        open={!!editRow}
        onClose={() => setEditRow(null)}
        onSubmit={() => editForm.submit()}
        submitText="Saqlash"
        cancelText="Bekor qilish"
        submitting={updateMut.isPending}
        width={440}
      >
        {lookupsAlert}
        {editRow && (
          <Form
            key={editRow.id}
            form={editForm}
            layout="vertical"
            onFinish={(v) => updateMut.mutate(v)}
            initialValues={{
              name: editRow.name,
              phone: editRow.phone ?? undefined,
              agentId: editRow.agentId ?? editRow.agent?.id ?? undefined,
              creditLimit: editRow.creditLimit != null ? num(editRow.creditLimit) : undefined,
              paymentTermDays: editRow.paymentTermDays ?? undefined,
            }}
          >
            <ClientFormFields office={office} agents={agents} />
          </Form>
        )}
      </FormDrawer>
    </div>
  );
}
