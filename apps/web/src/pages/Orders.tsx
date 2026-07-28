// Buyurtmalar — yagona RO'YXAT sahifasi (status doskasi olib tashlandi, 2026-07-22).
// Uch tab: barcha / to'langan / to'lanmagan (qisman to'langan ham «to'lanmagan»da).
import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Button, Segmented, Space, Tag, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { asItems, endpoints } from '../lib/api';
import { fmtDate, fmtM3, fmtNum, num } from '../lib/format';
import { PageHeader } from '../components/PageHeader';
import { useT } from '../components/LangContext';
import {
  DataTable,
  FilterBar,
  MoneyCell,
  OrderProductsCell,
  StatusChip,
  SummaryStrip,
  TableCard,
  type FilterField,
  type SbColumn,
  type SummaryFigure,
} from '../components';
import { useUrlFilters } from '../lib/useUrlFilters';
import { useIsPhone } from '../lib/responsive';
import { COST_STATUS, TRANSPORT_PAID } from '../lib/status-maps';
import type { Order } from '../lib/types';

/** the 3 payment tabs — partial-paid counts as «to'lanmagan» (server rule). */
const PAID_TABS = ['all', 'unpaid', 'paid'] as const;
type PaidTab = (typeof PAID_TABS)[number];

/**
 * Bekor qilingan buyurtma ro'yxatda QOLADI (egasi qarori, 2026-07-28) — u yo'qolib
 * ketsa «buyurtmam qani?» degan savol tug'iladi. Lekin uning RAQAMLARI qatordan
 * olib tashlanadi: savdo summasi va hajm o'rniga «—» chiziladi.
 *
 * Sabab: tepadagi «Filtr bo'yicha jami» endi bekor qilinganlarni sanamaydi. Agar
 * qatorda raqam turaversa, ustunni ko'zda qo'shgan odam yakundan KATTA son chiqarib
 * olardi va qaysi biri to'g'ri ekanini bilmasdi. Raqam yo'q bo'lsa — qo'shadigan
 * narsa ham yo'q. Buyurtmaning o'z kartochkasida summalar joyida turadi: u yerda
 * bu bitta hujjatning tarixi, yakun emas.
 */
const isDead = (r: Order): boolean => r.status === 'CANCELLED';
const Dash = () => <Typography.Text type="secondary">—</Typography.Text>;

export default function Orders() {
  const navigate = useNavigate();
  const t = useT();
  const isPhone = useIsPhone();
  const uf = useUrlFilters(['search', 'clientId', 'factoryId', 'dateFrom', 'dateTo', 'paid']);

  const search = uf.get('search') || undefined;
  const clientId = uf.get('clientId') || undefined;
  const factoryId = uf.get('factoryId') || undefined;
  const dateFrom = uf.get('dateFrom') || undefined;
  const dateTo = uf.get('dateTo') || undefined;
  const rawPaid = uf.get('paid');
  const paidTab: PaidTab = rawPaid === 'paid' || rawPaid === 'unpaid' ? rawPaid : 'all';

  const filters = useMemo(
    () => ({
      ...(search ? { search } : {}),
      ...(clientId ? { clientId } : {}),
      ...(factoryId ? { factoryId } : {}),
      ...(dateFrom ? { dateFrom } : {}),
      ...(dateTo ? { dateTo } : {}),
      ...(paidTab !== 'all' ? { paid: paidTab } : {}),
    }),
    [search, clientId, factoryId, dateFrom, dateTo, paidTab],
  );

  const clientsQ = useQuery({ queryKey: ['clients', 'select'], queryFn: () => endpoints.clients({ pageSize: 200 }) });
  const factoriesQ = useQuery({ queryKey: ['factories', 'select'], queryFn: () => endpoints.factories() });
  const clientOptions = (clientsQ.data?.items ?? []).map((c) => ({ label: c.name, value: c.id }));
  const factoryOptions = asItems(factoriesQ.data).map((f) => ({ label: f.name, value: f.id }));

  const filterSchema: FilterField[] = useMemo(
    () => [
      { key: 'clientId', label: 'Mijoz', type: 'select', options: clientOptions },
      { key: 'factoryId', label: 'Zavod', type: 'select', options: factoryOptions },
      { key: 'date', label: 'Sana', type: 'daterange', fromKey: 'dateFrom', toKey: 'dateTo' },
    ],
    [clientOptions, factoryOptions],
  );

  return (
    <div className="sb-page">
      <PageHeader
        title="Buyurtmalar"
        subtitle="Barcha buyurtmalar ro'yxati — filtr va qidiruv"
        accent
        actions={[
          { key: 'new', label: 'Yangi buyurtma', primary: true, icon: <PlusOutlined />, onClick: () => navigate('/orders/new') },
        ]}
      />
      {/* to'lov bo'yicha 3 tab: barcha / to'langan / to'lanmagan (qisman = to'lanmagan) */}
      <div className={isPhone ? 'sb-scroll-x' : undefined} style={{ marginBottom: 12 }}>
        <Segmented
          block={isPhone}
          value={paidTab}
          onChange={(v) => uf.set({ paid: v === 'all' ? null : String(v), page: null })}
          options={[
            { value: 'all', label: t('Barcha buyurtmalar') },
            { value: 'paid', label: t("To'langan") },
            { value: 'unpaid', label: t("To'lanmagan") },
          ]}
        />
      </div>
      {/* telefonda karta to'liq kenglikka chiqadi (design.css) — ichki padding ham
          shu zichlikka moslashadi, aks holda 320px da qidiruv maydoni siqiladi */}
      <div className="sb-table-card" style={{ padding: isPhone ? '10px 12px' : '12px 16px' }}>
        <FilterBar schema={filterSchema} searchPlaceholder={t('Buyurtma № yoki mijoz')} />
      </div>
      <TableView filters={filters} />
    </div>
  );
}

function TableView({ filters }: { filters: Record<string, string> }) {
  const navigate = useNavigate();
  const t = useT();
  const uf = useUrlFilters();
  const page = Number(uf.get('page')) || 1;
  const pageSize = Number(uf.get('pageSize')) || 20;
  const params = { page, pageSize, ...filters };

  const ordersQ = useQuery({
    queryKey: ['orders', 'list', params],
    queryFn: () => endpoints.orders(params),
    placeholderData: keepPreviousData,
  });

  // Yakun JADVAL TEPASIDA (egasining qoidasi, 2026-07-26) va u SERVERdan keladi —
  // butun filtr bo'yicha, ko'rinib turgan 20 qator bo'yicha emas. Shuning uchun
  // «keyingi sahifa» bosilganda raqamlar qimirlamaydi.
  //
  // HAMMA figura faqat BEKOR QILINMAGAN buyurtmalar bo'yicha (egasi qoidasi,
  // 2026-07-28). Ilgari bu yerda «Shundan bekor qilingan» degan pul figurasi bor edi
  // — u «Savdo summasi» ichida bekor qilinganlar ham borligini tan olib turardi.
  // Endi ular umuman kirmaydi, shuning uchun tan oladigan narsa ham qolmadi.
  const s = (ordersQ.data as { summary?: OrdersSummary } | undefined)?.summary;
  const figures: SummaryFigure[] = s
    ? [
        { key: 'sales', label: 'Savdo summasi', value: s.sales, strong: true },
        ...(s.cost != null
          ? ([
              { key: 'cost', label: 'Tannarx', value: s.cost },
              { key: 'net', label: 'Sof foyda', value: s.netProfit ?? 0, variant: 'in', strong: true },
            ] as SummaryFigure[])
          : []),
        { key: 'm3', label: 'Hajmi', value: s.cubeM3, variant: 'count', suffix: 'm³' },
      ]
    : [];

  // `mobile:` — telefonda karta ro'yxati uchun slot xaritasi (spec §2.2.1). Desktop
  // ustunlar massivi aks holda o'zgarmaydi: raqam = sarlavha, savdo summasi = yagona
  // pul figurasi, qolgan uchtasi chip qatorida. Belgilanmagan ustunlar (agent, zavod,
  // moshina, tannarx, transport) telefonda kartaga tushmaydi — ular buyurtma ichida.
  const columns: SbColumn<Order>[] = [
    // Bekor qilingan buyurtma raqamning YONIDA belgilanadi (egasi talabi, 2026-07-26).
    // Status doskasi 2026-07-22 da olib tashlangach ro'yxatda bekor qilinganini bildiradigan
    // hech narsa qolmagan edi: savdo summasi va mijoz nomi bilan u tirik buyurtmadek
    // o'qilardi, faqat ichiga kirgandagina bilinardi.
    {
      title: 'Buyurtma', key: 'orderNo', width: 168, mobile: 'title',
      render: (_, r) => (
        <Space size={6}>
          <Link
            to={`/orders/${r.id}`}
            className="sb-cell-link"
            onClick={(e) => e.stopPropagation()}
            style={r.status === 'CANCELLED' ? { textDecoration: 'line-through', opacity: 0.7 } : undefined}
          >
            {r.orderNo}
          </Link>
          {r.status === 'CANCELLED' ? <Tag color="red">{t('Bekor')}</Tag> : null}
        </Space>
      ),
    },
    { title: 'Sana', key: 'date', width: 110, mobile: 'meta', mobileOrder: 1, render: (_, r) => fmtDate(r.date) },
    { title: 'Mijoz', key: 'client', ellipsis: true, mobile: 'subtitle', render: (_, r) => r.client?.name ?? '—' },
    // Buyurtmada NIMA sotilgani (egasi so'rovi, 2026-07-28) — ikkalasi ham serverdan
    // tayyor figura. «Hajm» HAQIQIY hajm.
    { title: 'Mahsulot', key: 'products', width: 200, mobile: 'meta', mobileOrder: 2, render: (_, r) => <OrderProductsCell products={r.products} /> },
    { title: 'Hajm', key: 'cubeM3', width: 110, align: 'right', className: 'num', mobile: 'meta', mobileLabel: 'Hajm', mobileOrder: 3, render: (_, r) => (isDead(r) ? <Dash /> : r.cubeM3 == null ? '—' : fmtM3(r.cubeM3)) },
    { title: 'Agent', key: 'agent', ellipsis: true, render: (_, r) => r.agent?.name ?? '—' },
    { title: 'Zavod', key: 'factory', ellipsis: true, render: (_, r) => r.factory?.name ?? '—' },
    { title: 'Moshina', key: 'vehicle', ellipsis: true, render: (_, r) => r.vehicle?.plate || r.vehicle?.name || '—' },
    { title: 'Savdo summasi', key: 'saleTotal', width: 160, align: 'right', className: 'num', mobile: 'value', render: (_, r) => (isDead(r) ? <Dash /> : <MoneyCell value={r.saleTotal} />) },
    // Red only while something is actually open — a settled order reads as a calm dash,
    // so a scan down the column shows exactly which orders still carry money.
    {
      title: 'Mijoz qarzi', key: 'clientOutstanding', width: 160, align: 'right', className: 'num',
      mobile: 'meta', mobileLabel: 'Mijoz qarzi', mobileOrder: 4,
      render: (_, r) =>
        num(r.clientOutstanding) > 0 ? (
          <MoneyCell value={r.clientOutstanding ?? 0} variant="owedToUs" strong />
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    { title: 'Tannarx', key: 'costStatus', width: 132, render: (_, r) => <StatusChip meta={COST_STATUS[r.costStatus]} /> },
    { title: 'Transport', key: 'transportPaidStatus', width: 132, render: (_, r) => <StatusChip meta={TRANSPORT_PAID[r.transportPaidStatus]} /> },
  ];

  return (
    <>
      <SummaryStrip
        // bo'sh natijada nollar qatorini ko'rsatmaymiz — jadval o'zi «topilmadi» deydi.
        // Faqat bekor qilinganlar topilgan filtrda strip QOLADI: aks holda jadvalda
        // qatorlar turib, tepasi jimgina yo'q bo'lardi — o'qigan odam yakun yuklanmadi
        // deb o'ylardi. U holda strip halol nol ko'rsatadi va izoh sababini aytadi.
        hidden={!s || (s.orders === 0 && s.cancelledOrders === 0)}
        figures={figures}
        scopeLabel={t('Filtr bo‘yicha jami')}
        note={
          s ? (
            <>
              {t('{count} ta buyurtma', { count: fmtNum(s.orders) })}
              {/* Bu izoh MAJBURIY: jadval bekor qilingan qatorlarni ham ko'rsatadi,
                  tepadagi hech bir raqam esa ularni sanamaydi. Izohsiz «20 qator
                  ko'rinib turibdi, jamida 18 ta deb yozilgan» degan savol tug'ilardi. */}
              {s.cancelledOrders > 0
                ? ` · ${t('{count} ta bekor qilingan (hisobga olinmagan)', { count: fmtNum(s.cancelledOrders) })}`
                : ''}
            </>
          ) : null
        }
      />
      <TableCard title={t("Buyurtmalar ro'yxati")} loading={ordersQ.isFetching}>
        <DataTable<Order>
          rowKey="id"
          columns={columns}
          query={ordersQ}
          onRowOpen={(r) => navigate(`/orders/${r.id}`)}
          emptyText="Buyurtma topilmadi"
          scroll={{ x: 'max-content' }}
        />
      </TableCard>
    </>
  );
}

/**
 * `GET /orders` javobidagi filtrga bog'langan yakun (orders.service.listSummary).
 * HAMMA raqam faqat bekor qilinmagan buyurtmalar bo'yicha.
 */
interface OrdersSummary {
  /** bekor qilinmagan buyurtmalar SONI (jadvaldagi qatorlar sonidan kam bo'lishi mumkin) */
  orders: number;
  sales: string;
  /** faqat izoh qatori uchun SON — bu yerdan hech qachon pul figurasi chiqmaydi */
  cancelledOrders: number;
  cubeM3: string;
  /** AGENT uchun kelmaydi — nol ko'rsatish «foyda yo'q» degan yolg'on bo'lardi */
  cost?: string;
  goodsProfit?: string;
  transportProfit?: string;
  netProfit?: string;
}
