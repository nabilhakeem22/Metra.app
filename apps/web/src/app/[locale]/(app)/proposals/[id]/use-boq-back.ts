'use client';

import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { toast } from '@/hooks/use-toast';
import { useRouter } from '@/i18n/routing';
import { resolveActionError } from '@/lib/actions/error-message';
import { persistDraft } from './persist-draft';
import type { ProposalDraftState } from './proposal-payload';

/**
 * "Back to delivery": SAVE first, send nothing. On a refused or thrown save the
 * studio stays on the draft, with a toast, so no edit is dropped by leaving.
 */
export function useBoqBack(options: {
  engagementId: string;
  draftState: () => ProposalDraftState;
}): { back: () => void; pending: boolean } {
  const te = useTranslations('errors');
  const router = useRouter();
  const [pending, start] = useTransition();

  function back(): void {
    start(async () => {
      try {
        const saved = await persistDraft(options.draftState());
        if (saved.ok) {
          router.push(`/engagements/${options.engagementId}`);
          return;
        }
        toast({ title: resolveActionError(saved.error, te), variant: 'destructive' });
      } catch {
        toast({ title: resolveActionError('generic', te), variant: 'destructive' });
      }
    });
  }

  return { back, pending };
}
