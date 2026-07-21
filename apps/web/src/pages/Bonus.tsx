import { useEffect, useState, type ReactNode } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Tooltip,
  Typography,
} from 'antd';
import { DollarOutlined, GiftOutlined, SwapOutlined, UndoOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import dayjs, { type Dayjs } from 'dayjs';
import { apiError, endpoints } from '../lib/api';
import { fmtDateTime, fmtM3, fmtMoney, fmtUZS, num } from '../lib/format';
import { BONUS_TX } from '../lib/status-maps';
import { DataTable, FormDrawer, MoneyCell, StatCard, StatusChip, TableCard, type SbColumn } from '../components';
import { PageHeader } from '../components/PageHeader';
import { modalWidth, useIsDesktop, useIsPhone } from '../lib/responsive';
import { useAuth } from '../auth/AuthContext';
import { useUrlFilters } from '../lib/useUrlFilters';
import { useT } from '../components/LangContext';
import type { BonusTransaction, BonusTransactionType, Paged } from '../lib/types';

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

export default function Bonus() {
  const { message, modal } = App.useApp();
  const t = useT();
  const qc = useQueryClient();
  const { hasRole } = useAuth();
  const canMutate = hasRole('ADMIN', 'ACCOUNTANT');
  // MOBIL: telefonda operatsiyalar jadvali kartaga, «asos» tooltip'i esa
  // ko'rinadigan satrga aylanadi (spec R12). Desktop (>= 992px) o'zgarmaydi.
  const isPhone = useIsPhone();
  const isDesktop = useIsDesktop();

  const uf = useUrlFilters(['factoryId']);
  const txFactoryId = uf.get('factoryId') || undefined;
  const page = Number(uf.get('page')) || 1;
  const pageSize = Number(uf.get('pageSize')) || 20;

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
      message.success(t('Bonus naqd yechib olindi'));
      invalidate();
      setWithdrawOpen(false);
    },
    onError: (e) => message.error(apiError(e)),
  });

  const offsetMut = useMutation({
    mutationFn: (d: object) => endpoints.bonusOffset(d),
    onSuccess: () => {
      message.success(t("Bonus zavod qarziga o'tkazildi"));
      invalidate();
      setOffsetOpen(false);
    },
    onError: (e) => message.error(apiError(e)),
  });

  const reverseMut = useMutation({
    mutationFn: (d: { id: string; reason: string }) => endpoints.bonusReverse(d.id, d.reason),
    onSuccess: () => {
      message.success(t('Bonus operatsiyasi qaytarildi'));
      invalidate();
    },
    onError: (e) => message.error(apiError(e)),
  });

  const askReverse = (row: BonusTxRow) => {
    let reason = '';
    modal.confirm({
      title: t('Yechib olishni qaytarish'),
      content: (
        <div>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
            {t("{factory} — {amount} so'm. Hamyonga pul qaytadi, kassadan chiqim (storno) yoziladi.", {
              factory: row.factory?.name ?? t('Zavod'),
              amount: fmtMoney(row.amount),
            })}
          </Typography.Paragraph>
          <Input.TextArea
            rows={3}
            placeholder={t('Sabab (majburiy)')}
            onChange={(e) => {
              reason = e.target.value;
            }}
          />
        </div>
      ),
      okText: t('Qaytarish'),
      okButtonProps: { danger: true },
      cancelText: t('Bekor qilish'),
      // R3 / R16 — telefonda markazlashtiriladi, aks holda klaviatura futerni yopadi
      width: modalWidth(416),
      centered: isPhone,
      onOk: () => {
        if (!reason.trim()) {
          message.warning(t('Sababni kiritish majburiy'));
          return Promise.reject(new Error('reason required'));
        }
        return reverseMut.mutateAsync({ id: row.id, reason: reason.trim() });
      },
    });
  };

  const wallets = walletsQ.data ?? [];
  const walletOptions = wallets.map((w) => ({
    value: w.factory.id,
    label: t("{name} ({bal} so'm)", { name: w.factory.name, bal: fmtMoney(w.balance) }),
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
      if (v > bal) return Promise.reject(new Error(t("Hamyon balansidan oshiq (balans: {bal} so'm)", { bal: fmtMoney(bal) })));
      return Promise.resolve();
    },
  });

  // «Buyurtma / asos» ustunidagi hisob-kitob matni. Desktopda u Tooltip ichida
  // qoladi (muzlatilgan), telefonda esa kartaning KO'RINADIGAN satri bo'ladi —
  // tooltip teginishda umuman ochilmaydi (spec R12).
  const basisText = (r: BonusTxRow) =>
    [
      r.baseM3 ? t('Asos hajm: {v}', { v: fmtM3(r.baseM3) }) : null,
      r.baseAmount ? t('Asos summa: {v}', { v: fmtUZS(r.baseAmount) }) : null,
      r.program?.kind === 'PER_M3' && r.program?.ratePerM3
        ? t("Stavka: {v} so'm/m³", { v: fmtMoney(r.program.ratePerM3) })
        : null,
      r.program?.kind === 'PERCENT' && r.program?.percent ? t('Foiz: {v}%', { v: r.program.percent }) : null,
    ]
      .filter(Boolean)
      .join(' · ');

  const txColumns: SbColumn<BonusTxRow>[] = [
    { title: 'Sana', dataIndex: 'at', width: 140, render: (v: string) => fmtDateTime(v) },
    { title: 'Zavod', key: 'factory', width: 180, ellipsis: true, render: (_, r) => r.factory?.name ?? '—' },
    {
      title: 'Turi',
      dataIndex: 'type',
      width: 160,
      render: (v: BonusTransactionType) => <StatusChip meta={BONUS_TX[v]} />,
    },
    {
      title: 'Summa',
      dataIndex: 'amount',
      align: 'right',
      width: 150,
      render: (v: string) => <MoneyCell value={v} signed strong />,
    },
    {
      title: 'Buyurtma / asos',
      key: 'order',
      render: (_, r) => {
        const baseInfo = basisText(r);
        if (r.order) {
          const link = <Link to={`/orders/${r.order.id}`}>{r.order.orderNo}</Link>;
          return baseInfo ? <Tooltip title={baseInfo}>{link}</Tooltip> : link;
        }
        if (baseInfo) {
          return (
            <Tooltip title={baseInfo}>
              <Typography.Text type="secondary">{t("ma'lumot")}</Typography.Text>
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
            {t('Qaytarish')}
          </Button>
        ) : null,
    },
  ];

  return (
    <Space orientation="vertical" size={16} style={{ display: 'flex' }}>
      <PageHeader
        title="Bonus hamyonlar"
        subtitle="Zavod bonus hamyonlari — yig'ilgan bonus, naqd yechish va qarzga o'tkazish"
        accent
        actions={
          canMutate
            ? [
                {
                  key: 'withdraw',
                  label: 'Naqd yechish',
                  primary: true,
                  icon: <DollarOutlined />,
                  onClick: () => setWithdrawOpen(true),
                },
                {
                  key: 'offset',
                  label: "Zavod qarziga o'tkazish",
                  icon: <SwapOutlined />,
                  onClick: () => setOffsetOpen(true),
                },
              ]
            : []
        }
      />

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
                  <StatCard
                    size="md"
                    variant="in"
                    icon={<GiftOutlined />}
                    label={w.factory.name}
                    value={w.balance}
                    suffix="so'm"
                    note={!w.factory.active ? 'faol emas' : undefined}
                  />
                </Col>
              ))}
        </Row>
      )}

      <TableCard
        title={t('Bonus operatsiyalari')}
        loading={txQ.isFetching}
        toolbar={
          <Select
            allowClear
            placeholder={t("Zavod bo'yicha")}
            style={isPhone ? { width: '100%', minWidth: 0 } : { minWidth: 220 }}
            options={wallets.map((w) => ({ value: w.factory.id, label: w.factory.name }))}
            value={txFactoryId}
            onChange={(v) => uf.set({ factoryId: v || null })}
            showSearch
            optionFilterProp="label"
          />
        }
      >
        <DataTable<BonusTxRow>
          rowKey="id"
          columns={txColumns}
          query={txQ}
          emptyText="Hozircha bonus operatsiyasi yo'q"
          scroll={isDesktop ? { x: 1000 } : { x: 'max-content' }}
          // MOBIL: 7 ustunli jadval o'rniga karta — zavod sarlavha, summa yagona
          // figura, «asos» esa tooltip emas, ko'rinadigan satr (R12). Storno
          // tugmasi kartaning to'liq kenglikdagi futer amali (§2.2.4).
          mobileCard={(r) => {
            const basis = basisText(r);
            const lines: { label: string; value: ReactNode }[] = [];
            if (basis) lines.push({ label: 'Buyurtma / asos', value: basis });
            if (r.note) lines.push({ label: 'Izoh', value: r.note });
            return {
              title: r.factory?.name ?? '—',
              value: <MoneyCell value={r.amount} signed strong />,
              meta: (
                <>
                  <StatusChip meta={BONUS_TX[r.type]} />
                  <span className="sb-mcard__chip">{fmtDateTime(r.at)}</span>
                  {r.order ? (
                    <Link className="sb-mcard__chip" to={`/orders/${r.order.id}`}>
                      {r.order.orderNo}
                    </Link>
                  ) : null}
                </>
              ),
              lines,
              actions:
                canMutate && r.type === 'WITHDRAWAL' ? (
                  <Button size="small" danger icon={<UndoOutlined />} onClick={() => askReverse(r)}>
                    {t('Qaytarish')}
                  </Button>
                ) : undefined,
            };
          }}
        />
      </TableCard>

      {/* withdraw */}
      <FormDrawer
        title={t('Bonusni naqd yechish')}
        open={withdrawOpen}
        onClose={() => setWithdrawOpen(false)}
        onSubmit={() => withdrawForm.submit()}
        submitText="Yechish"
        submitting={withdrawMut.isPending}
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
          <Form.Item name="factoryId" label={t('Zavod')} rules={[{ required: true, message: t('Zavodni tanlang') }]}>
            <Select placeholder={t('Zavodni tanlang')} options={walletOptions} showSearch optionFilterProp="label" />
          </Form.Item>
          {wFactoryId && (
            <Typography.Paragraph type="secondary" style={{ marginTop: -8 }}>
              {t("Hamyon balansi: {bal} so'm", { bal: fmtMoney(walletBalance(wFactoryId)) })}
            </Typography.Paragraph>
          )}
          <Form.Item
            name="amount"
            label={t('Summa')}
            dependencies={['factoryId']}
            rules={[{ required: true, message: t('Summani kiriting') }, maxRule(wFactoryId)]}
          >
            <InputNumber
              min={1}
              style={{ width: '100%' }}
              formatter={moneyFormatter}
              parser={moneyParser}
              placeholder="0"
            />
          </Form.Item>
          <Form.Item
            name="cashboxId"
            label={t('Kassa (faqat UZS)')}
            rules={[{ required: true, message: t('Kassani tanlang') }]}
          >
            <Select
              placeholder={t('Kassani tanlang')}
              options={uzsActiveBoxes.map((b) => ({ value: b.id, label: b.name }))}
              showSearch
              optionFilterProp="label"
            />
          </Form.Item>
          <Form.Item name="date" label={t('Sana')} rules={[{ required: true, message: t('Sanani tanlang') }]}>
            <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
          </Form.Item>
          <Form.Item name="note" label={t('Izoh')}>
            <Input.TextArea rows={2} placeholder={t('Izoh (ixtiyoriy)')} />
          </Form.Item>
        </Form>
      </FormDrawer>

      {/* offset */}
      <FormDrawer
        title={t("Bonusni zavod qarziga o'tkazish")}
        open={offsetOpen}
        onClose={() => setOffsetOpen(false)}
        onSubmit={() => offsetForm.submit()}
        submitText="O'tkazish"
        submitting={offsetMut.isPending}
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
          <Form.Item name="factoryId" label={t('Zavod')} rules={[{ required: true, message: t('Zavodni tanlang') }]}>
            <Select placeholder={t('Zavodni tanlang')} options={walletOptions} showSearch optionFilterProp="label" />
          </Form.Item>
          {oFactoryId && (
            <Typography.Paragraph type="secondary" style={{ marginTop: -8 }}>
              {t("Hamyon balansi: {bal} so'm", { bal: fmtMoney(walletBalance(oFactoryId)) })}
            </Typography.Paragraph>
          )}
          <Form.Item
            name="amount"
            label={t('Summa')}
            dependencies={['factoryId']}
            rules={[{ required: true, message: t('Summani kiriting') }, maxRule(oFactoryId)]}
          >
            <InputNumber
              min={1}
              style={{ width: '100%' }}
              formatter={moneyFormatter}
              parser={moneyParser}
              placeholder="0"
            />
          </Form.Item>
          <Form.Item name="date" label={t('Sana')} rules={[{ required: true, message: t('Sanani tanlang') }]}>
            <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
          </Form.Item>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message={t("Bonus zavodga to'lov (BONUS usulida) sifatida yoziladi va zavodga bo'lgan qarzimizni kamaytiradi.")}
          />
          <Form.Item name="note" label={t('Izoh')}>
            <Input.TextArea rows={2} placeholder={t('Izoh (ixtiyoriy)')} />
          </Form.Item>
        </Form>
      </FormDrawer>
    </Space>
  );
}
