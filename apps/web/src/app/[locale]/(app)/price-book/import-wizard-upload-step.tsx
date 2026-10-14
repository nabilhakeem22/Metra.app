'use client';

import { Loader2 } from 'lucide-react';
import type { useTranslations } from 'next-intl';
import { useRef } from 'react';
import { FieldErrorText, fieldErrorId } from '@/components/ui/field-error-text';
import { FieldHint } from '@/components/ui/field-hint';
import { Label } from '@/components/ui/label';
import type { FieldErrorsApi } from '@/hooks/use-field-errors';
import { useFocusFirstInvalid } from '@/hooks/use-focus-first-invalid';

const FILE_ID = 'import-file';

// The wizard's first step: pick a CSV file. All state/parsing lives in the
// wizard's hook; this child renders the file input, calls `onFile`, and says a
// refusal of the file under it (or, for anything else, below it).
export function ImportWizardUploadStep({
  t,
  th,
  pending,
  onFile,
  errors,
}: {
  t: ReturnType<typeof useTranslations<'priceBook'>>;
  th: ReturnType<typeof useTranslations<'hints.priceBook'>>;
  pending: boolean;
  onFile: (file: File) => void;
  errors: FieldErrorsApi<'file'>;
}) {
  const refusal = errors.messageFor('file');
  const stepRef = useRef<HTMLDivElement>(null);
  // The input is disabled while a file is read, and a disabled control cannot
  // take the caret: move it once the read has settled.
  useFocusFirstInvalid(stepRef, pending ? 0 : errors.invalidAttempt);
  return (
    <div ref={stepRef} className="space-y-2">
      <Label htmlFor={FILE_ID} className="flex items-center">
        {t('import.chooseFile')}
        <FieldHint id="import-file-hint" hint={th('importFile')} />
      </Label>
      <input
        id={FILE_ID}
        type="file"
        accept=".csv"
        aria-describedby={refusal ? `import-file-hint ${fieldErrorId(FILE_ID)}` : 'import-file-hint'}
        aria-invalid={refusal ? true : undefined}
        disabled={pending}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
        }}
        className="block w-full text-body file:me-3 file:rounded-pill file:border-0 file:bg-muted file:px-3 file:py-2 file:text-body"
      />
      <FieldErrorText id={fieldErrorId(FILE_ID)} message={refusal} />
      {errors.formError && (
        <p className="text-body text-destructive" role="alert">
          {errors.formError}
        </p>
      )}
      {pending && (
        <p className="flex items-center gap-2 text-body text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
        </p>
      )}
    </div>
  );
}
