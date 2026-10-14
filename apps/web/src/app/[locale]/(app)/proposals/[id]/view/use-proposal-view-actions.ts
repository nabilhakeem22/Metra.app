'use client';

import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { toast } from '@/hooks/use-toast';
import { useRouter } from '@/i18n/routing';
import { describeFailure, describeRejection } from '@/lib/actions/error-message';
import type { ActionResult } from '@/lib/actions/result';
import { generateContract } from '@/lib/contracts/actions';
import { expireProposal, supersedeProposal } from '@/lib/proposals/actions';

// The sent proposal's three acts: generate its contract, supersede it with a
// new draft, expire it. A refusal toasts its cause (an unknown failure with its
// reference); a request that never answered says so.

export function useProposalViewActions(proposalId: string) {
  const t = useTranslations('proposals');
  const tc = useTranslations('contracts');
  const te = useTranslations('errors');
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  /** Run one act; `landed` handles its success, anything else is said. */
  function run<R extends ActionResult>(act: () => Promise<R>, landed: (result: R) => boolean) {
    startTransition(async () => {
      try {
        const result = await act();
        if (!landed(result)) toast({ title: describeFailure(result, te), variant: 'destructive' });
      } catch (rejection) {
        toast({ title: describeRejection(rejection, te), variant: 'destructive' });
      }
    });
  }

  return {
    pending,
    onGenerateContract: () =>
      run(
        () => generateContract(proposalId),
        (res) => {
          if (!res.ok || !res.data) return false;
          toast({ title: tc('generated') });
          router.push(`/contracts/${res.data}`);
          return true;
        },
      ),
    onSupersede: () =>
      run(
        () => supersedeProposal(proposalId),
        (res) => {
          if (!res.ok || !res.data) return false;
          toast({ title: t('toast.superseded') });
          router.push(`/proposals/${res.data}`);
          return true;
        },
      ),
    onExpire: () =>
      run(
        () => expireProposal(proposalId),
        (res) => {
          if (!res.ok) return false;
          toast({ title: t('toast.expired') });
          router.refresh();
          return true;
        },
      ),
  };
}
