import 'server-only';
import { boqs, type MetraDb } from '@metra/db';
import { eq, sql } from 'drizzle-orm';
import { fail } from '@/lib/actions/mutate';

/**
 * A draft BOQ's CONTENT REVISION: `updated_at` as epoch microseconds, as text
 * from SQL. Every content write moves it (`recomputeBoqTotals`, and a section
 * add). Compared as text, never as a JS Date, which has only milliseconds.
 */
export const boqRevision = sql<string>`(extract(epoch from ${boqs.updatedAt}) * 1000000)::bigint::text`;

/**
 * The sheet Issue's content fence, the twin of Send as BOQ's proposal fence. The
 * PDF was rendered from a read taken WITHOUT a lock; under FOR UPDATE this proves
 * the BOQ is still the document that was rendered. A line edited, added or
 * removed meanwhile is `boq_send_conflict` and nothing is written, so the frozen
 * rows can never disagree with the PDF the client receives.
 */
export async function fenceIssueRevision(
  tx: MetraDb,
  boqId: string,
  renderedRevision: string,
): Promise<void> {
  const [row] = await tx
    .select({ revision: boqRevision })
    .from(boqs)
    .where(eq(boqs.id, boqId))
    .for('update');
  if (!row) fail('boq_not_found');
  if (row.revision !== renderedRevision) fail('boq_send_conflict');
}
