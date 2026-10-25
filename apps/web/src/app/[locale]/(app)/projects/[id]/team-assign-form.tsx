'use client';

import { Loader2, UserPlus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { SelectControl } from '@/components/ui/select-control';
import { useFocusFirstInvalid } from '@/hooks/use-focus-first-invalid';
import { siteTeamMemberLabel } from './site-team-label';
import type { SiteTeamMember } from './team-tab-types';
import { useTeamAssignForm } from './use-team-assign-form';

/** Add a studio member to the project's site team. Add stays enabled: pressing it with no member chosen says so under the box. */
export function TeamAssignForm({ projectId, candidates }: { projectId: string; candidates: SiteTeamMember[] }) {
  const t = useTranslations('projects.profile.team');
  const tTeam = useTranslations('team');
  const roles = useTranslations('roles');
  const form = useTeamAssignForm(projectId);
  const fieldsRef = useRef<HTMLDivElement>(null);
  useFocusFirstInvalid(fieldsRef, form.errors.invalidAttempt);

  if (candidates.length === 0) return <p className="text-body text-muted-foreground">{t('noCandidates')}</p>;

  const options = candidates.map((member) => ({
    value: member.userId,
    label: `${siteTeamMemberLabel(member, tTeam('unknownUser'))} · ${roles(`${member.role}.label`)}`,
  }));

  return (
    <div className="space-y-2">
      <div ref={fieldsRef} className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <FormField id="siteTeamMember" label={t('memberLabel')} hint={t('memberHint')} {...form.errors.bind('userId')}>
            <SelectControl
              value={form.userId}
              onValueChange={form.setUserId}
              options={options}
              placeholder={t('memberPlaceholder')}
              disabled={form.assigning}
            />
          </FormField>
        </div>
        <Button variant="default" className="sm:mt-7" onClick={form.assign} disabled={form.assigning}>
          {form.assigning ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <UserPlus className="size-4" aria-hidden />}
          {t('assign')}
        </Button>
      </div>
      {form.errors.formError && (
        <p className="text-body text-destructive" role="alert">
          {form.errors.formError}
        </p>
      )}
    </div>
  );
}
