'use client';

import { useTranslations } from 'next-intl';
import { SectionLabel } from '@/components/ui/section-label';
import { Link } from '@/i18n/routing';

/** The trail's two parents, names already resolved for the locale. */
export interface HeaderCrumbs {
  clientId: string;
  clientName: string;
  projectId: string;
  projectName: string;
}

const CRUMB_LINK = 'hover:text-[color:var(--text)] hover:underline';

/**
 * Deliveries / client / project / DE-number, on the header's quiet label line:
 * where this delivery sits, and which record it is. The separator is a plain
 * `/`, which reads the same in both directions; logical layout does the rest.
 */
export function EngagementHeaderCrumbs({
  crumbs,
  docNumber,
}: {
  crumbs: HeaderCrumbs;
  docNumber: string;
}) {
  const t = useTranslations('engagements');
  return (
    <nav aria-label={t('command.crumbLabel')}>
      <SectionLabel className="flex flex-wrap items-center gap-x-1">
        <Link href="/engagements" className={CRUMB_LINK}>
          {t('title')}
        </Link>
        <span aria-hidden>/</span>
        <Link href={`/clients/${crumbs.clientId}`} className={CRUMB_LINK}>
          <bdi>{crumbs.clientName}</bdi>
        </Link>
        <span aria-hidden>/</span>
        <Link href={`/projects/${crumbs.projectId}`} className={CRUMB_LINK}>
          <bdi>{crumbs.projectName}</bdi>
        </Link>
        <span aria-hidden>/</span>
        <span dir="ltr" aria-current="page">
          {docNumber}
        </span>
      </SectionLabel>
    </nav>
  );
}
