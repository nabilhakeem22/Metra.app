'use client';

import { useTranslations } from 'next-intl';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { TeamAssignForm } from './team-assign-form';
import { TeamSiteList } from './team-site-list';
import type { SiteTeamMember } from './team-tab-types';
import { useTeamUnassign } from './use-team-unassign';

/** The site team card: who is on it, and for a manager the add form and the remove act. */
export function SiteTeamPanel({
  projectId,
  members,
  canManage,
  currentUserId,
}: {
  projectId: string;
  members: SiteTeamMember[];
  canManage: boolean;
  currentUserId: string;
}) {
  const t = useTranslations('projects.profile.team');
  const { confirm, dialog } = useConfirm();
  const unassign = useTeamUnassign(projectId, confirm);
  const onTeam = members.filter((member) => member.assignedAt !== null);
  const candidates = members.filter((member) => member.assignedAt === null);

  return (
    <Card>
      {dialog}
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {canManage && <TeamAssignForm projectId={projectId} candidates={candidates} />}
        <TeamSiteList
          members={onTeam}
          currentUserId={currentUserId}
          onRemove={canManage ? unassign.remove : undefined}
          removing={unassign.removing}
        />
        {!canManage && <p className="text-caption text-muted-foreground">{t('readonly')}</p>}
      </CardContent>
    </Card>
  );
}
