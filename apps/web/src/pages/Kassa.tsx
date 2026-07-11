import { useEffect, useState, type ReactNode } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  DatePicker,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { TableProps } from 'antd';
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  BankOutlined,
  CreditCardOutlined,
  MobileOutlined,
  PlusOutlined,
  UndoOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs, { type Dayjs } from 'dayjs';
import { apiError, endpoints } from '../lib/api';
import { fmtDateTime, fmtMoney, PAYMENT_KIND } from '../lib/format';
import { Money } from '../components/Money';
import { useAuth } from '../auth/AuthContext';
import type { CashDirection, CashTransaction, Cashbox, Paged, PaymentKind } from '../lib/types';

const { RangePicker } = DatePicker;

const BOX_ICON: Record<Cashbox['type'], ReactNode> = {
  CASH: <WalletOutlined />,
  BANK: <BankOutlined />,
  CLICK: <MobileOutlined />,
  TERMINAL: <CreditCardOutlined />,
  CARD: <CreditCardOutlined />,
};

const SOURCE_LABEL: Record<CashTransaction['source'], { label: string; color: string }> = {
  MANUAL: { label: "Qo'lda", color: 'default' },
  PAYMENT: { label: "To'lov", color: 'blue' },
  EXPENSE: { label: 'Xarajat', color: 'orange' },
  BONUS_WITHDRAWAL: { label: 'Bonus yechish', color: 'purple' },
  REVERSAL: { label: 'Storno', color: 'red' },
};

interface KassaTxRow extends CashTransaction {
  payment?: {
    id: string;
    kind: PaymentKind;
    method: string;
    amount: string;
    date: string;
    voidedAt?: string | null;
    client?: { id: string; name: string } | null;
    factory?: { id: string; name: string } | null;
    vehicle?: { id: string; name: string } | null;
  } | null;
  expense?: {
    id: string;
    amount: string;
    date: string;
    note?: string | null;
    voidedAt?: string | null;
    category?: { id: string; name: string } | null;
  } | null;
  bonusTransaction?: {
    id: string;
    type: string;
    amount: string;
    factory?: { id: string; name: string } | null;
  } | null;
  reversalOf?: { id: string; direction: CashDirection; amount: string; source: string; date: string } | null;
  reversedBy?: { id: string; date: string; note?: string | null } | null;
  createdBy?: { id: string; name: string } | null;
}

interface KassaSummaryRow {
  id: string;
  name: string;
  type: Cashbox['type'];
  currency: 'UZS' | 'USD';
  active: boolean;
  opening: string;
  in: string;
  out: string;
  closing: string;
}

interface KassaSummary {
  dateFrom: string | null;
  dateTo: string | null;
  cashboxes: KassaSummaryRow[];
  totals: { UZS: string; USD: string };
}

interface ManualFormVals {
  cashboxId: string;
  direction: CashDirection;
  amount: number;
  date?: Dayjs;
  note?: string;
}

const moneyFormatter = (v: string | number | undefined) => `${v ?? ''}`.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const moneyParser = (v: string | undefined) => Number((v ?? '').replace(/\s/g, ''));

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

function renderRef(r: KassaTxRow): ReactNode {
  if (r.payment) {
    const party = r.payment.client?.name ?? r.payment.factory?.name ?? r.payment.vehicle?.name ?? '';
    return (
      <Space size={4} wrap>
        <Tag color="blue">{PAYMENT_KIND[r.payment.kind] ?? r.payment.kind}</Tag>
        {party && <Typography.Text>{party}</Typography.Text>}
      </Space>
    );
  }
  if (r.expense) {
    return (
      <Space size={4} wrap>
        <Tag color="orange">Xarajat</Tag>
        {r.expense.category?.name && <Typography.Text>{r.expense.category.name}</Typography.Text>}
      </Space>
    );
  }
  if (r.bonusTransaction) {
    return (
      <Space size={4} wrap>
        <Tag color="purple">Bonus</Tag>
        {r.bonusTransaction.factory?.name && <Typography.Text>{r.bonusTransaction.factory.name}</Typography.Text>}
      </Space>
    );
  }
  if (r.reversalOf) {
    return (
      <Typography.Text type="secondary">
        Storno: {fmtMoney(r.reversalOf.amount)} ({fmtDateTime(r.reversalOf.date)})
      </Typography.Text>
    );
  }
  return '—';
}

export default function Kassa() {
  const { message, modal } = App.useApp();
  const qc = useQueryClient();
  const { hasRole } = useAuth();
  const canManual = hasRole('ADMIN', 'ACCOUNTANT', 'CASHIER');
  const canReverse = hasRole('ADMIN', 'ACCOUNTANT');

  // transactions filters + paging
  const [cashboxId, setCashboxId] = useState<string | undefined>();
  const [direction, setDirection] = useState<string | undefined>();
  const [source, setSource] = useState<string | undefined>();
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // summary strip has its own period
  const [sumRange, setSumRange] = useState<[Dayjs | null, Dayjs | null] | null>([dayjs().startOf('month'), dayjs()]);

  const [manualOpen, setManualOpen] = useState(false);
  const [form] = Form.useForm<ManualFormVals>();

  useEffect(() => {
    if (manualOpen) {
      form.resetFields();
      form.setFieldsValue({ direction: 'IN', date: dayjs() });
    }
  }, [manualOpen, form]);

  const boxesQ = useQuery({ queryKey: ['kassa', 'cashboxes'], queryFn: () => endpoints.cashboxes() });

  const txParams = {
    page,
    pageSize,
    cashboxId,
    direction,
    source,
    dateFrom: range?.[0]?.format('YYYY-MM-DD'),
    dateTo: range?.[1]?.format('YYYY-MM-DD'),
  };
  const txQ = useQuery({
    queryKey: ['kassa', 'transactions', txParams],
    queryFn: () => endpoints.kassaTransactions(txParams) as Promise<Paged<KassaTxRow>>,
  });

  const sumParams = {
    dateFrom: sumRange?.[0]?.format('YYYY-MM-DD'),
    dateTo: sumRange?.[1]?.format('YYYY-MM-DD'),
  };
  const sumQ = useQuery({
    queryKey: ['kassa', 'summary', sumParams],
    queryFn: () => endpoints.kassaSummary(sumParams) as Promise<KassaSummary>,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['kassa'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const manualMut = useMutation({
    mutationFn: (d: object) => endpoints.kassaManual(d),
    onSuccess: () => {
      message.success('Kassa yozuvi saqlandi');
      invalidate();
      setManualOpen(false);
    },
    onError: (e) => message.error(apiError(e)),
  });

  const reverseMut = useMutation({
    mutationFn: (d: { id: string; reason: string }) => endpoints.kassaReverse(d.id, d.reason),
    onSuccess: () => {
      message.success('Tranzaksiya qaytarildi (storno)');
      invalidate();
    },
    onError: (e) => message.error(apiError(e)),
  });

  const askReverse = (row: KassaTxRow) => {
    let reason = '';
    modal.confirm({
      title: 'Tranzaksiyani qaytarish (storno)',
      content: (
        <div>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
            {row.cashbox?.name ?? 'Kassa'} — {row.direction === 'IN' ? 'kirim' : 'chiqim'} {fmtMoney(row.amount)}.
            Qarama-qarshi yozuv yaratiladi.
          </Typography.Paragraph>
          <Input.TextArea
            rows={3}
            placeholder="Sabab (majburiy)"
            onChange={(e) => {
              reason = e.target.value;
            }}
          />
        </div>
      ),
      okText: 'Qaytarish',
      okButtonProps: { danger: true },
      cancelText: 'Bekor qilish',
      onOk: () => {
        if (!reason.trim()) {
          message.warning('Sababni kiritish majburiy');
          return Promise.reject(new Error('reason required'));
        }
        return reverseMut.mutateAsync({ id: row.id, reason: reason.trim() });
      },
    });
  };

  const submitManual = (v: ManualFormVals) => {
    manualMut.mutate({
      cashboxId: v.cashboxId,
      direction: v.direction,
      amount: v.amount,
      date: v.date ? v.date.format('YYYY-MM-DD') : undefined,
      note: v.note?.trim() ? v.note.trim() : undefined,
    });
  };

  const boxes = boxesQ.data ?? [];
  const activeBoxes = boxes.filter((b) => b.active);
  const boxOptions = boxes.map((b) => ({ value: b.id, label: `${b.name} (${b.currency})` }));

  const txColumns: TableProps<KassaTxRow>['columns'] = [
    { title: 'Sana', dataIndex: 'date', width: 140, render: (v: string) => fmtDateTime(v) },
    {
      title: 'Kassa',
      key: 'cashbox',
      render: (_, r) => (
        <Space size={4}>
          {r.cashbox ? BOX_ICON[r.cashbox.type] : null}
          <span>{r.cashbox?.name ?? '—'}</span>
          {r.cashbox?.currency === 'USD' && <Tag color="green">USD</Tag>}
        </Space>
      ),
    },
    {
      title: "Yo'nalish",
      dataIndex: 'direction',
      width: 110,
      render: (v: CashDirection) =>
        v === 'IN' ? (
          <Tag color="green" icon={<ArrowDownOutlined />}>
            Kirim
          </Tag>
        ) : (
          <Tag color="red" icon={<ArrowUpOutlined />}>
            Chiqim
          </Tag>
        ),
    },
    {
      title: 'Summa',
      dataIndex: 'amount',
      align: 'right',
      width: 140,
      render: (v: string, r) => (
        <Typography.Text
          className="num"
          type={r.direction === 'IN' ? 'success' : 'danger'}
          style={{ whiteSpace: 'nowrap' }}
        >
          {r.direction === 'IN' ? '+' : '−'}
          {fmtMoney(v)}
        </Typography.Text>
      ),
    },
    {
      title: 'Manba',
      dataIndex: 'source',
      width: 130,
      render: (v: KassaTxRow['source']) => {
        const s = SOURCE_LABEL[v] ?? { label: v, color: 'default' };
        return <Tag color={s.color}>{s.label}</Tag>;
      },
    },
    { title: "Bog'liq hujjat", key: 'ref', render: (_, r) => renderRef(r) },
    { title: 'Izoh', dataIndex: 'note', ellipsis: true, render: (v: string | null) => v || '—' },
    {
      title: '',
      key: 'actions',
      width: 130,
      render: (_, r) => {
        if (r.source !== 'MANUAL') return null;
        if (r.reversedBy) return <Tag>Qaytarilgan</Tag>;
        if (!canReverse) return null;
        return (
          <Button size="small" danger icon={<UndoOutlined />} onClick={() => askReverse(r)}>
            Qaytarish
          </Button>
        );
      },
    },
  ];

  const sumColumns: TableProps<KassaSummaryRow>['columns'] = [
    {
      title: 'Kassa',
      dataIndex: 'name',
      render: (v: string, r) => (
        <Space size={4}>
          {BOX_ICON[r.type]}
          <span>{v}</span>
          <Tag color={r.currency === 'USD' ? 'green' : 'blue'}>{r.currency}</Tag>
        </Space>
      ),
    },
    {
      title: "Boshlang'ich",
      dataIndex: 'opening',
      align: 'right',
      render: (v: string) => <Money value={v} />,
    },
    {
      title: 'Kirim',
      dataIndex: 'in',
      align: 'right',
      render: (v: string) => (
        <Typography.Text type="success" className="num">
          +{fmtMoney(v)}
        </Typography.Text>
      ),
    },
    {
      title: 'Chiqim',
      dataIndex: 'out',
      align: 'right',
      render: (v: string) => (
        <Typography.Text type="danger" className="num">
          −{fmtMoney(v)}
        </Typography.Text>
      ),
    },
    {
      title: 'Yakuniy',
      dataIndex: 'closing',
      align: 'right',
      render: (v: string) => <Money value={v} strong />,
    },
  ];

  return (
    <Space direction="vertical" size={16} style={{ display: 'flex' }}>
      <Flex justify="space-between" align="center" wrap gap={8}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          Kassa
        </Typography.Title>
        {canManual && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setManualOpen(true)}>
            Qo'lda kirim/chiqim
          </Button>
        )}
      </Flex>

      {boxesQ.isError ? (
        <LoadError error={boxesQ.error} onRetry={() => boxesQ.refetch()} />
      ) : (
        <Row gutter={[12, 12]}>
          {boxesQ.isPending
            ? [0, 1, 2, 3].map((i) => (
                <Col key={i} xs={24} sm={12} lg={6}>
                  <Card size="small" loading />
                </Col>
              ))
            : boxes.map((b) => (
                <Col key={b.id} xs={24} sm={12} lg={6}>
                  <Card size="small">
                    <Space size={6} wrap>
                      {BOX_ICON[b.type]}
                      <Typography.Text strong>{b.name}</Typography.Text>
                      <Tag color={b.currency === 'USD' ? 'green' : 'blue'}>{b.currency}</Tag>
                      {!b.active && <Tag>faol emas</Tag>}
                    </Space>
                    <div style={{ fontSize: 22, marginTop: 6 }}>
                      <Money value={b.balance} strong suffix={b.currency === 'USD' ? '$' : "so'm"} />
                    </div>
                  </Card>
                </Col>
              ))}
        </Row>
      )}

      <Card
        size="small"
        title="Davr bo'yicha xulosa"
        extra={<RangePicker value={sumRange} onChange={(v) => setSumRange(v)} allowClear />}
      >
        {sumQ.isError ? (
          <LoadError error={sumQ.error} onRetry={() => sumQ.refetch()} />
        ) : (
          <>
            <Table<KassaSummaryRow>
              rowKey="id"
              size="small"
              columns={sumColumns}
              dataSource={sumQ.data?.cashboxes ?? []}
              loading={sumQ.isFetching}
              pagination={false}
              scroll={{ x: 720 }}
            />
            {sumQ.data && (
              <Space size="large" style={{ marginTop: 12 }} wrap>
                <span>
                  Jami UZS: <Money value={sumQ.data.totals.UZS} strong suffix="so'm" />
                </span>
                <span>
                  Jami USD: <Money value={sumQ.data.totals.USD} strong suffix="$" />
                </span>
              </Space>
            )}
          </>
        )}
      </Card>

      <Card size="small" title="Tranzaksiyalar">
        <Space wrap style={{ marginBottom: 12 }}>
          <Select
            allowClear
            placeholder="Kassa"
            style={{ minWidth: 180 }}
            options={boxOptions}
            value={cashboxId}
            onChange={(v) => {
              setCashboxId(v);
              setPage(1);
            }}
            showSearch
            optionFilterProp="label"
          />
          <Select
            allowClear
            placeholder="Yo'nalish"
            style={{ minWidth: 130 }}
            options={[
              { value: 'IN', label: 'Kirim' },
              { value: 'OUT', label: 'Chiqim' },
            ]}
            value={direction}
            onChange={(v) => {
              setDirection(v);
              setPage(1);
            }}
          />
          <Select
            allowClear
            placeholder="Manba"
            style={{ minWidth: 160 }}
            options={Object.entries(SOURCE_LABEL).map(([value, s]) => ({ value, label: s.label }))}
            value={source}
            onChange={(v) => {
              setSource(v);
              setPage(1);
            }}
          />
          <RangePicker
            value={range}
            onChange={(v) => {
              setRange(v);
              setPage(1);
            }}
          />
        </Space>
        {txQ.isError ? (
          <LoadError error={txQ.error} onRetry={() => txQ.refetch()} />
        ) : (
          <Table<KassaTxRow>
            rowKey="id"
            size="small"
            columns={txColumns}
            dataSource={txQ.data?.items ?? []}
            loading={txQ.isFetching}
            scroll={{ x: 1100 }}
            pagination={{
              current: page,
              pageSize,
              total: txQ.data?.total ?? 0,
              showSizeChanger: true,
              onChange: (p, ps) => {
                setPage(p);
                setPageSize(ps);
              },
            }}
          />
        )}
      </Card>

      <Modal
        title="Qo'lda kirim/chiqim"
        open={manualOpen}
        onCancel={() => setManualOpen(false)}
        onOk={() => form.submit()}
        okText="Saqlash"
        cancelText="Bekor qilish"
        confirmLoading={manualMut.isPending}
      >
        <Form form={form} layout="vertical" onFinish={submitManual}>
          <Form.Item name="cashboxId" label="Kassa" rules={[{ required: true, message: 'Kassani tanlang' }]}>
            <Select
              placeholder="Kassani tanlang"
              options={activeBoxes.map((b) => ({ value: b.id, label: `${b.name} (${b.currency})` }))}
              showSearch
              optionFilterProp="label"
            />
          </Form.Item>
          <Form.Item name="direction" label="Yo'nalish" rules={[{ required: true, message: "Yo'nalishni tanlang" }]}>
            <Radio.Group
              optionType="button"
              buttonStyle="solid"
              options={[
                { value: 'IN', label: 'Kirim' },
                { value: 'OUT', label: 'Chiqim' },
              ]}
            />
          </Form.Item>
          <Form.Item name="amount" label="Summa" rules={[{ required: true, message: 'Summani kiriting' }]}>
            <InputNumber
              min={0}
              style={{ width: '100%' }}
              formatter={moneyFormatter}
              parser={moneyParser}
              placeholder="0"
            />
          </Form.Item>
          <Form.Item name="date" label="Sana">
            <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
          </Form.Item>
          <Form.Item name="note" label="Izoh">
            <Input.TextArea rows={2} placeholder="Izoh (ixtiyoriy)" maxLength={1000} />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
