'use client';

import { useTranslations } from 'next-intl';
import { useActiveToggle } from '@/hooks/use-active-toggle';
import { toast } from '@/hooks/use-toast';
import { useRouter } from '@/i18n/routing';
import { resolveActionError } from '@/lib/actions/error-message';
import { updateDocumentCategory } from '@/lib/document-categories/actions';
import type { DocumentCategoryRow } from './document-categories-card';

/**
 * Retiring a document category is confirmed and undoable: Undo is the same
 * update with `active = true`. Restoring a retired category runs at once.
 */
export function useCategoryRetirement(categories: DocumentCategoryRow[]) {
  const t = useTranslations('settings.documentCategories');
  const tc = useTranslations('common');
  const te = useTranslations('errors');
  const router = useRouter();
  return useActiveToggle({
    setActive: (id, active) => {
      const category = categories.find((candidate) => candidate.id === id);
      if (!category) return Promise.resolve({ ok: false, error: 'invalid' });
      return updateDocumentCategory({ ...category, active });
    },
    copy: {
      confirmTitle: t('confirmRetire.title'),
      confirmBody: t('confirmRetire.body'),
      confirmCta: t('confirmRetire.confirm'),
      cancel: tc('cancel'),
      deactivated: t('toast.retired'),
      activated: t('toast.restored'),
      undo: tc('undo'),
    },
    onError: (result) =>
      toast({ title: resolveActionError(result.error, te), variant: 'destructive' }),
    onChanged: () => router.refresh(),
  });
}
