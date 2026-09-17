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
} from '@/lib/storage/uploads';
import { clean } from '@/lib/validation/text';
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
 * /dashboard (no second org), and a signed-out caller to /login.
 *
 * Returns the core's coded ActionResult so the wizard can localize the failure;
 * it never throws its own error. (The two redirect() calls still throw the
 * framework's NEXT_REDIRECT signal — that is how redirect works, and React
 * must be allowed to see it.)
 */
export async function createOrg(input: OrgProfileInput): Promise<ActionResult> {
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

  return createOrgCore(
    { orgId: randomUUID(), userId: user.id, role: 'owner' },
    input,
  );
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

  const nameEn = clean(input.nameEn);
  const nameAr = clean(input.nameAr);
  if (!nameEn && !nameAr) return { ok: false, error: 'name_required' };
  const city = clean(input.city);
  const taxRegistrationNumber = clean(input.taxRegistrationNumber);
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
