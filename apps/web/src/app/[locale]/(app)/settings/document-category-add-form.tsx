'use client';

import { Loader2, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { fieldErrorId } from '@/components/ui/field-error-text';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { useFieldErrors } from '@/hooks/use-field-errors';
import { useFocusFirstInvalid } from '@/hooks/use-focus-first-invalid';
import { useRouter } from '@/i18n/routing';
import { createDocumentCategory } from '@/lib/document-categories/actions';
import { documentCategoryNameErrors } from '@/lib/document-categories/field-rules';
import { BILINGUAL_NAME_FIELDS, type BilingualNameField } from '@/lib/validation/text-field-rules';

/** The control a name refusal sits under: the pair under the Arabic name (first). */
export function categoryControlId(field: BilingualNameField): string {
  return field === 'nameEn' ? 'dc-en' : 'dc-ar';
}

/**
 * Add a category to the end of the firm's list. Add is never disabled to say
 * "not yet": pressing it with no name asks for one under the Arabic name.
 */
export function DocumentCategoryAddForm() {
  const t = useTranslations('settings.documentCategories');
  const te = useTranslations('errors');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [nameAr, setNameAr] = useState('');
  const [nameEn, setNameEn] = useState('');
  const errors = useFieldErrors({ fields: BILINGUAL_NAME_FIELDS, translate: te });
  const formRef = useRef<HTMLDivElement>(null);
  useFocusFirstInvalid(formRef, errors.invalidAttempt);
  const pair = errors.bind('name');

  function add() {
    const input = { nameAr: nameAr.trim() || null, nameEn: nameEn.trim() || null };
    if (errors.applyLocal(documentCategoryNameErrors(input))) return;
    startTransition(async () => {
      try {
        const result = await createDocumentCategory(input);
        if (errors.applyResult(result)) return;
        setNameAr('');
        setNameEn('');
        router.refresh();
      } catch (rejection) {
        errors.applyRejection(rejection);
      }
    });
  }

  const editOf = (field: 'nameAr' | 'nameEn') => () => {
    errors.bind(field).onEdit();
    pair.onEdit();
  };

  return (
    <div ref={formRef} className="space-y-2">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-40 flex-1">
          <FormField
            id={categoryControlId('nameAr')}
            label={t('nameAr')}
            error={pair.error ?? errors.messageFor('nameAr')}
            onEdit={editOf('nameAr')}
          >
            <Input dir="rtl" value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
          </FormField>
        </div>
        <div className="min-w-40 flex-1">
          <FormField
            id={categoryControlId('nameEn')}
            label={t('nameEn')}
            error={errors.messageFor('nameEn')}
            onEdit={editOf('nameEn')}
          >
            <Input
              dir="ltr"
              aria-invalid={pair.error ? true : undefined}
              aria-describedby={pair.error ? fieldErrorId(categoryControlId('name')) : undefined}
              value={nameEn}
              onChange={(e) => setNameEn(e.target.value)}
            />
          </FormField>
        </div>
        <Button variant="secondary" type="button" className="mt-7" disabled={pending} onClick={add}>
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Plus className="size-4" aria-hidden />}
          {t('add')}
        </Button>
      </div>
      {errors.formError && (
        <p className="text-body text-destructive" role="alert">
          {errors.formError}
        </p>
      )}
    </div>
  );
}
