import type { EngagementGatePreview } from './gate-preview';
import { conceptOptionsAtCapacity } from './concept-options';
import { MONEY_GUARD_MILESTONE } from './guards/trigger-money-gate';
import { inlineDropzoneCategory } from './inline-dropzone-category';
import { stateMilestone } from './journey-map';
import type { CommandCardMode } from './command-card';
import type { DesignState } from './states';

// WHICH CONTROLS the command card offers, as a pure function. No React, no
// `server-only`, no db.
//
// MONEY_GUARD_MILESTONE is imported from the LEAF (guards/trigger-money-gate),
// not the guards barrel: the barrel also re-exports GUARDS from ./registry, which
// would drag the whole guard engine (registry -> readiness/money -> transitions)
// into the client chunk that reads this. That heavy, cycle-prone graph can
// evaluate a binding as `undefined` at client module-init (vitest even deadlocks
// importing it) and throw at render. The leaf carries only the pure
// MONEY_GUARD_MILESTONE map + erased types — no registry, no cycle.

type MilestoneKind = (typeof MONEY_GUARD_MILESTONE)[keyof typeof MONEY_GUARD_MILESTONE];

export interface CommandCardCtas {
  /** The pay-and-advance path: a blocking money gate whose shortfall we can pre-fill. */
  showPayCta: boolean;
  paymentKind: MilestoneKind | undefined;
  paymentItem: EngagementGatePreview['items'][number] | undefined;
  /** The off-plan toggle only makes sense before the survey branch — the proposal
   *  milestone (created / design_proposal), and only for a role that may update. */
  atProposal: boolean;
  /** The inline attachment dropzone's category, or null when this stage has none. */
  dropzoneCategory: ReturnType<typeof inlineDropzoneCategory>;
  /** Concept options are append-only and capped at four by `optionsReady`, so the
   *  dropzone stops OFFERING an upload at the cap rather than letting the studio
   *  walk into a state with no way back. The other categories have no cap. */
  dropzoneAtCapacity: boolean;
  /**
   * Is the stage's literal act ALREADY a control on this card? When the studio is
   * blocked and the inline dropzone is the thing that clears it, the dropzone IS
   * the act — worded from the same registry row as the headline — and the disabled
   * Advance underneath is a second, dead, differently-worded button for the same
   * move. That is the duplication Option D exists to remove, so it goes.
   *
   * It STAYS in the blocked states with no dropzone (created, the Gate-B holds):
   * there nothing else on the card names the forward move, and a disabled button
   * that says what you are working toward is better than no button at all.
   */
  actOnCard: boolean;
}

export function resolveCommandCardCtas(
  preview: EngagementGatePreview,
  options: {
    canRecordPayment: boolean;
    canAdvance: boolean;
    canUpload: boolean;
    state: DesignState;
    mode: CommandCardMode;
    closed: boolean;
    conceptOptionCount: number;
  },
): CommandCardCtas {
  // `amountDue` is only set on a blocking payment gate (see gate-preview).
  const paymentItem = preview.items.find(
    (item) => !item.ok && MONEY_GUARD_MILESTONE[item.guard] && item.amountDue,
  );
  const paymentKind = paymentItem ? MONEY_GUARD_MILESTONE[paymentItem.guard] : undefined;

  const dropzoneCategory = inlineDropzoneCategory(options.state);
  const dropzoneAtCapacity =
    dropzoneCategory === 'conceptOption' &&
    conceptOptionsAtCapacity(options.conceptOptionCount);

  return {
    paymentItem,
    paymentKind,
    showPayCta: Boolean(
      preview.primaryTrigger &&
        paymentItem &&
        paymentKind &&
        options.canRecordPayment &&
        options.canAdvance,
    ),
    atProposal: !options.closed && stateMilestone(options.state).index === 0,
    dropzoneCategory,
    dropzoneAtCapacity,
    actOnCard:
      options.mode === 'blockedStudio' &&
      dropzoneCategory !== null &&
      options.canUpload &&
      !dropzoneAtCapacity,
  };
}
