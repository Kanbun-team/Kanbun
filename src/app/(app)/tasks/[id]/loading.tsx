import { Skeleton } from "@/components/Skeleton";

export default function Loading() {
  return (
    // data-wide like the board page, so the layout does not change width
    // when the board replaces this skeleton.
    <div className="space-y-4" data-wide>
      <Skeleton className="h-7 w-48" />
      <div className="flex gap-4 overflow-hidden">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="w-80 shrink-0 bg-surface border border-line rounded-panel p-3 space-y-2">
            <Skeleton className="h-5 w-1/2" />
            {Array.from({ length: 4 }).map((__, j) => (
              <Skeleton key={j} className="h-16 w-full" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
