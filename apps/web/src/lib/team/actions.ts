'use server';

import { createHash, randomBytes } from 'node:crypto';
import {
  invitations,
  MEMBER_ROLES,
  memberships,
  organizations,
  type MemberRole,
} from '@metra/db';
import { and, eq, sql } from 'drizzle-orm';
import { getLocale } from 'next-intl/server';
import { cookies } from 'next/headers';
import { recordAudit } from '@/lib/audit';
import { requireOrg } from '@/lib/auth/require-org';
import { getSessionUser } from '@/lib/auth/session';
import { withOrgContext, withUserContext, type OrgContext } from '@/lib/db/context';
import { sendInviteEmail } from '@/lib/email/resend';
import { can } from '@/lib/permissions/can';
import { getOrgMemberIdentities } from './identities';

// Stable error CODES (the UI maps them to localized strings). acceptInvite uses
// ONLY 'declined' for every failure — no oracle for wrong-email vs expired etc.
export interface TeamActionResult {
  ok: boolean;
  error?: string;
  link?: string;
}

const INVITE_TTL_DAYS = 7;
const ACTIVE_ORG_COOKIE = 'metra_active_org';

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

function isMemberRole(role: string): role is MemberRole {
  return (MEMBER_ROLES as readonly string[]).includes(role);
}

async function currentLocale(): Promise<string> {
  try {
    return await getLocale();
  } catch {
    return process.env.NEXT_PUBLIC_DEFAULT_LOCALE ?? 'ar-EG';
  }
}

function acceptUrl(locale: string, rawToken: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '');
  return `${base}/${locale}/invite/${rawToken}`;
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

function canManage(role: MemberRole): boolean {
  return can(role, 'users_settings', 'update');
}

// --- Invite ----------------------------------------------------------------
export async function inviteMember(input: {
  email: string;
  role: MemberRole;
}): Promise<TeamActionResult> {
  const ctx = await requireOrg();
  if (!canManage(ctx.role)) return { ok: false, error: 'forbidden' };

  const email = normalizeEmail(input.email);
  if (!isValidEmail(email)) return { ok: false, error: 'invalid' };
  if (!isMemberRole(input.role) || input.role === 'owner') {
    return { ok: false, error: 'invalid' };
  }
  const role = input.role;

  const members = await getOrgMemberIdentities(ctx);
  if (members.some((m) => (m.email ?? '').toLowerCase() === email)) {
    return { ok: false, error: 'already_member' };
  }

  const { raw, hash } = mintToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86400_000);

  try {
    await withOrgContext(ctx, async (tx) => {
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
    if (e instanceof Error && e.message === 'pending_exists') {
      return { ok: false, error: 'pending_exists' };
    }
    console.error('inviteMember failed:', e);
    return { ok: false, error: 'invalid' };
  }

  const locale = await currentLocale();
  const link = acceptUrl(locale, raw);
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
export async function resendInvite(id: string): Promise<TeamActionResult> {
  const ctx = await requireOrg();
  if (!canManage(ctx.role)) return { ok: false, error: 'forbidden' };

  const { raw, hash } = mintToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86400_000);

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

  const locale = await currentLocale();
  const link = acceptUrl(locale, raw);
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
export async function revokeInvite(id: string): Promise<TeamActionResult> {
  const ctx = await requireOrg();
  if (!canManage(ctx.role)) return { ok: false, error: 'forbidden' };

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

// --- Change role -----------------------------------------------------------
export async function changeMemberRole(input: {
  userId: string;
  role: MemberRole;
}): Promise<TeamActionResult> {
  const ctx = await requireOrg();
  if (!canManage(ctx.role)) return { ok: false, error: 'forbidden' };
  if (!isMemberRole(input.role)) return { ok: false, error: 'invalid' };
  const role = input.role;

  try {
    await withOrgContext(ctx, async (tx) => {
      const [target] = await tx
        .select({ id: memberships.id, role: memberships.role })
        .from(memberships)
        .where(eq(memberships.userId, input.userId))
        .limit(1);
      if (!target) throw new Error('invalid');

      // Only an owner may touch an owner or grant the owner role.
      if ((target.role === 'owner' || role === 'owner') && ctx.role !== 'owner') {
        throw new Error('owner_immutable');
      }
      // Never demote the last remaining owner.
      if (target.role === 'owner' && role !== 'owner') {
        const owners = await tx
          .select({ id: memberships.id })
          .from(memberships)
          .where(eq(memberships.role, 'owner'));
        if (owners.length <= 1) throw new Error('last_owner');
      }
      if (target.role === role) return;

      await tx
        .update(memberships)
        .set({ role, updatedAt: new Date() })
        .where(eq(memberships.id, target.id));

      await recordAudit(tx, {
        entity: 'membership',
        entityId: target.id,
        action: 'update',
        before: { role: target.role },
        after: { role },
      });
    });
  } catch (e) {
    const code = e instanceof Error ? e.message : 'invalid';
    return {
      ok: false,
      error: ['owner_immutable', 'last_owner', 'invalid'].includes(code)
        ? code
        : 'invalid',
    };
  }
  return { ok: true };
}

// --- Remove member ---------------------------------------------------------
export async function removeMember(userId: string): Promise<TeamActionResult> {
  const ctx = await requireOrg();
  if (!canManage(ctx.role)) return { ok: false, error: 'forbidden' };

  try {
    await withOrgContext(ctx, async (tx) => {
      const [target] = await tx
        .select({ id: memberships.id, role: memberships.role })
        .from(memberships)
        .where(eq(memberships.userId, userId))
        .limit(1);
      if (!target) throw new Error('invalid');

      if (target.role === 'owner' && ctx.role !== 'owner') {
        throw new Error('owner_immutable');
      }
      if (target.role === 'owner') {
        const owners = await tx
          .select({ id: memberships.id })
          .from(memberships)
          .where(eq(memberships.role, 'owner'));
        if (owners.length <= 1) throw new Error('last_owner');
      }

      await tx.delete(memberships).where(eq(memberships.id, target.id));

      await recordAudit(tx, {
        entity: 'membership',
        entityId: target.id,
        action: 'delete',
        before: { user_id: userId, role: target.role },
        after: null,
      });
    });
  } catch (e) {
    const code = e instanceof Error ? e.message : 'invalid';
    return {
      ok: false,
      error: ['owner_immutable', 'last_owner', 'invalid'].includes(code)
        ? code
        : 'invalid',
    };
  }
  return { ok: true };
}

// --- Accept invite (every failure returns the SAME generic 'declined') ------
export async function acceptInvite(rawToken: string): Promise<TeamActionResult> {
  const DECLINED: TeamActionResult = { ok: false, error: 'declined' };

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
    if (inv.status !== 'pending') return DECLINED;
    if (new Date(inv.expires_at).getTime() <= Date.now()) return DECLINED;
    if (inv.email.toLowerCase() !== user.email.toLowerCase()) return DECLINED;

    await withOrgContext(
      { orgId: inv.org_id, userId: user.id, role: inv.role },
      async (tx) => {
        const inserted = await tx
          .insert(memberships)
          .values({ orgId: inv.org_id, userId: user.id, role: inv.role })
          .onConflictDoNothing()
          .returning({ id: memberships.id });

        // Mark accepted only if still pending (replay-safe).
        await tx
          .update(invitations)
          .set({
            status: 'accepted',
            acceptedBy: user.id,
            acceptedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(eq(invitations.id, inv.id), eq(invitations.status, 'pending')),
          );

        if (inserted[0]) {
          await recordAudit(tx, {
            entity: 'membership',
            entityId: inserted[0].id,
            action: 'create',
            before: null,
            after: {
              user_id: user.id,
              role: inv.role,
              via: 'invitation',
              invitation_id: inv.id,
            },
          });
        }
      },
    );

    const cookieStore = await cookies();
    cookieStore.set(ACTIVE_ORG_COOKIE, inv.org_id, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
    });

    return { ok: true };
  } catch (e) {
    console.error('acceptInvite failed:', e);
    return DECLINED;
  }
}
