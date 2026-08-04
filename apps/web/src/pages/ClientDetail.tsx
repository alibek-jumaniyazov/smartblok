// ClientDetail — the archetypal party page (parties.md §2). PartyBalanceHeader
// (balance sentence + CreditGauge + PalletChip + OverdueChip + actions) over
// ?tab= tabs: Hisob-kitob (PartyStatement, windowed) · Buyurtmalar · To'lovlar
// (both server-paginated registers — the 20-row cap dies) · Paddonlar (all-time
// «berilgan − qaytargan = qoldiq» + harakatlar defteri — DAVR FILTRI YO'Q) ·
// Taxalluslar · Maxsus narxlar (grouped by product, in-force highlighted,
// «kelgusi» badges). ?panel=tolov
// opens the prefilled PaymentComposer. Every list surface is URL-synced via
// useUrlFilters; loading/refetch/empty/error follow the platform state law (02 §9).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App,
  Button,
  DatePicker,
  Form,
  Input,
  InputNumber,
  List,
  Segmented,
  Select,
  Skeleton,
  Space,
  Typography,
  theme,
} from 'antd';
import {
  CheckCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  ImportOutlined,
  PlusOutlined,
  PrinterOutlined,
  ShoppingCartOutlined,
  SlidersOutlined,
  StopOutlined,
  UndoOutlined,
  WalletOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { apiError, asItems, endpoints } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { useUrlFilters } from '../lib/useUrlFilters';
import { popupMaxWidth, useIsPhone } from '../lib/responsive';
import { can } from '../lib/permissions';
import { fmtDate, fmtM3, fmtNum, isSettled, num } from '../lib/format';
import { useT } from '../components/LangContext';
import { translate } from '../lib/i18n';
import {
  PALLET_TX,
  PAYMENT_KIND,
  PAYMENT_METHOD,
  STATUS,
  UNRECONCILED,
  type StatusMeta,
} from '../lib/status-maps';
import {
  ClientPalletDrawer,
  DataTable,
  EmptyState,
  ErrorState,
  FormDrawer,
  MoneyCell,
  MoneyInput,
  OrderProductsCell,
  PageHeader,
  PalletChip,
  palletCancelAllowed,
  palletCancelFacts,
  palletCancelKind,
  palletCancelledLabel,
  palletCancelPlaceholder,
  palletCancelSuccess,
  palletCancelTitle,
  PalletStatsPanel,
  hasPalletHistory,
  PartyBalanceHeader,
  PartyStatement,
  PaymentComposer,
  ReasonModal,
  StatusChip,
  TableCard,
  TransactionsJournal,
  type ClientPalletMode,
  type PalletCancelKind,
  type DateRange,
  type PartyHeaderAction,
  type PartyHeaderCounters,
  type SbColumn,
} from '../components';
import { BalanceControlModal } from '../components/BalanceControlModal';
import type {
  Agent,
  ClientRow,
  Money,
  Order,
  Paged,
  PalletPartyStats,
  Payment,
  Product,
} from '../lib/types';

// ─────────────────────────── detail payload shape ───────────────────────────

interface AliasRow {
  id: string;
  name: string;
}

interface PriceRow {
  id: string;
  pricePerM3: Money;
  effectiveFrom: string;
  product?: { id: string; name: string; size?: string | null } | null;
}

interface ClientDetailData extends ClientRow {
  aliases: AliasRow[];
  prices: PriceRow[];
  balance: Money;
  palletBalance: number;
  /** all-time «shu mijozdan qancha pul oldik» — to'liq daftardan (oxirgi 20 dan emas) */
  paymentTotals?: ClientPaymentTotals;
}

/**
 * clients.service.paymentTotals — butun tarix, bekor qilingan hujjatlarsiz.
 * `paidToDriver` `received` dan TASHQARIDA: u pul bizning kassamizdan o'tmagan.
 */
interface ClientPaymentTotals {
  received: Money;
  refunded: Money;
  netReceived: Money;
  paidToDriver: Money;
  paymentCount: number;
  firstPaymentAt?: string | null;
  lastPaymentAt?: string | null;
}

/** the matched row from GET /debts/clients — server-computed overdue facts. */
interface DebtClientRow {
  id: string;
  overdueOrdersCount: number;
  overdueOrdersTotal: Money;
  hasOverdueOrders: boolean;
}

interface ClientFormValues {
  name: string;
  phone?: string | null;
  legalEntity?: string | null;
  agentId?: string | null;
  creditLimit?: string | null;
  paymentTermDays?: number | null;
}

interface PriceFormValues {
  productId: string;
  pricePerM3: string;
  effectiveFrom?: Dayjs | null;
}

const TAB_KEYS = ['hisob', 'buyurtmalar', 'tolovlar', 'paddonlar', 'narxlar'] as const;

function isEditableTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/** Prices are stored at up to 6dp (back-solved lump-sum prices) — never rounded. */
function fmtPrice(v: Money): string {
  return fmtNum(v, 6);
}

// Party-state + special-price chips (04 §4.2 semantic inks) — the ONLY hand-authored
// StatusMeta on this page; every other enum reads its map from lib/status-maps.
const CLIENT_ACTIVE: StatusMeta = {
  light: '#1A7F37',
  dark: '#3FB950',
  get label() {
    return translate('Faol');
  },
};
const CLIENT_INACTIVE: StatusMeta = {
  light: '#6E7781',
  dark: '#8B949E',
  get label() {
    return translate('Nofaol');
  },
};
const PRICE_CURRENT: StatusMeta = {
  light: '#1A7F37',
  dark: '#3FB950',
  get label() {
    return translate('joriy');
  },
};
const PRICE_FUTURE: StatusMeta = {
  light: '#0969DA',
  dark: '#4493F8',
  get label() {
    return translate('kelgusi');
  },
};

/** small section overline (04 §1.3): 11px, 600, uppercase, tertiary ink. */
const overlineStyle = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '.04em',
  textTransform: 'uppercase' as const,
};

// ─────────────────────────── edit drawer (§1.4) ───────────────────────────

function toClientPayload(v: ClientFormValues, office: boolean): Record<string, unknown> {
  const base = {
    name: v.name,
    phone: v.phone ?? null,
    legalEntity: v.legalEntity ?? null,
  };
  if (!office) return base; // AGENT: credit/agent/term are stripped server-side — never sent
  return {
    ...base,
    agentId: v.agentId ?? null,
    creditLimit:
      v.creditLimit === undefined || v.creditLimit === null || v.creditLimit === '' ? null : v.creditLimit,
    paymentTermDays: v.paymentTermDays ?? null,
  };
}

function ClientEditDrawer({
  client,
  open,
  onClose,
  office,
}: {
  client: ClientDetailData;
  open: boolean;
  onClose: () => void;
  office: boolean;
}) {
  const { message } = App.useApp();
  const t = useT();
  const qc = useQueryClient();
  const [form] = Form.useForm<ClientFormValues>();

  const agentsQ = useQuery({ queryKey: ['agents'], queryFn: () => endpoints.agents(), enabled: open && office });
  const agents = asItems<Agent>(agentsQ.data);

  const mut = useMutation({
    mutationFn: (v: ClientFormValues) => endpoints.updateClient(client.id, toClientPayload(v, office)),
    onSuccess: () => {
      message.success(t('Mijoz yangilandi'));
      qc.invalidateQueries({ queryKey: ['clients'] });
      onClose();
    },
    onError: (err) => form.setFields([{ name: 'name', errors: [apiError(err)] }]),
  });

  const submit = () => form.submit();
  const lookupsError = office ? agentsQ.error : null;

  // R4: xom <Drawer> emas — FormDrawer. Telefonda u pastki varaqqa aylanadi va
  // futer tugmalari to'liq kenglikda ustma-ust joylashadi (Ctrl+Enter ham unda).
  return (
    <FormDrawer
      title={t('Mijozni tahrirlash')}
      open={open}
      onClose={onClose}
      onSubmit={submit}
      submitting={mut.isPending}
      width={480}
    >
      {lookupsError ? (
        <div style={{ marginBottom: 12 }}>
          <ErrorState
            error={lookupsError}
            message="Agentlarni yuklab bo'lmadi"
            onRetry={() => {
              if (office) agentsQ.refetch();
            }}
          />
        </div>
      ) : null}
      <Form
        form={form}
        layout="vertical"
        onFinish={(v) => mut.mutate(v)}
        initialValues={{
          name: client.name,
          phone: client.phone ?? undefined,
          legalEntity: client.legalEntity ?? undefined,
          agentId: client.agentId ?? client.agent?.id ?? undefined,
          creditLimit: client.creditLimit != null ? String(num(client.creditLimit)) : undefined,
          paymentTermDays: client.paymentTermDays ?? undefined,
        }}
      >
        <Form.Item name="name" label={t('Nomi')} rules={[{ required: true, message: t('Nomi majburiy') }]}>
          <Input placeholder={t('Mijoz nomi')} />
        </Form.Item>
        <Form.Item name="phone" label={t('Telefon')}>
          <Input placeholder="+998 ..." />
        </Form.Item>
        <Form.Item name="legalEntity" label={t('Yuridik shaxs')}>
          <Input placeholder={t('Firma nomi (ixtiyoriy)')} />
        </Form.Item>
        {office && (
          <Form.Item
            name="agentId"
            label={t('Agent')}
            extra={t("Tarixiy buyurtmalar va to'lovlar avvalgi agent hisobida qoladi")}
          >
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder={t('Agent tanlang')}
              loading={agentsQ.isFetching}
              options={agents.map((a) => ({ value: a.id, label: a.name }))}
            />
          </Form.Item>
        )}
        {office && (
          <Form.Item
            name="creditLimit"
            label={t('Kredit limiti')}
            extra={t("Bo'sh — cheklanmagan; 0 — faqat oldindan to'lov")}
          >
            <MoneyInput min={0} placeholder={t('Cheklanmagan')} />
          </Form.Item>
        )}
        {office && (
          <Form.Item name="paymentTermDays" label={t("To'lov muddati (kun)")}>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
        )}
      </Form>
    </FormDrawer>
  );
}

// ─────────────────────────── price drawer (§2.3) ───────────────────────────

function PriceDrawer({
  clientId,
  open,
  onClose,
}: {
  clientId: string;
  open: boolean;
  onClose: () => void;
}) {
  const { message } = App.useApp();
  const t = useT();
  const qc = useQueryClient();
  const [form] = Form.useForm<PriceFormValues>();

  const productsQ = useQuery({
    queryKey: ['products', 'client-prices'],
    queryFn: () => endpoints.products(),
    enabled: open,
  });
  const products = asItems<Product>(productsQ.data);

  const mut = useMutation({
    mutationFn: (v: PriceFormValues) =>
      endpoints.addClientPrice(clientId, {
        productId: v.productId,
        pricePerM3: v.pricePerM3,
        ...(v.effectiveFrom ? { effectiveFrom: v.effectiveFrom.format('YYYY-MM-DD') } : {}),
      }),
    onSuccess: () => {
      message.success(t("Maxsus narx qo'shildi"));
      qc.invalidateQueries({ queryKey: ['clients', clientId] });
      form.resetFields();
      onClose();
    },
    onError: (err) => form.setFields([{ name: 'pricePerM3', errors: [apiError(err)] }]),
  });

  const priceFormatter = (v: string | number | undefined): string => {
    if (v == null || v === '') return '';
    const [i, d] = String(v).split('.');
    const gi = i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return d != null ? `${gi}.${d}` : gi;
  };
  const priceParser = (v: string | undefined): string => (v ?? '').replace(/[^\d.]/g, '');

  return (
    <FormDrawer
      title={t('Yangi narx')}
      open={open}
      onClose={onClose}
      onSubmit={() => form.submit()}
      submitting={mut.isPending}
      width={480}
      footerExtra={
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t("Narxlar tarixi o'zgartirilmaydi — yangi qator qo'shiladi.")}
        </Typography.Text>
      }
    >
      {productsQ.isError ? (
        <div style={{ marginBottom: 12 }}>
          <ErrorState
            error={productsQ.error}
            message="Mahsulotlarni yuklab bo'lmadi"
            onRetry={() => productsQ.refetch()}
          />
        </div>
      ) : null}
      <Form form={form} layout="vertical" onFinish={(v) => mut.mutate(v)} initialValues={{ effectiveFrom: dayjs() }}>
        <Form.Item name="productId" label={t('Mahsulot')} rules={[{ required: true, message: t('Mahsulot tanlang') }]}>
          <Select
            showSearch
            optionFilterProp="label"
            placeholder={t('Mahsulot')}
            loading={productsQ.isFetching}
            options={products.map((p) => ({
              value: p.id,
              label: `${p.name}${p.size ? ` (${p.size})` : ''}${p.factory ? ` — ${p.factory.name}` : ''}`,
            }))}
          />
        </Form.Item>
        <Form.Item name="pricePerM3" label={t('Narx (m³)')} rules={[{ required: true, message: t('Narx kiriting') }]}>
          <InputNumber<string>
            stringMode
            min="0"
            controls={false}
            style={{ width: '100%' }}
            placeholder="0"
            inputMode="decimal"
            formatter={priceFormatter}
            parser={priceParser}
            onFocus={(e) => e.target.select()}
            suffix={<span style={{ opacity: 0.6 }}>{t("so'm")}</span>}
          />
        </Form.Item>
        <Form.Item name="effectiveFrom" label={t('Amal qilish sanasi')}>
          <DatePicker format="DD.MM.YYYY" allowClear={false} style={{ width: '100%' }} />
        </Form.Item>
      </Form>
    </FormDrawer>
  );
}

// ─────────────────────────── paddonlar tab ───────────────────────────

/** the GET /pallets/transactions row as this tab reads it (client side of the ledger) */
interface PalletTxRow {
  id: string;
  type: string;
  qty: number;
  date: string;
  /** faqat CHARGED_LOST qatorlarida — undirishni bekor qilishda qaytadigan summa shundan */
  unitPrice?: string | null;
  reversalOfId?: string | null;
  /** to'ldirilgan bo'lsa — bu qator bekor qilingan (server so'zi, sahifalashdan qat'i nazar) */
  reversedBy?: { id: string; date: string; note?: string | null } | null;
  /** storno qatorida — u yo'qqa chiqargan asl harakat */
  reversalOf?: { id: string; type: string; qty: number; date: string } | null;
  note?: string | null;
  order?: { id: string; orderNo: string } | null;
}

/**
 * «Shu mijozdan hozirgacha qancha pul oldik» — To'lovlar tabining sarlavhasi.
 * Zavod kartasidagi `PaidTotalsStrip` bilan bir xil mantiq: uchta pul figurasi va
 * ularga QO'SHILMAYDIGAN to'rtinchisi — mijoz shofyorga bergan pul, chunki u
 * bizning kassamizdan o'tmagan (shu sababli tranzaksiyalar jurnalida ham yo'q).
 */
function ClientPaidTotalsStrip({ totals }: { totals?: ClientPaymentTotals }) {
  const { token } = theme.useToken();
  const t = useT();
  const isPhone = useIsPhone();

  // eski API (paymentTotals'siz) → nol bilan to'ldirilgan strip yolg'on bo'lardi
  if (!totals) return null;
  const received = num(totals.received);
  const refunded = num(totals.refunded);
  const driver = num(totals.paidToDriver);
  const nothing = received < 1 && refunded < 1 && driver < 1;

  const cell = (label: string, value: Money | number, variant: 'in' | 'neutral', strong = false) => (
    <div style={{ minWidth: 0 }}>
      <Typography.Text
        type="secondary"
        style={{ fontSize: 11, letterSpacing: '0.04em', textTransform: 'uppercase', display: 'block' }}
      >
        {t(label)}
      </Typography.Text>
      <MoneyCell
        value={value}
        variant={variant}
        strong={strong}
        suffix={t("so'm")}
        style={{ fontSize: strong ? 20 : 16 }}
      />
    </div>
  );

  return (
    <div
      style={{
        marginBottom: 12,
        padding: isPhone ? '10px 12px' : '12px 14px',
        borderRadius: token.borderRadiusLG,
        border: `1px solid ${token.colorBorderSecondary}`,
        borderLeft: `3px solid ${nothing ? token.colorBorder : token.colorPrimary}`,
        background: token.colorBgContainer,
      }}
    >
      <div style={{ display: 'flex', gap: isPhone ? 12 : 28, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        {cell('Mijozdan jami olingan', totals.received, 'in', true)}
        {cell('Mijozga qaytarilgan', totals.refunded, 'neutral')}
        {cell('Sof olingan', totals.netReceived, 'in', true)}
        {driver >= 1 ? cell('Shofyorga bergani', totals.paidToDriver, 'neutral') : null}
      </div>
      <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 10 }}>
        {t('{count} ta to‘lov hujjati', { count: fmtNum(totals.paymentCount) })}
        {totals.firstPaymentAt && totals.lastPaymentAt
          ? ` · ${fmtDate(totals.firstPaymentAt)} — ${fmtDate(totals.lastPaymentAt)}`
          : ''}
      </Typography.Text>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: '8px 0 0' }}>
        {driver >= 1
          ? t(
              'Bu raqamlar butun tarix bo‘yicha, bekor qilingan to‘lovlarsiz. «Shofyorga bergani» kassamizdan o‘tmagan — u buyurtma yaratilishida mijoz qarzidan ajratilgan, shuning uchun jamiga qo‘shilmaydi va tranzaksiyalar jurnalida ko‘rinmaydi.',
            )
          : t('Bu raqamlar butun tarix bo‘yicha, bekor qilingan to‘lovlarsiz.')}
      </Typography.Paragraph>
    </div>
  );
}

/**
 * Paddon tarixi (egasi so'rovi, 2026-07-25): tepada «Mijozga jami berilgan −
 * Mijoz qaytargan = Hozir mijozda» tenglamasi, pastida uni tug'dirgan harakatlar
 * defteri. Tuzilma zavod kartochkasidagi PalletsTab bilan bir xil — ikkala tomon
 * bitta savolga («kim kimga qancha qarz») bitta shaklda javob bersin.
 *
 * ALL-TIME: bu yerda davr filtri YO'Q va qo'shilmaydi — paddon qarzi sanadan emas,
 * qaytarilmagan donadan iborat.
 *
 * AMALLAR (egasi so'rovi, 2026-07-30): tenglamaning yonida uni o'zgartiradigan ikki tugma
 * turadi — «Paddon qaytarib olish» va «Yo'qotilganini undirish». Ular AYNAN shu yerda,
 * chunki qaror raqamga qarab qabul qilinadi: nechta berilgan, nechtasi qaytmagan.
 *
 * QATOR AMALI (egasi so'rovi, 2026-08-01 · 2026-08-04): defterning har bir «Mijoz qaytardi»
 * VA «Yo'qotilganini undirish» qatorida «Bekor qilish» turadi — «paddonni oldik, keyin
 * qarasak bu boshqa mijoz ekan» va «undirdik, keyin paddon topildi» degan ikki xato shu
 * yerda tuzatiladi. Qaytarish bekor qilinganda paddon O'SHA mijozda qoladi; undirish bekor
 * qilinganda esa PUL ham qaytadi — mijozning qarzi undirilgan summaga kamayadi. Qator
 * o'chirilmaydi: storno qatori yoziladi va ikkalasi ham defterda (xiralashgan) qoladi.
 */
function PalletsTab({
  clientId,
  clientName,
  stats,
  balance,
  canReturn,
  canCharge,
  canCancelReturn,
  canCancelCharge,
  onReturn,
  onCharge,
}: {
  clientId: string;
  /** bekor qilish tasdig'ida «kimga qaytadi» degan savolga javob beradi */
  clientName: string;
  stats?: PalletPartyStats;
  /** «hozir mijozda» — amallar chegarasi va ularning ko'rinish sharti */
  balance: number;
  canReturn: boolean;
  canCharge: boolean;
  /** «Mijoz qaytardi» qatorini storno qilish huquqi (A·B·G — pulsiz) */
  canCancelReturn: boolean;
  /** «Yo'qotilganini undirish» qatorini storno qilish huquqi (A·B — PUL qaytaradi) */
  canCancelCharge: boolean;
  onReturn: () => void;
  onCharge: () => void;
}) {
  const t = useT();
  const isPhone = useIsPhone();
  const uf = useUrlFilters();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const { token } = theme.useToken();
  // Bekor qilinayotgan qator — ReasonModal ochiqligi ham shundan (yopiq = null).
  const [cancelRow, setCancelRow] = useState<PalletTxRow | null>(null);
  // registr sahifalash DataTable bilan bitta manbadan (?page/?pageSize) o'qiladi —
  // bir vaqtda faqat bitta tab mount bo'lgani uchun parametr baham ko'riladi
  const page = Number(uf.get('page')) || 1;
  const pageSize = Number(uf.get('pageSize')) || 20;

  const txQ = useQuery({
    queryKey: ['pallets', 'transactions', 'client', clientId, page, pageSize],
    queryFn: () =>
      endpoints.palletTransactions({ clientId, page, pageSize }) as Promise<Paged<PalletTxRow>>,
    placeholderData: keepPreviousData,
  });

  // Storno qilingan qator xiralashadi. Endi buni SERVER aytadi (`reversedBy`) — ilgari
  // juftlik faqat ayni sahifada topilsa ko'rinardi, ya'ni asli boshqa sahifaga tushib
  // qolgan bekor qilingan qator jonli bo'lib turaverardi. Sahifa ichidagi eski qidiruv
  // zaxira sifatida qoladi: eski javob `reversedBy` siz kelsa ham ekran to'g'ri chiziladi.
  const reversedIds = useMemo(() => {
    const rows = asItems<PalletTxRow>(txQ.data);
    return new Set(rows.filter((r) => r.reversalOfId).map((r) => r.reversalOfId!));
  }, [txQ.data]);
  const isReversed = (r: PalletTxRow) => !!r.reversedBy || reversedIds.has(r.id);
  const isGhost = (r: PalletTxRow) => r.type === 'REVERSAL' || isReversed(r);
  /**
   * Bekor qilinadigan tur (yoki null): faqat «Mijoz qaytardi» va «Yo'qotilganini undirish»,
   * faqat bir marta, va faqat huquq bo'lsa — server ham AYNAN shu uch shartni tekshiradi.
   */
  const cancelKindOf = (r: PalletTxRow): PalletCancelKind | null => {
    const kind = palletCancelKind(r.type);
    if (!kind || isReversed(r)) return null;
    return palletCancelAllowed(kind, {
      canReverseReturn: canCancelReturn,
      canReverseCharge: canCancelCharge,
    })
      ? kind
      : null;
  };
  /** Undirilgan jami summa — qatorning O'Z narxidan (sozlamadagi bugungi narxdan emas). */
  const rowAmount = (r: PalletTxRow): number | null => {
    const price = Number(r.unitPrice);
    return Number.isFinite(price) && price > 0 ? price * r.qty : null;
  };
  const cancelKind = cancelRow ? palletCancelKind(cancelRow.type) : null;

  const reverseMut = useMutation({
    mutationFn: (v: { id: string; reason: string; kind: PalletCancelKind }) =>
      endpoints.palletReverseTx(v.id, v.reason),
    onSuccess: (res, v) => {
      // Yakuniy sonni ham, yechilgan summani ham SERVER aytadi. «+qty» deb o'zimiz hisoblab
      // qo'ysak, bekor qilingan buyurtmaning stornosi davom etgan holatda ekran yolg'on
      // gapirardi.
      message.success(
        palletCancelSuccess(
          v.kind,
          t,
          res as { clientPalletBalance?: number; reversedAmount?: string | null },
        ),
      );
      // Paddon qoldig'i beshta sirtda ko'rinadi (bu defter, mijoz kartochkasi chipi,
      // mijozlar/agentlar ro'yxati, qarzlar doskasi, ish stoli) — bittasi eskirsa
      // ekranda ikki xil raqam bo'lardi. `ClientPalletDrawer` bilan bir xil ro'yxat.
      for (const key of ['pallets', 'clients', 'agents', 'debts', 'dashboard']) {
        qc.invalidateQueries({ queryKey: [key] });
      }
      setCancelRow(null);
    },
  });

  const cancelButton = (r: PalletTxRow, block = false) => (
    <Button
      size="small"
      danger
      block={block}
      icon={<UndoOutlined />}
      onClick={(e) => {
        e.stopPropagation();
        setCancelRow(r);
      }}
    >
      {t('Bekor qilish')}
    </Button>
  );

  const columns: SbColumn<PalletTxRow>[] = [
    { title: 'Sana', dataIndex: 'date', key: 'date', width: 110, render: (v: string) => fmtDate(v) },
    {
      title: 'Turi',
      dataIndex: 'type',
      key: 'type',
      width: 190,
      render: (v: string, r) => {
        const meta = PALLET_TX[v as keyof typeof PALLET_TX];
        const chip = meta ? <StatusChip meta={meta} /> : v;
        // «Storno +4» o'zicha soqov: u NIMANI yo'qqa chiqargani yozilmasa, defterni
        // o'qigan odam ikkita qatorni ko'zi bilan juftlashtirishga majbur bo'ladi.
        const src = r.type === 'REVERSAL' ? r.reversalOf : null;
        const srcMeta = src ? PALLET_TX[src.type as keyof typeof PALLET_TX] : null;
        if (!src || !srcMeta) return chip;
        return (
          <div style={{ display: 'grid', gap: 2 }}>
            {chip}
            <span style={{ fontSize: 11, color: token.colorTextTertiary }}>
              ← {srcMeta.label} · {fmtDate(src.date)}
            </span>
          </div>
        );
      },
    },
    // Pul ustuni yo'q: yo'qotilgan paddon puli bitta hamma vaqtlik raqam sifatida
    // tepadagi tenglamada («Yo'qotilgan (undirilgan)») turadi, qator-qator emas.
    {
      title: 'Soni (dona)',
      dataIndex: 'qty',
      key: 'qty',
      align: 'right',
      className: 'num',
      width: 110,
      render: (v: number) => fmtNum(v),
    },
    {
      title: 'Buyurtma',
      key: 'order',
      width: 130,
      render: (_, r) => (r.order ? <Link to={`/orders/${r.order.id}`}>{r.order.orderNo}</Link> : '—'),
    },
    {
      title: 'Izoh',
      dataIndex: 'note',
      key: 'note',
      ellipsis: true,
      render: (v: string | null) => v || '—',
    },
    // Amal ustuni faqat huquq bo'lganda umuman chiziladi — bo'sh ustun sarlavhasi
    // «bu yerda nimadir bo'lishi kerak edi» degan savol qoldiradi.
    ...(canCancelReturn || canCancelCharge
      ? [
          {
            title: '',
            key: 'actions',
            width: 160,
            render: (_: unknown, r: PalletTxRow) => {
              if (cancelKindOf(r)) return cancelButton(r);
              // Allaqachon bekor qilingan qator: tugma o'rniga FAKT. O'chirilgan tugma
              // «nega bosilmayapti?» deb turadi, bu esa javobning o'zi.
              const kind = palletCancelKind(r.type);
              if (kind && isReversed(r)) {
                return (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {t(palletCancelledLabel(kind))}
                  </Typography.Text>
                );
              }
              return null;
            },
          } as SbColumn<PalletTxRow>,
        ]
      : []),
  ];

  // Amallar FAQAT mijozda paddon bo'lganda. Nol (yoki manfiy) qoldiqda ikkalasi ham
  // serverda 400 bo'ladi — «mijozda 0 dona paddon bor»: qaytarib olinadigan ham,
  // yo'qotilgan deb undiriladigan ham hech narsa yo'q. O'chirilgan tugma emas, tugma yo'q.
  const hasActions = balance > 0 && (canReturn || canCharge);
  const actionNodes = [
    canReturn ? (
      <Button
        key="return"
        type="primary"
        size={isPhone ? 'middle' : 'small'}
        icon={<ImportOutlined />}
        block={isPhone}
        onClick={onReturn}
      >
        {t('Paddon qaytarib olish')}
      </Button>
    ) : null,
    canCharge ? (
      <Button
        key="lost"
        danger
        size={isPhone ? 'middle' : 'small'}
        icon={<WarningOutlined />}
        block={isPhone}
        onClick={onCharge}
      >
        {t("Yo'qotilganini undirish")}
      </Button>
    ) : null,
  ].filter(Boolean);

  return (
    <Space orientation="vertical" style={{ width: '100%', paddingTop: 8 }} size={16}>
      {/* Hech qachon savdo qilmagan mijozda «0 − 0 = 0» paneli ma'nosiz — jurnalning
          o'z bo'sh holati (quyida) o'sha gapni bir marta va aniqroq aytadi.
          `movements > 0` bu savolga JAVOB BERMAYDI: u daftar QATORLARINI sanaydi va
          butunlay bekor qilingan buyurtma ikkita qator (yetkazish + storno) qoldiradi,
          ular esa bir-birini yo'qqa chiqaradi — natijada aynan o'sha «0 − 0 = 0» paneli
          chiqardi. hasPalletHistory raqam qimirlaganini so'raydi. */}
      {hasPalletHistory(stats) ? (
        <PalletStatsPanel
          stats={stats}
          side="client"
          title="Paddon tarixi"
          // DESKTOP: tugmalar panel sarlavhasining o'ng chetida — `extra` uyasi aynan
          // shu uchun qo'yilgan. TELEFONDA u yerga qo'yilmaydi: 320px da «PADDON TARIXI»
          // yorlig'i + ikki tugma bitta satrga sig'maydi, ular pastda o'z ustunini oladi.
          extra={hasActions && !isPhone ? <Space size={8}>{actionNodes}</Space> : undefined}
        />
      ) : null}
      {/* Telefonda — yoki panel umuman chizilmaganda (eski payload `palletStats`siz
          kelsa) — amallar o'z qatorida turadi, aks holda ular ekrandan yo'qolardi. */}
      {hasActions && (isPhone || !hasPalletHistory(stats)) ? (
        <Space
          orientation={isPhone ? 'vertical' : 'horizontal'}
          size={8}
          style={isPhone ? { width: '100%' } : undefined}
        >
          {actionNodes}
        </Space>
      ) : null}
      <TableCard footer={<Link to={`/pallets?clientId=${clientId}`}>{t('Barcha harakatlar →')}</Link>}>
        <DataTable<PalletTxRow>
          rowKey="id"
          columns={columns}
          query={txQ}
          defaultPageSize={20}
          filterKeys={[]}
          scroll={{ x: 'max-content' }}
          ghostWhen={isGhost}
          emptyText="Paddon harakati hali yo'q"
          // MOBIL: 5 ustunli jadval 320px da o'qilmaydi — turi sarlavha, soni yagona
          // figura, sana/buyurtma chiplarda (§2.2.2)
          mobileCard={(r) => {
            const meta = PALLET_TX[r.type as keyof typeof PALLET_TX];
            const srcMeta = r.reversalOf
              ? PALLET_TX[r.reversalOf.type as keyof typeof PALLET_TX]
              : null;
            const lines: { label: string; value: string }[] = [];
            // telefonda «nimaning stornosi» sarlavhaga sig'maydi — o'z satrini oladi
            if (r.type === 'REVERSAL' && srcMeta && r.reversalOf) {
              lines.push({ label: 'Nimaning stornosi', value: `${srcMeta.label} · ${fmtDate(r.reversalOf.date)}` });
            }
            if (r.note) lines.push({ label: 'Izoh', value: r.note });
            return {
              title: meta ? <StatusChip meta={meta} /> : r.type,
              subtitle: fmtDate(r.date),
              value: (
                <span className="num">
                  {fmtNum(r.qty)} {t('dona')}
                </span>
              ),
              meta: r.order ? (
                <Link className="sb-mcard__chip" to={`/orders/${r.order.id}`}>
                  {r.order.orderNo}
                </Link>
              ) : undefined,
              lines: lines.length ? lines : undefined,
              actions: cancelKindOf(r) ? cancelButton(r, true) : undefined,
              ghost: isGhost(r),
            };
          }}
        />
      </TableCard>

      {/* Bekor qilish — ReasonModal (04 §2.6), ilovaning yagona buzg'unchi tasdiq sirti.
          Sabab MAJBURIY: qator o'chirilmagani uchun «nega bekor qilingan» degan savolga
          javob shu yerda, storno qatorining izohida qoladi. */}
      <ReasonModal
        open={!!cancelRow}
        title={t(palletCancelTitle(cancelKind ?? 'RETURN'))}
        confirmLabel="Bekor qilish"
        placeholder={palletCancelPlaceholder(cancelKind ?? 'RETURN')}
        facts={
          cancelRow && cancelKind
            ? palletCancelFacts({
                kind: cancelKind,
                t,
                clientName,
                qty: cancelRow.qty,
                amount: rowAmount(cancelRow),
              })
            : undefined
        }
        submitting={reverseMut.isPending}
        error={reverseMut.error}
        onConfirm={async (reason) => {
          if (cancelRow && cancelKind) {
            await reverseMut.mutateAsync({ id: cancelRow.id, reason, kind: cancelKind });
          }
        }}
        onClose={() => {
          reverseMut.reset();
          setCancelRow(null);
        }}
      />
    </Space>
  );
}

// ─────────────────────────── page ───────────────────────────

export default function ClientDetail() {
  const { id } = useParams<{ id: string }>();
  const { token } = theme.useToken();
  const t = useT();
  const isPhone = useIsPhone();
  const { message, modal } = App.useApp();
  const { user, hasRole } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const uf = useUrlFilters();

  const role = user?.role;
  const office = hasRole('ADMIN', 'ACCOUNTANT');

  const [editOpen, setEditOpen] = useState(false);
  const [priceOpen, setPriceOpen] = useState(false);
  const [balanceOpen, setBalanceOpen] = useState(false);
  // Paddon amali. Ochiqlik va rejim ALOHIDA holatlar: bitta `mode | null` bo'lsa, varaq
  // yopilish animatsiyasi paytida rejim «return» ga qaytib, sarlavha va maydonlar
  // ko'z oldida sakrab ketardi. Rejim oxirgi so'ralganida qoladi.
  const [palletMode, setPalletMode] = useState<ClientPalletMode>('return');
  const [palletOpen, setPalletOpen] = useState(false);
  const openPallet = useCallback((mode: ClientPalletMode) => {
    setPalletMode(mode);
    setPalletOpen(true);
  }, []);

  // Paddon amallari (egasi qoidasi, 2026-07-30): qaytarib olishni AGENT ham yozadi —
  // paddonni maydonda u qabul qiladi (server `assertOwnAgent` bilan o'z mijoziga
  // qamraydi). Undirish esa mijozga PUL qarzi yozadi ⇒ faqat ADMIN/BUXGALTER.
  const canPalletReturn = can(role, 'pallets.clientReturn');
  const canPalletCharge = can(role, 'pallets.mutate');
  // Xato yozilgan qaytarishning stornosi — yozish huquqi bilan bir xil ro'yxat, lekin
  // ALOHIDA kalit: u boshqa endpoint (`/pallets/transactions/:id/reverse`), va ro'yxatlar
  // kelajakda ajralishi mumkin.
  const canPalletReverse = can(role, 'pallets.reverseReturn');
  // Xato UNDIRILGAN paddon stornosi — o'sha endpoint, lekin u mijozning PUL qarzini
  // kamaytiradi, ya'ni undirishning O'ZI bilan bir xil ro'yxat (A·B). Server AGENTga 403
  // qaytaradi, shuning uchun tugma ham unga ko'rsatilmaydi.
  const canPalletReverseCharge = can(role, 'pallets.reverseCharge');

  // ── active tab (?tab=), role-scoped ──
  const rawTab = uf.get('tab') || 'hisob';
  // «paddonlar» ofis tabi EMAS: `pallets.view` roʼyxati `clients.view` bilan bir xil
  // (A·B·G), va o'z mijozining paddon qarzini ko'rmagan agent uni undirolmaydi ham.
  const allowedTabs = useMemo(
    () => new Set<string>(office ? TAB_KEYS : ['hisob', 'buyurtmalar', 'tolovlar', 'paddonlar']),
    [office],
  );
  const activeTab = allowedTabs.has(rawTab) ? rawTab : 'hisob';

  // ── statement window (default: Shu oy) — also feeds the akt-sverki print link ──
  const from = uf.get('from') || dayjs().startOf('month').format('YYYY-MM-DD');
  const to = uf.get('to') || dayjs().endOf('month').format('YYYY-MM-DD');

  // ── register pagination (shared param; only one tab is mounted at a time) ──
  const page = Number(uf.get('page')) || 1;
  const pageSize = Number(uf.get('pageSize')) || 20;
  const showVoided = uf.get('bekor') === '1';

  // ── To'lovlar tabining ikki ko'rinishi (?pv=) ──
  // «Tranzaksiyalar» — /to'lovlar sahifasining kassa jurnali, shu mijozga qisqargani.
  // U `/kassa/transactions` ni o'qiydi, ya'ni AGENT uchun yopiq (`kassa.view` = A·B·K),
  // shuning uchun agentga faqat hujjatlar ro'yxati ko'rsatiladi — 403 ko'rsatish emas.
  const canSeeKassa = can(role, 'kassa.view');
  const payView = canSeeKassa && uf.get('pv') !== 'hujjat' ? 'tranzaksiya' : 'hujjat';

  const detailQ = useQuery({
    queryKey: ['clients', id],
    queryFn: () => endpoints.client(id!),
    enabled: !!id,
  });
  const data = detailQ.data as ClientDetailData | undefined;

  // overdue facts for this client (server-computed over all orders, fact 0b)
  const overdueQ = useQuery({
    queryKey: ['debts', 'clients', 'overdue-for', id],
    queryFn: () => endpoints.debtsClients({ days: 7, search: data?.name, pageSize: 100 }),
    enabled: !!id && !!data?.name && can(role, 'debts.view'),
  });
  const overdueRow = useMemo<DebtClientRow | undefined>(() => {
    const rows = (overdueQ.data?.items ?? []) as DebtClientRow[];
    return rows.find((r) => r.id === id);
  }, [overdueQ.data, id]);

  // register queries (each gated to its active tab)
  const ordersQ = useQuery({
    queryKey: ['orders', 'client', id, page, pageSize],
    queryFn: () => endpoints.orders({ clientId: id!, page, pageSize }),
    enabled: !!id && activeTab === 'buyurtmalar' && can(role, 'orders.view'),
    placeholderData: keepPreviousData,
  });
  const paymentsQ = useQuery({
    queryKey: ['payments', 'client', id, page, pageSize, showVoided],
    queryFn: () => endpoints.payments({ clientId: id!, page, pageSize, voided: showVoided ? true : undefined }),
    enabled: !!id && activeTab === 'tolovlar' && can(role, 'payments.view'),
    placeholderData: keepPreviousData,
  });

  // ── activation mutations (ADMIN) ──
  const deactivateMut = useMutation({
    mutationFn: () => endpoints.deleteClient(id!),
    onSuccess: () => {
      message.success(t("Mijoz nofaol holatga o'tkazildi"));
      qc.invalidateQueries({ queryKey: ['clients'] });
    },
    onError: (err) => message.error(apiError(err)),
  });
  const reactivateMut = useMutation({
    mutationFn: () => endpoints.updateClient(id!, { active: true }),
    onSuccess: () => {
      message.success(t('Mijoz faollashtirildi'));
      qc.invalidateQueries({ queryKey: ['clients'] });
    },
    onError: (err) => message.error(apiError(err)),
  });

  // ── header actions ──
  const openPay = useCallback(() => uf.set({ panel: 'tolov' }), [uf]);
  const openPrint = useCallback(
    () => navigate(`/print/statement/client/${id}?from=${from}&to=${to}`),
    [navigate, id, from, to],
  );

  // ── page keyboard: E edit · T payment · P print (§2.6) ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isEditableTarget(e.target)) return;
      switch (e.key) {
        case 't':
        case 'T':
          if (can(role, 'payments.create')) {
            e.preventDefault();
            openPay();
          }
          break;
        case 'e':
        case 'E':
          if (can(role, 'clients.edit')) {
            e.preventDefault();
            setEditOpen(true);
          }
          break;
        case 'p':
        case 'P':
          if (can(role, 'debts.view')) {
            e.preventDefault();
            openPrint();
          }
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [role, openPay, openPrint]);

  // ── loading / error / 404 (§2.7) ──
  if (detailQ.isLoading || (!data && detailQ.isFetching)) {
    return (
      <div>
        <Skeleton.Input active size="small" style={{ width: 200, marginBottom: 20 }} />
        <Skeleton active title paragraph={{ rows: 3 }} />
        <div style={{ marginTop: 28 }}>
          <Skeleton active title={false} paragraph={{ rows: 6 }} />
        </div>
      </div>
    );
  }
  if (detailQ.isError || !data) {
    return (
      <div>
        <ErrorState
          error={detailQ.error ?? new Error(t('Mijoz topilmadi'))}
          message="Mijozni yuklab bo'lmadi"
          onRetry={() => detailQ.refetch()}
        />
        <div style={{ textAlign: 'center', marginTop: -24, paddingBottom: 24 }}>
          <Link to="/clients">{t('Mijozlarga qaytish')}</Link>
        </div>
      </div>
    );
  }

  // ── derived ──
  const balanceNum = num(data.balance);
  const settledBal = isSettled(data.balance);
  const palletBalance = data.palletBalance ?? 0;
  const isAdmin = hasRole('ADMIN');

  const onDeactivate = () => {
    const reasons: string[] = [];
    if (!settledBal) reasons.push(t('Balans yopiq emas'));
    if (palletBalance !== 0) reasons.push(t('{n} dona paddon qaytarilmagan', { n: palletBalance }));
    if (reasons.length > 0) {
      modal.info({
        title: t("Deaktivatsiya qilib bo'lmaydi"),
        content: t('{reasons} — avval hisob-kitobni yoping.', { reasons: reasons.join('; ') }),
        okText: t('Tushunarli'),
        centered: isPhone,
      });
      return;
    }
    modal.confirm({
      title: t('"{name}" nofaol holatga o\'tkaziladi', { name: data.name }),
      content: t('Yangi buyurtma qabul qilolmaydi; tarix saqlanadi.'),
      okText: t('Deaktivatsiya'),
      okButtonProps: { danger: true },
      cancelText: t('Bekor qilish'),
      // telefonda markazda — futer (tasdiqlash tugmasi) doim ko'rinib tursin (R16)
      centered: isPhone,
      onOk: () => deactivateMut.mutateAsync(),
    });
  };
  const onReactivate = () => {
    modal.confirm({
      title: t('"{name}" qayta faollashtiriladi', { name: data.name }),
      content: t('Mijoz yana buyurtma qabul qila oladi.'),
      okText: t('Faollashtirish'),
      cancelText: t('Bekor qilish'),
      centered: isPhone,
      onOk: () => reactivateMut.mutateAsync(),
    });
  };

  const actions: PartyHeaderAction[] = [
    {
      key: 'pay',
      label: "To'lov qabul qilish",
      icon: <WalletOutlined />,
      primary: true,
      cap: 'payments.create',
      onClick: openPay,
    },
    {
      key: 'order',
      label: 'Yangi buyurtma',
      icon: <ShoppingCartOutlined />,
      cap: 'orders.create',
      disabled: !data.active,
      onClick: () => navigate(`/orders/new?clientId=${id}`),
    },
    // Paddon qaytarib olish — mijozda paddon BO'LGANDA. Nol qoldiqda tugma umuman
    // chizilmaydi: qaytarib olinadigan narsa yo'q va server ham rad etadi (o'chirilgan
    // tugma «ruxsatim yo'q» deb o'qilardi, holbuki gap ruxsatda emas).
    ...(palletBalance > 0
      ? [
          {
            key: 'pallet-return',
            label: 'Paddon qaytarib olish',
            icon: <ImportOutlined />,
            cap: 'pallets.clientReturn',
            onClick: () => openPallet('return'),
          } as PartyHeaderAction,
        ]
      : []),
    {
      key: 'akt',
      label: 'Akt sverki',
      icon: <PrinterOutlined />,
      cap: 'debts.view',
      onClick: openPrint,
    },
    {
      key: 'edit',
      label: 'Tahrirlash',
      icon: <EditOutlined />,
      cap: 'clients.edit',
      onClick: () => setEditOpen(true),
    },
    {
      key: 'adjust',
      label: 'Balansni nazorat qilish',
      icon: <SlidersOutlined />,
      cap: 'clients.adjustBalance',
      onClick: () => setBalanceOpen(true),
    },
    data.active
      ? {
          key: 'deactivate',
          label: 'Deaktivatsiya',
          icon: <StopOutlined />,
          danger: true,
          cap: 'clients.delete',
          onClick: onDeactivate,
        }
      : {
          key: 'reactivate',
          label: 'Faollashtirish',
          icon: <CheckCircleOutlined />,
          cap: 'clients.delete',
          onClick: onReactivate,
        },
  ];

  // Chip'dagi bitta raqam ortidagi butun matematika — «mijozga bergan − qaytargan».
  // Eski payload'da (palletStats'siz) panel chizilmaydi: nol bilan to'ldirilgan
  // tenglama chip'dagi qoldiqni yolg'onga chiqarardi.
  const palletBreakdownPopover = data.palletStats ? (
    <div style={{ minWidth: 200, width: 280, maxWidth: popupMaxWidth() }}>
      <PalletStatsPanel
        stats={data.palletStats}
        side="client"
        title="Paddon tarixi"
        compact
        extra={
          <Button
            type="link"
            size="small"
            style={{ padding: 0, height: 'auto' }}
            onClick={() => uf.set({ tab: 'paddonlar' })}
          >
            {t('Paddon harakatlari')}
          </Button>
        }
      />
    </div>
  ) : null;

  // Zavod kartochkasidagi bilan aynan bir xil xulq: bir bosishga ikkita javob
  // bo'lmasin — bosish popoverni ochadi (tenglama), klaviatura Enter'i va popover
  // ichidagi havola tabga olib boradi. Popover umuman bo'lmasa, bosish tabni ochadi.
  const clickablePallet =
    palletBalance !== 0 ? (
      <span
        role="button"
        tabIndex={0}
        onClick={palletBreakdownPopover ? undefined : () => uf.set({ tab: 'paddonlar' })}
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
        <PalletChip pallets={palletBalance} popoverContent={palletBreakdownPopover} />
      </span>
    ) : null;

  const counters: PartyHeaderCounters = {
    // `pallets` uyasi ATAYLAB bo'sh: u xom chip chizadi (popoversiz, bosilmaydigan).
    // Chip `extra` orqali beriladi — sarlavha komponentini o'zgartirmasdan unga
    // tenglama popoveri va tabga o'tish qo'shishning yagona yo'li shu.
    overdue: overdueRow
      ? { count: overdueRow.overdueOrdersCount, sum: String(overdueRow.overdueOrdersTotal) }
      : null,
    credit: { limit: data.creditLimit ?? null, used: balanceNum > 0 ? data.balance : '0' },
    extra: (
      <>
        {clickablePallet}
        {data.legalEntity || data.paymentTermDays != null ? (
          <span
            style={{
              display: 'inline-flex',
              gap: 12,
              flexWrap: 'wrap',
              fontSize: 12,
              color: token.colorTextSecondary,
            }}
          >
            {data.legalEntity ? <span>{t('Yuridik shaxs')}: {data.legalEntity}</span> : null}
            {data.paymentTermDays != null ? <span>{t("To'lov muddati")}: {data.paymentTermDays} {t('kun')}</span> : null}
          </span>
        ) : null}
      </>
    ),
  };

  const handlePeriod = (r: DateRange) => uf.set({ from: r.from ?? null, to: r.to ?? null });

  // ─────────── tab bodies ───────────

  const now = dayjs();

  // `mobile:` — telefon kartasidagi slot (spec §2.2.1). Desktop ustunlari aynan
  // shundayligicha qoladi: bu maydonlar faqat karta yo'lida o'qiladi.
  const orderColumns: SbColumn<Order>[] = [
    {
      title: '№',
      dataIndex: 'orderNo',
      key: 'orderNo',
      render: (v: string, o) => <Link to={`/orders/${o.id}`}>{v}</Link>,
      mobile: 'title',
    },
    {
      title: 'Sana',
      dataIndex: 'date',
      key: 'date',
      render: (v: string) => fmtDate(v),
      mobile: 'meta',
      mobileOrder: 1,
    },
    // Buyurtmada NIMA sotilgani (egasi so'rovi, 2026-07-28). Ikkala figura ham
    // serverdan tayyor keladi — ekran pozitsiyalarni qo'shmaydi. `ellipsis` katak
    // ichida, ustun darajasida EMAS: aks holda «+N» rozetkasi kesilib ketardi.
    {
      title: 'Mahsulot',
      key: 'products',
      width: 200,
      render: (_, o) => <OrderProductsCell products={o.products} />,
      mobile: 'meta',
      mobileOrder: 2,
    },
    {
      // HAQIQIY hajm (`actualQuantityM3 ?? quantityM3`) — buyurtma kartochkasi va
      // xlsx eksporti bilan bir xil tenglama. Maydon kelmasa «—»: nol ko'rsatish
      // «hajmi yo'q» degan yolg'on bo'lardi.
      title: 'Hajm',
      dataIndex: 'cubeM3',
      key: 'cubeM3',
      align: 'right',
      className: 'num',
      width: 110,
      render: (v: Money | undefined) => (v == null ? '—' : fmtM3(v)),
      mobile: 'meta',
      mobileLabel: 'Hajm',
      mobileOrder: 3,
    },
    {
      title: 'Zavod',
      key: 'factory',
      ellipsis: true,
      width: 160,
      render: (_, o) => o.factory?.name ?? '—',
      mobile: 'subtitle',
    },
    {
      title: 'Holat',
      dataIndex: 'status',
      key: 'status',
      render: (v: Order['status']) => <StatusChip meta={STATUS[v]} />,
      mobile: 'meta',
      mobileOrder: 4,
    },
    {
      title: 'Muddat',
      key: 'due',
      render: (_, o) => {
        if (!o.dueDate) return <Typography.Text type="secondary">—</Typography.Text>;
        const overdue = o.status !== 'CANCELLED' && dayjs(o.dueDate).isBefore(now, 'day');
        return overdue ? (
          <span style={{ color: token.colorError, whiteSpace: 'nowrap' }}>{fmtDate(o.dueDate)} · {t("o'tgan")}</span>
        ) : (
          <span style={{ whiteSpace: 'nowrap' }}>{fmtDate(o.dueDate)}</span>
        );
      },
      mobile: 'meta',
      mobileLabel: 'Muddat',
      mobileOrder: 5,
    },
    {
      title: 'Savdo summasi',
      dataIndex: 'saleTotal',
      key: 'saleTotal',
      align: 'right',
      render: (v: Money) => <MoneyCell value={v} />,
      mobile: 'value',
    },
    {
      // Savdo summasi YONIDA qarama-qarshi raqam turishi shart — aks holda 22 000 000
      // qarzdek o'qiladi. Qiymat serverdan sof holda keladi (transport ulushi va
      // to'langani allaqachon chiqarilgan), ekran hech narsa hisoblamaydi.
      title: 'Mijoz qarzi',
      key: 'clientOutstanding',
      align: 'right',
      render: (_, o) =>
        num(o.clientOutstanding) > 0 ? (
          <MoneyCell value={o.clientOutstanding ?? 0} variant="owedToUs" strong />
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
      mobile: 'meta',
      mobileLabel: 'Mijoz qarzi',
      mobileOrder: 6,
    },
  ];

  const paymentColumns: SbColumn<Payment>[] = [
    {
      title: 'Sana',
      dataIndex: 'date',
      key: 'date',
      render: (v: string) => fmtDate(v),
      mobile: 'title',
    },
    {
      title: 'Turi',
      dataIndex: 'kind',
      key: 'kind',
      render: (v: Payment['kind']) => PAYMENT_KIND[v]?.label ?? v,
      mobile: 'subtitle',
    },
    {
      title: 'Usul',
      dataIndex: 'method',
      key: 'method',
      render: (v: Payment['method']) => PAYMENT_METHOD[v]?.label ?? v,
      mobile: 'subtitle',
    },
    {
      title: "Summa (so'm)",
      dataIndex: 'amount',
      key: 'amount',
      align: 'right',
      render: (v: Money) => <MoneyCell value={v} />,
      mobile: 'value',
    },
    {
      title: 'Holati',
      key: 'reconciled',
      render: (_, p) => (!p.voidedAt && !p.reconciled ? <StatusChip meta={UNRECONCILED} /> : null),
      mobile: 'meta',
      mobileOrder: 1,
    },
    {
      title: 'Izoh',
      dataIndex: 'note',
      key: 'note',
      ellipsis: true,
      width: 200,
      render: (v: string | null) => v || '—',
      mobile: 'meta',
      mobileLabel: 'Izoh',
      mobileOrder: 2,
    },
  ];

  const renderPriceLine = (row: PriceRow, opts: { highlight?: boolean; badge?: boolean; muted?: boolean }) => (
    <div
      key={row.id}
      style={{
        display: 'flex',
        alignItems: 'center',
        // 320px da sana + 6 xonali narx + chip bitta qatorga sig'maydi → o'raladi
        flexWrap: 'wrap',
        gap: isPhone ? 8 : 12,
        padding: isPhone ? '7px 8px' : '7px 10px',
        borderRadius: token.borderRadiusSM,
        background: opts.highlight ? token.colorPrimaryBg : undefined,
        opacity: opts.muted ? 0.65 : 1,
      }}
    >
      <span
        style={{
          color: token.colorTextTertiary,
          minWidth: isPhone ? 0 : 92,
          fontSize: 12,
          whiteSpace: 'nowrap',
        }}
      >
        {fmtDate(row.effectiveFrom)}
      </span>
      <span className="num" style={{ fontWeight: opts.highlight ? 600 : 500, flex: 1, minWidth: 0 }}>
        {fmtPrice(row.pricePerM3)}{' '}
        <span style={{ color: token.colorTextTertiary, fontWeight: 400 }}>{t("so'm/m³")}</span>
      </span>
      {opts.highlight ? <StatusChip meta={PRICE_CURRENT} /> : null}
      {opts.badge ? <StatusChip meta={PRICE_FUTURE} /> : null}
    </div>
  );

  const priceGroups = (() => {
    const map = new Map<string, { product: PriceRow['product']; rows: PriceRow[] }>();
    for (const p of data.prices ?? []) {
      const key = p.product?.id ?? 'unknown';
      if (!map.has(key)) map.set(key, { product: p.product, rows: [] });
      map.get(key)!.rows.push(p);
    }
    for (const g of map.values()) {
      g.rows.sort((a, b) => dayjs(a.effectiveFrom).valueOf() - dayjs(b.effectiveFrom).valueOf());
    }
    return [...map.values()];
  })();

  const renderTab = (key: string) => {
    switch (key) {
      case 'hisob':
        return (
          <TableCard>
            <PartyStatement partyType="client" partyId={id!} from={from} to={to} />
          </TableCard>
        );

      case 'buyurtmalar':
        return (
          <TableCard footer={<Link to={`/orders?clientId=${id}`}>{t("Hammasini ko'rish →")}</Link>}>
            <DataTable<Order>
              rowKey="id"
              columns={orderColumns}
              query={ordersQ}
              defaultPageSize={20}
              filterKeys={[]}
              scroll={{ x: 'max-content' }}
              onRowOpen={(o) => navigate(`/orders/${o.id}`)}
              emptyText="Bu mijozda hali buyurtma yo'q"
              emptyAction={
                can(role, 'orders.create') ? (
                  <Button
                    type="primary"
                    icon={<ShoppingCartOutlined />}
                    onClick={() => navigate(`/orders/new?clientId=${id}`)}
                  >
                    {t('Yangi buyurtma')}
                  </Button>
                ) : undefined
              }
            />
          </TableCard>
        );

      case 'tolovlar':
        // Zavod kartasidagi bilan bir xil tuzilma (2026-07-26): tepada butun tarix
        // bo'yicha jamilar, ostida ikki ko'rinish — butun pul harakati jurnali va
        // to'lov hujjatlari ro'yxati.
        return (
          <div>
            <ClientPaidTotalsStrip totals={data.paymentTotals} />

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                flexWrap: 'wrap',
                marginBottom: 12,
              }}
            >
              {canSeeKassa ? (
                <Segmented
                  value={payView}
                  // «tranzaksiya» standart — URL toza qolsin
                  onChange={(v) => uf.set({ pv: String(v) === 'tranzaksiya' ? null : String(v) })}
                  size={isPhone ? 'small' : 'middle'}
                  block={isPhone}
                  options={[
                    { value: 'tranzaksiya', label: t('Tranzaksiyalar') },
                    { value: 'hujjat', label: t("To'lov hujjatlari") },
                  ]}
                />
              ) : (
                <span />
              )}
              <Link to={`/payments?clientId=${id}`}>
                {t("To'lovlar sahifasida ochish")} →
              </Link>
            </div>

            {payView === 'tranzaksiya' && canSeeKassa ? (
              <TransactionsJournal
                clientId={id!}
                onOpenPayment={(pid) => navigate(`/payments?peek=${pid}`)}
                emptyText="Bu mijoz bo'yicha hali kassa harakati yo'q"
              />
            ) : (
              <TableCard>
                <DataTable<Payment>
                  rowKey="id"
                  columns={paymentColumns}
                  query={paymentsQ}
                  defaultPageSize={20}
                  filterKeys={[]}
                  scroll={{ x: 'max-content' }}
                  ghostWhen={(p) => p.voidedAt != null}
                  onRowOpen={(p) => navigate(`/payments?peek=${p.id}`)}
                  toolbarExtra={
                    <Button size="small" onClick={() => uf.set({ bekor: showVoided ? null : '1' })}>
                      {showVoided ? t('Bekorlar: yashirish') : t("Bekorlar: ko'rsatish")}
                    </Button>
                  }
                  emptyText="Bu mijozda hali to'lov yo'q"
                  emptyAction={
                    can(role, 'payments.create') ? (
                      <Button type="primary" icon={<WalletOutlined />} onClick={openPay}>
                        {t("To'lov qabul qilish")}
                      </Button>
                    ) : undefined
                  }
                />
              </TableCard>
            )}
          </div>
        );

      case 'paddonlar':
        return (
          <PalletsTab
            clientId={id!}
            clientName={data.name}
            stats={data.palletStats}
            balance={palletBalance}
            canReturn={canPalletReturn}
            canCharge={canPalletCharge}
            canCancelReturn={canPalletReverse}
            canCancelCharge={canPalletReverseCharge}
            onReturn={() => openPallet('return')}
            onCharge={() => openPallet('lost')}
          />
        );

      case 'narxlar':
        return (
          <Space orientation="vertical" style={{ width: '100%', paddingTop: 8 }} size={16}>
            {office && (
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  block={isPhone}
                  onClick={() => setPriceOpen(true)}
                >
                  {t('Yangi narx')}
                </Button>
              </div>
            )}
            {priceGroups.length === 0 ? (
              <EmptyState
                message="Maxsus narx yo'q — katalog narxi amal qiladi"
                action={
                  office ? (
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => setPriceOpen(true)}>
                      {t('Yangi narx')}
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              priceGroups.map((g) => {
                const rows = g.rows; // ascending by effectiveFrom
                let curIdx = -1;
                for (let i = 0; i < rows.length; i++) {
                  if (dayjs(rows[i].effectiveFrom).isAfter(now, 'day')) break;
                  curIdx = i;
                }
                const current = curIdx >= 0 ? rows[curIdx] : undefined;
                const future = rows.slice(curIdx + 1);
                const past = curIdx > 0 ? rows.slice(0, curIdx) : [];
                return (
                  <div
                    key={g.product?.id ?? 'unknown'}
                    className="dash-card"
                    style={{ padding: isPhone ? 12 : 16 }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        rowGap: 8,
                        gap: 12,
                        marginBottom: 10,
                        paddingBottom: 10,
                        borderBottom: `1px solid ${token.colorBorderSecondary}`,
                      }}
                    >
                      <span
                        style={{
                          fontWeight: 600,
                          color: token.colorText,
                          minWidth: 0,
                          overflowWrap: 'anywhere',
                        }}
                      >
                        {g.product
                          ? `${g.product.name}${g.product.size ? ` (${g.product.size})` : ''}`
                          : t("Noma'lum mahsulot")}
                      </span>
                    </div>
                    {current ? renderPriceLine(current, { highlight: true }) : null}
                    {future.map((r) => renderPriceLine(r, { badge: true }))}
                    {past.length > 0 ? (
                      <>
                        <div
                          style={{
                            ...overlineStyle,
                            color: token.colorTextTertiary,
                            margin: '10px 0 2px 10px',
                          }}
                        >
                          {t('Oldingi narxlar')}
                        </div>
                        {[...past].reverse().map((r) => renderPriceLine(r, { muted: true }))}
                      </>
                    ) : null}
                  </div>
                );
              })
            )}
          </Space>
        );

      default:
        return null;
    }
  };

  const tabDefs = [
    { key: 'hisob', label: t('Hisob-kitob') },
    { key: 'buyurtmalar', label: t('Buyurtmalar') },
    { key: 'tolovlar', label: t("To'lovlar") },
    { key: 'paddonlar', label: t('Paddonlar') },
    ...(office ? [{ key: 'narxlar', label: t('Maxsus narxlar') }] : []),
  ];

  const overdueTotal = overdueRow ? String(overdueRow.overdueOrdersTotal) : null;

  return (
    <div>
      <PageHeader
        title={data.name}
        accent
        breadcrumb={[{ label: 'Mijozlar', to: '/clients' }]}
        status={<StatusChip meta={data.active ? CLIENT_ACTIVE : CLIENT_INACTIVE} variant="filled" />}
        tabs={tabDefs}
        activeTab={activeTab}
        onTabChange={(k) => uf.set({ tab: k })}
      />

      <PartyBalanceHeader
        party={{
          id: data.id,
          name: data.name,
          active: data.active,
          balance: data.balance,
          agent: data.agent,
          region: data.region,
          phone: data.phone,
        }}
        partyType="client"
        actions={actions}
        counters={counters}
        from={activeTab === 'hisob' ? from : undefined}
        to={activeTab === 'hisob' ? to : undefined}
        onPeriodChange={activeTab === 'hisob' ? handlePeriod : undefined}
      />

      {renderTab(activeTab)}

      <ClientEditDrawer client={data} open={editOpen} onClose={() => setEditOpen(false)} office={office} />
      <PriceDrawer clientId={id!} open={priceOpen} onClose={() => setPriceOpen(false)} />
      <BalanceControlModal
        open={balanceOpen}
        onClose={() => setBalanceOpen(false)}
        party="client"
        partyId={id!}
        partyName={data.name}
        balance={balanceNum}
      />

      {/* Paddon amali — tomon QULFLANGAN (mijoz tanlash maydoni yo'q), chegara
          `palletBalance` dan, ya'ni server hisoblagan «hozir mijozda» sonidan. */}
      <ClientPalletDrawer
        open={palletOpen}
        onClose={() => setPalletOpen(false)}
        mode={palletMode}
        clientId={data.id}
        clientName={data.name}
        held={palletBalance}
      />

      <PaymentComposer
        open={uf.get('panel') === 'tolov'}
        onClose={() => uf.set({ panel: null })}
        kind="CLIENT_IN"
        lockParty
        presetParty={{
          id: data.id,
          name: data.name,
          balance: data.balance,
          palletBalance: palletBalance,
          overdueTotal,
        }}
        presetAmount={balanceNum > 0 ? data.balance : undefined}
      />
    </div>
  );
}
