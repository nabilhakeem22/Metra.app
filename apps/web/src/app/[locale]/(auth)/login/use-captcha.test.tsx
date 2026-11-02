import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TurnstileApi, TurnstileRenderOptions } from '@/lib/auth/turnstile-loader';
import type { Captcha } from './use-captcha';

// The login form's challenge hook (AC17, AC19, AC21, AC24). The loader,
// next-themes and next-intl are doubles; the key is Cloudflare's always-pass
// TEST site key, stubbed per test, and each test loads a fresh hook module so
// the build-time read happens again.

const TEST_SITE_KEY = '1x00000000000000000000AA';
const host = vi.hoisted(() => ({ theme: 'light' as string | undefined, locale: 'en', loader: null as Promise<unknown> | null }));
vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: host.theme }) }));
vi.mock('next-intl', () => ({ useLocale: () => host.locale }));
vi.mock('@/lib/auth/turnstile-loader', () => ({ loadTurnstile: vi.fn(() => host.loader) }));

const api = { render: vi.fn(() => 'widget-1'), reset: vi.fn(), remove: vi.fn() } satisfies TurnstileApi;
let slotWidth = 294;

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', TEST_SITE_KEY);
  Object.assign(host, { theme: 'light', locale: 'en', loader: Promise.resolve(api) });
  for (const call of Object.values(api)) call.mockClear();
  slotWidth = 294;
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => slotWidth);
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** Mounts the hook with its slot, as the login form does; `current()` is the latest Captcha. */
async function mountCaptcha() {
  const { useCaptcha } = await import('./use-captcha');
  const latest: { captcha: Captcha | null } = { captcha: null };
  function Harness() {
    const captcha = useCaptcha();
    latest.captcha = captcha;
    return captcha.slotRef ? <div data-testid="captcha-slot" ref={captcha.slotRef} /> : null;
  }
  const view = await act(async () => render(<Harness />));
  return { view, Harness, current: () => latest.captcha! };
}

const renderedOptions = (call = 0) => (api.render.mock.calls[call] as unknown as [HTMLElement, TurnstileRenderOptions])[1];

describe('useCaptcha without a site key', () => {
  it('has no slot, loads nothing and hands over no token', async () => {
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', '');
    const { view, current } = await mountCaptcha();
    expect(current().slotRef).toBeNull();
    expect(view.queryByTestId('captcha-slot')).toBeNull();
    expect(current().take()).toEqual({ ok: true, token: undefined });
    expect((await import('@/lib/auth/turnstile-loader')).loadTurnstile).not.toHaveBeenCalled();
  });
});

describe('useCaptcha with a site key', () => {
  it('renders one widget with the key, the app theme, the locale and interaction-only (AC17)', async () => {
    await mountCaptcha();
    expect(api.render).toHaveBeenCalledOnce();
    expect(renderedOptions()).toMatchObject({
      sitekey: TEST_SITE_KEY,
      theme: 'light',
      language: 'en',
      appearance: 'interaction-only',
      'response-field': false,
      size: 'compact',
    });
  });

  it.each([
    ['dark', 'ar-EG', 300, { theme: 'dark', language: 'ar-eg', size: 'flexible' }],
    ['light', 'en', 299, { theme: 'light', language: 'en', size: 'compact' }],
  ])('theme %s, locale %s, a %i px slot (AC17)', async (theme, locale, width, expected) => {
    Object.assign(host, { theme, locale });
    slotWidth = width;
    await mountCaptcha();
    expect(renderedOptions()).toMatchObject(expected);
  });

  it('waits for next-themes to resolve the theme before loading', async () => {
    host.theme = undefined;
    await mountCaptcha();
    expect(api.render).not.toHaveBeenCalled();
  });

  it('is pending before a token, hands one over once and resets, then is pending again (AC19)', async () => {
    const { current } = await mountCaptcha();
    expect(current().take()).toEqual({ ok: false, error: 'otp_captcha_pending' });
    act(() => renderedOptions().callback('tok-1'));
    expect(current().take()).toEqual({ ok: true, token: 'tok-1' });
    expect(api.reset.mock.calls).toEqual([['widget-1']]);
    expect(current().take()).toEqual({ ok: false, error: 'otp_captcha_pending' });
    act(() => renderedOptions().callback('tok-2'));
    expect(current().take()).toEqual({ ok: true, token: 'tok-2' });
  });

  it('an expired or timed-out token is never handed over (AC21)', async () => {
    const { current } = await mountCaptcha();
    for (const expiry of ['expired-callback', 'timeout-callback'] as const) {
      act(() => renderedOptions().callback('tok-old'));
      act(() => renderedOptions()[expiry]());
      expect(current().take()).toEqual({ ok: false, error: 'otp_captcha_pending' });
    }
    expect(api.reset).not.toHaveBeenCalled();
  });

  it('a widget error is failed, resets the widget for a fresh check, and says it handled the error (AC21)', async () => {
    const { current } = await mountCaptcha();
    expect(renderedOptions()['error-callback']('300030')).toBe(true);
    expect(current().take()).toEqual({ ok: false, error: 'otp_captcha_failed' });
    expect(api.reset.mock.calls).toEqual([['widget-1']]);
    expect(current().take()).toEqual({ ok: false, error: 'otp_captcha_pending' });
  });

  it('a script that never loads is failed, with no widget to reset (AC21)', async () => {
    const failedLoad = Promise.reject(new Error('turnstile script failed to load'));
    failedLoad.catch(() => {}); // the hook's own handler attaches after the module import
    host.loader = failedLoad;
    const { current } = await mountCaptcha();
    expect(current().take()).toEqual({ ok: false, error: 'otp_captcha_failed' });
    expect(current().take()).toEqual({ ok: false, error: 'otp_captcha_failed' });
    expect(api.render).not.toHaveBeenCalled();
    expect(api.reset).not.toHaveBeenCalled();
  });

  it('unmounting removes the widget (AC24)', async () => {
    const { view } = await mountCaptcha();
    view.unmount();
    expect(api.remove.mock.calls).toEqual([['widget-1']]);
  });

  it('a theme change removes the widget and renders a new one, dropping the old token (AC24)', async () => {
    const { view, Harness, current } = await mountCaptcha();
    act(() => renderedOptions().callback('tok-light'));
    host.theme = 'dark';
    await act(async () => view.rerender(<Harness />));
    expect(api.remove.mock.calls).toEqual([['widget-1']]);
    expect(api.render).toHaveBeenCalledTimes(2);
    expect(renderedOptions(1).theme).toBe('dark');
    expect(current().take()).toEqual({ ok: false, error: 'otp_captcha_pending' });
  });
});
