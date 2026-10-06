import { Skeleton } from '@/components/ui/skeleton';
import { HeaderSkeleton } from './page-skeletons';
import { SkeletonRoot } from './skeleton-root';

/** Settings, account, API keys and team: a header over three stacked form cards. */
export function SettingsSkeleton() {
  return (
    <SkeletonRoot>
      <HeaderSkeleton />
      {Array.from({ length: 3 }, (_, card) => (
        <div key={card} className="glass space-y-4 p-5">
          <Skeleton className="h-5 w-44" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
          <Skeleton className="h-9 w-28 rounded-pill" />
        </div>
      ))}
    </SkeletonRoot>
  );
}
