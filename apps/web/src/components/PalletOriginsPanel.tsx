// PalletOriginsPanel — «Qaysi buyurtmalardan» (egasi so'rovi, 2026-08-13).
//
// Mijoz kartochkasi shu paytgacha bitta raqam ko'rsatardi: «hozir mijozda 15 dona».
// Egasining savoli esa boshqa edi — «o'sha 15 dona AYNAN qaysi buyurtmalardan qolgan,
// va agar Excel importidan kelgan bo'lsa, u ham ko'rinsinmi?» Bu panel o'sha yagona
// raqamni partiyalarga bo'lib beradi: har bir yetkazish bitta qator, har qatorda
// berilgan / qaytgan / undirilgan va QARZ.
//
// Panel HECH NARSA HISOBLAMAYDI. Taqsimot ham, uning «ustunlar qoldiqqa teng»
// kafolati ham serverda (apps/api/src/pallets/pallet-origins.ts): `unassigned` —
// QOLDIQ, ya'ni daftar bu modul ko'rmagan narsani (qo'lda tuzatish, egasiz storno)
// tutsa ham jadval baribir kartochkadagi raqamga tushadi. Aks holda bitta ekranda
// bitta savolga ikki xil javob turardi.
//
// PUL YO'Q: paddon — natura (04 §2.9). MoneyCell ham, «so'm» ham bu yerda yo'q.
import { Table, Tooltip, Typography, theme } from 'antd';
import type { TableProps } from 'antd';
import { Link } from 'react-router-dom';
import { fmtDate, fmtNum } from '../lib/format';
import { useIsPhone } from '../lib/responsive';
import { hexToRgba } from '../lib/tint';
import { useT } from './LangContext';
import type { PalletOriginBreakdown, PalletOriginLot } from '../lib/types';

export interface PalletOriginsPanelProps {
  data?: PalletOriginBreakdown;
  loading?: boolean;
  /** ochiq partiya yo'q bo'lganda umuman chizilmaydi (qoldiq 0 — aytadigan gap yo'q) */
  hideWhenEmpty?: boolean;
}

/** «Manba ko'rsatilmagan» qatori — jadval qoldiqqa tushishi uchun QOLDIQ sifatida chiziladi. */
const UNASSIGNED_ID = '__unassigned__';

type Row = PalletOriginLot & { unassigned?: boolean };

export function PalletOriginsPanel({ data, loading, hideWhenEmpty = true }: PalletOriginsPanelProps) {
  const { token } = theme.useToken();
  const t = useT();
  const isPhone = useIsPhone();

  // Ma'lumot kelmaguncha HECH NARSA chizilmaydi — na eski javobda (origins'siz), na
  // yuklanish paytida. Nol bilan to'ldirilgan jadval yolg'on bo'lardi, sarlavhasi esa
  // «0 dona · 0 ta buyurtmadan» deb FAKT sifatida turardi va javob kelganda sakrab
  // yo'qolardi. Qoldiq chipda baribir turibdi, shuning uchun kutish jim o'tadi.
  if (!data) return null;
  const lots = data.lots ?? [];
  const unassigned = data.unassigned ?? 0;
  if (hideWhenEmpty && lots.length === 0 && unassigned === 0) return null;

  const rows: Row[] = [
    ...lots,
    ...(unassigned !== 0
      ? [
          {
            id: UNASSIGNED_ID,
            unassigned: true,
            orderId: null,
            orderNo: null,
            date: '',
            orderStatus: null,
            cancelled: false,
            factoryId: null,
            factoryName: null,
            delivered: 0,
            returned: 0,
            chargedLost: 0,
            outstanding: unassigned,
            importBatchId: null,
            importBatchLabel: null,
            ageDays: 0,
          } as Row,
        ]
      : []),
  ];

  const qty = (v: number, strong = false, ink?: string) => (
    <span
      className="num"
      style={{ fontWeight: strong ? 700 : 500, color: ink ?? token.colorText, whiteSpace: 'nowrap' }}
    >
      {fmtNum(v)}
    </span>
  );

  /** Excel importi va bekor qilingan buyurtma — ikkala rozetka ham qator IDENTIFIKATSIYASI. */
  const badges = (r: Row) => {
    if (r.unassigned) return null;
    return (
      <>
        {r.cancelled ? (
          <Tooltip
            title={t(
              "Buyurtma bekor qilingan, lekin paddoni hamon mijozda: mijoz qo'lidagi son yetmagani uchun storno qirqilgan. Mijoz keyingi paddon olganda yoki qaytarish bekor qilinganda avtomatik yopiladi.",
            )}
          >
            <span
              style={{
                fontSize: 11,
                padding: '1px 6px',
                borderRadius: 999,
                whiteSpace: 'nowrap',
                color: token.colorError,
                background: hexToRgba(token.colorError, 0.1),
              }}
            >
              {t('Bekor qilingan')}
            </span>
          </Tooltip>
        ) : null}
        {r.importBatchId ? (
          <Tooltip title={r.importBatchLabel ?? t('Excel import')}>
            <span
              style={{
                fontSize: 11,
                padding: '1px 6px',
                borderRadius: 999,
                whiteSpace: 'nowrap',
                color: token.colorTextTertiary,
                background: token.colorFillQuaternary,
              }}
            >
              {t('Excel import')}
            </span>
          </Tooltip>
        ) : null}
      </>
    );
  };

  const columns: TableProps<Row>['columns'] = [
    {
      title: t('Buyurtma'),
      key: 'order',
      width: 190,
      render: (_, r) => {
        if (r.unassigned) {
          return (
            <Tooltip
              title={t(
                "Bu paddon hech qaysi buyurtmaga bog'lanmagan — qo'lda kiritilgan tuzatish yoki aslisiz storno qatori. Paddon harakatlari defterida ko'rinadi.",
              )}
            >
              <span style={{ color: token.colorTextSecondary }}>{t("Manba ko'rsatilmagan")}</span>
            </Tooltip>
          );
        }
        return (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, minWidth: 0 }}>
            {r.orderId && r.orderNo ? (
              <Link to={`/orders/${r.orderId}`}>{r.orderNo}</Link>
            ) : (
              <span style={{ color: token.colorTextSecondary }}>—</span>
            )}
            {badges(r)}
          </div>
        );
      },
    },
    {
      title: t('Sana'),
      key: 'date',
      width: 150,
      render: (_, r) =>
        r.unassigned ? (
          '—'
        ) : (
          <span style={{ whiteSpace: 'nowrap' }}>
            {fmtDate(r.date)}
            {r.outstanding > 0 && r.ageDays > 0 ? (
              <span style={{ marginInlineStart: 6, fontSize: 11, color: token.colorTextTertiary }}>
                {t('{n} kun', { n: fmtNum(r.ageDays) })}
              </span>
            ) : null}
          </span>
        ),
    },
    {
      title: t('Zavod'),
      key: 'factory',
      ellipsis: true,
      render: (_, r) => r.factoryName ?? '—',
    },
    {
      title: t('Berilgan'),
      key: 'delivered',
      align: 'right',
      className: 'num',
      width: 100,
      render: (_, r) => (r.unassigned ? '—' : qty(r.delivered)),
    },
    {
      title: t('Qaytargan'),
      key: 'returned',
      align: 'right',
      className: 'num',
      width: 110,
      render: (_, r) =>
        r.unassigned ? '—' : r.returned > 0 ? qty(r.returned, false, token.colorSuccess) : '—',
    },
    {
      title: t("Yo'qotilgan"),
      key: 'lost',
      align: 'right',
      className: 'num',
      width: 110,
      render: (_, r) =>
        r.unassigned ? '—' : r.chargedLost > 0 ? qty(r.chargedLost, false, token.colorError) : '—',
    },
    {
      // Panelning YAGONA asosiy figurasi — «shu buyurtmadan qarz».
      title: t('Qarz (dona)'),
      key: 'outstanding',
      align: 'right',
      className: 'num',
      width: 120,
      render: (_, r) => qty(r.outstanding, true, r.outstanding > 0 ? token.colorWarning : token.colorTextSecondary),
    },
  ];

  const total = rows.reduce((a, r) => a + r.outstanding, 0);

  // TELEFON: 7 ustunli jadval 320px da o'qilmaydi — har partiya o'z kartasida, asosiy
  // figura o'ngda (mobile-responsive-spec §2.2.2 dagi karta modelining o'zi).
  const cards = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rows.map((r) => (
        <div
          key={r.id}
          style={{
            border: `1px solid ${token.colorBorderSecondary}`,
            borderRadius: token.borderRadiusLG,
            padding: '10px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, minWidth: 0 }}>
              {r.unassigned ? (
                <span style={{ color: token.colorTextSecondary }}>{t("Manba ko'rsatilmagan")}</span>
              ) : r.orderId && r.orderNo ? (
                <Link to={`/orders/${r.orderId}`}>{r.orderNo}</Link>
              ) : (
                '—'
              )}
              {badges(r)}
            </div>
            <span style={{ whiteSpace: 'nowrap' }}>
              {qty(r.outstanding, true, r.outstanding > 0 ? token.colorWarning : token.colorTextSecondary)}
              <span style={{ fontSize: 11, color: token.colorTextTertiary, marginInlineStart: 4 }}>
                {t('dona')}
              </span>
            </span>
          </div>
          {r.unassigned ? null : (
            <div style={{ fontSize: 12, color: token.colorTextSecondary, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              <span>{fmtDate(r.date)}</span>
              {r.factoryName ? <span>{r.factoryName}</span> : null}
              <span>
                {t('Berilgan')} <span className="num">{fmtNum(r.delivered)}</span>
              </span>
              {r.returned > 0 ? (
                <span>
                  {t('Qaytargan')} <span className="num">{fmtNum(r.returned)}</span>
                </span>
              ) : null}
              {r.chargedLost > 0 ? (
                <span>
                  {t("Yo'qotilgan")} <span className="num">{fmtNum(r.chargedLost)}</span>
                </span>
              ) : null}
            </div>
          )}
        </div>
      ))}
    </div>
  );

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: isPhone ? 14 : 16,
        borderRadius: token.borderRadiusLG,
        border: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgContainer,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '.04em',
            textTransform: 'uppercase',
            color: token.colorTextSecondary,
          }}
        >
          {t('Qaysi buyurtmalardan')}
        </span>
        {/* Yakun TEPADA (egasi qoidasi, 2026-07-26) va u kartochkadagi chip bilan bitta
            raqam: jadval har doim shu songa tushadi (server kafolati). */}
        <span style={{ fontSize: 12, color: token.colorTextSecondary }}>
          <span className="num" style={{ fontWeight: 700, color: token.colorWarning }}>
            {fmtNum(total)}
          </span>{' '}
          {t('dona')} · {t('{n} ta buyurtmadan', { n: fmtNum(rows.filter((r) => !r.unassigned).length) })}
        </span>
      </div>

      {isPhone ? (
        cards
      ) : (
        <Table<Row>
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={rows}
          loading={loading}
          pagination={false}
          scroll={{ x: 900 }}
        />
      )}

      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {t(
          "Qaytarilgan paddon eng eski buyurtmadan boshlab yopiladi (qaytarish qatorida buyurtma ko'rsatilgan bo'lsa — o'shandan). Paddonda seriya raqami yo'q, shuning uchun bu taqsimot — daftarning eng ehtimolli o'qilishi.",
        )}
      </Typography.Text>
    </div>
  );
}
