import { Popover, theme, Typography } from 'antd';
import { popupMaxWidth } from '../lib/responsive';
import { useT } from './LangContext';
import type { OrderProductRef } from '../lib/types';

export interface OrderProductsCellProps {
  /** `GET /orders` qatoridagi tayyor ro'yxat — ekran hech narsa hisoblamaydi */
  products?: OrderProductRef[] | null;
  /** telefon kartasidagi chip yo'li: kichikroq shrift, torroq ichki bo'shliq */
  compact?: boolean;
}

/** `600x300x200` ≡ `600×300×200` ≡ `600Х300Х200` — ajratgich va registr farqi o'chiriladi. */
const normSize = (s: string) => s.toLowerCase().replace(/[\s×xх*·-]/g, '');

/**
 * «D500 (600x300x200)» — lekin o'lcham nomning ICHIDA bo'lsa, takrorlanmaydi.
 *
 * Excel'dan import qilingan katalogda mahsulot nomi ko'pincha o'lchamning O'ZI
 * («600x300x100»), ba'zan esa uni o'z ichiga oladi («Газоблок 600x300x200») —
 * bunday qatorlarda qavsni ko'r-ko'rona qo'shish «600×300×100 (600×300×100)»
 * degan bema'nilikni berardi. O'lcham NULL ham bo'lishi mumkin (schema: `size String?`).
 */
export function productLabel(p: OrderProductRef): string {
  if (!p.size) return p.name;
  return normSize(p.name).includes(normSize(p.size)) ? p.name : `${p.name} (${p.size})`;
}

/**
 * Buyurtma ro'yxatidagi «Mahsulot» katagi (egasi so'rovi, 2026-07-28).
 *
 * Bitta buyurtmada bir nechta mahsulot bo'lishi mumkin, lekin jadval qatori bitta
 * satrdan iborat — shuning uchun BIRINCHI nom to'liq ko'rinadi, qolganlari «+N»
 * rozetkasi ortida turadi.
 *
 * «+N» — Popover, Tooltip EMAS (mobile-responsive-spec R12: tooltip qiymatni
 * BEZASHI mumkin, lekin qiymatning O'ZI bo'la olmaydi — teginishda u ochilmaydi).
 * Trigger ataylab `<button>`: `DataTable` ning qator-klik qo'riqchisi
 * `closest('a,button,input,…')` ni tekshiradi, ya'ni rozetkani bosish buyurtmani
 * ochib yubormaydi. Portal ichidagi klik esa alohida to'xtatiladi — telefon
 * kartasidagi qo'riqchi ro'yxatida `.ant-popover` YO'Q.
 */
export function OrderProductsCell({ products, compact = false }: OrderProductsCellProps) {
  const { token } = theme.useToken();
  const t = useT();

  const list = products ?? [];
  if (list.length === 0) return <Typography.Text type="secondary">—</Typography.Text>;

  const extra = list.length - 1;

  const panel = (
    // Portal 320px ekrandan chiqib ketmasin; klik kartaga ko'tarilmasin.
    <div
      onClick={(e) => e.stopPropagation()}
      style={{ minWidth: 180, maxWidth: popupMaxWidth(), display: 'grid', gap: 4 }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '.04em',
          textTransform: 'uppercase',
          color: token.colorTextTertiary,
        }}
      >
        {t('Buyurtma tarkibi')}
      </div>
      {list.map((p) => (
        <div key={p.id} style={{ overflowWrap: 'anywhere' }}>
          {productLabel(p)}
        </div>
      ))}
    </div>
  );

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        maxWidth: '100%',
        minWidth: 0,
      }}
    >
      {/* Qisqartirish ustun darajasidagi `ellipsis: true` bilan EMAS, shu yerda:
          ustun bayrog'i butun katakni nowrap konteynerga o'rab, «+N» ni kesib
          tashlardi. Kesiladigan qism faqat NOM. */}
      <span
        title={productLabel(list[0])}
        style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}
      >
        {productLabel(list[0])}
      </span>
      {extra > 0 ? (
        <Popover content={panel} trigger="click" placement="bottomLeft">
          <button
            type="button"
            aria-label={t('Buyurtma tarkibi')}
            className="num"
            style={{
              flex: '0 0 auto',
              cursor: 'pointer',
              padding: compact ? '0 5px' : '1px 6px',
              borderRadius: token.borderRadiusSM,
              border: `1px solid ${token.colorBorder}`,
              background: 'transparent',
              color: token.colorTextSecondary,
              fontSize: compact ? 11 : 12,
              lineHeight: compact ? '16px' : '18px',
              fontFamily: 'inherit',
            }}
          >
            +{extra}
          </button>
        </Popover>
      ) : null}
    </span>
  );
}
