// PURE project cores. The client-existence + code-uniqueness checks run inside
// the tx; the composite same-org FK is the DB backstop for a cross-org client_id.
import {
  clients,
  projects,
  projectStages,
  PROJECT_STATUSES,
  stageTemplates,
  type MetraDb,
  type ProjectStatus,
} from '@metra/db';
import { and, asc, eq, ne } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import { appendSystemActivity } from '@/lib/activities/core';
import type { OrgContext } from '@/lib/db/context';

export interface ProjectInput {
  code: string;
  nameEn?: string | null;
  nameAr?: string | null;
  clientId: string;
  typeId?: string | null;
  status: ProjectStatus;
  contractRef?: string | null;
  description?: string | null;
  advancePct?: string | null;
  retentionPct?: string | null;
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
const PCT_RE = /^\d+(\.\d+)?$/;

function clean(v: string | null | undefined): string | null {
  return v?.trim() || null;
}

/** Non-negative percentage in [0,100] as a decimal string, or null if invalid. */
function normPct(v: string | null | undefined): string | null {
  const s = v?.trim();
  if (s === undefined || s === '') return '0';
  if (!PCT_RE.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return s;
}

// Boundary length caps (defense-in-depth), mirroring org/core profileWithinLimits.
const LIMITS = {
  code: 64,
  name: 200,
  city: 120,
  address: 300,
  notes: 2000,
  contractRef: 120,
  description: 4000,
} as const;

interface Validated {
  code: string;
  nameEn: string | null;
  nameAr: string | null;
  clientId: string;
  typeId: string | null;
  status: ProjectStatus;
  contractRef: string | null;
  description: string | null;
  advancePct: string;
  retentionPct: string;
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

  // Type is optional; if present it must be a uuid (in-org enforced by the FK).
  const typeId = clean(input.typeId);
  if (typeId && !UUID_RE.test(typeId)) return err('invalid');

  const advancePct = normPct(input.advancePct);
  const retentionPct = normPct(input.retentionPct);
  if (advancePct === null || retentionPct === null) return err('invalid');

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
  const contractRef = clean(input.contractRef);
  const description = clean(input.description);
  if (
    code.length > LIMITS.code ||
    (nameEn?.length ?? 0) > LIMITS.name ||
    (nameAr?.length ?? 0) > LIMITS.name ||
    (city?.length ?? 0) > LIMITS.city ||
    (address?.length ?? 0) > LIMITS.address ||
    (notes?.length ?? 0) > LIMITS.notes ||
    (contractRef?.length ?? 0) > LIMITS.contractRef ||
    (description?.length ?? 0) > LIMITS.description
  ) {
    return err('invalid');
  }

  return {
    code,
    nameEn,
    nameAr,
    clientId,
    typeId,
    status: input.status,
    contractRef,
    description,
    advancePct,
    retentionPct,
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
): Promise<ActionResult & { data?: string }> {
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

      // Seed this project's stages from the org's active stage templates (in
      // process order). Editable afterwards — start-from-any-phase.
      const templates = await tx
        .select()
        .from(stageTemplates)
        .where(eq(stageTemplates.active, true))
        .orderBy(asc(stageTemplates.sortOrder), asc(stageTemplates.createdAt));
      if (templates.length) {
        await tx.insert(projectStages).values(
          templates.map((tpl, i) => ({
            orgId: ctx.orgId,
            projectId: row.id,
            stageKey: tpl.key,
            nameEn: tpl.nameEn,
            nameAr: tpl.nameAr,
            sortOrder: i,
            status: 'not_started' as const,
            progressPct: '0',
          })),
        );
      }

      await appendSystemActivity(tx, ctx, {
        entityType: 'project',
        entityId: row.id,
        kind: 'project_created',
      });
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
