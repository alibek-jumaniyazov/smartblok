import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Col,
  DatePicker,
  Divider,
  Drawer,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Switch,
  Table,
  theme,
} from 'antd';
import type { InputRef, TableColumnsType } from 'antd';
import { DollarOutlined, EditOutlined, PlusOutlined, SearchOutlined, StopOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Dayjs } from 'dayjs';
import { apiError, asItems, endpoints } from '../lib/api';
import { fmtDateTime, fmtNum } from '../lib/format';
import {
  DataTable,
  FormDrawer,
  MoneyCell,
  StatusChip,
  TableCard,
  type SbColumn,
} from '../components';
import { PageHeader } from '../components/PageHeader';
import { useAuth } from '../auth/AuthContext';
import { useUrlFilters } from '../lib/useUrlFilters';
import type { StatusMeta } from '../lib/status-maps';
import type { Factory, Paged, PriceKind } from '../lib/types';

const PRICE_KIND: Record<PriceKind, string> = {
  FACTORY_CASH: 'Zavod naqd narxi',
  FACTORY_BANK: "Zavod o'tkazma narxi",
  DEALER_SALE: 'Sotish narxi',
};

/** Faol / Nofaol active flag — success ink for live, neutral ink for archived. */
const ACTIVE_META: Record<'active' | 'inactive', StatusMeta> = {
  active: { label: 'Faol', light: '#1A7F37', dark: '#6CC495' },
  inactive: { label: 'Nofaol', light: '#64748B', dark: '#94A3B8' },
};

/** list shape from ProductsService.findAll — current price per kind */
interface ProductRow {
  id: string;
  factoryId: string;
  factoryName: string;
  name: string;
  size: string | null;
  m3PerPallet: string;
  blocksPerPallet: number | null;
  unit: string;
  active: boolean;
  prices: Partial<Record<PriceKind, { pricePerM3: string; effectiveFrom: string }>>;
}

interface PriceHistoryRow {
  id: string;
  kind: PriceKind;
  pricePerM3: string;
  effectiveFrom: string;
  createdAt?: string;
}

interface ProductFormValues {
  factoryId: string;
  name: string;
  size?: string;
  m3PerPallet: number;
  blocksPerPallet?: number;
  unit?: string;
  active?: boolean;
  // faqat yaratishda — boshlang'ich 3 narx
  priceDealerSale?: number;
  priceFactoryCash?: number;
  priceFactoryBank?: number;
}

interface PriceFormValues {
  kind: PriceKind;
  pricePerM3: number;
  effectiveFrom?: Dayjs;
}

const moneyFmt = (v: string | number | undefined) =>
  `${v ?? ''}`.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const moneyParse = (v: string | undefined) => (v ? v.replace(/\s/g, '') : '') as unknown as number;

export default function Products() {
  const { token } = theme.useToken();
  const { message, modal } = App.useApp();
  const { hasRole } = useAuth();
  const qc = useQueryClient();
  const canEdit = hasRole('ADMIN', 'ACCOUNTANT');
  const canSeeCost = hasRole('ADMIN', 'ACCOUNTANT');

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ProductRow | null>(null);
  const [priceProduct, setPriceProduct] = useState<ProductRow | null>(null);
  const [form] = Form.useForm<ProductFormValues>();
  const [priceForm] = Form.useForm<PriceFormValues>();

  const uf = useUrlFilters(['search', 'factoryId']);
  const page = Number(uf.get('page')) || 1;
  const pageSize = Number(uf.get('pageSize')) || 20;
  const search = uf.get('search') || undefined;
  const factoryId = uf.get('factoryId') || undefined;
  // Qidiruv matni lokal — «Qidirish» tugmasi/Enter bosilganda URL'ga yoziladi
  // (har harfda emas). URL tashqaridan o'zgarsa (orqaga tugmasi) sinxron.
  const [searchInput, setSearchInput] = useState(uf.get('search'));
  useEffect(() => {
    setSearchInput(uf.get('search'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const applySearch = () => uf.set({ search: searchInput.trim() || null });
  const clearFilters = () => {
    setSearchInput('');
    uf.clear(['search', 'factoryId']);
  };
  const anyFilter = !!search || !!factoryId;

  // '/' — qidiruv maydoniga fokus (boshqa list page'lardagi konventsiya)
  const searchRef = useRef<InputRef>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.key !== '/') return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // server-tomon qidiruv (name contains) + sahifalash + factoryId filtri — backend
  // hammasini qo'llaydi (products.service.ts findAll). Klient-tomon filtr XATO edi:
  // backend javobni pageSize (default) bilan kesardi, 50+ mahsulot ko'rinmasdi.
  const listQ = useQuery({
    queryKey: ['products', 'list', { page, pageSize, search, factoryId }],
    queryFn: async () =>
      (await endpoints.products({ factoryId, page, pageSize, search })) as unknown as Paged<ProductRow>,
    placeholderData: (prev) => prev,
  });

  const factoriesQ = useQuery({
    queryKey: ['factories'],
    queryFn: () => endpoints.factories(),
  });
  const factories = asItems(factoriesQ.data) as Factory[];

  const pricesQ = useQuery({
    queryKey: ['products', priceProduct?.id, 'prices'],
    queryFn: async () => (await endpoints.productPrices(priceProduct!.id)) as PriceHistoryRow[],
    enabled: !!priceProduct,
  });

  const save = useMutation({
    mutationFn: async (vals: ProductFormValues) => {
      if (editing) {
        // factoryId is immutable server-side; prices are versioned, not overwritten →
        // send the basic fields to updateProduct, then post a NEW price version for each
        // price that actually changed (unchanged prices are skipped — no dead versions).
        const { factoryId: _omit, priceDealerSale, priceFactoryCash, priceFactoryBank, ...rest } = vals;
        await endpoints.updateProduct(editing.id, rest);
        const cur = editing.prices;
        const changed: { kind: PriceKind; pricePerM3: number }[] = [];
        const diff = (kind: PriceKind, val?: number) => {
          if (val == null) return;
          const curVal = cur[kind] ? Number(cur[kind]!.pricePerM3) : undefined;
          if (curVal !== val) changed.push({ kind, pricePerM3: val });
        };
        diff('DEALER_SALE', priceDealerSale);
        diff('FACTORY_CASH', priceFactoryCash);
        diff('FACTORY_BANK', priceFactoryBank);
        for (const c of changed) {
          await endpoints.addProductPrice(editing.id, { kind: c.kind, pricePerM3: c.pricePerM3 });
        }
        return;
      }
      return endpoints.createProduct(vals);
    },
    onSuccess: () => {
      message.success(editing ? 'Mahsulot yangilandi' : 'Mahsulot yaratildi');
      qc.invalidateQueries({ queryKey: ['products'] });
      setModalOpen(false);
    },
    onError: (e) => message.error(apiError(e)),
  });

  const deactivate = useMutation({
    mutationFn: (id: string) => endpoints.deleteProduct(id),
    onSuccess: () => {
      message.success('Mahsulot nofaol qilindi');
      qc.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (e) => message.error(apiError(e)),
  });

  const addPrice = useMutation({
    mutationFn: (vals: PriceFormValues) =>
      endpoints.addProductPrice(priceProduct!.id, {
        kind: vals.kind,
        pricePerM3: vals.pricePerM3,
        ...(vals.effectiveFrom ? { effectiveFrom: vals.effectiveFrom.format('YYYY-MM-DD') } : {}),
      }),
    onSuccess: () => {
      message.success('Yangi narx kiritildi');
      qc.invalidateQueries({ queryKey: ['products'] });
      priceForm.resetFields();
    },
    onError: (e) => message.error(apiError(e)),
  });

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ unit: 'm³' });
    setModalOpen(true);
  };
  const openEdit = (row: ProductRow) => {
    setEditing(row);
    form.resetFields();
    form.setFieldsValue({
      factoryId: row.factoryId,
      name: row.name,
      size: row.size ?? '',
      m3PerPallet: Number(row.m3PerPallet),
      blocksPerPallet: row.blocksPerPallet ?? undefined,
      unit: row.unit,
      active: row.active,
      // load CURRENT prices so they can be edited inline (changed ones post a new version)
      priceDealerSale: row.prices.DEALER_SALE ? Number(row.prices.DEALER_SALE.pricePerM3) : undefined,
      priceFactoryCash: row.prices.FACTORY_CASH ? Number(row.prices.FACTORY_CASH.pricePerM3) : undefined,
      priceFactoryBank: row.prices.FACTORY_BANK ? Number(row.prices.FACTORY_BANK.pricePerM3) : undefined,
    });
    setModalOpen(true);
  };

  const confirmDeactivate = (row: ProductRow) => {
    modal.confirm({
      title: 'Mahsulotni nofaol qilish',
      content: `"${row.name}" nofaol qilinadi — yangi buyurtmalarda ko'rinmaydi, tarix saqlanadi.`,
      okText: 'Nofaol qilish',
      okButtonProps: { danger: true },
      cancelText: 'Bekor qilish',
      onOk: () => deactivate.mutateAsync(row.id),
    });
  };

  const columns: SbColumn<ProductRow>[] = [
    { title: 'Nomi', dataIndex: 'name', key: 'name', width: 220, ellipsis: true },
    { title: "O'lchami", dataIndex: 'size', key: 'size', width: 150, ellipsis: true, render: (v: string | null) => v || '—' },
    { title: 'Zavod', dataIndex: 'factoryName', key: 'factoryName', width: 180, ellipsis: true },
    {
      title: 'm³ / paddon',
      dataIndex: 'm3PerPallet',
      key: 'm3PerPallet',
      align: 'right',
      className: 'num',
      render: (v: string) => fmtNum(v, 3),
    },
    {
      title: 'Blok / paddon',
      dataIndex: 'blocksPerPallet',
      key: 'blocksPerPallet',
      align: 'right',
      className: 'num',
      render: (v: number | null) => (v != null ? fmtNum(v) : '—'),
    },
    {
      title: PRICE_KIND.DEALER_SALE,
      key: 'dealerSale',
      align: 'right',
      className: 'num',
      render: (_: unknown, r) =>
        r.prices.DEALER_SALE ? <MoneyCell value={r.prices.DEALER_SALE.pricePerM3} strong /> : '—',
    },
    ...(canSeeCost
      ? ([
          {
            title: PRICE_KIND.FACTORY_CASH,
            key: 'factoryCash',
            align: 'right',
            className: 'num',
            render: (_: unknown, r: ProductRow) =>
              r.prices.FACTORY_CASH ? <MoneyCell value={r.prices.FACTORY_CASH.pricePerM3} /> : '—',
          },
          {
            title: PRICE_KIND.FACTORY_BANK,
            key: 'factoryBank',
            align: 'right',
            className: 'num',
            render: (_: unknown, r: ProductRow) =>
              r.prices.FACTORY_BANK ? <MoneyCell value={r.prices.FACTORY_BANK.pricePerM3} /> : '—',
          },
        ] as SbColumn<ProductRow>[])
      : []),
    {
      title: 'Holat',
      dataIndex: 'active',
      key: 'active',
      render: (v: boolean) => <StatusChip meta={v ? ACTIVE_META.active : ACTIVE_META.inactive} />,
    },
    ...(canEdit
      ? ([
          {
            title: 'Amallar',
            key: 'actions',
            width: 190,
            render: (_: unknown, row: ProductRow) => (
              <Space>
                <Button size="small" icon={<DollarOutlined />} onClick={() => setPriceProduct(row)}>
                  Narxlar
                </Button>
                <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(row)} />
                {row.active && (
                  <Button size="small" danger icon={<StopOutlined />} onClick={() => confirmDeactivate(row)} />
                )}
              </Space>
            ),
          },
        ] as SbColumn<ProductRow>[])
      : []),
  ];

  const priceHistoryCols: TableColumnsType<PriceHistoryRow> = [
    { title: 'Turi', dataIndex: 'kind', key: 'kind', render: (v: PriceKind) => PRICE_KIND[v] ?? v },
    {
      title: 'Narx (so\'m / m³)',
      dataIndex: 'pricePerM3',
      key: 'pricePerM3',
      align: 'right',
      className: 'num',
      render: (v: string) => fmtNum(v, 6),
    },
    {
      title: 'Kuchga kirgan',
      dataIndex: 'effectiveFrom',
      key: 'effectiveFrom',
      render: (v: string) => fmtDateTime(v),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Mahsulotlar"
        subtitle="Mahsulotlar ro'yxati — zavod, o'lchami va narxlar"
        accent
        actions={canEdit ? [{ key: 'new', label: 'Yangi mahsulot', primary: true, icon: <PlusOutlined />, onClick: openCreate }] : []}
      />

      {/* Filtrlar — buissnes_crm uslubida alohida karta: qidiruv + zavod + amallar */}
      <div className="sb-table-card" style={{ padding: '14px 16px', marginBottom: 16 }}>
        <div className="sb-filterbar">
          <Input
            ref={searchRef}
            allowClear
            prefix={<SearchOutlined style={{ color: token.colorTextTertiary }} />}
            placeholder="Mahsulot nomi"
            value={searchInput}
            onChange={(e) => {
              const v = e.target.value;
              setSearchInput(v);
              if (v === '') uf.set({ search: null });
            }}
            onPressEnter={applySearch}
            style={{ width: 260 }}
          />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="Zavod"
            value={factoryId}
            onChange={(v?: string) => uf.set({ factoryId: v || null })}
            options={factories.map((f) => ({ value: f.id, label: f.name }))}
            style={{ minWidth: 200 }}
          />
          <Button type="primary" icon={<SearchOutlined />} onClick={applySearch}>
            Qidirish
          </Button>
          <Button onClick={clearFilters} disabled={!anyFilter}>
            Tozalash
          </Button>
          <span className="num" style={{ marginInlineStart: 'auto', color: token.colorTextSecondary, fontSize: 13 }}>
            {fmtNum(listQ.data?.total ?? 0)} ta
          </span>
        </div>
      </div>

      <TableCard>
        <DataTable<ProductRow>
          rowKey="id"
          columns={columns}
          query={listQ}
          emptyText="Hozircha mahsulot yo'q"
          scroll={{ x: 'max-content' }}
        />
      </TableCard>

      <FormDrawer
        open={modalOpen}
        title={editing ? 'Mahsulotni tahrirlash' : 'Yangi mahsulot'}
        onClose={() => setModalOpen(false)}
        onSubmit={() => form.validateFields().then((vals) => save.mutate(vals))}
        submitting={save.isPending}
        width={480}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="factoryId"
            label="Zavod"
            rules={[{ required: true, message: 'Zavodni tanlang' }]}
            extra={editing ? "Zavodni o'zgartirib bo'lmaydi — eski buyurtmalar buziladi" : undefined}
          >
            <Select
              disabled={!!editing}
              placeholder="Zavodni tanlang"
              options={factories.map((f) => ({ value: f.id, label: f.name }))}
            />
          </Form.Item>
          <Form.Item name="name" label="Nomi" rules={[{ required: true, message: 'Nomi majburiy' }, { max: 200 }]}>
            <Input placeholder="masalan Gazoblok D500" />
          </Form.Item>
          <Form.Item name="size" label="O'lchami" rules={[{ max: 100 }]}>
            <Input placeholder="masalan 600×300×200" />
          </Form.Item>
          <Form.Item
            name="m3PerPallet"
            label="Hajmi (m³ / paddon)"
            rules={[{ required: true, message: 'm³ / paddon majburiy' }]}
          >
            <InputNumber min={0.001} step={0.001} style={{ width: '100%' }} placeholder="masalan 1.728" />
          </Form.Item>
          <Form.Item name="blocksPerPallet" label="Bloklar soni (paddonda)">
            <InputNumber min={1} precision={0} style={{ width: '100%' }} placeholder="masalan 48" />
          </Form.Item>
          <Form.Item name="unit" label="O'lchov birligi" rules={[{ max: 20 }]}>
            <Input placeholder="m³" />
          </Form.Item>
          {editing && (
            <Form.Item name="active" label="Faol" valuePropName="checked">
              <Switch />
            </Form.Item>
          )}
          <Divider style={{ margin: '4px 0 14px' }} plain>
            Narxlar (so'm / m³){editing ? '' : ' — ixtiyoriy'}
          </Divider>
          <Form.Item
            name="priceDealerSale"
            label="Sotish narxi (mijozga)"
            extra={editing ? "O'zgartirilsa yangi narx versiyasi yoziladi (eski buyurtmalar buzilmaydi)" : undefined}
          >
            <InputNumber min={0} style={{ width: '100%' }} formatter={moneyFmt} parser={moneyParse} placeholder="masalan 350000" />
          </Form.Item>
          <Form.Item name="priceFactoryCash" label="Zavod naqd narxi">
            <InputNumber min={0} style={{ width: '100%' }} formatter={moneyFmt} parser={moneyParse} placeholder="masalan 300000" />
          </Form.Item>
          <Form.Item name="priceFactoryBank" label="Zavod o'tkazma (bank) narxi">
            <InputNumber min={0} style={{ width: '100%' }} formatter={moneyFmt} parser={moneyParse} placeholder="masalan 310000" />
          </Form.Item>
        </Form>
      </FormDrawer>

      <Drawer
        title={priceProduct ? `Narxlar — ${priceProduct.name}` : 'Narxlar'}
        open={!!priceProduct}
        onClose={() => setPriceProduct(null)}
        width={640}
      >
        {canEdit && (
          <>
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message="Narxlar versiyalanadi"
              description="Yangi narx eski yozuvlarni o'zgartirmaydi — faqat kuchga kirish sanasidan keyingi buyurtmalarga ta'sir qiladi."
            />
            <Form
              form={priceForm}
              layout="vertical"
              onFinish={(vals) => addPrice.mutate(vals)}
            >
              <Row gutter={12}>
                <Col xs={24} md={8}>
                  <Form.Item
                    name="kind"
                    label="Narx turi"
                    rules={[{ required: true, message: 'Turini tanlang' }]}
                  >
                    <Select
                      style={{ width: '100%' }}
                      placeholder="Turini tanlang"
                      options={(Object.keys(PRICE_KIND) as PriceKind[]).map((k) => ({
                        value: k,
                        label: PRICE_KIND[k],
                      }))}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={7}>
                  <Form.Item
                    name="pricePerM3"
                    label="Narx (so'm / m³)"
                    rules={[{ required: true, message: 'Narx majburiy' }]}
                  >
                    <InputNumber
                      min={0}
                      style={{ width: '100%' }}
                      formatter={moneyFmt}
                      parser={moneyParse}
                      placeholder="masalan 732542.438"
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={5}>
                  <Form.Item name="effectiveFrom" label="Kuchga kirish sanasi">
                    <DatePicker format="DD.MM.YYYY" style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={4}>
                  <Form.Item label={<span>&nbsp;</span>}>
                    <Button type="primary" htmlType="submit" loading={addPrice.isPending} block>
                      Qo'shish
                    </Button>
                  </Form.Item>
                </Col>
              </Row>
            </Form>
            <Divider style={{ margin: '8px 0 16px' }} />
          </>
        )}
        {pricesQ.error ? (
          <Alert
            type="error"
            showIcon
            message="Narx tarixini yuklashda xatolik"
            description={apiError(pricesQ.error)}
            action={
              <Button size="small" onClick={() => pricesQ.refetch()}>
                Qayta urinish
              </Button>
            }
          />
        ) : (
          <div className="scroll-x">
            <Table<PriceHistoryRow>
              rowKey="id"
              columns={priceHistoryCols}
              dataSource={pricesQ.data ?? []}
              loading={pricesQ.isFetching}
              pagination={{ pageSize: 15 }}
              size="small"
            />
          </div>
        )}
      </Drawer>
    </div>
  );
}
