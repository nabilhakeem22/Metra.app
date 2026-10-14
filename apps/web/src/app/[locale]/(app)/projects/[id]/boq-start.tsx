'use client';

import { Download, Loader2, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { FieldErrorText, fieldErrorId } from '@/components/ui/field-error-text';
import { useFieldErrors } from '@/hooks/use-field-errors';
import { useFocusFirstInvalid } from '@/hooks/use-focus-first-invalid';
import { toast } from '@/hooks/use-toast';
import {
  commitBoqImport,
  createBoq,
  previewBoqImport,
  type ImportPreview,
} from '@/lib/boqs/actions';
import { BoqImportPreview } from './boq-import-preview';

/** The upload control is the one field: the file itself. */
const BOQ_IMPORT_FIELDS = ['file'] as const;
const FILE_ID = 'boq-import-file';

/**
 * The two ways a BOQ starts: download the template and upload it back, or create
 * an empty one and price it in the app.
 *
 * The template is generated from the studio's price book, so the returned file
 * already carries codes, units and rates — the studio types quantities. Rows
 * left without a quantity are items this project does not use and are skipped,
 * which is what makes a catalogue-sized sheet workable.
 */
export function BoqStart({ projectId }: { projectId: string }) {
  const t = useTranslations('projects.profile.boq');
  // A sheet over the size cap, an empty one and one that will not parse are
  // different problems: each is said under the upload control by its cause.
  const te = useTranslations('errors');
  const [pending, start] = useTransition();
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [boqId, setBoqId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const errors = useFieldErrors({ fields: BOQ_IMPORT_FIELDS, translate: te });
  const fileRefusal = errors.messageFor('file');
  const startRef = useRef<HTMLDivElement>(null);
  // The upload control is disabled while a read is in flight, and a disabled
  // control cannot take the caret: move it once the read has settled.
  useFocusFirstInvalid(startRef, pending ? 0 : errors.invalidAttempt);

  function onFile(file: File): void {
    errors.clear();
    start(async () => {
      try {
        const res = await previewBoqImport(await file.text());
        if (!errors.applyResult(res)) setPreview(res);
      } catch (rejection) {
        errors.applyRejection(rejection);
      }
    });
  }

  /** Create the document only once the studio has seen what will land in it:
   *  an abandoned preview should not leave an empty BOQ behind. */
  async function boqToFill(): Promise<string | null> {
    if (boqId) return boqId;
    const created = await createBoq({ projectId, titleEn: 'Bill of Quantities' });
    if (errors.applyResult(created) || !created.data) return null;
    setBoqId(created.data);
    return created.data;
  }

  function onCommit(): void {
    // Never a disabled Import: a file with no usable line says so under the file box.
    if (errors.applyLocal(preview?.lines?.length ? {} : { file: { code: 'import_empty' } })) return;
    start(async () => {
      try {
        const id = await boqToFill();
        if (!id) return;
        const res = await commitBoqImport({ boqId: id, lines: preview?.lines ?? [] });
        if (errors.applyResult(res)) return;
        toast({ title: t('imported', { count: String(res.data ?? 0) }) });
        setPreview(null);
      } catch (rejection) {
        errors.applyRejection(rejection);
      }
    });
  }

  return (
    <div ref={startRef} className="glass space-y-4 p-5">
      <div>
        <p className="font-semibold text-[color:var(--text)]">{t('startTitle')}</p>
        <p className="text-body text-[color:var(--text-muted)]">{t('startBody')}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button asChild variant="secondary">
          <a href="/boq/template" download>
            <Download className="size-4" aria-hidden />
            {t('downloadTemplate')}
          </a>
        </Button>

        <Button
          id={FILE_ID}
          variant="secondary"
          disabled={pending}
          aria-invalid={fileRefusal ? true : undefined}
          aria-describedby={fileRefusal ? fieldErrorId(FILE_ID) : undefined}
          onClick={() => fileRef.current?.click()}
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Upload className="size-4" aria-hidden />
          )}
          {t('uploadSheet')}
        </Button>

        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            // Reset so choosing the SAME file twice still fires a change event —
            // which is exactly what happens after a failed import is corrected.
            e.target.value = '';
            if (file) onFile(file);
          }}
        />
      </div>
      <FieldErrorText id={fieldErrorId(FILE_ID)} message={fileRefusal} />
      {errors.formError && (
        <p className="text-body text-destructive" role="alert">
          {errors.formError}
        </p>
      )}

      {preview && (
        <BoqImportPreview
          preview={preview}
          pending={pending}
          onCommit={onCommit}
          onCancel={() => setPreview(null)}
        />
      )}
    </div>
  );
}
