import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// H6.3 (AC4): the /c segment's gate, with the REAL next/navigation. A link
// whose home can be shown throws Next's 307 replace to it before the page can
// render; any other link renders the page unchanged.

const target = vi.hoisted(() => ({ contractHomeRedirect: vi.fn() }));
vi.mock('@/lib/client-home/redirect', () => target);

const { default: ContractTokenLayout } = await import('./layout');

const params = (token: string) => Promise.resolve({ locale: 'ar-EG', token });

describe('the /c token layout', () => {
  it('with a home: a 307 replace to exactly that path, and the children are never rendered', async () => {
    target.contractHomeRedirect.mockResolvedValue('/ar-EG/d/home-raw?tab=execution&focus=contract');
    const children = vi.fn(() => null);
    const thrown = await ContractTokenLayout({ children: <Probe render={children} />, params: params('c-raw') }).catch((error: unknown) => error);
    const digest = (thrown as { digest?: string }).digest ?? '';
    expect(digest).toBe('NEXT_REDIRECT;replace;/ar-EG/d/home-raw?tab=execution&focus=contract;307;');
    expect(target.contractHomeRedirect).toHaveBeenCalledWith('c-raw', 'ar-EG');
    expect(children).not.toHaveBeenCalled();
  });

  it('without one: the children, unchanged', async () => {
    target.contractHomeRedirect.mockResolvedValue(null);
    const children = <p>page</p>;
    expect(await ContractTokenLayout({ children, params: params('c-raw') })).toBe(children);
  });

  it('never redirects permanently', () => {
    expect(readFileSync(join(__dirname, 'layout.tsx'), 'utf8')).not.toMatch(/permanentRedirect/);
  });
});

function Probe({ render }: { render: () => null }) {
  return render();
}
