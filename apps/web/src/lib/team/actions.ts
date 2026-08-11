'use server';

import { createHash, randomBytes } from 'node:crypto';
import { invitations, organizations, type MemberRole } from '@metra/db';
import { and, eq, sql } from 'drizzle-orm';
import { getLocale } from 'next-intl/server';
import { cookies, headers } from 'next/headers';
import { recordAudit } from '@/lib/audit';
import {
  ACTIVE_ORG_COOKIE,
  activeOrgCookieOptions,
} from '@/lib/auth/active-org';
import { requireOrg } from '@/lib/auth/require-org';
import { getSessionUser } from '@/lib/auth/session';
import { withOrgContext, withUserContext, type OrgContext } from '@/lib/db/context';
import { sendInviteEmail } from '@/lib/email/resend';
import { canManageOrg } from '@/lib/permissions/can';
import { type ActionResult } from '@/lib/actions/result';
import {
  acceptInviteCore,
  changeMemberRoleCore,
  removeMemberCore,
} from './core';
import { getOrgMemberIdentities } from './identities';
import { isInvitableRole } from './invitable';

// One ActionResult everywhere (A4). Coded errors; the UI localizes via
// resolveActionError. acceptInvite uses ONLY 'declined' for every failure —
// no oracle for wrong-email vs expired etc.

const INVITE_TTL_DAYS = 7;

function mintToken() {
  const raw = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(raw).digest('hex');
  return { raw, hash };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isValidEmail(email: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}

function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as { code?: string }).code === '23505'
  );
}

async function currentLocale(): Promise<string> {
  try {
    return await getLocale();
  } catch {
    return process.env.NEXT_PUBLIC_DEFAULT_LOCALE ?? 'ar-EG';
  }
}

/**
 * Absolute origin for invite links. Prefers NEXT_PUBLIC_APP_URL when set,
 * otherwise derives it from the request headers. THROWS if no origin can be
 * determined — never emits a relative/empty link.
 */
async function resolveOrigin(): Promise<string> {
  const override = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, '');
  if (override) return override;

  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');
  const proto = h.get('x-forwarded-proto') ?? 'https';
  if (!host) {
    throw new Error('cannot resolve request origin for invite link');
  }
  return `${proto}://${host}`;
}

async function buildAcceptUrl(
  locale: string,
  rawToken: string,
): Promise<string> {
  const origin = await resolveOrigin();
  return `${origin}/${locale}/invite/${rawToken}`;
}

async function orgDisplayName(ctx: OrgContext): Promise<string> {
  const [org] = await withOrgContext(ctx, (tx) =>
    tx
      .select({ nameEn: organizations.nameEn, nameAr: organizations.nameAr })
      .from(organizations)
      .limit(1),
  );
  return org?.nameEn || org?.nameAr || 'Metra';
}

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

// --- Change role / remove member (delegate to pure cores) ------------------
export async function changeMemberRole(input: {
  userId: string;
  role: MemberRole;
}): Promise<ActionResult> {
  const ctx = await requireOrg();
  return changeMemberRoleCore(ctx, input);
}

export async function removeMember(userId: string): Promise<ActionResult> {
  const ctx = await requireOrg();
  return removeMemberCore(ctx, userId);
}

// --- Accept invite ---------------------------------------------------------
// Wrapper does session + token lookup + expiry/email validation, then delegates
// the claim/membership/F4 to acceptInviteCore. Every failure -> generic
// 'declined' (no oracle). On success, sets the active-org cookie.
export async function acceptInvite(rawToken: string): Promise<ActionResult> {
  const DECLINED: ActionResult = { ok: false, error: 'declined' };

  const user = await getSessionUser();
  if (!user?.email) return DECLINED;

  const tokenHash = createHash('sha256')
    .update(String(rawToken ?? ''))
    .digest('hex');

  try {
    const rows = (await withUserContext(user.id, (tx) =>
      tx.execute(
        sql`select id, org_id, email, role, status, expires_at
            from public.app_invitation_by_token(${tokenHash})`,
      ),
    )) as unknown as Array<{
      id: string;
      org_id: string;
      email: string;
      role: MemberRole;
      status: string;
      expires_at: string;
    }>;

    const inv = rows[0];
    if (!inv) return DECLINED;
    if (new Date(inv.expires_at).getTime() <= Date.now()) return DECLINED;
    if (inv.email.toLowerCase() !== user.email.toLowerCase()) return DECLINED;

    const res = await acceptInviteCore(
      { orgId: inv.org_id, userId: user.id, role: inv.role, email: user.email },
      inv.id,
    );
    if (!res.ok) return DECLINED;

    const cookieStore = await cookies();
    cookieStore.set(ACTIVE_ORG_COOKIE, inv.org_id, activeOrgCookieOptions());
    return res;
  } catch (e) {
    console.error('acceptInvite failed:', e);
    return DECLINED;
  }
}
