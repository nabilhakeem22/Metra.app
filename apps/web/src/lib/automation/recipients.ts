import 'server-only';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

/**
 * Resolve an INTERNAL user's email from Supabase auth (emails live there, not in
 * the DB). Best-effort: returns null on any failure or if the user has no email.
 * Only ever called with a userId the runner already resolved from `memberships`
 * (an owner/admin/sender) — NEVER a client. Automation email therefore cannot
 * reach a client address (HUMAN-IN-THE-LOOP).
 */
export async function resolveUserEmail(userId: string): Promise<string | null> {
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin.auth.admin.getUserById(userId);
    return data.user?.email ?? null;
  } catch {
    return null;
  }
}
