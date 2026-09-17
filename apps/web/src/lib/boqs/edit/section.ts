import 'server-only';
import { boqSections, boqs } from '@metra/db';
import { eq, sql } from 'drizzle-orm';
import { fail, mutateInOrg, requireInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { countCharacters } from '@/lib/validation/text';
import { bilingualFor } from '../bilingual';
import { MAX_DESCRIPTION } from '../edit-input';

/**
 * Add a section to a draft BOQ.
 *
 * Without this a BOQ created from scratch has nowhere to put a line — sections
 * only ever arrived from the importer, which left "build it by hand" as a path
 * that dead-ends on an empty document.
 */
export async function addBoqSectionCore(
  ctx: OrgContext,
  input: { boqId: string; title: string },
): Promise<ActionResult & { data?: string }> {
  const title = input.title.trim();
  // `name_required` used to serve this, the org bilingual check AND the BOQ
  // title, so the studio adding a nameless section was told to "enter at least
  // one company name". One string cannot answer for three different things —
  // and neither can `section_name_required`, which was left answering for two:
  // a studio that TYPED a name, an over-long one, was told the section needs one.
  if (title === '') return err('section_name_required');
  if (countCharacters(title) > MAX_DESCRIPTION) return err('section_name_too_long');

  return mutateInOrg(
    ctx,
    { capability: 'boq_build', action: 'create' },
    async (tx) => {
      const boq = await requireInOrg(
        tx,
        boqs,
        input.boqId,
        { id: boqs.id, status: boqs.status },
        'boq_not_found',
      );
      if (boq.status !== 'draft') fail('boq_not_draft');

      const [{ maxSort = -1 } = { maxSort: -1 }] = await tx
        .select({
          maxSort: sql<number>`coalesce(max(${boqSections.sortOrder}), -1)::int`,
        })
        .from(boqSections)
        .where(eq(boqSections.boqId, input.boqId));

      const bilingual = bilingualFor(title);
      const [row] = await tx
        .insert(boqSections)
        .values({
          orgId: ctx.orgId,
          boqId: input.boqId,
          titleAr: bilingual.descriptionAr,
          titleEn: bilingual.descriptionEn,
          sortOrder: maxSort + 1,
        })
        .returning({ id: boqSections.id });
      return row?.id;
    },
  );
}
