'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState, useTransition } from 'react';
import { FormField } from '@/components/ui/form-field';
import { FormSheet } from '@/components/ui/form-sheet';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useFieldErrors } from '@/hooks/use-field-errors';
import { todayInCairo } from '@/lib/automation/clock';
import { recordMeasurement } from '@/lib/execution/measurements/actions';
import {
  isFarBeyondContractQty,
  MEASUREMENT_FIELDS,
  measurementFieldErrors,
  readMeasurement,
  type CleanMeasurement,
  type MeasurementField,
} from '@/lib/execution/measurements/input';
import { readNonNegativeExactFigure } from '@/lib/validation/amount-field';
import { normalizeDecimalInput } from '@/lib/validation/decimal-input';
import { formatMeasuredQty } from './measurement-row';

/** The DOM id of a box of the dialog: its refusal sits under it. */
export const recordMeasurementControlId = (field: MeasurementField) => `record-measurement-${field}`;

type TypedMeasurement = Record<MeasurementField, string>;

const sameTyped = (a: TypedMeasurement, b: TypedMeasurement) => MEASUREMENT_FIELDS.every((field) => a[field] === b[field]);

/** The line being measured: its name, and its contract quantity for the far-beyond check. */
export interface RecordedLine {
  id: string;
  label: string;
  qty: string;
  unit: string;
}

/** Whether the typed quantity, read as it would be saved, is far beyond the line's contract quantity. */
function farBeyond(typedQty: string, line: RecordedLine): boolean {
  const read = readNonNegativeExactFigure(typedQty);
  return read.ok && isFarBeyondContractQty(read.value, line.qty);
}

/**
 * The FINAL measured quantity of one line (owner decision Oct 19): the
 * quantity as typed on site (Arabic digits and "1,250" rewritten on blur to the
 * figure that is saved), the day, an optional note. Every refusal is said under
 * its box. A correction is a new reading, never an edit. A quantity more than
 * ten times the line's contract quantity is still saved, but the dialog says
 * so under the box first (S3).
 *
 * A retry after a lost answer carries the SAME key while the boxes are
 * unchanged, so the server answers the reading it already has (`already`); a
 * changed box is a new reading with a new key.
 */
export function RecordMeasurementDialog({
  contractId,
  contractIssuedOn,
  line,
  onSaved,
  onClose,
}: {
  contractId: string;
  /** The contract's issue day, `YYYY-MM-DD`: no reading is dated before it. */
  contractIssuedOn: string;
  line: RecordedLine;
  /** The reading is saved (or was already), as the server keeps it: the tab shows it on its line. */
  onSaved: (reading: CleanMeasurement, already: boolean) => void;
  onClose: () => void;
}) {
  const t = useTranslations('contracts.execution.measurements.record');
  const tc = useTranslations('common');
  const te = useTranslations('errors');
  const locale = useLocale();
  const today = todayInCairo(new Date());
  const [typed, setTyped] = useState<TypedMeasurement>({ measuredQty: '', measuredOn: today, note: '' });
  const [pending, startTransition] = useTransition();
  const errors = useFieldErrors({ fields: MEASUREMENT_FIELDS, translate: te });
  const attempt = useRef<{ key: string; typed: TypedMeasurement } | null>(null);

  const set = (field: MeasurementField, value: string) => setTyped((current) => ({ ...current, [field]: value }));

  function submit() {
    if (errors.applyLocal(measurementFieldErrors(typed, today, contractIssuedOn))) return;
    if (!attempt.current || !sameTyped(attempt.current.typed, typed)) attempt.current = { key: crypto.randomUUID(), typed };
    const idempotencyKey = attempt.current.key;
    startTransition(async () => {
      try {
        const res = await recordMeasurement({ contractId, contractLineId: line.id, ...typed, idempotencyKey });
        attempt.current = null;
        errors.applyResult(res);
        const saved = readMeasurement(typed, today);
        if (res.ok && saved.ok) onSaved(saved.values, res.already === true);
      } catch (rejection) {
        errors.applyRejection(rejection);
      }
    });
  }

  return (
    <FormSheet
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('title', { line: line.label })}
      description={t('description')}
      onSubmit={submit}
      submitLabel={t('submit')}
      cancelLabel={tc('cancel')}
      closeLabel={tc('close')}
      pending={pending}
      formError={errors.formError}
      invalidAttempt={errors.invalidAttempt}
    >
      <FormField id={recordMeasurementControlId('measuredQty')} label={t('measuredQty')} {...errors.bind('measuredQty')}>
        <Input
          dir="ltr"
          inputMode="decimal"
          value={typed.measuredQty}
          onChange={(event) => set('measuredQty', event.target.value)}
          onBlur={(event) => set('measuredQty', normalizeDecimalInput(event.target.value))}
        />
      </FormField>
      {farBeyond(typed.measuredQty, line) && (
        <p className="text-caption text-[color:var(--warn)]" role="status">
          {t('farBeyond', { qty: `${formatMeasuredQty(line.qty, locale)} ${line.unit}` })}
        </p>
      )}
      <FormField id={recordMeasurementControlId('measuredOn')} label={t('measuredOn')} {...errors.bind('measuredOn')}>
        <Input type="date" dir="ltr" max={today} value={typed.measuredOn} onChange={(event) => set('measuredOn', event.target.value)} />
      </FormField>
      <FormField id={recordMeasurementControlId('note')} label={t('note')} {...errors.bind('note')}>
        <Textarea value={typed.note} onChange={(event) => set('note', event.target.value)} />
      </FormField>
    </FormSheet>
  );
}
