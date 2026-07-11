// Import & Reconciliation (v3): Excel «Газоблок Счёт» daftarini import qilish.
// Dry-run tekshirish hamma uchun, haqiqiy import va rollback — faqat ADMIN.
// Backend endpointlari lib/api'da yo'q (parallel quriladi) — `api` axios
// instansiyasi to'g'ridan-to'g'ri ishlatiladi; stats shakli defensiv normalizatsiya qilinadi.
import { useMemo, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Collapse,
  Descriptions,
  Flex,
  Input,
  List,
  Modal,
  Space,
  Table,
  Tag,
  Typography,
  Upload,
} from 'antd';
import type { TableProps, UploadFile } from 'antd';
import {
  CheckCircleFilled,
  CloseCircleFilled,
  DiffOutlined,
  ExperimentOutlined,
  ImportOutlined,
  InboxOutlined,
  UndoOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiError } from '../lib/api';
import { fmtDate, fmtDateTime, fmtMoney, fmtNum, num } from '../lib/format';
import { Money } from '../components/Money';
import { useAuth } from '../auth/AuthContext';

// ── backend contract (shapes normalized defensively: backend built in parallel) ──

type ImportStats = Record<string, unknown>;

interface ImportCheck {
  name?: string;
  label?: string;
  check?: string;
  ok?: boolean;
  passed?: boolean;
  detail?: string;
  message?: string;
}

interface BatchRow {
  id: string;
  filename: string;
  createdAt: string;
  stats?: ImportStats;
  createdBy?: string | { id?: string; name?: string } | null;
}

interface ReconClient {
  name: string;
  expectedBalance: string | number;
  actualBalance: string | number;
  diff: string | number;
  ok: boolean;
  expectedPallets: number;
  actualPallets: number;
  palletsOk: boolean;
  sheetless?: boolean;
}

interface FlaggedPayment {
  id?: string;
  date?: string;
  client?: string | { name?: string } | null;
  clientName?: string;
  amount?: string | number;
  note?: string | null;
}

interface Reconciliation {
  clients?: ReconClient[];
  factory?: { expected?: string | number; actual?: string | number; diff?: string | number; ok?: boolean } | null;
  flaggedPayments?: FlaggedPayment[];
  summary?: unknown;
}

interface RunState {
  dryRun: boolean;
  batchId?: string;
  stats?: ImportStats;
}

// ── stats normalizers ──

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const numish = (v: unknown): string | number => (typeof v === 'number' || typeof v === 'string' ? v : 0);

const checkOk = (c: ImportCheck): boolean => (c.ok ?? c.passed) === true;
const checkLabel = (c: ImportCheck): string => c.label ?? c.name ?? c.check ?? 'Tekshiruv';
const checkDetail = (c: ImportCheck): string | undefined => c.detail ?? c.message;

function getChecks(stats?: ImportStats): ImportCheck[] {
  if (!stats) return [];
  const raw = stats.checks ?? stats.validation ?? stats.validationResults ?? stats.assertions;
  return Array.isArray(raw) ? (raw as ImportCheck[]) : [];
}

function getCounts(stats?: ImportStats): [string, string][] {
  if (!stats) return [];
  const raw = stats.counts ?? stats.rowCounts ?? stats.sheets ?? stats.sheetCounts;
  if (Array.isArray(raw)) {
    return raw.map((r) => {
      const rec = isRecord(r) ? r : {};
      return [String(rec.sheet ?? rec.name ?? '?'), fmtNum(numish(rec.rows ?? rec.count))];
    });
  }
  if (isRecord(raw)) {
    return Object.entries(raw).map(([k, v]) => [
      k,
      typeof v === 'number' || typeof v === 'string' ? fmtNum(v) : String(v),
    ]);
  }
  return [];
}

const UNMATCHED_LABEL: Record<string, string> = {
  unmatched: 'Mos kelmagan yozuvlar',
  clients: 'Topilmagan mijozlar',
  unmatchedClients: 'Topilmagan mijozlar',
  payments: "Mos kelmagan to'lovlar",
  unmatchedPayments: "Mos kelmagan to'lovlar",
  products: 'Topilmagan mahsulotlar',
  unmatchedProducts: 'Topilmagan mahsulotlar',
  sheets: 'Mos kelmagan varaqlar',
  unmatchedSheets: 'Mos kelmagan varaqlar',
};

function getUnmatched(stats?: ImportStats): { key: string; label: string; items: string[] }[] {
  if (!stats) return [];
  const out: { key: string; label: string; items: string[] }[] = [];
  const push = (key: string, val: unknown) => {
    if (!Array.isArray(val) || val.length === 0) return;
    out.push({
      key,
      label: UNMATCHED_LABEL[key] ?? key,
      items: val.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))),
    });
  };
  const un = stats.unmatched;
  if (isRecord(un)) Object.entries(un).forEach(([k, v]) => push(k, v));
  else if (Array.isArray(un)) push('unmatched', un);
  Object.entries(stats).forEach(([k, v]) => {
    if (/^unmatched.+/i.test(k)) push(k, v);
  });
  return out;
}

function getCashboxBalances(stats?: ImportStats): { name: string; balance: number }[] {
  if (!stats) return [];
  const raw = stats.cashboxBalances ?? stats.cashboxes;
  if (Array.isArray(raw)) {
    return raw.map((r) => {
      const rec = isRecord(r) ? r : {};
      return {
        name: String(rec.name ?? rec.cashbox ?? '?'),
        balance: num(numish(rec.balance ?? rec.closing ?? rec.amount)),
      };
    });
  }
  if (isRecord(raw)) return Object.entries(raw).map(([k, v]) => ({ name: k, balance: num(numish(v)) }));
  return [];
}

// ── small atoms ──

const OkIcon = ({ ok }: { ok: boolean }) =>
  ok ? (
    <CheckCircleFilled style={{ color: '#52c41a', fontSize: 16 }} />
  ) : (
    <CloseCircleFilled style={{ color: '#ff4d4f', fontSize: 16 }} />
  );

/** signed diff: red when |diff| ≥ 1 so'm, muted otherwise (float residue) */
function DiffCell({ value }: { value: string | number | null | undefined }) {
  const v = num(value);
  const bad = Math.abs(v) >= 1;
  return (
    <Typography.Text
      type={bad ? 'danger' : 'secondary'}
      strong={bad}
      style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}
    >
      {v > 0 ? '+' : ''}
      {fmtMoney(v)}
    </Typography.Text>
  );
}

function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <Alert
      type="error"
      showIcon
      message="Ma'lumotni yuklab bo'lmadi"
      description={apiError(error)}
      action={
        <Button size="small" danger onClick={onRetry}>
          Qayta urinish
        </Button>
      }
    />
  );
}

// ── upload/dry-run natijasi bloki ──

function RunResult({ run }: { run: RunState }) {
  const checks = getChecks(run.stats);
  const counts = getCounts(run.stats);
  const unmatched = getUnmatched(run.stats);
  const boxes = getCashboxBalances(run.stats);
  const unreconciled = num(numish(run.stats?.unreconciledTotal));
  const failed = checks.filter((c) => !checkOk(c)).length;
  const hasNegativeBox = boxes.some((b) => b.balance < 0);

  const boxColumns: TableProps<{ name: string; balance: number }>['columns'] = [
    { title: 'Kassa', dataIndex: 'name' },
    {
      title: 'Qoldiq',
      dataIndex: 'balance',
      align: 'right',
      render: (v: number) => (
        <Typography.Text type={v < 0 ? 'danger' : undefined} strong={v < 0} className="num">
          {fmtMoney(v)}
        </Typography.Text>
      ),
    },
  ];

  return (
    <Space direction="vertical" size={12} style={{ display: 'flex' }}>
      <Alert
        type={run.dryRun ? 'info' : 'success'}
        showIcon
        message={
          run.dryRun
            ? "Tekshirish (dry run) natijasi — bazaga hech narsa yozilmadi"
            : `Import bazaga kiritildi${run.batchId ? ` (batch: ${run.batchId})` : ''}`
        }
      />

      {checks.length > 0 && (
        <Card size="small" title="Tekshiruvlar" extra={failed > 0 ? <Tag color="red">{failed} ta o'tmadi</Tag> : <Tag color="green">Hammasi o'tdi</Tag>}>
          <List
            size="small"
            dataSource={checks}
            renderItem={(c) => (
              <List.Item>
                <Space wrap>
                  <OkIcon ok={checkOk(c)} />
                  <span>{checkLabel(c)}</span>
                  {checkDetail(c) && <Typography.Text type="secondary">{checkDetail(c)}</Typography.Text>}
                </Space>
              </List.Item>
            )}
          />
        </Card>
      )}

      {counts.length > 0 && (
        <Descriptions
          size="small"
          bordered
          column={{ xs: 1, sm: 2, lg: 4 }}
          items={counts.map(([k, v]) => ({ key: k, label: k, children: <span className="num">{v}</span> }))}
        />
      )}

      {unreconciled > 0 && (
        <Alert
          type="warning"
          showIcon
          message={`Оплата daftarida yo'q to'lovlar: ${fmtMoney(unreconciled)} so'm — import 'tekshirilsin' belgisi bilan kiritadi`}
        />
      )}

      {unmatched.length > 0 && (
        <Collapse
          size="small"
          items={unmatched.map((u) => ({
            key: u.key,
            label: `${u.label} (${u.items.length})`,
            children: (
              <ul style={{ margin: 0, paddingLeft: 20, maxHeight: 240, overflowY: 'auto' }}>
                {u.items.map((it, i) => (
                  <li key={i}>{it}</li>
                ))}
              </ul>
            ),
          }))}
        />
      )}

      {boxes.length > 0 && (
        <Card size="small" title="Kassa qoldiqlari (import bo'yicha)">
          {hasNegativeBox && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message="Manfiy kassa qoldig'i aniqlandi"
              description="Excel daftari kassalarning boshlang'ich qoldiqlarini o'z ichiga olmaydi — import oldidan (yoki keyin) kassalarga boshlang'ich qoldiqlarni kiriting, aks holda kassa hisobotlari noto'g'ri chiqadi."
            />
          )}
          <Table
            rowKey="name"
            size="small"
            columns={boxColumns}
            dataSource={boxes}
            pagination={false}
            scroll={{ x: 420 }}
          />
        </Card>
      )}
    </Space>
  );
}

// ── page ──

export default function Import() {
  const { message, modal } = App.useApp();
  const qc = useQueryClient();
  const { hasRole } = useAuth();
  const isAdmin = hasRole('ADMIN');

  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [lastRun, setLastRun] = useState<RunState | null>(null);
  const [selectedBatch, setSelectedBatch] = useState<{ id: string; filename: string } | null>(null);
  const [rollbackBatch, setRollbackBatch] = useState<BatchRow | null>(null);
  const [rollbackText, setRollbackText] = useState('');

  const batchesQ = useQuery({
    queryKey: ['import', 'batches'],
    queryFn: () => api.get<BatchRow[]>('/import/batches').then((r) => r.data),
  });

  const reconQ = useQuery({
    queryKey: ['import', 'reconciliation', selectedBatch?.id],
    queryFn: () =>
      api.get<Reconciliation>(`/import/batches/${selectedBatch!.id}/reconciliation`).then((r) => r.data),
    enabled: !!selectedBatch,
  });

  const runMut = useMutation({
    mutationFn: async (dryRun: boolean): Promise<RunState> => {
      const uf = fileList[0];
      const raw = (uf?.originFileObj ?? uf) as unknown as Blob | undefined;
      if (!uf || !raw) throw new Error('Avval .xlsx faylni tanlang');
      const fd = new FormData();
      fd.append('file', raw, uf.name);
      const res = await api.post<{ batchId?: string; stats?: ImportStats }>(
        `/import/excel?dryRun=${dryRun}`,
        fd,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );
      return { dryRun, ...res.data };
    },
    onSuccess: (r) => {
      setLastRun(r);
      if (r.dryRun) {
        message.success("Tekshirish yakunlandi — natijalarni ko'rib chiqing");
      } else {
        message.success('Import muvaffaqiyatli kiritildi');
        // import repopulates the whole base — every cached query is stale now
        qc.invalidateQueries();
        if (r.batchId) setSelectedBatch({ id: r.batchId, filename: fileList[0]?.name ?? 'import' });
      }
    },
    onError: (e) => message.error(apiError(e)),
  });

  const rollbackMut = useMutation({
    mutationFn: (id: string) => api.delete(`/import/batches/${id}`, { data: { confirm: true } }),
    onSuccess: (_res, id) => {
      message.success('Import orqaga qaytarildi (rollback)');
      setRollbackBatch(null);
      setRollbackText('');
      if (selectedBatch?.id === id) setSelectedBatch(null);
      qc.invalidateQueries();
    },
    onError: (e) => message.error(apiError(e)),
  });

  const askRealImport = () => {
    modal.confirm({
      title: 'Haqiqiy import',
      content: (
        <Space direction="vertical" size={8}>
          <Typography.Text>
            Import Excel daftaridagi barcha ma'lumotlarni bazaga yozadi. Bu amal faqat{' '}
            <Typography.Text strong>bo'sh bazaga</Typography.Text> bajarilishi kerak — mavjud
            mijozlar, buyurtmalar yoki to'lovlar bo'lsa, dublikatlar paydo bo'ladi.
          </Typography.Text>
          <Typography.Text type="secondary">
            Avval "Tekshirish (dry run)" bilan natijani ko'rib chiqqaningizga ishonch hosil qiling.
          </Typography.Text>
        </Space>
      ),
      okText: 'Import qilish',
      okButtonProps: { danger: true },
      cancelText: 'Bekor qilish',
      onOk: () => runMut.mutateAsync(false).then(() => undefined),
    });
  };

  const askRollback = (b: BatchRow) => {
    modal.confirm({
      title: 'Importni orqaga qaytarish',
      content: (
        <Typography.Text>
          "{b.filename}" ({fmtDateTime(b.createdAt)}) importidagi{' '}
          <Typography.Text strong type="danger">
            barcha yozuvlar bazadan o'chiriladi
          </Typography.Text>
          . Bu amalni qaytarib bo'lmaydi. Davom etasizmi?
        </Typography.Text>
      ),
      okText: 'Davom etish',
      okButtonProps: { danger: true },
      cancelText: 'Bekor qilish',
      onOk: () => {
        setRollbackText('');
        setRollbackBatch(b);
      },
    });
  };

  const batches = Array.isArray(batchesQ.data) ? batchesQ.data : [];

  const renderCounts = (stats?: ImportStats) => {
    const counts = getCounts(stats);
    if (!counts.length) return '—';
    const shown = counts.slice(0, 4);
    return (
      <Space size={4} wrap>
        {shown.map(([k, v]) => (
          <Tag key={k}>
            {k}: {v}
          </Tag>
        ))}
        {counts.length > 4 && <Tag>+{counts.length - 4}</Tag>}
      </Space>
    );
  };

  const batchColumns: TableProps<BatchRow>['columns'] = [
    { title: 'Fayl', dataIndex: 'filename', ellipsis: true },
    { title: 'Sana', dataIndex: 'createdAt', width: 150, render: (v: string) => fmtDateTime(v) },
    {
      title: 'Kim',
      dataIndex: 'createdBy',
      width: 140,
      render: (v: BatchRow['createdBy']) => (typeof v === 'string' ? v : v?.name ?? '—'),
    },
    { title: 'Yozuvlar', key: 'counts', render: (_, r) => renderCounts(r.stats) },
    {
      title: '',
      key: 'actions',
      width: 300,
      render: (_, r) => (
        <Space wrap>
          <Button
            size="small"
            icon={<DiffOutlined />}
            type={selectedBatch?.id === r.id ? 'primary' : 'default'}
            onClick={() => setSelectedBatch({ id: r.id, filename: r.filename })}
          >
            Solishtirish
          </Button>
          {isAdmin && (
            <Button size="small" danger icon={<UndoOutlined />} onClick={() => askRollback(r)}>
              Orqaga qaytarish
            </Button>
          )}
        </Space>
      ),
    },
  ];

  // ── reconciliation derived data ──

  const recon = reconQ.data;
  const sortedClients = useMemo(() => {
    const list = [...(recon?.clients ?? [])];
    list.sort((a, b) => {
      const aBad = !a.ok || !a.palletsOk ? 1 : 0;
      const bBad = !b.ok || !b.palletsOk ? 1 : 0;
      if (aBad !== bBad) return bBad - aBad;
      return Math.abs(num(b.diff)) - Math.abs(num(a.diff));
    });
    return list;
  }, [recon]);

  const badClients = (recon?.clients ?? []).filter((c) => !c.ok || !c.palletsOk).length;
  const factoryBad = recon?.factory ? recon.factory.ok === false : false;
  const mismatches = badClients + (factoryBad ? 1 : 0);
  const factoryDiff =
    recon?.factory?.diff ?? num(numish(recon?.factory?.actual)) - num(numish(recon?.factory?.expected));

  const clientColumns: TableProps<ReconClient>['columns'] = [
    {
      title: 'Mijoz',
      dataIndex: 'name',
      fixed: 'left',
      render: (v: string, r) => (
        <Space size={4} wrap>
          <span>{v}</span>
          {r.sheetless && <Tag color="orange">Varaqsiz</Tag>}
        </Space>
      ),
    },
    {
      title: 'Kutilgan (Excel)',
      dataIndex: 'expectedBalance',
      align: 'right',
      width: 150,
      render: (v: string | number) => <Money value={v} />,
    },
    {
      title: 'Haqiqiy (baza)',
      dataIndex: 'actualBalance',
      align: 'right',
      width: 150,
      render: (v: string | number) => <Money value={v} />,
    },
    {
      title: 'Farq',
      dataIndex: 'diff',
      align: 'right',
      width: 140,
      render: (v: string | number) => <DiffCell value={v} />,
    },
    {
      title: 'Balans',
      dataIndex: 'ok',
      align: 'center',
      width: 80,
      render: (v: boolean) => <OkIcon ok={v} />,
    },
    {
      title: 'Palletalar (Excel / baza)',
      key: 'pallets',
      align: 'center',
      width: 190,
      render: (_, r) => (
        <Space size={6}>
          <Typography.Text type={r.palletsOk ? undefined : 'danger'} className="num">
            {fmtNum(r.expectedPallets)} / {fmtNum(r.actualPallets)}
          </Typography.Text>
          <OkIcon ok={r.palletsOk} />
        </Space>
      ),
    },
  ];

  const flagged = recon?.flaggedPayments ?? [];
  const flaggedTotal = flagged.reduce((s, f) => s + num(numish(f.amount)), 0);
  const flaggedClientName = (r: FlaggedPayment): string => {
    if (typeof r.client === 'string') return r.client;
    return r.client?.name ?? r.clientName ?? '—';
  };

  const flaggedColumns: TableProps<FlaggedPayment>['columns'] = [
    { title: 'Sana', dataIndex: 'date', width: 120, render: (v?: string) => fmtDate(v) },
    { title: 'Mijoz', key: 'client', render: (_, r) => flaggedClientName(r) },
    {
      title: 'Summa',
      dataIndex: 'amount',
      align: 'right',
      width: 150,
      render: (v?: string | number) => <Money value={v} strong />,
    },
    { title: 'Izoh', dataIndex: 'note', ellipsis: true, render: (v?: string | null) => v || '—' },
  ];

  const anyRunPending = runMut.isPending;

  return (
    <Space direction="vertical" size={16} style={{ display: 'flex' }}>
      <Flex justify="space-between" align="center" wrap gap={8}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          Import va solishtirish
        </Typography.Title>
      </Flex>

      <Card size="small" title="Excel daftarini yuklash">
        <Space direction="vertical" size={12} style={{ display: 'flex' }}>
          <Upload.Dragger
            accept=".xlsx"
            maxCount={1}
            fileList={fileList}
            disabled={anyRunPending}
            beforeUpload={(file) => {
              setFileList([file]);
              return false;
            }}
            onRemove={() => {
              setFileList([]);
              return true;
            }}
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">Excel faylni (.xlsx) shu yerga tashlang yoki bosib tanlang</p>
            <p className="ant-upload-hint">«Газоблок Счёт» daftari — barcha varaqlar bilan</p>
          </Upload.Dragger>

          <Space wrap>
            <Button
              icon={<ExperimentOutlined />}
              disabled={!fileList.length || anyRunPending}
              loading={runMut.isPending && runMut.variables === true}
              onClick={() => runMut.mutate(true)}
            >
              Tekshirish (dry run)
            </Button>
            {isAdmin && (
              <Button
                type="primary"
                danger
                icon={<ImportOutlined />}
                disabled={!fileList.length || anyRunPending}
                loading={runMut.isPending && runMut.variables === false}
                onClick={askRealImport}
              >
                Import qilish
              </Button>
            )}
          </Space>

          {lastRun && <RunResult run={lastRun} />}
        </Space>
      </Card>

      <Card size="small" title="Import tarixi (batchlar)">
        {batchesQ.isError ? (
          <LoadError error={batchesQ.error} onRetry={() => batchesQ.refetch()} />
        ) : (
          <Table<BatchRow>
            rowKey="id"
            size="small"
            columns={batchColumns}
            dataSource={batches}
            loading={batchesQ.isFetching}
            pagination={false}
            scroll={{ x: 900 }}
            locale={{ emptyText: 'Hozircha importlar yo\'q' }}
          />
        )}
      </Card>

      {selectedBatch && (
        <Card
          size="small"
          title={`Solishtirish — ${selectedBatch.filename}`}
          extra={
            <Button size="small" onClick={() => setSelectedBatch(null)}>
              Yopish
            </Button>
          }
          loading={reconQ.isPending}
        >
          {reconQ.isError ? (
            <LoadError error={reconQ.error} onRetry={() => reconQ.refetch()} />
          ) : (
            recon && (
              <Space direction="vertical" size={12} style={{ display: 'flex' }}>
                <Alert
                  type={mismatches === 0 ? 'success' : 'error'}
                  showIcon
                  message={
                    mismatches === 0
                      ? "Hammasi mos — barcha balanslar Excel daftari bilan bir xil"
                      : `${mismatches} ta nomuvofiqlik topildi — quyidagi jadvaldagi qizil qatorlarni tekshiring`
                  }
                  description={typeof recon.summary === 'string' ? recon.summary : undefined}
                />

                {recon.factory && (
                  <Descriptions
                    size="small"
                    bordered
                    column={{ xs: 1, sm: 2, lg: 4 }}
                    title="Zavod balansi"
                    items={[
                      {
                        key: 'expected',
                        label: 'Kutilgan (Excel)',
                        children: <Money value={numish(recon.factory.expected)} />,
                      },
                      {
                        key: 'actual',
                        label: 'Haqiqiy (baza)',
                        children: <Money value={numish(recon.factory.actual)} />,
                      },
                      { key: 'diff', label: 'Farq', children: <DiffCell value={factoryDiff} /> },
                      { key: 'ok', label: 'Holat', children: <OkIcon ok={recon.factory.ok !== false} /> },
                    ]}
                  />
                )}

                <Table<ReconClient>
                  rowKey="name"
                  size="small"
                  columns={clientColumns}
                  dataSource={sortedClients}
                  pagination={{ pageSize: 20, showSizeChanger: true }}
                  scroll={{ x: 960 }}
                />

                <Card
                  size="small"
                  title={`Tekshirilishi kerak bo'lgan to'lovlar (${flagged.length})`}
                  extra={
                    flagged.length > 0 && (
                      <span>
                        Jami: <Money value={flaggedTotal} strong suffix="so'm" />
                      </span>
                    )
                  }
                >
                  {flagged.length > 0 && (
                    <Alert
                      type="warning"
                      showIcon
                      style={{ marginBottom: 12 }}
                      message="Оплата daftarida topilmagan to'lovlar — egasi bilan birgalikda tekshirilib tasdiqlanishi kerak"
                    />
                  )}
                  <Table<FlaggedPayment>
                    rowKey={(r, i) => r.id ?? String(i)}
                    size="small"
                    columns={flaggedColumns}
                    dataSource={flagged}
                    pagination={flagged.length > 20 ? { pageSize: 20 } : false}
                    scroll={{ x: 700 }}
                    locale={{ emptyText: "Tekshirilishi kerak to'lovlar yo'q" }}
                  />
                </Card>
              </Space>
            )
          )}
        </Card>
      )}

      <Modal
        title="Rollback — yakuniy tasdiqlash"
        open={!!rollbackBatch}
        onCancel={() => setRollbackBatch(null)}
        okText="Orqaga qaytarish"
        okButtonProps={{ danger: true, disabled: rollbackText.trim() !== 'ROLLBACK' }}
        cancelText="Bekor qilish"
        confirmLoading={rollbackMut.isPending}
        onOk={() => rollbackBatch && rollbackMut.mutate(rollbackBatch.id)}
      >
        <Space direction="vertical" size={8} style={{ display: 'flex' }}>
          <Typography.Text>
            "{rollbackBatch?.filename}" importidagi barcha yozuvlar bazadan o'chiriladi.
            Tasdiqlash uchun <Typography.Text code>ROLLBACK</Typography.Text> so'zini yozing:
          </Typography.Text>
          <Input
            value={rollbackText}
            onChange={(e) => setRollbackText(e.target.value)}
            placeholder="ROLLBACK"
            autoFocus
          />
        </Space>
      </Modal>
    </Space>
  );
}
