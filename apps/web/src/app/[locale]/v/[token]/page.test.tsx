import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// H7.2 (AC16): the /v page's gate, with the REAL next/navigation. The order is
// read, and when its home can be shown the page throws Next's 307 replace to it,
// with nothing of the order rendered; any other link renders its document. A
// locale the app does not have is a 404 before any read.

const reads = vi.hoisted(() => ({ variationHomeRedirect: vi.fn(), getVariationByToken: vi.fn() }));
vi.mock('@/lib/client-home/redirect', () => ({ variationHomeRedirect: reads.variationHomeRedirect }));
vi.mock('@/lib/variations/public', () => ({ getVariationByToken: reads.getVariationByToken }));
vi.mock('./public-variation', () => ({ PublicVariationView: () => null }));

const { default: PublicVariationPage } = await import('./page');

const params = Promise.resolve({ locale: 'ar-EG', token: 'v-raw' });
const VARIATION = { contractSource: 'boq', status: 'issued' };

beforeEach(() => {
  reads.variationHomeRedirect.mockReset();
  reads.getVariationByToken.mockReset().mockResolvedValue(VARIATION);
});

describe('the /v page', () => {
  it('with a home: a 307 replace to exactly that path, asked with the order', async () => {
    reads.variationHomeRedirect.mockResolvedValue('/ar-EG/d/home-raw?tab=execution&focus=variation:v-id');
    const thrown = await PublicVariationPage({ params }).catch((error: unknown) => error);
    expect((thrown as { digest?: string }).digest).toBe('NEXT_REDIRECT;replace;/ar-EG/d/home-raw?tab=execution&focus=variation:v-id;307;');
    expect(reads.variationHomeRedirect).toHaveBeenCalledWith('v-raw', VARIATION, 'ar-EG');
  });

  it('without one: the order is handed to the view', async () => {
    reads.variationHomeRedirect.mockResolvedValue(null);
    const element = await PublicVariationPage({ params });
    expect(reads.getVariationByToken).toHaveBeenCalledTimes(1);
    expect(element.props).toEqual({ token: 'v-raw', variation: VARIATION });
  });

  it.each(['evil.com', '/evil.com', 'AR-EG', 'en.', ''])('a locale the app does not have (%j): 404, and nothing is read', async (locale) => {
    const thrown = await PublicVariationPage({ params: Promise.resolve({ locale, token: 'v-raw' }) }).catch((error: unknown) => error);
    expect((thrown as { digest?: string }).digest).toMatch(/^NEXT_HTTP_ERROR_FALLBACK;404$/);
    expect(reads.getVariationByToken).not.toHaveBeenCalled();
    expect(reads.variationHomeRedirect).not.toHaveBeenCalled();
  });

  it('never redirects permanently, and the segment has no loading boundary or layout to stream or read beside it', () => {
    expect(readFileSync(join(__dirname, 'page.tsx'), 'utf8')).not.toMatch(/permanentRedirect\(/);
    expect(() => readFileSync(join(__dirname, 'loading.tsx'))).toThrow();
    expect(() => readFileSync(join(__dirname, 'layout.tsx'))).toThrow();
  });
});
