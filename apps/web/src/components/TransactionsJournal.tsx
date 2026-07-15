// TransactionsJournal — the whole-system money-movement journal (every cash + bank
// CashTransaction, all sources). Payments page «Tranzaksiyalar» view. A row is one
// signed movement on one account; PAYMENT rows open the full PaymentPeek (void ritual),
// other rows open a compact read-only detail. Per-currency KIRIM/CHIQIM/SOF summary.
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Select, theme } from 'antd';
import { endpoints } from '../lib/api';
import { fmtDate, fmtDateTime, fmtMoney, num } from '../lib/format';
import { useUrlFilters } from '../lib/useUrlFilters';
import { translate } from '../lib/i18n';
import { CASHBOX_TYPE, CURRENCY, type CashboxType, type StatusMeta } from '../lib/status-maps';
import type { Money, PaymentKind, PaymentMethod } from '../lib/types';
import { DataTable, type SbColumn } from './DataTable';
import { TableCard } from './TableCard';
import { CashboxSelect } from './PartySelect';
import { DateRangeControl } from './DateRangeControl';
import { MoneyCell } from './MoneyCell';
import { StatusChip } from './StatusChip';
import { PeekPanel } from './PeekPanel';
import { totalsRow } from './TotalsRow';
import { useT } from './LangContext';

type CashSource = 'MANUAL' | 'PAYMENT' | 'EXPENSE' | 'BONUS_WITHDRAWAL' | 'REVERSAL';

interface BoxRef {
  id: string;
  name: string;
  type: CashboxType;
  currency: 'UZS' | 'USD';
}
interface JournalRow {
  id: string;
  date: string;
  direction: 'IN' | 'OUT';
  amount: Money;
  rate?: Money;
  source: CashSource;
  note?: string | null;
  cashbox?: BoxRef | null;
  payment?: {
    id: string;
    kind: PaymentKind;
    method: PaymentMethod;
    amount: Money;
    voidedAt?: string | null;
    client?: { id: string; name: string } | null;
    factory?: { id: string; name: string } | null;
    vehicle?: { id: string; name: string } | null;
  } | null;
  expense?: { id: string; note?: string | null; category?: { id: string; name: string } | null } | null;
  bonusTransaction?: { id: string; factory?: { id: string; name: string } | null } | null;
  reversedBy?: { id: string } | null;
  createdBy?: { id: string; name: string } | null;
}

const SOURCE_META: Record<CashSource, StatusMeta> = {
  PAYMENT: { label: "To'lov", light: '#2563EB', dark: '#60A5FA' },
  MANUAL: { label: "Qo'lda", light: '#64748B', dark: '#94A3B8' },
  EXPENSE: { label: 'Xarajat', light: '#EA580C', dark: '#FB923C' },
  BONUS_WITHDRAWAL: { label: 'Bonus yechish', light: '#7C3AED', dark: '#A78BFA' },
  REVERSAL: { label: 'Storno', light: '#C2413B', dark: '#E8827C' },
};

const SOURCE_OPTIONS = (Object.keys(SOURCE_META) as CashSource[]).map((s) => ({
  value: s,
  label: SOURCE_META[s].label,
}));

/** counterparty text/link derived from the linked document. */
function counterparty(r: JournalRow): ReactNode {
  const link = (to: string, label: string) => <Link to={to}>{label}</Link>;
  if (r.payment) {
    const p = r.payment;
    if (p.kind === 'TRANSPORT_DIRECT') {
      return `${p.client?.name ?? '—'} → ${p.vehicle?.name ?? '—'}`;
    }
    if (p.client) return link(`/clients/${p.client.id}`, p.client.name);
    if (p.factory) return link(`/factories/${p.factory.id}`, p.factory.name);
    if (p.vehicle) return link(`/vehicles/${p.vehicle.id}`, p.vehicle.name);
  }
  if (r.expense) return r.expense.category?.name ?? translate('Xarajat');
  if (r.bonusTransaction?.factory) return `${translate('Bonus')} · ${r.bonusTransaction.factory.name}`;
  return '—';
}

export interface TransactionsJournalProps {
  /** open the full payment surface for a PAYMENT-source row. */
  onOpenPayment: (paymentId: string) => void;
}

export function TransactionsJournal({ onOpenPayment }: TransactionsJournalProps) {
  const { token } = theme.useToken();
  const t = useT();
  const uf = useUrlFilters(['jsource', 'jdir', 'jbox', 'jfrom', 'jto']);

  const source = uf.get('jsource') || undefined;
  const direction = uf.get('jdir') || undefined;
  const cashboxId = uf.get('jbox') || undefined;
  const dateFrom = uf.get('jfrom') || undefined;
  const dateTo = uf.get('jto') || undefined;
  const page = Number(uf.get('page')) || 1;
  const pageSize = Number(uf.get('pageSize')) || 20;

  const anyFilter = !!(source || direction || cashboxId || dateFrom || dateTo);

  const q = useQuery({
    queryKey: ['kassa', 'journal', { page, pageSize, source, direction, cashboxId, dateFrom, dateTo }],
    queryFn: () =>
      endpoints.kassaTransactions({ page, pageSize, source, direction, cashboxId, dateFrom, dateTo }),
    placeholderData: keepPreviousData,
  });

  const [detail, setDetail] = useState<JournalRow | null>(null);

  const openRow = (r: JournalRow) => {
    if (r.source === 'PAYMENT' && r.payment) onOpenPayment(r.payment.id);
    else setDetail(r);
  };

  const columns: SbColumn<JournalRow>[] = [
    { title: 'Sana', key: 'date', width: 104, render: (_, r) => fmtDate(r.date) },
    {
      title: 'Hisob',
      key: 'box',
      width: 190,
      ellipsis: true,
      render: (_, r) =>
        r.cashbox ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span>{r.cashbox.name}</span>
            <span style={{ fontSize: 11, color: token.colorTextTertiary }}>
              {CASHBOX_TYPE[r.cashbox.type]?.label}
            </span>
          </span>
        ) : (
          '—'
        ),
    },
    {
      title: 'Manba',
      key: 'source',
      width: 130,
      render: (_, r) => <StatusChip meta={{ ...SOURCE_META[r.source], label: t(SOURCE_META[r.source].label) }} />,
    },
    { title: 'Tomon', key: 'party', ellipsis: true, render: (_, r) => counterparty(r) },
    {
      title: 'Summa',
      key: 'amount',
      align: 'right',
      width: 170,
      className: 'num',
      render: (_, r) => {
        const signed = (r.direction === 'IN' ? 1 : -1) * num(r.amount);
        const ghost = !!r.reversedBy || r.source === 'REVERSAL';
        return (
          <MoneyCell
            value={signed}
            variant={ghost ? 'ghost' : r.direction === 'IN' ? 'in' : 'neutral'}
            signed
            strong
            suffix={r.cashbox ? CURRENCY[r.cashbox.currency]?.label : undefined}
          />
        );
      },
    },
    { title: 'Izoh', key: 'note', ellipsis: true, render: (_, r) => r.note || '—' },
    {
      title: 'Kim',
      key: 'who',
      width: 130,
      ellipsis: true,
      render: (_, r) => r.createdBy?.name ?? '—',
    },
  ];

  // per-currency KIRIM / CHIQIM / SOF over the visible page (amounts are per box currency)
  const summary = (rows: readonly JournalRow[]) => {
    const acc: Record<'UZS' | 'USD', { in: number; out: number }> = {
      UZS: { in: 0, out: 0 },
      USD: { in: 0, out: 0 },
    };
    for (const r of rows) {
      if (r.source === 'REVERSAL' || r.reversedBy) continue; // net view ignores storno'd pairs
      const cur = r.cashbox?.currency ?? 'UZS';
      if (r.direction === 'IN') acc[cur].in += num(r.amount);
      else acc[cur].out += num(r.amount);
    }
    const line = (cur: 'UZS' | 'USD') => {
      const a = acc[cur];
      if (a.in === 0 && a.out === 0) return null;
      const label = CURRENCY[cur].label;
      return (
        <span key={cur} style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
          <b style={{ textTransform: 'uppercase', fontSize: 11, color: token.colorTextTertiary }}>{label}</b>
          <span>{t('Kirim')} <MoneyCell value={a.in} variant="in" signed suffix={label} /></span>
          <span>· {t('Chiqim')} <MoneyCell value={-a.out} variant="neutral" signed suffix={label} /></span>
          <span>· {t('Sof')} <MoneyCell value={a.in - a.out} variant={a.in - a.out >= 0 ? 'in' : 'neutral'} signed strong suffix={label} /></span>
        </span>
      );
    };
    const lines = [line('UZS'), line('USD')].filter(Boolean);
    return totalsRow({
      scope: 'page',
      label: t('Sahifa jami'),
      labelColSpan: 3,
      cells: [
        {
          index: 3,
          colSpan: 4,
          align: 'left',
          strong: false,
          content: (
            <span style={{ display: 'inline-flex', gap: 18, flexWrap: 'wrap', fontSize: 12, color: token.colorTextSecondary }}>
              {lines.length ? lines : <span>—</span>}
            </span>
          ),
        },
      ],
    });
  };

  const total = q.data?.total ?? 0;

  return (
    <>
      {/* filtrlar — buissnes_crm uslubidagi alohida karta */}
      <div className="sb-table-card" style={{ padding: '14px 16px', marginBottom: 16 }}>
        <div className="sb-filterbar">
          <Select
            allowClear
            placeholder={t('Manba')}
            value={source}
            onChange={(v?: string) => uf.set({ jsource: v || null })}
            options={SOURCE_OPTIONS.map((o) => ({ value: o.value, label: t(o.label) }))}
            style={{ minWidth: 150 }}
          />
          <Select
            allowClear
            placeholder={t("Yo'nalish")}
            value={direction}
            onChange={(v?: string) => uf.set({ jdir: v || null })}
            options={[
              { value: 'IN', label: t('Kirim') },
              { value: 'OUT', label: t('Chiqim') },
            ]}
            style={{ minWidth: 130 }}
          />
          <CashboxSelect
            value={cashboxId}
            allowClear
            placeholder={t('Hisob (barchasi)')}
            onChange={(id) => uf.set({ jbox: id || null })}
            style={{ minWidth: 200 }}
          />
          <DateRangeControl
            from={dateFrom}
            to={dateTo}
            onChange={({ from, to }) => uf.set({ jfrom: from || null, jto: to || null })}
          />
          {anyFilter ? (
            <a
              onClick={() => uf.clear(['jsource', 'jdir', 'jbox', 'jfrom', 'jto'])}
              style={{ fontSize: 13, cursor: 'pointer' }}
            >
              {t('Tozalash')}
            </a>
          ) : null}
          <span className="num" style={{ marginInlineStart: 'auto', color: token.colorTextSecondary, fontSize: 13 }}>
            {fmtMoney(total)} {t('ta harakat')}
          </span>
        </div>
      </div>

      <TableCard>
        <DataTable<JournalRow>
          rowKey="id"
          columns={columns}
          query={q as never}
          onRowOpen={openRow}
          summary={summary}
          ghostWhen={(r) => !!r.reversedBy || r.source === 'REVERSAL'}
          emptyText="Hali tranzaksiya yo'q"
          scroll={{ x: 1040 }}
        />
      </TableCard>

      {/* non-payment read-only detail (payment rows use the full PaymentPeek) */}
      <PeekPanel
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail ? t(SOURCE_META[detail.source].label) : ''}
        subtitle={detail ? fmtDate(detail.date) : undefined}
        width={480}
      >
        {detail ? (
          <div style={{ padding: 16 }}>
            <MoneyCell
              value={(detail.direction === 'IN' ? 1 : -1) * num(detail.amount)}
              variant={detail.direction === 'IN' ? 'in' : 'neutral'}
              signed
              strong
              suffix={detail.cashbox ? CURRENCY[detail.cashbox.currency]?.label : t("so'm")}
              style={{ fontSize: 26, lineHeight: '32px' }}
            />
            <div style={{ marginTop: 12 }}>
              <DRow label="Hisob">{detail.cashbox ? `${detail.cashbox.name} · ${CASHBOX_TYPE[detail.cashbox.type]?.label}` : '—'}</DRow>
              <DRow label="Yo'nalish">{detail.direction === 'IN' ? t('Kirim') : t('Chiqim')}</DRow>
              <DRow label="Manba">{t(SOURCE_META[detail.source].label)}</DRow>
              <DRow label="Tomon">{counterparty(detail)}</DRow>
              {detail.bonusTransaction ? <DRow label="Bonus">{t('Bonus hamyonidan yechildi')}</DRow> : null}
              {detail.createdBy?.name ? <DRow label="Kiritdi">{detail.createdBy.name}</DRow> : null}
              {detail.note ? <DRow label="Izoh">{detail.note}</DRow> : null}
              <DRow label="Vaqt">{fmtDateTime(detail.date)}</DRow>
            </div>
          </div>
        ) : null}
      </PeekPanel>
    </>
  );
}

function DRow({ label, children }: { label: string; children: ReactNode }) {
  const { token } = theme.useToken();
  const t = useT();
  return (
    <div style={{ display: 'flex', gap: 12, padding: '5px 0', fontSize: 13 }}>
      <div style={{ flex: '0 0 96px', color: token.colorTextTertiary }}>{t(label)}</div>
      <div style={{ flex: 1, minWidth: 0, color: token.colorText }}>{children}</div>
    </div>
  );
}
