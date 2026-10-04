import { useEffect, useState } from 'react';
import { Button, DatePicker, Segmented, theme } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { fmtDate, fmtNum } from '../lib/format';
import { useIsPhone } from '../lib/responsive';
import { useT } from './LangContext';

type Period = { from: string; to: string };

/** Both dashboard controls apply the same URL period to the cards, daily table and Excel. */
export default function DashboardPeriodFilter({
  from, to, onApply, embedded = false, onDraftChange,
}: Period & {
  onApply: (period: Period) => void;
  embedded?: boolean;
  onDraftChange?: (dirty: boolean) => void;
}) {
  const { token } = theme.useToken();
  const t = useT();
  const isPhone = useIsPhone();
  const [dFrom, setDFrom] = useState<Dayjs>(() => dayjs(from));
  const [dTo, setDTo] = useState<Dayjs>(() => dayjs(to));
  const [periodMode, setPeriodMode] = useState<'day' | 'range'>(() => from === to ? 'day' : 'range');
  useEffect(() => {
    setDFrom(dayjs(from));
    setDTo(dayjs(to));
    setPeriodMode(from === to ? 'day' : 'range');
  }, [from, to]);

  const dirty = dFrom.format('YYYY-MM-DD') !== from || dTo.format('YYYY-MM-DD') !== to;
  useEffect(() => { onDraftChange?.(dirty); }, [dirty, onDraftChange]);
  const days = dayjs(to).diff(dayjs(from), 'day') + 1;
  const tooLong = Math.abs(dTo.diff(dFrom, 'day')) + 1 > 3660;
  const noFuture = (d: Dayjs) => d.isAfter(dayjs(), 'day');
  const apply = () => {
    if (!dirty || tooLong || !dFrom.isValid() || !dTo.isValid()) return;
    const [start, end] = dFrom.isAfter(dTo) ? [dTo, dFrom] : [dFrom, dTo];
    setDFrom(start);
    setDTo(end);
    onApply({ from: start.format('YYYY-MM-DD'), to: end.format('YYYY-MM-DD') });
  };

  return (
    <div
      role="group"
      aria-label={t(embedded ? 'Zavod hisobotining davri' : 'Dashboard davri')}
      className={embedded ? 'sb-daily-report__period' : 'sb-panel'}
      style={embedded ? undefined : { marginBottom: isPhone ? 12 : 18, padding: isPhone ? '10px 12px' : '12px 14px' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: isPhone ? 10 : 8, minWidth: 0 }}>
        <span style={{ color: token.colorTextSecondary, fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', ...(isPhone ? { width: '100%' } : { marginRight: 2 }) }}>
          {t('Davr')}
        </span>
        <Segmented
          value={periodMode}
          options={[{ label: t('Bir kun'), value: 'day' }, { label: t('Sana oralig‘i'), value: 'range' }]}
          onChange={(value) => {
            setPeriodMode(value as 'day' | 'range');
            if (value === 'day') setDTo(dFrom);
          }}
          aria-label={t('Hisobot davri turi')}
          block={isPhone}
          style={isPhone ? { width: '100%' } : undefined}
        />
        <DatePicker
          value={dFrom}
          onChange={(d) => {
            if (!d) return;
            setDFrom(d);
            if (periodMode === 'day') setDTo(d);
          }}
          format="DD.MM.YYYY"
          allowClear={false}
          disabledDate={noFuture}
          aria-label={t(periodMode === 'day' ? 'Hisobot sanasi' : 'Boshlanish sanasi')}
          inputReadOnly={isPhone}
          suffixIcon={isPhone ? null : undefined}
          style={isPhone ? { flex: '1 1 0', minWidth: 0 } : undefined}
        />
        {periodMode === 'range' && (
          <>
            <span style={{ color: token.colorTextTertiary }}>—</span>
            <DatePicker
              value={dTo}
              onChange={(d) => d && setDTo(d)}
              format="DD.MM.YYYY"
              allowClear={false}
              disabledDate={noFuture}
              aria-label={t('Tugash sanasi')}
              inputReadOnly={isPhone}
              suffixIcon={isPhone ? null : undefined}
              style={isPhone ? { flex: '1 1 0', minWidth: 0 } : undefined}
            />
          </>
        )}
        <Button type="primary" onClick={apply} disabled={!dirty || tooLong} block={isPhone}>
          {t("Qo'llash")}
        </Button>
        <span className="num" style={{ fontSize: 12, color: token.colorTextTertiary, ...(isPhone ? { width: '100%' } : null) }}>
          {fmtDate(from)} – {fmtDate(to)} · {t('{n} kun', { n: fmtNum(days) })}
        </span>
      </div>
      {(tooLong || dirty) && (
        <p role="status" style={{ margin: '10px 0 0', fontSize: 12, color: tooLong ? token.colorError : token.colorTextSecondary }}>
          {t(tooLong ? 'Bitta hisobot davri 3660 kundan oshmasligi kerak' : 'Tanlangan sanalar bo‘yicha hisobni ko‘rish uchun «Qo‘llash»ni bosing.')}
        </p>
      )}
    </div>
  );
}
