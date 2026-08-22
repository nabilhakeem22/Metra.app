// Design-Engagement Machine — the as-built attestation side-effect (Step 13).
//
// Executor-only: MUST be called with the executor's `tx` so the append-only
// attestation event commits ATOMICALLY with the state move it witnesses
// (`flagAsBuiltVariance`: final_approval -> change_triage, or `attestAsBuiltClean`:
// final_approval/change_triage -> final_approval), or not at all. The
// `asBuiltDueOpen` guard has already proven the as-built drawings are due (an
// Off-Plan engagement whose deposit cleared), so this only appends the row that
// records the attestation's variance verdict. No UPDATE/DELETE — append-only.
import { engagementEvents, type MetraDb } from '@metra/db';
import type { OrgContext } from '@/lib/db/context';

/**
 * Append ONE `as_built_attestation` row to the append-only engagement events
 * ledger for `engagementId`. `hasVariance` records the verdict: `true` flags an
 * as-built variance (the caller moves the engagement into `change_triage`), `false`
 * is a clean attestation. `decidedAt` defaults to now() at the database;
 * `actorUserId` is the internal actor from the request context.
 */
export async function insertAsBuiltAttestation(
  tx: MetraDb,
  ctx: OrgContext,
  engagementId: string,
  hasVariance: boolean,
): Promise<void> {
  await tx.insert(engagementEvents).values({
    orgId: ctx.orgId,
    engagementId,
    kind: 'as_built_attestation',
    actorUserId: ctx.userId,
    hasVariance,
  });
}
