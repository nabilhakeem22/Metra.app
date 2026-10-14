'use client';

import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { FieldErrorText, fieldErrorId } from '@/components/ui/field-error-text';
import { Textarea } from '@/components/ui/textarea';
import { useFieldErrors } from '@/hooks/use-field-errors';
import { useFocusFirstInvalid } from '@/hooks/use-focus-first-invalid';
import { useRouter } from '@/i18n/routing';
import { addActivity } from '@/lib/activities/actions';
import { ACTIVITY_FIELDS, activityNoteErrors } from '@/lib/activities/field-rules';

/** The id of the note box; its refusal sits under it. */
export const ACTIVITY_NOTE_ID = 'activity-note';

/**
 * Add a note to a client's or a project's log. Add is never disabled to say
 * "not yet": pressing it on an empty box asks for text under the box. The box
 * is labelled by `addLabel` (no visible label, as before).
 */
export function ActivityNoteForm({
  entityType,
  entityId,
  placeholder,
  addLabel,
}: {
  entityType: 'client' | 'project';
  entityId: string;
  placeholder: string;
  addLabel: string;
}) {
  const te = useTranslations('errors');
  const router = useRouter();
  const [note, setNote] = useState('');
  const [pending, startTransition] = useTransition();
  const errors = useFieldErrors({ fields: ACTIVITY_FIELDS, translate: te });
  const refusal = errors.bind('note');
  const formRef = useRef<HTMLDivElement>(null);
  useFocusFirstInvalid(formRef, errors.invalidAttempt);

  function add() {
    if (errors.applyLocal(activityNoteErrors(note))) return;
    startTransition(async () => {
      try {
        const result = await addActivity({ entityType, entityId, note });
        if (errors.applyResult(result)) return;
        setNote('');
        router.refresh();
      } catch (rejection) {
        errors.applyRejection(rejection);
      }
    });
  }

  return (
    <Card>
      <CardContent ref={formRef} className="space-y-2 py-4">
        <Textarea
          id={ACTIVITY_NOTE_ID}
          value={note}
          onChange={(e) => {
            refusal.onEdit();
            setNote(e.target.value);
          }}
          placeholder={placeholder}
          rows={3}
          dir="auto"
          aria-label={addLabel}
          aria-invalid={refusal.error ? true : undefined}
          aria-describedby={refusal.error ? fieldErrorId(ACTIVITY_NOTE_ID) : undefined}
        />
        <FieldErrorText id={fieldErrorId(ACTIVITY_NOTE_ID)} message={refusal.error} />
        {errors.formError && (
          <p className="text-body text-destructive" role="alert">
            {errors.formError}
          </p>
        )}
        <div className="flex justify-end">
          <Button variant="default" type="button" onClick={add} disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {addLabel}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
