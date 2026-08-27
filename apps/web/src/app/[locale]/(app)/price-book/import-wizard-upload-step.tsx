'use client';

import { Loader2 } from 'lucide-react';
import type { useTranslations } from 'next-intl';
import { FieldHint } from '@/components/ui/field-hint';
import { Label } from '@/components/ui/label';

// The wizard's first step: pick a CSV file. All state/parsing lives in the parent
// (ImportWizard); this child just renders the file input and calls `onFile`.
export function ImportWizardUploadStep({
  t,
  th,
  pending,
  onFile,
}: {
  t: ReturnType<typeof useTranslations<'priceBook'>>;
  th: ReturnType<typeof useTranslations<'hints.priceBook'>>;
  pending: boolean;
  onFile: (file: File) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor="import-file" className="flex items-center">
        {t('import.chooseFile')}
        <FieldHint id="import-file-hint" hint={th('importFile')} />
      </Label>
      <input
        id="import-file"
        type="file"
        accept=".csv"
        aria-describedby="import-file-hint"
        disabled={pending}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
        }}
        className="block w-full text-sm file:me-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-2 file:text-sm"
      />
      {pending && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
        </p>
      )}
    </div>
  );
}
