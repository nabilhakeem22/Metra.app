import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// H6.3 (AC4): the /c page's gate, with the REAL next/navigation. A link whose
// home can be shown throws Next's 307 replace to it, and its contract is never
// read; any other link reads its contract and renders as before.

const reads = vi.hoisted(() => ({ contractHomeRedirect: vi.fn(), getContractByToken: vi.fn() }));
vi.mock('@/lib/client-home/redirect', () => ({ contractHomeRedirect: reads.contractHomeRedirect }));
vi.mock('@/lib/contracts/public', () => ({ getContractByToken: reads.getContractByToken }));
vi.mock('./public-contract', () => ({ PublicContractView: () => null }));

const { default: PublicContractPage } = await import('./page');

const params = Promise.resolve({ locale: 'ar-EG', token: 'c-raw' });

beforeEach(() => {
  reads.contractHomeRedirect.mockReset();
  reads.getContractByToken.mockReset().mockResolvedValue({ source: 'proposal' });
});

describe('the /c page', () => {
  it('with a home: a 307 replace to exactly that path, and the contract is never read', async () => {
    reads.contractHomeRedirect.mockResolvedValue('/ar-EG/d/home-raw?tab=execution&focus=contract');
    const thrown = await PublicContractPage({ params }).catch((error: unknown) => error);
    expect((thrown as { digest?: string }).digest).toBe('NEXT_REDIRECT;replace;/ar-EG/d/home-raw?tab=execution&focus=contract;307;');
    expect(reads.contractHomeRedirect).toHaveBeenCalledWith('c-raw', 'ar-EG');
    expect(reads.getContractByToken).not.toHaveBeenCalled();
  });

  it('without one: the contract is read and handed to the view', async () => {
    reads.contractHomeRedirect.mockResolvedValue(null);
    const element = await PublicContractPage({ params });
    expect(reads.getContractByToken).toHaveBeenCalledWith('c-raw');
    expect(element.props).toEqual({ token: 'c-raw', contract: { source: 'proposal' } });
  });

  it('never redirects permanently, and the segment has no loading boundary to stream before it', () => {
    expect(readFileSync(join(__dirname, 'page.tsx'), 'utf8')).not.toMatch(/permanentRedirect/);
    expect(() => readFileSync(join(__dirname, 'loading.tsx'))).toThrow();
  });
});
