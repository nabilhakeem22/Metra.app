import 'server-only';
import { clients, projects, type ProjectStatus } from '@metra/db';
import { and, asc, eq, ilike, or } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';

export interface ListProjectsFilter {
  status?: ProjectStatus;
  clientId?: string;
  active?: boolean;
  q?: string;
}

export interface ProjectRow {
  id: string;
  code: string;
  nameEn: string | null;
  nameAr: string | null;
  clientId: string;
  status: ProjectStatus;
  startDate: string | null;
  endDate: string | null;
  city: string | null;
  address: string | null;
  notes: string | null;
  active: boolean;
  clientNameEn: string | null;
  clientNameAr: string | null;
}

/** Org-scoped projects with the client name joined in, optionally filtered. */
export function listProjects(
  ctx: OrgContext,
  filter: ListProjectsFilter = {},
): Promise<ProjectRow[]> {
  return withOrgContext(ctx, (tx) => {
    const conds = [];
    if (filter.status) conds.push(eq(projects.status, filter.status));
    if (filter.clientId) conds.push(eq(projects.clientId, filter.clientId));
    if (filter.active !== undefined) conds.push(eq(projects.active, filter.active));
    if (filter.q && filter.q.trim()) {
      const pattern = `%${filter.q.trim()}%`;
      conds.push(
        or(
          ilike(projects.code, pattern),
          ilike(projects.nameEn, pattern),
          ilike(projects.nameAr, pattern),
        ),
      );
    }
    return tx
      .select({
        id: projects.id,
        code: projects.code,
        nameEn: projects.nameEn,
        nameAr: projects.nameAr,
        clientId: projects.clientId,
        status: projects.status,
        startDate: projects.startDate,
        endDate: projects.endDate,
        city: projects.city,
        address: projects.address,
        notes: projects.notes,
        active: projects.active,
        clientNameEn: clients.nameEn,
        clientNameAr: clients.nameAr,
      })
      .from(projects)
      .leftJoin(clients, eq(clients.id, projects.clientId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(asc(projects.code));
  });
}
