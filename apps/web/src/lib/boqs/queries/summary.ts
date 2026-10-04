import 'server-only';
import { boqLines } from '@metra/db';
import { eq, sql } from 'drizzle-orm';
import type { OrgContext } from '@/lib/db/context';
import { withOrgContext } from '@/lib/db/context';
import { formatDocNumber } from '@/lib/format/doc-number';
import type { BoqStepSummary } from '../step';
import { selectCurrentProjectBoq } from './current';

/**
 * Just enough about a project's current BOQ for the cockpit to decide what to
 * offer and to say what was sent.
 *
 * Deliberately NOT `getProjectBoq`: the command card needs a status, a count, a
 * number and a total, and pulling every section and line of a 2000-line document
 * to render one line would be a real cost on a page that already does a lot.
 *
 * The document number is formatted HERE, from the UTC year of `created_at` (the
 * year the PDF and the artifact file name print), so a browser on the other side
 * of midnight on 31 December cannot show a different one.
 */
export async function getProjectBoqSummary(
  ctx: OrgContext,
  projectId: string,
): Promise<BoqStepSummary | null> {
  return withOrgContext(ctx, async (db) => {
    const boq = await selectCurrentProjectBoq(db, projectId);
    if (!boq) return null;

    const [counted] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(boqLines)
      .where(eq(boqLines.boqId, boq.id));

    return {
      id: boq.id,
      status: boq.status,
      lineCount: counted?.n ?? 0,
      documentNumber: formatDocNumber(
        'BQ',
        boq.number,
        new Date(boq.createdAt).getUTCFullYear(),
      ),
      total: boq.total,
    };
  });
}
