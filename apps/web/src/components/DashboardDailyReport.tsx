import { Fragment, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, App, Button, Skeleton, theme } from 'antd';
import { FileExcelOutlined, LeftOutlined, RightOutlined } from '@ant-design/icons';
import { blobError, endpoints } from '../lib/api';
import { fmtDate } from '../lib/format';
import type { DailyReportRow } from '../lib/types';
import { ErrorState } from './EmptyState';
import { useT } from './LangContext';
import { useThemeMode } from './ThemeContext';
import './DashboardDailyReport.css';

const DAYS_PER_PAGE = 31;

/** Format the exact Decimal string; large balances and cents never pass through JS floats. */
function cellText(value: string | null | undefined): string {
  if (value == null) return '…';
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return value;
  const [, sign, whole, fraction = ''] = match;
  const cents = fraction.replace(/0+$/, '');
  const zero = !/[1-9]/.test(whole + fraction);
  if (zero) return '—';
  const decimal = cents ? `,${cents.padEnd(2, '0')}` : '';
  return `${sign ? '−' : ''}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0')}${decimal}`;
}

function valueClass(value: string | null | undefined): string {
  return typeof value === 'string' && /^-/.test(value) && /[1-9]/.test(value)
    ? 'sb-daily-report__negative'
    : '';
}

export default function DashboardDailyReport({ from, to }: { from: string; to: string }) {
  const t = useT();
  const { token } = theme.useToken();
  const { mode } = useThemeMode();
  const { message } = App.useApp();
  const exportInFlight = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rangeKey = `${from}:${to}`;
  const [pageState, setPageState] = useState({ range: rangeKey, page: 0 });
  useEffect(() => { scrollRef.current?.scrollTo({ left: 0 }); }, [from, to]);
  const reportQ = useQuery({
    queryKey: ['dashboard', 'daily-report', from, to],
    queryFn: ({ signal }) => endpoints.dashboardDailyReport({ from, to }, signal),
  });
  // A changed range must never show the previous period's balances or export its data.
  const report = reportQ.data?.from === from && reportQ.data.to === to ? reportQ.data : undefined;
  const pageCount = Math.max(1, Math.ceil((report?.days.length ?? 0) / DAYS_PER_PAGE));
  const page = Math.min(pageState.range === rangeKey ? pageState.page : 0, pageCount - 1);
  const start = page * DAYS_PER_PAGE;
  const days = report?.days.slice(start, start + DAYS_PER_PAGE) ?? [];
  const exportXlsx = useMutation({
    mutationFn: (range: { from: string; to: string }) => endpoints.dashboardDailyReportXlsx(range),
    onSuccess: (_, range) => message.success(t('Kunlik hisob Excelga yuklab olindi: {from} — {to}', {
      from: fmtDate(range.from), to: fmtDate(range.to),
    })),
    onError: async (error) => message.error(`${t('Hisobotni Excelga yuklab bo‘lmadi')}: ${await blobError(error)}`),
    onSettled: () => { exportInFlight.current = false; },
  });
  const download = () => {
    if (!report || reportQ.isFetching || reportQ.isError || exportInFlight.current) return;
    exportInFlight.current = true;
    exportXlsx.mutate({ from, to });
  };
  const changePage = (next: number) => {
    setPageState({ range: rangeKey, page: next });
    scrollRef.current?.scrollTo({ left: 0 });
  };
  const totalHint = (row: DailyReportRow) => t(row.totalMode === 'opening'
    ? 'Davr boshidagi qoldiq'
    : row.totalMode === 'closing' ? 'Davr oxiridagi qoldiq' : 'Tanlangan davr yig‘indisi');
  const variables = {
    '--daily-border': token.colorBorderSecondary,
    '--daily-text': token.colorText,
    '--daily-muted': token.colorTextSecondary,
    '--daily-surface': token.colorBgContainer,
    '--daily-green': mode === 'dark' ? '#1d3528' : '#e4f2dc',
    '--daily-blue': mode === 'dark' ? '#173643' : '#d8f0fa',
    '--daily-peach': mode === 'dark' ? '#423126' : '#fbe7da',
    '--daily-yellow': mode === 'dark' ? '#4c4413' : '#fff2a6',
    '--daily-total': mode === 'dark' ? '#22394e' : '#deebf5',
    '--daily-negative': mode === 'dark' ? '#ff9993' : '#c23030',
  } as CSSProperties;

  return (
    <section className="sb-panel sb-daily-report" style={variables} aria-labelledby="daily-report-title">
      <div className="sb-daily-report__heading">
        <div className="sb-daily-report__identity">
          <span className="sb-daily-report__eyebrow">{t('Kunlik hisobot')} · {t('Barcha zavodlar')}</span>
          <h2 id="daily-report-title">{t('Zavod bo‘yicha kunlik hisob')}</h2>
          <p>{fmtDate(from)}{from === to ? '' : ` — ${fmtDate(to)}`} · {t('Toshkent vaqti')}</p>
        </div>
        <Button
          icon={<FileExcelOutlined />}
          loading={exportXlsx.isPending}
          disabled={!report || reportQ.isFetching || reportQ.isError}
          onClick={download}
          className="sb-daily-report__export"
        >
          {t('Excel — tanlangan davr')}
        </Button>
      </div>

      <div className="sb-daily-report__context">
        <span>{t('Sana yoki davrni yuqoridagi filtrdan tanlang.')}</span>
        <span className="sb-daily-report__legend">{t('Manfiy qoldiq — zavodga qarz; musbat qoldiq — avans.')}</span>
        {report && <span>{t('Poddon narxi')}: <strong className="num">{cellText(report.palletUnitPrice)} {t('so‘m')}</strong></span>}
      </div>

      {reportQ.isError ? (
        <ErrorState error={reportQ.error} onRetry={() => reportQ.refetch()} />
      ) : !report ? (
        <div className="sb-daily-report__loading" role="status" aria-label={t('Hisobot yuklanmoqda')}>
          <Skeleton active paragraph={{ rows: 7 }} title={false} />
        </div>
      ) : (
        <>
          {report.warnings.length > 0 && (
            <div className="sb-daily-report__warnings">
              <Alert
                type="warning"
                showIcon
                title={t('Hisob bo‘yicha izoh')}
                description={<ul>{report.warnings.map((warning, i) => <li key={i}>{t(warning)}</li>)}</ul>}
              />
            </div>
          )}

          <div className="sb-daily-report__navigation">
            <span aria-live="polite">
              {reportQ.isFetching ? t('Hisobot yangilanmoqda…') : (
                <>{t('{n} kun', { n: report.days.length })}{pageCount > 1 && ` · ${t('Ko‘rinayotgan kunlar')}: ${fmtDate(days[0])} — ${fmtDate(days[days.length - 1])}`}</>
              )}
            </span>
            {pageCount > 1 && (
              <div className="sb-daily-report__paging">
                <Button size="small" icon={<LeftOutlined />} disabled={page === 0} onClick={() => changePage(page - 1)} aria-label={t('Oldingi kunlar')} />
                <span className="num">{page + 1} / {pageCount}</span>
                <Button size="small" icon={<RightOutlined />} disabled={page === pageCount - 1} onClick={() => changePage(page + 1)} aria-label={t('Keyingi kunlar')} />
              </div>
            )}
          </div>

          <div ref={scrollRef} className="sb-daily-report__scroll" tabIndex={0} role="region" aria-label={t('Kunlik hisob jadvali. Boshqa sanalar uchun yon tomonga suring.')}>
            <table className="sb-daily-report__table">
              <caption className="sb-daily-report__sr-only">{t('Zavod bo‘yicha kunlik hisob')}: {fmtDate(from)} — {fmtDate(to)}. {t('Pul summalari so‘mda, poddon miqdori donada.')}</caption>
              <thead>
                <tr>
                  <th scope="col" className="sb-daily-report__label">{t('Gazoblok')}</th>
                  {days.map((day) => <th scope="col" key={day}>{fmtDate(day)}</th>)}
                  <th scope="col" className="sb-daily-report__period-total">{t('Jami')}<span>{t('Butun tanlangan davr')}</span></th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row, index) => (
                  <Fragment key={row.key}>
                    {index > 0 && row.section !== report.rows[index - 1].section && row.section !== 'pallets' && (
                      <tr aria-hidden="true" className="sb-daily-report__separator"><td colSpan={days.length + 2} /></tr>
                    )}
                    <tr className={`sb-daily-report__row sb-daily-report__row--${row.tone}`}>
                      <th scope="row" className="sb-daily-report__label">{t(row.label)}</th>
                      {days.map((day, offset) => {
                        const value = row.values[start + offset];
                        return <td key={day} className={`num ${valueClass(value)}`}>{cellText(value)}</td>;
                      })}
                      <td className={`sb-daily-report__period-total num ${valueClass(row.total)}`} title={totalHint(row)}>
                        {cellText(row.total)}
                        {row.totalMode !== 'sum' && <span className="sb-daily-report__balance-caption">{t(row.totalMode === 'opening' ? 'Davr boshi' : 'Davr oxiri')}</span>}
                      </td>
                    </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          <div className="sb-daily-report__footer">
            <p>{t('Jami: harakatlar — davr yig‘indisi; qoldiqlar — davr boshi yoki oxiridagi holat. Excelga tanlangan davrdagi barcha kunlar chiqadi.')}</p>
            {report.notes.length > 0 && (
              <details>
                <summary>{t('Hisoblash izohlari')}</summary>
                <ul>{report.notes.map((note, i) => <li key={i}>{t(note)}</li>)}</ul>
              </details>
            )}
          </div>
        </>
      )}
    </section>
  );
}
