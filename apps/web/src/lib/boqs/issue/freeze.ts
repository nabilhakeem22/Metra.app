import 'server-only';
import { boqs, contracts, type MetraDb } from '@metra/db';
import { and, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import { fail } from '@/lib/actions/mutate';
import type { OrgContext } from '@/lib/db/context';
import { publishOnlyLatest, recordArtifact } from './publish';

export interface FreezeIssueInput {
  boqId: string;
  projectId: string;
  engagementId: string;
  /**
   * The ENGAGEMENT's client, never the project's: a BOQ under a delivery is
   * that delivery's client's (H3 round 2), or the delivery stops owning it
   * (`app_delivery_boqs`) once the project's client has changed.
   */
  clientId: string;
  fileId: string;
  label: string;
}

/**
 * The write half of issuing a BOQ, shared by BOTH issue paths (the sheet's Issue
 * button and Send as BOQ). Runs inside the caller's write transaction, after the
 * PDF already exists, and in this order:
 *
 *   1. supersede every other live BOQ on the project (the version chain),
 *   2. freeze this one: draft -> issued, stamped with its version, on the
 *      engagement and for the engagement's client,
 *   3. record the PDF as the engagement's `boq` artifact, VISIBLE to the client,
 *   4. hide every older visible `boq` artifact on EVERY engagement of the
 *      project, since the supersede in step 1 is project-wide too.
 *
 * EVERY ISSUE PUBLISHES (Nabil's decision): there is no flag. The client still
 * cannot open it until the engagement HAS a fee schedule and it is paid
 * (`app_boq_releasable`, which the portal's `app_document_access` reads for a
 * `boq`); publishing only puts it in the delivery link.
 * The artifact is what `boqPresent` counts, so the delivery guard is satisfied
 * without touching it.
 */
export async function freezeAndRecordIssue(
  tx: MetraDb,
  ctx: OrgContext,
  input: FreezeIssueInput,
): Promise<{ artifactId: string; version: number }> {
  const previousIssuedId = await supersedeOthers(tx, input);
  const version = await markIssued(tx, input, previousIssuedId);
  const artifactId = await recordArtifact(tx, ctx, input);
  await publishOnlyLatest(tx, input, artifactId);
  return { artifactId, version };
}

/**
 * Lock and supersede every other draft or issued BOQ on the project. Returns the
 * one that was issued (at most one can be), which the new version supersedes.
 * Issued -> superseded is the trigger's whitelisted transition; drafts are not
 * locked at all. An issued BOQ a live contract stands on is never superseded
 * (`boq_has_contract`, plan A3): changes after the contract are change orders.
 */
async function supersedeOthers(
  tx: MetraDb,
  input: FreezeIssueInput,
): Promise<string | null> {
  const others = await tx
    .select({ id: boqs.id, status: boqs.status })
    .from(boqs)
    .where(
      and(
        eq(boqs.projectId, input.projectId),
        ne(boqs.id, input.boqId),
        inArray(boqs.status, ['draft', 'issued']),
      ),
    )
    .for('update');
  await refuseIfContracted(tx, others.filter((other) => other.status === 'issued').map((other) => other.id));
  if (others.length > 0) {
    await tx
      .update(boqs)
      .set({ status: 'superseded' })
      .where(inArray(boqs.id, others.map((other) => other.id)));
  }
  return others.find((other) => other.status === 'issued')?.id ?? null;
}

/**
 * A non-terminated contract on one of these BOQs refuses the issue. Read AFTER
 * the BOQ rows are locked FOR UPDATE: a contract generated meanwhile held its
 * BOQ FOR SHARE (lib/contracts/core/create-from-boq.ts), so it has committed by
 * now and this read sees it.
 */
async function refuseIfContracted(tx: MetraDb, issuedBoqIds: string[]): Promise<void> {
  if (issuedBoqIds.length === 0) return;
  const [standing] = await tx
    .select({ id: contracts.id })
    .from(contracts)
    .where(and(inArray(contracts.sourceBoqId, issuedBoqIds), ne(contracts.status, 'terminated')))
    .limit(1);
  if (standing) fail('boq_has_contract');
}

/** Freeze as the next version. `status = 'draft'` is the admission gate: a
 *  second click finds no row and is refused, never issued twice. */
async function markIssued(
  tx: MetraDb,
  input: FreezeIssueInput,
  previousIssuedId: string | null,
): Promise<number> {
  const [latest] = await tx
    .select({ maxVersion: sql<number | null>`max(${boqs.version})::int` })
    .from(boqs)
    .where(
      and(
        eq(boqs.projectId, input.projectId),
        ne(boqs.id, input.boqId),
        isNotNull(boqs.issueDate),
      ),
    );
  const version = (latest?.maxVersion ?? 0) + 1;

  const frozen = await tx
    .update(boqs)
    .set({
      status: 'issued',
      issueDate: new Date().toISOString().slice(0, 10),
      engagementId: input.engagementId,
      clientId: input.clientId,
      version,
      supersedesId: previousIssuedId,
    })
    .where(and(eq(boqs.id, input.boqId), eq(boqs.status, 'draft')))
    .returning({ id: boqs.id });
  if (frozen.length === 0) fail('boq_not_draft');
  return version;
}
