export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton rounded-md ${className}`} />;
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface">
      <div className="border-b border-line bg-subtle p-3"><Skeleton className="h-4 w-40" /></div>
      <div className="space-y-3 p-4">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    </div>
  );
}

export function CardSkeleton({ className = 'h-28' }: { className?: string }) {
  return <div className={`skeleton rounded-lg ${className}`} />;
}
