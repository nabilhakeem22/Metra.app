import 'server-only';
import { projectStages, type MetraDb } from '@metra/db';
import { and, gte, lt, lte, notInArray, sql } from 'drizzle-orm';

export interface StageCandidate {
  id: string;
  projectId: string;
  nameEn: string | null;
  nameAr: string | null;
  endDate: string | null;
}

/** Stages past their end date and not done/skipped (overdue). */
export function overdueStages(
  tx: MetraDb,
  today: string,
): Promise<StageCandidate[]> {
  return tx
    .select({
      id: projectStages.id,
      projectId: projectStages.projectId,
      nameEn: projectStages.nameEn,
      nameAr: projectStages.nameAr,
      endDate: projectStages.endDate,
    })
    .from(projectStages)
    .where(
      and(
        sql`${projectStages.endDate} is not null`,
        lt(projectStages.endDate, today),
        notInArray(projectStages.status, ['done', 'skipped']),
      ),
    );
}

/** Stages whose end date falls in [today, horizon] and not done/skipped. */
export function upcomingStages(
  tx: MetraDb,
  today: string,
  horizon: string,
): Promise<StageCandidate[]> {
  return tx
    .select({
      id: projectStages.id,
      projectId: projectStages.projectId,
      nameEn: projectStages.nameEn,
      nameAr: projectStages.nameAr,
      endDate: projectStages.endDate,
    })
    .from(projectStages)
    .where(
      and(
        sql`${projectStages.endDate} is not null`,
        gte(projectStages.endDate, today),
        lte(projectStages.endDate, horizon),
        notInArray(projectStages.status, ['done', 'skipped']),
      ),
    );
}
