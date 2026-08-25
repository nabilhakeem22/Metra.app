'use client';

import { Copy, Loader2, Send } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { FieldHint } from '@/components/ui/field-hint';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { MemberRole } from '@/lib/permissions/roles';
import { INVITABLE_ROLES } from '@/lib/team/invitable';

export function TeamInviteForm({
  email,
  onEmailChange,
  inviteRole,
  onInviteRoleChange,
  lastLink,
  isPending,
  onSubmit,
  onCopy,
}: {
  email: string;
  onEmailChange: (value: string) => void;
  inviteRole: MemberRole;
  onInviteRoleChange: (role: MemberRole) => void;
  lastLink: string | null;
  isPending: boolean;
  onSubmit: () => void;
  onCopy: (link: string) => void;
}) {
  const t = useTranslations('team');
  const th = useTranslations('hints.team');
  const roles = useTranslations('roles');

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('inviteTitle')}</CardTitle>
        <CardDescription>{roles(`${inviteRole}.desc`)}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-2">
            <Label htmlFor="inviteEmail" className="flex items-center">
              {t('emailLabel')}
              <FieldHint id="inviteEmail-hint" hint={th('email')} />
            </Label>
            <Input
              id="inviteEmail"
              type="email"
              dir="ltr"
              aria-describedby="inviteEmail-hint"
              placeholder={t('emailPlaceholder')}
              value={email}
              onChange={(e) => onEmailChange(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="inviteRole" className="flex items-center">
              {t('roleLabel')}
              <FieldHint id="inviteRole-hint" hint={th('role')} />
            </Label>
            <select
              id="inviteRole"
              aria-describedby="inviteRole-hint"
              value={inviteRole}
              onChange={(e) => onInviteRoleChange(e.target.value as MemberRole)}
              className="h-10 w-full glass-field outline-none focus-ring-brand focus-visible:border-[color:hsl(var(--brand))] px-3 text-sm sm:w-48"
            >
              {INVITABLE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {roles(`${r}.label`)}
                </option>
              ))}
            </select>
          </div>
          <Button onClick={onSubmit} disabled={isPending || email.trim() === ''}>
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
                onClick={() => onCopy(lastLink)}
                aria-label={t('copyLink')}
              >
                <Copy className="size-4" aria-hidden />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
