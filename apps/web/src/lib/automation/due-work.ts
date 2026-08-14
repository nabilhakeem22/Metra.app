import 'server-only';
import {
  memberships,
  projectStages,
  projects,
  proposalEvents,
  proposals,
  type MetraDb,
} from '@metra/db';
import { and, eq, gte, inArray, lt, lte, notInArray, sql } from 'drizzle-orm';

// All of these run INSIDE a single-org withOrgContext RLS tx (the runner opens
// it per org). Date columns are compared against Cairo `YYYY-MM-DD` strings.

/** Sent proposals whose expiry date is strictly before today (due to expire). */
export function dueForExpiry(
  tx: MetraDb,
  today: string,
): Promise<Array<{ id: string }>> {
  return tx
    .select({ id: proposals.id })
    .from(proposals)
    .where(
      and(
        eq(proposals.status, 'sent'),
        sql`${proposals.expiryDate} is not null`,
        lt(proposals.expiryDate, today),
      ),
    );
}

export interface NudgeCandidate {
  id: string;
  number: number;
  expiryDate: string | null;
  senderUserId: string | null;
}

/** Sent proposals expiring exactly on `targetDate` (today + lead) — pre-nudge. */
export function dueForExpiryNudge(
  tx: MetraDb,
  targetDate: string,
): Promise<NudgeCandidate[]> {
  return tx
    .select({
      id: proposals.id,
      number: proposals.number,
      expiryDate: proposals.expiryDate,
      senderUserId: proposalEvents.actorUserId,
    })
    .from(proposals)
    .innerJoin(
      proposalEvents,
      and(
        eq(proposalEvents.proposalId, proposals.id),
        eq(proposalEvents.kind, 'sent'),
      ),
    )
    .where(
      and(eq(proposals.status, 'sent'), eq(proposals.expiryDate, targetDate)),
    );
}

export interface FollowupCandidate {
  id: string;
  number: number;
  titleEn: string | null;
  titleAr: string | null;
  senderUserId: string | null;
  sentAt: Date;
}

/** Sent (not-yet-accepted) proposals + their sender + send timestamp. */
export function dueForFollowup(tx: MetraDb): Promise<FollowupCandidate[]> {
  return tx
    .select({
      id: proposals.id,
      number: proposals.number,
      titleEn: proposals.titleEn,
      titleAr: proposals.titleAr,
      senderUserId: proposalEvents.actorUserId,
      sentAt: proposalEvents.createdAt,
    })
    .from(proposals)
    .innerJoin(
      proposalEvents,
      and(
        eq(proposalEvents.proposalId, proposals.id),
        eq(proposalEvents.kind, 'sent'),
      ),
    )
    .where(eq(proposals.status, 'sent'));
}

export interface DigestData {
  activeProjects: number;
  awaitingResponse: number;
  expiringSoon: number;
  overdueStages: number;
}

/** Aggregate portfolio figures for the digest (active/awaiting/expiring/overdue). */
export async function digestData(
  tx: MetraDb,
  today: string,
  soonDate: string,
): Promise<DigestData> {
  const count = async (
    table: typeof projects | typeof proposals | typeof projectStages,
    where: ReturnType<typeof and>,
  ): Promise<number> => {
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(table)
      .where(where);
    return Number(row?.n ?? 0);
  };

  const [activeProjects, awaitingResponse, expiringSoon, overdueStages] =
    await Promise.all([
      count(projects, eq(projects.status, 'active')),
      count(proposals, eq(proposals.status, 'sent')),
      count(
        proposals,
        and(
          eq(proposals.status, 'sent'),
          sql`${proposals.expiryDate} is not null`,
          gte(proposals.expiryDate, today),
          lte(proposals.expiryDate, soonDate),
        ),
      ),
      count(
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

/** Owner + admin user ids in the current org (digest + stage recipients). */
export function orgOwnerAdminIds(tx: MetraDb): Promise<Array<{ userId: string }>> {
  return tx
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(inArray(memberships.role, ['owner', 'admin']));
}
