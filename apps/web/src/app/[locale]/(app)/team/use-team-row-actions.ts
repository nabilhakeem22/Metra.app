'use client';

import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import type { useConfirm } from '@/components/ui/confirm-dialog';
import { toast } from '@/hooks/use-toast';
import { describeFailure, describeRejection } from '@/lib/actions/error-message';
import type { ActionResult } from '@/lib/actions/result';
import type { MemberRole } from '@/lib/permissions/roles';
import { changeMemberRole, removeMember, resendInvite, revokeInvite } from '@/lib/team/actions';

type Confirm = ReturnType<typeof useConfirm>['confirm'];

/**
 * The per-row acts of the Team page: resend or revoke an invite, change a
 * member's role, remove a member. A row has no field to say a refusal under,
 * so the toast names the cause (D11): the last owner, an invite accepted
 * meanwhile, a role only an owner may change.
 */
export function useTeamRowActions(confirm: Confirm, onLink: (link: string | null) => void) {
  const t = useTranslations('team');
  const te = useTranslations('errors');
  const tc = useTranslations('common');
  const [acting, startActing] = useTransition();

  /** Run one act; toast its success or its cause. */
  function act(run: () => Promise<ActionResult>, success: string, onOk?: (result: ActionResult) => void) {
    startActing(async () => {
      try {
        const result = await run();
        if (!result.ok) {
          toast({ title: describeFailure(result, te), variant: 'destructive' });
          return;
        }
        onOk?.(result);
        toast({ title: success });
      } catch (rejection) {
        toast({ title: describeRejection(rejection, te), variant: 'destructive' });
      }
    });
  }

  function resend(id: string) {
    act(() => resendInvite(id), t('inviteResent'), (result) => onLink(result.link ?? null));
  }

  async function revoke(id: string) {
    const confirmed = await confirm({
      title: t('confirmRevokeTitle'),
      // No undo: revoking is a security act, and an undo that delayed it would
      // leave the link live while the studio believed it dead.
      description: `${t('confirmRevokeDesc')} ${tc('cannotUndo')}`,
      confirmLabel: t('revoke'),
      cancelLabel: t('cancel'),
      variant: 'destructive',
    });
    if (confirmed) act(() => revokeInvite(id), t('inviteRevoked'));
  }

  function changeRole(userId: string, role: MemberRole) {
    act(() => changeMemberRole({ userId, role }), t('roleChanged'));
  }

  async function remove(userId: string, label: string) {
    const confirmed = await confirm({
      title: t('confirmRemoveTitle'),
      description: `${t('confirmRemoveDesc', { name: label })} ${tc('cannotUndo')}`,
      confirmLabel: t('remove'),
      cancelLabel: t('cancel'),
      variant: 'destructive',
    });
    if (confirmed) act(() => removeMember(userId), t('memberRemoved'));
  }

  return { acting, resend, revoke, changeRole, remove };
}
