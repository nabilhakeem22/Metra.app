'use client';

import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/routing';
import { RANGE_OPTIONS, type RangeMonths } from '@/lib/dashboard/range';

/**
 * The dashboard's date filter. Writes the window into the URL rather than into
 * component state, so a range is shareable, survives a refresh, and lets the SERVER
 * do the querying — the charts stay server components with no client-side fetching.
 */
export function DashboardRangeFilter({ active }: { active: RangeMonths }) {
  const t = useTranslations('dashboard.range');
  const router = useRouter();
  const pathname = usePathname();

  return (
    <div
      className="inline-flex rounded-[var(--r-pill)] border border-[color:var(--rule)] p-0.5"
      role="group"
      aria-label={t('label')}
    >
      {RANGE_OPTIONS.map((months) => {
        const isActive = months === active;
        return (
          <button
            key={months}
            type="button"
            aria-pressed={isActive}
            onClick={() => router.replace(`${pathname}?range=${months}`)}
            className={`rounded-[var(--r-pill)] px-3 py-1 text-xs font-medium transition-colors ${
              isActive
                ? 'bg-brand-tint text-brand-ink'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t('months', { n: months })}
          </button>
        );
      })}
    </div>
  );
}
