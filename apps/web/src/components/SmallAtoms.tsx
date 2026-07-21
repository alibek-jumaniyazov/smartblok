import { useId, type CSSProperties, type ReactNode } from 'react';
import { theme, Typography } from 'antd';
import { ArrowDownOutlined, ArrowUpOutlined } from '@ant-design/icons';
import { fmtMoney, fmtNum } from '../lib/format';
import { hexToRgba } from '../lib/tint';
import { useIsPhone } from '../lib/responsive';
import { useT } from './LangContext';
import type { Money } from '../lib/types';

// ── KbdHint (04 §4.8) ──────────────────────────────────────────────────────

export interface KbdHintProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/**
 * 11px keyboard-hint chip — styling lives on `.kbd` in design.css.
 * Telefonda klaviatura yo'q: chip umuman render qilinmaydi (R19). CSS qatlami
 * `.kbd { display: none }` bilan zaxiralaydi, bu yerda esa DOM ham tozalanadi.
 */
export function KbdHint({ children, className, style }: KbdHintProps) {
  const isPhone = useIsPhone();
  if (isPhone) return null;
  return (
    <kbd className={['kbd', className].filter(Boolean).join(' ')} style={style}>
      {children}
    </kbd>
  );
}

// ── DeltaTag (04 §4.1 / §4.8) ───────────────────────────────────────────────

export interface DeltaTagProps {
  /** percentage change; 0 renders a neutral «0%» with no arrow */
  value: number;
  /** whether an increase is good news; false = «debt going up is red» (02 §2.4) */
  goodWhenUp?: boolean;
  /** trailing word, e.g. «o'tgan oyga nisbatan» — colour is never the sole carrier */
  suffix?: string;
  precision?: number;
  className?: string;
  style?: CSSProperties;
}

/** Arrow + % + word, coloured by business goodness (04 §4.1). */
export function DeltaTag({
  value,
  goodWhenUp = true,
  suffix,
  precision = 0,
  className,
  style,
}: DeltaTagProps) {
  const { token } = theme.useToken();
  const isPhone = useIsPhone();

  if (!Number.isFinite(value) || value === 0) {
    return (
      <Typography.Text type="secondary" className={['num', className].filter(Boolean).join(' ')} style={{ fontSize: 12, ...style }}>
        0%{suffix ? ` ${suffix}` : ''}
      </Typography.Text>
    );
  }

  const up = value > 0;
  const good = up === goodWhenUp;
  const ink = good ? token.colorSuccess : token.colorError;
  const Arrow = up ? ArrowUpOutlined : ArrowDownOutlined;

  return (
    <span
      className={['num', className].filter(Boolean).join(' ')}
      style={{
        color: ink,
        fontSize: 12,
        fontWeight: 500,
        // «oʼtgan oyga nisbatan» kabi uzun qo'shimcha 320px da nowrap bo'lsa
        // kartadan chiqib ketadi — telefonda o'ralishga ruxsat beriladi
        // (inline uslub `.num { white-space: nowrap }` dan kuchliroq).
        whiteSpace: isPhone && suffix ? 'normal' : 'nowrap',
        display: 'inline-flex',
        alignItems: 'center',
        flexWrap: isPhone && suffix ? 'wrap' : undefined,
        gap: 2,
        ...style,
      }}
    >
      <Arrow style={{ fontSize: 11 }} />
      {fmtNum(Math.abs(value), precision)}%
      {suffix ? (
        <span style={{ color: token.colorTextTertiary, fontWeight: 400, marginLeft: 4, minWidth: 0 }}>{suffix}</span>
      ) : null}
    </span>
  );
}

// ── Sparkline (02 §2.6, 04 §4.1 / §4.8) ─────────────────────────────────────

export interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  /** defaults to the primary series colour */
  color?: string;
  strokeWidth?: number;
  /** soft gradient area under the line (fills a wide card, 04 §4.1) */
  area?: boolean;
  /** stretch the SVG to 100% of its container width (distorts x only) */
  stretch?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * Axis-free single-line sparkline, hand-rolled SVG (no chart dep). With
 * `area`, a soft top-down gradient fills under the curve so a wide KPI card
 * reads as intentional, not empty (the dead-space fix, 04 §4.1). With
 * `stretch`, the SVG fills its container width via `preserveAspectRatio=none`.
 */
export function Sparkline({
  data,
  width = 96,
  height = 32,
  color,
  strokeWidth = 1.5,
  area = false,
  stretch = false,
  className,
  style,
}: SparklineProps) {
  const { token } = theme.useToken();
  const isPhone = useIsPhone();
  const stroke = color ?? token.colorPrimary;
  const gid = useId().replace(/[:]/g, '');

  const svgStyle: CSSProperties = {
    display: 'block',
    ...(stretch ? { width: '100%' } : null),
    // qat'iy `width={96}` telefonda tor konteynerni kengaytirib yuborardi
    ...(isPhone ? { maxWidth: '100%' } : null),
    ...style,
  };

  if (!data || data.length < 2) {
    return <svg width={width} height={height} className={className} style={svgStyle} aria-hidden />;
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pad = strokeWidth;
  const stepX = (width - pad * 2) / (data.length - 1);

  const pts = data.map((d, i) => {
    const x = pad + i * stepX;
    const y = pad + (1 - (d - min) / range) * (height - pad * 2);
    return [x, y] as const;
  });
  const points = pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  const areaPath =
    `M${pts[0][0].toFixed(2)},${(height - pad).toFixed(2)} ` +
    pts.map(([x, y]) => `L${x.toFixed(2)},${y.toFixed(2)}`).join(' ') +
    ` L${pts[pts.length - 1][0].toFixed(2)},${(height - pad).toFixed(2)} Z`;

  return (
    <svg
      width={stretch ? undefined : width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio={stretch ? 'none' : 'xMidYMid meet'}
      className={className}
      style={svgStyle}
      aria-hidden
    >
      {area ? (
        <>
          <defs>
            <linearGradient id={`spk-${gid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
              <stop offset="100%" stopColor={stroke} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={areaPath} fill={`url(#spk-${gid})`} stroke="none" />
        </>
      ) : null}
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect={stretch ? 'non-scaling-stroke' : undefined}
      />
    </svg>
  );
}

// ── OverdueChip (04 §4.8) ───────────────────────────────────────────────────

export interface OverdueChipProps {
  count: number;
  sum: Money;
  compact?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** «N ta muddati o'tgan · Σ» — count and sum inline in the cell, never a tooltip. */
export function OverdueChip({ count, sum, compact = false, className, style }: OverdueChipProps) {
  const { token } = theme.useToken();
  const t = useT();
  const isPhone = useIsPhone();
  if (!count || count <= 0) return null;

  const ink = token.colorError; // overdue = receivable risk (02 §2.4)
  return (
    <span
      className={['num', className].filter(Boolean).join(' ')}
      style={{
        display: 'inline-flex',
        alignItems: 'baseline',
        gap: 4,
        padding: compact ? '0 6px' : '1px 8px',
        borderRadius: token.borderRadiusSM,
        background: hexToRgba(ink, 0.12),
        color: ink,
        fontSize: compact ? 12 : 13,
        fontWeight: 500,
        // «3 ta muddati o'tgan · 12 345 678» ~30 belgi: telefonda bir satrda
        // sig'maydi. Chip o'raladi, summaning o'zi esa bo'linmaydi.
        whiteSpace: isPhone ? 'normal' : 'nowrap',
        ...(isPhone ? { flexWrap: 'wrap' as const, maxWidth: '100%' } : null),
        ...style,
      }}
    >
      {t("{n} ta muddati o'tgan", { n: count })}
      <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>· {fmtMoney(sum)}</span>
    </span>
  );
}
