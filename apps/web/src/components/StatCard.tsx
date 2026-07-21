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
import { useIsPhone, useIsTouch } from '../lib/responsive';
import { MoneyCell, type MoneyVariant } from './MoneyCell';
import { DeltaTag, Sparkline } from './SmallAtoms';
import { useT } from './LangContext';
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
  /** hero (default) or a denser secondary tile with no dead space */
  size?: 'lg' | 'md';
  /** optional leading icon rendered in a tinted rounded square */
  icon?: ReactNode;
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
  size = 'lg',
  icon,
  className,
  style,
}: StatCardProps) {
  const { token } = theme.useToken();
  const t = useT();
  const isPhone = useIsPhone();
  const isTouch = useIsTouch();
  const [hover, setHover] = useState(false);

  // negative money is bad news on a KPI — force danger ink unless already semantic
  const neg = num(value) < 0;
  const mv: MoneyVariant = neg && (variant === 'neutral' || variant === 'in') ? 'owedToUs' : variant;

  const linked = typeof to === 'string' && to.length > 0;
  // teginishda :hover bir marta «yopishib» qoladi va hech qachon tozalanmaydi —
  // shuning uchun ko'tarilish/soya effekti faqat haqiqiy sichqonchada yoqiladi.
  const hoverable = linked && !isTouch;
  const lg = size === 'lg';
  // telefonda karta ~150px ustunga tushadi: paddingni qisqartiramiz, aks holda
  // 9 xonali summa `overflow: hidden` ostida qirqiladi.
  const pad = lg ? (isPhone ? 14 : 18) : isPhone ? 12 : 14;
  // token hex (theme-aware) — reliable for SVG stroke + rgba tints, and aligned
  // with the --sb-money-* CSS vars MoneyCell uses for the value colour.
  const accentColor =
    mv === 'in' ? token.colorSuccess
    : mv === 'owedToUs' ? token.colorError
    : mv === 'weOwe' ? token.colorWarning
    : token.colorPrimary;
  const hasSpark = !!sparkline && sparkline.length >= 2;

  const body = (
    <div
      className={className}
      onMouseEnter={hoverable ? () => setHover(true) : undefined}
      onMouseLeave={hoverable ? () => setHover(false) : undefined}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: lg ? 6 : 4,
        padding: pad,
        borderRadius: token.borderRadiusLG,
        border: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgContainer,
        boxShadow: hover ? 'var(--sb-shadow-e2)' : 'var(--sb-shadow-e1)',
        transform: hover ? 'translateY(-2px)' : 'none',
        transition: 'box-shadow .18s var(--sb-ease-out), transform .18s var(--sb-ease-out), border-color .18s var(--sb-ease-out)',
        borderColor: hover ? 'var(--sb-border-strong)' : token.colorBorderSecondary,
        minHeight: isPhone ? (lg ? 92 : 70) : lg ? 112 : 78,
        overflow: 'hidden',
        ...style,
      }}
    >
      {/* overline + icon / → affordance */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span
          style={{
            fontSize: 11,
            lineHeight: '16px',
            fontWeight: 600,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            color: token.colorTextTertiary,
            minWidth: 0,
          }}
        >
          {t(label)}
        </span>
        {icon ? (
          <span
            aria-hidden
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flex: '0 0 auto',
              width: 26,
              height: 26,
              borderRadius: 8,
              fontSize: 14,
              background: hexToRgba(accentColor, 0.12),
              color: accentColor,
            }}
          >
            {icon}
          </span>
        ) : linked ? (
          <span
            aria-hidden
            style={{
              flex: '0 0 auto',
              fontSize: 15,
              lineHeight: '16px',
              color: hover ? token.colorPrimary : token.colorTextTertiary,
              transform: hover ? 'translateX(2px)' : 'none',
              transition: 'color .12s var(--sb-ease-out), transform .12s var(--sb-ease-out)',
            }}
          >
            →
          </span>
        ) : null}
      </div>

      {/* hero value + unit + taxminiy flag. The unit («so'm») is a separate,
          subdued, wrappable element — never glued to the number — so a 9-digit
          value can never push the suffix out of the card and clip (04 §4.1). */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap', minWidth: 0 }}>
        <MoneyCell
          value={value}
          variant={mv}
          strong
          style={{
            // R17 — telefonda qiymat viewportga qarab kichrayadi. `sb-kpi-grid`
            // 2 ustunga tushganda karta ichi ~135px bo'ladi; 27px da 9 xonali
            // summa qirqilar edi.
            fontSize: isPhone ? (lg ? 'clamp(18px, 5.2vw, 27px)' : 'clamp(16px, 4.4vw, 20px)') : lg ? 27 : 20,
            lineHeight: isPhone ? 1.25 : lg ? '34px' : '26px',
            letterSpacing: '-0.01em',
          }}
        />
        {suffix ? (
          <span style={{ fontSize: lg ? 13 : 12, fontWeight: 500, color: token.colorTextTertiary }}>{t(suffix)}</span>
        ) : null}
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
            {t('taxminiy')}
          </span>
        ) : null}
      </div>

      {delta ? (
        <DeltaTag value={delta.value} goodWhenUp={delta.goodWhenUp} suffix={delta.suffix ? t(delta.suffix) : undefined} />
      ) : null}

      {note ? (
        <div style={{ fontSize: 12, lineHeight: '18px', color: token.colorTextSecondary }}>
          {typeof note === 'string' ? t(note) : note}
        </div>
      ) : null}

      {/* full-bleed area sparkline anchored to the bottom edge — fills wide cards */}
      {hasSpark ? (
        <div
          style={{
            marginTop: 'auto',
            marginInline: -pad,
            marginBottom: -pad,
            paddingTop: 8,
          }}
        >
          <Sparkline data={sparkline!} height={lg ? 40 : 30} color={accentColor} area stretch strokeWidth={2} />
        </div>
      ) : null}
    </div>
  );

  if (!linked) return body;
  return (
    <Link
      to={to as string}
      aria-label={`${t(label)}: ${fmtMoney(value)}${suffix ? ' ' + t(suffix) : ''}`}
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
  const t = useT();
  const isPhone = useIsPhone();
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
        {t(label)}
      </span>

      <div className="sb-kpi-grid">
        {cards.map((c, i) => (
          <StatCard key={c.to ?? c.label ?? i} {...c} />
        ))}
      </div>

      {compact.length > 0 ? (
        // telefonda 132px minWidth bilan flex-wrap qatori 1 ustunga qulab tushardi;
        // 2 ustunli grid (minmax(0,1fr) → bolalar siqila oladi) barqarorroq.
        <div
          style={
            isPhone
              ? { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }
              : { display: 'flex', flexWrap: 'wrap', gap: 20, rowGap: 12 }
          }
        >
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
  const t = useT();
  const isPhone = useIsPhone();
  const isTouch = useIsTouch();
  const [hover, setHover] = useState(false);
  const linked = typeof to === 'string' && to.length > 0;
  const hoverable = linked && !isTouch;
  const neg = num(value) < 0;
  const mv: MoneyVariant = neg && (variant === 'neutral' || variant === 'in') ? 'owedToUs' : variant;

  const inner = (
    <div
      onMouseEnter={hoverable ? () => setHover(true) : undefined}
      onMouseLeave={hoverable ? () => setHover(false) : undefined}
      style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: isPhone ? 0 : 132 }}
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
        {t(label)}
      </span>
      <MoneyCell value={value} variant={mv} suffix={suffix ? t(suffix) : undefined} strong style={{ fontSize: 14 }} />
    </div>
  );

  if (!linked) return inner;
  return (
    <Link to={to as string} style={{ color: 'inherit', textDecoration: 'none' }}>
      {inner}
    </Link>
  );
}
