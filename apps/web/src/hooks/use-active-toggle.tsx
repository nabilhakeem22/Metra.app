'use client';

import { useTransition, type ReactNode } from 'react';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { toast } from '@/hooks/use-toast';
import type { ActionResult } from '@/lib/actions/result';
import { showUndoToast } from './undo-toast';

type Translate = (key: string) => string;

export interface ActiveToggleCopy {
  confirmTitle: string;
  confirmBody: string;
  confirmCta: string;
  cancel: string;
  deactivated: string;
  activated: string;
  undo: string;
}

/**
 * The copy of a plain "deactivate" record, from its own namespace
 * (`confirmDeactivate.{title,body,confirm}`, `toast.{deactivated,activated}`)
 * and the shared `common.{cancel,undo}`.
 */
export function deactivationCopy(t: Translate, common: Translate): ActiveToggleCopy {
  return {
    confirmTitle: t('confirmDeactivate.title'),
    confirmBody: t('confirmDeactivate.body'),
    confirmCta: t('confirmDeactivate.confirm'),
    cancel: common('cancel'),
    deactivated: t('toast.deactivated'),
    activated: t('toast.activated'),
    undo: common('undo'),
  };
}

/**
 * Deactivating a record (client, project, cost item, document category) is
 * REVERSIBLE by the same action, so it is confirmed AND undoable: the confirm
 * names what happens, then the deactivation runs at once and the toast offers
 * Undo, which runs the same action with `active = true`. Activating is not
 * destructive and runs without a question.
 */
export function useActiveToggle(options: {
  setActive: (id: string, active: boolean) => Promise<ActionResult>;
  copy: ActiveToggleCopy;
  /** A refused write: the caller shows `resolveActionError(...)`. */
  onError: (result: ActionResult) => void;
  /** After any write lands, e.g. `router.refresh()` where the page needs it. */
  onChanged?: () => void;
}): {
  toggle: (record: { id: string; active: boolean }) => Promise<void>;
  pending: boolean;
  dialog: ReactNode;
} {
  const { setActive, copy, onError, onChanged } = options;
  const { confirm, dialog } = useConfirm();
  const [pending, startTransition] = useTransition();

  function write(id: string, active: boolean, onDone: () => void) {
    startTransition(async () => {
      const result = await setActive(id, active).catch(
        (): ActionResult => ({ ok: false, error: 'generic' }),
      );
      if (!result.ok) {
        onError(result);
        return;
      }
      onDone();
      onChanged?.();
    });
  }

  async function toggle(record: { id: string; active: boolean }) {
    if (!record.active) {
      write(record.id, true, () => toast({ title: copy.activated }));
      return;
    }
    const confirmed = await confirm({
      title: copy.confirmTitle,
      description: copy.confirmBody,
      confirmLabel: copy.confirmCta,
      cancelLabel: copy.cancel,
      variant: 'destructive',
    });
    if (!confirmed) return;
    write(record.id, false, () =>
      showUndoToast({
        title: copy.deactivated,
        undoLabel: copy.undo,
        onUndo: () => write(record.id, true, () => toast({ title: copy.activated })),
      }),
    );
  }

  return { toggle, pending, dialog };
}
