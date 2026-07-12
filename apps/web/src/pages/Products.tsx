import { useMemo, useState } from 'react';
import {
  Alert,
  App,
  Button,
  DatePicker,
  Divider,
  Drawer,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Switch,
  Table,
} from 'antd';
import type { TableColumnsType } from 'antd';
import { DollarOutlined, EditOutlined, PlusOutlined, StopOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Dayjs } from 'dayjs';
import { apiError, asItems, endpoints } from '../lib/api';
import { fmtDateTime, fmtNum } from '../lib/format';
import {
  DataTable,
  FilterBar,
  FormDrawer,
  MoneyCell,
  StatusChip,
  TableCard,
  type FilterField,
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

  const listParams = useMemo(
    () => ({ factoryId, page, pageSize, search }),
    [factoryId, page, pageSize, search],
  );
  const listQ = useQuery({
    queryKey: ['products', listParams],
    queryFn: async () => (await endpoints.products(listParams)) as unknown as Paged<ProductRow>,
    placeholderData: (prev) => prev,
  });

  const factoriesQ = useQuery({
    queryKey: ['factories'],
    queryFn: () => endpoints.factories(),
  });
  const factories = asItems(factoriesQ.data) as Factory[];

  // jadval ustidagi standart filtrlar (URL-sinxron, server tomonda qidiruv/filtr)
  const filters: FilterField[] = useMemo(
    () => [
      {
        key: 'factoryId',
        label: 'Zavod',
        type: 'select',
        options: factories.map((f) => ({ value: f.id, label: f.name })),
      },
    ],
    [factories],
  );

  const pricesQ = useQuery({
    queryKey: ['products', priceProduct?.id, 'prices'],
    queryFn: async () => (await endpoints.productPrices(priceProduct!.id)) as PriceHistoryRow[],
    enabled: !!priceProduct,
  });

  const save = useMutation({
    mutationFn: (vals: ProductFormValues) => {
      if (editing) {
        // factoryId is immutable server-side — never send it on update
        const { factoryId: _omit, ...rest } = vals;
        return endpoints.updateProduct(editing.id, rest);
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
        actions={canEdit ? [{ key: 'new', label: 'Yangi mahsulot', primary: true, icon: <PlusOutlined />, onClick: openCreate }] : []}
      />
      <TableCard
        title="Mahsulotlar"
        loading={listQ.isFetching}
        toolbar={<FilterBar schema={filters} searchPlaceholder="Mahsulot qidirish" />}
      >
        <DataTable<ProductRow>
          rowKey="id"
          columns={columns}
          query={listQ}
          densityKey="products"
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
          {!editing && (
            <>
              <Divider style={{ margin: '4px 0 14px' }} plain>
                Narxlar (so'm / m³) — ixtiyoriy
              </Divider>
              <Form.Item name="priceDealerSale" label="Sotish narxi (mijozga)">
                <InputNumber min={0} style={{ width: '100%' }} formatter={moneyFmt} parser={moneyParse} placeholder="masalan 350000" />
              </Form.Item>
              <Form.Item name="priceFactoryCash" label="Zavod naqd narxi">
                <InputNumber min={0} style={{ width: '100%' }} formatter={moneyFmt} parser={moneyParse} placeholder="masalan 300000" />
              </Form.Item>
              <Form.Item name="priceFactoryBank" label="Zavod o'tkazma narxi">
                <InputNumber min={0} style={{ width: '100%' }} formatter={moneyFmt} parser={moneyParse} placeholder="masalan 310000" />
              </Form.Item>
            </>
          )}
          {editing && (
            <Form.Item name="active" label="Faol" valuePropName="checked">
              <Switch />
            </Form.Item>
          )}
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
              <Space align="end" wrap>
                <Form.Item
                  name="kind"
                  label="Narx turi"
                  rules={[{ required: true, message: 'Turini tanlang' }]}
                >
                  <Select
                    style={{ width: 210 }}
                    placeholder="Turini tanlang"
                    options={(Object.keys(PRICE_KIND) as PriceKind[]).map((k) => ({
                      value: k,
                      label: PRICE_KIND[k],
                    }))}
                  />
                </Form.Item>
                <Form.Item
                  name="pricePerM3"
                  label="Narx (so'm / m³)"
                  rules={[{ required: true, message: 'Narx majburiy' }]}
                >
                  <InputNumber
                    min={0}
                    style={{ width: 180 }}
                    formatter={moneyFmt}
                    parser={moneyParse}
                    placeholder="masalan 732542.438"
                  />
                </Form.Item>
                <Form.Item name="effectiveFrom" label="Kuchga kirish sanasi">
                  <DatePicker format="DD.MM.YYYY" />
                </Form.Item>
                <Form.Item>
                  <Button type="primary" htmlType="submit" loading={addPrice.isPending}>
                    Qo'shish
                  </Button>
                </Form.Item>
              </Space>
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
