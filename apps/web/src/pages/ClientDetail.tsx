// ClientDetail — the archetypal party page (parties.md §2). PartyBalanceHeader
// (balance sentence + CreditGauge + PalletChip + OverdueChip + actions) over
// ?tab= tabs: Hisob-kitob (PartyStatement, windowed) · Buyurtmalar · To'lovlar
// (both server-paginated registers — the 20-row cap dies) · Taxalluslar · Maxsus
// narxlar (grouped by product, in-force highlighted, «kelgusi» badges). ?panel=tolov
// opens the prefilled PaymentComposer. Every list surface is URL-synced via
// useUrlFilters; loading/refetch/empty/error follow the platform state law (02 §9).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App,
  Button,
  DatePicker,
  Drawer,
  Form,
  Input,
  InputNumber,
  List,
  Select,
  Skeleton,
  Space,
  Typography,
  theme,
} from 'antd';
import {
  CheckCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  PrinterOutlined,
  ShoppingCartOutlined,
  StopOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { apiError, asItems, endpoints } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { useUrlFilters } from '../lib/useUrlFilters';
import { can } from '../lib/permissions';
import { fmtDate, fmtNum, isSettled, num } from '../lib/format';
import { PAYMENT_KIND, PAYMENT_METHOD, STATUS, UNRECONCILED, type StatusMeta } from '../lib/status-maps';
import {
  DataTable,
  EmptyState,
  ErrorState,
  MoneyCell,
  MoneyInput,
  PageHeader,
  PartyBalanceHeader,
  PartyStatement,
  PaymentComposer,
  StatusChip,
  type DateRange,
  type PartyHeaderAction,
  type PartyHeaderCounters,
  type SbColumn,
} from '../components';
import type { Agent, ClientRow, Money, Order, Payment, Product } from '../lib/types';

// ─────────────────────────── detail payload shape ───────────────────────────

interface AliasRow {
  id: string;
  name: string;
}

interface PriceRow {
  id: string;
  pricePerM3: Money;
  effectiveFrom: string;
  product?: { id: string; name: string; size?: string | null } | null;
}

interface ClientDetailData extends ClientRow {
  aliases: AliasRow[];
  prices: PriceRow[];
  balance: Money;
  palletBalance: number;
}

/** the matched row from GET /debts/clients — server-computed overdue facts. */
interface DebtClientRow {
  id: string;
  overdueOrdersCount: number;
  overdueOrdersTotal: Money;
  hasOverdueOrders: boolean;
}

interface ClientFormValues {
  name: string;
  phone?: string | null;
  legalEntity?: string | null;
  agentId?: string | null;
  creditLimit?: string | null;
  paymentTermDays?: number | null;
}

interface PriceFormValues {
  productId: string;
  pricePerM3: string;
  effectiveFrom?: Dayjs | null;
}

const TAB_KEYS = ['hisob', 'buyurtmalar', 'tolovlar', 'taxalluslar', 'narxlar'] as const;

function isEditableTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/** Prices are stored at up to 6dp (back-solved lump-sum prices) — never rounded. */
function fmtPrice(v: Money): string {
  return fmtNum(v, 6);
}

// Party-state + special-price chips (04 §4.2 semantic inks) — the ONLY hand-authored
// StatusMeta on this page; every other enum reads its map from lib/status-maps.
const CLIENT_ACTIVE: StatusMeta = { label: 'Faol', light: '#1A7F37', dark: '#3FB950' };
const CLIENT_INACTIVE: StatusMeta = { label: 'Nofaol', light: '#6E7781', dark: '#8B949E' };
const PRICE_CURRENT: StatusMeta = { label: 'joriy', light: '#1A7F37', dark: '#3FB950' };
const PRICE_FUTURE: StatusMeta = { label: 'kelgusi', light: '#0969DA', dark: '#4493F8' };

/** small section overline (04 §1.3): 11px, 600, uppercase, tertiary ink. */
const overlineStyle = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '.04em',
  textTransform: 'uppercase' as const,
};

// ─────────────────────────── edit drawer (§1.4) ───────────────────────────

function toClientPayload(v: ClientFormValues, office: boolean): Record<string, unknown> {
  const base = {
    name: v.name,
    phone: v.phone ?? null,
    legalEntity: v.legalEntity ?? null,
  };
  if (!office) return base; // AGENT: credit/agent/term are stripped server-side — never sent
  return {
    ...base,
    agentId: v.agentId ?? null,
    creditLimit:
      v.creditLimit === undefined || v.creditLimit === null || v.creditLimit === '' ? null : v.creditLimit,
    paymentTermDays: v.paymentTermDays ?? null,
  };
}

function ClientEditDrawer({
  client,
  open,
  onClose,
  office,
}: {
  client: ClientDetailData;
  open: boolean;
  onClose: () => void;
  office: boolean;
}) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [form] = Form.useForm<ClientFormValues>();

  const agentsQ = useQuery({ queryKey: ['agents'], queryFn: () => endpoints.agents(), enabled: open && office });
  const agents = asItems<Agent>(agentsQ.data);

  const mut = useMutation({
    mutationFn: (v: ClientFormValues) => endpoints.updateClient(client.id, toClientPayload(v, office)),
    onSuccess: () => {
      message.success('Mijoz yangilandi');
      qc.invalidateQueries({ queryKey: ['clients'] });
      onClose();
    },
    onError: (err) => form.setFields([{ name: 'name', errors: [apiError(err)] }]),
  });

  const submit = () => form.submit();
  const lookupsError = office ? agentsQ.error : null;

  return (
    <Drawer
      title="Mijozni tahrirlash"
      open={open}
      onClose={onClose}
      width={480}
      destroyOnHidden
      extra={
        <Button type="primary" loading={mut.isPending} onClick={submit}>
          Saqlash
        </Button>
      }
    >
      {lookupsError ? (
        <div style={{ marginBottom: 12 }}>
          <ErrorState
            error={lookupsError}
            message="Agentlarni yuklab bo'lmadi"
            onRetry={() => {
              if (office) agentsQ.refetch();
            }}
          />
        </div>
      ) : null}
      <div
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        }}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(v) => mut.mutate(v)}
          initialValues={{
            name: client.name,
            phone: client.phone ?? undefined,
            legalEntity: client.legalEntity ?? undefined,
            agentId: client.agentId ?? client.agent?.id ?? undefined,
            creditLimit: client.creditLimit != null ? String(num(client.creditLimit)) : undefined,
            paymentTermDays: client.paymentTermDays ?? undefined,
          }}
        >
          <Form.Item name="name" label="Nomi" rules={[{ required: true, message: 'Nomi majburiy' }]}>
            <Input placeholder="Mijoz nomi" />
          </Form.Item>
          <Form.Item name="phone" label="Telefon">
            <Input placeholder="+998 ..." />
          </Form.Item>
          <Form.Item name="legalEntity" label="Yuridik shaxs">
            <Input placeholder="Firma nomi (ixtiyoriy)" />
          </Form.Item>
          {office && (
            <Form.Item
              name="agentId"
              label="Agent"
              extra="Tarixiy buyurtmalar va to'lovlar avvalgi agent hisobida qoladi"
            >
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                placeholder="Agent tanlang"
                loading={agentsQ.isFetching}
                options={agents.map((a) => ({ value: a.id, label: a.name }))}
              />
            </Form.Item>
          )}
          {office && (
            <Form.Item
              name="creditLimit"
              label="Kredit limiti"
              extra="Bo'sh — cheklanmagan; 0 — faqat oldindan to'lov"
            >
              <MoneyInput min={0} placeholder="Cheklanmagan" />
            </Form.Item>
          )}
          {office && (
            <Form.Item name="paymentTermDays" label="To'lov muddati (kun)">
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
          )}
        </Form>
      </div>
    </Drawer>
  );
}

// ─────────────────────────── price drawer (§2.3) ───────────────────────────

function PriceDrawer({
  clientId,
  open,
  onClose,
}: {
  clientId: string;
  open: boolean;
  onClose: () => void;
}) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [form] = Form.useForm<PriceFormValues>();

  const productsQ = useQuery({
    queryKey: ['products', 'client-prices'],
    queryFn: () => endpoints.products(),
    enabled: open,
  });
  const products = asItems<Product>(productsQ.data);

  const mut = useMutation({
    mutationFn: (v: PriceFormValues) =>
      endpoints.addClientPrice(clientId, {
        productId: v.productId,
        pricePerM3: v.pricePerM3,
        ...(v.effectiveFrom ? { effectiveFrom: v.effectiveFrom.format('YYYY-MM-DD') } : {}),
      }),
    onSuccess: () => {
      message.success("Maxsus narx qo'shildi");
      qc.invalidateQueries({ queryKey: ['clients', clientId] });
      form.resetFields();
      onClose();
    },
    onError: (err) => form.setFields([{ name: 'pricePerM3', errors: [apiError(err)] }]),
  });

  const priceFormatter = (v: string | number | undefined): string => {
    if (v == null || v === '') return '';
    const [i, d] = String(v).split('.');
    const gi = i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return d != null ? `${gi}.${d}` : gi;
  };
  const priceParser = (v: string | undefined): string => (v ?? '').replace(/[^\d.]/g, '');

  return (
    <Drawer
      title="Yangi narx"
      open={open}
      onClose={onClose}
      width={480}
      destroyOnHidden
      extra={
        <Button type="primary" loading={mut.isPending} onClick={() => form.submit()}>
          Saqlash
        </Button>
      }
      footer={
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Narxlar tarixi o'zgartirilmaydi — yangi qator qo'shiladi.
        </Typography.Text>
      }
    >
      {productsQ.isError ? (
        <div style={{ marginBottom: 12 }}>
          <ErrorState
            error={productsQ.error}
            message="Mahsulotlarni yuklab bo'lmadi"
            onRetry={() => productsQ.refetch()}
          />
        </div>
      ) : null}
      <Form form={form} layout="vertical" onFinish={(v) => mut.mutate(v)} initialValues={{ effectiveFrom: dayjs() }}>
        <Form.Item name="productId" label="Mahsulot" rules={[{ required: true, message: 'Mahsulot tanlang' }]}>
          <Select
            showSearch
            optionFilterProp="label"
            placeholder="Mahsulot"
            loading={productsQ.isFetching}
            options={products.map((p) => ({
              value: p.id,
              label: `${p.name}${p.size ? ` (${p.size})` : ''}${p.factory ? ` — ${p.factory.name}` : ''}`,
            }))}
          />
        </Form.Item>
        <Form.Item name="pricePerM3" label="Narx (m³)" rules={[{ required: true, message: 'Narx kiriting' }]}>
          <InputNumber<string>
            stringMode
            min="0"
            controls={false}
            style={{ width: '100%' }}
            placeholder="0"
            inputMode="decimal"
            formatter={priceFormatter}
            parser={priceParser}
            onFocus={(e) => e.target.select()}
            suffix={<span style={{ opacity: 0.6 }}>so'm</span>}
          />
        </Form.Item>
        <Form.Item name="effectiveFrom" label="Amal qilish sanasi">
          <DatePicker format="DD.MM.YYYY" allowClear={false} style={{ width: '100%' }} />
        </Form.Item>
      </Form>
    </Drawer>
  );
}

// ─────────────────────────── page ───────────────────────────

export default function ClientDetail() {
  const { id } = useParams<{ id: string }>();
  const { token } = theme.useToken();
  const { message, modal } = App.useApp();
  const { user, hasRole } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const uf = useUrlFilters();

  const role = user?.role;
  const office = hasRole('ADMIN', 'ACCOUNTANT');

  const [editOpen, setEditOpen] = useState(false);
  const [priceOpen, setPriceOpen] = useState(false);
  const [aliasName, setAliasName] = useState('');

  // ── active tab (?tab=), role-scoped ──
  const rawTab = uf.get('tab') || 'hisob';
  const allowedTabs = useMemo(
    () => new Set<string>(office ? TAB_KEYS : ['hisob', 'buyurtmalar', 'tolovlar']),
    [office],
  );
  const activeTab = allowedTabs.has(rawTab) ? rawTab : 'hisob';

  // ── statement window (default: Shu oy) — also feeds the akt-sverki print link ──
  const from = uf.get('from') || dayjs().startOf('month').format('YYYY-MM-DD');
  const to = uf.get('to') || dayjs().endOf('month').format('YYYY-MM-DD');

  // ── register pagination (shared param; only one tab is mounted at a time) ──
  const page = Number(uf.get('page')) || 1;
  const pageSize = Number(uf.get('pageSize')) || 20;
  const showVoided = uf.get('bekor') === '1';

  const detailQ = useQuery({
    queryKey: ['clients', id],
    queryFn: () => endpoints.client(id!),
    enabled: !!id,
  });
  const data = detailQ.data as ClientDetailData | undefined;

  // overdue facts for this client (server-computed over all orders, fact 0b)
  const overdueQ = useQuery({
    queryKey: ['debts', 'clients', 'overdue-for', id],
    queryFn: () => endpoints.debtsClients({ days: 7, search: data?.name, pageSize: 100 }),
    enabled: !!id && !!data?.name && can(role, 'debts.view'),
  });
  const overdueRow = useMemo<DebtClientRow | undefined>(() => {
    const rows = (overdueQ.data?.items ?? []) as DebtClientRow[];
    return rows.find((r) => r.id === id);
  }, [overdueQ.data, id]);

  // register queries (each gated to its active tab)
  const ordersQ = useQuery({
    queryKey: ['orders', 'client', id, page, pageSize],
    queryFn: () => endpoints.orders({ clientId: id!, page, pageSize }),
    enabled: !!id && activeTab === 'buyurtmalar' && can(role, 'orders.view'),
    placeholderData: keepPreviousData,
  });
  const paymentsQ = useQuery({
    queryKey: ['payments', 'client', id, page, pageSize, showVoided],
    queryFn: () => endpoints.payments({ clientId: id!, page, pageSize, voided: showVoided ? true : undefined }),
    enabled: !!id && activeTab === 'tolovlar' && can(role, 'payments.view'),
    placeholderData: keepPreviousData,
  });

  // ── alias mutations (Taxalluslar tab) ──
  const addAliasMut = useMutation({
    mutationFn: (name: string) => endpoints.addClientAlias(id!, name),
    onSuccess: () => {
      message.success("Taxallus qo'shildi");
      setAliasName('');
      qc.invalidateQueries({ queryKey: ['clients', id] });
    },
    onError: (err) => message.error(apiError(err)),
  });
  const removeAliasMut = useMutation({
    mutationFn: (aliasId: string) => endpoints.deleteClientAlias(id!, aliasId),
    onSuccess: () => {
      message.success("Taxallus o'chirildi");
      qc.invalidateQueries({ queryKey: ['clients', id] });
    },
    onError: (err) => message.error(apiError(err)),
  });

  // ── activation mutations (ADMIN) ──
  const deactivateMut = useMutation({
    mutationFn: () => endpoints.deleteClient(id!),
    onSuccess: () => {
      message.success("Mijoz nofaol holatga o'tkazildi");
      qc.invalidateQueries({ queryKey: ['clients'] });
    },
    onError: (err) => message.error(apiError(err)),
  });
  const reactivateMut = useMutation({
    mutationFn: () => endpoints.updateClient(id!, { active: true }),
    onSuccess: () => {
      message.success('Mijoz faollashtirildi');
      qc.invalidateQueries({ queryKey: ['clients'] });
    },
    onError: (err) => message.error(apiError(err)),
  });

  // ── header actions ──
  const openPay = useCallback(() => uf.set({ panel: 'tolov' }), [uf]);
  const openPrint = useCallback(
    () => navigate(`/print/statement/client/${id}?from=${from}&to=${to}`),
    [navigate, id, from, to],
  );

  // ── page keyboard: E edit · T payment · P print (§2.6) ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isEditableTarget(e.target)) return;
      switch (e.key) {
        case 't':
        case 'T':
          if (can(role, 'payments.create')) {
            e.preventDefault();
            openPay();
          }
          break;
        case 'e':
        case 'E':
          if (can(role, 'clients.edit')) {
            e.preventDefault();
            setEditOpen(true);
          }
          break;
        case 'p':
        case 'P':
          if (can(role, 'debts.view')) {
            e.preventDefault();
            openPrint();
          }
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [role, openPay, openPrint]);

  // ── loading / error / 404 (§2.7) ──
  if (detailQ.isLoading || (!data && detailQ.isFetching)) {
    return (
      <div>
        <Skeleton.Input active size="small" style={{ width: 200, marginBottom: 20 }} />
        <Skeleton active title paragraph={{ rows: 3 }} />
        <div style={{ marginTop: 28 }}>
          <Skeleton active title={false} paragraph={{ rows: 6 }} />
        </div>
      </div>
    );
  }
  if (detailQ.isError || !data) {
    return (
      <div>
        <ErrorState
          error={detailQ.error ?? new Error('Mijoz topilmadi')}
          message="Mijozni yuklab bo'lmadi"
          onRetry={() => detailQ.refetch()}
        />
        <div style={{ textAlign: 'center', marginTop: -24, paddingBottom: 24 }}>
          <Link to="/clients">Mijozlarga qaytish</Link>
        </div>
      </div>
    );
  }

  // ── derived ──
  const balanceNum = num(data.balance);
  const settledBal = isSettled(data.balance);
  const palletBalance = data.palletBalance ?? 0;
  const isAdmin = hasRole('ADMIN');

  const onDeactivate = () => {
    const reasons: string[] = [];
    if (!settledBal) reasons.push('Balans yopiq emas');
    if (palletBalance !== 0) reasons.push(`${palletBalance} dona paddon qaytarilmagan`);
    if (reasons.length > 0) {
      modal.info({
        title: "Deaktivatsiya qilib bo'lmaydi",
        content: `${reasons.join('; ')} — avval hisob-kitobni yoping.`,
        okText: 'Tushunarli',
      });
      return;
    }
    modal.confirm({
      title: `"${data.name}" nofaol holatga o'tkaziladi`,
      content: "Yangi buyurtma qabul qilolmaydi; tarix saqlanadi.",
      okText: 'Deaktivatsiya',
      okButtonProps: { danger: true },
      cancelText: 'Bekor qilish',
      onOk: () => deactivateMut.mutateAsync(),
    });
  };
  const onReactivate = () => {
    modal.confirm({
      title: `"${data.name}" qayta faollashtiriladi`,
      content: 'Mijoz yana buyurtma qabul qila oladi.',
      okText: 'Faollashtirish',
      cancelText: 'Bekor qilish',
      onOk: () => reactivateMut.mutateAsync(),
    });
  };

  const actions: PartyHeaderAction[] = [
    {
      key: 'pay',
      label: "To'lov qabul qilish",
      icon: <WalletOutlined />,
      primary: true,
      cap: 'payments.create',
      onClick: openPay,
    },
    {
      key: 'order',
      label: 'Yangi buyurtma',
      icon: <ShoppingCartOutlined />,
      cap: 'orders.create',
      disabled: !data.active,
      onClick: () => navigate(`/orders/new?clientId=${id}`),
    },
    {
      key: 'akt',
      label: 'Akt sverki',
      icon: <PrinterOutlined />,
      cap: 'debts.view',
      onClick: openPrint,
    },
    {
      key: 'edit',
      label: 'Tahrirlash',
      icon: <EditOutlined />,
      cap: 'clients.edit',
      onClick: () => setEditOpen(true),
    },
    data.active
      ? {
          key: 'deactivate',
          label: 'Deaktivatsiya',
          icon: <StopOutlined />,
          danger: true,
          cap: 'clients.delete',
          onClick: onDeactivate,
        }
      : {
          key: 'reactivate',
          label: 'Faollashtirish',
          icon: <CheckCircleOutlined />,
          cap: 'clients.delete',
          onClick: onReactivate,
        },
  ];

  const counters: PartyHeaderCounters = {
    pallets: palletBalance,
    overdue: overdueRow
      ? { count: overdueRow.overdueOrdersCount, sum: String(overdueRow.overdueOrdersTotal) }
      : null,
    credit: { limit: data.creditLimit ?? null, used: balanceNum > 0 ? data.balance : '0' },
    extra:
      data.legalEntity || data.paymentTermDays != null ? (
        <span
          style={{
            display: 'inline-flex',
            gap: 12,
            flexWrap: 'wrap',
            fontSize: 12,
            color: token.colorTextSecondary,
          }}
        >
          {data.legalEntity ? <span>Yuridik shaxs: {data.legalEntity}</span> : null}
          {data.paymentTermDays != null ? <span>To'lov muddati: {data.paymentTermDays} kun</span> : null}
        </span>
      ) : undefined,
  };

  const handlePeriod = (r: DateRange) => uf.set({ from: r.from ?? null, to: r.to ?? null });

  // ─────────── tab bodies ───────────

  const now = dayjs();

  const orderColumns: SbColumn<Order>[] = [
    {
      title: '№',
      dataIndex: 'orderNo',
      key: 'orderNo',
      render: (v: string, o) => <Link to={`/orders/${o.id}`}>{v}</Link>,
    },
    { title: 'Sana', dataIndex: 'date', key: 'date', render: (v: string) => fmtDate(v) },
    { title: 'Zavod', key: 'factory', ellipsis: true, width: 160, render: (_, o) => o.factory?.name ?? '—' },
    {
      title: 'Holat',
      dataIndex: 'status',
      key: 'status',
      render: (v: Order['status']) => <StatusChip meta={STATUS[v]} />,
    },
    {
      title: 'Muddat',
      key: 'due',
      render: (_, o) => {
        if (!o.dueDate) return <Typography.Text type="secondary">—</Typography.Text>;
        const overdue = o.status !== 'CANCELLED' && dayjs(o.dueDate).isBefore(now, 'day');
        return overdue ? (
          <span style={{ color: token.colorError, whiteSpace: 'nowrap' }}>{fmtDate(o.dueDate)} · o'tgan</span>
        ) : (
          <span style={{ whiteSpace: 'nowrap' }}>{fmtDate(o.dueDate)}</span>
        );
      },
    },
    {
      title: "Summa (so'm)",
      dataIndex: 'saleTotal',
      key: 'saleTotal',
      align: 'right',
      render: (v: Money) => <MoneyCell value={v} />,
    },
  ];

  const paymentColumns: SbColumn<Payment>[] = [
    { title: 'Sana', dataIndex: 'date', key: 'date', render: (v: string) => fmtDate(v) },
    { title: 'Turi', dataIndex: 'kind', key: 'kind', render: (v: Payment['kind']) => PAYMENT_KIND[v]?.label ?? v },
    {
      title: 'Usul',
      dataIndex: 'method',
      key: 'method',
      render: (v: Payment['method']) => PAYMENT_METHOD[v]?.label ?? v,
    },
    {
      title: "Summa (so'm)",
      dataIndex: 'amount',
      key: 'amount',
      align: 'right',
      render: (v: Money) => <MoneyCell value={v} />,
    },
    {
      title: 'Holati',
      key: 'reconciled',
      render: (_, p) => (!p.voidedAt && !p.reconciled ? <StatusChip meta={UNRECONCILED} /> : null),
    },
    { title: 'Izoh', dataIndex: 'note', key: 'note', ellipsis: true, width: 200, render: (v: string | null) => v || '—' },
  ];

  const renderPriceLine = (row: PriceRow, opts: { highlight?: boolean; badge?: boolean; muted?: boolean }) => (
    <div
      key={row.id}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '7px 10px',
        borderRadius: token.borderRadiusSM,
        background: opts.highlight ? token.colorPrimaryBg : undefined,
        opacity: opts.muted ? 0.65 : 1,
      }}
    >
      <span style={{ color: token.colorTextTertiary, minWidth: 92, fontSize: 12 }}>
        {fmtDate(row.effectiveFrom)}
      </span>
      <span className="num" style={{ fontWeight: opts.highlight ? 600 : 500, flex: 1 }}>
        {fmtPrice(row.pricePerM3)}{' '}
        <span style={{ color: token.colorTextTertiary, fontWeight: 400 }}>so'm/m³</span>
      </span>
      {opts.highlight ? <StatusChip meta={PRICE_CURRENT} /> : null}
      {opts.badge ? <StatusChip meta={PRICE_FUTURE} /> : null}
    </div>
  );

  const priceGroups = (() => {
    const map = new Map<string, { product: PriceRow['product']; rows: PriceRow[] }>();
    for (const p of data.prices ?? []) {
      const key = p.product?.id ?? 'unknown';
      if (!map.has(key)) map.set(key, { product: p.product, rows: [] });
      map.get(key)!.rows.push(p);
    }
    for (const g of map.values()) {
      g.rows.sort((a, b) => dayjs(a.effectiveFrom).valueOf() - dayjs(b.effectiveFrom).valueOf());
    }
    return [...map.values()];
  })();

  const renderTab = (key: string) => {
    switch (key) {
      case 'hisob':
        return (
          <div style={{ paddingTop: 8 }}>
            <PartyStatement partyType="client" partyId={id!} from={from} to={to} />
          </div>
        );

      case 'buyurtmalar':
        return (
          <div style={{ paddingTop: 8 }}>
            <DataTable<Order>
              rowKey="id"
              columns={orderColumns}
              query={ordersQ}
              defaultPageSize={20}
              filterKeys={[]}
              scroll={{ x: 'max-content' }}
              onRowOpen={(o) => navigate(`/orders/${o.id}`)}
              emptyText="Bu mijozda hali buyurtma yo'q"
              emptyAction={
                can(role, 'orders.create') ? (
                  <Button
                    type="primary"
                    icon={<ShoppingCartOutlined />}
                    onClick={() => navigate(`/orders/new?clientId=${id}`)}
                  >
                    Yangi buyurtma
                  </Button>
                ) : undefined
              }
            />
            <div style={{ marginTop: 12 }}>
              <Link to={`/orders?clientId=${id}`}>Hammasini ko'rish →</Link>
            </div>
          </div>
        );

      case 'tolovlar':
        return (
          <div style={{ paddingTop: 8 }}>
            <DataTable<Payment>
              rowKey="id"
              columns={paymentColumns}
              query={paymentsQ}
              defaultPageSize={20}
              filterKeys={[]}
              scroll={{ x: 'max-content' }}
              ghostWhen={(p) => p.voidedAt != null}
              onRowOpen={(p) => navigate(`/payments?peek=${p.id}`)}
              toolbarExtra={
                <Button size="small" onClick={() => uf.set({ bekor: showVoided ? null : '1' })}>
                  {showVoided ? "Bekorlar: yashirish" : "Bekorlar: ko'rsatish"}
                </Button>
              }
              emptyText="Bu mijozda hali to'lov yo'q"
              emptyAction={
                can(role, 'payments.create') ? (
                  <Button type="primary" icon={<WalletOutlined />} onClick={openPay}>
                    To'lov qabul qilish
                  </Button>
                ) : undefined
              }
            />
            <div style={{ marginTop: 12 }}>
              <Link to={`/payments?clientId=${id}`}>Hammasini ko'rish →</Link>
            </div>
          </div>
        );

      case 'taxalluslar':
        return (
          <Space orientation="vertical" style={{ width: '100%', paddingTop: 8 }} size={12}>
            {office && (
              <Space.Compact style={{ width: 380, maxWidth: '100%' }}>
                <Input
                  placeholder="Yangi taxallus (import uchun)"
                  value={aliasName}
                  onChange={(e) => setAliasName(e.target.value)}
                  onPressEnter={() => aliasName.trim() && addAliasMut.mutate(aliasName.trim())}
                />
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  loading={addAliasMut.isPending}
                  disabled={!aliasName.trim()}
                  onClick={() => addAliasMut.mutate(aliasName.trim())}
                >
                  Qo'shish
                </Button>
              </Space.Compact>
            )}
            {data.aliases.length === 0 ? (
              <EmptyState message="Taxallus yo'q — Excel import mos yozuvlarini bog'lash uchun" />
            ) : (
              <List<AliasRow>
                size="small"
                bordered
                dataSource={data.aliases}
                renderItem={(a) => (
                  <List.Item
                    actions={
                      office
                        ? [
                            <Button
                              key="del"
                              size="small"
                              type="text"
                              danger
                              icon={<DeleteOutlined />}
                              onClick={() =>
                                modal.confirm({
                                  title: "Taxallusni o'chirish",
                                  content: `"${a.name}" o'chiriladi — moliyaviy emas, tarixga ta'sir qilmaydi.`,
                                  okText: "O'chirish",
                                  okButtonProps: { danger: true },
                                  cancelText: 'Bekor qilish',
                                  onOk: () => removeAliasMut.mutateAsync(a.id),
                                })
                              }
                            >
                              O'chirish
                            </Button>,
                          ]
                        : undefined
                    }
                  >
                    <span className="num">«{a.name}»</span>
                  </List.Item>
                )}
              />
            )}
          </Space>
        );

      case 'narxlar':
        return (
          <Space orientation="vertical" style={{ width: '100%', paddingTop: 8 }} size={16}>
            {office && (
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Button type="primary" icon={<PlusOutlined />} onClick={() => setPriceOpen(true)}>
                  Yangi narx
                </Button>
              </div>
            )}
            {priceGroups.length === 0 ? (
              <EmptyState
                message="Maxsus narx yo'q — katalog narxi amal qiladi"
                action={
                  office ? (
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => setPriceOpen(true)}>
                      Yangi narx
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              priceGroups.map((g) => {
                const rows = g.rows; // ascending by effectiveFrom
                let curIdx = -1;
                for (let i = 0; i < rows.length; i++) {
                  if (dayjs(rows[i].effectiveFrom).isAfter(now, 'day')) break;
                  curIdx = i;
                }
                const current = curIdx >= 0 ? rows[curIdx] : undefined;
                const future = rows.slice(curIdx + 1);
                const past = curIdx > 0 ? rows.slice(0, curIdx) : [];
                return (
                  <div key={g.product?.id ?? 'unknown'} className="dash-card" style={{ padding: 16 }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 12,
                        marginBottom: 10,
                        paddingBottom: 10,
                        borderBottom: `1px solid ${token.colorBorderSecondary}`,
                      }}
                    >
                      <span style={{ fontWeight: 600, color: token.colorText }}>
                        {g.product
                          ? `${g.product.name}${g.product.size ? ` (${g.product.size})` : ''}`
                          : "Noma'lum mahsulot"}
                      </span>
                    </div>
                    {current ? renderPriceLine(current, { highlight: true }) : null}
                    {future.map((r) => renderPriceLine(r, { badge: true }))}
                    {past.length > 0 ? (
                      <>
                        <div
                          style={{
                            ...overlineStyle,
                            color: token.colorTextTertiary,
                            margin: '10px 0 2px 10px',
                          }}
                        >
                          Oldingi narxlar
                        </div>
                        {[...past].reverse().map((r) => renderPriceLine(r, { muted: true }))}
                      </>
                    ) : null}
                  </div>
                );
              })
            )}
          </Space>
        );

      default:
        return null;
    }
  };

  const tabDefs = [
    { key: 'hisob', label: 'Hisob-kitob' },
    { key: 'buyurtmalar', label: 'Buyurtmalar' },
    { key: 'tolovlar', label: "To'lovlar" },
    ...(office
      ? [
          { key: 'taxalluslar', label: 'Taxalluslar' },
          { key: 'narxlar', label: 'Maxsus narxlar' },
        ]
      : []),
  ];

  const overdueTotal = overdueRow ? String(overdueRow.overdueOrdersTotal) : null;

  return (
    <div>
      <PageHeader
        title={data.name}
        breadcrumb={[{ label: 'Mijozlar', to: '/clients' }]}
        status={<StatusChip meta={data.active ? CLIENT_ACTIVE : CLIENT_INACTIVE} variant="filled" />}
        tabs={tabDefs}
        activeTab={activeTab}
        onTabChange={(k) => uf.set({ tab: k })}
      />

      <PartyBalanceHeader
        party={{
          id: data.id,
          name: data.name,
          active: data.active,
          balance: data.balance,
          agent: data.agent,
          region: data.region,
          phone: data.phone,
        }}
        partyType="client"
        actions={actions}
        counters={counters}
        from={activeTab === 'hisob' ? from : undefined}
        to={activeTab === 'hisob' ? to : undefined}
        onPeriodChange={activeTab === 'hisob' ? handlePeriod : undefined}
      />

      {renderTab(activeTab)}

      <ClientEditDrawer client={data} open={editOpen} onClose={() => setEditOpen(false)} office={office} />
      <PriceDrawer clientId={id!} open={priceOpen} onClose={() => setPriceOpen(false)} />

      <PaymentComposer
        open={uf.get('panel') === 'tolov'}
        onClose={() => uf.set({ panel: null })}
        kind="CLIENT_IN"
        lockParty
        presetParty={{
          id: data.id,
          name: data.name,
          balance: data.balance,
          palletBalance: palletBalance,
          overdueTotal,
        }}
        presetAmount={balanceNum > 0 ? data.balance : undefined}
      />
    </div>
  );
}
