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
    renderWithIntl(<ShareLinkCard shared={{ kind: 'home', answer: { ok: true, clientHasEmail: true, link: HOME } }} />, { locale });
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
    expect(screen.queryByText(at('engagements.command.noEmailSignature'))).toBeNull();
  });

  it('a client with no email: the no-email notice, never "a code sent to their email"; the link is still there (F2)', () => {
    renderWithIntl(<ShareLinkCard shared={{ kind: 'home', answer: { ok: true, clientHasEmail: false, link: HOME } }} />, { locale });
    expect(screen.getByText(at('engagements.command.noEmailSignature'))).toBeTruthy();
    expect(screen.queryByText(at('contracts.clientPage.issued.body'))).toBeNull();
    expect(screen.getByText(HOME)).toBeTruthy();
  });

  it('a reason: its copy as a status, and no retry line', () => {
    renderWithIntl(<ShareLinkCard shared={{ kind: 'home', answer: { ok: true, clientHasEmail: true, link: null, linkReason: 'delivery_links_not_configured' } }} />, { locale });
    expect(screen.getByRole('status').textContent).toBe(at('contracts.clientPage.reason.delivery_links_not_configured'));
    expect(screen.queryByText(at('contracts.clientPage.issued.retry'))).toBeNull();
  });

  it.each(['uncertain', 'busy', 'engagement_state_conflict'] as const)('a transient %s: the error as an alert, then the retry line (F3)', (error) => {
    renderWithIntl(<ShareLinkCard shared={{ kind: 'home', answer: { ok: false, error } }} />, { locale });
    expect(screen.getByRole('alert').textContent).toBe(at(`errors.${error}`));
    expect(screen.getByText(at('contracts.clientPage.issued.retry'))).toBeTruthy();
  });

  it.each(['client_home_unavailable', 'flow_not_enabled', 'contract_terminated'] as const)('a refusal that a retry cannot change, %s: the error alone (F3)', (error) => {
    renderWithIntl(<ShareLinkCard shared={{ kind: 'home', answer: { ok: false, error } }} />, { locale });
    expect(screen.getByRole('alert').textContent).toBe(at(`errors.${error}`));
    expect(screen.queryByText(at('contracts.clientPage.issued.retry'))).toBeNull();
  });

  it('a document link: the acknowledgement link label, as before', () => {
    renderWithIntl(<ShareLinkCard shared={{ kind: 'document', link: 'https://studio.example/en/c/raw' }} />, { locale });
    expect(screen.getByText(`${at('contracts.shareLink')}:`)).toBeTruthy();
    expect(screen.getByRole('button', { name: at('contracts.copyLink') })).toBeTruthy();
    expect(screen.queryByText(at('contracts.clientPage.issued.title'))).toBeNull();
  });
});
