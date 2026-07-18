// /print/receipt/:id — a professional, print-optimized payment receipt (kvitansiya).
// Standalone route (no AppShell): fetches GET /payments/:id and renders a clean A5-ish
// paper sheet that prints black-on-white regardless of the app theme. The peek/journal
// «Kvitansiya chop etish» action opens this. Voided / TRANSPORT_DIRECT documents are
// guarded upstream but still render a marked sheet if the URL is hit directly.
import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button, Spin } from 'antd';
import { ArrowLeftOutlined, PrinterOutlined } from '@ant-design/icons';
import { endpoints } from '../lib/api';
import { fmtDate, fmtDateTime, fmtMoney, num } from '../lib/format';
import { PAYMENT_KIND, PAYMENT_METHOD } from '../lib/status-maps';
import { sumToWordsUz } from '../lib/sumWords';
import { useT } from '../components/LangContext';
import { ErrorState } from '../components';
import type { Money, Payment } from '../lib/types';

// ── the GET /payments/:id detail shape (only the fields the receipt renders) ──
interface Ref {
  id: string;
  name: string;
  plate?: string;
}
interface AllocRow {
  id: string;
  amount: Money;
  voidedAt?: string | null;
  order?: { id: string; orderNo: string } | null;
}
type Detail = Payment & {
  createdAt?: string;
  agent?: Ref | null;
  cashbox?: { id: string; name: string } | null;
  payerName?: string | null;
  receiverName?: string | null;
  payerEntity?: Ref | null;
  receiverEntity?: Ref | null;
  createdBy?: { id: string; name: string } | null;
  allocations?: AllocRow[];
};

/** who handed the money over / who received it — drives the signature captions. */
function parties(p: Detail): { from: string; to: string } {
  const client = p.client?.name ?? '—';
  const factory = p.factory?.name ?? '—';
  const vehicle = p.vehicle?.name ?? '—';
  const US = 'Kassa';
  switch (p.kind) {
    case 'CLIENT_IN':
      return { from: client, to: US };
    case 'CLIENT_REFUND':
      return { from: US, to: client };
    case 'FACTORY_OUT':
      return { from: US, to: factory };
    case 'FACTORY_REFUND':
      return { from: factory, to: US };
    case 'VEHICLE_OUT':
      return { from: US, to: vehicle };
    case 'TRANSPORT_DIRECT':
      return { from: client, to: vehicle };
    default:
      return { from: US, to: '—' };
  }
}

function partyName(p: Detail): string {
  if (p.kind === 'TRANSPORT_DIRECT') return `${p.client?.name ?? '—'} → ${p.vehicle?.name ?? '—'}`;
  if (p.client) return p.client.name;
  if (p.factory) return p.factory.name;
  if (p.vehicle) return p.vehicle.name + (p.vehicle.plate ? ` (${p.vehicle.plate})` : '');
  return '—';
}

export default function Receipt() {
  const { id } = useParams();
  const navigate = useNavigate();
  const t = useT();

  const q = useQuery({
    queryKey: ['payments', id, 'receipt'],
    enabled: !!id,
    queryFn: () => endpoints.payment(id as string),
  });
  const p = q.data as unknown as Detail | undefined;

  const receiptNo = useMemo(() => {
    if (!p) return '';
    return `KV-${fmtDate(p.date).replace(/\./g, '')}-${p.id.slice(0, 4).toUpperCase()}`;
  }, [p]);

  const activeAllocs = (p?.allocations ?? []).filter((a) => !a.voidedAt);
  const voided = !!p?.voidedAt;

  return (
    <div className="rcpt-screen">
      <style>{RECEIPT_CSS}</style>

      <div className="rcpt-toolbar no-print">
        <Button icon={<ArrowLeftOutlined />} onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/payments'))}>
          {t('Ortga')}
        </Button>
        <Button type="primary" icon={<PrinterOutlined />} onClick={() => window.print()} disabled={!p}>
          {t('Chop etish')}
        </Button>
      </div>

      {q.isError ? (
        <div style={{ maxWidth: 520, margin: '40px auto' }}>
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        </div>
      ) : !p ? (
        <div style={{ textAlign: 'center', padding: '20vh 0' }}>
          <Spin size="large" />
        </div>
      ) : (
        <div className="rcpt-sheet">
          {/* header */}
          <div className="rcpt-head">
            <div className="rcpt-brand">SmartBlok</div>
            <div className="rcpt-title">{t("TO'LOV KVITANSIYASI")}</div>
            <div className="rcpt-sub">
              № {receiptNo} · {fmtDateTime(p.date)}
            </div>
          </div>

          {voided ? <div className="rcpt-void">{t('BEKOR QILINGAN')}</div> : null}

          {/* meta */}
          <div className="rcpt-rows">
            <Row label={t('Turi')} value={PAYMENT_KIND[p.kind]?.label ?? p.kind} />
            <Row label={t('Sana')} value={fmtDate(p.date)} />
            <Row label={t('Tomon')} value={partyName(p)} />
            <Row label={t("To'lov usuli")} value={PAYMENT_METHOD[p.method]?.label ?? p.method} />
            {p.cashbox && p.kind !== 'TRANSPORT_DIRECT' ? <Row label={t('Kassa')} value={p.cashbox.name} /> : null}
            {p.agent?.name ? <Row label={t('Agent')} value={p.agent.name} /> : null}
            {p.payerEntity?.name || p.payerName ? (
              <Row label={t("To'lovchi")} value={p.payerEntity?.name ?? (p.payerName as string)} />
            ) : null}
            {p.receiverEntity?.name || p.receiverName ? (
              <Row label={t('Qabul qiluvchi')} value={p.receiverEntity?.name ?? (p.receiverName as string)} />
            ) : null}
            {p.note ? <Row label={t('Izoh')} value={p.note} /> : null}
          </div>

          {/* amount */}
          <div className="rcpt-amount">
            <div className="rcpt-amount-label">{t('Summa')}</div>
            <div className="rcpt-amount-value">
              {fmtMoney(p.amount)} <span className="rcpt-cur">{t("so'm")}</span>
            </div>
            {p.method === 'USD' && num(p.usdAmount) > 0 ? (
              <div className="rcpt-amount-usd">
                ${fmtMoney(p.usdAmount)} × {fmtMoney(p.rate)}
              </div>
            ) : null}
            <div className="rcpt-words">
              {t('Yozib')}: {sumToWordsUz(num(p.amount))} {t("so'm")}
            </div>
          </div>

          {/* allocations */}
          {activeAllocs.length ? (
            <div className="rcpt-allocs">
              <div className="rcpt-allocs-title">{t('Taqsimlangan buyurtmalar')}</div>
              {activeAllocs.map((a) => (
                <div className="rcpt-alloc-row" key={a.id}>
                  <span>{a.order?.orderNo ?? '—'}</span>
                  <span className="num">{fmtMoney(a.amount)} {t("so'm")}</span>
                </div>
              ))}
            </div>
          ) : null}

          {/* signatures */}
          <div className="rcpt-sign">
            <div className="rcpt-sign-col">
              <div className="rcpt-sign-line" />
              <div className="rcpt-sign-cap">{t('Topshirdi')} · {parties(p).from}</div>
            </div>
            <div className="rcpt-sign-col">
              <div className="rcpt-sign-line" />
              <div className="rcpt-sign-cap">{t('Qabul qildi')} · {parties(p).to}</div>
            </div>
          </div>

          {/* footer */}
          <div className="rcpt-foot">
            {p.createdBy?.name ? `${t('Kiritdi')}: ${p.createdBy.name} · ` : ''}
            {t('SmartBlok tizimi orqali chiqarildi')}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="rcpt-row">
      <div className="rcpt-row-label">{label}</div>
      <div className="rcpt-row-value">{value}</div>
    </div>
  );
}

// Fixed light palette + print rules — the sheet must look identical on screen and paper,
// independent of the app's dark/light theme (the receipt is a formal document).
const RECEIPT_CSS = `
.rcpt-screen { min-height: 100vh; background: #f1f5f9; padding: 24px 16px 64px; }
.rcpt-toolbar { max-width: 520px; margin: 0 auto 16px; display: flex; justify-content: space-between; gap: 12px; }
.rcpt-sheet {
  max-width: 520px; margin: 0 auto; background: #ffffff; color: #111827;
  border: 1px solid #e5e7eb; border-radius: 10px; padding: 28px 32px 24px;
  box-shadow: 0 6px 24px rgba(15,23,42,0.08); font-size: 14px; line-height: 1.5;
}
.rcpt-head { text-align: center; border-bottom: 2px solid #111827; padding-bottom: 14px; margin-bottom: 16px; }
.rcpt-brand { font-weight: 800; letter-spacing: 0.14em; font-size: 15px; color: #1d4ed8; text-transform: uppercase; }
.rcpt-title { font-size: 20px; font-weight: 700; margin-top: 6px; letter-spacing: 0.02em; }
.rcpt-sub { margin-top: 4px; font-size: 12px; color: #6b7280; font-variant-numeric: tabular-nums; }
.rcpt-void {
  margin: 0 0 16px; text-align: center; font-weight: 700; letter-spacing: 0.2em;
  color: #b91c1c; border: 2px dashed #b91c1c; border-radius: 8px; padding: 6px;
}
.rcpt-rows { margin-bottom: 6px; }
.rcpt-row { display: flex; gap: 12px; padding: 6px 0; border-bottom: 1px dotted #e5e7eb; }
.rcpt-row-label { flex: 0 0 130px; color: #6b7280; }
.rcpt-row-value { flex: 1; min-width: 0; font-weight: 500; color: #111827; }
.rcpt-amount { margin: 18px 0 10px; text-align: center; background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 8px; padding: 14px; }
.rcpt-amount-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: #6b7280; }
.rcpt-amount-value { font-size: 28px; font-weight: 800; margin-top: 4px; font-variant-numeric: tabular-nums; }
.rcpt-cur { font-size: 15px; font-weight: 600; color: #6b7280; }
.rcpt-amount-usd { font-size: 12px; color: #6b7280; margin-top: 2px; font-variant-numeric: tabular-nums; }
.rcpt-words { margin-top: 8px; font-size: 12px; color: #374151; font-style: italic; }
.rcpt-words::first-letter { text-transform: uppercase; }
.rcpt-allocs { margin: 14px 0; }
.rcpt-allocs-title { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #6b7280; margin-bottom: 6px; }
.rcpt-alloc-row { display: flex; justify-content: space-between; padding: 3px 0; font-variant-numeric: tabular-nums; }
.rcpt-sign { display: flex; gap: 28px; margin-top: 34px; }
.rcpt-sign-col { flex: 1; text-align: center; }
.rcpt-sign-line { border-top: 1px solid #9ca3af; margin-bottom: 6px; }
.rcpt-sign-cap { font-size: 11px; color: #6b7280; }
.rcpt-foot { margin-top: 20px; padding-top: 12px; border-top: 1px dotted #e5e7eb; text-align: center; font-size: 11px; color: #9ca3af; }
@media print {
  @page { margin: 12mm; }
  .rcpt-screen { background: #ffffff; padding: 0; }
  .no-print { display: none !important; }
  .rcpt-sheet { max-width: none; border: none; border-radius: 0; box-shadow: none; padding: 0; }
}
`;
