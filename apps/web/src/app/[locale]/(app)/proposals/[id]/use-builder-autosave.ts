'use client';

import { useTranslations } from 'next-intl';
import type { ConfirmOptions } from '@/components/ui/confirm-dialog';
import { useInAppLeaveGuard } from '@/hooks/use-in-app-leave-guard';
import { resolveActionError } from '@/lib/actions/error-message';
import { draftFieldSelector, type DraftField } from './draft-completeness';
import type { ProposalDraftState } from './proposal-payload';
import { useDraftAutosave, type DraftAutosaveApi } from './use-draft-autosave';

/** Put the caret in the field that stops the save, and bring it into view. */
function focusDraftField(field: DraftField): void {
  const control = document.querySelector<HTMLElement>(draftFieldSelector(field));
  control?.scrollIntoView({ block: 'center' });
  control?.focus();
}

/**
 * The builder's autosave, wired to the page: it adopts the ids each save stored,
 * points at the first unfinished field when a save cannot go, and guards every
 * in-app link while anything is unsaved. Leaving stores the edits first; when
 * they cannot be stored the studio is asked, with the reason, and stays unless
 * they choose to leave without saving.
 */
export function useBuilderAutosave(input: {
  draft: ProposalDraftState;
  revision: string;
  enabled: boolean;
  adoptLineIds: (idsByKey: ReadonlyMap<string, string>) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}): DraftAutosaveApi {
  const t = useTranslations('proposals.builder.leave');
  const te = useTranslations('errors');
  const autosave = useDraftAutosave({
    draft: input.draft,
    revision: input.revision,
    enabled: input.enabled,
    onStored: input.adoptLineIds,
    onIncomplete: focusDraftField,
  });
  useInAppLeaveGuard({
    active: input.enabled && autosave.saveState !== 'saved',
    beforeLeave: async () => {
      const saved = await autosave.flush();
      if (saved.ok) return true;
      return input.confirm({
        title: t('title'),
        description: t('body', { reason: resolveActionError(saved.error, te) }),
        confirmLabel: t('confirm'),
        cancelLabel: t('stay'),
        variant: 'destructive',
      });
    },
  });
  return autosave;
}
