'use server';

import { randomUUID } from 'node:crypto';
import { files, organizations } from '@metra/db';
import { eq, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { recordAudit } from '@/lib/audit';
import {
  ACTIVE_ORG_COOKIE,
  activeOrgCookieOptions,
} from '@/lib/auth/active-org';
import { err, type ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import { getSessionUser } from '@/lib/auth/session';
import { withOrgContext, withUserContext } from '@/lib/db/context';
import { canManageOrg } from '@/lib/permissions/can';
import {
  createSignedUploadUrl,
  ensureFilesBucket,
  type SignedUpload,
} from '@/lib/storage';
import {
  createOrgCore,
  profileWithinLimits,
  type OrgProfileInput,
} from './core';

export type { OrgProfileInput };

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

  const res = await createOrgCore(
    { orgId: randomUUID(), userId: user.id, role: 'owner' },
    input,
  );
  // Throw the code so the wizard can localize it (contract preserved).
  if (!res.ok) throw new Error(res.error ?? 'invalid');
}

/** Signed upload URL for the org logo (org must already exist). Manage-only. */
export async function createLogoUpload(input: {
  contentType?: string;
  originalName?: string;
}): Promise<SignedUpload | ActionResult> {
  const ctx = await requireOrg();
  if (!canManageOrg(ctx.role)) return err('forbidden');
  await ensureFilesBucket();
  return createSignedUploadUrl(ctx, 'org-logo', {
    contentType: input.contentType,
    originalName: input.originalName,
  });
}

/** Points the org at an uploaded logo file — only if the file is in the org. */
export async function setOrgLogo(fileId: string): Promise<ActionResult> {
  const ctx = await requireOrg();
  if (!canManageOrg(ctx.role)) return err('forbidden');
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

export async function updateOrgProfile(
  input: OrgProfileInput,
): Promise<ActionResult> {
  const ctx = await requireOrg();
  if (!canManageOrg(ctx.role)) return { ok: false, error: 'forbidden' };

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
  if (!canManageOrg(ctx.role)) return { ok: false, error: 'forbidden' };

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
