// Loading placeholders shaped like the content they stand in for, so the page does not
// jump when data arrives (and there is no spinner). Announced once to screen readers.
export function Skeleton({ className = '' }) {
  return <div className={`skeleton ${className}`} aria-hidden />;
}

export function ListSkeleton({ rows = 3 }) {
  return (
    <div role="status" aria-label="Loading" className="space-y-2">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center justify-between gap-4 rounded-lg border border-line px-4 py-3">
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-3/5" />
          </div>
          <Skeleton className="h-8 w-24" />
        </div>
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export function PageSkeleton({ rows = 3 }) {
  return (
    <div role="status" aria-label="Loading" className="space-y-5">
      <div className="space-y-2">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-3.5 w-80 max-w-full" />
      </div>
      <div className="card p-5">
        <Skeleton className="mb-4 h-4 w-32" />
        <ListSkeleton rows={rows} />
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
