'use server';

import { randomUUID } from 'node:crypto';
import { memberships, organizations } from '@metra/db';
import { eq, sql } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { recordAudit } from '@/lib/audit';
import { requireOrg } from '@/lib/auth/require-org';
import { getSessionUser } from '@/lib/auth/session';
import { withOrgContext, withUserContext } from '@/lib/db/context';
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

/** Points the org at an uploaded logo file. */
export async function setOrgLogo(fileId: string): Promise<void> {
  const ctx = await requireOrg();
  await withOrgContext(ctx, async (tx) => {
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
  });
}
