'use client';

import { useTranslations } from 'next-intl';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { LetteredConceptOption } from '@/lib/engagements/concept-choice';
import {
  OFFLINE_APPROVAL_CHANNELS,
  isOfflineApprovalChannel,
  type OfflineApprovalChannel,
} from '@/lib/engagements/offline-approval';
import type { OfflineApprovalField } from '@/lib/engagements/offline-approval-field-rules';
import type { OfflineApprovalBounds } from '@/lib/engagements/review-round';
import { bidiIsolate } from '@/lib/format/bidi';
import { MAX_NOTE_CHARS } from '@/lib/validation/text';

export interface OfflineApprovalTyped {
  channel: OfflineApprovalChannel | '';
  occurredOn: string;
  note: string;
  chosenArtifactId: string;
}

const SELECT_CLASS = 'h-9 w-full rounded-item border bg-background px-2 field-text';

/** The "Client approved offline" boxes. PRESENTATIONAL: the form owns state and rules. */
export function OfflineApprovalFields({
  typed,
  set,
  bounds,
  conceptOptions,
  bind,
}: {
  typed: OfflineApprovalTyped;
  set: <K extends keyof OfflineApprovalTyped>(key: K, value: OfflineApprovalTyped[K]) => void;
  bounds: OfflineApprovalBounds;
  /** The released, lettered concept options (empty hides "Which option?"). */
  conceptOptions: LetteredConceptOption[];
  bind: (field: OfflineApprovalField) => { error: string | undefined; onEdit: () => void };
}) {
  const t = useTranslations('engagements.offlineApproval');
  const tc = useTranslations('engagements.conceptOption');
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField id="offline-approval-channel" label={t('channelLabel')} required {...bind('channel')}>
          <select
            value={typed.channel}
            onChange={(event) =>
              set('channel', isOfflineApprovalChannel(event.target.value) ? event.target.value : '')
            }
            className={SELECT_CLASS}
          >
            <option value="">{t('channelPlaceholder')}</option>
            {OFFLINE_APPROVAL_CHANNELS.map((option) => (
              <option key={option} value={option}>{t(`channel.${option}`)}</option>
            ))}
          </select>
        </FormField>
        <FormField id="offline-approval-date" label={t('occurredOn')} {...bind('occurredOn')}>
          <Input
            type="date"
            dir="ltr"
            min={bounds.earliest}
            max={bounds.latest}
            value={typed.occurredOn}
            onChange={(event) => set('occurredOn', event.target.value)}
          />
        </FormField>
      </div>
      {conceptOptions.length > 0 && (
        <FormField id="offline-approval-option" label={t('whichOption')}>
          <select
            value={typed.chosenArtifactId}
            onChange={(event) => set('chosenArtifactId', event.target.value)}
            className={SELECT_CLASS}
          >
            <option value="">{t('optionUnspecified')}</option>
            {conceptOptions.map(({ id, letter }) => (
              <option key={id} value={id}>{tc('letter', { letter: bidiIsolate(letter) })}</option>
            ))}
          </select>
        </FormField>
      )}
      <FormField id="offline-approval-note" label={t('note')} {...bind('note')}>
        <Textarea
          maxLength={MAX_NOTE_CHARS}
          value={typed.note}
          onChange={(event) => set('note', event.target.value)}
        />
      </FormField>
    </>
  );
}
