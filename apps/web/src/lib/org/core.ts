// PURE core for org creation (no next/*, no getSessionUser, no cookies). The
// 'use server' createOrg wrapper does the session/existing-check/redirect and
// delegates here. Exercised directly by tests/actions/createOrg.dbtest.ts.
import {
  automationSettings,
  DEFAULT_PROJECT_TYPES,
  DEFAULT_SECTIONS,
  DEFAULT_STAGE_TEMPLATES,
  memberships,
  organizations,
  projectTypes,
  sections,
  stageTemplates,
  workspaceEntitlements,
} from '@metra/db';
import { sql } from 'drizzle-orm';
import { mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { FLOWS } from '@/lib/entitlements/flows';
import { firmTypeDef, type FirmTypeKey } from '@/lib/entitlements/firm-types';

export interface OrgProfileInput {
  nameEn?: string | null;
  nameAr?: string | null;
  city?: string | null;
  taxRegistrationNumber?: string | null;
  // The chosen firm-type preset (Epic B1). Resolves server-side to the
  // workspace's enabled_flows set — the client NEVER supplies a raw flow array.
  // Defaults to 'interior' so existing callers keep their behaviour.
  firmType?: FirmTypeKey;
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

  // Resolve + validate the firm type SERVER-SIDE (defense-in-depth: the action is
  // directly invokable, so a hidden/disabled UI option is not a gate). We only
  // ever accept the firmType KEY — never a raw client-supplied flow array — and
  // map it to enabled_flows here. Runs BEFORE mutateInOrg, so a rejected type
  // opens no transaction and writes zero rows.
  const firmType: FirmTypeKey = input.firmType ?? 'interior';
  const firmTypeDefinition = firmTypeDef(firmType);
  if (!firmTypeDefinition || !firmTypeDefinition.available) {
    return err('firm_type_unavailable');
  }
  const flows = firmTypeDefinition.enabledFlows;
  if (flows.length === 0 || !flows.every((flow) => FLOWS.includes(flow))) {
    return err('firm_type_unavailable');
  }

  return mutateInOrg(ctx, {}, async (tx, audit) => {
    // Mint this org's owning account (above tenancy) via the bootstrap SDF — the
    // ONLY path that creates an account row — then link it. metra_app has SELECT
    // only on accounts; the SECURITY DEFINER function inserts as the BYPASSRLS
    // owner. Runs inside this same bootstrap transaction, so a failure rolls back
    // the org, membership AND the account together.
    const accountRows = (await tx.execute(
      sql`select id from public.app_bootstrap_account(${nameAr}, ${nameEn})`,
    )) as unknown as Array<{ id: string }>;
    const accountId = accountRows[0]?.id;
    await tx.insert(organizations).values({
      id: ctx.orgId,
      accountId,
      nameEn,
      nameAr,
      city,
      taxRegistrationNumber,
      defaultLocale: 'ar-EG',
    });
    await tx
      .insert(memberships)
      .values({ orgId: ctx.orgId, userId: ctx.userId, role: 'owner' });
    // Per-workspace entitlements (A2): the flows resolved from the chosen firm
    // type (B1) — `interior` for the only selectable option today. MUST come
    // AFTER the owner membership insert above — the org_isolation WITH CHECK calls
    // app_is_current_org_member(), which is false until the membership exists.
    // Plain INSERT (no conflict path): a brand-new org has no prior row.
    await tx
      .insert(workspaceEntitlements)
      .values({ orgId: ctx.orgId, enabledFlows: flows });
    // Automation defaults (mirrors the 0016 backfill) so the cron acts on this
    // org from day one; every field is user-configurable in Settings.
    await tx.insert(automationSettings).values({ orgId: ctx.orgId });
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
