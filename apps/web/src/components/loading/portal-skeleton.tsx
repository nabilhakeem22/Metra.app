import { useTranslations } from 'next-intl';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonRoot } from './skeleton-root';

/** The six milestones of the client's journey (lib/engagements/journey-map.ts). */
const JOURNEY_DOTS = 6;

/**
 * The client's delivery page while it loads, in the page's OWN shape so nothing
 * jumps when it arrives: the studio bar (a 40 px mark, the name, the 44 px
 * language pill), the greeting, then the command card with its six-dot journey
 * and the hero (tag, headline, two lines, a 44 px button), then one card. Not the
 * studio's brand loader: the client is opening a page, not starting an
 * application.
 */
export function PortalSkeleton() {
  // The client reads this: their own words (فصحى), not the studio's "Loading".
  const t = useTranslations('delivery');
  return (
    <div className="client-portal min-h-screen">
      <SkeletonRoot className="space-y-0" label={t('loading')}>
        <div data-skeleton="bar" className="border-b bg-background/95">
          <div className="mx-auto flex max-w-md items-center gap-3 px-4 py-2">
            <Skeleton className="size-10 shrink-0" />
            <Skeleton className="h-4 w-36" />
            <Skeleton className="ms-auto h-11 w-20 shrink-0 rounded-pill" />
          </div>
        </div>
        <div className="mx-auto flex max-w-md flex-col gap-4 p-4">
          <Skeleton data-skeleton="greeting" className="h-6 w-2/3" />
          <div className="space-y-4 rounded-panel border bg-background p-4">
            <div data-skeleton="journey" className="flex justify-between px-2">
              {Array.from({ length: JOURNEY_DOTS }, (_, index) => (
                <Skeleton key={index} className="size-6 rounded-full" />
              ))}
            </div>
            <div data-skeleton="hero" className="space-y-3 rounded-panel border p-5">
              <Skeleton className="h-5 w-24 rounded-pill" />
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-11 w-full rounded-pill" />
            </div>
          </div>
          <Skeleton data-skeleton="card" className="h-24 w-full rounded-panel" />
        </div>
      </SkeletonRoot>
    </div>
  );
}
