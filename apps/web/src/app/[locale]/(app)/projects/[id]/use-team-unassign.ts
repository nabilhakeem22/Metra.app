'use client';

import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import type { useConfirm } from '@/components/ui/confirm-dialog';
import { toast } from '@/hooks/use-toast';
import { describeFailure, describeRejection } from '@/lib/actions/error-message';
import { unassignSiteMember } from '@/lib/site/assignments/actions';

type Confirm = ReturnType<typeof useConfirm>['confirm'];

/**
 * Take a member off the project's site team, after a confirm. A row has no
 * field to say a refusal under, so the toast names the cause (as the studio
 * Team page's row acts do).
 */
export function useTeamUnassign(projectId: string, confirm: Confirm) {
  const t = useTranslations('projects.profile.team');
  const te = useTranslations('errors');
  const tc = useTranslations('common');
  const [removing, startRemoving] = useTransition();

  async function remove(userId: string, label: string): Promise<void> {
    const confirmed = await confirm({
      title: t('confirmRemoveTitle'),
      description: t('confirmRemoveDesc', { name: label }),
      confirmLabel: t('remove'),
      cancelLabel: tc('cancel'),
      variant: 'destructive',
    });
    if (!confirmed) return;
    startRemoving(async () => {
      try {
        const result = await unassignSiteMember({ projectId, userId });
        if (!result.ok) {
          toast({ title: describeFailure(result, te), variant: 'destructive' });
          return;
        }
        toast({ title: t('removed') });
      } catch (rejection) {
        toast({ title: describeRejection(rejection, te), variant: 'destructive' });
      }
    });
  }

  return { remove, removing };
}
