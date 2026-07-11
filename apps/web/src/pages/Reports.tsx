import { useMemo, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Collapse,
  DatePicker,
  Descriptions,
  Select,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import type { TableColumnsType } from 'antd';
import { CheckCircleOutlined, DownloadOutlined, WarningOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import dayjs, { type Dayjs } from 'dayjs';
import { apiError, asItems, downloadFile, endpoints } from '../lib/api';
import { fmtDate, fmtM3, fmtMoney, fmtNum, isSettled } from '../lib/format';
import { Money } from '../components/Money';
import { CostStatusTag, OrderStatusTag, TransportPaidTag } from '../components/StatusTag';
import type { CostStatus, OrderStatus, TransportPaidStatus } from '../lib/types';

// ── svod shapes (ReportsService.svod) ──

interface SvodClientRow {
  clientId: string;
  client: string;
  goods: string;
  payments: string;
  balance: string;
  palletBalance: number;
  driverDirect: string;
}

interface SvodSubtotal {
  goods: string;
  payments: string;
  balance: string;
  palletBalance: number;
  driverDirect: string;
}

interface SvodFactoryRow {
  factoryId: string;
  factory: string;
  goods: string;
  pallets: string;
  goodsWithPallets: string;
  paidToFactory: string;
  factoryBalance: string;
}

interface SvodData {
  from: string | null;
  to: string | null;
  factory: {
    goods: string;
    pallets: string;
    goodsWithPallets: string;
    paidToFactory: string;
    factoryBalance: string;
  };
  factories: SvodFactoryRow[];
  agents: { agentId: string | null; agent: string; rows: SvodClientRow[]; subtotal: SvodSubtotal }[];
  totals: SvodSubtotal;
  checks: { paymentsIdentity: string; goodsIdentity: string };
}

// ── register shape (ReportsService.ordersRegister) ──

interface RegisterRow {
  id: string;
  orderNo: string;
  date: string;
  status: OrderStatus;
  agent: string | null;
  client: string;
  factory: string;
  plate: string | null;
  driver: string | null;
  sizes: string;
  m3: string;
  costPrice: string;
  costTotal: string;
  costStatus: CostStatus;
  pallets: number;
  palletMoney: string;
  salePrice: string;
  saleTotal: string;
  transportCost: string;
  transportCharge: string;
  transportPaidStatus: TransportPaidStatus;
  goodsProfit: string;
}

type Range = [Dayjs | null, Dayjs | null] | null;

const rangeParams = (range: Range) => ({
  from: range?.[0]?.format('YYYY-MM-DD'),
  to: range?.[1]?.format('YYYY-MM-DD'),
});

function CheckTag({ value }: { value: string }) {
  return isSettled(value) ? (
    <Tag color="green" icon={<CheckCircleOutlined />}>
      Mos (0)
    </Tag>
  ) : (
    <Tag color="red" icon={<WarningOutlined />}>
      Farq: {fmtMoney(value)} so'm
    </Tag>
  );
}

// ─────────────────────────── Svod ───────────────────────────

function SvodTab() {
  const { message } = App.useApp();
  const [range, setRange] = useState<Range>([dayjs().startOf('month'), dayjs()]);
  const [downloading, setDownloading] = useState(false);
  const { from, to } = rangeParams(range);

  const svodQ = useQuery({
    queryKey: ['reports', 'svod', from ?? '', to ?? ''],
    queryFn: async () => (await endpoints.svod({ from, to })) as unknown as SvodData,
  });

  const factoryCols: TableColumnsType<SvodFactoryRow> = [
    { title: 'Zavod', dataIndex: 'factory', key: 'factory' },
    {
      title: 'Tovar (blok)',
      dataIndex: 'goods',
      key: 'goods',
      align: 'right',
      className: 'num',
      render: (v: string) => <Money value={v} />,
    },
    {
      title: 'Paddon',
      dataIndex: 'pallets',
      key: 'pallets',
      align: 'right',
      className: 'num',
      render: (v: string) => <Money value={v} />,
    },
    {
      title: 'Jami (paddon bilan)',
      dataIndex: 'goodsWithPallets',
      key: 'goodsWithPallets',
      align: 'right',
      className: 'num',
      render: (v: string) => <Money value={v} strong />,
    },
    {
      title: "To'landi",
      dataIndex: 'paidToFactory',
      key: 'paidToFactory',
      align: 'right',
      className: 'num',
      render: (v: string) => <Money value={v} />,
    },
    {
      title: 'Balans',
      dataIndex: 'factoryBalance',
      key: 'factoryBalance',
      align: 'right',
      className: 'num',
      render: (v: string) => <Money value={v} signed strong />,
    },
  ];

  const clientCols: TableColumnsType<SvodClientRow> = [
    { title: 'Mijoz', dataIndex: 'client', key: 'client' },
    {
      title: 'Tovar',
      dataIndex: 'goods',
      key: 'goods',
      align: 'right',
      className: 'num',
      render: (v: string) => <Money value={v} />,
    },
    {
      title: "To'lovlar",
      dataIndex: 'payments',
      key: 'payments',
      align: 'right',
      className: 'num',
      render: (v: string) => <Money value={v} />,
    },
    {
      title: "shu jumladan shofyorga to'g'ridan",
      dataIndex: 'driverDirect',
      key: 'driverDirect',
      align: 'right',
      className: 'num',
      render: (v: string) => <Money value={v} />,
    },
    {
      title: 'Qoldiq',
      dataIndex: 'balance',
      key: 'balance',
      align: 'right',
      className: 'num',
      render: (v: string) => <Money value={v} signed strong />,
    },
    {
      title: 'Paddon',
      dataIndex: 'palletBalance',
      key: 'palletBalance',
      align: 'right',
      className: 'num',
      render: (v: number) => fmtNum(v),
    },
  ];

  const onDownload = async () => {
    setDownloading(true);
    try {
      await downloadFile('/reports/svod.xlsx', { from, to });
    } catch (e) {
      message.error(apiError(e));
    } finally {
      setDownloading(false);
    }
  };

  const data = svodQ.data;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Space wrap>
        <DatePicker.RangePicker
          value={range}
          onChange={(v) => setRange(v as Range)}
          format="DD.MM.YYYY"
          allowClear
        />
        <Button icon={<DownloadOutlined />} loading={downloading} onClick={onDownload}>
          Excel (svod.xlsx)
        </Button>
      </Space>

      {svodQ.error ? (
        <Alert
          type="error"
          showIcon
          message="Svodni yuklashda xatolik"
          description={apiError(svodQ.error)}
          action={
            <Button size="small" onClick={() => svodQ.refetch()}>
              Qayta urinish
            </Button>
          }
        />
      ) : svodQ.isLoading || !data ? (
        <Spin size="large" style={{ display: 'block', margin: '10vh auto' }} />
      ) : (
        <>
          <Card size="small" title="Zavodlar bloki">
            <div className="scroll-x">
              <Table<SvodFactoryRow>
                rowKey="factoryId"
                columns={factoryCols}
                dataSource={data.factories}
                loading={svodQ.isFetching}
                pagination={false}
                size="small"
                summary={() => (
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0}>
                      <b>Jami</b>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={1} align="right">
                      <Money value={data.factory.goods} strong />
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={2} align="right">
                      <Money value={data.factory.pallets} strong />
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={3} align="right">
                      <Money value={data.factory.goodsWithPallets} strong />
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={4} align="right">
                      <Money value={data.factory.paidToFactory} strong />
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={5} align="right">
                      <Money value={data.factory.factoryBalance} signed strong />
                    </Table.Summary.Cell>
                  </Table.Summary.Row>
                )}
              />
            </div>
          </Card>

          <Card size="small" title="Agentlar bo'yicha mijozlar">
            <Collapse
              items={data.agents.map((a, i) => ({
                key: a.agentId ?? `unassigned-${i}`,
                label: (
                  <Space wrap>
                    <b>{a.agent}</b>
                    <Tag>{a.rows.length} mijoz</Tag>
                    <span>
                      Qoldiq: <Money value={a.subtotal.balance} signed strong />
                    </span>
                  </Space>
                ),
                children: (
                  <div className="scroll-x">
                    <Table<SvodClientRow>
                      rowKey="clientId"
                      columns={clientCols}
                      dataSource={a.rows}
                      pagination={false}
                      size="small"
                      summary={() => (
                        <Table.Summary.Row>
                          <Table.Summary.Cell index={0}>
                            <b>Jami ({a.agent})</b>
                          </Table.Summary.Cell>
                          <Table.Summary.Cell index={1} align="right">
                            <Money value={a.subtotal.goods} strong />
                          </Table.Summary.Cell>
                          <Table.Summary.Cell index={2} align="right">
                            <Money value={a.subtotal.payments} strong />
                          </Table.Summary.Cell>
                          <Table.Summary.Cell index={3} align="right">
                            <Money value={a.subtotal.driverDirect} strong />
                          </Table.Summary.Cell>
                          <Table.Summary.Cell index={4} align="right">
                            <Money value={a.subtotal.balance} signed strong />
                          </Table.Summary.Cell>
                          <Table.Summary.Cell index={5} align="right">
                            <b>{fmtNum(a.subtotal.palletBalance)}</b>
                          </Table.Summary.Cell>
                        </Table.Summary.Row>
                      )}
                    />
                  </div>
                ),
              }))}
            />
          </Card>

          <Card size="small" title="Umumiy natijalar va tekshiruvlar">
            <Descriptions
              column={{ xs: 1, sm: 2, lg: 3 }}
              size="small"
              bordered
              items={[
                {
                  key: 'goods',
                  label: 'Tovar (jami)',
                  children: <Money value={data.totals.goods} strong />,
                },
                {
                  key: 'payments',
                  label: "To'lovlar (jami)",
                  children: <Money value={data.totals.payments} strong />,
                },
                {
                  key: 'balance',
                  label: 'Qoldiq (jami)',
                  children: <Money value={data.totals.balance} signed strong />,
                },
                {
                  key: 'driverDirect',
                  label: "Shofyorga to'g'ridan (jami)",
                  children: <Money value={data.totals.driverDirect} />,
                },
                {
                  key: 'pallets',
                  label: 'Paddonlar (mijozlarda)',
                  children: fmtNum(data.totals.palletBalance),
                },
                {
                  key: 'period',
                  label: 'Davr',
                  children: `${data.from ? fmtDate(data.from) : '—'} — ${data.to ? fmtDate(data.to) : '—'}`,
                },
                {
                  key: 'goodsIdentity',
                  label: 'Tovar identifikligi (Σ buyurtma − Σ ustun)',
                  children: <CheckTag value={data.checks.goodsIdentity} />,
                },
                {
                  key: 'paymentsIdentity',
                  label: "To'lov identifikligi (Σ to'lov − Σ ustun)",
                  children: <CheckTag value={data.checks.paymentsIdentity} />,
                },
              ]}
            />
          </Card>
        </>
      )}
    </Space>
  );
}

// ─────────────────────── orders register ───────────────────────

function RegisterTab() {
  const { message } = App.useApp();
  const [range, setRange] = useState<Range>([dayjs().startOf('month'), dayjs()]);
  const [clientId, setClientId] = useState<string | undefined>(undefined);
  const [factoryId, setFactoryId] = useState<string | undefined>(undefined);
  const [clientSearch, setClientSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [downloading, setDownloading] = useState(false);
  const { from, to } = rangeParams(range);

  const clientsQ = useQuery({
    queryKey: ['clients', 'options', clientSearch],
    queryFn: () => endpoints.clients({ search: clientSearch || undefined, pageSize: 50 }),
  });
  const factoriesQ = useQuery({
    queryKey: ['factories'],
    queryFn: () => endpoints.factories(),
  });

  const filters = useMemo(
    () => ({ from, to, clientId, factoryId }),
    [from, to, clientId, factoryId],
  );
  const registerQ = useQuery({
    queryKey: ['reports', 'orders-register', filters, page, pageSize],
    queryFn: async () => {
      const res = await endpoints.ordersRegister({ ...filters, page, pageSize });
      return res as unknown as { items: RegisterRow[]; total: number };
    },
    placeholderData: (prev) => prev,
  });

  const columns: TableColumnsType<RegisterRow> = [
    { title: 'Sana', dataIndex: 'date', key: 'date', width: 100, fixed: 'left', render: (v: string) => fmtDate(v) },
    { title: '№', dataIndex: 'orderNo', key: 'orderNo', width: 110, fixed: 'left' },
    { title: 'Agent', dataIndex: 'agent', key: 'agent', width: 130, render: (v: string | null) => v || '—' },
    { title: 'Mijoz', dataIndex: 'client', key: 'client', width: 170 },
    { title: 'Zavod', dataIndex: 'factory', key: 'factory', width: 140 },
    { title: 'Moshina', dataIndex: 'plate', key: 'plate', width: 120, render: (v: string | null) => v || '—' },
    { title: 'Shofyor', dataIndex: 'driver', key: 'driver', width: 130, render: (v: string | null) => v || '—' },
    { title: "O'lchamlar", dataIndex: 'sizes', key: 'sizes', width: 150, ellipsis: true },
    {
      title: 'Hajm',
      dataIndex: 'm3',
      key: 'm3',
      width: 100,
      align: 'right',
      className: 'num',
      render: (v: string) => fmtM3(v),
    },
    {
      title: "Tannarx (so'm/m³)",
      dataIndex: 'costPrice',
      key: 'costPrice',
      width: 140,
      align: 'right',
      className: 'num',
      render: (v: string) => fmtNum(v, 2),
    },
    {
      title: 'Tannarx jami',
      dataIndex: 'costTotal',
      key: 'costTotal',
      width: 140,
      align: 'right',
      className: 'num',
      render: (v: string) => <Money value={v} />,
    },
    {
      title: 'Tannarx holati',
      dataIndex: 'costStatus',
      key: 'costStatus',
      width: 150,
      render: (v: CostStatus) => <CostStatusTag status={v} />,
    },
    {
      title: 'Paddon',
      dataIndex: 'pallets',
      key: 'pallets',
      width: 90,
      align: 'right',
      className: 'num',
      render: (v: number) => fmtNum(v),
    },
    {
      title: 'Paddon puli',
      dataIndex: 'palletMoney',
      key: 'palletMoney',
      width: 120,
      align: 'right',
      className: 'num',
      render: (v: string) => <Money value={v} />,
    },
    {
      title: "Sotish (so'm/m³)",
      dataIndex: 'salePrice',
      key: 'salePrice',
      width: 140,
      align: 'right',
      className: 'num',
      render: (v: string) => fmtNum(v, 2),
    },
    {
      title: 'Sotish jami',
      dataIndex: 'saleTotal',
      key: 'saleTotal',
      width: 140,
      align: 'right',
      className: 'num',
      render: (v: string) => <Money value={v} strong />,
    },
    {
      title: 'Transport tannarx',
      dataIndex: 'transportCost',
      key: 'transportCost',
      width: 140,
      align: 'right',
      className: 'num',
      render: (v: string) => <Money value={v} />,
    },
    {
      title: 'Transport (mijozdan)',
      dataIndex: 'transportCharge',
      key: 'transportCharge',
      width: 150,
      align: 'right',
      className: 'num',
      render: (v: string) => <Money value={v} />,
    },
    {
      title: 'Transport holati',
      dataIndex: 'transportPaidStatus',
      key: 'transportPaidStatus',
      width: 140,
      render: (v: TransportPaidStatus) => <TransportPaidTag status={v} />,
    },
    {
      title: 'Foyda',
      dataIndex: 'goodsProfit',
      key: 'goodsProfit',
      width: 130,
      align: 'right',
      className: 'num',
      render: (v: string) => <Money value={v} signed strong />,
    },
    {
      title: 'Holat',
      dataIndex: 'status',
      key: 'status',
      width: 130,
      render: (v: OrderStatus) => <OrderStatusTag status={v} />,
    },
  ];

  const onDownload = async () => {
    setDownloading(true);
    try {
      await downloadFile('/reports/orders-register.xlsx', filters);
    } catch (e) {
      message.error(apiError(e));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Space wrap>
        <DatePicker.RangePicker
          value={range}
          onChange={(v) => {
            setRange(v as Range);
            setPage(1);
          }}
          format="DD.MM.YYYY"
          allowClear
        />
        <Select
          allowClear
          showSearch
          filterOption={false}
          placeholder="Mijoz"
          style={{ width: 220 }}
          value={clientId}
          onSearch={setClientSearch}
          onChange={(v) => {
            setClientId(v);
            setPage(1);
          }}
          loading={clientsQ.isFetching}
          options={(clientsQ.data?.items ?? []).map((c) => ({ value: c.id, label: c.name }))}
          notFoundContent={clientsQ.isFetching ? <Spin size="small" /> : null}
        />
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="Zavod"
          style={{ width: 200 }}
          value={factoryId}
          onChange={(v) => {
            setFactoryId(v);
            setPage(1);
          }}
          options={asItems(factoriesQ.data).map((f) => ({ value: f.id, label: f.name }))}
        />
        <Button icon={<DownloadOutlined />} loading={downloading} onClick={onDownload}>
          Excel (orders-register.xlsx)
        </Button>
      </Space>

      {registerQ.error ? (
        <Alert
          type="error"
          showIcon
          message="Reestrni yuklashda xatolik"
          description={apiError(registerQ.error)}
          action={
            <Button size="small" onClick={() => registerQ.refetch()}>
              Qayta urinish
            </Button>
          }
        />
      ) : (
        <div className="scroll-x">
          <Table<RegisterRow>
            rowKey="id"
            columns={columns}
            dataSource={registerQ.data?.items ?? []}
            loading={registerQ.isFetching}
            scroll={{ x: 2400 }}
            pagination={{
              current: page,
              pageSize,
              total: registerQ.data?.total ?? 0,
              showSizeChanger: true,
              onChange: (p, ps) => {
                setPage(p);
                setPageSize(ps);
              },
            }}
            size="small"
          />
        </div>
      )}
    </Space>
  );
}

export default function Reports() {
  return (
    <Card
      title={<Typography.Title level={4} style={{ margin: 0 }}>Hisobotlar</Typography.Title>}
    >
      <Tabs
        items={[
          { key: 'svod', label: 'Svod', children: <SvodTab /> },
          { key: 'register', label: 'Buyurtmalar reestri', children: <RegisterTab /> },
        ]}
      />
    </Card>
  );
}
