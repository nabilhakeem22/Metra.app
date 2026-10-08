'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { useRouter } from '@/i18n/routing';
import type { Locale } from '@/i18n/routing';
import type { ActionCode } from '@/lib/actions/result';
import {
  emailDeliveryReminder,
  prepareDeliveryReminder,
  rotateDeliveryLink,
  shareDeliveryLink,
} from '@/lib/engagements/actions';
import { reminderViewOf, type ReminderView } from './reminder-view';
import {
  DELIVERY_LINK_CHANGED_EVENT,
  announceDeliveryLinkChanged,
  type DeliveryLinkChange,
} from './share-anchor';
import { useRefreshOnFocus } from './use-refresh-on-focus';

/** A focus within this long of the last load does not re-read (each read is audited). */
const REFRESH_ON_FOCUS_AFTER_MS = 30_000;

export interface DeliveryReminderApi {
  open: boolean;
  /** Opening (re)loads the reminder. It never changes the link; each load writes one audit row. */
  setOpen: (open: boolean) => void;
  view: ReminderView;
  locale: Locale;
  setLocale: (locale: Locale) => void;
  /** Share a first link, then load the reminder. */
  shareAndReload: () => void;
  /** Replace the link (rotate), then load the reminder again. Ask before calling. */
  replaceAndReload: () => void;
  /** A share or replace is in flight. */
  changingLink: boolean;
  sendEmail: () => void;
  emailing: boolean;
  /** The last email's outcome in this dialog, or null. */
  emailResult: { ok: true } | { ok: false; error: ActionCode } | null;
  copied: boolean;
  copy: () => void;
}

type Result<T = undefined> = { ok: boolean; error?: ActionCode; data?: T };

/** Wrap an action so a rejected promise is a coded failure, never a stuck spinner. */
async function settled<T>(action: () => Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await action();
  } catch {
    return { ok: false, error: 'generic' };
  }
}

/**
 * The "Send reminder" dialog's state. The reminder carries the client's current
 * link and is re-read whenever it may have changed: the other dialog replaced or
 * revoked it, or the window regains focus (another tab or person may have). The
 * only writes are Share and Replace, each behind its own button (Replace asks).
 */
export function useDeliveryReminder(engagementId: string): DeliveryReminderApi {
  const router = useRouter();
  const [open, setOpenState] = useState(false);
  const [view, setView] = useState<ReminderView>({ status: 'loading' });
  const [locale, setLocale] = useState<Locale>('ar-EG');
  const [changingLink, startChangingLink] = useTransition();
  const [emailing, startEmailing] = useTransition();
  const [emailResult, setEmailResult] = useState<DeliveryReminderApi['emailResult']>(null);
  const [copied, setCopied] = useState(false);
  // A stale wa.me link is a dead link: re-read on focus (another tab or person).
  const { markRefreshed } = useRefreshOnFocus(open, REFRESH_ON_FOCUS_AFTER_MS, () => void load());

  const load = useCallback(
    async (afterReplace = false): Promise<void> => {
      setView({ status: 'loading' });
      setEmailResult(null);
      setCopied(false);
      markRefreshed();
      const result = await settled(() => prepareDeliveryReminder(engagementId));
      if (result.ok && result.data) setLocale(result.data.defaultLocale);
      setView(reminderViewOf(result, afterReplace));
    },
    [engagementId, markRefreshed],
  );

  const setOpen = useCallback(
    (next: boolean): void => {
      setOpenState(next);
      if (next) void load();
    },
    [load],
  );

  // Re-read, while open, after the other dialog changed the link.
  useEffect(() => {
    if (!open) return;
    const onChanged = (event: Event) => {
      const change = (event as CustomEvent<DeliveryLinkChange>).detail;
      if (change?.source === 'clientLink') void load();
    };
    window.addEventListener(DELIVERY_LINK_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(DELIVERY_LINK_CHANGED_EVENT, onChanged);
  }, [open, load]);

  function changeLinkThenReload(write: () => Promise<Result>, afterReplace: boolean): void {
    startChangingLink(async () => {
      const written = await settled(write);
      if (!written.ok) {
        setView({ status: 'failed', error: written.error ?? 'generic' });
        return;
      }
      announceDeliveryLinkChanged({ shared: true, source: 'reminder' });
      router.refresh();
      await load(afterReplace);
    });
  }

  function sendEmail(): void {
    setEmailResult(null);
    startEmailing(async () => {
      const result = await settled(() => emailDeliveryReminder(engagementId, locale));
      setEmailResult(result.ok ? { ok: true } : { ok: false, error: result.error ?? 'generic' });
    });
  }

  return {
    open,
    setOpen,
    view,
    locale,
    setLocale: (next) => {
      setLocale(next);
      setCopied(false);
      setEmailResult(null);
    },
    shareAndReload: () => changeLinkThenReload(() => shareDeliveryLink(engagementId), false),
    replaceAndReload: () => changeLinkThenReload(() => rotateDeliveryLink(engagementId), true),
    changingLink,
    sendEmail,
    emailing,
    emailResult,
    copied,
    copy: () => {
      if (view.status !== 'ready') return;
      void navigator.clipboard?.writeText(view.reminder.messages[locale]);
      setCopied(true);
    },
  };
}
