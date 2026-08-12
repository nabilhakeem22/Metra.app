import 'server-only';
import {
  proposalSectionLibrary,
  type ProposalSectionLibraryEntry,
} from '@metra/db';
import { asc, eq } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';

/** Active, org-scoped section-title suggestions, ordered by name then created. */
export function listSectionLibrary(
  ctx: OrgContext,
): Promise<ProposalSectionLibraryEntry[]> {
  return withOrgContext(ctx, (tx) =>
    tx
      .select()
      .from(proposalSectionLibrary)
      .where(eq(proposalSectionLibrary.active, true))
      .orderBy(
        asc(proposalSectionLibrary.nameEn),
        asc(proposalSectionLibrary.createdAt),
      ),
  );
}
