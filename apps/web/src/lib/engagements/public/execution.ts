import 'server-only';
// Public (no-session) client delivery portal, Stage 2 DB step B: the execution
// card (what the client is asked to pay on the execution contract, what was
// received, how to pay). The client's "I paid" on a payment request is the
// client home's, with a code (lib/client-home/code-acts.ts). The token SDF
// runs through lib/share/sdf-call, the one sanctioned
// base-connection surface: NO withOrgContext, NO org GUCs. The token IS the
// auth, and the raw token is hashed here and never logged.
import { sql } from 'drizzle-orm';
import { normalizeRawToken, readSdfJson } from '@/lib/share/sdf-call';
import { hashShareToken } from '@/lib/share/token';
import { shapeExecution } from './execution-shape';
import type { PortalExecution } from './execution-types';

/**
 * The execution card behind a RAW delivery token, or null: an unknown, revoked
 * or expired link, a delivery that is not at `execution`, one with no contract
 * the client can see, and a snapshot this build cannot shape all answer null.
 * A database failure throws; the caller decides what the page says about it.
 */
export async function getDeliveryExecutionByToken(rawToken: string): Promise<PortalExecution | null> {
  const token = normalizeRawToken(rawToken);
  if (!token) return null;
  const snapshot = await readSdfJson<unknown>(
    sql`select public.app_delivery_execution_by_token(${hashShareToken(token)}) as data`,
  );
  return snapshot === null ? null : shapeExecution(snapshot);
}
