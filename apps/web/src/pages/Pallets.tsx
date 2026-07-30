import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Alert,
  App,
  Button,
  Col,
  DatePicker,
  Dropdown,
  Form,
  Input,
  InputNumber,
  Pagination,
  Row,
  Select,
  Skeleton,
  Space,
  Table,
  theme,
  Typography,
} from 'antd';
import type { TableProps } from 'antd';
import {
  ExportOutlined,
  ImportOutlined,
  MoreOutlined,
  RightOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import dayjs, { type Dayjs } from 'dayjs';
import { apiError, endpoints } from '../lib/api';
import { fmtDate, fmtNum, fmtUZS } from '../lib/format';
import {
  DataTable,
  EmptyState,
  EMPTY_PALLET_STATS,
  FALLBACK_LOST_PALLET_PRICE,
  FormDrawer,
  MoneyCell,
  PalletChip,
  palletBreakdown,
  PalletStatsPanel,
  StatusChip,
  TableCard,
  type SbColumn,
} from '../components';
import { PALLET_TX } from '../lib/status-maps';
import { PageHeader } from '../components/PageHeader';
import { useIsDesktop, useIsPhone } from '../lib/responsive';
import { can } from '../lib/permissions';
import { useAuth } from '../auth/AuthContext';
import { useUrlFilters } from '../lib/useUrlFilters';
import { useT } from '../components/LangContext';
import type {
  FactoryBalanceRow,
  Paged,
  PalletBalanceRow,
  PalletOverview,
  PalletPartyStats,
} from '../lib/types';

interface PalletTxRow {
  id: string;
  type: string;
  qty: number;
  date: string;
  unitPrice?: string | null;
  note?: string | null;
  client?: { id: string; name: string } | null;
  factory?: { id: string; name: string } | null;
  order?: { id: string; orderNo: string } | null;
}

interface ClientReturnVals {
  clientId: string;
  qty: number;
  date: Dayjs;
  note?: string;
}

/** Zavodga qaytarish PULSIZ — faqat son. Shu sababli bu yerda `unitPrice` yo'q. */
interface FactoryReturnVals {
  factoryId: string;
  qty: number;
  date: Dayjs;
  note?: string;
}

interface ChargeLostVals {
  clientId: string;
  qty: number;
  date: Dayjs;
  unitPrice: number;
  note?: string;
}

const moneyFormatter = (v: string | number | undefined) => `${v ?? ''}`.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const moneyParser = (v: string | undefined) => Number((v ?? '').replace(/\s/g, ''));

function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const t = useT();
  return (
    <Alert
      type="error"
      showIcon
      message={t("Ma'lumotni yuklab bo'lmadi")}
      description={apiError(error)}
      action={
        <Button size="small" danger onClick={onRetry}>
          {t('Qayta urinish')}
        </Button>
      }
    />
  );
}

/**
 * Tasmadagi yakka figura — «Diller qo'lida» va «Yo'qotilgan (undirilgan)».
 * Ataylab StatCard EMAS: StatCard qiymatni MoneyCell orqali chizadi, ya'ni paddon
 * SONI pul rangida ko'rinardi — 04 §2.9 aynan shuni taqiqlaydi (paddon naturada,
 * hech qachon pul emas). Chrome PalletStatsPanel bilan bir xil, shuning uchun
 * tasma yaxlit bitta blok bo'lib o'qiladi.
 */
function TotalTile({ label, value }: { label: string; value: number }) {
  const { token } = theme.useToken();
  const t = useT();
  const isPhone = useIsPhone();
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: isPhone ? 14 : 16,
        borderRadius: token.borderRadiusLG,
        border: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgContainer,
      }}
    >
      <span
        style={{
          fontSize: 11,
          lineHeight: '16px',
          fontWeight: 600,
          letterSpacing: '0.04em',
          color: token.colorTextTertiary,
        }}
      >
        {t(label)}
      </span>
      <span
        className="num"
        style={{
          fontSize: 22,
          fontWeight: 700,
          lineHeight: 1.2,
          whiteSpace: 'nowrap',
          color: token.colorText,
        }}
      >
        {fmtNum(value)}
        <span style={{ fontSize: 11, fontWeight: 500, color: token.colorTextTertiary, marginLeft: 4 }}>
          {t('dona')}
        </span>
      </span>
    </div>
  );
}

/**
 * Sahifa tepasidagi yalpi tasma (egasi so'rovi, 2026-07-25): shu paytgacha
 * Paddonlar sahifasi faqat NETTO qoldiqni ko'rsatardi — «zavoddan jami qancha
 * oldik / qanchasini qaytardik» hech qayerda yo'q edi. Ikki tomon ham AYNAN bitta
 * PalletStatsPanel bilan chiziladi, ya'ni zavod va mijoz tomoni bir xil o'qiladi.
 *
 * ALL-TIME: bu tasmada sana oynasi YO'Q va qo'shilmaydi.
 * `totals.drift` (yarashuv nazorati) sim orqali keladi — egasi banner istamadi,
 * shuning uchun u HECH QAYERDA chizilmaydi.
 */
function PalletTotalsStrip({ totals, showFactory }: { totals: PalletOverview; showFactory: boolean }) {
  // Overview bo'laklari — `Pick`, ya'ni to'liq PalletPartyStats emas. Nol obyekt
  // yagona manbadan (EMPTY_PALLET_STATS) olinadi: har bir sirt o'zinikini yasasa,
  // raqamlar shu joyda jimgina ajralib ketardi.
  const factory: PalletPartyStats = { ...EMPTY_PALLET_STATS, ...totals.factory };
  const client: PalletPartyStats = { ...EMPTY_PALLET_STATS, ...totals.client };

  // «Yo'qotilgan (undirilgan)» ATAYLAB bu yerda ALOHIDA plitka emas: u mijoz
  // tenglamasining bir hadi va PalletStatsPanel uni nolga teng bo'lmaganda reykaning
  // ICHIDA, aynan ayirma joyida chizadi. Uni yana bir bor yonma-yon qo'yish o'sha
  // raqamni ikki marta ko'rsatib, o'quvchini ularni qo'shishga undardi.
  const tiles: ReactNode[] = [];
  if (showFactory) {
    tiles.push(<TotalTile key="dealer" label="Diller qo'lida" value={totals.dealerInHand} />);
  }

  // AGENT zavod tomonini ham, diller qoldig'ini ham ko'rmaydi — o'shanda tasma
  // 2 (yoki 1) ustunga qulaydi, bo'sh joy qolmaydi.
  const cols = (showFactory ? 1 : 0) + 1 + (tiles.length > 0 ? 1 : 0);
  const span = 24 / cols;

  return (
    <Row gutter={[16, 16]} align="stretch">
      {showFactory ? (
        <Col xs={24} lg={cols === 1 ? 24 : 12} xxl={span}>
          <PalletStatsPanel
            stats={factory}
            side="factory"
            title="Zavodlar oldidagi hisobdorlik"
            style={{ height: '100%' }}
          />
        </Col>
      ) : null}
      <Col xs={24} lg={cols === 1 ? 24 : 12} xxl={span}>
        <PalletStatsPanel stats={client} side="client" title="Mijozlardagi paddonlar" style={{ height: '100%' }} />
      </Col>
      {tiles.length > 0 ? (
        // uchtala ustun bo'lganda `lg` da bu ustun ikkinchi qatorga tushadi —
        // yarim kenglikda emas, TO'LIQ kenglikda, aks holda o'ng yarmi bo'sh qolardi
        <Col xs={24} lg={cols === 2 ? 12 : 24} xxl={span}>
          <div className="sb-stat-strip">{tiles}</div>
        </Col>
      ) : null}
    </Row>
  );
}

/**
 * «Eng ko'p paddon ushlab turganlar» — top 5, qoldig'i musbat bo'lganlar.
 * Bu reyting yangi so'rov EMAS: balanslar allaqachon yuklangan, faqat saralanadi.
 * Har qator mijoz kartochkasiga eshik, chunki ro'yxatning yagona maqsadi —
 * «kimga qo'ng'iroq qilaman» degan savolga javob berish.
 */
function TopHoldersCard({ rows }: { rows: PalletBalanceRow[] }) {
  const { token } = theme.useToken();
  const t = useT();
  return (
    <TableCard title={t("Eng ko'p paddon ushlab turganlar")} bodyPadding={12} style={{ height: '100%' }}>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rows.map((r, i) => (
          <li key={r.client.id} style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <span
              aria-hidden
              className="num"
              style={{
                flex: '0 0 auto',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 20,
                height: 20,
                borderRadius: 6,
                background: token.colorFillTertiary,
                color: token.colorTextSecondary,
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              {i + 1}
            </span>
            <div style={{ flex: '1 1 auto', minWidth: 0 }}>
              <Link
                to={`/clients/${r.client.id}`}
                style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              >
                {r.client.name}
              </Link>
              {/* hech qachon qaytarmaganlar aynan shu ro'yxatning boshida turadi —
                  o'sha holat sanadan ko'ra muhimroq, shuning uchun ogohlantirish rangida */}
              <div
                style={{
                  fontSize: 11,
                  lineHeight: '16px',
                  color: r.stats.lastReturnAt ? token.colorTextTertiary : token.colorWarning,
                }}
              >
                {r.stats.lastReturnAt ? (
                  <>
                    {t('Oxirgi qaytargan')}: <span className="num">{fmtDate(r.stats.lastReturnAt)}</span>
                  </>
                ) : (
                  t('Hech qachon qaytarmagan')
                )}
              </div>
            </div>
            <PalletChip pallets={r.balance} compact popoverContent={palletBreakdown(r.stats, 'client')} />
          </li>
        ))}
      </ol>
    </TableCard>
  );
}

/** Telefondagi balans kartalari uchun sahifa hajmi — desktopdagi jadval
 *  paginatsiyasi bilan bir xil (15 qator). */
const BAL_PAGE_SIZE = 15;

/**
 * MOBIL (spec §2.2): telefonda mijoz paddon balanslari jadval emas, teginishga
 * mo'ljallangan kartalar ro'yxati bo'lib chiqadi — 320px da 3 ustunli jadval
 * (ism + balans + 300px amal ustuni) o'qib bo'lmaydigan darajada siqiladi.
 * Desktop (>= 992px) o'sha <Table> ni ko'radi: bu komponent faqat `useIsPhone()`
 * ortida render bo'ladi.
 */
function ClientBalanceCards({
  rows,
  loading,
  canReturn,
  canCharge,
  onAccept,
  onCharge,
}: {
  rows: PalletBalanceRow[];
  loading: boolean;
  /** «Qaytarish qabul qilish» — A·B·G (agent o'z mijozi uchun) */
  canReturn: boolean;
  /** «Undirish» — pul yozadi, faqat A·B */
  canCharge: boolean;
  onAccept: (clientId: string) => void;
  onCharge: (clientId: string) => void;
}) {
  const t = useT();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);

  const pageCount = Math.max(1, Math.ceil(rows.length / BAL_PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const slice = rows.slice((current - 1) * BAL_PAGE_SIZE, current * BAL_PAGE_SIZE);

  // keng jadval → tor karta "sakrashi" nuqson: skelet ham karta shaklida (§2.2.3)
  if (loading && rows.length === 0) {
    return (
      <ul className="sb-mcards">
        {Array.from({ length: 6 }, (_, i) => (
          <li key={i} className="sb-mcard sb-mcard--skeleton">
            <div className="sb-mcard__body">
              <div className="sb-mcard__row">
                <div className="sb-mcard__head">
                  <Skeleton.Button active size="small" block style={{ height: 14 }} />
                </div>
                <Skeleton.Button active size="small" style={{ height: 14, width: 84 }} />
              </div>
            </div>
          </li>
        ))}
      </ul>
    );
  }

  if (rows.length === 0) return <EmptyState message="Hozircha yozuv yo'q" />;

  const open = (clientId: string) => navigate(`/clients/${clientId}`);

  return (
    <div>
      <ul className="sb-mcards">
        {slice.map((r) => (
          <li
            key={r.client.id}
            className="sb-mcard sb-mcard--tappable"
            role="button"
            tabIndex={0}
            onClick={(e) => {
              if ((e.target as HTMLElement).closest('a,button,.ant-dropdown-trigger')) return;
              open(r.client.id);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                open(r.client.id);
              }
            }}
          >
            <div className="sb-mcard__body">
              <div className="sb-mcard__row">
                <div className="sb-mcard__head">
                  <div className="sb-mcard__title">{r.client.name}</div>
                  {/* Telefonda desktopdagi yangi ustunlar sig'maydi, lekin
                      «bergan − qaytargan» ayirmasi bo'lmasa o'ngdagi qoldiq
                      qayerdan kelgani noma'lum qoladi — shuning uchun ular bitta
                      subtitle satrida (' · ' ajratgichini CSS o'zi qo'yadi).
                      Satrga FAQAT tenglama hadlari kiradi: sana to'rtinchi bo'lak
                      sifatida qo'shilsa, u shunchaki uzunlikni oshiradi — sana va
                      qolgan hammasi o'ngdagi chip popoverida to'liq turibdi.
                      «Yo'qotilgan» esa nolga teng bo'lmasa CHIQISHI SHART — aks
                      holda karta 19 − 9 = 8 deb yolg'on gapiradi. Shu sababli
                      `--equation` modifikatori: 2 qatorlik qirqim aynan oxirgi hadni
                      yeb qo'yardi. */}
                  <div className="sb-mcard__subtitle sb-mcard__subtitle--equation">
                    <span>
                      {t('Jami olingan')}: <span className="num">{fmtNum(r.stats.received)}</span>
                    </span>
                    <span>
                      {t('Qaytargan')}: <span className="num">{fmtNum(r.stats.returned)}</span>
                    </span>
                    {r.stats.chargedLost !== 0 ? (
                      // qisqa shakl: bu satr 2 qatorga qirqiladi, uzun shakl uchinchi
                      // bo'lakni chegaradan chiqarardi
                      <span>
                        {t("Yo'qotilgan")}: <span className="num">{fmtNum(r.stats.chargedLost)}</span>
                      </span>
                    ) : null}
                    {r.stats.adjustment !== 0 ? (
                      <span>
                        {t('Tuzatish')}: <span className="num">{fmtNum(r.stats.adjustment)}</span>
                      </span>
                    ) : null}
                  </div>
                </div>
                {/* chip popover ochadi, karta esa mijoz kartochkasiga o'tadi —
                    <span> `closest('a,button')` filtriga tushmaydi, shuning uchun
                    tegish shu yerda to'xtatiladi, aks holda bitta teginish
                    ikkalasini ham qo'zg'atardi */}
                <div className="sb-mcard__value" onClick={(e) => e.stopPropagation()}>
                  <PalletChip pallets={r.balance} popoverContent={palletBreakdown(r.stats, 'client')} />
                </div>
              </div>
            </div>
            {/* amallar kartaning ichki satrida emas, kebab ichida (§2.2.4) */}
            <div className="sb-mcard__tail">
              {canReturn || canCharge ? (
                <Dropdown
                  trigger={['click']}
                  menu={{
                    // Kebab ichida ham rol bo'yicha kesiladi: agentga faqat qaytarib
                    // olish qoladi, aks holda u bosib 403 olardi.
                    items: [
                      ...(canReturn
                        ? [{ key: 'accept', label: t('Qaytarish qabul qilish'), icon: <ImportOutlined /> }]
                        : []),
                      ...(canCharge
                        ? [{ key: 'charge', label: t('Undirish'), icon: <WarningOutlined />, danger: true }]
                        : []),
                    ],
                    onClick: ({ key, domEvent }) => {
                      domEvent.stopPropagation();
                      if (key === 'accept') onAccept(r.client.id);
                      else onCharge(r.client.id);
                    },
                  }}
                >
                  <Button
                    type="text"
                    icon={<MoreOutlined />}
                    aria-label={t('Amallar')}
                    onClick={(e) => e.stopPropagation()}
                  />
                </Dropdown>
              ) : null}
              <RightOutlined className="sb-mcard__chevron" aria-hidden />
            </div>
          </li>
        ))}
      </ul>
      {rows.length > BAL_PAGE_SIZE ? (
        <div className="sb-mcards__pager">
          <Pagination
            simple
            size="small"
            current={current}
            pageSize={BAL_PAGE_SIZE}
            total={rows.length}
            showSizeChanger={false}
            onChange={(p) => setPage(p)}
          />
        </div>
      ) : null}
    </div>
  );
}

/** MOBIL: zavod hisobdorligi — telefonda kartalar (ro'yxat qisqa, paginatsiyasiz). */
function FactoryBalanceCards({
  rows,
  canMutate,
  onReturn,
}: {
  rows: FactoryBalanceRow[];
  canMutate: boolean;
  onReturn: (factoryId: string) => void;
}) {
  const t = useT();
  return (
    <ul className="sb-mcards">
      {rows.map((r) => (
        <li key={r.factory.id} className="sb-mcard">
          <div className="sb-mcard__body">
            <div className="sb-mcard__row">
              <div className="sb-mcard__head">
                <div className="sb-mcard__title">{r.factory.name}</div>
                <div className="sb-mcard__subtitle sb-mcard__subtitle--equation">
                  <span>
                    {t('Jami olingan')}: <span className="num">{fmtNum(r.stats.received)}</span>
                  </span>
                  {/* jadvaldagi bilan bir xil sabab: «Qaytargan» bu yerda zavodni ega
                      qilib qo'yardi — bu esa BIZ qaytargan dona */}
                  <span>
                    {t('Zavodga qaytarilgan')}: <span className="num">{fmtNum(r.stats.returned)}</span>
                  </span>
                </div>
              </div>
              <div className="sb-mcard__value">
                <PalletChip pallets={r.balance} popoverContent={palletBreakdown(r.stats, 'factory')} />
              </div>
            </div>
            {canMutate ? (
              <div className="sb-mcard__actions">
                <Button size="small" icon={<ExportOutlined />} onClick={() => onReturn(r.factory.id)}>
                  {t('Zavodga qaytarish')}
                </Button>
              </div>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function Pallets() {
  const { message } = App.useApp();
  const t = useT();
  const qc = useQueryClient();
  const { hasRole, user } = useAuth();
  // Zavod tomoni va PUL yozadigan «undirish» — faqat ADMIN/BUXGALTER.
  const canMutate = hasRole('ADMIN', 'ACCOUNTANT');
  // Mijozdan qaytarib olishni AGENT ham yozadi (egasi qoidasi, 2026-07-30). Bu sahifada
  // agent faqat O'Z mijozlarini ko'radi (server qamrovi), shuning uchun tugmani mijoz
  // kartochkasida ko'rsatib, bu yerda yashirish — bir amalning ikki xil ko'rinishi bo'lardi.
  const canClientReturn = can(user?.role, 'pallets.clientReturn');
  // MOBIL: telefonda balans jadvallari karta ro'yxatiga, filtrlar esa to'liq
  // kenglikdagi ustunga aylanadi. Desktop (>= 992px) hech nima o'zgarmaydi.
  const isPhone = useIsPhone();
  const isDesktop = useIsDesktop();

  // list state
  const [clientSearch, setClientSearch] = useState('');
  const uf = useUrlFilters(['clientId', 'factoryId']);
  const txClientId = uf.get('clientId') || undefined;
  const txFactoryId = uf.get('factoryId') || undefined;
  const page = Number(uf.get('page')) || 1;
  const pageSize = Number(uf.get('pageSize')) || 20;

  // modals
  const [clientOpen, setClientOpen] = useState(false);
  const [factoryOpen, setFactoryOpen] = useState(false);
  const [lostOpen, setLostOpen] = useState(false);
  const [clientPrefill, setClientPrefill] = useState<string | undefined>();
  const [factoryPrefill, setFactoryPrefill] = useState<string | undefined>();
  const [clientForm] = Form.useForm<ClientReturnVals>();
  const [factoryForm] = Form.useForm<FactoryReturnVals>();
  const [lostForm] = Form.useForm<ChargeLostVals>();

  // «Yo'qolgan paddon narxi» — Sozlamalardagi `palletPriceDefault`, qo'lda yozilgan
  // 130 000 emas. Server undirishda AYNAN shu sozlamani o'qiydi (pallets.service
  // `defaultLostPalletPrice`), demak egasi narxni o'zgartirsa forma ham o'sha raqamni
  // ko'rsatishi shart — aks holda ekranda bir narx, daftarda boshqasi turardi.
  const settingsQ = useQuery({
    queryKey: ['settings'],
    queryFn: () => endpoints.settings(),
    enabled: canMutate,
    staleTime: 5 * 60_000,
  });
  const settingPrice = Number(settingsQ.data?.palletPriceDefault);
  const lostPriceDefault =
    Number.isFinite(settingPrice) && settingPrice > 0 ? settingPrice : FALLBACK_LOST_PALLET_PRICE;

  useEffect(() => {
    if (clientOpen) {
      clientForm.resetFields();
      clientForm.setFieldsValue({ date: dayjs(), clientId: clientPrefill });
    }
  }, [clientOpen, clientForm, clientPrefill]);

  useEffect(() => {
    if (factoryOpen) {
      factoryForm.resetFields();
      factoryForm.setFieldsValue({ date: dayjs(), factoryId: factoryPrefill });
    }
  }, [factoryOpen, factoryForm, factoryPrefill]);

  useEffect(() => {
    if (lostOpen) {
      lostForm.resetFields();
      lostForm.setFieldsValue({ date: dayjs(), unitPrice: lostPriceDefault, clientId: clientPrefill });
    }
    // `lostPriceDefault` deps ichida: sozlama varaq ochilgandan keyin kelsa ham maydon
    // to'g'ri narxga o'tadi (aks holda zaxira 130 000 muzlab qolardi).
  }, [lostOpen, lostForm, clientPrefill, lostPriceDefault]);

  const balQ = useQuery({ queryKey: ['pallets', 'balances'], queryFn: () => endpoints.palletBalances() });

  const txParams = { page, pageSize, clientId: txClientId, factoryId: txFactoryId };
  const txQ = useQuery({
    queryKey: ['pallets', 'transactions', txParams],
    queryFn: () => endpoints.palletTransactions(txParams) as Promise<Paged<PalletTxRow>>,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['pallets'] });
    qc.invalidateQueries({ queryKey: ['clients'] });
    // agent kartochkasi ham paddon figuralarini ko'rsatadi (`palletExposure`, mijoz
    // qatorlaridagi qoldiq) — mijoz kartochkasidagi varaq bu kalitni yangilaydi, bu
    // sahifa esa yangilamasdi: bitta amal ikki sirtda ikki xil raqam qoldirardi.
    qc.invalidateQueries({ queryKey: ['agents'] });
    qc.invalidateQueries({ queryKey: ['factories'] });
    qc.invalidateQueries({ queryKey: ['debts'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const clientReturnMut = useMutation({
    mutationFn: (d: object) => endpoints.palletClientReturn(d),
    onSuccess: () => {
      message.success(t('Paddon qaytarilishi qabul qilindi'));
      invalidate();
      setClientOpen(false);
    },
    onError: (e) => message.error(apiError(e)),
  });

  const factoryReturnMut = useMutation({
    mutationFn: (d: object) => endpoints.palletFactoryReturn(d),
    onSuccess: () => {
      message.success(t('Paddonlar zavodga qaytarildi'));
      invalidate();
      setFactoryOpen(false);
    },
    onError: (e) => message.error(apiError(e)),
  });

  const chargeLostMut = useMutation({
    mutationFn: (d: object) => endpoints.palletChargeLost(d),
    onSuccess: () => {
      message.success(t("Yo'qotilgan paddonlar mijozdan undirildi (qarz yozildi)"));
      invalidate();
      setLostOpen(false);
    },
    onError: (e) => message.error(apiError(e)),
  });

  const clients = balQ.data?.clients ?? [];
  const factories = balQ.data?.factories ?? [];
  const filteredClients = clientSearch
    ? clients.filter((r) => r.client.name.toLowerCase().includes(clientSearch.toLowerCase()))
    : clients;

  const clientOptions = clients.map((r) => ({
    value: r.client.id,
    label: t('{name} (balans: {bal})', { name: r.client.name, bal: r.balance }),
  }));
  const factoryOptions = factories.map((r) => ({
    value: r.factory.id,
    label: t('{name} (hisobdorlik: {bal})', { name: r.factory.name, bal: r.balance }),
  }));

  const dealerInHand = balQ.data?.dealerInHand ?? 0;
  const clientBalById = useMemo(() => new Map(clients.map((r) => [r.client.id, r.balance])), [clients]);
  const factoryBalById = useMemo(() => new Map(factories.map((r) => [r.factory.id, r.balance])), [factories]);

  // AGENT ekanini `factories.length` bo'yicha aniqlash MUMKIN EMAS: server nofaol va
  // hisobi yopiq zavodni ADMINga ham yubormaydi, ya'ni hamma zavodi nofaol diller zavod
  // panelini VA «Diller qo'lida» plitkasini yo'qotardi — aynan zavodga qaytarish
  // limitini belgilaydigan zaxirani, aynan qaytarish qilinadigan sahifada. `dealerInHand`
  // esa faqat ADMIN/ACCOUNTANT javobida bo'ladi (AGENTda kalitning o'zi yo'q).
  const showFactory = balQ.data?.dealerInHand !== undefined;
  const totals = balQ.data?.totals;

  // «Eng ko'p paddon ushlab turganlar» — allaqachon yuklangan balanslardan.
  // `.filter()` yangi massiv qaytaradi, ya'ni `.sort()` query keshini buzmaydi.
  const topHolders = useMemo(
    () =>
      clients
        .filter((r) => r.balance > 0)
        .sort((a, b) => b.balance - a.balance)
        .slice(0, 5),
    [clients],
  );

  // computed money preview — ONLY for «yo'qotilganini undirish» (mijoz qarzi). Zavodga
  // qaytarishda pul umuman qatnashmaydi, shuning uchun u yerda hech qanday summa yo'q.
  const clQty = Form.useWatch('qty', lostForm);
  const clPrice = Form.useWatch('unitPrice', lostForm);
  const clTotal = (Number(clQty) || 0) * (Number(clPrice) || 0);

  // per-party caps for the return/charge forms (mirror the server-side limits)
  const crClientId = Form.useWatch('clientId', clientForm);
  const crMax = crClientId ? clientBalById.get(crClientId) ?? 0 : undefined;
  const clClientId = Form.useWatch('clientId', lostForm);
  const clMax = clClientId ? clientBalById.get(clClientId) ?? 0 : undefined;
  const frFactoryId = Form.useWatch('factoryId', factoryForm);
  const frFactoryBal = frFactoryId ? factoryBalById.get(frFactoryId) ?? 0 : undefined;
  const frMax = frFactoryId ? Math.max(0, Math.min(dealerInHand, frFactoryBal ?? 0)) : undefined;

  // AGENTda faqat bitta tugma bo'ladi (undirish — pul amali, unga yopiq) ⇒ ustun ham
  // torayadi, aks holda jadval o'zi yaratgan bo'sh joyni gorizontal skroll qilardi.
  const anyRowAction = canClientReturn || canMutate;
  const actionColWidth = canMutate ? 300 : 200;
  const balanceActionCol: NonNullable<TableProps<PalletBalanceRow>['columns']>[number] = {
    title: '',
    key: 'actions',
    width: actionColWidth,
    render: (_: unknown, r: PalletBalanceRow) => (
      <Space size={4} wrap>
        {canClientReturn ? (
          <Button
            size="small"
            icon={<ImportOutlined />}
            onClick={() => {
              setClientPrefill(r.client.id);
              setClientOpen(true);
            }}
          >
            {t('Qaytarish qabul qilish')}
          </Button>
        ) : null}
        {canMutate ? (
          <Button
            size="small"
            danger
            icon={<WarningOutlined />}
            onClick={() => {
              setClientPrefill(r.client.id);
              setLostOpen(true);
            }}
          >
            {t('Undirish')}
          </Button>
        ) : null}
      </Space>
    ),
  };

  // Ustunlar ATAYLAB ayirma tartibida: olingan − qaytargan = qoldi. Egasi shu
  // paytgacha faqat oxirgi raqamni ko'rardi va «bu qayerdan chiqdi?» degan savolga
  // jadval javob bermasdi. Sonlar SOF (bekor qilingan buyurtma paddoni «jami
  // olingan» ni shishirmaydi) — netto serverda hisoblanadi.
  //
  // Ayirmaning QOLGAN hadlari ham shu qatorda bo'lishi SHART. Sahifaning o'z
  // «Undirish» tugmasi bosilgan mijozda tenglama 12 − 6 = 4 ko'rinishida chiqadi
  // (yo'qotilgan 2 ko'rinmaydi) — o'quvchi 6 ni kutadi va jadval unga yolg'on
  // gapiradi. Shuning uchun «Yo'qotilgan» va «Tuzatish» ustunlari — xuddi
  // PalletStatsPanel reykasidagi qoida bo'yicha — JADVALDA hech bo'lmasa bitta
  // qator uchun nolga teng bo'lmaganda paydo bo'ladi va aks holda umuman chizilmaydi.
  const anyLost = useMemo(() => filteredClients.some((r) => r.stats.chargedLost !== 0), [filteredClients]);
  const anyClientAdj = useMemo(() => filteredClients.some((r) => r.stats.adjustment !== 0), [filteredClients]);

  const balanceColumns: TableProps<PalletBalanceRow>['columns'] = [
    {
      title: t('Mijoz'),
      key: 'client',
      ellipsis: true,
      width: 220,
      render: (_, r) => <Link to={`/clients/${r.client.id}`}>{r.client.name}</Link>,
    },
    {
      title: t('Jami olingan'),
      key: 'received',
      align: 'right',
      width: 120,
      render: (_, r) => <Typography.Text className="num">{fmtNum(r.stats.received)}</Typography.Text>,
    },
    {
      title: t('Qaytargan'),
      key: 'returned',
      align: 'right',
      width: 120,
      render: (_, r) => <Typography.Text className="num">{fmtNum(r.stats.returned)}</Typography.Text>,
    },
    ...(anyLost
      ? [
          {
            // Jadval sarlavhasida QISQA shakl: to'liq «Yo'qotilgan (undirilgan)» 130px
            // ga sig'may «…(UNDIRILGA» bo'lib kesilardi. Uzun shakl paneldа va chip
            // popoverida to'liq turibdi — «Jami olingan» / «Zavoddan jami olingan»
            // juftligidagi bilan bir xil qoida.
            title: t("Yo'qotilgan"),
            key: 'chargedLost',
            align: 'right' as const,
            width: 130,
            render: (_: unknown, r: PalletBalanceRow) => (
              <Typography.Text className="num" type={r.stats.chargedLost ? 'danger' : undefined}>
                {fmtNum(r.stats.chargedLost)}
              </Typography.Text>
            ),
          },
        ]
      : []),
    ...(anyClientAdj
      ? [
          {
            title: t('Tuzatish'),
            key: 'adjustment',
            align: 'right' as const,
            width: 110,
            render: (_: unknown, r: PalletBalanceRow) => (
              <Typography.Text className="num" type="secondary">
                {fmtNum(r.stats.adjustment)}
              </Typography.Text>
            ),
          },
        ]
      : []),
    {
      // panel, popover va ustun bitta figurani AYNAN bitta so'z bilan ataydi —
      // «Qoldi» yana bitta sinonim bo'lib, chip ochilganda ikki xil nom ko'rinardi
      title: t('Hozir mijozda'),
      dataIndex: 'balance',
      align: 'right',
      width: 150,
      // chip = bitta teginishda to'liq tarix (yo'qotilgan, tuzatish, sanalar) —
      // jadvalga sig'magan hadlar popoverda ko'rinadi
      render: (v: number, r) => (
        <PalletChip pallets={v} compact popoverContent={palletBreakdown(r.stats, 'client')} />
      ),
    },
    {
      title: t('Oxirgi harakat'),
      key: 'lastMovementAt',
      align: 'right',
      width: 130,
      render: (_, r) => <Typography.Text className="num">{fmtDate(r.stats.lastMovementAt)}</Typography.Text>,
    },
    ...(anyRowAction ? [balanceActionCol] : []),
  ];

  const factoryActionCol: NonNullable<TableProps<FactoryBalanceRow>['columns']>[number] = {
    title: '',
    key: 'actions',
    width: 170,
    render: (_: unknown, r: FactoryBalanceRow) => (
      <Button
        size="small"
        icon={<ExportOutlined />}
        onClick={() => {
          setFactoryPrefill(r.factory.id);
          setFactoryOpen(true);
        }}
      >
        {t('Zavodga qaytarish')}
      </Button>
    ),
  };

  // Mijoz jadvalidagi bilan bir xil ayirma tartibi. Oxirgi ustunning nomi endi
  // «Paddon» emas: uchta figura yonma-yon turganda «Hozir qarzmiz» aynan qaysi
  // raqam hisobdorlik ekanini aytadi.
  const factoryColumns: TableProps<FactoryBalanceRow>['columns'] = [
    { title: t('Zavod'), key: 'factory', ellipsis: true, width: 160, render: (_, r) => r.factory.name },
    {
      title: t('Jami olingan'),
      key: 'received',
      align: 'right',
      width: 110,
      render: (_, r) => <Typography.Text className="num">{fmtNum(r.stats.received)}</Typography.Text>,
    },
    {
      // Bu yerda «Qaytargan» BO'LMAYDI: o'zbekchada uning egasi qator sohibi, ya'ni
      // «zavod qaytardi» bo'lib o'qiladi — holbuki bu BIZ zavodga qaytargan dona.
      // Mijoz jadvalida «Qaytargan» to'g'ri (u yerda haqiqatan mijoz qaytaradi).
      // Yalpi «Qaytarilgan» ham yaramaydi — o'sha kalit lug'atda kassa stornosi
      // (ru «Сторнировано»). Panel bilan bitta so'z: «Zavodga qaytarilgan».
      title: t('Zavodga qaytarilgan'),
      key: 'returned',
      align: 'right',
      width: 130,
      render: (_, r) => <Typography.Text className="num">{fmtNum(r.stats.returned)}</Typography.Text>,
    },
    {
      title: t('Hozir qarzmiz'),
      dataIndex: 'balance',
      align: 'right',
      width: 130,
      render: (v: number, r) => (
        <PalletChip pallets={v} compact popoverContent={palletBreakdown(r.stats, 'factory')} />
      ),
    },
    ...(canMutate ? [factoryActionCol] : []),
  ];

  const txColumns: SbColumn<PalletTxRow>[] = [
    { title: 'Sana', dataIndex: 'date', width: 110, render: (v: string) => fmtDate(v) },
    {
      title: 'Turi',
      dataIndex: 'type',
      // eng uzun yorliq — «Pulga o'tkazildi (yo'qolgan)» — 170px ga sig'may, chip
      // qo'shni «Mijoz» ustunining ustiga chiqib ketardi (StatusChip qirqilmaydi)
      width: 215,
      render: (v: string) => {
        const meta = PALLET_TX[v as keyof typeof PALLET_TX];
        return meta ? <StatusChip meta={meta} /> : <span>{v}</span>;
      },
    },
    {
      title: 'Mijoz',
      key: 'client',
      ellipsis: true,
      width: 180,
      render: (_, r) => (r.client ? <Link to={`/clients/${r.client.id}`}>{r.client.name}</Link> : '—'),
    },
    { title: 'Zavod', key: 'factory', ellipsis: true, width: 150, render: (_, r) => r.factory?.name ?? '—' },
    {
      title: 'Soni',
      dataIndex: 'qty',
      align: 'right',
      width: 90,
      render: (v: number) => <Typography.Text className="num">{fmtNum(v)}</Typography.Text>,
    },
    {
      title: 'Narx (dona)',
      dataIndex: 'unitPrice',
      align: 'right',
      width: 130,
      render: (v: string | null) => (v ? <MoneyCell value={v} suffix="so'm" /> : '—'),
    },
    {
      title: 'Buyurtma',
      key: 'order',
      width: 130,
      render: (_, r) => (r.order ? <Link to={`/orders/${r.order.id}`}>{r.order.orderNo}</Link> : '—'),
    },
    { title: 'Izoh', dataIndex: 'note', ellipsis: true, render: (v: string | null) => v || '—' },
  ];

  // Harakatlar filtrlari: desktopda o'sha <Space wrap> qatori, telefonda esa
  // `.sb-filterbar` — mobil qatlam uning BEVOSITA bolalarini 100% ga majburlaydi.
  const txFilterControls: ReactNode[] = [
    <Select
      key="client"
      allowClear
      placeholder={t("Mijoz bo'yicha")}
      style={isPhone ? { width: '100%', minWidth: 0 } : { minWidth: 220 }}
      options={clients.map((r) => ({ value: r.client.id, label: r.client.name }))}
      value={txClientId}
      onChange={(v) => uf.set({ clientId: v || null })}
      showSearch
      optionFilterProp="label"
    />,
    factories.length > 0 ? (
      <Select
        key="factory"
        allowClear
        placeholder={t("Zavod bo'yicha")}
        style={isPhone ? { width: '100%', minWidth: 0 } : { minWidth: 200 }}
        options={factories.map((r) => ({ value: r.factory.id, label: r.factory.name }))}
        value={txFactoryId}
        onChange={(v) => uf.set({ factoryId: v || null })}
        showSearch
        optionFilterProp="label"
      />
    ) : null,
  ];

  return (
    <Space orientation="vertical" size={16} style={{ display: 'flex' }}>
      <PageHeader
        title="Paddonlar"
        subtitle="Paddon hisobi — mijoz va zavod balanslari hamda harakatlar tarixi"
        accent
        actions={[
          ...(canClientReturn
            ? [
                {
                  key: 'client-return',
                  label: 'Qaytarish qabul qilish',
                  primary: true,
                  icon: <ImportOutlined />,
                  onClick: () => {
                    setClientPrefill(undefined);
                    setClientOpen(true);
                  },
                },
              ]
            : []),
          ...(canMutate
            ? [
                {
                  key: 'factory-return',
                  label: 'Zavodga qaytarish',
                  icon: <ExportOutlined />,
                  onClick: () => {
                    setFactoryPrefill(undefined);
                    setFactoryOpen(true);
                  },
                },
                {
                  key: 'charge-lost',
                  label: "Yo'qotilganini undirish",
                  danger: true,
                  icon: <WarningOutlined />,
                  onClick: () => {
                    setClientPrefill(undefined);
                    setLostOpen(true);
                  },
                },
              ]
            : []),
        ]}
      />

      {/* Yalpi manzara jadvallardan OLDIN: sahifaga kirgan odam avval «jami qancha
          oldik / qaytardik / qancha qoldi» ni ko'radi, keyin kim bo'yicha bo'linishini. */}
      {totals ? <PalletTotalsStrip totals={totals} showFactory={showFactory} /> : null}

      {/* Mijozlar jadvali endi TO'LIQ kenglikda: unga uchta yangi ustun qo'shildi
          (olingan · qaytargan · oxirgi harakat) va eski 15/9 bo'linishida ular
          gorizontal skrollga tushib ketardi — ayirmani ko'rish uchun surish kerak
          bo'lsa, ayirmani ko'rsatishdan ma'no qolmaydi. */}
      <TableCard
        title={t('Mijozlardagi paddonlar')}
        loading={balQ.isFetching}
        extra={
          <Input.Search
            allowClear
            placeholder={t('Mijoz qidirish')}
            style={{ width: isPhone ? '100%' : 200 }}
            onSearch={(v) => setClientSearch(v)}
            onChange={(e) => {
              if (!e.target.value) setClientSearch('');
            }}
          />
        }
      >
        {balQ.isError ? (
          <LoadError error={balQ.error} onRetry={() => balQ.refetch()} />
        ) : isPhone ? (
          <ClientBalanceCards
            rows={filteredClients}
            loading={balQ.isPending}
            canReturn={canClientReturn}
            canCharge={canMutate}
            onAccept={(id) => {
              setClientPrefill(id);
              setClientOpen(true);
            }}
            onCharge={(id) => {
              setClientPrefill(id);
              setLostOpen(true);
            }}
          />
        ) : (
          <Table<PalletBalanceRow>
            rowKey={(r) => r.client.id}
            size="small"
            columns={balanceColumns}
            dataSource={filteredClients}
            loading={balQ.isFetching}
            // amal ustuni yo'q bo'lganda (AGENT) 300px ni ham talab qilmaymiz —
            // aks holda jadval o'zi yaratgan bo'shliqni skroll qilar edi.
            // Shartli ustunlar kengligi ham qo'shiladi, aks holda ular paydo bo'lganda
            // jadval o'z chegarasidan tashqariga siqilardi.
            scroll={
              isDesktop
                ? {
                    x:
                      740 +
                      (anyRowAction ? actionColWidth : 0) +
                      (anyLost ? 130 : 0) +
                      (anyClientAdj ? 110 : 0),
                  }
                : { x: 'max-content' }
            }
            pagination={{ pageSize: BAL_PAGE_SIZE, showSizeChanger: false }}
          />
        )}
      </TableCard>

      {showFactory || topHolders.length > 0 ? (
        <Row gutter={[16, 16]} align="stretch">
          {showFactory && (
            <Col xs={24} lg={topHolders.length > 0 ? 14 : 24}>
              <TableCard
                style={{ height: '100%' }}
                title={t('Zavodlar oldidagi hisobdorlik')}
                loading={balQ.isFetching}
                extra={
                  <Space size={6} align="center" wrap>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {t("Diller qo'lida")}
                    </Typography.Text>
                    <PalletChip pallets={dealerInHand} compact />
                  </Space>
                }
              >
                {isPhone ? (
                  <FactoryBalanceCards
                    rows={factories}
                    canMutate={canMutate}
                    onReturn={(id) => {
                      setFactoryPrefill(id);
                      setFactoryOpen(true);
                    }}
                  />
                ) : (
                  <Table<FactoryBalanceRow>
                    rowKey={(r) => r.factory.id}
                    size="small"
                    dataSource={factories}
                    loading={balQ.isFetching}
                    pagination={false}
                    columns={factoryColumns}
                    scroll={isDesktop ? { x: canMutate ? 680 : 510 } : { x: 'max-content' }}
                  />
                )}
              </TableCard>
            </Col>
          )}
          {/* hech kimda paddon bo'lmasa reyting umuman chizilmaydi — bo'sh «top 5» yolg'on */}
          {topHolders.length > 0 ? (
            <Col xs={24} lg={showFactory ? 10 : 12}>
              <TopHoldersCard rows={topHolders} />
            </Col>
          ) : null}
        </Row>
      ) : null}

      <TableCard
        title={t('Paddon harakatlari')}
        loading={txQ.isFetching}
        toolbar={
          isPhone ? (
            <div className="sb-filterbar">{txFilterControls}</div>
          ) : (
            <Space wrap>{txFilterControls}</Space>
          )
        }
      >
        <DataTable<PalletTxRow>
          rowKey="id"
          columns={txColumns}
          query={txQ}
          emptyText="Hozircha paddon harakati yo'q"
          scroll={isDesktop ? { x: 1045 } : { x: 'max-content' }}
          // MOBIL: telefonda 8 ustunli jadval o'rniga karta — tomon (mijoz/zavod)
          // sarlavha, soni yagona figura, qolgani chip va label/qiymat satrlarida.
          mobileCard={(r) => {
            const meta = PALLET_TX[r.type as keyof typeof PALLET_TX];
            const lines: { label: string; value: ReactNode }[] = [];
            if (r.unitPrice) {
              lines.push({ label: 'Narx (dona)', value: <MoneyCell value={r.unitPrice} suffix="so'm" /> });
            }
            if (r.note) lines.push({ label: 'Izoh', value: r.note });
            return {
              title: r.client?.name ?? r.factory?.name ?? (meta ? meta.label : r.type),
              // ikkala tomon ham bo'lsa, zavod nomi sarlavha ostida ko'rinadi
              subtitle: r.client && r.factory ? r.factory.name : undefined,
              value: (
                <Typography.Text className="num" strong>
                  {fmtNum(r.qty)}
                </Typography.Text>
              ),
              meta: (
                <>
                  {meta ? <StatusChip meta={meta} /> : null}
                  <span className="sb-mcard__chip">{fmtDate(r.date)}</span>
                  {r.order ? (
                    <Link className="sb-mcard__chip" to={`/orders/${r.order.id}`}>
                      {r.order.orderNo}
                    </Link>
                  ) : null}
                </>
              ),
              lines,
            };
          }}
        />
      </TableCard>

      {/* client return */}
      <FormDrawer
        title={t('Mijozdan paddon qabul qilish')}
        open={clientOpen}
        onClose={() => setClientOpen(false)}
        onSubmit={() => clientForm.submit()}
        submitText="Saqlash"
        cancelText="Bekor qilish"
        submitting={clientReturnMut.isPending}
      >
        <Form
          form={clientForm}
          layout="vertical"
          onFinish={(v: ClientReturnVals) =>
            clientReturnMut.mutate({
              clientId: v.clientId,
              qty: v.qty,
              date: v.date.format('YYYY-MM-DD'),
              note: v.note?.trim() ? v.note.trim() : undefined,
            })
          }
        >
          <Form.Item name="clientId" label={t('Mijoz')} rules={[{ required: true, message: t('Mijozni tanlang') }]}>
            <Select placeholder={t('Mijozni tanlang')} options={clientOptions} showSearch optionFilterProp="label" />
          </Form.Item>
          <Form.Item
            name="qty"
            dependencies={['clientId']}
            label={t('Soni (dona)')}
            extra={crMax != null ? t('Mijozda mavjud: {n} dona', { n: crMax }) : undefined}
            rules={[
              { required: true, message: t('Sonini kiriting') },
              () => ({
                validator: (_, value) =>
                  crMax != null && Number(value) > crMax
                    ? Promise.reject(new Error(t('Mijozda faqat {n} dona paddon bor', { n: crMax })))
                    : Promise.resolve(),
              }),
            ]}
          >
            <InputNumber min={1} max={crMax} precision={0} style={{ width: '100%' }} placeholder="0" />
          </Form.Item>
          <Form.Item name="date" label={t('Sana')} rules={[{ required: true, message: t('Sanani tanlang') }]}>
            <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
          </Form.Item>
          <Form.Item name="note" label={t('Izoh')}>
            <Input.TextArea rows={2} placeholder={t('Izoh (ixtiyoriy)')} />
          </Form.Item>
        </Form>
      </FormDrawer>

      {/* factory return */}
      <FormDrawer
        title={t('Zavodga paddon qaytarish')}
        open={factoryOpen}
        onClose={() => setFactoryOpen(false)}
        onSubmit={() => factoryForm.submit()}
        submitText="Saqlash"
        cancelText="Bekor qilish"
        submitting={factoryReturnMut.isPending}
      >
        <Form
          form={factoryForm}
          layout="vertical"
          onFinish={(v: FactoryReturnVals) =>
            factoryReturnMut.mutate({
              factoryId: v.factoryId,
              qty: v.qty,
              date: v.date.format('YYYY-MM-DD'),
              note: v.note?.trim() ? v.note.trim() : undefined,
            })
          }
        >
          <Form.Item name="factoryId" label={t('Zavod')} rules={[{ required: true, message: t('Zavodni tanlang') }]}>
            <Select placeholder={t('Zavodni tanlang')} options={factoryOptions} showSearch optionFilterProp="label" />
          </Form.Item>
          <Form.Item
            name="qty"
            dependencies={['factoryId']}
            label={t('Soni (dona)')}
            extra={
              frMax != null
                ? t("Maksimum: {cap} dona (qo'lda {hand}, zavod oldida {owed})", {
                    cap: frMax,
                    hand: dealerInHand,
                    owed: frFactoryBal ?? 0,
                  })
                : undefined
            }
            rules={[
              { required: true, message: t('Sonini kiriting') },
              () => ({
                validator: (_, value) =>
                  frMax != null && Number(value) > frMax
                    ? Promise.reject(new Error(t("Ko'pi bilan {cap} dona qaytarish mumkin", { cap: frMax })))
                    : Promise.resolve(),
              }),
            ]}
          >
            <InputNumber min={1} max={frMax} precision={0} style={{ width: '100%' }} placeholder="0" />
          </Form.Item>
          <Form.Item name="date" label={t('Sana')} rules={[{ required: true, message: t('Sanani tanlang') }]}>
            <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
          </Form.Item>
          {/* Paddon zavod tomonida naturada: qaytarish faqat SONNI yopadi, pul harakati yo'q. */}
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message={t("Pul harakati yo'q — faqat paddon soni hisoblanadi")}
            description={t('Zavod paddon uchun pul bermaydi: qaytarish faqat hisobdorlik sonini kamaytiradi.')}
          />
          <Form.Item name="note" label={t('Izoh')}>
            <Input.TextArea rows={2} placeholder={t('Izoh (ixtiyoriy)')} />
          </Form.Item>
        </Form>
      </FormDrawer>

      {/* charge lost */}
      <FormDrawer
        title={t("Yo'qotilgan paddonlarni undirish")}
        open={lostOpen}
        onClose={() => setLostOpen(false)}
        onSubmit={() => lostForm.submit()}
        submitText="Undirish"
        danger
        cancelText="Bekor qilish"
        submitting={chargeLostMut.isPending}
      >
        <Form
          form={lostForm}
          layout="vertical"
          onFinish={(v: ChargeLostVals) =>
            chargeLostMut.mutate({
              clientId: v.clientId,
              qty: v.qty,
              date: v.date.format('YYYY-MM-DD'),
              unitPrice: v.unitPrice,
              note: v.note?.trim() ? v.note.trim() : undefined,
            })
          }
        >
          <Form.Item name="clientId" label={t('Mijoz')} rules={[{ required: true, message: t('Mijozni tanlang') }]}>
            <Select placeholder={t('Mijozni tanlang')} options={clientOptions} showSearch optionFilterProp="label" />
          </Form.Item>
          <Form.Item
            name="qty"
            dependencies={['clientId']}
            label={t('Soni (dona)')}
            extra={clMax != null ? t('Mijozda mavjud: {n} dona', { n: clMax }) : undefined}
            rules={[
              { required: true, message: t('Sonini kiriting') },
              () => ({
                validator: (_, value) =>
                  clMax != null && Number(value) > clMax
                    ? Promise.reject(new Error(t('Mijozda faqat {n} dona paddon bor', { n: clMax })))
                    : Promise.resolve(),
              }),
            ]}
          >
            <InputNumber min={1} max={clMax} precision={0} style={{ width: '100%' }} placeholder="0" />
          </Form.Item>
          <Form.Item
            name="unitPrice"
            label={t("Dona narxi (so'm)")}
            rules={[{ required: true, message: t('Narxni kiriting') }]}
          >
            <InputNumber min={0} style={{ width: '100%' }} formatter={moneyFormatter} parser={moneyParser} />
          </Form.Item>
          <Form.Item name="date" label={t('Sana')} rules={[{ required: true, message: t('Sanani tanlang') }]}>
            <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
          </Form.Item>
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message={t('Diqqat: bu amaliyot mijozga pul qarzi yozadi')}
            description={clTotal > 0 ? t("Mijoz qarziga {sum} qo'shiladi.", { sum: fmtUZS(clTotal) }) : undefined}
          />
          <Form.Item name="note" label={t('Izoh')}>
            <Input.TextArea rows={2} placeholder={t('Izoh (ixtiyoriy)')} />
          </Form.Item>
        </Form>
      </FormDrawer>
    </Space>
  );
}
