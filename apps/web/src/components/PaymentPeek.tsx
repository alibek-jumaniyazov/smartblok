// PaymentPeek (money.md §2) — the canonical money-document surface rendered
// inside the docked PeekPanel for `/payments/:id` (and `?peek=<id>` over the
// register). Consumes GET /payments/:id (endpoints.payment): the detail payload
// carries parties, payer/receiver entity, createdBy/voidedBy, allocations (incl.
// voided), ledgerEntries and cashTransactions — the peek and every
// LedgerImpactPreview build from THIS payload, zero new endpoints (fact 0.3).
//
// Body: kind chip + date header, amount money-lg (+ USD equation), description
// rows (Tomon linked to the party page, payer/receiver entity or «(yozma)» free
// text, createdBy), Taqsimotlar mini-table (allocations incl. voided ghost rows,
// «Taqsimlanmagan qoldiq» line, [Taqsimlash] → SettleDrawer via ?panel=taqsimlash),
// Ledger yozuvlari (through the LEDGER_SOURCE map, signed MoneyCell, storno pairs
// chained), Kassa harakati rows, TRANSPORT_DIRECT fixed info line, voided danger
// banner. Footer: [Kvitansiya chop etish] (→ /print/receipt/:id) + [Bekor qilish]
// (ReasonModal §2.4 with a payload-built LedgerImpactPreview). K/G: footer only
// Kvitansiya; allocation block read-only «Taqsimlashni buxgalter bajaradi».
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { App, Button, theme } from 'antd';
import { PrinterOutlined } from '@ant-design/icons';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiError, endpoints } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { can } from '../lib/permissions';
import { fmtDate, fmtDateTime, fmtMoney, num } from '../lib/format';
import { sumToWordsUz } from '../lib/sumWords';
import { translate, interpolate } from '../lib/i18n';
import {
  CASH_DIRECTION,
  LEDGER_SOURCE,
  PAYMENT_KIND,
  PAYMENT_METHOD,
  PRICE_KIND,
  UNRECONCILED,
  type CashSource,
  type LedgerAccount,
  type LedgerSource,
  type LegalEntityKind,
  type StatusMeta,
} from '../lib/status-maps';
import type {
  CashDirection,
  CostStatus,
  Money,
  Payment,
  PaymentKind,
  PriceKind,
  TransportPaidStatus,
} from '../lib/types';
import { MoneyCell, type MoneyVariant } from './MoneyCell';
import { StatusChip } from './StatusChip';
import { ReasonModal } from './ReasonModal';
import { ErrorState } from './EmptyState';
import { PeekPanel } from './PeekPanel';
import { SettleDrawer } from './SettleDrawer';
import { useT } from './LangContext';
import type { ImpactFact } from './LedgerImpactPreview';

// ── the GET /payments/:id detail shape (superset of the shared Payment) ──
interface EntityRef {
  id: string;
  name: string;
  kind?: LegalEntityKind;
}
interface UserRef {
  id: string;
  name: string;
  username?: string;
}
interface DetailAllocation {
  id: string;
  orderId: string;
  amount: Money;
  priceKind?: PriceKind | null;
  voidedAt?: string | null;
  createdAt?: string;
  order?: {
    id: string;
    orderNo: string;
    costStatus?: CostStatus;
    transportPaidStatus?: TransportPaidStatus;
  } | null;
}
interface DetailLedgerEntry {
  id: string;
  at: string;
  date: string;
  account: LedgerAccount;
  source: LedgerSource;
  amount: Money;
  note?: string | null;
  orderId?: string | null;
  reversalOfId?: string | null;
}
interface DetailCashTx {
  id: string;
  cashboxId: string;
  date: string;
  direction: CashDirection;
  amount: Money;
  source: CashSource;
  note?: string | null;
  reversalOfId?: string | null;
}
type PaymentDetail = Omit<Payment, 'allocations'> & {
  createdAt?: string;
  payerEntity?: EntityRef | null;
  receiverEntity?: EntityRef | null;
  createdBy?: UserRef | null;
  voidedBy?: UserRef | null;
  allocations?: DetailAllocation[];
  ledgerEntries?: DetailLedgerEntry[];
  cashTransactions?: DetailCashTx[];
};

const ALLOCATABLE_KINDS: readonly PaymentKind[] = [
  'CLIENT_IN',
  'FACTORY_OUT',
  'VEHICLE_OUT',
  'TRANSPORT_DIRECT',
];
const IN_KINDS: readonly PaymentKind[] = ['CLIENT_IN', 'FACTORY_REFUND'];

/** danger chip meta for a voided document (matches CANCELLED ink, 02 §2.5). */
const VOID_META: StatusMeta = {
  label: 'Bekor qilingan',
  light: '#C2413B',
  dark: '#E8827C',
  filled: true,
};

const amountVariant = (kind: PaymentKind, voided: boolean): MoneyVariant =>
  voided ? 'ghost' : IN_KINDS.includes(kind) ? 'in' : 'neutral';

const capitalize = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function partyName(p: PaymentDetail): string {
  if (p.kind === 'TRANSPORT_DIRECT') return `${p.client?.name ?? '—'} → ${p.vehicle?.name ?? '—'}`;
  if (p.client) return p.client.name;
  if (p.factory) return p.factory.name;
  if (p.vehicle) return p.vehicle.name + (p.vehicle.plate ? ` (${p.vehicle.plate})` : '');
  return '—';
}

export interface PaymentPeekProps {
  /** the payment id to render; null while the peek is closing. */
  paymentId: string | null;
  open: boolean;
  onClose: () => void;
  /** ↑/↓ triage: explicit handlers (take priority over the rowIds form). */
  onPrev?: () => void;
  onNext?: () => void;
  /** ↑/↓ triage: ordered register row ids + current id + navigate. */
  rowIds?: readonly string[];
  activeId?: string;
  onNavigate?: (id: string) => void;
}

export function PaymentPeek({
  paymentId,
  open,
  onClose,
  onPrev,
  onNext,
  rowIds,
  activeId,
  onNavigate,
}: PaymentPeekProps) {
  const { token } = theme.useToken();
  const t = useT();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const { user } = useAuth();
  const role = user?.role ?? null;
  const canVoid = can(role, 'payments.void');
  const canAllocate = can(role, 'payments.allocate');

  // ?panel=taqsimlash without disturbing the list page/peek (useUrlFilters.set
  // would reset the page since `panel` is not page-neutral — set it directly).
  const [searchParams, setSearchParams] = useSearchParams();
  const panel = searchParams.get('panel') ?? '';
  const setPanel = (v: string | null) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (v) next.set('panel', v);
        else next.delete('panel');
        return next;
      },
      { replace: false },
    );

  const detailQ = useQuery({
    queryKey: ['payments', paymentId],
    enabled: open && !!paymentId,
    queryFn: () => endpoints.payment(paymentId as string),
    placeholderData: keepPreviousData,
  });
  const p = detailQ.data ? (detailQ.data as unknown as PaymentDetail) : undefined;

  const [voidOpen, setVoidOpen] = useState(false);
  const voidMut = useMutation({
    mutationFn: (reason: string) => endpoints.voidPayment(paymentId as string, reason),
    onSuccess: () => {
      message.success(t("To'lov bekor qilindi"));
      setVoidOpen(false);
      for (const key of [
        'payments',
        'orders',
        'dashboard',
        'debts',
        'clients',
        'kassa',
        'factories',
        'vehicles',
        'reports',
      ])
        qc.invalidateQueries({ queryKey: [key] });
    },
  });

  // ── derived (display-only aggregation; money arithmetic stays server-side) ──
  const voided = !!p?.voidedAt;
  const allocations = p?.allocations ?? [];
  const activeAllocs = useMemo(() => allocations.filter((a) => !a.voidedAt), [allocations]);
  const allocatedSum = useMemo(
    () => activeAllocs.reduce((s, a) => s + num(a.amount), 0),
    [activeAllocs],
  );
  const remainder = p ? num(p.amount) - allocatedSum : 0;
  const isAllocatable = p ? ALLOCATABLE_KINDS.includes(p.kind) : false;
  const receiptGuarded = !p || voided || p.kind === 'TRANSPORT_DIRECT';

  const settleOpen =
    open && panel === 'taqsimlash' && !!paymentId && canAllocate && isAllocatable && !voided && remainder >= 1;

  // ── chips (header) ──
  const chips = p ? (
    <>
      <NeutralChip>{PAYMENT_METHOD[p.method]?.label ?? p.method}</NeutralChip>
      {!p.reconciled ? <StatusChip meta={UNRECONCILED} variant="filled" /> : null}
      {voided ? <StatusChip meta={{ ...VOID_META, label: t(VOID_META.label) }} variant="filled" /> : null}
    </>
  ) : undefined;

  // ── footer ──
  const footer = p ? (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <div>
        {!receiptGuarded ? (
          <Button icon={<PrinterOutlined />} onClick={() => navigate(`/print/receipt/${p.id}`)}>
            {t('Kvitansiya chop etish')}
          </Button>
        ) : voided ? (
          <span style={{ color: token.colorTextTertiary, fontSize: 13 }}>
            {t('Bekor qilingan hujjat — kvitansiya chop etilmaydi')}
          </span>
        ) : (
          <span style={{ color: token.colorTextTertiary, fontSize: 13 }}>
            {t("Bu to'lovga kvitansiya berilmaydi")}
          </span>
        )}
      </div>
      {canVoid && !voided ? (
        <Button danger onClick={() => setVoidOpen(true)}>
          {t('Bekor qilish')}
        </Button>
      ) : null}
    </div>
  ) : undefined;

  const kindLabel = p ? PAYMENT_KIND[p.kind]?.label ?? p.kind : t("To'lov");

  return (
    <>
      <PeekPanel
        open={open}
        onClose={onClose}
        title={kindLabel}
        subtitle={p ? fmtDate(p.date) : undefined}
        chips={chips}
        width={560}
        footer={footer}
        onPrint={p && !receiptGuarded ? () => navigate(`/print/receipt/${p.id}`) : undefined}
        onPrev={onPrev}
        onNext={onNext}
        rowIds={rowIds}
        activeId={activeId}
        onNavigate={onNavigate}
      >
        {detailQ.isError ? (
          <ErrorState error={detailQ.error} onRetry={() => void detailQ.refetch()} />
        ) : !p ? (
          <PeekSkeleton />
        ) : (
          <>
            {detailQ.isFetching ? <div className="refetch-hairline" /> : null}

            {/* voided danger banner */}
            {voided ? (
              <div
                style={{
                  margin: '12px 16px 0',
                  padding: '10px 12px',
                  borderRadius: token.borderRadiusLG,
                  background: token.colorErrorBg,
                  color: token.colorError,
                  fontSize: 13,
                }}
              >
                <b>{t('Bekor qilingan')}</b>
                {' — '}
                {fmtDateTime(p.voidedAt)}
                {p.voidedBy?.name ? ` · ${p.voidedBy.name}` : ''}
                {p.voidReason ? ` · ${t('sabab:')} ${p.voidReason}` : ''}
              </div>
            ) : null}

            {/* amount hero */}
            <div style={{ padding: '16px 16px 4px' }}>
              <MoneyCell
                value={p.amount}
                variant={amountVariant(p.kind, voided)}
                strong
                suffix={t("so'm")}
                style={{ fontSize: 28, lineHeight: '34px' }}
              />
              {p.method === 'USD' ? (
                <div style={{ marginTop: 4, color: token.colorTextSecondary, fontSize: 13 }}>
                  <MoneyCell value={p.amount} usd={{ amount: p.usdAmount, rate: p.rate }} />
                </div>
              ) : null}
              <div style={{ marginTop: 6, fontSize: 12, color: token.colorTextTertiary, fontStyle: 'italic' }}>
                {capitalize(sumToWordsUz(num(p.amount)))} {t("so'm")}
              </div>
            </div>

            {/* description rows */}
            <div style={{ padding: '8px 16px 4px' }}>
              <DescRow label="Tomon">{tomonNode(p)}</DescRow>
              {p.agent?.name ? <DescRow label="Agent">{p.agent.name}</DescRow> : null}
              {p.cashbox && p.kind !== 'TRANSPORT_DIRECT' ? (
                <DescRow label="Kassa">{p.cashbox.name}</DescRow>
              ) : null}
              {p.payerEntity || p.payerName ? (
                <DescRow label="To'lovchi">{entityText(p.payerEntity, p.payerName)}</DescRow>
              ) : null}
              {p.receiverEntity || p.receiverName ? (
                <DescRow label="Qabul qiluvchi">
                  {entityText(p.receiverEntity, p.receiverName)}
                </DescRow>
              ) : null}
              {p.createdBy?.name || p.createdAt ? (
                <DescRow label="Kiritdi">
                  {p.createdBy?.name ?? '—'}
                  {p.createdAt ? ` · ${fmtDateTime(p.createdAt)}` : ''}
                </DescRow>
              ) : null}
              {p.note ? <DescRow label="Izoh">{p.note}</DescRow> : null}
            </div>

            {/* Taqsimotlar */}
            {isAllocatable ? (
              <Section title="Taqsimotlar">
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    marginBottom: allocations.length ? 8 : 0,
                  }}
                >
                  {remainder >= 1 ? (
                    <span style={{ fontSize: 13 }}>
                      {t('Taqsimlanmagan qoldiq:')}{' '}
                      <b style={{ color: token.colorWarning }}>{fmtMoney(remainder)} {t("so'm")}</b>
                    </span>
                  ) : (
                    <span style={{ fontSize: 13, color: 'var(--sb-money-in)' }}>
                      {t("To'liq taqsimlangan")}
                    </span>
                  )}
                  {canAllocate ? (
                    remainder >= 1 && !voided ? (
                      <Button size="small" type="primary" onClick={() => setPanel('taqsimlash')}>
                        {t('Taqsimlash')}
                      </Button>
                    ) : null
                  ) : (
                    <span style={{ fontSize: 12, color: token.colorTextTertiary }}>
                      {t('Taqsimlashni buxgalter bajaradi')}
                    </span>
                  )}
                </div>
                {allocations.map((a) => {
                  const g = !!a.voidedAt;
                  return (
                    <div
                      key={a.id}
                      className={g ? 'ghost-row' : undefined}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0' }}
                    >
                      <Link
                        to={`/orders/${a.orderId}`}
                        style={{ flex: 1, minWidth: 0, fontSize: 13 }}
                      >
                        {a.order?.orderNo ?? '—'}
                      </Link>
                      {p.kind === 'FACTORY_OUT' && a.priceKind ? (
                        <StatusChip meta={PRICE_KIND[a.priceKind]} />
                      ) : null}
                      <span
                        style={{
                          fontSize: 12,
                          color: g ? token.colorTextTertiary : token.colorTextSecondary,
                          width: 44,
                          textAlign: 'right',
                        }}
                      >
                        {g ? t('Bekor') : t('Faol')}
                      </span>
                      <MoneyCell
                        value={a.amount}
                        variant={g ? 'ghost' : 'neutral'}
                        style={{ width: 120, textAlign: 'right' }}
                      />
                    </div>
                  );
                })}
              </Section>
            ) : null}

            {/* Ledger yozuvlari */}
            {p.ledgerEntries && p.ledgerEntries.length ? (
              <Section title="Ledger yozuvlari">
                <ReversalRows rows={p.ledgerEntries} kind="ledger" />
              </Section>
            ) : null}

            {/* Kassa harakati / TRANSPORT_DIRECT info line */}
            {p.kind === 'TRANSPORT_DIRECT' ? (
              <Section title="Kassa harakati">
                <span style={{ fontSize: 13, color: token.colorTextSecondary }}>
                  {t("Kassadan pul o'tmagan — mijoz hisobidan kamaydi, shofyor hisobi yopildi.")}
                </span>
              </Section>
            ) : p.cashTransactions && p.cashTransactions.length ? (
              <Section title="Kassa harakati">
                <ReversalRows rows={p.cashTransactions} kind="cash" boxName={p.cashbox?.name} />
              </Section>
            ) : null}
          </>
        )}
      </PeekPanel>

      {/* void — ReasonModal §2.4 with the payload-built impact preview */}
      {p ? (
        <ReasonModal
          open={voidOpen}
          title={t("To'lovni bekor qilish — {amount} so'm, {party}", { amount: fmtMoney(p.amount), party: partyName(p) })}
          confirmLabel="Bekor qilish"
          facts={buildVoidFacts(p, activeAllocs)}
          submitting={voidMut.isPending}
          error={voidMut.error}
          onConfirm={async (reason) => {
            await voidMut.mutateAsync(reason);
          }}
          onClose={() => setVoidOpen(false)}
        />
      ) : null}

      {/* allocation workbench (?panel=taqsimlash) */}
      {paymentId ? (
        <SettleDrawer paymentId={paymentId} open={settleOpen} onClose={() => setPanel(null)} />
      ) : null}
    </>
  );
}

// ─────────────────────────── helpers ───────────────────────────

function tomonNode(p: PaymentDetail): ReactNode {
  const link = (to: string, label: string) => <Link to={to}>{label}</Link>;
  if (p.kind === 'TRANSPORT_DIRECT') {
    return (
      <span>
        {p.clientId && p.client ? link(`/clients/${p.clientId}`, p.client.name) : '—'}
        {' → '}
        {p.vehicleId && p.vehicle ? link(`/vehicles/${p.vehicleId}`, p.vehicle.name) : '—'}
      </span>
    );
  }
  if (p.clientId && p.client) return link(`/clients/${p.clientId}`, p.client.name);
  if (p.factoryId && p.factory) return link(`/factories/${p.factoryId}`, p.factory.name);
  if (p.vehicleId && p.vehicle)
    return link(
      `/vehicles/${p.vehicleId}`,
      p.vehicle.name + (p.vehicle.plate ? ` (${p.vehicle.plate})` : ''),
    );
  return '—';
}

function entityText(entity: EntityRef | null | undefined, freeText: string | null | undefined): ReactNode {
  if (entity) return entity.name;
  if (freeText) return <span>«{freeText}» ({translate('yozma')})</span>;
  return '—';
}

function buildVoidFacts(p: PaymentDetail, active: DetailAllocation[]): ImpactFact[] {
  const facts: ImpactFact[] = [];
  if (active.length) {
    const nos = active
      .map((a) => a.order?.orderNo)
      .filter(Boolean)
      .join(', ');
    facts.push({
      tone: 'warning',
      text: interpolate(translate("{n} ta taqsimot bekor bo'ladi"), { n: active.length }) + (nos ? ` (${nos})` : ''),
    });
  }
  if (p.kind === 'FACTORY_OUT') {
    for (const a of active) {
      if (a.order?.costStatus && a.order.costStatus !== 'PROVISIONAL') {
        facts.push({
          tone: 'warning',
          text: interpolate(
            translate("{orderNo} tannarxi PROVISIONAL holatiga qaytadi — COST_ADJUSTMENT storno bo'ladi"),
            { orderNo: a.order.orderNo },
          ),
        });
      }
    }
  }
  if ((p.kind === 'VEHICLE_OUT' || p.kind === 'TRANSPORT_DIRECT') && active.length) {
    facts.push({ tone: 'warning', text: translate('Transport holati qayta hisoblanadi') });
  }
  if (p.kind === 'TRANSPORT_DIRECT') {
    facts.push({ tone: 'neutral', text: translate('Kassaga tegmaydi') });
  } else if (p.cashbox) {
    const sign = IN_KINDS.includes(p.kind) ? '−' : '+';
    facts.push({
      tone: 'neutral',
      text: interpolate(translate('Kassa: {box} {sign} {amount} (qaytim yozuvi)'), {
        box: p.cashbox.name,
        sign,
        amount: fmtMoney(p.amount),
      }),
    });
  }
  if (p.method === 'BONUS') {
    facts.push({
      tone: 'success',
      text: interpolate(translate('Bonus hamyoniga qaytadi: + {amount}'), { amount: fmtMoney(p.amount) }),
    });
  }
  return facts;
}

// ── small presentational atoms (module-scope so hooks stay stable) ──

function NeutralChip({ children }: { children: ReactNode }) {
  const { token } = theme.useToken();
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 22,
        padding: '0 8px',
        borderRadius: token.borderRadiusSM,
        background: token.colorFillSecondary,
        color: token.colorText,
        fontSize: 12,
        fontWeight: 500,
        lineHeight: '20px',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

function DescRow({ label, children }: { label: string; children: ReactNode }) {
  const { token } = theme.useToken();
  const t = useT();
  return (
    <div style={{ display: 'flex', gap: 12, padding: '4px 0', fontSize: 13 }}>
      <div style={{ flex: '0 0 104px', color: token.colorTextTertiary }}>{t(label)}</div>
      <div style={{ flex: 1, minWidth: 0, color: token.colorText }}>{children}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const { token } = theme.useToken();
  const t = useT();
  return (
    <div style={{ borderTop: `1px solid ${token.colorSplit}`, padding: '12px 16px', marginTop: 8 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: token.colorTextTertiary,
          marginBottom: 8,
        }}
      >
        {t(title)}
      </div>
      {children}
    </div>
  );
}

/** ledger / kassa rows with reversal (storno) pairs chained — hover highlights both. */
function ReversalRows({
  rows,
  kind,
  boxName,
}: {
  rows: DetailLedgerEntry[] | DetailCashTx[];
  kind: 'ledger' | 'cash';
  boxName?: string;
}) {
  const { token } = theme.useToken();
  const t = useT();
  const [hoverPair, setHoverPair] = useState<string | null>(null);

  const reversedIds = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) if (r.reversalOfId) s.add(r.reversalOfId);
    return s;
  }, [rows]);

  const pairKeyOf = (r: DetailLedgerEntry | DetailCashTx) => r.reversalOfId ?? r.id;

  return (
    <>
      {rows.map((r) => {
        const isStorno = !!r.reversalOfId;
        const isReversed = reversedIds.has(r.id);
        const inPair = isStorno || isReversed;
        const key = pairKeyOf(r);
        const highlit = inPair && hoverPair === key;

        // labels + signed amount differ per source table
        const label =
          kind === 'ledger'
            ? LEDGER_SOURCE[(r as DetailLedgerEntry).source]?.label ??
              (r as DetailLedgerEntry).source
            : `${boxName ? `${boxName} · ` : ''}${
                CASH_DIRECTION[(r as DetailCashTx).direction]?.label ??
                (r as DetailCashTx).direction
              }`;
        const when = kind === 'ledger' ? fmtDate((r as DetailLedgerEntry).date) : fmtDateTime((r as DetailCashTx).date);
        const orderId = kind === 'ledger' ? (r as DetailLedgerEntry).orderId : null;
        const signedValue =
          kind === 'ledger'
            ? (r as DetailLedgerEntry).amount // already signed (asset convention)
            : ((r as DetailCashTx).direction === 'IN' ? 1 : -1) * num((r as DetailCashTx).amount);
        const variant: MoneyVariant =
          kind === 'cash' && (r as DetailCashTx).direction === 'IN' ? 'in' : 'neutral';

        return (
          <div
            key={r.id}
            onMouseEnter={inPair ? () => setHoverPair(key) : undefined}
            onMouseLeave={inPair ? () => setHoverPair(null) : undefined}
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 8,
              padding: '5px 6px',
              margin: '0 -6px',
              borderRadius: token.borderRadiusSM,
              background: highlit ? token.colorFillTertiary : undefined,
            }}
          >
            <span style={{ flex: '0 0 auto', fontSize: 12, color: token.colorTextTertiary }}>
              {when}
            </span>
            <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: token.colorText }}>
              {label}
              {orderId ? (
                <>
                  {' · '}
                  <Link to={`/orders/${orderId}`}>{t('buyurtma')}</Link>
                </>
              ) : null}
              {inPair ? (
                <span
                  style={{
                    marginLeft: 6,
                    fontSize: 11,
                    padding: '0 5px',
                    borderRadius: token.borderRadiusSM,
                    background: token.colorFillSecondary,
                    color: token.colorTextSecondary,
                  }}
                >
                  {t('storno')}
                </span>
              ) : null}
            </span>
            <MoneyCell value={signedValue} variant={variant} signed style={{ flex: '0 0 auto' }} />
          </div>
        );
      })}
    </>
  );
}

/** loading skeleton mirroring the real layout (02 §9, money.md §2.5). */
function PeekSkeleton() {
  const { token } = theme.useToken();
  const bar = (w: number | string, h = 12, mt = 8): ReactNode => (
    <div
      style={{
        width: w,
        height: h,
        marginTop: mt,
        borderRadius: 4,
        background: token.colorFillSecondary,
      }}
    />
  );
  return (
    <div style={{ padding: 16 }} aria-busy>
      {bar(180, 28, 4)}
      {bar('60%')}
      <div style={{ marginTop: 20 }}>
        {bar('90%')}
        {bar('80%')}
        {bar('70%')}
        {bar('85%')}
      </div>
      <div style={{ marginTop: 24 }}>
        {bar('40%', 10)}
        {bar('100%')}
        {bar('100%')}
      </div>
    </div>
  );
}
