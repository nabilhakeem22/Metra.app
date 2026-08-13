'use server';

import { revalidatePath } from 'next/cache';
import type { ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import {
  setProjectTypeActiveCore,
  updateProjectTypeCore,
  upsertProjectTypeCore,
  type ProjectTypeInput,
} from './core';

function refreshApp(): void {
  revalidatePath('/', 'layout');
}

/** Create-on-use project type (idempotent). Called from the Details combobox. */
export async function addProjectType(
  input: ProjectTypeInput,
): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await upsertProjectTypeCore(ctx, input);
  if (res.ok) refreshApp();
  return { ok: res.ok, error: res.error };
}

export async function updateProjectType(
  input: { id: string } & ProjectTypeInput,
): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await updateProjectTypeCore(ctx, input);
  if (res.ok) refreshApp();
  return res;
}

export async function setProjectTypeActive(
  id: string,
  active: boolean,
): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await setProjectTypeActiveCore(ctx, { id, active });
  if (res.ok) refreshApp();
  return res;
}
