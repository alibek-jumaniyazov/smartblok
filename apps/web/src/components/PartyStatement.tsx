// PartyStatement (04 §2.4) — the flagship money surface: a statement is a story.
// Doubles verbatim as the akt-sverki print body (05 §6). Self-contained: fetches
// its own ledger window keyed by party type, so it drops into ClientDetail,
// FactoryDetail, VehicleDetail, the Debts statement peek, and the /print routes.
//
// Data source per party type (endpoint-verified against apps/api):
//   • client  → GET /debts/statement?account=CLIENT&partyId&from&to
//               (server windows: openingBalance / entries[].running / closingBalance)
//   • factory → GET /factories/:id  → .statement (full history, running absolute)
//   • vehicle → GET /vehicles/:id    → .statement (full history, running absolute)
//     factory/vehicle windows are derived CLIENT-SIDE (the endpoint doesn't window);
//     the absolute running each row already carries is the true balance-after-row.
//
// Query keys are entity-name-first (realtime.ts contract): ['debts', …] for the
// client statement, ['factories', id] / ['vehicles', id] for the detail payloads —
// the SAME keys the party pages use, so react-query dedups and socket invalidation
// (payment/order/bonus/pallet events) reaches this surface for free.
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Skeleton, theme } from 'antd';
import { RollbackOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { endpoints } from '../lib/api';
import { LEDGER_SOURCE, PAYMENT_KIND, UNRECONCILED, type LedgerSource } from '../lib/status-maps';
import { fmtDate, num } from '../lib/format';
import { hexToRgba } from '../lib/tint';
import { MoneyCell, type MoneyVariant } from './MoneyCell';
import { BalanceTag, type PartyType } from './BalanceTag';
import { StatusChip } from './StatusChip';
import { ErrorState } from './EmptyState';
import type { Money, PaymentKind, PaymentMethod } from '../lib/types';

// ── Uzbek month names for the sticky month separators ───────────────────────
const UZ_MONTHS = [
  'Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun',
  'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr',
];

/** One normalized ledger row — the shape both data sources reduce to. */
interface StmtRow {
  id: string;
  date: string;
  source: LedgerSource | string;
  amount: Money;
  running: Money;
  note?: string | null;
  orderId?: string | null;
  order?: { orderNo: string } | null;
  /** `reconciled` is not in the current statement payload — guarded, lights up if added. */
  payment?: { kind: PaymentKind; method?: PaymentMethod; reconciled?: boolean } | null;
  /** set when this row is a storno OF another entry (chain partner = that id). */
  reversalOfId?: string | null;
}

interface NormalizedStatement {
  opening: Money;
  closing: Money;
  rows: StmtRow[];
  /** pinned-row date labels: window bounds, or the first/last entry date. */
  fromLabel?: string;
  toLabel?: string;
}

export interface PartyStatementProps {
  partyType: PartyType;
  partyId: string;
  /** YYYY-MM-DD window start (inclusive); omit for full history */
  from?: string;
  /** YYYY-MM-DD window end (inclusive) */
  to?: string;
  /** print body: drop sticky/hover chrome so the sheet flows (05 §6) */
  printMode?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** Statement amount ink: charges that worsen our position vs money that improves it. */
function amountVariant(pt: PartyType, amount: number): MoneyVariant {
  if (amount === 0) return 'neutral';
  if (pt === 'client') return amount > 0 ? 'owedToUs' : 'in'; // +debt vs collection
  return amount < 0 ? 'weOwe' : 'in'; // factory/vehicle: −liability vs credit
}

export function PartyStatement({
  partyType,
  partyId,
  from,
  to,
  printMode = false,
  className,
  style,
}: PartyStatementProps) {
  const { token } = theme.useToken();
  const [hoverPair, setHoverPair] = useState<string | null>(null);

  const isClient = partyType === 'client';

  // client: server-windowed statement (openingBalance / running / closingBalance).
  const clientQ = useQuery({
    queryKey: ['debts', 'statement', 'CLIENT', partyId, from ?? '', to ?? ''],
    queryFn: () => endpoints.debtsStatement({ account: 'CLIENT', partyId, from, to }),
    enabled: !!partyId && isClient,
  });

  // factory/vehicle: full-history detail payload — windowed client-side below.
  const detailQ = useQuery({
    queryKey: [partyType === 'factory' ? 'factories' : 'vehicles', partyId],
    queryFn: () => (partyType === 'factory' ? endpoints.factory(partyId) : endpoints.vehicle(partyId)),
    enabled: !!partyId && !isClient,
  });

  const activeQ = isClient ? clientQ : detailQ;

  const normalized = useMemo<NormalizedStatement | null>(() => {
    if (isClient) {
      const d = clientQ.data as
        | { openingBalance: Money; entries: StmtRow[]; closingBalance: Money }
        | undefined;
      if (!d) return null;
      const rows = d.entries ?? [];
      return {
        opening: d.openingBalance ?? '0',
        closing: d.closingBalance ?? d.openingBalance ?? '0',
        rows,
        fromLabel: from ?? rows[0]?.date,
        toLabel: to ?? rows[rows.length - 1]?.date,
      };
    }

    const d = detailQ.data as { statement?: StmtRow[] } | undefined;
    if (!d) return null;
    const all = (d.statement ?? []) as StmtRow[]; // ordered date asc (ledger.statement)

    const fromD = from ? dayjs(from).startOf('day') : null;
    const toD = to ? dayjs(to).endOf('day') : null;

    const rows = all.filter((e) => {
      const t = dayjs(e.date);
      if (fromD && t.isBefore(fromD)) return false;
      if (toD && t.isAfter(toD)) return false;
      return true;
    });

    // opening = the running balance of the last entry BEFORE the window (or 0).
    let opening = 0;
    if (fromD) {
      const before = all.filter((e) => dayjs(e.date).isBefore(fromD));
      opening = before.length ? num(before[before.length - 1].running) : 0;
    }
    const closing = rows.length ? num(rows[rows.length - 1].running) : opening;

    return {
      opening: String(opening),
      closing: String(closing),
      rows,
      fromLabel: from ?? all[0]?.date,
      toLabel: to ?? all[all.length - 1]?.date,
    };
  }, [isClient, clientQ.data, detailQ.data, from, to]);

  // Reversal pairing: a storno row carries reversalOfId; its original is the row
  // whose id equals that. Both share pairId = original.id (hover highlights both).
  const reversedOriginalIds = useMemo(() => {
    const s = new Set<string>();
    for (const r of normalized?.rows ?? []) if (r.reversalOfId) s.add(r.reversalOfId);
    return s;
  }, [normalized]);

  const pairIdOf = (r: StmtRow): string | null => {
    if (r.reversalOfId) return r.reversalOfId;
    if (reversedOriginalIds.has(r.id)) return r.id;
    return null;
  };

  // ── states ──────────────────────────────────────────────────────────────
  if (activeQ.isLoading || (!normalized && activeQ.isFetching)) {
    return (
      <div className={className} style={style}>
        <Skeleton active title={false} paragraph={{ rows: 6, width: ['100%', '100%', '100%', '100%', '100%', '100%'] }} />
      </div>
    );
  }
  if (activeQ.error) {
    return (
      <div className={className} style={style}>
        <ErrorState error={activeQ.error} onRetry={() => activeQ.refetch()} message="Hisob-kitobni yuklab bo'lmadi" />
      </div>
    );
  }
  if (!normalized) return null;

  const th: CSSProperties = {
    textAlign: 'left',
    padding: '6px 10px',
    fontSize: 12,
    fontWeight: 500,
    color: token.colorTextSecondary,
    borderBottom: `1px solid ${token.colorBorderSecondary}`,
    whiteSpace: 'nowrap',
  };
  const td: CSSProperties = {
    padding: '7px 10px',
    borderBottom: `1px solid ${hexToRgba(token.colorBorderSecondary, 0.6)}`,
    verticalAlign: 'top',
  };

  const pinnedRow = (label: string, dateLabel: string | undefined, balance: Money, key: string): ReactNode => (
    <tr key={key} style={{ background: token.colorFillQuaternary }}>
      <td style={{ ...td, borderBottom: 'none' }} aria-hidden />
      <td style={{ ...td, borderBottom: 'none', color: token.colorTextSecondary, whiteSpace: 'nowrap' }} colSpan={2}>
        <span style={{ fontWeight: 600, color: token.colorText }}>{label}</span>
        {dateLabel ? <span> · {fmtDate(dateLabel)}</span> : null}
      </td>
      <td style={{ ...td, borderBottom: 'none' }} aria-hidden />
      <td style={{ ...td, borderBottom: 'none', textAlign: 'right' }}>
        <BalanceTag balance={balance} partyType={partyType} compact />
      </td>
    </tr>
  );

  // ── body: month separators + entry rows ───────────────────────────────────
  const body: ReactNode[] = [];
  let lastMonth = '';
  normalized.rows.forEach((r, idx) => {
    const mk = dayjs(r.date).format('YYYY-MM');
    if (mk !== lastMonth) {
      lastMonth = mk;
      const md = dayjs(r.date);
      body.push(
        <tr key={`m-${mk}`}>
          <td
            colSpan={5}
            style={{
              padding: '4px 10px',
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: 0.3,
              textTransform: 'uppercase',
              color: token.colorTextTertiary,
              background: token.colorBgLayout,
              borderBottom: `1px solid ${hexToRgba(token.colorBorderSecondary, 0.6)}`,
              position: printMode ? undefined : 'sticky',
              top: printMode ? undefined : 0,
              zIndex: 1,
            }}
          >
            {UZ_MONTHS[md.month()]} {md.year()}
          </td>
        </tr>,
      );
    }

    const pid = pairIdOf(r);
    const isStorno = pid != null;
    const amt = num(r.amount);
    const sourceLabel = LEDGER_SOURCE[r.source as LedgerSource]?.label ?? String(r.source);
    const transportDirect = r.payment?.kind === 'TRANSPORT_DIRECT';
    const unreconciled = r.payment?.reconciled === false;
    const highlighted = !printMode && hoverPair != null && hoverPair === pid;
    const zebra = idx % 2 === 1;

    const rowBg = highlighted
      ? token.colorFillSecondary
      : zebra
        ? hexToRgba(token.colorFillQuaternary, 0.5)
        : undefined;

    body.push(
      <tr
        key={r.id}
        className="num"
        onMouseEnter={pid && !printMode ? () => setHoverPair(pid) : undefined}
        onMouseLeave={pid && !printMode ? () => setHoverPair(null) : undefined}
        style={{ background: rowBg, transition: printMode ? undefined : 'background 120ms' }}
      >
        {/* left gutter — reversal chain connector + glyph */}
        <td
          style={{
            ...td,
            width: 24,
            textAlign: 'center',
            color: token.colorTextTertiary,
            borderLeft: isStorno ? `2px solid ${hexToRgba(token.colorTextTertiary, 0.5)}` : '2px solid transparent',
          }}
          aria-hidden={!isStorno}
        >
          {isStorno ? <RollbackOutlined style={{ fontSize: 12 }} /> : null}
        </td>

        {/* date */}
        <td style={{ ...td, whiteSpace: 'nowrap', color: token.colorTextSecondary }}>{fmtDate(r.date)}</td>

        {/* description: source label + document link + note + chips */}
        <td style={{ ...td, minWidth: 220 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ color: token.colorText }}>{sourceLabel}</span>
            {r.order?.orderNo ? (
              r.orderId ? (
                <Link to={`/orders/${r.orderId}`} style={{ fontWeight: 500 }}>
                  {r.order.orderNo}
                </Link>
              ) : (
                <span style={{ fontWeight: 500 }}>{r.order.orderNo}</span>
              )
            ) : r.payment ? (
              <span style={{ color: token.colorTextSecondary }}>
                {PAYMENT_KIND[r.payment.kind]?.label ?? r.payment.kind}
              </span>
            ) : null}
            {isStorno ? (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  padding: '0 6px',
                  borderRadius: token.borderRadiusSM,
                  color: token.colorTextTertiary,
                  background: hexToRgba(token.colorTextTertiary, 0.12),
                }}
              >
                storno
              </span>
            ) : null}
            {unreconciled ? <StatusChip meta={UNRECONCILED} /> : null}
          </div>
          {transportDirect ? (
            <div style={{ fontSize: 12, color: token.colorTextTertiary, marginTop: 2 }}>
              Mijoz shofyorga to'ladi — mijoz krediti + shofyor hisobi yopildi
            </div>
          ) : null}
          {r.note ? (
            <div style={{ fontSize: 12, color: token.colorTextSecondary, marginTop: 2 }}>{r.note}</div>
          ) : null}
        </td>

        {/* signed amount, semantic ink */}
        <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
          <MoneyCell value={r.amount} signed variant={amountVariant(partyType, amt)} />
        </td>

        {/* running balance — semantic (BalanceTag phrasing) */}
        <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
          <BalanceTag balance={r.running} partyType={partyType} compact />
        </td>
      </tr>,
    );
  });

  return (
    <div className={className} style={{ overflowX: 'auto', ...style }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            <th style={{ ...th, width: 24 }} aria-hidden />
            <th style={{ ...th }}>Sana</th>
            <th style={{ ...th }}>Tavsif</th>
            <th style={{ ...th, textAlign: 'right' }}>Summa (so'm)</th>
            <th style={{ ...th, textAlign: 'right' }}>Qoldiq</th>
          </tr>
        </thead>
        <tbody>
          {pinnedRow("Boshlang'ich qoldiq", normalized.fromLabel, normalized.opening, 'opening')}
          {body}
          {pinnedRow('Yakuniy qoldiq', normalized.toLabel, normalized.closing, 'closing')}
        </tbody>
      </table>
    </div>
  );
}
