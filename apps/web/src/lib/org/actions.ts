'use server';

import { randomUUID } from 'node:crypto';
import { organizations } from '@metra/db';
import { eq, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { fieldsFailed } from '@/lib/actions/field-errors';
import { mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import { getSessionUser } from '@/lib/auth/session';
import { withUserContext } from '@/lib/db/context';
import { seedAfterSignup } from '@/lib/market-book/seed-after-signup';
import { canManageOrg } from '@/lib/permissions/can';
import { createOrgCore, type OrgProfileInput } from './core';
import { readOrgProfile, type OrgProfileText } from './profile-field-rules';

export type { OrgProfileInput };

/**
 * Creates the org + owner membership + audit atomically, persisting the profile
 * columns, then schedules the new studio's market price book for after the
 * response (seedAfterSignup). Does NOT redirect on success — the onboarding
 * wizard may still upload a logo afterwards, then navigates itself.
 * Already-onboarded users are sent to /dashboard (no second org), and a
 * signed-out caller to /login.
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

  const ctx = { orgId: randomUUID(), userId: user.id, role: 'owner' } as const;
  const result = await createOrgCore(ctx, input);
  // The new studio's market price book loads after this response is sent; a
  // failure there never reaches the sign-up (its empty price book offers it).
  if (result.ok) seedAfterSignup(ctx);
  return result;
}

// --- Org settings (owner/admin only) ---------------------------------------
// Both writes run through mutateInOrg, so a failure is answered with its cause
// (a lost connection as `uncertain`, a deadlock as `busy`, anything else with a
// reference) instead of a rejected promise.

export async function updateOrgProfile(input: OrgProfileText): Promise<ActionResult> {
  const ctx = await requireOrg();
  if (!canManageOrg(ctx.role)) return err('forbidden');
  const profile = readOrgProfile(input);
  if (!profile.ok) return fieldsFailed(profile.errors);
  const after = profile.values;

  const result = await mutateInOrg(ctx, {}, async (tx, audit) => {
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
      .set({ ...after, updatedAt: new Date() })
      .where(eq(organizations.id, ctx.orgId));
    await audit({ entity: 'organization', entityId: ctx.orgId, action: 'update', before: before ?? null, after });
  });
  if (result.ok) revalidatePath('/', 'layout');
  return result;
}

export async function updateOrgSettings(input: {
  hideMarginFromPm: boolean;
  restrictFirmDashboard: boolean;
}): Promise<ActionResult> {
  const ctx = await requireOrg();
  if (!canManageOrg(ctx.role)) return err('forbidden');
  const after = {
    hideMarginFromPm: !!input.hideMarginFromPm,
    restrictFirmDashboard: !!input.restrictFirmDashboard,
  };

  const result = await mutateInOrg(ctx, {}, async (tx, audit) => {
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
      .set({ ...after, updatedAt: new Date() })
      .where(eq(organizations.id, ctx.orgId));
    await audit({ entity: 'organization', entityId: ctx.orgId, action: 'update', before: before ?? null, after });
  });
  if (result.ok) revalidatePath('/', 'layout');
  return result;
}
