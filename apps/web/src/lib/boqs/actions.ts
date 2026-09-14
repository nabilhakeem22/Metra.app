'use server';

import { getLocale } from 'next-intl/server';
import { refreshApp } from '@/lib/actions/refresh';
import type { ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import {
  commitImportCore,
  createBoqCore,
  type CreateBoqInput,
} from './core';
import {
  addBoqLineCore,
  addBoqSectionCore,
  deleteBoqLineCore,
  setBoqDiscountCore,
  updateBoqLineCore,
} from './edit';
import type { BoqLinePatch } from './edit-input';
import { issueBoqCore } from './issue';
import type { ImportedLine } from './import/map';
import { previewBoqImportText, type ImportPreview } from './import/preview';

// Type-only re-export: the upload page has always imported this name from here,
// and a type is erased before the 'use server' export check ever sees it.
export type { ImportPreview };

export async function createBoq(
  input: CreateBoqInput,
): Promise<ActionResult & { data?: string }> {
  const ctx = await requireOrg();
  const res = await createBoqCore(ctx, input);
  if (res.ok) refreshApp();
  return res;
}

/** The session gate, then the pure preview (which owns the caps and the mapping). */
export async function previewBoqImport(csvText: string): Promise<ImportPreview> {
  await requireOrg();
  return previewBoqImportText(csvText);
}

export async function commitBoqImport(input: {
  boqId: string;
  lines: ImportedLine[];
  replace?: boolean;
}): Promise<ActionResult & { data?: number }> {
  const ctx = await requireOrg();
  const res = await commitImportCore(ctx, input);
  if (res.ok) refreshApp();
  return res;
}

/**
 * Freeze the BOQ, render its PDF, and record it as the engagement's `boq`
 * artifact — which is what satisfies `boqPresent` and puts the document behind
 * the portal's payment gate.
 */
export async function issueBoq(
  boqId: string,
): Promise<ActionResult & { data?: string }> {
  const ctx = await requireOrg();
  let locale = 'ar-EG';
  try {
    locale = await getLocale();
  } catch {
    /* default locale */
  }
  const res = await issueBoqCore(ctx, { boqId, locale });
  if (res.ok) refreshApp();
  return res;
}

// ---------------------------------------------------------------------------
// Editing a draft BOQ. Each wrapper does the session work and delegates; every
// rule that matters (the draft-only freeze, the capability, the arithmetic)
// lives in the core, so a caller that reaches the core another way still meets
// it.
// ---------------------------------------------------------------------------

export async function updateBoqLine(input: {
  lineId: string;
  patch: BoqLinePatch;
}): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await updateBoqLineCore(ctx, input);
  if (res.ok) refreshApp();
  return res;
}

export async function addBoqLine(input: {
  sectionId: string;
  description: string;
}): Promise<ActionResult & { data?: string }> {
  const ctx = await requireOrg();
  const res = await addBoqLineCore(ctx, input);
  if (res.ok) refreshApp();
  return res;
}

export async function deleteBoqLine(input: {
  lineId: string;
}): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await deleteBoqLineCore(ctx, input);
  if (res.ok) refreshApp();
  return res;
}

export async function addBoqSection(input: {
  boqId: string;
  title: string;
}): Promise<ActionResult & { data?: string }> {
  const ctx = await requireOrg();
  const res = await addBoqSectionCore(ctx, input);
  if (res.ok) refreshApp();
  return res;
}

export async function setBoqDiscount(input: {
  boqId: string;
  discountPct: string;
}): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await setBoqDiscountCore(ctx, input);
  if (res.ok) refreshApp();
  return res;
}
