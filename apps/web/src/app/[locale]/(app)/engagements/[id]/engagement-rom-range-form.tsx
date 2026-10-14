'use client';

import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { useFieldErrors } from '@/hooks/use-field-errors';
import { useFocusFirstInvalid } from '@/hooks/use-focus-first-invalid';
import { setEngagementRom } from '@/lib/engagements/actions';
import { ROM_FIELDS, romFieldErrors } from '@/lib/engagements/rom-field-rules';
import { FormActions } from './engagement-form-actions';
import { FormRefusal } from './form-refusal';
import type { RunAction } from './run-action';

/**
 * Set the indicative build-cost range — the non-binding bracket the client must
 * acknowledge before shop drawings unlock.
 *
 * RENAMED from `RomPanel`, which collided with a DISPLAY panel of the same name:
 * one showed the range, one edited it, and only the import path told you which.
 * The display half has since been absorbed into the Budget tab, which shows the
 * current band over the history of every band before it.
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
  runAction: RunAction;
  onDone: () => void;
}) {
  const t = useTranslations('engagements.controls');
  const [low, setLow] = useState('');
  const [high, setHigh] = useState('');
  const te = useTranslations('errors');
  const errors = useFieldErrors({ fields: ROM_FIELDS, translate: te });
  const formRef = useRef<HTMLDivElement>(null);
  useFocusFirstInvalid(formRef, errors.invalidAttempt);

  function save() {
    const range = { romLow: low.trim(), romHigh: high.trim() };
    if (errors.applyLocal(romFieldErrors(range))) return;
    runAction(
      async () => {
        const res = await setEngagementRom({ engagementId, ...range });
        if (res.ok) onDone();
        return res;
      },
      undefined,
      undefined,
      errors,
    );
  }

  const amount = (value: string, onChange: (value: string) => void) => (
    <Input
      dir="ltr"
      inputMode="decimal"
      className="tabular-nums"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );

  return (
    <div
      ref={formRef}
      className="space-y-3 rounded-item border border-[color:var(--rule)] bg-[color:var(--track)] p-4"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField id="rom-low" label={t('low')} required {...errors.bind('romLow')}>
          {amount(low, setLow)}
        </FormField>
        <FormField id="rom-high" label={t('high')} required {...errors.bind('romHigh')}>
          {amount(high, setHigh)}
        </FormField>
      </div>
      <FormRefusal message={errors.formError} />
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
