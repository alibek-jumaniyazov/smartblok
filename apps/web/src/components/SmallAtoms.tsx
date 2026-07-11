import type { CSSProperties, ReactNode } from 'react';
import { theme, Typography } from 'antd';
import { ArrowDownOutlined, ArrowUpOutlined } from '@ant-design/icons';
import { fmtMoney, fmtNum } from '../lib/format';
import { hexToRgba } from '../lib/tint';
import type { Money } from '../lib/types';

// ── KbdHint (04 §4.8) ──────────────────────────────────────────────────────

export interface KbdHintProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/** 11px keyboard-hint chip — styling lives on `.kbd` in design.css. */
export function KbdHint({ children, className, style }: KbdHintProps) {
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
        whiteSpace: 'nowrap',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 2,
        ...style,
      }}
    >
      <Arrow style={{ fontSize: 11 }} />
      {fmtNum(Math.abs(value), precision)}%
      {suffix ? (
        <span style={{ color: token.colorTextTertiary, fontWeight: 400, marginLeft: 4 }}>{suffix}</span>
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
  className?: string;
  style?: CSSProperties;
}

/** 32px axis-free single-line sparkline, hand-rolled SVG (no chart dep). */
export function Sparkline({
  data,
  width = 96,
  height = 32,
  color,
  strokeWidth = 1.5,
  className,
  style,
}: SparklineProps) {
  const { token } = theme.useToken();
  const stroke = color ?? token.colorPrimary;

  if (!data || data.length < 2) {
    return <svg width={width} height={height} className={className} style={style} aria-hidden />;
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pad = strokeWidth;
  const stepX = (width - pad * 2) / (data.length - 1);

  const points = data
    .map((d, i) => {
      const x = pad + i * stepX;
      const y = pad + (1 - (d - min) / range) * (height - pad * 2);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      style={{ display: 'block', ...style }}
      aria-hidden
    >
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
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
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {count} ta muddati o'tgan
      <span style={{ fontWeight: 600 }}>· {fmtMoney(sum)}</span>
    </span>
  );
}
