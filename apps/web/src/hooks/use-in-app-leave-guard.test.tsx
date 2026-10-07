import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useInAppLeaveGuard } from './use-in-app-leave-guard';

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function Page({ active, beforeLeave }: { active: boolean; beforeLeave: () => Promise<boolean> }) {
  useInAppLeaveGuard({ active, beforeLeave });
  return (
    <nav>
      <a href="/en/engagements?move=mine">Deliveries</a>
      <a href="https://example.com/elsewhere">Elsewhere</a>
      <a href="/en/projects" target="_blank" rel="noreferrer">New tab</a>
    </nav>
  );
}

const click = (name: string, init: MouseEventInit = {}) =>
  act(async () => void fireEvent.click(screen.getByText(name), init));

describe('useInAppLeaveGuard', () => {
  it('holds an in-app link until beforeLeave answers; stays on false', async () => {
    const beforeLeave = vi.fn().mockResolvedValue(false);
    render(<Page active beforeLeave={beforeLeave} />);
    const navigated = vi.fn();
    document.addEventListener('click', (event) => navigated(event.defaultPrevented), { once: true });
    await click('Deliveries');
    expect(beforeLeave).toHaveBeenCalledTimes(1);
    expect(router.push).not.toHaveBeenCalled();
    expect(navigated).not.toHaveBeenCalled();
  });

  it('leaves for the same path, query and hash when beforeLeave answers true', async () => {
    render(<Page active beforeLeave={vi.fn().mockResolvedValue(true)} />);
    await click('Deliveries');
    expect(router.push).toHaveBeenCalledWith('/en/engagements?move=mine');
  });

  it('lets other origins, new tabs and modified clicks through, and does nothing when inactive', async () => {
    const beforeLeave = vi.fn().mockResolvedValue(false);
    const view = render(<Page active beforeLeave={beforeLeave} />);
    await click('Elsewhere');
    await click('New tab');
    await click('Deliveries', { ctrlKey: true });
    expect(beforeLeave).not.toHaveBeenCalled();
    view.rerender(<Page active={false} beforeLeave={beforeLeave} />);
    await click('Deliveries');
    expect(beforeLeave).not.toHaveBeenCalled();
  });

  describe('Back and Forward (popstate)', () => {
    /** The browser moving to `href` and announcing it. */
    function browserMovesTo(href: string, nextListener: () => void) {
      window.history.pushState({ moved: true }, '', href);
      window.addEventListener('popstate', nextListener);
      act(() => void window.dispatchEvent(new PopStateEvent('popstate', { state: { moved: true } })));
      window.removeEventListener('popstate', nextListener);
    }

    it('holds the page, keeps Next (registered FIRST, as in the app) from rendering the other one, and stays on false', async () => {
      window.history.replaceState({ page: true }, '', '/en/proposals/p-1');
      const nextListener = vi.fn();
      window.addEventListener('popstate', nextListener);
      const beforeLeave = vi.fn().mockResolvedValue(false);
      render(<Page active beforeLeave={beforeLeave} />);
      window.history.pushState({ moved: true }, '', '/en/engagements');
      act(() => void window.dispatchEvent(new PopStateEvent('popstate', { state: { moved: true } })));
      window.removeEventListener('popstate', nextListener);
      await act(async () => {});
      expect(nextListener).not.toHaveBeenCalled();
      expect(window.location.pathname).toBe('/en/proposals/p-1');
      expect(beforeLeave).toHaveBeenCalledTimes(1);
      expect(router.push).not.toHaveBeenCalled();
    });

    it('goes where the user was going once beforeLeave agrees', async () => {
      window.history.replaceState({ page: true }, '', '/en/proposals/p-1');
      render(<Page active beforeLeave={vi.fn().mockResolvedValue(true)} />);
      browserMovesTo('/en/engagements?move=mine', () => {});
      await act(async () => {});
      expect(router.push).toHaveBeenCalledWith('/en/engagements?move=mine');
    });

    it('does nothing when inactive', async () => {
      window.history.replaceState({ page: true }, '', '/en/proposals/p-1');
      const beforeLeave = vi.fn();
      render(<Page active={false} beforeLeave={beforeLeave} />);
      const nextListener = vi.fn();
      browserMovesTo('/en/engagements', nextListener);
      expect(nextListener).toHaveBeenCalledTimes(1);
      expect(beforeLeave).not.toHaveBeenCalled();
    });
  });
});
