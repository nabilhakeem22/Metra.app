import 'server-only';
import { randomUUID } from 'node:crypto';
import { files } from '@metra/db';
import { eq } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export const FILES_BUCKET = 'metra-files';

export interface SignedUpload {
  fileId: string;
  objectKey: string;
  signedUrl: string;
  token: string;
}

/**
 * Registers a `files` metadata row (under org RLS) and returns a signed upload
 * URL. Object key is always `{org_id}/{entity}/{uuid}`, so storage stays keyed
 * to the org path prefix.
 */
export async function createSignedUploadUrl(
  ctx: OrgContext,
  entity: string,
  opts?: {
    originalName?: string;
    contentType?: string;
    entityId?: string;
    /** The firm's filing category. Null/absent files the document as uncategorised,
     *  which is also what every document uploaded before categories existed is. */
    categoryId?: string | null;
  },
): Promise<SignedUpload> {
  const fileId = randomUUID();
  const objectKey = `${ctx.orgId}/${entity}/${fileId}`;

  await withOrgContext(ctx, (tx) =>
    tx.insert(files).values({
      id: fileId,
      orgId: ctx.orgId,
      entity,
      entityId: opts?.entityId ?? null,
      categoryId: opts?.categoryId ?? null,
      bucket: FILES_BUCKET,
      objectKey,
      originalName: opts?.originalName ?? null,
      contentType: opts?.contentType ?? null,
      createdBy: ctx.userId,
    }),
  );

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.storage
    .from(FILES_BUCKET)
    .createSignedUploadUrl(objectKey);
  if (error) throw error;

  return {
    fileId,
    objectKey,
    signedUrl: data.signedUrl,
    token: data.token,
  };
}

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
 */
export async function getSignedUrl(
  ctx: OrgContext,
  fileId: string,
  ttlSeconds = 3600,
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

  return createSignedObjectUrl(rows[0].bucket, rows[0].objectKey, ttlSeconds);
}

/** Idempotently creates the private files bucket. Run once during setup. */
export async function ensureFilesBucket(): Promise<void> {
  const supabase = createSupabaseAdminClient();
  const { data } = await supabase.storage.getBucket(FILES_BUCKET);
  if (!data) {
    const { error } = await supabase.storage.createBucket(FILES_BUCKET, {
      public: false,
    });
    if (error && !/already exists/i.test(error.message)) throw error;
  }
}
