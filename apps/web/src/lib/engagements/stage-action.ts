// Option D — the STAGE-ACTION REGISTRY. PURE and CLIENT-SAFE (the `tabs.ts` /
// `inline-dropzone-category.ts` pattern): a table of data, no React, no db, no
// server-only, so the command card renders it and a unit test reads it without a
// component tree.
//
// WHY THIS EXISTS. The card used to announce a generic step — "The next step is
// yours", "Finish the item below" — while a control somewhere else performed it.
// That is the duplication under the duplication: an announcer above, a performer
// below. This registry gives the card the LITERAL act at each stage, so the
// headline and the thing you do are the same sentence.
//
// WHAT IT DOES NOT OWN. Only the two BLOCKED modes vary by state. `ready` already
// names its act ("advance to {phase}" — the phase interpolates, so one row serves
// every state) and `closed` has nothing to name. Putting either in a per-state
// table would be sixteen identical rows pretending to be data, so `resolve`
// returns null there and the existing copy stands. That is deliberate, not an
// omission.
//
// THE ACTOR IS DERIVED, NOT DECLARED. `blockedClient` means every unmet forward
// guard is one the CLIENT clears (see `CLIENT_ACTIONABLE_GUARDS`) — so the mode
// IS the actor, computed from the machine rather than typed into a table where it
// could drift. A client row therefore cannot declare a studio imperative: the
// type has no field for one. That whole class of error is impossible by
// construction rather than caught by a lint.
//
// THE FALLBACK IS LOAD-BEARING. Metra is enterable at any stage, so a rescue
// entry into an unusual state must never render a blank hero. Every state that is
// not listed resolves to a fallback row that still reads as a sentence. It is
// written FIRST here for the same reason it should be built first: it is the only
// row guaranteed to be reachable in production.
import type { CommandCardMode } from './command-card';
import type { DesignState } from './states';

export type StageActor = 'studio' | 'client';

export interface StageAction {
  /** Who the next mover is. Client rows carry no imperative aimed at the studio. */
  actor: StageActor;
  /**
   * Message-key suffix under `engagements.stageAction` — `<actor>.<key>`, with
   * `.headline` and `.sub` beneath it. The key IS the state name wherever a row
   * exists, so a row can never be wired to the wrong copy.
   */
  key: string;
}

/**
 * States where a STUDIO blocker names a specific act. Every one of these has an
 * unmet guard the studio itself clears — a file to attach, a schedule to submit,
 * an attestation to record.
 *
 * The five states missing from this list (design_proposal, concept_review,
 * negotiation, execution_decision, design_only_handoff) are gated only by client
 * money or a client acknowledgement, so a studio blocker there is off the happy
 * path. They fall through to the fallback rather than being given invented copy.
 */
const STUDIO_ACT_STATES: ReadonlySet<DesignState> = new Set<DesignState>([
  'created',
  'survey',
  'layout',
  'design_3d',
  'final_approval',
  'shop_drawings',
  'boq',
  'change_triage',
]);

/**
 * States where waiting on the client is the normal, healthy condition — the
 * client owes money, a concept choice, a cost-range acknowledgement or a handover
 * receipt. Naming what they hold is the whole value of this row: "waiting on the
 * client" tells a studio owner nothing they did not already know.
 */
const CLIENT_WAIT_STATES: ReadonlySet<DesignState> = new Set<DesignState>([
  'design_proposal',
  'concept_review',
  'negotiation',
  'final_approval',
  'execution_decision',
  'design_only_handoff',
]);

/** The row that must never be missing. See the note at the top of this file. */
const FALLBACK_KEY = 'fallback';

/**
 * The act to name at this stage, or null when the mode already names its own
 * (`ready`, `closed`). Never throws and never returns an unrendered key: an
 * unlisted state resolves to the fallback row in the mode's own actor voice.
 */
export function resolveStageAction(
  state: DesignState,
  mode: CommandCardMode,
): StageAction | null {
  if (mode === 'blockedStudio') {
    return {
      actor: 'studio',
      key: STUDIO_ACT_STATES.has(state) ? state : FALLBACK_KEY,
    };
  }
  if (mode === 'blockedClient') {
    return {
      actor: 'client',
      key: CLIENT_WAIT_STATES.has(state) ? state : FALLBACK_KEY,
    };
  }
  return null;
}

/**
 * Every `<actor>.<key>` pair this registry can ever ask for — the fallback
 * included. The message-parity test walks this so a missing Arabic string fails
 * the suite instead of rendering a raw key at a studio in Cairo.
 */
export function stageActionKeys(): string[] {
  const studio = [...STUDIO_ACT_STATES, FALLBACK_KEY].map((k) => `studio.${k}`);
  const client = [...CLIENT_WAIT_STATES, FALLBACK_KEY].map((k) => `client.${k}`);
  return [...studio, ...client];
}
