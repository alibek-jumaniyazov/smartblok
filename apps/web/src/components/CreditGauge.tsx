import type { CSSProperties } from 'react';
import { theme } from 'antd';
import { fmtMoney, num } from '../lib/format';
import type { Money } from '../lib/types';

export interface CreditGaugeProps {
  /** credit limit; null = unlimited («Cheklanmagan»), '0' = prepay-only */
  limit: Money | null;
  /** amount currently used (outstanding) */
  used: Money;
  compact?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * CreditGauge — credit headroom visible before the server says no (04 §2.7).
 * Thin bar + caption «Limit … · Band … · Bo'sh …». `Cheklanmagan` = plain text
 * (no bar); `0` = danger note «Faqat oldindan to'lov». Bands: <60% neutral,
 * 60–90% warning, >90%/blocked danger. Money stays full-precision (02 §7).
 */
export function CreditGauge({ limit, used, compact = false, className, style }: CreditGaugeProps) {
  const { token } = theme.useToken();

  if (limit == null) {
    return (
      <span className={className} style={{ color: token.colorTextSecondary, fontSize: 12, ...style }}>
        Cheklanmagan
      </span>
    );
  }

  const lim = num(limit);
  if (lim <= 0) {
    return (
      <span className={className} style={{ color: token.colorError, fontSize: 12, fontWeight: 500, ...style }}>
        Faqat oldindan to'lov
      </span>
    );
  }

  const usedN = num(used);
  const pct = (usedN / lim) * 100;
  const free = lim - usedN;
  const overflow = free < 0;
  const fillPct = Math.max(0, Math.min(100, pct));
  const barColor = pct < 60 ? token.colorPrimary : pct <= 90 ? token.colorWarning : token.colorError;

  const freeLabel = overflow ? `Limitdan oshgan: ${fmtMoney(-free)}` : `Bo'sh: ${fmtMoney(free)}`;
  const freeColor = overflow ? token.colorError : token.colorTextSecondary;

  return (
    <div className={className} style={style}>
      <div
        style={{
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
      <div className="num" style={{ marginTop: 4, fontSize: compact ? 11 : 12, color: token.colorTextSecondary }}>
        {compact ? (
          <span style={{ color: freeColor }}>{freeLabel}</span>
        ) : (
          <>
            <span>Limit: {fmtMoney(lim)}</span>
            <span> · Band: {fmtMoney(usedN)} · </span>
            <span style={{ color: freeColor }}>{freeLabel}</span>
          </>
        )}
      </div>
    </div>
  );
}
