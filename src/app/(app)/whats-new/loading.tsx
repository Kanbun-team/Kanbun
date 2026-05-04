import { Skeleton } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div className="space-y-4 max-w-3xl">
      <Skeleton className="h-7 w-40" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
