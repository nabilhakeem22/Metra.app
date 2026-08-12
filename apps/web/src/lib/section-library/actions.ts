'use server';

import type { ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import {
  upsertSectionLibraryEntryCore,
  type SectionLibraryInput,
} from './core';

/**
 * Create-on-use: record a section title in the org's library. Idempotent — a
 * repeated name returns the existing id. Called fire-and-forget from the section
 * combobox, so it never blocks the builder.
 */
export async function addSectionLibraryEntry(
  input: SectionLibraryInput,
): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await upsertSectionLibraryEntryCore(ctx, input);
  return { ok: res.ok, error: res.error };
}
