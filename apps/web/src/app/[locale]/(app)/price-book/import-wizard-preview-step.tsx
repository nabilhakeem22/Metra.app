'use client';

import { Loader2 } from 'lucide-react';
import type { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { IMPORT_ERROR_PARAMS, type ValidatedRow } from '@/lib/price-book/import';

// The wizard's third step: preview validated rows and run the import. All state
// and the import mutation live in the parent (ImportWizard); this child renders
// the preview table and the two action buttons.
export function ImportWizardPreviewStep({
  t,
  preview,
  pending,
  validCount,
  formError,
  onBack,
  runImport,
}: {
  t: ReturnType<typeof useTranslations<'priceBook'>>;
  preview: ValidatedRow[];
  pending: boolean;
  validCount: number;
  /** Why the import did not run, by its cause. */
  formError: string | null;
  onBack: () => void;
  runImport: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="max-h-80 overflow-y-auto rounded-panel border">
        <table className="w-full text-body">
          <thead className="sticky top-0 bg-muted">
            <tr>
              <th className="px-2 py-1.5 text-start">
                {t('import.rowColumn')}
              </th>
              <th className="px-2 py-1.5 text-start">
                {t('table.code')}
              </th>
              <th className="px-2 py-1.5 text-start">
                {t('import.statusColumn')}
              </th>
            </tr>
          </thead>
          <tbody>
            {preview.map((r) => (
              <tr key={r.index} className="border-t">
                <td className="px-2 py-1.5 text-muted-foreground">
                  {r.index + 1}
                </td>
                <td className="px-2 py-1.5" dir="ltr">
                  {r.code || '—'}
                </td>
                <td className="px-2 py-1.5">
                  {r.ok ? (
                    <span className="text-[color:var(--success)]">
                      {t('import.willImport')}
                    </span>
                  ) : (
                    <span className="text-destructive">
                      {t(`import.errors.${r.error}`, IMPORT_ERROR_PARAMS)}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {formError && (
        <p className="text-body text-destructive" role="alert">
          {formError}
        </p>
      )}
      <div className="flex justify-between pt-2">
        <Button
          type="button"
          variant="secondary"
          onClick={onBack}
          disabled={pending}
        >
          {t('import.back')}
        </Button>
        <Button
          variant="default"
          type="button"
          onClick={runImport}
          disabled={pending || validCount === 0}
        >
          {pending && (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          )}
          {t('import.importNow', { count: validCount })}
        </Button>
      </div>
    </div>
  );
}
