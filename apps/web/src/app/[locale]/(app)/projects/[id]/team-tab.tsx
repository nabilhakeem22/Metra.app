import { Users } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { SiteTeamPanel } from './site-team-panel';
import type { TeamTabData } from './team-tab-types';

/**
 * The project's Team tab: its site team (who works on the site; plan S3). A
 * role that may not read assignments (the accountant) is told so; everyone
 * else gets the panel, with the add form and the remove act for a manager.
 */
export async function TeamTab({ projectId, data }: { projectId: string; data: TeamTabData }) {
  if (data.access === 'none') {
    const t = await getTranslations('projects.profile.team');
    return (
      <Card>
        <CardContent className="py-4">
          <EmptyState icon={<Users className="size-6" aria-hidden />} title={t('noAccess')} />
        </CardContent>
      </Card>
    );
  }
  return (
    <SiteTeamPanel
      projectId={projectId}
      members={data.members}
      canManage={data.access === 'manage'}
      currentUserId={data.currentUserId}
    />
  );
}
