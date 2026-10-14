'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { useFieldErrors } from '@/hooks/use-field-errors';
import { toast } from '@/hooks/use-toast';
import { useRouter } from '@/i18n/routing';
import { addProjectType } from '@/lib/project-types/actions';
import { projectTypeNameErrors } from '@/lib/project-types/field-rules';
import { BILINGUAL_NAME_FIELDS } from '@/lib/validation/text-field-rules';

/**
 * The inline "add a project type" box: one name, in the studio's language.
 * Add is never disabled to say "not yet": pressing it on an empty box asks
 * for a name under it, as any name refusal from the server is.
 */
export function useAddProjectType() {
  const t = useTranslations('projects');
  const te = useTranslations('errors');
  const locale = useLocale();
  const router = useRouter();
  const [name, setName] = useState('');
  const [adding, startAdding] = useTransition();
  const errors = useFieldErrors({ fields: BILINGUAL_NAME_FIELDS, translate: te });

  function add() {
    const input = locale.startsWith('ar') ? { nameAr: name } : { nameEn: name };
    if (errors.applyLocal(projectTypeNameErrors(input))) return;
    startAdding(async () => {
      try {
        const result = await addProjectType(input);
        if (errors.applyResult(result)) return;
        setName('');
        toast({ title: t('toast.typeAdded') });
        router.refresh();
      } catch (rejection) {
        errors.applyRejection(rejection);
      }
    });
  }

  /** Every name refusal sits under the one box. */
  const error = errors.messageFor('name') ?? errors.messageFor('nameEn') ?? errors.messageFor('nameAr');
  const clearOnEdit = () => {
    for (const field of BILINGUAL_NAME_FIELDS) errors.bind(field).onEdit();
  };

  return { name, setName, add, adding, error, clearOnEdit, errors };
}
