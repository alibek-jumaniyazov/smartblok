// PeekPanel (04 §1.6) — the URL-addressable master-detail dock. A docked-right
// overlay panel (420px lists / 560px money documents) at elevation e2 with a 1px
// seam; the underlying list does NOT reflow — the panel overlays it (no mask), so
// deep links land in the list WITH the peek open. Header: title + ↑/↓ triage
// through the current list's rows + open-full ↗ + print ⎙ + close ✕. `↑/↓` moves
// the peek through rows (the caller rewrites the URL via replaceState — pass either
// onPrev/onNext or the ordered rowIds + activeId + onNavigate and this derives
// them); `Esc` closes. Motion: 180ms translate per 02 §5 (reduced-motion collapses
// it globally via design.css). Rendered through a body portal so the app layout
// never clips it.
//
// MOBIL (mobile-responsive-spec §2.6): telefonda to'liq ekran varaq, lekin
// `top: calc(var(--sb-topbar-h) + var(--sb-safe-t))` dan boshlanadi — TopBar
// ko'rinib turadigan chiqish yo'li bo'lib qoladi (0 dan boshlansa foydalanuvchi
// qopqonga tushadi). Safe-area qo'shiladi, chunki `viewport-fit=cover` bilan
// TopBar ning HAQIQIY balandligi 48px emas, `48px + --sb-safe-t` (design.css
// §9) — o'yiqli iPhone'da faqat `--sb-topbar-h` yozilsa, peek butun TopBar
// qatorini (gamburger, sarlavha, avatar) bosib qolardi. zIndex 900,
// ya'ni AntD `zIndexPopupBase` (1000) dan QAT'IY PAST: peek ichidan ochilgan Modal
// / Drawer doim uning USTIDA turadi (avval 1000 edi va ReasonModal peek ostida
// qolib, ilova «qotgan» ko'rinardi). Qo'shimcha: tortish tutqichi + pastga surib
// yopish, tana skroll qulfi (iOS'da oddiy `overflow: hidden` ushlab turmaydi),
// safe-area futeri, 44x44 ikon tugmalar, ↑/↓ triaj telefonda olib tashlanadi.
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Button, Tooltip, theme } from 'antd';
import {
  CloseOutlined,
  DownOutlined,
  ExportOutlined,
  PrinterOutlined,
  UpOutlined,
} from '@ant-design/icons';
import { TOUCH_MIN, useIsPhone } from '../lib/responsive';
import { useT } from './LangContext';

/** 02 §5 — the peek slides in 180ms; reduced-motion is handled in design.css. */
const MOTION_MS = 180;
/** pastga surish shu masofadan oshsa — yopiladi */
const SWIPE_CLOSE_PX = 90;

export interface PeekPanelProps {
  open: boolean;
  onClose: () => void;
  /** header title (kind label for money docs, record name for lists). */
  title: ReactNode;
  /** meta line under the title (e.g. the date). */
  subtitle?: ReactNode;
  /** chips row under the title (StatusChips: method, reconciled, voided…). */
  chips?: ReactNode;
  /** 420 for lists (default), 560 for money documents (04 §1.6). */
  width?: number;
  /** footer action bar. */
  footer?: ReactNode;
  /** open-full ↗ — omit to hide (payments: the peek IS canonical, so omitted). */
  onOpenFull?: () => void;
  /** print ⎙ — omit to hide. */
  onPrint?: () => void;
  /** ↑/↓ triage: explicit handlers take priority over the rowIds form. */
  onPrev?: () => void;
  onNext?: () => void;
  /** ↑/↓ triage: ordered row ids + current id + navigate — derives prev/next. */
  rowIds?: readonly string[];
  activeId?: string;
  onNavigate?: (id: string) => void;
  children: ReactNode;
}

export function PeekPanel({
  open,
  onClose,
  title,
  subtitle,
  chips,
  width = 420,
  footer,
  onOpenFull,
  onPrint,
  onPrev,
  onNext,
  rowIds,
  activeId,
  onNavigate,
  children,
}: PeekPanelProps) {
  const { token } = theme.useToken();
  const t = useT();
  const isPhone = useIsPhone();
  const panelRef = useRef<HTMLDivElement>(null);

  // Portal konteyneri BIR MARTA yaratiladi (har ochilishda qayta qo'shilmaydi) —
  // aks holda stacking DOM tartibiga bog'liq bo'lib qolardi.
  const portalRef = useRef<HTMLDivElement | null>(null);
  if (portalRef.current === null && typeof document !== 'undefined') {
    const el = document.createElement('div');
    el.className = 'sb-peek-portal';
    portalRef.current = el;
  }
  useEffect(() => {
    const el = portalRef.current;
    if (!el) return;
    document.body.appendChild(el);
    return () => {
      el.remove();
    };
  }, []);

  // effective triage handlers: explicit onPrev/onNext win, else derive from the
  // ordered row id list + the active id (the caller navigates via replaceState).
  const idx = rowIds && activeId ? rowIds.indexOf(activeId) : -1;
  const prev =
    onPrev ?? (rowIds && onNavigate && idx > 0 ? () => onNavigate(rowIds[idx - 1]) : undefined);
  const next =
    onNext ??
    (rowIds && onNavigate && idx >= 0 && idx < rowIds.length - 1
      ? () => onNavigate(rowIds[idx + 1])
      : undefined);

  // keep the node mounted through the exit animation, then unmount.
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  /** pastga surish masofasi (telefon) */
  const [dragY, setDragY] = useState(0);
  const dragFrom = useRef<number | null>(null);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const r = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(r);
    }
    setShown(false);
    const timer = setTimeout(() => setMounted(false), MOTION_MS);
    return () => clearTimeout(timer);
  }, [open]);

  // dialog semantics + keyboard triage: focus the panel once on open.
  useEffect(() => {
    if (open && mounted) {
      const timer = setTimeout(() => panelRef.current?.focus(), 0);
      return () => clearTimeout(timer);
    }
  }, [open, mounted]);

  // Telefon: ochiq turganda sahifa skrolli qulflanadi. iOS'da `overflow: hidden`
  // ushlab turmaydi — `position: fixed` + saqlangan scrollY kerak.
  //
  // Shu yerda ilova ildizi `inert` ham qilinadi: telefonda peek to'liq ekran
  // varaq va skroll qulflangan, ya'ni ko'rayotgan foydalanuvchi uchun MODAL.
  // Inert bo'lmasa VoiceOver rotori va Tab tartibi ko'rinmayotgan, skrolli
  // qulflangan sahifa ichiga kirib ketardi. Faqat `#root`: AntD portallari
  // (peek ichidan ochilgan Modal/Drawer) body ning boshqa bolalari — ular
  // inert BO'LMASLIGI kerak, aks holda ular ham ishlamay qolardi.
  useEffect(() => {
    if (!open || !isPhone || typeof document === 'undefined') return;
    const y = window.scrollY;
    const b = document.body;
    const prevStyle = {
      position: b.style.position,
      top: b.style.top,
      width: b.style.width,
      overflow: b.style.overflow,
    };
    b.style.position = 'fixed';
    b.style.top = `-${y}px`;
    b.style.width = '100%';
    b.style.overflow = 'hidden';
    // `inert` — Chrome 102+/Safari 15.5+; `aria-hidden` eski brauzerlar uchun.
    const appRoot = document.getElementById('root');
    const hadInert = appRoot?.hasAttribute('inert') ?? true;
    const hadAriaHidden = appRoot?.hasAttribute('aria-hidden') ?? true;
    if (appRoot && !hadInert) appRoot.setAttribute('inert', '');
    if (appRoot && !hadAriaHidden) appRoot.setAttribute('aria-hidden', 'true');
    return () => {
      b.style.position = prevStyle.position;
      b.style.top = prevStyle.top;
      b.style.width = prevStyle.width;
      b.style.overflow = prevStyle.overflow;
      if (appRoot && !hadInert) appRoot.removeAttribute('inert');
      if (appRoot && !hadAriaHidden) appRoot.removeAttribute('aria-hidden');
      window.scrollTo(0, y);
    };
  }, [open, isPhone]);

  useEffect(() => {
    if (!open) {
      setDragY(0);
      dragFrom.current = null;
    }
  }, [open]);

  if (!mounted || !portalRef.current) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.defaultPrevented) return;
    const el = e.target as HTMLElement | null;
    const tag = el?.tagName;
    const editable =
      !!el &&
      (tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        el.isContentEditable ||
        el.getAttribute('role') === 'combobox');
    if (e.key === 'Escape') {
      if (editable) return;
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown' && next) {
      if (editable) return;
      e.preventDefault();
      next();
    } else if (e.key === 'ArrowUp' && prev) {
      if (editable) return;
      e.preventDefault();
      prev();
    }
  };

  const seam = `1px solid ${token.colorBorderSecondary}`;
  const phoneTransform = shown ? `translateY(${dragY}px)` : 'translateY(100%)';
  const placement: CSSProperties = isPhone
    ? {
        left: 0,
        right: 0,
        // TopBar ko'rinib turadi — ko'rinadigan, barmoqqa qulay chiqish yo'li.
        // `--sb-safe-t` shart: TopBar o'yiq ostida emas, uning TAGIDA turadi.
        top: 'calc(var(--sb-topbar-h) + var(--sb-safe-t))',
        bottom: 0,
        transform: phoneTransform,
        borderTop: seam,
        borderStartStartRadius: 'var(--sb-radius-lg)',
        borderStartEndRadius: 'var(--sb-radius-lg)',
      }
    : {
        top: 0,
        right: 0,
        bottom: 0,
        width,
        maxWidth: '100vw',
        transform: shown ? 'translateX(0)' : 'translateX(100%)',
        borderLeft: seam,
      };

  const iconBtn = (
    key: string,
    icon: ReactNode,
    label: string,
    onClick: (() => void) | undefined,
  ) => (
    <Tooltip key={key} title={t(label)} mouseEnterDelay={0.4}>
      <Button
        type="text"
        size={isPhone ? 'middle' : 'small'}
        aria-label={t(label)}
        icon={icon}
        onClick={onClick}
        disabled={!onClick}
        style={isPhone ? { width: TOUCH_MIN, height: TOUCH_MIN } : undefined}
      />
    </Tooltip>
  );

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      // Desktopda peek — DOCK: ro'yxat ortida ochiq qoladi, fokusni ushlamaydi.
      // Telefonda esa to'liq ekran varaq + skroll qulfi = haqiqiy modal.
      aria-modal={isPhone}
      aria-label={typeof title === 'string' ? title : undefined}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      style={{
        ...placement,
        position: 'fixed',
        // QAT'IY 1000 dan past: peek ichidan ochilgan Modal/Drawer doim ustida
        zIndex: 900,
        display: 'flex',
        flexDirection: 'column',
        background: token.colorBgElevated,
        boxShadow: 'var(--sb-shadow-e2)',
        transition: dragFrom.current != null ? 'none' : `transform ${MOTION_MS}ms cubic-bezier(0.2, 0, 0, 1)`,
        outline: 'none',
      }}
    >
      {/* header — telefonda tortish tutqichi + pastga surib yopish */}
      <div
        style={{
          flex: '0 0 auto',
          padding: isPhone ? '8px 8px 12px 14px' : '12px 12px 12px 16px',
          borderBottom: seam,
          touchAction: isPhone ? 'none' : undefined,
        }}
        onTouchStart={
          isPhone
            ? (e) => {
                dragFrom.current = e.touches[0].clientY;
              }
            : undefined
        }
        onTouchMove={
          isPhone
            ? (e) => {
                if (dragFrom.current == null) return;
                const d = e.touches[0].clientY - dragFrom.current;
                setDragY(d > 0 ? d : 0);
              }
            : undefined
        }
        onTouchEnd={
          isPhone
            ? () => {
                const shouldClose = dragY > SWIPE_CLOSE_PX;
                dragFrom.current = null;
                setDragY(0);
                if (shouldClose) onClose();
              }
            : undefined
        }
      >
        {isPhone ? <span className="sb-peek__grip" aria-hidden /> : null}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: isPhone ? 6 : 8 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontSize: 16,
                fontWeight: 600,
                lineHeight: '22px',
                color: token.colorText,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {title}
            </div>
            {subtitle != null ? (
              <div style={{ fontSize: 12, color: token.colorTextSecondary, marginTop: 2 }}>
                {subtitle}
              </div>
            ) : null}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: isPhone ? 6 : 2, flex: '0 0 auto' }}>
            {/* ↑/↓ triaj telefonda yo'q — joy yeydi, barmoq bilan aniq tegib bo'lmaydi */}
            {(prev || next) && !isPhone ? (
              <>
                {iconBtn('prev', <UpOutlined />, 'Oldingi', prev)}
                {iconBtn('next', <DownOutlined />, 'Keyingi', next)}
              </>
            ) : null}
            {onOpenFull ? iconBtn('full', <ExportOutlined />, "To'liq ochish", onOpenFull) : null}
            {onPrint ? iconBtn('print', <PrinterOutlined />, 'Chop etish', onPrint) : null}
            {iconBtn('close', <CloseOutlined />, 'Yopish', onClose)}
          </div>
        </div>
        {chips != null ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>{chips}</div>
        ) : null}
      </div>

      {/* body */}
      <div
        className="sb-peek__body"
        style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}
      >
        {children}
      </div>

      {/* footer */}
      {footer != null ? (
        <div
          style={{
            flex: '0 0 auto',
            padding: isPhone ? '12px 16px calc(12px + var(--sb-safe-b))' : '12px 16px',
            borderTop: seam,
          }}
        >
          {footer}
        </div>
      ) : null}
    </div>,
    portalRef.current,
  );
}
