// /kassa — Kassa (treasury). money.md §6: ONE DateRangeControl governs the whole
// page (feeds GET /kassa/summary AND /kassa/transactions); cashbox cards act as
// scoping filters (?cashboxId=, selected ring, live all-time balance, per-currency
// grand totals never merged); a server-truth period summary (opening/in/out/closing);
// the journal DataTable with source-document links (payment→peek, expense→register,
// bonus→/bonus) and chained reversal rows; manual op modal (strict Kirim|Chiqim, no
// preselection); storno via ReasonModal on MANUAL rows only. OUT renders in colorText
// (spending is not an error, 02 §2.4). Roles A/B/K; AGENT is blocked at the route.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  App,
  Button,
  DatePicker,
  Dropdown,
  Flex,
  Input,
  Segmented,
  Select,
  Skeleton,
  Tag,
  Tooltip,
  theme,
} from 'antd';
import {
  BankOutlined,
  CreditCardOutlined,
  EditOutlined,
  FileSearchOutlined,
  MobileOutlined,
  MoreOutlined,
  PlusOutlined,
  PrinterOutlined,
  SwapOutlined,
  UndoOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs, { type Dayjs } from 'dayjs';
import { apiError, endpoints } from '../lib/api';
import { fmtDateTime, fmtMoney, num } from '../lib/format';
import {
  CASH_DIRECTION,
  CASH_SOURCE,
  CURRENCY,
  PAYMENT_KIND,
  type CashSource,
} from '../lib/status-maps';
import { useUrlFilters } from '../lib/useUrlFilters';
import { useIsDesktop, useIsPhone } from '../lib/responsive';
import { can } from '../lib/permissions';
import { useAuth } from '../auth/AuthContext';
import { useT } from '../components/LangContext';
import { interpolate, translate } from '../lib/i18n';
import {
  CashboxSelect,
  DataTable,
  DateRangeControl,
  ErrorState,
  FormDrawer,
  KbdHint,
  MoneyCell,
  MoneyInput,
  PageHeader,
  PaymentPeek,
  ReasonModal,
  StatusChip,
  TableCard,
  type SbColumn,
} from '../components';
import type { ImpactFact } from '../components/LedgerImpactPreview';
import type { CashDirection, Cashbox, CashTransaction, KassaSummary, Paged, PaymentKind } from '../lib/types';

const FMT = 'YYYY-MM-DD';

/** Kassa page (naqd + click) vs Bank page (terminal + bank). */
export type CashboxScope = 'cash' | 'bank';
/** Bank page = {TERMINAL, BANK}; Kassa page = the rest (CASH, CLICK, CARD…). */
const BANK_TYPES: Cashbox['type'][] = ['TERMINAL', 'BANK'];
const inScope = (type: Cashbox['type'], scope: CashboxScope): boolean =>
  scope === 'bank' ? BANK_TYPES.includes(type) : !BANK_TYPES.includes(type);

/** creatable cashbox types per page (CARD retired from entry; existing CARD boxes still show). */
const CREATE_TYPE_OPTS: Record<CashboxScope, { value: Cashbox['type']; label: string }[]> = {
  cash: [
    { value: 'CASH', label: 'Naqd kassa' },
    { value: 'CLICK', label: 'Click' },
  ],
  bank: [
    { value: 'TERMINAL', label: 'Terminal' },
    { value: 'BANK', label: 'Bank hisob' },
  ],
};

const BOX_ICON: Record<Cashbox['type'], ReactNode> = {
  CASH: <WalletOutlined />,
  BANK: <BankOutlined />,
  CLICK: <MobileOutlined />,
  TERMINAL: <CreditCardOutlined />,
  CARD: <CreditCardOutlined />,
};

/** GET /kassa/transactions row: the shared CashTransaction + embedded source docs. */
interface KassaTxRow extends CashTransaction {
  payment?: {
    id: string;
    kind: PaymentKind;
    method: string;
    amount: string;
    date: string;
    voidedAt?: string | null;
    client?: { id: string; name: string } | null;
    factory?: { id: string; name: string } | null;
    vehicle?: { id: string; name: string } | null;
  } | null;
  expense?: {
    id: string;
    amount: string;
    date: string;
    note?: string | null;
    voidedAt?: string | null;
    category?: { id: string; name: string } | null;
  } | null;
  bonusTransaction?: {
    id: string;
    type: string;
    amount: string;
    factory?: { id: string; name: string } | null;
  } | null;
  reversalOf?: { id: string; direction: CashDirection; amount: string; source: string; date: string } | null;
  reversedBy?: { id: string; date: string; note?: string | null } | null;
  createdBy?: { id: string; name: string } | null;
}

const currencySuffix = (c: 'UZS' | 'USD'): string => (c === 'USD' ? '$' : translate("so'm"));

// ── cashbox card (scoping filter) ─────────────────────────────────────────────
function CashboxCard({
  box,
  selected,
  index,
  onToggle,
  onEdit,
}: {
  box: Cashbox;
  selected: boolean;
  index: number;
  onToggle: () => void;
  onEdit?: () => void;
}) {
  const { token } = theme.useToken();
  const t = useT();
  // telefonda karta bir ustunda to'liq kenglikda — 200px poli 320px ekranni yorib
  // chiqmasin, ichidagi qoldiq esa kichikroq shriftda sig'sin.
  const isPhone = useIsPhone();
  const inactive = box.active === false;
  return (
    <div
      style={{
        position: 'relative',
        flex: isPhone ? '1 1 100%' : '1 1 200px',
        minWidth: isPhone ? 0 : 200,
        display: 'flex',
      }}
    >
      {onEdit ? (
        <Tooltip title={t('Tahrirlash')}>
          <Button
            type="text"
            size="small"
            aria-label={t('{name} — tahrirlash', { name: box.name })}
            icon={<EditOutlined />}
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            style={{ position: 'absolute', top: 6, right: 6, zIndex: 2, color: token.colorTextTertiary }}
          />
        </Tooltip>
      ) : null}
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={selected}
        className="dash-card dash-card--interactive dash-pressable"
        style={{
          appearance: 'none',
          textAlign: 'left',
          cursor: 'pointer',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          width: '100%',
          minWidth: 0,
          padding: isPhone ? 14 : 16,
          border: `1px solid ${selected ? token.colorPrimary : token.colorBorderSecondary}`,
          outline: selected ? `1px solid ${token.colorPrimary}` : 'none',
          outlineOffset: -1,
          background: selected
            ? token.colorPrimaryBg
            : inactive
              ? token.colorFillQuaternary
              : token.colorBgContainer,
          opacity: inactive && !selected ? 0.72 : 1,
        }}
      >
      {/* telefonda tahrirlash tugmasi 44×44 ga o'sadi — nomga shuncha joy qoldiramiz */}
      <Flex align="center" gap={8} style={{ minWidth: 0, paddingRight: onEdit ? (isPhone ? 46 : 22) : 0 }}>
        <span
          aria-hidden
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 28,
            height: 28,
            flex: '0 0 auto',
            borderRadius: 8,
            fontSize: 15,
            background: selected ? token.colorPrimaryBgHover : token.colorFillTertiary,
            color: selected ? token.colorPrimary : token.colorTextSecondary,
          }}
        >
          {BOX_ICON[box.type]}
        </span>
        <span
          style={{
            fontWeight: 600,
            color: token.colorText,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: '1 1 auto',
            minWidth: 0,
          }}
        >
          {box.name}
        </span>
        {index < 9 && !isPhone ? <KbdHint>{index + 1}</KbdHint> : null}
      </Flex>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <MoneyCell
          value={box.balance}
          variant="neutral"
          strong
          suffix={currencySuffix(box.currency)}
          style={{ fontSize: isPhone ? 18 : 20, lineHeight: isPhone ? '24px' : '26px' }}
        />
        <Tag bordered={false} style={{ marginInlineEnd: 0 }}>
          {CURRENCY[box.currency].label}
        </Tag>
        {inactive ? (
          <Tag bordered={false} color="default">
            {t('Nofaol')}
          </Tag>
        ) : null}
      </div>
      </button>
    </div>
  );
}

// ── manual op modal (§6.4) ────────────────────────────────────────────────────
function ManualCashModal({ open, onClose, onSaved, scope }: { open: boolean; onClose: () => void; onSaved: () => void; scope: CashboxScope }) {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const t = useT();
  // R15: telefonda autoFocus iOS klaviaturasini ochib, footer tugmalarini yopadi
  const isPhone = useIsPhone();
  const [cashboxId, setCashboxId] = useState<string | undefined>();
  const [box, setBox] = useState<Cashbox | undefined>();
  const [direction, setDirection] = useState<CashDirection | undefined>();
  const [amount, setAmount] = useState<string>('');
  const [date, setDate] = useState<Dayjs>(dayjs());
  const [note, setNote] = useState('');

  useEffect(() => {
    if (open) {
      setCashboxId(undefined);
      setBox(undefined);
      setDirection(undefined);
      setAmount('');
      setDate(dayjs());
      setNote('');
    }
  }, [open]);

  const mut = useMutation({
    mutationFn: (d: object) => endpoints.kassaManual(d),
    onSuccess: () => {
      message.success(t('Kassa yozuvi saqlandi'));
      onSaved();
      onClose();
    },
    onError: (e) => message.error(apiError(e)),
  });

  const valid = !!cashboxId && !!direction && num(amount) >= 1;

  const submit = () => {
    if (!valid) return;
    mut.mutate({
      cashboxId,
      direction,
      amount,
      date: date.format(FMT),
      note: note.trim() ? note.trim() : undefined,
    });
  };

  const curr = box ? currencySuffix(box.currency) : translate("so'm");

  return (
    <FormDrawer
      title={t("Qo'lda kirim/chiqim")}
      open={open}
      onClose={onClose}
      onSubmit={submit}
      submitting={mut.isPending}
      submitText="Saqlash"
      cancelText="Orqaga"
      disabled={!valid}
    >
      <div style={{ display: 'grid', gap: 14 }}>
        <Field label={scope === 'bank' ? 'Bank hisob' : 'Kassa'}>
          <CashboxSelect
            autoFocus={!isPhone}
            scope={scope}
            value={cashboxId}
            onChange={(v, c) => {
              setCashboxId(v);
              setBox(c);
            }}
          />
        </Field>

        <Field label="Yo'nalish">
          <Segmented<string>
            block
            value={direction ?? ''}
            onChange={(v) => setDirection(v ? (v as CashDirection) : undefined)}
            options={[
              { label: t('Kirim'), value: 'IN' },
              { label: t('Chiqim'), value: 'OUT' },
            ]}
          />
          {!direction ? (
            <div style={{ fontSize: 12, color: token.colorTextTertiary, marginTop: 4 }}>
              {t("Yo'nalishni tanlang")}
            </div>
          ) : null}
        </Field>

        <Field label="Summa">
          <MoneyInput
            value={amount}
            onChange={setAmount}
            min={1}
            max={direction === 'OUT' ? box?.balance ?? undefined : undefined}
            maxLabel={box ? t('Kassada: {amount} {curr}', { amount: fmtMoney(box.balance), curr }) : undefined}
          />
        </Field>

        <Field label="Sana">
          <DatePicker
            style={{ width: '100%' }}
            format="DD.MM.YYYY"
            allowClear={false}
            value={date}
            onChange={(v) => v && setDate(v)}
          />
        </Field>

        <Field label="Izoh">
          <Input.TextArea
            rows={2}
            maxLength={1000}
            placeholder={t('Izoh (ixtiyoriy)')}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
      </div>
    </FormDrawer>
  );
}

// ── transfer modal (box → box / box → bank; source never below zero) ─────────
function TransferModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const t = useT();
  const isPhone = useIsPhone(); // R15
  const [fromId, setFromId] = useState<string | undefined>();
  const [fromBox, setFromBox] = useState<Cashbox | undefined>();
  const [toId, setToId] = useState<string | undefined>();
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState<Dayjs>(dayjs());
  const [note, setNote] = useState('');

  useEffect(() => {
    if (open) {
      setFromId(undefined);
      setFromBox(undefined);
      setToId(undefined);
      setAmount('');
      setDate(dayjs());
      setNote('');
    }
  }, [open]);

  const mut = useMutation({
    mutationFn: (d: { fromCashboxId: string; toCashboxId: string; amount: string; date: string; note?: string }) =>
      endpoints.kassaTransfer(d),
    onSuccess: () => {
      message.success(t("O'tkazma bajarildi"));
      onSaved();
      onClose();
    },
    onError: (e) => message.error(apiError(e)),
  });

  const curr = fromBox ? currencySuffix(fromBox.currency) : translate("so'm");
  const sameBox = !!fromId && !!toId && fromId === toId;
  const overBalance = !!fromBox && num(amount) > num(fromBox.balance ?? 0);
  const valid = !!fromId && !!toId && !sameBox && num(amount) >= 1 && !overBalance;

  const submit = () => {
    if (!valid || !fromId || !toId) return;
    mut.mutate({ fromCashboxId: fromId, toCashboxId: toId, amount, date: date.format(FMT), note: note.trim() || undefined });
  };

  return (
    <FormDrawer
      title={t("Kassalar o'rtasida o'tkazma")}
      open={open}
      onClose={onClose}
      onSubmit={submit}
      submitting={mut.isPending}
      submitText="O'tkazish"
      cancelText="Orqaga"
      disabled={!valid}
    >
      <div style={{ display: 'grid', gap: 14 }}>
        <Field label="Qayerdan">
          <CashboxSelect
            autoFocus={!isPhone}
            value={fromId}
            onChange={(v, c) => {
              setFromId(v);
              setFromBox(c);
              // switching the source to a different currency invalidates the target
              if (c && toId) setToId(undefined);
            }}
          />
          {fromBox ? (
            <div style={{ fontSize: 12, color: token.colorTextTertiary, marginTop: 4 }}>
              {t('Qoldiq: {a} {c}', { a: fmtMoney(fromBox.balance ?? 0), c: curr })}
            </div>
          ) : null}
        </Field>

        <Field label="Qayerga">
          <CashboxSelect
            value={toId}
            currency={fromBox?.currency}
            disabled={!fromBox}
            onChange={(v) => setToId(v)}
          />
          {sameBox ? (
            <div style={{ fontSize: 12, color: token.colorError, marginTop: 4 }}>{t('Boshqa kassani tanlang')}</div>
          ) : null}
        </Field>

        <Field label="Summa">
          <MoneyInput
            value={amount}
            onChange={setAmount}
            min={1}
            max={fromBox?.balance ?? undefined}
            maxLabel={fromBox ? t('Kassada: {amount} {curr}', { amount: fmtMoney(fromBox.balance ?? 0), curr }) : undefined}
          />
        </Field>

        <Field label="Sana">
          <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" allowClear={false} value={date} onChange={(v) => v && setDate(v)} />
        </Field>

        <Field label="Izoh">
          <Input.TextArea rows={2} maxLength={1000} placeholder={t('Izoh (ixtiyoriy)')} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </FormDrawer>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  const { token } = theme.useToken();
  const t = useT();
  return (
    <label style={{ display: 'block' }}>
      <div style={{ fontSize: 13, color: token.colorTextSecondary, marginBottom: 6 }}>{t(label)}</div>
      {children}
    </label>
  );
}

// ── cashbox / bank account create + edit drawer ───────────────────────────────
function CashboxFormDrawer({
  open,
  onClose,
  onSaved,
  scope,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  scope: CashboxScope;
  editing: Cashbox | null;
}) {
  const { message } = App.useApp();
  const t = useT();
  const isPhone = useIsPhone(); // R15
  const isBank = scope === 'bank';
  const [name, setName] = useState('');
  const [type, setType] = useState<Cashbox['type']>(isBank ? 'BANK' : 'CASH');
  const [currency, setCurrency] = useState<'UZS' | 'USD'>('UZS');
  const [active, setActive] = useState(true);

  useEffect(() => {
    if (open) {
      setName(editing?.name ?? '');
      setType(editing?.type ?? (isBank ? 'BANK' : 'CASH'));
      setCurrency((editing?.currency as 'UZS' | 'USD') ?? 'UZS');
      setActive(editing?.active ?? true);
    }
  }, [open, editing, isBank]);

  const createM = useMutation({
    mutationFn: (d: { name: string; type: string; currency: string }) => endpoints.createCashbox(d),
    onSuccess: () => {
      message.success(isBank ? t("Bank hisob qo'shildi") : t("Kassa qo'shildi"));
      onSaved();
      onClose();
    },
    onError: (e) => message.error(apiError(e)),
  });
  const updateM = useMutation({
    mutationFn: (d: { name?: string; active?: boolean }) => endpoints.updateCashbox(editing!.id, d),
    onSuccess: () => {
      message.success(t('Saqlandi'));
      onSaved();
      onClose();
    },
    onError: (e) => message.error(apiError(e)),
  });

  const valid = name.trim().length > 0;
  const submit = () => {
    if (!valid) return;
    if (editing) updateM.mutate({ name: name.trim(), active });
    else createM.mutate({ name: name.trim(), type, currency });
  };

  const title = editing
    ? isBank
      ? t('Bank hisobni tahrirlash')
      : t('Kassani tahrirlash')
    : isBank
      ? t('Yangi bank hisob')
      : t('Yangi kassa');

  return (
    <FormDrawer
      title={title}
      open={open}
      onClose={onClose}
      onSubmit={submit}
      submitting={createM.isPending || updateM.isPending}
      submitText="Saqlash"
      cancelText="Orqaga"
      disabled={!valid}
    >
      <div style={{ display: 'grid', gap: 14 }}>
        <Field label="Nomi">
          <Input
            autoFocus={!isPhone}
            value={name}
            maxLength={120}
            placeholder={isBank ? t('Masalan: Kapital Bank') : t('Masalan: Asosiy kassa')}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>

        {!editing ? (
          <Field label="Turi">
            <Segmented<string>
              block
              value={type}
              onChange={(v) => setType(v as Cashbox['type'])}
              options={CREATE_TYPE_OPTS[scope].map((o) => ({ label: t(o.label), value: o.value }))}
            />
          </Field>
        ) : null}

        {!editing ? (
          <Field label="Valyuta">
            <Segmented<string>
              block
              value={currency}
              onChange={(v) => setCurrency(v as 'UZS' | 'USD')}
              options={[
                { label: t("So'm (UZS)"), value: 'UZS' },
                { label: t('Dollar (USD)'), value: 'USD' },
              ]}
            />
          </Field>
        ) : (
          <Field label="Holati">
            <Segmented<string>
              block
              value={active ? 'active' : 'inactive'}
              onChange={(v) => setActive(v === 'active')}
              options={[
                { label: t('Faol'), value: 'active' },
                { label: t('Nofaol'), value: 'inactive' },
              ]}
            />
          </Field>
        )}
      </div>
    </FormDrawer>
  );
}

// ── page ──────────────────────────────────────────────────────────────────────
export function KassaView({ scope }: { scope: CashboxScope }) {
  const { token } = theme.useToken();
  const t = useT();
  // mobil: gero blok va kassa kartalari bir ustunga tushadi, jurnal esa defter
  // bo'lgani uchun jadval bo'lib qoladi (spec §2.2) — faqat gorizontal skroll.
  const isPhone = useIsPhone();
  const isDesktop = useIsDesktop();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const role = user?.role ?? null;
  const isBank = scope === 'bank';
  const canManual = can(role, 'kassa.manual');
  const canStorno = can(role, 'kassa.storno');
  const canManageBox = role === 'ADMIN' || role === 'ACCOUNTANT';
  const [boxForm, setBoxForm] = useState<{ open: boolean; editing: Cashbox | null }>({ open: false, editing: null });

  const uf = useUrlFilters();
  const cashboxId = uf.get('cashboxId') || undefined;
  const source = uf.get('source') || undefined;
  const dir = uf.get('dir') || undefined; // in | out
  const page = Number(uf.get('page')) || 1;
  const pageSize = Number(uf.get('pageSize')) || 20;

  // ONE period control governs the page; default «Shu oy» (matches DateRangeControl).
  const monthDefault = useMemo(
    () => ({ from: dayjs().startOf('month').format(FMT), to: dayjs().endOf('month').format(FMT) }),
    [],
  );
  const from = uf.get('from') || monthDefault.from;
  const to = uf.get('to') || monthDefault.to;
  const direction = dir === 'in' ? 'IN' : dir === 'out' ? 'OUT' : undefined;

  const [manualOpen, setManualOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [stornoRow, setStornoRow] = useState<KassaTxRow | null>(null);
  const [peekId, setPeekId] = useState<string | null>(null);

  // ── queries (entity-first keys → realtime «kassa» invalidation reaches them) ──
  const boxesQ = useQuery({
    queryKey: ['kassa', 'cashboxes'],
    queryFn: () => endpoints.cashboxes() as Promise<Cashbox[]>,
  });
  const boxes = useMemo(
    () => (boxesQ.data ?? []).filter((b) => inScope(b.type, scope)),
    [boxesQ.data, scope],
  );

  // On entry, auto-select the FIRST cashbox (once) so the page opens scoped to a
  // single box with its journal, instead of the un-scoped «all» view. The user can
  // still toggle it off or pick another — we don't force a re-selection afterwards.
  const didAutoSelect = useRef(false);
  useEffect(() => {
    if (didAutoSelect.current || boxes.length === 0) return;
    didAutoSelect.current = true;
    if (!cashboxId) uf.set({ cashboxId: boxes[0].id });
  }, [boxes, cashboxId, uf]);

  const txParams = { page, pageSize, cashboxId, scope, direction, source, dateFrom: from, dateTo: to };
  const txQ = useQuery({
    queryKey: ['kassa', 'transactions', txParams],
    queryFn: () => endpoints.kassaTransactions(txParams) as Promise<Paged<KassaTxRow>>,
    placeholderData: keepPreviousData,
  });
  const txItems = txQ.data?.items ?? [];

  // period summary — feeds the SOF FOYDA headline + this-period kirim/chiqim
  const summaryQ = useQuery({
    queryKey: ['kassa', 'summary', { from, to }],
    queryFn: () => endpoints.kassaSummary({ dateFrom: from, dateTo: to }) as Promise<KassaSummary>,
    placeholderData: keepPreviousData,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['kassa'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
    // CashboxSelect (manual op / PaymentComposer) reads the separate ['cashboxes']
    // key (60s staleTime) — bust it so a just-created/renamed box shows immediately
    qc.invalidateQueries({ queryKey: ['cashboxes'] });
  };

  const stornoMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => endpoints.kassaReverse(id, reason),
    onSuccess: () => {
      invalidate();
      setStornoRow(null);
    },
  });

  const toggleBox = (id: string) => uf.set({ cashboxId: cashboxId === id ? null : id });

  // ── keyboard: N manual op · 1..9 cashbox card · Esc clears card scoping (§6.7) ──
  const kb = useRef({ boxes, cashboxId, canManual, overlay: false });
  kb.current = { boxes, cashboxId, canManual, overlay: manualOpen || !!stornoRow || !!peekId };
  useEffect(() => {
    const editable = (t: EventTarget | null): boolean => {
      const el = t as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || editable(e.target)) return;
      const s = kb.current;
      if (s.overlay) return; // overlays own the keyboard
      if (e.key === 'n' || e.key === 'N') {
        if (s.canManual) {
          e.preventDefault();
          setManualOpen(true);
        }
      } else if (/^[1-9]$/.test(e.key)) {
        const b = s.boxes[Number(e.key) - 1];
        if (b) {
          e.preventDefault();
          uf.set({ cashboxId: s.cashboxId === b.id ? null : b.id });
        }
      } else if (e.key === 'Escape' && s.cashboxId) {
        uf.set({ cashboxId: null });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [uf]);

  // ── source-document navigation (journal row → its document) ──
  const openSource = (row: KassaTxRow) => {
    if (row.payment) {
      setPeekId(row.payment.id);
    } else if (row.bonusTransaction) {
      navigate('/bonus');
    }
  };

  // per-currency grand totals from the cards' live all-time balances (never merged)
  const cardUZS = boxes.filter((b) => b.currency === 'UZS').reduce((s, b) => s + num(b.balance), 0);
  const cardUSD = boxes.filter((b) => b.currency === 'USD').reduce((s, b) => s + num(b.balance), 0);
  const hasUsdBox = boxes.some((b) => b.currency === 'USD');

  // SOF FOYDA headline: net profit (all-time, global) + whole-treasury real cash + this
  // period's kirim/chiqim. Real cash never dips below zero; as clients pay it climbs
  // toward the profit. Uses ALL boxes (both cash + bank) — profit is a company figure.
  const allBoxes = boxesQ.data ?? [];
  const realCashUZS = allBoxes.filter((b) => b.currency === 'UZS').reduce((s, b) => s + num(b.balance), 0);
  const sumBoxes = summaryQ.data?.cashboxes ?? [];
  const periodInUZS = sumBoxes.filter((b) => b.currency === 'UZS').reduce((s, b) => s + num(b.in), 0);
  const periodOutUZS = sumBoxes.filter((b) => b.currency === 'UZS').reduce((s, b) => s + num(b.out), 0);
  const netProfitUZS = num(summaryQ.data?.profit?.netProfit ?? 0);

  // ── journal columns ──
  // telefonda ustun kengliklari qisqaradi: «Sana» qotirilgan birinchi ustun
  // bo'lgani uchun 150px ekranning yarmini yeb qo'yadi (spec §2.2.5).
  const boxCol: SbColumn<KassaTxRow> = {
    title: 'Kassa',
    key: 'cashbox',
    width: isPhone ? 140 : 200,
    render: (_: unknown, r: KassaTxRow) => (
      <Flex align="center" gap={6} style={{ minWidth: 0 }}>
        {r.cashbox ? <span style={{ color: token.colorTextSecondary }}>{BOX_ICON[r.cashbox.type]}</span> : null}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {r.cashbox?.name ?? '—'}
        </span>
        {r.cashbox?.currency === 'USD' ? <Tag bordered={false}>USD</Tag> : null}
      </Flex>
    ),
  };

  const journalColumns: SbColumn<KassaTxRow>[] = [
    { title: 'Sana', dataIndex: 'date', width: isPhone ? 118 : 150, render: (v: string) => fmtDateTime(v) },
    ...(cashboxId ? [] : [boxCol]),
    {
      title: "Yo'nalish",
      dataIndex: 'direction',
      width: 120,
      render: (v: CashDirection) => <StatusChip meta={CASH_DIRECTION[v]} />,
    },
    {
      title: 'Summa',
      dataIndex: 'amount',
      align: 'right',
      width: 160,
      render: (_: unknown, r: KassaTxRow) => {
        const signed = r.direction === 'IN' ? num(r.amount) : -num(r.amount);
        return <MoneyCell value={signed} variant={r.direction === 'IN' ? 'in' : 'neutral'} signed />;
      },
    },
    {
      title: 'Manba',
      dataIndex: 'source',
      width: 150,
      render: (v: CashSource) => <StatusChip meta={CASH_SOURCE[v]} />,
    },
    {
      title: 'Hujjat',
      key: 'ref',
      ellipsis: true,
      render: (_: unknown, r: KassaTxRow) => (
        <HujjatCell row={r} onPeek={setPeekId} onNav={(to) => navigate(to)} />
      ),
    },
    {
      title: 'Izoh',
      dataIndex: 'note',
      ellipsis: true,
      render: (v: string | null) => v || '—',
    },
    {
      title: '',
      key: 'actions',
      width: 48,
      render: (_: unknown, r: KassaTxRow) => {
        const items: { key: string; label: string; icon: ReactNode; danger?: boolean }[] = [];
        if (r.payment) {
          items.push({ key: 'open', label: t('Hujjatni ochish'), icon: <FileSearchOutlined /> });
          if (!r.payment.voidedAt) items.push({ key: 'receipt', label: t('Kvitansiya'), icon: <PrinterOutlined /> });
        } else if (r.expense || r.bonusTransaction) {
          items.push({ key: 'open', label: t('Hujjatni ochish'), icon: <FileSearchOutlined /> });
        } else if (r.source === 'MANUAL' && !r.reversedBy && canStorno) {
          items.push({ key: 'storno', label: t('Qaytarish (storno)'), icon: <UndoOutlined />, danger: true });
        }
        if (!items.length) return null;
        return (
          <Dropdown
            trigger={['click']}
            menu={{
              items,
              onClick: ({ key }) => {
                if (key === 'open') openSource(r);
                else if (key === 'receipt' && r.payment) navigate(`/print/receipt/${r.payment.id}`);
                else if (key === 'storno') setStornoRow(r);
              },
            }}
          >
            <Button type="text" size="small" icon={<MoreOutlined />} aria-label={t('Amallar')} />
          </Dropdown>
        );
      },
    },
  ];

  const paymentRowIds = useMemo(
    () => Array.from(new Set(txItems.filter((r) => r.payment).map((r) => r.payment!.id))),
    [txItems],
  );

  const manualPrimary = {
    key: 'manual',
    label: "Qo'lda kirim/chiqim",
    icon: <PlusOutlined />,
    primary: true,
    kbd: 'N',
    onClick: () => setManualOpen(true),
  };
  const transferAction = {
    key: 'transfer',
    label: "O'tkazma",
    icon: <SwapOutlined />,
    onClick: () => setTransferOpen(true),
  };
  const addBox = {
    key: 'add-box',
    label: isBank ? 'Yangi bank hisob' : 'Yangi kassa',
    icon: <PlusOutlined />,
    primary: !canManual,
    onClick: () => setBoxForm({ open: true, editing: null }),
  };
  const headerActions = [
    ...(canManual ? [manualPrimary, transferAction] : []),
    ...(canManageBox ? [addBox] : []),
  ];

  return (
    <div>
      <PageHeader
        title={isBank ? 'Bank hisoblar' : 'Kassa'}
        subtitle={
          isBank
            ? 'Bank va terminal hisoblari — qoldiq, kirim/chiqim va jurnal'
            : 'Naqd kassalar — qoldiq, kirim/chiqim va tranzaksiyalar jurnali'
        }
        accent
        meta={
          <DateRangeControl
            from={from}
            to={to}
            onChange={({ from: f, to: t }) => uf.set({ from: f || null, to: t || null })}
          />
        }
        actions={headerActions.length ? headerActions : undefined}
      />

      {/* SOF FOYDA headline — the money the business earned; real cash climbs toward it */}
      <div
        className="dash-card"
        style={{
          padding: isPhone ? 14 : 20,
          marginBottom: 12,
          display: 'flex',
          flexWrap: 'wrap',
          gap: isPhone ? 14 : 28,
          alignItems: 'flex-end',
          borderLeft: `3px solid ${token.colorPrimary}`,
        }}
      >
        <div style={{ flex: isPhone ? '1 1 100%' : undefined, minWidth: isPhone ? 0 : 240 }}>
          <div style={{ fontSize: 12, letterSpacing: 0.4, color: token.colorTextSecondary, textTransform: 'uppercase' }}>
            {t('Sof foyda')}
          </div>
          {/* R17: telefonda raqam clamp bilan kichrayadi va « so'm » alohida span
              bo'lib chiqadi — MoneyCell ichidagi `nowrap` uni yorib chiqmasin. */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap', minWidth: 0 }}>
            <MoneyCell
              value={netProfitUZS}
              variant={netProfitUZS >= 0 ? 'in' : 'neutral'}
              strong
              suffix={isPhone ? undefined : t("so'm")}
              style={{
                fontSize: isPhone ? 'clamp(20px, 7vw, 30px)' : 30,
                lineHeight: isPhone ? 1.25 : '38px',
              }}
            />
            {isPhone ? (
              <span style={{ fontSize: 14, color: token.colorTextSecondary }}>{t("so'm")}</span>
            ) : null}
          </div>
          <div style={{ fontSize: 12, color: token.colorTextTertiary, marginTop: 2 }}>
            {t("Sotuvdan tannarx va transport ayirilgach qolgan foyda — kassaga tushadi")}
          </div>
        </div>
        <div
          style={
            isPhone
              ? {
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                  gap: 12,
                  flex: '1 1 100%',
                  minWidth: 0,
                }
              : { display: 'flex', gap: 28, flexWrap: 'wrap', flex: 1 }
          }
        >
          <HeroStat label={t('Haqiqiy naqd qoldiq')} value={realCashUZS} hint={t('kassa hech qachon minusga tushmaydi')} />
          <HeroStat label={t('Bu davr kirim')} value={periodInUZS} variant="in" />
          <HeroStat label={t('Bu davr chiqim')} value={periodOutUZS} />
        </div>
      </div>

      {/* cashbox cards — scoping filters */}
      {boxesQ.isError ? (
        <ErrorState error={boxesQ.error} onRetry={() => void boxesQ.refetch()} />
      ) : boxesQ.isLoading ? (
        <Flex gap={12} wrap style={{ marginBottom: 8 }}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="dash-card"
              style={{
                flex: isPhone ? '1 1 100%' : '1 1 200px',
                minWidth: isPhone ? 0 : 200,
                padding: isPhone ? 14 : 16,
              }}
            >
              <Skeleton active paragraph={{ rows: 1 }} title={{ width: '60%' }} />
            </div>
          ))}
        </Flex>
      ) : (
        <>
          <Flex gap={12} wrap>
            {boxes.map((b, i) => (
              <CashboxCard
                key={b.id}
                box={b}
                index={i}
                selected={cashboxId === b.id}
                onToggle={() => toggleBox(b.id)}
                onEdit={canManageBox ? () => setBoxForm({ open: true, editing: b }) : undefined}
              />
            ))}
            {canManageBox ? (
              <button
                type="button"
                onClick={() => setBoxForm({ open: true, editing: null })}
                className="dash-card dash-card--interactive dash-pressable"
                style={{
                  appearance: 'none',
                  cursor: 'pointer',
                  flex: isPhone ? '1 1 100%' : boxes.length === 0 ? '1 1 200px' : '0 0 200px',
                  minWidth: isPhone ? 0 : 200,
                  minHeight: isPhone ? 52 : undefined,
                  padding: isPhone ? 14 : 16,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  color: token.colorTextSecondary,
                  border: `1px dashed ${token.colorBorder}`,
                  background: 'transparent',
                }}
              >
                <PlusOutlined /> {isBank ? t('Bank hisob qo‘shish') : t('Kassa qo‘shish')}
              </button>
            ) : null}
          </Flex>
          <Flex gap={isPhone ? 10 : 20} wrap style={{ margin: '12px 2px 0', alignItems: 'baseline', minWidth: 0 }}>
            <span style={{ color: token.colorTextSecondary, fontSize: 13 }}>
              {t("Jami so'm:")}{' '}
              <MoneyCell value={cardUZS} variant="neutral" strong suffix={t("so'm")} style={{ fontSize: 14 }} />
            </span>
            {hasUsdBox ? (
              <span style={{ color: token.colorTextSecondary, fontSize: 13 }}>
                {t('Jami USD:')}{' '}
                <MoneyCell value={cardUSD} variant="neutral" strong suffix="$" style={{ fontSize: 14 }} />
              </span>
            ) : null}
            <span style={{ color: token.colorTextTertiary, fontSize: 12 }}>
              {t("(valyutalar hech qachon qo'shilmaydi)")}
            </span>
          </Flex>
        </>
      )}

      {/* journal */}
      <section style={{ marginTop: isPhone ? 16 : 24 }}>
        <TableCard
          title={t('Jurnal')}
          extra={
            /* R5: telefonda filtrlar to'liq kenglikda ustma-ust joylashadi */
            <Flex gap={8} wrap align="center" style={{ width: isPhone ? '100%' : undefined, minWidth: 0 }}>
              <Select
                allowClear
                size="small"
                placeholder={t("Yo'nalish")}
                style={{ minWidth: isPhone ? 0 : 130, width: isPhone ? '100%' : undefined }}
                value={dir}
                onChange={(v) => uf.set({ dir: v || null })}
                options={[
                  { value: 'in', label: t('Kirim') },
                  { value: 'out', label: t('Chiqim') },
                ]}
              />
              <Select
                allowClear
                size="small"
                placeholder={t('Manba')}
                style={{ minWidth: isPhone ? 0 : 160, width: isPhone ? '100%' : undefined }}
                value={source}
                onChange={(v) => uf.set({ source: v || null })}
                options={(Object.keys(CASH_SOURCE) as CashSource[]).map((k) => ({
                  value: k,
                  label: CASH_SOURCE[k].label,
                }))}
              />
              {cashboxId || source || dir ? (
                <Button
                  type="link"
                  size="small"
                  onClick={() => uf.set({ cashboxId: null, source: null, dir: null })}
                >
                  {t('Tozalash')}
                </Button>
              ) : null}
            </Flex>
          }
        >
          <DataTable<KassaTxRow>
            columns={journalColumns}
            query={txQ}
            rowKey="id"
            onRowOpen={openSource}
            filterKeys={['cashboxId', 'source', 'dir']}
            onClearFilters={() => uf.set({ cashboxId: null, source: null, dir: null })}
            emptyText="Bu davrda kassa harakati yo'q"
            ghostWhen={(r) => !!r.payment?.voidedAt || !!r.expense?.voidedAt}
            // spec §2.2: jurnal — zich moliyaviy defter, telefonda ham JADVAL
            // bo'lib qoladi (birinchi ustun qotirilgan + gorizontal skroll).
            mobileMode="table"
            pinFirstColumn
            // R10: 1100px poli faqat desktopda qoladi (Qonun 1); pastda ustunlar
            // `max-content` bilan siqiladi, aks holda 320px da 1100px skroll.
            scroll={isDesktop ? { x: 1100 } : { x: 'max-content' }}
          />
        </TableCard>
      </section>

      {/* manual op */}
      <ManualCashModal open={manualOpen} onClose={() => setManualOpen(false)} onSaved={invalidate} scope={scope} />

      {/* box → box / box → bank transfer */}
      <TransferModal open={transferOpen} onClose={() => setTransferOpen(false)} onSaved={invalidate} />

      {/* cashbox / bank account create + edit */}
      <CashboxFormDrawer
        open={boxForm.open}
        editing={boxForm.editing}
        scope={scope}
        onClose={() => setBoxForm({ open: false, editing: null })}
        onSaved={invalidate}
      />

      {/* storno — ReasonModal on MANUAL rows only */}
      <ReasonModal
        open={!!stornoRow}
        title="Kassa yozuvini qaytarish (storno)"
        confirmLabel="Qaytarish"
        facts={stornoRow ? buildStornoFacts(stornoRow, boxes) : undefined}
        submitting={stornoMut.isPending}
        error={stornoMut.error}
        onConfirm={async (reason) => {
          if (stornoRow) await stornoMut.mutateAsync({ id: stornoRow.id, reason });
        }}
        onClose={() => setStornoRow(null)}
      />

      {/* payment source document — canonical peek, ↑/↓ triage across payment rows */}
      <PaymentPeek
        paymentId={peekId}
        open={!!peekId}
        onClose={() => setPeekId(null)}
        rowIds={paymentRowIds}
        activeId={peekId ?? undefined}
        onNavigate={(id) => setPeekId(id)}
      />
    </div>
  );
}

/** /kassa — naqd + elektron kassalar (bank hisoblardan tashqari). */
export default function Kassa() {
  return <KassaView scope="cash" />;
}

// ── one figure block inside the SOF FOYDA headline ────────────────────────────
function HeroStat({
  label,
  value,
  hint,
  variant = 'neutral',
}: {
  label: string;
  value: number;
  hint?: string;
  variant?: 'in' | 'neutral';
}) {
  const { token } = theme.useToken();
  const t = useT();
  const isPhone = useIsPhone();
  return (
    <div style={{ minWidth: isPhone ? 0 : 150 }}>
      <div style={{ fontSize: 12, color: token.colorTextSecondary }}>{label}</div>
      {/* R17: telefonda « so'm » alohida span — MoneyCell `nowrap` bo'lgani uchun
          birga qolsa 150px ustunni yorib chiqadi */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, flexWrap: 'wrap', minWidth: 0 }}>
        <MoneyCell
          value={value}
          variant={variant}
          strong
          suffix={isPhone ? undefined : t("so'm")}
          style={{ fontSize: isPhone ? 16 : 18, lineHeight: isPhone ? '22px' : '24px' }}
        />
        {isPhone ? <span style={{ fontSize: 12, color: token.colorTextSecondary }}>{t("so'm")}</span> : null}
      </div>
      {hint ? <div style={{ fontSize: 11, color: token.colorTextTertiary, marginTop: 2 }}>{hint}</div> : null}
    </div>
  );
}

// ── Hujjat cell: source-document links + chained reversal rows ─────────────────
function HujjatCell({
  row,
  onPeek,
  onNav,
}: {
  row: KassaTxRow;
  onPeek: (id: string) => void;
  onNav: (to: string) => void;
}) {
  const { token } = theme.useToken();
  const t = useT();
  const linkBtn = (label: ReactNode, onClick: () => void, ghost = false) => (
    <Button
      type="link"
      size="small"
      onClick={onClick}
      style={{
        padding: 0,
        height: 'auto',
        maxWidth: '100%',
        display: 'block',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        textAlign: 'left',
        whiteSpace: 'nowrap',
        color: ghost ? token.colorTextTertiary : undefined,
        textDecoration: ghost ? 'line-through' : undefined,
      }}
    >
      {label}
    </Button>
  );

  if (row.source === 'REVERSAL' && row.reversalOf) {
    return (
      <Flex align="center" gap={8} wrap>
        <StatusChip meta={CASH_SOURCE.REVERSAL} />
        <span style={{ fontSize: 12, color: token.colorTextTertiary }}>
          ← {fmtDateTime(row.reversalOf.date)} · {fmtMoney(row.reversalOf.amount)}
        </span>
      </Flex>
    );
  }
  if (row.payment) {
    const party =
      row.payment.client?.name ?? row.payment.factory?.name ?? row.payment.vehicle?.name ?? '';
    const label = `${PAYMENT_KIND[row.payment.kind]?.label ?? row.payment.kind}${party ? ` · ${party}` : ''}`;
    return linkBtn(label, () => onPeek(row.payment!.id), !!row.payment.voidedAt);
  }
  if (row.expense) {
    const label = `${t('Xarajat')}${row.expense.category?.name ? ` · ${row.expense.category.name}` : ''}`;
    return <span className={row.expense.voidedAt ? 'ghost-amount' : undefined}>{label}</span>;
  }
  if (row.bonusTransaction) {
    const label = `${t('Bonus yechish')}${row.bonusTransaction.factory?.name ? ` · ${row.bonusTransaction.factory.name}` : ''}`;
    return linkBtn(label, () => onNav('/bonus'));
  }
  if (row.reversedBy) {
    return (
      <Flex align="center" gap={8} wrap>
        <Tag bordered={false} color="default">
          {t('Qaytarilgan')}
        </Tag>
        <span style={{ fontSize: 12, color: token.colorTextTertiary }}>
          → {fmtDateTime(row.reversedBy.date)}
        </span>
      </Flex>
    );
  }
  return <span style={{ color: token.colorTextTertiary }}>—</span>;
}

/** storno impact facts — the compensating reversal row + resulting box balance. */
function buildStornoFacts(row: KassaTxRow, boxes: Cashbox[]): ImpactFact[] {
  const box = boxes.find((b) => b.id === row.cashboxId);
  const boxName = row.cashbox?.name ?? box?.name ?? translate('Kassa');
  const curr = currencySuffix((row.cashbox?.currency ?? box?.currency ?? 'UZS') as 'UZS' | 'USD');
  const opp = row.direction === 'IN' ? 'OUT' : 'IN';
  const dirWord = row.direction === 'IN' ? translate('kirim') : translate('chiqim');
  const sign = opp === 'IN' ? '+' : '−';
  const facts: ImpactFact[] = [
    {
      tone: 'neutral',
      text: interpolate(translate('Qarama-qarshi yozuv: {box} {sign} {amount} {curr} ({dir} stornosi)'), {
        box: boxName,
        sign,
        amount: fmtMoney(row.amount),
        curr,
        dir: dirWord,
      }),
    },
  ];
  if (box?.balance != null) {
    const after = opp === 'IN' ? num(box.balance) + num(row.amount) : num(box.balance) - num(row.amount);
    facts.push({
      tone: after < 0 ? 'danger' : 'neutral',
      text: interpolate(translate("Kassa qoldig'i: {amount} {curr} bo'ladi"), {
        amount: fmtMoney(after),
        curr,
      }),
    });
  }
  return facts;
}
