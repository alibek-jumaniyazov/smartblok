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
  Dropdown,
  Empty,
  Flex,
  Input,
  Modal,
  Pagination,
  Segmented,
  Skeleton,
  Spin,
  Switch,
  Table,
  Tabs,
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
import dayjs, { type Dayjs } from 'dayjs';
import { apiError, endpoints } from '../lib/api';
import { fmtDate, fmtDateTime, fmtM3, fmtMoney, fmtNum, num } from '../lib/format';
import { useUrlFilters } from '../lib/useUrlFilters';
import { modalWidth, useIsDesktop, useIsPhone } from '../lib/responsive';
import { can } from '../lib/permissions';
import { useAuth } from '../auth/AuthContext';
import { useT } from '../components/LangContext';
import { BONUS_TX, COST_STATUS, PALLET_TX, PAYMENT_METHOD } from '../lib/status-maps';
import {
  CashboxSelect,
  DateRangeControl,
  EmptyState,
  ErrorState,
  FormDrawer,
  LedgerImpactPreview,
  MoneyCell,
  MoneyInput,
  PalletChip,
  PartyBalanceHeader,
  PartyStatement,
  TableCard,
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

/** Small uppercase section header shared by every tab card (senior polish). */
function Overline({ children }: { children: ReactNode }) {
  const { token } = theme.useToken();
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        color: token.colorTextTertiary,
      }}
    >
      {children}
    </div>
  );
}

/** Token-tinted state badge (replaces hand-coloured AntD Tags: joriy / kelgusi). */
function Pill({ tone, children }: { tone: 'success' | 'primary' | 'neutral'; children: ReactNode }) {
  const { token } = theme.useToken();
  const map = {
    success: { fg: token.colorSuccess, bg: token.colorSuccessBg, bd: token.colorSuccessBorder },
    primary: { fg: token.colorPrimary, bg: token.colorPrimaryBg, bd: token.colorPrimaryBorder },
    neutral: { fg: token.colorTextSecondary, bg: token.colorFillTertiary, bd: token.colorBorderSecondary },
  }[tone];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 20,
        padding: '0 8px',
        borderRadius: token.borderRadiusSM,
        fontSize: 11,
        fontWeight: 600,
        color: map.fg,
        background: map.bg,
        border: `1px solid ${map.bd}`,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

// ── MOBIL (mobile-responsive-spec §2.2): bu sahifadagi jadvallar xom AntD
// <Table> (DataTable emas — URL sahifalash bitta bo'lgani uchun uchta jadval
// bir-birini bosib qo'yardi). Shuning uchun telefonda karta ro'yxati QO'LDA
// quriladi, lekin DataTable bilan BIR XIL `.sb-mcard*` markupi/uslubi bilan.
// Desktopda (>= 992px) bu komponent umuman render bo'lmaydi. ─────────────────
interface MCard {
  key: string;
  title: ReactNode;
  subtitle?: ReactNode;
  /** yagona o'ngga tekislangan asosiy figura */
  value?: ReactNode;
  /** o'raladigan chip qatori */
  meta?: ReactNode;
  /** meta ostidagi to'liq kenglikdagi blok (masalan taqsimot indikatori) */
  extra?: ReactNode;
  /** label/value satrlari — label t() kaliti */
  lines?: { label: string; value: ReactNode }[];
  ghost?: boolean;
  onOpen?: () => void;
}

function MobileCards({ cards, pageSize }: { cards: MCard[]; pageSize?: number }) {
  const t = useT();
  // Sahifalash: almashtirilayotgan desktop jadvali sahifalansa (10 / 20 tadan),
  // telefon kartalari ham AYNAN shu qadam bilan sahifalanadi — aks holda
  // «oxirgi 50» bitta uzun ro'yxatga aylanadi. `pageSize` berilmasa — o'chiq.
  const [page, setPage] = useState(1);
  const pageCount = pageSize ? Math.max(1, Math.ceil(cards.length / pageSize)) : 1;
  // ma'lumot qisqarsa (refetch/filtr) joriy sahifa oralig'dan chiqib ketmasin
  const cur = Math.min(page, pageCount);
  const shown = pageSize ? cards.slice((cur - 1) * pageSize, cur * pageSize) : cards;
  return (
    <>
      <ul className="sb-mcards" style={{ padding: '10px 0 0' }}>
        {shown.map((c) => (
          <li
            key={c.key}
            className={['sb-mcard', c.onOpen ? 'sb-mcard--tappable' : '', c.ghost ? 'sb-mcard--ghost' : '']
              .filter(Boolean)
              .join(' ')}
            role={c.onOpen ? 'button' : undefined}
            tabIndex={c.onOpen ? 0 : undefined}
            onClick={
              c.onOpen
                ? (e) => {
                    // ichki havola / tugma o'z ishini qilsin
                    if ((e.target as HTMLElement).closest('a,button')) return;
                    c.onOpen?.();
                  }
                : undefined
            }
            onKeyDown={
              c.onOpen
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      c.onOpen?.();
                    }
                  }
                : undefined
            }
          >
            <div className="sb-mcard__body">
              <div className="sb-mcard__row">
                <div className="sb-mcard__head">
                  <div className="sb-mcard__title">{c.title}</div>
                  {c.subtitle ? <div className="sb-mcard__subtitle">{c.subtitle}</div> : null}
                </div>
                {c.value != null ? <div className="sb-mcard__value">{c.value}</div> : null}
              </div>
              {c.meta ? <div className="sb-mcard__meta">{c.meta}</div> : null}
              {c.extra ? <div style={{ minWidth: 0 }}>{c.extra}</div> : null}
              {c.lines && c.lines.length > 0 ? (
                <dl className="sb-mcard__lines">
                  {c.lines.map((l, i) => (
                    <div key={i} style={{ display: 'contents' }}>
                      <dt>{t(l.label)}</dt>
                      <dd>{l.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </div>
            {c.onOpen ? (
              <div className="sb-mcard__tail">
                <RightOutlined className="sb-mcard__chevron" aria-hidden />
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {pageSize && cards.length > pageSize ? (
        <div className="sb-mcards__pager">
          <Pagination
            simple
            size="small"
            current={cur}
            pageSize={pageSize}
            total={cards.length}
            showSizeChanger={false}
            onChange={(p) => setPage(p)}
          />
        </div>
      ) : null}
    </>
  );
}

export default function FactoryDetail() {
  const { id = '' } = useParams<{ id: string }>();
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const t = useT();
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const uf = useUrlFilters();
  const isPhone = useIsPhone();

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
      message.success(active ? t('Zavod faollashtirildi') : t('Zavod nofaol qilindi'));
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
          error={detailQ.error ?? new Error(t('Zavod topilmadi'))}
          message="Zavod topilmadi"
          onRetry={() => detailQ.refetch()}
        />
        <div style={{ textAlign: 'center', marginTop: 8 }}>
          <Link to="/factories">{t('Zavodlarga qaytish')}</Link>
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
        // telefonda uzun matn («Bonus dasturi: 5 000 so'm/m³ · 01.01.2026 dan»)
        // 320px ni yorib chiqmasin — o'ralsin va tegish maydoni 32px bo'lsin.
        // Desktop uslubi tegilmaydi.
        ...(isPhone
          ? {
              whiteSpace: 'normal' as const,
              flexWrap: 'wrap' as const,
              textAlign: 'left' as const,
              maxWidth: '100%',
              minHeight: 32,
              padding: '5px 8px',
            }
          : null),
      }}
    >
      {t('Bonus dasturi:')}
      <span style={{ fontWeight: 600, color: token.colorText }}>
        {!cur || cur.kind === 'NONE'
          ? t("yo'q")
          : cur.kind === 'PER_M3'
            ? t("{v} so'm/m³", { v: fmtMoney(cur.ratePerM3) })
            : `${fmtNum(cur.percent, 2)} %`}
      </span>
      {cur && cur.kind !== 'NONE' ? <span>· {t('{date} dan', { date: fmtDate(cur.effectiveFrom) })}</span> : null}
    </button>
  );

  const clickablePallet =
    palletsHeld != null && palletsHeld !== 0 ? (
      <span
        role="button"
        tabIndex={0}
        onClick={() => uf.set({ tab: 'paddonlar' })}
        onKeyDown={(e) => e.key === 'Enter' && uf.set({ tab: 'paddonlar' })}
        // teginishda `title` ko'rinmaydi — yorliq aria orqali ham beriladi (R13)
        aria-label={t('Paddon harakatlarini ochish')}
        title={t('Paddon harakatlarini ochish')}
        // desktop uslubi o'zgarmaydi — tegish maydoni faqat telefonda kattalashadi
        style={
          isPhone
            ? { cursor: 'pointer', display: 'inline-flex', alignItems: 'center', minHeight: 32 }
            : { cursor: 'pointer' }
        }
      >
        <PalletChip pallets={palletsHeld} />
      </span>
    ) : null;

  // ── quick actions on the balance hero (pre-scoped, cap-filtered) ──
  const quickActions: PartyHeaderAction[] = inactive
    ? [{ key: 'activate', label: t('Faollashtirish'), primary: true, cap: 'factories.manage', onClick: () => activateMut.mutate(true) }]
    : [
        { key: 'pay', label: t("To'lash"), primary: true, cap: 'payments.create', onClick: openPay },
        {
          key: 'settle',
          label: t('Taqsimlash'),
          cap: 'payments.allocate',
          disabled: factoryPayments.length === 0,
          onClick: onTaqsimlash,
        },
        {
          key: 'bonus',
          label: t('Bonusdan yopish'),
          cap: 'bonus.offset',
          disabled: walletEmpty,
          onClick: () => setBonusOpen(true),
        },
        { key: 'pallet', label: t('Paddon qaytarish'), cap: 'pallets.mutate', onClick: () => setPalletOpen(true) },
      ];

  // ── record-management overflow kebab ──
  const kebabItems = [
    can(user?.role, 'factories.manage') && !inactive
      ? { key: 'edit', icon: <EditOutlined />, label: t('Tahrirlash'), onClick: () => setEditOpen(true) }
      : null,
    { key: 'akt', icon: <PrinterOutlined />, label: t('Akt sverki'), onClick: openAktSverki },
    can(user?.role, 'factories.manage')
      ? inactive
        ? { key: 'activate', label: t('Faollashtirish'), onClick: () => activateMut.mutate(true) }
        : { key: 'deact', icon: <StopOutlined />, danger: true, label: t('Nofaol qilish'), onClick: () => setDeactOpen(true) }
      : null,
  ].filter(Boolean) as { key: string; icon?: ReactNode; danger?: boolean; label: string; onClick: () => void }[];

  return (
    <div>
      {/* top strip: brand accent + breadcrumb + overflow kebab */}
      <Flex align="center" justify="space-between" gap={8} style={{ marginBottom: 4 }}>
        <Flex align="center" gap={10} style={{ minWidth: 0 }}>
          <span
            aria-hidden
            style={{ width: 4, height: 16, borderRadius: 4, background: 'linear-gradient(180deg, #3b82f6, #1d4ed8)', flex: '0 0 auto' }}
          />
          <Breadcrumb
            items={[{ title: <Link to="/factories">{t('Zavodlar')}</Link> }, { title: detail.name }]}
            style={{ fontSize: 12 }}
          />
        </Flex>
        {kebabItems.length > 0 ? (
          <Dropdown
            trigger={['click']}
            menu={{
              items: kebabItems.map((k) => ({ key: k.key, icon: k.icon, danger: k.danger, label: k.label, onClick: k.onClick })),
            }}
          >
            <Button icon={<MoreOutlined />} aria-label={t('{name} amallari', { name: detail.name })} />
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

      {/* tabs (gold-standard AntD Tabs, sits below the hero + strip) */}
      <Tabs
        activeKey={tab}
        onChange={(k) => uf.set({ tab: k })}
        // telefonda 4 ta yorliq 320px ga sig'maydi — zichroq nav + surish
        {...(isPhone ? { size: 'small' as const, tabBarGutter: 12 } : {})}
        items={[
          {
            key: 'hisob',
            label: t('Hisob-kitob'),
            children:
              tab === 'hisob' ? (
                <div>
                  <Flex align="center" justify="space-between" gap={12} wrap style={{ marginBottom: 12 }}>
                    <DateRangeControl from={from} to={to} onChange={(r) => uf.set({ from: r.from ?? null, to: r.to ?? null })} />
                    <Button icon={<PrinterOutlined />} onClick={openAktSverki} block={isPhone}>
                      {t('Akt sverki')}
                    </Button>
                  </Flex>
                  <TableCard>
                    <PartyStatement partyType="factory" partyId={id} from={from} to={to} />
                  </TableCard>
                </div>
              ) : null,
          },
          {
            key: 'tolovlar',
            label: t("To'lovlar"),
            children:
              tab === 'tolovlar' ? (
                <PaymentsTab factoryId={id} payments={detail.payments ?? []} loading={detailQ.isFetching} />
              ) : null,
          },
          {
            key: 'bonus',
            label: t('Bonus dasturi'),
            children:
              tab === 'bonus' ? (
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
              ) : null,
          },
          {
            key: 'paddonlar',
            label: t('Paddonlar'),
            children:
              tab === 'paddonlar' ? (
                <PalletsTab
                  factoryId={id}
                  balance={palletsHeld}
                  transactions={detail.palletTransactions ?? []}
                  canReturn={can(user?.role, 'pallets.mutate') && !inactive}
                  onReturn={() => setPalletOpen(true)}
                />
              ) : null,
          },
        ]}
      />

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
        inHand={palletsQ.data?.dealerInHand}
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
        title={t('Zavodni nofaol qilish')}
        okText={t('Nofaol qilish')}
        cancelText={t('Orqaga')}
        okButtonProps={{ danger: true, loading: activateMut.isPending }}
        onOk={() => activateMut.mutate(false)}
        onCancel={() => setDeactOpen(false)}
        destroyOnHidden
        // telefonda markazda — futer (Nofaol qilish / Orqaga) doim ko'rinib tursin
        centered={isPhone}
      >
        <Typography.Text>
          {t('«{name}» nofaol qilinadi. Tarix saqlanadi — hech narsa o\'chirilmaydi.', { name: detail.name })}
        </Typography.Text>
      </Modal>

      {/* payment peek (§9 — statement/table payment links round-trip here) */}
      <PaymentPeek paymentId={peekId} open={!!peekId} onClose={() => uf.set({ peek: null })} />
    </div>
  );
}

// ═══════════════════════════ Ochiq buyurtmalar strip ═══════════════════════════

function OpenOrdersStrip({ factoryId }: { factoryId: string }) {
  const { token } = theme.useToken();
  const t = useT();
  const isPhone = useIsPhone();
  // date-to-date window (default: last 90 days) — no quick-window presets
  const [range, setRange] = useState<[Dayjs, Dayjs]>(() => [dayjs().subtract(89, 'day'), dayjs()]);
  const dateFrom = range[0].format('YYYY-MM-DD');
  const dateTo = range[1].format('YYYY-MM-DD');

  const q = useQuery({
    queryKey: ['orders', 'factory-open', factoryId, dateFrom, dateTo],
    queryFn: () => endpoints.orders({ factoryId, dateFrom, dateTo, pageSize: 200 }),
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

  // Telefonda xom RangePicker ikkita oylik panelni ustma-ust chiqaradi (~560px+):
  // 320x568 ekranda IKKINCHI sana (tugash) ochilmaning pastidan chiqib ketadi va
  // umuman tanlanmaydi. DateRangeControl aynan shu uchun bor — telefonda bitta
  // panelli ikkita DatePicker'ga bo'linadi. Desktop (>= 992px) xom RangePicker
  // bilan o'zgarishsiz qoladi.
  const windowChips = isPhone ? (
    <div style={{ flex: '1 1 100%', minWidth: 0 }}>
      <DateRangeControl
        from={dateFrom}
        to={dateTo}
        onChange={(r) => {
          // to'liq bo'lmagan juftlik e'tiborga olinmaydi — `allowClear={false}`
          // bilan bir xil xulq (davr hech qachon bo'sh qolmaydi)
          if (r.from && r.to) setRange([dayjs(r.from), dayjs(r.to)]);
        }}
      />
    </div>
  ) : (
    <DatePicker.RangePicker
      size="small"
      value={range}
      allowClear={false}
      format="DD.MM.YYYY"
      onChange={(v) => {
        if (v && v[0] && v[1]) setRange([v[0], v[1]]);
      }}
      style={{ minWidth: 0 }}
    />
  );

  const clean = open.length === 0;

  return (
    <div
      style={{
        marginTop: 12,
        padding: isPhone ? '10px 12px' : '10px 14px',
        borderRadius: token.borderRadiusLG,
        border: `1px solid ${clean ? token.colorBorderSecondary : token.colorWarningBorder}`,
        borderLeft: `3px solid ${clean ? token.colorSuccess : token.colorWarning}`,
        background: clean ? token.colorFillQuaternary : token.colorWarningBg,
      }}
    >
      <Flex align="center" justify="space-between" gap={12} wrap>
        <Flex align="center" gap={10} wrap style={{ minWidth: 0, flex: '1 1 auto' }}>
          {q.isLoading ? (
            <Typography.Text type="secondary">{t('Ochiq buyurtmalar yuklanmoqda…')}</Typography.Text>
          ) : q.error ? (
            <Typography.Text type="danger">{apiError(q.error)}</Typography.Text>
          ) : clean ? (
            <Typography.Text style={{ color: token.colorSuccess }}>
              <CheckCircleFilled style={{ marginInlineEnd: 6 }} />
              {t('Barcha tannarxlar qotirilgan')}
            </Typography.Text>
          ) : (
            <>
              <WarningFilled style={{ color: token.colorWarning }} />
              <Typography.Text>
                <b>{open.length} {t('ta')}</b> {t('buyurtma tannarxi qotirilmagan — jami')}{' '}
                <span className="num" style={{ fontWeight: 600 }}>
                  {fmtMoney(sum)} {t("so'm")}
                </span>{' '}
                <Typography.Text type="secondary">{t('(taxminiy)')}</Typography.Text>
              </Typography.Text>
              {prov > 0 ? <StatusChip meta={COST_STATUS.PROVISIONAL} /> : null}
              {prov > 0 ? <span className="num" style={{ color: token.colorTextSecondary }}>{prov}</span> : null}
              {partial > 0 ? <StatusChip meta={COST_STATUS.PARTIAL} /> : null}
              {partial > 0 ? <span className="num" style={{ color: token.colorTextSecondary }}>{partial}</span> : null}
            </>
          )}
        </Flex>
        <Flex
          align="center"
          gap={10}
          wrap
          justify={isPhone ? 'space-between' : undefined}
          style={{ minWidth: 0, ...(isPhone ? { flex: '1 1 100%' } : null) }}
        >
          {windowChips}
          {!clean ? (
            <Link to={`/orders?factoryId=${factoryId}&chip=cost-open`}>
              {t('Hammasi')} <RightOutlined style={{ fontSize: 11 }} />
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
  const t = useT();
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
        {done ? t("To'liq taqsimlangan") : `${t('Qoldiq')} ${fmtMoney(remainder)}`}
      </span>
    </div>
  );
}

function PaymentsTab({ factoryId, payments, loading }: { factoryId: string; payments: DetailPayment[]; loading: boolean }) {
  const { token } = theme.useToken();
  const t = useT();
  const uf = useUrlFilters();
  const isPhone = useIsPhone();
  const isDesktop = useIsDesktop();

  const cols: TableColumnsType<DetailPayment> = [
    { title: t('Sana'), dataIndex: 'date', key: 'date', width: 108, render: (v: string) => fmtDate(v) },
    {
      title: t('Usul'),
      dataIndex: 'method',
      key: 'method',
      width: 110,
      render: (v: PaymentMethod) => PAYMENT_METHOD[v]?.label ?? v,
    },
    {
      title: t("Summa (so'm)"),
      dataIndex: 'amount',
      key: 'amount',
      align: 'right',
      width: 150,
      render: (v: Money) => <MoneyCell value={v} strong />,
    },
    { title: t('Kassa'), key: 'cashbox', width: 140, ellipsis: true, render: (_: unknown, r) => r.cashbox?.name ?? '—' },
    {
      title: t('Taqsimot'),
      key: 'alloc',
      width: 160,
      render: (_: unknown, r) => <PaymentAllocBar paymentId={r.id} amount={r.amount} />,
    },
    { title: t('Izoh'), dataIndex: 'note', key: 'note', ellipsis: true, render: (v: string | null) => v || '—' },
  ];

  if (payments.length === 0) {
    return <EmptyState message="Bu zavodga hali to'lov yo'q" />;
  }

  return (
    <div className="dash-card" style={{ padding: isPhone ? 12 : 16 }}>
      <Flex align="baseline" justify="space-between" gap={8} wrap style={{ marginBottom: 10 }}>
        <Overline>{t("To'lovlar tarixi")}</Overline>
        <span style={{ fontSize: 12, color: token.colorTextTertiary }}>{t('oxirgi 50 · bekor qilinganlarsiz')}</span>
      </Flex>
      {isPhone ? (
        // telefon: karta ro'yxati (§2.2) — 6 ustunli jadval 320px da o'qilmaydi
        <Spin spinning={loading}>
          {/* desktopdagi kabi 20 tadan: har karta o'z taqsimot so'rovini
              yuboradi, 50 tasini birdan ochish telefonda ortiqcha */}
          <MobileCards
            pageSize={20}
            cards={payments.map((r) => ({
              key: r.id,
              title: fmtDate(r.date),
              subtitle: PAYMENT_METHOD[r.method]?.label ?? r.method,
              value: <MoneyCell value={r.amount} strong />,
              meta: r.cashbox?.name ? <span className="sb-mcard__chip">{r.cashbox.name}</span> : undefined,
              extra: <PaymentAllocBar paymentId={r.id} amount={r.amount} />,
              lines: r.note ? [{ label: 'Izoh', value: r.note }] : undefined,
              onOpen: () => uf.set({ peek: r.id }),
            }))}
          />
        </Spin>
      ) : (
        <Table<DetailPayment>
          rowKey="id"
          size="small"
          columns={cols}
          dataSource={payments}
          loading={loading}
          pagination={{ pageSize: 20, hideOnSinglePage: true }}
          // `ellipsis` ustunlari bor (Kassa / Izoh) → rc-table `table-layout: fixed`
          // ni tanlaydi: 'max-content' desktopda jadvalni mazmun eniga cho'zib,
          // gorizontal skroll chiqaradi va «Izoh» qisqarmay qoladi. Desktop
          // (>= 992px) eski 760px polida qoladi, tor ekran esa cho'ziladi.
          scroll={isDesktop ? { x: 760 } : { x: 'max-content' }}
          onRow={(r) => ({
            onClick: () => uf.set({ peek: r.id }),
            style: { cursor: 'pointer' },
          })}
        />
      )}
      <div style={{ marginTop: 12 }}>
        <Link to={`/payments?kind=FACTORY_OUT&factoryId=${factoryId}`}>
          {t("Hammasini ko'rish")} <RightOutlined style={{ fontSize: 11, color: token.colorTextTertiary }} />
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
  const t = useT();
  const isPhone = useIsPhone();
  const isDesktop = useIsDesktop();
  const now = dayjs();

  const rateText = (p: BonusProgramRow) =>
    p.kind === 'PER_M3'
      ? t("{v} so'm/m³", { v: fmtMoney(p.ratePerM3) })
      : p.kind === 'PERCENT'
        ? `${fmtNum(p.percent, 2)} %`
        : '—';

  const historyCols: TableColumnsType<BonusProgramRow> = [
    {
      title: t('Turi'),
      dataIndex: 'kind',
      key: 'kind',
      render: (v: BonusProgramKind, r) => (
        <Flex align="center" gap={6}>
          {t(BONUS_KIND_LABEL[v])}
          {r.id === program.current?.id ? <Pill tone="success">{t('joriy')}</Pill> : null}
          {dayjs(r.effectiveFrom).isAfter(now) ? <Pill tone="primary">{t('kelgusi')}</Pill> : null}
        </Flex>
      ),
    },
    { title: t('Stavka / foiz'), key: 'rate', align: 'right', className: 'num', render: (_: unknown, r) => rateText(r) },
    { title: t('Kuchga kirgan'), dataIndex: 'effectiveFrom', key: 'effectiveFrom', render: (v: string) => fmtDate(v) },
    { title: t('Kiritilgan'), dataIndex: 'createdAt', key: 'createdAt', render: (v: string) => fmtDateTime(v) },
  ];

  const txCols: TableColumnsType<DetailBonusTx> = [
    { title: t('Sana'), dataIndex: 'at', key: 'at', width: 140, render: (v: string) => fmtDateTime(v) },
    {
      title: t('Turi'),
      dataIndex: 'type',
      key: 'type',
      width: 150,
      render: (v: BonusTransactionType) => <StatusChip meta={BONUS_TX[v]} />,
    },
    {
      title: t('Asos'),
      key: 'base',
      render: (_: unknown, r) => {
        const parts = [
          r.baseM3 ? fmtM3(r.baseM3) : null,
          r.baseAmount ? `${fmtMoney(r.baseAmount)} ${t("so'm")}` : null,
        ].filter(Boolean);
        return parts.length ? <span className="num">{parts.join(' · ')}</span> : '—';
      },
    },
    {
      title: t('Hujjat'),
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
      title: t("Summa (so'm)"),
      dataIndex: 'amount',
      key: 'amount',
      align: 'right',
      width: 150,
      render: (v: Money) => <MoneyCell value={v} signed />,
    },
    { title: t('Izoh'), dataIndex: 'note', key: 'note', ellipsis: true, render: (v: string | null) => v || '—' },
  ];

  const cur = program.current;

  return (
    <Flex vertical gap={20}>
      {/* Joriy dastur */}
      <div className="dash-card" style={{ padding: isPhone ? 12 : 16 }}>
        <Flex align="flex-start" justify="space-between" gap={12} wrap>
          <div style={{ minWidth: 0, flex: '1 1 auto' }}>
            <Overline>{t('Joriy dastur')}</Overline>
            {programError ? (
              <ErrorState error={programError} onRetry={onRetryProgram} message="Bonus dasturini yuklab bo'lmadi" />
            ) : programLoading && !cur ? (
              <Skeleton active paragraph={{ rows: 1 }} title={{ width: 180 }} />
            ) : (
              <div style={{ marginTop: 4 }}>
                <div style={{ fontSize: 18, fontWeight: 650 }}>
                  {cur ? t(BONUS_KIND_LABEL[cur.kind]) : t("Bonus dasturi belgilanmagan")}
                </div>
                {cur && cur.kind !== 'NONE' ? (
                  <div className="num" style={{ marginTop: 2 }}>
                    {cur.kind === 'PER_M3' ? t("{v} so'm/m³", { v: fmtMoney(cur.ratePerM3) }) : `${fmtNum(cur.percent, 2)} %`} ·{' '}
                    <Typography.Text type="secondary">{t('Kuchga kirgan')}: {fmtDate(cur.effectiveFrom)}</Typography.Text>
                  </div>
                ) : null}
              </div>
            )}
          </div>
          {canManage ? (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={onNewProgram}
              block={isPhone}
              style={isPhone ? { flex: '1 1 100%' } : undefined}
            >
              {t('Yangi dastur')}
            </Button>
          ) : null}
        </Flex>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}>
          {t('PERCENT asosi — faqat blok tannarxi, paddon puli hisobga kirmaydi.')}
        </Typography.Paragraph>
      </div>

      {/* Dastur tarixi */}
      <div className="dash-card" style={{ padding: isPhone ? 12 : 16 }}>
        <Overline>{t('Dastur tarixi')}</Overline>
        {isPhone ? (
          <Spin spinning={programLoading}>
            {program.history.length === 0 ? (
              <EmptyState message="Hozircha yozuv yo'q" />
            ) : (
              <MobileCards
                cards={program.history.map((r) => ({
                  key: r.id,
                  title: t(BONUS_KIND_LABEL[r.kind]),
                  value: <span className="num">{rateText(r)}</span>,
                  meta:
                    r.id === program.current?.id ? (
                      <Pill tone="success">{t('joriy')}</Pill>
                    ) : dayjs(r.effectiveFrom).isAfter(now) ? (
                      <Pill tone="primary">{t('kelgusi')}</Pill>
                    ) : undefined,
                  lines: [
                    { label: 'Kuchga kirgan', value: <span className="num">{fmtDate(r.effectiveFrom)}</span> },
                    { label: 'Kiritilgan', value: <span className="num">{fmtDateTime(r.createdAt)}</span> },
                  ],
                }))}
              />
            )}
          </Spin>
        ) : (
          <Table<BonusProgramRow>
            rowKey="id"
            size="small"
            columns={historyCols}
            dataSource={program.history}
            loading={programLoading}
            pagination={false}
            scroll={{ x: 'max-content' }}
            style={{ marginTop: 10 }}
          />
        )}
      </div>

      {/* Bonus harakatlari */}
      <div className="dash-card" style={{ padding: isPhone ? 12 : 16 }}>
        <Flex align="baseline" justify="space-between" gap={8} wrap style={{ marginBottom: 10 }}>
          <Overline>{t('Bonus harakatlari')}</Overline>
          <span style={{ fontSize: 12, color: token.colorTextTertiary }}>{t('oxirgi 50')}</span>
        </Flex>
        {transactions.length === 0 ? (
          <EmptyState message="Hali bonus harakati yo'q" />
        ) : isPhone ? (
          <MobileCards
            // desktop jadvali 10 tadan sahifalanadi — telefonda ham shunday
            pageSize={10}
            cards={transactions.map((r) => {
              const parts = [
                r.baseM3 ? fmtM3(r.baseM3) : null,
                r.baseAmount ? `${fmtMoney(r.baseAmount)} ${t("so'm")}` : null,
              ].filter(Boolean);
              const lines: { label: string; value: ReactNode }[] = [];
              // «Asos» faqat tooltipda emas — kartada ko'rinadigan satr (R12)
              if (parts.length) lines.push({ label: 'Asos', value: <span className="num">{parts.join(' · ')}</span> });
              if (r.note) lines.push({ label: 'Izoh', value: r.note });
              return {
                key: r.id,
                title: <StatusChip meta={BONUS_TX[r.type]} />,
                subtitle: fmtDateTime(r.at),
                value: <MoneyCell value={r.amount} signed />,
                meta: r.order?.orderNo ? (
                  <span className="sb-mcard__chip">
                    <em className="sb-mcard__chip-label">{t('Hujjat')}</em>
                    {r.order.id ? <Link to={`/orders/${r.order.id}`}>{r.order.orderNo}</Link> : r.order.orderNo}
                  </span>
                ) : undefined,
                lines: lines.length ? lines : undefined,
              };
            })}
          />
        ) : (
          <Table<DetailBonusTx>
            rowKey="id"
            size="small"
            columns={txCols}
            dataSource={transactions}
            pagination={{ pageSize: 10, hideOnSinglePage: true }}
            // «Izoh» `ellipsis` → table-layout: fixed; 'max-content' desktopda
            // jadvalni kengaytirib skroll chiqaradi (yuqoridagi izohga qarang)
            scroll={isDesktop ? { x: 760 } : { x: 'max-content' }}
          />
        )}
        <div style={{ marginTop: 12 }}>
          <Link to={`/bonus?factoryId=${factoryId}`}>
            {t("To'liq jurnal")} <RightOutlined style={{ fontSize: 11, color: token.colorTextTertiary }} />
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
  const t = useT();
  const isPhone = useIsPhone();
  const isDesktop = useIsDesktop();
  const reversedIds = useMemo(() => new Set(transactions.filter((tx) => tx.reversalOfId).map((tx) => tx.reversalOfId!)), [transactions]);

  const cols: TableColumnsType<DetailPalletTx> = [
    { title: t('Sana'), dataIndex: 'date', key: 'date', width: 108, render: (v: string) => fmtDate(v) },
    {
      title: t('Turi'),
      dataIndex: 'type',
      key: 'type',
      width: 180,
      render: (v: string) => (PALLET_TX[v as keyof typeof PALLET_TX] ? <StatusChip meta={PALLET_TX[v as keyof typeof PALLET_TX]} /> : v),
    },
    { title: t('Soni (dona)'), dataIndex: 'qty', key: 'qty', align: 'right', className: 'num', width: 100, render: (v: number) => fmtNum(v) },
    {
      title: t('Narx (dona)'),
      dataIndex: 'unitPrice',
      key: 'unitPrice',
      align: 'right',
      width: 130,
      render: (v: string | null) => (v ? <MoneyCell value={v} variant="neutral" /> : '—'),
    },
    {
      title: t('Jami'),
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
              {t('hisobga')} +{fmtMoney(jami)}
            </Typography.Text>
          </Flex>
        );
      },
    },
    { title: t('Izoh'), dataIndex: 'note', key: 'note', ellipsis: true, render: (v: string | null) => v || '—' },
  ];

  return (
    <Flex vertical gap={12}>
      <Flex align="center" justify="space-between" gap={12} wrap>
        <Flex align="center" gap={8}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('Zavod oldida hisobdorlik:')}
          </Typography.Text>
          {balance != null ? <PalletChip pallets={balance} /> : <Typography.Text type="secondary">—</Typography.Text>}
        </Flex>
        {canReturn ? (
          <Button onClick={onReturn} block={isPhone} style={isPhone ? { flex: '1 1 100%' } : undefined}>
            {t('Paddon qaytarish')}
          </Button>
        ) : null}
      </Flex>
      {transactions.length === 0 ? (
        <EmptyState message="Paddon harakati hali yo'q" />
      ) : (
        <div className="dash-card" style={{ padding: isPhone ? 12 : 16 }}>
          <Overline>{t('Paddon harakatlari')}</Overline>
          {isPhone ? (
            <MobileCards
              // desktop jadvali 20 tadan sahifalanadi — telefonda ham shunday
              pageSize={20}
              cards={transactions.map((r) => {
                const meta = PALLET_TX[r.type as keyof typeof PALLET_TX];
                const lines: { label: string; value: ReactNode }[] = [];
                if (r.unitPrice) {
                  lines.push({ label: 'Narx (dona)', value: <MoneyCell value={r.unitPrice} variant="neutral" /> });
                }
                if (r.unitPrice && r.type === 'RETURNED_TO_FACTORY') {
                  const jami = r.qty * num(r.unitPrice);
                  lines.push({
                    label: 'Jami',
                    value: (
                      <Flex vertical align="flex-end" gap={0}>
                        <MoneyCell value={jami} variant="neutral" />
                        <Typography.Text style={{ fontSize: 11, color: token.colorSuccess }} className="num">
                          {t('hisobga')} +{fmtMoney(jami)}
                        </Typography.Text>
                      </Flex>
                    ),
                  });
                }
                if (r.note) lines.push({ label: 'Izoh', value: r.note });
                return {
                  key: r.id,
                  title: meta ? <StatusChip meta={meta} /> : r.type,
                  subtitle: fmtDate(r.date),
                  value: (
                    <span className="num">
                      {fmtNum(r.qty)} {t('dona')}
                    </span>
                  ),
                  lines: lines.length ? lines : undefined,
                  ghost: r.type === 'REVERSAL' || reversedIds.has(r.id),
                };
              })}
            />
          ) : (
            <Table<DetailPalletTx>
              rowKey="id"
              size="small"
              columns={cols}
              dataSource={transactions}
              pagination={{ pageSize: 20, hideOnSinglePage: true }}
              // «Izoh» `ellipsis` → table-layout: fixed; desktop eski 820px
              // polida qoladi, tor ekran mazmun eniga cho'ziladi
              scroll={isDesktop ? { x: 820 } : { x: 'max-content' }}
              rowClassName={(r) => (r.type === 'REVERSAL' || reversedIds.has(r.id) ? 'ghost-row' : '')}
              style={{ marginTop: 10 }}
            />
          )}
        </div>
      )}
      <div>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t('oxirgi 50')} ·{' '}
        </Typography.Text>
        <Link to={`/pallets?factoryId=${factoryId}`}>
          {t("To'liq harakatlar")} <RightOutlined style={{ fontSize: 11 }} />
        </Link>
      </div>
    </Flex>
  );
}

// ═══════════════════════════ Taqsimlash chooser ═══════════════════════════

function ChooserRemainder({ payment }: { payment: Payment }) {
  const t = useT();
  const q = useQuery({
    queryKey: ['payments', payment.id],
    queryFn: () => endpoints.payment(payment.id),
    staleTime: 30_000,
  });
  if (q.isLoading) return <Spin size="small" />;
  const remainder = Math.max(0, num(payment.amount) - allocatedSum(q.data));
  return (
    <span className="num" style={{ fontWeight: 600 }}>
      {t('qoldiq')} {fmtMoney(remainder)} {t("so'm")}
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
  const t = useT();
  const isPhone = useIsPhone();
  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={t("Taqsimlanmagan to'lovlar")}
      footer={null}
      destroyOnHidden
      width={modalWidth(480)}
      centered={isPhone}
    >
      {payments.length === 0 ? (
        <Empty description={t("Taqsimlanmagan to'lov yo'q")} image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t("oxirgi 50 to'lov")}
          </Typography.Text>
          <Flex vertical gap={6} style={{ marginTop: 8 }}>
            {payments.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onPick(p.id)}
                style={{
                  display: 'flex',
                  // telefonda sana/summa va qoldiq bir qatorga sig'maydi — ustma-ust
                  flexDirection: isPhone ? 'column' : 'row',
                  alignItems: isPhone ? 'flex-start' : 'center',
                  justifyContent: 'space-between',
                  gap: isPhone ? 4 : 12,
                  minHeight: isPhone ? 44 : undefined,
                  padding: '10px 12px',
                  borderRadius: token.borderRadius,
                  border: `1px solid ${token.colorBorderSecondary}`,
                  background: token.colorBgContainer,
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span style={{ minWidth: 0 }}>
                  <span style={{ color: token.colorTextSecondary }}>{fmtDate(p.date)}</span> ·{' '}
                  <span className="num" style={{ fontWeight: 600 }}>
                    {fmtMoney(p.amount)} {t("so'm")}
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
  const t = useT();
  const isPhone = useIsPhone();
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
      message.success(t("Bonus zavod qarziga o'tkazildi"));
      invalidate();
      onClose();
    },
    onError: (e) => setErr(e),
  });
  const withdrawMut = useMutation({
    mutationFn: () =>
      endpoints.bonusWithdraw({ factoryId, amount, cashboxId, date: date.format('YYYY-MM-DD'), note: note.trim() || undefined }),
    onSuccess: () => {
      message.success(t('Bonus naqd yechildi'));
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
        {t('Hamyonda:')} <span className="num" style={{ fontWeight: 600, color: token.colorText }}>{fmtMoney(walletBalance)} {t("so'm")}</span>
      </Typography.Text>
      <Button size="large" block onClick={() => setMode('offset')}>
        {t("Zavod qarziga o'tkazish")}
      </Button>
      <Button size="large" block onClick={() => setMode('withdraw')}>
        {t('Naqd yechish')}
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
          {t('Hamyonda:')} <span className="num" style={{ fontWeight: 600, color: token.colorText }}>{fmtMoney(walletBalance)} {t("so'm")}</span>
        </Typography.Text>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>{t('Summa')}</div>
          <MoneyInput value={amount} onChange={setAmount} max={wallet} min={1} maxLabel={t("Hamyonda: {v} so'm", { v: fmtMoney(walletBalance) })} />
          {entered > 0 ? (
            <Typography.Text type={remaining < 0 ? 'danger' : 'secondary'} style={{ fontSize: 12 }}>
              {t('Qoladi:')} <span className="num">{fmtMoney(Math.max(0, remaining))} {t("so'm")}</span>
            </Typography.Text>
          ) : null}
        </div>
        {mode === 'withdraw' ? (
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>{t('Kassa (faqat UZS)')}</div>
            <CashboxSelect value={cashboxId} currency="UZS" onChange={setCashboxId} />
          </div>
        ) : null}
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>{t('Sana')}</div>
          <DatePicker value={date} onChange={(d) => setDate(d ?? dayjs())} format="DD.MM.YYYY" allowClear={false} style={{ width: '100%' }} />
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>{t('Izoh')}</div>
          <Input.TextArea rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('Izoh (ixtiyoriy)')} />
        </div>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {mode === 'offset'
            ? t("BONUS usulidagi zavod to'lovi yaratiladi — kassadan o'tmaydi.")
            : t('Naqd kassaga kirim yoziladi.')}
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
      title={mode === 'withdraw' ? t('Bonusni naqd yechish') : mode === 'offset' ? t("Bonusni zavod qarziga o'tkazish") : t('Bonusdan yopish')}
      destroyOnHidden
      width={modalWidth(460)}
      centered={isPhone}
      footer={
        mode === 'choose' ? null : isPhone ? (
          // telefonda: asosiy amal tepada, ikkalasi ham to'liq kenglikda
          // (FormDrawer futeri bilan bir xil naqsh — uzun yorliqlar kesilmasin)
          <Flex vertical gap={8}>
            <Button block type="primary" onClick={submit} disabled={!canSubmit} loading={busy}>
              {mode === 'offset' ? t("O'tkazish") : t('Yechish')}
            </Button>
            <Button block onClick={() => setMode('choose')} disabled={busy}>
              {t('Orqaga')}
            </Button>
          </Flex>
        ) : (
          [
            <Button key="back" onClick={() => setMode('choose')} disabled={busy}>
              {t('Orqaga')}
            </Button>,
            <Button key="ok" type="primary" onClick={submit} disabled={!canSubmit} loading={busy}>
              {mode === 'offset' ? t("O'tkazish") : t('Yechish')}
            </Button>,
          ]
        )
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
  inHand,
}: {
  open: boolean;
  onClose: () => void;
  factoryId: string;
  factoryName: string;
  heldNow?: number;
  inHand?: number;
}) {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const t = useT();
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
      message.success(t('Paddon zavodga qaytarildi'));
      for (const k of ['pallets', 'factories', 'debts', 'dashboard']) qc.invalidateQueries({ queryKey: [k] });
      onClose();
    },
    onError: (e) => setErr(e),
  });

  const credit = (qty ?? 0) * num(unitPrice);
  const priceDeviates = num(unitPrice) !== defaultPrice;
  // «undan ortiq berib bo'lmaydi»: at most min(loose in-hand stock, what we owe this factory)
  const cap =
    heldNow != null && inHand != null ? Math.max(0, Math.min(heldNow, inHand)) : undefined;
  const overCap = cap != null && (qty ?? 0) > cap;
  const canSubmit = !!qty && qty >= 1 && num(unitPrice) >= 1 && !overCap && !mut.isPending;

  return (
    <FormDrawer
      open={open}
      onClose={onClose}
      title={t('Zavodga paddon qaytarish')}
      width={460}
      submitText="Qaytarish"
      cancelText="Orqaga"
      disabled={!canSubmit}
      submitting={mut.isPending}
      onSubmit={() => canSubmit && mut.mutate()}
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
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>{t('Soni (dona)')}</div>
          <Input
            type="number"
            min={1}
            max={cap}
            status={overCap ? 'error' : undefined}
            value={qty ?? ''}
            onChange={(e) => {
              if (!e.target.value) return setQty(null);
              let n = Math.max(0, Math.floor(Number(e.target.value)));
              if (cap != null) n = Math.min(n, cap);
              setQty(n);
            }}
            placeholder="0"
          />
          {cap != null ? (
            <Typography.Text type={overCap ? 'danger' : 'secondary'} style={{ fontSize: 12 }}>
              {t("Maksimum {cap} dona — qo'lda {inHand}, zavod oldida {held}", { cap: fmtNum(cap), inHand: fmtNum(inHand ?? 0), held: fmtNum(heldNow ?? 0) })}
            </Typography.Text>
          ) : null}
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>{t('Dona narxi')}</div>
          <MoneyInput value={unitPrice} onChange={setUnitPrice} min={1} />
          {priceDeviates ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t('standart:')} {fmtMoney(defaultPrice)} {t("so'm")}
            </Typography.Text>
          ) : null}
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>{t('Sana')}</div>
          <DatePicker value={date} onChange={(d) => setDate(d ?? dayjs())} format="DD.MM.YYYY" allowClear={false} style={{ width: '100%' }} />
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>{t('Izoh')}</div>
          <Input.TextArea rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('Izoh (ixtiyoriy)')} />
        </div>
        {heldNow != null && qty ? (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('Hisobdorlik:')} <span className="num">{fmtNum(heldNow)}</span> →{' '}
            <span className="num">{fmtNum(heldNow - qty)}</span> {t('dona')}
          </Typography.Text>
        ) : null}
        <LedgerImpactPreview
          facts={[{ tone: 'neutral', text: t("Zavod hisobiga kredit: +{v} so'm (taxminiy — server tasdiqlaydi)", { v: fmtMoney(credit) }) }]}
        />
        {err ? (
          <Typography.Text type="danger" style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>
            {apiError(err)}
          </Typography.Text>
        ) : null}
      </Flex>
    </FormDrawer>
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
  const t = useT();
  const isPhone = useIsPhone();
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
      message.success(t("Yangi bonus dasturi o'rnatildi"));
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

  // R4: xom <Drawer> emas — FormDrawer (telefonda pastki varaq + block futer).
  // Ctrl+Enter FormDrawer'ning o'zida ushlanadi; mahalliy onKeyDown olib
  // tashlandi — aks holda bitta bosishda submit IKKI marta ishga tushardi.
  return (
    <FormDrawer
      open={open}
      onClose={onClose}
      title={t('Yangi bonus dasturi')}
      width={480}
      submitText="O'rnatish"
      cancelText="Orqaga"
      disabled={!valid}
      submitting={mut.isPending}
      onSubmit={submit}
      footerExtra={
        // klaviatura maslahati telefonda ko'rsatilmaydi (R19)
        isPhone ? null : (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t("Ctrl+Enter — o'rnatish")}
          </Typography.Text>
        )
      }
    >
      <Flex vertical gap={16}>
        <LedgerImpactPreview
          facts={[
            {
              tone: 'warning',
              text: t("Dastur versiyalanadi — yangi shart faqat shu sanadan keyin YAKUNLANGAN buyurtmalarga qo'llanadi; eski hisob-kitoblar o'zgarmaydi."),
            },
          ]}
        />
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 6 }}>{t('Dastur turi')}</div>
          <Segmented
            block
            value={kind}
            onChange={(v) => setKind(v as BonusProgramKind)}
            options={[
              { value: 'PER_M3', label: t('Har m³') },
              { value: 'PERCENT', label: t('Foizli') },
              { value: 'NONE', label: t("Bonus yo'q") },
            ]}
          />
        </div>
        {kind === 'PER_M3' ? (
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>{t("Stavka (so'm / m³)")}</div>
            <MoneyInput value={rate} onChange={setRate} min={1} placeholder={t('masalan 5 000')} />
          </div>
        ) : null}
        {kind === 'PERCENT' ? (
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>{t('Foiz (%)')}</div>
            <Input
              type="number"
              min={0.01}
              max={100}
              step={0.1}
              value={percent ?? ''}
              onChange={(e) => setPercent(e.target.value ? Number(e.target.value) : null)}
              placeholder={t('masalan 1.5')}
            />
          </div>
        ) : null}
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>{t('Kuchga kirish sanasi')}</div>
          <DatePicker
            value={effectiveFrom}
            onChange={(d) => setEffectiveFrom(d ?? dayjs())}
            format="DD.MM.YYYY"
            allowClear={false}
            style={{ width: '100%' }}
          />
          {collision ? (
            <Typography.Text type="danger" style={{ fontSize: 12 }}>
              {t('Bu sana uchun dastur allaqachon kiritilgan — boshqa sanani tanlang.')}
            </Typography.Text>
          ) : null}
        </div>
        {err ? (
          <Typography.Text type="danger" style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>
            {apiError(err)}
          </Typography.Text>
        ) : null}
      </Flex>
    </FormDrawer>
  );
}

// ═══════════════════════════ Tahrirlash drawer ═══════════════════════════

function EditDrawer({ open, onClose, factory }: { open: boolean; onClose: () => void; factory: FactoryDetailData }) {
  const { message } = App.useApp();
  const t = useT();
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
      message.success(t('Zavod yangilandi'));
      qc.invalidateQueries({ queryKey: ['factories'] });
      onClose();
    },
    onError: (e) => setErr(e),
  });

  const valid = name.trim().length > 0 && name.trim().length <= 200 && !mut.isPending;

  // R4: xom <Drawer> emas — FormDrawer (telefonda pastki varaq + block futer)
  return (
    <FormDrawer
      open={open}
      onClose={onClose}
      title={t('Zavodni tahrirlash')}
      width={480}
      submitText="Saqlash"
      disabled={!valid}
      submitting={mut.isPending}
      onSubmit={() => valid && mut.mutate()}
    >
      <Flex vertical gap={16}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>{t('Nomi')}</div>
          <Input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} placeholder={t('Zavod nomi')} />
          {err ? (
            <Typography.Text type="danger" style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>
              {apiError(err)}
            </Typography.Text>
          ) : null}
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>{t('Izoh')}</div>
          <Input.TextArea rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('Izoh (ixtiyoriy)')} />
        </div>
        <Flex align="center" gap={8}>
          <Switch checked={active} onChange={setActive} />
          <Typography.Text>{t('Faol')}</Typography.Text>
        </Flex>
      </Flex>
    </FormDrawer>
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
