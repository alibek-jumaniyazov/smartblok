import { useMemo, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  DatePicker,
  Descriptions,
  Divider,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { DescriptionsProps, TableColumnsType } from 'antd';
import { DeleteOutlined, EyeOutlined, PlusOutlined, StopOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { apiError, asItems, endpoints } from '../lib/api';
import { fmtDate, fmtDateTime, fmtMoney, fmtNum, fmtUZS, PAYMENT_KIND, PAYMENT_METHOD } from '../lib/format';
import { Money } from '../components/Money';
import { useAuth } from '../auth/AuthContext';
import type { Allocation, Cashbox, Payment, PaymentKind, PaymentMethod } from '../lib/types';

/** kind → required party fields + whether a cashbox is involved (mirrors payments.service) */
const KIND_SPEC: Record<PaymentKind, { client: boolean; factory: boolean; vehicle: boolean; cashbox: boolean }> = {
  CLIENT_IN: { client: true, factory: false, vehicle: false, cashbox: true },
  CLIENT_REFUND: { client: true, factory: false, vehicle: false, cashbox: true },
  FACTORY_OUT: { client: false, factory: true, vehicle: false, cashbox: true },
  FACTORY_REFUND: { client: false, factory: true, vehicle: false, cashbox: true },
  VEHICLE_OUT: { client: false, factory: false, vehicle: true, cashbox: true },
  TRANSPORT_DIRECT: { client: true, factory: false, vehicle: true, cashbox: false },
};

const ALLOCATABLE: readonly PaymentKind[] = ['CLIENT_IN', 'FACTORY_OUT', 'VEHICLE_OUT', 'TRANSPORT_DIRECT'];

const KIND_COLOR: Record<PaymentKind, string> = {
  CLIENT_IN: 'green',
  CLIENT_REFUND: 'volcano',
  FACTORY_OUT: 'blue',
  FACTORY_REFUND: 'cyan',
  VEHICLE_OUT: 'purple',
  TRANSPORT_DIRECT: 'geekblue',
};

/** detail endpoint extras beyond the shared Payment type */
type PaymentDetail = Payment & {
  ledgerEntries?: {
    id: string;
    date: string;
    account: string;
    source: string;
    amount: string;
    note?: string | null;
  }[];
  cashTransactions?: { id: string; date: string; direction: string; amount: string }[];
  createdBy?: { id: string; name: string } | null;
  voidedBy?: { id: string; name: string } | null;
};

const moneyFormatter = (v: string | number | undefined) =>
  `${v ?? ''}`.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const moneyParser = (v: string | undefined) => Number((v ?? '').replace(/\s/g, ''));

const positiveRule = {
  validator: (_: unknown, v: number | undefined) =>
    v == null || v > 0 ? Promise.resolve() : Promise.reject(new Error("Musbat son bo'lishi kerak")),
};

function selectError(q: { isError: boolean; refetch: () => unknown }) {
  if (!q.isError) return undefined;
  return (
    <Alert
      type="error"
      showIcon
      message="Yuklashda xatolik"
      action={
        <Button size="small" onClick={() => void q.refetch()}>
          Qayta urinish
        </Button>
      }
    />
  );
}

function partyOf(p: Payment): string {
  if (p.kind === 'TRANSPORT_DIRECT') return `${p.client?.name ?? '—'} → ${p.vehicle?.name ?? '—'}`;
  if (p.client) return p.client.name;
  if (p.factory) return p.factory.name;
  if (p.vehicle) return `${p.vehicle.name}${p.vehicle.plate ? ` (${p.vehicle.plate})` : ''}`;
  return '—';
}

// ─────────────────────────── create modal ───────────────────────────

interface AllocRow {
  orderId?: string;
  amount?: number;
}

interface CreateFormValues {
  kind: PaymentKind;
  method: PaymentMethod;
  date: Dayjs;
  amount?: number;
  usdAmount?: number;
  rate?: number;
  clientId?: string;
  factoryId?: string;
  vehicleId?: string;
  cashboxId?: string;
  note?: string;
  allocations?: AllocRow[];
}

function CreatePaymentModal({
  open,
  idemKey,
  onClose,
}: {
  open: boolean;
  idemKey: string;
  onClose: () => void;
}) {
  const { message } = App.useApp();
  const { hasRole } = useAuth();
  const qc = useQueryClient();
  const [form] = Form.useForm<CreateFormValues>();
  const [clientSearch, setClientSearch] = useState('');

  const isAgent = hasRole('AGENT');
  const canAllocate = hasRole('ADMIN', 'ACCOUNTANT');

  const wKind = (Form.useWatch('kind', form) ?? 'CLIENT_IN') as PaymentKind;
  const wMethod = (Form.useWatch('method', form) ?? 'CASH') as PaymentMethod;
  const wClientId = Form.useWatch('clientId', form) as string | undefined;
  const wFactoryId = Form.useWatch('factoryId', form) as string | undefined;
  const wVehicleId = Form.useWatch('vehicleId', form) as string | undefined;
  const wUsd = Form.useWatch('usdAmount', form) as number | undefined;
  const wRate = Form.useWatch('rate', form) as number | undefined;
  const wAmount = Form.useWatch('amount', form) as number | undefined;
  const wAllocations = Form.useWatch('allocations', form) as AllocRow[] | undefined;

  const spec = KIND_SPEC[wKind];

  const clientsQ = useQuery({
    queryKey: ['clients', 'pay-select', clientSearch],
    queryFn: () => endpoints.clients({ page: 1, pageSize: 50, search: clientSearch || undefined }),
    enabled: open && spec.client,
  });
  const factoriesQ = useQuery({
    queryKey: ['factories', 'pay-select'],
    queryFn: () => endpoints.factories(),
    enabled: open && spec.factory,
  });
  const vehiclesQ = useQuery({
    queryKey: ['vehicles', 'pay-select'],
    queryFn: () => endpoints.vehicles(),
    enabled: open && spec.vehicle,
  });
  const cashboxesQ = useQuery({
    queryKey: ['kassa', 'cashboxes-select'],
    queryFn: () => endpoints.cashboxes(),
    enabled: open && spec.cashbox,
  });

  const showAlloc = canAllocate && ALLOCATABLE.includes(wKind);
  const allocPartyReady =
    wKind === 'FACTORY_OUT' ? !!wFactoryId : wKind === 'VEHICLE_OUT' ? !!wVehicleId : !!wClientId;

  const allocOrdersQ = useQuery({
    queryKey: ['orders', 'pay-alloc', wKind, wClientId, wFactoryId, wVehicleId],
    queryFn: () =>
      endpoints.orders({
        pageSize: 100,
        clientId: wKind === 'CLIENT_IN' || wKind === 'TRANSPORT_DIRECT' ? wClientId : undefined,
        factoryId: wKind === 'FACTORY_OUT' ? wFactoryId : undefined,
      }),
    enabled: open && showAlloc && allocPartyReady,
  });

  const allocOrders = useMemo(() => {
    let rows = (allocOrdersQ.data?.items ?? []).filter((o) => o.status !== 'CANCELLED');
    // orders endpoint has no vehicle filter — narrow client-side for VEHICLE_OUT
    if (wKind === 'VEHICLE_OUT' && wVehicleId) {
      rows = rows.filter((o) => (o.vehicleId ?? o.vehicle?.id) === wVehicleId);
    }
    return rows;
  }, [allocOrdersQ.data, wKind, wVehicleId]);

  const needCurrency = wMethod === 'USD' ? 'USD' : 'UZS';
  const cashboxOptions = asItems<Cashbox>(cashboxesQ.data)
    .filter((c) => c.active && c.currency === needCurrency)
    .map((c) => ({
      value: c.id,
      label: `${c.name} — ${fmtMoney(c.balance)} ${c.currency === 'USD' ? '$' : "so'm"}`,
    }));

  const kindOptions = (Object.keys(PAYMENT_KIND) as PaymentKind[])
    .filter((k) => !isAgent || k === 'CLIENT_IN')
    .map((k) => ({ value: k, label: PAYMENT_KIND[k] }));

  const methodOptions = (Object.keys(PAYMENT_METHOD) as PaymentMethod[])
    .filter((m) => m !== 'BONUS') // bonus offsets are created in /bonus, never here
    .map((m) => ({ value: m, label: PAYMENT_METHOD[m] }));

  const uzsPreview = (wUsd ?? 0) * (wRate ?? 0);
  const totalAmount = wMethod === 'USD' ? uzsPreview : (wAmount ?? 0);
  const allocSum = (wAllocations ?? []).reduce((acc, r) => acc + (r?.amount ?? 0), 0);

  const createM = useMutation({
    mutationFn: (dto: Record<string, unknown>) => endpoints.createPayment(dto),
    onSuccess: () => {
      message.success("To'lov saqlandi");
      for (const key of ['payments', 'kassa', 'orders', 'clients', 'factories', 'vehicles', 'dashboard', 'debts', 'reports']) {
        qc.invalidateQueries({ queryKey: [key] });
      }
      form.resetFields();
      onClose();
    },
    onError: (err: unknown) => message.error(apiError(err)),
  });

  const onFinish = (v: CreateFormValues) => {
    const s = KIND_SPEC[v.kind];
    const dto: Record<string, unknown> = {
      date: v.date.format('YYYY-MM-DD'),
      kind: v.kind,
      method: v.method,
      idempotencyKey: idemKey || undefined,
      note: v.note?.trim() || undefined,
    };
    if (s.client) dto.clientId = v.clientId;
    if (s.factory) dto.factoryId = v.factoryId;
    if (s.vehicle) dto.vehicleId = v.vehicleId;
    if (v.method === 'USD') {
      dto.usdAmount = v.usdAmount;
      dto.rate = v.rate;
    } else {
      dto.amount = v.amount;
    }
    if (s.cashbox) dto.cashboxId = v.cashboxId;
    const alloc = (v.allocations ?? []).filter((r) => !!r?.orderId && (r?.amount ?? 0) > 0);
    if (canAllocate && ALLOCATABLE.includes(v.kind) && alloc.length) {
      dto.allocations = alloc.map((r) => ({ orderId: r.orderId, amount: r.amount }));
    }
    createM.mutate(dto);
  };

  const onKindChange = () => {
    form.setFieldsValue({
      clientId: undefined,
      factoryId: undefined,
      vehicleId: undefined,
      cashboxId: undefined,
      allocations: [],
    });
  };

  return (
    <Modal
      open={open}
      title="Yangi to'lov"
      width={720}
      forceRender
      okText="Saqlash"
      cancelText="Yopish"
      confirmLoading={createM.isPending}
      onOk={() => form.submit()}
      onCancel={onClose}
      afterOpenChange={(o) => {
        if (o) form.resetFields();
      }}
    >
      <Form
        form={form}
        layout="vertical"
        disabled={createM.isPending}
        onFinish={onFinish}
        initialValues={{ kind: 'CLIENT_IN', method: 'CASH', date: dayjs() }}
      >
        <Row gutter={12}>
          <Col xs={24} md={10}>
            <Form.Item name="kind" label="To'lov turi" rules={[{ required: true }]}>
              <Select options={kindOptions} onChange={onKindChange} disabled={isAgent} />
            </Form.Item>
          </Col>
          <Col xs={24} md={7}>
            <Form.Item name="method" label="Usul" rules={[{ required: true }]}>
              <Select options={methodOptions} onChange={() => form.setFieldValue('cashboxId', undefined)} />
            </Form.Item>
          </Col>
          <Col xs={24} md={7}>
            <Form.Item name="date" label="Sana" rules={[{ required: true, message: 'Sanani tanlang' }]}>
              <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" allowClear={false} />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={12}>
          {spec.client && (
            <Col xs={24} md={12}>
              <Form.Item name="clientId" label="Mijoz" rules={[{ required: true, message: 'Mijozni tanlang' }]}>
                <Select
                  showSearch
                  filterOption={false}
                  onSearch={setClientSearch}
                  loading={clientsQ.isFetching}
                  placeholder="Mijozni qidiring…"
                  notFoundContent={selectError(clientsQ)}
                  options={(clientsQ.data?.items ?? []).map((c) => ({
                    value: c.id,
                    label: `${c.name} — balans ${fmtMoney(c.balance)}`,
                  }))}
                />
              </Form.Item>
            </Col>
          )}
          {spec.factory && (
            <Col xs={24} md={12}>
              <Form.Item name="factoryId" label="Zavod" rules={[{ required: true, message: 'Zavodni tanlang' }]}>
                <Select
                  showSearch
                  optionFilterProp="label"
                  loading={factoriesQ.isFetching}
                  placeholder="Zavod"
                  notFoundContent={selectError(factoriesQ)}
                  options={asItems(factoriesQ.data).map((f) => ({
                    value: f.id,
                    label: `${f.name} — balans ${fmtMoney(f.balance)}`,
                  }))}
                />
              </Form.Item>
            </Col>
          )}
          {spec.vehicle && (
            <Col xs={24} md={12}>
              <Form.Item name="vehicleId" label="Moshina" rules={[{ required: true, message: 'Moshinani tanlang' }]}>
                <Select
                  showSearch
                  optionFilterProp="label"
                  loading={vehiclesQ.isFetching}
                  placeholder="Moshina"
                  notFoundContent={selectError(vehiclesQ)}
                  options={asItems(vehiclesQ.data).map((v) => ({
                    value: v.id,
                    label: `${v.name}${v.plate ? ` (${v.plate})` : ''}${v.driver ? ` — ${v.driver}` : ''}`,
                  }))}
                />
              </Form.Item>
            </Col>
          )}
        </Row>

        {wKind === 'TRANSPORT_DIRECT' && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message="Mijoz shofyorga to'g'ridan-to'g'ri to'laydi — bu to'lov kassadan o'tmaydi"
          />
        )}

        <Row gutter={12}>
          {wMethod === 'USD' ? (
            <>
              <Col xs={12} md={7}>
                <Form.Item
                  name="usdAmount"
                  label="Summa (USD)"
                  rules={[{ required: true, message: 'USD summa' }, positiveRule]}
                >
                  <InputNumber min={0} step={0.01} style={{ width: '100%' }} formatter={moneyFormatter} parser={moneyParser} />
                </Form.Item>
              </Col>
              <Col xs={12} md={7}>
                <Form.Item
                  name="rate"
                  label="Kurs (so'm / $)"
                  rules={[{ required: true, message: 'Kursni kiriting' }, positiveRule]}
                >
                  <InputNumber min={0} style={{ width: '100%' }} formatter={moneyFormatter} parser={moneyParser} />
                </Form.Item>
              </Col>
              <Col xs={24} md={10} style={{ display: 'flex', alignItems: 'center' }}>
                <Typography.Text strong className="num">
                  = {fmtUZS(uzsPreview)}
                </Typography.Text>
              </Col>
            </>
          ) : (
            <Col xs={24} md={12}>
              <Form.Item
                name="amount"
                label="Summa (so'm)"
                rules={[{ required: true, message: 'Summani kiriting' }, positiveRule]}
              >
                <InputNumber min={0} style={{ width: '100%' }} formatter={moneyFormatter} parser={moneyParser} />
              </Form.Item>
            </Col>
          )}
          {spec.cashbox && (
            <Col xs={24} md={12}>
              <Form.Item name="cashboxId" label="Kassa" rules={[{ required: true, message: 'Kassani tanlang' }]}>
                <Select
                  placeholder={wMethod === 'USD' ? 'USD kassa' : 'Kassa'}
                  loading={cashboxesQ.isFetching}
                  notFoundContent={selectError(cashboxesQ) ?? 'Mos valyutadagi kassa topilmadi'}
                  options={cashboxOptions}
                />
              </Form.Item>
            </Col>
          )}
        </Row>

        <Form.Item name="note" label="Izoh">
          <Input.TextArea rows={2} maxLength={1000} placeholder="Izoh (ixtiyoriy)" />
        </Form.Item>

        {showAlloc && (
          <>
            <Divider style={{ margin: '12px 0' }}>Buyurtmalarga taqsimlash (ixtiyoriy)</Divider>
            {!allocPartyReady ? (
              <Typography.Text type="secondary">Avval yuqoridagi tomonni tanlang</Typography.Text>
            ) : (
              <>
                <Form.List name="allocations">
                  {(fields, { add, remove }) => (
                    <>
                      {fields.map(({ key, name }) => (
                        <Row key={key} gutter={8} style={{ marginBottom: 8 }}>
                          <Col flex="auto">
                            <Form.Item
                              name={[name, 'orderId']}
                              rules={[{ required: true, message: 'Buyurtmani tanlang' }]}
                              style={{ marginBottom: 0 }}
                            >
                              <Select
                                showSearch
                                optionFilterProp="label"
                                placeholder="Buyurtma"
                                loading={allocOrdersQ.isFetching}
                                notFoundContent={selectError(allocOrdersQ)}
                                options={allocOrders.map((o) => ({
                                  value: o.id,
                                  label: `${o.orderNo} — ${fmtDate(o.date)} — ${fmtMoney(o.saleTotal)} so'm`,
                                }))}
                              />
                            </Form.Item>
                          </Col>
                          <Col>
                            <Form.Item
                              name={[name, 'amount']}
                              rules={[{ required: true, message: 'Summa' }, positiveRule]}
                              style={{ marginBottom: 0 }}
                            >
                              <InputNumber
                                min={0}
                                placeholder="Summa"
                                style={{ width: 160 }}
                                formatter={moneyFormatter}
                                parser={moneyParser}
                              />
                            </Form.Item>
                          </Col>
                          <Col>
                            <Button type="text" danger icon={<DeleteOutlined />} title="O'chirish" onClick={() => remove(name)} />
                          </Col>
                        </Row>
                      ))}
                      <Button type="dashed" block icon={<PlusOutlined />} onClick={() => add({})}>
                        Taqsimot qatori qo'shish
                      </Button>
                    </>
                  )}
                </Form.List>
                {allocSum > totalAmount && totalAmount > 0 && (
                  <Alert
                    type="warning"
                    showIcon
                    style={{ marginTop: 8 }}
                    message={`Taqsimotlar yig'indisi (${fmtMoney(allocSum)}) to'lov summasidan (${fmtMoney(totalAmount)}) oshib ketadi — server rad etadi`}
                  />
                )}
              </>
            )}
          </>
        )}
      </Form>
    </Modal>
  );
}

// ─────────────────────────── page ───────────────────────────

export default function Payments() {
  const { message, modal } = App.useApp();
  const { hasRole } = useAuth();
  const qc = useQueryClient();

  const isAgent = hasRole('AGENT');
  const canVoid = hasRole('ADMIN', 'ACCOUNTANT');

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<PaymentKind | undefined>();
  const [method, setMethod] = useState<PaymentMethod | undefined>();
  const [clientId, setClientId] = useState<string | undefined>();
  const [factoryId, setFactoryId] = useState<string | undefined>();
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [showVoided, setShowVoided] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [idemKey, setIdemKey] = useState('');
  const [filterClientSearch, setFilterClientSearch] = useState('');

  const dateFrom = range?.[0] ? range[0].format('YYYY-MM-DD') : undefined;
  const dateTo = range?.[1] ? range[1].format('YYYY-MM-DD') : undefined;

  const listQ = useQuery({
    queryKey: [
      'payments',
      'list',
      { page, pageSize, search, kind, method, clientId, factoryId, dateFrom, dateTo, showVoided },
    ],
    queryFn: () =>
      endpoints.payments({
        page,
        pageSize,
        search: search || undefined,
        kind,
        method,
        clientId,
        factoryId,
        dateFrom,
        dateTo,
        voided: showVoided || undefined,
      }),
    placeholderData: keepPreviousData,
  });

  const filterClientsQ = useQuery({
    queryKey: ['clients', 'payments-filter', filterClientSearch],
    queryFn: () => endpoints.clients({ page: 1, pageSize: 50, search: filterClientSearch || undefined }),
  });
  const factoriesQ = useQuery({
    queryKey: ['factories', 'payments-filter'],
    queryFn: () => endpoints.factories(),
    enabled: !isAgent,
  });

  const detailQ = useQuery({
    queryKey: ['payments', 'detail', detailId],
    queryFn: () => endpoints.payment(detailId as string),
    enabled: !!detailId,
  });
  const detail = detailQ.data as PaymentDetail | undefined;

  const voidM = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => endpoints.voidPayment(id, reason),
    onSuccess: () => {
      message.success("To'lov bekor qilindi");
      for (const key of ['payments', 'orders', 'kassa', 'clients', 'factories', 'vehicles', 'dashboard', 'debts', 'bonus', 'reports']) {
        qc.invalidateQueries({ queryKey: [key] });
      }
    },
    onError: (err: unknown) => message.error(apiError(err)),
  });

  const askVoid = (p: Payment) => {
    let reason = '';
    modal.confirm({
      title: "To'lovni bekor qilish",
      width: 460,
      content: (
        <div>
          <p>
            {fmtDate(p.date)} — {PAYMENT_KIND[p.kind]} — {fmtUZS(p.amount)} ({partyOf(p)})
          </p>
          <Input.TextArea
            rows={2}
            maxLength={500}
            placeholder="Bekor qilish sababi (majburiy)"
            onChange={(e) => {
              reason = e.target.value;
            }}
          />
        </div>
      ),
      okText: 'Bekor qilish',
      okButtonProps: { danger: true },
      cancelText: 'Yopish',
      onOk: async () => {
        if (!reason.trim()) {
          message.warning('Sabab kiritilishi majburiy');
          return Promise.reject(new Error('reason required'));
        }
        await voidM.mutateAsync({ id: p.id, reason: reason.trim() });
      },
    });
  };

  const openCreate = () => {
    setIdemKey(crypto.randomUUID()); // fresh key per modal-open — double-click protection
    setCreateOpen(true);
  };

  const columns: TableColumnsType<Payment> = [
    { title: 'Sana', dataIndex: 'date', width: 100, render: (v: string) => fmtDate(v) },
    {
      title: 'Turi',
      dataIndex: 'kind',
      width: 170,
      render: (k: PaymentKind) => <Tag color={KIND_COLOR[k]}>{PAYMENT_KIND[k] ?? k}</Tag>,
    },
    {
      title: 'Usul',
      dataIndex: 'method',
      width: 140,
      render: (m: PaymentMethod, r) => (
        <>
          {PAYMENT_METHOD[m] ?? m}
          {m === 'USD' && (
            <div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }} className="num">
                {fmtNum(r.usdAmount, 2)} $ × {fmtMoney(r.rate)}
              </Typography.Text>
            </div>
          )}
        </>
      ),
    },
    { title: 'Tomon', key: 'party', ellipsis: true, render: (_, r) => partyOf(r) },
    {
      title: 'Summa',
      dataIndex: 'amount',
      align: 'right',
      width: 140,
      className: 'num',
      render: (v: string) => <Money value={v} strong />,
    },
    { title: 'Kassa', key: 'cashbox', width: 140, ellipsis: true, render: (_, r) => r.cashbox?.name ?? '—' },
    {
      title: 'Holat',
      key: 'state',
      width: 120,
      render: (_, r) =>
        r.voidedAt ? (
          <Tag color="red">Bekor qilingan</Tag>
        ) : !r.reconciled ? (
          <Tag color="orange">Tekshirilsin</Tag>
        ) : (
          <Tag color="green">Tasdiqlangan</Tag>
        ),
    },
    {
      title: '',
      key: 'actions',
      width: 80,
      render: (_, r) => (
        <Space size={0}>
          <Button size="small" type="text" icon={<EyeOutlined />} title="Batafsil" onClick={() => setDetailId(r.id)} />
          {canVoid && !r.voidedAt && (
            <Button size="small" type="text" danger icon={<StopOutlined />} title="Bekor qilish" onClick={() => askVoid(r)} />
          )}
        </Space>
      ),
    },
  ];

  const detailItems: DescriptionsProps['items'] = detail
    ? [
        { key: 'date', label: 'Sana', children: fmtDate(detail.date) },
        {
          key: 'kind',
          label: 'Turi',
          children: <Tag color={KIND_COLOR[detail.kind]}>{PAYMENT_KIND[detail.kind] ?? detail.kind}</Tag>,
        },
        { key: 'method', label: 'Usul', children: PAYMENT_METHOD[detail.method] ?? detail.method },
        ...(detail.method === 'USD'
          ? [
              {
                key: 'usd',
                label: 'Valyuta',
                children: `${fmtNum(detail.usdAmount, 2)} $ × ${fmtMoney(detail.rate)} = ${fmtUZS(detail.amount)}`,
              },
            ]
          : []),
        { key: 'amount', label: 'Summa', children: <Money value={detail.amount} strong suffix="so'm" /> },
        { key: 'party', label: 'Tomon', children: partyOf(detail) },
        ...(detail.agent ? [{ key: 'agent', label: 'Agent', children: detail.agent.name }] : []),
        { key: 'cashbox', label: 'Kassa', children: detail.cashbox?.name ?? '—' },
        ...(detail.payerName ? [{ key: 'payer', label: "To'lovchi", children: detail.payerName }] : []),
        ...(detail.receiverName ? [{ key: 'receiver', label: 'Qabul qiluvchi', children: detail.receiverName }] : []),
        ...(detail.note ? [{ key: 'note', label: 'Izoh', children: detail.note }] : []),
        ...(detail.createdBy ? [{ key: 'by', label: 'Kiritdi', children: detail.createdBy.name }] : []),
        {
          key: 'state',
          label: 'Holat',
          children: detail.voidedAt ? (
            <Tag color="red">Bekor qilingan</Tag>
          ) : !detail.reconciled ? (
            <Tag color="orange">Tekshirilsin</Tag>
          ) : (
            <Tag color="green">Tasdiqlangan</Tag>
          ),
        },
        ...(detail.voidedAt
          ? [
              {
                key: 'voided',
                label: 'Bekor qilindi',
                children: `${fmtDateTime(detail.voidedAt)}${detail.voidedBy ? ` — ${detail.voidedBy.name}` : ''}${detail.voidReason ? ` — ${detail.voidReason}` : ''}`,
              },
            ]
          : []),
      ]
    : [];

  return (
    <div>
      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          To'lovlar
        </Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          Yangi to'lov
        </Button>
      </Space>

      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap>
          <Input.Search
            allowClear
            placeholder="Qidirish (izoh, mijoz, zavod)"
            style={{ width: 240 }}
            onSearch={(v) => {
              setSearch(v.trim());
              setPage(1);
            }}
          />
          {!isAgent && (
            <Select
              allowClear
              placeholder="To'lov turi"
              style={{ width: 190 }}
              value={kind}
              onChange={(v) => {
                setKind(v);
                setPage(1);
              }}
              options={(Object.keys(PAYMENT_KIND) as PaymentKind[]).map((k) => ({
                value: k,
                label: PAYMENT_KIND[k],
              }))}
            />
          )}
          <Select
            allowClear
            placeholder="Usul"
            style={{ width: 150 }}
            value={method}
            onChange={(v) => {
              setMethod(v);
              setPage(1);
            }}
            options={(Object.keys(PAYMENT_METHOD) as PaymentMethod[]).map((m) => ({
              value: m,
              label: PAYMENT_METHOD[m],
            }))}
          />
          <Select
            allowClear
            showSearch
            filterOption={false}
            placeholder="Mijoz"
            style={{ width: 210 }}
            value={clientId}
            onSearch={setFilterClientSearch}
            loading={filterClientsQ.isFetching}
            notFoundContent={selectError(filterClientsQ)}
            onChange={(v) => {
              setClientId(v);
              setPage(1);
            }}
            options={(filterClientsQ.data?.items ?? []).map((c) => ({ value: c.id, label: c.name }))}
          />
          {!isAgent && (
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="Zavod"
              style={{ width: 180 }}
              value={factoryId}
              loading={factoriesQ.isFetching}
              notFoundContent={selectError(factoriesQ)}
              onChange={(v) => {
                setFactoryId(v);
                setPage(1);
              }}
              options={asItems(factoriesQ.data).map((f) => ({ value: f.id, label: f.name }))}
            />
          )}
          <DatePicker.RangePicker
            value={range}
            format="DD.MM.YYYY"
            onChange={(v) => {
              setRange(v);
              setPage(1);
            }}
          />
          <Space size={6}>
            <Switch
              checked={showVoided}
              onChange={(v) => {
                setShowVoided(v);
                setPage(1);
              }}
            />
            <Typography.Text>Bekor qilinganlar</Typography.Text>
          </Space>
        </Space>
      </Card>

      {listQ.isError ? (
        <Alert
          type="error"
          showIcon
          message="To'lovlarni yuklashda xatolik"
          description={apiError(listQ.error)}
          action={
            <Button size="small" onClick={() => void listQ.refetch()}>
              Qayta urinish
            </Button>
          }
        />
      ) : (
        <Table<Payment>
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={listQ.data?.items ?? []}
          loading={listQ.isFetching}
          scroll={{ x: 980 }}
          pagination={{
            current: page,
            pageSize,
            total: listQ.data?.total ?? 0,
            showSizeChanger: true,
            showTotal: (t) => `Jami: ${t}`,
          }}
          onChange={(pag) => {
            setPage(pag.current ?? 1);
            setPageSize(pag.pageSize ?? 20);
          }}
        />
      )}

      <Drawer
        open={!!detailId}
        onClose={() => setDetailId(null)}
        width={640}
        title="To'lov tafsilotlari"
        extra={
          detail && canVoid && !detail.voidedAt ? (
            <Button danger size="small" icon={<StopOutlined />} onClick={() => askVoid(detail)}>
              Bekor qilish
            </Button>
          ) : undefined
        }
      >
        {detailQ.isError ? (
          <Alert
            type="error"
            showIcon
            message="Yuklashda xatolik"
            description={apiError(detailQ.error)}
            action={
              <Button size="small" onClick={() => void detailQ.refetch()}>
                Qayta urinish
              </Button>
            }
          />
        ) : detailQ.isLoading ? (
          <Spin style={{ display: 'block', margin: '48px auto' }} />
        ) : detail ? (
          <>
            <Descriptions column={1} size="small" items={detailItems} />

            <Divider style={{ margin: '16px 0 8px' }}>Taqsimotlar</Divider>
            {detail.allocations?.length ? (
              <Table<Allocation>
                rowKey="id"
                size="small"
                pagination={false}
                dataSource={detail.allocations}
                columns={[
                  { title: 'Buyurtma', key: 'order', render: (_, a) => a.order?.orderNo ?? a.orderId },
                  {
                    title: 'Summa',
                    key: 'amount',
                    align: 'right',
                    className: 'num',
                    render: (_, a) => <Money value={a.amount} />,
                  },
                  {
                    title: 'Holat',
                    key: 'state',
                    width: 90,
                    render: (_, a) => (a.voidedAt ? <Tag color="red">Bekor</Tag> : <Tag color="green">Faol</Tag>),
                  },
                ]}
              />
            ) : (
              <Typography.Text type="secondary">Taqsimot yo'q</Typography.Text>
            )}

            <Divider style={{ margin: '16px 0 8px' }}>Ledger yozuvlari</Divider>
            {detail.ledgerEntries?.length ? (
              <Table
                rowKey="id"
                size="small"
                pagination={false}
                dataSource={detail.ledgerEntries}
                columns={[
                  { title: 'Sana', dataIndex: 'date', width: 100, render: (v: string) => fmtDate(v) },
                  { title: 'Hisob', dataIndex: 'account', width: 100 },
                  { title: 'Manba', dataIndex: 'source', width: 130 },
                  {
                    title: 'Summa',
                    dataIndex: 'amount',
                    align: 'right' as const,
                    className: 'num',
                    render: (v: string) => <Money value={v} signed />,
                  },
                  { title: 'Izoh', dataIndex: 'note', ellipsis: true, render: (v: string | null) => v ?? '—' },
                ]}
              />
            ) : (
              <Typography.Text type="secondary">Yozuvlar yo'q</Typography.Text>
            )}
          </>
        ) : null}
      </Drawer>

      <CreatePaymentModal open={createOpen} idemKey={idemKey} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
