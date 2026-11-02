import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LINK_DOCUMENT_WAIT_MS } from '@/lib/client-home/optional-read';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';

// H7.2 (AC16): the /v page's gate, with the REAL next/navigation. The order is
// read, and when its home can be shown the page throws Next's 307 replace to it,
// with nothing of the order rendered; any other link renders its document. A
// locale the app does not have is a 404 before any read. The order's own read
// that fails or stalls is the client home's "refresh" notice at the same budget
// as the home lookup (H7 R1); a null read stays the invalid-link page.

const reads = vi.hoisted(() => ({ variationLinkLanding: vi.fn(), getVariationByToken: vi.fn() }));
vi.mock('@/lib/client-home/redirect-variation', () => ({ variationLinkLanding: reads.variationLinkLanding }));
vi.mock('@/lib/variations/public', () => ({ getVariationByToken: reads.getVariationByToken }));
vi.mock('./public-variation', () => ({ PublicVariationView: () => null }));

const { default: PublicVariationPage } = await import('./page');

const params = Promise.resolve({ locale: 'ar-EG', token: 'v-raw' });
const VARIATION = { contractSource: 'boq', status: 'issued' };

beforeEach(() => {
  reads.variationLinkLanding.mockReset();
  reads.getVariationByToken.mockReset().mockResolvedValue(VARIATION);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe.each<TestLocale>(['ar-EG', 'en'])('the /v page when its own read does not answer (%s, H7 R1)', (locale) => {
  const page = () => PublicVariationPage({ params: Promise.resolve({ locale, token: 'v-raw' }) });
  const expectNotice = (element: Awaited<ReturnType<typeof page>>) => {
    renderWithIntl(element, { locale });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(messageAt(locale, 'delivery.readFailed.title'));
    expect(screen.getByText(messageAt(locale, 'delivery.readFailed.body'))).toBeTruthy();
    const switchLink = screen.getByRole('link', { name: messageAt(locale, 'delivery.language.switchTo') });
    expect(switchLink.getAttribute('href')).toMatch(/\/v\/v-raw$/);
    expect(reads.variationLinkLanding).not.toHaveBeenCalled();
  };

  it('a read that throws: the notice, and ONE log line with none of the query parameters', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    reads.getVariationByToken.mockRejectedValue(Object.assign(new Error('Failed query: select params: SECRET-HASH'), { query: 'select', params: ['SECRET-HASH'] }));
    expectNotice(await page());
    expect(logged).toHaveBeenCalledTimes(1);
    expect(logged.mock.calls[0][0]).toBe('public variation read failed:');
    expect(JSON.stringify(logged.mock.calls)).not.toContain('SECRET-HASH');
  });

  it('a read that stalls: the notice at the budget, not before', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.useFakeTimers();
    reads.getVariationByToken.mockReturnValue(new Promise(() => {}));
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
    reads.getVariationByToken.mockResolvedValue(null);
    reads.variationLinkLanding.mockResolvedValue({ homePath: null, waitsForSignature: false });
    const element = await page();
    expect(element.props).toEqual({ token: 'v-raw', variation: null, waitsForSignature: false });
    expect(reads.variationLinkLanding).toHaveBeenCalledWith('v-raw', null, locale);
    expect(logged).not.toHaveBeenCalled();
  });
});

describe('the /v page', () => {
  it('with a home: a 307 replace to exactly that path, asked with the order', async () => {
    reads.variationLinkLanding.mockResolvedValue({ homePath: '/ar-EG/d/home-raw?tab=execution&focus=variation:v-id', waitsForSignature: false });
    const thrown = await PublicVariationPage({ params }).catch((error: unknown) => error);
    expect((thrown as { digest?: string }).digest).toBe('NEXT_REDIRECT;replace;/ar-EG/d/home-raw?tab=execution&focus=variation:v-id;307;');
    expect(reads.variationLinkLanding).toHaveBeenCalledWith('v-raw', VARIATION, 'ar-EG');
  });

  it.each([false, true])('without one: the order is handed to the view, with whether it waits for the signature (%s)', async (waitsForSignature) => {
    reads.variationLinkLanding.mockResolvedValue({ homePath: null, waitsForSignature });
    const element = await PublicVariationPage({ params });
    expect(reads.getVariationByToken).toHaveBeenCalledTimes(1);
    expect(element.props).toEqual({ token: 'v-raw', variation: VARIATION, waitsForSignature });
  });

  it.each(['evil.com', '/evil.com', 'AR-EG', 'en.', ''])('a locale the app does not have (%j): 404, and nothing is read', async (locale) => {
    const thrown = await PublicVariationPage({ params: Promise.resolve({ locale, token: 'v-raw' }) }).catch((error: unknown) => error);
    expect((thrown as { digest?: string }).digest).toMatch(/^NEXT_HTTP_ERROR_FALLBACK;404$/);
    expect(reads.getVariationByToken).not.toHaveBeenCalled();
    expect(reads.variationLinkLanding).not.toHaveBeenCalled();
  });

  it('never redirects permanently, and the segment has no loading boundary or layout to stream or read beside it', () => {
    expect(readFileSync(join(__dirname, 'page.tsx'), 'utf8')).not.toMatch(/permanentRedirect\(/);
    expect(() => readFileSync(join(__dirname, 'loading.tsx'))).toThrow();
    expect(() => readFileSync(join(__dirname, 'layout.tsx'))).toThrow();
  });
});
