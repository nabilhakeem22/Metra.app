import 'server-only';
// Registering a file row and getting its bytes into the bucket. Two entry points:
// a signed URL for a browser PUT, and a direct upload for bytes the server
// generated itself. Split from the old 248-line lib/storage.ts (W3-10).
import { randomUUID } from 'node:crypto';
import { files } from '@metra/db';
import { eq } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { FILES_BUCKET } from './bucket';

/**
 * Register the `files` metadata row for a new object, UNDER ORG RLS.
 *
 * The row is written before any byte reaches the bucket, so an upload can never
 * leave an object in storage that nothing in the database points at. The object
 * key is always `{org_id}/{entity}/{uuid}`, which keys storage to the org path
 * prefix — it is derived here, with the row, rather than by each caller.
 */
async function registerFileRow(
  ctx: OrgContext,
  entity: string,
  row: {
    originalName?: string | null;
    contentType?: string | null;
    entityId?: string | null;
    categoryId?: string | null;
  },
): Promise<{ fileId: string; objectKey: string }> {
  const fileId = randomUUID();
  const objectKey = `${ctx.orgId}/${entity}/${fileId}`;
  await withOrgContext(ctx, (tx) =>
    tx.insert(files).values({
      id: fileId,
      orgId: ctx.orgId,
      entity,
      entityId: row.entityId ?? null,
      categoryId: row.categoryId ?? null,
      bucket: FILES_BUCKET,
      objectKey,
      originalName: row.originalName ?? null,
      contentType: row.contentType ?? null,
      createdBy: ctx.userId,
    }),
  );
  return { fileId, objectKey };
}

/** Drop a row whose bytes never arrived: a files row with no object behind it is
 *  a download that 404s later rather than an error now. */
async function unregisterFileRow(ctx: OrgContext, fileId: string): Promise<void> {
  await withOrgContext(ctx, (tx) => tx.delete(files).where(eq(files.id, fileId)));
}

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
  const { fileId, objectKey } = await registerFileRow(ctx, entity, opts ?? {});

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
 * Store bytes the SERVER generated, as a file row plus an uploaded object.
 *
 * The signed-upload path above exists for a browser PUT; a document Metra renders
 * itself never leaves the server, so it uploads directly with the admin client
 * instead of handing out a URL for its own bytes.
 *
 * The files row is written FIRST and under org RLS, so an upload can never leave
 * an object in the bucket that nothing in the database points at. If the upload
 * then fails the row is removed, because a files row with no object behind it is
 * a download that 404s later rather than an error now.
 */
export async function storeGeneratedFile(
  ctx: OrgContext,
  entity: string,
  bytes: Uint8Array,
  opts: {
    originalName: string;
    contentType: string;
    entityId?: string | null;
    categoryId?: string | null;
  },
): Promise<{ fileId: string; objectKey: string }> {
  const { fileId, objectKey } = await registerFileRow(ctx, entity, opts);

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.storage
    .from(FILES_BUCKET)
    .upload(objectKey, bytes, {
      contentType: opts.contentType,
      upsert: false,
    });

  if (error) {
    await unregisterFileRow(ctx, fileId);
    throw error;
  }

  return { fileId, objectKey };
}
