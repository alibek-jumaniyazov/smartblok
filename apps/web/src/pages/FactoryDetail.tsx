// FactoryDetail — Zavod hubi (settlement hub, hero workflow c). factory.md §2.
// The read-only 3-Statistic page dies here: the balance is a SENTENCE
// (PartyBalanceHeader) and every settlement verb — pay, allocate, spend bonus,
// return pallets — runs in-context, pre-scoped to this factory, without ever
// re-selecting it or leaving the page. Statement / payments / bonus program +
// history + movements / pallet movements all survive as tabs (?tab=), each
// windowed/labelled with a link to its full register.
//
// Endpoints (all pre-existing, verified apps/api/src/factories/factories.service):
//   GET  /factories/:id            → name, active, balance, bonusBalance,
//                                     statement[], payments[≤50], bonusPrograms[],
//                                     bonusTransactions[≤50], palletTransactions[≤50]
//   GET  /factories/:id/bonus-program  → { current, history }
//   GET  /pallets/balances             → factories[] (the one pallet-count truth)
//   GET  /orders?factoryId&dateFrom    → «Ochiq buyurtmalar» strip (windowed scan)
//   GET  /payments?kind=FACTORY_OUT&factoryId  → Taqsimlash entry + To'lovlar link
//   GET  /payments/:id                 → per-row allocation Σ (lazy, §10c)
//   GET  /settings                     → palletPriceDefault (pallet-return prefill)
//   POST /payments (FACTORY_OUT) · /payments/:id/allocations · /bonus/offset ·
//   /bonus/withdraw · /pallets/factory-return · /factories/:id/bonus-program ·
//   PUT  /factories/:id (edit / activate / deactivate)
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  App,
  Breadcrumb,
  Button,
  DatePicker,
  Drawer,
  Dropdown,
  Empty,
  Flex,
  Input,
  Modal,
  Segmented,
  Skeleton,
  Spin,
  Switch,
  Table,
  Tag,
  theme,
  Typography,
} from 'antd';
import type { TableColumnsType } from 'antd';
import {
  CheckCircleFilled,
  EditOutlined,
  MoreOutlined,
  PlusOutlined,
  PrinterOutlined,
  RightOutlined,
  StopOutlined,
  WarningFilled,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { apiError, endpoints } from '../lib/api';
import { fmtDate, fmtDateTime, fmtM3, fmtMoney, fmtNum, num } from '../lib/format';
import { useUrlFilters } from '../lib/useUrlFilters';
import { can } from '../lib/permissions';
import { useAuth } from '../auth/AuthContext';
import { BONUS_TX, COST_STATUS, PALLET_TX, PAYMENT_METHOD } from '../lib/status-maps';
import {
  CashboxSelect,
  DateRangeControl,
  EmptyState,
  ErrorState,
  LedgerImpactPreview,
  MoneyCell,
  MoneyInput,
  PalletChip,
  PartyBalanceHeader,
  PartyStatement,
  PaymentComposer,
  PaymentPeek,
  SettleDrawer,
  StatusChip,
  type PartyHeaderAction,
} from '../components';
import type {
  BonusProgramKind,
  BonusTransactionType,
  Money,
  Order,
  Payment,
  PaymentMethod,
} from '../lib/types';

// ── kind labels (fuller than the shared BONUS_PROGRAM chip labels — factory.md §2.3) ──
const BONUS_KIND_LABEL: Record<BonusProgramKind, string> = {
  NONE: "Bonus yo'q",
  PER_M3: 'Har m³ uchun stavka',
  PERCENT: 'Xarid summasidan foiz',
};

const PALLET_PRICE_FALLBACK = 130_000;

// ── the GET /factories/:id payload shapes we read ──
interface BonusProgramRow {
  id: string;
  kind: BonusProgramKind;
  ratePerM3?: string | null;
  percent?: string | null;
  effectiveFrom: string;
  createdAt: string;
}
interface DetailPayment {
  id: string;
  date: string;
  method: PaymentMethod;
  amount: Money;
  cashbox?: { name: string; type: string } | null;
  note?: string | null;
}
interface DetailBonusTx {
  id: string;
  at: string;
  type: BonusTransactionType;
  amount: Money;
  baseAmount?: string | null;
  baseM3?: string | null;
  order?: { id?: string; orderNo: string } | null;
  note?: string | null;
}
interface DetailPalletTx {
  id: string;
  date: string;
  type: string;
  qty: number;
  unitPrice?: string | null;
  reversalOfId?: string | null;
  note?: string | null;
}
interface FactoryDetailData {
  id: string;
  name: string;
  note?: string | null;
  active: boolean;
  balance?: Money;
  bonusBalance?: Money;
  payments?: DetailPayment[];
  bonusPrograms?: BonusProgramRow[];
  bonusTransactions?: DetailBonusTx[];
  palletTransactions?: DetailPalletTx[];
}

const TAB_KEYS = ['hisob', 'tolovlar', 'bonus', 'paddonlar'] as const;
type TabKey = (typeof TAB_KEYS)[number];

/** Σ active (non-voided) allocations against a payment → «Taqsimlangan». */
function allocatedSum(p: Payment | undefined): number {
  if (!p?.allocations) return 0;
  return p.allocations.filter((a) => !a.voidedAt).reduce((s, a) => s + num(a.amount), 0);
}

export default function FactoryDetail() {
  const { id = '' } = useParams<{ id: string }>();
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const uf = useUrlFilters();

  const from = uf.get('from') || undefined;
  const to = uf.get('to') || undefined;
  const tab = (TAB_KEYS as readonly string[]).includes(uf.get('tab')) ? (uf.get('tab') as TabKey) : 'hisob';
  const peekId = uf.get('peek') || null;

  // ── surfaces (deep-linkable via ?panel=&payment=) ──
  const [payOpen, setPayOpen] = useState(false);
  const [settleOpen, setSettleOpen] = useState(false);
  const [settlePaymentId, setSettlePaymentId] = useState<string | null>(null);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [bonusOpen, setBonusOpen] = useState(false);
  const [palletOpen, setPalletOpen] = useState(false);
  const [programOpen, setProgramOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deactOpen, setDeactOpen] = useState(false);

  // ── data ──
  const detailQ = useQuery({
    queryKey: ['factories', id],
    queryFn: () => endpoints.factory(id) as Promise<FactoryDetailData>,
    enabled: !!id,
  });
  const programQ = useQuery({
    queryKey: ['factories', id, 'bonus-program'],
    queryFn: () => endpoints.bonusProgram(id) as Promise<{ current: BonusProgramRow | null; history: BonusProgramRow[] }>,
    enabled: !!id,
  });
  const palletsQ = useQuery({
    queryKey: ['pallets', 'balances'],
    queryFn: () => endpoints.palletBalances(),
  });
  // unallocated-payment gate for the Taqsimlash action + chooser shortcut
  const factoryPaymentsQ = useQuery({
    queryKey: ['payments', 'factory-out', id],
    queryFn: () => endpoints.payments({ kind: 'FACTORY_OUT', factoryId: id, voided: false, pageSize: 50 }),
    enabled: !!id,
  });

  const detail = detailQ.data;
  const program = programQ.data ?? { current: null, history: [] };
  const palletsHeld = palletsQ.data?.factories?.find((f) => f.factory.id === id)?.balance;
  const bonusBalance = detail?.bonusBalance ?? '0';
  const walletEmpty = num(bonusBalance) < 1;
  const factoryPayments = factoryPaymentsQ.data?.items ?? [];

  // ── deep-link the money surfaces (?panel=, palette lands here) ──
  useEffect(() => {
    const panel = uf.get('panel');
    const payment = uf.get('payment');
    if (peekId) return; // the payment peek owns ?panel while open
    if (panel === 'tolash') setPayOpen(true);
    else if (panel === 'taqsimlash' && payment) {
      setSettlePaymentId(payment);
      setSettleOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uf.get('panel'), uf.get('payment'), peekId]);

  const openPay = () => {
    setPayOpen(true);
    uf.set({ panel: 'tolash' }, { replace: true });
  };
  const closePay = () => {
    setPayOpen(false);
    uf.set({ panel: null, payment: null }, { replace: true });
  };
  const openSettleFor = (paymentId: string) => {
    setSettlePaymentId(paymentId);
    setSettleOpen(true);
    setChooserOpen(false);
    uf.set({ panel: 'taqsimlash', payment: paymentId }, { replace: true });
  };
  const closeSettle = () => {
    setSettleOpen(false);
    setSettlePaymentId(null);
    uf.set({ panel: null, payment: null }, { replace: true });
  };
  const onTaqsimlash = () => {
    if (factoryPayments.length === 1) openSettleFor(factoryPayments[0].id);
    else setChooserOpen(true);
  };
  const openAktSverki = () => {
    const qs = new URLSearchParams();
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    navigate(`/print/statement/factory/${id}${suffix}`);
  };

  const activateMut = useMutation({
    mutationFn: (active: boolean) => endpoints.updateFactory(id, { active }),
    onSuccess: (_r, active) => {
      message.success(active ? 'Zavod faollashtirildi' : 'Zavod nofaol qilindi');
      qc.invalidateQueries({ queryKey: ['factories'] });
      setDeactOpen(false);
    },
    onError: (e) => message.error(apiError(e)),
  });

  // ── keyboard (03 §8 / factory.md §2.6): T pay · E edit · P akt sverki ──
  const anySurfaceOpen =
    payOpen || settleOpen || chooserOpen || bonusOpen || palletOpen || programOpen || editOpen || deactOpen || !!peekId;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return;
      if (anySurfaceOpen || !detail || detail.active === false) return;
      const k = e.key.toLowerCase();
      if (k === 't' && can(user?.role, 'payments.create')) {
        e.preventDefault();
        openPay();
      } else if (k === 'e' && can(user?.role, 'factories.manage')) {
        e.preventDefault();
        setEditOpen(true);
      } else if (k === 'p') {
        e.preventDefault();
        openAktSverki();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anySurfaceOpen, detail, user, from, to]);

  // ── loading / error (platform state law §9) ──
  if (detailQ.isLoading || (!detail && detailQ.isFetching)) {
    return <HubSkeleton />;
  }
  if (detailQ.error || !detail) {
    return (
      <div style={{ paddingTop: 24 }}>
        <ErrorState
          error={detailQ.error ?? new Error('Zavod topilmadi')}
          message="Zavod topilmadi"
          onRetry={() => detailQ.refetch()}
        />
        <div style={{ textAlign: 'center', marginTop: 8 }}>
          <Link to="/factories">Zavodlarga qaytish</Link>
        </div>
      </div>
    );
  }

  const inactive = detail.active === false;

  // ── program badge (clickable → bonus tab) for the balance-header counters ──
  const cur = program.current;
  const programBadge = (
    <button
      type="button"
      onClick={() => uf.set({ tab: 'bonus' })}
      className="num"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '1px 8px',
        borderRadius: token.borderRadiusSM,
        border: `1px solid ${token.colorBorder}`,
        background: 'transparent',
        color: token.colorTextSecondary,
        fontSize: 12,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      Bonus dasturi:
      <span style={{ fontWeight: 600, color: token.colorText }}>
        {!cur || cur.kind === 'NONE'
          ? "yo'q"
          : cur.kind === 'PER_M3'
            ? `${fmtMoney(cur.ratePerM3)} so'm/m³`
            : `${fmtNum(cur.percent, 2)} %`}
      </span>
      {cur && cur.kind !== 'NONE' ? <span>· {fmtDate(cur.effectiveFrom)} dan</span> : null}
    </button>
  );

  const clickablePallet =
    palletsHeld != null && palletsHeld !== 0 ? (
      <span
        role="button"
        tabIndex={0}
        onClick={() => uf.set({ tab: 'paddonlar' })}
        onKeyDown={(e) => e.key === 'Enter' && uf.set({ tab: 'paddonlar' })}
        style={{ cursor: 'pointer' }}
        title="Paddon harakatlarini ochish"
      >
        <PalletChip pallets={palletsHeld} />
      </span>
    ) : null;

  // ── quick actions on the balance hero (pre-scoped, cap-filtered) ──
  const quickActions: PartyHeaderAction[] = inactive
    ? [{ key: 'activate', label: 'Faollashtirish', primary: true, cap: 'factories.manage', onClick: () => activateMut.mutate(true) }]
    : [
        { key: 'pay', label: "To'lash", primary: true, cap: 'payments.create', onClick: openPay },
        {
          key: 'settle',
          label: 'Taqsimlash',
          cap: 'payments.allocate',
          disabled: factoryPayments.length === 0,
          onClick: onTaqsimlash,
        },
        {
          key: 'bonus',
          label: 'Bonusdan yopish',
          cap: 'bonus.offset',
          disabled: walletEmpty,
          onClick: () => setBonusOpen(true),
        },
        { key: 'pallet', label: 'Paddon qaytarish', cap: 'pallets.mutate', onClick: () => setPalletOpen(true) },
      ];

  // ── record-management overflow kebab ──
  const kebabItems = [
    can(user?.role, 'factories.manage') && !inactive
      ? { key: 'edit', icon: <EditOutlined />, label: 'Tahrirlash', onClick: () => setEditOpen(true) }
      : null,
    { key: 'akt', icon: <PrinterOutlined />, label: 'Akt sverki', onClick: openAktSverki },
    can(user?.role, 'factories.manage')
      ? inactive
        ? { key: 'activate', label: 'Faollashtirish', onClick: () => activateMut.mutate(true) }
        : { key: 'deact', icon: <StopOutlined />, danger: true, label: 'Nofaol qilish', onClick: () => setDeactOpen(true) }
      : null,
  ].filter(Boolean) as { key: string; icon?: ReactNode; danger?: boolean; label: string; onClick: () => void }[];

  return (
    <div>
      {/* top strip: breadcrumb + overflow kebab */}
      <Flex align="center" justify="space-between" gap={8} style={{ marginBottom: 4 }}>
        <Breadcrumb
          items={[{ title: <Link to="/factories">Zavodlar</Link> }, { title: detail.name }]}
          style={{ fontSize: 12 }}
        />
        {kebabItems.length > 0 ? (
          <Dropdown
            trigger={['click']}
            menu={{
              items: kebabItems.map((k) => ({ key: k.key, icon: k.icon, danger: k.danger, label: k.label, onClick: k.onClick })),
            }}
          >
            <Button icon={<MoreOutlined />} aria-label={`${detail.name} amallari`} />
          </Dropdown>
        ) : null}
      </Flex>

      {/* the balance IS the interface */}
      <PartyBalanceHeader
        party={{ id, name: detail.name, active: detail.active, balance: detail.balance }}
        partyType="factory"
        actions={quickActions}
        counters={{
          bonusWallet: bonusBalance,
          extra: (
            <>
              {programBadge}
              {clickablePallet}
            </>
          ),
        }}
      />

      {/* «Ochiq buyurtmalar» strip */}
      <OpenOrdersStrip factoryId={id} />

      {/* tabs */}
      <div style={{ marginTop: 16 }}>
        <Segmented
          value={tab}
          onChange={(v) => uf.set({ tab: v as string })}
          options={[
            { value: 'hisob', label: 'Hisob-kitob' },
            { value: 'tolovlar', label: "To'lovlar" },
            { value: 'bonus', label: 'Bonus dasturi' },
            { value: 'paddonlar', label: 'Paddonlar' },
          ]}
        />
      </div>

      <div style={{ marginTop: 16 }}>
        {tab === 'hisob' ? (
          <div>
            <Flex align="center" justify="space-between" gap={12} wrap style={{ marginBottom: 12 }}>
              <DateRangeControl from={from} to={to} onChange={(r) => uf.set({ from: r.from ?? null, to: r.to ?? null })} />
              <Button icon={<PrinterOutlined />} onClick={openAktSverki}>
                Akt sverki
              </Button>
            </Flex>
            <PartyStatement partyType="factory" partyId={id} from={from} to={to} />
          </div>
        ) : null}

        {tab === 'tolovlar' ? <PaymentsTab factoryId={id} payments={detail.payments ?? []} loading={detailQ.isFetching} /> : null}

        {tab === 'bonus' ? (
          <BonusTab
            factoryId={id}
            program={program}
            programLoading={programQ.isFetching}
            programError={programQ.error}
            onRetryProgram={() => programQ.refetch()}
            transactions={detail.bonusTransactions ?? []}
            canManage={can(user?.role, 'factories.bonusProgram')}
            onNewProgram={() => setProgramOpen(true)}
          />
        ) : null}

        {tab === 'paddonlar' ? (
          <PalletsTab
            factoryId={id}
            balance={palletsHeld}
            transactions={detail.palletTransactions ?? []}
            canReturn={can(user?.role, 'pallets.mutate') && !inactive}
            onReturn={() => setPalletOpen(true)}
          />
        ) : null}
      </div>

      {/* ── money surfaces ── */}
      <PaymentComposer
        open={payOpen}
        onClose={closePay}
        kind="FACTORY_OUT"
        presetParty={{ id, type: 'factory', name: detail.name, balance: detail.balance ?? null }}
        lockParty
      />

      <SettleDrawer paymentId={settlePaymentId ?? undefined} open={settleOpen} onClose={closeSettle} />

      <SettleChooserModal
        open={chooserOpen}
        onClose={() => setChooserOpen(false)}
        payments={factoryPayments}
        onPick={openSettleFor}
      />

      <BonusFlowModal
        open={bonusOpen}
        onClose={() => setBonusOpen(false)}
        factoryId={id}
        walletBalance={bonusBalance}
      />

      <PalletReturnModal
        open={palletOpen}
        onClose={() => setPalletOpen(false)}
        factoryId={id}
        factoryName={detail.name}
        heldNow={palletsHeld}
      />

      <ProgramDrawer
        open={programOpen}
        onClose={() => setProgramOpen(false)}
        factoryId={id}
        history={program.history}
      />

      <EditDrawer open={editOpen} onClose={() => setEditOpen(false)} factory={detail} />

      {/* deactivate confirm (plain modal — the API takes no reason; §1.3) */}
      <Modal
        open={deactOpen}
        title="Zavodni nofaol qilish"
        okText="Nofaol qilish"
        cancelText="Orqaga"
        okButtonProps={{ danger: true, loading: activateMut.isPending }}
        onOk={() => activateMut.mutate(false)}
        onCancel={() => setDeactOpen(false)}
        destroyOnHidden
      >
        <Typography.Text>
          «{detail.name}» nofaol qilinadi. Tarix saqlanadi — hech narsa o'chirilmaydi.
        </Typography.Text>
      </Modal>

      {/* payment peek (§9 — statement/table payment links round-trip here) */}
      <PaymentPeek paymentId={peekId} open={!!peekId} onClose={() => uf.set({ peek: null })} />
    </div>
  );
}

// ═══════════════════════════ Ochiq buyurtmalar strip ═══════════════════════════

type StripWindow = '30' | '90' | 'yil';

function OpenOrdersStrip({ factoryId }: { factoryId: string }) {
  const { token } = theme.useToken();
  const [win, setWin] = useState<StripWindow>('90');

  const dateFrom =
    win === 'yil'
      ? dayjs().startOf('year').format('YYYY-MM-DD')
      : dayjs()
          .subtract(Number(win), 'day')
          .format('YYYY-MM-DD');

  const q = useQuery({
    queryKey: ['orders', 'factory-open', factoryId, win],
    queryFn: () => endpoints.orders({ factoryId, dateFrom, pageSize: 200 }),
    enabled: !!factoryId,
    placeholderData: keepPreviousData,
  });

  const open = useMemo(
    () => (q.data?.items ?? []).filter((o: Order) => o.status !== 'CANCELLED' && o.costStatus !== 'FINAL'),
    [q.data],
  );
  const prov = open.filter((o) => o.costStatus === 'PROVISIONAL').length;
  const partial = open.filter((o) => o.costStatus === 'PARTIAL').length;
  const sum = open.reduce((s, o) => s + num(o.costTotal), 0);

  const windowChips = (
    <Segmented
      size="small"
      value={win}
      onChange={(v) => setWin(v as StripWindow)}
      options={[
        { value: '30', label: 'oxirgi 30 kun' },
        { value: '90', label: 'oxirgi 90 kun' },
        { value: 'yil', label: 'joriy yil' },
      ]}
    />
  );

  const clean = open.length === 0;

  return (
    <div
      style={{
        marginTop: 12,
        padding: '10px 14px',
        borderRadius: token.borderRadiusLG,
        border: `1px solid ${clean ? token.colorBorderSecondary : token.colorWarningBorder}`,
        background: clean ? token.colorFillQuaternary : token.colorWarningBg,
      }}
    >
      <Flex align="center" justify="space-between" gap={12} wrap>
        <Flex align="center" gap={10} wrap style={{ minWidth: 0 }}>
          {q.isLoading ? (
            <Typography.Text type="secondary">Ochiq buyurtmalar yuklanmoqda…</Typography.Text>
          ) : q.error ? (
            <Typography.Text type="danger">{apiError(q.error)}</Typography.Text>
          ) : clean ? (
            <Typography.Text style={{ color: token.colorSuccess }}>
              <CheckCircleFilled style={{ marginInlineEnd: 6 }} />
              Barcha tannarxlar qotirilgan
            </Typography.Text>
          ) : (
            <>
              <WarningFilled style={{ color: token.colorWarning }} />
              <Typography.Text>
                <b>{open.length} ta</b> buyurtma tannarxi qotirilmagan — jami{' '}
                <span className="num" style={{ fontWeight: 600 }}>
                  {fmtMoney(sum)} so'm
                </span>{' '}
                <Typography.Text type="secondary">(taxminiy)</Typography.Text>
              </Typography.Text>
              {prov > 0 ? <StatusChip meta={COST_STATUS.PROVISIONAL} /> : null}
              {prov > 0 ? <span className="num" style={{ color: token.colorTextSecondary }}>{prov}</span> : null}
              {partial > 0 ? <StatusChip meta={COST_STATUS.PARTIAL} /> : null}
              {partial > 0 ? <span className="num" style={{ color: token.colorTextSecondary }}>{partial}</span> : null}
            </>
          )}
        </Flex>
        <Flex align="center" gap={10} wrap>
          {windowChips}
          {!clean ? (
            <Link to={`/orders?factoryId=${factoryId}&chip=cost-open`}>
              Hammasi <RightOutlined style={{ fontSize: 11 }} />
            </Link>
          ) : null}
        </Flex>
      </Flex>
    </div>
  );
}

// ═══════════════════════════ To'lovlar tab ═══════════════════════════

function PaymentAllocBar({ paymentId, amount }: { paymentId: string; amount: Money }) {
  const { token } = theme.useToken();
  const q = useQuery({
    queryKey: ['payments', paymentId],
    queryFn: () => endpoints.payment(paymentId),
    staleTime: 30_000,
  });
  if (q.isLoading) return <Spin size="small" />;
  if (!q.data) return <Typography.Text type="secondary">—</Typography.Text>;
  const total = num(amount);
  const alloc = allocatedSum(q.data);
  const remainder = Math.max(0, total - alloc);
  const pct = total > 0 ? Math.min(100, (alloc / total) * 100) : 0;
  const done = remainder < 1;
  return (
    <div style={{ minWidth: 130 }}>
      <div style={{ height: 4, borderRadius: 2, background: token.colorFillSecondary, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: done ? token.colorSuccess : token.colorWarning }} />
      </div>
      <span className="num" style={{ fontSize: 11, color: token.colorTextSecondary }}>
        {done ? "To'liq taqsimlangan" : `Qoldiq ${fmtMoney(remainder)}`}
      </span>
    </div>
  );
}

function PaymentsTab({ factoryId, payments, loading }: { factoryId: string; payments: DetailPayment[]; loading: boolean }) {
  const { token } = theme.useToken();
  const uf = useUrlFilters();

  const cols: TableColumnsType<DetailPayment> = [
    { title: 'Sana', dataIndex: 'date', key: 'date', width: 108, render: (v: string) => fmtDate(v) },
    {
      title: 'Usul',
      dataIndex: 'method',
      key: 'method',
      width: 110,
      render: (v: PaymentMethod) => PAYMENT_METHOD[v]?.label ?? v,
    },
    {
      title: "Summa (so'm)",
      dataIndex: 'amount',
      key: 'amount',
      align: 'right',
      width: 150,
      render: (v: Money) => <MoneyCell value={v} strong />,
    },
    { title: 'Kassa', key: 'cashbox', width: 140, render: (_: unknown, r) => r.cashbox?.name ?? '—' },
    {
      title: 'Taqsimot',
      key: 'alloc',
      width: 160,
      render: (_: unknown, r) => <PaymentAllocBar paymentId={r.id} amount={r.amount} />,
    },
    { title: 'Izoh', dataIndex: 'note', key: 'note', ellipsis: true, render: (v: string | null) => v || '—' },
  ];

  if (payments.length === 0) {
    return <EmptyState message="Bu zavodga hali to'lov yo'q" />;
  }

  return (
    <div>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        oxirgi 50 · bekor qilinganlarsiz
      </Typography.Text>
      <Table<DetailPayment>
        rowKey="id"
        size="small"
        columns={cols}
        dataSource={payments}
        loading={loading}
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
        scroll={{ x: 760 }}
        style={{ marginTop: 8 }}
        onRow={(r) => ({
          onClick: () => uf.set({ peek: r.id }),
          style: { cursor: 'pointer' },
        })}
      />
      <div style={{ marginTop: 8 }}>
        <Link to={`/payments?kind=FACTORY_OUT&factoryId=${factoryId}`}>
          Hammasini ko'rish <RightOutlined style={{ fontSize: 11, color: token.colorTextTertiary }} />
        </Link>
      </div>
    </div>
  );
}

// ═══════════════════════════ Bonus dasturi tab ═══════════════════════════

function BonusTab({
  factoryId,
  program,
  programLoading,
  programError,
  onRetryProgram,
  transactions,
  canManage,
  onNewProgram,
}: {
  factoryId: string;
  program: { current: BonusProgramRow | null; history: BonusProgramRow[] };
  programLoading: boolean;
  programError: unknown;
  onRetryProgram: () => void;
  transactions: DetailBonusTx[];
  canManage: boolean;
  onNewProgram: () => void;
}) {
  const { token } = theme.useToken();
  const now = dayjs();

  const rateText = (p: BonusProgramRow) =>
    p.kind === 'PER_M3'
      ? `${fmtMoney(p.ratePerM3)} so'm/m³`
      : p.kind === 'PERCENT'
        ? `${fmtNum(p.percent, 2)} %`
        : '—';

  const historyCols: TableColumnsType<BonusProgramRow> = [
    {
      title: 'Turi',
      dataIndex: 'kind',
      key: 'kind',
      render: (v: BonusProgramKind, r) => (
        <Flex align="center" gap={6}>
          {BONUS_KIND_LABEL[v]}
          {r.id === program.current?.id ? <Tag color="green">joriy</Tag> : null}
          {dayjs(r.effectiveFrom).isAfter(now) ? <Tag>kelgusi</Tag> : null}
        </Flex>
      ),
    },
    { title: 'Stavka / foiz', key: 'rate', align: 'right', className: 'num', render: (_: unknown, r) => rateText(r) },
    { title: 'Kuchga kirgan', dataIndex: 'effectiveFrom', key: 'effectiveFrom', render: (v: string) => fmtDate(v) },
    { title: 'Kiritilgan', dataIndex: 'createdAt', key: 'createdAt', render: (v: string) => fmtDateTime(v) },
  ];

  const txCols: TableColumnsType<DetailBonusTx> = [
    { title: 'Sana', dataIndex: 'at', key: 'at', width: 140, render: (v: string) => fmtDateTime(v) },
    {
      title: 'Turi',
      dataIndex: 'type',
      key: 'type',
      width: 150,
      render: (v: BonusTransactionType) => <StatusChip meta={BONUS_TX[v]} />,
    },
    {
      title: 'Asos',
      key: 'base',
      render: (_: unknown, r) => {
        const parts = [
          r.baseM3 ? fmtM3(r.baseM3) : null,
          r.baseAmount ? `${fmtMoney(r.baseAmount)} so'm` : null,
        ].filter(Boolean);
        return parts.length ? <span className="num">{parts.join(' · ')}</span> : '—';
      },
    },
    {
      title: 'Hujjat',
      key: 'doc',
      width: 130,
      render: (_: unknown, r) =>
        r.order?.orderNo ? (
          r.order.id ? <Link to={`/orders/${r.order.id}`}>{r.order.orderNo}</Link> : <span>{r.order.orderNo}</span>
        ) : (
          '—'
        ),
    },
    {
      title: "Summa (so'm)",
      dataIndex: 'amount',
      key: 'amount',
      align: 'right',
      width: 150,
      render: (v: Money) => <MoneyCell value={v} signed />,
    },
    { title: 'Izoh', dataIndex: 'note', key: 'note', ellipsis: true, render: (v: string | null) => v || '—' },
  ];

  const cur = program.current;

  return (
    <Flex vertical gap={16}>
      {/* Joriy dastur */}
      <div style={{ padding: 16, borderRadius: token.borderRadiusLG, border: `1px solid ${token.colorBorderSecondary}` }}>
        <Flex align="flex-start" justify="space-between" gap={12} wrap>
          <div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Joriy dastur
            </Typography.Text>
            {programError ? (
              <ErrorState error={programError} onRetry={onRetryProgram} message="Bonus dasturini yuklab bo'lmadi" />
            ) : programLoading && !cur ? (
              <Skeleton active paragraph={{ rows: 1 }} title={{ width: 180 }} />
            ) : (
              <div style={{ marginTop: 4 }}>
                <div style={{ fontSize: 18, fontWeight: 650 }}>
                  {cur ? BONUS_KIND_LABEL[cur.kind] : "Bonus dasturi belgilanmagan"}
                </div>
                {cur && cur.kind !== 'NONE' ? (
                  <div className="num" style={{ marginTop: 2 }}>
                    {cur.kind === 'PER_M3' ? `${fmtMoney(cur.ratePerM3)} so'm/m³` : `${fmtNum(cur.percent, 2)} %`} ·{' '}
                    <Typography.Text type="secondary">Kuchga kirgan: {fmtDate(cur.effectiveFrom)}</Typography.Text>
                  </div>
                ) : null}
              </div>
            )}
          </div>
          {canManage ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={onNewProgram}>
              Yangi dastur
            </Button>
          ) : null}
        </Flex>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}>
          PERCENT asosi — faqat blok tannarxi, paddon puli hisobga kirmaydi.
        </Typography.Paragraph>
      </div>

      {/* Dastur tarixi */}
      <div>
        <Typography.Text strong>Dastur tarixi</Typography.Text>
        <Table<BonusProgramRow>
          rowKey="id"
          size="small"
          columns={historyCols}
          dataSource={program.history}
          loading={programLoading}
          pagination={false}
          scroll={{ x: 560 }}
          style={{ marginTop: 8 }}
        />
      </div>

      {/* Bonus harakatlari */}
      <div>
        <Flex align="center" justify="space-between">
          <Typography.Text strong>Bonus harakatlari</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            oxirgi 50
          </Typography.Text>
        </Flex>
        {transactions.length === 0 ? (
          <EmptyState message="Hali bonus harakati yo'q" />
        ) : (
          <Table<DetailBonusTx>
            rowKey="id"
            size="small"
            columns={txCols}
            dataSource={transactions}
            pagination={{ pageSize: 10, hideOnSinglePage: true }}
            scroll={{ x: 760 }}
            style={{ marginTop: 8 }}
          />
        )}
        <div style={{ marginTop: 8 }}>
          <Link to={`/bonus?factoryId=${factoryId}`}>
            To'liq jurnal <RightOutlined style={{ fontSize: 11, color: token.colorTextTertiary }} />
          </Link>
        </div>
      </div>
    </Flex>
  );
}

// ═══════════════════════════ Paddonlar tab ═══════════════════════════

function PalletsTab({
  factoryId,
  balance,
  transactions,
  canReturn,
  onReturn,
}: {
  factoryId: string;
  balance?: number;
  transactions: DetailPalletTx[];
  canReturn: boolean;
  onReturn: () => void;
}) {
  const { token } = theme.useToken();
  const reversedIds = useMemo(() => new Set(transactions.filter((t) => t.reversalOfId).map((t) => t.reversalOfId!)), [transactions]);

  const cols: TableColumnsType<DetailPalletTx> = [
    { title: 'Sana', dataIndex: 'date', key: 'date', width: 108, render: (v: string) => fmtDate(v) },
    {
      title: 'Turi',
      dataIndex: 'type',
      key: 'type',
      width: 180,
      render: (v: string) => (PALLET_TX[v as keyof typeof PALLET_TX] ? <StatusChip meta={PALLET_TX[v as keyof typeof PALLET_TX]} /> : v),
    },
    { title: 'Soni (dona)', dataIndex: 'qty', key: 'qty', align: 'right', className: 'num', width: 100, render: (v: number) => fmtNum(v) },
    {
      title: 'Narx (dona)',
      dataIndex: 'unitPrice',
      key: 'unitPrice',
      align: 'right',
      width: 130,
      render: (v: string | null) => (v ? <MoneyCell value={v} variant="neutral" /> : '—'),
    },
    {
      title: 'Jami',
      key: 'jami',
      align: 'right',
      width: 170,
      render: (_: unknown, r) => {
        if (!r.unitPrice || r.type !== 'RETURNED_TO_FACTORY') return '—';
        const jami = r.qty * num(r.unitPrice);
        return (
          <Flex vertical align="flex-end" gap={0}>
            <MoneyCell value={jami} variant="neutral" />
            <Typography.Text style={{ fontSize: 11, color: token.colorSuccess }} className="num">
              hisobga +{fmtMoney(jami)}
            </Typography.Text>
          </Flex>
        );
      },
    },
    { title: 'Izoh', dataIndex: 'note', key: 'note', ellipsis: true, render: (v: string | null) => v || '—' },
  ];

  return (
    <Flex vertical gap={12}>
      <Flex align="center" justify="space-between" gap={12} wrap>
        <Flex align="center" gap={8}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Zavod oldida hisobdorlik:
          </Typography.Text>
          {balance != null ? <PalletChip pallets={balance} /> : <Typography.Text type="secondary">—</Typography.Text>}
        </Flex>
        {canReturn ? <Button onClick={onReturn}>Paddon qaytarish</Button> : null}
      </Flex>
      {transactions.length === 0 ? (
        <EmptyState message="Paddon harakati hali yo'q" />
      ) : (
        <Table<DetailPalletTx>
          rowKey="id"
          size="small"
          columns={cols}
          dataSource={transactions}
          pagination={{ pageSize: 20, hideOnSinglePage: true }}
          scroll={{ x: 820 }}
          rowClassName={(r) => (r.type === 'REVERSAL' || reversedIds.has(r.id) ? 'ghost-row' : '')}
        />
      )}
      <div>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          oxirgi 50 ·{' '}
        </Typography.Text>
        <Link to={`/pallets?factoryId=${factoryId}`}>
          To'liq harakatlar <RightOutlined style={{ fontSize: 11 }} />
        </Link>
      </div>
    </Flex>
  );
}

// ═══════════════════════════ Taqsimlash chooser ═══════════════════════════

function ChooserRemainder({ payment }: { payment: Payment }) {
  const q = useQuery({
    queryKey: ['payments', payment.id],
    queryFn: () => endpoints.payment(payment.id),
    staleTime: 30_000,
  });
  if (q.isLoading) return <Spin size="small" />;
  const remainder = Math.max(0, num(payment.amount) - allocatedSum(q.data));
  return (
    <span className="num" style={{ fontWeight: 600 }}>
      qoldiq {fmtMoney(remainder)} so'm
    </span>
  );
}

function SettleChooserModal({
  open,
  onClose,
  payments,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  payments: Payment[];
  onPick: (paymentId: string) => void;
}) {
  const { token } = theme.useToken();
  return (
    <Modal open={open} onCancel={onClose} title="Taqsimlanmagan to'lovlar" footer={null} destroyOnHidden width={480}>
      {payments.length === 0 ? (
        <Empty description="Taqsimlanmagan to'lov yo'q" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            oxirgi 50 to'lov
          </Typography.Text>
          <Flex vertical gap={6} style={{ marginTop: 8 }}>
            {payments.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onPick(p.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: '10px 12px',
                  borderRadius: token.borderRadius,
                  border: `1px solid ${token.colorBorderSecondary}`,
                  background: token.colorBgContainer,
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span>
                  <span style={{ color: token.colorTextSecondary }}>{fmtDate(p.date)}</span> ·{' '}
                  <span className="num" style={{ fontWeight: 600 }}>
                    {fmtMoney(p.amount)} so'm
                  </span>{' '}
                  <Typography.Text type="secondary">{PAYMENT_METHOD[p.method]?.label ?? p.method}</Typography.Text>
                </span>
                <ChooserRemainder payment={p} />
              </button>
            ))}
          </Flex>
        </>
      )}
    </Modal>
  );
}

// ═══════════════════════════ Bonusdan yopish (offset / withdraw) ═══════════════════════════

function BonusFlowModal({
  open,
  onClose,
  factoryId,
  walletBalance,
}: {
  open: boolean;
  onClose: () => void;
  factoryId: string;
  walletBalance: Money;
}) {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [mode, setMode] = useState<'choose' | 'offset' | 'withdraw'>('choose');
  const [amount, setAmount] = useState('');
  const [cashboxId, setCashboxId] = useState<string | undefined>();
  const [date, setDate] = useState(dayjs());
  const [note, setNote] = useState('');
  const [err, setErr] = useState<unknown>(null);

  useEffect(() => {
    if (open) {
      setMode('choose');
      setAmount('');
      setCashboxId(undefined);
      setDate(dayjs());
      setNote('');
      setErr(null);
      // stale-wallet law: refetch the wallet on open
      qc.invalidateQueries({ queryKey: ['factories', factoryId] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const wallet = num(walletBalance);
  const entered = num(amount);
  const remaining = wallet - entered;

  const invalidate = () => {
    for (const k of ['factories', 'bonus', 'kassa', 'payments', 'debts', 'dashboard']) qc.invalidateQueries({ queryKey: [k] });
  };

  const offsetMut = useMutation({
    mutationFn: () => endpoints.bonusOffset({ factoryId, amount, date: date.format('YYYY-MM-DD'), note: note.trim() || undefined }),
    onSuccess: () => {
      message.success("Bonus zavod qarziga o'tkazildi");
      invalidate();
      onClose();
    },
    onError: (e) => setErr(e),
  });
  const withdrawMut = useMutation({
    mutationFn: () =>
      endpoints.bonusWithdraw({ factoryId, amount, cashboxId, date: date.format('YYYY-MM-DD'), note: note.trim() || undefined }),
    onSuccess: () => {
      message.success('Bonus naqd yechildi');
      invalidate();
      onClose();
    },
    onError: (e) => setErr(e),
  });

  const busy = offsetMut.isPending || withdrawMut.isPending;
  const canSubmit = entered >= 1 && entered <= wallet && (mode !== 'withdraw' || !!cashboxId) && !busy;
  const submit = () => {
    if (!canSubmit) return;
    setErr(null);
    if (mode === 'offset') offsetMut.mutate();
    else if (mode === 'withdraw') withdrawMut.mutate();
  };

  const choose = (
    <Flex vertical gap={10}>
      <Typography.Text type="secondary">
        Hamyonda: <span className="num" style={{ fontWeight: 600, color: token.colorText }}>{fmtMoney(walletBalance)} so'm</span>
      </Typography.Text>
      <Button size="large" block onClick={() => setMode('offset')}>
        Zavod qarziga o'tkazish
      </Button>
      <Button size="large" block onClick={() => setMode('withdraw')}>
        Naqd yechish
      </Button>
    </Flex>
  );

  const form = (
    <div
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          submit();
        }
      }}
    >
      <Flex vertical gap={14}>
        <Typography.Text type="secondary">
          Hamyonda: <span className="num" style={{ fontWeight: 600, color: token.colorText }}>{fmtMoney(walletBalance)} so'm</span>
        </Typography.Text>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Summa</div>
          <MoneyInput value={amount} onChange={setAmount} max={wallet} min={1} maxLabel={`Hamyonda: ${fmtMoney(walletBalance)} so'm`} />
          {entered > 0 ? (
            <Typography.Text type={remaining < 0 ? 'danger' : 'secondary'} style={{ fontSize: 12 }}>
              Qoladi: <span className="num">{fmtMoney(Math.max(0, remaining))} so'm</span>
            </Typography.Text>
          ) : null}
        </div>
        {mode === 'withdraw' ? (
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Kassa (faqat UZS)</div>
            <CashboxSelect value={cashboxId} currency="UZS" onChange={setCashboxId} />
          </div>
        ) : null}
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Sana</div>
          <DatePicker value={date} onChange={(d) => setDate(d ?? dayjs())} format="DD.MM.YYYY" allowClear={false} style={{ width: '100%' }} />
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Izoh</div>
          <Input.TextArea rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Izoh (ixtiyoriy)" />
        </div>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {mode === 'offset'
            ? "BONUS usulidagi zavod to'lovi yaratiladi — kassadan o'tmaydi."
            : 'Naqd kassaga kirim yoziladi.'}
        </Typography.Text>
        {err ? (
          <Typography.Text type="danger" style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>
            {apiError(err)}
          </Typography.Text>
        ) : null}
      </Flex>
    </div>
  );

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={mode === 'withdraw' ? 'Bonusni naqd yechish' : mode === 'offset' ? "Bonusni zavod qarziga o'tkazish" : 'Bonusdan yopish'}
      destroyOnHidden
      width={460}
      footer={
        mode === 'choose'
          ? null
          : [
              <Button key="back" onClick={() => setMode('choose')} disabled={busy}>
                Orqaga
              </Button>,
              <Button key="ok" type="primary" onClick={submit} disabled={!canSubmit} loading={busy}>
                {mode === 'offset' ? "O'tkazish" : 'Yechish'}
              </Button>,
            ]
      }
    >
      {mode === 'choose' ? choose : form}
    </Modal>
  );
}

// ═══════════════════════════ Paddon qaytarish ═══════════════════════════

function PalletReturnModal({
  open,
  onClose,
  factoryId,
  factoryName,
  heldNow,
}: {
  open: boolean;
  onClose: () => void;
  factoryId: string;
  factoryName: string;
  heldNow?: number;
}) {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [qty, setQty] = useState<number | null>(null);
  const [unitPrice, setUnitPrice] = useState('');
  const [date, setDate] = useState(dayjs());
  const [note, setNote] = useState('');
  const [err, setErr] = useState<unknown>(null);

  const settingsQ = useQuery({
    queryKey: ['settings'],
    queryFn: () => endpoints.settings(),
    enabled: open,
    staleTime: 5 * 60_000,
  });
  const defaultPrice = useMemo(() => {
    const v = settingsQ.data?.palletPriceDefault;
    return v == null ? PALLET_PRICE_FALLBACK : num(v as number);
  }, [settingsQ.data]);

  useEffect(() => {
    if (open) {
      setQty(null);
      setUnitPrice(String(defaultPrice));
      setDate(dayjs());
      setNote('');
      setErr(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultPrice]);

  const mut = useMutation({
    mutationFn: () =>
      endpoints.palletFactoryReturn({
        factoryId,
        qty,
        unitPrice: unitPrice || undefined,
        date: date.format('YYYY-MM-DD'),
        note: note.trim() || undefined,
      }),
    onSuccess: () => {
      message.success('Paddon zavodga qaytarildi');
      for (const k of ['pallets', 'factories', 'debts', 'dashboard']) qc.invalidateQueries({ queryKey: [k] });
      onClose();
    },
    onError: (e) => setErr(e),
  });

  const credit = (qty ?? 0) * num(unitPrice);
  const priceDeviates = num(unitPrice) !== defaultPrice;
  const canSubmit = !!qty && qty >= 1 && num(unitPrice) >= 1 && !mut.isPending;

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title="Zavodga paddon qaytarish"
      destroyOnHidden
      width={460}
      okText="Qaytarish"
      cancelText="Orqaga"
      okButtonProps={{ disabled: !canSubmit, loading: mut.isPending }}
      onOk={() => canSubmit && mut.mutate()}
    >
      <div
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && canSubmit) mut.mutate();
        }}
      >
        <Flex vertical gap={14}>
          <Flex
            align="center"
            justify="space-between"
            style={{ padding: '6px 10px', borderRadius: token.borderRadius, background: token.colorFillTertiary }}
          >
            <Typography.Text strong ellipsis>
              {factoryName}
            </Typography.Text>
            {heldNow != null ? <PalletChip pallets={heldNow} compact /> : null}
          </Flex>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Soni (dona)</div>
            <Input
              type="number"
              min={1}
              value={qty ?? ''}
              onChange={(e) => setQty(e.target.value ? Math.max(0, Math.floor(Number(e.target.value))) : null)}
              placeholder="0"
            />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Dona narxi</div>
            <MoneyInput value={unitPrice} onChange={setUnitPrice} min={1} />
            {priceDeviates ? (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                standart: {fmtMoney(defaultPrice)} so'm
              </Typography.Text>
            ) : null}
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Sana</div>
            <DatePicker value={date} onChange={(d) => setDate(d ?? dayjs())} format="DD.MM.YYYY" allowClear={false} style={{ width: '100%' }} />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Izoh</div>
            <Input.TextArea rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Izoh (ixtiyoriy)" />
          </div>
          {heldNow != null && qty ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Hisobdorlik: <span className="num">{fmtNum(heldNow)}</span> →{' '}
              <span className="num">{fmtNum(heldNow - qty)}</span> dona
            </Typography.Text>
          ) : null}
          <LedgerImpactPreview
            facts={[{ tone: 'neutral', text: `Zavod hisobiga kredit: +${fmtMoney(credit)} so'm (taxminiy — server tasdiqlaydi)` }]}
          />
          {err ? (
            <Typography.Text type="danger" style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>
              {apiError(err)}
            </Typography.Text>
          ) : null}
        </Flex>
      </div>
    </Modal>
  );
}

// ═══════════════════════════ Yangi dastur drawer ═══════════════════════════

function ProgramDrawer({
  open,
  onClose,
  factoryId,
  history,
}: {
  open: boolean;
  onClose: () => void;
  factoryId: string;
  history: BonusProgramRow[];
}) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [kind, setKind] = useState<BonusProgramKind>('PER_M3');
  const [rate, setRate] = useState('');
  const [percent, setPercent] = useState<number | null>(null);
  const [effectiveFrom, setEffectiveFrom] = useState(dayjs());
  const [err, setErr] = useState<unknown>(null);

  useEffect(() => {
    if (open) {
      setKind('PER_M3');
      setRate('');
      setPercent(null);
      setEffectiveFrom(dayjs());
      setErr(null);
    }
  }, [open]);

  const collision = useMemo(
    () => history.some((p) => dayjs(p.effectiveFrom).format('YYYY-MM-DD') === effectiveFrom.format('YYYY-MM-DD')),
    [history, effectiveFrom],
  );

  const mut = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = { kind, effectiveFrom: effectiveFrom.format('YYYY-MM-DD') };
      if (kind === 'PER_M3') payload.ratePerM3 = rate;
      if (kind === 'PERCENT') payload.percent = percent;
      return endpoints.setBonusProgram(factoryId, payload);
    },
    onSuccess: () => {
      message.success("Yangi bonus dasturi o'rnatildi");
      qc.invalidateQueries({ queryKey: ['factories', factoryId] });
      qc.invalidateQueries({ queryKey: ['factories', factoryId, 'bonus-program'] });
      qc.invalidateQueries({ queryKey: ['bonus'] });
      onClose();
    },
    onError: (e) => setErr(e),
  });

  const valid =
    !collision &&
    (kind === 'NONE' ||
      (kind === 'PER_M3' && num(rate) >= 1) ||
      (kind === 'PERCENT' && percent != null && percent > 0 && percent <= 100));
  const submit = () => {
    if (!valid || mut.isPending) return;
    setErr(null);
    mut.mutate();
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Yangi bonus dasturi"
      width={480}
      destroyOnHidden
      footer={
        <Flex vertical gap={8}>
          <Button type="primary" block disabled={!valid} loading={mut.isPending} onClick={submit}>
            O'rnatish
          </Button>
          <Typography.Text type="secondary" style={{ fontSize: 12, textAlign: 'center' }}>
            Ctrl+Enter — o'rnatish
          </Typography.Text>
        </Flex>
      }
    >
      <div
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        }}
      >
        <Flex vertical gap={16}>
          <LedgerImpactPreview
            facts={[
              {
                tone: 'warning',
                text: 'Dastur versiyalanadi — yangi shart faqat shu sanadan keyin YAKUNLANGAN buyurtmalarga qo\'llanadi; eski hisob-kitoblar o\'zgarmaydi.',
              },
            ]}
          />
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Dastur turi</div>
            <Segmented
              block
              value={kind}
              onChange={(v) => setKind(v as BonusProgramKind)}
              options={[
                { value: 'PER_M3', label: 'Har m³' },
                { value: 'PERCENT', label: 'Foizli' },
                { value: 'NONE', label: "Bonus yo'q" },
              ]}
            />
          </div>
          {kind === 'PER_M3' ? (
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Stavka (so'm / m³)</div>
              <MoneyInput value={rate} onChange={setRate} min={1} placeholder="masalan 5 000" />
            </div>
          ) : null}
          {kind === 'PERCENT' ? (
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Foiz (%)</div>
              <Input
                type="number"
                min={0.01}
                max={100}
                step={0.1}
                value={percent ?? ''}
                onChange={(e) => setPercent(e.target.value ? Number(e.target.value) : null)}
                placeholder="masalan 1.5"
              />
            </div>
          ) : null}
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Kuchga kirish sanasi</div>
            <DatePicker
              value={effectiveFrom}
              onChange={(d) => setEffectiveFrom(d ?? dayjs())}
              format="DD.MM.YYYY"
              allowClear={false}
              style={{ width: '100%' }}
            />
            {collision ? (
              <Typography.Text type="danger" style={{ fontSize: 12 }}>
                Bu sana uchun dastur allaqachon kiritilgan — boshqa sanani tanlang.
              </Typography.Text>
            ) : null}
          </div>
          {err ? (
            <Typography.Text type="danger" style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>
              {apiError(err)}
            </Typography.Text>
          ) : null}
        </Flex>
      </div>
    </Drawer>
  );
}

// ═══════════════════════════ Tahrirlash drawer ═══════════════════════════

function EditDrawer({ open, onClose, factory }: { open: boolean; onClose: () => void; factory: FactoryDetailData }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [name, setName] = useState(factory.name);
  const [note, setNote] = useState(factory.note ?? '');
  const [active, setActive] = useState(factory.active);
  const [err, setErr] = useState<unknown>(null);

  useEffect(() => {
    if (open) {
      setName(factory.name);
      setNote(factory.note ?? '');
      setActive(factory.active);
      setErr(null);
    }
  }, [open, factory]);

  const mut = useMutation({
    mutationFn: () => endpoints.updateFactory(factory.id, { name: name.trim(), note: note.trim() || null, active }),
    onSuccess: () => {
      message.success('Zavod yangilandi');
      qc.invalidateQueries({ queryKey: ['factories'] });
      onClose();
    },
    onError: (e) => setErr(e),
  });

  const valid = name.trim().length > 0 && name.trim().length <= 200 && !mut.isPending;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Zavodni tahrirlash"
      width={480}
      destroyOnHidden
      footer={
        <Button type="primary" block disabled={!valid} loading={mut.isPending} onClick={() => valid && mut.mutate()}>
          Saqlash
        </Button>
      }
    >
      <Flex vertical gap={16}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Nomi</div>
          <Input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} placeholder="Zavod nomi" />
          {err ? (
            <Typography.Text type="danger" style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>
              {apiError(err)}
            </Typography.Text>
          ) : null}
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Izoh</div>
          <Input.TextArea rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Izoh (ixtiyoriy)" />
        </div>
        <Flex align="center" gap={8}>
          <Switch checked={active} onChange={setActive} />
          <Typography.Text>Faol</Typography.Text>
        </Flex>
      </Flex>
    </Drawer>
  );
}

// ═══════════════════════════ loading skeleton ═══════════════════════════

function HubSkeleton() {
  return (
    <div>
      <Skeleton.Input active size="small" style={{ width: 180, marginBottom: 12 }} />
      <Skeleton active title={{ width: 320 }} paragraph={{ rows: 2, width: ['60%', '40%'] }} />
      <div style={{ marginTop: 24 }}>
        <Skeleton active title={false} paragraph={{ rows: 6 }} />
      </div>
    </div>
  );
}
