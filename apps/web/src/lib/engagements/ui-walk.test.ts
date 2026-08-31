import type {
  DesignEngagement,
  EngagementArtifact,
  EngagementArtifactKind,
} from '@metra/db';
import { describe, expect, it } from 'vitest';
import {
  CONCEPT_OPTION_MAX,
  CONCEPT_OPTION_MIN,
  conceptOptionsAtCapacity,
} from './concept-options';
import { CATEGORY_WRITE_KIND } from './deliverable-files';
// The REAL resolve the cockpit runs — not a copy. It lives in a pure leaf
// precisely so this test can call the same function `gate-preview` calls; a
// replica here could drift and hand back exactly the false confidence this file
// exists to prevent.
import { resolveForwardTrigger } from './forward-trigger';
import { GUARDS, type GuardFacts, type GuardKey } from './guards';
import { inlineDropzoneCategory } from './inline-dropzone-category';
import {
  DESIGN_STATES,
  STAGE_NUMBER,
  isTerminal,
  type DesignState,
} from './states';
import { TRANSITIONS, WIRED_TRIGGERS } from './transitions';

// THE UI WALK — "can the cockpit satisfy the gate it is showing?"
//
// The full-walk dbtest drives `executeTransition` DIRECTLY, so it proves the
// MACHINE can advance; it never asks whether the UI in front of the studio can
// produce the facts that advance it. Two production dead-ends slipped through
// that blind spot with every test green:
//   1. at `layout` the forward gate was `optionsReady` (2–4 `concept_option`)
//      while the card's own dropzone wrote `autocad` — uploading through the
//      button UNDER the gate could never clear it;
//   2. at `survey` the forward gate was `spatialBaseReady` (a `survey`
//      artifact) and the card offered no dropzone at all.
// Both were found by hand-checking guards one at a time. This file automates
// that check and makes it EXHAUSTIVE BY CONSTRUCTION: every `GuardKey` must
// carry a declaration of HOW the UI satisfies it, and every `DesignState` must
// either be terminal, resolve a forward trigger whose dropzone-backed guards the
// card can actually feed, or be explicitly listed. A new guard or a new state
// FAILS here until someone writes down the answer.
//
// PURE UNIT TEST — no DB, no `server-only`. Only the pure leaves are imported.

// ---------------------------------------------------------------------------
// The declaration: every guard, and how the UI clears it.
// ---------------------------------------------------------------------------

type Satisfier =
  /** The command card's own inline dropzone at that state records the artifact. */
  | { via: 'cardDropzone'; kind: EngagementArtifactKind; min?: number }
  /** A named non-dropzone path — a form, a toolbar panel, a portal action, money. */
  | { via: 'affordance'; what: string }
  /**
   * `pendingGuard` — the fail-closed sentinel. It is still REGISTERED in
   * `GUARDS` but, since the 3D revision loop was wired, it is referenced by NO
   * transition. Kept declared so the sentinel stays available for the next
   * declared-but-unbuilt edge, and so the rule below keeps forbidding it on any
   * trigger the cockpit offers.
   */
  | { via: 'unwired' };

/**
 * How the cockpit satisfies each guard. Typed as a TOTAL `Record<GuardKey, …>`
 * so `tsc` rejects a new guard that nobody has answered for, and re-checked
 * against the live `GUARDS` registry below so a rename fails BY NAME.
 *
 * The `cardDropzone` entries are not taken on trust: each one is re-run against
 * the real guard further down, so if a guard changes what it counts, the claim
 * here is provably wrong rather than quietly stale.
 */
const SATISFIED_BY: Record<GuardKey, Satisfier> = {
  // --- artifact-backed: the studio clears these by dropping a file on the card.
  spatialBaseReady: {
    via: 'cardDropzone',
    kind: 'survey',
    // The CARD path is the measured survey. An OFF-PLAN engagement may instead
    // clear the same guard with a developer CAD set (`autocad`) recorded through
    // the working-files tray's `layout` slot — a second, tray-side path that does
    // not change what the card must offer on a normal job. The tripwire below
    // therefore pins the strict (non-off-plan) reading.
  },
  optionsReady: {
    via: 'cardDropzone',
    kind: 'concept_option',
    min: CONCEPT_OPTION_MIN,
  },
  rendersPresent: { via: 'cardDropzone', kind: 'approved_render' },
  shopDrawingsPresent: { via: 'cardDropzone', kind: 'shop_drawing' },
  boqPresent: { via: 'cardDropzone', kind: 'boq' },

  // --- form / panel / portal / money: cleared somewhere other than the dropzone.
  scopeInputsPresent: {
    via: 'affordance',
    what: 'engagement create form (Arabic/English title + client + project)',
  },
  depositCleared: {
    via: 'affordance',
    what: 'payment claim -> studio confirm, or the command card pay-and-advance form (kind: deposit)',
  },
  gateAInstallmentCleared: {
    via: 'affordance',
    what: 'payment claim -> studio confirm, or the command card pay-and-advance form (kind: gate_a)',
  },
  gateBInstallmentCleared: {
    via: 'affordance',
    what: 'payment claim -> studio confirm, or the command card pay-and-advance form (kind: gate_b)',
  },
  balanceCleared: {
    via: 'affordance',
    what: 'payment claim -> studio confirm, or the command card pay-and-advance form (kind: balance)',
  },
  revisionCosSettled: {
    via: 'affordance',
    what: 'toolbar payment panel recording a revision_co receipt against the raised change orders',
  },
  romAcknowledged: {
    via: 'affordance',
    what: 'client portal ROM ack, or the toolbar ROM-ack panel (staff stand-in)',
  },
  handoffAcknowledged: {
    via: 'affordance',
    what: 'client portal acknowledge_handoff, or the toolbar handoff-ack panel (staff stand-in)',
  },
  asBuiltReconciled: {
    via: 'affordance',
    what: 'attestAsBuiltClean secondary action (trivially satisfied when as-built is not due)',
  },
  asBuiltDueOpen: {
    via: 'affordance',
    what: 'off-plan toggle on the command card — as_built_due is set at confirmAndPayDeposit for an off-plan job',
  },

  // --- the fail-closed sentinel: registered, but on no edge at all.
  pendingGuard: { via: 'unwired' },
};

/**
 * States whose inline dropzone deliberately writes a kind that is NOT what their
 * own forward gate reads. Allowlisted WITH A REASON rather than weakening the
 * converse rule — an unexplained mismatch is exactly the layout bug.
 */
const DROPZONE_NOT_FOR_ITS_OWN_GATE: Partial<Record<DesignState, string>> = {
  concept_review:
    'the studio is still presenting concept options here, but the forward gate (selectConcept) is the Gate-A money installment — the upload is legitimate, it just is not what opens the gate',
  negotiation:
    'a revision produces another concept option, while the forward gate (confirmConcept) is change-order settlement — same shape as concept_review',
};

/**
 * States that are non-terminal yet intentionally have NO forward trigger. Empty
 * today: every active state advances. A newly added state lands here only if
 * someone decides it is a dead end on purpose.
 */
const STATES_INTENTIONALLY_WITHOUT_FORWARD_TRIGGER: ReadonlySet<DesignState> =
  new Set<DesignState>();

// ---------------------------------------------------------------------------
// Fixtures — a full (uncast) fact bundle, so a schema widening fails loudly.
// ---------------------------------------------------------------------------

const ENGAGEMENT_ID = '11111111-1111-4111-8111-111111111111';
const ORG_ID = '22222222-2222-4222-8222-222222222222';
const EPOCH = new Date('2026-01-01T00:00:00Z');

/** A plain, non-off-plan engagement — the STRICTEST reading of every guard. */
function engagement(): DesignEngagement {
  return {
    id: ENGAGEMENT_ID,
    orgId: ORG_ID,
    createdAt: EPOCH,
    updatedAt: EPOCH,
    number: 1,
    titleAr: 'تشطيب',
    titleEn: 'Fit-out',
    clientId: '33333333-3333-4333-8333-333333333333',
    projectId: '44444444-4444-4444-8444-444444444444',
    state: 'created',
    designFee: null,
    offPlan: false,
    asBuiltDue: false,
    freeRevisionN: 3,
    revisionCount: 0,
    freeDesignRevisionN: 3,
    designRevisionCount: 0,
    romLow: null,
    romHigh: null,
    conceptLockedAt: null,
    renderManifestHash: null,
    rendersReadyAt: null,
    tokenHash: null,
    shareExpiresAt: null,
  };
}

/** One FILE-BEARING artifact of `kind`, attested against the fixture engagement. */
function artifact(kind: EngagementArtifactKind, index: number): EngagementArtifact {
  return {
    id: `${kind}-${index}`,
    orgId: ORG_ID,
    createdAt: EPOCH,
    updatedAt: EPOCH,
    engagementId: ENGAGEMENT_ID,
    kind,
    fileId: `file-${kind}-${index}`,
    contentHash: null,
    label: null,
    attestedBy: '55555555-5555-4555-8555-555555555555',
    attestedAt: EPOCH,
    note: null,
    clientVisible: false,
  };
}

/** The fact bundle a run of `count` card uploads of `kind` would leave behind. */
function factsAfterCardUploads(
  kind: EngagementArtifactKind,
  count: number,
): GuardFacts {
  return {
    engagement: engagement(),
    milestones: [],
    payments: [],
    artifacts: Array.from({ length: count }, (_, index) => artifact(kind, index)),
    changeOrders: [],
    events: [],
  };
}

// ---------------------------------------------------------------------------

const GUARD_KEYS = Object.keys(GUARDS) as GuardKey[];

type CardDropzoneSatisfier = Extract<Satisfier, { via: 'cardDropzone' }>;

const CARD_DROPZONE_CLAIMS: {
  guard: GuardKey;
  satisfier: CardDropzoneSatisfier;
}[] = (Object.entries(SATISFIED_BY) as [GuardKey, Satisfier][]).flatMap(
  ([guard, satisfier]) =>
    satisfier.via === 'cardDropzone' ? [{ guard, satisfier }] : [],
);

/** Plain English for what the command card actually offers at a state. */
function describeCardOffer(state: DesignState): string {
  const category = inlineDropzoneCategory(state);
  if (category === null) return 'NO inline dropzone at all';
  return `a "${category}" dropzone that writes "${CATEGORY_WRITE_KIND[category]}"`;
}

describe('SATISFIED_BY covers the guard registry exactly', () => {
  it('declares one satisfier for every registered guard, and no extras', () => {
    // Driven off the live registry (not a hand-copied list) so a NEW guard fails
    // here BY NAME with nowhere to hide.
    expect(Object.keys(SATISFIED_BY).sort()).toEqual([...GUARD_KEYS].sort());
  });

  it('names a concrete affordance for every non-dropzone, non-unwired guard', () => {
    for (const [guard, satisfier] of Object.entries(SATISFIED_BY) as [
      GuardKey,
      Satisfier,
    ][]) {
      if (satisfier.via !== 'affordance') continue;
      expect(
        satisfier.what.trim().length,
        `${guard} is declared 'affordance' but names no path — "how does the studio clear this?" must have an answer someone can navigate to.`,
      ).toBeGreaterThan(0);
    }
  });

  it('no WIRED trigger is gated by a guard declared unwired', () => {
    // Stronger than the per-state rule below (which only inspects the ONE forward
    // trigger the cockpit resolves): a wired trigger reachable as a SECONDARY
    // action — designChangeRaised is exactly that — must not sit behind a guard
    // that always denies, or the studio gets a button that can never succeed.
    for (const trigger of WIRED_TRIGGERS) {
      for (const guard of TRANSITIONS[trigger].guards) {
        expect(
          SATISFIED_BY[guard].via,
          `"${trigger}" is in WIRED_TRIGGERS but is gated by "${guard}", declared 'unwired' (always denies). Wire the guard, or take the trigger back out of WIRED_TRIGGERS.`,
        ).not.toBe('unwired');
      }
    }
  });
});

describe('every cardDropzone claim is re-checked against the real guard', () => {
  // This is what keeps SATISFIED_BY honest: the map says "the card clears this by
  // recording N of kind K", so record exactly N of kind K and make the ACTUAL
  // guard agree. If a guard changes what it counts, the claim breaks here first.
  for (const { guard, satisfier } of CARD_DROPZONE_CLAIMS) {
    const min = satisfier.min ?? 1;

    it(`${guard}: passes on exactly ${min} × "${satisfier.kind}" from the card`, () => {
      expect(
        GUARDS[guard](factsAfterCardUploads(satisfier.kind, min)),
        `SATISFIED_BY claims ${guard} is cleared by ${min} × "${satisfier.kind}" uploaded through the card, but the real guard still refuses. The map is now lying about how the UI clears this gate.`,
      ).toEqual({ ok: true });
    });

    it(`${guard}: fails with zero "${satisfier.kind}"`, () => {
      expect(
        GUARDS[guard](factsAfterCardUploads(satisfier.kind, 0)).ok,
        `${guard} passes with NO "${satisfier.kind}" artifacts, so the dropzone claim in SATISFIED_BY proves nothing — either the guard no longer reads this kind, or it stopped failing closed.`,
      ).toBe(false);
    });

    if (min > 1) {
      it(`${guard}: fails just below the declared minimum (${min - 1})`, () => {
        expect(
          GUARDS[guard](factsAfterCardUploads(satisfier.kind, min - 1)).ok,
          `SATISFIED_BY declares min ${min} for ${guard}, but the real guard already passes at ${min - 1} × "${satisfier.kind}" — the declared minimum is wrong.`,
        ).toBe(false);
      });
    }
  }
});

describe('the concept-option cap never hides the dropzone before the gate opens', () => {
  // The command card does NOT offer the dropzone unconditionally: concept options
  // are append-only and capped, so `EngagementCommandCard` stops offering an
  // upload once `conceptOptionsAtCapacity` is true. That is the one place where
  // "the card offers a dropzone" (the rule above) and "the studio can actually
  // upload" come apart — so pin the two numbers against each other. If either the
  // cap or the guard's range moved independently, the studio could be shut out of
  // uploading at a count that does not yet clear `optionsReady`: stranded, with a
  // dropzone-shaped hole where the next action should be.
  it('is at capacity only at a count that already satisfies optionsReady', () => {
    expect(
      conceptOptionsAtCapacity(CONCEPT_OPTION_MAX),
      `The card hides the concept-option dropzone from ${CONCEPT_OPTION_MAX} onward, so ${CONCEPT_OPTION_MAX} must BE the capacity — it is not.`,
    ).toBe(true);
    expect(
      GUARDS.optionsReady(factsAfterCardUploads('concept_option', CONCEPT_OPTION_MAX)),
      `The card stops offering uploads at ${CONCEPT_OPTION_MAX} concept options, but optionsReady does NOT pass at ${CONCEPT_OPTION_MAX}. The studio would be stranded: no way to add another option (append-only, no delete path) and no way to advance.`,
    ).toEqual({ ok: true });
  });

  it('keeps the dropzone open at every count that does not yet satisfy the gate', () => {
    for (let count = 0; count < CONCEPT_OPTION_MAX; count += 1) {
      const gateOpen = GUARDS.optionsReady(
        factsAfterCardUploads('concept_option', count),
      ).ok;
      if (gateOpen) continue;
      expect(
        conceptOptionsAtCapacity(count),
        `At ${count} concept options optionsReady is NOT satisfied, yet the card would hide the dropzone — the studio can neither upload nor advance. CONCEPT_OPTION_MAX (${CONCEPT_OPTION_MAX}) and the guard's accepted range (${CONCEPT_OPTION_MIN}–${CONCEPT_OPTION_MAX}) have drifted apart.`,
      ).toBe(false);
    }
  });
});

describe('every state can clear the gate its own cockpit is showing', () => {
  for (const state of DESIGN_STATES) {
    const trigger = resolveForwardTrigger(state);
    if (trigger === null) continue;

    for (const guard of TRANSITIONS[trigger].guards) {
      const satisfier = SATISFIED_BY[guard];

      if (satisfier.via === 'unwired') {
        it(`${state}: never offers the unwired guard "${guard}" as its next action`, () => {
          expect.unreachable(
            `The forward trigger "${trigger}" at "${state}" is gated by "${guard}", which is declared 'unwired' (pendingGuard — always denies). The cockpit would show a next action that can NEVER be completed. Wire the guard, or stop offering the trigger.`,
          );
        });
        continue;
      }

      if (satisfier.via !== 'cardDropzone') continue;

      it(`${state}: the card's dropzone can satisfy "${guard}"`, () => {
        const category = inlineDropzoneCategory(state);
        const written = category === null ? null : CATEGORY_WRITE_KIND[category];
        const message = [
          `HARD-STUCK: at state "${state}" the cockpit's next action is "${trigger}",`,
          `gated by "${guard}", which needs ${satisfier.min ?? 1} × "${satisfier.kind}" artifact(s).`,
          `The command card offers ${describeCardOffer(state)}.`,
          `Uploading through the button under the gate can never clear it.`,
          `Fix: map "${state}" in inline-dropzone-category.ts to a category whose CATEGORY_WRITE_KIND is "${satisfier.kind}",`,
          `or, if this gate is genuinely cleared elsewhere, re-declare "${guard}" in SATISFIED_BY as an { via: 'affordance' } and name the path.`,
        ].join(' ');

        expect(written, message).toBe(satisfier.kind);
      });
    }
  }

  // The converse: a dropzone that writes something its own gate never reads is
  // how the `layout` dead-end looked from the other side. Either the kind is
  // relevant to the forward gate, or the state is allowlisted with a reason.
  for (const state of DESIGN_STATES) {
    const category = inlineDropzoneCategory(state);
    if (category === null) continue;

    it(`${state}: what the dropzone writes is relevant to the gate (or explained)`, () => {
      const written = CATEGORY_WRITE_KIND[category];
      const trigger = resolveForwardTrigger(state);
      const gateReadsIt =
        trigger !== null &&
        TRANSITIONS[trigger].guards.some((guard) => {
          const satisfier = SATISFIED_BY[guard];
          return satisfier.via === 'cardDropzone' && satisfier.kind === written;
        });
      const reason = DROPZONE_NOT_FOR_ITS_OWN_GATE[state];

      expect(
        gateReadsIt || reason !== undefined,
        `At "${state}" the command card writes "${written}", but the forward trigger ${
          trigger === null ? '(none)' : `"${trigger}"`
        } has no guard that reads it. Either point the state at the right category in inline-dropzone-category.ts, or add "${state}" to DROPZONE_NOT_FOR_ITS_OWN_GATE with the reason the mismatch is legitimate.`,
      ).toBe(true);
    });
  }

  it('carries no stale entry in DROPZONE_NOT_FOR_ITS_OWN_GATE', () => {
    for (const [state, reason] of Object.entries(DROPZONE_NOT_FOR_ITS_OWN_GATE) as [
      DesignState,
      string,
    ][]) {
      const category = inlineDropzoneCategory(state);
      expect(
        category,
        `"${state}" is allowlisted as a dropzone/gate mismatch but has no dropzone at all — drop the allowlist entry. (${reason})`,
      ).not.toBeNull();

      const trigger = resolveForwardTrigger(state);
      const gateReadsIt =
        trigger !== null &&
        category !== null &&
        TRANSITIONS[trigger].guards.some((guard) => {
          const satisfier = SATISFIED_BY[guard];
          return (
            satisfier.via === 'cardDropzone' &&
            satisfier.kind === CATEGORY_WRITE_KIND[category]
          );
        });
      expect(
        gateReadsIt,
        `"${state}" is allowlisted as a dropzone/gate mismatch, but its forward gate now DOES read what the dropzone writes. Remove the allowlist entry so the real rule protects this state again.`,
      ).toBe(false);
    }
  });
});

describe('the whole state space is accounted for', () => {
  for (const state of DESIGN_STATES) {
    it(`${state}: is terminal, advances, or is declared a deliberate dead end`, () => {
      const terminal = isTerminal(state);
      const trigger = resolveForwardTrigger(state);
      const declared = STATES_INTENTIONALLY_WITHOUT_FORWARD_TRIGGER.has(state);

      expect(
        terminal || trigger !== null || declared,
        `State "${state}" is not terminal, resolves NO forward trigger, and is not listed in STATES_INTENTIONALLY_WITHOUT_FORWARD_TRIGGER. The cockpit would render a card with no next action and no way out. Wire a forward transition (and add it to WIRED_TRIGGERS) or declare the dead end on purpose.`,
      ).toBe(true);
    });
  }

  it('never proposes a trigger that moves the engagement BACKWARD as "what is next"', () => {
    // `NON_FORWARD_TRIGGERS` only names rejectDesign/abandon explicitly; every
    // other backward edge is excluded by the furthest-stage rule alone. The 3D
    // revision loop (designChangeRaised: final_approval/shop_drawings ->
    // design_3d) is the live case — stage 7 loses to approveDesign's 9 and
    // draftReady's 10 — so it stays a SECONDARY action and never becomes the
    // hero's Advance. Pinned generally, so a future backward edge whose
    // destination happens to outrank the forward one fails here instead of
    // silently becoming the cockpit's next action.
    for (const state of DESIGN_STATES) {
      const trigger = resolveForwardTrigger(state);
      if (trigger === null) continue;
      expect(
        STAGE_NUMBER[TRANSITIONS[trigger].to],
        `At "${state}" (stage ${STAGE_NUMBER[state]}) the cockpit's next action is "${trigger}", which lands on "${TRANSITIONS[trigger].to}" (stage ${STAGE_NUMBER[TRANSITIONS[trigger].to]}) — a step BACKWARD. Advance would walk the engagement down the funnel.`,
      ).toBeGreaterThanOrEqual(STAGE_NUMBER[state]);
    }
  });

  it('offers no forward trigger from a terminal state', () => {
    for (const state of DESIGN_STATES) {
      if (!isTerminal(state)) continue;
      expect(
        resolveForwardTrigger(state),
        `Terminal state "${state}" resolves a forward trigger — the cockpit would offer an advance out of a closed engagement.`,
      ).toBeNull();
    }
  });

  it('carries no stale entry in STATES_INTENTIONALLY_WITHOUT_FORWARD_TRIGGER', () => {
    for (const state of STATES_INTENTIONALLY_WITHOUT_FORWARD_TRIGGER) {
      expect(
        resolveForwardTrigger(state),
        `"${state}" is declared a deliberate dead end but now resolves a forward trigger — remove it from STATES_INTENTIONALLY_WITHOUT_FORWARD_TRIGGER.`,
      ).toBeNull();
    }
  });
});
