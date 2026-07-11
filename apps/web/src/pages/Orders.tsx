import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, DatePicker, Flex, Input, Select, Space, Table, Tabs, Typography } from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { Dayjs } from 'dayjs';
import { apiError, asItems, endpoints } from '../lib/api';
import { fmtDate, ORDER_STATUS } from '../lib/format';
import { Money } from '../components/Money';
import { CostStatusTag, OrderStatusTag, TransportPaidTag } from '../components/StatusTag';
import type { Order, OrderStatus } from '../lib/types';

const { RangePicker } = DatePicker;

const STATUS_TABS = [
  { key: '', label: 'Barchasi' },
  ...(Object.keys(ORDER_STATUS) as OrderStatus[]).map((s) => ({ key: s, label: ORDER_STATUS[s].label })),
];

export default function Orders() {
  const navigate = useNavigate();

  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [clientId, setClientId] = useState<string | undefined>(undefined);
  const [factoryId, setFactoryId] = useState<string | undefined>(undefined);
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);

  const dateFrom = range?.[0] ? range[0].format('YYYY-MM-DD') : undefined;
  const dateTo = range?.[1] ? range[1].format('YYYY-MM-DD') : undefined;

  const params = {
    page,
    pageSize,
    ...(search ? { search } : {}),
    ...(status ? { status } : {}),
    ...(clientId ? { clientId } : {}),
    ...(factoryId ? { factoryId } : {}),
    ...(dateFrom ? { dateFrom } : {}),
    ...(dateTo ? { dateTo } : {}),
  };

  const ordersQ = useQuery({
    queryKey: ['orders', 'list', params],
    queryFn: () => endpoints.orders(params),
    placeholderData: keepPreviousData,
  });

  const clientsQ = useQuery({
    queryKey: ['clients', 'select'],
    queryFn: () => endpoints.clients({ pageSize: 200 }),
  });

  const factoriesQ = useQuery({
    queryKey: ['factories', 'select'],
    queryFn: () => endpoints.factories(),
  });

  const clientOptions = (clientsQ.data?.items ?? []).map((c) => ({ label: c.name, value: c.id }));
  const factoryOptions = asItems(factoriesQ.data).map((f) => ({ label: f.name, value: f.id }));

  const columns: ColumnsType<Order> = [
    {
      title: 'Buyurtma',
      key: 'orderNo',
      fixed: 'left',
      render: (_, r) => <Link to={`/orders/${r.id}`}>{r.orderNo}</Link>,
    },
    { title: 'Sana', key: 'date', render: (_, r) => fmtDate(r.date) },
    { title: 'Mijoz', key: 'client', render: (_, r) => r.client?.name ?? '—' },
    { title: 'Agent', key: 'agent', render: (_, r) => r.agent?.name ?? '—' },
    { title: 'Zavod', key: 'factory', render: (_, r) => r.factory?.name ?? '—' },
    { title: 'Moshina', key: 'vehicle', render: (_, r) => r.vehicle?.plate || r.vehicle?.name || '—' },
    {
      title: 'Savdo summasi',
      key: 'saleTotal',
      align: 'right',
      className: 'num',
      render: (_, r) => <Money value={r.saleTotal} />,
    },
    { title: 'Tannarx', key: 'costStatus', render: (_, r) => <CostStatusTag status={r.costStatus} /> },
    { title: 'Holat', key: 'status', render: (_, r) => <OrderStatusTag status={r.status} /> },
    {
      title: 'Transport',
      key: 'transportPaidStatus',
      render: (_, r) => <TransportPaidTag status={r.transportPaidStatus} />,
    },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Flex justify="space-between" align="center" wrap gap={12}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          Buyurtmalar
        </Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/orders/new')}>
          Yangi buyurtma
        </Button>
      </Flex>

      <Card>
        <Tabs
          activeKey={status}
          onChange={(k) => {
            setStatus(k);
            setPage(1);
          }}
          items={STATUS_TABS}
        />

        <Space wrap size={12} style={{ marginBottom: 16 }}>
          <Input.Search
            allowClear
            placeholder="Buyurtma raqami yoki mijoz"
            style={{ width: 240 }}
            onSearch={(v) => {
              setSearch(v.trim());
              setPage(1);
            }}
          />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="Mijoz"
            style={{ width: 220 }}
            loading={clientsQ.isFetching}
            options={clientOptions}
            value={clientId}
            onChange={(v: string | undefined) => {
              setClientId(v);
              setPage(1);
            }}
          />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="Zavod"
            style={{ width: 200 }}
            loading={factoriesQ.isFetching}
            options={factoryOptions}
            value={factoryId}
            onChange={(v: string | undefined) => {
              setFactoryId(v);
              setPage(1);
            }}
          />
          <RangePicker
            value={range}
            onChange={(v) => {
              setRange(v);
              setPage(1);
            }}
            format="DD.MM.YYYY"
          />
        </Space>

        {ordersQ.isError ? (
          <Alert
            type="error"
            showIcon
            message="Buyurtmalarni yuklashda xatolik"
            description={apiError(ordersQ.error)}
            action={
              <Button icon={<ReloadOutlined />} onClick={() => ordersQ.refetch()}>
                Qayta urinish
              </Button>
            }
          />
        ) : (
          <Table<Order>
            rowKey="id"
            columns={columns}
            dataSource={ordersQ.data?.items ?? []}
            loading={ordersQ.isFetching}
            scroll={{ x: 1200 }}
            pagination={{
              current: page,
              pageSize,
              total: ordersQ.data?.total ?? 0,
              showSizeChanger: true,
              showTotal: (t) => `Jami: ${t} ta`,
              onChange: (p, ps) => {
                setPage(ps !== pageSize ? 1 : p);
                setPageSize(ps);
              },
            }}
          />
        )}
      </Card>
    </Space>
  );
}
