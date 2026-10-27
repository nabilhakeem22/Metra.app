import { TURNSTILE_SCRIPT_URL } from './turnstile';

// Loads Cloudflare's Turnstile script into the page, once. BROWSER-ONLY and
// client-safe: only the login form's captcha hook calls it, from an effect, so
// a build without a site key never runs it and the page never asks for it.

/** The options of turnstile.render this app passes (Cloudflare's widget configurations). */
export interface TurnstileRenderOptions {
  sitekey: string;
  theme: 'light' | 'dark';
  language: 'ar-eg' | 'en';
  size: 'flexible' | 'compact';
  appearance: 'interaction-only';
  'response-field': false;
  callback: (token: string) => void;
  'expired-callback': () => void;
  'timeout-callback': () => void;
  /** Returning true tells Turnstile the error was handled (no console throw); its own retry still runs. */
  'error-callback': (code: string) => boolean;
}

/** The three calls of window.turnstile this app makes. */
export interface TurnstileApi {
  render(container: HTMLElement, options: TurnstileRenderOptions): string | undefined;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let turnstileLoading: Promise<TurnstileApi> | null = null;

function injectTurnstileScript(): Promise<TurnstileApi> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = TURNSTILE_SCRIPT_URL;
    script.async = true;
    script.addEventListener('load', () => {
      // developer-only messages: they name the script, never a person's data.
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error('turnstile script loaded without window.turnstile'));
    });
    script.addEventListener('error', () => reject(new Error('turnstile script failed to load')));
    document.head.appendChild(script);
  });
}

/**
 * window.turnstile, injecting ONE script per page however often it is asked
 * (memoised; a turnstile already on the page is reused). Rejects when the
 * script fails to load or loads without the API; a rejection stays memoised
 * until the page is reloaded.
 */
export function loadTurnstile(): Promise<TurnstileApi> {
  turnstileLoading ??= window.turnstile ? Promise.resolve(window.turnstile) : injectTurnstileScript();
  return turnstileLoading;
}
