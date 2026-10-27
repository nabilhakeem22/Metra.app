'use client';

import { useRef, useState, useTransition } from 'react';
import type { ContractDocument } from '@/lib/contracts/public-types';
import type { ShownPortalFailure } from '@/lib/share/portal-failure';
import { openHomeContract } from '../contract-actions';

/** Why the document is not shown: a shared portal failure, or the document's own sentence. */
export type HomeContractProblem = { failure: ShownPortalFailure } | { own: 'gone' | 'loadFailed' };

/**
 * The Execution tab's contract document, read the first time the client opens
 * it and kept after that: hiding and showing it again reads nothing, so the
 * lines a client has loaded stay. One read at a time; a failed one keeps the
 * document closed and says why. `initial` is the document the page read with
 * it (a contract awaiting the client's signature): it starts open, and no
 * read is made for it.
 */
export function useHomeContract(token: string, contractId: string, initial: ContractDocument | null) {
  const [document, setDocument] = useState(initial);
  const [open, setOpen] = useState(initial !== null);
  const [problem, setProblem] = useState<HomeContractProblem | null>(null);
  const [pending, startTransition] = useTransition();
  // Up from the tap until a read fails: two taps in the same tick (before the
  // render `pending` waits for) read once, and a document in hand is never read again.
  const asked = useRef(false);

  function toggle() {
    if (document) {
      setOpen((shown) => !shown);
      return;
    }
    if (asked.current) return;
    asked.current = true;
    setProblem(null);
    const failed = (shown: HomeContractProblem) => {
      asked.current = false;
      setProblem(shown);
    };
    startTransition(async () => {
      try {
        const answer = await openHomeContract(token, contractId);
        if (answer.ok) {
          setDocument(answer.contract);
          setOpen(true);
        } else if (answer.error === 'gone') failed({ own: 'gone' });
        else failed({ failure: answer });
      } catch {
        failed({ own: 'loadFailed' });
      }
    });
  }

  return { document, open, problem, pending, toggle };
}
