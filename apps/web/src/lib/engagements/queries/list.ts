import 'server-only';
import { clients, designEngagements, projects, type DesignEngagementState } from '@metra/db';
import { desc, eq } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';

/**
 * One row of the engagements list: the header fields the list surface renders
 * plus the client/project names joined in for display. Newest first (highest
 * per-org `number`). The CALLER gates the read on the `engagements_design` read
 * capability; RLS scopes it to the caller's org.
 */
export interface EngagementListRow {
  id: string;
  number: number;
  titleAr: string | null;
  titleEn: string | null;
  clientId: string;
  projectId: string;
  state: DesignEngagementState;
  clientNameEn: string | null;
  clientNameAr: string | null;
  projectNameEn: string | null;
  projectNameAr: string | null;
  createdAt: string;
}

/** Org-scoped engagements, newest first (by per-org number descending). */
export function listEngagements(ctx: OrgContext): Promise<EngagementListRow[]> {
  return withOrgContext(ctx, async (tx) => {
    const rows = await tx
      .select({
        id: designEngagements.id,
        number: designEngagements.number,
        titleAr: designEngagements.titleAr,
        titleEn: designEngagements.titleEn,
        clientId: designEngagements.clientId,
        projectId: designEngagements.projectId,
        state: designEngagements.state,
        clientNameEn: clients.nameEn,
        clientNameAr: clients.nameAr,
        projectNameEn: projects.nameEn,
        projectNameAr: projects.nameAr,
        createdAt: designEngagements.createdAt,
      })
      .from(designEngagements)
      .leftJoin(clients, eq(clients.id, designEngagements.clientId))
      .leftJoin(projects, eq(projects.id, designEngagements.projectId))
      .orderBy(desc(designEngagements.number));
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  });
}
