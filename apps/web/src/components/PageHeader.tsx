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
//
//   MOBIL (mobile-responsive-spec §2.4): telefonda identifikatsiya qatori steklanadi
//   — sarlavha 17px va 2 satrga o'raladi, `subtitle` YASHIRILADI (u sahifa
//   bezagi, ma'lumot emas — har bir ro'yxat ustidan ~18px qaytariladi), `meta`
//   chiplari o'z satriga tushadi, amal bloki to'liq kenglikni oladi va asosiy
//   tugma `block` bo'ladi. `sticky` telefonda O'CHADI: 667px viewport TopBar +
//   yopishqoq sarlavha + filtr kartasi + tab bar'ni ko'tarib, ustiga yana besh
//   qator ko'rsata olmaydi.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Breadcrumb, Button, Dropdown, Skeleton, Tabs, theme } from 'antd';
import { MoreOutlined } from '@ant-design/icons';
import { useUrlFilters } from '../lib/useUrlFilters';
import { TOPBAR_H, useIsPhone } from '../lib/responsive';
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
  /** stick under the TopBar and condense to 40px on scroll (telefonda o'chirilgan) */
  sticky?: boolean;
  /** skeleton title while the page's headline data loads */
  loading?: boolean;
}

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
  const isPhone = useIsPhone();
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [condensed, setCondensed] = useState(false);

  // telefonda yopishqoq sarlavha vertikal joyni yeb qo'yadi — o'chiriladi
  const stickyOn = sticky && !isPhone;

  useEffect(() => {
    if (!stickyOn) {
      setCondensed(false);
      return;
    }
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      ([entry]) => setCondensed(!entry.isIntersecting),
      { threshold: 0, rootMargin: `-${TOPBAR_H + 8}px 0px 0px 0px` },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [stickyOn]);

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

  const titleStyle: CSSProperties = isPhone
    ? {
        margin: 0,
        fontSize: 17,
        lineHeight: '23px',
        fontWeight: 650,
        color: token.colorText,
        minWidth: 0,
        whiteSpace: 'normal',
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      }
    : {
        margin: 0,
        fontSize: condensed ? 14 : 20,
        lineHeight: condensed ? '20px' : '28px',
        fontWeight: 650,
        color: token.colorText,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        transition: 'font-size 180ms cubic-bezier(0.2,0,0,1)',
      };

  return (
    <>
      {stickyOn ? <div ref={sentinelRef} aria-hidden style={{ height: 0 }} /> : null}
      <div
        style={{
          position: stickyOn ? 'sticky' : undefined,
          top: stickyOn ? TOPBAR_H : undefined,
          zIndex: 6,
          background: token.colorBgLayout,
          marginBottom: isPhone ? 14 : 20,
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
            alignItems: subtitle && !condensed && !isPhone ? 'flex-start' : 'center',
            gap: isPhone ? 8 : 12,
            rowGap: 8,
            flexWrap: isPhone ? 'wrap' : undefined,
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
            <div style={{ display: 'flex', alignItems: 'center', gap: isPhone ? 8 : 12, minWidth: 0 }}>
              {loading ? (
                <Skeleton.Input active size="small" style={{ width: isPhone ? 160 : 220 }} />
              ) : (
                <h1 style={titleStyle}>{typeof title === 'string' ? t(title) : title}</h1>
              )}
              {status ? <span style={{ flex: '0 0 auto' }}>{status}</span> : null}
              {/* telefonda meta chiplari o'z satriga tushadi (pastda) */}
              {!condensed && meta && !isPhone ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
                  {meta}
                </div>
              ) : null}
            </div>
            {/* subtitle telefonda ko'rsatilmaydi — sahifa bezagi, ma'lumot emas */}
            {subtitle && !condensed && !loading && !isPhone ? (
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

          {meta && isPhone ? (
            <div
              style={{
                flex: '1 1 100%',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                flexWrap: 'wrap',
                minWidth: 0,
              }}
            >
              {meta}
            </div>
          ) : null}

          {(primary || overflow.length > 0) && (
            <div
              className="sb-pageheader__actions"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                flex: isPhone ? '1 1 100%' : '0 0 auto',
              }}
            >
              {primary ? (
                <Button
                  type="primary"
                  icon={primary.icon}
                  danger={primary.danger}
                  disabled={primary.disabled}
                  onClick={primary.onClick}
                  block={isPhone}
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
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 16,
                            justifyContent: 'space-between',
                            minWidth: isPhone ? 0 : 160,
                            minHeight: isPhone ? 36 : undefined,
                          }}
                        >
                          <span>{t(a.label)}</span>
                          {/* klaviatura maslahatlari telefonda ko'rsatilmaydi */}
                          {a.kbd && !isPhone ? <KbdHint>{a.kbd}</KbdHint> : null}
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
