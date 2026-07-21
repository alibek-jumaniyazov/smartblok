// TableCard — the ONE table container. Every list surface wraps its <Table> (or
// <DataTable>) in this so every page reads the same at a glance: a bordered card,
// optional overline title + right-side actions, an optional full-width toolbar row
// (filters), a 2px refetch hairline, and a full-bleed table (zero body padding so
// the table's own borders meet the card edge). Purely presentational.
//
// MOBIL (mobile-responsive-spec §2.6): telefon xatti-harakati TO'LIQ CSS orqali
// (design.css MOBILE LAYER) — bu faylda hech qanday breakpoint mantiqi yo'q:
//   · `__head` o'raladi (`flex-wrap: wrap`), `__title` `min-width: 0` oladi va
//     `__extra` o'z satriga tushadi (boshqaruvlar sarlavha bilan tortishmasin);
//   · sahifa darajasidagi karta EKRAN CHETIGACHA cho'ziladi (`border-radius: 0`
//     + manfiy inline margin) — 320px da 24px gorizontal joy qaytariladi;
//   · `__head` / `__toolbar` / `__footer` padding'i 10px 12px ga tushadi.
// To'liq kenglik faqat `.sb-content` / `.sb-page` / `.sb-stack` ning BEVOSITA
// bolalariga beriladi, ya'ni ichma-ich joylashgan karta ekrandan chiqib ketmaydi.
import type { CSSProperties, ReactNode } from 'react';

export interface TableCardProps {
  /** overline card title (e.g. «Mijozlar») */
  title?: ReactNode;
  /** right side of the header row: links, view toggles, small actions */
  extra?: ReactNode;
  /** full-width row under the header — the filter bar lives here */
  toolbar?: ReactNode;
  /** footer row under the table (totals, notes) */
  footer?: ReactNode;
  /** the <Table> / <DataTable> */
  children: ReactNode;
  /** show the 2px indeterminate refetch hairline at the top edge */
  loading?: boolean;
  /** body padding around the table (default 0 = full-bleed) */
  bodyPadding?: number;
  className?: string;
  style?: CSSProperties;
}

/** TableCard — standard list container (border + optional header/toolbar + table). */
export function TableCard({
  title,
  extra,
  toolbar,
  footer,
  children,
  loading = false,
  bodyPadding = 0,
  className,
  style,
}: TableCardProps) {
  const hasHead = title != null || extra != null;
  return (
    <div className={['sb-table-card', className].filter(Boolean).join(' ')} style={style}>
      {loading ? <div className="refetch-hairline sb-table-card__hairline" /> : null}
      {hasHead ? (
        <div className="sb-table-card__head">
          {title != null ? <span className="sb-table-card__title">{title}</span> : <span />}
          {extra != null ? <div className="sb-table-card__extra">{extra}</div> : null}
        </div>
      ) : null}
      {toolbar != null ? <div className="sb-table-card__toolbar">{toolbar}</div> : null}
      <div className="sb-table-card__body" style={bodyPadding ? { padding: bodyPadding } : undefined}>
        {children}
      </div>
      {footer != null ? <div className="sb-table-card__footer">{footer}</div> : null}
    </div>
  );
}
