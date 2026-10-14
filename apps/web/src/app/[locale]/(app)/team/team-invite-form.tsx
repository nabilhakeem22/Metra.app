'use client';

import { Copy, Loader2, Send } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldHint } from '@/components/ui/field-hint';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useFocusFirstInvalid } from '@/hooks/use-focus-first-invalid';
import type { MemberRole } from '@/lib/permissions/roles';
import { INVITABLE_ROLES } from '@/lib/team/invitable';
import type { useInviteForm } from './use-invite-form';

/** The invite card. Send stays enabled (except while sending): pressing it is
 *  how a missing or malformed address is explained, under Email. */
export function TeamInviteForm({
  invite,
  lastLink,
  onCopy,
}: {
  invite: ReturnType<typeof useInviteForm>;
  lastLink: string | null;
  onCopy: (link: string) => void;
}) {
  const t = useTranslations('team');
  const th = useTranslations('hints.team');
  const roles = useTranslations('roles');
  const fieldsRef = useRef<HTMLDivElement>(null);
  useFocusFirstInvalid(fieldsRef, invite.errors.invalidAttempt);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('inviteTitle')}</CardTitle>
        <CardDescription>{roles(`${invite.role}.desc`)}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div ref={fieldsRef} className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <div className="flex-1">
            <FormField id="inviteEmail" label={t('emailLabel')} hint={th('email')} {...invite.errors.bind('email')}>
              <Input
                type="email"
                dir="ltr"
                placeholder={t('emailPlaceholder')}
                value={invite.email}
                onChange={(e) => invite.setEmail(e.target.value)}
              />
            </FormField>
          </div>
          <div className="space-y-2">
            <Label htmlFor="inviteRole" className="flex items-center">
              {t('roleLabel')}
              <FieldHint id="inviteRole-hint" hint={th('role')} />
            </Label>
            <Select value={invite.role} onValueChange={(v) => invite.setRole(v as MemberRole)}>
              <SelectTrigger id="inviteRole" aria-describedby="inviteRole-hint" className="w-full sm:w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INVITABLE_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {roles(`${r}.label`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button variant="default" className="sm:mt-7" onClick={invite.send} disabled={invite.sending}>
            {invite.sending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Send className="size-4" aria-hidden />
            )}
            {t('sendInvite')}
          </Button>
        </div>
        {invite.errors.formError && (
          <p className="text-body text-destructive" role="alert">
            {invite.errors.formError}
          </p>
        )}

        {lastLink && (
          <div className="space-y-1 rounded-item border bg-muted/40 p-3">
            <p className="text-caption font-medium text-muted-foreground">{t('inviteLink')}</p>
            <div className="flex items-center gap-2">
              <Input readOnly dir="ltr" value={lastLink} />
              <Button
                type="button"
                variant="secondary"
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
