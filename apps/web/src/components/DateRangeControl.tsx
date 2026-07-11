// DateRangeControl (04 §3.6, 02 §7) — one period-control language everywhere.
// Preset chips (Bugun · Kecha · 7 kun · Shu oy · O'tgan oy · Shu yil · Oraliq…)
// plus an AntD RangePicker for custom ranges. Controlled with YYYY-MM-DD strings
// and a single { from, to } onChange; the active preset is derived, not stored.
// The Tashkent-day basis is stated in the picker footer (02 §7). Compact.
import { useMemo, useState } from 'react';
import { Button, DatePicker, theme } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';

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

interface Preset {
  key: string;
  label: string;
  range: () => [Dayjs, Dayjs];
}

/** Presets computed against "now" each render (day boundaries move). */
function buildPresets(): Preset[] {
  const today = dayjs();
  return [
    { key: 'bugun', label: 'Bugun', range: () => [today.startOf('day'), today.endOf('day')] },
    {
      key: 'kecha',
      label: 'Kecha',
      range: () => [today.subtract(1, 'day').startOf('day'), today.subtract(1, 'day').endOf('day')],
    },
    { key: '7kun', label: '7 kun', range: () => [today.subtract(6, 'day').startOf('day'), today.endOf('day')] },
    { key: 'shu-oy', label: 'Shu oy', range: () => [today.startOf('month'), today.endOf('month')] },
    {
      key: 'otgan-oy',
      label: "O'tgan oy",
      range: () => {
        const prev = today.subtract(1, 'month');
        return [prev.startOf('month'), prev.endOf('month')];
      },
    },
    { key: 'shu-yil', label: 'Shu yil', range: () => [today.startOf('year'), today.endOf('year')] },
  ];
}

export function DateRangeControl({ from, to, onChange, size = 'small' }: DateRangeControlProps) {
  const { token } = theme.useToken();
  const [open, setOpen] = useState(false);
  const presets = useMemo(buildPresets, []);

  const activeKey = useMemo(() => {
    if (!from || !to) return undefined;
    for (const p of presets) {
      const [s, e] = p.range();
      if (s.format(FMT) === from && e.format(FMT) === to) return p.key;
    }
    return 'custom';
  }, [from, to, presets]);

  const applyPreset = (p: Preset) => {
    const [s, e] = p.range();
    onChange({ from: s.format(FMT), to: e.format(FMT) });
  };

  return (
    <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      {presets.map((p) => (
        <Button
          key={p.key}
          size={size}
          type={activeKey === p.key ? 'primary' : 'default'}
          onClick={() => applyPreset(p)}
        >
          {p.label}
        </Button>
      ))}
      <Button
        size={size}
        type={activeKey === 'custom' ? 'primary' : 'default'}
        onClick={() => setOpen(true)}
      >
        Oraliq…
      </Button>
      <RangePicker
        size={size}
        open={open}
        onOpenChange={setOpen}
        value={from && to ? [dayjs(from), dayjs(to)] : null}
        format="DD.MM.YYYY"
        allowClear
        onChange={(vals) => {
          const start = vals?.[0];
          const end = vals?.[1];
          if (!start || !end) onChange({ from: undefined, to: undefined });
          else onChange({ from: start.format(FMT), to: end.format(FMT) });
        }}
        renderExtraFooter={() => (
          <span style={{ fontSize: 12, color: token.colorTextTertiary }}>
            Toshkent kuni bo'yicha
          </span>
        )}
      />
    </div>
  );
}
