'use client';

import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { useFieldErrors } from '@/hooks/use-field-errors';
import { useFocusFirstInvalid } from '@/hooks/use-focus-first-invalid';
import { isBlankNote } from '@/lib/engagements/client-note';

// The note under an actionable hero (./changes-note.tsx): optional for an
// approval, needed for a request for changes. "Request changes" is never
// disabled for a blank note: pressing it says, under the note, that it is
// required, and moves the caret there.

const NOTE_FIELDS = ['note'] as const;

export function useChangesNote() {
  const tErrors = useTranslations('portal.errors');
  const [note, setNote] = useState('');
  const errors = useFieldErrors({ fields: NOTE_FIELDS, translate: tErrors });
  const noteRef = useRef<HTMLDivElement>(null);
  useFocusFirstInvalid(noteRef, errors.invalidAttempt);
  const noteBlank = isBlankNote(note);

  return {
    note,
    noteBlank,
    noteRef,
    noteError: errors.messageFor('note'),
    setNote(value: string) {
      errors.bind('note').onEdit();
      setNote(value);
    },
    /** True when a request for changes may be sent; otherwise says under the note what is missing. */
    readyForChanges(): boolean {
      return !errors.applyLocal(noteBlank ? { note: { code: 'required' } } : {});
    },
  };
}

export type ChangesNoteState = ReturnType<typeof useChangesNote>;
