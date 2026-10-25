'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { useFieldErrors } from '@/hooks/use-field-errors';
import { toast } from '@/hooks/use-toast';
import { fieldsFailed } from '@/lib/actions/field-errors';
import type { ActionResult } from '@/lib/actions/result';
import { assignSiteMember } from '@/lib/site/assignments/actions';

export const TEAM_ASSIGN_FIELDS = ['userId'] as const;

/**
 * The refusal as the form says it: one about the chosen member (he is no
 * longer an internal member of the studio) goes under the member box; any
 * other goes above the button.
 */
function underTheMember(result: ActionResult): ActionResult {
  return result.error === 'not_member' ? fieldsFailed({ userId: { code: 'not_member' } }) : result;
}

/**
 * The add-to-site-team form: pick a member, press Add. Pressing it with no
 * member chosen says so under the box and sends nothing.
 */
export function useTeamAssignForm(projectId: string) {
  const t = useTranslations('projects.profile.team');
  const te = useTranslations('errors');
  const [userId, setUserId] = useState('');
  const [assigning, startAssigning] = useTransition();
  const errors = useFieldErrors({ fields: TEAM_ASSIGN_FIELDS, translate: te });

  function assign(): void {
    if (errors.applyLocal(userId ? {} : { userId: { code: 'required' } })) return;
    startAssigning(async () => {
      try {
        const result = await assignSiteMember({ projectId, userId });
        if (errors.applyResult(underTheMember(result))) return;
        setUserId('');
        toast({ title: t(result.already ? 'alreadyAssigned' : 'assigned') });
      } catch (rejection) {
        errors.applyRejection(rejection);
      }
    });
  }

  return { userId, setUserId, assigning, assign, errors };
}
