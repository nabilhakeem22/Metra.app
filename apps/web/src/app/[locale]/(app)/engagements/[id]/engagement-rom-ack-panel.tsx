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
  // Today in UTC, which is the calendar day the date input offers and the day the
  // server validates against.
  const today = new Date().toISOString().slice(0, 10);
  const [occurredOn, setOccurredOn] = useState('');
  const [evidence, setEvidence] = useState('');

  function save() {
    runAction(async () => {
      const res = await recordRomAcknowledgement({
        engagementId,
        note: note.trim() || null,
        occurredOn: occurredOn || null,
        evidence: evidence.trim() || null,
      });
      if (res.ok) onDone();
      return res;
    });
  }

  return (
    <div className="space-y-3 rounded-[var(--r-item)] border border-[color:var(--rule)] bg-[color:var(--track)] p-4">
      {/* THE TWO DATES, and how. `decidedAt` records when this was typed; this
          records when the client actually said it. A record dated today for a
          call last Thursday is the weakest possible evidence, and a reader six
          months from now cannot tell the difference without both. Optional --
          leaving the date blank means it happened today. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="rom-ack-occurred">{t('occurredOn')}</Label>
          <Input
            id="rom-ack-occurred"
            type="date"
            dir="ltr"
            // Nothing can have been confirmed after today; the server re-checks.
            max={today}
            value={occurredOn}
            onChange={(e) => setOccurredOn(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rom-ack-evidence">{t('evidence')}</Label>
          <Input
            id="rom-ack-evidence"
            placeholder={t('evidencePlaceholder')}
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
          />
        </div>
      </div>
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
