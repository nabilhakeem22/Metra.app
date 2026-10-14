'use client';

import type { useTranslations } from 'next-intl';
import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { SelectControl } from '@/components/ui/select-control';
import type { FieldErrorsApi } from '@/hooks/use-field-errors';
import { useFocusFirstInvalid } from '@/hooks/use-focus-first-invalid';
import type { ColumnMapping } from '@/lib/price-book/import';
import { FIELDS, NONE, REQUIRED, type FieldKey } from './import-wizard-fields';

// The wizard's second step: map spreadsheet columns onto cost-item fields. All
// state and mutations live in the wizard's hook; this child is presentational.
// Preview is never disabled: pressing it says under each required column that
// is still unmapped that it is required, and puts the caret on the first.
export function ImportWizardMapStep({
  t,
  mapping,
  header,
  setField,
  reset,
  onPreview,
  errors,
}: {
  t: ReturnType<typeof useTranslations<'priceBook'>>;
  mapping: ColumnMapping;
  header: string[];
  setField: (field: FieldKey, col: number) => void;
  reset: () => void;
  onPreview: () => void;
  errors: FieldErrorsApi<FieldKey>;
}) {
  const stepRef = useRef<HTMLDivElement>(null);
  useFocusFirstInvalid(stepRef, errors.invalidAttempt);
  const options = [
    { value: String(NONE), label: t('import.none') },
    ...header.map((h, i) => ({ value: String(i), label: h || `#${i + 1}` })),
  ];
  return (
    <div ref={stepRef} className="space-y-3">
      {FIELDS.map((field) => (
        <FormField
          key={field}
          id={`map-${field}`}
          label={t(`import.fields.${field}`)}
          required={REQUIRED.includes(field)}
          {...errors.bind(field)}
        >
          <SelectControl
            className="h-9"
            value={String(mapping[field] ?? NONE)}
            onValueChange={(v) => setField(field, Number(v))}
            options={options}
          />
        </FormField>
      ))}

      <div className="flex justify-between pt-2">
        <Button type="button" variant="secondary" onClick={reset}>
          {t('import.back')}
        </Button>
        <Button variant="default" type="button" onClick={onPreview}>
          {t('import.preview')}
        </Button>
      </div>
    </div>
  );
}
