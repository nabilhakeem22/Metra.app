import { describe, expect, it } from 'vitest';
import type { DesignEngagement, EngagementArtifact } from '@metra/db';
import {
  CONCEPT_OPTION_MAX,
  CONCEPT_OPTION_MIN,
  conceptOptionsAtCapacity,
  countConceptOptions,
} from './concept-options';
import { optionsReady } from './guards/readiness';
import type { GuardFacts } from './guards/facts';

/** A facts bundle carrying `n` concept options — all optionsReady reads. */
function factsWithConceptOptions(count: number): GuardFacts {
  return {
    engagement: {} as DesignEngagement,
    milestones: [],
    payments: [],
    artifacts: Array.from(
      { length: count },
      () => ({ kind: 'concept_option' }) as EngagementArtifact,
    ),
    changeOrders: [],
    events: [],
  };
}

describe('countConceptOptions', () => {
  it('counts only concept_option artifacts', () => {
    const artifacts = [
      { kind: 'concept_option' as const },
      { kind: 'autocad' as const },
      { kind: 'concept_option' as const },
      { kind: 'survey' as const },
      { kind: 'approved_render' as const },
    ];
    expect(countConceptOptions(artifacts)).toBe(2);
  });

  it('is 0 for an empty engagement', () => {
    expect(countConceptOptions([])).toBe(0);
  });

  // A concept option recorded through the toolbar's artifact panel carries no
  // file, but it STILL counts toward the guard — so the UI must count it too or
  // the cap could be overshot by exactly the number of fileless records.
  it('counts a fileless concept option, because the guard does', () => {
    const artifacts = [
      { kind: 'concept_option' as const },
      { kind: 'concept_option' as const },
    ];
    expect(countConceptOptions(artifacts)).toBe(2);
    expect(optionsReady(factsWithConceptOptions(2)).ok).toBe(true);
  });
});

describe('conceptOptionsAtCapacity', () => {
  it('is false below the cap and true at or above it', () => {
    expect(conceptOptionsAtCapacity(0)).toBe(false);
    expect(conceptOptionsAtCapacity(3)).toBe(false);
    expect(conceptOptionsAtCapacity(CONCEPT_OPTION_MAX)).toBe(true);
    expect(conceptOptionsAtCapacity(CONCEPT_OPTION_MAX + 1)).toBe(true);
  });
});

// TRIPWIRE. Artifacts are append-only (recording one attests it — there is no
// delete path), so an engagement pushed past the guard's cap can NEVER come back.
// The UI cap is only safe while these constants match the guard exactly; if the
// guard's range moves and these do not, this fails instead of silently
// re-opening an unrecoverable dead end.
describe('the UI cap matches the optionsReady guard exactly', () => {
  it('passes at every count from MIN to MAX inclusive', () => {
    for (let count = CONCEPT_OPTION_MIN; count <= CONCEPT_OPTION_MAX; count++) {
      expect(optionsReady(factsWithConceptOptions(count)).ok).toBe(true);
    }
  });

  it('fails just below MIN and just above MAX', () => {
    expect(optionsReady(factsWithConceptOptions(CONCEPT_OPTION_MIN - 1)).ok).toBe(
      false,
    );
    expect(optionsReady(factsWithConceptOptions(CONCEPT_OPTION_MAX + 1)).ok).toBe(
      false,
    );
  });

  it('blocks the upload at exactly the count where a further one would fail', () => {
    // At the cap the next upload would make MAX + 1, which the guard rejects —
    // so the dropzone must already be closed at MAX.
    expect(conceptOptionsAtCapacity(CONCEPT_OPTION_MAX)).toBe(true);
    expect(optionsReady(factsWithConceptOptions(CONCEPT_OPTION_MAX)).ok).toBe(true);
    expect(optionsReady(factsWithConceptOptions(CONCEPT_OPTION_MAX + 1)).ok).toBe(
      false,
    );
  });
});
