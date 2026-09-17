// Creating an empty draft BOQ. PURE core — no next/*, no cookies: takes an
// OrgContext + input; the 'use server' wrapper in ../actions does the session work.
import { boqs, projects } from '@metra/db';
import { mutateInOrg, requireInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import { allocateNumber } from '@/lib/db/allocate-number';
import type { OrgContext } from '@/lib/db/context';

/** Hard cap, mirroring the proposal builder's. A spreadsheet can hold anything. */
export const MAX_BOQ_LINES = 2000;

export interface CreateBoqInput {
  projectId: string;
  titleAr?: string | null;
  titleEn?: string | null;
}

/**
 * Create an empty draft BOQ for a project.
 *
 * The client is taken FROM THE PROJECT rather than passed in: a BOQ priced for
 * one client against another client's project is not a state the UI should be
 * able to reach, and reading it here means there is no input to validate.
 */
export async function createBoqCore(
  ctx: OrgContext,
  input: CreateBoqInput,
): Promise<ActionResult & { data?: string }> {
  const titleAr = input.titleAr?.trim() || null;
  const titleEn = input.titleEn?.trim() || null;
  if (!titleAr && !titleEn) return err('name_required');

  return mutateInOrg(
    ctx,
    { capability: 'boq_build', action: 'create' },
    async (tx) => {
      const project = await requireInOrg(
        tx,
        projects,
        input.projectId,
        { id: projects.id, clientId: projects.clientId },
        'boq_not_found',
      );

      const number = await allocateNumber(tx, ctx.orgId, 'boq', 'boqs', 'number');

      const [row] = await tx
        .insert(boqs)
        .values({
          orgId: ctx.orgId,
          number,
          titleAr,
          titleEn,
          projectId: project.id,
          clientId: project.clientId,
        })
        .returning({ id: boqs.id });
      return row?.id;
    },
  );
}
