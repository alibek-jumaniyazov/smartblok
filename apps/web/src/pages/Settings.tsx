import {
  Alert,
  App,
  Button,
  Divider,
  Form,
  InputNumber,
  Space,
  Spin,
  Switch,
  Typography,
} from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiError, endpoints } from '../lib/api';
import { PageHeader, TableCard } from '../components';
import { useT } from '../components/LangContext';

interface CurrentSettings {
  agentDebtLimitDefault: number | null;
  truckCapacityPallets: number;
  saleMarginMinPct: number;
  palletPriceDefault: number | null;
}

interface SettingsFormValues {
  unlimited: boolean;
  agentDebtLimitDefault?: number;
  truckCapacityPallets: number;
  saleMarginMinPct: number;
  palletPriceDefault?: number;
}

const moneyFmt = (v: string | number | undefined) =>
  `${v ?? ''}`.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const moneyParse = (v: string | undefined) => (v ? v.replace(/\s/g, '') : '') as unknown as number;

function parseCurrent(raw: Record<string, unknown>): CurrentSettings {
  const n = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return {
    agentDebtLimitDefault:
      raw.agentDebtLimitDefault == null ? null : n(raw.agentDebtLimitDefault, 0),
    truckCapacityPallets: n(raw.truckCapacityPallets, 19),
    saleMarginMinPct: n(raw.saleMarginMinPct, 0),
    palletPriceDefault: raw.palletPriceDefault == null ? null : n(raw.palletPriceDefault, 0),
  };
}

function SettingsForm({ current }: { current: CurrentSettings }) {
  const { message } = App.useApp();
  const t = useT();
  const qc = useQueryClient();
  const [form] = Form.useForm<SettingsFormValues>();
  const unlimitedWatch = Form.useWatch('unlimited', form);

  const save = useMutation({
    mutationFn: async (entries: [string, number | null][]) => {
      // whitelisted keys are written one PUT per changed key
      for (const [key, value] of entries) {
        await endpoints.setSetting(key, value);
      }
      return entries.length;
    },
    onSuccess: (count) => {
      message.success(t('{count} ta sozlama saqlandi', { count }));
      qc.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (e) => {
      message.error(apiError(e));
      // partial writes are possible — resync from the server
      qc.invalidateQueries({ queryKey: ['settings'] });
    },
  });

  const onFinish = (vals: SettingsFormValues) => {
    const next: Record<string, number | null | undefined> = {
      agentDebtLimitDefault: vals.unlimited ? null : (vals.agentDebtLimitDefault ?? undefined),
      truckCapacityPallets: vals.truckCapacityPallets,
      saleMarginMinPct: vals.saleMarginMinPct,
      palletPriceDefault: vals.palletPriceDefault ?? undefined,
    };
    const entries = (Object.keys(next) as (keyof CurrentSettings)[])
      .filter((k) => {
        const v = next[k];
        if (v === undefined) return false; // not provided — leave untouched
        return v !== current[k];
      })
      .map((k) => [k, next[k] as number | null] as [string, number | null]);
    if (!entries.length) {
      message.info(t("O'zgarish yo'q"));
      return;
    }
    save.mutate(entries);
  };

  return (
    <Form<SettingsFormValues>
      form={form}
      layout="vertical"
      style={{ maxWidth: 640 }}
      onFinish={onFinish}
      initialValues={{
        unlimited: current.agentDebtLimitDefault == null,
        agentDebtLimitDefault: current.agentDebtLimitDefault ?? undefined,
        truckCapacityPallets: current.truckCapacityPallets,
        saleMarginMinPct: current.saleMarginMinPct,
        palletPriceDefault: current.palletPriceDefault ?? undefined,
      }}
    >
      <Typography.Title level={5} style={{ marginTop: 0 }}>
        {t('Agent qarz chegarasi')}
      </Typography.Title>
      <Form.Item
        name="unlimited"
        label={t('Cheklanmagan')}
        valuePropName="checked"
        extra={t("Yoqilsa, agent mijozlarining jami qarziga standart chegara qo'yilmaydi")}
      >
        <Switch />
      </Form.Item>
      {!unlimitedWatch && (
        <Form.Item
          name="agentDebtLimitDefault"
          label={t("Standart qarz chegarasi (so'm)")}
          rules={[{ required: true, message: t("Chegara summasini kiriting yoki 'Cheklanmagan'ni yoqing") }]}
          extra={t("Agent mijozlarining jami ochiq qarzi shu summadan oshsa, yangi buyurtma bloklanadi. 0 — yangi buyurtmalar to'liq bloklanadi. Har bir agent uchun alohida chegara bu qiymatdan ustun.")}
        >
          <InputNumber
            min={0}
            style={{ width: '100%' }}
            formatter={moneyFmt}
            parser={moneyParse}
            placeholder={t('masalan 50 000 000')}
          />
        </Form.Item>
      )}

      <Divider />

      <Typography.Title level={5} style={{ marginTop: 0 }}>
        {t('Standart qiymatlar')}
      </Typography.Title>
      <Form.Item
        name="truckCapacityPallets"
        label={t("Fura sig'imi (paddon)")}
        rules={[{ required: true, message: t("Sig'imni kiriting") }]}
        extra={t("Bitta furaga sig'adigan paddonlar soni (1–40). Yangi moshina va marshrutlar uchun standart qiymat.")}
      >
        <InputNumber min={1} max={40} precision={0} style={{ width: '100%' }} />
      </Form.Item>

      <Form.Item
        name="saleMarginMinPct"
        label={t('Minimal sotish ustamasi (%)')}
        rules={[{ required: true, message: t('Foizni kiriting') }]}
        extra={t("Sotish narxi zavod narxidan kamida shuncha foiz yuqori bo'lishi kerak (0–100). Umumiy summa kiritishdagi xatolardan himoya qiladi.")}
      >
        <InputNumber min={0} max={100} step={0.1} style={{ width: '100%' }} />
      </Form.Item>

      <Form.Item
        name="palletPriceDefault"
        label={t("Paddonning standart narxi (so'm)")}
        rules={[
          {
            validator: (_r, v: number | undefined) =>
              v === undefined || v === null || v > 0
                ? Promise.resolve()
                : Promise.reject(new Error(t("Narx 0 dan katta bo'lishi kerak"))),
          },
        ]}
        extra={t("Yangi buyurtmalarda paddon uchun taklif qilinadigan narx (0 dan katta). Bo'sh qoldirilsa o'zgartirilmaydi.")}
      >
        <InputNumber
          min={0.01}
          style={{ width: '100%' }}
          formatter={moneyFmt}
          parser={moneyParse}
          placeholder={t('masalan 60 000')}
        />
      </Form.Item>

      <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={save.isPending}>
        {t('Saqlash')}
      </Button>
    </Form>
  );
}

export default function Settings() {
  const t = useT();
  const settingsQ = useQuery({
    queryKey: ['settings'],
    queryFn: () => endpoints.settings(),
  });

  return (
    <div>
      <PageHeader title="Tizim sozlamalari" subtitle="Umumiy parametrlar va tizim sozlamalari" accent />
      {settingsQ.error ? (
        <Alert
          type="error"
          showIcon
          style={{ maxWidth: 720 }}
          message={t('Sozlamalarni yuklashda xatolik')}
          description={apiError(settingsQ.error)}
          action={
            <Button size="small" onClick={() => settingsQ.refetch()}>
              {t('Qayta urinish')}
            </Button>
          }
        />
      ) : settingsQ.isLoading || !settingsQ.data ? (
        <Spin size="large" style={{ display: 'block', margin: '10vh auto' }} />
      ) : (
        <TableCard bodyPadding={16} style={{ maxWidth: 720 }}>
          <Space orientation="vertical" size={16} style={{ width: '100%' }}>
            <Alert
              type="info"
              showIcon
              message={t("Faqat o'zgargan kalitlar saqlanadi; har bir o'zgarish audit jurnaliga yoziladi.")}
            />
            <SettingsForm
              key={JSON.stringify(settingsQ.data)}
              current={parseCurrent(settingsQ.data)}
            />
          </Space>
        </TableCard>
      )}
    </div>
  );
}
