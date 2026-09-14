// PURE per-project stage cores. Fully editable (add/update/remove, status,
// progress) — NO linear guard, so a project can START AT ANY PHASE. Config
// writes gate on `projects`/update. The parent project must be in-org.
import { STAGE_STATUSES, projectStages, projects, type StageStatus } from '@metra/db';
import { eq } from 'drizzle-orm';
import { mutateInOrg, requireInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { isUuid } from '@/lib/uuid';
import { clean, normalizePercent } from '@/lib/validation/text';

const NAME_MAX = 200;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validStatus(s: unknown): s is StageStatus {
  return STAGE_STATUSES.includes(s as StageStatus);
}

function validDate(v: string | null | undefined): boolean {
  const s = v?.trim();
  if (!s) return true;
  return ISO_DATE_RE.test(s);
}

export interface StageInput {
  nameEn?: string | null;
  nameAr?: string | null;
  status?: StageStatus | null;
  progressPct?: string | null;
  sortOrder?: number | null;
  startDate?: string | null;
  endDate?: string | null;
}

export async function addStageCore(
  ctx: OrgContext,
  input: { projectId: string } & StageInput,
): Promise<ActionResult & { data?: string }> {
  if (!isUuid(input.projectId)) return err('invalid');
  const nameEn = clean(input.nameEn);
  const nameAr = clean(input.nameAr);
  if (!nameEn && !nameAr) return err('name_required');
  if ((nameEn?.length ?? 0) > NAME_MAX || (nameAr?.length ?? 0) > NAME_MAX) {
    return err('invalid');
  }
  const status = input.status ?? 'not_started';
  if (!validStatus(status)) return err('invalid');
  const progressPct = normalizePercent(input.progressPct);
  if (progressPct === null) return err('invalid_percentage');
  if (!validDate(input.startDate) || !validDate(input.endDate)) {
    return err('invalid_date');
  }

  return mutateInOrg(
    ctx,
    { capability: 'projects', action: 'update' },
    async (tx, audit) => {
      // An existence assertion, not a read: the call IS the check, and it
      // fails with a coded error for an id that is absent or another tenant's.
      await requireInOrg(tx, projects, input.projectId, { id: projects.id }, 'invalid');

      // Default sort: append to the end.
      let sortOrder = input.sortOrder ?? null;
      if (sortOrder === null) {
        const rows = await tx
          .select({ s: projectStages.sortOrder })
          .from(projectStages)
          .where(eq(projectStages.projectId, input.projectId));
        sortOrder = rows.reduce((m, r) => Math.max(m, r.s), -1) + 1;
      }

      const [row] = await tx
        .insert(projectStages)
        .values({
          orgId: ctx.orgId,
          projectId: input.projectId,
          stageKey: null,
          nameEn,
          nameAr,
          status,
          progressPct,
          sortOrder,
          startDate: clean(input.startDate),
          endDate: clean(input.endDate),
        })
        .returning({ id: projectStages.id });
      await audit({
        entity: 'project_stage',
        entityId: row.id,
        action: 'create',
        before: null,
        after: { project_id: input.projectId, name_en: nameEn, status },
      });
      return row.id;
    },
  );
}

export async function updateStageCore(
  ctx: OrgContext,
  input: { id: string } & StageInput,
): Promise<ActionResult> {
  if (!isUuid(input.id)) return err('invalid');
  const nameEn = input.nameEn !== undefined ? clean(input.nameEn) : undefined;
  const nameAr = input.nameAr !== undefined ? clean(input.nameAr) : undefined;
  if (nameEn !== undefined && nameAr !== undefined && !nameEn && !nameAr) {
    return err('name_required');
  }
  const status = input.status ?? undefined;
  if (status !== undefined && !validStatus(status)) return err('invalid');
  let progressPct: string | undefined;
  if (input.progressPct !== undefined) {
    const p = normalizePercent(input.progressPct);
    if (p === null) return err('invalid_percentage');
    progressPct = p;
  }
  if (!validDate(input.startDate) || !validDate(input.endDate)) {
    return err('invalid_date');
  }

  return mutateInOrg(
    ctx,
    { capability: 'projects', action: 'update' },
    async (tx, audit) => {
      // An existence assertion, not a read: the call IS the check, and it
      // fails with a coded error for an id that is absent or another tenant's.
      await requireInOrg(tx, projectStages, input.id, { id: projectStages.id }, 'invalid');

      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (nameEn !== undefined) patch.nameEn = nameEn;
      if (nameAr !== undefined) patch.nameAr = nameAr;
      if (status !== undefined) patch.status = status;
      if (progressPct !== undefined) patch.progressPct = progressPct;
      if (input.sortOrder !== undefined && input.sortOrder !== null) {
        patch.sortOrder = input.sortOrder;
      }
      if (input.startDate !== undefined) patch.startDate = clean(input.startDate);
      if (input.endDate !== undefined) patch.endDate = clean(input.endDate);

      await tx
        .update(projectStages)
        .set(patch)
        .where(eq(projectStages.id, input.id));
      await audit({
        entity: 'project_stage',
        entityId: input.id,
        action: 'update',
        before: null,
        after: { status: status ?? null, progress: progressPct ?? null },
      });
    },
  );
}
