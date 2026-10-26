// Client Deliverables, Step 1 — the per-file MANUAL override behind auto-share.
// Auto-share (the executor's `clientRelease` branch) is only shippable with an
// undo. A `boq` is never released by a TRANSITION; issuing a BOQ, from the sheet
// or Send as BOQ, publishes it and hides the older ones
// (`lib/boqs/issue/freeze.ts`). The per-file override below still works on any
// artifact, a `boq` included.
//
// Self-contained `*Core(ctx, input) -> ActionResult` (API-ready), gated on the §2.2
// `engagements_design` / `update` cell, exactly like the transition executor's
// design family. The thin `'use server'` wrapper in ./actions/deliverables.ts adds
// `requireOrg()` + `revalidatePath`.
import { designEngagements, engagementArtifacts } from '@metra/db';
import { and, eq } from 'drizzle-orm';
import { fail, mutateInOrg, requireInOrg } from '@/lib/actions/mutate';
import type { ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { restampRoundAwaitingDecision } from './render-round-restamp';
import { takesDesignFiles } from './states';
import { isUuid } from '@/lib/uuid';

/**
 * True when this flip SHOWS the client a render it could not see. Whether that
 * starts a new round (the delivery is under review and the client has not
 * decided) is the database's call (./render-round-restamp.ts). Hiding a render
 * is never a new round.
 */
function showsRender(artifact: { kind: string; clientVisible: boolean }, visible: boolean): boolean {
  return artifact.kind === 'approved_render' && visible && !artifact.clientVisible;
}

export interface SetArtifactClientVisibilityInput {
  artifactId: string;
  visible: boolean;
}

/**
 * Show or hide ONE artifact on the tokenized client portal.
 *
 * Flow: gate `engagements_design`/`update` (mutateInOrg, before any tx) → UUID
 * shape (`invalid`) → open the RLS tx and resolve the artifact, which is therefore
 * `invalid` when it is absent OR belongs to another org → `invalid` when it carries
 * no file (there would be nothing for the client to download, so it must never be
 * marked visible) → the parent engagement must resolve in-org
 * (`engagement_not_found`) and not be terminal (`engagement_not_active`), matching
 * recordArtifactCore / createDeliverableUploadCore → flip `client_visible` and
 * stamp `updated_at` (the portal renders that as the "shared on" date) → a
 * render newly shown while the client has not decided on the final design
 * re-stamps the render round → audit.
 *
 * Setting the value it already has is a harmless no-op write; the action stays
 * idempotent. Never throws to the client — coded ActionResult only.
 */
export async function setArtifactClientVisibilityCore(
  ctx: OrgContext,
  input: SetArtifactClientVisibilityInput,
): Promise<ActionResult> {
  if (!isUuid(input.artifactId)) return { ok: false, error: 'malformed' };
  if (typeof input.visible !== 'boolean') return { ok: false, error: 'malformed' };

  return mutateInOrg(
    ctx,
    { capability: 'engagements_design', action: 'update', flow: 'interior' },
    async (tx, audit) => {
      // RLS scopes this read to the caller's org, so a FOREIGN artifact simply does
      // not resolve and is indistinguishable from one that never existed.
      const artifact = await requireInOrg(
        tx,
        engagementArtifacts,
        input.artifactId,
        {
          id: engagementArtifacts.id,
          engagementId: engagementArtifacts.engagementId,
          fileId: engagementArtifacts.fileId,
          kind: engagementArtifacts.kind,
          clientVisible: engagementArtifacts.clientVisible,
        },
        'record_not_found',
      );
      // A record with no file has nothing the client could download.
      if (!artifact.fileId) fail('malformed');

      const engagement = await requireInOrg(
        tx,
        designEngagements,
        artifact.engagementId,
        { id: designEngagements.id, state: designEngagements.state },
        'engagement_not_found',
      );
      if (!takesDesignFiles(engagement.state)) fail('engagement_not_active');

      await tx
        .update(engagementArtifacts)
        .set({ clientVisible: input.visible, updatedAt: new Date() })
        .where(
          and(
            eq(engagementArtifacts.orgId, ctx.orgId),
            eq(engagementArtifacts.id, artifact.id),
          ),
        );
      if (showsRender(artifact, input.visible)) await restampRoundAwaitingDecision(tx, engagement.id);

      await audit({
        entity: 'design_engagement',
        entityId: artifact.engagementId,
        action: 'update',
        before: { artifact_id: artifact.id, client_visible: artifact.clientVisible },
        after: { artifact_id: artifact.id, client_visible: input.visible },
      });
    },
  );
}
