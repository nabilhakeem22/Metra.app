import type { ActionCode } from '@/lib/actions/result';
import type { DeliveryReminder } from '@/lib/engagements/reminder/prepare';

/**
 * What the "Send reminder" dialog shows. Each refusal has its own way out:
 * `notShared` -> Share; `unrecoverable` -> ONE Replace; `notConfigured` -> none
 * (a server setting; a Replace would only kill the client's working link).
 */
export type ReminderView =
  | { status: 'loading' }
  | { status: 'ready'; reminder: DeliveryReminder }
  | { status: 'notShared' }
  | { status: 'notConfigured' }
  | { status: 'unrecoverable' }
  | { status: 'failed'; error: ActionCode };

export const VIEW_OF_REFUSAL: Partial<Record<ActionCode, ReminderView>> = {
  delivery_link_not_shared: { status: 'notShared' },
  delivery_links_not_configured: { status: 'notConfigured' },
  delivery_link_unrecoverable: { status: 'unrecoverable' },
};

/**
 * The view a reminder load answers. `afterReplace`: a link just replaced that
 * STILL cannot be re-created is a dead end, not an invitation to replace again.
 */
export function reminderViewOf(
  result: { ok: boolean; error?: ActionCode; data?: DeliveryReminder },
  afterReplace: boolean,
): ReminderView {
  if (result.ok && result.data) return { status: 'ready', reminder: result.data };
  const error = result.error ?? 'generic';
  const loops = afterReplace && error === 'delivery_link_unrecoverable';
  return (!loops && VIEW_OF_REFUSAL[error]) || { status: 'failed', error };
}
