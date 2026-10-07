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
});
