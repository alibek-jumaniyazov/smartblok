import { useMemo, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Card,
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
import { Money } from '../components/Money';
import { PageHeader } from '../components/PageHeader';
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

interface FormValues {
  clientId?: string;
  date: Dayjs;
  vehicleId?: string;
  driverName?: string;
  transportMode: TransportMode;
  transportCost?: number;
  transportCharge?: number;
  intendedPaymentMethod: 'CASH' | 'BANK';
  note?: string;
  items: ItemFormValue[];
}

const TRANSPORT_OPTIONS: { value: TransportMode; label: string }[] = [
  { value: 'CLIENT_OWN', label: "Mijozning o'z transporti" },
  { value: 'DEALER_ABSORBED', label: 'Dilerning hisobidan' },
  { value: 'DEALER_CHARGED', label: 'Mijozdan olinadi' },
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
      message="Yuklashda xatolik"
      action={
        <Button size="small" onClick={() => void q.refetch()}>
          Qayta urinish
        </Button>
      }
    />
  );
}

/** small section overline (uppercase tertiary label) — replaces labelled Dividers */
const overlineStyle = (color: string): CSSProperties => ({
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '.04em',
  textTransform: 'uppercase',
  color,
  margin: '24px 0 12px',
});

export default function NewOrder() {
  const { message } = App.useApp();
  const { token } = theme.useToken();
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
    queryFn: () => endpoints.vehicles(),
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
      const factoryName = p.factoryName ?? p.factory?.name ?? 'Zavod';
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
  const wTransportCharge = Form.useWatch('transportCharge', form) as number | undefined;
  const wPayMethod = (Form.useWatch('intendedPaymentMethod', form) ?? 'BANK') as 'CASH' | 'BANK';

  const selectedClient = clients.find((c) => c.id === wClientId);
  const selectedVehicle = vehicles.find((v) => v.id === wVehicleId);
  const office = hasRole('ADMIN', 'ACCOUNTANT');

  const calc = useMemo(() => {
    let pallets = 0;
    let m3 = 0;
    let sale = 0;
    let factoryCost = 0;
    let costKnown = true; // office ko'radigan taxminiy tannarx to'liqmi
    let hasPending = false;
    const factoryIds = new Set<string>();
    const costKind = wPayMethod === 'CASH' ? 'FACTORY_CASH' : 'FACTORY_BANK';
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
  }, [wItems, productById, wPayMethod]);

  const capacity = selectedVehicle ? selectedVehicle.capacityPallets : DEFAULT_CAPACITY;
  const capacityExceeded = calc.pallets > capacity;
  const transportCharge = wTransportMode === 'DEALER_CHARGED' ? (wTransportCharge ?? 0) : 0;
  const transportCost = wTransportMode !== 'CLIENT_OWN' ? (wTransportCost ?? 0) : 0;
  const exposure = calc.sale + transportCharge;
  const creditRisk =
    selectedClient != null &&
    selectedClient.creditLimit != null &&
    num(selectedClient.balance) + exposure > num(selectedClient.creditLimit);

  // Taxminiy diller foydasi (faqat office ko'radi — agent zavod narxini ko'rmaydi).
  const goodsProfit = calc.sale - calc.factoryCost;
  const dealerProfit = goodsProfit + (transportCharge - transportCost);
  const showProfit = office && !calc.hasPending && calc.sale > 0;

  // ── submit ──
  const createM = useMutation({
    mutationFn: (payload: Record<string, unknown>) => endpoints.createOrder(payload),
    onSuccess: (order: Order) => {
      message.success(`Buyurtma ${order.orderNo} yaratildi`);
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
        setSubmitError(`${i + 1}-qator: pallet soni yoki hajm (m³) kiritilishi shart`);
        return;
      }
    }
    const mode = v.transportMode;
    const payload: Record<string, unknown> = {
      clientId: v.clientId,
      date: v.date.format('YYYY-MM-DD'),
      vehicleId: v.vehicleId || undefined,
      driverName: v.driverName?.trim() || undefined,
      transportMode: mode,
      transportCost: mode !== 'CLIENT_OWN' && v.transportCost != null ? v.transportCost : undefined,
      transportCharge: mode === 'DEALER_CHARGED' && v.transportCharge != null ? v.transportCharge : undefined,
      intendedPaymentMethod: v.intendedPaymentMethod,
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
          message="Ma'lumotlarni yuklashda xatolik"
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
              Qayta urinish
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
          message="Buyurtma yaratilmadi"
          description={submitError}
          onClose={() => setSubmitError(null)}
        />
      )}

      <Row gutter={16}>
        <Col xs={24} lg={16}>
          <Card>
            <Form
              form={form}
              layout="vertical"
              disabled={createM.isPending}
              onFinish={onFinish}
              onValuesChange={handleValuesChange}
              initialValues={{
                date: dayjs(),
                transportMode: 'DEALER_ABSORBED',
                intendedPaymentMethod: 'BANK',
                items: [{ pricingMode: 'CATALOG' }],
              }}
            >
              <Row gutter={12}>
                <Col xs={24} md={12}>
                  <Form.Item name="clientId" label="Mijoz" rules={[{ required: true, message: 'Mijozni tanlang' }]}>
                    <Select
                      showSearch
                      filterOption={false}
                      onSearch={setClientSearch}
                      loading={clientsQ.isFetching}
                      placeholder="Mijozni qidiring…"
                      notFoundContent={selectError(clientsQ)}
                      options={clients.map((c) => ({
                        value: c.id,
                        label: `${c.name} — balans ${fmtMoney(c.balance)}`,
                      }))}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={5}>
                  <Form.Item name="date" label="Sana" rules={[{ required: true, message: 'Sanani tanlang' }]}>
                    <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" allowClear={false} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={7}>
                  <Form.Item name="intendedPaymentMethod" label="Zavodga to'lov turi (taxminiy tannarx)">
                    <Radio.Group
                      optionType="button"
                      options={[
                        { value: 'BANK', label: "O'tkazma" },
                        { value: 'CASH', label: 'Naqd' },
                      ]}
                    />
                  </Form.Item>
                </Col>
              </Row>

              <div style={overlineStyle(token.colorTextTertiary)}>Mahsulotlar</div>

              <Form.List
                name="items"
                rules={[
                  {
                    validator: async (_, value: ItemFormValue[]) => {
                      if (!value || value.length < 1) throw new Error("Kamida bitta mahsulot qo'shing");
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
                      const estText = pm === 'PENDING' ? 'narxsiz' : `≈ ${fmtMoney(est)} so'm`;
                      return (
                        <Card key={key} size="small" style={{ marginBottom: 12 }}>
                          <Row gutter={12} align="bottom">
                            <Col xs={24} md={9}>
                              <Form.Item
                                name={[name, 'productId']}
                                label="Mahsulot"
                                rules={[{ required: true, message: 'Mahsulotni tanlang' }]}
                                style={{ marginBottom: 8 }}
                              >
                                <Select
                                  showSearch
                                  optionFilterProp="label"
                                  placeholder="Mahsulot"
                                  loading={productsQ.isFetching}
                                  notFoundContent={selectError(productsQ)}
                                  options={productOptions}
                                />
                              </Form.Item>
                            </Col>
                            <Col xs={12} md={4}>
                              <Form.Item name={[name, 'palletCount']} label="Pallet" style={{ marginBottom: 8 }}>
                                <InputNumber min={0} className="num" style={{ width: '100%' }} />
                              </Form.Item>
                            </Col>
                            <Col xs={12} md={4}>
                              <Form.Item name={[name, 'quantityM3']} label="Hajm (m³)" style={{ marginBottom: 8 }}>
                                <InputNumber min={0} step={0.001} className="num" style={{ width: '100%' }} />
                              </Form.Item>
                            </Col>
                            <Col xs={18} md={6}>
                              <Form.Item label="Taxminiy" style={{ marginBottom: 8 }}>
                                <div
                                  className="num"
                                  title={estText}
                                  style={{
                                    lineHeight: '32px',
                                    color: token.colorTextSecondary,
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
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
                                  title="O'chirish"
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
                              gap: 12,
                              marginTop: 4,
                            }}
                          >
                            <Form.Item name={[name, 'pricingMode']} style={{ marginBottom: 0 }}>
                              <Radio.Group optionType="button" size="small" options={pricingOptions} />
                            </Form.Item>
                            {pm === 'NEGOTIATED' && (
                              <Form.Item
                                name={[name, 'salePricePerM3']}
                                rules={[{ required: true, message: 'Narx kiriting' }]}
                                style={{ marginBottom: 0, width: 220, maxWidth: '100%' }}
                              >
                                <InputNumber
                                  min={0}
                                  className="num"
                                  style={{ width: '100%' }}
                                  placeholder="Narx (1 m³, so'm)"
                                  formatter={moneyFormatter}
                                  parser={moneyParser}
                                />
                              </Form.Item>
                            )}
                            {pm === 'LUMP' && (
                              <Form.Item
                                name={[name, 'saleLumpSum']}
                                rules={[{ required: true, message: 'Summani kiriting' }]}
                                style={{ marginBottom: 0, width: 220, maxWidth: '100%' }}
                              >
                                <InputNumber
                                  min={0}
                                  className="num"
                                  style={{ width: '100%' }}
                                  placeholder="Umumiy summa (so'm)"
                                  formatter={moneyFormatter}
                                  parser={moneyParser}
                                />
                              </Form.Item>
                            )}
                            {pm === 'CATALOG' && (
                              <Typography.Text type="secondary">
                                {catalogPrice
                                  ? `Katalog: ${fmtUZS(catalogPrice)} / m³`
                                  : prod
                                    ? 'Katalog narxi topilmadi — server aniqlaydi'
                                    : ''}
                              </Typography.Text>
                            )}
                            {pm === 'PENDING' && <Tag color="gold">Narx keyinroq belgilanadi</Tag>}
                          </div>
                        </Card>
                      );
                    })}
                    <Form.ErrorList errors={errors} />
                    <Button
                      type="dashed"
                      block
                      icon={<PlusOutlined />}
                      onClick={() => add({ pricingMode: 'CATALOG' })}
                    >
                      Mahsulot qo'shish
                    </Button>
                  </>
                )}
              </Form.List>

              {calc.factoryCount > 1 && (
                <Alert
                  type="error"
                  showIcon
                  style={{ marginTop: 12 }}
                  message="Bitta buyurtmadagi barcha mahsulotlar bitta zavodga tegishli bo'lishi kerak"
                />
              )}

              <div style={overlineStyle(token.colorTextTertiary)}>Transport</div>

              <Row gutter={12}>
                <Col xs={24} md={12}>
                  <Form.Item name="vehicleId" label="Moshina">
                    <Select
                      allowClear
                      showSearch
                      optionFilterProp="label"
                      placeholder="Moshina tanlang"
                      loading={vehiclesQ.isFetching}
                      notFoundContent={selectError(vehiclesQ)}
                      options={vehicles.map((v) => ({
                        value: v.id,
                        label: `${v.name}${v.plate ? ` (${v.plate})` : ''} — ${v.capacityPallets} pallet${v.driver ? ` — ${v.driver}` : ''}`,
                      }))}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item name="driverName" label="Haydovchi">
                    <Input placeholder="Haydovchi ismi" maxLength={200} />
                  </Form.Item>
                </Col>
              </Row>

              {capacityExceeded && (
                <Alert
                  type="warning"
                  showIcon
                  style={{ marginBottom: 12 }}
                  message={`Moshina sig'imi oshib ketdi: ${calc.pallets} > ${capacity} pallet${selectedVehicle ? '' : ' (standart sig’im)'} — server buyurtmani rad etadi`}
                />
              )}

              <Form.Item name="transportMode" label="Transport turi">
                <Radio.Group optionType="button" options={TRANSPORT_OPTIONS} />
              </Form.Item>

              {wTransportMode !== 'CLIENT_OWN' && (
                <Row gutter={12}>
                  <Col xs={24} md={8}>
                    <Form.Item name="transportCost" label="Transport xarajati (shofyorga, so'm)">
                      <InputNumber
                        min={0}
                        className="num"
                        style={{ width: '100%' }}
                        formatter={moneyFormatter}
                        parser={moneyParser}
                      />
                    </Form.Item>
                  </Col>
                  {wTransportMode === 'DEALER_CHARGED' && (
                    <>
                      <Col xs={24} md={8}>
                        <Form.Item name="transportCharge" label="Mijozdan olinadigan haq (so'm)">
                          <InputNumber
                            min={0}
                            className="num"
                            style={{ width: '100%' }}
                            formatter={moneyFormatter}
                            parser={moneyParser}
                          />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={8} style={{ display: 'flex', alignItems: 'center' }}>
                        <Space>
                          <Typography.Text type="secondary">Transport foydasi:</Typography.Text>
                          <Money value={transportCharge - transportCost} signed suffix="so'm" />
                        </Space>
                      </Col>
                    </>
                  )}
                </Row>
              )}

              <Form.Item name="note" label="Izoh">
                <Input.TextArea rows={2} maxLength={2000} placeholder="Qo'shimcha izoh (ixtiyoriy)" />
              </Form.Item>

              <Space>
                <Button
                  type="primary"
                  htmlType="submit"
                  icon={<SaveOutlined />}
                  loading={createM.isPending}
                >
                  Buyurtma yaratish
                </Button>
                <Button onClick={() => navigate('/orders')}>Bekor qilish</Button>
              </Space>
            </Form>
          </Card>
        </Col>

        <Col xs={24} lg={8}>
          <div style={{ position: 'sticky', top: 64 }}>
          <Card title="Xulosa" size="small">
            <Space orientation="vertical" style={{ width: '100%' }} size={8}>
              <Row justify="space-between">
                <Typography.Text type="secondary">Pallet jami</Typography.Text>
                <Typography.Text
                  strong
                  className="num"
                  style={{ color: capacityExceeded ? token.colorError : undefined }}
                >
                  {calc.pallets} / {capacity}
                </Typography.Text>
              </Row>
              <Row justify="space-between">
                <Typography.Text type="secondary">Hajm jami</Typography.Text>
                <Typography.Text strong className="num">
                  {fmtM3(calc.m3)}
                </Typography.Text>
              </Row>
              <Row justify="space-between">
                <Typography.Text type="secondary">Tovar summasi (taxminiy)</Typography.Text>
                <Money value={calc.sale} strong suffix="so'm" />
              </Row>
              {calc.hasPending && <Tag color="gold">Narxsiz pozitsiyalar bor — summaga kirmagan</Tag>}
              {wTransportMode !== 'CLIENT_OWN' && (
                <Row justify="space-between">
                  <Typography.Text type="secondary">Transport xarajati</Typography.Text>
                  <Money value={transportCost} suffix="so'm" />
                </Row>
              )}
              {wTransportMode === 'DEALER_CHARGED' && (
                <>
                  <Row justify="space-between">
                    <Typography.Text type="secondary">Mijozdan transport haqi</Typography.Text>
                    <Money value={transportCharge} suffix="so'm" />
                  </Row>
                  <Row justify="space-between">
                    <Typography.Text type="secondary">Transport foydasi</Typography.Text>
                    <Money value={transportCharge - transportCost} signed suffix="so'm" />
                  </Row>
                </>
              )}
              <Divider style={{ margin: '8px 0' }} />
              <Row justify="space-between">
                <Typography.Text type="secondary">Mijoz qarziga yoziladi</Typography.Text>
                <Money value={exposure} strong suffix="so'm" />
              </Row>
              {selectedClient && (
                <Row justify="space-between">
                  <Typography.Text type="secondary">Mijozning joriy balansi</Typography.Text>
                  <Money value={selectedClient.balance} signed suffix="so'm" />
                </Row>
              )}
              {showProfit && (
                <>
                  <Divider style={{ margin: '8px 0' }} />
                  <Row justify="space-between">
                    <Typography.Text type="secondary">Taxminiy zavod tannarxi</Typography.Text>
                    <Money value={calc.factoryCost} suffix="so'm" />
                  </Row>
                  <Row justify="space-between">
                    <Typography.Text strong>Taxminiy diller foydasi</Typography.Text>
                    <Money value={dealerProfit} signed strong suffix="so'm" />
                  </Row>
                  {!calc.costKnown && (
                    <Typography.Text type="warning" style={{ fontSize: 12 }}>
                      Ba'zi mahsulotlarda zavod narxi yo'q — foyda taxminiy
                    </Typography.Text>
                  )}
                </>
              )}
              {creditRisk && (
                <Alert
                  type="warning"
                  showIcon
                  message={`Kredit limiti oshishi mumkin (limit: ${fmtUZS(selectedClient?.creditLimit)}) — server tekshiradi`}
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
