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
  Modal,
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
import {
  BalanceTag,
  DataTable,
  EmptyState,
  ErrorState,
  KpiBand,
  MoneyCell,
  OverdueChip,
  PageHeader,
  PalletChip,
  PartyStatement,
  PaymentComposer,
  PeekPanel,
  StatusChip,
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
  const q = useQuery({
    queryKey: ['orders', 'debt-open', clientId],
    queryFn: () => endpoints.orders({ clientId, pageSize: 50 }),
  });

  if (q.isLoading) return <Skeleton active paragraph={{ rows: 3 }} title={false} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} message="Buyurtmalarni yuklab bo'lmadi" />;

  const orders = (q.data?.items ?? []).filter((o) => o.status !== 'CANCELLED');
  if (orders.length === 0) {
    return <Caption>Ochiq buyurtma yo'q.</Caption>;
  }

  const now = dayjs();
  const columns: TableProps<Order>['columns'] = [
    {
      title: 'Buyurtma',
      key: 'orderNo',
      render: (_, o) => <Link to={`/orders/${o.id}`}>{o.orderNo}</Link>,
    },
    { title: 'Sana', key: 'date', render: (_, o) => fmtDate(o.date) },
    {
      title: 'Muddat',
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
      title: "Summa (so'm)",
      key: 'total',
      align: 'right',
      render: (_, o) => <MoneyCell value={num(o.saleTotal) + num(o.transportCharge)} />,
    },
    {
      title: 'Holat',
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
        <Caption>oxirgi 50 buyurtma</Caption>
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
  return (
    <PeekPanel
      open={open}
      onClose={onClose}
      width={560}
      title={clientName ?? 'Mijoz'}
      subtitle="Hisob-kitob"
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

  const q = useQuery({
    queryKey: ['debts', 'clients', { days, search, page, pageSize }],
    queryFn: () => endpoints.debtsClients({ days, search, page, pageSize }) as Promise<DebtsClientsResponse>,
    placeholderData: keepPreviousData,
  });

  const serverRows = q.data?.items ?? [];
  const rows = useMemo(() => {
    if (chip === 'avans') return serverRows.filter((r) => num(r.balance) < 0);
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
      title: 'Mijoz',
      key: 'name',
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
      title: "Qarz balansi (so'm)",
      key: 'balance',
      align: 'right',
      width: 190,
      render: (_, r) => {
        const n = num(r.balance);
        // advances render as a BalanceTag (never alarm-red); debt is a collections surface
        if (n < 0) return <BalanceTag balance={r.balance} partyType="client" />;
        return <MoneyCell value={r.balance} variant="owedToUs" strong suffix="so'm" />;
      },
    },
    {
      title: "Muddati o'tgan",
      key: 'overdue',
      width: 210,
      render: (_, r) => {
        if (r.hasOverdueOrders && r.overdueOrdersCount > 0) {
          return <OverdueChip count={r.overdueOrdersCount} sum={r.overdueOrdersTotal} compact />;
        }
        if (r.dueWithinWindow) {
          return (
            <span
              style={{
                display: 'inline-block',
                padding: '0 8px',
                borderRadius: 4,
                background: 'rgba(154,103,0,0.12)',
                color: '#9A6700',
                fontSize: 12,
                fontWeight: 500,
              }}
            >
              Muddati yaqin
            </span>
          );
        }
        return <Typography.Text type="secondary">—</Typography.Text>;
      },
    },
    {
      title: 'Paddon',
      key: 'pallet',
      align: 'right',
      width: 110,
      render: (_, r) =>
        r.palletBalance ? (
          <PalletChip pallets={r.palletBalance} compact />
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    {
      title: "To'lov sharti",
      key: 'term',
      align: 'right',
      width: 120,
      render: (_, r) =>
        r.paymentTermDays != null ? (
          `${r.paymentTermDays} kun`
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
              To'lov qabul qilish
            </Button>
          ) : null}
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                { key: 'peek', label: 'Hisob-kitob', onClick: () => openPeek(r.id) },
                { key: 'akt', label: 'Akt sverki', onClick: () => navigate(`/print/statement/client/${r.id}`) },
                { key: 'card', label: 'Mijoz kartasi', onClick: () => navigate(`/clients/${r.id}`) },
              ],
            }}
          >
            <Button size="small" icon={<MoreOutlined />} aria-label={`${r.name} amallari`} />
          </Dropdown>
        </Flex>
      ),
    },
  ];

  // ── toolbar: search + window + expected collections ───────────────────────
  const toolbar = (
    <Flex justify="space-between" align="center" wrap gap={12}>
      <Flex align="center" wrap gap={8}>
        <Input.Search
          allowClear
          placeholder="Mijoz qidirish"
          defaultValue={search}
          style={{ width: 240 }}
          onSearch={(v) => uf.set({ search: v || null })}
        />
        <Segmented
          value={String(days)}
          options={[
            { label: '7 kun', value: '7' },
            { label: '14 kun', value: '14' },
            { label: '30 kun', value: '30' },
          ]}
          onChange={(v) => uf.set({ days: String(v) })}
        />
      </Flex>
      <Flex align="baseline" gap={8}>
        <Caption>Kutilayotgan tushum ({days} kun):</Caption>
        <MoneyCell value={q.data?.expectedCollections ?? 0} strong suffix="so'm" style={{ fontSize: 16 }} />
      </Flex>
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
      <div style={{ position: 'relative' }}>
        {q.isFetching ? <div className="refetch-hairline" /> : null}
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
            showTotal: (t) => `Jami: ${t} ta`,
            onChange: (p, ps) => uf.set({ page: String(p), pageSize: String(ps) }),
          }}
        />
      </div>
    );
  }

  return (
    <Flex vertical gap={12}>
      {toolbar}
      {chip ? <Caption>{chipCaption}</Caption> : null}
      {body}

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
    if (chip === 'qarz') list = list.filter((f) => num(f.balance) < 0 && !isSettled(f.balance));
    if (chip === 'avans') list = list.filter((f) => num(f.balance) > 0 && !isSettled(f.balance));
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
          {!r.active ? <Caption>Nofaol</Caption> : null}
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
            To'lash
          </Button>
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                { key: 'card', label: 'Zavod kartasi', onClick: () => navigate(`/factories/${r.id}`) },
                { key: 'akt', label: 'Akt sverki', onClick: () => navigate(`/print/statement/factory/${r.id}`) },
              ],
            }}
          >
            <Button size="small" icon={<MoreOutlined />} aria-label={`${r.name} amallari`} />
          </Dropdown>
        </Flex>
      ),
    },
  ];

  return (
    <Flex vertical gap={12}>
      <Flex align="center" wrap gap={8}>
        <Input.Search
          allowClear
          placeholder="Zavod qidirish"
          defaultValue={uf.get('search')}
          style={{ width: 240 }}
          onSearch={(v) => uf.set({ search: v || null })}
        />
        <Segmented
          value={chip || 'all'}
          options={[
            { label: 'Hammasi', value: 'all' },
            { label: 'Qarzimiz', value: 'qarz' },
            { label: 'Avansimiz', value: 'avans' },
          ]}
          onChange={(v) => uf.set({ chip: v === 'all' ? null : String(v) })}
        />
      </Flex>
      {chip ? <Caption>{chipCaption}</Caption> : null}
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
        densityKey="/debts:zavodlar"
        scroll={{ x: 820 }}
      />

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
            Shofyorga to'lash
          </Button>
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                { key: 'card', label: 'Moshina kartasi', onClick: () => navigate(`/vehicles/${r.id}`) },
                {
                  key: 'direct',
                  label: "Mijoz to'lagan deb yozish",
                  onClick: () => setComposer({ open: true, kind: 'TRANSPORT_DIRECT', row: r }),
                },
              ],
            }}
          >
            <Button size="small" icon={<MoreOutlined />} aria-label={`${r.name} amallari`} />
          </Dropdown>
        </Flex>
      ),
    },
  ];

  return (
    <Flex vertical gap={12}>
      <Input.Search
        allowClear
        placeholder="Moshina / raqam / shofyor qidirish"
        defaultValue={uf.get('search')}
        style={{ width: 280 }}
        onSearch={(v) => uf.set({ search: v || null })}
      />
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
        densityKey="/debts:shofyorlar"
        scroll={{ x: 760 }}
      />

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

function PaddonlarBoard() {
  const navigate = useNavigate();
  const uf = useUrlFilters();
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
      message.success('Paddon qaytarilishi qabul qilindi');
      for (const key of ['pallets', 'clients', 'debts', 'dashboard']) qc.invalidateQueries({ queryKey: [key] });
      setRet({ open: false });
    },
    onError: (e) => message.error(apiError(e)),
  });

  const rows = useMemo(() => {
    const all = (q.data?.clients ?? []) as PalletClientRow[];
    const list = search ? all.filter((r) => r.client.name.toLowerCase().includes(search)) : all.slice();
    return list.sort((a, b) => b.balance - a.balance);
  }, [q.data, search]);

  const qty = Form.useWatch('qty', form);
  const currentBal = ret.row?.balance ?? 0;

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
              Paddon qaytarish
            </Button>
          ) : null}
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                { key: 'card', label: 'Mijoz kartasi', onClick: () => navigate(`/clients/${r.client.id}`) },
                { key: 'moves', label: 'Paddon harakati', onClick: () => navigate(`/pallets?clientId=${r.client.id}`) },
              ],
            }}
          >
            <Button size="small" icon={<MoreOutlined />} aria-label={`${r.client.name} amallari`} />
          </Dropdown>
        </Flex>
      ),
    },
  ];

  return (
    <Flex vertical gap={12}>
      <Caption>Paddon — pul emas, dona hisobidagi qarz.</Caption>
      <Input.Search
        allowClear
        placeholder="Mijoz qidirish"
        defaultValue={uf.get('search')}
        style={{ width: 240 }}
        onSearch={(v) => uf.set({ search: v || null })}
      />
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

      <Modal
        title={ret.row ? `Paddon qaytarish — ${ret.row.client.name}` : 'Paddon qaytarish'}
        open={ret.open}
        onCancel={() => setRet({ open: false })}
        onOk={() => form.submit()}
        okText="Saqlash"
        cancelText="Bekor qilish"
        confirmLoading={returnMut.isPending}
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
          <Form.Item name="qty" label="Soni (dona)" rules={[{ required: true, message: 'Sonini kiriting' }]}>
            <InputNumber min={1} precision={0} style={{ width: '100%' }} placeholder="0" />
          </Form.Item>
          <Form.Item name="date" label="Sana" rules={[{ required: true, message: 'Sanani tanlang' }]}>
            <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" allowClear={false} />
          </Form.Item>
          <Form.Item name="note" label="Izoh">
            <Input.TextArea rows={2} maxLength={500} placeholder="Izoh (ixtiyoriy)" />
          </Form.Item>
          <Flex
            align="center"
            justify="space-between"
            gap={8}
            style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(127,127,127,0.08)' }}
          >
            <Caption>Joriy → keyingi balans</Caption>
            <span>
              <PalletChip pallets={currentBal} compact />
              <span style={{ margin: '0 6px' }}>→</span>
              <PalletChip pallets={currentBal - (Number(qty) || 0)} compact />
            </span>
          </Flex>
        </Form>
      </Modal>
    </Flex>
  );
}

// ─────────────────────────── page shell ───────────────────────────

export default function Debts() {
  const { token } = theme.useToken();
  const uf = useUrlFilters();
  const { user } = useAuth();
  const role = user?.role ?? null;
  const isFin = can(role, 'debts.summary'); // A/B only
  const showFleetTabs = can(role, 'vehicles.detail'); // A/B (AGENT: mijozlar + paddonlar)

  const allTabs: { key: TabKey; label: string }[] = [
    { key: 'mijozlar', label: 'Mijozlar' },
    { key: 'zavodlar', label: 'Zavodlar' },
    { key: 'shofyorlar', label: 'Shofyorlar' },
    { key: 'paddonlar', label: 'Paddonlar' },
  ];
  const tabs = showFleetTabs
    ? allTabs
    : allTabs.filter((t) => t.key === 'mijozlar' || t.key === 'paddonlar');

  const rawTab = (uf.get('tab') || 'mijozlar') as TabKey;
  const activeTab: TabKey = tabs.some((t) => t.key === rawTab) ? rawTab : 'mijozlar';

  const changeTab = (key: string) =>
    uf.set({ tab: key, chip: null, search: null, peek: null, panel: null });

  return (
    <div>
      <PageHeader
        title="Qarzlar"
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
