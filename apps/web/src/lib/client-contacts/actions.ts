'use server';

import { revalidatePath } from 'next/cache';
import type { ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import {
  createContactCore,
  deleteContactCore,
  setPrimaryContactCore,
  updateContactCore,
  type ContactInput,
} from './core';

function refreshApp(): void {
  revalidatePath('/', 'layout');
}

export async function createContact(
  input: { clientId: string } & ContactInput,
): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await createContactCore(ctx, input);
  if (res.ok) refreshApp();
  return { ok: res.ok, error: res.error };
}

export async function updateContact(
  input: { id: string } & ContactInput,
): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await updateContactCore(ctx, input);
  if (res.ok) refreshApp();
  return res;
}

export async function setPrimaryContact(id: string): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await setPrimaryContactCore(ctx, { id });
  if (res.ok) refreshApp();
  return res;
}

export async function deleteContact(id: string): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await deleteContactCore(ctx, { id });
  if (res.ok) refreshApp();
  return res;
}
