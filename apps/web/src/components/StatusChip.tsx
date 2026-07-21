// StatusChip (04 §4.2, 02 §2.5) — THE one chip for every enum in the app.
// Reads a resolved `StatusMeta` entry from lib/status-maps (STATUS, COST_STATUS,
// TRANSPORT_PAID, UNRECONCILED, …) so raw enums never render. Two variants:
//   • 'dot'    — dot + label, no fill (default; for tables / dense registers)
//   • 'filled' — 12%-tint fill + full-strength ink (for headers)
// Entries flagged `filled` in the map (violet UNKNOWN, danger CANCELLED) always
// render filled even in tables. Violet UNKNOWN also carries the `?` glyph so it
// is grayscale-readable and never reads as an absence. Ink is theme-aware.
import type { CSSProperties } from 'react';
import { theme } from 'antd';
import { statusInk, type StatusMeta } from '../lib/status-maps';
import { useIsPhone } from '../lib/responsive';
import { useThemeMode } from './ThemeContext';

/** The reserved-violet light ink (02 §2.4) — only imported-UNKNOWN carries it. */
const VIOLET_LIGHT = '#6D5BD0';

/** hex (#RRGGBB) → rgba() at the given alpha; inks are always 7-char hex. */
function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export interface StatusChipProps {
  /** the resolved map entry, e.g. STATUS[order.status] or COST_STATUS[cs]. */
  meta: StatusMeta;
  /** 'dot' for tables (default), 'filled' for headers. */
  variant?: 'dot' | 'filled';
  /** override the auto glyph (violet UNKNOWN → '?'); pass '' to suppress. */
  glyph?: string;
  className?: string;
  style?: CSSProperties;
}

export function StatusChip({ meta, variant = 'dot', glyph, className, style }: StatusChipProps) {
  const { mode } = useThemeMode();
  const { token } = theme.useToken();
  const isPhone = useIsPhone();

  // NOT_APPLICABLE and other bare em-dash entries: no chip, just the dash.
  if (meta.label === '—') {
    return <span style={{ color: token.colorTextSecondary }}>—</span>;
  }

  const ink = statusInk(meta, mode) ?? token.colorTextSecondary;
  const isViolet = meta.light === VIOLET_LIGHT;
  const mark = glyph ?? (isViolet ? '?' : undefined);
  const filled = variant === 'filled' || meta.filled === true;

  // telefonda uzun holat nomi tabletkani yorib chiqmasin: balandlik o'sadi,
  // matn o'raladi. Desktopda o'lchamlar aynan avvalgidek qat'iy 22px.
  const filledSizing: CSSProperties = isPhone
    ? { minHeight: 22, paddingBlock: 1, whiteSpace: 'normal', maxWidth: '100%' }
    : { height: 22, whiteSpace: 'nowrap' };

  if (filled) {
    return (
      <span
        className={className}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          ...filledSizing,
          paddingInline: 8,
          borderRadius: token.borderRadiusSM,
          background: hexToRgba(ink, mode === 'dark' ? 0.16 : 0.12),
          color: ink,
          fontSize: 12,
          fontWeight: 600,
          lineHeight: '20px',
          ...style,
        }}
      >
        {mark ? (
          <span aria-hidden style={{ fontWeight: 700 }}>
            {mark}
          </span>
        ) : null}
        {meta.label}
      </span>
    );
  }

  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        color: token.colorText,
        fontSize: 13,
        // «Yetkazib berilmoqda» kabi uzun holat nomi 320px ustunga bir satrda
        // sig'maydi — nuqta variantida telefonda o'ralishga ruxsat beriladi.
        // Nuqta `flex: 0 0 auto` bo'lgani uchun o'z joyida qoladi.
        whiteSpace: isPhone ? 'normal' : 'nowrap',
        ...style,
      }}
    >
      <span
        aria-hidden
        style={{ width: 7, height: 7, borderRadius: 999, background: ink, flex: '0 0 auto' }}
      />
      {mark ? (
        <span aria-hidden style={{ color: ink, fontWeight: 700 }}>
          {mark}
        </span>
      ) : null}
      {meta.label}
    </span>
  );
}
