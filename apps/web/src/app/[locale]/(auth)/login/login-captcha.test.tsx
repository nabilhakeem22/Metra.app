import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { LoginForm } from './login-form';
import type { CaptchaPass } from './use-captcha';

// The login form with the sign-in challenge ON (go-live T3, AC18-AC23). The
// captcha hook is a double handing out whatever pass a test sets; the hook's
// own rules are use-captcha.test.tsx's. The form must spend a token only on a
// real send, show a refusal in the status line, and leave verify as it was.

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
  usePathname: () => window.location.pathname,
}));
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('@/i18n/routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/routing')>()),
  useRouter: () => router,
}));
const actions = vi.hoisted(() => ({ sendEmailOtp: vi.fn(), sendPhoneOtp: vi.fn(), verifyEmailOtp: vi.fn(), verifyPhoneOtp: vi.fn() }));
vi.mock('@/lib/auth/otp-client', () => actions);
const captcha = vi.hoisted(() => ({ slotRef: { current: null as HTMLDivElement | null }, take: vi.fn<() => CaptchaPass>() }));
vi.mock('./use-captcha', () => ({ useCaptcha: () => captcha }));

const PENDING: CaptchaPass = { ok: false, error: 'otp_captcha_pending' };
const FAILED: CaptchaPass = { ok: false, error: 'otp_captcha_failed' };
const token = (value: string): CaptchaPass => ({ ok: true, token: value });

beforeEach(() => {
  for (const action of Object.values(actions)) action.mockReset();
  captcha.take.mockReset().mockReturnValue(PENDING);
  captcha.slotRef.current = null;
  window.history.replaceState(null, '', '/en/login');
});
afterEach(() => vi.useRealTimers());

describe.each<TestLocale>(['en', 'ar-EG'])('LoginForm with the challenge on (%s)', (locale) => {
  const at = (path: string) => messageAt(locale, path);
  const status = () => screen.getByRole('status').textContent;
  const sendButton = () => screen.getByRole('button', { name: at('login.sendCode') }) as HTMLButtonElement;

  async function sendTo(address: string) {
    renderWithIntl(<LoginForm />, { locale });
    fireEvent.change(document.getElementById('identifier')!, { target: { value: address } });
    await act(async () => {
      fireEvent.click(sendButton());
    });
  }

  test('renders the widget slot between the step and the status line', async () => {
    await sendTo('');
    expect(captcha.slotRef.current).toBeInstanceOf(HTMLDivElement);
    expect(screen.getByRole('status').previousElementSibling).toBe(captcha.slotRef.current);
  });

  test('Send before a token says the browser is still being checked and sends nothing (AC18)', async () => {
    await sendTo('mona@firm.example');
    expect(status()).toBe(at('errors.otp_captcha_pending'));
    expect(actions.sendEmailOtp).not.toHaveBeenCalled();
    expect(sendButton().disabled).toBe(false);
    expect(sendButton().textContent).toBe(at('login.sendCode'));
  });

  test('Send with a token sends it with the address (AC19)', async () => {
    captcha.take.mockReturnValueOnce(token('tok-1'));
    actions.sendEmailOtp.mockResolvedValue({ ok: true });
    await sendTo('mona@firm.example');
    expect(actions.sendEmailOtp.mock.calls).toEqual([['mona@firm.example', 'tok-1']]);
    expect(captcha.take).toHaveBeenCalledOnce();
  });

  test('Resend takes a fresh token, and verify is called exactly as before (AC20)', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    captcha.take.mockReturnValueOnce(token('tok-1')).mockReturnValueOnce(token('tok-2'));
    actions.sendEmailOtp.mockResolvedValue({ ok: true });
    actions.verifyEmailOtp.mockResolvedValue({ ok: true, next: '/dashboard' });
    await sendTo('mona@firm.example');
    act(() => vi.advanceTimersByTime(60_000));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: at('login.resend') }));
    });
    expect(actions.sendEmailOtp.mock.calls).toEqual([['mona@firm.example', 'tok-1'], ['mona@firm.example', 'tok-2']]);
    await act(async () => {
      fireEvent.paste(screen.getAllByRole('textbox')[0]!, { clipboardData: { getData: () => '123456' } });
    });
    expect(actions.verifyEmailOtp.mock.calls).toEqual([['mona@firm.example', '123456', undefined]]);
    expect(captcha.take).toHaveBeenCalledTimes(2);
  });

  test('a widget that failed says so in the status line and sends nothing (AC21)', async () => {
    captcha.take.mockReturnValueOnce(FAILED);
    await sendTo('mona@firm.example');
    expect(status()).toBe(at('errors.otp_captcha_failed'));
    expect(actions.sendEmailOtp).not.toHaveBeenCalled();
  });

  test('Supabase refusing the token is said in the status line (AC22)', async () => {
    captcha.take.mockReturnValueOnce(token('tok-1'));
    actions.sendEmailOtp.mockResolvedValue({ ok: false, error: 'otp_captcha_failed' });
    await sendTo('mona@firm.example');
    expect(status()).toBe(at('errors.otp_captcha_failed'));
  });

  test('an empty box is said under the box and spends no token (AC23)', async () => {
    await sendTo('');
    expect(document.getElementById('identifier-error')?.textContent).toBe(at('errors.field.required'));
    expect(captcha.take).not.toHaveBeenCalled();
    expect(status()).toBe('');
  });
});
