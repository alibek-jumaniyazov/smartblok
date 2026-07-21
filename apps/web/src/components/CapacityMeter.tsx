import type { CSSProperties } from 'react';
import { theme } from 'antd';
import { useT } from './LangContext';

export interface CapacityMeterProps {
  /** pallets loaded onto the truck */
  used: number;
  /** vehicle capacity in pallets (re-bases on vehicle pick) */
  capacity: number;
  compact?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * CapacityMeter — pallets vs truck capacity before the server rejects (04 §2.8).
 * «X / Y paddon» + fill bar; amber ≥90%, red when exceeded with the exact
 * overflow text «N paddon ortiqcha — server rad etadi» (the submit guard lives
 * in the consuming composer). Integer «dona»/«paddon» per 02 §7.
 */
export function CapacityMeter({ used, capacity, compact = false, className, style }: CapacityMeterProps) {
  const { token } = theme.useToken();
  const t = useT();

  const cap = capacity > 0 ? capacity : 0;
  const pct = cap > 0 ? (used / cap) * 100 : used > 0 ? 100 : 0;
  const over = used - cap;
  const fillPct = Math.max(0, Math.min(100, pct));
  const barColor = over > 0 ? token.colorError : pct >= 90 ? token.colorWarning : token.colorPrimary;

  return (
    <div className={className} style={style}>
      <div
        className="num"
        style={{
          fontSize: compact ? 12 : 13,
          fontWeight: 600,
          color: over > 0 ? token.colorError : token.colorText,
          whiteSpace: 'nowrap',
        }}
      >
        {used} / {cap} {t('paddon')}
      </div>
      <div
        style={{
          marginTop: 4,
          height: compact ? 4 : 6,
          borderRadius: 999,
          background: token.colorFillTertiary,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${fillPct}%`,
            background: barColor,
            borderRadius: 999,
            transition: 'width 0.18s cubic-bezier(0.2, 0, 0, 1)',
          }}
        />
      </div>
      {over > 0 && (
        <div style={{ marginTop: 4, fontSize: 12, color: token.colorError }}>
          {compact
            ? t('{n} paddon ortiqcha', { n: over })
            : t('{n} paddon ortiqcha — server rad etadi', { n: over })}
        </div>
      )}
    </div>
  );
}
