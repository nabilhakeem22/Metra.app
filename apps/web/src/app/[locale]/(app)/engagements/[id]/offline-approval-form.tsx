'use client';

import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { useFieldErrors } from '@/hooks/use-field-errors';
import { useFocusFirstInvalid } from '@/hooks/use-focus-first-invalid';
import { recordOfflineConceptApproval, recordOfflineDesignApproval } from '@/lib/engagements/actions';
import type { LetteredConceptOption } from '@/lib/engagements/concept-choice';
import {
  OFFLINE_APPROVAL_FIELDS,
  offlineApprovalFieldErrors,
} from '@/lib/engagements/offline-approval-field-rules';
import { offlineApprovalBounds } from '@/lib/engagements/review-round';
import { FormActions } from './engagement-form-actions';
import { FormRefusal } from './form-refusal';
import { OfflineApprovalFields, type OfflineApprovalTyped } from './offline-approval-fields';
import type { RunAction } from './use-engagement-action';

/** The two review edges an offline approval can fire, and the action for each. */
const OFFLINE_APPROVAL_ACTIONS = {
  selectConcept: recordOfflineConceptApproval,
  approveDesign: recordOfflineDesignApproval,
} as const;

export type OfflineApprovalTrigger = keyof typeof OFFLINE_APPROVAL_ACTIONS;

export function isOfflineApprovalTrigger(trigger: string | null): trigger is OfflineApprovalTrigger {
  return trigger !== null && Object.hasOwn(OFFLINE_APPROVAL_ACTIONS, trigger);
}

const EMPTY: OfflineApprovalTyped = { channel: '', occurredOn: '', note: '', chosenArtifactId: '' };

/**
 * "Client approved offline": HOW the client approved (required), WHEN when not
 * today (within the round, by Cairo day), an optional capped note and, at the
 * concept review, WHICH released option they chose (optional; only a lettered
 * option can be named, owner decision Q1). Saving fires the same transition as
 * Advance, so every guard still runs; Cancel fires nothing. Save is never
 * disabled: pressing it with no channel says so under the channel.
 */
export function OfflineApprovalForm({
  engagementId,
  trigger,
  reviewRoundStartedAt,
  conceptOptions,
  pending,
  runAction,
  onCancel,
}: {
  engagementId: string;
  trigger: OfflineApprovalTrigger;
  /** When the review round under answer began (ISO): the earliest day allowed. */
  reviewRoundStartedAt: string;
  /** The released, lettered concept options (empty hides "Which option?"). */
  conceptOptions: LetteredConceptOption[];
  pending: boolean;
  runAction: RunAction;
  onCancel: () => void;
}) {
  const t = useTranslations('engagements.offlineApproval');
  const te = useTranslations('errors');
  const [typed, setTyped] = useState<OfflineApprovalTyped>(EMPTY);
  const errors = useFieldErrors({ fields: OFFLINE_APPROVAL_FIELDS, translate: te });
  const formRef = useRef<HTMLDivElement>(null);
  useFocusFirstInvalid(formRef, errors.invalidAttempt);
  const offersOptions = trigger === 'selectConcept' && conceptOptions.length > 0;
  // The same Cairo days the server enforces: not before the round, not after today.
  const bounds = offlineApprovalBounds(new Date(reviewRoundStartedAt), new Date());
  const set = <K extends keyof OfflineApprovalTyped>(key: K, value: OfflineApprovalTyped[K]) =>
    setTyped((current) => ({ ...current, [key]: value }));

  function save() {
    if (errors.applyLocal(offlineApprovalFieldErrors(typed, bounds)) || typed.channel === '') return;
    const record = OFFLINE_APPROVAL_ACTIONS[trigger];
    const approval = {
      channel: typed.channel,
      occurredOn: typed.occurredOn || null,
      note: typed.note.trim() || null,
      chosenArtifactId: offersOptions && typed.chosenArtifactId ? typed.chosenArtifactId : null,
    };
    runAction(() => record(engagementId, approval), undefined, undefined, errors);
  }

  return (
    <div
      ref={formRef}
      className="mt-3 space-y-3 rounded-item border border-[color:var(--rule)] bg-[color:var(--track)] p-4"
    >
      <p className="text-small text-[color:var(--text-muted)]">{t('formHint')}</p>
      <OfflineApprovalFields
        typed={typed}
        set={set}
        bounds={bounds}
        conceptOptions={offersOptions ? conceptOptions : []}
        bind={errors.bind}
      />
      <FormRefusal message={errors.formError} />
      <FormActions
        pending={pending}
        onCancel={onCancel}
        onSave={save}
        saveLabel={t('save')}
        cancelLabel={t('cancel')}
      />
    </div>
  );
}
