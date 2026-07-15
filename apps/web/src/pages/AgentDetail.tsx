import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Descriptions, Space, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ReloadOutlined } from '@ant-design/icons';
import { apiError, endpoints } from '../lib/api';
import { fmtMoney, num } from '../lib/format';
import { BalanceTag, PageHeader, StatCard, TableCard } from '../components';
import { useT } from '../components/LangContext';
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

export default function AgentDetail() {
  const { id } = useParams<{ id: string }>();
  const t = useT();

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
        message={t("Agent ma'lumotini yuklashda xatolik")}
        description={apiError(q.error)}
        action={
          <Button icon={<ReloadOutlined />} onClick={() => q.refetch()}>
            {t('Qayta urinish')}
          </Button>
        }
      />
    );
  }
  if (q.isLoading || !data) return <Card loading />;

  const { kpi } = data;

  const clientColumns: ColumnsType<AgentClientRow> = [
    {
      title: t('Mijoz'),
      dataIndex: 'name',
      key: 'name',
      ellipsis: true,
      width: 240,
      render: (v: string, c) => (
        <Space>
          <Link to={`/clients/${c.id}`}>{v}</Link>
          {!c.active && <Tag>{t('Nofaol')}</Tag>}
        </Space>
      ),
    },
    {
      title: t('Telefon'),
      dataIndex: 'phone',
      key: 'phone',
      ellipsis: true,
      width: 150,
      render: (v: string | null) => v || '—',
    },
    {
      title: t('Balans'),
      dataIndex: 'balance',
      key: 'balance',
      align: 'right',
      width: 160,
      render: (v: MoneyStr) => <BalanceTag balance={v} partyType="client" />,
    },
  ];

  return (
    <div>
      <PageHeader
        title={data.name}
        accent
        breadcrumb={[{ label: 'Agentlar', to: '/agents' }]}
        status={data.active ? <Tag color="green">{t('Faol')}</Tag> : <Tag color="red">{t('Nofaol')}</Tag>}
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

        <TableCard title={t('Mijozlar va balanslar')}>
          <Table<AgentClientRow>
            rowKey="id"
            size="small"
            columns={clientColumns}
            dataSource={data.clients}
            loading={q.isFetching}
            scroll={{ x: 'max-content' }}
            pagination={{ pageSize: 20, showSizeChanger: true }}
          />
        </TableCard>
      </Space>
    </div>
  );
}
