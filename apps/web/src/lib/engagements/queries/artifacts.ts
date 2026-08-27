import 'server-only';
import {
  designEngagements,
  engagementArtifacts,
  type EngagementArtifactKind,
} from '@metra/db';
import { desc, eq } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';

/**
 * The approved-render baseline captured when `rendersReady` fired. Both are null
 * until the design_3d -> final_approval move: `renderManifestHash` is the sha256
 * over the sorted approved-render content-hash list, `rendersReadyAt` the moment it
 * was captured. RLS scopes the read to the caller's org (a foreign engagement reads
 * as `{ renderManifestHash: null, rendersReadyAt: null }`).
 */
export interface EngagementRenderManifest {
  renderManifestHash: string | null;
  rendersReadyAt: Date | null;
}

export function getEngagementRenderManifest(
  ctx: OrgContext,
  engagementId: string,
): Promise<EngagementRenderManifest> {
  return withOrgContext(ctx, async (tx) => {
    const [engagement] = await tx
      .select({
        renderManifestHash: designEngagements.renderManifestHash,
        rendersReadyAt: designEngagements.rendersReadyAt,
      })
      .from(designEngagements)
      .where(eq(designEngagements.id, engagementId))
      .limit(1);

    return {
      renderManifestHash: engagement?.renderManifestHash ?? null,
      rendersReadyAt: engagement?.rendersReadyAt ?? null,
    };
  });
}

/** One recorded/attested artifact of an engagement. */
export interface EngagementArtifactRecord {
  id: string;
  kind: EngagementArtifactKind;
  fileId: string | null;
  contentHash: string | null;
  label: string | null;
  attestedBy: string;
  attestedAt: Date;
  note: string | null;
}

/**
 * The artifacts recorded against an engagement, NEWEST FIRST. RLS scopes the read
 * to the caller's org (a foreign engagement reads as an empty list).
 */
export function getEngagementArtifacts(
  ctx: OrgContext,
  engagementId: string,
): Promise<EngagementArtifactRecord[]> {
  return withOrgContext(ctx, (tx) =>
    tx
      .select({
        id: engagementArtifacts.id,
        kind: engagementArtifacts.kind,
        fileId: engagementArtifacts.fileId,
        contentHash: engagementArtifacts.contentHash,
        label: engagementArtifacts.label,
        attestedBy: engagementArtifacts.attestedBy,
        attestedAt: engagementArtifacts.attestedAt,
        note: engagementArtifacts.note,
      })
      .from(engagementArtifacts)
      .where(eq(engagementArtifacts.engagementId, engagementId))
      .orderBy(
        desc(engagementArtifacts.attestedAt),
        desc(engagementArtifacts.createdAt),
      ),
  );
}
