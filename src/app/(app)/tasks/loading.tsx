import { Skeleton } from "@/components/Skeleton";

// Mirrors the boards home: header with actions, then sections of board tiles.
export default function Loading() {
  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Skeleton className="h-7 w-28" />
        <div className="flex gap-2">
          <Skeleton className="h-8 w-36" />
          <Skeleton className="h-8 w-28" />
        </div>
      </div>
      {[3, 2].map((count, s) => (
        <div key={s} className="space-y-3">
          <Skeleton className="h-6 w-32" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: count }).map((_, i) => (
              <Skeleton key={i} className="h-36 w-full rounded-panel" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
