// DateRangeControl (04 §3.6, 02 §7) — one period-control language everywhere.
// A single date-to-date RangePicker (no quick presets — the owner mandated
// date-to-date only). Controlled with YYYY-MM-DD strings and a single
// { from, to } onChange. The Tashkent-day basis is stated in the picker footer.
import { DatePicker, theme } from 'antd';
import dayjs from 'dayjs';

const { RangePicker } = DatePicker;

const FMT = 'YYYY-MM-DD';

export interface DateRange {
  from?: string;
  to?: string;
}

export interface DateRangeControlProps {
  from?: string;
  to?: string;
  onChange: (range: DateRange) => void;
  size?: 'small' | 'middle' | 'large';
}

export function DateRangeControl({ from, to, onChange, size = 'small' }: DateRangeControlProps) {
  const { token } = theme.useToken();

  return (
    <RangePicker
      size={size}
      value={from && to ? [dayjs(from), dayjs(to)] : null}
      format="DD.MM.YYYY"
      allowClear
      placeholder={['Boshlanish', 'Tugash']}
      onChange={(vals) => {
        const start = vals?.[0];
        const end = vals?.[1];
        if (!start || !end) onChange({ from: undefined, to: undefined });
        else onChange({ from: start.format(FMT), to: end.format(FMT) });
      }}
      renderExtraFooter={() => (
        <span style={{ fontSize: 12, color: token.colorTextTertiary }}>Toshkent kuni bo'yicha</span>
      )}
    />
  );
}
