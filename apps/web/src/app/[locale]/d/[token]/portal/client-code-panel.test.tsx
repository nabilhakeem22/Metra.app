import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { ClientCodePanel } from './client-code-panel';
import type { ClientCode } from './use-client-code';

// H5: the one-time code panel, every state it can be in, in both locales:
// where the code goes, sent with the masked hint, the resend wait, and each
// refusal in its own words. No em dash, Latin digits.

const ARABIC_INDIC = /[٠-٩۰-۹]/;
const DASH = /[–—]/;
const HINT = 'c•••@e•••.com';

function codeOf(fields: Partial<ClientCode> = {}): ClientCode {
  return {
    noChannel: false,
    hint: HINT,
    sent: false,
    value: '',
    type: vi.fn(),
    ready: false,
    requesting: false,
    waitSeconds: 0,
    notice: null,
    request: vi.fn(),
    proof: () => null,
    heard: () => false,
    ...fields,
  };
}

const show = (locale: TestLocale, code: ClientCode) =>
  renderWithIntl(<ClientCodePanel code={code} studioName="Diwan Studio" whatsappHref="https://wa.me/201001234567?text=x" />, { locale });

describe.each<TestLocale>(['en', 'ar-EG'])('the code panel (%s)', (locale) => {
  const text = (key: string) => messageAt(locale, `delivery.code.${key}`);
  const clean = (container: HTMLElement) => {
    expect(container.textContent).not.toMatch(ARABIC_INDIC);
    expect(container.textContent).not.toMatch(DASH);
  };

  it('before a code: where it will go, and Send; with no hint known, the email on file', () => {
    const request = vi.fn();
    const { container, unmount } = show(locale, codeOf({ request }));
    expect(container.textContent).toContain(HINT);
    fireEvent.click(screen.getByRole('button', { name: text('send') }));
    expect(request).toHaveBeenCalledTimes(1);
    clean(container);
    unmount();
    const unknown = show(locale, codeOf({ hint: null }));
    expect(unknown.container.textContent).toContain(text('introOnFile').replace('{studio}', 'Diwan Studio'));
  });

  it('sent: the hint, the box (typed digits go to the hook), and the resend countdown', () => {
    const type = vi.fn();
    const { container } = show(locale, codeOf({ sent: true, value: '04', type, waitSeconds: 42 }));
    expect(container.textContent).toContain(HINT);
    const box = screen.getByLabelText(text('label')) as HTMLInputElement;
    expect(box.getAttribute('inputmode')).toBe('numeric');
    expect(box.getAttribute('autocomplete')).toBe('one-time-code');
    fireEvent.change(box, { target: { value: '٠٤٢' } });
    expect(type).toHaveBeenCalledWith('٠٤٢');
    expect(container.textContent).toContain('0:42');
    expect(screen.queryByRole('button', { name: text('resend') })).toBeNull();
    clean(container);
  });

  it('sent, the wait over: a new code may be asked for', () => {
    const request = vi.fn();
    show(locale, codeOf({ sent: true, request }));
    fireEvent.click(screen.getByRole('button', { name: text('resend') }));
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ error: 'send_failed' as const }, 'error.send_failed'],
    [{ error: 'requestBusy' as const }, 'error.requestBusy'],
    [{ error: 'code_expired' as const }, 'error.code_expired'],
    [{ error: 'code_used' as const }, 'error.code_used'],
    [{ error: 'code_unknown' as const }, 'error.code_unknown'],
    [{ error: 'code_incomplete' as const }, 'error.code_incomplete'],
  ])('says %j in its own words', (notice, key) => {
    show(locale, codeOf({ notice }));
    expect(screen.getByRole('alert').textContent).toBe(text(key).replace('{studio}', 'Diwan Studio'));
  });

  it('too_many names the wait, rounded up, in Latin digits', () => {
    const { container } = show(locale, codeOf({ notice: { error: 'too_many', retryAfterSeconds: 22.5 * 3600 }, waitSeconds: 81000 }));
    const alert = screen.getByRole('alert').textContent ?? '';
    expect(alert).toMatch(/\b23\b/);
    expect((screen.getByRole('button', { name: text('send') }) as HTMLButtonElement).disabled).toBe(true);
    clean(container);
  });

  it('a wrong code names the tries left; a shared failure is said as every link page says it', () => {
    const { unmount } = show(locale, codeOf({ sent: true, notice: { error: 'code_wrong', attemptsLeft: 2 } }));
    expect(screen.getByRole('alert').textContent).toMatch(locale === 'en' ? /\b2\b/ : /محاولتان/);
    unmount();
    show(locale, codeOf({ notice: { error: 'portal', failure: { error: 'token_expired' } } }));
    expect(screen.getByRole('alert').textContent).toBe(messageAt(locale, 'portal.errors.token_expired'));
  });

  it('no address on file: said plainly, the studio\'s WhatsApp, no box and no Send', () => {
    const { container } = show(locale, codeOf({ noChannel: true }));
    expect(screen.getByRole('status').textContent).toBe(text('noChannel').replaceAll('{studio}', 'Diwan Studio'));
    expect(screen.getByRole('link').getAttribute('href')).toBe('https://wa.me/201001234567?text=x');
    expect(screen.queryByRole('button', { name: text('send') })).toBeNull();
    expect(screen.queryByLabelText(text('label'))).toBeNull();
    clean(container);
  });
});
