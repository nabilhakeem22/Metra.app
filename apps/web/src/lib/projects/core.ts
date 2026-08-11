// PURE project cores. The client-existence + code-uniqueness checks run inside
// the tx; the composite same-org FK is the DB backstop for a cross-org client_id.
import {
  clients,
  projects,
  PROJECT_STATUSES,
  type MetraDb,
  type ProjectStatus,
} from '@metra/db';
import { and, eq, ne } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';

export interface ProjectInput {
  code: string;
  nameEn?: string | null;
  nameAr?: string | null;
  clientId: string;
  status: ProjectStatus;
  startDate?: string | null;
  endDate?: string | null;
  city?: string | null;
  address?: string | null;
  notes?: string | null;
}

function isStatus(v: unknown): v is ProjectStatus {
  return (PROJECT_STATUSES as readonly string[]).includes(v as string);
}

function clean(v: string | null | undefined): string | null {
  return v?.trim() || null;
}

interface Validated {
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
}

// Shared field validation -> a coded error or the normalized row.
function validate(input: ProjectInput): ActionResult | Validated {
  const code = input.code?.trim();
  if (!code) return err('code_required');
  const nameEn = clean(input.nameEn);
  const nameAr = clean(input.nameAr);
  if (!nameEn && !nameAr) return err('name_required');
  if (!isStatus(input.status)) return err('invalid');
  if (!input.clientId?.trim()) return err('client_required');
  const startDate = clean(input.startDate);
  const endDate = clean(input.endDate);
  if (startDate && endDate && endDate < startDate) return err('invalid_dates');

  return {
    code,
    nameEn,
    nameAr,
    clientId: input.clientId,
    status: input.status,
    startDate,
    endDate,
    city: clean(input.city),
    address: clean(input.address),
    notes: clean(input.notes),
  };
}

function isErr(v: ActionResult | Validated): v is ActionResult {
  return 'ok' in v;
}

// The client must exist AND be active in THIS org (RLS scopes the read).
async function assertClientUsable(
  tx: MetraDb,
  clientId: string,
): Promise<void> {
  const [client] = await tx
    .select({ id: clients.id, active: clients.active })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);
  if (!client || !client.active) fail('client_required');
}

export async function createProjectCore(
  ctx: OrgContext,
  input: ProjectInput,
): Promise<ActionResult> {
  const v = validate(input);
  if (isErr(v)) return v;

  return mutateInOrg(
    ctx,
    { capability: 'projects', action: 'create' },
    async (tx, audit) => {
      const [dup] = await tx
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.code, v.code))
        .limit(1);
      if (dup) fail('code_taken');
      await assertClientUsable(tx, v.clientId);

      const [row] = await tx
        .insert(projects)
        .values({ orgId: ctx.orgId, ...v })
        .returning({ id: projects.id });
      await audit({
        entity: 'project',
        entityId: row.id,
        action: 'create',
        before: null,
        after: { code: v.code, client_id: v.clientId, status: v.status },
      });
      return row.id;
    },
  );
}

export async function updateProjectCore(
  ctx: OrgContext,
  input: { id: string } & ProjectInput,
): Promise<ActionResult> {
  const v = validate(input);
  if (isErr(v)) return v;

  return mutateInOrg(
    ctx,
    { capability: 'projects', action: 'update' },
    async (tx, audit) => {
      const [before] = await tx
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.id, input.id))
        .limit(1);
      if (!before) fail('invalid');

      const [dup] = await tx
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.code, v.code), ne(projects.id, input.id)))
        .limit(1);
      if (dup) fail('code_taken');
      await assertClientUsable(tx, v.clientId);

      await tx
        .update(projects)
        .set({ ...v, updatedAt: new Date() })
        .where(eq(projects.id, input.id));
      await audit({
        entity: 'project',
        entityId: input.id,
        action: 'update',
        before: null,
        after: { code: v.code, client_id: v.clientId, status: v.status },
      });
    },
  );
}

export async function setProjectActiveCore(
  ctx: OrgContext,
  input: { id: string; active: boolean },
): Promise<ActionResult> {
  return mutateInOrg(
    ctx,
    { capability: 'projects', action: 'update' },
    async (tx, audit) => {
      const [before] = await tx
        .select({ id: projects.id, active: projects.active })
        .from(projects)
        .where(eq(projects.id, input.id))
        .limit(1);
      if (!before) fail('invalid');

      await tx
        .update(projects)
        .set({ active: input.active, updatedAt: new Date() })
        .where(eq(projects.id, input.id));
      await audit({
        entity: 'project',
        entityId: input.id,
        action: 'update',
        before: { active: before.active },
        after: { active: input.active },
      });
    },
  );
}
