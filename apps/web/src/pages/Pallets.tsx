import { useEffect, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Col,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Table,
  Typography,
} from 'antd';
import type { TableProps } from 'antd';
import { ExportOutlined, ImportOutlined, WarningOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import dayjs, { type Dayjs } from 'dayjs';
import { apiError, endpoints } from '../lib/api';
import { fmtDate, fmtNum, fmtUZS } from '../lib/format';
import { DataTable, FormDrawer, MoneyCell, StatusChip, TableCard, type SbColumn } from '../components';
import { PALLET_TX } from '../lib/status-maps';
import { PageHeader } from '../components/PageHeader';
import { useAuth } from '../auth/AuthContext';
import { useUrlFilters } from '../lib/useUrlFilters';
import type { Paged, PalletBalanceRow } from '../lib/types';

interface FactoryBalRow {
  factory: { id: string; name: string };
  balance: number;
}

const DEFAULT_PALLET_PRICE = 130000;

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
  const uf = useUrlFilters(['clientId', 'factoryId']);
  const txClientId = uf.get('clientId') || undefined;
  const txFactoryId = uf.get('factoryId') || undefined;
  const page = Number(uf.get('page')) || 1;
  const pageSize = Number(uf.get('pageSize')) || 20;

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
      ellipsis: true,
      width: 220,
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
    { title: 'Zavod', key: 'factory', ellipsis: true, width: 160, render: (_, r) => r.factory.name },
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

  const txColumns: SbColumn<PalletTxRow>[] = [
    { title: 'Sana', dataIndex: 'date', width: 110, render: (v: string) => fmtDate(v) },
    {
      title: 'Turi',
      dataIndex: 'type',
      width: 170,
      render: (v: string) => {
        const meta = PALLET_TX[v as keyof typeof PALLET_TX];
        return meta ? <StatusChip meta={meta} /> : <span>{v}</span>;
      },
    },
    {
      title: 'Mijoz',
      key: 'client',
      ellipsis: true,
      width: 180,
      render: (_, r) => (r.client ? <Link to={`/clients/${r.client.id}`}>{r.client.name}</Link> : '—'),
    },
    { title: 'Zavod', key: 'factory', ellipsis: true, width: 150, render: (_, r) => r.factory?.name ?? '—' },
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
      render: (v: string | null) => (v ? <MoneyCell value={v} suffix="so'm" /> : '—'),
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
      <PageHeader
        title="Paddonlar"
        actions={
          canMutate
            ? [
                {
                  key: 'client-return',
                  label: 'Qaytarish qabul qilish',
                  primary: true,
                  icon: <ImportOutlined />,
                  onClick: () => {
                    setClientPrefill(undefined);
                    setClientOpen(true);
                  },
                },
                {
                  key: 'factory-return',
                  label: 'Zavodga qaytarish',
                  icon: <ExportOutlined />,
                  onClick: () => {
                    setFactoryPrefill(undefined);
                    setFactoryOpen(true);
                  },
                },
                {
                  key: 'charge-lost',
                  label: "Yo'qotilganini undirish",
                  danger: true,
                  icon: <WarningOutlined />,
                  onClick: () => {
                    setClientPrefill(undefined);
                    setLostOpen(true);
                  },
                },
              ]
            : []
        }
      />

      <Row gutter={[16, 16]} align="stretch">
        <Col xs={24} lg={factories.length > 0 ? 15 : 24}>
          <TableCard
            style={{ height: '100%' }}
            title="Mijozlardagi paddonlar"
            loading={balQ.isFetching}
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
          </TableCard>
        </Col>
        {factories.length > 0 && (
          <Col xs={24} lg={9}>
            <TableCard style={{ height: '100%' }} title="Zavodlar oldidagi hisobdorlik" loading={balQ.isFetching}>
              <Table<FactoryBalRow>
                rowKey={(r) => r.factory.id}
                size="small"
                dataSource={factories}
                loading={balQ.isFetching}
                pagination={false}
                columns={factoryColumns}
              />
            </TableCard>
          </Col>
        )}
      </Row>

      <TableCard
        title="Paddon harakatlari"
        loading={txQ.isFetching}
        toolbar={
          <Space wrap>
            <Select
              allowClear
              placeholder="Mijoz bo'yicha"
              style={{ minWidth: 220 }}
              options={clients.map((r) => ({ value: r.client.id, label: r.client.name }))}
              value={txClientId}
              onChange={(v) => uf.set({ clientId: v || null })}
              showSearch
              optionFilterProp="label"
            />
            {factories.length > 0 && (
              <Select
                allowClear
                placeholder="Zavod bo'yicha"
                style={{ minWidth: 200 }}
                options={factories.map((r) => ({ value: r.factory.id, label: r.factory.name }))}
                value={txFactoryId}
                onChange={(v) => uf.set({ factoryId: v || null })}
                showSearch
                optionFilterProp="label"
              />
            )}
          </Space>
        }
      >
        <DataTable<PalletTxRow>
          rowKey="id"
          columns={txColumns}
          query={txQ}
          densityKey="pallets"
          emptyText="Hozircha paddon harakati yo'q"
          scroll={{ x: 1000 }}
        />
      </TableCard>

      {/* client return */}
      <FormDrawer
        title="Mijozdan paddon qabul qilish"
        open={clientOpen}
        onClose={() => setClientOpen(false)}
        onSubmit={() => clientForm.submit()}
        submitText="Saqlash"
        cancelText="Bekor qilish"
        submitting={clientReturnMut.isPending}
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
      </FormDrawer>

      {/* factory return */}
      <FormDrawer
        title="Zavodga paddon qaytarish"
        open={factoryOpen}
        onClose={() => setFactoryOpen(false)}
        onSubmit={() => factoryForm.submit()}
        submitText="Saqlash"
        cancelText="Bekor qilish"
        submitting={factoryReturnMut.isPending}
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
      </FormDrawer>

      {/* charge lost */}
      <FormDrawer
        title="Yo'qotilgan paddonlarni undirish"
        open={lostOpen}
        onClose={() => setLostOpen(false)}
        onSubmit={() => lostForm.submit()}
        submitText="Undirish"
        danger
        cancelText="Bekor qilish"
        submitting={chargeLostMut.isPending}
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
      </FormDrawer>
    </Space>
  );
}
