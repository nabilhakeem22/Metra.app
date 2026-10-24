// The EXECUTION phase: what happens after the design machine reaches
// `execution`, hung off the BOQ contract. PURE and CLIENT-SAFE. The studio and
// the client see the same five steps.
import type { PhaseDefinition } from '../types';

export type ExecutionStepKey = 'contract' | 'signature' | 'works' | 'final_account' | 'settled';

export const EXECUTION_PHASE: PhaseDefinition<ExecutionStepKey> = {
  key: 'execution',
  steps: [
    { key: 'contract', defaultActor: 'studio' },
    { key: 'signature', defaultActor: 'client' },
    { key: 'works', defaultActor: 'site' },
    { key: 'final_account', defaultActor: 'studio' },
    { key: 'settled', defaultActor: 'studio' },
  ],
};
