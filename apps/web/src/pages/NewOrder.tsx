import { useMemo, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Col,
  DatePicker,
  Divider,
  Form,
  Input,
  InputNumber,
  Radio,
  Row,
  Select,
  Space,
  Tag,
  Typography,
  theme,
} from 'antd';
import { DeleteOutlined, PlusOutlined, SaveOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { apiError, asItems, endpoints } from '../lib/api';
import { fmtM3, fmtMoney, fmtNum, fmtUZS, num } from '../lib/format';
import { TOPBAR_H, useIsDesktop, useIsPhone } from '../lib/responsive';
import { Money } from '../components/Money';
import { PageHeader } from '../components/PageHeader';
import { useT } from '../components/LangContext';
import { translate } from '../lib/i18n';
import { useAuth } from '../auth/AuthContext';
import type { Order, TransportMode } from '../lib/types';

/**
 * Actual /products list row: prices come back as a Record keyed by PriceKind
 * (products.service maps them), plus a flat factoryName.
 */
interface CatalogProduct {
  id: string;
  factoryId: string;
  factoryName?: string;
  factory?: { id: string; name: string };
  name: string;
  size?: string | null;
  m3PerPallet: string;
  blocksPerPallet?: number | null;
  unit: string;
  active: boolean;
  prices?: Record<string, { pricePerM3: string; effectiveFrom: string }>;
}

type PricingMode = 'CATALOG' | 'NEGOTIATED' | 'LUMP' | 'PENDING';

interface ItemFormValue {
  productId?: string;
  palletCount?: number;
  quantityM3?: number;
  pricingMode?: PricingMode;
  salePricePerM3?: number;
  saleLumpSum?: number;
}

interface OneTimeVehicleValue {
  name?: string;
  plate?: string;
  driver?: string;
  phone?: string;
}

interface FormValues {
  clientId?: string;
  date: Dayjs;
  vehicleId?: string;
  vehicleAdHoc?: boolean;
  oneTimeVehicle?: OneTimeVehicleValue;
  driverName?: string;
  transportMode: TransportMode;
  transportCost?: number;
  note?: string;
  items: ItemFormValue[];
}

/**
 * Transport always sits INSIDE the goods total — the client owes the sale sum either
 * way, the mode only picks who physically hands the driver his cut. DEALER_CHARGED
 * (billed on top) is legacy and deliberately absent: the server rejects it.
 */
const TRANSPORT_OPTIONS: { value: TransportMode; label: string; hint: string }[] = [
  {
    value: 'CLIENT_OWN',
    label: "Mijozning o'z transporti",
    hint: 'Mijoz o‘z moshinasida olib ketadi — transport xarajati yo‘q.',
  },
  {
    value: 'DEALER_ABSORBED',
    label: "Shofyorga diller to'laydi",
    hint: 'Mijoz butun summani dillerga beradi, diller shofyorga o‘zi to‘laydi.',
  },
  {
    value: 'CLIENT_PAYS_DRIVER',
    label: "Shofyorga mijoz to'laydi",
    hint: 'Mijoz shofyorga transport pulini beradi, qolganini dillerga beradi.',
  },
];

/** default truck capacity fallback the server uses when no vehicle is chosen */
const DEFAULT_CAPACITY = 19;

const moneyFormatter = (v: string | number | undefined) =>
  `${v ?? ''}`.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const moneyParser = (v: string | undefined) => Number((v ?? '').replace(/\s/g, ''));

function selectError(q: { isError: boolean; refetch: () => unknown }) {
  if (!q.isError) return undefined;
  return (
    <Alert
      type="error"
      showIcon
      message={translate('Yuklashda xatolik')}
      action={
        <Button size="small" onClick={() => void q.refetch()}>
          {translate('Qayta urinish')}
        </Button>
      }
    />
  );
}

/**
 * small section overline (uppercase tertiary label) — replaces labelled Dividers.
 * `compact` (telefon) faqat vertikal bo'shliqni qisqartiradi — desktop tegilmaydi.
 */
const overlineStyle = (color: string, compact = false): CSSProperties => ({
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '.04em',
  textTransform: 'uppercase',
  color,
  margin: compact ? '16px 0 8px' : '24px 0 12px',
});

export default function NewOrder() {
  const { message } = App.useApp();
  const t = useT();
  const { token } = theme.useToken();
  // §1.1 breakpointlari — bitta manbadan (Grid.useBreakpoint TAQIQLANGAN, R1)
  const isPhone = useIsPhone();
  const isDesktop = useIsDesktop();
  const { hasRole } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form] = Form.useForm<FormValues>();
  const [clientSearch, setClientSearch] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);

  // ── data ──
  const clientsQ = useQuery({
    queryKey: ['clients', 'order-select', clientSearch],
    queryFn: () => endpoints.clients({ page: 1, pageSize: 200, search: clientSearch || undefined }),
  });
  const productsQ = useQuery({
    queryKey: ['products', 'order-catalog'],
    queryFn: () => {
      // list endpoint is paged (default 50) — request the max page to get the full catalog
      const params: { factoryId?: string; pageSize?: number } = { pageSize: 200 };
      return endpoints.products(params);
    },
  });
  const vehiclesQ = useQuery({
    queryKey: ['vehicles', 'order-select'],
    // pageSize 200 = the @Max(200) ceiling in the API's PageQueryDto. Without it the
    // picker only ever offered the first 50 trucks of the fleet.
    queryFn: () => endpoints.vehicles({ pageSize: 200, active: true }),
  });

  const clients = clientsQ.data?.items ?? [];
  const products = useMemo(
    () => (asItems(productsQ.data) as unknown as CatalogProduct[]).filter((p) => p.active),
    [productsQ.data],
  );
  const vehicles = useMemo(
    () => asItems(vehiclesQ.data).filter((v) => v.active !== false),
    [vehiclesQ.data],
  );
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const productOptions = useMemo(() => {
    const byFactory = new Map<string, { label: string; options: { value: string; label: string }[] }>();
    for (const p of products) {
      const factoryName = p.factoryName ?? p.factory?.name ?? t('Zavod');
      let group = byFactory.get(factoryName);
      if (!group) {
        group = { label: factoryName, options: [] };
        byFactory.set(factoryName, group);
      }
      group.options.push({
        value: p.id,
        label: `${p.name}${p.size ? ` ${p.size}` : ''} — ${fmtNum(p.m3PerPallet, 3)} m³/pallet`,
      });
    }
    return [...byFactory.values()];
  }, [products]);

  const pricingOptions = useMemo(() => {
    const opts: { value: PricingMode; label: string }[] = [
      { value: 'CATALOG', label: 'Katalog narxi' },
      { value: 'NEGOTIATED', label: 'Kelishilgan narx' },
      { value: 'LUMP', label: 'Umumiy summa' },
    ];
    if (hasRole('ADMIN', 'ACCOUNTANT')) opts.push({ value: 'PENDING', label: 'Narxsiz' });
    return opts;
  }, [hasRole]);

  // ── live form state ──
  const wItems = Form.useWatch('items', form) as ItemFormValue[] | undefined;
  const wClientId = Form.useWatch('clientId', form) as string | undefined;
  const wVehicleId = Form.useWatch('vehicleId', form) as string | undefined;
  const wTransportMode = (Form.useWatch('transportMode', form) ?? 'DEALER_ABSORBED') as TransportMode;
  const wTransportCost = Form.useWatch('transportCost', form) as number | undefined;
  const wAdHoc = Form.useWatch('vehicleAdHoc', form) as boolean | undefined;

  const selectedClient = clients.find((c) => c.id === wClientId);
  const selectedVehicle = wAdHoc ? undefined : vehicles.find((v) => v.id === wVehicleId);
  const office = hasRole('ADMIN', 'ACCOUNTANT');
  // minimal flow: office defers the sale price (priced later via priceItem); PENDING is
  // office-only, so agents (who cannot late-price) default to the catalog price.
  const defaultPricingMode: PricingMode = office ? 'PENDING' : 'CATALOG';

  const calc = useMemo(() => {
    let pallets = 0;
    let m3 = 0;
    let sale = 0;
    let factoryCost = 0;
    let costKnown = true; // office ko'radigan taxminiy tannarx to'liqmi
    let hasPending = false;
    const factoryIds = new Set<string>();
    // provisional cost basis is the BANK price — the factory PAYMENT method (naqd/bank)
    // fixes the final cost later (recomputeOrderCost), it is NOT chosen at create.
    const costKind = 'FACTORY_BANK';
    for (const it of wItems ?? []) {
      if (!it) continue;
      const prod = it.productId ? productById.get(it.productId) : undefined;
      if (prod) factoryIds.add(prod.factoryId);
      const pc = it.palletCount ?? 0;
      pallets += pc;
      const qty = it.quantityM3 && it.quantityM3 > 0 ? it.quantityM3 : prod ? num(prod.m3PerPallet) * pc : 0;
      m3 += qty;
      // taxminiy zavod tannarxi (office uchun; katalog narxidan)
      const fp = prod?.prices?.[costKind]?.pricePerM3;
      if (qty > 0) {
        if (fp != null) factoryCost += qty * num(fp);
        else if (prod) costKnown = false;
      }
      switch (it.pricingMode ?? 'CATALOG') {
        case 'LUMP':
          sale += it.saleLumpSum ?? 0;
          break;
        case 'NEGOTIATED':
          sale += qty * (it.salePricePerM3 ?? 0);
          break;
        case 'PENDING':
          hasPending = true;
          break;
        default:
          sale += qty * num(prod?.prices?.['DEALER_SALE']?.pricePerM3);
      }
    }
    return { pallets, m3, sale, factoryCost, costKnown, hasPending, factoryCount: factoryIds.size };
  }, [wItems, productById]);

  const capacity = selectedVehicle ? selectedVehicle.capacityPallets : DEFAULT_CAPACITY;
  const capacityExceeded = calc.pallets > capacity;
  const transportCost = wTransportMode !== 'CLIENT_OWN' ? (wTransportCost ?? 0) : 0;
  // Transport is INSIDE the sale sum: the client owes the goods total in every mode, so
  // that — not sale+transport — is the credit exposure.
  const exposure = calc.sale;
  const clientPaysDriver = wTransportMode === 'CLIENT_PAYS_DRIVER';
  // What the dealer is left with after the driver is paid. The driver's cut leaves the
  // dealer in BOTH dealer modes — the client either hands it over directly, or hands the
  // dealer everything and the dealer pays out. Same number, different route.
  const dealerKeeps = calc.sale - transportCost;
  // Cash the client hands the DEALER (as opposed to the driver) — only these two differ.
  const clientHandsDealer = clientPaysDriver ? calc.sale - transportCost : calc.sale;
  const transportOverruns = transportCost > calc.sale && calc.sale > 0 && wTransportMode !== 'CLIENT_OWN';
  const creditRisk =
    selectedClient != null &&
    selectedClient.creditLimit != null &&
    num(selectedClient.balance) + exposure > num(selectedClient.creditLimit);

  // Taxminiy diller foydasi (faqat office ko'radi — agent zavod narxini ko'rmaydi).
  // Transport dillerning xarajati — kim to'lashidan qat'i nazar foydadan chiqadi.
  const goodsProfit = calc.sale - calc.factoryCost;
  const dealerProfit = goodsProfit - transportCost;
  const showProfit = office && !calc.hasPending && calc.sale > 0;

  // ── submit ──
  const createM = useMutation({
    mutationFn: (payload: Record<string, unknown>) => endpoints.createOrder(payload),
    onSuccess: (order: Order) => {
      message.success(t('Buyurtma {orderNo} yaratildi', { orderNo: order.orderNo }));
      for (const key of ['orders', 'clients', 'dashboard', 'debts', 'pallets', 'factories', 'vehicles', 'reports']) {
        qc.invalidateQueries({ queryKey: [key] });
      }
      navigate(`/orders/${order.id}`);
    },
    onError: (err: unknown) => {
      const m = apiError(err);
      setSubmitError(m);
      message.error(m);
    },
  });

  const handleValuesChange = (changed: Partial<FormValues>) => {
    // pallet count / product change → suggest quantityM3 (still editable)
    if (Array.isArray(changed.items)) {
      changed.items.forEach((ch, idx) => {
        if (!ch || typeof ch !== 'object') return;
        if ('palletCount' in ch || 'productId' in ch) {
          const row = (form.getFieldValue(['items', idx]) ?? {}) as ItemFormValue;
          const prod = row.productId ? productById.get(row.productId) : undefined;
          if (prod && row.palletCount != null && row.palletCount > 0) {
            const qty = Math.round(num(prod.m3PerPallet) * row.palletCount * 1000) / 1000;
            form.setFieldValue(['items', idx, 'quantityM3'], qty);
          }
        }
      });
    }
    // vehicle change → autofill driver name (still editable)
    if ('vehicleId' in changed) {
      const v = vehicles.find((x) => x.id === changed.vehicleId);
      form.setFieldValue('driverName', v?.driver ?? undefined);
    }
  };

  const onFinish = (v: FormValues) => {
    setSubmitError(null);
    const items = v.items ?? [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!((it.palletCount ?? 0) > 0 || (it.quantityM3 ?? 0) > 0)) {
        setSubmitError(t('{n}-qator: pallet soni yoki hajm (m³) kiritilishi shart', { n: i + 1 }));
        return;
      }
    }
    const mode = v.transportMode;
    const adHoc = !!(v.vehicleAdHoc && v.oneTimeVehicle?.name?.trim());
    const payload: Record<string, unknown> = {
      clientId: v.clientId,
      date: v.date.format('YYYY-MM-DD'),
      vehicleId: !v.vehicleAdHoc ? v.vehicleId || undefined : undefined,
      oneTimeVehicle: adHoc
        ? {
            name: v.oneTimeVehicle!.name!.trim(),
            plate: v.oneTimeVehicle?.plate?.trim() || undefined,
            driver: v.oneTimeVehicle?.driver?.trim() || undefined,
            phone: v.oneTimeVehicle?.phone?.trim() || undefined,
          }
        : undefined,
      // ad-hoc driver flows through the minted vehicle (backend falls back to vehicle.driver)
      driverName: !v.vehicleAdHoc ? v.driverName?.trim() || undefined : undefined,
      transportMode: mode,
      transportCost: mode !== 'CLIENT_OWN' && v.transportCost != null ? v.transportCost : undefined,
      note: v.note?.trim() || undefined,
      items: items.map((it) => {
        const pm: PricingMode = it.pricingMode ?? 'CATALOG';
        return {
          productId: it.productId,
          palletCount: it.palletCount ?? 0,
          quantityM3: (it.quantityM3 ?? 0) > 0 ? it.quantityM3 : undefined,
          salePricePerM3: pm === 'NEGOTIATED' ? it.salePricePerM3 : undefined,
          saleLumpSum: pm === 'LUMP' ? it.saleLumpSum : undefined,
          pricePending: pm === 'PENDING' ? true : undefined,
        };
      }),
    };
    createM.mutate(payload);
  };

  const anyLoadError = clientsQ.isError || productsQ.isError || vehiclesQ.isError;

  return (
    <div>
      <PageHeader
        title="Yangi buyurtma"
        breadcrumb={[{ label: 'Buyurtmalar', to: '/orders' }, { label: 'Yangi' }]}
      />

      {anyLoadError && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message={t("Ma'lumotlarni yuklashda xatolik")}
          description={apiError(clientsQ.error ?? productsQ.error ?? vehiclesQ.error)}
          action={
            <Button
              size="small"
              onClick={() => {
                void clientsQ.refetch();
                void productsQ.refetch();
                void vehiclesQ.refetch();
              }}
            >
              {t('Qayta urinish')}
            </Button>
          }
        />
      )}

      {submitError && (
        <Alert
          type="error"
          showIcon
          closable
          style={{ marginBottom: 16 }}
          message={t('Buyurtma yaratilmadi')}
          description={submitError}
          onClose={() => setSubmitError(null)}
        />
      )}

      <Row gutter={16}>
        <Col xs={24} lg={16}>
          {/* telefonda Card ichki padding'i 24→12: 320px da 24px kenglik qaytariladi */}
          <Card styles={isPhone ? { body: { padding: 12 } } : undefined}>
            <Form
              form={form}
              layout="vertical"
              disabled={createM.isPending}
              onFinish={onFinish}
              onValuesChange={handleValuesChange}
              initialValues={{
                date: dayjs(),
                transportMode: 'DEALER_ABSORBED',
                items: [{ pricingMode: defaultPricingMode }],
              }}
            >
              <Row gutter={12}>
                <Col xs={24} md={16}>
                  <Form.Item name="clientId" label={t('Mijoz')} rules={[{ required: true, message: t('Mijozni tanlang') }]}>
                    <Select
                      showSearch
                      filterOption={false}
                      onSearch={setClientSearch}
                      loading={clientsQ.isFetching}
                      placeholder={t('Mijozni qidiring…')}
                      notFoundContent={selectError(clientsQ)}
                      options={clients.map((c) => ({
                        value: c.id,
                        label: `${c.name} — ${t('balans')} ${fmtMoney(c.balance)}`,
                      }))}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item name="date" label={t('Sana')} rules={[{ required: true, message: t('Sanani tanlang') }]}>
                    <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" allowClear={false} />
                  </Form.Item>
                </Col>
              </Row>
              {office && (
                <Typography.Text type="secondary" style={{ display: 'block', marginTop: -8, marginBottom: 4, fontSize: 12 }}>
                  {t("Zavod tannarxi (naqd/bank) buyurtma yaratishda tanlanmaydi — u zavodga to'lov qilinganda belgilanadi. Taxminiy tannarx bank narxida ko'rsatiladi.")}
                </Typography.Text>
              )}

              <div style={overlineStyle(token.colorTextTertiary, isPhone)}>{t('Mahsulotlar')}</div>

              <Form.List
                name="items"
                rules={[
                  {
                    validator: async (_, value: ItemFormValue[]) => {
                      if (!value || value.length < 1) throw new Error(t("Kamida bitta mahsulot qo'shing"));
                    },
                  },
                ]}
              >
                {(fields, { add, remove }, { errors }) => (
                  <>
                    {fields.map(({ key, name }) => {
                      const row = wItems?.[name];
                      const prod = row?.productId ? productById.get(row.productId) : undefined;
                      const pm: PricingMode = row?.pricingMode ?? 'CATALOG';
                      const catalogPrice = prod?.prices?.['DEALER_SALE']?.pricePerM3;
                      const qty =
                        row?.quantityM3 && row.quantityM3 > 0
                          ? row.quantityM3
                          : prod
                            ? num(prod.m3PerPallet) * (row?.palletCount ?? 0)
                            : 0;
                      const est =
                        pm === 'LUMP'
                          ? (row?.saleLumpSum ?? 0)
                          : pm === 'NEGOTIATED'
                            ? qty * (row?.salePricePerM3 ?? 0)
                            : pm === 'CATALOG'
                              ? qty * num(catalogPrice)
                              : 0;
                      const estText = pm === 'PENDING' ? t('narxsiz') : `≈ ${fmtMoney(est)} ${t("so'm")}`;
                      return (
                        <Card key={key} size="small" style={{ marginBottom: 12 }}>
                          <Row gutter={12} align="bottom">
                            <Col xs={24} md={9}>
                              <Form.Item
                                name={[name, 'productId']}
                                label={t('Mahsulot')}
                                rules={[{ required: true, message: t('Mahsulotni tanlang') }]}
                                style={{ marginBottom: 8 }}
                              >
                                <Select
                                  showSearch
                                  optionFilterProp="label"
                                  placeholder={t('Mahsulot')}
                                  loading={productsQ.isFetching}
                                  notFoundContent={selectError(productsQ)}
                                  options={productOptions}
                                />
                              </Form.Item>
                            </Col>
                            <Col xs={12} md={4}>
                              <Form.Item name={[name, 'palletCount']} label={t('Pallet')} style={{ marginBottom: 8 }}>
                                <InputNumber min={0} className="num" style={{ width: '100%' }} />
                              </Form.Item>
                            </Col>
                            <Col xs={12} md={4}>
                              <Form.Item name={[name, 'quantityM3']} label={t('Hajm (m³)')} style={{ marginBottom: 8 }}>
                                <InputNumber min={0} step={0.001} className="num" style={{ width: '100%' }} />
                              </Form.Item>
                            </Col>
                            <Col xs={18} md={6}>
                              <Form.Item label={t('Taxminiy')} style={{ marginBottom: 8 }}>
                                {/* R12: telefonda summa kesilmasin — title tooltipi barmoqqa yo'q,
                                    shuning uchun matn o'raladi va to'liq ko'rinadi */}
                                <div
                                  className="num"
                                  title={estText}
                                  style={{
                                    lineHeight: isPhone ? 1.4 : '32px',
                                    minHeight: isPhone ? 32 : undefined,
                                    color: token.colorTextSecondary,
                                    whiteSpace: isPhone ? 'normal' : 'nowrap',
                                    overflow: isPhone ? undefined : 'hidden',
                                    textOverflow: isPhone ? undefined : 'ellipsis',
                                  }}
                                >
                                  {estText}
                                </div>
                              </Form.Item>
                            </Col>
                            <Col xs={6} md={1}>
                              <Form.Item
                                label={<span style={{ opacity: 0 }}>·</span>}
                                style={{ marginBottom: 8 }}
                              >
                                <Button
                                  type="text"
                                  danger
                                  icon={<DeleteOutlined />}
                                  title={t("O'chirish")}
                                  aria-label={t("O'chirish")}
                                  disabled={fields.length <= 1}
                                  onClick={() => remove(name)}
                                />
                              </Form.Item>
                            </Col>
                          </Row>
                          <div
                            style={{
                              display: 'flex',
                              flexWrap: 'wrap',
                              alignItems: 'center',
                              gap: isPhone ? 8 : 12,
                              marginTop: 4,
                            }}
                          >
                            {/* Narx rejimi: desktopda segmentli tugmalar. Telefonda 3–4 ta
                                uzun o'zbekcha yorliq gorizontal sig'maydi (320px da ~400px
                                kenglik) — shuning uchun bir xil qiymatli Select. */}
                            <Form.Item
                              name={[name, 'pricingMode']}
                              style={{ marginBottom: 0, ...(isPhone ? { width: '100%' } : null) }}
                            >
                              {isPhone ? (
                                <Select
                                  style={{ width: '100%' }}
                                  options={pricingOptions.map((o) => ({ value: o.value, label: t(o.label) }))}
                                />
                              ) : (
                                <Radio.Group optionType="button" size="small" options={pricingOptions.map((o) => ({ ...o, label: t(o.label) }))} />
                              )}
                            </Form.Item>
                            {pm === 'NEGOTIATED' && (
                              <Form.Item
                                name={[name, 'salePricePerM3']}
                                rules={[{ required: true, message: t('Narx kiriting') }]}
                                style={{ marginBottom: 0, width: isPhone ? '100%' : 220, maxWidth: '100%' }}
                              >
                                <InputNumber
                                  min={0}
                                  className="num"
                                  style={{ width: '100%' }}
                                  placeholder={t("Narx (1 m³, so'm)")}
                                  formatter={moneyFormatter}
                                  parser={moneyParser}
                                />
                              </Form.Item>
                            )}
                            {pm === 'LUMP' && (
                              <Form.Item
                                name={[name, 'saleLumpSum']}
                                rules={[{ required: true, message: t('Summani kiriting') }]}
                                style={{ marginBottom: 0, width: isPhone ? '100%' : 220, maxWidth: '100%' }}
                              >
                                <InputNumber
                                  min={0}
                                  className="num"
                                  style={{ width: '100%' }}
                                  placeholder={t("Umumiy summa (so'm)")}
                                  formatter={moneyFormatter}
                                  parser={moneyParser}
                                />
                              </Form.Item>
                            )}
                            {/* R6: flex bolasi matn ushlaydi — minWidth:0 bo'lmasa qator qisqara olmaydi */}
                            {pm === 'CATALOG' && (
                              <Typography.Text type="secondary" style={{ minWidth: 0 }}>
                                {catalogPrice
                                  ? t('Katalog: {price} / m³', { price: fmtUZS(catalogPrice) })
                                  : prod
                                    ? t('Katalog narxi topilmadi — server aniqlaydi')
                                    : ''}
                              </Typography.Text>
                            )}
                            {pm === 'PENDING' && <Tag color="gold">{t('Narx keyinroq belgilanadi')}</Tag>}
                          </div>
                        </Card>
                      );
                    })}
                    <Form.ErrorList errors={errors} />
                    <Button
                      type="dashed"
                      block
                      icon={<PlusOutlined />}
                      onClick={() => add({ pricingMode: defaultPricingMode })}
                    >
                      {t("Mahsulot qo'shish")}
                    </Button>
                  </>
                )}
              </Form.List>

              {calc.factoryCount > 1 && (
                <Alert
                  type="error"
                  showIcon
                  style={{ marginTop: 12 }}
                  message={t("Bitta buyurtmadagi barcha mahsulotlar bitta zavodga tegishli bo'lishi kerak")}
                />
              )}

              <div style={overlineStyle(token.colorTextTertiary, isPhone)}>{t('Transport')}</div>

              <Form.Item name="vehicleAdHoc" valuePropName="checked" style={{ marginBottom: 8 }}>
                <Checkbox>{t("Bir martalik moshina (ro'yxatga saqlanmaydi, faqat shu buyurtma uchun)")}</Checkbox>
              </Form.Item>

              {!wAdHoc ? (
                <Row gutter={12}>
                  <Col xs={24} md={12}>
                    <Form.Item name="vehicleId" label={t('Moshina')}>
                      <Select
                        allowClear
                        showSearch
                        optionFilterProp="label"
                        placeholder={t('Moshina tanlang')}
                        loading={vehiclesQ.isFetching}
                        notFoundContent={selectError(vehiclesQ)}
                        options={vehicles.map((v) => ({
                          value: v.id,
                          label: `${v.name}${v.plate ? ` (${v.plate})` : ''} — ${v.capacityPallets} ${t('pallet')}${v.driver ? ` — ${v.driver}` : ''}`,
                        }))}
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item name="driverName" label={t('Haydovchi')}>
                      <Input placeholder={t('Haydovchi ismi')} maxLength={200} />
                    </Form.Item>
                  </Col>
                </Row>
              ) : (
                <Row gutter={12}>
                  <Col xs={24} md={8}>
                    <Form.Item
                      name={['oneTimeVehicle', 'name']}
                      label={t('Moshina nomi/turi')}
                      rules={[{ required: true, message: t('Moshina nomini kiriting') }]}
                    >
                      <Input placeholder={t('masalan: Isuzu / yuk moshinasi')} maxLength={200} />
                    </Form.Item>
                  </Col>
                  <Col xs={12} md={5}>
                    <Form.Item name={['oneTimeVehicle', 'plate']} label={t('Davlat raqami')}>
                      <Input placeholder="95 A 123 BC" maxLength={50} />
                    </Form.Item>
                  </Col>
                  <Col xs={12} md={6}>
                    <Form.Item name={['oneTimeVehicle', 'driver']} label={t('Haydovchi')}>
                      <Input placeholder={t('Haydovchi ismi')} maxLength={200} />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={5}>
                    <Form.Item name={['oneTimeVehicle', 'phone']} label={t('Telefon')}>
                      <Input placeholder="+998…" maxLength={50} />
                    </Form.Item>
                  </Col>
                </Row>
              )}

              {capacityExceeded && (
                <Alert
                  type="warning"
                  showIcon
                  style={{ marginBottom: 12 }}
                  message={t("Moshina sig'imi oshib ketdi: {pallets} > {capacity} pallet{extra} — server buyurtmani rad etadi", {
                    pallets: calc.pallets,
                    capacity,
                    extra: selectedVehicle ? '' : ` ${t('(standart sig’im)')}`,
                  })}
                />
              )}

              <Form.Item
                name="transportMode"
                label={t('Transport turi')}
                extra={t(TRANSPORT_OPTIONS.find((o) => o.value === wTransportMode)?.hint ?? '')}
              >
                {/* Uchta uzun yorliq bitta gorizontal segmentda ~600px joy oladi —
                    telefonda gorizontal skroll chiqadi. Shuning uchun tik radio ro'yxati. */}
                <Radio.Group
                  optionType={isPhone ? 'default' : 'button'}
                  style={isPhone ? { display: 'flex', flexDirection: 'column', gap: 8 } : undefined}
                  options={TRANSPORT_OPTIONS.map((o) => ({ value: o.value, label: t(o.label) }))}
                />
              </Form.Item>

              {wTransportMode !== 'CLIENT_OWN' && (
                <Row gutter={12}>
                  <Col xs={24} md={10}>
                    <Form.Item name="transportCost" label={t("Transport puli (shofyorga, so'm)")}>
                      <InputNumber
                        min={0}
                        className="num"
                        style={{ width: '100%' }}
                        formatter={moneyFormatter}
                        parser={moneyParser}
                      />
                    </Form.Item>
                  </Col>
                  {/* The money split, shown where the number is typed — this is the thing
                      the owner asked to see: goods − transport = what reaches the dealer. */}
                  {transportCost > 0 && calc.sale > 0 && (
                    <Col xs={24} md={14}>
                      <div
                        style={{
                          background: token.colorFillQuaternary,
                          borderRadius: token.borderRadius,
                          padding: '10px 14px',
                        }}
                      >
                        <Row justify="space-between">
                          <Typography.Text type="secondary">{t('Mahsulot summasi')}</Typography.Text>
                          <Money value={calc.sale} suffix={t("so'm")} />
                        </Row>
                        <Row justify="space-between">
                          <Typography.Text type="secondary">
                            {clientPaysDriver ? t('Shofyorga (mijoz beradi)') : t('Shofyorga (diller beradi)')}
                          </Typography.Text>
                          <Money value={-transportCost} signed suffix={t("so'm")} />
                        </Row>
                        <Divider style={{ margin: '6px 0' }} />
                        {/* The subtraction above always lands on what the DEALER keeps —
                            true in both modes. When the client pays the driver himself the
                            cash he hands the dealer happens to equal it; when the dealer
                            pays, the client still hands over the full sum, so that is
                            spelled out separately rather than folded into one line. */}
                        <Row justify="space-between">
                          <Typography.Text strong>{t('Dillerda qoladi')}</Typography.Text>
                          <Money value={dealerKeeps} strong suffix={t("so'm")} />
                        </Row>
                        <Row justify="space-between">
                          <Typography.Text type="secondary">
                            {clientPaysDriver ? t('Mijoz dillerga beradi') : t('Mijoz dillerga beradi (to‘liq)')}
                          </Typography.Text>
                          <Money value={clientHandsDealer} suffix={t("so'm")} />
                        </Row>
                      </div>
                    </Col>
                  )}
                </Row>
              )}

              {transportOverruns && (
                <Alert
                  type="warning"
                  showIcon
                  style={{ marginBottom: 16 }}
                  message={t('Transport puli mahsulot summasidan katta — dillerga hech narsa qolmaydi')}
                />
              )}

              <Form.Item name="note" label={t('Izoh')}>
                <Input.TextArea rows={2} maxLength={2000} placeholder={t("Qo'shimcha izoh (ixtiyoriy)")} />
              </Form.Item>

              {/* Telefonda tugmalar to'liq kenglikda va tik joylashadi (asosiysi tepada) —
                  uzun o'zbekcha yorliqlar kesilmasin, bosh barmoq bilan yetib borilsin. */}
              <Space
                orientation={isPhone ? 'vertical' : 'horizontal'}
                style={isPhone ? { width: '100%' } : undefined}
              >
                <Button
                  type="primary"
                  htmlType="submit"
                  icon={<SaveOutlined />}
                  loading={createM.isPending}
                  block={isPhone}
                >
                  {t('Buyurtma yaratish')}
                </Button>
                <Button block={isPhone} onClick={() => navigate('/orders')}>
                  {t('Bekor qilish')}
                </Button>
              </Space>
            </Form>
          </Card>
        </Col>

        <Col xs={24} lg={8}>
          {/* R9: sticky faqat desktopda. lg dan pastda «Xulosa» formadan keyin to'liq
              kenglikda oqadi — sticky bo'lsa uzun kartaning pastki yarmi skroll
              qilinmay qolib ketardi. */}
          <div style={isDesktop ? { position: 'sticky', top: TOPBAR_H + 16 } : undefined}>
          {/* lg dan pastda «Xulosa» formadan keyin keladi — Row gutter'i vertikal
              bo'shliq bermaydi, shuning uchun karta formaga yopishib qolmasin */}
          <Card title={t('Xulosa')} size="small" style={isDesktop ? undefined : { marginTop: 12 }}>
            <Space orientation="vertical" style={{ width: '100%' }} size={8}>
              <Row justify="space-between">
                <Typography.Text type="secondary">{t('Pallet jami')}</Typography.Text>
                <Typography.Text
                  strong
                  className="num"
                  style={{ color: capacityExceeded ? token.colorError : undefined }}
                >
                  {calc.pallets} / {capacity}
                </Typography.Text>
              </Row>
              <Row justify="space-between">
                <Typography.Text type="secondary">{t('Hajm jami')}</Typography.Text>
                <Typography.Text strong className="num">
                  {fmtM3(calc.m3)}
                </Typography.Text>
              </Row>
              <Row justify="space-between">
                <Typography.Text type="secondary">{t('Tovar summasi (taxminiy)')}</Typography.Text>
                <Money value={calc.sale} strong suffix={t("so'm")} />
              </Row>
              {/* .ant-tag nowrap — bu uzun yorliq 320px kartadan chiqib ketardi */}
              {calc.hasPending && (
                <Tag color="gold" style={isPhone ? { whiteSpace: 'normal', maxWidth: '100%' } : undefined}>
                  {t('Narxsiz pozitsiyalar bor — summaga kirmagan')}
                </Tag>
              )}
              {wTransportMode !== 'CLIENT_OWN' && (
                <Row justify="space-between">
                  <Typography.Text type="secondary">
                    {clientPaysDriver ? t('Shofyorga (mijoz beradi)') : t('Shofyorga (diller beradi)')}
                  </Typography.Text>
                  <Money value={transportCost} suffix={t("so'm")} />
                </Row>
              )}
              <Divider style={{ margin: '8px 0' }} />
              <Row justify="space-between">
                <Typography.Text type="secondary">{t('Mijoz qarziga yoziladi')}</Typography.Text>
                <Money value={exposure} strong suffix={t("so'm")} />
              </Row>
              {/* Transport is inside the debt, so the debt alone hides where the cash goes.
                  Spell out the two envelopes the client will actually hand over. */}
              {clientPaysDriver && transportCost > 0 && (
                <>
                  <Row justify="space-between">
                    <Typography.Text type="secondary">{t('— shundan shofyorga')}</Typography.Text>
                    <Money value={transportCost} suffix={t("so'm")} />
                  </Row>
                  <Row justify="space-between">
                    <Typography.Text type="secondary">{t('— shundan dillerga')}</Typography.Text>
                    <Money value={clientHandsDealer} strong suffix={t("so'm")} />
                  </Row>
                </>
              )}
              {selectedClient && (
                <Row justify="space-between">
                  <Typography.Text type="secondary">{t('Mijozning joriy balansi')}</Typography.Text>
                  <Money value={selectedClient.balance} signed suffix={t("so'm")} />
                </Row>
              )}
              {showProfit && (
                <>
                  <Divider style={{ margin: '8px 0' }} />
                  <Row justify="space-between">
                    <Typography.Text type="secondary">{t('Taxminiy zavod tannarxi')}</Typography.Text>
                    <Money value={calc.factoryCost} suffix={t("so'm")} />
                  </Row>
                  <Row justify="space-between">
                    <Typography.Text strong>{t('Taxminiy diller foydasi')}</Typography.Text>
                    <Money value={dealerProfit} signed strong suffix={t("so'm")} />
                  </Row>
                  {!calc.costKnown && (
                    <Typography.Text type="warning" style={{ fontSize: 12 }}>
                      {t("Ba'zi mahsulotlarda zavod narxi yo'q — foyda taxminiy")}
                    </Typography.Text>
                  )}
                </>
              )}
              {creditRisk && (
                <Alert
                  type="warning"
                  showIcon
                  message={t('Kredit limiti oshishi mumkin (limit: {limit}) — server tekshiradi', { limit: fmtUZS(selectedClient?.creditLimit) })}
                />
              )}
            </Space>
          </Card>
          </div>
        </Col>
      </Row>
    </div>
  );
}
