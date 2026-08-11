'use server';

import { revalidatePath } from 'next/cache';
import { err, type ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import {
  bulkUpdatePricesCore,
  loadStarterCatalogueCore,
  type BulkUpdateInput,
  type BulkUpdateSummary,
  type StarterLoadSummary,
} from './bulk-core';
import {
  createCostItemCore,
  setCostItemActiveCore,
  updateCostItemCore,
  type CostItemInput,
} from './core';
import type { ColumnMapping } from './import';
import {
  importCostItemsCore,
  parseCostImportCore,
  type ImportSummary,
} from './import-core';
import type { ParsedSheet } from './parse';

function refreshApp(): void {
  // Server components re-run; the list/table re-fetch. Matches org-settings.
  revalidatePath('/', 'layout');
}

export async function createCostItem(
  input: CostItemInput,
): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await createCostItemCore(ctx, input);
  if (res.ok) refreshApp();
  return { ok: res.ok, error: res.error };
}

export async function updateCostItem(
  input: { id: string } & CostItemInput,
): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await updateCostItemCore(ctx, input);
  if (res.ok) refreshApp();
  return { ok: res.ok, error: res.error };
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

export async function loadStarterCatalogue(): Promise<
  ActionResult & { data?: StarterLoadSummary }
> {
  const ctx = await requireOrg();
  const res = await loadStarterCatalogueCore(ctx);
  if (res.ok) refreshApp();
  return res;
}

export async function parseCostImport(
  formData: FormData,
): Promise<ActionResult & { data?: ParsedSheet }> {
  const ctx = await requireOrg();
  const file = formData.get('file');
  if (!(file instanceof File)) return err('invalid');
  const bytes = new Uint8Array(await file.arrayBuffer());
  return parseCostImportCore(ctx, { bytes });
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
