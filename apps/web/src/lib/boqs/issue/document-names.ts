import 'server-only';
import { clients, organizations, projects } from '@metra/db';
import { eq } from 'drizzle-orm';
import type { OrgContext } from '@/lib/db/context';
import { withOrgContext } from '@/lib/db/context';

/** The three names a delivered BOQ PDF prints, both languages each. */
export interface DocumentNames {
  orgAr: string | null;
  orgEn: string | null;
  clientAr: string | null;
  clientEn: string | null;
  projectAr: string | null;
  projectEn: string | null;
}

/**
 * The org, client and project names for a BOQ's client PDF, in one RLS read, or
 * null when the project or client is not in this org. Keyed by the ids rather
 * than by a BOQ row, so a BOQ that does not exist yet (Send as BOQ renders
 * before it writes) can be named.
 */
export async function loadDocumentNames(
  ctx: OrgContext,
  ids: { clientId: string; projectId: string },
): Promise<DocumentNames | null> {
  const [row] = await withOrgContext(ctx, (tx) =>
    tx
      .select({
        orgAr: organizations.nameAr,
        orgEn: organizations.nameEn,
        clientAr: clients.nameAr,
        clientEn: clients.nameEn,
        projectAr: projects.nameAr,
        projectEn: projects.nameEn,
      })
      .from(projects)
      .innerJoin(organizations, eq(organizations.id, projects.orgId))
      .innerJoin(clients, eq(clients.id, ids.clientId))
      .where(eq(projects.id, ids.projectId))
      .limit(1),
  );
  return row ?? null;
}
