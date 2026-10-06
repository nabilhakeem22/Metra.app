'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  recordOfflineConceptApproval,
  recordOfflineDesignApproval,
} from '@/lib/engagements/actions';
import {
  OFFLINE_APPROVAL_CHANNELS,
  isOfflineApprovalChannel,
  type OfflineApprovalChannel,
} from '@/lib/engagements/offline-approval';
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
 * "Client approved offline": HOW the client approved (required), WHEN when it
 * was not today, and an optional note. Saving fires the same transition as
 * Advance, so every guard still runs; Cancel fires nothing.
 */
export function OfflineApprovalForm({
  engagementId,
  trigger,
  pending,
  runAction,
  onCancel,
}: {
  engagementId: string;
  trigger: OfflineApprovalTrigger;
  pending: boolean;
  runAction: RunAction;
  onCancel: () => void;
}) {
  const t = useTranslations('engagements.offlineApproval');
  const [channel, setChannel] = useState<OfflineApprovalChannel | ''>('');
  const [occurredOn, setOccurredOn] = useState('');
  const [note, setNote] = useState('');
  // Today in UTC: the calendar day the server validates against.
  const today = new Date().toISOString().slice(0, 10);

  function save() {
    if (channel === '') return;
    const record = OFFLINE_APPROVAL_ACTIONS[trigger];
    runAction(() =>
      record(engagementId, {
        channel,
        occurredOn: occurredOn || null,
        note: note.trim() || null,
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
              <option key={option} value={option}>
                {t(`channel.${option}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="offline-approval-date">{t('occurredOn')}</Label>
          <Input
            id="offline-approval-date"
            type="date"
            dir="ltr"
            max={today}
            value={occurredOn}
            onChange={(event) => setOccurredOn(event.target.value)}
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="offline-approval-note">{t('note')}</Label>
        <Textarea
          id="offline-approval-note"
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
