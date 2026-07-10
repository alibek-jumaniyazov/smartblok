import { cn } from '../../lib/utils';

// Money input with thousand-separator formatting and optional currency addon.
export function MoneyInput({
  value, onChange, currency = "so'm", className, placeholder,
}: {
  value: number | string;
  onChange: (v: number) => void;
  currency?: string;
  className?: string;
  placeholder?: string;
}) {
  const display = value === '' || value == null ? '' : new Intl.NumberFormat('ru-RU').format(Number(value) || 0);
  return (
    <div className={cn('flex items-stretch overflow-hidden rounded-lg border border-line bg-surface transition focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/15', className)}>
      <input
        inputMode="numeric"
        className="h-11 w-full bg-transparent px-3.5 text-sm font-medium text-content outline-none placeholder:text-faint tabular-nums"
        value={display}
        placeholder={placeholder ?? '0'}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^\d]/g, '');
          onChange(raw ? Number(raw) : 0);
        }}
      />
      <span className="flex items-center border-l border-line bg-subtle px-3 text-xs font-semibold text-muted">{currency}</span>
    </div>
  );
}
