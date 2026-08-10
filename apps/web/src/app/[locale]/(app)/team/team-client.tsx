'use client';

import { Copy, Loader2, RefreshCw, Send, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import { formatDate } from '@/lib/format/date';
import { MEMBER_ROLES, type MemberRole } from '@/lib/permissions/roles';
import {
  changeMemberRole,
  inviteMember,
  removeMember,
  resendInvite,
  revokeInvite,
} from '@/lib/team/actions';

interface Member {
  membershipId: string;
  userId: string;
  email: string | null;
  fullName: string | null;
  role: MemberRole;
  createdAt: string;
}

interface Pending {
  id: string;
  email: string;
  role: MemberRole;
  expiresAt: string;
  createdAt: string;
}

export interface TeamClientProps {
  members: Member[];
  pending: Pending[];
  canManage: boolean;
  isOwner: boolean;
  currentUserId: string;
}

const INVITABLE_ROLES = MEMBER_ROLES.filter((r) => r !== 'owner');

export function TeamClient({
  members,
  pending,
  canManage,
  isOwner,
  currentUserId,
}: TeamClientProps) {
  const t = useTranslations('team');
  const roles = useTranslations('roles');
  const locale = useLocale();
  const { confirm, dialog } = useConfirm();
  const [isPending, startTransition] = useTransition();

  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<MemberRole>('viewer');
  const [lastLink, setLastLink] = useState<string | null>(null);

  function errorMessage(code?: string): string {
    const known = [
      'forbidden',
      'invalid',
      'already_member',
      'pending_exists',
      'last_owner',
      'owner_immutable',
    ];
    const key = code && known.includes(code) ? code : 'generic';
    // t() keys are camelCased in the message file.
    const map: Record<string, string> = {
      forbidden: 'errorForbidden',
      invalid: 'errorInvalid',
      already_member: 'errorAlreadyMember',
      pending_exists: 'errorPendingExists',
      last_owner: 'errorLastOwner',
      owner_immutable: 'errorOwnerImmutable',
      generic: 'errorGeneric',
    };
    return t(map[key]);
  }

  function roleLabel(role: MemberRole): string {
    return roles(`${role}.label`);
  }

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
        <Card>
          <CardHeader>
            <CardTitle>{t('inviteTitle')}</CardTitle>
            <CardDescription>{roles(`${inviteRole}.desc`)}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-2">
                <Label htmlFor="inviteEmail">{t('emailLabel')}</Label>
                <Input
                  id="inviteEmail"
                  type="email"
                  dir="ltr"
                  placeholder={t('emailPlaceholder')}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="inviteRole">{t('roleLabel')}</Label>
                <select
                  id="inviteRole"
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as MemberRole)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm sm:w-48"
                >
                  {INVITABLE_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {roleLabel(r)}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                onClick={submitInvite}
                disabled={isPending || email.trim() === ''}
              >
                {isPending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Send className="size-4" aria-hidden />
                )}
                {t('sendInvite')}
              </Button>
            </div>

            {lastLink && (
              <div className="space-y-1 rounded-xl border bg-muted/40 p-3">
                <p className="text-xs font-medium text-muted-foreground">
                  {t('inviteLink')}
                </p>
                <div className="flex items-center gap-2">
                  <Input readOnly dir="ltr" value={lastLink} className="text-xs" />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => copy(lastLink)}
                    aria-label={t('copyLink')}
                  >
                    <Copy className="size-4" aria-hidden />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('membersTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {members.length === 0 ? (
            <EmptyState title={t('noMembers')} />
          ) : (
            members.map((m) => {
              const isSelf = m.userId === currentUserId;
              const targetIsOwner = m.role === 'owner';
              const canEditThis = canManage && (!targetIsOwner || isOwner);
              const label = m.fullName || m.email || m.userId;
              return (
                <div
                  key={m.membershipId}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {m.fullName || m.email || t('unknownUser')}
                      {isSelf && (
                        <span className="ms-2 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                          {t('you')}
                        </span>
                      )}
                    </p>
                    {m.email && m.fullName && (
                      <p className="truncate text-xs text-muted-foreground" dir="ltr">
                        {m.email}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {canEditThis ? (
                      <select
                        value={m.role}
                        onChange={(e) =>
                          onChangeRole(m.userId, e.target.value as MemberRole)
                        }
                        disabled={isPending}
                        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                      >
                        {MEMBER_ROLES.filter(
                          (r) => r !== 'owner' || isOwner || targetIsOwner,
                        ).map((r) => (
                          <option key={r} value={r}>
                            {roleLabel(r)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                        {roleLabel(m.role)}
                      </span>
                    )}
                    {canEditThis && !isSelf && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => onRemove(m.userId, label)}
                        disabled={isPending}
                        aria-label={t('remove')}
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })
          )}
          {!canManage && (
            <p className="pt-1 text-xs text-muted-foreground">{t('readonly')}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('pendingTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {pending.length === 0 ? (
            <EmptyState title={t('noPending')} />
          ) : (
            pending.map((p) => (
              <div
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium" dir="ltr">
                    {p.email}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {roleLabel(p.role)} · {t('expiresOn')}{' '}
                    {formatDate(p.expiresAt, locale)}
                  </p>
                </div>
                {canManage && (
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => onResend(p.id)}
                      disabled={isPending}
                    >
                      <RefreshCw className="size-4" aria-hidden />
                      {t('resend')}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => onRevoke(p.id)}
                      disabled={isPending}
                    >
                      {t('revoke')}
                    </Button>
                  </div>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
