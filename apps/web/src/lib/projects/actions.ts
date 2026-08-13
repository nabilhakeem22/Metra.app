'use server';

import { getLocale } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import {
  createProjectCore,
  setProjectActiveCore,
  updateProjectCore,
  type ProjectInput,
} from './core';

function refreshApp(): void {
  revalidatePath('/', 'layout');
}

export async function createProject(input: ProjectInput): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await createProjectCore(ctx, input);
  if (!res.ok || !res.data) return { ok: res.ok, error: res.error };
  refreshApp();
  // Land on the new project's profile (locale-prefixed path, like the app router).
  let locale = 'ar-EG';
  try {
    locale = await getLocale();
  } catch {
    /* default locale */
  }
  redirect(`/${locale}/projects/${res.data}`);
}

export async function updateProject(
  input: { id: string } & ProjectInput,
): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await updateProjectCore(ctx, input);
  if (res.ok) refreshApp();
  return { ok: res.ok, error: res.error };
}

export async function setProjectActive(
  id: string,
  active: boolean,
): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await setProjectActiveCore(ctx, { id, active });
  if (res.ok) refreshApp();
  return { ok: res.ok, error: res.error };
}
