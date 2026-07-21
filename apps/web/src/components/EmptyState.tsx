// EmptyState / ErrorState (04 §4.6, platform state law 02 §9).
// One implementation per state class, reused everywhere:
//   • EmptyState — one 20px icon, one sentence, one action (02 §8). The filtered
//     variant swaps in «Filtrlarni tozalash» when `onClearFilters` is passed.
//   • ErrorState — an Uzbek lead sentence + the server message rendered VERBATIM
//     (never paraphrased) + «Qayta urinish». Reuses `apiError` from lib/api.
// Rendered in place of the failed/empty region only — page chrome survives.
//   I18N: `message` / lead o'zbek lotinda kelib, t() orqali tarjima qilinadi;
//   server matni HAR DOIM o'zgarmagan (verbatim) ko'rsatiladi.
import type { ReactNode } from 'react';
import { Button, theme } from 'antd';
import {
  ExclamationCircleOutlined,
  FilterOutlined,
  InboxOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { apiError } from '../lib/api';
import { useIsPhone } from '../lib/responsive';
import { useT } from './LangContext';

export interface EmptyStateProps {
  /** one sentence — the whole message (02 §8). */
  message: string;
  /** one 20px icon; defaults to inbox (or filter for the filtered variant). */
  icon?: ReactNode;
  /** one action (usually the page's primary create button). */
  action?: ReactNode;
  /** filtered variant: renders «Filtrlarni tozalash» and defaults the icon. */
  onClearFilters?: () => void;
}

export function EmptyState({ message, icon, action, onClearFilters }: EmptyStateProps) {
  const { token } = theme.useToken();
  const t = useT();
  const isPhone = useIsPhone();
  const filtered = typeof onClearFilters === 'function';
  const resolvedIcon = icon ?? (filtered ? <FilterOutlined /> : <InboxOutlined />);
  const resolvedAction = filtered ? (
    <Button type="link" onClick={onClearFilters}>
      {t('Filtrlarni tozalash')}
    </Button>
  ) : (
    action ?? null
  );

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        // telefonda 48px vertikal bo'shliq ekranning yarmini yeb qo'yardi
        padding: isPhone ? '28px 16px' : '48px 24px',
        textAlign: 'center',
      }}
    >
      <span style={{ fontSize: 20, lineHeight: 1, color: token.colorTextTertiary }}>
        {resolvedIcon}
      </span>
      <div style={{ color: token.colorTextSecondary, maxWidth: 420, minWidth: 0 }}>{t(message)}</div>
      {resolvedAction}
    </div>
  );
}

export interface ErrorStateProps {
  /** the caught error (query error, mutation error) — its server text is shown verbatim. */
  error: unknown;
  /** «Qayta urinish» handler; the button hides when absent. */
  onRetry?: () => void;
  /** optional Uzbek lead sentence override. */
  message?: string;
}

export function ErrorState({ error, onRetry, message }: ErrorStateProps) {
  const { token } = theme.useToken();
  const t = useT();
  const isPhone = useIsPhone();
  const server = apiError(error);
  const lead = message ? t(message) : t("Ma'lumotlarni yuklab bo'lmadi");

  return (
    <div
      role="alert"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        padding: isPhone ? '28px 16px' : '48px 24px',
        textAlign: 'center',
      }}
    >
      <span style={{ fontSize: 20, lineHeight: 1, color: token.colorError }}>
        <ExclamationCircleOutlined />
      </span>
      <div style={{ color: token.colorText, fontWeight: 600, minWidth: 0 }}>{lead}</div>
      {server && server !== lead ? (
        // server matni verbatim — telefonda uzun texnik satrlar ham o'ralsin
        <div
          style={{
            color: token.colorTextSecondary,
            maxWidth: 520,
            minWidth: 0,
            whiteSpace: 'pre-wrap',
            ...(isPhone ? { overflowWrap: 'anywhere' as const } : null),
          }}
        >
          {server}
        </div>
      ) : null}
      {onRetry ? (
        <Button icon={<ReloadOutlined />} onClick={onRetry}>
          {t('Qayta urinish')}
        </Button>
      ) : null}
    </div>
  );
}
