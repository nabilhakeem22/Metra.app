'use client';

import { useTranslations } from 'next-intl';
import { DeepLinkTabs } from '@/components/profile/deep-link-tabs';
import { PROJECT_TABS, type ProjectTab } from './tabs';

/** The project profile's tab list, one deep link per tab. */
export function ProfileTabs({
  projectId,
  active,
}: {
  projectId: string;
  active: ProjectTab;
}) {
  const t = useTranslations('projects.profile.tabs');
  return (
    <DeepLinkTabs
      tabs={PROJECT_TABS}
      active={active}
      hrefOf={(tab) => `/projects/${projectId}?tab=${tab}`}
      labelOf={(tab) => t(tab)}
      listLabel={t('sectionsLabel')}
    />
  );
}
