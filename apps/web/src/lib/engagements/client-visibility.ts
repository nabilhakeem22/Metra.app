// Client Deliverables, Step 1 — the per-file MANUAL override behind auto-share.
// Auto-share (the executor's `clientRelease` branch) is only shippable with an
// undo, and some deliverables are manual-only by policy: a `boq` is never
// auto-released, so this is the ONLY way one ever reaches the client portal.
//
// Self-contained `*Core(ctx, input) -> ActionResult` (API-ready), gated on the §2.2
// `engagements_design` / `update` cell, exactly like the transition executor's
// design family. The thin `'use server'` wrapper in ./actions/deliverables.ts adds
// `requireOrg()` + `revalidatePath`.
import { designEngagements, engagementArtifacts } from '@metra/db';
import { and, eq } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import type { ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { isTerminal } from './states';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
 * stamp `updated_at` (the portal renders that as the "shared on" date) → audit.
 *
 * Setting the value it already has is a harmless no-op write; the action stays
 * idempotent. Never throws to the client — coded ActionResult only.
 */
export async function setArtifactClientVisibilityCore(
  ctx: OrgContext,
  input: SetArtifactClientVisibilityInput,
): Promise<ActionResult> {
  if (!UUID_RE.test(input.artifactId ?? '')) return { ok: false, error: 'invalid' };
  if (typeof input.visible !== 'boolean') return { ok: false, error: 'invalid' };

  return mutateInOrg(
    ctx,
    { capability: 'engagements_design', action: 'update', flow: 'interior' },
    async (tx, audit) => {
      // RLS scopes this read to the caller's org, so a FOREIGN artifact simply does
      // not resolve and is indistinguishable from one that never existed.
      const [artifact] = await tx
        .select({
          id: engagementArtifacts.id,
          engagementId: engagementArtifacts.engagementId,
          fileId: engagementArtifacts.fileId,
          clientVisible: engagementArtifacts.clientVisible,
        })
        .from(engagementArtifacts)
        .where(eq(engagementArtifacts.id, input.artifactId))
        .limit(1);
      if (!artifact) fail('invalid');
      if (!artifact.fileId) fail('invalid');

      const [engagement] = await tx
        .select({ id: designEngagements.id, state: designEngagements.state })
        .from(designEngagements)
        .where(eq(designEngagements.id, artifact.engagementId))
        .limit(1);
      if (!engagement) fail('engagement_not_found');
      if (isTerminal(engagement.state)) fail('engagement_not_active');

      await tx
        .update(engagementArtifacts)
        .set({ clientVisible: input.visible, updatedAt: new Date() })
        .where(
          and(
            eq(engagementArtifacts.orgId, ctx.orgId),
            eq(engagementArtifacts.id, artifact.id),
          ),
        );

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
