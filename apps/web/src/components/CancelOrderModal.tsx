// «Buyurtmani bekor qilish» — egasining 2026-07-26 qoidasi bo'yicha (2026-07-22 kechqurungi
// qoidani almashtiradi).
//
// IKKALA yo'lda ham: zavodga o'tkazgan pulimiz TO'LIQ orqaga qaytadi — bu buyurtma
// bo'yicha zavodda avans QOLMAYDI va biz o'sha pulni umuman o'tkazmagandek bo'lamiz
// (asl to'lov hujjatining stornosi yoziladi, naqd/o'tkazma cho'ntaklari aralashmaydi).
// Mijoz SHOFYORGA o'z qo'li bilan bergan puli ham hujjat sifatida bekor qilinadi.
//
// Farq faqat MIJOZ BIZGA to'lagan pulda:
//   • «Avansida qoladi» (REFUND, default) — o'sha pul mijozning AVANSI bo'lib qoladi va
//     keyingi buyurtmasiga ishlatiladi.
//   • «To'lamagandek bo'lsin» (VOID_ALL) — to'lov hujjati bekor qilinadi: mijoz bizga
//     to'lamagandek bo'ladi. Buyurtma huddi yaratilmagandek.
//
// ATAYIN: bu oyna KASSA haqida gapirmaydi. Bekor qilishda kassa qatorlari bir-birini yeb
// ketadi (storno juftligi), shuning uchun «kassaga tushdi / kassadan chiqdi» degan gap
// egani chalg'itardi — u faqat pul KIMDA qolishini bilishi kerak (egasi talabi, 2026-07-26).
//
// AGENT bu oynani ko'rmaydi (chaqiruvchi `canManage` = ADMIN/ACCOUNTANT bilan gate qiladi),
// shuning uchun zavod tannarxi va foyda raqamlarini ko'rsatish D1 qoidasini buzmaydi.
import { useEffect, useState } from 'react';
import { Input, Modal, Segmented, Typography, theme } from 'antd';
import { fmtMoney, num } from '../lib/format';
import { clientDirectTransport } from '../lib/order-money';
import type { CancelMoneyMode, Order } from '../lib/types';
import { LedgerImpactPreview, type ImpactFact } from './LedgerImpactPreview';
import { useT } from './LangContext';
import { useIsPhone, modalWidth } from '../lib/responsive';

export interface CancelOrderModalProps {
  open: boolean;
  onClose: () => void;
  order: Order;
  /** Mijoz SHOFYORGA bergan puli (TRANSPORT_DIRECT taqsimotlari yig'indisi). */
  directRecorded: number;
  submitting?: boolean;
  onConfirm: (reason: string, mode: CancelMoneyMode) => void | Promise<void>;
}

export function CancelOrderModal({
  open,
  onClose,
  order,
  directRecorded,
  submitting,
  onConfirm,
}: CancelOrderModalProps) {
  const { token } = theme.useToken();
  const t = useT();
  const isPhone = useIsPhone();

  const [mode, setMode] = useState<CancelMoneyMode>('REFUND');
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (open) {
      setMode('REFUND');
      setReason('');
    }
  }, [open]);

  // ── shu buyurtmaning pul xaritasi ──
  const clientPaidUs = num(order.clientPaid); // CLIENT_IN — bizning kassamizga tushgan
  const clientPaidDriver = directRecorded; // TRANSPORT_DIRECT — kassamizdan o'tmagan
  const factoryPaid = num(order.factoryPaid);
  const orderProfit =
    num(order.saleTotal) - num(order.costTotal) + num(order.transportCharge) - num(order.transportCost);
  const directTransport = clientDirectTransport(order);
  const isRefund = mode === 'REFUND';

  const money = (v: number) => `${fmtMoney(v)} ${t("so'm")}`;

  const facts: ImpactFact[] = [
    {
      text: t("Buyurtma savdosi bekor qilinadi — mijozning bu buyurtma bo'yicha {sum} qarzi yo'qoladi", {
        sum: money(Math.max(0, num(order.saleTotal) - directTransport)),
      }),
      tone: 'neutral',
    },
    ...(factoryPaid > 0
      ? [
          {
            text: t(
              "Zavodga o'tkazgan {sum} pulimiz to'liq orqaga qaytadi — bu buyurtma bo'yicha zavodda avans QOLMAYDI (biz o'sha pulni umuman o'tkazmagandek bo'lamiz)",
              { sum: money(factoryPaid) },
            ),
            tone: 'success' as const,
          },
        ]
      : [{ text: t("Zavodga bu buyurtma bo'yicha to'lov qilinmagan — zavod qarzimiz bekor bo'ladi"), tone: 'neutral' as const }]),
    // Mijozning bizga to'lagani — rejim SHU pulning taqdirini hal qiladi.
    ...(clientPaidUs > 0
      ? [
          {
            text: isRefund
              ? t("Mijozning to'lagan {sum} puli uning AVANSIDA qoladi — keyingi buyurtmasiga ishlatiladi", {
                  sum: money(clientPaidUs),
                })
              : t(
                  "Mijozning to'lagan {sum} puli — u bizga umuman to'lamagandek bo'ladi (to'lov hujjati bekor qilinadi)",
                  { sum: money(clientPaidUs) },
                ),
            tone: isRefund ? ('success' as const) : ('warning' as const),
          },
        ]
      : []),
    ...(clientPaidDriver > 0
      ? [
          {
            text: t("Mijoz shofyorga bergan {sum} hujjati bekor qilinadi — bu pul bizdan o'tmagan, mijoz oldida qarz qoldirmaydi", {
              sum: money(clientPaidDriver),
            }),
            tone: 'neutral' as const,
          },
        ]
      : []),
    // Zarar bilan ketgan buyurtmada «−430 000 sof foyda yo'qoladi» chalkash o'qiladi.
    ...(Math.abs(orderProfit) > 0.5
      ? [
          {
            text:
              orderProfit > 0
                ? t("Shu buyurtmadan olinadigan {sum} sof foyda yo'qoladi", { sum: money(orderProfit) })
                : t("Shu buyurtmaning {sum} zarari ham bekor bo'ladi", { sum: money(-orderProfit) }),
            tone: 'warning' as const,
          },
        ]
      : []),
    { text: t('Poddon harakati va bonus hisobi ham bekor qilinadi'), tone: 'neutral' },
    isRefund
      ? {
          text:
            clientPaidUs > 0
              ? t('YAKUNDA: mijozning avansida {sum} qoladi, zavodda esa avans qolmaydi', {
                  sum: money(clientPaidUs),
                })
              : t("YAKUNDA: mijoz bu buyurtma uchun to'lov qilmagan — uning hisobida hech narsa qolmaydi"),
          tone: 'success',
        }
      : {
          text: t('YAKUNDA: buyurtma huddi YARATILMAGANDEK bo‘ladi — na mijozda, na zavodda iz qolmaydi'),
          tone: 'success',
        },
  ];

  // Pastdagi jadval: rejimga qarab pul kimda qolishi.
  const rows: Array<{ label: string; value: number; strong?: boolean; muted?: boolean }> = [
    ...(clientPaidUs > 0 ? [{ label: "Mijoz bizga to'lagan", value: clientPaidUs, muted: true }] : []),
    ...(clientPaidDriver > 0 ? [{ label: "Mijoz shofyorga to'lagan", value: clientPaidDriver, muted: true }] : []),
    ...(factoryPaid > 0 ? [{ label: "Biz zavodga o'tkazganimiz", value: factoryPaid, muted: true }] : []),
    ...(factoryPaid > 0 ? [{ label: 'Zavodda qoladigan avans', value: 0, strong: true }] : []),
    ...(isRefund
      ? [{ label: 'Mijozning avansida qoladi', value: clientPaidUs, strong: true }]
      : [{ label: 'Mijozda qoladi', value: 0, strong: true }]),
  ];

  const canSubmit = reason.trim().length > 0 && !submitting;

  return (
    <Modal
      open={open}
      onCancel={submitting ? undefined : onClose}
      title={`${t('Buyurtmani bekor qilish')} — ${order.orderNo}`}
      okText={t('Bekor qilish')}
      cancelText={t('Yopish')}
      okButtonProps={{ danger: true, disabled: !canSubmit, loading: submitting }}
      onOk={() => canSubmit && onConfirm(reason.trim(), mode)}
      centered={isPhone}
      width={modalWidth(560)}
      destroyOnHidden
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 4 }}>
        {/* 1) egasining savoli — javob pulning taqdirini belgilaydi */}
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 6 }}>
            {t("Mijozning to'lagan puli uning avansida qoladimi?")}
          </div>
          <Segmented
            block
            value={mode}
            onChange={(v) => setMode(v as CancelMoneyMode)}
            disabled={submitting}
            options={[
              { value: 'REFUND', label: t('Ha — avansida qoladi') },
              { value: 'VOID_ALL', label: t("Yo'q — to'lamagandek bo'lsin") },
            ]}
          />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {clientPaidUs <= 0
              ? t("Mijoz bu buyurtma bo'yicha bizga to'lov qilmagan — tanlovning ahamiyati yo'q")
              : isRefund
                ? t("Puli bizda qoladi va uning avansiga aylanadi")
                : t("Puli qaytariladi va u bizga to'lamagandek hisoblanadi")}
          </Typography.Text>
        </div>

        {/* 2) real pul — foydalanuvchi nimani bekor qilayotganini raqamda ko'radi */}
        {rows.length ? (
          <div
            style={{
              border: `1px solid ${token.colorBorderSecondary}`,
              borderRadius: token.borderRadiusLG,
              padding: '10px 12px',
              display: 'grid',
              gap: 6,
            }}
          >
            {rows.map((r, i) => (
              <div
                key={r.label}
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  gap: 12,
                  ...(r.strong && !rows[i - 1]?.strong
                    ? { borderTop: `1px solid ${token.colorBorderSecondary}`, paddingTop: 6, marginTop: 2 }
                    : {}),
                }}
              >
                <Typography.Text type={r.muted ? 'secondary' : undefined} style={{ fontSize: 13 }}>
                  {t(r.label)}
                </Typography.Text>
                <Typography.Text strong={r.strong} className="num" style={{ fontSize: r.strong ? 15 : 13 }}>
                  {money(r.value)}
                </Typography.Text>
              </div>
            ))}
          </div>
        ) : null}

        {/* 3) nima bo'lishining to'liq ro'yxati */}
        <LedgerImpactPreview title="Natija" facts={facts} />

        {/* 4) sabab — majburiy (backend ham talab qiladi) */}
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 6 }}>{t('Bekor qilish sababi')}</div>
          <Input.TextArea
            rows={3}
            maxLength={2000}
            value={reason}
            disabled={submitting}
            placeholder={t('Nima uchun bekor qilinmoqda (majburiy)')}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
}
