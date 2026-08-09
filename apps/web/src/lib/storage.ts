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
  opts?: { originalName?: string; contentType?: string },
): Promise<SignedUpload> {
  const fileId = randomUUID();
  const objectKey = `${ctx.orgId}/${entity}/${fileId}`;

  await withOrgContext(ctx, (tx) =>
    tx.insert(files).values({
      id: fileId,
      orgId: ctx.orgId,
      entity,
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

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.storage
    .from(rows[0].bucket)
    .createSignedUrl(rows[0].objectKey, ttlSeconds);
  if (error) throw error;

  return data.signedUrl;
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
