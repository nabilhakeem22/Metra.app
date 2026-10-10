import 'server-only';
// Round C (0058): the studio's LOGO behind a client share link, for the client
// page's studio bar. Runs the SECURITY DEFINER token SDF on the base
// connection, no session and no org GUC: the token IS the authorization
// (mirrors ./public-documents.ts). The raw token is never logged.
//
// The SDF answers the logo's storage location only for a live link and only
// when the logo is an image, joined in-org; the location never leaves the
// server (the route streams a downscaled rendition of it).
import { sql } from 'drizzle-orm';
import { normalizeRawToken, readSdfJson } from '@/lib/share/sdf-call';
import { hashShareToken } from '@/lib/share/token';
import type { LogoLocation } from '@/lib/storage/logo-rendition-response';

/** The raw jsonb app_delivery_logo_by_token returns. Untrusted. */
interface LogoSnapshot {
  bucket?: unknown;
  object_key?: unknown;
}

/**
 * The logo of the studio behind a RAW share token, or null. Every miss is the
 * same null: an unknown, revoked or expired link, a studio with no logo, a logo
 * that is not an image, a malformed answer, a database throw. Never throws.
 */
export async function getDeliveryLogoByToken(rawToken: string): Promise<LogoLocation | null> {
  const token = normalizeRawToken(rawToken);
  if (!token) return null;
  try {
    const snapshot = await readSdfJson<LogoSnapshot>(
      sql`select public.app_delivery_logo_by_token(${hashShareToken(token)}) as data`,
    );
    const bucket = snapshot?.bucket;
    const objectKey = snapshot?.object_key;
    if (typeof bucket !== 'string' || bucket.length === 0) return null;
    if (typeof objectKey !== 'string' || objectKey.length === 0) return null;
    return { bucket, objectKey };
  } catch {
    // Token-free breadcrumb only: the driver error would carry the hash.
    console.error('delivery logo read failed');
    return null;
  }
}
