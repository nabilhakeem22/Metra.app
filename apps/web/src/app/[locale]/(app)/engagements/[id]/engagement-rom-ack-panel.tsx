'use client';

import type { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ActionResult } from '@/lib/actions/result';
import { recordRomAcknowledgement } from '@/lib/engagements/actions';
import { FormActions } from './engagement-form-actions';

// The "record ROM acknowledgement" panel of the cockpit toolbar. The note is
// optional detail tucked behind a disclosure (the acknowledgement itself needs no
// text); its value still lives in the parent (ackNote/setAckNote) and submits as
// `note.trim() || null` unchanged. `after` closes on success.
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
  const [noteOpen, setNoteOpen] = useState(false);
  return (
    <div className="space-y-3 rounded-[var(--r-item)] border border-[color:var(--rule)] bg-[color:var(--track)] p-4">
      {noteOpen ? (
        <div className="space-y-1.5">
          <Label htmlFor="ack-note">{t('note')}</Label>
          <Input id="ack-note" value={ackNote} onChange={(e) => setAckNote(e.target.value)} />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setNoteOpen(true)}
          className="text-[12.5px] font-semibold text-brand-ink hover:underline"
        >
          + {t('addNote')}
        </button>
      )}
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
