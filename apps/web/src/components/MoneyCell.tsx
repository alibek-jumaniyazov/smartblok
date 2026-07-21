import type { CSSProperties } from 'react';
import { theme } from 'antd';
import { fmtMoney, fmtMoneySigned, isSettled, num } from '../lib/format';
import { hexToRgba } from '../lib/tint';
import { useIsPhone } from '../lib/responsive';
import { useT } from './LangContext';
import type { Money } from '../lib/types';

/**
 * Semantic meaning of an amount (04 §2.1). Callers pass meaning, never a raw
 * sign convention — colour maps to the fixed money palette in 02 §2.4.
 */
export type MoneyVariant = 'neutral' | 'in' | 'owedToUs' | 'weOwe' | 'ghost';

export interface MoneyCellProps {
  value: Money | number | null | undefined;
  variant?: MoneyVariant;
  /** explicit «+ / −» sign for statement amounts (02 §7); default false */
  signed?: boolean;
  /** appended unit, typically «so'm» (hero figures / totals) */
  suffix?: string;
  /** USD equation variant «$1 250.00 × 12 650 = 15 812 500 so'm» (02 §7) */
  usd?: { amount: Money | number; rate: Money | number };
  /** unpriced order line: renders «—» + «Narxlanmagan» chip (04 §2.1 states) */
  pending?: boolean;
  /** body-strong weight for totals rows */
  strong?: boolean;
  className?: string;
  style?: CSSProperties;
  title?: string;
}

type Num = Money | number | null | undefined;

/** «$1 250.00»: space-grouped, dot decimal, 2 places (02 §7 USD equation). */
function fmtUsdAmount(v: Num): string {
  const n = num(v);
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
    .format(n)
    .replace(/,/g, ' ');
}

const SEMANTIC_VAR: Partial<Record<MoneyVariant, string>> = {
  in: 'var(--sb-money-in)',
  owedToUs: 'var(--sb-money-owed)',
  weOwe: 'var(--sb-money-weowe)',
};

/**
 * MoneyCell — the atom under every amount (04 §2.1). Right-aligned tabular
 * grouped digits, true minus (U+2212), semantic ink per 02 §2.4. Settled
 * (<1 UZS) renders `0`; ghost strikes the amount only; USD renders the full
 * equation. Numbers never animate (02 §5) — this is a plain render.
 */
export function MoneyCell({
  value,
  variant = 'neutral',
  signed = false,
  suffix,
  usd,
  pending = false,
  strong = false,
  className,
  style,
  title,
}: MoneyCellProps) {
  const { token } = theme.useToken();
  const t = useT();
  const isPhone = useIsPhone();

  const color =
    variant === 'ghost'
      ? token.colorTextTertiary
      : SEMANTIC_VAR[variant] ?? token.colorText;

  const base: CSSProperties = {
    color,
    fontWeight: strong ? 600 : 500,
    whiteSpace: 'nowrap',
    fontVariantNumeric: 'tabular-nums',
    ...style,
  };
  // telefon varianti: tashqi element o'raladi, raqamli bo'laklar esa ichkarida
  // alohida `nowrap` span'lar bo'lgani uchun hech qachon bo'linmaydi.
  const wrappable: CSSProperties = { ...base, whiteSpace: 'normal' };

  // Pending (unpriced) — «—» + amber «Narxlanmagan» chip.
  if (pending) {
    return (
      <span className={['num', className].filter(Boolean).join(' ')} style={base} title={title}>
        <span style={{ color: token.colorTextTertiary, fontWeight: 400 }}>—</span>
        <span
          style={{
            marginLeft: 6,
            padding: '0 6px',
            borderRadius: token.borderRadiusSM,
            background: hexToRgba(token.colorWarning, 0.12),
            color: token.colorWarning,
            fontSize: 11,
            fontWeight: 500,
            whiteSpace: 'nowrap',
          }}
        >
          {t('Narxlanmagan')}
        </span>
      </span>
    );
  }

  // USD equation variant. ~35 belgilik tenglama telefonda bitta satrga
  // sig'maydi; `.num { white-space: nowrap }` ni inline uslub bilan yechamiz —
  // raqamlarning o'zi bo'linmasligi uchun har bo'lak alohida nowrap span.
  if (usd) {
    const lhs = `$${fmtUsdAmount(usd.amount)} × ${fmtMoney(usd.rate)}`;
    const rhs = `${fmtMoney(value)} ${t("so'm")}`;
    return (
      <span
        className={['num', className].filter(Boolean).join(' ')}
        style={isPhone ? wrappable : base}
        title={title}
      >
        <span style={{ whiteSpace: 'nowrap' }}>{lhs}</span>
        {' = '}
        <span style={{ whiteSpace: 'nowrap' }}>{rhs}</span>
      </span>
    );
  }

  const settled = isSettled(value);
  const text = settled ? '0' : signed ? fmtMoneySigned(value) : fmtMoney(value);
  const amountClass = variant === 'ghost' ? 'ghost-amount' : undefined;

  // R17 — birlik («so'm») raqamdan ALOHIDA, o'ralishi mumkin bo'lgan element:
  // 9 xonali summa telefonda birlikni kartadan itarib chiqarmaydi. Raqamning
  // o'zi hamma joyda bitta satrda qoladi.
  return (
    <span
      className={['num', className].filter(Boolean).join(' ')}
      style={isPhone && suffix ? wrappable : base}
      title={title}
    >
      <span className={amountClass} style={{ whiteSpace: 'nowrap' }}>
        {text}
      </span>
      {suffix ? <span> {suffix}</span> : null}
    </span>
  );
}
