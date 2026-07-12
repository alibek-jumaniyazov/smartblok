// `/` Dashboard — three role cockpits (screens/dashboard.md). Dispatched from the
// JWT role: ADMIN/ACCOUNTANT → «Ish stoli» (§1), AGENT → agent cockpit (§2),
// CASHIER → «Kassa terminali» (§3). Every number is a door; nothing animates
// (02 §5). The fake green «● LIVE» Tag is dead — socket state lives in the TopBar
// LiveBadge. The «Kutilayotgan tushum» card is dead (byte-duplicate of «Mijozlar
// qarzi»). ordersInFlight + weOweVehicles are surfaced for the first time.
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App,
  Button,
  DatePicker,
  Dropdown,
  Input,
  Modal,
  Segmented,
  Select,
  Skeleton,
  Space,
  Table,
  Tooltip,
  theme,
} from 'antd';
import type { MenuProps, TableColumnsType } from 'antd';
import { LeftOutlined, MoreOutlined, PlusOutlined, PrinterOutlined, RightOutlined } from '@ant-design/icons';
import { DualAxes, Line } from '@ant-design/plots';
import dayjs, { type Dayjs } from 'dayjs';
import { apiError, endpoints } from '../lib/api';
import { fmtDate, fmtM3, fmtMoney, fmtNum, fmtShort, fmtUZS, num } from '../lib/format';
import { CASHBOX_TYPE, PAYMENT_KIND } from '../lib/status-maps';
import { useUrlFilters } from '../lib/useUrlFilters';
import { useOwnerWorklists } from '../lib/worklists';
import { useAuth } from '../auth/AuthContext';
import { useThemeMode } from '../components/ThemeContext';
import {
  CashboxSelect,
  CreditGauge,
  EmptyState,
  ErrorState,
  KbdHint,
  MoneyCell,
  MoneyInput,
  PageHeader,
  PalletChip,
  PaymentComposer,
  PaymentPeek,
  StatCard,
  StatusChip,
  type StatCardDelta,
} from '../components';
import type { CashTransaction, Money, Paged, PaymentKind } from '../lib/types';

// ── backend response shapes (dashboard.service.ts, agents.service.ts) ────────

interface PeriodBlock {
  from: string;
  to: string;
  sales: Money;
  cost: Money;
  goodsProfit: Money;
  transportProfit: Money;
  netProfit: Money;
  collected: Money;
  orders: number;
  cubeSold: string;
}

interface SummaryResp {
  scope: 'agent' | 'global';
  period: PeriodBlock;
  todaySales: Money;
  monthSales: Money;
  yearSales: Money;
  ordersInFlight: number;
  clientsOweUs: Money;
  weOweFactories: Money;
  weOweVehicles: Money;
  collectedThisMonth: Money;
  goodsProfitMonth: Money;
  transportProfitMonth: Money;
  bonusWallets: Money;
  palletsAtClients: number;
  cubeSoldMonth: string;
  expectedCollections: Money;
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
  sales: Money;
  goodsProfit: Money;
  collected: Money;
  outstandingDebt: Money;
  orders: number;
}

interface RankingResp {
  month: string;
  agents: RankRow[];
}

interface KassaBox {
  cashboxId: string;
  name: string;
  type: 'CASH' | 'BANK' | 'CLICK' | 'TERMINAL' | 'CARD';
  currency: 'UZS' | 'USD';
  balance: Money;
  todayIn: Money;
  todayOut: Money;
}

interface AgentMe {
  id: string;
  name: string;
  active: boolean;
  clientCount?: number;
  outstandingDebt?: Money;
  debtLimit?: Money | null;
  ownDebtLimit?: Money | null;
}

/** GET /kassa/transactions row — embeds its source document (Kassa.tsx shape). */
interface KassaTxRow extends CashTransaction {
  payment?: {
    id: string;
    kind: PaymentKind;
    amount: Money;
    voidedAt?: string | null;
    client?: { id: string; name: string } | null;
    factory?: { id: string; name: string } | null;
    vehicle?: { id: string; name: string } | null;
  } | null;
  expense?: { id: string; note?: string | null; voidedAt?: string | null; category?: { id: string; name: string } | null } | null;
  bonusTransaction?: { id: string; factory?: { id: string; name: string } | null } | null;
  reversalOf?: { id: string } | null;
  reversedBy?: { id: string } | null;
  createdBy?: { id: string; name: string } | null;
}

type Tok = ReturnType<typeof theme.useToken>['token'];

// ── chart series (02 §2.6) — CVD-safe inks per theme surface ─────────────────
const SERIES = { sales: 'Savdo', collected: 'Tushum' } as const;
const CHART: Record<'light' | 'dark', { sales: string; collected: string; bar: string }> = {
  light: { sales: '#1F6F9E', collected: '#B47A00', bar: '#94A3B8' },
  dark: { sales: '#5CA3CF', collected: '#D9A94A', bar: '#94A3B8' },
};

// ── Tashkent-day windows (client mirror of server calendar, 02 §7) ───────────
const todayStr = () => dayjs().format('YYYY-MM-DD');
const monthStartStr = () => dayjs().startOf('month').format('YYYY-MM-DD');
const yearStartStr = () => dayjs().startOf('year').format('YYYY-MM-DD');

/** «$4 120.00» — space-grouped, dot decimal (02 §7); UZS/USD never merged. */
const fmtUsd = (v: string | number | null | undefined): string =>
  '$' +
  new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .format(num(v))
    .replace(/,/g, ' ');

/** % change; undefined when the base is 0 (deltas are decoration — never block). */
function pctDelta(cur: number, prev: number): number | undefined {
  if (!Number.isFinite(cur) || !Number.isFinite(prev) || prev === 0) return undefined;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

interface Derived62 {
  todaySalesDelta?: number;
  monthSalesDelta?: number;
  collectedDelta?: number;
  sparkSales: number[];
  sparkCollected: number[];
}

/**
 * Deltas + sparklines from the fixed 62-day trends (no estimation, server buckets):
 * today vs yesterday, month-to-date vs the previous month's first same-N days.
 */
function derive62(rows: TrendRow[] | undefined): Derived62 | null {
  if (!rows || rows.length < 2) return null;
  const sales = rows.map((r) => num(r.sales));
  const collected = rows.map((r) => num(r.collected));
  const last = rows.length - 1;
  const today = dayjs(rows[last].date);
  const dom = today.date();
  const curKey = today.format('YYYY-MM');
  const prevKey = today.subtract(1, 'month').format('YYYY-MM');
  let mtdS = 0, mtdC = 0, pmS = 0, pmC = 0;
  for (const r of rows) {
    const d = dayjs(r.date);
    const mk = d.format('YYYY-MM');
    if (mk === curKey) {
      mtdS += num(r.sales);
      mtdC += num(r.collected);
    } else if (mk === prevKey && d.date() <= dom) {
      pmS += num(r.sales);
      pmC += num(r.collected);
    }
  }
  return {
    todaySalesDelta: pctDelta(sales[last], sales[last - 1]),
    monthSalesDelta: pctDelta(mtdS, pmS),
    collectedDelta: pctDelta(mtdC, pmC),
    sparkSales: sales,
    sparkCollected: collected,
  };
}

// ── shared style helpers (mirror StatCard/KpiBand tokens) ────────────────────
// tighter min → more columns pack per row → no over-wide cards / dead space.
const heroGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(212px, 1fr))',
  gap: 14,
};
const compactRow: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 28, rowGap: 14, alignItems: 'flex-start' };

const cardShell = (token: Tok): CSSProperties => ({
  padding: 16,
  borderRadius: token.borderRadiusLG,
  border: `1px solid ${token.colorBorderSecondary}`,
  background: token.colorBgContainer,
});
const overline = (token: Tok, color: string): CSSProperties => ({
  fontSize: 11,
  lineHeight: '16px',
  fontWeight: 600,
  letterSpacing: '0.06em',
  color,
});
const linkStyle = (token: Tok): CSSProperties => ({
  fontSize: 13,
  fontWeight: 500,
  color: token.colorLink,
  textDecoration: 'none',
});

// ── small presentational pieces ──────────────────────────────────────────────

function Band({ label, children }: { label: string; children: ReactNode }) {
  const { token } = theme.useToken();
  return (
    <section aria-label={label} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <span style={overline(token, token.colorTextTertiary)}>{label}</span>
      {children}
    </section>
  );
}

/** compact KPI (label + arbitrary value node) — money still flows via MoneyCell. */
function CompactStat({ label, to, children }: { label: string; to?: string; children: ReactNode }) {
  const { token } = theme.useToken();
  const [hover, setHover] = useState(false);
  const inner = (
    <div
      onMouseEnter={to ? () => setHover(true) : undefined}
      onMouseLeave={to ? () => setHover(false) : undefined}
      style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 132 }}
    >
      <span
        style={{
          ...overline(token, to && hover ? token.colorPrimary : token.colorTextSecondary),
          transition: 'color 0.12s cubic-bezier(0.2, 0, 0, 1)',
        }}
      >
        {label}
      </span>
      {children}
    </div>
  );
  return to ? (
    <Link to={to} style={{ color: 'inherit', textDecoration: 'none' }}>
      {inner}
    </Link>
  ) : (
    inner
  );
}

/** definition tooltip wrapper — desk roles only (mobile has no hover). */
function CardTip({ title, children }: { title?: ReactNode; children: ReactNode }) {
  if (!title) return <>{children}</>;
  return (
    <Tooltip title={title}>
      <div style={{ display: 'block', height: '100%' }}>{children}</div>
    </Tooltip>
  );
}

function SkeletonStat() {
  const { token } = theme.useToken();
  return (
    <div style={{ ...cardShell(token), minHeight: 96, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Skeleton.Button active size="small" style={{ height: 12, width: 90 }} />
      <Skeleton.Button active size="small" style={{ height: 22, width: 150 }} />
    </div>
  );
}

function KpiSkeleton() {
  return (
    <div style={heroGrid}>
      {Array.from({ length: 8 }).map((_, i) => (
        <SkeletonStat key={i} />
      ))}
    </div>
  );
}

// ── kassa (strip + cards) shared pieces ──────────────────────────────────────

function CcyAmount({
  value,
  currency,
  size = 20,
  strong = true,
  suffix,
}: {
  value: Money | number;
  currency: 'UZS' | 'USD';
  size?: number;
  strong?: boolean;
  suffix?: string;
}) {
  const { token } = theme.useToken();
  const neg = num(value) < 0;
  if (currency === 'USD') {
    return (
      <span
        className="num"
        style={{ fontSize: size, fontWeight: strong ? 600 : 500, color: neg ? token.colorError : token.colorText, whiteSpace: 'nowrap' }}
      >
        {fmtUsd(value)}
        {neg ? <span style={{ fontSize: 11, marginLeft: 6 }}>kamomad</span> : null}
      </span>
    );
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
      <MoneyCell value={value} variant={neg ? 'owedToUs' : 'neutral'} strong={strong} suffix={suffix} style={{ fontSize: size }} />
      {neg ? <span style={{ fontSize: 11, color: token.colorError }}>kamomad</span> : null}
    </span>
  );
}

function FlowLine({ box }: { box: KassaBox }) {
  const { token } = theme.useToken();
  const usd = box.currency === 'USD';
  const kirim = usd ? fmtUsd(box.todayIn) : fmtMoney(box.todayIn);
  const chiqim = usd ? fmtUsd(box.todayOut) : fmtMoney(box.todayOut);
  return (
    <span style={{ fontSize: 11, color: token.colorTextTertiary, whiteSpace: 'nowrap' }}>
      ↑ kirim <span className="num" style={{ color: 'var(--sb-money-in)' }}>{kirim}</span>
      {' · chiqim '}
      <span className="num" style={{ color: token.colorText }}>{chiqim}</span>
    </span>
  );
}

function totalsLine(boxes: KassaBox[], token: Tok): ReactNode {
  const parts: ReactNode[] = [];
  if (boxes.some((b) => b.currency === 'UZS')) {
    const uzs = boxes.filter((b) => b.currency === 'UZS').reduce((a, b) => a + num(b.balance), 0);
    parts.push(
      <span key="uzs">
        UZS jami: <b className="num">{fmtMoney(uzs)}</b> so'm
      </span>,
    );
  }
  if (boxes.some((b) => b.currency === 'USD')) {
    const usd = boxes.filter((b) => b.currency === 'USD').reduce((a, b) => a + num(b.balance), 0);
    parts.push(
      <span key="usd">
        USD jami: <b className="num">{fmtUsd(usd)}</b>
      </span>,
    );
  }
  return (
    <span style={{ color: token.colorText }}>
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 ? ' · ' : null}
          {p}
        </span>
      ))}
    </span>
  );
}

// ════════════════════════════ ADMIN / ACCOUNTANT ════════════════════════════

/** Top period control (03 §1): 2 sana + «Qo'llash» — faqat sana-dan-sana. URL — manba. */
function PeriodBar({ from, to, onApply }: { from: string; to: string; onApply: (r: { from: string; to: string }) => void }) {
  const { token } = theme.useToken();
  const [dFrom, setDFrom] = useState<Dayjs>(() => dayjs(from));
  const [dTo, setDTo] = useState<Dayjs>(() => dayjs(to));
  // applied range o'zgarsa draft ham yangilanadi
  useEffect(() => {
    setDFrom(dayjs(from));
    setDTo(dayjs(to));
  }, [from, to]);

  const dirty = dFrom.format('YYYY-MM-DD') !== from || dTo.format('YYYY-MM-DD') !== to;
  const days = dayjs(to).diff(dayjs(from), 'day') + 1;
  const noFuture = (d: Dayjs) => d.isAfter(dayjs(), 'day');

  const apply = () => {
    let f = dFrom;
    let t = dTo;
    if (f.isAfter(t)) [f, t] = [t, f];
    onApply({ from: f.format('YYYY-MM-DD'), to: t.format('YYYY-MM-DD') });
  };

  return (
    <div className="sb-panel" style={{ marginBottom: 18 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          padding: '12px 14px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ ...overline(token, token.colorTextSecondary), marginRight: 2 }}>Davr</span>
          <DatePicker
            value={dFrom}
            onChange={(d) => d && setDFrom(d)}
            format="DD.MM.YYYY"
            allowClear={false}
            disabledDate={noFuture}
            aria-label="Boshlanish sanasi"
          />
          <span style={{ color: token.colorTextTertiary }}>—</span>
          <DatePicker
            value={dTo}
            onChange={(d) => d && setDTo(d)}
            format="DD.MM.YYYY"
            allowClear={false}
            disabledDate={noFuture}
            aria-label="Tugash sanasi"
          />
          <Button type="primary" onClick={apply} disabled={!dirty}>
            Qo'llash
          </Button>
          <span className="num" style={{ fontSize: 12, color: token.colorTextTertiary, whiteSpace: 'nowrap' }}>
            {fmtDate(from)} – {fmtDate(to)} · {fmtNum(days)} kun
          </span>
        </div>
      </div>
    </div>
  );
}

function OwnerCockpit() {
  const navigate = useNavigate();
  const uf = useUrlFilters();

  // applied period — URL manba; standart: oy boshi → bugun
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  const from = dateRe.test(uf.get('from')) ? uf.get('from') : monthStartStr();
  const to = dateRe.test(uf.get('to')) ? uf.get('to') : todayStr();
  const isDefaultMonth = from === monthStartStr() && to === todayStr();

  const summaryQ = useQuery({
    queryKey: ['dashboard', 'summary', from, to],
    queryFn: async () => (await endpoints.dashboard({ from, to })) as unknown as SummaryResp,
    placeholderData: keepPreviousData,
  });
  const trends62Q = useQuery({
    queryKey: ['dashboard', 'trends', 62],
    queryFn: async () => (await endpoints.trends(62)) as TrendRow[],
  });
  // worklists still power the «taxminiy» profit flag (open cost lines); the rail
  // itself is retired per owner request — the cockpit leads with the numbers.
  const queues = useOwnerWorklists();
  const d62 = useMemo(() => derive62(trends62Q.data), [trends62Q.data]);
  const costOpenCount = queues.find((q) => q.key === 'cost-open')?.count ?? 0;
  const refetching = summaryQ.isFetching && !summaryQ.isLoading;

  const applyRange = (r: { from: string; to: string }) => {
    uf.set({
      from: r.from === monthStartStr() ? null : r.from,
      to: r.to === todayStr() ? null : r.to,
    });
  };

  return (
    <div>
      <PageHeader
        title="Ish stoli"
        meta={<DeskContext />}
        actions={[
          {
            key: 'new-order',
            label: 'Yangi buyurtma',
            primary: true,
            icon: <PlusOutlined />,
            onClick: () => navigate('/orders/new'),
          },
        ]}
      />
      <PeriodBar from={from} to={to} onApply={applyRange} />
      {refetching ? <div className="refetch-hairline" /> : null}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Davr natijasi (sana oralig'iga bog'liq) → kassa → hozirgi qarzlar */}
        {summaryQ.isError ? (
          <ErrorState error={summaryQ.error} onRetry={() => summaryQ.refetch()} />
        ) : summaryQ.isLoading ? (
          <KpiSkeleton />
        ) : (
          <OwnerKpis summary={summaryQ.data} d62={d62} costOpenCount={costOpenCount} showDeltas={isDefaultMonth} />
        )}

        {/* Kassa paneli — jami + har bir kassa */}
        <KassaPanel />

        {/* Trends chart + agent ranking */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
          <div style={{ flex: '2 1 480px', minWidth: 0 }}>
            <TrendsChart />
          </div>
          <div style={{ flex: '1 1 340px', minWidth: 0 }}>
            <RankingCard />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Small header context chip: Tashkent scope + today's date (03 §1 page identity). */
function DeskContext() {
  const { token } = theme.useToken();
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 12,
        color: token.colorTextTertiary,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: token.colorSuccess,
          display: 'inline-block',
        }}
      />
      Toshkent · {fmtDate(todayStr())}
    </span>
  );
}

function OwnerKpis({
  summary,
  d62,
  costOpenCount,
  showDeltas,
}: {
  summary?: SummaryResp;
  d62: Derived62 | null;
  costOpenCount: number;
  showDeltas: boolean;
}) {
  const s = summary;
  if (!s) return null;
  const p = s.period;
  const from = p.from;
  const to = p.to;
  const yFrom = yearStartStr();
  const today = todayStr();

  // deltalar faqat standart «shu oy» ko'rinishida mantiqiy (62-kunlik bazaga bog'liq)
  const salesDelta: StatCardDelta | undefined =
    showDeltas && d62?.monthSalesDelta != null
      ? { value: d62.monthSalesDelta, goodWhenUp: true, suffix: "o'tgan oyning shu davriga nisbatan" }
      : undefined;
  const collectedDelta: StatCardDelta | undefined =
    showDeltas && d62?.collectedDelta != null
      ? { value: d62.collectedDelta, goodWhenUp: true, suffix: "o'tgan oyning shu davriga nisbatan" }
      : undefined;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* ── DAVR NATIJASI — savdo · SOF FOYDA (bosh ko'rsatkich) · yig'ilgan to'lov ── */}
      <Band label="Davr natijasi">
        <div className="sb-kpi-grid">
          <CardTip title="Bekor qilinmagan buyurtmalar savdosi (tanlangan davr)">
            <StatCard
              label="Davr savdosi"
              value={p.sales}
              to={`/orders?from=${from}&to=${to}`}
              delta={salesDelta}
              sparkline={showDeltas ? d62?.sparkSales : undefined}
            />
          </CardTip>
          <CardTip title="Sof foyda = Mahsulot foydasi + Transport foydasi (tanlangan davr). Ochiq tannarxlar bo'lsa taxminiy.">
            <StatCard
              label="Sof foyda"
              value={p.netProfit}
              variant="in"
              estimated={costOpenCount > 0}
              to={`/orders?from=${from}&to=${to}`}
            />
          </CardTip>
          <CardTip title="Faqat CLIENT_IN, bekor qilinmagan to'lovlar (tanlangan davr)">
            <StatCard
              label="Yig'ilgan to'lov"
              value={p.collected}
              variant="in"
              to={`/payments?kind=client_in&from=${from}&to=${to}`}
              delta={collectedDelta}
              sparkline={showDeltas ? d62?.sparkCollected : undefined}
            />
          </CardTip>
        </div>
        <div style={compactRow}>
          <CompactStat label="Mahsulot foydasi" to={`/orders?from=${from}&to=${to}`}>
            <MoneyCell value={p.goodsProfit} variant="in" signed strong style={{ fontSize: 15 }} />
          </CompactStat>
          <CompactStat label="Transport foydasi" to={`/orders?from=${from}&to=${to}`}>
            <MoneyCell value={p.transportProfit} variant="in" signed strong style={{ fontSize: 15 }} />
          </CompactStat>
          <CompactStat label="Sotilgan hajm" to={`/orders?from=${from}&to=${to}`}>
            <span className="num" style={{ fontSize: 15, fontWeight: 600 }}>{fmtM3(p.cubeSold)}</span>
          </CompactStat>
          <CompactStat label="Buyurtmalar" to={`/orders?from=${from}&to=${to}`}>
            <span className="num" style={{ fontSize: 15, fontWeight: 600 }}>{fmtNum(p.orders)} ta</span>
          </CompactStat>
          <CompactStat label="Bugungi savdo" to={`/orders?from=${today}&to=${today}`}>
            <MoneyCell value={s.todaySales} strong style={{ fontSize: 15 }} />
          </CompactStat>
        </div>
      </Band>

      {/* ── HOZIRGI QARZ VA BALANSLAR — nuqta-vaqt, davrdan qat'i nazar ── */}
      <Band label="Hozirgi qarz va balanslar">
        <div className="sb-kpi-grid">
          <CardTip title="Faqat musbat qoldiqlar yig'indisi — bir mijozning avansi boshqasining qarzini yopmaydi">
            <StatCard label="Mijozlar qarzi" value={s.clientsOweUs} variant="neutral" size="md" to="/debts?tab=mijozlar" />
          </CardTip>
          <CardTip title="Faqat manfiy zavod qoldiqlari, musbat qilib ko'rsatilgan">
            <StatCard label="Zavodlarga qarzimiz" value={s.weOweFactories} variant="weOwe" size="md" to="/debts?tab=zavodlar" />
          </CardTip>
          <CardTip title="Faqat manfiy shofyor qoldiqlari, musbat qilib ko'rsatilgan">
            <StatCard label="Shofyorlarga qarzimiz" value={s.weOweVehicles} variant="weOwe" size="md" to="/debts?tab=shofyorlar" />
          </CardTip>
          <CardTip title="Bonus hamyonlar jami">
            <StatCard label="Bonus hamyonlar" value={s.bonusWallets} variant="in" size="md" to="/bonus" />
          </CardTip>
        </div>
        <div style={compactRow}>
          <CompactStat label="Yil savdosi" to={`/orders?from=${yFrom}&to=${today}`}>
            <MoneyCell value={s.yearSales} strong style={{ fontSize: 15 }} />
          </CompactStat>
          <CompactStat label="Yo'ldagi buyurtmalar" to="/orders?chip=inflight">
            <span className="num" style={{ fontSize: 15, fontWeight: 600 }}>{fmtNum(s.ordersInFlight ?? 0)} ta</span>
          </CompactStat>
          <CompactStat label="Mijozlardagi paddonlar" to="/debts?tab=paddonlar">
            <PalletChip pallets={s.palletsAtClients ?? 0} />
          </CompactStat>
        </div>
      </Band>
    </div>
  );
}

/** Kassa paneli — jami balans (UZS/USD) tepada aniq, so'ng har bir kassa kartada. */
function KassaPanel() {
  const { token } = theme.useToken();
  const q = useQuery({
    queryKey: ['dashboard', 'kassa'],
    queryFn: async () => (await endpoints.kassaDashboard()) as KassaBox[],
  });
  const boxes = q.data ?? [];
  const hasUzs = boxes.some((b) => b.currency === 'UZS');
  const hasUsd = boxes.some((b) => b.currency === 'USD');
  const uzsTotal = boxes.filter((b) => b.currency === 'UZS').reduce((a, b) => a + num(b.balance), 0);
  const usdTotal = boxes.filter((b) => b.currency === 'USD').reduce((a, b) => a + num(b.balance), 0);

  return (
    <div className="sb-panel" style={{ position: 'relative' }}>
      {q.isFetching && !q.isLoading ? <div className="refetch-hairline" /> : null}
      <div className="sb-panel__head">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
          <span className="sb-panel__title">Kassalar</span>
          {!q.isLoading && !q.isError && boxes.length > 0 ? (
            <span style={{ fontSize: 13, color: token.colorTextSecondary, display: 'inline-flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
              Jami
              {hasUzs ? (
                <b className="num" style={{ fontSize: 16, color: token.colorText }}>{fmtMoney(uzsTotal)} so'm</b>
              ) : null}
              {hasUzs && hasUsd ? <span style={{ color: token.colorTextTertiary }}>·</span> : null}
              {hasUsd ? <b className="num" style={{ fontSize: 16, color: token.colorText }}>{fmtUsd(usdTotal)}</b> : null}
            </span>
          ) : null}
        </div>
        <Link to="/kassa" style={linkStyle(token)}>Kassa →</Link>
      </div>
      <div className="sb-panel__body">
        {q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : q.isLoading ? (
          <Skeleton active paragraph={{ rows: 2 }} />
        ) : boxes.length === 0 ? (
          <EmptyState message="Faol kassalar topilmadi" />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(212px, 1fr))', gap: 12 }}>
            {boxes.map((b) => (
              <Link
                key={b.cashboxId}
                to={`/kassa?cashboxId=${b.cashboxId}`}
                className="dash-card dash-card--interactive dash-pressable"
                style={{ display: 'block', padding: 14, textDecoration: 'none', color: 'inherit' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontWeight: 600, color: token.colorText }}>{b.name}</span>
                  <StatusChip meta={CASHBOX_TYPE[b.type]} />
                </div>
                <CcyAmount value={b.balance} currency={b.currency} size={20} suffix={b.currency === 'UZS' ? "so'm" : undefined} />
                <div style={{ marginTop: 8 }}>
                  <FlowLine box={b} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TrendsChart() {
  const { token } = theme.useToken();
  const { mode } = useThemeMode();
  const uf = useUrlFilters();
  const navigate = useNavigate();

  // chart follows the page period (PeriodBar's from/to) — no quick-window presets
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  const from = dateRe.test(uf.get('from')) ? uf.get('from') : monthStartStr();
  const to = dateRe.test(uf.get('to')) ? uf.get('to') : todayStr();
  const q = useQuery({
    queryKey: ['dashboard', 'trends', from, to],
    queryFn: async () => (await endpoints.trendsRange({ from, to })) as TrendRow[],
    placeholderData: keepPreviousData,
  });
  const rows = q.data ?? [];

  const totals = useMemo(
    () =>
      rows.reduce(
        (a, r) => ({ sales: a.sales + num(r.sales), collected: a.collected + num(r.collected), orders: a.orders + (r.orders ?? 0) }),
        { sales: 0, collected: 0, orders: 0 },
      ),
    [rows],
  );
  const lineData = useMemo(
    () =>
      rows.flatMap((r) => [
        { date: r.date, series: SERIES.sales, value: num(r.sales) },
        { date: r.date, series: SERIES.collected, value: num(r.collected) },
      ]),
    [rows],
  );
  const barData = useMemo(() => rows.map((r) => ({ date: r.date, orders: r.orders ?? 0 })), [rows]);
  const colors = CHART[mode];

  // plots v2 DualAxes: per-child spec (typed loosely — the config is G2-shaped).
  const barSpec = {
    type: 'interval',
    data: barData,
    yField: 'orders',
    style: { fill: colors.bar, fillOpacity: 0.55 },
    axis: { y: { position: 'right', title: false, tickCount: 3, labelFormatter: (v: number) => fmtNum(v) } },
    tooltip: { items: [{ channel: 'y', valueFormatter: (v: number) => `${fmtNum(v)} ta` }] },
  } as Record<string, unknown>;
  const lineSpec = {
    type: 'line',
    data: lineData,
    yField: 'value',
    colorField: 'series',
    scale: { color: { domain: [SERIES.sales, SERIES.collected], range: [colors.sales, colors.collected] } },
    style: { lineWidth: 2 },
    axis: {
      x: { title: false, labelFormatter: (d: string) => dayjs(d).format('DD.MM'), labelAutoHide: true },
      y: { title: false, labelFormatter: (v: number) => fmtShort(v) },
    },
    labels: [{ text: 'series', selector: 'last', dx: 4, style: { fontSize: 11, fontWeight: 600 } }],
    tooltip: { title: (d: { date: string }) => fmtDate(d.date), items: [{ channel: 'y', valueFormatter: (v: number) => fmtUZS(v) }] },
  } as Record<string, unknown>;

  const chartChildren: unknown[] = [barSpec, lineSpec];

  const onEvent = (_chart: unknown, e: { type?: string; data?: { data?: { date?: string } } }) => {
    if (typeof e?.type === 'string' && e.type.endsWith('click')) {
      const date = e?.data?.data?.date;
      if (typeof date === 'string') navigate(`/orders?from=${date}&to=${date}`);
    }
  };

  return (
    <div style={{ ...cardShell(token), position: 'relative', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <span style={overline(token, token.colorTextSecondary)}>Savdo va tushum</span>
        <span className="num" style={{ fontSize: 12, color: token.colorTextTertiary, whiteSpace: 'nowrap' }}>
          {fmtDate(from)} – {fmtDate(to)}
        </span>
      </div>
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.isLoading ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : (
        <>
          {q.isFetching ? <div className="refetch-hairline" /> : null}
          <div style={{ fontSize: 12, color: token.colorTextSecondary, marginBottom: 8 }}>
            Σ savdo <b className="num">{fmtMoney(totals.sales)}</b> · Σ tushum <b className="num">{fmtMoney(totals.collected)}</b> ·{' '}
            <b className="num">{fmtNum(totals.orders)}</b> buyurtma
          </div>
          <div style={{ cursor: 'pointer' }}>
            <DualAxes
              xField="date"
              legend={{ color: { position: 'top' } }}
              height={300}
              autoFit
              theme={mode === 'dark' ? { type: 'classicDark' as const } : { type: 'classic' as const }}
              onEvent={onEvent as never}
              children={chartChildren as never}
            />
          </div>
          <div style={{ fontSize: 11, color: token.colorTextTertiary, marginTop: 6 }}>
            Barcha davrlar Toshkent taqvimi bo'yicha
          </div>
        </>
      )}
    </div>
  );
}

function RankingCard() {
  const { token } = theme.useToken();
  const uf = useUrlFilters();
  const navigate = useNavigate();

  const curMonth = dayjs().format('YYYY-MM');
  const mRaw = uf.get('month');
  const month = /^\d{4}-\d{2}$/.test(mRaw) ? mRaw : curMonth;
  const atCurrent = month === curMonth;
  const setMonth = (m: string) => uf.set({ month: m === curMonth ? null : m });
  const prev = () => setMonth(dayjs(`${month}-01`).subtract(1, 'month').format('YYYY-MM'));
  const next = () => {
    if (!atCurrent) setMonth(dayjs(`${month}-01`).add(1, 'month').format('YYYY-MM'));
  };

  const q = useQuery({
    queryKey: ['dashboard', 'ranking', month],
    queryFn: async () => (await endpoints.agentsRanking(month)) as unknown as RankingResp,
    placeholderData: keepPreviousData,
  });

  // compact dashboard ranking — 4 key columns; full 6-column ranking lives on /agents
  const columns: TableColumnsType<RankRow> = [
    {
      title: 'Agent',
      dataIndex: 'agent',
      key: 'agent',
      ellipsis: true,
      render: (v: string, r) => (
        <Link to={`/agents/${r.agentId}`} onClick={(e) => e.stopPropagation()}>
          {v}
        </Link>
      ),
    },
    { title: 'Savdo', dataIndex: 'sales', key: 'sales', align: 'right', render: (v: Money) => <MoneyCell value={v} /> },
    {
      title: 'Foyda',
      dataIndex: 'goodsProfit',
      key: 'goodsProfit',
      align: 'right',
      render: (v: Money) => <MoneyCell value={v} variant="in" signed />,
    },
    {
      title: (
        <Tooltip title="Qarzdorlik — hozirgi qoldiq (tanlangan oydan qat'i nazar, faqat musbat qoldiqlar)">
          <span style={{ borderBottom: `1px dashed ${token.colorBorder}`, cursor: 'help' }}>Qarz</span>
        </Tooltip>
      ),
      dataIndex: 'outstandingDebt',
      key: 'outstandingDebt',
      align: 'right',
      render: (v: Money) => <MoneyCell value={v} />,
    },
  ];

  return (
    <div style={{ ...cardShell(token), height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={overline(token, token.colorTextSecondary)}>Agentlar reytingi</span>
          <Link to="/agents" style={linkStyle(token)}>To'liq →</Link>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Button size="small" type="text" icon={<LeftOutlined />} aria-label="Oldingi oy" onClick={prev} />
          <DatePicker
            picker="month"
            size="small"
            allowClear={false}
            value={dayjs(`${month}-01`)}
            format="YYYY-MM"
            disabledDate={(d) => d.isAfter(dayjs(), 'month')}
            onChange={(d) => d && setMonth(d.format('YYYY-MM'))}
          />
          <Button size="small" type="text" icon={<RightOutlined />} aria-label="Keyingi oy" disabled={atCurrent} onClick={next} />
        </div>
      </div>
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <div className="scroll-x" style={{ position: 'relative' }}>
          {q.isFetching && !q.isLoading ? <div className="refetch-hairline" /> : null}
          <Table<RankRow>
            rowKey="agentId"
            size="small"
            columns={columns}
            dataSource={q.data?.agents ?? []}
            loading={q.isLoading}
            pagination={false}
            onRow={(r) => ({ onClick: () => navigate(`/agents/${r.agentId}`), style: { cursor: 'pointer' } })}
            locale={{ emptyText: <EmptyState message="Bu oyda ma'lumot yo'q" /> }}
          />
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════ AGENT ════════════════════════════════════

function AgentCockpit() {
  const summaryQ = useQuery({
    queryKey: ['dashboard', 'summary'],
    queryFn: async () => (await endpoints.dashboard()) as unknown as SummaryResp,
  });
  const trends62Q = useQuery({
    queryKey: ['dashboard', 'trends', 62],
    queryFn: async () => (await endpoints.trends(62)) as TrendRow[],
  });
  const d62 = useMemo(() => derive62(trends62Q.data), [trends62Q.data]);
  const refetching = summaryQ.isFetching && !summaryQ.isLoading;

  return (
    <div>
      <PageHeader title="Ish stoli" />
      {refetching ? <div className="refetch-hairline" /> : null}
      <div style={{ maxWidth: 760, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 22 }}>
        <AgentLimitCard />
        {summaryQ.isError ? (
          <ErrorState error={summaryQ.error} onRetry={() => summaryQ.refetch()} />
        ) : summaryQ.isLoading ? (
          <KpiSkeleton />
        ) : (
          <AgentKpis summary={summaryQ.data} d62={d62} />
        )}
        <AgentTrend />
      </div>
    </div>
  );
}

function AgentLimitCard() {
  const { token } = theme.useToken();
  const q = useQuery({
    queryKey: ['agent', 'me'],
    queryFn: async () => (await endpoints.agentMe()) as unknown as AgentMe,
  });
  const me = q.data;
  const lim = me ? (me.debtLimit == null ? null : num(me.debtLimit)) : null;
  const used = me ? num(me.outstandingDebt) : 0;
  const pct = lim && lim > 0 ? Math.round((used / lim) * 100) : null;
  const blocked = lim != null && lim > 0 && used >= lim;

  return (
    <div style={{ ...cardShell(token), position: 'relative' }}>
      {q.isFetching && !q.isLoading ? <div className="refetch-hairline" /> : null}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
        <span style={overline(token, token.colorTextSecondary)}>Qarz limiti</span>
        {me ? (
          <Link to={`/agents/${me.id}`} style={linkStyle(token)}>
            Mening ko'rsatkichlarim →
          </Link>
        ) : null}
      </div>
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.isLoading ? (
        <Skeleton active paragraph={{ rows: 2 }} />
      ) : me ? (
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 13, color: token.colorTextSecondary }}>
              {me.name}
              {me.clientCount != null ? ` · ${fmtNum(me.clientCount)} mijoz` : ''}
            </span>
            {pct != null ? (
              <span className="num" style={{ fontSize: 20, fontWeight: 600, color: pct > 90 ? token.colorError : pct >= 60 ? token.colorWarning : token.colorText }}>
                {pct}%
              </span>
            ) : null}
          </div>
          <Tooltip title="Band = mijozlaringizning musbat qoldiqlari yig'indisi. Bir mijozning avansi boshqasining qarzini yopmaydi.">
            <div>
              <CreditGauge limit={me.debtLimit ?? null} used={me.outstandingDebt ?? '0'} />
            </div>
          </Tooltip>
          {blocked ? (
            <div style={{ marginTop: 8, fontSize: 12, fontWeight: 500, color: token.colorError }}>
              Limit to'lgan — yangi qarzli buyurtma bloklanadi
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function AgentKpis({ summary, d62 }: { summary?: SummaryResp; d62: Derived62 | null }) {
  const s = summary;
  if (!s) return null;
  const from = monthStartStr();
  const to = todayStr();
  const yFrom = yearStartStr();

  const monthDelta: StatCardDelta | undefined =
    d62?.monthSalesDelta != null ? { value: d62.monthSalesDelta, goodWhenUp: true, suffix: "o'tgan oyning shu davriga nisbatan" } : undefined;
  const todayDelta: StatCardDelta | undefined =
    d62?.todaySalesDelta != null ? { value: d62.todaySalesDelta, goodWhenUp: true, suffix: 'kechaga nisbatan' } : undefined;
  const collectedDelta: StatCardDelta | undefined =
    d62?.collectedDelta != null ? { value: d62.collectedDelta, goodWhenUp: true, suffix: "o'tgan oyning shu davriga nisbatan" } : undefined;

  return (
    <Band label="Mening ko'rsatkichlarim">
      <div style={heroGrid}>
        <StatCard label="Oy savdosi" value={s.monthSales} to={`/orders?from=${from}&to=${to}`} delta={monthDelta} sparkline={d62?.sparkSales} />
        <StatCard label="Bugungi savdo" value={s.todaySales} to={`/orders?from=${to}&to=${to}`} delta={todayDelta} />
        <StatCard
          label="Yig'ilgan to'lov (oy)"
          value={s.collectedThisMonth}
          variant="in"
          to={`/payments?kind=client_in&from=${from}&to=${to}`}
          delta={collectedDelta}
          sparkline={d62?.sparkCollected}
        />
        <StatCard label="Mijozlarim qarzi" value={s.clientsOweUs} to="/debts?tab=mijozlar" />
      </div>
      <div style={compactRow}>
        <CompactStat label="Yil savdosi" to={`/orders?from=${yFrom}&to=${to}`}>
          <MoneyCell value={s.yearSales} strong style={{ fontSize: 14 }} />
        </CompactStat>
        <CompactStat label="Sotilgan hajm (oy)" to={`/orders?from=${from}&to=${to}`}>
          <span className="num" style={{ fontSize: 14, fontWeight: 600 }}>{fmtM3(s.cubeSoldMonth)}</span>
        </CompactStat>
        <CompactStat label="Mijozlardagi paddonlar" to="/debts?tab=paddonlar">
          <PalletChip pallets={s.palletsAtClients ?? 0} />
        </CompactStat>
      </div>
    </Band>
  );
}

function AgentTrend() {
  const { token } = theme.useToken();
  const { mode } = useThemeMode();
  const q = useQuery({
    queryKey: ['dashboard', 'trends', 14],
    queryFn: async () => (await endpoints.trends(14)) as TrendRow[],
  });
  const rows = q.data ?? [];
  const totals = useMemo(
    () => rows.reduce((a, r) => ({ sales: a.sales + num(r.sales), collected: a.collected + num(r.collected) }), { sales: 0, collected: 0 }),
    [rows],
  );
  const lineData = useMemo(
    () =>
      rows.flatMap((r) => [
        { date: r.date, series: SERIES.sales, value: num(r.sales) },
        { date: r.date, series: SERIES.collected, value: num(r.collected) },
      ]),
    [rows],
  );
  const colors = CHART[mode];

  return (
    <div style={{ ...cardShell(token), position: 'relative' }}>
      {q.isFetching && !q.isLoading ? <div className="refetch-hairline" /> : null}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={overline(token, token.colorTextSecondary)}>14 kunlik trend</span>
        <Link to="/orders" style={linkStyle(token)}>Buyurtmalar →</Link>
      </div>
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.isLoading ? (
        <Skeleton active paragraph={{ rows: 3 }} />
      ) : (
        <>
          <Line
            data={lineData}
            xField="date"
            yField="value"
            colorField="series"
            height={160}
            autoFit
            scale={{ color: { domain: [SERIES.sales, SERIES.collected], range: [colors.sales, colors.collected] } }}
            axis={{
              x: { title: false, labelFormatter: (d: string) => dayjs(d).format('DD.MM'), labelAutoHide: true },
              y: { title: false, labelFormatter: (v: number) => fmtShort(v) },
            }}
            legend={{ color: { position: 'top' } }}
            style={{ lineWidth: 2 }}
            theme={mode === 'dark' ? { type: 'classicDark' as const } : { type: 'classic' as const }}
            tooltip={{ title: (d: { date: string }) => fmtDate(d.date), items: [{ channel: 'y', valueFormatter: (v: number) => fmtUZS(v) }] }}
          />
          <div style={{ fontSize: 12, color: token.colorTextSecondary, marginTop: 6 }}>
            Σ savdo <b className="num">{fmtMoney(totals.sales)}</b> · Σ tushum <b className="num">{fmtMoney(totals.collected)}</b> so'm
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════ CASHIER ════════════════════════════════════

function CashierTerminal() {
  const navigate = useNavigate();
  const [composer, setComposer] = useState<PaymentKind | null>(null);
  const [peekId, setPeekId] = useState<string | null>(null);

  // `T` opens To'lov qabul qilish (the terminal's primary create).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (composer) return;
      if (e.key === 't' || e.key === 'T') {
        e.preventDefault();
        setComposer('CLIENT_IN');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [composer]);

  const intents: { label: string; kbd?: string; onClick: () => void; primary?: boolean }[] = [
    { label: "To'lov qabul qilish", kbd: 'T', onClick: () => setComposer('CLIENT_IN'), primary: true },
    { label: "Zavodga to'lash", onClick: () => setComposer('FACTORY_OUT') },
    { label: "Shofyorga to'lash", onClick: () => setComposer('VEHICLE_OUT') },
  ];

  return (
    <div>
      <PageHeader title="Kassa terminali" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {intents.map((it) => (
            <Button key={it.label} type={it.primary ? 'primary' : 'default'} onClick={it.onClick} style={{ height: 40 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                {it.label}
                {it.kbd ? <KbdHint>{it.kbd}</KbdHint> : null}
              </span>
            </Button>
          ))}
        </div>

        <CashboxCards />
        <TodayFeed onPeek={setPeekId} />
      </div>

      <PaymentComposer open={composer !== null} kind={composer ?? 'CLIENT_IN'} onClose={() => setComposer(null)} />
      <PaymentPeek paymentId={peekId} open={peekId !== null} onClose={() => setPeekId(null)} />
    </div>
  );
}

function CashboxCards() {
  const { token } = theme.useToken();
  const q = useQuery({
    queryKey: ['dashboard', 'kassa'],
    queryFn: async () => (await endpoints.kassaDashboard()) as KassaBox[],
  });
  const boxes = q.data ?? [];

  return (
    <div style={{ position: 'relative' }}>
      {q.isFetching && !q.isLoading ? <div className="refetch-hairline" /> : null}
      <div style={{ ...overline(token, token.colorTextSecondary), marginBottom: 8 }}>Kassalar</div>
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.isLoading ? (
        <div style={heroGrid}>
          {[0, 1, 2, 3].map((i) => (
            <SkeletonStat key={i} />
          ))}
        </div>
      ) : boxes.length === 0 ? (
        <div style={cardShell(token)}>
          <EmptyState message="Faol kassalar topilmadi" />
        </div>
      ) : (
        <>
          <div style={{ marginBottom: 10, fontSize: 13 }}>{totalsLine(boxes, token)}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
            {boxes.map((b) => (
              <Tooltip key={b.cashboxId} title="Butun davr: Σ kirim − Σ chiqim">
                <Link to={`/kassa?cashboxId=${b.cashboxId}`} style={{ ...cardShell(token), display: 'block', textDecoration: 'none', color: 'inherit' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                    <span style={{ fontWeight: 600, color: token.colorText }}>{b.name}</span>
                    <StatusChip meta={CASHBOX_TYPE[b.type]} />
                  </div>
                  <div style={{ fontSize: 20 }}>
                    <CcyAmount value={b.balance} currency={b.currency} size={20} suffix={b.currency === 'UZS' ? "so'm" : undefined} />
                  </div>
                  <div style={{ marginTop: 8 }}>
                    <FlowLine box={b} />
                  </div>
                </Link>
              </Tooltip>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function docLabel(r: KassaTxRow, onPeek: (id: string) => void): ReactNode {
  if (r.payment) {
    const party = r.payment.client?.name ?? r.payment.factory?.name ?? r.payment.vehicle?.name ?? '';
    const label = `${PAYMENT_KIND[r.payment.kind]?.label ?? "To'lov"}${party ? ' — ' + party : ''}`;
    const pid = r.payment.id;
    return (
      <a
        onClick={(e) => {
          e.stopPropagation();
          onPeek(pid);
        }}
        style={{ cursor: 'pointer' }}
      >
        {label}
      </a>
    );
  }
  if (r.expense) return `Xarajat${r.expense.category?.name ? ' — ' + r.expense.category.name : ''}`;
  if (r.bonusTransaction) return `Bonus${r.bonusTransaction.factory?.name ? ' — ' + r.bonusTransaction.factory.name : ''}`;
  if (r.source === 'REVERSAL' || r.reversalOf) return 'Storno';
  if (r.source === 'MANUAL') return "Qo'lda kiritilgan";
  return '—';
}

function TodayFeed({ onPeek }: { onPeek: (id: string) => void }) {
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const today = dayjs().format('YYYY-MM-DD');
  const q = useQuery({
    queryKey: ['kassa', 'tx', { today }],
    queryFn: () => endpoints.kassaTransactions({ dateFrom: today, dateTo: today, pageSize: 20 }) as Promise<Paged<KassaTxRow>>,
  });
  const rows = q.data?.items ?? [];

  // new rows pulse once on arrival (02 §5); the first page is seeded silently.
  const seenRef = useRef<Set<string>>(new Set());
  const [pulseIds, setPulseIds] = useState<Set<string>>(new Set());
  const idKey = rows.map((r) => r.id).join(',');
  useEffect(() => {
    const ids = rows.map((r) => r.id);
    if (seenRef.current.size === 0) {
      seenRef.current = new Set(ids);
      return;
    }
    const fresh = ids.filter((id) => !seenRef.current.has(id));
    if (fresh.length) {
      fresh.forEach((id) => seenRef.current.add(id));
      setPulseIds(new Set(fresh));
      const t = setTimeout(() => setPulseIds(new Set()), 1300);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idKey]);

  const isGhost = (r: KassaTxRow) =>
    r.source === 'REVERSAL' || !!r.reversedBy || !!r.reversalOf || !!r.payment?.voidedAt || !!r.expense?.voidedAt;

  const columns: TableColumnsType<KassaTxRow> = [
    {
      title: 'Vaqt',
      dataIndex: 'date',
      key: 'date',
      width: 64,
      render: (v: string) => (
        <Tooltip title={dayjs(v).format('DD.MM.YYYY HH:mm')}>
          <span className="num">{dayjs(v).format('HH:mm')}</span>
        </Tooltip>
      ),
    },
    { title: 'Kassa', key: 'box', render: (_: unknown, r) => r.cashbox?.name ?? '—' },
    {
      title: "Yo'nalish",
      key: 'dir',
      align: 'right',
      width: 150,
      render: (_: unknown, r) => (
        <MoneyCell
          value={r.direction === 'IN' ? num(r.amount) : -num(r.amount)}
          variant={isGhost(r) ? 'ghost' : r.direction === 'IN' ? 'in' : 'neutral'}
          signed
        />
      ),
    },
    { title: 'Hujjat', key: 'doc', render: (_: unknown, r) => docLabel(r, onPeek) },
    { title: 'Kim', key: 'who', width: 120, render: (_: unknown, r) => r.createdBy?.name ?? '—' },
    {
      title: '',
      key: 'kebab',
      width: 44,
      render: (_: unknown, r) => {
        const items: MenuProps['items'] = [];
        if (r.payment && !r.payment.voidedAt) items.push({ key: 'receipt', icon: <PrinterOutlined />, label: 'Kvitansiya' });
        items.push({ key: 'open', label: 'Hujjatni ochish' });
        return (
          <Dropdown
            trigger={['click']}
            menu={{
              items,
              onClick: ({ key }) => {
                if (key === 'receipt' && r.payment) navigate(`/print/receipt/${r.payment.id}`);
                else if (key === 'open') {
                  if (r.payment) onPeek(r.payment.id);
                  else navigate('/kassa');
                }
              },
            }}
          >
            <Button type="text" size="small" icon={<MoreOutlined />} aria-label="Amallar" onClick={(e) => e.stopPropagation()} />
          </Dropdown>
        );
      },
    },
  ];

  return (
    <div style={cardShell(token)}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={overline(token, token.colorTextSecondary)}>Bugungi amallar</span>
        <Link to="/kassa" style={linkStyle(token)}>Hammasi →</Link>
      </div>
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <div className="scroll-x" style={{ position: 'relative' }}>
          {q.isFetching && !q.isLoading ? <div className="refetch-hairline" /> : null}
          <Table<KassaTxRow>
            rowKey="id"
            size="small"
            columns={columns}
            dataSource={rows}
            loading={q.isLoading}
            pagination={false}
            rowClassName={(r) => [pulseIds.has(r.id) ? 'pulse-row' : '', isGhost(r) ? 'ghost-row' : ''].filter(Boolean).join(' ')}
            onRow={(r) => ({
              onClick: () => {
                if (r.payment) onPeek(r.payment.id);
              },
            })}
            locale={{ emptyText: <EmptyState message="Bugun hali amal yo'q" /> }}
          />
        </div>
      )}
    </div>
  );
}

function Fld({ label, children }: { label: string; children: ReactNode }) {
  const { token } = theme.useToken();
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 500, color: token.colorText, marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}


// ═══════════════════════════════ dispatch ═══════════════════════════════════

export default function Dashboard() {
  const { user } = useAuth();
  if (user?.role === 'CASHIER') return <CashierTerminal />;
  if (user?.role === 'AGENT') return <AgentCockpit />;
  return <OwnerCockpit />;
}
