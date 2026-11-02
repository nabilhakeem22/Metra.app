import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// H6.3 (AC4): the /c page's gate, with the REAL next/navigation. The contract is
// read, and when its home can be shown the page throws Next's 307 replace to it,
// with nothing of the contract rendered; any other link renders its document. A
// locale the app does not have is a 404 before any read (security S2).

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
