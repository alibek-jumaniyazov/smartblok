// FilterBar (04 §1.3, 03 §7) — THE URL-synced filter row. A debounced search
// input ('/' focuses it), 0–N typed filter tokens from a `schema` prop editing in
// popovers, a «+ Filtr» adder ('F'), active chips with per-chip clear, a
// «Tozalash» link, a SavedViews slot, and a result-meta slot. Every control
// writes `useUrlFilters`; the hook resets the page on any filter change.
//
// MOBIL (mobile-responsive-spec §2.5): telefonda qidiruv to'liq kenglikda, filtr
// muharrirlari esa Popover'dan PASTKI VARAQQA (Drawer placement="bottom") ko'chadi.
// Sabab: `daterange` muharriri ichida ikki panelli RangePicker (~636px) bor —
// ~344px popover ichida tugash sanasi tom ma'noda tanlab bo'lmas edi, va
// `body{overflow-x:hidden}` uni skroll qilmasdan KESAR edi. Varaqdagi barcha
// boshqaruvlar 100% kenglikda; `autoFocus` telefonda tushiriladi (iOS klaviaturasi
// aynan o'qilishi kerak bo'lgan ro'yxat ustiga ko'tariladi).
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { Badge, Button, Drawer, Flex, Input, Popover, Segmented, Select, theme } from 'antd';
import type { InputRef } from 'antd';
import { CloseOutlined, FilterOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { useUrlFilters } from '../lib/useUrlFilters';
import { fmtDate, fmtMoney, fmtNum } from '../lib/format';
import { useIsPhone } from '../lib/responsive';
import { PartySelect, type PartySelectType } from './PartySelect';
import { DateRangeControl } from './DateRangeControl';
import { useT } from './LangContext';
import { SavedViews, type SavedView } from './SavedViews';
import type { Money } from '../lib/types';

export type FilterFieldType = 'select' | 'party' | 'daterange' | 'segmented' | 'tristate';

export interface FilterField {
  key: string;
  label: string;
  type: FilterFieldType;
  /** select | segmented options */
  options?: { label: string; value: string }[];
  /** party picker type */
  partyType?: PartySelectType;
  /** hidden when the API doesn't honor the param (03 §7 * rule) — never faked. */
  hidden?: boolean;
  placeholder?: string;
  /** tristate labels (default Yashirish / Ko'rsatish / Faqat). */
  triLabels?: { hide?: string; show?: string; only?: string };
  /** daterange param keys (default from/to). */
  fromKey?: string;
  toKey?: string;
}

export interface FilterAggregate {
  count?: number;
  sum?: Money;
  sumSuffix?: string;
}

export interface FilterBarProps {
  schema: FilterField[];
  searchKey?: string;
  searchPlaceholder?: string;
  /** server aggregate → «214 ta · Σ 1 249 547 319 so'm». */
  aggregate?: FilterAggregate;
  /** full override of the right-aligned result-meta slot. */
  resultMeta?: ReactNode;
  /** auto-render SavedViews for this route key. */
  savedViewsKey?: string;
  savedViewsBuiltins?: SavedView[];
  /** or pass a SavedViews node / any element into the slot directly. */
  savedViews?: ReactNode;
  /** extra content before the result meta. */
  children?: ReactNode;
}

function isEditableTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

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

export function FilterBar({
  schema,
  searchKey = 'search',
  searchPlaceholder = 'Qidirish',
  aggregate,
  resultMeta,
  savedViewsKey,
  savedViewsBuiltins,
  savedViews,
  children,
}: FilterBarProps) {
  const { token } = theme.useToken();
  const t = useT();
  const isPhone = useIsPhone();

  const fields = useMemo(() => schema.filter((f) => !f.hidden), [schema]);
  const allKeys = useMemo(() => {
    const keys = new Set<string>([searchKey]);
    for (const f of fields) {
      if (f.type === 'daterange') {
        keys.add(f.fromKey ?? 'from');
        keys.add(f.toKey ?? 'to');
      } else keys.add(f.key);
    }
    return Array.from(keys);
  }, [fields, searchKey]);

  const uf = useUrlFilters(allKeys);

  const fromKeyOf = (f: FilterField) => f.fromKey ?? 'from';
  const toKeyOf = (f: FilterField) => f.toKey ?? 'to';
  const isDateRange = (f: FilterField) => f.type === 'daterange';
  const fieldHasValue = (f: FilterField) =>
    isDateRange(f) ? !!uf.get(fromKeyOf(f)) || !!uf.get(toKeyOf(f)) : !!uf.get(f.key);

  const activeFields = fields.filter(fieldHasValue);
  const inactiveFields = fields.filter((f) => !fieldHasValue(f));

  // remembered display names for party chips (id → name), filled as the user picks
  const [partyNames, setPartyNames] = useState<Record<string, string>>({});

  // ── search input (debounced) ──────────────────────────────────────────────
  const searchRef = useRef<InputRef>(null);
  const urlSearch = uf.get(searchKey);
  const [searchInput, setSearchInput] = useState(urlSearch);
  useEffect(() => {
    setSearchInput((prev) => (prev === urlSearch ? prev : urlSearch));
  }, [urlSearch]);
  const writeSearch = useDebounced((val: string) => uf.set({ [searchKey]: val || null }), 300);

  // ── chip / adder open state (kept in the parent to avoid remounts) ─────────
  const [openChip, setOpenChip] = useState<string | null>(null);
  const [adderOpen, setAdderOpen] = useState(false);
  const [picking, setPicking] = useState<FilterField | null>(null);
  // telefon: barcha muharrirlarni ushlab turuvchi pastki varaq
  const [sheetOpen, setSheetOpen] = useState(false);

  // ── '/' focuses search, 'F' opens the adder ──────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isEditableTarget(e.target)) return;
      if (e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        setPicking(null);
        setAdderOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const triLabels = (f: FilterField) => ({
    hide: t(f.triLabels?.hide ?? 'Yashirish'),
    show: t(f.triLabels?.show ?? "Ko'rsatish"),
    only: t(f.triLabels?.only ?? 'Faqat'),
  });

  const chipValue = (f: FilterField): { text: string; invalid?: boolean } => {
    if (isDateRange(f)) {
      const from = uf.get(fromKeyOf(f));
      const to = uf.get(toKeyOf(f));
      return { text: `${from ? fmtDate(from) : '…'} – ${to ? fmtDate(to) : '…'}` };
    }
    const raw = uf.get(f.key);
    if (f.type === 'party') return { text: partyNames[raw] ?? '…' };
    if (f.type === 'tristate') {
      const l = triLabels(f);
      return { text: raw === 'only' ? l.only : raw === 'show' ? l.show : l.hide };
    }
    const opt = f.options?.find((o) => o.value === raw);
    return opt ? { text: opt.label } : { text: raw, invalid: true };
  };

  const clearField = (f: FilterField) => {
    if (isDateRange(f)) uf.set({ [fromKeyOf(f)]: null, [toKeyOf(f)]: null });
    else uf.set({ [f.key]: null });
  };

  const clearAll = () => {
    uf.clear(allKeys);
    setSearchInput('');
  };

  // pure editor JSX (no hooks — safe to call from render helpers).
  // `autoFocus` telefonda hech qachon berilmaydi (R15).
  const renderEditor = (f: FilterField): ReactNode => {
    switch (f.type) {
      case 'select':
        return (
          <Select
            style={{ width: 240 }}
            showSearch
            optionFilterProp="label"
            allowClear
            autoFocus={!isPhone}
            placeholder={t(f.placeholder ?? f.label)}
            value={uf.get(f.key) || undefined}
            options={f.options}
            onChange={(v?: string) => uf.set({ [f.key]: v || null })}
          />
        );
      case 'party':
        return (
          <PartySelect
            type={f.partyType ?? 'client'}
            autoFocus={!isPhone}
            style={{ width: 260 }}
            value={uf.get(f.key) || undefined}
            onChange={(v, p) => {
              if (v && p?.name) setPartyNames((m) => ({ ...m, [v]: p.name as string }));
              uf.set({ [f.key]: v || null });
            }}
          />
        );
      case 'segmented':
        return (
          <Segmented
            block={isPhone}
            value={uf.get(f.key) || f.options?.[0]?.value}
            options={f.options ?? []}
            onChange={(v) => uf.set({ [f.key]: String(v) })}
          />
        );
      case 'tristate': {
        const l = triLabels(f);
        return (
          <Segmented
            block={isPhone}
            value={uf.get(f.key) || 'hide'}
            options={[
              { label: l.hide, value: 'hide' },
              { label: l.show, value: 'show' },
              { label: l.only, value: 'only' },
            ]}
            onChange={(v) => uf.set({ [f.key]: v === 'hide' ? null : String(v) })}
          />
        );
      }
      case 'daterange':
        return (
          <DateRangeControl
            size={isPhone ? 'middle' : 'small'}
            from={uf.get(fromKeyOf(f)) || undefined}
            to={uf.get(toKeyOf(f)) || undefined}
            onChange={({ from, to }) => uf.set({ [fromKeyOf(f)]: from || null, [toKeyOf(f)]: to || null })}
          />
        );
    }
  };

  const pillStyle = (invalid?: boolean): CSSProperties => ({
    display: 'inline-flex',
    alignItems: 'center',
    // telefonda yorliq va ✕ — ikkita alohida teginish nishoni: ular orasida
    // kamida 8px bo'lsin (§4), desktopda zichlik o'zgarmaydi.
    gap: isPhone ? 8 : 6,
    // 320px da chip qatorni ekrandan chiqarib yubormasin (faqat telefonda)
    ...(isPhone ? { maxWidth: '100%', minWidth: 0 } : null),
    height: isPhone ? 32 : 26,
    padding: isPhone ? '0 4px 0 8px' : '0 8px',
    borderRadius: token.borderRadiusSM,
    border: `1px solid ${invalid ? token.colorError : token.colorPrimaryBorder}`,
    background: invalid ? token.colorErrorBg : token.colorPrimaryBg,
    color: invalid ? token.colorError : token.colorText,
    fontSize: 13,
    whiteSpace: 'nowrap',
  });

  const anyActive = activeFields.length > 0 || !!urlSearch;
  /** varaq tugmasidagi hisoblagich — qidiruv ham filtr sifatida sanaladi */
  const activeCount = activeFields.length + (urlSearch ? 1 : 0);

  const meta =
    resultMeta ??
    (aggregate ? (
      <span className="num" style={{ color: token.colorTextSecondary, fontSize: 13, whiteSpace: 'nowrap' }}>
        {aggregate.count != null ? `${fmtNum(aggregate.count)} ta` : null}
        {aggregate.sum != null ? ` · Σ ${fmtMoney(aggregate.sum)} ${aggregate.sumSuffix ?? "so'm"}` : null}
      </span>
    ) : null);

  const savedViewsNode =
    savedViews ?? (savedViewsKey ? <SavedViews routeKey={savedViewsKey} builtins={savedViewsBuiltins} /> : null);

  const searchInputNode = (
    <Input
      ref={searchRef}
      allowClear
      prefix={<SearchOutlined style={{ color: token.colorTextTertiary }} />}
      placeholder={searchPlaceholder}
      value={searchInput}
      onChange={(e) => {
        setSearchInput(e.target.value);
        writeSearch(e.target.value);
      }}
      style={{ width: isPhone ? '100%' : 240, minWidth: 0 }}
    />
  );

  /** faol filtr chipi — desktopda Popover muharriri, telefonda varaqni ochadi */
  const renderChip = (f: FilterField) => {
    const { text, invalid } = chipValue(f);
    // Enter/Space — span'ni haqiqiy tugmaga aylantiradi (role="button" bilan birga).
    const onActivate = (run: () => void) => (e: ReactKeyboardEvent<HTMLSpanElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        run();
      }
    };
    const body = (
      <span style={pillStyle(invalid)}>
        <span
          // Telefonda bu span varaqni ochadi. `onClick` + `cursor:pointer` skrin-riderga
          // hech narsa demaydi va tab tartibida ham yo'q — shuning uchun role/tabIndex/
          // klaviatura ishlovchisi (R13). Desktopda butun chipni Popover ushlaydi:
          // u yerda hech narsa qo'shilmaydi (muzlatilgan sirt).
          {...(isPhone
            ? {
                role: 'button' as const,
                tabIndex: 0,
                onClick: () => setSheetOpen(true),
                onKeyDown: onActivate(() => setSheetOpen(true)),
              }
            : {})}
          style={{
            cursor: 'pointer',
            ...(isPhone ? { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' } : null),
          }}
        >
          {t(f.label)}: <b>{text}</b>
        </span>
        <CloseOutlined
          aria-label={t('{label} filtrini olib tashlash', { label: t(f.label) })}
          {...(isPhone
            ? { role: 'button' as const, tabIndex: 0, onKeyDown: onActivate(() => clearField(f)) }
            : {})}
          style={{
            fontSize: isPhone ? 12 : 10,
            cursor: 'pointer',
            color: token.colorTextTertiary,
            flex: '0 0 auto',
            // 28x28 teginish maydoni yalang'och 12px glif o'rniga. MANFIY MARGIN
            // YO'Q: u hit-box'ni har tomondan 8px chiqarib, (a) yorliq span'ining
            // ustiga tushardi — DOM tartibida keyin turgani uchun teginishni O'ZI
            // yutib, «tahrirlash» o'rniga filtrni O'CHIRARDI — va (b) chip
            // chegarasidan 4px tashqariga chiqib, qo'shni chipga yopishardi.
            ...(isPhone ? { padding: 8 } : null),
          }}
          onClick={(e) => {
            e.stopPropagation();
            clearField(f);
          }}
        />
      </span>
    );
    if (isPhone) return <span key={f.key}>{body}</span>;
    return (
      <Popover
        key={f.key}
        trigger="click"
        placement="bottomLeft"
        open={openChip === f.key}
        onOpenChange={(o) => setOpenChip(o ? f.key : null)}
        content={<div style={{ padding: 4 }}>{renderEditor(f)}</div>}
      >
        {body}
      </Popover>
    );
  };

  // ── TELEFON: qidiruv + «Filtrlar» varaq tugmasi ──────────────────────────
  if (isPhone) {
    const sheetFields = [...activeFields, ...inactiveFields];
    return (
      <Flex vertical gap={8} style={{ width: '100%', minWidth: 0 }}>
        {searchInputNode}

        <Flex align="center" gap={8} wrap style={{ minWidth: 0 }}>
          <Badge count={activeCount} size="small" offset={[-2, 2]}>
            <Button icon={<FilterOutlined />} onClick={() => setSheetOpen(true)}>
              {t('Filtrlar')}
            </Button>
          </Badge>
          {anyActive ? (
            <Button type="link" style={{ paddingInline: 4 }} onClick={clearAll}>
              {t('Tozalash')}
            </Button>
          ) : null}
          {savedViewsNode}
          {children}
        </Flex>

        {activeFields.length > 0 ? (
          // gap=10: qo'shni chipning ✕ si bilan keyingi chipning yorlig'i orasida
          // kamida 8px bo'lishi uchun (§4 teginish nishonlari oralig'i)
          <Flex align="center" gap={10} wrap style={{ minWidth: 0 }}>
            {activeFields.map(renderChip)}
          </Flex>
        ) : null}

        {/* agregat satri (`… ta · Σ … so'm`) nowrap — 320px da kesilmasin deb
            o'z ichida gorizontal skroll qiladi */}
        {meta ? (
          <div className="sb-scroll-x" style={{ width: '100%' }}>
            {meta}
          </div>
        ) : null}

        <Drawer
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          placement="bottom"
          title={t('Filtrlar')}
          styles={{
            wrapper: { width: '100%', height: 'auto', maxHeight: '88dvh' },
            body: { padding: '12px 14px', maxHeight: '66dvh', overflowY: 'auto' },
            footer: { padding: '12px 14px calc(12px + var(--sb-safe-b))' },
          }}
          footer={
            <Flex gap={8}>
              <Button block onClick={clearAll}>
                {t('Tozalash')}
              </Button>
              <Button block type="primary" onClick={() => setSheetOpen(false)}>
                {/* ASCII apostrof (U+0027) — lug'atdagi kalit shu (i18n.dict.ts).
                    U+02BB bilan yozilsa DICT[src] aniq mos kelmay, ru/en'da xom
                    o'zbekcha matn chiqadi. */}
                {t("Qo'llash")}
              </Button>
            </Flex>
          }
        >
          <div className="sb-filter-sheet">
            {sheetFields.length === 0 ? (
              <div style={{ color: token.colorTextTertiary }}>{t("Boshqa filtr yo'q")}</div>
            ) : (
              sheetFields.map((f) => (
                <div key={f.key} className="sb-filter-sheet__field">
                  <span className="sb-filter-sheet__label">{t(f.label)}</span>
                  {renderEditor(f)}
                </div>
              ))
            )}
          </div>
        </Drawer>
      </Flex>
    );
  }

  // ── DESKTOP / PLANSHET: bugungi qator, o'zgarishsiz ──────────────────────
  return (
    <Flex align="center" gap={8} wrap style={{ width: '100%' }}>
      {searchInputNode}

      {activeFields.map(renderChip)}

      <Popover
        trigger="click"
        placement="bottomLeft"
        open={adderOpen}
        onOpenChange={(o) => {
          setAdderOpen(o);
          if (!o) setPicking(null);
        }}
        content={
          picking ? (
            <div style={{ padding: 4, minWidth: 220 }}>
              <Button type="link" size="small" style={{ paddingInline: 0, marginBottom: 4 }} onClick={() => setPicking(null)}>
                ‹ {t('Orqaga')}
              </Button>
              <div>{renderEditor(picking)}</div>
            </div>
          ) : (
            <div style={{ minWidth: 180 }}>
              {inactiveFields.length === 0 ? (
                <div style={{ color: token.colorTextTertiary, padding: 8 }}>{t("Boshqa filtr yo'q")}</div>
              ) : (
                inactiveFields.map((f) => (
                  <div
                    key={f.key}
                    onClick={() => setPicking(f)}
                    style={{ padding: '6px 8px', cursor: 'pointer', borderRadius: 6 }}
                  >
                    {t(f.label)}
                  </div>
                ))
              )}
            </div>
          )
        }
      >
        <Button size="small" icon={<PlusOutlined />}>
          {t('Filtr')}
        </Button>
      </Popover>

      {anyActive ? (
        <Button type="link" size="small" style={{ paddingInline: 4 }} onClick={clearAll}>
          {t('Tozalash')}
        </Button>
      ) : null}

      {savedViewsNode}
      {children}

      {meta ? <div style={{ marginInlineStart: 'auto' }}>{meta}</div> : null}
    </Flex>
  );
}
