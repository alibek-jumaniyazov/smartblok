// WorklistCard + InboxRail (04 §3.4, 03 §6) — the cockpit engine: finite,
// countable queues that go to zero.
//
// WorklistCard: overline title + live count (aria-live) + Σ where money-shaped
// + top-3 preview rows (party · figure · age; click opens the record) +
// «Hammasi →» drill link. The count badge is coloured by queue severity
// (danger / violet / warning / neutral). Client-derived queues show their
// window label on the footer.
//
// InboxRail («Eʼtibor kerak»): 2-column masonry (desktop) / 1-column (mobile),
// ORDER FIXED BY SEVERITY (not configurable). Zero-count cards collapse into a
// single green «Toza ✓» strip at the bottom — a clean day is visibly clean.
import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { Skeleton, theme } from 'antd';
import { fmtNum } from '../lib/format';
import { hexToRgba } from '../lib/tint';
import { MoneyCell } from './MoneyCell';
import type {
  QueueSeverity,
  WorklistPreview,
  WorklistResult,
} from '../lib/worklists';

// ── severity → ink + 12%-tint fill (violet via the reserved --sb-* var) ──────

interface SeverityInk {
  ink: string;
  fill: string;
}

function useSeverityInk(): (sev: QueueSeverity) => SeverityInk {
  const { token } = theme.useToken();
  return (sev) => {
    switch (sev) {
      case 'danger':
        return { ink: token.colorError, fill: hexToRgba(token.colorError, 0.12) };
      case 'warning':
        return { ink: token.colorWarning, fill: hexToRgba(token.colorWarning, 0.12) };
      case 'violet':
        return { ink: 'var(--sb-violet)', fill: 'var(--sb-violet-fill)' };
      case 'neutral':
      default:
        return { ink: token.colorTextSecondary, fill: token.colorFillTertiary };
    }
  };
}

// ── WorklistCard ─────────────────────────────────────────────────────────────

export interface WorklistCardProps {
  title: string;
  count: number;
  severity: QueueSeverity;
  /** Σ where the queue is money-shaped */
  sum?: number;
  /** Σ where the queue is in-kind (dona) */
  sumQty?: number;
  /** top-3 preview rows */
  top3: WorklistPreview[];
  /** «Hammasi →» filtered register URL */
  drillTo: string;
  /** client-derived scan window label (footer) */
  window?: string;
  /** honest-degradation note (e.g. capped scan) */
  note?: string;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  /** LiveBadge-popover variant — drops the top-3 preview, tighter padding */
  compact?: boolean;
  className?: string;
  style?: CSSProperties;
}

export function WorklistCard({
  title,
  count,
  severity,
  sum,
  sumQty,
  top3,
  drillTo,
  window: windowLabel,
  note,
  isLoading = false,
  isError = false,
  onRetry,
  compact = false,
  className,
  style,
}: WorklistCardProps) {
  const { token } = theme.useToken();
  const inkFor = useSeverityInk();
  const { ink, fill } = inkFor(severity);

  const shell: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: compact ? 8 : 12,
    padding: compact ? 12 : 16,
    borderRadius: token.borderRadiusLG,
    border: `1px solid ${token.colorBorderSecondary}`,
    background: token.colorBgContainer,
    ...style,
  };

  // overline title
  const header = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <span
        style={{
          fontSize: 11,
          lineHeight: '16px',
          fontWeight: 600,
          letterSpacing: '0.06em',
          color: token.colorTextSecondary,
        }}
      >
        {title}
      </span>
      {!isLoading && !isError ? (
        <span
          aria-live="polite"
          aria-label={`${title}: ${count} ta`}
          style={{
            padding: '0 8px',
            height: 20,
            display: 'inline-flex',
            alignItems: 'center',
            borderRadius: token.borderRadiusSM,
            background: fill,
            color: ink,
            fontSize: 12,
            fontWeight: 600,
            fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'nowrap',
          }}
        >
          {fmtNum(count)} ta
        </span>
      ) : null}
    </div>
  );

  if (isLoading) {
    return (
      <div className={className} style={shell}>
        {header}
        <Skeleton active paragraph={{ rows: compact ? 1 : 3 }} title={false} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className={className} style={shell}>
        {header}
        <div style={{ fontSize: 13, color: token.colorError }}>Xatolik yuz berdi</div>
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            style={{
              alignSelf: 'flex-start',
              background: 'transparent',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              color: token.colorLink,
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            Qayta urinish
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className={className} style={shell}>
      {header}

      {/* count · Σ (money-shaped) or · N dona (in-kind) */}
      {sum != null || sumQty != null ? (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
          {sum != null ? (
            <MoneyCell value={sum} variant="neutral" strong style={{ fontSize: 16, lineHeight: '22px' }} />
          ) : null}
          {sumQty != null ? (
            <span
              className="num"
              style={{ fontSize: 16, lineHeight: '22px', fontWeight: 600, color: token.colorText }}
            >
              {fmtNum(sumQty)} dona
            </span>
          ) : null}
        </div>
      ) : null}

      {/* top-3 preview */}
      {!compact && top3.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {top3.map((row) => (
            <PreviewRow key={row.id} row={row} />
          ))}
        </div>
      ) : null}

      {!compact && count > 0 && top3.length === 0 ? (
        <div style={{ fontSize: 12, color: token.colorTextTertiary }}>Koʼrib chiqish uchun oching</div>
      ) : null}

      {note ? (
        <div style={{ fontSize: 11, lineHeight: '16px', color: token.colorTextTertiary }}>{note}</div>
      ) : null}

      {/* footer: drill link + window label */}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 8,
          marginTop: 'auto',
          paddingTop: 4,
        }}
      >
        <Link
          to={drillTo}
          style={{ fontSize: 13, fontWeight: 500, color: token.colorLink, textDecoration: 'none' }}
        >
          Hammasi →
        </Link>
        {windowLabel ? (
          <span style={{ fontSize: 11, color: token.colorTextTertiary, textAlign: 'right' }}>
            oyna: {windowLabel}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function PreviewRow({ row }: { row: WorklistPreview }) {
  const { token } = theme.useToken();
  return (
    <Link
      to={row.to}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        padding: '6px 8px',
        margin: '0 -8px',
        borderRadius: token.borderRadiusSM,
        color: 'inherit',
        textDecoration: 'none',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = token.colorFillTertiary)}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <span
          style={{
            fontSize: 13,
            color: token.colorText,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {row.title}
        </span>
        {row.meta ? (
          <span style={{ fontSize: 11, color: token.colorTextTertiary }}>{row.meta}</span>
        ) : null}
      </span>
      {row.amount != null ? (
        <MoneyCell value={row.amount} variant={row.moneyVariant ?? 'neutral'} style={{ fontSize: 13 }} />
      ) : row.qty != null ? (
        <span className="num" style={{ fontSize: 13, color: token.colorText, whiteSpace: 'nowrap' }}>
          {fmtNum(row.qty)} dona
        </span>
      ) : null}
    </Link>
  );
}

// ── InboxRail ─────────────────────────────────────────────────────────────────

const SEVERITY_RANK: Record<QueueSeverity, number> = {
  danger: 0,
  violet: 1,
  warning: 2,
  neutral: 3,
};

export interface InboxRailProps {
  /** the queue results (order is re-fixed by severity here, defensively) */
  queues: WorklistResult[];
  /** compact variant for the LiveBadge popover (single column, no previews) */
  compact?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** InboxRail — «Eʼtibor kerak»: severity-ordered WorklistCards + a clean strip. */
export function InboxRail({ queues, compact = false, className, style }: InboxRailProps) {
  const { token } = theme.useToken();

  // fixed severity order (input order preserved within a tier) — never configurable
  const ordered = queues
    .map((q, i) => ({ q, i }))
    .sort((a, b) => SEVERITY_RANK[a.q.severity] - SEVERITY_RANK[b.q.severity] || a.i - b.i)
    .map((x) => x.q);

  const active = ordered.filter((q) => q.isLoading || q.isError || q.count > 0);
  const clean = ordered.filter((q) => !q.isLoading && !q.isError && q.count === 0);

  return (
    <section className={className} style={{ display: 'flex', flexDirection: 'column', gap: 12, ...style }}>
      <span
        style={{
          fontSize: 16,
          lineHeight: '24px',
          fontWeight: 600,
          color: token.colorText,
        }}
      >
        Eʼtibor kerak
      </span>

      {active.length > 0 ? (
        <div
          style={
            compact
              ? { display: 'flex', flexDirection: 'column', gap: 12 }
              : // CSS multi-column masonry: ~2 cols on desktop, 1 col on mobile,
                // no media query needed (columnWidth adapts to the container)
                { columnWidth: 320, columnGap: 16 }
          }
        >
          {active.map((q) => (
            <div
              key={q.key}
              style={compact ? undefined : { breakInside: 'avoid', marginBottom: 16 }}
            >
              <WorklistCard
                title={q.title}
                count={q.count}
                severity={q.severity}
                sum={q.sum}
                sumQty={q.sumQty}
                top3={q.top3}
                drillTo={q.drillTo}
                window={q.window}
                note={q.note}
                isLoading={q.isLoading}
                isError={q.isError}
                onRetry={q.refetch}
                compact={compact}
              />
            </div>
          ))}
        </div>
      ) : null}

      {clean.length > 0 ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 12px',
            borderRadius: token.borderRadiusLG,
            background: hexToRgba(token.colorSuccess, 0.1),
            color: token.colorSuccess,
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          <span aria-hidden style={{ fontWeight: 700 }}>
            ✓
          </span>
          <span style={{ color: token.colorText }}>
            {active.length === 0
              ? "Hammasi toza — eʼtibor talab qiladigan navbat yoʼq"
              : `Toza: ${clean.map((q) => q.title).join(' · ')}`}
          </span>
        </div>
      ) : null}
    </section>
  );
}
