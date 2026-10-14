'use client';

import { useTranslations } from 'next-intl';
import { FieldErrorText, fieldErrorId } from '@/components/ui/field-error-text';
import { Textarea } from '@/components/ui/textarea';
import { CLIENT_NOTE_MAX } from '@/lib/engagements/client-note';
import type { ChangesNoteState } from './use-changes-note';

/**
 * The note under an actionable hero. Optional for an approval; a request for
 * changes needs one, so while it is blank the hint says what to write (the
 * Request changes button points at it with `aria-describedby`), and a request
 * sent without one is refused under it (./use-changes-note.ts). No text-size
 * class: the field keeps the 16 px touch size that stops iOS zooming in.
 */
export function ChangesNote({
  id,
  state,
  hintId,
  showHint,
}: {
  id: string;
  state: ChangesNoteState;
  hintId: string;
  showHint: boolean;
}) {
  const tActions = useTranslations('delivery.actions');
  const hinted = showHint && !state.noteError;
  const describedBy = [hinted ? hintId : null, state.noteError ? fieldErrorId(id) : null].filter(Boolean).join(' ');
  return (
    <div ref={state.noteRef} className="space-y-1.5">
      <Textarea
        id={id}
        value={state.note}
        onChange={(event) => state.setNote(event.target.value)}
        maxLength={CLIENT_NOTE_MAX}
        rows={2}
        dir="auto"
        aria-label={tActions('notePlaceholder')}
        aria-invalid={state.noteError ? true : undefined}
        aria-describedby={describedBy || undefined}
        placeholder={tActions('notePlaceholder')}
      />
      <FieldErrorText id={fieldErrorId(id)} message={state.noteError} />
      {hinted && (
        <p id={hintId} className="text-caption text-muted-foreground">
          {tActions('changesNeedNote')}
        </p>
      )}
    </div>
  );
}
