import 'server-only';
import { boqs } from '@metra/db';
import { eq } from 'drizzle-orm';
import { mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionCode, type ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { withOrgContext } from '@/lib/db/context';
import { completeBoqStep, type BoqStepCompletion } from '@/lib/engagements/boq-step-complete';
import { renderFailureCode } from '@/lib/pdf/render-failure-code';
import { can } from '@/lib/permissions/can';
import { getBoqDetail, type BoqDetail } from '../queries';
import { loadDocumentNames, type DocumentNames } from './document-names';
import { freezeAndRecordIssue } from './freeze';
import { renderAndStoreClientBoqPdf } from './render';
import { boqRevision, fenceIssueRevision } from './revision';
import { issueEngagementOf } from './sole-engagement';

export { freezeAndRecordIssue, type FreezeIssueInput } from './freeze';
export { loadDocumentNames, type DocumentNames } from './document-names';
export { renderAndStoreClientBoqPdf } from './render';
export { getBoqIssueReleasable } from './releasable';

/**
 * Issue a BOQ from the sheet — the action that joins the structured document to
 * the delivery flow.
 *
 * Render first, write once: the CLIENT PDF is rendered and stored outside any
 * transaction, then `freezeAndRecordIssue` freezes the BOQ, records the PDF as
 * the engagement's `boq` artifact and publishes it to the client (withheld until
 * the balance clears). Send as BOQ runs the same write half.
 *
 * FREEZING IS LOAD-BEARING. Once issued, the PDF in the client's hands and the
 * rows in the database must never drift apart; a later change becomes a new
 * version that supersedes, producing its own artifact. That is why the write
 * opens with a CONTENT FENCE: the revision read before the render must still be
 * the BOQ's revision under FOR UPDATE, or nothing is frozen (`boq_send_conflict`).
 *
 * An issued BOQ then completes the delivery's BOQ step when the issuer may
 * (../../engagements/boq-step-complete.ts), answered in `boqStep`.
 */
export async function issueBoqCore(
  ctx: OrgContext,
  input: { boqId: string; locale: string },
): Promise<ActionResult & { data?: { artifactId: string; version: number; boqStep: BoqStepCompletion } }> {
  // Refused before the render, so a caller who may not issue never costs a
  // Chromium run or leaves a stored file behind.
  if (!can(ctx.role, 'boq_build', 'update')) return err('forbidden');

  const source = await loadIssueSource(ctx, input.boqId);
  if (typeof source === 'string') return err(source);

  let file: { fileId: string; label: string };
  try {
    file = await renderAndStoreClientBoqPdf(ctx, { ...source, locale: input.locale });
  } catch (e) {
    return err(renderFailureCode(e, 'BOQ issue'));
  }

  const issued = await mutateInOrg(ctx, { capability: 'boq_build', action: 'update' }, async (tx) => {
    await fenceIssueRevision(tx, input.boqId, source.revision);
    return freezeAndRecordIssue(tx, ctx, {
      boqId: input.boqId,
      projectId: source.projectId,
      engagementId: source.engagementId,
      ...file,
    });
  });
  if (!issued.ok || !issued.data) return { ...issued, data: undefined };
  return { ...issued, data: { ...issued.data, boqStep: await completeBoqStep(ctx, source.engagementId) } };
}

interface IssueSource {
  /** The content revision the PDF is rendered from; read BEFORE the detail, so
   *  an edit landing between the two reads can only cause a refusal. */
  revision: string;
  detail: BoqDetail;
  projectId: string;
  engagementId: string;
  names: DocumentNames;
  year: number;
}

/** Everything the render needs, read before any write, or the refusal code. */
async function loadIssueSource(
  ctx: OrgContext,
  boqId: string,
): Promise<IssueSource | ActionCode> {
  const [row] = await withOrgContext(ctx, (tx) =>
    tx
      .select({
        status: boqs.status,
        projectId: boqs.projectId,
        engagementId: boqs.engagementId,
        clientId: boqs.clientId,
        createdAt: boqs.createdAt,
        revision: boqRevision,
      })
      .from(boqs)
      .where(eq(boqs.id, boqId))
      .limit(1),
  );
  if (!row) return 'boq_not_found';
  if (row.status !== 'draft') return 'boq_not_draft';

  // The client copy never prints cost, so cost is not fetched for it.
  const detail = await getBoqDetail(ctx, boqId, { showCost: false });
  if (!detail) return 'boq_not_found';
  if (detail.lineCount === 0) return 'invalid';

  // An engagement is required: the artifact hangs off one, and it is how the
  // client ever sees this document.
  const engagementId = await issueEngagementOf(ctx, row);
  if (!engagementId) return 'engagement_not_found';

  const names = await loadDocumentNames(ctx, row);
  if (!names) return 'boq_not_found';

  const year = new Date(row.createdAt).getUTCFullYear();
  return { revision: row.revision, detail, projectId: row.projectId, engagementId, names, year };
}
