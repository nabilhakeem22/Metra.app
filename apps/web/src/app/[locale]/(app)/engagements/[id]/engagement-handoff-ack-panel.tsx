'use client';

import type { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ActionResult } from '@/lib/actions/result';
import { recordHandoffAcknowledgement } from '@/lib/engagements/actions';
import { FormActions } from './engagement-form-actions';

// The "record handoff acknowledgement" panel of the cockpit toolbar — the staff
// stand-in for the client's own `acknowledge_handoff` token action, offered only
// while the engagement sits at design_only_handoff. Mirrors the ROM-ack panel:
// the note is optional detail tucked behind a disclosure; its value lives in the
// parent (ackNote/setAckNote) and submits as `note.trim() || null`. `after`
// closes on success.
export function HandoffAckPanel({
  t,
  th,
  pending,
  engagementId,
  ackNote,
  setAckNote,
  after,
  onCancel,
}: {
  t: ReturnType<typeof useTranslations<'engagements.controls'>>;
  th: ReturnType<typeof useTranslations<'engagements.handoffAck'>>;
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
      <p className="text-[12.5px] text-[color:var(--text-muted)]">{th('hint')}</p>
      {noteOpen ? (
        <div className="space-y-1.5">
          <Label htmlFor="handoff-ack-note">{t('note')}</Label>
          <Input
            id="handoff-ack-note"
            value={ackNote}
            onChange={(e) => setAckNote(e.target.value)}
          />
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
            recordHandoffAcknowledgement({
              engagementId,
              note: ackNote.trim() || null,
            }),
          )
        }
        saveLabel={th('submit')}
        cancelLabel={t('cancel')}
      />
    </div>
  );
}
