import { Skeleton } from "@/components/Skeleton";

// Mirrors the My work layout: a title, then sections of card tiles.
export default function Loading() {
  return (
    <div className="space-y-8">
      <Skeleton className="h-7 w-32" />
      {[2, 3].map((count, s) => (
        <div key={s} className="space-y-3">
          <Skeleton className="h-6 w-28" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: count }).map((_, i) => (
              <Skeleton key={i} className="h-32 w-full rounded-card" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
