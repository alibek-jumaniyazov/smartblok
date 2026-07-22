// PaymentComposer — kind-first payment entry drawer (04 §3.3, money.md §3,
// hero flows §2–4). The 961-line morphing modal in Payments.tsx dies here: one
// intent = one fixed kind = one form; the kind NEVER morphs mid-form, nothing is
// silently wiped. Commits POST /payments (CreatePaymentDto). Every field maps to
// a verified DTO field (apps/api/src/payments/dto.ts); kind↔party invariants and
// the BONUS-never rule mirror payments.service.ts.
//
// Role variants (06-decisions D2):
//  • A/B — full, incl. «Saqlash va taqsimlash» chain into SettleDrawer.
//  • CASHIER — all kinds, NO allocation section; handoff line «Taqsimlashni
//    buxgalter bajaradi»; payment lands in the Taqsimlanmagan queue.
//  • AGENT — NOT wired for CLIENT_IN cash booking (backend gap: agents cannot
//    enumerate cashboxes). Renders the honest degraded state rather than a broken
//    cashbox picker.
//
//   MOBIL (mobile-responsive-spec §2.3, R3/R5/R16/R17/R19): telefonda drawer
//   PASTKI VARAQQA aylanadi (placement="bottom", 92dvh, tortish tutqichi) —
//   FormDrawer bilan bir xil xulq, lekin footer bu yerda uch holatli (agent /
//   muvaffaqiyat / forma) bo'lgani uchun Drawer xom qoladi. Segmented'lar
//   telefonda `block` emas: yorliqlar («Terminal», «So'm + dollar») 320px da
//   kesilmasin — .sb-scroll-x ichida gorizontal suriladi. Desktop (>=992px)
//   piksel-piksel o'zgarmagan.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  App,
  Button,
  Checkbox,
  DatePicker,
  Divider,
  Drawer,
  Flex,
  Input,
  Segmented,
  Spin,
  theme,
  Typography,
} from 'antd';
import { CheckCircleFilled, PrinterOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { apiError, endpoints } from '../lib/api';
import { fmtMoney, num } from '../lib/format';
import { drawerWidth, useIsPhone, TOUCH_MIN } from '../lib/responsive';
import { PAYMENT_METHOD } from '../lib/status-maps';
import { useAuth } from '../auth/AuthContext';
import { BalanceTag } from './BalanceTag';
import { EmptyState } from './EmptyState';
import { MoneyCell } from './MoneyCell';
import { MoneyInput } from './MoneyInput';
import { PartySelect, CashboxSelect, type PartySelectType } from './PartySelect';
import { SettleDrawer, type AllocationInput } from './SettleDrawer';
import { useT } from './LangContext';
import type { Money, Payment, PaymentKind, PaymentMethod } from '../lib/types';

// The allocation chain (04 §3.2) opens the real SettleDrawer over the freshly
// committed payment — from the success-state «Taqsimlash» button and the
// «Saqlash va taqsimlash» pre-submit checkbox (which auto-opens it on success).
// Standalone allocation is the CLIENT_IN / FACTORY_OUT endpoint; VEHICLE_OUT
// degrades honestly to read-only inside the drawer.
// TRANSPORT_DIRECT bu yerdan MUSTAQIL ochilmaydi: API uni taqsimotsiz rad etadi
// (har bir satr «Shofyorga mijoz to'laydi» rejimidagi buyurtmaga tegishli bo'lishi
// shart), shuning uchun u faqat `presetOrder` bilan — buyurtma kartasidan — keladi
// va taqsimot yaratish DTO'sida ketadi.

/** the 4 live entry methods + the box family each settles into. */
const ENTRY_METHODS = ['CASH', 'CLICK', 'TERMINAL', 'BANK'] as const;
const KASSA_METHODS: readonly PaymentMethod[] = ['CASH', 'CLICK'];
/** cashbox types each method family may use. */
const KASSA_BOX_TYPES = ['CASH', 'CLICK'] as const;
const BANK_BOX_TYPES = ['TERMINAL', 'BANK'] as const;

type CurrencyMode = 'UZS' | 'USD' | 'BOTH';

/** entity families to invalidate on a committed payment (realtime.ts contract). */
const PAYMENT_INVALIDATE = [
  'payments', 'orders', 'dashboard', 'debts', 'clients', 'kassa', 'factories', 'vehicles', 'reports',
] as const;

type LegalSlot = 'payer' | 'receiver';

interface KindDesc {
  /** drawer title = the intent verb (03 §12 glossary). */
  title: string;
  /** footer primary verb, e.g. «Qabul qilish». */
  verb: string;
  /** self-disabled submit label, e.g. «Qabul qilinmoqda…». */
  progress: string;
  /** which party selects render, in order. */
  parties: PartySelectType[];
  cashbox: boolean;
  allocatable: boolean;
  /** which legal-entity slot the counterparty maps to (none for TRANSPORT_DIRECT). */
  legalSlot?: LegalSlot;
  legalLabel?: string;
}

const KIND: Record<PaymentKind, KindDesc> = {
  CLIENT_IN: {
    // allocatable:false — client money is settled by the SERVER, oldest order first
    // (api common/auto-allocate.ts). No «Saqlash va taqsimlash» step, no drawer.
    title: "To'lov qabul qilish", verb: 'Qabul qilish', progress: 'Qabul qilinmoqda…',
    parties: ['client'], cashbox: true, allocatable: false, legalSlot: 'payer', legalLabel: "To'lovchi",
  },
  CLIENT_REFUND: {
    title: 'Mijozga qaytarish', verb: 'Qaytarish', progress: 'Qaytarilmoqda…',
    parties: ['client'], cashbox: true, allocatable: false, legalSlot: 'receiver', legalLabel: 'Qabul qiluvchi',
  },
  FACTORY_OUT: {
    title: "Zavodga to'lash", verb: "To'lash", progress: "To'lanmoqda…",
    parties: ['factory'], cashbox: true, allocatable: true, legalSlot: 'receiver', legalLabel: 'Qabul qiluvchi',
  },
  FACTORY_REFUND: {
    title: 'Zavoddan qaytim', verb: 'Qabul qilish', progress: 'Qabul qilinmoqda…',
    parties: ['factory'], cashbox: true, allocatable: false, legalSlot: 'payer', legalLabel: "To'lovchi",
  },
  VEHICLE_OUT: {
    title: "Shofyorga to'lash", verb: "To'lash", progress: "To'lanmoqda…",
    parties: ['vehicle'], cashbox: true, allocatable: true, legalSlot: 'receiver', legalLabel: 'Qabul qiluvchi',
  },
  TRANSPORT_DIRECT: {
    // allocatable:false — taqsimot YARATISHDA yuboriladi (API taqsimotsiz qabul qilmaydi,
    // chunki har bir satr «Shofyorga mijoz to'laydi» rejimidagi buyurtmaga tegishli
    // bo'lishi shart). Keyingi «Taqsimlash» qadami yo'q.
    title: "Mijoz shofyorga to'ladi", verb: 'Saqlash', progress: 'Saqlanmoqda…',
    parties: ['client', 'vehicle'], cashbox: false, allocatable: false,
  },
};

const PARTY_LABEL: Record<PartySelectType, string> = {
  client: 'Mijoz', factory: 'Zavod', vehicle: 'Moshina', agent: 'Agent',
};

// ── settlement framing (money.md §3.2, hero flows) — turns the counterparty's
// signed balance into an unsigned "base" being settled, so the drawer can show a
// prominent debt hero + a live «base − to'lov = qoldiq / avansga» preview. Sign
// convention mirrors BalanceTag: client +=Qarz, factory/vehicle −=Qarzimiz.
type SettleFamily = 'client' | 'factory' | 'vehicle' | 'none';
interface SettleDesc {
  family: SettleFamily;
  /** hero + preview caption for the counterparty balance being settled */
  heroLabel: string;
  /** the quick-fill chip label («To'liq qarz» / «To'liq avans») */
  fillLabel: string;
  /** preview line when to'lov ≤ base */
  afterLabel: string;
  /** preview line (amber) when to'lov > base */
  overLabel: string;
  /** signed balance → unsigned settleable magnitude */
  base: (raw: number) => number;
}
const SETTLE: Record<PaymentKind, SettleDesc> = {
  CLIENT_IN: { family: 'client', heroLabel: "Yig'iladigan qarz", fillLabel: "To'liq qarz", afterLabel: 'Qoldiq qarz', overLabel: 'Avansga', base: (r) => Math.max(0, r) },
  CLIENT_REFUND: { family: 'client', heroLabel: 'Mijoz avansi', fillLabel: "To'liq avans", afterLabel: 'Qolgan avans', overLabel: 'Ortiqcha', base: (r) => Math.max(0, -r) },
  FACTORY_OUT: { family: 'factory', heroLabel: 'Zavodga qarzimiz', fillLabel: "To'liq qarz", afterLabel: 'Qolgan qarz', overLabel: 'Avansimizga', base: (r) => Math.max(0, -r) },
  FACTORY_REFUND: { family: 'factory', heroLabel: 'Zavod avansimiz', fillLabel: "To'liq avans", afterLabel: 'Qolgani', overLabel: 'Ortiqcha', base: (r) => Math.max(0, r) },
  VEHICLE_OUT: { family: 'vehicle', heroLabel: 'Shofyorga qarzimiz', fillLabel: "To'liq qarz", afterLabel: 'Qolgan qarz', overLabel: 'Avansga', base: (r) => Math.max(0, -r) },
  TRANSPORT_DIRECT: { family: 'none', heroLabel: '', fillLabel: '', afterLabel: '', overLabel: '', base: () => 0 },
};

/** the party currency-agnostic BalanceTag type (agent has no BalanceTag). */
type BalancePartyType = 'client' | 'factory' | 'vehicle';

/** loose party record captured from PartySelect's onChange. */
type PartyLike = { name?: string; balance?: Money | null; palletBalance?: number | null; driver?: string | null };

export interface ComposerPresetParty {
  id: string;
  /** which slot to bind; defaults to the kind's single party (vehicle for TRANSPORT_DIRECT). */
  type?: PartySelectType;
  name?: string;
  balance?: Money | number | null;
  palletBalance?: number | null;
  /** debt-row context → the «Muddati o'tgani» quick chip (money.md §3.2). */
  overdueTotal?: Money | number | null;
}

export interface PaymentComposerProps {
  open: boolean;
  onClose: () => void;
  kind: PaymentKind;
  /** pre-bound party (locked when launched from a debt row / party hub). */
  presetParty?: ComposerPresetParty;
  /**
   * Buyurtmaga bog'langan to'lov: taqsimot YARATISH DTO'sida ketadi.
   * TRANSPORT_DIRECT uchun MAJBURIY — API taqsimotsiz bunday to'lovni rad etadi
   * (shofyor ulushi faqat «Shofyorga mijoz to'laydi» rejimidagi buyurtmaga yoziladi).
   */
  presetOrder?: { id: string; orderNo?: string };
  /** buyurtmadan kelgan mijoz — ikkinchi tomon sloti (TRANSPORT_DIRECT). */
  presetClientId?: string;
  presetClientName?: string;
  /** outstanding pre-fill (UZS), rendered selected so one keystroke replaces it. */
  presetAmount?: Money | number;
  lockParty?: boolean;
  /** called with the committed payment (parent may open SettleDrawer, pulse a row…). */
  onSuccess?: (payment: Payment) => void;
}

interface ComposerState {
  clientId?: string;
  factoryId?: string;
  vehicleId?: string;
  date: string; // YYYY-MM-DD
  method: PaymentMethod;
  /** currency mode (naqd only): UZS / USD / UZS+USD mixed. Non-naqd is always UZS. */
  currencyMode: CurrencyMode;
  amount: string; // som (UZS) digits — the som part
  usdAmount: string;
  rate: string;
  cashboxId?: string; // som (UZS) box
  usdCashboxId?: string; // dollar (USD) box — naqd USD/mixed only
  payerEntityId?: string;
  payerName?: string;
  receiverEntityId?: string;
  receiverName?: string;
  note?: string;
  saveAndAllocate: boolean;
}

/** which slot a preset binds to (vehicle is the pre-bound slot for TRANSPORT_DIRECT). */
function presetSlot(kind: PaymentKind, preset?: ComposerPresetParty): PartySelectType | undefined {
  if (!preset) return undefined;
  if (preset.type) return preset.type;
  const p = KIND[kind].parties;
  if (p.length === 1) return p[0];
  return 'vehicle';
}

function digits(v: Money | number | null | undefined): string {
  if (v == null || v === '') return '';
  return String(Math.round(num(v)));
}

function buildInitial(
  kind: PaymentKind,
  presetParty: ComposerPresetParty | undefined,
  presetAmount: Money | number | undefined,
  presetClientId?: string,
): ComposerState {
  const slot = presetSlot(kind, presetParty);
  return {
    clientId: slot === 'client' ? presetParty?.id : presetClientId,
    factoryId: slot === 'factory' ? presetParty?.id : undefined,
    vehicleId: slot === 'vehicle' ? presetParty?.id : undefined,
    date: dayjs().format('YYYY-MM-DD'),
    method: 'CASH',
    currencyMode: 'UZS',
    amount: presetAmount != null ? digits(presetAmount) : '',
    usdAmount: '',
    rate: '',
    cashboxId: undefined,
    usdCashboxId: undefined,
    payerEntityId: undefined,
    payerName: undefined,
    receiverEntityId: undefined,
    receiverName: undefined,
    note: '',
    saveAndAllocate: false,
  };
}

export function PaymentComposer({
  open,
  onClose,
  kind,
  presetParty,
  presetOrder,
  presetClientId,
  presetClientName,
  presetAmount,
  lockParty = false,
  onSuccess,
}: PaymentComposerProps) {
  const { token } = theme.useToken();
  const t = useT();
  const isPhone = useIsPhone();
  const { modal } = App.useApp();
  const { hasRole } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();

  const isAgent = hasRole('AGENT');
  const isCashier = hasRole('CASHIER');
  const canAllocate = hasRole('ADMIN', 'ACCOUNTANT');

  const desc = KIND[kind];
  const slot = presetSlot(kind, presetParty);
  const draftKey = `sb:paycomposer:${location.pathname}:${kind}`;

  const [state, setState] = useState<ComposerState>(() => buildInitial(kind, presetParty, presetAmount, presetClientId));
  const [records, setRecords] = useState<Partial<Record<PartySelectType, PartyLike>>>({});
  const [methodTouched, setMethodTouched] = useState(false);
  const [idemKey, setIdemKey] = useState('');
  const [serverError, setServerError] = useState<unknown>(null);
  const [success, setSuccess] = useState<Payment | null>(null);
  const [settleOpen, setSettleOpen] = useState(false);
  const [factoryPickerOpen, setFactoryPickerOpen] = useState(false);
  const pristineRef = useRef<string>('');
  const prevOpen = useRef(false);
  /** set at submit time when «Saqlash va taqsimlash» is checked → auto-open settle. */
  const wantSettleRef = useRef(false);

  const patch = (p: Partial<ComposerState>) => setState((s) => ({ ...s, ...p }));

  // ── open transition: fresh state + draft restore + fresh idempotency key ──
  useEffect(() => {
    if (open && !prevOpen.current) {
      const init = buildInitial(kind, presetParty, presetAmount, presetClientId);
      pristineRef.current = JSON.stringify(init);

      let restored: ComposerState = init;
      try {
        const raw = sessionStorage.getItem(draftKey);
        if (raw) {
          const draft = JSON.parse(raw) as Partial<ComposerState>;
          restored = { ...init, ...draft };
          // locked party can never be overridden by a stale draft
          if (lockParty && slot) {
            restored.clientId = slot === 'client' ? presetParty?.id : restored.clientId;
            restored.factoryId = slot === 'factory' ? presetParty?.id : restored.factoryId;
            restored.vehicleId = slot === 'vehicle' ? presetParty?.id : restored.vehicleId;
          }
          // buyurtmadan kelgan mijoz ham qulflangan — eski qoralama uni almashtirmasin
          if (presetClientId) restored.clientId = presetClientId;
        }
      } catch {
        restored = init;
      }

      setState(restored);
      setMethodTouched(restored.method !== 'CASH');
      setRecords(
        slot && presetParty
          ? { [slot]: { name: presetParty.name, balance: presetParty.balance as Money | null, palletBalance: presetParty.palletBalance } }
          : {},
      );
      setIdemKey(crypto.randomUUID()); // double-click-safe: one key per open
      setServerError(null);
      setSuccess(null);
      setSettleOpen(false);
      wantSettleRef.current = false;
      // stale-balance law (02 §9): cashbox live balances refetch on every open
      qc.invalidateQueries({ queryKey: ['cashboxes'] });
    }
    prevOpen.current = open;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ── draft persistence per route (dirty-close confirmed) ──
  useEffect(() => {
    if (!open || success) return;
    try {
      sessionStorage.setItem(draftKey, JSON.stringify(state));
    } catch {
      /* sessionStorage full / unavailable — draft is best-effort */
    }
  }, [state, open, success, draftKey]);

  const clearDraft = () => {
    try {
      sessionStorage.removeItem(draftKey);
    } catch {
      /* ignore */
    }
  };

  // ── party's last-used method (default; endpoint has no vehicle filter) ──
  const lastMethodType: BalancePartyType | null =
    desc.parties.includes('client') && !desc.parties.includes('vehicle')
      ? 'client'
      : desc.parties.length === 1 && desc.parties[0] === 'factory'
        ? 'factory'
        : null;
  const lastMethodPartyId =
    lastMethodType === 'client' ? state.clientId : lastMethodType === 'factory' ? state.factoryId : undefined;

  const lastMethodQ = useQuery({
    queryKey: ['payments', 'last-method', lastMethodType, lastMethodPartyId],
    queryFn: () =>
      endpoints.payments({
        pageSize: 1,
        clientId: lastMethodType === 'client' ? lastMethodPartyId : undefined,
        factoryId: lastMethodType === 'factory' ? lastMethodPartyId : undefined,
      }),
    enabled: open && !success && !methodTouched && !!lastMethodPartyId,
    staleTime: 60_000,
  });

  useEffect(() => {
    const m = lastMethodQ.data?.items?.[0]?.method;
    if (m && m !== 'BONUS' && !methodTouched) patch({ method: m });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastMethodQ.data]);

  // ── currency mode (naqd only): does this payment carry a som part / a usd part? ──
  const usesUsd = state.method === 'CASH' && (state.currencyMode === 'USD' || state.currencyMode === 'BOTH');
  const usesSom = !(state.method === 'CASH' && state.currencyMode === 'USD');
  const kassaMethod = KASSA_METHODS.includes(state.method);

  // ── kurs pre-fill: most recent payment carrying a rate, once per open ──
  const lastRateQ = useQuery({
    queryKey: ['payments', 'last-rate'],
    queryFn: () => endpoints.payments({ pageSize: 10 }),
    enabled: open && !success,
    staleTime: 5 * 60_000,
  });
  useEffect(() => {
    if (usesUsd && !state.rate) {
      const r = lastRateQ.data?.items?.find((p) => num(p.rate) > 0)?.rate;
      if (r) patch({ rate: String(r) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.method, state.currencyMode, lastRateQ.data]);

  // ── derived total (UZS-equivalent = som part + usd×rate) ──
  const somPart = usesSom ? num(state.amount) : 0;
  const usdPart = usesUsd ? num(state.usdAmount) * num(state.rate) : 0;
  const totalUZS = Math.round(somPart + usdPart);

  const partiesReady = desc.parties.every((t) =>
    t === 'client' ? !!state.clientId : t === 'factory' ? !!state.factoryId : !!state.vehicleId,
  );
  const amountReady =
    totalUZS > 0 &&
    (!usesSom || num(state.amount) > 0) &&
    (!usesUsd || (num(state.usdAmount) > 0 && num(state.rate) > 0));
  const needSomBox = desc.cashbox && usesSom;
  const needUsdBox = desc.cashbox && usesUsd;
  const cashboxReady = (!needSomBox || !!state.cashboxId) && (!needUsdBox || !!state.usdCashboxId);

  // ── settlement base: the counterparty balance this payment settles (hero +
  // live preview). Read from the live picked record (records[slot]) so it works
  // even when the composer is opened cold from the register (no preset). ──
  const settle = SETTLE[kind];
  const primarySlot: BalancePartyType | null =
    settle.family === 'client' ? 'client' : settle.family === 'factory' ? 'factory' : settle.family === 'vehicle' ? 'vehicle' : null;
  const primaryBalance = primarySlot
    ? records[primarySlot]?.balance ?? (slot === primarySlot ? presetParty?.balance : undefined)
    : undefined;
  const base: number | null =
    settle.family === 'none' || primaryBalance == null ? null : settle.base(num(primaryBalance));

  const createM = useMutation({
    mutationFn: (dto: Record<string, unknown>) => endpoints.createPayment(dto),
    onSuccess: (payment) => {
      clearDraft();
      for (const key of PAYMENT_INVALIDATE) qc.invalidateQueries({ queryKey: [key] });
      setServerError(null);
      setSuccess(payment);
      onSuccess?.(payment);
      // «Saqlash va taqsimlash» chain (04 §3.2): open the allocation workbench
      // over the just-committed payment.
      if (wantSettleRef.current) setSettleOpen(true);
      wantSettleRef.current = false;
    },
    onError: (err: unknown) => {
      setServerError(err);
      // shortfall / stale balance — refetch cashbox balances so the picker corrects
      qc.invalidateQueries({ queryKey: ['cashboxes'] });
    },
  });

  // TRANSPORT_DIRECT buyurtmasiz yuborilsa API 400 qaytaradi — tugma umuman ochilmaydi.
  const orderRequired = kind === 'TRANSPORT_DIRECT';
  const orderReady = !orderRequired || !!presetOrder;
  const canSubmit = partiesReady && amountReady && cashboxReady && orderReady && !createM.isPending;

  const buildDto = (): Record<string, unknown> => {
    const dto: Record<string, unknown> = {
      date: state.date,
      kind,
      method: state.method,
      idempotencyKey: idemKey || undefined,
      note: state.note?.trim() || undefined,
    };
    if (desc.parties.includes('client')) dto.clientId = state.clientId;
    if (desc.parties.includes('factory')) dto.factoryId = state.factoryId;
    if (desc.parties.includes('vehicle')) dto.vehicleId = state.vehicleId;
    if (usesSom) dto.amount = state.amount;
    if (usesUsd) {
      dto.usdAmount = state.usdAmount;
      dto.rate = state.rate;
    }
    if (desc.cashbox) {
      if (usesSom) dto.cashboxId = state.cashboxId;
      if (usesUsd) dto.usdCashboxId = state.usdCashboxId;
    }
    if (desc.legalSlot === 'payer') {
      dto.payerEntityId = state.payerEntityId || undefined;
      dto.payerName = state.payerName?.trim() || undefined;
    } else if (desc.legalSlot === 'receiver') {
      dto.receiverEntityId = state.receiverEntityId || undefined;
      dto.receiverName = state.receiverName?.trim() || undefined;
    }
    // buyurtmaga bog'langan to'lov (TRANSPORT_DIRECT): taqsimot AYNI YARATISHDA ketadi
    if (presetOrder) dto.allocations = [{ orderId: presetOrder.id, amount: state.amount }];
    return dto;
  };

  const submit = () => {
    if (!canSubmit) return;
    setServerError(null);
    wantSettleRef.current = state.saveAndAllocate && canAllocate && desc.allocatable;
    createM.mutate(buildDto());
  };

  // ── zavodga to'lov: to'lov PAYTIDA to'lanmagan buyurtmalarni tanlab, TO'G'RIDAN-TO'G'RI
  //    yopish (avansga tushirmasdan). Backendda bir chaqiruv: to'lov yaratiladi va o'sha
  //    zahoti tanlangan buyurtmalarga «avansdan yechish» qilinadi. Kassirda yo'q — u avansga
  //    to'laydi, taqsimlashni buxgalter bajaradi. Usul (naqd/o'tkazma) narx asosini belgilaydi.
  const isFactorySettle = kind === 'FACTORY_OUT' && canAllocate;
  const syntheticFactoryPayment = useMemo(
    () =>
      isFactorySettle && state.factoryId
        ? ({
            id: '',
            kind: 'FACTORY_OUT',
            method: state.method,
            factoryId: state.factoryId,
            // floor the som-equivalent so the picker's ceiling can never exceed the amount the
            // backend actually stores (round2), which would otherwise 400 on a fractional-USD pay
            amount: String(Math.floor(somPart + usdPart)),
            date: state.date,
            allocations: [],
            factory: records.factory?.name ? { id: state.factoryId, name: records.factory.name } : undefined,
          } as unknown as Payment)
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isFactorySettle, state.factoryId, state.method, totalUZS, state.date, records.factory],
  );

  const submitFactoryAllocations = async (allocations: AllocationInput[]) => {
    const dto = buildDto();
    dto.allocations = allocations;
    try {
      await createM.mutateAsync(dto);
      setFactoryPickerOpen(false);
    } catch {
      // xato serverError orqali ko'rsatiladi (createM.onError) — drawer ochiq qoladi
    }
  };
  const submitAsAdvance = () => {
    if (!canSubmit) return;
    setServerError(null);
    wantSettleRef.current = false;
    createM.mutate(buildDto());
  };

  const isDirty = useMemo(
    () => !success && JSON.stringify(state) !== pristineRef.current,
    [state, success],
  );

  const requestClose = () => {
    if (createM.isPending) return;
    if (isDirty) {
      modal.confirm({
        title: t("Saqlanmagan o'zgarishlar"),
        content: t("Bu to'lov qoralamasi hali saqlanmadi. Chiqilsinmi?"),
        okText: t('Chiqish'),
        cancelText: t('Qolish'),
        okButtonProps: { danger: true },
        // R16 — telefonda markazda: klaviatura yopilganda ham futer ko'rinib turadi
        centered: isPhone,
        onOk: onClose,
      });
      return;
    }
    onClose();
  };

  // open the allocation workbench over the committed payment (success state).
  const requestSettle = () => {
    if (success) setSettleOpen(true);
  };

  const resetForAnother = () => {
    const init = buildInitial(kind, presetParty, presetAmount, presetClientId);
    pristineRef.current = JSON.stringify(init);
    setState(init);
    setMethodTouched(false);
    setRecords(
      slot && presetParty
        ? { [slot]: { name: presetParty.name, balance: presetParty.balance as Money | null, palletBalance: presetParty.palletBalance } }
        : {},
    );
    setIdemKey(crypto.randomUUID());
    setServerError(null);
    setSuccess(null);
    setSettleOpen(false);
    wantSettleRef.current = false;
    clearDraft();
  };

  const handlePartyChange = (t: PartySelectType, id: string | undefined, rec?: PartyLike) => {
    const p: Partial<ComposerState> = {};
    if (t === 'client') p.clientId = id;
    if (t === 'factory') p.factoryId = id;
    if (t === 'vehicle') {
      p.vehicleId = id;
      // shofyor nomi prefilled as the receiver free-text (money.md §3.2)
      if (desc.legalSlot === 'receiver' && rec?.driver && !state.receiverName) p.receiverName = rec.driver;
    }
    patch(p);
    setRecords((prev) => ({ ...prev, [t]: rec }));
  };

  // ── success-state party balance delta (refetched, money.md §3.3) ──
  const deltaType: BalancePartyType = desc.parties.includes('client')
    ? 'client'
    : desc.parties.includes('factory')
      ? 'factory'
      : 'vehicle';
  const deltaId =
    deltaType === 'client' ? success?.clientId : deltaType === 'factory' ? success?.factoryId : success?.vehicleId;

  const balanceAfterQ = useQuery({
    queryKey: [deltaType === 'client' ? 'clients' : deltaType === 'factory' ? 'factories' : 'vehicles', deltaId, 'balance-after'],
    queryFn: async (): Promise<Money | undefined> => {
      if (!deltaId) return undefined;
      if (deltaType === 'client') return (await endpoints.client(deltaId)).balance as Money | undefined;
      if (deltaType === 'factory') return (await endpoints.factory(deltaId)).balance as Money | undefined;
      return (await endpoints.vehicle(deltaId)).balance as Money | undefined;
    },
    // TRANSPORT_DIRECT balansga tegmaydi — so'rov ham yubormaymiz
    enabled: !!success && !!deltaId && kind !== 'TRANSPORT_DIRECT',
  });

  // ─────────────────────────── render helpers ───────────────────────────

  const label = (text: string) => (
    <div style={{ fontSize: 13, fontWeight: 500, color: token.colorText, marginBottom: 4 }}>{t(text)}</div>
  );

  const renderParty = (pt: PartySelectType) => {
    // buyurtmadan ochilganda MIJOZ ham qulflanadi — u buyurtmaning mijozi, tanlanmaydi
    const locked = lockParty && (pt === slot || (pt === 'client' && !!presetClientId));
    const rec = records[pt];
    // the primary settlement party leads with a prominent debt hero; the small
    // BalanceTag is suppressed for it (the hero states the same balance clearer)
    const showHero = pt === primarySlot && base != null && base > 0;
    const tag =
      !showHero && rec?.balance != null ? (
        <BalanceTag balance={String(rec.balance)} partyType={pt as BalancePartyType} compact pallets={pt === 'client' ? rec.palletBalance : undefined} />
      ) : null;
    return (
      <div key={pt}>
        {label(PARTY_LABEL[pt])}
        {locked ? (
          <Flex
            align="center"
            justify="space-between"
            gap={8}
            style={{
              padding: '6px 10px',
              border: `1px solid ${token.colorBorderSecondary}`,
              borderRadius: token.borderRadius,
              background: token.colorFillTertiary,
            }}
          >
            {/* R6 — matnli flex bolasi qisila olishi uchun minWidth:0 */}
            <Typography.Text strong ellipsis style={{ minWidth: 0 }}>
              {rec?.name ?? (pt === slot ? presetParty?.name : undefined) ?? (pt === 'client' ? presetClientName : undefined) ?? '—'}
            </Typography.Text>
            {tag}
          </Flex>
        ) : (
          <>
            <PartySelect
              type={pt}
              value={pt === 'client' ? state.clientId : pt === 'factory' ? state.factoryId : state.vehicleId}
              onChange={(id, party) => handlePartyChange(pt, id, party)}
            />
            {tag ? <div style={{ marginTop: 6 }}>{tag}</div> : null}
          </>
        )}
        {showHero ? (
          <div
            style={{
              marginTop: 8,
              background: token.colorFillTertiary,
              borderRadius: token.borderRadiusLG,
              padding: '10px 12px',
            }}
          >
            <div style={{ fontSize: 12, color: token.colorTextSecondary }}>{t(settle.heroLabel)}</div>
            {/* R17 — «hero» summa nowrap: telefonda shrift viewportga qarab kichrayadi,
                992px da clamp yuqori chegarasi (20px) — desktop o'zgarmaydi. */}
            <MoneyCell
              value={base ?? 0}
              variant="neutral"
              strong
              suffix={t("so'm")}
              style={{ fontSize: 'clamp(16px, 5.2vw, 20px)', lineHeight: 1.3 }}
            />
          </div>
        ) : null}
      </div>
    );
  };

  // the 4 live channels: naqd, click, terminal, bank
  const methodOptions = ENTRY_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD[m].label }));

  // Zavod to'lovi IKKI narsani hal qiladi, va ikkinchisi yangi (R2/R3): usul
  // taqsimlangan bo'lakning narx asosini belgilaydi, TAQSIMLANMAGAN qoldiq esa
  // o'sha kanalda turgan avansga aylanadi. Avans hech qachon o'z-o'zidan
  // buyurtma yopmaydi — u buyurtma kartasidagi «Avansdan yechish» bosilgandagina
  // ishlatiladi, shuning uchun eski «taqsimlanganda qotiriladi» satri yarim
  // haqiqat edi: pul ketdi, lekin qarz joyida turibdi deb hech kim aytmasdi.
  const factoryConsequence =
    kind === 'FACTORY_OUT'
      ? kassaMethod
        ? t(
            "Naqd / Click — taqsimlangan bo'lak tannarxi ZAVOD NAQD narxida qotiriladi. Taqsimlanmagan qoldiq zavodda NAQD AVANS bo'lib turadi: u hech qaysi buyurtmani yopmaydi, buyurtma kartasidan «Avansdan yechish» bosilishi kerak.",
          )
        : t(
            "Terminal / Bank — taqsimlangan bo'lak tannarxi ZAVOD O'TKAZMA (rasmiy) narxida qotiriladi. Taqsimlanmagan qoldiq zavodda O'TKAZMA AVANS bo'lib turadi: u hech qaysi buyurtmani yopmaydi, buyurtma kartasidan «Avansdan yechish» bosilishi kerak.",
          )
      : null;

  // quick-fill reads the LIVE settlement base (works even without a preset), plus
  // the preset-only «Muddati o'tgani» overdue slice when a debt row supplied it
  const overdue = num(presetParty?.overdueTotal);
  const showQuickChips = usesSom && ((base != null && base > 0) || overdue > 0);

  // ─────────────────────────── content ───────────────────────────

  // AGENT degraded state (06-decisions D2) — no working cash composer.
  const agentBlocked = isAgent;

  const body = agentBlocked ? (
    <EmptyState
      message="To'lovni kassir yoki buxgalter rasmiylashtiradi. Agent qarzdorlikni ko'radi va yig'ishga chiqaradi, lekin kassa orqali to'lovni ular kiritadi."
    />
  ) : success ? (
    <Flex vertical gap={16} style={{ paddingTop: 8 }}>
      <Flex vertical align="center" gap={8} style={{ textAlign: 'center' }}>
        <CheckCircleFilled style={{ fontSize: 32, color: token.colorSuccess }} />
        <Typography.Title level={5} style={{ margin: 0 }}>
          {t("To'lov saqlandi")}
        </Typography.Title>
        <Typography.Text className="num" style={{ fontSize: 18, fontWeight: 600 }}>
          {fmtMoney(success.amount)} {t("so'm")}
        </Typography.Text>
      </Flex>

      {/* TRANSPORT_DIRECT hech qaysi balansni qimirlatmaydi — «Yangi balans» ko'rsatish
          o'zgarmagan raqamni o'zgargandek o'qitardi. */}
      {kind === 'TRANSPORT_DIRECT' ? (
        <Flex
          gap={8}
          style={{
            padding: '10px 12px',
            borderRadius: token.borderRadiusLG,
            background: token.colorFillTertiary,
          }}
        >
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            {t('Balanslar o\'zgarmadi — transport holati yangilandi.')}
          </Typography.Text>
        </Flex>
      ) : (
      <Flex
        align="center"
        justify="space-between"
        gap={8}
        style={{
          padding: '10px 12px',
          borderRadius: token.borderRadiusLG,
          background: token.colorFillTertiary,
        }}
      >
        <Typography.Text type="secondary">{t('Yangi balans')}</Typography.Text>
        {balanceAfterQ.isLoading ? (
          <Spin size="small" />
        ) : balanceAfterQ.data != null ? (
          <BalanceTag balance={String(balanceAfterQ.data)} partyType={deltaType} pallets={deltaType === 'client' ? presetParty?.palletBalance : undefined} />
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        )}
      </Flex>
      )}
    </Flex>
  ) : (
    <div
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          // factory-settle: Ctrl+Enter must open the order picker, NOT save a bare advance
          if (isFactorySettle) {
            if (canSubmit) {
              setServerError(null);
              setFactoryPickerOpen(true);
            }
          } else {
            submit();
          }
        }
      }}
    >
      <Flex vertical gap={16}>
        {/* 0) bog'langan buyurtma — TRANSPORT_DIRECT faqat shu yo'l bilan kiritiladi */}
        {presetOrder ? (
          <div>
            {label('Buyurtma')}
            <Flex
              align="center"
              gap={8}
              style={{
                padding: '6px 10px',
                border: `1px solid ${token.colorBorderSecondary}`,
                borderRadius: token.borderRadius,
                background: token.colorFillTertiary,
              }}
            >
              <Typography.Text strong ellipsis style={{ minWidth: 0 }}>
                {presetOrder.orderNo ?? presetOrder.id}
              </Typography.Text>
            </Flex>
          </div>
        ) : null}

        {/* 1) tomon(lar) + asosiy tomon uchun qarz «hero» */}
        {desc.parties.map(renderParty)}

        {/* 2) usul — naqd / click / terminal / bank */}
        <div>
          {label('Usul')}
          {/* telefonda `block` emas — 4 ta yorliq («Terminal») 320px da kesilmasin;
              sig'masa .sb-scroll-x gorizontal suradi */}
          <div className={isPhone ? 'sb-scroll-x' : undefined}>
            <Segmented
              block={!isPhone}
              options={methodOptions}
              value={state.method}
              onChange={(v) => {
                const m = v as PaymentMethod;
                setMethodTouched(true);
                // leaving naqd forces UZS; the box family also changes → clear both boxes
                patch({
                  method: m,
                  currencyMode: m === 'CASH' ? state.currencyMode : 'UZS',
                  cashboxId: undefined,
                  usdCashboxId: undefined,
                });
              }}
            />
          </div>
          {factoryConsequence ? (
            <Typography.Text type="warning" style={{ fontSize: 12, display: 'block', marginTop: 6 }}>
              {factoryConsequence}
            </Typography.Text>
          ) : null}
        </div>

        {/* 2b) valyuta rejimi — faqat naqd (so'm / dollar / so'm+dollar) */}
        {state.method === 'CASH' && desc.cashbox ? (
          <div>
            {label('Valyuta')}
            {/* «So'm + dollar» block rejimida 320px da sig'maydi — telefonda tabiiy
                kenglik + .sb-scroll-x */}
            <div className={isPhone ? 'sb-scroll-x' : undefined}>
              <Segmented
                block={!isPhone}
                options={[
                  { value: 'UZS', label: t("So'm") },
                  { value: 'USD', label: t('Dollar') },
                  { value: 'BOTH', label: t("So'm + dollar") },
                ]}
                value={state.currencyMode}
                onChange={(v) => patch({ currencyMode: v as CurrencyMode })}
              />
            </div>
          </div>
        ) : null}

        {/* 3) summa (rejimga qarab: so'm / dollar / ikkalasi) + tez to'ldirish */}
        <div>
          {label(usesSom && usesUsd ? "So'm summasi" : usesUsd ? 'Dollar summasi' : 'Summa')}
          {usesSom ? <MoneyInput value={state.amount} onChange={(v) => patch({ amount: v })} /> : null}
          {usesUsd ? (
            <div style={{ marginTop: usesSom ? 12 : 0 }}>
              {usesSom ? label('Dollar summasi') : null}
              <MoneyInput
                usd
                usdAmount={state.usdAmount}
                rate={state.rate}
                onUsdChange={({ usdAmount, rate }) => patch({ usdAmount, rate })}
              />
            </div>
          ) : null}
          {usesSom && usesUsd ? (
            <Flex justify="space-between" align="center" style={{ marginTop: 8 }}>
              <Typography.Text type="secondary" style={{ fontSize: 13 }}>{t("Jami (so'mda)")}</Typography.Text>
              <MoneyCell value={totalUZS} variant="neutral" strong />
            </Flex>
          ) : null}
          {/* tez to'ldirish chiplari — telefonda to'liq kenglikdagi barmoq nishoni
              (uzun «To'liq qarz (123 456 789)» yorlig'i hech qachon kesilmaydi) */}
          {showQuickChips ? (
            <Flex gap={8} wrap style={{ marginTop: 8 }}>
              {base != null && base > 0 ? (
                <Button size="small" block={isPhone} onClick={() => patch({ amount: digits(base) })}>
                  {t(settle.fillLabel)} ({fmtMoney(base)})
                </Button>
              ) : null}
              {overdue > 0 ? (
                <Button size="small" block={isPhone} onClick={() => patch({ amount: digits(presetParty?.overdueTotal) })}>
                  {t("Muddati o'tgani")} ({fmtMoney(presetParty?.overdueTotal)})
                </Button>
              ) : null}
            </Flex>
          ) : null}
        </div>

        {/* 4) kassa(lar): so'm kassasi (usul oilasiga qarab) + aralashda valyuta kassasi */}
        {desc.cashbox ? (
          <>
            {usesSom ? (
              <div>
                {label(usesUsd ? "So'm kassasi" : 'Kassa')}
                <CashboxSelect
                  value={state.cashboxId}
                  currency="UZS"
                  types={kassaMethod ? [...KASSA_BOX_TYPES] : [...BANK_BOX_TYPES]}
                  onChange={(id) => patch({ cashboxId: id })}
                />
              </div>
            ) : null}
            {usesUsd ? (
              <div>
                {label('Valyuta (dollar) kassasi')}
                <CashboxSelect
                  value={state.usdCashboxId}
                  currency="USD"
                  types={[...KASSA_BOX_TYPES]}
                  onChange={(id) => patch({ usdCashboxId: id })}
                />
              </div>
            ) : null}
          </>
        ) : (
          <Typography.Text
            type="secondary"
            style={{
              fontSize: 13,
              padding: '8px 12px',
              borderRadius: token.borderRadius,
              background: token.colorFillTertiary,
              display: 'block',
            }}
          >
            {t("Bu to'lov kassadan o'tmaydi va balanslarni o'zgartirmaydi — transport ulushi buyurtma yaratilgandayoq mijoz qarzidan chiqarilgan. Bu yozuv shofyor pulini olganini tasdiqlaydi va transport holatini yopadi.")}
          </Typography.Text>
        )}

        {/* 5) jonli hisob-kitob: qarz − to'lov = qoldiq / avansga */}
        {settle.family !== 'none' && base != null && totalUZS > 0 ? (
          <div
            style={{
              background: token.colorFillTertiary,
              borderRadius: token.borderRadiusLG,
              padding: '10px 12px',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <Flex justify="space-between" align="center" gap={8}>
              <Typography.Text type="secondary" style={{ fontSize: 13 }}>{t(settle.heroLabel)}</Typography.Text>
              <MoneyCell value={base} variant="neutral" />
            </Flex>
            <Flex justify="space-between" align="center" gap={8}>
              <Typography.Text type="secondary" style={{ fontSize: 13 }}>{t("To'lov (so'mda)")}</Typography.Text>
              <MoneyCell value={totalUZS} variant="neutral" strong />
            </Flex>
            <div style={{ height: 1, background: token.colorBorderSecondary, margin: '2px 0' }} />
            <Flex justify="space-between" align="center" gap={8}>
              {totalUZS <= base ? (
                <>
                  <Typography.Text style={{ fontSize: 13, fontWeight: 500 }}>{t(settle.afterLabel)}</Typography.Text>
                  <MoneyCell value={base - totalUZS} variant="neutral" strong />
                </>
              ) : (
                <>
                  <Typography.Text style={{ fontSize: 13, fontWeight: 500, color: token.colorWarning }}>
                    {t(settle.overLabel)}
                  </Typography.Text>
                  <span style={{ color: token.colorWarning }}>
                    <MoneyCell value={totalUZS - base} variant="neutral" strong />
                  </span>
                </>
              )}
            </Flex>
          </div>
        ) : null}

        {/* 6) to'lovchi / qabul qiluvchi (ixtiyoriy) */}
        {desc.legalSlot ? (
          <div>
            {label(desc.legalLabel ?? '')}
            <Input
              maxLength={300}
              placeholder={t("Firma / shaxs nomi (ixtiyoriy)")}
              value={desc.legalSlot === 'payer' ? state.payerName ?? '' : state.receiverName ?? ''}
              onChange={(e) =>
                patch(desc.legalSlot === 'payer' ? { payerName: e.target.value } : { receiverName: e.target.value })
              }
            />
          </div>
        ) : null}

        {/* 7) sana */}
        <div>
          {label('Sana')}
          <DatePicker
            value={state.date ? dayjs(state.date) : null}
            format="DD.MM.YYYY"
            allowClear={false}
            // telefonda klaviatura kalendar panelini yopib qo'yadi — faqat panel
            // orqali tanlanadi (qiymat parsingi o'zgarmaydi)
            inputReadOnly={isPhone}
            style={{ width: '100%' }}
            onChange={(d) => patch({ date: (d ?? dayjs()).format('YYYY-MM-DD') })}
          />
        </div>

        {/* 8) izoh */}
        <div>
          {label('Izoh')}
          <Input.TextArea
            rows={2}
            maxLength={1000}
            value={state.note ?? ''}
            placeholder={t("Izoh (ixtiyoriy)")}
            onChange={(e) => patch({ note: e.target.value })}
          />
        </div>

        {serverError ? (
          <Typography.Text type="danger" style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>
            {apiError(serverError)}
          </Typography.Text>
        ) : null}
      </Flex>
    </div>
  );

  // ─────────────────────────── footer ───────────────────────────

  let footer: ReactNode = null;
  if (agentBlocked) {
    footer = (
      <Button block onClick={onClose}>
        {t('Yopish')}
      </Button>
    );
  } else if (success) {
    const remainder = num(success.amount);
    footer = (
      <Flex vertical gap={8}>
        {/* telefonda ikkinchi darajali amallar ustma-ust va to'liq kenglikda —
            «Kvitansiya chop etish» yorlig'i 320px da yonma-yon sig'maydi */}
        <Flex gap={8} vertical={isPhone}>
          {kind !== 'TRANSPORT_DIRECT' ? (
            <Button
              icon={<PrinterOutlined />}
              block={isPhone}
              onClick={() => navigate(`/print/receipt/${success.id}`)}
            >
              {t('Kvitansiya chop etish')}
            </Button>
          ) : null}
          {canAllocate && desc.allocatable && remainder > 0 ? (
            <Button block={isPhone} onClick={requestSettle}>
              {t('Taqsimlash')}
            </Button>
          ) : null}
        </Flex>
        <Button type="primary" block onClick={resetForAnother}>
          {t("Yana to'lov")}
        </Button>
      </Flex>
    );
  } else {
    const primaryLabel = createM.isPending
      ? t(desc.progress)
      : totalUZS > 0
        ? `${t(desc.verb)} — ${fmtMoney(totalUZS)} ${t("so'm")}`
        : t(desc.verb);
    footer = isFactorySettle ? (
      // Zavodga to'lov: asosiy amal — buyurtmalarni tanlab to'g'ridan-to'g'ri yopish.
      <Flex vertical gap={8}>
        <Button
          type="primary"
          block
          disabled={!canSubmit}
          loading={createM.isPending}
          onClick={() => {
            if (!canSubmit) return;
            setServerError(null);
            setFactoryPickerOpen(true);
          }}
          style={isPhone ? { whiteSpace: 'normal', height: 'auto', minHeight: TOUCH_MIN, paddingBlock: 8 } : undefined}
        >
          {totalUZS > 0
            ? `${t("Buyurtmani tanlab to'lash")} — ${fmtMoney(totalUZS)} ${t("so'm")}`
            : t("Buyurtmani tanlab to'lash")}
        </Button>
        <Button type="link" block disabled={!canSubmit} loading={createM.isPending} onClick={submitAsAdvance}>
          {t('Avans sifatida saqlash')}
        </Button>
        <Typography.Text type="secondary" style={{ fontSize: 12, textAlign: 'center' }}>
          {t("Buyurtma tanlansa — o'sha buyurtma to'g'ridan-to'g'ri yopiladi; aks holda pul zavod avansiga tushadi.")}
        </Typography.Text>
      </Flex>
    ) : (
      <Flex vertical gap={10}>
        {desc.allocatable ? (
          isCashier ? (
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>
              {t('Taqsimlashni buxgalter bajaradi')}
            </Typography.Text>
          ) : canAllocate ? (
            <Checkbox
              checked={state.saveAndAllocate}
              onChange={(e) => patch({ saveAndAllocate: e.target.checked })}
              // §4 — telefonda barmoq nishoni 44px dan past bo'lmasin
              style={isPhone ? { minHeight: TOUCH_MIN, alignItems: 'center' } : undefined}
            >
              {t('Saqlash va taqsimlash')}
            </Checkbox>
          ) : null
        ) : null}
        <Button
          type="primary"
          block
          disabled={!canSubmit}
          loading={createM.isPending}
          onClick={submit}
          // «Qabul qilish — 123 456 789 so'm» 320px da bir qatorga sig'masligi
          // mumkin; .ant-btn nowrap bo'lgani uchun telefonda o'ralishga ruxsat
          style={isPhone ? { whiteSpace: 'normal', height: 'auto', minHeight: TOUCH_MIN, paddingBlock: 8 } : undefined}
        >
          {primaryLabel}
        </Button>
        {/* R19 — klaviatura yorlig'i telefonda ko'rsatilmaydi */}
        {!isPhone ? (
          <Typography.Text type="secondary" style={{ fontSize: 12, textAlign: 'center' }}>
            {t('Ctrl+Enter — saqlash')}
          </Typography.Text>
        ) : null}
      </Flex>
    );
  }

  return (
    <>
      <Drawer
        open={open}
        onClose={requestClose}
        title={t(desc.title)}
        // §2.3 — telefonda pastki varaq: 100vw ga qisilgan o'ng drawer'da niqob
        // ko'rinmaydi va «chiqish yo'li yo'q sahifa» kabi o'qiladi.
        placement={isPhone ? 'bottom' : 'right'}
        className={isPhone ? 'sb-form-drawer sb-form-drawer--sheet' : undefined}
        maskClosable={!createM.isPending}
        keyboard={!createM.isPending}
        destroyOnHidden
        footer={footer}
        // antd v6 da raqamli width/height eskirgan — geometriya `wrapper` slotida.
        styles={{
          wrapper: isPhone ? { width: '100%', height: '92dvh' } : { width: drawerWidth(560) },
          body: isPhone ? { padding: '14px 12px' } : undefined,
          footer: { padding: isPhone ? '12px 12px calc(12px + var(--sb-safe-b))' : 16 },
        }}
      >
        {open ? body : null}
      </Drawer>

      {/* allocation workbench over the committed payment (04 §3.2, hero §A) */}
      <SettleDrawer
        paymentId={success?.id}
        open={settleOpen && !!success}
        onClose={() => setSettleOpen(false)}
      />

      {/* zavodga to'lov: to'lov PAYTIDA buyurtmalarni tanlash (inline — bitta chaqiruvda
          to'lov yaratiladi va tanlangan buyurtmalar to'g'ridan-to'g'ri yopiladi). */}
      {isFactorySettle && syntheticFactoryPayment ? (
        <SettleDrawer
          payment={syntheticFactoryPayment}
          open={factoryPickerOpen}
          onClose={() => setFactoryPickerOpen(false)}
          onSubmit={submitFactoryAllocations}
          submitting={createM.isPending}
          error={serverError}
        />
      ) : null}
    </>
  );
}
