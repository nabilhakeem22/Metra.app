import { useTranslations } from 'next-intl';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonRoot } from './skeleton-root';

/** The client's six design steps on the rail (lib/flow/phases/design.ts). */
const DESIGN_STEPS = 6;

/**
 * The client's delivery page while it loads, in the page's OWN shape: the studio
 * bar (a 40 px mark, the name, the 44 px language pill), the greeting's two lines,
 * then the step card with its rail band (bars and marks, and on a phone the current
 * step's name) and, below it, the hero (tag, headline, two lines, a 44 px button),
 * then one card. The band and the top of the hero land where the page's do, to
 * about a pixel on a phone. The hero's own height follows its state, so what is
 * under it can still move when the page arrives. Not the studio's brand loader: the
 * client is opening a page, not starting an application.
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
          <div data-skeleton="greeting" className="space-y-1 px-1">
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-6 w-2/3" />
          </div>
          <div className="glass overflow-hidden p-0">
            <div className="border-b px-5 pb-4 pt-5 sm:px-6" style={{ background: 'var(--track)' }}>
              <div data-skeleton="rail" className="flex gap-1.5 pb-0.5">
                {Array.from({ length: DESIGN_STEPS }, (_, index) => (
                  <div key={index} className="flex flex-1 flex-col gap-1.5">
                    <Skeleton className="h-1 rounded-full" />
                    {/* The step's mark; from sm also its name, which wraps under it. */}
                    <Skeleton className="h-[13px] w-[13px] sm:h-[39px] sm:w-full" />
                  </div>
                ))}
              </div>
              <Skeleton data-skeleton="rail-current-name" className="mt-2 h-[15px] w-24 sm:hidden" />
            </div>
            <div className="p-5 sm:px-6">
              <div data-skeleton="hero" className="space-y-3 rounded-panel border p-5">
                <Skeleton className="h-5 w-24 rounded-pill" />
                <Skeleton className="h-6 w-3/4" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-11 w-full rounded-pill" />
              </div>
            </div>
          </div>
          <Skeleton data-skeleton="card" className="h-24 w-full rounded-panel" />
        </div>
      </SkeletonRoot>
    </div>
  );
}
