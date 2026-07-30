// ClientPalletDrawer — mijoz kartochkasidan paddon amali (egasi so'rovi, 2026-07-30).
//
// Shu paytgacha paddon qaytarishni yozish uchun mijoz kartochkasidan chiqib, /paddonlar
// sahifasiga o'tib, ro'yxatdan o'sha mijozni QAYTA topish kerak edi — mijoz allaqachon
// ekranda turgan holda. Bu varaq o'sha ikki amalni mijozning o'z sahifasiga olib keladi:
// tomon QULFLANGAN (tanlash maydoni yo'q — noto'g'ri mijozga yozish imkoni ham yo'q),
// chegara esa uning O'ZI ushlab turgan sonidan olinadi.
//
// Ikki rejim bitta komponentda ATAYLAB: chegara mantiqi («mijozda faqat N dona bor»)
// ikkalasida AYNAN bir xil va serverdagi tekshiruvni oynadek takrorlaydi. Ikkita alohida
// varaqda u ikki nusxa bo'lardi va bittasi jimgina eskirardi.
//
//   · 'return' — RETURNED_BY_CLIENT: mijoz paddonni fizik qaytardi. PULSIZ.
//   · 'lost'   — CHARGED_LOST: qaytmagan paddon pulga o'tkaziladi (mijoz qarziga yoziladi).
//
// Chegara SERVER so'zi bilan yakunlanadi (02 §9): bu yerdagi `max` — maslahat, tekshiruv
// esa mijoz qatori qulflangan holda backendda qayta hisoblanadi.
import { useEffect } from 'react';
import { Alert, App, DatePicker, Form, Input, InputNumber, Typography, theme } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs, { type Dayjs } from 'dayjs';
import { apiError, endpoints } from '../lib/api';
import { fmtNum, fmtUZS } from '../lib/format';
import { can } from '../lib/permissions';
import { useAuth } from '../auth/AuthContext';
import { FormDrawer } from './FormDrawer';
import { MoneyInput } from './MoneyInput';
import { useT } from './LangContext';

/** 'return' — mijoz qaytardi (pulsiz) · 'lost' — yo'qolganini pulga o'tkazish (qarz). */
export type ClientPalletMode = 'return' | 'lost';

/**
 * Sozlamada «Yo'qolgan paddon narxi» belgilanmagan bo'lsa amal qiladigan narx.
 * AYNAN serverdagi `DEFAULT_PALLET_UNIT_PRICE` (pallets.service.ts) — egasi tomonidan
 * qulflangan 130 000. Ikkalasi ajralib ketmasin: bu yerda ko'rinadigan raqam server
 * yozadigan raqam bo'lishi shart.
 */
export const FALLBACK_LOST_PALLET_PRICE = 130000;

interface PalletFormValues {
  qty: number;
  date: Dayjs;
  unitPrice?: string;
  note?: string;
}

export interface ClientPalletDrawerProps {
  open: boolean;
  onClose: () => void;
  mode: ClientPalletMode;
  clientId: string;
  clientName: string;
  /** «hozir mijozda» — server hisoblagan qoldiq; chegara shundan olinadi */
  held: number;
}

export function ClientPalletDrawer({
  open,
  onClose,
  mode,
  clientId,
  clientName,
  held,
}: ClientPalletDrawerProps) {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const t = useT();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [form] = Form.useForm<PalletFormValues>();
  const isLost = mode === 'lost';

  // «Yo'qolgan paddon narxi» sozlamasi — 130 000 ni qo'lda yozib qo'yish emas. Egasi
  // sozlamada boshqa narx belgilagan bo'lsa, forma serverning o'sha narxini ko'rsatishi
  // shart, aks holda ekran bir raqamni ko'rsatib, daftarga boshqasi tushardi.
  // AGENT bu varaqni umuman ko'rmaydi (undirish A/B), shuning uchun so'rov ham unga
  // yuborilmaydi — aks holda /settings dan 403 qaytardi.
  const settingsQ = useQuery({
    queryKey: ['settings'],
    queryFn: () => endpoints.settings(),
    enabled: open && isLost && can(user?.role, 'settings.read'),
    staleTime: 5 * 60_000,
  });
  const settingPrice = Number(settingsQ.data?.palletPriceDefault);
  const defaultLostPrice =
    Number.isFinite(settingPrice) && settingPrice > 0 ? settingPrice : FALLBACK_LOST_PALLET_PRICE;

  // Varaq har ochilganda toza holat: sana — bugun, narx — sozlamadagi standart.
  // `defaultLostPrice` deps ichida: sozlama varaq ochilgandan KEYIN kelsa ham maydon
  // to'g'ri raqamga o'tadi (aks holda 130 000 muzlab qolardi).
  useEffect(() => {
    if (!open) return;
    form.resetFields();
    form.setFieldsValue({
      date: dayjs(),
      ...(isLost ? { unitPrice: String(defaultLostPrice) } : {}),
    });
  }, [open, isLost, defaultLostPrice, form]);

  const mut = useMutation({
    mutationFn: (v: PalletFormValues) => {
      const base = {
        clientId,
        qty: v.qty,
        date: v.date.format('YYYY-MM-DD'),
        note: v.note?.trim() ? v.note.trim() : undefined,
      };
      return isLost
        ? endpoints.palletChargeLost({ ...base, unitPrice: v.unitPrice })
        : endpoints.palletClientReturn(base);
    },
    onSuccess: () => {
      message.success(
        isLost
          ? t("Yo'qotilgan paddonlar mijozdan undirildi (qarz yozildi)")
          : t('Paddon qaytarilishi qabul qilindi'),
      );
      // Paddon qoldig'i to'rt joyda ko'rinadi (mijoz kartochkasi, mijozlar ro'yxati,
      // agent kartochkasi, qarzlar doskasi) va ish stoli «mijozlardagi paddon» ni
      // sanaydi — bittasi eskirib qolsa, ekranda ikki xil raqam bo'lardi. `charge-lost`
      // bundan tashqari mijoz PUL balansini va hisob-kitob varaqasini ham o'zgartiradi
      // (`debts` prefiksi PartyStatement so'rovini ham qamraydi).
      for (const key of ['pallets', 'clients', 'agents', 'debts', 'dashboard']) {
        qc.invalidateQueries({ queryKey: [key] });
      }
      onClose();
    },
    onError: (e) => form.setFields([{ name: 'qty', errors: [apiError(e)] }]),
  });

  const qty = Form.useWatch('qty', form);
  const unitPrice = Form.useWatch('unitPrice', form);
  const lostTotal = (Number(qty) || 0) * (Number(unitPrice) || 0);
  // Qoldiq nolga teng bo'lsa yozadigan narsa yo'q — server ham 400 qaytaradi. Varaqni
  // bosishdan oldin ayting: bo'sh formani to'ldirib, keyin xato ko'rish — behuda mehnat.
  const nothingHeld = held <= 0;

  return (
    <FormDrawer
      title={t(isLost ? "Yo'qotilgan paddonlarni undirish" : 'Mijozdan paddon qabul qilish')}
      open={open}
      onClose={onClose}
      onSubmit={() => form.submit()}
      submitText={isLost ? 'Undirish' : 'Saqlash'}
      cancelText="Bekor qilish"
      danger={isLost}
      disabled={nothingHeld}
      submitting={mut.isPending}
      width={480}
    >
      {/* QULFLANGAN tomon: tanlash maydoni o'rniga faktning o'zi. Mijoz nomi va uning
          qoldig'i yonma-yon turadi — «kimga yozaman» va «qanchasi bor» bitta qarashda. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 16,
          padding: '10px 12px',
          borderRadius: token.borderRadiusLG,
          border: `1px solid ${token.colorBorderSecondary}`,
          background: token.colorFillQuaternary,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <Typography.Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
            {t('Mijoz')}
          </Typography.Text>
          <Typography.Text strong style={{ overflowWrap: 'anywhere' }}>
            {clientName}
          </Typography.Text>
        </div>
        <div style={{ textAlign: 'right' }}>
          <Typography.Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
            {t('Hozir mijozda')}
          </Typography.Text>
          <span className="num" style={{ fontWeight: 700, color: held > 0 ? token.colorWarning : token.colorTextSecondary }}>
            {fmtNum(held)} <span style={{ fontSize: 11, fontWeight: 500, color: token.colorTextTertiary }}>{t('dona')}</span>
          </span>
        </div>
      </div>

      {nothingHeld ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={t("Bu mijozda hisobda paddon yo'q")}
        />
      ) : null}

      <Form form={form} layout="vertical" onFinish={(v) => mut.mutate(v)} disabled={nothingHeld}>
        <Form.Item
          name="qty"
          label={t('Soni (dona)')}
          extra={t('Mijozda mavjud: {n} dona', { n: held })}
          rules={[
            { required: true, message: t('Sonini kiriting') },
            () => ({
              validator: (_, value) =>
                Number(value) > held
                  ? Promise.reject(new Error(t('Mijozda faqat {n} dona paddon bor', { n: held })))
                  : Promise.resolve(),
            }),
          ]}
        >
          <InputNumber
            min={1}
            max={Math.max(1, held)}
            precision={0}
            style={{ width: '100%' }}
            placeholder="0"
            inputMode="numeric"
          />
        </Form.Item>

        <Form.Item name="date" label={t('Sana')} rules={[{ required: true, message: t('Sanani tanlang') }]}>
          <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" allowClear={false} />
        </Form.Item>

        {isLost ? (
          <Form.Item
            name="unitPrice"
            label={t("Dona narxi (so'm)")}
            rules={[{ required: true, message: t('Narxni kiriting') }]}
          >
            <MoneyInput min={1} />
          </Form.Item>
        ) : null}

        {isLost ? (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message={t('Diqqat: bu amaliyot mijozga pul qarzi yozadi')}
            description={
              lostTotal > 0 ? t("Mijoz qarziga {sum} qo'shiladi.", { sum: fmtUZS(lostTotal) }) : undefined
            }
          />
        ) : (
          // Paddon naturada: qaytarish mijozning PUL qarziga tegmaydi. Buni aytmasa,
          // «qaytardim — qarzim kamaydi» degan xato kutish paydo bo'ladi.
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message={t("Pul harakati yo'q — faqat paddon soni hisoblanadi")}
            description={t("Mijozning pul qarzi o'zgarmaydi: faqat uning paddon qoldig'i kamayadi.")}
          />
        )}

        <Form.Item name="note" label={t('Izoh')}>
          <Input.TextArea rows={2} placeholder={t('Izoh (ixtiyoriy)')} />
        </Form.Item>
      </Form>
    </FormDrawer>
  );
}
