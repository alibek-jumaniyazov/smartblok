// StatCard + KpiBand (04 §4.1) — drillable KPIs; every number is a door.
// A StatCard is: overline label → full-precision `money-lg` value (+ optional
// «taxminiy» flag) → optional DeltaTag vs the previous period (coloured by
// BUSINESS goodness — debt going up is red) → optional 32px Sparkline → the
// WHOLE card is a link with a «→» affordance. Numbers never animate (02 §5) —
// these are plain renders. Colours come from tokens / --sb-* vars only.
import { useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { theme } from 'antd';
import { fmtMoney, num } from '../lib/format';
import { hexToRgba } from '../lib/tint';
import { MoneyCell, type MoneyVariant } from './MoneyCell';
import { DeltaTag, Sparkline } from './SmallAtoms';
import type { Money } from '../lib/types';

export interface StatCardDelta {
  /** percentage change vs the previous period */
  value: number;
  /** whether an increase is good news; false = «debt up is red» (04 §4.1) */
  goodWhenUp?: boolean;
  /** trailing word, e.g. «oʼtgan oyga nisbatan» */
  suffix?: string;
}

export interface StatCardProps {
  /** overline label (11px/600, no uppercase) */
  label: string;
  /** full-precision money-lg value (Decimal string or number) */
  value: Money | number | null | undefined;
  /** semantic ink (02 §2.4); negative neutral/in values auto-flip to danger */
  variant?: MoneyVariant;
  /** delta chip vs the previous period */
  delta?: StatCardDelta;
  /** 32px sparkline series (from the already-fetched trends payload) */
  sparkline?: number[];
  /** whole-card link target; omit for a static card */
  to?: string;
  /** appended unit, «soʼm» / «dona» / «ta» */
  suffix?: string;
  /** secondary caption under the value */
  note?: ReactNode;
  /** profit cards while unfinalized orders exist → «taxminiy» flag */
  estimated?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** StatCard — one drillable KPI (04 §4.1). */
export function StatCard({
  label,
  value,
  variant = 'neutral',
  delta,
  sparkline,
  to,
  suffix,
  note,
  estimated = false,
  className,
  style,
}: StatCardProps) {
  const { token } = theme.useToken();
  const [hover, setHover] = useState(false);

  // negative money is bad news on a KPI — force danger ink unless already semantic
  const neg = num(value) < 0;
  const mv: MoneyVariant = neg && (variant === 'neutral' || variant === 'in') ? 'owedToUs' : variant;

  const linked = typeof to === 'string' && to.length > 0;

  const body = (
    <div
      className={className}
      onMouseEnter={linked ? () => setHover(true) : undefined}
      onMouseLeave={linked ? () => setHover(false) : undefined}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 16,
        borderRadius: token.borderRadiusLG,
        border: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgContainer,
        boxShadow: hover ? 'var(--sb-shadow-e1)' : 'none',
        transition: 'box-shadow 0.12s cubic-bezier(0.2, 0, 0, 1)',
        minHeight: 96,
        ...style,
      }}
    >
      {/* overline + → affordance */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <span
          style={{
            fontSize: 11,
            lineHeight: '16px',
            fontWeight: 600,
            letterSpacing: '0.06em',
            color: token.colorTextSecondary,
          }}
        >
          {label}
        </span>
        {linked ? (
          <span
            aria-hidden
            style={{
              fontSize: 14,
              lineHeight: '16px',
              color: hover ? token.colorPrimary : token.colorTextTertiary,
              transition: 'color 0.12s cubic-bezier(0.2, 0, 0, 1)',
            }}
          >
            →
          </span>
        ) : null}
      </div>

      {/* money-lg value + taxminiy flag */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <MoneyCell
          value={value}
          variant={mv}
          suffix={suffix}
          strong
          style={{ fontSize: 20, lineHeight: '26px' }}
        />
        {estimated ? (
          <span
            style={{
              padding: '0 6px',
              borderRadius: token.borderRadiusSM,
              background: hexToRgba(token.colorWarning, 0.12),
              color: token.colorWarning,
              fontSize: 11,
              fontWeight: 500,
              lineHeight: '18px',
            }}
          >
            taxminiy
          </span>
        ) : null}
      </div>

      {delta ? (
        <DeltaTag value={delta.value} goodWhenUp={delta.goodWhenUp} suffix={delta.suffix} />
      ) : null}

      {sparkline && sparkline.length >= 2 ? (
        <Sparkline data={sparkline} width={132} height={32} />
      ) : null}

      {note ? (
        <div style={{ fontSize: 12, lineHeight: '18px', color: token.colorTextSecondary }}>{note}</div>
      ) : null}
    </div>
  );

  if (!linked) return body;
  return (
    <Link
      to={to as string}
      aria-label={`${label}: ${fmtMoney(value)}${suffix ? ' ' + suffix : ''}`}
      style={{ display: 'block', color: 'inherit', textDecoration: 'none' }}
    >
      {body}
    </Link>
  );
}

// ── KpiBand (04 §4.1) ───────────────────────────────────────────────────────

export interface KpiSecondaryStat {
  label: string;
  value: Money | number | null | undefined;
  suffix?: string;
  variant?: MoneyVariant;
  to?: string;
}

export interface KpiBandProps {
  /** band label (SAVDO / FOYDA / QARZLAR) */
  label: string;
  /** row of hero StatCards */
  cards: StatCardProps[];
  /** up to 6 compact secondary stats (label + value, also links) */
  secondary?: KpiSecondaryStat[];
  className?: string;
  style?: CSSProperties;
}

/** KpiBand — an overline band label + hero StatCards + compact secondary stats. */
export function KpiBand({ label, cards, secondary, className, style }: KpiBandProps) {
  const { token } = theme.useToken();
  const compact = (secondary ?? []).slice(0, 6);

  return (
    <section
      className={className}
      style={{ display: 'flex', flexDirection: 'column', gap: 12, ...style }}
      aria-label={label}
    >
      <span
        style={{
          fontSize: 11,
          lineHeight: '16px',
          fontWeight: 600,
          letterSpacing: '0.06em',
          color: token.colorTextTertiary,
        }}
      >
        {label}
      </span>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 16,
        }}
      >
        {cards.map((c, i) => (
          <StatCard key={c.to ?? c.label ?? i} {...c} />
        ))}
      </div>

      {compact.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
          {compact.map((s, i) => (
            <SecondaryStat key={s.to ?? s.label ?? i} {...s} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function SecondaryStat({ label, value, suffix, variant = 'neutral', to }: KpiSecondaryStat) {
  const { token } = theme.useToken();
  const [hover, setHover] = useState(false);
  const linked = typeof to === 'string' && to.length > 0;
  const neg = num(value) < 0;
  const mv: MoneyVariant = neg && (variant === 'neutral' || variant === 'in') ? 'owedToUs' : variant;

  const inner = (
    <div
      onMouseEnter={linked ? () => setHover(true) : undefined}
      onMouseLeave={linked ? () => setHover(false) : undefined}
      style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 132 }}
    >
      <span
        style={{
          fontSize: 11,
          lineHeight: '16px',
          fontWeight: 600,
          letterSpacing: '0.06em',
          color: linked && hover ? token.colorPrimary : token.colorTextSecondary,
          transition: 'color 0.12s cubic-bezier(0.2, 0, 0, 1)',
        }}
      >
        {label}
      </span>
      <MoneyCell value={value} variant={mv} suffix={suffix} strong style={{ fontSize: 14 }} />
    </div>
  );

  if (!linked) return inner;
  return (
    <Link to={to as string} style={{ color: 'inherit', textDecoration: 'none' }}>
      {inner}
    </Link>
  );
}
