// components/SummaryStrip.tsx — ro'yxat sahifasining YAKUNI, jadval TEPASIDA.
//
// Egasining qoidasi (2026-07-26): «jami» raqamlar jadvalning pastida emas, TEPASIDA
// turishi kerak — sahifa ochilishi bilan ko'rinsin, skroll qilish shart bo'lmasin.
// Shu sababli bu komponent AntD ning `summary` (pinned footer) qatorining o'rnini
// egallaydi; ro'yxat sahifalarida ikkalasi birga ishlatilmaydi.
//
// Bitta SCOPE qoidasi: bir stripdagi HAMMA raqam bir xil qamrovdan olinadi. Bir
// figurani serverdan (butun baza), boshqasini yuklangan qatorlardan olish — eng
// oson aldanadigan joy, shuning uchun qamrov `scopeLabel` orqali OCHIQ yoziladi.
import type { ReactNode } from 'react';
import { theme, Typography } from 'antd';
import { useIsPhone } from '../lib/responsive';
import { useT } from './LangContext';
import { MoneyCell } from './MoneyCell';

export interface SummaryFigure {
  key: string;
  /** t() kaliti — o'zbek lotin manba matni */
  label: string;
  value: string | number;
  /** MoneyCell varianti; `count` — pul emas, oddiy son (so'm qo'shilmaydi) */
  variant?: 'in' | 'owedToUs' | 'weOwe' | 'neutral' | 'count';
  /** kattaroq va qalin — stripning asosiy figurasi */
  strong?: boolean;
  /** 0 bo'lsa umuman chizilmaydi (masalan «bonusdan yopilgan») */
  hideWhenZero?: boolean;
  /** pul suffiksini almashtirish (masalan «dona», «m³») */
  suffix?: string;
}

export interface SummaryStripProps {
  figures: SummaryFigure[];
  /** qamrov yorlig'i — «Jami», «Tanlanganlar jami», … Figuralar ustida turadi. */
  scopeLabel?: string;
  /** pastdagi mayda izoh qatori (qamrov, sana oralig'i, hisoblash qoidasi) */
  note?: ReactNode;
  /** chap chekka rangi — standart brend ko'k */
  tone?: 'primary' | 'neutral';
  /** ma'lumot hali kelmagan bo'lsa chizilmaydi (nol bilan aldab qo'ymasin) */
  hidden?: boolean;
}

export function SummaryStrip({ figures, scopeLabel, note, tone = 'primary', hidden }: SummaryStripProps) {
  const { token } = theme.useToken();
  const t = useT();
  const isPhone = useIsPhone();

  if (hidden) return null;
  const shown = figures.filter((f) => !(f.hideWhenZero && Math.abs(Number(f.value) || 0) < 1));
  if (shown.length === 0) return null;

  return (
    <div
      className="sb-table-card"
      style={{
        padding: isPhone ? '10px 12px' : '14px 16px',
        marginBottom: isPhone ? 12 : 16,
        borderLeft: `3px solid ${tone === 'primary' ? token.colorPrimary : token.colorBorder}`,
      }}
    >
      {scopeLabel ? (
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: token.colorTextTertiary,
            marginBottom: 8,
          }}
        >
          {scopeLabel}
        </div>
      ) : null}
      <div style={{ display: 'flex', gap: isPhone ? 12 : 32, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        {shown.map((f) => (
          <div key={f.key} style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                color: token.colorTextTertiary,
                marginBottom: 2,
              }}
            >
              {t(f.label)}
            </div>
            <MoneyCell
              value={f.value}
              variant={f.variant === 'count' ? 'neutral' : (f.variant ?? 'neutral')}
              strong={f.strong}
              // «count» — dona/m³ kabi pul bo'lmagan figuralar so'm suffiksini olmaydi
              suffix={f.suffix ?? (f.variant === 'count' ? undefined : t("so'm"))}
              style={{ fontSize: f.strong ? 20 : 16 }}
            />
          </div>
        ))}
      </div>
      {note ? (
        <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
          {note}
        </Typography.Text>
      ) : null}
    </div>
  );
}
