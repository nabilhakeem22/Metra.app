'use client';

import { useLocale } from 'next-intl';
import { useTheme } from 'next-themes';
import { useEffect, useRef, type RefObject } from 'react';
import type { Locale } from '@/i18n/routing';
import { TURNSTILE_FLEXIBLE_MIN_WIDTH_PX, TURNSTILE_LANGUAGE } from '@/lib/auth/turnstile';
import { loadTurnstile, type TurnstileApi, type TurnstileRenderOptions } from '@/lib/auth/turnstile-loader';
import { turnstileSiteKey } from '../../../../../scripts/turnstile-site-key.mjs';

// The sign-in challenge (go-live T3): ONE Turnstile widget in a slot the login
// form owns, alive across both steps. Each send takes the current token once
// (tokens are single-use) and the widget mints the next, so a Resend always
// carries a fresh one. Supabase checks the token; this app never does.
// Without a site key in the build there is no slot, no script and no token,
// and the send body is exactly what it was before.

/** Read literally, so Next inlines the build's key into this client chunk. Undefined = off. */
const SITE_KEY = turnstileSiteKey(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);

export type CaptchaPass =
  | { ok: true; token: string | undefined } // undefined = the build has no site key
  | { ok: false; error: 'otp_captcha_pending' | 'otp_captcha_failed' };

export interface Captcha {
  /** The widget's slot; null when the build has no site key (render nothing, load nothing). */
  slotRef: RefObject<HTMLDivElement | null> | null;
  /** Hands over the current token ONCE, then resets the widget to mint the next one (tokens are single-use). */
  take(): CaptchaPass;
}

type WidgetPhase = 'loading' | 'ready' | 'failed';

/** Kept in a ref: a token arriving or expiring needs no re-render. */
interface WidgetState {
  phase: WidgetPhase;
  token: string | null;
  widgetId: string | null;
  api: TurnstileApi | null;
}

const CAPTCHA_OFF: Captcha = { slotRef: null, take: () => ({ ok: true, token: undefined }) };

function dropToken(state: WidgetState, phase: WidgetPhase): void {
  state.token = null;
  state.phase = phase;
}

/** Turnstile mints a new token after a reset; a failed widget gets a fresh check the same way. */
function resetWidget(state: WidgetState): void {
  if (state.widgetId !== null) state.api?.reset(state.widgetId);
}

function renderOptions(siteKey: string, slot: HTMLElement, theme: string, locale: Locale, state: WidgetState): TurnstileRenderOptions {
  return {
    sitekey: siteKey,
    // The app's chosen theme (next-themes), not the OS one.
    theme: theme === 'dark' ? 'dark' : 'light',
    language: TURNSTILE_LANGUAGE[locale],
    size: slot.clientWidth >= TURNSTILE_FLEXIBLE_MIN_WIDTH_PX ? 'flexible' : 'compact',
    // Managed mode: most people see nothing; a suspicious browser gets a checkbox.
    appearance: 'interaction-only',
    'response-field': false,
    callback: (token) => {
      state.token = token;
      state.phase = 'ready';
    },
    // Turnstile refreshes an expired token itself ('refresh-expired: auto'); ours must never be sent.
    'expired-callback': () => dropToken(state, 'loading'),
    'timeout-callback': () => dropToken(state, 'loading'),
    'error-callback': () => {
      dropToken(state, 'failed');
      return true;
    },
  };
}

function takeToken(state: WidgetState): CaptchaPass {
  const { token, phase } = state;
  if (token !== null) {
    dropToken(state, 'loading');
    resetWidget(state);
    return { ok: true, token };
  }
  if (phase !== 'failed') return { ok: false, error: 'otp_captcha_pending' };
  if (state.widgetId !== null) {
    resetWidget(state);
    state.phase = 'loading';
  }
  return { ok: false, error: 'otp_captcha_failed' };
}

/** The login form's challenge: the slot to render and the one-shot token. */
export function useCaptcha(): Captcha {
  const slotRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef<WidgetState>({ phase: 'loading', token: null, widgetId: null, api: null });
  const { resolvedTheme } = useTheme();
  // The [locale] layout has already refused any other locale.
  const locale = useLocale() as Locale;

  useEffect(() => {
    const slot = slotRef.current;
    if (!SITE_KEY || !resolvedTheme || !slot) return;
    const state = stateRef.current;
    let unmounted = false;
    loadTurnstile()
      .then((api) => {
        if (unmounted) return;
        state.api = api;
        state.widgetId = api.render(slot, renderOptions(SITE_KEY, slot, resolvedTheme, locale, state)) ?? null;
      })
      .catch(() => {
        if (!unmounted) dropToken(state, 'failed');
      });
    return () => {
      unmounted = true;
      if (state.widgetId !== null) state.api?.remove(state.widgetId);
      state.widgetId = null;
      dropToken(state, 'loading');
    };
  }, [resolvedTheme, locale]);

  if (!SITE_KEY) return CAPTCHA_OFF;
  return { slotRef, take: () => takeToken(stateRef.current) };
}
