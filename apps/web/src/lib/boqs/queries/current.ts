import 'server-only';
import { boqs, type MetraDb } from '@metra/db';
import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';
import type { OrgContext } from '@/lib/db/context';
import { withOrgContext } from '@/lib/db/context';
import { readBoqDetail } from './detail';
import type { BoqDetail } from './types';

/** The header columns the "current BOQ" readers need, and nothing heavier. */
export interface CurrentBoqRow {
  id: string;
  status: string;
  number: number;
  total: string;
  createdAt: Date;
}

/**
 * THE CURRENT BOQ OF A PROJECT: the issued one if there is one, otherwise the
 * oldest draft that has not been superseded. A project can hold a version chain
 * (each "Send as BOQ" supersedes the previous one), so "the oldest BOQ" stopped
 * being the right answer the moment a second version could exist; it is still
 * the rule among drafts.
 */
export async function selectCurrentProjectBoq(
  db: MetraDb,
  projectId: string,
): Promise<CurrentBoqRow | null> {
  const [row] = await db
    .select({
      id: boqs.id,
      status: boqs.status,
      number: boqs.number,
      total: boqs.total,
      createdAt: boqs.createdAt,
    })
    .from(boqs)
    .where(and(eq(boqs.projectId, projectId), ne(boqs.status, 'superseded')))
    .orderBy(desc(sql`(${boqs.status} = 'issued')`), asc(boqs.createdAt))
    .limit(1);
  return row ?? null;
}

/** The project's current BOQ in full, or null. */
export async function getProjectBoq(
  ctx: OrgContext,
  projectId: string,
  opts: { showCost: boolean },
): Promise<BoqDetail | null> {
  return withOrgContext(ctx, async (db) => {
    const current = await selectCurrentProjectBoq(db, projectId);
    return current ? readBoqDetail(db, current.id, opts) : null;
  });
}
