'use server';

import { refreshApp } from '@/lib/actions/refresh';
import { err, type ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import { loadMarketPriceBookCore, type MarketSeedSummary } from '@/lib/market-book/seed-core';
import {
  bulkUpdatePricesCore,
  type BulkUpdateInput,
  type BulkUpdateSummary,
} from './bulk-core';
import {
  createCostItemCore,
  setCostItemActiveCore,
  updateCostItemCore,
  type CostItemInput,
} from './core';
import type { ColumnMapping } from './import';
import { findExistingCodesCore } from './import-existing';
import {
  fileRefused,
  importCostItemsCore,
  parseCostImportCore,
  type ImportSummary,
} from './import-core';
import { MAX_IMPORT_BYTES, type ParsedSheet } from './parse';

export async function createCostItem(
  input: CostItemInput,
): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await createCostItemCore(ctx, input);
  if (!res.ok) return res;
  refreshApp();
  return { ok: true };
}

export async function updateCostItem(
  input: { id: string } & CostItemInput,
): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await updateCostItemCore(ctx, input);
  if (!res.ok) return res;
  refreshApp();
  return { ok: true };
}

export async function setCostItemActive(
  id: string,
  active: boolean,
): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await setCostItemActiveCore(ctx, { id, active });
  if (res.ok) refreshApp();
  return { ok: res.ok, error: res.error };
}

export async function bulkUpdatePrices(
  input: BulkUpdateInput,
): Promise<ActionResult & { data?: BulkUpdateSummary }> {
  const ctx = await requireOrg();
  const res = await bulkUpdatePricesCore(ctx, input);
  if (res.ok) refreshApp();
  return res;
}

/** The empty price book's load of the official market book (the sign-up seed, again: idempotent). */
export async function loadMarketPriceBook(): Promise<
  ActionResult & { data?: MarketSeedSummary }
> {
  const ctx = await requireOrg();
  const res = await loadMarketPriceBookCore(ctx);
  if (res.ok) refreshApp();
  return res;
}

export async function parseCostImport(
  formData: FormData,
): Promise<ActionResult & { data?: ParsedSheet }> {
  const ctx = await requireOrg();
  const file = formData.get('file');
  if (!(file instanceof File)) return err('malformed');
  // Reject oversize BEFORE buffering the whole file into memory.
  if (file.size > MAX_IMPORT_BYTES) return fileRefused('import_too_large');
  const bytes = new Uint8Array(await file.arrayBuffer());
  return parseCostImportCore(ctx, { bytes });
}

/** The import preview's question: which of these codes the book already has. */
export async function findExistingCostItemCodes(
  codes: string[],
): Promise<ActionResult & { data?: string[] }> {
  const ctx = await requireOrg();
  return findExistingCodesCore(ctx, codes);
}

export async function importCostItems(input: {
  rows: string[][];
  mapping: ColumnMapping;
}): Promise<ActionResult & { data?: ImportSummary }> {
  const ctx = await requireOrg();
  const res = await importCostItemsCore(ctx, input);
  if (res.ok) refreshApp();
  return res;
}
