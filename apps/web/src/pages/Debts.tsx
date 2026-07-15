// Qarzlar — the collections hub (money.md §7). All three debt sides + in-kind
// pallets in one place, worst-first, EVERY row carrying its own settle action.
//
//  • Summary band (A/B): KpiBand of 6 drillable StatCards from GET /debts/summary.
//  • Tabs ?tab=mijozlar|zavodlar|shofyorlar|paddonlar (AGENT: mijozlar + paddonlar).
//  • Mijozlar (hero b): GET /debts/clients worst-first — alarm-red debt MoneyCell,
//    inline OverdueChip, PalletChip, term column; row [To'lov qabul qilish] + kebab;
//    `→` expands open orders inline, `Space` peeks the client PartyStatement,
//    `T` opens the PaymentComposer pre-bound; window select feeds «Kutilayotgan
//    tushum» (server expectedCollections).
//  • Zavodlar / Shofyorlar / Paddonlar boards with per-row settle actions.
//
// All list state lives in the URL via useUrlFilters. Query keys are entity-name-
// first so the app-wide realtime invalidator (payment/order/pallet events) reaches
// every board for free; the composer invalidates the money families itself.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  App,
  Button,
  DatePicker,
  Dropdown,
  Flex,
  Form,
  Input,
  InputNumber,
  Segmented,
  Skeleton,
  Table,
  Typography,
  theme,
} from 'antd';
import type { TableProps } from 'antd';
import { MoreOutlined } from '@ant-design/icons';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { apiError, asItems, endpoints } from '../lib/api';
import { fmtDate, isSettled, num } from '../lib/format';
import { STATUS } from '../lib/status-maps';
import { can } from '../lib/permissions';
import { useAuth } from '../auth/AuthContext';
import { useUrlFilters } from '../lib/useUrlFilters';
import { useT } from '../components/LangContext';
import {
  BalanceTag,
  DataTable,
  EmptyState,
  ErrorState,
  FormDrawer,
  KpiBand,
  MoneyCell,
  OverdueChip,
  PageHeader,
  PalletChip,
  PartyStatement,
  PaymentComposer,
  PeekPanel,
  StatusChip,
  TableCard,
  type SbColumn,
  type StatCardProps,
} from '../components';
import type { Money, Order, PaymentKind, Vehicle } from '../lib/types';

// ─────────────────────────── server row shapes ───────────────────────────

interface DebtsSummaryData {
  clientsOweUs: Money;
  weOweClients: Money;
  factoryAdvance: Money;
  weOweFactories: Money;
  weOweVehicles: Money;
  palletsAtClients: number;
}

interface DebtClientRow {
  id: string;
  name: string;
  phone?: string | null;
  agent?: { id: string; name: string } | null;
  region?: { id: string; name: string } | null;
  paymentTermDays?: number | null;
  creditLimit?: Money | null;
  balance: Money;
  palletBalance: number;
  hasOverdueOrders: boolean;
  overdueOrdersCount: number;
  overdueOrdersTotal: Money;
  dueWithinWindow: boolean;
}

interface DebtsClientsResponse {
  items: DebtClientRow[];
  total: number;
  page: number;
  pageSize: number;
  days: number;
  expectedCollections: Money;
}

interface FactoryRow {
  id: string;
  name: string;
  active: boolean;
  balance: Money;
  bonusBalance: Money;
  palletsHeld: number;
}

interface PalletClientRow {
  client: { id: string; name: string };
  balance: number;
}

type TabKey = 'mijozlar' | 'zavodlar' | 'shofyorlar' | 'paddonlar';

// ─────────────────────────── shared bits ───────────────────────────

const Caption = ({ children }: { children: ReactNode }) => (
  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
    {children}
  </Typography.Text>
);

/** honesty line for the client-side chip filters (03 §6). */
const chipCaption = "Filtr sahifa ichida qo'llanadi — umumiy summa yuqoridagi kartada.";

/** skeleton board mirroring the real table (platform state law §9). */
function BoardSkeleton({ cols }: { cols: number }) {
  const data = Array.from({ length: 8 }, (_, i) => ({ __k: i }));
  const columns = Array.from({ length: cols }, (_, i) => ({
    title: '',
    key: i,
    render: () => <Skeleton.Button active size="small" block style={{ height: 12, minWidth: 40 }} />,
  }));
  return <Table rowKey="__k" size="small" columns={columns} dataSource={data} pagination={false} />;
}

// ─────────────────────────── §7.1 summary band (A/B) ───────────────────────────

function SummaryBand() {
  const q = useQuery({
    queryKey: ['debts', 'summary'],
    queryFn: () => endpoints.debtsSummary() as Promise<DebtsSummaryData>,
    placeholderData: keepPreviousData,
  });

  if (q.isError) {
    return <ErrorState error={q.error} onRetry={() => void q.refetch()} message="Umumiy qarzlarni yuklab bo'lmadi" />;
  }

  if (q.isLoading || !q.data) {
    return (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 16,
        }}
      >
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton.Button key={i} active block style={{ height: 96, borderRadius: 8 }} />
        ))}
      </div>
    );
  }

  const s = q.data;
  const cards: StatCardProps[] = [
    { label: 'Mijozlar bizga qarz', value: s.clientsOweUs, variant: 'owedToUs', suffix: "so'm", to: '/debts?tab=mijozlar' },
    { label: 'Mijozlar avansi (qarzimiz)', value: s.weOweClients, variant: 'weOwe', suffix: "so'm", to: '/debts?tab=mijozlar&chip=avans' },
    { label: 'Zavoddagi avansimiz', value: s.factoryAdvance, variant: 'in', suffix: "so'm", to: '/debts?tab=zavodlar&chip=avans' },
    { label: 'Zavodlarga qarzimiz', value: s.weOweFactories, variant: 'weOwe', suffix: "so'm", to: '/debts?tab=zavodlar&chip=qarz' },
    { label: 'Shofyorlarga qarzimiz', value: s.weOweVehicles, variant: 'weOwe', suffix: "so'm", to: '/debts?tab=shofyorlar' },
    { label: 'Mijozlardagi paddonlar', value: s.palletsAtClients, variant: 'neutral', suffix: 'dona', to: '/debts?tab=paddonlar' },
  ];

  return (
    <div style={{ position: 'relative' }}>
      {q.isFetching ? <div className="refetch-hairline" /> : null}
      <KpiBand label="QARZLAR" cards={cards} />
    </div>
  );
}

// ─────────────────────────── §7.2 Mijozlar board (hero b) ───────────────────────────

/** inline open-orders strip shown when a debt row is expanded (`→`). */
function OpenOrdersInline({ clientId }: { clientId: string }) {
  const t = useT();
  const q = useQuery({
    queryKey: ['orders', 'debt-open', clientId],
    queryFn: () => endpoints.orders({ clientId, pageSize: 50 }),
  });

  if (q.isLoading) return <Skeleton active paragraph={{ rows: 3 }} title={false} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} message="Buyurtmalarni yuklab bo'lmadi" />;

  const orders = (q.data?.items ?? []).filter((o) => o.status !== 'CANCELLED');
  if (orders.length === 0) {
    return <Caption>{t("Ochiq buyurtma yo'q.")}</Caption>;
  }

  const now = dayjs();
  const columns: TableProps<Order>['columns'] = [
    {
      title: t('Buyurtma'),
      key: 'orderNo',
      render: (_, o) => <Link to={`/orders/${o.id}`}>{o.orderNo}</Link>,
    },
    { title: t('Sana'), key: 'date', render: (_, o) => fmtDate(o.date) },
    {
      title: t('Muddat'),
      key: 'due',
      render: (_, o) => {
        if (!o.dueDate) return <Typography.Text type="secondary">—</Typography.Text>;
        const overdue = dayjs(o.dueDate).isBefore(now) && o.status !== 'COMPLETED';
        return (
          <Typography.Text type={overdue ? 'danger' : undefined} strong={overdue}>
            {fmtDate(o.dueDate)}
          </Typography.Text>
        );
      },
    },
    {
      title: t("Summa (so'm)"),
      key: 'total',
      align: 'right',
      render: (_, o) => <MoneyCell value={num(o.saleTotal) + num(o.transportCharge)} />,
    },
    {
      title: t('Holat'),
      key: 'status',
      align: 'right',
      render: (_, o) => <StatusChip meta={STATUS[o.status]} />,
    },
  ];

  return (
    <div>
      <Table<Order>
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={orders}
        pagination={false}
      />
      <div style={{ marginTop: 6 }}>
        <Caption>{t('oxirgi 50 buyurtma')}</Caption>
      </div>
    </div>
  );
}

/** the client statement PeekPanel (Space) — reuses the flagship PartyStatement. */
function ClientStatementPeek({
  clientId,
  clientName,
  open,
  onClose,
  rowIds,
  onNavigate,
}: {
  clientId: string;
  clientName?: string;
  open: boolean;
  onClose: () => void;
  rowIds: string[];
  onNavigate: (id: string) => void;
}) {
  const navigate = useNavigate();
  const t = useT();
  return (
    <PeekPanel
      open={open}
      onClose={onClose}
      width={560}
      title={clientName ?? t('Mijoz')}
      subtitle={t('Hisob-kitob')}
      onOpenFull={clientId ? () => navigate(`/clients/${clientId}`) : undefined}
      onPrint={clientId ? () => navigate(`/print/statement/client/${clientId}`) : undefined}
      rowIds={rowIds}
      activeId={clientId}
      onNavigate={onNavigate}
    >
      {clientId ? (
        <div style={{ padding: 16 }}>
          <PartyStatement partyType="client" partyId={clientId} />
        </div>
      ) : null}
    </PeekPanel>
  );
}

function MijozlarBoard() {
  const uf = useUrlFilters();
  const t = useT();
  const navigate = useNavigate();
  const { user } = useAuth();
  const role = user?.role ?? null;
  const canPay = can(role, 'payments.create');

  const days = Number(uf.get('days')) || 7;
  const search = uf.get('search') || undefined;
  const chip = uf.get('chip');
  const page = Number(uf.get('page')) || 1;
  const pageSize = Number(uf.get('pageSize')) || 20;
  const peekId = uf.get('peek') || '';

  // Debts board is for collecting debt → default lists only debtors (server-side, so
  // pagination + count stay correct). 'avans' is an explicit opt-in from the KPI chip.
  const dir = chip === 'avans' ? ('avans' as const) : undefined;
  const q = useQuery({
    queryKey: ['debts', 'clients', { days, search, page, pageSize, dir }],
    queryFn: () => endpoints.debtsClients({ days, search, page, pageSize, dir }) as Promise<DebtsClientsResponse>,
    placeholderData: keepPreviousData,
  });

  const serverRows = q.data?.items ?? [];
  const rows = useMemo(() => {
    // backend already returns the correct side; overdue is a client-side triage subset
    if (chip === 'overdue') return serverRows.filter((r) => r.hasOverdueOrders);
    return serverRows;
  }, [serverRows, chip]);

  // ── cursor + keyboard (hero loop §10) ─────────────────────────────────────
  const [cursor, setCursor] = useState(-1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pulseId, setPulseId] = useState<string | null>(null);
  const [composer, setComposer] = useState<{ open: boolean; client?: DebtClientRow }>({ open: false });

  const openComposer = (row: DebtClientRow) => setComposer({ open: true, client: row });
  const openPeek = (id: string) => uf.set({ peek: id });

  const kb = useRef({ rows, cursor, blocked: false });
  kb.current = { rows, cursor, blocked: !!peekId || composer.open };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      const editable = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t?.isContentEditable ?? false);
      if (editable || e.ctrlKey || e.metaKey || e.altKey) return;
      const s = kb.current;
      // while the peek or composer owns the keyboard, the board yields to it
      if (s.blocked) return;
      const n = s.rows.length;
      if (!n && e.key !== 'Escape') return;
      switch (e.key) {
        case 'ArrowDown':
        case 'j':
        case 'J':
          e.preventDefault();
          setCursor((c) => Math.min((c < 0 ? -1 : c) + 1, n - 1));
          break;
        case 'ArrowUp':
        case 'k':
        case 'K':
          e.preventDefault();
          setCursor((c) => Math.max((c < 0 ? 0 : c) - 1, 0));
          break;
        case 'Enter':
          if (s.cursor >= 0) {
            e.preventDefault();
            navigate(`/clients/${s.rows[s.cursor].id}`);
          }
          break;
        case ' ':
          if (s.cursor >= 0) {
            e.preventDefault();
            openPeek(s.rows[s.cursor].id);
          }
          break;
        case 't':
        case 'T':
          if (s.cursor >= 0 && canPay) {
            e.preventDefault();
            openComposer(s.rows[s.cursor]);
          }
          break;
        case 'ArrowRight':
          if (s.cursor >= 0) {
            e.preventDefault();
            setExpandedId(s.rows[s.cursor].id);
          }
          break;
        case 'ArrowLeft':
          e.preventDefault();
          setExpandedId(null);
          break;
        case 'Escape':
          setExpandedId(null);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canPay, navigate]);

  // keep the cursor on the peeked row so it stays put after the peek closes
  useEffect(() => {
    if (!peekId) return;
    const i = rows.findIndex((r) => r.id === peekId);
    if (i >= 0) setCursor(i);
  }, [peekId, rows]);

  const rowIds = rows.map((r) => r.id);
  const peekName = rows.find((r) => r.id === peekId)?.name;

  const anyFilter = !!search || !!chip;

  // ── columns ───────────────────────────────────────────────────────────────
  const columns: TableProps<DebtClientRow>['columns'] = [
    {
      title: t('Mijoz'),
      key: 'name',
      ellipsis: true,
      render: (_, r) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <Link to={`/clients/${r.id}`} style={{ fontWeight: 500 }}>
            {r.name}
          </Link>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {[r.agent?.name, r.region?.name].filter(Boolean).join(' · ') || '—'}
            {r.phone ? (
              <>
                {' · '}
                <a href={`tel:${r.phone}`}>{r.phone}</a>
              </>
            ) : null}
          </Typography.Text>
        </div>
      ),
    },
    {
      title: t("Qarz balansi (so'm)"),
      key: 'balance',
      align: 'right',
      width: 190,
      className: 'num',
      render: (_, r) => {
        const n = num(r.balance);
        // advances render as a BalanceTag (never alarm-red); debt is a collections surface
        if (n < 0) return <BalanceTag balance={r.balance} partyType="client" />;
        return <MoneyCell value={r.balance} variant="owedToUs" strong suffix="so'm" />;
      },
    },
    {
      title: t("Muddati o'tgan"),
      key: 'overdue',
      width: 210,
      render: (_, r) => {
        if (r.hasOverdueOrders && r.overdueOrdersCount > 0) {
          return <OverdueChip count={r.overdueOrdersCount} sum={r.overdueOrdersTotal} compact />;
        }
        if (r.dueWithinWindow) {
          return <span className="sb-chip-warn">{t('Muddati yaqin')}</span>;
        }
        return <Typography.Text type="secondary">—</Typography.Text>;
      },
    },
    {
      title: t('Paddon'),
      key: 'pallet',
      align: 'right',
      width: 110,
      className: 'num',
      render: (_, r) =>
        r.palletBalance ? (
          <PalletChip pallets={r.palletBalance} compact />
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    {
      title: t("To'lov sharti"),
      key: 'term',
      align: 'right',
      width: 120,
      className: 'num',
      render: (_, r) =>
        r.paymentTermDays != null ? (
          t('{n} kun', { n: r.paymentTermDays })
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    {
      title: '',
      key: 'actions',
      width: 210,
      render: (_, r) => (
        <Flex gap={6} justify="flex-end" align="center">
          {canPay ? (
            <Button size="small" type="primary" onClick={() => openComposer(r)}>
              {t("To'lov qabul qilish")}
            </Button>
          ) : null}
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                { key: 'peek', label: t('Hisob-kitob'), onClick: () => openPeek(r.id) },
                { key: 'akt', label: t('Akt sverki'), onClick: () => navigate(`/print/statement/client/${r.id}`) },
                { key: 'card', label: t('Mijoz kartasi'), onClick: () => navigate(`/clients/${r.id}`) },
              ],
            }}
          >
            <Button size="small" icon={<MoreOutlined />} aria-label={t('{name} amallari', { name: r.name })} />
          </Dropdown>
        </Flex>
      ),
    },
  ];

  // ── toolbar: search + window + expected collections ───────────────────────
  const toolbar = (
    <Flex vertical gap={8}>
    <Flex justify="space-between" align="center" wrap gap={12}>
      <Flex align="center" wrap gap={8}>
        <Input.Search
          allowClear
          placeholder={t('Mijoz qidirish')}
          defaultValue={search}
          style={{ width: 240 }}
          onSearch={(v) => uf.set({ search: v || null })}
        />
        <Flex align="center" gap={6}>
          <Caption>{t('Muddat sanasigacha:')}</Caption>
          <DatePicker
            allowClear={false}
            format="DD.MM.YYYY"
            placeholder={t('Sana')}
            value={dayjs().add(days - 1, 'day')}
            disabledDate={(d) => d.isBefore(dayjs(), 'day')}
            onChange={(d) => {
              if (d) uf.set({ days: String(Math.max(1, d.diff(dayjs(), 'day') + 1)) });
            }}
          />
        </Flex>
      </Flex>
      <Flex align="baseline" gap={8}>
        <Caption>{t('Kutilayotgan tushum ({days} kun):', { days })}</Caption>
        <MoneyCell value={q.data?.expectedCollections ?? 0} strong suffix="so'm" style={{ fontSize: 16 }} />
      </Flex>
    </Flex>
    {chip ? <Caption>{t(chipCaption)}</Caption> : null}
    </Flex>
  );

  // ── body states (platform law §9) ─────────────────────────────────────────
  let body: ReactNode;
  if (q.isLoading) {
    body = <BoardSkeleton cols={6} />;
  } else if (q.isError) {
    body = <ErrorState error={q.error} onRetry={() => void q.refetch()} message="Qarzlarni yuklab bo'lmadi" />;
  } else if (rows.length === 0) {
    body = anyFilter ? (
      <EmptyState message="Filtrga mos mijoz topilmadi" onClearFilters={() => uf.clear(['search', 'chip'])} />
    ) : (
      <EmptyState message="Qarzdor mijoz yo'q — hammasi hisob yopiq" />
    );
  } else {
    body = (
      <Table<DebtClientRow>
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={rows}
          scroll={{ x: 960 }}
          rowClassName={(r, i) => {
            const cls: string[] = [];
            if (i === cursor) cls.push('row-cursor');
            if (r.id === pulseId) cls.push('pulse-row');
            return cls.join(' ');
          }}
          onRow={(_, index) => ({
            onClick: (e) => {
              if ((e.target as HTMLElement).closest('a,button,.ant-dropdown-trigger,.ant-table-row-expand-icon')) return;
              setCursor(index ?? -1);
            },
          })}
          expandable={{
            expandedRowKeys: expandedId ? [expandedId] : [],
            onExpand: (expanded, record) => setExpandedId(expanded ? record.id : null),
            expandedRowRender: (record) => <OpenOrdersInline clientId={record.id} />,
            rowExpandable: () => true,
          }}
          pagination={{
            current: page,
            pageSize,
            total: q.data?.total ?? 0,
            showSizeChanger: true,
            showTotal: (total) => t('Jami: {n} ta', { n: total }),
            onChange: (p, ps) => uf.set({ page: String(p), pageSize: String(ps) }),
          }}
        />
    );
  }

  return (
    <Flex vertical gap={12}>
      <TableCard toolbar={toolbar} loading={q.isFetching}>
        {body}
      </TableCard>

      <ClientStatementPeek
        clientId={peekId}
        clientName={peekName}
        open={!!peekId}
        onClose={() => uf.set({ peek: null })}
        rowIds={rowIds}
        onNavigate={(id) => uf.set({ peek: id }, { replace: true })}
      />

      <PaymentComposer
        open={composer.open}
        onClose={() => setComposer({ open: false })}
        kind="CLIENT_IN"
        presetParty={
          composer.client
            ? {
                id: composer.client.id,
                name: composer.client.name,
                balance: composer.client.balance,
                palletBalance: composer.client.palletBalance,
                overdueTotal: composer.client.overdueOrdersTotal,
              }
            : undefined
        }
        presetAmount={composer.client && num(composer.client.balance) > 0 ? composer.client.balance : undefined}
        lockParty
        onSuccess={() => {
          // the row re-renders via socket invalidation; keep the cursor, pulse once
          if (composer.client) {
            const id = composer.client.id;
            setPulseId(id);
            window.setTimeout(() => setPulseId((cur) => (cur === id ? null : cur)), 1300);
          }
        }}
      />
    </Flex>
  );
}

// ─────────────────────────── §7.3 Zavodlar board (A/B) ───────────────────────────

function ZavodlarBoard() {
  const navigate = useNavigate();
  const uf = useUrlFilters();
  const t = useT();
  const search = (uf.get('search') || '').trim().toLowerCase();
  const chip = uf.get('chip');

  const q = useQuery({
    queryKey: ['factories', 'debts-board'],
    queryFn: () => endpoints.factories(),
  });

  const [composer, setComposer] = useState<{ open: boolean; row?: FactoryRow }>({ open: false });

  const rows = useMemo(() => {
    let list = (asItems(q.data) as unknown as FactoryRow[]).slice();
    if (search) list = list.filter((f) => f.name.toLowerCase().includes(search));
    // avans view is an explicit opt-in; DEFAULT (and «qarz») show only factories WE OWE.
    // Settled / prepaid factories are hidden — the debts board is for paying debt.
    if (chip === 'avans') list = list.filter((f) => num(f.balance) > 0 && !isSettled(f.balance));
    else list = list.filter((f) => num(f.balance) < 0 && !isSettled(f.balance));
    // worst-first: biggest liability (most negative) at the top
    return list.sort((a, b) => num(a.balance) - num(b.balance));
  }, [q.data, search, chip]);

  const columns: SbColumn<FactoryRow>[] = [
    {
      title: 'Zavod',
      key: 'name',
      render: (_, r) => (
        <Flex vertical gap={2}>
          <Link to={`/factories/${r.id}`} style={{ fontWeight: 500 }}>
            {r.name}
          </Link>
          {!r.active ? <Caption>{t('Nofaol')}</Caption> : null}
        </Flex>
      ),
    },
    {
      title: 'Balans',
      key: 'balance',
      align: 'right',
      width: 190,
      render: (_, r) => <BalanceTag balance={r.balance} partyType="factory" />,
    },
    {
      title: "Bonus hamyon (so'm)",
      key: 'bonus',
      align: 'right',
      width: 170,
      render: (_, r) =>
        num(r.bonusBalance) !== 0 ? (
          <MoneyCell value={r.bonusBalance} variant={num(r.bonusBalance) > 0 ? 'in' : 'neutral'} suffix="so'm" />
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    {
      title: 'Paddon',
      key: 'pallets',
      align: 'right',
      width: 110,
      render: (_, r) =>
        r.palletsHeld ? <PalletChip pallets={r.palletsHeld} compact /> : <Typography.Text type="secondary">—</Typography.Text>,
    },
    {
      title: '',
      key: 'actions',
      width: 160,
      render: (_, r) => (
        <Flex gap={6} justify="flex-end" align="center">
          <Button size="small" type="primary" onClick={() => setComposer({ open: true, row: r })}>
            {t("To'lash")}
          </Button>
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                { key: 'card', label: t('Zavod kartasi'), onClick: () => navigate(`/factories/${r.id}`) },
                { key: 'akt', label: t('Akt sverki'), onClick: () => navigate(`/print/statement/factory/${r.id}`) },
              ],
            }}
          >
            <Button size="small" icon={<MoreOutlined />} aria-label={t('{name} amallari', { name: r.name })} />
          </Dropdown>
        </Flex>
      ),
    },
  ];

  const boardToolbar = (
    <Flex vertical gap={8}>
      <Flex align="center" wrap gap={8}>
        <Input.Search
          allowClear
          placeholder={t('Zavod qidirish')}
          defaultValue={uf.get('search')}
          style={{ width: 240 }}
          onSearch={(v) => uf.set({ search: v || null })}
        />
        {/* Debts board: default «Qarzimiz» (we owe); «Avansimiz» is an explicit opt-in.
            No «Hammasi» — the page exists to pay debt, not to browse prepayments. */}
        <Segmented
          value={chip === 'avans' ? 'avans' : 'qarz'}
          options={[
            { label: t('Qarzimiz'), value: 'qarz' },
            { label: t('Avansimiz'), value: 'avans' },
          ]}
          onChange={(v) => uf.set({ chip: v === 'avans' ? 'avans' : null })}
        />
      </Flex>
      {chip ? <Caption>{t(chipCaption)}</Caption> : null}
    </Flex>
  );

  return (
    <Flex vertical gap={12}>
      <TableCard toolbar={boardToolbar}>
        <DataTable<FactoryRow>
          columns={columns}
          query={{
            data: rows,
            isLoading: q.isLoading,
            isFetching: q.isFetching,
            isError: q.isError,
            error: q.error,
            refetch: q.refetch,
          }}
          rowKey="id"
          onRowOpen={(r) => navigate(`/factories/${r.id}`)}
          filterKeys={['search', 'chip']}
          emptyText="Zavod topilmadi"
          scroll={{ x: 820 }}
        />
      </TableCard>

      <PaymentComposer
        open={composer.open}
        onClose={() => setComposer({ open: false })}
        kind="FACTORY_OUT"
        presetParty={composer.row ? { id: composer.row.id, type: 'factory', name: composer.row.name, balance: composer.row.balance } : undefined}
        presetAmount={composer.row && num(composer.row.balance) < 0 ? String(Math.abs(num(composer.row.balance))) : undefined}
        lockParty
      />
    </Flex>
  );
}

// ─────────────────────────── §7.4 Shofyorlar board (A/B) ───────────────────────────

function ShofyorlarBoard() {
  const navigate = useNavigate();
  const uf = useUrlFilters();
  const t = useT();
  const search = (uf.get('search') || '').trim().toLowerCase();

  const q = useQuery({
    queryKey: ['vehicles', 'debts-board'],
    queryFn: () => endpoints.vehicles(),
  });

  const [composer, setComposer] = useState<{ open: boolean; kind: PaymentKind; row?: Vehicle }>({
    open: false,
    kind: 'VEHICLE_OUT',
  });

  const rows = useMemo(() => {
    let list = (asItems(q.data) as Vehicle[]).slice();
    if (search) {
      list = list.filter((v) => [v.name, v.plate ?? '', v.driver ?? ''].some((f) => f.toLowerCase().includes(search)));
    }
    // only drivers WE OWE (debt board) — settled / prepaid vehicles are hidden
    list = list.filter((v) => num(v.balance) < 0 && !isSettled(v.balance ?? '0'));
    // owed-first: most negative balance (biggest debt to the driver) at the top
    return list.sort((a, b) => num(a.balance) - num(b.balance));
  }, [q.data, search]);

  const columns: SbColumn<Vehicle>[] = [
    {
      title: 'Moshina',
      key: 'name',
      render: (_, r) => (
        <Flex vertical gap={2}>
          <Link to={`/vehicles/${r.id}`} style={{ fontWeight: 500 }}>
            {r.name}
          </Link>
          <Caption>{[r.plate, r.driver].filter(Boolean).join(' · ') || '—'}</Caption>
        </Flex>
      ),
    },
    {
      title: 'Telefon',
      key: 'phone',
      width: 150,
      render: (_, r) => (r.phone ? <a href={`tel:${r.phone}`}>{r.phone}</a> : <Typography.Text type="secondary">—</Typography.Text>),
    },
    {
      title: 'Balans',
      key: 'balance',
      align: 'right',
      width: 190,
      render: (_, r) => <BalanceTag balance={r.balance ?? '0'} partyType="vehicle" />,
    },
    {
      title: '',
      key: 'actions',
      width: 230,
      render: (_, r) => (
        <Flex gap={6} justify="flex-end" align="center">
          <Button size="small" type="primary" onClick={() => setComposer({ open: true, kind: 'VEHICLE_OUT', row: r })}>
            {t("Shofyorga to'lash")}
          </Button>
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                { key: 'card', label: t('Moshina kartasi'), onClick: () => navigate(`/vehicles/${r.id}`) },
                {
                  key: 'direct',
                  label: t("Mijoz to'lagan deb yozish"),
                  onClick: () => setComposer({ open: true, kind: 'TRANSPORT_DIRECT', row: r }),
                },
              ],
            }}
          >
            <Button size="small" icon={<MoreOutlined />} aria-label={t('{name} amallari', { name: r.name })} />
          </Dropdown>
        </Flex>
      ),
    },
  ];

  return (
    <Flex vertical gap={12}>
      <TableCard
        toolbar={
          <Input.Search
            allowClear
            placeholder={t('Moshina / raqam / shofyor qidirish')}
            defaultValue={uf.get('search')}
            style={{ width: 280 }}
            onSearch={(v) => uf.set({ search: v || null })}
          />
        }
      >
        <DataTable<Vehicle>
          columns={columns}
          query={{
            data: rows,
            isLoading: q.isLoading,
            isFetching: q.isFetching,
            isError: q.isError,
            error: q.error,
            refetch: q.refetch,
          }}
          rowKey="id"
          onRowOpen={(r) => navigate(`/vehicles/${r.id}`)}
          filterKeys={['search']}
          emptyText="Moshina topilmadi"
          scroll={{ x: 760 }}
        />
      </TableCard>

      <PaymentComposer
        open={composer.open}
        onClose={() => setComposer((c) => ({ ...c, open: false }))}
        kind={composer.kind}
        presetParty={composer.row ? { id: composer.row.id, type: 'vehicle', name: composer.row.name, balance: composer.row.balance } : undefined}
        presetAmount={
          composer.kind === 'VEHICLE_OUT' && composer.row && num(composer.row.balance) < 0
            ? String(Math.abs(num(composer.row.balance)))
            : undefined
        }
        lockParty
      />
    </Flex>
  );
}

// ─────────────────────────── §7.5 Paddonlar board (A/B/G) ───────────────────────────

interface PalletReturnValues {
  qty: number;
  date: dayjs.Dayjs;
  note?: string;
}

interface PalletFactoryRow {
  factory: { id: string; name: string };
  balance: number;
}

interface FactoryReturnValues {
  qty: number;
  unitPrice: number;
  date: dayjs.Dayjs;
  note?: string;
}

const PALLET_UNIT_PRICE = 130000;
const palMoneyFmt = (v: string | number | undefined) => `${v ?? ''}`.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const palMoneyParse = (v: string | undefined) => Number((v ?? '').replace(/\s/g, ''));

function PaddonlarBoard() {
  const navigate = useNavigate();
  const uf = useUrlFilters();
  const t = useT();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const { user } = useAuth();
  const canMutate = can(user?.role ?? null, 'pallets.mutate');
  const search = (uf.get('search') || '').trim().toLowerCase();

  const q = useQuery({
    queryKey: ['pallets', 'balances'],
    queryFn: () => endpoints.palletBalances(),
  });

  const [ret, setRet] = useState<{ open: boolean; row?: PalletClientRow }>({ open: false });
  const [form] = Form.useForm<PalletReturnValues>();

  useEffect(() => {
    if (ret.open) {
      form.resetFields();
      form.setFieldsValue({ date: dayjs() });
    }
  }, [ret.open, form]);

  const returnMut = useMutation({
    mutationFn: (d: object) => endpoints.palletClientReturn(d),
    onSuccess: () => {
      message.success(t('Paddon qaytarilishi qabul qilindi'));
      for (const key of ['pallets', 'clients', 'debts', 'dashboard']) qc.invalidateQueries({ queryKey: [key] });
      setRet({ open: false });
    },
    onError: (e) => message.error(apiError(e)),
  });

  // ── factory-return drawer (capped at loose in-hand AND what we owe that factory) ──
  const [fret, setFret] = useState<{ open: boolean; row?: PalletFactoryRow }>({ open: false });
  const [fform] = Form.useForm<FactoryReturnValues>();
  useEffect(() => {
    if (fret.open) {
      fform.resetFields();
      fform.setFieldsValue({ date: dayjs(), unitPrice: PALLET_UNIT_PRICE });
    }
  }, [fret.open, fform]);
  const factoryReturnMut = useMutation({
    mutationFn: (d: object) => endpoints.palletFactoryReturn(d),
    onSuccess: () => {
      message.success(t('Paddon zavodga qaytarildi'));
      for (const key of ['pallets', 'factories', 'debts', 'dashboard']) qc.invalidateQueries({ queryKey: [key] });
      setFret({ open: false });
    },
    onError: (e) => message.error(apiError(e)),
  });

  // ── pallet totals (ADMIN/ACCOUNTANT see factory + loose-stock data; AGENT: own clients only) ──
  const isFin = can(user?.role ?? null, 'debts.summary');
  const view = uf.get('view') === 'zavodlar' && isFin ? 'zavodlar' : 'mijozlar';
  const factoriesAll = (q.data?.factories ?? []) as PalletFactoryRow[];
  const dealerInHand = q.data?.dealerInHand ?? 0;
  const fromClients = useMemo(
    () => ((q.data?.clients ?? []) as PalletClientRow[]).reduce((a, r) => a + Math.max(0, r.balance), 0),
    [q.data],
  );
  const toFactories = useMemo(() => factoriesAll.reduce((a, r) => a + Math.max(0, r.balance), 0), [factoriesAll]);

  const rows = useMemo(() => {
    const all = (q.data?.clients ?? []) as PalletClientRow[];
    // only clients who HOLD our pallets (owe a return); settled clients are hidden
    const owing = all.filter((r) => r.balance > 0);
    const list = search ? owing.filter((r) => r.client.name.toLowerCase().includes(search)) : owing.slice();
    return list.sort((a, b) => b.balance - a.balance);
  }, [q.data, search]);

  const factoryRows = useMemo(() => {
    // factories WE STILL OWE pallets to (positive balance); settled ones hidden
    const owing = factoriesAll.filter((r) => r.balance > 0);
    const list = search ? owing.filter((r) => r.factory.name.toLowerCase().includes(search)) : owing.slice();
    return list.sort((a, b) => b.balance - a.balance);
  }, [factoriesAll, search]);

  const qty = Form.useWatch('qty', form);
  const currentBal = ret.row?.balance ?? 0;

  // factory-return cap = min(loose in-hand, what we owe that factory) — «undan ortiq berib bo'lmaydi»
  const factoryOwed = fret.row?.balance ?? 0;
  const factoryCap = Math.max(0, Math.min(dealerInHand, factoryOwed));

  const summaryCards: StatCardProps[] = [
    ...(isFin
      ? [{ label: "Diller qo'lida", value: dealerInHand, variant: 'neutral' as const, suffix: 'dona', size: 'md' as const }]
      : []),
    { label: 'Mijozlardan olinadigan', value: fromClients, variant: 'neutral' as const, suffix: 'dona', size: 'md' as const },
    ...(isFin
      ? [{ label: 'Zavodlarga beriladigan', value: toFactories, variant: 'weOwe' as const, suffix: 'dona', size: 'md' as const }]
      : []),
  ];

  const factoryColumns: SbColumn<PalletFactoryRow>[] = [
    {
      title: 'Zavod',
      key: 'name',
      render: (_, r) => <Link to={`/factories/${r.factory.id}`}>{r.factory.name}</Link>,
    },
    {
      title: 'Paddon balansi',
      key: 'balance',
      align: 'right',
      width: 160,
      render: (_, r) => <PalletChip pallets={r.balance} />,
    },
    {
      title: '',
      key: 'actions',
      width: 220,
      render: (_, r) => (
        <Flex gap={6} justify="flex-end" align="center">
          {canMutate ? (
            <Button size="small" type="primary" onClick={() => setFret({ open: true, row: r })}>
              {t('Zavodga qaytarish')}
            </Button>
          ) : null}
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                { key: 'card', label: t('Zavod kartasi'), onClick: () => navigate(`/factories/${r.factory.id}`) },
                { key: 'moves', label: t('Paddon harakati'), onClick: () => navigate(`/pallets?factoryId=${r.factory.id}`) },
              ],
            }}
          >
            <Button size="small" icon={<MoreOutlined />} aria-label={t('{name} amallari', { name: r.factory.name })} />
          </Dropdown>
        </Flex>
      ),
    },
  ];

  const columns: SbColumn<PalletClientRow>[] = [
    {
      title: 'Mijoz',
      key: 'name',
      render: (_, r) => <Link to={`/clients/${r.client.id}`}>{r.client.name}</Link>,
    },
    {
      title: 'Paddon balansi',
      key: 'balance',
      align: 'right',
      width: 160,
      render: (_, r) => <PalletChip pallets={r.balance} />,
    },
    {
      title: '',
      key: 'actions',
      width: 220,
      render: (_, r) => (
        <Flex gap={6} justify="flex-end" align="center">
          {canMutate ? (
            <Button size="small" type="primary" onClick={() => setRet({ open: true, row: r })}>
              {t('Paddon qaytarish')}
            </Button>
          ) : null}
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                { key: 'card', label: t('Mijoz kartasi'), onClick: () => navigate(`/clients/${r.client.id}`) },
                { key: 'moves', label: t('Paddon harakati'), onClick: () => navigate(`/pallets?clientId=${r.client.id}`) },
              ],
            }}
          >
            <Button size="small" icon={<MoreOutlined />} aria-label={t('{name} amallari', { name: r.client.name })} />
          </Dropdown>
        </Flex>
      ),
    },
  ];

  const boardToolbar = (
    <Flex vertical gap={8}>
      <Caption>{t('Paddon — pul emas, dona hisobidagi qarz.')}</Caption>
      <Flex align="center" wrap gap={8}>
        {isFin ? (
          <Segmented
            value={view}
            options={[
              { label: t('Mijozlardan olinadigan'), value: 'mijozlar' },
              { label: t('Zavodlarga beriladigan'), value: 'zavodlar' },
            ]}
            onChange={(v) => uf.set({ view: v === 'zavodlar' ? 'zavodlar' : null, search: null })}
          />
        ) : null}
        <Input.Search
          key={view}
          allowClear
          placeholder={view === 'zavodlar' ? t('Zavod qidirish') : t('Mijoz qidirish')}
          defaultValue={uf.get('search')}
          style={{ width: 240 }}
          onSearch={(v) => uf.set({ search: v || null })}
        />
      </Flex>
    </Flex>
  );

  return (
    <Flex vertical gap={16}>
      <KpiBand label="PADDON HISOBI" cards={summaryCards} />
      <TableCard toolbar={boardToolbar}>
        {view === 'zavodlar' ? (
          <DataTable<PalletFactoryRow>
            columns={factoryColumns}
            query={{
              data: factoryRows,
              isLoading: q.isLoading,
              isFetching: q.isFetching,
              isError: q.isError,
              error: q.error,
              refetch: q.refetch,
            }}
            rowKey={(r) => r.factory.id}
            onRowOpen={(r) => navigate(`/factories/${r.factory.id}`)}
            filterKeys={['search']}
            emptyText="Zavodga qaytariladigan paddon yo'q"
            scroll={{ x: 620 }}
          />
        ) : (
          <DataTable<PalletClientRow>
            columns={columns}
            query={{
              data: rows,
              isLoading: q.isLoading,
              isFetching: q.isFetching,
              isError: q.isError,
              error: q.error,
              refetch: q.refetch,
            }}
            rowKey={(r) => r.client.id}
            onRowOpen={(r) => navigate(`/clients/${r.client.id}`)}
            filterKeys={['search']}
            emptyText="Mijozda paddon yo'q"
            scroll={{ x: 620 }}
          />
        )}
      </TableCard>

      <FormDrawer
        title={ret.row ? t('Paddon qaytarish — {name}', { name: ret.row.client.name }) : t('Paddon qaytarish')}
        open={ret.open}
        onClose={() => setRet({ open: false })}
        onSubmit={() => form.submit()}
        submitting={returnMut.isPending}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(v) =>
            returnMut.mutate({
              clientId: ret.row?.client.id,
              qty: v.qty,
              date: v.date.format('YYYY-MM-DD'),
              note: v.note?.trim() ? v.note.trim() : undefined,
            })
          }
        >
          <Form.Item name="qty" label={t('Soni (dona)')} rules={[{ required: true, message: t('Sonini kiriting') }]}>
            <InputNumber min={1} precision={0} style={{ width: '100%' }} placeholder="0" />
          </Form.Item>
          <Form.Item name="date" label={t('Sana')} rules={[{ required: true, message: t('Sanani tanlang') }]}>
            <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" allowClear={false} />
          </Form.Item>
          <Form.Item name="note" label={t('Izoh')}>
            <Input.TextArea rows={2} maxLength={500} placeholder={t('Izoh (ixtiyoriy)')} />
          </Form.Item>
          <Flex
            align="center"
            justify="space-between"
            gap={8}
            style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(127,127,127,0.08)' }}
          >
            <Caption>{t('Joriy → keyingi balans')}</Caption>
            <span>
              <PalletChip pallets={currentBal} compact />
              <span style={{ margin: '0 6px' }}>→</span>
              <PalletChip pallets={currentBal - (Number(qty) || 0)} compact />
            </span>
          </Flex>
        </Form>
      </FormDrawer>

      <FormDrawer
        title={
          fret.row
            ? t('Zavodga paddon qaytarish — {name}', { name: fret.row.factory.name })
            : t('Zavodga paddon qaytarish')
        }
        open={fret.open}
        onClose={() => setFret({ open: false })}
        onSubmit={() => fform.submit()}
        submitting={factoryReturnMut.isPending}
      >
        <Form
          form={fform}
          layout="vertical"
          onFinish={(v) =>
            factoryReturnMut.mutate({
              factoryId: fret.row?.factory.id,
              qty: v.qty,
              unitPrice: v.unitPrice,
              date: v.date.format('YYYY-MM-DD'),
              note: v.note?.trim() ? v.note.trim() : undefined,
            })
          }
        >
          <Form.Item
            name="qty"
            label={t('Soni (dona)')}
            extra={t("Maksimum: {cap} dona (qo'lda {hand}, zavod oldida {owed})", {
              cap: factoryCap,
              hand: dealerInHand,
              owed: factoryOwed,
            })}
            rules={[
              { required: true, message: t('Sonini kiriting') },
              () => ({
                validator: (_, value) =>
                  Number(value) > factoryCap
                    ? Promise.reject(new Error(t("Ko'pi bilan {cap} dona qaytarish mumkin", { cap: factoryCap })))
                    : Promise.resolve(),
              }),
            ]}
          >
            <InputNumber min={1} max={factoryCap} precision={0} style={{ width: '100%' }} placeholder="0" />
          </Form.Item>
          <Form.Item name="unitPrice" label={t("Dona narxi (so'm)")} rules={[{ required: true, message: t('Narxni kiriting') }]}>
            <InputNumber min={1} style={{ width: '100%' }} formatter={palMoneyFmt} parser={palMoneyParse} />
          </Form.Item>
          <Form.Item name="date" label={t('Sana')} rules={[{ required: true, message: t('Sanani tanlang') }]}>
            <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" allowClear={false} />
          </Form.Item>
          <Form.Item name="note" label={t('Izoh')}>
            <Input.TextArea rows={2} maxLength={500} placeholder={t('Izoh (ixtiyoriy)')} />
          </Form.Item>
        </Form>
      </FormDrawer>
    </Flex>
  );
}

// ─────────────────────────── page shell ───────────────────────────

export default function Debts() {
  const { token } = theme.useToken();
  const t = useT();
  const uf = useUrlFilters();
  const { user } = useAuth();
  const role = user?.role ?? null;
  const isFin = can(role, 'debts.summary'); // A/B only
  const showFleetTabs = can(role, 'vehicles.detail'); // A/B (AGENT: mijozlar + paddonlar)

  const allTabs: { key: TabKey; label: string }[] = [
    { key: 'mijozlar', label: t('Mijozlar') },
    { key: 'zavodlar', label: t('Zavodlar') },
    { key: 'shofyorlar', label: t('Shofyorlar') },
    { key: 'paddonlar', label: t('Paddonlar') },
  ];
  const tabs = showFleetTabs
    ? allTabs
    : allTabs.filter((t) => t.key === 'mijozlar' || t.key === 'paddonlar');

  const rawTab = (uf.get('tab') || 'mijozlar') as TabKey;
  const activeTab: TabKey = tabs.some((t) => t.key === rawTab) ? rawTab : 'mijozlar';

  const changeTab = (key: string) =>
    uf.set({ tab: key, chip: null, search: null, peek: null, panel: null, view: null });

  return (
    <div>
      <PageHeader
        title="Qarzlar"
        subtitle="Qarz va balanslar — mijoz, zavod va shofyor hisoblari"
        accent
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={changeTab}
      />

      <Flex vertical gap={16} style={{ background: token.colorBgLayout }}>
        {isFin ? <SummaryBand /> : null}

        {activeTab === 'mijozlar' ? <MijozlarBoard /> : null}
        {activeTab === 'zavodlar' && showFleetTabs ? <ZavodlarBoard /> : null}
        {activeTab === 'shofyorlar' && showFleetTabs ? <ShofyorlarBoard /> : null}
        {activeTab === 'paddonlar' ? <PaddonlarBoard /> : null}
      </Flex>
    </div>
  );
}
