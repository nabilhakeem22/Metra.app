import { Skeleton } from '@/components/ui/skeleton';
import { HeaderSkeleton } from './page-skeletons';
import { SkeletonRoot } from './skeleton-root';

/** The dashboard: header, the stat-card row, then the two panels. */
export function DashboardSkeleton() {
  return (
    <SkeletonRoot>
      <HeaderSkeleton />
      <div className="grid grid-cols-2 gap-[14px] lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="glass space-y-3 p-5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-7 w-28" />
          </div>
        ))}
      </div>
      <div className="grid gap-[14px] lg:grid-cols-[2fr_1fr]">
        <div className="glass space-y-4 p-5">
          <Skeleton className="h-5 w-40" />
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
        <div className="glass space-y-4 p-5">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="mx-auto size-40 rounded-full" />
        </div>
      </div>
    </SkeletonRoot>
  );
}
