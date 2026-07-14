import { useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App,
  Avatar,
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  Flex,
  Input,
  InputNumber,
  List,
  Progress,
  Radio,
  Row,
  Select,
  Skeleton,
  Space,
  Steps,
  Table,
  Tabs,
  Timeline,
  Tooltip,
  Typography,
  theme,
} from 'antd';
import {
  ContainerOutlined,
  EditOutlined,
  ExclamationCircleOutlined,
  ReloadOutlined,
  SendOutlined,
  StopOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { apiError, asItems, endpoints } from '../lib/api';
import {
  fmtDate,
  fmtDateTime,
  fmtM3,
  fmtMoney,
  num,
  ORDER_STATUS,
  PAYMENT_KIND,
  PAYMENT_METHOD,
} from '../lib/format';
import { COST_STATUS, STATUS, TRANSPORT_PAID, type StatusMeta } from '../lib/status-maps';
import { FormDrawer, MoneyCell, PageHeader, StatusChip, type MoneyVariant, type PageHeaderAction } from '../components';
import { useAuth } from '../auth/AuthContext';
import type {
  Allocation,
  Order,
  OrderItem,
  OrderStatus,
  PaymentKind,
  PaymentMethod,
  TransportMode,
} from '../lib/types';

const STATUS_FLOW: OrderStatus[] = ['NEW', 'CONFIRMED', 'LOADING', 'DELIVERING', 'DELIVERED', 'COMPLETED'];

/** forward action per current status — label is the ACTION, not the state */
const NEXT_ACTION: Partial<Record<OrderStatus, { to: OrderStatus; label: string }>> = {
  NEW: { to: 'CONFIRMED', label: 'Tasdiqlash' },
  CONFIRMED: { to: 'LOADING', label: 'Yuklashni boshlash' },
  LOADING: { to: 'DELIVERING', label: "Yetkazishga jo'natish" },
  DELIVERING: { to: 'DELIVERED', label: 'Yetkazildi deb belgilash' },
  DELIVERED: { to: 'COMPLETED', label: 'Yakunlash' },
};

const TRANSPORT_MODE_LABEL: Record<TransportMode, string> = {
  CLIENT_OWN: "Mijozning o'z transporti",
  DEALER_ABSORBED: 'Diler hisobidan',
  DEALER_CHARGED: 'Mijozdan undiriladi',
};

const PALLET_TX_LABEL: Record<string, string> = {
  RECEIVED_FROM_FACTORY: 'Zavoddan qabul qilindi',
  DELIVERED_TO_CLIENT: 'Mijozga yuborildi',
  RETURNED_BY_CLIENT: 'Mijozdan qaytdi',
  RETURNED_TO_FACTORY: 'Zavodga qaytarildi',
  CHARGED_LOST: "Yo'qotilgan (hisobga o'tkazildi)",
  ADJUSTMENT: 'Tuzatish',
  REVERSAL: 'Storno',
};

/** Narx holati chip — reuses the design-language cost hues (02 §2.5). */
const PRICE_STATE: { pending: StatusMeta; priced: StatusMeta } = {
  pending: { label: 'Narxlanmagan', light: '#9A6700', dark: '#D9A94A' },
  priced: { label: 'Narxlangan', light: '#1A7F37', dark: '#6CC495' },
};

/** profit ink: positive = money-in (green), negative = we-owe (red), zero = neutral. */
const profitVariant = (n: number): MoneyVariant => (n > 0 ? 'in' : n < 0 ? 'weOwe' : 'neutral');

interface PalletTx {
  id: string;
  at: string;
  date: string;
  type: string;
  qty: number;
  note?: string | null;
}

/** detail include tree returns more than the shared Order type declares */
type OrderDetailData = Order & {
  palletTransactions?: PalletTx[];
  createdBy?: { id: string; name: string; username?: string } | null;
  /** dealer→factory cost shown both ways, exact (computed server-side at the order date) */
  costTotalCash?: string;
  costTotalBank?: string;
};

type TimelineEvent =
  | { type: 'status'; at: string; from: OrderStatus | null; to: OrderStatus; by: string | null; note: string | null }
  | {
      type: 'payment';
      at: string;
      paymentId: string;
      kind: PaymentKind;
      method: PaymentMethod;
      amount: string;
      voided: boolean;
    }
  | { type: 'comment'; at: string; by: string | null; text: string };

const moneyFormatter = (v: number | string | undefined) => `${v ?? ''}`.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const moneyParser = (v: string | undefined) => Number((v ?? '').replace(/\s/g, ''));

/** consistent branded surface + optional overline header (design system §layout). */
function Section({
  title,
  extra,
  children,
  style,
  bodyPad = 16,
}: {
  title?: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
  bodyPad?: number;
}) {
  return (
    <div className="dash-card" style={{ padding: bodyPad, ...style }}>
      {title || extra ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            marginBottom: 14,
          }}
        >
          {title ? <span className="sb-overline">{title}</span> : <span />}
          {extra ?? null}
        </div>
      ) : null}
      {children}
    </div>
  );
}

/** one figure row in the finance summary rail. */
function SummaryRow({ label, value, last }: { label: ReactNode; value: ReactNode; last?: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '8px 0',
        borderBottom: last ? undefined : '1px solid var(--sb-border)',
      }}
    >
      <Typography.Text type="secondary" style={{ fontSize: 13 }}>
        {label}
      </Typography.Text>
      <span style={{ textAlign: 'right' }}>{value}</span>
    </div>
  );
}

export default function OrderDetail() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const { token } = theme.useToken();
  const { message, modal } = App.useApp();
  const { hasRole } = useAuth();
  const canManage = hasRole('ADMIN', 'ACCOUNTANT');
  const isAdmin = hasRole('ADMIN');

  const [priceTarget, setPriceTarget] = useState<OrderItem | null>(null);
  const [priceMode, setPriceMode] = useState<'perM3' | 'lump'>('perM3');
  const [priceValue, setPriceValue] = useState<number | null>(null);
  const [commentText, setCommentText] = useState('');
  const [activeTab, setActiveTab] = useState('payments');

  // haqiqiy yuk (actual loading) drawer — actual m³ per item
  const [loadOpen, setLoadOpen] = useState(false);
  const [actualDraft, setActualDraft] = useState<Record<string, number | null>>({});

  // Super-admin metadata tahriri (moshina/haydovchi/izoh) — har qanday status
  const [editOpen, setEditOpen] = useState(false);
  const [editVehicleId, setEditVehicleId] = useState<string | undefined>();
  const [editDriver, setEditDriver] = useState('');
  const [editNote, setEditNote] = useState('');

  const orderQ = useQuery({
    queryKey: ['orders', id],
    queryFn: () => endpoints.order(id) as Promise<OrderDetailData>,
    enabled: !!id,
  });

  const timelineQ = useQuery({
    queryKey: ['orders', id, 'timeline'],
    queryFn: () => endpoints.orderTimeline(id) as Promise<TimelineEvent[]>,
    enabled: !!id,
  });

  const commentsQ = useQuery({
    queryKey: ['orders', id, 'comments'],
    queryFn: () => endpoints.orderComments(id),
    enabled: !!id,
  });

  const vehiclesQ = useQuery({
    queryKey: ['vehicles', 'order-edit'],
    queryFn: () => endpoints.vehicles(),
    enabled: editOpen && isAdmin,
  });

  const adminMut = useMutation({
    mutationFn: (d: { vehicleId?: string | null; driverName?: string | null; note?: string | null }) =>
      endpoints.adminPatchOrder(id, d),
    onSuccess: () => {
      message.success('Buyurtma tahrirlandi');
      qc.invalidateQueries({ queryKey: ['orders'] });
      setEditOpen(false);
    },
    onError: (err) => message.error(apiError(err)),
  });

  const statusMut = useMutation({
    mutationFn: (to: OrderStatus) => endpoints.setOrderStatus(id, to),
    onSuccess: () => {
      message.success('Buyurtma holati yangilandi');
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err) => message.error(apiError(err)),
  });

  const cancelMut = useMutation({
    mutationFn: (reason: string) => endpoints.cancelOrder(id, reason),
    onSuccess: () => {
      message.success('Buyurtma bekor qilindi');
      for (const key of ['orders', 'clients', 'debts', 'pallets', 'payments', 'dashboard']) {
        qc.invalidateQueries({ queryKey: [key] });
      }
    },
    onError: (err) => message.error(apiError(err)),
  });

  const priceMut = useMutation({
    mutationFn: (p: { itemId: string; body: { salePricePerM3?: number; saleLumpSum?: number }; reprice?: boolean }) =>
      p.reprice
        ? endpoints.adminRepriceOrderItem(id, p.itemId, p.body)
        : endpoints.priceOrderItem(id, p.itemId, p.body),
    onSuccess: () => {
      message.success('Pozitsiya narxlandi');
      setPriceTarget(null);
      setPriceValue(null);
      for (const key of ['orders', 'clients', 'debts', 'dashboard']) {
        qc.invalidateQueries({ queryKey: [key] });
      }
    },
    onError: (err) => message.error(apiError(err)),
  });

  const actualLoadMut = useMutation({
    mutationFn: (items: { itemId: string; actualQuantityM3: number }[]) => endpoints.applyActualLoading(id, items),
    onSuccess: () => {
      message.success('Haqiqiy yuk kiritildi — balanslar yangilandi');
      setLoadOpen(false);
      for (const key of ['orders', 'clients', 'debts', 'dashboard', 'factories']) {
        qc.invalidateQueries({ queryKey: [key] });
      }
    },
    onError: (err) => message.error(apiError(err)),
  });

  const commentMut = useMutation({
    mutationFn: (text: string) => endpoints.addOrderComment(id, text),
    onSuccess: () => {
      setCommentText('');
      qc.invalidateQueries({ queryKey: ['orders', id] });
    },
    onError: (err) => message.error(apiError(err)),
  });

  if (orderQ.isLoading) {
    return (
      <Card>
        <Skeleton active paragraph={{ rows: 10 }} />
      </Card>
    );
  }

  if (orderQ.isError) {
    return (
      <Alert
        type="error"
        showIcon
        message="Buyurtmani yuklashda xatolik"
        description={apiError(orderQ.error)}
        action={
          <Button icon={<ReloadOutlined />} onClick={() => orderQ.refetch()}>
            Qayta urinish
          </Button>
        }
      />
    );
  }

  const order = orderQ.data;
  if (!order) return null;

  const next = order.status === 'CANCELLED' ? undefined : NEXT_ACTION[order.status];
  const cancelled = order.status === 'CANCELLED';

  // actual load can be captured once goods have left the factory (LOADING onward) and
  // before the factory cost is finalized — Admin/Accountant only, mirrors the backend gate.
  const canEnterActual =
    canManage &&
    !cancelled &&
    order.costStatus === 'PROVISIONAL' &&
    (['LOADING', 'DELIVERING', 'DELIVERED'] as OrderStatus[]).includes(order.status);

  const openActual = () => {
    const draft: Record<string, number | null> = {};
    for (const it of order.items ?? []) {
      draft[it.id] = it.actualQuantityM3 != null ? num(it.actualQuantityM3) : num(it.quantityM3);
    }
    setActualDraft(draft);
    setLoadOpen(true);
  };

  const submitActual = () => {
    const items: { itemId: string; actualQuantityM3: number }[] = [];
    for (const it of order.items ?? []) {
      const v = actualDraft[it.id];
      if (v != null && v > 0) items.push({ itemId: it.id, actualQuantityM3: v });
    }
    if (!items.length) {
      message.warning('Kamida bitta pozitsiya uchun haqiqiy hajm kiriting');
      return;
    }
    actualLoadMut.mutate(items);
  };

  const openCancel = () => {
    let reason = '';
    modal.confirm({
      title: 'Buyurtmani bekor qilish',
      icon: <ExclamationCircleOutlined />,
      content: (
        <Space orientation="vertical" size={8} style={{ width: '100%' }}>
          <Typography.Text>
            Barcha moliyaviy yozuvlar storno qilinadi, to&apos;lovlar mijoz hisobida qoladi.
          </Typography.Text>
          <Input.TextArea
            rows={3}
            maxLength={2000}
            placeholder="Bekor qilish sababi (majburiy)"
            onChange={(e) => {
              reason = e.target.value;
            }}
          />
        </Space>
      ),
      okText: 'Bekor qilish',
      okButtonProps: { danger: true },
      cancelText: 'Yopish',
      onOk: async () => {
        if (!reason.trim()) {
          message.warning('Sabab kiritilishi shart');
          return Promise.reject(new Error('reason required'));
        }
        await cancelMut.mutateAsync(reason.trim());
      },
    });
  };

  const submitPrice = () => {
    if (!priceTarget) return;
    if (!priceValue || priceValue <= 0) {
      message.warning('Musbat qiymat kiriting');
      return;
    }
    priceMut.mutate({
      itemId: priceTarget.id,
      body: priceMode === 'perM3' ? { salePricePerM3: priceValue } : { saleLumpSum: priceValue },
      reprice: !priceTarget.pricePending, // narxlangan pozitsiya → admin tuzatish (ledger delta)
    });
  };

  // ── items ──
  const anyPending = (order.items ?? []).some((i) => i.pricePending);
  const dash = <span style={{ color: token.colorTextTertiary }}>—</span>;
  const itemColumns: ColumnsType<OrderItem> = [
    { title: 'Mahsulot', key: 'product', ellipsis: true, width: 220, render: (_, r) => r.product?.name ?? '—' },
    { title: "O'lcham", key: 'size', ellipsis: true, width: 120, render: (_, r) => r.product?.size ?? '—' },
    {
      title: 'Hajm',
      key: 'quantityM3',
      align: 'right',
      className: 'num',
      render: (_, r) => {
        const hasActual = r.actualQuantityM3 != null && num(r.actualQuantityM3) !== num(r.quantityM3);
        return hasActual ? (
          <Tooltip title={`Rejadagi hajm: ${fmtM3(r.quantityM3)}`}>
            <span>
              {fmtM3(r.actualQuantityM3)}{' '}
              <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                haqiqiy
              </Typography.Text>
            </span>
          </Tooltip>
        ) : (
          fmtM3(r.quantityM3)
        );
      },
    },
    { title: 'Pallet', key: 'palletCount', align: 'right', className: 'num', render: (_, r) => r.palletCount },
    {
      title: '1 m³ narxi',
      key: 'salePricePerM3',
      align: 'right',
      className: 'num',
      render: (_, r) => (r.pricePending ? dash : <MoneyCell value={r.salePricePerM3} />),
    },
    {
      title: 'Summa',
      key: 'saleTotal',
      align: 'right',
      className: 'num',
      render: (_, r) => (r.pricePending ? dash : <MoneyCell value={r.saleTotal} strong />),
    },
    {
      title: 'Narx holati',
      key: 'pricePending',
      render: (_, r) => <StatusChip meta={r.pricePending ? PRICE_STATE.pending : PRICE_STATE.priced} />,
    },
    ...(!cancelled && ((canManage && anyPending) || isAdmin)
      ? ([
          {
            title: '',
            key: 'actions',
            align: 'right' as const,
            render: (_: unknown, r: OrderItem) =>
              r.pricePending ? (
                canManage ? (
                  <Button
                    size="small"
                    type="primary"
                    ghost
                    onClick={() => {
                      setPriceTarget(r);
                      setPriceMode('perM3');
                      setPriceValue(null);
                    }}
                  >
                    Narxlash
                  </Button>
                ) : null
              ) : isAdmin ? (
                <Button
                  size="small"
                  icon={<EditOutlined />}
                  onClick={() => {
                    setPriceTarget(r);
                    setPriceMode('perM3');
                    setPriceValue(null);
                  }}
                >
                  Narxni tuzatish
                </Button>
              ) : null,
          },
        ] as ColumnsType<OrderItem>)
      : []),
  ];

  // ── money summary (display-only arithmetic via num) ──
  const costCash = num(order.costTotalCash ?? order.costTotal);
  const costBank = num(order.costTotalBank ?? order.costTotal);
  const goodsProfit = num(order.saleTotal) - num(order.costTotal);
  const profitCash = num(order.saleTotal) - costCash;
  const profitBank = num(order.saleTotal) - costBank;
  const costFinal = order.costStatus === 'FINAL';
  const transportProfit = num(order.transportCharge) - num(order.transportCost);

  // ── allocations ──
  const activeAllocs = (order.allocations ?? []).filter((a) => !a.voidedAt && !a.payment?.voidedAt);
  const clientAllocated = activeAllocs
    .filter((a) => a.payment?.kind === 'CLIENT_IN')
    .reduce((s, a) => s + num(a.amount), 0);
  const saleNum = num(order.saleTotal);
  const allocPercent = saleNum > 0 ? Math.min(100, Math.round((clientAllocated / saleNum) * 100)) : 0;

  const allocColumns: ColumnsType<Allocation> = [
    { title: 'Sana', key: 'date', render: (_, r) => fmtDate(r.payment?.date) },
    { title: 'Turi', key: 'kind', render: (_, r) => (r.payment ? PAYMENT_KIND[r.payment.kind] : '—') },
    { title: 'Usul', key: 'method', render: (_, r) => (r.payment ? PAYMENT_METHOD[r.payment.method] : '—') },
    {
      title: 'Summa',
      key: 'amount',
      align: 'right',
      className: 'num',
      render: (_, r) => <MoneyCell value={r.amount} />,
    },
    {
      title: '',
      key: 'link',
      render: (_, r) => <Link to={`/payments?paymentId=${r.paymentId}`}>To&apos;lov</Link>,
    },
  ];

  const palletColumns: ColumnsType<PalletTx> = [
    { title: 'Sana', key: 'date', render: (_, r) => fmtDate(r.date) },
    { title: 'Turi', key: 'type', render: (_, r) => PALLET_TX_LABEL[r.type] ?? r.type },
    { title: 'Soni', key: 'qty', align: 'right', className: 'num', render: (_, r) => r.qty },
    { title: 'Izoh', key: 'note', render: (_, r) => r.note ?? '—' },
  ];

  // ── timeline (semantic hues via tokens) ──
  const timelineItems = (timelineQ.data ?? []).map((ev) => {
    if (ev.type === 'status') {
      return {
        color:
          ev.to === 'CANCELLED'
            ? token.colorError
            : ev.to === 'COMPLETED'
              ? token.colorSuccess
              : token.colorPrimary,
        children: (
          <Space orientation="vertical" size={0}>
            <Space size={8} wrap>
              <StatusChip meta={STATUS[ev.to]} />
              <Typography.Text type="secondary">{fmtDateTime(ev.at)}</Typography.Text>
              {ev.by && <Typography.Text type="secondary">{ev.by}</Typography.Text>}
            </Space>
            {ev.note && <Typography.Text type="secondary">{ev.note}</Typography.Text>}
          </Space>
        ),
      };
    }
    if (ev.type === 'payment') {
      return {
        color: ev.voided ? token.colorError : token.colorSuccess,
        children: (
          <Space size={8} wrap>
            <Typography.Text strong>{PAYMENT_KIND[ev.kind]}</Typography.Text>
            <Typography.Text>({PAYMENT_METHOD[ev.method]})</Typography.Text>
            <MoneyCell value={ev.amount} />
            <Typography.Text type="secondary">{fmtDateTime(ev.at)}</Typography.Text>
            {ev.voided && <StatusChip meta={STATUS.CANCELLED} />}
          </Space>
        ),
      };
    }
    return {
      color: token.colorTextTertiary,
      children: (
        <Space orientation="vertical" size={0}>
          <Space size={8} wrap>
            <Typography.Text strong>{ev.by ?? "Noma'lum"}</Typography.Text>
            <Typography.Text type="secondary">{fmtDateTime(ev.at)}</Typography.Text>
          </Space>
          <Typography.Text>{ev.text}</Typography.Text>
        </Space>
      ),
    };
  });

  const tabs = [
    {
      key: 'payments',
      label: "To'lovlar",
      children: (
        <Space orientation="vertical" size={16} style={{ width: '100%' }}>
          <div>
            <Typography.Text type="secondary">
              Mijozdan qabul qilingan: <MoneyCell value={clientAllocated} /> / <MoneyCell value={order.saleTotal} />
            </Typography.Text>
            <Progress percent={allocPercent} status={allocPercent >= 100 ? 'success' : 'active'} />
          </div>
          <Table<Allocation>
            rowKey="id"
            size="small"
            columns={allocColumns}
            dataSource={activeAllocs}
            pagination={false}
            locale={{ emptyText: <Empty description="Allokatsiyalar yo'q" /> }}
          />
        </Space>
      ),
    },
    {
      key: 'pallets',
      label: 'Paddonlar',
      children: (
        <Table<PalletTx>
          rowKey="id"
          size="small"
          columns={palletColumns}
          dataSource={order.palletTransactions ?? []}
          pagination={false}
          locale={{ emptyText: <Empty description="Paddon harakatlari yo'q" /> }}
        />
      ),
    },
    {
      key: 'timeline',
      label: 'Tarix',
      children: timelineQ.isError ? (
        <Alert
          type="error"
          showIcon
          message="Tarixni yuklashda xatolik"
          description={apiError(timelineQ.error)}
          action={
            <Button icon={<ReloadOutlined />} onClick={() => timelineQ.refetch()}>
              Qayta urinish
            </Button>
          }
        />
      ) : timelineQ.isLoading ? (
        <Skeleton active />
      ) : timelineItems.length === 0 ? (
        <Empty description="Hodisalar yo'q" />
      ) : (
        <Timeline items={timelineItems} style={{ marginTop: 8 }} />
      ),
    },
    {
      key: 'comments',
      label: 'Izohlar',
      children: (
        <Space orientation="vertical" size={16} style={{ width: '100%' }}>
          {commentsQ.isError ? (
            <Alert
              type="error"
              showIcon
              message="Izohlarni yuklashda xatolik"
              description={apiError(commentsQ.error)}
              action={
                <Button icon={<ReloadOutlined />} onClick={() => commentsQ.refetch()}>
                  Qayta urinish
                </Button>
              }
            />
          ) : (
            <List
              loading={commentsQ.isLoading}
              dataSource={commentsQ.data ?? []}
              locale={{ emptyText: <Empty description="Izohlar yo'q" /> }}
              renderItem={(c) => (
                <List.Item>
                  <List.Item.Meta
                    avatar={<Avatar size="small">{c.by?.name?.[0] ?? '?'}</Avatar>}
                    title={
                      <Space size={8}>
                        <span>{c.by?.name ?? "Noma'lum"}</span>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {fmtDateTime(c.createdAt)}
                        </Typography.Text>
                      </Space>
                    }
                    description={c.text}
                  />
                </List.Item>
              )}
            />
          )}
          <Flex gap={8}>
            <Input.TextArea
              rows={2}
              maxLength={4000}
              value={commentText}
              placeholder="Izoh yozing..."
              onChange={(e) => setCommentText(e.target.value)}
            />
            <Button
              type="primary"
              icon={<SendOutlined />}
              loading={commentMut.isPending}
              disabled={!commentText.trim()}
              onClick={() => commentMut.mutate(commentText.trim())}
            >
              Yuborish
            </Button>
          </Flex>
        </Space>
      ),
    },
  ];

  const headerActions: PageHeaderAction[] = [
    ...(next
      ? [
          {
            key: 'next',
            label: next.label,
            primary: true,
            disabled: statusMut.isPending,
            onClick: () => statusMut.mutate(next.to),
          },
        ]
      : []),
    ...(canEnterActual
      ? [
          {
            key: 'actual',
            label: 'Haqiqiy yuk',
            icon: <ContainerOutlined />,
            onClick: openActual,
          },
        ]
      : []),
    ...(isAdmin && !cancelled
      ? [
          {
            key: 'edit',
            label: 'Tahrirlash',
            icon: <EditOutlined />,
            onClick: () => {
              setEditVehicleId(order.vehicle?.id ?? undefined);
              setEditDriver(order.driverName ?? '');
              setEditNote(order.note ?? '');
              setEditOpen(true);
            },
          },
        ]
      : []),
    ...(canManage && !cancelled
      ? [
          {
            key: 'cancel',
            label: 'Bekor qilish',
            icon: <StopOutlined />,
            danger: true,
            disabled: cancelMut.isPending,
            onClick: openCancel,
          },
        ]
      : []),
  ];

  return (
    <div>
      <PageHeader
        title={order.orderNo}
        accent
        breadcrumb={[{ label: 'Buyurtmalar', to: '/orders' }, { label: order.orderNo }]}
        status={<StatusChip meta={STATUS[order.status]} variant="filled" />}
        meta={
          <>
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>
              {fmtDate(order.date)}
            </Typography.Text>
            <Link to={`/clients/${order.clientId}`} style={{ fontSize: 13 }}>
              {order.client?.name ?? 'Mijoz'}
            </Link>
          </>
        }
        actions={headerActions}
      />

      <Row gutter={[20, 20]}>
        <Col xs={24} lg={16}>
          <Space orientation="vertical" size={20} style={{ width: '100%' }}>
            <Section title="Holat">
              {cancelled ? (
                <Alert
                  type="error"
                  showIcon
                  message="Buyurtma bekor qilingan"
                  description={order.cancelReason || undefined}
                />
              ) : (
                <Steps
                  size="small"
                  current={STATUS_FLOW.indexOf(order.status)}
                  items={STATUS_FLOW.map((s) => ({ title: ORDER_STATUS[s].label }))}
                />
              )}
            </Section>

            <Section title="Ma'lumotlar">
              <Descriptions
                size="small"
                column={{ xs: 1, md: 2 }}
                items={[
                  { key: 'agent', label: 'Agent', children: order.agent?.name ?? '—' },
                  { key: 'factory', label: 'Zavod', children: order.factory?.name ?? '—' },
                  {
                    key: 'vehicle',
                    label: 'Moshina',
                    children: order.vehicle
                      ? `${order.vehicle.name}${order.vehicle.plate ? ` (${order.vehicle.plate})` : ''}`
                      : '—',
                  },
                  { key: 'driver', label: 'Haydovchi', children: order.driverName ?? '—' },
                  { key: 'dueDate', label: "To'lov muddati", children: fmtDate(order.dueDate) },
                  {
                    key: 'costStatus',
                    label: 'Tannarx holati',
                    children: <StatusChip meta={COST_STATUS[order.costStatus]} />,
                  },
                  {
                    key: 'created',
                    label: 'Yaratilgan',
                    children: `${fmtDateTime(order.createdAt)}${order.createdBy?.name ? ` — ${order.createdBy.name}` : ''}`,
                  },
                  { key: 'note', label: 'Izoh', children: order.note ?? '—' },
                ]}
              />
            </Section>

            <Section title="Pozitsiyalar">
              <Table<OrderItem>
                rowKey="id"
                size="small"
                columns={itemColumns}
                dataSource={order.items ?? []}
                pagination={false}
                scroll={{ x: 900 }}
              />
            </Section>

            <Section bodyPad={0} style={{ padding: '4px 16px 8px' }}>
              <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabs} />
            </Section>
          </Space>
        </Col>

        <Col xs={24} lg={8}>
          <div className="dash-card" style={{ padding: 18, position: 'sticky', top: 64 }}>
            <div className="sb-overline" style={{ marginBottom: 8 }}>
              Moliya
            </div>
            <SummaryRow label="Savdo summasi" value={<MoneyCell value={order.saleTotal} strong />} />
            {costFinal ? (
              <>
                <SummaryRow
                  label="Zavod tannarxi (to'langan)"
                  value={
                    <Space size={8}>
                      <MoneyCell value={order.costTotal} strong />
                      <StatusChip meta={COST_STATUS[order.costStatus]} />
                    </Space>
                  }
                />
                <SummaryRow
                  label="Tovar foydasi"
                  last
                  value={<MoneyCell value={goodsProfit} signed strong variant={profitVariant(goodsProfit)} />}
                />
              </>
            ) : (
              <>
                <SummaryRow
                  label="Zavod tannarxi — naqd"
                  value={<MoneyCell value={costCash} strong />}
                />
                <SummaryRow
                  label="Zavod tannarxi — bank"
                  value={<MoneyCell value={costBank} strong />}
                />
                <SummaryRow
                  label="Tovar foydasi (naqd)"
                  value={<MoneyCell value={profitCash} signed variant={profitVariant(profitCash)} />}
                />
                <SummaryRow
                  label="Tovar foydasi (bank)"
                  last
                  value={<MoneyCell value={profitBank} signed variant={profitVariant(profitBank)} />}
                />
              </>
            )}

            <div className="sb-overline" style={{ margin: '20px 0 8px' }}>
              Transport
            </div>
            <SummaryRow label="Rejim" value={TRANSPORT_MODE_LABEL[order.transportMode]} />
            <SummaryRow label="Transport xarajati" value={<MoneyCell value={order.transportCost} />} />
            <SummaryRow label="Mijozdan undiriladigan" value={<MoneyCell value={order.transportCharge} />} />
            <SummaryRow
              label="Transport foydasi"
              value={<MoneyCell value={transportProfit} signed variant={profitVariant(transportProfit)} />}
            />
            <SummaryRow label="To'lov holati" last value={<StatusChip meta={TRANSPORT_PAID[order.transportPaidStatus]} />} />
          </div>
        </Col>
      </Row>

      <FormDrawer
        open={!!priceTarget}
        title={`${priceTarget && !priceTarget.pricePending ? 'Narxni tuzatish' : 'Narxlash'} — ${priceTarget?.product?.name ?? ''}`}
        submitText="Saqlash"
        cancelText="Yopish"
        submitting={priceMut.isPending}
        onClose={() => {
          setPriceTarget(null);
          setPriceValue(null);
        }}
        onSubmit={submitPrice}
      >
        <Space orientation="vertical" size={12} style={{ width: '100%' }}>
          {priceTarget && !priceTarget.pricePending && (
            <Alert
              type="warning"
              showIcon
              message={`Joriy summa: ${fmtMoney(priceTarget.saleTotal)} so'm. Yangi summa bilan farqi mijoz balansiga tuzatma sifatida yoziladi (zavod tannarxi va bonusga tegilmaydi).`}
            />
          )}
          {priceTarget && (
            <Typography.Text type="secondary">Hajm: {fmtM3(priceTarget.quantityM3)}</Typography.Text>
          )}
          <Radio.Group
            value={priceMode}
            onChange={(e) => {
              setPriceMode(e.target.value as 'perM3' | 'lump');
              setPriceValue(null);
            }}
            options={[
              { label: "1 m³ narxi bo'yicha", value: 'perM3' },
              { label: 'Umumiy summa (kelishilgan)', value: 'lump' },
            ]}
          />
          <InputNumber<number>
            style={{ width: '100%' }}
            min={0}
            formatter={moneyFormatter}
            parser={moneyParser}
            value={priceValue}
            onChange={(v) => setPriceValue(v)}
            placeholder={priceMode === 'perM3' ? "1 m³ uchun narx (so'm)" : "Umumiy summa (so'm)"}
          />
        </Space>
      </FormDrawer>

      <FormDrawer
        open={editOpen}
        title={`Tahrirlash — ${order.orderNo}`}
        submitText="Saqlash"
        cancelText="Yopish"
        submitting={adminMut.isPending}
        onClose={() => setEditOpen(false)}
        onSubmit={() =>
          adminMut.mutate({
            vehicleId: editVehicleId ?? null,
            driverName: editDriver.trim() || null,
            note: editNote.trim() || null,
          })
        }
      >
        <Space orientation="vertical" size={12} style={{ width: '100%' }}>
          <Alert
            type="info"
            showIcon
            message="Faqat moshina, haydovchi va izoh o'zgartiriladi. Moliyaviy ma'lumot (narx, hajm, summa, tannarx) o'zgarmaydi — logika buzilmaydi."
          />
          <div>
            <Typography.Text type="secondary">Moshina</Typography.Text>
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              style={{ width: '100%', marginTop: 4 }}
              placeholder="Moshina tanlang"
              loading={vehiclesQ.isFetching}
              value={editVehicleId}
              onChange={(v) => setEditVehicleId(v)}
              options={asItems(vehiclesQ.data).map((v) => ({
                value: v.id,
                label: `${v.name}${v.plate ? ` (${v.plate})` : ''}`,
              }))}
            />
          </div>
          <div>
            <Typography.Text type="secondary">Haydovchi</Typography.Text>
            <Input
              style={{ marginTop: 4 }}
              maxLength={200}
              placeholder="Haydovchi ismi"
              value={editDriver}
              onChange={(e) => setEditDriver(e.target.value)}
            />
          </div>
          <div>
            <Typography.Text type="secondary">Izoh</Typography.Text>
            <Input.TextArea
              style={{ marginTop: 4 }}
              rows={2}
              maxLength={2000}
              placeholder="Izoh (ixtiyoriy)"
              value={editNote}
              onChange={(e) => setEditNote(e.target.value)}
            />
          </div>
        </Space>
      </FormDrawer>

      <FormDrawer
        open={loadOpen}
        title={`Haqiqiy yuk — ${order.orderNo}`}
        submitText="Saqlash"
        cancelText="Yopish"
        submitting={actualLoadMut.isPending}
        onClose={() => setLoadOpen(false)}
        onSubmit={submitActual}
      >
        <Space orientation="vertical" size={12} style={{ width: '100%' }}>
          <Alert
            type="info"
            showIcon
            message="Zavoddan chiqqan haqiqiy hajm (m³)"
            description="Barcha balanslar (mijoz sotuvi va zavod tannarxi) shu hajmga moslashadi. Kelishilgan qat'iy summalar va transport (moshinaga) o'zgarmaydi. Narx bu yerda kiritilmaydi."
          />
          {(order.items ?? []).map((it) => (
            <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Typography.Text ellipsis style={{ display: 'block' }}>
                  {it.product?.name ?? '—'}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  Rejadagi: {fmtM3(it.quantityM3)}
                  {it.pricePending ? ' · narxsiz' : ''}
                </Typography.Text>
              </div>
              <InputNumber<number>
                style={{ width: 160 }}
                min={0}
                step={0.001}
                className="num"
                addonAfter="m³"
                value={actualDraft[it.id] ?? null}
                onChange={(v) => setActualDraft((d) => ({ ...d, [it.id]: v }))}
              />
            </div>
          ))}
        </Space>
      </FormDrawer>
    </div>
  );
}
