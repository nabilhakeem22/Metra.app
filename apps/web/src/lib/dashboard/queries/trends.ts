import 'server-only';
// The dashboard's MONTHLY TRENDS — the two series the charts are shaped from.
//
// This file is `dashboard/queries.ts` renamed (wave 4): the counts and the
// deliveries triage list moved to their own modules, and the window predicate
// the two series here duplicated became `monthWindow`.
//
// Months with NO rows are not returned by Postgres and are NOT filled here; the
// caller fills them (`range.ts fillMonths`), because a chart that silently skips
// an empty month draws a misleading line.
import { clients, projects } from '@metra/db';
import { gte, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import type { MonthlyBucket, RangeMonths } from '../range';

/**
 * "Created within the last `months` months, counting the current one."
 *
 * ONE declaration, because both series were carrying their own copy and a window
 * that means two slightly different things in two charts on one screen is a bug
 * nobody would spot.
 */
function monthWindow(column: PgColumn, months: RangeMonths): SQL {
  return gte(
    column,
    sql`date_trunc('month', now()) - make_interval(months => ${months - 1})`,
  );
}

/** One month of the projects chart: how many started, split by where they got to. */
export interface ProjectsMonth extends MonthlyBucket {
  active: number;
  completed: number;
  other: number;
}

/**
 * Projects created per month over the window, split by status — the trend AND the
 * detail in one chart, which is what the spec asked for.
 *
 * Grouped in Postgres by `date_trunc('month', created_at)`. Months with no projects
 * are NOT returned here; the caller fills the gaps, because a chart that silently
 * skips an empty month draws a misleading line.
 */
export function getProjectsByMonth(
  ctx: OrgContext,
  months: RangeMonths,
): Promise<ProjectsMonth[]> {
  return withOrgContext(ctx, async (tx) => {
    const rows = await tx
      .select({
        month: sql<string>`to_char(date_trunc('month', ${projects.createdAt}), 'YYYY-MM')`,
        active: sql<number>`count(*) filter (where ${projects.status} = 'active')::int`,
        completed: sql<number>`count(*) filter (where ${projects.status} = 'completed')::int`,
        other: sql<number>`count(*) filter (where ${projects.status} not in ('active','completed'))::int`,
      })
      .from(projects)
      .where(monthWindow(projects.createdAt, months))
      .groupBy(sql`date_trunc('month', ${projects.createdAt})`)
      .orderBy(sql`date_trunc('month', ${projects.createdAt})`);
    return rows;
  });
}

/** One month of the clients chart: how many were added, and how many still active. */
export interface ClientsMonth extends MonthlyBucket {
  active: number;
  inactive: number;
}

/** Clients added per month over the window, split active/inactive. Same shape and
 *  the same gap-filling contract as {@link getProjectsByMonth}. */
export function getClientsByMonth(
  ctx: OrgContext,
  months: RangeMonths,
): Promise<ClientsMonth[]> {
  return withOrgContext(ctx, async (tx) => {
    const rows = await tx
      .select({
        month: sql<string>`to_char(date_trunc('month', ${clients.createdAt}), 'YYYY-MM')`,
        active: sql<number>`count(*) filter (where ${clients.active})::int`,
        inactive: sql<number>`count(*) filter (where not ${clients.active})::int`,
      })
      .from(clients)
      .where(monthWindow(clients.createdAt, months))
      .groupBy(sql`date_trunc('month', ${clients.createdAt})`)
      .orderBy(sql`date_trunc('month', ${clients.createdAt})`);
    return rows;
  });
}
