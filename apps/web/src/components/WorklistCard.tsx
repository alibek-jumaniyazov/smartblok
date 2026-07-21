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
import { useIsPhone, useIsTouch, TOUCH_MIN } from '../lib/responsive';
import { MoneyCell } from './MoneyCell';
import { useT } from './LangContext';
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
  const t = useT();
  const isPhone = useIsPhone();
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
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', rowGap: 4 }}>
      <span
        style={{
          fontSize: 11,
          lineHeight: '16px',
          fontWeight: 600,
          letterSpacing: '0.06em',
          color: token.colorTextSecondary,
          minWidth: 0,
        }}
      >
        {t(title)}
      </span>
      {!isLoading && !isError ? (
        <span
          aria-live="polite"
          aria-label={`${t(title)}: ${count} ${t('ta')}`}
          style={{
            flex: '0 0 auto',
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
          {fmtNum(count)} {t('ta')}
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
        <div style={{ fontSize: 13, color: token.colorError }}>{t('Xatolik yuz berdi')}</div>
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            style={{
              alignSelf: 'flex-start',
              background: 'transparent',
              border: 'none',
              // telefonda barmoq uchun 44px — desktopda o'lchamlar tegilmaydi
              padding: isPhone ? '0 8px' : 0,
              marginInlineStart: isPhone ? -8 : 0,
              minHeight: isPhone ? TOUCH_MIN : undefined,
              cursor: 'pointer',
              color: token.colorLink,
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            {t('Qayta urinish')}
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
              {fmtNum(sumQty)} {t('dona')}
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
        <div style={{ fontSize: 12, color: token.colorTextTertiary }}>{t('Koʼrib chiqish uchun oching')}</div>
      ) : null}

      {note ? (
        <div style={{ fontSize: 11, lineHeight: '16px', color: token.colorTextTertiary }}>{t(note)}</div>
      ) : null}

      {/* footer: drill link + window label */}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 8,
          rowGap: 4,
          flexWrap: 'wrap',
          marginTop: 'auto',
          paddingTop: 4,
        }}
      >
        <Link
          to={drillTo}
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: token.colorLink,
            textDecoration: 'none',
            // «Hammasi →» kartaning yagona chiqish yo'li — telefonda 44px
            ...(isPhone
              ? { display: 'inline-flex', alignItems: 'center', minHeight: TOUCH_MIN, marginInlineStart: -8, paddingInline: 8 }
              : null),
          }}
        >
          {t('Hammasi →')}
        </Link>
        {windowLabel ? (
          <span style={{ fontSize: 11, color: token.colorTextTertiary, textAlign: 'right', minWidth: 0 }}>
            {t('oyna')}: {t(windowLabel)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function PreviewRow({ row }: { row: WorklistPreview }) {
  const { token } = theme.useToken();
  const t = useT();
  const isPhone = useIsPhone();
  // teginishda hover fon bir marta yopishib qoladi (JS bilan qo'yilgani uchun
  // `@media (hover)` ham qutqarmaydi) — shuning uchun umuman bog'lanmaydi.
  const isTouch = useIsTouch();
  return (
    <Link
      to={row.to}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        padding: isPhone ? '10px 8px' : '6px 8px',
        minHeight: isPhone ? TOUCH_MIN : undefined,
        margin: '0 -8px',
        borderRadius: token.borderRadiusSM,
        color: 'inherit',
        textDecoration: 'none',
      }}
      onMouseEnter={isTouch ? undefined : (e) => (e.currentTarget.style.background = token.colorFillTertiary)}
      onMouseLeave={isTouch ? undefined : (e) => (e.currentTarget.style.background = 'transparent')}
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
          <span style={{ fontSize: 11, color: token.colorTextTertiary }}>{t(row.meta)}</span>
        ) : null}
      </span>
      {row.amount != null ? (
        <MoneyCell
          value={row.amount}
          variant={row.moneyVariant ?? 'neutral'}
          style={{ fontSize: 13, flex: '0 0 auto' }}
        />
      ) : row.qty != null ? (
        <span className="num" style={{ flex: '0 0 auto', fontSize: 13, color: token.colorText, whiteSpace: 'nowrap' }}>
          {fmtNum(row.qty)} {t('dona')}
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
  const t = useT();
  const isPhone = useIsPhone();

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
        {t('Eʼtibor kerak')}
      </span>

      {active.length > 0 ? (
        <div
          style={
            compact || isPhone
              ? // telefonda masonry baribir 1 ustun bo'ladi, lekin CSS-columns
                // ichida uzun karta ustunlar orasida bo'linib ketishi mumkin —
                // oddiy flex ustun ishonchliroq.
                { display: 'flex', flexDirection: 'column', gap: 12 }
              : // CSS multi-column masonry: ~2 cols on desktop, 1 col on mobile,
                // no media query needed (columnWidth adapts to the container)
                { columnWidth: 320, columnGap: 16 }
          }
        >
          {active.map((q) => (
            <div
              key={q.key}
              style={compact || isPhone ? undefined : { breakInside: 'avoid', marginBottom: 16 }}
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
            alignItems: isPhone ? 'flex-start' : 'center',
            gap: 8,
            padding: '10px 12px',
            borderRadius: token.borderRadiusLG,
            background: hexToRgba(token.colorSuccess, 0.1),
            color: token.colorSuccess,
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          <span aria-hidden style={{ flex: '0 0 auto', fontWeight: 700 }}>
            ✓
          </span>
          <span style={{ color: token.colorText, minWidth: 0 }}>
            {active.length === 0
              ? t("Hammasi toza — eʼtibor talab qiladigan navbat yoʼq")
              : `${t('Toza')}: ${clean.map((q) => t(q.title)).join(' · ')}`}
          </span>
        </div>
      ) : null}
    </section>
  );
}
