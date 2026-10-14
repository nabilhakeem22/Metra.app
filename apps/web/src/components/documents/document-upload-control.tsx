'use client';

import { Loader2, Upload } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState, useTransition, type ChangeEvent } from 'react';
import { Button } from '@/components/ui/button';
import { FieldErrorText, fieldErrorId } from '@/components/ui/field-error-text';
import { useFieldErrors } from '@/hooks/use-field-errors';
import { useFocusFirstInvalid } from '@/hooks/use-focus-first-invalid';
import { toast } from '@/hooks/use-toast';
import { useRouter } from '@/i18n/routing';
import type { ActionResult } from '@/lib/actions/result';
import { DOCUMENT_UPLOAD_FIELDS, type DocumentUploadField } from '@/lib/documents/fields';
import { pickLocale } from '@/lib/i18n/pick-locale';

/** The category picker; a category retired since the page loaded is said under it. */
export const DOCUMENT_CATEGORY_ID = 'document-category';

/** What the upload action answers: a signed URL to PUT to, or a refusal. */
type SignedUploadAnswer = { signedUrl: string } | ActionResult;

type UploadText = 'category' | 'uncategorised' | 'upload' | 'uploaded';

const NO_FIELDS: readonly DocumentUploadField[] = [];

/**
 * Upload a document to a client or a project, filed under the category picked
 * first. A category gone meanwhile is said under the picker; Storage refusing
 * the bytes, the record gone or the network down, under the button.
 */
export function DocumentUploadControl({
  categories,
  createUpload,
  t,
}: {
  categories: Array<{ id: string; nameEn: string | null; nameAr: string | null }>;
  createUpload: (input: { contentType: string; originalName: string; categoryId: string | null }) => Promise<SignedUploadAnswer>;
  t: (key: UploadText) => string;
}) {
  const te = useTranslations('errors');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [categoryId, setCategoryId] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const controlRef = useRef<HTMLDivElement>(null);
  const errors = useFieldErrors({ fields: categories.length > 0 ? DOCUMENT_UPLOAD_FIELDS : NO_FIELDS, translate: te });
  useFocusFirstInvalid(controlRef, errors.invalidAttempt);
  const categoryRefusal = errors.bind('categoryId');

  function onUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    errors.clear();
    startTransition(async () => {
      try {
        const signed = await createUpload({ contentType: file.type, originalName: file.name, categoryId: categoryId || null });
        if ('ok' in signed) {
          errors.applyResult(signed);
          return;
        }
        const put = await fetch(signed.signedUrl, {
          method: 'PUT',
          headers: { 'content-type': file.type, 'x-upsert': 'true' },
          body: file,
        });
        if (!put.ok) {
          errors.applyResult({ ok: false, error: 'storage_unavailable' });
          return;
        }
        errors.clear();
        toast({ title: t('uploaded') });
        router.refresh();
      } catch (rejection) {
        errors.applyRejection(rejection);
      } finally {
        if (inputRef.current) inputRef.current.value = '';
      }
    });
  }

  return (
    <div ref={controlRef} className="space-y-1">
      <input ref={inputRef} type="file" className="hidden" onChange={onUpload} disabled={pending} />
      {categories.length > 0 && (
        <select
          id={DOCUMENT_CATEGORY_ID}
          value={categoryId}
          onChange={(e) => {
            categoryRefusal.onEdit();
            setCategoryId(e.target.value);
          }}
          aria-label={t('category')}
          aria-invalid={categoryRefusal.error ? true : undefined}
          aria-describedby={categoryRefusal.error ? fieldErrorId(DOCUMENT_CATEGORY_ID) : undefined}
          className="h-9 rounded-item border bg-background px-2 field-text"
        >
          <option value="">{t('uncategorised')}</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {pickLocale({ nameAr: c.nameAr, nameEn: c.nameEn }, 'name', locale).value}
            </option>
          ))}
        </select>
      )}
      <Button type="button" variant="secondary" onClick={() => inputRef.current?.click()} disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Upload className="size-4" aria-hidden />}
        {t('upload')}
      </Button>
      <FieldErrorText id={fieldErrorId(DOCUMENT_CATEGORY_ID)} message={categoryRefusal.error} />
      {errors.formError && (
        <p className="text-body text-destructive" role="alert">
          {errors.formError}
        </p>
      )}
    </div>
  );
}
