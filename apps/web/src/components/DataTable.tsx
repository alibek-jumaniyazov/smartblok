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
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Key,
  type ReactNode,
} from 'react';
import { Flex, Segmented, Skeleton, Table, Tooltip, theme } from 'antd';
import type { TableProps } from 'antd';
import type { ColumnType } from 'antd/es/table';
import { asItems } from '../lib/api';
import { fmtNum } from '../lib/format';
import { useUrlFilters } from '../lib/useUrlFilters';
import { useAuth } from '../auth/AuthContext';
import { EmptyState, ErrorState } from './EmptyState';
import { DensityToggle } from './DensityToggle';

type Size = 'small' | 'middle' | 'large';

/** AntD column + our opt-ins: stable preset key + real server sort field. */
export type SbColumn<T> = ColumnType<T> & {
  /** stable identity for column presets (falls back to key/dataIndex). */
  columnKey?: string;
  /** opt into a real `?sort=field:dir` server sort on this header. */
  serverSort?: string;
  /** intends sorting the server does not support → disabled header + tooltip. */
  sortable?: boolean;
};

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
  /** route key → density persists under sb_density:<userId>:<densityKey>. */
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
  densityKey,
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
}: DataTableProps<T>) {
  const { token } = theme.useToken();
  const { user } = useAuth();
  const uf = useUrlFilters();

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

  const displayColumns = useMemo<ColumnType<T>[]>(() => {
    let cols = columns;
    if (activePreset) {
      cols = cols.filter((c) => {
        const k = colKeyOf(c);
        return !k || activePreset.columns.includes(k);
      });
    }
    return cols.map((c) => {
      const { columnKey: _ck, serverSort, sortable, ...rest } = c;
      if (serverSort) {
        const order = sortField === serverSort ? (sortDir === 'asc' ? 'ascend' : 'descend') : null;
        return { ...rest, sorter: true, sortOrder: order as never, showSorterTooltip: false, serverSort } as ColumnType<T>;
      }
      if (sortable) {
        return {
          ...rest,
          title: (
            <Tooltip title="server tartiblashni qo'llab-quvvatlamaydi">
              <span style={{ borderBottom: `1px dashed ${token.colorBorder}`, cursor: 'help' }}>
                {rest.title as ReactNode}
              </span>
            </Tooltip>
          ),
        } as ColumnType<T>;
      }
      return rest as ColumnType<T>;
    });
  }, [columns, activePreset, sortField, sortDir, token.colorBorder]);

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

  const toolbar =
    columnPresets || densityKey || toolbarExtra ? (
      <Flex justify="space-between" align="center" gap={12} wrap style={{ marginBottom: 8 }}>
        <div>
          {columnPresets ? (
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
          {toolbarExtra}
          {densityKey ? <DensityToggle storageKey={`sb_density:${user?.id ?? 'anon'}:${densityKey}`} /> : null}
        </Flex>
      </Flex>
    ) : null;

  // ── loading: honest skeleton rows, header intact ──────────────────────────
  if (query.isLoading) {
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
          sticky={sticky}
          scroll={scroll}
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

  return (
    <div>
      {toolbar}
      <div className="sb-datatable-body" style={{ position: 'relative' }}>
        {query.isFetching ? <div className="refetch-hairline" /> : null}
        <Table<T>
          rowKey={rowKey as never}
          columns={displayColumns}
          dataSource={items}
          size={size}
          sticky={sticky}
          scroll={scroll}
          summary={summary}
          rowSelection={rowSelection}
          rowClassName={combinedRowClassName}
          onRow={onRow}
          onChange={handleChange}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            showTotal: (t) => `Jami: ${fmtNum(t)} ta`,
          }}
        />
      </div>
    </div>
  );
}
