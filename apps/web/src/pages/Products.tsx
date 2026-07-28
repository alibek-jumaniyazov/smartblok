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
  Tag,
  theme,
} from 'antd';
import type { InputRef, TableColumnsType } from 'antd';
import {
  DeleteOutlined,
  DollarOutlined,
  EditOutlined,
  PlusOutlined,
  SearchOutlined,
  StopOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs, { type Dayjs } from 'dayjs';
import { apiError, asItems, endpoints } from '../lib/api';
import { fmtDate, fmtNum } from '../lib/format';
import {
  DataTable,
  FormDrawer,
  MoneyCell,
  StatusChip,
  TableCard,
  type SbColumn,
} from '../components';
import { PageHeader } from '../components/PageHeader';
import { useT } from '../components/LangContext';
import { useAuth } from '../auth/AuthContext';
import { TOUCH_MIN, drawerWidth, useIsPhone } from '../lib/responsive';
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
interface PriceCell {
  pricePerM3: string;
  effectiveFrom: string;
}
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
  /** BUGUN kuchda turgan narx */
  prices: Partial<Record<PriceKind, PriceCell>>;
  /** hali kuchga kirmagan (kelajak sanali) narx — «kiritilmagan» dan farq qiladi */
  pendingPrices?: Partial<Record<PriceKind, PriceCell>>;
  /** shu tur bo'yicha eng erta narx sanasi — undan oldingi buyurtmalar qamralmagan */
  firstPriceFrom?: Partial<Record<PriceKind, string>>;
  /** shu mahsulot ishtirok etgan eng eski buyurtma sanasi */
  oldestOrderDate?: string | null;
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
  priceDealerSale?: number;
  priceFactoryCash?: number;
  priceFactoryBank?: number;
  /** narxlar qaysi kundan kuchga kirsin (ikkala rejimda ham) */
  pricesEffectiveFrom: Dayjs;
}

interface PriceFormValues {
  kind: PriceKind;
  pricePerM3: number;
  effectiveFrom: Dayjs;
}

const moneyFmt = (v: string | number | undefined) =>
  `${v ?? ''}`.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const moneyParse = (v: string | undefined) => (v ? v.replace(/\s/g, '') : '') as unknown as number;

/**
 * Narx maydonlarining eng kichik qiymati.
 *
 * Server `<= 0` ni RAD etadi (positiveDecimal), input esa `min={0}` edi — ya'ni 0 yozish
 * mumkin edi va butun mahsulot yaratish 400 bilan yiqilardi. m³ narxi 6 xonagacha
 * kasrli, shuning uchun chegara 0 dan keyingi eng kichik qadam.
 */
const MIN_PRICE = 0.000001;

/** Narx kitobi sanaga bog'liq — hamma joyda bitta tushuntirish matni. */
const EFFECTIVE_HINT =
  "Narx SHU KUNDAN boshlab amal qiladi. Undan oldingi sanadagi buyurtmalarga qo'llanmaydi — " +
  "eski buyurtmalarni ham qamrash uchun sanani orqaga suring.";

export default function Products() {
  const { token } = theme.useToken();
  const { message, modal } = App.useApp();
  const t = useT();
  const { hasRole } = useAuth();
  const qc = useQueryClient();
  // §1.1 — breakpointning yagona manbasi (Grid.useBreakpoint TAQIQLANGAN, R1)
  const isPhone = useIsPhone();
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
    mutationFn: async (vals: ProductFormValues): Promise<{ priceVersions: number }> => {
      const effectiveFrom = (vals.pricesEffectiveFrom ?? dayjs()).format('YYYY-MM-DD');
      if (editing) {
        // factoryId is immutable server-side; prices are versioned, not overwritten →
        // send the basic fields to updateProduct, then post a price version for each price
        // that actually changed.
        const {
          factoryId: _omit,
          pricesEffectiveFrom: _d,
          priceDealerSale,
          priceFactoryCash,
          priceFactoryBank,
          ...rest
        } = vals;
        await endpoints.updateProduct(editing.id, rest);
        const cur = editing.prices;
        const changed: { kind: PriceKind; pricePerM3: number }[] = [];
        /**
         * The DATE is half of a price row's identity — comparing only the number is what
         * made this form lie (2026-07-28).
         *
         * `editing.prices[kind]` is the row in force TODAY. After the owner entered a naqd
         * price it showed up here, so re-opening the drawer and re-typing the SAME number to
         * cover older orders produced an empty `changed` list — zero requests — while the
         * drawer still announced «Mahsulot yangilandi». That is exactly «qo'shsam ham
         * hisobga olinmayapti». Now a row is posted whenever the value OR the effective day
         * differs, so re-entering the same number at an earlier date does real work.
         */
        const diff = (kind: PriceKind, val?: number) => {
          if (val == null) return;
          const row = cur[kind];
          const sameValue = row != null && Number(row.pricePerM3) === Number(val);
          const sameDay = row != null && dayjs(row.effectiveFrom).format('YYYY-MM-DD') === effectiveFrom;
          if (!sameValue || !sameDay) changed.push({ kind, pricePerM3: val });
        };
        diff('DEALER_SALE', priceDealerSale);
        diff('FACTORY_CASH', priceFactoryCash);
        diff('FACTORY_BANK', priceFactoryBank);
        for (const c of changed) {
          await endpoints.addProductPrice(editing.id, {
            kind: c.kind,
            pricePerM3: c.pricePerM3,
            effectiveFrom,
          });
        }
        return { priceVersions: changed.length };
      }
      await endpoints.createProduct({ ...vals, pricesEffectiveFrom: effectiveFrom });
      return { priceVersions: 0 };
    },
    onSuccess: (res) => {
      message.success(
        editing
          ? res.priceVersions
            ? t('Saqlandi — {n} ta narx kiritildi', { n: res.priceVersions })
            : t("Saqlandi — narxlar o'zgarmadi")
          : t('Mahsulot yaratildi'),
      );
      qc.invalidateQueries({ queryKey: ['products'] });
      setModalOpen(false);
    },
    onError: (e) => message.error(apiError(e)),
  });

  const deactivate = useMutation({
    mutationFn: (id: string) => endpoints.deleteProduct(id),
    onSuccess: () => {
      message.success(t('Mahsulot nofaol qilindi'));
      qc.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (e) => message.error(apiError(e)),
  });

  const addPrice = useMutation({
    mutationFn: (vals: PriceFormValues) =>
      endpoints.addProductPrice(priceProduct!.id, {
        kind: vals.kind,
        pricePerM3: vals.pricePerM3,
        // ALWAYS explicit. Omitting it let the server guess «today» in UTC, which in
        // Tashkent (UTC+5) is YESTERDAY between 00:00 and 05:00 local — a day the owner
        // never chose. The field is required in the form, so there is nothing to guess.
        effectiveFrom: vals.effectiveFrom.format('YYYY-MM-DD'),
      }),
    onSuccess: (_r, vals) => {
      message.success(
        t('Narx kiritildi — {date} dan amal qiladi', { date: vals.effectiveFrom.format('DD.MM.YYYY') }),
      );
      qc.invalidateQueries({ queryKey: ['products'] });
      priceForm.resetFields();
      priceForm.setFieldsValue({ effectiveFrom: dayjs() });
    },
    onError: (e) => message.error(apiError(e)),
  });

  const removePrice = useMutation({
    mutationFn: (priceId: string) => endpoints.deleteProductPrice(priceProduct!.id, priceId),
    onSuccess: () => {
      message.success(t("Narx versiyasi o'chirildi"));
      qc.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (e) => message.error(apiError(e)),
  });

  /** Narx oynasi — yopilganda formani tozalash SHART: aks holda A mahsulot uchun yozilib
   *  qoldirilgan narx keyingi safar B mahsulotga yuborilardi. */
  const closePriceDrawer = () => {
    setPriceProduct(null);
    priceForm.resetFields();
  };
  /** Ochilganda sana HAR SAFAR bugungi kunga qo'yiladi — `initialValues` faqat birinchi
   *  mount'da hisoblanadi, ya'ni ilova tunni ochiq o'tkazsa kechagi sana qolib ketardi. */
  const openPriceDrawer = (row: ProductRow) => {
    setPriceProduct(row);
    priceForm.resetFields();
    priceForm.setFieldsValue({ effectiveFrom: dayjs() });
  };

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ unit: 'm³', pricesEffectiveFrom: dayjs() });
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
      pricesEffectiveFrom: dayjs(),
      // load CURRENT prices so they can be edited inline (changed ones post a new version)
      priceDealerSale: row.prices.DEALER_SALE ? Number(row.prices.DEALER_SALE.pricePerM3) : undefined,
      priceFactoryCash: row.prices.FACTORY_CASH ? Number(row.prices.FACTORY_CASH.pricePerM3) : undefined,
      priceFactoryBank: row.prices.FACTORY_BANK ? Number(row.prices.FACTORY_BANK.pricePerM3) : undefined,
    });
    setModalOpen(true);
  };

  const confirmDeactivate = (row: ProductRow) => {
    modal.confirm({
      title: t('Mahsulotni nofaol qilish'),
      content: t('"{name}" nofaol qilinadi — yangi buyurtmalarda ko\'rinmaydi, tarix saqlanadi.', { name: row.name }),
      okText: t('Nofaol qilish'),
      okButtonProps: { danger: true },
      cancelText: t('Bekor qilish'),
      // R16: telefonda markazda — klaviatura/notch footer'ni bosib qolmasin
      centered: isPhone,
      onOk: () => deactivate.mutateAsync(row.id),
    });
  };

  /**
   * Telefon kartasining pastki amal qatori (§2.2.4 — amal tugmalari karta ichki
   * qatorida turmaydi, to'liq enli footer bo'ladi). Desktop ustuni tegilmagan.
   */
  const mobileRowActions = (row: ProductRow) => (
    <Space.Compact block>
      <Button
        icon={<DollarOutlined />}
        style={{ flex: 1, minHeight: TOUCH_MIN }}
        onClick={() => openPriceDrawer(row)}
      >
        {t('Narxlar')}
      </Button>
      <Button
        icon={<EditOutlined />}
        style={{ minHeight: TOUCH_MIN }}
        title={t('Tahrirlash')}
        aria-label={t('Tahrirlash')}
        onClick={() => openEdit(row)}
      />
      {row.active && (
        <Button
          danger
          icon={<StopOutlined />}
          style={{ minHeight: TOUCH_MIN }}
          title={t('Nofaol qilish')}
          aria-label={t('Nofaol qilish')}
          onClick={() => confirmDeactivate(row)}
        />
      )}
    </Space.Compact>
  );

  /**
   * Narx katakchasi — UCH holat, ikkita emas (2026-07-28).
   *
   * Ilgari faqat «narx» yoki «kiritilmagan» bor edi, va ro'yxat narxni BUGUNGI kun bo'yicha
   * yechardi. Shu sababli ekran «narx bor» deb turaverar, buyurtma esa xuddi shu mahsulotni
   * «narxi belgilanmagan» deb rad etardi (buyurtma O'Z sanasida yechadi) — egasi ko'rgan
   * ziddiyat aynan shu. Endi katakcha narx qaysi KUNDAN amal qilishini ham aytadi, va
   * kelajak sana bilan xato kiritilgan narx «umuman yo'q» bo'lib ko'rinmaydi.
   */
  const priceCell = (r: ProductRow, kind: PriceKind, strong = false) => {
    const cur = r.prices[kind];
    if (cur) {
      return (
        <div>
          <MoneyCell value={cur.pricePerM3} strong={strong} />
          <div style={{ fontSize: 11, color: token.colorTextTertiary, whiteSpace: 'nowrap' }}>
            {t('{date} dan', { date: fmtDate(cur.effectiveFrom) })}
          </div>
        </div>
      );
    }
    const future = r.pendingPrices?.[kind];
    if (future) {
      return (
        <Tag color="processing" style={{ whiteSpace: 'nowrap' }}>
          {t('{date} dan kuchga kiradi', { date: fmtDate(future.effectiveFrom) })}
        </Tag>
      );
    }
    return <Tag color="warning">{t('kiritilmagan')}</Tag>;
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
      render: (_: unknown, r) => priceCell(r, 'DEALER_SALE', true),
    },
    ...(canSeeCost
      ? ([
          // Yo'q narx endi shunchaki «—» emas: o'sha kanal bilan buyurtma ham, to'lov ham
          // qabul qilinmaydi (ilgari tizim jimgina ikkinchi kanalning narxini olardi va
          // naqd bilan sotib olish o'tkazma narxida yozilardi). Shuning uchun yetishmayotgan
          // narx ro'yxatda ko'zga tashlanib turishi kerak — egasi talabi, 2026-07-26.
          {
            title: PRICE_KIND.FACTORY_CASH,
            key: 'factoryCash',
            align: 'right',
            className: 'num',
            render: (_: unknown, r: ProductRow) => priceCell(r, 'FACTORY_CASH'),
          },
          {
            title: PRICE_KIND.FACTORY_BANK,
            key: 'factoryBank',
            align: 'right',
            className: 'num',
            render: (_: unknown, r: ProductRow) => priceCell(r, 'FACTORY_BANK'),
          },
        ] as SbColumn<ProductRow>[])
      : []),
    {
      title: 'Holat',
      dataIndex: 'active',
      key: 'active',
      render: (v: boolean) => {
        const m = v ? ACTIVE_META.active : ACTIVE_META.inactive;
        return <StatusChip meta={{ ...m, label: t(m.label) }} />;
      },
    },
    ...(canEdit
      ? ([
          {
            title: 'Amallar',
            key: 'actions',
            width: 190,
            render: (_: unknown, row: ProductRow) => (
              <Space>
                <Button size="small" icon={<DollarOutlined />} onClick={() => openPriceDrawer(row)}>
                  {t('Narxlar')}
                </Button>
                <Button
                  size="small"
                  icon={<EditOutlined />}
                  title={t('Tahrirlash')}
                  aria-label={t('Tahrirlash')}
                  onClick={() => openEdit(row)}
                />
                {row.active && (
                  <Button
                    size="small"
                    danger
                    icon={<StopOutlined />}
                    title={t('Nofaol qilish')}
                    aria-label={t('Nofaol qilish')}
                    onClick={() => confirmDeactivate(row)}
                  />
                )}
              </Space>
            ),
          },
        ] as SbColumn<ProductRow>[])
      : []),
  ];

  const confirmRemovePrice = (row: PriceHistoryRow) => {
    modal.confirm({
      title: t('Narx versiyasini o‘chirish'),
      content: t(
        '{kind} — {price} ({date} dan) o‘chiriladi. Mavjud buyurtmalar o‘z narxini saqlaydi, faqat narx kitobi o‘zgaradi.',
        {
          kind: t(PRICE_KIND[row.kind] ?? row.kind),
          price: fmtNum(row.pricePerM3, 6),
          date: fmtDate(row.effectiveFrom),
        },
      ),
      okText: t('O‘chirish'),
      okButtonProps: { danger: true },
      cancelText: t('Bekor qilish'),
      centered: isPhone,
      onOk: () => removePrice.mutateAsync(row.id),
    });
  };

  const priceHistoryCols: TableColumnsType<PriceHistoryRow> = [
    { title: t('Turi'), dataIndex: 'kind', key: 'kind', render: (v: PriceKind) => (PRICE_KIND[v] ? t(PRICE_KIND[v]) : v) },
    {
      title: t('Narx (so\'m / m³)'),
      dataIndex: 'pricePerM3',
      key: 'pricePerM3',
      align: 'right',
      className: 'num',
      render: (v: string) => fmtNum(v, 6),
    },
    {
      title: t('Kuchga kirgan'),
      dataIndex: 'effectiveFrom',
      key: 'effectiveFrom',
      // fmtDate, fmtDateTime EMAS: qator UTC yarim tunga tekislanadi, ya'ni vaqt qismi
      // Toshkentda hamisha «05:00» bo'lib chiqardi — aynan sana muhim bo'lgan ekranda.
      render: (v: string) => fmtDate(v),
    },
    ...(canEdit
      ? ([
          {
            title: t('Amal'),
            key: 'remove',
            width: 60,
            render: (_: unknown, row: PriceHistoryRow) => (
              <Button
                size="small"
                danger
                type="text"
                icon={<DeleteOutlined />}
                title={t('O‘chirish')}
                aria-label={t('O‘chirish')}
                onClick={() => confirmRemovePrice(row)}
              />
            ),
          },
        ] as TableColumnsType<PriceHistoryRow>)
      : []),
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
      <div className="sb-table-card" style={{ padding: isPhone ? '10px 12px' : '14px 16px', marginBottom: 16 }}>
        <div className="sb-filterbar">
          <Input
            ref={searchRef}
            allowClear
            prefix={<SearchOutlined style={{ color: token.colorTextTertiary }} />}
            placeholder={t('Mahsulot nomi')}
            value={searchInput}
            onChange={(e) => {
              const v = e.target.value;
              setSearchInput(v);
              if (v === '') uf.set({ search: null });
            }}
            onPressEnter={applySearch}
            style={{ width: isPhone ? '100%' : 260, minWidth: isPhone ? 0 : undefined }}
          />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder={t('Zavod')}
            value={factoryId}
            onChange={(v?: string) => uf.set({ factoryId: v || null })}
            options={factories.map((f) => ({ value: f.id, label: f.name }))}
            style={{ minWidth: isPhone ? 0 : 200, width: isPhone ? '100%' : undefined }}
          />
          <Button type="primary" icon={<SearchOutlined />} onClick={applySearch}>
            {t('Qidirish')}
          </Button>
          <Button onClick={clearFilters} disabled={!anyFilter}>
            {t('Tozalash')}
          </Button>
          {/* §2.5 meta: telefonda o'z qatorida, `auto` chap chekka surilishisiz */}
          <span
            className="num"
            style={{
              marginInlineStart: isPhone ? undefined : 'auto',
              width: isPhone ? '100%' : undefined,
              color: token.colorTextSecondary,
              fontSize: 13,
            }}
          >
            {fmtNum(listQ.data?.total ?? 0)} {t('ta')}
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
          // R11 — telefonda 8–10 ustunli jadval o'rniga teginish kartalari.
          // Sarlavha = nomi, izoh = zavod, yagona pul raqami = sotish narxi
          // (MoneyCell nowrap), qolgani `lines` sifatida yorliq/qiymat qatorlari.
          mobileCard={(r) => ({
            title: r.name,
            subtitle: r.factoryName,
            value: r.prices.DEALER_SALE ? <MoneyCell value={r.prices.DEALER_SALE.pricePerM3} strong /> : undefined,
            meta: (
              <StatusChip
                meta={{
                  ...(r.active ? ACTIVE_META.active : ACTIVE_META.inactive),
                  label: t(r.active ? ACTIVE_META.active.label : ACTIVE_META.inactive.label),
                }}
              />
            ),
            lines: [
              { label: "O'lchami", value: r.size || '—' },
              { label: 'm³ / paddon', value: fmtNum(r.m3PerPallet, 3) },
              { label: 'Blok / paddon', value: r.blocksPerPallet != null ? fmtNum(r.blocksPerPallet) : '—' },
              // telefonda ham AYNAN shu uch holat — ilgari yetishmayotgan zavod narxi
              // oddiy «—» bo'lib turardi, ya'ni egasi talab qilgan ogohlantirish
              // telefonda umuman yo'q edi
              ...(canSeeCost
                ? [
                    { label: PRICE_KIND.FACTORY_CASH, value: priceCell(r, 'FACTORY_CASH') },
                    { label: PRICE_KIND.FACTORY_BANK, value: priceCell(r, 'FACTORY_BANK') },
                  ]
                : []),
            ],
            actions: canEdit ? mobileRowActions(r) : undefined,
          })}
        />
      </TableCard>

      <FormDrawer
        open={modalOpen}
        title={editing ? t('Mahsulotni tahrirlash') : t('Yangi mahsulot')}
        onClose={() => setModalOpen(false)}
        onSubmit={() => form.validateFields().then((vals) => save.mutate(vals))}
        submitting={save.isPending}
        width={480}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="factoryId"
            label={t('Zavod')}
            rules={[{ required: true, message: t('Zavodni tanlang') }]}
            extra={editing ? t("Zavodni o'zgartirib bo'lmaydi — eski buyurtmalar buziladi") : undefined}
          >
            <Select
              disabled={!!editing}
              placeholder={t('Zavodni tanlang')}
              options={factories.map((f) => ({ value: f.id, label: f.name }))}
            />
          </Form.Item>
          <Form.Item name="name" label={t('Nomi')} rules={[{ required: true, message: t('Nomi majburiy') }, { max: 200 }]}>
            <Input placeholder={t('masalan Gazoblok D500')} />
          </Form.Item>
          <Form.Item name="size" label={t("O'lchami")} rules={[{ max: 100 }]}>
            <Input placeholder={t('masalan 600×300×200')} />
          </Form.Item>
          <Form.Item
            name="m3PerPallet"
            label={t('Hajmi (m³ / paddon)')}
            rules={[{ required: true, message: t('m³ / paddon majburiy') }]}
          >
            {/* inputMode — AntD InputNumber `<input role="spinbutton">` chiqaradi,
                `type`/`inputMode` siz esa telefonda HARFLI klaviatura ochiladi.
                Kasrli maydon → `decimal` (raqamli panelda nuqta bo'ladi). */}
            <InputNumber
              min={0.001}
              step={0.001}
              inputMode="decimal"
              style={{ width: '100%' }}
              placeholder={t('masalan 1.728')}
            />
          </Form.Item>
          <Form.Item name="blocksPerPallet" label={t('Bloklar soni (paddonda)')}>
            <InputNumber min={1} precision={0} inputMode="numeric" style={{ width: '100%' }} placeholder={t('masalan 48')} />
          </Form.Item>
          <Form.Item name="unit" label={t("O'lchov birligi")} rules={[{ max: 20 }]}>
            <Input placeholder="m³" />
          </Form.Item>
          {editing && (
            <Form.Item name="active" label={t('Faol')} valuePropName="checked">
              <Switch />
            </Form.Item>
          )}
          <Divider style={{ margin: '4px 0 14px' }} plain>
            {t("Narxlar (so'm / m³)")}
          </Divider>
          {/* Sana narxning YARMI: buyurtma narxni o'z sanasida o'qiydi. Ilgari bu maydon
              bu yerda umuman yo'q edi va narx jimgina «bugundan» yozilardi — natijada eski
              buyurtmalar «narxi belgilanmagan» bo'lib qolaverardi. */}
          <Form.Item
            name="pricesEffectiveFrom"
            label={t('Narxlar qaysi kundan kuchga kirsin')}
            rules={[{ required: true, message: t('Sanani tanlang') }]}
            extra={t(EFFECTIVE_HINT)}
          >
            <DatePicker format="DD.MM.YYYY" allowClear={false} style={{ width: '100%' }} />
          </Form.Item>
          {editing && editing.oldestOrderDate && (
            <Button
              size="small"
              style={{ marginBottom: 14 }}
              onClick={() => form.setFieldsValue({ pricesEffectiveFrom: dayjs(editing.oldestOrderDate) })}
            >
              {t('Eng eski buyurtma sanasidan ({date})', { date: fmtDate(editing.oldestOrderDate) })}
            </Button>
          )}
          <Form.Item
            name="priceDealerSale"
            label={t('Sotish narxi (mijozga)')}
            extra={editing ? t("O'zgartirilsa yangi narx versiyasi yoziladi (eski buyurtmalar buzilmaydi)") : undefined}
          >
            {/* narx m³ uchun kasrli bo'lishi mumkin (fmtNum(...,6)) → `decimal`,
                `numeric` bo'lsa iOS panelida nuqta yo'q va 732542.438 yozib
                bo'lmasdi */}
            <InputNumber min={MIN_PRICE} inputMode="decimal" style={{ width: '100%' }} formatter={moneyFmt} parser={moneyParse} placeholder={t('masalan 350000')} />
          </Form.Item>
          {/* Zavod narxlari yaratishda MAJBURIY (egasi qarori 2026-07-28): narxsiz mahsulot
              sotuvda ishlaydi, lekin zavod bilan naqd hisob-kitobda to'xtatiladi — va o'sha
              paytda sababni topish deyarli imkonsiz. */}
          <Form.Item
            name="priceFactoryCash"
            label={t('Zavod naqd narxi')}
            rules={editing ? [] : [{ required: true, message: t('Zavod naqd narxi majburiy') }]}
          >
            <InputNumber min={MIN_PRICE} inputMode="decimal" style={{ width: '100%' }} formatter={moneyFmt} parser={moneyParse} placeholder={t('masalan 300000')} />
          </Form.Item>
          <Form.Item
            name="priceFactoryBank"
            label={t("Zavod o'tkazma (bank) narxi")}
            rules={editing ? [] : [{ required: true, message: t("Zavod o'tkazma narxi majburiy") }]}
          >
            <InputNumber min={MIN_PRICE} inputMode="decimal" style={{ width: '100%' }} formatter={moneyFmt} parser={moneyParse} placeholder={t('masalan 310000')} />
          </Form.Item>
        </Form>
      </FormDrawer>

      {/* Telefonda pastdan chiqadigan varaq (FormDrawer bilan bir xil xulq): 100vw
          enli o'ng drawer'da mask ko'rinmaydi va «chiqishsiz sahifa» bo'lib qoladi.
          §4 — har bir to'liq ekran sirtda KO'RINADIGAN, barmoq o'lchamidagi chiqish
          bo'lishi shart: bu drawer'da futer yo'q edi, ya'ni yagona chiqish AntD ning
          24x24 «✕» i bo'lib qolgandi. Telefonda to'liq enli «Yopish» qo'shildi
          (desktopda futer yo'q — ilgarigidek). */}
      <Drawer
        title={priceProduct ? t('Narxlar — {name}', { name: priceProduct.name }) : t('Narxlar')}
        open={!!priceProduct}
        onClose={closePriceDrawer}
        placement={isPhone ? 'bottom' : 'right'}
        height={isPhone ? '92dvh' : undefined}
        width={drawerWidth(640)}
        footer={
          isPhone ? (
            <Button block style={{ minHeight: TOUCH_MIN }} onClick={closePriceDrawer}>
              {t('Yopish')}
            </Button>
          ) : undefined
        }
        styles={
          isPhone
            ? {
                body: { padding: '14px 12px', overscrollBehavior: 'contain' },
                footer: { padding: '12px 12px calc(12px + var(--sb-safe-b))' },
              }
            : undefined
        }
      >
        {canEdit && (
          <>
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message={t('Narx sanaga bog‘liq')}
              description={
                <>
                  <div>{t(EFFECTIVE_HINT)}</div>
                  {priceProduct?.oldestOrderDate ? (
                    <div style={{ marginTop: 6 }}>
                      {t(
                        'Bu mahsulot bo‘yicha eng eski buyurtma — {date}. Butun tarixni qamrash uchun sanani o‘shanga qo‘ying.',
                        { date: fmtDate(priceProduct.oldestOrderDate) },
                      )}
                    </div>
                  ) : null}
                </>
              }
            />
            <Form
              form={priceForm}
              layout="vertical"
              initialValues={{ effectiveFrom: dayjs() }}
              onFinish={(vals) => addPrice.mutate(vals)}
            >
              <Row gutter={12}>
                <Col xs={24} md={8}>
                  <Form.Item
                    name="kind"
                    label={t('Narx turi')}
                    rules={[{ required: true, message: t('Turini tanlang') }]}
                  >
                    <Select
                      style={{ width: '100%' }}
                      placeholder={t('Turini tanlang')}
                      options={(Object.keys(PRICE_KIND) as PriceKind[]).map((k) => ({
                        value: k,
                        label: t(PRICE_KIND[k]),
                      }))}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={7}>
                  <Form.Item
                    name="pricePerM3"
                    label={t("Narx (so'm / m³)")}
                    rules={[{ required: true, message: t('Narx majburiy') }]}
                  >
                    <InputNumber
                      min={MIN_PRICE}
                      inputMode="decimal"
                      style={{ width: '100%' }}
                      formatter={moneyFmt}
                      parser={moneyParse}
                      placeholder={t('masalan 732542.438')}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={5}>
                  <Form.Item
                    name="effectiveFrom"
                    label={t('Kuchga kirish sanasi')}
                    rules={[{ required: true, message: t('Sanani tanlang') }]}
                  >
                    {/* allowClear={false} — bo'sh qoldirilsa server o'zi «bugun» deb taxmin
                        qilardi, va u UTC bo'yicha bugun edi: Toshkentda tunggi 00:00–05:00
                        oralig'ida bu KECHAGI kun bo'lib chiqardi. */}
                    <DatePicker format="DD.MM.YYYY" allowClear={false} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={4}>
                  {/* desktopda tugmani inputlar bilan bir chiziqqa tushiruvchi bo'sh
                      yorliq — telefonda ustunlar baribir tik, faqat joy yeydi */}
                  <Form.Item label={isPhone ? undefined : <span>&nbsp;</span>}>
                    <Button type="primary" htmlType="submit" loading={addPrice.isPending} block>
                      {t("Qo'shish")}
                    </Button>
                  </Form.Item>
                </Col>
              </Row>
              {/* Egasining haqiqiy ishi «bugungi narxni kiritish» emas — mavjud (o'tgan
                  sanadagi) buyurtmalarni qamrash. Bitta tugma bilan sana o'sha yerga
                  suriladi, aks holda u har bir buyurtma uchun alohida narx kiritardi. */}
              <Space wrap style={{ marginTop: -8, marginBottom: 4 }}>
                <Button size="small" onClick={() => priceForm.setFieldsValue({ effectiveFrom: dayjs() })}>
                  {t('Bugundan')}
                </Button>
                {priceProduct?.oldestOrderDate ? (
                  <Button
                    size="small"
                    onClick={() =>
                      priceForm.setFieldsValue({ effectiveFrom: dayjs(priceProduct.oldestOrderDate) })
                    }
                  >
                    {t('Eng eski buyurtma sanasidan ({date})', {
                      date: fmtDate(priceProduct.oldestOrderDate),
                    })}
                  </Button>
                ) : null}
              </Space>
            </Form>
            <Divider style={{ margin: '8px 0 16px' }} />
          </>
        )}
        {pricesQ.error ? (
          <Alert
            type="error"
            showIcon
            message={t('Narx tarixini yuklashda xatolik')}
            description={apiError(pricesQ.error)}
            action={
              <Button size="small" onClick={() => pricesQ.refetch()}>
                {t('Qayta urinish')}
              </Button>
            }
          />
        ) : (
          <div className="scroll-x">
            {/* R10 — skroll faqat telefonda qo'yiladi: `scroll.x` AntD'da
                table-layout:fixed'ga o'tkazadi, ya'ni desktopdagi ustun kengliklari
                o'zgarib ketardi (1-qonun). */}
            <Table<PriceHistoryRow>
              rowKey="id"
              columns={priceHistoryCols}
              dataSource={pricesQ.data ?? []}
              loading={pricesQ.isFetching}
              pagination={{ pageSize: 15, ...(isPhone ? { simple: true, size: 'small' as const } : null) }}
              size="small"
              scroll={isPhone ? { x: 'max-content' } : undefined}
            />
          </div>
        )}
      </Drawer>
    </div>
  );
}
