'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { FormSheet } from '@/components/ui/form-sheet';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useFieldErrors } from '@/hooks/use-field-errors';
import { useRouter } from '@/i18n/routing';
import { todayInCairo } from '@/lib/automation/clock';
import { recordVariationDecisionOnPaper } from '@/lib/variations/actions';
import {
  PAPER_DECISIONS,
  PAPER_DECISION_FIELDS,
  paperDecisionFieldErrors,
  type PaperDecision,
  type PaperDecisionField,
} from '@/lib/variations/decide-on-paper-input';

/** The DOM id of a box of the dialog: its refusal sits under it. */
export const variationPaperControlId = (field: PaperDecisionField) => `variation-paper-${field}`;

/**
 * "The client answered on paper" (H7.3): the studio records the client's
 * approval or rejection of an issued change order, given outside Metra, the day
 * it was given and a note. Offered to owner, admin and project manager only;
 * the server checks again. No answer is picked in advance: a slip must never
 * approve. The day may not be after today in Cairo; each refusal is said under
 * its box, one of the order itself (answered online meanwhile) above the footer.
 */
export function VariationPaperDialog({ variationOrderId, number }: { variationOrderId: string; number: string }) {
  const t = useTranslations('variations.paper');
  const tc = useTranslations('common');
  const te = useTranslations('errors');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const today = todayInCairo(new Date());
  const [decision, setDecision] = useState<PaperDecision | null>(null);
  const [decidedOn, setDecidedOn] = useState(today);
  const [note, setNote] = useState('');
  const [pending, startTransition] = useTransition();
  const errors = useFieldErrors({ fields: PAPER_DECISION_FIELDS, translate: te });

  function submit() {
    if (errors.applyLocal(paperDecisionFieldErrors({ decision, decidedOn, note }, today))) return;
    startTransition(async () => {
      try {
        const res = await recordVariationDecisionOnPaper({ variationOrderId, decision, decidedOn, note });
        if (errors.applyResult(res)) return;
        setOpen(false);
        router.refresh();
      } catch (rejection) {
        errors.applyRejection(rejection);
      }
    });
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        {t('open')}
      </Button>
      <FormSheet
        open={open}
        onOpenChange={setOpen}
        title={t('title')}
        description={t('description', { number })}
        onSubmit={submit}
        submitLabel={t('submit')}
        cancelLabel={tc('cancel')}
        closeLabel={tc('close')}
        pending={pending}
        formError={errors.formError}
        invalidAttempt={errors.invalidAttempt}
      >
        <FormField id={variationPaperControlId('decision')} label={t('decision')} required {...errors.bind('decision')}>
          <div role="radiogroup" aria-label={t('decision')} tabIndex={-1} className="flex flex-wrap gap-x-6 gap-y-2 rounded-item">
            {PAPER_DECISIONS.map((option) => (
              <label key={option} className="flex items-center gap-2 text-body">
                <input
                  type="radio"
                  name="variation-paper-decision"
                  value={option}
                  checked={decision === option}
                  onChange={() => setDecision(option)}
                />
                {t(option)}
              </label>
            ))}
          </div>
        </FormField>
        <FormField id={variationPaperControlId('decidedOn')} label={t('decidedOn')} required {...errors.bind('decidedOn')}>
          <Input type="date" dir="ltr" max={today} value={decidedOn} onChange={(event) => setDecidedOn(event.target.value)} />
        </FormField>
        <FormField id={variationPaperControlId('note')} label={t('note')} {...errors.bind('note')}>
          <Textarea value={note} onChange={(event) => setNote(event.target.value)} />
        </FormField>
      </FormSheet>
    </>
  );
}
