'use client';

import { useRef, useState, useTransition } from 'react';
import { unansweredFailure, type ShownPortalFailure } from '@/lib/share/portal-failure';
import { acknowledgeContract } from './actions';
import { contractOutcomeOf, type ContractOutcome } from './contract-outcome';

/**
 * The client's acknowledgement on a contract link. Acknowledge is never
 * disabled for a blank name: pressing it marks the name box and moves the caret
 * there (`nameMissing`). An answer that never landed keeps the acknowledgement
 * open, with its failure said (`failure`).
 */
export function useContractAck(token: string) {
  const [pending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<ContractOutcome>(null);
  const [failure, setFailure] = useState<ShownPortalFailure | null>(null);
  const [name, setNameValue] = useState('');
  const [nameMissing, setNameMissing] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  function acknowledge() {
    setFailure(null);
    if (!name.trim()) {
      setNameMissing(true);
      nameRef.current?.focus();
      return;
    }
    startTransition(async () => {
      try {
        const res = await acknowledgeContract(token, name);
        const failed = unansweredFailure(res);
        if (failed) setFailure(failed);
        else setOutcome(contractOutcomeOf(res));
      } catch (rejection) {
        setFailure({ rejection });
      }
    });
  }

  return {
    pending,
    outcome,
    failure,
    name,
    nameMissing,
    nameRef,
    setName(value: string) {
      setNameMissing(false);
      setNameValue(value);
    },
    acknowledge,
  };
}
