'use client';

import type { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ActionResult } from '@/lib/actions/result';
import { recordRomAcknowledgement } from '@/lib/engagements/actions';
import { FormActions } from './engagement-form-actions';

// The "record ROM acknowledgement" panel of EngagementControls. All state lives
// in the parent and arrives via props (verbatim JSX); `after` closes on success.
export function RomAckPanel({
  t,
  pending,
  engagementId,
  ackNote,
  setAckNote,
  after,
  onCancel,
}: {
  t: ReturnType<typeof useTranslations<'engagements.controls'>>;
  pending: boolean;
  engagementId: string;
  ackNote: string;
  setAckNote: (value: string) => void;
  after: (fn: () => Promise<ActionResult>) => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="space-y-1">
        <Label htmlFor="ack-note">{t('note')}</Label>
        <Input id="ack-note" value={ackNote} onChange={(e) => setAckNote(e.target.value)} />
      </div>
      <FormActions
        pending={pending}
        onCancel={onCancel}
        onSave={() =>
          after(() =>
            recordRomAcknowledgement({
              engagementId,
              note: ackNote.trim() || null,
            }),
          )
        }
        saveLabel={t('save')}
        cancelLabel={t('cancel')}
      />
    </div>
  );
}
