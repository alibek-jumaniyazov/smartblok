import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
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
  Modal,
  Progress,
  Radio,
  Row,
  Skeleton,
  Space,
  Steps,
  Table,
  Tabs,
  Tag,
  Timeline,
  Typography,
} from 'antd';
import {
  ArrowLeftOutlined,
  ExclamationCircleOutlined,
  ReloadOutlined,
  SendOutlined,
  StopOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { apiError, endpoints } from '../lib/api';
import {
  fmtDate,
  fmtDateTime,
  fmtM3,
  num,
  ORDER_STATUS,
  PAYMENT_KIND,
  PAYMENT_METHOD,
} from '../lib/format';
import { Money } from '../components/Money';
import { CostStatusTag, OrderStatusTag, TransportPaidTag } from '../components/StatusTag';
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

export default function OrderDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { message, modal } = App.useApp();
  const { hasRole } = useAuth();
  const canManage = hasRole('ADMIN', 'ACCOUNTANT');

  const [priceTarget, setPriceTarget] = useState<OrderItem | null>(null);
  const [priceMode, setPriceMode] = useState<'perM3' | 'lump'>('perM3');
  const [priceValue, setPriceValue] = useState<number | null>(null);
  const [commentText, setCommentText] = useState('');

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
    mutationFn: (p: { itemId: string; body: { salePricePerM3?: number; saleLumpSum?: number } }) =>
      endpoints.priceOrderItem(id, p.itemId, p.body),
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

  const openCancel = () => {
    let reason = '';
    modal.confirm({
      title: 'Buyurtmani bekor qilish',
      icon: <ExclamationCircleOutlined />,
      content: (
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
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
    });
  };

  // ── items ──
  const anyPending = (order.items ?? []).some((i) => i.pricePending);
  const itemColumns: ColumnsType<OrderItem> = [
    { title: 'Mahsulot', key: 'product', render: (_, r) => r.product?.name ?? '—' },
    { title: "O'lcham", key: 'size', render: (_, r) => r.product?.size ?? '—' },
    { title: 'Hajm', key: 'quantityM3', align: 'right', className: 'num', render: (_, r) => fmtM3(r.quantityM3) },
    { title: 'Pallet', key: 'palletCount', align: 'right', className: 'num', render: (_, r) => r.palletCount },
    {
      title: '1 m³ narxi',
      key: 'salePricePerM3',
      align: 'right',
      className: 'num',
      render: (_, r) => (r.pricePending ? '—' : <Money value={r.salePricePerM3} />),
    },
    {
      title: 'Summa',
      key: 'saleTotal',
      align: 'right',
      className: 'num',
      render: (_, r) => (r.pricePending ? '—' : <Money value={r.saleTotal} strong />),
    },
    {
      title: 'Narx holati',
      key: 'pricePending',
      render: (_, r) =>
        r.pricePending ? <Tag color="warning">Narxlanmagan</Tag> : <Tag color="success">Narxlangan</Tag>,
    },
    ...(canManage && anyPending && !cancelled
      ? ([
          {
            title: '',
            key: 'actions',
            render: (_: unknown, r: OrderItem) =>
              r.pricePending ? (
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
              ) : null,
          },
        ] as ColumnsType<OrderItem>)
      : []),
  ];

  // ── money summary (display-only arithmetic via num) ──
  const goodsProfit = num(order.saleTotal) - num(order.costTotal);
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
      render: (_, r) => <Money value={r.amount} />,
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

  // ── timeline ──
  const timelineItems = (timelineQ.data ?? []).map((ev) => {
    if (ev.type === 'status') {
      return {
        color: ev.to === 'CANCELLED' ? 'red' : ev.to === 'COMPLETED' ? 'green' : 'blue',
        children: (
          <Space direction="vertical" size={0}>
            <Space size={8} wrap>
              <OrderStatusTag status={ev.to} />
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
        color: ev.voided ? 'red' : 'green',
        children: (
          <Space size={8} wrap>
            <Typography.Text strong>{PAYMENT_KIND[ev.kind]}</Typography.Text>
            <Typography.Text>({PAYMENT_METHOD[ev.method]})</Typography.Text>
            <Money value={ev.amount} />
            <Typography.Text type="secondary">{fmtDateTime(ev.at)}</Typography.Text>
            {ev.voided && <Tag color="red">Bekor qilingan</Tag>}
          </Space>
        ),
      };
    }
    return {
      color: 'gray',
      children: (
        <Space direction="vertical" size={0}>
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
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div>
            <Typography.Text type="secondary">
              Mijozdan qabul qilingan: <Money value={clientAllocated} /> / <Money value={order.saleTotal} />
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
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
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

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card>
        <Flex justify="space-between" align="flex-start" wrap gap={12}>
          <Space direction="vertical" size={4}>
            <Space size={12} wrap>
              <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/orders')} />
              <Typography.Title level={3} style={{ margin: 0 }}>
                {order.orderNo}
              </Typography.Title>
              <OrderStatusTag status={order.status} />
            </Space>
            <Space size={12} wrap>
              <Typography.Text type="secondary">{fmtDate(order.date)}</Typography.Text>
              <Link to={`/clients/${order.clientId}`}>{order.client?.name ?? 'Mijoz'}</Link>
            </Space>
          </Space>
          <Space wrap>
            {next && (
              <Button type="primary" loading={statusMut.isPending} onClick={() => statusMut.mutate(next.to)}>
                {next.label}
              </Button>
            )}
            {canManage && !cancelled && (
              <Button danger icon={<StopOutlined />} loading={cancelMut.isPending} onClick={openCancel}>
                Bekor qilish
              </Button>
            )}
          </Space>
        </Flex>

        <div style={{ marginTop: 20 }}>
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
        </div>
      </Card>

      <Card title="Ma'lumotlar">
        <Descriptions
          size="small"
          column={{ xs: 1, md: 2, xl: 3 }}
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
              children: <CostStatusTag status={order.costStatus} />,
            },
            {
              key: 'created',
              label: 'Yaratilgan',
              children: `${fmtDateTime(order.createdAt)}${order.createdBy?.name ? ` — ${order.createdBy.name}` : ''}`,
            },
            { key: 'note', label: 'Izoh', children: order.note ?? '—' },
          ]}
        />
      </Card>

      <Card title="Pozitsiyalar">
        <Table<OrderItem>
          rowKey="id"
          size="small"
          columns={itemColumns}
          dataSource={order.items ?? []}
          pagination={false}
          scroll={{ x: 900 }}
        />
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} md={12}>
          <Card title="Moliya">
            <Descriptions
              size="small"
              column={1}
              items={[
                { key: 'sale', label: 'Savdo summasi', children: <Money value={order.saleTotal} strong /> },
                {
                  key: 'cost',
                  label: 'Tannarx',
                  children: (
                    <Space size={8}>
                      <Money value={order.costTotal} />
                      <CostStatusTag status={order.costStatus} />
                    </Space>
                  ),
                },
                {
                  key: 'profit',
                  label: 'Tovar foydasi',
                  children: <Money value={goodsProfit} signed strong />,
                },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card title="Transport">
            <Descriptions
              size="small"
              column={1}
              items={[
                { key: 'mode', label: 'Rejim', children: TRANSPORT_MODE_LABEL[order.transportMode] },
                { key: 'cost', label: 'Transport xarajati', children: <Money value={order.transportCost} /> },
                {
                  key: 'charge',
                  label: 'Mijozdan undiriladigan',
                  children: <Money value={order.transportCharge} />,
                },
                {
                  key: 'profit',
                  label: 'Transport foydasi',
                  children: <Money value={transportProfit} signed />,
                },
                {
                  key: 'paid',
                  label: "To'lov holati",
                  children: <TransportPaidTag status={order.transportPaidStatus} />,
                },
              ]}
            />
          </Card>
        </Col>
      </Row>

      <Card>
        <Tabs defaultActiveKey="payments" items={tabs} />
      </Card>

      <Modal
        open={!!priceTarget}
        title={`Narxlash — ${priceTarget?.product?.name ?? ''}`}
        okText="Saqlash"
        cancelText="Yopish"
        confirmLoading={priceMut.isPending}
        onCancel={() => {
          setPriceTarget(null);
          setPriceValue(null);
        }}
        onOk={submitPrice}
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
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
      </Modal>
    </Space>
  );
}
