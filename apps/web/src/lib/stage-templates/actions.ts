'use server';

import { revalidatePath } from 'next/cache';
import type { ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import {
  setStageTemplateActiveCore,
  updateStageTemplateCore,
  upsertStageTemplateCore,
  type StageTemplateInput,
} from './core';

function refreshApp(): void {
  revalidatePath('/', 'layout');
}

export async function addStageTemplate(
  input: StageTemplateInput,
): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await upsertStageTemplateCore(ctx, input);
  if (res.ok) refreshApp();
  return { ok: res.ok, error: res.error };
}

export async function updateStageTemplate(
  input: { id: string } & StageTemplateInput,
): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await updateStageTemplateCore(ctx, input);
  if (res.ok) refreshApp();
  return res;
}

export async function setStageTemplateActive(
  id: string,
  active: boolean,
): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await setStageTemplateActiveCore(ctx, { id, active });
  if (res.ok) refreshApp();
  return res;
}
