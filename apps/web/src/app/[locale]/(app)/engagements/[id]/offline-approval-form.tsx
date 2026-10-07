'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { recordOfflineConceptApproval, recordOfflineDesignApproval } from '@/lib/engagements/actions';
import type { LetteredConceptOption } from '@/lib/engagements/concept-choice';
import {
  OFFLINE_APPROVAL_CHANNELS,
  isOfflineApprovalChannel,
  type OfflineApprovalChannel,
} from '@/lib/engagements/offline-approval';
import { offlineApprovalBounds } from '@/lib/engagements/review-round';
import { bidiIsolate } from '@/lib/format/bidi';
import { MAX_NOTE_CHARS } from '@/lib/validation/text';
import { FormActions } from './engagement-form-actions';
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

/**
 * "Client approved offline": HOW the client approved (required), WHEN when not
 * today (within the round, by Cairo day), an optional capped note and, at the
 * concept review, WHICH released option they chose (optional; only a lettered
 * option can be named, owner decision Q1). Saving fires the same transition as
 * Advance, so every guard still runs; Cancel fires nothing.
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
  const tc = useTranslations('engagements.conceptOption');
  const [channel, setChannel] = useState<OfflineApprovalChannel | ''>('');
  const [occurredOn, setOccurredOn] = useState('');
  const [note, setNote] = useState('');
  const [chosenArtifactId, setChosenArtifactId] = useState('');
  const offersOptions = trigger === 'selectConcept' && conceptOptions.length > 0;
  // The same Cairo days the server enforces: not before the round, not after today.
  const bounds = offlineApprovalBounds(new Date(reviewRoundStartedAt), new Date());

  function save() {
    if (channel === '') return;
    const record = OFFLINE_APPROVAL_ACTIONS[trigger];
    runAction(() =>
      record(engagementId, {
        channel,
        occurredOn: occurredOn || null,
        note: note.trim() || null,
        chosenArtifactId: offersOptions && chosenArtifactId ? chosenArtifactId : null,
      }),
    );
  }

  return (
    <div className="mt-3 space-y-3 rounded-item border border-[color:var(--rule)] bg-[color:var(--track)] p-4">
      <p className="text-small text-[color:var(--text-muted)]">{t('formHint')}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="offline-approval-channel">{t('channelLabel')}</Label>
          <select
            id="offline-approval-channel"
            value={channel}
            onChange={(event) =>
              setChannel(isOfflineApprovalChannel(event.target.value) ? event.target.value : '')
            }
            className="h-9 w-full rounded-item border bg-background px-2 field-text"
          >
            <option value="">{t('channelPlaceholder')}</option>
            {OFFLINE_APPROVAL_CHANNELS.map((option) => (
              <option key={option} value={option}>{t(`channel.${option}`)}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="offline-approval-date">{t('occurredOn')}</Label>
          <Input
            id="offline-approval-date"
            type="date"
            dir="ltr"
            min={bounds.earliest}
            max={bounds.latest}
            value={occurredOn}
            onChange={(event) => setOccurredOn(event.target.value)}
          />
        </div>
      </div>
      {offersOptions && (
        <div className="space-y-1.5">
          <Label htmlFor="offline-approval-option">{t('whichOption')}</Label>
          <select
            id="offline-approval-option"
            value={chosenArtifactId}
            onChange={(event) => setChosenArtifactId(event.target.value)}
            className="h-9 w-full rounded-item border bg-background px-2 field-text"
          >
            <option value="">{t('optionUnspecified')}</option>
            {conceptOptions.map(({ id, letter }) => (
              <option key={id} value={id}>{tc('letter', { letter: bidiIsolate(letter) })}</option>
            ))}
          </select>
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="offline-approval-note">{t('note')}</Label>
        <Textarea
          id="offline-approval-note"
          maxLength={MAX_NOTE_CHARS}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>
      <FormActions
        pending={pending}
        onCancel={onCancel}
        onSave={save}
        saveLabel={t('save')}
        cancelLabel={t('cancel')}
        saveDisabled={channel === ''}
      />
    </div>
  );
}
