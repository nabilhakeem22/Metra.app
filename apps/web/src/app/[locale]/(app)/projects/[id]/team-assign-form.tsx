'use client';

import { Loader2, UserPlus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { SelectControl, type SelectControlOption } from '@/components/ui/select-control';
import { useFocusFirstInvalid } from '@/hooks/use-focus-first-invalid';
import { siteTeamMemberLabel } from './site-team-label';
import { useSiteTeamCandidates } from './use-site-team-candidates';
import { useTeamAssignForm } from './use-team-assign-form';

/**
 * Add a studio member to the project's site team. The members are asked of
 * the server only once the manager reaches the form (a focus or a press inside
 * it), a page at a time, narrowed by what he types. Add stays enabled:
 * pressing it with no member chosen says so under the box.
 */
export function TeamAssignForm({ projectId, teamKey }: { projectId: string; teamKey: string }) {
  const t = useTranslations('projects.profile.team');
  const tTeam = useTranslations('team');
  const roles = useTranslations('roles');
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(false);
  const candidates = useSiteTeamCandidates(projectId, query, active, teamKey);
  const form = useTeamAssignForm(projectId, candidates.drop);
  const fieldsRef = useRef<HTMLDivElement>(null);
  useFocusFirstInvalid(fieldsRef, form.errors.invalidAttempt);
  const activate = () => setActive(true);

  const found: SelectControlOption[] = candidates.candidates.map((person) => ({
    value: person.userId,
    label: `${siteTeamMemberLabel(person, tTeam('unknownUser'))} · ${roles(`${person.role}.label`)}`,
  }));
  const { picked } = form;
  const options =
    picked && !found.some((option) => option.value === picked.userId) ? [{ value: picked.userId, label: picked.label }, ...found] : found;
  const pick = (userId: string) => form.setPicked({ userId, label: options.find((option) => option.value === userId)?.label ?? '' });

  return (
    <div className="space-y-2">
      <div ref={fieldsRef} className="flex flex-col gap-3 sm:flex-row sm:items-start" onFocus={activate} onPointerDown={activate}>
        <div className="sm:w-56">
          <FormField id="siteTeamFind" label={t('findLabel')} hint={t('findHint')}>
            <Input type="search" autoComplete="off" value={query} onChange={(event) => setQuery(event.target.value)} />
          </FormField>
        </div>
        <div className="min-w-0 flex-1">
          <FormField id="siteTeamMember" label={t('memberLabel')} hint={t('memberHint')} {...form.errors.bind('userId')}>
            <SelectControl value={picked?.userId ?? ''} onValueChange={pick} options={options} placeholder={t('memberPlaceholder')} />
          </FormField>
        </div>
        <Button
          variant="default"
          className="aria-disabled:opacity-60 sm:mt-7"
          onClick={form.assign}
          aria-disabled={form.assigning}
        >
          {form.assigning ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <UserPlus className="size-4" aria-hidden />}
          {t('assign')}
        </Button>
      </div>
      <CandidatesStatus candidates={candidates} query={query} />
      {form.errors.formError && (
        <p className="text-body text-destructive" role="alert">
          {form.errors.formError}
        </p>
      )}
    </div>
  );
}

/** What the picker has: loading, a failure, nobody to add, no match, or "more". */
function CandidatesStatus({ candidates, query }: { candidates: ReturnType<typeof useSiteTeamCandidates>; query: string }) {
  const t = useTranslations('projects.profile.team');
  const nobody = candidates.answered && !candidates.hasMore && candidates.failure === null && candidates.candidates.length === 0;
  const line = candidates.loading
    ? t('candidatesLoading')
    : (candidates.failure ?? (nobody ? t(query.trim() === '' ? 'noCandidates' : 'noMatches') : null));

  return (
    <div className="flex flex-wrap items-center gap-2">
      <p role="status" className={candidates.failure ? 'text-caption text-destructive' : 'text-caption text-muted-foreground'}>
        {line}
      </p>
      {candidates.hasMore && (
        <Button size="sm" variant="secondary" onClick={candidates.loadMore} aria-disabled={candidates.loadingMore} className="aria-disabled:opacity-60">
          {candidates.loadingMore && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {t('moreCandidates')}
        </Button>
      )}
    </div>
  );
}
