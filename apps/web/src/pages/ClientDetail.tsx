import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  DatePicker,
  Descriptions,
  Form,
  Input,
  InputNumber,
  List,
  Row,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DeleteOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import type { Dayjs } from 'dayjs';
import { apiError, asItems, endpoints } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { Money } from '../components/Money';
import { OrderStatusTag } from '../components/StatusTag';
import { fmtDate, fmtMoney, isSettled, num, PAYMENT_KIND, PAYMENT_METHOD } from '../lib/format';
import type { ClientRow, Money as MoneyStr, Order, Payment, PaymentKind, PaymentMethod } from '../lib/types';

const LEDGER_SOURCE: Record<string, string> = {
  ORDER_SALE: 'Buyurtma — sotuv',
  ORDER_COST: 'Buyurtma — tannarx',
  COST_ADJUSTMENT: 'Tannarx tuzatilishi',
  TRANSPORT_CHARGE: 'Transport haqi',
  TRANSPORT_COST: 'Transport xarajati',
  PAYMENT: "To'lov",
  PAYMENT_VOID: "To'lov bekor qilingan",
  ORDER_CANCEL: 'Buyurtma bekor qilingan',
  PALLET_CHARGE: "Yo'qolgan paddon hisobi",
  PALLET_RETURN_CREDIT: 'Paddon qaytarish krediti',
  BONUS_OFFSET: 'Bonus hisobga olish',
  ADJUSTMENT: "Qo'lda tuzatish",
  IMPORT: 'Import',
};

interface StatementRow {
  id: string;
  date: string;
  source: string;
  amount: MoneyStr;
  running: MoneyStr;
  note?: string | null;
  orderId?: string | null;
  paymentId?: string | null;
  order?: { orderNo: string } | null;
  payment?: { kind: PaymentKind; method: PaymentMethod } | null;
}

interface AliasRow {
  id: string;
  name: string;
}

interface PriceRow {
  id: string;
  pricePerM3: MoneyStr;
  effectiveFrom: string;
  product?: { id: string; name: string; size?: string | null } | null;
}

interface ClientDetailData extends ClientRow {
  aliases: AliasRow[];
  prices: PriceRow[];
  orders: Order[];
  payments: Payment[];
  statement: StatementRow[];
  balance: MoneyStr;
  palletBalance: number;
}

interface PriceFormValues {
  productId: string;
  pricePerM3: number | string;
  effectiveFrom?: Dayjs | null;
}

const moneyFormatter = (v: string | number | undefined) =>
  `${v ?? ''}`.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const moneyParser = (v: string | undefined) => (v ?? '').replace(/\s/g, '');

/** running-balance coloring: qarz (positive) qizil, avans (negative) yashil */
function runningType(v: number): 'danger' | 'success' | undefined {
  if (Math.abs(v) < 1) return undefined;
  return v > 0 ? 'danger' : 'success';
}

export default function ClientDetail() {
  const { id } = useParams<{ id: string }>();
  const { message, modal } = App.useApp();
  const { hasRole } = useAuth();
  const qc = useQueryClient();
  const office = hasRole('ADMIN', 'ACCOUNTANT');

  const [aliasName, setAliasName] = useState('');
  const [priceForm] = Form.useForm<PriceFormValues>();

  const q = useQuery({
    queryKey: ['clients', id],
    queryFn: () => endpoints.client(id!),
    enabled: !!id,
  });
  const data = q.data as ClientDetailData | undefined;

  const productsQ = useQuery({
    queryKey: ['products', 'for-client-prices'],
    queryFn: () => endpoints.products(),
    enabled: office,
  });
  const products = asItems(productsQ.data);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['clients'] });

  const addAliasMut = useMutation({
    mutationFn: (name: string) => endpoints.addClientAlias(id!, name),
    onSuccess: () => {
      message.success("Taxallus qo'shildi");
      setAliasName('');
      invalidate();
    },
    onError: (err) => message.error(apiError(err)),
  });

  const removeAliasMut = useMutation({
    mutationFn: (aliasId: string) => endpoints.deleteClientAlias(id!, aliasId),
    onSuccess: () => {
      message.success("Taxallus o'chirildi");
      invalidate();
    },
    onError: (err) => message.error(apiError(err)),
  });

  const addPriceMut = useMutation({
    mutationFn: (v: PriceFormValues) =>
      endpoints.addClientPrice(id!, {
        productId: v.productId,
        pricePerM3: v.pricePerM3,
        ...(v.effectiveFrom ? { effectiveFrom: v.effectiveFrom.format('YYYY-MM-DD') } : {}),
      }),
    onSuccess: () => {
      message.success("Maxsus narx qo'shildi");
      priceForm.resetFields();
      invalidate();
    },
    onError: (err) => message.error(apiError(err)),
  });

  if (q.error) {
    return (
      <Alert
        type="error"
        showIcon
        message="Mijoz ma'lumotini yuklashda xatolik"
        description={apiError(q.error)}
        action={
          <Button icon={<ReloadOutlined />} onClick={() => q.refetch()}>
            Qayta urinish
          </Button>
        }
      />
    );
  }
  if (q.isLoading || !data) return <Card loading />;

  const balance = num(data.balance);
  const settled = isSettled(data.balance);
  const debt = balance > 0;

  const statementColumns: ColumnsType<StatementRow> = [
    { title: 'Sana', dataIndex: 'date', key: 'date', width: 110, render: (v: string) => fmtDate(v) },
    {
      title: 'Manba',
      dataIndex: 'source',
      key: 'source',
      render: (v: string) => LEDGER_SOURCE[v] ?? v,
    },
    {
      title: 'Hujjat',
      key: 'ref',
      render: (_, r) =>
        r.order?.orderNo ? (
          r.orderId ? (
            <Link to={`/orders/${r.orderId}`}>{r.order.orderNo}</Link>
          ) : (
            r.order.orderNo
          )
        ) : r.payment ? (
          `${PAYMENT_KIND[r.payment.kind] ?? r.payment.kind} (${PAYMENT_METHOD[r.payment.method] ?? r.payment.method})`
        ) : (
          '—'
        ),
    },
    { title: 'Izoh', dataIndex: 'note', key: 'note', render: (v: string | null) => v || '—' },
    {
      title: 'Summa',
      dataIndex: 'amount',
      key: 'amount',
      align: 'right',
      render: (v: MoneyStr) => <Money value={v} signed />,
    },
    {
      title: 'Qoldiq',
      dataIndex: 'running',
      key: 'running',
      align: 'right',
      render: (v: MoneyStr) => (
        <Typography.Text
          type={runningType(num(v))}
          style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}
        >
          {fmtMoney(v)}
        </Typography.Text>
      ),
    },
  ];

  const orderColumns: ColumnsType<Order> = [
    {
      title: 'Buyurtma №',
      dataIndex: 'orderNo',
      key: 'orderNo',
      render: (v: string, o) => <Link to={`/orders/${o.id}`}>{v}</Link>,
    },
    { title: 'Sana', dataIndex: 'date', key: 'date', render: (v: string) => fmtDate(v) },
    { title: 'Zavod', key: 'factory', render: (_, o) => o.factory?.name ?? '—' },
    {
      title: 'Holat',
      dataIndex: 'status',
      key: 'status',
      render: (v: Order['status']) => <OrderStatusTag status={v} />,
    },
    {
      title: 'Summa',
      dataIndex: 'saleTotal',
      key: 'saleTotal',
      align: 'right',
      render: (v: MoneyStr) => <Money value={v} />,
    },
  ];

  const paymentColumns: ColumnsType<Payment> = [
    { title: 'Sana', dataIndex: 'date', key: 'date', render: (v: string) => fmtDate(v) },
    { title: 'Turi', dataIndex: 'kind', key: 'kind', render: (v: PaymentKind) => PAYMENT_KIND[v] ?? v },
    { title: 'Usul', dataIndex: 'method', key: 'method', render: (v: PaymentMethod) => PAYMENT_METHOD[v] ?? v },
    {
      title: 'Summa',
      dataIndex: 'amount',
      key: 'amount',
      align: 'right',
      render: (v: MoneyStr) => <Money value={v} />,
    },
    { title: 'Izoh', dataIndex: 'note', key: 'note', render: (v: string | null) => v || '—' },
  ];

  const priceColumns: ColumnsType<PriceRow> = [
    {
      title: 'Mahsulot',
      key: 'product',
      render: (_, r) => (r.product ? `${r.product.name}${r.product.size ? ` (${r.product.size})` : ''}` : '—'),
    },
    {
      title: 'Narx (m³)',
      dataIndex: 'pricePerM3',
      key: 'pricePerM3',
      align: 'right',
      render: (v: MoneyStr) => <Money value={v} suffix="so'm" />,
    },
    {
      title: 'Amal qilish sanasi',
      dataIndex: 'effectiveFrom',
      key: 'effectiveFrom',
      render: (v: string) => fmtDate(v),
    },
  ];

  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <Card>
        <Row gutter={[24, 16]} align="middle">
          <Col flex="auto">
            <Space align="center">
              <Typography.Title level={3} style={{ margin: 0 }}>
                {data.name}
              </Typography.Title>
              {!data.active && <Tag>Nofaol</Tag>}
            </Space>
            <Descriptions
              size="small"
              column={{ xs: 1, sm: 2, lg: 3 }}
              style={{ marginTop: 12 }}
              items={[
                { key: 'agent', label: 'Agent', children: data.agent?.name ?? '—' },
                { key: 'region', label: 'Hudud', children: data.region?.name ?? '—' },
                { key: 'phone', label: 'Telefon', children: data.phone || '—' },
                {
                  key: 'creditLimit',
                  label: 'Kredit limiti',
                  children: data.creditLimit == null ? 'Cheklanmagan' : fmtMoney(data.creditLimit) + " so'm",
                },
                {
                  key: 'paymentTermDays',
                  label: "To'lov muddati",
                  children: data.paymentTermDays != null ? `${data.paymentTermDays} kun` : '—',
                },
              ]}
            />
          </Col>
          <Col>
            <div style={{ textAlign: 'right' }}>
              <Typography.Text type="secondary">Balans</Typography.Text>
              <Typography.Title
                level={2}
                style={{ margin: 0, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}
                type={settled ? undefined : debt ? 'danger' : 'success'}
              >
                {settled ? '—' : `${fmtMoney(Math.abs(balance))} ${debt ? 'Qarz' : 'Avans'}`}
              </Typography.Title>
              {data.palletBalance > 0 && <Tag color="orange">{data.palletBalance} dona paddon</Tag>}
            </div>
          </Col>
        </Row>
      </Card>

      <Card>
        <Tabs
          defaultActiveKey="statement"
          items={[
            {
              key: 'statement',
              label: 'Hisob-kitob',
              children: (
                <Table<StatementRow>
                  rowKey="id"
                  size="small"
                  columns={statementColumns}
                  dataSource={data.statement}
                  loading={q.isFetching}
                  scroll={{ x: 'max-content' }}
                  pagination={{ pageSize: 20, showSizeChanger: true }}
                />
              ),
            },
            {
              key: 'orders',
              label: 'Buyurtmalar',
              children: (
                <Table<Order>
                  rowKey="id"
                  size="small"
                  columns={orderColumns}
                  dataSource={data.orders}
                  loading={q.isFetching}
                  scroll={{ x: 'max-content' }}
                  pagination={false}
                />
              ),
            },
            {
              key: 'payments',
              label: "To'lovlar",
              children: (
                <Table<Payment>
                  rowKey="id"
                  size="small"
                  columns={paymentColumns}
                  dataSource={data.payments}
                  loading={q.isFetching}
                  scroll={{ x: 'max-content' }}
                  pagination={false}
                />
              ),
            },
            {
              key: 'aliases',
              label: 'Taxalluslar',
              children: (
                <Space orientation="vertical" style={{ width: '100%' }} size={12}>
                  {office && (
                    <Space.Compact style={{ width: 360, maxWidth: '100%' }}>
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
                  <List<AliasRow>
                    size="small"
                    bordered
                    dataSource={data.aliases}
                    locale={{ emptyText: "Taxalluslar yo'q" }}
                    renderItem={(a) => (
                      <List.Item
                        actions={
                          office
                            ? [
                                <Button
                                  key="del"
                                  size="small"
                                  danger
                                  type="text"
                                  icon={<DeleteOutlined />}
                                  onClick={() =>
                                    modal.confirm({
                                      title: "Taxallusni o'chirish",
                                      content: `"${a.name}" o'chiriladi.`,
                                      okText: "O'chirish",
                                      okButtonProps: { danger: true },
                                      cancelText: 'Bekor qilish',
                                      onOk: () => removeAliasMut.mutateAsync(a.id),
                                    })
                                  }
                                />,
                              ]
                            : undefined
                        }
                      >
                        {a.name}
                      </List.Item>
                    )}
                  />
                </Space>
              ),
            },
            {
              key: 'prices',
              label: 'Maxsus narxlar',
              children: (
                <Space orientation="vertical" style={{ width: '100%' }} size={12}>
                  {office && productsQ.error != null && (
                    <Alert
                      type="error"
                      showIcon
                      message="Mahsulotlarni yuklashda xatolik"
                      description={apiError(productsQ.error)}
                      action={
                        <Button size="small" icon={<ReloadOutlined />} onClick={() => productsQ.refetch()}>
                          Qayta urinish
                        </Button>
                      }
                    />
                  )}
                  {office && (
                    <Form
                      form={priceForm}
                      layout="inline"
                      onFinish={(v) => addPriceMut.mutate(v)}
                      style={{ rowGap: 8 }}
                    >
                      <Form.Item
                        name="productId"
                        rules={[{ required: true, message: 'Mahsulot tanlang' }]}
                        style={{ minWidth: 260 }}
                      >
                        <Select
                          showSearch
                          optionFilterProp="label"
                          placeholder="Mahsulot"
                          options={products.map((pr) => ({
                            value: pr.id,
                            label: `${pr.name}${pr.size ? ` (${pr.size})` : ''}${pr.factory ? ` — ${pr.factory.name}` : ''}`,
                          }))}
                        />
                      </Form.Item>
                      <Form.Item name="pricePerM3" rules={[{ required: true, message: 'Narx kiriting' }]}>
                        <InputNumber
                          min={0}
                          style={{ width: 180 }}
                          placeholder="Narx (m³)"
                          formatter={moneyFormatter}
                          parser={moneyParser}
                        />
                      </Form.Item>
                      <Form.Item name="effectiveFrom">
                        <DatePicker placeholder="Amal qilish sanasi" format="DD.MM.YYYY" />
                      </Form.Item>
                      <Form.Item>
                        <Button
                          type="primary"
                          htmlType="submit"
                          icon={<PlusOutlined />}
                          loading={addPriceMut.isPending}
                        >
                          Qo'shish
                        </Button>
                      </Form.Item>
                    </Form>
                  )}
                  <Table<PriceRow>
                    rowKey="id"
                    size="small"
                    columns={priceColumns}
                    dataSource={data.prices}
                    loading={q.isFetching}
                    scroll={{ x: 'max-content' }}
                    pagination={{ pageSize: 10, showSizeChanger: true }}
                  />
                </Space>
              ),
            },
          ]}
        />
      </Card>
    </Space>
  );
}
