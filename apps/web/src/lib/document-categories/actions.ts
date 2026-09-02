'use server';

import { revalidatePath } from 'next/cache';
import type { ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import {
  createDocumentCategoryCore,
  updateDocumentCategoryCore,
  type DocumentCategoryInput,
  type UpdateDocumentCategoryInput,
} from './core';

/** Add a category to the firm's filing vocabulary. */
export async function createDocumentCategory(
  input: DocumentCategoryInput,
): Promise<ActionResult & { data?: string }> {
  const ctx = await requireOrg();
  const res = await createDocumentCategoryCore(ctx, input);
  if (res.ok) revalidatePath('/', 'layout');
  return res;
}

/** Rename a category, or retire/restore it. */
export async function updateDocumentCategory(
  input: UpdateDocumentCategoryInput,
): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await updateDocumentCategoryCore(ctx, input);
  if (res.ok) revalidatePath('/', 'layout');
  return res;
}
