import { useEffect, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  DatePicker,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { TableProps } from 'antd';
import { ExportOutlined, ImportOutlined, WarningOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import dayjs, { type Dayjs } from 'dayjs';
import { apiError, endpoints } from '../lib/api';
import { fmtDate, fmtNum, fmtUZS } from '../lib/format';
import { Money } from '../components/Money';
import { useAuth } from '../auth/AuthContext';
import type { Paged, PalletBalanceRow } from '../lib/types';

interface FactoryBalRow {
  factory: { id: string; name: string };
  balance: number;
}

const DEFAULT_PALLET_PRICE = 130000;

const PALLET_TYPE: Record<string, { label: string; color: string }> = {
  RECEIVED_FROM_FACTORY: { label: 'Zavoddan olindi', color: 'blue' },
  DELIVERED_TO_CLIENT: { label: 'Mijozga yuborildi', color: 'cyan' },
  RETURNED_BY_CLIENT: { label: 'Mijoz qaytardi', color: 'green' },
  RETURNED_TO_FACTORY: { label: 'Zavodga qaytarildi', color: 'purple' },
  CHARGED_LOST: { label: 'Undirildi', color: 'red' },
  ADJUSTMENT: { label: 'Tuzatish', color: 'default' },
  REVERSAL: { label: 'Storno', color: 'volcano' },
};

interface PalletTxRow {
  id: string;
  type: string;
  qty: number;
  date: string;
  unitPrice?: string | null;
  note?: string | null;
  client?: { id: string; name: string } | null;
  factory?: { id: string; name: string } | null;
  order?: { id: string; orderNo: string } | null;
}

interface ClientReturnVals {
  clientId: string;
  qty: number;
  date: Dayjs;
  note?: string;
}

interface FactoryReturnVals {
  factoryId: string;
  qty: number;
  date: Dayjs;
  unitPrice: number;
  note?: string;
}

interface ChargeLostVals {
  clientId: string;
  qty: number;
  date: Dayjs;
  unitPrice: number;
  note?: string;
}

const moneyFormatter = (v: string | number | undefined) => `${v ?? ''}`.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const moneyParser = (v: string | undefined) => Number((v ?? '').replace(/\s/g, ''));

function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <Alert
      type="error"
      showIcon
      message="Ma'lumotni yuklab bo'lmadi"
      description={apiError(error)}
      action={
        <Button size="small" danger onClick={onRetry}>
          Qayta urinish
        </Button>
      }
    />
  );
}

export default function Pallets() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const { hasRole } = useAuth();
  const canMutate = hasRole('ADMIN', 'ACCOUNTANT');

  // list state
  const [clientSearch, setClientSearch] = useState('');
  const [txClientId, setTxClientId] = useState<string | undefined>();
  const [txFactoryId, setTxFactoryId] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // modals
  const [clientOpen, setClientOpen] = useState(false);
  const [factoryOpen, setFactoryOpen] = useState(false);
  const [lostOpen, setLostOpen] = useState(false);
  const [clientPrefill, setClientPrefill] = useState<string | undefined>();
  const [factoryPrefill, setFactoryPrefill] = useState<string | undefined>();
  const [clientForm] = Form.useForm<ClientReturnVals>();
  const [factoryForm] = Form.useForm<FactoryReturnVals>();
  const [lostForm] = Form.useForm<ChargeLostVals>();

  useEffect(() => {
    if (clientOpen) {
      clientForm.resetFields();
      clientForm.setFieldsValue({ date: dayjs(), clientId: clientPrefill });
    }
  }, [clientOpen, clientForm, clientPrefill]);

  useEffect(() => {
    if (factoryOpen) {
      factoryForm.resetFields();
      factoryForm.setFieldsValue({ date: dayjs(), unitPrice: DEFAULT_PALLET_PRICE, factoryId: factoryPrefill });
    }
  }, [factoryOpen, factoryForm, factoryPrefill]);

  useEffect(() => {
    if (lostOpen) {
      lostForm.resetFields();
      lostForm.setFieldsValue({ date: dayjs(), unitPrice: DEFAULT_PALLET_PRICE, clientId: clientPrefill });
    }
  }, [lostOpen, lostForm, clientPrefill]);

  const balQ = useQuery({ queryKey: ['pallets', 'balances'], queryFn: () => endpoints.palletBalances() });

  const txParams = { page, pageSize, clientId: txClientId, factoryId: txFactoryId };
  const txQ = useQuery({
    queryKey: ['pallets', 'transactions', txParams],
    queryFn: () => endpoints.palletTransactions(txParams) as Promise<Paged<PalletTxRow>>,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['pallets'] });
    qc.invalidateQueries({ queryKey: ['clients'] });
    qc.invalidateQueries({ queryKey: ['factories'] });
    qc.invalidateQueries({ queryKey: ['debts'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const clientReturnMut = useMutation({
    mutationFn: (d: object) => endpoints.palletClientReturn(d),
    onSuccess: () => {
      message.success('Paddon qaytarilishi qabul qilindi');
      invalidate();
      setClientOpen(false);
    },
    onError: (e) => message.error(apiError(e)),
  });

  const factoryReturnMut = useMutation({
    mutationFn: (d: object) => endpoints.palletFactoryReturn(d),
    onSuccess: () => {
      message.success('Paddonlar zavodga qaytarildi');
      invalidate();
      setFactoryOpen(false);
    },
    onError: (e) => message.error(apiError(e)),
  });

  const chargeLostMut = useMutation({
    mutationFn: (d: object) => endpoints.palletChargeLost(d),
    onSuccess: () => {
      message.success("Yo'qotilgan paddonlar mijozdan undirildi (qarz yozildi)");
      invalidate();
      setLostOpen(false);
    },
    onError: (e) => message.error(apiError(e)),
  });

  const clients = balQ.data?.clients ?? [];
  const factories = balQ.data?.factories ?? [];
  const filteredClients = clientSearch
    ? clients.filter((r) => r.client.name.toLowerCase().includes(clientSearch.toLowerCase()))
    : clients;

  const clientOptions = clients.map((r) => ({
    value: r.client.id,
    label: `${r.client.name} (balans: ${r.balance})`,
  }));
  const factoryOptions = factories.map((r) => ({
    value: r.factory.id,
    label: `${r.factory.name} (hisobdorlik: ${r.balance})`,
  }));

  // computed money previews
  const frQty = Form.useWatch('qty', factoryForm);
  const frPrice = Form.useWatch('unitPrice', factoryForm);
  const frTotal = (Number(frQty) || 0) * (Number(frPrice) || 0);
  const clQty = Form.useWatch('qty', lostForm);
  const clPrice = Form.useWatch('unitPrice', lostForm);
  const clTotal = (Number(clQty) || 0) * (Number(clPrice) || 0);

  const balanceActionCol: NonNullable<TableProps<PalletBalanceRow>['columns']>[number] = {
    title: '',
    key: 'actions',
    width: 300,
    render: (_: unknown, r: PalletBalanceRow) => (
      <Space size={4} wrap>
        <Button
          size="small"
          icon={<ImportOutlined />}
          onClick={() => {
            setClientPrefill(r.client.id);
            setClientOpen(true);
          }}
        >
          Qaytarish qabul qilish
        </Button>
        <Button
          size="small"
          danger
          icon={<WarningOutlined />}
          onClick={() => {
            setClientPrefill(r.client.id);
            setLostOpen(true);
          }}
        >
          Undirish
        </Button>
      </Space>
    ),
  };

  const balanceColumns: TableProps<PalletBalanceRow>['columns'] = [
    {
      title: 'Mijoz',
      key: 'client',
      render: (_, r) => <Link to={`/clients/${r.client.id}`}>{r.client.name}</Link>,
    },
    {
      title: 'Paddon balansi',
      dataIndex: 'balance',
      align: 'right',
      width: 140,
      render: (v: number) => (
        <Typography.Text className="num" strong type={v > 0 ? 'warning' : v < 0 ? 'danger' : undefined}>
          {fmtNum(v)}
        </Typography.Text>
      ),
    },
    ...(canMutate ? [balanceActionCol] : []),
  ];

  const factoryActionCol: NonNullable<TableProps<FactoryBalRow>['columns']>[number] = {
    title: '',
    key: 'actions',
    width: 170,
    render: (_: unknown, r: FactoryBalRow) => (
      <Button
        size="small"
        icon={<ExportOutlined />}
        onClick={() => {
          setFactoryPrefill(r.factory.id);
          setFactoryOpen(true);
        }}
      >
        Zavodga qaytarish
      </Button>
    ),
  };

  const factoryColumns: TableProps<FactoryBalRow>['columns'] = [
    { title: 'Zavod', key: 'factory', render: (_, r) => r.factory.name },
    {
      title: 'Paddon',
      dataIndex: 'balance',
      align: 'right',
      width: 100,
      render: (v: number) => (
        <Typography.Text className="num" strong>
          {fmtNum(v)}
        </Typography.Text>
      ),
    },
    ...(canMutate ? [factoryActionCol] : []),
  ];

  const txColumns: TableProps<PalletTxRow>['columns'] = [
    { title: 'Sana', dataIndex: 'date', width: 110, render: (v: string) => fmtDate(v) },
    {
      title: 'Turi',
      dataIndex: 'type',
      width: 170,
      render: (v: string) => {
        const t = PALLET_TYPE[v] ?? { label: v, color: 'default' };
        return <Tag color={t.color}>{t.label}</Tag>;
      },
    },
    {
      title: 'Mijoz',
      key: 'client',
      render: (_, r) => (r.client ? <Link to={`/clients/${r.client.id}`}>{r.client.name}</Link> : '—'),
    },
    { title: 'Zavod', key: 'factory', render: (_, r) => r.factory?.name ?? '—' },
    {
      title: 'Soni',
      dataIndex: 'qty',
      align: 'right',
      width: 90,
      render: (v: number) => <Typography.Text className="num">{fmtNum(v)}</Typography.Text>,
    },
    {
      title: 'Narx (dona)',
      dataIndex: 'unitPrice',
      align: 'right',
      width: 130,
      render: (v: string | null) => (v ? <Money value={v} suffix="so'm" /> : '—'),
    },
    {
      title: 'Buyurtma',
      key: 'order',
      width: 130,
      render: (_, r) => (r.order ? <Link to={`/orders/${r.order.id}`}>{r.order.orderNo}</Link> : '—'),
    },
    { title: 'Izoh', dataIndex: 'note', ellipsis: true, render: (v: string | null) => v || '—' },
  ];

  return (
    <Space orientation="vertical" size={16} style={{ display: 'flex' }}>
      <Flex justify="space-between" align="center" wrap gap={8}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          Paddonlar
        </Typography.Title>
        {canMutate && (
          <Space wrap>
            <Button
              icon={<ImportOutlined />}
              onClick={() => {
                setClientPrefill(undefined);
                setClientOpen(true);
              }}
            >
              Qaytarish qabul qilish
            </Button>
            <Button
              icon={<ExportOutlined />}
              onClick={() => {
                setFactoryPrefill(undefined);
                setFactoryOpen(true);
              }}
            >
              Zavodga qaytarish
            </Button>
            <Button
              danger
              icon={<WarningOutlined />}
              onClick={() => {
                setClientPrefill(undefined);
                setLostOpen(true);
              }}
            >
              Yo'qotilganini undirish
            </Button>
          </Space>
        )}
      </Flex>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={factories.length > 0 ? 15 : 24}>
          <Card
            size="small"
            title="Mijozlardagi paddonlar"
            extra={
              <Input.Search
                allowClear
                placeholder="Mijoz qidirish"
                style={{ width: 200 }}
                onSearch={(v) => setClientSearch(v)}
                onChange={(e) => {
                  if (!e.target.value) setClientSearch('');
                }}
              />
            }
          >
            {balQ.isError ? (
              <LoadError error={balQ.error} onRetry={() => balQ.refetch()} />
            ) : (
              <Table<PalletBalanceRow>
                rowKey={(r) => r.client.id}
                size="small"
                columns={balanceColumns}
                dataSource={filteredClients}
                loading={balQ.isFetching}
                scroll={{ x: 640 }}
                pagination={{ pageSize: 15, showSizeChanger: false }}
              />
            )}
          </Card>
        </Col>
        {factories.length > 0 && (
          <Col xs={24} lg={9}>
            <Card size="small" title="Zavodlar oldidagi hisobdorlik">
              <Table<FactoryBalRow>
                rowKey={(r) => r.factory.id}
                size="small"
                dataSource={factories}
                loading={balQ.isFetching}
                pagination={false}
                columns={factoryColumns}
              />
            </Card>
          </Col>
        )}
      </Row>

      <Card size="small" title="Paddon harakatlari">
        <Space wrap style={{ marginBottom: 12 }}>
          <Select
            allowClear
            placeholder="Mijoz"
            style={{ minWidth: 220 }}
            options={clients.map((r) => ({ value: r.client.id, label: r.client.name }))}
            value={txClientId}
            onChange={(v) => {
              setTxClientId(v);
              setPage(1);
            }}
            showSearch
            optionFilterProp="label"
          />
          {factories.length > 0 && (
            <Select
              allowClear
              placeholder="Zavod"
              style={{ minWidth: 200 }}
              options={factories.map((r) => ({ value: r.factory.id, label: r.factory.name }))}
              value={txFactoryId}
              onChange={(v) => {
                setTxFactoryId(v);
                setPage(1);
              }}
              showSearch
              optionFilterProp="label"
            />
          )}
        </Space>
        {txQ.isError ? (
          <LoadError error={txQ.error} onRetry={() => txQ.refetch()} />
        ) : (
          <Table<PalletTxRow>
            rowKey="id"
            size="small"
            columns={txColumns}
            dataSource={txQ.data?.items ?? []}
            loading={txQ.isFetching}
            scroll={{ x: 1000 }}
            pagination={{
              current: page,
              pageSize,
              total: txQ.data?.total ?? 0,
              showSizeChanger: true,
              onChange: (p, ps) => {
                setPage(p);
                setPageSize(ps);
              },
            }}
          />
        )}
      </Card>

      {/* client return */}
      <Modal
        title="Mijozdan paddon qabul qilish"
        open={clientOpen}
        onCancel={() => setClientOpen(false)}
        onOk={() => clientForm.submit()}
        okText="Saqlash"
        cancelText="Bekor qilish"
        confirmLoading={clientReturnMut.isPending}
      >
        <Form
          form={clientForm}
          layout="vertical"
          onFinish={(v: ClientReturnVals) =>
            clientReturnMut.mutate({
              clientId: v.clientId,
              qty: v.qty,
              date: v.date.format('YYYY-MM-DD'),
              note: v.note?.trim() ? v.note.trim() : undefined,
            })
          }
        >
          <Form.Item name="clientId" label="Mijoz" rules={[{ required: true, message: 'Mijozni tanlang' }]}>
            <Select placeholder="Mijozni tanlang" options={clientOptions} showSearch optionFilterProp="label" />
          </Form.Item>
          <Form.Item name="qty" label="Soni (dona)" rules={[{ required: true, message: 'Sonini kiriting' }]}>
            <InputNumber min={1} precision={0} style={{ width: '100%' }} placeholder="0" />
          </Form.Item>
          <Form.Item name="date" label="Sana" rules={[{ required: true, message: 'Sanani tanlang' }]}>
            <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
          </Form.Item>
          <Form.Item name="note" label="Izoh">
            <Input.TextArea rows={2} placeholder="Izoh (ixtiyoriy)" />
          </Form.Item>
        </Form>
      </Modal>

      {/* factory return */}
      <Modal
        title="Zavodga paddon qaytarish"
        open={factoryOpen}
        onCancel={() => setFactoryOpen(false)}
        onOk={() => factoryForm.submit()}
        okText="Saqlash"
        cancelText="Bekor qilish"
        confirmLoading={factoryReturnMut.isPending}
      >
        <Form
          form={factoryForm}
          layout="vertical"
          onFinish={(v: FactoryReturnVals) =>
            factoryReturnMut.mutate({
              factoryId: v.factoryId,
              qty: v.qty,
              date: v.date.format('YYYY-MM-DD'),
              unitPrice: v.unitPrice,
              note: v.note?.trim() ? v.note.trim() : undefined,
            })
          }
        >
          <Form.Item name="factoryId" label="Zavod" rules={[{ required: true, message: 'Zavodni tanlang' }]}>
            <Select placeholder="Zavodni tanlang" options={factoryOptions} showSearch optionFilterProp="label" />
          </Form.Item>
          <Form.Item name="qty" label="Soni (dona)" rules={[{ required: true, message: 'Sonini kiriting' }]}>
            <InputNumber min={1} precision={0} style={{ width: '100%' }} placeholder="0" />
          </Form.Item>
          <Form.Item
            name="unitPrice"
            label="Dona narxi (so'm)"
            rules={[{ required: true, message: 'Narxni kiriting' }]}
          >
            <InputNumber min={0} style={{ width: '100%' }} formatter={moneyFormatter} parser={moneyParser} />
          </Form.Item>
          <Form.Item name="date" label="Sana" rules={[{ required: true, message: 'Sanani tanlang' }]}>
            <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
          </Form.Item>
          {frTotal > 0 && (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message={`Zavod hisobiga kredit: ${fmtUZS(frTotal)}`}
            />
          )}
          <Form.Item name="note" label="Izoh">
            <Input.TextArea rows={2} placeholder="Izoh (ixtiyoriy)" />
          </Form.Item>
        </Form>
      </Modal>

      {/* charge lost */}
      <Modal
        title="Yo'qotilgan paddonlarni undirish"
        open={lostOpen}
        onCancel={() => setLostOpen(false)}
        onOk={() => lostForm.submit()}
        okText="Undirish"
        okButtonProps={{ danger: true }}
        cancelText="Bekor qilish"
        confirmLoading={chargeLostMut.isPending}
      >
        <Form
          form={lostForm}
          layout="vertical"
          onFinish={(v: ChargeLostVals) =>
            chargeLostMut.mutate({
              clientId: v.clientId,
              qty: v.qty,
              date: v.date.format('YYYY-MM-DD'),
              unitPrice: v.unitPrice,
              note: v.note?.trim() ? v.note.trim() : undefined,
            })
          }
        >
          <Form.Item name="clientId" label="Mijoz" rules={[{ required: true, message: 'Mijozni tanlang' }]}>
            <Select placeholder="Mijozni tanlang" options={clientOptions} showSearch optionFilterProp="label" />
          </Form.Item>
          <Form.Item name="qty" label="Soni (dona)" rules={[{ required: true, message: 'Sonini kiriting' }]}>
            <InputNumber min={1} precision={0} style={{ width: '100%' }} placeholder="0" />
          </Form.Item>
          <Form.Item
            name="unitPrice"
            label="Dona narxi (so'm)"
            rules={[{ required: true, message: 'Narxni kiriting' }]}
          >
            <InputNumber min={0} style={{ width: '100%' }} formatter={moneyFormatter} parser={moneyParser} />
          </Form.Item>
          <Form.Item name="date" label="Sana" rules={[{ required: true, message: 'Sanani tanlang' }]}>
            <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
          </Form.Item>
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message="Diqqat: bu amaliyot mijozga pul qarzi yozadi"
            description={clTotal > 0 ? `Mijoz qarziga ${fmtUZS(clTotal)} qo'shiladi.` : undefined}
          />
          <Form.Item name="note" label="Izoh">
            <Input.TextArea rows={2} placeholder="Izoh (ixtiyoriy)" />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
