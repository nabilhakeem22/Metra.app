// Tenant shell + identity for a seeded org: the organization row, its owner
// membership, a seed file, a pending invite, a public API key, and the org-create
// audit entry. All idempotent; audit is append-only so it self-guards.
import { createHash } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type { MetraDb } from '../client';
import { apiKeys } from '../schema/api-keys';
import { auditLog } from '../schema/audit-log';
import { files } from '../schema/files';
import { invitations } from '../schema/invitations';
import { memberships } from '../schema/memberships';
import { organizations } from '../schema/organizations';
import type { OrgSeed } from './seed-org-fixtures';

export async function seedOrgFoundation(tx: MetraDb, org: OrgSeed): Promise<void> {
  // Mint this org's owning account (above tenancy, A1) via the bootstrap SDF —
  // the only path that creates an account — then link it 1:1. Idempotent by
  // design: mint ONLY when the org has no account yet (a fresh org, or a legacy
  // row still carrying NULL). If it already carries one, reuse it and mint
  // nothing, so a re-run of seed adds ZERO new accounts.
  const existingOrg = await tx
    .select({ accountId: organizations.accountId })
    .from(organizations)
    .where(eq(organizations.id, org.orgId));
  let accountId = existingOrg[0]?.accountId ?? null;
  if (!accountId) {
    const rows = (await tx.execute(
      sql`select id from public.app_bootstrap_account(${org.nameAr}, ${org.nameEn})`,
    )) as unknown as Array<{ id: string }>;
    accountId = rows[0].id;
  }

  // First seed INSERTs the org already linked to its account (WITH CHECK is
  // bootstrap-open: id = current_org, so this passes before any membership exists).
  // On a re-seed the org already exists, so DO NOTHING no-ops — and because the
  // mint above is guarded on the org's existing account_id, nothing is re-minted.
  // NOTE: we deliberately do NOT ON CONFLICT DO UPDATE here — that would drag in the
  // organizations UPDATE policy, whose USING requires app_is_current_org_member(),
  // which is false during bootstrap (owner membership isn't inserted until below) →
  // the row would be rejected by RLS. Relinking a legacy NULL-account org is both
  // impossible under this policy pre-membership and unnecessary: migration 0029's
  // backfill guarantees every existing org already carries an account.
  await tx
    .insert(organizations)
    .values({
      id: org.orgId,
      accountId,
      nameAr: org.nameAr,
      nameEn: org.nameEn,
      defaultLocale: 'ar-EG',
    })
    .onConflictDoNothing();

  await tx
    .insert(memberships)
    .values({ orgId: org.orgId, userId: org.userId, role: 'owner' })
    .onConflictDoNothing();

  await tx
    .insert(files)
    .values({
      id: org.fileId,
      orgId: org.orgId,
      entity: 'seed',
      bucket: 'metra-files',
      objectKey: `${org.orgId}/seed/${org.fileId}`,
      originalName: 'seed.txt',
      createdBy: org.userId,
    })
    .onConflictDoNothing();

  await tx
    .insert(invitations)
    .values({
      id: org.inviteId,
      orgId: org.orgId,
      email: org.inviteEmail,
      role: 'admin',
      tokenHash: org.inviteTokenHash,
      status: 'pending',
      invitedBy: org.userId,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    })
    .onConflictDoNothing();

  // A public API key (v1) minted by the owner — only the sha256 hash is
  // stored. The deterministic raw source keeps the isolation-gate row stable.
  await tx
    .insert(apiKeys)
    .values({
      id: org.apiKeyId,
      orgId: org.orgId,
      label: 'Seed API key',
      tokenHash: createHash('sha256')
        .update(`mtk_seed_${org.orgId}`)
        .digest('hex'),
      tokenPrefix: 'mtk_seed',
      createdBy: org.userId,
    })
    .onConflictDoNothing();

  // audit_log is append-only; guard against duplicate spam on re-seed.
  const existing = await tx
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(sql`${auditLog.entity} = 'organization'`)
    .limit(1);
  if (existing.length === 0) {
    await tx.insert(auditLog).values({
      orgId: org.orgId,
      actorUserId: org.userId,
      entity: 'organization',
      entityId: org.orgId,
      action: 'create',
      before: null,
      after: { name_en: org.nameEn, name_ar: org.nameAr },
    });
  }
}
