'use client';

import { UserMinus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { formatDate } from '@/lib/format/date';
import { siteTeamMemberLabel } from './site-team-label';
import type { SiteTeamMember } from './team-tab-types';

/** The members on the project's site team; a remove button on each when `onRemove` is given. */
export function TeamSiteList({
  members,
  currentUserId,
  onRemove,
  removing,
}: {
  members: SiteTeamMember[];
  currentUserId: string;
  onRemove?: (userId: string, label: string) => void;
  removing: boolean;
}) {
  const t = useTranslations('projects.profile.team');
  const tTeam = useTranslations('team');
  const roles = useTranslations('roles');
  const locale = useLocale();

  if (members.length === 0) return <EmptyState title={t('empty')} className="py-6" />;

  return (
    <ul className="space-y-2" aria-label={t('title')}>
      {members.map((member) => {
        const label = siteTeamMemberLabel(member, tTeam('unknownUser'));
        return (
          <li key={member.userId} className="flex flex-wrap items-center justify-between gap-3 rounded-item border p-3">
            <div className="min-w-0 space-y-0.5">
              <p className="truncate text-body font-medium">
                <bdi>{label}</bdi>
                {member.userId === currentUserId && (
                  <span className="ms-2 rounded-pill bg-muted px-2 py-0.5 text-caption text-muted-foreground">{tTeam('you')}</span>
                )}
              </p>
              {member.email && member.name && (
                <p className="truncate text-caption text-muted-foreground" dir="ltr">
                  {member.email}
                </p>
              )}
              {member.assignedAt && (
                <p className="text-caption text-muted-foreground">
                  {t('assignedOn', { date: formatDate(member.assignedAt, locale) })}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-pill bg-primary/10 px-2.5 py-1 text-caption font-medium text-primary">
                {roles(`${member.role}.label`)}
              </span>
              {onRemove && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={removing}
                  onClick={() => onRemove(member.userId, label)}
                  aria-label={`${t('remove')}: ${label}`}
                >
                  <UserMinus className="size-4" aria-hidden />
                  <span className="hidden sm:inline">{t('remove')}</span>
                </Button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
