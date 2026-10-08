import 'server-only';
// Design-Engagement Machine — transitions that are the CONSEQUENCE of an act that
// already decided them (Round C): the BOQ was sent, so the BOQ step is done; the
// client confirmed the handover the studio had chosen, so the delivery closes.
// The same pipeline as `executeTransition` (./run.ts: role gate, capability
// gate, guards, atomic state gate, ledger, audit), so no new authority: the
// caller's role must still be allowed the edge and its guard must still pass.
// Two things differ: the ledger row names the caller or no one (`ledgerActor`),
// and the audit's `after` carries the cause.
//
// NEVER re-exported from a server-action module: no browser can name a
// consequence. No payload and no idempotency key: both edges advance, so the
// state gate is the idempotency. A consequence never fires an ending: an edge
// with a per-trigger decider list (`decidedBy`) is refused here as well.
import { err, type ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { TRANSITIONS, type Trigger } from '../transitions';
import { runGatedTransition } from './run';

export type TransitionConsequence = 'boqSent' | 'handoverAcknowledged';

export const CONSEQUENCES: Readonly<
  Record<TransitionConsequence, { trigger: Trigger; ledgerActor: 'caller' | 'none' }>
> = {
  boqSent: { trigger: 'finalizeBOQ', ledgerActor: 'caller' },
  handoverAcknowledged: { trigger: 'recipientAcknowledges', ledgerActor: 'none' },
};

export async function executeConsequence(
  ctx: OrgContext,
  input: { engagementId: string; consequence: TransitionConsequence },
): Promise<ActionResult> {
  const consequence = CONSEQUENCES[input.consequence];
  if (!consequence) return err('illegal_trigger');
  const def = TRANSITIONS[consequence.trigger];
  if (def.decidedBy !== undefined) return err('ending_requires_explicit_choice');
  return runGatedTransition(
    ctx,
    def,
    { engagementId: input.engagementId, trigger: consequence.trigger },
    {
      ledgerActorUserId: consequence.ledgerActor === 'caller' ? ctx.userId : null,
      cause: input.consequence,
    },
  );
}
