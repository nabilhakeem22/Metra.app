'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/routing';

/** The deliveries list's keyset paging: back to the newest page, or on to older ones. */
export function EngagementsPager({
  nextBefore,
  isFirstPage,
}: {
  nextBefore: number | null;
  isFirstPage: boolean;
}) {
  const t = useTranslations('engagements.list');
  return (
    <nav className="flex justify-between gap-2" aria-label={t('pages')}>
      {isFirstPage ? (
        <span />
      ) : (
        <Button asChild variant="outline" size="sm">
          <Link href="/engagements">{t('newest')}</Link>
        </Button>
      )}
      {nextBefore !== null && (
        <Button asChild variant="outline" size="sm">
          <Link href={`/engagements?before=${nextBefore}`}>{t('older')}</Link>
        </Button>
      )}
    </nav>
  );
}
