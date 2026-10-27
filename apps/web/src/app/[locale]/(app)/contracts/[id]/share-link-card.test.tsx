import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { ShareLinkCard } from './share-link-card';

// H6.4 (AC16): after an issue, the studio is shown what to send the client.
// An execution contract: its client home's link to copy, why there is none,
// or the refusal with "try the Client page control"; a document: its own
// link, as before. Egyptian studio copy.

const HOME = 'https://studio.example/ar-EG/d/home-raw-token-0123456789abcdef?tab=execution';

afterEach(() => vi.unstubAllGlobals());

describe.each<TestLocale>(['ar-EG', 'en'])('the shared link card (%s)', (locale) => {
  const at = (key: string) => messageAt(locale, key);

  it('a home: the title, the body, the link left to right and truncated; copy writes the exact link', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    renderWithIntl(<ShareLinkCard shared={{ kind: 'home', answer: { ok: true, link: HOME } }} />, { locale });
    expect(screen.getByText(at('contracts.clientPage.issued.title'))).toBeTruthy();
    expect(screen.getByText(at('contracts.clientPage.issued.body'))).toBeTruthy();
    const code = screen.getByText(HOME);
    expect(code.getAttribute('dir')).toBe('ltr');
    expect(code.className.split(' ')).toContain('truncate');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: at('contracts.clientPage.copy') }));
    });
    expect(writeText).toHaveBeenCalledWith(HOME);
    expect(screen.queryByText(at('contracts.clientPage.issued.retry'))).toBeNull();
  });

  it('a reason: its copy as a status, and no retry line', () => {
    renderWithIntl(<ShareLinkCard shared={{ kind: 'home', answer: { ok: true, link: null, linkReason: 'delivery_links_not_configured' } }} />, { locale });
    expect(screen.getByRole('status').textContent).toBe(at('contracts.clientPage.reason.delivery_links_not_configured'));
    expect(screen.queryByText(at('contracts.clientPage.issued.retry'))).toBeNull();
  });

  it('a refusal: the error as an alert, then the retry line', () => {
    renderWithIntl(<ShareLinkCard shared={{ kind: 'home', answer: { ok: false, error: 'client_home_unavailable' } }} />, { locale });
    expect(screen.getByRole('alert').textContent).toBe(at('errors.client_home_unavailable'));
    expect(screen.getByText(at('contracts.clientPage.issued.retry'))).toBeTruthy();
  });

  it('a document link: the acknowledgement link label, as before', () => {
    renderWithIntl(<ShareLinkCard shared={{ kind: 'document', link: 'https://studio.example/en/c/raw' }} />, { locale });
    expect(screen.getByText(`${at('contracts.shareLink')}:`)).toBeTruthy();
    expect(screen.getByRole('button', { name: at('contracts.copyLink') })).toBeTruthy();
    expect(screen.queryByText(at('contracts.clientPage.issued.title'))).toBeNull();
  });
});
