import { Skeleton, SkeletonRow } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-7 w-2/3" />
      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <Skeleton className="h-24 w-full" />
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </div>
        <aside className="space-y-4">
          <Skeleton className="h-10 w-32" />
          <Skeleton className="h-10 w-40" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </aside>
      </div>
    </div>
  );
}
