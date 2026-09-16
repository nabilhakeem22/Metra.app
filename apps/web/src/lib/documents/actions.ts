'use server';

import { refreshApp } from '@/lib/actions/refresh';
import type { ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import type { SignedUpload } from '@/lib/storage';
import { deleteDocumentCore, getDocumentUrlCore } from './core';
import { createDocumentUploadCore } from './upload';
import { DOCUMENT_ENTITIES } from './entities';

// 'use server' wrappers ONLY: session work + delegate. No SQL here.
//
// The SIX exported names are byte-identical to the ones `lib/client-documents/`
// and `lib/project-documents/` exported, because a server-action export name is
// part of the wire contract between a running tab and the server — renaming one
// is an action-not-found for anybody mid-upload across the deploy.
//
// `refreshApp()` (revalidatePath) belongs HERE, after the core has returned, not
// inside the transaction callback where it used to live. Revalidating from
// inside means the cache is dropped for a write that has not committed and may
// yet roll back — and it means the core cannot be called from a DB test, an API
// route or the cron runner, none of which have a Next request to revalidate.

export async function createClientDocumentUpload(input: {
  clientId: string;
  contentType?: string;
  originalName?: string;
  categoryId?: string | null;
}): Promise<SignedUpload | ActionResult> {
  const ctx = await requireOrg();
  return createDocumentUploadCore(ctx, DOCUMENT_ENTITIES.client, {
    parentId: input.clientId,
    contentType: input.contentType,
    originalName: input.originalName,
    categoryId: input.categoryId,
  });
}

export async function getClientDocumentUrl(
  fileId: string,
): Promise<ActionResult & { url?: string }> {
  const ctx = await requireOrg();
  return getDocumentUrlCore(ctx, DOCUMENT_ENTITIES.client, fileId);
}

export async function deleteClientDocument(fileId: string): Promise<ActionResult> {
  const ctx = await requireOrg();
  const result = await deleteDocumentCore(ctx, DOCUMENT_ENTITIES.client, fileId);
  if (result.ok) refreshApp();
  return result;
}

export async function createProjectDocumentUpload(input: {
  projectId: string;
  contentType?: string;
  originalName?: string;
  categoryId?: string | null;
}): Promise<SignedUpload | ActionResult> {
  const ctx = await requireOrg();
  return createDocumentUploadCore(ctx, DOCUMENT_ENTITIES.project, {
    parentId: input.projectId,
    contentType: input.contentType,
    originalName: input.originalName,
    categoryId: input.categoryId,
  });
}

export async function getProjectDocumentUrl(
  fileId: string,
): Promise<ActionResult & { url?: string }> {
  const ctx = await requireOrg();
  return getDocumentUrlCore(ctx, DOCUMENT_ENTITIES.project, fileId);
}

export async function deleteProjectDocument(fileId: string): Promise<ActionResult> {
  const ctx = await requireOrg();
  const result = await deleteDocumentCore(ctx, DOCUMENT_ENTITIES.project, fileId);
  if (result.ok) refreshApp();
  return result;
}
