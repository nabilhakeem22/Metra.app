// Which concept option the client chose, as the studio shows it. PURE and
// CLIENT-SAFE (no db, no server-only).
//
// The LETTER is the one SAVED with the choice (engagement_events.chosen_position,
// 0057), never the option's current position: the studio may hide or release
// options after the choice, and "Client chose option B" must keep saying B.
import type { EngagementEventKind } from '@metra/db';
import { conceptLetter, type ConceptLetter } from './concept-letter';
import { liveEvents } from './event-provenance';

/** The ledger columns this rule reads. */
export interface ConceptChoiceEvent {
  id: string;
  kind: EngagementEventKind;
  supersedesEventId: string | null;
  decidedAt: Date;
  chosenArtifactId: string | null;
  chosenPosition: number | null;
}

export interface ChosenConcept {
  artifactId: string;
  letter: ConceptLetter;
}

/**
 * The newest LIVE (not retracted) `concept_approval` that names an option with
 * a saved letter, from the client or recorded by the studio for them; null when
 * there is none.
 */
export function chosenConceptOf(events: readonly ConceptChoiceEvent[]): ChosenConcept | null {
  let newest: { at: number; choice: ChosenConcept } | null = null;
  for (const event of liveEvents([...events])) {
    const letter = conceptLetter(event.chosenPosition);
    if (event.kind !== 'concept_approval' || !event.chosenArtifactId || letter === null) continue;
    const at = event.decidedAt.getTime();
    if (newest === null || at > newest.at) {
      newest = { at, choice: { artifactId: event.chosenArtifactId, letter } };
    }
  }
  return newest?.choice ?? null;
}

/** One option the studio can name in an offline choice: released, so lettered. */
export interface LetteredConceptOption {
  id: string;
  letter: ConceptLetter;
}

/**
 * The options that carry a letter right now (`conceptPosition` from the one
 * lettering rule), in letter order: exactly what an offline choice may name
 * (owner decision Q1). Everything else is left out.
 */
export function letteredConceptOptions(
  artifacts: readonly { id: string; conceptPosition: number | null }[],
): LetteredConceptOption[] {
  return artifacts
    .flatMap((artifact) => {
      const letter = conceptLetter(artifact.conceptPosition);
      return letter ? [{ id: artifact.id, letter }] : [];
    })
    .sort((a, b) => a.letter.localeCompare(b.letter));
}
