'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ActionResult } from '@/lib/actions/result';
import { setEngagementRom } from '@/lib/engagements/actions';
import { FormActions } from './engagement-form-actions';

/**
 * Set the indicative build-cost range — the non-binding bracket the client must
 * acknowledge before shop drawings unlock.
 *
 * RENAMED from `RomPanel`, which collided with the DISPLAY panel of the same name
 * in `engagement-panels-rom.tsx`: one showed the range, one edited it, and only
 * the import path told you which. This is the form.
 *
 * It sits with the range it writes, NOT in the Payments header. Build cost is not
 * the design fee — the schema keeps `romLow`/`romHigh` apart from `designFee`
 * deliberately, and putting both actions on one shelf would quietly re-merge in
 * the UI what the data model separates.
 */
export function RomRangeForm({
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
  const [low, setLow] = useState('');
  const [high, setHigh] = useState('');

  function save() {
    runAction(async () => {
      const res = await setEngagementRom({
        engagementId,
        romLow: low.trim(),
        romHigh: high.trim(),
      });
      if (res.ok) onDone();
      return res;
    });
  }

  return (
    <div className="space-y-3 rounded-[var(--r-item)] border border-[color:var(--rule)] bg-[color:var(--track)] p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="rom-low">{t('low')}</Label>
          <Input
            id="rom-low"
            dir="ltr"
            inputMode="decimal"
            className="tabular-nums"
            value={low}
            onChange={(e) => setLow(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rom-high">{t('high')}</Label>
          <Input
            id="rom-high"
            dir="ltr"
            inputMode="decimal"
            className="tabular-nums"
            value={high}
            onChange={(e) => setHigh(e.target.value)}
          />
        </div>
      </div>
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
