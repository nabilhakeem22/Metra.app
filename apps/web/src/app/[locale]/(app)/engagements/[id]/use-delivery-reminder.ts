'use client';

import { useCallback, useState, useTransition } from 'react';
import { useRouter } from '@/i18n/routing';
import type { Locale } from '@/i18n/routing';
import type { ActionCode } from '@/lib/actions/result';
import {
  emailDeliveryReminder,
  prepareDeliveryReminder,
  rotateDeliveryLink,
} from '@/lib/engagements/actions';
import type { DeliveryReminder } from '@/lib/engagements/reminder/prepare';

/** What the dialog shows. `unrecoverable`: the link cannot be re-created, only replaced. */
export type ReminderView =
  | { status: 'loading' }
  | { status: 'ready'; reminder: DeliveryReminder }
  | { status: 'unrecoverable' }
  | { status: 'failed'; error: ActionCode };

export interface DeliveryReminderApi {
  open: boolean;
  /** Opening (re)loads the reminder; it never writes anything. */
  setOpen: (open: boolean) => void;
  view: ReminderView;
  locale: Locale;
  setLocale: (locale: Locale) => void;
  /** Replace the link (rotate), then load the reminder again. Ask before calling. */
  replaceAndReload: () => void;
  replacing: boolean;
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
 * The "Send reminder" dialog's state. Loading the reminder only READS: the
 * link in it is the one the client already holds. The only write here is the
 * replacement offered when the link cannot be re-created, and the caller puts
 * a confirmation in front of it.
 */
export function useDeliveryReminder(engagementId: string): DeliveryReminderApi {
  const router = useRouter();
  const [open, setOpenState] = useState(false);
  const [view, setView] = useState<ReminderView>({ status: 'loading' });
  const [locale, setLocale] = useState<Locale>('ar-EG');
  const [replacing, startReplacing] = useTransition();
  const [emailing, startEmailing] = useTransition();
  const [emailResult, setEmailResult] = useState<DeliveryReminderApi['emailResult']>(null);
  const [copied, setCopied] = useState(false);

  // Stable (it only uses state setters), so the dialog's window listener is
  // subscribed once rather than on every render.
  const load = useCallback(async (): Promise<void> => {
    setView({ status: 'loading' });
    setEmailResult(null);
    setCopied(false);
    const result = await settled(() => prepareDeliveryReminder(engagementId));
    if (result.ok && result.data) {
      setLocale(result.data.defaultLocale);
      setView({ status: 'ready', reminder: result.data });
    } else if (result.error === 'delivery_link_unrecoverable') {
      setView({ status: 'unrecoverable' });
    } else {
      setView({ status: 'failed', error: result.error ?? 'generic' });
    }
  }, [engagementId]);

  const setOpen = useCallback(
    (next: boolean): void => {
      setOpenState(next);
      if (next) void load();
    },
    [load],
  );

  function replaceAndReload(): void {
    startReplacing(async () => {
      const rotated = await settled(() => rotateDeliveryLink(engagementId));
      if (!rotated.ok) {
        setView({ status: 'failed', error: rotated.error ?? 'generic' });
        return;
      }
      router.refresh();
      await load();
    });
  }

  function sendEmail(): void {
    setEmailResult(null);
    startEmailing(async () => {
      const result = await settled(() => emailDeliveryReminder(engagementId, locale));
      setEmailResult(result.ok ? { ok: true } : { ok: false, error: result.error ?? 'generic' });
    });
  }

  function copy(): void {
    if (view.status !== 'ready') return;
    void navigator.clipboard?.writeText(view.reminder.messages[locale]);
    setCopied(true);
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
    replaceAndReload,
    replacing,
    sendEmail,
    emailing,
    emailResult,
    copied,
    copy,
  };
}
