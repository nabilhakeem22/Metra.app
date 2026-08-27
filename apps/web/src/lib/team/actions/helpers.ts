import 'server-only';
// Shared internals for the team server-action modules (invite token minting, email
// normalization, origin/link building, org display name). Extracted from the
// original `'use server'` actions file so the invite/member/accept action modules
// can share them: a `'use server'` module may only export async functions, so these
// sync helpers must live in a plain server-only module. NOT part of the
// `@/lib/team/actions` public surface.
import { createHash, randomBytes } from 'node:crypto';
import { organizations } from '@metra/db';
import { getLocale } from 'next-intl/server';
import { headers } from 'next/headers';
import { withOrgContext, type OrgContext } from '@/lib/db/context';

export const INVITE_TTL_DAYS = 7;

export function mintToken() {
  const raw = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(raw).digest('hex');
  return { raw, hash };
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}

export function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as { code?: string }).code === '23505'
  );
}

export async function currentLocale(): Promise<string> {
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

export async function buildAcceptUrl(
  locale: string,
  rawToken: string,
): Promise<string> {
  const origin = await resolveOrigin();
  return `${origin}/${locale}/invite/${rawToken}`;
}

export async function orgDisplayName(ctx: OrgContext): Promise<string> {
  const [org] = await withOrgContext(ctx, (tx) =>
    tx
      .select({ nameEn: organizations.nameEn, nameAr: organizations.nameAr })
      .from(organizations)
      .limit(1),
  );
  return org?.nameEn || org?.nameAr || 'Metra';
}
