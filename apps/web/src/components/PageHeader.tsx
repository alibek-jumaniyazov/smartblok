// PageHeader (04 §1.2) — the one identity block on every page; ends the title-size
// lottery and feeds the TopBar breadcrumb. Anatomy:
//   breadcrumb (linked ancestors) → 20px title + StatusChip slot + meta chips →
//   right ActionBar (1 primary + overflow kebab with KbdHints) → optional tab strip
//   synced to ?tab= via useUrlFilters.
// States: default; sticky-condensed on scroll (IntersectionObserver on a sentinel;
//   collapses to 40px: breadcrumb/meta/tabs hide, title 14px, actions stay); loading
//   (skeleton title). Chrome may animate (02 §5); numbers never do — none live here.
//   I18N: action/breadcrumb yorliqlari string bo'lsa t() bilan tarjima qilinadi;
//   `title`/`subtitle` ReactNode — ularni chaqiruvchi hal qiladi.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Breadcrumb, Button, Dropdown, Skeleton, Tabs, theme } from 'antd';
import { MoreOutlined } from '@ant-design/icons';
import { useUrlFilters } from '../lib/useUrlFilters';
import { useT } from './LangContext';
import { KbdHint } from './SmallAtoms';

export interface PageHeaderCrumb {
  label: string;
  /** react-router path; omit for the current (last) crumb */
  to?: string;
}

export interface PageHeaderAction {
  key: string;
  label: string;
  icon?: ReactNode;
  onClick?: () => void;
  /** keyboard hint chip rendered in the kebab (03 §8) */
  kbd?: string;
  danger?: boolean;
  disabled?: boolean;
  /** the first `primary` action renders as the solid button; the rest fall to the kebab */
  primary?: boolean;
}

export interface PageHeaderTab {
  key: string;
  label: ReactNode;
}

export interface PageHeaderProps {
  title: ReactNode;
  /** muted descriptive line under the title (buissnes_crm-parity page identity) */
  subtitle?: ReactNode;
  /** render the 4px brand accent bar beside the title + a gradient primary button
   *  (buissnes_crm-parity identity). Opt-in per page so the migration stays gradual. */
  accent?: boolean;
  breadcrumb?: PageHeaderCrumb[];
  /** StatusChip slot (rendered beside the title) */
  status?: ReactNode;
  /** meta chips: date, party, etc. (rendered as a gap row after the title) */
  meta?: ReactNode;
  actions?: PageHeaderAction[];
  tabs?: PageHeaderTab[];
  /** controlled active tab; when omitted the strip reads/writes `?tab=` */
  activeTab?: string;
  /** override the default `?tab=` write */
  onTabChange?: (key: string) => void;
  /** stick under the TopBar and condense to 40px on scroll */
  sticky?: boolean;
  /** skeleton title while the page's headline data loads */
  loading?: boolean;
}

/** Height of the TopBar the sticky header parks beneath (03 §1). */
const TOPBAR_H = 48;

export function PageHeader({
  title,
  subtitle,
  accent = false,
  breadcrumb,
  status,
  meta,
  actions,
  tabs,
  activeTab,
  onTabChange,
  sticky = false,
  loading = false,
}: PageHeaderProps) {
  const { token } = theme.useToken();
  const t = useT();
  const uf = useUrlFilters();
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [condensed, setCondensed] = useState(false);

  useEffect(() => {
    if (!sticky) return;
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      ([entry]) => setCondensed(!entry.isIntersecting),
      { threshold: 0, rootMargin: `-${TOPBAR_H + 8}px 0px 0px 0px` },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [sticky]);

  const primary = actions?.find((a) => a.primary && !a.disabled) ?? actions?.find((a) => a.primary);
  const overflow = (actions ?? []).filter((a) => a !== primary);

  const currentTab = activeTab ?? (uf.get('tab') || tabs?.[0]?.key);
  const changeTab = (key: string) => {
    if (onTabChange) onTabChange(key);
    else uf.set({ tab: key });
  };

  const crumbItems = breadcrumb?.map((c, i) => ({
    key: `${c.label}-${i}`,
    title: c.to ? <Link to={c.to}>{t(c.label)}</Link> : t(c.label),
  }));

  return (
    <>
      {sticky ? <div ref={sentinelRef} aria-hidden style={{ height: 0 }} /> : null}
      <div
        style={{
          position: sticky ? 'sticky' : undefined,
          top: sticky ? TOPBAR_H : undefined,
          zIndex: 6,
          background: token.colorBgLayout,
          marginBottom: 20,
          paddingBlock: condensed ? 6 : 4,
          borderBottom: condensed ? `1px solid ${token.colorBorderSecondary}` : '1px solid transparent',
          transition: 'padding 180ms cubic-bezier(0.2,0,0,1), border-color 180ms',
        }}
      >
        {!condensed && crumbItems && crumbItems.length > 0 ? (
          <Breadcrumb items={crumbItems} style={{ fontSize: 12, marginBottom: 6 }} />
        ) : null}

        <div
          style={{
            display: 'flex',
            alignItems: subtitle && !condensed ? 'flex-start' : 'center',
            gap: 12,
            minHeight: condensed ? 28 : 32,
          }}
        >
          {/* Brend urg'u chizig'i — buissnes_crm bilan bir xil sahifa identifikatsiyasi */}
          {accent && !condensed ? (
            <span
              aria-hidden
              style={{
                width: 4,
                alignSelf: 'stretch',
                minHeight: 30,
                borderRadius: 4,
                background: 'linear-gradient(180deg, #3b82f6, #1d4ed8)',
                flex: '0 0 auto',
              }}
            />
          ) : null}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
              {loading ? (
                <Skeleton.Input active size="small" style={{ width: 220 }} />
              ) : (
                <h1
                  style={{
                    margin: 0,
                    fontSize: condensed ? 14 : 20,
                    lineHeight: condensed ? '20px' : '28px',
                    fontWeight: 650,
                    color: token.colorText,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    transition: 'font-size 180ms cubic-bezier(0.2,0,0,1)',
                  }}
                >
                  {typeof title === 'string' ? t(title) : title}
                </h1>
              )}
              {status ? <span style={{ flex: '0 0 auto' }}>{status}</span> : null}
              {!condensed && meta ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
                  {meta}
                </div>
              ) : null}
            </div>
            {subtitle && !condensed && !loading ? (
              <p
                style={{
                  margin: 0,
                  fontSize: 13,
                  lineHeight: '18px',
                  color: token.colorTextSecondary,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {typeof subtitle === 'string' ? t(subtitle) : subtitle}
              </p>
            ) : null}
          </div>

          {(primary || overflow.length > 0) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '0 0 auto' }}>
              {primary ? (
                <Button
                  type="primary"
                  icon={primary.icon}
                  danger={primary.danger}
                  disabled={primary.disabled}
                  onClick={primary.onClick}
                  style={
                    accent && !primary.danger && !primary.disabled
                      ? { background: 'linear-gradient(135deg, #3b82f6, #1d4ed8)', border: 'none', fontWeight: 600 }
                      : undefined
                  }
                >
                  {t(primary.label)}
                </Button>
              ) : null}
              {overflow.length > 0 ? (
                <Dropdown
                  trigger={['click']}
                  menu={{
                    items: overflow.map((a) => ({
                      key: a.key,
                      icon: a.icon,
                      danger: a.danger,
                      disabled: a.disabled,
                      label: (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 16, justifyContent: 'space-between', minWidth: 160 }}>
                          <span>{t(a.label)}</span>
                          {a.kbd ? <KbdHint>{a.kbd}</KbdHint> : null}
                        </span>
                      ),
                      onClick: a.onClick,
                    })),
                  }}
                >
                  <Button icon={<MoreOutlined />} aria-label={t('Boshqa amallar')} />
                </Dropdown>
              ) : null}
            </div>
          )}
        </div>

        {!condensed && tabs && tabs.length > 0 ? (
          <Tabs
            activeKey={currentTab}
            onChange={changeTab}
            items={tabs.map((tab) => ({ key: tab.key, label: tab.label }))}
            style={{ marginTop: 4, marginBottom: -12 }}
          />
        ) : null}
      </div>
    </>
  );
}
