// PalletStatsPanel — «olingan − qaytarilgan = qoldiq» bloki (egasi so'rovi, 2026-07-25).
//
// The pallet ledger always knew the whole story; the app only ever showed the netted
// balance, so the owner could see «mijozda 260 dona» but never «bergan 1 240, qaytargan
// 980». This is the one block every surface (Paddonlar, mijoz/zavod kartochkasi,
// dashboard, PalletChip popoveri) uses to tell that story the SAME way.
//
// Why the three figures sit on a subtraction rail instead of three tiles: they are not
// three facts, they are ONE equation, and the server guarantees it closes exactly
// (`adjustment` is a residual, not a bucket). Three unrelated tiles would let a reader
// invent his own arithmetic; the rail makes the operator visible, so «1 240 − 980 = 260»
// is read, not computed. That is also why «Yo'qotilgan (undirilgan)» and «Tuzatish»
// appear INSIDE the rail whenever they are non-zero and are hidden when zero: showing
// them always would clutter the common case, hiding them ever would break the equation
// on screen.
//
// ALL-TIME only — this data has no date window and none may be added.
import type { CSSProperties, ReactNode } from 'react';
import { theme } from 'antd';
import { fmtDate, fmtNum, fmtUZS } from '../lib/format';
import { hexToRgba } from '../lib/tint';
import { useIsPhone } from '../lib/responsive';
import { useT } from './LangContext';
import type { PalletPartyStats } from '../lib/types';

export type PalletStatsSide = 'client' | 'factory';

export interface PalletStatsPanelProps {
  /** all-time, already-netted history of ONE party (server-computed) */
  stats: PalletPartyStats;
  /** picks the label set: who received from whom */
  side: PalletStatsSide;
  /** heading above the rail; a plain string is translated for you */
  title?: ReactNode;
  /** dense variant for cards/tabs/popovers — also drops the panel's own border+padding */
  compact?: boolean;
  /** action slot on the heading line (e.g. «Qaytarish qabul qilish») */
  extra?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/**
 * Zero-history fallback — mirrors the server's own EMPTY_PALLET_STATS.
 * `palletStats` is optional on the client/factory detail payloads (an AGENT never
 * gets the factory one), so every surface needs the same «hech qachon savdo
 * qilmagan» object; four pages inventing four of them is how the counts drift.
 */
export const EMPTY_PALLET_STATS: PalletPartyStats = {
  received: 0,
  returned: 0,
  chargedLost: 0,
  chargedLostAmount: '0',
  adjustment: 0,
  balance: 0,
  movements: 0,
  firstMovementAt: null,
  lastMovementAt: null,
  lastReceivedAt: null,
  lastReturnAt: null,
};

/**
 * Did this party ever really trade pallets? Mirrors the server's own
 * `hasPalletHistory` (apps/api/src/pallets/pallet-stats.ts) — keep the two in step.
 *
 * NOT `movements > 0`: `movements` counts LEDGER ROWS, and a fully cancelled order
 * leaves two of them (the delivery plus its storno) that net to nothing. Guarding an
 * empty state on the row count therefore shows «0 − 0 = 0» to a client whose only
 * pallet order was cancelled — precisely the panel the guard exists to suppress.
 */
export function hasPalletHistory(s: PalletPartyStats | null | undefined): s is PalletPartyStats {
  if (!s) return false;
  return (
    s.received !== 0 || s.returned !== 0 || s.chargedLost !== 0 || s.adjustment !== 0 || s.balance !== 0
  );
}

/** true minus (U+2212), never a hyphen — same rule as lib/format money. */
const MINUS = '−';

interface Term {
  key: string;
  /** operator PRECEDING this term; '' only on the leading positive one */
  op: '' | '−' | '+' | '=';
  label: string;
  value: number;
  ink: string;
  /** secondary line, e.g. the money billed for lost pallets */
  note?: string;
  result?: boolean;
}

export function PalletStatsPanel({
  stats,
  side,
  title,
  compact = false,
  extra,
  className,
  style,
}: PalletStatsPanelProps) {
  const { token } = theme.useToken();
  const t = useT();
  const isPhone = useIsPhone();

  const isClient = side === 'client';
  const { received, returned, chargedLost, adjustment, balance } = stats;

  // >0 amber, <0 danger, 0 neutral — the SAME reading as PalletChip, so the result
  // here and the chip sitting next to it can never look like two different facts.
  const resultInk =
    balance > 0 ? token.colorWarning : balance < 0 ? token.colorError : token.colorTextSecondary;
  // colorTextSecondary is an rgba() token, not a hex — tinting it would paint a solid
  // text colour behind the number, so the settled case falls back to a fill token.
  const resultTint = balance === 0 ? token.colorFillQuaternary : hexToRgba(resultInk, 0.1);

  // The SIGNED contribution picks the operator, never the label: a rolled-back return
  // nets negative and must read «+ 5», not «− −5».
  const terms: Term[] = [
    {
      key: 'received',
      op: received < 0 ? MINUS : '',
      label: isClient ? 'Mijozga jami berilgan' : 'Zavoddan jami olingan',
      value: Math.abs(received),
      ink: token.colorText,
    },
    {
      key: 'returned',
      op: returned < 0 ? '+' : MINUS,
      label: isClient ? 'Mijoz qaytargan' : 'Zavodga qaytarilgan',
      value: Math.abs(returned),
      ink: token.colorSuccess,
    },
  ];
  if (chargedLost !== 0) {
    terms.push({
      key: 'lost',
      op: chargedLost < 0 ? '+' : MINUS,
      label: "Yo'qotilgan (undirilgan)",
      value: Math.abs(chargedLost),
      ink: token.colorError,
      note: `(${fmtUZS(stats.chargedLostAmount)})`,
    });
  }
  if (adjustment !== 0) {
    terms.push({
      key: 'adjustment',
      op: adjustment < 0 ? MINUS : '+',
      label: 'Tuzatish',
      value: Math.abs(adjustment),
      ink: token.colorTextSecondary,
    });
  }
  terms.push({
    key: 'balance',
    op: '=',
    label: isClient ? 'Hozir mijozda' : 'Hozir qarzmiz',
    value: balance,
    ink: resultInk,
    result: true,
  });

  // «Qaytarish darajasi» — meaningless (and a division by zero) with nothing received.
  const rate = received > 0 ? Math.max(0, Math.min(100, (returned / received) * 100)) : null;
  const rateColor =
    rate == null ? token.colorPrimary
    : rate >= 90 ? token.colorSuccess
    : rate >= 50 ? token.colorPrimary
    : token.colorWarning;

  // A party that never traded pallets has no dates to show — «—» rows would be noise.
  const hasHistory = stats.lastMovementAt != null;
  const neverReturned = stats.lastReturnAt == null && received > 0;

  const labelStyle: CSSProperties = {
    fontSize: 11,
    lineHeight: '16px',
    fontWeight: 600,
    letterSpacing: '0.04em',
    color: token.colorTextTertiary,
  };

  const valueNode = (v: number, size: number, weight: number, ink: string) => (
    <span
      className="num"
      style={{ fontSize: size, fontWeight: weight, lineHeight: 1.2, color: ink, whiteSpace: 'nowrap' }}
    >
      {fmtNum(v)}
      <span style={{ fontSize: 11, fontWeight: 500, color: token.colorTextTertiary, marginLeft: 4 }}>
        {t('dona')}
      </span>
    </span>
  );

  // Telefonda gorizontal reyka 320px ga sig'maydi — o'sha tenglama vertikal
  // «daftar» ko'rinishiga tushadi: operator chapda tor ustunda, natija tepasida
  // chiziq bilan. Bu ham xuddi shu tenglama, faqat qog'ozdagidek yozilgan.
  const rail = isPhone ? (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {terms.map((x) => (
        <div
          key={x.key}
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 8,
            ...(x.result
              ? { marginTop: 2, paddingTop: 8, borderTop: `1px solid ${token.colorBorderSecondary}` }
              : null),
          }}
        >
          <span
            aria-hidden
            style={{
              flex: '0 0 auto',
              width: 12,
              textAlign: 'center',
              fontSize: 14,
              color: token.colorTextTertiary,
            }}
          >
            {x.op}
          </span>
          <div style={{ flex: '1 1 auto', minWidth: 0 }}>
            <div
              style={{
                fontSize: 12,
                lineHeight: '18px',
                fontWeight: x.result ? 600 : 400,
                color: x.result ? token.colorText : token.colorTextSecondary,
              }}
            >
              {t(x.label)}
            </div>
            {x.note ? (
              <div className="num" style={{ fontSize: 11, lineHeight: '16px', color: token.colorTextTertiary }}>
                {x.note}
              </div>
            ) : null}
          </div>
          {valueNode(x.value, x.result ? 16 : 14, x.result ? 700 : 600, x.ink)}
        </div>
      ))}
    </div>
  ) : (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: compact ? 10 : 14, rowGap: 10 }}>
      {terms.map((x) => (
        // operator + o'z hadi BITTA flex elementida: aks holda o'ralishda «−»
        // satr oxirida yolg'iz qolib, tenglama buzilib ko'rinardi.
        <div key={x.key} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          {x.op ? (
            <span aria-hidden style={{ flex: '0 0 auto', fontSize: compact ? 14 : 16, color: token.colorTextTertiary }}>
              {x.op}
            </span>
          ) : null}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              minWidth: 0,
              ...(x.result
                ? {
                    padding: compact ? '4px 10px' : '6px 12px',
                    borderRadius: token.borderRadiusSM,
                    background: resultTint,
                  }
                : null),
            }}
          >
            <span style={labelStyle}>{t(x.label)}</span>
            {valueNode(x.value, x.result ? (compact ? 18 : 22) : compact ? 15 : 17, x.result ? 700 : 600, x.ink)}
            {x.note ? (
              <span className="num" style={{ fontSize: 11, lineHeight: '16px', color: token.colorTextTertiary }}>
                {x.note}
              </span>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div
      role="group"
      aria-label={t('Paddon tarixi')}
      className={className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: compact ? 8 : 12,
        // compact = chrome yo'q: uni chaqiruvchi o'z kartasi/tabi ichiga qo'yadi
        ...(compact
          ? null
          : {
              padding: isPhone ? 14 : 16,
              borderRadius: token.borderRadiusLG,
              border: `1px solid ${token.colorBorderSecondary}`,
              background: token.colorBgContainer,
            }),
        ...style,
      }}
    >
      {title || extra ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          {typeof title === 'string' ? (
            <span style={{ ...labelStyle, color: token.colorTextSecondary, minWidth: 0 }}>{t(title)}</span>
          ) : (
            title ?? <span />
          )}
          {extra ? <span style={{ flex: '0 0 auto' }}>{extra}</span> : null}
        </div>
      ) : null}

      {rail}

      {rate != null ? (
        <div>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: 8,
              marginBottom: 4,
            }}
          >
            <span style={{ fontSize: 11, lineHeight: '16px', color: token.colorTextTertiary }}>
              {t('Qaytarish darajasi')}
            </span>
            <span className="num" style={{ fontSize: 11, fontWeight: 600, color: rateColor }}>
              {/* bitta kasr xona AYNAN 100% uchun kerak: 199/200 = 99,5 ni butunlashtirsak
                  «100%» chiqadi va u yonidagi «= 1 dona» qoldiq bilan qarama-qarshi turadi.
                  Butun qiymatlar esa «80,0%» emas, «80%» bo'lib qolaveradi. */}
              {fmtNum(rate, Number.isInteger(rate) ? 0 : 1)}%
            </span>
          </div>
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
                width: `${rate}%`,
                background: rateColor,
                borderRadius: 999,
                transition: 'width 0.18s cubic-bezier(0.2, 0, 0, 1)',
              }}
            />
          </div>
        </div>
      ) : null}

      {hasHistory ? (
        <div
          style={{
            fontSize: 11,
            lineHeight: '16px',
            color: token.colorTextTertiary,
            // 320px da uchta sana bitta satrda ekrandan chiqib ketardi
            display: 'flex',
            flexWrap: 'wrap',
            gap: 4,
            columnGap: 8,
          }}
        >
          <span style={{ whiteSpace: 'nowrap' }}>
            {t('Oxirgi harakat')}: <span className="num">{fmtDate(stats.lastMovementAt)}</span>
          </span>
          {neverReturned ? (
            <span style={{ whiteSpace: 'nowrap', color: token.colorWarning }}>{t('Hech qachon qaytarmagan')}</span>
          ) : stats.lastReturnAt ? (
            <span style={{ whiteSpace: 'nowrap' }}>
              {t('Oxirgi qaytargan')}: <span className="num">{fmtDate(stats.lastReturnAt)}</span>
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
