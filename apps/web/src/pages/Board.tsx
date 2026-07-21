// Buyurtmalar DOSKASI — status ustunlari (kanban) + grand-total banner. Har status
// alohida karta (rangli chap urg'u); harakat tugmasi statusni keyingi bosqichga suradi.
// To'liq ro'yxat alohida sahifada (/orders). buissnes_crm: doska va ro'yxat 2 alohida page.
import { useMemo, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Flex, Table, Tag, theme, Tooltip, Typography } from 'antd';
import { PlusOutlined, ReloadOutlined, RightOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { apiError, asItems, endpoints } from '../lib/api';
import { fmtDate, fmtMoney, fmtM3 } from '../lib/format';
import { PageHeader } from '../components/PageHeader';
import { useT } from '../components/LangContext';
import { FilterBar, MoneyCell, StatusChip, type FilterField } from '../components';
import { useIsPhone } from '../lib/responsive';
import { useUrlFilters } from '../lib/useUrlFilters';
import { COST_STATUS, STATUS } from '../lib/status-maps';
import type { BoardLane, BoardOrderRow, OrderStatus } from '../lib/types';

// Lifecycle order (CANCELLED doskada ko'rsatilmaydi)
const FLOW: OrderStatus[] = ['NEW', 'CONFIRMED', 'LOADING', 'DELIVERING', 'DELIVERED', 'COMPLETED'];

const STATUS_VAR: Record<OrderStatus, string> = {
  NEW: 'var(--sb-status-new)',
  CONFIRMED: 'var(--sb-status-confirmed)',
  LOADING: 'var(--sb-status-loading)',
  DELIVERING: 'var(--sb-status-delivering)',
  DELIVERED: 'var(--sb-status-delivered)',
  COMPLETED: 'var(--sb-status-completed)',
  CANCELLED: 'var(--sb-status-cancelled)',
};

function nextStatus(s: OrderStatus): OrderStatus | null {
  const i = FLOW.indexOf(s);
  return i >= 0 && i < FLOW.length - 1 ? FLOW[i + 1] : null;
}

export default function Board() {
  const navigate = useNavigate();
  const t = useT();
  const isPhone = useIsPhone();
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
        title="Buyurtmalar doskasi"
        subtitle="Buyurtmalar oqimi — status bo'yicha doska (kanban)"
        accent
        actions={[
          { key: 'new', label: 'Yangi buyurtma', primary: true, icon: <PlusOutlined />, onClick: () => navigate('/orders/new') },
        ]}
      />
      <div className="sb-table-card" style={{ padding: isPhone ? '10px 12px' : '12px 16px' }}>
        <FilterBar schema={filterSchema} searchPlaceholder={t('Buyurtma № yoki mijoz')} />
      </div>
      <BoardView filters={filters} />
    </div>
  );
}

function BoardView({ filters }: { filters: Record<string, string> }) {
  const t = useT();
  const isPhone = useIsPhone();
  const boardQ = useQuery({
    queryKey: ['orders', 'board', filters],
    queryFn: () => endpoints.ordersBoard(filters),
    placeholderData: keepPreviousData,
  });

  if (boardQ.isError) {
    return (
      <Flex vertical align="center" gap={12} style={{ padding: 48 }}>
        <Typography.Text type="danger">{apiError(boardQ.error)}</Typography.Text>
        <Button icon={<ReloadOutlined />} onClick={() => boardQ.refetch()}>{t('Qayta urinish')}</Button>
      </Flex>
    );
  }

  const g = boardQ.data?.grand;
  const groups = boardQ.data?.groups ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Grand total banner — a clean strip of KPI tiles */}
      <div className="sb-panel" style={{ position: 'relative' }}>
        {boardQ.isFetching ? <div className="refetch-hairline" style={{ position: 'absolute', top: 0, left: 0, right: 0 }} /> : null}
        {/* telefonda 4 ta ustma-ust blok o'rniga 2 tadan grid; savdo summasi
            (nowrap, 9 xonali) butun qatorni egallaydi — kesilgan summa yolg'on summa */}
        <div
          style={
            isPhone
              ? { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, padding: 12 }
              : { display: 'flex', flexWrap: 'wrap', gap: 0, padding: '16px 4px' }
          }
        >
          <GrandStat label="Jami buyurtma" value={`${g?.count ?? 0} ${t('ta')}`} />
          <GrandStat label="Umumiy hajm" value={fmtM3(g?.totalM3 ?? 0)} />
          <GrandStat label="Paddonlar" value={`${g?.totalPallets ?? 0} ${t('ta')}`} />
          <GrandStat
            label="Savdo summasi"
            strong
            wide
            value={
              <MoneyCell
                value={g?.saleTotal ?? 0}
                variant="in"
                strong
                suffix={t("so'm")}
                style={{ fontSize: isPhone ? 'clamp(17px, 6vw, 22px)' : 22 }}
              />
            }
          />
        </div>
      </div>

      {groups.map((lane) => (
        <Lane key={lane.status} lane={lane} loading={boardQ.isFetching} />
      ))}
    </div>
  );
}

function GrandStat({ label, value, strong, wide }: { label: string; value: ReactNode; strong?: boolean; wide?: boolean }) {
  const { token } = theme.useToken();
  const t = useT();
  const isPhone = useIsPhone();
  return (
    <div
      style={
        isPhone
          ? {
              minWidth: 0,
              // «wide» plitka grid ustunlarining hammasini egallaydi
              gridColumn: wide ? '1 / -1' : undefined,
              padding: 0,
            }
          : {
              minWidth: 150,
              flex: '1 1 150px',
              padding: '2px 20px',
              borderInlineStart: `1px solid ${token.colorBorderSecondary}`,
            }
      }
    >
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, color: token.colorTextTertiary }}>{t(label)}</div>
      <div
        className="num"
        style={{
          fontSize: isPhone ? (strong ? 20 : 17) : strong ? 22 : 20,
          fontWeight: strong ? 700 : 600,
          marginTop: 4,
          color: token.colorText,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function Lane({ lane, loading }: { lane: BoardLane; loading: boolean }) {
  const color = STATUS_VAR[lane.status];
  const { message } = App.useApp();
  const t = useT();
  const isPhone = useIsPhone();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const advance = useMutation({
    mutationFn: (row: BoardOrderRow) => {
      const to = nextStatus(row.status);
      if (!to) return Promise.reject(new Error(t('Oxirgi bosqich')));
      return endpoints.setOrderStatus(row.id, to);
    },
    onSuccess: () => {
      message.success(t('Holat yangilandi'));
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e) => message.error(apiError(e)),
  });

  const columns: ColumnsType<BoardOrderRow> = [
    { title: t('Buyurtma'), key: 'orderNo', width: 130, render: (_, r) => <Link to={`/orders/${r.id}`} className="sb-cell-link">{r.orderNo}</Link> },
    { title: t('Sana'), key: 'date', width: 104, render: (_, r) => fmtDate(r.date) },
    { title: t('Mijoz'), key: 'client', ellipsis: true, render: (_, r) => r.client?.name ?? '—' },
    { title: t('Agent'), key: 'agent', ellipsis: true, responsive: ['lg'], render: (_, r) => r.agent?.name ?? '—' },
    { title: t('Zavod'), key: 'factory', ellipsis: true, responsive: ['xl'], render: (_, r) => r.factory?.name ?? '—' },
    { title: t('Moshina'), key: 'vehicle', ellipsis: true, responsive: ['xl'], render: (_, r) => r.vehicle?.plate || r.vehicle?.name || '—' },
    { title: t('Hajm'), key: 'm3', width: 96, align: 'right', className: 'num', render: (_, r) => fmtM3(r.totalM3) },
    { title: t('Paddon'), key: 'pallets', width: 84, align: 'right', className: 'num', responsive: ['md'], render: (_, r) => `${r.totalPallets}` },
    { title: t('Summa'), key: 'saleTotal', width: 150, align: 'right', className: 'num', render: (_, r) => <MoneyCell value={r.saleTotal} /> },
    { title: t('Tannarx'), key: 'costStatus', width: 132, responsive: ['lg'], render: (_, r) => <StatusChip meta={COST_STATUS[r.costStatus]} /> },
    {
      title: '',
      key: 'action',
      width: 150,
      align: 'right',
      render: (_, r) => {
        const to = nextStatus(r.status);
        if (!to) return null;
        return (
          <Tooltip title={t('Keyingi: {label}', { label: STATUS[to].label })}>
            <Button
              size="small"
              type="text"
              icon={<RightOutlined />}
              iconPosition="end"
              loading={advance.isPending && advance.variables?.id === r.id}
              onClick={() => advance.mutate(r)}
              style={{ color: color }}
            >
              {STATUS[to].label}
            </Button>
          </Tooltip>
        );
      },
    },
  ];

  return (
    <div className="sb-table-card" style={{ borderLeft: `3px solid ${color}` }}>
      <div className="sb-table-card__head" style={{ borderBottom: lane.count > 0 ? undefined : 'none' }}>
        <Flex align="center" gap={10}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: color, display: 'inline-block' }} />
          <Typography.Text strong style={{ fontSize: 15 }}>{STATUS[lane.status].label}</Typography.Text>
          <Tag bordered={false} style={{ background: 'var(--sb-brand-soft)', color: 'var(--sb-brand)', margin: 0 }}>{lane.count} {t('ta')}</Tag>
        </Flex>
        <Flex
          gap={isPhone ? 12 : 18}
          className="num"
          style={{
            color: 'var(--sb-fg-muted)',
            fontSize: isPhone ? 12 : 13,
            flexWrap: 'wrap',
            minWidth: 0,
            width: isPhone ? '100%' : undefined,
            justifyContent: isPhone ? 'flex-start' : 'flex-end',
          }}
        >
          <span>{fmtM3(lane.totalM3)}</span>
          <span>{lane.totalPallets} {t('paddon')}</span>
          <span style={{ color: 'var(--sb-fg)', fontWeight: 600 }}>{fmtMoney(lane.saleTotal)} {t("so'm")}</span>
        </Flex>
      </div>
      {lane.count > 0 && (isPhone ? (
        // Telefon: 11 ustunli jadval o'rniga teginishga mo'ljallangan karta ro'yxati
        // (spec §2.2 — «Board lanes»). Kartaga tegish buyurtmani ochadi, keyingi
        // bosqichga surish tugmasi kartaning to'liq kenglikdagi futerida.
        <div style={{ position: 'relative' }}>
          {loading ? <div className="refetch-hairline" /> : null}
          <ul className="sb-mcards">
            {lane.rows.map((r) => {
              const to = nextStatus(r.status);
              const open = () => navigate(`/orders/${r.id}`);
              return (
                <li
                  key={r.id}
                  className="sb-mcard sb-mcard--tappable"
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest('a,button')) return;
                    open();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
                  }}
                >
                  <div className="sb-mcard__body">
                    <div className="sb-mcard__row">
                      <div className="sb-mcard__head">
                        <div className="sb-mcard__title">
                          <Link to={`/orders/${r.id}`} className="sb-cell-link">{r.orderNo}</Link>
                        </div>
                        <div className="sb-mcard__subtitle">
                          <span>{r.client?.name ?? '—'}</span>
                          {r.agent?.name ? <span>{r.agent.name}</span> : null}
                        </div>
                      </div>
                      <div className="sb-mcard__value"><MoneyCell value={r.saleTotal} /></div>
                    </div>
                    <div className="sb-mcard__meta">
                      <span className="sb-mcard__chip">{fmtDate(r.date)}</span>
                      <span className="sb-mcard__chip">
                        <em className="sb-mcard__chip-label">{t('Hajm')}</em>{fmtM3(r.totalM3)}
                      </span>
                      <span className="sb-mcard__chip">
                        <em className="sb-mcard__chip-label">{t('Paddon')}</em>{r.totalPallets}
                      </span>
                      <StatusChip meta={COST_STATUS[r.costStatus]} />
                    </div>
                    {to ? (
                      <div className="sb-mcard__actions">
                        <Button
                          size="small"
                          icon={<RightOutlined />}
                          iconPosition="end"
                          loading={advance.isPending && advance.variables?.id === r.id}
                          onClick={(e) => { e.stopPropagation(); advance.mutate(r); }}
                          style={{ color }}
                        >
                          {t('Keyingi: {label}', { label: STATUS[to].label })}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                  <div className="sb-mcard__tail">
                    <RightOutlined className="sb-mcard__chevron" aria-hidden />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <Table<BoardOrderRow>
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={lane.rows}
          loading={loading}
          pagination={false}
          scroll={{ x: 'max-content' }}
        />
      ))}
    </div>
  );
}
