'use server';

import { invitations, type MemberRole } from '@metra/db';
import { and, eq } from 'drizzle-orm';
import { recordAudit } from '@/lib/audit';
import { requireOrg } from '@/lib/auth/require-org';
import { withOrgContext } from '@/lib/db/context';
import { sendInviteEmail } from '@/lib/email/resend';
import { canManageOrg } from '@/lib/permissions/can';
import { type ActionResult } from '@/lib/actions/result';
import { getOrgMemberIdentities } from '../identities';
import { isInvitableRole } from '../invitable';
import {
  INVITE_TTL_DAYS,
  buildAcceptUrl,
  currentLocale,
  isUniqueViolation,
  isValidEmail,
  mintToken,
  normalizeEmail,
  orgDisplayName,
} from './helpers';

// One ActionResult everywhere (A4). Coded errors; the UI localizes via
// resolveActionError.

// --- Invite ----------------------------------------------------------------
export async function inviteMember(input: {
  email: string;
  role: MemberRole;
}): Promise<ActionResult> {
  const ctx = await requireOrg();
  if (!canManageOrg(ctx.role)) return { ok: false, error: 'forbidden' };

  const email = normalizeEmail(input.email);
  if (!isValidEmail(email) || email.length > 254) {
    return { ok: false, error: 'invalid' };
  }
  // 'owner' is never invitable; 'client' has no internal use (the client portal
  // is P4) — reject it like any out-of-range role.
  if (!isInvitableRole(input.role)) {
    return { ok: false, error: 'invalid' };
  }
  const role = input.role;

  const members = await getOrgMemberIdentities(ctx);
  if (members.some((m) => (m.email ?? '').toLowerCase() === email)) {
    return { ok: false, error: 'already_member' };
  }

  const { raw, hash } = mintToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86400_000);

  // Resolve the absolute link BEFORE creating the invite — if the origin can't
  // be determined we throw here and never persist a half-usable invite.
  const locale = await currentLocale();
  const link = await buildAcceptUrl(locale, raw);

  try {
    await withOrgContext(ctx, async (tx) => {
      // App-level pre-check for the common case; the partial UNIQUE index
      // (org_id,email) where pending is the real race arbiter below.
      const pending = await tx
        .select({ id: invitations.id })
        .from(invitations)
        .where(and(eq(invitations.email, email), eq(invitations.status, 'pending')))
        .limit(1);
      if (pending.length) throw new Error('pending_exists');

      const [inv] = await tx
        .insert(invitations)
        .values({
          orgId: ctx.orgId,
          email,
          role,
          tokenHash: hash,
          status: 'pending',
          invitedBy: ctx.userId,
          expiresAt,
        })
        .returning({ id: invitations.id });

      await recordAudit(tx, {
        entity: 'invitation',
        entityId: inv.id,
        action: 'create',
        before: null,
        after: { email, role },
      });
    });
  } catch (e) {
    // The DB is the arbiter: a concurrent invite to the same email trips the
    // partial unique index (23505) — same result as the app guard.
    if (
      (e instanceof Error && e.message === 'pending_exists') ||
      isUniqueViolation(e)
    ) {
      return { ok: false, error: 'pending_exists' };
    }
    console.error('inviteMember failed:', e);
    return { ok: false, error: 'invalid' };
  }

  await sendInviteEmail({
    to: email,
    orgName: await orgDisplayName(ctx),
    acceptUrl: link,
    role,
    locale,
  });

  return { ok: true, link };
}

// --- Resend (mints a fresh token; also the "copy link" path) ---------------
export async function resendInvite(id: string): Promise<ActionResult> {
  const ctx = await requireOrg();
  if (!canManageOrg(ctx.role)) return { ok: false, error: 'forbidden' };

  const { raw, hash } = mintToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86400_000);
  const locale = await currentLocale();
  const link = await buildAcceptUrl(locale, raw);

  let email = '';
  let role: MemberRole = 'viewer';
  try {
    const res = await withOrgContext(ctx, async (tx) => {
      const [inv] = await tx
        .select({
          email: invitations.email,
          role: invitations.role,
          status: invitations.status,
        })
        .from(invitations)
        .where(eq(invitations.id, id))
        .limit(1);
      if (!inv || inv.status !== 'pending') throw new Error('invalid');

      await tx
        .update(invitations)
        .set({ tokenHash: hash, expiresAt, updatedAt: new Date() })
        .where(and(eq(invitations.id, id), eq(invitations.status, 'pending')));

      await recordAudit(tx, {
        entity: 'invitation',
        entityId: id,
        action: 'update',
        before: null,
        after: { resent: true },
      });
      return { email: inv.email, role: inv.role };
    });
    email = res.email;
    role = res.role;
  } catch {
    return { ok: false, error: 'invalid' };
  }

  await sendInviteEmail({
    to: email,
    orgName: await orgDisplayName(ctx),
    acceptUrl: link,
    role,
    locale,
  });

  return { ok: true, link };
}

// --- Revoke ----------------------------------------------------------------
export async function revokeInvite(id: string): Promise<ActionResult> {
  const ctx = await requireOrg();
  if (!canManageOrg(ctx.role)) return { ok: false, error: 'forbidden' };

  try {
    await withOrgContext(ctx, async (tx) => {
      const [inv] = await tx
        .select({ status: invitations.status })
        .from(invitations)
        .where(eq(invitations.id, id))
        .limit(1);
      if (!inv) throw new Error('invalid');

      await tx
        .update(invitations)
        .set({ status: 'revoked', updatedAt: new Date() })
        .where(eq(invitations.id, id));

      await recordAudit(tx, {
        entity: 'invitation',
        entityId: id,
        action: 'update',
        before: { status: inv.status },
        after: { status: 'revoked' },
      });
    });
  } catch {
    return { ok: false, error: 'invalid' };
  }
  return { ok: true };
}
