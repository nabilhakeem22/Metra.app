'use server';

import { revalidatePath } from 'next/cache';
import { BELL_FEED_LIMIT, type NotificationFeed } from '@/components/notifications/feed-item';
import { loggableFailure } from '@/lib/actions/loggable-failure';
import type { ActionCode, ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import {
  markAllNotificationsReadCore,
  markNotificationReadCore,
} from './core';
import { loadNotificationFeed } from './feed';

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

/** A Next.js control-flow signal (redirect, notFound) rather than a failure. */
function isNavigationSignal(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === 'string' && digest.startsWith('NEXT_');
}

/**
 * The bell's background poll: the unread count and the newest notifications.
 * NEVER THROWS and never navigates: a poll is not something the user did, so an
 * expired session (requireOrg's redirect to /login) or a failed read answers a
 * code and the bell keeps what it had. Revalidates nothing.
 */
export async function pollNotificationFeed(): Promise<
  { ok: true; data: NotificationFeed } | { ok: false; error: ActionCode }
> {
  try {
    const ctx = await requireOrg();
    return { ok: true, data: await loadNotificationFeed(ctx, BELL_FEED_LIMIT) };
  } catch (error) {
    if (isNavigationSignal(error)) return { ok: false, error: 'forbidden' };
    console.error('notification poll failed:', loggableFailure(error));
    return { ok: false, error: 'generic' };
  }
}
