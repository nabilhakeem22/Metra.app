import 'server-only';
import {
  type Client,
  type CostItem,
  clients,
  costItems,
  projects,
  proposals,
} from '@metra/db';
import { desc, eq, getTableColumns, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import type { ProjectWithTypeNames } from './serializers/project';
import type { ProposalSummaryRow } from './serializers/proposal';
import type { Cursor } from './pagination';

// Keyset (cursor) pagination for the Public API (v1). Stable total order is
// (created_at desc, id desc); every list fetches `limit + 1` rows so the route can
// tell whether a further page exists without a COUNT. All reads go through
// withOrgContext, so RLS + the membership second factor apply unchanged.
//
// The cursor timestamp is FULL-microsecond precision on BOTH sides (F1): each row
// carries `cursorTs` computed by to_char, and the keyset predicate casts that same
// string back with ::timestamptz — so a same-millisecond group is never skipped.

/** Rows augmented with the full-precision cursor timestamp string. */
type WithCursorTs<T> = T & { cursorTs: string };

/** Microsecond ISO (YYYY-MM-DDTHH:MM:SS.ffffffZ) for a created_at column. */
function cursorTsExpr(createdAtCol: AnyPgColumn): SQL<string> {
  return sql<string>`to_char(${createdAtCol} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

/** Row-value keyset predicate for the (created_at desc, id desc) order. */
function keysetAfter(
  createdAtCol: AnyPgColumn,
  idCol: AnyPgColumn,
  cursor: Cursor | null,
): SQL | undefined {
  if (!cursor) return undefined;
  return sql`(${createdAtCol}, ${idCol}) < (${cursor.ts}::timestamptz, ${cursor.id}::uuid)`;
}

export interface PageQuery {
  limit: number;
  cursor: Cursor | null;
}

export function listClientsPage(
  ctx: OrgContext,
  { limit, cursor }: PageQuery,
): Promise<WithCursorTs<Client>[]> {
  return withOrgContext(ctx, (tx) =>
    tx
      .select({
        ...getTableColumns(clients),
        cursorTs: cursorTsExpr(clients.createdAt),
      })
      .from(clients)
      .where(keysetAfter(clients.createdAt, clients.id, cursor))
      .orderBy(desc(clients.createdAt), desc(clients.id))
      .limit(limit + 1),
  );
}

export function getClientById(
  ctx: OrgContext,
  id: string,
): Promise<Client | null> {
  return withOrgContext(ctx, async (tx) => {
    const [row] = await tx
      .select()
      .from(clients)
      .where(eq(clients.id, id))
      .limit(1);
    return row ?? null;
  });
}

export function listProjectsPage(
  ctx: OrgContext,
  { limit, cursor }: PageQuery,
): Promise<WithCursorTs<ProjectWithTypeNames>[]> {
  return withOrgContext(ctx, (tx) =>
    tx
      .select({
        ...getTableColumns(projects),
        cursorTs: cursorTsExpr(projects.createdAt),
      })
      .from(projects)
      .where(keysetAfter(projects.createdAt, projects.id, cursor))
      .orderBy(desc(projects.createdAt), desc(projects.id))
      .limit(limit + 1),
  );
}

export function getProjectById(
  ctx: OrgContext,
  id: string,
): Promise<ProjectWithTypeNames | null> {
  return withOrgContext(ctx, async (tx) => {
    const [row] = await tx
      .select()
      .from(projects)
      .where(eq(projects.id, id))
      .limit(1);
    return row ?? null;
  });
}

export function listCostItemsPage(
  ctx: OrgContext,
  { limit, cursor }: PageQuery,
): Promise<WithCursorTs<CostItem>[]> {
  return withOrgContext(ctx, (tx) =>
    tx
      .select({
        ...getTableColumns(costItems),
        cursorTs: cursorTsExpr(costItems.createdAt),
      })
      .from(costItems)
      .where(keysetAfter(costItems.createdAt, costItems.id, cursor))
      .orderBy(desc(costItems.createdAt), desc(costItems.id))
      .limit(limit + 1),
  );
}

export function getCostItemById(
  ctx: OrgContext,
  id: string,
): Promise<CostItem | null> {
  return withOrgContext(ctx, async (tx) => {
    const [row] = await tx
      .select()
      .from(costItems)
      .where(eq(costItems.id, id))
      .limit(1);
    return row ?? null;
  });
}

export function listProposalsPage(
  ctx: OrgContext,
  { limit, cursor }: PageQuery,
): Promise<WithCursorTs<ProposalSummaryRow>[]> {
  return withOrgContext(ctx, (tx) =>
    tx
      .select({
        id: proposals.id,
        number: proposals.number,
        titleAr: proposals.titleAr,
        titleEn: proposals.titleEn,
        status: proposals.status,
        currency: proposals.currency,
        total: proposals.total,
        issueDate: proposals.issueDate,
        clientId: proposals.clientId,
        projectId: proposals.projectId,
        createdAt: proposals.createdAt,
        cursorTs: cursorTsExpr(proposals.createdAt),
      })
      .from(proposals)
      .where(keysetAfter(proposals.createdAt, proposals.id, cursor))
      .orderBy(desc(proposals.createdAt), desc(proposals.id))
      .limit(limit + 1),
  );
}
