'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { toast } from '@/hooks/use-toast';
import { resolveActionError } from '@/lib/actions/error-message';
import type { ActionCode } from '@/lib/actions/result';
import type { MemberRole } from '@/lib/permissions/roles';
import {
  changeMemberRole,
  inviteMember,
  removeMember,
  resendInvite,
  revokeInvite,
} from '@/lib/team/actions';
import { TeamInviteForm } from './team-invite-form';
import { TeamMemberList } from './team-member-list';
import { TeamPendingList } from './team-pending-list';
import type { Member, Pending } from './team-types';

export interface TeamClientProps {
  members: Member[];
  pending: Pending[];
  canManage: boolean;
  isOwner: boolean;
  currentUserId: string;
}


export function TeamClient({
  members,
  pending,
  canManage,
  isOwner,
  currentUserId,
}: TeamClientProps) {
  const t = useTranslations('team');
  const te = useTranslations('errors');
  const { confirm, dialog } = useConfirm();
  const [isPending, startTransition] = useTransition();

  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<MemberRole>('viewer');
  const [lastLink, setLastLink] = useState<string | null>(null);

  const errorMessage = (code?: ActionCode) => resolveActionError(code, te);

  function copy(link: string) {
    void navigator.clipboard?.writeText(link);
    toast({ title: t('copied') });
  }

  function submitInvite() {
    startTransition(async () => {
      const res = await inviteMember({ email, role: inviteRole });
      if (res.ok) {
        setEmail('');
        setLastLink(res.link ?? null);
        toast({ title: t('inviteSent') });
      } else {
        toast({ title: errorMessage(res.error), variant: 'destructive' });
      }
    });
  }

  function onResend(id: string) {
    startTransition(async () => {
      const res = await resendInvite(id);
      if (res.ok) {
        setLastLink(res.link ?? null);
        toast({ title: t('inviteResent') });
      } else {
        toast({ title: errorMessage(res.error), variant: 'destructive' });
      }
    });
  }

  async function onRevoke(id: string) {
    const ok = await confirm({
      title: t('confirmRevokeTitle'),
      description: t('confirmRevokeDesc'),
      confirmLabel: t('revoke'),
      cancelLabel: t('cancel'),
      variant: 'destructive',
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await revokeInvite(id);
      toast(
        res.ok
          ? { title: t('inviteRevoked') }
          : { title: errorMessage(res.error), variant: 'destructive' },
      );
    });
  }

  function onChangeRole(userId: string, role: MemberRole) {
    startTransition(async () => {
      const res = await changeMemberRole({ userId, role });
      toast(
        res.ok
          ? { title: t('roleChanged') }
          : { title: errorMessage(res.error), variant: 'destructive' },
      );
    });
  }

  async function onRemove(userId: string, label: string) {
    const ok = await confirm({
      title: t('confirmRemoveTitle'),
      description: t('confirmRemoveDesc', { name: label }),
      confirmLabel: t('remove'),
      cancelLabel: t('cancel'),
      variant: 'destructive',
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await removeMember(userId);
      toast(
        res.ok
          ? { title: t('memberRemoved') }
          : { title: errorMessage(res.error), variant: 'destructive' },
      );
    });
  }

  return (
    <div className="space-y-6">
      {dialog}

      {canManage && (
        <TeamInviteForm
          email={email}
          onEmailChange={setEmail}
          inviteRole={inviteRole}
          onInviteRoleChange={setInviteRole}
          lastLink={lastLink}
          isPending={isPending}
          onSubmit={submitInvite}
          onCopy={copy}
        />
      )}

      <TeamMemberList
        members={members}
        canManage={canManage}
        isOwner={isOwner}
        currentUserId={currentUserId}
        isPending={isPending}
        onChangeRole={onChangeRole}
        onRemove={onRemove}
      />

      <TeamPendingList
        pending={pending}
        canManage={canManage}
        isPending={isPending}
        onResend={onResend}
        onRevoke={onRevoke}
      />
    </div>
  );
}
