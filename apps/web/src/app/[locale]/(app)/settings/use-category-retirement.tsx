'use client';

import { useTranslations } from 'next-intl';
import { useActiveToggle } from '@/hooks/use-active-toggle';
import { toast } from '@/hooks/use-toast';
import { useRouter } from '@/i18n/routing';
import { describeFailure } from '@/lib/actions/error-message';
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
      // A row the page no longer lists: gone since it was rendered.
      if (!category) return Promise.resolve({ ok: false, error: 'record_not_found' });
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
      toast({ title: describeFailure(result, te), variant: 'destructive' }),
    onChanged: () => router.refresh(),
  });
}
