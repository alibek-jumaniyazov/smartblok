// DataTable (04 §1.5, 02 §6) — the one table. Wraps AntD Table with the platform
// contract: sticky small header, keyboard cursor row (J/K/arrows, Enter opens,
// Space peeks, X selects), server-driven pagination wired to useUrlFilters,
// honest skeleton loading (8 rows, header intact), a 2px refetch hairline,
// EmptyState (filtered variant) / ErrorState, ghost-row rendering, disabled sort
// headers with a tooltip unless a column opts into a real server sort, totals via
// the native `summary` prop, column presets + density, optional selection.
//
// It stays a thin pass-through: `columns`, `rowKey`, `onRow`, `summary` etc. all
// forward to AntD Table.
//
// MOBIL (mobile-responsive-spec §2.2) — telefonda IKKI yo'l bor:
//   • KARTA RO'YXATI — ustunlar `mobile: 'title' | 'subtitle' | 'value' | 'meta'`
//     bilan belgilangan bo'lsa (yoki `mobileCard` berilgan bo'lsa). Asosiy
//     ro'yxatlar (Buyurtmalar, Mijozlar, Agentlar, …) shu yo'ldan yuradi.
//   • SKROLL QILUVCHI JADVAL — zich moliyaviy defterlar (`mobileMode="table"`)
//     va hali belgilanmagan jadvallar uchun. Hech narsa buzilmaydi: eng yomon
//     holatda bugungi ko'rinish + gorizontal skroll.
// Yechim tartibi: mobileCard → ustun metama'lumoti → skroll qiluvchi jadval.
// Desktop (>= 992px) hech qanday o'zgarishsiz qoladi: har bir mobil tarmoq
// `useIsPhone()` / `useIsDesktop()` ortida.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  isValidElement,
  type Key,
  type ReactNode,
} from 'react';
import {
  Button,
  Checkbox,
  Dropdown,
  Flex,
  Pagination,
  Segmented,
  Skeleton,
  Table,
  Tooltip,
  theme,
} from 'antd';
import type { MenuProps, TableProps } from 'antd';
import type { ColumnType } from 'antd/es/table';
import { MoreOutlined, RightOutlined } from '@ant-design/icons';
import { asItems } from '../lib/api';
import { fmtNum } from '../lib/format';
import { useUrlFilters } from '../lib/useUrlFilters';
import { TOPBAR_H, TOUCH_MIN, useIsDesktop, useIsPhone } from '../lib/responsive';
import { EmptyState, ErrorState } from './EmptyState';
import { useT } from './LangContext';

type Size = 'small' | 'middle' | 'large';

/** Telefon kartasidagi slot: ustun qayerga tushishi (§2.2.1). */
export type MobileRole = 'title' | 'subtitle' | 'value' | 'meta' | 'hidden';

/** AntD column + our opt-ins: stable preset key + real server sort field. */
export type SbColumn<T> = ColumnType<T> & {
  /** stable identity for column presets (falls back to key/dataIndex). */
  columnKey?: string;
  /** opt into a real `?sort=field:dir` server sort on this header. */
  serverSort?: string;
  /** intends sorting the server does not support → disabled header + tooltip. */
  sortable?: boolean;
  /** telefon kartasidagi slot. Yo'q bo'lsa — kartadan tushib qoladi ('hidden'). */
  mobile?: MobileRole;
  /** 'meta' satri yorlig'i (label: value ko'rinishida). t() kaliti bo'lishi shart. */
  mobileLabel?: string;
  /** 'meta' bloki ichidagi tartib (o'sish bo'yicha; standart — ustun tartibi). */
  mobileOrder?: number;
};

/** Telefon kartasining to'liq modeli — `mobileCard` shuni qaytaradi (§2.2.2). */
export interface MobileCardModel {
  title: ReactNode;
  subtitle?: ReactNode;
  /** yagona o'ngga tekislangan asosiy figura (pul) */
  value?: ReactNode;
  /** chiplar / sanalar / ikkilamchi identifikatsiya — o'raladigan qator */
  meta?: ReactNode;
  /** meta qatoridan keyingi label/value satrlari */
  lines?: { label: string; value: ReactNode }[];
  /** karta ichidagi to'liq kenglikdagi futer amali(lari) */
  actions?: ReactNode;
  /** bekor qilingan / storno qator uslubi */
  ghost?: boolean;
}

/** minimal react-query-result shape the table consumes. */
export interface QueryLike<T> {
  data?: { items: T[]; total: number; page: number; pageSize: number } | T[] | undefined;
  isLoading?: boolean;
  isFetching?: boolean;
  isError?: boolean;
  error?: unknown;
  refetch?: () => unknown;
}

export interface ColumnPreset {
  key: string;
  label: string;
  /** the columnKey values visible in this preset. */
  columns: string[];
}

export interface DataTableProps<T> {
  columns: SbColumn<T>[];
  query: QueryLike<T>;
  rowKey: string | ((row: T) => Key);
  /** Enter / row-click opens the full record. */
  onRowOpen?: (row: T) => void;
  /** Space toggles a peek on the cursor row. */
  peekable?: boolean;
  onPeek?: (row: T) => void;
  /** X starts selection; state bubbles up for a later BulkBar. */
  selectable?: boolean;
  selectedRowKeys?: Key[];
  onSelectionChange?: (keys: Key[], rows: T[]) => void;
  /** native AntD summary (pinned totals row). */
  summary?: TableProps<T>['summary'];
  /** ghost styling (voided/cancelled/reversed rows). */
  ghostWhen?: (row: T) => boolean;
  columnPresets?: { presets: ColumnPreset[]; storageKey?: string; defaultKey?: string };
  /** @deprecated density toggle removed — accepted for back-compat, ignored. */
  densityKey?: string;
  defaultPageSize?: number;
  /** primary-action empty state (no filters active). */
  emptyText?: string;
  emptyAction?: ReactNode;
  /** which URL params count as an active filter (defaults to all non-chrome params). */
  filterKeys?: string[];
  onClearFilters?: () => void;
  scroll?: TableProps<T>['scroll'];
  toolbarExtra?: ReactNode;
  rowClassName?: (row: T, index: number) => string;
  size?: Size;
  sticky?: boolean;
  /** 'auto' (standart): `mobileCard` yoki biror ustunda `mobile` bo'lsa — kartalar,
   *  aks holda skroll qiluvchi jadval. 'cards' / 'table' tanlovni majburlaydi. */
  mobileMode?: 'auto' | 'cards' | 'table';
  /** To'liq qo'lda karta renderi. Ikkalasi bo'lsa ustun metama'lumotidan ustun. */
  mobileCard?: (row: T) => MobileCardModel;
  /** Faqat jadval yo'li: telefonda birinchi ko'rinadigan ustunga `fixed:'left'`
   *  qo'yiladi. Standart — true. */
  pinFirstColumn?: boolean;
}

/** params that are chrome, not filters — their presence never means "filtered". */
const NON_FILTER = new Set(['page', 'pageSize', 'peek', 'view', 'sort', 'tab', 'density']);

function isEditableTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

function colKeyOf<T>(c: SbColumn<T>): string {
  return String(c.columnKey ?? c.key ?? (c as { dataIndex?: unknown }).dataIndex ?? '');
}

/** Ustun katagining qiymatini karta uchun render qiladi (AntD `render` bilan bir xil). */
function cellNode<T>(col: SbColumn<T>, row: T, index: number): ReactNode {
  const di = (col as { dataIndex?: unknown }).dataIndex;
  let raw: unknown;
  if (Array.isArray(di)) {
    raw = di.reduce<unknown>(
      (acc, k) => (acc == null ? acc : (acc as Record<string, unknown>)[String(k)]),
      row as unknown,
    );
  } else if (di != null) {
    raw = (row as Record<string, unknown>)[String(di)];
  }
  if (typeof col.render === 'function') {
    const out = col.render(raw as never, row, index);
    // AntD render `{ children, props }` ham qaytarishi mumkin (colSpan uchun)
    if (out != null && typeof out === 'object' && !isValidElement(out) && 'children' in out) {
      return (out as { children?: ReactNode }).children ?? null;
    }
    return out as ReactNode;
  }
  if (raw == null) return null;
  if (isValidElement(raw)) return raw;
  if (typeof raw === 'string' || typeof raw === 'number') return raw;
  if (typeof raw === 'boolean') return String(raw);
  return null;
}

/** Bo'sh render natijasi (null / '' ) — kartada satr ochib o'tirmaymiz. */
function isBlank(node: ReactNode): boolean {
  return node == null || node === '' || node === false;
}

export function DataTable<T extends object>({
  columns,
  query,
  rowKey,
  onRowOpen,
  peekable,
  onPeek,
  selectable,
  selectedRowKeys,
  onSelectionChange,
  summary,
  ghostWhen,
  columnPresets,
  defaultPageSize = 20,
  emptyText,
  emptyAction,
  filterKeys,
  onClearFilters,
  scroll,
  toolbarExtra,
  rowClassName,
  size = 'small',
  sticky = true,
  mobileMode = 'auto',
  mobileCard,
  pinFirstColumn = true,
}: DataTableProps<T>) {
  const { token } = theme.useToken();
  const t = useT();
  const uf = useUrlFilters();
  const isPhone = useIsPhone();
  const isDesktop = useIsDesktop();

  const items = asItems(query.data as never) as T[];
  const paged = Array.isArray(query.data) || !query.data ? undefined : query.data;
  const total = paged?.total ?? items.length;

  const page = Number(uf.get('page')) || 1;
  const pageSize = Number(uf.get('pageSize')) || defaultPageSize;

  const getRowKey = useCallback(
    (row: T): Key => (typeof rowKey === 'function' ? rowKey(row) : (row as Record<string, Key>)[rowKey]),
    [rowKey],
  );

  // ── cursor row (J/K/arrows) ──────────────────────────────────────────────
  const [cursor, setCursor] = useState(-1);
  useEffect(() => {
    setCursor((c) => (c >= items.length ? items.length - 1 : c));
  }, [items.length]);

  // ── selection (X) ────────────────────────────────────────────────────────
  const controlled = selectedRowKeys !== undefined;
  const [internalSel, setInternalSel] = useState<Key[]>([]);
  const [selectionActive, setSelectionActive] = useState(false);
  const selKeys = controlled ? (selectedRowKeys as Key[]) : internalSel;

  const commitSelection = useCallback(
    (next: Key[]) => {
      if (!controlled) setInternalSel(next);
      const rows = items.filter((r) => next.includes(getRowKey(r)));
      onSelectionChange?.(next, rows);
    },
    [controlled, items, getRowKey, onSelectionChange],
  );

  // stable refs so the single keydown listener never goes stale
  const refs = useRef({ items, cursor, selKeys, peekable, selectable, onRowOpen, onPeek, selectionActive });
  refs.current = { items, cursor, selKeys, peekable, selectable, onRowOpen, onPeek, selectionActive };
  const commitRef = useRef(commitSelection);
  commitRef.current = commitSelection;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      const r = refs.current;
      const n = r.items.length;
      if (!n) return;
      switch (e.key) {
        case 'ArrowDown':
        case 'j':
        case 'J':
          e.preventDefault();
          setCursor((c) => Math.min((c < 0 ? -1 : c) + 1, n - 1));
          break;
        case 'ArrowUp':
        case 'k':
        case 'K':
          e.preventDefault();
          setCursor((c) => Math.max((c < 0 ? 0 : c) - 1, 0));
          break;
        case 'Enter':
          if (r.cursor >= 0 && r.onRowOpen) {
            e.preventDefault();
            r.onRowOpen(r.items[r.cursor]);
          }
          break;
        case ' ':
          if (r.peekable && r.cursor >= 0 && r.onPeek) {
            e.preventDefault();
            r.onPeek(r.items[r.cursor]);
          }
          break;
        case 'x':
        case 'X': {
          if (!r.selectable || r.cursor < 0) return;
          e.preventDefault();
          const key = getRowKey(r.items[r.cursor]);
          const has = r.selKeys.includes(key);
          const next = has ? r.selKeys.filter((k) => k !== key) : [...r.selKeys, key];
          setSelectionActive(true);
          commitRef.current(next);
          break;
        }
        case 'Escape':
          if (refs.current.selectionActive) {
            setSelectionActive(false);
            commitRef.current([]);
          }
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [getRowKey]);

  // ── column presets ───────────────────────────────────────────────────────
  const [presetKey, setPresetKey] = useState<string>(() => {
    if (!columnPresets) return '';
    const saved = columnPresets.storageKey ? localStorage.getItem(columnPresets.storageKey) : null;
    return saved ?? columnPresets.defaultKey ?? columnPresets.presets[0]?.key ?? '';
  });
  const activePreset = columnPresets?.presets.find((p) => p.key === presetKey);

  // ── sort (server, opt-in) ────────────────────────────────────────────────
  const sortParam = uf.get('sort');
  const [sortField, sortDir] = sortParam ? sortParam.split(':') : [undefined, undefined];

  /** preset filtridan o'tgan XOM ustunlar — karta metama'lumoti shulardan o'qiladi */
  const visibleColumns = useMemo<SbColumn<T>[]>(() => {
    if (!activePreset) return columns;
    return columns.filter((c) => {
      const k = colKeyOf(c);
      return !k || activePreset.columns.includes(k);
    });
  }, [columns, activePreset]);

  const displayColumns = useMemo<ColumnType<T>[]>(() => {
    const cols = visibleColumns.map((c) => {
      const {
        columnKey: _ck,
        serverSort,
        sortable,
        mobile: _m,
        mobileLabel: _ml,
        mobileOrder: _mo,
        ...rest
      } = c;
      const title = typeof rest.title === 'string' ? t(rest.title) : rest.title;
      if (serverSort) {
        const order = sortField === serverSort ? (sortDir === 'asc' ? 'ascend' : 'descend') : null;
        return { ...rest, title, sorter: true, sortOrder: order as never, showSorterTooltip: false, serverSort } as ColumnType<T>;
      }
      if (sortable) {
        return {
          ...rest,
          title: (
            <Tooltip title={t("server tartiblashni qo'llab-quvvatlamaydi")}>
              <span style={{ borderBottom: `1px dashed ${token.colorBorder}`, cursor: 'help' }}>
                {title as ReactNode}
              </span>
            </Tooltip>
          ),
        } as ColumnType<T>;
      }
      return { ...rest, title } as ColumnType<T>;
    });
    // telefonda birinchi ustun muzlatiladi — gorizontal skrollda identifikatsiya
    // (ism / raqam) doim ko'rinib turadi
    if (isPhone && pinFirstColumn && cols.length > 1) {
      cols[0] = { ...cols[0], fixed: 'left' };
    }
    return cols;
  }, [visibleColumns, sortField, sortDir, token.colorBorder, t, isPhone, pinFirstColumn]);

  // ── telefon karta modeli ─────────────────────────────────────────────────
  const cardSlots = useMemo(() => {
    let title: SbColumn<T> | undefined;
    let value: SbColumn<T> | undefined;
    const subtitles: SbColumn<T>[] = [];
    const metas: { col: SbColumn<T>; order: number }[] = [];
    visibleColumns.forEach((c, i) => {
      switch (c.mobile) {
        case 'title':
          if (!title) title = c;
          break;
        case 'value':
          if (!value) value = c;
          break;
        case 'subtitle':
          subtitles.push(c);
          break;
        case 'meta':
          metas.push({ col: c, order: c.mobileOrder ?? i });
          break;
        default:
          break;
      }
    });
    metas.sort((a, b) => a.order - b.order);
    const annotated = visibleColumns.some((c) => c.mobile != null && c.mobile !== 'hidden');
    return { title, value, subtitles, metas: metas.map((m) => m.col), annotated };
  }, [visibleColumns]);

  // Yechim tartibi (normativ): mobileCard → ustun metama'lumoti → jadval.
  const cardPath =
    isPhone &&
    mobileMode !== 'table' &&
    (mobileMode === 'cards' || !!mobileCard || cardSlots.annotated);

  const buildCard = useCallback(
    (row: T, index: number): MobileCardModel => {
      if (mobileCard) return mobileCard(row);
      const titleCol = cardSlots.title ?? visibleColumns[0];
      const subs = cardSlots.subtitles
        .map((c) => cellNode(c, row, index))
        .filter((n) => !isBlank(n));
      const chips = cardSlots.metas
        .map((c) => ({ col: c, node: cellNode(c, row, index) }))
        .filter((m) => !isBlank(m.node));
      return {
        title: titleCol ? cellNode(titleCol, row, index) : null,
        value: cardSlots.value ? cellNode(cardSlots.value, row, index) : undefined,
        subtitle: subs.length ? (
          <>
            {subs.map((n, i) => (
              <span key={i}>{n}</span>
            ))}
          </>
        ) : undefined,
        meta: chips.length ? (
          <>
            {chips.map(({ col, node }, i) => (
              <span key={colKeyOf(col) || i} className="sb-mcard__chip">
                {col.mobileLabel ? (
                  <em className="sb-mcard__chip-label">{t(col.mobileLabel)}</em>
                ) : null}
                {node}
              </span>
            ))}
          </>
        ) : undefined,
      };
    },
    [mobileCard, cardSlots, visibleColumns, t],
  );

  const handleChange: TableProps<T>['onChange'] = (pag, _filters, sorter, extra) => {
    if (extra.action === 'sort') {
      const s = Array.isArray(sorter) ? sorter[0] : sorter;
      const field = (s?.column as SbColumn<T> | undefined)?.serverSort;
      const order = s?.order;
      uf.set({ sort: order && field ? `${field}:${order === 'ascend' ? 'asc' : 'desc'}` : null });
      return;
    }
    const nextPage = pag.current ?? 1;
    const nextSize = pag.pageSize ?? pageSize;
    if (nextSize !== pageSize) uf.set({ page: '1', pageSize: String(nextSize) });
    else uf.set({ page: String(nextPage), pageSize: String(nextSize) });
  };

  const goToPage = useCallback(
    (nextPage: number, nextSize: number) => {
      if (nextSize !== pageSize) uf.set({ page: '1', pageSize: String(nextSize) });
      else uf.set({ page: String(nextPage), pageSize: String(nextSize) });
    },
    [pageSize, uf],
  );

  // ── filtered-empty detection ─────────────────────────────────────────────
  const resolvedFilterKeys = useMemo(
    () => filterKeys ?? Object.keys(uf.params).filter((k) => !NON_FILTER.has(k)),
    [filterKeys, uf.params],
  );
  const hasActiveFilter = resolvedFilterKeys.some((k) => (uf.get(k) ?? '') !== '');
  const clearFilters = onClearFilters ?? (() => uf.clear(resolvedFilterKeys));

  const rowSelection =
    selectable && (selectionActive || selKeys.length > 0)
      ? {
          selectedRowKeys: selKeys,
          onChange: (keys: Key[], rows: T[]) => {
            setSelectionActive(true);
            if (!controlled) setInternalSel(keys);
            onSelectionChange?.(keys, rows);
          },
        }
      : undefined;

  const combinedRowClassName = (row: T, index: number) => {
    const cls: string[] = [];
    if (index === cursor) cls.push('row-cursor');
    if (ghostWhen?.(row)) cls.push('ghost-row');
    const extra = rowClassName?.(row, index);
    if (extra) cls.push(extra);
    return cls.join(' ');
  };

  const onRow = (row: T, index?: number) => ({
    onClick: (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest('a,button,input,.ant-checkbox-wrapper,.ant-dropdown-trigger,.ant-select')) {
        return;
      }
      if (index != null) setCursor(index);
      onRowOpen?.(row);
    },
    style: onRowOpen ? { cursor: 'pointer' as const } : undefined,
  });

  // Telefonda «Tanlash» tugmasi — bugungi o'lik halqani uzadi: tanlash faqat
  // `X` klavishi bilan boshlanardi, telefonda esa bunday klavish yo'q (§2.2.4).
  const selectToggle =
    isPhone && selectable ? (
      <Button
        size="small"
        type={selectionActive ? 'primary' : 'default'}
        onClick={() => {
          if (selectionActive) {
            setSelectionActive(false);
            commitSelection([]);
          } else {
            setSelectionActive(true);
          }
        }}
      >
        {t('Tanlash')}
      </Button>
    ) : null;

  // ustun presetlari + zichlik telefonda ko'rsatilmaydi (joy yo'q, foydasi kam)
  const showPresets = !!columnPresets && !isPhone;
  const hasToolbar = showPresets || !!toolbarExtra || !!selectToggle;
  const toolbar = hasToolbar ? (
    <Flex justify="space-between" align="center" gap={12} wrap style={{ marginBottom: 8 }}>
      <div>
        {showPresets && columnPresets ? (
          <Segmented
            size="small"
            value={presetKey}
            onChange={(v) => {
              const k = String(v);
              setPresetKey(k);
              if (columnPresets.storageKey) localStorage.setItem(columnPresets.storageKey, k);
            }}
            options={columnPresets.presets.map((p) => ({ label: p.label, value: p.key }))}
          />
        ) : null}
      </div>
      <Flex align="center" gap={8}>
        {selectToggle}
        {toolbarExtra}
      </Flex>
    </Flex>
  ) : null;

  // jadval yo'li: telefon/planshetda `max-content` — desktopda (>= 992px) hech
  // narsa o'zgarmaydi (Qonun 1), chaqiruvchining aniq qiymati doim ustun turadi.
  const resolvedScroll: TableProps<T>['scroll'] =
    scroll ?? (isDesktop ? undefined : { x: 'max-content' });
  // sticky sarlavha TopBar ORTIDA emas, uning OSTIDA to'xtasin — faqat telefon/planshet
  const resolvedSticky: TableProps<T>['sticky'] = sticky
    ? isDesktop
      ? true
      : { offsetHeader: TOPBAR_H }
    : false;

  // ── loading: honest skeleton rows, header intact ──────────────────────────
  if (query.isLoading) {
    // karta yo'lida keng jadval → tor karta "sakrashi" nuqson bo'lardi: skelet
    // ham karta shaklida chiqadi (§2.2.3)
    if (cardPath) {
      return (
        <div>
          {toolbar}
          <ul className="sb-mcards">
            {Array.from({ length: 8 }, (_, i) => (
              <li key={i} className="sb-mcard sb-mcard--skeleton">
                <div className="sb-mcard__body">
                  <div className="sb-mcard__row">
                    <div className="sb-mcard__head">
                      <Skeleton.Button active size="small" block style={{ height: 14 }} />
                    </div>
                    <Skeleton.Button active size="small" style={{ height: 14, width: 84 }} />
                  </div>
                  <Skeleton.Button active size="small" block style={{ height: 10 }} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      );
    }
    const skRows = Array.from({ length: 8 }, (_, i) => ({ __k: i }));
    const skCols = displayColumns.map((c, idx) => ({
      title: c.title,
      key: c.key ?? idx,
      align: c.align,
      width: c.width,
      fixed: c.fixed,
      render: () => <Skeleton.Button active size="small" block style={{ height: 12, minWidth: 40 }} />,
    }));
    return (
      <div>
        {toolbar}
        <Table
          rowKey="__k"
          columns={skCols as never}
          dataSource={skRows}
          pagination={false}
          size={size}
          sticky={resolvedSticky}
          scroll={resolvedScroll}
        />
      </div>
    );
  }

  if (query.isError) {
    return (
      <div>
        {toolbar}
        <ErrorState error={query.error} onRetry={query.refetch ? () => query.refetch?.() : undefined} />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div>
        {toolbar}
        <EmptyState
          message={hasActiveFilter ? 'Filtrga mos yozuv topilmadi' : emptyText ?? "Hozircha yozuv yo'q"}
          action={hasActiveFilter ? undefined : emptyAction}
          onClearFilters={hasActiveFilter ? clearFilters : undefined}
        />
      </div>
    );
  }

  // ── KARTA YO'LI (telefon) ────────────────────────────────────────────────
  if (cardPath) {
    const peekOnly = !!peekable && !!onPeek && !onRowOpen;
    const openRow = onRowOpen ?? (peekOnly ? onPeek : undefined);

    // SAHIFALASH — jadval yo'lidagi bilan aynan bir xil semantika. AntD Table
    // `dataSource` ni O'ZI kesadi (faqat oddiy massivda; server sahifalangan
    // konvertda `length < total` bo'lgani uchun kesmaydi). Karta yo'li shu
    // ishni qo'lda takrorlaydi: `paged` bor bo'lsa — server allaqachon kesgan,
    // yo'q bo'lsa — bu yerda kesamiz. Busiz oddiy massiv bergan har bir
    // chaqiruv telefonda BUTUN ro'yxatni karta qilib chizardi va pastdagi
    // pager faqat `?page=` ni yozib, ayni ro'yxatni qayta ko'rsatardi.
    const cardItems = paged ? items : items.slice((page - 1) * pageSize, page * pageSize);

    return (
      <div>
        {toolbar}
        <div className="sb-datatable-body" style={{ position: 'relative' }}>
          {query.isFetching ? <div className="refetch-hairline" /> : null}
          <ul className="sb-mcards">
            {cardItems.map((row, index) => {
              const key = getRowKey(row);
              const card = buildCard(row, index);
              const ghost = card.ghost ?? ghostWhen?.(row) ?? false;
              const tappable = !!openRow;

              // Kebab = klaviatura `Space` (peek) ning teginish egizagi. «Ochish»
              // unga faqat peek ham mavjud bo'lganda qo'shiladi — aks holda u
              // kartaga tegishni takrorlab, 320px da 44px joyni behuda yeydi.
              const menuItems: MenuProps['items'] = [];
              if (peekable && onPeek && !peekOnly) {
                if (onRowOpen) menuItems.push({ key: 'open', label: t('Ochish') });
                menuItems.push({ key: 'peek', label: t("Ko'rish") });
              }

              return (
                <li
                  key={key}
                  className={[
                    'sb-mcard',
                    tappable ? 'sb-mcard--tappable' : '',
                    ghost ? 'sb-mcard--ghost' : '',
                    rowClassName?.(row, index) ?? '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={
                    tappable
                      ? (e) => {
                          if ((e.target as HTMLElement).closest('a,button,input,.ant-checkbox-wrapper,.ant-dropdown-trigger')) {
                            return;
                          }
                          setCursor(index);
                          openRow?.(row);
                        }
                      : undefined
                  }
                >
                  {selectable && selectionActive ? (
                    // Teginish egizagi to'liq bo'lishi uchun katakcha 44×44:
                    // xom AntD Checkbox 18×26 nishon berardi va kartaning o'z
                    // tegish maydonidan bir necha piksel narida turgani uchun
                    // xato tegish yozuvni ochib, boshlangan tanlovni yo'qotardi.
                    // Uslub `.ant-checkbox-wrapper` (label) ga tushadi — ya'ni
                    // butun 44px maydon haqiqatan bosiladi (§2.2.4, §4).
                    <Checkbox
                      checked={selKeys.includes(key)}
                      aria-label={t('Tanlash')}
                      style={{
                        flex: '0 0 auto',
                        minWidth: TOUCH_MIN,
                        minHeight: TOUCH_MIN,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginInlineEnd: 4,
                      }}
                      onChange={(e) => {
                        const next = e.target.checked
                          ? [...selKeys, key]
                          : selKeys.filter((k) => k !== key);
                        commitSelection(next);
                      }}
                    />
                  ) : null}

                  {/* Tugma roli KARTA MATNIDA, `<li>` da emas. `<li role="button">`
                      ikki narsani buzardi: (1) `<ul>` o'z `listitem` bolalarini
                      yo'qotib, VoiceOver / TalkBack «ro'yxat, N ta» va qator
                      o'rnini e'lon qilmay qo'yardi; (2) kebab, `tel:` havolalari
                      va to'liq kenglikdagi futer tugmalari tugma ICHIDA qolardi —
                      ichma-ich interaktiv element (ARIA da `button` bolalari
                      prezentatsion, ya'ni ular umuman e'lon qilinmay qolardi).
                      Endi kebab/chevron `<li>` ning, futer amallari esa tugmaning
                      qo'shnisi. Kartaning bo'sh joyiga tegish `<li>` dagi onClick
                      orqali ishlayveradi (sichqoncha/barmoq yo'li o'zgarmadi). */}
                  <div className="sb-mcard__body">
                    <div
                      role={tappable ? 'button' : undefined}
                      tabIndex={tappable ? 0 : undefined}
                      style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}
                      onKeyDown={
                        tappable
                          ? (e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                openRow?.(row);
                              }
                            }
                          : undefined
                      }
                    >
                      <div className="sb-mcard__row">
                        <div className="sb-mcard__head">
                          <div className="sb-mcard__title">{card.title}</div>
                          {card.subtitle ? <div className="sb-mcard__subtitle">{card.subtitle}</div> : null}
                        </div>
                        {!isBlank(card.value) ? <div className="sb-mcard__value">{card.value}</div> : null}
                      </div>
                      {card.meta ? <div className="sb-mcard__meta">{card.meta}</div> : null}
                      {card.lines && card.lines.length > 0 ? (
                        <dl className="sb-mcard__lines">
                          {card.lines.map((l, i) => (
                            <div key={i} style={{ display: 'contents' }}>
                              <dt>{t(l.label)}</dt>
                              <dd>{l.value}</dd>
                            </div>
                          ))}
                        </dl>
                      ) : null}
                    </div>
                    {card.actions ? <div className="sb-mcard__actions">{card.actions}</div> : null}
                  </div>

                  <div className="sb-mcard__tail">
                    {menuItems.length > 0 ? (
                      <Dropdown
                        trigger={['click']}
                        menu={{
                          items: menuItems,
                          onClick: ({ key: k, domEvent }) => {
                            domEvent.stopPropagation();
                            if (k === 'open') onRowOpen?.(row);
                            else if (k === 'peek') onPeek?.(row);
                          },
                        }}
                      >
                        <Button
                          type="text"
                          icon={<MoreOutlined />}
                          aria-label={t('Amallar')}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </Dropdown>
                    ) : null}
                    {tappable ? <RightOutlined className="sb-mcard__chevron" aria-hidden /> : null}
                  </div>
                </li>
              );
            })}
          </ul>

          {/* «Jami» karta yo'lida jadval summary qatori emas — TableCard ichidagi
              yagona pastki tasma. Ustun SONI saqlanadi (totalsRow katakchalari
              indeks bo'yicha tekislanadi), lekin sarlavha / muzlatilgan ustun /
              tartiblash olib tashlanadi: bu yerda ular ma'nosiz. */}
          {summary ? (
            <div className="sb-mcards__totals">
              <Table<T>
                rowKey={rowKey as never}
                columns={displayColumns.map((c, i) => ({
                  key: c.key ?? i,
                  align: c.align,
                  className: c.className,
                }))}
                dataSource={[]}
                showHeader={false}
                pagination={false}
                size="small"
                summary={summary}
                scroll={{ x: 'max-content' }}
              />
            </div>
          ) : null}

          {total > pageSize ? (
            <div className="sb-mcards__pager">
              <Pagination
                simple
                size="small"
                current={page}
                pageSize={pageSize}
                total={total}
                showSizeChanger={false}
                onChange={(p, ps) => goToPage(p, ps)}
              />
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  // ── JADVAL YO'LI (desktop, defterlar, belgilanmagan jadvallar) ───────────
  return (
    <div>
      {toolbar}
      <div
        className={isPhone ? 'sb-datatable-body sb-datatable-body--scroll' : 'sb-datatable-body'}
        style={{ position: 'relative' }}
      >
        {query.isFetching ? <div className="refetch-hairline" /> : null}
        <Table<T>
          rowKey={rowKey as never}
          columns={displayColumns}
          dataSource={items}
          size={size}
          sticky={resolvedSticky}
          scroll={resolvedScroll}
          summary={summary}
          rowSelection={rowSelection}
          rowClassName={combinedRowClassName}
          onRow={onRow}
          onChange={handleChange}
          pagination={
            isPhone
              ? { current: page, pageSize, total, simple: true, size: 'small', showSizeChanger: false }
              : {
                  current: page,
                  pageSize,
                  total,
                  showSizeChanger: true,
                  showTotal: (n) => t('Jami: {n} ta', { n: fmtNum(n) }),
                }
          }
        />
      </div>
    </div>
  );
}
