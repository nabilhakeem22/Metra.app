import 'server-only';
import { designEngagements, engagementArtifacts, files } from '@metra/db';
import { and, eq } from 'drizzle-orm';
import { loggableFailure } from '@/lib/actions/loggable-failure';
import { err, type ActionResult } from '@/lib/actions/result';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { can } from '@/lib/permissions/can';
import { renewSignedUploadUrl } from '@/lib/storage/uploads';
import { isUuid } from '@/lib/uuid';
import { isTerminal } from './states';

export interface RenewDeliverableUploadInput {
  engagementId: string;
  fileId: string;
}

/**
 * A new signed PUT URL for a deliverable whose upload failed, on the SAME files
 * row (createDeliverableUploadCore registered it), so a retry never strands a
 * second orphan row. Gated like the first mint (`engagements_design` create); the
 * row must be this delivery's own engagement upload, the delivery live, and the
 * file not yet attached (an attached file has nothing left to upload: `invalid`).
 * Never throws: a Storage failure answers `generic`, which the queue retries.
 */
export async function renewDeliverableUploadCore(
  ctx: OrgContext,
  input: RenewDeliverableUploadInput,
): Promise<{ fileId: string; signedUrl: string } | ActionResult> {
  if (!can(ctx.role, 'engagements_design', 'create')) return err('forbidden');
  if (!isUuid(input.engagementId) || !isUuid(input.fileId)) return err('invalid');

  const [upload] = await withOrgContext(ctx, (tx) =>
    tx
      .select({
        objectKey: files.objectKey,
        state: designEngagements.state,
        artifactId: engagementArtifacts.id,
      })
      .from(files)
      .innerJoin(designEngagements, eq(designEngagements.id, files.entityId))
      .leftJoin(engagementArtifacts, eq(engagementArtifacts.fileId, files.id))
      .where(
        and(
          eq(files.id, input.fileId),
          eq(files.entity, 'engagement'),
          eq(files.entityId, input.engagementId),
        ),
      )
      .limit(1),
  );
  if (!upload || upload.artifactId !== null) return err('invalid');
  if (isTerminal(upload.state)) return err('engagement_not_active');
  try {
    return { fileId: input.fileId, ...(await renewSignedUploadUrl(upload.objectKey)) };
  } catch (error) {
    // Storage refused or did not answer: a coded `generic` the queue retries on
    // the same row, never an exception through the action.
    console.error('deliverable upload renewal failed:', loggableFailure(error));
    return err('generic');
  }
}
