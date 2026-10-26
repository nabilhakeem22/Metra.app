import 'server-only';
// Public (no-session) client home, the READ: one token SDF,
// `app_home_by_token`, through lib/share/sdf-call (NO withOrgContext, NO org
// GUCs: the token IS the auth). The raw token is hashed here and never logged.
// The payload to PortalHome mapping is ./shape.ts, pure; this file owns the
// round trip and what happens when something throws, exactly as the delivery
// reader does (lib/engagements/public/delivery.ts).
import { sql } from 'drizzle-orm';
import { loggableFailure } from '@/lib/actions/loggable-failure';
import { normalizeRawToken, readSdfJson } from '@/lib/share/sdf-call';
import { hashShareToken } from '@/lib/share/token';
import { shapeHome } from './shape';
import type { HomeReadResult } from './types';

/**
 * The home behind a RAW delivery token. A blank token, and an unknown, revoked
 * or expired link (the SDF's one null), are `not_found`, as is a payload this
 * build cannot shape. ANY throw, from the SDF or from shaping, is logged once
 * (redacted through loggableFailure: never the token hash the driver error
 * carries) and answers `read_failed`, so a valid link during a database blip
 * is never called dead.
 */
export async function getHomeByToken(rawToken: string): Promise<HomeReadResult> {
  const token = normalizeRawToken(rawToken);
  if (!token) return { status: 'not_found' };
  let hasPayload = false;
  try {
    const payload = await readSdfJson<unknown>(sql`select public.app_home_by_token(${hashShareToken(token)}) as data`);
    if (payload === null) return { status: 'not_found' };
    hasPayload = true;
    const home = shapeHome(payload);
    return home ? { status: 'ok', home } : { status: 'not_found' };
  } catch (error) {
    console.error('client home read failed', { hasPayload, error: loggableFailure(error) });
    return { status: 'read_failed' };
  }
}
