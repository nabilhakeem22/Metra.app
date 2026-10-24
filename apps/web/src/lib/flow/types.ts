// The STEP ENGINE's vocabulary: a flow is an ordered list of phases, a phase an
// ordered list of steps, and every step has the actor who usually holds it.
// PURE and CLIENT-SAFE (types only): the studio cockpit and the client's
// delivery page read the same engine, so the two can never disagree about where
// a job is.
//
// Nothing here is stored. A position is DERIVED from facts the app already has
// (the design machine state, the execution stage, the client page's facts) by a
// locator in ./locate, and ./build-view turns it into what a rail draws.
import type { SpineGateKey } from '@/lib/engagements/stage-spine';

/** Who holds a step: the studio, its client, or the people on site. */
export type Actor = 'studio' | 'client' | 'site';

export type PhaseKey = 'design' | 'execution';

/** The phase a delivery starts in (`design_engagements.entry_phase`, plan step C). */
export type EntryPhase = PhaseKey;

/** Who a view is drawn for: the studio sees every step and gate, the client sees grouped steps. */
export type Audience = 'studio' | 'client';

export type StepStatus = 'done' | 'current' | 'upcoming';

/**
 * `active` while work is under way, `complete` once every step is behind the job,
 * `closed` when it stopped without finishing (an abandoned design, a terminated
 * contract): nothing is current then.
 */
export type PhaseStatus = 'active' | 'complete' | 'closed';

/** A money gate drawn between two design steps (lib/engagements/stage-spine.ts). */
export type GateKey = SpineGateKey;

export interface StepDefinition<K extends string = string> {
  key: K;
  defaultActor: Actor;
  /** The gate drawn just before this step. Studio decoration only: a client never sees a gate. */
  gateBefore?: GateKey;
  /** The client's step this one is grouped under; absent means the step is its own client step. */
  clientStep?: string;
}

export interface PhaseDefinition<K extends string = string> {
  key: PhaseKey;
  steps: readonly StepDefinition<K>[];
}

/** Where a job is in one phase, as a locator reads it from the facts. */
export interface StepLocation<K extends string = string> {
  /** The step the job is on; the last step once complete; null once closed. */
  step: K | null;
  /** Who holds the move now; null when nobody does (complete, closed). */
  whoseMove: Actor | null;
  status: PhaseStatus;
  /** The gate the job is waiting AT (studio design view only). */
  atGate?: GateKey;
}

export interface StepView {
  key: string;
  status: StepStatus;
  /** Who holds this step: the live whose-move on the current step, the default actor elsewhere. */
  actor: Actor;
  gateBefore?: GateKey;
}

export interface PhaseView {
  key: PhaseKey;
  status: PhaseStatus;
  steps: StepView[];
  /** The current step's key while the phase is active, else null. */
  currentStep: string | null;
  whoseMove: Actor | null;
  /** The gate the job is waiting at, highlighted on the rail; always null for the client. */
  atGate: GateKey | null;
}
