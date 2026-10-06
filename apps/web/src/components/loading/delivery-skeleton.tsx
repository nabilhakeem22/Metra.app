import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonRoot } from './skeleton-root';

const SPINE_SEGMENTS = 8;

/**
 * The delivery page, in its own shape: the breadcrumb, the header card with its
 * status chip, the command card (a tinted band with the 8-stage spine, then a
 * headline and the one action), the tab strip and one panel. A generic detail
 * placeholder here made the page jump when it arrived.
 */
export function DeliverySkeleton() {
  return (
    <SkeletonRoot>
      <Skeleton className="h-3 w-48" />
      <div className="space-y-2">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-7 w-72 max-w-full" />
        <Skeleton className="h-5 w-24 rounded-pill" />
      </div>
      <div className="glass overflow-hidden p-0" data-skeleton="command-card">
        <div
          className="flex gap-1.5 px-5 pb-4 pt-5"
          data-skeleton="spine"
          style={{ background: 'var(--track)' }}
        >
          {Array.from({ length: SPINE_SEGMENTS }, (_, i) => (
            <div key={i} className="flex-1 space-y-1.5">
              <Skeleton className="h-1 w-full rounded-full" />
              <Skeleton className="h-3 w-3/4" />
            </div>
          ))}
        </div>
        <div className="space-y-3 p-5">
          <Skeleton className="h-6 w-80 max-w-full" />
          <Skeleton className="h-4 w-64 max-w-full" />
          <Skeleton className="h-10 w-40 rounded-pill" />
        </div>
      </div>
      <Skeleton className="h-11 w-full" />
      <div className="glass space-y-3 p-5">
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-10/12" />
      </div>
    </SkeletonRoot>
  );
}
