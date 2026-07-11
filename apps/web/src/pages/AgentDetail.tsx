import type { CSSProperties } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Col, Descriptions, Row, Space, Statistic, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ReloadOutlined } from '@ant-design/icons';
import { apiError, endpoints } from '../lib/api';
import { fmtMoney, fmtNum, isSettled, num } from '../lib/format';
import type { Agent, ClientRow, Money as MoneyStr } from '../lib/types';

interface AgentClientRow extends ClientRow {
  balance: MoneyStr;
}

interface AgentKpi {
  ordersCount: number;
  saleTotal: MoneyStr;
  goodsProfit: MoneyStr;
  collected: MoneyStr;
  outstandingDebt: MoneyStr;
  palletExposure: number;
}

interface AgentDetailData extends Agent {
  clients: AgentClientRow[];
  ownDebtLimit?: MoneyStr | null;
  kpi: AgentKpi;
}

/** Backend convention: positive balance = mijoz bizdan qarzdor (qizil), manfiy = avans (yashil). */
function BalanceCell({ value }: { value?: string | number | null }) {
  if (isSettled(value)) return <Typography.Text type="secondary">—</Typography.Text>;
  const v = num(value);
  const debt = v > 0;
  return (
    <Typography.Text
      type={debt ? 'danger' : 'success'}
      style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}
    >
      {fmtMoney(Math.abs(v))} {debt ? 'Qarz' : 'Avans'}
    </Typography.Text>
  );
}

export default function AgentDetail() {
  const { id } = useParams<{ id: string }>();

  const q = useQuery({
    queryKey: ['agents', id],
    queryFn: () => endpoints.agent(id!),
    enabled: !!id,
  });
  const data = q.data as AgentDetailData | undefined;

  if (q.error) {
    return (
      <Alert
        type="error"
        showIcon
        message="Agent ma'lumotini yuklashda xatolik"
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

  const { kpi } = data;

  const clientColumns: ColumnsType<AgentClientRow> = [
    {
      title: 'Mijoz',
      dataIndex: 'name',
      key: 'name',
      render: (v: string, c) => (
        <Space>
          <Link to={`/clients/${c.id}`}>{v}</Link>
          {!c.active && <Tag>Nofaol</Tag>}
        </Space>
      ),
    },
    { title: 'Hudud', key: 'region', render: (_, c) => c.region?.name ?? '—' },
    { title: 'Telefon', dataIndex: 'phone', key: 'phone', render: (v: string | null) => v || '—' },
    {
      title: 'Balans',
      dataIndex: 'balance',
      key: 'balance',
      align: 'right',
      render: (v: MoneyStr) => <BalanceCell value={v} />,
    },
  ];

  const kpiCards: { key: string; title: string; value: string; suffix?: string; valueStyle?: CSSProperties }[] = [
    { key: 'orders', title: 'Buyurtmalar', value: fmtNum(kpi.ordersCount) },
    { key: 'sales', title: 'Sotuvlar', value: fmtMoney(kpi.saleTotal), suffix: "so'm" },
    { key: 'profit', title: 'Mahsulot foydasi', value: fmtMoney(kpi.goodsProfit), suffix: "so'm" },
    { key: 'collected', title: "Yig'ilgan to'lovlar", value: fmtMoney(kpi.collected), suffix: "so'm" },
    {
      key: 'debt',
      title: 'Ochiq qarz',
      value: fmtMoney(kpi.outstandingDebt),
      suffix: "so'm",
      valueStyle: num(kpi.outstandingDebt) > 0 ? { color: '#cf1322' } : undefined,
    },
    { key: 'pallets', title: 'Mijozlardagi paddonlar', value: fmtNum(kpi.palletExposure), suffix: 'dona' },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card>
        <Space align="center">
          <Typography.Title level={3} style={{ margin: 0 }}>
            {data.name}
          </Typography.Title>
          {data.active ? <Tag color="green">Faol</Tag> : <Tag color="red">Nofaol</Tag>}
        </Space>
        <Descriptions
          size="small"
          column={{ xs: 1, sm: 2, lg: 3 }}
          style={{ marginTop: 12 }}
          items={[
            { key: 'phone', label: 'Telefon', children: data.phone || '—' },
            { key: 'clientCount', label: 'Mijozlar soni', children: data.clients.length },
            {
              key: 'debtLimit',
              label: 'Qarz limiti',
              children:
                data.debtLimit == null
                  ? 'Cheklanmagan'
                  : num(data.debtLimit) === 0
                    ? '0 — yangi buyurtmalar bloklangan'
                    : fmtMoney(data.debtLimit) + " so'm",
            },
          ]}
        />
      </Card>

      <Row gutter={[12, 12]}>
        {kpiCards.map((k) => (
          <Col key={k.key} xs={12} sm={8} xl={4}>
            <Card size="small">
              <Statistic title={k.title} value={k.value} suffix={k.suffix} valueStyle={k.valueStyle} />
            </Card>
          </Col>
        ))}
      </Row>

      <Card title="Mijozlar va balanslar">
        <Table<AgentClientRow>
          rowKey="id"
          size="small"
          columns={clientColumns}
          dataSource={data.clients}
          loading={q.isFetching}
          scroll={{ x: 'max-content' }}
          pagination={{ pageSize: 20, showSizeChanger: true }}
        />
      </Card>
    </Space>
  );
}
