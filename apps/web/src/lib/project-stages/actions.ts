'use server';

import { refreshApp } from '@/lib/actions/refresh';
import type { ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import {
  addStageCore,
  deleteStageCore,
  updateStageCore,
  type StageInput,
} from './core';

export async function addStage(
  input: { projectId: string } & StageInput,
): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await addStageCore(ctx, input);
  if (res.ok) refreshApp();
  return { ok: res.ok, error: res.error };
}

export async function updateStage(
  input: { id: string } & StageInput,
): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await updateStageCore(ctx, input);
  if (res.ok) refreshApp();
  return res;
}

export async function deleteStage(id: string): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await deleteStageCore(ctx, { id });
  if (res.ok) refreshApp();
  return res;
}
