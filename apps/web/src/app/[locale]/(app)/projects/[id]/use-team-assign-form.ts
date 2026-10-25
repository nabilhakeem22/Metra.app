'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { useFieldErrors } from '@/hooks/use-field-errors';
import { toast } from '@/hooks/use-toast';
import { fieldsFailed } from '@/lib/actions/field-errors';
import type { ActionResult } from '@/lib/actions/result';
import { assignSiteMember } from '@/lib/site/assignments/actions';

export const TEAM_ASSIGN_FIELDS = ['userId'] as const;

/** The member chosen in the picker, with the label he was chosen by. */
interface PickedMember {
  userId: string;
  label: string;
}

/**
 * The refusal as the form says it: the chosen member may no longer join a
 * site team (he left the studio or became a client meanwhile) goes under the
 * member box in the manager's words; any other goes above the button.
 */
function underTheMember(result: ActionResult): ActionResult {
  return result.error === 'not_member' ? fieldsFailed({ userId: { code: 'not_internal_member' } }) : result;
}

/**
 * The add-to-site-team form: pick a member, press Add. Pressing it with no
 * member chosen says so under the box and sends nothing. Add is never
 * disabled while it works (a second press is ignored), so the keyboard focus
 * stays on it. A member the server says may no longer join leaves the picker
 * (`onMemberLeft`).
 */
export function useTeamAssignForm(projectId: string, onMemberLeft: (userId: string) => void) {
  const t = useTranslations('projects.profile.team');
  const te = useTranslations('errors');
  const [picked, setPicked] = useState<PickedMember | null>(null);
  const [assigning, startAssigning] = useTransition();
  const errors = useFieldErrors({ fields: TEAM_ASSIGN_FIELDS, translate: te });

  function assign(): void {
    if (assigning) return;
    if (errors.applyLocal(picked ? {} : { userId: { code: 'required' } })) return;
    const { userId } = picked as PickedMember;
    startAssigning(async () => {
      try {
        const result = await assignSiteMember({ projectId, userId });
        if (result.error === 'not_member') {
          setPicked(null);
          onMemberLeft(userId);
        }
        if (errors.applyResult(underTheMember(result))) return;
        setPicked(null);
        toast({ title: t(result.already ? 'alreadyAssigned' : 'assigned') });
      } catch (rejection) {
        errors.applyRejection(rejection);
      }
    });
  }

  return { picked, setPicked, assigning, assign, errors };
}
