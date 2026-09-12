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
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { resolveRequestOrigin } from '@/lib/http/request-origin';

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
 * Absolute accept URL for an invite, or null when no origin can be resolved —
 * never a relative or empty link. Callers must branch on the null BEFORE they
 * persist an invitation.
 */
export async function buildAcceptUrl(
  locale: string,
  rawToken: string,
): Promise<string | null> {
  const origin = await resolveRequestOrigin();
  if (!origin) return null;
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
