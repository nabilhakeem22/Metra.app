import 'server-only';
// What Storage holds for one object: its stored Content-Type and its size.
// Its own leaf because it is a read the database never sees.
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export interface StoredObjectInfo {
  contentType: string | null;
  size: number | null;
}

/**
 * The stored type and size of an ALREADY-AUTHORIZED object, or null when Storage
 * cannot say (missing object, Storage error). Never throws: every caller treats
 * "unknown" as the restrictive answer.
 */
export async function storedObjectInfo(bucket: string, objectKey: string): Promise<StoredObjectInfo | null> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase.storage.from(bucket).info(objectKey);
    if (error || !data) return null;
    return {
      contentType: typeof data.contentType === 'string' ? data.contentType : null,
      size: typeof data.size === 'number' ? data.size : null,
    };
  } catch {
    return null;
  }
}
