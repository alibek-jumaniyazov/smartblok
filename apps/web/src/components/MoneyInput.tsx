import type { CSSProperties } from 'react';
import { useState } from 'react';
import { Button, InputNumber, theme, Typography } from 'antd';
import { fmtMoney, num } from '../lib/format';
import { useIsPhone } from '../lib/responsive';
import type { Money } from '../lib/types';
import { MoneyCell } from './MoneyCell';
import { useT } from './LangContext';

export interface MoneyInputProps {
  /** UZS integer amount (Money string). In USD mode this is the computed total. */
  value?: Money | number | null;
  /** emits the digits-only UZS string; in USD mode the computed total */
  onChange?: (value: string) => void;
  /** advisory upper bound fed by live data (server stays authoritative, 02 §9) */
  max?: Money | number | null;
  /** helper text for the bound, e.g. «Hamyonda: 1 250 000» (04 §2.10) */
  maxLabel?: string;
  /** minimum; money min is 1 (02 §7). Pass 0 where zero is a legitimate value (e.g. setting
   *  a cashbox balance to nothing). */
  min?: number;
  /** unit shown in the suffix — defaults to «so'm». Set it for a USD box, or the field
   *  quietly mislabels the number the user is typing. */
  unit?: string;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  id?: string;
  status?: 'error' | 'warning';
  /** USD twin: renders usdAmount + rate inputs + computed read-only UZS equation */
  usd?: boolean;
  usdAmount?: Money | number | null;
  rate?: Money | number | null;
  onUsdChange?: (v: { usdAmount: string; rate: string; uzs: string }) => void;
  className?: string;
  style?: CSSProperties;
}

const groupInt = (v: string | number | undefined): string =>
  `${v ?? ''}`.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const stripDigits = (v: string | undefined): string => (v ?? '').replace(/[^\d]/g, '');

/**
 * MoneyInput — the one money entry control (04 §2.10). Live space grouping,
 * «so'm» suffix, numeric inputmode, min 1, optional advisory max (helper text +
 * one-click «max» chip), USD twin (usdAmount + rate → read-only UZS equation).
 * Prefilled values select on focus so one keystroke replaces them.
 */
export function MoneyInput(props: MoneyInputProps) {
  return props.usd ? <UsdTwin {...props} /> : <UzsInput {...props} />;
}

function UzsInput({
  value,
  onChange,
  max,
  maxLabel,
  min = 1,
  unit,
  placeholder = '0',
  disabled,
  autoFocus,
  id,
  status,
  className,
  style,
}: MoneyInputProps) {
  const { token } = theme.useToken();
  const t = useT();
  // R15 — telefonda autoFocus iOS klaviaturasini ko'taradi va drawer footeridagi
  // «Saqlash» tugmasini yopib qo'yadi.
  const isPhone = useIsPhone();
  const controlled = value !== undefined;
  const [inner, setInner] = useState<string>(value != null ? String(value) : '');
  const current = controlled ? (value == null ? '' : String(value)) : inner;

  const maxN = max != null ? num(max) : null;
  const over = maxN != null && num(current) > maxN;

  const emit = (v: string) => {
    if (!controlled) setInner(v);
    onChange?.(v);
  };

  return (
    <div className={className} style={style}>
      <InputNumber<string>
        stringMode
        id={id}
        value={current === '' ? null : current}
        onChange={(v) => emit(v ?? '')}
        formatter={groupInt}
        parser={stripDigits}
        min={String(min)}
        controls={false}
        disabled={disabled}
        autoFocus={autoFocus && !isPhone}
        placeholder={placeholder}
        status={status ?? (over ? 'error' : undefined)}
        inputMode="numeric"
        onFocus={(e) => e.target.select()}
        suffix={<span style={{ color: token.colorTextTertiary }}>{unit ?? t("so'm")}</span>}
        style={{ width: '100%' }}
      />
      {maxN != null && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 8,
            rowGap: 2,
            marginTop: 4,
          }}
        >
          <Typography.Text type={over ? 'danger' : 'secondary'} style={{ fontSize: 12, minWidth: 0 }}>
            {over
              ? t("Chegara: {sum} so'm", { sum: fmtMoney(maxN) })
              : maxLabel ?? t("Ko'pi bilan: {sum} so'm", { sum: fmtMoney(maxN) })}
          </Typography.Text>
          <Button
            size="small"
            type="link"
            // «max» — chekka o'ng tomondagi kichik nishon; telefonda barmoq
            // uchun 44px baland bo'ladi, lekin manfiy margin bilan qator
            // balandligi o'zgarmaydi.
            style={
              isPhone
                ? { padding: '0 8px', height: 44, marginBlock: -11, fontSize: 12, flex: '0 0 auto' }
                : { padding: '0 4px', height: 'auto', fontSize: 12 }
            }
            onClick={() => emit(String(maxN))}
          >
            {/* «max» — universal qisqartma/token. t() ga o'ralsa uz-cyrl
                transliteratsiyasi uni «мах» qilib yuboradi, shuning uchun
                brend/token so'zlar kabi o'zgarmas qoladi. */}
            max
          </Button>
        </div>
      )}
    </div>
  );
}

function UsdTwin({
  usdAmount,
  rate,
  onUsdChange,
  onChange,
  disabled,
  autoFocus,
  className,
  style,
}: MoneyInputProps) {
  const { token } = theme.useToken();
  const t = useT();
  const isPhone = useIsPhone();
  const usdControlled = usdAmount !== undefined;
  const rateControlled = rate !== undefined;
  const [usdInner, setUsdInner] = useState<string>(usdAmount != null ? String(usdAmount) : '');
  const [rateInner, setRateInner] = useState<string>(rate != null ? String(rate) : '');
  const usdVal = usdControlled ? (usdAmount == null ? '' : String(usdAmount)) : usdInner;
  const rateVal = rateControlled ? (rate == null ? '' : String(rate)) : rateInner;

  const computeUzs = (u: string, r: string): string =>
    u && r ? String(Math.round(num(u) * num(r))) : '';
  const uzs = computeUzs(usdVal, rateVal);

  const emit = (nextUsd: string, nextRate: string) => {
    if (!usdControlled) setUsdInner(nextUsd);
    if (!rateControlled) setRateInner(nextRate);
    const u = computeUzs(nextUsd, nextRate);
    onUsdChange?.({ usdAmount: nextUsd, rate: nextRate, uzs: u });
    onChange?.(u);
  };

  return (
    <div className={className} style={style}>
      {/* telefonda ikkala maydon 16px shrift bilan bir qatorga sig'maydi
          ($ prefiks + «Kurs» + «so'm» suffiksi) — ustunga tushiriladi. */}
      <div style={{ display: 'flex', flexDirection: isPhone ? 'column' : 'row', gap: 8 }}>
        <InputNumber<string>
          stringMode
          value={usdVal === '' ? null : usdVal}
          onChange={(v) => emit(v ?? '', rateVal)}
          min="0"
          step="0.01"
          precision={2}
          prefix="$"
          controls={false}
          disabled={disabled}
          autoFocus={autoFocus && !isPhone}
          placeholder="0.00"
          inputMode="decimal"
          onFocus={(e) => e.target.select()}
          style={{ flex: 1, minWidth: 0, width: isPhone ? '100%' : undefined }}
        />
        <InputNumber<string>
          stringMode
          value={rateVal === '' ? null : rateVal}
          onChange={(v) => emit(usdVal, v ?? '')}
          min="0"
          formatter={groupInt}
          parser={stripDigits}
          controls={false}
          disabled={disabled}
          placeholder={t('Kurs')}
          inputMode="numeric"
          onFocus={(e) => e.target.select()}
          suffix={<span style={{ color: token.colorTextTertiary }}>{t("so'm")}</span>}
          style={{ flex: 1, minWidth: 0, width: isPhone ? '100%' : undefined }}
        />
      </div>
      <div style={{ marginTop: 6, fontSize: 13 }}>
        {uzs ? (
          <MoneyCell value={uzs} variant="neutral" usd={{ amount: usdVal, rate: rateVal }} />
        ) : (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('USD summa va kursni kiriting')}
          </Typography.Text>
        )}
      </div>
    </div>
  );
}
