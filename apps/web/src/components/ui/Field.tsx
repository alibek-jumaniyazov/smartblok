import type { ReactNode, SelectHTMLAttributes, InputHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export function Field({
  label, children, required, hint, error,
}: { label: string; children: ReactNode; required?: boolean; hint?: string; error?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted">
        {label}
        {required && <span className="text-red-500">*</span>}
      </span>
      {children}
      {error ? (
        <span className="mt-1 block text-xs text-red-500">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-faint">{hint}</span>
      ) : null}
    </label>
  );
}

const base =
  'w-full rounded-lg border border-line bg-surface px-3.5 text-sm text-content outline-none transition ' +
  'placeholder:text-faint focus:border-primary focus:ring-4 focus:ring-primary/15 disabled:opacity-60';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(base, 'h-11', className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(base, 'min-h-[92px] py-2.5', className)} {...props} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <select className={cn(base, 'h-11 cursor-pointer appearance-none bg-no-repeat pr-9', className)}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2394A3B8' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")",
        backgroundPosition: 'right 0.7rem center',
        backgroundSize: '1rem',
      }}
      {...props}>
      {children}
    </select>
  );
}
