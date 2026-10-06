import { Skeleton } from '@/components/ui/skeleton';
import { HeaderSkeleton } from './page-skeletons';
import { SkeletonRoot } from './skeleton-root';

/**
 * A priced document (the builder, a proposal, a contract or variation token
 * page): header, one section card of line rows, then the totals card at the
 * inline end. `className` lets a token page add its own centred column.
 */
export function DocumentSkeleton({ className }: { className?: string }) {
  return (
    <SkeletonRoot className={className}>
      <HeaderSkeleton />
      <div className="glass space-y-3 p-5">
        <Skeleton className="h-5 w-48" />
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex items-center gap-4">
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-24" />
          </div>
        ))}
      </div>
      <div className="glass ms-auto max-w-xs space-y-2 p-5">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="flex justify-between gap-4">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-24" />
          </div>
        ))}
      </div>
    </SkeletonRoot>
  );
}
