// Design-Engagement Machine — the Commercial Pulse read-model (Epic D, Slice 4).
// PURE and side-effect-free: it computes the cockpit's 3-cell commercial strip
// (contract total · collected-to-date · pending gate) from data the detail page
// has ALREADY loaded — the fee schedule (milestones + design fee) and the payment
// ledger — so it triggers NO extra DB round-trip. All money is scale-4 BigInt via
// the shared money engine (never parseFloat); the caller serializes the returned
// strings/number/null across the server -> client boundary. It re-uses the guard's
// `milestoneRequired4` so the "amount due" it surfaces is the SAME figure the
// state machine admits — no reinvented formula.
//
// This module only TYPE-imports the `@metra/db`-derived query shapes (fully erased),
// so it stays runtime-safe; the client pulse bar imports only its `CommercialPulse`
// type. It is computed on the server (page.tsx) and never itself does I/O.
import type { MilestoneKind } from '@metra/db';
import { formatMoney4, parseMoney4 } from '@/lib/aggregates/proposal-totals';
import { milestoneRequired4 } from './guards';
import { PHASE_GROUPS, phaseIndex, phaseOf, type PhaseKey } from './phases';
import type { EngagementFeeSchedule, EngagementPayment } from './queries';
import { isTerminal, type DesignState } from './states';
import { TRANSITIONS, type Trigger } from './transitions';

/** The three PAYING gate milestones, in the order money is collected. */
type GateKind = 'deposit' | 'gate_a' | 'gate_b';
const GATE_ORDER: readonly GateKind[] = ['deposit', 'gate_a', 'gate_b'];

/**
 * Each paying gate mapped to the wired trigger whose money guard clears it. Used
 * ONLY to derive the phase the gate unlocks (see {@link gateUnlocksPhase}) — the
 * pulse never fires these triggers.
 */
const GATE_TRIGGER: Record<GateKind, Trigger> = {
  deposit: 'confirmAndPayDeposit',
  gate_a: 'selectConcept',
  gate_b: 'approveDesign',
};

/** The next un-cleared paying gate: what is still owed and what it opens. */
export interface PendingGate {
  /** Which gate is outstanding — labels the "clears {gate}" line. */
  gate: GateKind;
  /** The scale-4 shortfall still owed on this gate (required − paid, clamped ≥ 0). */
  amountDue: string;
  /** The phase clearing this gate leads into, or null if it opens no further phase. */
  unlocksPhaseKey: PhaseKey | null;
}

/** The commercial pulse: contract total, collection progress, next paying gate. */
export interface CommercialPulse {
  /** Σ of every milestone amount (scale-4 string). */
  contractTotal: string;
  /** Σ of cleared payments against contract milestones (scale-4 string). */
  collected: string;
  /** `collected` as an integer percent of `contractTotal` (0 when total is 0). */
  collectedPct: number;
  /** The next un-cleared paying gate, or null when nothing is outstanding. */
  pendingGate: PendingGate | null;
}

/**
 * The phase clearing a gate leads INTO: the first phase AFTER the phase the gate's
 * advance departs from. Derived from the machine (the gate trigger's origin state)
 * + the phase groups, so it can never drift from either. Concretely: `deposit`
 * (from design_proposal / proposal_survey) -> concept_layout; `gate_a` (from
 * concept_review / concept_layout) -> threed_approvals; `gate_b` (from
 * final_approval / threed_approvals) -> documentation_boq. Returns null if the
 * origin sits in the last phase (no further phase to unlock).
 */
function gateUnlocksPhase(gate: GateKind): PhaseKey | null {
  const from = TRANSITIONS[GATE_TRIGGER[gate]].from;
  const originState: DesignState = Array.isArray(from) ? from[0] : from;
  const originPhase = phaseOf(originState);
  if (!originPhase) return null;
  return PHASE_GROUPS[phaseIndex(originPhase) + 1]?.key ?? null;
}

/** Σ of the payment ledger's cleared amounts of one kind (scale-4 BigInt). */
function paidForKind(
  payments: EngagementPayment[],
  kind: MilestoneKind,
): bigint {
  return payments.reduce(
    (sum, payment) =>
      payment.kind === kind ? sum + parseMoney4(payment.amount) : sum,
    0n,
  );
}

/**
 * Build the commercial pulse from the engagement's already-loaded fee schedule,
 * payment ledger, and current state.
 *   - `contractTotal` = Σ of every milestone's resolved amount.
 *   - `collected`     = Σ of cleared payments whose kind matches a scheduled
 *                       milestone kind (revision change-order receipts are NOT part
 *                       of the contract total, so they are excluded — keeping the
 *                       percent apples-to-apples).
 *   - `collectedPct`  = collected / contractTotal, integer, guarded at 0 total.
 *   - `pendingGate`   = the first paying gate (deposit -> gate_a -> gate_b) with a
 *                       positive shortfall; null when none is outstanding OR the
 *                       engagement is terminal (a closed/abandoned engagement
 *                       unlocks nothing further — the honest reading).
 */
export function computeCommercialPulse(input: {
  feeSchedule: EngagementFeeSchedule;
  payments: EngagementPayment[];
  state: DesignState;
}): CommercialPulse {
  const { milestones, designFee } = input.feeSchedule;
  const { payments, state } = input;

  let contractTotal4 = 0n;
  for (const milestone of milestones) {
    const required = milestoneRequired4(
      milestone.basis,
      milestone.value,
      designFee,
    );
    if (required !== null) contractTotal4 += required;
  }

  const scheduledKinds = new Set<string>(milestones.map((m) => m.kind));
  let collected4 = 0n;
  for (const payment of payments) {
    if (scheduledKinds.has(payment.kind)) {
      collected4 += parseMoney4(payment.amount);
    }
  }

  const collectedPct =
    contractTotal4 > 0n
      ? Number((collected4 * 100n + contractTotal4 / 2n) / contractTotal4)
      : 0;

  let pendingGate: PendingGate | null = null;
  if (!isTerminal(state)) {
    for (const gate of GATE_ORDER) {
      const milestone = milestones.find((m) => m.kind === gate);
      if (!milestone) continue; // absent milestone = free gate, nothing due
      const required = milestoneRequired4(
        milestone.basis,
        milestone.value,
        designFee,
      );
      if (required === null) continue;
      const shortfall = required - paidForKind(payments, gate);
      if (shortfall > 0n) {
        pendingGate = {
          gate,
          amountDue: formatMoney4(shortfall),
          unlocksPhaseKey: gateUnlocksPhase(gate),
        };
        break;
      }
    }
  }

  return {
    contractTotal: formatMoney4(contractTotal4),
    collected: formatMoney4(collected4),
    collectedPct,
    pendingGate,
  };
}
