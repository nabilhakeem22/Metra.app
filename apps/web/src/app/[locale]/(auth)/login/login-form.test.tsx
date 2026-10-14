import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fieldsFailed } from '@/lib/actions/field-errors';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { LoginForm } from './login-form';

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('') }));
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
  resolvePostLoginPath: vi.fn(),
}));
vi.mock('@/lib/auth/actions', () => actions);

beforeEach(() => {
  for (const action of Object.values(actions)) action.mockReset();
});

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

  test('a rate limit is said in the status line (AC 28)', async () => {
    actions.sendEmailOtp.mockResolvedValue({ ok: false, error: 'otp_rate_limited' });
    renderLogin();
    await sendTo('mona@firm.example');
    expect(status()).toBe(at('errors.otp_rate_limited'));
    expect(identifier().getAttribute('aria-invalid')).toBeNull();
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
