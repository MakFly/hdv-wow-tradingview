/** Loading placeholders shown while the SSE stream is (re)connecting — e.g. on a
 *  page refresh, before the first `snapshot` event lands. One composition per
 *  dashboard panel, so each card keeps its own shape while booting. */
import { Skeleton } from "@/components/ui/skeleton";

/** Watchlist / Top Movers — a vertical list of name + two numeric cells. */
export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="grid grid-cols-[1fr_auto_auto] items-center gap-2">
          <Skeleton className="h-3 w-full max-w-[140px]" />
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-3 w-8" />
        </div>
      ))}
    </div>
  );
}

/** Auction-house table — wider rows with an item column and price cells. */
export function TableSkeleton({ rows = 10 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3">
          <Skeleton className="h-3.5 w-full max-w-[240px]" />
          <Skeleton className="h-3.5 w-16" />
          <Skeleton className="h-3.5 w-16" />
          <Skeleton className="h-3.5 w-10" />
        </div>
      ))}
    </div>
  );
}

/** Price / Token chart — a legend strip over a large plot area. */
export function ChartSkeleton() {
  return (
    <div className="flex h-full w-full flex-col gap-2 p-3">
      <div className="flex gap-2">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-16" />
      </div>
      <Skeleton className="min-h-0 w-full flex-1" />
    </div>
  );
}

/** Market stats — a small grid of label + value pairs. */
export function StatsSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 p-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="space-y-1.5">
          <Skeleton className="h-2.5 w-14" />
          <Skeleton className="h-3.5 w-20" />
        </div>
      ))}
    </div>
  );
}
