'use server';

import { getLocale } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
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
import { decodeCsv } from './import/decode';
import { autoDetectMapping, mapRows, type ImportedLine } from './import/map';

function refreshApp(): void {
  revalidatePath('/', 'layout');
}

export async function createBoq(
  input: CreateBoqInput,
): Promise<ActionResult & { data?: string }> {
  const ctx = await requireOrg();
  const res = await createBoqCore(ctx, input);
  if (res.ok) refreshApp();
  return res;
}

export interface ImportPreview {
  ok: boolean;
  error?: string;
  /** Lines that would be created. */
  lines?: ImportedLine[];
  /** Row number + reason for everything that would not. */
  problems?: { rowNumber: number; errors: string[] }[];
  notes?: string[];
}

/**
 * Decode and validate an uploaded sheet WITHOUT writing anything.
 *
 * The preview is the safety net for the whole import: it is where the studio
 * sees the template's own example row still sitting in their file, spots a
 * column that mapped to the wrong field, and finds the eight rows with a unit
 * Metra does not have — all before a single line exists.
 */
export async function previewBoqImport(csvText: string): Promise<ImportPreview> {
  await requireOrg();
  if (typeof csvText !== 'string' || csvText.trim() === '') {
    return { ok: false, error: 'invalid' };
  }
  const { grid, notes } = decodeCsv(csvText);
  const header = grid.rows[0];
  if (!header) return { ok: false, error: 'invalid' };

  const result = mapRows(grid, autoDetectMapping(header));
  return {
    ok: true,
    lines: result.ok,
    problems: result.rows
      .filter((r) => r.errors.length > 0)
      .map((r) => ({ rowNumber: r.rowNumber, errors: r.errors })),
    notes,
  };
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
