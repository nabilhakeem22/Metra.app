'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { toast } from '@/hooks/use-toast';
import { useUndoableRemoval } from '@/hooks/use-undoable-removal';
import { useRouter } from '@/i18n/routing';
import { resolveActionError } from '@/lib/actions/error-message';
import type { ActionResult } from '@/lib/actions/result';

/**
 * Deleting a client or project document: confirmed, then hidden at once with
 * Undo, and only deleted on the server when the Undo window passes. `t` is the
 * tab's own namespace (`confirmDelete.*`, `deleted`).
 *
 * A REFUSED delete is shown and the page refreshes: `uncertain` above all, where
 * the row may or may not be gone, so the studio sees the truth rather than a
 * file that did not react to being deleted.
 */
export function useDocumentDeletion(options: {
  deleteDocument: (id: string) => Promise<ActionResult>;
  t: (key: string) => string;
}): {
  hiddenIds: ReadonlySet<string>;
  requestDelete: (id: string) => Promise<void>;
  dialog: ReactNode;
} {
  const { deleteDocument, t } = options;
  const tc = useTranslations('common');
  const te = useTranslations('errors');
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const removal = useUndoableRemoval({
    commit: deleteDocument,
    messages: { removed: t('deleted'), undo: tc('undo') },
    onCommitted: () => router.refresh(),
    onFailed: (result) => {
      toast({ title: resolveActionError(result.error, te), variant: 'destructive' });
      router.refresh();
    },
  });

  async function requestDelete(id: string): Promise<void> {
    const confirmed = await confirm({
      title: t('confirmDelete.title'),
      description: t('confirmDelete.body'),
      confirmLabel: t('confirmDelete.confirm'),
      cancelLabel: tc('cancel'),
      variant: 'destructive',
    });
    if (confirmed) removal.remove(id);
  }

  return { hiddenIds: removal.hiddenIds, requestDelete, dialog };
}
