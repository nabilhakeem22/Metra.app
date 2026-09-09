'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ActionResult } from '@/lib/actions/result';
import { recordRomAcknowledgement } from '@/lib/engagements/actions';
import { FormActions } from './engagement-form-actions';

/**
 * Record the client's cost-range acknowledgement ON THEIR BEHALF — for one they
 * gave on a call, in a message, or on paper.
 *
 * This is the only action in the cockpit that asserts SOMEBODY ELSE acted, which
 * is why it lives in the Timeline header rather than beside "attach a drawing",
 * and why its trigger is drawn as a warning rather than a button like any other.
 * It owns its own note (see the artifact panel for why the lifted-state era
 * ended).
 */
export function RomAckPanel({
  engagementId,
  pending,
  runAction,
  onDone,
}: {
  engagementId: string;
  pending: boolean;
  runAction: (fn: () => Promise<ActionResult>) => void;
  onDone: () => void;
}) {
  const t = useTranslations('engagements.controls');
  const [note, setNote] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);

  function save() {
    runAction(async () => {
      const res = await recordRomAcknowledgement({
        engagementId,
        note: note.trim() || null,
      });
      if (res.ok) onDone();
      return res;
    });
  }

  return (
    <div className="space-y-3 rounded-[var(--r-item)] border border-[color:var(--rule)] bg-[color:var(--track)] p-4">
      {noteOpen ? (
        <div className="space-y-1.5">
          <Label htmlFor="ack-note">{t('note')}</Label>
          <Input id="ack-note" value={note} onChange={(e) => setNote(e.target.value)} />
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
        onCancel={onDone}
        onSave={save}
        saveLabel={t('save')}
        cancelLabel={t('cancel')}
      />
    </div>
  );
}
