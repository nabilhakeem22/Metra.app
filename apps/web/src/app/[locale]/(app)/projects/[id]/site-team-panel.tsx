'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { pluralParams } from '@/lib/format/plural-params';
import { TeamAssignForm } from './team-assign-form';
import { TeamSiteList } from './team-site-list';
import type { SiteTeamMember } from './team-tab-types';
import { useFocusLandingOnTeamChange } from './use-focus-landing-on-team-change';
import { useTeamUnassign } from './use-team-unassign';

/** The site team card: who is on it, and for a manager the add form and the remove act. */
export function SiteTeamPanel({
  projectId,
  members,
  notShown,
  canManage,
  currentUserId,
}: {
  projectId: string;
  members: SiteTeamMember[];
  notShown: number;
  canManage: boolean;
  currentUserId: string;
}) {
  const t = useTranslations('projects.profile.team');
  const locale = useLocale();
  const { confirm, dialog } = useConfirm();
  const unassign = useTeamUnassign(projectId, confirm);
  const teamKey = members.map((member) => member.userId).join(',');
  const landing = useFocusLandingOnTeamChange(teamKey);

  return (
    <Card>
      {dialog}
      <CardHeader>
        <CardTitle ref={landing} tabIndex={-1} className="outline-none">
          {t('title')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {canManage && <TeamAssignForm projectId={projectId} teamKey={teamKey} />}
        <TeamSiteList
          members={members}
          currentUserId={currentUserId}
          onRemove={canManage ? unassign.remove : undefined}
          removing={unassign.removing}
        />
        {notShown > 0 && (
          <p className="text-caption text-muted-foreground">{t('notShown', pluralParams('count', 'countText', notShown, locale))}</p>
        )}
        {!canManage && <p className="text-caption text-muted-foreground">{t('readonly')}</p>}
      </CardContent>
    </Card>
  );
}
