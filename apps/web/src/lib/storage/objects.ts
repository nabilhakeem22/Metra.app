import 'server-only';
// Removing a stored object. Its own leaf because it is the only WRITE here that
// the database never sees, and the only one a caller is expected to treat as
// best-effort.
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

/**
 * Delete one stored object.
 *
 * For AFTER the `files` row is gone and its transaction has committed, never
 * inside it: Storage is an HTTP dependency, and holding a Postgres transaction
 * open across a third party's outage is how a lock wait becomes an incident. The
 * caller therefore treats a failure as best-effort — a failed remove leaves the
 * orphan that deleting nothing at all used to leave every single time.
 *
 * Throws on a Storage error, so the caller decides what an orphan costs.
 */
export async function removeStoredObject(
  bucket: string,
  objectKey: string,
): Promise<void> {
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.storage.from(bucket).remove([objectKey]);
  if (error) throw error;
}
