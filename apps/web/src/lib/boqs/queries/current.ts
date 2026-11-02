import 'server-only';
import { boqs, type MetraDb } from '@metra/db';
import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';

/** The header columns the "current BOQ" readers need, and nothing heavier. */
export interface CurrentBoqRow {
  id: string;
  status: string;
  number: number;
  total: string;
  createdAt: Date;
  /** A draft stands on the project, this row itself if it is one. In the one statement: the cockpit reads no more. */
  projectHasDraft: boolean;
}

/**
 * THE CURRENT BOQ OF A PROJECT: the issued one if there is one, otherwise the
 * oldest draft that has not been superseded. A project can hold a version chain
 * (each "Send as BOQ" supersedes the previous one), so "the oldest BOQ" stopped
 * being the right answer the moment a second version could exist; it is still
 * the rule among drafts.
 */
export async function selectCurrentProjectBoq(
  tx: MetraDb,
  projectId: string,
): Promise<CurrentBoqRow | null> {
  const [row] = await tx
    .select({
      id: boqs.id,
      status: boqs.status,
      number: boqs.number,
      total: boqs.total,
      createdAt: boqs.createdAt,
      projectHasDraft: sql<boolean>`exists (select 1 from public.boqs d where d.project_id = ${projectId} and d.status = 'draft')`,
    })
    .from(boqs)
    .where(and(eq(boqs.projectId, projectId), ne(boqs.status, 'superseded')))
    .orderBy(desc(sql`(${boqs.status} = 'issued')`), asc(boqs.createdAt))
    .limit(1);
  return row ?? null;
}
