import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fieldsFailed } from '@/lib/actions/field-errors';
import { expectFieldErrorsRenderUnderFields } from '@/test/field-coverage';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { LoginForm } from './login-form';

// useSearchParams follows the address, as Next's own does after
// history.replaceState (its app router patches replaceState to tell it).
const address = vi.hoisted(() => ({ listeners: new Set<() => void>() }));
vi.mock('next/navigation', async () => {
  const { useSyncExternalStore } = await import('react');
  const subscribe = (listener: () => void) => {
    address.listeners.add(listener);
    return () => address.listeners.delete(listener);
  };
  return {
    useSearchParams: () => new URLSearchParams(useSyncExternalStore(subscribe, () => window.location.search)),
    usePathname: () => window.location.pathname,
  };
});
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('@/i18n/routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/routing')>()),
  useRouter: () => router,
}));
const actions = vi.hoisted(() => ({
  sendEmailOtp: vi.fn(),
  sendPhoneOtp: vi.fn(),
  verifyEmailOtp: vi.fn(),
  verifyPhoneOtp: vi.fn(),
}));
vi.mock('@/lib/auth/otp-client', () => actions);

const replaceAddress = window.history.replaceState.bind(window.history);
let replaceState: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  for (const action of Object.values(actions)) action.mockReset();
  router.push.mockReset();
  replaceAddress(null, '', '/en/login');
  replaceState = vi.spyOn(window.history, 'replaceState').mockImplementation((data, unused, url) => {
    replaceAddress(data, unused, url);
    for (const listener of address.listeners) listener();
  });
});
afterEach(() => replaceState.mockRestore());

describe.each<TestLocale>(['en', 'ar-EG'])('LoginForm refusals (%s)', (locale) => {
  const at = (path: string) => messageAt(locale, path);
  const identifier = () => document.getElementById('identifier') as HTMLInputElement;
  const under = (id: string) => document.getElementById(`${id}-error`)?.textContent;
  const status = () => screen.getByRole('status').textContent;
  const sendButton = () => screen.getByRole('button', { name: at('login.sendCode') });

  function renderLogin() {
    document.documentElement.dir = locale === 'ar-EG' ? 'rtl' : 'ltr';
    renderWithIntl(<LoginForm />, { locale });
  }

  async function sendTo(address: string) {
    fireEvent.change(identifier(), { target: { value: address } });
    await act(async () => {
      fireEvent.click(sendButton());
    });
  }

  test('an empty box: Send stays enabled, says what is missing under the box, sends nothing', async () => {
    renderLogin();
    expect((sendButton() as HTMLButtonElement).disabled).toBe(false);
    await sendTo('');
    expect(actions.sendEmailOtp).not.toHaveBeenCalled();
    expect(under('identifier')).toBe(at('errors.field.required'));
    expect(identifier().getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(identifier());
  });

  test('a build without a Turnstile site key: no widget slot, no script, no token (AC15)', async () => {
    actions.sendEmailOtp.mockResolvedValue({ ok: true });
    renderLogin();
    expect(screen.getByRole('status').previousElementSibling?.contains(identifier())).toBe(true);
    await sendTo('mona@firm.example');
    expect(actions.sendEmailOtp.mock.calls).toEqual([['mona@firm.example', undefined]]);
    expect(document.querySelector('script[src*="challenges.cloudflare.com"]')).toBeNull();
  });

  test('a malformed address is said under the box and never sent', async () => {
    renderLogin();
    await sendTo('mona@firm');
    expect(actions.sendEmailOtp).not.toHaveBeenCalled();
    expect(under('identifier')).toBe(at('errors.field.email_format'));
  });

  test('the provider refusing the address puts email_format under the box (AC 28)', async () => {
    actions.sendEmailOtp.mockResolvedValue(fieldsFailed({ email: { code: 'email_format' } }));
    renderLogin();
    await sendTo('mona@firm.example');
    expect(under('identifier')).toBe(at('errors.field.email_format'));
    expect(identifier().getAttribute('aria-invalid')).toBe('true');
    expect(status()).toBe('');
  });

  test('a refusal of the address is said under the box that holds it (AC 19)', async () => {
    renderLogin();
    fireEvent.change(identifier(), { target: { value: 'mona@firm.example' } });
    await expectFieldErrorsRenderUnderFields({
      fields: ['email'],
      controlIdOf: () => 'identifier',
      answerWith: (result) => actions.sendEmailOtp.mockResolvedValue(result),
      submit: async () => {
        await act(async () => {
          fireEvent.click(sendButton());
        });
      },
      locale,
      typed: { identifier: 'mona@firm.example' },
    });
  });

  test('a rate limit is said in the status line (AC 28)', async () => {
    actions.sendEmailOtp.mockResolvedValue({ ok: false, error: 'otp_rate_limited' });
    renderLogin();
    await sendTo('mona@firm.example');
    expect(status()).toBe(at('errors.otp_rate_limited'));
    expect(identifier().getAttribute('aria-invalid')).toBeNull();
  });

  test.each(['forbidden', 'malformed'])(
    'a %s answer is said as a sign-in sentence, not the studio one (F1)',
    async (code) => {
      actions.sendEmailOtp.mockResolvedValue({ ok: false, error: code });
      renderLogin();
      await sendTo('mona@firm.example');
      expect(status()).toBe(at('login.pageRefused'));
      expect(status()).not.toBe(at(`errors.${code}`));
      expect(identifier().getAttribute('aria-invalid')).toBeNull();
    },
  );

  test('a forbidden answer to the code is the same sign-in sentence (F1)', async () => {
    actions.sendEmailOtp.mockResolvedValue({ ok: true });
    actions.verifyEmailOtp.mockResolvedValue({ ok: false, error: 'forbidden' });
    renderLogin();
    await sendTo('mona@firm.example');
    await act(async () => {
      fireEvent.paste(screen.getAllByRole('textbox')[0], { clipboardData: { getData: () => '123456' } });
    });
    expect(status()).toBe(at('login.pageRefused'));
    expect(router.push).not.toHaveBeenCalled();
  });

  test('an address longer than the endpoint takes is said under the box and never sent (F3)', async () => {
    renderLogin();
    await sendTo(`${'a'.repeat(310)}@example.com`);
    expect(actions.sendEmailOtp).not.toHaveBeenCalled();
    expect(under('identifier')).toBe(at('errors.field.too_long').replace('{max}', '320'));
    expect(identifier().getAttribute('aria-invalid')).toBe('true');
    expect(status()).toBe('');
  });

  test('switching to create-account and back keeps the typed address, without leaving the page (F2)', async () => {
    renderLogin();
    fireEvent.change(identifier(), { target: { value: 'keep@me.test' } });
    const toSignUp = screen.getByRole('link', { name: at('login.switchToSignUpLink') });
    expect(toSignUp.getAttribute('href')).toBe(`/${locale}/login?mode=signup`);
    await act(async () => {
      expect(fireEvent.click(toSignUp)).toBe(false);
    });
    expect(replaceState).toHaveBeenLastCalledWith(null, '', `${window.location.origin}/${locale}/login?mode=signup`);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(at('login.signUpTitle'));
    expect(identifier().value).toBe('keep@me.test');

    const toSignIn = screen.getByRole('link', { name: at('login.switchToSignInLink') });
    await act(async () => {
      expect(fireEvent.click(toSignIn)).toBe(false);
    });
    expect(window.location.search).toBe('?mode=signin');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(at('login.signInTitle'));
    expect(identifier().value).toBe('keep@me.test');
  });

  test('a modified click on the switch link is left to the browser (a new tab)', async () => {
    renderLogin();
    const toSignUp = screen.getByRole('link', { name: at('login.switchToSignUpLink') });
    await act(async () => {
      fireEvent.click(toSignUp, { ctrlKey: true });
    });
    expect(replaceState).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(at('login.signInTitle'));
  });

  test('a rejected send leaves the sending state and says why (AC 28)', async () => {
    actions.sendEmailOtp.mockRejectedValue(new TypeError('fetch failed'));
    renderLogin();
    await sendTo('mona@firm.example');
    expect(status()).toBe(at('errors.unreachable'));
    expect((sendButton() as HTMLButtonElement).disabled).toBe(false);
    expect(sendButton().textContent).toBe(at('login.sendCode'));
  });

  test('a wrong code is said under the code boxes, which point at it', async () => {
    actions.sendEmailOtp.mockResolvedValue({ ok: true });
    actions.verifyEmailOtp.mockResolvedValue(fieldsFailed({ token: { code: 'otp_verify_failed' } }));
    renderLogin();
    await sendTo('mona@firm.example');
    const boxes = screen.getAllByRole('textbox');
    await act(async () => {
      fireEvent.paste(boxes[0], { clipboardData: { getData: () => '123456' } });
    });
    expect(under('otp-code')).toBe(at('errors.otp_verify_failed'));
    for (const box of screen.getAllByRole('textbox')) {
      expect(box.getAttribute('aria-invalid')).toBe('true');
      expect(box.getAttribute('aria-describedby')).toBe('otp-code-error');
    }
  });

  test('a refused code is said under the code boxes (AC 19)', async () => {
    actions.sendEmailOtp.mockResolvedValue({ ok: true });
    renderLogin();
    await sendTo('mona@firm.example');
    await expectFieldErrorsRenderUnderFields({
      fields: ['token'],
      controlIdOf: () => 'otp-code',
      answerWith: (result) => actions.verifyEmailOtp.mockResolvedValue(result),
      submit: async () => {
        await act(async () => {
          fireEvent.paste(screen.getAllByRole('textbox')[0], { clipboardData: { getData: () => '123456' } });
        });
      },
      locale,
    });
  });

  test.each([['/dashboard'], ['/onboarding']])('a verified code goes where the answer says: %s', async (next) => {
    actions.sendEmailOtp.mockResolvedValue({ ok: true });
    actions.verifyEmailOtp.mockResolvedValue({ ok: true, next });
    renderLogin();
    await sendTo('mona@firm.example');
    await act(async () => {
      fireEvent.paste(screen.getAllByRole('textbox')[0], { clipboardData: { getData: () => '123456' } });
    });
    expect(actions.verifyEmailOtp).toHaveBeenCalledWith('mona@firm.example', '123456', undefined);
    expect(router.push).toHaveBeenCalledWith(next);
  });

  test('a sign-in from the site app login link (?return=site) asks to return there', async () => {
    replaceAddress(null, '', '/en/login?return=site');
    actions.sendEmailOtp.mockResolvedValue({ ok: true });
    actions.verifyEmailOtp.mockResolvedValue({ ok: true, next: '/site' });
    renderLogin();
    await sendTo('mona@firm.example');
    await act(async () => {
      fireEvent.paste(screen.getAllByRole('textbox')[0], { clipboardData: { getData: () => '123456' } });
    });
    expect(actions.verifyEmailOtp).toHaveBeenCalledWith('mona@firm.example', '123456', 'site');
    expect(router.push).toHaveBeenCalledWith('/site');
  });

  test('pressing Verify on a short code says how many digits, without sending', async () => {
    actions.sendEmailOtp.mockResolvedValue({ ok: true });
    renderLogin();
    await sendTo('mona@firm.example');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: at('login.verify') }));
    });
    expect(actions.verifyEmailOtp).not.toHaveBeenCalled();
    expect(under('otp-code')).toBe(at('errors.field.too_short').replace('{min}', '6'));
  });
});
