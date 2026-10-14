'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { toast } from '@/hooks/use-toast';
import { TeamInviteForm } from './team-invite-form';
import { TeamMemberList } from './team-member-list';
import { TeamPendingList } from './team-pending-list';
import type { Member, Pending } from './team-types';
import { useInviteForm } from './use-invite-form';
import { useTeamRowActions } from './use-team-row-actions';

export interface TeamClientProps {
  members: Member[];
  pending: Pending[];
  canManage: boolean;
  isOwner: boolean;
  currentUserId: string;
}

/** The Team page: invite (refusals under Email), members and pending invites
 *  (row acts, each refusal toasted with its cause). */
export function TeamClient({ members, pending, canManage, isOwner, currentUserId }: TeamClientProps) {
  const t = useTranslations('team');
  const { confirm, dialog } = useConfirm();
  // The last link an invite or a resend minted, shown to copy.
  const [lastLink, setLastLink] = useState<string | null>(null);
  const invite = useInviteForm(setLastLink);
  const rows = useTeamRowActions(confirm, setLastLink);

  function copy(link: string) {
    void navigator.clipboard?.writeText(link);
    toast({ title: t('copied') });
  }

  return (
    <div className="space-y-6">
      {dialog}

      {canManage && <TeamInviteForm invite={invite} lastLink={lastLink} onCopy={copy} />}

      <TeamMemberList
        members={members}
        canManage={canManage}
        isOwner={isOwner}
        currentUserId={currentUserId}
        isPending={rows.acting}
        onChangeRole={rows.changeRole}
        onRemove={rows.remove}
      />

      <TeamPendingList
        pending={pending}
        canManage={canManage}
        isPending={rows.acting}
        onResend={rows.resend}
        onRevoke={rows.revoke}
      />
    </div>
  );
}
