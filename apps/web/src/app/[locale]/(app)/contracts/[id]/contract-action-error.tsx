'use client';

import { DesignFirstLink } from '@/components/contracts/design-first-link';
import { describeFailure, describeRejection, type Translate } from '@/lib/actions/error-message';
import type { ActionResult } from '@/lib/actions/result';
import { designFirstTargetOf, type DesignFirstTarget } from '@/lib/engagements/design-first';

/** A refused contract-page act: the sentence, and the delivery it sends the studio to. */
export interface ContractActionFailure {
  message: string;
  target: DesignFirstTarget | null;
}

export function contractFailureOf(result: ActionResult, translate: Translate): ContractActionFailure {
  return { message: describeFailure(result, translate), target: designFirstTargetOf(result) };
}

export function contractRejectionOf(rejection: unknown, translate: Translate): ContractActionFailure {
  return { message: describeRejection(rejection, translate), target: null };
}

/** Said at the top of the contract page, above its tabs. */
export function ContractActionError({ failure }: { failure: ContractActionFailure | null }) {
  if (!failure) return null;
  return (
    <div>
      <p className="text-body text-destructive" role="alert">
        {failure.message}
      </p>
      <DesignFirstLink target={failure.target} />
    </div>
  );
}
