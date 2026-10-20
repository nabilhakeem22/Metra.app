'use server';

import type { ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import { recordMeasurementCore, type RecordMeasurementInput } from './core';
import { loadMeasurementsCore, type MeasurementsView } from './read-core';

/** The measurements tab: the contract's state and one page of its lines (read-core.ts). */
export async function loadMeasurements(request: {
  contractId: string;
  afterLineId: string | null;
  provisionalOnly: boolean;
  query: string;
}): Promise<ActionResult & { data?: MeasurementsView }> {
  const ctx = await requireOrg();
  return loadMeasurementsCore(ctx, request);
}

/** Record a line's final measured quantity (core.ts). The tab reads its page again after it. */
export async function recordMeasurement(
  input: RecordMeasurementInput,
): Promise<ActionResult & { data?: string; already?: boolean }> {
  const ctx = await requireOrg();
  return recordMeasurementCore(ctx, input);
}
