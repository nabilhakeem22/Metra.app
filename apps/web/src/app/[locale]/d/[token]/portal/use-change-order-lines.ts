'use client';

import { useRef, useState, useTransition } from 'react';
import type { PublicContractLine } from '@/lib/contracts/public-types';
import type { ShownPortalFailure } from '@/lib/share/portal-failure';
import { loadChangeOrderLines } from '../variation-actions';

/** Why the lines are not shown: a shared portal failure, or the card's own sentence. */
export type ChangeOrderLinesProblem = { failure: ShownPortalFailure } | { own: 'gone' | 'loadFailed' };

/**
 * One change order's lines, read the first time the client opens them and kept
 * after that: hiding and showing them again reads nothing. One read at a time; a
 * failed one keeps them closed, says why, and leaves the button free again.
 */
export function useChangeOrderLines(token: string, variationId: string) {
  const [lines, setLines] = useState<PublicContractLine[] | null>(null);
  const [open, setOpen] = useState(false);
  const [problem, setProblem] = useState<ChangeOrderLinesProblem | null>(null);
  const [pending, startTransition] = useTransition();
  // Up from the tap until a read fails: two taps in the same tick (before the render `pending` waits for) read once.
  const asked = useRef(false);

  function toggle() {
    if (lines) {
      setOpen((shown) => !shown);
      return;
    }
    if (asked.current) return;
    asked.current = true;
    setProblem(null);
    const failed = (shown: ChangeOrderLinesProblem) => {
      asked.current = false;
      setProblem(shown);
    };
    startTransition(async () => {
      try {
        const answer = await loadChangeOrderLines(token, variationId);
        if (answer.ok) {
          setLines(answer.lines);
          setOpen(true);
        } else if (answer.error === 'gone') failed({ own: 'gone' });
        else failed({ failure: answer });
      } catch {
        failed({ own: 'loadFailed' });
      }
    });
  }

  return { lines, open, problem, pending, toggle };
}
