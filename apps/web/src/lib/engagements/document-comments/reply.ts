import {
  designEngagements,
  engagementArtifacts,
  engagementDocumentComments,
  type MetraDb,
} from '@metra/db';
import { fieldsFailed, hasFieldErrors } from '@/lib/actions/field-errors';
import { fail, mutateInOrg, requireInOrg } from '@/lib/actions/mutate';
import type { ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { commentFieldErrors } from '../comment-field-rules';
import { isTerminal } from '../states';
import { isUuid } from '@/lib/uuid';

export interface ReplyToDocumentInput {
  artifactId: string;
  body: string;
}

/**
 * The artifact a reply attaches to, resolved in-org (`record_not_found` when
 * absent OR in another org), with its parent engagement resolved in-org
 * (`engagement_not_found`) and not terminal (`engagement_not_active`).
 */
async function commentableArtifact(
  tx: MetraDb,
  artifactId: string,
): Promise<{ id: string; engagementId: string }> {
  const artifact = await requireInOrg(
    tx,
    engagementArtifacts,
    artifactId,
    {
      id: engagementArtifacts.id,
      engagementId: engagementArtifacts.engagementId,
    },
    'record_not_found',
  );

  const engagement = await requireInOrg(
    tx,
    designEngagements,
    artifact.engagementId,
    { id: designEngagements.id, state: designEngagements.state },
    'engagement_not_found',
  );
  if (isTerminal(engagement.state)) fail('engagement_not_active');
  return artifact;
}

/**
 * APPEND one studio reply to a document's thread.
 *
 * Flow: gate `engagements_design`/`update` (before any tx) → uuid shape and a
 * non-blank body (`required` under the box; past the cap it is cut, as the box
 * already stops typing at it) → open the RLS tx and resolve the
 * artifact, which is therefore `invalid` when absent OR in another org → the parent
 * engagement must resolve in-org (`engagement_not_found`) and not be terminal
 * (`engagement_not_active`), matching setArtifactClientVisibilityCore → insert one
 * append-only row stamped with the acting user → audit.
 *
 * The artifact does NOT have to be client-visible: a studio note on a not-yet-shared
 * drawing is legitimate, and it becomes visible to the client exactly when the file
 * itself is released. Never throws to the client — coded ActionResult only.
 */
export async function replyToDocumentCore(
  ctx: OrgContext,
  input: ReplyToDocumentInput,
): Promise<ActionResult> {
  if (!isUuid(input.artifactId)) return { ok: false, error: 'malformed' };
  const bodyErrors = commentFieldErrors(input.body);
  if (hasFieldErrors(bodyErrors)) return fieldsFailed(bodyErrors);
  const body = input.body.trim();
  return mutateInOrg(
    ctx,
    { capability: 'engagements_design', action: 'update', flow: 'interior' },
    async (tx, audit) => {
      const artifact = await commentableArtifact(tx, input.artifactId);
      await tx.insert(engagementDocumentComments).values({
        orgId: ctx.orgId,
        engagementId: artifact.engagementId,
        artifactId: artifact.id,
        authorChannel: 'staff',
        authorUserId: ctx.userId,
        body,
      });
      await audit({
        entity: 'design_engagement',
        entityId: artifact.engagementId,
        action: 'update',
        after: { artifact_id: artifact.id, comment_length: body.length },
      });
    },
  );
}
