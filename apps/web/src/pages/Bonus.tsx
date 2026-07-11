import { useEffect, useState } from 'react';
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
  Row,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { TableProps } from 'antd';
import { DollarOutlined, GiftOutlined, SwapOutlined, UndoOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import dayjs, { type Dayjs } from 'dayjs';
import { apiError, endpoints } from '../lib/api';
import { fmtDateTime, fmtM3, fmtMoney, fmtUZS, num } from '../lib/format';
import { Money } from '../components/Money';
import { useAuth } from '../auth/AuthContext';
import type { BonusTransaction, BonusTransactionType, Paged } from '../lib/types';

const BONUS_TYPE: Record<BonusTransactionType, { label: string; color: string }> = {
  ACCRUAL: { label: 'Hisoblandi', color: 'green' },
  WITHDRAWAL: { label: 'Yechib olindi', color: 'orange' },
  DEBT_OFFSET: { label: 'Qarzga hisoblandi', color: 'blue' },
  ADJUSTMENT: { label: 'Tuzatish', color: 'default' },
  REVERSAL: { label: 'Qaytarildi', color: 'red' },
};

type BonusTxRow = BonusTransaction & {
  program?: { id: string; kind: string; ratePerM3?: string | null; percent?: string | null } | null;
  payment?: { id: string; kind: string; method: string; amount: string; date: string } | null;
};

interface WithdrawVals {
  factoryId: string;
  amount: number;
  cashboxId: string;
  date: Dayjs;
  note?: string;
}

interface OffsetVals {
  factoryId: string;
  amount: number;
  date: Dayjs;
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

export default function Bonus() {
  const { message, modal } = App.useApp();
  const qc = useQueryClient();
  const { hasRole } = useAuth();
  const canMutate = hasRole('ADMIN', 'ACCOUNTANT');

  const [txFactoryId, setTxFactoryId] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [offsetOpen, setOffsetOpen] = useState(false);
  const [withdrawForm] = Form.useForm<WithdrawVals>();
  const [offsetForm] = Form.useForm<OffsetVals>();

  useEffect(() => {
    if (withdrawOpen) {
      withdrawForm.resetFields();
      withdrawForm.setFieldsValue({ date: dayjs() });
    }
  }, [withdrawOpen, withdrawForm]);

  useEffect(() => {
    if (offsetOpen) {
      offsetForm.resetFields();
      offsetForm.setFieldsValue({ date: dayjs() });
    }
  }, [offsetOpen, offsetForm]);

  const walletsQ = useQuery({ queryKey: ['bonus', 'wallets'], queryFn: () => endpoints.bonusWallets() });
  const boxesQ = useQuery({ queryKey: ['kassa', 'cashboxes'], queryFn: () => endpoints.cashboxes() });

  const txParams = { page, pageSize, factoryId: txFactoryId };
  const txQ = useQuery({
    queryKey: ['bonus', 'transactions', txParams],
    queryFn: () => endpoints.bonusTransactions(txParams) as Promise<Paged<BonusTxRow>>,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['bonus'] });
    qc.invalidateQueries({ queryKey: ['kassa'] });
    qc.invalidateQueries({ queryKey: ['factories'] });
    qc.invalidateQueries({ queryKey: ['payments'] });
    qc.invalidateQueries({ queryKey: ['debts'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const withdrawMut = useMutation({
    mutationFn: (d: object) => endpoints.bonusWithdraw(d),
    onSuccess: () => {
      message.success('Bonus naqd yechib olindi');
      invalidate();
      setWithdrawOpen(false);
    },
    onError: (e) => message.error(apiError(e)),
  });

  const offsetMut = useMutation({
    mutationFn: (d: object) => endpoints.bonusOffset(d),
    onSuccess: () => {
      message.success("Bonus zavod qarziga o'tkazildi");
      invalidate();
      setOffsetOpen(false);
    },
    onError: (e) => message.error(apiError(e)),
  });

  const reverseMut = useMutation({
    mutationFn: (d: { id: string; reason: string }) => endpoints.bonusReverse(d.id, d.reason),
    onSuccess: () => {
      message.success('Bonus operatsiyasi qaytarildi');
      invalidate();
    },
    onError: (e) => message.error(apiError(e)),
  });

  const askReverse = (row: BonusTxRow) => {
    let reason = '';
    modal.confirm({
      title: 'Yechib olishni qaytarish',
      content: (
        <div>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
            {row.factory?.name ?? 'Zavod'} — {fmtMoney(row.amount)} so'm. Hamyonga pul qaytadi, kassadan chiqim
            (storno) yoziladi.
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

  const wallets = walletsQ.data ?? [];
  const walletOptions = wallets.map((w) => ({
    value: w.factory.id,
    label: `${w.factory.name} (${fmtMoney(w.balance)} so'm)`,
  }));
  const uzsActiveBoxes = (boxesQ.data ?? []).filter((b) => b.active && b.currency === 'UZS');

  const wFactoryId = Form.useWatch('factoryId', withdrawForm);
  const oFactoryId = Form.useWatch('factoryId', offsetForm);
  const walletBalance = (factoryId: string | undefined) =>
    num(wallets.find((w) => w.factory.id === factoryId)?.balance);

  const maxRule = (factoryId: string | undefined) => ({
    validator: (_: unknown, v: number) => {
      if (v == null) return Promise.resolve();
      const bal = walletBalance(factoryId);
      if (v > bal) return Promise.reject(new Error(`Hamyon balansidan oshiq (balans: ${fmtMoney(bal)} so'm)`));
      return Promise.resolve();
    },
  });

  const txColumns: TableProps<BonusTxRow>['columns'] = [
    { title: 'Sana', dataIndex: 'at', width: 140, render: (v: string) => fmtDateTime(v) },
    { title: 'Zavod', key: 'factory', render: (_, r) => r.factory?.name ?? '—' },
    {
      title: 'Turi',
      dataIndex: 'type',
      width: 160,
      render: (v: BonusTransactionType) => {
        const t = BONUS_TYPE[v] ?? { label: v, color: 'default' };
        return <Tag color={t.color}>{t.label}</Tag>;
      },
    },
    {
      title: 'Summa',
      dataIndex: 'amount',
      align: 'right',
      width: 150,
      render: (v: string) => <Money value={v} signed strong />,
    },
    {
      title: 'Buyurtma / asos',
      key: 'order',
      render: (_, r) => {
        const baseInfo = [
          r.baseM3 ? `Asos hajm: ${fmtM3(r.baseM3)}` : null,
          r.baseAmount ? `Asos summa: ${fmtUZS(r.baseAmount)}` : null,
          r.program?.kind === 'PER_M3' && r.program?.ratePerM3 ? `Stavka: ${fmtMoney(r.program.ratePerM3)} so'm/m³` : null,
          r.program?.kind === 'PERCENT' && r.program?.percent ? `Foiz: ${r.program.percent}%` : null,
        ]
          .filter(Boolean)
          .join(' · ');
        if (r.order) {
          const link = <Link to={`/orders/${r.order.id}`}>{r.order.orderNo}</Link>;
          return baseInfo ? <Tooltip title={baseInfo}>{link}</Tooltip> : link;
        }
        if (baseInfo) {
          return (
            <Tooltip title={baseInfo}>
              <Typography.Text type="secondary">ma'lumot</Typography.Text>
            </Tooltip>
          );
        }
        return '—';
      },
    },
    { title: 'Izoh', dataIndex: 'note', ellipsis: true, render: (v: string | null) => v || '—' },
    {
      title: '',
      key: 'actions',
      width: 130,
      render: (_, r) =>
        canMutate && r.type === 'WITHDRAWAL' ? (
          <Button size="small" danger icon={<UndoOutlined />} onClick={() => askReverse(r)}>
            Qaytarish
          </Button>
        ) : null,
    },
  ];

  return (
    <Space orientation="vertical" size={16} style={{ display: 'flex' }}>
      <Flex justify="space-between" align="center" wrap gap={8}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          Bonus hamyonlar
        </Typography.Title>
        {canMutate && (
          <Space wrap>
            <Button type="primary" icon={<DollarOutlined />} onClick={() => setWithdrawOpen(true)}>
              Naqd yechish
            </Button>
            <Button icon={<SwapOutlined />} onClick={() => setOffsetOpen(true)}>
              Zavod qarziga o'tkazish
            </Button>
          </Space>
        )}
      </Flex>

      {walletsQ.isError ? (
        <LoadError error={walletsQ.error} onRetry={() => walletsQ.refetch()} />
      ) : (
        <Row gutter={[12, 12]}>
          {walletsQ.isPending
            ? [0, 1, 2].map((i) => (
                <Col key={i} xs={24} sm={12} lg={6}>
                  <Card size="small" loading />
                </Col>
              ))
            : wallets.map((w) => (
                <Col key={w.factory.id} xs={24} sm={12} lg={6}>
                  <Card size="small">
                    <Space size={6} wrap>
                      <GiftOutlined />
                      <Typography.Text strong>{w.factory.name}</Typography.Text>
                      {!w.factory.active && <Tag>faol emas</Tag>}
                    </Space>
                    <div style={{ fontSize: 22, marginTop: 6 }}>
                      <Money value={w.balance} strong suffix="so'm" />
                    </div>
                  </Card>
                </Col>
              ))}
        </Row>
      )}

      <Card size="small" title="Bonus operatsiyalari">
        <Space wrap style={{ marginBottom: 12 }}>
          <Select
            allowClear
            placeholder="Zavod"
            style={{ minWidth: 220 }}
            options={wallets.map((w) => ({ value: w.factory.id, label: w.factory.name }))}
            value={txFactoryId}
            onChange={(v) => {
              setTxFactoryId(v);
              setPage(1);
            }}
            showSearch
            optionFilterProp="label"
          />
        </Space>
        {txQ.isError ? (
          <LoadError error={txQ.error} onRetry={() => txQ.refetch()} />
        ) : (
          <Table<BonusTxRow>
            rowKey="id"
            size="small"
            columns={txColumns}
            dataSource={txQ.data?.items ?? []}
            loading={txQ.isFetching}
            scroll={{ x: 1000 }}
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

      {/* withdraw */}
      <Modal
        title="Bonusni naqd yechish"
        open={withdrawOpen}
        onCancel={() => setWithdrawOpen(false)}
        onOk={() => withdrawForm.submit()}
        okText="Yechish"
        cancelText="Bekor qilish"
        confirmLoading={withdrawMut.isPending}
      >
        <Form
          form={withdrawForm}
          layout="vertical"
          onFinish={(v: WithdrawVals) =>
            withdrawMut.mutate({
              factoryId: v.factoryId,
              amount: v.amount,
              cashboxId: v.cashboxId,
              date: v.date.format('YYYY-MM-DD'),
              note: v.note?.trim() ? v.note.trim() : undefined,
            })
          }
        >
          <Form.Item name="factoryId" label="Zavod" rules={[{ required: true, message: 'Zavodni tanlang' }]}>
            <Select placeholder="Zavodni tanlang" options={walletOptions} showSearch optionFilterProp="label" />
          </Form.Item>
          {wFactoryId && (
            <Typography.Paragraph type="secondary" style={{ marginTop: -8 }}>
              Hamyon balansi: {fmtMoney(walletBalance(wFactoryId))} so'm
            </Typography.Paragraph>
          )}
          <Form.Item
            name="amount"
            label="Summa"
            dependencies={['factoryId']}
            rules={[{ required: true, message: 'Summani kiriting' }, maxRule(wFactoryId)]}
          >
            <InputNumber
              min={0}
              style={{ width: '100%' }}
              formatter={moneyFormatter}
              parser={moneyParser}
              placeholder="0"
            />
          </Form.Item>
          <Form.Item
            name="cashboxId"
            label="Kassa (faqat UZS)"
            rules={[{ required: true, message: 'Kassani tanlang' }]}
          >
            <Select
              placeholder="Kassani tanlang"
              options={uzsActiveBoxes.map((b) => ({ value: b.id, label: b.name }))}
              showSearch
              optionFilterProp="label"
            />
          </Form.Item>
          <Form.Item name="date" label="Sana" rules={[{ required: true, message: 'Sanani tanlang' }]}>
            <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
          </Form.Item>
          <Form.Item name="note" label="Izoh">
            <Input.TextArea rows={2} placeholder="Izoh (ixtiyoriy)" />
          </Form.Item>
        </Form>
      </Modal>

      {/* offset */}
      <Modal
        title="Bonusni zavod qarziga o'tkazish"
        open={offsetOpen}
        onCancel={() => setOffsetOpen(false)}
        onOk={() => offsetForm.submit()}
        okText="O'tkazish"
        cancelText="Bekor qilish"
        confirmLoading={offsetMut.isPending}
      >
        <Form
          form={offsetForm}
          layout="vertical"
          onFinish={(v: OffsetVals) =>
            offsetMut.mutate({
              factoryId: v.factoryId,
              amount: v.amount,
              date: v.date.format('YYYY-MM-DD'),
              note: v.note?.trim() ? v.note.trim() : undefined,
            })
          }
        >
          <Form.Item name="factoryId" label="Zavod" rules={[{ required: true, message: 'Zavodni tanlang' }]}>
            <Select placeholder="Zavodni tanlang" options={walletOptions} showSearch optionFilterProp="label" />
          </Form.Item>
          {oFactoryId && (
            <Typography.Paragraph type="secondary" style={{ marginTop: -8 }}>
              Hamyon balansi: {fmtMoney(walletBalance(oFactoryId))} so'm
            </Typography.Paragraph>
          )}
          <Form.Item
            name="amount"
            label="Summa"
            dependencies={['factoryId']}
            rules={[{ required: true, message: 'Summani kiriting' }, maxRule(oFactoryId)]}
          >
            <InputNumber
              min={0}
              style={{ width: '100%' }}
              formatter={moneyFormatter}
              parser={moneyParser}
              placeholder="0"
            />
          </Form.Item>
          <Form.Item name="date" label="Sana" rules={[{ required: true, message: 'Sanani tanlang' }]}>
            <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
          </Form.Item>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="Bonus zavodga to'lov (BONUS usulida) sifatida yoziladi va zavodga bo'lgan qarzimizni kamaytiradi."
          />
          <Form.Item name="note" label="Izoh">
            <Input.TextArea rows={2} placeholder="Izoh (ixtiyoriy)" />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
