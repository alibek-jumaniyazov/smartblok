import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Form, Input, InputNumber, Select, Switch, Tag, Typography, theme } from 'antd';
import type { InputRef } from 'antd';
import { EditOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { apiError, asItems, endpoints } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { useUrlFilters } from '../lib/useUrlFilters';
import { fmtMoney, num } from '../lib/format';
import { useT } from '../components/LangContext';
import { useIsPhone } from '../lib/responsive';
import { translate } from '../lib/i18n';
import type { Agent, Money as MoneyStr } from '../lib/types';
import {
  BalanceTag,
  DataTable,
  FormDrawer,
  PageHeader,
  StatusChip,
  TableCard,
  type MobileCardModel,
  type SbColumn,
} from '../components';
import type { StatusMeta } from '../lib/status-maps';

interface AgentRow extends Agent {
  /** agent's own limit (null = falls back to the global default) — for the edit form */
  ownDebtLimit?: MoneyStr | null;
}

interface AgentFormValues {
  name: string;
  phone?: string | null;
  sortNo?: number | null;
  active: boolean;
  debtLimit?: number | string | null;
  username?: string;
  password?: string;
}

type ModalState = { mode: 'create' } | { mode: 'edit'; row: AgentRow } | null;

const moneyFormatter = (v: string | number | undefined) =>
  `${v ?? ''}`.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const moneyParser = (v: string | undefined) => (v ?? '').replace(/\s/g, '');

// Faol/Nofaol active flags — the one StatusChip (tokens via status-maps hues, no ad-hoc Tag color).
const ACTIVE_META: StatusMeta = {
  light: '#1A7F37',
  dark: '#6CC495',
  get label() {
    return translate('Faol');
  },
};
const INACTIVE_META: StatusMeta = {
  light: '#64748B',
  dark: '#94A3B8',
  get label() {
    return translate('Nofaol');
  },
};

export default function Agents() {
  const { message } = App.useApp();
  const { hasRole } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const t = useT();
  const isPhone = useIsPhone();
  const isAdmin = hasRole('ADMIN');

  const [modalState, setModalState] = useState<ModalState>(null);
  const [form] = Form.useForm<AgentFormValues>();

  const { token } = theme.useToken();
  const uf = useUrlFilters(['search', 'active']);
  const urlSearch = uf.get('search');
  const search = urlSearch.trim().toLowerCase();
  const activeFilter = uf.get('active');

  // Qidiruv lokal — Enter/«Qidirish» bosilганda URL'ga yoziladi (Mijozlar bilan bir xil).
  const [searchInput, setSearchInput] = useState(urlSearch);
  useEffect(() => {
    setSearchInput(urlSearch);
  }, [urlSearch]);
  const applySearch = () => uf.set({ search: searchInput.trim() || null });
  const clearFilters = () => {
    setSearchInput('');
    uf.clear(['search', 'active']);
  };
  const anyFilter = !!search || !!activeFilter;

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

  const q = useQuery({ queryKey: ['agents'], queryFn: () => endpoints.agents() });

  const rows = useMemo(() => {
    const all = asItems(q.data) as AgentRow[];
    return all.filter((a) => {
      if (activeFilter === 'true' && !a.active) return false;
      if (activeFilter === 'false' && a.active) return false;
      if (search) {
        const hay = `${a.name} ${a.phone ?? ''}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });
  }, [q.data, search, activeFilter]);

  const toPayload = (v: AgentFormValues) => ({
    name: v.name,
    phone: v.phone ?? null,
    sortNo: v.sortNo ?? null,
    active: v.active,
    ...(isAdmin
      ? { debtLimit: v.debtLimit === undefined || v.debtLimit === null || v.debtLimit === '' ? null : v.debtLimit }
      : {}),
  });

  const saveMut = useMutation({
    mutationFn: (v: AgentFormValues) =>
      modalState?.mode === 'edit'
        ? endpoints.updateAgent(modalState.row.id, toPayload(v))
        : endpoints.createAgent({
            ...toPayload(v),
            // create the agent's login in the same request → auto-creates an AGENT user
            ...(v.username?.trim() ? { username: v.username.trim() } : {}),
            ...(v.password ? { password: v.password } : {}),
          }),
    onSuccess: () => {
      message.success(modalState?.mode === 'edit' ? t('Agent yangilandi') : t("Agent qo'shildi"));
      qc.invalidateQueries({ queryKey: ['agents'] });
      setModalState(null);
    },
    onError: (err) => message.error(apiError(err)),
  });

  // Qarz limiti bir xil ko'rinishda — jadval katagi ham, telefon kartasi ham shuni ishlatadi.
  const renderDebtLimit = (v: MoneyStr | null | undefined) =>
    v == null ? (
      <Typography.Text type="secondary">{t('Cheklanmagan')}</Typography.Text>
    ) : num(v) === 0 ? (
      <Tag color="red">{t('0 — bloklangan')}</Tag>
    ) : (
      <span className="num">{fmtMoney(v)}</span>
    );

  const columns: SbColumn<AgentRow>[] = [
    {
      title: 'Nomi',
      dataIndex: 'name',
      key: 'name',
      ellipsis: true,
      width: 220,
      render: (v: string, a) => <Link to={`/agents/${a.id}`}>{v}</Link>,
    },
    {
      title: 'Telefon',
      dataIndex: 'phone',
      key: 'phone',
      ellipsis: true,
      width: 160,
      render: (v: string | null) => v || '—',
    },
    {
      title: 'Mijozlar',
      dataIndex: 'clientCount',
      key: 'clientCount',
      align: 'center',
      render: (v: number | undefined) => v ?? 0,
    },
    {
      // NET balance of this agent's clients (the daftar «Ост»), NOT an open-debt figure:
      // a client who prepaid pulls it negative. BalanceTag carries the meaning in words —
      // «Qarz» red when they owe us, «Avans» green when they are in credit.
      title: 'Mijozlar balansi',
      dataIndex: 'outstandingDebt',
      key: 'outstandingDebt',
      align: 'right',
      render: (v: MoneyStr | undefined) => <BalanceTag balance={v ?? '0'} partyType="client" />,
    },
    {
      title: 'Qarz limiti',
      dataIndex: 'debtLimit',
      key: 'debtLimit',
      align: 'right',
      render: (v: MoneyStr | null | undefined) => renderDebtLimit(v),
    },
    {
      title: 'Holati',
      dataIndex: 'active',
      key: 'active',
      align: 'center',
      render: (v: boolean) => <StatusChip meta={v ? ACTIVE_META : INACTIVE_META} />,
    },
    {
      title: 'Amallar',
      key: 'actions',
      width: 90,
      render: (_, a) => (
        <Button
          size="small"
          icon={<EditOutlined />}
          title={t('Tahrirlash')}
          aria-label={t('Tahrirlash')}
          onClick={() => setModalState({ mode: 'edit', row: a })}
        />
      ),
    },
  ];

  // Telefon kartasi (DataTable faqat <768px da chaqiradi) — desktop jadvaliga
  // umuman tegmaydi. «Amallar» tugmasi karta ichidagi qatorda emas, futerda
  // (spec §2.2.4), telefon raqami esa bosiladigan tel: havola (R14).
  const agentCard = (a: AgentRow): MobileCardModel => ({
    title: <Link to={`/agents/${a.id}`}>{a.name}</Link>,
    subtitle: a.phone ? <a href={`tel:${a.phone}`}>{a.phone}</a> : undefined,
    value: <BalanceTag balance={a.outstandingDebt ?? '0'} partyType="client" />,
    meta: (
      <>
        <StatusChip meta={a.active ? ACTIVE_META : INACTIVE_META} />
        <span className="sb-mcard__chip">
          <em className="sb-mcard__chip-label">{t('Mijozlar')}</em>
          {a.clientCount ?? 0}
        </span>
      </>
    ),
    lines: [{ label: 'Qarz limiti', value: renderDebtLimit(a.debtLimit) }],
    actions: (
      <Button icon={<EditOutlined />} onClick={() => setModalState({ mode: 'edit', row: a })}>
        {t('Tahrirlash')}
      </Button>
    ),
  });

  const editing = modalState?.mode === 'edit' ? modalState.row : null;

  return (
    <div>
      <PageHeader
        title="Agentlar"
        subtitle="Agentlar ro'yxati — mijozlar soni, mijozlar balansi va qarz limiti"
        accent
        actions={[
          {
            key: 'new',
            label: 'Yangi agent',
            primary: true,
            icon: <PlusOutlined />,
            onClick: () => setModalState({ mode: 'create' }),
          },
        ]}
      />

      {/* Filtrlar — buissnes_crm uslubida alohida karta: qidiruv + holat + amallar */}
      <div
        className="sb-table-card"
        style={{ padding: isPhone ? '10px 12px' : '14px 16px', marginBottom: isPhone ? 12 : 16 }}
      >
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
              if (v === '') uf.set({ search: null });
            }}
            onPressEnter={applySearch}
            style={{ width: isPhone ? '100%' : 260, minWidth: isPhone ? 0 : undefined }}
          />
          <Select
            allowClear
            placeholder={t('Holat')}
            value={activeFilter || undefined}
            onChange={(v?: string) => uf.set({ active: v || null })}
            options={[
              { label: t('Faol'), value: 'true' },
              { label: t('Nofaol'), value: 'false' },
            ]}
            style={{ width: isPhone ? '100%' : undefined, minWidth: isPhone ? 0 : 160 }}
          />
          <Button type="primary" icon={<SearchOutlined />} onClick={applySearch}>
            {t('Qidirish')}
          </Button>
          <Button onClick={clearFilters} disabled={!anyFilter}>
            {t('Tozalash')}
          </Button>
          <span
            className="num"
            style={{
              marginInlineStart: isPhone ? 0 : 'auto',
              width: isPhone ? '100%' : undefined,
              color: token.colorTextSecondary,
              fontSize: 13,
            }}
          >
            {rows.length} {t('ta')}
          </span>
        </div>
      </div>

      <TableCard>
        <DataTable<AgentRow>
          columns={columns}
          rowKey="id"
          query={{
            data: rows,
            isLoading: q.isLoading,
            isFetching: q.isFetching,
            isError: q.isError,
            error: q.error,
            refetch: q.refetch,
          }}
          onRowOpen={(a) => navigate(`/agents/${a.id}`)}
          emptyText="Hozircha agent yo'q"
          scroll={{ x: 'max-content' }}
          mobileCard={agentCard}
        />
      </TableCard>

      <FormDrawer
        title={editing ? t('Agentni tahrirlash') : t('Yangi agent')}
        open={!!modalState}
        onClose={() => setModalState(null)}
        onSubmit={() => form.submit()}
        submitText="Saqlash"
        cancelText="Bekor qilish"
        submitting={saveMut.isPending}
        width={520}
      >
        {modalState && (
          <Form
            key={editing ? editing.id : 'create'}
            form={form}
            layout="vertical"
            onFinish={(v) => saveMut.mutate(v)}
            initialValues={
              editing
                ? {
                    name: editing.name,
                    phone: editing.phone ?? undefined,
                    sortNo: editing.sortNo ?? undefined,
                    active: editing.active,
                    debtLimit: editing.ownDebtLimit != null ? num(editing.ownDebtLimit) : undefined,
                  }
                : { active: true }
            }
          >
            <Form.Item name="name" label={t('Nomi')} rules={[{ required: true, message: t('Nomi majburiy') }]}>
              <Input placeholder={t('Agent nomi')} />
            </Form.Item>
            <Form.Item name="phone" label={t('Telefon')}>
              <Input placeholder="+998 ..." />
            </Form.Item>
            {!editing && (
              <>
                <Typography.Text type="secondary" style={{ display: 'block', margin: '4px 0 10px', fontSize: 12 }}>
                  {t("Kirish ma'lumotlari — agent shu login bilan tizimga kiradi (avtomatik foydalanuvchi yaratiladi).")}
                </Typography.Text>
                <Form.Item
                  name="username"
                  label={t('Login (username)')}
                  rules={[{ required: true, message: t('Login majburiy') }]}
                >
                  <Input placeholder={t('masalan: jasur')} autoComplete="off" />
                </Form.Item>
                <Form.Item
                  name="password"
                  label={t('Parol')}
                  rules={[
                    { required: true, message: t('Parol majburiy') },
                    { min: 4, message: t('Kamida 4 belgi') },
                  ]}
                >
                  <Input.Password placeholder={t('Kamida 4 belgi')} autoComplete="new-password" />
                </Form.Item>
              </>
            )}
            <Form.Item name="sortNo" label={t('Tartib raqami')} extra={t("Faqat ro'yxatdagi tartib uchun")}>
              <InputNumber style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="active" label={t('Faol')} valuePropName="checked">
              <Switch />
            </Form.Item>
            {isAdmin && (
              <Form.Item
                name="debtLimit"
                label={t('Qarz limiti')}
                extra={t('null = umumiy limit, 0 = yangi buyurtmalar bloklanadi')}
              >
                <InputNumber min={0} style={{ width: '100%' }} formatter={moneyFormatter} parser={moneyParser} />
              </Form.Item>
            )}
          </Form>
        )}
      </FormDrawer>
    </div>
  );
}
