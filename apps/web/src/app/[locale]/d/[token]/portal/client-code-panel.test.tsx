import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CodeLimit } from '@/lib/client-home/code-answers';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { ClientCodePanel } from './client-code-panel';
import type { ClientCode } from './use-client-code';

// H5: the one-time code panel, every state it can be in, in both locales:
// where the code goes, Send and "I already have a code" (F1), the box with
// the hint of the email it came to, the resend wait (hours and minutes past
// an hour, F4), and each refusal in its own words, a limit named by what it
// is (F4). No em dash, Latin digits.

const ARABIC_INDIC = /[٠-٩۰-۹]/;
const DASH = /[–—]/;
const HINT = 'c•••@e•••.com';

function codeOf(fields: Partial<ClientCode> = {}): ClientCode {
  return {
    act: 'payment',
    noChannel: false,
    hint: HINT,
    typing: false,
    sentHere: false,
    value: '',
    type: vi.fn(),
    ready: false,
    requesting: false,
    waitSeconds: 0,
    notice: null,
    noticeSeconds: 0,
    request: vi.fn(),
    haveCode: vi.fn(),
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

  it('before a code: where it will go, Send, and "I already have a code"; with no hint known, the email on file', () => {
    const request = vi.fn();
    const haveCode = vi.fn();
    const { container, unmount } = show(locale, codeOf({ request, haveCode }));
    expect(container.textContent).toContain(HINT);
    fireEvent.click(screen.getByRole('button', { name: text('send') }));
    expect(request).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: text('haveCode') }));
    expect(haveCode).toHaveBeenCalledTimes(1);
    clean(container);
    unmount();
    const unknown = show(locale, codeOf({ hint: null }));
    expect(unknown.container.textContent).toContain(text('introOnFile').replace('{studio}', 'Diwan Studio'));
  });

  it('typing a code from an earlier email (a reload, the email\'s link): the box, and the latest email it came to', () => {
    const { container, unmount } = show(locale, codeOf({ typing: true }));
    expect(container.textContent).toContain(text('typing').slice(0, text('typing').indexOf('{hint}')));
    expect(container.textContent).toContain(HINT);
    expect(screen.getByLabelText(text('label'))).toBeTruthy();
    expect(screen.getByRole('button', { name: text('resend') })).toBeTruthy();
    clean(container);
    unmount();
    const onFile = show(locale, codeOf({ typing: true, hint: null }));
    expect(onFile.container.textContent).toContain(text('typingOnFile').replace('{studio}', 'Diwan Studio'));
  });

  it('sent from here: the hint, the box (typed digits go to the hook), and the resend countdown', () => {
    const type = vi.fn();
    const { container } = show(locale, codeOf({ typing: true, sentHere: true, value: '04', type, waitSeconds: 42 }));
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

  it('a wait of an hour or more reads in hours and minutes, never as minutes:seconds (F4)', () => {
    const { container } = show(locale, codeOf({ waitSeconds: 1319 * 60 + 54 }));
    const line = container.querySelector('[data-code-wait]')?.textContent ?? '';
    expect(line).not.toMatch(/\d+:\d\d/);
    expect(line).toMatch(locale === 'en' ? /22 hours/ : /22 ساعة/);
    clean(container);
    const partial = show(locale, codeOf({ waitSeconds: 2 * 3600 + 5 * 60 })).container;
    expect(partial.querySelector('[data-code-wait]')?.textContent).toMatch(locale === 'en' ? /2 hours and 5 minutes/ : /ساعتين و5 دقائق/);
  });

  it('sent, the wait over: a new code may be asked for', () => {
    const request = vi.fn();
    show(locale, codeOf({ typing: true, sentHere: true, request }));
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

  it('send_failed keeps the 60 s countdown under it, Send held until it ends (F2)', () => {
    const { container } = show(locale, codeOf({ notice: { error: 'send_failed' }, waitSeconds: 58 }));
    expect(container.querySelector('[data-code-wait]')?.textContent).toContain('0:58');
    expect((screen.getByRole('button', { name: text('send') }) as HTMLButtonElement).disabled).toBe(true);
  });

  it.each<[CodeLimit, string]>([
    ['target_spacing', 'spacing.payment'],
    ['target_hour', 'target.payment'],
    ['target_tries', 'target.payment'],
    ['delivery_day', 'delivery'],
    ['studio_day', 'studio'],
    ['platform_day', 'service'],
    ['link_minute', 'link'],
    ['claims_hour', 'claims'],
  ])('too_many from %s names its limit, and the wait as it runs, in place of the countdown line (F3, F4)', (limit, key) => {
    const { container } = show(locale, codeOf({ notice: { error: 'too_many', limit }, noticeSeconds: 81_000, waitSeconds: 81_000 }));
    const alert = screen.getByRole('alert').textContent ?? '';
    const words = text(`tooMany.${key}`).replaceAll('{studio}', 'Diwan Studio');
    expect(alert.startsWith(words.slice(0, words.indexOf('{wait}')))).toBe(true);
    expect(alert).toMatch(locale === 'en' ? /22 hours and 30 minutes/ : /22 ساعة و30 دقيقة/);
    expect(container.querySelector('[data-code-wait]')).toBeNull();
    expect((screen.getByRole('button', { name: text('send') }) as HTMLButtonElement).disabled).toBe(true);
    clean(container);
  });

  it('a wrong code names the tries left; a shared failure is said as every link page says it', () => {
    const { unmount } = show(locale, codeOf({ typing: true, notice: { error: 'code_wrong', attemptsLeft: 2 } }));
    expect(screen.getByRole('alert').textContent).toMatch(locale === 'en' ? /\b2\b/ : /محاولتان/);
    unmount();
    show(locale, codeOf({ notice: { error: 'portal', failure: { error: 'token_expired' } } }));
    expect(screen.getByRole('alert').textContent).toBe(messageAt(locale, 'portal.errors.token_expired'));
  });

  it('no address on file: said plainly, the studio\'s WhatsApp, no box, no Send and no "I already have a code"', () => {
    const { container } = show(locale, codeOf({ noChannel: true }));
    expect(screen.getByRole('status').textContent).toBe(text('noChannel.payment').replaceAll('{studio}', 'Diwan Studio'));
    expect(screen.getByRole('link').getAttribute('href')).toBe('https://wa.me/201001234567?text=x');
    expect(screen.queryByRole('button', { name: text('send') })).toBeNull();
    expect(screen.queryByRole('button', { name: text('haveCode') })).toBeNull();
    expect(screen.queryByLabelText(text('label'))).toBeNull();
    clean(container);
  });

  it('a signing code says its own words: the limits on this contract, and no address on file (H6.2)', () => {
    const signing = (fields: Partial<ClientCode>) => show(locale, codeOf({ act: 'signature', ...fields }));
    for (const [limit, key] of [['target_spacing', 'spacing'], ['target_hour', 'target']] as const) {
      const { unmount } = signing({ notice: { error: 'too_many', limit }, noticeSeconds: 30, waitSeconds: 30 });
      const words = text(`tooMany.${key}.signature`);
      expect(screen.getByRole('alert').textContent?.startsWith(words.slice(0, words.indexOf('{wait}')))).toBe(true);
      unmount();
    }
    const { container } = signing({ noChannel: true });
    expect(screen.getByRole('status').textContent).toBe(text('noChannel.signature').replaceAll('{studio}', 'Diwan Studio'));
    clean(container);
  });
});
