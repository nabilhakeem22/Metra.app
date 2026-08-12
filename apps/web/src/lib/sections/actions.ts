'use server';

import { revalidatePath } from 'next/cache';
import type { ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import { upsertSectionCore, type SectionInput } from './core';

/**
 * Create-on-use: record a work section in the org's shared list. Idempotent — a
 * repeated name returns the existing id. Shared by the Price Book and the
 * proposal builder, so a new section appears in both surfaces.
 */
export async function addSection(input: SectionInput): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await upsertSectionCore(ctx, input);
  if (res.ok) revalidatePath('/', 'layout');
  return { ok: res.ok, error: res.error };
}
