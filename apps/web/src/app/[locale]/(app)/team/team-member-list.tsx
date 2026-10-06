'use client';

import { Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { OverflowMenu } from '@/components/ui/overflow-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { MEMBER_ROLES, type MemberRole } from '@/lib/permissions/roles';
import type { Member } from './team-types';

export function TeamMemberList({
  members,
  canManage,
  isOwner,
  currentUserId,
  isPending,
  onChangeRole,
  onRemove,
}: {
  members: Member[];
  canManage: boolean;
  isOwner: boolean;
  currentUserId: string;
  isPending: boolean;
  onChangeRole: (userId: string, role: MemberRole) => void;
  onRemove: (userId: string, label: string) => void;
}) {
  const t = useTranslations('team');
  const tc = useTranslations('common');
  const roles = useTranslations('roles');
  const roleLabel = (role: MemberRole) => roles(`${role}.label`);

  return (
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
                className="flex flex-wrap items-center justify-between gap-3 rounded-item border p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-body font-medium">
                    {m.fullName || m.email || t('unknownUser')}
                    {isSelf && (
                      <span className="ms-2 rounded-pill bg-muted px-2 py-0.5 text-caption text-muted-foreground">
                        {t('you')}
                      </span>
                    )}
                  </p>
                  {m.email && m.fullName && (
                    <p className="truncate text-caption text-muted-foreground" dir="ltr">
                      {m.email}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {canEditThis ? (
                    <Select
                      value={m.role}
                      onValueChange={(v) => onChangeRole(m.userId, v as MemberRole)}
                      disabled={isPending}
                    >
                      <SelectTrigger className="h-9 w-auto min-w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {MEMBER_ROLES.filter(
                          (r) => r !== 'owner' || isOwner || targetIsOwner,
                        ).map((r) => (
                          <SelectItem key={r} value={r}>
                            {roleLabel(r)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className="rounded-pill bg-primary/10 px-2.5 py-1 text-caption font-medium text-primary">
                      {roleLabel(m.role)}
                    </span>
                  )}
                  {canEditThis && !isSelf && (
                    <OverflowMenu
                      label={tc('moreActions')}
                      disabled={isPending}
                      actions={[
                        {
                          key: 'remove',
                          label: t('remove'),
                          icon: Trash2,
                          destructive: true,
                          onSelect: () => onRemove(m.userId, label),
                        },
                      ]}
                    />
                  )}
                </div>
              </div>
            );
          })
        )}
        {!canManage && (
          <p className="pt-1 text-caption text-muted-foreground">{t('readonly')}</p>
        )}
      </CardContent>
    </Card>
  );
}
