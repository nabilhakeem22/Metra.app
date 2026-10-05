'use client';

import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { toast } from '@/hooks/use-toast';
import { useRouter } from '@/i18n/routing';
import { resolveActionError } from '@/lib/actions/error-message';
import { openBoqProposal } from '@/lib/boq-proposals/actions';
import { boqProposalHref } from '@/lib/boqs/step';

/**
 * "Create the BOQ": open (creating on first use) the engagement's BOQ working
 * copy and go to it in the builder. The await is wrapped so a rejected action
 * can never leave the button spinning.
 */
export function useOpenBoqProposal(engagementId: string): {
  open: () => void;
  pending: boolean;
} {
  const te = useTranslations('errors');
  const router = useRouter();
  const [pending, start] = useTransition();

  function open(): void {
    start(async () => {
      try {
        const res = await openBoqProposal(engagementId);
        if (res.ok && res.data) {
          router.push(boqProposalHref(res.data));
          return;
        }
        toast({ title: resolveActionError(res.error, te), variant: 'destructive' });
      } catch {
        toast({ title: resolveActionError('generic', te), variant: 'destructive' });
      }
    });
  }

  return { open, pending };
}
