'use client';

import { useTranslations } from 'next-intl';
import { DeepLinkTabs } from '@/components/profile/deep-link-tabs';
import { CLIENT_TABS, type ClientTab } from './tabs';

/** The client profile's tab list, one deep link per tab. */
export function ProfileTabs({
  clientId,
  active,
}: {
  clientId: string;
  active: ClientTab;
}) {
  const t = useTranslations('clients.profile.tabs');
  return (
    <DeepLinkTabs
      tabs={CLIENT_TABS}
      active={active}
      hrefOf={(tab) => `/clients/${clientId}?tab=${tab}`}
      labelOf={(tab) => t(tab)}
      listLabel={t('sectionsLabel')}
    />
  );
}
