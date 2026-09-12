import { revalidatePath } from 'next/cache';

/**
 * Invalidate every server-rendered surface after a successful mutation.
 *
 * Layout-wide on purpose, not per-route: a single write shows up in more than
 * one place — the record's own page, the list it appears in, the dashboard
 * counts, and the shell's notification bell. Revalidating only the page the
 * action was called from leaves the others reading stale cache.
 */
export function refreshApp(): void {
  revalidatePath('/', 'layout');
}
