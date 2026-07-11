// PartySelect / CashboxSelect / LegalEntitySelect — the unified pickers
// (04 §2.11). Server-searched (300ms debounce) party pickers and small-list
// cashbox / legal-entity pickers, all sharing one react-query cache across
// mounts. Option rows are `name + secondary meta + right-aligned BalanceTag`
// (cashboxes: live balance); capped results never truncate silently — they
// carry a disabled «… yana N ta — qidiruvni aniqlashtiring» footer.
//
// PartySelect hits the existing list endpoints with ?search=&pageSize=20 via the
// raw axios client (the typed endpoint wrappers for factory/vehicle/agent take
// no params). Cashboxes and legal entities are small GETs, filtered client-side.
import { useCallback, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Button, Flex, Select, Spin, theme } from 'antd';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, apiError, endpoints } from '../lib/api';
import { fmtMoney } from '../lib/format';
import { CASHBOX_TYPE, CURRENCY, LEGAL_ENTITY_KIND } from '../lib/status-maps';
import { BalanceTag } from './BalanceTag';
import type { Cashbox, LegalEntity, Money } from '../lib/types';

const PAGE_SIZE = 20;

export type PartySelectType = 'client' | 'factory' | 'vehicle' | 'agent';
type Size = 'small' | 'middle' | 'large';
type SelectStatus = '' | 'error' | 'warning';

/** loose row shape shared by the four party list endpoints */
interface PartyRecord {
  id: string;
  name: string;
  balance?: Money | null;
  outstandingDebt?: Money | null;
  phone?: string | null;
  plate?: string | null;
  driver?: string | null;
  clientCount?: number | null;
  palletBalance?: number | null;
  note?: string | null;
  region?: { name?: string | null } | null;
  agent?: { name?: string | null } | null;
}

interface PartyOpt {
  value: string;
  label: string;
  party?: PartyRecord;
  disabled?: boolean;
  __footer?: boolean;
  __moreN?: number;
}

const PARTY_PATH: Record<PartySelectType, string> = {
  client: '/clients',
  factory: '/factories',
  vehicle: '/vehicles',
  agent: '/agents',
};

const PLACEHOLDER: Record<PartySelectType, string> = {
  client: 'Mijozni tanlang',
  factory: 'Zavodni tanlang',
  vehicle: 'Moshinani tanlang',
  agent: 'Agentni tanlang',
};

async function fetchParties(type: PartySelectType, search: string) {
  const { data } = await api.get(PARTY_PATH[type], {
    params: { search: search || undefined, pageSize: PAGE_SIZE },
  });
  const items = (Array.isArray(data) ? data : data?.items ?? []) as PartyRecord[];
  const total = Array.isArray(data) ? undefined : (data?.total as number | undefined);
  return { items, total };
}

/** debounced callback — no external dep, keeps the latest fn reference */
function useDebounced<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  const timer = useRef<number | undefined>(undefined);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  return useCallback(
    (...args: A) => {
      if (timer.current !== undefined) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => fnRef.current(...args), ms);
    },
    [ms],
  );
}

function metaFor(type: PartySelectType, p: PartyRecord): string {
  const parts: (string | null | undefined)[] = [];
  if (type === 'client') parts.push(p.agent?.name, p.region?.name);
  else if (type === 'vehicle') parts.push(p.plate, p.driver);
  else if (type === 'agent') parts.push(p.phone, p.clientCount != null ? `${p.clientCount} ta mijoz` : undefined);
  else parts.push(p.note);
  return parts.filter(Boolean).join(' · ');
}

/** two-line option row: identity + meta on the left, a right-aligned figure. */
function OptionRow({ name, meta, right }: { name: ReactNode; meta?: ReactNode; right?: ReactNode }) {
  const { token } = theme.useToken();
  return (
    <Flex align="center" justify="space-between" gap={8} style={{ width: '100%' }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
        {meta ? (
          <div
            style={{
              fontSize: 12,
              color: token.colorTextSecondary,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {meta}
          </div>
        ) : null}
      </div>
      {right ? <div style={{ flexShrink: 0 }}>{right}</div> : null}
    </Flex>
  );
}

function InlineRetry({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { token } = theme.useToken();
  return (
    <Flex vertical gap={6} style={{ padding: 8 }}>
      <span style={{ color: token.colorError, fontSize: 13 }}>{apiError(error)}</span>
      <Button size="small" onClick={onRetry}>
        Qayta urinish
      </Button>
    </Flex>
  );
}

function CappedFooter({ moreN }: { moreN?: number }) {
  const { token } = theme.useToken();
  return (
    <span style={{ color: token.colorTextTertiary, fontSize: 12 }}>
      {moreN != null
        ? `… yana ${fmtMoney(moreN)} ta — qidiruvni aniqlashtiring`
        : '… natijalar cheklangan — qidiruvni aniqlashtiring'}
    </span>
  );
}

export interface PartySelectProps {
  type: PartySelectType;
  value?: string;
  onChange?: (value: string | undefined, party?: PartyRecord) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
  allowClear?: boolean;
  size?: Size;
  style?: CSSProperties;
  status?: SelectStatus;
}

export function PartySelect({
  type,
  value,
  onChange,
  disabled,
  autoFocus,
  placeholder,
  allowClear = true,
  size = 'middle',
  style,
  status,
}: PartySelectProps) {
  const { token } = theme.useToken();
  const [search, setSearch] = useState('');
  const seen = useRef<Map<string, PartyRecord>>(new Map());
  const onSearch = useDebounced(setSearch, 300);

  const q = useQuery({
    queryKey: ['party-select', type, search],
    queryFn: () => fetchParties(type, search),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });

  const items = q.data?.items ?? [];
  const total = q.data?.total;
  for (const p of items) seen.current.set(p.id, p);

  const balanceNode = (p: PartyRecord): ReactNode => {
    if (type === 'agent') {
      if (p.outstandingDebt == null) return null;
      return (
        <span className="num" style={{ fontSize: 12, color: token.colorTextSecondary }}>
          {fmtMoney(p.outstandingDebt)} so'm
        </span>
      );
    }
    // type is narrowed to 'client' | 'factory' | 'vehicle' — matches BalanceTag
    if (p.balance == null) return null;
    return (
      <BalanceTag
        balance={String(p.balance)}
        partyType={type}
        compact
        pallets={type === 'client' ? p.palletBalance : undefined}
      />
    );
  };

  const options = useMemo<PartyOpt[]>(() => {
    const base: PartyOpt[] = items.map((p) => ({ value: p.id, label: p.name, party: p }));
    if (value && !items.some((i) => i.id === value)) {
      const cached = seen.current.get(value);
      base.unshift({ value, label: cached?.name ?? value, party: cached });
    }
    const shown = items.length;
    if (typeof total === 'number' && total > shown) {
      base.push({ value: '__more__', label: '', disabled: true, __footer: true, __moreN: total - shown });
    } else if (typeof total !== 'number' && shown >= PAGE_SIZE) {
      base.push({ value: '__more__', label: '', disabled: true, __footer: true });
    }
    return base;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, total, value]);

  return (
    <Select<string>
      showSearch
      filterOption={false}
      onSearch={onSearch}
      value={value || undefined}
      onChange={(v) => onChange?.(v || undefined, v ? seen.current.get(v) : undefined)}
      onClear={() => onChange?.(undefined)}
      loading={q.isFetching}
      disabled={disabled}
      autoFocus={autoFocus}
      allowClear={allowClear}
      placeholder={placeholder ?? PLACEHOLDER[type]}
      size={size}
      status={status || undefined}
      style={{ width: '100%', minWidth: 200, ...style }}
      options={options}
      optionRender={(opt) => {
        const o = opt.data as unknown as PartyOpt;
        if (o.__footer) return <CappedFooter moreN={o.__moreN} />;
        const p = o.party;
        if (!p) return o.label;
        return <OptionRow name={p.name} meta={metaFor(type, p)} right={balanceNode(p)} />;
      }}
      notFoundContent={
        q.isError ? (
          <InlineRetry error={q.error} onRetry={() => q.refetch()} />
        ) : q.isFetching ? (
          <div style={{ padding: 8, textAlign: 'center' }}>
            <Spin size="small" />
          </div>
        ) : undefined
      }
    />
  );
}

// ── CashboxSelect ─────────────────────────────────────────────────────────
export interface CashboxSelectProps {
  value?: string;
  onChange?: (value: string | undefined, cashbox?: Cashbox) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  /** currency filter (PaymentComposer scopes to the payment's currency, 04 §3.3) */
  currency?: 'UZS' | 'USD';
  placeholder?: string;
  allowClear?: boolean;
  size?: Size;
  style?: CSSProperties;
  status?: SelectStatus;
}

export function CashboxSelect({
  value,
  onChange,
  disabled,
  autoFocus,
  currency,
  placeholder = 'Kassani tanlang',
  allowClear = true,
  size = 'middle',
  style,
  status,
}: CashboxSelectProps) {
  const { token } = theme.useToken();
  const q = useQuery({ queryKey: ['cashboxes'], queryFn: () => endpoints.cashboxes(), staleTime: 60_000 });

  const list = (q.data ?? []).filter((c) => c.active !== false && (!currency || c.currency === currency));
  const byId = useMemo(() => new Map(list.map((c) => [c.id, c])), [list]);
  const options = list.map((c) => ({ value: c.id, label: c.name, cashbox: c }));

  return (
    <Select<string>
      showSearch
      filterOption={(input, opt) =>
        (((opt as unknown as { cashbox?: Cashbox })?.cashbox?.name ?? '') as string)
          .toLowerCase()
          .includes(input.toLowerCase())
      }
      value={value || undefined}
      onChange={(v) => onChange?.(v || undefined, v ? byId.get(v) : undefined)}
      onClear={() => onChange?.(undefined)}
      loading={q.isFetching}
      disabled={disabled}
      autoFocus={autoFocus}
      allowClear={allowClear}
      placeholder={placeholder}
      size={size}
      status={status || undefined}
      style={{ width: '100%', minWidth: 200, ...style }}
      options={options}
      optionRender={(opt) => {
        const c = (opt.data as unknown as { cashbox: Cashbox }).cashbox;
        return (
          <OptionRow
            name={c.name}
            meta={`${CASHBOX_TYPE[c.type].label} · ${CURRENCY[c.currency].label}`}
            right={
              c.balance != null ? (
                <span className="num" style={{ fontSize: 12, color: token.colorText }}>
                  {fmtMoney(c.balance)} {CURRENCY[c.currency].label}
                </span>
              ) : null
            }
          />
        );
      }}
      notFoundContent={
        q.isError ? <InlineRetry error={q.error} onRetry={() => q.refetch()} /> : undefined
      }
    />
  );
}

// ── LegalEntitySelect ─────────────────────────────────────────────────────
export interface LegalEntitySelectProps {
  value?: string;
  onChange?: (value: string | undefined, entity?: LegalEntity) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  /** filter to one kind (payer/receiver pickers, 04 §3.3) */
  kind?: 'DEALER' | 'FACTORY' | 'THIRD_PARTY';
  placeholder?: string;
  allowClear?: boolean;
  size?: Size;
  style?: CSSProperties;
  status?: SelectStatus;
}

export function LegalEntitySelect({
  value,
  onChange,
  disabled,
  autoFocus,
  kind,
  placeholder = 'Firmani tanlang',
  allowClear = true,
  size = 'middle',
  style,
  status,
}: LegalEntitySelectProps) {
  const q = useQuery({ queryKey: ['legal-entities'], queryFn: () => endpoints.legalEntities(), staleTime: 60_000 });

  const list = (q.data ?? []).filter((e) => e.active !== false && (!kind || e.kind === kind));
  const byId = useMemo(() => new Map(list.map((e) => [e.id, e])), [list]);
  const options = list.map((e) => ({ value: e.id, label: e.name, entity: e }));

  return (
    <Select<string>
      showSearch
      filterOption={(input, opt) =>
        (((opt as unknown as { entity?: LegalEntity })?.entity?.name ?? '') as string)
          .toLowerCase()
          .includes(input.toLowerCase())
      }
      value={value || undefined}
      onChange={(v) => onChange?.(v || undefined, v ? byId.get(v) : undefined)}
      onClear={() => onChange?.(undefined)}
      loading={q.isFetching}
      disabled={disabled}
      autoFocus={autoFocus}
      allowClear={allowClear}
      placeholder={placeholder}
      size={size}
      status={status || undefined}
      style={{ width: '100%', minWidth: 200, ...style }}
      options={options}
      optionRender={(opt) => {
        const e = (opt.data as unknown as { entity: LegalEntity }).entity;
        return (
          <OptionRow
            name={e.name}
            meta={`${LEGAL_ENTITY_KIND[e.kind].label}${e.inn ? ` · INN ${e.inn}` : ''}`}
          />
        );
      }}
      notFoundContent={
        q.isError ? <InlineRetry error={q.error} onRetry={() => q.refetch()} /> : undefined
      }
    />
  );
}
