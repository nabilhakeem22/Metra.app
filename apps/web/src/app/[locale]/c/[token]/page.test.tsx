import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LINK_DOCUMENT_WAIT_MS } from '@/lib/client-home/optional-read';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';

// H6.3 (AC4): the /c page's gate, with the REAL next/navigation. The contract is
// read, and when its home can be shown the page throws Next's 307 replace to it,
// with nothing of the contract rendered; any other link renders its document. A
// locale the app does not have is a 404 before any read (security S2). The
// contract's own read that fails or stalls is the client home's "refresh" notice
// at the same budget as the home lookup (H7 R1); a null read stays the
// invalid-link page.

const reads = vi.hoisted(() => ({ contractHomeRedirect: vi.fn(), getContractByToken: vi.fn() }));
vi.mock('@/lib/client-home/redirect', () => ({ contractHomeRedirect: reads.contractHomeRedirect }));
vi.mock('@/lib/contracts/public', () => ({ getContractByToken: reads.getContractByToken }));
vi.mock('./public-contract', () => ({ PublicContractView: () => null }));

const { default: PublicContractPage } = await import('./page');

const params = Promise.resolve({ locale: 'ar-EG', token: 'c-raw' });
const CONTRACT = { source: 'boq', status: 'issued' };

beforeEach(() => {
  reads.contractHomeRedirect.mockReset();
  reads.getContractByToken.mockReset().mockResolvedValue(CONTRACT);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe.each<TestLocale>(['ar-EG', 'en'])('the /c page when its own read does not answer (%s, H7 R1)', (locale) => {
  const page = () => PublicContractPage({ params: Promise.resolve({ locale, token: 'c-raw' }) });
  const expectNotice = (element: Awaited<ReturnType<typeof page>>) => {
    renderWithIntl(element, { locale });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(messageAt(locale, 'delivery.readFailed.title'));
    expect(screen.getByText(messageAt(locale, 'delivery.readFailed.body'))).toBeTruthy();
    const switchLink = screen.getByRole('link', { name: messageAt(locale, 'delivery.language.switchTo') });
    expect(switchLink.getAttribute('href')).toMatch(/\/c\/c-raw$/);
    expect(reads.contractHomeRedirect).not.toHaveBeenCalled();
  };

  it('a read that throws: the notice, and ONE log line with none of the query parameters', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    reads.getContractByToken.mockRejectedValue(Object.assign(new Error('Failed query: select params: SECRET-HASH'), { query: 'select', params: ['SECRET-HASH'] }));
    expectNotice(await page());
    expect(logged).toHaveBeenCalledTimes(1);
    expect(logged.mock.calls[0][0]).toBe('public contract read failed:');
    expect(JSON.stringify(logged.mock.calls)).not.toContain('SECRET-HASH');
  });

  it('a read that stalls: the notice at the budget, not before', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.useFakeTimers();
    reads.getContractByToken.mockReturnValue(new Promise(() => {}));
    const answer = page();
    await vi.advanceTimersByTimeAsync(LINK_DOCUMENT_WAIT_MS - 1);
    expect(logged).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    const element = await answer;
    vi.useRealTimers();
    expectNotice(element);
    expect(logged).toHaveBeenCalledTimes(1);
  });

  it('a read that answers null is not a failure: the invalid-link page, and nothing logged', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    reads.getContractByToken.mockResolvedValue(null);
    reads.contractHomeRedirect.mockResolvedValue(null);
    const element = await page();
    expect(element.props).toEqual({ token: 'c-raw', contract: null });
    expect(logged).not.toHaveBeenCalled();
  });
});

describe('the /c page', () => {
  it('with a home: a 307 replace to exactly that path, asked with the contract', async () => {
    reads.contractHomeRedirect.mockResolvedValue('/ar-EG/d/home-raw?tab=execution&focus=contract');
    const thrown = await PublicContractPage({ params }).catch((error: unknown) => error);
    expect((thrown as { digest?: string }).digest).toBe('NEXT_REDIRECT;replace;/ar-EG/d/home-raw?tab=execution&focus=contract;307;');
    expect(reads.contractHomeRedirect).toHaveBeenCalledWith('c-raw', CONTRACT, 'ar-EG');
  });

  it('without one: the contract is handed to the view', async () => {
    reads.contractHomeRedirect.mockResolvedValue(null);
    const element = await PublicContractPage({ params });
    expect(reads.getContractByToken).toHaveBeenCalledTimes(1);
    expect(element.props).toEqual({ token: 'c-raw', contract: CONTRACT });
  });

  it.each(['evil.com', '/evil.com', 'AR-EG', 'en.', ''])('a locale the app does not have (%j): 404, and nothing is read', async (locale) => {
    const thrown = await PublicContractPage({ params: Promise.resolve({ locale, token: 'c-raw' }) }).catch((error: unknown) => error);
    expect((thrown as { digest?: string }).digest).toMatch(/^NEXT_HTTP_ERROR_FALLBACK;404$/);
    expect(reads.getContractByToken).not.toHaveBeenCalled();
    expect(reads.contractHomeRedirect).not.toHaveBeenCalled();
  });

  it('never redirects permanently, and the segment has no loading boundary to stream before it', () => {
    expect(readFileSync(join(__dirname, 'page.tsx'), 'utf8')).not.toMatch(/permanentRedirect/);
    expect(() => readFileSync(join(__dirname, 'loading.tsx'))).toThrow();
  });
});
