'use client';

import { useTranslations } from 'next-intl';
import { useMemo, useState, useTransition } from 'react';
import { useFieldErrors } from '@/hooks/use-field-errors';
import { toast } from '@/hooks/use-toast';
import type { FieldErrors } from '@/lib/actions/field-errors';
import { invariant } from '@/lib/actions/invariant';
import { importCostItems, parseCostImport } from '@/lib/price-book/actions';
import { validateImportRows, type ColumnMapping, type ValidatedRow } from '@/lib/price-book/import';
import { guessMapping } from './import-wizard-guess';
import { REQUIRED, type FieldKey } from './import-wizard-fields';
import type { SectionOption } from './types';

export type ImportStep = 'upload' | 'map' | 'preview';

const FILE_FIELDS = ['file'] as const;

/** The required columns the studio has not mapped yet, each `required`. */
function unmappedRequired(mapping: ColumnMapping): FieldErrors<FieldKey> {
  const errors: Partial<Record<FieldKey, { code: 'required' }>> = {};
  for (const field of REQUIRED) {
    if (mapping[field] === undefined || mapping[field]! < 0) errors[field] = { code: 'required' };
  }
  return errors;
}

/**
 * The price-book import, step by step: read the file (a refusal of it is said
 * under the file box), map its columns (Preview says which required column is
 * still unmapped, under that column), preview, import (a failure is said above
 * the buttons by its cause).
 */
export function useImportWizard(options: { existingCodes: string[]; sections: SectionOption[] }) {
  const t = useTranslations('priceBook');
  const te = useTranslations('errors');
  const [step, setStep] = useState<ImportStep>('upload');
  const [header, setHeader] = useState<string[]>([]);
  const [data, setData] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [pending, startTransition] = useTransition();
  const fileErrors = useFieldErrors({ fields: FILE_FIELDS, translate: te });
  const mapErrors = useFieldErrors({ fields: REQUIRED, translate: te });

  // Case-SENSITIVE, matching the DB unique(org_id, code).
  const existing = useMemo(() => new Set(options.existingCodes), [options.existingCodes]);
  const preview: ValidatedRow[] = useMemo(() => {
    if (step !== 'preview' || !mapping) return [];
    return validateImportRows(data, mapping, existing, options.sections);
  }, [step, mapping, data, existing, options.sections]);

  function reset() {
    setStep('upload');
    setHeader([]);
    setData([]);
    setMapping(null);
    fileErrors.clear();
    mapErrors.clear();
  }

  function onFile(file: File) {
    fileErrors.clear();
    const fd = new FormData();
    fd.append('file', file);
    startTransition(async () => {
      try {
        const res = await parseCostImport(fd);
        if (fileErrors.applyResult(res)) return;
        invariant(res.data, 'parseCostImport answered ok without a sheet');
        setHeader(res.data.header);
        setData(res.data.data);
        setMapping(guessMapping(res.data.header));
        setStep('map');
      } catch (rejection) {
        fileErrors.applyRejection(rejection);
      }
    });
  }

  function setField(field: FieldKey, col: number) {
    setMapping((m) => (m ? { ...m, [field]: col < 0 ? undefined : col } : m));
  }

  function onPreview() {
    if (mapping && !mapErrors.applyLocal(unmappedRequired(mapping))) setStep('preview');
  }

  function runImport(onDone: () => void) {
    if (!mapping) return;
    startTransition(async () => {
      try {
        const res = await importCostItems({ rows: data, mapping });
        if (mapErrors.applyResult(res)) return;
        invariant(res.data, 'importCostItems answered ok without a summary');
        toast({ title: t('import.done', { imported: res.data.imported, skipped: res.data.skipped }) });
        onDone();
      } catch (rejection) {
        mapErrors.applyRejection(rejection);
      }
    });
  }

  return {
    step,
    setStep,
    header,
    mapping,
    pending,
    preview,
    validCount: preview.filter((r) => r.ok).length,
    fileErrors,
    mapErrors,
    reset,
    onFile,
    setField,
    onPreview,
    runImport,
  };
}
