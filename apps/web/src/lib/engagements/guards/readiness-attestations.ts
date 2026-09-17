// Design-Engagement Machine — ATTESTATION readiness (Steps 12/13/14 and the tail
// wiring). PURE and CLIENT-SAFE: the gates that ask "did somebody ATTEST to
// this?" — the client's ROM acknowledgement, the as-built reconciliation, whether
// the as-built drawings are due at all, and the handoff acknowledgement. They
// read the append-only event ledger, which is why they carry the newest-first
// ordering and the band comparison as private helpers. This file is
// `guards/readiness.ts` renamed (wave 4); scope and the artifact gates moved to
// their own leaves, and the fail-closed sentinel was deleted: no edge used it,
// and GuardKey no longer HAS a value for an edge to route through.
import type { EngagementEvent } from '@metra/db';
import { acknowledgesIssuance } from '../rom-ack';
import { pass, type GuardFacts, type GuardResult } from './facts';

/** A numeric(18,4) string in a comparable form: no leading zeros, no trailing
 *  fractional zeros, so '1800000' and '1800000.0000' are the same amount. */
function normalizedAmount(value: string): string {
  const [whole, fraction = ''] = value.trim().split('.');
  return `${whole.replace(/^\+?0+(?=\d)/, '')}.${fraction.replace(/0+$/, '')}`;
}

/** Do both bounds of a snapshotted range equal the engagement's current band? */
function matchesCurrentBand(
  event: EngagementEvent,
  romLow: string | null,
  romHigh: string | null,
): boolean {
  if (romLow === null || romHigh === null) return false;
  if (event.rangeLow === null || event.rangeHigh === null) return false;
  return (
    normalizedAmount(event.rangeLow) === normalizedAmount(romLow) &&
    normalizedAmount(event.rangeHigh) === normalizedAmount(romHigh)
  );
}

/**
 * The client has acknowledged THE BAND THAT IS ON THE ENGAGEMENT NOW — a gate for
 * `approveDesign`. `recordRomAcknowledgement` (Step 12) appends one
 * `rom_acknowledgement` event snapshotting the acknowledged range.
 *
 * EXISTENCE IS NOT ENOUGH. Re-setting the band clears `rom_issued_at`, so an
 * engagement whose figures have moved since the client agreed to them would
 * otherwise still pass this gate on the old consent — the design would be signed
 * off against numbers the client never saw. FOUR conditions now, all fail-closed
 * with `rom_not_acknowledged`: the band must be issued, the newest
 * acknowledgement must exist, it must answer THE CURRENT ISSUANCE (0049), and
 * its snapshotted range must equal the current band.
 *
 * The issuance check and the band check are both kept, deliberately. The issuance
 * check is the strong one — it catches a re-issue of the SAME numbers, which the
 * band comparison cannot see. The band comparison stays because it also covers
 * the rows that carry no issuance stamp at all, and because two independent
 * reasons to refuse are the right posture for a gate that signs off money.
 */
export function romAcknowledged(facts: GuardFacts): GuardResult {
  const { romLow, romHigh, romIssuedAt } = facts.engagement;
  const stale: GuardResult = { ok: false, code: 'rom_not_acknowledged' };
  if (!romIssuedAt) return stale;
  const [latestAcknowledgement] = facts.events
    .filter((event) => event.kind === 'rom_acknowledgement')
    .sort(byDecidedDescending);
  if (!latestAcknowledgement) return stale;
  if (!acknowledgesIssuance(latestAcknowledgement, romIssuedAt)) return stale;
  return matchesCurrentBand(latestAcknowledgement, romLow, romHigh) ? pass : stale;
}

/**
 * Newest-first ordering for engagement events: primary `decidedAt`, tie-broken by
 * `createdAt`, then `id` — the deterministic total order the latest-attestation
 * gate reads. Descending, so the freshest event sorts to index 0.
 */
function byDecidedDescending(a: EngagementEvent, b: EngagementEvent): number {
  const decided = b.decidedAt.getTime() - a.decidedAt.getTime();
  if (decided !== 0) return decided;
  const created = b.createdAt.getTime() - a.createdAt.getTime();
  if (created !== 0) return created;
  if (a.id === b.id) return 0;
  return a.id < b.id ? 1 : -1;
}

/**
 * The as-built drawings are reconciled — a gate for `approveDesign`. A non-Off-Plan
 * engagement never has as-built drawings due (`asBuiltDue === false`), so it is
 * trivially reconciled and passes. For an Off-Plan engagement the LATEST
 * `as_built_attestation` event (newest by decidedAt/createdAt/id) must be a clean
 * one (`hasVariance === false`); a variance-flagged latest attestation, or NO
 * attestation at all, fails closed with `as_built_not_reconciled`.
 */
export function asBuiltReconciled(facts: GuardFacts): GuardResult {
  if (!facts.engagement.asBuiltDue) return pass;

  const [latest] = facts.events
    .filter((event) => event.kind === 'as_built_attestation')
    .sort(byDecidedDescending);

  if (!latest || latest.hasVariance !== false) {
    return { ok: false, code: 'as_built_not_reconciled' };
  }
  return pass;
}

/**
 * The recipient has acknowledged the design-only handoff — the gate for
 * `recipientAcknowledges` (design_only_handoff -> closed_design_only). ANY actor
 * channel satisfies it (the romAcknowledged pattern): the client's own token-path
 * ack (`acknowledge_handoff`) and the staff-recorded ack both append one
 * `handoff_acknowledgement` event. Fails closed with `handoff_not_acknowledged`
 * when none is present.
 */
export function handoffAcknowledged(facts: GuardFacts): GuardResult {
  return facts.events.some((event) => event.kind === 'handoff_acknowledgement')
    ? pass
    : { ok: false, code: 'handoff_not_acknowledged' };
}

/**
 * The as-built drawings are due — the gate for the Gate-B as-built attestations
 * (`flagAsBuiltVariance`, `attestAsBuiltClean`). `as_built_due` is set true at
 * `confirmAndPayDeposit` for an Off-Plan engagement; a non-Off-Plan engagement
 * never becomes due, so it cannot flag a variance or attest a clean as-built.
 * Fails closed with `as_built_not_due` when the drawings are not (yet) due.
 */
export function asBuiltDueOpen(facts: GuardFacts): GuardResult {
  return facts.engagement.asBuiltDue === true
    ? pass
    : { ok: false, code: 'as_built_not_due' };
}
