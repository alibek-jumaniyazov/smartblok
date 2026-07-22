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
//
// MOBIL (mobile-responsive-spec §2.3, R5/R6/R12): telefonda drawer pastki
// varaqqa aylanadi va nomzod qatori 160px+190px ustunlardan voz kechib ustma-ust
// joylashadi (360px da uch ustun sig'maydi). FIFO tugmasining tushuntirishi
// tooltipdan ko'rinadigan matnga chiqadi — tooltip barmoq bilan ochilmaydi.
// Futer (`.ant-drawer-footer`) `flex-shrink: 0` bo'lgani uchun u qancha o'ssa,
// `flex: 1` nomzod ro'yxati shuncha yo'qotadi — shu sababli telefonda futerdagi
// «Natija» bloki yopiq turadi (bosilganda ochiladi) va xato matni ham dvh bilan
// cheklanadi. Ro'yxat har doim ishlaydigan balandlikda qoladi.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Checkbox, Drawer, Empty, Flex, Spin, Tooltip, theme, Typography } from 'antd';
import { ClearOutlined, DownOutlined, ThunderboltOutlined, UpOutlined } from '@ant-design/icons';
import { apiError, endpoints } from '../lib/api';
import { drawerWidth, useIsPhone } from '../lib/responsive';
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
  PriceKind,
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
/**
 * Payment methods that settle a FACTORY_OUT at the factory CASH price — MUST stay
 * byte-identical to payments.service.ts `FACTORY_CASH_METHODS` (the source of truth;
 * the server picks the price basis and this list only predicts it). CLICK was missing
 * here before, so every Click payment was previewed and chipped as «Zavod o'tkazma»
 * while the server booked it at «Zavod naqd» (Click = cash-equivalent, decision
 * 2026-07-13). CARD/USD are retired from entry but still carry historical FACTORY_OUT rows.
 */
const FACTORY_CASH_METHODS: readonly PaymentMethod[] = ['CASH', 'CLICK', 'CARD', 'USD'];

/**
 * Statuses at/after which the dealer→factory cost is actually on the ledger
 * (orders.service.ts COST_POSTED_STATUSES — the truck has left the factory).
 * Below these there is no factory debt to settle however large `costTotal` looks,
 * and `factoryOutstanding` comes back as 0.
 */
const COST_POSTED_STATUSES: readonly OrderStatus[] = [
  'LOADING',
  'DELIVERING',
  'DELIVERED',
  'COMPLETED',
];
/**
 * which allocation payment-kinds reduce each candidate's outstanding figure.
 *
 * client: BO'SH — mijoz qarzi endi SERVERDAN tayyor keladi (`clientOutstanding`:
 * savdo summasi − mijoz shofyorga bergan ulush − to'langani). Ekran uni qayta
 * hisoblamaydi, shuning uchun ayiriladigan narsa qolmadi.
 * transport: shofyorga qarz FAQAT «Diller to'laydi» rejimida bo'ladi va uni faqat
 * VEHICLE_OUT yopadi — TRANSPORT_DIRECT dillerning pulini umuman qimirlatmaydi.
 */
const REDUCING_KINDS: Record<'client' | 'factory' | 'transport', PaymentKind[]> = {
  client: [],
  factory: ['FACTORY_OUT'],
  transport: ['VEHICLE_OUT'],
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
  /**
   * The server base figure before deducting this family's active allocations.
   * The FACTORY family does NOT use it: its open figure is the detail payload's
   * `factoryOutstanding` (see outstandingMap) — `costTotal` is the whole order,
   * not what is still owed on it.
   */
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
  const isPhone = useIsPhone();
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

  /**
   * The price basis each slice this payment buys will be locked at (server rule:
   * payments.service.ts priceKindFor). Hoisted above `outstandingMap` because the
   * factory ceiling below must match this SAME basis — a naqd payment is capped at
   * `remainingCash`, everything else at `remainingBank` (money.md §4.2 / 2026-07-21
   * rework). It is stated PER ROW rather than once in the header, because one payment
   * now settles several orders partially and each of those slices is an independent
   * purchase at this basis — a single header line read as «this whole document is
   * priced X», which stops being true the moment the rest of an order is later bought
   * from the other channel.
   */
  const basisKind: PriceKind | null =
    family === 'factory' && pay
      ? FACTORY_CASH_METHODS.includes(pay.method)
        ? 'FACTORY_CASH'
        : 'FACTORY_BANK'
      : null;

  // ── candidates: the party's open documents, oldest-first ──
  const listQuery = useQuery({
    queryKey:
      family === 'transport'
        ? ['vehicles', partyId, 'settle', kind]
        : ['orders', 'settle', kind, partyId],
    queryFn: async (): Promise<Candidate[]> => {
      if (family === 'client') {
        const r = await endpoints.orders({ clientId: partyId as string, pageSize: 200 });
        return r.items
          .filter((o) => o.status !== 'CANCELLED')
          // `clientOutstanding` — serverning yagona qarz formulasi. Ilgari bu yerda
          // `saleTotal + transportCharge` qayta hisoblanardi va «Shofyorga mijoz
          // to'laydi» rejimida shofyor ulushini ikkinchi marta undirishni taklif qilardi.
          .map((o) => ({
            id: o.id,
            orderNo: o.orderNo,
            date: o.date,
            status: o.status,
            base: num(o.clientOutstanding),
          }));
      }
      if (family === 'factory') {
        const r = await endpoints.orders({ factoryId: partyId as string, pageSize: 200 });
        return r.items
          // `costStatus !== 'FINAL'` filtri o'lik: FINAL — tannarx QOTGANini
          // bildiradi, to'langanini emas, shuning uchun u qotgan-u hali
          // to'lanmagan buyurtmalarni ro'yxatdan butunlay yashirar edi. O'rniga
          // yagona haqiqiy shart: zavod qarzi yozilgan bo'lsin (yuklashdan
          // boshlab) — bundan oldin yopiladigan narsaning o'zi yo'q.
          .filter((o) => o.status !== 'CANCELLED' && COST_POSTED_STATUSES.includes(o.status))
          .map((o) => ({
            id: o.id,
            orderNo: o.orderNo,
            date: o.date,
            status: o.status,
            clientName: o.client?.name ?? null,
            costStatus: o.costStatus,
            base: num(o.costTotal), // ko'rsatilmaydi — pastdagi outstandingMap ga qarang
          }));
      }
      // transport: the vehicle-detail own-orders payload (last 50 reys)
      const v = (await endpoints.vehicle(partyId as string)) as { orders?: unknown[] };
      const rows = (v.orders ?? []) as Array<
        Order & { client?: { id: string; name: string } | null }
      >;
      // Diller shofyorga FAQAT «Diller to'laydi» rejimida qarzdor, shuning uchun
      // VEHICLE_OUT ro'yxatiga CLIENT_PAYS_DRIVER reyslari tushmaydi (aks holda
      // dillerda bo'lmagan qarz uchun fantom avans yozilardi). TRANSPORT_DIRECT esa
      // AKSINCHA — u faqat o'sha reyslarga tegishli (hujjat sifatida ko'rinadi).
      const clientPaysOnly = kind === 'TRANSPORT_DIRECT';
      return rows
        .filter(
          (o) =>
            o.status !== 'CANCELLED' &&
            num(o.transportCost) > 0 &&
            (clientPaysOnly
              ? o.transportMode === 'CLIENT_PAYS_DRIVER'
              : o.transportMode !== 'CLIENT_PAYS_DRIVER'),
        )
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

  const reducingKinds = REDUCING_KINDS[family];
  /** mijoz oilasida `base` allaqachon SOF qoldiq — hech narsa ayirilmaydi, detal kerak emas. */
  const needsDetail = reducingKinds.length > 0;

  // ── per-row outstanding: lazily resolved via GET /orders/:id (per-cell spinner) ──
  const details = useQueries({
    queries: candidates.map((c) => ({
      queryKey: ['orders', c.id],
      queryFn: () => endpoints.order(c.id),
      enabled: open && !!pay && needsDetail,
      staleTime: 30_000,
    })),
  });

  /** id → outstanding (number) once its detail resolves; undefined while loading. */
  const outstandingMap = useMemo<Record<string, number | undefined>>(() => {
    const out: Record<string, number | undefined> = {};
    candidates.forEach((c, i) => {
      if (!needsDetail) {
        out[c.id] = Math.max(0, c.base);
        return;
      }
      const d = details[i]?.data;
      if (!d) {
        out[c.id] = undefined;
        return;
      }
      // Zavod tomonida qayta hisoblash yo'q — server buni allaqachon beradi. Lekin
      // `factoryOutstanding` — buyurtmaning PROVISIONAL bazadagi umumiy qoldig'i, u
      // to'lov usulini bilmaydi. Server allocate() paytida esa faqat SHU to'lovning
      // BAZASIDAGI qoldiqni ruxsat beradi (`factoryCoverage.remainingCash` naqd/CLICK/
      // CARD/USD uchun, `remainingBank` qolganlari uchun — payments.service.ts
      // `room = cov.remaining[priceKind]`). Bank yoki UNKNOWN niyatli buyurtmada
      // remainingCash < factoryOutstanding, shuning uchun eski kod naqd to'lovni har
      // doim 400 bilan rad etilgan summaga taklif qilardi. `factoryOutstanding`ga
      // faqat basis hali aniqlanmagan yoki eski buyurtmada `factoryCoverage` yo'q
      // bo'lgan holatlarda qaytamiz.
      out[c.id] =
        family === 'factory'
          ? Math.max(
              0,
              d.factoryCoverage && basisKind
                ? num(basisKind === 'FACTORY_CASH' ? d.factoryCoverage.remainingCash : d.factoryCoverage.remainingBank)
                : num(d.factoryOutstanding),
            )
          : Math.max(0, c.base - activeAllocated(d, reducingKinds));
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates, details.map((d) => d.dataUpdatedAt).join(','), reducingKinds, needsDetail, family, basisKind]);

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
  // telefonda «Natija» bloki yopiq turadi — pastda sabab bor (footer flex-shrink:0)
  const [impactOpen, setImpactOpen] = useState(false);
  const timers = useRef<number[]>([]);
  const clearTimers = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };

  // reset the workbench on every fresh open
  useEffect(() => {
    if (open) {
      setAmounts({});
      setImpactOpen(false);
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
      const finalized = picked.filter((x) => x.amt >= (outstandingMap[x.c.id] ?? Infinity));
      const partial = picked.filter((x) => x.amt < (outstandingMap[x.c.id] ?? Infinity));
      if (finalized.length)
        out.push({
          tone: 'success',
          text: t('{n} ta buyurtma tannarxi qotiriladi ({price} narxida, buyurtma sanasidagi narx qatori)', {
            n: finalized.length,
            price: PRICE_KIND[basisKind ?? 'FACTORY_BANK'].label,
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

  // gorizontal ich-bo'shliq: telefonda 14px (320px da har piksel hisobda)
  const padX = isPhone ? 14 : 20;
  // FIFO tugmasining tooltip matni. Telefonda tooltip yo'q (R12) — o'sha matn
  // tugma ostida ko'rinadi, klaviatura yorlig'i «(A)» esa olib tashlanadi (R19).
  // Tarjima kaliti o'zgarmaydi, shuning uchun ru/en matnlari saqlanib qoladi.
  const fifoTip = t("Eskisidan boshlab, to'lov tugaguncha (A)");
  const fifoHint = fifoTip.replace(/\s*\(A\)\s*$/, '');

  return (
    <Drawer
      open={open}
      onClose={busy ? undefined : onClose}
      placement={isPhone ? 'bottom' : 'right'}
      className={isPhone ? 'sb-form-drawer--sheet' : undefined}
      title={t('Taqsimlash')}
      maskClosable={!busy}
      keyboard={!busy}
      // antd v6 da xom `width`/`height` proplari o'rniga semantik `wrapper` sloti
      // ishlatiladi. Desktopda geometriya o'zgarmaydi: min(760px, 100vw).
      styles={{
        wrapper: isPhone ? { width: '100%', height: '92dvh' } : { width: drawerWidth(760) },
        body: { padding: 0, display: 'flex', flexDirection: 'column' },
        footer: isPhone ? { padding: '12px 12px calc(12px + var(--sb-safe-b))' } : undefined,
      }}
      footer={
        pay && !readOnly ? (
          <Flex vertical gap={10}>
            {facts.length > 0 ? (
              isPhone ? (
                // `.ant-drawer-footer` da `flex-shrink: 0` — futer qancha joy
                // olsa, `flex: 1` nomzod ro'yxati shuncha yo'qotadi. 568px
                // ekranda ochiq «Natija» bloki ro'yxatga ~35px qoldirar edi:
                // foydalanuvchi N ta buyurtmani bir qatorlik derazadan
                // taqsimlashga majbur bo'lardi. Shuning uchun telefonda blok
                // yopiq turadi (bir qator) va so'ralganda ochiladi — ochiq
                // holatda ham dvh bilan cheklanadi (R16).
                <div>
                  <Button
                    type="link"
                    size="small"
                    onClick={() => setImpactOpen((v) => !v)}
                    icon={impactOpen ? <UpOutlined /> : <DownOutlined />}
                    aria-expanded={impactOpen}
                    // balandlikni mobil qatlamdagi `.ant-btn-sm { min-height: 40px }`
                    // hal qiladi — barmoq uchun yetarli nishon
                    style={{ paddingInline: 0 }}
                  >
                    {`${t('Natija')} — ${impactOpen ? t('Yashirish') : t("Ko'rsatish")}`}
                  </Button>
                  {impactOpen ? (
                    <div style={{ maxHeight: 'min(120px, 14dvh)', overflowY: 'auto', marginTop: 6 }}>
                      <LedgerImpactPreview facts={facts} />
                    </div>
                  ) : null}
                </div>
              ) : (
                <div>
                  <LedgerImpactPreview facts={facts} title={t('Natija')} />
                </div>
              )
            ) : null}
            {shownError ? (
              <Typography.Text
                type="danger"
                // uzun server xatosi ham futerni cho'zib yubormasin (R16)
                style={{
                  fontSize: 13,
                  whiteSpace: 'pre-wrap',
                  // span inline bo'lgani uchun maxHeight ishlamaydi — blokka aylantiriladi
                  ...(isPhone
                    ? { display: 'block', maxHeight: 'min(96px, 12dvh)', overflowY: 'auto' as const }
                    : null),
                }}
              >
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
            <div
              style={{
                padding: isPhone ? '12px 14px' : '16px 20px',
                borderBottom: `1px solid ${token.colorBorderSecondary}`,
              }}
            >
              <Flex align="center" gap={10} wrap="wrap">
                <StatusChip meta={PAYMENT_KIND[pay.kind]} variant="filled" />
                <Typography.Text
                  strong
                  style={{ fontSize: 15, minWidth: 0, wordBreak: isPhone ? 'break-word' : undefined }}
                >
                  {partyLabel}
                </Typography.Text>
              </Flex>
              <Flex align="baseline" gap={8} wrap="wrap" style={{ marginTop: 6 }}>
                <MoneyCell value={pay.amount} variant="neutral" strong suffix={t("so'm")} style={{ fontSize: 18 }} />
                <Typography.Text type="secondary">· {PAYMENT_METHOD[pay.method].label}</Typography.Text>
              </Flex>
              <Flex
                align="center"
                justify="space-between"
                gap={8}
                wrap="wrap"
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
                <Typography.Text type="secondary" style={{ fontSize: 13, minWidth: 0 }}>
                  {t('Taqsimlanmagan qoldiq')}
                </Typography.Text>
                <MoneyCell
                  value={remaining}
                  variant={excess > 0 ? 'weOwe' : remaining <= 0 ? 'in' : 'neutral'}
                  strong
                  suffix={t("so'm")}
                />
              </Flex>
              {basisKind ? (
                // Narx asosi endi har bir satrda chip bo'lib turadi; bu yerda faqat
                // qoldiqning taqdiri aytiladi, chunki foydalanuvchi ko'pincha
                // ATAYLAB kamroq taqsimlaydi va qolgani yo'qolib qolmasligini
                // bilishi kerak (R2).
                <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
                  {t("Taqsimlanmagan qoldiq zavodda avans bo'lib qoladi — u hech qaysi buyurtmani o'zi yopmaydi.")}
                </Typography.Text>
              ) : null}
            </div>

            {/* ── honest degrade / read-only banners ── */}
            {isTransportStandalone ? (
              <Alert
                type="info"
                showIcon
                style={{ margin: `12px ${padX}px 0` }}
                message={t("Transport to'lovi yaratilgandan so'ng taqsimlanmaydi")}
                description={t("Transport taqsimoti faqat to'lovni yaratish vaqtida bajariladi (server qoidasi). Quyidagi ro'yxat ma'lumot uchun.")}
              />
            ) : !canAllocate ? (
              <Alert
                type="info"
                showIcon
                style={{ margin: `12px ${padX}px 0` }}
                message={t('Taqsimlashni buxgalter bajaradi')}
              />
            ) : null}

            {/* ── toolbar ── */}
            {!readOnly ? (
              <div style={{ padding: isPhone ? '10px 14px 6px' : '12px 20px 8px' }}>
                <Flex align="center" gap={8} wrap="wrap">
                  {/* telefonda tooltip ochilmaydi — tushuntirish tugma ostida (R12) */}
                  <Tooltip title={isPhone ? '' : fifoTip}>
                    <Button
                      icon={<ThunderboltOutlined />}
                      onClick={runFifo}
                      disabled={!fillableOrder.length || !detailsSettled || remaining <= 0}
                      // 320px da uzun o'zbekcha yorliq kesilmasin: ikki qatorga o'tadi
                      style={
                        isPhone
                          ? {
                              flex: '1 1 auto',
                              minWidth: 0,
                              whiteSpace: 'normal',
                              height: 'auto',
                              minHeight: 44,
                              paddingTop: 6,
                              paddingBottom: 6,
                            }
                          : undefined
                      }
                    >
                      {t('Eskisidan boshlab taqsimlash')}
                    </Button>
                  </Tooltip>
                  {/* telefonda faqat ikonka — yorliq aria-label sifatida qoladi (R13) */}
                  <Button
                    icon={<ClearOutlined />}
                    onClick={reset}
                    disabled={!enteredTotal}
                    aria-label={t('Tozalash')}
                  >
                    {isPhone ? null : t('Tozalash')}
                  </Button>
                </Flex>
                {isPhone ? (
                  <Typography.Text
                    type="secondary"
                    style={{ display: 'block', fontSize: 12, marginTop: 6 }}
                  >
                    {fifoHint}
                  </Typography.Text>
                ) : null}
              </div>
            ) : null}

            {/* ── candidate list ── */}
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                // telefonda scroll orqadagi sahifaga o'tib ketmasin (§4 gesture safety)
                overscrollBehavior: isPhone ? 'contain' : undefined,
                padding: isPhone ? '4px 14px 16px' : '4px 20px 20px',
              }}
            >
              {listQuery.isError ? (
                <Empty description={apiError(listQuery.error)} />
              ) : !candidates.length ? (
                <Empty description={t("Ochiq hujjat yo'q")} image={Empty.PRESENTED_IMAGE_SIMPLE} />
              ) : (
                <>
                  {/* column caption — telefonda ustunlar yo'q, sarlavha ham yo'q */}
                  {!isPhone ? (
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
                  ) : null}

                  {candidates.map((c, i) => {
                    const outstanding = outstandingMap[c.id];
                    const resolving = details[i]?.isLoading ?? true;
                    const reason = disabledReason[c.id];
                    const existing = existingByOrder[c.id];
                    const entered = num(amounts[c.id] ?? 0);
                    const max = rowMax(c.id);
                    const rowDisabled = readOnly || !!reason || outstanding === 0 || max <= 0;
                    const fullyCovers = outstanding != null && entered >= outstanding && entered > 0;

                    // per-row status chip (+ the basis THIS slice is bought at)
                    const chip =
                      family === 'factory' ? (
                        <>
                          {c.costStatus ? <StatusChip meta={COST_STATUS[c.costStatus]} /> : null}
                          {basisKind ? <StatusChip meta={PRICE_KIND[basisKind]} /> : null}
                        </>
                      ) : family === 'transport' && c.transportPaidStatus ? (
                        <StatusChip meta={TRANSPORT_PAID[c.transportPaidStatus]} />
                      ) : (
                        <StatusChip meta={STATUS[c.status]} />
                      );

                    // ── qatorning uch bo'lagi: desktopda uch ustun, telefonda ustma-ust ──
                    const box = (
                      <Checkbox
                        checked={entered > 0}
                        disabled={rowDisabled}
                        onChange={(e) => toggleRow(c.id, e.target.checked)}
                        aria-label={c.orderNo}
                        // telefonda barmoq uchun kattaroq nishon (§4 — 44px)
                        style={isPhone ? { padding: '12px 16px 12px 0', margin: '-12px 0' } : undefined}
                      />
                    );

                    const identity = (
                      <>
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
                      </>
                    );

                    // figure — per-cell spinner while the allocation Σ resolves
                    const figure =
                      resolving && outstanding == null ? (
                        <Spin size="small" />
                      ) : outstanding === 0 ? (
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {t("to'liq")}
                        </Typography.Text>
                      ) : (
                        <MoneyCell value={outstanding} variant="neutral" />
                      );

                    // amount input + forecast chip
                    const amountCell = readOnly ? (
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
                    );

                    const rowStyle = {
                      padding: isPhone ? '12px 0' : '10px 0',
                      borderBottom: `1px solid ${token.colorBorderSecondary}`,
                      opacity: reason ? 0.55 : 1,
                    };

                    // ── telefon: 360px da uchta ustun sig'maydi — ustma-ust ──
                    if (isPhone) {
                      return (
                        <Flex key={c.id} vertical gap={8} style={rowStyle}>
                          <Flex align="flex-start" gap={10}>
                            {!readOnly ? box : null}
                            <div style={{ flex: 1, minWidth: 0 }}>{identity}</div>
                          </Flex>
                          {/* ustun sarlavhasi yo'q — yorliq qiymat yonida ko'rinadi */}
                          <Flex align="center" justify="space-between" gap={8} wrap="wrap">
                            <Typography.Text type="secondary" style={{ fontSize: 12, minWidth: 0 }}>
                              {figureLabel}
                            </Typography.Text>
                            {figure}
                          </Flex>
                          <div>{amountCell}</div>
                        </Flex>
                      );
                    }

                    return (
                      <Flex key={c.id} align="center" gap={10} style={rowStyle}>
                        {!readOnly ? box : null}
                        <div style={{ flex: 1, minWidth: 0 }}>{identity}</div>
                        <div style={{ width: 160, textAlign: 'right' }}>{figure}</div>
                        <div style={{ width: 190 }}>{amountCell}</div>
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
