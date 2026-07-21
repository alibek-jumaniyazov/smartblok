// LiveBadge (04 §4.5, 03 §1.2) — honest realtime state, never decorative.
// Consumes useRealtimeStatus():
//   • live       → green dot «Jonli»
//   • connecting → amber pulse «Ulanmoqda…»
//   • offline    → grey «Oflayn — ma'lumot HH:mm holatiga» (enables refetch-on-focus
//                  in lib/realtime — the badge is only the visible half)
// Tooltip: «Oxirgi yangilanish: HH:mm:ss».
// The worklist popover (03 §1.2) ships later; the optional onClick is the seam for
// it — the badge renders standalone until then. TODO(worklists): popover on click.
import type { CSSProperties } from 'react';
import { Tooltip, theme } from 'antd';
import dayjs from 'dayjs';
import { useRealtimeStatus, type RealtimeStatus } from '../lib/realtime';
import { TOUCH_MIN, useIsTouch } from '../lib/responsive';
import { useT } from './LangContext';

export interface LiveBadgeProps {
  /** future: open the compact worklist popover (03 §1.2). Absent = static badge. */
  onClick?: () => void;
  className?: string;
  style?: CSSProperties;
}

export function LiveBadge({ onClick, className, style }: LiveBadgeProps) {
  const { status, lastEventAt } = useRealtimeStatus();
  const { token } = theme.useToken();
  const t = useT();
  const isTouch = useIsTouch();

  const stamp = lastEventAt ? dayjs(lastEventAt) : null;

  const cfg: Record<RealtimeStatus, { color: string; label: string; pulse: boolean }> = {
    live: { color: token.colorSuccess, label: t('Jonli'), pulse: false },
    connecting: { color: token.colorWarning, label: t('Ulanmoqda…'), pulse: true },
    offline: {
      color: token.colorTextTertiary,
      label: stamp
        ? t("Oflayn — ma'lumot {time} holatiga", { time: stamp.format('HH:mm') })
        : t('Oflayn'),
      pulse: false,
    },
  };
  const c = cfg[status];

  const tip = stamp
    ? t('Oxirgi yangilanish: {time}', { time: stamp.format('HH:mm:ss') })
    : t('Hali yangilanish kelmadi');

  const clickable = typeof onClick === 'function';

  return (
    // R12 — oxirgi yangilanish vaqti FAQAT tooltipda yashaydi, teginishda esa
    // hover yo'q. Bosish bilan ochiladigan qilinadi (agar onClick band bo'lmasa),
    // aks holda telefonda bu ma'lumotga umuman yo'l qolmaydi: TopBar'da nishon
    // `.sb-topbar__live` orqali faqat nuqtagacha yig'iladi.
    // «focus» ham qo'shiladi: nishon endi fokuslanadigan (§4 — role bor joyda
    // tabIndex ham bo'lishi shart), demak klaviatura bilan ham o'qib bo'ladi.
    <Tooltip title={tip} trigger={isTouch && !clickable ? ['click', 'focus'] : 'hover'}>
      <span
        role={clickable || isTouch ? 'button' : undefined}
        // role="button" bo'lgan joyda fokus ham bo'lishi kerak — aks holda skrin
        // rider uni tugma deb e'lon qiladi-yu, unga yetib bo'lmaydi.
        tabIndex={clickable || isTouch ? 0 : undefined}
        aria-live="polite"
        aria-label={`${t('Ulanish holati')}: ${c.label}. ${tip}`}
        onClick={onClick}
        onKeyDown={
          clickable
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onClick?.();
                }
              }
            : undefined
        }
        className={className}
        style={{
          // Teginishda nishon TopBar'da faqat 8x8 nuqtagacha yig'iladi
          // (design.css `.sb-topbar__live > span`), ya'ni 12x24 px hit-box —
          // holatni o'qishning yagona yo'li shu bo'lgani uchun u 44x44 ga
          // kengaytiriladi (§4 — --sb-touch). Sichqonchali desktopda 24px.
          // `flex` (`inline-flex` emas): o'ramchi span ichida baseline strut
          // qo'shimcha piksel bermasin — balandlik aniq 44px bo'lib qolsin.
          display: isTouch ? 'flex' : 'inline-flex',
          alignItems: 'center',
          ...(isTouch ? { justifyContent: 'center', minWidth: TOUCH_MIN } : null),
          gap: 6,
          height: isTouch ? TOUCH_MIN : 24,
          padding: '0 8px',
          borderRadius: 999,
          fontSize: 12,
          fontWeight: 500,
          whiteSpace: 'nowrap',
          color: token.colorTextSecondary,
          cursor: clickable ? 'pointer' : 'default',
          userSelect: 'none',
          ...style,
        }}
      >
        <span
          aria-hidden
          className={c.pulse ? 'sb-live-pulse' : undefined}
          style={{
            width: 8,
            height: 8,
            borderRadius: 999,
            background: c.color,
            flex: '0 0 auto',
          }}
        />
        {c.label}
      </span>
    </Tooltip>
  );
}
