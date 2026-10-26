'use client';

import { useState, useTransition } from 'react';
import type { ContractDocument } from '@/lib/contracts/public-types';
import type { ShownPortalFailure } from '@/lib/share/portal-failure';
import { openHomeContract } from '../contract-actions';

/** Why the document is not shown: a shared portal failure, or the document's own sentence. */
export type HomeContractProblem = { failure: ShownPortalFailure } | { own: 'gone' | 'loadFailed' };

/**
 * The Execution tab's contract document, read the first time the client opens
 * it and kept after that: hiding and showing it again reads nothing, so the
 * lines a client has loaded stay. One read at a time; a failed one keeps the
 * document closed and says why.
 */
export function useHomeContract(token: string, contractId: string) {
  const [document, setDocument] = useState<ContractDocument | null>(null);
  const [open, setOpen] = useState(false);
  const [problem, setProblem] = useState<HomeContractProblem | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle() {
    if (document) {
      setOpen((shown) => !shown);
      return;
    }
    if (pending) return;
    setProblem(null);
    startTransition(async () => {
      try {
        const answer = await openHomeContract(token, contractId);
        if (answer.ok) {
          setDocument(answer.contract);
          setOpen(true);
        } else if (answer.error === 'gone') setProblem({ own: 'gone' });
        else setProblem({ failure: answer });
      } catch {
        setProblem({ own: 'loadFailed' });
      }
    });
  }

  return { document, open, problem, pending, toggle };
}
