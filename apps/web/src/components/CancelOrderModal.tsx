// «Buyurtmani bekor qilish» — egasining 2026-07-29 qoidasi bo'yicha (2026-07-26 qoidasini
// almashtiradi: endi ZAVOD puli ham mijozniki bilan bir xil qonunga bo'ysunadi).
//
// BITTA savol IKKALA tomonni hal qiladi — «To'langan pullar avansda qoladimi?»:
//   • «Ha — avansda qoladi» (REFUND, default) — bekor qilish PULNI QIMIRLATMAYDI. Pul
//     jismonan qayerda bo'lsa o'sha yerda turaveradi: mijoz bizga to'lagani BIZDA qolib
//     uning avansi bo'ladi, biz zavodga o'tkazganimiz esa ZAVODDA qolib o'z kanalimizdagi
//     (naqd/o'tkazma) avansimiz bo'ladi.
//   • «Yo'q — to'lamagandek bo'lsin» (VOID_ALL) — xato kiritishni tozalash: ikkala tomonning
//     ham to'lov hujjati storno qilinadi, buyurtma huddi kiritilmagandek bo'ladi.
//
// EGASINING SHIKOYATI (2026-07-29) shu yerda tug'ilgan: «Ha» tanlansa ham zavod puli storno
// qilinardi, ya'ni oyna «zavodda avans QOLMAYDI» deb turib, tizim «zavod pulni qaytardi»
// degan YOLG'ONNI yozardi — bank kassasida hech kim bermagan pul paydo bo'lardi.
//
// Mijoz SHOFYORGA o'z qo'li bilan bergan puli ikkala yo'lda ham hujjat sifatida bekor
// qilinadi — u pul bizning kassamizdan o'tmagan.
//
// ATAYIN: bu oyna KASSA haqida gapirmaydi. «Ha» da kassa umuman qimirlamaydi, «Yo'q» da esa
// qatorlar bir-birini yeb ketadi (storno juftligi) — shuning uchun «kassaga tushdi /
// kassadan chiqdi» degan gap egani chalg'itardi: u faqat pul KIMDA qolishini bilishi kerak.
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

  // BONUS hisobidan yopilgan ulush HAQIQIY pul emas: u kassadan ham o'tmagan, naqd/o'tkazma
  // kanali ham yo'q — server uni ikkala rejimda ham qo'lga olmaydi (zavoddagi ortiqcha
  // to'lovimiz bo'lib qolaveradi). Shuning uchun «zavodda qoladigan avans» raqamidan
  // chiqarib tashlanadi, aks holda oyna yo'q avansni va'da qilardi.
  const factoryBonusPaid = (order.allocations ?? [])
    .filter(
      (a) =>
        !a.voidedAt &&
        !a.payment?.voidedAt &&
        a.payment?.kind === 'FACTORY_OUT' &&
        a.payment?.method === 'BONUS',
    )
    .reduce((s, a) => s + num(a.amount), 0);
  /** zavodga HAQIQIY pul bo'lib ketgani — avansga aylanadigan (yoki qaytariladigan) qismi */
  const factoryRealMoney = Math.max(0, factoryPaid - factoryBonusPaid);

  // «Yo'q — to'lamagandek bo'lsin» FAQAT butunlay shu buyurtmaga tegishli mijoz to'lovini
  // storno qila oladi (server: `whollyThisOrder`). Mijoz puli FIFO bilan o'z-o'zidan
  // taqsimlanadi, ya'ni bitta to'lov ikki buyurtmani yopishi ODATIY hol — bunday hujjatni
  // o'chirish boshqa buyurtmani ochib yuborardi, shuning uchun server unga tegmaydi va
  // pul baribir mijozning avansida qoladi. Oyna buni AYTMASA, «to'lamagandek bo'ladi»
  // degan va'da jimgina bajarilmasdi (2026-07-29).
  const sharedClientPayment = (order.allocations ?? []).some(
    (a) =>
      !a.voidedAt &&
      !a.payment?.voidedAt &&
      a.payment?.kind === 'CLIENT_IN' &&
      Math.abs(num(a.payment?.amount) - num(a.amount)) > 1,
  );
  /** VOID_ALL da ham mijozda qolib ketadigan pul (ulashilgan hujjat storno qilinmaydi) */
  const clientStaysAnyway = !isRefund && sharedClientPayment ? clientPaidUs : 0;

  // Zavodda qoladigan avans QAYSI cho'ntakka tushishini aytamiz — «avans» degan yalpi so'z
  // egasi uchun yetarli emas, u naqd va o'tkazma pulni alohida yuritadi. Qamrov bo'lmasa
  // (eski payload) kanal umuman aytilmaydi: taxmin qilingan kanal yolg'on bo'lardi.
  const paidCash = num(order.factoryCoverage?.paidCash);
  const paidBank = num(order.factoryCoverage?.paidBank);
  const factoryChannel = !order.factoryCoverage
    ? null
    : paidCash > 0 && paidBank > 0
      ? t("naqd va o'tkazma")
      : paidCash > 0
        ? t('naqd')
        : paidBank > 0
          ? t("o'tkazma")
          : null;

  const facts: ImpactFact[] = [
    {
      text: t("Buyurtma savdosi bekor qilinadi — mijozning bu buyurtma bo'yicha {sum} qarzi yo'qoladi", {
        sum: money(Math.max(0, num(order.saleTotal) - directTransport)),
      }),
      tone: 'neutral',
    },
    // Zavod tomoni — rejim SHU pulning ham taqdirini hal qiladi (2026-07-29 gacha u
    // tanlovdan qat'i nazar storno qilinardi).
    ...(factoryRealMoney > 0
      ? [
          {
            text: isRefund
              ? factoryChannel
                ? t(
                    "Zavodga o'tkazgan {sum} pulimiz ZAVODDA qoladi — {channel} avansimiz bo'lib turadi va keyingi buyurtmada «avansdan yechish» bilan ishlatiladi (kassaga QAYTMAYDI)",
                    { sum: money(factoryRealMoney), channel: factoryChannel },
                  )
                : t(
                    "Zavodga o'tkazgan {sum} pulimiz ZAVODDA, avansimiz bo'lib qoladi — keyingi buyurtmada «avansdan yechish» bilan ishlatiladi (kassaga QAYTMAYDI)",
                    { sum: money(factoryRealMoney) },
                  )
              : t(
                  "Zavodga o'tkazgan {sum} pulimiz to'liq orqaga qaytadi — zavodda avans QOLMAYDI (biz o'sha pulni umuman o'tkazmagandek bo'lamiz)",
                  { sum: money(factoryRealMoney) },
                ),
            tone: isRefund ? ('success' as const) : ('warning' as const),
          },
        ]
      : factoryPaid > 0
        ? []
        : [{ text: t("Zavodga bu buyurtma bo'yicha to'lov qilinmagan — zavod qarzimiz bekor bo'ladi"), tone: 'neutral' as const }]),
    // Bonusdan yopilgani — ikkala rejimda ham tegilmaydi, shuning uchun ALOHIDA aytiladi.
    ...(factoryBonusPaid > 0
      ? [
          {
            text: t(
              "Bundan {sum} bonus hisobidan yopilgan — u avansga aylanmaydi va hamyonga ham qaytmaydi (zavoddagi ortiqcha to'lovimiz bo'lib qoladi)",
              { sum: money(factoryBonusPaid) },
            ),
            tone: 'warning' as const,
          },
        ]
      : []),
    // Mijozning bizga to'lagani — rejim SHU pulning taqdirini hal qiladi.
    ...(clientPaidUs > 0
      ? [
          {
            text: isRefund
              ? t("Mijozning to'lagan {sum} puli uning AVANSIDA qoladi — keyingi buyurtmasiga ishlatiladi", {
                  sum: money(clientPaidUs),
                })
              : sharedClientPayment
                ? t(
                    "Mijozning {sum} to'lovi BOSHQA buyurtma bilan bitta hujjatda — uni bekor qilib bo'lmaydi (boshqa buyurtma ochilib ketardi). Shuning uchun bu pul baribir mijozning AVANSIDA qoladi",
                    { sum: money(clientPaidUs) },
                  )
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
          // To'rt holat ATAYIN alohida jumla: «0 so'm qoladi» deb yozish egani har safar
          // qaytib tekshirishga majbur qilardi.
          text:
            clientPaidUs > 0 && factoryRealMoney > 0
              ? t('YAKUNDA: mijozning avansida {client}, zavoddagi avansimizda esa {factory} qoladi', {
                  client: money(clientPaidUs),
                  factory: money(factoryRealMoney),
                })
              : clientPaidUs > 0
                ? t("YAKUNDA: mijozning avansida {client} qoladi; zavodga bu buyurtma bo'yicha pul o'tkazilmagan", {
                    client: money(clientPaidUs),
                  })
                : factoryRealMoney > 0
                  ? t("YAKUNDA: zavoddagi avansimizda {factory} qoladi; mijoz bu buyurtma uchun to'lov qilmagan", {
                      factory: money(factoryRealMoney),
                    })
                  : t("YAKUNDA: bu buyurtma bo'yicha pul harakati bo'lmagan — hech kimda hech narsa qolmaydi"),
          tone: 'success',
        }
      : clientStaysAnyway > 0
        ? {
            text: t(
              'YAKUNDA: zavodda iz qolmaydi, lekin mijozning avansida {client} qoladi — ulashilgan to‘lov hujjati bekor qilinmaydi',
              { client: money(clientStaysAnyway) },
            ),
            tone: 'warning',
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
    ...(isRefund
      ? [{ label: 'Mijozning avansida qoladi', value: clientPaidUs, strong: true }]
      : [{ label: 'Mijozda qoladi', value: clientStaysAnyway, strong: true }]),
    ...(factoryRealMoney > 0
      ? [{ label: 'Zavodda qoladigan avansimiz', value: isRefund ? factoryRealMoney : 0, strong: true }]
      : []),
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
        {/* 1) egasining savoli — javob IKKALA tomondagi pulning taqdirini belgilaydi */}
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 6 }}>
            {t("To'langan pullar avansda qoladimi?")}
          </div>
          <Segmented
            block
            value={mode}
            onChange={(v) => setMode(v as CancelMoneyMode)}
            disabled={submitting}
            options={[
              { value: 'REFUND', label: t('Ha — avansda qoladi') },
              { value: 'VOID_ALL', label: t("Yo'q — to'lamagandek bo'lsin") },
            ]}
          />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {clientPaidUs <= 0 && factoryPaid <= 0
              ? t("Bu buyurtma bo'yicha na mijoz to'lagan, na zavodga o'tkazilgan — tanlovning ahamiyati yo'q")
              : isRefund
                ? t("Mijozning puli bizda, bizning pulimiz zavodda qoladi — ikkalasi ham avansga aylanadi")
                : t("Ikkala to'lov hujjati ham bekor qilinadi — hech kim hech kimga to'lamagandek bo'ladi")}
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
