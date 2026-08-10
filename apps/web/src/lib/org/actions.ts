'use server';

import { randomUUID } from 'node:crypto';
import { files, memberships, organizations } from '@metra/db';
import { eq, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { recordAudit } from '@/lib/audit';
import {
  ACTIVE_ORG_COOKIE,
  activeOrgCookieOptions,
} from '@/lib/auth/active-org';
import type { ActionResult } from '@/lib/auth/actions';
import { requireOrg } from '@/lib/auth/require-org';
import { getSessionUser } from '@/lib/auth/session';
import { withOrgContext, withUserContext } from '@/lib/db/context';
import { can } from '@/lib/permissions/can';
import {
  createSignedUploadUrl,
  ensureFilesBucket,
  type SignedUpload,
} from '@/lib/storage';

export interface OrgProfileInput {
  nameEn?: string | null;
  nameAr?: string | null;
  city?: string | null;
  taxRegistrationNumber?: string | null;
}

// Cap user-supplied text at the action boundary (defense-in-depth).
const LIMITS = { name: 200, city: 120, taxReg: 64 } as const;

function profileWithinLimits(
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
 * Creates the org + owner membership + audit atomically, persisting the profile
 * columns. Does NOT redirect on success — the onboarding wizard may still upload
 * a logo afterwards, then navigates itself. Already-onboarded users are sent to
 * /dashboard (no second org). Throws on invalid input.
 */
export async function createOrg(input: OrgProfileInput): Promise<void> {
  const user = await getSessionUser();
  if (!user) {
    redirect('/login');
  }

  const existing = (await withUserContext(user.id, (tx) =>
    tx.execute(
      sql`select 1 from public.app_current_user_memberships() limit 1`,
    ),
  )) as unknown as unknown[];
  if (existing.length > 0) {
    redirect('/dashboard');
  }

  const nameEn = input.nameEn?.trim() || null;
  const nameAr = input.nameAr?.trim() || null;
  if (!nameEn && !nameAr) {
    throw new Error('At least one firm name is required.');
  }
  const city = input.city?.trim() || null;
  const taxRegistrationNumber = input.taxRegistrationNumber?.trim() || null;
  if (!profileWithinLimits(nameEn, nameAr, city, taxRegistrationNumber)) {
    throw new Error('invalid');
  }

  const orgId = randomUUID();

  await withOrgContext(
    { orgId, userId: user.id, role: 'owner' },
    async (tx) => {
      await tx.insert(organizations).values({
        id: orgId,
        nameEn,
        nameAr,
        city,
        taxRegistrationNumber,
        defaultLocale: 'ar-EG',
      });

      await tx
        .insert(memberships)
        .values({ orgId, userId: user.id, role: 'owner' });

      await recordAudit(tx, {
        entity: 'organization',
        entityId: orgId,
        action: 'create',
        before: null,
        after: {
          name_en: nameEn,
          name_ar: nameAr,
          city,
          tax_registration_number: taxRegistrationNumber,
        },
      });
    },
  );
}

/** Signed upload URL for the org logo (org must already exist). */
export async function createLogoUpload(input: {
  contentType?: string;
  originalName?: string;
}): Promise<SignedUpload> {
  const ctx = await requireOrg();
  await ensureFilesBucket();
  return createSignedUploadUrl(ctx, 'org-logo', {
    contentType: input.contentType,
    originalName: input.originalName,
  });
}

/** Points the org at an uploaded logo file — only if the file is in the org. */
export async function setOrgLogo(fileId: string): Promise<ActionResult> {
  const ctx = await requireOrg();
  return withOrgContext(ctx, async (tx) => {
    // Confirm the file belongs to the caller's org (RLS-scoped). Reject otherwise.
    const [owned] = await tx
      .select({ id: files.id })
      .from(files)
      .where(eq(files.id, fileId))
      .limit(1);
    if (!owned) return { ok: false, error: 'invalid' };

    await tx
      .update(organizations)
      .set({ logoFileId: fileId, updatedAt: new Date() })
      .where(eq(organizations.id, ctx.orgId));

    await recordAudit(tx, {
      entity: 'organization',
      entityId: ctx.orgId,
      action: 'update',
      before: null,
      after: { logo_file_id: fileId },
    });
    return { ok: true };
  });
}

// --- Org settings (owner/admin only) ---------------------------------------
function canManage(role: Parameters<typeof can>[0]): boolean {
  return can(role, 'users_settings', 'update');
}

export async function updateOrgProfile(
  input: OrgProfileInput,
): Promise<ActionResult> {
  const ctx = await requireOrg();
  if (!canManage(ctx.role)) return { ok: false, error: 'forbidden' };

  const nameEn = input.nameEn?.trim() || null;
  const nameAr = input.nameAr?.trim() || null;
  if (!nameEn && !nameAr) return { ok: false, error: 'name_required' };
  const city = input.city?.trim() || null;
  const taxRegistrationNumber = input.taxRegistrationNumber?.trim() || null;
  if (!profileWithinLimits(nameEn, nameAr, city, taxRegistrationNumber)) {
    return { ok: false, error: 'invalid' };
  }

  await withOrgContext(ctx, async (tx) => {
    const [before] = await tx
      .select({
        nameEn: organizations.nameEn,
        nameAr: organizations.nameAr,
        city: organizations.city,
        taxRegistrationNumber: organizations.taxRegistrationNumber,
      })
      .from(organizations)
      .where(eq(organizations.id, ctx.orgId))
      .limit(1);

    await tx
      .update(organizations)
      .set({ nameEn, nameAr, city, taxRegistrationNumber, updatedAt: new Date() })
      .where(eq(organizations.id, ctx.orgId));

    await recordAudit(tx, {
      entity: 'organization',
      entityId: ctx.orgId,
      action: 'update',
      before: before ?? null,
      after: { nameEn, nameAr, city, taxRegistrationNumber },
    });
  });

  revalidatePath('/', 'layout');
  return { ok: true };
}

export async function updateOrgSettings(input: {
  hideMarginFromPm: boolean;
  restrictFirmDashboard: boolean;
}): Promise<ActionResult> {
  const ctx = await requireOrg();
  if (!canManage(ctx.role)) return { ok: false, error: 'forbidden' };

  const hideMarginFromPm = !!input.hideMarginFromPm;
  const restrictFirmDashboard = !!input.restrictFirmDashboard;

  await withOrgContext(ctx, async (tx) => {
    const [before] = await tx
      .select({
        hideMarginFromPm: organizations.hideMarginFromPm,
        restrictFirmDashboard: organizations.restrictFirmDashboard,
      })
      .from(organizations)
      .where(eq(organizations.id, ctx.orgId))
      .limit(1);

    await tx
      .update(organizations)
      .set({ hideMarginFromPm, restrictFirmDashboard, updatedAt: new Date() })
      .where(eq(organizations.id, ctx.orgId));

    await recordAudit(tx, {
      entity: 'organization',
      entityId: ctx.orgId,
      action: 'update',
      before: before ?? null,
      after: { hideMarginFromPm, restrictFirmDashboard },
    });
  });

  revalidatePath('/', 'layout');
  return { ok: true };
}

// --- Org switch (never trust a client-supplied org id) ---------------------
export async function setActiveOrg(orgId: string): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'forbidden' };

  // Validate membership server-side via the SECURITY DEFINER fn.
  const rows = (await withUserContext(user.id, (tx) =>
    tx.execute(
      sql`select org_id from public.app_current_user_orgs() where org_id = ${orgId} limit 1`,
    ),
  )) as unknown as unknown[];
  if (rows.length === 0) {
    // Not a member of that org — set nothing.
    return { ok: false, error: 'forbidden' };
  }

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_ORG_COOKIE, orgId, activeOrgCookieOptions());
  revalidatePath('/', 'layout');
  return { ok: true };
}
