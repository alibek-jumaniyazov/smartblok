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
import {
  CalendarOutlined,
  CarOutlined,
  FundOutlined,
  GiftOutlined,
  LeftOutlined,
  MoreOutlined,
  PlusOutlined,
  PrinterOutlined,
  RightOutlined,
  RiseOutlined,
  ShopOutlined,
  TeamOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import { DualAxes, Line } from '@ant-design/plots';
import dayjs, { type Dayjs } from 'dayjs';
import { apiError, endpoints } from '../lib/api';
import { fmtDate, fmtM3, fmtMoney, fmtNum, fmtShort, fmtUZS, num } from '../lib/format';
import { translate } from '../lib/i18n';
import { useIsDesktop, useIsPhone } from '../lib/responsive';
import { CASH_DIRECTION, CASHBOX_TYPE, PAYMENT_KIND } from '../lib/status-maps';
import { useUrlFilters } from '../lib/useUrlFilters';
import { useOwnerWorklists } from '../lib/worklists';
import { useAuth } from '../auth/AuthContext';
import { useThemeMode } from '../components/ThemeContext';
import { useT } from '../components/LangContext';
import {
  CashboxSelect,
  BalanceTag,
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

interface DataRange {
  from: string;
  to: string;
}

/** All-time reconciliation — Excel-verified totals, independent of the period filter. */
interface AllTimeBlock {
  sales: Money;
  cost: Money;
  goodsProfit: Money;
  transportProfit: Money;
  transportCost: Money;
  netProfit: Money;
  collected: Money; // kirim — client money in
  factoryPaid: Money;
  vehiclePaid: Money;
  chiqim: Money; // factory + driver money out
  clientsOweUs: Money;
  weOweFactories: Money;
  orders: number;
  cubeSold: string;
}

interface SummaryResp {
  scope: 'agent' | 'global';
  period: PeriodBlock;
  dataRange?: DataRange | null;
  allTime?: AllTimeBlock;
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
// Telefonda min 150px — `.sb-kpi-grid` ning mobil qatlami bilan bir xil pol,
// shunda 320px da ham gorizontal skroll tug'ilmaydi (2 tadan yoki 1 tadan).
const heroGrid = (isPhone = false): CSSProperties => ({
  display: 'grid',
  gridTemplateColumns: `repeat(auto-fit, minmax(${isPhone ? 150 : 212}px, 1fr))`,
  gap: isPhone ? 10 : 14,
});

// R17: telefonda pul figurasi va uning birligi («so'm») aka-uka elementlar —
// birlik MoneyCell ning nowrap span'i ICHIDA qolsa, u summani kengaytirib
// kartadan chiqarib yuboradi. Bu qator ularni o'ralishiga ruxsat beradi.
const heroMoneyRow: CSSProperties = { display: 'flex', alignItems: 'baseline', gap: 4, flexWrap: 'wrap' };

const cardShell = (token: Tok, isPhone = false): CSSProperties => ({
  padding: isPhone ? 12 : 16,
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
  const t = useT();
  return (
    <section aria-label={t(label)} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <span style={overline(token, token.colorTextTertiary)}>{t(label)}</span>
      {children}
    </section>
  );
}

/** compact KPI (label + arbitrary value node) — money still flows via MoneyCell. */
function CompactStat({ label, to, children }: { label: string; to?: string; children: ReactNode }) {
  const { token } = theme.useToken();
  const t = useT();
  const [hover, setHover] = useState(false);
  const inner = (
    <div
      onMouseEnter={to ? () => setHover(true) : undefined}
      onMouseLeave={to ? () => setHover(false) : undefined}
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, minWidth: 132 }}
    >
      <span
        style={{
          ...overline(token, to && hover ? token.colorPrimary : token.colorTextSecondary),
          transition: 'color 0.12s cubic-bezier(0.2, 0, 0, 1)',
        }}
      >
        {t(label)}
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

/**
 * Definition wrapper. Desktopda — hover tooltip. Telefonda hover yo'q, ya'ni
 * tooltipdagi ta'rif umuman o'qilmaydi (spec R12: tooltip qiymatni BEZAY oladi,
 * lekin qiymatning O'ZI bo'la olmaydi) — shuning uchun kartaning ostiga
 * ko'rinadigan matn sifatida chiqadi. Tooltip o'rami teginishda kartaning
 * bosilishini ham "yeb" qo'yardi.
 */
function CardTip({ title, children }: { title?: ReactNode; children: ReactNode }) {
  const { token } = theme.useToken();
  const t = useT();
  const isPhone = useIsPhone();
  if (!title) return <>{children}</>;
  if (isPhone) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
        {children}
        <span style={{ fontSize: 11, lineHeight: '15px', color: token.colorTextTertiary }}>
          {typeof title === 'string' ? t(title) : title}
        </span>
      </div>
    );
  }
  return (
    <Tooltip title={typeof title === 'string' ? t(title) : title}>
      <div style={{ display: 'block', height: '100%' }}>{children}</div>
    </Tooltip>
  );
}

function SkeletonStat() {
  const { token } = theme.useToken();
  const isPhone = useIsPhone();
  return (
    <div style={{ ...cardShell(token, isPhone), minHeight: 96, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Skeleton.Button active size="small" style={{ height: 12, width: 90 }} />
      {/* telefonda 150px qat'iy kenglik 150px li kartadan chiqib ketardi */}
      <Skeleton.Button active size="small" style={{ height: 22, width: isPhone ? '100%' : 150 }} />
    </div>
  );
}

function KpiSkeleton() {
  const isPhone = useIsPhone();
  return (
    <div style={heroGrid(isPhone)}>
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
  const t = useT();
  const isPhone = useIsPhone();
  const neg = num(value) < 0;
  // R17: telefonda 9 xonali summa 20px da 150px li kartadan chiqib ketadi —
  // shrift kichrayadi, «so'm» esa nowrap summadan TASHQARIDA (MoneyCell suffix'ni
  // o'z nowrap span'i ichida chiqaradi, ya'ni o'ralmaydi).
  const fs = isPhone ? Math.min(size, 18) : size;
  if (currency === 'USD') {
    return (
      <span
        className="num"
        style={{ fontSize: fs, fontWeight: strong ? 600 : 500, color: neg ? token.colorError : token.colorText, whiteSpace: 'nowrap' }}
      >
        {fmtUsd(value)}
        {neg ? <span style={{ fontSize: 11, marginLeft: 6 }}>{t('kamomad')}</span> : null}
      </span>
    );
  }
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'baseline',
        gap: 6,
        ...(isPhone ? { flexWrap: 'wrap' as const, maxWidth: '100%' } : null),
      }}
    >
      <MoneyCell
        value={value}
        variant={neg ? 'owedToUs' : 'neutral'}
        strong={strong}
        suffix={isPhone ? undefined : suffix}
        style={{ fontSize: fs }}
      />
      {isPhone && suffix ? <span style={{ fontSize: 11, color: token.colorTextTertiary }}>{suffix}</span> : null}
      {neg ? <span style={{ fontSize: 11, color: token.colorError }}>{t('kamomad')}</span> : null}
    </span>
  );
}

function FlowLine({ box }: { box: KassaBox }) {
  const { token } = theme.useToken();
  const t = useT();
  const isPhone = useIsPhone();
  const usd = box.currency === 'USD';
  const kirim = usd ? fmtUsd(box.todayIn) : fmtMoney(box.todayIn);
  const chiqim = usd ? fmtUsd(box.todayOut) : fmtMoney(box.todayOut);
  // «↑ kirim … · chiqim …» nowrap holida ~220px — bu grid katakchasining
  // min-content kengligini shishirib, telefonda kartani chetdan chiqarardi.
  // Summalar `.num` bo'lgani uchun baribir o'z ichida bo'linmaydi.
  return (
    <span style={{ fontSize: 11, color: token.colorTextTertiary, whiteSpace: isPhone ? 'normal' : 'nowrap' }}>
      ↑ {t('kirim')} <span className="num" style={{ color: 'var(--sb-money-in)' }}>{kirim}</span>
      {' · '}{t('chiqim')}{' '}
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
        {translate('UZS jami')}: <b className="num">{fmtMoney(uzs)}</b> {translate("so'm")}
      </span>,
    );
  }
  if (boxes.some((b) => b.currency === 'USD')) {
    const usd = boxes.filter((b) => b.currency === 'USD').reduce((a, b) => a + num(b.balance), 0);
    parts.push(
      <span key="usd">
        {translate('USD jami')}: <b className="num">{fmtUsd(usd)}</b>
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
  const t = useT();
  const isPhone = useIsPhone();
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
    <div className="sb-panel" style={{ marginBottom: isPhone ? 12 : 18 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          padding: isPhone ? '10px 12px' : '12px 14px',
        }}
      >
        {/* Telefonda: «Davr» o'z satrida → ikki sana yonma-yon (har biri 1fr,
            suffix ikonkasi olib tashlanadi — 320px da u ~22px yeydi) →
            «Qo'llash» butun kenglikda → xulosa satri pastda. */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
            minWidth: 0,
            ...(isPhone ? { width: '100%', rowGap: 10 } : null),
          }}
        >
          <span
            style={{
              ...overline(token, token.colorTextSecondary),
              ...(isPhone ? { width: '100%' } : { marginRight: 2 }),
            }}
          >
            {t('Davr')}
          </span>
          <DatePicker
            value={dFrom}
            onChange={(d) => d && setDFrom(d)}
            format="DD.MM.YYYY"
            allowClear={false}
            disabledDate={noFuture}
            aria-label={t('Boshlanish sanasi')}
            suffixIcon={isPhone ? null : undefined}
            style={isPhone ? { flex: '1 1 0', minWidth: 0 } : undefined}
          />
          <span style={{ color: token.colorTextTertiary }}>—</span>
          <DatePicker
            value={dTo}
            onChange={(d) => d && setDTo(d)}
            format="DD.MM.YYYY"
            allowClear={false}
            disabledDate={noFuture}
            aria-label={t('Tugash sanasi')}
            suffixIcon={isPhone ? null : undefined}
            style={isPhone ? { flex: '1 1 0', minWidth: 0 } : undefined}
          />
          <Button type="primary" onClick={apply} disabled={!dirty} block={isPhone}>
            {t("Qo'llash")}
          </Button>
          <span
            className="num"
            style={{
              fontSize: 12,
              color: token.colorTextTertiary,
              whiteSpace: isPhone ? 'normal' : 'nowrap',
              ...(isPhone ? { width: '100%' } : null),
            }}
          >
            {fmtDate(from)} – {fmtDate(to)} · {t('{n} kun', { n: fmtNum(days) })}
          </span>
        </div>
      </div>
    </div>
  );
}

function OwnerCockpit() {
  const navigate = useNavigate();
  const uf = useUrlFilters();
  const isPhone = useIsPhone();

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

  // The records carry their own dates (e.g. an imported June workbook). If the owner
  // hasn't picked a range and the default current month is empty, open the cockpit on
  // the actual data span so savdo/sof foyda show instead of a misleading zero month.
  const dataRange = summaryQ.data?.dataRange;
  const periodOrders = summaryQ.data?.period.orders;
  useEffect(() => {
    if (!isDefaultMonth || periodOrders == null) return;
    if (periodOrders > 0 || !dataRange) return;
    if (dataRange.from === from && dataRange.to === to) return;
    uf.set({ from: dataRange.from, to: dataRange.to });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDefaultMonth, periodOrders, dataRange?.from, dataRange?.to]);

  return (
    <div>
      <PageHeader
        title="Ish stoli"
        subtitle="Biznes ko'rsatkichlari, qarzlar va e'tibor markazi"
        accent
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
      <div className="sb-stack">
        {/* 1) Davr natijasi + qarz/balanslar (KPI) */}
        {summaryQ.isError ? (
          <ErrorState error={summaryQ.error} onRetry={() => summaryQ.refetch()} />
        ) : summaryQ.isLoading ? (
          <KpiSkeleton />
        ) : (
          <OwnerKpis summary={summaryQ.data} d62={d62} costOpenCount={costOpenCount} showDeltas={isDefaultMonth} />
        )}

        {/* 2) Umumiy hisobot — Excel bilan tasdiqlangan savdo/sof foyda/kirim/chiqim */}
        {summaryQ.isError ? null : summaryQ.isLoading ? null : <ReconPanel summary={summaryQ.data} />}

        {/* 3) Kassalar — jami + har bir kassa (o'z sarlavhasi bilan) */}
        <KassaPanel />

        {/* 3) Tahlil — trend grafigi + agent reytingi (alohida zona) */}
        <Band label="Tahlil">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: isPhone ? 12 : 16 }}>
            <div style={{ flex: '2 1 480px', minWidth: 0 }}>
              <TrendsChart />
            </div>
            <div style={{ flex: '1 1 340px', minWidth: 0 }}>
              <RankingCard />
            </div>
          </div>
        </Band>
      </div>
    </div>
  );
}

/** Small header context chip: Tashkent scope + today's date (03 §1 page identity). */
function DeskContext() {
  const { token } = theme.useToken();
  const t = useT();
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
      {t('Toshkent')} · {fmtDate(todayStr())}
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
  const t = useT();
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
      {/* ── DAVR NATIJASI — 4 ta bosh ko'rsatkich, har biri belgili (bir ko'rishda) ── */}
      <Band label="Davr natijasi">
        <div className="sb-kpi-grid">
          <CardTip title="Bekor qilinmagan buyurtmalar savdosi (tanlangan davr)">
            <StatCard
              label="Davr savdosi"
              value={p.sales}
              icon={<RiseOutlined />}
              to={`/orders?from=${from}&to=${to}`}
              delta={salesDelta}
              sparkline={showDeltas ? d62?.sparkSales : undefined}
              note={`${fmtNum(p.orders)} ${t('buyurtma')} · ${fmtM3(p.cubeSold)}`}
            />
          </CardTip>
          <CardTip title="Sof foyda = Mahsulot foydasi + Transport foydasi (tanlangan davr). Ochiq tannarxlar bo'lsa taxminiy.">
            <StatCard
              label="Sof foyda"
              value={p.netProfit}
              variant="in"
              icon={<FundOutlined />}
              estimated={costOpenCount > 0}
              to={`/orders?from=${from}&to=${to}`}
              note={`${t('Mahsulot')} ${fmtShort(p.goodsProfit)} + ${t('Transport')} ${fmtShort(p.transportProfit)}`}
            />
          </CardTip>
          <CardTip title="Mijozlardan sof tushum — to'lovlardan qaytarilgan/ushlab qolingan summalar ayirilgan (tanlangan davr)">
            <StatCard
              label="Yig'ilgan to'lov"
              value={p.collected}
              variant="in"
              icon={<WalletOutlined />}
              to={`/payments?kind=client_in&from=${from}&to=${to}`}
              delta={collectedDelta}
              sparkline={showDeltas ? d62?.sparkCollected : undefined}
            />
          </CardTip>
          <CardTip title="Bugungi bekor qilinmagan savdo">
            <StatCard
              label="Bugungi savdo"
              value={s.todaySales}
              icon={<CalendarOutlined />}
              to={`/orders?from=${today}&to=${today}`}
            />
          </CardTip>
        </div>
      </Band>

      {/* ── QARZ VA BALANSLAR — nuqta-vaqt qarz uchligi + operativ ko'rsatkichlar ── */}
      <Band label="Qarz va balanslar">
        <div className="sb-kpi-grid">
          <CardTip title="Mijozlar balansi — qarzlardan avanslar ayirilgan sof qiymat (daftardagi «Ост»); manfiy bo'lsa umumiy avans">
            {/* NET («Ост»): unsigned + word, qarz = red / avans = green — same rule as BalanceTag */}
            <StatCard
              label="Mijozlar balansi"
              value={Math.abs(num(s.clientsOweUs))}
              variant={num(s.clientsOweUs) >= 1 ? 'owedToUs' : num(s.clientsOweUs) <= -1 ? 'in' : 'neutral'}
              note={num(s.clientsOweUs) >= 1 ? t('qarz') : num(s.clientsOweUs) <= -1 ? t('avans') : t('hisob yopiq')}
              size="md"
              icon={<TeamOutlined />}
              to="/debts?tab=mijozlar"
            />
          </CardTip>
          <CardTip title="Faqat manfiy zavod qoldiqlari, musbat qilib ko'rsatilgan">
            <StatCard label="Zavodlarga qarzimiz" value={s.weOweFactories} variant="weOwe" size="md" icon={<ShopOutlined />} to="/debts?tab=zavodlar" />
          </CardTip>
          <CardTip title="Faqat manfiy shofyor qoldiqlari, musbat qilib ko'rsatilgan">
            <StatCard label="Shofyorlarga qarzimiz" value={s.weOweVehicles} variant="weOwe" size="md" icon={<CarOutlined />} to="/debts?tab=shofyorlar" />
          </CardTip>
          <CardTip title="Bonus hamyonlar jami (zavod → diller chegirma hamyoni)">
            <StatCard label="Bonus hamyonlar" value={s.bonusWallets} variant="in" size="md" icon={<GiftOutlined />} to="/bonus" />
          </CardTip>
        </div>
        <div className="sb-stat-strip">
          <CompactStat label="Yil savdosi" to={`/orders?from=${yFrom}&to=${today}`}>
            <MoneyCell value={s.yearSales} strong style={{ fontSize: 15 }} />
          </CompactStat>
          <CompactStat label="Yo'ldagi buyurtmalar" to="/orders?chip=inflight">
            <span className="num" style={{ fontSize: 15, fontWeight: 600 }}>{fmtNum(s.ordersInFlight ?? 0)} {t('ta')}</span>
          </CompactStat>
          <CompactStat label="Mijozlardagi paddonlar" to="/debts?tab=paddonlar">
            <PalletChip pallets={s.palletsAtClients ?? 0} />
          </CompactStat>
        </div>
      </Band>
    </div>
  );
}

/**
 * Umumiy hisobot — butun ma'lumot bo'yicha (davr filtridan qat'i nazar) Excel bilan
 * tasdiqlangan raqamlar: umumiy savdo, sof foyda, kirim/chiqim. «Sof foyda kassada
 * hisoblanadi» talabi shu yerda: sof foyda = yalpi foyda − transport.
 */
function ReconPanel({ summary }: { summary?: SummaryResp }) {
  const { token } = theme.useToken();
  const t = useT();
  const isPhone = useIsPhone();
  const a = summary?.allTime;
  const dr = summary?.dataRange;
  if (!a) return null;

  const tile = (
    label: string,
    value: Money | number,
    opts?: { variant?: 'in' | 'neutral' | 'weOwe' | 'owedToUs'; hero?: boolean; note?: ReactNode },
  ) => (
    <div
      style={{
        ...cardShell(token, isPhone),
        padding: isPhone ? 12 : 14,
        minWidth: 0,
        ...(opts?.hero ? { borderColor: token.colorPrimaryBorder, background: token.colorPrimaryBg } : {}),
      }}
    >
      <span style={overline(token, opts?.hero ? token.colorPrimary : token.colorTextSecondary)}>{t(label)}</span>
      {/* R17: telefonda «so'm» — nowrap summadan tashqaridagi aka-uka element,
          shunda 9 xonali raqam kartani kengaytirmaydi va kesilmaydi. */}
      <div style={{ marginTop: 6, ...(isPhone ? heroMoneyRow : null) }}>
        <MoneyCell
          value={value}
          variant={opts?.variant ?? 'neutral'}
          strong
          style={{ fontSize: isPhone ? (opts?.hero ? 19 : 16) : opts?.hero ? 22 : 18 }}
          suffix={isPhone ? undefined : t("so'm")}
        />
        {isPhone ? <span style={{ fontSize: 11, color: token.colorTextTertiary }}>{t("so'm")}</span> : null}
      </div>
      {opts?.note ? <div style={{ marginTop: 4, fontSize: 11, color: token.colorTextTertiary }}>{opts.note}</div> : null}
    </div>
  );

  return (
    <div className="sb-panel">
      <div className="sb-panel__head">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <span className="sb-panel__title">{t('Umumiy hisobot')}</span>
          <span style={{ fontSize: 12, color: token.colorTextTertiary }}>
            {t("Butun davr — Excel bilan tasdiqlangan")}
            {dr ? ` · ${fmtDate(dr.from)} – ${fmtDate(dr.to)}` : ''}
          </span>
        </div>
        <span style={{ fontSize: 12, color: token.colorTextTertiary, whiteSpace: 'nowrap' }}>
          {fmtNum(a.orders)} {t('buyurtma')} · {fmtM3(a.cubeSold)}
        </span>
      </div>
      <div className="sb-panel__body">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(auto-fill, minmax(${isPhone ? 150 : 200}px, 1fr))`,
            gap: isPhone ? 10 : 12,
          }}
        >
          {tile('Umumiy savdo', a.sales)}
          {tile('Zavod tannarxi', a.cost)}
          {tile('Yalpi foyda', a.goodsProfit)}
          {tile('Sof foyda', a.netProfit, {
            variant: 'in',
            hero: true,
            note: `${t('Yalpi')} ${fmtShort(a.goodsProfit)} − ${t('Transport')} ${fmtShort(a.transportCost)}`,
          })}
          {tile('Kirim (mijoz tushumi)', a.collected, { variant: 'in' })}
          {tile('Chiqim (zavod + shofyor)', a.chiqim)}
          {/* «Ост» is NET — show it unsigned with the word (qarz red / avans green) */}
          {tile('Mijozlar balansi', Math.abs(num(a.clientsOweUs)), {
            variant: num(a.clientsOweUs) >= 1 ? 'owedToUs' : num(a.clientsOweUs) <= -1 ? 'in' : 'neutral',
            note: num(a.clientsOweUs) >= 1 ? t('qarz') : num(a.clientsOweUs) <= -1 ? t('avans') : t('hisob yopiq'),
          })}
          {tile('Zavodga qarzimiz', a.weOweFactories, { variant: 'weOwe' })}
        </div>
      </div>
    </div>
  );
}

/** Kassa paneli — jami balans (UZS/USD) tepada aniq, so'ng har bir kassa kartada. */
function KassaPanel() {
  const { token } = theme.useToken();
  const t = useT();
  const isPhone = useIsPhone();
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
          <span className="sb-panel__title">{t('Kassalar')}</span>
          {!q.isLoading && !q.isError && boxes.length > 0 ? (
            <span style={{ fontSize: 13, color: token.colorTextSecondary, display: 'inline-flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
              {t('Jami')}
              {hasUzs ? (
                <b className="num" style={{ fontSize: 16, color: token.colorText }}>{fmtMoney(uzsTotal)} {t("so'm")}</b>
              ) : null}
              {hasUzs && hasUsd ? <span style={{ color: token.colorTextTertiary }}>·</span> : null}
              {hasUsd ? <b className="num" style={{ fontSize: 16, color: token.colorText }}>{fmtUsd(usdTotal)}</b> : null}
            </span>
          ) : null}
        </div>
        <Link to="/kassa" style={linkStyle(token)}>{t('Kassa →')}</Link>
      </div>
      <div className="sb-panel__body">
        {q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : q.isLoading ? (
          <Skeleton active paragraph={{ rows: 2 }} />
        ) : boxes.length === 0 ? (
          <EmptyState message="Faol kassalar topilmadi" />
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(auto-fill, minmax(${isPhone ? 180 : 212}px, 1fr))`,
              gap: isPhone ? 10 : 12,
            }}
          >
            {boxes.map((b) => (
              <Link
                key={b.cashboxId}
                to={`/kassa?cashboxId=${b.cashboxId}`}
                className="dash-card dash-card--interactive dash-pressable"
                style={{ display: 'block', padding: isPhone ? 12 : 14, minWidth: 0, textDecoration: 'none', color: 'inherit' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8, minWidth: 0 }}>
                  {/* R6: minWidth:0 bo'lmasa flex bolasining eng kichik kengligi =
                      matnining to'liq kengligi — nom o'ralmaydi va karta yorilib ketadi */}
                  <span style={{ fontWeight: 600, color: token.colorText, minWidth: 0 }}>{b.name}</span>
                  <StatusChip meta={CASHBOX_TYPE[b.type]} />
                </div>
                <CcyAmount value={b.balance} currency={b.currency} size={20} suffix={b.currency === 'UZS' ? t("so'm") : undefined} />
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
  const t = useT();
  const isPhone = useIsPhone();
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
  // R18 telefon shoxobchasi: ikkinchi (o'ng, «buyurtmalar») o'qi olib tashlanadi —
  // 320px da u chizma maydonining ~25% ini yeydi; seriya oxiridagi yorliqlar ham
  // (ular legenda bilan bir xil ma'lumot) o'chadi, legenda pastga tushadi.
  const barSpec = {
    type: 'interval',
    data: barData,
    yField: 'orders',
    style: { fill: colors.bar, fillOpacity: 0.55 },
    axis: isPhone
      ? { y: false }
      : { y: { position: 'right', title: false, tickCount: 3, labelFormatter: (v: number) => fmtNum(v) } },
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
      y: { title: false, labelFormatter: (v: number) => fmtShort(v), ...(isPhone ? { tickCount: 4 } : null) },
    },
    labels: isPhone ? [] : [{ text: 'series', selector: 'last', dx: 4, style: { fontSize: 11, fontWeight: 600 } }],
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
    <div style={{ ...cardShell(token, isPhone), position: 'relative', height: '100%', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, rowGap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
        <span style={overline(token, token.colorTextSecondary)}>{t('Savdo va tushum')}</span>
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
            Σ {t('savdo')} <b className="num">{fmtMoney(totals.sales)}</b> · Σ {t('tushum')} <b className="num">{fmtMoney(totals.collected)}</b> ·{' '}
            <b className="num">{fmtNum(totals.orders)}</b> {t('buyurtma')}
          </div>
          <div style={{ cursor: 'pointer', minWidth: 0 }}>
            <DualAxes
              xField="date"
              legend={{ color: { position: isPhone ? 'bottom' : 'top' } }}
              height={isPhone ? 210 : 300}
              autoFit
              theme={mode === 'dark' ? { type: 'classicDark' as const } : { type: 'classic' as const }}
              onEvent={onEvent as never}
              children={chartChildren as never}
            />
          </div>
          <div style={{ fontSize: 11, color: token.colorTextTertiary, marginTop: 6 }}>
            {t("Barcha davrlar Toshkent taqvimi bo'yicha")}
          </div>
        </>
      )}
    </div>
  );
}

function RankingCard() {
  const { token } = theme.useToken();
  const t = useT();
  const isPhone = useIsPhone();
  const isDesktop = useIsDesktop();
  const uf = useUrlFilters();
  const navigate = useNavigate();
  const balanceHint = t("Agent mijozlarining joriy balansi — qarzlardan avanslar ayirilgan (tanlangan oydan qat'i nazar)");

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
      title: t('Agent'),
      dataIndex: 'agent',
      key: 'agent',
      ellipsis: true,
      render: (v: string, r) => (
        <Link to={`/agents/${r.agentId}`} onClick={(e) => e.stopPropagation()}>
          {v}
        </Link>
      ),
    },
    { title: t('Savdo'), dataIndex: 'sales', key: 'sales', align: 'right', render: (v: Money) => <MoneyCell value={v} /> },
    {
      title: t("Yig'ilgan"),
      dataIndex: 'collected',
      key: 'collected',
      align: 'right',
      render: (v: Money) => <MoneyCell value={v} variant="in" />,
    },
    {
      // NET balance of the agent's clients (debts minus advances) — same figure the
      // Agentlar page shows; a net advance renders green «Avans», a net debt red «Qarz».
      title: (
        <Tooltip title={balanceHint}>
          <span style={{ borderBottom: `1px dashed ${token.colorBorder}`, cursor: 'help' }}>{t('Mijozlar balansi')}</span>
        </Tooltip>
      ),
      dataIndex: 'outstandingDebt',
      key: 'outstandingDebt',
      align: 'right',
      render: (v: Money) => <BalanceTag balance={v ?? '0'} partyType="client" />,
    },
  ];

  const rows = q.data?.agents ?? [];

  return (
    <div style={{ ...cardShell(token, isPhone), height: '100%', minWidth: 0 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          rowGap: 8,
          flexWrap: 'wrap',
          marginBottom: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, minWidth: 0 }}>
          <span style={overline(token, token.colorTextSecondary)}>{t('Agentlar reytingi')}</span>
          <Link to="/agents" style={linkStyle(token)}>{t("To'liq →")}</Link>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, ...(isPhone ? { width: '100%' } : null) }}>
          <Button size="small" type="text" icon={<LeftOutlined />} aria-label={t('Oldingi oy')} onClick={prev} />
          <DatePicker
            picker="month"
            size="small"
            allowClear={false}
            value={dayjs(`${month}-01`)}
            format="YYYY-MM"
            disabledDate={(d) => d.isAfter(dayjs(), 'month')}
            onChange={(d) => d && setMonth(d.format('YYYY-MM'))}
            style={isPhone ? { flex: '1 1 0', minWidth: 0 } : undefined}
          />
          <Button size="small" type="text" icon={<RightOutlined />} aria-label={t('Keyingi oy')} disabled={atCurrent} onClick={next} />
        </div>
      </div>
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : isPhone ? (
        /* Telefonda 4 ustunli reyting 360px ga sig'maydi — DataTable'ning karta
           yo'li bilan bir xil `.sb-mcard*` primitivlarida ro'yxat sifatida
           chiqadi (Foundation shu sinflardan foydalanishga ruxsat bergan). */
        <div style={{ position: 'relative' }}>
          {q.isFetching && !q.isLoading ? <div className="refetch-hairline" /> : null}
          {q.isLoading ? (
            <Skeleton active paragraph={{ rows: 4 }} />
          ) : rows.length === 0 ? (
            <EmptyState message="Bu oyda ma'lumot yo'q" />
          ) : (
            <>
              <ul className="sb-mcards" style={{ padding: 0, margin: 0 }}>
                {rows.map((r) => (
                  <li
                    key={r.agentId}
                    className="sb-mcard sb-mcard--tappable"
                    role="button"
                    tabIndex={0}
                    onClick={() => navigate(`/agents/${r.agentId}`)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        navigate(`/agents/${r.agentId}`);
                      }
                    }}
                  >
                    <div className="sb-mcard__body">
                      <div className="sb-mcard__row">
                        <div className="sb-mcard__head">
                          <div className="sb-mcard__title">{r.agent}</div>
                        </div>
                        <div className="sb-mcard__value">
                          <MoneyCell value={r.sales} />
                        </div>
                      </div>
                      <div className="sb-mcard__meta">
                        <span className="sb-mcard__chip">
                          <em className="sb-mcard__chip-label">{t("Yig'ilgan")}</em> {fmtMoney(r.collected)}
                        </span>
                        <BalanceTag balance={r.outstandingDebt ?? '0'} partyType="client" />
                      </div>
                    </div>
                    <div className="sb-mcard__tail">
                      <RightOutlined className="sb-mcard__chevron" aria-hidden />
                    </div>
                  </li>
                ))}
              </ul>
              {/* R12: ustun sarlavhasidagi hover-ta'rif teginishda yo'qoladi */}
              <div style={{ marginTop: 8, fontSize: 11, lineHeight: '15px', color: token.colorTextTertiary }}>
                {balanceHint}
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="scroll-x" style={{ position: 'relative' }}>
          {q.isFetching && !q.isLoading ? <div className="refetch-hairline" /> : null}
          <Table<RankRow>
            rowKey="agentId"
            size="small"
            columns={columns}
            dataSource={rows}
            loading={q.isLoading}
            pagination={false}
            scroll={isDesktop ? undefined : { x: 'max-content' }}
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
  const isPhone = useIsPhone();
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
      <PageHeader title="Ish stoli" subtitle="Mening mijozlarim, qarzlar va yig'im" accent />
      {refetching ? <div className="refetch-hairline" /> : null}
      <div style={{ maxWidth: 760, margin: '0 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: isPhone ? 14 : 22 }}>
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
  const t = useT();
  const isPhone = useIsPhone();
  const usedHint = t("Band = mijozlaringizning musbat qoldiqlari yig'indisi. Bir mijozning avansi boshqasining qarzini yopmaydi.");
  const q = useQuery({
    queryKey: ['agent', 'me'],
    queryFn: async () => (await endpoints.agentMe()) as unknown as AgentMe,
  });
  const me = q.data;
  const lim = me ? (me.debtLimit == null ? null : num(me.debtLimit)) : null;
  // outstandingDebt is a NET balance and may be negative (clients in advance) — the limit
  // gauge measures DEBT only, so a net advance means zero limit used, never a negative %.
  const used = me ? Math.max(0, num(me.outstandingDebt)) : 0;
  const pct = lim && lim > 0 ? Math.round((used / lim) * 100) : null;
  const blocked = lim != null && lim > 0 && used >= lim;

  return (
    <div style={{ ...cardShell(token, isPhone), position: 'relative', minWidth: 0 }}>
      {q.isFetching && !q.isLoading ? <div className="refetch-hairline" /> : null}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, rowGap: 4, flexWrap: 'wrap', marginBottom: 10 }}>
        <span style={overline(token, token.colorTextSecondary)}>{t('Qarz limiti')}</span>
        {me ? (
          <Link to={`/agents/${me.id}`} style={linkStyle(token)}>
            {t("Mening ko'rsatkichlarim →")}
          </Link>
        ) : null}
      </div>
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.isLoading ? (
        <Skeleton active paragraph={{ rows: 2 }} />
      ) : me ? (
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            <span style={{ fontSize: 13, color: token.colorTextSecondary, minWidth: 0 }}>
              {me.name}
              {me.clientCount != null ? ` · ${fmtNum(me.clientCount)} ${t('mijoz')}` : ''}
            </span>
            {pct != null ? (
              <span className="num" style={{ fontSize: 20, fontWeight: 600, color: pct > 90 ? token.colorError : pct >= 60 ? token.colorWarning : token.colorText }}>
                {pct}%
              </span>
            ) : null}
          </div>
          {/* R12: teginishli ekranda hover-ta'rif o'qilmaydi — matn ko'rinadi */}
          {isPhone ? (
            <>
              <CreditGauge limit={me.debtLimit ?? null} used={me.outstandingDebt ?? '0'} />
              <div style={{ marginTop: 6, fontSize: 11, lineHeight: '15px', color: token.colorTextTertiary }}>{usedHint}</div>
            </>
          ) : (
            <Tooltip title={usedHint}>
              <div>
                <CreditGauge limit={me.debtLimit ?? null} used={me.outstandingDebt ?? '0'} />
              </div>
            </Tooltip>
          )}
          {blocked ? (
            <div style={{ marginTop: 8, fontSize: 12, fontWeight: 500, color: token.colorError }}>
              {t("Limit to'lgan — yangi qarzli buyurtma bloklanadi")}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function AgentKpis({ summary, d62 }: { summary?: SummaryResp; d62: Derived62 | null }) {
  const t = useT();
  const isPhone = useIsPhone();
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
      <div style={heroGrid(isPhone)}>
        <StatCard label="Oy savdosi" value={s.monthSales} icon={<RiseOutlined />} to={`/orders?from=${from}&to=${to}`} delta={monthDelta} sparkline={d62?.sparkSales} />
        <StatCard label="Bugungi savdo" value={s.todaySales} icon={<CalendarOutlined />} to={`/orders?from=${to}&to=${to}`} delta={todayDelta} />
        <StatCard
          label="Yig'ilgan to'lov (oy)"
          value={s.collectedThisMonth}
          variant="in"
          icon={<WalletOutlined />}
          to={`/payments?kind=client_in&from=${from}&to=${to}`}
          delta={collectedDelta}
          sparkline={d62?.sparkCollected}
        />
        {/* NET balance of my clients — unsigned with the word carrying the meaning, same
            rule as BalanceTag / the Agentlar page (qarz = red, avans = green). */}
        <StatCard
          label="Mijozlarim balansi"
          value={Math.abs(num(s.clientsOweUs))}
          variant={num(s.clientsOweUs) >= 1 ? 'owedToUs' : num(s.clientsOweUs) <= -1 ? 'in' : 'neutral'}
          note={num(s.clientsOweUs) >= 1 ? t('qarz') : num(s.clientsOweUs) <= -1 ? t('avans') : t('hisob yopiq')}
          icon={<TeamOutlined />}
          to="/debts?tab=mijozlar"
        />
      </div>
      <div className="sb-stat-strip">
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
  const t = useT();
  const isPhone = useIsPhone();
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
    <div style={{ ...cardShell(token, isPhone), position: 'relative', minWidth: 0 }}>
      {q.isFetching && !q.isLoading ? <div className="refetch-hairline" /> : null}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, rowGap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
        <span style={overline(token, token.colorTextSecondary)}>{t('14 kunlik trend')}</span>
        <Link to="/orders" style={linkStyle(token)}>{t('Buyurtmalar →')}</Link>
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
            height={isPhone ? 180 : 160}
            autoFit
            scale={{ color: { domain: [SERIES.sales, SERIES.collected], range: [colors.sales, colors.collected] } }}
            axis={{
              x: { title: false, labelFormatter: (d: string) => dayjs(d).format('DD.MM'), labelAutoHide: true },
              y: isPhone
                ? { title: false, labelFormatter: (v: number) => fmtShort(v), tickCount: 4 }
                : { title: false, labelFormatter: (v: number) => fmtShort(v) },
            }}
            legend={{ color: { position: isPhone ? 'bottom' : 'top' } }}
            style={{ lineWidth: 2 }}
            theme={mode === 'dark' ? { type: 'classicDark' as const } : { type: 'classic' as const }}
            tooltip={{ title: (d: { date: string }) => fmtDate(d.date), items: [{ channel: 'y', valueFormatter: (v: number) => fmtUZS(v) }] }}
          />
          <div style={{ fontSize: 12, color: token.colorTextSecondary, marginTop: 6 }}>
            Σ {t('savdo')} <b className="num">{fmtMoney(totals.sales)}</b> · Σ {t('tushum')} <b className="num">{fmtMoney(totals.collected)}</b> {t("so'm")}
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════ CASHIER ════════════════════════════════════

function CashierTerminal() {
  const navigate = useNavigate();
  const t = useT();
  const isPhone = useIsPhone();
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
    { label: t("To'lov qabul qilish"), kbd: 'T', onClick: () => setComposer('CLIENT_IN'), primary: true },
    { label: t("Zavodga to'lash"), onClick: () => setComposer('FACTORY_OUT') },
    { label: t("Shofyorga to'lash"), onClick: () => setComposer('VEHICLE_OUT') },
  ];

  return (
    <div>
      <PageHeader title="Kassa terminali" subtitle="Tez kassa amallari va to'lovlar" accent />
      <div style={{ display: 'flex', flexDirection: 'column', gap: isPhone ? 14 : 20 }}>
        {/* R19: klaviatura yorlig'i telefonda ko'rsatilmaydi; tugmalar esa
            barmoq uchun butun kenglikda va >= 44px balandlikda. */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {intents.map((it) => (
            <Button
              key={it.label}
              type={it.primary ? 'primary' : 'default'}
              onClick={it.onClick}
              block={isPhone}
              style={{ height: isPhone ? 44 : 40 }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                {it.label}
                {it.kbd && !isPhone ? <KbdHint>{it.kbd}</KbdHint> : null}
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
  const t = useT();
  const isPhone = useIsPhone();
  const balanceHint = t('Butun davr: Σ kirim − Σ chiqim');
  const q = useQuery({
    queryKey: ['dashboard', 'kassa'],
    queryFn: async () => (await endpoints.kassaDashboard()) as KassaBox[],
  });
  const boxes = q.data ?? [];

  const cardBody = (b: KassaBox) => (
    <Link
      to={`/kassa?cashboxId=${b.cashboxId}`}
      style={{ ...cardShell(token, isPhone), display: 'block', minWidth: 0, textDecoration: 'none', color: 'inherit' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8, minWidth: 0 }}>
        <span style={{ fontWeight: 600, color: token.colorText, minWidth: 0 }}>{b.name}</span>
        <StatusChip meta={CASHBOX_TYPE[b.type]} />
      </div>
      <div style={{ fontSize: 20, minWidth: 0 }}>
        <CcyAmount value={b.balance} currency={b.currency} size={20} suffix={b.currency === 'UZS' ? t("so'm") : undefined} />
      </div>
      <div style={{ marginTop: 8 }}>
        <FlowLine box={b} />
      </div>
    </Link>
  );

  return (
    <div style={{ position: 'relative' }}>
      {q.isFetching && !q.isLoading ? <div className="refetch-hairline" /> : null}
      <div style={{ ...overline(token, token.colorTextSecondary), marginBottom: 8 }}>{t('Kassalar')}</div>
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.isLoading ? (
        <div style={heroGrid(isPhone)}>
          {[0, 1, 2, 3].map((i) => (
            <SkeletonStat key={i} />
          ))}
        </div>
      ) : boxes.length === 0 ? (
        <div style={cardShell(token, isPhone)}>
          <EmptyState message="Faol kassalar topilmadi" />
        </div>
      ) : (
        <>
          <div style={{ marginBottom: 10, fontSize: 13 }}>{totalsLine(boxes, token)}</div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(auto-fill, minmax(${isPhone ? 180 : 200}px, 1fr))`,
              gap: isPhone ? 10 : 12,
            }}
          >
            {/* R12: telefonda balans ta'rifi tooltipda qolsa umuman ko'rinmaydi
                (hover yo'q) va Tooltip o'rami kartaga teginishni ham to'sadi —
                shuning uchun u gridning ostida bir marta matn bo'lib chiqadi. */}
            {boxes.map((b) =>
              isPhone ? (
                <div key={b.cashboxId} style={{ minWidth: 0 }}>{cardBody(b)}</div>
              ) : (
                <Tooltip key={b.cashboxId} title={balanceHint}>
                  {cardBody(b)}
                </Tooltip>
              ),
            )}
          </div>
          {isPhone ? (
            <div style={{ marginTop: 8, fontSize: 11, lineHeight: '15px', color: token.colorTextTertiary }}>{balanceHint}</div>
          ) : null}
        </>
      )}
    </div>
  );
}

/** Hujjat nomi — sof matn. Telefon kartasining sarlavhasi shu yerdan oladi. */
function docText(r: KassaTxRow): string {
  if (r.payment) {
    const party = r.payment.client?.name ?? r.payment.factory?.name ?? r.payment.vehicle?.name ?? '';
    return `${PAYMENT_KIND[r.payment.kind]?.label ?? translate("To'lov")}${party ? ' — ' + party : ''}`;
  }
  if (r.expense) return `${translate('Xarajat')}${r.expense.category?.name ? ' — ' + r.expense.category.name : ''}`;
  if (r.bonusTransaction) return `${translate('Bonus')}${r.bonusTransaction.factory?.name ? ' — ' + r.bonusTransaction.factory.name : ''}`;
  if (r.source === 'REVERSAL' || r.reversalOf) return translate('Storno');
  if (r.source === 'MANUAL') return translate("Qo'lda kiritilgan");
  return '—';
}

function docLabel(r: KassaTxRow, onPeek: (id: string) => void): ReactNode {
  const label = docText(r);
  if (r.payment) {
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
  return label;
}

function TodayFeed({ onPeek }: { onPeek: (id: string) => void }) {
  const { token } = theme.useToken();
  const t = useT();
  const isPhone = useIsPhone();
  const isDesktop = useIsDesktop();
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

  // Satr amallari — jadval ustunida ham, telefon kartasining `__tail`ida ham
  // aynan shu menyu ishlatiladi (xarajat/bonus satrlari uchun yagona amal).
  const rowKebab = (r: KassaTxRow) => {
    const items: MenuProps['items'] = [];
    if (r.payment && !r.payment.voidedAt) items.push({ key: 'receipt', icon: <PrinterOutlined />, label: t('Kvitansiya') });
    items.push({ key: 'open', label: t('Hujjatni ochish') });
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
        <Button type="text" size="small" icon={<MoreOutlined />} aria-label={t('Amallar')} onClick={(e) => e.stopPropagation()} />
      </Dropdown>
    );
  };

  const columns: TableColumnsType<KassaTxRow> = [
    {
      title: t('Vaqt'),
      dataIndex: 'date',
      key: 'date',
      width: 64,
      // R12: to'liq sana faqat hover-tooltipda edi. Lenta bugungi kunga bog'langani
      // uchun telefonda sana bir marta sarlavhada ko'rinadi, tooltip esa olib
      // tashlanadi (teginishda u satr bosilishini "yeb" qo'yardi).
      render: (v: string) =>
        isPhone ? (
          <span className="num">{dayjs(v).format('HH:mm')}</span>
        ) : (
          <Tooltip title={dayjs(v).format('DD.MM.YYYY HH:mm')}>
            <span className="num">{dayjs(v).format('HH:mm')}</span>
          </Tooltip>
        ),
    },
    { title: t('Kassa'), key: 'box', render: (_: unknown, r) => r.cashbox?.name ?? '—' },
    {
      title: t("Yo'nalish"),
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
    { title: t('Hujjat'), key: 'doc', render: (_: unknown, r) => docLabel(r, onPeek) },
    { title: t('Kim'), key: 'who', width: 120, render: (_: unknown, r) => r.createdBy?.name ?? '—' },
    {
      title: '',
      key: 'kebab',
      // telefonda ikonkali tugma 44x44 ga kengayadi — ustun ham shunga mos
      width: isPhone ? 56 : 44,
      render: (_: unknown, r) => rowKebab(r),
    },
  ];

  return (
    <div style={{ ...cardShell(token, isPhone), minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, rowGap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
        <span style={overline(token, token.colorTextSecondary)}>{t('Bugungi amallar')}</span>
        {isPhone ? (
          <span className="num" style={{ fontSize: 12, color: token.colorTextTertiary }}>{fmtDate(today)}</span>
        ) : null}
        <Link to="/kassa" style={linkStyle(token)}>{t('Hammasi →')}</Link>
      </div>
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : isPhone ? (
        /* Telefonda 6 ustunli lenta 360px ga sig'maydi: summa o'ngga surilib,
           satrni tanituvchi vaqt/kassa ekrandan chiqib ketardi, kebab esa —
           xarajat va bonus satrlarining yagona amali — umuman yetib bo'lmasdi.
           Reyting jadvali kabi `.sb-mcard*` primitivlarida karta ro'yxati. */
        <div style={{ position: 'relative' }}>
          {q.isFetching && !q.isLoading ? <div className="refetch-hairline" /> : null}
          {q.isLoading ? (
            <Skeleton active paragraph={{ rows: 4 }} />
          ) : rows.length === 0 ? (
            <EmptyState message="Bugun hali amal yo'q" />
          ) : (
            <ul className="sb-mcards" style={{ padding: 0, margin: 0 }}>
              {rows.map((r) => {
                const openable = !!r.payment;
                const open = () => {
                  if (r.payment) onPeek(r.payment.id);
                };
                return (
                  <li
                    key={r.id}
                    className={[
                      'sb-mcard',
                      openable ? 'sb-mcard--tappable' : '',
                      isGhost(r) ? 'sb-mcard--ghost' : '',
                      pulseIds.has(r.id) ? 'pulse-row' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    role={openable ? 'button' : undefined}
                    tabIndex={openable ? 0 : undefined}
                    onClick={openable ? open : undefined}
                    onKeyDown={
                      openable
                        ? (e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              open();
                            }
                          }
                        : undefined
                    }
                  >
                    <div className="sb-mcard__body">
                      <div className="sb-mcard__row">
                        <div className="sb-mcard__head">
                          <div className="sb-mcard__title">{docText(r)}</div>
                          <div className="sb-mcard__subtitle">
                            <span>{r.cashbox?.name ?? '—'}</span>
                          </div>
                        </div>
                        <div className="sb-mcard__value">
                          <MoneyCell
                            value={r.direction === 'IN' ? num(r.amount) : -num(r.amount)}
                            variant={isGhost(r) ? 'ghost' : r.direction === 'IN' ? 'in' : 'neutral'}
                            signed
                          />
                        </div>
                      </div>
                      <div className="sb-mcard__meta">
                        <span className="sb-mcard__chip num">{dayjs(r.date).format('HH:mm')}</span>
                        <StatusChip meta={CASH_DIRECTION[r.direction]} />
                        <span className="sb-mcard__chip">
                          <em className="sb-mcard__chip-label">{t('Kim')}</em> {r.createdBy?.name ?? '—'}
                        </span>
                      </div>
                    </div>
                    <div className="sb-mcard__tail">{rowKebab(r)}</div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
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
            scroll={isDesktop ? undefined : { x: 'max-content' }}
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
  const t = useT();
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 500, color: token.colorText, marginBottom: 4 }}>{t(label)}</div>
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
