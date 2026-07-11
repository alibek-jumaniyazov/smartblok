import { useState } from 'react';
import { Alert, Button, Card, Col, Flex, Input, Row, Select, Space, Table, Tag, Tooltip, Typography } from 'antd';
import type { TableProps } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiError, endpoints } from '../lib/api';
import { fmtMoney, fmtNum, fmtUZS, num } from '../lib/format';
import { useAuth } from '../auth/AuthContext';
import type { Paged } from '../lib/types';

interface DebtsSummary {
  clientsOweUs: string;
  weOweClients: string;
  factoryAdvance: string;
  weOweFactories: string;
  weOweVehicles: string;
  palletsAtClients: number;
}

interface DebtClientRow {
  id: string;
  name: string;
  phone?: string | null;
  agent?: { id: string; name: string } | null;
  region?: { id: string; name: string } | null;
  paymentTermDays?: number | null;
  creditLimit?: string | null;
  balance: string;
  palletBalance: number;
  hasOverdueOrders: boolean;
  overdueOrdersCount: number;
  overdueOrdersTotal: string;
  dueWithinWindow: boolean;
}

interface DebtsClientsResponse extends Paged<DebtClientRow> {
  days: number;
  expectedCollections: string;
}

const SUMMARY_CARDS: {
  key: keyof DebtsSummary;
  label: string;
  type?: 'danger' | 'warning' | 'success';
  count?: boolean;
}[] = [
  { key: 'clientsOweUs', label: 'Mijozlar bizga qarz', type: 'danger' },
  { key: 'weOweClients', label: 'Mijozlar avansi (biz qarzmiz)', type: 'warning' },
  { key: 'factoryAdvance', label: 'Zavoddagi avansimiz', type: 'success' },
  { key: 'weOweFactories', label: 'Zavodlarga qarzimiz', type: 'danger' },
  { key: 'weOweVehicles', label: 'Shofyorlarga qarzimiz', type: 'warning' },
  { key: 'palletsAtClients', label: 'Mijozlardagi paddonlar', count: true },
];

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

export default function Debts() {
  const { hasRole } = useAuth();
  const isFin = hasRole('ADMIN', 'ACCOUNTANT');

  const [search, setSearch] = useState<string | undefined>();
  const [days, setDays] = useState(7);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const summaryQ = useQuery({
    queryKey: ['debts', 'summary'],
    queryFn: () => endpoints.debtsSummary() as Promise<DebtsSummary>,
    enabled: isFin,
  });

  const clientsParams = { page, pageSize, search, days };
  const clientsQ = useQuery({
    queryKey: ['debts', 'clients', clientsParams],
    queryFn: () => endpoints.debtsClients(clientsParams) as Promise<DebtsClientsResponse>,
  });

  const columns: TableProps<DebtClientRow>['columns'] = [
    {
      title: 'Mijoz',
      dataIndex: 'name',
      render: (v: string, r) => <Link to={`/clients/${r.id}`}>{v}</Link>,
    },
    { title: 'Agent', key: 'agent', render: (_, r) => r.agent?.name ?? '—' },
    { title: 'Hudud', key: 'region', render: (_, r) => r.region?.name ?? '—' },
    { title: 'Telefon', dataIndex: 'phone', width: 140, render: (v: string | null) => v || '—' },
    {
      title: 'Qarz balansi',
      dataIndex: 'balance',
      align: 'right',
      width: 160,
      render: (v: string) => {
        const n = num(v);
        return (
          <Typography.Text
            className="num"
            strong
            type={n > 0 ? 'danger' : n < 0 ? 'success' : 'secondary'}
            style={{ whiteSpace: 'nowrap' }}
          >
            {fmtMoney(v)}
          </Typography.Text>
        );
      },
    },
    {
      title: 'Paddon',
      dataIndex: 'palletBalance',
      align: 'right',
      width: 90,
      render: (v: number) => (
        <Typography.Text className="num" type={v > 0 ? 'warning' : undefined}>
          {fmtNum(v)}
        </Typography.Text>
      ),
    },
    {
      title: 'Muddat',
      key: 'due',
      width: 200,
      render: (_, r) => (
        <Space size={4} wrap>
          {r.hasOverdueOrders && (
            <Tooltip title={`${r.overdueOrdersCount} ta buyurtma, jami ${fmtUZS(r.overdueOrdersTotal)}`}>
              <Tag color="red">Muddati o'tgan</Tag>
            </Tooltip>
          )}
          {r.dueWithinWindow && <Tag color="gold">Muddati yaqin</Tag>}
          {!r.hasOverdueOrders && !r.dueWithinWindow && <Typography.Text type="secondary">—</Typography.Text>}
        </Space>
      ),
    },
    {
      title: "To'lov sharti",
      dataIndex: 'paymentTermDays',
      align: 'right',
      width: 110,
      render: (v: number | null) => (v != null ? `${v} kun` : '—'),
    },
  ];

  return (
    <Space orientation="vertical" size={16} style={{ display: 'flex' }}>
      <Typography.Title level={3} style={{ margin: 0 }}>
        Qarzlar
      </Typography.Title>

      {isFin &&
        (summaryQ.isError ? (
          <LoadError error={summaryQ.error} onRetry={() => summaryQ.refetch()} />
        ) : (
          <Row gutter={[12, 12]}>
            {SUMMARY_CARDS.map((c) => (
              <Col key={c.key} xs={24} sm={12} lg={8} xl={4}>
                <Card size="small" loading={summaryQ.isPending}>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {c.label}
                  </Typography.Text>
                  <div style={{ fontSize: 18, marginTop: 4 }}>
                    {summaryQ.data && (
                      <Typography.Text
                        strong
                        type={c.type}
                        className="num"
                        style={{ whiteSpace: 'nowrap', fontSize: 18 }}
                      >
                        {c.count
                          ? `${fmtNum(summaryQ.data[c.key])} dona`
                          : `${fmtMoney(summaryQ.data[c.key])} so'm`}
                      </Typography.Text>
                    )}
                  </div>
                </Card>
              </Col>
            ))}
          </Row>
        ))}

      <Card size="small">
        <Flex justify="space-between" align="center" wrap gap={12} style={{ marginBottom: 12 }}>
          <Space wrap>
            <Input.Search
              allowClear
              placeholder="Mijoz nomi bo'yicha qidirish"
              style={{ width: 260 }}
              onSearch={(v) => {
                setSearch(v || undefined);
                setPage(1);
              }}
            />
            <Select
              value={days}
              style={{ width: 150 }}
              options={[
                { value: 7, label: '7 kun ichida' },
                { value: 14, label: '14 kun ichida' },
                { value: 30, label: '30 kun ichida' },
              ]}
              onChange={(v) => {
                setDays(v);
                setPage(1);
              }}
            />
          </Space>
          <Space size={8} wrap>
            <Typography.Text type="secondary">Kutilayotgan tushum ({days} kun):</Typography.Text>
            <Typography.Text strong className="num" style={{ fontSize: 18, whiteSpace: 'nowrap' }}>
              {clientsQ.data ? `${fmtMoney(clientsQ.data.expectedCollections)} so'm` : '—'}
            </Typography.Text>
          </Space>
        </Flex>
        {clientsQ.isError ? (
          <LoadError error={clientsQ.error} onRetry={() => clientsQ.refetch()} />
        ) : (
          <Table<DebtClientRow>
            rowKey="id"
            size="small"
            columns={columns}
            dataSource={clientsQ.data?.items ?? []}
            loading={clientsQ.isFetching}
            scroll={{ x: 1000 }}
            pagination={{
              current: page,
              pageSize,
              total: clientsQ.data?.total ?? 0,
              showSizeChanger: true,
              onChange: (p, ps) => {
                setPage(p);
                setPageSize(ps);
              },
            }}
          />
        )}
      </Card>
    </Space>
  );
}
