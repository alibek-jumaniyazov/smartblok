// AgentDetail — agent card in the standard party-page pattern (ClientDetail idiom):
// PageHeader with ?tab= tabs (Mijozlar · Buyurtmalar · To'lovlar) over the
// Descriptions card + 6-StatCard KPI band. Mijozlar reads the detail payload
// (balance + palletBalance per client); Buyurtmalar / To'lovlar are server-paginated
// registers filtered by ?agentId=.
import { Link, useNavigate, useParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Card, Descriptions, Skeleton, Space } from 'antd';
import { endpoints } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { useUrlFilters } from '../lib/useUrlFilters';
import { can } from '../lib/permissions';
import { fmtDate, fmtMoney, num } from '../lib/format';
import { useT } from '../components/LangContext';
import { translate } from '../lib/i18n';
import { PAYMENT_KIND, PAYMENT_METHOD, STATUS, type StatusMeta } from '../lib/status-maps';
import {
  BalanceTag,
  DataTable,
  ErrorState,
  MoneyCell,
  PageHeader,
  PalletChip,
  StatCard,
  StatusChip,
  TableCard,
  type SbColumn,
} from '../components';
import type { Agent, ClientRow, Money as MoneyStr, Order, Payment } from '../lib/types';

interface AgentClientRow extends ClientRow {
  balance: MoneyStr;
  palletBalance?: number;
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

const TAB_KEYS = ['mijozlar', 'buyurtmalar', 'tolovlar'] as const;

// Faol/Nofaol — StatusChip metas (same hues as Agents.tsx).
const ACTIVE_META: StatusMeta = {
  light: '#1A7F37',
  dark: '#6CC495',
  get label() {
    return translate('Faol');
  },
};
const INACTIVE_META: StatusMeta = {
  light: '#64748B',
  dark: '#94A3B8',
  get label() {
    return translate('Nofaol');
  },
};

export default function AgentDetail() {
  const { id } = useParams<{ id: string }>();
  const t = useT();
  const { user } = useAuth();
  const navigate = useNavigate();
  const uf = useUrlFilters();
  const role = user?.role;

  // ── active tab (?tab=) ──
  const rawTab = uf.get('tab') || 'mijozlar';
  const activeTab = (TAB_KEYS as readonly string[]).includes(rawTab) ? rawTab : 'mijozlar';

  // ── register pagination (shared param; only one tab is mounted at a time) ──
  const page = Number(uf.get('page')) || 1;
  const pageSize = Number(uf.get('pageSize')) || 20;

  const detailQ = useQuery({
    queryKey: ['agents', id],
    queryFn: () => endpoints.agent(id!),
    enabled: !!id,
  });
  const data = detailQ.data as AgentDetailData | undefined;

  // register queries (each gated to its active tab)
  const ordersQ = useQuery({
    queryKey: ['orders', 'agent', id, page, pageSize],
    queryFn: () => endpoints.orders({ agentId: id!, page, pageSize }),
    enabled: !!id && activeTab === 'buyurtmalar' && can(role, 'orders.view'),
    placeholderData: keepPreviousData,
  });
  const paymentsQ = useQuery({
    queryKey: ['payments', 'agent', id, page, pageSize],
    queryFn: () => endpoints.payments({ agentId: id!, page, pageSize }),
    enabled: !!id && activeTab === 'tolovlar' && can(role, 'payments.view'),
    placeholderData: keepPreviousData,
  });

  // ── loading / error ──
  if (detailQ.isLoading || (!data && detailQ.isFetching)) {
    return (
      <div>
        <Skeleton.Input active size="small" style={{ width: 200, marginBottom: 20 }} />
        <Skeleton active title paragraph={{ rows: 3 }} />
        <div style={{ marginTop: 28 }}>
          <Skeleton active title={false} paragraph={{ rows: 6 }} />
        </div>
      </div>
    );
  }
  if (detailQ.isError || !data) {
    return (
      <div>
        <ErrorState
          error={detailQ.error ?? new Error(t('Agent topilmadi'))}
          message="Agent ma'lumotini yuklashda xatolik"
          onRetry={() => detailQ.refetch()}
        />
        <div style={{ textAlign: 'center', marginTop: -24, paddingBottom: 24 }}>
          <Link to="/agents">{t('Agentlarga qaytish')}</Link>
        </div>
      </div>
    );
  }

  const { kpi } = data;

  // ── columns ──
  const clientColumns: SbColumn<AgentClientRow>[] = [
    {
      title: 'Mijoz',
      dataIndex: 'name',
      key: 'name',
      ellipsis: true,
      width: 240,
      render: (v: string, c) => (
        <Space>
          <Link to={`/clients/${c.id}`}>{v}</Link>
          {!c.active && <StatusChip meta={INACTIVE_META} />}
        </Space>
      ),
    },
    {
      title: 'Telefon',
      dataIndex: 'phone',
      key: 'phone',
      ellipsis: true,
      width: 150,
      render: (v: string | null) => v || '—',
    },
    {
      title: 'Balans',
      dataIndex: 'balance',
      key: 'balance',
      align: 'right',
      width: 160,
      render: (v: MoneyStr) => <BalanceTag balance={v} partyType="client" />,
    },
    {
      title: 'Paddon',
      key: 'palletBalance',
      align: 'center',
      render: (_, c) => ((c.palletBalance ?? 0) > 0 ? <PalletChip pallets={c.palletBalance ?? 0} compact /> : '—'),
    },
  ];

  const orderColumns: SbColumn<Order>[] = [
    {
      title: '№',
      dataIndex: 'orderNo',
      key: 'orderNo',
      render: (v: string, o) => <Link to={`/orders/${o.id}`}>{v}</Link>,
    },
    { title: 'Sana', dataIndex: 'date', key: 'date', render: (v: string) => fmtDate(v) },
    { title: 'Mijoz', key: 'client', ellipsis: true, width: 200, render: (_, o) => o.client?.name ?? '—' },
    {
      title: 'Holat',
      dataIndex: 'status',
      key: 'status',
      render: (v: Order['status']) => <StatusChip meta={STATUS[v]} />,
    },
    {
      title: "Summa (so'm)",
      dataIndex: 'saleTotal',
      key: 'saleTotal',
      align: 'right',
      render: (v: MoneyStr) => <MoneyCell value={v} />,
    },
  ];

  const paymentColumns: SbColumn<Payment>[] = [
    { title: 'Sana', dataIndex: 'date', key: 'date', render: (v: string) => fmtDate(v) },
    { title: 'Mijoz', key: 'client', ellipsis: true, width: 200, render: (_, p) => p.client?.name ?? '—' },
    { title: 'Turi', dataIndex: 'kind', key: 'kind', render: (v: Payment['kind']) => PAYMENT_KIND[v]?.label ?? v },
    {
      title: 'Usul',
      dataIndex: 'method',
      key: 'method',
      render: (v: Payment['method']) => PAYMENT_METHOD[v]?.label ?? v,
    },
    {
      title: "Summa (so'm)",
      dataIndex: 'amount',
      key: 'amount',
      align: 'right',
      render: (v: MoneyStr) => <MoneyCell value={v} />,
    },
    { title: 'Izoh', dataIndex: 'note', key: 'note', ellipsis: true, width: 200, render: (v: string | null) => v || '—' },
  ];

  // ── tab bodies ──
  const renderTab = (key: string) => {
    switch (key) {
      case 'mijozlar':
        return (
          <TableCard>
            <DataTable<AgentClientRow>
              rowKey="id"
              columns={clientColumns}
              query={{ data: data.clients, isFetching: detailQ.isFetching }}
              defaultPageSize={20}
              filterKeys={[]}
              scroll={{ x: 'max-content' }}
              onRowOpen={(c) => navigate(`/clients/${c.id}`)}
              emptyText="Bu agentda hali mijoz yo'q"
            />
          </TableCard>
        );

      case 'buyurtmalar':
        return (
          <TableCard footer={<Link to="/orders">{t("Hammasini ko'rish →")}</Link>}>
            <DataTable<Order>
              rowKey="id"
              columns={orderColumns}
              query={ordersQ}
              defaultPageSize={20}
              filterKeys={[]}
              scroll={{ x: 'max-content' }}
              onRowOpen={(o) => navigate(`/orders/${o.id}`)}
              emptyText="Bu agentda hali buyurtma yo'q"
            />
          </TableCard>
        );

      case 'tolovlar':
        return (
          <TableCard footer={<Link to="/payments">{t("Hammasini ko'rish →")}</Link>}>
            <DataTable<Payment>
              rowKey="id"
              columns={paymentColumns}
              query={paymentsQ}
              defaultPageSize={20}
              filterKeys={[]}
              scroll={{ x: 'max-content' }}
              ghostWhen={(p) => p.voidedAt != null}
              onRowOpen={(p) => navigate(`/payments?peek=${p.id}`)}
              emptyText="Bu agentda hali to'lov yo'q"
            />
          </TableCard>
        );

      default:
        return null;
    }
  };

  const tabDefs = [
    { key: 'mijozlar', label: t('Mijozlar') },
    { key: 'buyurtmalar', label: t('Buyurtmalar') },
    { key: 'tolovlar', label: t("To'lovlar") },
  ];

  return (
    <div>
      <PageHeader
        title={data.name}
        accent
        breadcrumb={[{ label: 'Agentlar', to: '/agents' }]}
        status={<StatusChip meta={data.active ? ACTIVE_META : INACTIVE_META} variant="filled" />}
        tabs={tabDefs}
        activeTab={activeTab}
        onTabChange={(k) => uf.set({ tab: k })}
      />

      <Space orientation="vertical" size={16} style={{ width: '100%' }}>
        <Card>
          <Descriptions
            size="small"
            column={{ xs: 1, sm: 2, lg: 3 }}
            items={[
              { key: 'phone', label: t('Telefon'), children: data.phone || '—' },
              { key: 'clientCount', label: t('Mijozlar soni'), children: data.clients.length },
              {
                key: 'debtLimit',
                label: t('Qarz limiti'),
                children:
                  data.debtLimit == null
                    ? t('Cheklanmagan')
                    : num(data.debtLimit) === 0
                      ? t('0 — yangi buyurtmalar bloklangan')
                      : fmtMoney(data.debtLimit) + ' ' + t("so'm"),
              },
            ]}
          />
        </Card>

        <div className="sb-kpi-grid">
          <StatCard size="md" label="Buyurtmalar" value={kpi.ordersCount} />
          <StatCard size="md" label="Sotuvlar" value={kpi.saleTotal} suffix="so'm" variant="in" />
          <StatCard size="md" label="Diller foydasi" value={kpi.goodsProfit} suffix="so'm" variant="in" />
          <StatCard size="md" label="Yig'ilgan to'lovlar" value={kpi.collected} suffix="so'm" variant="in" />
          <StatCard size="md" label="Ochiq qarz" value={kpi.outstandingDebt} suffix="so'm" variant="owedToUs" />
          <StatCard size="md" label="Mijozlardagi paddonlar" value={kpi.palletExposure} suffix="dona" />
        </div>

        {renderTab(activeTab)}
      </Space>
    </div>
  );
}
