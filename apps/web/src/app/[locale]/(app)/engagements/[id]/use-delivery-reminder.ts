'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from '@/i18n/routing';
import type { Locale } from '@/i18n/routing';
import type { ActionCode } from '@/lib/actions/result';
import {
  emailDeliveryReminder,
  prepareDeliveryReminder,
  rotateDeliveryLink,
  shareDeliveryLink,
} from '@/lib/engagements/actions';
import type { DeliveryReminder } from '@/lib/engagements/reminder/prepare';
import {
  DELIVERY_LINK_CHANGED_EVENT,
  announceDeliveryLinkChanged,
  type DeliveryLinkChange,
} from './share-anchor';

/**
 * What the dialog shows. Each refusal has its own way out:
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

const VIEW_OF_REFUSAL: Partial<Record<ActionCode, ReminderView>> = {
  delivery_link_not_shared: { status: 'notShared' },
  delivery_links_not_configured: { status: 'notConfigured' },
  delivery_link_unrecoverable: { status: 'unrecoverable' },
};

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
 * The "Send reminder" dialog's state. The reminder carries the link the client
 * already holds, and it is re-read whenever that link may have changed: the
 * other dialog replaced or revoked it, or the window regains focus (another
 * tab or person may have). The only writes here are Share and Replace, each
 * behind the caller's own button (Replace behind a confirmation).
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
  const openRef = useRef(false);
  const loadedAt = useRef(0);

  // `afterReplace`: a link we just replaced that STILL cannot be re-created is
  // a dead end, not an invitation to replace again.
  const load = useCallback(
    async (afterReplace = false): Promise<void> => {
      setView({ status: 'loading' });
      setEmailResult(null);
      setCopied(false);
      loadedAt.current = Date.now();
      const result = await settled(() => prepareDeliveryReminder(engagementId));
      if (result.ok && result.data) {
        setLocale(result.data.defaultLocale);
        setView({ status: 'ready', reminder: result.data });
        return;
      }
      const error = result.error ?? 'generic';
      const loops = afterReplace && error === 'delivery_link_unrecoverable';
      setView((!loops && VIEW_OF_REFUSAL[error]) || { status: 'failed', error });
    },
    [engagementId],
  );

  const setOpen = useCallback(
    (next: boolean): void => {
      openRef.current = next;
      setOpenState(next);
      if (next) void load();
    },
    [load],
  );

  // A stale wa.me link is a dead link: re-read after the other dialog changed
  // the link, and on focus (another tab or person), while open.
  useEffect(() => {
    const onChanged = (event: Event) => {
      const change = (event as CustomEvent<DeliveryLinkChange>).detail;
      if (openRef.current && change?.source === 'clientLink') void load();
    };
    const onFocus = () => {
      if (openRef.current && Date.now() - loadedAt.current > REFRESH_ON_FOCUS_AFTER_MS) void load();
    };
    window.addEventListener(DELIVERY_LINK_CHANGED_EVENT, onChanged);
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener(DELIVERY_LINK_CHANGED_EVENT, onChanged);
      window.removeEventListener('focus', onFocus);
    };
  }, [load]);

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
