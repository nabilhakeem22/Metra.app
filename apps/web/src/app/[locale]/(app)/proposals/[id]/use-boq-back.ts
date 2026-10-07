'use client';

import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { toast } from '@/hooks/use-toast';
import { useRouter } from '@/i18n/routing';
import { resolveActionError } from '@/lib/actions/error-message';
import type { SaveDraftResult } from './persist-draft';

/**
 * "Back to delivery": SAVE first, send nothing. On a refused or thrown save the
 * studio stays on the draft, with a toast, so no edit is dropped by leaving.
 */
export function useBoqBack(options: {
  engagementId: string;
  /** Store the latest edits (the autosave's flush); answers like a save. */
  flush: () => Promise<SaveDraftResult>;
}): { back: () => void; pending: boolean } {
  const te = useTranslations('errors');
  const router = useRouter();
  const [pending, start] = useTransition();

  function back(): void {
    start(async () => {
      try {
        const saved = await options.flush();
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
