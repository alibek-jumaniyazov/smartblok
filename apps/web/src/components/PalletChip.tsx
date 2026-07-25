import type { CSSProperties, ReactNode } from 'react';
import { Popover, theme } from 'antd';
import { hexToRgba } from '../lib/tint';
import { popupMaxWidth, useIsPhone } from '../lib/responsive';
import { PalletStatsPanel, type PalletStatsSide } from './PalletStatsPanel';
import { useT } from './LangContext';
import type { PalletPartyStats } from '../lib/types';

export interface PalletChipProps {
  /** in-kind pallet balance; >0 amber (held by client), <0 danger */
  pallets: number;
  /** breakdown popover slot (the full delivered−returned−charged math comes later) */
  popoverContent?: ReactNode;
  compact?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * PalletChip — outlined «N dona» chip so in-kind pallet debt is never misread as
 * money (04 §2.9), always adjacent to — never mixed into — money balances.
 * amber >0, danger <0, neutral at 0. The glyph is a CSS square, not an emoji
 * (02 §8 bans emoji in product UI).
 */
export function PalletChip({ pallets, popoverContent, compact = false, className, style }: PalletChipProps) {
  const { token } = theme.useToken();
  const t = useT();
  const isPhone = useIsPhone();

  const ink =
    pallets > 0 ? token.colorWarning : pallets < 0 ? token.colorError : token.colorTextSecondary;
  const borderColor = pallets === 0 ? token.colorBorder : hexToRgba(ink, 0.5);

  const chip = (
    <span
      className={['num', className].filter(Boolean).join(' ')}
      aria-label={t('{n} paddon', { n: pallets })}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        // popover bilan chip interaktiv bo'ladi — telefonda barmoqqa mo'ljal
        padding: popoverContent && isPhone ? '5px 10px' : compact ? '0 6px' : '1px 8px',
        borderRadius: token.borderRadiusSM,
        border: `1px solid ${borderColor}`,
        background: 'transparent',
        color: ink,
        fontSize: compact ? 12 : 13,
        lineHeight: compact ? '18px' : '20px',
        fontWeight: 500,
        whiteSpace: 'nowrap',
        cursor: popoverContent ? 'pointer' : 'default',
        ...style,
      }}
    >
      <span
        aria-hidden
        style={{ width: 8, height: 8, borderRadius: 2, background: ink, display: 'inline-block', flex: '0 0 auto' }}
      />
      {t('{n} dona', { n: pallets })}
    </span>
  );

  return popoverContent ? (
    <Popover content={popoverContent} trigger="click" placement="bottomLeft">
      {chip}
    </Popover>
  ) : (
    chip
  );
}

/**
 * The chip's `popoverContent` filler (2026-07-25): the full
 * «berilgan − qaytargan = qoldiq» math behind the single number on the chip.
 *
 *   <PalletChip pallets={row.balance} popoverContent={palletBreakdown(row.stats, 'client')} />
 *
 * A plain function, not a component, so a list column can build it inline without
 * paying a render for rows nobody taps. The width is capped against the viewport —
 * a popover is portalled and would otherwise run off a 320px screen.
 */
export function palletBreakdown(
  stats: PalletPartyStats,
  side: PalletStatsSide,
  title: ReactNode = 'Paddon tarixi',
): ReactNode {
  return (
    <div style={{ minWidth: 200, width: 280, maxWidth: popupMaxWidth() }}>
      <PalletStatsPanel stats={stats} side={side} title={title} compact />
    </div>
  );
}
