import { Skeleton } from '@/components/ui/skeleton';

/**
 * Route-level loading shapes.
 *
 * These stand in for a page's content while it streams. The app shell — sidebar,
 * top bar — is NOT part of them: it lives in the (app) layout, above the Suspense
 * boundary, so it stays on screen throughout. The handoff is explicit that the
 * glass panel itself stays visible and only its contents are placeholdered, which
 * is what keeps a navigation feeling like a change of contents rather than a
 * reload of the whole application.
 *
 * They are deliberately approximate. A skeleton that tries to predict the exact
 * row count reflows the moment real data lands; one that just holds the right
 * amount of vertical space does not.
 */

/** Title + subtitle, matching the PageHeader every page opens with. */
function HeaderSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-7 w-56" />
      <Skeleton className="h-4 w-80 max-w-full" />
    </div>
  );
}

/** Generic: a page header over one glass panel. Dashboard, settings, team. */
export function PageSkeleton() {
  return (
    <div className="space-y-6">
      <HeaderSkeleton />
      <div className="glass space-y-4 p-5">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-9/12" />
      </div>
    </div>
  );
}

/** Index pages: header, a filter toolbar, then table rows. */
export function ListSkeleton() {
  return (
    <div className="space-y-6">
      <HeaderSkeleton />
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-9 w-64 max-w-full rounded-pill" />
        <Skeleton className="h-9 w-32 rounded-pill" />
      </div>
      <div className="glass divide-y divide-[color:var(--rule-soft)] p-0">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex items-center gap-4 px-5 py-4">
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="hidden h-4 w-32 sm:block" />
            <Skeleton className="h-6 w-20 rounded-pill" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Detail pages: header, the tab row, then the active panel. */
export function DetailSkeleton() {
  return (
    <div className="space-y-6">
      <HeaderSkeleton />
      <div className="flex gap-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-9 w-24 rounded-pill" />
        ))}
      </div>
      <div className="grid gap-[14px] lg:grid-cols-[2fr_1fr]">
        <div className="glass space-y-4 p-5">
          <Skeleton className="h-5 w-44" />
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex items-center justify-between gap-4">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-24" />
            </div>
          ))}
        </div>
        <div className="glass space-y-4 p-5">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    </div>
  );
}
