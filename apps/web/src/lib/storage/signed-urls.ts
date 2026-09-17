import 'server-only';
// Signing a stored object for download. Split from ./uploads.ts (W3-10): minting a
// read URL and registering a new file are two jobs, and a caller that only signs
// should not depend on the insert path.
import { files } from '@metra/db';
import { eq } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

/**
 * Signs an ALREADY-AUTHORIZED storage object. This is the low-level primitive: it
 * performs NO authorization of its own, so every caller must have proven the
 * object belongs to whoever is asking BEFORE calling it — `getSignedUrl` below
 * proves it with an RLS-scoped lookup, the client portal's download route proves it
 * with the share-token SDF (which is why that path cannot use `getSignedUrl`: it
 * has no session and therefore no OrgContext). `download` sets the filename the
 * browser saves as (Content-Disposition attachment). Throws on a Storage error.
 */
export async function createSignedObjectUrl(
  bucket: string,
  objectKey: string,
  ttlSeconds: number,
  opts?: {
    download?: string;
    /** Storage-side image transform. Used by the client portal to serve a
     *  DOWNSCALED rendition of an approved render while payments are outstanding,
     *  so the full-resolution deliverable never leaves the bucket. Ignored by
     *  Storage for non-image objects, which is why the caller must not rely on it
     *  alone for a non-image file. */
    transform?: {
      width?: number;
      height?: number;
      resize?: 'cover' | 'contain' | 'fill';
      quality?: number;
    };
  },
): Promise<string> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(objectKey, ttlSeconds, opts);
  if (error) throw error;
  return data.signedUrl;
}

/**
 * Returns a time-limited signed download URL for a file, but ONLY if the file
 * belongs to the caller's org — the lookup runs under RLS, so an org-B context
 * cannot resolve (and therefore cannot sign) an org-A file.
 *
 * `download` is the name the browser saves as, and passing it is what makes
 * Storage answer `Content-Disposition: attachment` instead of serving the bytes
 * inline on the Supabase project origin. Build it with
 * `lib/files/safe-name.ts safeDownloadName` — never from a raw stored filename.
 */
export async function getSignedUrl(
  ctx: OrgContext,
  fileId: string,
  opts: { ttlSeconds?: number; download?: string } = {},
): Promise<string> {
  const rows = await withOrgContext(ctx, (tx) =>
    tx
      .select({ objectKey: files.objectKey, bucket: files.bucket })
      .from(files)
      .where(eq(files.id, fileId))
      .limit(1),
  );

  if (rows.length === 0) {
    throw new Error('File not found in this org');
  }

  return createSignedObjectUrl(rows[0].bucket, rows[0].objectKey, opts.ttlSeconds ?? 3600, {
    download: opts.download,
  });
}
