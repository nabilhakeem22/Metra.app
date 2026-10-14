'use client';

import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import type { MilestoneBasis, MilestoneKind } from '@metra/db';
import { FieldErrorText, fieldErrorId } from '@/components/ui/field-error-text';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { SelectControl } from '@/components/ui/select-control';
import { useFieldErrors } from '@/hooks/use-field-errors';
import { useFocusFirstInvalid } from '@/hooks/use-focus-first-invalid';
import type { ActionResult } from '@/lib/actions/result';
import { submitDesignFee } from '@/lib/engagements/actions';
import {
  DEFAULT_MILESTONE_KINDS,
  byDueOrder,
  type FeeSplitPrefill,
} from '@/lib/engagements/default-fee-split';
import { feeSplitFieldErrors, summarizeFeeSplit } from '@/lib/engagements/fee-split-total';
import { FormActions } from './engagement-form-actions';
import { FeeSplitRows, type FeeSplitRow } from './fee-split-rows';
import { FeeSplitTotal } from './fee-split-total-line';
import { FormRefusal } from './form-refusal';
import type { RefusalSink } from './run-action';

// Enum values declared locally (typed by the type-only @metra/db import) — a
// client component must never import a runtime @metra/db value.
const MILESTONE_BASES: MilestoneBasis[] = ['percent', 'amount'];

const FEE_FIELDS = ['designFee', 'milestones'] as const;
const SPLIT_ID = 'fee-milestones';

/**
 * The design fee and its payment split. Opens on the studio's LAST split (in
 * percent) or 50/30/20 and shows a live total. Submit is never disabled to say
 * "not yet": pressing it says under the fee or under the split what the server
 * would refuse (a fee, a deposit, and 100%, or the fee on the amount basis).
 */
export function EngagementFeeForm({
  engagementId,
  prefill,
  pending,
  onSubmit,
  onCancel,
}: {
  engagementId: string;
  /** The opening split; null opens the three default rows empty. */
  prefill: FeeSplitPrefill | null;
  pending: boolean;
  onSubmit: (fn: () => Promise<ActionResult>, form: RefusalSink) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('engagements.feeForm');
  const tc = useTranslations('engagements.controls');
  const tb = useTranslations('engagements.milestoneBasis');
  const te = useTranslations('errors');
  const [designFee, setDesignFee] = useState('');
  const [basis, setBasis] = useState<MilestoneBasis>('percent');
  const [rows, setRows] = useState<FeeSplitRow[]>(
    () => prefill?.rows ?? DEFAULT_MILESTONE_KINDS.map((kind) => ({ kind, value: '' })),
  );
  const summary = summarizeFeeSplit({ basis, designFee, rows });
  const errors = useFieldErrors({ fields: FEE_FIELDS, translate: te });
  const formRef = useRef<HTMLDivElement>(null);
  useFocusFirstInvalid(formRef, errors.invalidAttempt);
  const splitRefusal = errors.messageFor('milestones');
  const clearSplit = errors.bind('milestones').onEdit;

  const setRow = (index: number, value: string) => {
    clearSplit();
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, value } : row)));
  };
  /** Add one optional milestone, kept in due order rather than click order. */
  const addRow = (kind: MilestoneKind) =>
    setRows((prev) => [...prev, { kind, value: '' }].sort((a, b) => byDueOrder(a.kind, b.kind)));
  const removeRow = (kind: MilestoneKind) =>
    setRows((prev) => prev.filter((row) => row.kind !== kind));

  function submit() {
    if (errors.applyLocal(feeSplitFieldErrors(summary))) return;
    const milestones = rows
      .filter((row) => row.value.trim() !== '')
      .map((row) => ({ kind: row.kind, basis, value: row.value.trim() }));
    onSubmit(() => submitDesignFee(engagementId, { designFee: designFee.trim(), milestones }), errors);
  }

  return (
    // Flat tray (opaque --track fill, no .glass) so opening the fee form inside
    // the glass "next actions" Card never nests backdrop-filter.
    <div
      ref={formRef}
      className="space-y-4 rounded-item border border-[color:var(--rule)] bg-[color:var(--track)] p-4"
    >
      <p className="text-body font-medium">{t('title')}</p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField id="fee-amount" label={t('designFee')} required {...errors.bind('designFee')}>
          <Input
            dir="ltr"
            inputMode="decimal"
            className="tabular-nums"
            value={designFee}
            onChange={(event) => setDesignFee(event.target.value)}
          />
        </FormField>
        <FormField id="fee-basis" label={t('basis')} onEdit={clearSplit}>
          <SelectControl
            value={basis}
            onValueChange={(value) => setBasis(value as MilestoneBasis)}
            options={MILESTONE_BASES.map((option) => ({ value: option, label: tb(option) }))}
          />
        </FormField>
      </div>

      {prefill?.source === 'lastUsed' && (
        <p className="text-caption text-muted-foreground">{t('prefilledFromLast')}</p>
      )}
      <FeeSplitRows
        rows={rows}
        onChange={setRow}
        onAdd={addRow}
        onRemove={removeRow}
        errorId={splitRefusal ? fieldErrorId(SPLIT_ID) : undefined}
      />

      <FeeSplitTotal basis={basis} summary={summary} />
      <FieldErrorText id={fieldErrorId(SPLIT_ID)} message={splitRefusal} />
      <FormRefusal message={errors.formError} />

      <FormActions
        pending={pending}
        onCancel={onCancel}
        onSave={submit}
        saveLabel={t('submit')}
        cancelLabel={tc('cancel')}
      />
    </div>
  );
}
