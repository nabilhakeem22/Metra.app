'use server';

import { revalidatePath } from 'next/cache';
import type { ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import {
  markAllNotificationsReadCore,
  markNotificationReadCore,
} from './core';

export async function markNotificationRead(id: string): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await markNotificationReadCore(ctx, { id });
  if (res.ok) revalidatePath('/', 'layout');
  return res;
}

export async function markAllNotificationsRead(): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await markAllNotificationsReadCore(ctx);
  if (res.ok) revalidatePath('/', 'layout');
  return res;
}
