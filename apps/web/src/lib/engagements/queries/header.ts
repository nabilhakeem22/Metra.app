import 'server-only';
import { clients, designEngagements, projects, type DesignEngagementState } from '@metra/db';
import { eq, sql } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';

/**
 * The engagement header for the detail surface. All money is returned as scale-4
 * strings (the UI applies 2-decimal formatting); timestamps as ISO strings so the
 * value crosses the server -> client boundary cleanly. Omits the client-share
 * token columns (`token_hash`/`share_expires_at`) — no internal surface needs
 * them. Null when the engagement does not resolve in-org. The CALLER gates the
 * read on the `engagements_design` read capability; RLS is the second factor.
 */
export interface EngagementHeader {
  id: string;
  number: number;
  titleAr: string | null;
  titleEn: string | null;
  clientId: string;
  projectId: string;
  clientNameEn: string | null;
  clientNameAr: string | null;
  projectNameEn: string | null;
  projectNameAr: string | null;
  state: DesignEngagementState;
  designFee: string | null;
  offPlan: boolean;
  asBuiltDue: boolean;
  freeRevisionN: number;
  revisionCount: number;
  /**
   * The 3D revision pair, INDEPENDENT of the concept pair above: the cockpit's
   * revision form prices a `designChangeRaised` revision against these, so a
   * fully-burned concept allowance never costs the client a free 3D revision.
   */
  freeDesignRevisionN: number;
  designRevisionCount: number;
  romLow: string | null;
  romHigh: string | null;
  conceptLockedAt: string | null;
  renderManifestHash: string | null;
  rendersReadyAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function getEngagementHeader(
  ctx: OrgContext,
  engagementId: string,
): Promise<EngagementHeader | null> {
  return withOrgContext(ctx, async (tx) => {
    const [row] = await tx
      .select({
        id: designEngagements.id,
        number: designEngagements.number,
        titleAr: designEngagements.titleAr,
        titleEn: designEngagements.titleEn,
        clientId: designEngagements.clientId,
        projectId: designEngagements.projectId,
        clientNameEn: clients.nameEn,
        clientNameAr: clients.nameAr,
        projectNameEn: projects.nameEn,
        projectNameAr: projects.nameAr,
        state: designEngagements.state,
        designFee: designEngagements.designFee,
        offPlan: designEngagements.offPlan,
        asBuiltDue: designEngagements.asBuiltDue,
        freeRevisionN: designEngagements.freeRevisionN,
        revisionCount: designEngagements.revisionCount,
        freeDesignRevisionN: designEngagements.freeDesignRevisionN,
        designRevisionCount: designEngagements.designRevisionCount,
        romLow: designEngagements.romLow,
        romHigh: designEngagements.romHigh,
        conceptLockedAt: designEngagements.conceptLockedAt,
        renderManifestHash: designEngagements.renderManifestHash,
        rendersReadyAt: designEngagements.rendersReadyAt,
        createdAt: designEngagements.createdAt,
        updatedAt: designEngagements.updatedAt,
      })
      .from(designEngagements)
      .leftJoin(clients, eq(clients.id, designEngagements.clientId))
      .leftJoin(projects, eq(projects.id, designEngagements.projectId))
      .where(eq(designEngagements.id, engagementId))
      .limit(1);

    if (!row) return null;
    return {
      ...row,
      conceptLockedAt: row.conceptLockedAt?.toISOString() ?? null,
      rendersReadyAt: row.rendersReadyAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  });
}

/**
 * The client-share status of a delivery, for the cockpit "Share with client"
 * control. Reports ONLY whether a live link exists (token_hash is set) plus its
 * optional expiry — it NEVER returns the token_hash itself. RLS scopes the read to
 * the caller's org (a foreign delivery reads as not-shared). The CALLER gates the
 * read on an engagements capability; this is display state, not the token.
 */
export interface DeliveryShareStatus {
  shared: boolean;
  expiresAt: string | null;
}

export function getDeliveryShareStatus(
  ctx: OrgContext,
  engagementId: string,
): Promise<DeliveryShareStatus> {
  return withOrgContext(ctx, async (tx) => {
    const [row] = await tx
      .select({
        // Derive a boolean at the DB — the hash itself never crosses this boundary.
        shared: sql<boolean>`${designEngagements.tokenHash} is not null`,
        expiresAt: designEngagements.shareExpiresAt,
      })
      .from(designEngagements)
      .where(eq(designEngagements.id, engagementId))
      .limit(1);
    return {
      shared: row?.shared ?? false,
      expiresAt: row?.expiresAt?.toISOString() ?? null,
    };
  });
}
