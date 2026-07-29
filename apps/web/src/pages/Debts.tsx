// Qarzlar — the collections hub (money.md §7). All three debt sides + in-kind
// pallets in one place, worst-first, EVERY row carrying its own settle action.
//
//  • Summary band (A/B): KpiBand of 6 drillable StatCards from GET /debts/summary.
//  • Tabs ?tab=mijozlar|zavodlar|shofyorlar|paddonlar (AGENT: mijozlar + paddonlar).
//  • Mijozlar (hero b): GET /debts/clients worst-first — alarm-red debt MoneyCell,
//    inline OverdueChip, PalletChip, term column; row [To'lov qabul qilish] + kebab;
//    `→` expands open orders inline, `Space` peeks the client PartyStatement,
//    `T` opens the PaymentComposer pre-bound; window select feeds «Kutilayotgan
//    tushum» (server expectedCollections).
//  • Zavodlar / Shofyorlar / Paddonlar boards with per-row settle actions.
//
// All list state lives in the URL via useUrlFilters. Query keys are entity-name-
// first so the app-wide realtime invalidator (payment/order/pallet events) reaches
// every board for free; the composer invalidates the money families itself.
//
// MOBIL (mobile-responsive-spec §2.2, R11): telefonda hamma to'rt board KARTA
// ro'yxatiga aylanadi — har kartada o'sha qatorning settle amali + desktopdagi
// kebab menyusi turadi (bu sahifaning butun ma'nosi shu). Desktop (>= 992px)
// o'zgarishsiz: har bir mobil tarmoq `useIsPhone()` / `useIsDesktop()` ortida.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  App,
  Button,
  DatePicker,
  Dropdown,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Segmented,
  Select,
  Skeleton,
  Table,
  Typography,
  theme,
} from 'antd';
import type { MenuProps, TableProps } from 'antd';
import { CloseOutlined, MoreOutlined } from '@ant-design/icons';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { apiError, asItems, endpoints } from '../lib/api';
import { fmtDate, fmtMoney, isSettled, num } from '../lib/format';
import { FACTORY_PAY_INTENT, STATUS } from '../lib/status-maps';
import { can } from '../lib/permissions';
import { useAuth } from '../auth/AuthContext';
import { useUrlFilters } from '../lib/useUrlFilters';
import { TOUCH_MIN, useIsDesktop, useIsPhone } from '../lib/responsive';
import { useT } from '../components/LangContext';
import type { TFn } from '../lib/i18n';
import {
  BalanceTag,
  DataTable,
  EmptyState,
  ErrorState,
  FormDrawer,
  KpiBand,
  MoneyCell,
  OverdueChip,
  PageHeader,
  PalletChip,
  PartyStatement,
  PaymentComposer,
  PeekPanel,
  StatusChip,
  SummaryStrip,
  TableCard,
  type SbColumn,
  type StatCardProps,
} from '../components';
import type {
  CostStatus,
  FactoryPayIntent,
  Money,
  Order,
  OrderStatus,
  PaymentKind,
  PaymentMethod,
  Vehicle,
} from '../lib/types';

// ─────────────────────────── server row shapes ───────────────────────────

interface DebtsSummaryData {
  clientsOweUs: Money;
  weOweClients: Money;
  /** Σ of both advance channels — money standing AT the factory, unspent (R2) */
  factoryAdvance: Money;
  factoryAdvanceCash: Money;
  factoryAdvanceBank: Money;
  // Лист1 «Завод» blokining pastki raqami — brutto avans minus ochiq mol qarzi
  factoryAdvanceNet: Money;
  factoryAdvanceNetCash: Money;
  factoryAdvanceNetBank: Money;
  /** PAYABLE bucket only — an advance no longer shrinks this figure (R1/R2) */
  /** GROSS ochiq mol qarzi — avans qo'llanmagan holda (daftar bo'yicha) */
  factoryPayableOpen: Money;
  /** SOF qoldiq — zavodda turgan avans hisobga olingandan keyin (eski, tanish raqam) */
  weOweFactories: Money;
  /** Σ ochiq buyurtmalar = naqd + o'tkazma + aniqlanmagan (doskaning yig'indisi) */
  factoryPayableOrders: Money;
  /** «zavodga to'lash usuli» NAQD bo'lgan ochiq buyurtmalar qarzi */
  factoryPayableCash: Money;
  /** «zavodga to'lash usuli» O'TKAZMA bo'lgan ochiq buyurtmalar qarzi */
  factoryPayableBank: Money;
  /** usuli hali tanlanmagan buyurtmalar qarzi — o'z kartasi YO'Q, asosiy karta ichida */
  factoryPayableUnknown: Money;
  factoryOpenOrders: number;
  /** daftardagi qarz − buyurtmalar yig'indisi; 0 dan farq qilsa OCHIQ aytiladi */
  factoryPayableUnlinked: Money;
  weOweVehicles: Money;
  palletsAtClients: number;
  palletsOwedToFactories: number;
}

/** ochiq zavod qarzi bo'lgan BITTA buyurtma (GET /debts/factory-orders) */
interface FactoryOrderDebtRow {
  id: string;
  orderNo: string;
  date: string;
  status: OrderStatus;
  costStatus: CostStatus;
  costTotal: Money;
  factoryPayIntent: FactoryPayIntent;
  factory: { id: string; name: string };
  client: { id: string; name: string };
  /** Σ shu buyurtmaga taqsimlangan FACTORY_OUT to'lovlari */
  factoryPaid: Money;
  /** costTotal − factoryPaid — buyurtma kartasidagi «Zavodga qarzimiz» bilan bir xil */
  open: Money;
}

interface FactoryOrdersResponse {
  items: FactoryOrderDebtRow[];
  total: number;
  page: number;
  pageSize: number;
  /** qidiruv/zavod qamrovi, HAMMA usul — yuqoridagi yakun chizig'ining qamrovi */
  totals: { open: Money; cash: Money; bank: Money; unknown: Money; count: number };
  /** ayni damda jadvalda turgan qatorlar (usul filtri qo'llangan holda) */
  filtered: { open: Money; count: number };
}

interface DebtClientRow {
  id: string;
  name: string;
  phone?: string | null;
  agent?: { id: string; name: string } | null;
  region?: { id: string; name: string } | null;
  paymentTermDays?: number | null;
  creditLimit?: Money | null;
  balance: Money;
  palletBalance: number;
  /** money settled but still holding our pallets — in-kind debt only (R4) */
  palletOnly: boolean;
  hasOverdueOrders: boolean;
  overdueOrdersCount: number;
  overdueOrdersTotal: Money;
  dueWithinWindow: boolean;
}

interface DebtsClientsResponse {
  items: DebtClientRow[];
  total: number;
  page: number;
  pageSize: number;
  days: number;
  expectedCollections: Money;
}

interface FactoryRow {
  id: string;
  name: string;
  active: boolean;
  /** legacy netted balance — kept only so nothing that still reads it breaks */
  balance: Money;
  /** open goods debt; < 0 ⇒ we owe. NOT reduced by a standing advance (R1) */
  payable: Money;
  advanceCash: Money;
  advanceBank: Money;
  advanceTotal: Money;
  bonusBalance: Money;
  palletsHeld: number;
}

interface PalletClientRow {
  client: { id: string; name: string };
  balance: number;
}

type TabKey = 'mijozlar' | 'zavodlar' | 'shofyorlar' | 'paddonlar';

// ─────────────────────────── shared bits ───────────────────────────

const Caption = ({ children }: { children: ReactNode }) => (
  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
    {children}
  </Typography.Text>
);

/** honesty line for the client-side chip filters (03 §6). */
const chipCaption = "Filtr sahifa ichida qo'llanadi — umumiy summa yuqoridagi kartada.";

/**
 * Telefon kartasidagi chip qatori. Chiplar (OverdueChip / PalletChip / MoneyCell)
 * `white-space: nowrap` — o'raladi, lekin bittasi 320px ga sig'masa sahifani
 * kengaytirib yubormasin uchun rail `.sb-scroll-x` (skroll konteyneri flex ichida
 * min-width: 0 oladi, ya'ni siqiladi).
 */
const ChipRail = ({ children }: { children: ReactNode }) => (
  <div
    className="sb-scroll-x"
    style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, maxWidth: '100%' }}
  >
    {children}
  </div>
);

/** skeleton board mirroring the real table (platform state law §9). */
function BoardSkeleton({ cols }: { cols: number }) {
  const isDesktop = useIsDesktop();
  const data = Array.from({ length: 8 }, (_, i) => ({ __k: i }));
  const columns = Array.from({ length: cols }, (_, i) => ({
    title: '',
    key: i,
    render: () => <Skeleton.Button active size="small" block style={{ height: 12, minWidth: 40 }} />,
  }));
  return (
    <Table
      rowKey="__k"
      size="small"
      columns={columns}
      dataSource={data}
      pagination={false}
      scroll={isDesktop ? undefined : { x: 'max-content' }}
    />
  );
}

// ─────────────────────────── §7.1 summary band (A/B) ───────────────────────────

function SummaryBand() {
  const isPhone = useIsPhone();
  const t = useT();
  const q = useQuery({
    queryKey: ['debts', 'summary'],
    queryFn: () => endpoints.debtsSummary() as Promise<DebtsSummaryData>,
    placeholderData: keepPreviousData,
  });

  if (q.isError) {
    return <ErrorState error={q.error} onRetry={() => void q.refetch()} message="Umumiy qarzlarni yuklab bo'lmadi" />;
  }

  if (q.isLoading || !q.data) {
    return (
      <div
        style={{
          display: 'grid',
          // telefonda `.sb-kpi-grid` ning mobil qavati bilan bir xil pol: skeletdan
          // haqiqiy kartalarga o'tishda 1-ustun → 2-ustun sakrashi bo'lmasin
          gridTemplateColumns: `repeat(auto-fit, minmax(${isPhone ? 150 : 220}px, 1fr))`,
          gap: isPhone ? 10 : 16,
        }}
      >
        {Array.from({ length: 9 }, (_, i) => (
          <Skeleton.Button key={i} active block style={{ height: isPhone ? 84 : 96, borderRadius: 8 }} />
        ))}
      </div>
    );
  }

  const s = q.data;
  // «naqd A / o'tkazma B» — R3: ikki kanal alohida turadi, chunki qaysi kanaldan
  // yechilsa, o'sha bo'lakning tannarx bazasi (zavod naqd / o'tkazma narxi) shu.
  // Karta SOF qoldiqni koʼrsatadi — egasining Лист1 «Завод» bloki bilan aynan bir xil raqam
  // («Берилган − Олинган»), va uning oʼz «Нахт / банк» qatori. Brutto choʼntaklar ostidagi
  // izohda qoladi: ular ledgerdagi haqiqiy holat (avans qarzni AVTOMATIK yopmaydi, 2026-07-21)
  // va ularsiz sof raqam qayerdan chiqqani koʼrinmasdi.
  const advanceSplit = (
    <Flex vertical gap={2}>
      <Flex align="baseline" wrap gap={4}>
        <span>{t('naqd')}</span>
        <MoneyCell value={s.factoryAdvanceNetCash} variant="in" style={{ fontSize: 12 }} />
        <span>/ {t("o'tkazma")}</span>
        <MoneyCell value={s.factoryAdvanceNetBank} variant="in" style={{ fontSize: 12 }} />
      </Flex>
      <Flex align="baseline" wrap gap={4} style={{ color: 'var(--ant-color-text-tertiary)' }}>
        <span>{t('brutto')}</span>
        <MoneyCell value={s.factoryAdvance} variant="neutral" style={{ fontSize: 12 }} />
        <span>− {t('mol qarzi')}</span>
        <MoneyCell value={s.factoryPayableOpen} variant="weOwe" style={{ fontSize: 12 }} />
      </Flex>
    </Flex>
  );

  /** ikkilamchi izoh qatori: yorliq + kichik pul figurasi */
  const noteLine = (label: string, value: Money) => (
    <Flex align="baseline" wrap gap={4}>
      <span>{t(label)}</span>
      <MoneyCell value={value} variant="weOwe" style={{ fontSize: 12 }} />
    </Flex>
  );

  // Daftardagi ochiq qarz bilan buyurtmalar yig'indisi orasidagi farq. Odatda 0. Noldan
  // farq qilsa — bu buyurtmaga bog'lanmagan PAYABLE pul (bonusdan yopilgan, zavod ortiqcha
  // olgan, import tuzatmasi). Uni jimgina uchta kanalning biriga qo'shib yuborish
  // «hammasi joyida» degan yolg'on bo'lardi, shuning uchun alohida aytiladi.
  const unlinked = Math.abs(num(s.factoryPayableUnlinked)) >= 1 ? s.factoryPayableUnlinked : null;

  const cards: StatCardProps[] = [
    { label: 'Mijozlar bizga qarz', value: s.clientsOweUs, variant: 'owedToUs', suffix: "so'm", to: '/debts?tab=mijozlar' },
    { label: 'Mijozlar avansi (qarzimiz)', value: s.weOweClients, variant: 'weOwe', suffix: "so'm", to: '/debts?tab=mijozlar&chip=avans' },
    {
      // Egasi qarori (2026-07-26): bu karta endi GROSS ochiq mol qarzini ko'rsatadi va u
      // ostidagi «Buyurtmalar» doskasining yig'indisiga AYNAN teng — karta bosilganda
      // ochiladigan ro'yxat boshqa raqamga jamlansa, ikkalasi ham ishonchli ko'rinib,
      // qaysi biri haqiqat ekani bilinmay qolardi. Eski SOF qoldiq izohga tushdi:
      // ma'nosi o'zgarmadi, faqat o'rni o'zgardi.
      //
      // «Aniq emas» usulli buyurtmalar aynan SHU YERDA qoladi (ularning alohida kartasi
      // yo'q) — egasi so'ragan qoida.
      label: 'Zavodlarga qarzimiz',
      value: s.factoryPayableOrders,
      variant: 'weOwe',
      suffix: "so'm",
      note: (
        <Flex vertical gap={2}>
          {noteLine('aniqlanmagan usul', s.factoryPayableUnknown)}
          {noteLine('sof qoldiq (avansdan keyin)', s.weOweFactories)}
          {unlinked ? noteLine("buyurtmaga bog'lanmagan", unlinked) : null}
        </Flex>
      ),
      to: '/debts?tab=zavodlar&view=buyurtmalar',
    },
    {
      // R3: ikki kanal ALOHIDA turadi, chunki buyurtmaning «zavodga to'lash usuli»
      // uning tannarx bazasini ham belgilaydi — naqd qarz naqd narxida yopiladi.
      label: "Zavodlarga qarzimiz — naqd",
      value: s.factoryPayableCash,
      variant: 'weOwe',
      suffix: "so'm",
      to: '/debts?tab=zavodlar&view=buyurtmalar&intent=CASH',
    },
    {
      label: "Zavodlarga qarzimiz — o'tkazma",
      value: s.factoryPayableBank,
      variant: 'weOwe',
      suffix: "so'm",
      to: "/debts?tab=zavodlar&view=buyurtmalar&intent=BANK",
    },
    {
      // Egasi qarori (2026-07-29): bu karta Лист1 «Завод» blokining pastki raqamini
      // koʼrsatadi — «Берилган − Олинган». Ilgari brutto choʼntak turardi (489 470 806) va
      // egasi uni oʼz faylidagi 391 595 430 bilan solishtira olmasdi: ikkovining orasidagi
      // 97 875 376 naqd mol qarzi butunlay boshqa kartada edi. Brutto endi izohda.
      label: 'Zavoddagi avansimiz',
      value: s.factoryAdvanceNet,
      variant: 'in',
      suffix: "so'm",
      note: advanceSplit,
      to: '/debts?tab=zavodlar&chip=avans',
    },
    { label: 'Shofyorlarga qarzimiz', value: s.weOweVehicles, variant: 'weOwe', suffix: "so'm", to: '/debts?tab=shofyorlar' },
    { label: 'Mijozlardagi paddonlar', value: s.palletsAtClients, variant: 'neutral', suffix: 'dona', to: '/debts?tab=paddonlar' },
    // R4: paddon qarzi IKKALA tomonda ham dona hisobida — zavod tomoni shu paytgacha
    // faqat «Paddonlar» tabining ichida ko'rinardi, doskaning o'zida yo'q edi
    {
      label: 'Zavodlarga paddon qarzimiz',
      value: s.palletsOwedToFactories,
      variant: 'weOwe',
      suffix: 'dona',
      to: '/debts?tab=paddonlar&view=zavodlar',
    },
  ];

  return (
    <div style={{ position: 'relative' }}>
      {q.isFetching ? <div className="refetch-hairline" /> : null}
      <KpiBand label="QARZLAR" cards={cards} />
    </div>
  );
}

// ─────────────────────────── §7.2 Mijozlar board (hero b) ───────────────────────────

/** inline open-orders strip shown when a debt row is expanded (`→`). */
function OpenOrdersInline({ clientId }: { clientId: string }) {
  const t = useT();
  const isDesktop = useIsDesktop();
  const q = useQuery({
    queryKey: ['orders', 'debt-open', clientId],
    queryFn: () => endpoints.orders({ clientId, pageSize: 50 }),
  });

  if (q.isLoading) return <Skeleton active paragraph={{ rows: 3 }} title={false} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} message="Buyurtmalarni yuklab bo'lmadi" />;

  const orders = (q.data?.items ?? []).filter((o) => o.status !== 'CANCELLED');
  if (orders.length === 0) {
    return <Caption>{t("Ochiq buyurtma yo'q.")}</Caption>;
  }

  const now = dayjs();
  const columns: TableProps<Order>['columns'] = [
    {
      title: t('Buyurtma'),
      key: 'orderNo',
      render: (_, o) => <Link to={`/orders/${o.id}`}>{o.orderNo}</Link>,
    },
    { title: t('Sana'), key: 'date', render: (_, o) => fmtDate(o.date) },
    {
      title: t('Muddat'),
      key: 'due',
      render: (_, o) => {
        if (!o.dueDate) return <Typography.Text type="secondary">—</Typography.Text>;
        const overdue = dayjs(o.dueDate).isBefore(now) && o.status !== 'COMPLETED';
        return (
          <Typography.Text type={overdue ? 'danger' : undefined} strong={overdue}>
            {fmtDate(o.dueDate)}
          </Typography.Text>
        );
      },
    },
    {
      title: t('Savdo summasi'),
      key: 'total',
      align: 'right',
      render: (_, o) => <MoneyCell value={o.saleTotal} />,
    },
    {
      // Qarz HECH QACHON ekranda hisoblanmaydi — server bergan `clientOutstanding`
      // (savdo summasi − mijoz shofyorga bergan ulush − to'langani) yagona manba.
      title: t('Mijoz qarzi'),
      key: 'clientOutstanding',
      align: 'right',
      render: (_, o) =>
        num(o.clientOutstanding) > 0 ? (
          <MoneyCell value={o.clientOutstanding ?? 0} variant="owedToUs" strong />
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    {
      title: t('Holat'),
      key: 'status',
      align: 'right',
      render: (_, o) => <StatusChip meta={STATUS[o.status]} />,
    },
  ];

  return (
    <div>
      <Table<Order>
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={orders}
        pagination={false}
        scroll={isDesktop ? undefined : { x: 'max-content' }}
      />
      <div style={{ marginTop: 6 }}>
        <Caption>{t('oxirgi 50 buyurtma')}</Caption>
      </div>
    </div>
  );
}

/** the client statement PeekPanel (Space) — reuses the flagship PartyStatement. */
function ClientStatementPeek({
  clientId,
  clientName,
  open,
  onClose,
  rowIds,
  onNavigate,
}: {
  clientId: string;
  clientName?: string;
  open: boolean;
  onClose: () => void;
  rowIds: string[];
  onNavigate: (id: string) => void;
}) {
  const navigate = useNavigate();
  const t = useT();
  return (
    <PeekPanel
      open={open}
      onClose={onClose}
      width={560}
      title={clientName ?? t('Mijoz')}
      subtitle={t('Hisob-kitob')}
      onOpenFull={clientId ? () => navigate(`/clients/${clientId}`) : undefined}
      onPrint={clientId ? () => navigate(`/print/statement/client/${clientId}`) : undefined}
      rowIds={rowIds}
      activeId={clientId}
      onNavigate={onNavigate}
    >
      {clientId ? (
        <div style={{ padding: 16 }}>
          <PartyStatement partyType="client" partyId={clientId} />
        </div>
      ) : null}
    </PeekPanel>
  );
}

function MijozlarBoard() {
  const uf = useUrlFilters();
  const t = useT();
  const navigate = useNavigate();
  const isPhone = useIsPhone();
  const isDesktop = useIsDesktop();
  const { user } = useAuth();
  const role = user?.role ?? null;
  const canPay = can(role, 'payments.create');

  const days = Number(uf.get('days')) || 7;
  const search = uf.get('search') || undefined;
  const chip = uf.get('chip');
  const page = Number(uf.get('page')) || 1;
  const pageSize = Number(uf.get('pageSize')) || 20;
  const peekId = uf.get('peek') || '';

  // Debts board is for collecting debt → default lists only debtors (server-side, so
  // pagination + count stay correct). 'avans' is an explicit opt-in from the KPI chip.
  const dir = chip === 'avans' ? ('avans' as const) : undefined;
  const q = useQuery({
    queryKey: ['debts', 'clients', { days, search, page, pageSize, dir }],
    queryFn: () => endpoints.debtsClients({ days, search, page, pageSize, dir }) as Promise<DebtsClientsResponse>,
    placeholderData: keepPreviousData,
  });

  const serverRows = q.data?.items ?? [];
  const rows = useMemo(() => {
    // backend already returns the correct side; overdue is a client-side triage subset
    if (chip === 'overdue') return serverRows.filter((r) => r.hasOverdueOrders);
    return serverRows;
  }, [serverRows, chip]);

  // ── cursor + keyboard (hero loop §10) ─────────────────────────────────────
  const [cursor, setCursor] = useState(-1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pulseId, setPulseId] = useState<string | null>(null);
  const [composer, setComposer] = useState<{ open: boolean; client?: DebtClientRow }>({ open: false });

  const openComposer = (row: DebtClientRow) => setComposer({ open: true, client: row });
  const openPeek = (id: string) => uf.set({ peek: id });

  const kb = useRef({ rows, cursor, blocked: false });
  kb.current = { rows, cursor, blocked: !!peekId || composer.open };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      const editable = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t?.isContentEditable ?? false);
      if (editable || e.ctrlKey || e.metaKey || e.altKey) return;
      const s = kb.current;
      // while the peek or composer owns the keyboard, the board yields to it
      if (s.blocked) return;
      const n = s.rows.length;
      if (!n && e.key !== 'Escape') return;
      switch (e.key) {
        case 'ArrowDown':
        case 'j':
        case 'J':
          e.preventDefault();
          setCursor((c) => Math.min((c < 0 ? -1 : c) + 1, n - 1));
          break;
        case 'ArrowUp':
        case 'k':
        case 'K':
          e.preventDefault();
          setCursor((c) => Math.max((c < 0 ? 0 : c) - 1, 0));
          break;
        case 'Enter':
          if (s.cursor >= 0) {
            e.preventDefault();
            navigate(`/clients/${s.rows[s.cursor].id}`);
          }
          break;
        case ' ':
          if (s.cursor >= 0) {
            e.preventDefault();
            openPeek(s.rows[s.cursor].id);
          }
          break;
        case 't':
        case 'T':
          if (s.cursor >= 0 && canPay) {
            e.preventDefault();
            openComposer(s.rows[s.cursor]);
          }
          break;
        case 'ArrowRight':
          if (s.cursor >= 0) {
            e.preventDefault();
            setExpandedId(s.rows[s.cursor].id);
          }
          break;
        case 'ArrowLeft':
          e.preventDefault();
          setExpandedId(null);
          break;
        case 'Escape':
          setExpandedId(null);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canPay, navigate]);

  // keep the cursor on the peeked row so it stays put after the peek closes
  useEffect(() => {
    if (!peekId) return;
    const i = rows.findIndex((r) => r.id === peekId);
    if (i >= 0) setCursor(i);
  }, [peekId, rows]);

  const rowIds = rows.map((r) => r.id);
  const peekName = rows.find((r) => r.id === peekId)?.name;

  const anyFilter = !!search || !!chip;

  // ── row actions (bir manba: desktop qatori HAM telefon kartasi footeri) ────
  const rowMenu = (r: DebtClientRow): MenuProps => ({
    items: [
      { key: 'peek', label: t('Hisob-kitob'), onClick: () => openPeek(r.id) },
      { key: 'akt', label: t('Akt sverki'), onClick: () => navigate(`/print/statement/client/${r.id}`) },
      { key: 'card', label: t('Mijoz kartasi'), onClick: () => navigate(`/clients/${r.id}`) },
    ],
  });

  const rowActions = (r: DebtClientRow, mobile = false) => (
    <Flex
      gap={mobile ? 8 : 6}
      justify={mobile ? undefined : 'flex-end'}
      align="center"
      style={mobile ? { width: '100%' } : undefined}
    >
      {canPay ? (
        <Button
          size={mobile ? 'middle' : 'small'}
          type="primary"
          style={mobile ? { flex: 1, minWidth: 0, minHeight: TOUCH_MIN } : undefined}
          onClick={() => openComposer(r)}
        >
          {t("To'lov qabul qilish")}
        </Button>
      ) : null}
      <Dropdown trigger={['click']} menu={rowMenu(r)}>
        <Button
          size={mobile ? 'middle' : 'small'}
          icon={<MoreOutlined />}
          aria-label={t('{name} amallari', { name: r.name })}
        />
      </Dropdown>
    </Flex>
  );

  // ── columns ───────────────────────────────────────────────────────────────
  const columns: SbColumn<DebtClientRow>[] = [
    {
      title: t('Mijoz'),
      key: 'name',
      ellipsis: true,
      render: (_, r) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <Link to={`/clients/${r.id}`} style={{ fontWeight: 500 }}>
            {r.name}
          </Link>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {[r.agent?.name, r.region?.name].filter(Boolean).join(' · ') || '—'}
            {r.phone ? (
              <>
                {' · '}
                <a href={`tel:${r.phone}`}>{r.phone}</a>
              </>
            ) : null}
          </Typography.Text>
        </div>
      ),
    },
    {
      title: t("Qarz balansi (so'm)"),
      key: 'balance',
      align: 'right',
      width: 190,
      className: 'num',
      render: (_, r) => {
        const n = num(r.balance);
        // R4: pulda hisob yopiq, lekin bizning paddonlarimiz ustida o'tirgan mijoz —
        // qatorni «0 so'm» qizil raqam bilan emas, «Hisob yopiq · N dona» bilan ochamiz
        if (r.palletOnly) return <BalanceTag balance={r.balance} partyType="client" pallets={r.palletBalance} />;
        // advances render as a BalanceTag (never alarm-red); debt is a collections surface
        if (n < 0) return <BalanceTag balance={r.balance} partyType="client" />;
        return <MoneyCell value={r.balance} variant="owedToUs" strong suffix="so'm" />;
      },
    },
    {
      title: t("Muddati o'tgan"),
      key: 'overdue',
      width: 210,
      render: (_, r) => {
        if (r.hasOverdueOrders && r.overdueOrdersCount > 0) {
          return <OverdueChip count={r.overdueOrdersCount} sum={r.overdueOrdersTotal} compact />;
        }
        if (r.dueWithinWindow) {
          return <span className="sb-chip-warn">{t('Muddati yaqin')}</span>;
        }
        return <Typography.Text type="secondary">—</Typography.Text>;
      },
    },
    {
      title: t('Paddon'),
      key: 'pallet',
      align: 'right',
      width: 110,
      className: 'num',
      render: (_, r) =>
        r.palletBalance ? (
          <PalletChip pallets={r.palletBalance} compact />
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    {
      title: t("To'lov sharti"),
      key: 'term',
      align: 'right',
      width: 120,
      className: 'num',
      render: (_, r) =>
        r.paymentTermDays != null ? (
          t('{n} kun', { n: r.paymentTermDays })
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    {
      title: '',
      key: 'actions',
      width: 210,
      render: (_, r) => rowActions(r),
    },
  ];

  // ── toolbar: search + window + expected collections ───────────────────────
  const toolbar = (
    <Flex vertical gap={8}>
    <Flex justify="space-between" align="center" wrap gap={12}>
      {/* telefonda uchala blok o'z qatorini oladi (R5/R7) */}
      <Flex align="center" wrap gap={8} style={isPhone ? { flex: '1 1 100%' } : undefined}>
        <Input.Search
          allowClear
          placeholder={t('Mijoz qidirish')}
          defaultValue={search}
          style={{ width: isPhone ? '100%' : 240, minWidth: isPhone ? 0 : undefined }}
          onSearch={(v) => uf.set({ search: v || null })}
        />
        <Flex align="center" gap={6} style={isPhone ? { flex: '1 1 100%' } : undefined}>
          <Caption>{t('Muddat sanasigacha:')}</Caption>
          <DatePicker
            allowClear={false}
            format="DD.MM.YYYY"
            placeholder={t('Sana')}
            value={dayjs().add(days - 1, 'day')}
            disabledDate={(d) => d.isBefore(dayjs(), 'day')}
            style={isPhone ? { flex: 1, minWidth: 0 } : undefined}
            onChange={(d) => {
              if (d) uf.set({ days: String(Math.max(1, d.diff(dayjs(), 'day') + 1)) });
            }}
          />
        </Flex>
      </Flex>
      <Flex
        align="baseline"
        gap={8}
        style={isPhone ? { flex: '1 1 100%', justifyContent: 'space-between' } : undefined}
      >
        <Caption>{t('Kutilayotgan tushum ({days} kun):', { days })}</Caption>
        <MoneyCell value={q.data?.expectedCollections ?? 0} strong suffix="so'm" style={{ fontSize: 16 }} />
      </Flex>
    </Flex>
    {chip ? <Caption>{t(chipCaption)}</Caption> : null}
    </Flex>
  );

  // ── body states (platform law §9) ─────────────────────────────────────────
  let body: ReactNode;
  if (isPhone) {
    // TELEFON (spec §2.2): 6 ustunli 960px jadval o'rniga karta ro'yxati.
    // DataTable o'zi yuklanish / xato / bo'sh holatlarni va sahifalashni boshqaradi;
    // `→` bilan ochiladigan ichki buyurtmalar bandi klaviatura affordansi edi —
    // uning o'rnini kartadagi «Hisob-kitob» / mijoz kartasi bosadi.
    body = (
      <DataTable<DebtClientRow>
        columns={columns}
        query={{
          data: { items: rows, total: q.data?.total ?? rows.length, page, pageSize },
          isLoading: q.isLoading,
          isFetching: q.isFetching,
          isError: q.isError,
          error: q.error,
          refetch: q.refetch,
        }}
        rowKey="id"
        onRowOpen={(r) => navigate(`/clients/${r.id}`)}
        filterKeys={['search', 'chip']}
        emptyText="Qarzdor mijoz yo'q — hammasi hisob yopiq"
        rowClassName={(r) => (r.id === pulseId ? 'pulse-row' : '')}
        mobileCard={(r) => {
          const chips: ReactNode[] = [];
          if (r.hasOverdueOrders && r.overdueOrdersCount > 0) {
            chips.push(
              <OverdueChip key="overdue" count={r.overdueOrdersCount} sum={r.overdueOrdersTotal} compact />,
            );
          } else if (r.dueWithinWindow) {
            chips.push(
              <span key="due" className="sb-chip-warn">
                {t('Muddati yaqin')}
              </span>,
            );
          }
          if (r.palletBalance) chips.push(<PalletChip key="pallet" pallets={r.palletBalance} compact />);
          if (r.paymentTermDays != null) {
            chips.push(
              <span key="term" className="sb-mcard__chip">
                <em className="sb-mcard__chip-label">{t("To'lov sharti")}</em>
                {t('{n} kun', { n: r.paymentTermDays })}
              </span>,
            );
          }
          return {
            title: r.name,
            subtitle: (
              <>
                <span>{[r.agent?.name, r.region?.name].filter(Boolean).join(' · ') || '—'}</span>
                {r.phone ? (
                  <a href={`tel:${r.phone}`} onClick={(e) => e.stopPropagation()}>
                    {r.phone}
                  </a>
                ) : null}
              </>
            ),
            // avans hech qachon signal-qizil emas — desktopdagi bilan bir xil qoida
            value: r.palletOnly ? (
              <BalanceTag balance={r.balance} partyType="client" pallets={r.palletBalance} compact />
            ) : num(r.balance) < 0 ? (
                <BalanceTag balance={r.balance} partyType="client" compact />
              ) : (
                // `suffix` MoneyCell ichida tarjima QILINMAYDI (u xom holda
                // chiqadi) — birlikni shu yerda t() dan o'tkazamiz, aks holda
                // rus tilidagi kartada «Бонус… 1 250 000 so'm» chiqadi.
                <MoneyCell value={r.balance} variant="owedToUs" strong suffix={t("so'm")} />
              ),
            meta: chips.length ? <ChipRail>{chips}</ChipRail> : undefined,
            actions: rowActions(r, true),
          };
        }}
      />
    );
  } else if (q.isLoading) {
    body = <BoardSkeleton cols={6} />;
  } else if (q.isError) {
    body = <ErrorState error={q.error} onRetry={() => void q.refetch()} message="Qarzlarni yuklab bo'lmadi" />;
  } else if (rows.length === 0) {
    body = anyFilter ? (
      <EmptyState message="Filtrga mos mijoz topilmadi" onClearFilters={() => uf.clear(['search', 'chip'])} />
    ) : (
      <EmptyState message="Qarzdor mijoz yo'q — hammasi hisob yopiq" />
    );
  } else {
    body = (
      <Table<DebtClientRow>
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={rows}
          scroll={isDesktop ? { x: 960 } : { x: 'max-content' }}
          rowClassName={(r, i) => {
            const cls: string[] = [];
            if (i === cursor) cls.push('row-cursor');
            if (r.id === pulseId) cls.push('pulse-row');
            return cls.join(' ');
          }}
          onRow={(_, index) => ({
            onClick: (e) => {
              if ((e.target as HTMLElement).closest('a,button,.ant-dropdown-trigger,.ant-table-row-expand-icon')) return;
              setCursor(index ?? -1);
            },
          })}
          expandable={{
            expandedRowKeys: expandedId ? [expandedId] : [],
            onExpand: (expanded, record) => setExpandedId(expanded ? record.id : null),
            expandedRowRender: (record) => <OpenOrdersInline clientId={record.id} />,
            rowExpandable: () => true,
          }}
          pagination={{
            current: page,
            pageSize,
            total: q.data?.total ?? 0,
            showSizeChanger: true,
            showTotal: (total) => t('Jami: {n} ta', { n: total }),
            onChange: (p, ps) => uf.set({ page: String(p), pageSize: String(ps) }),
          }}
        />
    );
  }

  return (
    <Flex vertical gap={12}>
      <TableCard toolbar={toolbar} loading={q.isFetching}>
        {body}
      </TableCard>

      <ClientStatementPeek
        clientId={peekId}
        clientName={peekName}
        open={!!peekId}
        onClose={() => uf.set({ peek: null })}
        rowIds={rowIds}
        onNavigate={(id) => uf.set({ peek: id }, { replace: true })}
      />

      <PaymentComposer
        open={composer.open}
        onClose={() => setComposer({ open: false })}
        kind="CLIENT_IN"
        presetParty={
          composer.client
            ? {
                id: composer.client.id,
                name: composer.client.name,
                balance: composer.client.balance,
                palletBalance: composer.client.palletBalance,
                overdueTotal: composer.client.overdueOrdersTotal,
              }
            : undefined
        }
        presetAmount={composer.client && num(composer.client.balance) > 0 ? composer.client.balance : undefined}
        lockParty
        onSuccess={() => {
          // the row re-renders via socket invalidation; keep the cursor, pulse once
          if (composer.client) {
            const id = composer.client.id;
            setPulseId(id);
            window.setTimeout(() => setPulseId((cur) => (cur === id ? null : cur)), 1300);
          }
        }}
      />
    </Flex>
  );
}

// ─────────────────────────── §7.3 Zavodlar (A/B) ───────────────────────────
//
// IKKI KO'RINISH (egasi qoidasi, 2026-07-26):
//   • «Zavodlar»    — hisob darajasi: kimga qancha qarzmiz, qancha avansimiz turibdi.
//                     Qatorni «→» bilan ochsa — o'sha zavodning OCHIQ BUYURTMALARI.
//   • «Buyurtmalar» — qarzning o'zi: har bir ochiq buyurtma bitta qator, «zavodga
//                     to'lash usuli» (naqd / o'tkazma / aniq emas) bilan, va har
//                     qatordan to'g'ridan-to'g'ri to'lash mumkin.
//
// Zavod darajasidagi bitta yig'indi qaysi buyurtma to'lanmaganini yashirardi; usulni
// ko'rsatmaslik esa naqd va o'tkazma qarzni bitta uyumga qo'shib yuborardi, holbuki
// ularning tannarx bazasi (va shu bois foydasi) boshqa-boshqa.

/** ochiq mol qarzi bormi — FAQAT payable bucket (avans buni kamaytirmaydi, R1) */
const owesGoods = (f: FactoryRow) => !isSettled(f.payable) && num(f.payable) < 0;
/** zavodda turgan pulimiz bormi — ikki kanalning yig'indisi (R3) */
const hasAdvance = (f: FactoryRow) => !isSettled(f.advanceTotal) && num(f.advanceTotal) > 0;

type ZavodView = 'zavodlar' | 'buyurtmalar';

/**
 * Buyurtmaning to'lash niyati → to'lov usuli. Zavod tomonida usul QULAYLIK EMAS: u
 * pulning qaysi avans kanaliga tushishini va shu bilan tannarx qaysi narx kitobidan
 * o'qilishini hal qiladi (payments.service `advanceBucketFor` / `priceKindFor`). Shuning
 * uchun u faqat HUJJAT aytganda oldindan qo'yiladi; «Aniq emas» buyurtmada hech narsa
 * taxmin qilinmaydi — foydalanuvchi o'zi tanlaydi.
 */
const METHOD_FOR_INTENT: Record<FactoryPayIntent, PaymentMethod | undefined> = {
  CASH: 'CASH',
  BANK: 'BANK',
  UNKNOWN: undefined,
};

const INTENT_ORDER: FactoryPayIntent[] = ['CASH', 'BANK', 'UNKNOWN'];

function FactoriesBoard({ onPayOrder }: { onPayOrder: (row: FactoryOrderDebtRow) => void }) {
  const navigate = useNavigate();
  const uf = useUrlFilters();
  const t = useT();
  const isPhone = useIsPhone();
  const isDesktop = useIsDesktop();
  const search = (uf.get('search') || '').trim().toLowerCase();
  const chip = uf.get('chip');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ['factories', 'debts-board'],
    queryFn: () => endpoints.factories(),
  });

  const [composer, setComposer] = useState<{ open: boolean; row?: FactoryRow }>({ open: false });

  const rows = useMemo(() => {
    let list = (asItems(q.data) as unknown as FactoryRow[]).slice();
    if (search) list = list.filter((f) => f.name.toLowerCase().includes(search));
    // «Qarzimiz» / «Avansimiz» endi HOLAT filtri, bitta balansning ishorasi bo'yicha
    // bo'linish EMAS: zavodda ayni paytda ochiq mol qarzimiz HAM, turgan avansimiz HAM
    // bo'lishi mumkin (R1/R2 — avans qarzni o'zi yopmaydi), ya'ni bir zavod ikkala
    // ro'yxatda ham chiqadi. Standart ko'rinish — hisobi ochiq hamma zavod.
    if (chip === 'avans') list = list.filter(hasAdvance);
    else if (chip === 'qarz') list = list.filter(owesGoods);
    else list = list.filter((f) => owesGoods(f) || hasAdvance(f) || f.palletsHeld > 0);
    // worst-first: eng katta ochiq mol qarzi (eng manfiy payable) tepada
    return list.sort((a, b) => num(a.payable) - num(b.payable));
  }, [q.data, search, chip]);

  // desktop qatori HAM telefon kartasi footeri — bitta manba, amallar to'liq
  const rowMenu = (r: FactoryRow): MenuProps => ({
    items: [
      {
        // telefonda «→» kengaytirgichi yo'q — buyurtmalarga yagona yo'l shu amal
        key: 'orders',
        label: t('Ochiq buyurtmalari'),
        onClick: () => uf.set({ view: 'buyurtmalar', factoryId: r.id, intent: null, search: null }),
      },
      { key: 'card', label: t('Zavod kartasi'), onClick: () => navigate(`/factories/${r.id}`) },
      { key: 'akt', label: t('Akt sverki'), onClick: () => navigate(`/print/statement/factory/${r.id}`) },
    ],
  });

  const rowActions = (r: FactoryRow, mobile = false) => (
    <Flex
      gap={mobile ? 8 : 6}
      justify={mobile ? undefined : 'flex-end'}
      align="center"
      style={mobile ? { width: '100%' } : undefined}
    >
      <Button
        size={mobile ? 'middle' : 'small'}
        type="primary"
        style={mobile ? { flex: 1, minWidth: 0, minHeight: TOUCH_MIN } : undefined}
        onClick={() => setComposer({ open: true, row: r })}
      >
        {t("To'lash")}
      </Button>
      <Dropdown trigger={['click']} menu={rowMenu(r)}>
        <Button
          size={mobile ? 'middle' : 'small'}
          icon={<MoreOutlined />}
          aria-label={t('{name} amallari', { name: r.name })}
        />
      </Dropdown>
    </Flex>
  );

  const columns: SbColumn<FactoryRow>[] = [
    {
      title: 'Zavod',
      key: 'name',
      render: (_, r) => (
        <Flex vertical gap={2}>
          <Link to={`/factories/${r.id}`} style={{ fontWeight: 500 }}>
            {r.name}
          </Link>
          {!r.active ? <Caption>{t('Nofaol')}</Caption> : null}
        </Flex>
      ),
    },
    {
      // Netlangan bitta «Balans» ustuni O'LDI: u avansni qarzdan ayirib ko'rsatardi,
      // ya'ni islohot aynan taqiqlagan narsani qilardi. Endi uch raqam yonma-yon.
      title: 'Ochiq qarzimiz',
      key: 'payable',
      align: 'right',
      width: 190,
      render: (_, r) => <BalanceTag balance={r.payable} partyType="factory" />,
    },
    {
      title: "Avans — naqd (so'm)",
      key: 'advanceCash',
      align: 'right',
      width: 160,
      // birlik sarlavhada — MoneyCell `suffix`i tarjima qilinmaydi, katakda takrorlamaymiz
      render: (_, r) =>
        isSettled(r.advanceCash) ? (
          <Typography.Text type="secondary">—</Typography.Text>
        ) : (
          <MoneyCell value={r.advanceCash} variant="in" />
        ),
    },
    {
      title: "Avans — o'tkazma (so'm)",
      key: 'advanceBank',
      align: 'right',
      width: 175,
      render: (_, r) =>
        isSettled(r.advanceBank) ? (
          <Typography.Text type="secondary">—</Typography.Text>
        ) : (
          <MoneyCell value={r.advanceBank} variant="in" />
        ),
    },
    {
      title: "Bonus hamyon (so'm)",
      key: 'bonus',
      align: 'right',
      width: 170,
      render: (_, r) =>
        num(r.bonusBalance) !== 0 ? (
          <MoneyCell value={r.bonusBalance} variant={num(r.bonusBalance) > 0 ? 'in' : 'neutral'} suffix="so'm" />
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    {
      title: 'Paddon',
      key: 'pallets',
      align: 'right',
      width: 110,
      render: (_, r) =>
        r.palletsHeld ? <PalletChip pallets={r.palletsHeld} compact /> : <Typography.Text type="secondary">—</Typography.Text>,
    },
    {
      title: '',
      key: 'actions',
      width: 160,
      render: (_, r) => rowActions(r),
    },
  ];

  const boardToolbar = (
    <Flex vertical gap={8}>
      <Flex align="center" wrap gap={8}>
        <Input.Search
          allowClear
          placeholder={t('Zavod qidirish')}
          defaultValue={uf.get('search')}
          style={{ width: isPhone ? '100%' : 240, minWidth: isPhone ? 0 : undefined }}
          onSearch={(v) => uf.set({ search: v || null })}
        />
        {/* Bu endi HOLAT filtri, ikkiga bo'luvchi emas — bitta zavod «Qarzimiz» va
            «Avansimiz» ro'yxatlarining ikkalasida ham chiqishi mumkin. */}
        {/* `size="large"` FAQAT telefonda: standart `controlHeight: 36` da track
            ichidagi haqiqiy bosiladigan `.ant-segmented-item` ~32px bo'lib qolardi
            (44px teginish nishonidan past, §4). `large` → controlHeightLG 45 −
            2×trackPadding = 41px. Desktopda prop berilmaydi → hech narsa o'zgarmaydi. */}
        <Segmented
          block={isPhone}
          size={isPhone ? 'large' : undefined}
          value={chip === 'avans' ? 'avans' : chip === 'qarz' ? 'qarz' : 'hammasi'}
          options={[
            { label: t('Hammasi'), value: 'hammasi' },
            { label: t('Qarzimiz bor'), value: 'qarz' },
            { label: t('Avansimiz bor'), value: 'avans' },
          ]}
          onChange={(v) => uf.set({ chip: v === 'hammasi' ? null : String(v) })}
        />
      </Flex>
      <Caption>{t("Zavoddagi avans qarzni avtomatik yopmaydi — u buyurtma kartasidagi «Avansdan yechish» orqali ishlatiladi.")}</Caption>
      {chip ? <Caption>{t(chipCaption)}</Caption> : null}
    </Flex>
  );

  return (
    <Flex vertical gap={12}>
      <TableCard toolbar={boardToolbar}>
        <DataTable<FactoryRow>
          columns={columns}
          query={{
            data: rows,
            isLoading: q.isLoading,
            isFetching: q.isFetching,
            isError: q.isError,
            error: q.error,
            refetch: q.refetch,
          }}
          rowKey="id"
          onRowOpen={(r) => navigate(`/factories/${r.id}`)}
          filterKeys={['search', 'chip']}
          emptyText="Zavod topilmadi"
          scroll={isDesktop ? { x: 1180 } : { x: 'max-content' }}
          // «→» — o'sha zavodning OCHIQ BUYURTMALARI shu yerning o'zida, to'lash
          // tugmasi bilan birga. Telefonda kengaytirgich yo'q (karta yo'li), u yerda
          // kebab menyusidagi «Ochiq buyurtmalari» shu ro'yxatga olib boradi.
          expandable={{
            expandedRowKeys: expandedId ? [expandedId] : [],
            onExpand: (expanded, record) => setExpandedId(expanded ? record.id : null),
            expandedRowRender: (record) => (
              <FactoryOpenOrdersInline factoryId={record.id} onPay={onPayOrder} />
            ),
          }}
          mobileCard={(r) => {
            const chips: ReactNode[] = [];
            // ikki avans kanali telefonda ham ALOHIDA ko'rinadi (R3) — yig'indi emas
            if (!isSettled(r.advanceCash)) {
              chips.push(
                <span key="adv-cash" className="sb-mcard__chip" style={{ overflow: 'visible', textOverflow: 'clip' }}>
                  <em className="sb-mcard__chip-label">{t('Avans — naqd')}</em>
                  <MoneyCell value={r.advanceCash} variant="in" suffix={t("so'm")} />
                </span>,
              );
            }
            if (!isSettled(r.advanceBank)) {
              chips.push(
                <span key="adv-bank" className="sb-mcard__chip" style={{ overflow: 'visible', textOverflow: 'clip' }}>
                  <em className="sb-mcard__chip-label">{t("Avans — o'tkazma")}</em>
                  <MoneyCell value={r.advanceBank} variant="in" suffix={t("so'm")} />
                </span>,
              );
            }
            if (num(r.bonusBalance) !== 0) {
              chips.push(
                // `.sb-mcard__chip` ellipsis qo'yadi — pul figurasi hech qachon
                // kesilmasligi kerak; sig'masa ChipRail (.sb-scroll-x) skroll qiladi
                <span key="bonus" className="sb-mcard__chip" style={{ overflow: 'visible', textOverflow: 'clip' }}>
                  <em className="sb-mcard__chip-label">{t('Bonus hamyon')}</em>
                  {/* `suffix` MoneyCell ichida tarjima qilinmaydi — t() shu yerda */}
                  <MoneyCell
                    value={r.bonusBalance}
                    variant={num(r.bonusBalance) > 0 ? 'in' : 'neutral'}
                    suffix={t("so'm")}
                  />
                </span>,
              );
            }
            if (r.palletsHeld) chips.push(<PalletChip key="pallet" pallets={r.palletsHeld} compact />);
            return {
              title: r.name,
              subtitle: !r.active ? t('Nofaol') : undefined,
              value: <BalanceTag balance={r.payable} partyType="factory" compact />,
              meta: chips.length ? <ChipRail>{chips}</ChipRail> : undefined,
              actions: rowActions(r, true),
            };
          }}
        />
      </TableCard>

      <PaymentComposer
        open={composer.open}
        onClose={() => setComposer({ open: false })}
        kind="FACTORY_OUT"
        // to'lov OCHIQ MOL QARZIga qarshi taklif qilinadi — netlangan balansga emas,
        // aks holda zavodda turgan avans taklif summasini soxta kamaytirib yuborardi
        presetParty={composer.row ? { id: composer.row.id, type: 'factory', name: composer.row.name, balance: composer.row.payable } : undefined}
        presetAmount={composer.row && num(composer.row.payable) < 0 ? String(Math.abs(num(composer.row.payable))) : undefined}
        lockParty
      />
    </Flex>
  );
}

// ── §7.3.b buyurtma darajasidagi zavod qarzi ────────────────────────────────

/**
 * «Zavodga to'lov usuli» katagi. ADMIN/BUXGALTER uni SHU YERDAN o'zgartira oladi —
 * «aniq emas» qatorni tuzatish uchun buyurtma kartasiga borish shart emas, chunki bu
 * doskaning butun ma'nosi aynan shu navbatni tugatish.
 *
 * Server tanlangan kanalning zavod narxi narx kitobida bo'lishini talab qiladi
 * (`assertChannelPriced`), shuning uchun rad javobi 400 bo'lib keladi va matni bilan
 * ko'rsatiladi — jim muvaffaqiyatsizlik yo'q.
 */
function IntentCell({ row, editable }: { row: FactoryOrderDebtRow; editable: boolean }) {
  const t = useT();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const mut = useMutation({
    mutationFn: (v: FactoryPayIntent) => endpoints.setFactoryPayIntent(row.id, v),
    onSuccess: () => {
      message.success(t("Zavodga to'lov usuli o'zgartirildi"));
      for (const key of ['debts', 'orders', 'factories', 'dashboard']) qc.invalidateQueries({ queryKey: [key] });
    },
    onError: (e) => message.error(apiError(e)),
  });

  if (!editable) return <StatusChip meta={FACTORY_PAY_INTENT[row.factoryPayIntent]} />;
  return (
    <Select<FactoryPayIntent>
      size="small"
      style={{ minWidth: 150, width: '100%' }}
      value={row.factoryPayIntent}
      loading={mut.isPending}
      disabled={mut.isPending}
      onClick={(e) => e.stopPropagation()}
      onChange={(v) => mut.mutate(v)}
      options={INTENT_ORDER.map((v) => ({ value: v, label: FACTORY_PAY_INTENT[v].label }))}
    />
  );
}

/** buyurtma qatorining amallari — desktop qatori HAM telefon kartasi futeri */
function orderRowActions(
  r: FactoryOrderDebtRow,
  opts: { t: TFn; canPay: boolean; onPay: (r: FactoryOrderDebtRow) => void; navigate: (to: string) => void; mobile?: boolean },
) {
  const { t, canPay, onPay, navigate, mobile = false } = opts;
  return (
    <Flex
      gap={mobile ? 8 : 6}
      justify={mobile ? undefined : 'flex-end'}
      align="center"
      style={mobile ? { width: '100%' } : undefined}
      onClick={(e) => e.stopPropagation()}
    >
      {canPay ? (
        <Button
          size={mobile ? 'middle' : 'small'}
          type="primary"
          style={mobile ? { flex: 1, minWidth: 0, minHeight: TOUCH_MIN } : undefined}
          onClick={() => onPay(r)}
        >
          {t("To'lash")}
        </Button>
      ) : null}
      <Dropdown
        trigger={['click']}
        menu={{
          items: [
            { key: 'order', label: t('Buyurtma kartasi'), onClick: () => navigate(`/orders/${r.id}`) },
            { key: 'factory', label: t('Zavod kartasi'), onClick: () => navigate(`/factories/${r.factory.id}`) },
            { key: 'client', label: t('Mijoz kartasi'), onClick: () => navigate(`/clients/${r.client.id}`) },
          ],
        }}
      >
        <Button size={mobile ? 'middle' : 'small'} icon={<MoreOutlined />} aria-label={t('{name} amallari', { name: r.orderNo })} />
      </Dropdown>
    </Flex>
  );
}

/** «→» bilan ochilgan zavod qatorining ichidagi ochiq buyurtmalari (to'lash tugmasi bilan) */
function FactoryOpenOrdersInline({
  factoryId,
  onPay,
}: {
  factoryId: string;
  onPay: (row: FactoryOrderDebtRow) => void;
}) {
  const t = useT();
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const { user } = useAuth();
  const canPay = can(user?.role ?? null, 'payments.create');
  const canEditIntent = can(user?.role ?? null, 'orders.edit');

  const q = useQuery({
    // `inline` — doskaning o'z kaliti bilan to'qnashmasin: ikkalasi ham bir xil
    // endpointni chaqiradi, lekin bu yerdagi ro'yxat filtrsiz va sahifalanmagan
    queryKey: ['debts', 'factory-orders', 'inline', factoryId],
    queryFn: () => endpoints.debtsFactoryOrders({ factoryId, pageSize: 200 }) as Promise<FactoryOrdersResponse>,
  });

  if (q.isLoading) return <Skeleton active paragraph={{ rows: 3 }} title={false} />;
  if (q.isError) {
    return <ErrorState error={q.error} onRetry={() => void q.refetch()} message="Buyurtmalarni yuklab bo'lmadi" />;
  }

  const rows = q.data?.items ?? [];
  if (rows.length === 0) return <Caption>{t("Ochiq zavod qarzi bo'lgan buyurtma yo'q.")}</Caption>;

  const columns: TableProps<FactoryOrderDebtRow>['columns'] = [
    { title: t('Buyurtma'), key: 'orderNo', render: (_, r) => <Link to={`/orders/${r.id}`}>{r.orderNo}</Link> },
    { title: t('Sana'), key: 'date', render: (_, r) => fmtDate(r.date) },
    { title: t('Mijoz'), key: 'client', ellipsis: true, render: (_, r) => r.client.name },
    {
      title: t("To'lov usuli"),
      key: 'intent',
      width: 180,
      render: (_, r) => <IntentCell row={r} editable={canEditIntent} />,
    },
    {
      title: t('Zavodga qarzimiz'),
      key: 'open',
      align: 'right',
      width: 170,
      className: 'num',
      render: (_, r) => (
        <Flex vertical align="flex-end" gap={0}>
          <MoneyCell value={r.open} variant="weOwe" strong />
          {r.factoryPayIntent === 'UNKNOWN' ? <Caption>{t("o'tkazma narxida")}</Caption> : null}
        </Flex>
      ),
    },
    {
      title: '',
      key: 'actions',
      width: 150,
      render: (_, r) => orderRowActions(r, { t, canPay, onPay, navigate }),
    },
  ];

  return (
    <div>
      <Table<FactoryOrderDebtRow>
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={rows}
        pagination={false}
        scroll={isDesktop ? undefined : { x: 'max-content' }}
      />
      <Flex align="baseline" justify="space-between" wrap gap={8} style={{ marginTop: 6 }}>
        <Caption>{t('{n} ta ochiq buyurtma', { n: rows.length })}</Caption>
        <Flex align="baseline" gap={6}>
          <Caption>{t('Jami ochiq qarz')}</Caption>
          <MoneyCell value={q.data?.totals.open ?? 0} variant="weOwe" strong suffix={t("so'm")} />
        </Flex>
      </Flex>
    </div>
  );
}

/**
 * «Buyurtmalar» ko'rinishi — ochiq zavod qarzining O'ZI, har biri bitta qator.
 *
 * Yakun chizig'i SERVERdan keladi ([[totals-above-table]]): ro'yxat server tomonda
 * sahifalanadi, shuning uchun yuklangan 50 qator ustidan hisoblangan «jami» yuqoridagi
 * kartadan kichik chiqar va ikkalasi ham ishonchli ko'rinardi. Chiziqning qamrovi —
 * qidiruv/zavod filtri, HAMMA usul; usul chipi esa faqat pastdagi jadvalni qisqartiradi
 * va bu ochiq yozib qo'yilgan.
 */
function FactoryOrdersBoard({ onPay }: { onPay: (row: FactoryOrderDebtRow) => void }) {
  const uf = useUrlFilters();
  const t = useT();
  const navigate = useNavigate();
  const isPhone = useIsPhone();
  const isDesktop = useIsDesktop();
  const { user } = useAuth();
  const canPay = can(user?.role ?? null, 'payments.create');
  const canEditIntent = can(user?.role ?? null, 'orders.edit');

  const rawIntent = uf.get('intent');
  const intent = (INTENT_ORDER as string[]).includes(rawIntent) ? (rawIntent as FactoryPayIntent) : undefined;
  const factoryId = uf.get('factoryId') || undefined;
  const search = uf.get('search') || undefined;
  const page = Number(uf.get('page')) || 1;
  const pageSize = Number(uf.get('pageSize')) || 20;

  const q = useQuery({
    queryKey: ['debts', 'factory-orders', { intent, factoryId, search, page, pageSize }],
    queryFn: () =>
      endpoints.debtsFactoryOrders({ intent, factoryId, search, page, pageSize }) as Promise<FactoryOrdersResponse>,
    placeholderData: keepPreviousData,
  });

  const totals = q.data?.totals;
  const rows = q.data?.items ?? [];
  // zavod filtri yorlig'i — nomni qatorlardan olamiz (alohida so'rov qilmaymiz)
  const factoryName = factoryId ? rows[0]?.factory.name : undefined;

  const columns: SbColumn<FactoryOrderDebtRow>[] = [
    {
      title: t('Buyurtma'),
      key: 'orderNo',
      render: (_, r) => (
        <Flex vertical gap={2}>
          <Link to={`/orders/${r.id}`} style={{ fontWeight: 500 }}>
            {r.orderNo}
          </Link>
          <Caption>{fmtDate(r.date)}</Caption>
        </Flex>
      ),
    },
    {
      title: t('Zavod'),
      key: 'factory',
      ellipsis: true,
      render: (_, r) => <Link to={`/factories/${r.factory.id}`}>{r.factory.name}</Link>,
    },
    {
      title: t('Mijoz'),
      key: 'client',
      ellipsis: true,
      render: (_, r) => <Link to={`/clients/${r.client.id}`}>{r.client.name}</Link>,
    },
    {
      title: t("Zavodga to'lov usuli"),
      key: 'intent',
      width: 180,
      render: (_, r) => <IntentCell row={r} editable={canEditIntent} />,
    },
    {
      title: t("Tannarx (so'm)"),
      key: 'costTotal',
      align: 'right',
      width: 150,
      className: 'num',
      render: (_, r) => <MoneyCell value={r.costTotal} variant="neutral" />,
    },
    {
      title: t("To'langan (so'm)"),
      key: 'paid',
      align: 'right',
      width: 150,
      className: 'num',
      render: (_, r) =>
        num(r.factoryPaid) > 0 ? (
          <MoneyCell value={r.factoryPaid} variant="in" />
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    {
      title: t("Qolgan qarz (so'm)"),
      key: 'open',
      align: 'right',
      width: 175,
      className: 'num',
      // «Aniq emas» buyurtmaning qarzi BITTA raqam emas — bu ustun uni o'tkazma
      // bazasida ko'rsatadi (tannarx shunday langarlangan). Buni aytib qo'yish shart,
      // aks holda naqd bilan to'laganda summa nega o'zgarganini hech kim tushunmaydi.
      render: (_, r) => (
        <Flex vertical align="flex-end" gap={0}>
          <MoneyCell value={r.open} variant="weOwe" strong />
          {r.factoryPayIntent === 'UNKNOWN' ? <Caption>{t("o'tkazma narxida")}</Caption> : null}
        </Flex>
      ),
    },
    {
      title: '',
      key: 'actions',
      width: 150,
      render: (_, r) => orderRowActions(r, { t, canPay, onPay, navigate }),
    },
  ];

  const toolbar = (
    <Flex vertical gap={8}>
      <Flex align="center" wrap gap={8}>
        <Input.Search
          allowClear
          placeholder={t('Buyurtma / mijoz / zavod qidirish')}
          defaultValue={uf.get('search')}
          style={{ width: isPhone ? '100%' : 280, minWidth: isPhone ? 0 : undefined }}
          onSearch={(v) => uf.set({ search: v || null })}
        />
        {/* `size="large"` FAQAT telefonda — teginish nishoni 44px dan past tushmasin (§4) */}
        <Segmented
          block={isPhone}
          size={isPhone ? 'large' : undefined}
          value={intent ?? 'hammasi'}
          options={[
            { label: t('Hammasi'), value: 'hammasi' },
            { label: t('Naqd'), value: 'CASH' },
            { label: t("O'tkazma"), value: 'BANK' },
            { label: t('Aniq emas'), value: 'UNKNOWN' },
          ]}
          onChange={(v) => uf.set({ intent: v === 'hammasi' ? null : String(v) })}
        />
        {factoryId ? (
          // bitta zavodga qisqartirilgan ko'rinish — filtr KO'RINIB tursin va bir bosishda yechilsin
          <Button size="small" icon={<CloseOutlined />} onClick={() => uf.set({ factoryId: null })}>
            {t('Zavod: {name}', { name: factoryName ?? '…' })}
          </Button>
        ) : null}
      </Flex>
      <Caption>
        {t(
          "Har qator — bitta buyurtmaning zavod oldidagi qoldig'i (tannarx − to'langani). To'lov usuli tannarx qaysi narx kitobidan o'qilishini belgilaydi.",
        )}
      </Caption>
      {intent ? <Caption>{t(chipCaption)}</Caption> : null}
    </Flex>
  );

  return (
    <Flex vertical gap={12}>
      <SummaryStrip
        hidden={!totals}
        scopeLabel={t("Ochiq zavod qarzi — hamma to'lov usullari")}
        figures={[
          { key: 'open', label: 'Jami ochiq qarz', value: String(totals?.open ?? 0), variant: 'owedToUs', strong: true },
          { key: 'cash', label: 'Naqd', value: String(totals?.cash ?? 0), variant: 'neutral' },
          { key: 'bank', label: "O'tkazma", value: String(totals?.bank ?? 0), variant: 'neutral' },
          { key: 'unknown', label: 'Aniq emas', value: String(totals?.unknown ?? 0), variant: 'neutral' },
          { key: 'count', label: 'Buyurtma', value: totals?.count ?? 0, variant: 'count', suffix: t('ta') },
        ]}
        note={
          intent
            ? t('Jadvalda: {n} ta · {sum} so\'m — yuqoridagi yakun hamma usulni qamraydi', {
                n: q.data?.filtered.count ?? 0,
                sum: fmtMoney(q.data?.filtered.open ?? 0),
              })
            : t('Butun bazadan hisoblanadi — sahifadagi qatorlardan emas')
        }
      />

      <TableCard toolbar={toolbar}>
        <DataTable<FactoryOrderDebtRow>
          columns={columns}
          query={{
            data: q.data
              ? { items: rows, total: q.data.total, page: q.data.page, pageSize: q.data.pageSize }
              : undefined,
            isLoading: q.isLoading,
            isFetching: q.isFetching,
            isError: q.isError,
            error: q.error,
            refetch: q.refetch,
          }}
          rowKey="id"
          onRowOpen={(r) => navigate(`/orders/${r.id}`)}
          filterKeys={['search', 'intent', 'factoryId']}
          emptyText="Zavodga ochiq qarzi bor buyurtma yo'q — hammasi to'langan"
          scroll={isDesktop ? { x: 1320 } : { x: 'max-content' }}
          mobileCard={(r) => ({
            title: r.orderNo,
            subtitle: `${fmtDate(r.date)} · ${r.factory.name}`,
            value: <MoneyCell value={r.open} variant="weOwe" strong suffix={t("so'm")} />,
            meta: (
              <ChipRail>
                <StatusChip meta={FACTORY_PAY_INTENT[r.factoryPayIntent]} />
                <span className="sb-mcard__chip">{r.client.name}</span>
              </ChipRail>
            ),
            lines: [
              { label: 'Tannarx', value: <MoneyCell value={r.costTotal} variant="neutral" suffix={t("so'm")} /> },
              ...(num(r.factoryPaid) > 0
                ? [{ label: "To'langan", value: <MoneyCell value={r.factoryPaid} variant="in" suffix={t("so'm")} /> }]
                : []),
            ],
            actions: orderRowActions(r, { t, canPay, onPay, navigate, mobile: true }),
          })}
        />
      </TableCard>
    </Flex>
  );
}

/**
 * «Aniq emas» buyurtmani to'lashdan OLDINGI qadam — qaysi kanal bilan?
 *
 * Buyurtmaning usuli tanlanmagan bo'lsa, uning qarzi BITTA raqam emas: naqd narxida
 * boshqa, o'tkazma narxida boshqa (doskadagi «Qolgan qarz» ustuni o'tkazma bazasida
 * yozilgan, chunki tannarx shunday langar tashlagan). Kompozitorni jimgina «Naqd» bilan
 * ochish ikki yomonlikning birini qilardi: yo server 400 qaytarardi («bu narxda ko'pi
 * bilan X yopiladi»), yo foydalanuvchi summani qirqib, buyurtmaning tannarxini
 * O'ZI TANLAMAGAN narx kitobiga qotirib qo'yardi. Shuning uchun tanlov OCHIQ so'raladi
 * va har bir kanal yonida o'sha kanaldagi ANIQ qoldiq turadi (server `factoryCoverage`).
 *
 * Narxi yo'q kanal bosilmaydi — server baribir rad etadi (`assertChannelPriced`),
 * sababi esa shu yerda nomi bilan aytiladi.
 */
function ChannelChoiceModal({
  row,
  onPick,
  onCancel,
}: {
  row?: FactoryOrderDebtRow;
  onPick: (method: PaymentMethod, amount: Money) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const q = useQuery({
    queryKey: ['orders', row?.id],
    queryFn: () => endpoints.order(row!.id),
    enabled: !!row,
  });
  const cov = q.data?.factoryCoverage;

  const option = (
    method: PaymentMethod,
    label: string,
    amount: Money | undefined,
    priced: boolean,
    missing: string[],
  ) => (
    <Button
      key={method}
      block
      size="large"
      style={{ height: 'auto', padding: '12px 16px', minHeight: TOUCH_MIN, textAlign: 'left' }}
      disabled={!priced || amount == null}
      onClick={() => onPick(method, amount as Money)}
    >
      <Flex vertical gap={2} style={{ width: '100%' }}>
        <Flex align="baseline" justify="space-between" gap={8} wrap>
          <span style={{ fontWeight: 500 }}>{t(label)}</span>
          {amount != null ? <MoneyCell value={amount} variant="weOwe" strong suffix={t("so'm")} /> : null}
        </Flex>
        {/* Sana — narx kitobi buyurtmaning O'Z sanasida o'qiladi, ya'ni «narx yo'q» degani
            ko'pincha «SHU SANADA yo'q» degani. Sanasiz yozuv egasini narxni bugungi kun
            bilan kiritishga va shu to'siqqa qaytishga majbur qilardi (2026-07-28). */}
        {!priced ? (
          <Caption>
            {t('Zavod {channel} narxi {date} sanasida kuchda emas: {who} — «Mahsulotlar» → «Narxlar» da shu sanadan kiriting', {
              channel: method === 'CASH' ? t('naqd') : t("o'tkazma"),
              date: fmtDate(q.data?.date ?? row?.date),
              who: missing.join(', ') || '—',
            })}
          </Caption>
        ) : null}
      </Flex>
    </Button>
  );

  return (
    <Modal
      open={!!row}
      onCancel={onCancel}
      footer={null}
      title={row ? t("{no} — qaysi kanal bilan to'laysiz?", { no: row.orderNo }) : undefined}
      destroyOnHidden
    >
      {q.isLoading ? (
        <Skeleton active paragraph={{ rows: 2 }} title={false} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} message="Buyurtmani yuklab bo'lmadi" />
      ) : (
        <Flex vertical gap={10}>
          <Caption>
            {t(
              "Bu buyurtmaning «zavodga to'lov usuli» hali tanlanmagan, shuning uchun qarzi har kanalda boshqacha. Tanlagan kanalingiz tannarx qaysi narx kitobidan o'qilishini belgilaydi.",
            )}
          </Caption>
          {option(
            'CASH',
            'Naqd bilan',
            cov?.remainingCash,
            cov?.hasCashPrice !== false,
            cov?.missingCashPriceProducts ?? [],
          )}
          {option(
            'BANK',
            "O'tkazma bilan",
            cov?.remainingBank,
            cov?.hasBankPrice !== false,
            cov?.missingBankPriceProducts ?? [],
          )}
        </Flex>
      )}
    </Modal>
  );
}

/**
 * Zavodlar tabining qobig'i: ko'rinish almashtirgichi + IKKALA ko'rinish uchun BITTA
 * buyurtma-to'lov kompozitori (zavod qatoridan ochilgan ichki ro'yxat ham, «Buyurtmalar»
 * doskasi ham o'sha to'lovni ochadi — ikkita nusxa ikki xil qoida bo'lib ketardi).
 */
function ZavodlarBoard() {
  const uf = useUrlFilters();
  const t = useT();
  const isPhone = useIsPhone();
  const rawView = uf.get('view');
  // `intent` — kartalardan kelgan chuqur havola; u bo'lsa ko'rinish o'z-o'zidan buyurtmalar
  const view: ZavodView = rawView === 'buyurtmalar' || uf.get('intent') || uf.get('factoryId') ? 'buyurtmalar' : 'zavodlar';

  const [pay, setPay] = useState<{
    open: boolean;
    row?: FactoryOrderDebtRow;
    /** «aniq emas» buyurtmada foydalanuvchi tanlagan kanal + o'sha kanaldagi aniq qoldiq */
    method?: PaymentMethod;
    amount?: Money;
  }>({ open: false });
  /** kanal so'raladigan buyurtma (faqat «aniq emas»); tanlangach kompozitor ochiladi */
  const [ask, setAsk] = useState<FactoryOrderDebtRow | undefined>();

  const openPay = (row: FactoryOrderDebtRow) => {
    const method = METHOD_FOR_INTENT[row.factoryPayIntent];
    // usul buyurtmadan MA'LUM — summa ham o'sha kanalda langarlangan, so'rashga hojat yo'q
    if (method) setPay({ open: true, row, method, amount: row.open });
    else setAsk(row);
  };

  return (
    <Flex vertical gap={12}>
      <Segmented
        block={isPhone}
        size={isPhone ? 'large' : undefined}
        value={view}
        options={[
          { label: t('Zavodlar'), value: 'zavodlar' },
          { label: t('Buyurtmalar'), value: 'buyurtmalar' },
        ]}
        // ko'rinish almashsa filtrlar ham almashadi — ular boshqa-boshqa ro'yxatniki
        onChange={(v) =>
          uf.set({ view: String(v), search: null, chip: null, intent: null, factoryId: null, page: null })
        }
        style={isPhone ? undefined : { alignSelf: 'flex-start' }}
      />

      {view === 'buyurtmalar' ? <FactoryOrdersBoard onPay={openPay} /> : <FactoriesBoard onPayOrder={openPay} />}

      <ChannelChoiceModal
        row={ask}
        onCancel={() => setAsk(undefined)}
        onPick={(method, amount) => {
          const row = ask;
          setAsk(undefined);
          if (row) setPay({ open: true, row, method, amount });
        }}
      />

      {/* Bitta buyurtmaga to'lov: summa va usul BIR KANALDAN — usuli ma'lum buyurtmada
          buyurtmaning o'zidan, «aniq emas» buyurtmada esa foydalanuvchi yuqorida
          tanlagan kanaldan. To'lov saqlanishi bilan AYNI SHU buyurtmaga taqsimlanadi
          (DTO `allocations` bilan ketadi) — avansga tushmaydi va alohida «taqsimlash»
          qadami kerak emas. */}
      <PaymentComposer
        open={pay.open}
        // qator SAQLANADI: `row`ni darrov tashlab yuborish yopilish animatsiyasi
        // davomida `presetOrder`ni yo'qotardi va drawer bir lahza «buyurtma tanlash»
        // rejimiga o'tib ko'rinardi
        onClose={() => setPay((p) => ({ ...p, open: false }))}
        kind="FACTORY_OUT"
        lockParty
        presetParty={
          pay.row ? { id: pay.row.factory.id, type: 'factory', name: pay.row.factory.name } : undefined
        }
        presetOrder={pay.row ? { id: pay.row.id, orderNo: pay.row.orderNo } : undefined}
        presetAmount={pay.amount}
        presetMethod={pay.method}
      />
    </Flex>
  );
}

// ─────────────────────────── §7.4 Shofyorlar board (A/B) ───────────────────────────

function ShofyorlarBoard() {
  const navigate = useNavigate();
  const uf = useUrlFilters();
  const t = useT();
  const isPhone = useIsPhone();
  const isDesktop = useIsDesktop();
  const search = (uf.get('search') || '').trim().toLowerCase();

  const q = useQuery({
    queryKey: ['vehicles', 'debts-board'],
    // pageSize 200 = the @Max(200) API ceiling; the default 50 hid driver debt.
    queryFn: () => endpoints.vehicles({ pageSize: 200 }),
  });

  const [composer, setComposer] = useState<{ open: boolean; kind: PaymentKind; row?: Vehicle }>({
    open: false,
    kind: 'VEHICLE_OUT',
  });

  const rows = useMemo(() => {
    let list = (asItems(q.data) as Vehicle[]).slice();
    if (search) {
      list = list.filter((v) => [v.name, v.plate ?? '', v.driver ?? ''].some((f) => f.toLowerCase().includes(search)));
    }
    // only drivers WE OWE (debt board) — settled / prepaid vehicles are hidden
    list = list.filter((v) => num(v.balance) < 0 && !isSettled(v.balance ?? '0'));
    // owed-first: most negative balance (biggest debt to the driver) at the top
    return list.sort((a, b) => num(a.balance) - num(b.balance));
  }, [q.data, search]);

  // desktop qatori HAM telefon kartasi footeri — bitta manba, amallar to'liq
  //
  // «Mijoz to'lagan deb yozish» (TRANSPORT_DIRECT) SHU YERDAN OLIB TASHLANDI: bu doska
  // faqat DILLER qarzdor bo'lgan shofyorlarni ko'rsatadi (DEALER_ABSORBED), «Shofyorga
  // mijoz to'laydi» rejimida esa diller umuman qarzdor emas. Ustiga-ustak API endi
  // TRANSPORT_DIRECT ni buyurtmaga bog'lanmagan holda qabul qilmaydi — moshina qatorida
  // buyurtma konteksti yo'q. Yagona yo'l: buyurtma kartasi → «Shofyorga to'landi deb yozish».
  const rowMenu = (r: Vehicle): MenuProps => ({
    items: [
      { key: 'card', label: t('Moshina kartasi'), onClick: () => navigate(`/vehicles/${r.id}`) },
    ],
  });

  const rowActions = (r: Vehicle, mobile = false) => (
    <Flex
      gap={mobile ? 8 : 6}
      justify={mobile ? undefined : 'flex-end'}
      align="center"
      style={mobile ? { width: '100%' } : undefined}
    >
      <Button
        size={mobile ? 'middle' : 'small'}
        type="primary"
        style={mobile ? { flex: 1, minWidth: 0, minHeight: TOUCH_MIN } : undefined}
        onClick={() => setComposer({ open: true, kind: 'VEHICLE_OUT', row: r })}
      >
        {t("Shofyorga to'lash")}
      </Button>
      <Dropdown trigger={['click']} menu={rowMenu(r)}>
        <Button
          size={mobile ? 'middle' : 'small'}
          icon={<MoreOutlined />}
          aria-label={t('{name} amallari', { name: r.name })}
        />
      </Dropdown>
    </Flex>
  );

  const columns: SbColumn<Vehicle>[] = [
    {
      title: 'Moshina',
      key: 'name',
      render: (_, r) => (
        <Flex vertical gap={2}>
          <Link to={`/vehicles/${r.id}`} style={{ fontWeight: 500 }}>
            {r.name}
          </Link>
          <Caption>{[r.plate, r.driver].filter(Boolean).join(' · ') || '—'}</Caption>
        </Flex>
      ),
    },
    {
      title: 'Telefon',
      key: 'phone',
      width: 150,
      render: (_, r) => (r.phone ? <a href={`tel:${r.phone}`}>{r.phone}</a> : <Typography.Text type="secondary">—</Typography.Text>),
    },
    {
      title: 'Balans',
      key: 'balance',
      align: 'right',
      width: 190,
      render: (_, r) => <BalanceTag balance={r.balance ?? '0'} partyType="vehicle" />,
    },
    {
      title: '',
      key: 'actions',
      width: 230,
      render: (_, r) => rowActions(r),
    },
  ];

  return (
    <Flex vertical gap={12}>
      <TableCard
        toolbar={
          <Input.Search
            allowClear
            placeholder={t('Moshina / raqam / shofyor qidirish')}
            defaultValue={uf.get('search')}
            style={{ width: isPhone ? '100%' : 280, minWidth: isPhone ? 0 : undefined }}
            onSearch={(v) => uf.set({ search: v || null })}
          />
        }
      >
        <DataTable<Vehicle>
          columns={columns}
          query={{
            data: rows,
            isLoading: q.isLoading,
            isFetching: q.isFetching,
            isError: q.isError,
            error: q.error,
            refetch: q.refetch,
          }}
          rowKey="id"
          onRowOpen={(r) => navigate(`/vehicles/${r.id}`)}
          filterKeys={['search']}
          emptyText="Moshina topilmadi"
          scroll={isDesktop ? { x: 760 } : { x: 'max-content' }}
          mobileCard={(r) => ({
            title: r.name,
            subtitle: [r.plate, r.driver].filter(Boolean).join(' · ') || '—',
            value: <BalanceTag balance={r.balance ?? '0'} partyType="vehicle" compact />,
            meta: r.phone ? (
              <ChipRail>
                {/* teginish uchun chip balandligi oshiriladi — raqam terish maqsadli amal */}
                <a
                  className="sb-mcard__chip"
                  href={`tel:${r.phone}`}
                  style={{ minHeight: 32, fontSize: 13 }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {r.phone}
                </a>
              </ChipRail>
            ) : undefined,
            actions: rowActions(r, true),
          })}
        />
      </TableCard>

      <PaymentComposer
        open={composer.open}
        onClose={() => setComposer((c) => ({ ...c, open: false }))}
        kind={composer.kind}
        presetParty={composer.row ? { id: composer.row.id, type: 'vehicle', name: composer.row.name, balance: composer.row.balance } : undefined}
        presetAmount={
          composer.kind === 'VEHICLE_OUT' && composer.row && num(composer.row.balance) < 0
            ? String(Math.abs(num(composer.row.balance)))
            : undefined
        }
        lockParty
      />
    </Flex>
  );
}

// ─────────────────────────── §7.5 Paddonlar board (A/B/G) ───────────────────────────

interface PalletReturnValues {
  qty: number;
  date: dayjs.Dayjs;
  note?: string;
}

interface PalletFactoryRow {
  factory: { id: string; name: string };
  balance: number;
}

/** Zavodga qaytarish PULSIZ — faqat son (shu bois narx maydoni yo'q). */
interface FactoryReturnValues {
  qty: number;
  date: dayjs.Dayjs;
  note?: string;
}

function PaddonlarBoard() {
  const navigate = useNavigate();
  const uf = useUrlFilters();
  const t = useT();
  const isPhone = useIsPhone();
  const isDesktop = useIsDesktop();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const { user } = useAuth();
  const canMutate = can(user?.role ?? null, 'pallets.mutate');
  const search = (uf.get('search') || '').trim().toLowerCase();

  const q = useQuery({
    queryKey: ['pallets', 'balances'],
    queryFn: () => endpoints.palletBalances(),
  });

  const [ret, setRet] = useState<{ open: boolean; row?: PalletClientRow }>({ open: false });
  const [form] = Form.useForm<PalletReturnValues>();

  useEffect(() => {
    if (ret.open) {
      form.resetFields();
      form.setFieldsValue({ date: dayjs() });
    }
  }, [ret.open, form]);

  const returnMut = useMutation({
    mutationFn: (d: object) => endpoints.palletClientReturn(d),
    onSuccess: () => {
      message.success(t('Paddon qaytarilishi qabul qilindi'));
      for (const key of ['pallets', 'clients', 'debts', 'dashboard']) qc.invalidateQueries({ queryKey: [key] });
      setRet({ open: false });
    },
    onError: (e) => message.error(apiError(e)),
  });

  // ── factory-return drawer (capped at loose in-hand AND what we owe that factory) ──
  const [fret, setFret] = useState<{ open: boolean; row?: PalletFactoryRow }>({ open: false });
  const [fform] = Form.useForm<FactoryReturnValues>();
  useEffect(() => {
    if (fret.open) {
      fform.resetFields();
      fform.setFieldsValue({ date: dayjs() });
    }
  }, [fret.open, fform]);
  const factoryReturnMut = useMutation({
    mutationFn: (d: object) => endpoints.palletFactoryReturn(d),
    onSuccess: () => {
      message.success(t('Paddon zavodga qaytarildi'));
      for (const key of ['pallets', 'factories', 'debts', 'dashboard']) qc.invalidateQueries({ queryKey: [key] });
      setFret({ open: false });
    },
    onError: (e) => message.error(apiError(e)),
  });

  // ── pallet totals (ADMIN/ACCOUNTANT see factory + loose-stock data; AGENT: own clients only) ──
  const isFin = can(user?.role ?? null, 'debts.summary');
  const view = uf.get('view') === 'zavodlar' && isFin ? 'zavodlar' : 'mijozlar';
  const factoriesAll = (q.data?.factories ?? []) as PalletFactoryRow[];
  const dealerInHand = q.data?.dealerInHand ?? 0;
  const fromClients = useMemo(
    () => ((q.data?.clients ?? []) as PalletClientRow[]).reduce((a, r) => a + Math.max(0, r.balance), 0),
    [q.data],
  );
  const toFactories = useMemo(() => factoriesAll.reduce((a, r) => a + Math.max(0, r.balance), 0), [factoriesAll]);

  const rows = useMemo(() => {
    const all = (q.data?.clients ?? []) as PalletClientRow[];
    // only clients who HOLD our pallets (owe a return); settled clients are hidden
    const owing = all.filter((r) => r.balance > 0);
    const list = search ? owing.filter((r) => r.client.name.toLowerCase().includes(search)) : owing.slice();
    return list.sort((a, b) => b.balance - a.balance);
  }, [q.data, search]);

  const factoryRows = useMemo(() => {
    // factories WE STILL OWE pallets to (positive balance); settled ones hidden
    const owing = factoriesAll.filter((r) => r.balance > 0);
    const list = search ? owing.filter((r) => r.factory.name.toLowerCase().includes(search)) : owing.slice();
    return list.sort((a, b) => b.balance - a.balance);
  }, [factoriesAll, search]);

  const qty = Form.useWatch('qty', form);
  const fqty = Form.useWatch('qty', fform);
  const currentBal = ret.row?.balance ?? 0;

  // factory-return cap = min(loose in-hand, what we owe that factory) — «undan ortiq berib bo'lmaydi»
  const factoryOwed = fret.row?.balance ?? 0;
  const factoryCap = Math.max(0, Math.min(dealerInHand, factoryOwed));

  const summaryCards: StatCardProps[] = [
    ...(isFin
      ? [{ label: "Diller qo'lida", value: dealerInHand, variant: 'neutral' as const, suffix: 'dona', size: 'md' as const }]
      : []),
    { label: 'Mijozlardan olinadigan', value: fromClients, variant: 'neutral' as const, suffix: 'dona', size: 'md' as const },
    ...(isFin
      ? [{ label: 'Zavodlarga beriladigan', value: toFactories, variant: 'weOwe' as const, suffix: 'dona', size: 'md' as const }]
      : []),
  ];

  // desktop qatorlari HAM telefon kartasi footerlari — bitta manba (§2.2.4)
  const factoryMenu = (r: PalletFactoryRow): MenuProps => ({
    items: [
      { key: 'card', label: t('Zavod kartasi'), onClick: () => navigate(`/factories/${r.factory.id}`) },
      { key: 'moves', label: t('Paddon harakati'), onClick: () => navigate(`/pallets?factoryId=${r.factory.id}`) },
    ],
  });

  const factoryActions = (r: PalletFactoryRow, mobile = false) => (
    <Flex
      gap={mobile ? 8 : 6}
      justify={mobile ? undefined : 'flex-end'}
      align="center"
      style={mobile ? { width: '100%' } : undefined}
    >
      {canMutate ? (
        <Button
          size={mobile ? 'middle' : 'small'}
          type="primary"
          style={mobile ? { flex: 1, minWidth: 0, minHeight: TOUCH_MIN } : undefined}
          onClick={() => setFret({ open: true, row: r })}
        >
          {t('Zavodga qaytarish')}
        </Button>
      ) : null}
      <Dropdown trigger={['click']} menu={factoryMenu(r)}>
        <Button
          size={mobile ? 'middle' : 'small'}
          icon={<MoreOutlined />}
          aria-label={t('{name} amallari', { name: r.factory.name })}
        />
      </Dropdown>
    </Flex>
  );

  const clientMenu = (r: PalletClientRow): MenuProps => ({
    items: [
      { key: 'card', label: t('Mijoz kartasi'), onClick: () => navigate(`/clients/${r.client.id}`) },
      { key: 'moves', label: t('Paddon harakati'), onClick: () => navigate(`/pallets?clientId=${r.client.id}`) },
    ],
  });

  const clientActions = (r: PalletClientRow, mobile = false) => (
    <Flex
      gap={mobile ? 8 : 6}
      justify={mobile ? undefined : 'flex-end'}
      align="center"
      style={mobile ? { width: '100%' } : undefined}
    >
      {canMutate ? (
        <Button
          size={mobile ? 'middle' : 'small'}
          type="primary"
          style={mobile ? { flex: 1, minWidth: 0, minHeight: TOUCH_MIN } : undefined}
          onClick={() => setRet({ open: true, row: r })}
        >
          {t('Paddon qaytarish')}
        </Button>
      ) : null}
      <Dropdown trigger={['click']} menu={clientMenu(r)}>
        <Button
          size={mobile ? 'middle' : 'small'}
          icon={<MoreOutlined />}
          aria-label={t('{name} amallari', { name: r.client.name })}
        />
      </Dropdown>
    </Flex>
  );

  const factoryColumns: SbColumn<PalletFactoryRow>[] = [
    {
      title: 'Zavod',
      key: 'name',
      render: (_, r) => <Link to={`/factories/${r.factory.id}`}>{r.factory.name}</Link>,
    },
    {
      title: 'Paddon balansi',
      key: 'balance',
      align: 'right',
      width: 160,
      render: (_, r) => <PalletChip pallets={r.balance} />,
    },
    {
      title: '',
      key: 'actions',
      width: 220,
      render: (_, r) => factoryActions(r),
    },
  ];

  const columns: SbColumn<PalletClientRow>[] = [
    {
      title: 'Mijoz',
      key: 'name',
      render: (_, r) => <Link to={`/clients/${r.client.id}`}>{r.client.name}</Link>,
    },
    {
      title: 'Paddon balansi',
      key: 'balance',
      align: 'right',
      width: 160,
      render: (_, r) => <PalletChip pallets={r.balance} />,
    },
    {
      title: '',
      key: 'actions',
      width: 220,
      render: (_, r) => clientActions(r),
    },
  ];

  const viewSegmented = (
    // telefonda 41px bosiladigan element (desktopda prop yo'q — o'zgarishsiz)
    <Segmented
      size={isPhone ? 'large' : undefined}
      value={view}
      options={[
        { label: t('Mijozlardan olinadigan'), value: 'mijozlar' },
        { label: t('Zavodlarga beriladigan'), value: 'zavodlar' },
      ]}
      onChange={(v) => uf.set({ view: v === 'zavodlar' ? 'zavodlar' : null, search: null })}
    />
  );

  const boardToolbar = (
    <Flex vertical gap={8}>
      <Caption>{t('Paddon — pul emas, dona hisobidagi qarz.')}</Caption>
      <Flex align="center" wrap gap={8}>
        {/* Yorliqlar uzun («Mijozlardan olinadigan») — telefonda `block` ularni
            kesib qo'yardi, shuning uchun o'z qatorida gorizontal skroll qiladi. */}
        {isFin ? (
          isPhone ? (
            <div className="sb-scroll-x" style={{ flex: '1 1 100%', maxWidth: '100%' }}>
              {viewSegmented}
            </div>
          ) : (
            viewSegmented
          )
        ) : null}
        <Input.Search
          key={view}
          allowClear
          placeholder={view === 'zavodlar' ? t('Zavod qidirish') : t('Mijoz qidirish')}
          defaultValue={uf.get('search')}
          style={{ width: isPhone ? '100%' : 240, minWidth: isPhone ? 0 : undefined }}
          onSearch={(v) => uf.set({ search: v || null })}
        />
      </Flex>
    </Flex>
  );

  return (
    <Flex vertical gap={16}>
      <KpiBand label="PADDON HISOBI" cards={summaryCards} />
      <TableCard toolbar={boardToolbar}>
        {view === 'zavodlar' ? (
          <DataTable<PalletFactoryRow>
            columns={factoryColumns}
            query={{
              data: factoryRows,
              isLoading: q.isLoading,
              isFetching: q.isFetching,
              isError: q.isError,
              error: q.error,
              refetch: q.refetch,
            }}
            rowKey={(r) => r.factory.id}
            onRowOpen={(r) => navigate(`/factories/${r.factory.id}`)}
            filterKeys={['search']}
            emptyText="Zavodga qaytariladigan paddon yo'q"
            scroll={isDesktop ? { x: 620 } : { x: 'max-content' }}
            mobileCard={(r) => ({
              title: r.factory.name,
              value: <PalletChip pallets={r.balance} />,
              actions: factoryActions(r, true),
            })}
          />
        ) : (
          <DataTable<PalletClientRow>
            columns={columns}
            query={{
              data: rows,
              isLoading: q.isLoading,
              isFetching: q.isFetching,
              isError: q.isError,
              error: q.error,
              refetch: q.refetch,
            }}
            rowKey={(r) => r.client.id}
            onRowOpen={(r) => navigate(`/clients/${r.client.id}`)}
            filterKeys={['search']}
            emptyText="Mijozda paddon yo'q"
            scroll={isDesktop ? { x: 620 } : { x: 'max-content' }}
            mobileCard={(r) => ({
              title: r.client.name,
              value: <PalletChip pallets={r.balance} />,
              actions: clientActions(r, true),
            })}
          />
        )}
      </TableCard>

      <FormDrawer
        title={ret.row ? t('Paddon qaytarish — {name}', { name: ret.row.client.name }) : t('Paddon qaytarish')}
        open={ret.open}
        onClose={() => setRet({ open: false })}
        onSubmit={() => form.submit()}
        submitting={returnMut.isPending}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(v) =>
            returnMut.mutate({
              clientId: ret.row?.client.id,
              qty: v.qty,
              date: v.date.format('YYYY-MM-DD'),
              note: v.note?.trim() ? v.note.trim() : undefined,
            })
          }
        >
          <Form.Item name="qty" label={t('Soni (dona)')} rules={[{ required: true, message: t('Sonini kiriting') }]}>
            <InputNumber min={1} precision={0} style={{ width: '100%' }} placeholder="0" />
          </Form.Item>
          <Form.Item name="date" label={t('Sana')} rules={[{ required: true, message: t('Sanani tanlang') }]}>
            <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" allowClear={false} />
          </Form.Item>
          <Form.Item name="note" label={t('Izoh')}>
            <Input.TextArea rows={2} maxLength={500} placeholder={t('Izoh (ixtiyoriy)')} />
          </Form.Item>
          <Flex
            align="center"
            justify="space-between"
            wrap
            gap={8}
            style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(127,127,127,0.08)' }}
          >
            <Caption>{t('Joriy → keyingi balans')}</Caption>
            <span style={{ whiteSpace: 'nowrap' }}>
              <PalletChip pallets={currentBal} compact />
              <span style={{ margin: '0 6px' }}>→</span>
              <PalletChip pallets={currentBal - (Number(qty) || 0)} compact />
            </span>
          </Flex>
        </Form>
      </FormDrawer>

      <FormDrawer
        title={
          fret.row
            ? t('Zavodga paddon qaytarish — {name}', { name: fret.row.factory.name })
            : t('Zavodga paddon qaytarish')
        }
        open={fret.open}
        onClose={() => setFret({ open: false })}
        onSubmit={() => fform.submit()}
        submitting={factoryReturnMut.isPending}
      >
        <Form
          form={fform}
          layout="vertical"
          onFinish={(v) =>
            factoryReturnMut.mutate({
              factoryId: fret.row?.factory.id,
              qty: v.qty,
              date: v.date.format('YYYY-MM-DD'),
              note: v.note?.trim() ? v.note.trim() : undefined,
            })
          }
        >
          <Form.Item
            name="qty"
            label={t('Soni (dona)')}
            extra={t("Maksimum: {cap} dona (qo'lda {hand}, zavod oldida {owed})", {
              cap: factoryCap,
              hand: dealerInHand,
              owed: factoryOwed,
            })}
            rules={[
              { required: true, message: t('Sonini kiriting') },
              () => ({
                validator: (_, value) =>
                  Number(value) > factoryCap
                    ? Promise.reject(new Error(t("Ko'pi bilan {cap} dona qaytarish mumkin", { cap: factoryCap })))
                    : Promise.resolve(),
              }),
            ]}
          >
            <InputNumber min={1} max={factoryCap} precision={0} style={{ width: '100%' }} placeholder="0" />
          </Form.Item>
          <Form.Item name="date" label={t('Sana')} rules={[{ required: true, message: t('Sanani tanlang') }]}>
            <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" allowClear={false} />
          </Form.Item>
          <Form.Item name="note" label={t('Izoh')}>
            <Input.TextArea rows={2} maxLength={500} placeholder={t('Izoh (ixtiyoriy)')} />
          </Form.Item>
          {/* Paddon naturada: qaytarish faqat sonni yopadi — pul hech qayerga ko'chmaydi. */}
          <Flex
            vertical
            gap={6}
            style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(127,127,127,0.08)' }}
          >
            <Flex align="center" justify="space-between" wrap gap={8}>
              <Caption>{t('Joriy → keyingi hisobdorlik')}</Caption>
              <span style={{ whiteSpace: 'nowrap' }}>
                <PalletChip pallets={factoryOwed} compact />
                <span style={{ margin: '0 6px' }}>→</span>
                <PalletChip pallets={factoryOwed - (Number(fqty) || 0)} compact />
              </span>
            </Flex>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t("Pul harakati yo'q — faqat paddon soni hisoblanadi")}
            </Typography.Text>
          </Flex>
        </Form>
      </FormDrawer>
    </Flex>
  );
}

// ─────────────────────────── page shell ───────────────────────────

export default function Debts() {
  const { token } = theme.useToken();
  const t = useT();
  const uf = useUrlFilters();
  const { user } = useAuth();
  const role = user?.role ?? null;
  const isFin = can(role, 'debts.summary'); // A/B only
  const showFleetTabs = can(role, 'vehicles.detail'); // A/B (AGENT: mijozlar + paddonlar)

  const allTabs: { key: TabKey; label: string }[] = [
    { key: 'mijozlar', label: t('Mijozlar') },
    { key: 'zavodlar', label: t('Zavodlar') },
    { key: 'shofyorlar', label: t('Shofyorlar') },
    { key: 'paddonlar', label: t('Paddonlar') },
  ];
  const tabs = showFleetTabs
    ? allTabs
    : allTabs.filter((t) => t.key === 'mijozlar' || t.key === 'paddonlar');

  const rawTab = (uf.get('tab') || 'mijozlar') as TabKey;
  const activeTab: TabKey = tabs.some((t) => t.key === rawTab) ? rawTab : 'mijozlar';

  const changeTab = (key: string) =>
    // `intent` / `factoryId` — Zavodlar tabining «Buyurtmalar» ko'rinishiniki; ular
    // tozalanmasa boshqa tabga o'tib qaytganda ro'yxat jimgina qisqargan bo'lib qolardi
    uf.set({
      tab: key,
      chip: null,
      search: null,
      peek: null,
      panel: null,
      view: null,
      intent: null,
      factoryId: null,
    });

  return (
    <div>
      <PageHeader
        title="Qarzlar"
        subtitle="Qarz va balanslar — mijoz, zavod va shofyor hisoblari"
        accent
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={changeTab}
      />

      <Flex vertical gap={16} style={{ background: token.colorBgLayout }}>
        {isFin ? <SummaryBand /> : null}

        {activeTab === 'mijozlar' ? <MijozlarBoard /> : null}
        {activeTab === 'zavodlar' && showFleetTabs ? <ZavodlarBoard /> : null}
        {activeTab === 'shofyorlar' && showFleetTabs ? <ShofyorlarBoard /> : null}
        {activeTab === 'paddonlar' ? <PaddonlarBoard /> : null}
      </Flex>
    </div>
  );
}
