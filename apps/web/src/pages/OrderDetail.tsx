import { useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App,
  Avatar,
  Button,
  Card,
  Col,
  Descriptions,
  Dropdown,
  Empty,
  Flex,
  Input,
  InputNumber,
  List,
  Progress,
  Radio,
  Row,
  Segmented,
  Select,
  Skeleton,
  Space,
  Table,
  Tabs,
  Tag,
  Timeline,
  Tooltip,
  Typography,
  theme,
} from 'antd';
import {
  ContainerOutlined,
  EditOutlined,
  MoreOutlined,
  ReloadOutlined,
  SendOutlined,
  StopOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { apiError, asItems, endpoints } from '../lib/api';
import {
  fmtDate,
  fmtDateTime,
  fmtM3,
  fmtMoney,
  num,
  PAYMENT_KIND,
  PAYMENT_METHOD,
} from '../lib/format';
import { COST_STATUS, PRICE_KIND, STATUS, TRANSPORT_PAID, type StatusMeta } from '../lib/status-maps';
import { clientChargeable, clientDirectTransport } from '../lib/order-money';
import {
  FormDrawer,
  MoneyCell,
  MoneyInput,
  PageHeader,
  PalletChip,
  CancelOrderModal,
  PaymentComposer,
  ReasonModal,
  StatusChip,
  type MobileCardModel,
  type MoneyVariant,
  type PageHeaderAction,
} from '../components';
import { TOPBAR_H, TOUCH_MIN, useIsDesktop, useIsPhone } from '../lib/responsive';
import { useT } from '../components/LangContext';
import type { TFn } from '../lib/i18n';
import { translate } from '../lib/i18n';
import { useAuth } from '../auth/AuthContext';
import type {
  AdvanceBucket,
  Allocation,
  CancelMoneyMode,
  FactoryPayIntent,
  Order,
  OrderItem,
  OrderStatus,
  PaymentKind,
  PaymentMethod,
  TransportMode,
} from '../lib/types';

// Lifecycle stepping removed (owner rule, 2026-07-22): an order is COMPLETED the instant it is
// created, so there is no NEW→…→COMPLETED stepper and no «next stage» action any more. The only
// surviving state distinction is CANCELLED, shown as an alert.

const TRANSPORT_MODE_LABEL: Record<TransportMode, string> = {
  CLIENT_OWN: "Mijozning o'z transporti",
  DEALER_ABSORBED: "Shofyorga diller to'laydi (summa ichidan)",
  CLIENT_PAYS_DRIVER: "Shofyorga mijoz to'laydi (summa ichidan)",
  DEALER_CHARGED: 'Summa ustiga qo‘shilgan (eski usul)',
};

const PALLET_TX_LABEL: Record<string, string> = {
  RECEIVED_FROM_FACTORY: 'Zavoddan qabul qilindi',
  DELIVERED_TO_CLIENT: 'Mijozga yuborildi',
  RETURNED_BY_CLIENT: 'Mijozdan qaytdi',
  RETURNED_TO_FACTORY: 'Zavodga qaytarildi',
  CHARGED_LOST: "Yo'qotilgan (hisobga o'tkazildi)",
  ADJUSTMENT: 'Tuzatish',
  REVERSAL: 'Storno',
};

/** Narx holati chip — reuses the design-language cost hues (02 §2.5). */
const PRICE_STATE: { pending: StatusMeta; priced: StatusMeta } = {
  pending: { get label() { return translate('Narxlanmagan'); }, light: '#9A6700', dark: '#D9A94A' },
  priced: { get label() { return translate('Narxlangan'); }, light: '#1A7F37', dark: '#6CC495' },
};

/**
 * «Zavodga to'lov turi» (owner rule R1). UNKNOWN carries the reserved violet — the same
 * ink the imported-UNKNOWN queue uses — because it is a real owner decision («hali
 * bilmayman»), not a blank field, and it changes what this whole screen may claim.
 */
const FACTORY_PAY_INTENT: Record<FactoryPayIntent, StatusMeta> = {
  CASH: { get label() { return translate('Naqd orqali'); }, light: '#1A7F37', dark: '#6CC495' },
  BANK: { get label() { return translate("O'tkazma orqali"); }, light: '#2563EB', dark: '#7EA8F2' },
  UNKNOWN: { get label() { return translate('Aniq emas'); }, light: '#6D5BD0', dark: '#9B8CF0', filled: true },
};

/** one line saying what picking this intent DOES — the consequence, not the name again. */
const INTENT_CONSEQUENCE: Record<FactoryPayIntent, string> = {
  CASH: 'tannarx zavod naqd narxida hisoblanadi',
  BANK: "tannarx zavod o'tkazma narxida hisoblanadi",
  UNKNOWN: "tannarx to'lov qilinganda aniqlanadi — foyda hozircha aniqlanmagan",
};

/** the advance channel → the factory price its slice is bought at (R3). */
const BUCKET_PRICE_KIND: Record<AdvanceBucket, 'FACTORY_CASH' | 'FACTORY_BANK'> = {
  ADVANCE_CASH: 'FACTORY_CASH',
  ADVANCE_BANK: 'FACTORY_BANK',
};

const BUCKET_CONSEQUENCE: Record<AdvanceBucket, string> = {
  ADVANCE_CASH: 'naqd avansdan yechsangiz tannarx ZAVOD NAQD narxida hisoblanadi',
  ADVANCE_BANK: "o'tkazma avansdan yechsangiz tannarx ZAVOD O'TKAZMA narxida hisoblanadi",
};

/** profit ink: positive = money-in (green), negative = we-owe (red), zero = neutral. */
const profitVariant = (n: number): MoneyVariant => (n > 0 ? 'in' : n < 0 ? 'weOwe' : 'neutral');

interface PalletTx {
  id: string;
  at: string;
  date: string;
  type: string;
  qty: number;
  note?: string | null;
  /** which side the row belongs to — the server partitions its balances the same way */
  clientId?: string | null;
  factoryId?: string | null;
}

/**
 * Pallet COUNT arithmetic (R4 — no pallet money anywhere on the factory side).
 * Mirrors PalletService.combineClientSums / combineFactorySums exactly, including the
 * side split: an ADJUSTMENT row counts for whichever party it names, so summing by
 * type alone would fold a client correction into the factory's count.
 */
const palletQty = (rows: PalletTx[], type: string) =>
  rows.filter((r) => r.type === type).reduce((s, r) => s + r.qty, 0);

function palletCounts(txs: PalletTx[]) {
  const clientRows = txs.filter((r) => r.clientId);
  const factoryRows = txs.filter((r) => r.factoryId);
  const toClient = palletQty(clientRows, 'DELIVERED_TO_CLIENT');
  const backFromClient = palletQty(clientRows, 'RETURNED_BY_CLIENT');
  return {
    toClient,
    backFromClient,
    /** still at the client: delivered − returned − written off + corrections */
    atClient:
      toClient -
      backFromClient -
      palletQty(clientRows, 'CHARGED_LOST') +
      palletQty(clientRows, 'ADJUSTMENT') +
      palletQty(clientRows, 'REVERSAL'),
    /** what WE owe the factory in kind: received − returned + corrections */
    owedToFactory:
      palletQty(factoryRows, 'RECEIVED_FROM_FACTORY') -
      palletQty(factoryRows, 'RETURNED_TO_FACTORY') +
      palletQty(factoryRows, 'ADJUSTMENT') +
      palletQty(factoryRows, 'REVERSAL'),
    any: txs.length > 0,
  };
}

/** detail include tree returns more than the shared Order type declares */
type OrderDetailData = Order & {
  palletTransactions?: PalletTx[];
  createdBy?: { id: string; name: string; username?: string } | null;
};

type TimelineEvent =
  | { type: 'status'; at: string; from: OrderStatus | null; to: OrderStatus; by: string | null; note: string | null }
  | {
      type: 'payment';
      at: string;
      paymentId: string;
      kind: PaymentKind;
      method: PaymentMethod;
      amount: string;
      voided: boolean;
    }
  | { type: 'comment'; at: string; by: string | null; text: string };

const moneyFormatter = (v: number | string | undefined) => `${v ?? ''}`.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const moneyParser = (v: string | undefined) => Number((v ?? '').replace(/\s/g, ''));

/** consistent branded surface + optional overline header (design system §layout). */
function Section({
  title,
  extra,
  children,
  style,
  bodyPad = 16,
}: {
  title?: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
  bodyPad?: number;
}) {
  const t = useT();
  const isPhone = useIsPhone();
  return (
    // telefonda 16px yon padding 320px ekranda juda qimmat — 12px ga tushadi
    <div className="dash-card" style={{ padding: isPhone ? Math.min(bodyPad, 12) : bodyPad, ...style }}>
      {title || extra ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            marginBottom: 14,
            ...(isPhone ? { flexWrap: 'wrap' as const, rowGap: 8, minWidth: 0 } : null),
          }}
        >
          {title ? (
            <span className="sb-overline" style={isPhone ? { minWidth: 0 } : undefined}>
              {typeof title === 'string' ? t(title) : title}
            </span>
          ) : (
            <span />
          )}
          {extra ?? null}
        </div>
      ) : null}
      {children}
    </div>
  );
}

/**
 * Telefon uchun karta ro'yxati — buyurtma ichidagi jadvallar o'rniga (spec §2.2:
 * OrderDetail ichki jadvallari ham telefonda kartaga aylanadi). DataTable ochgan
 * `.sb-mcard*` klasslarini qayta ishlatadi; bu ro'yxatlar query'ga emas, oddiy
 * massivga tayangani uchun DataTable'ning o'zi (sahifalash, URL filtrlari,
 * klaviatura kursori) bu yerda ortiqcha bo'lar edi.
 */
function PhoneCards<T>({
  rows,
  rowKey,
  card,
  empty,
}: {
  rows: T[];
  rowKey: (row: T) => string;
  card: (row: T) => MobileCardModel;
  empty: ReactNode;
}) {
  const t = useT();
  if (rows.length === 0) return <>{empty}</>;
  return (
    // padding: 0 — karta ro'yxati allaqachon Section ichida, ikkilangan inset bo'lmasin
    <ul className="sb-mcards" style={{ padding: 0 }}>
      {rows.map((row) => {
        const c = card(row);
        return (
          <li key={rowKey(row)} className={`sb-mcard${c.ghost ? ' sb-mcard--ghost' : ''}`}>
            <div className="sb-mcard__body">
              <div className="sb-mcard__row">
                <div className="sb-mcard__head">
                  <div className="sb-mcard__title">{c.title}</div>
                  {c.subtitle ? <div className="sb-mcard__subtitle">{c.subtitle}</div> : null}
                </div>
                {c.value ? <div className="sb-mcard__value">{c.value}</div> : null}
              </div>
              {c.meta ? <div className="sb-mcard__meta">{c.meta}</div> : null}
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
              {c.actions ? <div className="sb-mcard__actions">{c.actions}</div> : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** kartadagi «yorliq: qiymat» chipi — DataTable karta yo'li bilan bir xil markup. */
function Chip({ label, children }: { label?: string; children: ReactNode }) {
  const t = useT();
  return (
    <span className="sb-mcard__chip">
      {label ? <em className="sb-mcard__chip-label">{t(label)}</em> : null}
      {children}
    </span>
  );
}

/**
 * Telefonda amallar sarlavhadan pastki yopishqoq panelga ko'chadi: sahifa uzun
 * (holat → ma'lumot → pozitsiyalar → tablar → moliya), asosiy amal uchun tepaga
 * qaytib skroll qilish shart bo'lmasin. Panel tab bar va home-indicator ustida
 * turadi (R8); o'ng chetda ChatDock FAB uchun joy qoldiriladi, z-index esa FAB
 * (150) dan past — FAB panel ustida suzib qolaveradi.
 *
 * `document.body` ga portal orqali chiqariladi: sahifa `.sb-route` ichida, unda
 * esa `transform` animatsiyasi bor — animatsiya davomida u `position: fixed`
 * uchun containing block yaratib, panelni ekrandan tashqariga uloqtirar edi.
 */
function MobileActionBar({ actions }: { actions: PageHeaderAction[] }) {
  const t = useT();
  const { token } = theme.useToken();
  if (actions.length === 0 || typeof document === 'undefined') return null;
  // asosiy amal yo'q bo'lsa (masalan yakunlangan buyurtma) birinchisi oddiy tugma
  // bo'ladi — uni «primary» qilib bo'yash sarlavhadagi ierarxiyani buzar edi
  const primary = actions.find((a) => a.primary && !a.disabled) ?? actions.find((a) => a.primary) ?? actions[0];
  const rest = actions.filter((a) => a !== primary);
  return createPortal(
    <div
      style={{
        position: 'fixed',
        insetInlineStart: 0,
        insetInlineEnd: 0,
        bottom: 'calc(var(--sb-tabbar-h) + var(--sb-safe-b))',
        zIndex: 140,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px calc(var(--sb-fab-h) + 24px) 8px max(12px, var(--sb-safe-l))',
        background: token.colorBgContainer,
        borderTop: `1px solid ${token.colorBorderSecondary}`,
        boxShadow: '0 -4px 20px rgba(2, 6, 18, 0.06)',
      }}
    >
      <Button
        type={primary.primary ? 'primary' : 'default'}
        icon={primary.icon}
        danger={primary.danger}
        disabled={primary.disabled}
        onClick={primary.onClick}
        style={{ flex: '1 1 auto', minWidth: 0, minHeight: TOUCH_MIN }}
      >
        {t(primary.label)}
      </Button>
      {rest.length > 0 ? (
        <Dropdown
          trigger={['click']}
          placement="topRight"
          menu={{
            items: rest.map((a) => ({
              key: a.key,
              icon: a.icon,
              danger: a.danger,
              disabled: a.disabled,
              label: t(a.label),
              onClick: a.onClick,
            })),
          }}
        >
          <Button
            icon={<MoreOutlined />}
            aria-label={t('Boshqa amallar')}
            style={{ flex: '0 0 auto', minWidth: TOUCH_MIN, minHeight: TOUCH_MIN }}
          />
        </Dropdown>
      ) : null}
    </div>,
    document.body,
  );
}

/**
 * one figure row in the finance summary rail.
 * `sub` — ustidagi satrning ICHIDAN chiqqan ulush («shundan …»): chapga surilgan,
 * chizig'i yo'q, shuning uchun bo'linish bitta blok bo'lib o'qiladi.
 */
function SummaryRow({
  label,
  value,
  last,
  sub,
}: {
  label: ReactNode;
  value: ReactNode;
  last?: boolean;
  sub?: boolean;
}) {
  const t = useT();
  const isPhone = useIsPhone();
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: sub ? '2px 0 8px' : '8px 0',
        paddingInlineStart: sub ? 14 : undefined,
        borderBottom: last ? undefined : '1px solid var(--sb-border)',
        // Telefonda uzun yorliq/qiymat (masalan transport rejimi) bir satrga
        // sig'maydi — qiymat o'z satriga tushadi va o'ngga tekislanib qoladi.
        // Desktopda o'ram YO'Q: rail kengligi o'zgarmagan, ko'rinish muzlatilgan.
        ...(isPhone ? { flexWrap: 'wrap' as const, rowGap: 2 } : null),
      }}
    >
      <Typography.Text
        type={sub ? undefined : 'secondary'}
        style={{
          fontSize: sub ? 12 : 13,
          ...(sub ? { color: 'var(--sb-fg-subtle)' } : null),
          ...(isPhone ? { minWidth: 0 } : null),
        }}
      >
        {typeof label === 'string' ? t(label) : label}
      </Typography.Text>
      <span style={{ textAlign: 'right', ...(isPhone ? { minWidth: 0, marginInlineStart: 'auto' } : null) }}>
        {typeof value === 'string' ? t(value) : value}
      </span>
    </div>
  );
}

/**
 * What we still owe the FACTORY for this one order — and the ONE door money
 * standing at the factory may walk through to reach it (owner rule R2: advance
 * never settles an order by itself).
 *
 * Deliberately silent about the amount until the cost has actually been posted to the
 * ledger (the truck leaving the factory, i.e. LOADING). Before that the order carries a
 * costTotal but no debt, and painting it red would invent a liability that does not
 * exist yet — hence «avval yuklashni boshlang» rather than a greyed-out button with no
 * explanation.
 *
 * `children` — the «qolgani … bilan to'lansa» split, which belongs UNDER this row and
 * ABOVE the action, so the number the button acts on is the last thing read.
 */
function FactoryDebtRow({
  order,
  t,
  canDraw,
  onDraw,
  isPhone,
  children,
}: {
  order: Order;
  t: TFn;
  /** ADMIN/ACCOUNTANT on a live order — everyone else never sees the door at all */
  canDraw: boolean;
  onDraw: () => void;
  isPhone: boolean;
  children?: ReactNode;
}) {
  const posted = !!order.factoryCostPosted;
  const owed = num(order.factoryOutstanding);
  const advance = num(order.factoryAdvance?.total);
  // Name the ONE thing actually in the way, in the order the user can act on it:
  // «zavodda avans qolmagan» is useless advice while the truck is still loading.
  const blocked = !posted
    ? 'avval yuklashni boshlang'
    : owed <= 0
      ? "bu buyurtma bo'yicha zavodga qarz yo'q"
      : advance <= 0
        ? 'zavodda avans qolmagan'
        : null;

  return (
    <>
      <SummaryRow
        label="Zavodga qarzimiz"
        last={!children}
        value={
          !posted ? (
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>
              {t('yuk chiqqach hisoblanadi')}
            </Typography.Text>
          ) : owed > 0 ? (
            <MoneyCell value={order.factoryOutstanding ?? 0} variant="weOwe" strong />
          ) : (
            <Space size={8}>
              <MoneyCell value={0} />
              <Tag color="green">{t('To‘langan')}</Tag>
            </Space>
          )
        }
      />
      {children}
      {canDraw ? (
        // disabled Button yutib yuboradi — tooltip tirik o'ram talab qiladi
        <Tooltip title={blocked ? t(blocked) : undefined}>
          <span style={{ display: 'block' }}>
            <Button
              block
              type="primary"
              icon={<WalletOutlined />}
              disabled={!!blocked}
              style={{ marginTop: 12, minHeight: isPhone ? TOUCH_MIN : undefined }}
              onClick={onDraw}
            >
              {t('AVANSDAN YECHISH')}
            </Button>
          </span>
        </Tooltip>
      ) : null}
    </>
  );
}

export default function OrderDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const t = useT();
  const { hasRole } = useAuth();
  const isPhone = useIsPhone();
  const isDesktop = useIsDesktop();
  const canManage = hasRole('ADMIN', 'ACCOUNTANT');
  const isAdmin = hasRole('ADMIN');

  const [priceTarget, setPriceTarget] = useState<OrderItem | null>(null);
  const [priceMode, setPriceMode] = useState<'perM3' | 'lump'>('perM3');
  const [priceValue, setPriceValue] = useState<number | null>(null);
  const [commentText, setCommentText] = useState('');
  const [activeTab, setActiveTab] = useState('payments');
  // «Shofyorga to'landi deb yozish» — TRANSPORT_DIRECT endi FAQAT buyurtma bilan
  // yaratiladi (API taqsimotsiz qabul qilmaydi), shuning uchun u shu kartadan ochiladi.
  const [directOpen, setDirectOpen] = useState(false);

  // bekor qilish oynasi (pul harakati butunlay serverda hal bo'ladi)
  const [cancelOpen, setCancelOpen] = useState(false);

  // haqiqiy yuk (actual loading) drawer — actual m³ per item
  const [loadOpen, setLoadOpen] = useState(false);
  const [actualDraft, setActualDraft] = useState<Record<string, number | null>>({});

  // «AVANSDAN YECHISH» — kanal tanlash pul o'tkazish emas, NARX qarori (R3),
  // shuning uchun summa kanal almashganda qayta hisoblanadi.
  const [drawOpen, setDrawOpen] = useState(false);
  const [drawBucket, setDrawBucket] = useState<AdvanceBucket>('ADVANCE_CASH');
  const [drawAmount, setDrawAmount] = useState('');

  // bitta taqsimotni orqaga qaytarish (R5) — sababsiz bo'lmaydi
  const [voidTarget, setVoidTarget] = useState<Allocation | null>(null);

  // Super-admin metadata tahriri (moshina/haydovchi/izoh) — har qanday status
  const [editOpen, setEditOpen] = useState(false);
  const [editVehicleId, setEditVehicleId] = useState<string | undefined>();
  const [editDriver, setEditDriver] = useState('');
  const [editNote, setEditNote] = useState('');

  const orderQ = useQuery({
    queryKey: ['orders', id],
    queryFn: () => endpoints.order(id) as Promise<OrderDetailData>,
    enabled: !!id,
  });

  const timelineQ = useQuery({
    queryKey: ['orders', id, 'timeline'],
    queryFn: () => endpoints.orderTimeline(id) as Promise<TimelineEvent[]>,
    enabled: !!id,
  });

  const commentsQ = useQuery({
    queryKey: ['orders', id, 'comments'],
    queryFn: () => endpoints.orderComments(id),
    enabled: !!id,
  });

  const vehiclesQ = useQuery({
    queryKey: ['vehicles', 'order-edit'],
    // pageSize 200 = the @Max(200) API ceiling; the default 50 truncated the fleet.
    queryFn: () => endpoints.vehicles({ pageSize: 200 }),
    enabled: editOpen && isAdmin,
  });

  const adminMut = useMutation({
    mutationFn: (d: { vehicleId?: string | null; driverName?: string | null; note?: string | null }) =>
      endpoints.adminPatchOrder(id, d),
    onSuccess: () => {
      message.success(t('Buyurtma tahrirlandi'));
      qc.invalidateQueries({ queryKey: ['orders'] });
      setEditOpen(false);
    },
    onError: (err) => message.error(apiError(err)),
  });

  const cancelMut = useMutation({
    mutationFn: (v: { reason: string; mode: CancelMoneyMode }) => endpoints.cancelOrder(id, v.reason, v.mode),
    onSuccess: () => {
      message.success(t('Buyurtma bekor qilindi'));
      // kassa/bank ham qimirlaydi (mijoz puli chiqadi, zavod puli qaytadi) — shuning uchun
      // `kassa` ham yangilanadi, aks holda kassa sahifasi eski qoldiqni ko'rsatib turardi
      for (const key of ['orders', 'clients', 'debts', 'pallets', 'payments', 'dashboard', 'kassa', 'factories']) {
        qc.invalidateQueries({ queryKey: [key] });
      }
    },
    onError: (err) => message.error(apiError(err)),
  });

  const priceMut = useMutation({
    mutationFn: (p: { itemId: string; body: { salePricePerM3?: number; saleLumpSum?: number }; reprice?: boolean }) =>
      p.reprice
        ? endpoints.adminRepriceOrderItem(id, p.itemId, p.body)
        : endpoints.priceOrderItem(id, p.itemId, p.body),
    onSuccess: () => {
      message.success(t('Pozitsiya narxlandi'));
      setPriceTarget(null);
      setPriceValue(null);
      for (const key of ['orders', 'clients', 'debts', 'dashboard']) {
        qc.invalidateQueries({ queryKey: [key] });
      }
    },
    onError: (err) => message.error(apiError(err)),
  });

  const actualLoadMut = useMutation({
    mutationFn: (items: { itemId: string; actualQuantityM3: number }[]) => endpoints.applyActualLoading(id, items),
    onSuccess: () => {
      message.success(t('Haqiqiy yuk kiritildi — balanslar yangilandi'));
      setLoadOpen(false);
      for (const key of ['orders', 'clients', 'debts', 'dashboard', 'factories']) {
        qc.invalidateQueries({ queryKey: [key] });
      }
    },
    onError: (err) => message.error(apiError(err)),
  });

  /** every surface that reads a factory bucket, a cost or a profit moves on these three. */
  const invalidateFactorySide = () => {
    for (const key of ['orders', 'payments', 'factories', 'debts', 'dashboard']) {
      qc.invalidateQueries({ queryKey: [key] });
    }
  };

  const intentMut = useMutation({
    mutationFn: (v: FactoryPayIntent) => endpoints.setFactoryPayIntent(id, v),
    onSuccess: () => {
      message.success(t("Zavodga to'lov turi o'zgartirildi"));
      invalidateFactorySide();
    },
    onError: (err) => message.error(apiError(err)),
  });

  const drawMut = useMutation({
    mutationFn: (d: { bucket: AdvanceBucket; amount: string }) => endpoints.drawFactoryAdvance(id, d),
    onSuccess: (updated, variables) => {
      // Server clamps a draw to min(kanal qoldig'i, buyurtmaning SHU BAZADAGI
      // ehtiyoji) (R2) — u so'ralgan summadan KAM yechishi mumkin, sukut bilan.
      // Solishtirish buyurtmaning O'ZINING oldin/keyingi qoldig'i orqali (`needAt`)
      // qilinadi — zavod bo'ylab umumiy kanal balansi emas, chunki u shu buyurtmaga
      // aloqasi yo'q sabablar bilan ham siljishi mumkin.
      const requested = num(variables.amount);
      const before = needAt(variables.bucket);
      const afterCov = updated.factoryCoverage;
      const after = afterCov
        ? num(variables.bucket === 'ADVANCE_CASH' ? afterCov.remainingCash : afterCov.remainingBank)
        : num(updated.factoryOutstanding);
      const drawn = Math.max(0, before - after);
      if (drawn + 1 < requested) {
        const why =
          after < 1
            ? t('buyurtmaning shu kanaldagi ehtiyoji shuncha edi, xolos')
            : t('kanalda shuncha avans qolgan edi, xolos');
        message.warning(
          t("So'ralgan {requested} so'mdan faqat {drawn} so'm yechildi — {why}", {
            requested: fmtMoney(requested),
            drawn: fmtMoney(drawn),
            why,
          }),
        );
      } else {
        message.success(t('Avansdan yechildi'));
      }
      setDrawOpen(false);
      invalidateFactorySide();
    },
    onError: (err) => message.error(apiError(err)),
  });

  const voidAllocMut = useMutation({
    mutationFn: (p: { alloc: Allocation; reason: string }) =>
      endpoints.voidAllocation(p.alloc.paymentId, p.alloc.id, p.reason),
    onSuccess: () => {
      message.success(t('Taqsimot bekor qilindi'));
      setVoidTarget(null);
      // mijoz taqsimoti ham shu yo'l bilan qaytariladi — mijoz balansi ham yangilansin
      qc.invalidateQueries({ queryKey: ['clients'] });
      invalidateFactorySide();
    },
    onError: (err) => message.error(apiError(err)),
  });

  const commentMut = useMutation({
    mutationFn: (text: string) => endpoints.addOrderComment(id, text),
    onSuccess: () => {
      setCommentText('');
      qc.invalidateQueries({ queryKey: ['orders', id] });
    },
    onError: (err) => message.error(apiError(err)),
  });

  if (orderQ.isLoading) {
    return (
      <Card>
        <Skeleton active paragraph={{ rows: 10 }} />
      </Card>
    );
  }

  if (orderQ.isError) {
    return (
      <Alert
        type="error"
        showIcon
        message={t('Buyurtmani yuklashda xatolik')}
        description={apiError(orderQ.error)}
        action={
          <Button icon={<ReloadOutlined />} onClick={() => orderQ.refetch()}>
            {t('Qayta urinish')}
          </Button>
        }
      />
    );
  }

  const order = orderQ.data;
  if (!order) return null;

  const cancelled = order.status === 'CANCELLED';

  // actual load can be captured once goods have left the factory (LOADING onward) and
  // before the factory cost is finalized — Admin/Accountant only, mirrors the backend gate.
  const canEnterActual =
    canManage &&
    !cancelled &&
    order.costStatus === 'PROVISIONAL' &&
    (['LOADING', 'DELIVERING', 'DELIVERED'] as OrderStatus[]).includes(order.status);

  const openActual = () => {
    const draft: Record<string, number | null> = {};
    for (const it of order.items ?? []) {
      draft[it.id] = it.actualQuantityM3 != null ? num(it.actualQuantityM3) : num(it.quantityM3);
    }
    setActualDraft(draft);
    setLoadOpen(true);
  };

  const submitActual = () => {
    const items: { itemId: string; actualQuantityM3: number }[] = [];
    for (const it of order.items ?? []) {
      const v = actualDraft[it.id];
      if (v != null && v > 0) items.push({ itemId: it.id, actualQuantityM3: v });
    }
    if (!items.length) {
      message.warning(t('Kamida bitta pozitsiya uchun haqiqiy hajm kiriting'));
      return;
    }
    actualLoadMut.mutate(items);
  };

  // Bekor qilish — `CancelOrderModal` egasining savolini so'raydi, shu buyurtmaning REAL pul
  // xaritasini ko'rsatadi va tanlangan rejimni serverga uzatadi. Pul harakati BUTUNLAY
  // serverda, bitta tranzaksiyada bo'ladi (qo'shimcha to'lov oynasi ochilmaydi).
  const confirmCancel = async (reason: string, mode: CancelMoneyMode) => {
    try {
      await cancelMut.mutateAsync({ reason, mode });
    } catch {
      // xato `cancelMut.onError` da ko'rsatiladi — oyna ochiq qoladi, kiritilgan sabab
      // saqlanib turadi. Bu `catch` bo'lmasa mutateAsync ushlanmagan rejection beradi.
      return;
    }
    setCancelOpen(false);
  };

  const submitPrice = () => {
    if (!priceTarget) return;
    if (!priceValue || priceValue <= 0) {
      message.warning(t('Musbat qiymat kiriting'));
      return;
    }
    priceMut.mutate({
      itemId: priceTarget.id,
      body: priceMode === 'perM3' ? { salePricePerM3: priceValue } : { saleLumpSum: priceValue },
      reprice: !priceTarget.pricePending, // narxlangan pozitsiya → admin tuzatish (ledger delta)
    });
  };

  // ── items ──
  const anyPending = (order.items ?? []).some((i) => i.pricePending);
  const dash = <span style={{ color: token.colorTextTertiary }}>—</span>;
  const openPricing = (r: OrderItem) => {
    setPriceTarget(r);
    setPriceMode('perM3');
    setPriceValue(null);
  };
  /** haqiqiy hajm rejadagidan farq qiladimi — tooltip ham, karta ham shuni o'qiydi */
  const hasActualQty = (r: OrderItem) =>
    r.actualQuantityM3 != null && num(r.actualQuantityM3) !== num(r.quantityM3);
  const itemColumns: ColumnsType<OrderItem> = [
    { title: t('Mahsulot'), key: 'product', ellipsis: true, width: 220, render: (_, r) => r.product?.name ?? '—' },
    { title: t("O'lcham"), key: 'size', ellipsis: true, width: 120, render: (_, r) => r.product?.size ?? '—' },
    {
      title: t('Hajm'),
      key: 'quantityM3',
      align: 'right',
      className: 'num',
      render: (_, r) => {
        const hasActual = hasActualQty(r);
        return hasActual ? (
          <Tooltip title={t('Rejadagi hajm: {v}', { v: fmtM3(r.quantityM3) })}>
            <span>
              {fmtM3(r.actualQuantityM3)}{' '}
              <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                {t('haqiqiy')}
              </Typography.Text>
            </span>
          </Tooltip>
        ) : (
          fmtM3(r.quantityM3)
        );
      },
    },
    { title: t('Pallet'), key: 'palletCount', align: 'right', className: 'num', render: (_, r) => r.palletCount },
    {
      title: t('1 m³ narxi'),
      key: 'salePricePerM3',
      align: 'right',
      className: 'num',
      render: (_, r) => (r.pricePending ? dash : <MoneyCell value={r.salePricePerM3} />),
    },
    {
      title: t('Summa'),
      key: 'saleTotal',
      align: 'right',
      className: 'num',
      render: (_, r) => (r.pricePending ? dash : <MoneyCell value={r.saleTotal} strong />),
    },
    {
      title: t('Narx holati'),
      key: 'pricePending',
      render: (_, r) => <StatusChip meta={r.pricePending ? PRICE_STATE.pending : PRICE_STATE.priced} />,
    },
    ...(!cancelled && ((canManage && anyPending) || isAdmin)
      ? ([
          {
            title: '',
            key: 'actions',
            align: 'right' as const,
            render: (_: unknown, r: OrderItem) =>
              r.pricePending ? (
                canManage ? (
                  <Button size="small" type="primary" ghost onClick={() => openPricing(r)}>
                    {t('Narxlash')}
                  </Button>
                ) : null
              ) : isAdmin ? (
                <Button size="small" icon={<EditOutlined />} onClick={() => openPricing(r)}>
                  {t('Narxni tuzatish')}
                </Button>
              ) : null,
          },
        ] as ColumnsType<OrderItem>)
      : []),
  ];

  /**
   * Pozitsiya kartasi (telefon). 8 ustunli jadval 320px da o'qilmaydi.
   * R12: rejadagi hajm desktopda tooltipda yashiringan — kartada u KO'RINADIGAN
   * chip bo'ladi, chunki teginishda tooltip yo'q.
   */
  const itemCard = (r: OrderItem): MobileCardModel => {
    const hasActual = hasActualQty(r);
    return {
      title: r.product?.name ?? '—',
      subtitle: r.product?.size ?? undefined,
      value: r.pricePending ? dash : <MoneyCell value={r.saleTotal} strong />,
      meta: (
        <>
          <Chip label="Hajm">
            {fmtM3(hasActual ? r.actualQuantityM3 : r.quantityM3)}
            {hasActual ? ` ${t('haqiqiy')}` : ''}
          </Chip>
          {hasActual ? <Chip label="Rejadagi:">{fmtM3(r.quantityM3)}</Chip> : null}
          <Chip label="Pallet">{r.palletCount}</Chip>
          <StatusChip meta={r.pricePending ? PRICE_STATE.pending : PRICE_STATE.priced} />
        </>
      ),
      lines: [{ label: '1 m³ narxi', value: r.pricePending ? dash : <MoneyCell value={r.salePricePerM3} /> }],
      actions: cancelled ? undefined : r.pricePending ? (
        canManage ? (
          <Button type="primary" ghost block style={{ minHeight: TOUCH_MIN }} onClick={() => openPricing(r)}>
            {t('Narxlash')}
          </Button>
        ) : undefined
      ) : isAdmin ? (
        <Button icon={<EditOutlined />} block style={{ minHeight: TOUCH_MIN }} onClick={() => openPricing(r)}>
          {t('Narxni tuzatish')}
        </Button>
      ) : undefined,
    };
  };

  // ── money summary (display-only arithmetic via num) ──
  const costCash = num(order.costTotalCash ?? order.costTotal);
  const costBank = num(order.costTotalBank ?? order.costTotal);
  const goodsProfit = num(order.saleTotal) - num(order.costTotal);
  const profitCash = num(order.saleTotal) - costCash;
  const profitBank = num(order.saleTotal) - costBank;
  const transportProfit = num(order.transportCharge) - num(order.transportCost);

  /**
   * The factory side is driven by COVERAGE, never by costStatus. A MIXED order is
   * FINAL and still stands on two bases, so `costStatus === 'FINAL'` stopped meaning
   * «there is exactly one cost number» the day advances split into two channels.
   */
  const cov = order.factoryCoverage;
  const intent: FactoryPayIntent = order.factoryPayIntent ?? 'UNKNOWN';
  const paidCash = num(cov?.paidCash);
  const paidBank = num(cov?.paidBank);
  const remainingCash = num(cov?.remainingCash);
  const remainingBank = num(cov?.remainingBank);
  const covStarted = paidCash > 0 || paidBank > 0;
  // The two bases earn their own lines only while they still disagree AND part of the
  // order is already bought. Before the first settlement they ARE the two candidate cost
  // rows above; after it, an equal pair is just «Zavodga qarzimiz» under a second name.
  const remainingSplit = covStarted && !cov?.settled && Math.abs(remainingCash - remainingBank) >= 1;

  // ── factory advance (R2/R3) ──
  const advCash = num(order.factoryAdvance?.cash);
  const advBank = num(order.factoryAdvance?.bank);
  /** what this order still needs, priced at the basis the channel would buy it at */
  const needAt = (b: AdvanceBucket) =>
    cov ? (b === 'ADVANCE_CASH' ? remainingCash : remainingBank) : num(order.factoryOutstanding);
  /** floor, not round — a draw may never exceed the channel or the order's need */
  const drawMax = (b: AdvanceBucket) =>
    Math.max(0, Math.floor(Math.min(b === 'ADVANCE_CASH' ? advCash : advBank, needAt(b))));
  const canDrawAdvance = canManage && !cancelled;

  const pickBucket = (b: AdvanceBucket) => {
    setDrawBucket(b);
    // kanal almashsa narx bazasi ham almashadi — eski summa endi boshqa qarzga tegishli
    setDrawAmount(String(drawMax(b)));
  };

  const openDraw = () => {
    // niyatdagi kanaldan boshlaymiz, lekin bo'sh kanal taklif qilinmaydi
    const preferred: AdvanceBucket = intent === 'BANK' ? 'ADVANCE_BANK' : 'ADVANCE_CASH';
    const other: AdvanceBucket = preferred === 'ADVANCE_CASH' ? 'ADVANCE_BANK' : 'ADVANCE_CASH';
    const b = drawMax(preferred) > 0 ? preferred : other;
    setDrawBucket(b);
    setDrawAmount(String(drawMax(b)));
    setDrawOpen(true);
  };

  const submitDraw = () => {
    // server oxirgi hakam, lekin qirqib yuborish xato so'rovni umuman jo'natmaydi
    const amount = Math.min(num(drawAmount), drawMax(drawBucket));
    if (!(amount > 0)) {
      message.warning(t('Musbat summa kiriting'));
      return;
    }
    drawMut.mutate({ bucket: drawBucket, amount: String(amount) });
  };

  const palletBalances = palletCounts(order.palletTransactions ?? []);
  const clientPaysDriver = order.transportMode === 'CLIENT_PAYS_DRIVER';
  // «Shofyorga mijoz to'laydi» rejimida shofyorning ulushi mijoz qarzidan chiqarilgan —
  // diller bu pulni umuman ko'rmaydi, shuning uchun «Dillerda qoladi» = «Mijoz bizga qarz»
  // bo'lib qoladi va bitta pulni ikki nom bilan ko'rsatmaslik uchun o'sha satr yashiriladi.
  const directTransport = clientDirectTransport(order);
  const chargeable = clientChargeable(order);
  // DEALER_ABSORBED: diller to'liq savdo summasini yig'adi va shofyorga o'zi to'laydi.
  // (Eski DEALER_CHARGED transportni ustiga qo'shib yozgan — shuning uchun +charge.)
  const dealerKeeps = num(order.saleTotal) + num(order.transportCharge) - num(order.transportCost);
  const clientOwes = num(order.clientOutstanding);

  // ── allocations ──
  const activeAllocs = (order.allocations ?? []).filter((a) => !a.voidedAt && !a.payment?.voidedAt);
  // Maxraj = mijoz DILLERGA qarzdor summa (transport ulushi allaqachon chiqarilgan), shuning
  // uchun to'liq to'langan buyurtma aynan 100% ga yetadi. TRANSPORT_DIRECT bu yerda
  // hisoblanmaydi — u dillerga kelgan pul emas, faqat shofyor pulini olgani hujjati.
  const clientAllocated = activeAllocs
    .filter((a) => a.payment?.kind === 'CLIENT_IN')
    .reduce((s, a) => s + num(a.amount), 0);
  const allocPercent = chargeable > 0 ? Math.min(100, Math.round((clientAllocated / chargeable) * 100)) : 0;
  // TRANSPORT_DIRECT — pul harakati emas, HUJJAT: shofyor o'z ulushini olganini qayd etadi
  // va transport holatini yuritadi. Shu bois alohida hisoblanadi.
  const directRecorded = activeAllocs
    .filter((a) => a.payment?.kind === 'TRANSPORT_DIRECT')
    .reduce((s, a) => s + num(a.amount), 0);
  const directRemaining = Math.max(0, directTransport - directRecorded);

  const allocColumns: ColumnsType<Allocation> = [
    { title: t('Sana'), key: 'date', render: (_, r) => fmtDate(r.payment?.date) },
    { title: t('Turi'), key: 'kind', render: (_, r) => (r.payment ? t(PAYMENT_KIND[r.payment.kind]) : '—') },
    { title: t('Usul'), key: 'method', render: (_, r) => (r.payment ? t(PAYMENT_METHOD[r.payment.method]) : '—') },
    // «qaysi narxda sotib olindi» — MIXED buyurtmaning butun mazmuni shu ustunda.
    // FACTORY_CASH/FACTORY_BANK zavod narx bazasini aytadi, shuning uchun agentga emas (D1).
    ...(canManage
      ? ([
          {
            title: t('Narx bazasi'),
            key: 'priceKind',
            render: (_: unknown, r: Allocation) => (
              <Space size={6} wrap>
                {r.priceKind ? <StatusChip meta={PRICE_KIND[r.priceKind]} /> : dash}
                {r.fromAdvance ? <Tag>{t('avansdan')}</Tag> : null}
              </Space>
            ),
          },
        ] as ColumnsType<Allocation>)
      : []),
    {
      title: t('Summa'),
      key: 'amount',
      align: 'right',
      className: 'num',
      render: (_, r) => <MoneyCell value={r.amount} />,
    },
    {
      title: '',
      key: 'link',
      render: (_, r) => <Link to={`/payments?paymentId=${r.paymentId}`}>{t("To'lov")}</Link>,
    },
    // SettleDrawer «avval mavjud taqsimotni bekor qiling» deb turardi — bekor qiladigan
    // joy esa yo'q edi. Bu ustun o'sha ko'chani ochadi (R5).
    ...(canManage && !cancelled
      ? ([
          {
            title: '',
            key: 'void',
            align: 'right' as const,
            render: (_: unknown, r: Allocation) => (
              <Tooltip title={t('Taqsimotni bekor qilish')}>
                <Button
                  size="small"
                  danger
                  icon={<StopOutlined />}
                  aria-label={t('Taqsimotni bekor qilish')}
                  onClick={() => setVoidTarget(r)}
                />
              </Tooltip>
            ),
          },
        ] as ColumnsType<Allocation>)
      : []),
  ];

  /** allokatsiya kartasi (telefon) — to'lov hujjatiga o'tish to'liq kenglikdagi tugma */
  const allocCard = (r: Allocation): MobileCardModel => ({
    title: r.payment ? t(PAYMENT_KIND[r.payment.kind]) : '—',
    subtitle: r.payment ? t(PAYMENT_METHOD[r.payment.method]) : undefined,
    value: <MoneyCell value={r.amount} />,
    meta: (
      <>
        <Chip label="Sana">{fmtDate(r.payment?.date)}</Chip>
        {canManage && r.priceKind ? <StatusChip meta={PRICE_KIND[r.priceKind]} /> : null}
        {r.fromAdvance ? <Chip>{t('avansdan')}</Chip> : null}
      </>
    ),
    actions: (
      <Flex gap={8} style={{ width: '100%' }}>
        <Button
          style={{ flex: '1 1 auto', minWidth: 0, minHeight: TOUCH_MIN }}
          onClick={() => navigate(`/payments?paymentId=${r.paymentId}`)}
        >
          {t("To'lov")}
        </Button>
        {canManage && !cancelled ? (
          <Button
            danger
            icon={<StopOutlined />}
            aria-label={t('Taqsimotni bekor qilish')}
            style={{ flex: '0 0 auto', minWidth: TOUCH_MIN, minHeight: TOUCH_MIN }}
            onClick={() => setVoidTarget(r)}
          />
        ) : null}
      </Flex>
    ),
  });

  const palletColumns: ColumnsType<PalletTx> = [
    { title: t('Sana'), key: 'date', render: (_, r) => fmtDate(r.date) },
    { title: t('Turi'), key: 'type', render: (_, r) => t(PALLET_TX_LABEL[r.type] ?? r.type) },
    { title: t('Soni'), key: 'qty', align: 'right', className: 'num', render: (_, r) => r.qty },
    { title: t('Izoh'), key: 'note', render: (_, r) => r.note ?? '—' },
  ];

  /** paddon harakati kartasi (telefon) */
  const palletCard = (r: PalletTx): MobileCardModel => ({
    title: t(PALLET_TX_LABEL[r.type] ?? r.type),
    value: <span className="num">{r.qty}</span>,
    meta: <Chip label="Sana">{fmtDate(r.date)}</Chip>,
    lines: r.note ? [{ label: 'Izoh', value: r.note }] : undefined,
  });

  // ── timeline (semantic hues via tokens) ──
  const timelineItems = (timelineQ.data ?? []).map((ev) => {
    if (ev.type === 'status') {
      return {
        color:
          ev.to === 'CANCELLED'
            ? token.colorError
            : ev.to === 'COMPLETED'
              ? token.colorSuccess
              : token.colorPrimary,
        children: (
          <Space orientation="vertical" size={0}>
            <Space size={8} wrap>
              <StatusChip meta={STATUS[ev.to]} />
              <Typography.Text type="secondary">{fmtDateTime(ev.at)}</Typography.Text>
              {ev.by && <Typography.Text type="secondary">{ev.by}</Typography.Text>}
            </Space>
            {ev.note && <Typography.Text type="secondary">{ev.note}</Typography.Text>}
          </Space>
        ),
      };
    }
    if (ev.type === 'payment') {
      return {
        color: ev.voided ? token.colorError : token.colorSuccess,
        children: (
          <Space size={8} wrap>
            <Typography.Text strong>{t(PAYMENT_KIND[ev.kind])}</Typography.Text>
            <Typography.Text>({t(PAYMENT_METHOD[ev.method])})</Typography.Text>
            <MoneyCell value={ev.amount} />
            <Typography.Text type="secondary">{fmtDateTime(ev.at)}</Typography.Text>
            {ev.voided && <StatusChip meta={STATUS.CANCELLED} />}
          </Space>
        ),
      };
    }
    return {
      color: token.colorTextTertiary,
      children: (
        <Space orientation="vertical" size={0}>
          <Space size={8} wrap>
            <Typography.Text strong>{ev.by ?? t("Noma'lum")}</Typography.Text>
            <Typography.Text type="secondary">{fmtDateTime(ev.at)}</Typography.Text>
          </Space>
          <Typography.Text>{ev.text}</Typography.Text>
        </Space>
      ),
    };
  });

  const tabs = [
    {
      key: 'payments',
      label: t("To'lovlar"),
      children: (
        <Space orientation="vertical" size={16} style={{ width: '100%' }}>
          <div>
            <Typography.Text type="secondary">
              {t('Mijozdan qabul qilingan:')} <MoneyCell value={clientAllocated} /> / <MoneyCell value={chargeable} />
            </Typography.Text>
            <Progress percent={allocPercent} status={allocPercent >= 100 ? 'success' : 'active'} />
          </div>
          {isPhone ? (
            <PhoneCards<Allocation>
              rows={activeAllocs}
              rowKey={(r) => r.id}
              card={allocCard}
              empty={<Empty description={t("Allokatsiyalar yo'q")} />}
            />
          ) : (
            <Table<Allocation>
              rowKey="id"
              size="small"
              columns={allocColumns}
              dataSource={activeAllocs}
              pagination={false}
              scroll={isDesktop ? undefined : { x: 'max-content' }}
              locale={{ emptyText: <Empty description={t("Allokatsiyalar yo'q")} /> }}
            />
          )}
        </Space>
      ),
    },
    {
      key: 'pallets',
      label: t('Paddonlar'),
      children: isPhone ? (
        <PhoneCards<PalletTx>
          rows={order.palletTransactions ?? []}
          rowKey={(r) => r.id}
          card={palletCard}
          empty={<Empty description={t("Paddon harakatlari yo'q")} />}
        />
      ) : (
        <Table<PalletTx>
          rowKey="id"
          size="small"
          columns={palletColumns}
          dataSource={order.palletTransactions ?? []}
          pagination={false}
          scroll={isDesktop ? undefined : { x: 'max-content' }}
          locale={{ emptyText: <Empty description={t("Paddon harakatlari yo'q")} /> }}
        />
      ),
    },
    {
      key: 'timeline',
      label: t('Tarix'),
      children: timelineQ.isError ? (
        <Alert
          type="error"
          showIcon
          message={t('Tarixni yuklashda xatolik')}
          description={apiError(timelineQ.error)}
          action={
            <Button icon={<ReloadOutlined />} onClick={() => timelineQ.refetch()}>
              {t('Qayta urinish')}
            </Button>
          }
        />
      ) : timelineQ.isLoading ? (
        <Skeleton active />
      ) : timelineItems.length === 0 ? (
        <Empty description={t("Hodisalar yo'q")} />
      ) : (
        <Timeline items={timelineItems} style={{ marginTop: 8 }} />
      ),
    },
    {
      key: 'comments',
      label: t('Izohlar'),
      children: (
        <Space orientation="vertical" size={16} style={{ width: '100%' }}>
          {commentsQ.isError ? (
            <Alert
              type="error"
              showIcon
              message={t('Izohlarni yuklashda xatolik')}
              description={apiError(commentsQ.error)}
              action={
                <Button icon={<ReloadOutlined />} onClick={() => commentsQ.refetch()}>
                  {t('Qayta urinish')}
                </Button>
              }
            />
          ) : (
            <List
              loading={commentsQ.isLoading}
              dataSource={commentsQ.data ?? []}
              locale={{ emptyText: <Empty description={t("Izohlar yo'q")} /> }}
              renderItem={(c) => (
                <List.Item>
                  <List.Item.Meta
                    avatar={<Avatar size="small">{c.by?.name?.[0] ?? '?'}</Avatar>}
                    title={
                      <Space size={8}>
                        <span>{c.by?.name ?? t("Noma'lum")}</span>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {fmtDateTime(c.createdAt)}
                        </Typography.Text>
                      </Space>
                    }
                    description={c.text}
                  />
                </List.Item>
              )}
            />
          )}
          {/* telefonda tugma matni siqilib ketmasin — maydon va tugma ustma-ust */}
          <Flex gap={8} vertical={isPhone}>
            <Input.TextArea
              rows={2}
              maxLength={4000}
              value={commentText}
              placeholder={t('Izoh yozing...')}
              onChange={(e) => setCommentText(e.target.value)}
            />
            <Button
              type="primary"
              icon={<SendOutlined />}
              block={isPhone}
              style={isPhone ? { minHeight: TOUCH_MIN } : undefined}
              loading={commentMut.isPending}
              disabled={!commentText.trim()}
              onClick={() => commentMut.mutate(commentText.trim())}
            >
              {t('Yuborish')}
            </Button>
          </Flex>
        </Space>
      ),
    },
  ];

  const headerActions: PageHeaderAction[] = [
    ...(canEnterActual
      ? [
          {
            key: 'actual',
            label: 'Haqiqiy yuk',
            icon: <ContainerOutlined />,
            onClick: openActual,
          },
        ]
      : []),
    ...(isAdmin && !cancelled
      ? [
          {
            key: 'edit',
            label: 'Tahrirlash',
            icon: <EditOutlined />,
            onClick: () => {
              setEditVehicleId(order.vehicle?.id ?? undefined);
              setEditDriver(order.driverName ?? '');
              setEditNote(order.note ?? '');
              setEditOpen(true);
            },
          },
        ]
      : []),
    ...(canManage && !cancelled
      ? [
          {
            key: 'cancel',
            label: 'Bekor qilish',
            icon: <StopOutlined />,
            danger: true,
            disabled: cancelMut.isPending,
            onClick: () => setCancelOpen(true),
          },
        ]
      : []),
  ];

  return (
    <div>
      <PageHeader
        title={order.orderNo}
        accent
        breadcrumb={[{ label: 'Buyurtmalar', to: '/orders' }, { label: order.orderNo }]}
        meta={
          <>
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>
              {fmtDate(order.date)}
            </Typography.Text>
            <Link to={`/clients/${order.clientId}`} style={{ fontSize: 13 }}>
              {order.client?.name ?? t('Mijoz')}
            </Link>
          </>
        }
        actions={isPhone ? undefined : headerActions}
      />

      <Row gutter={[20, 20]}>
        <Col xs={24} lg={16}>
          <Space orientation="vertical" size={20} style={{ width: '100%' }}>
            {cancelled ? (
              <Section title="Holat">
                <Alert
                  type="error"
                  showIcon
                  message={t('Buyurtma bekor qilingan')}
                  description={order.cancelReason || undefined}
                />
              </Section>
            ) : null}

            <Section title="Ma'lumotlar">
              <Descriptions
                size="small"
                column={{ xs: 1, md: 2 }}
                items={[
                  { key: 'agent', label: t('Agent'), children: order.agent?.name ?? '—' },
                  { key: 'factory', label: t('Zavod'), children: order.factory?.name ?? '—' },
                  {
                    key: 'vehicle',
                    label: t('Moshina'),
                    children: order.vehicle
                      ? `${order.vehicle.name}${order.vehicle.plate ? ` (${order.vehicle.plate})` : ''}`
                      : '—',
                  },
                  { key: 'driver', label: t('Haydovchi'), children: order.driverName ?? '—' },
                  { key: 'dueDate', label: t("To'lov muddati"), children: fmtDate(order.dueDate) },
                  {
                    key: 'costStatus',
                    label: t('Tannarx holati'),
                    children: <StatusChip meta={COST_STATUS[order.costStatus]} />,
                  },
                  {
                    // R1: bu maydon buyurtmaning tannarxi qaysi narxda o'qilishini
                    // hal qiladi, shuning uchun oqibati yonida yozib qo'yiladi —
                    // «Aniq emas» esa bo'sh maydon emas, egasining ongli tanlovi.
                    key: 'payIntent',
                    label: t("Zavodga to'lov turi"),
                    children: (
                      <Space orientation="vertical" size={2} style={{ display: 'flex' }}>
                        {canManage && !cancelled ? (
                          <Select<FactoryPayIntent>
                            size="small"
                            style={{ minWidth: 168 }}
                            value={intent}
                            loading={intentMut.isPending}
                            disabled={intentMut.isPending}
                            onChange={(v) => intentMut.mutate(v)}
                            options={(['CASH', 'BANK', 'UNKNOWN'] as FactoryPayIntent[]).map((v) => ({
                              value: v,
                              label: FACTORY_PAY_INTENT[v].label,
                            }))}
                          />
                        ) : (
                          <StatusChip meta={FACTORY_PAY_INTENT[intent]} />
                        )}
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {t(INTENT_CONSEQUENCE[intent])}
                        </Typography.Text>
                      </Space>
                    ),
                  },
                  {
                    key: 'created',
                    label: t('Yaratilgan'),
                    children: `${fmtDateTime(order.createdAt)}${order.createdBy?.name ? ` — ${order.createdBy.name}` : ''}`,
                  },
                  { key: 'note', label: t('Izoh'), children: order.note ?? '—' },
                ]}
              />
            </Section>

            <Section title="Pozitsiyalar">
              {isPhone ? (
                <PhoneCards<OrderItem>
                  rows={order.items ?? []}
                  rowKey={(r) => r.id}
                  card={itemCard}
                  empty={<Empty description={t("Pozitsiyalar yo'q")} />}
                />
              ) : (
                // R10: piksel poli faqat desktopda qoladi — planshetda `max-content`,
                // aks holda 900px poli jadvalning siqilishiga to'sqinlik qiladi
                <Table<OrderItem>
                  rowKey="id"
                  size="small"
                  columns={itemColumns}
                  dataSource={order.items ?? []}
                  pagination={false}
                  scroll={{ x: isDesktop ? 900 : 'max-content' }}
                />
              )}
            </Section>

            <Section bodyPad={0} style={{ padding: isPhone ? '4px 8px 8px' : '4px 16px 8px' }}>
              <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabs} />
            </Section>
          </Space>
        </Col>

        <Col xs={24} lg={8}>
          {/* R9: yopishqoq rail FAQAT lg+ da. Telefon/planshetda rail ustun to'liq
              kenglikda va viewportdan baland — sticky bo'lsa uning pastki yarmi
              umuman skroll qilinmay qolar edi.
              Rail endi uch blokli (moliya + transport + paddon dona) — desktopda ham
              viewportdan oshib ketishi mumkin, shuning uchun oshgan qismi railning
              O'ZIDA suriladi: aks holda «AVANSDAN YECHISH» ekran tagida qolib ketardi. */}
          <div
            className="dash-card"
            style={{
              padding: isPhone ? 14 : 18,
              ...(isDesktop
                ? {
                    position: 'sticky' as const,
                    top: TOPBAR_H + 16,
                    maxHeight: `calc(100vh - ${TOPBAR_H + 32}px)`,
                    overflowY: 'auto' as const,
                  }
                : null),
            }}
          >
            <div className="sb-overline" style={{ marginBottom: 8 }}>
              {t('Moliya')}
            </div>
            {/* Kelishilgan summa O'ZGARMAYDI — 22 000 000 shundayligicha turadi. Agar
                transportni mijoz shofyorga o'zi bersa, o'sha ulush shu yerda ochiq
                yozib qo'yiladi va pastdagi «Mijoz bizga qarz» aynan qolgani bo'ladi.
                Server ham xuddi shu raqamni beradi (clientOutstanding) — ekran o'zi
                hech narsani ayirmaydi. */}
            <SummaryRow
              label="Savdo summasi"
              value={<MoneyCell value={order.saleTotal} strong />}
              last={clientPaysDriver && directTransport > 0}
            />
            {clientPaysDriver && directTransport > 0 ? (
              <SummaryRow
                sub
                label="shundan transport (mijoz shofyorga)"
                value={<MoneyCell value={directTransport} />}
              />
            ) : null}
            {/* Savdo → qarz → to'landi bitta hisob zanjiri bo'lib o'qiladi. Mijoz puli
                serverda eng eski buyurtmadan boshlab o'zi taqsimlanadi. */}
            <SummaryRow
              label="Mijoz bizga qarz"
              value={
                clientOwes > 0 ? (
                  <MoneyCell value={order.clientOutstanding ?? 0} variant="owedToUs" strong />
                ) : (
                  <Space size={8}>
                    <MoneyCell value={0} />
                    <Tag color="green">{t('Yopildi')}</Tag>
                  </Space>
                )
              }
            />
            <SummaryRow label="Mijoz to'ladi" value={<MoneyCell value={order.clientPaid ?? 0} />} />
            {/* Zavod tomoni COVERAGE bo'yicha o'qiladi, costStatus bo'yicha emas: MIXED
                buyurtma FINAL bo'lsa ham ikkita bazada turadi. Bitta pul ikki xil nom
                bilan yozilmaydi — «to'landi» ulushlari haqiqiy tannarxning ICHIDAN
                chiqadi, «qolgani» esa qarz satrining ichidan. */}
            {covStarted ? (
              <>
                <SummaryRow
                  label="Zavod tannarxi (haqiqiy)"
                  value={
                    <Space size={8}>
                      <MoneyCell value={order.costTotal} strong />
                      <StatusChip meta={COST_STATUS[order.costStatus]} />
                    </Space>
                  }
                />
                {paidCash > 0 ? (
                  <SummaryRow sub label="naqd bilan to'landi" value={<MoneyCell value={cov?.paidCash ?? 0} />} />
                ) : null}
                {paidBank > 0 ? (
                  <SummaryRow sub label="o'tkazma bilan to'landi" value={<MoneyCell value={cov?.paidBank ?? 0} />} />
                ) : null}
                <SummaryRow
                  label="Tovar foydasi"
                  value={<MoneyCell value={goodsProfit} signed strong variant={profitVariant(goodsProfit)} />}
                />
                <FactoryDebtRow
                  order={order}
                  t={t}
                  canDraw={canDrawAdvance}
                  onDraw={openDraw}
                  isPhone={isPhone}
                >
                  {remainingSplit ? (
                    <>
                      <SummaryRow
                        sub
                        label="qolgani naqd bilan to'lansa"
                        value={<MoneyCell value={cov?.remainingCash ?? 0} />}
                      />
                      <SummaryRow
                        sub
                        last
                        label="qolgani o'tkazma bilan to'lansa"
                        value={<MoneyCell value={cov?.remainingBank ?? 0} />}
                      />
                    </>
                  ) : null}
                </FactoryDebtRow>
              </>
            ) : (
              <>
                {/* hech narsa yopilmagan — IKKALA nomzod ham ekranda qoladi, chunki
                    qaysi biri rost bo'lishini pul hal qiladi, bu buyurtma emas (R1) */}
                <SummaryRow
                  label="Zavod tannarxi — naqd"
                  value={
                    <Space size={8}>
                      <MoneyCell value={costCash} strong />
                      {intent === 'CASH' ? <Tag color="green">{t('reja')}</Tag> : null}
                    </Space>
                  }
                />
                <SummaryRow
                  label="Zavod tannarxi — o'tkazma"
                  value={
                    <Space size={8}>
                      <MoneyCell value={costBank} strong />
                      {intent === 'BANK' ? <Tag color="blue">{t('reja')}</Tag> : null}
                    </Space>
                  }
                />
                <SummaryRow
                  label="Tovar foydasi (naqd)"
                  value={<MoneyCell value={profitCash} signed variant={profitVariant(profitCash)} />}
                />
                <SummaryRow
                  label="Tovar foydasi (o'tkazma)"
                  value={<MoneyCell value={profitBank} signed variant={profitVariant(profitBank)} />}
                />
                <FactoryDebtRow order={order} t={t} canDraw={canDrawAdvance} onDraw={openDraw} isPhone={isPhone} />
              </>
            )}
            {/* PROFIT RULE: aniqlanmagan niyatli, hali yopilmagan buyurtma «Sof foyda»ga
                kirmaydi — dashboard uni «aniqlanmagan» blokida ko'rsatadi. */}
            {!covStarted && intent === 'UNKNOWN' ? (
              <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', paddingTop: 8 }}>
                {t(
                  "To'lov usuli aniqlanmagunicha foyda shu ikki chegara orasida — «Sof foyda»ga kirmaydi",
                )}
              </Typography.Text>
            ) : null}

            <div className="sb-overline" style={{ margin: '20px 0 8px' }}>
              {t('Transport')}
            </div>
            <SummaryRow label="Rejim" value={TRANSPORT_MODE_LABEL[order.transportMode]} />
            <SummaryRow
              label={order.transportMode === 'CLIENT_PAYS_DRIVER' ? 'Shofyorga (mijoz beradi)' : 'Shofyorga (diller beradi)'}
              value={<MoneyCell value={order.transportCost} />}
            />
            {/* «Dillerda qoladi» FAQAT diller pulni o'zi yig'ib, shofyorga o'zi to'laydigan
                rejimda ma'noli (22M ni oladi, 2M ni beradi). CLIENT_PAYS_DRIVER da u aynan
                «Mijoz bizga qarz» bilan teng bo'lardi — bitta pulni ikki xil nom bilan
                ko'rsatish egani chalg'itgan asosiy sabab edi, shuning uchun yashiriladi. */}
            {clientPaysDriver ? (
              <SummaryRow
                label="Diller shofyorga qarzdor emas"
                value={
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {t('summa mijoz qarzidan chiqarilgan')}
                  </Typography.Text>
                }
              />
            ) : (
              <SummaryRow label="Dillerda qoladi" value={<MoneyCell value={dealerKeeps} strong />} />
            )}
            {/* Legacy on-top billing — only ever non-zero on pre-2026-07-20 orders. */}
            {num(order.transportCharge) !== 0 && (
              <>
                <SummaryRow label="Mijozdan undirilgan (eski usul)" value={<MoneyCell value={order.transportCharge} />} />
                <SummaryRow
                  label="Transport foydasi"
                  value={<MoneyCell value={transportProfit} signed variant={profitVariant(transportProfit)} />}
                />
              </>
            )}
            <SummaryRow label="To'lov holati" last value={<StatusChip meta={TRANSPORT_PAID[order.transportPaidStatus]} />} />
            {/* Yagona TRANSPORT_DIRECT kiritish yo'li: bu yerda buyurtma ham, moshina ham,
                mijoz ham ma'lum — API esa taqsimotsiz bunday to'lovni qabul qilmaydi. */}
            {canManage && !cancelled && clientPaysDriver && directRemaining > 0 && order.vehicleId ? (
              <Button
                block
                style={{ marginTop: 12, minHeight: isPhone ? TOUCH_MIN : undefined }}
                onClick={() => setDirectOpen(true)}
              >
                {t("Shofyorga to'landi deb yozish")}
              </Button>
            ) : null}

            {/* R4: paddon FAQAT donada. Bu blokda bironta ham pul raqami yo'q — yagona
                omon qolgan pul eshigi mijozdagi «yo'qolgan paddonni hisobga o'tkazish»,
                u esa mijoz kartochkasida, bu yerda emas. */}
            {palletBalances.any ? (
              <>
                <div className="sb-overline" style={{ margin: '20px 0 8px' }}>
                  {t('Paddonlar (dona)')}
                </div>
                <SummaryRow
                  label="Mijozga berilgan"
                  value={<span className="num">{palletBalances.toClient}</span>}
                />
                <SummaryRow
                  label="Mijozdan qaytgan"
                  value={<span className="num">{palletBalances.backFromClient}</span>}
                />
                <SummaryRow label="Mijozda qolgan" value={<PalletChip pallets={palletBalances.atClient} />} />
                <SummaryRow
                  last
                  label="Zavodga qarzimiz (dona)"
                  value={<PalletChip pallets={palletBalances.owedToFactory} />}
                />
              </>
            ) : null}
          </div>
        </Col>
      </Row>

      <FormDrawer
        open={!!priceTarget}
        title={`${priceTarget && !priceTarget.pricePending ? t('Narxni tuzatish') : t('Narxlash')} — ${priceTarget?.product?.name ?? ''}`}
        submitText="Saqlash"
        cancelText="Yopish"
        submitting={priceMut.isPending}
        onClose={() => {
          setPriceTarget(null);
          setPriceValue(null);
        }}
        onSubmit={submitPrice}
      >
        <Space orientation="vertical" size={12} style={{ width: '100%' }}>
          {priceTarget && !priceTarget.pricePending && (
            <Alert
              type="warning"
              showIcon
              message={t("Joriy summa: {sum} so'm. Yangi summa bilan farqi mijoz balansiga tuzatma sifatida yoziladi (zavod tannarxi va bonusga tegilmaydi).", { sum: fmtMoney(priceTarget.saleTotal) })}
            />
          )}
          {priceTarget && (
            <Typography.Text type="secondary">{t('Hajm:')} {fmtM3(priceTarget.quantityM3)}</Typography.Text>
          )}
          <Radio.Group
            value={priceMode}
            onChange={(e) => {
              setPriceMode(e.target.value as 'perM3' | 'lump');
              setPriceValue(null);
            }}
            options={[
              { label: t("1 m³ narxi bo'yicha"), value: 'perM3' },
              { label: t('Umumiy summa (kelishilgan)'), value: 'lump' },
            ]}
          />
          <InputNumber<number>
            style={{ width: '100%' }}
            min={0}
            formatter={moneyFormatter}
            parser={moneyParser}
            value={priceValue}
            onChange={(v) => setPriceValue(v)}
            placeholder={priceMode === 'perM3' ? t("1 m³ uchun narx (so'm)") : t("Umumiy summa (so'm)")}
          />
        </Space>
      </FormDrawer>

      <FormDrawer
        open={editOpen}
        title={`${t('Tahrirlash')} — ${order.orderNo}`}
        submitText="Saqlash"
        cancelText="Yopish"
        submitting={adminMut.isPending}
        onClose={() => setEditOpen(false)}
        onSubmit={() =>
          adminMut.mutate({
            vehicleId: editVehicleId ?? null,
            driverName: editDriver.trim() || null,
            note: editNote.trim() || null,
          })
        }
      >
        <Space orientation="vertical" size={12} style={{ width: '100%' }}>
          <Alert
            type="info"
            showIcon
            message={t("Faqat moshina, haydovchi va izoh o'zgartiriladi. Moliyaviy ma'lumot (narx, hajm, summa, tannarx) o'zgarmaydi — logika buzilmaydi.")}
          />
          <div>
            <Typography.Text type="secondary">{t('Moshina')}</Typography.Text>
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              style={{ width: '100%', marginTop: 4 }}
              placeholder={t('Moshina tanlang')}
              loading={vehiclesQ.isFetching}
              value={editVehicleId}
              onChange={(v) => setEditVehicleId(v)}
              options={asItems(vehiclesQ.data).map((v) => ({
                value: v.id,
                label: `${v.name}${v.plate ? ` (${v.plate})` : ''}`,
              }))}
            />
          </div>
          <div>
            <Typography.Text type="secondary">{t('Haydovchi')}</Typography.Text>
            <Input
              style={{ marginTop: 4 }}
              maxLength={200}
              placeholder={t('Haydovchi ismi')}
              value={editDriver}
              onChange={(e) => setEditDriver(e.target.value)}
            />
          </div>
          <div>
            <Typography.Text type="secondary">{t('Izoh')}</Typography.Text>
            <Input.TextArea
              style={{ marginTop: 4 }}
              rows={2}
              maxLength={2000}
              placeholder={t('Izoh (ixtiyoriy)')}
              value={editNote}
              onChange={(e) => setEditNote(e.target.value)}
            />
          </div>
        </Space>
      </FormDrawer>

      <FormDrawer
        open={loadOpen}
        title={`${t('Haqiqiy yuk')} — ${order.orderNo}`}
        submitText="Saqlash"
        cancelText="Yopish"
        submitting={actualLoadMut.isPending}
        onClose={() => setLoadOpen(false)}
        onSubmit={submitActual}
      >
        <Space orientation="vertical" size={12} style={{ width: '100%' }}>
          <Alert
            type="info"
            showIcon
            message={t('Zavoddan chiqqan haqiqiy hajm (m³)')}
            description={t("Barcha balanslar (mijoz sotuvi va zavod tannarxi) shu hajmga moslashadi. Kelishilgan qat'iy summalar va transport (moshinaga) o'zgarmaydi. Narx bu yerda kiritilmaydi.")}
          />
          {/* telefonda nom va maydon ustma-ust — 320px da 160px input yonida
              mahsulot nomiga 100px dan kam joy qolar edi */}
          {(order.items ?? []).map((it) => (
            <div
              key={it.id}
              style={{
                display: 'flex',
                flexDirection: isPhone ? 'column' : 'row',
                alignItems: isPhone ? 'stretch' : 'center',
                gap: isPhone ? 6 : 12,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <Typography.Text ellipsis style={{ display: 'block' }}>
                  {it.product?.name ?? '—'}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {t('Rejadagi:')} {fmtM3(it.quantityM3)}
                  {it.pricePending ? ` · ${t('narxsiz')}` : ''}
                </Typography.Text>
              </div>
              <InputNumber<number>
                style={{ width: isPhone ? '100%' : 160 }}
                min={0}
                step={0.001}
                className="num"
                addonAfter="m³"
                value={actualDraft[it.id] ?? null}
                onChange={(v) => setActualDraft((d) => ({ ...d, [it.id]: v }))}
              />
            </div>
          ))}
        </Space>
      </FormDrawer>

      {/* «AVANSDAN YECHISH» — R2 ning yagona eshigi. Kanal tanlash pul o'tkazish emas:
          u shu ulushning tannarxi qaysi zavod narxida o'qilishini hal qiladi (R3), shu
          bois oqibat tanlov ostida ochiq yozilgan. */}
      <FormDrawer
        open={drawOpen}
        title={`${t('Avansdan yechish')} — ${order.orderNo}`}
        submitText="Yechish"
        cancelText="Yopish"
        submitting={drawMut.isPending}
        onClose={() => setDrawOpen(false)}
        onSubmit={submitDraw}
      >
        <Space orientation="vertical" size={12} style={{ width: '100%' }}>
          <div className="dash-card" style={{ padding: 12 }}>
            <SummaryRow
              label="Buyurtma qoldig'i"
              value={<MoneyCell value={order.factoryOutstanding ?? 0} variant="weOwe" strong />}
            />
            {/* ikkala kanal ham HAR DOIM ko'rinadi — bo'sh kanal ham javob: «u yerda pul yo'q» */}
            <SummaryRow
              label="Naqd avans"
              value={<MoneyCell value={order.factoryAdvance?.cash ?? 0} variant={advCash > 0 ? 'in' : 'neutral'} />}
            />
            <SummaryRow
              last
              label="O'tkazma avans"
              value={<MoneyCell value={order.factoryAdvance?.bank ?? 0} variant={advBank > 0 ? 'in' : 'neutral'} />}
            />
          </div>

          <div>
            <Typography.Text type="secondary">{t('Qaysi avansdan')}</Typography.Text>
            {/* PaymentComposer «Usul» tanlovi bilan bir xil idiom; telefonda block emas */}
            <div className={isPhone ? 'sb-scroll-x' : undefined} style={{ marginTop: 4 }}>
              <Segmented
                block={!isPhone}
                value={drawBucket}
                onChange={(v) => pickBucket(v as AdvanceBucket)}
                options={[
                  { value: 'ADVANCE_CASH', label: t('Naqd avans'), disabled: advCash <= 0 },
                  { value: 'ADVANCE_BANK', label: t("O'tkazma avans"), disabled: advBank <= 0 },
                ]}
              />
            </div>
            <Space size={8} align="start" style={{ marginTop: 6 }}>
              <StatusChip meta={PRICE_KIND[BUCKET_PRICE_KIND[drawBucket]]} />
              <Typography.Text type="warning" style={{ fontSize: 12 }}>
                {t(BUCKET_CONSEQUENCE[drawBucket])}
              </Typography.Text>
            </Space>
          </div>

          <div>
            <Typography.Text type="secondary">{t('Summa')}</Typography.Text>
            <div style={{ marginTop: 4 }}>
              {/* shift = min(kanal qoldig'i, buyurtmaning SHU BAZADAGI ehtiyoji) — R2:
                  yechilgan summa buyurtmadan kam bo'lishi mumkin, ko'p bo'lishi hech qachon */}
              <MoneyInput
                value={drawAmount}
                onChange={setDrawAmount}
                max={drawMax(drawBucket)}
                maxLabel={t("Shu kanaldan ko'pi bilan: {sum} so'm", { sum: fmtMoney(drawMax(drawBucket)) })}
              />
            </div>
          </div>
        </Space>
      </FormDrawer>

      {/* Bitta taqsimotni orqaga qaytarish. SettleDrawer «avval mavjud taqsimotni bekor
          qiling» deb turardi-yu, buni qiladigan joy yo'q edi — shu ko'cha berk edi (R5). */}
      <ReasonModal
        open={!!voidTarget}
        title={t('Taqsimotni bekor qilish')}
        confirmLabel="Bekor qilish"
        submitting={voidAllocMut.isPending}
        onClose={() => setVoidTarget(null)}
        onConfirm={async (reason) => {
          if (voidTarget) await voidAllocMut.mutateAsync({ alloc: voidTarget, reason });
        }}
        facts={
          voidTarget
            ? [
                {
                  text: t("{sum} so'm taqsimoti bekor qilinadi", { sum: fmtMoney(voidTarget.amount) }),
                  tone: 'danger',
                },
                voidTarget.fromAdvance
                  ? { text: t("Pul o'z avans kanaliga qaytadi"), tone: 'warning' }
                  : { text: t("To'lov taqsimlanmagan holatga qaytadi"), tone: 'warning' },
                { text: t('Buyurtma tannarxi qayta hisoblanadi'), tone: 'neutral' },
              ]
            : []
        }
      />

      {/* TRANSPORT_DIRECT — kassadan o'tmaydi, mijoz qarzini kamaytirmaydi (u allaqachon
          buyurtma yaratilganda chiqarilgan): faqat shofyor ulushini olganini qayd etadi. */}
      <PaymentComposer
        open={directOpen}
        onClose={() => setDirectOpen(false)}
        kind="TRANSPORT_DIRECT"
        lockParty
        presetOrder={{ id: order.id, orderNo: order.orderNo }}
        presetParty={{ id: order.vehicleId as string, type: 'vehicle', name: order.vehicle?.name }}
        presetClientId={order.clientId}
        presetClientName={order.client?.name}
        presetAmount={directRemaining}
      />

      {/* Bekor qilish — egasining savoli + shu buyurtmaning real pul xaritasi. */}
      {canManage && !cancelled ? (
        <CancelOrderModal
          open={cancelOpen}
          onClose={() => setCancelOpen(false)}
          order={order}
          directRecorded={directRecorded}
          submitting={cancelMut.isPending}
          onConfirm={confirmCancel}
        />
      ) : null}

      {isPhone ? <MobileActionBar actions={headerActions} /> : null}
    </div>
  );
}
