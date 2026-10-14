'use client';

import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { useFieldErrors } from '@/hooks/use-field-errors';
import { useFocusFirstInvalid } from '@/hooks/use-focus-first-invalid';
import type { ActionResult } from '@/lib/actions/result';
import {
  ACKNOWLEDGEMENT_FIELDS,
  acknowledgementFieldErrors,
  type TypedAcknowledgement,
} from '@/lib/engagements/acknowledgement-field-rules';
import { FormActions } from './engagement-form-actions';
import { FormRefusal } from './form-refusal';
import type { RunAction } from './run-action';

/**
 * What the studio types when it records an acknowledgement the client gave off
 * the platform: the day, the evidence, an optional note. The ROM and handover
 * panels are this form with their own action and wording. Each refusal is said
 * under its box; the note's fold opens by itself when the note is refused.
 */
export function AcknowledgementForm({
  idPrefix,
  record,
  saveLabel,
  pending,
  runAction,
  onDone,
}: {
  /** Keeps the two panels' control ids apart. */
  idPrefix: string;
  record: (typed: TypedAcknowledgement) => Promise<ActionResult>;
  saveLabel: string;
  pending: boolean;
  runAction: RunAction;
  onDone: () => void;
}) {
  const t = useTranslations('engagements.controls');
  const te = useTranslations('errors');
  const [typed, setTyped] = useState({ occurredOn: '', evidence: '', note: '' });
  const [noteChosen, setNoteChosen] = useState(false);
  const errors = useFieldErrors({ fields: ACKNOWLEDGEMENT_FIELDS, translate: te });
  const formRef = useRef<HTMLDivElement>(null);
  useFocusFirstInvalid(formRef, errors.invalidAttempt);
  // Today in UTC, which is the calendar day the date input offers and the day the
  // server validates against.
  const today = new Date().toISOString().slice(0, 10);
  const set = (key: keyof typeof typed) => (value: string) =>
    setTyped((current) => ({ ...current, [key]: value }));

  function save() {
    if (errors.applyLocal(acknowledgementFieldErrors(typed, today))) return;
    runAction(
      async () => {
        const res = await record({
          occurredOn: typed.occurredOn || null,
          evidence: typed.evidence.trim() || null,
          note: typed.note.trim() || null,
        });
        if (res.ok) onDone();
        return res;
      },
      undefined,
      undefined,
      errors,
    );
  }

  return (
    <div ref={formRef} className="space-y-3">
      {/* THE TWO DATES, and how. `decidedAt` records when this was typed; this
          records when the client actually said it. A record dated today for a
          call last Thursday is the weakest possible evidence, and a reader six
          months from now cannot tell the difference without both. Optional --
          leaving the date blank means it happened today. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField id={`${idPrefix}-occurred`} label={t('occurredOn')} {...errors.bind('occurredOn')}>
          <Input
            type="date"
            dir="ltr"
            max={today}
            value={typed.occurredOn}
            onChange={(e) => set('occurredOn')(e.target.value)}
          />
        </FormField>
        <FormField id={`${idPrefix}-evidence`} label={t('evidence')} {...errors.bind('evidence')}>
          <Input
            placeholder={t('evidencePlaceholder')}
            value={typed.evidence}
            onChange={(e) => set('evidence')(e.target.value)}
          />
        </FormField>
      </div>
      {noteChosen || errors.messageFor('note') ? (
        <FormField id={`${idPrefix}-note`} label={t('note')} {...errors.bind('note')}>
          <Input value={typed.note} onChange={(e) => set('note')(e.target.value)} />
        </FormField>
      ) : (
        <button
          type="button"
          onClick={() => setNoteChosen(true)}
          className="text-small font-semibold text-brand-ink hover:underline"
        >
          + {t('addNote')}
        </button>
      )}
      <FormRefusal message={errors.formError} />
      <FormActions
        pending={pending}
        onCancel={onDone}
        onSave={save}
        saveLabel={saveLabel}
        cancelLabel={t('cancel')}
      />
    </div>
  );
}
