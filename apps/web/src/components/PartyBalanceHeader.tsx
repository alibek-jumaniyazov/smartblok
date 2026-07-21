// PartyBalanceHeader (04 §2.3) — the hero of every party page: the balance IS the
// interface. Used by ClientDetail, FactoryDetail, VehicleDetail (the settlement hubs).
//
// Anatomy: party name + StatusChip/Nofaol pill + meta chips
//   (agent · region · phone / plate · driver · sig'im / bonus wallet for factories)
//   → money-hero balance as a SEMANTIC SENTENCE (BalanceTag logic, 02 §7):
//     client debt «Mijoz bizga qarz: …» / advance «Mijoz avansi: …»;
//     factory «Zavodga qarzimiz: …» / «Zavod avansimiz: …»;
//     vehicle «Shofyorga qarzimiz: …» / «Shofyor avansimiz: …»; <1 UZS «Hisob yopiq»
//   → secondary counters (PalletChip, OverdueChip, CreditGauge for clients)
//   → quick-action buttons pre-scoped to the party (filtered by permissions.ts can())
//   → optional period selector governing the PartyStatement below.
//
// States: sticky-condensed (48px bar: name + balance + one action, on scroll);
// inactive party (grey wash + «Nofaol» pill). The parent passes the already-loaded
// party object — this component renders, it does not fetch.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Button, Tag, theme } from 'antd';
import { fmtMoney, isSettled, num } from '../lib/format';
import { hexToRgba } from '../lib/tint';
import { TOPBAR_H, TOUCH_MIN, useIsPhone } from '../lib/responsive';
import { PalletChip } from './PalletChip';
import { CreditGauge } from './CreditGauge';
import { OverdueChip } from './SmallAtoms';
import { DateRangeControl, type DateRange } from './DateRangeControl';
import { StatusChip } from './StatusChip';
import { useT } from './LangContext';
import { translate } from '../lib/i18n';
import type { PartyType } from './BalanceTag';
import type { StatusMeta } from '../lib/status-maps';
import type { Capability } from '../lib/permissions';
import { can } from '../lib/permissions';
import { useAuth } from '../auth/AuthContext';
import type { Money } from '../lib/types';

/** The loaded party (superset of the three ledger parties' fields — all optional). */
export interface PartyHeaderParty {
  id: string;
  name: string;
  active?: boolean;
  /** signed ledger balance (Decimal string); sign convention per BalanceTag. */
  balance?: Money | null;
  // client meta
  agent?: { id?: string; name: string } | null;
  region?: { id?: string; name: string } | null;
  phone?: string | null;
  // vehicle meta
  plate?: string | null;
  driver?: string | null;
  capacityPallets?: number | null;
}

export interface PartyHeaderAction {
  key: string;
  label: string;
  icon?: ReactNode;
  onClick?: () => void;
  /** the (first visible) primary renders solid; also the one kept in the condensed bar. */
  primary?: boolean;
  danger?: boolean;
  disabled?: boolean;
  /** hide unless the current role holds this capability (mirrors the server, 03 §1.3). */
  cap?: Capability;
}

export interface PartyHeaderCounters {
  /** in-kind pallet balance → PalletChip (amber >0). */
  pallets?: number | null;
  /** overdue orders → OverdueChip «N ta muddati o'tgan · Σ». */
  overdue?: { count: number; sum: Money } | null;
  /** client credit headroom → CreditGauge. */
  credit?: { limit: Money | null; used: Money } | null;
  /** factory bonus wallet chip. */
  bonusWallet?: Money | null;
  /** escape hatch for anything extra. */
  extra?: ReactNode;
}

export interface PartyBalanceHeaderProps {
  party: PartyHeaderParty;
  partyType: PartyType;
  actions?: PartyHeaderAction[];
  counters?: PartyHeaderCounters;
  /** optional status chip beside the name (e.g. a party-level flag). */
  status?: StatusMeta;
  /** render a DateRangeControl for the statement below — only when onPeriodChange is set. */
  from?: string;
  to?: string;
  onPeriodChange?: (range: DateRange) => void;
  className?: string;
  style?: CSSProperties;
}

/** Semantic money-hero sentence + ink, per party type & sign (mirrors BalanceTag). */
function heroSentence(
  partyType: PartyType,
  balance: Money | null | undefined,
  token: ReturnType<typeof theme.useToken>['token'],
): { lead: string; ink: string; amount: number | null } {
  if (isSettled(balance ?? 0)) return { lead: translate('Hisob yopiq'), ink: token.colorTextSecondary, amount: null };
  const n = num(balance);
  if (partyType === 'client') {
    return n > 0
      ? { lead: translate('Mijoz bizga qarz'), ink: token.colorError, amount: n }
      : { lead: translate('Mijoz avansi'), ink: token.colorSuccess, amount: n };
  }
  if (partyType === 'factory') {
    return n < 0
      ? { lead: translate('Zavodga qarzimiz'), ink: token.colorWarning, amount: n }
      : { lead: translate('Zavod avansimiz'), ink: token.colorSuccess, amount: n };
  }
  // vehicle
  return n < 0
    ? { lead: translate('Shofyorga qarzimiz'), ink: token.colorWarning, amount: n }
    : { lead: translate('Shofyor avansimiz'), ink: token.colorSuccess, amount: n };
}

function MetaChip({ children }: { children: ReactNode }) {
  const { token } = theme.useToken();
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 12,
        color: token.colorTextSecondary,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

export function PartyBalanceHeader({
  party,
  partyType,
  actions,
  counters,
  status,
  from,
  to,
  onPeriodChange,
  className,
  style,
}: PartyBalanceHeaderProps) {
  const { token } = theme.useToken();
  const t = useT();
  const { user } = useAuth();
  const isPhone = useIsPhone();
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [condensed, setCondensed] = useState(false);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => setCondensed(!entry.isIntersecting), {
      threshold: 0,
      rootMargin: `-${TOPBAR_H + 8}px 0px 0px 0px`,
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const inactive = party.active === false;
  const hero = heroSentence(partyType, party.balance, token);
  // Telefonda yopishqoq siqilgan satr ko'rsatilmaydi (PageHeader `sticky`si ham
  // o'chirilgan, §2.4): 667px ekran TopBar + yopishqoq sarlavha + tab bar'ni
  // ko'tara olmaydi — qolgan joyda bir nechta qator ham sig'masdi.
  const condensedActive = condensed && !isPhone;

  const visibleActions = (actions ?? []).filter((a) => !a.cap || can(user?.role, a.cap));
  const primary = visibleActions.find((a) => a.primary) ?? visibleActions[0];
  const secondary = visibleActions.filter((a) => a !== primary);

  // telefonda raqam bosiladigan bo'ladi (R14); desktop ko'rinishi o'zgarmaydi
  const phoneNode = (p: string): ReactNode => (isPhone ? <a href={`tel:${p}`}>{p}</a> : p);

  // meta chips per party type
  const meta: ReactNode[] = [];
  if (partyType === 'client') {
    if (party.agent?.name) meta.push(<MetaChip key="agent">{t('Agent')}: {party.agent.name}</MetaChip>);
    if (party.region?.name) meta.push(<MetaChip key="region">{party.region.name}</MetaChip>);
    if (party.phone) meta.push(<MetaChip key="phone">{phoneNode(party.phone)}</MetaChip>);
  } else if (partyType === 'vehicle') {
    if (party.plate) meta.push(<MetaChip key="plate">{party.plate}</MetaChip>);
    if (party.driver) meta.push(<MetaChip key="driver">{party.driver}</MetaChip>);
    if (party.capacityPallets != null)
      meta.push(<MetaChip key="cap">{t("Sig'im")}: {party.capacityPallets} {t('paddon')}</MetaChip>);
    if (party.phone) meta.push(<MetaChip key="phone">{phoneNode(party.phone)}</MetaChip>);
  } else if (partyType === 'factory') {
    if (counters?.bonusWallet != null && num(counters.bonusWallet) !== 0)
      meta.push(
        <span
          key="bonus"
          className="num"
          style={{
            display: 'inline-flex',
            alignItems: 'baseline',
            gap: 4,
            fontSize: 12,
            padding: '1px 8px',
            borderRadius: token.borderRadiusSM,
            border: `1px solid ${token.colorBorder}`,
            color: token.colorTextSecondary,
            whiteSpace: 'nowrap',
          }}
        >
          {t('Bonus hamyon')}
          <span style={{ fontWeight: 600, color: token.colorText }}>{fmtMoney(counters.bonusWallet)}</span>
          {t("so'm")}
        </span>,
      );
  }

  const renderActionButton = (a: PartyHeaderAction, solid: boolean) => (
    <Button
      key={a.key}
      type={solid ? 'primary' : 'default'}
      icon={a.icon}
      danger={a.danger}
      disabled={a.disabled}
      onClick={a.onClick}
      // telefonda 2 tadan joylashadi, bittasi bo'lsa butun qatorni egallaydi
      style={isPhone ? { flex: '1 1 140px', minWidth: 0, minHeight: TOUCH_MIN } : undefined}
    >
      {t(a.label)}
    </Button>
  );

  const containerStyle: CSSProperties = {
    position: 'sticky',
    top: TOPBAR_H,
    zIndex: 6,
    background: inactive ? token.colorFillQuaternary : token.colorBgLayout,
    borderBottom: condensedActive ? `1px solid ${token.colorBorderSecondary}` : '1px solid transparent',
    marginBottom: 16,
    borderRadius: inactive ? token.borderRadiusLG : undefined,
    transition: 'padding 180ms cubic-bezier(0.2,0,0,1), border-color 180ms',
    ...style,
  };

  // ── condensed bar (48px): name + balance + one action ─────────────────────
  if (condensedActive) {
    return (
      <>
        <div ref={sentinelRef} aria-hidden style={{ height: 0 }} />
        <div className={className} style={{ ...containerStyle, paddingBlock: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 36 }}>
            <span style={{ fontWeight: 650, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {party.name}
            </span>
            <span className="num" style={{ color: hero.ink, fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap', flex: 1 }}>
              {hero.lead}
              {hero.amount != null ? `: ${fmtMoney(Math.abs(hero.amount))} ${t("so'm")}` : ''}
            </span>
            {primary ? renderActionButton(primary, true) : null}
          </div>
        </div>
      </>
    );
  }

  // ── full header ───────────────────────────────────────────────────────────
  // full mode is a CARD (bordered surface) so the hero reads as structured content, not
  // floating in the open; the condensed bar (above) stays a thin sticky strip.
  const fullStyle: CSSProperties = {
    background: inactive ? token.colorFillQuaternary : token.colorBgContainer,
    border: `1px solid ${token.colorBorderSecondary}`,
    borderRadius: token.borderRadiusLG,
    padding: isPhone ? '14px 12px' : '16px 18px',
    marginBottom: 16,
    ...style,
  };
  return (
    <>
      <div ref={sentinelRef} aria-hidden style={{ height: 0 }} />
      <div className={className} style={fullStyle}>
        {/* name + status + actions — telefonda amallar o'z qatoriga tushadi (R7) */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
            flexWrap: isPhone ? 'wrap' : undefined,
            rowGap: isPhone ? 10 : undefined,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <h1
                style={{
                  margin: 0,
                  fontSize: isPhone ? 18 : 22,
                  lineHeight: isPhone ? '24px' : '28px',
                  fontWeight: 650,
                  color: token.colorText,
                  minWidth: isPhone ? 0 : undefined,
                  overflowWrap: isPhone ? 'anywhere' : undefined,
                }}
              >
                {party.name}
              </h1>
              {status ? <StatusChip meta={status} variant="filled" /> : null}
              {inactive ? <Tag>{t('Nofaol')}</Tag> : null}
            </div>
            {meta.length > 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 6 }}>
                {meta}
              </div>
            ) : null}
          </div>
          {(primary || secondary.length > 0) && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                flexWrap: 'wrap',
                flex: isPhone ? '1 1 100%' : '0 0 auto',
              }}
            >
              {secondary.map((a) => renderActionButton(a, false))}
              {primary ? renderActionButton(primary, true) : null}
            </div>
          )}
        </div>

        {/* money-hero: the semantic sentence */}
        <div style={{ marginTop: 14 }}>
          <div
            className="num"
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 10,
              color: hero.ink,
              flexWrap: 'wrap',
            }}
          >
            <span style={{ fontSize: 15, fontWeight: 500 }}>{hero.lead}</span>
            {/* R17 — telefonda raqam clamp bilan kichrayadi va «so'm» qo'shni span
                bo'lib chiqadi (nowrap ichida emas), shunda u alohida satrga o'ta
                oladi va blok 290px minimal kenglikni talab qilmaydi. */}
            {hero.amount != null ? (
              isPhone ? (
                <>
                  <span
                    style={{
                      fontSize: 'clamp(20px, 7vw, 30px)',
                      lineHeight: 1.25,
                      fontWeight: 700,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {fmtMoney(Math.abs(hero.amount))}
                  </span>
                  <span style={{ fontSize: 15, fontWeight: 500 }}>{t("so'm")}</span>
                </>
              ) : (
                <span style={{ fontSize: 30, lineHeight: '36px', fontWeight: 700, whiteSpace: 'nowrap' }}>
                  {fmtMoney(Math.abs(hero.amount))}
                  <span style={{ fontSize: 16, fontWeight: 500, marginLeft: 6 }}>{t("so'm")}</span>
                </span>
              )
            ) : null}
          </div>
        </div>

        {/* secondary counters */}
        {(counters?.pallets != null ||
          counters?.overdue ||
          counters?.credit ||
          counters?.extra) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 12 }}>
            {counters?.overdue && counters.overdue.count > 0 ? (
              <OverdueChip count={counters.overdue.count} sum={counters.overdue.sum} />
            ) : null}
            {counters?.pallets != null && counters.pallets !== 0 ? (
              <PalletChip pallets={counters.pallets} />
            ) : null}
            {counters?.credit ? (
              <div style={{ minWidth: isPhone ? 0 : 220, width: isPhone ? '100%' : undefined }}>
                <CreditGauge limit={counters.credit.limit} used={counters.credit.used} />
              </div>
            ) : null}
            {counters?.extra}
          </div>
        )}

        {/* period selector governing the statement below */}
        {onPeriodChange ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
              marginTop: 14,
              paddingTop: 12,
              borderTop: `1px solid ${hexToRgba(token.colorBorderSecondary, 0.6)}`,
            }}
          >
            <span style={{ fontSize: 12, color: token.colorTextSecondary }}>{t('Davr')}:</span>
            {/* telefonda RangePicker butun qatorni egallaydi (yorliq tepasida qoladi) */}
            {isPhone ? (
              // `display:grid` — grid bolasi standart holda cho'ziladi, shuning
              // uchun RangePicker'ga style uzatmasdan ham to'liq kenglik oladi
              <div style={{ flex: '1 0 100%', minWidth: 0, display: 'grid' }}>
                <DateRangeControl from={from} to={to} onChange={onPeriodChange} size="middle" />
              </div>
            ) : (
              <DateRangeControl from={from} to={to} onChange={onPeriodChange} />
            )}
          </div>
        ) : null}
      </div>
    </>
  );
}
