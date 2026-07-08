import type { ReactNode } from 'react';

export function Table({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-ink-200/70 bg-white shadow-sm dark:border-ink-800 dark:bg-ink-900">
      <table className="w-full text-sm">
        <thead className="border-b border-ink-200 bg-ink-50/60 text-left text-xs uppercase tracking-wide text-ink-500 dark:border-ink-800 dark:bg-ink-950/40 dark:text-ink-400">
          {head}
        </thead>
        <tbody className="divide-y divide-ink-100 dark:divide-ink-800">{children}</tbody>
      </table>
    </div>
  );
}

export function Th({ children, right }: { children: ReactNode; right?: boolean }) {
  return <th className={`px-4 py-3 font-semibold ${right ? 'text-right' : ''}`}>{children}</th>;
}

export function Td({ children, right, className = '' }: { children: ReactNode; right?: boolean; className?: string }) {
  return <td className={`px-4 py-3 ${right ? 'text-right tabular-nums' : ''} ${className}`}>{children}</td>;
}
