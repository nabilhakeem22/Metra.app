import 'server-only';
import { projectStages, projects, proposals, type MetraDb } from '@metra/db';
import { and, eq, gte, lt, lte, notInArray, sql } from 'drizzle-orm';

export interface DigestData {
  activeProjects: number;
  awaitingResponse: number;
  expiringSoon: number;
  overdueStages: number;
}

/** How many rows of `table` match `where`, as a number (0 when none). */
async function countRows(
  tx: MetraDb,
  table: typeof projects | typeof proposals | typeof projectStages,
  where: ReturnType<typeof and>,
): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(table)
    .where(where);
  return Number(row?.n ?? 0);
}

/** Aggregate portfolio figures for the digest (active/awaiting/expiring/overdue). */
export async function digestData(tx: MetraDb, today: string, soonDate: string): Promise<DigestData> {
  const [activeProjects, awaitingResponse, expiringSoon, overdueStages] =
    await Promise.all([
      countRows(tx, projects, eq(projects.status, 'active')),
      countRows(tx, proposals, eq(proposals.status, 'sent')),
      countRows(
        tx,
        proposals,
        and(
          eq(proposals.status, 'sent'),
          sql`${proposals.expiryDate} is not null`,
          gte(proposals.expiryDate, today),
          lte(proposals.expiryDate, soonDate),
        ),
      ),
      countRows(
        tx,
        projectStages,
        and(
          sql`${projectStages.endDate} is not null`,
          lt(projectStages.endDate, today),
          notInArray(projectStages.status, ['done', 'skipped']),
        ),
      ),
    ]);

  return { activeProjects, awaitingResponse, expiringSoon, overdueStages };
}
