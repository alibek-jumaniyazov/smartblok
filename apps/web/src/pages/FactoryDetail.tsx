import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  DatePicker,
  Descriptions,
  Form,
  InputNumber,
  Modal,
  Radio,
  Row,
  Space,
  Spin,
  Statistic,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import type { TableColumnsType } from 'antd';
import { ArrowLeftOutlined, GiftOutlined, PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs, { type Dayjs } from 'dayjs';
import { apiError, endpoints } from '../lib/api';
import { fmtDate, fmtDateTime, fmtMoney, fmtNum, num, PAYMENT_KIND, PAYMENT_METHOD } from '../lib/format';
import { Money } from '../components/Money';
import { useAuth } from '../auth/AuthContext';
import type {
  BonusProgramKind,
  BonusTransactionType,
  LedgerEntryRow,
  PaymentKind,
  PaymentMethod,
} from '../lib/types';

const LEDGER_SOURCE: Record<string, string> = {
  ORDER_SALE: 'Buyurtma (sotuv)',
  ORDER_COST: 'Buyurtma (tannarx)',
  COST_ADJUSTMENT: 'Tannarx tuzatish',
  TRANSPORT_CHARGE: 'Transport (mijozga)',
  TRANSPORT_COST: 'Transport (shofyorga)',
  PAYMENT: "To'lov",
  PAYMENT_VOID: "To'lov bekor qilindi",
  ORDER_CANCEL: 'Buyurtma bekor qilindi',
  PALLET_CHARGE: "Paddon (yo'qolgan)",
  PALLET_RETURN_CREDIT: 'Paddon qaytarish krediti',
  BONUS_OFFSET: 'Bonus hisobga olish',
  ADJUSTMENT: 'Tuzatish',
  IMPORT: 'Import',
};

const PALLET_TYPE: Record<string, string> = {
  RECEIVED_FROM_FACTORY: 'Zavoddan olindi',
  DELIVERED_TO_CLIENT: 'Mijozga yetkazildi',
  RETURNED_BY_CLIENT: 'Mijoz qaytardi',
  RETURNED_TO_FACTORY: 'Zavodga qaytarildi',
  CHARGED_LOST: "Yo'qolgan (pulga o'tkazildi)",
  ADJUSTMENT: 'Tuzatish',
  REVERSAL: 'Bekor qilish',
};

const BONUS_KIND: Record<BonusProgramKind, string> = {
  NONE: "Bonus yo'q",
  PER_M3: 'Har m³ uchun stavka',
  PERCENT: 'Xarid summasidan foiz',
};

const BONUS_TX_TYPE: Record<BonusTransactionType, string> = {
  ACCRUAL: 'Hisoblandi',
  WITHDRAWAL: 'Yechildi',
  DEBT_OFFSET: 'Qarzga hisoblandi',
  ADJUSTMENT: 'Tuzatish',
  REVERSAL: 'Bekor qilindi',
};

interface BonusProgramRow {
  id: string;
  kind: BonusProgramKind;
  ratePerM3?: string | null;
  percent?: string | null;
  effectiveFrom: string;
  createdAt: string;
}

interface PaymentRow {
  id: string;
  date: string;
  kind: PaymentKind;
  method: PaymentMethod;
  amount: string;
  cashbox?: { name: string; type: string } | null;
  payerName?: string | null;
  receiverName?: string | null;
  note?: string | null;
}

interface BonusTxRow {
  id: string;
  at: string;
  type: BonusTransactionType;
  amount: string;
  baseAmount?: string | null;
  baseM3?: string | null;
  order?: { orderNo: string } | null;
  note?: string | null;
}

interface PalletTxRow {
  id: string;
  date: string;
  type: string;
  qty: number;
  unitPrice?: string | null;
  note?: string | null;
}

interface ProgramFormValues {
  kind: BonusProgramKind;
  ratePerM3?: number;
  percent?: number;
  effectiveFrom?: Dayjs;
}

const moneyFmt = (v: string | number | undefined) =>
  `${v ?? ''}`.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const moneyParse = (v: string | undefined) => (v ? v.replace(/\s/g, '') : '') as unknown as number;

export default function FactoryDetail() {
  const { id } = useParams<{ id: string }>();
  const { message } = App.useApp();
  const { hasRole } = useAuth();
  const qc = useQueryClient();
  const canEdit = hasRole('ADMIN', 'ACCOUNTANT');

  const [programOpen, setProgramOpen] = useState(false);
  const [form] = Form.useForm<ProgramFormValues>();
  const kindWatch = Form.useWatch('kind', form);

  const detailQ = useQuery({
    queryKey: ['factories', id],
    queryFn: () => endpoints.factory(id!),
    enabled: !!id,
  });
  const programQ = useQuery({
    queryKey: ['factories', id, 'bonus-program'],
    queryFn: () => endpoints.bonusProgram(id!),
    enabled: !!id,
  });
  const palletsQ = useQuery({
    queryKey: ['pallets', 'balances'],
    queryFn: () => endpoints.palletBalances(),
  });

  const setProgram = useMutation({
    mutationFn: (vals: ProgramFormValues) => {
      const payload: Record<string, unknown> = { kind: vals.kind };
      if (vals.kind === 'PER_M3') payload.ratePerM3 = vals.ratePerM3;
      if (vals.kind === 'PERCENT') payload.percent = vals.percent;
      if (vals.effectiveFrom) payload.effectiveFrom = vals.effectiveFrom.format('YYYY-MM-DD');
      return endpoints.setBonusProgram(id!, payload);
    },
    onSuccess: () => {
      message.success("Yangi bonus dasturi o'rnatildi");
      qc.invalidateQueries({ queryKey: ['factories'] });
      qc.invalidateQueries({ queryKey: ['bonus'] });
      setProgramOpen(false);
    },
    onError: (e) => message.error(apiError(e)),
  });

  if (detailQ.error) {
    return (
      <Alert
        type="error"
        showIcon
        message="Zavod ma'lumotini yuklashda xatolik"
        description={apiError(detailQ.error)}
        action={
          <Button size="small" onClick={() => detailQ.refetch()}>
            Qayta urinish
          </Button>
        }
      />
    );
  }
  if (detailQ.isLoading || !detailQ.data) {
    return <Spin size="large" style={{ display: 'block', margin: '20vh auto' }} />;
  }

  const detail = detailQ.data;
  const statement = (detail.statement ?? []) as LedgerEntryRow[];
  const payments = (detail.payments ?? []) as PaymentRow[];
  const bonusTransactions = (detail.bonusTransactions ?? []) as BonusTxRow[];
  const palletTransactions = (detail.palletTransactions ?? []) as PalletTxRow[];
  const program = (programQ.data ?? { current: null, history: [] }) as {
    current: BonusProgramRow | null;
    history: BonusProgramRow[];
  };
  const palletsHeld = palletsQ.data?.factories?.find((f) => f.factory.id === id)?.balance;
  const balanceNum = num(detail.balance as string | undefined);

  const statementCols: TableColumnsType<LedgerEntryRow> = [
    { title: 'Sana', dataIndex: 'date', key: 'date', width: 110, render: (v: string) => fmtDate(v) },
    {
      title: 'Manba',
      dataIndex: 'source',
      key: 'source',
      render: (v: string) => LEDGER_SOURCE[v] ?? v,
    },
    {
      title: 'Hujjat',
      key: 'doc',
      render: (_: unknown, r) =>
        r.order?.orderNo ??
        (r.payment ? `${PAYMENT_KIND[r.payment.kind]} · ${PAYMENT_METHOD[r.payment.method]}` : '—'),
    },
    { title: 'Izoh', dataIndex: 'note', key: 'note', ellipsis: true, render: (v: string | null) => v || '—' },
    {
      title: 'Summa',
      dataIndex: 'amount',
      key: 'amount',
      align: 'right',
      className: 'num',
      render: (v: string) => <Money value={v} signed />,
    },
    {
      title: 'Qoldiq',
      dataIndex: 'running',
      key: 'running',
      align: 'right',
      className: 'num',
      render: (v: string | undefined) => <Money value={v ?? '0'} signed strong />,
    },
  ];

  const paymentCols: TableColumnsType<PaymentRow> = [
    { title: 'Sana', dataIndex: 'date', key: 'date', width: 110, render: (v: string) => fmtDate(v) },
    { title: 'Turi', dataIndex: 'kind', key: 'kind', render: (v: PaymentKind) => PAYMENT_KIND[v] ?? v },
    { title: 'Usul', dataIndex: 'method', key: 'method', render: (v: PaymentMethod) => PAYMENT_METHOD[v] ?? v },
    {
      title: 'Summa',
      dataIndex: 'amount',
      key: 'amount',
      align: 'right',
      className: 'num',
      render: (v: string) => <Money value={v} strong />,
    },
    { title: 'Kassa', key: 'cashbox', render: (_: unknown, r) => r.cashbox?.name ?? '—' },
    { title: 'Izoh', dataIndex: 'note', key: 'note', ellipsis: true, render: (v: string | null) => v || '—' },
  ];

  const historyCols: TableColumnsType<BonusProgramRow> = [
    { title: 'Turi', dataIndex: 'kind', key: 'kind', render: (v: BonusProgramKind) => BONUS_KIND[v] ?? v },
    {
      title: 'Stavka / foiz',
      key: 'rate',
      align: 'right',
      className: 'num',
      render: (_: unknown, r) =>
        r.kind === 'PER_M3'
          ? `${fmtMoney(r.ratePerM3)} so'm/m³`
          : r.kind === 'PERCENT'
            ? `${fmtNum(r.percent, 2)} %`
            : '—',
    },
    {
      title: 'Kuchga kirgan',
      dataIndex: 'effectiveFrom',
      key: 'effectiveFrom',
      render: (v: string) => fmtDateTime(v),
    },
    { title: 'Kiritilgan', dataIndex: 'createdAt', key: 'createdAt', render: (v: string) => fmtDateTime(v) },
  ];

  const bonusTxCols: TableColumnsType<BonusTxRow> = [
    { title: 'Vaqt', dataIndex: 'at', key: 'at', width: 140, render: (v: string) => fmtDateTime(v) },
    { title: 'Turi', dataIndex: 'type', key: 'type', render: (v: BonusTransactionType) => BONUS_TX_TYPE[v] ?? v },
    {
      title: 'Summa',
      dataIndex: 'amount',
      key: 'amount',
      align: 'right',
      className: 'num',
      render: (v: string) => <Money value={v} signed />,
    },
    { title: 'Buyurtma', key: 'order', render: (_: unknown, r) => r.order?.orderNo ?? '—' },
    { title: 'Izoh', dataIndex: 'note', key: 'note', ellipsis: true, render: (v: string | null) => v || '—' },
  ];

  const palletCols: TableColumnsType<PalletTxRow> = [
    { title: 'Sana', dataIndex: 'date', key: 'date', width: 110, render: (v: string) => fmtDate(v) },
    { title: 'Turi', dataIndex: 'type', key: 'type', render: (v: string) => PALLET_TYPE[v] ?? v },
    { title: 'Soni', dataIndex: 'qty', key: 'qty', align: 'right', className: 'num', render: (v: number) => fmtNum(v) },
    {
      title: 'Narxi',
      dataIndex: 'unitPrice',
      key: 'unitPrice',
      align: 'right',
      className: 'num',
      render: (v: string | null) => (v ? <Money value={v} /> : '—'),
    },
    { title: 'Izoh', dataIndex: 'note', key: 'note', ellipsis: true, render: (v: string | null) => v || '—' },
  ];

  const currentProgramCard = (
    <Card
      size="small"
      title={
        <Space>
          <GiftOutlined />
          Joriy dastur
        </Space>
      }
      extra={
        canEdit && (
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              form.resetFields();
              form.setFieldsValue({ kind: 'PER_M3', effectiveFrom: dayjs() });
              setProgramOpen(true);
            }}
          >
            Yangi dastur
          </Button>
        )
      }
    >
      {programQ.error ? (
        <Alert
          type="error"
          showIcon
          message="Bonus dasturini yuklashda xatolik"
          description={apiError(programQ.error)}
          action={
            <Button size="small" onClick={() => programQ.refetch()}>
              Qayta urinish
            </Button>
          }
        />
      ) : program.current ? (
        <Descriptions
          column={3}
          size="small"
          items={[
            {
              key: 'kind',
              label: 'Turi',
              children: (
                <Tag color={program.current.kind === 'NONE' ? 'default' : 'purple'}>
                  {BONUS_KIND[program.current.kind]}
                </Tag>
              ),
            },
            {
              key: 'rate',
              label: 'Stavka / foiz',
              children:
                program.current.kind === 'PER_M3'
                  ? `${fmtMoney(program.current.ratePerM3)} so'm/m³`
                  : program.current.kind === 'PERCENT'
                    ? `${fmtNum(program.current.percent, 2)} %`
                    : '—',
            },
            {
              key: 'effectiveFrom',
              label: 'Kuchga kirgan',
              children: fmtDateTime(program.current.effectiveFrom),
            },
          ]}
        />
      ) : (
        <Typography.Text type="secondary">Bonus dasturi belgilanmagan</Typography.Text>
      )}
    </Card>
  );

  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <Space align="center" wrap>
        <Link to="/factories">
          <Button icon={<ArrowLeftOutlined />}>Zavodlar</Button>
        </Link>
        <Typography.Title level={3} style={{ margin: 0 }}>
          {detail.name}
        </Typography.Title>
        {detail.active ? <Tag color="green">Faol</Tag> : <Tag>Nofaol</Tag>}
      </Space>

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={8}>
          <Card size="small">
            <Statistic
              title={
                <Space>
                  Balans
                  {balanceNum > 0 ? (
                    <Tag color="green">Avans</Tag>
                  ) : balanceNum < 0 ? (
                    <Tag color="red">Qarz</Tag>
                  ) : null}
                </Space>
              }
              value={fmtMoney(detail.balance as string | undefined)}
              suffix="so'm"
              valueStyle={{ color: balanceNum > 0 ? '#3f8600' : balanceNum < 0 ? '#cf1322' : undefined }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card size="small">
            <Statistic
              title="Bonus hamyon"
              value={fmtMoney(detail.bonusBalance as string | undefined)}
              suffix="so'm"
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card size="small">
            <Statistic
              title="Paddonlar (zavod hisobida)"
              value={palletsHeld !== undefined ? fmtNum(palletsHeld) : '—'}
              suffix="dona"
            />
          </Card>
        </Col>
      </Row>

      <Card size="small">
        <Tabs
          items={[
            {
              key: 'statement',
              label: 'Hisob-kitob',
              children: (
                <div className="scroll-x">
                  <Table<LedgerEntryRow>
                    rowKey="id"
                    columns={statementCols}
                    dataSource={statement}
                    loading={detailQ.isFetching}
                    pagination={{ pageSize: 20, showSizeChanger: true }}
                    size="small"
                  />
                </div>
              ),
            },
            {
              key: 'payments',
              label: "To'lovlar",
              children: (
                <div className="scroll-x">
                  <Table<PaymentRow>
                    rowKey="id"
                    columns={paymentCols}
                    dataSource={payments}
                    loading={detailQ.isFetching}
                    pagination={{ pageSize: 20, showSizeChanger: true }}
                    size="small"
                  />
                </div>
              ),
            },
            {
              key: 'bonus',
              label: 'Bonus dasturi',
              children: (
                <Space orientation="vertical" size={16} style={{ width: '100%' }}>
                  <Alert
                    type="info"
                    showIcon
                    message="Dastur versiyalanadi"
                    description="Yangi sozlama faqat bundan keyin yakunlangan buyurtmalarga ta'sir qiladi — avval hisoblangan bonuslar qayta hisoblanmaydi."
                  />
                  {currentProgramCard}
                  <Card size="small" title="Dastur tarixi">
                    <div className="scroll-x">
                      <Table<BonusProgramRow>
                        rowKey="id"
                        columns={historyCols}
                        dataSource={program.history}
                        loading={programQ.isFetching}
                        pagination={false}
                        size="small"
                      />
                    </div>
                  </Card>
                  <Card size="small" title="Bonus harakatlari (oxirgi 50)">
                    <div className="scroll-x">
                      <Table<BonusTxRow>
                        rowKey="id"
                        columns={bonusTxCols}
                        dataSource={bonusTransactions}
                        loading={detailQ.isFetching}
                        pagination={{ pageSize: 10 }}
                        size="small"
                      />
                    </div>
                  </Card>
                </Space>
              ),
            },
            {
              key: 'pallets',
              label: 'Paddonlar',
              children: (
                <div className="scroll-x">
                  <Table<PalletTxRow>
                    rowKey="id"
                    columns={palletCols}
                    dataSource={palletTransactions}
                    loading={detailQ.isFetching}
                    pagination={{ pageSize: 20 }}
                    size="small"
                  />
                </div>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        title="Yangi bonus dasturi"
        open={programOpen}
        onCancel={() => setProgramOpen(false)}
        onOk={() => form.validateFields().then((vals) => setProgram.mutate(vals))}
        okText="O'rnatish"
        cancelText="Bekor qilish"
        confirmLoading={setProgram.isPending}
      >
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="Yangi sozlama faqat bundan keyin yakunlangan buyurtmalarga ta'sir qiladi"
        />
        <Form form={form} layout="vertical">
          <Form.Item name="kind" label="Dastur turi" rules={[{ required: true, message: 'Turini tanlang' }]}>
            <Radio.Group>
              <Radio.Button value="PER_M3">{BONUS_KIND.PER_M3}</Radio.Button>
              <Radio.Button value="PERCENT">{BONUS_KIND.PERCENT}</Radio.Button>
              <Radio.Button value="NONE">{BONUS_KIND.NONE}</Radio.Button>
            </Radio.Group>
          </Form.Item>
          {kindWatch === 'PER_M3' && (
            <Form.Item
              name="ratePerM3"
              label="Stavka (so'm / m³)"
              rules={[{ required: true, message: 'Stavka majburiy' }]}
            >
              <InputNumber
                min={0}
                style={{ width: '100%' }}
                formatter={moneyFmt}
                parser={moneyParse}
                placeholder="masalan 5 000"
              />
            </Form.Item>
          )}
          {kindWatch === 'PERCENT' && (
            <Form.Item
              name="percent"
              label="Foiz (%)"
              rules={[{ required: true, message: 'Foiz majburiy' }]}
            >
              <InputNumber min={0.01} max={100} step={0.1} style={{ width: '100%' }} placeholder="masalan 1.5" />
            </Form.Item>
          )}
          <Form.Item name="effectiveFrom" label="Kuchga kirish sanasi">
            <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
