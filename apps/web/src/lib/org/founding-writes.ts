// The writes that found a studio, inside createOrgCore's one transaction and in
// this order: the account, the studio and its founder; the workspace's
// entitlements and automation defaults; the catalogues every studio starts with.
import {
  documentCategories,
  defaultDocumentCategories,
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
  type MetraDb,
} from '@metra/db';
import { sql } from 'drizzle-orm';
import type { OrgContext } from '@/lib/db/context';
import type { Flow } from '@/lib/entitlements/flows';

/** The profile text a new studio is created with, already read and cleaned. */
interface StudioProfile {
  nameEn: string | null;
  nameAr: string | null;
  city: string | null;
  taxRegistrationNumber: string | null;
}

/** Writes the account, the studio row and the founder's owner membership, in that order. */
export async function foundStudio(tx: MetraDb, ctx: OrgContext, profile: StudioProfile): Promise<void> {
  const { nameEn, nameAr, city, taxRegistrationNumber } = profile;
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
  // Written while the studio has no member: the one moment trg_memberships_role_writer
  // (enforce_membership_role_writer, MT150 otherwise) admits owner from a non-member.
  await tx
    .insert(memberships)
    .values({ orgId: ctx.orgId, userId: ctx.userId, role: 'owner' });
}

/** Writes the new workspace's entitlements and automation defaults; only after foundStudio. */
export async function provisionWorkspace(tx: MetraDb, ctx: OrgContext, flows: Flow[]): Promise<void> {
  // Per-workspace entitlements (A2): the flows resolved from the chosen firm
  // type (B1) — `interior` for the only selectable option today. MUST come
  // AFTER the owner membership insert foundStudio makes — the org_isolation WITH CHECK calls
  // app_is_current_org_member(), which is false until the membership exists.
  // Plain INSERT (no conflict path): a brand-new org has no prior row.
  await tx
    .insert(workspaceEntitlements)
    .values({ orgId: ctx.orgId, enabledFlows: flows });
  // Automation defaults (mirrors the 0016 backfill) so the cron acts on this
  // org from day one; every field is user-configurable in Settings.
  await tx.insert(automationSettings).values({ orgId: ctx.orgId });
}

/** Seeds what every studio starts with: work sections, project types, stage templates, document categories. */
export async function seedStudioDefaults(tx: MetraDb, ctx: OrgContext): Promise<void> {
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
  // The firm's starting filing vocabulary. Same defaults the 0040 migration
  // backfilled onto every pre-existing org, from the one shared source.
  await tx.insert(documentCategories).values(
    defaultDocumentCategories().map((c) => ({
      orgId: ctx.orgId,
      key: c.key,
      nameEn: c.nameEn,
      nameAr: c.nameAr,
      sortOrder: c.sortOrder,
    })),
  );
}
