// PURE core for org creation (no next/*, no getSessionUser, no cookies). The
// 'use server' createOrg wrapper does the session/existing-check/redirect and
// delegates here. Exercised directly by tests/actions/createOrg.dbtest.ts.
import {
  DEFAULT_PROJECT_TYPES,
  DEFAULT_SECTIONS,
  DEFAULT_STAGE_TEMPLATES,
  memberships,
  organizations,
  projectTypes,
  sections,
  stageTemplates,
} from '@metra/db';
import { mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';

export interface OrgProfileInput {
  nameEn?: string | null;
  nameAr?: string | null;
  city?: string | null;
  taxRegistrationNumber?: string | null;
}

// Cap user-supplied text at the boundary (defense-in-depth).
const LIMITS = { name: 200, city: 120, taxReg: 64 } as const;

export function profileWithinLimits(
  nameEn: string | null,
  nameAr: string | null,
  city: string | null,
  tax: string | null,
): boolean {
  return (
    (nameEn?.length ?? 0) <= LIMITS.name &&
    (nameAr?.length ?? 0) <= LIMITS.name &&
    (city?.length ?? 0) <= LIMITS.city &&
    (tax?.length ?? 0) <= LIMITS.taxReg
  );
}

/**
 * Creates the org + owner membership + audit atomically. `ctx` must carry the
 * NEW orgId + the founding user (role owner). Returns a coded ActionResult.
 */
export async function createOrgCore(
  ctx: OrgContext,
  input: OrgProfileInput,
): Promise<ActionResult> {
  const nameEn = input.nameEn?.trim() || null;
  const nameAr = input.nameAr?.trim() || null;
  if (!nameEn && !nameAr) return err('name_required');
  const city = input.city?.trim() || null;
  const taxRegistrationNumber = input.taxRegistrationNumber?.trim() || null;
  if (!profileWithinLimits(nameEn, nameAr, city, taxRegistrationNumber)) {
    return err('invalid');
  }

  return mutateInOrg(ctx, {}, async (tx, audit) => {
    await tx.insert(organizations).values({
      id: ctx.orgId,
      nameEn,
      nameAr,
      city,
      taxRegistrationNumber,
      defaultLocale: 'ar-EG',
    });
    await tx
      .insert(memberships)
      .values({ orgId: ctx.orgId, userId: ctx.userId, role: 'owner' });
    // Seed the 8 default work sections (shared by Price Book + proposal builder).
    await tx.insert(sections).values(
      DEFAULT_SECTIONS.map((s) => ({
        orgId: ctx.orgId,
        key: s.key,
        nameEn: s.nameEn,
        nameAr: s.nameAr,
      })),
    );
    // Seed the 5 default project types + 10 default stage templates.
    await tx.insert(projectTypes).values(
      DEFAULT_PROJECT_TYPES.map((tpe) => ({
        orgId: ctx.orgId,
        key: tpe.key,
        nameEn: tpe.nameEn,
        nameAr: tpe.nameAr,
        sortOrder: tpe.sortOrder,
      })),
    );
    await tx.insert(stageTemplates).values(
      DEFAULT_STAGE_TEMPLATES.map((s) => ({
        orgId: ctx.orgId,
        key: s.key,
        nameEn: s.nameEn,
        nameAr: s.nameAr,
        sortOrder: s.sortOrder,
      })),
    );
    await audit({
      entity: 'organization',
      entityId: ctx.orgId,
      action: 'create',
      before: null,
      // camelCase to match updateOrgProfile's audit shape — one key path for
      // the organization entity's history.
      after: { nameEn, nameAr, city, taxRegistrationNumber },
    });
  });
}
