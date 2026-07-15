// Buyurtmalar — to'liq RO'YXAT (jadval). Status doskasi alohida sahifada (/board).
// buissnes_crm kabi: doska va to'liq ro'yxat 2 alohida page.
import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Button } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { asItems, endpoints } from '../lib/api';
import { fmtDate } from '../lib/format';
import { PageHeader } from '../components/PageHeader';
import { useT } from '../components/LangContext';
import {
  DataTable,
  FilterBar,
  MoneyCell,
  StatusChip,
  TableCard,
  type FilterField,
  type SbColumn,
} from '../components';
import { useUrlFilters } from '../lib/useUrlFilters';
import { COST_STATUS, STATUS, TRANSPORT_PAID } from '../lib/status-maps';
import type { Order } from '../lib/types';

export default function Orders() {
  const navigate = useNavigate();
  const t = useT();
  const uf = useUrlFilters(['search', 'clientId', 'factoryId', 'dateFrom', 'dateTo']);

  const search = uf.get('search') || undefined;
  const clientId = uf.get('clientId') || undefined;
  const factoryId = uf.get('factoryId') || undefined;
  const dateFrom = uf.get('dateFrom') || undefined;
  const dateTo = uf.get('dateTo') || undefined;

  const filters = useMemo(
    () => ({
      ...(search ? { search } : {}),
      ...(clientId ? { clientId } : {}),
      ...(factoryId ? { factoryId } : {}),
      ...(dateFrom ? { dateFrom } : {}),
      ...(dateTo ? { dateTo } : {}),
    }),
    [search, clientId, factoryId, dateFrom, dateTo],
  );

  const clientsQ = useQuery({ queryKey: ['clients', 'select'], queryFn: () => endpoints.clients({ pageSize: 200 }) });
  const factoriesQ = useQuery({ queryKey: ['factories', 'select'], queryFn: () => endpoints.factories() });
  const clientOptions = (clientsQ.data?.items ?? []).map((c) => ({ label: c.name, value: c.id }));
  const factoryOptions = asItems(factoriesQ.data).map((f) => ({ label: f.name, value: f.id }));

  const filterSchema: FilterField[] = useMemo(
    () => [
      { key: 'clientId', label: 'Mijoz', type: 'select', options: clientOptions },
      { key: 'factoryId', label: 'Zavod', type: 'select', options: factoryOptions },
      { key: 'date', label: 'Sana', type: 'daterange', fromKey: 'dateFrom', toKey: 'dateTo' },
    ],
    [clientOptions, factoryOptions],
  );

  return (
    <div className="sb-page">
      <PageHeader
        title="Buyurtmalar"
        subtitle="Barcha buyurtmalar ro'yxati — filtr, qidiruv va holat"
        accent
        actions={[
          { key: 'new', label: 'Yangi buyurtma', primary: true, icon: <PlusOutlined />, onClick: () => navigate('/orders/new') },
        ]}
      />
      <div className="sb-table-card" style={{ padding: '12px 16px' }}>
        <FilterBar schema={filterSchema} searchPlaceholder={t('Buyurtma № yoki mijoz')} />
      </div>
      <TableView filters={filters} />
    </div>
  );
}

function TableView({ filters }: { filters: Record<string, string> }) {
  const navigate = useNavigate();
  const t = useT();
  const uf = useUrlFilters();
  const page = Number(uf.get('page')) || 1;
  const pageSize = Number(uf.get('pageSize')) || 20;
  const params = { page, pageSize, ...filters };

  const ordersQ = useQuery({
    queryKey: ['orders', 'list', params],
    queryFn: () => endpoints.orders(params),
    placeholderData: keepPreviousData,
  });

  const columns: SbColumn<Order>[] = [
    { title: 'Buyurtma', key: 'orderNo', width: 130, render: (_, r) => <Link to={`/orders/${r.id}`} className="sb-cell-link" onClick={(e) => e.stopPropagation()}>{r.orderNo}</Link> },
    { title: 'Sana', key: 'date', width: 110, render: (_, r) => fmtDate(r.date) },
    { title: 'Mijoz', key: 'client', ellipsis: true, render: (_, r) => r.client?.name ?? '—' },
    { title: 'Agent', key: 'agent', ellipsis: true, render: (_, r) => r.agent?.name ?? '—' },
    { title: 'Zavod', key: 'factory', ellipsis: true, render: (_, r) => r.factory?.name ?? '—' },
    { title: 'Moshina', key: 'vehicle', ellipsis: true, render: (_, r) => r.vehicle?.plate || r.vehicle?.name || '—' },
    { title: 'Savdo summasi', key: 'saleTotal', width: 160, align: 'right', className: 'num', render: (_, r) => <MoneyCell value={r.saleTotal} /> },
    { title: 'Tannarx', key: 'costStatus', width: 132, render: (_, r) => <StatusChip meta={COST_STATUS[r.costStatus]} /> },
    { title: 'Holat', key: 'status', width: 128, render: (_, r) => <StatusChip meta={STATUS[r.status]} /> },
    { title: 'Transport', key: 'transportPaidStatus', width: 132, render: (_, r) => <StatusChip meta={TRANSPORT_PAID[r.transportPaidStatus]} /> },
  ];

  return (
    <TableCard title={t("Buyurtmalar ro'yxati")} loading={ordersQ.isFetching}>
      <DataTable<Order>
        rowKey="id"
        columns={columns}
        query={ordersQ}
        onRowOpen={(r) => navigate(`/orders/${r.id}`)}
        emptyText="Buyurtma topilmadi"
        scroll={{ x: 'max-content' }}
      />
    </TableCard>
  );
}
