// A phase definition plus a location, as the rail and the step card draw it.
// PURE and CLIENT-SAFE. The studio sees every step and the gates between them;
// the client sees the steps grouped by `clientStep`, and never a gate.
import type {
  Actor,
  Audience,
  GateKey,
  PhaseDefinition,
  PhaseStatus,
  PhaseView,
  StepLocation,
  StepStatus,
} from './types';

interface AudienceStep {
  key: string;
  actor: Actor;
  gateBefore?: GateKey;
}

function studioSteps(definition: PhaseDefinition): AudienceStep[] {
  return definition.steps.map(({ key, defaultActor, gateBefore }) => ({
    key,
    actor: defaultActor,
    ...(gateBefore ? { gateBefore } : {}),
  }));
}

/** One step per client group, in order; a group's actor is its first step's. */
function clientSteps(definition: PhaseDefinition): AudienceStep[] {
  const steps: AudienceStep[] = [];
  for (const step of definition.steps) {
    const key = step.clientStep ?? step.key;
    if (!steps.some((existing) => existing.key === key)) steps.push({ key, actor: step.defaultActor });
  }
  return steps;
}

function stepStatus(phase: PhaseStatus, index: number, currentIndex: number): StepStatus {
  if (phase === 'complete') return 'done';
  if (phase === 'closed') return 'upcoming';
  if (index < currentIndex) return 'done';
  return index === currentIndex ? 'current' : 'upcoming';
}

/** The index of the current step while active, -1 otherwise. A step the phase lacks is a locator bug. */
function currentIndexOf(steps: AudienceStep[], definition: PhaseDefinition, at: StepLocation): number {
  if (at.status !== 'active') return -1;
  const index = steps.findIndex((step) => step.key === at.step);
  // developer-only: the message carries a step key and a phase key from code definitions, never a person's data.
  if (index < 0) throw new Error(`step ${String(at.step)} is not a step of the ${definition.key} phase`);
  return index;
}

export function buildPhaseView(definition: PhaseDefinition, at: StepLocation, audience: Audience): PhaseView {
  const steps = audience === 'studio' ? studioSteps(definition) : clientSteps(definition);
  const currentIndex = currentIndexOf(steps, definition, at);
  return {
    key: definition.key,
    status: at.status,
    steps: steps.map((step, index) => ({
      ...step,
      status: stepStatus(at.status, index, currentIndex),
      actor: index === currentIndex && at.whoseMove ? at.whoseMove : step.actor,
    })),
    currentStep: currentIndex < 0 ? null : steps[currentIndex].key,
    whoseMove: at.whoseMove,
    atGate: audience === 'studio' ? (at.atGate ?? null) : null,
  };
}
