// pages/FactoryReport.tsx — «Zavod bo'yicha hisobot».
//
// Egasining savoli, uning o'z so'zlari bilan: «shu zavoddan shu davrda nima oldim,
// qaysi mahsulotdan qancha kub, qaysi narxda qanchasi, jami qancha summa — va shundan
// qanchasini naqd, qanchasini o'tkazma to'ladim, qancha qarzim, qancha avansim qoldi».
//
// ── Ikkita «naqd» bor va ular BIR XIL EMAS ──
// 1) TO'LOV USULI — pul kassaning qaysi tomonidan chiqqani (naqd kassa / bank).
// 2) NARXNOMA KANALI — mol qaysi narx kitobida yopilgani (naqd narx / o'tkazma narx).
// Bank o'tkazmasi naqd narxnomali buyurtmani yopishi mumkin, shuning uchun ikkala
// yig'indi teng chiqmasligi NORMAL. Ular ATAYLAB ikki alohida blokda turadi va har
// birining tagida nima o'lchayotgani yozilgan — bitta raqamga qo'shilsa yolg'on bo'lardi.
//
// ── Raqamlar bu yerda HISOBLANMAYDI ──
// Pul sim orqali satr bo'lib keladi va shundayligicha ko'rsatiladi. Har bir yakun,
// jumladan buyurtmalar jadvalining «jami» si ham, serverdan tayyor holda keladi:
// sahifadagi qatorlardan yig'ilgan yakun sahifa almashishi bilan o'zgarib ketardi.
import { useMemo } from 'react';
import { App, Button, Table, Tag, Tooltip, Typography, theme } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  DataTable,
  DateRangeControl,
  EmptyState,
  ErrorState,
  MoneyCell,
  PageHeader,
  PartySelect,
  StatusChip,
  SummaryStrip,
  TableCard,
  type SbColumn,
} from '../components';
import { useT } from '../components/LangContext';
import { blobError, endpoints } from '../lib/api';
import { fmtDate, fmtM3, fmtMoney, fmtNum, num } from '../lib/format';
// Status yorliqlari ATAYLAB status-maps'dan: ular getter bo'lib, joriy tilga o'zi
// o'giriladi. lib/format dagi nusxalari eskirgan, tarjimasiz variantlar.
import { COST_STATUS, FACTORY_PAY_INTENT, PAYMENT_METHOD, STATUS } from '../lib/status-maps';
import { useIsPhone } from '../lib/responsive';
import { useUrlFilters } from '../lib/useUrlFilters';
import type {
  FactoryBucketsWire,
  FactoryReport as Report,
  FactoryReportOrderRow,
  FactoryReportProduct,
  ReportPriceBucket,
} from '../lib/types';

const FILTER_KEYS = ['factoryId', 'from', 'to'] as const;

const FAMILY_LABEL: Record<'CASH' | 'BANK' | 'BONUS', string> = {
  CASH: 'naqd',
  BANK: "o'tkazma",
  BONUS: 'bonusdan',
};

/** Bitta raqam: yorliq + qiymat + ixtiyoriy tushuntirish. Pul MoneyCell bilan chiqadi. */
function Figure({
  label,
  value,
  hint,
  hintParams,
  variant = 'neutral',
  suffix,
  strong,
  raw,
}: {
  label: string;
  value: string | number | null | undefined;
  /**
   * t() KALITI — qat'iy matn bo'lishi shart. O'zgaruvchi qiymatlar `hintParams` orqali
   * beriladi ({n} kabi o'rinbosarlar bilan): shablonli satr kalit sifatida uzatilsa
   * lug'atda hech qachon topilmasdi va izoh ru/en da o'zbekcha qolib ketardi.
   */
  hint?: string;
  hintParams?: Record<string, string | number>;
  variant?: 'neutral' | 'in' | 'weOwe' | 'owedToUs';
  suffix?: string;
  strong?: boolean;
  /** pul emas — tayyor matn (m³, dona, sana). MoneyCell butun songa yaxlitlab yubormasin. */
  raw?: string;
}) {
  const { token } = theme.useToken();
  const t = useT();
  return (
    <div style={{ minWidth: 0 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: token.colorTextTertiary,
          marginBottom: 2,
        }}
      >
        {t(label)}
      </div>
      {raw !== undefined ? (
        <div style={{ fontSize: strong ? 20 : 16, fontWeight: strong ? 700 : 500 }}>{raw}</div>
      ) : (
        <MoneyCell
          value={value ?? 0}
          variant={variant}
          strong={strong}
          suffix={suffix ?? t("so'm")}
          style={{ fontSize: strong ? 20 : 16 }}
        />
      )}
      {hint ? (
        <div style={{ fontSize: 11, color: token.colorTextTertiary, marginTop: 2, maxWidth: 280 }}>
          {t(hint, hintParams)}
        </div>
      ) : null}
    </div>
  );
}

/** Bir mavzuli raqamlar guruhi. */
function Block({
  title,
  note,
  children,
  extra,
}: {
  title: string;
  note?: string;
  extra?: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = useT();
  const isPhone = useIsPhone();
  return (
    <TableCard title={t(title)} extra={extra} bodyPadding={isPhone ? 12 : 16}>
      <div style={{ display: 'flex', gap: isPhone ? 14 : 32, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {children}
      </div>
      {note ? (
        <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 12 }}>
          {t(note)}
        </Typography.Text>
      ) : null}
    </TableCard>
  );
}

/**
 * Qarz/avans ustuni — «davr oxiriga» va «bugungi holat» uchun bir xil shakl.
 *
 * Ranglar uy qoidasi bo'yicha (design.css): avans — `in` (yashil, «kirim / avans»),
 * bizning qarzimiz — `weOwe` (sariq). `owedToUs` (qizil) BU YERDA ISHLATILMAYDI:
 * u «mijoz bizga qarz» rangi, va avansga qo'yilsa zavodda turgan o'z pulimiz
 * ekranda yo'qotishdek ko'rinardi.
 */
function BalanceColumn({ b, offBook }: { b: FactoryBucketsWire; offBook: string }) {
  const owed = num(b.payable) < 0 ? -num(b.payable) : 0;
  const adv = (v: string) => (num(v) > 0 ? ('in' as const) : ('neutral' as const));
  return (
    <>
      <Figure label="Zavodga qarzimiz" value={owed} variant={owed > 0 ? 'weOwe' : 'neutral'} strong />
      <Figure label="Avans — naqd" value={b.advanceCash} variant={adv(b.advanceCash)} />
      <Figure label="Avans — o'tkazma" value={b.advanceBank} variant={adv(b.advanceBank)} />
      <Figure label="Avans jami" value={b.advanceTotal} variant={adv(b.advanceTotal)} strong />
      <Figure
        label="Sof holat"
        value={b.net}
        hint="Musbat — pulimiz zavodda; manfiy — biz qarzdormiz"
      />
      {Math.abs(num(offBook)) >= 1 ? (
        <Figure
          label="Shundan qo'lda tuzatish"
          value={offBook}
          hint="Off-book tuzatish. Boshqaruv paneli va Qarzlar sahifasi uni hisobga olmaydi"
        />
      ) : null}
    </>
  );
}

export default function FactoryReport() {
  const t = useT();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const isPhone = useIsPhone();
  const uf = useUrlFilters(FILTER_KEYS);

  const factoryId = uf.get('factoryId') || undefined;
  const from = uf.get('from') || undefined;
  const to = uf.get('to') || undefined;
  const page = Number(uf.get('page')) || 1;
  const pageSize = Number(uf.get('pageSize')) || 20;

  const reportQ = useQuery({
    queryKey: ['factory-report', { factoryId, from, to }],
    queryFn: () => endpoints.factoryReport({ factoryId: factoryId as string, from, to }),
    enabled: !!factoryId,
  });
  const ordersQ = useQuery({
    queryKey: ['factory-report', 'orders', { factoryId, from, to, page, pageSize }],
    queryFn: () =>
      endpoints.factoryReportOrders({ factoryId: factoryId as string, from, to, page, pageSize }),
    enabled: !!factoryId,
  });

  const xlsxMut = useMutation({
    mutationFn: () => endpoints.factoryReportXlsx({ factoryId: factoryId as string, from, to }),
    onSuccess: () => message.success(t('Excel fayl yuklab olindi')),
    // blob so'rovida server xatosi ham Blob bo'lib qaytadi — matnini o'qib ko'rsatamiz
    onError: async (e) => message.error(await blobError(e)),
  });

  const r = reportQ.data;

  /** «01.07.2026 — 31.07.2026» yoki «Butun davr» — joriy tilda. */
  const periodLabel = useMemo(
    () => (from || to ? `${from ? fmtDate(from) : '…'} — ${to ? fmtDate(to) : '…'}` : t('Butun davr')),
    [from, to, t],
  );

  const summaryFigures = useMemo(() => {
    if (!r) return [];
    return [
      { key: 'cost', label: 'Jami tannarx', value: r.purchase.costTotal, strong: true },
      { key: 'paid', label: "To'langan (naqd + o'tkazma)", value: r.payments.paid, variant: 'in' as const },
      {
        key: 'debt',
        label: 'Davr buyurtmalari bo\'yicha qarz',
        value: r.purchase.openDebt,
        variant: 'weOwe' as const,
      },
      {
        key: 'advance',
        label: 'Avansimiz (bugungi)',
        value: r.balances.current.advanceTotal,
        variant: 'in' as const,
      },
      { key: 'orders', label: 'Buyurtmalar', value: r.purchase.orders, variant: 'count' as const },
    ];
  }, [r]);

  // ── mahsulot jadvali: narx kesimi ochiladigan qatorda ──
  const productCols: SbColumn<FactoryReportProduct>[] = [
    {
      title: t('Mahsulot'),
      key: 'name',
      render: (_: unknown, p: FactoryReportProduct) => (
        <span>
          <b>{p.productName}</b>
          {p.size ? <span style={{ opacity: 0.6 }}> · {p.size}</span> : null}
        </span>
      ),
    },
    {
      title: t('Hajm'),
      key: 'cube',
      align: 'right',
      render: (_: unknown, p: FactoryReportProduct) => fmtM3(p.cubeM3),
    },
    {
      title: t('Summa'),
      key: 'cost',
      align: 'right',
      render: (_: unknown, p: FactoryReportProduct) => <MoneyCell value={p.costTotal} />,
    },
    {
      title: t("O'rtacha 1 m³"),
      key: 'avg',
      align: 'right',
      render: (_: unknown, p: FactoryReportProduct) =>
        p.avgPricePerM3 === null ? '—' : fmtMoney(p.avgPricePerM3),
    },
    {
      title: t('Narxlar'),
      key: 'prices',
      align: 'right',
      render: (_: unknown, p: FactoryReportProduct) => t('{n} xil', { n: String(p.prices.length) }),
    },
    { title: t('Poddon'), key: 'pal', align: 'right', render: (_: unknown, p: FactoryReportProduct) => fmtNum(p.palletCount) },
    { title: t('Buyurtma'), key: 'ord', align: 'right', render: (_: unknown, p: FactoryReportProduct) => fmtNum(p.orders) },
  ];

  const priceCols = (rows: ReportPriceBucket[]) => (
    <Table<ReportPriceBucket>
      size="small"
      rowKey={(b) => b.pricePerM3}
      dataSource={rows}
      pagination={false}
      scroll={{ x: 'max-content' }}
      columns={[
        {
          title: t('Narx (1 m³)'),
          key: 'price',
          align: 'right',
          render: (_: unknown, b: ReportPriceBucket) =>
            b.priceMissing ? (
              <Tooltip title={t('Mahsulotga zavod narxi kiritilmagan — tannarxga 0 bo\'lib tushgan')}>
                <Tag color="orange">{t('narxi kiritilmagan')}</Tag>
              </Tooltip>
            ) : (
              <b>{fmtMoney(b.pricePerM3)}</b>
            ),
        },
        { title: t('Hajm'), key: 'cube', align: 'right', render: (_: unknown, b: ReportPriceBucket) => fmtM3(b.cubeM3) },
        {
          title: t('Summa'),
          key: 'sum',
          align: 'right',
          render: (_: unknown, b: ReportPriceBucket) => <MoneyCell value={b.costTotal} />,
        },
        {
          title: t('Narxnoma bo\'yicha'),
          key: 'anchor',
          align: 'right',
          render: (_: unknown, b: ReportPriceBucket) =>
            num(b.anchorTotal) === num(b.costTotal) ? (
              <span style={{ opacity: 0.5 }}>=</span>
            ) : (
              <Tooltip title={t('Bu buyurtma boshqa kanal narxida yopilgan')}>
                <span>{fmtMoney(b.anchorTotal)}</span>
              </Tooltip>
            ),
        },
        { title: t('Buyurtma'), key: 'ord', align: 'right', render: (_: unknown, b: ReportPriceBucket) => fmtNum(b.orders) },
      ]}
    />
  );

  // ── buyurtmalar jadvali ──
  const orderCols: SbColumn<FactoryReportOrderRow>[] = [
    {
      title: t('Buyurtma'),
      key: 'no',
      columnKey: 'no',
      mobile: 'title',
      render: (_: unknown, o: FactoryReportOrderRow) => <b>{o.orderNo}</b>,
    },
    {
      title: t('Sana'),
      key: 'date',
      columnKey: 'date',
      mobile: 'meta',
      mobileLabel: 'Sana',
      render: (_: unknown, o: FactoryReportOrderRow) => fmtDate(o.date),
    },
    {
      title: t('Mijoz'),
      key: 'client',
      columnKey: 'client',
      mobile: 'subtitle',
      render: (_: unknown, o: FactoryReportOrderRow) => o.client?.name ?? '—',
    },
    {
      title: t('Mahsulot'),
      key: 'products',
      columnKey: 'products',
      mobile: 'meta',
      mobileLabel: 'Mahsulot',
      render: (_: unknown, o: FactoryReportOrderRow) =>
        o.products.length === 0 ? '—' : o.products.map((p) => p.name).join(', '),
    },
    {
      title: t('Hajm'),
      key: 'cube',
      columnKey: 'cube',
      align: 'right',
      mobile: 'meta',
      mobileLabel: 'Hajm',
      render: (_: unknown, o: FactoryReportOrderRow) => fmtM3(o.cubeM3),
    },
    {
      title: t('Tannarx'),
      key: 'cost',
      columnKey: 'cost',
      align: 'right',
      mobile: 'value',
      render: (_: unknown, o: FactoryReportOrderRow) => <MoneyCell value={o.costTotal} />,
    },
    {
      title: t("To'langan"),
      key: 'paid',
      columnKey: 'paid',
      align: 'right',
      mobile: 'meta',
      mobileLabel: "To'langan",
      render: (_: unknown, o: FactoryReportOrderRow) => <MoneyCell value={o.factoryPaid} variant="in" />,
    },
    {
      title: t('Qoldiq'),
      key: 'open',
      columnKey: 'open',
      align: 'right',
      mobile: 'meta',
      mobileLabel: 'Qoldiq',
      render: (_: unknown, o: FactoryReportOrderRow) =>
        num(o.factoryOpen) === 0 ? <span style={{ opacity: 0.5 }}>—</span> : <MoneyCell value={o.factoryOpen} variant="weOwe" />,
    },
    {
      title: t("To'lash niyati"),
      key: 'intent',
      columnKey: 'intent',
      mobile: 'meta',
      mobileLabel: "To'lash niyati",
      render: (_: unknown, o: FactoryReportOrderRow) => (
        <StatusChip meta={FACTORY_PAY_INTENT[o.factoryPayIntent]} />
      ),
    },
    {
      title: t('Tannarx holati'),
      key: 'coststatus',
      columnKey: 'coststatus',
      render: (_: unknown, o: FactoryReportOrderRow) => <StatusChip meta={COST_STATUS[o.costStatus]} />,
    },
    {
      title: t('Holat'),
      key: 'status',
      columnKey: 'status',
      render: (_: unknown, o: FactoryReportOrderRow) => <StatusChip meta={STATUS[o.status]} />,
    },
  ];

  return (
    <>
      <PageHeader
        accent
        title={t('Zavod bo\'yicha hisobot')}
        subtitle={t('Bitta zavod, tanlangan davr: nima oldik, qancha to\'ladik, qancha qarzimiz qoldi')}
        actions={[
          {
            key: 'xlsx',
            label: t('Excel yuklab olish'),
            icon: <DownloadOutlined />,
            primary: true,
            disabled: !factoryId || xlsxMut.isPending,
            onClick: () => xlsxMut.mutate(),
          },
        ]}
      />

      {/* ── filtr: zavod + davr ── */}
      <div className="sb-table-card" style={{ padding: isPhone ? 12 : 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ minWidth: isPhone ? '100%' : 280, flex: isPhone ? '1 1 100%' : '0 0 auto' }}>
            <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', opacity: 0.6, marginBottom: 4 }}>
              {t('Zavod')}
            </div>
            <PartySelect
              type="factory"
              value={factoryId}
              onChange={(v) => uf.set({ factoryId: v ?? null })}
              size="large"
              style={{ width: '100%', minWidth: isPhone ? undefined : 280 }}
            />
          </div>
          <div style={{ flex: isPhone ? '1 1 100%' : '0 0 auto' }}>
            <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', opacity: 0.6, marginBottom: 4 }}>
              {t('Davr')}
            </div>
            <DateRangeControl
              from={from}
              to={to}
              size="middle"
              onChange={(range) => uf.set({ from: range.from ?? null, to: range.to ?? null })}
            />
          </div>
          {from || to ? (
            <Button size="small" onClick={() => uf.set({ from: null, to: null })}>
              {t('Butun davr')}
            </Button>
          ) : null}
        </div>
      </div>

      {!factoryId ? (
        <EmptyState
          message={t('Zavodni tanlang — hisobot bitta zavod uchun tuziladi, har zavodning o\'z narxnomasi bor')}
        />
      ) : reportQ.isError ? (
        <ErrorState error={reportQ.error} onRetry={() => reportQ.refetch()} />
      ) : !r ? (
        <TableCard bodyPadding={24}>
          <Typography.Text type="secondary">{t('Yuklanmoqda…')}</Typography.Text>
        </TableCard>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <SummaryStrip
            figures={summaryFigures}
            // Davr yorlig'i SAHIFADA yasaladi: serverdagi `period.label` o'zbek lotinda
            // tayyorlanadi va ru/en da tarjimasiz chiqib qolardi.
            scopeLabel={`${r.factory.name} · ${periodLabel}`}
            note={
              r.purchase.cancelledOrders > 0
                ? t(
                    'Bekor qilingan {n} ta buyurtma hech bir raqamga kirmagan — ular butunlay hisobdan tashqarida',
                    { n: String(r.purchase.cancelledOrders) },
                  )
                : t('Bekor qilingan buyurtmalar hech bir raqamga kirmaydi')
            }
          />

          {/* ── 1. zavoddan olingan mol ── */}
          <Block
            title="Zavoddan olingan mol"
            note="Hajm — haqiqiy olingan yuk (zavoddan chiqqanda o'zgargan bo'lsa, o'zgargani). Poddon donada hisoblanadi, pulga aylanmaydi."
          >
            <Figure label="Buyurtmalar" value={r.purchase.orders} raw={fmtNum(r.purchase.orders)} strong />
            <Figure label="Jami hajm" value={null} raw={fmtM3(r.purchase.cubeM3)} strong />
            {r.purchase.plannedCubeM3 !== r.purchase.cubeM3 ? (
              <Figure
                label="Reja bo'yicha hajm"
                value={null}
                raw={fmtM3(r.purchase.plannedCubeM3)}
                hint="Reja va haqiqiy yuk farq qilgan"
              />
            ) : null}
            <Figure label="Jami tannarx" value={r.purchase.costTotal} strong />
            <Figure
              label="O'rtacha 1 m³ narxi"
              value={r.purchase.avgPricePerM3}
              raw={r.purchase.avgPricePerM3 === null ? '—' : fmtMoney(r.purchase.avgPricePerM3)}
              hint="Jami tannarx ÷ jami hajm — bu o'rtacha, narxnoma raqami emas"
            />
            <Figure label="Olingan poddon" value={null} raw={fmtNum(r.purchase.palletsReceived)} />
            <Figure label="Qaytarilgan poddon" value={null} raw={fmtNum(r.purchase.palletsReturned)} />
          </Block>

          {/* ── 2. mahsulot × narx ── */}
          <TableCard
            title={t('Mahsulot va narx bo\'yicha')}
            extra={
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {t('Qatorni oching — o\'sha mahsulot qaysi narxda qancha olingani chiqadi')}
              </Typography.Text>
            }
          >
            <Table<FactoryReportProduct>
              size="small"
              rowKey="productId"
              dataSource={r.products}
              columns={productCols}
              pagination={false}
              scroll={{ x: 'max-content' }}
              locale={{ emptyText: t('Bu davrda bu zavoddan mol olinmagan') }}
              expandable={{
                expandedRowRender: (p) => priceCols(p.prices),
                rowExpandable: (p) => p.prices.length > 0,
              }}
            />
          </TableCard>

          {/* ── 3. narx bo'yicha yalpi ── */}
          <TableCard
            title={t('Narx bo\'yicha yalpi taqsimot')}
            extra={
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {t('Mahsulotdan qat\'i nazar: qaysi narxda jami qancha kub')}
              </Typography.Text>
            }
          >
            {priceCols(r.priceBreakdown)}
          </TableCard>

          {/* ── 4a. to'lov usuli ── */}
          <Block
            title="Zavodga to'langan pul — to'lov usuli bo'yicha"
            note="Bu blok pulning FIZIK yo'lini o'lchaydi: kassadan naqd chiqdimi yoki bankdan o'tkazildimi. Bonusdan yopilgani «jami to'langan» ga kirmaydi — u qarzni kamaytiradi, lekin kassadan bir so'm ham chiqarmaydi."
          >
            <Figure label="Naqd (kassadan)" value={r.payments.paidCash} variant="in" strong />
            <Figure label="O'tkazma (bankdan)" value={r.payments.paidBank} variant="in" strong />
            <Figure label="Jami to'langan" value={r.payments.paid} strong />
            <Figure label="Zavod qaytargani" value={r.payments.refunded} />
            <Figure label="Sof o'tkazilgan" value={r.payments.netPaid} strong />
            <Figure
              label="Bonusdan yopilgan"
              value={r.payments.bonusOffset}
              hint="Pul emas — bonus hamyonidan qarzga o'tkazilgani"
            />
            <Figure label="To'lov hujjatlari" value={null} raw={fmtNum(r.payments.paymentCount)} />
          </Block>

          {r.payments.byMethod.length > 0 ? (
            <TableCard title={t('To\'lov usullari kesimi')}>
              <Table
                size="small"
                rowKey={(m: Report['payments']['byMethod'][number]) => `${m.kind}:${m.method}`}
                dataSource={r.payments.byMethod}
                pagination={false}
                scroll={{ x: 'max-content' }}
                columns={[
                  {
                    title: t('Usuli'),
                    key: 'method',
                    render: (_: unknown, m: Report['payments']['byMethod'][number]) =>
                      PAYMENT_METHOD[m.method]?.label ?? m.method,
                  },
                  {
                    title: t('Kanal'),
                    key: 'family',
                    render: (_: unknown, m: Report['payments']['byMethod'][number]) => (
                      <Tag color={m.family === 'CASH' ? 'green' : m.family === 'BANK' ? 'blue' : 'purple'}>
                        {t(FAMILY_LABEL[m.family])}
                      </Tag>
                    ),
                  },
                  {
                    title: t('Turi'),
                    key: 'kind',
                    render: (_: unknown, m: Report['payments']['byMethod'][number]) =>
                      m.kind === 'FACTORY_REFUND' ? t('Zavod qaytardi') : t('Zavodga to\'lov'),
                  },
                  {
                    title: t('Summa'),
                    key: 'amount',
                    align: 'right',
                    render: (_: unknown, m: Report['payments']['byMethod'][number]) => (
                      <MoneyCell value={m.amount} />
                    ),
                  },
                  {
                    title: t('Hujjat'),
                    key: 'count',
                    align: 'right',
                    render: (_: unknown, m: Report['payments']['byMethod'][number]) => fmtNum(m.count),
                  },
                ]}
              />
            </TableCard>
          ) : null}

          {/* ── 4b. narxnoma kanali ── */}
          <Block
            title="Qaysi narxnomada yopildi (narx kanali)"
            note="Bu YUQORIDAGIDAN BOSHQA savol: mol qaysi narx kitobida hisob-kitob qilingani. Bank o'tkazmasi naqd narxnomali buyurtmani yopishi mumkin, shuning uchun ikkala blokning yig'indisi teng chiqmasligi normal — farqni hali taqsimlanmagan avans tashkil qiladi."
          >
            <Figure label="Naqd narxnomada" value={r.settlement.byPriceKind.cash} strong />
            <Figure label="O'tkazma narxnomada" value={r.settlement.byPriceKind.bank} strong />
            {num(r.settlement.byPriceKind.unknown) !== 0 ? (
              <Figure
                label="Kanali ko'rsatilmagan"
                value={r.settlement.byPriceKind.unknown}
                hint="Eski yozuvlar — o'tkazmaga qo'shilmaydi"
              />
            ) : null}
            <Figure label="Jami taqsimlangan" value={r.settlement.byPriceKind.total} />
            <Figure
              label="Avansdan yechilgan"
              value={r.settlement.drawnFromAdvance.total}
              hint="Zavodda turgan pul buyurtmaga o'tkazilgani — yangi pul emas"
            />
            <Figure
              label="Avansga tushgan"
              value={r.settlement.advanceIn.total}
              variant="in"
              hint="Davrda avans cho'ntagiga tushgan sof pul"
            />
          </Block>

          {/* ── 5. qarz va avans ── */}
          <div style={{ display: 'grid', gridTemplateColumns: isPhone ? '1fr' : '1fr 1fr', gap: 16 }}>
            <Block
              title="Qarz va avans — davr oxiriga"
              note="Bugungi bilim bo'yicha o'sha sanadagi holat: keyin qilingan bekor qilish daftarga original sana bilan tushadi, ya'ni bu ustun keyinchalik o'zgarishi mumkin."
            >
              <BalanceColumn b={r.balances.asOfPeriodEnd} offBook={r.balances.offBook.asOfPeriodEnd} />
            </Block>
            <Block
              title="Qarz va avans — bugungi holat"
              note="Zavod kartochkasidagi raqam bilan aynan bir xil."
            >
              <BalanceColumn b={r.balances.current} offBook={r.balances.offBook.current} />
            </Block>
          </div>

          <Block
            title="Davr buyurtmalarining ochiq qarzi"
            note="Faqat shu davrda olingan mol bo'yicha. Yuqoridagi umumiy qarzdan farq qiladi: unda eski davrlarning qoldig'i ham bor."
          >
            <Figure label="Jami ochiq" value={r.purchase.openDebt} variant="weOwe" strong />
            <Figure label="Ochiq buyurtmalar" value={null} raw={fmtNum(r.purchase.openOrders)} />
            <Figure label="Naqd to'lash niyatida" value={r.purchase.openByIntent.cash} />
            <Figure label="O'tkazma niyatida" value={r.purchase.openByIntent.bank} />
            <Figure label="Niyati aniqlanmagan" value={r.purchase.openByIntent.unknown} />
          </Block>

          {/* ── 6. bonus + poddon ── */}
          <Block
            title="Bonus va poddon"
            note="Bonus hamyoni va poddon qoldig'i — BUGUNGI holat (davrga bog'liq emas). Poddon donada hisoblanadi."
          >
            <Figure label="Davrda hisoblangan bonus" value={r.bonus.accruedInPeriod} variant="in" />
            <Figure label="Davrda qarzga o'tkazilgan" value={r.bonus.offsetInPeriod} />
            <Figure label="Bonus hamyoni (bugungi)" value={r.bonus.walletCurrent} variant="in" strong />
            <Figure
              label="Zavodga poddon qarzimiz"
              value={null}
              raw={fmtNum(r.pallets.balance)}
              strong
              hint="Jami olingan {a} · qaytarilgan {b}"
              hintParams={{ a: fmtNum(r.pallets.receivedAllTime), b: fmtNum(r.pallets.returnedAllTime) }}
            />
          </Block>

          {/* ── 7. nazorat: faqat farq bo'lganda ── */}
          {num(r.checks.costTotalDrift) !== 0 || num(r.checks.zeroPricedCubeM3) !== 0 || r.checks.blendedItems > 0 ? (
            <Block
              title="Nazorat"
              note="Bu qatorlar faqat farq bo'lganda chiqadi. Hisobot ikkitadan bittasini jimgina tanlamaydi — ikkalasini ham ko'rsatadi."
            >
              {num(r.checks.costTotalDrift) !== 0 ? (
                <Figure
                  label="Buyurtma jamlari bilan farq"
                  value={r.checks.costTotalDrift}
                  hint="Buyurtma jamlari: {x}"
                  hintParams={{ x: fmtMoney(r.checks.orderCostTotal) }}
                />
              ) : null}
              {num(r.checks.zeroPricedCubeM3) !== 0 ? (
                <Figure
                  label="Narxi kiritilmagan hajm"
                  value={null}
                  raw={fmtM3(r.checks.zeroPricedCubeM3)}
                  hint="Bu hajm tannarxga 0 so'm bo'lib tushgan — mahsulotga zavod narxi kiritilmagan"
                />
              ) : null}
              {r.checks.blendedItems > 0 ? (
                <Figure
                  label="Aralash narxda yopilgan pozitsiyalar"
                  value={null}
                  raw={fmtNum(r.checks.blendedItems)}
                  hint="Narxnoma bo'yicha bo'lishi kerak edi: {x}"
                  hintParams={{ x: fmtMoney(r.checks.anchorCostTotal) }}
                />
              ) : null}
            </Block>
          ) : null}

          {/* ── 8. buyurtmalar ro'yxati ── */}
          <TableCard
            title={t('Davrdagi buyurtmalar')}
            extra={
              ordersQ.data ? (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {t('{n} ta · {cube} · {sum}', {
                    n: fmtNum(ordersQ.data.summary.orders),
                    cube: fmtM3(ordersQ.data.summary.cubeM3),
                    sum: fmtMoney(ordersQ.data.summary.costTotal),
                  })}
                </Typography.Text>
              ) : null
            }
          >
            <DataTable<FactoryReportOrderRow>
              columns={orderCols}
              query={ordersQ}
              rowKey="id"
              onRowOpen={(o) => navigate(`/orders/${o.id}`)}
              // `factoryId` ATAYLAB filtr kaliti EMAS: usiz hisobot umuman yo'q, va
              // «filtrlarni tozalash» tugmasi uni ham o'chirsa, foydalanuvchi bo'sh
              // «zavodni tanlang» ekraniga uloqtirilardi. Davr esa haqiqiy filtr.
              filterKeys={['from', 'to']}
              onClearFilters={() => uf.set({ from: null, to: null })}
              emptyText={t('Bu davrda buyurtma yo\'q')}
              scroll={{ x: 'max-content' }}
              defaultPageSize={20}
            />
          </TableCard>
        </div>
      )}
    </>
  );
}
