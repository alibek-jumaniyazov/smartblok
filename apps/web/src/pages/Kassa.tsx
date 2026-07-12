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
import { can } from '../lib/permissions';
import { useAuth } from '../auth/AuthContext';
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
import type { CashDirection, Cashbox, CashTransaction, Paged, PaymentKind } from '../lib/types';

const FMT = 'YYYY-MM-DD';

/** Kassa page (naqd + elektron) vs Bank page (bank hisoblar). */
export type CashboxScope = 'cash' | 'bank';
const inScope = (type: Cashbox['type'], scope: CashboxScope): boolean =>
  scope === 'bank' ? type === 'BANK' : type !== 'BANK';

/** creatable non-bank cashbox types (bank is fixed on the Bank page). */
const CASH_TYPE_OPTS: { value: Cashbox['type']; label: string }[] = [
  { value: 'CASH', label: 'Naqd kassa' },
  { value: 'CLICK', label: 'Click' },
  { value: 'TERMINAL', label: 'Terminal' },
  { value: 'CARD', label: 'Karta' },
];

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

const currencySuffix = (c: 'UZS' | 'USD'): string => (c === 'USD' ? '$' : "so'm");

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
  const inactive = box.active === false;
  return (
    <div style={{ position: 'relative', flex: '1 1 200px', minWidth: 200, display: 'flex' }}>
      {onEdit ? (
        <Tooltip title="Tahrirlash">
          <Button
            type="text"
            size="small"
            aria-label={`${box.name} — tahrirlash`}
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
          padding: 16,
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
      <Flex align="center" gap={8} style={{ minWidth: 0, paddingRight: onEdit ? 22 : 0 }}>
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
        {index < 9 ? <KbdHint>{index + 1}</KbdHint> : null}
      </Flex>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <MoneyCell
          value={box.balance}
          variant="neutral"
          strong
          suffix={currencySuffix(box.currency)}
          style={{ fontSize: 20, lineHeight: '26px' }}
        />
        <Tag bordered={false} style={{ marginInlineEnd: 0 }}>
          {CURRENCY[box.currency].label}
        </Tag>
        {inactive ? (
          <Tag bordered={false} color="default">
            Nofaol
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
      message.success('Kassa yozuvi saqlandi');
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

  const curr = box ? currencySuffix(box.currency) : "so'm";

  return (
    <FormDrawer
      title="Qo'lda kirim/chiqim"
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
            autoFocus
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
              { label: 'Kirim', value: 'IN' },
              { label: 'Chiqim', value: 'OUT' },
            ]}
          />
          {!direction ? (
            <div style={{ fontSize: 12, color: token.colorTextTertiary, marginTop: 4 }}>
              Yo'nalishni tanlang
            </div>
          ) : null}
        </Field>

        <Field label="Summa">
          <MoneyInput
            value={amount}
            onChange={setAmount}
            min={1}
            max={direction === 'OUT' ? box?.balance ?? undefined : undefined}
            maxLabel={box ? `Kassada: ${fmtMoney(box.balance)} ${curr}` : undefined}
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
            placeholder="Izoh (ixtiyoriy)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
      </div>
    </FormDrawer>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  const { token } = theme.useToken();
  return (
    <label style={{ display: 'block' }}>
      <div style={{ fontSize: 13, color: token.colorTextSecondary, marginBottom: 6 }}>{label}</div>
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
      message.success(isBank ? "Bank hisob qo'shildi" : "Kassa qo'shildi");
      onSaved();
      onClose();
    },
    onError: (e) => message.error(apiError(e)),
  });
  const updateM = useMutation({
    mutationFn: (d: { name?: string; active?: boolean }) => endpoints.updateCashbox(editing!.id, d),
    onSuccess: () => {
      message.success('Saqlandi');
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
      ? 'Bank hisobni tahrirlash'
      : 'Kassani tahrirlash'
    : isBank
      ? 'Yangi bank hisob'
      : 'Yangi kassa';

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
            autoFocus
            value={name}
            maxLength={120}
            placeholder={isBank ? 'Masalan: Kapital Bank' : 'Masalan: Asosiy kassa'}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>

        {!editing && !isBank ? (
          <Field label="Turi">
            <Segmented<string>
              block
              value={type}
              onChange={(v) => setType(v as Cashbox['type'])}
              options={CASH_TYPE_OPTS.map((o) => ({ label: o.label, value: o.value }))}
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
                { label: "So'm (UZS)", value: 'UZS' },
                { label: 'Dollar (USD)', value: 'USD' },
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
                { label: 'Faol', value: 'active' },
                { label: 'Nofaol', value: 'inactive' },
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

  // ── journal columns ──
  const boxCol: SbColumn<KassaTxRow> = {
    title: 'Kassa',
    key: 'cashbox',
    width: 200,
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
    { title: 'Sana', dataIndex: 'date', width: 150, render: (v: string) => fmtDateTime(v) },
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
          items.push({ key: 'open', label: 'Hujjatni ochish', icon: <FileSearchOutlined /> });
          if (!r.payment.voidedAt) items.push({ key: 'receipt', label: 'Kvitansiya', icon: <PrinterOutlined /> });
        } else if (r.expense || r.bonusTransaction) {
          items.push({ key: 'open', label: 'Hujjatni ochish', icon: <FileSearchOutlined /> });
        } else if (r.source === 'MANUAL' && !r.reversedBy && canStorno) {
          items.push({ key: 'storno', label: 'Qaytarish (storno)', icon: <UndoOutlined />, danger: true });
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
            <Button type="text" size="small" icon={<MoreOutlined />} aria-label="Amallar" />
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
  const addBox = {
    key: 'add-box',
    label: isBank ? 'Yangi bank hisob' : 'Yangi kassa',
    icon: <PlusOutlined />,
    primary: !canManual,
    onClick: () => setBoxForm({ open: true, editing: null }),
  };
  const headerActions = [
    ...(canManual ? [manualPrimary] : []),
    ...(canManageBox ? [addBox] : []),
  ];

  return (
    <div>
      <PageHeader
        title={isBank ? 'Bank hisoblar' : 'Kassa'}
        meta={
          <DateRangeControl
            from={from}
            to={to}
            onChange={({ from: f, to: t }) => uf.set({ from: f || null, to: t || null })}
          />
        }
        actions={headerActions.length ? headerActions : undefined}
      />

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
                flex: '1 1 200px',
                minWidth: 200,
                padding: 16,
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
                  flex: boxes.length === 0 ? '1 1 200px' : '0 0 200px',
                  minWidth: 200,
                  padding: 16,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  color: token.colorTextSecondary,
                  border: `1px dashed ${token.colorBorder}`,
                  background: 'transparent',
                }}
              >
                <PlusOutlined /> {isBank ? 'Bank hisob qo‘shish' : 'Kassa qo‘shish'}
              </button>
            ) : null}
          </Flex>
          <Flex gap={20} wrap style={{ margin: '12px 2px 0', alignItems: 'baseline' }}>
            <span style={{ color: token.colorTextSecondary, fontSize: 13 }}>
              Jami so'm:{' '}
              <MoneyCell value={cardUZS} variant="neutral" strong suffix="so'm" style={{ fontSize: 14 }} />
            </span>
            {hasUsdBox ? (
              <span style={{ color: token.colorTextSecondary, fontSize: 13 }}>
                Jami USD:{' '}
                <MoneyCell value={cardUSD} variant="neutral" strong suffix="$" style={{ fontSize: 14 }} />
              </span>
            ) : null}
            <span style={{ color: token.colorTextTertiary, fontSize: 12 }}>
              (valyutalar hech qachon qo'shilmaydi)
            </span>
          </Flex>
        </>
      )}

      {/* journal */}
      <section style={{ marginTop: 24 }}>
        <TableCard
          title="Jurnal"
          extra={
            <Flex gap={8} wrap align="center">
              <Select
                allowClear
                size="small"
                placeholder="Yo'nalish"
                style={{ minWidth: 130 }}
                value={dir}
                onChange={(v) => uf.set({ dir: v || null })}
                options={[
                  { value: 'in', label: 'Kirim' },
                  { value: 'out', label: 'Chiqim' },
                ]}
              />
              <Select
                allowClear
                size="small"
                placeholder="Manba"
                style={{ minWidth: 160 }}
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
                  Tozalash
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
            scroll={{ x: 1100 }}
          />
        </TableCard>
      </section>

      {/* manual op */}
      <ManualCashModal open={manualOpen} onClose={() => setManualOpen(false)} onSaved={invalidate} scope={scope} />

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
    const label = `Xarajat${row.expense.category?.name ? ` · ${row.expense.category.name}` : ''}`;
    return <span className={row.expense.voidedAt ? 'ghost-amount' : undefined}>{label}</span>;
  }
  if (row.bonusTransaction) {
    const label = `Bonus yechish${row.bonusTransaction.factory?.name ? ` · ${row.bonusTransaction.factory.name}` : ''}`;
    return linkBtn(label, () => onNav('/bonus'));
  }
  if (row.reversedBy) {
    return (
      <Flex align="center" gap={8} wrap>
        <Tag bordered={false} color="default">
          Qaytarilgan
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
  const boxName = row.cashbox?.name ?? box?.name ?? 'Kassa';
  const curr = currencySuffix((row.cashbox?.currency ?? box?.currency ?? 'UZS') as 'UZS' | 'USD');
  const opp = row.direction === 'IN' ? 'OUT' : 'IN';
  const dirWord = row.direction === 'IN' ? 'kirim' : 'chiqim';
  const sign = opp === 'IN' ? '+' : '−';
  const facts: ImpactFact[] = [
    {
      tone: 'neutral',
      text: `Qarama-qarshi yozuv: ${boxName} ${sign} ${fmtMoney(row.amount)} ${curr} (${dirWord} stornosi)`,
    },
  ];
  if (box?.balance != null) {
    const after = opp === 'IN' ? num(box.balance) + num(row.amount) : num(box.balance) - num(row.amount);
    facts.push({
      tone: after < 0 ? 'danger' : 'neutral',
      text: `Kassa qoldig'i: ${fmtMoney(after)} ${curr} bo'ladi`,
    });
  }
  return facts;
}
