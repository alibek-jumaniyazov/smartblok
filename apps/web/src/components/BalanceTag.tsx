import type { CSSProperties } from 'react';
import { theme } from 'antd';
import { fmtMoney, isSettled, num } from '../lib/format';
import { hexToRgba } from '../lib/tint';
import { useIsPhone } from '../lib/responsive';
import { useT } from './LangContext';
import type { Money } from '../lib/types';

export type PartyType = 'client' | 'factory' | 'vehicle';

export interface BalanceTagProps {
  balance: Money;
  partyType: PartyType;
  /** tighter chip for dense rows / pickers */
  compact?: boolean;
  /** optional paddon suffix «· 12 dona» (04 §2.2) */
  pallets?: number | null;
  className?: string;
  style?: CSSProperties;
}

/**
 * BalanceTag — the one way party balances render in pickers, rows and headers
 * (04 §2.2). Tinted chip (12% fill + full ink, 02 §2.4) with party-correct
 * phrasing; balances are unsigned, the word carries the meaning (02 §7).
 *
 * Sign convention (backend, confirmed against existing pages):
 * - client:  positive = Qarz (they owe us, red), negative = Avans (prepaid, green)
 * - factory: negative = Qarzimiz (we owe, amber), positive = Avansimiz (green)
 * - vehicle: negative = Qarzimiz (we owe, amber), positive = Avansimiz (green)
 *
 * |balance| < 1 UZS → grey «Hisob yopiq» (locked epsilon rule, 02 §2.4).
 */
export function BalanceTag({ balance, partyType, compact = false, pallets, style, className }: BalanceTagProps) {
  const { token } = theme.useToken();
  const t = useT();
  const isPhone = useIsPhone();

  const n = num(balance);
  const settled = isSettled(balance);

  let word: string;
  let ink: string;
  if (settled) {
    word = 'Hisob yopiq';
    ink = token.colorTextSecondary;
  } else if (partyType === 'client') {
    if (n > 0) {
      word = 'Qarz';
      ink = token.colorError; // moneyOwedToUs
    } else {
      word = 'Avans';
      ink = token.colorSuccess; // mijoz avansi = oldindan to'lov (moneyIn) — yashil
    }
  } else {
    // factory | vehicle
    if (n < 0) {
      word = 'Qarzimiz';
      ink = token.colorWarning; // our liability (moneyWeOwe)
    } else {
      word = 'Avansimiz';
      ink = token.colorSuccess; // in our favour (moneyIn)
    }
  }

  const fill = settled ? token.colorFillTertiary : hexToRgba(ink, 0.12);
  // «Qarz 239 399 139 · 12 dona» 320px da bir satrga sig'maydi. Telefonda chip
  // o'raladi; so'z, summa va paddon bo'lagi esa ichkarida bo'linmaydi.
  const wrapping: CSSProperties = isPhone
    ? { whiteSpace: 'normal', flexWrap: 'wrap', maxWidth: '100%' }
    : { whiteSpace: 'nowrap' };

  return (
    <span
      className={['num', className].filter(Boolean).join(' ')}
      style={{
        display: 'inline-flex',
        alignItems: 'baseline',
        gap: 6,
        padding: compact ? '0 6px' : '1px 8px',
        borderRadius: token.borderRadiusSM,
        background: fill,
        color: ink,
        fontSize: compact ? 12 : 13,
        lineHeight: compact ? '18px' : '22px',
        fontWeight: 500,
        ...wrapping,
        ...style,
      }}
    >
      <span style={{ whiteSpace: 'nowrap' }}>{t(word)}</span>
      {!settled && <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{fmtMoney(Math.abs(n))}</span>}
      {pallets ? (
        <span style={{ color: token.colorTextTertiary, fontWeight: 400, whiteSpace: 'nowrap' }}>
          · {t('{n} dona', { n: pallets })}
        </span>
      ) : null}
    </span>
  );
}
