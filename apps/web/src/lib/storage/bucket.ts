import 'server-only';
// The private files bucket, and the one question worth asking about it.
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export const FILES_BUCKET = 'metra-files';

/**
 * The in-flight or settled answer to "does the bucket exist", per isolate.
 *
 * Memoised on the PROMISE rather than a boolean so two uploads arriving together
 * share one round trip instead of racing two. A failure clears it, so a Storage
 * outage during the first upload does not poison every later one.
 */
let filesBucketReady: Promise<void> | null = null;

/**
 * Idempotently creates the private files bucket.
 *
 * Every document upload awaited this, and every call issued a `getBucket` HTTP
 * round trip — an upload cost three RLS transactions plus one Storage request
 * that exists only to ask a question whose answer never changes. The bucket is
 * created once in the lifetime of a deployment and cannot go back to not
 * existing, so the answer is cached for the life of the isolate.
 */
export function ensureFilesBucket(): Promise<void> {
  filesBucketReady ??= createFilesBucket().catch((error: unknown) => {
    filesBucketReady = null;
    throw error;
  });
  return filesBucketReady;
}

async function createFilesBucket(): Promise<void> {
  const supabase = createSupabaseAdminClient();
  const { data } = await supabase.storage.getBucket(FILES_BUCKET);
  if (!data) {
    const { error } = await supabase.storage.createBucket(FILES_BUCKET, {
      public: false,
    });
    if (error && !/already exists/i.test(error.message)) throw error;
  }
}
