import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Flex,
  Row,
  Space,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography,
  theme,
} from 'antd';
import type { TableColumnsType } from 'antd';
import { ArrowDownOutlined, ArrowUpOutlined, ReloadOutlined } from '@ant-design/icons';
import { Line } from '@ant-design/plots';
import dayjs from 'dayjs';
import { apiError, endpoints } from '../lib/api';
import { fmtDate, fmtM3, fmtNum, fmtShort, fmtUZS, num } from '../lib/format';
import { Money } from '../components/Money';
import { useAuth } from '../auth/AuthContext';
import { useThemeMode } from '../components/ThemeContext';

// ── actual backend response shapes (dashboard.service.ts) ──

interface SummaryResp {
  scope: 'agent' | 'global';
  todaySales: string;
  monthSales: string;
  yearSales: string;
  ordersInFlight: number;
  clientsOweUs: string;
  weOweFactories: string;
  weOweVehicles: string;
  collectedThisMonth: string;
  goodsProfitMonth: string;
  transportProfitMonth: string;
  bonusWallets: string;
  palletsAtClients: number;
  cubeSoldMonth: string;
  expectedCollections: string;
}

interface TrendRow {
  date: string;
  sales: string | number;
  orders: number;
  collected: string | number;
}

interface RankRow {
  agentId: string;
  agent: string;
  sales: string;
  goodsProfit: string;
  collected: string;
  outstandingDebt: string;
  orders: number;
}

interface RankingResp {
  month: string;
  agents: RankRow[];
}

interface KassaBox {
  cashboxId: string;
  name: string;
  type: string;
  currency: string;
  balance: string;
  todayIn: string;
  todayOut: string;
}

// series colors validated for CVD + contrast per theme surface (dataviz checks)
const SERIES_SALES = 'Savdo';
const SERIES_COLLECTED = "Yig'ilgan to'lov";
const CHART_COLORS: Record<'light' | 'dark', [string, string]> = {
  light: ['#1f6f9e', '#b47a00'],
  dark: ['#4d94c9', '#b8821a'],
};

function LiveTag() {
  return (
    <Tooltip title="Ma'lumotlar real vaqtda yangilanib turadi">
      <Tag color="green" style={{ marginInlineEnd: 0 }}>
        ● LIVE
      </Tag>
    </Tooltip>
  );
}

function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <Alert
      type="error"
      showIcon
      message="Ma'lumotni yuklab bo'lmadi"
      description={apiError(error)}
      action={
        <Button size="small" icon={<ReloadOutlined />} onClick={onRetry}>
          Qayta urinish
        </Button>
      }
    />
  );
}

function Kpi({
  title,
  value,
  kind = 'money',
  loading,
  color,
}: {
  title: string;
  value: string | number | null | undefined;
  kind?: 'money' | 'count' | 'm3';
  loading?: boolean;
  color?: string;
}) {
  const text = kind === 'money' ? fmtShort(value) : kind === 'm3' ? fmtM3(value) : fmtNum(value);
  const body = (
    <span className="num" style={color ? { color } : undefined}>
      {text}
    </span>
  );
  return (
    <Card size="small">
      <Statistic
        title={title}
        loading={loading}
        valueRender={() => (kind === 'money' ? <Tooltip title={fmtUZS(value)}>{body}</Tooltip> : body)}
      />
    </Card>
  );
}

// ── CASHIER: kassa-only dashboard ──

function KassaDashboard() {
  const { token } = theme.useToken();
  const q = useQuery({
    queryKey: ['dashboard', 'kassa'],
    queryFn: async () => (await endpoints.kassaDashboard()) as KassaBox[],
  });

  return (
    <div>
      <Flex justify="space-between" align="center" style={{ marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Kassa paneli
        </Typography.Title>
        <LiveTag />
      </Flex>
      {q.isError ? (
        <LoadError error={q.error} onRetry={() => q.refetch()} />
      ) : q.isLoading ? (
        <Card loading />
      ) : (q.data ?? []).length === 0 ? (
        <Card>
          <Empty description="Faol kassalar topilmadi" />
        </Card>
      ) : (
        <Row gutter={[16, 16]}>
          {(q.data ?? []).map((b) => (
            <Col xs={24} sm={12} lg={8} xl={6} key={b.cashboxId}>
              <Card size="small" title={b.name} extra={<Tag>{b.type}</Tag>}>
                <Statistic
                  title={`Qoldiq (${b.currency})`}
                  valueRender={() => <Money value={b.balance} strong signed />}
                />
                <Space size="large" style={{ marginTop: 12 }}>
                  <Statistic
                    title="Bugun kirim"
                    valueRender={() => (
                      <span className="num" style={{ color: token.colorSuccess, fontSize: 16 }}>
                        <ArrowUpOutlined /> {fmtShort(b.todayIn)}
                      </span>
                    )}
                  />
                  <Statistic
                    title="Bugun chiqim"
                    valueRender={() => (
                      <span className="num" style={{ color: token.colorError, fontSize: 16 }}>
                        <ArrowDownOutlined /> {fmtShort(b.todayOut)}
                      </span>
                    )}
                  />
                </Space>
              </Card>
            </Col>
          ))}
        </Row>
      )}
    </div>
  );
}

// ── ADMIN / ACCOUNTANT / AGENT: executive dashboard ──

function MainDashboard({ isAgent }: { isAgent: boolean }) {
  const { token } = theme.useToken();
  const { mode } = useThemeMode();

  const summary = useQuery({
    queryKey: ['dashboard', 'summary'],
    queryFn: async () => (await endpoints.dashboard()) as unknown as SummaryResp,
  });
  const trends = useQuery({
    queryKey: ['dashboard', 'trends', 30],
    queryFn: async () => (await endpoints.trends(30)) as TrendRow[],
  });
  const ranking = useQuery({
    queryKey: ['dashboard', 'agents-ranking'],
    queryFn: async () => (await endpoints.agentsRanking()) as unknown as RankingResp,
    enabled: !isAgent,
  });

  const s = summary.data;
  const loading = summary.isLoading;
  const profitColor = (v: string | undefined) => (num(v) >= 0 ? token.colorSuccess : token.colorError);

  const chartData = useMemo(() => {
    const out: { date: string; series: string; value: number }[] = [];
    for (const r of trends.data ?? []) {
      out.push({ date: r.date, series: SERIES_SALES, value: num(r.sales) });
      out.push({ date: r.date, series: SERIES_COLLECTED, value: num(r.collected) });
    }
    return out;
  }, [trends.data]);

  const colors = CHART_COLORS[mode];

  const rankColumns: TableColumnsType<RankRow> = [
    { title: 'Agent', dataIndex: 'agent', key: 'agent' },
    {
      title: 'Savdo',
      dataIndex: 'sales',
      key: 'sales',
      align: 'right',
      render: (v: string) => <Money value={v} />,
    },
    {
      title: 'Mahsulot foydasi',
      dataIndex: 'goodsProfit',
      key: 'goodsProfit',
      align: 'right',
      render: (v: string) => <Money value={v} signed />,
    },
    {
      title: "Yig'ilgan",
      dataIndex: 'collected',
      key: 'collected',
      align: 'right',
      render: (v: string) => <Money value={v} />,
    },
    {
      title: 'Qarzdorlik',
      dataIndex: 'outstandingDebt',
      key: 'outstandingDebt',
      align: 'right',
      render: (v: string) => <Money value={v} />,
    },
    { title: 'Buyurtmalar', dataIndex: 'orders', key: 'orders', align: 'right', className: 'num' },
  ];

  return (
    <div>
      <Flex justify="space-between" align="center" style={{ marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Boshqaruv paneli
        </Typography.Title>
        <LiveTag />
      </Flex>

      {summary.isError ? (
        <LoadError error={summary.error} onRetry={() => summary.refetch()} />
      ) : (
        <Row gutter={[12, 12]}>
          <Col xs={12} md={8} xl={6} xxl={4}>
            <Kpi title="Bugungi savdo" value={s?.todaySales} loading={loading} />
          </Col>
          <Col xs={12} md={8} xl={6} xxl={4}>
            <Kpi title="Oy savdosi" value={s?.monthSales} loading={loading} />
          </Col>
          <Col xs={12} md={8} xl={6} xxl={4}>
            <Kpi title="Yil savdosi" value={s?.yearSales} loading={loading} />
          </Col>
          <Col xs={12} md={8} xl={6} xxl={4}>
            <Kpi title="Oyda yig'ilgan to'lov" value={s?.collectedThisMonth} loading={loading} />
          </Col>
          <Col xs={12} md={8} xl={6} xxl={4}>
            <Kpi
              title="Mahsulot foydasi (oy)"
              value={s?.goodsProfitMonth}
              loading={loading}
              color={profitColor(s?.goodsProfitMonth)}
            />
          </Col>
          <Col xs={12} md={8} xl={6} xxl={4}>
            <Kpi
              title="Transport foydasi (oy)"
              value={s?.transportProfitMonth}
              loading={loading}
              color={profitColor(s?.transportProfitMonth)}
            />
          </Col>
          <Col xs={12} md={8} xl={6} xxl={4}>
            <Kpi title="Mijozlar qarzi" value={s?.clientsOweUs} loading={loading} />
          </Col>
          {!isAgent && (
            <Col xs={12} md={8} xl={6} xxl={4}>
              <Kpi title="Zavodlarga qarzimiz" value={s?.weOweFactories} loading={loading} />
            </Col>
          )}
          {!isAgent && (
            <Col xs={12} md={8} xl={6} xxl={4}>
              <Kpi title="Bonus hamyonlar" value={s?.bonusWallets} loading={loading} />
            </Col>
          )}
          <Col xs={12} md={8} xl={6} xxl={4}>
            <Kpi title="Kutilayotgan tushum" value={s?.expectedCollections} loading={loading} />
          </Col>
          <Col xs={12} md={8} xl={6} xxl={4}>
            <Kpi title="Mijozlardagi paddonlar" value={s?.palletsAtClients} kind="count" loading={loading} />
          </Col>
          <Col xs={12} md={8} xl={6} xxl={4}>
            <Kpi title="Sotilgan hajm (oy)" value={s?.cubeSoldMonth} kind="m3" loading={loading} />
          </Col>
        </Row>
      )}

      <Card
        title="So'nggi 30 kun: savdo va yig'ilgan to'lovlar"
        size="small"
        style={{ marginTop: 16 }}
        loading={trends.isLoading}
      >
        {trends.isError ? (
          <LoadError error={trends.error} onRetry={() => trends.refetch()} />
        ) : (
          <Line
            data={chartData}
            xField="date"
            yField="value"
            colorField="series"
            height={300}
            autoFit
            scale={{
              color: { domain: [SERIES_SALES, SERIES_COLLECTED], range: colors },
              y: { nice: true },
            }}
            axis={{
              x: {
                title: false,
                labelFormatter: (d: string) => dayjs(d).format('DD.MM'),
                labelAutoHide: true,
              },
              y: { title: false, labelFormatter: (v: number) => fmtShort(v) },
            }}
            legend={{ color: { position: 'top' } }}
            tooltip={{
              title: (d: { date: string }) => fmtDate(d.date),
              items: [{ channel: 'y', valueFormatter: (v: number) => fmtUZS(v) }],
            }}
            style={{ lineWidth: 2 }}
            theme={mode === 'dark' ? { type: 'classicDark' as const } : { type: 'classic' as const }}
          />
        )}
      </Card>

      {!isAgent && (
        <Card
          title="Agentlar reytingi"
          size="small"
          style={{ marginTop: 16 }}
          extra={
            ranking.data?.month ? <Typography.Text type="secondary">{ranking.data.month}</Typography.Text> : null
          }
        >
          {ranking.isError ? (
            <LoadError error={ranking.error} onRetry={() => ranking.refetch()} />
          ) : (
            <div className="scroll-x">
              <Table<RankRow>
                rowKey="agentId"
                size="small"
                columns={rankColumns}
                dataSource={ranking.data?.agents ?? []}
                loading={ranking.isFetching}
                pagination={false}
              />
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  if (user?.role === 'CASHIER') return <KassaDashboard />;
  return <MainDashboard isAgent={user?.role === 'AGENT'} />;
}
