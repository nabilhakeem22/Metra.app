'use server';

import { revalidatePath } from 'next/cache';
import type { ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import {
  createClientCore,
  setClientActiveCore,
  updateClientCore,
  type ClientInput,
} from './core';

function refreshApp(): void {
  revalidatePath('/', 'layout');
}

export async function createClient(input: ClientInput): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await createClientCore(ctx, input);
  if (res.ok) refreshApp();
  return { ok: res.ok, error: res.error };
}

export async function updateClient(
  input: { id: string } & ClientInput,
): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await updateClientCore(ctx, input);
  if (res.ok) refreshApp();
  return { ok: res.ok, error: res.error };
}

export async function setClientActive(
  id: string,
  active: boolean,
): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await setClientActiveCore(ctx, { id, active });
  if (res.ok) refreshApp();
  return { ok: res.ok, error: res.error };
}
