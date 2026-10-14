'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { useFieldErrors } from '@/hooks/use-field-errors';
import { toast } from '@/hooks/use-toast';
import { useRouter } from '@/i18n/routing';
import { addSection } from '@/lib/sections/actions';

// The toolbar's "add a category" box: its typed name, and the write it makes.
// Its refusals are said under the box, never toasted.

const SECTION_FIELDS = ['name'] as const;

export function useSectionAdder() {
  const t = useTranslations('priceBook');
  const te = useTranslations('errors');
  const locale = useLocale();
  const router = useRouter();
  const [name, setName] = useState('');
  const [pending, startTransition] = useTransition();
  const errors = useFieldErrors({ fields: SECTION_FIELDS, translate: te });

  /** A new section is named in ONE language, the one the studio is working in.
   *  The other side stays null until somebody translates it. */
  function add(): void {
    const trimmed = name.trim();
    if (errors.applyLocal(trimmed ? {} : { name: { code: 'required' } })) return;
    startTransition(async () => {
      try {
        const result = await addSection(locale.startsWith('ar') ? { nameAr: trimmed } : { nameEn: trimmed });
        if (errors.applyResult(result)) return;
        setName('');
        toast({ title: t('toast.sectionAdded') });
        router.refresh();
      } catch (rejection) {
        errors.applyRejection(rejection);
      }
    });
  }

  return { name, setName, add, pending, errors };
}
