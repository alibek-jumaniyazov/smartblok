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
  FormDrawer,
  MoneyCell,
  PalletChip,
  StatusChip,
  TableCard,
  type SbColumn,
} from '../components';
import { PALLET_TX } from '../lib/status-maps';
import { PageHeader } from '../components/PageHeader';
import { useIsDesktop, useIsPhone } from '../lib/responsive';
import { useAuth } from '../auth/AuthContext';
import { useUrlFilters } from '../lib/useUrlFilters';
import { useT } from '../components/LangContext';
import type { Paged, PalletBalanceRow } from '../lib/types';

interface FactoryBalRow {
  factory: { id: string; name: string };
  balance: number;
}

const DEFAULT_PALLET_PRICE = 130000;

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

interface FactoryReturnVals {
  factoryId: string;
  qty: number;
  date: Dayjs;
  unitPrice: number;
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
  canMutate,
  onAccept,
  onCharge,
}: {
  rows: PalletBalanceRow[];
  loading: boolean;
  canMutate: boolean;
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
                </div>
                <div className="sb-mcard__value">
                  <PalletChip pallets={r.balance} />
                </div>
              </div>
            </div>
            {/* amallar kartaning ichki satrida emas, kebab ichida (§2.2.4) */}
            <div className="sb-mcard__tail">
              {canMutate ? (
                <Dropdown
                  trigger={['click']}
                  menu={{
                    items: [
                      { key: 'accept', label: t('Qaytarish qabul qilish'), icon: <ImportOutlined /> },
                      { key: 'charge', label: t('Undirish'), icon: <WarningOutlined />, danger: true },
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
  rows: FactoryBalRow[];
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
              </div>
              <div className="sb-mcard__value">
                <PalletChip pallets={r.balance} />
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
  const { hasRole } = useAuth();
  const canMutate = hasRole('ADMIN', 'ACCOUNTANT');
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

  useEffect(() => {
    if (clientOpen) {
      clientForm.resetFields();
      clientForm.setFieldsValue({ date: dayjs(), clientId: clientPrefill });
    }
  }, [clientOpen, clientForm, clientPrefill]);

  useEffect(() => {
    if (factoryOpen) {
      factoryForm.resetFields();
      factoryForm.setFieldsValue({ date: dayjs(), unitPrice: DEFAULT_PALLET_PRICE, factoryId: factoryPrefill });
    }
  }, [factoryOpen, factoryForm, factoryPrefill]);

  useEffect(() => {
    if (lostOpen) {
      lostForm.resetFields();
      lostForm.setFieldsValue({ date: dayjs(), unitPrice: DEFAULT_PALLET_PRICE, clientId: clientPrefill });
    }
  }, [lostOpen, lostForm, clientPrefill]);

  const balQ = useQuery({ queryKey: ['pallets', 'balances'], queryFn: () => endpoints.palletBalances() });

  const txParams = { page, pageSize, clientId: txClientId, factoryId: txFactoryId };
  const txQ = useQuery({
    queryKey: ['pallets', 'transactions', txParams],
    queryFn: () => endpoints.palletTransactions(txParams) as Promise<Paged<PalletTxRow>>,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['pallets'] });
    qc.invalidateQueries({ queryKey: ['clients'] });
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

  // computed money previews
  const frQty = Form.useWatch('qty', factoryForm);
  const frPrice = Form.useWatch('unitPrice', factoryForm);
  const frTotal = (Number(frQty) || 0) * (Number(frPrice) || 0);
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

  const balanceActionCol: NonNullable<TableProps<PalletBalanceRow>['columns']>[number] = {
    title: '',
    key: 'actions',
    width: 300,
    render: (_: unknown, r: PalletBalanceRow) => (
      <Space size={4} wrap>
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
      </Space>
    ),
  };

  const balanceColumns: TableProps<PalletBalanceRow>['columns'] = [
    {
      title: t('Mijoz'),
      key: 'client',
      ellipsis: true,
      width: 220,
      render: (_, r) => <Link to={`/clients/${r.client.id}`}>{r.client.name}</Link>,
    },
    {
      title: t('Paddon balansi'),
      dataIndex: 'balance',
      align: 'right',
      width: 140,
      render: (v: number) => (
        <Typography.Text className="num" strong type={v > 0 ? 'warning' : v < 0 ? 'danger' : undefined}>
          {fmtNum(v)}
        </Typography.Text>
      ),
    },
    ...(canMutate ? [balanceActionCol] : []),
  ];

  const factoryActionCol: NonNullable<TableProps<FactoryBalRow>['columns']>[number] = {
    title: '',
    key: 'actions',
    width: 170,
    render: (_: unknown, r: FactoryBalRow) => (
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

  const factoryColumns: TableProps<FactoryBalRow>['columns'] = [
    { title: t('Zavod'), key: 'factory', ellipsis: true, width: 160, render: (_, r) => r.factory.name },
    {
      title: t('Paddon'),
      dataIndex: 'balance',
      align: 'right',
      width: 100,
      render: (v: number) => (
        <Typography.Text className="num" strong>
          {fmtNum(v)}
        </Typography.Text>
      ),
    },
    ...(canMutate ? [factoryActionCol] : []),
  ];

  const txColumns: SbColumn<PalletTxRow>[] = [
    { title: 'Sana', dataIndex: 'date', width: 110, render: (v: string) => fmtDate(v) },
    {
      title: 'Turi',
      dataIndex: 'type',
      width: 170,
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
        actions={
          canMutate
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
            : []
        }
      />

      <Row gutter={[16, 16]} align="stretch">
        <Col xs={24} lg={factories.length > 0 ? 15 : 24}>
          <TableCard
            style={{ height: '100%' }}
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
                canMutate={canMutate}
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
                scroll={isDesktop ? { x: 640 } : { x: 'max-content' }}
                pagination={{ pageSize: BAL_PAGE_SIZE, showSizeChanger: false }}
              />
            )}
          </TableCard>
        </Col>
        {factories.length > 0 && (
          <Col xs={24} lg={9}>
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
                <Table<FactoryBalRow>
                  rowKey={(r) => r.factory.id}
                  size="small"
                  dataSource={factories}
                  loading={balQ.isFetching}
                  pagination={false}
                  columns={factoryColumns}
                  scroll={isDesktop ? undefined : { x: 'max-content' }}
                />
              )}
            </TableCard>
          </Col>
        )}
      </Row>

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
          scroll={isDesktop ? { x: 1000 } : { x: 'max-content' }}
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
              unitPrice: v.unitPrice,
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
          {frTotal > 0 && (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message={t('Zavod hisobiga kredit: {sum}', { sum: fmtUZS(frTotal) })}
            />
          )}
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
