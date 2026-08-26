'use server';

import { getLocale } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
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
  if (!res.ok || !res.data) return { ok: res.ok, error: res.error };
  refreshApp();
  // Land on the new client's profile (locale-prefixed path, like the app router).
  let locale = 'ar-EG';
  try {
    locale = await getLocale();
  } catch {
    /* default locale */
  }
  redirect(`/${locale}/clients/${res.data}?created=1`);
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
