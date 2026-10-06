import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonRoot } from './skeleton-root';

/**
 * The client's delivery page: one centred column (firm header, hero card, the
 * journey tracker, two cards) on the portal's own ground. Not the studio's
 * brand loader: the client is opening a page, not starting an application.
 */
export function PortalSkeleton() {
  return (
    <div className="client-portal min-h-screen">
      <SkeletonRoot className="mx-auto flex max-w-md flex-col gap-4 space-y-0 p-4 md:py-8">
        <div className="flex items-center gap-3 rounded-panel border bg-background p-4">
          <Skeleton className="size-10" />
          <Skeleton className="h-5 w-40" />
        </div>
        <div className="space-y-3 rounded-panel border bg-background p-5">
          <Skeleton className="h-5 w-24 rounded-pill" />
          <Skeleton className="h-6 w-3/4" />
          <Skeleton className="h-11 w-full rounded-pill" />
        </div>
        <Skeleton className="h-16 w-full rounded-panel" />
        <Skeleton className="h-32 w-full rounded-panel" />
        <Skeleton className="h-32 w-full rounded-panel" />
      </SkeletonRoot>
    </div>
  );
}
