import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Search, Download, Rows3, Rows4, Inbox, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';
import { TableSkeleton } from './Skeleton';

export interface Column<T> {
  key: string;
  header: string;
  align?: 'right' | 'center';
  render?: (row: T) => React.ReactNode;
  value?: (row: T) => string | number;
  className?: string;
}

interface Props<T> {
  columns: Column<T>[];
  data: T[] | undefined;
  rowKey: (row: T) => string | number;
  searchKeys?: (keyof T | ((row: T) => string))[];
  searchPlaceholder?: string;
  toolbar?: React.ReactNode;
  actions?: (row: T) => React.ReactNode;
  onRowClick?: (row: T) => void;
  emptyLabel?: string;
  pageSize?: number;
  exportName?: string;
}

export function EntityTable<T>({
  columns, data, rowKey, searchKeys, searchPlaceholder = 'Qidirish...',
  toolbar, actions, onRowClick, emptyLabel = "Ma'lumot yo'q", pageSize = 12, exportName,
}: Props<T>) {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [compact, setCompact] = useState(false);

  const filtered = useMemo(() => {
    const rows = data ?? [];
    if (!q || !searchKeys) return rows;
    const needle = q.toLowerCase();
    return rows.filter((r) =>
      searchKeys.some((k) => {
        const val = typeof k === 'function' ? k(r) : (r as any)[k];
        return String(val ?? '').toLowerCase().includes(needle);
      }),
    );
  }, [data, q, searchKeys]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pages - 1);
  const view = filtered.slice(safePage * pageSize, safePage * pageSize + pageSize);

  function exportCsv() {
    const header = columns.map((c) => c.header).join(';');
    const lines = filtered.map((r) =>
      columns.map((c) => {
        const v = c.value ? c.value(r) : (r as any)[c.key];
        return '"' + String(v ?? '').replace(/"/g, '""') + '"';
      }).join(';'),
    );
    const csv = '﻿' + [header, ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (exportName ?? 'export') + '.csv';
    a.click();
  }

  if (!data) return <TableSkeleton />;

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-e1">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
        {searchKeys && (
          <div className="relative min-w-[200px] flex-1">
            <Search size={15} className="pointer-events-none absolute left-3 top-2.5 text-faint" />
            <input
              value={q}
              onChange={(e) => { setQ(e.target.value); setPage(0); }}
              placeholder={searchPlaceholder}
              className="h-9 w-full rounded-md border border-line bg-surface pl-9 pr-3 text-sm text-content outline-none placeholder:text-faint focus:border-primary focus:ring-2 focus:ring-ring/40"
            />
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          {toolbar}
          <button onClick={() => setCompact((c) => !c)} title="Zichlik" className="rounded-md border border-line p-2 text-muted hover:bg-hover">
            {compact ? <Rows3 size={15} /> : <Rows4 size={15} />}
          </button>
          <button onClick={exportCsv} title="Excel/CSV eksport" className="rounded-md border border-line p-2 text-muted hover:bg-hover">
            <Download size={15} />
          </button>
        </div>
      </div>

      {/* table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 border-b border-line bg-subtle text-left text-[11px] uppercase tracking-wide text-muted">
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={cn('px-4 py-2.5 font-semibold', c.align === 'right' && 'text-right', c.align === 'center' && 'text-center')}>
                  {c.header}
                </th>
              ))}
              {actions && <th className="px-4 py-2.5" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft">
            {view.map((row, i) => (
              <motion.tr
                key={rowKey(row)}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, delay: Math.min(i * 0.02, 0.2) }}
                onClick={() => onRowClick?.(row)}
                className={cn('group transition-colors hover:bg-hover', onRowClick && 'cursor-pointer')}
              >
                {columns.map((c) => (
                  <td key={c.key} className={cn(compact ? 'px-4 py-2' : 'px-4 py-3', c.align === 'right' && 'text-right tabular-nums', c.align === 'center' && 'text-center', c.className)}>
                    {c.render ? c.render(row) : String((row as any)[c.key] ?? '—')}
                  </td>
                ))}
                {actions && (
                  <td className={cn('px-4 text-right', compact ? 'py-2' : 'py-3')} onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-1 opacity-60 transition-opacity group-hover:opacity-100">{actions(row)}</div>
                  </td>
                )}
              </motion.tr>
            ))}
            {view.length === 0 && (
              <tr>
                <td colSpan={columns.length + (actions ? 1 : 0)} className="py-14">
                  <div className="flex flex-col items-center gap-2 text-faint">
                    <Inbox size={30} strokeWidth={1.5} />
                    <span className="text-sm">{emptyLabel}</span>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* footer / pagination */}
      <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-xs text-muted">
        <span>Jami: <b className="text-content">{filtered.length}</b></span>
        {pages > 1 && (
          <div className="flex items-center gap-1">
            <button disabled={safePage === 0} onClick={() => setPage((p) => p - 1)} className="rounded-md p-1.5 hover:bg-hover disabled:opacity-40">
              <ChevronLeft size={15} />
            </button>
            <span>{safePage + 1} / {pages}</span>
            <button disabled={safePage >= pages - 1} onClick={() => setPage((p) => p + 1)} className="rounded-md p-1.5 hover:bg-hover disabled:opacity-40">
              <ChevronRight size={15} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
