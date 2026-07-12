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

export interface LiveBadgeProps {
  /** future: open the compact worklist popover (03 §1.2). Absent = static badge. */
  onClick?: () => void;
  className?: string;
  style?: CSSProperties;
}

export function LiveBadge({ onClick, className, style }: LiveBadgeProps) {
  const { status, lastEventAt } = useRealtimeStatus();
  const { token } = theme.useToken();

  const stamp = lastEventAt ? dayjs(lastEventAt) : null;

  const cfg: Record<RealtimeStatus, { color: string; label: string; pulse: boolean }> = {
    live: { color: token.colorSuccess, label: 'Jonli', pulse: false },
    connecting: { color: token.colorWarning, label: 'Ulanmoqda…', pulse: true },
    offline: {
      color: token.colorTextTertiary,
      label: stamp ? `Oflayn — ma'lumot ${stamp.format('HH:mm')} holatiga` : 'Oflayn',
      pulse: false,
    },
  };
  const c = cfg[status];

  const tip = stamp
    ? `Oxirgi yangilanish: ${stamp.format('HH:mm:ss')}`
    : 'Hali yangilanish kelmadi';

  const clickable = typeof onClick === 'function';

  return (
    <Tooltip title={tip}>
      <span
        role={clickable ? 'button' : undefined}
        tabIndex={clickable ? 0 : undefined}
        aria-live="polite"
        aria-label={`Ulanish holati: ${c.label}`}
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
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          height: 24,
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
