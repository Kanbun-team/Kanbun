import { Skeleton } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-7 w-40" />
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  );
}
