// SettleDrawer (04 §3.2, money.md §4, hero §A) — THE allocation workbench that
// wires POST /payments/:id/allocations, the endpoint with no UI until now. It
// opens over its context (payment peek ?panel=taqsimlash, PaymentComposer chain,
// FactoryDetail, VehicleDetail, Debts, Taqsimlanmagan worklist rows).
//
// Verified backend truth (apps/api/src/payments/payments.service.ts): the
// standalone allocations endpoint accepts CLIENT_IN and FACTORY_OUT ONLY
// (allocate(), «Bu endpoint faqat CLIENT_IN va FACTORY_OUT to'lovlarini
// taqsimlaydi»). VEHICLE_OUT / TRANSPORT_DIRECT allocate solely inline at
// creation via the POST /payments body. So this component runs in two modes:
//   • standalone (default): commits POST /payments/:id/allocations;
//   • controlled inline (onSubmit given): emits the allocation rows so the
//     PaymentComposer / VehicleDetail BulkBar can submit them inside POST
//     /payments — the only path transport allocations exist. Opened standalone
//     on a transport payment, the workbench degrades honestly (read-only + the
//     create-time explainer) instead of faking a call the server rejects.
//
// Candidate outstanding per kind (money.md §4.2): list scalars are server data;
// the active-allocation Σ resolves lazily per row via GET /orders/:id with a
// small per-cell spinner — never a blocking overlay.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Checkbox, Drawer, Empty, Flex, Spin, Tooltip, theme, Typography } from 'antd';
import { ClearOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { apiError, endpoints } from '../lib/api';
import { can } from '../lib/permissions';
import { useAuth } from '../auth/AuthContext';
import { fmtDate, fmtMoney, num } from '../lib/format';
import {
  COST_STATUS,
  PAYMENT_KIND,
  PAYMENT_METHOD,
  PRICE_KIND,
  STATUS,
  TRANSPORT_PAID,
} from '../lib/status-maps';
import type {
  Allocation,
  CostStatus,
  Order,
  OrderStatus,
  Payment,
  PaymentKind,
  PaymentMethod,
  TransportPaidStatus,
} from '../lib/types';
import { StatusChip } from './StatusChip';
import { MoneyCell } from './MoneyCell';
import { MoneyInput } from './MoneyInput';
import { LedgerImpactPreview, type ImpactFact } from './LedgerImpactPreview';
import { useT } from './LangContext';

/** the allocation POST body row shape: { allocations: [{ orderId, amount }] } */
export interface AllocationInput {
  orderId: string;
  amount: string;
}

export interface SettleDrawerProps {
  /** payment id — loaded via GET /payments/:id when `payment` is not supplied. */
  paymentId?: string;
  /** pre-loaded payment (the peek already holds it) — skips the GET. */
  payment?: Payment;
  open: boolean;
  onClose: () => void;
  /** fired with the refreshed payment after a successful standalone commit. */
  onSuccess?: (payment: Payment) => void;
  /**
   * Controlled inline mode (PaymentComposer «Saqlash va taqsimlash»,
   * VehicleDetail BulkBar). When provided, Confirm emits the rows to the parent
   * instead of committing POST /payments/:id/allocations — the only path by
   * which VEHICLE_OUT / TRANSPORT_DIRECT can allocate. The parent owns
   * open / submitting / error.
   */
  onSubmit?: (allocations: AllocationInput[]) => void | Promise<void>;
  submitting?: boolean;
  error?: unknown;
  /** BulkBar pre-selection: these order ids are pre-filled FIFO on open. */
  preselectOrderIds?: string[];
}

/** the kinds the standalone POST /payments/:id/allocations endpoint accepts. */
const ENDPOINT_KINDS: readonly PaymentKind[] = ['CLIENT_IN', 'FACTORY_OUT'];
/** every kind that may carry allocations at all (create-time for the last two). */
const ALLOCATABLE_KINDS: readonly PaymentKind[] = [
  'CLIENT_IN',
  'FACTORY_OUT',
  'VEHICLE_OUT',
  'TRANSPORT_DIRECT',
];
/** payment methods that settle a FACTORY_OUT at the factory CASH price. */
const FACTORY_CASH_METHODS: readonly PaymentMethod[] = ['CASH', 'CARD', 'USD'];
/** which allocation payment-kinds reduce each candidate's outstanding figure. */
const REDUCING_KINDS: Record<'client' | 'factory' | 'transport', PaymentKind[]> = {
  client: ['CLIENT_IN'],
  factory: ['FACTORY_OUT'],
  transport: ['VEHICLE_OUT', 'TRANSPORT_DIRECT'],
};

type Family = 'client' | 'factory' | 'transport';

const familyOf = (kind: PaymentKind): Family =>
  kind === 'CLIENT_IN' ? 'client' : kind === 'FACTORY_OUT' ? 'factory' : 'transport';

/** a normalized candidate row (list scalars are server truth). */
interface Candidate {
  id: string;
  orderNo: string;
  date: string;
  status: OrderStatus;
  clientId?: string | null;
  clientName?: string | null;
  costStatus?: CostStatus;
  transportPaidStatus?: TransportPaidStatus;
  /** the server base figure before deducting this family's active allocations. */
  base: number;
}

/** Σ active allocations of the given kinds against an order (from GET /orders/:id). */
function activeAllocated(order: Order, kinds: PaymentKind[]): number {
  const allocs = (order.allocations ?? []) as Allocation[];
  return allocs
    .filter((a) => !a.voidedAt && a.payment && !a.payment.voidedAt && kinds.includes(a.payment.kind))
    .reduce((s, a) => s + num(a.amount), 0);
}

export function SettleDrawer({
  paymentId,
  payment: paymentProp,
  open,
  onClose,
  onSuccess,
  onSubmit,
  submitting: submittingProp,
  error: errorProp,
  preselectOrderIds,
}: SettleDrawerProps) {
  const { token } = theme.useToken();
  const t = useT();
  const { message } = App.useApp();
  const { user } = useAuth();
  const qc = useQueryClient();
  const canAllocate = can(user?.role, 'payments.allocate'); // A/B only (K/G read-only)

  const pid = paymentProp?.id ?? paymentId;

  // ── payment: prefer the passed record, else GET /payments/:id ──
  const paymentQuery = useQuery({
    queryKey: ['payments', pid],
    queryFn: () => endpoints.payment(pid as string),
    enabled: open && !!pid && !paymentProp,
    staleTime: 5_000,
  });
  const pay = paymentProp ?? paymentQuery.data;

  const kind = pay?.kind;
  const family = kind ? familyOf(kind) : 'client';
  const partyId = pay
    ? family === 'client'
      ? pay.clientId
      : family === 'factory'
        ? pay.factoryId
        : pay.vehicleId
    : undefined;

  // ── candidates: the party's open documents, oldest-first ──
  const listQuery = useQuery({
    queryKey:
      family === 'transport'
        ? ['vehicles', partyId, 'settle']
        : ['orders', 'settle', kind, partyId],
    queryFn: async (): Promise<Candidate[]> => {
      if (family === 'client') {
        const r = await endpoints.orders({ clientId: partyId as string, pageSize: 200 });
        return r.items
          .filter((o) => o.status !== 'CANCELLED')
          .map((o) => ({
            id: o.id,
            orderNo: o.orderNo,
            date: o.date,
            status: o.status,
            base: num(o.saleTotal) + num(o.transportCharge),
          }));
      }
      if (family === 'factory') {
        const r = await endpoints.orders({ factoryId: partyId as string, pageSize: 200 });
        return r.items
          .filter((o) => o.status !== 'CANCELLED' && o.costStatus !== 'FINAL')
          .map((o) => ({
            id: o.id,
            orderNo: o.orderNo,
            date: o.date,
            status: o.status,
            clientName: o.client?.name ?? null,
            costStatus: o.costStatus,
            base: num(o.costTotal),
          }));
      }
      // transport: the vehicle-detail own-orders payload (last 50 reys)
      const v = (await endpoints.vehicle(partyId as string)) as { orders?: unknown[] };
      const rows = (v.orders ?? []) as Array<
        Order & { client?: { id: string; name: string } | null }
      >;
      return rows
        .filter((o) => o.status !== 'CANCELLED' && num(o.transportCost) > 0)
        .map((o) => ({
          id: o.id,
          orderNo: o.orderNo,
          date: o.date,
          status: o.status,
          clientId: o.clientId ?? o.client?.id ?? null,
          clientName: o.client?.name ?? null,
          transportPaidStatus: o.transportPaidStatus,
          base: num(o.transportCost),
        }));
    },
    enabled: open && !!pay && !!partyId,
    staleTime: 15_000,
  });

  const candidates = useMemo<Candidate[]>(() => listQuery.data ?? [], [listQuery.data]);

  // ── per-row outstanding: lazily resolved via GET /orders/:id (per-cell spinner) ──
  const details = useQueries({
    queries: candidates.map((c) => ({
      queryKey: ['orders', c.id],
      queryFn: () => endpoints.order(c.id),
      enabled: open && !!pay,
      staleTime: 30_000,
    })),
  });

  const reducingKinds = REDUCING_KINDS[family];
  /** id → outstanding (number) once its detail resolves; undefined while loading. */
  const outstandingMap = useMemo<Record<string, number | undefined>>(() => {
    const out: Record<string, number | undefined> = {};
    candidates.forEach((c, i) => {
      const d = details[i]?.data;
      out[c.id] = d ? Math.max(0, c.base - activeAllocated(d, reducingKinds)) : undefined;
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates, details.map((d) => d.dataUpdatedAt).join(','), reducingKinds]);

  // ── this payment's own active allocations: already-committed, row-locking ──
  const existingByOrder = useMemo<Record<string, number>>(() => {
    const m: Record<string, number> = {};
    for (const a of pay?.allocations ?? []) {
      if (!a.voidedAt && a.orderId) m[a.orderId] = num(a.amount);
    }
    return m;
  }, [pay]);
  const alreadyAllocated = useMemo(
    () => Object.values(existingByOrder).reduce((s, v) => s + v, 0),
    [existingByOrder],
  );

  /** id → hard-disable reason (independent of the running budget). */
  const disabledReason = useMemo<Record<string, string | undefined>>(() => {
    const m: Record<string, string | undefined> = {};
    for (const c of candidates) {
      if (c.status === 'CANCELLED') m[c.id] = 'Bekor qilingan buyurtma';
      else if (kind === 'TRANSPORT_DIRECT' && pay?.clientId && c.clientId && c.clientId !== pay.clientId)
        m[c.id] = 'Boshqa mijozga tegishli';
      else if (existingByOrder[c.id] != null) m[c.id] = 'Avval mavjud taqsimotni bekor qiling';
    }
    return m;
  }, [candidates, kind, pay, existingByOrder]);

  // ── entered amounts (digits-only so'm strings), keyed by order id ──
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const timers = useRef<number[]>([]);
  const clearTimers = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };

  // reset the workbench on every fresh open
  useEffect(() => {
    if (open) {
      setAmounts({});
      clearTimers();
    } else {
      clearTimers();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pid]);
  useEffect(() => clearTimers, []);

  const paymentAmount = pay ? num(pay.amount) : 0;
  const enteredTotal = useMemo(
    () => Object.values(amounts).reduce((s, v) => s + num(v), 0),
    [amounts],
  );
  // «Taqsimlanmagan qoldiq» = amount − committed active − being entered now
  const remaining = paymentAmount - alreadyAllocated - enteredTotal;
  const excess = Math.max(0, -remaining); // should be unreachable (rows clamp)

  const isTransportStandalone = !onSubmit && !!kind && !ENDPOINT_KINDS.includes(kind);
  const readOnly = !canAllocate || isTransportStandalone;

  /** budget available to one row = live remaining freed of its own current amount. */
  const rowMax = (id: string): number => {
    const own = num(amounts[id] ?? 0);
    const outstanding = outstandingMap[id];
    if (outstanding == null) return 0;
    return Math.floor(Math.min(outstanding, remaining + own));
  };

  const setRow = (id: string, raw: string) => {
    const clamped = Math.min(num(raw), rowMax(id));
    setAmounts((prev) => {
      const next = { ...prev };
      if (clamped > 0) next[id] = String(clamped);
      else delete next[id];
      return next;
    });
  };
  const toggleRow = (id: string, checked: boolean) => {
    if (checked) setRow(id, String(rowMax(id)));
    else setAmounts((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  // ── «A» — Eskisidan boshlab taqsimlash: FIFO fill, rows appear at 40ms ──
  const fillableOrder = useMemo(
    () => candidates.filter((c) => !disabledReason[c.id]),
    [candidates, disabledReason],
  );
  const detailsSettled = details.length === 0 || details.every((d) => !d.isLoading);

  const runFifo = () => {
    clearTimers();
    let budget = paymentAmount - alreadyAllocated;
    const plan: [string, string][] = [];
    for (const c of fillableOrder) {
      if (budget <= 0) break;
      const outstanding = outstandingMap[c.id];
      if (outstanding == null) continue; // still resolving — skip, never over-fill
      const take = Math.floor(Math.min(outstanding, budget));
      if (take <= 0) continue;
      plan.push([c.id, String(take)]);
      budget -= take;
    }
    setAmounts({});
    plan.forEach(([id, amt], i) => {
      const t = window.setTimeout(
        () => setAmounts((prev) => ({ ...prev, [id]: amt })),
        i * 40,
      );
      timers.current.push(t);
    });
  };
  const reset = () => {
    clearTimers();
    setAmounts({});
  };

  // pre-selection (BulkBar): FIFO-fill the given ids once their outstanding resolves
  const preFilled = useRef(false);
  useEffect(() => {
    if (!open) {
      preFilled.current = false;
      return;
    }
    if (preFilled.current || readOnly) return;
    if (!preselectOrderIds?.length || !detailsSettled) return;
    let budget = paymentAmount - alreadyAllocated;
    const next: Record<string, string> = {};
    for (const id of preselectOrderIds) {
      if (budget <= 0) break;
      if (disabledReason[id]) continue;
      const outstanding = outstandingMap[id];
      if (outstanding == null) continue;
      const take = Math.floor(Math.min(outstanding, budget));
      if (take <= 0) continue;
      next[id] = String(take);
      budget -= take;
    }
    if (Object.keys(next).length) setAmounts(next);
    preFilled.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, detailsSettled, preselectOrderIds]);

  // ── commit ──
  const allocations: AllocationInput[] = useMemo(
    () =>
      Object.entries(amounts)
        .filter(([, v]) => num(v) > 0)
        .map(([orderId, v]) => ({ orderId, amount: v })),
    [amounts],
  );

  const mut = useMutation({
    mutationFn: () => endpoints.allocatePayment(pid as string, allocations),
    onSuccess: (updated) => {
      message.success(t('Taqsimlandi'));
      for (const key of ['payments', 'orders', 'factories', 'vehicles', 'debts', 'clients', 'dashboard', 'kassa'])
        qc.invalidateQueries({ queryKey: [key] });
      onSuccess?.(updated as Payment);
      onClose();
    },
    onError: (e) => message.error(apiError(e)),
  });

  const busy = mut.isPending || submittingProp === true;
  const shownError = errorProp ?? mut.error;

  const submit = async () => {
    if (!allocations.length || busy || readOnly) return;
    if (onSubmit) await onSubmit(allocations);
    else mut.mutate();
  };

  // ── forecast for the footer LedgerImpactPreview ──
  const facts = useMemo<ImpactFact[]>(() => {
    if (!allocations.length || !kind) return [];
    const rowsById = new Map(candidates.map((c) => [c.id, c]));
    const picked = allocations
      .map((a) => ({ c: rowsById.get(a.orderId), amt: num(a.amount) }))
      .filter((x): x is { c: Candidate; amt: number } => !!x.c);
    const out: ImpactFact[] = [];

    if (family === 'factory') {
      const basisKind = FACTORY_CASH_METHODS.includes(pay!.method) ? 'FACTORY_CASH' : 'FACTORY_BANK';
      const finalized = picked.filter((x) => x.amt >= (outstandingMap[x.c.id] ?? Infinity));
      const partial = picked.filter((x) => x.amt < (outstandingMap[x.c.id] ?? Infinity));
      if (finalized.length)
        out.push({
          tone: 'success',
          text: t('{n} ta buyurtma tannarxi qotiriladi ({price} narxida, buyurtma sanasidagi narx qatori)', {
            n: finalized.length,
            price: PRICE_KIND[basisKind].label,
          }),
        });
      if (partial.length)
        out.push({ tone: 'warning', text: t('{n} ta buyurtma qisman qoladi (PARTIAL)', { n: partial.length }) });
      if (finalized.length)
        out.push({ tone: 'neutral', text: t('Tannarx farqlari COST_ADJUSTMENT sifatida yoziladi') });
      const completed = finalized.filter((x) => x.c.status === 'COMPLETED').length;
      if (completed)
        out.push({
          tone: 'neutral',
          text: t('{n} ta yakunlangan buyurtmaning foizli bonusi qayta hisoblanadi', { n: completed }),
        });
    } else if (family === 'transport') {
      const settled = picked.filter((x) => x.amt >= (outstandingMap[x.c.id] ?? Infinity)).length;
      if (settled)
        out.push({ tone: 'success', text: t("{n} ta buyurtma transporti to'langan holatiga o'tadi", { n: settled }) });
      if (kind === 'TRANSPORT_DIRECT')
        out.push({ tone: 'neutral', text: t('Mijoz hisobidan kamayadi, shofyor hisobi yopiladi') });
    } else {
      const closed = picked.filter((x) => x.amt >= (outstandingMap[x.c.id] ?? Infinity)).length;
      out.push({
        tone: 'neutral',
        text: closed
          ? t('{n} ta buyurtma qarzi kamayadi — {closed} tasi yopiladi', { n: picked.length, closed })
          : t('{n} ta buyurtma qarzi kamayadi', { n: picked.length }),
      });
    }
    if (excess > 0)
      out.push({ tone: 'danger', text: t("Σ to'lov summasidan {amount} so'm oshib ketdi", { amount: fmtMoney(excess) }) });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allocations, candidates, outstandingMap, family, kind, pay, excess]);

  // ── header summary bits ──
  const partyLabel = pay
    ? family === 'client'
      ? pay.client?.name ?? pay.payerName ?? '—'
      : family === 'factory'
        ? pay.factory?.name ?? '—'
        : `${pay.vehicle?.name ?? '—'}${pay.vehicle?.plate ? ` · ${pay.vehicle.plate}` : ''}${
            kind === 'TRANSPORT_DIRECT' && pay.client ? ` ← ${pay.client.name}` : ''
          }`
    : '—';
  const figureLabel =
    family === 'client' ? t('Qoldiq') : family === 'factory' ? t('Qoplanmagan') : t("Transport qoldig'i");

  const loading = (!paymentProp && paymentQuery.isLoading) || (!!pay && listQuery.isLoading);

  return (
    <Drawer
      open={open}
      onClose={busy ? undefined : onClose}
      width="min(760px, 100vw)"
      title={t('Taqsimlash')}
      maskClosable={!busy}
      keyboard={!busy}
      styles={{ body: { padding: 0, display: 'flex', flexDirection: 'column' } }}
      footer={
        pay && !readOnly ? (
          <Flex vertical gap={10}>
            {facts.length > 0 ? <LedgerImpactPreview facts={facts} title={t('Natija')} /> : null}
            {shownError ? (
              <Typography.Text type="danger" style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>
                {apiError(shownError)}
              </Typography.Text>
            ) : null}
            <Button
              type="primary"
              size="large"
              block
              loading={busy}
              disabled={!allocations.length || excess > 0}
              onClick={submit}
            >
              {allocations.length
                ? t("Taqsimlash — {amount} so'm", { amount: fmtMoney(enteredTotal) })
                : t('Taqsimlash')}
            </Button>
          </Flex>
        ) : undefined
      }
    >
      <div
        style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}
        onKeyDown={(e) => {
          if (readOnly) return;
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            void submit();
          } else if (
            e.key.toLowerCase() === 'a' &&
            !e.ctrlKey &&
            !e.metaKey &&
            !(e.target instanceof HTMLInputElement) &&
            !(e.target instanceof HTMLTextAreaElement)
          ) {
            e.preventDefault();
            runFifo();
          }
        }}
      >
        {loading || !pay ? (
          <div style={{ padding: 48, textAlign: 'center' }}>
            <Spin />
          </div>
        ) : (
          <>
            {/* ── header: payment summary + live qoldiq + price basis ── */}
            <div style={{ padding: '16px 20px', borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
              <Flex align="center" gap={10} wrap="wrap">
                <StatusChip meta={PAYMENT_KIND[pay.kind]} variant="filled" />
                <Typography.Text strong style={{ fontSize: 15 }}>
                  {partyLabel}
                </Typography.Text>
              </Flex>
              <Flex align="baseline" gap={8} style={{ marginTop: 6 }}>
                <MoneyCell value={pay.amount} variant="neutral" strong suffix={t("so'm")} style={{ fontSize: 18 }} />
                <Typography.Text type="secondary">· {PAYMENT_METHOD[pay.method].label}</Typography.Text>
              </Flex>
              <Flex
                align="center"
                justify="space-between"
                gap={8}
                style={{
                  marginTop: 12,
                  padding: '8px 12px',
                  borderRadius: token.borderRadiusLG,
                  background:
                    remaining <= 0 && enteredTotal > 0 ? undefined : token.colorFillTertiary,
                  border:
                    remaining <= 0 && enteredTotal > 0
                      ? `1px solid ${token.colorSuccessBorder}`
                      : `1px solid transparent`,
                }}
              >
                <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                  {t('Taqsimlanmagan qoldiq')}
                </Typography.Text>
                <MoneyCell
                  value={remaining}
                  variant={excess > 0 ? 'weOwe' : remaining <= 0 ? 'in' : 'neutral'}
                  strong
                  suffix={t("so'm")}
                />
              </Flex>
              {family === 'factory' ? (
                <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
                  {t('Narx asosi:')}{' '}
                  <b>
                    {PRICE_KIND[FACTORY_CASH_METHODS.includes(pay.method) ? 'FACTORY_CASH' : 'FACTORY_BANK'].label}
                  </b>{' '}
                  {t("— to'lov usulidan")}
                </Typography.Text>
              ) : null}
            </div>

            {/* ── honest degrade / read-only banners ── */}
            {isTransportStandalone ? (
              <Alert
                type="info"
                showIcon
                style={{ margin: '12px 20px 0' }}
                message={t("Transport to'lovi yaratilgandan so'ng taqsimlanmaydi")}
                description={t("Transport taqsimoti faqat to'lovni yaratish vaqtida bajariladi (server qoidasi). Quyidagi ro'yxat ma'lumot uchun.")}
              />
            ) : !canAllocate ? (
              <Alert
                type="info"
                showIcon
                style={{ margin: '12px 20px 0' }}
                message={t('Taqsimlashni buxgalter bajaradi')}
              />
            ) : null}

            {/* ── toolbar ── */}
            {!readOnly ? (
              <Flex align="center" gap={8} style={{ padding: '12px 20px 8px' }}>
                <Tooltip title={t("Eskisidan boshlab, to'lov tugaguncha (A)")}>
                  <Button
                    icon={<ThunderboltOutlined />}
                    onClick={runFifo}
                    disabled={!fillableOrder.length || !detailsSettled || remaining <= 0}
                  >
                    {t('Eskisidan boshlab taqsimlash')}
                  </Button>
                </Tooltip>
                <Button icon={<ClearOutlined />} onClick={reset} disabled={!enteredTotal}>
                  {t('Tozalash')}
                </Button>
              </Flex>
            ) : null}

            {/* ── candidate list ── */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '4px 20px 20px' }}>
              {listQuery.isError ? (
                <Empty description={apiError(listQuery.error)} />
              ) : !candidates.length ? (
                <Empty description={t("Ochiq hujjat yo'q")} image={Empty.PRESENTED_IMAGE_SIMPLE} />
              ) : (
                <>
                  {/* column caption */}
                  <Flex
                    align="center"
                    style={{
                      fontSize: 11,
                      letterSpacing: '0.04em',
                      color: token.colorTextTertiary,
                      textTransform: 'uppercase',
                      padding: '4px 0',
                    }}
                  >
                    <span style={{ flex: 1 }}>{t('Buyurtma')}</span>
                    <span style={{ width: 160, textAlign: 'right' }}>{figureLabel}</span>
                    <span style={{ width: 190, textAlign: 'right' }}>{t('Summa')}</span>
                  </Flex>

                  {candidates.map((c, i) => {
                    const outstanding = outstandingMap[c.id];
                    const resolving = details[i]?.isLoading ?? true;
                    const reason = disabledReason[c.id];
                    const existing = existingByOrder[c.id];
                    const entered = num(amounts[c.id] ?? 0);
                    const max = rowMax(c.id);
                    const rowDisabled = readOnly || !!reason || outstanding === 0 || max <= 0;
                    const fullyCovers = outstanding != null && entered >= outstanding && entered > 0;

                    // per-row status chip
                    const chip =
                      family === 'factory' && c.costStatus ? (
                        <StatusChip meta={COST_STATUS[c.costStatus]} />
                      ) : family === 'transport' && c.transportPaidStatus ? (
                        <StatusChip meta={TRANSPORT_PAID[c.transportPaidStatus]} />
                      ) : (
                        <StatusChip meta={STATUS[c.status]} />
                      );

                    return (
                      <Flex
                        key={c.id}
                        align="center"
                        gap={10}
                        style={{
                          padding: '10px 0',
                          borderBottom: `1px solid ${token.colorBorderSecondary}`,
                          opacity: reason ? 0.55 : 1,
                        }}
                      >
                        {!readOnly ? (
                          <Checkbox
                            checked={entered > 0}
                            disabled={rowDisabled}
                            onChange={(e) => toggleRow(c.id, e.target.checked)}
                          />
                        ) : null}

                        {/* identity */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <Flex align="center" gap={8} wrap="wrap">
                            <Typography.Text strong>{c.orderNo}</Typography.Text>
                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                              {fmtDate(c.date)}
                            </Typography.Text>
                            {chip}
                          </Flex>
                          {c.clientName ? (
                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                              {c.clientName}
                            </Typography.Text>
                          ) : null}
                          {reason ? (
                            <div style={{ fontSize: 12, color: token.colorTextTertiary }}>
                              {t(reason)}
                              {existing != null ? ` — ${fmtMoney(existing)} ${t("so'm")}` : ''}
                            </div>
                          ) : null}
                        </div>

                        {/* figure — per-cell spinner while the allocation Σ resolves */}
                        <div style={{ width: 160, textAlign: 'right' }}>
                          {resolving && outstanding == null ? (
                            <Spin size="small" />
                          ) : outstanding === 0 ? (
                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                              {t("to'liq")}
                            </Typography.Text>
                          ) : (
                            <MoneyCell value={outstanding} variant="neutral" />
                          )}
                        </div>

                        {/* amount input + forecast chip */}
                        <div style={{ width: 190 }}>
                          {readOnly ? (
                            <div style={{ textAlign: 'right' }}>
                              <MoneyCell value={existing ?? 0} variant="ghost" />
                            </div>
                          ) : (
                            <>
                              <MoneyInput
                                value={amounts[c.id] ?? ''}
                                onChange={(v) => setRow(c.id, v)}
                                max={outstanding == null ? undefined : max}
                                disabled={rowDisabled}
                                min={1}
                              />
                              {entered > 0 ? (
                                <div style={{ textAlign: 'right', marginTop: 2 }}>
                                  <ForecastChip family={family} full={fullyCovers} />
                                </div>
                              ) : null}
                            </>
                          )}
                        </div>
                      </Flex>
                    );
                  })}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </Drawer>
  );
}

/** per-row outcome chip (04 §3.2 forecast). */
function ForecastChip({ family, full }: { family: Family; full: boolean }) {
  const { token } = theme.useToken();
  const t = useT();
  const label =
    family === 'factory'
      ? full
        ? '→ FINAL'
        : '→ PARTIAL'
      : family === 'transport'
        ? t("→ To'langan")
        : full
          ? t('→ Yopildi')
          : t('→ Qisman');
  const ink = full ? token.colorSuccess : token.colorWarning;
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 500,
        padding: '0 6px',
        borderRadius: token.borderRadiusSM,
        color: ink,
        background: token.colorFillTertiary,
      }}
    >
      {label}
    </span>
  );
}

/** alias per 04 §3.2 / the barrel — the same allocation workbench. */
export const AllocationEditor = SettleDrawer;
