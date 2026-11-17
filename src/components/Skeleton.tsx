import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-control bg-ink/10",
        className
      )}
    />
  );
}

export function SkeletonRow({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-2", className)}>
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  );
}
