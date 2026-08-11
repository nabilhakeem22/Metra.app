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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function clean(v: string | null | undefined): string | null {
  return v?.trim() || null;
}

// Boundary length caps (defense-in-depth), mirroring org/core profileWithinLimits.
const LIMITS = {
  code: 64,
  name: 200,
  city: 120,
  address: 300,
  notes: 2000,
} as const;

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
  // A missing OR malformed client id -> client_required (no DB uuid-cast throw).
  const clientId = input.clientId?.trim();
  if (!clientId || !UUID_RE.test(clientId)) return err('client_required');

  const startDate = clean(input.startDate);
  const endDate = clean(input.endDate);
  // Compare chronologically (not lexically) so non-zero-padded dates still order.
  if (startDate && endDate) {
    const s = new Date(startDate).getTime();
    const e = new Date(endDate).getTime();
    if (Number.isFinite(s) && Number.isFinite(e) && e < s) {
      return err('invalid_dates');
    }
  }

  const city = clean(input.city);
  const address = clean(input.address);
  const notes = clean(input.notes);
  if (
    code.length > LIMITS.code ||
    (nameEn?.length ?? 0) > LIMITS.name ||
    (nameAr?.length ?? 0) > LIMITS.name ||
    (city?.length ?? 0) > LIMITS.city ||
    (address?.length ?? 0) > LIMITS.address ||
    (notes?.length ?? 0) > LIMITS.notes
  ) {
    return err('invalid');
  }

  return {
    code,
    nameEn,
    nameAr,
    clientId,
    status: input.status,
    startDate,
    endDate,
    city,
    address,
    notes,
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
        .select({ id: projects.id, clientId: projects.clientId })
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
      // Only require an active client when REASSIGNING to a different one.
      // Editing other fields with the same (possibly now-archived) client is
      // allowed; the composite FK still enforces same-org either way.
      if (v.clientId !== before.clientId) {
        await assertClientUsable(tx, v.clientId);
      }

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
