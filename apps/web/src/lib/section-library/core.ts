// PURE section-library cores — no next/*, no cookies. Take an OrgContext + input;
// the 'use server' wrappers in ./actions do the session/requireOrg work and
// delegate. Exercised directly by tests/actions/section-library.dbtest.ts.
import { proposalSectionLibrary } from '@metra/db';
import { and, eq, ilike, or } from 'drizzle-orm';
import { mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';

export interface SectionLibraryInput {
  nameEn?: string | null;
  nameAr?: string | null;
}

const NAME_MAX = 200;

function clean(v: string | null | undefined): string | null {
  return v?.trim() || null;
}

/**
 * Create-on-use section-title entry. Idempotent: if an active entry already
 * matches the trimmed name in EITHER language (case-insensitive), its id is
 * returned and no row is written. Both languages blank -> name_required.
 */
export async function upsertSectionLibraryEntryCore(
  ctx: OrgContext,
  input: SectionLibraryInput,
): Promise<ActionResult & { data?: string }> {
  const nameEn = clean(input.nameEn);
  const nameAr = clean(input.nameAr);
  if (!nameEn && !nameAr) return err('name_required');
  if ((nameEn?.length ?? 0) > NAME_MAX || (nameAr?.length ?? 0) > NAME_MAX) {
    return err('invalid');
  }

  return mutateInOrg(
    ctx,
    { capability: 'proposals_build', action: 'create' },
    async (tx, audit) => {
      // ilike with no wildcards is a case-insensitive exact match.
      const matches = [];
      if (nameEn) matches.push(ilike(proposalSectionLibrary.nameEn, nameEn));
      if (nameAr) matches.push(ilike(proposalSectionLibrary.nameAr, nameAr));
      const [existing] = await tx
        .select({ id: proposalSectionLibrary.id })
        .from(proposalSectionLibrary)
        .where(
          and(
            eq(proposalSectionLibrary.active, true),
            matches.length === 1 ? matches[0] : or(...matches),
          ),
        )
        .limit(1);
      if (existing) return existing.id;

      const [row] = await tx
        .insert(proposalSectionLibrary)
        .values({ orgId: ctx.orgId, nameEn, nameAr })
        .returning({ id: proposalSectionLibrary.id });
      await audit({
        entity: 'proposal_section_library',
        entityId: row.id,
        action: 'create',
        before: null,
        after: { name_en: nameEn, name_ar: nameAr },
      });
      return row.id;
    },
  );
}
