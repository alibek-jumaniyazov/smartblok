// PeekPanel (04 §1.6) — the URL-addressable master-detail dock. A docked-right
// overlay panel (420px lists / 560px money documents) at elevation e2 with a 1px
// seam; the underlying list does NOT reflow — the panel overlays it (no mask), so
// deep links land in the list WITH the peek open. Header: title + ↑/↓ triage
// through the current list's rows + open-full ↗ + print ⎙ + close ✕. `↑/↓` moves
// the peek through rows (the caller rewrites the URL via replaceState — pass either
// onPrev/onNext or the ordered rowIds + activeId + onNavigate and this derives
// them); `Esc` closes. Mobile (<768) is a full-height bottom sheet. Motion: 180ms
// translate per 02 §5 (reduced-motion collapses it globally via design.css).
// Rendered through a body portal so the app layout never clips it.
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

/** 02 §5 — the peek slides in 180ms; reduced-motion is handled in design.css. */
const MOTION_MS = 180;

/** internal matchMedia hook — mobile switches the sheet to a bottom slide-up. */
function useMobile(): boolean {
  const [mobile, setMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const on = () => setMobile(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return mobile;
}

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
  const mobile = useMobile();
  const panelRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (open) {
      setMounted(true);
      const r = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(r);
    }
    setShown(false);
    const t = setTimeout(() => setMounted(false), MOTION_MS);
    return () => clearTimeout(t);
  }, [open]);

  // dialog semantics + keyboard triage: focus the panel once on open.
  useEffect(() => {
    if (open && mounted) {
      const t = setTimeout(() => panelRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open, mounted]);

  if (!mounted) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.defaultPrevented) return;
    const t = e.target as HTMLElement | null;
    const tag = t?.tagName;
    const editable =
      !!t &&
      (tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        t.isContentEditable ||
        t.getAttribute('role') === 'combobox');
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
  const placement: CSSProperties = mobile
    ? {
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        transform: shown ? 'translateY(0)' : 'translateY(100%)',
        borderTop: seam,
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
    <Tooltip key={key} title={label} mouseEnterDelay={0.4}>
      <Button
        type="text"
        size="small"
        aria-label={label}
        icon={icon}
        onClick={onClick}
        disabled={!onClick}
      />
    </Tooltip>
  );

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-modal={false}
      aria-label={typeof title === 'string' ? title : undefined}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      style={{
        ...placement,
        position: 'fixed',
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        background: token.colorBgElevated,
        boxShadow: 'var(--sb-shadow-e2)',
        transition: `transform ${MOTION_MS}ms cubic-bezier(0.2, 0, 0, 1)`,
        outline: 'none',
      }}
    >
      {/* header */}
      <div style={{ flex: '0 0 auto', padding: '12px 12px 12px 16px', borderBottom: seam }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, flex: '0 0 auto' }}>
            {prev || next ? (
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
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>{children}</div>

      {/* footer */}
      {footer != null ? (
        <div style={{ flex: '0 0 auto', padding: '12px 16px', borderTop: seam }}>{footer}</div>
      ) : null}
    </div>,
    document.body,
  );
}
