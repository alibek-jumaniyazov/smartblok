// «Buyurtmani bekor qilish» — egasining 2026-07-22 (kechqurun) qoidasi bo'yicha.
//
// IKKALA yo'lda ham KASSA buyurtmadan OLDINGI holatiga qaytadi: mijozning to'lagani
// kassadan chiqadi, zavodga to'langani kassaga qaytadi. Bekor qilingan buyurtmaning puli
// kassada turib qolmaydi. Farq faqat MIJOZDA nima qolishida:
//
//   • «Ha — mijozga qaytariladi» (REFUND, default)
//       mijoz BIZGA to'lagani → unga NAQD qaytariladi (kassadan chiqim);
//       mijoz SHOFYORGA bergani → balansida KREDIT bo'lib qoladi (transportni diller o'z
//       zimmasiga oladi). Ya'ni to'lagan har bir so'm qaytadi: qismi naqd, qismi kredit.
//
//   • «Yo'q — hamma o'tkazmalar yo'qolsin» (VOID_ALL)
//       shu buyurtma uchun qilingan HAMMA to'lov yo'q bo'ladi — mijozniki ham, shofyorniki
//       ham, kassadagisi ham, zavodnikisi ham. Mijoz balansi 0. Buyurtma umuman
//       berilmagandek, to'lov umuman qilinmagandek.
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
  const totalPaidByClient = clientPaidUs + clientPaidDriver;
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
            text: t("Zavodga to'langan {sum} kassaga qaytariladi — zavod qarzimiz ham, avansimiz ham tozalanadi", {
              sum: money(factoryPaid),
            }),
            tone: 'success' as const,
          },
        ]
      : [{ text: t("Zavodga bu buyurtma bo'yicha to'lov qilinmagan — zavod qarzimiz bekor bo'ladi"), tone: 'neutral' as const }]),
    // Mijozning bizga to'lagani — IKKALA rejimda ham kassadan chiqadi, faqat nomi boshqa.
    ...(clientPaidUs > 0
      ? [
          {
            text: isRefund
              ? t("Mijozning bizga to'lagan {sum} puli unga NAQD qaytariladi — kassadan chiqim yoziladi", {
                  sum: money(clientPaidUs),
                })
              : t("Mijozning {sum} to'lovi butunlay bekor qilinadi — kassadan ham, mijoz hisobidan ham yo'qoladi", {
                  sum: money(clientPaidUs),
                }),
            tone: 'warning' as const,
          },
        ]
      : []),
    ...(clientPaidDriver > 0
      ? [
          {
            text: isRefund
              ? t("Mijoz shofyorga bergan {sum} balansida KREDIT bo'lib qoladi — transportni diller o'z zimmasiga oladi", {
                  sum: money(clientPaidDriver),
                })
              : t("Mijoz shofyorga bergan {sum} hujjati ham bekor qilinadi — balansida hech narsa qolmaydi", {
                  sum: money(clientPaidDriver),
                }),
            tone: isRefund ? ('success' as const) : ('warning' as const),
          },
        ]
      : []),
    // Zarar bilan ketgan buyurtmada «−430 000 sof foyda yo'qoladi» chalkash o'qiladi.
    ...(Math.abs(orderProfit) > 0.5
      ? [
          {
            text:
              orderProfit > 0
                ? t("Shu buyurtmadan kassada turgan {sum} sof foyda yo'qoladi", { sum: money(orderProfit) })
                : t("Shu buyurtmaning {sum} zarari ham bekor bo'ladi", { sum: money(-orderProfit) }),
            tone: 'warning' as const,
          },
        ]
      : []),
    { text: t('Poddon harakati va bonus hisobi ham bekor qilinadi'), tone: 'neutral' },
    {
      text: t('Kassa buyurtmadan OLDINGI holatiga qaytadi — bu buyurtmaning puli kassada qolmaydi'),
      tone: 'success',
    },
    isRefund
      ? {
          text:
            clientPaidDriver > 0
              ? t("Yakunda mijoz balansida {sum} kredit qoladi (shofyorga bergan puli)", {
                  sum: money(clientPaidDriver),
                })
              : t("Yakunda mijoz balansi 0 — to'lagan hamma puli qaytarildi"),
          tone: 'success',
        }
      : {
          text: t("Yakunda mijoz balansi 0 — buyurtma umuman berilmagandek, to'lov umuman qilinmagandek"),
          tone: 'success',
        },
  ];

  // Pastdagi jadval: rejimga qarab qayerga qancha ketishi.
  const rows: Array<{ label: string; value: number; strong?: boolean; muted?: boolean }> = [
    ...(clientPaidUs > 0 ? [{ label: "Mijoz bizga to'lagan", value: clientPaidUs, muted: true }] : []),
    ...(clientPaidDriver > 0 ? [{ label: "Mijoz shofyorga to'lagan", value: clientPaidDriver, muted: true }] : []),
    ...(factoryPaid > 0 ? [{ label: "Biz zavodga to'laganimiz", value: factoryPaid, muted: true }] : []),
    ...(isRefund
      ? [
          { label: 'Mijozga naqd qaytariladi', value: clientPaidUs, strong: true },
          ...(clientPaidDriver > 0
            ? [{ label: 'Mijoz balansida kredit qoladi', value: clientPaidDriver, strong: true }]
            : []),
        ]
      : [{ label: 'Mijoz balansida qoladi', value: 0, strong: true }]),
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
            {t("Mijozning to'lagan puli balansida qoladimi?")}
          </div>
          <Segmented
            block
            value={mode}
            onChange={(v) => setMode(v as CancelMoneyMode)}
            disabled={submitting}
            options={[
              { value: 'REFUND', label: t('Ha — mijozga qaytariladi') },
              { value: 'VOID_ALL', label: t("Yo'q — hamma o'tkazmalar yo'qolsin") },
            ]}
          />
          {totalPaidByClient <= 0 ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t("Mijoz bu buyurtma bo'yicha to'lov qilmagan — tanlovning ahamiyati yo'q")}
            </Typography.Text>
          ) : null}
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
